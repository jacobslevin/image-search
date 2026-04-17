import fs from "node:fs";

const PROMPT = `Classify the image as exactly one of:
- scene: no single product is the clear subject. Reject.
- product_detail: a product is identifiable but less than approximately 75% of the full product is visible. Common examples: close-ups of fabric or stitching, a single arm or leg, a headrest or back detail, or any shot where the base or overall silhouette is not visible. Reject.
- product: approximately 75% or more of the product is visible, including the base and overall silhouette. Pass through to stages 1-3.

Rules:
- First decide whether a single product is the clear subject.
- If no single product is the clear subject, return scene.
- If a single product is the clear subject but less than approximately 75% of the full product is visible, return product_detail.
- Return product only when approximately 75% or more of the full product is visible and the base plus overall silhouette can be judged.
- Close-up crops of upholstery, stitching, a single arm, a single leg, a headrest, back detail, or any partial view without the full silhouette should be product_detail even on a neutral background.
- A full product on a neutral background is product.
- A full product in a real room can still be product if the single product is clearly the subject and approximately 75% or more of it is visible.
- A room scene, lifestyle composition, collage, or environment-first image is scene.

Return JSON only.`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    result: {
      type: "string",
      enum: ["scene", "product_detail", "product"]
    }
  },
  required: ["result"]
};

const data = JSON.parse(fs.readFileSync("data/normalized-catalog.full-backup.json", "utf8"));
const targets = new Set(["Superkool", "Focus - Task Chair"]);
const products = data.products.filter((product) => targets.has(product.name));

async function classifyImage(image) {
  const catalogContext = `Catalog context: name="${image.name}", brand="${image.brand}", categories="${[
    ...(image.a_level || []),
    ...(image.b_level || []),
    ...(image.c_level || [])
  ].join(" | ")}".`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.VISION_MODEL || "gpt-4.1-nano",
      input: [
        {
          role: "system",
          content: [
            { type: "input_text", text: PROMPT }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: catalogContext },
            { type: "input_image", image_url: image.image_url, detail: "low" }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "stage0_scene_filter",
          strict: true,
          schema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text ||
    payload.output?.flatMap((entry) => entry.content || []).find((entry) => entry.type === "output_text")?.text ||
    payload.output?.[0]?.content?.[0]?.text ||
    "";
  const parsed = JSON.parse(String(outputText || "{}"));
  return parsed.result;
}

const results = [];

for (const product of products) {
  for (const imageUrl of product.image_urls || []) {
    const image = {
      name: product.name,
      brand: product.brand,
      image_url: imageUrl,
      a_level: product.a_level || [],
      b_level: product.b_level || [],
      c_level: product.c_level || []
    };

    try {
      const result = await classifyImage(image);
      const row = { product_name: product.name, image_url: imageUrl, result };
      results.push(row);
      console.log(JSON.stringify(row));
    } catch (error) {
      const row = { product_name: product.name, image_url: imageUrl, error: error.message || String(error) };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
}

console.log(`FINAL_RESULTS=${JSON.stringify(results)}`);
