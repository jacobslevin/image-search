import { RESULT_CUTOFF_DEFAULTS, findCutoff } from "./result-cutoff.js";
import {
  buildResultsPageSearch,
  detectCategoryScopeFromQuery,
  getPrimaryCategoryScopeSelection,
  normalizeCategoryScopeSelection,
  normalizeVisualTypeKey,
  splitQueryAroundCategoryScope,
  stripCategoryScopeFromQuery,
  stripCategoryScopeFromSelectedBullets
} from "./category-scope.js";
import {
  buildRoutingTypesConfig,
  formatVisualTypeLabel,
  getVisualTypeDisplayNameMap,
  getVisualTypeOptions,
  groupVisualTypeOptionsByFamily,
  isSupportedBrowseVisualType,
  resolveClarificationFamilySelection,
  resolveStoredVisualType
} from "./visual-type-ui.js";
import { resolveSearchVisualTypeRequest } from "./search-request-routing.js";
import { hasSearchComposerClearableContent } from "./search-composer-ui.js";
import { isInlineRefinementDetectabilityEligible } from "./inline-refinement-ui.js";
import { shouldShowResetSearchButton } from "./search-results-ui.js";

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
  imageAnalysisCategorySelection: null,
  cropPreviewUrl: "",
  focusArea: null,
  copyStructuredTraitsTimer: null,
  structuredTraitsInspectorTab: "matrix",
  structuredTraitsInspectorSeverity: "all",
  promptLibrary: null,
  promptLibraryActiveId: "stage1",
  promptLibraryViewMode: "raw",
  copyPromptLibraryTimer: null,
  copyDebugTableTimer: null,
  extractionSummary: null,
  extractionSummaryExpandedRows: new Set(),
  extractionSummaryFullRows: new Set(),
  searchInputEditedSinceLastSearch: false,
  categorySelectionTouchedSinceLastSearch: false,
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
  currentVisualType: "",
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
  originalVisualType: "",
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
  traitFilters: {},
  imageAnalyzeProgress: null,
  imageAnalyzeProgressTimer: null,
  imageAnalyzeProgressPollTimer: null,
  imageAnalyzeProgressRequestId: "",
  imageAnalyzeProgressSequence: 0,
  resultsLoadingMode: "text",
  cachedSearchProgressActive: false,
  cachedSearchProgressPercent: 0,
  cachedSearchProgressInterval: null,
  cachedSearchProgressFadeTimer: null,
  cachedSearchProgressAnimationFrame: null,
  imageAnalyzePrepareStartedAt: 0,
  imageAnalyzeClassifyStartedAt: 0,
  imageAnalyzePrepareTransitionTimer: null,
  imageAnalyzeClassifyTransitionTimer: null,
  resultCutoffMeta: null,
  resultCutoffKey: "",
  weakerMatchesExpanded: false,
  weakerResultInteractionKeys: new Set(),
  landingOnlyMode: false,
  storedImageContextCache: new Map()
};

function getBootstrapRoutingTypes(bootstrap = state.bootstrap) {
  return buildRoutingTypesConfig(bootstrap);
}

function renderAppVersion(version = "") {
  if (!elements.appVersionIndicator) {
    return;
  }
  const normalizedVersion = String(version || "").trim();
  elements.appVersionIndicator.textContent = normalizedVersion ? `v${normalizedVersion}` : "";
  elements.appVersionIndicator.hidden = !normalizedVersion;
}

function syncHomePathUi() {
  if (elements.siteNavBrandLink) {
    elements.siteNavBrandLink.setAttribute("href", HOME_PATH);
  }
}

function getBootstrapRoutingTypeOptions(bootstrap = state.bootstrap) {
  return getVisualTypeOptions(bootstrap);
}

function syncVisualTypeSelectOptions(select, allLabel = "All categories", bootstrap = state.bootstrap) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  const previousValue = String(select.value || "").trim() || "all";
  const options = getBootstrapRoutingTypeOptions(bootstrap);
  select.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatVisualTypeLabel(value, bootstrap);
    select.appendChild(option);
  });

  select.value = Array.from(select.options).some((option) => option.value === previousValue)
    ? previousValue
    : "all";
}

function getPayloadVisualType(payload = {}) {
  return String(
    payload?.visual_type ||
    payload?.seating_type ||
    payload?.stage1?.visual_type ||
    payload?.stage1?.seating_type ||
    ""
  ).trim();
}

const CATEGORY_REQUIREMENT_OPTION_KEYS = Object.keys(getVisualTypeDisplayNameMap())
  .sort((left, right) => {
    const leftLabel = formatVisualTypeLabel(left);
    const rightLabel = formatVisualTypeLabel(right);
    return leftLabel.localeCompare(rightLabel);
  });

const BATCH_PROGRESS_DISMISS_KEY = "image-search.batch-progress-dismissed";
const IMAGE_SEARCH_HANDOFF_KEY = "image-search.pending-image-handoff";
const PROMPT_LIBRARY_VIEW_MODE_STORAGE_KEY = "image-search.prompt-library-view-mode";
const PRIVATE_BROWSE_PATH = "/velvet-lobster-orbit-773-nebula";
const CURRENT_URL = new URL(window.location.href);
const IS_PRIVATE_BROWSE_ROUTE = CURRENT_URL.pathname === PRIVATE_BROWSE_PATH || CURRENT_URL.pathname.startsWith(`${PRIVATE_BROWSE_PATH}/`);
const HOME_PATH = typeof window.__PIXELSEEK_HOME_PATH__ === "string" && window.__PIXELSEEK_HOME_PATH__
  ? window.__PIXELSEEK_HOME_PATH__
  : (IS_PRIVATE_BROWSE_ROUTE ? PRIVATE_BROWSE_PATH : "/");
const HAS_ACTIVE_LAUNCH_CONTEXT = Boolean(
  String(CURRENT_URL.searchParams.get("q") || "").trim() ||
  CURRENT_URL.searchParams.get("open_image") === "1"
);
const LANDING_ONLY_MODE = !IS_PRIVATE_BROWSE_ROUTE && !HAS_ACTIVE_LAUNCH_CONTEXT;
state.landingOnlyMode = LANDING_ONLY_MODE;
try {
  const storedPromptLibraryViewMode = window.sessionStorage.getItem(PROMPT_LIBRARY_VIEW_MODE_STORAGE_KEY);
  if (storedPromptLibraryViewMode === "formatted" || storedPromptLibraryViewMode === "raw") {
    state.promptLibraryViewMode = storedPromptLibraryViewMode;
  }
} catch {}
const IMAGE_ANALYZE_PROGRESS_STEPS = [
  { id: "prepare", label: "Prepare", percent: 15, title: "Preparing image...", detail: "Getting the selected image ready for analysis." },
  { id: "classify", label: "Classify", percent: 30, title: "Classifying image...", detail: "Classifying the selected item" },
  { id: "extract", label: "Extract", percent: 85, title: "Extracting visual traits...", detail: "Extracting visual traits..." },
  { id: "match", label: "Match", percent: 90, title: "Matching catalog products...", detail: "Matching against catalog" },
  { id: "complete", label: "Complete", percent: 100, title: "Results ready", detail: "Opening the ranked results." }
];
const TEXT_SEARCH_PROGRESS_STEPS = [
  { id: "parse", label: "Parse", percent: 50, percentLabel: "0–50%", title: "Understanding your query...", detail: "Figuring out what you're looking for." },
  { id: "embed", label: "Embed", percent: 58, percentLabel: "50–58%", title: "Finding similar items...", detail: "Mapping your query to our catalog." },
  { id: "search", label: "Search", percent: 66, percentLabel: "58–66%", title: "Scanning the catalog...", detail: "Pulling the closest matches." },
  { id: "rank", label: "Rank", percent: 95, percentLabel: "66–100%", title: "Ranking the best matches...", detail: "Sorting by what fits your query best." },
  { id: "complete", label: "Complete", percent: 100, percentLabel: "100%", title: "Results ready", detail: "Opening the ranked results." }
];
const QUERY_IMAGE_ANALYSIS_RETRY_MESSAGE = "Our fault, but we encountered an unexpected issue. Please resubmit your image.";
const QUERY_IMAGE_UPLOAD_MAX_DIMENSION = 1600;
const QUERY_IMAGE_UPLOAD_JPEG_QUALITY = 0.82;
const IMAGE_ANALYZE_MIN_PHASE_MS = 600;
const STRUCTURED_TRAITS_TAB_DEFS = [
  { id: "matrix", label: "Trait & Value Matrix" },
  { id: "scoring", label: "Per-Category Scoring" },
  { id: "groupings", label: "Value Groupings" }
];
const STRUCTURED_TRAITS_SEVERITY_ORDER = ["phrasing", "absent", "clean"];
const STRUCTURED_TRAITS_SEVERITY_META = {
  critical: { label: "Critical", className: "structured-traits-badge-critical" },
  missing: { label: "Missing values", className: "structured-traits-badge-missing" },
  extra: { label: "Extra values", className: "structured-traits-badge-extra" },
  phrasing: { label: "Phrasing drift", className: "structured-traits-badge-phrasing" },
  absent: { label: "Absent", className: "structured-traits-badge-absent" },
  clean: { label: "Match", className: "structured-traits-badge-clean" }
};
const STRUCTURED_TRAITS_PHRASING_QUALIFIERS = new Set([
  "natural",
  "polished",
  "aluminum",
  "painted",
  "color",
  "powder",
  "coat",
  "net"
]);
const STRUCTURED_TRAITS_IGNORED_COMPARE_VALUES = new Set(["unknown"]);
const STRUCTURED_TRAITS_MATRIX_TYPE_ORDER = [
  "lounge_chair",
  "guest_chair",
  "stool",
  "task_collab_chair",
  "bench"
];
const STRUCTURED_TRAITS_PRIORITY_FIELD_ORDER = [
  "arm_option",
  "seat_construction",
  "arms_flush_with_back",
  "narrow_arms",
  "back_height",
  "back_finish",
  "back_profile",
  "base_type",
  "base_finish",
  "configuration",
  "seat_finish",
  "design_register",
  "body_construction",
  "plan_shape",
  "shape_character",
  "seat_geometry",
  "frame_openness",
  "mobility",
  "frame_material"
];

const HOMEPAGE_IMAGE_EXAMPLES = [
  {
    productId: "dp:14051265",
    imageId: "dp:14051265:img:8fc1b70ea5b765f6",
    imageUrl: "https://content.designerpages.com/assets/82384758/BobLounge140000338thumbnailS.jpg",
    title: "Bob Lounge Seating",
    brand: "Coalesse"
  },
  {
    productId: "dp:13945982",
    imageId: "dp:13945982:img:9f73f9d399d37a38",
    imageUrl: "https://content.designerpages.com/assets/81879132/BelmontImageGallery191.jpg",
    title: "Belmont",
    brand: "Bernhardt Design"
  }
];

const focusDrag = {
  active: false,
  mode: "move",
  handle: "",
  startX: 0,
  startY: 0,
  startArea: null
};

const elements = {
  appVersionIndicator: document.querySelector("#appVersionIndicator"),
  siteNavBrandLink: document.querySelector("#siteNavBrandLink"),
  cardTemplate: document.querySelector("#cardTemplate"),
  closeImageModal: document.querySelector("#closeImageModal"),
  closeStructuredTraitsModal: document.querySelector("#closeStructuredTraitsModal"),
  closePromptLibraryModal: document.querySelector("#closePromptLibraryModal"),
  contextPills: document.querySelector("#contextPills"),
  closeRefineSidebar: document.querySelector("#closeRefineSidebar"),
  debugToggle: document.querySelector("#debugToggle"),
  debugToggleLabel: document.querySelector("#debugToggleLabel"),
  imageModal: document.querySelector("#imageModal"),
  structuredTraitsModal: document.querySelector("#structuredTraitsModal"),
  promptLibraryModal: document.querySelector("#promptLibraryModal"),
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
  structuredTraitsModalCloseTargets: document.querySelectorAll('[data-role="structuredTraitsModalClose"]'),
  promptLibraryModalCloseTargets: document.querySelectorAll('[data-role="promptLibraryModalClose"]'),
  openImageSearch: document.querySelector("#openImageSearch"),
  openImageSearchInline: document.querySelector("#openImageSearchInline"),
  openPromptLibrary: document.querySelector("#openPromptLibrary"),
  openExtractionSummary: document.querySelector("#openExtractionSummary"),
  copyStructuredTraits: document.querySelector("#copyStructuredTraits"),
  copyStructuredTraitsModalButton: document.querySelector("#copyStructuredTraitsModalButton"),
  copyStructuredTraitsStatus: document.querySelector("#copyStructuredTraitsStatus"),
  copyPromptLibraryModalButton: document.querySelector("#copyPromptLibraryModalButton"),
  copyPromptLibraryStatus: document.querySelector("#copyPromptLibraryStatus"),
  structuredTraitsText: document.querySelector("#structuredTraitsText"),
  promptLibraryContent: document.querySelector("#promptLibraryContent"),
  descriptionAuditModal: document.querySelector("#descriptionAuditModal"),
  descriptionAuditModalTitle: document.querySelector("#descriptionAuditModalTitle"),
  descriptionAuditModalBody: document.querySelector("#descriptionAuditModalBody"),
  closeDescriptionAuditModal: document.querySelector("#closeDescriptionAuditModal"),
  descriptionAuditModalCloseTargets: document.querySelectorAll('[data-role="descriptionAuditModalClose"]'),
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
  cachedSearchProgressStrip: document.querySelector("#cachedSearchProgressStrip"),
  resultsLoadingPanel: document.querySelector("#resultsLoadingPanel"),
  resultsLoadingTitle: document.querySelector("#resultsLoadingTitle"),
  resultsLoadingPercent: document.querySelector("#resultsLoadingPercent"),
  resultsLoadingBar: document.querySelector("#resultsLoadingBar"),
  resultsLoadingSteps: document.querySelector("#resultsLoadingSteps"),
  resultsLoadingCopy: document.querySelector(".results-loading-copy"),
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
  refineBulletSection: document.querySelector("#refineBulletSection"),
  refineBulletsList: document.querySelector("#refineBulletsList"),
  refineSelectedImageWrap: document.querySelector("#refineSelectedImageWrap"),
  refineSelectedImage: document.querySelector("#refineSelectedImage"),
  applyRefineBulletsButton: document.querySelector("#applyRefineBulletsButton"),
  refineDrawerBackdrop: document.querySelector("#refineDrawerBackdrop"),
  reopenFocusOverlay: document.querySelector("#reopenFocusOverlay"),
  refineToggleButton: document.querySelector("#refineToggleButton"),
  resultsSidebarEyebrow: document.querySelector("#resultsSidebarEyebrow"),
  resultsSidebarTitle: document.querySelector("#resultsSidebarTitle"),
  resultsLayout: document.querySelector(".results-layout"),
  resultsSidebar: document.querySelector("#resultsSidebar"),
  resultCount: document.querySelector("#resultCount"),
  imageSearchDropZone: document.querySelector("#imageSearchDropZone"),
  searchForm: document.querySelector("#searchForm"),
  clearSearchInputButton: document.querySelector("#clearSearchInputButton"),
  searchCategoryPrefix: document.querySelector("#searchCategoryPrefix"),
  searchCategoryChipWrap: document.querySelector("#searchCategoryChipWrap"),
  searchCategorySelect: document.querySelector("#searchCategorySelect"),
  searchCategorySuffix: document.querySelector("#searchCategorySuffix"),
  searchInput: document.querySelector("#searchInput"),
  browseCategoryScopeBar: document.querySelector("#browseCategoryScopeBar"),
  browseCategorySelect: document.querySelector("#browseCategorySelect"),
  browseTraitFilterPanel: document.querySelector("#browseTraitFilterPanel"),
  browseTraitFilterCount: document.querySelector("#browseTraitFilterCount"),
  browseTraitFilterFields: document.querySelector("#browseTraitFilterFields"),
  resetBrowseTraitFilters: document.querySelector("#resetBrowseTraitFilters"),
  seedImageExamples: document.querySelector("#seedImageExamples"),
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
  const targetPath = HOME_PATH;
  const nextUrl = buildBrowseUrl(query, extraParams, targetPath);
  window.history.pushState({}, "", nextUrl);
}

function returnToHomepageState() {
  window.location.href = HOME_PATH;
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
  const targetPath = HOME_PATH;
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
  const percent = clamp(Number(nextProgress.percent ?? step.percent) || 0, 0, 100);
  const previous = state.imageAnalyzeProgress || {};
  state.imageAnalyzeProgress = {
    step: step.id,
    percent,
    percentLabel: String(nextProgress.percentLabel || `${Math.round(percent)}%`).trim(),
    indeterminate: Boolean(nextProgress.indeterminate),
    extractTarget: Number(nextProgress.extractTarget ?? previous.extractTarget ?? 30),
    title: String(nextProgress.title || step.title || "").trim(),
    detail: String(nextProgress.detail || step.detail || "").trim()
  };
}

function renderImageAnalyzeProgress() {
  const progress = state.imageAnalyzeProgress || {
    step: "prepare",
    percent: 0,
    percentLabel: "0%",
    indeterminate: false,
    title: "Preparing image...",
    detail: "Getting the selected image ready for analysis."
  };
  document.querySelectorAll(".image-analyze-loading-card").forEach((card) => {
    const title = card.querySelector('[data-role="imageAnalyzeTitle"]');
    const detail = card.querySelector('[data-role="imageAnalyzeDetail"]');
    const percent = card.querySelector('[data-role="imageAnalyzePercent"]');
    const bar = card.querySelector('[data-role="imageAnalyzeBar"]');
    const steps = [...card.querySelectorAll(".image-analyze-segment")];
    if (title) title.textContent = progress.title;
    if (detail) detail.textContent = progress.detail;
    if (percent) percent.textContent = progress.percentLabel || `${progress.percent}%`;
    if (bar) {
      bar.style.width = `${clamp(Number(progress.percent || 0), 0, 100)}%`;
      bar.classList.toggle("is-indeterminate", Boolean(progress.indeterminate));
    }
    const activeIndex = IMAGE_ANALYZE_PROGRESS_STEPS.findIndex((step) => step.id === progress.step);
    steps.forEach((item, index) => {
      const isComplete = progress.percent >= 100 || index < activeIndex;
      item.classList.toggle("is-active", index === activeIndex && progress.percent < 100);
      item.classList.toggle("is-complete", isComplete);
    });
  });
}

function getTextSearchStepConfig(stepId = "parse") {
  return TEXT_SEARCH_PROGRESS_STEPS.find((step) => step.id === stepId) || TEXT_SEARCH_PROGRESS_STEPS[0];
}

function getResultsLoadingConfig(mode = "text", stepId = "") {
  if (String(mode || "").trim() === "quick") {
    return {
      eyebrow: "Loading Results",
      ariaLabel: "Quick results loading",
      defaultStep: "search",
      steps: [
        {
          id: "search",
          label: "Loading",
          percent: 42,
          percentLabel: "",
          title: "Loading results...",
          detail: "Opening the best matches."
        }
      ]
    };
  }
  if (String(mode || "").trim() === "image") {
    return {
      eyebrow: "Image Search Progress",
      ariaLabel: "Image search progress",
      defaultStep: "match",
      steps: IMAGE_ANALYZE_PROGRESS_STEPS.slice(0, 4)
    };
  }
  return {
    eyebrow: "Text Search Progress",
    ariaLabel: "Text search progress",
    defaultStep: "parse",
    steps: TEXT_SEARCH_PROGRESS_STEPS.slice(0, 4)
  };
}

function getResultsLoadingStepConfig(mode = "text", stepId = "") {
  const config = getResultsLoadingConfig(mode, stepId);
  return config.steps.find((step) => step.id === stepId) || config.steps[0];
}

function setResultsLoadingProgressState(nextProgress = {}) {
  const mode = String(nextProgress.mode || state.resultsLoadingMode || "text").trim() || "text";
  const step = getResultsLoadingStepConfig(mode, nextProgress.step);
  const percent = clamp(Number(nextProgress.percent ?? step.percent) || 0, 0, 100);
  state.resultsLoadingMode = mode;
  state.resultsLoadingProgress = {
    mode,
    step: step.id,
    percent,
    percentLabel: String(nextProgress.percentLabel || step.percentLabel || `${Math.round(percent)}%`).trim(),
    indeterminate: Boolean(nextProgress.indeterminate),
    title: String(nextProgress.title || step.title || "").trim(),
    detail: String(nextProgress.detail || step.detail || "").trim()
  };
}

function renderResultsLoadingProgress() {
  const progress = state.resultsLoadingProgress || {
    mode: state.resultsLoadingMode || "text",
    step: "parse",
    percent: 0,
    percentLabel: "0%",
    indeterminate: false,
    title: "Understanding your query...",
    detail: "Preparing the best matches before the result grid appears."
  };
  const mode = String(progress.mode || state.resultsLoadingMode || "text").trim() || "text";
  const modeConfig = getResultsLoadingConfig(mode, progress.step);
  const eyebrow = elements.resultsLoadingPanel?.querySelector(".image-analyze-loading-eyebrow");
  if (elements.resultsLoadingPanel) {
    elements.resultsLoadingPanel.classList.toggle("is-quick", mode === "quick");
  }
  if (eyebrow) {
    eyebrow.textContent = modeConfig.eyebrow;
  }
  if (elements.resultsLoadingTitle) {
    elements.resultsLoadingTitle.textContent = progress.title;
  }
  if (elements.resultsLoadingCopy) {
    elements.resultsLoadingCopy.textContent = progress.detail;
  }
  if (elements.resultsLoadingPercent) {
    elements.resultsLoadingPercent.hidden = mode === "quick";
    elements.resultsLoadingPercent.textContent = progress.percentLabel || `${progress.percent}%`;
  }
  if (elements.resultsLoadingBar) {
    elements.resultsLoadingBar.style.width = `${clamp(Number(progress.percent || 0), 0, 100)}%`;
    elements.resultsLoadingBar.classList.toggle("is-indeterminate", Boolean(progress.indeterminate));
  }
  if (elements.resultsLoadingSteps) {
    elements.resultsLoadingSteps.hidden = modeConfig.steps.length === 0;
    elements.resultsLoadingSteps.setAttribute("aria-label", modeConfig.ariaLabel);
  }
  const steps = elements.resultsLoadingSteps
    ? [...elements.resultsLoadingSteps.querySelectorAll(".image-analyze-segment")]
    : [];
  steps.forEach((item, index) => {
    item.textContent = modeConfig.steps[index]?.label || "";
    item.dataset.step = modeConfig.steps[index]?.id || "";
  });
  const activeIndex = modeConfig.steps.findIndex((step) => step.id === progress.step);
  steps.forEach((item, index) => {
    const isComplete = progress.percent >= 100 || index < activeIndex;
    item.classList.toggle("is-active", index === activeIndex && progress.percent < 100);
    item.classList.toggle("is-complete", isComplete);
  });
}

function clearCachedSearchProgressTimers() {
  if (state.cachedSearchProgressInterval) {
    clearInterval(state.cachedSearchProgressInterval);
    state.cachedSearchProgressInterval = null;
  }
  if (state.cachedSearchProgressFadeTimer) {
    clearTimeout(state.cachedSearchProgressFadeTimer);
    state.cachedSearchProgressFadeTimer = null;
  }
  if (state.cachedSearchProgressAnimationFrame) {
    cancelAnimationFrame(state.cachedSearchProgressAnimationFrame);
    state.cachedSearchProgressAnimationFrame = null;
  }
}

function setCachedSearchProgressStrip(percent = 0, opacity = 1) {
  if (!elements.cachedSearchProgressStrip) {
    return;
  }
  elements.cachedSearchProgressStrip.hidden = false;
  elements.cachedSearchProgressStrip.style.width = `${clamp(Number(percent) || 0, 0, 100)}%`;
  elements.cachedSearchProgressStrip.style.opacity = `${clamp(Number(opacity) || 0, 0, 1)}`;
}

function startCachedSearchProgressStrip() {
  if (!elements.cachedSearchProgressStrip) {
    return;
  }
  clearCachedSearchProgressTimers();
  state.cachedSearchProgressActive = true;
  state.cachedSearchProgressPercent = 0;
  elements.cachedSearchProgressStrip.hidden = false;
  elements.cachedSearchProgressStrip.style.transition =
    "width 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease";
  elements.cachedSearchProgressStrip.style.width = "0%";
  elements.cachedSearchProgressStrip.style.opacity = "0";
  state.cachedSearchProgressAnimationFrame = requestAnimationFrame(() => {
    state.cachedSearchProgressAnimationFrame = requestAnimationFrame(() => {
      state.cachedSearchProgressPercent = 80;
      setCachedSearchProgressStrip(80, 1);
    });
  });
  state.cachedSearchProgressInterval = window.setInterval(() => {
    if (!state.cachedSearchProgressActive) {
      return;
    }
    const nextPercent = Math.min(
      96,
      state.cachedSearchProgressPercent + Math.max(1, (100 - state.cachedSearchProgressPercent) * 0.12)
    );
    if (nextPercent > state.cachedSearchProgressPercent) {
      state.cachedSearchProgressPercent = nextPercent;
      setCachedSearchProgressStrip(nextPercent, 1);
    }
  }, 180);
}

function finishCachedSearchProgressStrip() {
  if (!elements.cachedSearchProgressStrip) {
    return;
  }
  clearCachedSearchProgressTimers();
  state.cachedSearchProgressActive = false;
  state.cachedSearchProgressPercent = 100;
  elements.cachedSearchProgressStrip.hidden = false;
  elements.cachedSearchProgressStrip.style.transition =
    "width 150ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease";
  setCachedSearchProgressStrip(100, 1);
  state.cachedSearchProgressFadeTimer = window.setTimeout(() => {
    if (!elements.cachedSearchProgressStrip) {
      return;
    }
    elements.cachedSearchProgressStrip.style.transition = "opacity 300ms ease";
    elements.cachedSearchProgressStrip.style.opacity = "0";
    state.cachedSearchProgressFadeTimer = window.setTimeout(() => {
      if (!elements.cachedSearchProgressStrip) {
        return;
      }
      elements.cachedSearchProgressStrip.hidden = true;
      elements.cachedSearchProgressStrip.style.width = "0%";
      elements.cachedSearchProgressStrip.style.opacity = "0";
      elements.cachedSearchProgressStrip.style.transition =
        "width 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease";
      state.cachedSearchProgressFadeTimer = null;
    }, 320);
  }, 170);
}

function stopImageAnalyzeProgressAnimation() {
  if (state.imageAnalyzeProgressTimer) {
    window.clearInterval(state.imageAnalyzeProgressTimer);
    state.imageAnalyzeProgressTimer = null;
  }
}

function clearImageAnalyzePhaseTransitionTimers() {
  if (state.imageAnalyzePrepareTransitionTimer) {
    window.clearTimeout(state.imageAnalyzePrepareTransitionTimer);
    state.imageAnalyzePrepareTransitionTimer = null;
  }
  if (state.imageAnalyzeClassifyTransitionTimer) {
    window.clearTimeout(state.imageAnalyzeClassifyTransitionTimer);
    state.imageAnalyzeClassifyTransitionTimer = null;
  }
}

function startImageAnalyzeClassifyPhaseNow() {
  state.imageAnalyzeClassifyStartedAt = Date.now();
  setImageAnalyzeProgressState({
    step: "classify",
    percent: 15,
    percentLabel: "15–30%",
    indeterminate: true,
    title: "Analyzing image...",
    detail: "Analyzing image..."
  });
  renderImageAnalyzeProgress();
  startImageAnalyzeClassifyProgressAnimation();
}

function startImageAnalyzeDeterminateProgressAnimation(targetPercent = 0, options = {}) {
  stopImageAnalyzeProgressAnimation();
  const durationMs = Math.max(180, Number(options.durationMs || 420));
  const startPercent = clamp(Number(state.imageAnalyzeProgress?.percent || 0), 0, 100);
  const target = clamp(Number(targetPercent || 0), 0, 100);
  const startedAt = Date.now();
  state.imageAnalyzeProgressTimer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const progressRatio = Math.min(1, elapsed / durationMs);
    const easedRatio = 1 - Math.pow(1 - progressRatio, 3);
    const nextPercent = startPercent + ((target - startPercent) * easedRatio);
    setImageAnalyzeProgressState({
      ...(state.imageAnalyzeProgress || {}),
      percent: nextPercent,
      indeterminate: false
    });
    renderImageAnalyzeProgress();
    if (progressRatio >= 1) {
      stopImageAnalyzeProgressAnimation();
    }
  }, 32);
}

function startImageAnalyzePrepareProgressAnimation() {
  stopImageAnalyzeProgressAnimation();
  state.imageAnalyzeProgressTimer = window.setInterval(() => {
    const progress = state.imageAnalyzeProgress || {};
    if (progress.step !== "prepare" || !progress.indeterminate) {
      stopImageAnalyzeProgressAnimation();
      return;
    }
    const target = 15;
    const current = clamp(Number(progress.percent || 0), 0, target);
    const remaining = target - current;
    if (remaining <= 0.5) {
      return;
    }
    const delta = remaining * 0.04;
    setImageAnalyzeProgressState({
      ...progress,
      percent: Math.min(target - 0.01, current + delta),
      percentLabel: "0–15%",
      indeterminate: true
    });
    renderImageAnalyzeProgress();
  }, 220);
}

function startImageAnalyzeClassifyProgressAnimation() {
  stopImageAnalyzeProgressAnimation();
  state.imageAnalyzeProgressTimer = window.setInterval(() => {
    const progress = state.imageAnalyzeProgress || {};
    if (progress.step !== "classify" || !progress.indeterminate) {
      stopImageAnalyzeProgressAnimation();
      return;
    }
    const target = 30;
    const current = clamp(Number(progress.percent || 15), 15, target);
    const remaining = target - current;
    if (remaining <= 0.5) {
      return;
    }
    const delta = remaining * 0.04;
    setImageAnalyzeProgressState({
      ...progress,
      percent: Math.min(target - 0.01, current + delta),
      percentLabel: "15–30%",
      indeterminate: true
    });
    renderImageAnalyzeProgress();
  }, 220);
}

function startImageAnalyzeExtractProgressAnimation() {
  stopImageAnalyzeProgressAnimation();
  state.imageAnalyzeProgressTimer = window.setInterval(() => {
    const progress = state.imageAnalyzeProgress || {};
    if (progress.step !== "extract" || !progress.indeterminate) {
      stopImageAnalyzeProgressAnimation();
      return;
    }
    const target = clamp(Number(progress.extractTarget || 30), 30, 85);
    const current = clamp(Number(progress.percent || 30), 30, target);
    const remaining = target - current;
    if (remaining <= 0.5) {
      return;
    }
    const delta = remaining * 0.04;
    setImageAnalyzeProgressState({
      ...progress,
      percent: Math.min(target - 0.01, current + delta),
      percentLabel: progress.percentLabel || "30–85%",
      indeterminate: true,
      extractTarget: target
    });
    renderImageAnalyzeProgress();
  }, 220);
}

function resolveImageAnalyzeExtractTarget(currentPass = 0, expectedPasses = 2) {
  const pass = Math.max(1, Number(currentPass || 1));
  const expected = Math.max(1, Number(expectedPasses || 2));
  if (pass >= 3) {
    return 85;
  }
  return 30 + (55 * Math.min(pass, expected) / expected);
}

function resolveImageAnalyzeExtractFloor(currentPass = 0, expectedPasses = 2) {
  const pass = Math.max(1, Number(currentPass || 1));
  if (pass <= 1) {
    return 30;
  }
  return resolveImageAnalyzeExtractTarget(pass - 1, expectedPasses);
}

function updateImageAnalyzeProgress(stepId = "prepare", options = {}) {
  const step = getImageAnalyzeStepConfig(stepId);
  const currentProgress = state.imageAnalyzeProgress || {};
  const nextIndeterminate = Boolean(options.indeterminate);
  const requestedPercent = Number(options.percent ?? step.percent ?? currentProgress.percent ?? 0);
  const preservedPercent = nextIndeterminate && currentProgress.step === step.id && currentProgress.indeterminate
    ? Math.max(Number(currentProgress.percent || 0), requestedPercent)
    : requestedPercent;
  setImageAnalyzeProgressState({
    step: step.id,
    percent: preservedPercent,
    percentLabel: options.percentLabel,
    indeterminate: options.indeterminate,
    title: options.title || step.title,
    detail: options.detail || step.detail
  });
  renderImageAnalyzeProgress();
  if (nextIndeterminate && step.id === "prepare") {
    startImageAnalyzePrepareProgressAnimation();
  } else if (nextIndeterminate && step.id === "classify") {
    startImageAnalyzeClassifyProgressAnimation();
  } else if (nextIndeterminate && step.id === "extract") {
    startImageAnalyzeExtractProgressAnimation();
  } else if (typeof options.animateTo === "number") {
    startImageAnalyzeDeterminateProgressAnimation(options.animateTo, {
      durationMs: options.durationMs
    });
  } else {
    stopImageAnalyzeProgressAnimation();
  }
}

function stopImageAnalyzeProgressPolling() {
  if (state.imageAnalyzeProgressPollTimer) {
    window.clearInterval(state.imageAnalyzeProgressPollTimer);
    state.imageAnalyzeProgressPollTimer = null;
  }
  clearImageAnalyzePhaseTransitionTimers();
  state.imageAnalyzeProgressRequestId = "";
  state.imageAnalyzeProgressSequence = 0;
  state.imageAnalyzePrepareStartedAt = 0;
  state.imageAnalyzeClassifyStartedAt = 0;
}

function buildImageAnalyzeProgressRequestId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `image-analyze-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function applyImageAnalyzeBackendProgressEvent(event = {}) {
  const type = String(event.type || "").trim();
  const expectedPasses = Math.max(1, Number(event.expected_passes || 2));
  const currentPass = Math.max(0, Number(event.current_pass || 0));
  const previous = state.imageAnalyzeProgress || {};
  const isStage1Tiebreaker = currentPass >= 3 || type === "stage1_tiebreaker_started" || type === "stage1_tiebreaker_done";
  const isStage23Tiebreaker = currentPass >= 3 || type === "run_3_started" || type === "run_3_done";
  switch (type) {
    case "stage1_started":
    case "stage1_tiebreaker_started":
      if (state.imageAnalyzePrepareTransitionTimer) {
        window.clearTimeout(state.imageAnalyzePrepareTransitionTimer);
        state.imageAnalyzePrepareTransitionTimer = null;
      }
      {
        const elapsed = Math.max(0, Date.now() - Number(state.imageAnalyzePrepareStartedAt || 0));
        const remaining = Math.max(0, IMAGE_ANALYZE_MIN_PHASE_MS - elapsed);
        const beginClassify = () => {
          startImageAnalyzeClassifyPhaseNow();
          if (isStage1Tiebreaker) {
            setImageAnalyzeProgressState({
              ...(state.imageAnalyzeProgress || {}),
              step: "classify",
              percent: Math.max(Number(state.imageAnalyzeProgress?.percent || 15), 15),
              percentLabel: "15–30%",
              indeterminate: true,
              title: "Resolving classification ambiguity...",
              detail: "Resolving classification ambiguity..."
            });
            renderImageAnalyzeProgress();
          }
        };
        if (remaining > 0) {
          state.imageAnalyzePrepareTransitionTimer = window.setTimeout(() => {
            state.imageAnalyzePrepareTransitionTimer = null;
            beginClassify();
          }, remaining);
        } else {
          beginClassify();
        }
      }
      break;

    case "stage1_done":
    case "stage1_tiebreaker_done":
      if (state.imageAnalyzeClassifyTransitionTimer) {
        window.clearTimeout(state.imageAnalyzeClassifyTransitionTimer);
        state.imageAnalyzeClassifyTransitionTimer = null;
      }
      {
        const prepareElapsed = Math.max(0, Date.now() - Number(state.imageAnalyzePrepareStartedAt || 0));
        const prepareRemaining = Math.max(0, IMAGE_ANALYZE_MIN_PHASE_MS - prepareElapsed);
        const classifyElapsed = state.imageAnalyzeClassifyStartedAt
          ? Math.max(0, Date.now() - Number(state.imageAnalyzeClassifyStartedAt || 0))
          : 0;
        const classifyRemaining = state.imageAnalyzeClassifyStartedAt
          ? Math.max(0, IMAGE_ANALYZE_MIN_PHASE_MS - classifyElapsed)
          : IMAGE_ANALYZE_MIN_PHASE_MS;
        const remaining = Math.max(prepareRemaining, classifyRemaining);
        const finishClassify = () => {
          stopImageAnalyzeProgressAnimation();
          setImageAnalyzeProgressState({
            step: "classify",
            percent: 30,
            indeterminate: false,
            percentLabel: "30%",
            title: isStage1Tiebreaker ? "Resolving classification ambiguity..." : "Analyzing image...",
            detail: isStage1Tiebreaker ? "Resolving classification ambiguity..." : "Analyzing image..."
          });
          renderImageAnalyzeProgress();
        };
        if (remaining > 0) {
          state.imageAnalyzeClassifyTransitionTimer = window.setTimeout(() => {
            state.imageAnalyzeClassifyTransitionTimer = null;
            if (!state.imageAnalyzeClassifyStartedAt) {
              startImageAnalyzeClassifyPhaseNow();
            }
            finishClassify();
          }, remaining);
        } else {
          finishClassify();
        }
      }
      break;

    case "stage23_started": {
      const target = currentPass >= 3 ? 85 : resolveImageAnalyzeExtractTarget(2, expectedPasses);
      setImageAnalyzeProgressState({
        step: "extract",
        percent: Math.max(Number(previous.percent || 30), 30),
        percentLabel: "30–85%",
        indeterminate: true,
        extractTarget: target,
        title: isStage23Tiebreaker ? "Resolving ambiguity..." : "Extracting traits...",
        detail: isStage23Tiebreaker ? "Re-running extraction to resolve ambiguity..." : "Extracting traits..."
      });
      renderImageAnalyzeProgress();
      startImageAnalyzeExtractProgressAnimation();
      break;
    }

    case "stage23_done": {
      const target = currentPass >= 3 ? 85 : resolveImageAnalyzeExtractTarget(2, expectedPasses);
      setImageAnalyzeProgressState({
        ...previous,
        step: "extract",
        percent: target,
        percentLabel: "30–85%",
        indeterminate: true,
        extractTarget: target,
        title: isStage23Tiebreaker ? "Resolving ambiguity..." : "Extracting traits...",
        detail: isStage23Tiebreaker ? "Re-running extraction to resolve ambiguity..." : "Extracting traits..."
      });
      renderImageAnalyzeProgress();
      break;
    }

    case "run_1_started":
    case "run_2_started":
    case "run_3_started": {
      setImageAnalyzeProgressState({
        step: "extract",
        percent: Math.max(Number(previous.percent || 30), 30),
        percentLabel: "30–85%",
        indeterminate: true,
        extractTarget: currentPass >= 3 ? 85 : resolveImageAnalyzeExtractTarget(2, expectedPasses),
        title: isStage23Tiebreaker ? "Resolving ambiguity..." : "Extracting traits...",
        detail: isStage23Tiebreaker ? "Re-running extraction to resolve ambiguity..." : "Extracting traits..."
      });
      renderImageAnalyzeProgress();
      startImageAnalyzeExtractProgressAnimation();
      break;
    }

    case "run_1_done":
    case "run_2_done":
    case "run_3_done": {
      const target = currentPass >= 3 ? 85 : resolveImageAnalyzeExtractTarget(2, expectedPasses);
      setImageAnalyzeProgressState({
        ...previous,
        step: "extract",
        percent: target,
        percentLabel: "30–85%",
        indeterminate: true,
        extractTarget: target,
        title: isStage23Tiebreaker ? "Resolving ambiguity..." : "Extracting traits...",
        detail: isStage23Tiebreaker ? "Re-running extraction to resolve ambiguity..." : "Extracting traits..."
      });
      renderImageAnalyzeProgress();
      break;
    }

    case "embedding_started":
      setImageAnalyzeProgressState({
        ...previous,
        step: "extract",
        extractTarget: 85,
        indeterminate: true,
        title: "Extracting traits...",
        detail: "Extracting traits..."
      });
      renderImageAnalyzeProgress();
      startImageAnalyzeExtractProgressAnimation();
      break;

    case "embedding_done":
    case "refine_started":
      stopImageAnalyzeProgressAnimation();
      setImageAnalyzeProgressState({
        step: "match",
        percent: 90,
        indeterminate: false,
        title: "Matching against catalog",
        detail: "Matching against catalog",
      });
      renderImageAnalyzeProgress();
      break;

    default:
      break;
  }
}

async function pollImageAnalyzeProgressOnce(requestId = "") {
  if (!requestId) {
    return;
  }
  try {
    const since = Number(state.imageAnalyzeProgressSequence || 0);
    const payload = await fetchJson(`/api/analyze-image-progress?request_id=${encodeURIComponent(requestId)}&since=${encodeURIComponent(since)}`);
    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (events.length) {
      events.forEach((event) => {
        applyImageAnalyzeBackendProgressEvent(event || {});
      });
      state.imageAnalyzeProgressSequence = Number(payload?.sequence || since);
    }
  } catch (error) {
    if (String(error?.message || "").includes("No image analysis progress found")) {
      return;
    }
  }
}

function startImageAnalyzeProgressPolling(requestId = "") {
  stopImageAnalyzeProgressPolling();
  state.imageAnalyzeProgressRequestId = String(requestId || "").trim();
  if (!state.imageAnalyzeProgressRequestId) {
    return;
  }
  pollImageAnalyzeProgressOnce(state.imageAnalyzeProgressRequestId);
  state.imageAnalyzeProgressPollTimer = window.setInterval(() => {
    pollImageAnalyzeProgressOnce(state.imageAnalyzeProgressRequestId);
  }, 350);
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

  return path;
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

function normalizeTraitFilterState(source = {}) {
  if (!source || typeof source !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(source)
      .map(([field, value]) => [normalizeTraitFieldKey(field), normalizeTraitValue(value)])
      .filter(([, value]) => Boolean(value))
  );
}

function isMissingBrowseTraitValue(value = "") {
  return new Set(["", "unknown", "n/a"]).has(normalizeTraitValue(value));
}

function isSupportedBrowseTraitCategory(categoryKey = "") {
  return isSupportedBrowseVisualType(categoryKey, state.bootstrap);
}

function getBrowseScopedCategoryKey(payload = state.lastPayload, query = state.lastQuery) {
  if (!isBrowsePayload(payload, query)) {
    return "";
  }
  const categoryKey = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  return categoryKey && categoryKey !== "all" ? normalizeVisualTypeKey(categoryKey) : "";
}

function getBrowseTraitFieldConfigs(categoryKey = "") {
  const normalizedCategory = normalizeVisualTypeKey(categoryKey);
  const types = getBootstrapRoutingTypes()?.types;
  if (!normalizedCategory || !types?.[normalizedCategory]) {
    return [];
  }
  return (types[normalizedCategory].fields || []).filter((field) => (
    field?.type === "enum" && field?.detectability !== "no"
  ));
}

function getCategoryScopedImages(result = {}, categoryKey = "") {
  const normalizedCategory = normalizeVisualTypeKey(categoryKey);
  if (!normalizedCategory) {
    return [];
  }
  return (Array.isArray(result.matching_images) ? result.matching_images : [])
    .filter((image) => normalizeVisualTypeKey(getPayloadVisualType(image)) === normalizedCategory);
}

function imageMatchesTraitFilters(image = {}, traitFilters = {}) {
  const normalizedFilters = normalizeTraitFilterState(traitFilters);
  const activeEntries = Object.entries(normalizedFilters);
  if (!activeEntries.length) {
    return true;
  }

  const enumFields = image?.enum_fields && typeof image.enum_fields === "object" ? image.enum_fields : {};
  return activeEntries.every(([field, value]) => normalizeTraitValue(enumFields[field]) === value);
}

function getMatchingBrowseTraitImages(result = {}, categoryKey = "", traitFilters = {}) {
  return getCategoryScopedImages(result, categoryKey)
    .filter((image) => imageMatchesTraitFilters(image, traitFilters));
}

function getResultTraitValueMapFromImages(images = []) {
  const valueMap = new Map();

  for (const image of images) {
    const enumFields = image?.enum_fields && typeof image.enum_fields === "object" ? image.enum_fields : {};
    for (const [field, rawValue] of Object.entries(enumFields)) {
      const normalizedField = normalizeTraitFieldKey(field);
      const normalizedValue = normalizeTraitValue(rawValue);
      const displayValue = formatFrontendTraitValue(normalizedField, rawValue);
      if (!normalizedField || isMissingBrowseTraitValue(normalizedValue)) {
        continue;
      }
      if (!valueMap.has(normalizedField)) {
        valueMap.set(normalizedField, new Map());
      }
      if (!valueMap.get(normalizedField).has(normalizedValue)) {
        valueMap.get(normalizedField).set(normalizedValue, displayValue);
      }
    }
  }

  return valueMap;
}

function resultMatchesBrowseCategoryScope(result = {}, categoryKey = "") {
  if (!categoryKey) {
    return true;
  }
  return getCategoryScopedImages(result, categoryKey).length > 0;
}

function resultMatchesTraitFilters(result = {}, categoryKey = "", traitFilters = {}) {
  return getMatchingBrowseTraitImages(result, categoryKey, traitFilters).length > 0;
}

function buildBrowseFilterModel(payload = state.lastPayload, query = state.lastQuery) {
  const allResults = Array.isArray(payload?.results) ? payload.results : [];
  const browseMode = isBrowsePayload(payload, query);
  const categoryKey = getBrowseScopedCategoryKey(payload, query);
  const normalizedTraitFilters = normalizeTraitFilterState(state.traitFilters);
  const categoryScopedResults = browseMode && categoryKey
    ? allResults.filter((result) => resultMatchesBrowseCategoryScope(result, categoryKey))
    : allResults;
  const visibleResults = browseMode && categoryKey
    ? categoryScopedResults.filter((result) => resultMatchesTraitFilters(result, categoryKey, normalizedTraitFilters))
    : allResults;

  const hasSpecificBrowseCategory = Boolean(categoryKey && categoryKey !== "all");

  if (!browseMode || !hasSpecificBrowseCategory || !isSupportedBrowseTraitCategory(categoryKey)) {
    return {
      browseMode,
      categoryKey,
      allResults,
      categoryScopedResults,
      visibleResults,
      traitFilters: normalizedTraitFilters,
      fieldModels: [],
      panelVisible: false
    };
  }

  const fieldConfigs = getBrowseTraitFieldConfigs(categoryKey);
  const fieldModels = fieldConfigs.map((fieldConfig) => {
    const fieldKey = normalizeTraitFieldKey(fieldConfig.field);
    const schemaLabelByValue = new Map(
      (fieldConfig.allowed_values || []).map((value) => [normalizeTraitValue(value), String(value || "").trim()])
    );
    const legacyLabelByValue = new Map();

    for (const result of categoryScopedResults) {
      const valueMap = getResultTraitValueMapFromImages(getCategoryScopedImages(result, categoryKey));
      for (const [valueKey, displayValue] of valueMap.get(fieldKey) || []) {
        if (!schemaLabelByValue.has(valueKey) && !legacyLabelByValue.has(valueKey)) {
          legacyLabelByValue.set(valueKey, displayValue);
        }
      }
    }

    const comparisonFilters = { ...normalizedTraitFilters };
    delete comparisonFilters[fieldKey];
    const remainingResults = categoryScopedResults.filter((result) => (
      resultMatchesTraitFilters(result, categoryKey, comparisonFilters)
    ));
    const counts = new Map();

    for (const result of remainingResults) {
      const filteredImages = getMatchingBrowseTraitImages(result, categoryKey, comparisonFilters);
      for (const valueKey of getResultTraitValueMapFromImages(filteredImages).get(fieldKey)?.keys() || []) {
        counts.set(valueKey, (counts.get(valueKey) || 0) + 1);
      }
    }

    const options = [
      ...(fieldConfig.allowed_values || []).map((value) => {
        const normalizedValue = normalizeTraitValue(value);
        return {
          value: normalizedValue,
          label: formatFrontendTraitValue(fieldKey, value),
          count: counts.get(normalizedValue) || 0,
          legacy: false
        };
      }),
      ...[...legacyLabelByValue.entries()]
        .sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, label]) => ({
          value,
          label,
          count: counts.get(value) || 0,
          legacy: true
        }))
    ];

    if (
      normalizedTraitFilters[fieldKey] &&
      !options.some((option) => option.value === normalizedTraitFilters[fieldKey])
    ) {
      options.push({
        value: normalizedTraitFilters[fieldKey],
        label: normalizedTraitFilters[fieldKey],
        count: counts.get(normalizedTraitFilters[fieldKey]) || 0,
        legacy: true
      });
    }

    return {
      field: fieldConfig.field,
      fieldKey,
      label: formatTraitFieldLabel(fieldConfig.field),
      selectedValue: normalizedTraitFilters[fieldKey] || "",
      options
    };
  });

  return {
    browseMode,
    categoryKey,
    allResults,
    categoryScopedResults,
    visibleResults,
    traitFilters: normalizedTraitFilters,
    fieldModels,
    panelVisible: true
  };
}

function getVisibleResults(payload = state.lastPayload, query = state.lastQuery) {
  return buildBrowseFilterModel(payload, query).visibleResults;
}

function clearBrowseTraitFilters() {
  state.traitFilters = {};
}

function renderBrowseTraitFilters(payload = state.lastPayload, query = state.lastQuery) {
  if (!elements.browseTraitFilterPanel || !elements.browseTraitFilterFields) {
    return;
  }

  const model = buildBrowseFilterModel(payload, query);
  elements.browseTraitFilterPanel.hidden = !model.panelVisible;
  elements.browseTraitFilterFields.innerHTML = "";
  if (elements.browseTraitFilterCount) {
    elements.browseTraitFilterCount.hidden = true;
  }

  if (!model.panelVisible) {
    if (elements.resetBrowseTraitFilters) {
      elements.resetBrowseTraitFilters.disabled = true;
    }
    return;
  }

  for (const fieldModel of model.fieldModels) {
    const wrap = document.createElement("label");
    wrap.className = "browse-trait-field";

    const select = document.createElement("select");
    select.className = "browse-trait-field-select";
    select.dataset.field = fieldModel.fieldKey;
    select.setAttribute("aria-label", fieldModel.label);

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = `Any ${fieldModel.label}`;
    select.appendChild(emptyOption);

    for (const optionModel of fieldModel.options) {
      const option = document.createElement("option");
      option.value = optionModel.value;
      option.textContent = `${optionModel.label} (${optionModel.count})${optionModel.legacy ? " [legacy]" : ""}`;
      option.disabled = optionModel.count === 0;
      option.selected = optionModel.value === fieldModel.selectedValue;
      select.appendChild(option);
    }

    wrap.append(select);
    elements.browseTraitFilterFields.appendChild(wrap);
  }

  if (elements.resetBrowseTraitFilters) {
    elements.resetBrowseTraitFilters.disabled = !Object.keys(model.traitFilters).length;
  }
}

function syncBrowseCategoryControl(payload = state.lastPayload, query = state.lastQuery) {
  if (!elements.browseCategoryScopeBar || !elements.browseCategorySelect) {
    return;
  }
  const browseMode = isBrowsePayload(payload, query);
  const shouldShow = browseMode && !state.currentImageAnalysis;
  syncVisualTypeSelectOptions(elements.browseCategorySelect, "All categories");
  elements.browseCategoryScopeBar.hidden = !shouldShow;
  elements.browseCategorySelect.value = getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all";
  elements.browseCategorySelect.disabled = state.categoryScopeLoading;
}

async function handleCategoryScopeSelectionChange(nextRawValue = "") {
  const previousCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  const composerParts = getSearchComposerTextParts();
  const previousMatch = state.searchComposerMatch || splitQueryAroundCategoryScope(state.lastQuery, previousCategory).match;
  const nextCategory = normalizeCategoryScopeSelection(nextRawValue, { maxSelections: 1 });
  const nextPrimaryCategory = getPrimaryCategoryScopeSelection(nextCategory);
  const categoryChanged = previousCategory !== nextPrimaryCategory;
  state.categorySelectionTouchedSinceLastSearch = true;
  const nextQuery = nextPrimaryCategory && nextPrimaryCategory !== "all"
    ? previousCategory && previousCategory !== "all"
      ? buildInlineCategoryScopedQuery(
          nextPrimaryCategory,
          composerParts.prefix,
          previousMatch,
          composerParts.suffix
        )
      : stripVagueVisualTypeReferenceFromQuery(composerParts.plain || state.lastQuery || "", nextPrimaryCategory)
    : composerParts.plain || state.lastQuery || "";
  if (categoryChanged) {
    clearBrowseTraitFilters();
  }
  state.resultCategoryScope = nextCategory;
  state.categoryScopeMode = nextPrimaryCategory === "all" ? "all" : "explicit";

  if (isBrowsePayload(state.lastPayload, state.lastQuery) && !String(state.lastQuery || "").trim() && !state.currentImageAnalysis) {
    renderSearchComposer(nextQuery);
    syncBrowseCategoryControl(state.lastPayload, nextQuery);
    renderBrowseTraitFilters(state.lastPayload, nextQuery);
    renderResults(state.lastPayload, nextQuery);
    syncSearchPageUrl();
    if (categoryChanged) {
      logEvent("category_scope_changed", {
        from: previousCategory && previousCategory !== "all" ? previousCategory : null,
        to: nextPrimaryCategory && nextPrimaryCategory !== "all" ? nextPrimaryCategory : null,
        resultCount: Number(getVisibleResults(state.lastPayload, nextQuery).length || 0)
      });
    }
    return;
  }

  state.categoryScopeLoading = true;
  renderSearchComposer(nextQuery);
  syncBrowseCategoryControl(state.lastPayload, nextQuery);

  const payload = await runSearch(nextQuery, {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    visualType: nextPrimaryCategory || "all",
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
  syncBrowseCategoryControl(state.lastPayload, state.lastQuery);
  if (payload && categoryChanged) {
    logEvent("category_scope_changed", {
      from: previousCategory && previousCategory !== "all" ? previousCategory : null,
      to: nextPrimaryCategory && nextPrimaryCategory !== "all" ? nextPrimaryCategory : null,
      resultCount: Number(payload.total_results || payload.results?.length || 0)
    });
  }
}

function getCategoryPhraseForQuery(value = "", options = {}) {
  const normalized = normalizeVisualTypeKey(value);
  const singular = options?.singular === true;
  const phrases = singular
    ? {
        task_collab_chair: "work chair",
        guest_chair: "guest chair",
        lounge_chair: "lounge chair",
        bench: "bench",
        stool: "stool",
        conference: "conference table",
        occasional: "occasional table",
        cafe_dining: "cafe table",
        training: "training table",
        huddle_collaborative: "huddle table"
      }
    : {
        task_collab_chair: "work chairs",
        guest_chair: "guest chairs",
        lounge_chair: "lounge seating",
        bench: "benches",
        stool: "stools",
        conference: "conference tables",
        occasional: "occasional tables",
        cafe_dining: "cafe tables",
        training: "training tables",
        huddle_collaborative: "huddle tables"
      };
  return phrases[normalized] || "";
}

function shouldUseSingularCategoryPhrase(matchText = "") {
  const normalized = String(matchText || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/\b(chairs|seats|benches|stools|tables)\b/.test(normalized)) {
    return false;
  }
  if (/\b(seating|table)\b/.test(normalized)) {
    return false;
  }
  return /\b(chair|seat|work chair|guest chair|lounge chair|task chair|collaborative chair|bench|stool|table|conference table|boardroom table|side table|end table|accent table|coffee table|cafe table|dining table|bistro table|kitchen table|restaurant table|training table|flip table|flip-top table|folding table|seminar table|classroom table|huddle table|collaboration table|team table)\b/.test(normalized);
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
  const normalizedCategory = normalizeVisualTypeKey(categoryKey);
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
  const normalized = normalizeVisualTypeKey(
    getPayloadVisualType(result.hero_image) ||
    getPayloadVisualType(normalizeMatchingImages(result)[0]) ||
    getPayloadVisualType(result.debug?.stage1) ||
    ""
  );
  return normalized;
}

function getSearchResultCategoryOptions(payload = state.lastPayload) {
  return [...new Set((payload?.results || [])
    .map((result) => getResultStage1Category(result))
    .filter(Boolean))]
    .sort((left, right) => formatVisualTypeLabel(left, state.bootstrap).localeCompare(formatVisualTypeLabel(right, state.bootstrap)));
}

function shouldShowSearchCategoryChip() {
  const selectedCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  return Boolean(
    selectedCategory &&
    selectedCategory !== "all" &&
    (state.lastQuery || state.currentImageAnalysis || state.lastPayload)
  );
}

function stripVagueVisualTypeReferenceFromQuery(query = "", selectedCategory = "") {
  const normalizedSelectedCategory = normalizeVisualTypeKey(selectedCategory);
  let nextQuery = String(query || "").trim();

  Object.keys(getVisualTypeDisplayNameMap(state.bootstrap)).forEach((categoryKey) => {
    nextQuery = stripCategoryScopeFromQuery(nextQuery, categoryKey);
  });

  nextQuery = nextQuery.replace(/\b(chair|chairs|seating|seat|seats|table|tables)\b/gi, " ");
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
  syncVisualTypeSelectOptions(elements.searchCategorySelect, "All categories");
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
  updateSearchComposerClearButton();
}

const BULLET_PRIORITY_LABELS = {
  essential: "essential",
  normal: "normal",
  low: "low",
  off: "off"
};

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

const INLINE_REFINEMENT_EXCLUDED_FIELDS = new Set([]);

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
  ["upholstery", "Upholstery"],
  ["narrow_arms", "Arm Width"],
  ["arms_flush_with_back", "Arm Height"]
]);

const FRONTEND_TRAIT_VALUE_LABELS = new Map([]);

const STRUCTURED_BULLET_FIELD_ALIASES = new Map([
  ["arms", "arm_option"],
  ["base", "base_type"],
  ["design", "design_register"],
  ["shape", "shape_character"],
  ["height", "height_category"],
  ["adjustability", "height_adjustability"]
]);

function normalizeTraitFieldKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatTraitFieldLabel(field = "") {
  const normalizedField = normalizeTraitFieldKey(field);
  if (INLINE_REFINEMENT_LABELS.has(normalizedField)) {
    return INLINE_REFINEMENT_LABELS.get(normalizedField);
  }
  return String(field || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTraitValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function formatFrontendTraitValue(field = "", value = "") {
  const normalizedField = normalizeTraitFieldKey(field);
  const rawValue = String(value ?? "").trim();
  const valueLabels = FRONTEND_TRAIT_VALUE_LABELS.get(normalizedField);
  if (!valueLabels) {
    return rawValue;
  }
  return valueLabels.get(normalizeTraitValue(rawValue)) || rawValue;
}

function normalizeFrontendTraitValueForParsing(field = "", value = "") {
  const normalizedField = normalizeTraitFieldKey(field);
  const rawValue = String(value ?? "").trim();
  const valueLabels = FRONTEND_TRAIT_VALUE_LABELS.get(normalizedField);
  if (!valueLabels) {
    return rawValue;
  }
  const normalizedRawValue = normalizeTraitValue(rawValue);
  for (const [canonicalValue, displayLabel] of valueLabels.entries()) {
    if (normalizeTraitValue(displayLabel) === normalizedRawValue) {
      return String(displayLabel || "").trim() || rawValue;
    }
  }
  return rawValue;
}

function buildTraitFieldConfigIndex(seatingTypes) {
  const index = new Map();
  Object.entries(seatingTypes?.types || {}).forEach(([typeKey, typeConfig]) => {
    const fieldMap = new Map();
    (typeConfig?.fields || []).forEach((fieldConfig) => {
      const fieldName = String(fieldConfig?.field || "").trim();
      if (fieldName) {
        fieldMap.set(fieldName, fieldConfig);
      }
    });
    index.set(typeKey, fieldMap);
  });
  return index;
}

function getTraitFieldConfigIndex() {
  if (!getBootstrapRoutingTypes()) {
    return new Map();
  }
  const version = String(getBootstrapRoutingTypes()?.version || "");
  if (!state.traitFieldConfigIndex || state.traitFieldConfigIndexVersion !== version) {
    state.traitFieldConfigIndex = buildTraitFieldConfigIndex(getBootstrapRoutingTypes());
    state.traitFieldConfigIndexVersion = version;
  }
  return state.traitFieldConfigIndex;
}

function buildTraitSelectionKey(field = "", value = "") {
  return `${normalizeTraitFieldKey(field)}::${normalizeTraitValue(value)}`;
}

function resolveStructuredBulletField(typeKey = "", fieldLabel = "") {
  const normalizedField = normalizeTraitFieldKey(fieldLabel);
  if (!normalizedField) {
    return "";
  }

  const fieldConfig = getTraitFieldConfig(typeKey, normalizedField);
  if (fieldConfig) {
    return normalizedField;
  }

  const seatingTypes = getBootstrapRoutingTypes();
  const types = seatingTypes?.types;
  const fallbackType = seatingTypes?.default_type || "";
  const resolvedTypeKey = types?.[typeKey] ? typeKey : fallbackType;
  const typeFields = types?.[resolvedTypeKey]?.fields || [];

  const schemaLabelMatch = typeFields.find((field) => (
    normalizeTraitFieldKey(formatTraitFieldLabel(field.field)) === normalizedField
  ));
  if (schemaLabelMatch) {
    return schemaLabelMatch.field;
  }

  const aliasMatch = STRUCTURED_BULLET_FIELD_ALIASES.get(normalizedField);
  if (aliasMatch && getTraitFieldConfig(resolvedTypeKey, aliasMatch)) {
    return aliasMatch;
  }

  return aliasMatch || normalizedField;
}

function parseStructuredBulletEntry(bullet = "", priority = "normal", typeKey = state.currentVisualType) {
  const raw = String(bullet || "").trim();
  const separatorIndex = raw.indexOf(":");
  if (!raw || separatorIndex === -1) {
    return null;
  }

  const field = resolveStructuredBulletField(typeKey, raw.slice(0, separatorIndex));
  const value = normalizeFrontendTraitValueForParsing(
    field,
    raw.slice(separatorIndex + 1).trim()
  );
  if (!field || !value) {
    return null;
  }

  return { field, value, priority };
}

function defaultPriorityForBulletField(field = "", typeKey = state.currentVisualType) {
  const normalizedField = normalizeTraitFieldKey(field);
  return getFieldPriority(typeKey, normalizedField);
}

function defaultPriorityForBulletText(bullet = "", typeKey = state.currentVisualType) {
  const parsed = parseStructuredBulletEntry(bullet, "normal", typeKey);
  return parsed ? defaultPriorityForBulletField(parsed.field, typeKey) : "normal";
}

function buildQueryBulletMap(selectedBullets = [], typeKey = state.currentVisualType) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  const map = new Map();

  normalized.essential.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "essential", typeKey);
    if (parsed) {
      map.set(parsed.field, parsed);
    }
  });

  normalized.normal.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "normal", typeKey);
    if (parsed && !map.has(parsed.field)) {
      map.set(parsed.field, parsed);
    }
  });

  normalized.low.forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "low", typeKey);
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

function updateClarificationConflict(conflict = null) {
  state.clarificationConflict = conflict && typeof conflict === "object" ? cloneValue(conflict) : null;
  renderClarificationBar();
}

function updateCategoryRequirement(requirement = null) {
  state.categoryRequirement = requirement && typeof requirement === "object" ? cloneValue(requirement) : null;
  renderClarificationBar();
}

function buildImageAnalysisSelectionKey(body = {}) {
  return String(body?.image_data_url || body?.image_url || "").trim();
}

function getCachedImageAnalysisCategory(body = {}) {
  const cacheKey = buildImageAnalysisSelectionKey(body);
  if (!cacheKey) {
    return "";
  }
  return state.imageAnalysisCategorySelection?.key === cacheKey
    ? String(state.imageAnalysisCategorySelection?.visualType || state.imageAnalysisCategorySelection?.seatingType || "").trim()
    : "";
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

function collectDescriptionAuditEntries(result = {}) {
  const heroImageUrl = normalizeDisplayImageUrl(result?.hero_image?.image_url || result?.best_image_url || "");
  const matchingImages = normalizeMatchingImages(result);
  const fallbackImages = matchingImages.length
    ? matchingImages
    : (result?.hero_image ? [result.hero_image] : []);
  const seen = new Set();

  return fallbackImages
    .map((image, index) => {
      const imageUrl = normalizeDisplayImageUrl(image?.image_url || "");
      const imageKey = String(image?.image_id || imageUrl || index);
      if (seen.has(imageKey)) {
        return null;
      }
      seen.add(imageKey);
      const freeText = image?.free_text || {};
      const isHero = Boolean(heroImageUrl && imageUrl && imageUrl === heroImageUrl);
      const structuredCaption = String(
        image?.structured_caption ||
        freeText?.structured_caption ||
        (isHero ? result?.debug?.structured_caption : "") ||
        ""
      ).trim();
      const visualSummary = String(
        image?.visual_summary ||
        freeText?.visual_summary ||
        image?.stage2?.visual_summary ||
        (isHero ? result?.debug?.visual_description : "") ||
        ""
      ).trim();

      if (!structuredCaption && !visualSummary && !imageUrl) {
        return null;
      }

      return {
        imageUrl,
        filename: extractImageFilename(imageUrl) || `Image ${index + 1}`,
        isHero,
        structuredCaption,
        visualSummary
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right.isHero) - Number(left.isHero));
}

function scoreBreakdownValue(breakdown = [], label = "") {
  const item = (breakdown || []).find((entry) => String(entry?.label || "").toLowerCase() === String(label || "").toLowerCase());
  return Number(item?.value || 0);
}

function traitFieldWeightScale(typeKey = "", field = "") {
  const normalizedField = normalizeTraitFieldKey(field);
  if (!normalizedField) {
    return 1;
  }
  const priority = getFieldPriority(typeKey, normalizedField);
  if (priority === "essential") {
    return 2;
  }
  if (priority === "low") {
    return 0.5;
  }
  return 1;
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

function hasOpenModalShell() {
  return [
    elements.imageModal,
    elements.structuredTraitsModal,
    elements.promptLibraryModal,
    elements.extractionSummaryModal,
    elements.descriptionAuditModal
  ].some((modal) => modal && !modal.hidden);
}

function openDescriptionAuditModal(result = {}) {
  if (!IS_PRIVATE_BROWSE_ROUTE || !elements.descriptionAuditModal || !elements.descriptionAuditModalBody) {
    return;
  }

  const entries = collectDescriptionAuditEntries(result);
  elements.descriptionAuditModalTitle.textContent = result?.name || "Product descriptions";
  elements.descriptionAuditModalBody.innerHTML = "";

  if (!entries.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "description-audit-empty";
    emptyState.textContent = "No AI-generated descriptions are stored for the matching images on this card.";
    elements.descriptionAuditModalBody.appendChild(emptyState);
  } else {
    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "rules-card description-audit-entry";

      const header = document.createElement("div");
      header.className = "description-audit-entry-header";

      const filename = document.createElement("p");
      filename.className = "description-audit-filename";
      filename.textContent = entry.filename;
      header.appendChild(filename);

      if (entry.isHero) {
        const heroBadge = document.createElement("span");
        heroBadge.className = "description-audit-badge";
        heroBadge.textContent = "Hero image";
        header.appendChild(heroBadge);
      }

      card.appendChild(header);

      const structuredField = document.createElement("div");
      structuredField.className = "description-audit-field";
      const structuredLabel = document.createElement("p");
      structuredLabel.className = "description-audit-label";
      structuredLabel.textContent = "Structured caption";
      const structuredValue = document.createElement("p");
      structuredValue.className = entry.structuredCaption ? "description-audit-description" : "description-audit-empty";
      structuredValue.textContent = entry.structuredCaption || "Not available.";
      structuredField.append(structuredLabel, structuredValue);
      card.appendChild(structuredField);

      const summaryField = document.createElement("div");
      summaryField.className = "description-audit-field";
      const summaryLabel = document.createElement("p");
      summaryLabel.className = "description-audit-label";
      summaryLabel.textContent = "Visual summary";
      const summaryValue = document.createElement("p");
      summaryValue.className = entry.visualSummary ? "description-audit-description" : "description-audit-empty";
      summaryValue.textContent = entry.visualSummary || "Not available.";
      summaryField.append(summaryLabel, summaryValue);
      card.appendChild(summaryField);

      elements.descriptionAuditModalBody.appendChild(card);
    });
  }

  elements.descriptionAuditModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDescriptionAuditModal() {
  if (!elements.descriptionAuditModal) {
    return;
  }
  elements.descriptionAuditModal.hidden = true;
  if (!hasOpenModalShell()) {
    document.body.classList.remove("modal-open");
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
      visualType: String(
        getPayloadVisualType(heroImage) ||
        getPayloadVisualType(result.debug?.stage1) ||
        state.currentVisualType ||
        ""
      ).trim(),
      enumFields: heroImage.enum_fields || result.debug?.image_traits || {},
      traitContributions: heroImage.trait_contributions || result.debug?.trait_contributions || {},
      matchedTraits: heroImage.matched_traits || result.matched_traits || [],
      scoreBreakdown: breakdown
    });
  });

  return rows;
}

function getDebugScoreFields(selectedBullets = state.currentSelectedBullets) {
  const activeTypeKey = String(state.currentVisualType || "").trim();
  const normalized = normalizeSelectedBullets(selectedBullets, activeTypeKey);
  const orderedSchemaFields = getOrderedSchemaFieldsForType(activeTypeKey);
  const selectedFieldSet = new Set();

  [...normalized.essential, ...normalized.normal, ...normalized.low].forEach((bullet) => {
    const parsed = parseStructuredBulletEntry(bullet, "normal", activeTypeKey);
    if (parsed?.field) {
      selectedFieldSet.add(parsed.field);
    }
  });

  if (!selectedFieldSet.size) {
    return orderedSchemaFields;
  }

  return orderedSchemaFields.filter((field) => selectedFieldSet.has(field));
}

function formatDebugImageCategory(image = {}) {
  const stage0 = String(image.stage_0_result || "").trim();
  const effectiveClassification = String(image.effective_classification || "").trim();
  const visualType = String(
    getPayloadVisualType(image) ||
    getPayloadVisualType(image.stage1) ||
    ""
  ).trim();
  const rawLabel = stage0 || "unknown";
  const effectiveLabel = effectiveClassification || rawLabel;
  const parts = [
    `raw: ${rawLabel}`,
    `effective: ${effectiveLabel}`
  ];

  if (visualType) {
    parts.push(`visual type: ${formatVisualTypeLabel(visualType, state.bootstrap)}`);
  }

  return parts.join(" | ");
}

async function fetchDebugPayload() {
  const sourceImageUrl = state.currentImageAnalysis?.image_preview_url || "";
  const searchCategoryFilter = [];
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
        category: searchCategoryFilter,
        refresh_age: String(state.refreshAgeFilter || "").trim(),
        source_image_url: String(sourceImageUrl || "").trim(),
        visual_type: state.currentVisualType,
        reranker_enabled: false,
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
      category: searchCategoryFilter,
      refresh_age: state.refreshAgeFilter,
      visual_type: state.currentVisualType,
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
  const debugTypeKey = String(state.currentVisualType || rows[0]?.visualType || "").trim();
  const queryBulletMap = buildQueryBulletMap(state.currentSelectedBullets, debugTypeKey);
  const debugScoreFields = getDebugScoreFields(state.currentSelectedBullets);
  const debugTraitGroups = getDebugTraitGroupsForType(debugTypeKey, debugScoreFields);
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
      const detail = row.traitContributions?.[field] || null;
      const storedValue = String(detail?.stored_value || row.enumFields?.[field] || "").trim();
      const contributionValue = Number(detail?.contribution || 0);
      const contributionState = String(detail?.state || (queryEntry ? "miss" : "neutral")).trim();
      columnTotals.set(field, Number((columnTotals.get(field) + contributionValue).toFixed(3)));

      if (!queryEntry) {
        td.className = "debug-score-cell-neutral";
        const value = document.createElement("span");
        value.className = "debug-score-cell-empty";
        value.textContent = "";
        const meta = document.createElement("span");
        meta.className = "debug-score-cell-meta";
        meta.textContent = "0";
        td.append(value, meta);
      } else if (contributionState === "hit") {
        td.className = "debug-score-cell-hit";
        const value = document.createElement("span");
        value.className = "debug-score-cell-value";
        value.textContent = storedValue;
        const meta = document.createElement("span");
        meta.className = "debug-score-cell-meta";
        meta.textContent = formatContribution(contributionValue);
        td.append(value, meta);
      } else {
        td.className = "debug-score-cell-miss";
        const value = document.createElement("span");
        value.className = "debug-score-cell-value";
        value.textContent = storedValue || "unknown";
        const meta = document.createElement("span");
        meta.className = "debug-score-cell-meta";
        meta.textContent = contributionState === "near-miss"
          ? `near ${formatContribution(contributionValue)}`
          : formatContribution(contributionValue);
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
  const debugTypeKey = String(state.currentVisualType || rows[0]?.visualType || "").trim();
  const queryBulletMap = buildQueryBulletMap(state.currentSelectedBullets, debugTypeKey);
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
        const detail = row.traitContributions?.[field] || null;
        const storedValue = String(detail?.stored_value || row.enumFields?.[field] || "").trim();
        const contributionValue = Number(detail?.contribution || 0);
        const contributionState = String(detail?.state || (queryEntry ? "miss" : "neutral")).trim();
        if (!storedValue && !queryEntry) {
          return "";
        }
        if (!storedValue) {
          return `unknown (${contributionState === "near-miss" ? `near ${formatContribution(contributionValue)}` : formatContribution(contributionValue)})`;
        }
        return `${storedValue} (${contributionState === "near-miss" ? `near ${formatContribution(contributionValue)}` : formatContribution(contributionValue)})`;
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

function normalizeSelectedBullets(selectedBullets = [], typeKey = state.currentVisualType) {
  if (Array.isArray(selectedBullets)) {
    const normalized = { essential: [], normal: [], low: [] };
    normalizePriorityBulletList(selectedBullets).forEach((bullet) => {
      const filtered = stripCategoryScopeFromSelectedBullets({
        normal: [bullet]
      }).normal[0];
      if (filtered) {
        normalized[defaultPriorityForBulletText(filtered, typeKey)].push(filtered);
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

  let text = "";
  for (const node of elements.searchInput.childNodes) {
    if (node === elements.clearSearchInputButton) {
      continue;
    }
    text += String(node.textContent || "");
  }

  return String(text)
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
  updateSearchComposerClearButton();
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
    if (node === elements.clearSearchInputButton) {
      continue;
    }
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

function updateSearchComposerClearButton() {
  if (!elements.clearSearchInputButton || !elements.searchInput) {
    return;
  }
  const hasComposableContent = hasSearchComposerClearableContent(getSearchComposerTextParts());
  const hasActiveSubmittedSearch = Boolean(String(state.lastQuery || "").trim());
  const shouldShow = hasActiveSubmittedSearch && !state.searchInputEditedSinceLastSearch && hasComposableContent;
  elements.clearSearchInputButton.hidden = !shouldShow;
  if (!shouldShow) {
    if (elements.clearSearchInputButton.parentNode === elements.searchInput) {
      elements.clearSearchInputButton.remove();
    }
    return;
  }
  if (elements.clearSearchInputButton.parentNode !== elements.searchInput) {
    elements.searchInput.appendChild(elements.clearSearchInputButton);
  }
}

function focusSearchComposerAtEnd() {
  if (!elements.searchInput) {
    return;
  }
  elements.searchInput.focus();
  const selection = window.getSelection?.();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(elements.searchInput);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearSearchComposer() {
  state.searchInputEditedSinceLastSearch = true;
  state.categorySelectionTouchedSinceLastSearch = false;
  state.resultCategoryScope = ["all"];
  state.categoryScopeMode = "all";
  setSearchInputValue("");
  renderSearchComposer("");
  updateCategoryRequirement(null);
  state.clarificationConflict = null;
  state.inlineRefinementPanel = null;
  closeInlineRefinementPanel();
  syncSearchPageUrl();
  focusSearchComposerAtEnd();
}

function shouldReturnHomeAfterClearingQuery() {
  return Boolean(
    String(state.lastQuery || "").trim() ||
    (Array.isArray(state.lastPayload?.results) && state.lastPayload.results.length)
  );
}

function isQueryComposableBullet(bullet = "") {
  return Boolean(parseStructuredBulletEntry(bullet) || bullet);
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
  if (fieldConfig && !isInlineRefinementDetectabilityEligible(fieldConfig.detectability)) {
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
        value: formatFrontendTraitValue(normalizedField, value),
        text: `${formatInlineRefinementFieldLabel(normalizedField, typeKey)}: ${formatFrontendTraitValue(normalizedField, value)}`,
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
  const requestHomePath = typeof HOME_PATH === "string" && HOME_PATH ? HOME_PATH : window.location.pathname || "/";
  const mergedOptions = {
    cache: "no-store",
    ...options,
    headers: {
      ...(options?.headers || {}),
      "Cache-Control": "no-store",
      "X-PixelSeek-Home-Path": requestHomePath
    }
  };
  let response;
  try {
    response = await fetch(requestUrl, mergedOptions);
  } catch (error) {
    throw new Error("Failed to reach the server. Refresh the page and try again.");
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

async function fetchJsonStream(url, options, handlers = {}) {
  const requestUrl = apiUrl(url);
  const requestHomePath = typeof HOME_PATH === "string" && HOME_PATH ? HOME_PATH : window.location.pathname || "/";
  const mergedOptions = {
    cache: "no-store",
    ...options,
    headers: {
      ...(options?.headers || {}),
      "Cache-Control": "no-store",
      "X-PixelSeek-Home-Path": requestHomePath,
      "X-PixelSeek-Stream": "1"
    }
  };
  let response;
  try {
    response = await fetch(requestUrl, mergedOptions);
  } catch (error) {
    throw new Error("Failed to reach the server. Refresh the page and try again.");
  }

  if (!response.ok) {
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = null;
    }
    throw new Error(payload?.error || `Request failed (${response.status}): ${responseText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Server returned an empty streamed response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (rawLine) {
        const event = JSON.parse(rawLine);
        if (event?.type === "progress" && typeof handlers.onProgress === "function") {
          handlers.onProgress(event);
        } else if (event?.type === "result") {
          finalPayload = event.payload;
        } else if (event?.type === "error") {
          throw new Error(event.error || "Request failed");
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const event = JSON.parse(trailing);
    if (event?.type === "progress" && typeof handlers.onProgress === "function") {
      handlers.onProgress(event);
    } else if (event?.type === "result") {
      finalPayload = event.payload;
    } else if (event?.type === "error") {
      throw new Error(event.error || "Request failed");
    }
  }

  if (finalPayload == null) {
    throw new Error("Server returned an incomplete streamed response.");
  }

  return finalPayload;
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

async function fetchPromptLibrary() {
  return fetchJson("/api/prompt-library");
}

async function updateUnmappedCategoryDecision(grouping = "", status = "active", mappingTarget = "") {
  return fetchJson("/api/unmapped-category-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grouping,
      status,
      mapping_target: mappingTarget
    })
  });
}

function formatSummaryMetric(count = 0, total = 0) {
  const normalizedTotal = Number(total) || 0;
  const normalizedCount = Number(count) || 0;
  const rate = normalizedTotal > 0 ? `${((normalizedCount / normalizedTotal) * 100).toFixed(1)}%` : "0.0%";
  return `${normalizedCount.toLocaleString()} of ${normalizedTotal.toLocaleString()} images (${rate})`;
}

function formatTraitHealthCardText(traitHealth = {}) {
  const issueCount = Number(traitHealth.issue_count) || 0;
  const checkedTraitCount = Number(traitHealth.checked_trait_count) || 0;
  if (!issueCount) {
    return "All traits healthy";
  }
  return `${issueCount.toLocaleString()} issue${issueCount === 1 ? "" : "s"} across ${checkedTraitCount.toLocaleString()} type×trait combinations`;
}

function formatTraitHealthStatus(category = {}) {
  if (!category?.has_trait_health) {
    return "—";
  }
  const issueCount = Number(category?.trait_health?.issue_count) || 0;
  return issueCount
    ? `⚠ ${issueCount} issue${issueCount === 1 ? "" : "s"}`
    : "✓ healthy";
}

function formatTraitDeltaText(trait = {}) {
  if (!trait?.dropped_vs_previous || trait?.delta_percent === null || trait?.delta_percent === undefined) {
    return "";
  }
  return `(${trait.delta_percent > 0 ? "+" : ""}${trait.delta_percent}% vs last run)`;
}

function formatSupplementalTraitMetrics(trait = {}) {
  return (Array.isArray(trait?.supplemental_metrics) ? trait.supplemental_metrics : [])
    .filter((metric) => Number(metric?.total_count || 0) > 0)
    .map((metric) => `${metric.label} ${Number(metric.coverage_percent || 0)}%`);
}

function getSupplementalTraitDisplay(trait = {}) {
  const supplemental = Array.isArray(trait?.supplemental_metrics) ? trait.supplemental_metrics : [];

  if (trait?.field === "back_finish") {
    const benchWithBacksMetric = supplemental.find((metric) => metric?.key === "bench_with_backs");
    if (benchWithBacksMetric && Number(benchWithBacksMetric.total_count || 0) > 0) {
      return {
        lead: `${Number(benchWithBacksMetric.coverage_percent || 0)}% on benches with backs`,
        context: `${Number(trait.coverage_percent || 0)}% across all benches`
      };
    }
    const loungeWithBacksMetric = supplemental.find((metric) => metric?.key === "lounge_with_backs");
    if (loungeWithBacksMetric && Number(loungeWithBacksMetric.total_count || 0) > 0) {
      return {
        lead: `${Number(loungeWithBacksMetric.coverage_percent || 0)}% on lounge pieces with backs`,
        context: `${Number(trait.coverage_percent || 0)}% across all lounge seating`
      };
    }
  }

  if (trait?.field === "back_height") {
    const loungeWithBacksMetric = supplemental.find((metric) => metric?.key === "lounge_with_backs");
    if (loungeWithBacksMetric && Number(loungeWithBacksMetric.total_count || 0) > 0) {
      return {
        lead: `${Number(loungeWithBacksMetric.coverage_percent || 0)}% on lounge pieces with backs`,
        context: `${Number(trait.coverage_percent || 0)}% across all lounge seating`
      };
    }
  }

  if (trait?.field === "base_finish") {
    const loungeWithDiscreteBasesMetric = supplemental.find((metric) => metric?.key === "lounge_with_discrete_bases");
    if (loungeWithDiscreteBasesMetric && Number(loungeWithDiscreteBasesMetric.total_count || 0) > 0) {
      return {
        lead: `${Number(loungeWithDiscreteBasesMetric.coverage_percent || 0)}% on lounge pieces with discrete bases`,
        context: `${Number(trait.coverage_percent || 0)}% across all lounge seating`
      };
    }
  }

  const supplementalMetrics = formatSupplementalTraitMetrics(trait);
  if (supplementalMetrics.length) {
    return {
      lead: `${Number(trait.coverage_percent || 0)}%`,
      context: supplementalMetrics.join(" | ")
    };
  }

  return {
    lead: `${Number(trait.coverage_percent || 0)}%`,
    context: ""
  };
}

function formatSupplementalTraitText(trait = {}) {
  const display = getSupplementalTraitDisplay(trait);
  return display.context ? `${display.lead} (${display.context})` : display.lead;
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
  const traitHealth = summary.trait_health && typeof summary.trait_health === "object"
    ? summary.trait_health
    : {};
  const baselineAvailable = Boolean(traitHealth.baseline_available);
  const complianceViolations = Array.isArray(summary.schema_compliance_violations)
    ? summary.schema_compliance_violations
    : [];
  const logicalInconsistencies = Array.isArray(summary.logical_inconsistencies)
    ? summary.logical_inconsistencies
    : [];
  const imageExtractionFailures = Array.isArray(summary.image_extraction_failures)
    ? summary.image_extraction_failures
    : [];
  const unmapped = summary.unmapped_combinations && typeof summary.unmapped_combinations === "object"
    ? summary.unmapped_combinations
    : { active: [], resolved: [] };
  const activeUnmapped = Array.isArray(unmapped.active) ? unmapped.active : [];
  const resolvedUnmapped = Array.isArray(unmapped.resolved) ? unmapped.resolved : [];
  const loungeSofaTraitStage = summary.lounge_sofa_trait_stage && typeof summary.lounge_sofa_trait_stage === "object"
    ? summary.lounge_sofa_trait_stage
    : null;

  const cards = [
    {
      title: "Tiebreakers triggered",
      value: formatSummaryMetric(summary.tiebreakers_triggered, totalImages)
    },
    {
      title: "Trait health",
      value: formatTraitHealthCardText(traitHealth)
    }
  ];
  if (loungeSofaTraitStage) {
    const extractedCount = Number(loungeSofaTraitStage.extracted_image_count || 0);
    const notApplicableCount = Number(loungeSofaTraitStage.not_applicable_image_count || 0);
    const failedCount = Number(loungeSofaTraitStage.failed_image_count || 0);
    const eligibleCount = Number(loungeSofaTraitStage.eligible_image_count || 0);
    cards.push({
      title: "Lounge sofa trait stage",
      value: `${extractedCount.toLocaleString()} extracted • ${notApplicableCount.toLocaleString()} n/a • ${failedCount.toLocaleString()} failed (${eligibleCount.toLocaleString()} in scope) • $${Number(loungeSofaTraitStage.estimated_total_cost_usd || 0).toFixed(3)}`
    });
  }

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
  tableTitle.textContent = "By visual type";

  const tableMeta = document.createElement("p");
  tableMeta.className = "rules-summary-intro";
  const coverageThreshold = Math.round((Number(traitHealth.coverage_threshold) || 0) * 100);
  const dropThreshold = Math.round((Number(traitHealth.drop_threshold) || 0) * 100);
  const timestampText = generatedAt
    ? `Latest snapshot: ${new Date(generatedAt).toLocaleString()}.`
    : "Latest snapshot unavailable.";
  const deltaText = baselineAvailable
    ? ` Traits are flagged below ${coverageThreshold}% coverage or after a ${dropThreshold}%+ drop vs the saved baseline.`
    : ` Traits are flagged below ${coverageThreshold}% coverage. Delta flags will appear once a baseline snapshot is saved.`;
  tableMeta.textContent = `${timestampText}${deltaText}`;

  const tableWrap = document.createElement("div");
  tableWrap.className = "extraction-summary-table-wrap";

  const table = document.createElement("table");
  table.className = "extraction-summary-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Visual type</th>
        <th>Images</th>
        <th>Tiebreakers</th>
        <th>Trait health</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  categories.forEach((entry) => {
    const categoryKey = String(entry.category_key || "").trim();
    const expandable = Boolean(entry.has_trait_health);
    const expanded = expandable && state.extractionSummaryExpandedRows.has(categoryKey);
    const fullExpanded = expandable && state.extractionSummaryFullRows.has(categoryKey);
    const issueTraits = (Array.isArray(entry?.trait_health?.traits) ? entry.trait_health.traits : [])
      .filter((trait) => trait.issue);
    const healthyTraits = (Array.isArray(entry?.trait_health?.traits) ? entry.trait_health.traits : [])
      .filter((trait) => !trait.issue)
      .sort((left, right) => left.field.localeCompare(right.field));

    const tr = document.createElement("tr");
    tr.className = expandable ? "extraction-summary-row is-expandable" : "extraction-summary-row";
    if (expandable) {
      tr.setAttribute("role", "button");
      tr.tabIndex = 0;
      tr.setAttribute("aria-expanded", expanded ? "true" : "false");
      const toggleExpanded = () => {
        if (state.extractionSummaryExpandedRows.has(categoryKey)) {
          state.extractionSummaryExpandedRows.delete(categoryKey);
          state.extractionSummaryFullRows.delete(categoryKey);
        } else {
          state.extractionSummaryExpandedRows.add(categoryKey);
        }
        renderExtractionSummary();
      };
      tr.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(".extraction-summary-breakdown-toggle")) {
          return;
        }
        toggleExpanded();
      });
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleExpanded();
        }
      });
    }

    const categoryCell = document.createElement("td");
    categoryCell.className = "extraction-summary-category-cell";
    if (expandable) {
      const indicator = document.createElement("span");
      indicator.className = "extraction-summary-row-indicator";
      indicator.textContent = expanded ? "▾" : "▸";
      indicator.setAttribute("aria-hidden", "true");
      categoryCell.appendChild(indicator);
    }
    const categoryLabel = document.createElement("span");
    categoryLabel.textContent = formatVisualTypeLabel(categoryKey);
    categoryCell.appendChild(categoryLabel);

    const imagesCell = document.createElement("td");
    imagesCell.className = "extraction-summary-number-cell";
    imagesCell.textContent = `${(Number(entry.total_images) || 0).toLocaleString()}`;

    const tiebreakerCell = document.createElement("td");
    tiebreakerCell.className = "extraction-summary-number-cell";
    tiebreakerCell.textContent = `${(Number(entry.tiebreakers_triggered) || 0).toLocaleString()}`;

    const healthCell = document.createElement("td");
    const healthStatus = formatTraitHealthStatus(entry);
    healthCell.className = healthStatus.startsWith("⚠")
      ? "extraction-summary-health-cell is-warning"
      : "extraction-summary-health-cell";
    healthCell.textContent = healthStatus;

    tr.append(categoryCell, imagesCell, tiebreakerCell, healthCell);
    tbody.appendChild(tr);

    if (expanded) {
      const detailRow = document.createElement("tr");
      detailRow.className = "extraction-summary-detail-row";
      const detailCell = document.createElement("td");
      detailCell.colSpan = 4;

      const detailPanel = document.createElement("div");
      detailPanel.className = "extraction-summary-detail-panel";

      if (!issueTraits.length) {
        const healthyLine = document.createElement("div");
        healthyLine.className = "extraction-summary-trait-line";
        healthyLine.textContent = `All ${(Array.isArray(entry?.trait_health?.traits) ? entry.trait_health.traits.length : 0).toLocaleString()} traits above ${coverageThreshold}%`;
        detailPanel.appendChild(healthyLine);
      } else {
        issueTraits.forEach((trait) => {
          const line = document.createElement("div");
          line.className = "extraction-summary-trait-line";

          const label = document.createElement("span");
          label.className = "extraction-summary-trait-name";
          label.textContent = trait.field;

          const display = getSupplementalTraitDisplay(trait);
          const valueWrap = document.createElement("span");
          valueWrap.className = "extraction-summary-trait-value-wrap";
          if (display.context) {
            valueWrap.classList.add("has-context");
          }

          const value = document.createElement("span");
          const severityClass = Number(trait.coverage_rate) < 0.5
            ? "extraction-summary-trait-value is-severe"
            : "extraction-summary-trait-value is-warning";
          value.className = display.context
            ? "extraction-summary-trait-value is-applicable-strong"
            : severityClass;
          value.textContent = display.lead;
          valueWrap.appendChild(value);

          if (display.context) {
            const context = document.createElement("span");
            context.className = "extraction-summary-trait-context";
            context.textContent = `(${display.context})`;
            valueWrap.appendChild(context);
          }

          const deltaTextValue = formatTraitDeltaText(trait);
          if (deltaTextValue) {
            const delta = document.createElement("span");
            delta.className = "extraction-summary-trait-delta";
            delta.textContent = deltaTextValue;
            valueWrap.appendChild(delta);
          }

          line.append(label, valueWrap);
          detailPanel.appendChild(line);
        });
      }

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "extraction-summary-breakdown-toggle";
      toggleButton.textContent = fullExpanded ? "Hide full breakdown ‹" : "Show full breakdown ›";
      toggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.extractionSummaryFullRows.has(categoryKey)) {
          state.extractionSummaryFullRows.delete(categoryKey);
        } else {
          state.extractionSummaryFullRows.add(categoryKey);
          state.extractionSummaryExpandedRows.add(categoryKey);
        }
        renderExtractionSummary();
      });
      detailPanel.appendChild(toggleButton);

      if (fullExpanded) {
        const divider = document.createElement("div");
        divider.className = "extraction-summary-divider";
        detailPanel.appendChild(divider);

        healthyTraits.forEach((trait) => {
          const line = document.createElement("div");
          line.className = "extraction-summary-trait-line is-quiet";

          const label = document.createElement("span");
          label.className = "extraction-summary-trait-name";
          label.textContent = trait.field;

          const display = getSupplementalTraitDisplay(trait);
          const valueWrap = document.createElement("span");
          valueWrap.className = "extraction-summary-trait-value-wrap";
          if (display.context) {
            valueWrap.classList.add("has-context");
          }

          const value = document.createElement("span");
          value.className = display.context
            ? "extraction-summary-trait-value is-applicable-strong"
            : "extraction-summary-trait-value";
          value.textContent = display.lead;
          valueWrap.appendChild(value);

          if (display.context) {
            const context = document.createElement("span");
            context.className = "extraction-summary-trait-context";
            context.textContent = `(${display.context})`;
            valueWrap.appendChild(context);
          }

          const deltaTextValue = formatTraitDeltaText(trait);
          if (deltaTextValue) {
            const delta = document.createElement("span");
            delta.className = "extraction-summary-trait-delta";
            delta.textContent = deltaTextValue;
            valueWrap.appendChild(delta);
          }

          line.append(label, valueWrap);
          detailPanel.appendChild(line);
        });
      }

      detailCell.appendChild(detailPanel);
      detailRow.appendChild(detailCell);
      tbody.appendChild(detailRow);
    }
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  tableCard.append(tableTitle, tableMeta, tableWrap);

  const traitIssuesCard = document.createElement("article");
  traitIssuesCard.className = "rules-card extraction-summary-table-card";

  const traitIssuesTitle = document.createElement("h3");
  traitIssuesTitle.className = "rules-card-title";
  traitIssuesTitle.textContent = "Trait issues";

  const traitIssuesIntro = document.createElement("p");
  traitIssuesIntro.className = "rules-summary-intro";
  traitIssuesIntro.textContent = "Coverage health counts only schema-valid values that are neither missing nor \"unknown\".";

  const renderIssueSection = (titleText, issues = [], formatter) => {
    const section = document.createElement("section");
    section.className = "extraction-summary-unmapped-section";

    const title = document.createElement("h4");
    title.className = "rules-card-title";
    title.textContent = titleText;
    section.appendChild(title);

    if (!issues.length) {
      const empty = document.createElement("p");
      empty.className = "rules-summary-intro";
      if (titleText === "Schema compliance violations") {
        empty.textContent = "No compliance issues.";
      } else if (titleText === "Image extraction failures") {
        empty.textContent = "No image extraction failures recorded.";
      } else {
        empty.textContent = "No logical inconsistencies.";
      }
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement("ul");
    list.className = "rules-card-list";
    issues.forEach((issue) => {
      const item = document.createElement("li");
      item.textContent = formatter(issue);
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
  };

  traitIssuesCard.append(
    traitIssuesTitle,
    traitIssuesIntro,
    renderIssueSection(
      "Schema compliance violations",
      complianceViolations,
      (issue) => `${issue.product_name || issue.product_id || "Unknown product"} — ${issue.field}: ${issue.value}`
    ),
    renderIssueSection(
      "Logical inconsistencies",
      logicalInconsistencies,
      (issue) => `${issue.product_name || issue.product_id || "Unknown product"} — ${issue.issue}`
    ),
    renderIssueSection(
      "Image extraction failures",
      imageExtractionFailures,
      (issue) => `${issue.product_name || issue.product_id || "Unknown product"} — ${issue.failed_image_count} failed image${Number(issue.failed_image_count) === 1 ? "" : "s"} (${issue.successful_extraction_count}/${issue.stage0_passing_count} product images extracted)`
    )
  );

  const unmappedCard = document.createElement("article");
  unmappedCard.className = "rules-card extraction-summary-table-card";

  const unmappedTitle = document.createElement("h3");
  unmappedTitle.className = "rules-card-title";
  unmappedTitle.textContent = "Unmapped DP category combinations";

  const unmappedIntro = document.createElement("p");
  unmappedIntro.className = "rules-summary-intro";
  unmappedIntro.textContent = activeUnmapped.length
    ? `${activeUnmapped.length} active combinations need a routing decision.`
    : "No active unmapped combinations.";

  unmappedCard.append(unmappedTitle, unmappedIntro);

  const mappingOptions = Object.entries(getVisualTypeDisplayNameMap(state.bootstrap))
    .sort((left, right) => left[1].localeCompare(right[1]));

  const renderUnmappedSection = (titleText, entries = [], resolved = false) => {
    const section = document.createElement("section");
    section.className = "extraction-summary-unmapped-section";

    const title = document.createElement("h4");
    title.className = "rules-card-title";
    title.textContent = titleText;
    section.appendChild(title);

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "rules-summary-intro";
      empty.textContent = resolved
        ? "No resolved combinations yet."
        : "No active combinations.";
      section.appendChild(empty);
      return section;
    }

    entries.forEach((entry) => {
      const block = document.createElement("div");
      block.className = "batch-refresh-unmapped-block";

      const heading = document.createElement("div");
      heading.className = "batch-refresh-unmapped-heading";
      const firstSeen = entry.first_seen_at
        ? ` • first seen ${new Date(entry.first_seen_at).toLocaleString()}`
        : "";
      const statusSuffix = resolved
        ? ` • ${entry.status === "mapped"
          ? `mapped to ${formatVisualTypeLabel(entry.mapping_target || "")}`
          : "intentionally excluded"}`
        : "";
      heading.textContent = `${entry.grouping} — ${Number(entry.count || 0)} ${Number(entry.count || 0) === 1 ? "product" : "products"}${firstSeen}${statusSuffix}`;
      block.appendChild(heading);

      const list = document.createElement("ul");
      list.className = "batch-refresh-unmapped-products";
      (Array.isArray(entry.products) ? entry.products : []).forEach((product) => {
        const item = document.createElement("li");
        item.textContent = `${product.name || "Unknown product"} (${product.product_id || "unknown"})`;
        list.appendChild(item);
      });
      block.appendChild(list);

      if (!resolved) {
        const actions = document.createElement("div");
        actions.className = "batch-refresh-failure-totals";

        const select = document.createElement("select");
        mappingOptions.forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        });

        const mapButton = document.createElement("button");
        mapButton.type = "button";
        mapButton.className = "rules-summary-button";
        mapButton.textContent = "Add mapping";
        mapButton.addEventListener("click", async () => {
          try {
            const payload = await updateUnmappedCategoryDecision(entry.grouping, "mapped", select.value);
            state.extractionSummary = payload.extraction_summary || state.extractionSummary;
            renderExtractionSummary();
            setStatus(`Mapped ${entry.grouping} to ${formatVisualTypeLabel(select.value)}.`, "info");
          } catch (error) {
            setStatus(error.message || "Failed to store mapping decision.", "error");
          }
        });

        const excludeButton = document.createElement("button");
        excludeButton.type = "button";
        excludeButton.className = "rules-summary-button";
        excludeButton.textContent = "Mark intentionally excluded";
        excludeButton.addEventListener("click", async () => {
          try {
            const payload = await updateUnmappedCategoryDecision(entry.grouping, "intentionally_excluded");
            state.extractionSummary = payload.extraction_summary || state.extractionSummary;
            renderExtractionSummary();
            setStatus(`Marked ${entry.grouping} as intentionally excluded.`, "info");
          } catch (error) {
            setStatus(error.message || "Failed to store exclusion decision.", "error");
          }
        });

        actions.append(select, mapButton, excludeButton);
        block.appendChild(actions);
      }

      section.appendChild(block);
    });

    return section;
  };

  unmappedCard.append(
    renderUnmappedSection("Needs decision", activeUnmapped, false),
    renderUnmappedSection("Resolved", resolvedUnmapped, true)
  );

  elements.extractionSummaryContent.innerHTML = "";
  elements.extractionSummaryContent.append(wrapper, tableCard, traitIssuesCard, unmappedCard);
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
    failedUnmapped: Math.max(0, Number(payload.failed_unmapped) || 0),
    failedOther: Math.max(0, Number(payload.failed_other) || 0),
    left,
    batchCurrent,
    batchTotal,
    currentProductName: String(payload.current_product || "").trim(),
    currentImageUrl: String(payload.current_image_url || "").trim(),
    currentProductImagesPassed: Math.max(0, Number(payload.current_product_images_passed) || 0),
    currentProductSuccessfulExtractions: Math.max(0, Number(payload.current_product_successful_extractions) || 0),
    currentProductFailedImages: Math.max(0, Number(payload.current_product_failed_images) || 0),
    currentRun: String(payload.current_run || "").trim(),
    processedImages,
    productPhotos,
    scenePhotos,
    detailPhotos,
    unclassifiedPhotos,
    totalCostUsd: Math.max(0, Number(payload.total_cost_usd) || 0),
    log: Array.isArray(payload.log) ? payload.log.slice(0, 8) : [],
    failedProducts: Array.isArray(payload.failed_products) ? payload.failed_products : [],
    unmappedGroupings: Array.isArray(payload.unmapped_groupings) ? payload.unmapped_groupings : []
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
    elements.batchRefreshImagesPassed.hidden = false;
    elements.batchRefreshImagesPassed.textContent = isComplete
      ? "Current product image counts: complete"
      : `Current product image counts: Stage 0 passed ${progress.currentProductImagesPassed} • Extracted ${progress.currentProductSuccessfulExtractions} • Failed ${progress.currentProductFailedImages}`;
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
      const extractionStats = typeof entry.successful_extraction_count === "number"
        ? ` • extracted ${entry.successful_extraction_count}`
        : "";
      const failureStats = typeof entry.failed_image_count === "number" && entry.failed_image_count > 0
        ? ` • failed images ${entry.failed_image_count}`
        : "";
      item.textContent = `✓ ${entry.name || entry.product_id || "Unknown product"}${typeLabel}${extractionStats}${failureStats}`;
    }
    elements.batchRefreshLog.appendChild(item);
  });

  const failedProducts = progress.failedProducts.filter((entry) => entry?.name);
  const unmappedGroupings = progress.unmappedGroupings.filter((entry) => entry?.grouping);
  elements.batchRefreshFailures.hidden = !isComplete || (!failedProducts.length && !unmappedGroupings.length);
  elements.batchRefreshFailures.innerHTML = "";
  if (!elements.batchRefreshFailures.hidden) {
    const totals = document.createElement("div");
    totals.className = "batch-refresh-failure-totals";
    totals.textContent = `Total successful: ${progress.succeeded} products | Total failed (unmapped): ${progress.failedUnmapped} products | Total failed (other): ${progress.failedOther} products`;
    elements.batchRefreshFailures.appendChild(totals);

    if (unmappedGroupings.length) {
      const unmappedTitle = document.createElement("div");
      unmappedTitle.className = "batch-refresh-failure-heading";
      unmappedTitle.textContent = "Unmapped DP category combinations";
      elements.batchRefreshFailures.appendChild(unmappedTitle);

      unmappedGroupings.forEach((entry) => {
        const block = document.createElement("div");
        block.className = "batch-refresh-unmapped-block";

        const heading = document.createElement("div");
        heading.className = "batch-refresh-unmapped-heading";
        heading.textContent = `${entry.grouping} — ${Number(entry.count || 0)} ${Number(entry.count || 0) === 1 ? "product" : "products"}`;
        block.appendChild(heading);

        const list = document.createElement("ul");
        list.className = "batch-refresh-unmapped-products";
        (Array.isArray(entry.products) ? entry.products : []).forEach((product) => {
          const item = document.createElement("li");
          item.textContent = `${product.name || "Unknown product"} (${product.product_id || "unknown"})`;
          list.appendChild(item);
        });
        block.appendChild(list);
        elements.batchRefreshFailures.appendChild(block);
      });
    }

    if (failedProducts.length) {
      const otherTitle = document.createElement("div");
      otherTitle.className = "batch-refresh-failure-heading";
      otherTitle.textContent = "Other failed products";
      elements.batchRefreshFailures.appendChild(otherTitle);

      const otherList = document.createElement("ul");
      otherList.className = "batch-refresh-unmapped-products";
      failedProducts
        .filter((entry) => !String(entry.error || "").startsWith("Unmapped DP category combination:"))
        .forEach((entry) => {
          const item = document.createElement("li");
          item.textContent = `${entry.name} (${entry.product_id || "unknown"})${entry.error ? ` — ${entry.error}` : ""}`;
          otherList.appendChild(item);
        });
      if (otherList.childNodes.length) {
        elements.batchRefreshFailures.appendChild(otherList);
      }
    }
  }
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
  visualType = state.currentVisualType,
  seatingType = "",
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
      category: [],
      refresh_age: String(refreshAgeFilter || "").trim(),
      source_image_url: String(sourceImageUrl || "").trim(),
      reranker_enabled: Boolean(rerankerEnabled),
      visual_type: String(visualType || seatingType || "").trim(),
      ...(action && productId ? { action, product_id: productId } : {})
    })
  });
}

function updateResetSearchVisibility() {
  if (!elements.resetSearchButton) {
    return;
  }
  const visibleResults = getVisibleResults(state.lastPayload, state.lastQuery);
  elements.resetSearchButton.hidden = !shouldShowResetSearchButton({
    landingOnlyMode: state.landingOnlyMode,
    isBrowseMode: isBrowsePayload(state.lastPayload, state.lastQuery),
    visibleResultCount: visibleResults.length
  });
}

function applyActiveSearchContext({
  payload,
  query,
  selectedBullets = { essential: [], normal: [], low: [] },
  bulletControls = [],
  baseQueryEmbedding = null,
  visualType = "",
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
  const resolvedVisualType = String(visualType || seatingType || "").trim();
  state.currentVisualType = resolvedVisualType.toLowerCase() === "all" ? "" : resolvedVisualType;
  state.categoryScopeMode = String(payload?.seating_type_source || "").trim() || (state.currentVisualType ? "explicit" : "all");
  state.searchInputEditedSinceLastSearch = false;
  state.categorySelectionTouchedSinceLastSearch = false;
  state.currentImageAnalysis = imageAnalysis && typeof imageAnalysis === "object" ? cloneValue(imageAnalysis) : null;
  updateCategoryRequirement(null);
  state.currentProductRefinements = normalizeProductRefinements(productRefinements);
  state.categoryFilter = normalizeCategoryFilter(categoryFilter);
  const resolvedSearchCategory = String(
    resolvedVisualType ||
    getPayloadVisualType(payload) ||
    getPayloadVisualType(payload?.parsed) ||
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
  if (!isBrowsePayload(payload, state.lastQuery)) {
    clearBrowseTraitFilters();
  }

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
    state.originalVisualType = resolvedVisualType.toLowerCase() === "all" ? "" : resolvedVisualType;
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
  syncBrowseCategoryControl(payload, query);
  renderBrowseTraitFilters(payload, query);
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
      visualType: state.currentVisualType,
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter
    });
    applyActiveSearchContext({
      payload,
      query,
      selectedBullets,
      bulletControls,
      baseQueryEmbedding,
      visualType: state.currentVisualType,
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
  const seatingTypes = getBootstrapRoutingTypes();
  const types = seatingTypes?.types;
  if (!types || !Object.keys(types).length) {
    return null;
  }

  const fieldIndex = getTraitFieldConfigIndex();
  const fallbackType = seatingTypes.default_type || "";
  const resolvedTypeKey = types[typeKey] ? typeKey : fallbackType;
  return fieldIndex.get(resolvedTypeKey)?.get(fieldName) || null;
}

function getFieldPriority(typeKey = "", fieldName = "") {
  const priority = String(getTraitFieldConfig(typeKey, fieldName)?.priority || "")
    .trim()
    .toLowerCase();
  return priority === "essential" || priority === "low" || priority === "normal"
    ? priority
    : "normal";
}

function getTypeFields(typeKey = "") {
  const seatingTypes = getBootstrapRoutingTypes();
  const types = seatingTypes?.types;
  if (!types || !Object.keys(types).length) {
    return [];
  }
  const fallbackType = seatingTypes.default_type || "";
  const resolvedTypeKey = types[typeKey] ? typeKey : fallbackType;
  return types[resolvedTypeKey]?.fields || [];
}

function getOrderedSchemaFieldsForType(typeKey = "") {
  const groups = { essential: [], normal: [], low: [] };
  getTypeFields(typeKey).forEach((fieldConfig) => {
    groups[getFieldPriority(typeKey, fieldConfig.field)].push(fieldConfig.field);
  });
  return [...groups.essential, ...groups.normal, ...groups.low];
}

function getDebugTraitGroupsForType(typeKey = "", fields = []) {
  const groupLabels = {
    essential: "Essential",
    normal: "Normal",
    low: "Low"
  };
  return ["essential", "normal", "low"]
    .map((priority) => ({
      label: groupLabels[priority],
      fields: fields.filter((field) => getFieldPriority(typeKey, field) === priority)
    }))
    .filter((group) => group.fields.length);
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
    ["seat_construction", "Seat Construction"],
    ["narrow_arms", "Arm Width"],
    ["arms_flush_with_back", "Arm Height"],
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
      return `${labels.get(field) || field.replace(/_/g, " ")}: ${formatFrontendTraitValue(field, normalized)}`;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function buildStoredImageSearchBullets(imageTraits = {}, typeKey = null) {
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

      return `${formatInlineRefinementFieldLabel(field, typeKey)}: ${formatFrontendTraitValue(field, normalizedValue)}`;
    })
    .filter(Boolean);
}

function buildStoredImageSearchContext(result = {}, matchingImage = null) {
  const source = matchingImage || {};
  const heroSource = result.hero_image || {};
  const visualType = String(
    getPayloadVisualType(source) ||
    getPayloadVisualType(heroSource) ||
    getPayloadVisualType(result.debug?.stage1) ||
    ""
  ).trim();
  const enumFields = source.enum_fields || heroSource.enum_fields || result.debug?.image_traits || {};
  const bulletTexts = buildStoredImageSearchBullets(enumFields, visualType);
  const fallbackMatchedTraits = Array.isArray(result.matched_traits)
    ? result.matched_traits.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const selectedBullets = normalizeSelectedBullets(
    bulletTexts.length ? bulletTexts : fallbackMatchedTraits,
    visualType
  );
  const bulletControls = normalizeBulletControls(
    [
      ...selectedBullets.essential.map((text) => ({ text, priority: "essential" })),
      ...selectedBullets.normal.map((text) => ({ text, priority: "normal" })),
      ...selectedBullets.low.map((text) => ({ text, priority: "low" }))
    ]
  );
  const query = String(
    source.visual_summary ||
    heroSource.visual_summary ||
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
    reference_image_mode: "stored",
    visual_type: visualType,
    seating_type: visualType,
    stage1: { visual_type: visualType || "", seating_type: visualType || "" },
    image_traits: enumFields,
    stage2: {
      visual_summary: source.visual_summary || heroSource.visual_summary || result.debug?.visual_description || ""
    }
  };

  return {
    query,
    embedding,
    selectedBullets,
    bulletControls,
    visualType,
    imageAnalysis
  };
}

function buildStoredImageContextCacheKey(result = {}, matchingImage = null) {
  return String(
    matchingImage?.image_id ||
    `${result.product_id || ""}::${matchingImage?.image_url || result.best_image_url || ""}`
  ).trim();
}

async function fetchStoredImageContext(result = {}, matchingImage = null) {
  const params = new URLSearchParams();
  const productId = String(result.product_id || "").trim();
  const imageId = String(matchingImage?.image_id || "").trim();
  if (productId) {
    params.set("product_id", productId);
  }
  if (imageId) {
    params.set("image_id", imageId);
  }
  if (!params.toString()) {
    return null;
  }
  return fetchJson(`/api/stored-image-context?${params.toString()}`);
}

async function ensureStoredImageContext(result = {}, matchingImage = null) {
  const cacheKey = buildStoredImageContextCacheKey(result, matchingImage);
  if (cacheKey && state.storedImageContextCache.has(cacheKey)) {
    return state.storedImageContextCache.get(cacheKey);
  }

  const fetched = await fetchStoredImageContext(result, matchingImage);
  const baseContext = buildStoredImageSearchContext(result, matchingImage);
  const fetchedVisualType = String(
    fetched?.visual_type ||
    fetched?.seating_type ||
    baseContext.visualType ||
    ""
  ).trim();
  const fetchedEnumFields = fetched?.enum_fields || baseContext.imageAnalysis?.image_traits || {};
  const fetchedBulletTexts = buildStoredImageSearchBullets(fetchedEnumFields, fetchedVisualType);
  const fetchedSelectedBullets = normalizeSelectedBullets(
    fetchedBulletTexts.length
      ? fetchedBulletTexts
      : [
          ...baseContext.selectedBullets.essential,
          ...baseContext.selectedBullets.normal,
          ...baseContext.selectedBullets.low
        ],
    fetchedVisualType
  );
  const fetchedBulletControls = normalizeBulletControls(
    [
      ...fetchedSelectedBullets.essential.map((text) => ({ text, priority: "essential" })),
      ...fetchedSelectedBullets.normal.map((text) => ({ text, priority: "normal" })),
      ...fetchedSelectedBullets.low.map((text) => ({ text, priority: "low" }))
    ]
  );
  const merged = fetched
    ? {
        ...baseContext,
        query: String(
          fetched.visual_summary ||
          fetched.structured_caption ||
          baseContext.query ||
          result.name ||
          "image search"
        ).trim(),
        embedding: normalizeClientEmbedding(fetched.visual_summary_embedding || []),
        selectedBullets: fetchedSelectedBullets,
        bulletControls: fetchedBulletControls,
        visualType: fetchedVisualType,
        imageAnalysis: {
          ...baseContext.imageAnalysis,
          image_preview_url: fetched.image_url || baseContext.imageAnalysis.image_preview_url || "",
          visual_type: fetchedVisualType,
          seating_type: fetchedVisualType,
          stage1: {
            visual_type: fetchedVisualType,
            seating_type: fetchedVisualType
          },
          image_traits: fetchedEnumFields,
          stage2: {
            visual_summary: String(
              fetched.visual_summary ||
              baseContext.imageAnalysis.stage2?.visual_summary ||
              ""
            ).trim()
          }
        }
      }
    : baseContext;

  if (cacheKey && merged) {
    state.storedImageContextCache.set(cacheKey, merged);
  }
  return merged;
}

async function applyStoredImageSearchContext(context = {}) {
  if (!Array.isArray(context.embedding) || !context.embedding.length) {
    setStatus("This image does not have a stored embedding yet.", "error");
    return;
  }

  setSearchInputValue(context.query);
  if (state.landingOnlyMode) {
    enterBrowseMode(context.query, {
      visual_type: context.visualType || ""
    });
  }

  state.focusArea = null;
  state.refinementLoading = true;
  setStatus("");
  setResultsLoading({
    mode: "quick",
    step: "search",
    percent: 42,
    indeterminate: true,
    title: "Opening image results...",
    detail: "Loading matches inspired by the selected reference image."
  });
  renderRefineSidebar();
  if (state.lastPayload) {
    renderResults(state.lastPayload, state.lastQuery);
  }

  try {
    const payload = await refineSearchResults({
      queryEmbedding: context.embedding,
      selectedBullets: context.selectedBullets,
      visualType: context.visualType,
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter,
      sourceImageUrl: context.imageAnalysis?.image_preview_url || ""
    });
    applyActiveSearchContext({
      payload,
      query: context.query,
      selectedBullets: context.selectedBullets,
      bulletControls: context.bulletControls,
      baseQueryEmbedding: context.embedding,
      visualType: context.visualType,
      imageAnalysis: context.imageAnalysis,
      productRefinements: [],
      categoryFilter: state.categoryFilter,
      refreshAgeFilter: state.refreshAgeFilter,
      preserveOriginal: false,
      refinementActive: false
    });
    state.refinementLoading = false;
    renderResults(payload, state.lastQuery);
  } catch (error) {
    state.refinementLoading = false;
    renderResults(state.lastPayload, state.lastQuery);
    setStatus(error.message || "Stored image search failed.", "error");
  }
}

async function searchFromStoredImage(result = {}, matchingImage = null) {
  const context = await ensureStoredImageContext(result, matchingImage);
  await applyStoredImageSearchContext(context);
}

async function runHomepageImageExampleSearch(example = null) {
  if (!example) {
    return;
  }
  const resultStub = {
    product_id: example.productId,
    best_image_url: example.imageUrl,
    name: example.title
  };
  const matchingImage = {
    image_id: example.imageId,
    image_url: example.imageUrl
  };
  const context = await ensureStoredImageContext(resultStub, matchingImage);
  await applyStoredImageSearchContext(context);
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
        getPayloadVisualType(refreshedImage)
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
  return Boolean(getVisibleResults(payload, state.lastQuery).length);
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
  const visibleResults = getVisibleResults(state.lastPayload, state.lastQuery);
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
  const visibleIds = getVisibleResults(state.lastPayload, state.lastQuery).map((result) => result.product_id);
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
      setImageAnalyzeProgressState({ step: "prepare", percent: 0, percentLabel: "0%", indeterminate: false });
    }
    renderImageAnalyzeProgress();
  } else {
    stopImageAnalyzeProgressAnimation();
    stopImageAnalyzeProgressPolling();
    setImageAnalyzeProgressState({ step: "prepare", percent: 0, percentLabel: "0%", indeterminate: false });
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
  const loadingState = typeof message === "string"
    ? {
        mode: state.resultsLoadingMode || "text",
        title: message,
        detail: message
          ? "Preparing the best matches before the result grid appears."
          : "",
        generic: true
      }
    : {
        mode: String(message?.mode || state.resultsLoadingMode || "text").trim() || "text",
        step: String(message?.step || "").trim(),
        percent: Number(message?.percent),
        percentLabel: String(message?.percentLabel || "").trim(),
        indeterminate: Boolean(message?.indeterminate),
        title: String(message?.title || "").trim(),
        detail: String(message?.copy || message?.detail || "").trim(),
        generic: Boolean(message?.generic)
      };
  const isLoading = Boolean(loadingState.title);
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
    const genericStep = getResultsLoadingStepConfig(
      loadingState.mode,
      loadingState.mode === "image" ? "match" : loadingState.mode === "quick" ? "search" : "parse"
    );
    if (loadingState.generic) {
      setResultsLoadingProgressState({
        mode: loadingState.mode,
        step: genericStep.id,
        percent: loadingState.mode === "image" ? genericStep.percent : loadingState.mode === "quick" ? 38 : 10,
        percentLabel: genericStep.percentLabel,
        indeterminate: true,
        title: loadingState.title,
        detail: loadingState.detail
      });
    } else {
      const stepMeta = getResultsLoadingStepConfig(
        loadingState.mode,
        loadingState.step || (loadingState.mode === "image" ? "match" : loadingState.mode === "quick" ? "search" : "parse")
      );
      setResultsLoadingProgressState({
        mode: loadingState.mode,
        step: stepMeta.id,
        percent: Number.isFinite(loadingState.percent) ? loadingState.percent : stepMeta.percent,
        percentLabel: loadingState.percentLabel || stepMeta.percentLabel,
        indeterminate: loadingState.indeterminate,
        title: loadingState.title,
        detail: loadingState.detail
      });
    }
    renderResultsLoadingProgress();
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

  if (isBrowsePayload(state.lastPayload, state.lastQuery) && activeCategoryFilter.length) {
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
    label.textContent = formatVisualTypeLabel(activeSeatingType, state.bootstrap);
    pill.appendChild(label);

    if (!state.currentImageAnalysis) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "context-pill-clear";
      clear.setAttribute("aria-label", `Remove ${formatVisualTypeLabel(activeSeatingType, state.bootstrap)} filter`);
      clear.textContent = "✕";
      clear.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.resultCategoryScope = ["all"];
        state.categoryScopeMode = "all";
        clearBrowseTraitFilters();
        if (isBrowsePayload(state.lastPayload, state.lastQuery) && !String(state.lastQuery || "").trim()) {
          renderBrowseTraitFilters(state.lastPayload, state.lastQuery);
          renderResults(state.lastPayload, state.lastQuery);
          syncSearchPageUrl();
          return;
        }
        runSearch(getSearchComposerRequestQuery(state.lastQuery), {
          sort: state.sortMode,
          categoryFilter: state.categoryFilter,
          refreshAgeFilter: state.refreshAgeFilter,
          visualType: "all",
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
  const isFullImageArea = area
    && Math.abs(area.x) < 0.0001
    && Math.abs(area.y) < 0.0001
    && Math.abs(area.width - 1) < 0.0001
    && Math.abs(area.height - 1) < 0.0001;
  if (!area || isFullImageArea) {
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
  const categoryRequirementMode = String(categoryRequirement?.mode || "").trim();
  const shouldShowCategoryRequirement = Boolean(
    categoryRequirement &&
    Array.isArray(categoryRequirement.options) &&
    categoryRequirement.options.length &&
    (state.lastQuery || categoryRequirementMode === "image_analysis")
  );
  const shouldShow = shouldShowCategoryRequirement;

  elements.clarificationBar.innerHTML = "";
  elements.clarificationBar.hidden = !shouldShow;
  elements.clarificationBar.classList.toggle("is-category-requirement", shouldShowCategoryRequirement);
  if (!shouldShow) {
    return;
  }

  const card = document.createElement("div");
  card.className = "clarification-card clarification-card-category";

  const text = document.createElement("p");
  text.className = "clarification-text clarification-text-category";
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

  const options = document.createElement("div");
  options.className = "clarification-options clarification-options-category";
  const normalizedOptions = categoryRequirement.options
    .map((option) => normalizeVisualTypeKey(option))
    .filter((option) => option && option !== "all")
    .filter((option, index, values) => values.indexOf(option) === index);
  const groupedOptions = groupVisualTypeOptionsByFamily(normalizedOptions, state.bootstrap);
  const familySelection = resolveClarificationFamilySelection(groupedOptions, categoryRequirement.activeFamily);
  const { singleFamilyMode, activeFamily } = familySelection;

  const createCategoryPill = (option) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "clarification-pill clarification-pill-category";
    pill.textContent = String(option?.label || "").trim();
    pill.addEventListener("click", () => {
      const categoryKey = String(option?.value || "").trim();
      if (categoryRequirementMode === "image_analysis") {
        const requestBody = categoryRequirement.requestBody && typeof categoryRequirement.requestBody === "object"
          ? cloneValue(categoryRequirement.requestBody)
          : cloneValue(state.lastAnalyzeInput || {});
        const focusArea = categoryRequirement.focusArea && typeof categoryRequirement.focusArea === "object"
          ? cloneValue(categoryRequirement.focusArea)
          : null;
        const cacheKey = buildImageAnalysisSelectionKey(requestBody);
        if (cacheKey) {
          state.imageAnalysisCategorySelection = {
            key: cacheKey,
            visualType: categoryKey
          };
        }
        updateCategoryRequirement(null);
        runImageAnalysisSearch(requestBody, focusArea, {
          visualTypeOverride: categoryKey
        }).catch((error) => {
          setStatus(error.message || "Failed to apply category selection.", "error");
        });
        return;
      }
      const nextQuery = stripVagueVisualTypeReferenceFromQuery(state.lastQuery || "", categoryKey);
      updateCategoryRequirement(null);
      state.resultCategoryScope = [categoryKey];
      state.categoryScopeMode = "explicit";
      runSearch(nextQuery, {
        sort: state.sortMode,
        categoryFilter: state.categoryFilter,
        refreshAgeFilter: state.refreshAgeFilter,
        visualType: categoryKey,
        categoryScopeMode: "explicit",
        sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
        imageAnalysis: state.currentImageAnalysis,
        selectedBullets: state.currentSelectedBullets,
        bulletControls: state.currentBulletControls
      }).catch((error) => {
        setStatus(error.message || "Failed to apply category selection.", "error");
      });
    });
    return pill;
  };

  if (singleFamilyMode) {
    (groupedOptions[0]?.options || []).forEach((option) => {
      options.appendChild(createCategoryPill(option));
    });
  } else {
    const familyButtons = document.createElement("div");
    familyButtons.className = "clarification-families";

    groupedOptions.forEach((group) => {
      const familyButton = document.createElement("button");
      familyButton.type = "button";
      familyButton.className = `clarification-pill clarification-pill-category clarification-pill-family${group.family === activeFamily ? " is-active" : ""}`;
      familyButton.textContent = group.label;
      familyButton.addEventListener("click", () => {
        updateCategoryRequirement({
          ...categoryRequirement,
          activeFamily: group.family
        });
      });
      familyButtons.appendChild(familyButton);
    });

    options.appendChild(familyButtons);

    if (familySelection.visibleOptions.length) {
      const subcategories = document.createElement("div");
      subcategories.className = "clarification-subcategories";
      familySelection.visibleOptions.forEach((option) => {
        subcategories.appendChild(createCategoryPill(option));
      });
      options.appendChild(subcategories);
    }
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "clarification-close clarification-close-category";
  close.setAttribute("aria-label", "Dismiss category prompt");
  close.textContent = "✕";
  close.addEventListener("click", () => {
    updateCategoryRequirement(null);
    if (categoryRequirementMode === "image_analysis") {
      setStatus("Image search canceled.", "info");
      return;
    }
    setStatus("Select a category from the search field to continue.", "info");
  });

  card.append(text, options, close);
  elements.clarificationBar.appendChild(card);
}

function renderSeedQueries(seedQueries) {
  if (!elements.seedQueries || !elements.seedImageExamples) {
    return;
  }
  elements.seedQueries.innerHTML = "";
  elements.seedImageExamples.innerHTML = "";
  if (state.landingOnlyMode) {
    HOMEPAGE_IMAGE_EXAMPLES.forEach((example) => {
      const button = document.createElement("button");
      button.className = "seed-query seed-query-image-card";
      button.type = "button";
      button.setAttribute("aria-label", `Search from image example: ${example.title} by ${example.brand}`);

      const preview = document.createElement("span");
      preview.className = "seed-query-image-preview";
      preview.style.backgroundImage = `url("${example.imageUrl}")`;
      preview.setAttribute("aria-hidden", "true");

      const copy = document.createElement("span");
      copy.className = "seed-query-image-copy";

      const title = document.createElement("span");
      title.className = "seed-query-image-title";
      title.textContent = example.title;

      const brand = document.createElement("span");
      brand.className = "seed-query-image-brand";
      brand.textContent = example.brand;

      copy.append(title, brand);
      button.append(preview, copy);
      button.addEventListener("click", () => {
        runHomepageImageExampleSearch(example).catch((error) => {
          setStatus(error.message || "Image example search failed.", "error");
        });
      });
      elements.seedImageExamples.appendChild(button);
    });
  }
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

function isSeedQuery(query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return false;
  }
  return (Array.isArray(state.bootstrap?.seed_queries) ? state.bootstrap.seed_queries : []).some(
    (candidate) => String(candidate || "").trim().toLowerCase() === normalizedQuery
  );
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
  const targetPath = HOME_PATH;
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

function formatStructuredTraitGroupsLine(field = {}) {
  const groups = Array.isArray(field?.groups) ? field.groups : [];
  const renderedGroups = groups
    .filter((group) => Array.isArray(group))
    .map((group) => group
      .map((value) => String(value || "").trim())
      .filter(Boolean))
    .filter((group) => group.length > 1)
    .map((group) => `[${group.join(" + ")}]`);

  if (!renderedGroups.length) {
    return "";
  }

  return `  near-miss groups: ${renderedGroups.join(" ")}`;
}

function structuredTraitTypeEntries() {
  const seatingTypes = getBootstrapRoutingTypes();
  const types = seatingTypes?.types;
  if (!types || !Object.keys(types).length) {
    throw new Error("Structured traits are not available yet.");
  }

  const fallbackType = seatingTypes.default_type || "";
  const orderedTypeKeys = STRUCTURED_TRAITS_MATRIX_TYPE_ORDER.filter((typeKey) => types[typeKey]);
  Object.keys(types)
    .filter((typeKey) => !orderedTypeKeys.includes(typeKey) && typeKey !== fallbackType)
    .sort((left, right) => String(types[left]?.label || left).localeCompare(String(types[right]?.label || right)))
    .forEach((typeKey) => orderedTypeKeys.push(typeKey));

  if (types[fallbackType] && !orderedTypeKeys.includes(fallbackType)) {
    orderedTypeKeys.push(fallbackType);
  }

  return orderedTypeKeys.map((typeKey) => ({
    typeKey,
    type: types[typeKey]
  }));
}

function normalizeStructuredTraitCompareText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\/,-]/g, " ")
    .replace(/\s+/g, " ");
}

function buildStructuredTraitTokenSet(value = "") {
  return new Set(
    normalizeStructuredTraitCompareText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

function setIntersection(left = new Set(), right = new Set()) {
  return new Set([...left].filter((item) => right.has(item)));
}

function setDifference(left = new Set(), right = new Set()) {
  return new Set([...left].filter((item) => !right.has(item)));
}

function detectStructuredTraitPhrasingDrift(leftValue = "", rightValue = "") {
  const leftRaw = String(leftValue || "").trim();
  const rightRaw = String(rightValue || "").trim();
  if (!leftRaw || !rightRaw) {
    return false;
  }

  const leftNormalized = normalizeStructuredTraitCompareText(leftRaw);
  const rightNormalized = normalizeStructuredTraitCompareText(rightRaw);
  if (!leftNormalized || !rightNormalized || leftNormalized === rightNormalized) {
    return false;
  }

  const leftTokens = buildStructuredTraitTokenSet(leftRaw);
  const rightTokens = buildStructuredTraitTokenSet(rightRaw);
  const shared = setIntersection(leftTokens, rightTokens);
  if (!shared.size) {
    return false;
  }

  const leftExtra = setDifference(leftTokens, shared);
  const rightExtra = setDifference(rightTokens, shared);
  const extras = [...leftExtra, ...rightExtra];
  if (!extras.length) {
    return false;
  }

  return extras.every((token) => STRUCTURED_TRAITS_PHRASING_QUALIFIERS.has(token));
}

function formatStructuredTraitValueGroup(values = []) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("<br>");
}

function formatStructuredTraitValuesInline(values = []) {
  const filtered = values.map((value) => String(value || "").trim()).filter(Boolean);
  return filtered.length ? filtered.join(" | ") : "Absent";
}

function formatStructuredTraitValuesCsv(values = []) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(", ");
}

function isStructuredTraitDisplayUnknown(value = "") {
  return normalizeTraitValue(value) === "unknown";
}

function compareStructuredTraitPriority(leftName = "", rightName = "") {
  const leftIndex = STRUCTURED_TRAITS_PRIORITY_FIELD_ORDER.indexOf(leftName);
  const rightIndex = STRUCTURED_TRAITS_PRIORITY_FIELD_ORDER.indexOf(rightName);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return String(leftName || "").localeCompare(String(rightName || ""));
}

function traitFieldIsInspectable(field = {}) {
  return field?.type === "enum" && String(field?.detectability || "").trim().toLowerCase() !== "no";
}

function getStructuredTraitPriorityLabel(priority = "normal") {
  if (priority === "essential" || priority === "low") {
    return priority;
  }
  return "default";
}

function getStructuredTraitWeightLabel(priority = "normal") {
  if (priority === "essential") {
    return "high";
  }
  if (priority === "low") {
    return "low";
  }
  return "normal";
}

function sortStructuredTraitValues(values = []) {
  return [...values].sort((left, right) => String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" }));
}

function buildStructuredTraitInspectorData() {
  const entries = structuredTraitTypeEntries();
  const traitMap = new Map();

  for (const { typeKey, type } of entries) {
    for (const field of (type.fields || []).filter(traitFieldIsInspectable)) {
      const traitName = String(field.field || "").trim();
      if (!traitName) {
        continue;
      }
      if (!traitMap.has(traitName)) {
        traitMap.set(traitName, {
          traitName,
          label: formatTraitFieldLabel(traitName),
          cells: new Map()
        });
      }

      traitMap.get(traitName).cells.set(typeKey, {
        typeKey,
        field,
        values: sortStructuredTraitValues(field.allowed_values || []),
        groups: Array.isArray(field.groups) ? field.groups : []
      });
    }
  }

  const traits = [...traitMap.values()].map((trait) => {
    const cells = new Map();
    const allDisplayValues = [];
    const presentTypes = [];
    const absentTypes = [];

    for (const { typeKey } of entries) {
      const existing = trait.cells.get(typeKey) || null;
      if (existing) {
        presentTypes.push(typeKey);
        allDisplayValues.push(...existing.values.filter((value) => !STRUCTURED_TRAITS_IGNORED_COMPARE_VALUES.has(normalizeTraitValue(value))));
        cells.set(typeKey, { ...existing, flags: new Set(), phrasingValues: new Set() });
      } else {
        absentTypes.push(typeKey);
        cells.set(typeKey, { typeKey, field: null, values: [], groups: [], flags: new Set(["absent"]), phrasingValues: new Set() });
      }
    }

    const uniqueValues = [...new Set(allDisplayValues)];
    const adjacency = new Map(uniqueValues.map((value) => [value, new Set([value])]));
    for (let leftIndex = 0; leftIndex < uniqueValues.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < uniqueValues.length; rightIndex += 1) {
        const leftValue = uniqueValues[leftIndex];
        const rightValue = uniqueValues[rightIndex];
        if (detectStructuredTraitPhrasingDrift(leftValue, rightValue)) {
          adjacency.get(leftValue).add(rightValue);
          adjacency.get(rightValue).add(leftValue);
        }
      }
    }

    const componentByValue = new Map();
    const components = [];
    for (const value of uniqueValues) {
      if (componentByValue.has(value)) {
        continue;
      }
      const stack = [value];
      const componentValues = [];
      while (stack.length) {
        const current = stack.pop();
        if (!current || componentByValue.has(current)) {
          continue;
        }
        componentByValue.set(current, components.length);
        componentValues.push(current);
        (adjacency.get(current) || []).forEach((next) => {
          if (!componentByValue.has(next)) {
            stack.push(next);
          }
        });
      }
      components.push(componentValues);
    }

    for (const typeKey of presentTypes) {
      const cell = cells.get(typeKey);
      for (const value of cell.values) {
        const groupIndex = componentByValue.get(value);
        if (components[groupIndex]?.length > 1) {
          cell.phrasingValues.add(value);
        }
      }
    }

    const flags = new Set();
    if (absentTypes.length) {
      flags.add("absent");
    }

    if (components.some((componentValues) => componentValues.length > 1)) {
      flags.add("phrasing");
    }

    for (const typeKey of presentTypes) {
      const cell = cells.get(typeKey);
      if (cell.phrasingValues.size) {
        cell.flags.add("phrasing");
      }
    }

    const severityList = STRUCTURED_TRAITS_SEVERITY_ORDER.filter((severity) => severity !== "absent" && flags.has(severity));
    const worstSeverity = severityList[0] || "clean";
    if (!severityList.length && !flags.has("absent")) {
      flags.add("clean");
    }

    return {
      traitName: trait.traitName,
      label: trait.label,
      cells,
      flags,
      severityList: severityList.length ? severityList : ["clean"],
      worstSeverity,
      absentTypes,
      phrasingComponents: components.filter((componentValues) => componentValues.length > 1)
    };
  });

  traits.sort((left, right) => compareStructuredTraitPriority(left.traitName, right.traitName));

  const summary = {
    valueSetMismatchCount: 0,
    phrasingDriftCount: traits.filter((trait) => trait.flags.has("phrasing")).length,
    absentCount: traits.filter((trait) => trait.flags.has("absent")).length
  };

  return { entries, traits, summary };
}

function createStructuredTraitBadge(label = "", severity = "clean") {
  const badge = document.createElement("span");
  badge.className = `structured-traits-badge ${STRUCTURED_TRAITS_SEVERITY_META[severity]?.className || STRUCTURED_TRAITS_SEVERITY_META.clean.className}`;
  badge.textContent = label;
  return badge;
}

function appendStructuredTraitBadges(container, severities = []) {
  severities.forEach((severity) => {
    container.appendChild(createStructuredTraitBadge(
      STRUCTURED_TRAITS_SEVERITY_META[severity]?.label || severity,
      severity
    ));
  });
}

function formatStructuredTraitTypeList(typeKeys = []) {
  return typeKeys.join(", ");
}

function quoteStructuredTraitValue(value = "") {
  return `"${String(value || "").trim()}"`;
}

function renderStructuredTraitsMatrixTab(root, inspectorData) {
  const { entries, traits, summary } = inspectorData;
  const activeSeverity = state.structuredTraitsInspectorSeverity || "all";
  const filteredTraits = activeSeverity === "all"
    ? traits
    : traits.filter((trait) => trait.flags.has(activeSeverity));

  const summaryGrid = document.createElement("div");
  summaryGrid.className = "structured-traits-summary-grid";
  [
    { label: "Value-set mismatches", value: summary.valueSetMismatchCount, severity: "critical" },
    { label: "Phrasing drift", value: summary.phrasingDriftCount, severity: "phrasing" },
    { label: "Absent in some types", value: summary.absentCount, severity: "absent" }
  ].forEach((item) => {
    const card = document.createElement("article");
    card.className = `structured-traits-summary-card ${STRUCTURED_TRAITS_SEVERITY_META[item.severity]?.className || ""}`;
    const value = document.createElement("strong");
    value.className = "structured-traits-summary-value";
    value.textContent = String(item.value);
    const label = document.createElement("span");
    label.className = "structured-traits-summary-label";
    label.textContent = item.label;
    card.append(value, label);
    summaryGrid.appendChild(card);
  });
  root.appendChild(summaryGrid);

  const filterBar = document.createElement("div");
  filterBar.className = "structured-traits-filter-bar";
  [
    { id: "all", label: "All" },
    { id: "phrasing", label: STRUCTURED_TRAITS_SEVERITY_META.phrasing.label },
    { id: "absent", label: STRUCTURED_TRAITS_SEVERITY_META.absent.label }
  ].forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `structured-traits-filter-button${activeSeverity === filter.id ? " is-active" : ""}`;
    button.textContent = filter.label;
    button.addEventListener("click", () => {
      state.structuredTraitsInspectorSeverity = filter.id;
      renderStructuredTraitsModalContent();
    });
    filterBar.appendChild(button);
  });
  root.appendChild(filterBar);

  const tableWrap = document.createElement("div");
  tableWrap.className = "structured-traits-matrix-wrap";

  const table = document.createElement("table");
  table.className = "structured-traits-matrix-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const traitHeader = document.createElement("th");
  traitHeader.textContent = "field_name";
  headRow.appendChild(traitHeader);
  entries.forEach(({ typeKey, type }) => {
    const th = document.createElement("th");
    th.innerHTML = `${typeKey}<span class="structured-traits-matrix-key">${type.label}</span>`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  filteredTraits.forEach((trait) => {
    const row = document.createElement("tr");
    row.className = "structured-traits-row";

    const traitCell = document.createElement("th");
    traitCell.className = "structured-traits-matrix-trait";
    const title = document.createElement("div");
    title.className = "structured-traits-matrix-trait-title";
    title.textContent = trait.traitName;
    const key = document.createElement("div");
    key.className = "structured-traits-matrix-trait-key";
    key.textContent = trait.label;
    traitCell.append(title, key);
    row.appendChild(traitCell);

    entries.forEach(({ typeKey }) => {
      const cellData = trait.cells.get(typeKey);
      const td = document.createElement("td");
      td.className = "structured-traits-matrix-cell";

      if (!cellData.field) {
        td.classList.add("is-absent");
        row.appendChild(td);
        return;
      }

      td.textContent = formatStructuredTraitValuesCsv(cellData.values);

      row.appendChild(td);
    });

    tbody.appendChild(row);

    const detailItems = [];

    if (trait.flags.has("phrasing")) {
      trait.phrasingComponents.forEach((componentValues) => {
        const sortedValues = sortStructuredTraitValues(componentValues);
        if (sortedValues.length < 2) {
          return;
        }
        const valueTypeParts = sortedValues.map((value) => {
          const ownerTypes = entries
            .map(({ typeKey }) => typeKey)
            .filter((typeKey) => (trait.cells.get(typeKey)?.values || []).includes(value));
          return `${quoteStructuredTraitValue(value)} (${formatStructuredTraitTypeList(ownerTypes)})`;
        });
        detailItems.push({
          severity: "phrasing",
          text: `Phrasing drift: ${valueTypeParts.join(" ↔ ")}`
        });
      });
    }

    if (!detailItems.length) {
      return;
    }

    const driftRow = document.createElement("tr");
    driftRow.className = "structured-traits-drift-row";
    const driftLabelCell = document.createElement("th");
    driftLabelCell.className = "structured-traits-drift-label-cell";
    driftLabelCell.textContent = "Drift Summary";
    driftRow.appendChild(driftLabelCell);

    const driftDetailCell = document.createElement("td");
    driftDetailCell.className = "structured-traits-drift-detail-cell";
    driftDetailCell.colSpan = entries.length;

    const driftList = document.createElement("div");
    driftList.className = "structured-traits-drift-list";

    detailItems.forEach((item) => {
      const line = document.createElement("div");
      line.className = "structured-traits-drift-item";
      const badge = createStructuredTraitBadge(STRUCTURED_TRAITS_SEVERITY_META[item.severity]?.label || item.severity, item.severity);
      const text = document.createElement("span");
      text.className = "structured-traits-drift-text";
      text.textContent = item.text;
      line.append(badge, text);
      driftList.appendChild(line);
    });

    driftDetailCell.appendChild(driftList);
    driftRow.appendChild(driftDetailCell);
    tbody.appendChild(driftRow);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  root.appendChild(tableWrap);
}

function renderStructuredTraitsScoringTab(root, inspectorData) {
  const priorityOrder = { essential: 0, normal: 1, low: 2 };
  inspectorData.entries.forEach(({ typeKey, type }) => {
    const card = document.createElement("section");
    card.className = "structured-traits-section-card";

    const title = document.createElement("h3");
    title.className = "structured-traits-section-title";
    title.textContent = `${type.label} (${typeKey})`;
    card.appendChild(title);

    const tableWrap = document.createElement("div");
    tableWrap.className = "structured-traits-scoring-wrap";
    const table = document.createElement("table");
    table.className = "structured-traits-scoring-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Trait</th>
          <th>Priority</th>
          <th>Derived weight</th>
          <th>Groupings</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");

    (type.fields || [])
      .filter(traitFieldIsInspectable)
      .slice()
      .sort((left, right) => {
        const priorityDelta = (priorityOrder[getFieldPriority(typeKey, left.field)] ?? 1) - (priorityOrder[getFieldPriority(typeKey, right.field)] ?? 1);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return String(left.field || "").localeCompare(String(right.field || ""));
      })
      .forEach((field) => {
        const row = document.createElement("tr");
        const priority = getFieldPriority(typeKey, field.field);
        row.innerHTML = `
          <td><strong>${formatTraitFieldLabel(field.field)}</strong><div class="structured-traits-scoring-key">${field.field}</div></td>
          <td>${getStructuredTraitPriorityLabel(priority)}</td>
          <td>${getStructuredTraitWeightLabel(priority)}</td>
          <td>${Array.isArray(field.groups) && field.groups.length ? "Yes" : "No"}</td>
        `;
        tbody.appendChild(row);
      });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
    root.appendChild(card);
  });
}

function renderStructuredTraitsGroupingsTab(root, inspectorData) {
  inspectorData.entries.forEach(({ typeKey, type }) => {
    const card = document.createElement("section");
    card.className = "structured-traits-section-card";

    const title = document.createElement("h3");
    title.className = "structured-traits-section-title";
    title.textContent = `${type.label} (${typeKey})`;
    card.appendChild(title);

    const groupedFields = (type.fields || [])
      .filter((field) => (
        traitFieldIsInspectable(field) &&
        Array.isArray(field.groups) &&
        field.groups.some((group) => Array.isArray(group) && group.length > 1)
      ))
      .slice()
      .sort((left, right) => compareStructuredTraitPriority(left.field, right.field));

    if (!groupedFields.length) {
      const empty = document.createElement("p");
      empty.className = "structured-traits-empty";
      empty.textContent = "No groupings defined for this type.";
      card.appendChild(empty);
      root.appendChild(card);
      return;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "structured-traits-scoring-wrap";
    const table = document.createElement("table");
    table.className = "structured-traits-scoring-table structured-traits-groupings-table";
    table.innerHTML = `
      <colgroup>
        <col class="structured-traits-groupings-col-trait">
        <col class="structured-traits-groupings-col-grouped">
        <col class="structured-traits-groupings-col-ungrouped">
      </colgroup>
      <thead>
        <tr>
          <th>Trait</th>
          <th>Grouped values</th>
          <th>Ungrouped values</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");

    groupedFields.forEach((field) => {
      const groupedValues = new Set();
      const renderedGroups = (field.groups || [])
        .filter((group) => Array.isArray(group) && group.length > 1)
        .map((group) => {
          const cleaned = group
            .map((value) => String(value || "").trim())
            .filter((value) => value && !isStructuredTraitDisplayUnknown(value));
          cleaned.forEach((value) => groupedValues.add(value));
          return cleaned.join(", ");
        })
        .filter(Boolean);
      const ungrouped = (field.allowed_values || [])
        .map((value) => String(value || "").trim())
        .filter((value) => value && !groupedValues.has(value) && !isStructuredTraitDisplayUnknown(value));

      const row = document.createElement("tr");
      row.innerHTML = `
        <td><strong>${formatTraitFieldLabel(field.field)}</strong><div class="structured-traits-scoring-key">${field.field}</div></td>
        <td>${renderedGroups.join("<br>")}</td>
        <td>${ungrouped.length ? ungrouped.join(" | ") : "None"}</td>
      `;
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
    root.appendChild(card);
  });
}

function renderStructuredTraitsModalContent() {
  if (!elements.structuredTraitsText) {
    return;
  }

  const inspectorData = buildStructuredTraitInspectorData();
  const activeTab = STRUCTURED_TRAITS_TAB_DEFS.some((tab) => tab.id === state.structuredTraitsInspectorTab)
    ? state.structuredTraitsInspectorTab
    : "matrix";
  state.structuredTraitsInspectorTab = activeTab;

  elements.structuredTraitsText.innerHTML = "";

  const tabBar = document.createElement("div");
  tabBar.className = "structured-traits-tab-bar";
  STRUCTURED_TRAITS_TAB_DEFS.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `structured-traits-tab${activeTab === tab.id ? " is-active" : ""}`;
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      state.structuredTraitsInspectorTab = tab.id;
      renderStructuredTraitsModalContent();
    });
    tabBar.appendChild(button);
  });
  elements.structuredTraitsText.appendChild(tabBar);

  const panel = document.createElement("div");
  panel.className = "structured-traits-panel";
  elements.structuredTraitsText.appendChild(panel);

  if (activeTab === "matrix") {
    renderStructuredTraitsMatrixTab(panel, inspectorData);
  } else if (activeTab === "scoring") {
    renderStructuredTraitsScoringTab(panel, inspectorData);
  } else {
    renderStructuredTraitsGroupingsTab(panel, inspectorData);
  }

  if (elements.copyStructuredTraitsModalButton) {
    elements.copyStructuredTraitsModalButton.textContent = activeTab === "matrix" ? "Copy as table" : "Copy Current Tab";
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

function formatStructuredTraitsMatrixMarkdown(inspectorData) {
  const activeSeverity = state.structuredTraitsInspectorSeverity || "all";
  const filteredTraits = activeSeverity === "all"
    ? inspectorData.traits
    : inspectorData.traits.filter((trait) => trait.flags.has(activeSeverity));
  const headers = ["field_name", ...inspectorData.entries.map(({ typeKey }) => typeKey)];
  const separator = headers.map(() => "---");
  const rows = filteredTraits.map((trait) => [
    trait.traitName,
    ...inspectorData.entries.map(({ typeKey }) => {
      const cell = trait.cells.get(typeKey);
      return cell?.field ? formatStructuredTraitValuesCsv(cell.values) : "";
    })
  ]);
  return [
    `# Structured Trait Matrix`,
    `Filter: ${activeSeverity}`,
    "",
    `| ${headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function formatStructuredTraitsScoringMarkdown(inspectorData) {
  return inspectorData.entries.map(({ typeKey, type }) => {
    const lines = [
      `## ${type.label} (${typeKey})`,
      "",
      `| Trait | Priority | Derived weight | Groupings |`,
      `| --- | --- | --- | --- |`
    ];
    (type.fields || [])
      .filter(traitFieldIsInspectable)
      .forEach((field) => {
        const priority = getFieldPriority(typeKey, field.field);
        lines.push(`| ${field.field} | ${getStructuredTraitPriorityLabel(priority)} | ${getStructuredTraitWeightLabel(priority)} | ${Array.isArray(field.groups) && field.groups.length ? "Yes" : "No"} |`);
      });
    lines.push("");
    return lines.join("\n");
  }).join("\n");
}

function formatStructuredTraitsGroupingsMarkdown(inspectorData) {
  return inspectorData.entries.map(({ typeKey, type }) => {
    const groupedFields = (type.fields || [])
      .filter((field) => (
        traitFieldIsInspectable(field) &&
        Array.isArray(field.groups) &&
        field.groups.some((group) => Array.isArray(group) && group.length > 1)
      ))
      .slice()
      .sort((left, right) => compareStructuredTraitPriority(left.field, right.field));
    const lines = [`## ${type.label} (${typeKey})`, ""];
    if (!groupedFields.length) {
      lines.push("No groupings defined for this type.", "");
      return lines.join("\n");
    }
    groupedFields.forEach((field) => {
      const groupedValues = new Set();
      const renderedGroups = (field.groups || [])
        .filter((group) => Array.isArray(group) && group.length > 1)
        .map((group) => {
          const cleaned = group
            .map((value) => String(value || "").trim())
            .filter((value) => value && !isStructuredTraitDisplayUnknown(value));
          cleaned.forEach((value) => groupedValues.add(value));
          return cleaned.join(", ");
        })
        .filter(Boolean);
      const ungrouped = (field.allowed_values || [])
        .map((value) => String(value || "").trim())
        .filter((value) => value && !groupedValues.has(value) && !isStructuredTraitDisplayUnknown(value));
      lines.push(`- ${field.field}`);
      lines.push(`  groups: ${renderedGroups.join(" | ")}`);
      lines.push(`  ungrouped: ${ungrouped.length ? ungrouped.join(" | ") : "None"}`);
    });
    lines.push("");
    return lines.join("\n");
  }).join("\n");
}

function formatStructuredTraitsSummary() {
  const inspectorData = buildStructuredTraitInspectorData();
  if (state.structuredTraitsInspectorTab === "scoring") {
    return formatStructuredTraitsScoringMarkdown(inspectorData);
  }
  if (state.structuredTraitsInspectorTab === "groupings") {
    return formatStructuredTraitsGroupingsMarkdown(inspectorData);
  }
  return formatStructuredTraitsMatrixMarkdown(inspectorData);
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

function getPromptLibraryEntries() {
  const prompts = Array.isArray(state.promptLibrary?.prompts) ? state.promptLibrary.prompts : [];
  return prompts;
}

function getActivePromptLibraryEntry() {
  const prompts = getPromptLibraryEntries();
  const activeId = String(state.promptLibraryActiveId || "stage1").trim();
  return prompts.find((entry) => String(entry?.id || "").trim() === activeId) || prompts[0] || null;
}

function formatPromptLibrarySourceLabel(section = {}) {
  const file = String(section?.file || "").trim();
  const start = Number(section?.start || 0);
  const end = Number(section?.end || 0);
  const lineLabel = start && end && end !== start
    ? `lines ${start}-${end}`
    : start
      ? `line ${start}`
      : "";
  return [file, lineLabel].filter(Boolean).join(": ");
}

function normalizePromptLibraryViewMode(value = "") {
  return String(value || "").trim().toLowerCase() === "formatted" ? "formatted" : "raw";
}

function setPromptLibraryViewMode(mode = "raw") {
  const normalizedMode = normalizePromptLibraryViewMode(mode);
  state.promptLibraryViewMode = normalizedMode;
  try {
    window.sessionStorage.setItem(PROMPT_LIBRARY_VIEW_MODE_STORAGE_KEY, normalizedMode);
  } catch {}
}

function promptLibraryLineIndentDepth(line = "") {
  const match = String(line || "").match(/^( +)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

function promptLibraryLineKind(line = "") {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return "blank";
  }
  if (/^Stage \d+:/i.test(trimmed)) {
    return "stage";
  }
  if (/^- visual_summary:/i.test(trimmed)) {
    return "field";
  }
  if (/^[A-Z][A-Z\s/&()\-]+:/.test(trimmed)) {
    return "section";
  }
  if (/^Relevant attribute fields/i.test(trimmed) || /^Return JSON with:/i.test(trimmed) || /^When choosing between categories/i.test(trimmed)) {
    return "subsection";
  }
  if (/^- [a-z0-9_]+ .*=> \[.*\]$/i.test(trimmed)) {
    return "trait";
  }
  if (/^\d+\./.test(trimmed)) {
    return "numbered";
  }
  if (/^- /.test(trimmed)) {
    return "bullet";
  }
  return "body";
}

function appendPromptLibraryInlineSegments(root, line = "") {
  const text = String(line || "");
  const regex = /(\[[^\]]+\])/g;
  let cursor = 0;
  let match = regex.exec(text);
  while (match) {
    const [segment] = match;
    const start = match.index;
    if (start > cursor) {
      root.append(document.createTextNode(text.slice(cursor, start)));
    }
    const enumSpan = document.createElement("span");
    enumSpan.className = "prompt-library-enum";
    enumSpan.textContent = segment;
    root.append(enumSpan);
    cursor = start + segment.length;
    match = regex.exec(text);
  }
  if (cursor < text.length) {
    root.append(document.createTextNode(text.slice(cursor)));
  }
}

function buildPromptLibraryFormattedView(prompt = "") {
  const container = document.createElement("div");
  container.className = "prompt-library-formatted";
  const lines = String(prompt ?? "").split("\n");

  lines.forEach((line) => {
    const kind = promptLibraryLineKind(line);
    if (kind === "blank") {
      const spacer = document.createElement("div");
      spacer.className = "prompt-library-line prompt-library-line-blank";
      spacer.setAttribute("aria-hidden", "true");
      spacer.textContent = " ";
      container.appendChild(spacer);
      return;
    }

    const lineElement = document.createElement("div");
    lineElement.className = `prompt-library-line prompt-library-line-${kind}`;
    lineElement.style.setProperty("--prompt-indent-level", String(promptLibraryLineIndentDepth(line)));
    appendPromptLibraryInlineSegments(lineElement, line);
    container.appendChild(lineElement);
  });

  return container;
}

function renderPromptLibraryModalContent() {
  if (!elements.promptLibraryContent) {
    return;
  }

  const prompts = getPromptLibraryEntries();
  const activeEntry = getActivePromptLibraryEntry();
  elements.promptLibraryContent.innerHTML = "";

  if (!prompts.length || !activeEntry) {
    elements.promptLibraryContent.innerHTML = '<p class="rules-summary-intro">No prompt library data available.</p>';
    return;
  }

  state.promptLibraryActiveId = String(activeEntry.id || "stage1").trim();

  const tabBar = document.createElement("div");
  tabBar.className = "structured-traits-tab-bar";
  prompts.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `structured-traits-tab${String(entry.id || "") === state.promptLibraryActiveId ? " is-active" : ""}`;
    button.textContent = entry.stage === "Stage 1"
      ? "Stage 1"
      : entry.typeLabel || entry.typeKey || entry.label || "Prompt";
    button.addEventListener("click", () => {
      state.promptLibraryActiveId = String(entry.id || "").trim();
      renderPromptLibraryModalContent();
    });
    tabBar.appendChild(button);
  });
  elements.promptLibraryContent.appendChild(tabBar);

  const panel = document.createElement("div");
  panel.className = "prompt-library-panel";

  const header = document.createElement("div");
  header.className = "prompt-library-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "prompt-library-title";
  title.textContent = activeEntry.label || "Prompt";
  const meta = document.createElement("p");
  meta.className = "prompt-library-meta";
  meta.textContent = activeEntry.stage === "Stage 1"
    ? "Shared Stage 1 classification prompt"
    : `${activeEntry.stage} • ${activeEntry.typeLabel || activeEntry.typeKey || ""}`.replace(/\s+•\s*$/, "");
  titleWrap.append(title, meta);

  const generated = document.createElement("p");
  generated.className = "prompt-library-generated";
  generated.textContent = state.promptLibrary?.generated_at
    ? `Generated ${new Date(state.promptLibrary.generated_at).toLocaleString()}`
    : "";
  header.append(titleWrap, generated);
  panel.appendChild(header);

  const viewToggleBar = document.createElement("div");
  viewToggleBar.className = "prompt-library-view-toggle";
  [
    { id: "raw", label: "Raw view" },
    { id: "formatted", label: "Formatted view" }
  ].forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `structured-traits-tab${state.promptLibraryViewMode === entry.id ? " is-active" : ""}`;
    button.textContent = entry.label;
    button.addEventListener("click", () => {
      setPromptLibraryViewMode(entry.id);
      renderPromptLibraryModalContent();
    });
    viewToggleBar.appendChild(button);
  });
  panel.appendChild(viewToggleBar);

  const notes = Array.isArray(activeEntry.runtime_notes) ? activeEntry.runtime_notes.filter(Boolean) : [];
  if (notes.length) {
    const notesCard = document.createElement("section");
    notesCard.className = "rules-card prompt-library-notes-card";
    const notesTitle = document.createElement("h4");
    notesTitle.className = "rules-card-title";
    notesTitle.textContent = "Runtime Notes";
    notesCard.appendChild(notesTitle);
    const list = document.createElement("ul");
    list.className = "rules-summary-list prompt-library-notes-list";
    notes.forEach((note) => {
      const item = document.createElement("li");
      item.textContent = note;
      list.appendChild(item);
    });
    notesCard.appendChild(list);
    panel.appendChild(notesCard);
  }

  const sourceCard = document.createElement("section");
  sourceCard.className = "rules-card prompt-library-source-card";
  const sourceTitle = document.createElement("h4");
  sourceTitle.className = "rules-card-title";
  sourceTitle.textContent = "Prompt Source Sections";
  sourceCard.appendChild(sourceTitle);
  const sourceList = document.createElement("div");
  sourceList.className = "prompt-library-source-list";
  (Array.isArray(activeEntry.source_sections) ? activeEntry.source_sections : []).forEach((section) => {
    const item = document.createElement("article");
    item.className = "prompt-library-source-item";
    const itemTitle = document.createElement("strong");
    itemTitle.className = "prompt-library-source-title";
    itemTitle.textContent = section.label || "Source section";
    const itemMeta = document.createElement("span");
    itemMeta.className = "prompt-library-source-meta";
    itemMeta.textContent = formatPromptLibrarySourceLabel(section);
    item.append(itemTitle, itemMeta);
    sourceList.appendChild(item);
  });
  sourceCard.appendChild(sourceList);
  panel.appendChild(sourceCard);

  const promptWrap = document.createElement("div");
  promptWrap.className = "prompt-library-prompt-wrap";
  if (normalizePromptLibraryViewMode(state.promptLibraryViewMode) === "formatted") {
    promptWrap.appendChild(buildPromptLibraryFormattedView(String(activeEntry.prompt ?? "")));
  } else {
    const promptPre = document.createElement("pre");
    promptPre.className = "prompt-library-prompt";
    promptPre.textContent = String(activeEntry.prompt ?? "");
    promptWrap.appendChild(promptPre);
  }
  panel.appendChild(promptWrap);

  elements.promptLibraryContent.appendChild(panel);
}

function showPromptLibraryCopied() {
  if (!elements.copyPromptLibraryStatus) {
    return;
  }
  elements.copyPromptLibraryStatus.hidden = false;
  if (state.copyPromptLibraryTimer) {
    clearTimeout(state.copyPromptLibraryTimer);
  }
  state.copyPromptLibraryTimer = window.setTimeout(() => {
    elements.copyPromptLibraryStatus.hidden = true;
    state.copyPromptLibraryTimer = null;
  }, 2000);
}

function formatPromptLibraryExport() {
  const activeEntry = getActivePromptLibraryEntry();
  if (!activeEntry) {
    return "";
  }
  const sourceLines = (Array.isArray(activeEntry.source_sections) ? activeEntry.source_sections : [])
    .map((section) => `- ${section.label}: ${formatPromptLibrarySourceLabel(section)}`);
  const notes = (Array.isArray(activeEntry.runtime_notes) ? activeEntry.runtime_notes : [])
    .map((note) => `- ${note}`);
  return [
    `# ${activeEntry.label}`,
    activeEntry.stage === "Stage 1"
      ? `Type: Shared`
      : `Type: ${activeEntry.typeLabel || activeEntry.typeKey || ""}`,
    "",
    "## Runtime Notes",
    ...(notes.length ? notes : ["- None"]),
    "",
    "## Source Sections",
    ...(sourceLines.length ? sourceLines : ["- None"]),
    "",
    "## Prompt",
    "```text",
    String(activeEntry.prompt || "").trim(),
    "```"
  ].join("\n");
}

async function copyPromptLibraryPrompt() {
  const text = formatPromptLibraryExport();
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
  showPromptLibraryCopied();
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
  const normalizedField = resolveStructuredBulletField(state.currentVisualType, label);
  return {
    label: normalizedField
      ? formatInlineRefinementFieldLabel(normalizedField, state.currentVisualType)
      : toTitleCaseWords(label),
    value: normalizedLabel === "seating type" || normalizedLabel === "visual type"
      ? formatVisualTypeLabel(value, state.bootstrap)
      : formatFrontendTraitValue(normalizedField, value)
  };
}

function renderRefineSidebar() {
  if (!elements.resultsSidebar || !elements.refineBulletsList || !elements.refineToggleButton || !elements.resultsLayout) {
    return;
  }

  const browseMode = isBrowsePayload(state.lastPayload, state.lastQuery);
  const showBrowseSidebar = browseMode && !state.currentImageAnalysis;
  const browseFilterModel = showBrowseSidebar
    ? buildBrowseFilterModel(state.lastPayload, state.lastQuery)
    : null;
  const showRefineSidebar = Boolean(state.lastQuery && state.currentBulletControls.length && !browseMode);
  const showSidebar = showBrowseSidebar || showRefineSidebar;
  elements.resultsLayout.classList.toggle("has-sidebar", showRefineSidebar);
  elements.resultsLayout.classList.toggle("has-browse-sidebar", showBrowseSidebar);
  elements.resultsSidebar.hidden = !showSidebar;
  elements.refineToggleButton.hidden = !showSidebar;
  elements.refineToggleButton.textContent = browseMode ? "Filters" : "Refine";
  elements.refineBulletsList.innerHTML = "";
  if (elements.resultsSidebarEyebrow) {
    elements.resultsSidebarEyebrow.textContent = browseMode ? "Browse" : "Tools";
  }
  if (elements.resultsSidebarTitle) {
    elements.resultsSidebarTitle.textContent = browseMode ? "Refine catalog" : "Refine results";
  }
  if (elements.browseCategoryScopeBar) {
    elements.browseCategoryScopeBar.hidden = !showBrowseSidebar;
  }
  if (elements.browseTraitFilterPanel) {
    elements.browseTraitFilterPanel.hidden = !(showBrowseSidebar && browseFilterModel?.panelVisible);
  }
  if (elements.refineBulletSection) {
    elements.refineBulletSection.hidden = showBrowseSidebar;
  }

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

  if (showBrowseSidebar) {
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
      const referenceMode = String(state.currentImageAnalysis?.reference_image_mode || "").trim().toLowerCase();
      elements.reopenFocusOverlay.hidden = !selectedImageUrl || referenceMode === "stored";
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
  const pushStructuredTraitBullet = (field, rawValue) => {
    const normalizedField = normalizeTraitFieldKey(field);
    const value = String(rawValue ?? "").trim();
    if (!normalizedField || !hasPopulatedVisibleImageTraitValue(rawValue)) {
      return;
    }
    bullets.push(
      `${formatInlineRefinementFieldLabel(normalizedField)}: ${formatFrontendTraitValue(normalizedField, value)}`
    );
  };

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

  pushStructuredTraitBullet("seat_construction", imageTraits.seat_construction);
  pushStructuredTraitBullet("narrow_arms", imageTraits.narrow_arms);
  pushStructuredTraitBullet("arms_flush_with_back", imageTraits.arms_flush_with_back);

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
  let normalized = matchingImages
    .map((image) => ({
      ...image,
      stage_0_result: normalizeStage0Result(image?.stage_0_result),
      effective_classification: normalizeEffectiveClassification(image?.effective_classification || image?.stage_0_result),
      image_url: normalizeDisplayImageUrl(image?.image_url)
    }))
    .filter((image) => image.image_url);
  const browseCategoryKey = getBrowseScopedCategoryKey(state.lastPayload, state.lastQuery);
  const browseTraitFilters = normalizeTraitFilterState(state.traitFilters);
  if (isBrowsePayload(state.lastPayload, state.lastQuery) && browseCategoryKey) {
    normalized = normalized.filter((image) => normalizeVisualTypeKey(getPayloadVisualType(image)) === browseCategoryKey);
    if (Object.keys(browseTraitFilters).length) {
      normalized = normalized.filter((image) => imageMatchesTraitFilters(image, browseTraitFilters));
    }
  }
  if (normalized.length) {
    const isSearchMode = Boolean(state.lastQuery && !result?.browse_mode);
    if (isSearchMode) {
      const heroEffectiveClassification = normalizeEffectiveClassification(
        result.hero_image?.effective_classification || result.hero_image?.stage_0_result
      );
      const heroSeatingType = String(getPayloadVisualType(result.hero_image) || "").trim().toLowerCase();
      const productOnly = normalized.filter((image) => image.effective_classification === "product");
      if (heroEffectiveClassification === "product" && heroSeatingType) {
        const sameSeatingType = productOnly.filter((image) => String(getPayloadVisualType(image) || "").trim().toLowerCase() === heroSeatingType);
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

  const hasStoredEmbedding = matchingImage?.has_stored_embedding === true ||
    (Array.isArray(matchingImage?.visual_summary_embedding) && matchingImage.visual_summary_embedding.length > 0);
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
    visualType: String(
      getPayloadVisualType(matchingImage) ||
      getPayloadVisualType(result.hero_image) ||
      getPayloadVisualType(result.debug?.stage1) ||
      state.currentVisualType ||
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
  const allTraits = buildInlineRefinementTraits(imageContext.imageTraits, imageContext.visualType);
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
  const visibleResults = getVisibleResults(payload, query);
  renderBrowseTraitFilters(payload, query);
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
    [...state.selectedProductIds].filter((productId) => visibleResults.some((result) => result.product_id === productId))
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
  updateResetSearchVisibility();
  if (elements.resultsGrid) {
    elements.resultsGrid.classList.toggle("is-browse-grid", isBrowseMode);
  }
  if (elements.categoryFilterMenu) {
    elements.categoryFilterMenu.hidden = false;
  }
  if (elements.refreshAgeFilterWrap) {
    elements.refreshAgeFilterWrap.hidden = !isBrowseMode;
  }
  syncManageToolbar();
  renderContextPills(payload.parsed);
  renderClarificationBar();
  renderRefineSidebar();

  if (!query) {
    setResultCountMarkup(visibleResults.length, "catalog products");
    setStatus("");
  }

  if (!visibleResults.length) {
    const activeScopeCategory = getPrimaryCategoryScopeSelection(state.resultCategoryScope);
    setResultCountMarkup(0, "results found");
    setStatus(
      activeScopeCategory && activeScopeCategory !== "all"
        ? `No matches in ${formatVisualTypeLabel(activeScopeCategory, state.bootstrap)}. Try another?`
        : "No results matched that combination of category, brand, and visual traits.",
      "empty"
    );
    return;
  }

  if (query) {
    setStatus("");
    setResultCountMarkup(visibleResults.length, "results found");
  }

  visibleResults.forEach((result, index) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const resultTile = fragment.querySelector(".result-tile");
    const image = fragment.querySelector(".card-image");
    const cardImageWrap = fragment.querySelector('[data-role="cardImageWrap"]');
    const scoreBadge = fragment.querySelector('[data-role="scoreBadge"]');
    const sceneBadge = fragment.querySelector('[data-role="sceneBadge"]');
    const searchFromImageButton = fragment.querySelector('[data-role="searchFromImageButton"]');
    const descriptionAuditButton = fragment.querySelector('[data-role="descriptionAuditButton"]');
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
    const planShapeReasoning = document.createElement("div");
    planShapeReasoning.className = "debug-plan-shape-reasoning";
    if (metaBlock) {
      metaBlock.appendChild(planShapeReasoning);
    }
    const scoreRank = index + 1;
    const isWeakerMatch = showWeakerMatchesToggle && scoreRank > cutoffMeta.cutoff;

    if (resultTile) {
      resultTile.classList.toggle("result-tile-weaker", isWeakerMatch);
      resultTile.hidden = isWeakerMatch && !state.weakerMatchesExpanded;
    }

    const normalizedResultImages = normalizeMatchingImages(result);
    const fallbackImageUrls = [...new Set([
      ...normalizedResultImages.map((imageRecord) => normalizeDisplayImageUrl(imageRecord.image_url)),
      normalizeDisplayImageUrl(result.best_image_url),
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
      normalizedResultImages.find((imageRecord) => imageRecord.image_url === normalizeDisplayImageUrl(result.best_image_url))
    );
    productName.textContent = "";
    const productWebsite = String(result.website || "").trim() || buildDesignerPagesProductUrl(result.product_id);
    cardImageWrap.classList.toggle("is-linked", Boolean(productWebsite));
    cardImageWrap.onclick = null;
    if (descriptionAuditButton) {
      descriptionAuditButton.hidden = !IS_PRIVATE_BROWSE_ROUTE;
      descriptionAuditButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDescriptionAuditModal(result);
      });
    }
    if (productWebsite) {
      cardImageWrap.setAttribute("role", "link");
      cardImageWrap.setAttribute("tabindex", "0");
      cardImageWrap.setAttribute("aria-label", `Open ${result.name} on Designer Pages`);
      cardImageWrap.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".search-from-image-button, .inspect-control, .description-audit-button")) {
          return;
        }
        window.open(productWebsite, "_blank", "noopener,noreferrer");
      });
      cardImageWrap.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest(".search-from-image-button, .inspect-control, .description-audit-button")) {
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
    caption.textContent = result.hero_image?.structured_caption || result.debug?.structured_caption || "";
    const planShapeReasoningText = String(result.debug?.plan_shape_reasoning || "").trim();
    planShapeReasoning.textContent = planShapeReasoningText ? `Plan shape reasoning: ${planShapeReasoningText}` : "";
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
      planShapeReasoning.hidden = true;
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
      planShapeReasoning.hidden = !state.debug || !planShapeReasoningText;
    }

    (result.debug?.detected_traits || []).slice(0, 6).forEach((trait) => traits.appendChild(createChip(trait, true)));
    formatQueryTraitEntries(result.debug?.query_traits || {}).slice(0, 6).forEach((trait) => queryTraits.appendChild(createChip(trait, true)));
    (result.debug?.mismatch_traits || []).slice(0, 4).forEach((trait) => mismatches.appendChild(createChip(trait, true)));
    (result.debug?.score_breakdown || []).forEach((item) => {
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

    moreLikeThisButton.addEventListener("click", async () => {
      if (!hasMoreTraits) {
        return;
      }
      try {
        await ensureStoredImageContext(result, getActiveImageContextForResult(result).matchingImage);
      } catch (error) {
        console.warn("[inline-refinement] stored image context fetch failed:", error?.message || error);
      }
      toggleInlineRefinementPanel({
        productId: result.product_id,
        mode: "more",
        imageUrl: state.activeCardImageUrls[result.product_id] || result.best_image_url
      });
    });
    lessLikeThisButton.addEventListener("click", async () => {
      if (!hasLessTraits) {
        return;
      }
      try {
        await ensureStoredImageContext(result, getActiveImageContextForResult(result).matchingImage);
      } catch (error) {
        console.warn("[inline-refinement] stored image context fetch failed:", error?.message || error);
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
  const effectiveCategoryFilter = normalizedQuery ? [] : categoryFilter;
  const refreshAgeFilter = String(options.refreshAgeFilter ?? state.refreshAgeFilter ?? "").trim();
  const imageAnalysis = options.imageAnalysis && typeof options.imageAnalysis === "object" ? options.imageAnalysis : null;
  const isPublicSeedQuery = Boolean(
    !imageAnalysis &&
    typeof HOME_PATH === "string" &&
    HOME_PATH === "/" &&
    isSeedQuery(normalizedQuery)
  );
  const requestedCategoryScopeMode = String(
    options.categoryScopeMode ||
    state.categoryScopeMode ||
    "all"
  ).trim().toLowerCase();
  const normalizedOptionVisualType = normalizeVisualTypeKey(
    String(options.visualType ?? options.seatingType ?? "").trim().toLowerCase() === "all"
      ? ""
      : (options.visualType ?? options.seatingType ?? "")
  );
  const normalizedScopeVisualType = getPrimaryCategoryScopeSelection(state.resultCategoryScope) === "all"
    ? ""
    : getPrimaryCategoryScopeSelection(state.resultCategoryScope);
  const inferredVisualTypeFromQuery = !normalizedOptionVisualType && !imageAnalysis && !isPublicSeedQuery
    ? detectCategoryScopeFromQuery(normalizedQuery)
    : "";
  const requestedVisualType = String(
    normalizedOptionVisualType ??
    normalizedScopeVisualType ??
    inferredVisualTypeFromQuery ??
    imageAnalysis?.stage1?.visual_type ??
    imageAnalysis?.visual_type ??
    imageAnalysis?.stage1?.seating_type ??
    imageAnalysis?.seating_type ??
    ""
  ).trim();
  const {
    effectiveCategoryScopeMode,
    apiRequestedVisualType
  } = resolveSearchVisualTypeRequest({
    requestedCategoryScopeMode,
    explicitVisualType: requestedVisualType,
    inferredVisualTypeFromQuery
  });
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
  const useStreamedTextProgress = Boolean(normalizedQuery && !imageAnalysis && !isSeedQuery(normalizedQuery));
  const useCachedSearchStrip = isPublicSeedQuery;
  if (useCachedSearchStrip) {
    setResultsLoading("");
    startCachedSearchProgressStrip();
  } else {
    setResultsLoading(
      normalizedQuery
        ? (useStreamedTextProgress
            ? {
                step: "parse",
                percent: 10,
                percentLabel: getTextSearchStepConfig("parse").percentLabel,
                indeterminate: true,
                title: "Understanding your query...",
                copy: "Figuring out what you're looking for."
              }
            : "Embedding the visual query and ranking image captions...")
        : "Loading catalog products..."
    );
  }

  try {
    const shouldUsePostSearch = Boolean(imageAnalysis || apiRequestedVisualType);
    const postRequestBody = {
      q: normalizedQuery,
      source_image_url: sourceImageUrl,
      sort,
      category: effectiveCategoryFilter,
      refresh_age: refreshAgeFilter,
      ...(apiRequestedVisualType ? { visual_type: apiRequestedVisualType } : {}),
      image_analysis: imageAnalysis,
      selected_bullets: requestedSelectedBullets
    };
    const getRequestUrl = `/api/search?${new URLSearchParams([
      ["q", normalizedQuery],
      ["source_image_url", sourceImageUrl],
      ["sort", sort],
      ...(apiRequestedVisualType ? [["visual_type", apiRequestedVisualType]] : []),
      ...effectiveCategoryFilter.map((category) => ["category", category]),
      ["refresh_age", refreshAgeFilter]
    ]).toString()}`;
    const payload = useStreamedTextProgress
      ? await fetchJsonStream(shouldUsePostSearch ? "/api/search" : getRequestUrl, shouldUsePostSearch
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(postRequestBody)
          }
        : undefined, {
            onProgress: (event) => {
              const phaseToStep = {
                parsing: "parse",
                parsed: "parse",
                embedding: "embed",
                database: "search",
                reranking: "rank"
              };
              const stepId = phaseToStep[String(event?.phase || "").trim()] || "parse";
              const stepMeta = getTextSearchStepConfig(stepId);
              setResultsLoading({
                step: stepId,
                percent: stepMeta.percent,
                percentLabel: stepMeta.percentLabel,
                indeterminate: true,
                title: String(event?.title || "Searching...").trim(),
                copy: String(event?.detail || "").trim()
              });
            }
          })
      : shouldUsePostSearch
        ? await fetchJson("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(postRequestBody)
          })
        : await fetchJson(getRequestUrl);
    if (payload?.category_required && effectiveCategoryScopeMode === "all" && !apiRequestedVisualType) {
      setInitialSearchPending(false);
      state.lastQuery = normalizedQuery;
      state.lastPayload = { ...payload, results: [] };
      state.currentVisualType = "";
      state.resultCategoryScope = ["all"];
      state.categoryScopeMode = "all";
      state.currentSelectedBullets = requestedSelectedBullets;
      state.currentBulletControls = requestedBulletControls;
      updateClarificationConflict(null);
      updateCategoryRequirement({
        query: normalizedQuery,
        options: Array.isArray(payload?.visual_type_options) ? payload.visual_type_options : Array.isArray(payload?.seating_category_options) ? payload.seating_category_options : CATEGORY_REQUIREMENT_OPTION_KEYS,
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
    const effectiveVisualType = String(
      apiRequestedVisualType ||
      getPayloadVisualType(payload) ||
      payload?.text_query_traits?.enum_fields?.visual_type ||
      payload?.text_query_traits?.enum_fields?.seating_type ||
      ""
    ).trim();
    const normalizedStoredQuery = payload?.seating_type_source === "inferred" && effectiveVisualType
      ? buildSearchQueryFromComposer(
          effectiveVisualType,
          stripCategoryScopeFromQuery(
            String(payload?.parsed?.visual_query || normalizedQuery).trim(),
            effectiveVisualType
          )
        )
      : normalizedQuery;
    applyActiveSearchContext({
      payload,
      query: normalizedStoredQuery,
      selectedBullets: effectiveSelectedBullets,
      bulletControls: effectiveBulletControls,
      baseQueryEmbedding: payload?.query_embedding,
      visualType: effectiveVisualType,
      imageAnalysis,
      productRefinements,
      categoryFilter: payload?.category_filter ?? effectiveCategoryFilter,
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
  } finally {
    if (useCachedSearchStrip) {
      finishCachedSearchProgressStrip();
    }
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

function setSelectedUploadFile(file = null) {
  state.selectedUploadFile = file || null;
  if (elements.selectedFileName) {
    elements.selectedFileName.textContent = file ? file.name : "";
    elements.selectedFileName.hidden = !file;
  }
  if (elements.imageUrlInput && file) {
    elements.imageUrlInput.value = "";
  }
}

function openImageModalWithFile(file = null) {
  openImageModal();
  if (file) {
    setSelectedUploadFile(file);
  }
}

function extractDroppedImageFile(dataTransfer = null) {
  const files = Array.from(dataTransfer?.files || []);
  return files.find((file) => String(file?.type || "").startsWith("image/")) || null;
}

function closeImageModal() {
  elements.imageModal.hidden = true;
  document.body.classList.remove("modal-open");
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
  if (elements.imageModal.hidden && elements.promptLibraryModal.hidden && elements.extractionSummaryModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

async function openPromptLibraryModal() {
  if (elements.promptLibraryContent) {
    elements.promptLibraryContent.innerHTML = '<p class="rules-summary-intro">Loading prompts...</p>';
  }
  if (elements.copyPromptLibraryStatus) {
    elements.copyPromptLibraryStatus.hidden = true;
  }
  elements.promptLibraryModal.hidden = false;
  document.body.classList.add("modal-open");
  state.promptLibrary = await fetchPromptLibrary();
  renderPromptLibraryModalContent();
}

function closePromptLibraryModal() {
  elements.promptLibraryModal.hidden = true;
  if (elements.imageModal.hidden && elements.structuredTraitsModal.hidden && elements.extractionSummaryModal.hidden) {
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
  if (elements.imageModal.hidden && elements.structuredTraitsModal.hidden && elements.promptLibraryModal.hidden) {
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
  state.imageAnalysisCategorySelection = null;
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
      visual_type: String(options.visualType || options.seatingType || getPayloadVisualType(state.currentImageAnalysis) || ""),
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
    .map((trait) => ({
      field: trait.field,
      label: formatInlineRefinementFieldLabel(trait.field),
      old_value: trait.action === "add" ? "" : String(trait.existingValue || "").trim(),
      new_value: trait.action === "remove" ? "" : String(trait.value || "").trim(),
      action: trait.action
    }));
}

async function requestImageAnalysis(body, options = {}) {
  const progressRequestId = String(options.progressRequestId || "").trim();
  return fetchJson("/api/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      ...(progressRequestId ? { progress_request_id: progressRequestId } : {})
    })
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load the selected image."));
    image.src = src;
  });
}

async function prepareUploadImageDataUrl(file, options = {}) {
  const maxDimension = Number(options.maxDimension || QUERY_IMAGE_UPLOAD_MAX_DIMENSION) || QUERY_IMAGE_UPLOAD_MAX_DIMENSION;
  const jpegQuality = Number(options.jpegQuality || QUERY_IMAGE_UPLOAD_JPEG_QUALITY) || QUERY_IMAGE_UPLOAD_JPEG_QUALITY;
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const naturalWidth = Number(image.naturalWidth || image.width || 0);
  const naturalHeight = Number(image.naturalHeight || image.height || 0);

  if (!naturalWidth || !naturalHeight) {
    return originalDataUrl;
  }

  const longestSide = Math.max(naturalWidth, naturalHeight);
  const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
  const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    return originalDataUrl;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  try {
    const optimizedDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    return optimizedDataUrl || originalDataUrl;
  } catch {
    return originalDataUrl;
  }
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

async function runImageAnalysisSearch(requestBody = null, focusArea = null, options = {}) {
  const baseInput = requestBody && typeof requestBody === "object"
    ? requestBody
    : state.lastAnalyzeInput;
  if (!baseInput) {
    setStatus("Choose an image file or paste an image URL first.", "error");
    return;
  }

  const body = focusArea ? { ...baseInput, focus_area: focusArea } : { ...baseInput };
  const cachedCategory = String(options.visualTypeOverride || options.seatingTypeOverride || getCachedImageAnalysisCategory(baseInput) || "").trim();
  const progressRequestId = buildImageAnalyzeProgressRequestId();
  setImageAnalyzeLoading(true);
  startImageAnalyzeProgressPolling(progressRequestId);
  state.imageAnalyzePrepareStartedAt = Date.now();
  state.imageAnalyzeClassifyStartedAt = 0;
  updateImageAnalyzeProgress("prepare", {
    percent: 0,
    percentLabel: "0–15%",
    detail: focusArea
      ? "Preparing the selected crop for image analysis."
      : "Preparing the full image for analysis.",
    indeterminate: true
  });
  setStatus(focusArea ? "Analyzing the selected focus area..." : "Analyzing the full image...");

  let analysis = null;
  try {
    let analysisPayload;
    if (!cachedCategory) {
      const stage1Payload = await requestImageAnalysis({
        ...body,
        stage1_only: true
      }, {
        progressRequestId
      });
      if (stage1Payload?.category_required) {
        closeImageModal();
        updateClarificationConflict(null);
        updateCategoryRequirement({
          mode: "image_analysis",
          options: Array.isArray(stage1Payload?.visual_type_options) && stage1Payload.visual_type_options.length
            ? stage1Payload.visual_type_options
            : Array.isArray(stage1Payload?.seating_category_options) && stage1Payload.seating_category_options.length
              ? stage1Payload.seating_category_options
              : CATEGORY_REQUIREMENT_OPTION_KEYS,
          message: "What kind of product are you looking for?\nWe couldn't quite tell from the image.",
          requestBody: baseInput,
          focusArea: focusArea ? normalizeFocusArea(focusArea) : null
        });
        setStatus("");
        return;
      }
      const resolvedType = String(
        getPayloadVisualType(stage1Payload?.analysis) ||
        getPayloadVisualType(stage1Payload?.analysis?.stage1) ||
        ""
      ).trim();
      updateImageAnalyzeProgress("extract", {
        percent: 30,
        percentLabel: "30–85%",
        detail: "Extracting visual traits...",
        indeterminate: true,
        extractTarget: resolveImageAnalyzeExtractTarget(1, 2)
      });
      analysisPayload = await requestImageAnalysis({
        ...body,
        visual_type_override: resolvedType
      }, {
        progressRequestId
      });
    } else {
      updateImageAnalyzeProgress("extract", {
        percent: 30,
        percentLabel: "30–85%",
        detail: `Extracting visual traits as ${formatVisualTypeLabel(cachedCategory, state.bootstrap)}.`,
        indeterminate: true,
        extractTarget: resolveImageAnalyzeExtractTarget(1, 2)
      });
      analysisPayload = await requestImageAnalysis({
        ...body,
        visual_type_override: cachedCategory
      }, {
        progressRequestId
      });
    }
    analysis = analysisPayload?.analysis || null;
    if (analysis && typeof analysis === "object") {
      analysis = {
        ...analysis,
        reference_image_mode: "uploaded"
      };
    }
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
    applyImageAnalyzeBackendProgressEvent({ type: "refine_started" });
    updateImageAnalyzeProgress("match", {
      percent: 90,
      percentLabel: "90%",
      detail: "Matching against catalog",
      indeterminate: false
    });
    const payload = await refineSearchResults({
      queryEmbedding,
      selectedBullets,
      visualType: getPayloadVisualType(analysis) || getPayloadVisualType(analysis?.stage1) || "",
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
      visualType: getPayloadVisualType(analysis) || getPayloadVisualType(analysis?.stage1) || "",
      imageAnalysis: analysis,
      productRefinements: [],
      categoryFilter: payload?.category_filter ?? state.categoryFilter,
      refreshAgeFilter: payload?.refresh_age_filter ?? state.refreshAgeFilter,
      preserveOriginal: false,
      refinementActive: false
    });
    updateImageAnalyzeProgress("complete", {
      percent: 100,
      percentLabel: "100%",
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
        visualType: getPayloadVisualType(analysis) || getPayloadVisualType(analysis?.stage1) || "",
        visualType: getPayloadVisualType(analysis) || getPayloadVisualType(analysis?.stage1) || "",
        imageAnalysis: analysis,
        categoryFilter: payload?.category_filter ?? state.categoryFilter,
        refreshAgeFilter: payload?.refresh_age_filter ?? state.refreshAgeFilter
      });
      redirectToBrowseResults(resolvedQuery, {
        visual_type: getPayloadVisualType(analysis) || getPayloadVisualType(analysis?.stage1) || ""
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
    const dataUrl = await prepareUploadImageDataUrl(file);
    body = {
      file_name: file.name,
      image_data_url: dataUrl
    };
    previewUrl = dataUrl;
  } else {
    body = { image_url: imageUrl };
    previewUrl = imageUrl;
  }

  const nextSelectionKey = buildImageAnalysisSelectionKey(body);
  if (state.imageAnalysisCategorySelection?.key && state.imageAnalysisCategorySelection.key !== nextSelectionKey) {
    state.imageAnalysisCategorySelection = null;
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
    state.traitFilters = {};
    state.originalCategoryFilter = [];
    state.originalResultCategoryScope = ["all"];
    state.originalCategoryScopeMode = "all";
    state.originalRefreshAgeFilter = "";
    state.categoryScopeLoading = false;
    syncManageToolbar();
    syncHomePathUi();
    state.bootstrap = await fetchJson("/api/bootstrap");
    renderAppVersion(state.bootstrap?.version || "");
    renderCategoryFilterOptions(state.bootstrap.categories || []);
    renderSearchComposer();
    if (elements.refreshAgeFilterSelect) {
      elements.refreshAgeFilterSelect.value = "";
    }
    if (elements.sortSelect) {
      elements.sortSelect.value = state.sortMode;
    }
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
    const initialCategoryScope = normalizeCategoryScopeSelection(launchParams.get("visual_type") || launchParams.get("seating_type"), { maxSelections: 1 });
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
      const isHomepageImageExample = pendingImageSearchHandoff?.source === "homepage-image-example";
      const isHomepageSeedQuery = !pendingImageSearchHandoff && isSeedQuery(initialQuery);
      const initialLoadingMode = isHomepageImageExample || isHomepageSeedQuery ? "quick" : "text";
      setResultsLoading(
        isHomepageImageExample
          ? {
              mode: "quick",
              step: "search",
              percent: 42,
              indeterminate: true,
              title: "Opening image results...",
              detail: "Loading matches inspired by the selected reference image."
            }
          : isHomepageSeedQuery
            ? {
                mode: "quick",
                step: "search",
                percent: 38,
                indeterminate: true,
                title: "Opening suggested search...",
                detail: "Loading curated results for this suggestion."
              }
            : "Embedding the visual query and ranking image captions..."
      );
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
      if (!pendingImageSearchHandoff.payload && Array.isArray(pendingImageSearchHandoff.baseQueryEmbedding) && pendingImageSearchHandoff.baseQueryEmbedding.length) {
        const payload = await refineSearchResults({
          queryEmbedding: pendingImageSearchHandoff.baseQueryEmbedding,
          selectedBullets: pendingImageSearchHandoff.selectedBullets,
          visualType: resolveStoredVisualType(pendingImageSearchHandoff),
          categoryFilter: pendingImageSearchHandoff.categoryFilter,
          refreshAgeFilter: pendingImageSearchHandoff.refreshAgeFilter,
          sourceImageUrl: pendingImageSearchHandoff.imageAnalysis?.image_preview_url || ""
        });
        pendingImageSearchHandoff.payload = payload;
      }
      applyActiveSearchContext({
        payload: pendingImageSearchHandoff.payload,
        query: pendingImageSearchHandoff.query,
        selectedBullets: pendingImageSearchHandoff.selectedBullets,
        bulletControls: pendingImageSearchHandoff.bulletControls,
        baseQueryEmbedding: pendingImageSearchHandoff.baseQueryEmbedding,
        visualType: resolveStoredVisualType(pendingImageSearchHandoff),
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
        visualType: initialPrimaryCategory || "all",
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

elements.closeDescriptionAuditModal?.addEventListener("click", () => {
  closeDescriptionAuditModal();
});

elements.debugLightboxCloseTargets?.forEach((target) => {
  target.addEventListener("click", () => {
    closeDebugLightbox();
  });
});

elements.descriptionAuditModalCloseTargets?.forEach((target) => {
  target.addEventListener("click", () => {
    closeDescriptionAuditModal();
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
    return;
  }
  if (event.key === "Escape" && elements.descriptionAuditModal && !elements.descriptionAuditModal.hidden) {
    closeDescriptionAuditModal();
  }
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const selectedCategory = elements.searchCategorySelect?.value || "all";
  const shouldClearInheritedCategory = Boolean(
    selectedCategory !== "all" &&
    state.searchInputEditedSinceLastSearch &&
    !state.categorySelectionTouchedSinceLastSearch
  );
  const requestQuery = shouldClearInheritedCategory
    ? getSearchComposerTextParts().plain || getSearchInputValue() || state.lastQuery || ""
    : getSearchComposerRequestQuery();
  const effectiveCategory = shouldClearInheritedCategory ? "all" : selectedCategory;
  const effectiveCategoryScopeMode = effectiveCategory === "all" ? "all" : "explicit";
  if (shouldClearInheritedCategory) {
    state.resultCategoryScope = ["all"];
    state.categoryScopeMode = "all";
    renderSearchComposer(requestQuery);
  }
  if (state.landingOnlyMode) {
    enterBrowseMode(requestQuery, {
      visual_type: effectiveCategory
    });
  }
  runSearch(requestQuery, {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    visualType: effectiveCategory,
    categoryScopeMode: effectiveCategoryScopeMode
  });
});

elements.searchInput?.addEventListener("input", () => {
  state.searchInputEditedSinceLastSearch = true;
  autoResizeSearchInput();
  updateSearchComposerClearButton();
});

elements.searchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.searchForm?.requestSubmit();
  }
});

elements.clearSearchInputButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearSearchComposer();
});

elements.siteNavBrandLink?.addEventListener("click", (event) => {
  event.preventDefault();
  window.location.href = HOME_PATH;
});

elements.sortSelect?.addEventListener("change", () => {
  state.sortMode = elements.sortSelect.value || "auto";
  runSearch(getSearchComposerRequestQuery(state.lastQuery), {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    visualType: getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all",
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
    visualType: getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all",
    categoryScopeMode: state.categoryScopeMode,
    sourceImageUrl: state.currentImageAnalysis?.image_preview_url || "",
    imageAnalysis: state.currentImageAnalysis,
    selectedBullets: state.currentSelectedBullets,
    bulletControls: state.currentBulletControls
  });
});

elements.browseTraitFilterFields?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  const fieldKey = normalizeTraitFieldKey(target.dataset.field || "");
  if (!fieldKey) {
    return;
  }

  const nextValue = normalizeTraitValue(target.value);
  if (!nextValue) {
    delete state.traitFilters[fieldKey];
  } else {
    state.traitFilters[fieldKey] = nextValue;
  }

  renderBrowseTraitFilters(state.lastPayload, state.lastQuery);
  renderResults(state.lastPayload, state.lastQuery);
});

elements.resetBrowseTraitFilters?.addEventListener("click", () => {
  if (!Object.keys(normalizeTraitFilterState(state.traitFilters)).length) {
    return;
  }
  clearBrowseTraitFilters();
  renderBrowseTraitFilters(state.lastPayload, state.lastQuery);
  renderResults(state.lastPayload, state.lastQuery);
});

elements.searchCategorySelect?.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  await handleCategoryScopeSelectionChange(target.value);
});

elements.browseCategorySelect?.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  if (elements.searchCategorySelect && elements.searchCategorySelect.value !== target.value) {
    elements.searchCategorySelect.value = target.value;
  }
  await handleCategoryScopeSelectionChange(target.value);
});

elements.refreshAgeFilterSelect?.addEventListener("change", () => {
  state.refreshAgeFilter = elements.refreshAgeFilterSelect.value || "";
  runSearch(getSearchComposerRequestQuery(state.lastQuery), {
    sort: state.sortMode,
    categoryFilter: state.categoryFilter,
    refreshAgeFilter: state.refreshAgeFilter,
    visualType: getPrimaryCategoryScopeSelection(state.resultCategoryScope) || "all",
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
  returnToHomepageState();
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
elements.openImageSearchInline?.addEventListener("click", () => {
  openImageModal();
});
elements.imageSearchDropZone?.addEventListener("dragenter", (event) => {
  event.preventDefault();
});
elements.imageSearchDropZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
});
elements.imageSearchDropZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = extractDroppedImageFile(event.dataTransfer);
  if (!file) {
    setStatus("Drop a JPG or PNG image to start an image search.", "error");
    return;
  }
  openImageModalWithFile(file);
});
elements.closeImageModal.addEventListener("click", closeImageModal);
elements.openPromptLibrary?.addEventListener("click", async () => {
  try {
    await openPromptLibraryModal();
  } catch (error) {
    closePromptLibraryModal();
    setStatus(error.message || "Failed to load prompt library.", "error");
  }
});
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
elements.closePromptLibraryModal?.addEventListener("click", closePromptLibraryModal);
elements.closeExtractionSummaryModal?.addEventListener("click", closeExtractionSummaryModal);
elements.closeStructuredTraitsModal?.addEventListener("click", closeStructuredTraitsModal);
elements.copyPromptLibraryModalButton?.addEventListener("click", async () => {
  try {
    await copyPromptLibraryPrompt();
  } catch (error) {
    setStatus(error.message, "error");
  }
});
elements.copyStructuredTraitsModalButton?.addEventListener("click", async () => {
  try {
    await copyStructuredTraitsSummary();
  } catch (error) {
    setStatus(error.message, "error");
  }
});
elements.imageModalCloseTargets.forEach((target) => target.addEventListener("click", closeImageModal));
elements.promptLibraryModalCloseTargets.forEach((target) => target.addEventListener("click", closePromptLibraryModal));
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
  if (event.key === "Escape" && !elements.promptLibraryModal.hidden) {
    closePromptLibraryModal();
    return;
  }
});

elements.imageUploadButton.addEventListener("click", () => {
  elements.imageUploadInput.click();
});

elements.imageUploadInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  setSelectedUploadFile(file || null);
});

elements.imageUrlInput.addEventListener("input", () => {
  if (elements.imageUrlInput.value.trim()) {
    setSelectedUploadFile(null);
    elements.imageUploadInput.value = "";
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
    await runImageAnalysisSearch(null, focusArea);
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
