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
  await page.getByText("Fuente y metodología", { exact: true }).waitFor();
  await page.getByText("Azul = inicio · naranja = final.").waitFor();
  await page.getByText("Comparabilidad media", { exact: true }).waitFor();

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
  await legendRanges.nth(2).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has("range"));
  await page.locator("[data-labels-toggle]").click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("labels") === "all");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  await download;

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
