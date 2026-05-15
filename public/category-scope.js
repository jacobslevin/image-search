export function normalizeVisualTypeKey(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "task_chair" || normalized === "collaborative_chair") {
    return "task_collab_chair";
  }
  if (normalized === "perch_stool") {
    return "stool";
  }
  return normalized;
}

export function normalizeSeatingCategoryKey(value = "") {
  return normalizeVisualTypeKey(value);
}

// NOTE: Keep this canonical frontend category-scope list aligned with the
// backend deterministic resolver in `src/captioning.js` for phrases that
// should drive detection and stripping. This list intentionally stays narrower
// than the display-only list below so residual synonym words like "sofas"
// remain visible to the user after category resolution.
const CATEGORY_SCOPE_PHRASES = {
  task_collab_chair: ["task chair", "task chairs", "work chair", "work chairs", "collaborative chair", "collaborative chairs"],
  guest_chair: ["guest seating", "guest chair", "guest chairs", "multi-use guest seating", "multi-use guest chair", "multi-use guest chairs"],
  lounge_chair: ["lounge seating", "lounge chair", "lounge chairs", "lounge"],
  bench: ["bench seating", "bench", "benches"],
  stool: ["stool", "stools", "bar stool", "bar stools", "counter stool", "counter stools"],
  conference: ["conference table", "conference tables", "boardroom table", "boardroom tables"],
  occasional: ["occasional table", "occasional tables", "side table", "side tables", "end table", "end tables", "accent table", "accent tables", "coffee table", "coffee tables"],
  cafe_dining: ["cafe table", "cafe tables", "dining table", "dining tables", "bistro table", "bistro tables", "kitchen table", "kitchen tables", "restaurant table", "restaurant tables"],
  training: ["training table", "training tables", "flip table", "flip tables", "flip-top table", "flip-top tables", "folding table", "folding tables", "seminar table", "seminar tables", "classroom table", "classroom tables"],
  huddle_collaborative: ["huddle table", "huddle tables", "collaboration table", "collaboration tables", "team table", "team tables"]
};

// NOTE: This display-only list is broader on purpose. It includes:
// 1. deterministic backend synonyms from `src/captioning.js`
// 2. additional common AI-resolved category-leading nouns that users may type
//    even when they are not deterministic router phrases yet
// We use it only to decide whether the residual already reads as
// "category-leading text", so the composer should skip inserting "with".
const CATEGORY_SCOPE_DISPLAY_LEAD_PHRASES = {
  task_collab_chair: [...CATEGORY_SCOPE_PHRASES.task_collab_chair],
  guest_chair: [...CATEGORY_SCOPE_PHRASES.guest_chair],
  lounge_chair: [
    ...CATEGORY_SCOPE_PHRASES.lounge_chair,
    "sofa",
    "sofas",
    "sectional",
    "sectionals",
    "loveseat",
    "loveseats",
    "couch",
    "couches",
    "settee",
    "settees",
    "daybed",
    "daybeds",
    "chaise",
    "chaises",
    "chaise lounge",
    "chaise lounges"
  ],
  bench: [...CATEGORY_SCOPE_PHRASES.bench],
  stool: [
    ...CATEGORY_SCOPE_PHRASES.stool,
    "barstool",
    "barstools",
    "counterstool",
    "counterstools"
  ],
  conference: [...CATEGORY_SCOPE_PHRASES.conference],
  occasional: [...CATEGORY_SCOPE_PHRASES.occasional],
  cafe_dining: [...CATEGORY_SCOPE_PHRASES.cafe_dining],
  training: [...CATEGORY_SCOPE_PHRASES.training],
  huddle_collaborative: [...CATEGORY_SCOPE_PHRASES.huddle_collaborative]
};

const GENERIC_VISUAL_TYPE_REFERENCE_PHRASES = [
  "chair",
  "chairs",
  "seating",
  "seat",
  "seats",
  "table",
  "tables"
];

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeCategoryScopeSelection(values = [], options = {}) {
  const maxSelections = Number.isInteger(options.maxSelections) ? options.maxSelections : 1;
  const input = Array.isArray(values) ? values : values ? [values] : [];
  const normalized = [];
  const seen = new Set();

  for (const value of input) {
    const raw = String(value || "").trim().toLowerCase();
    const key = raw === "all" ? "all" : normalizeVisualTypeKey(raw);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
    if (normalized.length >= maxSelections) {
      break;
    }
  }

  return normalized;
}

export function getPrimaryCategoryScopeSelection(values = []) {
  return normalizeCategoryScopeSelection(values, { maxSelections: 1 })[0] || "";
}

export function getCategoryScopePhrases(categoryScope = "") {
  return CATEGORY_SCOPE_PHRASES[normalizeVisualTypeKey(categoryScope)] || [];
}

export function getCategoryScopeDisplayLeadPhrases(categoryScope = "") {
  return CATEGORY_SCOPE_DISPLAY_LEAD_PHRASES[normalizeVisualTypeKey(categoryScope)] || [];
}

export function residualStartsWithCategoryLeadPhrase(query = "", categoryScope = "") {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return false;
  }
  return getCategoryScopeDisplayLeadPhrases(categoryScope).some((phrase) => (
    normalizedQuery === phrase || normalizedQuery.startsWith(`${phrase} `)
  ));
}

export function detectCategoryScopeFromQuery(query = "") {
  const rawQuery = String(query || "");
  const matches = [];

  Object.entries(CATEGORY_SCOPE_PHRASES).forEach(([categoryKey, phrases]) => {
    phrases.forEach((phrase) => {
      const match = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").exec(rawQuery);
      if (match && typeof match.index === "number") {
        matches.push({
          categoryKey,
          phrase,
          index: match.index,
          length: match[0].length
        });
      }
    });
  });

  matches.sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    return left.index - right.index;
  });

  return matches[0]?.categoryKey || "";
}

export function splitQueryAroundCategoryScope(query = "", categoryScope = "") {
  const rawQuery = String(query || "");
  const phrases = getCategoryScopePhrases(categoryScope);

  for (const phrase of phrases) {
    const match = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").exec(rawQuery);
    if (!match || typeof match.index !== "number") {
      continue;
    }

    return {
      prefix: normalizeWhitespace(rawQuery.slice(0, match.index)),
      match: rawQuery.slice(match.index, match.index + match[0].length),
      suffix: normalizeWhitespace(rawQuery.slice(match.index + match[0].length))
    };
  }

  for (const phrase of GENERIC_VISUAL_TYPE_REFERENCE_PHRASES) {
    const match = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").exec(rawQuery);
    if (!match || typeof match.index !== "number") {
      continue;
    }

    return {
      prefix: normalizeWhitespace(rawQuery.slice(0, match.index)),
      match: rawQuery.slice(match.index, match.index + match[0].length),
      suffix: normalizeWhitespace(rawQuery.slice(match.index + match[0].length))
    };
  }

  return {
    prefix: "",
    match: "",
    suffix: normalizeWhitespace(rawQuery)
  };
}

export function stripCategoryScopeFromQuery(query = "", categoryScope = "") {
  const normalizedCategory = normalizeVisualTypeKey(categoryScope);
  const phrases = CATEGORY_SCOPE_PHRASES[normalizedCategory] || [];
  let nextQuery = String(query || "");

  for (const phrase of phrases) {
    nextQuery = nextQuery.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "ig"), " ");
  }

  nextQuery = normalizeWhitespace(nextQuery).replace(/^[,/\-:;]+/, " ");
  nextQuery = normalizeWhitespace(nextQuery).replace(/^(with|featuring)\b\s*/i, "");
  return normalizeWhitespace(nextQuery);
}

export function isCategoryScopeBulletText(text = "") {
  const raw = String(text || "").trim();
  const separatorIndex = raw.indexOf(":");
  if (!raw || separatorIndex === -1) {
    return false;
  }

  const field = raw.slice(0, separatorIndex).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return field === "seating_type" || field === "visual_type";
}

export function stripCategoryScopeFromSelectedBullets(selectedBullets = {}) {
  const source = selectedBullets && typeof selectedBullets === "object" ? selectedBullets : {};
  const filterBullets = (bullets) => (
    (Array.isArray(bullets) ? bullets : [])
      .map((bullet) => String(bullet || "").trim())
      .filter((bullet) => bullet && !isCategoryScopeBulletText(bullet))
  );

  return {
    high: filterBullets(source.high),
    normal: filterBullets(source.normal),
    low: filterBullets(source.low)
  };
}

export function buildResultsPageSearch(searchState = {}) {
  const params = new URLSearchParams();
  const query = String(searchState.query || "").trim();
  const refreshAgeFilter = String(searchState.refreshAgeFilter || "").trim();
  const categoryFilter = Array.isArray(searchState.categoryFilter) ? searchState.categoryFilter : [];
  const categoryScope = normalizeCategoryScopeSelection(searchState.categoryScope, { maxSelections: 1 });

  if (query) {
    params.set("q", query);
  }
  categoryFilter
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .forEach((value) => params.append("category", value));
  if (categoryScope.length && categoryScope[0] !== "all") {
    params.set("visual_type", categoryScope[0]);
  }
  if (refreshAgeFilter) {
    params.set("refresh_age", refreshAgeFilter);
  }

  return params.toString();
}
