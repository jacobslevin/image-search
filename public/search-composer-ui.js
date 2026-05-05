export function hasSearchComposerClearableContent(parts = {}) {
  return Boolean(String(parts?.plain || "").trim());
}
