#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const SAMPLE_PRODUCTS = 25;
const MODEL = "gpt-4.1-nano";
const DETAIL = "low";
const selectionPath = path.resolve("data/catalog-image-selection-record.json");
const indexPath = path.resolve("data/image-index.json");
const progressPath = path.resolve("data/scene-filter-progress.json");
const args = process.argv.slice(2);
const startArgIndex = args.indexOf("--start");
const maxProductsArgIndex = args.indexOf("--max-products");
const progressStartArgIndex = args.indexOf("--progress-start-index");
const progressTotalArgIndex = args.indexOf("--progress-total-products");
const resumeCompletedArgIndex = args.indexOf("--resume-completed");
const resumeImagesCheckedArgIndex = args.indexOf("--resume-images-checked");
const resumeProductPhotosArgIndex = args.indexOf("--resume-product-photos");
const resumeScenePhotosArgIndex = args.indexOf("--resume-scene-photos");
const resumeInputTokensArgIndex = args.indexOf("--resume-input-tokens");
const resumeOutputTokensArgIndex = args.indexOf("--resume-output-tokens");
const resumeTotalTokensArgIndex = args.indexOf("--resume-total-tokens");
const productIdsFileArgIndex = args.indexOf("--product-ids-file");
const progressLabelArgIndex = args.indexOf("--progress-label");
const startIndex = startArgIndex >= 0 ? Number(args[startArgIndex + 1] || 0) : 0;
const maxProducts = maxProductsArgIndex >= 0 ? Number(args[maxProductsArgIndex + 1] || 0) : SAMPLE_PRODUCTS;
const progressStartIndex = progressStartArgIndex >= 0 ? Number(args[progressStartArgIndex + 1] || startIndex) : startIndex;
const progressTotalProducts = progressTotalArgIndex >= 0 ? Number(args[progressTotalArgIndex + 1] || maxProducts) : maxProducts;
const resumeCompleted = resumeCompletedArgIndex >= 0 ? Number(args[resumeCompletedArgIndex + 1] || 0) : 0;
const resumeImagesChecked = resumeImagesCheckedArgIndex >= 0 ? Number(args[resumeImagesCheckedArgIndex + 1] || 0) : 0;
const resumeProductPhotos = resumeProductPhotosArgIndex >= 0 ? Number(args[resumeProductPhotosArgIndex + 1] || 0) : 0;
const resumeScenePhotos = resumeScenePhotosArgIndex >= 0 ? Number(args[resumeScenePhotosArgIndex + 1] || 0) : 0;
const resumeInputTokens = resumeInputTokensArgIndex >= 0 ? Number(args[resumeInputTokensArgIndex + 1] || 0) : 0;
const resumeOutputTokens = resumeOutputTokensArgIndex >= 0 ? Number(args[resumeOutputTokensArgIndex + 1] || 0) : 0;
const resumeTotalTokens = resumeTotalTokensArgIndex >= 0 ? Number(args[resumeTotalTokensArgIndex + 1] || 0) : 0;
const productIdsFile = productIdsFileArgIndex >= 0 ? String(args[productIdsFileArgIndex + 1] || "").trim() : "";
const progressLabel = progressLabelArgIndex >= 0 ? String(args[progressLabelArgIndex + 1] || "").trim() : "";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

function buildPrompt() {
  return `You are a furniture image triage classifier.

Classify each image as exactly one of:
- "product": the primary furniture item is shown as a product photo, cutout, white-background shot, or otherwise product-focused shot with little or no environmental context.
- "scene": the image is a lifestyle, room, installation, or environmental photo where surrounding space, other furniture, architecture, or decor are materially present.

Rules:
- Return JSON only.
- Choose exactly one label.
- If the image shows the product placed in a room or environment with meaningful visible context, label it "scene".
- If the image is tightly product-focused even with a minimal neutral background, label it "product".`;
}

function canonicalizeImageUrl(value = "") {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return input.replace(/[#?].*$/, "").replace(/\/$/, "");
  }
}

async function classifyImage(imageUrl) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: buildPrompt()
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: imageUrl,
              detail: DETAIL
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scene_filter",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              result: {
                type: "string",
                enum: ["product", "scene"]
              }
            },
            required: ["result"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.[0]?.content?.[0]?.text;
  const parsed = JSON.parse(String(outputText || ""));
  if (parsed?.result !== "product" && parsed?.result !== "scene") {
    throw new Error(`Unexpected classification result for ${imageUrl}`);
  }
  return {
    result: parsed.result,
    usage: {
      input_tokens: Math.max(0, Number(payload.usage?.input_tokens) || 0),
      output_tokens: Math.max(0, Number(payload.usage?.output_tokens) || 0),
      total_tokens: Math.max(0, Number(payload.usage?.total_tokens) || 0)
    }
  };
}

const selection = JSON.parse(await fs.readFile(selectionPath, "utf8"));
const selectedProductIds = productIdsFile
  ? new Set(JSON.parse(await fs.readFile(path.resolve(productIdsFile), "utf8")).filter(Boolean))
  : null;
const baseProducts = selectedProductIds
  ? (selection.products || []).filter((product) => selectedProductIds.has(product.product_id))
  : (selection.products || []);
const products = baseProducts.slice(startIndex, startIndex + maxProducts);
const results = [];
let productPhotos = resumeProductPhotos;
let scenePhotos = resumeScenePhotos;
let inputTokens = resumeInputTokens;
let outputTokens = resumeOutputTokens;
let totalTokens = resumeTotalTokens;
const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
const resultsByProductId = new Map();
const recentLog = [];

function appendLog(entry) {
  recentLog.unshift({
    status: entry.status === "failed" ? "failed" : "done",
    product_id: entry.product_id || "",
    image_url: entry.image_url || "",
    result: entry.result || "",
    input_tokens: Math.max(0, Number(entry.input_tokens) || 0),
    output_tokens: Math.max(0, Number(entry.output_tokens) || 0),
    total_tokens: Math.max(0, Number(entry.total_tokens) || 0),
    detail: DETAIL,
    model_version: MODEL
  });
  if (recentLog.length > 8) {
    recentLog.length = 8;
  }
}

function applyResultsToIndex() {
  index.images = (index.images || []).map((record) => {
    const productResults = resultsByProductId.get(record.product_id);
    if (!productResults?.length) {
      return record;
    }

    const byCanonicalUrl = new Map(productResults.map((entry) => [canonicalizeImageUrl(entry.image_url), entry]));
    const heroMatch = byCanonicalUrl.get(canonicalizeImageUrl(record.image_url)) || null;

    return {
      ...record,
      is_room_scene: heroMatch ? heroMatch.result === "scene" : record.is_room_scene,
      scene_filter_model_version: MODEL,
      scene_filter_detail: DETAIL,
      scene_filter_results: productResults
    };
  });
}

async function checkpoint(productId = "") {
  applyResultsToIndex();
  const completedProducts = resumeCompleted + resultsByProductId.size;
  const totalImagesChecked = resumeImagesChecked + results.length;
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  await fs.writeFile(progressPath, `${JSON.stringify({
    start_index: progressStartIndex,
    max_products: progressTotalProducts,
    total_products: progressTotalProducts,
    completed_products: completedProducts,
    last_product_id: productId,
    images_checked: totalImagesChecked,
    product_photos: productPhotos,
    scene_photos: scenePhotos,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    model_version: MODEL,
    detail: DETAIL,
    label: progressLabel,
    product_ids_file: productIdsFile,
    running: completedProducts < progressTotalProducts,
    done: completedProducts >= progressTotalProducts,
    log: recentLog,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);
}

for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
  const product = products[productIndex];
  const imageUrls = (product.selected_image_urls || []).slice(0, 5);
  const productResults = [];

  for (let imageIndex = 0; imageIndex < imageUrls.length; imageIndex += 1) {
    const imageUrl = imageUrls[imageIndex];
    const { result, usage } = await classifyImage(imageUrl);
    if (result === "product") {
      productPhotos += 1;
    } else {
      scenePhotos += 1;
    }
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    totalTokens += usage.total_tokens;
    results.push({
      product_id: product.product_id,
      image_url: imageUrl,
      result,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens
    });
    appendLog({
      status: "done",
      product_id: product.product_id,
      image_url: imageUrl,
      result,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens
    });
    productResults.push({
      image_url: imageUrl,
      result,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      model_version: MODEL,
      detail: DETAIL
    });
    console.log(`[${resumeCompleted + productIndex + 1}/${progressTotalProducts}] [${resumeImagesChecked + results.length}] ${product.product_id} ${result} tokens=${usage.total_tokens} ${imageUrl}`);
  }

  resultsByProductId.set(product.product_id, productResults);
  await checkpoint(product.product_id);
}

const totalImages = results.length;
const totalImagesChecked = resumeImagesChecked + totalImages;
const productPct = totalImagesChecked ? Number(((productPhotos / totalImagesChecked) * 100).toFixed(1)) : 0;
const scenePct = totalImagesChecked ? Number(((scenePhotos / totalImagesChecked) * 100).toFixed(1)) : 0;

await checkpoint(products[products.length - 1]?.product_id || "");

console.log("");
for (const row of results) {
  console.log(`Product ID: ${row.product_id}`);
  console.log(`Image URL: ${row.image_url}`);
  console.log(`Result: ${row.result}`);
  console.log("");
}

console.log("Summary:");
console.log(`Start index: ${progressStartIndex}`);
console.log(`Products processed: ${resumeCompleted + products.length}`);
console.log(`Total images checked: ${totalImagesChecked}`);
console.log(`Product photos: ${productPhotos} (${productPct}%)`);
console.log(`Scene photos: ${scenePhotos} (${scenePct}%)`);
console.log(`Input tokens: ${inputTokens}`);
console.log(`Output tokens: ${outputTokens}`);
console.log(`Total tokens: ${totalTokens}`);
console.log(`Updated index: ${indexPath}`);
