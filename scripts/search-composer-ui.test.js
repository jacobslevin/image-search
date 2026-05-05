import test from "node:test";
import assert from "node:assert/strict";

import { hasSearchComposerClearableContent } from "../public/search-composer-ui.js";

test("search composer clear button stays hidden for blank content", () => {
  assert.equal(hasSearchComposerClearableContent({ plain: "" }), false);
  assert.equal(hasSearchComposerClearableContent({ plain: "   " }), false);
});

test("search composer clear button appears for typed query content", () => {
  assert.equal(hasSearchComposerClearableContent({ plain: "conference room" }), true);
});

test("search composer clear button stays hidden for chip-only composer state", () => {
  assert.equal(
    hasSearchComposerClearableContent({
      prefix: "",
      match: "",
      suffix: "",
      plain: ""
    }),
    false
  );
});
