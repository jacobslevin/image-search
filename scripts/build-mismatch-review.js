#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT_DIR, "data", "image-index.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "tmp", "mismatch-review.html");

const CATEGORY_RULES = [
  {
    categories: ["Lounge Seating"],
    allowed: new Set(["lounge_chair", "sofa", "outdoor_lounge", "ottoman", "bench"])
  },
  {
    categories: ["Guest Seating", "Multi-use Seating"],
    allowed: new Set(["guest_chair", "stacking_nesting", "folding"])
  },
  {
    categories: ["Task Seating", "Office Chairs", "Executive Seating"],
    allowed: new Set(["task_collab_chair"])
  },
  {
    categories: ["Stools"],
    allowed: new Set(["stool"])
  },
  {
    categories: ["Benches"],
    allowed: new Set(["bench"])
  },
  {
    categories: ["Ottomans"],
    allowed: new Set(["ottoman"])
  },
  {
    categories: ["Outdoor Seating"],
    allowed: new Set(["lounge_chair", "guest_chair", "bench", "ottoman", "outdoor_lounge"])
  }
];

const CATEGORY_LOOKUP = new Map(
  CATEGORY_RULES.flatMap((rule) => rule.categories.map((category) => [category, rule.allowed]))
);

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPrimaryCategory(record = {}) {
  const bLevel = Array.isArray(record.b_level) ? record.b_level.map((value) => normalizeWhitespace(value)).filter(Boolean) : [];
  if (bLevel.length) {
    return bLevel[0];
  }
  const aLevel = Array.isArray(record.a_level) ? record.a_level.map((value) => normalizeWhitespace(value)).filter(Boolean) : [];
  return aLevel[0] || "";
}

function getSeatingType(record = {}) {
  return normalizeWhitespace(record.stage1?.seating_type || record.seating_type || "");
}

function createGalleryCard(record = {}, comparisonLabel = "") {
  const productName = escapeHtml(record.product_name || record.name || "");
  const imageId = escapeHtml(record.image_id || "");
  const imageUrl = escapeHtml(record.image_url || "");
  const bLevel = escapeHtml((record.b_level || []).join(" | "));
  const seatingType = escapeHtml(getSeatingType(record));
  const caption = comparisonLabel || `DP says: ${bLevel || "(none)"} | OpenAI says: ${seatingType || "(none)"}`;

  return `
    <article class="card">
      <a href="${imageUrl}" target="_blank" rel="noreferrer">
        <img src="${imageUrl}" alt="${productName}" loading="lazy">
      </a>
      <div class="meta">
        <div class="product">${productName}</div>
        <div class="comparison">${escapeHtml(caption)}</div>
        <div class="image-id">${imageId}</div>
      </div>
    </article>
  `;
}

function renderSection(title = "", subtitle = "", records = [], mode = "mismatch") {
  const cards = records.map((record) => {
    const dpCategory = getPrimaryCategory(record);
    const seatingType = getSeatingType(record);
    const comparison = mode === "mismatch"
      ? `DP says: ${dpCategory || "(none)"} | OpenAI says: ${seatingType || "(none)"}`
      : `DP says: ${dpCategory || "(none)"} | OpenAI says: ${seatingType || "(none)"}`;
    return createGalleryCard(record, comparison);
  }).join("\n");

  return `
    <section class="group">
      <header class="group-header">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </header>
      <div class="grid">
        ${cards}
      </div>
    </section>
  `;
}

async function main() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, "utf8"));
  const scanned = (index.images || []).filter((record) =>
    String(record.stage_0_result || "").trim() === "product" && record.excluded !== true
  );

  const mismatchGroups = new Map();
  const unmappedGroups = new Map();

  for (const record of scanned) {
    const primaryCategory = getPrimaryCategory(record);
    const seatingType = getSeatingType(record);

    if (!primaryCategory || !CATEGORY_LOOKUP.has(primaryCategory)) {
      const group = unmappedGroups.get(primaryCategory || "(missing category)") || [];
      group.push(record);
      unmappedGroups.set(primaryCategory || "(missing category)", group);
      continue;
    }

    if (!seatingType || seatingType === "other_seating") {
      continue;
    }

    const allowed = CATEGORY_LOOKUP.get(primaryCategory);
    if (allowed.has(seatingType)) {
      continue;
    }

    const pair = `${primaryCategory} \u2192 ${seatingType}`;
    const group = mismatchGroups.get(pair) || [];
    group.push(record);
    mismatchGroups.set(pair, group);
  }

  const sortedMismatchGroups = [...mismatchGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const sortedUnmappedGroups = [...unmappedGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const mismatchSections = sortedMismatchGroups.map(([pair, records]) =>
    renderSection(pair, `${records.length} image${records.length === 1 ? "" : "s"}`, records, "mismatch")
  ).join("\n");

  const unmappedSections = sortedUnmappedGroups.map(([category, records]) =>
    renderSection(category, `${records.length} image${records.length === 1 ? "" : "s"}`, records, "unmapped")
  ).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mismatch Review</title>
  <style>
    :root {
      --bg: #f5f1ea;
      --panel: #fffdf9;
      --ink: #22201c;
      --muted: #6a655d;
      --line: #d7cdbf;
      --accent: #7f3f00;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background: linear-gradient(180deg, #f7f2eb 0%, #f0e7da 100%);
    }
    header.page {
      padding: 32px 24px 20px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 253, 249, 0.85);
      position: sticky;
      top: 0;
      backdrop-filter: blur(8px);
      z-index: 10;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 32px;
      line-height: 1.1;
    }
    p.lede {
      margin: 0;
      color: var(--muted);
      max-width: 900px;
    }
    main {
      padding: 24px;
      display: grid;
      gap: 32px;
    }
    section.group {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 8px 24px rgba(34, 32, 28, 0.06);
    }
    .group-header {
      margin-bottom: 16px;
    }
    .group-header h2 {
      margin: 0 0 4px;
      font-size: 24px;
      color: var(--accent);
    }
    .group-header p {
      margin: 0;
      color: var(--muted);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      background: #fff;
    }
    .card a {
      display: block;
      background: #e9e0d2;
    }
    .card img {
      width: 100%;
      height: 220px;
      object-fit: cover;
      display: block;
    }
    .meta {
      padding: 12px;
      display: grid;
      gap: 6px;
    }
    .product {
      font-weight: 700;
      font-size: 16px;
    }
    .comparison,
    .image-id {
      font-size: 13px;
      line-height: 1.35;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <header class="page">
    <h1>Mismatch Review</h1>
    <p class="lede">Data-only review built from <code>${escapeHtml(INDEX_PATH)}</code>. Mismatches are grouped by DP category to Stage 1 seating type. Unmapped records are grouped by DP category.</p>
  </header>
  <main>
    <section class="group">
      <header class="group-header">
        <h2>Part 1: Mismatches</h2>
        <p>${sortedMismatchGroups.reduce((sum, [, records]) => sum + records.length, 0)} images across ${sortedMismatchGroups.length} mismatch pair${sortedMismatchGroups.length === 1 ? "" : "s"}.</p>
      </header>
      ${mismatchSections || "<p>No mismatches found.</p>"}
    </section>
    <section class="group">
      <header class="group-header">
        <h2>Part 2: Unmapped DP Categories</h2>
        <p>${sortedUnmappedGroups.reduce((sum, [, records]) => sum + records.length, 0)} images across ${sortedUnmappedGroups.length} unmapped categor${sortedUnmappedGroups.length === 1 ? "y" : "ies"}.</p>
      </header>
      ${unmappedSections || "<p>No unmapped categories found.</p>"}
    </section>
  </main>
</body>
</html>`;

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, html);
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
