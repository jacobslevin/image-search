const fs = require("fs");
const path = require("path");

const PROMPT = `Look at this piece of furniture. Classify its overall silhouette character using this exact decision tree:

Step 1 — Check for straight-line tapering:
Does the form clearly narrow or widen in a straight line in any dimension?
Important: ignore perspective foreshortening. A boxy sofa photographed from a three-quarter angle will appear to narrow due to the camera angle — this is not tapering. Only classify as Tapered if the narrowing is a deliberate design feature that would still be visible in a straight-on front elevation view. Ask yourself: is one end of the form genuinely designed to be narrower, or does it just appear that way because of the camera angle?

Is the back genuinely narrower than the seat as a design feature, not just due to camera angle?
Do the arms genuinely angle or taper front to back as a design feature, not just due to perspective?

If YES to either -> go to Step 2.
If NO -> go to Step 3.

Step 2 — Tapering detected. Check for major curves only:
Do not evaluate corner radius here. Only ask whether entire structural components follow a curved path:

Does the back edge curve as a whole rather than run in a straight line?
Do the arms curve as a whole form — the entire arm sweeps or bends, not just radiused edges?
Is the overall body or shell curved?

If YES -> Soft / rounded. Major curves in whole components override tapering.
If NO -> Tapered. Radiused corners or softened edges on otherwise straight components do not override tapering.

Step 3 — No tapering. Check for curves:
Apply the squint test to any rounded corners — if you squinted from across the room would the corners still look rounded?

Major curves present (curved back, curved arms, curved body) -> Soft / rounded
Corners that pass the squint test -> Soft / rounded
No curves, or only subtle edge softening that fails the squint test -> Structured / boxy

Return JSON with reasoning and classification:
{
  reasoning: 'brief explanation of which step applied and what you observed',
  shape_character: 'Soft / rounded' or 'Tapered' or 'Structured / boxy'
}`;

const REUSED_RESULTS = new Map([
  [
    "https://content.designerpages.com/assets/81468425/AxialModularSofa0.jpg",
    {
      shape_character: "Structured / boxy",
      reasoning:
        "Step 1: no deliberate tapering; back and arms stay parallel in a straight-on reading. Step 3: straight rectangular volumes; corners only gently softened and fail the squint test.",
    },
  ],
  [
    "https://content.designerpages.com/assets/78341096/pf1_studio_gy_puff-puff-studio-sofa-edwards-light-grey.jpg",
    {
      shape_character: "Soft / rounded",
      reasoning:
        "Step 1: no clear tapering. Step 3: back and arms are major rounded components, and the roundness still reads from a distance.",
    },
  ],
  [
    "https://content.designerpages.com/assets/79178919/jsiteekancomp00001.jpg",
    {
      shape_character: "Structured / boxy",
      reasoning:
        "Step 1: no straight-line tapering; back, seat, and arms hold consistent width. Step 3: flat planes with only slight edge softening that fails the squint test.",
    },
  ],
  [
    "https://content.designerpages.com/assets/81940989/FloteSofaThreeSeat01.jpg",
    {
      shape_character: "Soft / rounded",
      reasoning:
        "Step 3: no clear tapering. Major curves in the arms/body and heavily rounded corners dominate the silhouette.",
    },
  ],
  [
    "https://content.designerpages.com/assets/82415261/627006600x600.jpg",
    {
      shape_character: "Tapered",
      reasoning:
        "Step 1: clear deliberate straight-line tapering in back and arms. Step 2: no major sweeping curves, only minor softened edges.",
    },
  ],
  [
    "https://content.designerpages.com/assets/79131709/621d4f4ed0f0fadd0c0bfa73SachetLoungeProduct01.jpg",
    {
      shape_character: "Tapered",
      reasoning:
        "Step 1: arms and back visibly taper as a design feature, not just perspective. Step 2: overall paths remain straight/angular with only slight edge softening.",
    },
  ],
  [
    "https://content.designerpages.com/assets/70745111/087b2706-c7af-41d4-884d-d6cbb544be70.png",
    {
      shape_character: "Tapered",
      reasoning:
        "Step 1: seat, back, and arms taper in straight lines as designed. Step 2: curved edges exist, but the overall structural paths are still straight and tapering rather than sweeping curves.",
    },
  ],
]);

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").pop() || url);
  } catch {
    return String(url || "");
  }
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
    text.match(/"shape_character"\s*:\s*"([^"]+)"/i) ||
    text.match(/shape_character\s*:\s*"([^"]+)"/i) ||
    text.match(/shape_character\s*:\s*'([^']+)'/i);
  const reasoningMatch =
    text.match(/"reasoning"\s*:\s*"([\s\S]*?)"\s*,\s*"shape_character"/i) ||
    text.match(/reasoning\s*:\s*"([\s\S]*?)"\s*,\s*shape_character/i) ||
    text.match(/reasoning\s*:\s*'([\s\S]*?)'\s*,\s*shape_character/i);
  if (!shapeMatch) {
    throw new Error(`Could not parse JSON response: ${text}`);
  }
  return {
    reasoning: (reasoningMatch ? reasoningMatch[1] : "").replace(/\\"/g, '"').trim(),
    shape_character: shapeMatch[1].trim(),
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

async function classifyImage(imageUrl, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
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
    reasoning: parsed.reasoning || "",
    shape_character: parsed.shape_character || "",
    raw_response: raw,
  };
}

function loadHeroRows() {
  const index = JSON.parse(fs.readFileSync("data/image-index.json", "utf8"));
  const products = index.products || [];
  const images = index.images || [];
  const byProduct = new Map();
  for (const image of images) {
    if (!image || !image.product_id || !image.image_url) continue;
    if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
    byProduct.get(image.product_id).push(image);
  }
  const rows = [];
  for (const product of products) {
    if (!product || !product.product_id) continue;
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
      product_name: product.product_name,
      hero_url: hero.image_url,
      filename: filenameFromUrl(hero.image_url),
    });
  }
  return rows;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const heroRows = loadHeroRows();
  const results = [];
  let reusedCount = 0;
  let freshCount = 0;
  const freshTotal = heroRows.filter((row) => !REUSED_RESULTS.has(row.hero_url)).length;

  for (const row of heroRows) {
    if (REUSED_RESULTS.has(row.hero_url)) {
      reusedCount += 1;
      results.push({ ...row, reused: true, ...REUSED_RESULTS.get(row.hero_url) });
      continue;
    }
    const classified = await classifyImage(row.hero_url, apiKey);
    freshCount += 1;
    console.error(`classified ${freshCount}/${freshTotal}: ${row.product_name}`);
    results.push({ ...row, reused: false, ...classified });
  }

  const counts = results.reduce((acc, row) => {
    acc[row.shape_character] = (acc[row.shape_character] || 0) + 1;
    return acc;
  }, {});

  const output = {
    generated_at: new Date().toISOString(),
    prompt_version: "shape_character_decision_tree_perspective_guard_v1",
    product_count: heroRows.length,
    reused_count: reusedCount,
    fresh_count: freshCount,
    counts,
    results,
  };

  fs.writeFileSync(path.join("data", "hero-shape-character-results.json"), JSON.stringify(output, null, 2));

  console.log(JSON.stringify({
    product_count: heroRows.length,
    reused_count: reusedCount,
    fresh_count: freshCount,
    counts,
    sample: results.slice(0, 12),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
