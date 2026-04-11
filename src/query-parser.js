import { CATEGORY_RULES } from "./category-rules.js";
import { normalizeWhitespace } from "./utils.js";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePhrase(query, phrase) {
  return normalizeWhitespace(query.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i"), " "));
}

function detectBrand(query, brands = []) {
  let remaining = normalizeWhitespace(query);
  let brand = null;

  const sortedBrands = [...brands].sort((a, b) => b.length - a.length);
  for (const candidate of sortedBrands) {
    const aliases = [candidate];
    if (/sitonit seating/i.test(candidate)) {
      aliases.push("sitonit", "sit on it");
    }
    if (/arcadia furniture/i.test(candidate)) {
      aliases.push("arcadia");
    }

    const matchedAlias = aliases.find((alias) =>
      new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(remaining)
    );

    if (matchedAlias) {
      brand = candidate;
      remaining = removePhrase(remaining, matchedAlias);
      break;
    }
  }

  return { brand, remaining };
}

function detectCategory(query) {
  let remaining = normalizeWhitespace(query);
  let category = null;

  for (const rule of CATEGORY_RULES) {
    const phrase = rule.phrases.find((item) => new RegExp(`\\b${escapeRegExp(item)}\\b`, "i").test(remaining));
    if (!phrase) {
      continue;
    }
    category = rule.canonical;
    remaining = removePhrase(remaining, phrase);
    break;
  }

  return { category, remaining };
}

async function parseSearchQueryWithAI(query, brands = [], { apiKey, model } = {}) {
  const brandMatch = detectBrand(query, brands);
  const categoryMatch = detectCategory(brandMatch.remaining || query);
  const cleanedQuery = normalizeWhitespace(categoryMatch.remaining || brandMatch.remaining || query);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Parse furniture search text into JSON with keys: category and visual_query.

Rules:
- Brand is already handled separately; do not infer or return brand.
- Category is optional and should only be set when the query clearly names a catalog family.
- Allowed category values: ${CATEGORY_RULES.map((rule) => rule.canonical).join(", ")}.
- visual_query should preserve the user's visual intent in concise natural language.
- Do not extract or invent structured visual traits.
- Return valid JSON only.`
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: cleanedQuery
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI query parsing failed with ${response.status}.`);
  }

  const payload = await response.json();
  const raw = String(payload.output_text || "").trim();
  const parsed = JSON.parse(raw);

  return {
    category: parsed.category || categoryMatch.category || null,
    brand: brandMatch.brand,
    visual_query: normalizeWhitespace(parsed.visual_query || cleanedQuery),
    query_traits: null
  };
}

function parseSearchQueryFallback(query, brands = []) {
  const brandMatch = detectBrand(query, brands);
  const categoryMatch = detectCategory(brandMatch.remaining || query);

  return {
    category: categoryMatch.category,
    brand: brandMatch.brand,
    visual_query: normalizeWhitespace(categoryMatch.remaining || brandMatch.remaining || query),
    query_traits: null
  };
}

export async function parseSearchQuery(query, brands = [], options = {}) {
  const normalizedQuery = normalizeWhitespace(query);
  if (!options.apiKey) {
    return parseSearchQueryFallback(normalizedQuery, brands);
  }

  try {
    return await parseSearchQueryWithAI(normalizedQuery, brands, options);
  } catch {
    return parseSearchQueryFallback(normalizedQuery, brands);
  }
}
