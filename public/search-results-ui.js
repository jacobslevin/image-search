export function shouldShowClearResultsButton({
  landingOnlyMode = false,
  isBrowseMode = false,
  visibleResultCount = 0
} = {}) {
  return !landingOnlyMode && !isBrowseMode && Number(visibleResultCount) > 0;
}
