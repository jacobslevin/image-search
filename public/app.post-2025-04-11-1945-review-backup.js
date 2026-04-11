(function () {
  const PDFJS_VERSION = "4.8.69"
  const PERSISTENCE_DB = "assisted-spec-capture-poc"
  const PERSISTENCE_STORE = "defaults"
  const PERSISTENCE_KEY = "active-default-v2"
  const LIVE_CSS_PREFERENCE_KEY = "live-css-enabled-v1"
  const DEFAULT_BUNDLED_PDF_PATH = "./PBHCL%20(4).pdf"
  const DEFAULT_BUNDLED_PDF_NAME = "PBHCL (4).pdf"
  const DEFAULT_VISION_MODEL = "gpt-4.1"
  const PRODUCT_FIRST_CONFIDENCE_THRESHOLD = 0.78
  const LIVE_CSS_POLL_INTERVAL_MS = 1200
  const HELP_SPEC_LOADING_INTERVAL_MS = 4200
  const WEBSITE_EMBED_TIMEOUT_MS = 9000
  const WEBSITE_SUMMARY_LOADING_INTERVAL_MS = 2800
  const WEBSITE_SUMMARY_FETCH_TIMEOUT_MS = 5000
  const WEBSITE_SUMMARY_AI_TIMEOUT_MS = 30000
  const OPENAI_API_TIMEOUT_MS = 90000
  const WEBSITE_RESOURCE_LINK_LIMIT = 24
  const WEBSITE_PDF_ENRICHMENT_LIMIT = 3
  const WEBSITE_PDF_ENRICHMENT_PAGE_LIMIT = 4
  const HELP_SPEC_LOADING_LINES = [
    "Analyzing details... good specs take a beat.",
    "Reading the relevant pages, not just the one you clicked.",
    "Sorting dimensions, finishes, upholstery, and pricing into something human.",
    "Architects love clean lines. PDFs do not always cooperate.",
    "COM means Customer's Own Material. COL means Customer's Own Leather.",
    "Cross-checking reference pages so one finish table does not hijack the whole result.",
    "Looking for the exact product before it looks for the exact finish.",
    "Separating family-level pages from variant-level details.",
    "Comparing headers, pricing tables, and dimensions across candidate pages.",
    "Checking whether this page is one product, several products, or a family overview.",
    "Trying not to let marketing photography win the argument over the spec table.",
    "Matching finishes, materials, and dimensions to the right context.",
    "Pulling structure out of a layout that definitely did not volunteer it.",
    "Scanning for clues in titles, captions, tables, and tiny labels.",
    "Figuring out which pages are shared references versus product-specific pages.",
    "Looking for the point where options become actual spec decisions.",
    "Keeping the useful pages and ignoring the decorative detours.",
    "Turning price-list chaos into tabs you can actually use.",
    "Checking whether a nearby page is a continuation, a sibling variant, or neither.",
    "Separating configuration choices from finish choices.",
    "Making sure dimensions stay attached to the right variant.",
    "Trying to keep one powder coat legend from becoming the answer to everything.",
    "Looking for repeated family names, model cues, and variant language.",
    "Reducing the odds that one ambiguous SKU sends the whole result sideways.",
    "Searching for the pages that matter after the click, not just next to it.",
    "Comparing shared spec pages against variant-specific pages.",
    "Finding where the actual specification content begins.",
    "Checking if the page is broad enough to require a selector first.",
    "Grouping together pages that describe the same family context.",
    "Making the PDF admit what should have been structured data.",
    "Reading the page like a spec editor, not like a thumbnail strip.",
    "Trying to preserve exact units, fractions, and notation while sorting content.",
    "Looking for the details that change the spec, not just the details that fill the page."
  ]
  const WEBSITE_SUMMARY_LOADING_LINES = [
    "Scanning the webpage for the most up-to-date price and spec PDFs.",
    "Looking for current pricebooks, spec sheets, and other high-value product documents.",
    "Checking document areas and linked resources for the latest PDF sources.",
    "Prioritizing price and spec PDFs over brochures, manuals, and generic resources.",
    "Preparing the linked PDFs that are most likely to complete the attribute set.",
    "Handing off from webpage discovery into the ranked PDF analysis workflow."
  ]

  const sampleDocuments = buildSampleDocuments()
  const initialSpec = {
    originalSpecName: "Eames Molded Plywood Chairs",
    specDisplayName: "Eames Molded Plywood Chairs",
    originalBrand: "Herman Miller",
    brandDisplayName: "Herman Miller",
    category: "Lounge Seating",
    attributes: [
      { key: "width", label: "Width", type: "text", value: "" },
      { key: "length", label: "Length", type: "text", value: "" },
      { key: "overall-height", label: "Overall Height", type: "text", value: "" },
      { key: "seat-height", label: "Seat Height", type: "text", value: "" },
      { key: "arm-height", label: "Arm Height", type: "text", value: "" },
      { key: "body-frame", label: "Body/Frame", type: "text", value: "" },
      { key: "legs-base", label: "Legs/Base", type: "text", value: "" }
    ]
  }

  const appState = {
    spec: cloneSpec(initialSpec),
    documents: [],
    activeDocumentId: "",
    sourceMode: "pdf",
    activePageNumber: 1,
    rankedPages: [],
    selectionText: "",
    selectionSource: "",
    selectionRect: null,
    copiedText: "",
    pickerPosition: null,
    confirmPosition: null,
    pendingFieldKey: "",
    pendingInsertText: "",
    highlightedFieldKey: "",
    highlightTimeoutId: null,
    toastMessage: "",
    toastTimeoutId: null,
    loadingMessage: "",
    loadingStartedAt: 0,
    loadingStageStartedAt: 0,
    loadingHistory: [],
    errorMessage: "",
    assistantResult: null,
    assistantSelection: "",
    pagePreviews: {},
    pageRenderImages: {},
    pageRenderTextByKey: {},
    pageRenderMetricsByKey: {},
    pageRenderStatusByKey: {},
    pageTextVisibleByKey: {},
    pageRangeTopByKey: {},
    pageRangeOffsetByKey: {},
    pageRangeHeightByKey: {},
    pageCropViewByKey: {},
    pageReadableVariantByKey: {},
    pageReadableHtmlByKey: {},
    pageReadableTargetsByKey: {},
    pageReadableStatusByKey: {},
    pageReadableErrorByKey: {},
    wordStatsPage: null,
    ocrErrorByPage: {},
    ocrStatusByPage: {},
    visionApiKey: "",
    serverVisionConfigured: false,
    visionModel: DEFAULT_VISION_MODEL,
    productImageDataUrl: "",
    productImageName: "",
    productImageUrl: "",
    aiRerankLoading: false,
    analyzeRequestLoading: false,
    aiRerankResult: null,
    aiRerankDocumentId: "",
    aiRerankCacheByDocumentId: {},
    aiRerankRawText: "",
    debugPanelOpen: false,
    debugPanelTab: "summary",
    liveCssEnabled: window.localStorage.getItem(LIVE_CSS_PREFERENCE_KEY) === "true",
    retrievalRefinementSelections: {},
    search: {
      baseQuery: initialSpec.specDisplayName,
      selectedTerms: []
    },
    structureRouting: null,
    productFirstSelection: null,
    aiRerankError: "",
    sourceSelectionScores: [],
    sourceSelectionChosenId: "",
    decisionAssistLoading: false,
    helpSpecLoadingLineIndex: 0,
    helpSpecLoadingLineOrder: [],
    websiteSummaryLoadingLineIndex: 0,
    websiteSummaryLoadingLineOrder: [],
    decisionAssistResult: null,
    familyPageProductsByKey: {},
    familyPageProductsStatusByKey: {},
    familyPageProductsErrorByKey: {},
    activeDecisionChoiceIndex: -1,
    decisionTabsWindowStart: 0,
    decisionAssistError: "",
    summaryPanelOpen: false,
    plainPdfMode: false,
    websiteUrlInput: "",
    websiteUrl: "",
    websiteFrameStatus: "idle",
    websitePreviewRequested: false,
    websiteFrameBlockedReason: "",
    websiteEmbedCheckToken: 0,
    websiteSummaryLoading: false,
    websiteSummaryError: "",
    websiteSummary: null,
    websiteSummarySource: null,
    websiteSummaryPrompt: "",
    websiteSummaryRawText: "",
    websiteVariantFocus: "",
    websiteNarrowingSelections: {},
    websitePdfEnrichmentLoading: false,
    websitePdfEnrichmentError: "",
    websitePdfEnrichmentMessage: "",
    websitePdfEnrichmentStatus: "",
    websitePdfLoadItems: [],
    websitePaneBrowserHeight: null,
    websitePaneManualHeight: false,
    activeNarrativeSource: "",
    alternateNarrativeSource: "",
    sourceRoutingReason: "",
    sourceRoutingDetails: null,
    sourceRoutingDetailsOpen: false,
    leftRailCollapsed: false,
    plainPdfVisibleCount: 8,
    viewerScrollTop: 0,
    viewerScrollLeft: 0,
    pdfZoom: 1,
    pageStripScrollLeft: 0,
    pageStripCanScrollLeft: false,
    pageStripCanScrollRight: false,
    decisionTabsScrollLeft: 0,
    decisionTabsCanScrollLeft: false,
    decisionTabsCanScrollRight: false,
    uploadFiles: [],
    inputDraft: {
      productName: initialSpec.specDisplayName,
      brandName: initialSpec.brandDisplayName,
      category: initialSpec.category,
      attributes: initialSpec.attributes.map((attribute) => attribute.label).join("\n")
    }
  }

  let pdfjsLibPromise = null
  let persistenceDbPromise = null
  let selectionChangeTimeoutId = null
  let helpSpecLoadingIntervalId = null
  let liveCssPollIntervalId = null
  let loadingTickerIntervalId = null
  let websiteSummaryLoadingIntervalId = null
  let liveCssVersion = 0
  let floatingCopyButton = null
  const readableStatusTimerIds = {}
  let plainPdfAutoLoadFrameId = null
  let viewerPanState = null
  let pageRangeDragState = null
  let websitePaneResizeState = null
  let websiteEmbedTimeoutId = null
  let websiteVariantFocusDebounceId = null
  const app = document.getElementById("app")
  const PLAIN_PDF_BATCH_SIZE = 8

  function updateLoadingLiveDom() {
    if (!app) return
    const activeDocument = getActiveDocument() || getRoutingPdfDocument() || null
    const loadingState = getViewerLoadingState(activeDocument)
    app.querySelectorAll("[data-loading-live-meta]").forEach((node) => {
      node.textContent = loadingState.meta || ""
    })
  }

  function syncLoadingTicker() {
    const shouldRun = Boolean(appState.loadingMessage) || Boolean(appState.analyzeRequestLoading)
    if (shouldRun && !loadingTickerIntervalId) {
      loadingTickerIntervalId = window.setInterval(() => {
        if (!appState.loadingMessage && !appState.analyzeRequestLoading) {
          syncLoadingTicker()
          return
        }
        try {
          render()
        } catch (error) {
          console.error("Loading ticker render failed:", error)
          updateLoadingLiveDom()
        }
      }, 1000)
      return
    }
    if (!shouldRun && loadingTickerIntervalId) {
      window.clearInterval(loadingTickerIntervalId)
      loadingTickerIntervalId = null
    }
  }

  function setLoadingStage(message, options = {}) {
    const normalized = normalizeText(message)
    const now = Date.now()
    const shouldResetOverall = options.resetOverall === true || !appState.loadingStartedAt
    const shouldResetStage = options.resetStage === true || normalized !== appState.loadingMessage

    if (normalized) {
      if (shouldResetOverall && options.clearHistory === true) {
        appState.loadingHistory = []
      }
      const activeDocument = getActiveDocument() || getRoutingPdfDocument() || null
      const pageCount = Array.isArray(activeDocument?.pages) ? activeDocument.pages.length : 0
      const currentEntry = appState.loadingHistory[appState.loadingHistory.length - 1]
      if (shouldResetStage && currentEntry && !currentEntry.endedAt) {
        currentEntry.endedAt = now
        currentEntry.durationMs = Math.max(0, now - currentEntry.startedAt)
      }
      if (shouldResetOverall) appState.loadingStartedAt = now
      if (shouldResetStage || !appState.loadingStageStartedAt) appState.loadingStageStartedAt = now
      if (shouldResetStage && (!currentEntry || currentEntry.message !== normalized)) {
        const presentation = getLoadingPresentation(normalized, pageCount)
        appState.loadingHistory.push({
          message: normalized,
          title: presentation.title,
          copy: presentation.copy,
          startedAt: now,
          endedAt: null,
          durationMs: 0
        })
      }
      appState.loadingMessage = normalized
      syncLoadingTicker()
      return
    }

    const currentEntry = appState.loadingHistory[appState.loadingHistory.length - 1]
    if (currentEntry && !currentEntry.endedAt) {
      currentEntry.endedAt = now
      currentEntry.durationMs = Math.max(0, now - currentEntry.startedAt)
    }
    appState.loadingMessage = ""
    appState.loadingStageStartedAt = 0
    syncLoadingTicker()
  }

  function formatElapsedDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  }

  function formatByteSize(bytes) {
    const value = Number(bytes || 0)
    if (!Number.isFinite(value) || value <= 0) return ""
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`
    if (value >= 1024) return `${Math.round(value / 1024)} KB`
    return `${Math.max(1, Math.round(value))} B`
  }

  function getLoadingPresentation(rawMessage, pageCount = 0, overallElapsed = "0:00", stepElapsed = "0:00") {
    if (/grabbing the most up-to-date pdfs from the website/i.test(rawMessage)) {
      return {
        title: "Grabbing current PDFs...",
        copy: "Scanning the webpage for the most up-to-date price books and spec sheets.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/scanning the webpage for the most up-to-date price and spec pdfs/i.test(rawMessage)) {
      return {
        title: "Scanning webpage...",
        copy: "Checking the webpage for current price and spec PDFs before anything is loaded.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/looking for current pricebooks, spec sheets, and other high-value product documents/i.test(rawMessage)) {
      return {
        title: "Finding high-value PDFs...",
        copy: "Separating price books and spec sheets from generic manuals and brochures.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/fetching linked pdf/i.test(rawMessage)) {
      return {
        title: "Fetching linked PDF...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/parsing linked pdf/i.test(rawMessage)) {
      return {
        title: "Parsing linked PDF...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/loading identified pdfs from website/i.test(rawMessage)) {
      return {
        title: "Loading identified PDFs...",
        copy: "Bringing the discovered PDFs into the ranked PDF analysis workflow.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/preparing ranked pdf analysis/i.test(rawMessage)) {
      return {
        title: "Preparing ranked PDF analysis...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/loading bundled default pdf/i.test(rawMessage)) {
      return {
        title: "Loading PDF...",
        copy: "Opening the bundled default PDF so the viewer can prepare the first pass.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/parsing uploaded pdfs/i.test(rawMessage)) {
      return {
        title: "Reading PDF...",
        copy: "Opening the uploaded PDF and identifying its page count before analysis begins.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/identifying page count/i.test(rawMessage)) {
      return {
        title: "Identifying pages...",
        copy: pageCount > 0
          ? `I see ${pageCount} pages. Preparing the strongest candidates for your query.`
          : "Checking how many pages are in the PDF before ranking them.",
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/searching .* likely pages/i.test(rawMessage)) {
      return {
        title: "Searching likely pages...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/counting concrete product choices/i.test(rawMessage)) {
      return {
        title: "Counting product choices...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/grouping the biggest differences/i.test(rawMessage)) {
      return {
        title: "Narrowing the result...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    if (/choosing the best starting page/i.test(rawMessage)) {
      return {
        title: "Choosing the best page...",
        copy: rawMessage,
        meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
      }
    }

    return {
      title: "Analyzing PDF...",
      copy: pageCount > 0
        ? `I see ${pageCount} pages. Searching the strongest matches before the viewer appears.`
        : "The viewer will appear once AI finishes distinguishing the best matching pages.",
      meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
    }
  }

  function getViewerLoadingState(documentRecord = null) {
    if (appState.websitePdfLoadItems.length) {
      const now = Date.now()
      const overallElapsed = appState.loadingStartedAt ? formatElapsedDuration(now - appState.loadingStartedAt) : "0:00"
      const stepElapsed = appState.loadingStageStartedAt ? formatElapsedDuration(now - appState.loadingStageStartedAt) : overallElapsed
      const hasFetching = appState.websitePdfLoadItems.some((item) => item.status === "fetching")
      const hasParsing = appState.websitePdfLoadItems.some((item) => item.status === "parsing")
      const hasLoaded = appState.websitePdfLoadItems.some((item) => item.status === "loaded")
      const totalPdfCount = appState.websitePdfLoadItems.length
      if (hasFetching) {
        return {
          title: totalPdfCount > 1 ? "Fetching linked PDFs..." : "Fetching linked PDF...",
          copy: totalPdfCount > 1
            ? "Downloading the identified PDFs from the source website before parsing can begin."
            : "Downloading the identified PDF from the source website before parsing can begin.",
          meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
        }
      }
      if (hasParsing) {
        return {
          title: totalPdfCount > 1 ? "Parsing linked PDFs..." : "Parsing linked PDF...",
          copy: totalPdfCount > 1
            ? "Reading the downloaded PDFs and preparing them for ranked page analysis."
            : "Reading the downloaded PDF and preparing it for ranked page analysis.",
          meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
        }
      }
      if (hasLoaded) {
        return {
          title: "Preparing ranked PDF analysis...",
          copy: "The linked PDF is loaded. Preparing the strongest pages for analysis.",
          meta: `Overall ${overallElapsed} · This step ${stepElapsed}`
        }
      }
    }
    const rawMessage = normalizeText(appState.loadingMessage || "")
    const pageCount = Array.isArray(documentRecord?.pages) ? documentRecord.pages.length : 0
    const now = Date.now()
    const overallElapsed = appState.loadingStartedAt ? formatElapsedDuration(now - appState.loadingStartedAt) : "0:00"
    const stepElapsed = appState.loadingStageStartedAt ? formatElapsedDuration(now - appState.loadingStageStartedAt) : overallElapsed
    return getLoadingPresentation(rawMessage, pageCount, overallElapsed, stepElapsed)
  }

  function cloneSpec(spec) {
    return {
      ...spec,
      attributes: spec.attributes.map((attribute) => ({ ...attribute }))
    }
  }

  function refreshStylesheetLinks(version) {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = link.getAttribute("href") || ""
      if (!/styles\.css/.test(href)) return
      const url = new URL(href, window.location.href)
      url.searchParams.set("live", String(version))
      link.setAttribute("href", `${url.pathname}${url.search}`)
    })
  }

  async function checkLiveCssVersion() {
    if (!appState.liveCssEnabled) return
    try {
      const response = await fetch(`/api/live-css?ts=${Date.now()}`, { cache: "no-store" })
      if (!response.ok) return
      const payload = await response.json()
      const nextVersion = Number(payload?.version || 0)
      if (!nextVersion) return
      if (!liveCssVersion) {
        liveCssVersion = nextVersion
        return
      }
      if (nextVersion > liveCssVersion) {
        liveCssVersion = nextVersion
        refreshStylesheetLinks(nextVersion)
      }
    } catch {
      // Live CSS polling should fail quietly.
    }
  }

  function ensureLiveCssPolling() {
    if (liveCssPollIntervalId || !appState.liveCssEnabled) return
    checkLiveCssVersion()
    liveCssPollIntervalId = window.setInterval(() => {
      checkLiveCssVersion()
    }, LIVE_CSS_POLL_INTERVAL_MS)
  }

  function stopLiveCssPolling() {
    if (!liveCssPollIntervalId) return
    window.clearInterval(liveCssPollIntervalId)
    liveCssPollIntervalId = null
  }

  function setLiveCssEnabled(enabled) {
    appState.liveCssEnabled = enabled
    window.localStorage.setItem(LIVE_CSS_PREFERENCE_KEY, enabled ? "true" : "false")
    if (enabled) {
      ensureLiveCssPolling()
    } else {
      stopLiveCssPolling()
    }
  }

  function getHelpSpecLoadingLine() {
    const lineOrder = Array.isArray(appState.helpSpecLoadingLineOrder) ? appState.helpSpecLoadingLineOrder : []
    const activeIndex = lineOrder[appState.helpSpecLoadingLineIndex]
    return HELP_SPEC_LOADING_LINES[activeIndex] || HELP_SPEC_LOADING_LINES[0]
  }

  function buildHelpSpecLoadingLineOrder() {
    const order = HELP_SPEC_LOADING_LINES.map((_, index) => index)
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      const current = order[index]
      order[index] = order[swapIndex]
      order[swapIndex] = current
    }
    return order
  }

  function startHelpSpecLoadingTicker() {
    if (helpSpecLoadingIntervalId) return
    if (!appState.helpSpecLoadingLineOrder.length) {
      appState.helpSpecLoadingLineOrder = buildHelpSpecLoadingLineOrder()
    }
    helpSpecLoadingIntervalId = window.setInterval(() => {
      if (!appState.decisionAssistLoading) {
        stopHelpSpecLoadingTicker()
        return
      }
      const nextIndex = appState.helpSpecLoadingLineIndex + 1
      if (nextIndex >= HELP_SPEC_LOADING_LINES.length) {
        appState.helpSpecLoadingLineOrder = buildHelpSpecLoadingLineOrder()
        appState.helpSpecLoadingLineIndex = 0
      } else {
        appState.helpSpecLoadingLineIndex = nextIndex
      }
      renderPreservingViewerScroll()
    }, HELP_SPEC_LOADING_INTERVAL_MS)
  }

  function stopHelpSpecLoadingTicker() {
    if (!helpSpecLoadingIntervalId) return
    window.clearInterval(helpSpecLoadingIntervalId)
    helpSpecLoadingIntervalId = null
  }

  function getWebsiteSummaryLoadingLine() {
    const lineOrder = Array.isArray(appState.websiteSummaryLoadingLineOrder) ? appState.websiteSummaryLoadingLineOrder : []
    const activeIndex = lineOrder[appState.websiteSummaryLoadingLineIndex]
    return WEBSITE_SUMMARY_LOADING_LINES[activeIndex] || WEBSITE_SUMMARY_LOADING_LINES[0]
  }

  function buildWebsiteSummaryLoadingLineOrder() {
    const order = WEBSITE_SUMMARY_LOADING_LINES.map((_, index) => index)
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      const current = order[index]
      order[index] = order[swapIndex]
      order[swapIndex] = current
    }
    return order
  }

  function startWebsiteSummaryLoadingTicker() {
    if (websiteSummaryLoadingIntervalId) return
    if (!appState.websiteSummaryLoadingLineOrder.length) {
      appState.websiteSummaryLoadingLineOrder = buildWebsiteSummaryLoadingLineOrder()
    }
    websiteSummaryLoadingIntervalId = window.setInterval(() => {
      if (!appState.websiteSummaryLoading) {
        stopWebsiteSummaryLoadingTicker()
        return
      }
      const nextIndex = appState.websiteSummaryLoadingLineIndex + 1
      if (nextIndex >= WEBSITE_SUMMARY_LOADING_LINES.length) {
        appState.websiteSummaryLoadingLineOrder = buildWebsiteSummaryLoadingLineOrder()
        appState.websiteSummaryLoadingLineIndex = 0
      } else {
        appState.websiteSummaryLoadingLineIndex = nextIndex
      }
      renderPreservingViewerScroll()
    }, WEBSITE_SUMMARY_LOADING_INTERVAL_MS)
  }

  function stopWebsiteSummaryLoadingTicker() {
    if (!websiteSummaryLoadingIntervalId) return
    window.clearInterval(websiteSummaryLoadingIntervalId)
    websiteSummaryLoadingIntervalId = null
  }

  function hydrateSyntheticDocument(documentRecord) {
    return {
      ...documentRecord,
      sourceType: "synthetic",
      pages: extractPagesFromPdfText(documentRecord.pdfText)
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, timeoutMessage = "Request timed out.") {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs)
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      })
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  function hasVisionAccess() {
    return Boolean(appState.serverVisionConfigured || appState.visionApiKey)
  }

  async function refreshServerVisionStatus() {
    try {
      const response = await fetchWithTimeout("/api/vision-status", {}, 5000, "Vision status request timed out.")
      if (!response.ok) {
        appState.serverVisionConfigured = false
        return
      }

      const payload = await response.json()
      appState.serverVisionConfigured = Boolean(payload?.configured)
    } catch {
      appState.serverVisionConfigured = false
    }
  }

  async function sendOpenAiResponsesRequest(body, timeoutMessage = "OpenAI request timed out.") {
    if (appState.serverVisionConfigured) {
      return fetchWithTimeout(
        "/api/openai-responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        },
        OPENAI_API_TIMEOUT_MS,
        timeoutMessage
      )
    }

    if (!appState.visionApiKey) {
      throw new Error("Add an OpenAI API key above or configure OPENAI_API_KEY on the local server.")
    }

    return fetchWithTimeout(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${appState.visionApiKey}`
        },
        body: JSON.stringify(body)
      },
      OPENAI_API_TIMEOUT_MS,
      timeoutMessage
    )
  }

  function renderWebsiteCopyTarget(value, className = "") {
    const normalized = normalizeText(value)
    if (!normalized) return ""
    const classes = ["option-copy-trigger", "website-summary-copy-target", className].filter(Boolean).join(" ")
    return `<button class="${classes}" data-copy-value="${escapeHtml(normalized)}" type="button">${escapeHtml(normalized)}</button>`
  }

  function renderWebsiteCopyList(items) {
    if (!Array.isArray(items) || !items.length) return ""
    const listItems = items
      .map((item) => {
        const normalized = normalizeText(item)
        if (!normalized) return ""
        return `<li>${renderWebsiteCopyTarget(normalized, "website-summary-copy-inline")}</li>`
      })
      .filter(Boolean)
      .join("")
    return listItems ? `<ul>${listItems}</ul>` : ""
  }

  function getHrefFileStem(href) {
    const resolvedHref = resolveWebsiteResourceUrl(href)
    if (!resolvedHref) return ""
    try {
      const parsed = new URL(resolvedHref)
      return normalizeText(
        decodeURIComponent(parsed.pathname.split("/").pop() || "")
          .replace(/\.[a-z0-9]+$/i, "")
          .replace(/[-_]+/g, " ")
      ).toLowerCase()
    } catch {
      return ""
    }
  }

  function buildWebsiteResourceEntries(items, links = []) {
    const normalizedLinks = (Array.isArray(links) ? links : [])
      .map((item) => {
        const href = resolveWebsiteResourceUrl(item?.href || "")
        const label = normalizeText(item?.label || "")
        if (!href) return null
        return {
          href,
          label: label || href,
          labelMatch: normalizeText(label || href).toLowerCase(),
          fileStem: getHrefFileStem(href)
        }
      })
      .filter(Boolean)

    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((item) => normalizeText(item))
      .filter(Boolean)

    const entries = normalizedItems.map((itemLabel, index) => {
      const itemMatch = itemLabel.toLowerCase()
      const matchingLink = normalizedLinks.find((link) => (
        link.labelMatch === itemMatch
        || link.labelMatch.includes(itemMatch)
        || itemMatch.includes(link.labelMatch)
        || (link.fileStem && (link.fileStem.includes(itemMatch) || itemMatch.includes(link.fileStem)))
      )) || normalizedLinks[index] || null

      return {
        label: itemLabel,
        href: matchingLink?.href || "",
        openLabel: matchingLink?.label || itemLabel
      }
    }).filter((entry) => /\.pdf(?:[\?#]|$)/i.test(entry.href))

    const merged = []
    const seen = new Set()

    const pushEntry = (entry) => {
      const hrefKey = normalizeText(entry?.href || "")
      const labelKey = normalizeText(entry?.label || "").toLowerCase()
      const key = hrefKey || `label:${labelKey}`
      if (!key || seen.has(key)) return
      seen.add(key)
      merged.push(entry)
    }

    entries.forEach(pushEntry)
    normalizedLinks.forEach((item) => {
      if (!/\.pdf(?:[\?#]|$)/i.test(item.href)) return
      pushEntry({
        label: item.label,
        href: item.href,
        openLabel: item.label
      })
    })

    return merged
  }

  function renderWebsiteResourceList(items, links = []) {
    const entries = buildWebsiteResourceEntries(items, links)
    if (!entries.length) {
      return `<p class="website-summary-resource-empty">No PDF links were detected on this page.</p>`
    }

    const listItems = entries
      .map((item) => {
        const actionLabel = getResourceLinkMeta(item.href).actionLabel
        return `
        <li>
          <span class="website-summary-resource-label">${escapeHtml(item.label)}</span>
          <button
            class="website-summary-resource-open-btn"
            data-open-resource-href="${escapeHtmlAttribute(item.href)}"
            data-open-resource-label="${escapeHtmlAttribute(item.openLabel || item.label)}"
            type="button"
            aria-label="${escapeHtmlAttribute(actionLabel)}"
            title="${escapeHtmlAttribute(actionLabel)}"
          ><span aria-hidden="true">↗</span></button>
        </li>
      `
      })
      .join("")
    return `<ul>${listItems}</ul>`
  }

  function formatConfidenceLabel(value) {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric) || numeric <= 0) return "0%"
    return `${Math.round(numeric * 100)}%`
  }

  function renderWebsiteAnswerAttributes(extraction) {
    const attributes = Array.isArray(extraction?.attributes) ? extraction.attributes : []
    if (!attributes.length) {
      return '<p class="website-summary-resource-empty">No attribute results yet.</p>'
    }

    return `
      <div class="website-answer-attribute-list">
        ${attributes.map((attribute) => `
          <article class="website-answer-attribute-card status-${escapeHtmlAttribute(attribute.status || "not_found")}">
            <div class="website-answer-attribute-head">
              <span>${escapeHtml(attribute.label || attribute.attributeId || "Attribute")}</span>
              <span>${escapeHtml(formatConfidenceLabel(attribute.confidence))}</span>
            </div>
            <p>${escapeHtml(attribute.status === "filled" && extraction?.outcome === "completed" ? normalizeText(attribute.value) : attribute.status === "ambiguous" ? "Needs clarification" : "Not found on webpage")}</p>
            ${attribute.evidence?.[0]?.snippet ? `<small>${escapeHtml(attribute.evidence[0].snippet)}</small>` : ""}
          </article>
        `).join("")}
      </div>
    `
  }

  function renderWebsiteCandidateButtons(extraction) {
    const candidates = Array.isArray(extraction?.ambiguity?.productCandidates) ? extraction.ambiguity.productCandidates : []
    if (!candidates.length) return ""
    const shouldNarrowFirst = candidates.length >= 9
    if (shouldNarrowFirst) return ""
    const visibleCandidates = candidates
    return `
      <div class="website-answer-candidates">
        ${visibleCandidates.map((candidate) => {
          const label = normalizeText(candidate?.label || candidate)
          const description = normalizeText(candidate?.description || "")
          return `
            <button class="website-answer-candidate-btn website-answer-candidate-card" data-clarify-candidate="${escapeHtmlAttribute(label)}" type="button">
              <strong>${escapeHtml(label)}</strong>
              ${description ? `<span>${escapeHtml(description)}</span>` : ""}
            </button>
          `
        }).join("")}
      </div>
    `
  }

  function renderWebsiteNarrowingTerms(extraction) {
    const candidates = Array.isArray(extraction?.ambiguity?.productCandidates) ? extraction.ambiguity.productCandidates : []
    const candidateCount = Number(extraction?.ambiguity?.candidateCount || candidates.length || 0)
    const totalCandidateCount = Number(extraction?.ambiguity?.totalCandidateCount || candidateCount || 0)
    const groups = Array.isArray(extraction?.ambiguity?.narrowingGroups) ? extraction.ambiguity.narrowingGroups : []
    if (candidateCount < 9 || !groups.length) return ""
    const selectedEntries = Object.entries(appState.websiteNarrowingSelections || {}).filter(([, value]) => normalizeText(value))
    return `
      <div class="website-answer-narrowing">
        <p>${escapeHtml(`There are ${candidateCount} candidate variants on this page. Narrow the set first, then choose the exact model.`)}</p>
        ${groups.map((group) => `
          <div class="website-answer-narrow-group">
            <span>${escapeHtml(group.label || "Filter")}</span>
            <div class="website-answer-candidates">
              ${(Array.isArray(group.options) ? group.options : []).map((option) => {
                const normalizedGroup = normalizeText(group.label || "")
                const normalizedOption = normalizeText(option)
                const isSelected = normalizeText(appState.websiteNarrowingSelections?.[normalizedGroup] || "") === normalizedOption
                return `
                  <button class="website-answer-candidate-btn website-answer-narrow-chip${isSelected ? " is-selected" : ""}" data-narrow-group="${escapeHtmlAttribute(normalizedGroup)}" data-narrow-option="${escapeHtmlAttribute(normalizedOption)}" type="button">${escapeHtml(normalizedOption)}</button>
                `
              }).join("")}
            </div>
          </div>
        `).join("")}
        <div class="website-answer-narrow-actions">
          ${selectedEntries.length
            ? `<p>${escapeHtml(`Selected: ${selectedEntries.map(([group, value]) => `${group}: ${value}`).join(" | ")}`)}</p>`
            : "<p>Select one or more filters, then apply them together.</p>"
          }
          <div class="website-answer-candidates">
            <button class="website-answer-candidate-btn website-answer-apply-btn" id="website-apply-narrowing-btn" type="button" ${selectedEntries.length ? "" : "disabled"}>Apply Filters</button>
            <button class="website-answer-candidate-btn website-answer-clear-btn" id="website-clear-narrowing-btn" type="button" ${selectedEntries.length ? "" : "disabled"}>Clear</button>
          </div>
        </div>
        ${selectedEntries.length && totalCandidateCount > candidateCount
          ? `<p>${escapeHtml(`Showing ${candidateCount} narrowed candidates out of ${totalCandidateCount} total variants.`)}</p>`
          : ""
        }
      </div>
    `
  }

  function getWebsiteAmbiguityMode(extraction) {
    const count = Number(extraction?.ambiguity?.candidateCount || (Array.isArray(extraction?.ambiguity?.productCandidates) ? extraction.ambiguity.productCandidates.length : 0))
    return count > 8 ? "many" : "few"
  }

  function getWebsiteStateLabel(extraction) {
    if (extraction?.outcome === "completed") return "FOUND"
    if (extraction?.outcome === "needs_pdf_escalation") return "NOT FOUND"
    if (extraction?.outcome === "ambiguous") {
      return getWebsiteAmbiguityMode(extraction) === "many" ? "AMBIGUOUS >8" : "AMBIGUOUS <=8"
    }
    return "UNKNOWN"
  }

  function renderWebsiteSelectedNarrowingSummary() {
    const selectedEntries = Object.entries(appState.websiteNarrowingSelections || {}).filter(([, value]) => normalizeText(value))
    if (!selectedEntries.length) return ""
    return `
      <div class="website-selected-narrowing">
        <span>Active Filters</span>
        <div class="website-answer-candidates">
          ${selectedEntries.map(([group, value]) => `
            <span class="website-selected-narrowing-chip">${escapeHtml(`${group}: ${value}`)}</span>
          `).join("")}
        </div>
      </div>
    `
  }

  function renderWebsiteAmbiguityPanel(extraction) {
    const mode = getWebsiteAmbiguityMode(extraction)
    const count = Number(extraction?.ambiguity?.candidateCount || (Array.isArray(extraction?.ambiguity?.productCandidates) ? extraction.ambiguity.productCandidates.length : 0))

    if (mode === "many") {
      return `
        <div class="website-summary-full">
          <span>Clarification Needed</span>
          <p>Narrow the variant set first.</p>
          ${renderWebsiteSelectedNarrowingSummary()}
          ${renderWebsiteNarrowingTerms(extraction)}
          ${count ? `<p>${escapeHtml(`${count} candidate variants detected on this page.`)}</p>` : ""}
        </div>
      `
    }

    return `
      <div class="website-summary-full">
        <span>Clarification Needed</span>
        <p>Select the exact model or variant.</p>
        ${renderWebsiteSelectedNarrowingSummary()}
        ${renderWebsiteCandidateButtons(extraction)}
      </div>
    `
  }

  function getPithyWebsiteSummary(kind, rawText, resourceCount = 0) {
    const text = normalizeText(rawText)
    if (kind === "documents") {
      if (resourceCount > 0) return `${resourceCount} PDF${resourceCount === 1 ? "" : "s"} found.`
      return "No PDF resources found."
    }
    const fallbackByKind = {
      dimensions: "No clear dimensions.",
      finishes: "No finish details.",
      options: "No option details."
    }
    if (!text) return fallbackByKind[kind] || "Not clearly listed."
    const genericByKind = {
      dimensions: /(not clearly listed|not clearly stated|not explicitly listed|not available|no dimensions|no sizing)/i,
      finishes: /(not clearly listed|not explicitly listed|not clearly stated|not available|no finish|no material)/i,
      options: /(not clearly listed|not explicitly listed|not clearly stated|not available|no option|no configuration)/i
    }
    if (genericByKind[kind]?.test(text)) return fallbackByKind[kind] || "Not clearly listed."
    const compact = text.length > 96 ? `${text.slice(0, 96).replace(/[,:;\s.-]+$/g, "")}…` : text
    return compact
  }

  function getPdfEnrichmentCandidateLinks(summarySource) {
    const prioritized = Array.isArray(appState.websiteSummary?.escalation?.candidateDocs)
      ? appState.websiteSummary.escalation.candidateDocs
      : []
    const resources = prioritized.length
      ? prioritized.map((item) => ({
          href: item.url,
          label: item.title || item.url,
          score: Math.round(Number(item.relevanceScore || 0) * 100)
        }))
      : Array.isArray(summarySource?.resources) ? summarySource.resources : []
    const productName = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "")
    const productTokens = tokenize(productName).filter((token) => token.length >= 4 && !["chair", "chairs", "base", "arms", "arm", "nylon", "with"].includes(token))

    const scoredResources = resources
      .map((item) => {
        const href = resolveWebsiteResourceUrl(item?.href || item?.url || "")
        const label = normalizeText(item?.label || item?.title || "")
        if (!href || !/\.pdf(?:[\?#]|$)/i.test(href)) return null
        if (!/price|spec/i.test(`${label} ${href}`)) {
          return null
        }
        const combined = `${label} ${href}`.toLowerCase()
        const productMatchCount = productTokens.filter((token) => combined.includes(token)).length
        let score = Number(item?.score || 0)
        if (/price|pricing|price book/i.test(label)) score += 30
        if (/spec|sheet|guide|literature|product/i.test(label)) score += 22
        if (/dimension|finish|material|option|configuration/i.test(label)) score += 14
        if (/care|maintenance|environment|certif/i.test(label)) score += 6
        if (productMatchCount) score += productMatchCount * 25
        return { href, label: label || href, score, productMatchCount }
      })
      .filter(Boolean)

    const productSpecific = scoredResources.filter((item) => item.productMatchCount > 0)
    const filteredResources = productSpecific.length ? productSpecific : scoredResources

    return filteredResources
      .sort((a, b) => b.score - a.score)
      .slice(0, WEBSITE_PDF_ENRICHMENT_LIMIT)
  }

  function extractPdfInsightSnippets(text, pattern, limit = 4) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean)
    const snippets = []
    for (const line of lines) {
      if (!pattern.test(line)) continue
      if (line.length < 4 || line.length > 180) continue
      if (!snippets.includes(line)) snippets.push(line)
      if (snippets.length >= limit) break
    }
    return snippets
  }

  function prioritizeSnippetsByVariant(snippets, variantFocus, limit = 4) {
    const normalizedFocus = normalizeText(variantFocus).toLowerCase()
    const normalizedSnippets = Array.isArray(snippets) ? snippets : []
    if (!normalizedFocus) return normalizedSnippets.slice(0, limit)
    const tokens = normalizedFocus.split(/\s+/).filter((token) => token.length >= 2)
    if (!tokens.length) return normalizedSnippets.slice(0, limit)
    const matching = normalizedSnippets.filter((snippet) => {
      const lower = snippet.toLowerCase()
      return tokens.some((token) => lower.includes(token))
    })
    if (matching.length) return matching.slice(0, limit)
    return normalizedSnippets.slice(0, limit)
  }

  function getAttributeSearchTerms(attributeLabel) {
    const label = normalizeText(attributeLabel).toLowerCase()
    const terms = new Set([label])
    if (/width/.test(label)) ["width", "overall width", "w"].forEach((item) => terms.add(item))
    if (/length/.test(label)) ["length", "overall length", "l"].forEach((item) => terms.add(item))
    if (/depth/.test(label)) ["depth", "overall depth", "d"].forEach((item) => terms.add(item))
    if (/height/.test(label)) ["height", "overall height", "h"].forEach((item) => terms.add(item))
    if (/seat height/.test(label)) ["seat height", "sh"].forEach((item) => terms.add(item))
    if (/arm height/.test(label)) ["arm height", "ah"].forEach((item) => terms.add(item))
    if (/material/.test(label)) ["material", "materials", "construction"].forEach((item) => terms.add(item))
    if (/finish/.test(label)) ["finish", "finishes"].forEach((item) => terms.add(item))
    if (/application/.test(label)) ["application", "recommended use", "use"].forEach((item) => terms.add(item))
    if (/thickness/.test(label)) ["thickness", "gauge"].forEach((item) => terms.add(item))
    if (/base|legs/.test(label)) ["base", "legs", "frame"].forEach((item) => terms.add(item))
    return [...terms]
  }

  function extractAttributeValueFromTextBundle(attribute, textBundle, sourceStage, sourceDocTitle = "") {
    const lines = String(textBundle || "")
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .slice(0, 600)
    const searchTerms = getAttributeSearchTerms(attribute.label)
    let best = null

    lines.forEach((line) => {
      const lower = line.toLowerCase()
      const matchingTerm = searchTerms.find((term) => lower.includes(term))
      if (!matchingTerm) return

      const escaped = matchingTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const patterns = [
        new RegExp(`\\b${escaped}\\b\\s*(?:[:\\-]|is|are)\\s*([^.;\\|]{2,100})`, "i"),
        new RegExp(`\\b${escaped}\\b\\s*([0-9][^.;\\|]{0,40}?(?:mm|cm|inches|inch|in\\.?|\"))`, "i"),
        new RegExp(`\\b${escaped}\\b\\s+([^.;\\|]{2,80})`, "i")
      ]

      let value = ""
      for (const pattern of patterns) {
        const match = line.match(pattern)
        if (match?.[1]) {
          value = normalizeText(match[1]).replace(/^(available in|with)\s+/i, "")
          break
        }
      }
      if (!value || value.length > 100) return

      let confidence = 0.56
      if (line.includes(":")) confidence += 0.14
      if (/mm|cm|inch|in\.?|"/i.test(value)) confidence += 0.08
      if (/spec|price|guide/i.test(sourceDocTitle)) confidence += 0.05
      confidence = Math.max(0, Math.min(0.97, confidence))

      const candidate = {
        attributeId: attribute.key,
        label: attribute.label,
        value,
        confidence: Number(confidence.toFixed(2)),
        status: confidence >= 0.62 ? "filled" : "ambiguous",
        sourceStage,
        sourceDocTitle,
        evidence: [{ sourceType: sourceStage, snippet: line, docTitle: sourceDocTitle }]
      }
      if (!best || candidate.confidence > best.confidence) best = candidate
    })

    return best || {
      attributeId: attribute.key,
      label: attribute.label,
      value: null,
      confidence: 0,
      status: "not_found",
      sourceStage,
      sourceDocTitle,
      evidence: []
    }
  }

  async function enrichWebsiteSummaryWithPdfData(url, token) {
    if (!appState.websiteSummarySource) return
    const candidateLinks = getPdfEnrichmentCandidateLinks(appState.websiteSummarySource)
    if (!candidateLinks.length) return
    appState.websitePdfEnrichmentLoading = true
    appState.websitePdfEnrichmentError = ""
    appState.websitePdfEnrichmentStatus = ""
    const focusHint = normalizeText(appState.websiteVariantFocus)
    appState.websitePdfEnrichmentMessage = focusHint
      ? `We’ve found PDFs that may contain helpful product details and are analyzing them now with focus on "${focusHint}".`
      : "We’ve found PDFs that may contain helpful product details and are analyzing them now to provide more information."
    renderPreservingViewerScroll()

    try {
      if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return
      const documents = await loadPdfDocumentsIntoPipeline(candidateLinks)
      if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return
      appState.websitePdfEnrichmentLoading = false
      appState.websitePdfEnrichmentError = ""
      appState.websitePdfEnrichmentMessage = ""
      appState.websitePdfEnrichmentStatus = `Loaded ${documents.length} PDF${documents.length === 1 ? "" : "s"} into the full PDF analysis pipeline${focusHint ? ` for "${focusHint}"` : ""}.`
      renderPreservingViewerScroll()
    } catch (error) {
      if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return
      appState.websitePdfEnrichmentLoading = false
      appState.websitePdfEnrichmentError = error instanceof Error ? error.message : "Unable to enrich summary with PDF findings."
      appState.websitePdfEnrichmentMessage = ""
      appState.websitePdfEnrichmentStatus = ""
      renderPreservingViewerScroll()
    }
  }

  async function discoverWebsitePdfLinks(url, token) {
    const response = await fetchWithTimeout(
      `/api/website-pdfs?url=${encodeURIComponent(url)}`,
      {
        method: "GET",
        cache: "no-store"
      },
      WEBSITE_SUMMARY_FETCH_TIMEOUT_MS,
      "Website PDF discovery request timed out."
    )
    const result = await response.json()
    if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return null
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || "Unable to scan the webpage for PDFs.")
    }
    const source = {
      title: "",
      description: "",
      headings: [],
      url: result.finalUrl || url,
      resources: Array.isArray(result.resources) ? result.resources : []
    }
    appState.websiteSummarySource = source
    appState.websiteSummaryPrompt = ""
    appState.websiteSummaryRawText = ""
    appState.websiteSummary = {
      outcome: "needs_pdf_escalation",
      productName: appState.spec.specDisplayName || appState.spec.originalSpecName || "",
      completionScore: 0,
      overallConfidence: 0,
      message: "Using the webpage to find high-value PDFs for this product.",
      escalation: {
        message: "Scanning the webpage for current price and spec PDFs.",
        candidateDocs: []
      }
    }
    return getPdfEnrichmentCandidateLinks(source)
  }

  function getWebsiteResourceLinks(summary) {
    const summaryLinks = Array.isArray(summary?.resource_links) ? summary.resource_links : []
    const sourceLinks = Array.isArray(appState.websiteSummarySource?.resources) ? appState.websiteSummarySource.resources : []
    return summaryLinks.length ? summaryLinks : sourceLinks
  }

  function resolveWebsiteResourceUrl(value) {
    const rawValue = normalizeText(value)
    if (!rawValue) return ""
    const baseUrl = normalizeWebsiteUrl(appState.websiteSummarySource?.url || appState.websiteUrl || appState.websiteUrlInput || "")
    try {
      const resolved = baseUrl ? new URL(rawValue, baseUrl) : new URL(rawValue)
      if (!/^https?:$/i.test(resolved.protocol)) return ""
      return resolved.toString()
    } catch {
      return normalizeWebsiteUrl(rawValue)
    }
  }

  function getResourceLinkMeta(href) {
    const resolvedHref = resolveWebsiteResourceUrl(href)
    if (!resolvedHref) {
      return {
        kind: "unknown",
        extension: "",
        actionLabel: "Open Link"
      }
    }

    if (/\.pdf(?:[\?#]|$)/i.test(resolvedHref)) {
      return {
        kind: "pdf",
        extension: "pdf",
        actionLabel: "Open PDF"
      }
    }

    const fileMatch = resolvedHref.match(/\.([a-z0-9]{2,6})(?:[\?#]|$)/i)
    if (fileMatch) {
      const extension = String(fileMatch[1] || "").toLowerCase()
      const webpageExtensions = new Set(["html", "htm", "php", "asp", "aspx", "jsp"])
      if (webpageExtensions.has(extension)) {
        return {
          kind: "webpage",
          extension,
          actionLabel: "Open Webpage"
        }
      }
      return {
        kind: "file",
        extension,
        actionLabel: `Open File (${extension.toUpperCase()})`
      }
    }

    return {
      kind: "webpage",
      extension: "",
      actionLabel: "Open Webpage"
    }
  }

  function normalizeWebsiteUrl(value) {
    const rawValue = normalizeText(value)
    if (!rawValue) return ""
    const candidate = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`
    try {
      const url = new URL(candidate)
      if (!/^https?:$/i.test(url.protocol)) return ""
      return url.toString()
    } catch {
      return ""
    }
  }

  function clearWebsiteEmbedTimeout() {
    if (!websiteEmbedTimeoutId) return
    window.clearTimeout(websiteEmbedTimeoutId)
    websiteEmbedTimeoutId = null
  }

  function queueWebsiteEmbedTimeout() {
    clearWebsiteEmbedTimeout()
    websiteEmbedTimeoutId = window.setTimeout(() => {
      if ((appState.sourceMode !== "website" && appState.sourceMode !== "both") || appState.websiteFrameStatus !== "loading") return
      appState.websiteFrameBlockedReason = "Website did not finish loading in the embedded viewer."
      appState.websiteFrameStatus = "blocked"
      renderPreservingViewerScroll()
    }, WEBSITE_EMBED_TIMEOUT_MS)
  }

  function requestWebsitePreviewLoad() {
    if (!appState.websiteUrl) return
    appState.websitePreviewRequested = true
    appState.websiteFrameStatus = "loading"
    appState.websiteFrameBlockedReason = ""
    renderPreservingViewerScroll()
    queueWebsiteEmbedTimeout()
  }

  function queueWebsiteVariantFocusEnrichment() {
    if (websiteVariantFocusDebounceId) {
      window.clearTimeout(websiteVariantFocusDebounceId)
      websiteVariantFocusDebounceId = null
    }
    websiteVariantFocusDebounceId = window.setTimeout(() => {
      websiteVariantFocusDebounceId = null
      if (!appState.websiteUrl || appState.websiteSummaryLoading) return
      if (appState.websiteSummary?.outcome === "ambiguous") {
        loadWebsite(appState.websiteUrl, { persist: false }).catch(() => {})
        return
      }
      if (!appState.websiteSummarySource || appState.websitePdfEnrichmentLoading) return
      enrichWebsiteSummaryWithPdfData(appState.websiteUrl, appState.websiteEmbedCheckToken).catch(() => {})
    }, 650)
  }

  function getIframeLoadFailureReason(iframe) {
    if (!iframe) return ""

    try {
      const frameLocation = normalizeText(iframe.contentWindow?.location?.href || "")
      if (/^chrome-error:\/\//i.test(frameLocation) || /^about:blank$/i.test(frameLocation)) {
        return "Website refused to load in the embedded viewer."
      }
    } catch {
      // Cross-origin success cases often throw here; ignore.
    }

    try {
      const frameText = normalizeText(iframe.contentDocument?.body?.innerText || "")
      if (/refused to connect|refused to display|blocked|cannot be displayed|frame/i.test(frameText)) {
        return frameText.slice(0, 180) || "Website refused to load in the embedded viewer."
      }
    } catch {
      // Cross-origin success cases often throw here; ignore.
    }

    return ""
  }

  function getPreferredWebsiteBrowserHeight() {
    if (appState.websitePaneManualHeight && Number.isFinite(Number(appState.websitePaneBrowserHeight))) {
      return Math.max(100, Math.min(760, Number(appState.websitePaneBrowserHeight)))
    }
    return 750
  }

  async function checkWebsiteEmbeddability(url, token) {
    try {
      const response = await fetch(`/api/embed-check?url=${encodeURIComponent(url)}`, { cache: "no-store" })
      if (!response.ok) return
      const result = await response.json()
      if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return
      if (appState.sourceMode !== "website" && appState.sourceMode !== "both") return

      if (result?.blocked) {
        clearWebsiteEmbedTimeout()
        appState.websiteFrameBlockedReason = Array.isArray(result.reasons) ? result.reasons.join(" · ") : "Website blocks embedded viewing."
        appState.websiteFrameStatus = "blocked"
        renderPreservingViewerScroll()
      }
    } catch {
      // Timeout fallback remains active when the header check is unavailable.
    }
  }

  async function loadWebsiteSummary(url, token) {
    if (!syncSpecFromDraft()) {
      appState.websiteSummaryLoading = false
      appState.websiteSummaryError = "Add at least one attribute before running website extraction."
      renderPreservingViewerScroll()
      return
    }

    if (!normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName)) {
      appState.websiteSummaryLoading = false
      appState.websiteSummaryError = "Product name is required before running website extraction."
      renderPreservingViewerScroll()
      return
    }

    appState.websiteSummaryLoading = true
    appState.websiteSummaryError = ""
    appState.websiteSummary = null
    appState.websiteSummarySource = null
    appState.websiteSummaryPrompt = ""
    appState.websiteSummaryRawText = ""
    appState.websiteVariantFocus = ""
    appState.websiteNarrowingSelections = {}
    appState.websitePdfEnrichmentLoading = false
    appState.websitePdfEnrichmentError = ""
    appState.websitePdfEnrichmentMessage = ""
    appState.websitePdfEnrichmentStatus = ""
    appState.websitePdfLoadItems = []
    appState.websiteSummaryLoadingLineIndex = 0
    appState.websiteSummaryLoadingLineOrder = buildWebsiteSummaryLoadingLineOrder()
    startWebsiteSummaryLoadingTicker()
    renderPreservingViewerScroll()

    try {
      const response = await fetchWithTimeout(
        `/api/website-pdfs?url=${encodeURIComponent(url)}`,
        {
          method: "GET",
          cache: "no-store"
        },
        WEBSITE_SUMMARY_FETCH_TIMEOUT_MS,
        "Website PDF discovery request timed out."
      )
      const result = await response.json()
      if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return

      if (!response.ok || !result?.ok) {
        stopWebsiteSummaryLoadingTicker()
        appState.websiteSummaryLoading = false
        appState.websiteSummaryError = result?.error || "Unable to scan the webpage for PDFs."
        renderPreservingViewerScroll()
        return
      }

      appState.websiteSummarySource = result
        ? {
            title: "",
            description: "",
            headings: [],
            url: result.finalUrl || url,
            resources: Array.isArray(result.resources) ? result.resources : []
          }
        : null
      appState.websiteSummaryPrompt = ""
      appState.websiteSummaryRawText = ""
      appState.websiteSummary = {
        outcome: "needs_pdf_escalation",
        productName: appState.spec.specDisplayName || appState.spec.originalSpecName || "",
        completionScore: 0,
        overallConfidence: 0,
        message: "Using the webpage to find high-value PDFs for this product.",
        escalation: {
          message: "Scanning the webpage for current price and spec PDFs.",
          candidateDocs: []
        }
      }
      resetAttributeExtractionState({ clearValues: true })

      stopWebsiteSummaryLoadingTicker()
      appState.websiteSummaryLoading = false
      appState.websiteSummaryError = ""
      renderPreservingViewerScroll()
      if (getPdfEnrichmentCandidateLinks(appState.websiteSummarySource).length) {
        enrichWebsiteSummaryWithPdfData(url, token).catch(() => {})
      }
    } catch (error) {
      if (token !== appState.websiteEmbedCheckToken || normalizeWebsiteUrl(url) !== appState.websiteUrl) return
      stopWebsiteSummaryLoadingTicker()
      appState.websiteSummaryLoading = false
      appState.websiteSummaryError = error instanceof Error ? error.message : "Unable to scan the webpage for PDFs."
      appState.websitePdfEnrichmentLoading = false
      appState.websitePdfEnrichmentError = ""
      appState.websitePdfEnrichmentMessage = ""
      appState.websitePdfEnrichmentStatus = ""
      appState.websitePdfLoadItems = []
      renderPreservingViewerScroll()
    }
  }

  async function loadWebsite(url, options = {}) {
    const normalizedUrl = normalizeWebsiteUrl(url)
    if (!normalizedUrl) {
      appState.errorMessage = "Enter a valid website URL starting with http:// or https://."
      showToast(appState.errorMessage)
      render()
      return false
    }

    appState.errorMessage = ""
    appState.websiteUrlInput = normalizedUrl
    appState.websiteUrl = normalizedUrl
    appState.websiteFrameStatus = "idle"
    appState.websitePreviewRequested = false
    appState.websiteFrameBlockedReason = ""
    appState.websiteEmbedCheckToken += 1
    appState.websiteSummaryLoading = false
    appState.websiteSummaryError = ""
    appState.websiteSummary = null
    appState.websiteSummarySource = null
    appState.websiteSummaryPrompt = ""
    appState.websiteSummaryRawText = ""
    appState.websitePdfEnrichmentLoading = false
    appState.websitePdfEnrichmentError = ""
    appState.websitePdfEnrichmentMessage = ""
    appState.websitePdfEnrichmentStatus = ""
    appState.websiteSummaryLoadingLineIndex = 0
    appState.websiteSummaryLoadingLineOrder = []
    appState.websitePaneBrowserHeight = null
    appState.websitePaneManualHeight = false
    appState.viewerScrollTop = 0
    appState.viewerScrollLeft = 0
    appState.search.baseQuery = normalizeText(appState.inputDraft.productName || "")
    appState.search.selectedTerms = []
    appState.analyzeRequestLoading = true
    appState.documents = []
    appState.activeDocumentId = ""
    appState.rankedPages = []
    appState.pagePreviews = {}
    appState.pageRenderImages = {}
    appState.pageRenderTextByKey = {}
    appState.pageRenderMetricsByKey = {}
    appState.pageRenderStatusByKey = {}
    appState.pageTextVisibleByKey = {}
    appState.pageRangeTopByKey = {}
    appState.pageRangeOffsetByKey = {}
    appState.pageRangeHeightByKey = {}
    appState.pageCropViewByKey = {}
    appState.pageReadableVariantByKey = {}
    appState.pageReadableHtmlByKey = {}
    appState.pageReadableTargetsByKey = {}
    appState.pageReadableStatusByKey = {}
    appState.pageReadableErrorByKey = {}
    appState.aiRerankResult = null
    appState.aiRerankDocumentId = ""
    appState.aiRerankCacheByDocumentId = {}
    appState.aiRerankError = ""
    appState.sourceSelectionScores = []
    appState.sourceSelectionChosenId = ""
    appState.decisionAssistResult = null
    appState.decisionAssistError = ""
    appState.websitePdfLoadItems = []
    appState.sourceMode = "pdf"
    appState.activeNarrativeSource = "pdf"
    appState.alternateNarrativeSource = ""
    appState.sourceRoutingReason = ""
    appState.sourceRoutingDetails = null
    appState.sourceRoutingDetailsOpen = false
    setLoadingStage("Grabbing the most up-to-date PDFs from the website...", { resetOverall: true })
    resetAttributeExtractionState({ clearValues: true })
    clearSelectionState()
    render()
    checkWebsiteEmbeddability(normalizedUrl, appState.websiteEmbedCheckToken).catch(() => {})
    if (options.persist !== false) {
      saveCurrentAsDefault().catch(() => {})
    }
    try {
      const candidateLinks = await discoverWebsitePdfLinks(normalizedUrl, appState.websiteEmbedCheckToken)
      if (!candidateLinks || !candidateLinks.length) {
        appState.errorMessage = "No price or spec PDFs were found on this webpage."
        setLoadingStage("")
        appState.analyzeRequestLoading = false
        render()
        return false
      }
      await loadPdfDocumentsIntoPipeline(candidateLinks)
      appState.analyzeRequestLoading = false
      render()
      return true
    } catch (error) {
      appState.errorMessage = error instanceof Error ? error.message : "Unable to scan the webpage for PDFs."
      setLoadingStage("")
      appState.analyzeRequestLoading = false
      render()
      return false
    }
  }

  function resetBothModeState() {
    appState.debugPanelOpen = false
    appState.plainPdfMode = false
    appState.loadingMessage = ""
    appState.activeNarrativeSource = ""
    appState.alternateNarrativeSource = ""
    appState.sourceRoutingReason = ""
    appState.sourceRoutingDetails = null
    appState.sourceRoutingDetailsOpen = false
    clearSelectionState()
  }

  function setSourceMode(mode) {
    const nextMode = mode === "website" ? "website" : mode === "pdf" ? "pdf" : mode === "both" ? "both" : ""
    if (appState.sourceMode === nextMode) return
    appState.sourceMode = nextMode
    appState.errorMessage = ""
    clearSelectionState()
    if (nextMode === "website") {
      appState.debugPanelOpen = false
      appState.plainPdfMode = false
      appState.loadingMessage = ""
      appState.activeNarrativeSource = "website"
      appState.alternateNarrativeSource = ""
      appState.sourceRoutingReason = ""
      appState.sourceRoutingDetails = null
      appState.sourceRoutingDetailsOpen = false
    } else if (nextMode === "both") {
      resetBothModeState()
    } else {
      clearWebsiteEmbedTimeout()
      appState.websitePreviewRequested = false
      appState.websiteFrameBlockedReason = ""
      appState.websiteSummaryLoading = false
      appState.websiteSummaryError = ""
      appState.websiteSummary = null
      appState.websiteSummarySource = null
      appState.websiteSummaryPrompt = ""
      appState.websiteSummaryRawText = ""
      appState.websiteVariantFocus = ""
      appState.websiteNarrowingSelections = {}
      appState.websitePdfEnrichmentLoading = false
      appState.websitePdfEnrichmentError = ""
      appState.websitePdfEnrichmentMessage = ""
      appState.websitePdfEnrichmentStatus = ""
      appState.websitePdfLoadItems = []
      appState.websiteSummaryLoadingLineIndex = 0
      appState.websiteSummaryLoadingLineOrder = []
      appState.websitePaneBrowserHeight = null
      appState.websitePaneManualHeight = false
      appState.activeNarrativeSource = "pdf"
      appState.alternateNarrativeSource = ""
      appState.sourceRoutingReason = ""
      appState.sourceRoutingDetails = null
      appState.sourceRoutingDetailsOpen = false
    }
    render()
  }

  function slugify(value, fallback) {
    const slug = normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    return slug || fallback
  }

  function getAttributeType(label) {
    return /notes|description|remarks|details/i.test(label) ? "textarea" : "text"
  }

  function buildConfigurationOptionsFromSections(characteristic) {
    const sections = Array.isArray(characteristic?.configuration_sections)
      ? characteristic.configuration_sections
      : Array.isArray(characteristic?.configurationSections)
        ? characteristic.configurationSections
        : []
    if (!sections.length) return []

    const matrix = characteristic?.pricing_matrix || characteristic?.pricingMatrix || null
    const matrixRows = Array.isArray(matrix?.rows) ? matrix.rows : []
    const rowMap = new Map(
      matrixRows
        .map((row) => ({
          name: normalizeText(row?.row_name || row?.rowName || row?.name || ""),
          cells: Array.isArray(row?.cells) ? row.cells : []
        }))
        .filter((row) => row.name)
        .map((row) => [row.name.toLowerCase(), row.cells])
    )

    return sections
      .map((section) => {
        const name = normalizeText(section?.title || section?.name || section?.label || "")
        const optionList = Array.isArray(section?.options) ? section.options : []
        const values = optionList.map((item) => normalizeText(item)).filter(Boolean).join("; ")
        const matchingCells = rowMap.get(name.toLowerCase()) || []
        const pricing = matchingCells
          .map((cell) => {
            const label = normalizeText(cell?.column || cell?.label || "")
            const price = normalizeText(cell?.price || "")
            const model = normalizeText(cell?.model || "")
            if (!label || !price) return ""
            return `${label}: ${price}${model ? ` [${model}]` : ""}`
          })
          .filter(Boolean)
          .join("; ")
        return {
          name,
          values,
          pricing,
          difference: "",
          evidence: ""
        }
      })
      .filter((item) => item.name)
  }

  function getConfigurationSections(characteristic) {
    const sections = Array.isArray(characteristic?.configuration_sections)
      ? characteristic.configuration_sections
      : Array.isArray(characteristic?.configurationSections)
        ? characteristic.configurationSections
        : []
    if (sections.length) {
      return sections
        .map((section) => ({
          title: normalizeText(section?.title || section?.name || section?.label || ""),
          options: Array.isArray(section?.options)
            ? section.options.map((item) => formatConfigurationDisplayLabel(item)).filter(Boolean)
            : []
        }))
        .filter((section) => section.title)
    }

    return getCharacteristicOptions(characteristic).map((option) => ({
      title: formatConfigurationDisplayLabel(option.name),
      options: parseConfigurationSectionItems(option.values).map((item) => formatConfigurationDisplayLabel(item))
    }))
  }

  function getConfigurationMatrix(characteristic) {
    const matrix = characteristic?.pricing_matrix || characteristic?.pricingMatrix || null
    if (!matrix) return null
    const rowLabel = formatConfigurationDisplayLabel(matrix?.row_label || matrix?.rowLabel || "")
    const columns = Array.isArray(matrix?.column_labels)
      ? matrix.column_labels.map((item) => formatConfigurationDisplayLabel(item)).filter(Boolean)
      : Array.isArray(matrix?.columnLabels)
        ? matrix.columnLabels.map((item) => formatConfigurationDisplayLabel(item)).filter(Boolean)
        : []
    const rows = Array.isArray(matrix?.rows)
      ? matrix.rows.map((row) => ({
        name: formatConfigurationDisplayLabel(row?.row_name || row?.rowName || row?.name || ""),
        cells: Array.isArray(row?.cells)
          ? row.cells.map((cell) => ({
              column: formatConfigurationDisplayLabel(cell?.column || cell?.label || ""),
              price: normalizeText(cell?.price || ""),
              model: normalizeText(cell?.model || ""),
              matchKey: getConfigurationMatchKey(cell?.column || cell?.label || "")
            }))
          : []
      })).filter((row) => row.name)
      : []
    if (!columns.length || !rows.length) return null
    return { rowLabel, columns, rows }
  }

  function isFinishOrShellDescriptor(value) {
    const normalized = normalizeText(value).toLowerCase()
    if (!normalized) return false
    return /finish|veneer|chrome|walnut|ash|oak|ebony|palisander|stain|black base|chrome base|shell|nonupholstered|upholstered/.test(normalized)
  }

  function shouldHideConfigurationCharacteristic(characteristic, selectedVariantId, characteristics) {
    if (!/configuration/i.test(normalizeText(characteristic?.label || ""))) return false

    const hasShellFinish = hasCharacteristicLabel(characteristics, /shell finish|wood finish/i)
    const hasBaseFrameFinish = hasCharacteristicLabel(characteristics, /base finish|frame finish|base \/ frame finish/i)
    if (!hasShellFinish && !hasBaseFrameFinish) return false

    const sections = getConfigurationSections(characteristic)
    const options = getCharacteristicOptions(characteristic)
    const matrix = getConfigurationMatrix(characteristic)

    const hasMeaningfulSections = sections.some((section) => {
      if (!section.options.length) return false
      if (isFinishOrShellDescriptor(section.title)) return false
      return section.options.some((option) => !isFinishOrShellDescriptor(option))
    })

    const hasMeaningfulOptions = options.some((option) => !isFinishOrShellDescriptor(option.name) && !isGenericConfigurationOptionName(option.name))

    const hasMeaningfulMatrix = Boolean(
      matrix
      && !isFinishOrShellDescriptor(matrix.rowLabel)
      && matrix.rows.some((row) => !isFinishOrShellDescriptor(row.name))
      && matrix.columns.some((column) => !isFinishOrShellDescriptor(column))
      && matrix.rows.some((row) => row.cells.some((cell) => normalizeText(cell.price)))
    )

    const onlyGenericShellStub = !hasMeaningfulSections && !hasMeaningfulOptions && !hasMeaningfulMatrix
    if (selectedVariantId && onlyGenericShellStub) return true
    return onlyGenericShellStub
  }

  function pruneResolvedConfigurationCharacteristics(characteristics, selectedVariantId) {
    const items = Array.isArray(characteristics) ? characteristics : []
    return items.filter((characteristic) => !shouldHideConfigurationCharacteristic(characteristic, selectedVariantId, items))
  }

  function getCharacteristicOptions(characteristic) {
    if (!Array.isArray(characteristic?.options)) {
      return buildConfigurationOptionsFromSections(characteristic)
    }
    return characteristic.options
      .map((item) => {
        if (typeof item === "string") {
          return { name: normalizeText(item), values: "", pricing: "", difference: "", evidence: "" }
        }
        return {
          name: normalizeText(item?.name || item?.label || ""),
          values: normalizeText(item?.values || item?.spec_values || ""),
          pricing: normalizeText(item?.pricing || item?.price || ""),
          difference: normalizeText(item?.difference || ""),
          evidence: normalizeText(item?.evidence || "")
        }
      })
      .filter((item) => item.name)
  }

  function isCompactCharacteristicLabel(label) {
    return /shell finish|frame finish|wood finish|base finish|finish|upholstery|material/i.test(normalizeText(label))
  }

  function parseOptionValueLines(rawValueText) {
    return normalizeText(rawValueText)
      .split(/\s*;\s*|\s*,\s*(?=[A-Z][^,]{0,60}:)/)
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .map((segment) => {
        const colonIndex = segment.indexOf(":")
        if (colonIndex === -1) {
          const trailingValueMatch = segment.match(/^(.*?)(\b\d[\d\s./"]*(?:in|ft|sq ft|mm|cm|m)?\b.*)$/i)
          if (trailingValueMatch) {
            return {
              label: normalizeText(trailingValueMatch[1]),
              value: normalizeText(trailingValueMatch[2])
            }
          }
          return { label: "", value: segment }
        }
        return {
          label: normalizeText(segment.slice(0, colonIndex)),
          value: normalizeText(segment.slice(colonIndex + 1))
        }
      })
  }

  function parseConfigurationSectionItems(rawValueText) {
    return normalizeText(rawValueText)
      .split(/\s*;\s*|\n+/)
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .map((segment) => {
        const colonIndex = segment.indexOf(":")
        return colonIndex === -1 ? normalizeText(segment) : normalizeText(segment.slice(colonIndex + 1))
      })
      .filter(Boolean)
  }

  function buildFallbackConciseComparison(characteristic) {
    const options = getCharacteristicOptions(characteristic)
    if (options.length < 2) return ""
    const optionNames = options.map((item) => item.name).join(" vs ")
    const firstDifference = options.find((item) => item.difference)?.difference || normalizeText(characteristic?.dependencyNote || characteristic?.blurb || "")
    return firstDifference ? `${optionNames}: ${firstDifference}` : ""
  }

  function buildOptionDifferenceSummary(characteristic) {
    const options = getCharacteristicOptions(characteristic)
      .filter((item) => normalizeText(item.difference))
      .map((item) => ({
        name: item.name,
        difference: normalizeText(item.difference).replace(/\.$/, "")
      }))
    if (!options.length) return ""
    if (options.length === 1) return options[0].difference
    if (options.length === 2) {
      return `${options[0].name} is ${options[0].difference.toLowerCase()}, while ${options[1].name} is ${options[1].difference.toLowerCase()}.`
    }
    return options.map((item) => `${item.name}: ${item.difference}`).join(" • ")
  }

  function formatPageRangeLabel(pageNumbers) {
    if (!pageNumbers?.length) return ""
    const sorted = [...new Set(pageNumbers)].sort((a, b) => a - b)
    if (sorted.length === 1) return String(sorted[0])
    const segments = []
    let rangeStart = sorted[0]
    let previous = sorted[0]

    for (let index = 1; index <= sorted.length; index += 1) {
      const current = sorted[index]
      const isBreak = current !== previous + 1
      if (isBreak) {
        segments.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`)
        rangeStart = current
      }
      previous = current
    }

    return segments.join(", ")
  }

  function countPatternMatches(text, pattern) {
    if (!text || !(pattern instanceof RegExp)) return 0
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
    const globalPattern = new RegExp(pattern.source, flags)
    return [...text.matchAll(globalPattern)].length
  }

  function detectFamilyPdfArchetype(documentRecord = null) {
    const documentToCheck = documentRecord || getActiveDocument()
    if (!documentToCheck?.pages?.length) return false

    const samplePages = documentToCheck.pages.slice(0, 16)
    let familySignals = 0
    let strongStructuredPages = 0

    samplePages.forEach((page) => {
      const text = normalizeText(getPageCombinedText(page))
      if (!text) return
      const lowered = text.toLowerCase()
      const modelMatches = text.match(/\b[A-Z]{1,5}-\d{1,4}[A-Z0-9-]*\b/g) || []
      const itemNumberMatches = text.match(/\b\d{4,6}\b/g) || []
      const hasItemTableHeader =
        /item\s+description/i.test(text)
        || (/\bitem\b/i.test(text) && /\bdescription\b/i.test(text))
      const hasPricingSignals =
        /list price/i.test(text)
        || /\bcom\b/i.test(text)
        || /\bcol\b/i.test(text)
      const repeatedDimensionSignals =
        countPatternMatches(text, /\bW\s*\d{1,3}(?:\.\d+)?\b/gi)
        + countPatternMatches(text, /\bD\s*\d{1,3}(?:\.\d+)?\b/gi)
        + countPatternMatches(text, /\bH\s*\d{1,3}(?:\.\d+)?\b/gi)
        + countPatternMatches(text, /\bSH\s*\d{1,3}(?:\.\d+)?\b/gi)
        + countPatternMatches(text, /\bAH\s*\d{1,3}(?:\.\d+)?\b/gi)
      const repeatedMaterialSignals =
        countPatternMatches(text, /\b(?:fabric|leather|mesh)\b/gi)
        + countPatternMatches(text, /\b(?:nylon|aluminum|wood|wire)\b/gi)
      const orderConfigSignals =
        /to order specify|product number|fabric|mesh color|base finish|frame\/arm|upholstered arm cap/i.test(lowered)
      const repeatedRowStructure =
        modelMatches.length >= 3
        || itemNumberMatches.length >= 4
        || (hasItemTableHeader && hasPricingSignals)
      const denseSpecGrid =
        hasPricingSignals
        && (repeatedDimensionSignals >= 6 || repeatedMaterialSignals >= 5)

      if (modelMatches.length >= 2) familySignals += 2
      if (itemNumberMatches.length >= 4) familySignals += 2
      if (hasItemTableHeader && hasPricingSignals) familySignals += 3
      if (denseSpecGrid) familySignals += 2
      if (orderConfigSignals) familySignals += 2
      if (/series\b/i.test(text) && /low back|high back|wire base|wood base|pedestal|chair|stool|task|conference|mesh|upholstered/i.test(lowered)) familySignals += 1
      if (/required to specify|metal finish|veneer finish|shell finish|finish options/i.test(lowered)) familySignals += 1
      if (repeatedRowStructure && (denseSpecGrid || orderConfigSignals)) strongStructuredPages += 1
    })

    return familySignals >= 5 || strongStructuredPages >= 1
  }

  function getSpecParsingMode(documentRecord = null) {
    if (detectFamilyPdfArchetype(documentRecord)) return "family"
    return "contiguous"
  }

  function getSpecParsingModeConfig(modeOverride = "") {
    const mode = normalizeText(modeOverride) || getSpecParsingMode()
    if (mode === "family") {
      return {
        mode,
        label: "family",
        scopeNoun: "family",
        pageLabel: "family-relevant",
        selectorProductTitle: "Select the product in this family",
        selectorProductCopy: "This page appears to contain more than one distinct product within the same family. Choose the product first, then the system will gather the shared spec and reference pages tied to that family context.",
        selectorVariantTitle: "Select the variant to review",
        selectorVariantCopy: "This page appears to contain multiple related variants in the same family. Pick the variant first, then the system will gather the family-level spec and reference pages that apply to it."
      }
    }

    return {
      mode,
      label: "contiguous product",
      scopeNoun: "product",
      pageLabel: "contiguous",
      selectorProductTitle: "Select the product on this page",
      selectorProductCopy: "This starting page appears to contain more than one product. Choose the one you want, then the system will scan forward until the next page is no longer the same product.",
      selectorVariantTitle: "Select the variant to review",
      selectorVariantCopy: "This starting page appears to contain more than one variant for the same product. Pick the one you want before the spec characteristics are shown."
    }
  }

  function getFamilyResultPageLimit() {
    return 8
  }

  function normalizeStructureType(value) {
    const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_")
    if (normalized === "product_family") return "product_family"
    if (normalized === "single_product") return "single_product"
    return ""
  }

  function normalizeInteractionModel(value) {
    const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_")
    if (normalized === "product_first") return "product_first"
    if (normalized === "page_first") return "page_first"
    return ""
  }

  function normalizeStructureConfidenceLabel(value) {
    const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_")
    if (normalized === "high") return "high"
    if (normalized === "medium") return "medium"
    if (normalized === "low") return "low"
    return ""
  }

  function isStructureRoutingUncertain(result = null) {
    const aiResult = result || appState.aiRerankResult
    if (!aiResult) return false
    const confidenceLabel = normalizeStructureConfidenceLabel(aiResult.structureConfidenceLabel || "")
    const singleLikelihood = Number(aiResult.singleScopeLikelihood)
    const multiLikelihood = Number(aiResult.multiScopeLikelihood)
    if (confidenceLabel === "low") return true
    if (Number.isFinite(singleLikelihood) && Number.isFinite(multiLikelihood)) {
      return Math.abs(singleLikelihood - multiLikelihood) < 18
    }
    return false
  }

  function parseModelBoolean(value) {
    if (typeof value === "boolean") return value
    const normalized = normalizeText(value).toLowerCase()
    if (normalized === "true" || normalized === "yes") return true
    if (normalized === "false" || normalized === "no") return false
    return false
  }

  function getStructureTypeFromArchetype(mode) {
    return mode === "family" ? "product_family" : "single_product"
  }

  function isAbstractProductBucket(label) {
    const normalized = normalizeText(label).toLowerCase()
    if (!normalized) return true
    return /\b(base type|upholstery type|finish type|variant|configuration|material|wood base|wire base|pedestal|shell finish|frame finish|base finish)\b/.test(normalized)
  }

  function getConcreteProductCandidateKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  }

  function isConcreteProductLabel(label) {
    const normalized = normalizeText(label)
    const lowered = normalized.toLowerCase()
    if (!normalized || isAbstractProductBucket(normalized)) return false
    if (/^(general|base|standard|variant\s+\d+|option\s+\d+|related|dimensions?(?:\s*&\s*sizes?)?|finish options?|material(?: specifications?)?)$/i.test(normalized)) {
      return false
    }
    if (/(^| )(finish|oak|ash|walnut|ebony|palisander|upholstery|material|dimensions?|height|width|depth)( |$)/i.test(normalized) && !/(chair|stool|table|bench|sofa|ottoman|lounge|settee|desk|credenza|cabinet)/i.test(normalized)) {
      return false
    }
    const tokenCount = lowered.split(/\s+/).filter(Boolean).length
    return tokenCount >= 2 || /\b(?:[A-Z]{1,4}-\d{1,3}[A-Z0-9-]*|\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*|\d{4,6}[A-Z0-9-]*)\b/.test(normalized)
  }

  function isConcreteProductCandidate(candidate) {
    const label = normalizeText(candidate?.label || "")
    const description = normalizeText(candidate?.description || "")
    const evidence = normalizeText(candidate?.evidence || "")
    const sourceText = [label, description, evidence].filter(Boolean).join(" ")
    const hasModelCode = /\b(?:[A-Z]{1,4}-\d{1,3}[A-Z0-9-]*|\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*|\d{4,6}[A-Z0-9-]*)\b/.test(sourceText)
    if (hasModelCode && label) return true
    return isConcreteProductLabel(label)
  }

  function normalizeConcreteProductCandidates(items) {
    const unique = new Map()
    normalizeDecisionCandidates(items).forEach((candidate) => {
      const mapKey = getConcreteProductCandidateKey(candidate.label || candidate.id)
      if (!mapKey || !isConcreteProductCandidate(candidate)) return
      if (!unique.has(mapKey)) {
        unique.set(mapKey, candidate)
        return
      }

      const existing = unique.get(mapKey)
      unique.set(mapKey, {
        ...existing,
        ...candidate,
        description: existing?.description || candidate.description || "",
        evidence: existing?.evidence || candidate.evidence || "",
        pageNumber: Number.isInteger(Number(existing?.pageNumber)) && Number(existing?.pageNumber) > 0
          ? Number(existing.pageNumber)
          : Number.isInteger(Number(candidate?.pageNumber)) && Number(candidate?.pageNumber) > 0
            ? Number(candidate.pageNumber)
            : null
      })
    })
    return [...unique.values()]
  }

  function getTopRerankedPageNumbers(aiResult) {
    if (!aiResult) return []
    const kept = Array.isArray(aiResult.keptPages) ? aiResult.keptPages : []
    if (kept.length) return kept.slice(0, 3)
    const ordered = Array.isArray(aiResult.orderedPages) ? aiResult.orderedPages.map((item) => item.pageNumber).filter(Number.isFinite) : []
    return ordered.slice(0, 3)
  }

  function getProductCandidatePageNumbers(aiResult) {
    if (!aiResult) return []
    const kept = Array.isArray(aiResult.keptPages) ? aiResult.keptPages : []
    if (kept.length) return kept.slice(0, getAiKeptPageLimit())
    const ordered = Array.isArray(aiResult.orderedPages) ? aiResult.orderedPages.map((item) => item.pageNumber).filter(Number.isFinite) : []
    return ordered.slice(0, getAiKeptPageLimit())
  }

  function getFamilyWideCandidatePageNumbers(aiResult) {
    if (!aiResult) return []
    const ordered = Array.isArray(aiResult.orderedPages) ? aiResult.orderedPages.map((item) => item.pageNumber).filter(Number.isFinite) : []
    const compared = Array.isArray(aiResult.variantComparison) ? aiResult.variantComparison.map((item) => item.pageNumber).filter(Number.isFinite) : []
    const kept = Array.isArray(aiResult.keptPages) ? aiResult.keptPages : []
    return [...new Set([...ordered, ...compared, ...kept])].sort((a, b) => a - b)
  }

  function buildGroundedProductCandidatesFromTopPages(documentRecord, aiResult) {
    if (!documentRecord || !aiResult) return []

    const pageNumbers = getProductCandidatePageNumbers(aiResult)
    if (!pageNumbers.length) return []
    const titles = pageNumbers.map((pageNumber) => getPrimaryHeaderTitle(documentRecord, pageNumber)).filter(Boolean)
    const sharedPrefix = getSharedTitlePrefix(titles)
    const prefixPattern = sharedPrefix
      ? new RegExp(`^${sharedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
      : null

    const candidates = pageNumbers
      .map((pageNumber) => {
        const title = normalizeText(getPrimaryHeaderTitle(documentRecord, pageNumber))
        if (!title) return null
        const stripped = prefixPattern
          ? normalizeText(title.replace(prefixPattern, "")).replace(/^[,:\-–—]\s*/, "")
          : ""
        const label = isConcreteProductLabel(stripped) ? stripped : title
        if (!isConcreteProductLabel(label)) return null
        return {
          id: slugify(label, `product-${pageNumber}`),
          label,
          description: title !== label ? title : "",
          evidence: `Visible top family page title on page ${pageNumber}`
        }
      })
      .filter(Boolean)

    return normalizeConcreteProductCandidates(candidates)
  }

  function buildPageLocalProductCandidatesFromTopPages(documentRecord, aiResult) {
    if (!documentRecord || !aiResult) return []

    return getProductCandidatePageNumbers(aiResult)
      .flatMap((pageNumber) => {
        const page = documentRecord?.pages?.find((item) => item.pageNumber === pageNumber)
        if (!page) return []
        const subtypeHint = getSelectedPageSubtypeHint(documentRecord, page)
        return extractConcreteVariantCandidatesFromPageText(getPageCombinedText(page), subtypeHint)
          .map((candidate) => ({
            ...candidate,
            pageNumber,
            evidence: normalizeText(`${candidate.evidence || ""} Page ${pageNumber}`.trim())
          }))
      })
  }

  function getAggregatedTopFamilyProductCandidates(documentRecord, aiResult) {
    if (aiResult?.choiceMode === "show_model_numbers" && Array.isArray(aiResult?.concreteProductCandidates) && aiResult.concreteProductCandidates.length) {
      return normalizeConcreteProductCandidates(aiResult.concreteProductCandidates)
    }
    if (aiResult?.choiceMode === "narrow_search") {
      return []
    }
    const pageLocalCandidates = buildPageLocalProductCandidatesFromTopPages(documentRecord, aiResult)
    const pageLocalPages = new Set(
      pageLocalCandidates
        .map((candidate) => Number(candidate.pageNumber))
        .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
    )
    const aiCandidates = normalizeConcreteProductCandidates(aiResult?.concreteProductCandidates)
      .filter((candidate) => {
        const referencedPages = extractReferencedPageNumbers(candidate?.evidence || "")
        return !referencedPages.some((pageNumber) => pageLocalPages.has(pageNumber))
      })
    const groundedPageCandidates = buildGroundedProductCandidatesFromTopPages(documentRecord, aiResult)
      .filter((candidate) => {
        const referencedPages = extractReferencedPageNumbers(candidate?.evidence || "")
        return !referencedPages.some((pageNumber) => pageLocalPages.has(pageNumber))
      })
    const combined = [
      ...aiCandidates,
      ...pageLocalCandidates,
      ...groundedPageCandidates
    ]
    return normalizeConcreteProductCandidates(combined)
  }

  function getCandidatePageNumber(candidate, fallbackPageNumber = null, documentRecord = null) {
    if (Number.isInteger(Number(candidate?.pageNumber)) && Number(candidate?.pageNumber) > 0) {
      return Number(candidate.pageNumber)
    }
    const referencedPages = extractReferencedPageNumbers(candidate?.evidence || "")
    if (referencedPages.length) return referencedPages[0]
    if (documentRecord?.pages?.length) {
      const modelCodes = extractModelCodes([candidate?.id, candidate?.label, candidate?.description, candidate?.evidence].filter(Boolean).join(" "))
      const candidateTokens = tokenize([candidate?.label, candidate?.description].filter(Boolean).join(" "))
        .filter((token) => token.length >= 4)
        .filter((token) => !["davis", "ginkgo", "lounge", "chair", "chairs", "base", "series", "model"].includes(token))
      const rankedPageNumbers = getProductCandidatePageNumbers(appState.aiRerankResult)
      const candidatePages = (rankedPageNumbers.length
        ? rankedPageNumbers.map((pageNumber) => documentRecord.pages.find((page) => page.pageNumber === pageNumber))
        : documentRecord.pages.slice(0, 12))
        .filter(Boolean)

      for (const page of candidatePages) {
        const haystack = normalizeText(getPageCombinedText(page)).toLowerCase()
        if (modelCodes.some((code) => haystack.includes(code.toLowerCase()))) {
          return page.pageNumber
        }
      }

      for (const page of candidatePages) {
        const haystack = normalizeText(getPageCombinedText(page)).toLowerCase()
        const tokenMatches = candidateTokens.filter((token) => haystack.includes(token))
        if (tokenMatches.length >= Math.min(2, candidateTokens.length)) {
          return page.pageNumber
        }
      }
    }
    return Number.isFinite(Number(fallbackPageNumber)) ? Number(fallbackPageNumber) : null
  }

  function getAiDebugPayload(documentRecord, structureRouting) {
    if (appState.sourceMode === "website" || (appState.sourceMode === "both" && appState.activeNarrativeSource === "website")) {
      return {
        website_analysis: {
          url: appState.websiteUrl,
          prompt: appState.websiteSummaryPrompt || "",
          source: appState.websiteSummarySource || null,
          raw_response_text: appState.websiteSummaryRawText || "",
          summary: appState.websiteSummary || null
        }
      }
    }

    const candidateFallbackPage = appState.structureRouting?.productFirstPageNumber || appState.aiRerankResult?.bestPage || appState.activePageNumber
    const familyPageSelectionKey = documentRecord ? getFamilyPageSelectionKey(documentRecord, appState.activePageNumber) : ""
    const activePageSelections = familyPageSelectionKey ? (appState.familyPageProductsByKey[familyPageSelectionKey] || []) : []
    const activePageModelBackedSelections = getModelBackedProductCandidates(activePageSelections)
    const retrievalGuidance = getRetrievalGuidance(documentRecord, appState.rankedPages, structureRouting)
    const familyWideCandidates = getFamilyWideProductCandidates(documentRecord, structureRouting)
    const familyWideModelBackedCount = countDistinctProductIdentifiers(familyWideCandidates)
    const familyWideCandidatePages = getFamilyWideCandidatePageNumbers(appState.aiRerankResult)
    const pageVariantCounts = documentRecord
      ? familyWideCandidatePages.map((pageNumber) => ({
          renderKey: getPageRenderKey(documentRecord, pageNumber),
          pageNumber,
          variantCount: getPageVariantCount(documentRecord, pageNumber),
          rangeHeightPercent: getVariantRangeProfile(getPageVariantCount(documentRecord, pageNumber)).heightPercent,
          rangeHeightLabel: getVariantRangeProfile(getPageVariantCount(documentRecord, pageNumber)).rangeLabel,
          rangeHeightPixels: (() => {
            const liveBand = getPageVariantHighlightBand(documentRecord, pageNumber)
            const renderMetrics = appState.pageRenderMetricsByKey[getPageRenderKey(documentRecord, pageNumber)]
            if (liveBand?.heightPercent && renderMetrics?.height) {
              return Math.round((renderMetrics.height * liveBand.heightPercent) / 100)
            }
            const heightPercent = getVariantRangeProfile(getPageVariantCount(documentRecord, pageNumber)).heightPercent
            return renderMetrics?.height ? Math.round((renderMetrics.height * heightPercent) / 100) : null
          })()
        }))
      : []
    const effectiveChoiceMode = getPrimaryUiMode(documentRecord, structureRouting, retrievalGuidance)
    const preAiCandidatePages = documentRecord
      ? rankPages(documentRecord)
          .slice(0, getAiRerankCandidateLimit())
          .map((page) => ({
            pageNumber: page.pageNumber,
            score: Number(page.score) || 0,
            variantCount: getPageVariantCount(documentRecord, page.pageNumber),
            header: normalizeText(getPrimaryHeaderTitle(documentRecord, page.pageNumber)),
            snippet: normalizeText(page.snippet || "")
          }))
      : []
    const preAiVariantBreakdown = documentRecord
      ? buildVariantBreakdownForPages(documentRecord, preAiCandidatePages.map((item) => item.pageNumber))
      : null
    return {
      raw_response_text: appState.aiRerankRawText || appState.aiRerankResult?.rawText || "",
      rerank_result: appState.aiRerankResult || null,
      structure_routing: structureRouting || null,
      pre_ai_candidate_pages: preAiCandidatePages,
      pre_ai_variant_breakdown: preAiVariantBreakdown,
      active_page_number: appState.activePageNumber,
      active_page_product_candidates: activePageSelections,
      active_page_model_backed_count: activePageModelBackedSelections.length,
      family_wide_model_backed_count: familyWideModelBackedCount,
      page_variant_counts: pageVariantCounts,
      effective_choice_mode: effectiveChoiceMode,
      product_set_variant_count: Number.isFinite(Number(appState.aiRerankResult?.variantCount)) ? Number(appState.aiRerankResult.variantCount) : null,
      product_set_query_specificity: normalizeText(appState.aiRerankResult?.querySpecificity || ""),
      product_set_count_reason: normalizeText(appState.aiRerankResult?.countReason || ""),
      product_set_matching_ids: Array.isArray(appState.aiRerankResult?.matchingIds) ? appState.aiRerankResult.matchingIds : [],
      product_set_applied_filters: Array.isArray(appState.aiRerankResult?.appliedFilters) ? appState.aiRerankResult.appliedFilters : [],
      product_set_excluded_filters: Array.isArray(appState.aiRerankResult?.excludedFilters) ? appState.aiRerankResult.excludedFilters : [],
      product_set_excluded_rows: Array.isArray(appState.aiRerankResult?.excludedRows) ? appState.aiRerankResult.excludedRows : [],
      decision_assist_result: appState.decisionAssistResult || null,
      displayable_model_backed_candidates: getDisplayableModelBackedProductCandidates(structureRouting),
      normalized_product_candidates: (structureRouting?.productCandidates || []).map((candidate) => ({
        ...candidate,
        resolvedPageNumber: getCandidatePageNumber(candidate, candidateFallbackPage, documentRecord)
      }))
    }
  }

  function getAiDebugJson(payload) {
    return JSON.stringify(payload, null, 2)
  }

  function buildWebsiteAnalysisPrompt(source) {
    const title = normalizeText(source?.title || "")
    const description = normalizeText(source?.description || "")
    const headings = Array.isArray(source?.headings) ? source.headings.map((item) => normalizeText(item)).filter(Boolean).slice(0, 10) : []
    const bullets = Array.isArray(source?.bullets) ? source.bullets.map((item) => normalizeText(item)).filter(Boolean).slice(0, 12) : []
    const paragraphs = Array.isArray(source?.paragraphs) ? source.paragraphs.map((item) => normalizeText(item)).filter(Boolean).slice(0, 6) : []
    const resources = Array.isArray(source?.resources) ? source.resources.slice(0, 8) : []
    const cleanedText = normalizeText(source?.cleanedText || "")

    return [
      "You are summarizing a furniture or product website page for a specification workflow.",
      "Focus on concrete product information that would help someone fill in a spec sheet.",
      "Summarize only what is supported by the provided website content.",
      "If something is not clearly stated, say that it is not clear rather than guessing.",
      "Return JSON only. No markdown fences.",
      "",
      "Required JSON shape:",
      "{",
      '  "page_type": "product_page | collection_page | article | unclear",',
      '  "product_name": "string",',
      '  "brand": "string",',
      '  "dimensions_summary": "1-2 sentences about dimensions or sizing cues, or say not clearly listed",',
      '  "finishes_summary": "1-2 sentences about finishes/materials/colors, or say not clearly listed",',
      '  "options_summary": "1-2 sentences about options/configurations/variants, or say not clearly listed",',
      '  "resources_summary": "1-2 sentences about linked PDFs/downloads/resources, or say not clearly listed",',
      '  "full_summary": "3-6 sentences summarizing the page for a spec editor",',
      '  "dimensions_mentioned": ["..."],',
      '  "finishes_mentioned": ["..."],',
      '  "options_mentioned": ["..."],',
      '  "resources_mentioned": ["..."],',
      '  "key_details": ["..."],',
      '  "uncertainties": ["..."]',
      "}",
      "",
      `URL: ${appState.websiteUrl || "Unknown"}`,
      title ? `Title: ${title}` : "Title: Unknown",
      description ? `Description: ${description}` : "Description: Not provided",
      headings.length ? `Headings:\n- ${headings.join("\n- ")}` : "Headings: None extracted",
      bullets.length ? `Bullets / list items:\n- ${bullets.join("\n- ")}` : "Bullets / list items: None extracted",
      paragraphs.length ? `Paragraph excerpts:\n- ${paragraphs.join("\n- ")}` : "Paragraph excerpts: None extracted",
      resources.length ? `Resource links:\n- ${resources.map((item) => `${item.label || "Untitled"} -> ${item.href}`).join("\n- ")}` : "Resource links: None extracted",
      cleanedText ? `Cleaned page text:\n${cleanedText}` : "Cleaned page text: None extracted"
    ].join("\n")
  }

  function buildPdfRoutingSummaryPrompt(documentRecord, pageSummaries) {
    const title = normalizeText(documentRecord?.title || "")
    const rerankSummary = normalizeText(appState.aiRerankResult?.summary || "")
    const decisionSummary = normalizeText(appState.decisionAssistResult?.summary || "")
    const pageLines = (pageSummaries || [])
      .map((page) => {
        const text = normalizeText(page.text || "")
        return text ? `Page ${page.pageNumber}:\n${text}` : ""
      })
      .filter(Boolean)
      .join("\n\n")

    return [
      "You are summarizing the most useful PDF evidence for a furniture/product specification workflow.",
      "Focus on concrete details that would help a spec writer fill product attributes.",
      "Weight dimensions, finishes, options/configurations, models, and linked/resource cues more heavily than marketing language.",
      "Do not guess. If information is weak or not clearly present, say so.",
      "Return JSON only. No markdown fences.",
      "",
      "Required JSON shape:",
      "{",
      '  "page_type": "price_book | spec_guide | cutsheet | brochure | mixed | unclear",',
      '  "product_name": "string",',
      '  "brand": "string",',
      '  "dimensions_summary": "1-2 sentences about dimensions or sizing cues, or say not clearly listed",',
      '  "finishes_summary": "1-2 sentences about finishes/materials/colors, or say not clearly listed",',
      '  "options_summary": "1-2 sentences about options/configurations/variants, or say not clearly listed",',
      '  "resources_summary": "1-2 sentences about price/spec/resource usefulness, or say not clearly listed",',
      '  "full_summary": "3-6 sentences summarizing the PDF evidence for a spec editor",',
      '  "dimensions_mentioned": ["..."],',
      '  "finishes_mentioned": ["..."],',
      '  "options_mentioned": ["..."],',
      '  "resources_mentioned": ["..."],',
      '  "key_details": ["..."],',
      '  "uncertainties": ["..."]',
      "}",
      "",
      title ? `PDF title: ${title}` : "PDF title: Unknown",
      rerankSummary ? `AI page routing summary: ${rerankSummary}` : "AI page routing summary: None",
      decisionSummary ? `Decision summary: ${decisionSummary}` : "Decision summary: None",
      pageLines ? `Top ranked page evidence:\n${pageLines}` : "Top ranked page evidence: None"
    ].join("\n")
  }

  async function summarizePdfForRouting() {
    const documentRecord = appState.documents.find((document) => document.id === appState.activeDocumentId) || appState.documents[0] || null
    if (!documentRecord) return null

    const candidatePages = getAiOrderedPages(
      appState.rankedPages.slice(0, 3).map((page) => ({
        ...page,
        metrics: getPageTextMetrics(documentRecord, page.pageNumber)
      }))
    )
      .slice(0, 3)
      .map((page) => {
        const matchedPage = documentRecord.pages.find((item) => item.pageNumber === page.pageNumber)
        return {
          pageNumber: page.pageNumber,
          text: normalizeText(getPageCombinedText(matchedPage)).slice(0, 2600)
        }
      })
      .filter((page) => page.text)

    if (!candidatePages.length) return null

    const prompt = buildPdfRoutingSummaryPrompt(documentRecord, candidatePages)
    const { parsed, rawText } = await callOpenAiJsonPrompt([{ type: "input_text", text: prompt }], "PDF routing summary failed")
    return {
      summary: parsed,
      prompt,
      rawText
    }
  }

  function buildSourceComparisonPrompt(pdfSummary, websiteSummary) {
    return [
      "You are deciding which source should be loaded first for a furniture/product specification workflow.",
      "Compare a PDF summary against a webpage summary.",
      "Your main job is to decide which source better helps a spec writer fill in dimensions, applicable finishes, and options/configurations.",
      "Heavily prefer the source with clearer, more concrete dimension data, applicable finish information, and option/configuration detail.",
      "Do not reward a source just because it is well-written, better structured, or more marketing-oriented if it lacks those concrete details.",
      "If the webpage is thin on dimensions, finishes, or options and the PDF contains them, the PDF should win.",
      "If the PDF is sparse or brochure-like and the webpage has materially better dimensions, finishes, or options detail, the webpage should win.",
      "Return JSON only. No markdown fences.",
      "",
      "Required JSON shape:",
      "{",
      '  "preferred_source": "pdf | website",',
      '  "alternate_source": "pdf | website | none",',
      '  "reason": "1-2 sentence explanation of the decision",',
      '  "pdf_score": 0,',
      '  "website_score": 0,',
      '  "pdf_reasons": ["..."],',
      '  "website_reasons": ["..."]',
      "}",
      "The higher score must belong to the preferred_source.",
      "",
      `PDF summary:\n${JSON.stringify(pdfSummary, null, 2)}`,
      "",
      `Website summary:\n${JSON.stringify(websiteSummary, null, 2)}`
    ].join("\n")
  }

  async function choosePreferredNarrativeSourceWithAi() {
    if (!hasVisionAccess() || !appState.websiteSummary) {
      return choosePreferredNarrativeSourceHeuristic()
    }

    const pdfRouting = await summarizePdfForRouting()
    if (!pdfRouting?.summary) {
      return choosePreferredNarrativeSourceHeuristic()
    }

    const comparisonPrompt = buildSourceComparisonPrompt(pdfRouting.summary, appState.websiteSummary)
    const { parsed, rawText } = await callOpenAiJsonPrompt([{ type: "input_text", text: comparisonPrompt }], "Source comparison failed")
    const preferred = normalizeText(parsed?.preferred_source || "").toLowerCase() === "website" ? "website" : "pdf"
    const alternateRaw = normalizeText(parsed?.alternate_source || "").toLowerCase()
    const alternate = alternateRaw === "website" ? "website" : alternateRaw === "pdf" ? "pdf" : preferred === "website" ? "pdf" : "website"
    let pdfScore = Number(parsed?.pdf_score) || 0
    let websiteScore = Number(parsed?.website_score) || 0
    if (preferred === "pdf" && pdfScore <= websiteScore) {
      pdfScore = Math.min(100, websiteScore + 1)
    } else if (preferred === "website" && websiteScore <= pdfScore) {
      websiteScore = Math.min(100, pdfScore + 1)
    }

    return {
      preferred,
      alternate,
      reason: normalizeText(parsed?.reason || "") || `Loaded ${preferred === "website" ? "Website" : "PDF"} based on the AI comparison of both source summaries.`,
      details: {
        pdf: {
          score: pdfScore,
          reasons: Array.isArray(parsed?.pdf_reasons) ? parsed.pdf_reasons.map((item) => normalizeText(item)).filter(Boolean) : [],
          summary: pdfRouting.summary
        },
        website: {
          score: websiteScore,
          reasons: Array.isArray(parsed?.website_reasons) ? parsed.website_reasons.map((item) => normalizeText(item)).filter(Boolean) : [],
          summary: appState.websiteSummary
        },
        comparator: {
          prompt: comparisonPrompt,
          rawText,
          pdfPrompt: pdfRouting.prompt,
          pdfRawText: pdfRouting.rawText
        }
      }
    }
  }

  function getFamilyWideProductCandidates(documentRecord, structureRouting = null) {
    if (!documentRecord || appState.aiRerankDocumentId !== documentRecord.id || !appState.aiRerankResult) {
      return getModelBackedProductCandidates(structureRouting?.productCandidates)
    }
    const pageLocalCandidates = getFamilyWideCandidatePageNumbers(appState.aiRerankResult)
      .flatMap((pageNumber) => {
        const page = documentRecord?.pages?.find((item) => item.pageNumber === pageNumber)
        if (!page) return []
        return extractConcreteVariantCandidatesFromPageText(getPageCombinedText(page))
          .map((candidate) => ({
            ...candidate,
            pageNumber,
            evidence: normalizeText(`${candidate.evidence || ""} Page ${pageNumber}`.trim())
          }))
      })
    return pageLocalCandidates.length ? pageLocalCandidates : getModelBackedProductCandidates(structureRouting?.productCandidates)
  }

  function estimateVariantRowsFromPageText(pageText) {
    return extractLikelyVariantRowsFromPageText(pageText).length
  }

  function looksLikeNonProductLegend(value) {
    const lower = normalizeText(value).toLowerCase()
    if (!lower) return false

    if (
      /\b(shell finish|frame finish|wood veneer|powder coat|com\/col|com col|customer's own material|customer's own leather)\b/.test(lower)
      || /\b(required to specify|to order specify|finish options|finish legend|pricing legend|specify finish)\b/.test(lower)
      || /\b(priced graded-in|yardage|square feet|shipping weight|list price|upcharge)\b/.test(lower)
      || /\bgrade\s+[a-z]\b|\bgr\s*[a-z]\b/.test(lower)
      || /\b[a-l](?:\s+[a-l]){4,}\b/.test(lower)
    ) {
      return true
    }

    const finishOnlySignals = /\b(finish|veneer|laminate|powder|coat|grade|fabric|leather|textile)\b/.test(lower)
    const lacksConcreteProductSignals = !/\b(chair|stool|ottoman|seat|back|base|arm|armless|swivel|fixed|pedestal|mesh|upholstered|veneer shell)\b/.test(lower)
    return finishOnlySignals && lacksConcreteProductSignals
  }

  function extractLikelyVariantRowsFromPageText(pageText) {
    const lines = String(pageText || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .filter((line) => line.length >= 6 && line.length <= 140)

    if (!lines.length) return []

    const likelyVariantLines = lines.filter((line) => {
      const lower = line.toLowerCase()
      const hasProductSignal = /\b(chair|stool|ottoman|base|back|arm|armless|upholstery|frame|glide|caster|pedestal|veneer shell|mesh)\b/.test(lower)
      const hasCommercialSignal = /\$\s*\d|\bcom\b|\bcol\b|\blist price\b|\bgrade\b|\bupcharge\b/.test(lower)
      const looksLikeHeaderOrNoise = /^(price|code|finish|model|description|application|options?|features?)\b/i.test(line)
      return hasProductSignal && hasCommercialSignal && !looksLikeHeaderOrNoise && !looksLikeNonProductLegend(line)
    })

    const seen = new Set()
    const rows = []
    likelyVariantLines.forEach((line) => {
      const key = line.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      rows.push({
        text: line,
        key
      })
    })
    return rows
  }

  function buildVariantBreakdownForPages(documentRecord, pageNumbers = []) {
    if (!documentRecord || !Array.isArray(pageNumbers) || !pageNumbers.length) return null

    const pageSet = [...new Set(pageNumbers.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))]
    if (!pageSet.length) return null

    const variants = []
    pageSet.forEach((pageNumber) => {
      const page = documentRecord.pages.find((item) => item.pageNumber === pageNumber)
      if (!page) return
      const pageText = getPageCombinedText(page)
      const concreteCandidates = extractConcreteVariantCandidatesFromPageText(pageText)
      if (concreteCandidates.length) {
        concreteCandidates.forEach((candidate, index) => {
          const modelCode = getProductCardModelCode(candidate)
          variants.push({
            id: `${pageNumber}:${index + 1}:${slugify(modelCode || candidate.label || candidate.id, `variant-${index + 1}`)}`,
            pageNumber,
            label: modelCode || normalizeText(candidate.label || candidate.id || `Variant ${index + 1}`),
            sourceText: normalizeText([candidate.description, candidate.evidence, candidate.label].filter(Boolean).join(" | "))
          })
        })
        return
      }
      const rows = extractLikelyVariantRowsFromPageText(pageText)
      rows.forEach((row, index) => {
        const modelCode = extractModelCodes(row.text)[0] || ""
        variants.push({
          id: `${pageNumber}:${index + 1}:${slugify(modelCode || row.text.slice(0, 40), `row-${index + 1}`)}`,
          pageNumber,
          label: modelCode || titleCaseWords(row.text.slice(0, 54)),
          sourceText: row.text
        })
      })
    })

    if (!variants.length) return null

    const enriched = variants.map((variant) => {
      const segments = normalizeText(variant.sourceText)
        .split("|")
        .map((item) => normalizeText(item))
        .filter(Boolean)
      const primarySegment = segments.find((segment) => {
        const lower = segment.toLowerCase()
        if (!lower || lower === normalizeText(variant.label).toLowerCase()) return false
        if (/^page-local model\s+/i.test(segment)) return false
        if (/^variant\s+\d+$/i.test(segment)) return false
        return true
      }) || segments[0] || ""
      const meaningfulDescription = primarySegment
        ? primarySegment.slice(0, 180)
        : "Variant description not captured yet."
      return {
        id: variant.id,
        pageNumber: variant.pageNumber,
        label: variant.label,
        meaningfulDescription
      }
    })

    const perPage = pageSet
      .map((pageNumber) => ({
        pageNumber,
        count: enriched.filter((item) => item.pageNumber === pageNumber).length
      }))
      .sort((a, b) => a.pageNumber - b.pageNumber)

    return {
      totalVariants: enriched.length,
      perPage,
      variants: enriched.sort((a, b) => a.pageNumber - b.pageNumber || a.label.localeCompare(b.label))
    }
  }

  function buildKeywordStatsFromVariantBreakdown(variantBreakdown) {
    const variants = Array.isArray(variantBreakdown?.variants) ? variantBreakdown.variants : []
    if (!variants.length) return []
    const stopwords = new Set([
      "and", "the", "for", "with", "without", "from", "into", "that", "this", "your", "their",
      "model", "models", "price", "list", "book", "page", "variant", "variants", "product", "products",
      "chair", "chairs", "stool", "ottoman", "base", "back", "arms", "arm", "frame"
    ])
    const counts = new Map()
    variants.forEach((variant) => {
      const text = normalizeText([variant.label, variant.meaningfulDescription].filter(Boolean).join(" ")).toLowerCase()
      const tokens = [...new Set(
        text
          .split(/[^a-z0-9]+/)
          .map((item) => item.trim())
          .filter((item) => item.length >= 3)
          .filter((item) => !/^\d+$/.test(item))
          .filter((item) => !/^[a-z]{0,3}\d{2,}$/.test(item))
          .filter((item) => !stopwords.has(item))
      )]
      tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1))
    })
    return [...counts.entries()]
      .map(([term, count]) => ({ term, count }))
      .filter((item) => item.count >= 2)
      .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
      .slice(0, 40)
  }

  function buildKeywordBucketingPrompt(productName, variantBreakdown, keywordStats) {
    const variants = Array.isArray(variantBreakdown?.variants) ? variantBreakdown.variants : []
    const variantLines = variants
      .slice(0, 40)
      .map((item) => `p.${item.pageNumber}: ${normalizeText(item.label)} | ${normalizeText(item.meaningfulDescription)}`)
      .join("\n")
    const keywordLines = (keywordStats || [])
      .slice(0, 40)
      .map((item) => `${item.term} (${item.count})`)
      .join(", ")
    return [
      "You are organizing recurring product-description keywords into user-friendly narrowing buckets.",
      `Query: ${normalizeText(productName || "Unknown")}`,
      "Use only the provided keyword frequencies and variant lines as evidence.",
      "Do not invent options not present in the evidence.",
      "Create practical filter buckets with short labels and short option names.",
      "Examples of bucket labels if supported by evidence: Type, Base, Back, Arms, Material, Detail.",
      "Only include buckets with at least 2 options.",
      "Only include options that are meaningfully distinct.",
      "Prefer clear pairs such as mesh vs upholstered, with arms vs without arms, fixed vs swivel.",
      "Return JSON only. No markdown fences.",
      "",
      "Required JSON shape:",
      "{",
      '  "keyword_buckets": [',
      '    {"id": "back", "label": "Back", "reason": "Short reason", "options": ["Mesh", "Upholstered"]}',
      "  ]",
      "}",
      "",
      `Keyword frequencies: ${keywordLines}`,
      `Variant lines:\n${variantLines}`
    ].join("\n")
  }

  function normalizeKeywordBuckets(rawBuckets) {
    return (Array.isArray(rawBuckets) ? rawBuckets : [])
      .map((bucket) => ({
        id: normalizeText(bucket?.id || slugify(bucket?.label || "", "bucket")),
        label: normalizeText(bucket?.label || ""),
        reason: normalizeText(bucket?.reason || ""),
        options: [...new Set((Array.isArray(bucket?.options) ? bucket.options : [])
          .map((item) => normalizeText(item))
          .filter(Boolean))]
      }))
      .filter((bucket) => bucket.id && bucket.label && bucket.options.length >= 2)
  }

  function buildProposedNarrowingTermsFromVariantBreakdown(variantBreakdown) {
    const keywordStats = buildKeywordStatsFromVariantBreakdown(variantBreakdown)
    const options = keywordStats.slice(0, 12).map((item) => titleCaseWords(item.term))
    if (options.length < 2) return []
    return [{
      id: "keyword_signals",
      label: "Keyword Signals",
      reason: "Recurring terms across the detected variant descriptions.",
      options
    }]
  }

  function mergeNarrowingBuckets(primaryBuckets = [], fallbackGroups = []) {
    const merged = []
    const byKey = new Map()
    const toKey = (item) => normalizeText(item?.id || item?.label || "").toLowerCase()

    const pushOrMerge = (item, isPrimary = false) => {
      const key = toKey(item)
      if (!key) return
      const label = normalizeText(item?.label || "")
      const options = [...new Set((Array.isArray(item?.options) ? item.options : []).map((option) => normalizeText(option)).filter(Boolean))]
      if (options.length < 2) return
      if (!byKey.has(key)) {
        const next = {
          id: normalizeText(item?.id || key),
          label: label || titleCaseWords(key),
          reason: normalizeText(item?.reason || ""),
          options
        }
        byKey.set(key, next)
        merged.push(next)
        return
      }
      const current = byKey.get(key)
      current.options = [...new Set([...current.options, ...options])]
      if (!current.reason && isPrimary) {
        current.reason = normalizeText(item?.reason || "")
      }
    }

    ;(Array.isArray(primaryBuckets) ? primaryBuckets : []).forEach((bucket) => pushOrMerge(bucket, true))
    ;(Array.isArray(fallbackGroups) ? fallbackGroups : []).forEach((group) => pushOrMerge({
      id: normalizeText(group?.id || ""),
      label: normalizeText(group?.label || ""),
      reason: "Derived from detected variant descriptions across submitted pages.",
      options: Array.isArray(group?.options) ? group.options : []
    }))

    return merged.filter((bucket) => bucket.options.length >= 2)
  }

  function countDistinctProductIdentifiers(candidates) {
    const identifierSet = new Set()
    ;(Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
      const primaryCode = getProductCardModelCode(candidate)
      if (primaryCode) {
        identifierSet.add(primaryCode)
      }
    })
    return identifierSet.size || (Array.isArray(candidates) ? candidates.length : 0)
  }

  function getPageVariantCount(documentRecord, pageNumber) {
    const page = documentRecord?.pages?.find((item) => item.pageNumber === pageNumber)
    if (!page) return 0

    const pageText = getPageCombinedText(page)
    const pageCandidates = extractConcreteVariantCandidatesFromPageText(pageText)
    const modelBackedCount = countDistinctProductIdentifiers(getModelBackedProductCandidates(pageCandidates))
    if (modelBackedCount > 0) return modelBackedCount

    return estimateVariantRowsFromPageText(pageText)
  }

  function getVariantRangeProfile(variantCount) {
    const count = Number(variantCount) || 0
    if (count <= 2) {
      return {
        heightPercent: 50,
        rangeLabel: "half-page range"
      }
    }
    if (count <= 4) {
      return {
        heightPercent: 34,
        rangeLabel: "third-page range"
      }
    }
    if (count <= 6) {
      return {
        heightPercent: 26,
        rangeLabel: "quarter-page range"
      }
    }
    if (count <= 8) {
      return {
        heightPercent: 18,
        rangeLabel: "short range"
      }
    }
    return {
      heightPercent: 14,
      rangeLabel: "tight range"
    }
  }

  function getPageRangeOffset(renderKey) {
    return Number(appState.pageRangeOffsetByKey[renderKey]) || 0
  }

  function setPageRangeOffset(renderKey, nextOffset) {
    appState.pageRangeOffsetByKey[renderKey] = Math.max(-30, Math.min(30, Number(nextOffset) || 0))
  }

  function getPageRangeTop(renderKey) {
    const value = Number(appState.pageRangeTopByKey[renderKey])
    return Number.isFinite(value) ? value : null
  }

  function setPageRangeTop(renderKey, nextTop) {
    appState.pageRangeTopByKey[renderKey] = Math.max(0, Math.min(92, Number(nextTop) || 0))
  }

  function getPageRangeHeight(renderKey) {
    const value = Number(appState.pageRangeHeightByKey[renderKey])
    return Number.isFinite(value) ? value : null
  }

  function setPageRangeHeight(renderKey, nextHeight) {
    appState.pageRangeHeightByKey[renderKey] = Math.max(8, Math.min(60, Number(nextHeight) || 0))
  }

  function isPageCropViewActive(renderKey) {
    return appState.pageCropViewByKey[renderKey] === true
  }

  function setPageCropView(renderKey, nextValue) {
    if (nextValue) {
      appState.pageCropViewByKey[renderKey] = true
      return
    }
    delete appState.pageCropViewByKey[renderKey]
  }

  function resolveMatchingIdsFromProductSet(parsed) {
    const explicitIds = Array.isArray(parsed?.matching_ids) ? parsed.matching_ids.map((item) => normalizeText(item)).filter(Boolean) : []
    if (explicitIds.length) return [...new Set(explicitIds)]
    const countReason = normalizeText(parsed?.count_reason || "")
    return [...new Set(extractModelCodes(countReason))]
  }

  function getCandidateMatchingKeys(candidate) {
    const keys = new Set()
    const pushValue = (value) => {
      const normalized = normalizeText(value)
      if (!normalized) return
      keys.add(normalized.toLowerCase())
      extractModelCodes(normalized).forEach((code) => keys.add(code.toLowerCase()))
    }
    pushValue(candidate?.id)
    pushValue(candidate?.label)
    pushValue(candidate?.description)
    pushValue(candidate?.evidence)
    const primaryCode = getProductCardModelCode(candidate)
    if (primaryCode) keys.add(primaryCode.toLowerCase())
    return [...keys]
  }

  function filterCandidatesByMatchingIds(candidates, matchingIds) {
    const normalizedMatchingIds = [...new Set((Array.isArray(matchingIds) ? matchingIds : [])
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean))]
    if (!normalizedMatchingIds.length) return Array.isArray(candidates) ? candidates : []
    return (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
      const candidateKeys = getCandidateMatchingKeys(candidate)
      return normalizedMatchingIds.some((matchingId) => candidateKeys.includes(matchingId))
    })
  }

  function getModelBackedProductCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : []).filter((candidate) => Boolean(getProductCardModelCode(candidate)))
  }

  function getDisplayableModelBackedProductCandidates(structureRouting = null) {
    const promptCandidates = getModelBackedProductCandidates(appState.aiRerankResult?.concreteProductCandidates)
    const baseCandidates = getModelBackedProductCandidates(structureRouting?.productCandidates)
    const resilientPromptCandidates = normalizeConcreteProductCandidates(appState.aiRerankResult?.concreteProductCandidates)
      .filter((candidate) => Boolean(getProductCardModelCode(candidate) || normalizeText(candidate?.label || candidate?.id || "")))
    const resilientBaseCandidates = normalizeConcreteProductCandidates(structureRouting?.productCandidates)
      .filter((candidate) => Boolean(getProductCardModelCode(candidate) || normalizeText(candidate?.label || candidate?.id || "")))
    const matchingIds = Array.isArray(appState.aiRerankResult?.matchingIds) ? appState.aiRerankResult.matchingIds : []
    if (normalizeText(appState.aiRerankResult?.choiceMode || "") === "show_model_numbers") {
      if (promptCandidates.length) {
        const filteredPromptCandidates = matchingIds.length ? filterCandidatesByMatchingIds(promptCandidates, matchingIds) : promptCandidates
        if (filteredPromptCandidates.length) return filteredPromptCandidates
        return promptCandidates
      }
      if (resilientPromptCandidates.length) {
        const filteredPromptCandidates = matchingIds.length ? filterCandidatesByMatchingIds(resilientPromptCandidates, matchingIds) : resilientPromptCandidates
        if (filteredPromptCandidates.length) return filteredPromptCandidates
        return resilientPromptCandidates
      }
      if (matchingIds.length) {
        const filteredCandidates = filterCandidatesByMatchingIds(baseCandidates, matchingIds)
        if (filteredCandidates.length) return filteredCandidates
        const resilientFilteredCandidates = filterCandidatesByMatchingIds(resilientBaseCandidates, matchingIds)
        if (resilientFilteredCandidates.length) return resilientFilteredCandidates
      }
    }
    return baseCandidates.length ? baseCandidates : resilientBaseCandidates
  }

  function shouldBlockProductChoicesForBroadSearch(documentRecord, guidance, structureRouting = null) {
    if (appState.aiRerankResult?.choiceMode === "narrow_search") return true
    if (appState.aiRerankResult?.choiceMode === "show_model_numbers") return false
    const isBroadQuery = normalizeText(appState.aiRerankResult?.querySpecificity || "") !== "refined"
    return Boolean(
      isBroadQuery
      && guidance?.groups?.length
      && countDistinctProductIdentifiers(getFamilyWideProductCandidates(documentRecord, structureRouting)) > getShowModelNumbersThreshold("broad")
    )
  }

  function getPrimaryUiMode(documentRecord, structureRouting = null, guidance = null) {
    if (isStructureRoutingUncertain()) {
      return "uncertain_structure"
    }
    const structureType = normalizeStructureType(structureRouting?.structureType || appState.aiRerankResult?.structureType || "")
    if (structureType !== "product_family") {
      return "show_pages"
    }

    const promptChoiceMode = normalizeText(appState.aiRerankResult?.choiceMode || "")
    if (promptChoiceMode === "show_model_numbers") return "show_model_numbers"
    if (promptChoiceMode === "narrow_search") return "narrow_search"

    if (shouldBlockProductChoicesForBroadSearch(documentRecord, guidance, structureRouting)) {
      return "narrow_search"
    }

    if (getDisplayableModelBackedProductCandidates(structureRouting).length > 0) {
      return "show_model_numbers"
    }

    return "show_pages"
  }

  function getRefinementReasonForGroup(groupId) {
    if (groupId === "base") return "base type is one of the biggest visible differences across the matching pages"
    if (groupId === "back") return "back style/back construction separates several of the matching rows or pages"
    if (groupId === "type") return "product subtype is broad enough that narrowing by chair/stool/etc. removes large branches of results"
    if (groupId === "detail") return "arm/upholstery/detail cues help reduce the remaining variants once the big structural differences are chosen"
    return "this term helps split the matching result set into more specific groups"
  }

  function getReadableStructureConfidenceLabel(result = null) {
    const aiResult = result || appState.aiRerankResult
    const confidenceLabel = normalizeStructureConfidenceLabel(aiResult?.structureConfidenceLabel || "")
    const singleLikelihood = Number(aiResult?.singleScopeLikelihood)
    const multiLikelihood = Number(aiResult?.multiScopeLikelihood)
    const margin = Number.isFinite(singleLikelihood) && Number.isFinite(multiLikelihood)
      ? Math.abs(singleLikelihood - multiLikelihood)
      : null

    if (confidenceLabel === "high" || (margin !== null && margin >= 45)) return "Very confident"
    if (confidenceLabel === "medium" || (margin !== null && margin >= 28)) return "Confident"
    if (margin !== null && margin >= 18) return "Somewhat confident"
    if (confidenceLabel === "low" || (margin !== null && margin >= 10)) return "Not very confident"
    return "Not confident at all"
  }

  function getRecommendedNextStepLabel(result = null) {
    return isStructureRoutingUncertain(result) ? "Plain View" : "AI Assisted View"
  }

  function getDocumentDateCallout(result = null) {
    const aiResult = result || appState.aiRerankResult
    const detectedDate = normalizeText(aiResult?.documentDate || "")
    if (!detectedDate) return ""
    return detectedDate
  }

  function cropCanvasToVerticalRange(canvas, topPercent, heightPercent) {
    const safeTopPercent = Math.max(0, Math.min(100, Number(topPercent) || 0))
    const safeHeightPercent = Math.max(1, Math.min(100, Number(heightPercent) || 100))
    const sourceY = Math.round((safeTopPercent / 100) * canvas.height)
    const sourceHeight = Math.max(24, Math.round((safeHeightPercent / 100) * canvas.height))
    const boundedHeight = Math.min(sourceHeight, canvas.height - sourceY)
    const croppedCanvas = document.createElement("canvas")
    const context = croppedCanvas.getContext("2d")
    croppedCanvas.width = canvas.width
    croppedCanvas.height = boundedHeight
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      boundedHeight,
      0,
      0,
      canvas.width,
      boundedHeight
    )
    return croppedCanvas
  }

  function buildAiSourceSummaryHtml(payload) {
    if (payload?.website_analysis) {
      const website = payload.website_analysis
      const source = website.source || {}
      const summary = website.summary || {}
      return `
        <div class="ai-source-summary">
          <section class="ai-source-section">
            <h4>Website Prompt</h4>
            <p class="ai-source-copy">${escapeHtml(normalizeText(website.prompt || "") || "No website prompt captured.")}</p>
          </section>
          <section class="ai-source-section">
            <h4>Website Input</h4>
            <div class="ai-source-grid">
              <div><span>URL</span><strong>${escapeHtml(website.url || "Unknown")}</strong></div>
              <div><span>Title</span><strong>${escapeHtml(source.title || "Unknown")}</strong></div>
            </div>
            ${source.description ? `<p class="ai-source-copy">${escapeHtml(source.description)}</p>` : ""}
            ${source.headings?.length ? `<p class="ai-source-copy"><strong>Headings:</strong> ${escapeHtml(source.headings.join(" | "))}</p>` : ""}
            ${source.cleanedText ? `<p class="ai-source-copy">${escapeHtml(source.cleanedText.slice(0, 1200))}${source.cleanedText.length > 1200 ? "..." : ""}</p>` : ""}
          </section>
          <section class="ai-source-section">
            <h4>Structured Summary</h4>
            <div class="ai-source-grid">
              <div><span>Product Name</span><strong>${escapeHtml(summary.product_name || source.title || "Unknown")}</strong></div>
              <div><span>Brand</span><strong>${escapeHtml(summary.brand || "Unknown")}</strong></div>
            </div>
            ${summary.dimensions_summary ? `<p class="ai-source-copy"><strong>Dimensions:</strong> ${escapeHtml(summary.dimensions_summary)}</p>` : ""}
            ${summary.finishes_summary ? `<p class="ai-source-copy"><strong>Finishes:</strong> ${escapeHtml(summary.finishes_summary)}</p>` : ""}
            ${summary.options_summary ? `<p class="ai-source-copy"><strong>Options:</strong> ${escapeHtml(summary.options_summary)}</p>` : ""}
            ${summary.resources_summary ? `<p class="ai-source-copy"><strong>Resources:</strong> ${escapeHtml(summary.resources_summary)}</p>` : ""}
            ${summary.full_summary ? `<p class="ai-source-copy"><strong>Full summary:</strong> ${escapeHtml(summary.full_summary)}</p>` : ""}
          </section>
        </div>
      `
    }

    const rerank = payload?.rerank_result || {}
    const routing = payload?.structure_routing || {}
    const preAiCandidatePages = Array.isArray(payload?.pre_ai_candidate_pages) ? payload.pre_ai_candidate_pages : []
    const preAiVariantBreakdown = payload?.pre_ai_variant_breakdown || null
    const candidates = Array.isArray(payload?.normalized_product_candidates) ? payload.normalized_product_candidates : []
    const displayableCandidates = Array.isArray(payload?.displayable_model_backed_candidates) ? payload.displayable_model_backed_candidates : []
    const orderedPages = Array.isArray(rerank?.orderedPages) ? rerank.orderedPages : []
    const pageComparisons = Array.isArray(rerank?.variantComparison) ? rerank.variantComparison : []
    const keptPages = Array.isArray(rerank?.keptPages) ? rerank.keptPages : []
    const interactionModel = routing.interactionModel || rerank.interactionModel || "Unknown"
    const structureType = routing.structureType || rerank.structureType || "Unknown"
    const modelBackedCandidates = getModelBackedProductCandidates(displayableCandidates.length ? displayableCandidates : candidates)
    const activePageCandidates = Array.isArray(payload?.active_page_product_candidates) ? payload.active_page_product_candidates : []
    const activePageModelBackedCount = Number.isFinite(Number(payload?.active_page_model_backed_count)) ? Number(payload.active_page_model_backed_count) : 0
    const familyWideModelBackedCount = Number.isFinite(Number(payload?.family_wide_model_backed_count)) ? Number(payload.family_wide_model_backed_count) : 0
    const promptVariantCount = Number.isFinite(Number(payload?.product_set_variant_count)) ? Number(payload.product_set_variant_count) : null
    const productSetQuerySpecificity = normalizeText(payload?.product_set_query_specificity || "")
    const matchingIds = Array.isArray(payload?.product_set_matching_ids) ? payload.product_set_matching_ids : []
    const appliedFilters = Array.isArray(payload?.product_set_applied_filters) ? payload.product_set_applied_filters : []
    const excludedFilters = Array.isArray(payload?.product_set_excluded_filters) ? payload.product_set_excluded_filters : []
    const excludedRows = Array.isArray(payload?.product_set_excluded_rows) ? payload.product_set_excluded_rows : []
    const pageVariantCounts = Array.isArray(payload?.page_variant_counts) ? payload.page_variant_counts : []
    const productSetCountReason = normalizeText(payload?.product_set_count_reason || "")
    const decisionAssistResult = payload?.decision_assist_result || null
    const retrievalGuidance = getRetrievalGuidance(getActiveDocument(), appState.rankedPages, routing)
    const scopeType = structureType === "product_family" ? "multi_product_scope" : "single_product_scope"
    const singleScopeLikelihood = Number.isFinite(Number(rerank?.singleScopeLikelihood)) ? Number(rerank.singleScopeLikelihood) : null
    const multiScopeLikelihood = Number.isFinite(Number(rerank?.multiScopeLikelihood)) ? Number(rerank.multiScopeLikelihood) : null
    const readableConfidence = getReadableStructureConfidenceLabel(rerank)
    const recommendedNextStep = getRecommendedNextStepLabel(rerank)
    const choiceMode = scopeType === "single_product_scope"
      ? "show_pages"
      : payload?.effective_choice_mode || (modelBackedCandidates.length >= 9
        ? "narrow_search"
        : "show_model_numbers"
      )
    const fallbackModelBackedCount = familyWideModelBackedCount || (activePageCandidates.length ? activePageModelBackedCount : modelBackedCandidates.length)
    const effectiveModelBackedCount = scopeType === "multi_product_scope"
      ? (promptVariantCount ?? fallbackModelBackedCount)
      : modelBackedCandidates.length
    const showModelNumbersThreshold = getShowModelNumbersThreshold(productSetQuerySpecificity)
    const multiProductNextUi = effectiveModelBackedCount <= showModelNumbersThreshold ? "Variant cards" : "Suggest narrowing the query"
    const activePageNumber = Number(payload?.active_page_number) || Number(appState.activePageNumber) || 0
    const debugSubmittedPages = preAiCandidatePages
      .map((item) => Number(item.pageNumber))
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
    const submittedPagesWithCounts = preAiCandidatePages
      .map((item) => ({
        pageNumber: Number(item.pageNumber),
        variantCount: Number(item.variantCount)
      }))
      .filter((item) => Number.isInteger(item.pageNumber) && item.pageNumber > 0 && Number.isFinite(item.variantCount))
      .sort((a, b) => a.pageNumber - b.pageNumber)
    const step3VariantPages = (
      submittedPagesWithCounts.length
        ? submittedPagesWithCounts
        : (
            debugSubmittedPages.length
              ? pageVariantCounts.filter((item) => debugSubmittedPages.includes(Number(item.pageNumber)))
              : pageVariantCounts.filter((item) => keptPages.includes(Number(item.pageNumber)))
          )
    ).sort((a, b) => a.pageNumber - b.pageNumber)
    const likelyPageVariantCounts = (
      scopeType === "multi_product_scope" && choiceMode === "show_model_numbers" && activePageNumber
        ? pageVariantCounts.filter((item) => Number(item.pageNumber) === activePageNumber)
        : pageVariantCounts.filter((item) => (debugSubmittedPages.length ? debugSubmittedPages : keptPages).includes(Number(item.pageNumber)))
    ).sort((a, b) => a.pageNumber - b.pageNumber)
    const step3VariantTotal = step3VariantPages.reduce((sum, item) => sum + (Number(item.variantCount) || 0), 0)
    const step3DecisionCount = effectiveModelBackedCount
    const step3ExcludedCount = excludedRows.length
    const step3MatchedCount = step3DecisionCount
    const step3RawTotal = Math.max(step3VariantTotal, step3MatchedCount + step3ExcludedCount)
    const multiProductPathLabel = effectiveModelBackedCount > showModelNumbersThreshold ? `Multi Product: >${showModelNumbersThreshold}` : `Multi Product: <=${showModelNumbersThreshold}`
    const shouldShowStep4 = scopeType === "multi_product_scope" && effectiveModelBackedCount > showModelNumbersThreshold && !isStructureRoutingUncertain(rerank)
    const showVariantIdentificationStep = scopeType === "multi_product_scope" && choiceMode === "show_model_numbers" && !isStructureRoutingUncertain(rerank)
    const step4KeywordSummary = buildKeywordStatsFromVariantBreakdown(preAiVariantBreakdown)
      .slice(0, 14)
      .map((item) => `${titleCaseWords(item.term)} (${item.count})`)
    const step4ProposedNarrowingGroups = Array.isArray(rerank?.narrowingBuckets) && rerank.narrowingBuckets.length
      ? rerank.narrowingBuckets
          .map((bucket) => ({
            label: normalizeText(bucket?.label || ""),
            options: Array.isArray(bucket?.options) ? bucket.options.map((item) => normalizeText(item)).filter(Boolean) : []
          }))
          .filter((bucket) => bucket.label && bucket.options.length)
      : buildProposedNarrowingTermsFromVariantBreakdown(preAiVariantBreakdown)

    return `
      <div class="ai-source-summary">
        ${
          preAiCandidatePages.length
            ? `
              <section class="ai-source-section">
                <h4>Step 1: Pages Submitted to AI</h4>
                <div class="ai-source-page-strip">
                  ${preAiCandidatePages.map((item) => `
                    <div class="ai-source-page-card">
                      <strong>${escapeHtml(`pdf p.${item.pageNumber}`)}</strong>
                      <span>${escapeHtml(`Deterministic score ${String(item.score)}`)}${Number(item.score) <= 60 ? " \u26a0 Low confidence" : ""}</span>
                    </div>
                  `).join("")}
                </div>
              </section>
            `
            : ""
        }

        <section class="ai-source-section">
          <h4>Step 2: Structure Decision</h4>
          <div class="ai-source-grid">
            <div><span>Scope</span><strong>${escapeHtml(scopeType === "multi_product_scope" ? `Multi Product (${multiScopeLikelihood !== null ? `${multiScopeLikelihood}%` : "AI"})` : `Single Product (${singleScopeLikelihood !== null ? `${singleScopeLikelihood}%` : "AI"})`)}</strong></div>
            ${
              singleScopeLikelihood !== null
                ? `<div><span>Single Product</span><strong>${escapeHtml(`${singleScopeLikelihood}%`)}</strong></div>`
                : ""
            }
            ${
              multiScopeLikelihood !== null
                ? `<div><span>Multi Product</span><strong>${escapeHtml(`${multiScopeLikelihood}%`)}</strong></div>`
                : ""
            }
            <div><span>Confidence</span><strong>${escapeHtml(readableConfidence)}</strong></div>
            <div><span>Reason</span><strong>${escapeHtml(normalizeText(rerank?.summary || rerank?.reason || routing?.summary || "Not captured"))}</strong></div>
          </div>
        </section>

        ${
          scopeType === "multi_product_scope" && !isStructureRoutingUncertain(rerank)
            ? `
              <section class="ai-source-section">
                <h4>Step 3: Variant Count</h4>
                <div class="ai-source-grid">
                  <div><span>Path</span><strong>${escapeHtml(`${multiProductPathLabel} -> ${choiceMode === "show_model_numbers" ? "Show Model Numbers" : "Narrow Search"}`)}</strong></div>
                  <div><span>Raw rows</span><strong>${escapeHtml(String(step3RawTotal))}</strong></div>
                  <div><span>Excluded</span><strong>${escapeHtml(step3ExcludedCount ? `${step3ExcludedCount} rows filtered` : "0 rows filtered")}</strong></div>
                  <div><span>Matched</span><strong>${escapeHtml(`${step3MatchedCount} product rows after exclusions`)}</strong></div>
                </div>
                ${productSetCountReason ? `<p class="ai-source-copy"><strong>Count reason:</strong> ${escapeHtml(productSetCountReason)}</p>` : ""}
                ${appliedFilters.length ? `<p class="ai-source-copy"><strong>Applied filters:</strong> ${escapeHtml(appliedFilters.join(" | "))}</p>` : ""}
                ${excludedFilters.length ? `<p class="ai-source-copy"><strong>Excluded filters:</strong> ${escapeHtml(excludedFilters.join(" | "))}</p>` : ""}
                ${
                  step3VariantPages.length
                    ? `
                      <div class="ai-source-page-strip">
                        ${step3VariantPages.map((item) => `
                          <div class="ai-source-page-card">
                            <strong>${escapeHtml(`pdf p.${item.pageNumber}`)}</strong>
                            <span>${escapeHtml(`${Number(item.variantCount) || 0} raw rows`)}</span>
                          </div>
                        `).join("")}
                      </div>
                    `
                    : `
                      <div class="ai-source-metric-row">
                        <div class="ai-source-rule-bar">
                          <span>No page-level variant counts are available yet for this run.</span>
                        </div>
                      </div>
                    `
                }
                ${
                  excludedRows.length
                    ? `
                      <details class="ai-source-details ai-source-variant-details" open>
                        <summary>${escapeHtml(`${excludedRows.length} excluded rows (expand)`)}</summary>
                        <ul class="ai-source-list ai-source-variant-list">
                          ${excludedRows.map((item) => `
                            <li>
                              <strong>${escapeHtml(`p.${Number.isFinite(Number(item.pageNumber)) ? item.pageNumber : "?"} · ${normalizeText(item.label || "Excluded row")}`)}</strong>
                              <span>${escapeHtml(normalizeText(item.reason || "Excluded by prompt rules"))}</span>
                            </li>
                          `).join("")}
                        </ul>
                      </details>
                    `
                    : ""
                }
              </section>
            `
            : ""
        }

        ${
          showVariantIdentificationStep
            ? `
              <section class="ai-source-section">
                <h4>Step 4: Variants Identified</h4>
                <div class="ai-source-grid">
                  <div><span>Matching variants</span><strong>${escapeHtml(String(step3MatchedCount))}</strong></div>
                  <div><span>Query specificity</span><strong>${escapeHtml(productSetQuerySpecificity || "Unknown")}</strong></div>
                  <div><span>Recommended Next Step</span><strong>${escapeHtml(recommendedNextStep)}</strong></div>
                </div>
                ${
                  modelBackedCandidates.length
                    ? `
                      <ul class="ai-source-list ai-source-variant-list">
                        ${modelBackedCandidates.map((item) => `
                          <li>
                            <strong>${escapeHtml(`${getProductCardModelCode(item) || item.label || item.id || "Variant"}`)}</strong>
                            <span>${escapeHtml(normalizeText(item.description || item.evidence || `Page ${item.resolvedPageNumber || item.pageNumber || "?"}`))}</span>
                          </li>
                        `).join("")}
                      </ul>
                    `
                    : matchingIds.length
                      ? `
                        <p class="ai-source-copy"><strong>Matching IDs:</strong> ${escapeHtml(matchingIds.join(" | "))}</p>
                      `
                      : ""
                }
              </section>
            `
            : shouldShowStep4
            ? `
              <section class="ai-source-section">
                <h4>Step 4: Proposed Narrowing Terms</h4>
                ${
                  step4KeywordSummary.length
                    ? `
                      <div class="ai-source-metric-row">
                        <div class="ai-source-rule-bar">
                          <span><strong>Keyword Summary:</strong> ${escapeHtml(step4KeywordSummary.join(" | "))}</span>
                        </div>
                      </div>
                    `
                    : ""
                }
                ${
                  step4ProposedNarrowingGroups.length
                    ? `
                      <ul class="ai-source-list ai-source-term-list">
                        ${step4ProposedNarrowingGroups.map((group) => `
                          <li>
                            <strong>${escapeHtml(group.label)}</strong>
                            <span>${escapeHtml(group.options.join(" | "))}</span>
                          </li>
                        `).join("")}
                      </ul>
                    `
                    : `
                      <div class="ai-source-metric-row">
                        <div class="ai-source-rule-bar">
                          <span>No reliable narrowing terms were detected from the current variant descriptions.</span>
                        </div>
                      </div>
                    `
                }
              </section>
            `
            : ""
        }

        ${
          decisionAssistResult
            ? `
              <section class="ai-source-section">
                <h4>Step 5: Spec Extraction</h4>
                <div class="ai-source-grid">
                  <div><span>Pages used</span><strong>${escapeHtml(formatPageRangeLabel(decisionAssistResult.includedPages || []))}</strong></div>
                  <div><span>Stopped at</span><strong>${escapeHtml(normalizeText(decisionAssistResult.stopReason || "Not captured"))}</strong></div>
                </div>
                ${decisionAssistResult.inclusionSummary ? `<p class="ai-source-copy"><strong>Inclusion summary:</strong> ${escapeHtml(decisionAssistResult.inclusionSummary)}</p>` : ""}
                ${decisionAssistResult.summary ? `<p class="ai-source-copy"><strong>Stop reason:</strong> ${escapeHtml(decisionAssistResult.stopReason || decisionAssistResult.summary)}</p>` : ""}
              </section>
            `
            : ""
        }
      </div>
    `
  }

  function isProductFirstSessionActive() {
    const selectedProductId = normalizeText(appState.productFirstSelection?.productId)
    if (!(appState.productFirstSelection?.active && selectedProductId)) return false
    if (appState.decisionAssistLoading) return true
    return Boolean(
      appState.decisionAssistResult?.fromProductFirst
      && normalizeText(appState.decisionAssistResult?.selectedProductId || "") === selectedProductId
    )
  }

  function suppressProductFirstSiblingVariants(variantCandidates, selectedProductId, familyProductCandidates) {
    const candidates = Array.isArray(variantCandidates) ? variantCandidates : []
    if (!candidates.length) return []
    const selectedKey = getConcreteProductCandidateKey(selectedProductId)
    const familyKeys = new Set(
      (familyProductCandidates || [])
        .flatMap((candidate) => [candidate.id, candidate.label])
        .map((value) => getConcreteProductCandidateKey(value))
        .filter(Boolean)
    )

    const filtered = candidates.filter((candidate) => {
      const labelKey = getConcreteProductCandidateKey(candidate.label)
      const idKey = getConcreteProductCandidateKey(candidate.id)
      if (selectedKey && (labelKey === selectedKey || idKey === selectedKey)) return false
      if (familyKeys.has(labelKey) || familyKeys.has(idKey)) return false
      if (/^model\s+(?:[A-Z]{1,4}-\d{1,3}[A-Z0-9-]*|\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*|\d{4,6}[A-Z0-9-]*)$/i.test(normalizeText(candidate.label))) return false
      return true
    })

    return filtered
  }

  function getProductCardModelCode(candidate) {
    const id = normalizeText(candidate?.id || "")
    const label = normalizeText(candidate?.label || "")
    const description = normalizeText(candidate?.description || "")
    const evidence = normalizeText(candidate?.evidence || "")
    const sourceText = [id, label, description, evidence].filter(Boolean).join(" ")
    const modelMatch = sourceText.match(/\b(?:[A-Z]{1,4}-\d{1,4}[A-Z0-9-]*|\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*|\d{4,6}[A-Z0-9-]*)\b/)
    return modelMatch ? modelMatch[0] : ""
  }

  function shouldShowSeparateProductCardModelCode(candidate) {
    const modelCode = getProductCardModelCode(candidate)
    const label = normalizeText(candidate?.label || "").toLowerCase()
    if (!modelCode) return false
    return !label.includes(modelCode.toLowerCase())
  }

  function getProductCardTitle(candidate) {
    return normalizeText(candidate?.label || getProductCardModelCode(candidate) || candidate?.id || "")
  }

  function getProductCardSubtitle(candidate) {
    const description = normalizeText(candidate?.description || "")
    const label = normalizeText(candidate?.label || "")
    const modelCode = getProductCardModelCode(candidate)
    const cleanedDescription = normalizeText(
      description
        .replace(/\bpage\s+\d+\b/gi, "")
        .replace(/\bsection\b/gi, "")
        .replace(/\s{2,}/g, " ")
    )
    if (!cleanedDescription) return ""

    let simplified = cleanedDescription
    if (label) {
      simplified = normalizeText(
        simplified.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
      )
    }
    if (modelCode) {
      simplified = normalizeText(
        simplified.replace(new RegExp(modelCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
      )
    }
    simplified = normalizeText(
      simplified.replace(/^[/,\s]*(?:[A-Z]{1,4}-\d{1,3}[A-Z0-9-]*[/,\s]*)+/g, "")
    )
    simplified = normalizeText(simplified.replace(/^[,:\-–—]\s*/, ""))

    if (!simplified || simplified.toLowerCase() === label.toLowerCase()) return ""
    return simplified
  }

  function tokenizeProductCardText(value) {
    return [...new Set(
      normalizeText(value)
        .toLowerCase()
        .replace(/\b[A-Z]{1,4}-\d{1,3}[A-Z0-9-]*\b/gi, " ")
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3)
        .filter((token) => !["and", "the", "with", "for", "variant", "variants", "model", "models"].includes(token))
    )]
  }

  function getDisplayProductCardSubtitle(candidate) {
    const subtitle = getProductCardSubtitle(candidate)
    const title = getProductCardTitle(candidate)
    if (!subtitle) return ""
    if (subtitle.toLowerCase() === title.toLowerCase()) return ""
    const normalizedTitle = title.toLowerCase()
    const normalizedSubtitle = subtitle.toLowerCase()
    if (
      normalizedSubtitle.length <= 20
      && (
        normalizedTitle.includes(normalizedSubtitle)
        || /^(base|swivel|tilt|mechanism|fixed|memory return|four prong base)$/i.test(subtitle)
      )
    ) {
      return ""
    }

    const titleTokens = tokenizeProductCardText(title)
    const subtitleTokens = tokenizeProductCardText(subtitle)
    if (titleTokens.length && subtitleTokens.length) {
      const titleTokenSet = new Set(titleTokens)
      const overlappingTokenCount = subtitleTokens.filter((token) => titleTokenSet.has(token)).length
      const extraTokenCount = subtitleTokens.filter((token) => !titleTokenSet.has(token)).length
      const coversTitle = titleTokens.every((token) => subtitleTokens.includes(token))

      if (coversTitle && extraTokenCount <= 2 && overlappingTokenCount >= Math.max(2, titleTokens.length - 1)) {
        return ""
      }
    }

    if (subtitle.split(/\s+/).filter(Boolean).length > 6) return ""

    return subtitle
  }

  function getProductCardDistinction(candidate, documentRecord = null, fallbackPageNumber = null) {
    const directSubtitle = getDisplayProductCardSubtitle(candidate)
    if (directSubtitle && !/\b(example|item number|suffix|required to specify|to order specify)\b/i.test(directSubtitle)) return directSubtitle

    const modelCode = getProductCardModelCode(candidate)
    const resolvedPageNumber = getCandidatePageNumber(candidate, fallbackPageNumber, documentRecord)
    const page = documentRecord?.pages?.find((item) => item.pageNumber === resolvedPageNumber)
    const pageText = page ? String(getPageCombinedText(page) || "") : ""
    if (!modelCode || !pageText) return ""

    const localCandidates = extractConcreteVariantCandidatesFromPageText(pageText)
    const localMatch = localCandidates.find((item) => getProductCardModelCode(item).toLowerCase() === modelCode.toLowerCase())
    const localDescription = normalizeText(localMatch?.description || localMatch?.label || "")
    if (localDescription && !/^model\s+/i.test(localDescription) && !/\b(example|item number|suffix|required to specify|to order specify)\b/i.test(localDescription)) {
      return normalizeText(localDescription.replace(new RegExp(modelCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").replace(/^[,:\-–—\s/]+/, ""))
    }

    const rawText = String(pageText || "")
    const matches = [...rawText.matchAll(/\b(?:[A-Z]{1,4}-\d{1,4}[A-Z0-9-]*|\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*|\d{4,6}[A-Z0-9-]*)\b/gi)]
      .map((match) => ({ code: normalizeText(match[0] || ""), index: Number(match.index) || 0 }))
      .filter((match) => match.code)
    const currentIndex = matches.findIndex((match) => match.code.toLowerCase() === modelCode.toLowerCase())
    if (currentIndex === -1) return ""
    const blockStart = matches[currentIndex].index
    const blockEnd = matches[currentIndex + 1]?.index || rawText.length
    const block = rawText.slice(blockStart, blockEnd)
    const blockLines = block
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .map((line) => normalizeText(line.replace(new RegExp(modelCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").replace(/^[,:\-–—\s/]+/, "")))
      .filter(Boolean)

    const descriptiveLines = blockLines.filter((line) =>
      !/\b(example|item number|suffix|required to specify|to order specify|com|col|fabric|leather)\b/i.test(line)
      && !/sq\.?\s*ft|yd\.?|^w\s|^d\s|^h\s|^sh\s|^ah\s/i.test(line)
      && /chair|stool|seat|back|base|arms|armless|upholstered|mesh|wood|aluminum|nylon|soft touch|cap|veneer|interior/i.test(line)
    )

    return descriptiveLines.slice(0, 2).join(" ")
  }

  // Routing is intentionally conservative: product-first only activates when the
  // reranked top pages expose grounded product labels we can safely present.
  function buildStructureRoutingState(documentRecord = null) {
    const activeDocument = documentRecord || getActiveDocument()
    const archetype = getSpecParsingMode(activeDocument)
    const fallbackPageNumber =
      appState.aiRerankResult?.bestPage
      || appState.rankedPages[0]?.pageNumber
      || activeDocument?.pages?.[0]?.pageNumber
      || 1
    const fallback = {
      structureType: getStructureTypeFromArchetype(archetype),
      interactionModel: "page_first",
      suggestedInteractionModel: "",
      confidence: 0,
      hasConcreteProducts: false,
      productCandidates: [],
      productFirstPageNumber: fallbackPageNumber,
      source: "fallback"
    }

    if (!activeDocument || appState.aiRerankDocumentId !== activeDocument.id || !appState.aiRerankResult) {
      return fallback
    }

    const aiResult = appState.aiRerankResult
    const aiStructureType = normalizeStructureType(aiResult.structureType)
    const structureType = aiStructureType || getStructureTypeFromArchetype(archetype)
    const suggestedInteractionModel = normalizeInteractionModel(aiResult.interactionModel)
    const confidence = Number.isFinite(aiResult.structureConfidence) ? aiResult.structureConfidence : 0
    const productCandidates = getAggregatedTopFamilyProductCandidates(activeDocument, aiResult)
    const topPageNumbers = getTopRerankedPageNumbers(aiResult)
    const hasConcreteProducts = Boolean(aiResult.hasConcreteProducts) && productCandidates.length > 1 && topPageNumbers.length > 0
    const familySignalSupportsProductFirst =
      structureType === "product_family"
      || archetype === "family"

    // Concrete visible product candidates outrank model confidence. If we can
    // safely ground product choices on the top reranked family pages, keep the
    // user in product-first mode and use pages only as downstream context.
    const eligibleForProductFirst =
      hasConcreteProducts
      && familySignalSupportsProductFirst
      && (
        suggestedInteractionModel === "product_first"
        || confidence >= PRODUCT_FIRST_CONFIDENCE_THRESHOLD
        || archetype === "family"
      )

    return {
      structureType,
      suggestedInteractionModel,
      interactionModel: eligibleForProductFirst ? "product_first" : "page_first",
      confidence,
      hasConcreteProducts,
      productCandidates,
      productFirstPageNumber: aiResult.bestPage || topPageNumbers[0] || fallbackPageNumber,
      source: eligibleForProductFirst ? "grounded_products" : "fallback"
    }
  }

  function updateStructureRoutingState(documentRecord = null) {
    appState.structureRouting = buildStructureRoutingState(documentRecord)
  }

  function getAiRerankCandidateLimit() {
    return getSpecParsingMode() === "family" ? 12 : 5
  }

  function getAiKeptPageLimit() {
    return getSpecParsingMode() === "family" ? 8 : 3
  }

  function buildFamilySearchTokens(documentRecord, selectedPage) {
    const productName = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "")
    const selectedTitle = normalizeText(getPrimaryHeaderTitle(documentRecord, selectedPage.pageNumber))
    const selectedText = normalizeText(getPageCombinedText(selectedPage)).slice(0, 500)
    const variantStopwords = new Set([
      "wire",
      "wood",
      "base",
      "pedestal",
      "prong",
      "low",
      "high",
      "back",
      "footrest",
      "exposed",
      "veneer",
      "shell",
      "fully",
      "upholstered",
      "contrasting",
      "material"
    ])
    const genericStopwords = new Set([
      "the",
      "and",
      "for",
      "with",
      "from",
      "this",
      "that",
      "price",
      "list",
      "pages",
      "page",
      "spec",
      "specs",
      "specification",
      "specifications",
      "reference",
      "references",
      "finish",
      "finishes",
      "powder",
      "coat",
      "davis"
    ])

    return [...new Set(
      `${productName} ${selectedTitle} ${selectedText}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3)
        .filter((token) => !genericStopwords.has(token))
        .filter((token) => !variantStopwords.has(token))
    )].slice(0, 8)
  }

  function getFamilyDecisionCandidatePages(documentRecord, selectedPage, selectionHints = {}) {
    const selectedProductHint = normalizeText(selectionHints.selectedProductId || "")
    const selectedVariantHint = normalizeText(selectionHints.selectedVariantId || "")
    const allowFamilyExpansion = selectionHints.allowFamilyExpansion === true
    if (!selectedProductHint && !selectedVariantHint) {
      return selectedPage ? [selectedPage] : []
    }
    if (!allowFamilyExpansion) {
      return selectedPage ? [selectedPage] : []
    }

    const familyTokens = buildFamilySearchTokens(documentRecord, selectedPage)
    const selectedTitle = normalizeText(getPrimaryHeaderTitle(documentRecord, selectedPage.pageNumber)).toLowerCase()
    const exactProduct = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "").toLowerCase()
    const rankedScoreByPage = new Map(appState.rankedPages.map((page) => [page.pageNumber, Number(page.score) || 0]))
    const referencePattern = /finish|finishes|powder\s*coat|specification|specifications|dimension|dimensions|material|upholstery|veneer|glide|pricing|price list|reference/i
    const variantPattern = /wire base|wood base|four prong pedestal|low back|high back|footrest|exposed veneer shell|fully upholstered|contrasting material/i

    const scoredPages = documentRecord.pages
      .map((page) => {
        const pageTitle = normalizeText(getPrimaryHeaderTitle(documentRecord, page.pageNumber))
        const pageText = normalizeText(getPageCombinedText(page))
        const haystack = `${pageTitle}\n${pageText}`.toLowerCase()
        const tokenMatches = familyTokens.filter((token) => haystack.includes(token))
        const titleTokenMatches = familyTokens.filter((token) => pageTitle.toLowerCase().includes(token))
        const hasReferenceSignals = referencePattern.test(pageTitle) || referencePattern.test(pageText)
        const hasVariantSignals = variantPattern.test(haystack)
        let score = page.pageNumber === selectedPage.pageNumber ? 200 : 0

        if (exactProduct && haystack.includes(exactProduct)) score += 40
        score += tokenMatches.length * 8
        score += titleTokenMatches.length * 6
        score += Math.min(24, Math.round((rankedScoreByPage.get(page.pageNumber) || 0) / 2))
        if (selectedTitle && pageTitle && pageTitle.toLowerCase().includes(selectedTitle)) score += 18
        if (tokenMatches.length && hasReferenceSignals) score += 14
        if (hasVariantSignals) score += 8

        return {
          page,
          score
        }
      })
      .filter((entry) => entry.score >= 14 || entry.page.pageNumber === selectedPage.pageNumber)
      .sort((a, b) => b.score - a.score || a.page.pageNumber - b.page.pageNumber)

    const topPages = scoredPages.slice(0, 10).map((entry) => entry.page)
    if (topPages.length > 1) {
      return [...topPages].sort((a, b) => a.pageNumber - b.pageNumber)
    }

    return documentRecord.pages
      .filter((page) => page.pageNumber >= selectedPage.pageNumber)
      .slice(0, 4)
  }

  function getDecisionCandidatePages(documentRecord, selectedPage, selectionHints = {}) {
    if (getSpecParsingMode() === "family") {
      return getFamilyDecisionCandidatePages(documentRecord, selectedPage, selectionHints)
    }

    return documentRecord.pages
      .filter((page) => page.pageNumber >= selectedPage.pageNumber)
      .slice(0, 6)
  }

  function normalizeDecisionCandidates(items) {
    if (!Array.isArray(items)) return []
    return items
      .map((item, index) => ({
        id: normalizeText(item?.id || item?.key || item?.name || item?.label || `candidate-${index + 1}`),
        label: normalizeText(item?.label || item?.name || `Option ${index + 1}`),
        description: normalizeText(item?.description || item?.summary || ""),
        evidence: normalizeText(item?.evidence || item?.reason || ""),
        pageNumber: Number.isInteger(Number(item?.pageNumber)) && Number(item.pageNumber) > 0 ? Number(item.pageNumber) : null
      }))
      .filter((item) => item.id && item.label)
  }

  function extractReferencedPageNumbers(value) {
    const matches = String(value || "").match(/\bpage\s+(\d+)\b/gi) || []
    return matches
      .map((match) => Number(match.replace(/[^\d]/g, "")))
      .filter((pageNumber) => Number.isFinite(pageNumber))
  }

  function filterCandidatesToStartingPage(candidates, startPageNumber) {
    if (!Array.isArray(candidates) || candidates.length <= 1) return candidates || []
    const withPageMentions = candidates.filter((candidate) => extractReferencedPageNumbers(candidate.evidence).length)
    if (!withPageMentions.length) return candidates
    const startPageCandidates = candidates.filter((candidate) => {
      const referencedPages = extractReferencedPageNumbers(candidate.evidence)
      return !referencedPages.length || referencedPages.includes(startPageNumber)
    })
    return startPageCandidates.length ? startPageCandidates : candidates
  }

  function buildVariantEvidenceTokens(label) {
    const genericTokens = new Set([
      "ginkgo",
      "ply",
      "lounge",
      "chair",
      "chairs",
      "seating",
      "base",
      "model",
      "series",
      "davis"
    ])

    return tokenize(label)
      .filter((token) => token.length >= 4 || token === "wood" || token === "wire")
      .filter((token) => !genericTokens.has(token))
  }

  function extractConcreteVariantCandidatesFromPageText(pageText, subtypeHint = "") {
    const rawText = String(pageText || "")
    const alphaNumericPattern = /\b([A-Z]{1,4}-\d{1,4}[A-Z0-9-]*)\b/g
    const dottedNumericRowPattern = /(?:^|\n)\s*(\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*)\b/g
    const numericRowPattern = /(?:^|\n)\s*(\d{4,6}[A-Z0-9-]*)\b/g
    const itemMatches = [...rawText.matchAll(alphaNumericPattern), ...rawText.matchAll(dottedNumericRowPattern), ...rawText.matchAll(numericRowPattern)]
      .map((match) => ({
        ...match,
        index: Number(match.index) || 0,
        1: normalizeText(match[1] || "")
      }))
      .filter((match) => match[1])
      .sort((a, b) => a.index - b.index)
      .filter((match, index, items) => index === 0 || match.index !== items[index - 1].index || match[1] !== items[index - 1][1])
    if (itemMatches.length < 2) return []

    const phraseMatchers = [
      { pattern: /exposed veneer shell/gi, label: "Exposed Veneer Shell" },
      { pattern: /interior upholstery/gi, label: "Interior Upholstery" },
      { pattern: /fully upholstered/gi, label: "Fully Upholstered" },
      { pattern: /all same material/gi, label: "All Same Material" },
      { pattern: /contrasting material/gi, label: "Contrasting Material" },
      { pattern: /wire base/gi, label: "Wire Base" },
      { pattern: /wood base/gi, label: "Wood Base" },
      { pattern: /four prong pedestal/gi, label: "Four Prong Pedestal" },
      { pattern: /memory return swivel/gi, label: "Memory Return Swivel" },
      { pattern: /swivel/gi, label: "Swivel" },
      { pattern: /fixed/gi, label: "Fixed" },
      { pattern: /low back/gi, label: "Low Back" },
      { pattern: /high back/gi, label: "High Back" }
    ]

    const items = itemMatches.map((match, index) => {
      const model = normalizeText(match[1] || "")
      const start = match.index || 0
      const end = itemMatches[index + 1]?.index || rawText.length
      const block = rawText.slice(start, end)
      const matchedLabels = phraseMatchers
        .filter((entry) => entry.pattern.test(block))
        .map((entry) => entry.label)

      return {
        model,
        block,
        matchedLabels: [...new Set(matchedLabels)]
      }
    }).filter((item) => {
      const blockText = normalizeText(item.block).toLowerCase()
      const hasProductLanguage =
        item.matchedLabels.length > 0
        || /chair|stool|seat|back|base|arms|armless|upholstered|mesh|jury|veneer shell|swivel|fixed|pedestal/i.test(blockText)
      const looksLikePriceOnly =
        /\bcom\b|\bcol\b|fabric|leather|list price|grade\s+[a-z]|gr\s*[a-z]|shell finish|frame finish|wood veneer|powder coat/i.test(blockText)
        && !/chair|stool|seat|back|base|arms|armless|upholstered|mesh|jury|veneer shell|swivel|fixed|pedestal/i.test(blockText)
      return hasProductLanguage && !looksLikePriceOnly && !looksLikeNonProductLegend(blockText)
    })

    const labelFrequency = new Map()
    items.forEach((item) => {
      item.matchedLabels.forEach((label) => {
        labelFrequency.set(label, (labelFrequency.get(label) || 0) + 1)
      })
    })

    return items.map((item, index) => {
      const distinctiveLabels = item.matchedLabels.filter((label) => (labelFrequency.get(label) || 0) < items.length)
      const preferredLabels = distinctiveLabels.filter((label) => !/low back|high back|wire base|wood base|four prong pedestal|fixed|swivel/i.test(label))
      const labelParts = (preferredLabels.length ? preferredLabels : distinctiveLabels.length ? distinctiveLabels : item.matchedLabels).slice(0, 3)
      const label = labelParts.join(" / ")
      const conciseDescription = label && !/^model\s+/i.test(label)
        ? label
        : normalizeText(
            item.block
              .split(/\n+/)
              .map((line) => normalizeText(line))
              .find((line) => /chair|stool|seat|back|base|arms|armless|upholstered|mesh|wood|aluminum|nylon|soft touch|veneer shell|swivel|fixed|pedestal/i.test(line) && !looksLikeNonProductLegend(line) && !/\bcom\b|\bcol\b|fabric|leather|list price/i.test(line))
              || ""
          )
      return {
        id: slugify(`${item.model}-${label || `variant-${index + 1}`}`, `variant-${index + 1}`),
        label: label || `Model ${item.model}`,
        description: conciseDescription || item.model,
        evidence: `Page-local model ${item.model}`,
        matchedLabels: item.matchedLabels
      }
    })
      .filter((candidate) => normalizeText(candidate.label))
      .filter((candidate) => {
        const hint = normalizeText(subtypeHint).toLowerCase()
        if (!hint) return true
        const candidateText = [candidate.label, ...(candidate.matchedLabels || [])].map((value) => normalizeText(value).toLowerCase()).join(" ")
        if (/wire base/.test(hint)) return /wire base/.test(candidateText)
        if (/wood base/.test(hint)) return /wood base/.test(candidateText)
        if (/memory return/.test(hint)) return /memory return/.test(candidateText)
        if (/pedestal/.test(hint) && /fixed/.test(hint)) return /four prong pedestal/.test(candidateText) && /\bfixed\b/.test(candidateText)
        if (/pedestal/.test(hint) && /swivel/.test(hint)) return /four prong pedestal/.test(candidateText) && /\bswivel\b/.test(candidateText)
        if (/pedestal/.test(hint)) return /four prong pedestal/.test(candidateText)
        return true
      })
      .map(({ matchedLabels, ...candidate }) => candidate)
  }

  function preferConcretePageVariants(candidates, selectedPage, selectedVariantHint = "", documentRecord = null) {
    if (getSpecParsingMode() !== "family" || selectedVariantHint) return candidates || []
    const subtypeHint = getSelectedPageSubtypeHint(documentRecord, selectedPage)
    const concreteCandidates = extractConcreteVariantCandidatesFromPageText(getPageCombinedText(selectedPage), subtypeHint)
    if (concreteCandidates.length >= 2) return concreteCandidates
    if ((String(getPageCombinedText(selectedPage)).match(/\b[A-Z]{1,4}-\d{1,3}[A-Z0-9-]*\b/g) || []).length >= 2) {
      return []
    }

    const genericVariantLabels = new Set(["base type", "upholstery type", "material type", "finish type"])
    const filtered = (candidates || []).filter((candidate) => !genericVariantLabels.has(normalizeText(candidate.label).toLowerCase()))
    return filtered.length ? filtered : candidates || []
  }

  function filterVariantCandidatesToSelectedPage(candidates, selectedPage, documentRecord) {
    if (getSpecParsingMode() !== "family" || !selectedPage) return candidates || []
    if (!Array.isArray(candidates) || candidates.length <= 1) return candidates || []

    const pageTitle = normalizeText(getPrimaryHeaderTitle(documentRecord, selectedPage.pageNumber)).toLowerCase()
    const pageText = normalizeText(getPageCombinedText(selectedPage)).toLowerCase()
    const haystack = `${pageTitle}\n${pageText}`

    const filtered = candidates.filter((candidate) => {
      const label = normalizeText(candidate.label).toLowerCase()
      const simplifiedLabel = label.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim()
      if (simplifiedLabel && haystack.includes(simplifiedLabel)) return true

      const tokens = buildVariantEvidenceTokens(candidate.label)
      if (!tokens.length) return false
      return tokens.every((token) => haystack.includes(token))
    })

    return filtered.length ? filtered : candidates
  }

  function filterCandidatesToResolvedProduct(candidates, productName) {
    if (!Array.isArray(candidates) || candidates.length <= 1) return candidates || []
    const normalizedProductName = normalizeText(productName).toLowerCase()
    if (!normalizedProductName) return candidates
    const matchingCandidates = candidates.filter((candidate) => {
      const normalizedLabel = normalizeText(candidate.label).toLowerCase()
      return normalizedLabel && (normalizedProductName.includes(normalizedLabel) || normalizedLabel.includes(normalizedProductName))
    })
    return matchingCandidates.length ? matchingCandidates : candidates
  }

  function shouldTreatVariantCandidatesAsConfiguration(variantCandidates, sectionPages) {
    const candidates = Array.isArray(variantCandidates) ? variantCandidates : []
    if (candidates.length < 2) return false
    const looksLikeModelSplit = candidates.every((candidate) => /\bEA\d+\b/i.test(candidate.label) || /(no arms|arms with arm pads|arms)/i.test(candidate.label))
    if (!looksLikeModelSplit) return false
    const combinedText = (sectionPages || []).map((page) => getPageCombinedText(page)).join("\n")
    const configSignals = extractConfigurationComboPrices(combinedText)
    return Boolean(configSignals.prefix && configSignals.priceMap.size && configSignals.armCodeMap.size)
  }

  function getVariantMatchTokens(variantCandidates, selectedVariantId) {
    const selectedVariant = (variantCandidates || []).find((candidate) => normalizeText(candidate.id) === normalizeText(selectedVariantId))
    const source = selectedVariant || { id: selectedVariantId, label: selectedVariantId }
    return [source.id, source.label]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
  }

  function getSelectedCandidateMatchTokens(candidates, selectedId) {
    const selectedCandidate = (candidates || []).find((candidate) => normalizeText(candidate.id) === normalizeText(selectedId))
    const source = selectedCandidate || { id: selectedId, label: selectedId }
    const modelCode = getProductCardModelCode(source)
    return [source.id, source.label, modelCode]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
      .filter((value) => value.length >= 5 || /\b(?:[a-z]{1,4}-\d{1,4}|\d{4,6}(?:\.\d{1,4}){1,3}|\d{4,6})\b/i.test(value))
  }

  function extractModelCodes(value) {
    return [...new Set((normalizeText(value).match(/\b(?:[A-Z]{1,4}-\d{1,4}[A-Z0-9-]*|\d{4,6}(?:\.\d{1,4}){1,3}[A-Z0-9-]*|\d{4,6}[A-Z0-9-]*)\b/gi) || []).map((item) => normalizeText(item)))]
  }

  function getActiveVariantHighlightSelection() {
    const decisionResult = appState.decisionAssistResult
    const selectedVariantId = normalizeText(decisionResult?.selectedVariantId || "")
    const selectedProductId = normalizeText(decisionResult?.selectedProductId || appState.productFirstSelection?.productId || "")
    const variantCandidate = selectedVariantId ? getSelectedCandidate(decisionResult?.variantCandidates, selectedVariantId) : null
    const structureRouting = appState.structureRouting || buildStructureRoutingState(getActiveDocument())
    const visibleProductCandidates = getDisplayableModelBackedProductCandidates(structureRouting)
    const productCandidate = selectedProductId
      ? (
          getSelectedCandidate(decisionResult?.productCandidates, selectedProductId)
          || getSelectedCandidate(structureRouting?.productCandidates, selectedProductId)
          || getSelectedCandidate(appState.aiRerankResult?.concreteProductCandidates, selectedProductId)
          || getSelectedCandidate(visibleProductCandidates, selectedProductId)
        )
      : null
    const sourceParts = [
      selectedVariantId,
      selectedProductId,
      variantCandidate?.id,
      variantCandidate?.label,
      variantCandidate?.description,
      variantCandidate?.evidence,
      productCandidate?.id,
      productCandidate?.label,
      productCandidate?.description,
      productCandidate?.evidence
    ].filter(Boolean)
    const modelCodes = [...new Set(extractModelCodes(sourceParts.join(" ")))]
    if (!modelCodes.length) return null
    return {
      modelCodes,
      label: modelCodes[0],
      pageNumber: Number(variantCandidate?.pageNumber || productCandidate?.pageNumber || 0) || null
    }
  }

  function getPageVariantHighlightBand(documentRecord, pageNumber) {
    const structureType = normalizeStructureType(appState.structureRouting?.structureType || appState.aiRerankResult?.structureType || "")
    const selection = getActiveVariantHighlightSelection()
    const isProductFamily = structureType === "product_family"
    const isModelCardSelected = appState.aiRerankResult?.choiceMode === "show_model_numbers" && selection?.modelCodes?.length
    if (!isProductFamily && !isModelCardSelected) {
      console.log("[getPageVariantHighlightBand] return:", null, { pageNumber, reason: "not_product_family_or_selected_model_card", structureType })
      return null
    }

    if (!selection?.modelCodes?.length) {
      console.log("[getPageVariantHighlightBand] return:", null, { pageNumber, reason: "no_selection", selection })
      return null
    }
    if (selection.pageNumber && Number(selection.pageNumber) !== Number(pageNumber)) {
      console.log("[getPageVariantHighlightBand] return:", null, { pageNumber, reason: "page_mismatch", selectionPageNumber: selection.pageNumber })
      return null
    }

    const renderKey = getPageRenderKey(documentRecord, pageNumber)
    const textContent = appState.pageRenderTextByKey[renderKey]
    const renderMetrics = appState.pageRenderMetricsByKey[renderKey]
    const items = Array.isArray(textContent?.items) ? textContent.items : []
    if (!items.length || !renderMetrics?.width || !renderMetrics?.height) {
      console.log("[getPageVariantHighlightBand] return:", null, { pageNumber, reason: "missing_render_metrics_or_items", renderKey, itemCount: items.length, renderMetrics })
      return null
    }

    const modelCodeSet = new Set(selection.modelCodes.map((code) => code.toLowerCase()))
    const pageHeight = Number(renderMetrics.height)
    const pageWidth = Number(renderMetrics.width)
    const modelAnchors = items
      .map((item) => {
        const itemText = normalizeText(item?.str || "")
        const codes = extractModelCodes(itemText)
        if (!itemText || !codes.length) return null
        const itemHeight = Math.max(12, Number(item?.height || 0) || 0)
        const y = Number(item?.transform?.[5] || 0)
        const top = pageHeight - y - itemHeight
        return {
          text: itemText,
          codes,
          top,
          bottom: top + itemHeight,
          center: top + (itemHeight / 2)
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.center - b.center)

    const matchedItems = items.filter((item) => {
      const itemText = normalizeText(item?.str || "")
      if (!itemText) return false
      const itemCodes = extractModelCodes(itemText).map((code) => code.toLowerCase())
      if (itemCodes.some((code) => modelCodeSet.has(code))) return true
      return selection.modelCodes.some((code) => itemText.toLowerCase().includes(code.toLowerCase()))
    })
    if (!matchedItems.length) {
      console.log("[getPageVariantHighlightBand] return:", null, { pageNumber, reason: "no_matched_items", modelCodes: selection.modelCodes })
      return null
    }

    const matchedAnchor = modelAnchors.find((anchor) =>
      anchor.codes.some((code) => modelCodeSet.has(code.toLowerCase()))
      || selection.modelCodes.some((code) => anchor.text.toLowerCase().includes(code.toLowerCase()))
    )

    let bandTop = 0
    let bandBottom = 0
    let anchorCenter = 0

    if (matchedAnchor && modelAnchors.length >= 2) {
      const anchorIndex = modelAnchors.findIndex((anchor) => anchor === matchedAnchor)
      const previousAnchor = anchorIndex > 0 ? modelAnchors[anchorIndex - 1] : null
      const nextAnchor = anchorIndex < modelAnchors.length - 1 ? modelAnchors[anchorIndex + 1] : null
      const distanceToPrevious = previousAnchor ? matchedAnchor.center - previousAnchor.center : (nextAnchor ? nextAnchor.center - matchedAnchor.center : pageHeight * 0.11)
      const distanceToNext = nextAnchor ? nextAnchor.center - matchedAnchor.center : distanceToPrevious
      const halfGapAbove = Math.max(28, distanceToPrevious * 0.54)
      const halfGapBelow = Math.max(42, distanceToNext * 0.54)
      bandTop = Math.max(0, matchedAnchor.center - halfGapAbove)
      bandBottom = Math.min(pageHeight, matchedAnchor.center + halfGapBelow)
      anchorCenter = matchedAnchor.center
    } else {
      const topPadding = Math.max(18, pageHeight * 0.014)
      const bottomPadding = Math.max(52, pageHeight * 0.055)
      let minTop = pageHeight
      let maxBottom = 0
      matchedItems.forEach((item) => {
        const y = Number(item?.transform?.[5] || 0)
        const itemHeight = Math.max(12, Number(item?.height || 0) || 0)
        const top = pageHeight - y - itemHeight
        const bottom = top + itemHeight
        minTop = Math.min(minTop, top)
        maxBottom = Math.max(maxBottom, bottom)
      })
      bandTop = Math.max(0, minTop - topPadding)
      const minimumBandHeight = Math.max(78, pageHeight * 0.085)
      bandBottom = Math.min(pageHeight, Math.max(maxBottom + bottomPadding, bandTop + minimumBandHeight))
      anchorCenter = bandTop + ((bandBottom - bandTop) / 2)
    }

    const pageVariantCount = getPageVariantCount(documentRecord, pageNumber)
    const rangeProfile = getVariantRangeProfile(pageVariantCount)
    const quantizedHeight = getPageRangeHeight(renderKey) ?? rangeProfile.heightPercent
    const normalizedCenter = pageHeight ? (anchorCenter / pageHeight) : 0.5
    const centeredTop = Math.max(0, Math.min(100 - quantizedHeight, (normalizedCenter * 100) - (quantizedHeight / 2)))
    const topOverride = getPageRangeTop(renderKey)
    const shiftedTop = topOverride !== null
      ? Math.max(0, Math.min(100 - quantizedHeight, topOverride))
      : Math.max(0, Math.min(100 - quantizedHeight, centeredTop + getPageRangeOffset(renderKey)))
    const quantizedTop = Math.round(shiftedTop * 10) / 10

    const result = {
      label: selection.label,
      rangeLabel: rangeProfile.rangeLabel,
      variantCount: pageVariantCount,
      topPercent: quantizedTop,
      heightPercent: quantizedHeight
    }
    console.log("[getPageVariantHighlightBand] return:", result, { pageNumber, selection })
    return result
  }

  function getSelectedCandidate(candidates, selectedId) {
    return (candidates || []).find((candidate) => normalizeText(candidate.id) === normalizeText(selectedId)) || null
  }

  function optionContainsSelectedAndSiblingModels(optionName, selectedModelCodes, siblingModelCodes) {
    const optionModels = extractModelCodes(optionName)
    if (!optionModels.length) return false
    const hasSelected = optionModels.some((code) => selectedModelCodes.has(code))
    const hasSibling = optionModels.some((code) => siblingModelCodes.has(code))
    return hasSelected && hasSibling
  }

  function relabelCombinedOptionForSelectedProduct(option, selectedCandidate, selectedModelCodes, siblingModelCodes) {
    const optionName = normalizeText(option?.name || "")
    if (!optionContainsSelectedAndSiblingModels(optionName, selectedModelCodes, siblingModelCodes)) {
      return option
    }

    const selectedLabel = normalizeText(selectedCandidate?.label || "")
    const selectedModelCode = extractModelCodes(selectedCandidate?.description || selectedCandidate?.label || selectedCandidate?.id || "")
      .find((code) => selectedModelCodes.has(code)) || [...selectedModelCodes][0] || ""

    return {
      ...option,
      name: selectedLabel || selectedModelCode || optionName
    }
  }

  function optionContainsSiblingModels(option, siblingModelCodes) {
    const optionModels = extractModelCodes(option?.name || "")
    if (!optionModels.length) return false
    return optionModels.some((code) => siblingModelCodes.has(code))
  }

  function optionMatchesVariant(option, tokens) {
    if (!tokens.length) return false
    const haystack = [
      option?.name,
      option?.values,
      option?.difference,
      option?.evidence
    ]
      .map((value) => normalizeText(value).toLowerCase())
      .join(" ")
    return tokens.some((token) => haystack.includes(token))
  }

  function filterCharacteristicsForSelectedRecord(characteristics, candidates, selectedId) {
    const selectedCandidate = getSelectedCandidate(candidates, selectedId)
    const selectedTokens = getSelectedCandidateMatchTokens(candidates, selectedId)
    const selectedModelCodes = new Set(extractModelCodes([
      selectedCandidate?.id,
      selectedCandidate?.label,
      selectedCandidate?.description
    ].filter(Boolean).join(" ")))
    const siblingTokens = (candidates || [])
      .filter((candidate) => normalizeText(candidate.id) !== normalizeText(selectedId))
      .flatMap((candidate) => [candidate.id, candidate.label, getProductCardModelCode(candidate)])
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
      .filter((value) => value.length >= 5 || /\b[a-z]{1,4}-\d{1,4}\b/i.test(value))
    const siblingModelCodes = new Set(
      (candidates || [])
        .filter((candidate) => normalizeText(candidate.id) !== normalizeText(selectedId))
        .flatMap((candidate) => extractModelCodes([candidate.id, candidate.label, candidate.description].filter(Boolean).join(" ")))
    )

    if (!selectedTokens.length) return characteristics || []

    return (characteristics || []).map((characteristic) => {
      const options = getCharacteristicOptions(characteristic)
      const relabeledOptions = options.map((option) =>
        relabelCombinedOptionForSelectedProduct(option, selectedCandidate, selectedModelCodes, siblingModelCodes)
      )
      const selectedMatches = relabeledOptions.filter((option) => optionMatchesVariant(option, selectedTokens))
      const siblingMatches = options.filter((option) => optionMatchesVariant(option, siblingTokens))
      if (!selectedMatches.length) return characteristic
      if (!siblingMatches.length) {
        return {
          ...characteristic,
          options: relabeledOptions
        }
      }

      const containsCombinedSharedOptions = relabeledOptions.some((option) =>
        optionContainsSelectedAndSiblingModels(option.name, selectedModelCodes, siblingModelCodes)
      )
      if (containsCombinedSharedOptions) {
        const sharedOptions = relabeledOptions.map((option) => ({
          ...option,
          name: normalizeText(selectedCandidate?.label || option.name || "Selected Product")
        }))
        return {
          ...characteristic,
          options: sharedOptions,
          blurb: normalizeText(characteristic?.blurb || "") || "Shared details that apply to the selected product."
        }
      }

      const filteredSelectedOnly = selectedMatches.filter((option) => !optionContainsSiblingModels(option, siblingModelCodes))
      if (filteredSelectedOnly.length) {
        return {
          ...characteristic,
          options: filteredSelectedOnly
        }
      }

      return {
        ...characteristic,
        options: selectedMatches
      }
    })
  }

  function filterCharacteristicsForSelectedVariant(characteristics, variantCandidates, selectedVariantId) {
    const selectedTokens = getVariantMatchTokens(variantCandidates, selectedVariantId)
    const siblingTokens = (variantCandidates || [])
      .filter((candidate) => normalizeText(candidate.id) !== normalizeText(selectedVariantId))
      .flatMap((candidate) => [candidate.id, candidate.label])
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)

    if (!selectedTokens.length) return characteristics || []

    return (characteristics || []).map((characteristic) => {
      const options = getCharacteristicOptions(characteristic)
      if (options.length < 2) return characteristic
      const selectedMatches = options.filter((option) => optionMatchesVariant(option, selectedTokens))
      const siblingMatches = options.filter((option) => optionMatchesVariant(option, siblingTokens))
      if (!selectedMatches.length || !siblingMatches.length) return characteristic
      return {
        ...characteristic,
        options: selectedMatches
      }
    })
  }

  function getSelectedProductDisplayLabel(decisionResult, structureRouting) {
    const selectedId = normalizeText(decisionResult?.selectedProductId || "")
    if (!selectedId) return ""
    const candidates = [
      ...(decisionResult?.productCandidates || []),
      ...(structureRouting?.productCandidates || [])
    ]
    const match = candidates.find((candidate) => normalizeText(candidate.id) === selectedId)
    return normalizeText(match?.label || selectedId)
  }

  function mergeComColIntoDimensions(characteristics) {
    const items = Array.isArray(characteristics) ? characteristics.map((item) => ({
      ...item,
      options: getCharacteristicOptions(item)
    })) : []
    const dimensionsIndex = items.findIndex((item) => /size|dimension/i.test(normalizeText(item.label)))
    if (dimensionsIndex === -1) return items

    const dimensions = { ...items[dimensionsIndex], options: [...items[dimensionsIndex].options] }
    const mergedIndexes = new Set()

    items.forEach((item, index) => {
      if (index === dimensionsIndex) return
      const normalizedLabel = normalizeText(item.label).toLowerCase()
      const isTextileRequirement = /\bcom\b|\bcol\b|customer'?s own leather|requirements/i.test(normalizedLabel)
      if (!isTextileRequirement) return
      mergedIndexes.add(index)

      const textileOptions = getCharacteristicOptions(item)
      textileOptions.forEach((textileOption) => {
        const textileName = normalizeText(textileOption.name).toLowerCase()
        const matchingDimension = dimensions.options.find((dimensionOption) => {
          const optionName = normalizeText(dimensionOption.name).toLowerCase()
          return textileName && optionName && (textileName.includes(optionName) || optionName.includes(textileName))
        })

        if (matchingDimension) {
          if (!normalizeText(matchingDimension.pricing) && normalizeText(textileOption.pricing)) {
            matchingDimension.pricing = textileOption.pricing
          }
          return
        }

        if (dimensions.options.length === 1 && textileOptions.length === 1 && !normalizeText(dimensions.options[0].pricing) && normalizeText(textileOption.pricing)) {
          dimensions.options[0].pricing = textileOption.pricing
        }
      })
    })

    return items
      .map((item, index) => (index === dimensionsIndex ? dimensions : item))
      .filter((_, index) => !mergedIndexes.has(index))
  }

  function removeTextileRequirementOptionsFromUpholstery(characteristics) {
    const items = Array.isArray(characteristics) ? characteristics.map((item) => ({
      ...item,
      options: getCharacteristicOptions(item)
    })) : []
    const hasDimensions = items.some((item) => /size|dimension/i.test(normalizeText(item.label)))
    if (!hasDimensions) return items

    return items
      .map((item) => {
        if (!/upholstery|material/i.test(normalizeText(item.label))) return item
        const filteredOptions = item.options.filter((option) => !/^(COM|COL)$/i.test(normalizeText(option.name)))
        return {
          ...item,
          options: filteredOptions
        }
      })
      .filter((item) => item.options.length >= 2 || /size|dimension|configuration/i.test(item.label))
  }

  function normalizeDecisionCharacteristics(items) {
    if (!Array.isArray(items)) return []
    return items
      .map((item, index) => {
        const label = normalizeText(item?.label || item?.name || `Characteristic ${index + 1}`)
        const compactLabel = isCompactCharacteristicLabel(label)
        return {
          id: normalizeText(item?.id || item?.key || item?.label || `characteristic-${index + 1}`),
          label,
          blurb: normalizeText(item?.blurb || item?.summary || ""),
          dependencyNote: normalizeText(item?.dependency_note || item?.dependencyNote || item?.note || ""),
          pricingNote: normalizeText(item?.pricing_note || item?.pricingNote || ""),
          configuration_sections: Array.isArray(item?.configuration_sections)
            ? item.configuration_sections
            : Array.isArray(item?.configurationSections)
              ? item.configurationSections
              : [],
          pricing_matrix: item?.pricing_matrix || item?.pricingMatrix || null,
          options: getCharacteristicOptions(item).map((option) => compactLabel
            ? { ...option, values: "", difference: "" }
            : option
          )
        }
      })
      .filter((item) => item.id && item.label)
      .filter((item) => {
        const normalizedLabel = item.label.toLowerCase()
        const looksPricingOnly = /base price|pricing|price list|order information/i.test(normalizedLabel)
        return !looksPricingOnly
      })
      .filter((item) => item.options.length >= 2 || /size|dimension|configuration/i.test(item.label))
  }

  function mapConfigurationSectionToCharacteristicLabel(sectionTitle) {
    const normalized = normalizeText(sectionTitle).toLowerCase()
    if (!normalized) return ""
    if (/shell finish|wood veneer|veneer/i.test(normalized)) return "Shell Finish"
    if (/base finish|frame finish|base\/frame finish|legs\/base/i.test(normalized)) return "Base / Frame Finish"
    if (/upholstery|fabric|material/i.test(normalized)) return "Upholstery / Fabric"
    return ""
  }

  function isDerivedNonStructuralConfigurationSection(sectionTitle) {
    return Boolean(mapConfigurationSectionToCharacteristicLabel(sectionTitle))
  }

  function isGenericConfigurationOptionName(name) {
    const normalized = normalizeText(name).toLowerCase()
    if (!normalized) return false
    return /^(shell|nonupholstered|upholstered|fully upholstered|exposed veneer shell|shell only|side chair shell)$/.test(normalized)
  }

  function splitOvergroupedConfiguration(characteristics) {
    const items = Array.isArray(characteristics) ? [...characteristics] : []
    const derivedCharacteristics = []

    const normalizedExistingLabels = new Set(items.map((item) => normalizeText(item.label).toLowerCase()))

    const nextItems = items
      .map((item) => {
        if (!/configuration/i.test(normalizeText(item.label)) || item.pricing_matrix || item.pricingMatrix) {
          return item
        }

        const rawSections = Array.isArray(item.configuration_sections)
          ? item.configuration_sections
          : Array.isArray(item.configurationSections)
            ? item.configurationSections
            : []

        if (!rawSections.length) return item

        const keptSections = []
        let derivedSectionCount = 0
        rawSections.forEach((section) => {
          const title = normalizeText(section?.title || section?.name || section?.label || "")
          const mappedLabel = mapConfigurationSectionToCharacteristicLabel(title)
          const sectionOptions = Array.isArray(section?.options)
            ? section.options.map((option) => normalizeText(option)).filter(Boolean)
            : []

          if (!mappedLabel) {
            keptSections.push(section)
            return
          }

          derivedSectionCount += 1

          if (!normalizedExistingLabels.has(mappedLabel.toLowerCase())) {
            derivedCharacteristics.push({
              id: slugify(mappedLabel, mappedLabel.toLowerCase()),
              label: mappedLabel,
              blurb: "",
              dependencyNote: "",
              pricingNote: "",
              options: sectionOptions.map((option) => ({
                name: option,
                values: "",
                pricing: "",
                difference: "",
                evidence: ""
              }))
            })
            normalizedExistingLabels.add(mappedLabel.toLowerCase())
          }
        })

        const nextItem = {
          ...item,
          configuration_sections: keptSections
        }

        const optionNames = getCharacteristicOptions(nextItem).map((option) => normalizeText(option.name)).filter(Boolean)
        const hasStructuralSections = keptSections.some((section) => !isDerivedNonStructuralConfigurationSection(section?.title || section?.name || section?.label || ""))
        const hasStructuralOptions = optionNames.some((name) => !/finish|veneer|upholstery|fabric|material/i.test(name) && !isGenericConfigurationOptionName(name))
        const onlyDerivedSectionsRemain = rawSections.length > 0 && derivedSectionCount === rawSections.length && !hasStructuralSections
        if (!nextItem.pricing_matrix && !nextItem.pricingMatrix && onlyDerivedSectionsRemain && !hasStructuralOptions) {
          return null
        }
        if (!nextItem.pricing_matrix && !nextItem.pricingMatrix && !keptSections.length && optionNames.length > 0 && optionNames.every((name) => isGenericConfigurationOptionName(name))) {
          return null
        }

        return nextItem
      })
      .filter(Boolean)
      .filter((item) => {
        if (!/configuration/i.test(normalizeText(item.label))) return true
        const sections = Array.isArray(item.configuration_sections) ? item.configuration_sections : []
        const options = getCharacteristicOptions(item)
        return Boolean(item.pricing_matrix || item.pricingMatrix || sections.length || options.length)
      })

    return [...nextItems, ...derivedCharacteristics]
  }

  function hasCharacteristicLabel(characteristics, pattern) {
    return (characteristics || []).some((item) => pattern.test(normalizeText(item?.label || "")))
  }

  function formatCompactSourceLabel(value, fallbackPageNumber = "") {
    const normalized = normalizeText(value)
    if (!normalized) return fallbackPageNumber ? `p. ${fallbackPageNumber}` : ""
    const pageMatch = normalized.match(/page\s+(\d+)/i)
    if (pageMatch) return `p. ${pageMatch[1]}`
    return fallbackPageNumber ? `p. ${fallbackPageNumber}` : normalized
  }

  function formatOptionPricingLabel(value) {
    const normalized = normalizeText(value)
    if (!normalized) return ""
    const quantityMatch = normalized.match(/\b(COM|COL)\b[^0-9]*?(\d+(?:\.\d+)?)\s*(sq ft|sqft|yd|yards?)\b/i)
    if (quantityMatch) {
      const unit = /sq\s*ft|sqft/i.test(quantityMatch[3]) ? "SqFt" : quantityMatch[3]
      return `${quantityMatch[1].toUpperCase()}: ${quantityMatch[2]} ${unit}`
    }
    return normalized
  }

  function getCompactOptionPricing(option) {
    const directPricing = formatOptionPricingLabel(option?.pricing || "")
    if (directPricing) return directPricing

    const valueText = normalizeText(option?.values || "")
    if (!valueText) return ""

    const textileMatch = valueText.match(/\b(COM|COL)\b[^0-9]*?(\d+(?:\.\d+)?)\s*(sq ft|sqft|yd|yards?)\b/i)
    if (textileMatch) {
      return formatOptionPricingLabel(textileMatch[0])
    }

    const priceMatch = valueText.match(/[$+][\d,]+(?:\.\d+)?/)
    if (priceMatch) return normalizeText(priceMatch[0])

    return ""
  }

  function extractTextileRequirementRows(value) {
    const normalized = normalizeText(value)
    if (!normalized) return []
    return [...normalized.matchAll(/\b(COM|COL)\b[^0-9]*?(\d+(?:\.\d+)?)\s*(sq ft|sqft|yd|yards?)\b/gi)]
      .map((match) => {
        const unit = /sq\s*ft|sqft/i.test(match[3]) ? "SqFt" : match[3]
        return `${match[1].toUpperCase()}: ${match[2]} ${unit}`
      })
  }

  function parseConfigurationDisplayRows(rawValueText) {
    return normalizeText(rawValueText)
      .split(/\s*;\s*|\n+/)
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .map((segment) => {
        let match = segment.match(/^(.+?):\s*([$+][\d,]+(?:\.\d+)?)\s*\[(EA\d+)\]$/i)
        if (match) {
          return {
            label: formatConfigurationDisplayLabel(match[1]),
            price: normalizeText(match[2]),
            model: normalizeText(match[3]).toUpperCase()
          }
        }
        match = segment.match(/^(.+?):\s*([$+][\d,]+(?:\.\d+)?)$/i)
        if (match) {
          return {
            label: formatConfigurationDisplayLabel(match[1]),
            price: normalizeText(match[2]),
            model: ""
          }
        }
        match = segment.match(/^([SF])\s+([$+][\d,]+(?:\.\d+)?)$/i)
        if (match) {
          return {
            label: formatConfigurationDisplayLabel(match[1]),
            price: normalizeText(match[2]),
            model: ""
          }
        }
        return {
          label: formatConfigurationDisplayLabel(segment),
          price: "",
          model: ""
        }
      })
      .filter((row) => row.label)
  }

  function parseConfigurationInlinePricing(rawPricingText) {
    return normalizeText(rawPricingText)
      .split(/\s*;\s*|\n+/)
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .map((segment) => {
        const parts = segment.split(/:\s+/)
        if (parts.length < 2) return null
        return {
          label: normalizeText(parts[0]),
          price: normalizeText(parts.slice(1).join(": "))
        }
      })
      .filter(Boolean)
  }

  function formatConfigurationDisplayLabel(value) {
    const normalized = normalizeText(value)
    if (!normalized) return ""
    if (/^(s\/f|swivel\/fixed)$/i.test(normalized)) return "Swivel / Fixed"
    if (/^s$/i.test(normalized)) return "Swivel"
    if (/^f$/i.test(normalized)) return "Fixed"
    return normalized
      .replace(/\bS\/F\b/gi, "Swivel / Fixed")
      .replace(/\bSwivel\b/gi, "Swivel")
      .replace(/\bFixed\b/gi, "Fixed")
      .replace(/\bEA\d+\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  }

  function getConfigurationMatchKey(value) {
    const formatted = formatConfigurationDisplayLabel(value)
    if (!formatted) return ""
    return formatted
      .toLowerCase()
      .replace(/\((?:s|f)\)/gi, "")
      .replace(/\bno swivel\b/gi, "fixed")
      .replace(/\bfixed base\b/gi, "fixed")
      .replace(/\bswivel base\b/gi, "swivel")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  }

  function parseConfigurationMatrix(rawPricingText) {
    const normalized = String(rawPricingText || "")
    if (!/rows?\s*:|columns?\s*:|cells?\s*:/i.test(normalized)) return null

    const rowsMatch = normalized.match(/rows?\s*:\s*([\s\S]*?)(?=columns?\s*:|cells?\s*:|$)/i)
    const columnsMatch = normalized.match(/columns?\s*:\s*([\s\S]*?)(?=cells?\s*:|$)/i)
    const cellsMatch = normalized.match(/cells?\s*:\s*([\s\S]*)$/i)

    const rows = normalizeText(rowsMatch?.[1] || "")
      .split(/\s*\|\s*|\s*;\s*/)
      .map((item) => normalizeText(item))
      .filter(Boolean)
    const columns = normalizeText(columnsMatch?.[1] || "")
      .split(/\s*\|\s*|\s*;\s*/)
      .map((item) => normalizeText(item))
      .filter(Boolean)
    const cells = new Map()

    normalizeText(cellsMatch?.[1] || "")
      .split(/\s*;\s*/)
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .forEach((entry) => {
        const cellMatch = entry.match(/(.+?)\s*[x/]\s*(.+?)\s*(?:=|:)\s*(.+)$/i)
        if (!cellMatch) return
        const rowKey = normalizeText(cellMatch[1]).toLowerCase()
        const columnKey = normalizeText(cellMatch[2]).toLowerCase()
        const price = normalizeText(cellMatch[3])
        cells.set(`${rowKey}:::${columnKey}`, price)
      })

    if (!rows.length || !columns.length || !cells.size) return null
    return { rows, columns, cells }
  }

  function sortCharacteristicsForDisplay(characteristics) {
    const items = Array.isArray(characteristics) ? [...characteristics] : []
    const sizeItems = items.filter((item) => /size|dimension/i.test(normalizeText(item.label)))
    const remaining = items.filter((item) => !/size|dimension/i.test(normalizeText(item.label)))
    return [...sizeItems, ...remaining]
  }

  function buildVariantTokenSet(variantCandidates, selectedVariantId) {
    const selectedTokens = getVariantMatchTokens(variantCandidates, selectedVariantId)
    return new Set(selectedTokens)
  }

  function measurementMatchesSelectedVariant(measurement, variantTokenSet) {
    if (!variantTokenSet?.size) return true
    const variantValue = normalizeText(measurement?.variant || "").toLowerCase()
    if (!variantValue) return true
    for (const token of variantTokenSet) {
      if (variantValue.includes(token) || token.includes(variantValue)) return true
    }
    return false
  }

  async function fillMissingDimensionOptions(documentRecord, includedPages, characteristics, variantCandidates, selectedVariantId) {
    const items = Array.isArray(characteristics) ? characteristics.map((item) => ({
      ...item,
      options: getCharacteristicOptions(item)
    })) : []
    const dimensionIndex = items.findIndex((item) => /size|dimension/i.test(normalizeText(item.label)))
    if (dimensionIndex === -1) return items
    if (items[dimensionIndex].options.length) return items

    const variantTokenSet = buildVariantTokenSet(variantCandidates, selectedVariantId)
    const groupedMeasurements = new Map()
    let fallbackSummary = ""

    for (const page of includedPages || []) {
      const canvas = await renderPdfPageToCanvas(documentRecord, page.pageNumber, 1.25)
      const result = await analyzeDimensionsWithVision(page.pageNumber, canvas)
      const measurements = Array.isArray(result?.analysis?.measurements) ? result.analysis.measurements : []
      if (!measurements.length) continue
      fallbackSummary = fallbackSummary || normalizeText(result.analysis?.summary || "")
      measurements
        .filter((measurement) => measurementMatchesSelectedVariant(measurement, variantTokenSet))
        .forEach((measurement) => {
          const variantLabel = normalizeText(measurement.variant || "") || "Dimensions"
          if (!groupedMeasurements.has(variantLabel)) {
            groupedMeasurements.set(variantLabel, {
              name: variantLabel === "Dimensions" ? "Dimensions" : titleCaseWords(variantLabel),
              values: [],
              pricing: "",
              difference: "",
              evidence: `Detected on page ${page.pageNumber}`
            })
          }
          const entry = groupedMeasurements.get(variantLabel)
          const label = normalizeText(measurement.label || "")
          const value = normalizeText(measurement.value || "")
          if (label && value) {
            entry.values.push(`${label}: ${value}`)
          }
        })
      if (groupedMeasurements.size) break
    }

    if (!groupedMeasurements.size) return items

    items[dimensionIndex] = {
      ...items[dimensionIndex],
      blurb: items[dimensionIndex].blurb || fallbackSummary,
      options: [...groupedMeasurements.values()].map((option) => ({
        ...option,
        values: option.values.join("; ")
      }))
    }
    return items
  }

  function mergeReferenceTextileIntoDimensions(characteristics, referenceInfo) {
    const items = Array.isArray(characteristics) ? characteristics.map((item) => ({
      ...item,
      options: getCharacteristicOptions(item)
    })) : []
    const dimensionsIndex = items.findIndex((item) => /size|dimension/i.test(normalizeText(item.label)))
    if (dimensionsIndex === -1) return items

    const textileRows = (referenceInfo || [])
      .flatMap((entry) => extractTextileRequirementRows(entry))
      .filter(Boolean)
    if (!textileRows.length) return items

    const dimensions = { ...items[dimensionsIndex], options: [...items[dimensionsIndex].options] }
    if (!dimensions.options.length) return items

    const existingPricingRows = dimensions.options[0].pricing
      ? extractTextileRequirementRows(dimensions.options[0].pricing)
      : []
    const mergedRows = [...new Set([...existingPricingRows, ...textileRows])]
    if (!mergedRows.length) return items

    dimensions.options[0] = {
      ...dimensions.options[0],
      pricing: mergedRows.join("; ")
    }

    return items.map((item, index) => (index === dimensionsIndex ? dimensions : item))
  }

  function extractOptionPricingFromText(text, optionName) {
    const normalizedOption = normalizeText(optionName)
    if (!normalizedOption) return ""

    const lines = String(text || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)

    const normalizedSearchTerms = [...new Set([
      normalizedOption,
      normalizedOption.replace(/^[A-Z0-9]+\s+/, ""),
      normalizedOption.replace(/\([^)]*\)/g, ""),
      normalizedOption.replace(/^[A-Z0-9]+\s+/, "").replace(/\([^)]*\)/g, "")
    ].map((value) => normalizeText(value)).filter((value) => value.length >= 3))]
    const codeMatch = normalizedOption.match(/\(([A-Z0-9]{1,4})\)|\b([A-Z0-9]{1,4})$/i)
    const optionCode = normalizeText(codeMatch?.[1] || codeMatch?.[2] || "").toUpperCase()
    const plainLabel = normalizedSearchTerms[normalizedSearchTerms.length - 1] || normalizedOption
    const reversedSearchTerms = optionCode && plainLabel
      ? [`${optionCode} ${plainLabel}`, `${plainLabel} ${optionCode}`]
      : []
    const allSearchTerms = [...new Set([...normalizedSearchTerms, ...reversedSearchTerms].map((value) => normalizeText(value)).filter((value) => value.length >= 2))]

    const extractPriceFromCandidate = (candidateLine) => {
      const dollarMatch = candidateLine.match(/[+\-]?\$[\d,]+(?:\.\d+)?(?:\s*(?:ea|each|list|net))?/i)
      if (dollarMatch) return normalizeText(dollarMatch[0])

      const upchargeMatch = candidateLine.match(/(?:upcharge|add|added|premium|list price|price)\s*[:\-]?\s*([+\-]?\$[\d,]+(?:\.\d+)?(?:\s*(?:ea|each|sq ft))?)/i)
      if (upchargeMatch) return `${candidateLine.match(/upcharge|add|added|premium|list price|price/i)?.[0] || "Price"} ${normalizeText(upchargeMatch[1])}`

      const textileMatch = candidateLine.match(/\b(?:COM|COL)\b[^.;]*?\b\d+(?:\.\d+)?\s*(?:sq ft|yd|yards?)\b/i)
      if (textileMatch) return textileMatch[0]

      return ""
    }

    const fullText = normalizeText(text)
    if (fullText) {
      for (const term of allSearchTerms) {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const forwardPattern = new RegExp(`${escapedTerm}[^$+\\-]{0,80}([+\\-]?\\$[\\d,]+(?:\\.\\d+)?)`, "i")
        const backwardPattern = new RegExp(`([+\\-]?\\$[\\d,]+(?:\\.\\d+)?)[^$+\\-]{0,80}${escapedTerm}`, "i")
        const forwardMatch = fullText.match(forwardPattern)
        if (forwardMatch?.[1]) return normalizeText(forwardMatch[1])
        const backwardMatch = fullText.match(backwardPattern)
        if (backwardMatch?.[1]) return normalizeText(backwardMatch[1])
      }

      if (optionCode) {
        const compactCodePattern = new RegExp(`\\b${optionCode}\\b[^$+\\-]{0,40}([+\\-]?\\$[\\d,]+(?:\\.\\d+)?)`, "i")
        const compactCodeMatch = fullText.match(compactCodePattern)
        if (compactCodeMatch?.[1]) return normalizeText(compactCodeMatch[1])
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const loweredLine = line.toLowerCase()
      const matchesOption = allSearchTerms.some((term) => loweredLine.includes(term.toLowerCase()))
      if (!matchesOption) continue

      const candidateLines = [
        line,
        lines[index + 1] || "",
        lines[index + 2] || "",
        lines[index - 1] || ""
      ].filter(Boolean)

      for (const candidateLine of candidateLines) {
        const price = extractPriceFromCandidate(candidateLine)
        if (price) return price
      }
    }

    return ""
  }

  function getCharacteristicSearchTerms(characteristicLabel, optionName) {
    const normalizedLabel = normalizeText(characteristicLabel)
    const normalizedOption = normalizeText(optionName)
    const strippedOption = normalizeText(normalizedOption.replace(/^[A-Z0-9]+\s+/, "").replace(/\([^)]*\)/g, ""))
    const codeMatch = normalizedOption.match(/\(([A-Z0-9]{1,4})\)|\b([A-Z0-9]{1,4})$/i)
    const optionCode = normalizeText(codeMatch?.[1] || codeMatch?.[2] || "").toUpperCase()
    const terms = [normalizedOption, strippedOption]

    if (optionCode && strippedOption) {
      terms.push(`${optionCode} ${strippedOption}`, `${strippedOption} ${optionCode}`, optionCode)
    }

    if (/shell finish/i.test(normalizedLabel)) {
      terms.push(`${normalizedOption} shell finish`, `${strippedOption} shell finish`, `${normalizedOption} veneer`, `${strippedOption} veneer`)
    }
    if (/base|frame finish/i.test(normalizedLabel)) {
      terms.push(`${normalizedOption} base finish`, `${strippedOption} base finish`, `${normalizedOption} frame finish`, `${strippedOption} frame finish`)
    }

    return [...new Set(terms.map((term) => normalizeText(term)).filter((term) => term.length >= 3))]
  }

  function extractDetailedUpholsteryOptionsFromText(text, pageNumber) {
    const options = new Map()
    String(text || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .forEach((line) => {
        const match = line.match(/^Price Category\s+(.+?)\s+([$+][\d,]+(?:\.\d+)?)$/i)
        if (!match) return
        const rawLabel = normalizeText(match[1])
        const price = normalizeText(match[2])
        const optionName = /^(\d+|[A-Z])$/.test(rawLabel)
          ? `Category ${rawLabel}`
          : /^COM|COL$/i.test(rawLabel)
            ? rawLabel.toUpperCase()
            : `Category ${rawLabel}`
        options.set(optionName, {
          name: optionName,
          values: "",
          pricing: price,
          difference: "",
          evidence: `Detected on page ${pageNumber}`
        })
      })
    return options
  }

  function shouldReplaceWithDetailedUpholstery(options) {
    const names = (options || []).map((option) => normalizeText(option.name).toLowerCase())
    if (!names.length) return true
    return names.every((name) => /standard categories|material options|fabric price category|price categories|^com$|^col$/.test(name))
  }

  function extractSupplementalFinishOptionsFromText(text, pageNumber) {
    const shellOptions = new Map()
    const baseFrameOptions = new Map()
    const lines = String(text || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)

    const addOption = (map, name, pricing = "") => {
      const key = normalizeText(name)
      if (!key) return
      map.set(key, {
        name: key,
        values: "",
        pricing: normalizeText(pricing),
        difference: "",
        evidence: `Detected on page ${pageNumber}`
      })
    }

    lines.forEach((line) => {
      let match = line.match(/^(?:-)?([A-Z0-9]{1,4})\s+(.+?)\s+([+\-]?\$[\d,]+(?:\.\d+)?)$/i)
      if (match) {
        const code = normalizeText(match[1]).toUpperCase()
        const label = titleCaseWords(match[2])
        const price = normalizeText(match[3])
        if (/black|chrome|powder coat|metal/i.test(label)) {
          addOption(baseFrameOptions, `${label} (${code})`, price)
          return
        }
        addOption(shellOptions, `${label} (${code})`, price)
        return
      }

      match = line.match(/^(?:-)?([A-Z0-9]{1,4})\s+(.+)$/i)
      if (!match) return
      const code = normalizeText(match[1]).toUpperCase()
      const label = normalizeText(match[2])
      if (!label || /^(list price|grades|com\/col|item|description)$/i.test(label)) return

      const pricing = extractOptionPricingFromText(text, `${label} (${code})`) || extractOptionPricingFromText(text, `${code} ${label}`)
      if (/black|chrome|powder coat|metal/i.test(label)) {
        addOption(baseFrameOptions, `${titleCaseWords(label)} (${code})`, pricing)
        return
      }
      if (/oak|walnut|ash|ebony|palisander|stain|paint|veneer/i.test(label)) {
        addOption(shellOptions, `${titleCaseWords(label)} (${code})`, pricing)
      }
    })

    return {
      shellOptions,
      baseFrameOptions
    }
  }

  function extractConfigurationComboPrices(text) {
    const normalizedLines = String(text || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)
    const armCodeMap = new Map()
    const baseCodeMap = new Map()
    let prefix = ""

    normalizedLines.forEach((line) => {
      const prefixMatch = line.match(/\b(EA\d+)\b/i)
      if (prefixMatch && !prefix) {
        const raw = prefixMatch[1].toUpperCase()
        prefix = raw.length > 3 ? raw.slice(0, -1) : raw
      }
      const armMatch = line.match(/^(\d+)\s+(no arms|arms with arm pads|arms)$/i)
      if (armMatch) {
        armCodeMap.set(normalizeText(armMatch[2]).toLowerCase(), armMatch[1])
      }
      const baseMatch = line.match(/^([SF])\s+(swivel base|fixed base(?:,\s*no swivel)?)$/i)
      if (baseMatch) {
        baseCodeMap.set(normalizeText(baseMatch[2]).toLowerCase(), baseMatch[1].toUpperCase())
        if (/fixed/i.test(baseMatch[2])) baseCodeMap.set("fixed base", baseMatch[1].toUpperCase())
        if (/swivel/i.test(baseMatch[2])) baseCodeMap.set("swivel base", baseMatch[1].toUpperCase())
      }
    })

    const priceMap = new Map()
    normalizedLines.forEach((line) => {
      const priceMatch = line.match(/\b(EA\d+)\b\s+([SF])\s+([$+][\d,]+(?:\.\d+)?)$/i)
      if (!priceMatch) return
      priceMap.set(`${priceMatch[1].toUpperCase()}:::${priceMatch[2].toUpperCase()}`, normalizeText(priceMatch[3]))
    })

    return { prefix, armCodeMap, baseCodeMap, priceMap }
  }

  function buildConfigurationMatrixFromSignals(configSignals, fallbackOptions = []) {
    const armEntries = [...configSignals.armCodeMap.entries()]
      .map(([label, code]) => ({ label: formatConfigurationDisplayLabel(label), code }))
    const baseEntries = [
      { label: "Swivel", code: configSignals.baseCodeMap.get("swivel base") || "" },
      { label: "Fixed", code: configSignals.baseCodeMap.get("fixed base") || "" }
    ].filter((entry) => entry.code)

    if (!armEntries.length || !baseEntries.length || !configSignals.prefix || !configSignals.priceMap.size) {
      return null
    }

    const rows = armEntries
      .map((arm) => {
        const model = `${configSignals.prefix}${arm.code}`
        const cells = baseEntries
          .map((base) => ({
            column: base.label,
            price: configSignals.priceMap.get(`${model}:::${base.code}`) || "",
            model
          }))
          .filter((cell) => cell.price)
        return {
          row_name: arm.label,
          cells
        }
      })
      .filter((row) => row.cells.length)

    if (!rows.length) return null

    const configurationSections = armEntries.length
      ? [{ title: "Arms", options: armEntries.map((entry) => entry.label) }, { title: "Base Type", options: baseEntries.map((entry) => entry.label) }]
      : fallbackOptions

    return {
      sections: configurationSections,
      matrix: {
        row_label: "Arm Type",
        column_labels: baseEntries.map((entry) => entry.label),
        rows
      }
    }
  }

  function enrichCharacteristicsFromSectionPages(characteristics, sectionPages) {
    const items = Array.isArray(characteristics) ? characteristics.map((item) => ({
      ...item,
      options: getCharacteristicOptions(item)
    })) : []
    const combinedText = (sectionPages || []).map((page) => getPageCombinedText(page)).join("\n")
    const configSignals = extractConfigurationComboPrices(combinedText)

    return items.map((item) => {
      const normalizedLabel = normalizeText(item.label).toLowerCase()

      if (/upholstery|material/i.test(normalizedLabel)) {
        const detailedOptions = new Map()
        ;(sectionPages || []).forEach((page) => {
          const pageOptions = extractDetailedUpholsteryOptionsFromText(getPageCombinedText(page), page.pageNumber)
          pageOptions.forEach((value, key) => detailedOptions.set(key, value))
        })
        if (detailedOptions.size >= 4 && shouldReplaceWithDetailedUpholstery(item.options)) {
          return {
            ...item,
            options: [...detailedOptions.values()]
          }
        }
      }

      if (/configuration/i.test(normalizedLabel)) {
        const fallbackSections = item.options.length
          ? [
              {
                title: "Arms",
                options: item.options.map((option) => formatConfigurationDisplayLabel(option.name))
              }
            ]
          : []
        const builtMatrix = buildConfigurationMatrixFromSignals(configSignals, fallbackSections)
        const enrichedOptions = item.options.map((option) => {
          const optionName = normalizeText(option.name).toLowerCase()
          const armCode = configSignals.armCodeMap.get(optionName)
          if (armCode && configSignals.baseCodeMap.size && configSignals.prefix) {
            const comboRows = []
            ;[
              ["swivel base", "Swivel"],
              ["fixed base", "Fixed"]
            ].forEach(([lookupLabel, displayLabel]) => {
              const baseCode = configSignals.baseCodeMap.get(lookupLabel)
              if (!baseCode) return
              const model = `${configSignals.prefix}${armCode}`
              const price = configSignals.priceMap.get(`${model}:::${baseCode}`)
              if (!price) return
              comboRows.push(`${displayLabel}: ${price} [${model}]`)
            })
            if (comboRows.length) {
              return {
                ...option,
                values: comboRows.join("; "),
                pricing: ""
              }
            }
          }
          if (normalizeText(option.pricing)) return option
          const parts = normalizeText(option.name).split(/\s*\/\s*/)
          if (parts.length !== 2) return option
          const armLabel = parts[0].toLowerCase()
          const baseLabel = parts[1].toLowerCase()
          const armComboCode = configSignals.armCodeMap.get(armLabel)
          const baseCode = configSignals.baseCodeMap.get(baseLabel)
          if (!armComboCode || !baseCode || !configSignals.prefix) return option
          const model = `${configSignals.prefix}${armComboCode}`
          const price = configSignals.priceMap.get(`${model}:::${baseCode}`)
          return price ? { ...option, pricing: price, values: `${formatConfigurationDisplayLabel(baseLabel)}: ${price} [${model}]` } : option
        })
        return {
          ...item,
          options: enrichedOptions,
          configuration_sections: builtMatrix?.sections || item.configuration_sections || item.configurationSections || [],
          pricing_matrix: builtMatrix?.matrix || item.pricing_matrix || item.pricingMatrix || null
        }
      }

      if (/shell finish|frame finish|base finish|wood finish|finish/i.test(normalizedLabel)) {
        const enrichedOptions = item.options.map((option) => {
          if (normalizeText(option.pricing)) return option
          const pricing = (sectionPages || [])
            .map((page) => {
              const pageText = getPageCombinedText(page)
              const searchTerms = getCharacteristicSearchTerms(item.label, option.name)
              return searchTerms
                .map((term) => extractOptionPricingFromText(pageText, term))
                .find(Boolean) || ""
            })
            .find(Boolean)
          return pricing ? { ...option, pricing } : option
        })

        return {
          ...item,
          options: enrichedOptions
        }
      }

      return item
    })
  }

  function buildSupplementalCharacteristics(documentRecord, sectionPages, characteristics) {
    const supplemental = []
    const existing = characteristics || []
    const shellFinishOptions = new Map()
    const baseFrameFinishOptions = new Map()
    const upholsteryOptions = new Map()

    ;(sectionPages || []).forEach((page) => {
      const text = getPageCombinedText(page)
      const signals = extractPageThemeSignals(text, documentRecord, page.pageNumber)
      const extractedFinishOptions = extractSupplementalFinishOptionsFromText(text, page.pageNumber)

      signals.finishLabels.forEach((label) => {
        const key = normalizeText(label)
        if (!key) return
        shellFinishOptions.set(key, {
          name: key.replace(/\s+Finish$/i, ""),
          values: "",
          pricing: extractOptionPricingFromText(text, key) || extractOptionPricingFromText(text, key.replace(/\s+Finish$/i, "")),
          difference: "",
          evidence: `Detected on page ${page.pageNumber}`
        })
      })
      extractedFinishOptions.shellOptions.forEach((value, key) => shellFinishOptions.set(key, value))
      extractedFinishOptions.baseFrameOptions.forEach((value, key) => baseFrameFinishOptions.set(key, value))

      const categoryMatches = text.match(/\b(?:COM|COL|Category\s+\d+|Category\s+[A-Z])\b/gi) || []
      categoryMatches.forEach((match) => {
        const key = normalizeText(match).replace(/\s+/g, " ")
        if (!key) return
        upholsteryOptions.set(key, {
          name: key.toUpperCase().startsWith("CATEGORY") ? titleCaseWords(key) : key.toUpperCase(),
          values: "",
          pricing: extractOptionPricingFromText(text, key),
          difference: "",
          evidence: `Detected on page ${page.pageNumber}`
        })
      })

      if (signals.hasUpholstery && !upholsteryOptions.size) {
        upholsteryOptions.set("Material Options", {
          name: "Material Options",
          values: "",
          pricing: "",
          difference: "",
          evidence: `Upholstery signals detected on page ${page.pageNumber}`
        })
      }
    })

    if (!hasCharacteristicLabel(existing, /shell finish|wood finish/i) && shellFinishOptions.size >= 2) {
      supplemental.push({
        id: "shell-finish",
        label: "Shell Finish",
        blurb: "Finish options detected across the pages gathered for this product or family.",
        dependencyNote: "",
        pricingNote: "",
        options: [...shellFinishOptions.values()]
      })
    }

    if (!hasCharacteristicLabel(existing, /base finish|frame finish|base \/ frame finish/i) && baseFrameFinishOptions.size >= 2) {
      supplemental.push({
        id: "base-frame-finish",
        label: "Base / Frame Finish",
        blurb: "Base or frame finish options detected across the pages gathered for this product or family.",
        dependencyNote: "",
        pricingNote: "",
        options: [...baseFrameFinishOptions.values()]
      })
    }

    if (!hasCharacteristicLabel(existing, /upholstery|material/i) && upholsteryOptions.size >= 2) {
      supplemental.push({
        id: "upholstery-material",
        label: "Upholstery / Material",
        blurb: "Upholstery or material-related options detected across the pages gathered for this product or family.",
        dependencyNote: "",
        pricingNote: "",
        options: [...upholsteryOptions.values()]
      })
    }

    return supplemental
  }

  function buildAttributesFromText(rawAttributes) {
    const labels = rawAttributes
      .split(/\n|,/)
      .map((item) => normalizeText(item))
      .filter(Boolean)

    return labels.map((label, index) => ({
      key: slugify(label, `field-${index + 1}`),
      label,
      type: getAttributeType(label),
      value: "",
      confidence: 0,
      status: "idle",
      sourceStage: "",
      evidenceSnippet: "",
      sourceDocTitle: ""
    }))
  }

  function syncSpecFromDraft() {
    const draft = appState.inputDraft
    const attributes = buildAttributesFromText(draft.attributes)
    if (!attributes.length) return false

    const existingByKey = new Map((appState.spec?.attributes || []).map((attribute) => [attribute.key, attribute]))
    appState.errorMessage = ""
    appState.spec = {
      originalSpecName: normalizeText(draft.productName),
      specDisplayName: normalizeText(draft.productName),
      originalBrand: normalizeText(draft.brandName),
      brandDisplayName: normalizeText(draft.brandName),
      category: normalizeText(draft.category),
      attributes: attributes.map((attribute) => {
        const existing = existingByKey.get(attribute.key)
        return existing
          ? {
              ...attribute,
              value: existing.value || "",
              confidence: Number(existing.confidence || 0),
              status: existing.status || "idle",
              sourceStage: existing.sourceStage || "",
              evidenceSnippet: existing.evidenceSnippet || "",
              sourceDocTitle: existing.sourceDocTitle || ""
            }
          : attribute
      })
    }
    return true
  }

  function resetAttributeExtractionState(options = {}) {
    const clearValues = options.clearValues === true
    appState.spec.attributes = appState.spec.attributes.map((attribute) => ({
      ...attribute,
      value: clearValues ? "" : attribute.value,
      confidence: 0,
      status: "idle",
      sourceStage: "",
      evidenceSnippet: "",
      sourceDocTitle: ""
    }))
  }

  function applyAttributeExtractionResult(extraction, options = {}) {
    const shouldPopulateValues = options.populateValues !== false
    const attributesById = new Map((extraction?.attributes || []).map((attribute) => [attribute.attributeId, attribute]))

    appState.spec.attributes = appState.spec.attributes.map((attribute) => {
      const result = attributesById.get(attribute.key)
      if (!result) {
        return {
          ...attribute,
          value: shouldPopulateValues ? "" : attribute.value,
          confidence: 0,
          status: "not_found",
          sourceStage: extraction?.stage || "webpage",
          evidenceSnippet: "",
          sourceDocTitle: ""
        }
      }

      const evidence = Array.isArray(result.evidence) ? result.evidence[0] : null
      const forcedStatus = extraction?.outcome === "ambiguous" ? "ambiguous" : result.status || "not_found"
      const nextValue = result.status === "filled" && shouldPopulateValues ? normalizeText(result.value) : shouldPopulateValues ? "" : attribute.value
      return {
        ...attribute,
        value: nextValue,
        confidence: Number(result.confidence || 0),
        status: forcedStatus,
        sourceStage: result.sourceStage || extraction?.stage || "webpage",
        evidenceSnippet: normalizeText(evidence?.snippet || ""),
        sourceDocTitle: normalizeText(result.sourceDocTitle || evidence?.docTitle || "")
      }
    })
  }

  function buildDecisionAssistAttributeExtraction(decisionResult) {
    if (!decisionResult || !Array.isArray(decisionResult.characteristics) || !decisionResult.characteristics.length) {
      return null
    }

    const sourceDocTitle = normalizeText(getActiveDocument()?.title || "")
    const selectedVariant = getSelectedCandidate(decisionResult.variantCandidates, decisionResult.selectedVariantId || "")
    const selectedProduct = getSelectedCandidate(decisionResult.productCandidates, decisionResult.selectedProductId || "")
    const selectedDescription = normalizeText([
      selectedVariant?.description || "",
      selectedProduct?.description || "",
      decisionResult.summary || ""
    ].filter(Boolean).join(" | "))

    const dimensionsCharacteristic = decisionResult.characteristics.find((item) => /size|dimension/i.test(normalizeText(item?.label || "")))
    const parsedDimensionLines = (getCharacteristicOptions(dimensionsCharacteristic) || [])
      .flatMap((option) => parseOptionValueLines(option.values || ""))

    const findDimensionValue = (...patterns) => {
      const match = parsedDimensionLines.find((line) => {
        const label = normalizeText(line.label || "")
        return patterns.some((pattern) => pattern.test(label))
      })
      return normalizeText(match?.value || "")
    }

    const extractBaseValue = () => {
      const source = normalizeText(selectedDescription)
      if (!source) return ""
      const match = source.match(/\b([a-z][a-z\s/-]{0,40}\sbase)\b/i)
      return normalizeText(match?.[1] || "")
    }

    const extractBodyFrameValue = () => {
      const source = normalizeText(selectedDescription)
      if (!source) return ""
      const baseValue = extractBaseValue()
      const cleaned = normalizeText(
        baseValue
          ? source.replace(new RegExp(baseValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
          : source
      ).replace(/^[,|]\s*|\s*[,|]$/g, "")
      return cleaned
    }

    const attributeResults = [
      {
        attributeId: "width",
        label: "Width",
        value: findDimensionValue(/\boverall width\b/i, /\bwidth\b/i, /\b(?:^|[^a-z])w(?:$|[^a-z])\b/i)
      },
      {
        attributeId: "length",
        label: "Length",
        value: findDimensionValue(/\boverall depth\b/i, /\bdepth\b/i, /\b(?:^|[^a-z])d(?:$|[^a-z])\b/i, /\blength\b/i)
      },
      {
        attributeId: "overall-height",
        label: "Overall Height",
        value: findDimensionValue(/\boverall height\b/i, /\bheight\b/i, /\b(?:^|[^a-z])h(?:$|[^a-z])\b/i)
      },
      {
        attributeId: "seat-height",
        label: "Seat Height",
        value: findDimensionValue(/\bseat height\b/i, /\b(?:^|[^a-z])sh(?:$|[^a-z])\b/i)
      },
      {
        attributeId: "arm-height",
        label: "Arm Height",
        value: findDimensionValue(/\barm height\b/i, /\b(?:^|[^a-z])ah(?:$|[^a-z])\b/i)
      },
      {
        attributeId: "body-frame",
        label: "Body/Frame",
        value: extractBodyFrameValue()
      },
      {
        attributeId: "legs-base",
        label: "Legs/Base",
        value: extractBaseValue()
      }
    ].map((item) => {
      const value = normalizeText(item.value || "")
      return {
        attributeId: item.attributeId,
        label: item.label,
        value: value || null,
        confidence: value ? (/height|width|length/i.test(item.label) ? 0.92 : 0.78) : 0,
        status: value ? "filled" : "not_found",
        sourceStage: "pdf",
        sourceDocTitle,
        evidence: value
          ? [{
              sourceType: "pdf",
              snippet: value,
              docTitle: sourceDocTitle
            }]
          : []
      }
    })

    const filledCount = attributeResults.filter((item) => item.status === "filled").length
    return {
      stage: "pdf",
      outcome: filledCount ? "completed" : "needs_pdf_escalation",
      attributes: attributeResults
    }
  }

  function buildAttributeExtractionFromReadableSummary(summaryHtml) {
    const summaryText = normalizeText(String(summaryHtml || "").replace(/<[^>]+>/g, " "))
    if (!summaryText) return null

    const sourceDocTitle = normalizeText(getActiveDocument()?.title || "")
    const dimensionsBlockMatch = summaryText.match(/\bDimensions(?:\s*\([^)]+\))?\s*:\s*([^|]+?)(?=\s+(?:Grade|Fabric|Pricing|Finish|Base|Description)\b|$)/i)
    const dimensionsBlock = normalizeText(dimensionsBlockMatch?.[1] || "")
    const findCompactDimension = (token) => {
      if (!dimensionsBlock) return ""
      const match = dimensionsBlock.match(new RegExp(`\\b${token}\\b\\s*:??\\s*([^,;]+)`, "i"))
      return normalizeText(match?.[1] || "")
    }
    const findValue = (patterns) => {
      for (const pattern of patterns) {
        const match = summaryText.match(pattern)
        if (match?.[1]) return normalizeText(match[1])
      }
      return ""
    }

    const width = findValue([/\b(?:Width|W)\s*(?:\([^)]+\))?\s*:\s*([^;|,]+(?:".*?)?)(?=\s+(?:Depth|D|Height|H|Seat Height|SH|Arm Height|AH|Grade|Fabric)\b|$)/i]) || findCompactDimension("W")
    const depth = findValue([/\b(?:Depth|D|Length)\s*(?:\([^)]+\))?\s*:\s*([^;|,]+(?:".*?)?)(?=\s+(?:Height|H|Seat Height|SH|Arm Height|AH|Grade|Fabric)\b|$)/i]) || findCompactDimension("D")
    const height = findValue([/\b(?:Height|H|Overall Height)\s*(?:\([^)]+\))?\s*:\s*([^;|,]+(?:".*?)?)(?=\s+(?:Seat Height|SH|Arm Height|AH|Grade|Fabric)\b|$)/i]) || findCompactDimension("H")
    const seatHeight = findValue([/\b(?:Seat Height|SH)\s*(?:\([^)]+\))?\s*:\s*([^;|,]+(?:".*?)?)(?=\s+(?:Arm Height|AH|Grade|Fabric)\b|$)/i]) || findCompactDimension("SH")
    const armHeight = findValue([/\b(?:Arm Height|AH)\s*(?:\([^)]+\))?\s*:\s*([^;|,]+(?:".*?)?)(?=\s+(?:Grade|Fabric)\b|$)/i]) || findCompactDimension("AH")
    const base = findValue([/\b([a-z][a-z\s/-]{0,40}\sbase)\b/i])
    const description = findValue([/\bDescription\s*:\s*([^|]+?)(?=\s+Dimensions\b|\s+Grade\b|$)/i]) || summaryText
    const bodyFrame = normalizeText(base ? description.replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "") : description).replace(/^[,|]\s*|\s*[,|]$/g, "")

    const attributes = [
      ["width", "Width", width],
      ["length", "Length", depth],
      ["overall-height", "Overall Height", height],
      ["seat-height", "Seat Height", seatHeight],
      ["arm-height", "Arm Height", armHeight],
      ["body-frame", "Body/Frame", bodyFrame],
      ["legs-base", "Legs/Base", base]
    ].map(([attributeId, label, value]) => {
      const normalizedValue = normalizeText(value || "")
      return {
        attributeId,
        label,
        value: normalizedValue || null,
        confidence: normalizedValue ? (/height|width|length/i.test(label) ? 0.92 : 0.78) : 0,
        status: normalizedValue ? "filled" : "not_found",
        sourceStage: "pdf",
        sourceDocTitle,
        evidence: normalizedValue
          ? [{ sourceType: "pdf", snippet: normalizedValue, docTitle: sourceDocTitle }]
          : []
      }
    })

    return {
      stage: "pdf",
      outcome: attributes.some((attribute) => attribute.status === "filled") ? "completed" : "needs_pdf_escalation",
      attributes
    }
  }

  function renderDecisionAssistResolvedAttributes() {
    const filledAttributes = (appState.spec.attributes || [])
      .filter((attribute) => normalizeText(attribute.value))
      .map((attribute) => ({
        label: normalizeText(attribute.label),
        value: normalizeText(attribute.value),
        sourceStage: normalizeText(attribute.sourceStage || ""),
        sourceDocTitle: normalizeText(attribute.sourceDocTitle || "")
      }))

    if (!filledAttributes.length) return ""

    return `
      <div class="help-spec-panel">
        <div class="help-spec-card">
          <div class="help-spec-selector-block">
            <div class="help-spec-selector-head">
              <p class="help-spec-selector-title">Attributes Ready</p>
              <p class="help-spec-selector-copy">This product-specific PDF result can now fill these fields in the attribute rail.</p>
            </div>
            <div class="help-spec-reference-block">
              <ul class="help-spec-reference-list">
                ${filledAttributes.map((attribute) => `
                  <li>
                    <strong>${escapeHtml(attribute.label)}:</strong> ${escapeHtml(attribute.value)}
                    ${attribute.sourceDocTitle ? ` <span class="option-source-chip option-source-chip-subtle">${escapeHtml(attribute.sourceDocTitle)}</span>` : ""}
                  </li>
                `).join("")}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `
  }

  function buildWebsiteAnswerRequest(url) {
    const narrowingSelections = Object.entries(appState.websiteNarrowingSelections || {})
      .map(([, value]) => normalizeText(value))
      .filter(Boolean)
    const variantFocus = [normalizeText(appState.websiteVariantFocus || ""), ...narrowingSelections].filter(Boolean).join(" | ")
    return {
      product_url: normalizeWebsiteUrl(url),
      product_name: normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || appState.inputDraft.productName),
      attribute_schema: appState.spec.attributes.map((attribute) => ({
        id: attribute.key,
        label: attribute.label,
        required: true
      })),
      user_inputs: {
        variant_focus: variantFocus,
        narrowing_selections: appState.websiteNarrowingSelections || {}
      }
    }
  }

  function getActiveDocument() {
    const usesPdfNarrative = appState.sourceMode === "pdf" || (appState.sourceMode === "both" && appState.activeNarrativeSource === "pdf")
    if (!usesPdfNarrative) return null
    return appState.documents.find((document) => document.id === appState.activeDocumentId) || appState.documents[0]
  }

  function getRoutingPdfDocument() {
    return appState.documents.find((document) => document.id === appState.activeDocumentId) || appState.documents[0] || null
  }

  function getPageCombinedText(page) {
    return [page?.text || "", page?.ocrText || ""].filter(Boolean).join("\n")
  }

  function getPageRenderKey(documentRecord, pageNumber) {
    return `${documentRecord?.id || "unknown"}:${pageNumber}`
  }

  function clampPdfZoom(value) {
    return Math.min(2.25, Math.max(0.75, Math.round(value * 100) / 100))
  }

  function getPdfZoomLabel() {
    return `${Math.round(appState.pdfZoom * 100)}%`
  }

  function setPlainPdfMode(enabled) {
    if (appState.sourceMode !== "pdf" && !(appState.sourceMode === "both" && appState.activeNarrativeSource === "pdf")) return
    appState.plainPdfMode = Boolean(enabled)
    if (appState.plainPdfMode) {
      appState.debugPanelOpen = false
      const activeDocument = getActiveDocument()
      appState.plainPdfVisibleCount = Math.min(activeDocument?.pages?.length || PLAIN_PDF_BATCH_SIZE, PLAIN_PDF_BATCH_SIZE)
    } else {
      appState.plainPdfVisibleCount = PLAIN_PDF_BATCH_SIZE
    }
    clearSelectionState()
    renderPreservingViewerScroll()
    if (appState.plainPdfMode) {
      queuePlainPdfAutoLoadCheck()
    }
  }

  function maybeExtendPlainPdfVisiblePages() {
    if ((appState.sourceMode !== "pdf" && !(appState.sourceMode === "both" && appState.activeNarrativeSource === "pdf")) || !appState.plainPdfMode) return
    const documentRecord = getActiveDocument()
    const totalPages = documentRecord?.pages?.length || 0
    if (!totalPages || appState.plainPdfVisibleCount >= totalPages) return
    const viewerScroll = document.getElementById("viewer-scroll")
    if (!viewerScroll) return
    const remaining = viewerScroll.scrollHeight - viewerScroll.scrollTop - viewerScroll.clientHeight
    if (remaining > 1200) return
    appState.plainPdfVisibleCount = Math.min(totalPages, appState.plainPdfVisibleCount + PLAIN_PDF_BATCH_SIZE)
    renderPreservingViewerScroll()
    queuePlainPdfAutoLoadCheck()
  }

  function loadMorePlainPdfPages() {
    if ((appState.sourceMode !== "pdf" && !(appState.sourceMode === "both" && appState.activeNarrativeSource === "pdf")) || !appState.plainPdfMode) return
    const documentRecord = getActiveDocument()
    const totalPages = documentRecord?.pages?.length || 0
    if (!totalPages || appState.plainPdfVisibleCount >= totalPages) return
    appState.plainPdfVisibleCount = Math.min(totalPages, appState.plainPdfVisibleCount + PLAIN_PDF_BATCH_SIZE)
    renderPreservingViewerScroll()
    queuePlainPdfAutoLoadCheck()
  }

  function bindViewerPan(viewerScroll) {
    if (appState.sourceMode !== "pdf" && !(appState.sourceMode === "both" && appState.activeNarrativeSource === "pdf")) return
    if (!viewerScroll) return

    const endPan = () => {
      viewerPanState = null
      viewerScroll.classList.remove("is-dragging-pdf")
      document.querySelectorAll(".page-render-shell.is-dragging").forEach((element) => {
        element.classList.remove("is-dragging")
      })
    }

    viewerScroll.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return
      const renderShell = event.target instanceof Element ? event.target.closest(".page-render-shell") : null
      const textLayer = event.target instanceof Element ? event.target.closest(".page-text-layer, .page-text-layer-inner") : null
      if (!renderShell || textLayer) return

      viewerPanState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewerScroll.scrollLeft,
        scrollTop: viewerScroll.scrollTop
      }
      viewerScroll.classList.add("is-dragging-pdf")
      renderShell.classList.add("is-dragging")
      viewerScroll.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    })

    viewerScroll.addEventListener("pointermove", (event) => {
      if (!viewerPanState || viewerPanState.pointerId !== event.pointerId) return
      const deltaX = event.clientX - viewerPanState.startX
      const deltaY = event.clientY - viewerPanState.startY
      viewerScroll.scrollLeft = viewerPanState.scrollLeft - deltaX
      viewerScroll.scrollTop = viewerPanState.scrollTop - deltaY
      event.preventDefault()
    })

    viewerScroll.addEventListener("pointerup", endPan)
    viewerScroll.addEventListener("pointercancel", endPan)
    viewerScroll.addEventListener("lostpointercapture", endPan)
  }

  function queuePlainPdfAutoLoadCheck() {
    if (plainPdfAutoLoadFrameId) {
      window.cancelAnimationFrame(plainPdfAutoLoadFrameId)
    }
    plainPdfAutoLoadFrameId = window.requestAnimationFrame(() => {
      plainPdfAutoLoadFrameId = window.requestAnimationFrame(() => {
        plainPdfAutoLoadFrameId = null
        maybeExtendPlainPdfVisiblePages()
      })
    })
  }

  function getViewerBaseRenderWidth() {
    const viewerScroll = document.getElementById("viewer-scroll")
    const viewerWidth = viewerScroll?.clientWidth || 0
    if (!viewerWidth) return 420
    return Math.max(320, viewerWidth - 72)
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;")
  }

  function getReadableCacheKey(renderKey, variant = "transcript") {
    if (variant === "summary") {
      const top = getPageRangeTop(renderKey)
      const height = getPageRangeHeight(renderKey)
      return `${renderKey}:${variant}:top-${top ?? "auto"}:height-${height ?? "auto"}`
    }
    return `${renderKey}:${variant}`
  }

  function getReadableLoadingMessage(pageNumber, variant, status) {
    if (status === "extracting_text") {
      return `Extracting page text from page ${pageNumber}...`
    }
    if (status === "reading_image") {
      return variant === "summary"
        ? `Reviewing page ${pageNumber} visually and organizing spec details...`
        : `Reading page ${pageNumber} visually to recover missing text...`
    }
    if (status === "formatting_text") {
      return `Formatting page ${pageNumber} text for easier scanning...`
    }
    if (status === "structuring_text") {
      return `Structuring sections and option groups for page ${pageNumber}...`
    }
    if (status === "finalizing_text") {
      return `Finalizing cleaned page text for page ${pageNumber}...`
    }
    if (status === "building_summary") {
      return `Building a structured spec summary for page ${pageNumber}...`
    }
    if (status === "cross_checking_summary") {
      return `Cross-checking spec details and visible options on page ${pageNumber}...`
    }
    if (status === "finalizing_summary") {
      return `Finalizing the spec summary for page ${pageNumber}...`
    }
    if (status === "verifying_summary") {
      return `Verifying the spec summary details for page ${pageNumber}...`
    }
    if (status === "polishing_summary") {
      return `Polishing the summary structure and copy targets for page ${pageNumber}...`
    }
    if (status === "preparing_summary_output") {
      return `Preparing the final spec summary output for page ${pageNumber}...`
    }
    return "Working on this page..."
  }

  function clearReadableStatusTimers(cacheKey) {
    const timerIds = readableStatusTimerIds[cacheKey] || []
    timerIds.forEach((timerId) => window.clearTimeout(timerId))
    delete readableStatusTimerIds[cacheKey]
  }

  function scheduleReadableStatusSequence(cacheKey, steps, pageNumber) {
    clearReadableStatusTimers(cacheKey)
    readableStatusTimerIds[cacheKey] = steps.map(({ delay, status }) =>
      window.setTimeout(() => {
        const currentStatus = appState.pageReadableStatusByKey[cacheKey]
        if (!currentStatus || currentStatus === "done" || currentStatus === "error") return
        appState.pageReadableStatusByKey[cacheKey] = status
        if (Number.isFinite(pageNumber)) {
          patchPageReadableArea(pageNumber)
        } else {
          renderPreservingViewerScroll()
        }
      }, delay)
    )
  }

  function clearAllReadableStatusTimers() {
    Object.keys(readableStatusTimerIds).forEach((cacheKey) => clearReadableStatusTimers(cacheKey))
  }

  function syncToastDom() {
    const shell = document.querySelector(".app-shell")
    if (!shell) return
    const existingToast = shell.querySelector(".toast")
    if (!appState.toastMessage) {
      existingToast?.remove()
      return
    }
    if (existingToast) {
      existingToast.textContent = appState.toastMessage
      return
    }
    const toast = document.createElement("div")
    toast.className = "toast"
    toast.textContent = appState.toastMessage
    shell.appendChild(toast)
  }

  function sanitizeReadableHtml(html) {
    const parser = new DOMParser()
    const documentFragment = parser.parseFromString(`<div>${html || ""}</div>`, "text/html")
    const allowedTags = new Set(["DIV", "H3", "H4", "P", "UL", "OL", "LI", "STRONG", "EM", "BR"])

    function sanitizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent || "")
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return document.createDocumentFragment()
      }

      if (!allowedTags.has(node.tagName)) {
        const fragment = document.createDocumentFragment()
        ;[...node.childNodes].forEach((child) => fragment.appendChild(sanitizeNode(child)))
        return fragment
      }

      const safeNode = document.createElement(node.tagName.toLowerCase())
      ;[...node.childNodes].forEach((child) => safeNode.appendChild(sanitizeNode(child)))
      return safeNode
    }

    const wrapper = document.createElement("div")
    ;[...documentFragment.body.firstChild.childNodes].forEach((child) => {
      wrapper.appendChild(sanitizeNode(child))
    })
    return wrapper.innerHTML.trim()
  }

  function normalizeReadableCopyTargets(targets) {
    const allowedTypes = new Set(["dimension", "model", "finish", "option"])
    if (!Array.isArray(targets)) return []
    return targets
      .map((target) => {
        const label = normalizeText(target?.label || "")
        const rawType = normalizeText(target?.type || "")
        let type = rawType
        if (!type) {
          if (/model|style number|sku|code/i.test(label)) type = "model"
          else if (/finish|paint|upholstery|fabric|leather/i.test(label)) type = "finish"
          else if (/option|glide|base|arm|caster/i.test(label)) type = "option"
          else if (/dimension|height|width|depth|dia/i.test(label)) type = "dimension"
        }
        return {
          label: type === "dimension" ? "" : label,
          value: normalizeText(target?.value || ""),
          type,
          fieldHint: normalizeText(target?.field_hint || target?.fieldHint || "")
        }
      })
      .filter((target) => target.value && allowedTypes.has(target.type))
      .filter((target) => {
        if (target.type === "dimension") {
          return /\d/.test(target.value) && (/[\"”]/.test(target.value) || /\b\d+(?:\.\d+)?\b/.test(target.value))
        }
        if (target.type === "model") {
          return target.value.length >= 3 && /[A-Z]/i.test(target.value) && /\d/.test(target.value)
        }
        if (target.type === "finish" || target.type === "option") {
          return target.value.length >= 3 && !/^\d+$/.test(target.value)
        }
        return true
      })
  }

  function inferReadableCopyTargetsFromHtml(html) {
    const text = normalizeText(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    if (!text) return []

    const targets = []
    const seen = new Set()
    const parser = new DOMParser()
    const documentFragment = parser.parseFromString(`<div>${html || ""}</div>`, "text/html")
    const root = documentFragment.body.firstElementChild

    const dimensionMatches = [...text.matchAll(/(\b\d+(?:\s+\d\/\d)?(?:"|”))(?:\s*(?:[WDH]|dia\b))?/gi)]
    dimensionMatches.forEach((match) => {
      const normalizedValue = normalizeText(match[1] || "")
      if (!normalizedValue || seen.has(`dimension:${normalizedValue}`)) return
      seen.add(`dimension:${normalizedValue}`)
      let fieldHint = ""
      const suffixText = normalizeText(match[0] || "")
      if (/\bW$/i.test(suffixText)) fieldHint = "width"
      else if (/\bD$/i.test(suffixText)) fieldHint = "depth"
      else if (/\bH$/i.test(suffixText)) fieldHint = "height"
      else if (/dia/i.test(suffixText)) fieldHint = "diameter"
      targets.push({
        label: "",
        value: normalizedValue,
        type: "dimension",
        fieldHint
      })
    })

    const rowDimensionPatterns = [
      { pattern: /(seat height|seat h(?:eight)?)[^0-9]*(\d+(?:\s+\d\/\d)?(?:\.\d+)?)/i, fieldHint: "seat height" },
      { pattern: /(arm height|arm h(?:eight)?)[^0-9]*(\d+(?:\s+\d\/\d)?(?:\.\d+)?)/i, fieldHint: "arm height" },
      { pattern: /(overall height|height)[^0-9]*(\d+(?:\s+\d\/\d)?(?:\.\d+)?)/i, fieldHint: "height" },
      { pattern: /(overall width|width)[^0-9]*(\d+(?:\s+\d\/\d)?(?:\.\d+)?)/i, fieldHint: "width" },
      { pattern: /(overall depth|depth)[^0-9]*(\d+(?:\s+\d\/\d)?(?:\.\d+)?)/i, fieldHint: "depth" }
    ]

    const modelMatches = text.match(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]+)+\b|\b\d{2,}[A-Z]?\b/g) || []
    modelMatches.forEach((value) => {
      const normalizedValue = normalizeText(value)
      if (!normalizedValue || normalizedValue.length < 3 || seen.has(`model:${normalizedValue}`)) return
      if (/^\d+(?:\s+\d\/\d)?$/.test(normalizedValue)) return
      seen.add(`model:${normalizedValue}`)
      targets.push({
        label: "Model Number",
        value: normalizedValue,
        type: "model",
        fieldHint: "model"
      })
    })

    if (root) {
      let activeSectionType = ""
      const structuredRows = root.querySelectorAll("h3, h4, p, li")
      structuredRows.forEach((row) => {
        const rowText = normalizeText(row.textContent || "")
        if (!rowText) return

        const isHeadingLike =
          row.tagName === "H3"
          || row.tagName === "H4"
          || (row.tagName === "P" && /:\s*$/.test(rowText))

        if (isHeadingLike) {
          if (/\bfinish(?:es)?\b/i.test(rowText)) {
            activeSectionType = "finish"
          } else if (/\boption(?:s)?\b/i.test(rowText)) {
            activeSectionType = "option"
          } else {
            activeSectionType = ""
          }
          return
        }

        rowDimensionPatterns.forEach(({ pattern, fieldHint }) => {
          const rowMatch = rowText.match(pattern)
          if (!rowMatch) return
          const normalizedValue = normalizeText(rowMatch[2] || "")
          if (!normalizedValue || seen.has(`dimension:${fieldHint}:${normalizedValue}`)) return
          seen.add(`dimension:${fieldHint}:${normalizedValue}`)
          targets.push({
            label: "",
            value: normalizedValue,
            type: "dimension",
            fieldHint
          })
        })

        ;[...rowText.matchAll(/(\d+(?:\s+\d\/\d)?(?:\.\d+)?)(?=\s*(?:[WDH]|dia\b))/gi)].forEach((match) => {
          const normalizedValue = normalizeText(match[1] || "")
          if (!normalizedValue || seen.has(`dimension:${normalizedValue}`)) return
          seen.add(`dimension:${normalizedValue}`)
          let fieldHint = ""
          const suffixChar = (rowText[match.index + match[0].length] || "").toLowerCase()
          if (suffixChar === "w") fieldHint = "width"
          else if (suffixChar === "d") fieldHint = "depth"
          else if (suffixChar === "h") fieldHint = "height"
          targets.push({
            label: "",
            value: normalizedValue,
            type: "dimension",
            fieldHint
          })
        })

        const modelLineMatch = rowText.match(/^(?:model|style number)\s*:\s*([A-Z0-9-]{3,})$/i)
        if (modelLineMatch) {
          const normalizedValue = normalizeText(modelLineMatch[1] || "")
          if (normalizedValue && !seen.has(`model:${normalizedValue}`)) {
            seen.add(`model:${normalizedValue}`)
            targets.push({
              label: "Model Number",
              value: normalizedValue,
              type: "model",
              fieldHint: "model"
            })
          }
        }

        const descriptionMatch = rowText.match(/^description\s*:\s*(.+)$/i)
        if (descriptionMatch) {
          descriptionMatch[1]
            .split(/\s*,\s*/)
            .map((part) => normalizeText(part))
            .filter((part) => part.length >= 3)
            .forEach((part) => {
              if (!/^(description|product|chair|lounge chair)$/i.test(part) && !seen.has(`option:${part}`)) {
                seen.add(`option:${part}`)
                targets.push({
                  label: "Option",
                  value: part,
                  type: "option",
                  fieldHint: "option"
                })
              }
            })
        }

        const codedFinishOrOptionMatch = rowText.match(/^([A-Z]{1,4}\d{2,}[A-Z0-9-]*)\s*[–-]\s*([A-Za-z][A-Za-z0-9/&(),.'\s]+)$/)
        if (codedFinishOrOptionMatch) {
          const [, code, label] = codedFinishOrOptionMatch
          const combinedValue = normalizeText(`${code} - ${label}`)
          const inferredType = activeSectionType || "option"
          if (!seen.has(`${inferredType}:${combinedValue}`)) {
            seen.add(`${inferredType}:${combinedValue}`)
            targets.push({
              label: inferredType === "finish" ? "Finish" : "Option",
              value: combinedValue,
              type: inferredType,
              fieldHint: inferredType
            })
          }
          if (inferredType === "finish" && !seen.has(`finish:${label}`)) {
            seen.add(`finish:${label}`)
            targets.push({
              label: "Finish",
              value: normalizeText(label),
              type: "finish",
              fieldHint: "finish"
            })
          }
        }
      })
    }

    return targets
  }

  function enhanceReadableHtmlWithCopyTargets(html, targets) {
    if (!html || !Array.isArray(targets) || !targets.length) return html

    const parser = new DOMParser()
    const documentFragment = parser.parseFromString(`<div>${html}</div>`, "text/html")
    const root = documentFragment.body.firstElementChild
    if (!root) return html

    const pendingTargets = targets
      .filter((target) => normalizeText(target?.value))
      .map((target, index) => ({ ...target, index }))

    function isValidMatchBoundary(text, start, end, target) {
      const previousChar = start > 0 ? text[start - 1] : ""
      const nextChar = end < text.length ? text[end] : ""
      const previousIsWord = /[A-Za-z0-9]/.test(previousChar)
      const nextIsWord = /[A-Za-z0-9]/.test(nextChar)

      if (target.type === "dimension") {
        if (previousIsWord) return false
        if (nextIsWord && !/^[WDH]$/i.test(nextChar)) return false
        return true
      }

      return !previousIsWord && !nextIsWord
    }

    function wrapTextNode(textNode) {
      const originalText = textNode.textContent || ""
      if (!originalText.trim()) return false

      const matches = []
      pendingTargets.forEach((target) => {
        const value = target.value
        if (!value) return
        let searchIndex = 0
        while (searchIndex < originalText.length) {
          const matchIndex = originalText.indexOf(value, searchIndex)
          if (matchIndex === -1) break
          const matchEnd = matchIndex + value.length
          if (!isValidMatchBoundary(originalText, matchIndex, matchEnd, target)) {
            searchIndex = matchIndex + value.length
            continue
          }
          matches.push({
            start: matchIndex,
            end: matchEnd,
            target
          })
          searchIndex = matchIndex + value.length
        }
      })

      if (!matches.length) return false

      matches.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start
        return b.end - a.end
      })

      const accepted = []
      let cursor = -1
      matches.forEach((match) => {
        if (match.start < cursor) return
        accepted.push(match)
        cursor = match.end
      })

      if (!accepted.length) return false

      const fragment = document.createDocumentFragment()
      let lastIndex = 0
      accepted.forEach((match) => {
        if (match.start > lastIndex) {
          fragment.appendChild(document.createTextNode(originalText.slice(lastIndex, match.start)))
        }

        const button = document.createElement("button")
        button.type = "button"
        button.className = "summary-copy-target"
        button.setAttribute("data-copy-direct", match.target.value)
        const tooltipParts = match.target.type === "dimension"
          ? []
          : [match.target.label, match.target.fieldHint].filter(Boolean)
        button.title = tooltipParts.length ? `Copy ${tooltipParts.join(" · ")}` : `Copy ${match.target.value}`
        button.textContent = match.target.value
        fragment.appendChild(button)
        lastIndex = match.end
      })

      if (lastIndex < originalText.length) {
        fragment.appendChild(document.createTextNode(originalText.slice(lastIndex)))
      }

      textNode.parentNode?.replaceChild(fragment, textNode)
      return true
    }

    function walk(node) {
      if (!node) return
      if (node.nodeType === Node.TEXT_NODE) {
        wrapTextNode(node)
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      if (node.tagName === "BUTTON") return
      ;[...node.childNodes].forEach((child) => walk(child))
    }

    walk(root)
    return root.innerHTML
  }

  function getAiOrderedPages(topPages) {
    if (!appState.aiRerankResult?.orderedPages?.length) return topPages

    const pageMap = new Map(topPages.map((page) => [page.pageNumber, page]))
    const ordered = []
    const preferredPages = Array.isArray(appState.aiRerankResult?.runOpeners) && appState.aiRerankResult.runOpeners.length
      ? appState.aiRerankResult.runOpeners.map((item) => ({
          pageNumber: item.openerPage,
          reason: item.reason || item.label || "",
          role: item.label || "",
          aiScore: typeof item.aiScore === "number" ? item.aiScore : "",
          confidence: item.confidence || ""
        }))
      : appState.aiRerankResult.orderedPages
    const keptPageSet = new Set((Array.isArray(appState.aiRerankResult?.runOpeners) && appState.aiRerankResult.runOpeners.length
      ? appState.aiRerankResult.runOpeners.map((item) => item.openerPage)
      : appState.aiRerankResult.keptPages) || [])
    const scoredPageSet = new Set(preferredPages.map((item) => item.pageNumber))

    preferredPages.forEach((item) => {
      const page = pageMap.get(item.pageNumber)
      if (!page) return
      const variantMatch = appState.aiRerankResult.variantComparison?.find((variant) => variant.pageNumber === item.pageNumber)
      ordered.push({
        ...page,
        aiRole: item.role || "",
        aiReason: item.reason || "",
        aiConfidence: item.confidence || "",
        aiScore: typeof item.aiScore === "number" ? item.aiScore : "",
        aiRank: ordered.length + 1,
        aiSelected: item.pageNumber === appState.aiRerankResult.bestPage,
        aiVariant: variantMatch?.label || "",
        aiDifference: variantMatch?.difference || "",
        aiStatus: keptPageSet.has(item.pageNumber) ? "kept" : "filtered_out"
      })
      pageMap.delete(item.pageNumber)
    })

    pageMap.forEach((page, pageNumber) =>
      ordered.push({
        ...page,
        aiStatus: scoredPageSet.has(pageNumber) ? "filtered_out" : "not_scored"
      })
    )
    return ordered.slice(0, getAiKeptPageLimit())
  }

  function extractResponseText(payload) {
    if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
      return payload.output_text.trim()
    }

    const outputBlocks = payload?.output || []
    const textParts = []
    outputBlocks.forEach((block) => {
      ;(block?.content || []).forEach((item) => {
        if (item?.type === "output_text" && item.text) {
          textParts.push(item.text)
        }
      })
    })
    return textParts.join("\n").trim()
  }

  function parseJsonPayload(rawText) {
    if (!rawText) return null

    try {
      return JSON.parse(rawText)
    } catch (error) {
      const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (fencedMatch) {
        try {
          return JSON.parse(fencedMatch[1].trim())
        } catch (fencedError) {
          return null
        }
      }
    }

    return null
  }

  function formatVisionAnalysisText(analysis) {
    if (!analysis) return ""

    const lines = []
    if (analysis.summary) lines.push(`Summary: ${analysis.summary}`)

    if (Array.isArray(analysis.measurements) && analysis.measurements.length) {
      lines.push("Measurements:")
      analysis.measurements.forEach((item) => {
        const parts = [item.variant, item.label, item.value].filter(Boolean)
        if (parts.length) {
          lines.push(`- ${parts.join(": ")}`)
        }
      })
    }

    if (Array.isArray(analysis.raw_visible_dimensions) && analysis.raw_visible_dimensions.length) {
      lines.push("Visible dimensions:")
      analysis.raw_visible_dimensions.forEach((item) => {
        lines.push(`- ${item}`)
      })
    }

    if (Array.isArray(analysis.notes) && analysis.notes.length) {
      lines.push("Notes:")
      analysis.notes.forEach((item) => {
        lines.push(`- ${item}`)
      })
    }

    return lines.join("\n")
  }

  function extractPagesFromPdfText(pdfText) {
    const pageMatches = [...pdfText.matchAll(/%%PAGE:(\d+)\n([\s\S]*?)(?=%%PAGE:|%%EOF)/g)]
    return pageMatches.map((match) => ({
      pageNumber: Number(match[1]),
      text: decodePdfStream(match[2])
    }))
  }

  function decodePdfStream(pageSource) {
    const lines = []
    const textMatches = [...pageSource.matchAll(/\((.*?)\)\s*Tj/g)]
    textMatches.forEach((match) => {
      const line = match[1]
        .replaceAll("\\(", "(")
        .replaceAll("\\)", ")")
        .replaceAll("\\\\", "\\")
      lines.push(line)
    })
    return lines.join("\n")
  }

  function buildRetrievalSignals() {
    const { spec } = appState
    const signals = [
      { value: spec.originalSpecName, weight: 16, type: "product" },
      { value: spec.specDisplayName, weight: 18, type: "product" }
    ]

    if (appState.assistantSelection) {
      signals.push({ value: appState.assistantSelection, weight: 22, type: "clarifier" })
    }

    return signals.filter((signal) => normalizeText(signal.value))
  }

  function tokenize(value) {
    return normalizeText(value.toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  }

  function buildProductMatchLadder() {
    const productName = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName)
    const tokens = tokenize(productName)
    const seen = new Set()
    const ladder = []
    const genericTokens = new Set(["chair", "chairs", "seating", "collection", "standard", "series"])

    if (productName) {
      ladder.push({ label: "Full product phrase", phrase: productName.toLowerCase(), weight: 18 })
      seen.add(productName.toLowerCase())
    }

    for (let size = Math.min(tokens.length - 1, 3); size >= 2; size -= 1) {
      for (let index = 0; index <= tokens.length - size; index += 1) {
        const phrase = tokens.slice(index, index + size).join(" ")
        if (seen.has(phrase)) continue
        ladder.push({ label: "Product subphrase", phrase, weight: 12 })
        seen.add(phrase)
      }
    }

    tokens.forEach((token) => {
      if (seen.has(token)) return
      ladder.push({ label: genericTokens.has(token) ? "Downweighted token" : "Product token", phrase: token, weight: genericTokens.has(token) ? 1 : 4 })
      seen.add(token)
    })

    return ladder
  }

  function getQueryInterpretation() {
    const ladder = buildProductMatchLadder()
    return {
      primary: ladder.find((entry) => entry.label === "Full product phrase")?.phrase || "",
      secondary: ladder.filter((entry) => entry.label === "Product subphrase").map((entry) => entry.phrase).slice(0, 4),
      weakTokens: ladder.filter((entry) => entry.label === "Downweighted token").map((entry) => entry.phrase),
      strongTokens: ladder.filter((entry) => entry.label === "Product token").map((entry) => entry.phrase)
    }
  }

  function scorePage(pageText) {
    const haystack = ` ${normalizeText(pageText.toLowerCase())} `
    const signals = buildRetrievalSignals()
    const ladder = buildProductMatchLadder()
    let score = 0
    let productHit = false

    signals.forEach((signal) => {
      const lowered = signal.value.toLowerCase()
      if (!lowered) return

      if (haystack.includes(` ${lowered} `) || haystack.includes(lowered)) {
        score += signal.weight
        if (signal.type === "product") productHit = true
        return
      }

      const tokens = tokenize(lowered)
      const matchedTokens = tokens.filter((token) => haystack.includes(` ${token} `))
      if (!tokens.length || !matchedTokens.length) return

      const tokenCoverage = matchedTokens.length / tokens.length
      if (tokenCoverage >= 0.5) {
        score += Math.round(signal.weight * tokenCoverage * 0.72)
        if (signal.type === "product" && tokenCoverage >= 0.75) productHit = true
      }
    })

    ladder.forEach((entry) => {
      const count = countOccurrences(haystack, entry.phrase)
      if (!count) return
      score += entry.weight * Math.min(count, entry.label === "Product token" ? 2 : 1)
      if (entry.label !== "Product token") productHit = true
    })

    if (productHit) score += 8
    if (/product information|description|notes/i.test(pageText)) score += 4

    return score
  }

  function rankPages(documentRecord) {
    return documentRecord.pages
      .map((page) => ({
        pageNumber: page.pageNumber,
        score: scorePage(getPageCombinedText(page)),
        snippet: normalizeText(getPageCombinedText(page)).slice(0, 180)
      }))
      .sort((a, b) => b.score - a.score)
  }

  function getDocumentKeywordDensityScores(documents) {
    return documents
      .map((document) => {
        const ranked = rankPages(document)
        const topScore = ranked[0]?.score || 0
        const topThreeScore = ranked.slice(0, 3).reduce((total, page) => total + page.score, 0)
        const pageCount = Math.max(1, document.pages?.length || 1)
        // Larger PDFs have more chances to produce extreme top-page matches.
        // Apply a mild log penalty so relevance dominates over sheer size.
        const sizePenalty = 1 + 0.22 * Math.log2(pageCount)
        const selectionScore = Math.round(((topScore * 0.65) + ((topThreeScore / 3) * 0.35)) / sizePenalty)
        return {
          documentId: document.id,
          title: document.title,
          pageCount,
          topScore,
          topThreeScore,
          sizePenalty,
          selectionScore
        }
      })
      .sort((a, b) => b.selectionScore - a.selectionScore || b.topScore - a.topScore || b.topThreeScore - a.topThreeScore)
  }

  function chooseBestDocumentByKeywordDensity(documents) {
    const scoredDocuments = getDocumentKeywordDensityScores(documents)
    const bestId = scoredDocuments[0]?.documentId
    return documents.find((document) => document.id === bestId) || null
  }

  function runRanking(jumpToTopPage) {
    const documentRecord = getActiveDocument()
    if (!documentRecord) {
      appState.rankedPages = []
      appState.activePageNumber = 1
      updateStructureRoutingState(null)
      return
    }

    const ranked = rankPages(documentRecord)
    appState.rankedPages = ranked
    appState.assistantResult = analyzeRankedPages(documentRecord, ranked)
    const topMatch = ranked[0]
    if (jumpToTopPage) {
      appState.activePageNumber = topMatch?.pageNumber || 1
    }
    updateStructureRoutingState(documentRecord)
  }

  function cloneAiRerankResult(result) {
    if (!result) return null
    return {
      ...result,
      rawText: normalizeText(result.rawText || "") ? result.rawText : "",
      keptPages: Array.isArray(result.keptPages) ? [...result.keptPages] : [],
      orderedPages: Array.isArray(result.orderedPages) ? result.orderedPages.map((item) => ({ ...item })) : [],
      runOpeners: Array.isArray(result.runOpeners) ? result.runOpeners.map((item) => ({ ...item, continuationPages: Array.isArray(item.continuationPages) ? [...item.continuationPages] : [] })) : [],
      variantComparison: Array.isArray(result.variantComparison) ? result.variantComparison.map((item) => ({ ...item })) : [],
      concreteProductCandidates: Array.isArray(result.concreteProductCandidates) ? result.concreteProductCandidates.map((item) => ({ ...item })) : [],
      matchingIds: Array.isArray(result.matchingIds) ? [...result.matchingIds] : [],
      querySpecificity: normalizeText(result.querySpecificity || ""),
      appliedFilters: Array.isArray(result.appliedFilters) ? [...result.appliedFilters] : [],
      excludedFilters: Array.isArray(result.excludedFilters) ? [...result.excludedFilters] : [],
      excludedRows: Array.isArray(result.excludedRows) ? result.excludedRows.map((item) => ({ ...item })) : [],
      narrowingBuckets: Array.isArray(result.narrowingBuckets) ? result.narrowingBuckets.map((item) => ({ ...item, options: Array.isArray(item.options) ? [...item.options] : [] })) : []
    }
  }

  function setPage(pageNumber) {
    if (appState.decisionAssistResult?.pageNumber && appState.decisionAssistResult.pageNumber !== pageNumber) {
      appState.decisionAssistResult = null
      appState.activeDecisionChoiceIndex = -1
      appState.decisionTabsWindowStart = 0
      appState.decisionAssistError = ""
    }
    appState.activePageNumber = pageNumber
    render()
    ensureFamilyPageProducts(pageNumber).catch(() => {})
    requestAnimationFrame(() => {
      const viewerScroll = document.getElementById("viewer-scroll")
      const targetPage = document.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`)
      if (viewerScroll && targetPage) {
        const targetTop = targetPage.getBoundingClientRect().top - viewerScroll.getBoundingClientRect().top + viewerScroll.scrollTop
        viewerScroll.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" })
      } else if (viewerScroll) {
        viewerScroll.scrollTo({ top: 0, behavior: "smooth" })
      }
    })
  }

  function renderPreservingViewerScroll() {
    const viewerScroll = document.getElementById("viewer-scroll")
    const previousScrollTop = viewerScroll?.scrollTop ?? appState.viewerScrollTop ?? 0
    const previousScrollLeft = viewerScroll?.scrollLeft ?? appState.viewerScrollLeft ?? 0
    const previousWindowScrollX = window.scrollX || 0
    const previousWindowScrollY = window.scrollY || 0
    appState.viewerScrollTop = previousScrollTop
    appState.viewerScrollLeft = previousScrollLeft
    render()
    const immediateViewerScroll = document.getElementById("viewer-scroll")
    if (immediateViewerScroll) {
      immediateViewerScroll.scrollTop = previousScrollTop
      immediateViewerScroll.scrollLeft = previousScrollLeft
      appState.viewerScrollTop = immediateViewerScroll.scrollTop
      appState.viewerScrollLeft = immediateViewerScroll.scrollLeft
    }
    window.scrollTo(previousWindowScrollX, previousWindowScrollY)
    requestAnimationFrame(() => {
      const nextViewerScroll = document.getElementById("viewer-scroll")
      if (nextViewerScroll) {
        nextViewerScroll.scrollTop = previousScrollTop
        nextViewerScroll.scrollLeft = previousScrollLeft
        appState.viewerScrollTop = nextViewerScroll.scrollTop
        appState.viewerScrollLeft = nextViewerScroll.scrollLeft
      }
      window.scrollTo(previousWindowScrollX, previousWindowScrollY)
      requestAnimationFrame(() => {
        const settledViewerScroll = document.getElementById("viewer-scroll")
        if (settledViewerScroll) {
          settledViewerScroll.scrollTop = previousScrollTop
          settledViewerScroll.scrollLeft = previousScrollLeft
          appState.viewerScrollTop = settledViewerScroll.scrollTop
          appState.viewerScrollLeft = settledViewerScroll.scrollLeft
        }
        window.scrollTo(previousWindowScrollX, previousWindowScrollY)
      })
    })
  }

  function renderPreservingPagePosition(pageNumber) {
    const viewerScroll = document.getElementById("viewer-scroll")
    const previousScrollLeft = viewerScroll?.scrollLeft ?? appState.viewerScrollLeft ?? 0
    const previousWindowScrollX = window.scrollX || 0
    const previousWindowScrollY = window.scrollY || 0
    const currentPage = pageNumber ? document.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`) : null
    const viewerTop = viewerScroll?.getBoundingClientRect().top || 0
    const previousPageOffsetTop = currentPage && viewerScroll
      ? currentPage.getBoundingClientRect().top - viewerTop
      : null

    render()
    const immediateViewerScroll = document.getElementById("viewer-scroll")
    const immediatePage = pageNumber ? document.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`) : null
    if (immediateViewerScroll) {
      immediateViewerScroll.scrollLeft = previousScrollLeft
    }
    if (immediateViewerScroll && immediatePage && previousPageOffsetTop !== null) {
      const immediateViewerTop = immediateViewerScroll.getBoundingClientRect().top
      const immediatePageOffsetTop = immediatePage.getBoundingClientRect().top - immediateViewerTop
      immediateViewerScroll.scrollTop += immediatePageOffsetTop - previousPageOffsetTop
      appState.viewerScrollTop = immediateViewerScroll.scrollTop
      appState.viewerScrollLeft = immediateViewerScroll.scrollLeft
    }
    window.scrollTo(previousWindowScrollX, previousWindowScrollY)
    requestAnimationFrame(() => {
      const nextViewerScroll = document.getElementById("viewer-scroll")
      const nextPage = pageNumber ? document.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`) : null
      if (nextViewerScroll) {
        nextViewerScroll.scrollLeft = previousScrollLeft
      }
      if (nextViewerScroll && nextPage && previousPageOffsetTop !== null) {
        const nextViewerTop = nextViewerScroll.getBoundingClientRect().top
        const nextPageOffsetTop = nextPage.getBoundingClientRect().top - nextViewerTop
        nextViewerScroll.scrollTop += nextPageOffsetTop - previousPageOffsetTop
        appState.viewerScrollTop = nextViewerScroll.scrollTop
        appState.viewerScrollLeft = nextViewerScroll.scrollLeft
      }
      window.scrollTo(previousWindowScrollX, previousWindowScrollY)
      requestAnimationFrame(() => {
        const settledViewerScroll = document.getElementById("viewer-scroll")
        const settledPage = pageNumber ? document.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`) : null
        if (settledViewerScroll) {
          settledViewerScroll.scrollLeft = previousScrollLeft
        }
        if (settledViewerScroll && settledPage && previousPageOffsetTop !== null) {
          const settledViewerTop = settledViewerScroll.getBoundingClientRect().top
          const settledPageOffsetTop = settledPage.getBoundingClientRect().top - settledViewerTop
          settledViewerScroll.scrollTop += settledPageOffsetTop - previousPageOffsetTop
          appState.viewerScrollTop = settledViewerScroll.scrollTop
          appState.viewerScrollLeft = settledViewerScroll.scrollLeft
        }
        window.scrollTo(previousWindowScrollX, previousWindowScrollY)
      })
    })
  }

  function syncPageStripState() {
    const track = document.getElementById("page-strip-track")
    if (!track) {
      appState.pageStripCanScrollLeft = false
      appState.pageStripCanScrollRight = false
      appState.pageStripScrollLeft = 0
      return
    }

    if (Math.abs(track.scrollLeft - appState.pageStripScrollLeft) > 1) {
      track.scrollLeft = appState.pageStripScrollLeft
    }

    const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth)
    appState.pageStripScrollLeft = track.scrollLeft
    appState.pageStripCanScrollLeft = track.scrollLeft > 4
    appState.pageStripCanScrollRight = track.scrollLeft < maxScrollLeft - 4
  }

  function queuePageStripSync() {
    requestAnimationFrame(() => {
      const beforeLeft = appState.pageStripCanScrollLeft
      const beforeRight = appState.pageStripCanScrollRight
      syncPageStripState()
      if (beforeLeft !== appState.pageStripCanScrollLeft || beforeRight !== appState.pageStripCanScrollRight) {
        renderPreservingViewerScroll()
      }
    })
  }

  function syncDecisionTabsState() {
    const track = document.getElementById("decision-choice-tabs-track")
    if (!track) {
      appState.decisionTabsCanScrollLeft = false
      appState.decisionTabsCanScrollRight = false
      appState.decisionTabsScrollLeft = 0
      return
    }

    const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth)
    if (appState.decisionTabsScrollLeft > maxScrollLeft) {
      appState.decisionTabsScrollLeft = maxScrollLeft
    }
    if (Math.abs(track.scrollLeft - appState.decisionTabsScrollLeft) > 1) {
      track.scrollLeft = appState.decisionTabsScrollLeft
    }
    appState.decisionTabsScrollLeft = track.scrollLeft
    appState.decisionTabsCanScrollLeft = track.scrollLeft > 4
    appState.decisionTabsCanScrollRight = track.scrollLeft < maxScrollLeft - 4
  }

  function queueDecisionTabsSync() {
    requestAnimationFrame(() => {
      syncDecisionTabsState()
    })
  }

  function setActiveDocument(documentId) {
    appState.activeDocumentId = documentId
    appState.plainPdfVisibleCount = PLAIN_PDF_BATCH_SIZE
    appState.viewerScrollTop = 0
    appState.viewerScrollLeft = 0
    const cachedAiResult = appState.aiRerankCacheByDocumentId[documentId] || null
    appState.aiRerankResult = cloneAiRerankResult(cachedAiResult)
    appState.aiRerankRawText = cachedAiResult?.rawText || ""
    appState.aiRerankDocumentId = cachedAiResult ? documentId : ""
    appState.aiRerankError = ""
    appState.summaryPanelOpen = false
    appState.decisionAssistResult = null
    appState.decisionAssistError = ""
    appState.productFirstSelection = null
    clearSelectionState()
    runRanking(true)
    if (cachedAiResult?.bestPage) {
      appState.activePageNumber = cachedAiResult.bestPage
    } else if (appState.rankedPages[0]?.pageNumber) {
      appState.activePageNumber = appState.rankedPages[0].pageNumber
    }
    updateStructureRoutingState(getActiveDocument())
    render()
    requestAnimationFrame(() => setPage(appState.activePageNumber))
  }

  function selectionSummary() {
    return normalizeText(appState.selectionText).slice(0, 140)
  }

  function getVisiblePages(documentRecord) {
    if (!documentRecord) return []
    if (appState.plainPdfMode) {
      return documentRecord.pages.slice(0, Math.max(PLAIN_PDF_BATCH_SIZE, appState.plainPdfVisibleCount))
    }

    const structureRouting = appState.structureRouting || buildStructureRoutingState(documentRecord)
    const retrievalGuidance = getRetrievalGuidance(documentRecord, appState.rankedPages, structureRouting)
    const primaryUiMode = getPrimaryUiMode(documentRecord, structureRouting, retrievalGuidance)
    const visibleModelBackedCandidates = getDisplayableModelBackedProductCandidates(structureRouting)
    const effectiveParsingMode =
      structureRouting?.structureType === "product_family"
        ? "family"
        : appState.decisionAssistResult?.parsingMode || getSpecParsingMode(documentRecord)
    const isFamilyMode = effectiveParsingMode === "family"

    if (primaryUiMode === "show_model_numbers" && visibleModelBackedCandidates.length <= 1) {
      const activePage = documentRecord.pages.find((page) => page.pageNumber === appState.activePageNumber)
      return activePage ? [activePage] : []
    }

    const activeIndex = Math.max(0, documentRecord.pages.findIndex((page) => page.pageNumber === appState.activePageNumber))
    const start = activeIndex
    const end = Math.min(documentRecord.pages.length, activeIndex + 2)
    return documentRecord.pages.slice(start, end)
  }

  function buildPageReadableAreaHtml(documentRecord, page, baseRenderWidth) {
    if (!documentRecord || !page) return ""
    const renderKey = getPageRenderKey(documentRecord, page.pageNumber)
    const textVisible = Boolean(appState.pageTextVisibleByKey[renderKey])
    const readableVariant = appState.pageReadableVariantByKey[renderKey] || "transcript"
    const readableCacheKey = getReadableCacheKey(renderKey, readableVariant)
    const readableHtml = appState.pageReadableHtmlByKey[readableCacheKey]
    const readableTargets = [
      ...(appState.pageReadableTargetsByKey[readableCacheKey] || []),
      ...inferReadableCopyTargetsFromHtml(readableHtml)
    ]
    const readableDisplayHtml = readableVariant === "summary"
      ? enhanceReadableHtmlWithCopyTargets(readableHtml, readableTargets)
      : readableHtml
    const readableStatus = appState.pageReadableStatusByKey[readableCacheKey]
    const readableError = appState.pageReadableErrorByKey[readableCacheKey]
    const readableLoading = Boolean(readableStatus && readableStatus !== "done" && readableStatus !== "error")
    const readableLoadingMessage = getReadableLoadingMessage(page.pageNumber, readableVariant, readableStatus)
    const cropViewActive = isPageCropViewActive(renderKey)

    const summaryResetButton = cropViewActive
      ? `<button class="inline-ai-btn inline-ai-reset-btn" type="button" data-show-full-page="${page.pageNumber}" title="Restore the full page view">Show Full Page</button>`
      : ""

    const textBlock = textVisible
      ? `
        <div class="page-section page-inline-text-block" style="max-width:${Math.round(baseRenderWidth)}px;">
          <div class="page-inline-text-head">
            <div class="page-inline-mode-switch">
              <button class="inline-ai-btn inline-ai-reveal-btn ${readableVariant === "transcript" ? "is-active" : ""}" type="button" data-reveal-page-text="${page.pageNumber}" title="Raw text, kept close to the source">
                View Page Text
              </button>
              ${summaryResetButton}
            </div>
          </div>
          ${readableLoading ? `<p class="inline-ai-loading">${escapeHtml(readableLoadingMessage)}</p>` : ""}
          ${readableError ? `<p class="inline-ai-error">${escapeHtml(readableError)}</p>` : ""}
          ${readableLoading
            ? ""
            : readableHtml
              ? `<div class="page-text page-text-inline-select page-text-rich">${readableDisplayHtml}</div>`
              : `<div class="page-text page-text-inline-select">${escapeHtml(getPageCombinedText(page) || "[No extractable text found on this page]")}</div>`
          }
        </div>
      `
      : `
        <div class="page-inline-action-row" style="max-width:${Math.round(baseRenderWidth)}px;">
          <button class="inline-ai-btn inline-ai-reveal-btn" type="button" data-reveal-page-text="${page.pageNumber}" title="Raw text, kept close to the source">
            View Page Text
          </button>
          ${summaryResetButton}
        </div>
      `

    const ocrBlock = page.ocrText
      ? `
        <div class="page-section page-ocr-block">
          <p class="page-section-label">Image-added text</p>
          <div class="page-text page-text-ocr">${escapeHtml(page.ocrText)}</div>
        </div>
      `
      : ""

    return `${textBlock}${ocrBlock}`
  }

  function bindPageReadableAreaEvents(root) {
    if (!root) return
    root.querySelectorAll("[data-reveal-page-text]").forEach((button) => {
      button.addEventListener("click", async () => {
        const pageNumber = Number(button.getAttribute("data-reveal-page-text"))
        if (Number.isFinite(pageNumber)) {
          await revealPageText(pageNumber, "transcript")
        }
      })
    })
    root.querySelectorAll("[data-copy-direct]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const activeSelection = normalizeText(window.getSelection()?.toString() || "")
        if (activeSelection) return
        event.preventDefault()
        event.stopPropagation()
        const value = button.getAttribute("data-copy-direct") || ""
        if (!value) return
        copyValueDirect(value).catch(() => {})
      })
    })
  }

  function patchPageReadableArea(pageNumber) {
    const documentRecord = getActiveDocument()
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    const target = document.querySelector(`[data-page-readable-area="${pageNumber}"]`)
    if (!documentRecord || !page || !target) return
    target.innerHTML = buildPageReadableAreaHtml(documentRecord, page, getViewerBaseRenderWidth())
    bindPageReadableAreaEvents(target)
  }

  function showFullPageView(pageNumber) {
    const documentRecord = getActiveDocument()
    if (!documentRecord || !Number.isFinite(Number(pageNumber))) return
    const renderKey = getPageRenderKey(documentRecord, pageNumber)
    setPageCropView(renderKey, false)
    patchPageReadableArea(pageNumber)
    renderPreservingViewerScroll()
  }

  async function createSpecSummaryFromBand(pageNumber) {
    const documentRecord = getActiveDocument()
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    if (!documentRecord || !page) return

    const renderKey = getPageRenderKey(documentRecord, pageNumber)
    const readableCacheKey = getReadableCacheKey(renderKey, "summary")
    appState.pageTextVisibleByKey[renderKey] = true
    appState.pageReadableVariantByKey[renderKey] = "summary"
    setPageCropView(renderKey, true)
    delete appState.pageReadableHtmlByKey[readableCacheKey]
    delete appState.pageReadableTargetsByKey[readableCacheKey]
    delete appState.pageReadableStatusByKey[readableCacheKey]
    delete appState.pageReadableErrorByKey[readableCacheKey]
    clearReadableStatusTimers(readableCacheKey)
    patchPageReadableArea(pageNumber)
    renderPreservingViewerScroll()
    await summarizePageForSpec(pageNumber)
  }

  async function applyRefinedQueryAndRerank() {
    appState.retrievalRefinementSelections = {}
    appState.analyzeRequestLoading = true
    render()

    try {
      if (appState.errorMessage || !getActiveDocument()) return
      if (hasVisionAccess()) {
        await aiRerunProductSetOnly()
      }
    } finally {
      appState.analyzeRequestLoading = false
      render()
    }
  }

  async function aiRerunProductSetOnly() {
    const documentRecord = getActiveDocument() || getRoutingPdfDocument() || null
    const existingResult = appState.aiRerankResult
    if (!documentRecord || !existingResult) return
    if (normalizeStructureType(existingResult.structureType || "") !== "product_family") return
    if (!hasVisionAccess()) return

    const keptPages = Array.isArray(existingResult.keptPages) ? existingResult.keptPages.filter(Number.isFinite) : []
    if (!keptPages.length) return

    try {
      appState.aiRerankLoading = true
      appState.aiRerankError = ""
      setLoadingStage(`Query found ${keptPages.length} likely pages. Counting concrete product choices.`)
      render()

      const keptPageImages = []
      for (const pageNumber of keptPages) {
        try {
          const canvas = await renderPdfPageToCanvas(documentRecord, pageNumber, 1.2)
          const orderedPage = (existingResult.orderedPages || []).find((item) => Number(item.pageNumber) === Number(pageNumber))
          keptPageImages.push({
            pageNumber,
            imageUrl: canvas.toDataURL("image/png"),
            score: orderedPage?.aiScore || orderedPage?.score || ""
          })
        } catch (err) {
          console.error('[aiRerunProductSetOnly] failed to render page:', pageNumber, err)
        }
      }

      const productName = getCurrentQueryProductName()
      const fullQuery = getSearchFullQuery() || getMergedLongestQueryProductName()
      const baseProductFamilyName = getBaseProductFamilyName()
      const deterministicQuerySpecificity = classifyQuerySpecificity(fullQuery, baseProductFamilyName)

      const productSetContent = [{ type: "input_text", text: buildProductSetPrompt(fullQuery, baseProductFamilyName) }]
      keptPageImages.forEach((page) => {
        productSetContent.push({
          type: "input_text",
          text: `Multi-product page ${page.pageNumber}. Deterministic score: ${page.score}.`
        })
        productSetContent.push({ type: "input_image", image_url: page.imageUrl })
      })

      const { parsed: productSetParsed, rawText: productSetRawText } = await callOpenAiJsonPrompt(productSetContent, "Product set prompt failed")
      console.log("[productSetRawText]", productSetRawText)

      let choiceMode = normalizeText(productSetParsed.choice_mode || "")
      let variantCount = Number(productSetParsed.variant_count) || 0
      const querySpecificity = deterministicQuerySpecificity
      let countReason = normalizeText(productSetParsed.count_reason || "")
      console.log("[productSetParsed] model query_specificity:", normalizeText(productSetParsed.query_specificity || ""))
      console.log("[productSetParsed] deterministic query_specificity:", querySpecificity)
      console.log("[productSetParsed] variant_count:", variantCount)
      console.log("[productSetParsed] choice_mode:", choiceMode)
      const parsedChoiceThreshold = getShowModelNumbersThreshold(querySpecificity)
      if (variantCount > 0) {
        choiceMode = variantCount <= parsedChoiceThreshold ? "show_model_numbers" : "narrow_search"
        console.log("[productSetParsed] normalized choice_mode:", choiceMode, "threshold:", parsedChoiceThreshold)
      }

      let matchingIds = resolveMatchingIdsFromProductSet(productSetParsed)
      let appliedFilters = Array.isArray(productSetParsed.applied_filters) ? productSetParsed.applied_filters.map((item) => normalizeText(item)).filter(Boolean) : []
      let excludedFilters = Array.isArray(productSetParsed.excluded_filters) ? productSetParsed.excluded_filters.map((item) => normalizeText(item)).filter(Boolean) : []
      let concreteProductCandidates = normalizeConcreteProductCandidates(productSetParsed.concrete_options)
      let excludedRows = normalizeExcludedRows(productSetParsed.excluded_rows)
      let narrowingBuckets = []

      const localFamilyCandidates = keptPages.flatMap((pageNumber) => {
        const page = documentRecord?.pages?.find((item) => item.pageNumber === pageNumber)
        if (!page) return []
        return extractConcreteVariantCandidatesFromPageText(getPageCombinedText(page))
          .map((candidate) => ({
            ...candidate,
            pageNumber,
            evidence: normalizeText(`${candidate.evidence || ""} Page ${pageNumber}`.trim())
          }))
      })
      const localFamilyModelBackedCandidates = getModelBackedProductCandidates(localFamilyCandidates)
      const localFamilyVariantCount = countDistinctProductIdentifiers(localFamilyModelBackedCandidates)
      if (querySpecificity === "broad" && localFamilyVariantCount > 0) {
        variantCount = localFamilyVariantCount
        matchingIds = []
        appliedFilters = []
        excludedFilters = []
        excludedRows = []
        countReason = `The query is broad, so the app is counting the full recoverable family set instead of narrowing to a small row match. Recovered ${localFamilyVariantCount} distinct model-backed choices across the likely pages.`
        if (localFamilyVariantCount > getShowModelNumbersThreshold("broad")) {
          choiceMode = "narrow_search"
          concreteProductCandidates = []
        } else if (localFamilyModelBackedCandidates.length) {
          choiceMode = "show_model_numbers"
          concreteProductCandidates = localFamilyModelBackedCandidates
        }
      }
      if (choiceMode === "show_model_numbers" && matchingIds.length) {
        const filteredCandidates = filterCandidatesByMatchingIds(concreteProductCandidates, matchingIds)
        if (filteredCandidates.length) {
          concreteProductCandidates = filteredCandidates
        }
      }

      let nextRawText = [appState.aiRerankRawText, productSetRawText].filter(Boolean).join("\n\n")
      if (choiceMode === "narrow_search") {
        setLoadingStage(`I found ${variantCount || "several"} likely product choices. Grouping the biggest differences to narrow the search.`)
        render()
        const narrowingContent = [{ type: "input_text", text: buildNarrowingPrompt(productName) }]
        keptPageImages.forEach((page) => {
          narrowingContent.push({
            type: "input_text",
            text: `Multi-product page ${page.pageNumber}. Deterministic score: ${page.score}.`
          })
          narrowingContent.push({ type: "input_image", image_url: page.imageUrl })
        })
        const { parsed: narrowingParsed, rawText: narrowingRawText } = await callOpenAiJsonPrompt(narrowingContent, "Narrowing prompt failed")
        const bucketOrder = ["type", "base", "back", "arms", "detail", "finish", "material"]
        const aiNarrowingBuckets = Array.isArray(narrowingParsed.narrowing_buckets)
          ? narrowingParsed.narrowing_buckets
              .map((item) => ({
                id: normalizeText(item.id || ""),
                label: normalizeText(item.label || ""),
                reason: normalizeText(item.reason || ""),
                options: Array.isArray(item.options)
                  ? [...new Set(item.options.map((option) => normalizeText(option)).filter(Boolean))]
                      .sort((left, right) => left.localeCompare(right))
                  : []
              }))
              .filter((item) => item.id && item.label && item.options.length >= 2)
              .sort((left, right) => {
                const leftIndex = bucketOrder.indexOf(left.id.toLowerCase())
                const rightIndex = bucketOrder.indexOf(right.id.toLowerCase())
                const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
                const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex
                if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight
                return left.label.localeCompare(right.label)
              })
          : []
        const variantBreakdown = buildVariantBreakdownForPages(documentRecord, keptPages)
        const keywordStats = buildKeywordStatsFromVariantBreakdown(variantBreakdown)
        let keywordBucketGroups = []
        let keywordBucketRawText = ""
        if (variantBreakdown?.variants?.length && keywordStats.length >= 2) {
          try {
            const keywordContent = [{ type: "input_text", text: buildKeywordBucketingPrompt(productName, variantBreakdown, keywordStats) }]
            const { parsed: keywordParsed, rawText: keywordRawText } = await callOpenAiJsonPrompt(keywordContent, "Keyword bucket prompt failed")
            keywordBucketGroups = normalizeKeywordBuckets(keywordParsed?.keyword_buckets || keywordParsed?.buckets || [])
            keywordBucketRawText = keywordRawText
          } catch {}
        }
        const derivedNarrowingGroups = keywordBucketGroups.length
          ? keywordBucketGroups
          : buildProposedNarrowingTermsFromVariantBreakdown(variantBreakdown)
        narrowingBuckets = mergeNarrowingBuckets(aiNarrowingBuckets, derivedNarrowingGroups)
        nextRawText = [appState.aiRerankRawText, productSetRawText, narrowingRawText, keywordBucketRawText].filter(Boolean).join("\n\n")
      }

      appState.aiRerankRawText = nextRawText
      appState.aiRerankResult = {
        ...existingResult,
        rawText: nextRawText,
        summary: normalizeText(existingResult.summary || countReason || ""),
        interactionModel: choiceMode === "show_model_numbers" ? "product_first" : "page_first",
        hasConcreteProducts: choiceMode === "show_model_numbers" && concreteProductCandidates.length > 1,
        concreteProductCandidates,
        matchingIds,
        choiceMode,
        variantCount,
        querySpecificity,
        countReason,
        appliedFilters,
        excludedFilters,
        excludedRows,
        narrowingBuckets
      }
      appState.aiRerankDocumentId = documentRecord.id
      appState.aiRerankCacheByDocumentId[documentRecord.id] = cloneAiRerankResult(appState.aiRerankResult)
      updateStructureRoutingState(documentRecord)
      if (appState.aiRerankResult.bestPage) {
        setPage(appState.aiRerankResult.bestPage)
      } else {
        render()
      }
      showToast("AI rerank complete")
    } catch (error) {
      appState.aiRerankError = error instanceof Error ? error.message : "AI rerank failed."
      showToast("AI rerank failed")
      render()
    } finally {
      appState.aiRerankLoading = false
      setLoadingStage("")
      render()
    }
  }

  function buildPageClusters(rankedPages) {
    const sortedByPage = [...rankedPages]
      .filter((page) => page.score > 0)
      .sort((a, b) => a.pageNumber - b.pageNumber)

    const clusters = []
    sortedByPage.forEach((page) => {
      const previous = clusters[clusters.length - 1]
      if (!previous || page.pageNumber - previous.endPage > 2) {
        clusters.push({
          startPage: page.pageNumber,
          endPage: page.pageNumber,
          pages: [page],
          totalScore: page.score
        })
        return
      }

      previous.endPage = page.pageNumber
      previous.pages.push(page)
      previous.totalScore += page.score
    })

    return clusters
      .map((cluster) => ({
        ...cluster,
        averageScore: Math.round(cluster.totalScore / cluster.pages.length)
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
  }

  function formatPageRange(startPage, endPage) {
    return startPage === endPage ? `page ${startPage}` : `pages ${startPage}-${endPage}`
  }

  function getPageTextMetrics(documentRecord, pageNumber) {
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    const text = getPageCombinedText(page)
    const normalized = normalizeText(text)
    const words = normalized ? normalized.split(/\s+/).length : 0
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length

    return {
      pageNumber,
      characters: normalized.length,
      words,
      lines
    }
  }

  function titleCaseWords(value) {
    return normalizeText(value)
      .split(/\s+/)
      .map((word) => {
        if (!word) return ""
        if (/^[A-Z0-9]+$/.test(word)) return word
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      })
      .join(" ")
  }

  function getCompactDescriptorLabel(value) {
    const normalized = normalizeText(value)
    if (!normalized) return ""

    const product = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "")
    let shortened = normalized

    if (product) {
      shortened = normalizeText(
        shortened.replace(new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
      ).replace(/^[,:\-–—]\s*/, "")
    }

    if (!shortened) return "General"

    const directTerms = [
      "general",
      "ebony",
      "white ash",
      "white oak",
      "walnut",
      "palisander",
      "classic",
      "tall",
      "standard"
    ]
    const directMatch = directTerms.find((term) => shortened.toLowerCase() === term)
    if (directMatch) return titleCaseWords(directMatch)

    const commaTail = normalized.split(",").slice(1).join(",").trim()
    if (commaTail && commaTail.length <= 24) {
      return titleCaseWords(commaTail)
    }

    const specificMatch = normalized.match(/\b(Ebony|White Ash|White Oak|Walnut|Palisander|Classic|Tall|Standard|General)\b/i)
    if (specificMatch) return titleCaseWords(specificMatch[1])

    if (shortened.length <= 24) return titleCaseWords(shortened)

    return titleCaseWords(shortened.split(/\s+/).slice(0, 2).join(" "))
  }

  function isLikelyFileName(value) {
    const normalized = normalizeText(value)
    return /\.pdf$/i.test(normalized) || normalized.includes("_")
  }

  function getPageTitleCandidates(documentRecord, pageNumber) {
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    const text = getPageCombinedText(page)
    const brand = normalizeText(appState.spec.brandDisplayName || "")
    const product = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "")
    const productTokens = product
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)

    return text
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .filter((line) => {
        const lowered = line.toLowerCase()
        if (brand && lowered === brand.toLowerCase()) return false
        if (/^page\s+\d+/i.test(line)) return false
        if (/^[\d\s."'/,-]+$/.test(line)) return false
        if (line.length < 8 || line.length > 120) return false
        if (/^[A-Z]{1,4}\d{2,}[A-Z0-9\s!/-]*$/.test(line)) return false
        if (/^[A-Z0-9!/-]{4,16}$/.test(line)) return false
        const tokenMatches = productTokens.filter((token) => lowered.includes(token)).length
        if (tokenMatches === 0 && line.length < 18) return false
        return true
      })
      .sort((a, b) => {
        const aHasProduct = product && a.toLowerCase().includes(product.toLowerCase())
        const bHasProduct = product && b.toLowerCase().includes(product.toLowerCase())
        const aTokenMatches = productTokens.filter((token) => a.toLowerCase().includes(token)).length
        const bTokenMatches = productTokens.filter((token) => b.toLowerCase().includes(token)).length
        if (aHasProduct && !bHasProduct) return -1
        if (!aHasProduct && bHasProduct) return 1
        if (aTokenMatches !== bTokenMatches) return bTokenMatches - aTokenMatches
        return b.length - a.length
      })
      .slice(0, 6)
  }

  function getPrimaryHeaderTitle(documentRecord, pageNumber) {
    const candidates = getPageTitleCandidates(documentRecord, pageNumber)
    const product = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "")
    const productTokens = product
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)

    const strongCandidate = candidates.find((line) => {
      const lowered = line.toLowerCase()
      const tokenMatches = productTokens.filter((token) => lowered.includes(token)).length
      return tokenMatches >= Math.min(2, productTokens.length || 2)
    })

    if (strongCandidate) return strongCandidate

    const commaCandidate = candidates.find((line) => /,/.test(line) && line.length >= 16)
    if (commaCandidate) return commaCandidate

    const longCandidate = candidates.find((line) => line.length >= 18)
    return longCandidate || candidates[0] || ""
  }

  function pageTitleMatchesProduct(documentRecord, pageNumber, productName) {
    const title = normalizeText(getPrimaryHeaderTitle(documentRecord, pageNumber)).toLowerCase()
    const normalizedProduct = normalizeText(productName).toLowerCase()
    if (!title || !normalizedProduct) return false
    if (title.includes(normalizedProduct) || normalizedProduct.includes(title)) return true
    const productTokens = normalizedProduct.split(/[^a-z0-9]+/).filter((token) => token.length >= 4)
    if (!productTokens.length) return false
    const tokenMatches = productTokens.filter((token) => title.includes(token)).length
    return tokenMatches >= Math.min(2, productTokens.length)
  }

  function shouldForceSingleProductScope(documentRecord, productName, keptPages, pageComparisons = [], orderedPages = []) {
    if (!documentRecord || !normalizeText(productName)) return false
    const candidatePages = [...new Set((Array.isArray(keptPages) ? keptPages : []).filter(Number.isFinite))].sort((a, b) => a - b)
    if (candidatePages.length < 2) return false

    const contiguousEnough = candidatePages[candidatePages.length - 1] - candidatePages[0] <= 6
    if (!contiguousEnough) return false

    const matchingTitleCount = candidatePages.filter((pageNumber) => pageTitleMatchesProduct(documentRecord, pageNumber, productName)).length
    if (matchingTitleCount < Math.max(2, candidatePages.length - 1)) return false

    const labels = [
      ...pageComparisons.map((item) => normalizeText(item?.label || item?.difference || "")),
      ...orderedPages.map((item) => normalizeText(item?.reason || item?.role || ""))
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase())

    const highLevelSplitPattern = /\b(wire base|wood base|jury base|stool|task chair|conference chair|desk chair|mesh back|upholstered back|low back|high back|swivel|fixed|memory return|armless|arms with|arms\b|left\b|right\b)\b/
    if (labels.some((label) => highLevelSplitPattern.test(label))) return false

    const lowLevelContinuationPattern = /\b(spec grid|specification|overview|marketing|veneer|ebony|ash|walnut|oak|finish|material|upholstery combinations?|classic|tall|white ash|black|palisander)\b/
    return labels.some((label) => lowLevelContinuationPattern.test(label))
  }

  function shouldForceMultiProductScope(documentRecord, keptPages = [], orderedPages = []) {
    if (!documentRecord) return false
    const candidatePages = [...new Set([
      ...(Array.isArray(keptPages) ? keptPages : []),
      ...(Array.isArray(orderedPages) ? orderedPages.map((item) => Number(item?.pageNumber)).filter(Number.isFinite) : [])
    ])]
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .slice(0, 6)

    if (!candidatePages.length) return false

    let strongRowPages = 0
    candidatePages.forEach((pageNumber) => {
      const page = documentRecord.pages?.find((item) => item.pageNumber === pageNumber)
      const text = normalizeText(getPageCombinedText(page))
      if (!text) return
      const modelMatches = text.match(/\b[A-Z]{1,5}-\d{1,4}[A-Z0-9-]*\b/g) || []
      const itemNumberMatches = text.match(/\b\d{4,6}\b/g) || []
      const hasItemHeader = /item\s+description/i.test(text) || (/\bitem\b/i.test(text) && /\bdescription\b/i.test(text))
      const hasPricingSignals = /\blist price\b/i.test(text) || /\bcom\b/i.test(text) || /\bcol\b/i.test(text)
      const repeatedStructure = modelMatches.length >= 3 || itemNumberMatches.length >= 4 || (hasItemHeader && hasPricingSignals)
      const rowSignals = countPatternMatches(text, /\b(?:mesh back|upholstered back|wire base|wood base|nylon base|aluminum base|with arms|armless)\b/gi)
      if (repeatedStructure && (hasPricingSignals || rowSignals >= 3)) {
        strongRowPages += 1
      }
    })

    return strongRowPages >= 1
  }

  function scoreSingleProductRunOpener(documentRecord, pageNumber, productName) {
    const page = documentRecord?.pages?.find((item) => item.pageNumber === pageNumber)
    const text = getPageCombinedText(page)
    const lowered = normalizeText(text).toLowerCase()
    const title = normalizeText(getPrimaryHeaderTitle(documentRecord, pageNumber))
    const loweredTitle = title.toLowerCase()
    const normalizedProduct = normalizeText(productName).toLowerCase()
    const productTokens = normalizedProduct.split(/[^a-z0-9]+/).filter((token) => token.length >= 4)
    let score = 0

    if (/featured models?/i.test(text)) score += 4
    if (/geometry in motion/i.test(text)) score += 3
    if (/effective [a-z]+\s+\d{1,2},\s+\d{4}/i.test(text)) score += 1
    if (/good\s*[+:$]|better\s*[+:$]|best\s*[+:$]/i.test(text)) score += 2
    if (/introduction|designed by|contemporary styling|deliver task functionality|featured with/i.test(lowered)) score += 2
    if (title && !/\(cont\.\)|\(cont\)/i.test(title)) score += 1
    if (normalizedProduct && (lowered.includes(normalizedProduct) || loweredTitle.includes(normalizedProduct))) score += 1
    if (productTokens.length && productTokens.some((token) => lowered.includes(token))) score += 1

    if (/\(cont\.\)|\(cont\)/i.test(text)) score -= 4
    if (/specifications?|packaging|material|base\s*\(cont\.\)|arms\s*\(cont\.\)|finish|frame finish/i.test(lowered) && !/featured models?/i.test(text)) score -= 2
    if (/code\s+price/i.test(lowered) && !/featured models?/i.test(text)) score -= 1

    return score
  }

  function detectSingleProductRunOpeners(documentRecord, pageNumbers, productName) {
    const candidatePageNumbers = [...new Set((Array.isArray(pageNumbers) ? pageNumbers : []).filter(Number.isFinite))].sort((a, b) => a - b)
    if (!documentRecord || candidatePageNumbers.length < 2) return []

    const scoredPages = candidatePageNumbers.map((pageNumber) => ({
      pageNumber,
      score: scoreSingleProductRunOpener(documentRecord, pageNumber, productName),
      label: getCompactDescriptorLabel(getPrimaryHeaderTitle(documentRecord, pageNumber))
    }))
    const openerPages = scoredPages.filter((item) => item.score >= 4)
    if (openerPages.length < 2) return []

    return openerPages.map((item, index) => {
      const nextOpenerPage = openerPages[index + 1]?.pageNumber || null
      const continuationPages = candidatePageNumbers.filter((pageNumber) =>
        pageNumber > item.pageNumber && (!nextOpenerPage || pageNumber < nextOpenerPage)
      )
      return {
        openerPage: item.pageNumber,
        label: item.label || `Run opener p.${item.pageNumber}`,
        reason: "detected opener page with hero/intro signals before continuation pages",
        continuationPages,
        aiScore: item.score,
        confidence: "local"
      }
    })
  }

  function getSharedTitlePrefix(titles) {
    const normalizedTitles = titles.map((title) => normalizeText(title)).filter(Boolean)
    if (!normalizedTitles.length) return ""

    const tokenLists = normalizedTitles.map((title) => title.split(/\s+/))
    const shortest = tokenLists.reduce((best, current) => current.length < best.length ? current : best, tokenLists[0])
    const sharedTokens = []

    for (let index = 0; index < shortest.length; index += 1) {
      const token = shortest[index]
      const normalizedToken = token.toLowerCase().replace(/[^a-z0-9]+/g, "")
      const everyMatches = tokenLists.every((list) => {
        const candidate = list[index] || ""
        return candidate.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalizedToken
      })
      if (!everyMatches) break
      sharedTokens.push(token)
    }

    return normalizeText(sharedTokens.join(" "))
  }

  function getTitleBasedDescriptor(documentRecord, pageNumber, peerPages) {
    const currentTitle = getPrimaryHeaderTitle(documentRecord, pageNumber)
    if (!currentTitle) return ""

    const titles = [...new Set((peerPages || []).map((candidate) => getPrimaryHeaderTitle(documentRecord, candidate.pageNumber)).filter(Boolean))]
    if (titles.length <= 1) return ""

    const sharedPrefix = getSharedTitlePrefix(titles)
    if (!sharedPrefix) return ""

    const prefixPattern = new RegExp(`^${sharedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
    const strippedCurrent = normalizeText(currentTitle.replace(prefixPattern, "")).replace(/^[,:\-–—]\s*/, "")

    const strippedPeers = titles
      .map((title) => normalizeText(title.replace(prefixPattern, "")))
      .map((value) => value.replace(/^[,:\-–—]\s*/, ""))

    const nonEmptyPeerSuffixes = strippedPeers.filter(Boolean)
    if (!strippedCurrent) {
      if (nonEmptyPeerSuffixes.length) return "General"
      return ""
    }

    if (nonEmptyPeerSuffixes.includes(strippedCurrent)) {
      return getCompactDescriptorLabel(strippedCurrent)
    }

    return getCompactDescriptorLabel(strippedCurrent)
  }

  function extractPageThemeSignals(text, documentRecord, pageNumber) {
    const lowered = text.toLowerCase()
    const pageTitle = normalizeText(documentRecord?.pageTitles?.[pageNumber - 1] || "")
    const titleLowered = pageTitle.toLowerCase()
    const pageTitleUsable = pageTitle && !isLikelyFileName(pageTitle) && !/^\s*page\s+\d+/i.test(pageTitle)

    const finishMatches = [
      { pattern: /white oak|whn white oak/i, label: "White Oak Finish" },
      { pattern: /ebony|ebonized ash/i, label: "Ebony Finish" },
      { pattern: /walnut|ou walnut|oiled walnut/i, label: "Walnut Finish" },
      { pattern: /ash\b/i, label: "Ash Finish" },
      { pattern: /santos palisander|palisander/i, label: "Palisander Finish" }
    ]

    const matchedFinishLabels = [...new Set(
      finishMatches
        .filter((item) => item.pattern.test(text))
        .map((item) => item.label)
    )]
    return {
      multiFinish: matchedFinishLabels.length > 1,
      finishLabels: matchedFinishLabels,
      hasUpholstery: /price category|upholstery|fabric|leather|col\b|com\b/i.test(lowered),
      hasFinish: /finish options?|finishes|veneer|wood finish|shell finish|base finish/i.test(lowered),
      hasDimensions: /dimension|overall width|overall depth|overall height|seat height|arm height|sizes?/i.test(lowered),
      hasSpecs: /specifications?|spec sheet|materials?/i.test(lowered),
      titleLabel:
        pageTitleUsable && /dimension|size/i.test(titleLowered) ? "Dimensions & Sizes" :
        pageTitleUsable && /finish|veneer|wood|oak|walnut|ash|ebony/i.test(titleLowered) ? "Finish Options" :
        pageTitleUsable && /material|upholstery|fabric|leather/i.test(titleLowered) ? "Material (Upholstery)" :
        pageTitleUsable ? titleCaseWords(pageTitle) : ""
    }
  }

  function getRelativePageDescriptor(documentRecord, pageNumber, pageData, peerPages) {
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    const text = getPageCombinedText(page)
    const signals = extractPageThemeSignals(text, documentRecord, pageNumber)
    const peerSignals = (peerPages || [])
      .filter((candidate) => candidate.pageNumber !== pageNumber)
      .map((candidate) => {
        const peerPage = documentRecord?.pages.find((item) => item.pageNumber === candidate.pageNumber)
        return extractPageThemeSignals(getPageCombinedText(peerPage), documentRecord, candidate.pageNumber)
      })

    const titleDescriptor = getTitleBasedDescriptor(documentRecord, pageNumber, peerPages)

    if (pageData?.aiVariant) return getCompactDescriptorLabel(pageData.aiVariant)

    const aiDifference = normalizeText(pageData?.aiDifference || "")
    if (aiDifference) {
      if (signals.multiFinish && /ebony|ebonized|white oak|white ash|ash|walnut|palisander/i.test(aiDifference)) {
        return "General Finish Options"
      }
      if (/ebony|ebonized/i.test(aiDifference)) return "Ebony Finish"
      if (/white oak|white ash|ash/i.test(aiDifference)) return "White Ash Finish"
      if (/walnut/i.test(aiDifference)) return "Walnut Finish"
      if (/palisander/i.test(aiDifference) && !signals.multiFinish) return "Palisander Finish"
      if (/dimension|height|width|depth|size/i.test(aiDifference)) return "Dimensions & Sizes"
    }

    const aiReason = normalizeText(pageData?.aiReason || "")
    if (aiReason) {
      if (/dimension|drawing|size|measurement/i.test(aiReason)) return "Dimensions & Sizes"
      if (/finish|veneer|oak|ash|walnut|ebony/i.test(aiReason)) {
        return signals.multiFinish ? "General Finish Options" : "Finish Option"
      }
      if (/material|upholstery|fabric|leather/i.test(aiReason)) return "Material (Upholstery)"
      if (/spec/i.test(aiReason)) return "Material Specifications"
    }

    if (pageData?.aiRole) {
      if (/dimension|size/i.test(pageData.aiRole)) return "Dimensions & Sizes"
      if (/finish|veneer/i.test(pageData.aiRole)) return signals.multiFinish ? "General Finish Options" : "Finish Option"
      if (/material|upholstery/i.test(pageData.aiRole)) return "Material (Upholstery)"
      return titleCaseWords(pageData.aiRole)
    }

    if (titleDescriptor) return titleDescriptor
    if (signals.hasDimensions) return "Dimensions & Sizes"
    if (signals.hasUpholstery) return "Material (Upholstery)"

    const peerHasSpecificFinish = peerSignals.some((peer) => peer.finishLabels.length === 1 && !peer.multiFinish)
    if (signals.multiFinish) return peerHasSpecificFinish ? "General Finish Options" : "Finish Options"
    if (signals.finishLabels.length === 1 || signals.hasFinish) {
      return peerHasSpecificFinish ? "General Finish Options" : "Finish Options"
    }
    if (signals.hasSpecs) return "Material Specifications"
    if (signals.titleLabel) return signals.titleLabel

    return analyzePageForVisualCues(text).primaryLabel
  }

  function getDistinctTopPageLabels(documentRecord, pages) {
    const sharedTitles = pages.map((page) => getPrimaryHeaderTitle(documentRecord, page.pageNumber))
    const sharedPrefix = getSharedTitlePrefix(sharedTitles)
    const prefixPattern = sharedPrefix
      ? new RegExp(`^${sharedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
      : null

    const firstPass = pages.map((page) => {
      const aiLabel = getCompactDescriptorLabel(page.aiVariant || "")
      if (aiLabel) return aiLabel

      const title = getPrimaryHeaderTitle(documentRecord, page.pageNumber)
      if (title && prefixPattern) {
        const suffix = normalizeText(title.replace(prefixPattern, "")).replace(/^[,:\-–—]\s*/, "")
        const compactSuffix = getCompactDescriptorLabel(suffix)
        if (compactSuffix) return compactSuffix
        if (!suffix) return "General"
      }

      return getRelativePageDescriptor(documentRecord, page.pageNumber, page, pages)
    })

    const counts = new Map()
    firstPass.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1))

    return pages.map((page, index) => {
      const initialLabel = firstPass[index]
      if ((counts.get(initialLabel) || 0) === 1) return initialLabel

      const candidates = getPageTitleCandidates(documentRecord, page.pageNumber)
      const title = getPrimaryHeaderTitle(documentRecord, page.pageNumber)

      const extraCandidates = [
        ...candidates.map((line) => getCompactDescriptorLabel(line)),
        getCompactDescriptorLabel(title),
        getCompactDescriptorLabel(page.aiDifference || ""),
        getCompactDescriptorLabel(page.aiReason || "")
      ]
        .map((label) => normalizeText(label))
        .filter(Boolean)
        .filter((label) => label.toLowerCase() !== initialLabel.toLowerCase())

      const uniqueAlternative = extraCandidates.find((candidate) =>
        !firstPass.some((label, labelIndex) => labelIndex !== index && label.toLowerCase() === candidate.toLowerCase())
      )
      if (uniqueAlternative) return uniqueAlternative

      if (initialLabel.toLowerCase() === "general") {
        return index === 0 ? "General" : `Variant ${index + 1}`
      }

      return `${initialLabel} ${index + 1}`
    })
  }

  function getAiOnlyTopPageLabel(page) {
    const rawCandidates = [
      page?.aiVariant || "",
      page?.aiDifference || "",
      page?.aiReason || "",
      page?.aiRole || ""
    ]

    for (const rawValue of rawCandidates) {
      const compact = getCompactDescriptorLabel(rawValue)
      if (compact) return compact

      const normalized = normalizeText(rawValue)
      if (!normalized) continue

      const product = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "")
      let shortened = normalized
      if (product) {
        shortened = normalizeText(
          shortened.replace(new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
        ).replace(/^[,:\-–—]\s*/, "")
      }

      const fallback = normalizeText(shortened || normalized)
      if (!fallback) continue

      const commaTail = fallback.split(",").slice(1).join(",").trim()
      if (commaTail) return titleCaseWords(commaTail.split(/\s+/).slice(0, 3).join(" "))

      return titleCaseWords(fallback.split(/\s+/).slice(0, 3).join(" "))
    }

    return ""
  }

  function getSelectedPageSubtypeHint(documentRecord, selectedPage) {
    if (!selectedPage) return ""

    const aiOrderedPages = getAiOrderedPages(appState.rankedPages.slice(0, getAiRerankCandidateLimit()).map((page) => ({
      ...page,
      metrics: getPageTextMetrics(documentRecord, page.pageNumber)
    })))
    const aiPage = aiOrderedPages.find((page) => page.pageNumber === selectedPage.pageNumber)
    const aiLabel = aiPage ? getAiOnlyTopPageLabel(aiPage) : ""
    if (aiLabel) return aiLabel

    const rankedPage = appState.rankedPages.find((page) => page.pageNumber === selectedPage.pageNumber)
    if (rankedPage) {
      const fallbackLabel = getRelativePageDescriptor(documentRecord, selectedPage.pageNumber, rankedPage, appState.rankedPages.slice(0, 5))
      if (fallbackLabel) return fallbackLabel
    }

    return ""
  }

  function getFamilyPageSelectionCandidates(documentRecord, pageNumber) {
    if (getSpecParsingMode() !== "family") return []
    const selectedPage = documentRecord?.pages?.find((page) => page.pageNumber === pageNumber)
    if (!selectedPage) return []
    const subtypeHint = getSelectedPageSubtypeHint(documentRecord, selectedPage)
    return extractConcreteVariantCandidatesFromPageText(getPageCombinedText(selectedPage), subtypeHint)
  }

  function getFamilyPageSelectionKey(documentRecord, pageNumber) {
    return `${documentRecord?.id || "unknown"}:${pageNumber}`
  }

  function getPageRetrievalExplanation(documentRecord, pageNumber) {
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    const text = getPageCombinedText(page)
    const lowered = text.toLowerCase()
    const signals = [
      { label: "Product phrase", value: appState.spec.specDisplayName, weight: 18 },
      { label: "Product phrase", value: appState.spec.originalSpecName, weight: 16 }
    ]
    const ladder = buildProductMatchLadder()
    const matches = []

    signals.forEach((signal) => {
      const phrase = normalizeText(signal.value).toLowerCase()
      if (!phrase) return
      const count = countOccurrences(lowered, phrase)
      if (!count) return
      matches.push({
        label: signal.label,
        phrase: signal.value,
        count,
        effect: `+${signal.weight}${count > 1 ? ` x${count}` : ""}`
      })
    })

    ladder.forEach((entry) => {
      const count = countOccurrences(lowered, entry.phrase)
      if (!count) return
      matches.push({
        label: entry.label,
        phrase: entry.phrase,
        count,
        effect: `+${entry.weight}${count > 1 ? ` x${count}` : ""}`
      })
    })

    const metrics = getPageTextMetrics(documentRecord, pageNumber)
    return {
      metrics,
      matches
    }
  }

  function shouldOfferDimensionAnalysis(documentRecord, pageNumber) {
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    if (!page) return false

    const cues = analyzePageForVisualCues(getPageCombinedText(page))
    return cues.labels.includes("Likely dimensions drawing") || cues.labels.includes("Spec content detected")
  }

  function countOccurrences(haystack, phrase) {
    if (!phrase) return 0
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`\\b${escaped}\\b`, "gi")
    return [...haystack.matchAll(regex)].length
  }

  function getActiveSourceSummary() {
    if (appState.sourceMode === "website") {
      return appState.websiteUrl
        ? `Active website: ${appState.websiteUrl}`
        : "No website loaded yet."
    }

    if (appState.sourceMode === "both") {
      const loadedLabel = appState.activeNarrativeSource === "website"
        ? "Website"
        : appState.activeNarrativeSource === "pdf"
          ? "PDF"
          : "Waiting to compare PDF and website."
      const activeDocument = getActiveDocument()
      if (appState.activeNarrativeSource === "website" && appState.websiteUrl) {
        return `Both loaded. Showing ${loadedLabel} narrative first.`
      }
      if (appState.activeNarrativeSource === "pdf" && activeDocument) {
        return `Both loaded. Showing ${loadedLabel} narrative first.`
      }
      return "Load PDFs and a website, then the viewer will choose the stronger narrative."
    }

    if (appState.uploadFiles.length) {
      const names = appState.uploadFiles
        .slice(0, 2)
        .map((file) => file.name)
        .join(", ")
      const moreCount = Math.max(0, appState.uploadFiles.length - 2)
      const namesSuffix = moreCount ? `, +${moreCount} more` : ""
      return `Pending uploads: ${appState.uploadFiles.length} PDF${appState.uploadFiles.length === 1 ? "" : "s"} selected (${names}${namesSuffix}). Click "Ask AI to Analyze PDFs".`
    }

    const activeDocument = getActiveDocument()
    if (!activeDocument) {
      return "No active source loaded."
    }

    if (activeDocument.title === DEFAULT_BUNDLED_PDF_NAME) {
      return `Active source: ${activeDocument.title} (bundled default)`
    }

    if (activeDocument.sourceType === "uploaded") {
      return `Active source: ${activeDocument.title} (uploaded or saved default)`
    }

    return `Active source: ${activeDocument.title} (sample)`
  }

  function getPdfSessionFileSummary() {
    if (appState.uploadFiles.length) {
      const names = appState.uploadFiles.slice(0, 3).map((file) => normalizeText(file.name)).filter(Boolean)
      const moreCount = Math.max(0, appState.uploadFiles.length - names.length)
      return names.length
        ? `${names.join(", ")}${moreCount ? `, +${moreCount} more` : ""}`
        : `${appState.uploadFiles.length} PDF${appState.uploadFiles.length === 1 ? "" : "s"} selected`
    }

    if (appState.documents.length) {
      const names = appState.documents.slice(0, 3).map((document) => normalizeText(document.title)).filter(Boolean)
      const moreCount = Math.max(0, appState.documents.length - names.length)
      return names.length
        ? `${names.join(", ")}${moreCount ? `, +${moreCount} more` : ""}`
        : `${appState.documents.length} PDF${appState.documents.length === 1 ? "" : "s"} loaded`
    }

    return "No PDFs selected yet."
  }

  function hasMeaningfulWebsiteSummaryValue(value) {
    const normalized = normalizeText(value).toLowerCase()
    if (!normalized) return false
    return !(
      normalized.includes("not clearly listed")
      || normalized.includes("no linked documents")
      || normalized.includes("no fuller summary")
      || normalized === "unknown"
    )
  }

  function isWeakWebsiteSummary(summary) {
    if (!summary) return true

    const hasDimensions = hasMeaningfulWebsiteSummaryValue(summary.dimensions_summary) || (summary.dimensions_mentioned?.length || 0) > 0
    const hasFinishes = hasMeaningfulWebsiteSummaryValue(summary.finishes_summary) || (summary.finishes_mentioned?.length || 0) > 0
    const hasOptions = hasMeaningfulWebsiteSummaryValue(summary.options_summary) || (summary.options_mentioned?.length || 0) > 0
    const productName = normalizeText(summary.product_name || "").toLowerCase()
    const fullSummary = normalizeText(summary.full_summary || "").toLowerCase()

    if (hasDimensions || hasFinishes || hasOptions) return false

    return (
      !productName
      || productName === "unknown"
      || productName === "not clearly listed"
      || fullSummary.includes("page not found")
      || fullSummary.includes("no concrete, product-specific information")
      || fullSummary.includes("does not feature any valid product details")
      || fullSummary.includes("no product-specific information available")
    )
  }

  function scorePdfNarrativeSource() {
    const documentRecord = appState.documents.find((document) => document.id === appState.activeDocumentId) || appState.documents[0] || null
    if (!documentRecord) {
      return {
        available: false,
        score: 0,
        reasons: ["No PDF is available."]
      }
    }

    let score = 18
    const reasons = []
    const title = normalizeText(documentRecord.title)

    if (/price[\s-]?book|price[\s-]?list|spec|guide|worksheet|technical|installation/i.test(title)) {
      score += 34
      reasons.push("The PDF title reads like a spec or price document.")
    }
    if (/cut[\s-]?sheet|brochure|lookbook|overview|catalog/i.test(title)) {
      score -= 12
      reasons.push("The PDF title reads more like brochure or cutsheet content.")
    }
    if ((documentRecord.pages || []).length > 2) {
      score += 8
    }

    const topMatch = appState.rankedPages[0]
    if (topMatch) {
      const displayScore = Number.isFinite(getDisplayScore(topMatch)) ? getDisplayScore(topMatch) : 0
      score += Math.max(0, Math.min(24, Math.round(displayScore / 4)))
      if (displayScore >= 65) {
        reasons.push("The PDF produced a strong ranked match for the requested product.")
      }
    }

    if (appState.aiRerankResult) {
      score += 12
      reasons.push("AI reranking found a likely spec-heavy page.")
    }

    if (appState.decisionAssistResult) {
      score += 14
      reasons.push("The PDF already exposed structured characteristic modules.")
    }

    return {
      available: true,
      score,
      reasons
    }
  }

  function scoreWebsiteNarrativeSource() {
    if (!normalizeWebsiteUrl(appState.websiteUrl || appState.websiteUrlInput)) {
      return {
        available: false,
        score: 0,
        reasons: ["No website is available."]
      }
    }

    let score = 8
    const reasons = []
    const summary = appState.websiteSummary

    if (summary) {
      const hasDimensions = hasMeaningfulWebsiteSummaryValue(summary.dimensions_summary)
      const hasFinishes = hasMeaningfulWebsiteSummaryValue(summary.finishes_summary)
      const hasOptions = hasMeaningfulWebsiteSummaryValue(summary.options_summary)
      const hasResources = hasMeaningfulWebsiteSummaryValue(summary.resources_summary)

      if (hasDimensions || hasFinishes || hasOptions || hasResources) {
        score += 12
        reasons.push("The website summary contained some usable product detail.")
      } else {
        reasons.push("The website summary was structured, but it did not surface meaningful product detail.")
      }

      if (hasDimensions) score += 20
      if (hasFinishes) score += 18
      if (hasOptions) score += 18
      if (hasResources) score += 6
      score += Math.min(10, (summary.dimensions_mentioned?.length || 0) * 2)
      score += Math.min(10, (summary.finishes_mentioned?.length || 0) * 2)
      score += Math.min(10, (summary.options_mentioned?.length || 0) * 2)
      score += Math.min(6, (summary.resources_mentioned?.length || 0) * 2)

      if (isWeakWebsiteSummary(summary)) {
        score -= 28
        reasons.push("The webpage did not provide useful dimensions, finishes, or options for spec capture.")
      }
    }

    if (appState.websiteFrameStatus === "loaded") {
      score += 10
      reasons.push("The live website opened successfully in the viewer.")
    } else if (appState.websiteFrameStatus === "blocked") {
      score -= 12
      reasons.push("The live website did not open in the viewer.")
    }

    return {
      available: true,
      score,
      reasons
    }
  }

  function choosePreferredNarrativeSourceHeuristic() {
    const pdf = scorePdfNarrativeSource()
    const website = scoreWebsiteNarrativeSource()
    const details = {
      pdf: { ...pdf, reasons: [...(pdf.reasons || [])] },
      website: { ...website, reasons: [...(website.reasons || [])] }
    }

    if (!pdf.available && !website.available) {
      return {
        preferred: "",
        alternate: "",
        reason: "",
        details
      }
    }

    if (pdf.available && !website.available) {
      return {
        preferred: "pdf",
        alternate: "",
        reason: "Loaded PDF because no usable website source was available.",
        details
      }
    }

    if (!pdf.available && website.available) {
      return {
        preferred: "website",
        alternate: "",
        reason: "Loaded Website because no usable PDF source was available.",
        details
      }
    }

    if (website.score > pdf.score + 6) {
      return {
        preferred: "website",
        alternate: "pdf",
        reason: "Loaded Website because it surfaced richer spec detail than the PDFs.",
        details
      }
    }

    if (details.pdf.score <= details.website.score) {
      details.pdf.score = Math.min(100, details.website.score + 1)
      details.pdf.reasons.push("The heuristic uses a PDF-leaning tiebreak unless the website clearly wins on dimensions, finishes, and options.")
    }

    return {
      preferred: "pdf",
      alternate: "website",
      reason: pdf.reasons[0] || "Loaded PDF because it looked more spec-grade than the website.",
      details
    }
  }

  function getDisplayScore(page) {
    return Number.isFinite(page.aiScore) ? page.aiScore : page.score
  }

  function formatUiScore(value) {
    if (!Number.isFinite(value)) return "Pending"
    const normalized = Math.max(0, Math.min(100, Math.round(value)))
    return `${normalized}/100`
  }

  function formatPageChipScore(page, topPages = []) {
    if (!topPages.length) {
      return formatUiScore(getDisplayScore(page))
    }
    const topScore = getDisplayScore(topPages[0])
    const currentScore = getDisplayScore(page)
    if (!Number.isFinite(topScore) || !Number.isFinite(currentScore)) {
      return formatUiScore(currentScore)
    }
    if (page?.pageNumber === topPages[0]?.pageNumber) return "Best"
    const diff = topScore - currentScore
    if (diff <= 2) return "Close"
    if (diff <= 8) return "Related"
    return "Weak"
  }

  function buildTopPageTiers(topPages) {
    if (!topPages.length) {
      return []
    }

    const topScore = getDisplayScore(topPages[0])
    const primary = topPages.filter((page) => getDisplayScore(page) >= topScore - 2)
    const remaining = topPages.filter((page) => !primary.includes(page))
    const secondary = remaining.filter((page) => getDisplayScore(page) >= 40)
    const lowConfidence = remaining.filter((page) => !secondary.includes(page))

    return [
      { key: "primary", label: "Best matches", pages: primary },
      { key: "secondary", label: "Related", pages: secondary },
      { key: "low", label: "Low confidence", pages: lowConfidence }
    ].filter((group) => group.pages.length)
  }

  function render() {
    const sourceModeSelected = Boolean(appState.sourceMode)
    const bothMode = appState.sourceMode === "both"
    const bothDecisionPending = bothMode && !["pdf", "website"].includes(appState.activeNarrativeSource)
    const websiteMode = appState.sourceMode === "website" || (bothMode && appState.activeNarrativeSource === "website")
    const pdfMode = appState.sourceMode === "pdf" || (bothMode && appState.activeNarrativeSource === "pdf")
    const websiteTriggeredPdfLoading =
      pdfMode
      && Boolean(appState.websiteUrl)
      && (
        Boolean(normalizeText(appState.loadingMessage || ""))
        || !appState.rankedPages.length
      )
    const sessionSourceSummary = websiteTriggeredPdfLoading ? "No active source loaded." : getActiveSourceSummary()
    const sessionPdfSummary = websiteTriggeredPdfLoading ? "No PDFs selected yet." : getPdfSessionFileSummary()
    const setupNeedsPdf = appState.sourceMode === "pdf" || bothMode
    const setupNeedsWebsite = appState.sourceMode === "website" || bothMode
    const documentRecord = bothDecisionPending ? null : getActiveDocument()
    const showPdfWorkspaceHeader =
      !websiteMode
      && documentRecord
      && !websiteTriggeredPdfLoading
      && !normalizeText(appState.loadingMessage || "")
    if (documentRecord && !appState.rankedPages.length && setupNeedsPdf) {
      runRanking(true)
    }

    scheduleVisiblePageRendering()

    const topMatch = appState.rankedPages[0]
    const hasAiForActiveDocument = Boolean(appState.aiRerankResult && appState.aiRerankDocumentId === documentRecord?.id)
    const topPages = getAiOrderedPages(appState.rankedPages.slice(0, getAiRerankCandidateLimit()).map((page) => ({
      ...page,
      metrics: getPageTextMetrics(documentRecord, page.pageNumber)
    })))
    const sourceScoreById = new Map(
      appState.sourceSelectionScores.map((item) => [item.documentId, item.selectionScore])
    )
    const activeDocumentSourceScore = Number.isFinite(sourceScoreById.get(documentRecord?.id))
      ? sourceScoreById.get(documentRecord?.id)
      : null
    const decisionResult = appState.decisionAssistResult
    const structureRouting = appState.structureRouting || buildStructureRoutingState(documentRecord)
    const effectiveParsingMode =
      structureRouting?.structureType === "product_family"
        ? "family"
        : decisionResult?.parsingMode || getSpecParsingMode()
    const parsingModeConfig = getSpecParsingModeConfig(effectiveParsingMode)
    const isFamilyMode = effectiveParsingMode === "family"
    const selectedProductId = normalizeText(decisionResult?.selectedProductId || "")
    const selectedVariantId = normalizeText(decisionResult?.selectedVariantId || "")
    const showProductSelector = (decisionResult?.productCandidates?.length || 0) > 1 && !selectedProductId
    const showVariantSelector = !showProductSelector && (decisionResult?.variantCandidates?.length || 0) > 1 && !selectedVariantId
    const decisionCharacteristics = !showProductSelector && !showVariantSelector ? (decisionResult?.characteristics || []) : []
    const canShowDecisionTabNav = decisionCharacteristics.length > 3
    const maxDecisionTabsWindowStart = Math.max(0, decisionCharacteristics.length - 3)
    const decisionTabsWindowStart = Math.min(appState.decisionTabsWindowStart, maxDecisionTabsWindowStart)
    const visibleDecisionChoices = canShowDecisionTabNav
      ? decisionCharacteristics.slice(decisionTabsWindowStart, decisionTabsWindowStart + 3).map((choice, offset) => ({
          choice,
          index: decisionTabsWindowStart + offset
        }))
      : decisionCharacteristics.map((choice, index) => ({ choice, index }))
    const showDecisionContext = false
    const activeDecisionChoice =
      appState.activeDecisionChoiceIndex >= 0 && appState.activeDecisionChoiceIndex < decisionCharacteristics.length
        ? decisionCharacteristics[appState.activeDecisionChoiceIndex]
        : null
    const pageExplanation = appState.wordStatsPage ? getPageRetrievalExplanation(documentRecord, appState.wordStatsPage) : null
    const viewerPageLimit = isFamilyMode ? getFamilyResultPageLimit() : 3
    const viewerTopPages = (hasAiForActiveDocument ? topPages.slice(0, viewerPageLimit) : appState.rankedPages.slice(0, viewerPageLimit).map((page) => ({
      ...page,
      metrics: getPageTextMetrics(documentRecord, page.pageNumber)
    })))
      .filter(Boolean)
    const topPageLabels = documentRecord
      ? hasAiForActiveDocument
        ? viewerTopPages.map((page) =>
            getAiOnlyTopPageLabel(page)
            || getRelativePageDescriptor(documentRecord, page.pageNumber, page, viewerTopPages)
          )
        : []
      : []
    const waitingOnAiLabels = Boolean(
      documentRecord &&
      hasVisionAccess() &&
      (appState.analyzeRequestLoading || appState.aiRerankLoading) &&
      !hasAiForActiveDocument
    )
    const gateViewerUntilAiReady = waitingOnAiLabels
    const productFirstSessionActive = isProductFirstSessionActive()
    const canShowPageStripNav = viewerTopPages.length > 3
    const showHelpSpecPanel = Boolean(
      documentRecord &&
      (appState.decisionAssistLoading || decisionResult || appState.errorMessage || appState.aiRerankError || appState.decisionAssistError)
    )
    const visibleModelBackedProductCandidates = getDisplayableModelBackedProductCandidates(structureRouting)
    const familyWideProductCandidates = getFamilyWideProductCandidates(documentRecord, structureRouting)
    const familyWideModelBackedCount = countDistinctProductIdentifiers(familyWideProductCandidates)
    const retrievalGuidance = getRetrievalGuidance(documentRecord, appState.rankedPages, structureRouting)
    const primaryUiMode = getPrimaryUiMode(documentRecord, structureRouting, retrievalGuidance)
    const blockProductChoicesForBroadSearch = shouldBlockProductChoicesForBroadSearch(documentRecord, retrievalGuidance, structureRouting)
    const aiDebugPayload = getAiDebugPayload(documentRecord, structureRouting)
    const canShowAiDebug = bothDecisionPending
      ? false
      : websiteMode
      ? Boolean(appState.websiteSummaryPrompt || appState.websiteSummaryRawText || appState.websiteSummarySource)
      : Boolean(appState.aiRerankRawText || appState.aiRerankResult)
    const selectedProductDisplayLabel = getSelectedProductDisplayLabel(decisionResult, structureRouting)
    const documentDateCallout = getDocumentDateCallout()
    const showPagesUi = primaryUiMode === "show_pages"
    const showModelNumbersUi = primaryUiMode === "show_model_numbers"
    const showNarrowSearchUi = primaryUiMode === "narrow_search"
    const showUncertainStructureUi = primaryUiMode === "uncertain_structure"
    const viewerLoadingState = getViewerLoadingState(documentRecord)
    const hidePageStripForMultiProductNarrowing = Boolean(
      documentRecord
      && isFamilyMode
      && !showPagesUi
      && !productFirstSessionActive
    )
    const showProductFirstEntry = Boolean(
      documentRecord
      && !gateViewerUntilAiReady
      && showModelNumbersUi
      && visibleModelBackedProductCandidates.length > 0
      && !productFirstSessionActive
    )
    const familyPageSelectionKey = documentRecord ? getFamilyPageSelectionKey(documentRecord, appState.activePageNumber) : ""
    const activeFamilyPageSelections = familyPageSelectionKey ? (appState.familyPageProductsByKey[familyPageSelectionKey] || []) : []
    const showPageLevelNarrowingOnly = primaryUiMode === "narrow_search"
    const activeFamilyPageSelectionStatus = familyPageSelectionKey ? (appState.familyPageProductsStatusByKey[familyPageSelectionKey] || "") : ""
    const activeFamilyPageSelectionError = familyPageSelectionKey ? (appState.familyPageProductsErrorByKey[familyPageSelectionKey] || "") : ""
    const showPageLevelProductSelector = Boolean(
      false
    )
    const statusScore = Number.isFinite(activeDocumentSourceScore)
      ? activeDocumentSourceScore
      : topMatch
        ? Math.min(99, Math.max(12, Math.round(getDisplayScore(topMatch))))
        : null
    const baseRenderWidth = getViewerBaseRenderWidth()
    const plainPdfMode = appState.plainPdfMode && !websiteMode
    const hideFieldPanelHeader = Boolean(normalizeText(appState.loadingMessage || ""))
    const loadingStepTraceHtml = (appState.analyzeRequestLoading || normalizeText(appState.loadingMessage || ""))
      ? appState.loadingHistory
          .filter((entry) => normalizeText(entry?.title || "") || normalizeText(entry?.copy || ""))
          .map((entry, index) => {
            const endedAt = Number.isFinite(entry?.endedAt) ? entry.endedAt : Date.now()
            const startedAt = Number.isFinite(entry?.startedAt) ? entry.startedAt : endedAt
            const durationMs = Math.max(0, Number.isFinite(entry?.durationMs) && entry.durationMs > 0
              ? entry.durationMs
              : endedAt - startedAt)
            return `
              <div class="loading-step-trace-item">
                <div class="loading-step-trace-index">${index + 1}</div>
                <div class="loading-step-trace-body">
                  <p class="loading-step-trace-title">${escapeHtml(entry.title || "")}</p>
                  <p class="loading-step-trace-copy">${escapeHtml(entry.copy || "")}</p>
                  <p class="loading-step-trace-meta">${escapeHtml(`Step ${formatElapsedDuration(durationMs)}`)}</p>
                </div>
              </div>
            `
          })
          .join("")
      : ""
    const loadingHistoryModalHtml = appState.loadingHistory
      .filter((entry) => normalizeText(entry?.title || "") || normalizeText(entry?.copy || ""))
      .map((entry, index) => {
        const endedAt = Number.isFinite(entry?.endedAt) ? entry.endedAt : Date.now()
        const startedAt = Number.isFinite(entry?.startedAt) ? entry.startedAt : endedAt
        const durationMs = Math.max(
          0,
          Number.isFinite(entry?.durationMs) && entry.durationMs > 0
            ? entry.durationMs
            : endedAt - startedAt
        )
        return `
          <div class="loading-history-item">
            <div class="loading-history-item-index">${index + 1}</div>
            <div class="loading-history-item-body">
              <p class="loading-history-item-title">${escapeHtml(entry.title || "")}</p>
              <p class="loading-history-item-copy">${escapeHtml(entry.copy || "")}</p>
              <p class="loading-history-item-meta">${escapeHtml(`Step ${formatElapsedDuration(durationMs)}`)}</p>
            </div>
          </div>
        `
      })
      .join("")
    const canShowLoadingHistory = appState.loadingHistory.some((entry) => normalizeText(entry?.title || "") || normalizeText(entry?.copy || ""))
    const websitePdfLoadListHtml = appState.websitePdfLoadItems.length
      ? `
          <div class="help-spec-reference-block">
            <p class="help-spec-selector-title">PDFs being ingested</p>
            <ul class="help-spec-reference-list help-spec-reference-list-load">
              ${appState.websitePdfLoadItems.map((item) => `
                <li>
                  <strong class="help-spec-load-title">${escapeHtml(item.label || "PDF")}</strong>
                  <span class="option-source-chip option-source-chip-subtle">${escapeHtml(item.sizeLabel || "Size unavailable")}</span>
                  <span class="option-copy-meta help-spec-load-status">${escapeHtml(
                    item.status === "loaded"
                      ? "Loaded"
                      : item.status === "parsing"
                        ? "Parsing"
                        : item.status === "fetching"
                          ? "Fetching"
                          : "Queued"
                  )}</span>
                  ${item.href ? `<div class="option-copy-meta help-spec-load-url">${escapeHtml(item.href)}</div>` : ""}
                </li>
              `).join("")}
            </ul>
          </div>
        `
      : ""
    const websiteFrameStatus = appState.websiteFrameStatus
    const websiteLoaded = websiteMode && Boolean(appState.websiteUrl)
    const websiteBlocked = websiteMode && websiteLoaded && websiteFrameStatus === "blocked"
    const websiteLoading = websiteMode && websiteLoaded && websiteFrameStatus === "loading"
    const websiteSummary = appState.websiteSummary
    const websiteBrowserHeight = getPreferredWebsiteBrowserHeight()
    const leftRailCollapsed = Boolean(appState.leftRailCollapsed)
    const routingLabel = bothMode
      ? (appState.activeNarrativeSource === "website" ? "Website" : appState.activeNarrativeSource === "pdf" ? "PDF" : "")
      : ""
    const submitLabel = appState.analyzeRequestLoading || appState.loadingMessage ? "Working..." : "Load Website"

    app.innerHTML = `
      <div class="app-shell ${plainPdfMode ? "app-shell-plain-pdf" : ""}">
        <section class="session-bar">
          <div class="session-bar-controls session-bar-controls-website">
            <div class="session-control">
              <label for="website-url">Website URL</label>
              <input id="website-url" value="${escapeHtml(appState.websiteUrlInput)}" placeholder="https://example.com/product-page" />
            </div>
            <div class="session-control session-control-product-name">
              <label for="product-name">Product Name</label>
              <input id="product-name" data-draft-input="productName" value="${escapeHtml(appState.inputDraft.productName)}" placeholder="Eames Lounge Chair and Ottoman" />
            </div>
            <div class="session-control">
              <label for="vision-api-key">OpenAI API Key</label>
              <input id="vision-api-key" type="password" value="${escapeHtml(appState.visionApiKey)}" placeholder="sk-..." />
            </div>
            <div class="session-submit">
              <button class="session-submit-btn" id="session-submit-btn" type="button" ${appState.analyzeRequestLoading ? "disabled" : ""}>
                ${submitLabel}
              </button>
              <button class="session-live-btn ${appState.liveCssEnabled ? "is-active" : ""}" id="session-live-btn" type="button" aria-pressed="${appState.liveCssEnabled ? "true" : "false"}">
                Live CSS
              </button>
            </div>
          </div>
          ${appState.errorMessage ? `<p class="session-status session-status-error">${escapeHtml(appState.errorMessage)}</p>` : ""}
        </section>

        <section class="workspace-layout ${plainPdfMode ? "workspace-layout-plain-pdf" : ""} ${leftRailCollapsed ? "workspace-layout-left-collapsed" : ""}">
          <div class="viewer-column ${leftRailCollapsed ? "viewer-column-collapsed" : ""}">
            <button class="workspace-rail-toggle ${leftRailCollapsed ? "is-collapsed" : ""}" id="workspace-rail-toggle" type="button" aria-pressed="${leftRailCollapsed ? "true" : "false"}" aria-label="${leftRailCollapsed ? "Expand left rail" : "Collapse left rail"}" title="${leftRailCollapsed ? "Expand left rail" : "Collapse left rail"}">${leftRailCollapsed ? "›" : "‹"}</button>
            ${leftRailCollapsed
              ? ""
              : `${showPdfWorkspaceHeader
                ? `
                  <div class="workspace-header">
                    <div class="workspace-header-main">
                          <div class="workspace-doc-pill">
                            <select class="workspace-doc-select" id="document-select" ${appState.documents.length ? "" : "disabled"}>
                              ${appState.documents
                                .map((document) => {
                                  const sourceScore = sourceScoreById.get(document.id)
                                  const prefix = Number.isFinite(sourceScore) ? `${sourceScore} · ` : ""
                                  return `
                                    <option value="${document.id}" ${document.id === appState.activeDocumentId ? "selected" : ""}>
                                      ${escapeHtml(`${prefix}${document.title}`)}
                                    </option>
                                  `
                                })
                                .join("")}
                            </select>
                          </div>
                          ${plainPdfMode
                            ? ""
                            : `
                          <div class="workspace-status">
                            <span class="confidence-dot confidence-dot-single" aria-hidden="true"></span>
                            <span class="workspace-score">${formatUiScore(statusScore)}</span>
                          </div>
                          `}
                          <div class="viewer-zoom-controls" aria-label="PDF zoom controls">
                            <button class="viewer-zoom-btn" id="zoom-out-btn" type="button" aria-label="Zoom out">-</button>
                            <button class="viewer-zoom-btn viewer-zoom-reset" id="zoom-reset-btn" type="button" aria-label="Reset zoom">${getPdfZoomLabel()}</button>
                            <button class="viewer-zoom-btn" id="zoom-in-btn" type="button" aria-label="Zoom in">+</button>
                            ${canShowLoadingHistory
                              ? `<button class="viewer-zoom-btn viewer-source-btn" id="open-loading-history-btn" type="button" aria-label="Open loading history">◷</button>`
                              : ""
                            }
                            ${plainPdfMode
                              ? ""
                              : `<button class="viewer-zoom-btn viewer-source-btn" id="open-ai-debug-btn" type="button" aria-label="Open source view" ${canShowAiDebug ? "" : "disabled"}>&lt;/&gt;</button>`
                            }
                          </div>
                    </div>
                    ${
                      !websiteMode && documentDateCallout
                        ? `
                          <div class="workspace-date-callout">
                            <span class="workspace-date-callout-label">Document Date</span>
                            <strong>${escapeHtml(documentDateCallout)}</strong>
                          </div>
                        `
                        : ""
                    }
                    ${
                      !websiteMode && appState.sourceRoutingReason
                        ? `
                          <div class="workspace-routing-callout">
                            <div class="workspace-routing-copy">
                              <span class="workspace-routing-label">${escapeHtml(bothMode && routingLabel ? `Loaded ${routingLabel} Narrative` : "Goal: Fill Attributes")}</span>
                              ${!bothMode ? "" : `<strong>${escapeHtml(appState.sourceRoutingReason)}</strong>`}
                            </div>
                            <div class="workspace-routing-actions">
                              ${bothMode && appState.sourceRoutingDetails
                                ? `<button class="ghost-btn" id="open-routing-details-btn" type="button">Why this source?</button>`
                                : ""
                              }
                              ${bothMode && appState.alternateNarrativeSource
                                ? `<button class="ghost-btn" id="switch-narrative-source-btn" type="button">Switch to ${escapeHtml(appState.alternateNarrativeSource === "website" ? "Website" : "PDF")}</button>`
                                : ""
                              }
                            </div>
                          </div>
                        `
                        : ""
                    }
                  </div>
                `
                : ""
              }`}

            ${documentRecord && !websiteMode && !plainPdfMode && !gateViewerUntilAiReady && showPagesUi && !productFirstSessionActive && !hidePageStripForMultiProductNarrowing
              ? `
                <div class="page-strip ${viewerTopPages.length <= 3 ? "page-strip-centered" : ""}">
                  ${canShowPageStripNav && appState.pageStripCanScrollLeft ? '<button class="page-strip-nav page-strip-nav-left" id="page-strip-nav-left" type="button" aria-label="Previous page results">‹</button>' : ""}
                  <div class="page-strip-track" id="page-strip-track">
                    ${
                      viewerTopPages.length
                        ? viewerTopPages
                            .map((page) => {
                              const isActive = page.pageNumber === appState.activePageNumber
                              const label =
                                topPageLabels[viewerTopPages.findIndex((candidate) => candidate.pageNumber === page.pageNumber)]
                                || (waitingOnAiLabels ? "Finding distinction..." : "")
                              return `
                                <div class="page-chip-shell ${isActive ? "is-active" : ""}">
                                  <button class="page-chip ${isActive ? "is-active" : ""}" data-jump-page="${page.pageNumber}" type="button">
                                    <div class="page-chip-topline">
                                      <span class="page-chip-number">Page ${page.pageNumber}</span>
                                      <span class="page-chip-score">${escapeHtml(formatPageChipScore(page, viewerTopPages))}</span>
                                    </div>
                                    ${label ? `<span class="page-chip-label">${escapeHtml(label)}</span>` : ""}
                                  </button>
                                </div>
                              `
                            })
                            .join("")
                        : `<div class="page-strip-empty">No ranked pages available yet.</div>`
                    }
                  </div>
                  ${canShowPageStripNav && appState.pageStripCanScrollRight ? '<button class="page-strip-nav page-strip-nav-right" id="page-strip-nav-right" type="button" aria-label="More page results">›</button>' : ""}
                </div>
              `
              : ""}

            ${
              !websiteMode && !plainPdfMode && showUncertainStructureUi && !productFirstSessionActive
                ? `
                  <div class="help-spec-panel">
                    <div class="help-spec-card">
                      <div class="help-spec-selector-block">
                        <div class="help-spec-selector-head">
                          <p class="help-spec-selector-title">Assisted view is uncertain</p>
                          <p class="help-spec-selector-copy">We’re not yet certain which assisted view path to use for this PDF. We suggest switching to plain view and continuing from the document directly.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                `
                : ""
            }

            ${
              !websiteMode && !plainPdfMode && !showUncertainStructureUi && ((showModelNumbersUi && !productFirstSessionActive) || (showNarrowSearchUi && !productFirstSessionActive))
                ? `
                  <div class="help-spec-panel">
                    <div class="help-spec-card">
                      <div class="help-spec-selector-block">
                        <div class="help-spec-selector-head">
                          <p class="help-spec-selector-title">${showNarrowSearchUi ? "Search Query Is Too Broad" : "Select the product"}</p>
                          <p class="help-spec-selector-copy">${
                            showNarrowSearchUi
                              ? "Either help us narrow in by selecting some of the buttons below. OR switch to Plain PDF mode."
                              : visibleModelBackedProductCandidates.length === 1
                                ? "This search matches one product. Click it to jump to its page."
                                : "Pick a product to jump to its page."
                          }</p>
                          ${showNarrowSearchUi ? renderRetrievalGuidance(retrievalGuidance) : ""}
                        </div>
                        ${
                          showNarrowSearchUi
                            ? ""
                            : `
                              <div class="help-spec-selector-grid">
                                ${visibleModelBackedProductCandidates
                                  .map((candidate) => {
                                    const candidatePageNumber = getCandidatePageNumber(candidate, appState.structureRouting?.productFirstPageNumber || appState.aiRerankResult?.bestPage || appState.activePageNumber, documentRecord)
                                    const candidateDistinction = getProductCardDistinction(candidate, documentRecord, candidatePageNumber)
                                    const isSelectedProduct = normalizeText(appState.productFirstSelection?.productId || "") === normalizeText(candidate.id)
                                    return `
                                      <div class="help-spec-selector-card-shell ${isSelectedProduct ? "is-active" : ""}">
                                        <button class="help-spec-selector-card ${isSelectedProduct ? "is-active" : ""}" data-product-first-jump="${escapeHtmlAttribute(candidate.id)}" data-jump-page="${escapeHtmlAttribute(candidatePageNumber || "")}" type="button">
                                          <strong>${escapeHtml(getProductCardTitle(candidate))}</strong>
                                          ${shouldShowSeparateProductCardModelCode(candidate) ? `<span>${escapeHtml(getProductCardModelCode(candidate))}</span>` : ""}
                                          ${candidateDistinction ? `<span>${escapeHtml(candidateDistinction)}</span>` : ""}
                                          ${candidatePageNumber ? `<em>pdf p.${escapeHtml(String(candidatePageNumber))}</em>` : ""}
                                        </button>
                                      </div>
                                    `
                                  })
                                  .join("")}
                              </div>
                            `
                        }
                      </div>
                    </div>
                  </div>
                `
                : ""
            }

            ${!websiteMode && !plainPdfMode && appState.decisionAssistResult ? renderDecisionAssistResolvedAttributes() : ""}

            ${documentRecord && gateViewerUntilAiReady && !websiteMode && !plainPdfMode ? `<div class="page-strip"></div>` : ""}

            ${
              !websiteMode && !plainPdfMode && showPageLevelProductSelector
                ? `
                  <div class="help-spec-panel">
                    <div class="help-spec-card">
                      <div class="help-spec-selector-block">
                        <div class="help-spec-selector-head">
                          <p class="help-spec-selector-title">Select the product on page ${appState.activePageNumber}</p>
                          <p class="help-spec-selector-copy">${
                            showPageLevelNarrowingOnly
                              ? "This page contains too many product rows to show as a reliable chooser. Narrow the search first."
                              : "Choose the exact product row shown on this page. Help Me Spec will start only after this selection, so the system does not need to infer the product from the whole family."
                          }</p>
                          ${renderRetrievalGuidance(retrievalGuidance)}
                        </div>
                        ${
                          activeFamilyPageSelectionStatus === "loading"
                            ? `<p class="help-spec-loading-inline">${escapeHtml("Reading visible product rows on this page...")}</p>`
                          : activeFamilyPageSelectionStatus === "error"
                              ? `<p class="inline-ai-error">${escapeHtml(activeFamilyPageSelectionError || "Unable to detect the visible products on this page.")}</p>`
                              : showPageLevelNarrowingOnly
                                ? ""
                                : `
                                <div class="help-spec-selector-grid">
                                  ${activeFamilyPageSelections
                                    .map((candidate) => `
                                      <button class="help-spec-selector-card" data-help-spec-page-product="${escapeHtmlAttribute(candidate.id)}" type="button">
                                        <strong>${escapeHtml(candidate.label)}</strong>
                                        ${candidate.description ? `<span>${escapeHtml(candidate.description)}</span>` : ""}
                                      </button>
                                    `)
                                    .join("")}
                                </div>
                              `
                        }
                      </div>
                    </div>
                  </div>
                `
                : ""
            }

            ${!websiteMode && !plainPdfMode && showHelpSpecPanel
              ? `
                <div class="help-spec-panel">
                  ${
                    appState.decisionAssistLoading
                      ? `
                        <div class="help-spec-card help-spec-card-loading">
                          <div class="loading-orb" aria-hidden="true"></div>
                          <p class="help-spec-loading-inline">${escapeHtml(getHelpSpecLoadingLine())}</p>
                        </div>
                      `
                      : decisionResult
                      ? `
                        <div class="help-spec-card">
                          ${
                            decisionResult.fromProductFirst && selectedProductDisplayLabel
                              ? `
                                <div class="help-spec-selection-lock">
                                  <div>
                                    <p class="help-spec-selection-label">Selected product</p>
                                    <strong>${escapeHtml(selectedProductDisplayLabel)}</strong>
                                  </div>
                                  <button class="ghost-btn" data-change-product-selection type="button">Change selection</button>
                                </div>
                              `
                              : ""
                          }
                          ${
                            showDecisionContext
                              ? `
                                <div class="help-spec-context">
                                  <div class="help-spec-context-head">
                                    <div>
                                      <p class="help-spec-eyebrow">Help Me Spec</p>
                                      <h3 class="help-spec-title">${escapeHtml(decisionResult.productName || "Product under review")}</h3>
                                      ${
                                        decisionResult.modelFamily
                                          ? `<p class="help-spec-subtitle">${escapeHtml(decisionResult.modelFamily)}</p>`
                                          : ""
                                      }
                                    </div>
                                    ${
                                      decisionResult.pageRangeLabel
                                        ? `<span class="help-spec-page-range">Pages ${escapeHtml(decisionResult.pageRangeLabel)}</span>`
                                        : ""
                                    }
                                  </div>
                                  ${
                                    decisionResult.summary
                                      ? `<p class="help-spec-summary">${escapeHtml(decisionResult.summary)}</p>`
                                      : ""
                                  }
                                  <div class="help-spec-trust-grid">
                                    ${
                                      decisionResult.includedPages?.length
                                        ? `
                                          <div class="help-spec-trust-item">
                                            <span>Pages used</span>
                                            <strong>${escapeHtml(formatPageRangeLabel(decisionResult.includedPages))}</strong>
                                          </div>
                                        `
                                        : ""
                                    }
                                    ${
                                      decisionResult.inclusionSummary
                                        ? `
                                          <div class="help-spec-trust-item">
                                            <span>Why included</span>
                                            <strong>${escapeHtml(decisionResult.inclusionSummary)}</strong>
                                          </div>
                                        `
                                        : ""
                                    }
                                    ${
                                      decisionResult.stopReason
                                        ? `
                                          <div class="help-spec-trust-item">
                                            <span>Where it stopped</span>
                                            <strong>${escapeHtml(decisionResult.stopReason)}</strong>
                                          </div>
                                        `
                                        : ""
                                    }
                                  </div>
                                </div>
                              `
                              : ""
                          }

                          ${
                            showProductSelector
                              ? `
                                <div class="help-spec-selector-block">
                                  <div class="help-spec-selector-head">
                                    <p class="help-spec-selector-title">${escapeHtml(parsingModeConfig.selectorProductTitle)}</p>
                                    <p class="help-spec-selector-copy">${escapeHtml(parsingModeConfig.selectorProductCopy)}</p>
                                    ${renderRetrievalGuidance(retrievalGuidance)}
                                  </div>
                                  <div class="help-spec-selector-grid">
                                    ${decisionResult.productCandidates
                                      .map((candidate) => `
                                        <button class="help-spec-selector-card" data-help-spec-product="${escapeHtmlAttribute(candidate.id)}" type="button">
                                          <strong>${escapeHtml(candidate.label)}</strong>
                                        </button>
                                      `)
                                      .join("")}
                                  </div>
                                </div>
                              `
                              : ""
                          }

                          ${
                            showVariantSelector
                              ? `
                                <div class="help-spec-selector-block">
                                  <div class="help-spec-selector-head">
                                    <p class="help-spec-selector-title">${escapeHtml(parsingModeConfig.selectorVariantTitle)}</p>
                                    <p class="help-spec-selector-copy">${escapeHtml(parsingModeConfig.selectorVariantCopy)}</p>
                                  </div>
                                  <div class="help-spec-selector-grid">
                                    ${decisionResult.variantCandidates
                                      .map((candidate) => `
                                        <button class="help-spec-selector-card" data-help-spec-variant="${escapeHtmlAttribute(candidate.id)}" type="button">
                                          <strong>${escapeHtml(candidate.label)}</strong>
                                        </button>
                                      `)
                                      .join("")}
                                  </div>
                                </div>
                              `
                              : ""
                          }

                          ${
                            decisionCharacteristics.length
                              ? `
                                <div class="decision-choice-strip ${canShowDecisionTabNav && decisionTabsWindowStart > 0 ? "has-left-nav" : ""} ${canShowDecisionTabNav && decisionTabsWindowStart < maxDecisionTabsWindowStart ? "has-right-nav" : ""}">
                                  ${canShowDecisionTabNav && decisionTabsWindowStart > 0 ? '<button class="decision-choice-nav decision-choice-nav-left" id="decision-choice-nav-left" type="button" aria-label="Previous spec tabs">‹</button>' : ""}
                                  <div class="decision-choice-tabs" id="decision-choice-tabs-track">
                                    ${visibleDecisionChoices
                                      .map(({ choice, index }) => `
                                        <button class="decision-choice-tab ${index === appState.activeDecisionChoiceIndex ? "is-active" : ""}" data-choice-tab="${index}" type="button">
                                          ${escapeHtml(choice.label || `Characteristic ${index + 1}`)}
                                        </button>
                                      `)
                                      .join("")}
                                  </div>
                                  ${canShowDecisionTabNav && decisionTabsWindowStart < maxDecisionTabsWindowStart ? '<button class="decision-choice-nav decision-choice-nav-right" id="decision-choice-nav-right" type="button" aria-label="More spec tabs">›</button>' : ""}
                                </div>
                                ${
                                  activeDecisionChoice
                                    ? `
                                      <div class="help-spec-grid">
                                        ${(() => {
                                          const parsedOptions = getCharacteristicOptions(activeDecisionChoice)
                                          const conciseComparison = buildFallbackConciseComparison(activeDecisionChoice)
                                          const isDimensionsCharacteristic = /size|dimension/i.test(activeDecisionChoice.label || "")
                                          const isConfigurationCharacteristic = /configuration/i.test(activeDecisionChoice.label || "")
                                          const isUpholsteryCharacteristic = /upholstery|material/i.test(activeDecisionChoice.label || "")
                                          const isShellFinishCharacteristic = /shell finish|frame finish|wood finish|finish/i.test(activeDecisionChoice.label || "")
                                          const configurationSections = isConfigurationCharacteristic ? getConfigurationSections(activeDecisionChoice) : []
                                          const configurationMatrix = isConfigurationCharacteristic ? getConfigurationMatrix(activeDecisionChoice) : null
                                          const useCompactOptionCards = isUpholsteryCharacteristic || isShellFinishCharacteristic
                                          const useCompactSourceRow = useCompactOptionCards || isDimensionsCharacteristic
                                          const useCompactPriceStyle = useCompactOptionCards
                                          const sourceFallbackPage = decisionResult?.includedPages?.[0] || decisionResult?.startPage || appState.activePageNumber
                                          return `
                                            <div class="option-card option-card-expanded">
                                              <div class="option-card-header">
                                                <span class="option-card-title">${escapeHtml(activeDecisionChoice.label || "Characteristic")}</span>
                                                ${
                                                  activeDecisionChoice.blurb
                                                    ? `<span class="option-card-summary">${escapeHtml(activeDecisionChoice.blurb)}</span>`
                                                    : conciseComparison
                                                      ? `<span class="option-card-summary">${escapeHtml(conciseComparison)}</span>`
                                                      : ""
                                                }
                                              </div>
                                              ${parsedOptions.length
                                                ? `
                                                  ${isConfigurationCharacteristic
                                                    ? `
                                                      <div class="configuration-section-list">
                                                        ${!configurationMatrix
                                                          ? configurationSections
                                                              .map((section, index) => {
                                                                return `
                                                                  <section class="configuration-section ${index > 0 ? "configuration-section-with-divider" : ""}">
                                                                    <h4 class="configuration-section-title">${escapeHtml(section.title)}</h4>
                                                                    ${
                                                                      section.options.length
                                                                        ? `
                                                                          <div class="configuration-section-items">
                                                                            ${section.options
                                                                              .map((item) => `
                                                                                <div class="configuration-section-item">
                                                                                  <span>${escapeHtml(item)}</span>
                                                                                </div>
                                                                              `)
                                                                              .join("")}
                                                                          </div>
                                                                        `
                                                                          : ""
                                                                    }
                                                                  </section>
                                                                `
                                                              })
                                                              .join("")
                                                          : ""}
                                                        ${
                                                          configurationMatrix
                                                            ? `
                                                              <div class="configuration-matrix">
                                                                <div class="configuration-matrix-row configuration-matrix-head">
                                                                  <span>${escapeHtml(configurationMatrix.rowLabel || "Configuration")}</span>
                                                                  ${configurationMatrix.columns.map((column) => `<span>${escapeHtml(column)}</span>`).join("")}
                                                                </div>
                                                                ${configurationMatrix.rows
                                                                  .map((row) => `
                                                                    <div class="configuration-matrix-row">
                                                                      <span class="configuration-matrix-label">${escapeHtml(row.name)}</span>
                                                                      ${configurationMatrix.columns
                                                                        .map((column) => {
                                                                          const columnMatchKey = getConfigurationMatchKey(column)
                                                                          const matchingCell = row.cells.find((cell) => {
                                                                            return (cell.matchKey || getConfigurationMatchKey(cell.column)) === columnMatchKey
                                                                          })
                                                                          const price = matchingCell?.price || "-"
                                                                          return `
                                                                            <span class="configuration-matrix-cell">
                                                                              ${price !== "-" ? `<button class="option-copy-trigger configuration-section-price" data-copy-value="${escapeHtml(price)}" type="button">${escapeHtml(price)}</button>` : `<span>${escapeHtml(price)}</span>`}
                                                                              ${matchingCell?.model ? `<button class="option-copy-trigger configuration-section-model" data-copy-value="${escapeHtml(matchingCell.model)}" type="button">${escapeHtml(matchingCell.model)}</button>` : ""}
                                                                            </span>
                                                                          `
                                                                        })
                                                                        .join("")}
                                                                    </div>
                                                                  `)
                                                                  .join("")}
                                                              </div>
                                                            `
                                                            : ""
                                                        }
                                                      </div>
                                                    `
                                                    : `
                                                      <div class="option-detail-grid ${useCompactOptionCards ? "option-detail-grid-compact" : ""}">
                                                        ${parsedOptions
                                                          .map((option) => {
                                                            const valueLines = useCompactOptionCards ? [] : parseOptionValueLines(option.values)
                                                            const formattedPricing = useCompactOptionCards
                                                              ? getCompactOptionPricing(option)
                                                              : formatOptionPricingLabel(option.pricing)
                                                            const pricingRows = extractTextileRequirementRows(option.pricing)
                                                            const pricingParts = formattedPricing.split(/:\s+/)
                                                            return `
                                                              <div class="option-detail-card ${useCompactOptionCards ? "option-detail-card-compact" : ""}">
                                                                <button class="option-copy-trigger option-copy-name" data-copy-value="${escapeHtml(option.name)}" type="button">${escapeHtml(option.name)}</button>
                                                                ${
                                                                  valueLines.length
                                                                    ? `
                                                                      <div class="option-value-list">
                                                                        ${valueLines
                                                                          .map((line) => `
                                                                            <div class="option-value-row">
                                                                              ${
                                                                                line.label
                                                                                  ? `<span class="option-value-label">${escapeHtml(line.label)}:</span>`
                                                                                  : ""
                                                                              }
                                                                              <button class="option-copy-trigger option-copy-value option-copy-value-inline" data-copy-value="${escapeHtml(line.value)}" type="button">${escapeHtml(line.value)}</button>
                                                                            </div>
                                                                          `)
                                                                          .join("")}
                                                                      </div>
                                                                    `
                                                                    : ""
                                                                }
                                                                ${
                                                                  option.pricing
                                                                    ? isDimensionsCharacteristic && pricingRows.length
                                                                      ? `
                                                                        ${pricingRows
                                                                          .map((row) => {
                                                                            const rowParts = row.split(/:\s+/)
                                                                            if (rowParts.length !== 2) return ""
                                                                            return `
                                                                              <div class="option-value-row">
                                                                                <span class="option-value-label">${escapeHtml(rowParts[0])}:</span>
                                                                                <button class="option-copy-trigger option-copy-value option-copy-value-inline" data-copy-value="${escapeHtml(rowParts[1])}" type="button">${escapeHtml(rowParts[1])}</button>
                                                                              </div>
                                                                            `
                                                                          })
                                                                          .join("")}
                                                                      `
                                                                      : isDimensionsCharacteristic && pricingParts.length === 2
                                                                      ? `
                                                                        <div class="option-value-row">
                                                                          <span class="option-value-label">${escapeHtml(pricingParts[0])}:</span>
                                                                          <button class="option-copy-trigger option-copy-value option-copy-value-inline" data-copy-value="${escapeHtml(pricingParts[1])}" type="button">${escapeHtml(pricingParts[1])}</button>
                                                                        </div>
                                                                      `
                                                                      : `<span class="option-copy-meta ${useCompactPriceStyle ? "option-copy-price-emphasis" : ""}">${useCompactPriceStyle ? escapeHtml(formattedPricing) : `Pricing: ${escapeHtml(formattedPricing)}`}</span>`
                                                                    : ""
                                                                }
                                                                ${option.difference && !isDimensionsCharacteristic && !useCompactOptionCards
                                                                  ? `<span class="option-copy-meta">${escapeHtml(option.difference)}</span>`
                                                                  : ""}
                                                                ${
                                                                  useCompactSourceRow && option.evidence
                                                                    ? `<span class="option-source-chip option-source-chip-subtle">${escapeHtml(formatCompactSourceLabel(option.evidence, sourceFallbackPage))}</span>`
                                                                    : ""
                                                                }
                                                                ${
                                                                  useCompactSourceRow && !option.evidence
                                                                    ? `<span class="option-source-chip option-source-chip-subtle">${escapeHtml(formatCompactSourceLabel("", sourceFallbackPage))}</span>`
                                                                    : ""
                                                                }
                                                                ${
                                                                  !useCompactSourceRow && option.evidence
                                                                    ? `<span class="option-copy-meta">${escapeHtml(option.evidence)}</span>`
                                                                    : ""
                                                                }
                                                              </div>
                                                            `
                                                          })
                                                          .join("")}
                                                      </div>
                                                    `}
                                                `
                                                : `<div class="option-row"><span class="option-copy-meta">${escapeHtml(activeDecisionChoice.blurb || "No explicit options found for this characteristic.")}</span></div>`
                                              }
                                            </div>
                                          `
                                        })()}
                                      </div>
                                    `
                                    : ""
                                }
                              `
                              : !showProductSelector && !showVariantSelector
                                ? `
                                  <div class="help-spec-empty">
                                    <p>No characteristic modules were identified yet for this product section.</p>
                                  </div>
                                `
                                : ""
                          }

                          ${
                            decisionResult.referenceInfo?.length
                              ? `
                                <div class="help-spec-reference-block">
                                  <p class="help-spec-selector-title">Reference details</p>
                                  <ul class="help-spec-reference-list">
                                    ${decisionResult.referenceInfo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                                  </ul>
                                </div>
                              `
                              : ""
                          }
                        </div>
                      `
                      : ""
                  }

                  ${appState.errorMessage ? `<p class="error-banner">${escapeHtml(appState.errorMessage)}</p>` : ""}
                  ${appState.aiRerankError ? `<p class="error-banner">${escapeHtml(appState.aiRerankError)}</p>` : ""}
                  ${appState.decisionAssistError ? `<p class="error-banner">${escapeHtml(appState.decisionAssistError)}</p>` : ""}
                </div>
              `
              : ""}

            <div class="pdf-panel ${plainPdfMode ? "pdf-panel-plain-pdf" : ""}">
              ${showPdfWorkspaceHeader && !plainPdfMode
                ? `
                  <div class="plain-pdf-entry">
                    <button class="plain-pdf-entry-btn" id="plain-pdf-mode-btn" type="button" aria-label="Switch to plain PDF mode">
                      Switch to Plain PDF
                    </button>
                  </div>
                `
                : ""}
              ${documentRecord && !websiteMode && plainPdfMode
                ? `
                  <div class="plain-pdf-floating-controls">
                    <button class="plain-pdf-floating-btn" id="plain-pdf-exit-btn" type="button">Switch to Assisted View</button>
                  </div>
                `
                : ""}
              <div class="viewer-scroll" id="viewer-scroll">
                ${
                  bothDecisionPending
                    ? (
                        appState.analyzeRequestLoading
                          ? `
                              <div class="viewer-loading-state">
                                <div class="loading-orb loading-orb-large" aria-hidden="true"></div>
                                <p class="viewer-loading-title">Comparing PDF and website...</p>
                                <p class="viewer-loading-copy">The viewer is checking both sources and will load the stronger narrative once it decides.</p>
                              </div>
                            `
                          : '<div class="empty-state">Upload PDF and input URL.</div>'
                      )
                    : websiteMode
                    ? (
                        websiteLoaded
                          ? `
                              <div class="website-pane-stack">
                                ${websiteBlocked
                                  ? ""
                                  : ""
                                }
                                <section class="website-summary-panel">
                                  <div class="website-summary-head">
                                    <div>
                                      <p class="website-summary-eyebrow">Answer Engine</p>
                                    </div>
                                  </div>
                                  ${appState.websiteSummaryLoading
                                    ? `
                                        <div class="website-summary-state">
                                          <p class="viewer-loading-title">Scanning webpage for current PDFs...</p>
                                          <p class="help-spec-loading-inline">${escapeHtml(getWebsiteSummaryLoadingLine())}</p>
                                        </div>
                                      `
                                    : appState.websiteSummaryError
                                      ? `
                                          <div class="website-summary-state">
                                            <p class="viewer-loading-title">Extraction unavailable</p>
                                            <p class="viewer-loading-copy">${escapeHtml(appState.websiteSummaryError)}</p>
                                          </div>
                                        `
                                      : websiteSummary
                                        ? `
                                            <div class="website-answer-summary">
                                              <div class="website-summary-card website-summary-card-primary website-summary-card-wide">
                                                <span>Result</span>
                                                <p>${escapeHtml(websiteSummary.productName || appState.spec.specDisplayName || "Unknown product")}</p>
                                                <small>${escapeHtml(`State: ${getWebsiteStateLabel(websiteSummary)} · Completion ${Math.round(Number(websiteSummary.completionScore || 0) * 100)}% · Overall confidence ${formatConfidenceLabel(websiteSummary.overallConfidence)}`)}</small>
                                              </div>
                                              ${websiteSummary.outcome === "completed" ? renderWebsiteAnswerAttributes(websiteSummary) : ""}
                                            </div>
                                            ${websiteSummary.outcome === "ambiguous"
                                              ? renderWebsiteAmbiguityPanel(websiteSummary)
                                              : websiteSummary.outcome === "needs_pdf_escalation"
                                                ? `
                                                    <div class="website-summary-full">
                                                      <span>PDF Discovery</span>
                                                      <p>${escapeHtml(websiteSummary.message || "Using the webpage to find high-value PDFs for this product.")}</p>
                                                      <p>${escapeHtml(websiteSummary.escalation?.message || "")}</p>
                                                      ${renderWebsiteResourceList([], getWebsiteResourceLinks(websiteSummary))}
                                                      ${getWebsiteResourceLinks(websiteSummary).length ? '<button class="website-escalate-btn" id="website-escalate-btn" type="button">Check Linked PDFs</button>' : ""}
                                                    </div>
                                                  `
                                                : `
                                                    <div class="website-summary-full website-summary-full-success">
                                                      <span>Structured Answer</span>
                                                      <p>Right rail updated with the extracted attributes for ${escapeHtml(websiteSummary.productName || appState.spec.specDisplayName || "this product")}.</p>
                                                    </div>
                                                  `
                                            }
                                          `
                                        : `
                                            <div class="website-summary-state">
                                              <p class="viewer-loading-title">No extraction yet</p>
                                              <p class="viewer-loading-copy">Load a product website to fill the attribute set from the page.</p>
                                            </div>
                                          `
                                  }
                                  ${appState.websitePdfEnrichmentLoading
                                    ? `
                                        <div class="website-summary-enrichment">
                                          <p>${escapeHtml(appState.websitePdfEnrichmentMessage || "High-value PDFs found. Analyzing the strongest price books and spec sheets now.")}</p>
                                        </div>
                                      `
                                    : appState.websitePdfEnrichmentStatus
                                      ? `
                                          <div class="website-summary-enrichment website-summary-enrichment-success">
                                            <p>${escapeHtml(appState.websitePdfEnrichmentStatus)}</p>
                                          </div>
                                        `
                                    : appState.websitePdfEnrichmentError
                                      ? `
                                          <div class="website-summary-enrichment website-summary-enrichment-error">
                                            <p>${escapeHtml(appState.websitePdfEnrichmentError)}</p>
                                          </div>
                                        `
                                      : ""
                                  }
                                </section>
                                <section class="website-preview-panel">
                                  ${websiteBlocked
                                    ? `
                                        <h2>Website cannot be loaded</h2>
                                        <p>Some brands block 3rd parties from loading their website inside another website. <button class="website-inline-link" id="website-open-banner-link" type="button">Click to open in a new tab</button> (and nudge your rep).</p>
                                      `
                                    : !appState.websitePreviewRequested
                                      ? `
                                          <p class="website-preview-copy">Viewfinder is optional secondary context.</p>
                                          <button class="viewer-zoom-btn" id="website-load-viewfinder-btn" type="button">Load site in Viewfinder</button>
                                        `
                                      : `
                                          <div class="website-view-shell" style="height:${websiteBrowserHeight}px;">
                                            <iframe class="website-frame" id="website-frame" src="${escapeHtmlAttribute(appState.websiteUrl)}" title="Product website viewer" referrerpolicy="no-referrer-when-downgrade"></iframe>
                                            ${websiteLoading
                                              ? `
                                                  <div class="website-frame-overlay">
                                                    <p class="viewer-loading-title">Loading website...</p>
                                                    <p class="viewer-loading-copy">Trying to open ${escapeHtml(appState.websiteUrl)} in Viewfinder.</p>
                                                  </div>
                                                `
                                              : ""
                                            }
                                          </div>
                                          <div class="website-pane-divider-shell">
                                            <button class="website-pane-divider" id="website-pane-divider" type="button" aria-label="Resize website and summary sections"></button>
                                          </div>
                                        `
                                  }
                                </section>
                              </div>
                            `
                          : '<div class="empty-state">Choose Product Website, enter a URL, and click "Load Website".</div>'
                      )
                    : gateViewerUntilAiReady
                    ? `
                      <div class="viewer-loading-state">
                        <div class="loading-orb loading-orb-large" aria-hidden="true"></div>
                        <p class="viewer-loading-title">${escapeHtml(viewerLoadingState.title)}</p>
                        <p class="viewer-loading-copy">${escapeHtml(viewerLoadingState.copy)}</p>
                        ${websitePdfLoadListHtml}
                        <p class="viewer-loading-meta" data-loading-live-meta="true">${escapeHtml(viewerLoadingState.meta)}</p>
                      </div>
                    `
                    : documentRecord && (plainPdfMode || !showNarrowSearchUi)
                    ? getVisiblePages(documentRecord)
                        .map((page) => {
                          const isTarget = page.pageNumber === appState.activePageNumber
                          return `
                            <article class="pdf-page ${isTarget ? "is-target" : ""}" data-page-number="${page.pageNumber}">
                              ${
                                (() => {
                                  const renderKey = getPageRenderKey(documentRecord, page.pageNumber)
                                  const renderImage = appState.pageRenderImages[renderKey]
                                  const renderMetrics = appState.pageRenderMetricsByKey[renderKey]
                                  const renderStatus = appState.pageRenderStatusByKey[renderKey]
                                  const highlightBand = getPageVariantHighlightBand(documentRecord, page.pageNumber)
                                  if (appState.productFirstSelection?.active) {
                                    console.log('[pdf-render] page', page.pageNumber, 'highlightBand:', highlightBand, 'productFirstSelection:', appState.productFirstSelection)
                                  }
                                  const cropViewActive = highlightBand && isPageCropViewActive(renderKey)
                                  const cropHeightPixels = cropViewActive && renderMetrics
                                    ? Math.max(24, Math.round((renderMetrics.height * highlightBand.heightPercent) / 100))
                                    : null
                                  const cropAspectRatio = cropViewActive && renderMetrics && cropHeightPixels
                                    ? `${renderMetrics.width} / ${cropHeightPixels}`
                                    : ""
                                  const cropTranslateStyle = cropViewActive && highlightBand
                                    ? `transform:translateY(-${highlightBand.topPercent}%);`
                                    : ""
                                  const floatingActionTop = highlightBand
                                    ? Math.min(100, highlightBand.topPercent + highlightBand.heightPercent)
                                    : 100
                                  const renderWidthStyle = `style="width:${Math.round(baseRenderWidth * appState.pdfZoom)}px; max-width:none;"`
                                  return renderImage
                                    ? `
                                        <div class="page-render-shell ${cropViewActive ? "is-crop-view" : ""}" ${renderWidthStyle}>
                                          <div class="page-render-viewport ${cropViewActive ? "is-cropped" : ""}" ${cropAspectRatio ? `style="aspect-ratio:${cropAspectRatio};"` : ""}>
                                            <div class="page-render-content" ${cropTranslateStyle ? `style="${cropTranslateStyle}"` : ""}>
                                              <img class="page-render-image" src="${renderImage}" alt="Rendered PDF page ${page.pageNumber}" />
                                              ${
                                                highlightBand
                                                  ? `
                                                    ${(() => {
                                                      console.log("[page-variant-highlight-render] applying:", {
                                                        pageNumber: page.pageNumber,
                                                        topPercent: highlightBand.topPercent,
                                                        heightPercent: highlightBand.heightPercent
                                                      })
                                                      return ""
                                                    })()}
                                                    <div class="page-variant-highlight-shell" aria-hidden="true">
                                                      <div
                                                        class="page-variant-highlight-range"
                                                        data-page-range-drag="${page.pageNumber}"
                                                        style="top:${highlightBand.topPercent}%; height:${highlightBand.heightPercent}%;"
                                                      >
                                                        <span class="page-variant-highlight-edge page-variant-highlight-edge-top"></span>
                                                        <span class="page-variant-highlight-handle page-variant-highlight-handle-top" data-page-range-resize-top="${page.pageNumber}"></span>
                                                        <span class="page-variant-highlight-line"></span>
                                                        <span class="page-variant-highlight-handle page-variant-highlight-handle-bottom" data-page-range-resize-bottom="${page.pageNumber}"></span>
                                                        <span class="page-variant-highlight-edge page-variant-highlight-edge-bottom"></span>
                                                      </div>
                                                    </div>
                                                  `
                                                  : ""
                                              }
                                              ${
                                                renderMetrics && appState.pageRenderTextByKey[renderKey]
                                                  ? `
                                                    <div class="page-text-layer-shell" aria-hidden="true">
                                                      <div
                                                        class="page-text-layer"
                                                        data-page-text-layer-key="${escapeHtmlAttribute(renderKey)}"
                                                        data-page-width="${renderMetrics.width}"
                                                        data-page-height="${renderMetrics.height}"
                                                      ></div>
                                                    </div>
                                                  `
                                                  : ""
                                              }
                                            </div>
                                          </div>
                                          ${
                                            highlightBand && !cropViewActive && appState.visionApiKey
                                              ? `
                                                <div class="page-crop-action-anchor" style="top:${floatingActionTop}%;">
                                                  <button class="inline-ai-btn inline-ai-summary-btn inline-ai-floating-summary-btn" type="button" data-create-spec-summary="${page.pageNumber}" title="Crop to this band and create a spec summary">
                                                    Create Spec Summary
                                                  </button>
                                                </div>
                                              `
                                              : ""
                                          }
                                        </div>
                                        <div data-page-readable-area="${page.pageNumber}">${buildPageReadableAreaHtml(documentRecord, page, baseRenderWidth)}</div>
                                      `
                                    : `
                                        <div class="page-render-shell page-render-loading" ${renderWidthStyle}>
                                          <p class="subtle">${renderStatus === "loading" ? "Rendering PDF page..." : "Rendered preview unavailable."}</p>
                                        </div>
                                        <div data-page-readable-area="${page.pageNumber}">${buildPageReadableAreaHtml(documentRecord, page, baseRenderWidth)}</div>
                                      `
                                })()
                              }
                            </article>
                          `
                        })
                        .join("")
                    : (
                      appState.analyzeRequestLoading || normalizeText(appState.loadingMessage || "")
                        ? `
                            <div class="viewer-loading-state">
                              <div class="loading-orb loading-orb-large" aria-hidden="true"></div>
                              <p class="viewer-loading-title">${escapeHtml(viewerLoadingState.title)}</p>
                              <p class="viewer-loading-copy">${escapeHtml(viewerLoadingState.copy)}</p>
                              ${websitePdfLoadListHtml}
                              <p class="help-spec-loading-inline" data-loading-live-meta="true">${escapeHtml(viewerLoadingState.meta)}</p>
                            </div>
                          `
                        : '<div class="empty-state">No document loaded yet. Upload PDFs and run analysis, or use the bundled sample.</div>'
                    )
                }
              </div>

              ${websiteMode
                ? ""
                : `
                  <div class="viewer-controls ${plainPdfMode ? "viewer-controls-plain-pdf" : ""}">
                    <div class="viewer-footer-note">
                      ${escapeHtml(documentRecord ? documentRecord.title : "")}
                      ${documentRecord && plainPdfMode && appState.plainPdfVisibleCount < documentRecord.pages.length
                        ? ` · Showing ${appState.plainPdfVisibleCount} of ${documentRecord.pages.length} pages. More pages load as you scroll.`
                        : ""
                      }
                    </div>
                    ${documentRecord && plainPdfMode && appState.plainPdfVisibleCount < documentRecord.pages.length
                      ? `<button class="plain-pdf-load-more-btn" id="plain-pdf-load-more-btn" type="button">Load More Pages</button>`
                      : ""
                    }
                  </div>
                `
              }
            </div>
          </div>

          ${plainPdfMode ? "" : `
          <div class="field-panel">
            ${hideFieldPanelHeader
              ? ""
              : `
                <div class="field-panel-header">
                  <h2>Attributes</h2>
                  <p>${websiteMode ? "This rail is the source of truth for attribute completion." : "Capture the details from the ranked pages and spec comparisons."}</p>
                </div>
              `}

            <div class="field-body">
              ${
                pageExplanation
                  ? `
                    <section class="setup-note-panel">
                      <div class="setup-note">
                        <span class="setup-note-label">Rank context</span>
                        <span class="setup-note-value">Page ${pageExplanation.pageNumber} matched ${pageExplanation.matches.length} retrieval cue${pageExplanation.matches.length === 1 ? "" : "s"}</span>
                      </div>
                    </section>
                  `
                  : ""
              }

              ${appState.spec.attributes
                .map((attribute) => {
                  const stateClass = attribute.key === appState.highlightedFieldKey
                    ? "is-highlighted"
                    : attribute.value.trim()
                      ? "is-filled"
                      : "is-empty"
                  return `
                    <div class="field-card ${stateClass}" data-field-card="${attribute.key}">
                      <div class="field-card-head">
                        <label for="field-${attribute.key}">${escapeHtml(attribute.label)}</label>
                        ${
                          attribute.key === appState.highlightedFieldKey
                            ? '<span class="field-indicator field-indicator-pulse"></span>'
                            : attribute.value.trim()
                              ? '<span class="field-indicator field-indicator-check">✓</span>'
                              : ""
                        }
                        ${
                          appState.copiedText
                            ? `<button class="field-paste-btn" data-paste-field="${attribute.key}" type="button">Paste</button>`
                            : ""
                        }
                      </div>
                      ${
                        attribute.type === "textarea"
                          ? `<textarea id="field-${attribute.key}" data-field-input="${attribute.key}">${escapeHtml(attribute.value)}</textarea>`
                          : `<input id="field-${attribute.key}" data-field-input="${attribute.key}" value="${escapeHtml(attribute.value)}" />`
                      }
                      ${(attribute.status && attribute.status !== "idle") || attribute.confidence
                        ? `
                            <div class="field-card-meta">
                              <span>${escapeHtml(`Status: ${attribute.status || "idle"}`)}</span>
                              <span>${escapeHtml(`Confidence: ${formatConfidenceLabel(attribute.confidence)}`)}</span>
                              ${attribute.sourceStage ? `<span>${escapeHtml(`Source: ${attribute.sourceStage}`)}</span>` : ""}
                              ${attribute.sourceDocTitle ? `<span>${escapeHtml(attribute.sourceDocTitle)}</span>` : ""}
                              ${attribute.evidenceSnippet ? `<small>${escapeHtml(attribute.evidenceSnippet)}</small>` : ""}
                            </div>
                          `
                        : ""
                      }
                    </div>
                  `
                })
                .join("")}
            </div>

            <div class="field-panel-footer">
              <span>${escapeHtml(appState.copiedText ? `Ready to paste: ${appState.copiedText.slice(0, 48)}${appState.copiedText.length > 48 ? "..." : ""}` : "Select text or click an option value to copy it into a field.")}</span>
            </div>
          </div>
          `}
        </section>

        ${
          appState.wordStatsPage
            ? `
              <div class="lightbox-backdrop" id="word-stats-close"></div>
              <div class="lightbox-panel">
                <div class="lightbox-head">
                  <div>
                    <p class="eyebrow">Why This Page Ranked</p>
                    <h3>Page ${appState.wordStatsPage}</h3>
                  </div>
                  <button class="ghost-btn" id="word-stats-close-btn" type="button">Close</button>
                </div>
                <p class="subtle">Matches against the active retrieval inputs and ranking penalties.</p>
                ${
                  pageExplanation
                    ? `
                      <div class="doc-metrics compact-metrics">
                        <div class="doc-metric"><span>Words</span><strong>${pageExplanation.metrics.words}</strong></div>
                        <div class="doc-metric"><span>Lines</span><strong>${pageExplanation.metrics.lines}</strong></div>
                        <div class="doc-metric"><span>Characters</span><strong>${pageExplanation.metrics.characters}</strong></div>
                      </div>
                    `
                    : ""
                }
                <div class="word-stats-list">
                  ${
                    pageExplanation?.matches.length
                      ? pageExplanation.matches
                          .map(
                            (item) => `
                              <div class="word-stat-row">
                                <div>
                                  <strong>${escapeHtml(item.phrase)}</strong>
                                  <div class="metric-subline">${escapeHtml(item.label)} • ${item.count} hit${item.count === 1 ? "" : "s"}</div>
                                </div>
                                <span>${escapeHtml(item.effect)}</span>
                              </div>
                            `
                          )
                          .join("")
                      : '<span class="subtle">No product-derived phrase or token matches were found for this page.</span>'
                  }
                </div>
              </div>
            `
            : ""
        }
        ${
          appState.debugPanelOpen
            ? `
              <div class="lightbox-backdrop" id="ai-debug-backdrop"></div>
              <div class="lightbox-panel ai-debug-panel">
                <div class="lightbox-head">
                  <div>
                    <h3>${appState.debugPanelTab === "timeline" ? "Timeline" : "Source"}</h3>
                    <p class="help-spec-selector-copy">${appState.debugPanelTab === "timeline" ? "Review the loading history and the structured AI decision steps together." : "Review the AI response as structured data or a readable summary."}</p>
                  </div>
                  <button class="ghost-btn" id="close-ai-debug-btn" type="button">Close</button>
                </div>
                <div class="ai-debug-tabs">
                  ${canShowLoadingHistory ? `<button class="ai-debug-tab ${appState.debugPanelTab === "timeline" ? "is-active" : ""}" data-debug-tab="timeline" type="button">Timeline</button>` : ""}
                  <button class="ai-debug-tab ${appState.debugPanelTab === "summary" ? "is-active" : ""}" data-debug-tab="summary" type="button">Summary</button>
                  <button class="ai-debug-tab ${appState.debugPanelTab === "json" ? "is-active" : ""}" data-debug-tab="json" type="button">JSON</button>
                </div>
                ${
                  appState.debugPanelTab === "timeline"
                    ? `<div class="loading-history-panel">${loadingHistoryModalHtml || `<p class="help-spec-selector-copy">No loading steps recorded yet.</p>`}<div class="ai-source-body">${buildAiSourceSummaryHtml(aiDebugPayload)}</div></div>`
                    : appState.debugPanelTab === "json"
                    ? `<pre class="ai-debug-pre">${escapeHtml(getAiDebugJson(aiDebugPayload))}</pre>`
                    : `<div class="ai-source-body">${buildAiSourceSummaryHtml(aiDebugPayload)}</div>`
                }
              </div>
            `
            : ""
        }
        ${
          appState.sourceRoutingDetailsOpen && appState.sourceRoutingDetails
            ? `
              <div class="lightbox-backdrop" id="routing-details-backdrop"></div>
              <div class="lightbox-panel routing-details-panel">
                <div class="lightbox-head">
                  <div>
                    <h3>Source Routing Details</h3>
                    <p class="help-spec-selector-copy">This is the detailed reasoning behind the auto-loaded source.</p>
                  </div>
                  <button class="ghost-btn" id="close-routing-details-btn" type="button">Close</button>
                </div>
                <div class="website-summary-grid">
                  <div class="website-summary-card">
                    <span>PDF Score</span>
                    <strong>${escapeHtml(String(appState.sourceRoutingDetails.pdf?.score ?? 0))}</strong>
                    <ul>${(appState.sourceRoutingDetails.pdf?.reasons || ["No PDF-specific reasons were recorded."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                  </div>
                  <div class="website-summary-card">
                    <span>Website Score</span>
                    <strong>${escapeHtml(String(appState.sourceRoutingDetails.website?.score ?? 0))}</strong>
                    <ul>${(appState.sourceRoutingDetails.website?.reasons || ["No website-specific reasons were recorded."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                  </div>
                </div>
              </div>
            `
            : ""
        }

        ${
          appState.pickerPosition
            ? `
              <div
                class="field-picker"
                style="top:${appState.pickerPosition.top}px; left:${appState.pickerPosition.left}px;"
              >
                <h3>Choose destination field</h3>
                <p>Only visible attributes from the form are eligible targets.</p>
                <div class="field-list">
                  ${appState.spec.attributes
                    .map(
                      (attribute) => `
                        <button class="field-option" data-pick-field="${attribute.key}" type="button">
                          ${escapeHtml(attribute.label)}
                        </button>
                      `
                    )
                    .join("")}
                  <button class="field-option" id="cancel-picker-btn" type="button">Cancel</button>
                </div>
              </div>
            `
            : ""
        }

        ${
          appState.confirmPosition
            ? `
              <div
                class="confirm-dialog"
                style="top:${appState.confirmPosition.top}px; left:${appState.confirmPosition.left}px;"
              >
                <h3>Field already has a value</h3>
                <p>${escapeHtml(appState.pendingInsertText.slice(0, 120))}</p>
                <div class="field-list">
                  <button class="confirm-option" data-confirm-insert="replace" type="button">Replace existing value</button>
                  <button class="confirm-option" data-confirm-insert="append" type="button">Append to existing value</button>
                  <button class="confirm-option" data-confirm-insert="cancel" type="button">Cancel</button>
                </div>
              </div>
            `
            : ""
        }

        ${appState.toastMessage ? `<div class="toast">${escapeHtml(appState.toastMessage)}</div>` : ""}
      </div>
    `

    bindEvents()
    schedulePageTextLayerHydration()
  }

  function bindEvents() {
    document.getElementById("source-mode-pdf-btn")?.addEventListener("click", () => {
      setSourceMode("pdf")
    })

    document.getElementById("source-mode-website-btn")?.addEventListener("click", () => {
      setSourceMode("website")
    })

    document.getElementById("source-mode-both-btn")?.addEventListener("click", () => {
      if (appState.sourceMode === "both") {
        resetBothModeState()
        render()
        saveCurrentAsDefault().catch(() => {})
        return
      }
      setSourceMode("both")
    })

    document.getElementById("workspace-rail-toggle")?.addEventListener("click", () => {
      appState.leftRailCollapsed = !appState.leftRailCollapsed
      renderPreservingViewerScroll()
      saveCurrentAsDefault().catch(() => {})
    })

    document.querySelectorAll("[data-draft-input]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const key = event.target.getAttribute("data-draft-input")
        appState.inputDraft[key] = event.target.value
        if (key === "productName") {
          appState.search.baseQuery = ""
          appState.search.selectedTerms = []
        }
      })
    })

    document.getElementById("pdf-upload")?.addEventListener("change", (event) => {
      appState.uploadFiles = Array.from(event.target.files || [])
      render()
    })

    document.getElementById("website-url")?.addEventListener("input", (event) => {
      appState.websiteUrlInput = event.target.value.trim()
      appState.search.baseQuery = ""
      appState.search.selectedTerms = []
    })

    document.getElementById("website-url-inline")?.addEventListener("input", (event) => {
      appState.websiteUrlInput = event.target.value.trim()
      appState.search.baseQuery = ""
      appState.search.selectedTerms = []
    })

    document.getElementById("website-url")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      loadWebsite(appState.websiteUrlInput)
    })

    document.getElementById("website-url-inline")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      loadWebsite(appState.websiteUrlInput)
    })

    document.getElementById("open-ai-debug-btn")?.addEventListener("click", () => {
      appState.debugPanelOpen = true
      appState.debugPanelTab = "summary"
      renderPreservingViewerScroll()
    })

    document.getElementById("open-loading-history-btn")?.addEventListener("click", () => {
      appState.debugPanelOpen = true
      appState.debugPanelTab = "timeline"
      renderPreservingViewerScroll()
    })

    document.getElementById("close-ai-debug-btn")?.addEventListener("click", () => {
      appState.debugPanelOpen = false
      renderPreservingViewerScroll()
    })

    document.getElementById("ai-debug-backdrop")?.addEventListener("click", () => {
      appState.debugPanelOpen = false
      renderPreservingViewerScroll()
    })

    document.querySelectorAll("[data-debug-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        appState.debugPanelTab = button.getAttribute("data-debug-tab") || "summary"
        renderPreservingViewerScroll()
      })
    })

    document.getElementById("open-routing-details-btn")?.addEventListener("click", () => {
      appState.sourceRoutingDetailsOpen = true
      renderPreservingViewerScroll()
    })

    document.getElementById("close-routing-details-btn")?.addEventListener("click", () => {
      appState.sourceRoutingDetailsOpen = false
      renderPreservingViewerScroll()
    })

    document.getElementById("routing-details-backdrop")?.addEventListener("click", () => {
      appState.sourceRoutingDetailsOpen = false
      renderPreservingViewerScroll()
    })

    document.getElementById("vision-api-key")?.addEventListener("input", (event) => {
      appState.visionApiKey = event.target.value.trim()
      render()
    })

    document.getElementById("session-submit-btn")?.addEventListener("click", async () => {
      appState.analyzeRequestLoading = true
      render()
      try {
        await handleSubmit()
        if (appState.errorMessage || appState.sourceMode !== "pdf" || !getActiveDocument()) return
        if (hasVisionAccess()) {
          await aiRerankTopPages()
        }
      } finally {
        appState.analyzeRequestLoading = false
        render()
      }
    })

    document.getElementById("session-live-btn")?.addEventListener("click", () => {
      setLiveCssEnabled(!appState.liveCssEnabled)
      render()
    })

    document.getElementById("website-reload-btn")?.addEventListener("click", () => {
      loadWebsite(appState.websiteUrlInput)
    })

    document.getElementById("website-escalate-btn")?.addEventListener("click", () => {
      if (!appState.websiteUrl || !appState.websiteSummarySource) return
      enrichWebsiteSummaryWithPdfData(appState.websiteUrl, appState.websiteEmbedCheckToken).catch(() => {})
    })

    document.querySelectorAll("[data-clarify-candidate]").forEach((button) => {
      button.addEventListener("click", async () => {
        const candidate = normalizeText(button.getAttribute("data-clarify-candidate") || "")
        if (!candidate) return
        appState.websiteVariantFocus = candidate
        renderPreservingViewerScroll()
        await loadWebsite(appState.websiteUrl || appState.websiteUrlInput)
      })
    })

    document.querySelectorAll("[data-narrow-group][data-narrow-option]").forEach((button) => {
      button.addEventListener("click", () => {
        const group = normalizeText(button.getAttribute("data-narrow-group") || "")
        const option = normalizeText(button.getAttribute("data-narrow-option") || "")
        if (!group || !option) return
        const current = normalizeText(appState.websiteNarrowingSelections?.[group] || "")
        appState.websiteNarrowingSelections = {
          ...(appState.websiteNarrowingSelections || {}),
          [group]: current === option ? "" : option
        }
        if (!appState.websiteNarrowingSelections[group]) {
          delete appState.websiteNarrowingSelections[group]
        }
        renderPreservingViewerScroll()
      })
    })

    document.getElementById("website-apply-narrowing-btn")?.addEventListener("click", async () => {
      if (!Object.values(appState.websiteNarrowingSelections || {}).some((value) => normalizeText(value))) return
      await loadWebsite(appState.websiteUrl || appState.websiteUrlInput)
    })

    document.getElementById("website-clear-narrowing-btn")?.addEventListener("click", () => {
      appState.websiteNarrowingSelections = {}
      renderPreservingViewerScroll()
    })

    document.getElementById("website-load-viewfinder-btn")?.addEventListener("click", () => {
      requestWebsitePreviewLoad()
    })

    const openWebsite = () => {
      if (!appState.websiteUrl) return
      window.open(appState.websiteUrl, "_blank", "noopener,noreferrer")
    }

    document.getElementById("website-open-banner-link")?.addEventListener("click", openWebsite)

    document.getElementById("website-frame")?.addEventListener("load", () => {
      if (appState.sourceMode !== "website" && appState.sourceMode !== "both") return
      if (!appState.websitePreviewRequested) return
      clearWebsiteEmbedTimeout()
      const failureReason = getIframeLoadFailureReason(document.getElementById("website-frame"))
      if (failureReason) {
        appState.websiteFrameBlockedReason = failureReason
        appState.websiteFrameStatus = "blocked"
        renderPreservingViewerScroll()
        return
      }
      appState.websiteFrameBlockedReason = ""
      if (appState.websiteFrameStatus === "loaded") return
      appState.websiteFrameStatus = "loaded"
      renderPreservingViewerScroll()
    })

    document.getElementById("switch-narrative-source-btn")?.addEventListener("click", () => {
      if (!appState.alternateNarrativeSource) return
      const nextSource = appState.alternateNarrativeSource
      appState.alternateNarrativeSource = appState.activeNarrativeSource || ""
      appState.activeNarrativeSource = nextSource
      renderPreservingViewerScroll()
      saveCurrentAsDefault().catch(() => {})
    })

    // data-refine-apply is handled by the delegated click listener at the bottom of the file

    document.getElementById("ai-rerank-btn")?.addEventListener("click", async () => {
      appState.analyzeRequestLoading = true
      render()
      try {
        await handleSubmit()
        if (appState.errorMessage || !getActiveDocument()) return
        await aiRerankTopPages()
      } finally {
        appState.analyzeRequestLoading = false
        render()
      }
    })

    document.getElementById("document-select")?.addEventListener("change", (event) => {
      setActiveDocument(event.target.value)
    })

    document.getElementById("zoom-out-btn")?.addEventListener("click", () => {
      appState.pdfZoom = clampPdfZoom(appState.pdfZoom - 0.2)
      renderPreservingViewerScroll()
    })

    document.getElementById("zoom-reset-btn")?.addEventListener("click", () => {
      appState.pdfZoom = 1
      renderPreservingViewerScroll()
    })

    document.getElementById("zoom-in-btn")?.addEventListener("click", () => {
      appState.pdfZoom = clampPdfZoom(appState.pdfZoom + 0.2)
      renderPreservingViewerScroll()
    })

    document.getElementById("plain-pdf-mode-btn")?.addEventListener("click", () => {
      setPlainPdfMode(true)
    })

    document.getElementById("plain-pdf-exit-btn")?.addEventListener("click", () => {
      setPlainPdfMode(false)
    })

    document.querySelectorAll("[data-assistant-option]").forEach((button) => {
      button.addEventListener("click", () => {
        appState.assistantSelection = button.getAttribute("data-assistant-option") || ""
        runRanking(true)
        render()
        setPage(appState.activePageNumber)
        showToast(`Refined to ${appState.assistantSelection}`)
      })
    })

    document.querySelectorAll("[data-open-document]").forEach((button) => {
      button.addEventListener("click", () => setActiveDocument(button.getAttribute("data-open-document")))
    })

    document.querySelectorAll("[data-download-document]").forEach((button) => {
      button.addEventListener("click", () => downloadDocument(button.getAttribute("data-download-document")))
    })

    document.querySelectorAll("[data-jump-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const pageNumber = Number(button.getAttribute("data-jump-page"))
        const productId = button.getAttribute("data-product-first-jump")
        if (productId) {
          appState.productFirstSelection = {
            active: true,
            productId
          }
          renderPreservingViewerScroll()
        }
        setPage(pageNumber)
      })
    })

    document.querySelectorAll("[data-help-spec-page]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation()
        const pageNumber = Number(button.getAttribute("data-help-spec-page"))
        if (Number.isFinite(pageNumber)) {
          setPage(pageNumber)
          await analyzeSpecDecisions(pageNumber)
        }
      })
    })

    document.querySelectorAll("[data-help-spec-page-product]").forEach((button) => {
      button.addEventListener("click", async () => {
        const productId = button.getAttribute("data-help-spec-page-product")
        const pageNumber = appState.activePageNumber
        if (!productId || !pageNumber) return
        await analyzeSpecDecisions(pageNumber, { selectedProductId: productId, selectedVariantId: productId })
      })
    })

    document.querySelectorAll("[data-product-first-product]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation()
        const productId = button.getAttribute("data-product-first-product")
        const pageNumber = Number(button.getAttribute("data-product-first-page")) || appState.structureRouting?.productFirstPageNumber || appState.aiRerankResult?.bestPage || appState.activePageNumber
        if (!productId || !pageNumber) return
        appState.productFirstSelection = {
          active: true,
          productId
        }
        setPage(pageNumber)
        await analyzeSpecDecisions(pageNumber, { selectedProductId: productId, fromProductFirst: true })
      })
    })

    document.querySelectorAll("[data-change-product-selection]").forEach((button) => {
      button.addEventListener("click", () => {
        appState.productFirstSelection = null
        appState.decisionAssistResult = null
        appState.activeDecisionChoiceIndex = -1
        appState.decisionTabsWindowStart = 0
        appState.decisionAssistError = ""
        renderPreservingViewerScroll()
      })
    })

    document.getElementById("page-strip-track")?.addEventListener("scroll", () => {
      const track = document.getElementById("page-strip-track")
      if (!track) return
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth)
      const nextCanScrollLeft = track.scrollLeft > 4
      const nextCanScrollRight = track.scrollLeft < maxScrollLeft - 4
      appState.pageStripScrollLeft = track.scrollLeft
      if (nextCanScrollLeft !== appState.pageStripCanScrollLeft || nextCanScrollRight !== appState.pageStripCanScrollRight) {
        appState.pageStripCanScrollLeft = nextCanScrollLeft
        appState.pageStripCanScrollRight = nextCanScrollRight
        renderPreservingViewerScroll()
      }
    })

    document.getElementById("page-strip-nav-left")?.addEventListener("click", () => {
      const track = document.getElementById("page-strip-track")
      if (!track) return
      const distance = Math.max(180, Math.floor(track.clientWidth * 0.72))
      appState.pageStripScrollLeft = Math.max(0, track.scrollLeft - distance)
      track.scrollTo({ left: appState.pageStripScrollLeft, behavior: "smooth" })
      queuePageStripSync()
    })

    document.getElementById("page-strip-nav-right")?.addEventListener("click", () => {
      const track = document.getElementById("page-strip-track")
      if (!track) return
      const distance = Math.max(180, Math.floor(track.clientWidth * 0.72))
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth)
      appState.pageStripScrollLeft = Math.min(maxScrollLeft, track.scrollLeft + distance)
      track.scrollTo({ left: appState.pageStripScrollLeft, behavior: "smooth" })
      queuePageStripSync()
    })

    document.getElementById("decision-choice-tabs-track")?.addEventListener("scroll", () => {
      const track = document.getElementById("decision-choice-tabs-track")
      if (!track) return
      appState.decisionTabsScrollLeft = track.scrollLeft
    })

    document.getElementById("decision-choice-nav-left")?.addEventListener("click", () => {
      appState.decisionTabsWindowStart = Math.max(0, appState.decisionTabsWindowStart - 1)
      renderPreservingViewerScroll()
    })

    document.getElementById("decision-choice-nav-right")?.addEventListener("click", () => {
      appState.decisionTabsWindowStart += 1
      renderPreservingViewerScroll()
    })

    window.addEventListener("resize", queuePageStripSync, { once: true })
    window.addEventListener("resize", queueDecisionTabsSync, { once: true })
    queuePageStripSync()
    queueDecisionTabsSync()

    document.querySelectorAll("[data-choice-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextIndex = Number(button.getAttribute("data-choice-tab"))
        appState.activeDecisionChoiceIndex =
          appState.activeDecisionChoiceIndex === nextIndex ? -1 : nextIndex
        if (appState.activeDecisionChoiceIndex >= 0) {
          const minVisibleIndex = appState.decisionTabsWindowStart
          const maxVisibleIndex = appState.decisionTabsWindowStart + 2
          if (nextIndex < minVisibleIndex) {
            appState.decisionTabsWindowStart = nextIndex
          } else if (nextIndex > maxVisibleIndex) {
            appState.decisionTabsWindowStart = Math.max(0, nextIndex - 2)
          }
        }
        renderPreservingViewerScroll()
      })
    })

    document.querySelectorAll("[data-help-spec-product]").forEach((button) => {
      button.addEventListener("click", async () => {
        const productId = button.getAttribute("data-help-spec-product")
        const pageNumber = appState.decisionAssistResult?.pageNumber
        if (!productId || !pageNumber) return
        await analyzeSpecDecisions(pageNumber, { selectedProductId: productId })
      })
    })

    document.querySelectorAll("[data-help-spec-variant]").forEach((button) => {
      button.addEventListener("click", async () => {
        const variantId = button.getAttribute("data-help-spec-variant")
        const pageNumber = appState.decisionAssistResult?.pageNumber
        const productId = appState.decisionAssistResult?.selectedProductId || ""
        if (!variantId || !pageNumber) return
        await analyzeSpecDecisions(pageNumber, { selectedProductId: productId, selectedVariantId: variantId })
      })
    })

    document.querySelectorAll("[data-run-ocr]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation()
        await analyzePageImage(Number(button.getAttribute("data-run-ocr")))
      })
    })

    document.querySelectorAll("[data-open-word-stats]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation()
        appState.wordStatsPage = Number(button.getAttribute("data-open-word-stats"))
        render()
      })
    })

    document.getElementById("word-stats-close")?.addEventListener("click", () => {
      appState.wordStatsPage = null
      render()
    })

    document.getElementById("word-stats-close-btn")?.addEventListener("click", () => {
      appState.wordStatsPage = null
      render()
    })

    document.querySelectorAll("[data-field-input]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const key = event.target.getAttribute("data-field-input")
        const attribute = appState.spec.attributes.find((item) => item.key === key)
        if (attribute) attribute.value = event.target.value
      })
    })

    document.querySelectorAll("[data-copy-value]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const value = button.getAttribute("data-copy-value") || ""
        if (!value) return
        const rect = event.currentTarget.getBoundingClientRect()
        setSelectionTarget(value, "assistant", rect)
      })
    })

    document.querySelectorAll("[data-open-resource-href]").forEach((button) => {
      button.addEventListener("click", async () => {
        const href = button.getAttribute("data-open-resource-href") || ""
        const label = button.getAttribute("data-open-resource-label") || ""
        const resolvedHref = resolveWebsiteResourceUrl(href)
        if (!resolvedHref) return
        const linkMeta = getResourceLinkMeta(resolvedHref)

        if (linkMeta.kind === "webpage") {
          showToast("Loading linked webpage and summarizing it now.")
          try {
            const normalizedHref = normalizeWebsiteUrl(resolvedHref)
            if (!normalizedHref) {
              throw new Error("This resource link is not a valid webpage URL.")
            }
            appState.websiteUrlInput = normalizedHref
            if (appState.sourceMode === "pdf") {
              setSourceMode("website")
            } else if (appState.sourceMode === "both") {
              appState.activeNarrativeSource = "website"
              appState.alternateNarrativeSource = appState.documents.length ? "pdf" : ""
              appState.sourceRoutingReason = "Loaded linked webpage resource for summary."
            }
            await loadWebsite(normalizedHref, { persist: false })
            render()
            saveCurrentAsDefault().catch(() => {})
          } catch (error) {
            appState.errorMessage = error instanceof Error ? error.message : "Unable to load linked webpage."
            render()
            showToast(appState.errorMessage)
          }
          return
        }

        if (linkMeta.kind === "file") {
          showToast(`Opening ${linkMeta.extension.toUpperCase()} file in a new tab.`)
          window.open(resolvedHref, "_blank", "noopener,noreferrer")
          return
        }

        try {
          await loadWebsiteResourcePdf(resolvedHref, label)
        } catch (error) {
          appState.errorMessage = error instanceof Error ? error.message : "Unable to load PDF resource."
          render()
          showToast(appState.errorMessage)
        }
      })
    })

    document.querySelectorAll("[data-copy-direct]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.getAttribute("data-copy-direct") || ""
        if (!value) return
        copyValueDirect(value).catch(() => {})
      })
    })

    document.querySelectorAll("[data-reveal-page-text]").forEach((button) => {
      button.addEventListener("click", async () => {
        const pageNumber = Number(button.getAttribute("data-reveal-page-text"))
        if (Number.isFinite(pageNumber)) {
          await revealPageText(pageNumber, "transcript")
        }
      })
    })

    document.querySelectorAll("[data-create-spec-summary]").forEach((button) => {
      button.addEventListener("click", async () => {
        const pageNumber = Number(button.getAttribute("data-create-spec-summary"))
        if (Number.isFinite(pageNumber)) {
          await createSpecSummaryFromBand(pageNumber)
        }
      })
    })

    document.querySelectorAll("[data-show-full-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const pageNumber = Number(button.getAttribute("data-show-full-page"))
        if (Number.isFinite(pageNumber)) {
          showFullPageView(pageNumber)
        }
      })
    })

    const bindPageRangePointer = (selector, attributeName, mode) => {
      document.querySelectorAll(selector).forEach((handle) => {
        handle.addEventListener("pointerdown", (event) => {
          const pageNumber = Number(handle.getAttribute(attributeName))
          const documentRecord = getActiveDocument()
          if (!documentRecord || !Number.isFinite(pageNumber)) return
          const range = handle.closest(".page-variant-highlight-range")
          const shell = handle.closest(".page-render-shell")
          const renderKey = getPageRenderKey(documentRecord, pageNumber)
          if (!shell || !range) return
          event.preventDefault()
          event.stopPropagation()
        pageRangeDragState = {
          mode,
          pageNumber,
          renderKey,
          pointerId: event.pointerId,
          startY: event.clientY,
          startTopPercent: parseFloat(range.style.top || "0") || 0,
          startHeightPercent: parseFloat(range.style.height || "0") || 0,
          shellHeight: shell.getBoundingClientRect().height,
          startTopOverride: getPageRangeTop(renderKey),
          startOffset: getPageRangeOffset(renderKey),
          range
        }
          handle.setPointerCapture?.(event.pointerId)
        })

        handle.addEventListener("pointermove", (event) => {
          if (!pageRangeDragState || pageRangeDragState.pointerId !== event.pointerId) return
          event.preventDefault()
          const deltaPixels = event.clientY - pageRangeDragState.startY
          const deltaPercent = pageRangeDragState.shellHeight
            ? (deltaPixels / pageRangeDragState.shellHeight) * 100
            : 0

          let nextTopPercent = pageRangeDragState.startTopPercent
          let nextHeightPercent = pageRangeDragState.startHeightPercent

          if (pageRangeDragState.mode === "move") {
            nextTopPercent = Math.max(0, Math.min(100 - nextHeightPercent, pageRangeDragState.startTopPercent + deltaPercent))
          } else if (pageRangeDragState.mode === "resize-top") {
            const nextBottomPercent = pageRangeDragState.startTopPercent + pageRangeDragState.startHeightPercent
            nextTopPercent = Math.max(0, Math.min(nextBottomPercent - 8, pageRangeDragState.startTopPercent + deltaPercent))
            nextHeightPercent = Math.max(8, nextBottomPercent - nextTopPercent)
          } else if (pageRangeDragState.mode === "resize-bottom") {
            const nextBottomPercent = Math.max(pageRangeDragState.startTopPercent + 8, Math.min(100, pageRangeDragState.startTopPercent + pageRangeDragState.startHeightPercent + deltaPercent))
            nextHeightPercent = Math.max(8, nextBottomPercent - pageRangeDragState.startTopPercent)
          }

          pageRangeDragState.range.style.top = `${nextTopPercent}%`
          pageRangeDragState.range.style.height = `${nextHeightPercent}%`
        })

        const finishRangeDrag = (event) => {
          if (!pageRangeDragState || pageRangeDragState.pointerId !== event.pointerId) return
          const finalTopPercent = parseFloat(pageRangeDragState.range.style.top || "0") || pageRangeDragState.startTopPercent
          const finalHeightPercent = parseFloat(pageRangeDragState.range.style.height || "0") || pageRangeDragState.startHeightPercent
          const draggedPageNumber = pageRangeDragState.pageNumber
          setPageRangeTop(pageRangeDragState.renderKey, finalTopPercent)
          setPageRangeHeight(pageRangeDragState.renderKey, finalHeightPercent)
          handle.releasePointerCapture?.(event.pointerId)
          pageRangeDragState = null
          patchPageReadableArea(draggedPageNumber)
          renderPreservingViewerScroll()
        }

        handle.addEventListener("pointerup", finishRangeDrag)
        handle.addEventListener("pointercancel", finishRangeDrag)
      })
    }

    bindPageRangePointer("[data-page-range-drag]", "data-page-range-drag", "move")
    bindPageRangePointer("[data-page-range-resize-top]", "data-page-range-resize-top", "resize-top")
    bindPageRangePointer("[data-page-range-resize-bottom]", "data-page-range-resize-bottom", "resize-bottom")

    document.querySelectorAll("[data-paste-field]").forEach((button) => {
      button.addEventListener("click", () => {
        const fieldKey = button.getAttribute("data-paste-field")
        if (!fieldKey || !appState.copiedText) return
        insertIntoField(fieldKey, appState.copiedText, "replace")
      })
    })

    document.querySelectorAll("[data-pick-field]").forEach((button) => {
      button.addEventListener("click", () => handleFieldPick(button.getAttribute("data-pick-field")))
    })

    document.querySelectorAll("[data-confirm-insert]").forEach((button) => {
      button.addEventListener("click", () => resolveInsert(button.getAttribute("data-confirm-insert")))
    })

    document.getElementById("viewer-scroll")?.addEventListener("scroll", () => {
      const viewerScroll = document.getElementById("viewer-scroll")
      if (viewerScroll) {
        appState.viewerScrollTop = viewerScroll.scrollTop
        appState.viewerScrollLeft = viewerScroll.scrollLeft
      }
      maybeExtendPlainPdfVisiblePages()
    }, { passive: true })
    bindViewerPan(document.getElementById("viewer-scroll"))

    document.getElementById("plain-pdf-load-more-btn")?.addEventListener("click", () => {
      loadMorePlainPdfPages()
    })

    const websitePaneDivider = document.getElementById("website-pane-divider")
    websitePaneDivider?.addEventListener("pointerdown", (event) => {
      const paneStack = websitePaneDivider.closest(".website-pane-stack")
      const websiteShell = paneStack?.querySelector(".website-view-shell")
      if (!paneStack || !websiteShell) return
      event.preventDefault()
      websitePaneResizeState = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: websiteShell.getBoundingClientRect().height
      }
      websitePaneDivider.setPointerCapture?.(event.pointerId)
    })

    websitePaneDivider?.addEventListener("pointermove", (event) => {
      if (!websitePaneResizeState || websitePaneResizeState.pointerId !== event.pointerId) return
      event.preventDefault()
      const deltaY = event.clientY - websitePaneResizeState.startY
      appState.websitePaneBrowserHeight = Math.max(100, Math.min(760, Math.round(websitePaneResizeState.startHeight + deltaY)))
      appState.websitePaneManualHeight = true
      renderPreservingViewerScroll()
    })

    const finishWebsitePaneResize = (event) => {
      if (!websitePaneResizeState || websitePaneResizeState.pointerId !== event.pointerId) return
      websitePaneDivider?.releasePointerCapture?.(event.pointerId)
      websitePaneResizeState = null
    }

    websitePaneDivider?.addEventListener("pointerup", finishWebsitePaneResize)
    websitePaneDivider?.addEventListener("pointercancel", finishWebsitePaneResize)

  }

  async function handlePdfSubmit(options = {}) {
    if (!syncSpecFromDraft()) {
      appState.errorMessage = "Add at least one attribute before submitting."
      showToast(appState.errorMessage)
      render()
      return
    }
    clearSelectionState()
    appState.assistantSelection = ""
    appState.retrievalRefinementSelections = {}
    appState.search.baseQuery = normalizeText(appState.inputDraft.productName || "")
    appState.search.selectedTerms = []
    appState.aiRerankResult = null
    appState.aiRerankDocumentId = ""
    appState.aiRerankCacheByDocumentId = {}
    appState.structureRouting = null
    appState.productFirstSelection = null
    appState.aiRerankError = ""
    appState.sourceSelectionScores = []
    appState.sourceSelectionChosenId = ""
    appState.decisionAssistResult = null
    appState.familyPageProductsByKey = {}
    appState.familyPageProductsStatusByKey = {}
    appState.familyPageProductsErrorByKey = {}
    appState.activeDecisionChoiceIndex = -1
    appState.decisionTabsWindowStart = 0
    appState.decisionAssistError = ""
    appState.summaryPanelOpen = false

    if (!appState.uploadFiles.length && !appState.documents.length) {
      appState.errorMessage = "No PDF is loaded yet. Upload a PDF or wait for the default document to finish loading."
      setLoadingStage("")
      showToast(appState.errorMessage)
      render()
      if (options.persist !== false) {
        saveCurrentAsDefault().catch(() => {})
      }
      return
    }

    if (!appState.uploadFiles.length && appState.documents.length) {
      const sourceScores = getDocumentKeywordDensityScores(appState.documents)
      appState.sourceSelectionScores = sourceScores
      appState.sourceSelectionChosenId = sourceScores[0]?.documentId || appState.activeDocumentId
      const bestDocument = chooseBestDocumentByKeywordDensity(appState.documents)
      if (bestDocument) {
        appState.activeDocumentId = bestDocument.id
      }
      runRanking(true)
      render()
      if (options.persist !== false) {
        saveCurrentAsDefault().catch(() => {})
      }
      requestAnimationFrame(() => setPage(appState.activePageNumber))
      return
    }

    try {
      setLoadingStage("Parsing uploaded PDFs...", { resetOverall: true })
      render()
      const uploadedDocuments = await parseUploadedFiles(appState.uploadFiles)
      appState.documents = uploadedDocuments
      const sourceScores = getDocumentKeywordDensityScores(uploadedDocuments)
      appState.sourceSelectionScores = sourceScores
      appState.sourceSelectionChosenId = sourceScores[0]?.documentId || ""
      const bestDocument = chooseBestDocumentByKeywordDensity(uploadedDocuments)
      appState.activeDocumentId = bestDocument?.id || uploadedDocuments[0]?.id || ""
      appState.plainPdfVisibleCount = PLAIN_PDF_BATCH_SIZE
      appState.uploadFiles = []
      appState.aiRerankCacheByDocumentId = {}
      appState.structureRouting = null
      appState.productFirstSelection = null
      appState.rankedPages = []
      appState.pagePreviews = {}
      appState.pageRenderImages = {}
      appState.pageRenderTextByKey = {}
      appState.pageRenderMetricsByKey = {}
      appState.pageRenderStatusByKey = {}
      appState.pageTextVisibleByKey = {}
      appState.pageRangeTopByKey = {}
      appState.pageRangeOffsetByKey = {}
      appState.pageRangeHeightByKey = {}
      appState.pageCropViewByKey = {}
      appState.pageReadableVariantByKey = {}
      appState.pageReadableHtmlByKey = {}
      appState.pageReadableTargetsByKey = {}
      appState.pageReadableStatusByKey = {}
      appState.pageReadableErrorByKey = {}
      clearAllReadableStatusTimers()
      setLoadingStage("")
      runRanking(true)
      render()
      schedulePreviewRendering()
      if (options.persist !== false) {
        saveCurrentAsDefault().catch(() => {})
      }
      requestAnimationFrame(() => setPage(appState.activePageNumber))
      showToast(`Loaded ${uploadedDocuments.length} PDF${uploadedDocuments.length === 1 ? "" : "s"}`)
    } catch (error) {
      setLoadingStage("")
      appState.errorMessage = error instanceof Error ? error.message : "Unable to parse the uploaded PDFs."
      render()
    }
  }

  async function handleSubmit() {
    const normalizedUrl = normalizeWebsiteUrl(appState.websiteUrlInput)
    if (!normalizedUrl) {
      appState.errorMessage = "Enter a valid website URL starting with http:// or https://."
      showToast(appState.errorMessage)
      render()
      return
    }
    await loadWebsite(normalizedUrl)
  }

  async function resetToBundledDefault() {
    appState.spec = cloneSpec(initialSpec)
    appState.documents = []
    appState.activeDocumentId = ""
    appState.sourceMode = "pdf"
    appState.plainPdfVisibleCount = PLAIN_PDF_BATCH_SIZE
    appState.websiteUrlInput = ""
    appState.websiteUrl = ""
    appState.websiteFrameStatus = "idle"
    appState.websitePreviewRequested = false
    appState.websiteFrameBlockedReason = ""
    appState.websiteEmbedCheckToken = 0
    appState.websiteSummaryLoading = false
    appState.websiteSummaryError = ""
    appState.websiteSummary = null
    appState.websiteSummarySource = null
    appState.websiteSummaryPrompt = ""
    appState.websiteSummaryRawText = ""
    appState.websiteVariantFocus = ""
    appState.websiteNarrowingSelections = {}
    appState.websitePdfEnrichmentLoading = false
    appState.websitePdfEnrichmentError = ""
    appState.websitePdfEnrichmentMessage = ""
    appState.websitePdfEnrichmentStatus = ""
    appState.websitePaneBrowserHeight = null
    appState.websitePaneManualHeight = false
    appState.activeNarrativeSource = "pdf"
    appState.alternateNarrativeSource = ""
    appState.sourceRoutingReason = ""
    appState.sourceRoutingDetails = null
    appState.sourceRoutingDetailsOpen = false
    appState.leftRailCollapsed = false
    appState.websiteSummaryLoadingLineIndex = 0
    appState.websiteSummaryLoadingLineOrder = []
    stopWebsiteSummaryLoadingTicker()
    clearWebsiteEmbedTimeout()
    appState.rankedPages = []
    appState.assistantResult = null
    appState.assistantSelection = ""
    appState.aiRerankResult = null
    appState.aiRerankDocumentId = ""
    appState.aiRerankCacheByDocumentId = {}
    appState.structureRouting = null
    appState.productFirstSelection = null
    appState.aiRerankError = ""
    appState.sourceSelectionScores = []
    appState.sourceSelectionChosenId = ""
    appState.decisionAssistResult = null
    appState.familyPageProductsByKey = {}
    appState.familyPageProductsStatusByKey = {}
    appState.familyPageProductsErrorByKey = {}
    appState.activeDecisionChoiceIndex = -1
    appState.decisionTabsWindowStart = 0
    appState.decisionAssistError = ""
    appState.summaryPanelOpen = false
    appState.pagePreviews = {}
    appState.pageRenderImages = {}
    appState.pageRenderTextByKey = {}
    appState.pageRenderMetricsByKey = {}
    appState.pageRenderStatusByKey = {}
    appState.pageTextVisibleByKey = {}
    appState.pageRangeTopByKey = {}
    appState.pageRangeOffsetByKey = {}
    appState.pageRangeHeightByKey = {}
    appState.pageCropViewByKey = {}
    appState.pageReadableVariantByKey = {}
    appState.pageReadableHtmlByKey = {}
    appState.pageReadableTargetsByKey = {}
    appState.pageReadableStatusByKey = {}
    appState.pageReadableErrorByKey = {}
    clearAllReadableStatusTimers()
    appState.uploadFiles = []
    appState.errorMessage = ""
    appState.search = {
      baseQuery: initialSpec.specDisplayName,
      selectedTerms: []
    }
    setLoadingStage("Loading bundled default PDF...", { resetOverall: true })
    appState.inputDraft = {
      productName: initialSpec.specDisplayName,
      brandName: initialSpec.brandDisplayName,
      category: initialSpec.category,
      attributes: initialSpec.attributes.map((attribute) => attribute.label).join("\n")
    }
    clearSelectionState()
    render()
    await loadBundledDefaultCase()
  }

  function openPersistenceDb() {
    if (!("indexedDB" in window)) {
      return Promise.reject(new Error("IndexedDB is not available in this browser."))
    }

    if (!persistenceDbPromise) {
      persistenceDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(PERSISTENCE_DB, 1)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(PERSISTENCE_STORE)) {
            database.createObjectStore(PERSISTENCE_STORE)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB."))
      })
    }

    return persistenceDbPromise
  }

  async function saveCurrentAsDefault() {
    const database = await openPersistenceDb()
    const shouldPersistBothRouting = appState.sourceMode !== "both"
    const payload = {
      savedAt: Date.now(),
      sourceMode: appState.sourceMode,
      activeNarrativeSource: shouldPersistBothRouting ? appState.activeNarrativeSource : "",
      alternateNarrativeSource: shouldPersistBothRouting ? appState.alternateNarrativeSource : "",
      sourceRoutingReason: shouldPersistBothRouting ? appState.sourceRoutingReason : "",
      sourceRoutingDetails: shouldPersistBothRouting ? appState.sourceRoutingDetails : null,
      spec: appState.spec,
      search: appState.search,
      inputDraft: appState.inputDraft,
      visionApiKey: appState.visionApiKey,
      activeDocumentId: appState.activeDocumentId,
      websiteUrlInput: appState.websiteUrlInput,
      websiteUrl: appState.websiteUrl,
      leftRailCollapsed: appState.leftRailCollapsed,
      documents: appState.documents.map((document) => ({
        id: document.id,
        title: document.title,
        description: document.description,
        useCase: document.useCase,
        sourceType: document.sourceType,
        pageTitles: document.pageTitles,
        pdfText: document.pdfText || null,
        pdfBytes: document.pdfBytes ? [...document.pdfBytes] : null,
        pages: document.pages
      }))
    }

    await new Promise((resolve, reject) => {
      const transaction = database.transaction(PERSISTENCE_STORE, "readwrite")
      transaction.objectStore(PERSISTENCE_STORE).put(payload, PERSISTENCE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error("Unable to save default session."))
    })
  }

  async function loadSavedDefault() {
    const database = await openPersistenceDb()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PERSISTENCE_STORE, "readonly")
      const request = transaction.objectStore(PERSISTENCE_STORE).get(PERSISTENCE_KEY)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error("Unable to load saved default session."))
    })
  }

  async function clearSavedDefault() {
    const database = await openPersistenceDb()
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(PERSISTENCE_STORE, "readwrite")
      transaction.objectStore(PERSISTENCE_STORE).delete(PERSISTENCE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error("Unable to clear saved default session."))
    })
  }

  async function hydrateSavedDraftState() {
    try {
      const saved = await loadSavedDefault()
      if (!saved) return false

      appState.inputDraft = {
        ...appState.inputDraft,
        ...(saved.inputDraft || {})
      }
      appState.visionApiKey = saved.visionApiKey || ""
      appState.sourceMode = saved.sourceMode === "website" ? "website" : saved.sourceMode === "both" ? "both" : "pdf"
      appState.spec = {
        ...cloneSpec(initialSpec),
        originalSpecName: normalizeText(appState.inputDraft.productName) || initialSpec.originalSpecName,
        specDisplayName: normalizeText(appState.inputDraft.productName) || initialSpec.specDisplayName,
        originalBrand: normalizeText(appState.inputDraft.brandName) || initialSpec.originalBrand,
        brandDisplayName: normalizeText(appState.inputDraft.brandName) || initialSpec.brandDisplayName,
        category: normalizeText(appState.inputDraft.category) || initialSpec.category,
        attributes: buildAttributesFromText(appState.inputDraft.attributes || "").length
          ? buildAttributesFromText(appState.inputDraft.attributes)
          : cloneSpec(initialSpec).attributes
      }
      appState.search = {
        baseQuery: normalizeText(saved.search?.baseQuery) || normalizeText(appState.inputDraft.productName) || initialSpec.specDisplayName,
        selectedTerms: Array.isArray(saved.search?.selectedTerms) ? saved.search.selectedTerms : []
      }
      appState.documents = []
      appState.activeDocumentId = ""
      appState.plainPdfVisibleCount = PLAIN_PDF_BATCH_SIZE
      appState.websiteUrlInput = saved.websiteUrlInput || saved.websiteUrl || ""
      appState.websiteVariantFocus = ""
      appState.websiteNarrowingSelections = {}
      appState.websiteUrl = ""
      appState.websiteFrameStatus = "idle"
      appState.websitePreviewRequested = false
      appState.websiteFrameBlockedReason = ""
      appState.websiteEmbedCheckToken = 0
      appState.websiteSummaryLoading = false
      appState.websiteSummaryError = ""
      appState.websiteSummary = null
      appState.websiteSummarySource = null
      appState.websiteSummaryPrompt = ""
      appState.websiteSummaryRawText = ""
      appState.websitePdfEnrichmentLoading = false
      appState.websitePdfEnrichmentError = ""
      appState.websitePdfEnrichmentMessage = ""
      appState.websitePdfEnrichmentStatus = ""
      appState.websitePaneBrowserHeight = null
      appState.websitePaneManualHeight = false
      appState.activeNarrativeSource = appState.sourceMode === "website" ? "website" : appState.sourceMode === "both" ? "" : (saved.activeNarrativeSource || "pdf")
      appState.alternateNarrativeSource = appState.sourceMode === "both" ? "" : (saved.alternateNarrativeSource || "")
      appState.sourceRoutingReason = appState.sourceMode === "both" ? "" : (saved.sourceRoutingReason || "")
      appState.sourceRoutingDetails = appState.sourceMode === "both" ? null : (saved.sourceRoutingDetails || null)
      appState.sourceRoutingDetailsOpen = false
      appState.leftRailCollapsed = Boolean(saved.leftRailCollapsed)
      appState.websiteSummaryLoadingLineIndex = 0
      appState.websiteSummaryLoadingLineOrder = []
      stopWebsiteSummaryLoadingTicker()
      appState.uploadFiles = []
      appState.rankedPages = []
      appState.assistantResult = null
      appState.assistantSelection = ""
      appState.aiRerankResult = null
      appState.aiRerankDocumentId = ""
      appState.aiRerankCacheByDocumentId = {}
      appState.structureRouting = null
      appState.productFirstSelection = null
      appState.aiRerankError = ""
      appState.sourceSelectionScores = []
      appState.sourceSelectionChosenId = ""
      appState.decisionAssistResult = null
      appState.activeDecisionChoiceIndex = -1
      appState.decisionTabsWindowStart = 0
      appState.decisionAssistError = ""
      appState.pagePreviews = {}
      appState.pageRenderImages = {}
      appState.pageRenderTextByKey = {}
      appState.pageRenderMetricsByKey = {}
      appState.pageRenderStatusByKey = {}
      appState.pageTextVisibleByKey = {}
      appState.pageRangeTopByKey = {}
      appState.pageRangeOffsetByKey = {}
      appState.pageRangeHeightByKey = {}
      appState.pageCropViewByKey = {}
      appState.pageReadableVariantByKey = {}
      appState.pageReadableHtmlByKey = {}
      appState.pageReadableTargetsByKey = {}
      appState.pageReadableStatusByKey = {}
      appState.pageReadableErrorByKey = {}
      clearAllReadableStatusTimers()
      setLoadingStage("")
      render()
      return true
    } catch (error) {
      // If persistence fails, keep the in-memory defaults.
      return false
    }
  }

  async function loadPdfJsLibrary() {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`)
        .then((module) => {
          module.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`
          return module
        })
        .catch(() => {
          throw new Error("PDF.js could not be loaded from the CDN. Serve the prototype over http:// and make sure you are online.")
        })
    }

    return pdfjsLibPromise
  }

  async function parseUploadedFiles(files) {
    const results = []
    const nameCounts = new Map()

    for (const file of files) {
      const seenCount = (nameCounts.get(file.name) || 0) + 1
      nameCounts.set(file.name, seenCount)
      const displayName = seenCount > 1 ? `${file.name} (${seenCount})` : file.name
      const bytes = new Uint8Array(await file.arrayBuffer())
      results.push(await buildUploadedDocument(file.name, bytes, results.length + 1, displayName))
    }

    return results
  }

  async function loadPdfDocumentsIntoPipeline(documentInputs) {
    const inputs = Array.isArray(documentInputs) ? documentInputs : []
    if (!inputs.length) {
      throw new Error("No PDF resources were available to load.")
    }
    setLoadingStage("Loading identified PDFs from website...", { resetStage: true })

    if (appState.sourceMode === "website") {
      appState.sourceMode = "pdf"
      appState.activeNarrativeSource = "pdf"
      appState.alternateNarrativeSource = ""
      appState.sourceRoutingDetails = null
      appState.sourceRoutingDetailsOpen = false
    } else if (appState.sourceMode === "both") {
      appState.activeNarrativeSource = "pdf"
      appState.alternateNarrativeSource = appState.websiteUrl ? "website" : ""
      appState.sourceRoutingDetails = null
      appState.sourceRoutingDetailsOpen = false
    }

    const documents = []
    appState.websitePdfLoadItems = inputs.map((input, index) => {
      const normalizedHref = normalizeWebsiteUrl(input?.href || input?.url || "")
      const displayName = normalizeText(input?.label || input?.title || (normalizedHref ? decodeURIComponent(new URL(normalizedHref).pathname.split("/").pop() || "resource.pdf") : `PDF ${index + 1}`)) || `PDF ${index + 1}`
      return {
        label: displayName,
        sizeLabel: "",
        status: "queued",
        href: normalizedHref
      }
    })
    render()

    for (const input of inputs) {
      const normalizedHref = normalizeWebsiteUrl(input?.href || input?.url || "")
      if (!normalizedHref) continue
      const sourceUrl = new URL(normalizedHref)
      const sourceFallbackName = decodeURIComponent(sourceUrl.pathname.split("/").pop() || "resource.pdf")
      const sourceDisplayName = normalizeText(input?.label || input?.title || sourceFallbackName) || sourceFallbackName
      const sourceFileName = /\.pdf$/i.test(sourceDisplayName) ? sourceDisplayName : `${sourceDisplayName}.pdf`
      const itemIndex = inputs.indexOf(input)
      if (itemIndex >= 0 && appState.websitePdfLoadItems[itemIndex]) {
        appState.websitePdfLoadItems[itemIndex] = {
          ...appState.websitePdfLoadItems[itemIndex],
          status: "fetching"
        }
      }
      setLoadingStage(`Fetching linked PDF ${documents.length + 1} of ${inputs.length}: ${sourceFileName}`, { resetStage: true })
      render()
      const response = await fetch(`/api/pdf-proxy?url=${encodeURIComponent(normalizedHref)}`, { cache: "no-store" })
      if (!response.ok) continue
      const contentLength = Number(response.headers.get("content-length") || 0)
      const headerSizeLabel = formatByteSize(contentLength)
      if (itemIndex >= 0 && appState.websitePdfLoadItems[itemIndex] && headerSizeLabel) {
        appState.websitePdfLoadItems[itemIndex] = {
          ...appState.websitePdfLoadItems[itemIndex],
          sizeLabel: headerSizeLabel,
          status: "fetching"
        }
        render()
      }

      const bytes = new Uint8Array(await response.arrayBuffer())
      const fileName = sourceFileName
      if (itemIndex >= 0 && appState.websitePdfLoadItems[itemIndex]) {
        appState.websitePdfLoadItems[itemIndex] = {
          ...appState.websitePdfLoadItems[itemIndex],
          label: fileName,
          sizeLabel: formatByteSize(bytes.byteLength),
          status: "parsing"
        }
      }
      setLoadingStage(`Parsing linked PDF ${documents.length + 1} of ${inputs.length}: ${fileName}`, { resetStage: true })
      render()
      documents.push(await buildUploadedDocument(fileName, bytes, documents.length + 1, fileName))
      if (itemIndex >= 0 && appState.websitePdfLoadItems[itemIndex]) {
        appState.websitePdfLoadItems[itemIndex] = {
          ...appState.websitePdfLoadItems[itemIndex],
          label: fileName,
          sizeLabel: formatByteSize(bytes.byteLength),
          status: "loaded"
        }
      }
      render()
    }

    if (!documents.length) {
      throw new Error("The selected PDF resources could not be loaded.")
    }

    appState.uploadFiles = []
    appState.documents = documents
    const sourceScores = getDocumentKeywordDensityScores(documents)
    appState.sourceSelectionScores = sourceScores
    appState.sourceSelectionChosenId = sourceScores[0]?.documentId || ""
    const bestDocument = chooseBestDocumentByKeywordDensity(documents)
    appState.activeDocumentId = bestDocument?.id || documents[0]?.id || ""
    appState.rankedPages = []
    appState.pagePreviews = {}
    appState.pageRenderImages = {}
    appState.pageRenderTextByKey = {}
    appState.pageRenderMetricsByKey = {}
    appState.pageRenderStatusByKey = {}
    appState.pageTextVisibleByKey = {}
    appState.pageRangeTopByKey = {}
    appState.pageRangeOffsetByKey = {}
    appState.pageRangeHeightByKey = {}
    appState.pageCropViewByKey = {}
    appState.pageReadableVariantByKey = {}
    appState.pageReadableHtmlByKey = {}
    appState.pageReadableTargetsByKey = {}
    appState.pageReadableStatusByKey = {}
    appState.pageReadableErrorByKey = {}
    appState.aiRerankResult = null
    appState.aiRerankDocumentId = ""
    appState.aiRerankCacheByDocumentId = {}
    appState.structureRouting = null
    appState.productFirstSelection = null
    appState.aiRerankError = ""
    appState.decisionAssistResult = null
    appState.decisionAssistError = ""
    appState.sourceRoutingReason = "Website discovery loaded high-value PDFs. Use the ranked PDF pages to fill the attribute rail."
    clearSelectionState()
    clearAllReadableStatusTimers()
    setLoadingStage(`Preparing ranked PDF analysis for ${documents.length} PDF${documents.length === 1 ? "" : "s"}...`, { resetStage: true })
    appState.websitePdfLoadItems = appState.websitePdfLoadItems.map((item) => ({
      ...item,
      status: "loaded"
    }))
    runRanking(true)

    schedulePreviewRendering()
    requestAnimationFrame(() => setPage(appState.activePageNumber))
    setLoadingStage("")
    saveCurrentAsDefault().catch(() => {})
    if (hasVisionAccess()) {
      appState.aiRerankLoading = true
      render()
      aiRerankTopPages(true)
        .catch((error) => {
          appState.aiRerankError = error instanceof Error ? error.message : "Unable to refine ranked PDF pages."
        })
        .finally(() => {
          appState.aiRerankLoading = false
          render()
        })
    }
    return documents
  }

  async function loadWebsiteResourcePdf(href, label) {
    const normalizedHref = normalizeWebsiteUrl(href)
    if (!normalizedHref) {
      throw new Error("This resource link is not a valid URL.")
    }

    if (appState.sourceMode === "website") {
      appState.sourceMode = "pdf"
      appState.activeNarrativeSource = "pdf"
      appState.alternateNarrativeSource = ""
      appState.sourceRoutingReason = "Loaded linked PDF resource."
      appState.sourceRoutingDetails = null
      appState.sourceRoutingDetailsOpen = false
    } else if (appState.sourceMode === "both") {
      appState.activeNarrativeSource = "pdf"
      appState.alternateNarrativeSource = appState.websiteUrl ? "website" : ""
      appState.sourceRoutingReason = "Loaded linked PDF resource."
      appState.sourceRoutingDetails = null
      appState.sourceRoutingDetailsOpen = false
    }

    appState.analyzeRequestLoading = true
    setLoadingStage("Loading and analyzing linked PDF...", { resetOverall: true })
    render()

    try {
      const documents = await loadPdfDocumentsIntoPipeline([{ href: normalizedHref, label }])

      if (appState.sourceMode === "both") {
        appState.activeNarrativeSource = "pdf"
        appState.alternateNarrativeSource = appState.websiteUrl ? "website" : ""
        appState.sourceRoutingReason = "Loaded and analyzed PDF from webpage resource link."
      } else if (appState.sourceMode === "pdf") {
        appState.sourceRoutingReason = "Loaded and analyzed PDF from webpage resource link."
      }

      showToast(`Loaded PDF resource: ${documents[0]?.title || label || "PDF"}`)
    } finally {
      setLoadingStage("")
      appState.analyzeRequestLoading = false
      render()
    }
  }

  async function buildUploadedDocument(fileName, bytes, ordinal, displayTitle) {
    const pdfjsLib = await loadPdfJsLibrary()
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
    const pdfDocument = await loadingTask.promise
    const pages = []

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const pageText = extractTextFromContentItems(textContent.items)
      pages.push({
        pageNumber,
        text: pageText,
        ocrText: ""
      })
    }

    return {
      id: `${slugify(fileName.replace(/\.pdf$/i, ""), "upload")}-${ordinal}`,
      title: displayTitle || fileName,
      description: "Uploaded by user for ranking validation.",
      useCase: "Uploaded PDF",
      sourceType: "uploaded",
      pageTitles: pages.map(() => displayTitle || fileName),
      pdfBytes: Array.from(bytes),
      pages
    }
  }

  async function loadBundledDefaultCase() {
    try {
      const response = await fetch(DEFAULT_BUNDLED_PDF_PATH)
      if (!response.ok) {
        throw new Error(`Bundled default PDF could not be loaded (${response.status}).`)
      }

      const bytes = new Uint8Array(await response.arrayBuffer())
      const bundledDocument = await buildUploadedDocument(DEFAULT_BUNDLED_PDF_NAME, bytes, 1)
      appState.documents = [bundledDocument]
      appState.activeDocumentId = bundledDocument.id
      appState.rankedPages = []
      appState.errorMessage = ""
      setLoadingStage("")
      runRanking(true)
      render()
      schedulePreviewRendering()
      saveCurrentAsDefault().catch(() => {})
      requestAnimationFrame(() => setPage(appState.activePageNumber))
    } catch (error) {
      appState.documents = sampleDocuments.map(hydrateSyntheticDocument)
      appState.activeDocumentId = sampleDocuments[1].id
      setLoadingStage("")
      appState.errorMessage = error instanceof Error
        ? `${error.message} Falling back to built-in samples.`
        : "Bundled default PDF could not be loaded. Falling back to built-in samples."
      runRanking(true)
      render()
      requestAnimationFrame(() => setPage(appState.activePageNumber))
    }
  }

  async function renderPdfPageToCanvas(documentRecord, pageNumber, scale) {
    if (!documentRecord?.pdfBytes) {
      throw new Error("Image analysis is only available for real PDF sources.")
    }

    const pdfjsLib = await loadPdfJsLibrary()
    // PDF.js can detach the underlying buffer during worker handoff, so OCR analysis
    // always works against a fresh copy of the stored bytes.
    const loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(documentRecord.pdfBytes) })
    const pdfDocument = await loadingTask.promise
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: context, viewport }).promise
    return canvas
  }

  async function getPdfPageRenderData(documentRecord, pageNumber, scale) {
    if (!documentRecord?.pdfBytes) {
      throw new Error("Image analysis is only available for real PDF sources.")
    }

    const pdfjsLib = await loadPdfJsLibrary()
    const loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(documentRecord.pdfBytes) })
    const pdfDocument = await loadingTask.promise
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: context, viewport }).promise
    const textContent = await page.getTextContent()

    return {
      canvas,
      textContent,
      viewport
    }
  }

  async function analyzeDimensionsWithVision(pageNumber, canvas) {
    if (!hasVisionAccess()) {
      throw new Error("Add an OpenAI API key above or configure OPENAI_API_KEY on the local server before using Analyze dimensions.")
    }

    const imageUrl = canvas.toDataURL("image/png")
    const prompt = [
      "You are analyzing a furniture specification PDF page image.",
      `Product name: ${appState.spec.specDisplayName || appState.spec.originalSpecName || "Unknown"}`,
      "Determine whether the page contains dimension drawings for the product and extract the visible measurements.",
      "Pay attention to variants such as upholstered vs nonupholstered if shown.",
      "Return JSON only with no markdown fences.",
      "",
      "Required JSON shape:",
      '{',
      '  "has_dimension_diagram": true,',
      '  "summary": "short sentence",',
      '  "measurements": [',
      '    {"variant": "nonupholstered", "label": "overall height", "value": "29 3/4\\"", "evidence": "right elevation"}',
      "  ],",
      '  "raw_visible_dimensions": ["20 3/4\\"", "16 1/8\\"", "29 3/4\\""],',
      '  "notes": ["short note"]',
      '}',
      "If no reliable dimensions are visible, return an empty measurements array and explain why in notes."
    ].join("\n")

    const response = await sendOpenAiResponsesRequest({
      model: appState.visionModel || DEFAULT_VISION_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl }
          ]
        }
      ]
    }, "OpenAI request timed out.")

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Vision analysis failed (${response.status}): ${errorBody.slice(0, 180)}`)
    }

    const payload = await response.json()
    const rawText = extractResponseText(payload)
    const analysis = parseJsonPayload(rawText)
    if (!analysis) {
      throw new Error("The vision model returned a response that could not be parsed as JSON.")
    }

    return {
      rawText,
      analysis,
      formattedText: formatVisionAnalysisText(analysis)
    }
  }

  async function analyzeFamilyPageProductsWithVision(documentRecord, pageNumber) {
    if (!hasVisionAccess()) {
      throw new Error("Add an OpenAI API key above or configure OPENAI_API_KEY on the local server before extracting page products.")
    }

    const canvas = await renderPdfPageToCanvas(documentRecord, pageNumber, 1.6)
    const imageUrl = canvas.toDataURL("image/png")
    const selectedPage = documentRecord?.pages?.find((page) => page.pageNumber === pageNumber)
    const subtypeHint = getSelectedPageSubtypeHint(documentRecord, selectedPage)
    const prompt = [
      "You are reading a furniture manufacturer PDF page image.",
      "Goal: detect the concrete product rows shown on this single page so the UI can let the user pick the exact product before any spec analysis runs.",
      "Return only products visibly present on this page image.",
      "Do not infer additional family products from other pages.",
      "Do not return abstract buckets such as Base Type, Upholstery Type, Finish Type, or Variant.",
      "Prefer one card per visible item/model row.",
      "Each product should include the model code if visible and a short distinguishing label based on the visible description.",
      subtypeHint ? `The page itself appears to be scoped to: ${subtypeHint}. Only return rows that match that scope.` : "Subtype hint: none",
      "If the page shows exactly three products, return three products.",
      "Return JSON only with no markdown fences.",
      "",
      "Required JSON shape:",
      "{",
      '  "products": [',
      '    {"id": "gl-10", "label": "Exposed Veneer Shell / Interior Upholstery", "description": "GL-10", "evidence": "visible item row"}',
      "  ]",
      "}"
    ].join("\n")

    const response = await sendOpenAiResponsesRequest({
      model: appState.visionModel || DEFAULT_VISION_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl }
          ]
        }
      ]
    }, "OpenAI request timed out.")

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Family page extraction failed (${response.status}): ${errorBody.slice(0, 180)}`)
    }

    const payload = await response.json()
    const rawText = extractResponseText(payload)
    const parsed = parseJsonPayload(rawText)
    if (!parsed) {
      throw new Error("Family page extraction returned unreadable JSON.")
    }

    return normalizeDecisionCandidates(parsed.products)
  }

  async function ensureFamilyPageProducts(pageNumber) {
    const documentRecord = getActiveDocument()
    if (!documentRecord || getSpecParsingMode() !== "family" || !Number.isFinite(Number(pageNumber))) return
    const key = getFamilyPageSelectionKey(documentRecord, pageNumber)
    if (appState.familyPageProductsByKey[key]?.length) return
    if (appState.familyPageProductsStatusByKey[key] === "loading") return
    if (!hasVisionAccess()) return

    try {
      appState.familyPageProductsStatusByKey[key] = "loading"
      appState.familyPageProductsErrorByKey[key] = ""
      renderPreservingViewerScroll()

      const products = await analyzeFamilyPageProductsWithVision(documentRecord, pageNumber)
      appState.familyPageProductsByKey[key] = products
      appState.familyPageProductsStatusByKey[key] = "done"
      appState.familyPageProductsErrorByKey[key] = ""
    } catch (error) {
      appState.familyPageProductsByKey[key] = []
      appState.familyPageProductsStatusByKey[key] = "error"
      appState.familyPageProductsErrorByKey[key] = error instanceof Error ? error.message : "Unable to extract products from this page."
    } finally {
      renderPreservingViewerScroll()
    }
  }

  function buildRoutingPrompt(productName) {
    return [
      "You are a routing classifier for a furniture PDF spec workflow.",
      `Product query: ${productName || "Unknown"}`,
      "",
      "== YOUR ONLY JOB ==",
      "Classify the submitted PDF pages as either single_product_scope or multi_product_scope.",
      "Do not extract product rows. Do not count variants. Do not generate characteristics.",
      "",
      "== DEFINITIONS ==",
      "single_product_scope: One product or one tightly related variant set spans the submitted pages.",
      "  - The product may run across multiple contiguous pages (overview, then specs, then options).",
      "  - Multiple contiguous single-product runs in one document is still single_product_scope.",
      "  - Do not confuse continuation pages (specs, options, pricing) with separate products.",
      "multi_product_scope: Multiple clearly distinct and separately selectable products or family members appear.",
      "  - Evidence: repeated item rows, multiple product images on one page, model-number columns with multiple rows, section blocks per product.",
      "  - A page with a visible MODEL NUMBER column and multiple concrete rows is strong multi_product_scope evidence.",
      "",
      "== TIEBREAKER (apply in order, stop at first match) ==",
      "1. If pages show a model-number grid with 3+ distinct rows -> multi_product_scope.",
      "2. If pages share one product title with continuation labels -> single_product_scope.",
      "3. If pages show a price list with repeated row structures, even without a labeled MODEL NUMBER column -> multi_product_scope.",
      "4. If genuinely ambiguous with no repeated row structures, choose single_product_scope and set structure_confidence: low.",
      "",
      "== PAGE RANKING ==",
      "Opener page signals (rank higher): large product title, hero image, introductory copy, first page before specs.",
      "Continuation page signals (rank lower): dense options tables, spec grids, pricing matrices, '(Cont.)' labels.",
      "Rule: if ambiguous between opener and continuation, always choose the opener. Never prefer a denser page.",
      "For single_product_scope: run_openers is REQUIRED. Include one entry per contiguous product run.",
      "best_page must be the opener of the strongest run, not a continuation page inside it.",
      "",
      "== DOCUMENT DATE ==",
      "Page 1 is always included. Use it to find the document date (effective date, price book date, revision date).",
      "Return the date exactly as shown. Return empty string if not found.",
      "",
      "== OUTPUT RULES ==",
      "Return JSON only. No markdown fences. No extra keys. No omitted keys.",
      "All array fields must be present even if empty.",
      "",
      "Required JSON shape:",
      "{",
      '  "scope_type": "single_product_scope | multi_product_scope",',
      '  "single_product_likelihood": 20,',
      '  "multi_product_likelihood": 80,',
      '  "structure_confidence": "high | medium | low",',
      '  "document_date": "",',
      '  "reason": "one sentence",',
      '  "best_page": 5,',
      '  "kept_pages": [5, 6, 7],',
      '  "page_differences": [',
      '    {"page_number": 5, "label": "Mesh Back", "reason": "visible page-level difference"}',
      '  ],',
      '  "run_openers": [',
      '    {"opener_page": 5, "label": "Mesh Chair", "reason": "first page of run", "continuation_pages": [6, 7], "ai_score": 94}',
      '  ],',
      '  "ordered_pages": [',
      '    {"page_number": 5, "ai_score": 94, "reason": "opener page for strongest run"}',
      "  ]",
      "}"
    ].join("\n")
  }

  function getShowModelNumbersThreshold(querySpecificity) {
    const result = normalizeText(querySpecificity || "").toLowerCase() === "refined" ? 16 : 8
    console.log('[getShowModelNumbersThreshold] specificity:', querySpecificity, 'threshold:', result)
    return result
  }

  function classifyQuerySpecificity(fullQuery, familyName) {
    const normalize = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    const q = normalize(fullQuery)
    const f = normalize(familyName)
    const exactMatch = q === f
    const familyIncludesQuery = Boolean(q) && Boolean(f) && f.includes(q)
    const queryIncludesFamily = Boolean(q) && Boolean(f) && q.includes(f)
    const specificity = exactMatch || familyIncludesQuery ? "broad" : "refined"
    console.log("[classifyQuerySpecificity] fullQuery:", fullQuery)
    console.log("[classifyQuerySpecificity] familyName:", familyName)
    console.log("[classifyQuerySpecificity] normalizedFullQuery:", q)
    console.log("[classifyQuerySpecificity] normalizedFamilyName:", f)
    console.log(`[classifyQuerySpecificity] compare normalized q="${q}" f="${f}"`)
    if (!familyName || !f) {
      console.warn("[classifyQuerySpecificity] familyName is empty or undefined before comparison", {
        rawFamilyName: familyName,
        normalizedFamilyName: f,
        rawFullQuery: fullQuery,
        normalizedFullQuery: q
      })
    }
    console.log("[classifyQuerySpecificity] exactMatch:", exactMatch)
    console.log("[classifyQuerySpecificity] familyIncludesQuery:", familyIncludesQuery)
    console.log("[classifyQuerySpecificity] queryIncludesFamily:", queryIncludesFamily)
    console.log('[classifyQuerySpecificity] comparing:', { fullQuery, familyName, normalizedQuery: normalize(fullQuery), normalizedFamily: normalize(familyName) })
    console.log("[classifyQuerySpecificity] result:", specificity)
    return specificity
  }

  function buildProductSetPrompt(productQuery, productFamilyName) {
    const normalizedQuery = normalizeText(productQuery || "Unknown")
    const normalizedFamilyName = normalizeText(productFamilyName || "Unknown")
    const querySpecificity = classifyQuerySpecificity(normalizedQuery, normalizedFamilyName)
    const broadThreshold = getShowModelNumbersThreshold("broad")
    const refinedThreshold = getShowModelNumbersThreshold("refined")
    console.log("[buildProductSetPrompt] productQuery:", normalizedQuery)
    console.log("[buildProductSetPrompt] productFamilyName:", normalizedFamilyName)
    console.log("[buildProductSetPrompt] querySpecificity:", querySpecificity)

    return [
      "You are counting selectable product choices in a multi-product furniture PDF result set.",
      `Product family name: ${normalizedFamilyName}`,
      `Full query: ${normalizedQuery}`,
      `Deterministic query specificity: ${querySpecificity}. Do not reclassify. Return this exact value in query_specificity.`,
      "",
      "== YOUR ONLY JOB ==",
      "1. Identify concrete, model-backed product rows from the submitted pages.",
      "2. Apply any active filters if the query is refined.",
      "3. Count matching choices and choose a UI mode.",
      "",
      "== QUERY SPECIFICITY ==",
      "Broad = the query contains only the product family name and no additional structural terms.",
      "Refined = the query contains the product family name PLUS at least one additional term that narrows structure, base, back, upholstery, or orientation.",
      "The app has already classified the query deterministically. Do not override it.",
      "Examples:",
      "  - Product family name: Ginkgo Ply Lounge / Full query: Ginkgo Ply Lounge -> broad",
      "  - Product family name: Ginkgo Ply Lounge / Full query: Ginkgo Ply Lounge Exposed Veneer Shell -> refined",
      "",
      "== WHAT COUNTS AS A PRODUCT CHOICE ==",
      "Count: visible model/item number, a distinct labeled product row, a repeated row structure tied to one item.",
      "",
      "== WHAT NEVER COUNTS - HARD EXCLUSIONS ==",
      "Never count any of the following, even if they appear in a row-like structure:",
      "- COM/COL pricing rows",
      "- Finish swatches, finish grade tables, finish legends (e.g. 'Shell Finish A B C D E')",
      "- Textile or material legends",
      "- Pricing-only lines with no model number",
      "- Specification notes or order-code legends",
      "- Abstract buckets: Base Type, Upholstery Type, Finish Type, Variant, Configuration",
      "- Any row whose primary content is a list of finish codes, grade letters, or color names",
      "If you are unsure whether a row is a product or a finish/legend row, exclude it.",
      "",
      "== UI MODE RULE ==",
      `If query_specificity is refined: ${refinedThreshold} or fewer matching choices -> choice_mode: show_model_numbers`,
      `If query_specificity is refined: ${refinedThreshold + 1} or more matching choices -> choice_mode: narrow_search`,
      `If query_specificity is broad: ${broadThreshold} or fewer matching choices -> choice_mode: show_model_numbers`,
      `If query_specificity is broad: ${broadThreshold + 1} or more matching choices -> choice_mode: narrow_search`,
      "",
      "== OUTPUT RULES ==",
      "Return JSON only. No markdown fences. Always return all keys. Use empty array for unused arrays.",
      "",
      "Required JSON shape:",
      "{",
      '  "choice_mode": "show_model_numbers | narrow_search",',
      '  "variant_count": 12,',
      '  "query_specificity": "broad | refined",',
      '  "count_reason": "one sentence",',
      '  "applied_filters": ["Wire Base"],',
      '  "excluded_filters": ["Wood Base"],',
      '  "matching_ids": ["GL-10", "GL-15"],',
      '  "concrete_options": [',
      '    {"id": "GL-10", "label": "GL-10", "description": "Exposed Veneer Shell / Interior Upholstery", "page_number": 7, "evidence": "visible model row"}',
      '  ],',
      '  "excluded_rows": [',
      '    {"label": "Shell Finish COM/COL A B C D", "reason": "finish legend, not a product row", "page_number": 15}',
      '  ]',
      "}",
      "If choice_mode is narrow_search, return empty concrete_options array.",
      "The excluded_rows array is required. Always populate it with rows you rejected and why."
    ].join("\n")
  }

  function normalizeExcludedRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        label: normalizeText(row?.label || row?.id || ""),
        reason: normalizeText(row?.reason || ""),
        pageNumber: Number(row?.page_number)
      }))
      .filter((row) => row.label || row.reason || Number.isFinite(row.pageNumber))
  }

  function buildNarrowingPrompt(productName) {
    return [
      "You are helping a user narrow a large multi-product result set.",
      `Product name: ${productName || "Unknown"}`,
      "You will be shown only pages that already belong to a multi_product_scope result set.",
      "Assume the recoverable variant count is 9 or more.",
      "Your job: return the best narrowing terms to reduce the result set before showing product choices.",
      "Do not return product rows.",
      "Do not return model numbers as the main output.",
      "Do not return singleton suggestion buckets.",
      "Look explicitly for these furniture bucket categories in the submitted PDF pages:",
      "1. Base Type",
      "2. Back Height",
      "3. Upholstery / Shell",
      "4. Swivel / Function",
      "5. Arms",
      "6. Size / Scale",
      "Return every bucket that has at least 2 visible options in the submitted pages.",
      "Prioritize structural and material distinctions over finish or color options.",
      "If finish or color appears but stronger structural/material buckets are present, prefer the structural/material buckets.",
      "If finish or color is the only real divider with 2+ visible options, you may include it after the structural buckets.",
      "Identify the highest-value visible axes that meaningfully divide the result set.",
      "Only return a bucket if it has at least 2 real options.",
      "Only return options that are visibly grounded in the pages.",
      "Only return buckets that would meaningfully reduce the result set.",
      "Good bucket labels: Base Type, Back Height, Upholstery / Shell, Swivel / Function, Arms, Size / Scale.",
      "Return JSON only. No markdown fences.",
      "",
      "Required JSON shape:",
      "{",
      '  "narrowing_buckets": [',
      '    {"id": "base", "label": "Base Type", "reason": "Base type splits the visible result set into meaningful groups.", "options": ["Nylon Base", "Aluminum Base", "Jury Base"]}',
      "  ]",
      "}"
    ].join("\n")
  }

  async function callOpenAiJsonPrompt(content, errorPrefix) {
    const response = await sendOpenAiResponsesRequest({
      model: appState.visionModel || DEFAULT_VISION_MODEL,
      temperature: 0,
      input: [{ role: "user", content }]
    }, "OpenAI request timed out.")

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`${errorPrefix} (${response.status}): ${errorBody.slice(0, 180)}`)
    }

    const payload = await response.json()
    const rawText = extractResponseText(payload)
    const parsed = parseJsonPayload(rawText)
    if (!parsed) {
      throw new Error(`${errorPrefix} returned unreadable JSON.`)
    }

    return {
      parsed,
      rawText
    }
  }

  async function aiRerankTopPages(useActiveDocumentOnly) {
    if (appState.aiRerankLoading) {
      console.log("[aiRerankTopPages] skipping duplicate invocation while a rerank is already in progress")
      return
    }
    if (!appState.search) appState.search = {}
    appState.search.baseQuery = normalizeText(appState.inputDraft.productName || appState.spec.originalSpecName || appState.spec.specDisplayName || "Unknown")
    let documentRecord = getActiveDocument() || getRoutingPdfDocument() || null
    if (!useActiveDocumentOnly && appState.documents.length > 1) {
      const sourceScores = getDocumentKeywordDensityScores(appState.documents)
      appState.sourceSelectionScores = sourceScores
      const bestDocument = chooseBestDocumentByKeywordDensity(appState.documents)
      appState.sourceSelectionChosenId = bestDocument?.id || appState.activeDocumentId
      if (bestDocument && bestDocument.id !== appState.activeDocumentId) {
        appState.activeDocumentId = bestDocument.id
        appState.pagePreviews = {}
        appState.pageRenderImages = {}
        appState.pageRenderTextByKey = {}
        appState.pageRenderMetricsByKey = {}
        appState.pageRenderStatusByKey = {}
        appState.pageTextVisibleByKey = {}
        appState.pageRangeTopByKey = {}
        appState.pageRangeOffsetByKey = {}
        appState.pageRangeHeightByKey = {}
        appState.pageCropViewByKey = {}
        appState.pageReadableVariantByKey = {}
        appState.pageReadableHtmlByKey = {}
        appState.pageReadableTargetsByKey = {}
        appState.pageReadableStatusByKey = {}
        appState.pageReadableErrorByKey = {}
        clearAllReadableStatusTimers()
        runRanking(true)
        render()
        showToast(`Best source selected: ${bestDocument.title}`)
      }
      documentRecord = getActiveDocument() || getRoutingPdfDocument() || null
    } else {
      const sourceScores = getDocumentKeywordDensityScores(appState.documents)
      appState.sourceSelectionScores = sourceScores
      appState.sourceSelectionChosenId = sourceScores[0]?.documentId || appState.activeDocumentId
    }

    if (!documentRecord) {
      appState.aiRerankError = "No ranked pages are available yet."
      render()
      return
    }

    const candidatePages = rankPages(documentRecord).slice(0, getAiRerankCandidateLimit())
    if (!candidatePages.length) {
      appState.aiRerankError = "No ranked pages are available yet."
      render()
      return
    }
    if (!hasVisionAccess()) {
      appState.aiRerankError = "Add an OpenAI API key above or configure OPENAI_API_KEY on the local server before using AI rerank."
      showToast("Add an OpenAI API key first")
      render()
      return
    }

    try {
      appState.aiRerankLoading = true
      appState.aiRerankError = ""
      appState.aiRerankResult = null
      appState.aiRerankRawText = ""
      appState.aiRerankDocumentId = ""
      setLoadingStage("Identifying page count...", { resetStage: true })
      showToast("AI reranking top pages...")
      render()

      const pageImages = []
      for (const candidate of candidatePages) {
        const canvas = await renderPdfPageToCanvas(documentRecord, candidate.pageNumber, 1.2)
        pageImages.push({
          pageNumber: candidate.pageNumber,
          imageUrl: canvas.toDataURL("image/png"),
          score: candidate.score
        })
      }
      const firstPageCandidate = documentRecord?.pages?.find((page) => page.pageNumber === 1)
      let firstPageImage = null
      if (firstPageCandidate && !pageImages.some((page) => page.pageNumber === 1)) {
        const firstPageCanvas = await renderPdfPageToCanvas(documentRecord, 1, 1.2)
        firstPageImage = {
          pageNumber: 1,
          imageUrl: firstPageCanvas.toDataURL("image/png"),
          score: ""
        }
      }

      const productName = getCurrentQueryProductName()
      const fullQuery = getSearchFullQuery() || getMergedLongestQueryProductName()
      console.log("[aiRerankTopPages] fullQuery for classifyQuerySpecificity:", fullQuery)
      const baseProductFamilyName = getBaseProductFamilyName()
      const deterministicQuerySpecificity = classifyQuerySpecificity(fullQuery, baseProductFamilyName)
      setLoadingStage(`Searching ${candidatePages.length} likely pages for "${productName}"...`)
      render()
      const routingContent = [{ type: "input_text", text: buildRoutingPrompt(productName) }]

      if (appState.productImageUrl) {
        routingContent.push({ type: "input_text", text: "Reference product image:" })
        routingContent.push({ type: "input_image", image_url: appState.productImageUrl })
      }

      if (firstPageImage) {
        routingContent.push({
          type: "input_text",
          text: "Reference page 1 of the PDF. Use this page to identify the document date if one is visible."
        })
        routingContent.push({ type: "input_image", image_url: firstPageImage.imageUrl })
      }

      pageImages.forEach((page) => {
        routingContent.push({
          type: "input_text",
          text: `Candidate page ${page.pageNumber}. Deterministic score: ${page.score}.`
        })
        routingContent.push({ type: "input_image", image_url: page.imageUrl })
      })
      const { parsed: routingParsed, rawText: routingRawText } = await callOpenAiJsonPrompt(routingContent, "Routing prompt failed")
      if (!routingParsed?.ordered_pages?.length) {
        throw new Error("Routing prompt returned an unreadable response.")
      }

      const routingOrderedPages = routingParsed.ordered_pages
        .map((item) => ({
          pageNumber: Number(item.page_number),
          aiScore: Number(item.ai_score),
          reason: item.reason || "",
          role: item.reason || "",
          confidence: ""
        }))
        .filter((item) => Number.isFinite(item.pageNumber))
      const runOpeners = Array.isArray(routingParsed.run_openers)
        ? routingParsed.run_openers
            .map((item) => ({
              openerPage: Number(item.opener_page),
              label: normalizeText(item.label || ""),
              reason: normalizeText(item.reason || ""),
              continuationPages: Array.isArray(item.continuation_pages)
                ? item.continuation_pages.map((value) => Number(value)).filter(Number.isFinite)
                : [],
              aiScore: Number(item.ai_score),
              confidence: normalizeText(item.confidence || "")
            }))
            .filter((item) => Number.isFinite(item.openerPage))
        : []
      const strongPages = routingOrderedPages.filter((item) => Number.isFinite(item.aiScore) && item.aiScore >= 60)
      const routingKeptPages = Array.isArray(routingParsed.kept_pages)
        ? routingParsed.kept_pages.map((value) => Number(value)).filter(Number.isFinite)
        : []
      const promptScopeType = normalizeText(routingParsed.scope_type)
      const singleScopeLikelihood = Number(routingParsed.single_product_likelihood)
      const multiScopeLikelihood = Number(routingParsed.multi_product_likelihood)
      const structureConfidenceLabel = normalizeStructureConfidenceLabel(routingParsed.structure_confidence)
      const documentDate = normalizeText(routingParsed.document_date || "")
      let orderedPages = routingOrderedPages
      let keptPages = (routingKeptPages.length ? routingKeptPages : (strongPages.length ? strongPages : routingOrderedPages.slice(0, getAiKeptPageLimit())).map((item) => item.pageNumber))
      let bestPage = keptPages.includes(Number(routingParsed.best_page)) ? Number(routingParsed.best_page) : keptPages[0]
      const variantComparison = Array.isArray(routingParsed.page_differences)
        ? routingParsed.page_differences
            .map((item) => ({
              pageNumber: Number(item.page_number),
              label: item.label || "",
              difference: item.difference || item.reason || "",
              reason: item.reason || ""
            }))
            .filter((item) => Number.isFinite(item.pageNumber))
        : []
      const effectiveScopeType = promptScopeType
      const fallbackRunOpeners = effectiveScopeType === "single_product_scope"
        ? detectSingleProductRunOpeners(documentRecord, candidatePages.map((item) => item.pageNumber), productName)
        : []
      const resolvedRunOpeners = runOpeners.length >= 2 ? runOpeners : fallbackRunOpeners
      const shouldUseRunOpeners = effectiveScopeType === "single_product_scope" && resolvedRunOpeners.length > 0
      if (shouldUseRunOpeners) {
        orderedPages = resolvedRunOpeners.map((item) => ({
          pageNumber: item.openerPage,
          aiScore: Number.isFinite(item.aiScore) ? item.aiScore : "",
          reason: item.reason || item.label || "",
          role: item.label || "",
          confidence: item.confidence || ""
        }))
        keptPages = resolvedRunOpeners.map((item) => item.openerPage)
        bestPage = orderedPages[0]?.pageNumber || keptPages[0]
      }

      let choiceMode = ""
      let variantCount = 0
      let querySpecificity = ""
      let countReason = ""
      let concreteProductCandidates = []
      let narrowingBuckets = []
      let matchingIds = []
      let appliedFilters = []
      let excludedFilters = []
      let excludedRows = []

      if (effectiveScopeType === "multi_product_scope") {
        setLoadingStage(`Query found ${keptPages.length} likely pages. Counting concrete product choices.`)
        render()
        const keptPageImages = pageImages.filter((page) => keptPages.includes(page.pageNumber))
        const productSetContent = [{ type: "input_text", text: buildProductSetPrompt(fullQuery, baseProductFamilyName) }]
        keptPageImages.forEach((page) => {
          productSetContent.push({
            type: "input_text",
            text: `Multi-product page ${page.pageNumber}. Deterministic score: ${page.score}.`
          })
          productSetContent.push({ type: "input_image", image_url: page.imageUrl })
        })

        const { parsed: productSetParsed, rawText: productSetRawText } = await callOpenAiJsonPrompt(productSetContent, "Product set prompt failed")
        console.log("[productSetRawText]", productSetRawText)
        choiceMode = normalizeText(productSetParsed.choice_mode || "")
        variantCount = Number(productSetParsed.variant_count) || 0
        querySpecificity = deterministicQuerySpecificity
        countReason = normalizeText(productSetParsed.count_reason || "")
        console.log("[productSetParsed] model query_specificity:", normalizeText(productSetParsed.query_specificity || ""))
        console.log("[productSetParsed] deterministic query_specificity:", querySpecificity)
        console.log("[productSetParsed] variant_count:", variantCount)
        console.log("[productSetParsed] choice_mode:", choiceMode)
        const parsedChoiceThreshold = getShowModelNumbersThreshold(querySpecificity)
        if (variantCount > 0) {
          choiceMode = variantCount <= parsedChoiceThreshold ? "show_model_numbers" : "narrow_search"
          console.log("[productSetParsed] normalized choice_mode:", choiceMode, "threshold:", parsedChoiceThreshold)
        }
        matchingIds = resolveMatchingIdsFromProductSet(productSetParsed)
        appliedFilters = Array.isArray(productSetParsed.applied_filters) ? productSetParsed.applied_filters.map((item) => normalizeText(item)).filter(Boolean) : []
        excludedFilters = Array.isArray(productSetParsed.excluded_filters) ? productSetParsed.excluded_filters.map((item) => normalizeText(item)).filter(Boolean) : []
        concreteProductCandidates = normalizeConcreteProductCandidates(productSetParsed.concrete_options)
        excludedRows = normalizeExcludedRows(productSetParsed.excluded_rows)
        const localFamilyCandidates = keptPages.flatMap((pageNumber) => {
          const page = documentRecord?.pages?.find((item) => item.pageNumber === pageNumber)
          if (!page) return []
          return extractConcreteVariantCandidatesFromPageText(getPageCombinedText(page))
            .map((candidate) => ({
              ...candidate,
              pageNumber,
              evidence: normalizeText(`${candidate.evidence || ""} Page ${pageNumber}`.trim())
            }))
        })
        const localFamilyModelBackedCandidates = getModelBackedProductCandidates(localFamilyCandidates)
        const localFamilyVariantCount = countDistinctProductIdentifiers(localFamilyModelBackedCandidates)
        if (querySpecificity === "broad" && localFamilyVariantCount > 0) {
          variantCount = localFamilyVariantCount
          matchingIds = []
          appliedFilters = []
          excludedFilters = []
          excludedRows = []
          countReason = `The query is broad, so the app is counting the full recoverable family set instead of narrowing to a small row match. Recovered ${localFamilyVariantCount} distinct model-backed choices across the likely pages.`
          if (localFamilyVariantCount > getShowModelNumbersThreshold("broad")) {
            choiceMode = "narrow_search"
            concreteProductCandidates = []
          } else if (localFamilyModelBackedCandidates.length) {
            choiceMode = "show_model_numbers"
            concreteProductCandidates = localFamilyModelBackedCandidates
          }
        }
        if (choiceMode === "show_model_numbers" && matchingIds.length) {
          const filteredCandidates = filterCandidatesByMatchingIds(concreteProductCandidates, matchingIds)
          if (filteredCandidates.length) {
            concreteProductCandidates = filteredCandidates
          }
        }

        if (choiceMode === "narrow_search") {
          setLoadingStage(`I found ${variantCount || "several"} likely product choices. Grouping the biggest differences to narrow the search.`)
          render()
          const narrowingContent = [{ type: "input_text", text: buildNarrowingPrompt(productName) }]
          keptPageImages.forEach((page) => {
            narrowingContent.push({
              type: "input_text",
              text: `Multi-product page ${page.pageNumber}. Deterministic score: ${page.score}.`
            })
            narrowingContent.push({ type: "input_image", image_url: page.imageUrl })
          })
          const { parsed: narrowingParsed, rawText: narrowingRawText } = await callOpenAiJsonPrompt(narrowingContent, "Narrowing prompt failed")
          const bucketOrder = ["type", "base", "back", "arms", "detail", "finish", "material"]
          const aiNarrowingBuckets = Array.isArray(narrowingParsed.narrowing_buckets)
            ? narrowingParsed.narrowing_buckets
                .map((item) => ({
                  id: normalizeText(item.id || ""),
                  label: normalizeText(item.label || ""),
                  reason: normalizeText(item.reason || ""),
                  options: Array.isArray(item.options)
                    ? [...new Set(item.options.map((option) => normalizeText(option)).filter(Boolean))]
                        .sort((left, right) => left.localeCompare(right))
                    : []
                }))
                .filter((item) => item.id && item.label && item.options.length >= 2)
                .sort((left, right) => {
                  const leftIndex = bucketOrder.indexOf(left.id.toLowerCase())
                  const rightIndex = bucketOrder.indexOf(right.id.toLowerCase())
                  const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
                  const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex
                  if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight
                  return left.label.localeCompare(right.label)
                })
            : []
          const variantBreakdown = buildVariantBreakdownForPages(documentRecord, keptPages)
          const keywordStats = buildKeywordStatsFromVariantBreakdown(variantBreakdown)
          let keywordBucketGroups = []
          let keywordBucketRawText = ""
          if (variantBreakdown?.variants?.length && keywordStats.length >= 2) {
            try {
              const keywordContent = [{ type: "input_text", text: buildKeywordBucketingPrompt(productName, variantBreakdown, keywordStats) }]
              const { parsed: keywordParsed, rawText: keywordRawText } = await callOpenAiJsonPrompt(keywordContent, "Keyword bucket prompt failed")
              keywordBucketGroups = normalizeKeywordBuckets(keywordParsed?.keyword_buckets || keywordParsed?.buckets || [])
              keywordBucketRawText = keywordRawText
            } catch {}
          }
          const derivedNarrowingGroups = keywordBucketGroups.length
            ? keywordBucketGroups
            : buildProposedNarrowingTermsFromVariantBreakdown(variantBreakdown)
          narrowingBuckets = mergeNarrowingBuckets(aiNarrowingBuckets, derivedNarrowingGroups)
          appState.aiRerankRawText = [routingRawText, productSetRawText, narrowingRawText, keywordBucketRawText].filter(Boolean).join("\n\n")
        } else {
          appState.aiRerankRawText = [routingRawText, productSetRawText].filter(Boolean).join("\n\n")
        }
      } else {
        setLoadingStage(`Query found ${keptPages.length} likely pages. Choosing the best starting page.`)
        render()
        appState.aiRerankRawText = routingRawText
      }

      appState.aiRerankResult = {
        status: effectiveScopeType === "multi_product_scope" ? "similar_variants" : "single_match",
        relationship: effectiveScopeType === "multi_product_scope" ? "same_family" : "same_product",
        bestPage,
        confidence: "",
        summary: normalizeText(routingParsed.reason || countReason || ""),
        question: "",
        rawText: appState.aiRerankRawText,
        structureType: effectiveScopeType === "multi_product_scope" ? "product_family" : "single_product",
        interactionModel: effectiveScopeType === "multi_product_scope" && choiceMode === "show_model_numbers" ? "product_first" : "page_first",
        structureConfidence: Number.isFinite(Math.max(singleScopeLikelihood, multiScopeLikelihood))
          ? Math.max(singleScopeLikelihood, multiScopeLikelihood) / 100
          : 0,
        structureConfidenceLabel,
        documentDate,
        singleScopeLikelihood: Number.isFinite(singleScopeLikelihood) ? singleScopeLikelihood : null,
        multiScopeLikelihood: Number.isFinite(multiScopeLikelihood) ? multiScopeLikelihood : null,
        hasConcreteProducts: choiceMode === "show_model_numbers" && concreteProductCandidates.length > 1,
        concreteProductCandidates,
        matchingIds,
        choiceMode,
        variantCount,
        querySpecificity,
        countReason,
        appliedFilters,
        excludedFilters,
        excludedRows,
        narrowingBuckets,
        keptPages,
        variantComparison,
        orderedPages,
        runOpeners: shouldUseRunOpeners ? resolvedRunOpeners : []
      }
      console.log("[aiRerankResult] final choiceMode:", appState.aiRerankResult.choiceMode)
      console.log("[aiRerankResult] final querySpecificity:", appState.aiRerankResult.querySpecificity)
      console.log("[aiRerankResult] final variantCount:", appState.aiRerankResult.variantCount)
      appState.aiRerankDocumentId = documentRecord.id
      appState.aiRerankCacheByDocumentId[documentRecord.id] = cloneAiRerankResult(appState.aiRerankResult)
      updateStructureRoutingState(documentRecord)
      appState.summaryPanelOpen = false

      if (appState.aiRerankResult.bestPage) {
        setPage(appState.aiRerankResult.bestPage)
      } else {
        render()
      }
      showToast("AI rerank complete")
    } catch (error) {
      appState.aiRerankDocumentId = ""
      appState.aiRerankRawText = ""
      updateStructureRoutingState(documentRecord)
      appState.aiRerankError = error instanceof Error ? error.message : "AI rerank failed."
      showToast("AI rerank failed")
      render()
    } finally {
      appState.aiRerankLoading = false
      setLoadingStage("")
      render()
    }
  }

  async function analyzeSpecDecisions(targetPageNumber, selectionHints = {}) {
    const documentRecord = getActiveDocument()
    if (!documentRecord) return
    if (!hasVisionAccess()) {
      appState.decisionAssistError = "Add an OpenAI API key above or configure OPENAI_API_KEY on the local server before using spec decision analysis."
      showToast("Add an OpenAI API key first")
      render()
      return
    }

    try {
      appState.decisionAssistLoading = true
      appState.helpSpecLoadingLineIndex = 0
      appState.helpSpecLoadingLineOrder = buildHelpSpecLoadingLineOrder()
      appState.decisionAssistError = ""
      appState.decisionAssistResult = null
      appState.activeDecisionChoiceIndex = -1
      appState.decisionTabsWindowStart = 0
      startHelpSpecLoadingTicker()
      showToast("Analyzing spec decisions...")
      renderPreservingViewerScroll()

      const requestedPageNumber = Number.isFinite(Number(targetPageNumber)) ? Number(targetPageNumber) : appState.activePageNumber
      const selectedPage = documentRecord.pages.find((page) => page.pageNumber === requestedPageNumber)
      const parsingModeConfig = getSpecParsingModeConfig()
      if (!selectedPage) {
        throw new Error("Select a page first before running spec decision analysis.")
      }

      const selectedProductHint = normalizeText(selectionHints.selectedProductId || "")
      const selectedVariantHint = normalizeText(selectionHints.selectedVariantId || "")
      const fromProductFirst = selectionHints.fromProductFirst === true
      const candidatePages = getDecisionCandidatePages(documentRecord, selectedPage, selectionHints)
      if (!candidatePages.length) {
        throw new Error("No candidate pages were found for spec analysis.")
      }
      const candidateRangeLabel = formatPageRangeLabel(candidatePages.map((page) => page.pageNumber))

      const content = [
        {
          type: "input_text",
          text: [
            "You are a furniture spec extraction assistant reading manufacturer PDF pages.",
            `Brand: ${appState.spec.brandDisplayName || appState.spec.originalBrand || "Unknown"}`,
            `Product: ${appState.spec.specDisplayName || appState.spec.originalSpecName || "Unknown"}`,
            "",
            "== STEP 1: PAGE SCOPING ==",
            `Starting page: ${selectedPage.pageNumber}. Candidate pages: ${candidateRangeLabel}.`,
            parsingModeConfig.mode === "family"
              ? "Mode: family. Default to the clicked page only. Expand included_pages only when the clicked page explicitly references shared spec pages, finish tables, or powder coat references needed to interpret the result."
              : "Mode: section. Scan forward from the starting page. Keep adding pages only while they belong to the same contiguous product section.",
            parsingModeConfig.mode === "family"
              ? "Do not use page adjacency as a reason to expand. Expand only on explicit cross-references."
              : "Stop at the first page that is clearly a separate product section.",
            "Always populate included_pages. Always populate stop_reason.",
            "",
            "== STEP 2: PRODUCT AND VARIANT SELECTION ==",
            "After scoping pages, determine whether the starting page shows:",
            "  A) One exact product -> proceed directly to extraction.",
            "  B) Multiple variants of one family -> return variant_candidates first. Do not extract characteristics yet.",
            "  C) Multiple distinct products -> return product_candidates first. Do not extract characteristics yet.",
            selectedProductHint ? `Selected product hint: ${selectedProductHint}. Use this as the active product context.` : "Selected product hint: none.",
            selectedVariantHint ? `Selected variant hint: ${selectedVariantHint}. Scope all extraction to this variant only. Do not include sibling variants.` : "Selected variant hint: none.",
            "If a selected variant hint is provided, do not return variant_candidates. Proceed directly to extraction scoped to that variant.",
            "When returning candidates, return only what is visible on the starting page. Do not infer candidates from adjacent pages.",
            "When returning concrete model rows as variant candidates, use the exact model/item codes shown. Do not return abstract buckets like Base Type or Finish Type.",
            "",
            "== STEP 3: EXTRACTION ==",
            "Extract only after product and variant context is clear.",
            "Map content into characteristic types: Size / Dimensions, Configuration, Shell / Frame Finish, Upholstery / Material, Surface / Top Material, Compliance / Certifications, Options / Add-ons.",
            "Use specific labels when the source supports them (e.g. Shell Finish vs Frame Finish).",
            "",
            "Dimensions rule: return one labeled dimension per row inside values, semicolon-separated.",
            'Format: "A (Overall Depth): 35 in; B (Seat Height): 16 in"',
            "Never round, estimate, or convert. Preserve exact source notation including fractions (16 1/2 in) and decimals.",
            "",
            "Configuration tab rule: use a single Configuration tab only when pricing depends on a combination of multiple structural variables (e.g. Arms x Base Type).",
            "If structural options have independent additive pricing, treat them as separate characteristics, not one Configuration tab.",
            "Never use Step 1 / Step 2 language inside configuration sections.",
            "Never repeat the same option in multiple blocks.",
            "",
            "Pricing-only sections (Base Price, Price List, Order Information) are not characteristics. Put them in reference_info.",
            "Do not invent unsupported information.",
            "",
            "== OUTPUT RULES ==",
            "Return JSON only. No markdown fences.",
            "Always return every top-level key. Use empty string for unused string fields. Use empty array for unused array fields.",
            "Never omit a key.",
            "",
            "Required JSON shape:",
            '{',
            '  "included_pages": [86, 87],',
            '  "product_context": {',
            '    "product_name": "Eames Lounge Chair and Ottoman",',
            '    "model_family": "Lounge Seating",',
            '    "summary": "short product summary",',
            '    "inclusion_summary": "why these pages were included",',
            '    "stop_reason": "why the scan stopped"',
            "  },",
            '  "selected_product_id": "",',
            '  "product_candidates": [],',
            '  "selected_variant_id": "",',
            '  "variant_candidates": [],',
            '  "characteristics": [',
            '    {',
            '      "id": "size-dimensions",',
            '      "label": "Size / Dimensions",',
            '      "blurb": "short blurb",',
            '      "dependency_note": "",',
            '      "pricing_note": "",',
            '      "options": [',
            '        {"name": "Classic", "values": "A (Overall Depth): 35 in; B (Seat Height): 16 in", "pricing": "", "difference": "", "evidence": ""}',
            "      ]",
            '    }',
            "  ],",
            '  "reference_info": []',
            '}'
          ].join("\n")
        }
      ]

      const selectedPageText = candidatePages
        .map((page) => {
          const pageText = normalizeText(getPageCombinedText(page)).slice(0, 2200)
          return pageText ? `Page ${page.pageNumber} text:\n${pageText}` : ""
        })
        .filter(Boolean)
        .join("\n\n")

      if (selectedPageText) {
        content.push({
          type: "input_text",
          text: `Extracted text from candidate pages ${candidateRangeLabel}:\n${selectedPageText}`
        })
      }

      for (const page of candidatePages) {
        const canvas = await renderPdfPageToCanvas(documentRecord, page.pageNumber, 1.35)
        content.push({
          type: "input_text",
          text: `Candidate product page ${page.pageNumber}.`
        })
        content.push({
          type: "input_image",
          image_url: canvas.toDataURL("image/png")
        })
      }

      const response = await sendOpenAiResponsesRequest({
        model: appState.visionModel || DEFAULT_VISION_MODEL,
        input: [{ role: "user", content }]
      }, "OpenAI request timed out.")

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Decision analysis failed (${response.status}): ${errorBody.slice(0, 180)}`)
      }

      const payload = await response.json()
      const rawText = extractResponseText(payload)
      const parsed = parseJsonPayload(rawText)
      if (!parsed) {
        throw new Error("Decision analysis returned an unreadable response.")
      }

      const candidatePageSet = new Set(candidatePages.map((page) => page.pageNumber))
      const includedPagesRaw = Array.isArray(parsed.included_pages)
        ? parsed.included_pages.map((value) => Number(value)).filter((value) => Number.isFinite(value) && candidatePageSet.has(value))
        : []
      const sortedIncluded = [...new Set([selectedPage.pageNumber, ...includedPagesRaw])].sort((a, b) => a - b)
      const includedPages = parsingModeConfig.mode === "family"
        ? sortedIncluded
        : (() => {
            const pages = [selectedPage.pageNumber]
            let expectedPage = selectedPage.pageNumber + 1
            sortedIncluded.forEach((pageNumber) => {
              if (pageNumber === expectedPage) {
                pages.push(pageNumber)
                expectedPage += 1
              }
            })
            return pages
          })()
      const pageRangeLabel = formatPageRangeLabel(includedPages)
      const resolvedProductName = normalizeText(parsed.product_context?.product_name || "")
      const productCandidates = filterCandidatesToResolvedProduct(
        filterCandidatesToStartingPage(
          normalizeDecisionCandidates(parsed.product_candidates),
          selectedPage.pageNumber
        ),
        resolvedProductName
      )
      const rawVariantCandidates = preferConcretePageVariants(
        filterVariantCandidatesToSelectedPage(
          normalizeDecisionCandidates(parsed.variant_candidates),
          selectedPage,
          documentRecord
        ),
        selectedPage,
        selectedVariantHint || parsed.selected_variant_id || "",
        documentRecord
      )
      const characteristics = splitOvergroupedConfiguration(normalizeDecisionCharacteristics(parsed.characteristics))
      const includedPageRecords = includedPages
        .map((pageNumber) => documentRecord.pages.find((page) => page.pageNumber === pageNumber))
        .filter(Boolean)
      const variantCandidates = shouldTreatVariantCandidatesAsConfiguration(rawVariantCandidates, includedPageRecords)
        ? []
        : (
          fromProductFirst && parsingModeConfig.mode === "family"
            ? suppressProductFirstSiblingVariants(rawVariantCandidates, selectedProductHint, appState.structureRouting?.productCandidates || [])
            : rawVariantCandidates
        )
      const supplementalCharacteristics = buildSupplementalCharacteristics(documentRecord, includedPageRecords, characteristics)
      const referenceInfo = Array.isArray(parsed.reference_info) ? parsed.reference_info : []
      const productScopedCharacteristics = fromProductFirst && selectedProductHint
        ? filterCharacteristicsForSelectedRecord(
            enrichCharacteristicsFromSectionPages(
              mergeReferenceTextileIntoDimensions(
                removeTextileRequirementOptionsFromUpholstery(
                  mergeComColIntoDimensions([...characteristics, ...supplementalCharacteristics])
                ),
                referenceInfo
              ),
              includedPageRecords
            ),
            appState.structureRouting?.productCandidates || [],
            selectedProductHint
          )
        : enrichCharacteristicsFromSectionPages(
            mergeReferenceTextileIntoDimensions(
              removeTextileRequirementOptionsFromUpholstery(
                mergeComColIntoDimensions([...characteristics, ...supplementalCharacteristics])
              ),
              referenceInfo
            ),
            includedPageRecords
          )
      const mergedCharacteristics = sortCharacteristicsForDisplay(
        filterCharacteristicsForSelectedVariant(
          productScopedCharacteristics,
          variantCandidates,
          selectedVariantHint || parsed.selected_variant_id || ""
        )
      )
      const hydratedCharacteristics = await fillMissingDimensionOptions(
        documentRecord,
        includedPageRecords,
        mergedCharacteristics,
        variantCandidates,
        selectedVariantHint || parsed.selected_variant_id || ""
      )
      const prunedCharacteristics = pruneResolvedConfigurationCharacteristics(
        hydratedCharacteristics,
        selectedVariantHint || parsed.selected_variant_id || ""
      )
      const resolvedSelectedProductId = normalizeText(parsed.selected_product_id || selectedProductHint || (productCandidates.length === 1 ? productCandidates[0].id : ""))
      const resolvedSelectedVariantId = normalizeText(parsed.selected_variant_id || selectedVariantHint || (variantCandidates.length === 1 ? variantCandidates[0].id : ""))

      appState.decisionAssistResult = {
        pageNumber: selectedPage.pageNumber,
        parsingMode: parsingModeConfig.mode,
        fromProductFirst,
        pageRangeLabel,
        includedPages,
        productName: resolvedProductName,
        modelFamily: normalizeText(parsed.product_context?.model_family || ""),
        summary: normalizeText(parsed.product_context?.summary || ""),
        inclusionSummary: normalizeText(parsed.product_context?.inclusion_summary || ""),
        stopReason: normalizeText(parsed.product_context?.stop_reason || ""),
        productCandidates,
        selectedProductId: resolvedSelectedProductId,
        variantCandidates,
        selectedVariantId: resolvedSelectedVariantId,
        characteristics: prunedCharacteristics,
        referenceInfo
      }
      const attributeExtraction = (
        (!productCandidates.length || resolvedSelectedProductId)
        && (!variantCandidates.length || resolvedSelectedVariantId)
      ) ? buildDecisionAssistAttributeExtraction(appState.decisionAssistResult) : null
      if (attributeExtraction) {
        applyAttributeExtractionResult(attributeExtraction, { populateValues: true })
      }
      appState.activeDecisionChoiceIndex = prunedCharacteristics.length ? 0 : -1
      appState.decisionTabsWindowStart = 0

      renderPreservingViewerScroll()
      showToast(
        productCandidates.length > 1 && !resolvedSelectedProductId
          ? "Select the product to continue"
          : variantCandidates.length > 1 && !resolvedSelectedVariantId
            ? "Select the variant to continue"
            : `Spec details ready (pages ${pageRangeLabel})`
      )
    } catch (error) {
      appState.decisionAssistError = error instanceof Error ? error.message : "Decision analysis failed."
      showToast("Spec decision analysis failed")
      renderPreservingViewerScroll()
    } finally {
      appState.decisionAssistLoading = false
      stopHelpSpecLoadingTicker()
      renderPreservingViewerScroll()
    }
  }

  async function analyzePageImage(pageNumber) {
    const documentRecord = getActiveDocument()
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    if (!documentRecord || !page) return

    try {
      appState.ocrStatusByPage[pageNumber] = "running"
      appState.ocrErrorByPage[pageNumber] = ""
      patchPageReadableArea(pageNumber)
      const canvas = await renderPdfPageToCanvas(documentRecord, pageNumber, 2)
      const result = await analyzeDimensionsWithVision(pageNumber, canvas)
      page.ocrText = result.formattedText || normalizeText(result.rawText || "")
      appState.ocrStatusByPage[pageNumber] = "done"
      appState.ocrErrorByPage[pageNumber] = ""
      runRanking(false)
      patchPageReadableArea(pageNumber)
      saveCurrentAsDefault().catch(() => {})
      showToast(page.ocrText ? `Vision analysis added to page ${pageNumber}` : `No image text found on page ${pageNumber}`)
    } catch (error) {
      appState.ocrStatusByPage[pageNumber] = "error"
      appState.ocrErrorByPage[pageNumber] = error instanceof Error ? error.message : "Image analysis failed."
      patchPageReadableArea(pageNumber)
      showToast(`Image analysis failed for page ${pageNumber}`)
    }
  }

  async function revealPageText(pageNumber, variant = "transcript") {
    const documentRecord = getActiveDocument()
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    if (!documentRecord || !page) return

    const renderKey = getPageRenderKey(documentRecord, pageNumber)
    const readableCacheKey = getReadableCacheKey(renderKey, variant)
    appState.pageTextVisibleByKey[renderKey] = true
    appState.pageReadableVariantByKey[renderKey] = variant
    patchPageReadableArea(pageNumber)

    if (!normalizeText(getPageCombinedText(page)) && hasVisionAccess() && appState.ocrStatusByPage[pageNumber] !== "running") {
      appState.pageReadableStatusByKey[readableCacheKey] = "extracting_text"
      appState.pageReadableErrorByKey[readableCacheKey] = ""
      patchPageReadableArea(pageNumber)
      await analyzePageImage(pageNumber)
    }

    if (!hasVisionAccess()) {
      return
    }

    if (
      appState.pageReadableHtmlByKey[readableCacheKey]
      || (appState.pageReadableStatusByKey[readableCacheKey] && appState.pageReadableStatusByKey[readableCacheKey] !== "done" && appState.pageReadableStatusByKey[readableCacheKey] !== "error")
    ) {
      return
    }

    if (variant === "summary") {
      await summarizePageForSpec(pageNumber)
      return
    }

    await formatPageTextWithAi(pageNumber)
  }

  async function formatPageTextWithAi(pageNumber) {
    const documentRecord = getActiveDocument()
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    if (!documentRecord || !page) return
    if (!hasVisionAccess()) {
      showToast("Add an OpenAI API key first")
      patchPageReadableArea(pageNumber)
      return
    }

    const renderKey = getPageRenderKey(documentRecord, pageNumber)
    const readableCacheKey = getReadableCacheKey(renderKey, "transcript")
    appState.pageReadableStatusByKey[readableCacheKey] = "extracting_text"
    appState.pageReadableErrorByKey[readableCacheKey] = ""
    patchPageReadableArea(pageNumber)

    const rawText = getPageCombinedText(page)
    if (!normalizeText(rawText)) {
      appState.pageReadableErrorByKey[readableCacheKey] = "No extractable page text was found."
      appState.pageReadableStatusByKey[readableCacheKey] = "error"
      patchPageReadableArea(pageNumber)
      return
    }

    try {
      appState.pageReadableStatusByKey[readableCacheKey] = "formatting_text"
      appState.pageReadableErrorByKey[readableCacheKey] = ""
      patchPageReadableArea(pageNumber)
      scheduleReadableStatusSequence(readableCacheKey, [
        { delay: 1200, status: "structuring_text" },
        { delay: 2800, status: "finalizing_text" }
      ], pageNumber)

      const prompt = [
        "You are cleaning up extracted PDF text for a furniture spec editor.",
        "Reformat the text so it is easier to scan and copy from.",
        "Preserve the exact wording, numbers, dimensions, and factual content from the source text.",
        "Do not summarize. Do not add facts. Do not delete facts.",
        "You may only improve structure: restore headings, combine broken lines into paragraphs, and convert obvious lists into bullet lists.",
        "If the source text is ambiguous, keep it literal rather than guessing.",
        "Return JSON only with no markdown fences.",
        'Use only these HTML tags inside the "html" field: h3, h4, p, ul, ol, li, strong, em, br.',
        "",
        "Required JSON shape:",
        '{',
        '  "html": "<h3>Section</h3><p>Readable paragraph...</p>"',
        '}',
        "",
        `Page ${pageNumber} extracted text:`,
        rawText
      ].join("\n")

      const response = await sendOpenAiResponsesRequest({
        model: appState.visionModel || DEFAULT_VISION_MODEL,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
      }, "OpenAI request timed out.")

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`AI formatting failed (${response.status}): ${errorBody.slice(0, 180)}`)
      }

      const payload = await response.json()
      const rawResponseText = extractResponseText(payload)
      const parsed = parseJsonPayload(rawResponseText)
      const sanitizedHtml = sanitizeReadableHtml(parsed?.html || "")
      if (!sanitizedHtml) {
        throw new Error("AI formatting returned an unreadable result.")
      }

      appState.pageReadableHtmlByKey[readableCacheKey] = sanitizedHtml
      appState.pageReadableTargetsByKey[readableCacheKey] = []
      appState.pageReadableStatusByKey[readableCacheKey] = "done"
      appState.pageReadableErrorByKey[readableCacheKey] = ""
      clearReadableStatusTimers(readableCacheKey)
      patchPageReadableArea(pageNumber)
      showToast(`Formatted page ${pageNumber}`)
    } catch (error) {
      appState.pageReadableStatusByKey[readableCacheKey] = "error"
      appState.pageReadableErrorByKey[readableCacheKey] = error instanceof Error ? error.message : "AI formatting failed."
      clearReadableStatusTimers(readableCacheKey)
      patchPageReadableArea(pageNumber)
      showToast(`Formatting failed for page ${pageNumber}`)
    }
  }

  async function summarizePageForSpec(pageNumber) {
    const documentRecord = getActiveDocument()
    const page = documentRecord?.pages.find((item) => item.pageNumber === pageNumber)
    if (!documentRecord || !page) return
    if (!hasVisionAccess()) {
      showToast("Add an OpenAI API key first")
      patchPageReadableArea(pageNumber)
      return
    }

    const renderKey = getPageRenderKey(documentRecord, pageNumber)
    const readableCacheKey = getReadableCacheKey(renderKey, "summary")
    const focusBand = getPageVariantHighlightBand(documentRecord, pageNumber)

    try {
      appState.pageReadableStatusByKey[readableCacheKey] = "reading_image"
      appState.pageReadableErrorByKey[readableCacheKey] = ""
      patchPageReadableArea(pageNumber)

      const canvas = await renderPdfPageToCanvas(documentRecord, pageNumber, 1.8)
      const summaryCanvas = focusBand
        ? cropCanvasToVerticalRange(canvas, focusBand.topPercent, focusBand.heightPercent)
        : canvas
      const imageUrl = summaryCanvas.toDataURL("image/png")
      const fullPageImageUrl = canvas.toDataURL("image/png")
      const rawText = normalizeText(getPageCombinedText(page))
      const prompt = [
        "You are reviewing a furniture specification PDF page for a designer who needs to configure a product accurately.",
        focusBand
          ? "Create a highly specific, scan-friendly summary based only on the visible vertical range shown in the image crop."
          : "Create a highly specific, scan-friendly page summary based on what is visibly shown on the page image.",
        focusBand
          ? "Do not summarize content outside this cropped range. Focus only on the models, options, dimensions, finishes, and notes that are visible in this selected band."
          : "Your summary must preserve all details that could matter for specification, including model names, option groupings, dimensions, finish names, upholstery info, pricing deltas, codes, exclusions, and footnotes if visible.",
        focusBand
          ? "Also inspect the full list of visible variants on the page to capture shared context that applies to the selected rows, such as column headers, grade labels, pricing columns, repeated measurement headers, or section labels."
          : "",
        focusBand
          ? "Shared headers may appear above the top-most variant row or below the variant list rather than directly above or below the selected band."
          : "",
        focusBand
          ? "Use that broader page context only when it clearly governs the selected rows. Do not pull in unrelated neighboring rows."
          : "",
        focusBand
          ? "If headers such as Gr A, Gr B, Gr C, COM, COL, W, D, H, SH, or AH appear outside the crop but clearly apply to the selected rows, include them in the summary."
          : "",
        focusBand
          ? "Inspect the entire header row, including rotated or vertical labels, before listing grade columns."
          : "",
        focusBand
          ? "Preserve complete ordered header sequences when visible. If the page shows Gr A through Gr I, do not start the sequence at Gr B."
          : "",
        focusBand
          ? "When a leftmost header is faint, rotated, or easy to miss, explicitly check for it before concluding the sequence begins later."
          : "",
        focusBand
          ? "When shared headers are found, map them to the corresponding visible values from the selected row or rows."
          : "",
        focusBand
          ? "Do not list grade columns such as Gr A, Gr B, Gr C by themselves if the matching prices or values for the selected row are visible. Pair each header with its value."
          : "",
        focusBand
          ? 'Example: if the selected row shows Fabric values under Gr A, Gr B, Gr C, return "Fabric Gr A: 1737", "Fabric Gr B: 1748", "Fabric Gr C: 1761" rather than listing only the grade names.'
          : "",
        focusBand
          ? "If some row values are cut off or unclear, include only the pairs you can read reliably and note any missing ones as unclear."
          : "",
        focusBand
          ? "Treat this as a targeted range review for one part of the page rather than a whole-page summary."
          : "Your summary must preserve all details that could matter for specification, including model names, option groupings, dimensions, finish names, upholstery info, pricing deltas, codes, exclusions, and footnotes if visible.",
        "You may reorganize and clarify the content for readability, but do not omit pertinent details and do not invent anything.",
        "Prefer structured sections and bullet lists that make copying and scanning easier than the source layout.",
        "If a detail is only partially legible, include it cautiously and say it is unclear rather than guessing.",
        "Also extract likely copy targets that a designer would want to click directly, limited to model numbers, dimensions, finishes, and selectable options.",
        "Do not return prices, prose sentences, COM/COL, or general descriptive text as copy targets.",
        "Each copy target should contain the exact visible value string and a short label plus a field hint when obvious.",
        "Return JSON only with no markdown fences.",
        'Use only these HTML tags inside the "html" field: h3, h4, p, ul, ol, li, strong, em, br.',
        "",
        "Required JSON shape:",
        '{',
        '  "html": "<h3>Product</h3><p>...</p><h4>Options</h4><ul><li>...</li></ul>",',
        '  "copy_targets": [',
        '    {"label": "Overall Depth", "value": "25 1/4\\"", "type": "dimension", "field_hint": "depth"}',
        "  ]",
        '}',
        focusBand ? `Selected focus range on page ${pageNumber}: top ${Math.round(focusBand.topPercent)}%, height ${Math.round(focusBand.heightPercent)}% of the page.` : "",
        rawText ? "" : "No reliable extracted text is available for this page, so rely primarily on the image.",
        rawText ? `Extracted/OCR text for reference:\n${rawText}` : ""
      ].filter(Boolean).join("\n")

      appState.pageReadableStatusByKey[readableCacheKey] = "building_summary"
      patchPageReadableArea(pageNumber)
      scheduleReadableStatusSequence(readableCacheKey, [
        { delay: 1400, status: "cross_checking_summary" },
        { delay: 3200, status: "finalizing_summary" },
        { delay: 5200, status: "verifying_summary" },
        { delay: 7000, status: "polishing_summary" },
        { delay: 8600, status: "preparing_summary_output" }
      ], pageNumber)

      const response = await sendOpenAiResponsesRequest({
        model: appState.visionModel || DEFAULT_VISION_MODEL,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageUrl },
              ...(focusBand
                ? [
                    { type: "input_text", text: "Reference full-page image for nearby headers and shared context only:" },
                    { type: "input_image", image_url: fullPageImageUrl }
                  ]
                : [])
            ]
          }
        ]
      }, "OpenAI request timed out.")

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`AI summary failed (${response.status}): ${errorBody.slice(0, 180)}`)
      }

      const payload = await response.json()
      const rawResponseText = extractResponseText(payload)
      const parsed = parseJsonPayload(rawResponseText)
      const sanitizedHtml = sanitizeReadableHtml(parsed?.html || "")
      const normalizedTargets = normalizeReadableCopyTargets(parsed?.copy_targets)
      if (!sanitizedHtml) {
        throw new Error("AI summary returned an unreadable result.")
      }

      appState.pageReadableHtmlByKey[readableCacheKey] = sanitizedHtml
      appState.pageReadableTargetsByKey[readableCacheKey] = normalizedTargets
      appState.pageReadableStatusByKey[readableCacheKey] = "done"
      appState.pageReadableErrorByKey[readableCacheKey] = ""
      const attributeExtraction = buildAttributeExtractionFromReadableSummary(sanitizedHtml)
      if (attributeExtraction) {
        applyAttributeExtractionResult(attributeExtraction, { populateValues: true })
      }
      clearReadableStatusTimers(readableCacheKey)
      patchPageReadableArea(pageNumber)
      showToast(`Summarized page ${pageNumber}`)
    } catch (error) {
      appState.pageReadableStatusByKey[readableCacheKey] = "error"
      appState.pageReadableErrorByKey[readableCacheKey] = error instanceof Error ? error.message : "AI summary failed."
      clearReadableStatusTimers(readableCacheKey)
      patchPageReadableArea(pageNumber)
      showToast(`Summary failed for page ${pageNumber}`)
    }
  }

  function extractTextFromContentItems(items) {
    const rows = new Map()

    items.forEach((item) => {
      if (!item.str || !item.str.trim()) return
      const y = Math.round((item.transform?.[5] || 0) / 4) * 4
      const x = item.transform?.[4] || 0
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push({ x, text: item.str })
    })

    return [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, rowItems]) =>
        rowItems
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text)
          .join(" ")
      )
      .join("\n")
  }

  function clearSelectionState() {
    appState.selectionText = ""
    appState.selectionSource = ""
    appState.selectionRect = null
    appState.pickerPosition = null
    appState.confirmPosition = null
    appState.pendingFieldKey = ""
    appState.pendingInsertText = ""
    updateFloatingCopyButton()
  }

  function analyzeRankedPages(documentRecord, rankedPages) {
    const top = rankedPages[0]
    if (!documentRecord || !top) {
      return null
    }

    if (getSpecParsingMode() === "family") {
      const topPages = rankedPages.slice(0, 4).map((page) => ({
        ...page,
        text: getPageCombinedText(documentRecord.pages.find((candidate) => candidate.pageNumber === page.pageNumber))
      }))
      const visualSignals = summarizeVisualSignals(topPages)
      const options = extractAmbiguityOptions(topPages)
      const second = rankedPages[1]
      const weakTopMatch = top.score < 24
      const closeCompetition = second && top.score - second.score <= 8

      if (weakTopMatch) {
        return {
          status: "no_match",
          title: "No strong family match yet",
          confidenceLabel: "Needs more context",
          recommendedPage: 1,
          reason: "The current product-name signals are not distinctive enough to isolate the right family pages with confidence.",
          question: "Try a more specific family, product, or variant name.",
          options: [],
          visualSignals,
          topPages: []
        }
      }

      if (!appState.assistantSelection && options.length >= 2 && closeCompetition) {
        return {
          status: "ambiguous",
          title: "Multiple family matches detected",
          confidenceLabel: "Ambiguous family match",
          recommendedPage: top.pageNumber,
          reason: "Several non-adjacent pages look relevant to the same search. Pick the product or variant that matches, then the viewer will retarget that family context.",
          question: "Select the model, product, or variant that best matches the family you want.",
          options,
          visualSignals,
          topPages: rankedPages.slice(0, 3).map((page) => page.pageNumber)
        }
      }

      return {
        status: "match",
        title: "Likely family pages found",
        confidenceLabel: top.score >= 90 ? "High confidence" : "Medium confidence",
        recommendedPage: top.pageNumber,
        reason: "The strongest matches are based on family relevance and shared reference signals, not adjacent-page clustering.",
        question: "",
        options: [],
        visualSignals,
        topPages: rankedPages.slice(0, 3).map((page) => page.pageNumber)
      }
    }

    const clusters = buildPageClusters(rankedPages)
    const primaryCluster = clusters[0]
    const secondCluster = clusters[1]
    const clusterPages = primaryCluster.pages.map((page) => ({
      ...page,
          text: getPageCombinedText(documentRecord.pages.find((candidate) => candidate.pageNumber === page.pageNumber))
        }))
    const visualSignals = summarizeVisualSignals(clusterPages)
    const options = extractAmbiguityOptions(clusterPages)
    const weakTopMatch = top.score < 24
    const closeCompetition = secondCluster && primaryCluster.totalScore - secondCluster.totalScore <= 20

    if (weakTopMatch || !primaryCluster) {
      return {
        status: "no_match",
        title: "No strong product section yet",
        confidenceLabel: "Needs more context",
        recommendedPage: 1,
        reason: "The current product-name signals are not distinctive enough to isolate a likely product section with confidence.",
        question: "Try a more specific product name, family name, or variant.",
        options: [],
        visualSignals,
        topPages: []
      }
    }

    if (!appState.assistantSelection && options.length >= 2 && closeCompetition) {
      return {
        status: "ambiguous",
        title: "Multiple likely product sections detected",
        confidenceLabel: "Ambiguous section match",
        recommendedPage: primaryCluster.startPage,
        reason: `The strongest candidates form more than one nearby page cluster. The current best section is ${formatPageRange(primaryCluster.startPage, primaryCluster.endPage)}, but another section is competitive.`,
        question: "Select the model, variant, or descriptor that best matches the product, then the viewer will retarget that section.",
        options,
        visualSignals,
        topPages: primaryCluster.pages.map((page) => page.pageNumber).slice(0, 3)
      }
    }

    if (appState.assistantSelection) {
      return {
        status: "match",
        title: "Product section retargeted",
        confidenceLabel: "User-confirmed",
        recommendedPage: primaryCluster.startPage,
        reason: `The selected clarifier "${appState.assistantSelection}" pushed ${formatPageRange(primaryCluster.startPage, primaryCluster.endPage)} to the top of the retrieval results.`,
        question: "",
        options: [],
        visualSignals,
        topPages: primaryCluster.pages.map((page) => page.pageNumber).slice(0, 3)
      }
    }

    return {
      status: "match",
      title: "Likely product section found",
      confidenceLabel: primaryCluster.totalScore >= 90 ? "High confidence" : "Medium confidence",
      recommendedPage: primaryCluster.startPage,
      reason: `The best match is the section spanning ${formatPageRange(primaryCluster.startPage, primaryCluster.endPage)}. Retrieval is based on product-name signals, then the page analyst labels the section contents.`,
      question: "",
      options: [],
      visualSignals,
      topPages: primaryCluster.pages.map((page) => page.pageNumber).slice(0, 3)
    }
  }

  function getRetrievalGuidance(documentRecord, rankedPages, structureRouting = null) {
    if (!documentRecord || !Array.isArray(rankedPages) || rankedPages.length < 3) return null

    if (Array.isArray(appState.aiRerankResult?.narrowingBuckets) && appState.aiRerankResult.narrowingBuckets.length) {
      const query = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "this search")
      return {
        text: `Broad search. Try a product name, model code, or variant for "${query}".`,
        groups: appState.aiRerankResult.narrowingBuckets.map((bucket) => ({
          id: bucket.id,
          label: bucket.label,
          options: Array.isArray(bucket.options) ? bucket.options : []
        }))
      }
    }

    const analyzed = analyzeRankedPages(documentRecord, rankedPages)
    const topSlice = rankedPages.slice(0, 5)
    const topScore = Number(topSlice[0]?.score)
    const closePages = topSlice.filter((page) => Number.isFinite(Number(page.score)) && topScore - Number(page.score) <= 8)
    const broadCluster = closePages.length >= 4

    if (analyzed?.status !== "ambiguous" && !broadCluster) return null

    const productCandidateCount = structureRouting?.productCandidates?.length || 0
    const query = normalizeText(appState.spec.specDisplayName || appState.spec.originalSpecName || "this search")
    const leadingText = productCandidateCount >= 4
      ? "Broad search."
      : `Several top pages look equally relevant for "${query}".`
    const trailingText = getSpecParsingMode() === "family"
      ? "Try a product name, model code, or variant."
      : "Try a product name, model, or descriptor."

    const textPool = [
      ...(structureRouting?.productCandidates || []).flatMap((candidate) => [candidate?.label, candidate?.description, candidate?.evidence]),
      ...(appState.aiRerankResult?.variantComparison || []).flatMap((item) => [item?.label, item?.difference, item?.reason]),
      ...topSlice.flatMap((page) => [page?.label, page?.reason])
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .join(" \n ")

    const collectMatches = (terms) => [...new Set(
      terms
        .filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(textPool))
        .map((term) => titleCaseWords(term))
    )]

    const groups = [
      {
        id: "base",
        label: "Base",
        options: collectMatches([
          "wire base",
          "wood base",
          "nylon base",
          "aluminum base",
          "jury base",
          "fixed pedestal",
          "swivel pedestal",
          "memory swivel",
          "fixed",
          "swivel"
        ]).slice(0, 10)
      },
      {
        id: "back",
        label: "Back",
        options: collectMatches([
          "low back",
          "mid back",
          "high back",
          "mesh back",
          "upholstered back"
        ]).slice(0, 10)
      },
      {
        id: "type",
        label: "Type",
        options: collectMatches([
          "desk chair",
          "conference chair",
          "task chair",
          "jury chair",
          "stool",
          "footrest",
          "ottoman",
          "lounge chair"
        ]).slice(0, 10)
      },
      {
        id: "detail",
        label: "Detail",
        options: collectMatches([
          "exposed veneer shell",
          "interior upholstery",
          "fully upholstered",
          "all same material",
          "contrasting material",
          "armless",
          "arms"
        ]).slice(0, 10)
      }
    ].filter((group) => group.options.length >= 1)

    return {
      text: `${leadingText} ${trailingText}`,
      groups
    }
  }

  function getSearchBaseQuery() {
    return normalizeText(appState.search?.baseQuery || "")
  }

  function getSelectedNarrowingTerms() {
    return [...new Set((Array.isArray(appState.search?.selectedTerms) ? appState.search.selectedTerms : [])
      .map((term) => normalizeText(term))
      .filter(Boolean))]
  }

  function getSelectedRetrievalRefinementTerms() {
    return getSelectedNarrowingTerms()
  }

  function getSearchFullQuery() {
    const baseQuery = getSearchBaseQuery()
    const selectedTerms = getSelectedNarrowingTerms()
    const queryParts = [baseQuery]
    selectedTerms.forEach((term) => {
      if (!queryParts.some((part) => part.toLowerCase() === term.toLowerCase())) {
        queryParts.push(term)
      }
    })
    return normalizeText(queryParts.join(" "))
  }

  function buildRefinedQueryFromSelections() {
    return getSearchFullQuery()
  }

  function getBaseProductFamilyName() {
    console.log('[getBaseProductFamilyName] candidates:', {
      baseQuery: appState.search?.baseQuery,
      inputDraftProductName: appState.inputDraft.productName,
      originalSpecName: appState.spec.originalSpecName,
      specDisplayName: appState.spec.specDisplayName
    })
    const familyName = getSearchBaseQuery() || "Unknown"
    console.log("[getBaseProductFamilyName] value:", familyName)
    return familyName
  }

  function getMergedLongestQueryProductName() {
    const candidates = [
      { source: "inputDraft.productName", value: normalizeText(appState.inputDraft.productName || "") },
      { source: "specDisplayName", value: normalizeText(appState.spec.specDisplayName || "") },
      { source: "originalSpecName", value: normalizeText(appState.spec.originalSpecName || "") }
    ].filter((candidate) => candidate.value)

    const selected = candidates
      .slice()
      .sort((left, right) => right.value.length - left.value.length)[0]

    console.log("[getMergedLongestQueryProductName] candidates:", candidates)
    console.log("[getMergedLongestQueryProductName] selected:", selected?.source || "fallback", selected?.value || "Unknown")

    return selected?.value || "Unknown"
  }

  function getCurrentQueryProductName() {
    const inputDraftProductName = normalizeText(appState.inputDraft.productName || "")
    const specDisplayName = normalizeText(appState.spec.specDisplayName || "")
    const originalSpecName = normalizeText(appState.spec.originalSpecName || "")
    let source = "fallback"
    let value = "Unknown"

    if (inputDraftProductName) {
      source = "inputDraft.productName"
      value = inputDraftProductName
    } else if (specDisplayName) {
      source = "specDisplayName"
      value = specDisplayName
    } else if (originalSpecName) {
      source = "originalSpecName"
      value = originalSpecName
    }

    console.log("[getCurrentQueryProductName] source:", source, "value:", value)
    return value
  }

  function renderRetrievalGuidance(guidance) {
    if (!guidance) return ""
    const selectedTerms = getSelectedRetrievalRefinementTerms()
    const nextQuery = buildRefinedQueryFromSelections()
    return `
      <div class="help-spec-refinement-note">
        <p>${escapeHtml(guidance.text)}</p>
        ${
          guidance.groups?.length
            ? `
              <div class="help-spec-refinement-groups">
                ${guidance.groups.map((group) => `
                  <div class="help-spec-refinement-group">
                    <span class="help-spec-refinement-label">${escapeHtml(group.label)}</span>
                    <div class="help-spec-refinement-actions">
                      ${group.options.map((option) => {
                        const isSelected = getSelectedNarrowingTerms().some((term) => term.toLowerCase() === normalizeText(option).toLowerCase())
                        return `
                          <button class="help-spec-refinement-chip${isSelected ? " is-selected" : ""}" data-refine-group="${escapeHtmlAttribute(group.id)}" data-refine-option="${escapeHtmlAttribute(option)}" type="button">${escapeHtml(option)}</button>
                        `
                      }).join("")}
                    </div>
                  </div>
                `).join("")}
              </div>
              ${selectedTerms.length
                ? `
                  <div class="help-spec-refinement-group">
                    <span class="help-spec-refinement-label">Selected terms</span>
                    <div class="help-spec-refinement-actions">
                      ${selectedTerms.map((term) => `
                        <button class="help-spec-refinement-chip is-selected" data-refine-remove="${escapeHtmlAttribute(term)}" type="button">${escapeHtml(term)}</button>
                      `).join("")}
                    </div>
                  </div>
                `
                : ""
              }
              <div class="help-spec-refinement-footer">
                <button class="ghost-btn ghost-btn-compact" data-refine-apply="${escapeHtmlAttribute(nextQuery)}" type="button"${selectedTerms.length ? "" : " disabled"}>Narrow search</button>
              </div>
            `
            : ""
        }
      </div>
    `
  }

  function analyzePageForVisualCues(pageText) {
    const text = pageText || ""
    const measurementMatches = text.match(/\b\d+(?:\s+\d\/\d)?(?:["”]| in\b| inches\b)?\b/g) || []
    const hasDimensionKeywords = /dimensions?|overall width|overall depth|overall height|seat height|dia\b/i.test(text)
    const hasSpecKeywords = /notes|description|finish|material|frame|upholstery|glides|veneer/i.test(text)
    const shortLineCount = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.length <= 24).length

    const likelyDrawingPage = measurementMatches.length >= 4 && (hasDimensionKeywords || shortLineCount >= 6)
    const likelySpecPage = hasSpecKeywords && (measurementMatches.length >= 2 || hasDimensionKeywords)
    const likelyIndexPage = /introduction|index|contents|price book|seating \d+/i.test(text) && measurementMatches.length < 3

    let primaryLabel = "Text-heavy page"
    if (likelyIndexPage) primaryLabel = "Index or navigation page"
    else if (likelyDrawingPage) primaryLabel = "Likely dimensions drawing"
    else if (likelySpecPage) primaryLabel = "Likely product spec page"

    const labels = []
    if (likelyDrawingPage) labels.push("Likely dimensions drawing")
    if (likelySpecPage) labels.push("Spec content detected")
    if (likelyIndexPage) labels.push("Index-like structure")
    if (!labels.length) labels.push("General content page")

    return {
      primaryLabel,
      labels
    }
  }

  function summarizeVisualSignals(candidatePages) {
    const signalSet = new Set()
    candidatePages.forEach((page) => {
      analyzePageForVisualCues(page.text).labels.forEach((label) => signalSet.add(label))
    })
    return [...signalSet].slice(0, 4)
  }

  async function schedulePreviewRendering() {
    const documentRecord = getActiveDocument()
    if (!documentRecord || documentRecord.sourceType !== "uploaded" || !documentRecord.pdfBytes) return

      const pagesToRender = appState.rankedPages.slice(0, 3).map((page) => page.pageNumber)
    if (!pagesToRender.length) return

    try {
      const pdfjsLib = await loadPdfJsLibrary()
      const loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(documentRecord.pdfBytes) })
      const pdfDocument = await loadingTask.promise

      for (const pageNumber of pagesToRender) {
        const previewKey = `${documentRecord.id}:${pageNumber}`
        if (appState.pagePreviews[previewKey]) continue
        const page = await pdfDocument.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 0.32 })
        const canvas = document.createElement("canvas")
        const context = canvas.getContext("2d")
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvasContext: context, viewport }).promise
        appState.pagePreviews[previewKey] = canvas.toDataURL("image/png")
      }

      render()
    } catch (error) {
      // Preview rendering should fail quietly; ranking should still work without thumbnails.
    }
  }

  async function scheduleVisiblePageRendering() {
    const documentRecord = getActiveDocument()
    if (!documentRecord || !documentRecord.pdfBytes) return

    const visiblePageNumbers = getVisiblePages(documentRecord).map((page) => page.pageNumber)
    if (!visiblePageNumbers.length) return

    for (const pageNumber of visiblePageNumbers) {
      const renderKey = getPageRenderKey(documentRecord, pageNumber)
      if (appState.pageRenderImages[renderKey] || appState.pageRenderStatusByKey[renderKey] === "loading") continue

      appState.pageRenderStatusByKey[renderKey] = "loading"
      renderPreservingViewerScroll()

      try {
        const pageRender = await getPdfPageRenderData(documentRecord, pageNumber, 1.25)
        appState.pageRenderImages[renderKey] = pageRender.canvas.toDataURL("image/png")
        appState.pageRenderTextByKey[renderKey] = pageRender.textContent
        appState.pageRenderMetricsByKey[renderKey] = {
          width: pageRender.viewport.width,
          height: pageRender.viewport.height,
          viewport: pageRender.viewport
        }
        appState.pageRenderStatusByKey[renderKey] = "done"
      } catch (error) {
        appState.pageRenderStatusByKey[renderKey] = "error"
      }

      renderPreservingViewerScroll()
    }
  }

  function syncPageTextLayerScale(layer) {
    if (!layer) return
    const inner = layer.firstElementChild
    const pageWidth = Number(layer.getAttribute("data-page-width"))
    const pageHeight = Number(layer.getAttribute("data-page-height"))
    if (!inner || !pageWidth || !pageHeight) return

    const scale = layer.clientWidth ? layer.clientWidth / pageWidth : 1
    inner.style.width = `${pageWidth}px`
    inner.style.height = `${pageHeight}px`
    inner.style.transform = `scale(${scale})`
    layer.style.height = `${pageHeight * scale}px`
  }

  async function hydratePageTextLayer(layer) {
    if (!layer) return

    const renderKey = layer.getAttribute("data-page-text-layer-key")
    const textContent = appState.pageRenderTextByKey[renderKey]
    const renderMetrics = appState.pageRenderMetricsByKey[renderKey]
    if (!renderKey || !textContent || !renderMetrics?.viewport) return

    if (!layer.firstElementChild) {
      const pdfjsLib = await loadPdfJsLibrary()
      if (typeof pdfjsLib.renderTextLayer !== "function") return

      const inner = document.createElement("div")
      inner.className = "page-text-layer-inner"
      layer.replaceChildren(inner)

      let renderTask
      try {
        renderTask = pdfjsLib.renderTextLayer({
          container: inner,
          textContentSource: textContent,
          viewport: renderMetrics.viewport,
          textDivs: []
        })
      } catch (error) {
        renderTask = pdfjsLib.renderTextLayer({
          container: inner,
          textContent,
          viewport: renderMetrics.viewport,
          textDivs: []
        })
      }

      if (renderTask?.promise) {
        await renderTask.promise
      } else if (typeof renderTask?.then === "function") {
        await renderTask
      }
    }

    syncPageTextLayerScale(layer)
  }

  function schedulePageTextLayerHydration() {
    requestAnimationFrame(() => {
      document.querySelectorAll(".page-text-layer").forEach((layer) => {
        hydratePageTextLayer(layer).catch(() => {})
      })
    })
  }

  function extractAmbiguityOptions(candidatePages) {
    const optionSet = new Set()

    candidatePages.forEach((page) => {
      const text = page.text || ""
      const modelMatches = text.match(/\b(?:[A-Z]{1,4}-?)?\d{2,}[A-Z0-9-]*\b/g) || []
      modelMatches.forEach((match) => {
        if (match.length >= 3 && !/^\d+$/.test(match)) optionSet.add(match)
      })

      ;[
        "high-back",
        "low-back",
        "mid-back",
        "lounge chair",
        "lounge seating",
        "settee",
        "ottoman",
        "armchair",
        "side chair"
      ].forEach((phrase) => {
        if (text.toLowerCase().includes(phrase)) {
          optionSet.add(phrase.replace(/\b\w/g, (letter) => letter.toUpperCase()))
        }
      })
    })

    return [...optionSet].slice(0, 6)
  }

  function handleSelectionChange() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      clearSelectionState()
      return
    }

    const selectedText = normalizeText(selection.toString())
    const anchorContainer = selection.anchorNode?.parentElement?.closest(".pdf-page, .help-spec-card, .website-summary-panel")
    const focusContainer = selection.focusNode?.parentElement?.closest(".pdf-page, .help-spec-card, .website-summary-panel")
    if (!selectedText || !anchorContainer || anchorContainer !== focusContainer) {
      clearSelectionState()
      return
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect()
    setSelectionTarget(selectedText, anchorContainer.classList.contains("pdf-page") ? "pdf" : "assistant", rect)
  }

  function setSelectionTarget(text, source, rect) {
    appState.selectionText = normalizeText(text)
    appState.selectionSource = source
    appState.selectionRect = rect
      ? {
          top: rect.top,
          left: rect.left,
          width: rect.width || 0,
          height: rect.height || 0
        }
      : null
    appState.pickerPosition = null
    appState.confirmPosition = null
    updateFloatingCopyButton()
  }

  async function copyActiveSelection() {
    const copiedText = normalizeText(appState.selectionText)
    if (!copiedText) return
    appState.copiedText = copiedText
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copiedText)
      }
    } catch (error) {
      // Keep the in-app copied value even if clipboard permissions fail.
    }
    clearSelectionState()
    showToast("Copied for paste")
    updateFloatingCopyButton()
    syncToastDom()
  }

  async function copyValueDirect(value) {
    const copiedText = normalizeText(value)
    if (!copiedText) return
    appState.copiedText = copiedText
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copiedText)
      }
    } catch (error) {
      // Keep the in-app copied value even if clipboard permissions fail.
    }
    clearSelectionState()
    showToast(`Copied ${copiedText}`)
    updateFloatingCopyButton()
    syncToastDom()
  }

  function getFloatingCopyButton() {
    if (floatingCopyButton?.isConnected) return floatingCopyButton

    floatingCopyButton = document.createElement("button")
    floatingCopyButton.type = "button"
    floatingCopyButton.className = "floating-copy-btn"
    floatingCopyButton.setAttribute("aria-label", "Copy selected text")
    floatingCopyButton.textContent = "Copy"
    floatingCopyButton.hidden = true
    floatingCopyButton.addEventListener("mousedown", (event) => {
      event.preventDefault()
    })
    floatingCopyButton.addEventListener("click", () => {
      copyActiveSelection().catch(() => {})
    })
    document.body.appendChild(floatingCopyButton)
    return floatingCopyButton
  }

  function updateFloatingCopyButton() {
    const button = getFloatingCopyButton()
    if (appState.plainPdfMode || !appState.selectionRect || !appState.selectionText) {
      button.hidden = true
      return
    }

    const top = Math.min(window.innerHeight - 56, Math.max(16, appState.selectionRect.top + appState.selectionRect.height + 12))
    const left = Math.min(window.innerWidth - 56, Math.max(28, appState.selectionRect.left + ((appState.selectionRect.width || 0) / 2)))
    button.style.top = `${top}px`
    button.style.left = `${left}px`
    button.hidden = false
  }

  function handleFieldPick(fieldKey) {
    const attribute = appState.spec.attributes.find((item) => item.key === fieldKey)
    const insertText = normalizeText(appState.selectionText)
    if (!attribute || !insertText) {
      clearSelectionState()
      render()
      return
    }

    if (attribute.value.trim()) {
      appState.pendingFieldKey = fieldKey
      appState.pendingInsertText = insertText
      appState.pickerPosition = null
      appState.confirmPosition = {
        top: Math.min(window.innerHeight - 240, (appState.selectionRect?.top || 120) + 36),
        left: Math.min(window.innerWidth - 360, (appState.selectionRect?.left || 32) + 12)
      }
      render()
      return
    }

    insertIntoField(fieldKey, insertText, "replace")
  }

  function resolveInsert(mode) {
    if (mode === "cancel") {
      clearSelectionState()
      render()
      return
    }

    insertIntoField(appState.pendingFieldKey, appState.pendingInsertText, mode)
  }

  function insertIntoField(fieldKey, insertText, mode) {
    const attribute = appState.spec.attributes.find((item) => item.key === fieldKey)
    if (!attribute) return

    attribute.value =
      mode === "append" && attribute.value.trim()
        ? `${attribute.value.trim()} ${insertText}`.trim()
        : insertText

    clearSelectionState()
    highlightField(fieldKey)
    showToast(`Added to ${attribute.label}`)
    render()

    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-field-input="${fieldKey}"]`)
      input?.focus()
      input?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  function highlightField(fieldKey) {
    appState.highlightedFieldKey = fieldKey
    window.clearTimeout(appState.highlightTimeoutId)
    appState.highlightTimeoutId = window.setTimeout(() => {
      appState.highlightedFieldKey = ""
      render()
    }, 700)
  }

  function showToast(message) {
    appState.toastMessage = message
    syncToastDom()
    window.clearTimeout(appState.toastTimeoutId)
    appState.toastTimeoutId = window.setTimeout(() => {
      appState.toastMessage = ""
      syncToastDom()
    }, 2200)
  }

  function downloadDocument(documentId) {
    const documentRecord = appState.documents.find((document) => document.id === documentId)
    if (!documentRecord || !documentRecord.pdfText) return

    const blob = new Blob([documentRecord.pdfText], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${documentRecord.id}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function buildAsciiPdf(pages) {
    return [
      "%PDF-1.4",
      ...pages.map((pageText, index) => {
        const pdfLines = pageText
          .split("\n")
          .map((line) => line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"))
        return `%%PAGE:${index + 1}
BT
${pdfLines.map((line) => `(${line}) Tj`).join("\n")}
ET`
      }),
      "%%EOF"
    ].join("\n")
  }

  function buildSampleDocuments() {
    return [
      {
        id: "simple-product-sheet",
        title: "Geiger Reframe One-Page Sheet",
        description: "A simple one-page sheet to validate direct entry with minimal navigation.",
        useCase: "One-page PDF",
        pageTitles: ["Reframe Product Sheet"],
        pdfText: buildAsciiPdf([
          [
            "GEIGER",
            "Reframe High-Back Lounge Chair",
            "Overall Width: 33 in",
            "Overall Depth: 31.5 in",
            "Overall Height: 42 in",
            "Finish Options: Walnut veneer, espresso oak",
            "Frame: Formed steel frame with upholstered shell",
            "Material: Hardwood shell, steel base, layered foam",
            "Notes: Companion ottoman available"
          ].join("\n")
        ])
      },
      {
        id: "reframe-catalog",
        title: "Geiger Lounge Collection Catalog",
        description: "A longer manufacturer-style catalog where the target product appears after introductory pages.",
        useCase: "Long PDF, target after page 1",
        pageTitles: [
          "Brand Introduction",
          "Collection Index",
          "Reframe High-Back Lounge Chair",
          "Reframe Finishes",
          "Warranty"
        ],
        pdfText: buildAsciiPdf([
          [
            "GEIGER",
            "Crafted lounge and workplace products.",
            "This catalog introduces seating, tables, and private office collections.",
            "Materials, finishes, and dimensions vary by family."
          ].join("\n"),
          [
            "GEIGER COLLECTION INDEX",
            "Crosshatch Lounge",
            "Filo Sofa",
            "Reframe Lounge Seating",
            "C-Side Tables",
            "Occasional Chairs"
          ].join("\n"),
          [
            "GEIGER",
            "Reframe High-Back Lounge Chair",
            "Reframe Lounge Seating family",
            "Overall Width: 33 in",
            "Overall Depth: 31.5 in",
            "Overall Height: 42 in",
            "Seat Height: 17 in",
            "Frame: Sculpted steel base with wood reveal detail",
            "Material: Molded foam, hardwood shell, steel frame"
          ].join("\n"),
          [
            "GEIGER",
            "Reframe Finish Options",
            "Wood finish options: White oak, walnut, ebonized ash",
            "Base finish options: Polished aluminum, blackened steel",
            "Upholstery: Fabric or leather by graded-in program"
          ].join("\n"),
          [
            "GEIGER",
            "Warranty and testing details",
            "BIFMA testing references",
            "Regional fabric approvals"
          ].join("\n")
        ])
      },
      {
        id: "naming-variant-catalog",
        title: "Geiger Seating Reference Book",
        description: "Tests fuzzy matching when the display name differs from the wording in the document.",
        useCase: "Display name differs",
        pageTitles: ["Front Matter", "Reframe High Back Chair", "Dimension Table", "Materials"],
        pdfText: buildAsciiPdf([
          [
            "GEIGER SEATING REFERENCE",
            "Overview of lounge and guest seating products."
          ].join("\n"),
          [
            "GEIGER",
            "Reframe High Back Chair",
            "Part of the Reframe Lounge Seating series.",
            "High-back silhouette with optional headrest wrap."
          ].join("\n"),
          [
            "GEIGER",
            "Reframe dimensional data",
            "Overall width 33 in",
            "Overall depth 31.5 in",
            "Overall height 42 in"
          ].join("\n"),
          [
            "GEIGER",
            "Material and finish reference",
            "Walnut veneer shell, blackened steel base, contract textile upholstery"
          ].join("\n")
        ])
      }
    ]
  }

  document.addEventListener("selectionchange", () => {
    const active = document.activeElement
    if (active && /INPUT|TEXTAREA/.test(active.tagName)) return
    window.clearTimeout(selectionChangeTimeoutId)
    selectionChangeTimeoutId = window.setTimeout(() => {
      handleSelectionChange()
    }, 120)
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearSelectionState()
      render()
    }
  })

  document.addEventListener("click", async (event) => {
    const refineOptionButton = event.target.closest("[data-refine-group][data-refine-option]")
    if (refineOptionButton) {
      const option = normalizeText(refineOptionButton.getAttribute("data-refine-option") || "")
      if (!option) return
      const selectedTerms = getSelectedNarrowingTerms()
      const optionLower = option.toLowerCase()
      appState.search.selectedTerms = selectedTerms.some((term) => term.toLowerCase() === optionLower)
        ? selectedTerms.filter((term) => term.toLowerCase() !== optionLower)
        : [...selectedTerms, option]
      render()
      return
    }

    const refineApplyButton = event.target.closest("[data-refine-apply]")
    if (refineApplyButton) {
      await applyRefinedQueryAndRerank()
      return
    }

    const refineRemoveButton = event.target.closest("[data-refine-remove]")
    if (refineRemoveButton) {
      const option = normalizeText(refineRemoveButton.getAttribute("data-refine-remove") || "")
      if (!option) return
      appState.search.selectedTerms = getSelectedNarrowingTerms()
        .filter((term) => term.toLowerCase() !== option.toLowerCase())
      render()
    }
  })

  window.addEventListener("resize", () => {
    renderPreservingViewerScroll()
    document.querySelectorAll(".page-text-layer").forEach((layer) => {
      syncPageTextLayerScale(layer)
    })
    updateFloatingCopyButton()
  })

  render()
  refreshServerVisionStatus().then(() => {
    render()
  })
  if (appState.liveCssEnabled) {
    ensureLiveCssPolling()
  }
  hydrateSavedDraftState()
})()
