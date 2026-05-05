export function shouldShowResetSearchButton({
  landingOnlyMode = false,
  isBrowseMode = false,
  visibleResultCount = 0
} = {}) {
  return !landingOnlyMode && !isBrowseMode && Number(visibleResultCount) > 0;
}
