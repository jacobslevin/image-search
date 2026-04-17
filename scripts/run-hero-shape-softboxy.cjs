const fs = require("fs");
const path = require("path");

const PROMPT = `Look at this piece of furniture. Classify its overall silhouette character as either Soft / tapered or Boxy using these exact rules:

Classify as Soft / tapered if ANY of these are true:
- The back edge curves rather than running in a straight horizontal line
- The arms curve as a whole form — the entire arm sweeps or bends, not just slightly softened edges
- The overall body or shell is curved
- The form clearly narrows or widens in a straight line in any dimension — back narrower than seat from the front, or arms that angle/taper front to back as a deliberate design feature (not just camera perspective)
- The corners read closer to a quarter circle arc than a 90 degree angle — meaning the corner point has dissolved into a smooth generous curve rather than remaining a visible corner

Classify as Boxy if ALL of these are true:
- The back edge is a straight line
- The arms are straight (horizontal, angled, or tapered only due to perspective — not a design feature)
- The overall body is rectilinear with consistent width and depth
- Corners read closer to a 90 degree angle than a quarter circle arc — a visible corner point remains even if slightly softened

Important notes:
- Ignore perspective foreshortening. A rectilinear sofa photographed at an angle will appear to narrow due to the camera — this is not tapering. Only classify tapering as a design feature if it would still be visible in a straight-on front elevation.
- Corner radius only counts toward Soft / tapered if the corner has dissolved into a smooth arc. A subtly softened corner that still reads as a corner is Boxy.
- Evaluate only major structural components — back panel, arms, overall body. Do not evaluate cushion edges, upholstery seams, or accessory details.

Return JSON with reasoning and classification:
{
  reasoning: 'brief explanation of what triggered the classification',
  shape_character: 'Soft / tapered' or 'Boxy'
}`;

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
  let done = 0;
  for (const row of heroRows) {
    const classified = await classifyImage(row.hero_url, apiKey);
    done += 1;
    console.error(`classified ${done}/${heroRows.length}: ${row.product_name}`);
    results.push({ ...row, ...classified });
  }

  const counts = results.reduce((acc, row) => {
    acc[row.shape_character] = (acc[row.shape_character] || 0) + 1;
    return acc;
  }, {});

  const output = {
    generated_at: new Date().toISOString(),
    prompt_version: "shape_character_soft_tapered_vs_boxy_v1",
    product_count: heroRows.length,
    counts,
    results,
  };

  fs.writeFileSync(
    path.join("data", "hero-shape-softboxy-results.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        product_count: heroRows.length,
        counts,
        sample: results.slice(0, 12),
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
