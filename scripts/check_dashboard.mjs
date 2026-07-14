import fs from "node:fs";

const source = process.argv[2] || "index.html";
const html = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const inlineScripts = [...html.matchAll(scriptPattern)]
  .map((match) => match[1].trim())
  .filter(Boolean);

if (inlineScripts.length !== 1) {
  throw new Error(`Expected exactly one inline dashboard script, found ${inlineScripts.length}`);
}

new Function(inlineScripts[0]);

const requiredIds = [
  "map",
  "tpob",
  "tpre",
  "tren",
  "tesf",
  "tten",
  "info",
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

console.log("Dashboard JavaScript and required controls are valid");
