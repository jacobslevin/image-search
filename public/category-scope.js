export function normalizeSeatingCategoryKey(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "task_chair" || normalized === "collaborative_chair") {
    return "task_collab_chair";
  }
  if (normalized === "perch_stool") {
    return "stool";
  }
  return normalized;
}

const CATEGORY_SCOPE_PHRASES = {
  task_collab_chair: ["task chair", "task chairs", "work chair", "work chairs", "collaborative chair", "collaborative chairs"],
  guest_chair: ["guest seating", "guest chair", "guest chairs", "multi-use guest seating", "multi-use guest chair", "multi-use guest chairs"],
  lounge_chair: ["lounge seating", "lounge chair", "lounge chairs", "lounge"],
  bench: ["bench seating", "bench", "benches"],
  stool: ["stool", "stools", "bar stool", "bar stools", "counter stool", "counter stools"]
};

const GENERIC_SEATING_REFERENCE_PHRASES = [
  "chair",
  "chairs",
  "seating",
  "seat",
  "seats"
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
    const key = raw === "all" ? "all" : normalizeSeatingCategoryKey(raw);
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
  return CATEGORY_SCOPE_PHRASES[normalizeSeatingCategoryKey(categoryScope)] || [];
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

  for (const phrase of GENERIC_SEATING_REFERENCE_PHRASES) {
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
  const normalizedCategory = normalizeSeatingCategoryKey(categoryScope);
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
    essential: filterBullets(source.essential),
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
