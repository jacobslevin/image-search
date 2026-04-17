const state = {
  bootstrap: null,
  selectedUploadFile: null,
  lastAnalyzeInput: null,
  cropPreviewUrl: "",
  focusArea: null,
  currentImageAnalysis: null,
  currentSelectedBullets: { essential: [], normal: [] },
  currentSourceImageUrl: "",
  currentQuery: "",
  sortMode: "auto"
};

const focusDrag = {
  active: false,
  startX: 0,
  startY: 0,
  startArea: null
};

const elements = {
  form: document.querySelector("#compareForm"),
  query: document.querySelector("#compareQuery"),
  status: document.querySelector("#compareStatus"),
  metaOff: document.querySelector("#compareMetaOff"),
  metaOn: document.querySelector("#compareMetaOn"),
  gridOff: document.querySelector("#compareGridOff"),
  gridOn: document.querySelector("#compareGridOn"),
  analysisSummary: document.querySelector("#compareAnalysisSummary"),
  analysisPreview: document.querySelector("#compareAnalysisPreview"),
  analysisQuery: document.querySelector("#compareAnalysisQuery"),
  analysisBullets: document.querySelector("#compareAnalysisBullets"),
  openImageSearch: document.querySelector("#openCompareImageSearch"),
  imageModal: document.querySelector("#compareImageModal"),
  closeImageModal: document.querySelector("#closeCompareImageModal"),
  imageModalCloseTargets: document.querySelectorAll('[data-role="compareImageModalClose"]'),
  modalTitle: document.querySelector("#compareModalTitle"),
  uploadStage: document.querySelector("#compareImageUploadStage"),
  cropStage: document.querySelector("#compareImageCropStage"),
  uploadSupportNote: document.querySelector("#compareUploadSupportNote"),
  imageUploadInput: document.querySelector("#compareImageUploadInput"),
  imageUploadButton: document.querySelector("#compareImageUploadButton"),
  selectedFileName: document.querySelector("#compareSelectedFileName"),
  imageUrlInput: document.querySelector("#compareImageUrlInput"),
  analyzeImageButton: document.querySelector("#compareAnalyzeImageButton"),
  imageAnalyzeLoading: document.querySelector("#compareImageAnalyzeLoading"),
  previewCanvas: document.querySelector("#comparePreviewCanvas"),
  inspirationPreview: document.querySelector("#compareInspirationPreview"),
  focusBox: document.querySelector("#compareFocusBox"),
  skipFocusButton: document.querySelector("#compareSkipFocusButton"),
  applyFocusButton: document.querySelector("#compareApplyFocusButton")
};

function apiUrl(pathname) {
  const path = String(pathname || "");
  if (!path.startsWith("/")) {
    return path;
  }

  if (!path.startsWith("/api/")) {
    return path;
  }

  const currentPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  if (currentPort === "3001") {
    return path;
  }

  return `${window.location.protocol}//${window.location.hostname}:3001${path}`;
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(apiUrl(url), {
      cache: "no-store",
      ...options,
      headers: {
        ...(options?.headers || {}),
        "Cache-Control": "no-store"
      }
    });
  } catch {
    throw new Error("Failed to reach the local server. Refresh the page and try again.");
  }

  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}).`);
    }
    throw new Error("Server returned a non-JSON response.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
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
    return { essential: [], normal: normalizePriorityBulletList(selectedBullets) };
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

function buildFallbackQueryFromStructuredBullets(selectedBullets = []) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  return [...normalized.essential, ...normalized.normal].join(", ");
}

function isPresentBulletValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const normalized = String(value).trim();
  return normalized && normalized.toLowerCase() !== "unknown";
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

function bulletsFromAnalysis(analysis) {
  if (analysis?.search_bullets && typeof analysis.search_bullets === "object") {
    const structured = normalizeSelectedBullets(analysis.search_bullets);
    if (structured.essential.length || structured.normal.length) {
      return structured;
    }
  }
  const structuredBullets = buildStructuredInspirationBullets(analysis);
  if (structuredBullets.length) {
    return normalizeSelectedBullets(structuredBullets);
  }
  return normalizeSelectedBullets(analysis?.raw_visual_highlights || []);
}

function defaultFocusArea() {
  return { x: 0, y: 0, width: 1, height: 1 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeFocusArea(area) {
  if (!area) {
    return null;
  }
  const width = clamp(Number(area.width || 0), 0.2, 1);
  const height = clamp(Number(area.height || 0), 0.2, 1);
  const x = clamp(Number(area.x || 0), 0, 1 - width);
  const y = clamp(Number(area.y || 0), 0, 1 - height);
  return { x, y, width, height };
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

function setFocusArea(area) {
  state.focusArea = normalizeFocusArea(area);
  renderFocusArea();
}

function captureFocusAreaFromDom() {
  const canvasRect = elements.previewCanvas.getBoundingClientRect();
  const boxRect = elements.focusBox.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height || !boxRect.width || !boxRect.height) {
    return null;
  }
  return normalizeFocusArea({
    x: (boxRect.left - canvasRect.left) / canvasRect.width,
    y: (boxRect.top - canvasRect.top) / canvasRect.height,
    width: boxRect.width / canvasRect.width,
    height: boxRect.height / canvasRect.height
  });
}

function beginFocusDrag(event) {
  const area = captureFocusAreaFromDom() || state.focusArea;
  if (!area) {
    return;
  }
  event.preventDefault();
  focusDrag.active = true;
  focusDrag.startX = event.clientX;
  focusDrag.startY = event.clientY;
  focusDrag.startArea = area;
}

function updateFocusDrag(event) {
  if (!focusDrag.active || !focusDrag.startArea) {
    return;
  }
  const canvasRect = elements.previewCanvas.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) {
    return;
  }

  const deltaX = (event.clientX - focusDrag.startX) / canvasRect.width;
  const deltaY = (event.clientY - focusDrag.startY) / canvasRect.height;
  setFocusArea({
    ...focusDrag.startArea,
    x: focusDrag.startArea.x + deltaX,
    y: focusDrag.startArea.y + deltaY
  });
}

function stopFocusDrag() {
  if (!focusDrag.active) {
    return;
  }
  focusDrag.active = false;
  focusDrag.startArea = captureFocusAreaFromDom() || state.focusArea;
}

function setStatus(message) {
  elements.status.textContent = message || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "n/a";
}

function renderTags(tags = []) {
  if (!Array.isArray(tags) || !tags.length) {
    return '<span class="compare-empty-tag">No matched tags</span>';
  }

  return tags
    .slice(0, 6)
    .map((tag) => `<span class="compare-tag">${escapeHtml(tag)}</span>`)
    .join("");
}

function renderGrid(container, results = []) {
  const topResults = Array.isArray(results) ? results.slice(0, 12) : [];
  if (!topResults.length) {
    container.innerHTML = '<p class="compare-empty">No results.</p>';
    return;
  }

  container.innerHTML = topResults.map((result, index) => `
    <article class="compare-card">
      <div class="compare-rank">#${index + 1}</div>
      <img class="compare-image" src="${escapeHtml(result.best_image_url || "")}" alt="${escapeHtml(result.name || "Product")}" loading="lazy" />
      <div class="compare-card-body">
        <h3 class="compare-card-title">${escapeHtml(result.name || "Unnamed product")}</h3>
        <div class="compare-score-chip" aria-label="Score ${formatScore(result.score)}">
          <span class="compare-score-label">Score</span>
          <span class="compare-score-value">${formatScore(result.score)}</span>
        </div>
        <div class="compare-tags">${renderTags(result.matched_traits || [])}</div>
      </div>
    </article>
  `).join("");
}

function renderAnalysisSummary({ previewUrl = "", query = "", selectedBullets = { essential: [], normal: [] } } = {}) {
  const bullets = [...normalizeSelectedBullets(selectedBullets).essential, ...normalizeSelectedBullets(selectedBullets).normal];
  if (!previewUrl && !bullets.length && !query) {
    elements.analysisSummary.hidden = true;
    return;
  }

  elements.analysisSummary.hidden = false;
  if (previewUrl) {
    elements.analysisPreview.src = previewUrl;
  } else {
    elements.analysisPreview.removeAttribute("src");
  }
  elements.analysisQuery.textContent = query || "Generated image query";
  elements.analysisBullets.innerHTML = bullets.length
    ? bullets.map((bullet) => `<span class="compare-tag">${escapeHtml(bullet)}</span>`).join("")
    : '<span class="compare-empty-tag">No generated bullets</span>';
}

async function fetchSearchResults({
  query,
  weighted,
  imageAnalysis = null,
  selectedBullets = { essential: [], normal: [] },
  sourceImageUrl = "",
  sort = "auto"
}) {
  const normalizedQuery = String(query || "").trim();
  const normalizedSourceImageUrl = String(sourceImageUrl || "").trim();
  const normalizedSort = String(sort || "auto").trim() || "auto";

  if (imageAnalysis) {
    return fetchJson("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: normalizedQuery,
        weighted,
        sort: normalizedSort,
        source_image_url: normalizedSourceImageUrl,
        image_analysis: imageAnalysis,
        selected_bullets: normalizeSelectedBullets(selectedBullets)
      })
    });
  }

  return fetchJson(
    `/api/search?q=${encodeURIComponent(normalizedQuery)}&source_image_url=${encodeURIComponent(normalizedSourceImageUrl)}&sort=${encodeURIComponent(normalizedSort)}&weighted=${encodeURIComponent(String(weighted))}`
  );
}

async function requestImageAnalysis(body) {
  const payload = await fetchJson("/api/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return payload.analysis;
}

async function composeQueryForBullets(selectedBullets = [], options = {}) {
  const normalized = normalizeSelectedBullets(selectedBullets);
  if (!hasSelectedBullets(normalized)) {
    return null;
  }

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
      new Promise((resolve) => window.setTimeout(() => resolve(""), 8000))
    ]);
    return String(query || "").trim() || fallbackQuery;
  } catch {
    return fallbackQuery;
  }
}

function setImageAnalyzeLoading(isLoading) {
  elements.analyzeImageButton.disabled = isLoading || !state.bootstrap?.image_analysis_available;
  elements.imageUploadButton.disabled = isLoading || !state.bootstrap?.image_analysis_available;
  elements.imageUploadInput.disabled = isLoading;
  elements.imageUrlInput.disabled = isLoading;
  elements.skipFocusButton.disabled = isLoading;
  elements.applyFocusButton.disabled = isLoading;
  elements.imageAnalyzeLoading.hidden = !isLoading;
  elements.analyzeImageButton.textContent = isLoading ? "Analyzing..." : "Analyze Image";
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

function showUploadStage() {
  elements.modalTitle.textContent = "Upload or paste an image";
  elements.uploadStage.hidden = false;
  elements.cropStage.hidden = true;
  state.focusArea = null;
  state.cropPreviewUrl = "";
  elements.inspirationPreview.removeAttribute("src");
  elements.focusBox.hidden = true;
  setImageAnalyzeLoading(false);
}

function showCropStage(previewUrl) {
  elements.modalTitle.textContent = "Focus on the item to search";
  elements.uploadStage.hidden = true;
  elements.cropStage.hidden = false;
  state.cropPreviewUrl = String(previewUrl || "").trim();
  elements.inspirationPreview.src = state.cropPreviewUrl;
  setFocusArea(defaultFocusArea());
}

function openImageModal() {
  if (!state.bootstrap?.image_analysis_available) {
    setStatus("Image-led compare requires OPENAI_API_KEY on the local server.");
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

async function analyzeSelectedImage() {
  const imageUrl = elements.imageUrlInput.value.trim();
  const file = state.selectedUploadFile;
  if (!file && !imageUrl) {
    setStatus("Choose an image file or paste an image URL first.");
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
    body = { file_name: file.name, image_data_url: dataUrl };
    previewUrl = dataUrl;
  } else {
    body = { image_url: imageUrl };
    previewUrl = imageUrl;
  }

  state.lastAnalyzeInput = body;
  showCropStage(previewUrl);
  setStatus("Adjust the focus area, then analyze the image.");
}

async function runComparison(query, options = {}) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    setStatus("Enter a query to compare rankings.");
    return;
  }
  if (!state.bootstrap?.has_index) {
    setStatus("The search index is missing. Run the normalize and index scripts first.");
    return;
  }

  const imageAnalysis = options.imageAnalysis && typeof options.imageAnalysis === "object" ? options.imageAnalysis : null;
  const selectedBullets = normalizeSelectedBullets(options.selectedBullets);
  const sourceImageUrl = String(options.sourceImageUrl || "").trim();
  const sort = String(options.sort || state.sortMode || "auto").trim() || "auto";

  state.currentQuery = normalizedQuery;
  state.currentImageAnalysis = imageAnalysis;
  state.currentSelectedBullets = selectedBullets;
  state.currentSourceImageUrl = sourceImageUrl;

  elements.status.textContent = "Loading comparison results...";
  elements.gridOff.innerHTML = "";
  elements.gridOn.innerHTML = "";
  elements.metaOff.textContent = "";
  elements.metaOn.textContent = "";

  const [offPayload, onPayload] = await Promise.all([
    fetchSearchResults({ query: normalizedQuery, weighted: false, imageAnalysis, selectedBullets, sourceImageUrl, sort }),
    fetchSearchResults({ query: normalizedQuery, weighted: true, imageAnalysis, selectedBullets, sourceImageUrl, sort })
  ]);

  renderGrid(elements.gridOff, offPayload.results || []);
  renderGrid(elements.gridOn, onPayload.results || []);
  elements.metaOff.textContent = `${Math.min(12, offPayload.results?.length || 0)} of ${offPayload.total_results || 0} shown · same query, weights removed`;
  elements.metaOn.textContent = `${Math.min(12, onPayload.results?.length || 0)} of ${onPayload.total_results || 0} shown · mirrors app ranking`;
  setStatus(`Showing results for "${normalizedQuery}".`);
}

async function runImageAnalysisComparison({ focusArea = null } = {}) {
  if (!state.lastAnalyzeInput) {
    setStatus("Choose an image file or paste an image URL first.");
    return;
  }

  const body = focusArea ? { ...state.lastAnalyzeInput, focus_area: focusArea } : { ...state.lastAnalyzeInput };
  setImageAnalyzeLoading(true);
  setStatus(focusArea ? "Analyzing the selected focus area..." : "Analyzing the full image...");

  try {
    const analysis = await requestImageAnalysis(body);
    const selectedBullets = normalizeSelectedBullets(bulletsFromAnalysis(analysis));
    const query = await composeQueryWithFallback(selectedBullets, {
      seatingType: analysis?.seating_type || analysis?.stage1?.seating_type || "seating"
    });
    const fallbackQuery = buildFallbackQueryFromStructuredBullets(selectedBullets);
    const resolvedQuery = String(query || "").trim() || fallbackQuery;

    if (!resolvedQuery) {
      throw new Error("Image analysis completed, but no usable search bullets were generated.");
    }

    state.focusArea = normalizeFocusArea(focusArea || defaultFocusArea());
    elements.query.value = resolvedQuery;
    renderAnalysisSummary({
      previewUrl: analysis?.image_preview_url || state.cropPreviewUrl || "",
      query: resolvedQuery,
      selectedBullets
    });
    closeImageModal();
    await runComparison(resolvedQuery, {
      imageAnalysis: analysis,
      selectedBullets,
      sourceImageUrl: analysis?.image_preview_url || state.cropPreviewUrl || ""
    });
    setStatus("Image analysis complete.");
  } finally {
    setImageAnalyzeLoading(false);
  }
}

async function bootstrap() {
  state.bootstrap = await fetchJson("/api/bootstrap");
  elements.uploadSupportNote.textContent = state.bootstrap.image_analysis_available
    ? "Upload an inspiration image or paste an image URL."
    : "Image-led compare requires OPENAI_API_KEY on the local server.";
  elements.imageUploadButton.disabled = !state.bootstrap.image_analysis_available;
  elements.analyzeImageButton.disabled = !state.bootstrap.image_analysis_available;
}

elements.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  renderAnalysisSummary();
  try {
    await runComparison(elements.query.value, {
      imageAnalysis: state.currentImageAnalysis,
      selectedBullets: state.currentSelectedBullets,
      sourceImageUrl: state.currentSourceImageUrl
    });
  } catch (error) {
    setStatus(error.message || "Comparison failed.");
  }
});

elements.openImageSearch?.addEventListener("click", openImageModal);
elements.closeImageModal?.addEventListener("click", closeImageModal);
elements.imageModalCloseTargets.forEach((target) => target.addEventListener("click", closeImageModal));

elements.imageUploadButton?.addEventListener("click", () => {
  elements.imageUploadInput.click();
});

elements.imageUploadInput?.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  state.selectedUploadFile = file || null;
  elements.selectedFileName.textContent = file ? file.name : "No file selected.";
  if (file) {
    elements.imageUrlInput.value = "";
  }
});

elements.imageUrlInput?.addEventListener("input", () => {
  if (elements.imageUrlInput.value.trim()) {
    state.selectedUploadFile = null;
    elements.imageUploadInput.value = "";
    elements.selectedFileName.textContent = "No file selected.";
  }
});

elements.analyzeImageButton?.addEventListener("click", async () => {
  try {
    await analyzeSelectedImage();
  } catch (error) {
    setStatus(error.message || "Image preparation failed.");
  }
});

elements.skipFocusButton?.addEventListener("click", async () => {
  try {
    setFocusArea(defaultFocusArea());
    await runImageAnalysisComparison();
  } catch (error) {
    setStatus(error.message || "Image comparison failed.");
  }
});

elements.applyFocusButton?.addEventListener("click", async () => {
  try {
    const focusArea = captureFocusAreaFromDom() || state.focusArea || defaultFocusArea();
    setFocusArea(focusArea);
    await runImageAnalysisComparison({ focusArea });
  } catch (error) {
    setStatus(error.message || "Image comparison failed.");
  }
});

elements.inspirationPreview?.addEventListener("load", () => {
  if (!state.focusArea) {
    setFocusArea(defaultFocusArea());
  } else {
    renderFocusArea();
  }
});

elements.focusBox?.addEventListener("mousedown", beginFocusDrag);
document.addEventListener("mousemove", updateFocusDrag);
document.addEventListener("mouseup", stopFocusDrag);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.imageModal.hidden) {
    closeImageModal();
  }
});

bootstrap().catch((error) => {
  setStatus(error.message || "Failed to load compare page.");
});
