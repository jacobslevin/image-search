import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExistingDesignerPagesProductKey,
  buildExistingDesignerPagesProductLookup,
  findExistingDesignerPagesProduct,
  resolveDesignerPagesSourceProductId
} from "../src/designerpages-intake.js";

test("resolveDesignerPagesSourceProductId prefers explicit source_product_id", () => {
  assert.equal(
    resolveDesignerPagesSourceProductId({
      source_product_id: "81234567",
      website: "https://designerpages.com/products/70000000/example",
      product_id: "product_dp_99999999"
    }),
    "81234567"
  );
});

test("resolveDesignerPagesSourceProductId falls back to website and product_id suffix", () => {
  assert.equal(
    resolveDesignerPagesSourceProductId({
      website: "https://designerpages.com/products/81234567/example-product"
    }),
    "81234567"
  );

  assert.equal(
    resolveDesignerPagesSourceProductId({
      product_id: "product_dp_84561234"
    }),
    "84561234"
  );
});

test("buildExistingDesignerPagesProductKey preserves non-Designer Pages products", () => {
  assert.equal(
    buildExistingDesignerPagesProductKey({
      source_product_id: "81234567",
      product_id: "product_dp_81234567"
    }),
    "designerpages:81234567"
  );

  assert.equal(
    buildExistingDesignerPagesProductKey({
      product_id: "product_manual_123"
    }),
    "product:product_manual_123"
  );
});

test("findExistingDesignerPagesProduct detects existing records across all supported key shapes", () => {
  const products = [
    {
      product_id: "product_dp_81111111",
      source_product_id: "81111111",
      name: "Explicit Source"
    },
    {
      product_id: "product_dp_82222222",
      website: "https://designerpages.com/products/82222222/website-match",
      name: "Website Source"
    },
    {
      product_id: "product_dp_83333333",
      name: "Suffix Match"
    }
  ];

  const lookup = buildExistingDesignerPagesProductLookup(products);

  assert.equal(findExistingDesignerPagesProduct(lookup, "81111111")?.name, "Explicit Source");
  assert.equal(findExistingDesignerPagesProduct(lookup, "82222222")?.name, "Website Source");
  assert.equal(findExistingDesignerPagesProduct(lookup, "83333333")?.name, "Suffix Match");
  assert.equal(findExistingDesignerPagesProduct(lookup, "84444444"), null);
});
