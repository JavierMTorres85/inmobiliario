import fs from "node:fs";

const source = process.argv[2] || "index.html";
const html = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const inlineScripts = [...html.matchAll(scriptPattern)]
  .map((match) => match[1].trim())
  .filter(Boolean);

if (inlineScripts.length !== 0) {
  throw new Error(`Expected dashboard logic in a module, found ${inlineScripts.length} inline scripts`);
}

if (!html.includes('type="module" src="js/dashboard.mjs')) {
  throw new Error("Missing js/dashboard.mjs module reference");
}

const dashboard = fs.readFileSync("js/dashboard.mjs", "utf8");

const requiredIds = [
  "map",
  "tpob",
  "tpre",
  "tren",
  "tesf",
  "tten",
  "info",
  "compare",
  "share",
  "zoneSearch",
  "togglePanel",
  "metricSelect",
  "warnings",
  "mapLegend",
  "view2d",
  "view3d",
  "timeSlider",
  "timePlay",
  "timeReset",
];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`Missing required dashboard element: #${id}`);
  }
}

if (!html.includes("municipios 2020-2025") || !html.includes("2020-2024")) {
  throw new Error("Population periods are not explicitly documented in the dashboard");
}

for (const feature of ["writeState", "renderCompare", "completeDataBlock", "historyBlock", "annualPct", "focusZone", "exportComparison", "comparabilityBlock", "closeMobilePanel"]) {
  if (!dashboard.includes(`function ${feature}`)) {
    throw new Error(`Missing dashboard feature: ${feature}`);
  }
}

if (html.includes("Fuente y metodología") || dashboard.includes("Fuente y metodología")) {
  throw new Error("The user interface must never expose the removed methodology panel");
}

for (const feature of ["activeLevel", "legendBins", "fitLegendRange", "refreshMapVisuals"]) {
  if (!dashboard.includes(`function ${feature}`)) throw new Error(`Missing phase 4 map feature: ${feature}`);
}

for (const feature of ["populationHeight", "updateViewMode"]) {
  if (!dashboard.includes(`function ${feature}`)) throw new Error(`Missing phase 5 3D feature: ${feature}`);
}

if (!dashboard.includes("type:'fill-extrusion'")) throw new Error("3D population extrusion layer is missing");

if (!dashboard.includes("Math.ceil(values.length*group/5)") || !dashboard.includes("filter(bin=>bin.count>0)")) {
  throw new Error("Legend ranges must be populated quantile groups");
}

if (!dashboard.includes("['case',['boolean',['get','rangeMatch'],false],.96,0]") ||
    !dashboard.includes("['case',['boolean',['get','rangeMatch'],false],1,0]")) {
  throw new Error("Selected legend range must hide non-matching polygons");
}

for (const feature of ["observedSeries", "observedPoint", "availableYears", "setTimeYear", "toggleTimeline"]) {
  if (!dashboard.includes(`function ${feature}`)) throw new Error(`Missing phase 6 timeline feature: ${feature}`);
}

if (!html.includes("data-legend-bin") && !dashboard.includes("data-legend-bin")) {
  throw new Error("Interactive legend ranges are missing");
}

for (const [path, expected] of [
  ["data/geo/municipalities.geojson", 179],
  ["data/geo/districts.geojson", 21],
  ["data/geo/neighborhoods.geojson", 131],
]) {
  const collection = JSON.parse(fs.readFileSync(path, "utf8"));
  if (collection.type !== "FeatureCollection" || collection.features.length !== expected) {
    throw new Error(`${path} must contain ${expected} local features`);
  }
}

if (dashboard.includes("public.opendatasoft.com") || dashboard.includes("services.arcgis.com")) {
  throw new Error("Dashboard still depends on a remote boundary API at runtime");
}

if (!html.includes("maplibre-gl@5.24.0") || !dashboard.includes("new maplibregl.Map")) {
  throw new Error("MapLibre GL JS is not configured as the map engine");
}

if (html.includes("leaflet@") || /\bL\./.test(dashboard)) {
  throw new Error("Legacy Leaflet runtime code remains in the dashboard");
}

if (!dashboard.includes("if(raw==null||raw==='')return fallback")) {
  throw new Error("Missing URL-state fallback for absent map coordinates");
}

if (dashboard.includes("ZAGG") || dashboard.includes("level()==='zona'")) {
  throw new Error("Population overview must not paint municipal polygons with macro-zone aggregates");
}

if (!html.includes('id="bPct" class="on"') || !dashboard.includes("queryUnit==='abs'?'abs':'pct'")) {
  throw new Error("Annualized percentage must be the default population view");
}

console.log("Dashboard module and required controls are valid");
