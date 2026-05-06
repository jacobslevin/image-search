CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL,
  record_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  raw_category TEXT NOT NULL DEFAULT '',
  a_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  b_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  c_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_image_url TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_product_id)
);

CREATE TABLE IF NOT EXISTS images (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_image_id TEXT NOT NULL,
  product_db_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  source_product_id TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  a_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  b_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  c_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  category TEXT NOT NULL DEFAULT '',
  visual_type TEXT NOT NULL DEFAULT '',
  family TEXT NOT NULL DEFAULT '',
  seating_type TEXT NOT NULL DEFAULT '',
  pixelseek_type TEXT NOT NULL DEFAULT '',
  type_routing_source TEXT NOT NULL DEFAULT '',
  stage_0_result TEXT NOT NULL DEFAULT '',
  stage_1_override JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage_1_override_result TEXT NOT NULL DEFAULT '',
  stage_1_override_reason TEXT NOT NULL DEFAULT '',
  effective_classification TEXT NOT NULL DEFAULT '',
  enum_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  free_text JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning TEXT NOT NULL DEFAULT '',
  plan_shape_reasoning TEXT NOT NULL DEFAULT '',
  tiebreaker_triggered BOOLEAN,
  confidence_tier TEXT NOT NULL DEFAULT '',
  tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_timestamp TIMESTAMPTZ,
  excluded BOOLEAN NOT NULL DEFAULT FALSE,
  excluded_reason TEXT NOT NULL DEFAULT '',
  image_traits JSONB NOT NULL DEFAULT '{}'::jsonb,
  visual_summary TEXT NOT NULL DEFAULT '',
  structured_caption TEXT NOT NULL DEFAULT '',
  stage1 JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage2 JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage3 JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_text TEXT NOT NULL DEFAULT '',
  visual_summary_embedding VECTOR(1536),
  search_text_embedding VECTOR(1536),
  image_width INTEGER,
  image_height INTEGER,
  image_short_side INTEGER,
  ai_refreshed_at TIMESTAMPTZ,
  is_catalog_primary_image BOOLEAN NOT NULL DEFAULT FALSE,
  image_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_image_id)
);

CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (product_name);
CREATE INDEX IF NOT EXISTS idx_products_raw_category ON products (raw_category);
CREATE INDEX IF NOT EXISTS idx_products_source_file ON products (source_file);
CREATE INDEX IF NOT EXISTS idx_products_a_level ON products USING GIN (a_level);
CREATE INDEX IF NOT EXISTS idx_products_b_level ON products USING GIN (b_level);
CREATE INDEX IF NOT EXISTS idx_products_c_level ON products USING GIN (c_level);
CREATE INDEX IF NOT EXISTS idx_products_metadata ON products USING GIN (product_metadata);
CREATE INDEX IF NOT EXISTS idx_products_raw_payload ON products USING GIN (raw_payload);

CREATE INDEX IF NOT EXISTS idx_images_product_db_id ON images (product_db_id);
CREATE INDEX IF NOT EXISTS idx_images_source_product_id ON images (source_product_id);
CREATE INDEX IF NOT EXISTS idx_images_visual_type ON images (visual_type);
CREATE INDEX IF NOT EXISTS idx_images_family ON images (family);
CREATE INDEX IF NOT EXISTS idx_images_effective_classification ON images (effective_classification);
CREATE INDEX IF NOT EXISTS idx_images_excluded ON images (excluded);
CREATE INDEX IF NOT EXISTS idx_images_primary_image ON images (is_catalog_primary_image);
CREATE INDEX IF NOT EXISTS idx_images_a_level ON images USING GIN (a_level);
CREATE INDEX IF NOT EXISTS idx_images_b_level ON images USING GIN (b_level);
CREATE INDEX IF NOT EXISTS idx_images_c_level ON images USING GIN (c_level);
CREATE INDEX IF NOT EXISTS idx_images_enum_fields ON images USING GIN (enum_fields);
CREATE INDEX IF NOT EXISTS idx_images_image_traits ON images USING GIN (image_traits);
CREATE INDEX IF NOT EXISTS idx_images_stage1 ON images USING GIN (stage1);
CREATE INDEX IF NOT EXISTS idx_images_stage2 ON images USING GIN (stage2);
CREATE INDEX IF NOT EXISTS idx_images_stage3 ON images USING GIN (stage3);
CREATE INDEX IF NOT EXISTS idx_images_metadata ON images USING GIN (image_metadata);
CREATE INDEX IF NOT EXISTS idx_images_raw_payload ON images USING GIN (raw_payload);

CREATE TABLE IF NOT EXISTS canonical_products (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  dp_numeric_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  raw_category TEXT NOT NULL DEFAULT '',
  a_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  b_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  c_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_image_url TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  merge_strategy TEXT NOT NULL DEFAULT '',
  merge_confidence TEXT NOT NULL DEFAULT '',
  source_count INTEGER NOT NULL DEFAULT 0,
  catalog_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  image_index_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  preferred_name_source TEXT NOT NULL DEFAULT '',
  preferred_metadata_source TEXT NOT NULL DEFAULT '',
  merged_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canonical_product_sources (
  id BIGSERIAL PRIMARY KEY,
  canonical_product_id BIGINT NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  match_strategy TEXT NOT NULL DEFAULT '',
  match_confidence TEXT NOT NULL DEFAULT '',
  is_preferred_metadata_source BOOLEAN NOT NULL DEFAULT FALSE,
  is_preferred_name_source BOOLEAN NOT NULL DEFAULT FALSE,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_product_id, product_id),
  UNIQUE (source_system, source_product_id)
);

CREATE TABLE IF NOT EXISTS canonical_images (
  id BIGSERIAL PRIMARY KEY,
  canonical_product_id BIGINT NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  canonical_image_key TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  a_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  b_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  c_level TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  category TEXT NOT NULL DEFAULT '',
  visual_type TEXT NOT NULL DEFAULT '',
  family TEXT NOT NULL DEFAULT '',
  seating_type TEXT NOT NULL DEFAULT '',
  pixelseek_type TEXT NOT NULL DEFAULT '',
  type_routing_source TEXT NOT NULL DEFAULT '',
  stage_0_result TEXT NOT NULL DEFAULT '',
  stage_1_override JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage_1_override_result TEXT NOT NULL DEFAULT '',
  stage_1_override_reason TEXT NOT NULL DEFAULT '',
  effective_classification TEXT NOT NULL DEFAULT '',
  enum_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  free_text JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning TEXT NOT NULL DEFAULT '',
  plan_shape_reasoning TEXT NOT NULL DEFAULT '',
  tiebreaker_triggered BOOLEAN,
  confidence_tier TEXT NOT NULL DEFAULT '',
  tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_timestamp TIMESTAMPTZ,
  excluded BOOLEAN NOT NULL DEFAULT FALSE,
  excluded_reason TEXT NOT NULL DEFAULT '',
  image_traits JSONB NOT NULL DEFAULT '{}'::jsonb,
  visual_summary TEXT NOT NULL DEFAULT '',
  structured_caption TEXT NOT NULL DEFAULT '',
  stage1 JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage2 JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage3 JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_text TEXT NOT NULL DEFAULT '',
  visual_summary_embedding VECTOR(1536),
  search_text_embedding VECTOR(1536),
  image_width INTEGER,
  image_height INTEGER,
  image_short_side INTEGER,
  ai_refreshed_at TIMESTAMPTZ,
  merge_strategy TEXT NOT NULL DEFAULT '',
  merge_confidence TEXT NOT NULL DEFAULT '',
  source_count INTEGER NOT NULL DEFAULT 0,
  preferred_source_system TEXT NOT NULL DEFAULT '',
  catalog_image_id BIGINT REFERENCES images(id) ON DELETE SET NULL,
  image_index_image_id BIGINT REFERENCES images(id) ON DELETE SET NULL,
  is_catalog_primary_image BOOLEAN NOT NULL DEFAULT FALSE,
  image_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  merged_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canonical_image_sources (
  id BIGSERIAL PRIMARY KEY,
  canonical_image_id BIGINT NOT NULL REFERENCES canonical_images(id) ON DELETE CASCADE,
  image_id BIGINT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL,
  source_image_id TEXT NOT NULL,
  match_strategy TEXT NOT NULL DEFAULT '',
  match_confidence TEXT NOT NULL DEFAULT '',
  is_preferred_source BOOLEAN NOT NULL DEFAULT FALSE,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_image_id, image_id),
  UNIQUE (source_system, source_image_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_products_dp_numeric_id ON canonical_products (dp_numeric_id);
CREATE INDEX IF NOT EXISTS idx_canonical_products_brand ON canonical_products (brand);
CREATE INDEX IF NOT EXISTS idx_canonical_products_name ON canonical_products (product_name);
CREATE INDEX IF NOT EXISTS idx_canonical_products_a_level ON canonical_products USING GIN (a_level);
CREATE INDEX IF NOT EXISTS idx_canonical_products_b_level ON canonical_products USING GIN (b_level);
CREATE INDEX IF NOT EXISTS idx_canonical_products_c_level ON canonical_products USING GIN (c_level);
CREATE INDEX IF NOT EXISTS idx_canonical_products_payload ON canonical_products USING GIN (merged_payload);

CREATE INDEX IF NOT EXISTS idx_canonical_product_sources_product_id ON canonical_product_sources (product_id);
CREATE INDEX IF NOT EXISTS idx_canonical_product_sources_canonical_product_id ON canonical_product_sources (canonical_product_id);

CREATE INDEX IF NOT EXISTS idx_canonical_images_product_id ON canonical_images (canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_canonical_images_visual_type ON canonical_images (visual_type);
CREATE INDEX IF NOT EXISTS idx_canonical_images_family ON canonical_images (family);
CREATE INDEX IF NOT EXISTS idx_canonical_images_effective_classification ON canonical_images (effective_classification);
CREATE INDEX IF NOT EXISTS idx_canonical_images_browse_hero_lookup
  ON canonical_images (canonical_product_id, visual_type, effective_classification, is_catalog_primary_image, ai_refreshed_at DESC, id)
  WHERE excluded = false;
CREATE INDEX IF NOT EXISTS idx_canonical_images_search_text_prefilter
  ON canonical_images (effective_classification, excluded, visual_type)
  WHERE search_text_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_images_visual_summary_prefilter
  ON canonical_images (effective_classification, excluded, visual_type)
  WHERE visual_summary_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_images_enum_fields ON canonical_images USING GIN (enum_fields);
CREATE INDEX IF NOT EXISTS idx_canonical_images_image_traits ON canonical_images USING GIN (image_traits);
CREATE INDEX IF NOT EXISTS idx_canonical_images_payload ON canonical_images USING GIN (merged_payload);
CREATE INDEX IF NOT EXISTS idx_canonical_images_search_text_embedding_hnsw
  ON canonical_images
  USING hnsw (search_text_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE search_text_embedding IS NOT NULL
    AND effective_classification = 'product'
    AND excluded = FALSE;
CREATE INDEX IF NOT EXISTS idx_canonical_images_visual_summary_embedding_hnsw
  ON canonical_images
  USING hnsw (visual_summary_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE visual_summary_embedding IS NOT NULL
    AND effective_classification = 'product'
    AND excluded = FALSE;

CREATE INDEX IF NOT EXISTS idx_canonical_image_sources_image_id ON canonical_image_sources (image_id);
CREATE INDEX IF NOT EXISTS idx_canonical_image_sources_canonical_image_id ON canonical_image_sources (canonical_image_id);
