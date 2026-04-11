#!/usr/bin/env node
import path from "node:path";

import { normalizeCatalog } from "../src/catalog.js";
import { DATA_DIR, writeJson } from "../src/utils.js";

const args = process.argv.slice(2);
const sourceArgIndex = args.indexOf("--source");
const csvDirectory = sourceArgIndex >= 0
  ? path.resolve(args[sourceArgIndex + 1])
  : path.resolve("Product Data with Images");
const outputPath = path.join(DATA_DIR, "normalized-catalog.json");

const catalog = await normalizeCatalog(csvDirectory);
await writeJson(outputPath, catalog);

console.log(`Normalized ${catalog.totals.products} products and ${catalog.totals.images} image records.`);
console.log(`Wrote ${outputPath}`);
