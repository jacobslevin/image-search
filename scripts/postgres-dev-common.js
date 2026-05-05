import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { getImageIndexPath, ROOT_DIR } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEV_DATABASE_NAME = "pixelseek_dev";
export const CATALOG_SOURCE_SYSTEM = "normalized_catalog";
export const IMAGE_INDEX_SOURCE_SYSTEM = "image_index";
export const SCHEMA_SQL_PATH = path.join(__dirname, "..", "db", "pixelseek-dev-schema.sql");
export const NORMALIZED_CATALOG_PATH = path.join(ROOT_DIR, "data", "normalized-catalog.json");
export const LIVE_IMAGE_INDEX_PATH = getImageIndexPath();

function baseConnectionConfig(database = process.env.PGDATABASE || "postgres") {
  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database
  };
}

export async function createClient(database) {
  const client = new Client(baseConnectionConfig(database));
  await client.connect();
  return client;
}

export async function ensureDevDatabase() {
  const adminClient = await createClient("postgres");
  try {
    const result = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [DEV_DATABASE_NAME]);
    if (result.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${DEV_DATABASE_NAME}"`);
    }
  } finally {
    await adminClient.end();
  }
}

export async function initializeSchema() {
  const schemaSql = await fs.readFile(SCHEMA_SQL_PATH, "utf8");
  const client = await createClient(DEV_DATABASE_NAME);
  try {
    await client.query(schemaSql);
  } finally {
    await client.end();
  }
}

export async function createDevClient() {
  return createClient(DEV_DATABASE_NAME);
}

export async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export function normalizeArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "")).filter(Boolean) : [];
}

export function normalizeJson(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

export function normalizeText(value) {
  return value == null ? "" : String(value);
}

export function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeTimestamp(value) {
  const text = normalizeText(value).trim();
  return text || null;
}

export function vectorLiteral(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return `[${value.map((entry) => Number(entry)).join(",")}]`;
}

export async function recordIngestionRun(client, { sourceSystem, recordType, sourcePath, recordCount, notes }) {
  await client.query(
    `INSERT INTO ingestion_runs
      (source_system, record_type, source_path, record_count, notes, completed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [sourceSystem, recordType, sourcePath, recordCount, JSON.stringify(notes || {})]
  );
}
