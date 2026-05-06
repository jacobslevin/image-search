import {
  CATALOG_SOURCE_SYSTEM,
  APP_DATABASE_NAME,
  NORMALIZED_CATALOG_PATH,
  createDevClient,
  normalizeArray,
  normalizeBoolean,
  normalizeJson,
  normalizeText,
  readJsonFile,
  recordIngestionRun
} from "./postgres-dev-common.js";

async function upsertProduct(client, product) {
  const result = await client.query(
    `INSERT INTO products (
      source_system,
      source_product_id,
      product_name,
      brand,
      description,
      raw_category,
      a_level,
      b_level,
      c_level,
      product_image_url,
      website,
      source_file,
      image_urls,
      product_metadata,
      raw_payload,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10, $11, $12, $13::text[], $14::jsonb, $15::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_product_id) DO UPDATE SET
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      description = EXCLUDED.description,
      raw_category = EXCLUDED.raw_category,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      product_image_url = EXCLUDED.product_image_url,
      website = EXCLUDED.website,
      source_file = EXCLUDED.source_file,
      image_urls = EXCLUDED.image_urls,
      product_metadata = EXCLUDED.product_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      CATALOG_SOURCE_SYSTEM,
      normalizeText(product.product_id),
      normalizeText(product.name),
      normalizeText(product.brand),
      normalizeText(product.description),
      normalizeText(product.raw_category),
      normalizeArray(product.a_level),
      normalizeArray(product.b_level),
      normalizeArray(product.c_level),
      normalizeText(product.product_image),
      normalizeText(product.website),
      normalizeText(product.source_file),
      normalizeArray(product.image_urls),
      JSON.stringify({
        generated_from: "normalized-catalog.json"
      }),
      JSON.stringify(product)
    ]
  );
  return result.rows[0].id;
}

async function upsertImage(client, image, productDbId, primaryImageUrl) {
  await client.query(
    `INSERT INTO images (
      source_system,
      source_image_id,
      product_db_id,
      source_product_id,
      image_url,
      product_name,
      brand,
      a_level,
      b_level,
      c_level,
      category,
      is_catalog_primary_image,
      image_metadata,
      raw_payload,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], $11, $12, $13::jsonb, $14::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_image_id) DO UPDATE SET
      product_db_id = EXCLUDED.product_db_id,
      source_product_id = EXCLUDED.source_product_id,
      image_url = EXCLUDED.image_url,
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      category = EXCLUDED.category,
      is_catalog_primary_image = EXCLUDED.is_catalog_primary_image,
      image_metadata = EXCLUDED.image_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()`,
    [
      CATALOG_SOURCE_SYSTEM,
      normalizeText(image.image_id),
      productDbId,
      normalizeText(image.product_id),
      normalizeText(image.image_url),
      normalizeText(image.name),
      normalizeText(image.brand),
      normalizeArray(image.a_level),
      normalizeArray(image.b_level),
      normalizeArray(image.c_level),
      normalizeText(image.category),
      normalizeText(image.image_url) === normalizeText(primaryImageUrl),
      JSON.stringify({
        source_file: normalizeText(image.source_file)
      }),
      JSON.stringify(image)
    ]
  );
}

async function main() {
  const catalog = await readJsonFile(NORMALIZED_CATALOG_PATH);
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const images = Array.isArray(catalog.images) ? catalog.images : [];
  const productById = new Map(products.map((product) => [normalizeText(product.product_id), product]));
  const imagesByProductId = new Map();

  for (const image of images) {
    const productId = normalizeText(image.product_id);
    if (!imagesByProductId.has(productId)) {
      imagesByProductId.set(productId, []);
    }
    imagesByProductId.get(productId).push(image);
  }

  const client = await createDevClient();
  try {
    await client.query("BEGIN");
    for (const product of products) {
      const productId = normalizeText(product.product_id);
      const productDbId = await upsertProduct(client, product);
      const productImages = imagesByProductId.get(productId) || [];
      for (const image of productImages) {
        await upsertImage(client, image, productDbId, product.product_image);
      }
    }
    await recordIngestionRun(client, {
      sourceSystem: CATALOG_SOURCE_SYSTEM,
      recordType: "catalog_snapshot",
      sourcePath: NORMALIZED_CATALOG_PATH,
      recordCount: products.length,
      notes: {
        database: APP_DATABASE_NAME,
        image_count: images.length,
        source_catalog: normalizeJson(catalog.source_catalog),
        source_selection: normalizeJson(catalog.source_selection)
      }
    });
    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          database: APP_DATABASE_NAME,
          source: NORMALIZED_CATALOG_PATH,
          products: products.length,
          images: images.length
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
