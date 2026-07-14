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

if (!html.includes('type="module" src="js/dashboard.mjs"')) {
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
  "warnings",
];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`Missing required dashboard element: #${id}`);
  }
}

if (!html.includes("municipios 2020-2025") || !html.includes("2020-2024")) {
  throw new Error("Population periods are not explicitly documented in the dashboard");
}

for (const feature of ["writeState", "renderCompare", "qualityBlock"]) {
  if (!dashboard.includes(`function ${feature}`)) {
    throw new Error(`Missing dashboard feature: ${feature}`);
  }
}

console.log("Dashboard module and required controls are valid");
