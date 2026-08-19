# magento-mcp

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

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `MAGENTO_BASE_URL` plus OAuth 1.0a credentials from a Magento **Integration** (System → Extensions → Integrations → Add New Integration): `MAGENTO_CONSUMER_KEY`, `MAGENTO_CONSUMER_SECRET`, `MAGENTO_ACCESS_TOKEN`, `MAGENTO_ACCESS_TOKEN_SECRET`. Grant the Integration only the API resources this server actually needs — Magento shows you these four values once, when you Activate it. This avoids the 2FA restriction that blocks admin-user password auth, and is the least-privilege approach besides.
   - `MAGENTO_DB_*` — **must** point at a MySQL user with `SELECT`-only grants:
     ```sql
     CREATE USER 'mcp_readonly'@'%' IDENTIFIED BY 'change_me';
     GRANT SELECT ON magento_db.* TO 'mcp_readonly'@'%';
     FLUSH PRIVILEGES;
     ```
     Do not grant this user INSERT/UPDATE/DELETE/DDL under any circumstance — the application-level query guard (`src/db/guard.ts`) is defense in depth, not the safety boundary.
3. `npm run build`
4. `npm run test:connections` — sanity-checks REST auth, GraphQL, and the DB connection against the values in `.env` before wiring the server into an assistant. See **Local dev with self-signed certs** below if this fails on TLS.
5. Register with Claude Desktop/Code, e.g. in `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "magento": {
         "command": "node",
         "args": ["/var/www/html/magentoMCP/dist/index.js"],
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
   The `MAGENTO_DB_SSH_*` fields are only needed when tunneling the DB connection over SSH — omit them entirely (not just leave blank) to connect directly, as before. See "Reaching a remote/firewalled DB" below.

## Development

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

## Reaching a remote/firewalled DB (SSH tunnel)

`MAGENTO_DB_HOST`/`PORT` don't need to be on the same machine as this server — `mysql2` just connects over TCP. But never expose MySQL's port to the open internet to make that work. If the DB isn't already reachable over a private network/VPN, set `MAGENTO_DB_SSH_*` in `.env` (see `.env.example` for the full field list) to tunnel the DB connection through SSH instead — this server opens the SSH connection itself (via the `ssh2` package, not a shelled-out `ssh` process) and forwards a local port to `MAGENTO_DB_HOST`/`PORT` as resolved from the SSH host's side. A private key (`MAGENTO_DB_SSH_PRIVATE_KEY_PATH`) is preferred over a password. Leave `MAGENTO_DB_SSH_HOST` unset to connect directly, as before — the tunnel is opt-in and only engages when that variable is present.

## Safety notes

- Every destructive REST tool (`update_product`, `delete_product`, `cancel_order`, `refund_order`, `update_customer`, `delete_customer`, `update_stock_item`, `set_config_value`) previews the action and no-ops unless called with `confirm: true`.
- `run_readonly_sql` only accepts a single `SELECT` statement, rejects DML/DDL keywords and sensitive tables (`admin_user`, etc.), and injects/caps a `LIMIT` — see `src/db/guard.ts`. This is on top of, not instead of, the DB user's SELECT-only grants.
- Query timeout and row cap are configurable via `MAGENTO_DB_QUERY_TIMEOUT_MS` / `MAGENTO_DB_MAX_ROWS` in `.env`.
