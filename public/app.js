const state = {
  debug: false,
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
  manageMode: false,
  selectedProductIds: new Set(),
  sortMode: "auto",
  currentBaseQueryEmbedding: [],
  currentQueryEmbedding: [],
  currentSelectedBullets: { essential: [], normal: [] },
  currentBulletControls: [],
  currentSeatingType: "",
  currentImageAnalysis: null,
  currentProductRefinements: [],
  originalPayload: null,
  originalQuery: "",
  originalBaseQueryEmbedding: [],
  originalQueryEmbedding: [],
  originalSelectedBullets: { essential: [], normal: [] },
  originalBulletControls: [],
  originalSeatingType: "",
  originalImageAnalysis: null,
  originalProductRefinements: [],
  refinementActive: false,
  refinementLoading: false,
  refineDrawerOpen: false,
  batchRefreshProgress: null,
  batchRefreshProgressVisible: false,
  batchRefreshPollTimer: null
};

const focusDrag = {
  active: false,
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
  skipFocusButton: document.querySelector("#skipFocusButton"),
  applyFocusButton: document.querySelector("#applyFocusButton"),
  modalTitle: document.querySelector("#modalTitle"),
  imageModalCloseTargets: document.querySelectorAll('[data-role="imageModalClose"]'),
  rulesModalCloseTargets: document.querySelectorAll('[data-role="rulesModalClose"]'),
  structuredTraitsModalCloseTargets: document.querySelectorAll('[data-role="structuredTraitsModalClose"]'),
  openImageSearch: document.querySelector("#openImageSearch"),
  openRulesSummary: document.querySelector("#openRulesSummary"),
  copyStructuredTraits: document.querySelector("#copyStructuredTraits"),
  copyStructuredTraitsModalButton: document.querySelector("#copyStructuredTraitsModalButton"),
  copyStructuredTraitsStatus: document.querySelector("#copyStructuredTraitsStatus"),
  rulesSummaryDetails: document.querySelector("#rulesSummaryDetails"),
  structuredTraitsText: document.querySelector("#structuredTraitsText"),
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
  batchRefreshLog: document.querySelector("#batchRefreshLog"),
  batchRefreshSummary: document.querySelector("#batchRefreshSummary"),
  batchRefreshFailures: document.querySelector("#batchRefreshFailures"),
  batchRefreshCloseButton: document.querySelector("#batchRefreshCloseButton"),
  sortSelect: document.querySelector("#sortSelect"),
  resetSearchButton: document.querySelector("#resetSearchButton"),
  refineBulletsList: document.querySelector("#refineBulletsList"),
  refineDrawerBackdrop: document.querySelector("#refineDrawerBackdrop"),
  refineProductsList: document.querySelector("#refineProductsList"),
  reopenFocusOverlay: document.querySelector("#reopenFocusOverlay"),
  refineToggleButton: document.querySelector("#refineToggleButton"),
  resultsLayout: document.querySelector(".results-layout"),
  resultsSidebar: document.querySelector("#resultsSidebar"),
  resultCount: document.querySelector("#resultCount"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  seedQueries: document.querySelector("#seedQueries"),
  selectedFileName: document.querySelector("#selectedFileName"),
  statusPanel: document.querySelector("#statusPanel"),
  uploadSupportNote: document.querySelector("#uploadSupportNote"),
  analyzeImageButton: document.querySelector("#analyzeImageButton"),
  imageAnalyzeLoading: document.querySelector("#imageAnalyzeLoading")
};

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

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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
    return {
      essential: [],
      normal: normalizePriorityBulletList(selectedBullets)
    };
  }

  if (!selectedBullets || typeof selectedBullets !== "object") {
    return { essential: [], normal: [] };
  }

  return {
    essential: normalizePriorityBulletList(selectedBullets.essential || []),
    normal: normalizePriorityBulletList(selectedBullets.normal || [])
  };
}

function hasSelectedBullets(selectedBullets = []) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  return normalized.essential.length + normalized.normal.length > 0;
}

function normalizeBulletControls(bulletControls = []) {
  const seen = new Set();
  const normalized = [];

  for (const entry of bulletControls || []) {
    const text = String(entry?.text || entry?.value || "").trim();
    const priority = entry?.priority === "essential" || entry?.priority === "off" ? entry.priority : "normal";
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
  return normalizePriorityBulletList(bullets).map((text) => ({ text, priority: "normal" }));
}

function deriveSelectedBulletsFromControls(bulletControls = []) {
  const selected = { essential: [], normal: [] };

  for (const entry of normalizeBulletControls(bulletControls)) {
    if (entry.priority === "essential") {
      selected.essential.push(entry.text);
    } else if (entry.priority === "normal") {
      selected.normal.push(entry.text);
    }
  }

  return selected;
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
  return [...normalized.essential, ...normalized.normal].join(", ");
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

function closeBatchRefreshStream() {
  if (state.batchRefreshPollTimer) {
    clearInterval(state.batchRefreshPollTimer);
    state.batchRefreshPollTimer = null;
  }
}

function normalizeBatchRefreshProgress(payload = {}) {
  const total = Math.max(0, Number(payload.total) || 0);
  const completed = Math.max(0, Number(payload.completed) || 0);
  const failed = Math.max(0, Number(payload.failed) || 0);
  const left = Math.max(0, Number(payload.left) || Math.max(total - completed, 0));
  const batchCurrent = Math.max(0, Number(payload.batch_current) || 0);
  const batchTotal = Math.max(0, Number(payload.batch_total) || 0);
  const done = Boolean(payload.done);

  return {
    status: done ? "complete" : (payload.running ? "running" : "idle"),
    total,
    completed,
    succeeded: Math.max(0, completed - failed),
    failed,
    left,
    batchCurrent,
    batchTotal,
    currentProductName: String(payload.current_product || "").trim(),
    log: Array.isArray(payload.log) ? payload.log.slice(0, 8) : [],
    failedProducts: Array.isArray(payload.failed_products) ? payload.failed_products : []
  };
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
  elements.batchRefreshSummary.textContent = `Done: ${progress.succeeded}  Failed: ${progress.failed}  Left: ${progress.left}`;
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
  renderBatchRefreshProgress();
  syncManageToolbar();
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
  action = "",
  productId = ""
} = {}) {
  return fetchJson("/api/refine-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      selected_bullets: normalizeSelectedBullets(selectedBullets),
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
  selectedBullets = { essential: [], normal: [] },
  bulletControls = [],
  baseQueryEmbedding = null,
  seatingType = "",
  imageAnalysis = null,
  productRefinements = [],
  preserveOriginal = false,
  refinementActive = false
}) {
  state.currentBaseQueryEmbedding = Array.isArray(baseQueryEmbedding) ? [...baseQueryEmbedding] : Array.isArray(payload?.query_embedding) ? payload.query_embedding : [];
  state.currentQueryEmbedding = Array.isArray(payload?.query_embedding) ? payload.query_embedding : [];
  state.currentSelectedBullets = normalizeSelectedBullets(selectedBullets);
  state.currentBulletControls = normalizeBulletControls(
    bulletControls.length ? bulletControls : [
      ...state.currentSelectedBullets.essential.map((text) => ({ text, priority: "essential" })),
      ...state.currentSelectedBullets.normal.map((text) => ({ text, priority: "normal" }))
    ]
  );
  state.currentSeatingType = String(seatingType || "").trim();
  state.currentImageAnalysis = imageAnalysis && typeof imageAnalysis === "object" ? cloneValue(imageAnalysis) : null;
  state.currentProductRefinements = normalizeProductRefinements(productRefinements);
  state.refinementActive = refinementActive;

  if (!preserveOriginal) {
    state.originalPayload = cloneValue(payload);
    state.originalQuery = query;
    state.originalBaseQueryEmbedding = Array.isArray(baseQueryEmbedding) ? [...baseQueryEmbedding] : Array.isArray(payload?.query_embedding) ? [...payload.query_embedding] : [];
    state.originalQueryEmbedding = Array.isArray(payload?.query_embedding) ? [...payload.query_embedding] : [];
    state.originalSelectedBullets = normalizeSelectedBullets(selectedBullets);
    state.originalBulletControls = normalizeBulletControls(state.currentBulletControls);
    state.originalSeatingType = String(seatingType || "").trim();
    state.originalImageAnalysis = imageAnalysis && typeof imageAnalysis === "object" ? cloneValue(imageAnalysis) : null;
    state.originalProductRefinements = normalizeProductRefinements(productRefinements);
  }

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
      seatingType: state.currentSeatingType
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
  const previousPayloadSnapshot = cloneValue(state.lastPayload);
  const nextControls = normalizeBulletControls(state.currentBulletControls.map((entry, currentIndex) =>
    currentIndex === index ? { ...entry, priority } : entry
  ));
  const nextSelectedBullets = deriveSelectedBulletsFromControls(nextControls);
  const nextQuery = await composeQueryWithFallback(nextSelectedBullets);
  elements.searchInput.value = nextQuery;

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
      statusMessage: "Updating bullet priorities..."
    });
    payload = reranked.payload;
    previousPayload = reranked.previousPayload;
  } else {
    payload = basePayload;
    previousPayload = previousPayloadSnapshot;
    setStatus("Updating bullet priorities...");
  }

  const changed = nextControls[index];
  if (changed) {
    const priorityLabel = changed.priority === "essential" ? "essential" : changed.priority === "off" ? "off" : "normal";
    setStatus(`Updated “${changed.text}” to ${priorityLabel}. ${summarizeRefinementChanges(previousPayload, payload, "around", changed.text)}`);
  }
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
    ["base_finish", "Base Finish"],
    ["frame", "Frame"],
    ["back_style", "Back"],
    ["arm_option", "Arms"],
    ["seat_upholstery", "Seat"],
    ["shell_material", "Shell"]
  ]);

  return Object.entries(imageTraits || {})
    .map(([field, value]) => {
      const fieldConfig = getTraitFieldConfig(typeKey, field);
      if (fieldConfig?.detectability === "no") {
        return "";
      }

      const normalized = String(value ?? "").trim();
      if (!normalized || normalized.toLowerCase() === "unknown") {
        return "";
      }
      return `${labels.get(field) || field.replace(/_/g, " ")}: ${normalized}`;
    })
    .filter(Boolean)
    .slice(0, limit);
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

      return {
        ...result,
        category: result.category,
        ai_refreshed_at: refreshedImage.ai_refreshed_at || result.ai_refreshed_at || "",
        matched_traits: result.matched_traits || matchedTraits,
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

function syncManageToolbar() {
  const showToolbar = hasVisibleResults();
  elements.batchManageBar.hidden = !showToolbar;
  if (!showToolbar) {
    return;
  }

  elements.manageSelectionButton.hidden = state.manageMode;
  elements.manageActions.hidden = !state.manageMode;
  const hasIndex = Boolean(state.bootstrap?.has_index);
  const showProgressBlock = state.manageMode && state.batchRefreshProgressVisible;
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
  elements.selectAllButton.disabled = state.batchRefreshing || !visibleIds.length || allVisibleSelected;
  elements.selectNoneButton.disabled = state.batchRefreshing || selectionCount === 0;
  if (elements.batchRefreshButton) {
    elements.batchRefreshButton.hidden = false;
    elements.batchRefreshButton.disabled = state.batchRefreshing || selectionCount === 0;
    elements.batchRefreshButton.textContent = state.batchRefreshing
      ? `Refreshing ${selectionCount || ""}`.trim()
      : hasIndex
        ? `Refresh AI Analysis${selectionCount ? ` (${selectionCount})` : ""}`
        : `Build AI Index${selectionCount ? ` (${selectionCount})` : ""}`;
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

function setImageAnalyzeLoading(isLoading) {
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
  elements.imageAnalyzeLoading.hidden = !isLoading;
  elements.analyzeImageButton.textContent = isLoading ? "Analyzing..." : "Analyze Image";
}

function renderFocusArea() {
  const area = normalizeFocusArea(state.focusArea);
  if (!area) {
    elements.focusBox.hidden = true;
    return;
  }
  elements.focusBox.hidden = false;
  elements.focusBox.style.left = `${(area.x * 100).toFixed(3)}%`;
  elements.focusBox.style.top = `${(area.y * 100).toFixed(3)}%`;
  elements.focusBox.style.width = `${(area.width * 100).toFixed(3)}%`;
  elements.focusBox.style.height = `${(area.height * 100).toFixed(3)}%`;
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
  const boxRect = elements.focusBox.getBoundingClientRect();
  const nearResizeHandle =
    boxRect.right - event.clientX < 18 &&
    boxRect.bottom - event.clientY < 18;
  if (nearResizeHandle) return;
  event.preventDefault();
  focusDrag.active = true;
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
  const next = {
    ...focusDrag.startArea,
    x: focusDrag.startArea.x + deltaX,
    y: focusDrag.startArea.y + deltaY
  };
  setFocusArea(next);
}

function stopFocusDrag() {
  if (!focusDrag.active) return;
  focusDrag.active = false;
  focusDrag.startArea = captureFocusAreaFromDom() || state.focusArea;
}

function setStatus(message, kind = "info") {
  elements.statusPanel.className = `status-panel ${kind}`;
  elements.statusPanel.textContent = message || "";
}

function reportClientError(error, context = "Client error") {
  const message = error instanceof Error
    ? `${context}: ${error.message}`
    : `${context}: ${String(error || "Unknown error")}`;
  console.error(error);
  setStatus(message, "error");
}

function renderContextPills(parsed = {}) {
  elements.contextPills.innerHTML = "";
  const entries = [];

  if (parsed.category) {
    entries.push(parsed.category);
  }
  if (parsed.brand) {
    entries.push(`Brand: ${parsed.brand}`);
  }

  for (const entry of entries) {
    const pill = document.createElement("span");
    pill.className = "context-pill";
    pill.textContent = entry;
    elements.contextPills.appendChild(pill);
  }
}

function renderSeedQueries(seedQueries) {
  elements.seedQueries.innerHTML = "";
  seedQueries.forEach((query) => {
    const button = document.createElement("button");
    button.className = "seed-query";
    button.type = "button";
    button.textContent = query;
    button.addEventListener("click", () => {
      elements.searchInput.value = query;
      runSearch(query);
    });
    elements.seedQueries.appendChild(button);
  });
}

function createChip(text, muted = false) {
  const chip = document.createElement("span");
  chip.className = muted ? "chip muted" : "chip";
  chip.textContent = text;
  return chip;
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
    `Selected bullet boost: essential ${formatNumber(0.35)} each, normal ${formatNumber(0.1)} each, capped at ${formatNumber(0.5)}`,
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
  const nextPriority = priority === "essential" || priority === "off" ? priority : "normal";
  button.dataset.priority = nextPriority;
  button.classList.toggle("is-active", button.dataset.value === nextPriority);
}

function renderRefineSidebar() {
  if (!elements.resultsSidebar || !elements.refineBulletsList || !elements.refineProductsList || !elements.refineToggleButton || !elements.resultsLayout) {
    return;
  }

  const showSidebar = Boolean(state.lastQuery && state.currentBulletControls.length);
  elements.resultsLayout.classList.toggle("has-sidebar", showSidebar);
  elements.resultsSidebar.hidden = !showSidebar;
  elements.refineToggleButton.hidden = !showSidebar;
  elements.refineBulletsList.innerHTML = "";
  elements.refineProductsList.innerHTML = "";

  if (!showSidebar) {
    if (elements.reopenFocusOverlay) {
      elements.reopenFocusOverlay.hidden = true;
    }
    syncRefineDrawer();
    return;
  }

  if (elements.reopenFocusOverlay) {
    elements.reopenFocusOverlay.hidden = !state.lastAnalyzeInput;
  }

  state.currentBulletControls.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "refine-bullet-row";

    const copy = document.createElement("span");
    copy.className = "refine-bullet-text";
    copy.textContent = entry.text;

    const toggle = document.createElement("div");
    toggle.className = "priority-toggle";

    const states = [
      { value: "essential", label: "!!", title: "Essential" },
      { value: "normal", label: "✓", title: "Normal" },
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
        if (state.refinementLoading || state.currentBulletControls[index]?.priority === stateOption.value) {
          return;
        }
        updateBulletPriority(index, stateOption.value);
      });
      toggle.appendChild(button);
    });

    row.append(copy, toggle);
    elements.refineBulletsList.appendChild(row);
  });

  if (!state.currentProductRefinements.length) {
    const empty = document.createElement("p");
    empty.className = "refine-empty";
    empty.textContent = "Use “More like this +” or “Less like this −” on a result card to blend product embeddings.";
    elements.refineProductsList.appendChild(empty);
  } else {
    state.currentProductRefinements.forEach((refinement) => {
      const row = document.createElement("div");
      row.className = "refine-product-row";

      const copy = document.createElement("div");
      copy.className = "refine-product-copy";

      const name = document.createElement("p");
      name.className = "refine-product-name";
      name.textContent = refinement.name;

      const meta = document.createElement("p");
      meta.className = "refine-product-meta";
      meta.textContent = refinement.action === "more" ? "Blending toward this product" : "Blending away from this product";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "rules-summary-button refine-product-remove";
      remove.textContent = "Remove";
      remove.disabled = state.refinementLoading;
      remove.addEventListener("click", () => {
        removeProductRefinement(refinement.id);
      });

      copy.append(name, meta);
      row.append(copy, remove);
      elements.refineProductsList.appendChild(row);
    });
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

  if (isPresentBulletValue(imageTraits.arm_option) && String(imageTraits.arm_option).trim().toLowerCase() !== "none") {
    bullets.push(imageTraits.arm_option);
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

function renderThumbnails(container, result, heroImage) {
  container.innerHTML = "";
  const imageUrls = (result.image_urls || []).slice(0, 6);

  if (imageUrls.length <= 1) {
    container.classList.add("thumbnail-strip-hidden");
    return;
  }

  container.classList.remove("thumbnail-strip-hidden");

  imageUrls.forEach((imageUrl, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail-button";
    if (imageUrl === result.best_image_url || index === 0) {
      button.classList.add("active");
    }

    const thumbnail = document.createElement("img");
    thumbnail.src = imageUrl;
    thumbnail.alt = `${result.name} alternate view ${index + 1}`;
    thumbnail.loading = "lazy";
    thumbnail.className = "thumbnail-image";

    button.addEventListener("click", () => {
      heroImage.src = imageUrl;
      container.querySelectorAll(".thumbnail-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });

    button.appendChild(thumbnail);
    container.appendChild(button);
  });
}

function renderResults(payload, query) {
  state.lastPayload = payload;
  state.lastQuery = query;
  if (payload.sort) {
    state.sortMode = payload.sort;
  }
  if (elements.sortSelect && elements.sortSelect.value !== state.sortMode) {
    elements.sortSelect.value = state.sortMode;
  }
  state.selectedProductIds = new Set(
    [...state.selectedProductIds].filter((productId) => payload.results.some((result) => result.product_id === productId))
  );
  elements.resultsGrid.innerHTML = "";
  syncManageToolbar();
  renderContextPills(payload.parsed);
  renderRefineSidebar();
  const isBrowseMode = !query || payload.browse_mode;

  if (!query) {
    elements.resultCount.textContent = `${payload.total_results} catalog products`;
    setStatus("Browsing the current catalog. Enter a query to narrow the grid by visual traits.");
  }

  if (!payload.results.length) {
    elements.resultCount.textContent = "0 results found";
    setStatus("No results matched that combination of category, brand, and visual traits.", "empty");
    return;
  }

  if (query) {
    setStatus("");
    elements.resultCount.textContent = `${payload.total_results} results found`;
  }

  payload.results.forEach((result, index) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const image = fragment.querySelector(".card-image");
    const scoreBadge = fragment.querySelector('[data-role="scoreBadge"]');
    const productName = fragment.querySelector(".product-name");
    const brandName = fragment.querySelector(".brand-name");
    const aiRefreshTime = fragment.querySelector('[data-role="aiRefreshTime"]');
    const categoryPill = fragment.querySelector(".category-pill");
    const refinementActions = fragment.querySelector('[data-role="refinementActions"]');
    const moreLikeThisButton = fragment.querySelector('[data-role="moreLikeThisButton"]');
    const lessLikeThisButton = fragment.querySelector('[data-role="lessLikeThisButton"]');
    const matched = fragment.querySelector('[data-role="matched"]');
    const matchedBlock = fragment.querySelector('[data-role="matchedBlock"]');
    const traits = fragment.querySelector('[data-role="traits"]');
    const details = fragment.querySelector(".debug-details");
    const caption = fragment.querySelector(".debug-caption");
    const thumbnails = fragment.querySelector('[data-role="thumbnails"]');
    const queryTraits = fragment.querySelector('[data-role="queryTraits"]');
    const mismatches = fragment.querySelector('[data-role="mismatches"]');
    const scoreBreakdown = fragment.querySelector('[data-role="scoreBreakdown"]');
    const inspectButton = fragment.querySelector('[data-role="inspectButton"]');
    const refreshAiButton = fragment.querySelector('[data-role="refreshAiButton"]');
    const manageCheckboxWrap = fragment.querySelector('[data-role="manageCheckboxWrap"]');
    const manageCheckbox = fragment.querySelector('[data-role="manageCheckbox"]');
    const queryTraitsLabel = queryTraits.previousElementSibling;
    const mismatchesLabel = mismatches.previousElementSibling;
    const scoreBreakdownLabel = scoreBreakdown.previousElementSibling;
    const summary = details.querySelector("summary");
    const captionLabel = caption.previousElementSibling;
    const traitsLabel = traits.previousElementSibling;

    image.src = result.best_image_url;
    image.alt = `${result.name} by ${result.brand}`;
    productName.textContent = result.name;
    brandName.textContent = result.brand;
    aiRefreshTime.textContent = formatRefreshTimestamp(result.ai_refreshed_at);
    categoryPill.textContent = result.category || "";
    caption.textContent = result.debug.structured_caption;
    renderThumbnails(thumbnails, result, image);
    const isRefreshing = state.refreshingProductId === result.product_id;
    const isSelected = state.selectedProductIds.has(result.product_id);
    const hasIndex = Boolean(state.bootstrap?.has_index);
    refreshAiButton.disabled = isRefreshing;
    refreshAiButton.textContent = "↻";
    refreshAiButton.classList.toggle("is-refreshing", isRefreshing);
    refreshAiButton.setAttribute("aria-label", isRefreshing ? "Refreshing AI data for this product" : "Refresh AI data for this product");
    refreshAiButton.title = isRefreshing ? "Refreshing AI" : "Refresh AI";
    manageCheckboxWrap.hidden = !state.manageMode;
    manageCheckbox.checked = isSelected;
    manageCheckbox.disabled = state.batchRefreshing;
    const canRefine = !isBrowseMode && Array.isArray(state.currentQueryEmbedding) && state.currentQueryEmbedding.length > 0;
    refinementActions.hidden = !canRefine || state.manageMode;
    moreLikeThisButton.disabled = state.refinementLoading;
    lessLikeThisButton.disabled = state.refinementLoading;

    if (isBrowseMode) {
      scoreBadge.hidden = true;
      matchedBlock.hidden = true;
      inspectButton.hidden = state.manageMode || !hasIndex;
      refreshAiButton.hidden = state.manageMode;
      inspectButton.innerHTML = "AI";
      inspectButton.setAttribute("aria-label", "Inspect AI traits");
      summary.hidden = true;
      queryTraits.hidden = true;
      queryTraitsLabel.hidden = true;
      mismatches.hidden = true;
      mismatchesLabel.hidden = true;
      scoreBreakdown.hidden = true;
      scoreBreakdownLabel.hidden = true;
    } else {
      scoreBadge.hidden = false;
      scoreBadge.textContent = `Score ${Number(result.score || 0).toFixed(2)}`;
      matchedBlock.hidden = false;
      inspectButton.hidden = state.manageMode || !hasIndex;
      refreshAiButton.hidden = state.manageMode;
      inspectButton.innerHTML = "∑";
      inspectButton.setAttribute("aria-label", "Inspect score calculation");
      summary.hidden = !state.debug;
      queryTraits.hidden = !state.debug;
      queryTraitsLabel.hidden = !state.debug;
      mismatches.hidden = !state.debug;
      mismatchesLabel.hidden = !state.debug;
      scoreBreakdown.hidden = true;
      scoreBreakdownLabel.hidden = true;
    }

    const matchedTraits = (result.matched_traits || []).slice(0, 3);
    const fallbackTraits = (result.debug?.detected_traits || []).slice(0, 3);
    const chips = matchedTraits.length ? matchedTraits : fallbackTraits;
    chips.forEach((trait) => matched.appendChild(createChip(trait)));
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

    inspectButton.setAttribute("aria-pressed", String(inspectOpen));
    inspectButton.addEventListener("click", () => {
      state.inspectedProductId = state.inspectedProductId === result.product_id ? null : result.product_id;
      renderResults(state.lastPayload, state.lastQuery);
    });
    moreLikeThisButton.addEventListener("click", async () => {
      try {
        await applyProductRefinement({
          id: `more:${result.product_id}:${Date.now()}`,
          productId: result.product_id,
          name: result.name,
          action: "more",
          embedding: result.visual_summary_embedding
        });
      } catch {}
    });
    lessLikeThisButton.addEventListener("click", async () => {
      try {
        await applyProductRefinement({
          id: `less:${result.product_id}:${Date.now()}`,
          productId: result.product_id,
          name: result.name,
          action: "less",
          embedding: result.visual_summary_embedding
        });
      } catch {}
    });
    refreshAiButton.addEventListener("click", async () => {
      if (!state.bootstrap?.has_index) {
        setStatus("No index yet — use Manage, then Select all and Build AI Index to start the initial catalog index.", "info");
        return;
      }
      const previousStatus = elements.statusPanel.textContent;
      const previousStatusKind = elements.statusPanel.classList.contains("error")
        ? "error"
        : elements.statusPanel.classList.contains("empty")
          ? "empty"
          : "info";

      state.refreshingProductId = result.product_id;
      renderResults(state.lastPayload, state.lastQuery);
      setStatus(`Refreshing AI data for ${result.name}...`);

      try {
        const payload = await refreshProductAi(result.product_id);
        setStatus(`Refreshed ${result.name} with ${payload.caption_model_version || "updated AI output"}.`);
        state.refreshingProductId = null;
        applyRefreshedProductToResults(payload);
        renderResults(state.lastPayload, state.lastQuery);
      } catch (error) {
        state.refreshingProductId = null;
        renderResults(state.lastPayload, state.lastQuery);
        setStatus(error.message || previousStatus || "Product refresh failed.", "error");
        return;
      }

      if (!elements.statusPanel.textContent && previousStatus) {
        setStatus(previousStatus, previousStatusKind);
      }
    });

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
        return;
      }
      if (details.open) {
        state.expandedProductId = result.product_id;
        document.querySelectorAll(".debug-details").forEach((other) => {
          if (other !== details) {
            other.open = false;
          }
        });
      }
    });

    elements.resultsGrid.appendChild(fragment);
  });
}

async function runSearch(query, options = {}) {
  const normalizedQuery = query.trim();
  const sourceImageUrl = String(options.sourceImageUrl || "").trim();
  const sort = options.sort || state.sortMode || "auto";
  const imageAnalysis = options.imageAnalysis && typeof options.imageAnalysis === "object" ? options.imageAnalysis : null;
  const selectedBullets = normalizeSelectedBullets(options.selectedBullets);
  const bulletControls = normalizeBulletControls(
    options.bulletControls?.length
      ? options.bulletControls
      : [
          ...selectedBullets.essential.map((text) => ({ text, priority: "essential" })),
          ...selectedBullets.normal.map((text) => ({ text, priority: "normal" }))
        ]
  );
  const preserveOriginal = Boolean(options.preserveOriginal);
  const refinementActive = Boolean(options.refinementActive);
  const productRefinements = normalizeProductRefinements(options.productRefinements || []);
  const seatingType = String(imageAnalysis?.stage1?.seating_type || imageAnalysis?.seating_type || "").trim();
  if (normalizedQuery && !state.bootstrap?.has_index) {
    setStatus("The search index is missing. Run the normalize and index scripts first.", "error");
    return null;
  }

  renderContextPills();
  state.refineDrawerOpen = false;
  elements.resultCount.textContent = normalizedQuery ? "Searching..." : "Loading catalog...";
  setStatus(normalizedQuery ? "Embedding the visual query and ranking image captions..." : "Loading catalog products...");

  try {
    const payload = imageAnalysis
      ? await fetchJson("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: normalizedQuery,
            source_image_url: sourceImageUrl,
            sort,
            image_analysis: imageAnalysis,
            selected_bullets: selectedBullets
          })
        })
      : await fetchJson(
          `/api/search?q=${encodeURIComponent(normalizedQuery)}&source_image_url=${encodeURIComponent(sourceImageUrl)}&sort=${encodeURIComponent(sort)}`
        );
    applyActiveSearchContext({
      payload,
      query: normalizedQuery,
      selectedBullets,
      bulletControls,
      baseQueryEmbedding: payload?.query_embedding,
      seatingType,
      imageAnalysis,
      productRefinements,
      preserveOriginal,
      refinementActive
    });
    renderResults(payload, normalizedQuery);
    return payload;
  } catch (error) {
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
  if (elements.imageModal.hidden && elements.rulesModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function showUploadStage() {
  elements.modalTitle.textContent = "Upload or paste an image";
  elements.imageModalUploadStage.hidden = false;
  elements.imageModalResultsStage.hidden = true;
  state.focusArea = null;
  state.cropPreviewUrl = "";
  elements.inspirationPreview.removeAttribute("src");
  elements.focusBox.hidden = true;
  setImageAnalyzeLoading(false);
}

function showCropStage(previewUrl) {
  elements.modalTitle.textContent = "Focus on the item to search";
  elements.imageModalUploadStage.hidden = true;
  elements.imageModalResultsStage.hidden = false;
  state.cropPreviewUrl = String(previewUrl || "").trim();
  elements.inspirationPreview.src = state.cropPreviewUrl;
  setFocusArea(defaultFocusArea());
}

function resetImageFlow() {
  state.selectedUploadFile = null;
  state.lastAnalyzeInput = null;
  state.cropPreviewUrl = "";
  state.focusArea = null;
  elements.imageUploadInput.value = "";
  elements.imageUrlInput.value = "";
  elements.selectedFileName.textContent = "No file selected.";
  elements.inspirationPreview.removeAttribute("src");
  elements.focusBox.hidden = true;
  setImageAnalyzeLoading(false);
}

async function composeQueryForBullets(selectedBullets = [], options = {}) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  if (!hasSelectedBullets(normalized)) {
    return null;
  }

  setStatus("Composing a search query from the selected visual bullets...");
  const payload = await fetchJson("/api/compose-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seating_type: String(options.seatingType || state.currentImageAnalysis?.seating_type || "seating"),
      bullets: normalized
    })
  });
  return payload.query;
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

async function requestImageAnalysis(body) {
  const payload = await fetchJson("/api/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return payload.analysis;
}

function bulletsFromAnalysis(analysis) {
  const structuredBullets = buildStructuredInspirationBullets(analysis);
  if (structuredBullets.length) {
    return structuredBullets;
  }
  return normalizePriorityBulletList(analysis?.raw_visual_highlights || []);
}

async function runImageAnalysisSearch({ focusArea = null } = {}) {
  if (!state.lastAnalyzeInput) {
    setStatus("Choose an image file or paste an image URL first.", "error");
    return;
  }

  const body = focusArea ? { ...state.lastAnalyzeInput, focus_area: focusArea } : { ...state.lastAnalyzeInput };
  setImageAnalyzeLoading(true);
  setStatus(focusArea ? "Analyzing the selected focus area..." : "Analyzing the full image...");

  try {
    const analysis = await requestImageAnalysis(body);
    const bullets = bulletsFromAnalysis(analysis);
    const selectedBullets = { essential: [], normal: bullets };
    const bulletControls = buildBulletControlsFromBullets(bullets);
    const query = await composeQueryWithFallback(selectedBullets, {
      seatingType: analysis?.seating_type || analysis?.stage1?.seating_type || "seating"
    });
    const fallbackQuery = buildFallbackQueryFromStructuredBullets(selectedBullets);
    const resolvedQuery = String(query || "").trim() || fallbackQuery;

    if (!resolvedQuery) {
      throw new Error("Image analysis completed, but no usable search bullets were generated.");
    }

    state.focusArea = normalizeFocusArea(focusArea || defaultFocusArea());
    elements.searchInput.value = resolvedQuery;
    closeImageModal();
    await runSearch(resolvedQuery, {
      sort: state.sortMode,
      sourceImageUrl: analysis?.image_preview_url || state.cropPreviewUrl || "",
      imageAnalysis: analysis,
      selectedBullets,
      bulletControls
    });
    setStatus("Image analysis complete.");
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
    state.selectedProductIds = new Set();
    state.sortMode = "auto";
    syncManageToolbar();
    state.bootstrap = await fetchJson("/api/bootstrap");
    if (elements.sortSelect) {
      elements.sortSelect.value = state.sortMode;
    }
    renderRankingRulesSummary(state.bootstrap.ranking_rules);
    renderSeedQueries(state.bootstrap.seed_queries);
    resetImageFlow();
    elements.uploadSupportNote.textContent = state.bootstrap.image_analysis_available
      ? "Upload an inspiration image or paste an image URL."
      : "Image-led search requires OPENAI_API_KEY on the local server.";
    elements.imageUploadButton.disabled = !state.bootstrap.image_analysis_available;
    elements.analyzeImageButton.disabled = !state.bootstrap.image_analysis_available;
    setStatus(
      state.bootstrap.has_index
        ? `Catalog loaded: ${state.bootstrap.stats.products} products. Visual search index is available.`
        : `Catalog loaded: ${state.bootstrap.stats.products} products. Browse is ready; use Manage and Build AI Index to enable visual search.`
    );
    await runSearch("");
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

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(elements.searchInput.value, { sort: state.sortMode });
});

elements.sortSelect?.addEventListener("change", () => {
  state.sortMode = elements.sortSelect.value || "auto";
  runSearch(elements.searchInput.value, {
    sort: state.sortMode,
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
  state.refinementActive = false;
  closeRefineDrawer();
  updateResetSearchVisibility();
  renderResults(cloneValue(state.originalPayload), state.originalQuery);
});

elements.manageSelectionButton?.addEventListener("click", () => {
  enterManageMode();
});

elements.doneManagingButton?.addEventListener("click", () => {
  exitManageMode();
});

elements.batchRefreshCloseButton?.addEventListener("click", () => {
  exitManageMode();
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
      batch_current: productIds.length ? 1 : 0,
      batch_total: Math.ceil(productIds.length / 5),
      current_product_name: "",
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
    batch_current: productIds.length ? 1 : 0,
    batch_total: Math.ceil(productIds.length / 5),
    current_product_name: "",
    log: []
  });
  renderResults(state.lastPayload, state.lastQuery);
  setStatus(`Refreshing AI data for ${productIds.length} selected product${productIds.length === 1 ? "" : "s"}...`);

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
    setStatus(error.message || "Batch AI refresh failed.", "error");
  }
});

elements.debugToggle.addEventListener("click", () => {
  state.debug = !state.debug;
  elements.debugToggle.setAttribute("aria-pressed", String(state.debug));
  elements.debugToggleLabel.textContent = `Debug Mode: ${state.debug ? "On" : "Off"}`;
  if (!state.debug) {
    state.expandedProductId = null;
  }
  state.inspectedProductId = null;
  runSearch(elements.searchInput.value);
});

elements.openImageSearch.addEventListener("click", openImageModal);
elements.closeImageModal.addEventListener("click", closeImageModal);
elements.openRulesSummary.addEventListener("click", openRulesModal);
elements.copyStructuredTraits?.addEventListener("click", () => {
  try {
    openStructuredTraitsModal();
  } catch (error) {
    setStatus(error.message, "error");
  }
});
elements.closeRulesModal.addEventListener("click", closeRulesModal);
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
elements.structuredTraitsModalCloseTargets.forEach((target) => target.addEventListener("click", closeStructuredTraitsModal));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.imageModal.hidden) {
    closeImageModal();
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
  elements.selectedFileName.textContent = file ? file.name : "No file selected.";
  if (file) {
    elements.imageUrlInput.value = "";
  }
});

elements.imageUrlInput.addEventListener("input", () => {
  if (elements.imageUrlInput.value.trim()) {
    state.selectedUploadFile = null;
    elements.imageUploadInput.value = "";
    elements.selectedFileName.textContent = "No file selected.";
  }
});

elements.inspirationPreview.addEventListener("load", () => {
  if (!state.focusArea) {
    setFocusArea(defaultFocusArea());
  } else {
    renderFocusArea();
  }
});

elements.focusBox.addEventListener("mousedown", beginFocusDrag);
document.addEventListener("mousemove", updateFocusDrag);
document.addEventListener("mouseup", stopFocusDrag);
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
  elements.imageModal.hidden = false;
  document.body.classList.add("modal-open");
  showCropStage(state.currentImageAnalysis?.image_preview_url || state.cropPreviewUrl || "");
  if (state.focusArea) {
    setFocusArea(state.focusArea);
  }
});

bootstrap().catch((error) => {
  reportClientError(error, "Bootstrap failed");
});
