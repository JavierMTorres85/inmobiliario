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
target.searchParams.set("changes", "1");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!response?.ok()) throw new Error(`Published page returned HTTP ${response?.status()}`);

  await page.locator("#map .leaflet-interactive").first().waitFor({ timeout: 60_000 });
  await page.getByRole("heading", { name: "Boadilla del Monte" }).waitFor();
  await page.getByText("Ficha de calidad del dato", { exact: true }).waitFor();
  await page.getByText("Azul = anterior · naranja = actual.").waitFor();
  await page.getByText("Comparabilidad baja", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Rentabilidad", exact: true }).click();
  if (!new URL(page.url()).searchParams.get("metric")?.includes("ren")) {
    throw new Error("Metric changes are not being persisted in the URL");
  }

  const search = page.getByLabel("Buscar municipio, distrito o barrio");
  await search.fill("Centro — distrito");
  await search.press("Enter");
  await page.getByRole("heading", { name: "Centro", exact: true }).waitFor();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  await download;

  await page.setViewportSize({ width: 390, height: 844 });
  const panelBox = await page.locator(".panel").boundingBox();
  if (!panelBox || panelBox.width > 350) throw new Error("Mobile control panel exceeds the viewport");

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
  console.log(`Published dashboard smoke test passed: ${page.url()}`);
} finally {
  await browser.close();
}
