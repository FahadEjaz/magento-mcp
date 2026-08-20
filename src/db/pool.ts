import mysql from "mysql2/promise";
import { config } from "../config.js";
import { openSshTunnel, type TunnelHandle } from "./ssh-tunnel.js";

export interface QueryResult {
  rows: unknown[];
  fields: string[];
}

let poolPromise: Promise<mysql.Pool> | null = null;
let tunnelHandle: TunnelHandle | null = null;

async function initPool(): Promise<mysql.Pool> {
  if (!config.db) {
    throw new Error(
      "DB access is not configured (MAGENTO_DB_HOST unset) — this server is running REST/GraphQL-only."
    );
  }
  const db = config.db;

  let host = db.host;
  let port = db.port;

  if (db.ssh) {
    // MAGENTO_DB_HOST/PORT are reached through the tunnel, as seen from the
    // SSH host — the pool itself connects to a local forwarded port instead.
    tunnelHandle = await openSshTunnel(db.ssh, db.host, db.port);
    host = "127.0.0.1";
    port = tunnelHandle.localPort;
  }

  return mysql.createPool({
    host,
    port,
    database: db.database,
    user: db.user,
    password: db.password,
    connectionLimit: db.poolSize,
    // These are analytical/read-only queries against a live Magento primary —
    // fail fast rather than let a slow query hold a connection indefinitely.
    connectTimeout: 10_000,
  });
}

async function getPool(): Promise<mysql.Pool> {
  if (!poolPromise) {
    poolPromise = initPool().catch((err) => {
      // Let the next call retry (e.g. a transient SSH failure) instead of
      // permanently caching a rejected pool.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// MySQL (5.7.8+) uses MAX_EXECUTION_TIME (milliseconds); MariaDB has no such
// variable and uses max_statement_time (seconds) instead. Neither is present
// on older MySQL. This timeout is a best-effort layer on top of the real
// safety boundary (SELECT-only DB grants + row cap) — never let failure to
// set it block the query.
type TimeoutStrategy = "mysql" | "mariadb" | "none";
let cachedTimeoutStrategy: TimeoutStrategy | null = null;

async function applyQueryTimeout(connection: mysql.PoolConnection): Promise<void> {
  const ms = config.db?.queryTimeoutMs ?? 5000;

  if (cachedTimeoutStrategy === "mysql" || cachedTimeoutStrategy === null) {
    try {
      await connection.query(`SET SESSION MAX_EXECUTION_TIME=${ms}`);
      cachedTimeoutStrategy = "mysql";
      return;
    } catch {
      // fall through to try MariaDB's variant
    }
  }

  if (cachedTimeoutStrategy === "mariadb" || cachedTimeoutStrategy === null) {
    try {
      await connection.query(`SET SESSION max_statement_time=${Math.ceil(ms / 1000)}`);
      cachedTimeoutStrategy = "mariadb";
      return;
    } catch {
      // fall through to no server-side timeout
    }
  }

  cachedTimeoutStrategy = "none";
}

export async function runReadOnlyQuery(sql: string): Promise<QueryResult> {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await applyQueryTimeout(connection);
    const [rows, fields] = await connection.query(sql);
    return {
      rows: rows as unknown[],
      fields: (fields ?? []).map((f) => f.name),
    };
  } finally {
    connection.release();
  }
}
