import { RESULT_CUTOFF_DEFAULTS, findCutoff } from "./result-cutoff.js";
import {
  buildResultsPageSearch,
  getPrimaryCategoryScopeSelection,
  normalizeCategoryScopeSelection,
  normalizeSeatingCategoryKey,
  splitQueryAroundCategoryScope,
  stripCategoryScopeFromQuery,
  stripCategoryScopeFromSelectedBullets
} from "./category-scope.js";

const state = {
  debug: false,
  debugPayload: null,
  bootstrap: null,
  expandedProductId: null,
  inspectedProductId: null,
  refreshingProductId: null,
  batchRefreshing: false,
  lastPayload: null,
  lastQuery: "",
  selectedUploadFile: null,
  lastAnalyzeInput: null,
  cropPreviewUrl: "",
  focusArea: null,
  copyStructuredTraitsTimer: null,
  copyDebugTableTimer: null,
  extractionSummary: null,
  manageMode: false,
  selectedProductIds: new Set(),
  sortMode: "auto",
  categoryFilter: [],
  resultCategoryScope: [],
  refreshAgeFilter: "",
  currentBaseQueryEmbedding: [],
  currentQueryEmbedding: [],
  currentSelectedBullets: { essential: [], normal: [], low: [] },
  currentBulletControls: [],
  pendingBulletControls: null,
  currentSeatingType: "",
  currentImageAnalysis: null,
  clarificationConflict: null,
  categoryRequirement: null,
  currentProductRefinements: [],
  originalPayload: null,
  originalQuery: "",
  originalBaseQueryEmbedding: [],
  originalQueryEmbedding: [],
  originalSelectedBullets: { essential: [], normal: [], low: [] },
  originalBulletControls: [],
  originalSeatingType: "",
  originalImageAnalysis: null,
  originalProductRefinements: [],
  originalCategoryFilter: [],
  originalResultCategoryScope: [],
  originalCategoryScopeMode: "all",
  originalRefreshAgeFilter: "",
  refinementActive: false,
  refinementLoading: false,
  categoryScopeLoading: false,
  categoryScopeMode: "all",
  searchComposerPrefix: "",
  searchComposerMatch: "",
  refineDrawerOpen: false,
  cropModeActive: false,
  activeCardImageUrls: {},
  expandedThumbnailProducts: new Set(),
  inlineRefinementPanel: null,
  batchRefreshProgress: null,
  batchRefreshProgressVisible: false,
  batchRefreshPollTimer: null,
  sceneFilterProgress: null,
  sceneFilterPollTimer: null,
  imageAnalyzeProgress: null,
  imageAnalyzeProgressTimer: null,
  resultCutoffMeta: null,
  resultCutoffKey: "",
  weakerMatchesExpanded: false,
  weakerResultInteractionKeys: new Set(),
  landingOnlyMode: false
};

const SEATING_CATEGORY_DISPLAY_NAMES = {
  task_collab_chair: "Work Chairs",
  guest_chair: "Multi-Use / Guest Chairs",
  lounge_chair: "Lounge Chairs",
  bench: "Benches",
  ottoman: "Ottomans",
  stool: "Stools",
  other_seating: "Other Seating"
};

const CATEGORY_REQUIREMENT_OPTION_KEYS = Object.keys(SEATING_CATEGORY_DISPLAY_NAMES)
  .filter((key) => key !== "other_seating")
  .sort((left, right) => {
    const leftLabel = SEATING_CATEGORY_DISPLAY_NAMES[left] || left;
    const rightLabel = SEATING_CATEGORY_DISPLAY_NAMES[right] || right;
    return leftLabel.localeCompare(rightLabel);
  });

const BATCH_PROGRESS_DISMISS_KEY = "image-search.batch-progress-dismissed";
const IMAGE_SEARCH_HANDOFF_KEY = "image-search.pending-image-handoff";
const PRIVATE_BROWSE_PATH = "/velvet-lobster-orbit-773-nebula";
const CURRENT_URL = new URL(window.location.href);
const IS_PRIVATE_BROWSE_ROUTE = CURRENT_URL.pathname === PRIVATE_BROWSE_PATH;
const HAS_ACTIVE_LAUNCH_CONTEXT = Boolean(
  String(CURRENT_URL.searchParams.get("q") || "").trim() ||
  CURRENT_URL.searchParams.get("open_image") === "1"
);
const LANDING_ONLY_MODE = !IS_PRIVATE_BROWSE_ROUTE && !HAS_ACTIVE_LAUNCH_CONTEXT;
state.landingOnlyMode = LANDING_ONLY_MODE;
const IMAGE_ANALYZE_PROGRESS_STEPS = [
  { id: "prepare", label: "Prepare", percent: 18, title: "Preparing image...", detail: "Getting the selected image ready for analysis." },
  { id: "analyze", label: "Analyze", percent: 68, title: "Analyzing visual traits...", detail: "Extracting category, traits, and descriptive bullets." },
  { id: "match", label: "Match", percent: 94, title: "Matching catalog products...", detail: "Ranking the best catalog matches from the analyzed image." },
  { id: "complete", label: "Complete", percent: 100, title: "Results ready", detail: "Opening the ranked results." }
];
const QUERY_IMAGE_ANALYSIS_RETRY_MESSAGE = "Our fault, but we encountered an unexpected issue. Please resubmit your image.";

const focusDrag = {
  active: false,
  mode: "move",
  handle: "",
  startX: 0,
  startY: 0,
  startArea: null
};

const elements = {
  cardTemplate: document.querySelector("#cardTemplate"),
  closeImageModal: document.querySelector("#closeImageModal"),
  closeRulesModal: document.querySelector("#closeRulesModal"),
  closeStructuredTraitsModal: document.querySelector("#closeStructuredTraitsModal"),
  contextPills: document.querySelector("#contextPills"),
  closeRefineSidebar: document.querySelector("#closeRefineSidebar"),
  debugToggle: document.querySelector("#debugToggle"),
  debugToggleLabel: document.querySelector("#debugToggleLabel"),
  imageModal: document.querySelector("#imageModal"),
  rulesModal: document.querySelector("#rulesModal"),
  structuredTraitsModal: document.querySelector("#structuredTraitsModal"),
  imageModalResultsStage: document.querySelector("#imageModalResultsStage"),
  imageModalUploadStage: document.querySelector("#imageModalUploadStage"),
  imageUploadButton: document.querySelector("#imageUploadButton"),
  imageUploadInput: document.querySelector("#imageUploadInput"),
  imageUrlInput: document.querySelector("#imageUrlInput"),
  inspirationPreview: document.querySelector("#inspirationPreview"),
  previewCanvas: document.querySelector("#previewCanvas"),
  focusBox: document.querySelector("#focusBox"),
  focusHandles: document.querySelectorAll('[data-role="focusHandle"]'),
  focusCropPrompt: document.querySelector("#focusCropPrompt"),
  skipFocusButton: document.querySelector("#skipFocusButton"),
  applyFocusButton: document.querySelector("#applyFocusButton"),
  focusAnalyzeLoading: document.querySelector("#focusAnalyzeLoading"),
  modalTitle: document.querySelector("#modalTitle"),
  imageModalCloseTargets: document.querySelectorAll('[data-role="imageModalClose"]'),
  rulesModalCloseTargets: document.querySelectorAll('[data-role="rulesModalClose"]'),
  structuredTraitsModalCloseTargets: document.querySelectorAll('[data-role="structuredTraitsModalClose"]'),
  openImageSearch: document.querySelector("#openImageSearch"),
  openRulesSummary: document.querySelector("#openRulesSummary"),
  openExtractionSummary: document.querySelector("#openExtractionSummary"),
  copyStructuredTraits: document.querySelector("#copyStructuredTraits"),
  copyStructuredTraitsModalButton: document.querySelector("#copyStructuredTraitsModalButton"),
  copyStructuredTraitsStatus: document.querySelector("#copyStructuredTraitsStatus"),
  rulesSummaryDetails: document.querySelector("#rulesSummaryDetails"),
  structuredTraitsText: document.querySelector("#structuredTraitsText"),
  debugLightbox: document.querySelector("#debugLightbox"),
  closeDebugLightbox: document.querySelector("#closeDebugLightbox"),
  debugLightboxCloseTargets: document.querySelectorAll('[data-role="debugLightboxClose"]'),
  debugLightboxSubtitle: document.querySelector("#debugLightboxSubtitle"),
  debugScoreTableHead: document.querySelector("#debugScoreTableHead"),
  debugScoreTableBody: document.querySelector("#debugScoreTableBody"),
  copyDebugTableTsv: document.querySelector("#copyDebugTableTsv"),
  copyDebugTableStatus: document.querySelector("#copyDebugTableStatus"),
  extractionSummaryModal: document.querySelector("#extractionSummaryModal"),
  closeExtractionSummaryModal: document.querySelector("#closeExtractionSummaryModal"),
  extractionSummaryModalCloseTargets: document.querySelectorAll('[data-role="extractionSummaryModalClose"]'),
  extractionSummaryContent: document.querySelector("#extractionSummaryContent"),
  resultsLoadingPanel: document.querySelector("#resultsLoadingPanel"),
  resultsLoadingTitle: document.querySelector("#resultsLoadingTitle"),
  resultsHeader: document.querySelector(".results-header"),
  resultsGrid: document.querySelector("#resultsGrid"),
  batchManageBar: document.querySelector("#batchManageBar"),
  manageSelectionButton: document.querySelector("#manageSelectionButton"),
  manageActions: document.querySelector("#manageActions"),
  manageControls: document.querySelector("#manageControls"),
  selectAllButton: document.querySelector("#selectAllButton"),
  selectNoneButton: document.querySelector("#selectNoneButton"),
  batchRefreshButton: document.querySelector("#batchRefreshButton"),
  doneManagingButton: document.querySelector("#doneManagingButton"),
  batchRefreshProgress: document.querySelector("#batchRefreshProgress"),
  batchRefreshHeadline: document.querySelector("#batchRefreshHeadline"),
  batchRefreshMeterFill: document.querySelector("#batchRefreshMeterFill"),
  batchRefreshCount: document.querySelector("#batchRefreshCount"),
  batchRefreshBatchLabel: document.querySelector("#batchRefreshBatchLabel"),
  batchRefreshCurrent: document.querySelector("#batchRefreshCurrent"),
  batchRefreshImage: document.querySelector("#batchRefreshImage"),
  batchRefreshImagesPassed: document.querySelector("#batchRefreshImagesPassed"),
  batchRefreshRun: document.querySelector("#batchRefreshRun"),
  batchRefreshCost: document.querySelector("#batchRefreshCost"),
  batchRefreshLog: document.querySelector("#batchRefreshLog"),
  batchRefreshSummary: document.querySelector("#batchRefreshSummary"),
  batchRefreshFailures: document.querySelector("#batchRefreshFailures"),
  batchRefreshCloseButton: document.querySelector("#batchRefreshCloseButton"),
  sceneFilterProgressPanel: document.querySelector("#sceneFilterProgressPanel"),
  sceneFilterProgressDetails: document.querySelector("#sceneFilterProgressDetails"),
  sceneFilterProgressHeadline: document.querySelector("#sceneFilterProgressHeadline"),
  sceneFilterProgressSummaryLine: document.querySelector("#sceneFilterProgressSummaryLine"),
  sceneFilterProgressLeft: document.querySelector("#sceneFilterProgressLeft"),
  sceneFilterProgressMeterFill: document.querySelector("#sceneFilterProgressMeterFill"),
  sceneFilterProgressCount: document.querySelector("#sceneFilterProgressCount"),
  sceneFilterProgressMeta: document.querySelector("#sceneFilterProgressMeta"),
  sceneFilterProgressCurrent: document.querySelector("#sceneFilterProgressCurrent"),
  sceneFilterProgressLog: document.querySelector("#sceneFilterProgressLog"),
  sceneFilterProgressSummary: document.querySelector("#sceneFilterProgressSummary"),
  sceneFilterProgressCostSummary: document.querySelector("#sceneFilterProgressCostSummary"),
  sceneFilterProgressEstimateSummary: document.querySelector("#sceneFilterProgressEstimateSummary"),
  sceneFilterResumeButton: document.querySelector("#sceneFilterResumeButton"),
  categoryFilterMenu: document.querySelector("#categoryFilterMenu"),
  categoryFilterButton: document.querySelector("#categoryFilterButton"),
  categoryFilterOptions: document.querySelector("#categoryFilterOptions"),
  refreshAgeFilterWrap: document.querySelector(".results-sort-refresh-age"),
  refreshAgeFilterSelect: document.querySelector("#refreshAgeFilterSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  resetSearchButton: document.querySelector("#resetSearchButton"),
  clarificationBar: document.querySelector("#clarificationBar"),
  refineBulletsList: document.querySelector("#refineBulletsList"),
  refineSelectedImageWrap: document.querySelector("#refineSelectedImageWrap"),
  refineSelectedImage: document.querySelector("#refineSelectedImage"),
  applyRefineBulletsButton: document.querySelector("#applyRefineBulletsButton"),
  refineDrawerBackdrop: document.querySelector("#refineDrawerBackdrop"),
  reopenFocusOverlay: document.querySelector("#reopenFocusOverlay"),
  refineToggleButton: document.querySelector("#refineToggleButton"),
  resultsLayout: document.querySelector(".results-layout"),
  resultsSidebar: document.querySelector("#resultsSidebar"),
  resultCount: document.querySelector("#resultCount"),
  searchForm: document.querySelector("#searchForm"),
  searchCategoryPrefix: document.querySelector("#searchCategoryPrefix"),
  searchCategoryChipWrap: document.querySelector("#searchCategoryChipWrap"),
  searchCategorySelect: document.querySelector("#searchCategorySelect"),
  searchCategorySuffix: document.querySelector("#searchCategorySuffix"),
  searchInput: document.querySelector("#searchInput"),
  seedQueries: document.querySelector("#seedQueries"),
  selectedFileName: document.querySelector("#selectedFileName"),
  statusPanel: document.querySelector("#statusPanel"),
  uploadSupportNote: document.querySelector("#uploadSupportNote"),
  analyzeImageButton: document.querySelector("#analyzeImageButton"),
  imageAnalyzeLoading: document.querySelector("#imageAnalyzeLoading")
};

function syncRootClass(name, enabled) {
  document.documentElement.classList.toggle(name, Boolean(enabled));
  document.body.classList.toggle(name, Boolean(enabled));
}

syncRootClass("landing-home", state.landingOnlyMode);
syncRootClass("private-browse", !state.landingOnlyMode);
syncRootClass("public-route", !IS_PRIVATE_BROWSE_ROUTE);

function setInitialSearchPending(isPending) {
  syncRootClass("initial-search-pending", isPending);
}

function setLandingOnlyMode(isLandingOnly) {
  state.landingOnlyMode = Boolean(isLandingOnly);
  syncRootClass("landing-home", state.landingOnlyMode);
  syncRootClass("private-browse", !state.landingOnlyMode);
}

function enterBrowseMode(query = "", extraParams = {}) {
  if (!state.landingOnlyMode) {
    return;
  }
  setLandingOnlyMode(false);
  const targetPath = IS_PRIVATE_BROWSE_ROUTE ? PRIVATE_BROWSE_PATH : "/";
  const nextUrl = buildBrowseUrl(query, extraParams, targetPath);
  window.history.pushState({}, "", nextUrl);
}

function buildBrowseUrl(query = "", extraParams = {}, targetPath = CURRENT_URL.pathname) {
  const url = new URL(window.location.origin + targetPath);
  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery) {
    url.searchParams.set("q", normalizedQuery);
  }
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function redirectToBrowseResults(query = "", extraParams = {}) {
  const targetPath = IS_PRIVATE_BROWSE_ROUTE ? PRIVATE_BROWSE_PATH : "/";
  window.location.assign(buildBrowseUrl(query, extraParams, targetPath));
}

function persistImageSearchHandoff(context = {}) {
  try {
    window.sessionStorage.setItem(IMAGE_SEARCH_HANDOFF_KEY, JSON.stringify(context));
  } catch {}
}

function consumeImageSearchHandoff() {
  try {
    const raw = window.sessionStorage.getItem(IMAGE_SEARCH_HANDOFF_KEY);
    if (!raw) {
      return null;
    }
    window.sessionStorage.removeItem(IMAGE_SEARCH_HANDOFF_KEY);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function logEvent(name, payload = {}) {
  const eventPayload = {
    ...payload,
    loggedAt: new Date().toISOString()
  };
  if (window.analytics && typeof window.analytics.track === "function") {
    window.analytics.track(name, eventPayload);
    return;
  }
  console.info(`[analytics] ${name}`, eventPayload);
}

function getResultCutoffOptions() {
  return {
    ...RESULT_CUTOFF_DEFAULTS,
    ...(state.bootstrap?.result_cutoff || {})
  };
}

function buildResultCutoffKey(payload, query, isBrowseMode) {
  const resultSignature = Array.isArray(payload?.results)
    ? payload.results
      .map((result) => `${result.product_id || result.id || result.name}:${Number(result.score || 0).toFixed(4)}`)
      .join("|")
    : "";
  return [String(query || "").trim(), String(isBrowseMode), resultSignature].join("::");
}

function computeResultCutoffMeta(payload, query, isBrowseMode) {
  const key = buildResultCutoffKey(payload, query, isBrowseMode);
  if (state.resultCutoffKey === key && state.resultCutoffMeta) {
    return state.resultCutoffMeta;
  }

  const scores = Array.isArray(payload?.results)
    ? payload.results.map((result) => Number(result.score || 0)).filter((score) => Number.isFinite(score))
    : [];
  const options = getResultCutoffOptions();
  const { cutoff, reason } = findCutoff(scores, options);
  const hiddenCount = Math.max(scores.length - cutoff, 0);
  const meta = {
    key,
    cutoff,
    reason,
    hiddenCount,
    options,
    scores
  };

  if (state.resultCutoffKey !== key) {
    state.weakerMatchesExpanded = false;
    state.weakerResultInteractionKeys = new Set();
  }

  state.resultCutoffKey = key;
  state.resultCutoffMeta = meta;

  if (!isBrowseMode && scores.length) {
    logEvent("cutoff_computed", {
      totalResults: scores.length,
      cutoff,
      reason,
      topScore: scores[0] ?? null,
      bottomScore: scores[scores.length - 1] ?? null
    });
  }

  return meta;
}

function shouldShowWeakerMatchesToggle(cutoffMeta, isBrowseMode) {
  if (isBrowseMode || !cutoffMeta) {
    return false;
  }
  return cutoffMeta.hiddenCount > 0 &&
    cutoffMeta.reason !== "uniform" &&
    cutoffMeta.reason !== "too_few";
}

function logWeakerResultInteraction(type, result, scoreRank) {
  if (!state.weakerMatchesExpanded) {
    return;
  }
  const interactionKey = `${type}:${result.product_id || result.id || result.name}:${scoreRank}`;
  if (state.weakerResultInteractionKeys.has(interactionKey)) {
    return;
  }
  state.weakerResultInteractionKeys.add(interactionKey);
  logEvent("weaker_match_interacted", {
    interactionType: type,
    resultId: result.product_id || result.id || result.name || "",
    scoreRank,
    score: Number(result.score || 0)
  });
}

function getImageAnalyzeStepConfig(stepId = "prepare") {
  return IMAGE_ANALYZE_PROGRESS_STEPS.find((step) => step.id === stepId) || IMAGE_ANALYZE_PROGRESS_STEPS[0];
}

function setImageAnalyzeProgressState(nextProgress = {}) {
  const step = getImageAnalyzeStepConfig(nextProgress.step);
  const percent = clamp(Math.round(Number(nextProgress.percent ?? step.percent) || 0), 0, 100);
  state.imageAnalyzeProgress = {
    step: step.id,
    percent,
    title: String(nextProgress.title || step.title || "").trim(),
    detail: String(nextProgress.detail || step.detail || "").trim()
  };
}

function renderImageAnalyzeProgress() {
  const progress = state.imageAnalyzeProgress || {
    step: "prepare",
    percent: 0,
    title: "Preparing image...",
    detail: "Getting the selected image ready for analysis."
  };
  document.querySelectorAll(".image-analyze-loading-card").forEach((card) => {
    const title = card.querySelector('[data-role="imageAnalyzeTitle"]');
    const detail = card.querySelector('[data-role="imageAnalyzeDetail"]');
    const percent = card.querySelector('[data-role="imageAnalyzePercent"]');
    const steps = [...card.querySelectorAll(".image-analyze-segment")];
    if (title) title.textContent = progress.title;
    if (detail) detail.textContent = progress.detail;
    if (percent) percent.textContent = `${progress.percent}%`;
    const activeIndex = IMAGE_ANALYZE_PROGRESS_STEPS.findIndex((step) => step.id === progress.step);
    steps.forEach((item, index) => {
      const stepId = item.dataset.step || "";
      const stepConfig = getImageAnalyzeStepConfig(stepId);
      const isComplete =
        progress.percent >= 100 ||
        index < activeIndex ||
        progress.percent >= Number(stepConfig.percent || 0);
      item.classList.toggle("is-active", index === activeIndex && progress.percent < 100);
      item.classList.toggle("is-complete", isComplete);
    });
  });
}

function stopImageAnalyzeProgressAnimation() {
  if (state.imageAnalyzeProgressTimer) {
    window.clearInterval(state.imageAnalyzeProgressTimer);
    state.imageAnalyzeProgressTimer = null;
  }
}

function animateImageAnalyzeProgressTo(targetPercent = 0) {
  stopImageAnalyzeProgressAnimation();
  const clampedTarget = clamp(Math.round(Number(targetPercent) || 0), 0, 100);
  state.imageAnalyzeProgressTimer = window.setInterval(() => {
    const current = Number(state.imageAnalyzeProgress?.percent || 0);
    if (current >= clampedTarget) {
      stopImageAnalyzeProgressAnimation();
      return;
    }
    const stepSize = clampedTarget >= 90 ? 1 : 2;
    setImageAnalyzeProgressState({ ...state.imageAnalyzeProgress, percent: Math.min(current + stepSize, clampedTarget) });
    renderImageAnalyzeProgress();
  }, 90);
}

function updateImageAnalyzeProgress(stepId = "prepare", options = {}) {
  const step = getImageAnalyzeStepConfig(stepId);
  setImageAnalyzeProgressState({
    step: step.id,
    percent: Number(options.percent ?? state.imageAnalyzeProgress?.percent ?? 0),
    title: options.title || step.title,
    detail: options.detail || step.detail
  });
  renderImageAnalyzeProgress();
  if (typeof options.targetPercent === "number") {
    animateImageAnalyzeProgressTo(options.targetPercent);
  }
}

function apiUrl(pathname) {
  const path = String(pathname || "");
  if (!path.startsWith("/")) {
    return path;
  }

  const isApiPath = path.startsWith("/api/");
  if (!isApiPath) {
    return path;
  }

  const currentPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  if (currentPort === "3001") {
    return path;
  }

  return `${window.location.protocol}//${window.location.hostname}:3001${path}`;
}

function buildDesignerPagesProductUrl(productId = "") {
  const normalizedId = String(productId || "").trim();
  const numericId = normalizedId.match(/(\d+)$/)?.[1] || "";
  return numericId ? `https://designerpages.com/products/${numericId}` : "";
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeCategoryFilter(value = []) {
  const values = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];
  return [...new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function formatCategoryFilterLabel(categories = []) {
  const normalized = normalizeCategoryFilter(categories);
  if (!normalized.length) {
    return "All categories";
  }
  if (normalized.length === 1) {
    return normalized[0];
  }
  return `${normalized.length} categories`;
}

function setCategoryFilterMode(isSearchMode) {
  if (elements.categoryFilterMenu) {
    elements.categoryFilterMenu.hidden = isSearchMode;
    if (isSearchMode) {
      elements.categoryFilterMenu.open = false;
    }
  }
}

function formatSeatingCategoryLabel(value = "") {
  const normalized = normalizeSeatingCategoryKey(value);
  if (normalized === "all") {
    return "All categories";
  }
  if (normalized === "unspecified") {
    return "Unspecified";
  }
  return SEATING_CATEGORY_DISPLAY_NAMES[normalized] || formatTraitFieldLabel(normalized) || normalized;
}

function getCategoryPhraseForQuery(value = "", options = {}) {
  const normalized = normalizeSeatingCategoryKey(value);
  const singular = options?.singular === true;
  const phrases = singular
    ? {
        task_collab_chair: "work chair",
        guest_chair: "guest chair",
        lounge_chair: "lounge chair",
        bench: "bench",
        ottoman: "ottoman",
        stool: "stool",
        other_seating: "other seating"
      }
    : {
        task_collab_chair: "work chairs",
        guest_chair: "guest chairs",
        lounge_chair: "lounge chairs",
        bench: "benches",
        ottoman: "ottomans",
        stool: "stools",
        other_seating: "other seating"
      };
  return phrases[normalized] || "";
}

function shouldUseSingularCategoryPhrase(matchText = "") {
  const normalized = String(matchText || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/\b(chairs|seats|benches|ottomans|stools)\b/.test(normalized)) {
    return false;
  }
  if (/\bseating\b/.test(normalized)) {
    return false;
  }
  return /\b(chair|seat|work chair|guest chair|lounge chair|task chair|collaborative chair|bench|ottoman|stool)\b/.test(normalized);
}

function getCategoryPhraseForComposer(categoryKey = "", matchText = "") {
  return getCategoryPhraseForQuery(categoryKey, {
    singular: shouldUseSingularCategoryPhrase(matchText)
  });
}

function buildInlineCategoryScopedQuery(categoryKey = "", prefix = "", matchText = "", suffix = "") {
  const categoryPhrase = getCategoryPhraseForComposer(categoryKey, matchText);
  return [prefix, categoryPhrase, suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchQueryFromComposer(categoryKey = "", residualQuery = "") {
  const normalizedCategory = normalizeSeatingCategoryKey(categoryKey);
  const categoryPhrase = getCategoryPhraseForQuery(normalizedCategory);
  const residual = String(residualQuery || "").trim();
  if (!categoryPhrase) {
    return residual;
  }
  if (!residual) {
    return categoryPhrase;
  }
  if (/^(with|featuring|for|in)\b/i.test(residual)) {
    return `${categoryPhrase} ${residual}`.trim();
  }
  return `${categoryPhrase} with ${residual}`.trim();
}

function getResultStage1Category(result = {}) {
  const normalized = normalizeSeatingCategoryKey(
    result.hero_image?.seating_type ||
    normalizeMatchingImages(result)[0]?.seating_type ||
    result.debug?.stage1?.seating_type ||
    ""
  );
  return normalized;
}

function getSearchResultCategoryOptions(payload = state.lastPayload) {
  return [...new Set((payload?.results || [])
    .map((result) => getResultStage1Category(result))
    .filter(Boolean))]
    .sort((left, right) => formatSeatingCategoryLabel(left).localeCompare(formatSeatingCategoryLabel(right)));
}

function shouldShowSearchCategoryChip() {
  const selectedCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  return Boolean(
    selectedCategory &&
    selectedCategory !== "all" &&
    (state.lastQuery || state.currentImageAnalysis || state.lastPayload)
  );
}

function stripVagueSeatingReferenceFromQuery(query = "", selectedCategory = "") {
  const normalizedSelectedCategory = normalizeSeatingCategoryKey(selectedCategory);
  let nextQuery = String(query || "").trim();

  Object.keys(SEATING_CATEGORY_DISPLAY_NAMES).forEach((categoryKey) => {
    nextQuery = stripCategoryScopeFromQuery(nextQuery, categoryKey);
  });

  nextQuery = nextQuery.replace(/\b(chair|chairs|seating|seat|seats)\b/gi, " ");
  nextQuery = nextQuery.replace(/\s+/g, " ").trim();
  nextQuery = nextQuery.replace(/^[,/\-:;]+/, " ");
  nextQuery = nextQuery.replace(/\s+[,/\-:;]+/g, " ");
  nextQuery = nextQuery.replace(/^(with|featuring|for|in)\b\s*/i, "");
  nextQuery = nextQuery.replace(/\s+/g, " ").trim();

  return buildSearchQueryFromComposer(normalizedSelectedCategory, nextQuery);
}

function getSearchComposerRequestQuery(fallbackQuery = "") {
  const selectedCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  const composerParts = getSearchComposerTextParts();
  const rawInput = composerParts.plain;
  if (shouldShowSearchCategoryChip() && selectedCategory && selectedCategory !== "all") {
    return buildInlineCategoryScopedQuery(
      selectedCategory,
      composerParts.prefix,
      state.searchComposerMatch || composerParts.match,
      composerParts.suffix
    );
  }
  return rawInput || String(fallbackQuery || "").trim();
}

function renderSearchComposer(fullQuery = state.lastQuery) {
  if (
    !elements.searchCategorySelect ||
    !elements.searchCategoryChipWrap ||
    !elements.searchForm ||
    !elements.searchCategoryPrefix ||
    !elements.searchCategorySuffix ||
    !elements.searchInput
  ) {
    return;
  }

  const selectedCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all";
  const showChip = shouldShowSearchCategoryChip();
  const searchField = elements.searchForm.querySelector(".search-field");
  const composerParts = showChip
    ? splitQueryAroundCategoryScope(fullQuery, selectedCategory)
    : { prefix: "", match: "", suffix: String(fullQuery || "").trim() };
  elements.searchCategoryChipWrap.hidden = !showChip;
  searchField?.classList.toggle("has-inline-category", showChip);
  state.searchComposerPrefix = showChip ? composerParts.prefix : "";
  state.searchComposerMatch = showChip ? composerParts.match : "";
  elements.searchCategorySelect.value = selectedCategory;
  elements.searchCategorySelect.disabled = state.categoryScopeLoading;
  elements.searchCategorySelect.setAttribute("aria-busy", String(state.categoryScopeLoading));
  if (showChip) {
    elements.searchCategoryPrefix.hidden = !composerParts.prefix;
    elements.searchCategoryPrefix.textContent = composerParts.prefix;
    elements.searchCategorySuffix.hidden = !composerParts.suffix;
    elements.searchCategorySuffix.textContent = composerParts.suffix;
    elements.searchInput.replaceChildren(
      ...(composerParts.prefix ? [elements.searchCategoryPrefix] : []),
      elements.searchCategoryChipWrap,
      ...(composerParts.suffix ? [elements.searchCategorySuffix] : [])
    );
  } else {
    elements.searchCategoryPrefix.hidden = true;
    elements.searchCategoryPrefix.textContent = "";
    elements.searchCategorySuffix.hidden = true;
    elements.searchCategorySuffix.textContent = "";
    elements.searchInput.replaceChildren();
    elements.searchInput.textContent = String(fullQuery || "").trim();
  }
}

const DEBUG_HIGH_PRIORITY_FIELDS = [
  "body_construction",
  "arm_configuration",
  "back_height",
  "configuration",
  "base_visibility"
];

const DEBUG_NORMAL_PRIORITY_FIELDS = [
  "back_upholstery",
  "design_register",
  "shape_character",
  "plan_shape",
  "base_material"
];

const DEBUG_LOW_PRIORITY_FIELDS = [
  "seat_upholstery",
  "base_type",
  "base_finish"
];

const DEBUG_SCORE_TRAIT_FIELDS = [
  ...DEBUG_HIGH_PRIORITY_FIELDS,
  ...DEBUG_NORMAL_PRIORITY_FIELDS,
  ...DEBUG_LOW_PRIORITY_FIELDS
];

const DEBUG_HIGH_WEIGHT_TRAIT_FIELDS = new Set(DEBUG_HIGH_PRIORITY_FIELDS);

const DEBUG_LOW_WEIGHT_TRAIT_FIELDS = new Set(DEBUG_LOW_PRIORITY_FIELDS);

const DEFAULT_ESSENTIAL_BULLET_FIELDS = new Set([
  "body_construction",
  "arm_configuration",
  "back_height",
  "configuration",
  "base_visibility"
]);

const DEFAULT_LOW_PRIORITY_BULLET_FIELDS = new Set([
  "base_type",
  "base_finish"
]);

const BULLET_PRIORITY_LABELS = {
  essential: "essential",
  normal: "normal",
  low: "low",
  off: "off"
};

const DEBUG_TRAIT_GROUPS = [
  { label: "High Priority", fields: DEBUG_HIGH_PRIORITY_FIELDS },
  { label: "Normal Priority", fields: DEBUG_NORMAL_PRIORITY_FIELDS },
  { label: "Low Priority", fields: DEBUG_LOW_PRIORITY_FIELDS }
];

const DEBUG_SCORE_CORE_HEADERS = [
  { key: "rank", label: "Rank", className: "debug-score-number" },
  { key: "product", label: "Product name" },
  { key: "file", label: "Image" },
  { key: "image_category", label: "Image category" },
  { key: "total", label: "Total score", className: "debug-score-number" },
  { key: "embedding", label: "Embedding score", className: "debug-score-number" },
  { key: "trait", label: "Trait boost", className: "debug-score-number" },
  { key: "source", label: "Source bonus", className: "debug-score-number" }
];

const DEBUG_NEAR_MANDATORY_TERMS = [
  "lumbar",
  "caster",
  "casters",
  "wheel",
  "wheels",
  "mesh back",
  "mesh backrest",
  "angled metal legs",
  "thin angled metal legs",
  "curved armrests",
  "slim curved armrests",
  "rounded seat cushion"
];

const INLINE_REFINEMENT_EXCLUDED_FIELDS = new Set([
  "base_material"
]);

const INLINE_REFINEMENT_LABELS = new Map([
  ["height_category", "Height"],
  ["height_adjustability", "Adjustability"],
  ["back", "Back"],
  ["back_height", "Back height"],
  ["back_style", "Back style"],
  ["back_option", "Back option"],
  ["base_type", "Base"],
  ["base_frame_finish", "Base finish"],
  ["base_finish", "Base finish"],
  ["seat_material", "Seat material"],
  ["seat_fabric", "Seat fabric"],
  ["seat_upholstery", "Seat upholstery"],
  ["back_upholstery", "Back upholstery"],
  ["design_register", "Design"],
  ["shape_character", "Shape"],
  ["plan_shape", "Plan shape"],
  ["frame", "Frame"],
  ["frame_material", "Frame material"],
  ["frame_finish", "Frame finish"],
  ["arm_option", "Arms"],
  ["arm_configuration", "Arm configuration"],
  ["body_construction", "Body construction"],
  ["configuration", "Configuration"],
  ["shell_material", "Shell material"],
  ["shell_seat_material", "Shell material"],
  ["upholstery", "Upholstery"]
]);

function normalizeTraitFieldKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatTraitFieldLabel(field = "") {
  return String(field || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTraitValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildTraitSelectionKey(field = "", value = "") {
  return `${normalizeTraitFieldKey(field)}::${normalizeTraitValue(value)}`;
}

function parseStructuredBulletEntry(bullet = "", priority = "normal") {
  const raw = String(bullet || "").trim();
  const separatorIndex = raw.indexOf(":");
  if (!raw || separatorIndex === -1) {
    return null;
  }

  const field = normalizeTraitFieldKey(raw.slice(0, separatorIndex));
  const value = raw.slice(separatorIndex + 1).trim();
  if (!field || !value) {
    return null;
  }

  return { field, value, priority };
}

function defaultPriorityForBulletField(field = "") {
  const normalizedField = normalizeTraitFieldKey(field);
  if (DEFAULT_ESSENTIAL_BULLET_FIELDS.has(normalizedField)) {
    return "essential";
  }
  if (DEFAULT_LOW_PRIORITY_BULLET_FIELDS.has(normalizedField)) {
    return "low";
  }
  return "normal";
}

function defaultPriorityForBulletText(bullet = "") {
  const parsed = parseStructuredBulletEntry(bullet);
  return parsed ? defaultPriorityForBulletField(parsed.field) : "normal";
}

function buildQueryBulletMap(selectedBullets = []) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  const map = new Map();

  normalized.essential.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "essential");
    if (parsed) {
      map.set(parsed.field, parsed);
    }
  });

  normalized.normal.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "normal");
    if (parsed && !map.has(parsed.field)) {
      map.set(parsed.field, parsed);
    }
  });

  normalized.low.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "low");
    if (parsed && !map.has(parsed.field)) {
      map.set(parsed.field, parsed);
    }
  });

  return map;
}

function buildActiveBulletEntries(bulletControls = state.currentBulletControls) {
  return normalizeBulletControls(bulletControls)
    .filter((entry) => entry.priority !== "off")
    .map((entry) => parseStructuredBulletEntry(entry.text, entry.priority))
    .filter(Boolean);
}

function buildActiveBulletFieldMap(bulletControls = state.currentBulletControls) {
  const map = new Map();

  buildActiveBulletEntries(bulletControls).forEach((entry) => {
    if (!map.has(entry.field)) {
      map.set(entry.field, entry);
    }
  });

  return map;
}

function buildActiveBulletKeySet(bulletControls = state.currentBulletControls) {
  return new Set(
    buildActiveBulletEntries(bulletControls).map((entry) => buildTraitSelectionKey(entry.field, entry.value))
  );
}

function getPrimaryClarificationConflict(analysis = state.currentImageAnalysis) {
  if (!analysis || typeof analysis !== "object") {
    return null;
  }

  if (analysis.clarification_conflict && typeof analysis.clarification_conflict === "object") {
    return cloneValue(analysis.clarification_conflict);
  }

  const conflicts = Array.isArray(analysis.trait_conflicts) ? analysis.trait_conflicts : [];
  return conflicts.length ? cloneValue(conflicts[0]) : null;
}

function getStage2ClarificationText(analysis = state.currentImageAnalysis) {
  return String(
    analysis?.stage2?.visual_summary ||
    analysis?.visual_summary ||
    analysis?.free_text?.visual_summary ||
    ""
  ).trim();
}

function updateClarificationConflict(conflict = null) {
  state.clarificationConflict = conflict && typeof conflict === "object" ? cloneValue(conflict) : null;
  renderClarificationBar();
}

function updateCategoryRequirement(requirement = null) {
  state.categoryRequirement = requirement && typeof requirement === "object" ? cloneValue(requirement) : null;
  renderClarificationBar();
}

function buildClarificationSnapshot(conflict = state.clarificationConflict) {
  if (!conflict || !state.currentImageAnalysis) {
    return null;
  }

  return {
    image_url: String(state.currentImageAnalysis?.image_preview_url || "").trim(),
    focus_area: state.focusArea ? cloneValue(state.focusArea) : null,
    source_file_name: String(state.lastAnalyzeInput?.file_name || "").trim(),
    field: String(conflict.field || "").trim(),
    model_extracted_value: String(conflict.extracted_value || "").trim(),
    stage2_free_text: getStage2ClarificationText(state.currentImageAnalysis),
    conflict_evidence: String(conflict.evidence || "").trim(),
    search_query: getSearchComposerRequestQuery(state.lastQuery),
    active_bullets: normalizeSelectedBullets(state.currentSelectedBullets)
  };
}

async function persistTraitCorrection(snapshot = {}, userSelectedValue = null, wasSkipped = false) {
  const normalizedSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  await fetchJson("/api/trait-correction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...normalizedSnapshot,
      user_selected_value: userSelectedValue,
      was_skipped: Boolean(wasSkipped)
    })
  });
}

function applyClarificationToBulletControls(value, bulletControls = state.currentBulletControls) {
  const normalizedValue = normalizeTraitValue(value);
  let nextControls = normalizeBulletControls(
    (bulletControls || []).filter((entry) => {
      const parsed = parseStructuredBulletEntry(entry.text, entry.priority);
      if (!parsed) {
        return true;
      }
      if (parsed.field === "base_visibility") {
        return false;
      }
      if (normalizedValue === "integrated" && parsed.field === "base_type") {
        return false;
      }
      if (normalizedValue === "exposed" && parsed.field === "base_type" && normalizeTraitValue(parsed.value) === "integrated base") {
        return false;
      }
      return true;
    })
  );

  nextControls = normalizeBulletControls([
    ...nextControls,
    {
      text: `base visibility: ${normalizedValue === "integrated" ? "integrated" : "exposed"}`,
      priority: "essential"
    },
    ...(normalizedValue === "integrated"
      ? [{ text: "base type: integrated base", priority: "low" }]
      : [])
  ]);

  return nextControls;
}

function applyClarificationToImageAnalysis(value, selectedBullets) {
  const nextAnalysis = cloneValue(state.currentImageAnalysis || {});
  if (!nextAnalysis.image_traits || typeof nextAnalysis.image_traits !== "object") {
    nextAnalysis.image_traits = {};
  }

  const normalizedValue = normalizeTraitValue(value) === "integrated" ? "integrated" : "exposed";
  nextAnalysis.image_traits.base_visibility = normalizedValue;
  if (normalizedValue === "integrated") {
    nextAnalysis.image_traits.base_type = "integrated base";
  } else if (normalizeTraitValue(nextAnalysis.image_traits.base_type) === "integrated base") {
    delete nextAnalysis.image_traits.base_type;
  }

  nextAnalysis.search_bullets = normalizeSelectedBullets(selectedBullets);
  nextAnalysis.trait_conflicts = [];
  nextAnalysis.clarification_conflict = null;
  return nextAnalysis;
}

function clearImageAnalysisConflicts(analysis = state.currentImageAnalysis) {
  const nextAnalysis = cloneValue(analysis || {});
  nextAnalysis.trait_conflicts = [];
  nextAnalysis.clarification_conflict = null;
  return nextAnalysis;
}

function extractImageFilename(imageUrl = "") {
  const raw = String(imageUrl || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    return decodeURIComponent(parsed.pathname.split("/").pop() || raw);
  } catch {
    return raw.split("/").pop() || raw;
  }
}

function scoreBreakdownValue(breakdown = [], label = "") {
  const item = (breakdown || []).find((entry) => String(entry?.label || "").toLowerCase() === String(label || "").toLowerCase());
  return Number(item?.value || 0);
}

function traitFieldWeightScale(field = "") {
  const normalizedField = normalizeTraitFieldKey(field);
  if (!normalizedField) {
    return 1;
  }
  if (DEBUG_HIGH_WEIGHT_TRAIT_FIELDS.has(normalizedField)) {
    return 2;
  }
  if (DEBUG_LOW_WEIGHT_TRAIT_FIELDS.has(normalizedField)) {
    return 0.5;
  }
  return 1;
}

function essentialMissPenaltyValue(bulletValue = "") {
  const normalized = String(bulletValue || "").trim().toLowerCase();
  if (DEBUG_NEAR_MANDATORY_TERMS.some((term) => normalized.includes(term))) {
    return -0.55;
  }
  return -0.2;
}

function computeDebugTraitContribution(queryEntry, storedValue) {
  if (!queryEntry) {
    return { state: "neutral", contribution: 0 };
  }

  const normalizedStored = String(storedValue || "").trim().toLowerCase();
  const normalizedExpected = String(queryEntry.value || "").trim().toLowerCase();
  const weightScale = traitFieldWeightScale(queryEntry.field);

  if (normalizedStored && normalizedStored === normalizedExpected) {
    const base = queryEntry.priority === "essential" ? 0.35 : queryEntry.priority === "low" ? 0.05 : 0.1;
    return {
      state: "hit",
      contribution: Number((base * weightScale).toFixed(3))
    };
  }

  if (queryEntry.priority === "essential") {
    return {
      state: "miss",
      contribution: Number((essentialMissPenaltyValue(queryEntry.value) * weightScale).toFixed(3))
    };
  }

  return {
    state: "miss",
    contribution: 0
  };
}

function formatContribution(value = 0) {
  const numeric = Number(value || 0);
  if (!numeric) {
    return "0";
  }
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}`;
}

function closeDebugLightbox() {
  if (elements.debugLightbox) {
    elements.debugLightbox.hidden = true;
  }
}

function buildDebugScoreRows(payload = state.debugPayload || state.lastPayload) {
  const rows = [];

  (payload?.results || []).forEach((result, index) => {
    const heroImage = result.hero_image || normalizeMatchingImages(result)[0] || {};
    const breakdown = Array.isArray(heroImage.score_breakdown) && heroImage.score_breakdown.length
      ? heroImage.score_breakdown
      : (result.debug?.score_breakdown || []);

    rows.push({
      rank: index + 1,
      productName: result.name,
      imageUrl: heroImage.image_url || result.best_image_url || "",
      filename: extractImageFilename(heroImage.image_url || result.best_image_url || ""),
      imageCategory: formatDebugImageCategory(heroImage),
      totalScore: Number(heroImage.score || result.score || 0),
      embeddingScore: scoreBreakdownValue(breakdown, "embedding similarity"),
      traitBoost: scoreBreakdownValue(breakdown, "selected bullet boost"),
      sourceBonus: scoreBreakdownValue(breakdown, "source image exact-match boost"),
      enumFields: heroImage.enum_fields || result.debug?.image_traits || {},
      matchedTraits: heroImage.matched_traits || result.matched_traits || [],
      scoreBreakdown: breakdown
    });
  });

  return rows;
}

function getDebugScoreFields(selectedBullets = state.currentSelectedBullets) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  const ordered = [
    ...normalized.essential,
    ...normalized.normal,
    ...normalized.low
  ];
  const seen = new Set();
  const fields = [];

  ordered.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet);
    if (!parsed?.field || seen.has(parsed.field)) {
      return;
    }
    seen.add(parsed.field);
    fields.push(parsed.field);
  });

  return fields.length ? fields : [...DEBUG_SCORE_TRAIT_FIELDS];
}

function getDebugTraitGroups(fields = [], selectedBullets = state.currentSelectedBullets) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  const priorityByField = new Map();

  normalized.essential.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet);
    if (parsed?.field && !priorityByField.has(parsed.field)) {
      priorityByField.set(parsed.field, "High Priority");
    }
  });
  normalized.normal.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet);
    if (parsed?.field && !priorityByField.has(parsed.field)) {
      priorityByField.set(parsed.field, "Normal Priority");
    }
  });
  normalized.low.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet);
    if (parsed?.field && !priorityByField.has(parsed.field)) {
      priorityByField.set(parsed.field, "Low Priority");
    }
  });

  const groups = [
    { label: "High Priority", fields: [] },
    { label: "Normal Priority", fields: [] },
    { label: "Low Priority", fields: [] }
  ];

  fields.forEach((field) => {
    const label = priorityByField.get(field) || "Normal Priority";
    const group = groups.find((entry) => entry.label === label);
    group.fields.push(field);
  });

  return groups.filter((group) => group.fields.length);
}

function formatDebugImageCategory(image = {}) {
  const stage0 = String(image.stage_0_result || "").trim();
  const effectiveClassification = String(image.effective_classification || "").trim();
  const seatingType = String(
    image.seating_type ||
    image.stage1?.seating_type ||
    ""
  ).trim();
  const rawLabel = stage0 || "unknown";
  const effectiveLabel = effectiveClassification || rawLabel;
  const parts = [
    `raw: ${rawLabel}`,
    `effective: ${effectiveLabel}`
  ];

  if (seatingType) {
    parts.push(`seating: ${formatSeatingCategoryLabel(seatingType)}`);
  }

  return parts.join(" | ");
}

async function fetchDebugPayload() {
  const sourceImageUrl = state.currentImageAnalysis?.image_preview_url || "";
  if (!state.lastQuery || !sourceImageUrl) {
    state.debugPayload = state.lastPayload;
    return state.debugPayload;
  }

  if (Array.isArray(state.currentQueryEmbedding) && state.currentQueryEmbedding.length) {
    state.debugPayload = await fetchJson("/api/refine-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_embedding: state.currentQueryEmbedding,
        selected_bullets: normalizeSelectedBullets(state.currentSelectedBullets),
        category: normalizeCategoryFilter(state.categoryFilter),
        refresh_age: String(state.refreshAgeFilter || "").trim(),
        source_image_url: String(sourceImageUrl || "").trim(),
        seating_type: state.currentSeatingType,
        reranker_enabled: true,
        debug: true
      })
    });
    return state.debugPayload;
  }

  state.debugPayload = await fetchJson("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: state.lastQuery,
      source_image_url: sourceImageUrl,
      sort: state.sortMode,
      category: normalizeCategoryFilter(state.categoryFilter),
      refresh_age: state.refreshAgeFilter,
      seating_type: state.currentSeatingType,
      image_analysis: state.currentImageAnalysis,
      selected_bullets: normalizeSelectedBullets(state.currentSelectedBullets),
      debug: true
    })
  });
  return state.debugPayload;
}

async function renderDebugLightbox() {
  const payload = await fetchDebugPayload();
  const rows = buildDebugScoreRows(payload);
  const queryBulletMap = buildQueryBulletMap(state.currentSelectedBullets);
  const debugScoreFields = getDebugScoreFields(state.currentSelectedBullets);
  const debugTraitGroups = getDebugTraitGroups(debugScoreFields, state.currentSelectedBullets);
  const queryText = state.lastQuery || "Current search";
  const columnTotals = new Map(debugScoreFields.map((field) => [field, 0]));

  elements.debugLightboxSubtitle.textContent = `${rows.length} ranked products for "${queryText}"`;
  elements.debugScoreTableHead.innerHTML = "";
  elements.debugScoreTableBody.innerHTML = "";

  const groupHeaderRow = document.createElement("tr");
  groupHeaderRow.className = "debug-score-group-row";
  DEBUG_SCORE_CORE_HEADERS.forEach((header) => {
    const th = document.createElement("th");
    th.className = header.className || "";
    th.rowSpan = 2;
    th.innerHTML = `<span class="debug-score-header-main">${header.label}</span>`;
    groupHeaderRow.appendChild(th);
  });

  debugTraitGroups.forEach((group) => {
    const th = document.createElement("th");
    th.className = "debug-score-group-header";
    th.colSpan = group.fields.length;
    th.textContent = group.label;
    groupHeaderRow.appendChild(th);
  });

  const fieldHeaderRow = document.createElement("tr");
  fieldHeaderRow.className = "debug-score-field-row";
  debugScoreFields.forEach((field) => {
    const th = document.createElement("th");
    const queryEntry = queryBulletMap.get(field);
    const subLabel = queryEntry
      ? `${queryEntry.value}${queryEntry.priority === "essential" ? " · essential" : queryEntry.priority === "low" ? " · low" : ""}`
      : "";
    th.innerHTML = `
      <span class="debug-score-header-main">${formatTraitFieldLabel(field)}</span>
      <span class="debug-score-header-sub">${subLabel}</span>
    `;
    fieldHeaderRow.appendChild(th);
  });

  elements.debugScoreTableHead.append(groupHeaderRow, fieldHeaderRow);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const rankCell = document.createElement("td");
    rankCell.className = "debug-score-number";
    rankCell.textContent = String(row.rank);
    tr.appendChild(rankCell);

    const productCell = document.createElement("td");
    productCell.className = "debug-score-product";
    productCell.textContent = String(row.productName);
    tr.appendChild(productCell);

    const imageCell = document.createElement("td");
    imageCell.className = "debug-score-file";
    const imageWrap = document.createElement("div");
    imageWrap.className = "debug-score-image-wrap";
    if (row.imageUrl) {
      const thumbnail = document.createElement("img");
      thumbnail.className = "debug-score-image-thumb";
      thumbnail.src = row.imageUrl;
      thumbnail.alt = row.filename || row.productName || "Result image";
      thumbnail.loading = "lazy";
      imageWrap.appendChild(thumbnail);
    }
    const filename = row.imageUrl ? document.createElement("a") : document.createElement("span");
    filename.className = "debug-score-image-label";
    filename.textContent = row.filename || "";
    if (row.imageUrl) {
      filename.href = row.imageUrl;
      filename.target = "_blank";
      filename.rel = "noreferrer noopener";
    }
    imageWrap.appendChild(filename);
    imageCell.appendChild(imageWrap);
    tr.appendChild(imageCell);

    const imageCategoryCell = document.createElement("td");
    imageCategoryCell.className = "debug-score-file";
    imageCategoryCell.textContent = row.imageCategory || "unknown";
    tr.appendChild(imageCategoryCell);

    const scoreCells = [
      Number(row.totalScore || 0).toFixed(2),
      Number(row.embeddingScore || 0).toFixed(2),
      Number(row.traitBoost || 0).toFixed(2),
      Number(row.sourceBonus || 0).toFixed(2)
    ];
    scoreCells.forEach((value) => {
      const td = document.createElement("td");
      td.className = "debug-score-number";
      td.textContent = value;
      tr.appendChild(td);
    });

    debugScoreFields.forEach((field) => {
      const td = document.createElement("td");
      const queryEntry = queryBulletMap.get(field);
      const storedValue = String(row.enumFields?.[field] || "").trim();
      const contribution = computeDebugTraitContribution(queryEntry, storedValue);
      columnTotals.set(field, Number((columnTotals.get(field) + contribution.contribution).toFixed(3)));

      if (!queryEntry) {
        td.className = "debug-score-cell-neutral";
        const value = document.createElement("span");
        value.className = "debug-score-cell-empty";
        value.textContent = "";
        const meta = document.createElement("span");
        meta.className = "debug-score-cell-meta";
        meta.textContent = "0";
        td.append(value, meta);
      } else if (contribution.state === "hit") {
        td.className = "debug-score-cell-hit";
        const value = document.createElement("span");
        value.className = "debug-score-cell-value";
        value.textContent = storedValue;
        const meta = document.createElement("span");
        meta.className = "debug-score-cell-meta";
        meta.textContent = formatContribution(contribution.contribution);
        td.append(value, meta);
      } else {
        td.className = "debug-score-cell-miss";
        const value = document.createElement("span");
        value.className = "debug-score-cell-value";
        value.textContent = storedValue || "unknown";
        const meta = document.createElement("span");
        meta.className = "debug-score-cell-meta";
        meta.textContent = formatContribution(contribution.contribution);
        td.append(value, meta);
      }

      tr.appendChild(td);
    });

    elements.debugScoreTableBody.appendChild(tr);
  });

  const totalsRow = document.createElement("tr");
  totalsRow.className = "debug-score-totals-row";
  const totalsLeadCells = [
    "",
    "Column totals",
    "",
    "",
    "",
    "",
    "",
    ""
  ];
  totalsLeadCells.forEach((value, index) => {
    const td = document.createElement("td");
    if (index === 1) {
      td.className = "debug-score-product";
    }
    td.textContent = value;
    totalsRow.appendChild(td);
  });

  debugScoreFields.forEach((field) => {
    const td = document.createElement("td");
    td.className = "debug-score-cell-neutral";
    const value = document.createElement("span");
    value.className = "debug-score-cell-value";
    value.textContent = formatContribution(columnTotals.get(field));
    td.appendChild(value);
    totalsRow.appendChild(td);
  });
  elements.debugScoreTableBody.appendChild(totalsRow);

  elements.debugLightbox.hidden = false;
}

function buildDebugTableTsv() {
  const rows = buildDebugScoreRows(state.debugPayload || state.lastPayload);
  const queryBulletMap = buildQueryBulletMap(state.currentSelectedBullets);
  const debugScoreFields = getDebugScoreFields(state.currentSelectedBullets);
  const headers = [
    "Rank",
    "Product name",
    "Image filename",
    "Image category",
    "Total score",
    "Embedding score",
    "Trait boost",
    "Source bonus",
    ...debugScoreFields.map((field) => {
      const queryEntry = queryBulletMap.get(field);
      return queryEntry
        ? `${field} (${queryEntry.value}${queryEntry.priority === "essential" ? "; essential" : queryEntry.priority === "low" ? "; low" : ""})`
        : field;
    })
  ];

  const lines = [headers.join("\t")];
  rows.forEach((row) => {
    const values = [
      row.rank,
      row.productName,
      row.filename,
      row.imageCategory,
      Number(row.totalScore || 0).toFixed(2),
      Number(row.embeddingScore || 0).toFixed(2),
      Number(row.traitBoost || 0).toFixed(2),
      Number(row.sourceBonus || 0).toFixed(2),
      ...debugScoreFields.map((field) => {
        const queryEntry = queryBulletMap.get(field);
        const storedValue = String(row.enumFields?.[field] || "").trim();
        const contribution = computeDebugTraitContribution(queryEntry, storedValue);
        if (!storedValue && !queryEntry) {
          return "";
        }
        if (!storedValue) {
          return `unknown (${formatContribution(contribution.contribution)})`;
        }
        return `${storedValue} (${formatContribution(contribution.contribution)})`;
      })
    ];
    lines.push(values.join("\t"));
  });

  return lines.join("\n");
}

function normalizePriorityBulletList(values = []) {
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const bullet = String(value || "").trim();
    const key = bullet.toLowerCase();
    if (!bullet || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(bullet);
  }

  return normalized;
}

function normalizeSelectedBullets(selectedBullets = []) {
  if (Array.isArray(selectedBullets)) {
    const normalized = { essential: [], normal: [], low: [] };
    normalizePriorityBulletList(selectedBullets).forEach((bullet) => {
      const filtered = stripCategoryScopeFromSelectedBullets({
        normal: [bullet]
      }).normal[0];
      if (filtered) {
        normalized[defaultPriorityForBulletText(filtered)].push(filtered);
      }
    });
    return normalized;
  }

  if (!selectedBullets || typeof selectedBullets !== "object") {
    return { essential: [], normal: [], low: [] };
  }

  return stripCategoryScopeFromSelectedBullets({
    essential: normalizePriorityBulletList(selectedBullets.essential || []),
    normal: normalizePriorityBulletList(selectedBullets.normal || []),
    low: normalizePriorityBulletList(selectedBullets.low || [])
  });
}

function isAbsenceStyleMatchReason(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return ["no ", "none", "not visible", "concealed", "unknown", "without ", "absent", "hidden"].some((token) =>
    normalized.includes(token)
  );
}

function hasSelectedBullets(selectedBullets = []) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  return normalized.essential.length + normalized.normal.length + normalized.low.length > 0;
}

function normalizeBulletControls(bulletControls = []) {
  const seen = new Set();
  const normalized = [];

  for (const entry of bulletControls || []) {
    const text = String(entry?.text || entry?.value || "").trim();
    const priority = ["essential", "normal", "low", "off"].includes(entry?.priority)
      ? entry.priority
      : defaultPriorityForBulletText(text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ text, priority });
  }

  return normalized;
}

function buildBulletControlsFromBullets(bullets = []) {
  const normalized = normalizeSelectedBullets(bullets);
  return [
    ...normalized.essential.map((text) => ({ text, priority: "essential" })),
    ...normalized.normal.map((text) => ({ text, priority: "normal" })),
    ...normalized.low.map((text) => ({ text, priority: "low" }))
  ];
}

function deriveSelectedBulletsFromControls(bulletControls = []) {
  const selected = { essential: [], normal: [], low: [] };

  for (const entry of normalizeBulletControls(bulletControls)) {
    if (entry.priority === "essential") {
      selected.essential.push(entry.text);
    } else if (entry.priority === "normal") {
      selected.normal.push(entry.text);
    } else if (entry.priority === "low") {
      selected.low.push(entry.text);
    }
  }

  return selected;
}

function closeInlineRefinementPanel() {
  state.inlineRefinementPanel = null;
}

function autoResizeSearchInput() {
  if (!elements.searchInput) {
    return;
  }

  const searchField = elements.searchInput.closest(".search-field");
  if (!searchField) {
    return;
  }

  const computed = window.getComputedStyle(elements.searchInput);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 0;
  const inputHeight = elements.searchInput.getBoundingClientRect().height || 0;
  const isMultiline = lineHeight > 0 && inputHeight > lineHeight * 1.5;
  searchField.classList.toggle("is-multiline", isMultiline);
}

function getSearchInputValue() {
  if (!elements.searchInput) {
    return "";
  }

  return String(elements.searchInput.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setSearchInputValue(value = "") {
  if (!elements.searchInput) {
    return;
  }

  if (shouldShowSearchCategoryChip() && elements.searchCategorySuffix) {
    elements.searchCategorySuffix.hidden = !String(value || "").trim();
    elements.searchCategorySuffix.textContent = String(value || "");
    elements.searchInput.replaceChildren(
      ...(elements.searchCategoryPrefix && !elements.searchCategoryPrefix.hidden ? [elements.searchCategoryPrefix] : []),
      ...(elements.searchCategoryChipWrap && !elements.searchCategoryChipWrap.hidden ? [elements.searchCategoryChipWrap] : []),
      ...(String(value || "").trim() ? [elements.searchCategorySuffix] : [])
    );
  } else {
    elements.searchInput.replaceChildren();
    elements.searchInput.textContent = String(value || "");
  }
  autoResizeSearchInput();
}

function getSearchComposerTextParts() {
  if (!elements.searchInput) {
    return { prefix: "", match: "", suffix: "", plain: "" };
  }

  const showChip = shouldShowSearchCategoryChip() && elements.searchCategoryChipWrap && !elements.searchCategoryChipWrap.hidden;
  if (!showChip) {
    const plain = getSearchInputValue();
    return { prefix: "", match: "", suffix: plain, plain };
  }

  let seenChip = false;
  let prefix = "";
  let suffix = "";
  for (const node of elements.searchInput.childNodes) {
    if (node === elements.searchCategoryChipWrap) {
      seenChip = true;
      continue;
    }
    const text = String(node.textContent || "");
    if (!text) {
      continue;
    }
    if (seenChip) {
      suffix += text;
    } else {
      prefix += text;
    }
  }

  const normalize = (value = "") => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedPrefix = normalize(prefix);
  const normalizedSuffix = normalize(suffix);
  return {
    prefix: normalizedPrefix,
    match: "",
    suffix: normalizedSuffix,
    plain: [normalizedPrefix, normalizedSuffix].filter(Boolean).join(" ").trim()
  };
}

function isQueryComposableBullet(bullet = "") {
  const parsed = parseStructuredBulletEntry(bullet);
  return parsed ? parsed.field !== "base_material" : true;
}

function filterQueryComposableBullets(bullets = []) {
  return (bullets || []).filter((bullet) => isQueryComposableBullet(bullet));
}

function toggleInlineRefinementPanel(panel) {
  const current = state.inlineRefinementPanel;
  if (
    current &&
    current.productId === panel.productId &&
    current.mode === panel.mode
  ) {
    closeInlineRefinementPanel();
  } else {
    state.inlineRefinementPanel = {
      productId: panel.productId,
      mode: panel.mode,
      selectedTraitKeys: [],
      imageUrl: normalizeDisplayImageUrl(panel.imageUrl || "")
    };
  }

  renderResults(state.lastPayload, state.lastQuery);
}

function toggleInlineRefinementTraitSelection(productId, mode, traitKey) {
  const current = state.inlineRefinementPanel;
  if (!current || current.productId !== productId || current.mode !== mode) {
    return;
  }

  const selected = new Set(current.selectedTraitKeys || []);
  if (selected.has(traitKey)) {
    selected.delete(traitKey);
  } else {
    selected.add(traitKey);
  }

  state.inlineRefinementPanel = {
    ...current,
    selectedTraitKeys: [...selected]
  };
  renderResults(state.lastPayload, state.lastQuery);
}

function normalizeClientEmbedding(vector = []) {
  const values = Array.isArray(vector) ? vector.map((value) => Number(value) || 0) : [];
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    return [];
  }
  return values.map((value) => Number(value / norm));
}

function blendEmbedding(currentEmbedding = [], targetEmbedding = [], action = "more") {
  const normalizedCurrent = normalizeClientEmbedding(currentEmbedding);
  const normalizedTarget = normalizeClientEmbedding(targetEmbedding);

  return normalizeClientEmbedding(
    normalizedCurrent.map((value, index) =>
      action === "more"
        ? (value + (normalizedTarget[index] || 0)) / 2
        : value - (normalizedTarget[index] || 0)
    )
  );
}

function isUnknownTraitValue(value = "") {
  return ["", "unknown"].includes(normalizeTraitValue(value));
}

function isEligibleInlineRefinementField(field = "", typeKey = null) {
  const normalizedField = normalizeTraitFieldKey(field);
  if (!normalizedField || INLINE_REFINEMENT_EXCLUDED_FIELDS.has(normalizedField)) {
    return false;
  }

  const fieldConfig = getTraitFieldConfig(typeKey, normalizedField);
  if (fieldConfig && String(fieldConfig.detectability || "").trim().toLowerCase() !== "yes") {
    return false;
  }

  return true;
}

function formatInlineRefinementFieldLabel(field = "", typeKey = null) {
  const normalizedField = normalizeTraitFieldKey(field);
  if (INLINE_REFINEMENT_LABELS.has(normalizedField)) {
    return INLINE_REFINEMENT_LABELS.get(normalizedField);
  }

  const fieldConfig = getTraitFieldConfig(typeKey, normalizedField);
  if (fieldConfig?.label) {
    return String(fieldConfig.label).trim();
  }

  return formatTraitFieldLabel(normalizedField);
}

function hasPopulatedVisibleImageTraitValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return false;
  }

  const value = String(rawValue).trim();
  if (!value) {
    return false;
  }

  const normalizedValue = normalizeTraitValue(value);
  return normalizedValue !== "unknown" && normalizedValue !== "null";
}

function buildInlineRefinementTraits(imageTraits = {}, typeKey = null) {
  return Object.entries(imageTraits || {})
    .map(([field, rawValue]) => {
      const normalizedField = normalizeTraitFieldKey(field);
      const value = String(rawValue ?? "").trim();
      if (!isEligibleInlineRefinementField(normalizedField, typeKey)) {
        return null;
      }
      if (!hasPopulatedVisibleImageTraitValue(rawValue) || isPlaceholderSeatFabric(value)) {
        return null;
      }

      return {
        field: normalizedField,
        label: formatInlineRefinementFieldLabel(normalizedField, typeKey),
        value,
        text: `${formatInlineRefinementFieldLabel(normalizedField, typeKey)}: ${value}`,
        key: buildTraitSelectionKey(normalizedField, value)
      };
    })
    .filter(Boolean);
}

function normalizeProductRefinements(refinements = []) {
  return (refinements || [])
    .map((entry, index) => ({
      id: String(entry?.id || `${entry?.action || "more"}:${entry?.productId || entry?.product_id || index}`),
      productId: String(entry?.productId || entry?.product_id || "").trim(),
      name: String(entry?.name || "").trim(),
      action: entry?.action === "less" ? "less" : "more",
      embedding: normalizeClientEmbedding(entry?.embedding || entry?.visual_summary_embedding || [])
    }))
    .filter((entry) => entry.productId && entry.name && entry.embedding.length);
}

function computeQueryEmbeddingFromRefinements(baseEmbedding = [], refinements = []) {
  return normalizeProductRefinements(refinements).reduce(
    (embedding, refinement) => blendEmbedding(embedding, refinement.embedding, refinement.action),
    normalizeClientEmbedding(baseEmbedding)
  );
}

function buildFallbackQueryFromStructuredBullets(selectedBullets = []) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  return filterQueryComposableBullets([
    ...normalized.essential,
    ...normalized.normal,
    ...normalized.low
  ]).join(", ");
}

function closeRefineDrawer() {
  state.refineDrawerOpen = false;
  elements.resultsSidebar?.classList.remove("is-open");
  elements.refineDrawerBackdrop.hidden = true;
}

function openRefineDrawer() {
  if (elements.resultsSidebar?.hidden) {
    return;
  }
  state.refineDrawerOpen = true;
  elements.resultsSidebar.classList.add("is-open");
  elements.refineDrawerBackdrop.hidden = false;
}

function syncRefineDrawer() {
  if (!elements.resultsSidebar || elements.resultsSidebar.hidden) {
    closeRefineDrawer();
    return;
  }

  elements.resultsSidebar.classList.toggle("is-open", state.refineDrawerOpen);
  elements.refineDrawerBackdrop.hidden = !state.refineDrawerOpen;
}

async function fetchJson(url, options) {
  const requestUrl = apiUrl(url);
  const mergedOptions = {
    cache: "no-store",
    ...options,
    headers: {
      ...(options?.headers || {}),
      "Cache-Control": "no-store"
    }
  };
  let response;
  try {
    response = await fetch(requestUrl, mergedOptions);
  } catch (error) {
    throw new Error("Failed to reach the local server. Refresh the page and try again.");
  }
  const responseText = await response.text();
  let payload = null;

  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${responseText || response.statusText}`);
    }
    throw new Error("Server returned a non-JSON response.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function refreshProductAi(productId) {
  if (!productId) {
    throw new Error("Missing product id for refresh.");
  }

  return fetchJson("/api/refresh-product", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId })
  });
}

async function refreshProductsBatch(productIds = []) {
  return fetchJson("/api/refresh-products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_ids: productIds })
  });
}

async function fetchSceneFilterProgress() {
  return fetchJson("/api/scene-filter-progress");
}

async function fetchExtractionSummary() {
  return fetchJson("/api/extraction-summary");
}

function formatSummaryMetric(count = 0, total = 0) {
  const normalizedTotal = Number(total) || 0;
  const normalizedCount = Number(count) || 0;
  const rate = normalizedTotal > 0 ? `${((normalizedCount / normalizedTotal) * 100).toFixed(1)}%` : "0.0%";
  return `${normalizedCount.toLocaleString()} of ${normalizedTotal.toLocaleString()} images (${rate})`;
}

function renderExtractionSummary(summary = state.extractionSummary) {
  if (!elements.extractionSummaryContent) {
    return;
  }
  if (!summary) {
    elements.extractionSummaryContent.innerHTML = '<p class="rules-summary-intro">No extraction summary available.</p>';
    return;
  }

  const totalImages = Number(summary.total_images) || 0;
  const categories = Array.isArray(summary.categories) ? summary.categories : [];
  const generatedAt = String(summary.generated_at || "").trim();

  const cards = [
    {
      title: "Stage 1 caught product detail missed by Stage 0",
      value: formatSummaryMetric(summary.stage1_product_detail_missed_by_stage0, totalImages)
    },
    {
      title: "Tiebreakers triggered",
      value: formatSummaryMetric(summary.tiebreakers_triggered, totalImages)
    }
  ];

  const wrapper = document.createElement("div");
  wrapper.className = "extraction-summary-grid";

  cards.forEach((cardData) => {
    const card = document.createElement("article");
    card.className = "rules-card extraction-summary-card";

    const title = document.createElement("h3");
    title.className = "rules-card-title";
    title.textContent = cardData.title;

    const value = document.createElement("p");
    value.className = "extraction-summary-metric";
    value.textContent = cardData.value;

    card.append(title, value);
    wrapper.appendChild(card);
  });

  const tableCard = document.createElement("article");
  tableCard.className = "rules-card extraction-summary-table-card";

  const tableTitle = document.createElement("h3");
  tableTitle.className = "rules-card-title";
  tableTitle.textContent = "By Stage 1 category";

  const tableMeta = document.createElement("p");
  tableMeta.className = "rules-summary-intro";
  tableMeta.textContent = generatedAt
    ? `Latest snapshot: ${new Date(generatedAt).toLocaleString()}`
    : "Latest snapshot unavailable.";

  const tableWrap = document.createElement("div");
  tableWrap.className = "extraction-summary-table-wrap";

  const table = document.createElement("table");
  table.className = "extraction-summary-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Stage 1 category</th>
        <th>All images</th>
        <th>Stage 1 detail catches</th>
        <th>Tiebreakers</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  categories.forEach((entry) => {
    const tr = document.createElement("tr");
    const total = Number(entry.total_images) || 0;
    const detailMiss = Number(entry.stage1_product_detail_missed_by_stage0) || 0;
    const tiebreakers = Number(entry.tiebreakers_triggered) || 0;
    tr.innerHTML = `
      <td>${formatSeatingCategoryLabel(entry.category_key)}</td>
      <td>${total.toLocaleString()}</td>
      <td>${detailMiss.toLocaleString()}</td>
      <td>${tiebreakers.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  tableCard.append(tableTitle, tableMeta, tableWrap);

  const note = document.createElement("p");
  note.className = "rules-summary-intro";
  note.textContent = "Product-detail overrides fall into Unspecified because stage 1 intentionally returns no seating category when it rejects an image as detail-only.";

  elements.extractionSummaryContent.innerHTML = "";
  elements.extractionSummaryContent.append(wrapper, tableCard, note);
}

async function resumeSceneFilterProgress() {
  return fetchJson("/api/scene-filter-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
}

function closeBatchRefreshStream() {
  if (state.batchRefreshPollTimer) {
    clearInterval(state.batchRefreshPollTimer);
    state.batchRefreshPollTimer = null;
  }
}

function closeSceneFilterProgressStream() {
  if (state.sceneFilterPollTimer) {
    clearInterval(state.sceneFilterPollTimer);
    state.sceneFilterPollTimer = null;
  }
}

function normalizeBatchRefreshProgress(payload = {}) {
  const total = Math.max(0, Number(payload.total) || 0);
  const completed = Math.max(0, Number(payload.completed) || 0);
  const failed = Math.max(0, Number(payload.failed) || 0);
  const left = Math.max(0, Number(payload.left) || Math.max(total - completed, 0));
  const batchCurrent = Math.max(0, Number(payload.current_batch ?? payload.batch_current) || 0);
  const batchTotal = Math.max(0, Number(payload.total_batches ?? payload.batch_total) || 0);
  const done = Boolean(payload.done);
  const processedImages = Math.max(0, Number(payload.processed_images) || 0);
  const productPhotos = Math.max(0, Number(payload.product_photos) || 0);
  const scenePhotos = Math.max(0, Number(payload.scene_photos) || 0);
  const detailPhotos = Math.max(0, Number(payload.detail_photos) || 0);
  const unclassifiedPhotos = Math.max(0, processedImages - (productPhotos + scenePhotos + detailPhotos));

  return {
    status: done ? "complete" : (payload.running ? "running" : "idle"),
    startedAt: String(payload.started_at || "").trim(),
    total,
    completed,
    succeeded: Math.max(0, completed - failed),
    failed,
    left,
    batchCurrent,
    batchTotal,
    currentProductName: String(payload.current_product || "").trim(),
    currentImageUrl: String(payload.current_image_url || "").trim(),
    currentProductImagesPassed: Math.max(0, Number(payload.current_product_images_passed) || 0),
    currentRun: String(payload.current_run || "").trim(),
    processedImages,
    productPhotos,
    scenePhotos,
    detailPhotos,
    unclassifiedPhotos,
    totalCostUsd: Math.max(0, Number(payload.total_cost_usd) || 0),
    log: Array.isArray(payload.log) ? payload.log.slice(0, 8) : [],
    failedProducts: Array.isArray(payload.failed_products) ? payload.failed_products : []
  };
}

function formatElapsedTime(startedAt = "") {
  const timestamp = Date.parse(String(startedAt || "").trim());
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const totalSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function renderBatchRefreshProgress() {
  const progress = state.batchRefreshProgress;
  if (!progress || !elements.batchRefreshProgress) {
    return;
  }

  const totalLabel = progress.total === 1 ? "product" : "products";
  const isComplete = progress.status === "complete";
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  elements.batchRefreshHeadline.textContent = isComplete
    ? `Complete — ${progress.succeeded} succeeded, ${progress.failed} failed`
    : `Analyzing ${progress.total} ${totalLabel}...`;
  elements.batchRefreshMeterFill.style.width = `${percent}%`;
  elements.batchRefreshCount.textContent = `${progress.completed} of ${progress.total}`;
  elements.batchRefreshBatchLabel.textContent = `Batch ${progress.batchCurrent} of ${progress.batchTotal}`;
  elements.batchRefreshCurrent.textContent = isComplete
    ? "Processing finished."
    : `Currently: ${progress.currentProductName || "waiting to start"}`;
  if (elements.batchRefreshImage) {
    elements.batchRefreshImage.textContent = isComplete
      ? "Current image: complete"
      : `Current image: ${progress.currentImageUrl || "waiting to start"}`;
  }
  if (elements.batchRefreshImagesPassed) {
    elements.batchRefreshImagesPassed.hidden = true;
  }
  if (elements.batchRefreshRun) {
    elements.batchRefreshRun.textContent = isComplete
      ? "Current run: complete"
      : `Current run: ${progress.currentRun || "waiting to start"}`;
  }
  if (elements.batchRefreshCost) {
    const avgImageCost = progress.processedImages
      ? Number(progress.totalCostUsd || 0) / progress.processedImages
      : 0;
    const avgProductCost = progress.completed
      ? Number(progress.totalCostUsd || 0) / progress.completed
      : 0;
    const elapsed = formatElapsedTime(progress.startedAt);
    elements.batchRefreshCost.textContent =
      `Cost: $${Number(progress.totalCostUsd || 0).toFixed(6)} • Avg/image: $${avgImageCost.toFixed(6)} • Avg/product: $${avgProductCost.toFixed(6)}${elapsed ? ` • Elapsed: ${elapsed}` : ""}`;
  }
  const productLabel = progress.succeeded === 1 ? "Product" : "Products";
  const imageLabel = progress.processedImages === 1 ? "Image" : "Images";
  const classificationSummary = progress.unclassifiedPhotos > 0
    ? `${progress.productPhotos} Product, ${progress.scenePhotos} Scene, ${progress.detailPhotos} Detail, ${progress.unclassifiedPhotos} Unclassified`
    : `${progress.productPhotos} Product, ${progress.scenePhotos} Scene, ${progress.detailPhotos} Detail`;
  elements.batchRefreshSummary.textContent = `Done: ${progress.succeeded} ${productLabel} | ${progress.processedImages} ${imageLabel} (${classificationSummary}) Failed: ${progress.failed} Left: ${progress.left}`;
  elements.batchRefreshCloseButton.hidden = !isComplete;

  elements.batchRefreshLog.innerHTML = "";
  progress.log.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `batch-refresh-log-entry${entry.status === "failed" ? " failed" : ""}`;
    if (entry.status === "failed") {
      item.textContent = `✗ ${entry.name || entry.product_id || "Unknown product"}${entry.error ? ` — ${entry.error}` : " — failed"}`;
    } else {
      const typeLabel = entry.type ? ` (${entry.type})` : "";
      item.textContent = `✓ ${entry.name || entry.product_id || "Unknown product"}${typeLabel}`;
    }
    elements.batchRefreshLog.appendChild(item);
  });

  const failedProducts = progress.failedProducts.filter((entry) => entry?.name);
  elements.batchRefreshFailures.hidden = !isComplete || !failedProducts.length;
  elements.batchRefreshFailures.textContent = failedProducts.length
    ? `Failed: ${failedProducts.map((entry) => entry.name).join(", ")}`
    : "";
}

function updateBatchRefreshProgress(payload = {}) {
  state.batchRefreshProgress = normalizeBatchRefreshProgress(payload);
  state.batchRefreshProgressVisible = true;
  try {
    if (payload?.running && !payload?.done) {
      window.localStorage.removeItem(BATCH_PROGRESS_DISMISS_KEY);
    }
  } catch {}
  renderBatchRefreshProgress();
  syncManageToolbar();
}

function dismissBatchRefreshProgress() {
  state.batchRefreshProgressVisible = false;
  try {
    const progress = state.batchRefreshProgress || {};
    const dismissToken = JSON.stringify({
      started_at: String(progress.startedAt || "").trim(),
      completed: Number(progress.completed || 0),
      total: Number(progress.total || 0),
      done: Boolean(progress.status === "complete")
    });
    window.localStorage.setItem(BATCH_PROGRESS_DISMISS_KEY, dismissToken);
  } catch {}
  syncManageToolbar();
}

function normalizeSceneFilterProgress(payload = {}) {
  if (!payload?.available) {
    return null;
  }

  return {
    running: Boolean(payload.running),
    done: Boolean(payload.done),
    stale: Boolean(payload.stale),
    total: Math.max(0, Number(payload.total) || 0),
    completed: Math.max(0, Number(payload.completed) || 0),
    left: Math.max(0, Number(payload.left) || 0),
    imagesChecked: Math.max(0, Number(payload.images_checked) || 0),
    productPhotos: Math.max(0, Number(payload.product_photos) || 0),
    scenePhotos: Math.max(0, Number(payload.scene_photos) || 0),
    productPhotoPct: Number(payload.product_photo_pct) || 0,
    scenePhotoPct: Number(payload.scene_photo_pct) || 0,
    inputTokens: Math.max(0, Number(payload.input_tokens) || 0),
    outputTokens: Math.max(0, Number(payload.output_tokens) || 0),
    totalTokens: Math.max(0, Number(payload.total_tokens) || 0),
    avgTotalTokensPerImage: Number(payload.avg_total_tokens_per_image) || 0,
    estimatedInputCostUsd: Number(payload.estimated_input_cost_usd) || 0,
    estimatedOutputCostUsd: Number(payload.estimated_output_cost_usd) || 0,
    estimatedTotalCostUsd: Number(payload.estimated_total_cost_usd) || 0,
    avgCostPerImageUsd: Number(payload.avg_cost_per_image_usd) || 0,
    modelVersion: String(payload.model_version || "").trim(),
    detail: String(payload.detail || "").trim(),
    label: String(payload.label || "").trim(),
    lastProductId: String(payload.last_product_id || "").trim(),
    updatedAt: String(payload.updated_at || "").trim(),
    log: Array.isArray(payload.log) ? payload.log.slice(0, 8) : []
  };
}

function renderSceneFilterProgress() {
  const progress = state.sceneFilterProgress;
  if (!elements.sceneFilterProgressPanel) {
    return;
  }
  if (!progress) {
    elements.sceneFilterProgressPanel.hidden = true;
    return;
  }

  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  let headline = "Stage 0 Scene Filter";
  if (progress.done) {
    headline = "Stage 0 Scene Filter Complete";
  } else if (progress.stale) {
    headline = "Stage 0 Scene Filter Paused";
  } else if (progress.running) {
    headline = "Stage 0 Scene Filter Running";
  }
  if (progress.label) {
    headline = `${headline} — ${progress.label}`;
  }

  elements.sceneFilterProgressPanel.hidden = false;
  if (elements.sceneFilterProgressDetails) {
    elements.sceneFilterProgressDetails.open = !progress.done;
  }
  elements.sceneFilterProgressHeadline.textContent = headline;
  elements.sceneFilterProgressLeft.textContent = `Left: ${progress.left}`;
  elements.sceneFilterProgressMeterFill.style.width = `${percent}%`;
  elements.sceneFilterProgressCount.textContent = `${progress.completed} of ${progress.total}`;
  elements.sceneFilterProgressMeta.textContent = `Model: ${progress.modelVersion || "unknown"} • Detail: ${progress.detail || "unknown"}`;
  elements.sceneFilterProgressCurrent.textContent = progress.done
    ? "Processing finished."
    : progress.stale
      ? `Last product: ${progress.lastProductId || "unknown"}`
      : `Currently: ${progress.lastProductId || "waiting to start"}`;
  elements.sceneFilterProgressSummary.textContent = `Images: ${progress.imagesChecked} • Product: ${progress.productPhotos} (${progress.productPhotoPct}%) • Scene: ${progress.scenePhotos} (${progress.scenePhotoPct}%)`;
  elements.sceneFilterProgressCostSummary.textContent = `Total tokens this run: ${progress.totalTokens}${progress.imagesChecked ? ` • Avg tokens/image: ${progress.avgTotalTokensPerImage}` : ""}`;
  elements.sceneFilterProgressEstimateSummary.textContent = "";
  if (progress.estimatedTotalCostUsd > 0) {
    elements.sceneFilterProgressEstimateSummary.textContent = `Est. total cost: $${progress.estimatedTotalCostUsd.toFixed(4)} • Est. avg cost/image: $${progress.avgCostPerImageUsd.toFixed(6)}`;
  }
  if (elements.sceneFilterProgressSummaryLine) {
    elements.sceneFilterProgressSummaryLine.textContent = progress.done
      ? `Stage 0 complete — ${progress.productPhotos} product images, ${progress.scenePhotos} scene images, $${progress.estimatedTotalCostUsd.toFixed(4)} total cost`
      : headline;
  }
  if (elements.sceneFilterResumeButton) {
    elements.sceneFilterResumeButton.hidden = !(progress.stale && !progress.done && !progress.running);
    elements.sceneFilterResumeButton.disabled = progress.running;
  }

  elements.sceneFilterProgressLog.innerHTML = "";
  progress.log.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `batch-refresh-log-entry${entry.status === "failed" ? " failed" : ""}`;
    const tokenLabel = entry.total_tokens ? ` • ${entry.total_tokens} tok` : "";
    item.textContent = `${formatStage0ResultLabel(entry.result) || "Product"} • ${entry.product_id || "unknown product"}${tokenLabel}`;
    elements.sceneFilterProgressLog.appendChild(item);
  });
}

function updateSceneFilterProgress(payload = {}) {
  state.sceneFilterProgress = normalizeSceneFilterProgress(payload);
  renderSceneFilterProgress();
}

async function pollBatchRefreshStatus() {
  const payload = await fetchJson("/api/reindex-status");
  updateBatchRefreshProgress(payload);

  if (payload.done) {
    closeBatchRefreshStream();
    state.batchRefreshing = false;
    try {
      state.bootstrap = await fetchJson("/api/bootstrap");
    } catch {}
    await runSearch(state.lastQuery || "", {
      sort: state.sortMode,
      sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
      imageAnalysis: state.currentImageAnalysis,
      selectedBullets: state.currentSelectedBullets,
      bulletControls: state.currentBulletControls
    });
    setStatus(
      payload.failed
        ? `Complete — ${Math.max(0, (payload.completed || 0) - (payload.failed || 0))} succeeded, ${payload.failed} failed.`
        : `Complete — ${payload.completed || 0} succeeded, 0 failed.`
    );
  }
}

function openBatchRefreshStream() {
  closeBatchRefreshStream();
  state.batchRefreshPollTimer = window.setInterval(() => {
    pollBatchRefreshStatus().catch((error) => {
      closeBatchRefreshStream();
      state.batchRefreshing = false;
      setStatus(error.message || "Failed to load batch refresh status.", "error");
      syncManageToolbar();
    });
  }, 2000);
}

async function refineSearchResults({
  queryEmbedding = state.currentQueryEmbedding,
  selectedBullets = state.currentSelectedBullets,
  seatingType = state.currentSeatingType,
  categoryFilter = state.categoryFilter,
  refreshAgeFilter = state.refreshAgeFilter,
  sourceImageUrl = state.currentImageAnalysis?.image_preview_url || "",
  rerankerEnabled = true,
  action = "",
  productId = ""
} = {}) {
  return fetchJson("/api/refine-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      selected_bullets: normalizeSelectedBullets(selectedBullets),
      category: normalizeCategoryFilter(categoryFilter),
      refresh_age: String(refreshAgeFilter || "").trim(),
      source_image_url: String(sourceImageUrl || "").trim(),
      reranker_enabled: Boolean(rerankerEnabled),
      seating_type: seatingType,
      ...(action && productId ? { action, product_id: productId } : {})
    })
  });
}

function updateResetSearchVisibility() {
  if (!elements.resetSearchButton) {
    return;
  }
  elements.resetSearchButton.hidden = !state.refinementActive || !state.originalPayload;
}

function applyActiveSearchContext({
  payload,
  query,
  selectedBullets = { essential: [], normal: [], low: [] },
  bulletControls = [],
  baseQueryEmbedding = null,
  seatingType = "",
  imageAnalysis = null,
  productRefinements = [],
  categoryFilter = "",
  refreshAgeFilter = "",
  preserveOriginal = false,
  refinementActive = false
}) {
  state.lastQuery = String(query || "").trim();
  state.currentBaseQueryEmbedding = Array.isArray(baseQueryEmbedding) ? [...baseQueryEmbedding] : Array.isArray(payload?.query_embedding) ? payload.query_embedding : [];
  state.currentQueryEmbedding = Array.isArray(payload?.query_embedding) ? payload.query_embedding : [];
  state.currentSelectedBullets = normalizeSelectedBullets(selectedBullets);
  state.currentBulletControls = normalizeBulletControls(
    bulletControls.length ? bulletControls : [
      ...state.currentSelectedBullets.essential.map((text) => ({ text, priority: "essential" })),
      ...state.currentSelectedBullets.normal.map((text) => ({ text, priority: "normal" })),
      ...state.currentSelectedBullets.low.map((text) => ({ text, priority: "low" }))
    ]
  );
  state.pendingBulletControls = null;
  state.currentSeatingType = String(seatingType || "").trim().toLowerCase() === "all" ? "" : String(seatingType || "").trim();
  state.categoryScopeMode = String(payload?.seating_type_source || "").trim() || (state.currentSeatingType ? "explicit" : "all");
  state.currentImageAnalysis = imageAnalysis && typeof imageAnalysis === "object" ? cloneValue(imageAnalysis) : null;
  updateCategoryRequirement(null);
  state.currentProductRefinements = normalizeProductRefinements(productRefinements);
  state.categoryFilter = normalizeCategoryFilter(categoryFilter);
  const resolvedSearchCategory = String(
    seatingType ||
    payload?.seating_type ||
    payload?.parsed?.seating_type ||
    ""
  ).trim().toLowerCase();
  state.resultCategoryScope = state.categoryScopeMode === "inferred" && resolvedSearchCategory
    ? [resolvedSearchCategory]
    : state.categoryScopeMode === "explicit" && resolvedSearchCategory
      ? [resolvedSearchCategory]
      : ["all"];
  state.refreshAgeFilter = String(refreshAgeFilter || "").trim();
  state.refinementActive = refinementActive;
  state.debugPayload = null;
  state.inlineRefinementPanel = null;
  state.activeCardImageUrls = {};

  if (elements.categoryFilterButton) {
    elements.categoryFilterButton.textContent = formatCategoryFilterLabel(state.categoryFilter);
  }
  if (elements.categoryFilterOptions) {
    elements.categoryFilterOptions.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = state.categoryFilter.includes(input.value);
    });
  }
  if (elements.refreshAgeFilterSelect && elements.refreshAgeFilterSelect.value !== state.refreshAgeFilter) {
    elements.refreshAgeFilterSelect.value = state.refreshAgeFilter;
  }

  if (!preserveOriginal) {
    state.originalPayload = cloneValue(payload);
    state.originalQuery = query;
    state.originalBaseQueryEmbedding = Array.isArray(baseQueryEmbedding) ? [...baseQueryEmbedding] : Array.isArray(payload?.query_embedding) ? [...payload.query_embedding] : [];
    state.originalQueryEmbedding = Array.isArray(payload?.query_embedding) ? [...payload.query_embedding] : [];
    state.originalSelectedBullets = normalizeSelectedBullets(selectedBullets);
    state.originalBulletControls = normalizeBulletControls(state.currentBulletControls);
    state.originalSeatingType = String(seatingType || "").trim().toLowerCase() === "all" ? "" : String(seatingType || "").trim();
    state.originalImageAnalysis = imageAnalysis && typeof imageAnalysis === "object" ? cloneValue(imageAnalysis) : null;
    state.originalProductRefinements = normalizeProductRefinements(productRefinements);
    state.originalCategoryFilter = [...state.categoryFilter];
    state.originalResultCategoryScope = [...state.resultCategoryScope];
    state.originalCategoryScopeMode = state.categoryScopeMode;
    state.originalRefreshAgeFilter = state.refreshAgeFilter;
  }

  renderCategoryFilterOptions(
    isBrowsePayload(payload, query)
      ? (state.bootstrap?.categories || [])
      : [],
    { payload, query }
  );
  renderSearchComposer(query);
  syncSearchPageUrl();
  updateResetSearchVisibility();
  syncRefineDrawer();
}

function summarizeRefinementChanges(previousPayload, nextPayload, actionLabel, productName) {
  const previous = Array.isArray(previousPayload?.results) ? previousPayload.results : [];
  const next = Array.isArray(nextPayload?.results) ? nextPayload.results : [];
  const previousRanks = new Map(previous.map((result, index) => [result.product_id, index + 1]));
  const changes = next
    .slice(0, 8)
    .map((result, index) => {
      const beforeRank = previousRanks.get(result.product_id) || null;
      const afterRank = index + 1;
      if (beforeRank === afterRank) {
        return null;
      }
      return {
        name: result.name,
        beforeRank,
        afterRank,
        delta: beforeRank ? beforeRank - afterRank : 0
      };
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  if (!changes.length) {
    return `Refined ${actionLabel} ${productName}. The query embedding changed, but the top results stayed nearly the same.`;
  }

  const headline = changes
    .slice(0, 3)
    .map((change) => `${change.name} ${change.beforeRank ? `${change.beforeRank}\u2192${change.afterRank}` : `\u2192${change.afterRank}`}`)
    .join(" | ");

  return `Refined ${actionLabel} ${productName}. Biggest visible changes: ${headline}.`;
}

async function rerankResults({
  queryEmbedding = state.currentQueryEmbedding,
  query = state.lastQuery,
  bulletControls = state.currentBulletControls,
  baseQueryEmbedding = state.currentBaseQueryEmbedding,
  productRefinements = state.currentProductRefinements,
  statusMessage = "Re-ranking results..."
} = {}) {
  const previousPayload = cloneValue(state.lastPayload);
  const selectedBullets = deriveSelectedBulletsFromControls(bulletControls);

  state.refinementLoading = true;
  renderRefineSidebar();
  renderResults(state.lastPayload, state.lastQuery);
  setStatus(statusMessage);

  try {
    const payload = await refineSearchResults({
      queryEmbedding,
      selectedBullets,
      seatingType: state.currentSeatingType,
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter
    });
    applyActiveSearchContext({
      payload,
      query,
      selectedBullets,
      bulletControls,
      baseQueryEmbedding,
      seatingType: state.currentSeatingType,
      imageAnalysis: state.currentImageAnalysis,
      productRefinements,
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter,
      preserveOriginal: true,
      refinementActive: true
    });
    state.refinementLoading = false;
    renderResults(payload, state.lastQuery);
    return { payload, previousPayload };
  } catch (error) {
    state.refinementLoading = false;
    renderResults(state.lastPayload, state.lastQuery);
    setStatus(error.message || "Search refinement failed.", "error");
    throw error;
  }
}

async function dismissClarificationPrompt() {
  const snapshot = buildClarificationSnapshot();
  if (state.currentImageAnalysis && typeof state.currentImageAnalysis === "object") {
    state.currentImageAnalysis = clearImageAnalysisConflicts(state.currentImageAnalysis);
  }
  updateClarificationConflict(null);
  if (!snapshot) {
    return;
  }

  try {
    await persistTraitCorrection(snapshot, null, true);
  } catch (error) {
    setStatus(error.message || "Failed to store clarification dismissal.", "error");
  }
}

async function applyClarificationSelection(selectedValue) {
  const normalizedValue = normalizeTraitValue(selectedValue);
  if (!["integrated", "exposed"].includes(normalizedValue)) {
    return;
  }

  const snapshot = buildClarificationSnapshot();
  const previousPayloadSnapshot = cloneValue(state.lastPayload);
  const nextControls = applyClarificationToBulletControls(normalizedValue, state.currentBulletControls);
  const nextSelectedBullets = deriveSelectedBulletsFromControls(nextControls);
  const nextImageAnalysis = applyClarificationToImageAnalysis(normalizedValue, nextSelectedBullets);
  const nextQuery = await composeQueryWithFallback(nextSelectedBullets, { silent: true });

  setSearchInputValue(nextQuery);
  updateClarificationConflict(null);
  void persistTraitCorrection(snapshot, normalizedValue, false).catch((error) => {
    setStatus(error.message || "Failed to store trait correction.", "error");
  });

  const basePayload = await runSearch(nextQuery, {
    sort: state.sortMode,
    sourceImageUrl: nextImageAnalysis?.image_preview_url || state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: nextImageAnalysis,
    selectedBullets: nextSelectedBullets,
    bulletControls: nextControls,
    preserveOriginal: true,
    refinementActive: true,
    productRefinements: []
  });
  if (!basePayload) {
    return;
  }

  let payload = basePayload;
  let previousPayload = cloneValue(state.originalPayload);

  if (state.currentProductRefinements.length) {
    previousPayload = cloneValue(state.lastPayload);
    const nextEmbedding = computeQueryEmbeddingFromRefinements(basePayload?.query_embedding || [], state.currentProductRefinements);
    const reranked = await rerankResults({
      queryEmbedding: nextEmbedding,
      query: nextQuery,
      bulletControls: nextControls,
      baseQueryEmbedding: basePayload?.query_embedding || [],
      productRefinements: state.currentProductRefinements,
      statusMessage: "Applying clarification..."
    });
    payload = reranked.payload;
    previousPayload = reranked.previousPayload;
  } else {
    previousPayload = previousPayloadSnapshot;
    setStatus("Applying clarification...");
  }

  setStatus("");
}

async function updateBulletPriority(index, priority) {
  const sourceControls = normalizeBulletControls(state.pendingBulletControls || state.currentBulletControls);
  state.pendingBulletControls = normalizeBulletControls(
    sourceControls.map((entry, currentIndex) =>
      currentIndex === index ? { ...entry, priority } : entry
    )
  );
  renderRefineSidebar();
}

async function applyPendingBulletPriorities() {
  const pendingControls = normalizeBulletControls(state.pendingBulletControls || []);
  const currentControls = normalizeBulletControls(state.currentBulletControls);
  const hasChanges = pendingControls.length && JSON.stringify(pendingControls) !== JSON.stringify(currentControls);

  if (!hasChanges) {
    state.pendingBulletControls = null;
    renderRefineSidebar();
    return;
  }

  const previousPayloadSnapshot = cloneValue(state.lastPayload);
  const nextSelectedBullets = deriveSelectedBulletsFromControls(pendingControls);
  const nextQuery = await composeQueryWithFallback(nextSelectedBullets, { silent: true });
  setSearchInputValue(nextQuery);

  const basePayload = await runSearch(nextQuery, {
    sort: state.sortMode,
    sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: state.currentImageAnalysis,
    selectedBullets: nextSelectedBullets,
    bulletControls: pendingControls,
    preserveOriginal: true,
    refinementActive: true,
    productRefinements: []
  });
  if (!basePayload) {
    return;
  }

  let previousPayload = cloneValue(state.originalPayload);

  if (state.currentProductRefinements.length) {
    previousPayload = cloneValue(state.lastPayload);
    const nextEmbedding = computeQueryEmbeddingFromRefinements(basePayload?.query_embedding || [], state.currentProductRefinements);
    const reranked = await rerankResults({
      queryEmbedding: nextEmbedding,
      query: nextQuery,
      bulletControls: pendingControls,
      baseQueryEmbedding: basePayload?.query_embedding || [],
      productRefinements: state.currentProductRefinements,
      statusMessage: ""
    });
    previousPayload = reranked.previousPayload;
  } else {
    previousPayload = previousPayloadSnapshot;
  }

  state.pendingBulletControls = null;
}

async function applyProductRefinement(refinement) {
  if (state.currentProductRefinements.length >= 3) {
    setStatus("You can stack up to 3 product refinements. Remove one before adding another.", "error");
    return;
  }

  const nextRefinements = normalizeProductRefinements([...state.currentProductRefinements, refinement]);
  const nextEmbedding = computeQueryEmbeddingFromRefinements(state.currentBaseQueryEmbedding, nextRefinements);
  const { payload, previousPayload } = await rerankResults({
    queryEmbedding: nextEmbedding,
    query: state.lastQuery,
    bulletControls: state.currentBulletControls,
    baseQueryEmbedding: state.currentBaseQueryEmbedding,
    productRefinements: nextRefinements,
    statusMessage: refinement.action === "more" ? `Refining toward ${refinement.name}...` : `Refining away from ${refinement.name}...`
  });

  setStatus(summarizeRefinementChanges(previousPayload, payload, refinement.action === "more" ? "toward" : "away from", refinement.name));
}

async function removeProductRefinement(refinementId) {
  const removed = state.currentProductRefinements.find((entry) => entry.id === refinementId);
  if (!removed) {
    return;
  }

  const nextRefinements = state.currentProductRefinements.filter((entry) => entry.id !== refinementId);
  const nextEmbedding = computeQueryEmbeddingFromRefinements(state.currentBaseQueryEmbedding, nextRefinements);
  await rerankResults({
    queryEmbedding: nextEmbedding,
    query: state.lastQuery,
    bulletControls: state.currentBulletControls,
    baseQueryEmbedding: state.currentBaseQueryEmbedding,
    productRefinements: nextRefinements,
    statusMessage: `Removing refinement for ${removed.name}...`
  });
  setStatus(`Removed refinement for ${removed.name}.`);
}

function getTraitFieldConfig(typeKey, fieldName) {
  const seatingTypes = state.bootstrap?.seating_types;
  const types = seatingTypes?.types;
  if (!types || !Object.keys(types).length) {
    return null;
  }

  const fallbackType = seatingTypes.default_type || "other_seating";
  const resolvedTypeKey = types[typeKey] ? typeKey : fallbackType;
  return (types[resolvedTypeKey]?.fields || []).find((field) => field.field === fieldName) || null;
}

function formatImageTraitChips(imageTraits = {}, limit = 6, typeKey = null) {
  const labels = new Map([
    ["height_category", "Height"],
    ["height_adjustability", "Adjustability"],
    ["back", "Back"],
    ["base_type", "Base"],
    ["base_frame_finish", "Base Finish"],
    ["seat_material", "Seat"],
    ["seat_fabric", "Fabric"],
    ["design_register", "Design"],
    ["shape_character", "Shape"],
    ["plan_shape", "Plan shape"],
    ["base_finish", "Base Finish"],
    ["frame", "Frame"],
    ["back_style", "Back"],
    ["arm_option", "Arms"],
    ["seat_upholstery", "Seat"],
    ["shell_material", "Shell"],
    ["body_construction", "Body"]
  ]);

  return Object.entries(imageTraits || {})
    .map(([field, value]) => {
      const fieldConfig = getTraitFieldConfig(typeKey, field);
      if (fieldConfig?.detectability === "no") {
        return "";
      }

      const normalized = String(value ?? "").trim();
      if (!normalized || ["unknown", "n/a"].includes(normalized.toLowerCase())) {
        return "";
      }
      return `${labels.get(field) || field.replace(/_/g, " ")}: ${normalized}`;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function buildStoredImageSearchBullets(imageTraits = {}, limit = 6, typeKey = null) {
  return Object.entries(imageTraits || {})
    .map(([field, value]) => {
      const fieldConfig = getTraitFieldConfig(typeKey, field);
      if (fieldConfig?.detectability === "no") {
        return "";
      }

      const normalizedValue = String(value ?? "").trim();
      if (!normalizedValue || ["unknown", "n/a"].includes(normalizedValue.toLowerCase())) {
        return "";
      }

      return `${formatTraitFieldLabel(field)}: ${normalizedValue}`;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function buildStoredImageSearchContext(result = {}, matchingImage = null) {
  const source = matchingImage || {};
  const heroSource = result.hero_image || {};
  const seatingType = String(
    source.seating_type ||
    heroSource.seating_type ||
    result.debug?.stage1?.seating_type ||
    ""
  ).trim();
  const enumFields = source.enum_fields || heroSource.enum_fields || result.debug?.image_traits || {};
  const bulletTexts = buildStoredImageSearchBullets(enumFields, 6, seatingType);
  const fallbackMatchedTraits = Array.isArray(result.matched_traits)
    ? result.matched_traits.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const selectedBullets = normalizeSelectedBullets({
    essential: [],
    normal: bulletTexts.length ? bulletTexts : fallbackMatchedTraits
  });
  const bulletControls = normalizeBulletControls(
    [
      ...selectedBullets.essential.map((text) => ({ text, priority: "essential" })),
      ...selectedBullets.normal.map((text) => ({ text, priority: "normal" })),
      ...selectedBullets.low.map((text) => ({ text, priority: "low" }))
    ]
  );
  const query = String(
    source.free_text?.visual_summary ||
    heroSource.free_text?.visual_summary ||
    source.structured_caption ||
    heroSource.structured_caption ||
    result.debug?.visual_description ||
    result.debug?.structured_caption ||
    buildFallbackQueryFromStructuredBullets(selectedBullets) ||
    result.name ||
    "image search"
  ).trim();
  const embedding = normalizeClientEmbedding(
    source.visual_summary_embedding ||
    heroSource.visual_summary_embedding ||
    result.visual_summary_embedding ||
    []
  );
  const imageAnalysis = {
    image_preview_url: source.image_url || heroSource.image_url || result.best_image_url || "",
    seating_type: seatingType,
    stage1: { seating_type: seatingType || "other_seating" },
    image_traits: enumFields,
    stage2: {
      visual_summary: source.free_text?.visual_summary || heroSource.free_text?.visual_summary || result.debug?.visual_description || ""
    }
  };

  return {
    query,
    embedding,
    selectedBullets,
    bulletControls,
    seatingType,
    imageAnalysis
  };
}

async function searchFromStoredImage(result = {}, matchingImage = null) {
  const context = buildStoredImageSearchContext(result, matchingImage);
  if (!context.embedding.length) {
    setStatus("This image does not have a stored embedding yet.", "error");
    return;
  }

  setSearchInputValue(context.query);
  state.refinementLoading = true;
  renderRefineSidebar();
  renderResults(state.lastPayload, state.lastQuery);
  setStatus("Searching from stored image...");

  try {
    const payload = await refineSearchResults({
      queryEmbedding: context.embedding,
      selectedBullets: context.selectedBullets,
      seatingType: context.seatingType,
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter,
      sourceImageUrl: context.imageAnalysis.image_preview_url
    });
    applyActiveSearchContext({
      payload,
      query: context.query,
      selectedBullets: context.selectedBullets,
      bulletControls: context.bulletControls,
      baseQueryEmbedding: context.embedding,
      seatingType: context.seatingType,
      imageAnalysis: context.imageAnalysis,
      productRefinements: [],
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter,
      preserveOriginal: false,
      refinementActive: false
    });
    state.refinementLoading = false;
    renderResults(payload, state.lastQuery);
    setStatus("Searching from stored image.");
  } catch (error) {
    state.refinementLoading = false;
    renderResults(state.lastPayload, state.lastQuery);
    setStatus(error.message || "Stored image search failed.", "error");
  }
}

function applyRefreshedProductToResults(refreshPayload) {
  if (!state.lastPayload?.results?.length || !refreshPayload?.images?.length) {
    return false;
  }

  const refreshedImage = refreshPayload.images[0];
  if (!refreshedImage?.product_id) {
    return false;
  }

  let didUpdate = false;
  state.lastPayload = {
    ...state.lastPayload,
    results: state.lastPayload.results.map((result) => {
      if (result.product_id !== refreshedImage.product_id) {
        return result;
      }

      didUpdate = true;
      const detectedTraits = formatImageTraitChips(
        refreshedImage.image_traits,
        6,
        refreshedImage.seating_type
      );
      const matchedTraits = (refreshedImage.visual_highlights || detectedTraits).slice(0, 3);
      const existingMatchingImages = normalizeMatchingImages(result);
      const existingScoreByKey = new Map(
        existingMatchingImages.map((image) => [
          String(image.image_id || normalizeDisplayImageUrl(image.image_url)),
          Number(image.score || result.score || 0)
        ])
      );
      const refreshedMatchingImages = (refreshPayload.images || [])
        .filter((image) => normalizeEffectiveClassification(image?.effective_classification || image?.stage_0_result) === "product")
        .map((image) => {
          const normalizedUrl = normalizeDisplayImageUrl(image.image_url);
          const scoreKey = String(image.image_id || normalizedUrl);
          return {
            image_id: image.image_id,
            image_url: normalizedUrl,
            stage_0_result: normalizeStage0Result(image.stage_0_result),
            effective_classification: normalizeEffectiveClassification(image.effective_classification || image.stage_0_result),
            score: existingScoreByKey.has(scoreKey)
              ? existingScoreByKey.get(scoreKey)
              : Number(result.score || 0),
            confidence_tier: image.confidence_tier || "high",
            visual_summary_embedding: image.visual_summary_embedding || []
          };
        });

      return {
        ...result,
        category: result.category,
        ai_refreshed_at: refreshedImage.ai_refreshed_at || result.ai_refreshed_at || "",
        best_image_url: refreshedImage.image_url || result.best_image_url,
        match_count: Math.max(1, refreshedMatchingImages.length),
        matching_images: refreshedMatchingImages,
        image_urls: refreshedMatchingImages.map((image) => image.image_url),
        visual_summary_embedding: refreshedImage.visual_summary_embedding || result.visual_summary_embedding || [],
        matched_traits: matchedTraits,
        debug: {
          ...(result.debug || {}),
          image_traits: refreshedImage.image_traits || result.debug?.image_traits || {},
          structured_caption: refreshedImage.structured_caption || result.debug?.structured_caption || "",
          visual_description: refreshedImage.stage2?.visual_summary || refreshedImage.visual_summary || result.debug?.visual_description || "",
          visual_highlights: refreshedImage.raw_visual_highlights || refreshedImage.visual_highlights || [],
          detected_traits: detectedTraits
        }
      };
    })
  };

  return didUpdate;
}

function hasVisibleResults(payload = state.lastPayload) {
  return Boolean(payload?.results?.length);
}

function isBrowsePayload(payload = state.lastPayload, query = state.lastQuery) {
  return Boolean(!query || payload?.browse_mode);
}

function formatRefreshTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "AI refresh: unknown";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "AI refresh: unknown";
  }

  return `AI refresh: ${date.toLocaleString()}`;
}

function hasUsableRefreshTimestamp(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }
  return !Number.isNaN(Date.parse(raw));
}

function syncManageToolbar() {
  const showBrowseControls = isBrowsePayload();
  const showToolbar = hasVisibleResults();
  elements.batchManageBar.hidden = !showToolbar || !showBrowseControls;
  if (!showToolbar || !showBrowseControls) {
    return;
  }

  const showProgressBlock = state.batchRefreshProgressVisible;
  elements.manageSelectionButton.hidden = false;
  elements.manageSelectionButton.setAttribute("aria-pressed", String(state.manageMode || showProgressBlock));
  elements.manageActions.hidden = !(state.manageMode || showProgressBlock);
  const hasIndex = Boolean(state.bootstrap?.has_index);
  if (elements.manageControls) {
    elements.manageControls.hidden = showProgressBlock;
  }
  if (elements.batchRefreshProgress) {
    elements.batchRefreshProgress.hidden = !showProgressBlock;
  }
  const visibleResults = state.lastPayload?.results || [];
  const visibleIds = visibleResults.map((result) => result.product_id);
  const selectionCount = state.selectedProductIds.size;
  const allVisibleSelected = Boolean(visibleIds.length) && visibleIds.every((productId) => state.selectedProductIds.has(productId));
  if (elements.selectAllButton) {
    elements.selectAllButton.disabled = state.batchRefreshing || !visibleIds.length || allVisibleSelected;
  }
  if (elements.selectNoneButton) {
    elements.selectNoneButton.disabled = state.batchRefreshing || selectionCount === 0;
  }
  if (elements.batchRefreshButton) {
    elements.batchRefreshButton.hidden = false;
    elements.batchRefreshButton.disabled = state.batchRefreshing || selectionCount === 0;
    elements.batchRefreshButton.textContent = state.batchRefreshing
      ? `Refreshing Extraction ${selectionCount ? `(${selectionCount})` : ""}`.trim()
      : hasIndex
        ? `Refresh Extraction${selectionCount ? ` (${selectionCount})` : ""}`
        : `Build Image Index${selectionCount ? ` (${selectionCount})` : ""}`;
  }
}

function enterManageMode() {
  state.manageMode = true;
  state.selectedProductIds = new Set();
  state.batchRefreshProgressVisible = false;
  syncManageToolbar();
  renderResults(state.lastPayload, state.lastQuery);
}

function exitManageMode() {
  closeBatchRefreshStream();
  state.manageMode = false;
  state.batchRefreshing = false;
  state.batchRefreshProgress = null;
  state.batchRefreshProgressVisible = false;
  state.selectedProductIds = new Set();
  syncManageToolbar();
  renderResults(state.lastPayload, state.lastQuery);
}

function selectAllVisibleResults() {
  const visibleIds = (state.lastPayload?.results || []).map((result) => result.product_id);
  state.selectedProductIds = new Set(visibleIds);
  syncManageToolbar();
  renderResults(state.lastPayload, state.lastQuery);
}

function clearSelectedResults() {
  state.selectedProductIds = new Set();
  syncManageToolbar();
  renderResults(state.lastPayload, state.lastQuery);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeFocusArea(area) {
  if (!area) return null;
  const width = clamp(Number(area.width || 0), 0.2, 1);
  const height = clamp(Number(area.height || 0), 0.2, 1);
  const x = clamp(Number(area.x || 0), 0, 1 - width);
  const y = clamp(Number(area.y || 0), 0, 1 - height);
  return { x, y, width, height };
}

function defaultFocusArea() {
  return { x: 0, y: 0, width: 1, height: 1 };
}

function createFocusAreaAroundPoint(clientX, clientY) {
  const canvasRect = elements.previewCanvas.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) {
    return normalizeFocusArea({ x: 0.31, y: 0.31, width: 0.38, height: 0.38 });
  }
  const width = 0.38;
  const height = 0.38;
  const x = ((clientX - canvasRect.left) / canvasRect.width) - (width / 2);
  const y = ((clientY - canvasRect.top) / canvasRect.height) - (height / 2);
  return normalizeFocusArea({ x, y, width, height });
}

function syncFocusStageControls() {
  const hasCrop = Boolean(state.cropModeActive && state.focusArea);
  if (elements.focusCropPrompt) {
    elements.focusCropPrompt.hidden = hasCrop || Boolean(state.imageAnalyzeLoading);
  }
  if (elements.skipFocusButton) {
    elements.skipFocusButton.hidden = !hasCrop;
  }
  if (elements.applyFocusButton) {
    elements.applyFocusButton.textContent = hasCrop ? "Analyze Selected Area" : "Analyze Image";
  }
}

function setImageAnalyzeLoading(isLoading) {
  state.imageAnalyzeLoading = Boolean(isLoading);
  syncFocusStageControls();
  elements.analyzeImageButton.disabled = isLoading || !state.bootstrap?.image_analysis_available;
  elements.imageUploadButton.disabled = isLoading || !state.bootstrap?.image_analysis_available;
  elements.imageUploadInput.disabled = isLoading;
  elements.imageUrlInput.disabled = isLoading;
  if (elements.skipFocusButton) {
    elements.skipFocusButton.disabled = isLoading;
  }
  if (elements.applyFocusButton) {
    elements.applyFocusButton.disabled = isLoading;
  }
  if (isLoading) {
    if (!state.imageAnalyzeProgress) {
      setImageAnalyzeProgressState({ step: "prepare", percent: 0 });
    }
    renderImageAnalyzeProgress();
  } else {
    stopImageAnalyzeProgressAnimation();
    setImageAnalyzeProgressState({ step: "prepare", percent: 0 });
    renderImageAnalyzeProgress();
  }
  if (elements.analyzeImageButton) {
    elements.analyzeImageButton.hidden = isLoading;
  }
  if (elements.applyFocusButton) {
    elements.applyFocusButton.hidden = isLoading;
  }
  if (elements.skipFocusButton) {
    elements.skipFocusButton.hidden = isLoading || !Boolean(state.cropModeActive && state.focusArea);
  }
  elements.imageAnalyzeLoading.hidden = !isLoading;
  if (elements.focusAnalyzeLoading) {
    elements.focusAnalyzeLoading.hidden = !isLoading;
  }
  elements.analyzeImageButton.textContent = isLoading ? "Analyzing..." : "Analyze Image";
}

function renderFocusArea() {
  const area = normalizeFocusArea(state.focusArea);
  if (!area || !state.cropModeActive) {
    elements.focusBox.hidden = true;
    syncFocusStageControls();
    return;
  }
  elements.focusBox.hidden = false;
  elements.focusBox.style.left = `${(area.x * 100).toFixed(3)}%`;
  elements.focusBox.style.top = `${(area.y * 100).toFixed(3)}%`;
  elements.focusBox.style.width = `${(area.width * 100).toFixed(3)}%`;
  elements.focusBox.style.height = `${(area.height * 100).toFixed(3)}%`;
  syncFocusStageControls();
}

function captureFocusAreaFromDom() {
  const canvasRect = elements.previewCanvas.getBoundingClientRect();
  const boxRect = elements.focusBox.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height || !boxRect.width || !boxRect.height) return null;
  return normalizeFocusArea({
    x: (boxRect.left - canvasRect.left) / canvasRect.width,
    y: (boxRect.top - canvasRect.top) / canvasRect.height,
    width: boxRect.width / canvasRect.width,
    height: boxRect.height / canvasRect.height
  });
}

function setFocusArea(area) {
  state.focusArea = normalizeFocusArea(area);
  renderFocusArea();
}

function beginFocusDrag(event) {
  const area = captureFocusAreaFromDom() || state.focusArea;
  if (!area) return;
  event.preventDefault();
  focusDrag.active = true;
  focusDrag.mode = "move";
  focusDrag.handle = "";
  focusDrag.startX = event.clientX;
  focusDrag.startY = event.clientY;
  focusDrag.startArea = area;
}

function beginFocusResize(event, handle) {
  const area = captureFocusAreaFromDom() || state.focusArea;
  if (!area) return;
  event.preventDefault();
  event.stopPropagation();
  focusDrag.active = true;
  focusDrag.mode = "resize";
  focusDrag.handle = handle;
  focusDrag.startX = event.clientX;
  focusDrag.startY = event.clientY;
  focusDrag.startArea = area;
}

function updateFocusDrag(event) {
  if (!focusDrag.active || !focusDrag.startArea) return;
  const canvasRect = elements.previewCanvas.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return;

  const deltaX = (event.clientX - focusDrag.startX) / canvasRect.width;
  const deltaY = (event.clientY - focusDrag.startY) / canvasRect.height;
  let next;
  if (focusDrag.mode === "resize") {
    const minSize = 0.12;
    const start = focusDrag.startArea;
    const left = start.x;
    const top = start.y;
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    let nextLeft = left;
    let nextTop = top;
    let nextRight = right;
    let nextBottom = bottom;

    if (focusDrag.handle.includes("n")) {
      nextTop = clamp(top + deltaY, 0, bottom - minSize);
    }
    if (focusDrag.handle.includes("s")) {
      nextBottom = clamp(bottom + deltaY, top + minSize, 1);
    }
    if (focusDrag.handle.includes("w")) {
      nextLeft = clamp(left + deltaX, 0, right - minSize);
    }
    if (focusDrag.handle.includes("e")) {
      nextRight = clamp(right + deltaX, left + minSize, 1);
    }

    next = normalizeFocusArea({
      x: nextLeft,
      y: nextTop,
      width: nextRight - nextLeft,
      height: nextBottom - nextTop
    });
  } else {
    next = {
      ...focusDrag.startArea,
      x: focusDrag.startArea.x + deltaX,
      y: focusDrag.startArea.y + deltaY
    };
  }
  setFocusArea(next);
}

function stopFocusDrag() {
  if (!focusDrag.active) return;
  focusDrag.active = false;
  focusDrag.mode = "move";
  focusDrag.handle = "";
  focusDrag.startArea = captureFocusAreaFromDom() || state.focusArea;
}

function setStatus(message, kind = "info") {
  if (!elements.statusPanel) {
    return;
  }
  elements.statusPanel.className = `status-panel ${kind}`;
  elements.statusPanel.textContent = message || "";
}

function setResultsLoading(message = "") {
  const isLoading = Boolean(message);
  document.body.classList.toggle("results-loading-active", isLoading);
  if (elements.resultsLoadingPanel) {
    elements.resultsLoadingPanel.hidden = !isLoading;
  }
  if (elements.resultsGrid) {
    elements.resultsGrid.hidden = isLoading;
  }
  if (isLoading) {
    if (elements.resultsLayout) {
      elements.resultsLayout.classList.remove("has-sidebar");
    }
    if (elements.resultsSidebar) {
      elements.resultsSidebar.hidden = true;
      elements.resultsSidebar.classList.remove("is-open");
    }
    if (elements.refineToggleButton) {
      elements.refineToggleButton.hidden = true;
    }
    if (elements.refineDrawerBackdrop) {
      elements.refineDrawerBackdrop.hidden = true;
    }
    state.refineDrawerOpen = false;
    if (elements.resultsLoadingTitle) {
      elements.resultsLoadingTitle.textContent = message;
    }
    if (elements.resultsGrid) {
      elements.resultsGrid.innerHTML = "";
    }
    setStatus("");
  }
}

function setResultCountMarkup(value, label) {
  if (!elements.resultCount) {
    return;
  }
  elements.resultCount.innerHTML = `<strong>${value}</strong> ${label}`;
}

function reportClientError(error, context = "Client error") {
  const message = error instanceof Error
    ? `${context}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
    : `${context}: ${String(error || "Unknown error")}`;
  console.error(error);
  setStatus(message, "error");
}

function renderContextPills(parsed = {}) {
  if (!elements.contextPills) {
    return;
  }
  elements.contextPills.innerHTML = "";
  const entries = [];
  const activeCategoryFilter = normalizeCategoryFilter(state.categoryFilter);
  const activeRefreshAgeFilter = String(state.refreshAgeFilter || "").trim();
  const sourceImageUrl = String(state.currentImageAnalysis?.image_preview_url || "").trim();
  const activeSeatingType = getPrimaryCategoryScopeSelection(state.resultCategoryScope);

  if (activeCategoryFilter.length) {
    entries.push(`Category: ${activeCategoryFilter.join(", ")}`);
  } else if (parsed.category) {
    entries.push(parsed.category);
  }
  if (activeRefreshAgeFilter) {
    const labels = {
      "1m": "AI older than 1 min",
      "5m": "AI older than 5 min",
      "10m": "AI older than 10 min",
      "30m": "AI older than 30 min",
      "1h": "AI older than 1 hour",
      "1d": "AI older than 1 day",
      "none": "AI: no data"
    };
    entries.push(labels[activeRefreshAgeFilter] || `AI age: ${activeRefreshAgeFilter}`);
  }
  if (parsed.brand) {
    entries.push(`Brand: ${parsed.brand}`);
  }

  if (sourceImageUrl) {
    const pill = document.createElement("span");
    pill.className = "context-pill context-image-pill";
    const image = document.createElement("img");
    image.src = sourceImageUrl;
    image.alt = "Source image";
    const label = document.createElement("span");
    label.textContent = "Searching from image";
    pill.append(image, label);
    elements.contextPills.appendChild(pill);
  }

  if (activeSeatingType && activeSeatingType !== "all") {
    const pill = document.createElement("span");
    pill.className = "context-pill context-filter-pill is-active";
    const label = document.createElement("span");
    label.textContent = formatSeatingCategoryLabel(activeSeatingType);
    pill.appendChild(label);

    if (!state.currentImageAnalysis) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "context-pill-clear";
      clear.setAttribute("aria-label", `Remove ${formatSeatingCategoryLabel(activeSeatingType)} filter`);
      clear.textContent = "✕";
      clear.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.resultCategoryScope = ["all"];
        state.categoryScopeMode = "all";
        runSearch(getSearchComposerRequestQuery(state.lastQuery), {
          sort: state.sortMode,
          categoryFilter: state.categoryFilter,
          refreshAgeFilter: state.refreshAgeFilter,
          seatingType: "all",
          categoryScopeMode: "all"
        });
      });
      pill.appendChild(clear);
    }

    elements.contextPills.appendChild(pill);
  }

  for (const entry of entries) {
    const pill = document.createElement("span");
    pill.className = "context-pill";
    pill.textContent = entry;
    elements.contextPills.appendChild(pill);
  }
}

function applyRefineSelectedImageCrop(imageElement, wrapElement, imageUrl, focusArea) {
  if (!imageElement || !wrapElement) {
    return;
  }
  imageElement.src = imageUrl;
  const area = normalizeFocusArea(focusArea);
  if (!area) {
    wrapElement.style.aspectRatio = "";
    imageElement.style.position = "";
    imageElement.style.width = "100%";
    imageElement.style.height = "auto";
    imageElement.style.maxWidth = "";
    imageElement.style.maxHeight = "";
    imageElement.style.left = "";
    imageElement.style.top = "";
    imageElement.style.borderRadius = "12px";
    return;
  }

  wrapElement.style.aspectRatio = `${area.width} / ${area.height}`;
  imageElement.style.position = "relative";
  imageElement.style.width = `${(100 / area.width).toFixed(4)}%`;
  imageElement.style.height = `${(100 / area.height).toFixed(4)}%`;
  imageElement.style.maxWidth = "none";
  imageElement.style.maxHeight = "none";
  imageElement.style.left = `${(-area.x / area.width * 100).toFixed(4)}%`;
  imageElement.style.top = `${(-area.y / area.height * 100).toFixed(4)}%`;
  imageElement.style.borderRadius = "0";
}

function renderClarificationBar() {
  if (!elements.clarificationBar) {
    return;
  }

  const categoryRequirement = state.categoryRequirement;
  const conflict = state.clarificationConflict;
  const shouldShowCategoryRequirement = Boolean(
    categoryRequirement &&
    Array.isArray(categoryRequirement.options) &&
    categoryRequirement.options.length &&
    state.lastQuery
  );
  const shouldShowConflict = Boolean(
    conflict &&
    conflict.field === "base_visibility" &&
    state.currentImageAnalysis?.image_preview_url &&
    state.lastPayload &&
    Array.isArray(state.lastPayload.results)
  );
  const shouldShow = shouldShowCategoryRequirement || shouldShowConflict;

  elements.clarificationBar.innerHTML = "";
  elements.clarificationBar.hidden = !shouldShow;
  elements.clarificationBar.classList.toggle("is-category-requirement", shouldShowCategoryRequirement);
  if (!shouldShow) {
    return;
  }

  const card = document.createElement("div");
  card.className = `clarification-card${shouldShowCategoryRequirement ? " clarification-card-category" : ""}`;

  const text = document.createElement("p");
  text.className = `clarification-text${shouldShowCategoryRequirement ? " clarification-text-category" : ""}`;
  if (shouldShowCategoryRequirement) {
    const message = String(categoryRequirement.message || `Choose a category to narrow "${state.lastQuery}".`);
    const normalizedMessage = message.replace(/\n+/g, "\n").trim();
    const [firstLine, ...remainingLines] = normalizedMessage.split("\n");
    const trailingText = remainingLines.join(" ").trim();
    text.textContent = "";
    const firstLineNode = document.createElement("span");
    firstLineNode.textContent = firstLine || normalizedMessage;
    text.appendChild(firstLineNode);
    if (trailingText) {
      text.appendChild(document.createElement("br"));
      const secondLineNode = document.createElement("span");
      secondLineNode.className = "clarification-subtext";
      secondLineNode.textContent = trailingText;
      text.appendChild(secondLineNode);
    }
  } else {
    text.textContent = String(conflict.clarification_question || "We weren't sure about this trait — which best describes it?");
  }

  const options = document.createElement("div");
  options.className = `clarification-options${shouldShowCategoryRequirement ? " clarification-options-category" : ""}`;
  const optionEntries = shouldShowCategoryRequirement
    ? categoryRequirement.options
      .map((option) => normalizeSeatingCategoryKey(option))
      .filter((option) => option && option !== "all" && option !== "other_seating")
      .sort((left, right) => {
        const leftLabel = formatSeatingCategoryLabel(left);
        const rightLabel = formatSeatingCategoryLabel(right);
        return leftLabel.localeCompare(rightLabel);
      })
      .map((option) => ({ value: option, label: formatSeatingCategoryLabel(option) }))
    : (Array.isArray(conflict.options) ? conflict.options : []);

  optionEntries.forEach((option) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `clarification-pill${shouldShowCategoryRequirement ? " clarification-pill-category" : ""}`;
    pill.textContent = String(option?.label || "").trim();
    pill.addEventListener("click", () => {
      if (shouldShowCategoryRequirement) {
        const categoryKey = String(option?.value || "").trim();
        const nextQuery = stripVagueSeatingReferenceFromQuery(state.lastQuery || "", categoryKey);
        updateCategoryRequirement(null);
        state.resultCategoryScope = [categoryKey];
        state.categoryScopeMode = "explicit";
        runSearch(nextQuery, {
          sort: state.sortMode,
          categoryFilter: state.categoryFilter,
          refreshAgeFilter: state.refreshAgeFilter,
          seatingType: categoryKey,
          categoryScopeMode: "explicit",
          sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
          imageAnalysis: state.currentImageAnalysis,
          selectedBullets: state.currentSelectedBullets,
          bulletControls: state.currentBulletControls
        }).catch((error) => {
          setStatus(error.message || "Failed to apply category selection.", "error");
        });
        return;
      }
      applyClarificationSelection(String(option?.value || "").trim()).catch((error) => {
        setStatus(error.message || "Failed to apply clarification.", "error");
      });
    });
    options.appendChild(pill);
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = `clarification-close${shouldShowCategoryRequirement ? " clarification-close-category" : ""}`;
  close.setAttribute("aria-label", shouldShowCategoryRequirement ? "Dismiss category prompt" : "Dismiss clarification prompt");
  close.textContent = "✕";
  close.addEventListener("click", () => {
    if (shouldShowCategoryRequirement) {
      updateCategoryRequirement(null);
      setStatus("Select a category from the search field to continue.", "info");
      return;
    }
    dismissClarificationPrompt().catch((error) => {
      setStatus(error.message || "Failed to dismiss clarification prompt.", "error");
    });
  });

  card.append(text, options, close);
  elements.clarificationBar.appendChild(card);
}

function renderSeedQueries(seedQueries) {
  if (!elements.seedQueries) {
    return;
  }
  elements.seedQueries.innerHTML = "";
  (seedQueries || []).forEach((query) => {
    const button = document.createElement("button");
    button.className = "seed-query";
    button.type = "button";
    button.textContent = query;
    button.addEventListener("click", () => {
      setSearchInputValue(query);
      if (state.landingOnlyMode) {
        enterBrowseMode(query);
      }
      runSearch(query, { sort: state.sortMode, categoryFilter: state.categoryFilter });
    });
    elements.seedQueries.appendChild(button);
  });
}

function renderCategoryFilterOptions(categories = [], options = {}) {
  if (!elements.categoryFilterOptions || !elements.categoryFilterButton) {
    return;
  }

  const query = Object.prototype.hasOwnProperty.call(options, "query") ? options.query : state.lastQuery;
  const payload = Object.prototype.hasOwnProperty.call(options, "payload") ? options.payload : state.lastPayload;
  const isSearchMode = Boolean(query && !isBrowsePayload(payload, query));
  setCategoryFilterMode(isSearchMode);
  if (isSearchMode) {
    elements.categoryFilterOptions.innerHTML = "";
    return;
  }

  const normalizedCategories = [...new Set((categories || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  elements.categoryFilterOptions.innerHTML = "";

  normalizedCategories.forEach((category) => {
    const label = document.createElement("label");
    label.className = "results-multiselect-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = category;
    input.checked = state.categoryFilter.includes(category);

    const text = document.createElement("span");
    text.textContent = category;

    label.append(input, text);
    elements.categoryFilterOptions.appendChild(label);
  });

  elements.categoryFilterButton.textContent = formatCategoryFilterLabel(state.categoryFilter);
}

function syncSearchPageUrl() {
  const targetPath = IS_PRIVATE_BROWSE_ROUTE ? PRIVATE_BROWSE_PATH : "/";
  const search = buildResultsPageSearch({
    query: state.lastQuery,
    categoryFilter: state.categoryFilter,
    categoryScope: state.resultCategoryScope,
    refreshAgeFilter: state.refreshAgeFilter
  });
  const nextUrl = search ? `${targetPath}?${search}` : targetPath;
  window.history.replaceState({}, "", nextUrl);
}

function createChip(text, muted = false) {
  const chip = document.createElement("span");
  chip.className = muted ? "chip muted" : "chip";
  chip.textContent = text;
  return chip;
}

function getResultCategoryTags(result = {}) {
  const explicitTags = Array.isArray(result.category_tags)
    ? result.category_tags.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (explicitTags.length) {
    return explicitTags;
  }

  const fallback = String(result.category || "").trim();
  return fallback ? [fallback] : [];
}

function formatScoreValue(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function renderRankingRulesSummary(rules) {
  if (!elements.rulesSummaryDetails || !rules) {
    return;
  }

  const formatNumber = (value) => {
    const number = Number(value || 0);
    return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
  };

  const detailRows = [
    "No minimum score gate; all ranked results are returned.",
    "Image-led searches hard-filter to matching seating_type unless the type is other_seating.",
    "Primary score is cosine similarity on visual_summary embeddings, normalized to 0-1.",
    `Selected bullet boost: essential ${formatNumber(0.35)} each, normal ${formatNumber(0.1)} each, plus a ${formatNumber(0.15)} bonus for 3+ matches`,
    `Category match boost: ${formatNumber(rules?.additive_boosts?.category_match)}`,
    `Exact source image boost: ${formatNumber(rules?.additive_boosts?.source_image_exact_match)}`
  ];

  const summary = document.createElement("div");
  summary.className = "rules-summary-grid";

  const coreCard = document.createElement("section");
  coreCard.className = "rules-card";
  const coreTitle = document.createElement("h3");
  coreTitle.className = "rules-card-title";
  coreTitle.textContent = "Core Scoring";
  coreCard.appendChild(coreTitle);
  const coreList = document.createElement("ul");
  coreList.className = "rules-card-list";
  detailRows.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    coreList.appendChild(item);
  });
  coreCard.appendChild(coreList);
  summary.appendChild(coreCard);

  (rules?.stages || []).forEach((entry, index) => {
    const card = document.createElement("section");
    card.className = "rules-card";
    const heading = document.createElement("h3");
    heading.className = "rules-card-title";
    heading.textContent = `Stage ${index + 1}: ${entry.name}`;
    card.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "rules-card-list";
    const item = document.createElement("li");
    item.textContent = entry.summary;
    list.appendChild(item);

    card.appendChild(list);
    summary.appendChild(card);
  });

  elements.rulesSummaryDetails.innerHTML = "";
  elements.rulesSummaryDetails.appendChild(summary);
}

function formatStructuredTraitsSummary() {
  const seatingTypes = state.bootstrap?.seating_types;
  const types = seatingTypes?.types;
  if (!types || !Object.keys(types).length) {
    throw new Error("Structured traits are not available yet.");
  }

  const fallbackType = seatingTypes.default_type || "other_seating";
  const orderedTypeKeys = Object.keys(types)
    .filter((key) => key !== fallbackType)
    .sort((left, right) => String(types[left]?.label || left).localeCompare(String(types[right]?.label || right)));

  if (types[fallbackType]) {
    orderedTypeKeys.push(fallbackType);
  }

  const lines = orderedTypeKeys.flatMap((typeKey, index) => {
    const type = types[typeKey];
    const sectionLines = [
      `Category: ${type.label} (${typeKey})`,
      "---"
    ];

    if (!type.fields?.length) {
      sectionLines.push("No field constraints.");
    } else {
      sectionLines.push(
        ...(type.fields || []).map((field) => (
          `${field.field} (${String(field.detectability || "").toUpperCase()}) : ${(field.allowed_values || []).join(" | ")}`
        ))
      );
    }

    if (index < orderedTypeKeys.length - 1) {
      sectionLines.push("", "");
    }

    return sectionLines;
  });

  return lines.join("\n");
}

function formatStructuredTraitCategorySummary(typeKey, type) {
  const sectionLines = [
    `Category: ${type.label} (${typeKey})`,
    "---"
  ];

  if (!type.fields?.length) {
    sectionLines.push("No field constraints.");
  } else {
    sectionLines.push(
      ...(type.fields || []).map((field) => (
        `${field.field} (${String(field.detectability || "").toUpperCase()}) : ${(field.allowed_values || []).join(" | ")}`
      ))
    );
  }

  return sectionLines.join("\n");
}

function structuredTraitTypeEntries() {
  const seatingTypes = state.bootstrap?.seating_types;
  const types = seatingTypes?.types;
  if (!types || !Object.keys(types).length) {
    throw new Error("Structured traits are not available yet.");
  }

  const fallbackType = seatingTypes.default_type || "other_seating";
  const orderedTypeKeys = Object.keys(types)
    .filter((key) => key !== fallbackType)
    .sort((left, right) => String(types[left]?.label || left).localeCompare(String(types[right]?.label || right)));

  if (types[fallbackType]) {
    orderedTypeKeys.push(fallbackType);
  }

  return orderedTypeKeys.map((typeKey) => ({
    typeKey,
    type: types[typeKey]
  }));
}

function renderStructuredTraitsModalContent() {
  if (!elements.structuredTraitsText) {
    return;
  }

  const entries = structuredTraitTypeEntries();
  elements.structuredTraitsText.innerHTML = "";

  for (const { typeKey, type } of entries) {
    const card = document.createElement("details");
    card.className = "structured-traits-card";

    const summary = document.createElement("summary");
    summary.className = "structured-traits-toggle";

    const labelWrap = document.createElement("span");
    labelWrap.className = "structured-traits-toggle-label";

    const category = document.createElement("span");
    category.className = "structured-traits-category";
    category.textContent = type.label;

    const key = document.createElement("span");
    key.className = "structured-traits-key";
    key.textContent = typeKey;

    const chevron = document.createElement("span");
    chevron.className = "structured-traits-chevron";
    chevron.textContent = "›";

    labelWrap.append(category, key);
    summary.append(labelWrap, chevron);

    const body = document.createElement("div");
    body.className = "structured-traits-body";

    const actions = document.createElement("div");
    actions.className = "structured-traits-actions";

    const copyButton = document.createElement("button");
    copyButton.className = "rules-summary-button structured-traits-copy-button";
    copyButton.type = "button";
    copyButton.textContent = "Copy Category";
    copyButton.addEventListener("click", async () => {
      const text = formatStructuredTraitCategorySummary(typeKey, type);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error("Clipboard copy is not available in this browser.");
        }
      }
      showStructuredTraitsCopied();
    });

    actions.appendChild(copyButton);
    body.appendChild(actions);

    if (!type.fields?.length) {
      const empty = document.createElement("p");
      empty.className = "structured-traits-empty";
      empty.textContent = "No field constraints.";
      body.appendChild(empty);
    } else {
      for (const field of type.fields) {
        const line = document.createElement("p");
        line.className = "structured-traits-field";
        line.textContent = `${field.field} (${String(field.detectability || "").toUpperCase()}) : ${(field.allowed_values || []).join(" | ")}`;
        body.appendChild(line);
      }
    }

    card.append(summary, body);
    elements.structuredTraitsText.appendChild(card);
  }
}

function showStructuredTraitsCopied() {
  if (!elements.copyStructuredTraitsStatus) {
    return;
  }

  elements.copyStructuredTraitsStatus.hidden = false;
  if (state.copyStructuredTraitsTimer) {
    clearTimeout(state.copyStructuredTraitsTimer);
  }
  state.copyStructuredTraitsTimer = window.setTimeout(() => {
    elements.copyStructuredTraitsStatus.hidden = true;
    state.copyStructuredTraitsTimer = null;
  }, 2000);
}

async function copyStructuredTraitsSummary() {
  const text = formatStructuredTraitsSummary();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) {
      throw new Error("Clipboard copy is not available in this browser.");
    }
  }
  showStructuredTraitsCopied();
}

function applyPriorityButtonState(button, priority) {
  const nextPriority = ["essential", "normal", "low", "off"].includes(priority) ? priority : "normal";
  button.dataset.priority = nextPriority;
  button.classList.toggle("is-active", button.dataset.value === nextPriority);
}

function toTitleCaseWords(text = "") {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatRefineBulletParts(text = "") {
  const raw = String(text || "").trim();
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) {
    return {
      label: toTitleCaseWords(raw.replace(/_/g, " ")),
      value: ""
    };
  }
  const label = raw.slice(0, colonIndex).trim().replace(/_/g, " ");
  const value = raw.slice(colonIndex + 1).trim();
  const normalizedLabel = label.toLowerCase();
  return {
    label: toTitleCaseWords(label),
    value: normalizedLabel === "seating type"
      ? formatSeatingCategoryLabel(value)
      : value
  };
}

function renderRefineSidebar() {
  if (!elements.resultsSidebar || !elements.refineBulletsList || !elements.refineToggleButton || !elements.resultsLayout) {
    return;
  }

  const showSidebar = Boolean(state.lastQuery && state.currentBulletControls.length);
  elements.resultsLayout.classList.toggle("has-sidebar", showSidebar);
  elements.resultsSidebar.hidden = !showSidebar;
  elements.refineToggleButton.hidden = !showSidebar;
  elements.refineBulletsList.innerHTML = "";

  if (!showSidebar) {
    if (elements.refineSelectedImageWrap) {
      elements.refineSelectedImageWrap.hidden = true;
    }
    if (elements.applyRefineBulletsButton) {
      elements.applyRefineBulletsButton.hidden = true;
    }
    syncRefineDrawer();
    return;
  }

  if (elements.refineSelectedImageWrap && elements.refineSelectedImage) {
    const selectedImageUrl = String(state.currentImageAnalysis?.image_preview_url || state.cropPreviewUrl || "").trim();
    elements.refineSelectedImageWrap.hidden = !selectedImageUrl;
    if (elements.reopenFocusOverlay) {
      elements.reopenFocusOverlay.hidden = !selectedImageUrl;
    }
    if (selectedImageUrl) {
      applyRefineSelectedImageCrop(
        elements.refineSelectedImage,
        elements.refineSelectedImageWrap,
        selectedImageUrl,
        state.currentImageAnalysis ? state.focusArea : null
      );
    } else {
      elements.refineSelectedImage.removeAttribute("src");
      elements.refineSelectedImageWrap.style.aspectRatio = "";
    }
  }

  const displayedControls = normalizeBulletControls(state.pendingBulletControls || state.currentBulletControls);
  displayedControls.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "refine-bullet-row";

    const copy = document.createElement("div");
    copy.className = "refine-bullet-copy";

    const parts = formatRefineBulletParts(entry.text);

    const label = document.createElement("p");
    label.className = "refine-bullet-label";
    label.textContent = parts.label;

    const value = document.createElement("p");
    value.className = "refine-bullet-value";
    value.textContent = parts.value;

    copy.append(label);
    if (parts.value) {
      copy.append(value);
    }

    const toggle = document.createElement("div");
    toggle.className = "priority-toggle";

    const states = [
      { value: "essential", label: "!!", title: "Essential" },
      { value: "normal", label: "✓", title: "Normal" },
      { value: "low", label: "↓", title: "Low" },
      { value: "off", label: "–", title: "Off" }
    ];

    states.forEach((stateOption) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "priority-button";
      button.dataset.value = stateOption.value;
      button.textContent = stateOption.label;
      button.title = stateOption.title;
      applyPriorityButtonState(button, entry.priority);
      button.addEventListener("click", () => {
        if (state.refinementLoading || displayedControls[index]?.priority === stateOption.value) {
          return;
        }
        updateBulletPriority(index, stateOption.value);
      });
      toggle.appendChild(button);
    });

    row.append(copy, toggle);
    elements.refineBulletsList.appendChild(row);
  });

  if (elements.applyRefineBulletsButton) {
    const hasPendingChanges = JSON.stringify(displayedControls) !== JSON.stringify(normalizeBulletControls(state.currentBulletControls));
    elements.applyRefineBulletsButton.hidden = !displayedControls.length || !hasPendingChanges;
    elements.applyRefineBulletsButton.disabled = state.refinementLoading;
    elements.applyRefineBulletsButton.textContent = "Apply Adjusted Priorities";
  }

  syncRefineDrawer();
}

function isPresentBulletValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }

  return normalized.toLowerCase() !== "unknown";
}

function isSingleSeatConfiguration(value) {
  return String(value || "").trim().toLowerCase() === "single seat";
}

function isPlaceholderSeatFabric(value) {
  return new Set(["fabric (specify category)", "col", "com", "unknown"]).has(
    String(value || "").trim().toLowerCase()
  );
}

function buildStructuredInspirationBullets(analysis = {}) {
  const stage2 = analysis?.stage2 && typeof analysis.stage2 === "object" ? analysis.stage2 : {};
  const imageTraits = analysis?.image_traits && typeof analysis.image_traits === "object" ? analysis.image_traits : {};
  const bullets = [];

  if (isPresentBulletValue(stage2.design_register)) {
    bullets.push(stage2.design_register);
  }

  if (isPresentBulletValue(imageTraits.shape_character)) {
    bullets.push(imageTraits.shape_character);
  }

  if (isPresentBulletValue(imageTraits.plan_shape) && String(imageTraits.plan_shape).trim().toLowerCase() !== "n/a") {
    bullets.push(imageTraits.plan_shape);
  }

  if (Array.isArray(stage2.distinctive_elements)) {
    stage2.distinctive_elements.forEach((value) => {
      if (isPresentBulletValue(value)) {
        bullets.push(value);
      }
    });
  }

  if (isPresentBulletValue(imageTraits.back_style)) {
    bullets.push(imageTraits.back_style);
  }

  if (isPresentBulletValue(imageTraits.body_construction)) {
    bullets.push(imageTraits.body_construction);
  }

  if (isPresentBulletValue(imageTraits.arm_option) && String(imageTraits.arm_option).trim().toLowerCase() !== "none") {
    bullets.push(imageTraits.arm_option);
  }

  if (isPresentBulletValue(imageTraits.arm_configuration)) {
    bullets.push(imageTraits.arm_configuration);
  }

  if (isPresentBulletValue(imageTraits.base_type)) {
    bullets.push(imageTraits.base_type);
  }

  if (isPresentBulletValue(imageTraits.configuration) && !isSingleSeatConfiguration(imageTraits.configuration)) {
    bullets.push(imageTraits.configuration);
  }

  if (isPresentBulletValue(imageTraits.seat_fabric) && !isPlaceholderSeatFabric(imageTraits.seat_fabric)) {
    bullets.push(imageTraits.seat_fabric);
  }

  if (isPresentBulletValue(imageTraits.base_finish)) {
    bullets.push(imageTraits.base_finish);
  }

  if (isPresentBulletValue(imageTraits.seat_upholstery) && !isPlaceholderSeatFabric(imageTraits.seat_upholstery)) {
    bullets.push(imageTraits.seat_upholstery);
  }

  if (isPresentBulletValue(imageTraits.back_upholstery)) {
    bullets.push(imageTraits.back_upholstery);
  }

  return bullets;
}

function formatQueryTraitEntries(queryTraits = {}) {
  const entries = [];
  const labels = {
    product_type: "type",
    seating_category_visual: "visual category",
    base_type: "base",
    frame_material: "frame material",
    frame_finish: "finish",
    arms_present: "arms",
    arm_material: "arm material",
    seat_material: "seat material",
    required_features: "required"
  };

  for (const [key, rawValue] of Object.entries(queryTraits)) {
    if (!(key in labels) || rawValue === null || rawValue === "" || rawValue === false) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((item) => entries.push(`${labels[key]}: ${item}`));
      continue;
    }

    entries.push(`${labels[key]}: ${rawValue === true ? "yes" : rawValue}`);
  }

  return entries;
}

function normalizeDisplayImageUrl(imageUrl = "") {
  const input = String(imageUrl || "").trim();
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    if (url.hostname === "content.designerpages.com") {
      url.pathname = url.pathname.replace(/_large(?=\.[a-z0-9]+$)/i, "");
    }
    return url.toString();
  } catch {
    return input.replace(/_large(?=\.[a-z0-9]+$)/i, "");
  }
}

function normalizeStage0Result(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "scene" || normalized === "product" || normalized === "product_detail" ? normalized : "";
}

function normalizeEffectiveClassification(value = "") {
  return normalizeStage0Result(value);
}

function formatStage0ResultLabel(value = "") {
  const normalized = normalizeStage0Result(value);
  if (normalized === "scene") return "Scene";
  if (normalized === "product_detail") return "Detail";
  if (normalized === "product") return "Product";
  return "";
}

function findSceneFilterForImage(sceneFilterResults = [], imageUrl = "") {
  const target = normalizeDisplayImageUrl(imageUrl);
  if (!target) {
    return null;
  }

  return (sceneFilterResults || []).find((entry) =>
    normalizeDisplayImageUrl(entry?.image_url) === target &&
    (entry?.result === "scene" || entry?.result === "product")
  ) || null;
}

function applySceneBadge(sceneBadge, imageUrl, sceneFilterResults = [], matchingImage = null) {
  const effectiveClassification = normalizeEffectiveClassification(
    matchingImage?.effective_classification || matchingImage?.stage_0_result
  );
  const match = effectiveClassification
    ? { result: effectiveClassification, model_version: "stored image record" }
    : findSceneFilterForImage(sceneFilterResults, imageUrl);
  if (!match) {
    sceneBadge.hidden = true;
    sceneBadge.textContent = "";
    sceneBadge.className = "scene-filter-badge";
    sceneBadge.removeAttribute("aria-label");
    sceneBadge.removeAttribute("title");
    return;
  }

  sceneBadge.hidden = false;
  sceneBadge.textContent = formatStage0ResultLabel(match.result);
  sceneBadge.className = `scene-filter-badge ${match.result === "scene" ? "is-scene" : "is-product"}`;
  sceneBadge.setAttribute(
    "aria-label",
    match.result === "scene"
      ? "Image classified as a scene photo by Stage 0"
      : match.result === "product_detail"
        ? "Image classified as a product detail photo by Stage 0"
        : "Image classified as a product photo by Stage 0"
  );
  sceneBadge.title = match.model_version
    ? `Stage 0: ${formatStage0ResultLabel(match.result)} (${match.model_version})`
    : `Stage 0: ${formatStage0ResultLabel(match.result)}`;
}

function resolveImagePresentation(imageUrl, sceneFilterResults = [], matchingImage = null) {
  const effectiveClassification = normalizeEffectiveClassification(
    matchingImage?.effective_classification || matchingImage?.stage_0_result
  );
  const match = effectiveClassification
    ? { result: effectiveClassification }
    : findSceneFilterForImage(sceneFilterResults, imageUrl);
  return match?.result === "scene" ? "scene" : "product";
}

function applyImagePresentation(cardImageWrap, heroImage, imageUrl, sceneFilterResults = [], matchingImage = null) {
  if (!cardImageWrap || !heroImage) {
    return;
  }

  const presentation = resolveImagePresentation(imageUrl, sceneFilterResults, matchingImage);
  cardImageWrap.classList.toggle("is-scene-image", presentation === "scene");
  cardImageWrap.classList.toggle("is-product-image", presentation !== "scene");
  heroImage.classList.toggle("is-scene-image", presentation === "scene");
  heroImage.classList.toggle("is-product-image", presentation !== "scene");
}

function normalizeMatchingImages(result = {}) {
  const matchingImages = Array.isArray(result.matching_images) ? result.matching_images : [];
  const normalized = matchingImages
    .map((image) => ({
      ...image,
      stage_0_result: normalizeStage0Result(image?.stage_0_result),
      effective_classification: normalizeEffectiveClassification(image?.effective_classification || image?.stage_0_result),
      image_url: normalizeDisplayImageUrl(image?.image_url)
    }))
    .filter((image) => image.image_url);
  if (normalized.length) {
    const isSearchMode = Boolean(state.lastQuery && !result?.browse_mode);
    if (isSearchMode) {
      const heroEffectiveClassification = normalizeEffectiveClassification(
        result.hero_image?.effective_classification || result.hero_image?.stage_0_result
      );
      const heroSeatingType = String(result.hero_image?.seating_type || "").trim().toLowerCase();
      const productOnly = normalized.filter((image) => image.effective_classification === "product");
      if (heroEffectiveClassification === "product" && heroSeatingType) {
        const sameSeatingType = productOnly.filter((image) => String(image.seating_type || "").trim().toLowerCase() === heroSeatingType);
        if (sameSeatingType.length) {
          return sameSeatingType;
        }
      }
      if (productOnly.length) {
        return productOnly;
      }
    }
    return normalized;
  }

  const catalogImages = (result.image_urls || [])
    .map((imageUrl) => normalizeDisplayImageUrl(imageUrl))
    .filter(Boolean)
    .map((imageUrl) => ({
      image_url: imageUrl,
      stage_0_result: "",
      effective_classification: "",
      score: Number(result.score || 0)
    }));
  if (catalogImages.length) {
    return catalogImages;
  }

  const heroImageUrl = normalizeDisplayImageUrl(result.hero_image?.image_url || result.best_image_url);
  const heroStage0Result = normalizeStage0Result(result.hero_image?.stage_0_result);
  const heroEffectiveClassification = normalizeEffectiveClassification(
    result.hero_image?.effective_classification || result.hero_image?.stage_0_result
  );
  if (heroImageUrl) {
    return [{
      image_id: result.hero_image?.image_id,
      image_url: heroImageUrl,
      stage_0_result: heroStage0Result,
      effective_classification: heroEffectiveClassification,
      score: Number(result.hero_image?.score ?? result.score ?? 0),
      confidence_tier: result.hero_image?.confidence_tier || result.confidence_tier || "high"
    }];
  }

  return [];
}

function findActiveMatchingImage(result = {}, imageUrl = "") {
  const normalizedTarget = normalizeDisplayImageUrl(imageUrl);
  return normalizeMatchingImages(result).find((image) => image.image_url === normalizedTarget) || null;
}

function renderHeroScore(scoreBadge, matchingImage, fallbackScore = 0) {
  if (!scoreBadge) {
    return;
  }

  const score = Number(matchingImage?.score ?? fallbackScore ?? 0);
  scoreBadge.textContent = `Score ${score.toFixed(2)}`;
}

function syncSearchFromImageButton(button, result, matchingImage = null) {
  if (!button) {
    return;
  }

  const hasStoredEmbedding = Array.isArray(matchingImage?.visual_summary_embedding) &&
    matchingImage.visual_summary_embedding.length > 0;
  button.hidden = !hasStoredEmbedding;
  button.disabled = !hasStoredEmbedding || state.refinementLoading;
  button.title = hasStoredEmbedding ? "Search from this image" : "No stored embedding for this image";
  button.onclick = hasStoredEmbedding
    ? () => {
        searchFromStoredImage(result, matchingImage).catch((error) => {
          setStatus(error.message || "Stored image search failed.", "error");
        });
      }
    : null;
}

function renderThumbnails(container, result, heroImage, cardImageWrap, sceneBadge, scoreBadge, searchFromImageButton) {
  container.innerHTML = "";
  const matchingImages = normalizeMatchingImages(result);
  const imageUrls = matchingImages.map((image) => image.image_url);
  const defaultVisibleCount = 7;
  const hiddenCount = Math.max(matchingImages.length - defaultVisibleCount, 0);
  const visibleImages = matchingImages.slice(0, defaultVisibleCount);
  const sceneFilterResults = Array.isArray(result.scene_filter_results) ? result.scene_filter_results : [];
  const bestImageUrl = normalizeDisplayImageUrl(result.best_image_url);
  const storedActiveImageUrl = normalizeDisplayImageUrl(state.activeCardImageUrls[result.product_id] || "");
  const activeImageUrl = imageUrls.includes(storedActiveImageUrl)
    ? storedActiveImageUrl
    : imageUrls.includes(bestImageUrl)
      ? bestImageUrl
      : imageUrls[0] || "";
  const activeMatchingImage = findActiveMatchingImage(result, activeImageUrl);
  state.activeCardImageUrls[result.product_id] = activeImageUrl;

  if (!imageUrls.length) {
    container.classList.add("thumbnail-strip-hidden");
    if (activeImageUrl) {
      heroImage.src = activeImageUrl;
      applyImagePresentation(cardImageWrap, heroImage, activeImageUrl, sceneFilterResults, activeMatchingImage);
      applySceneBadge(sceneBadge, activeImageUrl, sceneFilterResults, activeMatchingImage);
    }
    renderHeroScore(scoreBadge, activeMatchingImage, result.score);
    syncSearchFromImageButton(searchFromImageButton, result, activeMatchingImage);
    return;
  }

  container.classList.toggle("thumbnail-strip-hidden", imageUrls.length <= 1);
  if (activeImageUrl && normalizeDisplayImageUrl(heroImage.src) !== activeImageUrl) {
    heroImage.src = activeImageUrl;
  }
  applyImagePresentation(cardImageWrap, heroImage, activeImageUrl, sceneFilterResults, activeMatchingImage);
  applySceneBadge(sceneBadge, activeImageUrl, sceneFilterResults, activeMatchingImage);
  renderHeroScore(scoreBadge, activeMatchingImage, result.score);
  syncSearchFromImageButton(searchFromImageButton, result, activeMatchingImage);

  if (imageUrls.length <= 1) {
    return;
  }

  visibleImages.forEach((matchingImage, index) => {
    const imageUrl = matchingImage.image_url;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail-button";
    if (imageUrl === activeImageUrl) {
      button.classList.add("active");
    }

    const thumbnail = document.createElement("img");
    thumbnail.src = imageUrl;
    thumbnail.alt = `${result.name} alternate view ${index + 1}`;
    thumbnail.loading = "lazy";
    thumbnail.className = "thumbnail-image";

    button.addEventListener("click", () => {
      state.activeCardImageUrls[result.product_id] = imageUrl;
      const shouldRefreshPanel = state.inlineRefinementPanel?.productId === result.product_id;
      heroImage.src = imageUrl;
      applyImagePresentation(cardImageWrap, heroImage, imageUrl, sceneFilterResults, matchingImage);
      applySceneBadge(sceneBadge, imageUrl, sceneFilterResults, matchingImage);
      renderHeroScore(scoreBadge, matchingImage, result.score);
      syncSearchFromImageButton(searchFromImageButton, result, matchingImage);
      container.querySelectorAll(".thumbnail-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (shouldRefreshPanel) {
        renderResults(state.lastPayload, state.lastQuery);
      }
    });

    button.appendChild(thumbnail);
    container.appendChild(button);
  });

  if (hiddenCount > 0) {
    const overflowIndicator = document.createElement("span");
    overflowIndicator.className = "thumbnail-button thumbnail-button-overflow";
    overflowIndicator.setAttribute("aria-label", `${hiddenCount} more images available for ${result.name}`);

    const overflowLabel = document.createElement("span");
    overflowLabel.className = "thumbnail-overflow-label";
    overflowLabel.textContent = `+${hiddenCount}`;

    overflowIndicator.appendChild(overflowLabel);
    container.appendChild(overflowIndicator);
  }
}

function getActiveImageContextForResult(result = {}) {
  const matchingImages = normalizeMatchingImages(result);
  const storedImageUrl = normalizeDisplayImageUrl(state.activeCardImageUrls[result.product_id] || "");
  const bestImageUrl = normalizeDisplayImageUrl(result.best_image_url);
  const resolvedImageUrl = matchingImages.some((image) => image.image_url === storedImageUrl)
    ? storedImageUrl
    : matchingImages.some((image) => image.image_url === bestImageUrl)
      ? bestImageUrl
      : matchingImages[0]?.image_url || bestImageUrl;
  const matchingImage = findActiveMatchingImage(result, resolvedImageUrl);

  return {
    imageUrl: resolvedImageUrl,
    matchingImage,
    seatingType: String(
      matchingImage?.seating_type ||
      result.hero_image?.seating_type ||
      result.debug?.stage1?.seating_type ||
      state.currentSeatingType ||
      ""
    ).trim(),
    imageTraits: matchingImage?.enum_fields || result.hero_image?.enum_fields || result.debug?.image_traits || {}
  };
}

function getRefinementEmbeddingForResult(result = {}, matchingImage = null) {
  return normalizeClientEmbedding(
    matchingImage?.visual_summary_embedding ||
    result.hero_image?.visual_summary_embedding ||
    result.visual_summary_embedding ||
    []
  );
}

function buildInlineRefinementPanelState(result = {}, mode = "more") {
  const imageContext = getActiveImageContextForResult(result);
  const allTraits = buildInlineRefinementTraits(imageContext.imageTraits, imageContext.seatingType);
  const activeFieldMap = buildActiveBulletFieldMap();
  const availableTraits = allTraits
    .map((trait) => {
      const activeEntry = activeFieldMap.get(trait.field);
      if (!activeEntry) {
        return mode === "more"
          ? {
              ...trait,
              action: "add",
              actionLabel: "Add",
              existingValue: "",
              existingPriority: defaultPriorityForBulletField(trait.field)
            }
          : null;
      }

      const activeKey = buildTraitSelectionKey(activeEntry.field, activeEntry.value);
      if (activeKey === trait.key) {
        return mode === "less"
          ? {
              ...trait,
              action: "remove",
              actionLabel: "Remove",
              existingValue: activeEntry.value,
              existingPriority: activeEntry.priority
            }
          : null;
      }

      return mode === "more"
        ? {
            ...trait,
            action: "switch",
            actionLabel: "Switch",
            existingValue: activeEntry.value,
            existingPriority: activeEntry.priority
          }
        : null;
    })
    .filter(Boolean)
    .slice(0, 6);

  let message = "";
  if (!availableTraits.length) {
    if (mode === "more") {
      message = "All traits from this product are already active in your search. You can still blend toward this product's overall style.";
    } else {
      message = "None of this product's traits are currently active in your search. You can still steer away from this product's overall style.";
    }
  }

  return {
    ...imageContext,
    mode,
    allTraits,
    traits: availableTraits,
    fallbackMessage: message,
    fallbackEmbedding: getRefinementEmbeddingForResult(result, imageContext.matchingImage)
  };
}

async function applyInlineTraitRefinement({ result, mode, traits }) {
  const selectedTraits = Array.isArray(traits) ? traits : [];
  if (!selectedTraits.length) {
    return;
  }

  const selectedKeys = new Set(selectedTraits.map((trait) => trait.key));
  const replacementMap = new Map(
    selectedTraits
      .filter((trait) => trait.action === "switch")
      .map((trait) => [trait.field, trait])
  );
  let nextControls = normalizeBulletControls(
    state.currentBulletControls.filter((entry) => {
      if (entry.priority === "off") {
        return true;
      }
      const parsed = parseStructuredBulletEntry(entry.text, entry.priority);
      if (!parsed) {
        return true;
      }
      if (mode === "less") {
        return !selectedKeys.has(buildTraitSelectionKey(parsed.field, parsed.value));
      }
      if (replacementMap.has(parsed.field)) {
        return false;
      }
      return true;
    })
  );

  if (mode === "more") {
    nextControls = normalizeBulletControls([
      ...nextControls,
      ...selectedTraits.map((trait) => ({
        text: trait.text,
        priority: trait.action === "switch"
          ? trait.existingPriority || "normal"
          : defaultPriorityForBulletField(trait.field)
      }))
    ]);
  }

  const nextSelectedBullets = deriveSelectedBulletsFromControls(nextControls);
  const currentQueryText = getSearchComposerRequestQuery(state.lastQuery);
  const traitChanges = buildTraitChangePayload(selectedTraits);
  let nextQuery = "";
  let rewriteFailureReason = "";
  try {
    nextQuery = await rewriteQueryForTraitChanges(
      currentQueryText,
      traitChanges,
      [
        ...nextSelectedBullets.essential,
        ...nextSelectedBullets.normal,
        ...nextSelectedBullets.low
      ]
    );
  } catch (error) {
    rewriteFailureReason = error.message || "rewrite request failed";
    console.warn("[rewrite-query-traits] falling back after request failure:", rewriteFailureReason);
  }
  if (!nextQuery) {
    console.warn(
      "[rewrite-query-traits] falling back to composeQueryWithFallback",
      {
        reason: rewriteFailureReason || "rewrite returned empty query",
        currentQueryText,
        traitChanges,
        activeBullets: filterQueryComposableBullets([
          ...nextSelectedBullets.essential,
          ...nextSelectedBullets.normal,
          ...nextSelectedBullets.low
        ])
      }
    );
    nextQuery = await composeQueryWithFallback(nextSelectedBullets);
  }
  setSearchInputValue(nextQuery);
  closeInlineRefinementPanel();
  let payload = null;
  let previousPayload = cloneValue(state.originalPayload);

  if (state.currentImageAnalysis?.image_preview_url && state.currentBaseQueryEmbedding.length) {
    const queryEmbedding = state.currentProductRefinements.length
      ? computeQueryEmbeddingFromRefinements(state.currentBaseQueryEmbedding, state.currentProductRefinements)
      : state.currentBaseQueryEmbedding;
    previousPayload = cloneValue(state.lastPayload);
    const reranked = await rerankResults({
      queryEmbedding,
      query: nextQuery,
      bulletControls: nextControls,
      baseQueryEmbedding: state.currentBaseQueryEmbedding,
      productRefinements: state.currentProductRefinements,
      statusMessage: mode === "more" ? "Adding product traits..." : "Removing product traits..."
    });
    payload = reranked.payload;
    previousPayload = reranked.previousPayload;
  } else {
    const basePayload = await runSearch(nextQuery, {
      sort: state.sortMode,
      sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
      imageAnalysis: state.currentImageAnalysis,
      selectedBullets: nextSelectedBullets,
      bulletControls: nextControls,
      preserveOriginal: true,
      refinementActive: true,
      productRefinements: []
    });
    if (!basePayload) {
      return;
    }

    payload = basePayload;
    previousPayload = cloneValue(state.originalPayload);

    if (state.currentProductRefinements.length) {
      previousPayload = cloneValue(state.lastPayload);
      const nextEmbedding = computeQueryEmbeddingFromRefinements(basePayload?.query_embedding || [], state.currentProductRefinements);
      const reranked = await rerankResults({
        queryEmbedding: nextEmbedding,
        query: nextQuery,
        bulletControls: nextControls,
        baseQueryEmbedding: basePayload?.query_embedding || [],
        productRefinements: state.currentProductRefinements,
        statusMessage: mode === "more" ? "Adding product traits..." : "Removing product traits..."
      });
      payload = reranked.payload;
      previousPayload = reranked.previousPayload;
    }
  }

}

function renderResults(payload, query) {
  setInitialSearchPending(false);
  setResultsLoading("");
  state.lastPayload = payload;
  state.lastQuery = query;
  renderSearchComposer(query);
  const isBrowseMode = isBrowsePayload(payload, query);
  const cutoffMeta = computeResultCutoffMeta(payload, query, isBrowseMode);
  const showWeakerMatchesToggle = shouldShowWeakerMatchesToggle(cutoffMeta, isBrowseMode);
  if (payload.sort) {
    state.sortMode = payload.sort;
  }
  if (elements.sortSelect && elements.sortSelect.value !== state.sortMode) {
    elements.sortSelect.value = state.sortMode;
  }
  state.selectedProductIds = new Set(
    [...state.selectedProductIds].filter((productId) => payload.results.some((result) => result.product_id === productId))
  );
  if (!elements.resultsGrid) {
    return;
  }
  elements.resultsGrid.innerHTML = "";
  const resultsHeader = document.querySelector(".results-header");
  if (resultsHeader) {
    resultsHeader.hidden = Boolean(state.categoryRequirement);
    resultsHeader.classList.toggle("is-search-mode", !isBrowseMode);
  }
  if (elements.refreshAgeFilterWrap) {
    elements.refreshAgeFilterWrap.hidden = !isBrowseMode;
  }
  syncManageToolbar();
  renderContextPills(payload.parsed);
  renderClarificationBar();
  renderRefineSidebar();

  if (!query) {
    setResultCountMarkup(payload.total_results, "catalog products");
    setStatus("");
  }

  if (!payload.results.length) {
    const activeScopeCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
    setResultCountMarkup(0, "results found");
    setStatus(
      activeScopeCategory && activeScopeCategory !== "all"
        ? `No matches in ${formatSeatingCategoryLabel(activeScopeCategory)}. Try another?`
        : "No results matched that combination of category, brand, and visual traits.",
      "empty"
    );
    return;
  }

  if (query) {
    setStatus("");
    setResultCountMarkup(payload.total_results || payload.results.length, "results found");
  }

  payload.results.forEach((result, index) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const resultTile = fragment.querySelector(".result-tile");
    const image = fragment.querySelector(".card-image");
    const cardImageWrap = fragment.querySelector('[data-role="cardImageWrap"]');
    const scoreBadge = fragment.querySelector('[data-role="scoreBadge"]');
    const sceneBadge = fragment.querySelector('[data-role="sceneBadge"]');
    const searchFromImageButton = fragment.querySelector('[data-role="searchFromImageButton"]');
    const productName = fragment.querySelector(".product-name");
    const brandName = fragment.querySelector(".brand-name");
    const categoryTags = fragment.querySelector('[data-role="categoryTags"]');
    const refinementActions = fragment.querySelector('[data-role="refinementActions"]');
    const moreLikeThisButton = fragment.querySelector('[data-role="moreLikeThisButton"]');
    const lessLikeThisButton = fragment.querySelector('[data-role="lessLikeThisButton"]');
    const metaBlock = fragment.querySelector(".meta-block");
    const traits = fragment.querySelector('[data-role="traits"]');
    const details = fragment.querySelector(".debug-details");
    const caption = fragment.querySelector(".debug-caption");
    const thumbnails = fragment.querySelector('[data-role="thumbnails"]');
    const queryTraits = fragment.querySelector('[data-role="queryTraits"]');
    const mismatches = fragment.querySelector('[data-role="mismatches"]');
    const scoreBreakdown = fragment.querySelector('[data-role="scoreBreakdown"]');
    const inspectButton = fragment.querySelector('[data-role="inspectButton"]');
    const manageCheckboxWrap = fragment.querySelector('[data-role="manageCheckboxWrap"]');
    const manageCheckbox = fragment.querySelector('[data-role="manageCheckbox"]');
    const queryTraitsLabel = queryTraits.previousElementSibling;
    const mismatchesLabel = mismatches.previousElementSibling;
    const scoreBreakdownLabel = scoreBreakdown.previousElementSibling;
    const summary = details.querySelector("summary");
    const captionLabel = caption.previousElementSibling;
    const traitsLabel = traits.previousElementSibling;
    const scoreRank = index + 1;
    const isWeakerMatch = showWeakerMatchesToggle && scoreRank > cutoffMeta.cutoff;

    if (resultTile) {
      resultTile.classList.toggle("result-tile-weaker", isWeakerMatch);
      resultTile.hidden = isWeakerMatch && !state.weakerMatchesExpanded;
    }

    const fallbackImageUrls = [...new Set([
      normalizeDisplayImageUrl(result.best_image_url),
      ...normalizeMatchingImages(result).map((imageRecord) => normalizeDisplayImageUrl(imageRecord.image_url)),
      ...((result.image_urls || []).map((imageUrl) => normalizeDisplayImageUrl(imageUrl)))
    ].filter(Boolean))];
    let fallbackImageIndex = 0;
    const applyCardImage = (imageUrl = "") => {
      const normalizedImageUrl = normalizeDisplayImageUrl(imageUrl);
      if (!normalizedImageUrl) {
        image.removeAttribute("src");
        image.hidden = true;
        cardImageWrap.classList.add("is-empty");
        return;
      }
      image.hidden = false;
      cardImageWrap.classList.remove("is-empty");
      image.src = normalizedImageUrl;
    };
    image.onerror = () => {
      fallbackImageIndex += 1;
      const nextImageUrl = fallbackImageUrls[fallbackImageIndex] || "";
      applyCardImage(nextImageUrl);
    };
    image.onload = () => {
      image.hidden = false;
      cardImageWrap.classList.remove("is-empty");
    };
    applyCardImage(fallbackImageUrls[0] || "");
    image.alt = `${result.name} by ${result.brand}`;
    applySceneBadge(
      sceneBadge,
      result.best_image_url,
      result.scene_filter_results || [],
      normalizeMatchingImages(result).find((imageRecord) => imageRecord.image_url === normalizeDisplayImageUrl(result.best_image_url))
    );
    productName.textContent = "";
    const productWebsite = String(result.website || "").trim() || buildDesignerPagesProductUrl(result.product_id);
    cardImageWrap.classList.toggle("is-linked", Boolean(productWebsite));
    cardImageWrap.onclick = null;
    if (productWebsite) {
      cardImageWrap.setAttribute("role", "link");
      cardImageWrap.setAttribute("tabindex", "0");
      cardImageWrap.setAttribute("aria-label", `Open ${result.name} on Designer Pages`);
      cardImageWrap.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".search-from-image-button, .inspect-control")) {
          return;
        }
        window.open(productWebsite, "_blank", "noopener,noreferrer");
      });
      cardImageWrap.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest(".search-from-image-button, .inspect-control")) {
          return;
        }
        event.preventDefault();
        window.open(productWebsite, "_blank", "noopener,noreferrer");
      });
    } else {
      cardImageWrap.removeAttribute("role");
      cardImageWrap.removeAttribute("tabindex");
      cardImageWrap.removeAttribute("aria-label");
    }
    if (productWebsite) {
      const productLink = document.createElement("a");
      productLink.href = productWebsite;
      productLink.target = "_blank";
      productLink.rel = "noreferrer noopener";
      productLink.className = "product-name-link";
      productLink.setAttribute("aria-label", `Open ${result.name} on Designer Pages`);
      productLink.title = "Open on Designer Pages";
      productLink.textContent = result.name;
      productName.appendChild(productLink);
    } else {
      productName.textContent = result.name;
    }
    brandName.textContent = result.brand;
    categoryTags.innerHTML = "";
    getResultCategoryTags(result).forEach((category) => categoryTags.appendChild(createChip(category, true)));
    caption.textContent = result.debug.structured_caption;
    renderThumbnails(thumbnails, result, image, cardImageWrap, sceneBadge, scoreBadge, searchFromImageButton);
    const isSelected = state.selectedProductIds.has(result.product_id);
    const hasIndex = Boolean(state.bootstrap?.has_index);
    manageCheckboxWrap.hidden = !state.manageMode;
    manageCheckbox.checked = isSelected;
    manageCheckbox.disabled = state.batchRefreshing;
    const canRefine = !isBrowseMode && Array.isArray(state.currentQueryEmbedding) && state.currentQueryEmbedding.length > 0;
    const morePanelState = canRefine ? buildInlineRefinementPanelState(result, "more") : null;
    const lessPanelState = canRefine ? buildInlineRefinementPanelState(result, "less") : null;
    const hasMoreTraits = Boolean(morePanelState?.traits?.length);
    const hasLessTraits = Boolean(lessPanelState?.traits?.length);
    const activePanelState = state.inlineRefinementPanel?.productId === result.product_id
      ? (state.inlineRefinementPanel.mode === "more" ? morePanelState : lessPanelState)
      : null;
    const panelState = activePanelState?.traits?.length ? activePanelState : null;
    refinementActions.hidden = !canRefine || state.manageMode || (!hasMoreTraits && !hasLessTraits);
    moreLikeThisButton.hidden = !hasMoreTraits;
    lessLikeThisButton.hidden = !hasLessTraits;
    moreLikeThisButton.disabled = state.refinementLoading;
    lessLikeThisButton.disabled = state.refinementLoading;
    moreLikeThisButton.setAttribute("aria-pressed", String(Boolean(panelState && panelState.mode === "more")));
    lessLikeThisButton.setAttribute("aria-pressed", String(Boolean(panelState && panelState.mode === "less")));

    if (isBrowseMode) {
      scoreBadge.hidden = true;
      inspectButton.hidden = true;
      summary.hidden = true;
      queryTraits.hidden = true;
      queryTraitsLabel.hidden = true;
      mismatches.hidden = true;
      mismatchesLabel.hidden = true;
      scoreBreakdown.hidden = true;
      scoreBreakdownLabel.hidden = true;
    } else {
      scoreBadge.hidden = false;
      inspectButton.hidden = true;
      summary.hidden = !state.debug;
      queryTraits.hidden = !state.debug;
      queryTraitsLabel.hidden = !state.debug;
      mismatches.hidden = !state.debug;
      mismatchesLabel.hidden = !state.debug;
      scoreBreakdown.hidden = true;
      scoreBreakdownLabel.hidden = true;
    }

    (result.debug.detected_traits || []).slice(0, 6).forEach((trait) => traits.appendChild(createChip(trait, true)));
    formatQueryTraitEntries(result.debug.query_traits || {}).slice(0, 6).forEach((trait) => queryTraits.appendChild(createChip(trait, true)));
    (result.debug.mismatch_traits || []).slice(0, 4).forEach((trait) => mismatches.appendChild(createChip(trait, true)));
    (result.debug.score_breakdown || []).forEach((item) => {
      const row = document.createElement("div");
      row.className = "score-breakdown-row";

      const label = document.createElement("span");
      label.className = "score-breakdown-label";
      label.textContent = item.label;

      const value = document.createElement("span");
      value.className = `score-breakdown-value ${Number(item.value) >= 0 ? "positive" : "negative"}`;
      value.textContent = formatScoreValue(item.value);

      row.append(label, value);
      scoreBreakdown.appendChild(row);
    });

    const inspectOpen = state.inspectedProductId === result.product_id;

    if (!state.debug && !inspectOpen) {
      details.open = false;
      details.hidden = true;
    } else if (state.debug) {
      details.hidden = false;
      details.open = state.expandedProductId ? state.expandedProductId === result.product_id : index === 1;
    } else {
      details.hidden = false;
      details.open = inspectOpen;
    }

    if (inspectOpen && !isBrowseMode) {
      summary.hidden = true;
      queryTraits.hidden = true;
      queryTraitsLabel.hidden = true;
      mismatches.hidden = true;
      mismatchesLabel.hidden = true;
      caption.hidden = true;
      captionLabel.hidden = true;
      traits.hidden = true;
      traitsLabel.hidden = true;
      scoreBreakdown.hidden = false;
      scoreBreakdownLabel.hidden = false;
    } else {
      caption.hidden = false;
      captionLabel.hidden = false;
      traits.hidden = false;
      traitsLabel.hidden = false;
      scoreBreakdown.hidden = true;
      scoreBreakdownLabel.hidden = true;
    }

    moreLikeThisButton.addEventListener("click", () => {
      if (!hasMoreTraits) {
        return;
      }
      toggleInlineRefinementPanel({
        productId: result.product_id,
        mode: "more",
        imageUrl: state.activeCardImageUrls[result.product_id] || result.best_image_url
      });
    });
    lessLikeThisButton.addEventListener("click", () => {
      if (!hasLessTraits) {
        return;
      }
      toggleInlineRefinementPanel({
        productId: result.product_id,
        mode: "less",
        imageUrl: state.activeCardImageUrls[result.product_id] || result.best_image_url
      });
    });

    if (panelState && metaBlock) {
      const panel = document.createElement("section");
      panel.className = "inline-refinement-panel";
      panel.setAttribute("aria-label", panelState.mode === "more" ? "Add traits from this product" : "Remove traits from this product");

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "inline-refinement-close";
      closeButton.setAttribute("aria-label", "Close trait refinement");
      closeButton.textContent = "×";
      closeButton.addEventListener("click", () => {
        closeInlineRefinementPanel();
        renderResults(state.lastPayload, state.lastQuery);
      });
      panel.appendChild(closeButton);

      const title = document.createElement("p");
      title.className = "inline-refinement-title";
      title.textContent = panelState.mode === "more" ? "Add traits from this product" : "Remove traits from this product.";
      panel.appendChild(title);

      if (panelState.traits.length) {
        const helper = document.createElement("p");
        helper.className = "inline-refinement-copy";
        helper.textContent = panelState.mode === "more"
          ? "Select traits to add or switch in your active bullets."
          : "Select active traits to remove from the search.";
        panel.appendChild(helper);

        const pillRow = document.createElement("div");
        pillRow.className = "inline-refinement-pill-row";
        const selectedTraitKeys = new Set(state.inlineRefinementPanel?.selectedTraitKeys || []);
        panelState.traits.forEach((trait) => {
          const pill = document.createElement("button");
          pill.type = "button";
          pill.className = "inline-refinement-pill";
          const isSelected = selectedTraitKeys.has(trait.key);
          pill.classList.toggle("is-selected", isSelected);
          pill.setAttribute("aria-pressed", String(isSelected));
          const displayText = panelState.mode === "more" && trait.action === "switch"
            ? `${trait.text} (replace ${trait.existingValue})`
            : `${trait.text}`;
          const parts = formatRefineBulletParts(displayText);
          const label = document.createElement("span");
          label.className = "inline-refinement-pill-label";
          label.textContent = parts.label;
          const value = document.createElement("span");
          value.className = "inline-refinement-pill-value";
          value.textContent = parts.value || parts.label;
          if (!parts.value) {
            label.hidden = true;
          }
          pill.append(label, value);
          pill.addEventListener("click", () => {
            toggleInlineRefinementTraitSelection(result.product_id, panelState.mode, trait.key);
          });
          pillRow.appendChild(pill);
        });
        panel.appendChild(pillRow);

        const actions = document.createElement("div");
        actions.className = "inline-refinement-actions";
        actions.hidden = !selectedTraitKeys.size;

        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.className = "inline-refinement-apply";
        confirm.textContent = panelState.mode === "more" ? "Apply selected traits" : "Remove selected traits";
        confirm.disabled = state.refinementLoading || !selectedTraitKeys.size;
        confirm.addEventListener("click", async () => {
          const selectedTraits = panelState.traits.filter((trait) => selectedTraitKeys.has(trait.key));
          try {
            await applyInlineTraitRefinement({
              result,
              mode: panelState.mode,
              traits: selectedTraits
            });
          } catch (error) {
            setStatus(error.message || "Trait refinement failed.", "error");
          }
        });

        actions.append(confirm);
        panel.appendChild(actions);
      }

      metaBlock.appendChild(panel);
    }
    manageCheckbox.addEventListener("change", () => {
      if (manageCheckbox.checked) {
        state.selectedProductIds.add(result.product_id);
      } else {
        state.selectedProductIds.delete(result.product_id);
      }
      syncManageToolbar();
    });

    details.addEventListener("toggle", () => {
      if (!state.debug) {
        if (details.open && isWeakerMatch) {
          logWeakerResultInteraction("expand", result, scoreRank);
        }
        return;
      }
      if (details.open) {
        state.expandedProductId = result.product_id;
        document.querySelectorAll(".debug-details").forEach((other) => {
          if (other !== details) {
            other.open = false;
          }
        });
        if (isWeakerMatch) {
          logWeakerResultInteraction("expand", result, scoreRank);
        }
      }
    });

    if (isWeakerMatch && resultTile) {
      resultTile.addEventListener("mouseenter", () => {
        logWeakerResultInteraction("hover", result, scoreRank);
      });
      resultTile.addEventListener("click", () => {
        logWeakerResultInteraction("click", result, scoreRank);
      });
    }

    if (showWeakerMatchesToggle && scoreRank === cutoffMeta.cutoff + 1) {
      const weakSectionWrap = document.createElement("div");
      weakSectionWrap.className = "results-cutoff-section";

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "rules-summary-button results-cutoff-toggle";
      toggleButton.textContent = state.weakerMatchesExpanded
        ? "Hide weaker matches"
        : `+${cutoffMeta.hiddenCount} weaker matches — take a look?`;
      toggleButton.addEventListener("click", () => {
        const nextExpanded = !state.weakerMatchesExpanded;
        state.weakerMatchesExpanded = nextExpanded;
        if (nextExpanded) {
          logEvent("weaker_matches_revealed", {
            totalResults: payload.results.length,
            cutoff: cutoffMeta.cutoff,
            hiddenCount: cutoffMeta.hiddenCount
          });
        }
        renderResults(state.lastPayload, state.lastQuery);
      });
      weakSectionWrap.appendChild(toggleButton);

      elements.resultsGrid.appendChild(weakSectionWrap);
    }

    elements.resultsGrid.appendChild(fragment);
  });
}

async function runSearch(query, options = {}) {
  const normalizedQuery = query.trim();
  const sourceImageUrl = String(options.sourceImageUrl || "").trim();
  const sort = options.sort || state.sortMode || "auto";
  const categoryFilter = normalizeCategoryFilter(options.categoryFilter ?? state.categoryFilter ?? []);
  const refreshAgeFilter = String(options.refreshAgeFilter ?? state.refreshAgeFilter ?? "").trim();
  const imageAnalysis = options.imageAnalysis && typeof options.imageAnalysis === "object" ? options.imageAnalysis : null;
  const requestedCategoryScopeMode = String(
    options.categoryScopeMode ||
    state.categoryScopeMode ||
    "all"
  ).trim().toLowerCase();
  const requestedSeatingType = String(
    options.seatingType ??
    getPrimaryCategoryScopeSelection(state.resultCategoryScope) ??
    imageAnalysis?.stage1?.seating_type ??
    imageAnalysis?.seating_type ??
    ""
  ).trim();
  const normalizedRequestedSeatingType = requestedCategoryScopeMode === "all"
    ? "all"
    : requestedSeatingType;
  const apiRequestedSeatingType = requestedCategoryScopeMode === "explicit"
    ? normalizedRequestedSeatingType
    : "";
  const requestedSelectedBullets = normalizeSelectedBullets(options.selectedBullets);
  const requestedBulletControls = normalizeBulletControls(
    options.bulletControls?.length
      ? options.bulletControls
      : [
          ...requestedSelectedBullets.essential.map((text) => ({ text, priority: "essential" })),
          ...requestedSelectedBullets.normal.map((text) => ({ text, priority: "normal" })),
          ...requestedSelectedBullets.low.map((text) => ({ text, priority: "low" }))
        ]
  );
  const preserveOriginal = Boolean(options.preserveOriginal);
  const refinementActive = Boolean(options.refinementActive);
  const productRefinements = normalizeProductRefinements(options.productRefinements || []);
  updateClarificationConflict(imageAnalysis ? getPrimaryClarificationConflict(imageAnalysis) : null);
  if (normalizedQuery && !state.bootstrap?.has_index) {
    setStatus("The search index is missing. Run the normalize and index scripts first.", "error");
    return null;
  }

  renderContextPills();
  state.refineDrawerOpen = false;
  elements.resultCount.textContent = normalizedQuery ? "Searching..." : "Loading catalog...";
  setResultsLoading(normalizedQuery ? "Embedding the visual query and ranking image captions..." : "Loading catalog products...");

  try {
    const shouldUsePostSearch = Boolean(imageAnalysis || apiRequestedSeatingType);
    const payload = shouldUsePostSearch
      ? await fetchJson("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: normalizedQuery,
            source_image_url: sourceImageUrl,
            sort,
            category: categoryFilter,
            refresh_age: refreshAgeFilter,
            ...(apiRequestedSeatingType ? { seating_type: apiRequestedSeatingType } : {}),
            image_analysis: imageAnalysis,
            selected_bullets: requestedSelectedBullets
          })
        })
      : await fetchJson(
          `/api/search?${new URLSearchParams([
            ["q", normalizedQuery],
            ["source_image_url", sourceImageUrl],
            ["sort", sort],
            ...(apiRequestedSeatingType ? [["seating_type", apiRequestedSeatingType]] : []),
            ...categoryFilter.map((category) => ["category", category]),
            ["refresh_age", refreshAgeFilter]
          ]).toString()}`
        );
    if (payload?.category_required && requestedCategoryScopeMode === "all" && !apiRequestedSeatingType) {
      setInitialSearchPending(false);
      state.lastQuery = normalizedQuery;
      state.lastPayload = { ...payload, results: [] };
      state.currentSeatingType = "";
      state.resultCategoryScope = ["all"];
      state.categoryScopeMode = "all";
      state.currentSelectedBullets = requestedSelectedBullets;
      state.currentBulletControls = requestedBulletControls;
      updateClarificationConflict(null);
      updateCategoryRequirement({
        query: normalizedQuery,
        options: Array.isArray(payload?.seating_category_options) ? payload.seating_category_options : CATEGORY_REQUIREMENT_OPTION_KEYS,
        message: "We could not determine the category of product you are looking for.\nPlease select an option below."
      });
      renderSearchComposer(normalizedQuery);
      setResultsLoading("");
      if (elements.resultsGrid) {
        elements.resultsGrid.innerHTML = "";
      }
      if (elements.resultsSidebar) {
        elements.resultsSidebar.hidden = true;
        elements.resultsSidebar.classList.remove("is-open");
      }
      if (elements.resultsLayout) {
        elements.resultsLayout.classList.remove("has-sidebar");
      }
      if (elements.refineToggleButton) {
        elements.refineToggleButton.hidden = true;
      }
      if (elements.resultsHeader) {
        elements.resultsHeader.hidden = true;
      }
      renderContextPills();
      setStatus("");
      return payload;
    }
    if (refreshAgeFilter === "none" && Array.isArray(payload?.results)) {
      payload.results = payload.results.filter((result) => !hasUsableRefreshTimestamp(result?.ai_refreshed_at));
      payload.total_results = payload.results.length;
    }

    const payloadSelectedBullets = normalizeSelectedBullets(payload?.selected_bullets);
    const effectiveSelectedBullets = hasSelectedBullets(payloadSelectedBullets)
      ? payloadSelectedBullets
      : requestedSelectedBullets;
    const effectiveBulletControls = normalizeBulletControls(
      requestedBulletControls.length && !hasSelectedBullets(payloadSelectedBullets)
        ? requestedBulletControls
        : [
            ...effectiveSelectedBullets.essential.map((text) => ({ text, priority: "essential" })),
            ...effectiveSelectedBullets.normal.map((text) => ({ text, priority: "normal" })),
            ...effectiveSelectedBullets.low.map((text) => ({ text, priority: "low" }))
          ]
    );
    const effectiveSeatingType = String(
      normalizedRequestedSeatingType === "all" ? "" :
      normalizedRequestedSeatingType ||
      payload?.seating_type ||
      payload?.text_query_traits?.enum_fields?.seating_type ||
      ""
    ).trim();
    const normalizedStoredQuery = payload?.seating_type_source === "inferred" && effectiveSeatingType
      ? buildSearchQueryFromComposer(
          effectiveSeatingType,
          stripCategoryScopeFromQuery(
            String(payload?.parsed?.visual_query || normalizedQuery).trim(),
            effectiveSeatingType
          )
        )
      : normalizedQuery;
    applyActiveSearchContext({
      payload,
      query: normalizedStoredQuery,
      selectedBullets: effectiveSelectedBullets,
      bulletControls: effectiveBulletControls,
      baseQueryEmbedding: payload?.query_embedding,
      seatingType: effectiveSeatingType,
      imageAnalysis,
      productRefinements,
      categoryFilter: payload?.category_filter ?? categoryFilter,
      refreshAgeFilter: payload?.refresh_age_filter ?? refreshAgeFilter,
      preserveOriginal,
      refinementActive
    });
    renderResults(payload, normalizedStoredQuery);
    return payload;
  } catch (error) {
    setInitialSearchPending(false);
    setResultsLoading("");
    setStatus(error.message, "error");
    return null;
  }
}

function openImageModal() {
  if (!state.bootstrap?.image_analysis_available) {
    setStatus("Image-led search requires OPENAI_API_KEY on the local server.", "error");
    return;
  }
  elements.imageModal.hidden = false;
  document.body.classList.add("modal-open");
  resetImageFlow();
  showUploadStage();
}

function closeImageModal() {
  elements.imageModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function openRulesModal() {
  elements.rulesModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeRulesModal() {
  elements.rulesModal.hidden = true;
  if (elements.imageModal.hidden && elements.structuredTraitsModal.hidden && elements.extractionSummaryModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function openStructuredTraitsModal() {
  renderStructuredTraitsModalContent();
  if (elements.copyStructuredTraitsStatus) {
    elements.copyStructuredTraitsStatus.hidden = true;
  }
  elements.structuredTraitsModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeStructuredTraitsModal() {
  elements.structuredTraitsModal.hidden = true;
  if (elements.imageModal.hidden && elements.rulesModal.hidden && elements.extractionSummaryModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

async function openExtractionSummaryModal() {
  if (elements.extractionSummaryContent) {
    elements.extractionSummaryContent.innerHTML = '<p class="rules-summary-intro">Loading extraction summary...</p>';
  }
  elements.extractionSummaryModal.hidden = false;
  document.body.classList.add("modal-open");
  state.extractionSummary = await fetchExtractionSummary();
  renderExtractionSummary();
}

function closeExtractionSummaryModal() {
  elements.extractionSummaryModal.hidden = true;
  if (elements.imageModal.hidden && elements.rulesModal.hidden && elements.structuredTraitsModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function showUploadStage() {
  elements.modalTitle.textContent = "Visual Search";
  elements.imageModalUploadStage.hidden = false;
  elements.imageModalResultsStage.hidden = true;
  state.focusArea = null;
  state.cropModeActive = false;
  state.cropPreviewUrl = "";
  elements.inspirationPreview.removeAttribute("src");
  elements.focusBox.hidden = true;
  syncFocusStageControls();
  setImageAnalyzeLoading(false);
}

function showCropStage(previewUrl) {
  elements.modalTitle.textContent = "Focus on the item to search";
  elements.imageModalUploadStage.hidden = true;
  elements.imageModalResultsStage.hidden = false;
  state.cropPreviewUrl = String(previewUrl || "").trim();
  state.cropModeActive = false;
  state.focusArea = null;
  elements.inspirationPreview.src = state.cropPreviewUrl;
  syncFocusStageControls();
}

function restoreImageAnalysisPreSubmitScreen(previewUrl = "", focusArea = null) {
  const normalizedPreviewUrl = String(previewUrl || state.cropPreviewUrl || state.lastAnalyzeInput?.image_data_url || state.lastAnalyzeInput?.image_url || "").trim();
  if (!normalizedPreviewUrl) {
    showUploadStage();
    return;
  }

  const normalizedFocusArea = normalizeFocusArea(focusArea);
  showCropStage(normalizedPreviewUrl);
  if (normalizedFocusArea) {
    state.cropModeActive = true;
    setFocusArea(normalizedFocusArea);
  }
}

function resetImageFlow() {
  state.selectedUploadFile = null;
  state.lastAnalyzeInput = null;
  state.cropPreviewUrl = "";
  state.focusArea = null;
  state.cropModeActive = false;
  elements.imageUploadInput.value = "";
  elements.imageUrlInput.value = "";
  elements.selectedFileName.textContent = "";
  elements.selectedFileName.hidden = true;
  elements.inspirationPreview.removeAttribute("src");
  elements.focusBox.hidden = true;
  syncFocusStageControls();
  setImageAnalyzeLoading(false);
}

async function composeQueryForBullets(selectedBullets = [], options = {}) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  const composableBullets = filterQueryComposableBullets([
    ...normalized.essential,
    ...normalized.normal,
    ...normalized.low
  ]);
  if (!composableBullets.length) {
    return null;
  }

  if (!options.silent) {
    setStatus("Composing a search query from the selected visual bullets...");
  }
  const payload = await fetchJson("/api/compose-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seating_type: String(options.seatingType || state.currentImageAnalysis?.seating_type || "seating"),
      bullets: {
        essential: normalized.essential.filter((bullet) => isQueryComposableBullet(bullet)),
        normal: normalized.normal.filter((bullet) => isQueryComposableBullet(bullet)),
        low: normalized.low.filter((bullet) => isQueryComposableBullet(bullet))
      }
    })
  });
  return payload.query;
}

async function rewriteQueryForTraitChanges(currentQueryText = "", traitChanges = [], activeBullets = []) {
  const queryText = String(currentQueryText || "").trim();
  if (!queryText) {
    return "";
  }

  const payload = await fetchJson("/api/rewrite-query-traits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_query_text: queryText,
      trait_changes: traitChanges,
      active_bullets: filterQueryComposableBullets(activeBullets)
    })
  });
  return String(payload?.query || "").trim();
}

async function composeQueryWithFallback(selectedBullets = [], options = {}) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  const fallbackQuery = buildFallbackQueryFromStructuredBullets(normalized);

  try {
    const query = await Promise.race([
      composeQueryForBullets(normalized, options),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(""), 8000);
      })
    ]);
    return String(query || "").trim() || fallbackQuery;
  } catch {
    return fallbackQuery;
  }
}

function buildTraitChangePayload(traits = []) {
  return (traits || [])
    .filter((trait) => trait?.field !== "base_material")
    .map((trait) => ({
      field: trait.field,
      label: formatInlineRefinementFieldLabel(trait.field),
      old_value: trait.action === "add" ? "" : String(trait.existingValue || "").trim(),
      new_value: trait.action === "remove" ? "" : String(trait.value || "").trim(),
      action: trait.action
    }));
}

async function requestImageAnalysis(body) {
  const payload = await fetchJson("/api/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return payload.analysis;
}

function bulletsFromAnalysis(analysis) {
  if (analysis?.search_bullets && typeof analysis.search_bullets === "object") {
    const structured = normalizeSelectedBullets(analysis.search_bullets);
    if (structured.essential.length || structured.normal.length || structured.low.length) {
      return structured;
    }
  }
  if (Array.isArray(analysis?.search_bullets) && analysis.search_bullets.length) {
    return normalizeSelectedBullets(analysis.search_bullets);
  }
  const structuredBullets = buildStructuredInspirationBullets(analysis);
  if (structuredBullets.length) {
    return normalizeSelectedBullets(structuredBullets);
  }
  return normalizeSelectedBullets(analysis?.raw_visual_highlights || []);
}

async function runImageAnalysisSearch({ focusArea = null } = {}) {
  if (!state.lastAnalyzeInput) {
    setStatus("Choose an image file or paste an image URL first.", "error");
    return;
  }

  const body = focusArea ? { ...state.lastAnalyzeInput, focus_area: focusArea } : { ...state.lastAnalyzeInput };
  setImageAnalyzeLoading(true);
  updateImageAnalyzeProgress("prepare", {
    percent: 8,
    detail: focusArea
      ? "Preparing the selected crop for image analysis."
      : "Preparing the full image for analysis.",
    targetPercent: 18
  });
  setStatus(focusArea ? "Analyzing the selected focus area..." : "Analyzing the full image...");

  let analysis = null;
  try {
    updateImageAnalyzeProgress("analyze", {
      percent: 18,
      detail: focusArea
        ? "Sending the selected crop for visual analysis."
        : "Sending the image for visual analysis.",
      targetPercent: 68
    });
    analysis = await requestImageAnalysis(body);
    updateClarificationConflict(getPrimaryClarificationConflict(analysis));
    const selectedBullets = normalizeSelectedBullets(bulletsFromAnalysis(analysis));
    const bulletControls = buildBulletControlsFromBullets(selectedBullets);
    const resolvedQuery = String(
      analysis?.visual_form ||
      analysis?.stage2?.visual_summary ||
      buildFallbackQueryFromStructuredBullets(selectedBullets) ||
      "Image search"
    ).trim();
    const queryEmbedding = normalizeClientEmbedding(
      analysis?.query_embedding ||
      analysis?.visual_summary_embedding ||
      []
    );

    if (!queryEmbedding.length) {
      throw new Error("Image analysis completed, but no usable embedding was generated.");
    }

    state.focusArea = normalizeFocusArea(focusArea || defaultFocusArea());
    setSearchInputValue(resolvedQuery);
    updateImageAnalyzeProgress("match", {
      percent: 72,
      detail: "Ranking the closest catalog matches from the analyzed image.",
      targetPercent: 94
    });
    const payload = await refineSearchResults({
      queryEmbedding,
      selectedBullets,
      seatingType: analysis?.seating_type || analysis?.stage1?.seating_type || "seating",
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter,
      sourceImageUrl: analysis?.image_preview_url || state.cropPreviewUrl || "",
      rerankerEnabled: false
    });
    applyActiveSearchContext({
      payload,
      query: resolvedQuery,
      selectedBullets,
      bulletControls,
      baseQueryEmbedding: payload?.query_embedding || queryEmbedding,
      seatingType: analysis?.seating_type || analysis?.stage1?.seating_type || "",
      imageAnalysis: analysis,
      productRefinements: [],
      categoryFilter: payload?.category_filter ?? state.categoryFilter,
      refreshAgeFilter: payload?.refresh_age_filter ?? state.refreshAgeFilter,
      preserveOriginal: false,
      refinementActive: false
    });
    updateImageAnalyzeProgress("complete", {
      percent: 100,
      detail: "Results ready."
    });
    await wait(900);
    if (state.landingOnlyMode) {
      persistImageSearchHandoff({
        source: "homepage-image-search",
        query: resolvedQuery,
        payload,
        selectedBullets,
        bulletControls,
        baseQueryEmbedding: payload?.query_embedding || queryEmbedding,
        seatingType: analysis?.seating_type || analysis?.stage1?.seating_type || "",
        imageAnalysis: analysis,
        categoryFilter: payload?.category_filter ?? state.categoryFilter,
        refreshAgeFilter: payload?.refresh_age_filter ?? state.refreshAgeFilter
      });
      redirectToBrowseResults(resolvedQuery, {
        seating_type: analysis?.seating_type || analysis?.stage1?.seating_type || ""
      });
      return;
    }
    closeImageModal();
    renderResults(payload, resolvedQuery);
  } catch (error) {
    if (!analysis && String(error?.message || "").trim() === QUERY_IMAGE_ANALYSIS_RETRY_MESSAGE) {
      restoreImageAnalysisPreSubmitScreen(
        body.image_data_url || body.image_url || state.cropPreviewUrl || "",
        focusArea || state.focusArea || null
      );
      setStatus(QUERY_IMAGE_ANALYSIS_RETRY_MESSAGE, "error");
      return;
    }
    throw error;
  } finally {
    setImageAnalyzeLoading(false);
  }
}

async function analyzeSelectedImage() {
  const imageUrl = elements.imageUrlInput.value.trim();
  const file = state.selectedUploadFile;

  if (!file && !imageUrl) {
    setStatus("Choose an image file or paste an image URL first.", "error");
    return;
  }

  let body;
  let previewUrl;
  if (file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the selected image."));
      reader.readAsDataURL(file);
    });
    body = {
      file_name: file.name,
      image_data_url: dataUrl
    };
    previewUrl = dataUrl;
  } else {
    body = { image_url: imageUrl };
    previewUrl = imageUrl;
  }

  state.lastAnalyzeInput = body;
  showCropStage(previewUrl);
  setStatus("Adjust the focus area, then analyze the image.");
}

async function bootstrap() {
  try {
    state.manageMode = false;
    state.batchRefreshing = false;
    closeBatchRefreshStream();
    state.batchRefreshProgress = null;
    state.batchRefreshProgressVisible = false;
    closeSceneFilterProgressStream();
    state.sceneFilterProgress = null;
    state.selectedProductIds = new Set();
    state.sortMode = "auto";
    state.categoryFilter = [];
    state.resultCategoryScope = ["all"];
    state.categoryScopeMode = "all";
    state.refreshAgeFilter = "";
    state.originalCategoryFilter = [];
    state.originalResultCategoryScope = ["all"];
    state.originalCategoryScopeMode = "all";
    state.originalRefreshAgeFilter = "";
    state.categoryScopeLoading = false;
    syncManageToolbar();
    state.bootstrap = await fetchJson("/api/bootstrap");
    renderCategoryFilterOptions(state.bootstrap.categories || []);
    renderSearchComposer();
    if (elements.refreshAgeFilterSelect) {
      elements.refreshAgeFilterSelect.value = "";
    }
    if (elements.sortSelect) {
      elements.sortSelect.value = state.sortMode;
    }
    renderRankingRulesSummary(state.bootstrap.ranking_rules);
    renderSeedQueries(state.bootstrap.seed_queries);
    resetImageFlow();
    if (elements.uploadSupportNote) {
      elements.uploadSupportNote.textContent = state.bootstrap.image_analysis_available
        ? "Upload a photo or paste URL to find similar furniture."
        : "Image-led search requires OPENAI_API_KEY on the local server.";
    }
    if (elements.imageUploadButton) {
      elements.imageUploadButton.disabled = !state.bootstrap.image_analysis_available;
    }
    if (elements.analyzeImageButton) {
      elements.analyzeImageButton.disabled = !state.bootstrap.image_analysis_available;
    }
    setStatus(
      state.bootstrap.has_index
        ? `Catalog loaded: ${state.bootstrap.stats.products} products. Visual search index is available.`
        : `Catalog loaded: ${state.bootstrap.stats.products} products. Browse is ready; use Manage and Build Image Index to enable visual search.`
    );
    const launchParams = new URLSearchParams(window.location.search);
    const pendingImageSearchHandoff = consumeImageSearchHandoff();
    const initialQuery = String(launchParams.get("q") || "").trim();
    const initialCategoryFilter = normalizeCategoryFilter(launchParams.getAll("category"));
    const initialCategoryScope = normalizeCategoryScopeSelection(launchParams.get("seating_type"), { maxSelections: 1 });
    const initialPrimaryCategory = getPrimaryCategoryScopeSelection(initialCategoryScope) || "all";
    const initialRefreshAgeFilter = String(launchParams.get("refresh_age") || "").trim();
    state.resultCategoryScope = initialCategoryScope.length ? initialCategoryScope : ["all"];
    state.categoryScopeMode = getPrimaryCategoryScopeSelection(state.resultCategoryScope) !== "all" ? "explicit" : "all";
    if (initialQuery && initialPrimaryCategory !== "all") {
      state.lastQuery = initialQuery;
    }
    const shouldHoldInitialShell = Boolean(initialQuery);
    setInitialSearchPending(shouldHoldInitialShell);
    if (shouldHoldInitialShell) {
      setResultsLoading("Embedding the visual query and ranking image captions...");
    }
    renderSearchComposer();
    const shouldOpenImageModal = launchParams.get("open_image") === "1";
    try {
      const reindexStatus = await fetchJson("/api/reindex-status");
      let dismissedToken = "";
      try {
        dismissedToken = window.localStorage.getItem(BATCH_PROGRESS_DISMISS_KEY) || "";
      } catch {}
      const currentToken = JSON.stringify({
        started_at: String(reindexStatus?.started_at || "").trim(),
        completed: Number(reindexStatus?.completed || 0),
        total: Number(reindexStatus?.total || 0),
        done: Boolean(reindexStatus?.done)
      });
      const isDismissedCompletedRun = Boolean(
        dismissedToken &&
        dismissedToken === currentToken &&
        reindexStatus?.done
      );
      const shouldRestoreBatchProgress = Boolean(
        reindexStatus?.running ||
        (
          !isDismissedCompletedRun &&
          (
            reindexStatus?.done ||
            Number(reindexStatus?.completed || 0) > 0 ||
            Number(reindexStatus?.total || 0) > 0
          )
        )
      );
      if (shouldRestoreBatchProgress) {
        updateBatchRefreshProgress(reindexStatus);
        state.batchRefreshing = Boolean(reindexStatus?.running);
        if (reindexStatus?.running && !reindexStatus?.done) {
          openBatchRefreshStream();
        }
      }
    } catch {}
    if (state.landingOnlyMode) {
      setInitialSearchPending(false);
      return;
    }
    if (shouldOpenImageModal) {
      openImageModal();
    }
    if (
      pendingImageSearchHandoff &&
      String(pendingImageSearchHandoff.query || "").trim() === initialQuery
    ) {
      setInitialSearchPending(false);
      applyActiveSearchContext({
        payload: pendingImageSearchHandoff.payload,
        query: pendingImageSearchHandoff.query,
        selectedBullets: pendingImageSearchHandoff.selectedBullets,
        bulletControls: pendingImageSearchHandoff.bulletControls,
        baseQueryEmbedding: pendingImageSearchHandoff.baseQueryEmbedding,
        seatingType: pendingImageSearchHandoff.seatingType,
        imageAnalysis: pendingImageSearchHandoff.imageAnalysis,
        productRefinements: [],
        categoryFilter: pendingImageSearchHandoff.categoryFilter,
        refreshAgeFilter: pendingImageSearchHandoff.refreshAgeFilter,
        preserveOriginal: false,
        refinementActive: false
      });
      setSearchInputValue(pendingImageSearchHandoff.query);
      renderResults(pendingImageSearchHandoff.payload, pendingImageSearchHandoff.query);
      return;
    }
    if (initialQuery) {
      if (initialPrimaryCategory !== "all") {
        renderSearchComposer(initialQuery);
      } else {
        setSearchInputValue(initialQuery);
      }
      await runSearch(initialQuery, {
        categoryFilter: initialCategoryFilter,
        refreshAgeFilter: initialRefreshAgeFilter,
        seatingType: initialPrimaryCategory || "all",
        categoryScopeMode: initialPrimaryCategory && initialPrimaryCategory !== "all"
          ? "explicit"
          : "all"
      });
      return;
    }
    setInitialSearchPending(false);
    await runSearch("", {
      categoryFilter: initialCategoryFilter,
      refreshAgeFilter: initialRefreshAgeFilter
    });
  } catch (error) {
    reportClientError(error, "Bootstrap failed");
  }
}

window.addEventListener("error", (event) => {
  reportClientError(event.error || event.message, "Window error");
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientError(event.reason, "Unhandled promise rejection");
});

elements.closeDebugLightbox?.addEventListener("click", () => {
  closeDebugLightbox();
});

elements.debugLightboxCloseTargets?.forEach((target) => {
  target.addEventListener("click", () => {
    closeDebugLightbox();
  });
});

elements.copyDebugTableTsv?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildDebugTableTsv());
    elements.copyDebugTableStatus.textContent = "Copied";
    window.clearTimeout(state.copyDebugTableTimer);
    state.copyDebugTableTimer = window.setTimeout(() => {
      elements.copyDebugTableStatus.textContent = "";
    }, 1500);
  } catch (error) {
    elements.copyDebugTableStatus.textContent = "Copy failed";
    window.clearTimeout(state.copyDebugTableTimer);
    state.copyDebugTableTimer = window.setTimeout(() => {
      elements.copyDebugTableStatus.textContent = "";
    }, 1500);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.debugLightbox && !elements.debugLightbox.hidden) {
    closeDebugLightbox();
  }
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const selectedCategory = elements.searchCategorySelect?.value || "all";
  const requestQuery = getSearchComposerRequestQuery();
  if (state.landingOnlyMode) {
    enterBrowseMode(requestQuery, {
      seating_type: selectedCategory
    });
  }
  runSearch(requestQuery, {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    seatingType: selectedCategory,
    categoryScopeMode: selectedCategory === "all" ? "all" : "explicit"
  });
});

elements.searchInput?.addEventListener("input", () => {
  autoResizeSearchInput();
});

elements.searchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.searchForm?.requestSubmit();
  }
});

elements.sortSelect?.addEventListener("change", () => {
  state.sortMode = elements.sortSelect.value || "auto";
  runSearch(getSearchComposerRequestQuery(state.lastQuery), {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    seatingType: getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all",
    categoryScopeMode: state.categoryScopeMode,
    sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: state.currentImageAnalysis,
    selectedBullets: state.currentSelectedBullets,
    bulletControls: state.currentBulletControls
  });
});

elements.categoryFilterOptions?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
    return;
  }
  state.categoryFilter = normalizeCategoryFilter(
    [...elements.categoryFilterOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value)
  );
  if (elements.categoryFilterButton) {
    elements.categoryFilterButton.textContent = formatCategoryFilterLabel(state.categoryFilter);
  }
  runSearch(getSearchComposerRequestQuery(state.lastQuery), {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    seatingType: getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all",
    categoryScopeMode: state.categoryScopeMode,
    sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: state.currentImageAnalysis,
    selectedBullets: state.currentSelectedBullets,
    bulletControls: state.currentBulletControls
  });
});

elements.searchCategorySelect?.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  const previousCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  const composerParts = getSearchComposerTextParts();
  const previousMatch = state.searchComposerMatch || splitQueryAroundCategoryScope(state.lastQuery, previousCategory).match;
  const nextCategory = normalizeCategoryScopeSelection(target.value, { maxSelections: 1 });
  const nextPrimaryCategory = getPrimaryCategoryScopeSelection(nextCategory);
  const nextQuery = nextPrimaryCategory && nextPrimaryCategory !== "all"
    ? previousCategory && previousCategory !== "all"
      ? buildInlineCategoryScopedQuery(
          nextPrimaryCategory,
          composerParts.prefix,
          previousMatch,
          composerParts.suffix
        )
      : stripVagueSeatingReferenceFromQuery(composerParts.plain || state.lastQuery || "", nextPrimaryCategory)
    : composerParts.plain || state.lastQuery || "";
  state.resultCategoryScope = nextCategory;
  state.categoryScopeMode = nextPrimaryCategory === "all" ? "all" : "explicit";
  state.categoryScopeLoading = true;
  renderSearchComposer(nextQuery);

  const payload = await runSearch(nextQuery, {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    seatingType: nextPrimaryCategory || "all",
    categoryScopeMode: state.categoryScopeMode,
    sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: state.currentImageAnalysis,
    selectedBullets: state.currentSelectedBullets,
    bulletControls: state.currentBulletControls,
    preserveOriginal: state.refinementActive,
    refinementActive: state.refinementActive,
    productRefinements: state.currentProductRefinements
  });

  state.categoryScopeLoading = false;
  renderSearchComposer(state.lastQuery);
  if (payload && previousCategory !== nextPrimaryCategory) {
    logEvent("category_scope_changed", {
      from: previousCategory && previousCategory !== "all" ? previousCategory : null,
      to: nextPrimaryCategory && nextPrimaryCategory !== "all" ? nextPrimaryCategory : null,
      resultCount: Number(payload.total_results || payload.results?.length || 0)
    });
  }
});

elements.refreshAgeFilterSelect?.addEventListener("change", () => {
  state.refreshAgeFilter = elements.refreshAgeFilterSelect.value || "";
  runSearch(getSearchComposerRequestQuery(state.lastQuery), {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    seatingType: getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all",
    categoryScopeMode: state.categoryScopeMode,
    sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: state.currentImageAnalysis,
    selectedBullets: state.currentSelectedBullets,
    bulletControls: state.currentBulletControls
  });
});

elements.refineToggleButton?.addEventListener("click", () => {
  if (state.refineDrawerOpen) {
    closeRefineDrawer();
  } else {
    openRefineDrawer();
  }
});

elements.closeRefineSidebar?.addEventListener("click", () => {
  closeRefineDrawer();
});

elements.refineDrawerBackdrop?.addEventListener("click", () => {
  closeRefineDrawer();
});

elements.resetSearchButton?.addEventListener("click", () => {
  if (!state.originalPayload) {
    return;
  }

  state.currentBaseQueryEmbedding = [...state.originalBaseQueryEmbedding];
  state.currentQueryEmbedding = [...state.originalQueryEmbedding];
  state.currentSelectedBullets = normalizeSelectedBullets(state.originalSelectedBullets);
  state.currentBulletControls = normalizeBulletControls(state.originalBulletControls);
  state.currentSeatingType = state.originalSeatingType;
  state.currentImageAnalysis = state.originalImageAnalysis ? cloneValue(state.originalImageAnalysis) : null;
  state.currentProductRefinements = normalizeProductRefinements(state.originalProductRefinements);
  state.categoryFilter = normalizeCategoryFilter(state.originalCategoryFilter);
  state.resultCategoryScope = normalizeCategoryScopeSelection(state.originalResultCategoryScope, { maxSelections: 1 });
  state.categoryScopeMode = state.originalCategoryScopeMode || "all";
  state.refreshAgeFilter = state.originalRefreshAgeFilter;
  state.refinementActive = false;
  state.categoryScopeLoading = false;
  if (elements.categoryFilterButton) {
    elements.categoryFilterButton.textContent = formatCategoryFilterLabel(state.categoryFilter);
  }
  if (elements.categoryFilterOptions) {
    elements.categoryFilterOptions.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = state.categoryFilter.includes(input.value);
    });
  }
  if (elements.refreshAgeFilterSelect) {
    elements.refreshAgeFilterSelect.value = state.refreshAgeFilter;
  }
  renderSearchComposer(state.originalQuery);
  closeRefineDrawer();
  updateResetSearchVisibility();
  renderResults(cloneValue(state.originalPayload), state.originalQuery);
});

elements.manageSelectionButton?.addEventListener("click", () => {
  if (state.manageMode || state.batchRefreshProgressVisible) {
    exitManageMode();
    return;
  }
  enterManageMode();
});

elements.doneManagingButton?.addEventListener("click", () => {
  exitManageMode();
});

elements.batchRefreshCloseButton?.addEventListener("click", () => {
  dismissBatchRefreshProgress();
});

elements.selectAllButton?.addEventListener("click", () => {
  selectAllVisibleResults();
});

elements.selectNoneButton?.addEventListener("click", () => {
  clearSelectedResults();
});

elements.batchRefreshButton?.addEventListener("click", async () => {
  if (!state.bootstrap?.has_index) {
    const productIds = [...state.selectedProductIds];
    if (!productIds.length || state.batchRefreshing) {
      return;
    }

    state.batchRefreshing = true;
    state.batchRefreshProgressVisible = true;
    updateBatchRefreshProgress({
      total: productIds.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      left: productIds.length,
      current_batch: productIds.length ? 1 : 0,
      total_batches: Math.ceil(productIds.length / 5),
      current_product_name: "",
      current_product_images_passed: 0,
      current_run: "",
      total_cost_usd: 0,
      log: []
    });
    renderResults(state.lastPayload, state.lastQuery);
    setStatus(`Building AI index for ${productIds.length} selected product${productIds.length === 1 ? "" : "s"}...`, "info");

    try {
      await refreshProductsBatch(productIds);
      await pollBatchRefreshStatus();
      openBatchRefreshStream();
    } catch (error) {
      closeBatchRefreshStream();
      state.batchRefreshing = false;
      state.batchRefreshProgress = null;
      state.batchRefreshProgressVisible = false;
      renderResults(state.lastPayload, state.lastQuery);
      setStatus(error.message || "AI index build failed.", "error");
    }
    return;
  }
  const productIds = [...state.selectedProductIds];
  if (!productIds.length || state.batchRefreshing) {
    return;
  }

  state.batchRefreshing = true;
  state.batchRefreshProgressVisible = true;
    updateBatchRefreshProgress({
      total: productIds.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      left: productIds.length,
      current_batch: productIds.length ? 1 : 0,
      total_batches: Math.ceil(productIds.length / 5),
      current_product_name: "",
      current_product_images_passed: 0,
      current_run: "",
      total_cost_usd: 0,
      log: []
    });
  renderResults(state.lastPayload, state.lastQuery);
  setStatus(`Refreshing extraction for ${productIds.length} selected product${productIds.length === 1 ? "" : "s"}...`);

  try {
    await refreshProductsBatch(productIds);
    await pollBatchRefreshStatus();
    openBatchRefreshStream();
  } catch (error) {
    closeBatchRefreshStream();
    state.batchRefreshing = false;
    state.batchRefreshProgress = null;
    state.batchRefreshProgressVisible = false;
    renderResults(state.lastPayload, state.lastQuery);
    setStatus(error.message || "Batch extraction refresh failed.", "error");
  }
});

elements.debugToggle.addEventListener("click", async () => {
  try {
    await renderDebugLightbox();
  } catch (error) {
    setStatus(error.message || "Failed to load debug table.", "error");
  }
});

elements.openImageSearch.addEventListener("click", () => {
  openImageModal();
});
elements.closeImageModal.addEventListener("click", closeImageModal);
elements.openRulesSummary.addEventListener("click", openRulesModal);
elements.openExtractionSummary?.addEventListener("click", async () => {
  try {
    await openExtractionSummaryModal();
  } catch (error) {
    closeExtractionSummaryModal();
    setStatus(error.message || "Failed to load extraction summary.", "error");
  }
});
elements.copyStructuredTraits?.addEventListener("click", () => {
  try {
    openStructuredTraitsModal();
  } catch (error) {
    setStatus(error.message, "error");
  }
});
elements.closeRulesModal.addEventListener("click", closeRulesModal);
elements.closeExtractionSummaryModal?.addEventListener("click", closeExtractionSummaryModal);
elements.closeStructuredTraitsModal?.addEventListener("click", closeStructuredTraitsModal);
elements.copyStructuredTraitsModalButton?.addEventListener("click", async () => {
  try {
    await copyStructuredTraitsSummary();
  } catch (error) {
    setStatus(error.message, "error");
  }
});
elements.imageModalCloseTargets.forEach((target) => target.addEventListener("click", closeImageModal));
elements.rulesModalCloseTargets.forEach((target) => target.addEventListener("click", closeRulesModal));
elements.extractionSummaryModalCloseTargets.forEach((target) => target.addEventListener("click", closeExtractionSummaryModal));
elements.structuredTraitsModalCloseTargets.forEach((target) => target.addEventListener("click", closeStructuredTraitsModal));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.imageModal.hidden) {
    closeImageModal();
    return;
  }
  if (event.key === "Escape" && !elements.extractionSummaryModal.hidden) {
    closeExtractionSummaryModal();
    return;
  }
  if (event.key === "Escape" && !elements.structuredTraitsModal.hidden) {
    closeStructuredTraitsModal();
    return;
  }
  if (event.key === "Escape" && !elements.rulesModal.hidden) {
    closeRulesModal();
  }
});

elements.imageUploadButton.addEventListener("click", () => {
  elements.imageUploadInput.click();
});

elements.imageUploadInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  state.selectedUploadFile = file || null;
  elements.selectedFileName.textContent = file ? file.name : "";
  elements.selectedFileName.hidden = !file;
  if (file) {
    elements.imageUrlInput.value = "";
  }
});

elements.imageUrlInput.addEventListener("input", () => {
  if (elements.imageUrlInput.value.trim()) {
    state.selectedUploadFile = null;
    elements.imageUploadInput.value = "";
    elements.selectedFileName.textContent = "";
    elements.selectedFileName.hidden = true;
  }
});

elements.inspirationPreview.addEventListener("load", () => {
  if (state.cropModeActive && state.focusArea) {
    renderFocusArea();
  } else {
    elements.focusBox.hidden = true;
    syncFocusStageControls();
  }
});

elements.focusBox.addEventListener("mousedown", beginFocusDrag);
elements.focusHandles.forEach((handle) => {
  handle.addEventListener("mousedown", (event) => {
    beginFocusResize(event, handle.dataset.handle || "");
  });
});
document.addEventListener("mousemove", updateFocusDrag);
document.addEventListener("mouseup", stopFocusDrag);
elements.previewCanvas.addEventListener("click", (event) => {
  if (event.target === elements.focusBox || event.target.closest('[data-role="focusHandle"]')) {
    return;
  }
  if (!state.cropModeActive) {
    state.cropModeActive = true;
    setFocusArea(createFocusAreaAroundPoint(event.clientX, event.clientY));
    setStatus("Crop enabled. Drag or resize the box, or continue with the full image.", "info");
  }
});
elements.focusBox.addEventListener("mouseup", () => {
  const resized = captureFocusAreaFromDom();
  if (resized) {
    setFocusArea(resized);
  }
});

elements.analyzeImageButton.addEventListener("click", async () => {
  try {
    await analyzeSelectedImage();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.skipFocusButton.addEventListener("click", async () => {
  try {
    state.cropModeActive = false;
    state.focusArea = null;
    renderFocusArea();
    setFocusArea(defaultFocusArea());
    await runImageAnalysisSearch();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.applyFocusButton.addEventListener("click", async () => {
  try {
    const focusArea = captureFocusAreaFromDom() || state.focusArea || defaultFocusArea();
    setFocusArea(focusArea);
    await runImageAnalysisSearch({ focusArea });
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.reopenFocusOverlay?.addEventListener("click", () => {
  if (!state.lastAnalyzeInput) {
    setStatus("Analyze an image first.", "error");
    return;
  }
  openImageModal();
  showCropStage(state.currentImageAnalysis?.image_preview_url || state.cropPreviewUrl || "");
  if (state.focusArea) {
    state.cropModeActive = true;
    setFocusArea(state.focusArea);
  }
});

elements.refineSelectedImageWrap?.addEventListener("click", () => {
  if (!state.lastAnalyzeInput) {
    return;
  }
  openImageModal();
  showCropStage(state.currentImageAnalysis?.image_preview_url || state.cropPreviewUrl || "");
  if (state.focusArea) {
    state.cropModeActive = true;
    setFocusArea(state.focusArea);
  }
});

elements.applyRefineBulletsButton?.addEventListener("click", async () => {
  try {
    await applyPendingBulletPriorities();
  } catch (error) {
    setStatus(error.message || "Failed to apply bullet priorities.", "error");
  }
});

autoResizeSearchInput();

bootstrap().catch((error) => {
  reportClientError(error, "Bootstrap failed");
});
