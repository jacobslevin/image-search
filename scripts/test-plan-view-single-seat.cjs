const fs = require("fs");
const path = require("path");

const SAMPLE_SIZE = 25;
const DEFAULT_SEED = 20260414;
const MODEL = "gpt-4.1";

const PROMPT = `Look at this single-seat lounge chair. Imagine you are viewing it from directly above in plan view — a bird's eye view looking straight down.

Classify the plan-view footprint into exactly ONE of these categories:

- Square / rectangular — width at the back of the plan is roughly equal to width at the front. The sides run parallel front to back.
- Trapezoidal — width at the back is narrower than the front. The chair widens toward the front. Think of a tapered chair where the arms splay outward from back to front.
- Reverse trapezoidal — width at the back is wider than the front. The chair widens toward the back.
- Round / semicircular — the back edge curves rather than running as a straight line across. There is no meaningful back-width vs front-width comparison because the back is not a straight edge. Barrel chairs, tub chairs, and wrap forms fit here.

Important notes:
- Only classify single-seat lounge chair forms.
- Reason from the three-dimensional form visible in the photo, not from the camera angle itself.
- Use the true body shape, not perspective foreshortening.
- If you cannot determine the footprint with reasonable confidence from the image, return unknown.

Return JSON only:
{
  reasoning: 'brief explanation of what cues you used to determine the footprint',
  plan_shape: 'Square / rectangular' or 'Trapezoidal' or 'Reverse trapezoidal' or 'Round / semicircular' or 'unknown'
}`;

const MULTI_SEAT_NAME_MARKERS = [
  "sofa",
  "loveseat",
  "settee",
  "two-seat",
  "two seat",
  "three-seat",
  "three seat",
  "3-seat",
  "3 seat",
  "bench",
  "modular",
  "sectional",
];

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").pop() || url);
  } catch {
    return String(url || "");
  }
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, seed) {
  const rand = mulberry32(seed);
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function extractText(payload) {
  if (!payload) return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }
  return parts.join("\n").trim();
}

function fallbackParse(raw) {
  const text = String(raw || "");
  const shapeMatch =
    text.match(/"plan_shape"\s*:\s*"([^"]+)"/i) ||
    text.match(/plan_shape\s*:\s*"([^"]+)"/i) ||
    text.match(/plan_shape\s*:\s*'([^']+)'/i);
  const reasoningMatch =
    text.match(/"reasoning"\s*:\s*"([\s\S]*?)"\s*,\s*"plan_shape"/i) ||
    text.match(/reasoning\s*:\s*"([\s\S]*?)"\s*,\s*plan_shape/i) ||
    text.match(/reasoning\s*:\s*'([\s\S]*?)'\s*,\s*plan_shape/i);
  if (!shapeMatch) {
    throw new Error(`Could not parse JSON response: ${text}`);
  }
  return {
    reasoning: (reasoningMatch ? reasoningMatch[1] : "").replace(/\\"/g, '"').trim(),
    plan_shape: shapeMatch[1].trim(),
  };
}

function repairJson(raw) {
  const trimmed = String(raw || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return fallbackParse(trimmed);
  }
  const candidate = trimmed
    .slice(start, end + 1)
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'/g, '"');
  try {
    return JSON.parse(candidate);
  } catch {
    return fallbackParse(trimmed);
  }
}

function normalizePlanShape(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "unknown";
  if (text === "unknown") return "unknown";
  if (text.includes("round") || text.includes("semicircular")) return "Round / semicircular";
  if (text.includes("reverse trapezoidal")) return "Reverse trapezoidal";
  if (text.includes("trapezoidal")) return "Trapezoidal";
  if (text.includes("square") || text.includes("rectangular")) return "Square / rectangular";
  return String(value || "").trim();
}

async function classifyImage(imageUrl, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: PROMPT },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
      max_output_tokens: 300,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  const raw = extractText(payload);
  const parsed = repairJson(raw);
  return {
    reasoning: String(parsed.reasoning || "").trim(),
    plan_shape: normalizePlanShape(parsed.plan_shape),
    raw_response: raw,
  };
}

function isSingleSeatProduct(productName) {
  const name = String(productName || "").toLowerCase();
  return !MULTI_SEAT_NAME_MARKERS.some((marker) => name.includes(marker));
}

function loadSingleSeatHeroes() {
  const index = JSON.parse(fs.readFileSync("data/image-index.json", "utf8"));
  const products = index.products || [];
  const images = (index.images || []).filter((image) => image && image.seating_type === "lounge_chair");
  const byProduct = new Map();
  for (const image of images) {
    if (!image.product_id || !image.image_url) continue;
    if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
    byProduct.get(image.product_id).push(image);
  }

  const rows = [];
  for (const product of products) {
    if (!product || !product.product_id || !isSingleSeatProduct(product.product_name)) continue;
    const productImages = byProduct.get(product.product_id);
    if (!productImages || !productImages.length) continue;

    const imageUrls = Array.isArray(product.image_urls) ? product.image_urls : [];
    let hero = null;
    for (const url of imageUrls) {
      const hit = productImages.find((image) => image.image_url === url);
      if (hit) {
        hero = hit;
        break;
      }
    }
    if (!hero) hero = productImages[0];

    rows.push({
      product_id: product.product_id,
      product_name: product.product_name || product.name || "",
      hero_url: hero.image_url,
      filename: filenameFromUrl(hero.image_url),
    });
  }
  return rows;
}

function flagForReview(row) {
  const text = `${row.reasoning} ${row.plan_shape}`.toLowerCase();
  if (row.plan_shape === "unknown") return "unknown";
  const markers = [
    "uncertain",
    "hard to tell",
    "difficult",
    "not fully visible",
    "cannot determine",
    "can't determine",
    "likely",
    "appears",
    "seems",
    "probably",
    "suggests",
    "may be",
    "roughly",
  ];
  return markers.find((marker) => text.includes(marker)) || "";
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const seed = Number(process.env.PLAN_VIEW_SEED || DEFAULT_SEED);
  const heroRows = loadSingleSeatHeroes();
  if (heroRows.length < SAMPLE_SIZE) {
    throw new Error(`Only found ${heroRows.length} single-seat lounge-chair heroes; need ${SAMPLE_SIZE}`);
  }

  const selected = shuffle(heroRows, seed).slice(0, SAMPLE_SIZE);
  const results = [];

  for (let i = 0; i < selected.length; i += 1) {
    const row = selected[i];
    const classified = await classifyImage(row.hero_url, apiKey);
    const result = { ...row, ...classified };
    result.review_flag = flagForReview(result);
    results.push(result);
    console.error(`classified ${i + 1}/${selected.length}: ${row.product_name}`);
  }

  const distribution = {};
  let unknownCount = 0;
  for (const row of results) {
    distribution[row.plan_shape] = (distribution[row.plan_shape] || 0) + 1;
    if (row.plan_shape === "unknown") unknownCount += 1;
  }

  const output = {
    generated_at: new Date().toISOString(),
    prompt_version: "single_seat_plan_shape_parallel_vs_trapezoid_v1",
    model: MODEL,
    seed,
    sample_size: SAMPLE_SIZE,
    population_size: heroRows.length,
    excluded_multi_seat_markers: MULTI_SEAT_NAME_MARKERS,
    distribution,
    unknown_count: unknownCount,
    review_cases: results.filter((row) => row.review_flag),
    results,
  };

  fs.writeFileSync(
    path.join("data", "plan-view-single-seat-results.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        generated_at: output.generated_at,
        seed,
        sample_size: SAMPLE_SIZE,
        population_size: heroRows.length,
        distribution,
        unknown_count: unknownCount,
        review_case_count: output.review_cases.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
