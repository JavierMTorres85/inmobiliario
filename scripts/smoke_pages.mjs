import { chromium } from "playwright";

const baseUrl = process.argv[2] || process.env.TARGET_URL;
if (!baseUrl) {
  throw new Error("Pass the deployed dashboard URL as the first argument or TARGET_URL");
}

const target = new URL(baseUrl);
target.searchParams.set("metric", "pob");
target.searchParams.set("lat", "40.42");
target.searchParams.set("lng", "-3.72");
target.searchParams.set("zoom", "10");
target.searchParams.set("zone", "M:28022");
target.searchParams.set("compare", "M:28022,D:1");

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
  await page.getByText("Todos los datos disponibles", { exact: true }).waitFor();
  await page.getByText("Azul = inicio · naranja = final.").waitFor();
  await page.getByText("Comparabilidad media", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Población 3D", exact: true }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "3d");
  await page.locator("#timeSlider").fill("0");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("year") === "2020");
  await page.getByRole("button", { name: "Volver a actual", exact: true }).click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("year"));
  await page.getByRole("button", { name: "Mapa 2D", exact: true }).click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("view"));

  await page.getByRole("button", { name: "Rentabilidad", exact: true }).click();
  if (!new URL(page.url()).searchParams.get("metric")?.includes("ren")) {
    throw new Error("Metric changes are not being persisted in the URL");
  }

  const search = page.getByLabel("Buscar municipio, distrito o barrio");
  await search.fill("Centro — distrito");
  await search.press("Enter");
  await page.getByRole("heading", { name: "Centro", exact: true }).waitFor();

  const legendRanges = page.locator(".legend-range");
  if ((await legendRanges.count()) !== 5) throw new Error("Interactive legend must expose five proportional ranges");
  const rangeHref = await legendRanges.nth(2).getAttribute("href");
  if (!rangeHref || !new URL(rangeHref).searchParams.has("range")) throw new Error("Legend link does not encode its range");
  await page.goto(rangeHref, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  if (!(await page.locator(".legend-range.active").isVisible())) throw new Error("Legend range is not restored from the URL");
  const labelsHref = await page.locator("[data-labels-toggle]").getAttribute("href");
  if (!labelsHref || new URL(labelsHref).searchParams.get("labels") !== "all") throw new Error("Label link does not encode expanded density");
  await page.goto(labelsHref, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  if (new URL(page.url()).searchParams.get("labels") !== "all") throw new Error("Label density is not restored from the URL");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  await download;

  const sparseZone = new URL(baseUrl);
  sparseZone.searchParams.set("metric", "esf");
  sparseZone.searchParams.set("zoom", "14");
  sparseZone.searchParams.set("zone", "B:106");
  await page.goto(sparseZone.href, { waitUntil: "domcontentloaded" });
  await page.locator("#load").waitFor({ state: "hidden", timeout: 60_000 });
  await page.getByRole("heading", { name: "Cuatro Vientos", exact: true }).waitFor();
  await page.getByText("Esta zona no tiene indicadores cuantitativos en el conjunto actual.", { exact: true }).waitFor();
  if (await page.getByText("Fuente y metodología", { exact: true }).count()) throw new Error("Removed methodology panel is still visible");
  if (await page.locator("#info").getByText("n.d.", { exact: true }).count()) throw new Error("Sparse zone card exposes empty n.d. placeholders");

  await page.setViewportSize({ width: 390, height: 844 });
  const panelBox = await page.locator(".panel").boundingBox();
  if (!panelBox || panelBox.width > 380 || panelBox.height > 72) throw new Error("Collapsed mobile controls occupy too much of the map");
  if (!(await page.getByRole("button", { name: "Opciones", exact: true }).isVisible())) throw new Error("Mobile options control is not visible");
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
