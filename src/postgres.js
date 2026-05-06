import { Pool } from "pg";

const DEFAULT_DATABASE = "pixelseek_dev";
let pool = null;
let queryCounter = 0;

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

function summarizeSql(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function getPostgresPoolStats() {
  const activePool = getPostgresPool();
  return {
    totalCount: activePool.totalCount,
    idleCount: activePool.idleCount,
    waitingCount: activePool.waitingCount
  };
}

export function getPostgresPool() {
  if (!pool) {
    const config = getPostgresConfig();
    console.log("[postgres] creating pool", {
      host: config.host || "local-default",
      port: config.port || 5432,
      database: config.database,
      user: config.user || "(default)",
      ssl: Boolean(config.ssl),
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis
    });
    pool = new Pool(getPostgresConfig());
    pool.on("connect", () => {
      console.log("[postgres] pool client connected", getPostgresPoolStats());
    });
    pool.on("acquire", () => {
      console.log("[postgres] pool client acquired", getPostgresPoolStats());
    });
    pool.on("release", () => {
      console.log("[postgres] pool client released", getPostgresPoolStats());
    });
    pool.on("error", (error) => {
      console.error("[postgres] pool error", error);
    });
  }
  return pool;
}

export async function queryPostgres(text, params = []) {
  const queryId = ++queryCounter;
  const sql = summarizeSql(text);
  console.log(`[postgres] query ${queryId} requested`, {
    sql,
    params: params.length,
    pool: getPostgresPoolStats()
  });
  const startedAt = Date.now();
  try {
    const result = await getPostgresPool().query(text, params);
    console.log(`[postgres] query ${queryId} returned`, {
      rowCount: result.rowCount,
      durationMs: Date.now() - startedAt,
      pool: getPostgresPoolStats()
    });
    return result;
  } catch (error) {
    console.error(`[postgres] query ${queryId} failed`, {
      durationMs: Date.now() - startedAt,
      message: error?.message || String(error),
      sql,
      pool: getPostgresPoolStats()
    });
    throw error;
  }
}

export async function runPostgresConnectionTest() {
  console.log("[postgres] PG connection test starting");
  try {
    const result = await queryPostgres("SELECT 1 AS ok");
    console.log("[postgres] PG connection test complete: success", {
      rows: result.rows
    });
    return result.rows?.[0] || { ok: 1 };
  } catch (error) {
    console.error("[postgres] PG connection test complete: failure", error);
    throw error;
  }
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
