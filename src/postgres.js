import { Pool } from "pg";

const DEFAULT_DATABASE = "pixelseek_dev";
let pool = null;

function toOptionalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getSslConfig() {
  const sslMode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
  // Production RDS can opt in with PGSSLMODE=require. Local Postgres remains non-SSL by default.
  return sslMode === "require" ? { rejectUnauthorized: false } : undefined;
}

export function getPostgresConfig() {
  return {
    host: String(process.env.PGHOST || "").trim() || undefined,
    port: toOptionalNumber(process.env.PGPORT),
    database: String(process.env.PGDATABASE || "").trim() || DEFAULT_DATABASE,
    user: String(process.env.PGUSER || "").trim() || undefined,
    password: String(process.env.PGPASSWORD || "").trim() || undefined,
    ssl: getSslConfig(),
    keepAlive: true,
    max: toOptionalNumber(process.env.PGPOOL_MAX) || 10,
    idleTimeoutMillis: toOptionalNumber(process.env.PGPOOL_IDLE_TIMEOUT_MS) || 30000,
    connectionTimeoutMillis: toOptionalNumber(process.env.PGPOOL_CONNECTION_TIMEOUT_MS) || 15000,
    statement_timeout: toOptionalNumber(process.env.PG_STATEMENT_TIMEOUT_MS) ?? 0,
    query_timeout: toOptionalNumber(process.env.PG_QUERY_TIMEOUT_MS) ?? 0,
    lock_timeout: toOptionalNumber(process.env.PG_LOCK_TIMEOUT_MS) ?? 0,
    idle_in_transaction_session_timeout: toOptionalNumber(process.env.PG_IDLE_IN_TXN_TIMEOUT_MS) ?? 0
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
