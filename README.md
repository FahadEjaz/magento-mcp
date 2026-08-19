# magento-mcp

[![npm](https://img.shields.io/npm/v/@fahadhussain777/magento-mcp)](https://www.npmjs.com/package/@fahadhussain777/magento-mcp)

MCP server exposing a Magento 2 store to AI assistants via:

- **REST Admin API** — catalog, orders, customers, CMS, inventory, promotions, store config (write tools require `confirm: true`), authenticated via OAuth 1.0a against a Magento Integration
- **GraphQL** — storefront-shaped catalog search, product details, category tree
- **Direct read-only SQL** — a `run_readonly_sql` tool plus prebuilt insight queries against the live Magento database, optionally reached over an SSH tunnel

## Tools

| Tool | Domain | Notes |
|---|---|---|
| `search_products`, `get_product`, `list_categories` | Catalog | read-only |
| `update_product`, `delete_product` | Catalog | destructive, `confirm: true` required |
| `search_orders`, `get_order` | Orders | read-only |
| `cancel_order`, `refund_order` | Orders | destructive, `confirm: true` required |
| `search_customers`, `get_customer` | Customers | read-only |
| `update_customer`, `delete_customer` | Customers | destructive, `confirm: true` required |
| `list_cms_pages`, `get_cms_page`, `list_cms_blocks` | CMS | read-only |
| `get_stock_item`, `list_source_items` | Inventory | read-only |
| `update_stock_item` | Inventory | destructive, `confirm: true` required |
| `list_cart_price_rules`, `get_coupon_by_code` | Promotions | read-only |
| `get_store_config`, `list_store_views` | Store config | read-only |
| `set_config_value` | Store config | destructive, `confirm: true` required |
| `search_catalog`, `get_product_details`, `get_category_tree` | GraphQL catalog | read-only, storefront-shaped queries |
| `run_readonly_sql` | Database | single `SELECT` only — see **Safety notes** |
| `top_selling_products`, `low_stock_items`, `abandoned_carts` | Database | prebuilt read-only insight queries |

Also exposes one MCP resource: `magento://store/config` (store configuration — currencies, locales, store views, base URLs).

## Prerequisites

- Node.js >= 18
- A Magento 2 store (Open Source or Adobe Commerce) with REST/GraphQL enabled
- A Magento **Integration** for OAuth 1.0a credentials (see Quick Start below) — admin-user password auth is not supported
- MySQL/MariaDB network access to the Magento database, for the read-only SQL tools (optional — the REST/GraphQL tools work without it)

## Quick Start (using the published package)

No clone or build needed — this installs and runs on demand via `npx`.

1. In Magento Admin: System → Extensions → Integrations → Add New Integration. Grant it only the API resources this server actually needs, then Activate it to get four OAuth 1.0a values (shown once): consumer key/secret, access token/secret. This also sidesteps the 2FA restriction that blocks admin-user password auth.
2. If using the DB tools, create a `SELECT`-only MySQL user:
   ```sql
   CREATE USER 'mcp_readonly'@'%' IDENTIFIED BY 'change_me';
   GRANT SELECT ON magento_db.* TO 'mcp_readonly'@'%';
   FLUSH PRIVILEGES;
   ```
   Do not grant this user INSERT/UPDATE/DELETE/DDL under any circumstance — the application-level query guard (`src/db/guard.ts`) is defense in depth, not the safety boundary.
3. Register with Claude Desktop/Code, e.g. in `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "magento": {
         "command": "npx",
         "args": ["-y", "@fahadhussain777/magento-mcp"],
         "env": {
           "MAGENTO_BASE_URL": "...",
           "MAGENTO_CONSUMER_KEY": "...",
           "MAGENTO_CONSUMER_SECRET": "...",
           "MAGENTO_ACCESS_TOKEN": "...",
           "MAGENTO_ACCESS_TOKEN_SECRET": "...",
           "MAGENTO_DB_HOST": "...",
           "MAGENTO_DB_NAME": "...",
           "MAGENTO_DB_READONLY_USER": "...",
           "MAGENTO_DB_READONLY_PASSWORD": "...",
           "MAGENTO_DB_SSH_HOST": "...",
           "MAGENTO_DB_SSH_USER": "...",
           "MAGENTO_DB_SSH_PRIVATE_KEY_PATH": "..."
         }
       }
     }
   }
   ```
   The `MAGENTO_DB_SSH_*` fields are only needed when tunneling the DB connection over SSH — omit them entirely (not just leave blank) to connect directly. See "Reaching a remote/firewalled DB" below.

   If REST calls fail with `{"message":"Signature method %1 is not supported","parameters":["HMAC-SHA1"]}`, add `"MAGENTO_OAUTH_SIGNATURE_METHOD": "HMAC-SHA256"` to the `env` block — Magento instances vary on which OAuth1 signature method they accept (defaults to `HMAC-SHA1` if unset). Check Magento Admin under Stores → Configuration → Services → OAuth if unsure which one a given instance requires.

## Development (working on this repo)

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the same OAuth/DB values as Quick Start above.
3. `npm run build`
4. `npm run test:connections` — sanity-checks REST auth, GraphQL, and the DB connection against the values in `.env`. See **Local dev with self-signed certs** below if this fails on TLS.
5. In `claude_desktop_config.json`, use `"command": "node", "args": ["/path/to/magentoMCP/dist/index.js"]` instead of the `npx` form, so you're running your local changes instead of the published version.

## Publishing

Published at [npmjs.com/package/@fahadhussain777/magento-mcp](https://www.npmjs.com/package/@fahadhussain777/magento-mcp). To publish a new version:

1. Bump `version` in `package.json` (semver) — npm rejects re-publishing an existing version.
2. Make sure you're logged in as the intended npm account: `npm whoami` (or `npm login`).
3. `npm publish` — `prepublishOnly` (typecheck + test + build) runs automatically first and aborts the publish if any of them fail. The package is scoped with `publishConfig.access: "public"` already set, so this publishes publicly on the free tier without needing `--access public` on the command line.

To test a packed tarball locally without touching the registry: `npm pack`, then `npm install /path/to/the/tarball.tgz` in a scratch project.

## Development scripts

- `npm run dev` — run directly from TS source via `tsx`
- `npm run typecheck`
- `npm test` — unit tests (`src/db/guard.test.ts` covers the SQL safety guardrails)
- `npm run test:connections` — live smoke test of REST/GraphQL/DB reachability against `.env` (not a substitute for `npm test`)
- `npx @modelcontextprotocol/inspector node dist/index.js` — interactively list/invoke tools

## Local dev with self-signed certs (mkcert, Warden, etc.)

Node's `fetch` uses its own bundled CA list, separate from your system's trust store — so even if `curl` and your browser trust a locally-issued mkcert certificate, Node will reject it with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Point Node at the same root CA:

```
NODE_EXTRA_CA_CERTS=$(mkcert -CAROOT)/rootCA.pem npm run dev
```

or set `NODE_EXTRA_CA_CERTS` in the environment your MCP client launches the server with (e.g. the `env` block in `claude_desktop_config.json`). Also double-check `MAGENTO_BASE_URL` actually matches a hostname the certificate covers (`ERR_TLS_CERT_ALTNAME_INVALID` means it doesn't) — local Magento setups often have several `*.local`/`*.example.com` hostnames configured and only one has a matching cert.

**Docker-based setups (e.g. Warden, `markoshust/magento-docker`)**: the container itself may generate its own mkcert CA independently of your host's `mkcert -CAROOT` — if so, the CA cert lives inside the container, not on the host, and gets regenerated (new CA, still `UNABLE_TO_VERIFY_LEAF_SIGNATURE` even with a previously-working `NODE_EXTRA_CA_CERTS` path) whenever the container is recreated. Pull the current one out with:

```
docker exec <nginx-container> find / -iname '*mkcert*.crt' 2>/dev/null
docker cp <nginx-container>:<path-from-above> ./magento-dev-ca.pem
```

then point `NODE_EXTRA_CA_CERTS` at that file. Also worth checking after any container restart: `docker inspect <db-container> --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'` — container IPs on the Docker bridge network can change across restarts, so a previously-working `MAGENTO_DB_HOST` may go stale (`ECONNREFUSED`) even though nothing in `.env` looks wrong.

## Reaching a remote/firewalled DB (SSH tunnel)

`MAGENTO_DB_HOST`/`PORT` don't need to be on the same machine as this server — `mysql2` just connects over TCP. But never expose MySQL's port to the open internet to make that work. If the DB isn't already reachable over a private network/VPN, set `MAGENTO_DB_SSH_*` in `.env` (see `.env.example` for the full field list) to tunnel the DB connection through SSH instead — this server opens the SSH connection itself (via the `ssh2` package, not a shelled-out `ssh` process) and forwards a local port to `MAGENTO_DB_HOST`/`PORT` as resolved from the SSH host's side. A private key (`MAGENTO_DB_SSH_PRIVATE_KEY_PATH`) is preferred over a password. Leave `MAGENTO_DB_SSH_HOST` unset to connect directly, as before — the tunnel is opt-in and only engages when that variable is present.

## Safety notes

- Every destructive REST tool (`update_product`, `delete_product`, `cancel_order`, `refund_order`, `update_customer`, `delete_customer`, `update_stock_item`, `set_config_value`) previews the action and no-ops unless called with `confirm: true`.
- `run_readonly_sql` only accepts a single `SELECT` statement, rejects DML/DDL keywords and sensitive tables (`admin_user`, etc.), and injects/caps a `LIMIT` — see `src/db/guard.ts`. This is on top of, not instead of, the DB user's SELECT-only grants.
- Query timeout and row cap are configurable via `MAGENTO_DB_QUERY_TIMEOUT_MS` / `MAGENTO_DB_MAX_ROWS` in `.env`.

## Issues & contributing

Bugs and feature requests: [github.com/FahadEjaz/magento-mcp/issues](https://github.com/FahadEjaz/magento-mcp/issues). MIT licensed — see [LICENSE](LICENSE).
