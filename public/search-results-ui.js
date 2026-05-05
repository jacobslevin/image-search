export function shouldShowClearResultsButton({ landingOnlyMode = false, visibleResultCount = 0 } = {}) {
  return !landingOnlyMode && Number(visibleResultCount) > 0;
}
