import fs from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.argv[2] || process.env.TARGET_URL;
if (!baseUrl) {
  throw new Error("Pass the deployed dashboard URL as the first argument or TARGET_URL");
}

// ---------------------------------------------------------------------------
// Handshake de versión: GitHub Pages puede servir el despliegue anterior durante
// uno o dos minutos. Antes de asertar nada, esperamos a que el index publicado
// referencie la misma versión de dashboard.mjs que el checkout actual.
// ---------------------------------------------------------------------------
function expectedAssetVersion() {
  try {
    const html = fs.readFileSync("index.html", "utf8");
    return html.match(/dashboard\.mjs\?v=([\w.-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function waitForDeployment(expected, { attempts = 24, delayMs = 10_000 } = {}) {
  if (!expected) {
    console.warn("Sin index.html local: se omite el handshake de versión.");
    return;
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}?handshake=${Date.now()}`, { cache: "no-store" });
      const body = await response.text();
      const served = body.match(/dashboard\.mjs\?v=([\w.-]+)/)?.[1];
      if (response.ok && served === expected) {
        console.log(`Despliegue confirmado (v=${served}) en el intento ${attempt}.`);
        return;
      }
      console.log(`Intento ${attempt}/${attempts}: publicado v=${served ?? "?"}, esperado v=${expected}.`);
    } catch (error) {
      console.log(`Intento ${attempt}/${attempts}: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`El despliegue publicado no sirve la versión esperada (v=${expected}) tras ${attempts} intentos.`);
}

await waitForDeployment(expectedAssetVersion());

const target = new URL(baseUrl);
target.searchParams.set("metric", "pob");
target.searchParams.set("lat", "40.42");
target.searchParams.set("lng", "-3.72");
target.searchParams.set("zoom", "10");
target.searchParams.set("zone", "M:28022");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const requestFailures = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`));

try {
  const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!response?.ok()) throw new Error(`Published page returned HTTP ${response?.status()}`);

  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  await page.locator("#map .maplibregl-canvas").first().waitFor({ timeout: 15_000 });
  await page.getByRole("heading", { name: "Boadilla del Monte" }).waitFor();
  await page.locator('[data-testid="zone-all-data"]').waitFor();
  if (await page.locator("#compare").isVisible()) throw new Error("Comparator opens before the selected zone is added");
  await page.locator('[data-testid="add-compare"]').click();
  if (!(await page.locator("#compare").isVisible())) throw new Error("Comparator does not open after adding the selected zone");

  await page.locator("#view3d").click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "3d");
  await page.locator("#timeSlider").fill("0");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("year") === "2020");
  await page.locator("#timeReset").click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("year"));
  if (await page.getByText("Rojo = gana", { exact: false }).count()) throw new Error("Removed population explanation is still visible");
  if (await page.getByRole("button", { name: "Copiar enlace de esta vista", exact: true }).count()) throw new Error("Removed share control is still visible");
  if (await page.locator("#timeSlider").getAttribute("max") !== "5") throw new Error("Municipal timeline does not expose every year from 2020 to 2025");
  await page.locator("#timePlay").click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("year") === "2020");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("year") === "2021", null, { timeout: 3_000 });
  await page.locator("#timeReset").click(); // detiene la reproducción y vuelve a "actual": determinista, sin carreras con el auto-stop
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("year"));
  await page.waitForFunction(() => document.getElementById("timePlay")?.getAttribute("aria-pressed") === "false", null, { timeout: 5_000 });
  await page.locator("#view2d").click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("view"));

  await page.locator("#tren").click();
  if (!new URL(page.url()).searchParams.get("metric")?.includes("ren")) {
    throw new Error("Metric changes are not being persisted in the URL");
  }
  if (await page.locator("#view3d").isVisible()) throw new Error("3D control remains visible outside population");

  const search = page.locator("#zoneSearch");
  await search.fill("Centro — distrito");
  await search.press("Enter");
  await page.getByRole("heading", { name: "Centro", exact: true }).waitFor();
  // Esperar a que la ficha de Centro esté operativa (zone=D:1 persistido) antes de añadirla
  await page.waitForFunction(() => new URL(location.href).searchParams.get("zone") === "D:1");
  // El hit-testing del ratón headless no alcanza este botón en el preview local
  // (verificado con un listener de captura en document: cero clicks). Se acciona
  // con el click() del DOM: ejercita igualmente el listener delegado de #info y
  // toda la cadena addCompare -> renderCompare -> writeState -> export.
  await page.locator('#info [data-testid="add-compare"]').evaluate((element) => element.click());
  try {
    await page.waitForFunction(() => (new URL(location.href).searchParams.get("compare") || "").split(",").filter(Boolean).length === 2, null, { timeout: 5_000 });
  } catch {
    const state = await page.evaluate(() => ({
      url: location.search,
      removeButtons: document.querySelectorAll("#compareBody [data-remove-compare]").length,
      infoButton: document.querySelector('#info [data-testid="add-compare"]')?.textContent || "(sin botón)",
    }));
    throw new Error(`Second zone was not added to the comparator: ${JSON.stringify(state)}`);
  }
  const verdict = page.locator('[data-testid="compare-verdict"]');
  await verdict.waitFor();
  if (!(await verdict.getAttribute("data-grade"))) throw new Error("Comparator verdict lacks a comparability grade");

  const legendRanges = page.locator(".legend-range");
  if ((await legendRanges.count()) !== 5) throw new Error("Interactive legend must expose five populated quantile ranges");
  const rangeCounts = (await page.locator(".legend-range .count").allTextContents()).map(Number);
  const rangeTotal = rangeCounts.reduce((sum, value) => sum + value, 0);
  if (rangeCounts.some((value) => value < 1 || value > Math.ceil(rangeTotal / 2))) throw new Error("Legend contains an empty or dominant range");
  const legendText = await page.locator("#mapLegend").innerText();
  if (/Pasa por un rango|Quitar selección|Evitar solapes|Altura:/.test(legendText)) throw new Error("Legend still exposes removed explanatory controls");
  const rangeHref = await legendRanges.nth(2).getAttribute("href");
  if (!rangeHref || !new URL(rangeHref).searchParams.has("range")) throw new Error("Legend link does not encode its range");
  await page.goto(rangeHref, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  if ((await page.locator(".legend-range.active").count()) !== 1) throw new Error("Legend range is not restored from the URL");
  const inactiveRanges = page.locator(".legend-range:not(.active)");
  if ((await inactiveRanges.count()) !== 4) throw new Error("Unexpected active legend state");
  const secondRangeHref = await inactiveRanges.nth(0).getAttribute("href");
  if (!secondRangeHref || (new URL(secondRangeHref).searchParams.get("range") || "").split(",").length !== 2) throw new Error("Legend does not accumulate multiple ranges");
  await page.goto(secondRangeHref, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  if ((await page.locator(".legend-range.active").count()) !== 2) throw new Error("Multiple legend ranges are not restored");
  const activeRanges = page.locator(".legend-range.active");
  const clearHref = await activeRanges.nth(0).getAttribute("href");
  if (!clearHref || (new URL(clearHref).searchParams.get("range") || "").split(",").length !== 1) throw new Error("Clicking an active range must remove only that range");

  const removeButtons = await page.locator("#compareBody [data-remove-compare]").count();
  if (removeButtons !== 2) {
    const share = await page.locator("#shareStatus").textContent().catch(() => "");
    throw new Error(`Comparator lost its zones after legend navigation (remove buttons: ${removeButtons}; status: ${share}; url: ${page.url()})`);
  }
  const download = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
  await page.locator('[data-testid="export-csv"]').click();
  if (!(await download)) {
    const share = await page.locator("#shareStatus").textContent().catch(() => "");
    throw new Error(`CSV export did not trigger a download (status: "${share}")`);
  }

  const macroUrl = new URL(baseUrl);
  macroUrl.searchParams.set("metric", "pre");
  macroUrl.searchParams.set("zoom", "8");
  macroUrl.searchParams.set("zone", "C:CM");
  await page.goto(macroUrl.href, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  await page.getByRole("heading", { name: "Comunidad de Madrid", exact: true }).waitFor();
  await page.getByText("Precio medio de venta", { exact: true }).waitFor();
  if (!(await page.locator("#macroWrap").isVisible())) throw new Error("Territorial summary selector is hidden at regional zoom");

  const sparseZone = new URL(baseUrl);
  sparseZone.searchParams.set("metric", "esf");
  sparseZone.searchParams.set("zoom", "14");
  sparseZone.searchParams.set("zone", "B:106");
  await page.goto(sparseZone.href, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  await page.getByRole("heading", { name: "Cuatro Vientos", exact: true }).waitFor();
  const hasNoData = await page.locator("#info .no-data").count();
  const hasAllData = await page.locator('#info [data-testid="zone-all-data"]').count();
  if (!hasNoData && !hasAllData) throw new Error("Sparse zone card renders neither data nor its empty state");
  if (await page.getByText("Fuente y metodología", { exact: true }).count()) throw new Error("Removed methodology panel is still visible");
  if (await page.locator("#info").getByText("n.d.", { exact: true }).count()) throw new Error("Sparse zone card exposes empty n.d. placeholders");

  await page.setViewportSize({ width: 390, height: 844 });
  const panelBox = await page.locator(".panel").boundingBox();
  if (!panelBox || panelBox.width > 380 || panelBox.height > 72) throw new Error("Collapsed mobile controls occupy too much of the map");
  if (!(await page.locator("#togglePanel").isVisible())) throw new Error("Mobile options control is not visible");
  if (!(await page.locator(".legend").isVisible())) throw new Error("The map legend is hidden on mobile");
  const infoBox = await page.locator("#info").boundingBox();
  if (!infoBox || infoBox.height > 390) throw new Error("The initial mobile zone sheet covers too much of the map");

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
  console.log(`Published dashboard smoke test passed: ${page.url()}`);
} catch (error) {
  const diagnostics = [...pageErrors.map((message) => `page: ${message}`), ...requestFailures.slice(0, 10)];
  if (diagnostics.length) error.message += `\nBrowser diagnostics:\n${diagnostics.join("\n")}`;
  throw error;
} finally {
  await browser.close();
}
