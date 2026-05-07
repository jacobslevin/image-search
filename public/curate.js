import {
  buildStructuredInspirationBullets,
  resolveCurateVisualType
} from "./curate-bullets.js";

const state = {
  bootstrap: null,
  selectedUploadFile: null,
  currentImageAnalysis: null,
  currentQuery: "",
  currentSelectedBullets: { essential: [], normal: [] },
  currentResults: [],
  curatedResults: [],
  sourceImageUrl: "",
  draggingProductId: ""
};

const elements = {
  uploadSupportNote: document.querySelector("#curateUploadSupportNote"),
  imageUploadInput: document.querySelector("#curateImageUploadInput"),
  imageUploadButton: document.querySelector("#curateImageUploadButton"),
  selectedFileName: document.querySelector("#curateSelectedFileName"),
  imageUrlInput: document.querySelector("#curateImageUrlInput"),
  analyzeButton: document.querySelector("#curateAnalyzeButton"),
  analyzeLoading: document.querySelector("#curateAnalyzeLoading"),
  status: document.querySelector("#curateStatus"),
  analysisSummary: document.querySelector("#curateAnalysisSummary"),
  analysisPreview: document.querySelector("#curateAnalysisPreview"),
  analysisQuery: document.querySelector("#curateAnalysisQuery"),
  analysisBullets: document.querySelector("#curateAnalysisBullets"),
  resultsMeta: document.querySelector("#curateResultsMeta"),
  resultsGrid: document.querySelector("#curateResultsGrid"),
  idealList: document.querySelector("#curateIdealList"),
  exportButton: document.querySelector("#curateExportButton")
};

function getPayloadVisualType(payload = {}) {
  return String(
    payload?.visual_type ||
    payload?.seating_type ||
    payload?.stage1?.visual_type ||
    payload?.stage1?.seating_type ||
    ""
  ).trim();
}

function apiUrl(pathname) {
  const path = String(pathname || "");
  if (!path.startsWith("/")) {
    return path;
  }
  if (!path.startsWith("/api/")) {
    return path;
  }

  return path;
}

async function fetchJson(url, options) {
  let response;
  const requestHomePath = window.location.pathname || "/";
  try {
    response = await fetch(apiUrl(url), {
      cache: "no-store",
      ...options,
      headers: {
        ...(options?.headers || {}),
        "Cache-Control": "no-store",
        "X-PixelSeek-Home-Path": requestHomePath
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

function setStatus(message) {
  elements.status.textContent = String(message || "").trim();
}

function setAnalyzeLoading(isLoading) {
  elements.analyzeButton.disabled = isLoading || !state.bootstrap?.image_analysis_available;
  elements.imageUploadButton.disabled = isLoading || !state.bootstrap?.image_analysis_available;
  elements.imageUploadInput.disabled = isLoading;
  elements.imageUrlInput.disabled = isLoading;
  elements.analyzeLoading.hidden = !isLoading;
  elements.analyzeButton.textContent = isLoading ? "Analyzing..." : "Analyze Image";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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

function bulletsFromAnalysis(analysis) {
  if (analysis?.search_bullets && typeof analysis.search_bullets === "object") {
    const structured = normalizeSelectedBullets(analysis.search_bullets);
    if (structured.essential.length || structured.normal.length) {
      return structured;
    }
  }
  const structuredBullets = buildStructuredInspirationBullets(analysis, {
    bootstrap: state.bootstrap,
    visualType: resolveCurateVisualType(analysis)
  });
  if (structuredBullets.length) {
    return normalizeSelectedBullets(structuredBullets);
  }
  return normalizeSelectedBullets(analysis?.raw_visual_highlights || []);
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

  const resolvedVisualType = resolveCurateVisualType(state.currentImageAnalysis, options);

  const payload = await fetchJson("/api/compose-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visual_type: resolvedVisualType,
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

async function fetchTopResults({ query, imageAnalysis, selectedBullets, sourceImageUrl }) {
  const payload = await fetchJson("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: query,
      source_image_url: sourceImageUrl,
      image_analysis: imageAnalysis,
      selected_bullets: normalizeSelectedBullets(selectedBullets)
    })
  });

  return {
    ...payload,
    results: Array.isArray(payload.results) ? payload.results.slice(0, 25) : []
  };
}

function renderAnalysisSummary() {
  const bullets = [...state.currentSelectedBullets.essential, ...state.currentSelectedBullets.normal];
  if (!state.currentQuery && !bullets.length && !state.sourceImageUrl) {
    elements.analysisSummary.hidden = true;
    return;
  }

  elements.analysisSummary.hidden = false;
  if (state.sourceImageUrl) {
    elements.analysisPreview.src = state.sourceImageUrl;
  } else {
    elements.analysisPreview.removeAttribute("src");
  }
  elements.analysisQuery.textContent = state.currentQuery || "Generated image query";
  elements.analysisBullets.innerHTML = bullets.length
    ? bullets.map((bullet) => `<span class="compare-tag">${escapeHtml(bullet)}</span>`).join("")
    : '<span class="compare-empty-tag">No generated bullets</span>';
}

function renderResults() {
  const results = Array.isArray(state.currentResults) ? state.currentResults : [];
  const curatedIds = new Set(state.curatedResults.map((result) => result.product_id));

  elements.resultsMeta.textContent = results.length ? `${results.length} results shown` : "";
  if (!results.length) {
    elements.resultsGrid.innerHTML = '<p class="curate-empty">Analyze an image to load results.</p>';
    return;
  }

  elements.resultsGrid.innerHTML = results.map((result, index) => {
    const added = curatedIds.has(result.product_id);
    return `
      <article class="curate-result-card">
        <div class="curate-result-rank">#${index + 1}</div>
        <img class="curate-result-image" src="${escapeHtml(result.best_image_url || "")}" alt="${escapeHtml(result.name || "Product")}" loading="lazy" />
        <div class="curate-result-body">
          <h3 class="curate-result-title">${escapeHtml(result.name || "Unnamed product")}</h3>
          <p class="curate-result-meta">${escapeHtml(result.brand || "")}</p>
          <button class="upload-button ${added ? "" : "upload-button-strong"} curate-add-button" type="button" data-product-id="${escapeHtml(result.product_id || "")}" ${added ? "disabled" : ""}>
            ${added ? "Added" : "Add to ground truth"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  elements.resultsGrid.querySelectorAll("[data-product-id]").forEach((button) => {
    button.addEventListener("click", () => addCuratedResult(button.dataset.productId || ""));
  });
}

function renderIdealList() {
  if (!state.curatedResults.length) {
    elements.idealList.innerHTML = '<p class="curate-empty">No curated results yet.</p>';
    elements.exportButton.disabled = true;
    return;
  }

  elements.exportButton.disabled = false;
  elements.idealList.innerHTML = state.curatedResults.map((result, index) => `
    <article class="curate-ideal-card" draggable="true" data-product-id="${escapeHtml(result.product_id || "")}">
      <div class="curate-ideal-rank">${index + 1}</div>
      <img class="curate-ideal-image" src="${escapeHtml(result.best_image_url || "")}" alt="${escapeHtml(result.name || "Product")}" loading="lazy" />
      <div class="curate-ideal-copy">
        <h3 class="curate-ideal-title">${escapeHtml(result.name || "Unnamed product")}</h3>
        <p class="curate-result-meta">${escapeHtml(result.brand || "")}</p>
      </div>
      <button class="curate-remove-button" type="button" data-remove-product-id="${escapeHtml(result.product_id || "")}">Remove</button>
    </article>
  `).join("");

  elements.idealList.querySelectorAll(".curate-ideal-card").forEach((card) => {
    card.addEventListener("dragstart", handleDragStart);
    card.addEventListener("dragover", handleDragOver);
    card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
    card.addEventListener("drop", handleDrop);
    card.addEventListener("dragend", handleDragEnd);
  });

  elements.idealList.querySelectorAll("[data-remove-product-id]").forEach((button) => {
    button.addEventListener("click", () => removeCuratedResult(button.dataset.removeProductId || ""));
  });
}

function addCuratedResult(productId) {
  if (!productId || state.curatedResults.some((result) => result.product_id === productId)) {
    return;
  }

  const match = state.currentResults.find((result) => result.product_id === productId);
  if (!match) {
    return;
  }

  state.curatedResults = [...state.curatedResults, match];
  renderResults();
  renderIdealList();
}

function removeCuratedResult(productId) {
  state.curatedResults = state.curatedResults.filter((result) => result.product_id !== productId);
  renderResults();
  renderIdealList();
}

function moveCuratedResult(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  const next = [...state.curatedResults];
  const sourceIndex = next.findIndex((result) => result.product_id === sourceId);
  const targetIndex = next.findIndex((result) => result.product_id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }

  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  state.curatedResults = next;
  renderIdealList();
}

function handleDragStart(event) {
  const productId = event.currentTarget?.dataset?.productId || "";
  state.draggingProductId = productId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", productId);
  event.currentTarget.classList.add("is-dragging");
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("is-drop-target");
}

function handleDrop(event) {
  event.preventDefault();
  const targetId = event.currentTarget?.dataset?.productId || "";
  const sourceId = event.dataTransfer.getData("text/plain") || state.draggingProductId;
  moveCuratedResult(sourceId, targetId);
}

function handleDragEnd() {
  state.draggingProductId = "";
  elements.idealList.querySelectorAll(".curate-ideal-card").forEach((card) => {
    card.classList.remove("is-dragging", "is-drop-target");
  });
}

async function exportCuratedResults() {
  const payload = {
    query: state.currentQuery,
    image_analysis_bullets: [...state.currentSelectedBullets.essential, ...state.currentSelectedBullets.normal],
    curated_results: state.curatedResults.map((result) => ({
      product_id: result.product_id,
      name: result.name
    }))
  };
  const text = JSON.stringify(payload, null, 2);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${state.curatedResults.length} curated result${state.curatedResults.length === 1 ? "" : "s"} to the clipboard.`);
    return;
  }

  throw new Error("Clipboard access is unavailable in this browser.");
}

async function analyzeSelectedImage() {
  const imageUrl = elements.imageUrlInput.value.trim();
  const file = state.selectedUploadFile;

  if (!file && !imageUrl) {
    setStatus("Choose an image file or paste an image URL first.");
    return;
  }

  let body;
  if (file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the selected image."));
      reader.readAsDataURL(file);
    });
    body = { file_name: file.name, image_data_url: dataUrl };
  } else {
    body = { image_url: imageUrl };
  }

  setAnalyzeLoading(true);
  setStatus("Analyzing image and loading the top 25 results...");

  try {
    const analysis = await requestImageAnalysis(body);
    const selectedBullets = normalizeSelectedBullets(bulletsFromAnalysis(analysis));
    const query = await composeQueryWithFallback(selectedBullets, {
      visualType: resolveCurateVisualType(analysis)
    });
    const resolvedQuery = String(query || "").trim() || buildFallbackQueryFromStructuredBullets(selectedBullets);

    if (!resolvedQuery) {
      throw new Error("Image analysis completed, but no usable search bullets were generated.");
    }

    const sourceImageUrl = analysis?.image_preview_url || body.image_url || body.image_data_url || "";
    const searchPayload = await fetchTopResults({
      query: resolvedQuery,
      imageAnalysis: analysis,
      selectedBullets,
      sourceImageUrl
    });

    state.currentImageAnalysis = analysis;
    state.currentQuery = resolvedQuery;
    state.currentSelectedBullets = normalizeSelectedBullets(selectedBullets);
    state.currentResults = searchPayload.results || [];
    state.curatedResults = [];
    state.sourceImageUrl = sourceImageUrl;

    renderAnalysisSummary();
    renderResults();
    renderIdealList();
    setStatus(`Loaded ${state.currentResults.length} results for curation.`);
  } finally {
    setAnalyzeLoading(false);
  }
}

async function bootstrap() {
  state.bootstrap = await fetchJson("/api/bootstrap");
  elements.uploadSupportNote.textContent = state.bootstrap.image_analysis_available
    ? "Upload an inspiration image or paste an image URL."
    : "Image analysis requires OPENAI_API_KEY on the local server.";
  elements.imageUploadButton.disabled = !state.bootstrap.image_analysis_available;
  elements.analyzeButton.disabled = !state.bootstrap.image_analysis_available;
  renderResults();
  renderIdealList();
}

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

elements.analyzeButton?.addEventListener("click", async () => {
  try {
    await analyzeSelectedImage();
  } catch (error) {
    setStatus(error.message || "Image analysis failed.");
    setAnalyzeLoading(false);
  }
});

elements.exportButton?.addEventListener("click", async () => {
  try {
    await exportCuratedResults();
  } catch (error) {
    setStatus(error.message || "Export failed.");
  }
});

bootstrap().catch((error) => {
  setStatus(error.message || "Failed to load the curation tool.");
});
