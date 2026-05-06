import { Pool } from "pg";

const DEFAULT_DATABASE = "pixelseek_dev";
let pool = null;

function toOptionalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function getPostgresConfig() {
  return {
    host: String(process.env.PGHOST || "").trim() || undefined,
    port: toOptionalNumber(process.env.PGPORT),
    database: String(process.env.PGDATABASE || "").trim() || DEFAULT_DATABASE,
    user: String(process.env.PGUSER || "").trim() || undefined,
    password: String(process.env.PGPASSWORD || "").trim() || undefined,
    max: toOptionalNumber(process.env.PGPOOL_MAX) || 10,
    idleTimeoutMillis: toOptionalNumber(process.env.PGPOOL_IDLE_TIMEOUT_MS) || 30000,
    connectionTimeoutMillis: toOptionalNumber(process.env.PGPOOL_CONNECTION_TIMEOUT_MS) || 5000
  };
}

export function getPostgresPool() {
  if (!pool) {
    pool = new Pool(getPostgresConfig());
    pool.on("error", (error) => {
      console.error("[postgres] pool error", error);
    });
  }
  return pool;
}

export async function queryPostgres(text, params = []) {
  return getPostgresPool().query(text, params);
}

export function vectorToSqlLiteral(values = []) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  return `[${values.map((entry) => Number(entry)).join(",")}]`;
}

export function parseVectorLiteral(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  const text = String(value || "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    return [];
  }
  const body = text.slice(1, -1).trim();
  if (!body) {
    return [];
  }
  return body
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}
