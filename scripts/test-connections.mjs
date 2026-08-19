import "dotenv/config";
import crypto from "node:crypto";
import OAuth from "oauth-1.0a";

const SIGNATURE_METHOD = process.env.MAGENTO_OAUTH_SIGNATURE_METHOD ?? "HMAC-SHA1";
const NODE_HASH_ALGORITHM = { "HMAC-SHA1": "sha1", "HMAC-SHA256": "sha256" }[SIGNATURE_METHOD];
if (!NODE_HASH_ALGORITHM) {
  throw new Error(`Invalid MAGENTO_OAUTH_SIGNATURE_METHOD: "${SIGNATURE_METHOD}"`);
}

function oauthHeader(url, method) {
  const oauth = new OAuth({
    consumer: { key: process.env.MAGENTO_CONSUMER_KEY, secret: process.env.MAGENTO_CONSUMER_SECRET },
    signature_method: SIGNATURE_METHOD,
    hash_function: (baseString, key) => crypto.createHmac(NODE_HASH_ALGORITHM, key).update(baseString).digest("base64"),
  });
  const token = { key: process.env.MAGENTO_ACCESS_TOKEN, secret: process.env.MAGENTO_ACCESS_TOKEN_SECRET };
  return oauth.toHeader(oauth.authorize({ url, method }, token));
}

async function testRest() {
  const base = process.env.MAGENTO_BASE_URL;
  const url = `${base}/rest/V1/store/websites`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...oauthHeader(url, "GET") },
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true, detail: `OAuth1 request succeeded (${body.length} bytes)` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function testGraphql() {
  const base = process.env.MAGENTO_BASE_URL;
  try {
    const res = await fetch(`${base}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ storeConfig { store_code } }" }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.errors) {
      return { ok: false, detail: json ? JSON.stringify(json.errors ?? json) : `HTTP ${res.status}` };
    }
    return { ok: true, detail: `store_code=${json.data?.storeConfig?.store_code}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function testDb() {
  try {
    const mysql = (await import("mysql2/promise")).default;
    const conn = await mysql.createConnection({
      host: process.env.MAGENTO_DB_HOST,
      port: Number(process.env.MAGENTO_DB_PORT ?? 3306),
      database: process.env.MAGENTO_DB_NAME,
      user: process.env.MAGENTO_DB_READONLY_USER,
      password: process.env.MAGENTO_DB_READONLY_PASSWORD,
      connectTimeout: 8000,
    });
    const [rows] = await conn.query("SELECT 1 AS ok");
    await conn.end();
    return { ok: true, detail: `connected, SELECT 1 => ${JSON.stringify(rows)}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

const [rest, graphql, db] = await Promise.all([testRest(), testGraphql(), testDb()]);

for (const [name, result] of [["REST", rest], ["GraphQL", graphql], ["DB", db]]) {
  console.log(`${result.ok ? "OK  " : "FAIL"} ${name}: ${result.detail}`);
}

process.exit(rest.ok && graphql.ok && db.ok ? 0 : 1);
