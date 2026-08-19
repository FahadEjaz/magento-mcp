# Development Progress

Tracks phased development of `magento-mcp`. Update this file as work lands — check off items, add dated notes, don't rewrite history.

Plan reference: `/home/fahad/.claude/plans/i-want-to-create-sorted-rain.md`

## Phase 1 — Scaffold + core tool surface — DONE (2026-08-19)

- [x] Project scaffold: `package.json`, `tsconfig.json`, `tsup.config.ts`, `.env.example`, `.gitignore`
- [x] Magento REST client (`src/magento/`): auth with 401 refresh, `searchCriteria` query builder, structured error mapping (auth mechanism later replaced — see Phase 3.5, OAuth 1.0a)
- [x] REST tools: catalog, orders, customers, CMS, inventory, promotions, store-config — destructive ones confirm-gated
- [x] GraphQL client + tools: `search_catalog`, `get_product_details`, `get_category_tree`
- [x] Direct read-only DB access: `mysql2` pool (`src/db/pool.ts`), safety guard (`src/db/guard.ts` — single-SELECT enforcement, forbidden-keyword/table checks, LIMIT injection/capping, query timeout), raw `run_readonly_sql` tool + 3 prebuilt insight queries
- [x] MCP resource: `magento://store/config`
- [x] Entrypoint wiring all tools/resources onto stdio transport (`src/index.ts`)
- [x] Verification: `tsc --noEmit` clean, `tsup` build succeeds, server boots on stdio with dummy env, vitest suite (9 tests) passes for `guard.ts` — including a caught false-positive bug (`update` substring matching `updated_at`, fixed with `\b` word-boundary regex)
- [x] `CLAUDE.md`, `PROGRESS.md`, `README.md` written
- [x] Plugins installed/enabled: `mcp-server-dev`, `typescript-lsp`, `security-guidance`, `context7`

**Not yet done from the original plan / known gaps:**
- No integration test against a real/staging Magento instance yet (unit tests only — DB pool, REST/GraphQL clients are untested against live endpoints)
- `mcp_readonly` MySQL user not yet created on any real DB — README documents the `GRANT` statement but it hasn't been run/verified anywhere
- No git repo initialized yet (working dir was not a git repo at project start)
- No HTTP/SSE transport — stdio only, per plan's v1 scope

## Phase 2 — Real-instance verification

Goal: prove the server actually works against a real Magento 2 store, not just that it typechecks.

**Connection test results (2026-08-19)**, via new `scripts/test-connections.mjs` (`npm run test:connections`):

- [x] DB: connects fine (`SELECT 1` round-trips). **But** `.env` had `MAGENTO_DB_READONLY_USER=root` — a full read-write account, directly violating the plan's read-only safety model. Fixed: created a real `mcp_readonly` MySQL user (`GRANT SELECT ON magento2.* TO 'mcp_readonly'@'%'`), verified it can `SELECT` and that a write attempt is rejected by MySQL itself (`ERROR 1044: Access denied`), and switched `.env` to use it.
- [x] `MAGENTO_BASE_URL` was wrong (`https://scripcopim.local`) — didn't match the actual TLS cert's hostname (`scriphessco-local.scripco.com`), causing `ERR_TLS_CERT_ALTNAME_INVALID`. Fixed in `.env`. Also hit `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — Node doesn't trust the local mkcert CA that `curl`/browsers trust via the system store; needs `NODE_EXTRA_CA_CERTS` pointed at `mkcert -CAROOT`/rootCA.pem. Documented in README ("Local dev with self-signed certs").
- [x] **REST 2FA blocker resolved by switching auth model**: rather than work around 2FA on the admin account, replaced admin-token auth with OAuth 1.0a Integration auth entirely (see Phase 3.5 below) — this was the right fix anyway (least-privilege, no password in `.env`). `MAGENTO_CONSUMER_KEY/SECRET`/`MAGENTO_ACCESS_TOKEN`/`MAGENTO_ACCESS_TOKEN_SECRET` in `.env` are still placeholders (`REPLACE_ME`) — user needs to create a Magento Integration and paste in the real values before REST calls will succeed.
- [ ] **GraphQL blocked**: even a bare `{ __typename }` query fails with `"Config element \"String\" is not declared in GraphQL schema"` — this is a broken/misconfigured GraphQL schema on the Magento instance itself (likely needs a cache flush / schema regen on that instance), not an issue in this server's GraphQL client or query construction.
- [ ] Run each REST tool once via MCP Inspector against real data (blocked until the 2FA/auth issue above is resolved)
- [ ] Run `run_readonly_sql` and the 3 prebuilt insight queries against the real schema — Magento table/column names in `db-query.ts` were written from memory of Magento's schema and need validation (e.g. confirm `sales_order_item.product_name`, `quote.items_count` exist as expected on the target Magento version)
- [ ] Exercise one confirm-gated destructive tool end-to-end on a disposable/test record (e.g. create + delete a throwaway product) to confirm the preview → confirm flow works — blocked on REST auth above

## Phase 3 — Hardening (IN PROGRESS, started 2026-08-19)

- [x] Broaden vitest coverage beyond `guard.ts`: `src/magento/client.test.ts` — `buildSearchCriteriaQuery` (filter groups, sort orders, pagination, defaults, empty input), REST client success/204/error-mapping/malformed-error-body, 401-invalidate-and-retry-once, no-infinite-loop-on-second-401, POST/PUT body serialization. Mocks `./auth.js` and stubs global `fetch`. 10 tests, all passing.
- [x] `src/db/pool.test.ts` — mocks `mysql2/promise`, verifies `MAX_EXECUTION_TIME` session var is set before every query, row/field mapping, empty-fields handling, and that the connection is always released (including when the query throws). 5 tests. Suite is now 24 tests total (`npm test`).
- [x] Pagination decision: keep current caps (REST tools `pageSize<=100`, DB tools `maxRows<=500`) for v1 — no streaming/cursor support added. Revisit only if Phase 2 real-instance testing shows this is too restrictive.
- [x] Multi-store decision: deferred, not needed for v1 (single `MAGENTO_BASE_URL`/single DB target). Revisit if a real use case needs it.
- [x] `code-review` skill run over `src/` (effort: high), 2026-08-19 — 6 findings, all fixed:
  - **`db/guard.ts` row-cap bypass (critical):** `enforceLimit`'s regex mis-parsed MySQL's `LIMIT offset, row_count` form, reading the offset as the row count — `LIMIT 0, 50000` sailed through uncapped since 0 ≤ 500. Also duplicated the `LIMIT` clause into invalid SQL for `LIMIT n OFFSET m` form. Rewrote `LIMIT_PATTERN`/`enforceLimit` to correctly distinguish both forms and cap the real row count while preserving a non-zero offset. Regression tests added (`guard.test.ts`).
  - **`db/guard.ts` string-literal false positives:** forbidden-keyword/sensitive-table scan ran over the raw lowercased SQL, so e.g. `WHERE note LIKE '%please update my address%'` was wrongly rejected. Added `maskStringLiterals` (blanks quoted content, preserves length/position) and scan the masked string instead. Also fixed the related bug where a valid single statement ending in a trailing comment after `;` (e.g. `SELECT 1; -- note`) was wrongly flagged as multi-statement.
  - **`tools/catalog.ts` / `tools/customers.ts` identifier-override bug:** `update_product`/`update_customer` spread the caller's `updates` object *after* the explicit `sku`/`id`, so a conflicting field in `updates` silently overrode which record the PUT body claimed to target. Fixed by spreading `updates` first, identifier last.
  - **`tools/inventory.ts`:** `list_source_items` hand-built its searchCriteria query string instead of reusing `buildSearchCriteriaQuery` like every other tool file — refactored to use the shared helper.
  - **`magento/auth.ts` race:** concurrent tool calls racing on an absent/expired token could each fire their own admin-token POST. Added in-flight-request de-duplication so concurrent callers share one fetch.
  - Also fixed while in this area (found via live testing against a real Magento instance, not the code-review pass): `db/pool.ts` assumed MySQL's `MAX_EXECUTION_TIME` session variable, which doesn't exist on MariaDB — broke `run_readonly_sql` outright on MariaDB-backed stores. Now tries MySQL's variant, falls back to MariaDB's `max_statement_time`, and proceeds without a server-side timeout (logged via cached strategy, not fatal) if neither is supported. Also wrapped raw `fetch` network failures (auth + REST client) in a clearer "could not reach Magento, check the site is up" error instead of a bare `TypeError: fetch failed`.
  - Suite is now 37 tests total (`npm test`), all passing; `tsc --noEmit` clean; `tsup` build succeeds.

### Phase 3.5 — Switched REST auth from admin-token to OAuth 1.0a (2026-08-19)

User-requested change: replace admin-user password auth with Integration OAuth 1.0a, ahead of the Phase 5 backlog item (this also happened to unblock the 2FA issue found in Phase 2, but that wasn't the primary motivation — least-privilege API access was).

- [x] Deleted `src/magento/auth.ts` (admin-token fetch/cache/invalidate); added `src/magento/oauth.ts` (`getOAuthHeader(url, method)` using the `oauth-1.0a` package, HMAC-SHA1). Signs method+URL+query string per request — OAuth1 does not sign the JSON body, matching Magento's own implementation.
- [x] `src/magento/client.ts` now calls `getOAuthHeader` per request instead of caching a Bearer token — no more 401-retry-and-invalidate flow (OAuth1 access tokens don't expire/rotate the way admin-user tokens do; a 401 now just means bad/revoked Integration credentials and is a plain error).
- [x] `src/config.ts`: `MAGENTO_ADMIN_USER`/`MAGENTO_ADMIN_PASSWORD` replaced with `MAGENTO_CONSUMER_KEY`, `MAGENTO_CONSUMER_SECRET`, `MAGENTO_ACCESS_TOKEN`, `MAGENTO_ACCESS_TOKEN_SECRET` (all required).
- [x] Tests: `src/magento/oauth.test.ts` (new — header shape, nonce/timestamp uniqueness per call, method/URL affects signature). `src/magento/client.test.ts` rewritten to mock `oauth.js` instead of `auth.js`; dropped the two 401-retry tests (no longer applicable), added a plain "401 throws, no retry" test.
- [x] `scripts/test-connections.mjs` REST check rewritten to sign a real request with `oauth-1.0a` instead of hitting the admin-token endpoint.
- [x] `.env.example`, `.env` (real file — placeholders only, real values still needed from user), `README.md`, `CLAUDE.md` updated. Old 2FA workaround section removed from README since it's now moot.
- [x] Suite is now 40 tests total, all passing; `tsc --noEmit` clean; `tsup` build succeeds.
- [ ] **Not yet verified against the real instance** — `.env`'s OAuth fields are still `REPLACE_ME`. Next step: user creates a Magento Integration, pastes in the 4 credentials, re-run `npm run test:connections`.

### Phase 3.6 — Optional SSH tunnel for the DB connection (2026-08-19)

User-requested: ability to reach the Magento DB when it isn't on the same host/network as this server, via SSH credentials rather than exposing MySQL's port directly.

- [x] `src/db/ssh-tunnel.ts` (new) — `openSshTunnel(sshConfig, destHost, destPort)` using the `ssh2` package: opens an SSH connection, then a local TCP listener that forwards each connection through it to `destHost:destPort` as seen from the SSH host (equivalent to `ssh -L`, done in-process rather than shelling out).
- [x] `src/config.ts`: new optional `config.db.ssh` (null unless `MAGENTO_DB_SSH_HOST` is set) — `MAGENTO_DB_SSH_HOST/PORT/USER/PASSWORD/PRIVATE_KEY_PATH/PASSPHRASE`. Validates that at least a password or a private key path is provided when the host is set.
- [x] `src/db/pool.ts` refactored from an eagerly-created module-level `dbPool` to a lazily-initialized `getPool()` (needed since opening the SSH tunnel is async) — when `config.db.ssh` is set, the pool connects to the tunnel's local forwarded port (`127.0.0.1:<ephemeral>`) instead of `MAGENTO_DB_HOST/PORT` directly. Tunnel is opt-in: unset `MAGENTO_DB_SSH_HOST` and behavior is identical to before (direct connection).
- [x] Tests: `src/db/ssh-tunnel.test.ts` (new — header/connect params, forwards to the configured destination, rejects on SSH connection error, mocks the `ssh2` package). `src/db/pool.test.ts` extended with two isolated-module-state tests: pool connects via the tunnel's local port when SSH is configured, and skips the tunnel entirely when it isn't.
- [x] `.env.example` and `.env` (commented-out placeholder block, not enabled — current DB is directly reachable) updated. `README.md` "Reaching a remote/firewalled DB (SSH tunnel)" section added. `CLAUDE.md` updated to flag the pool is no longer a synchronous singleton.
- [x] Suite is now 45 tests total, all passing; `tsc --noEmit` clean; `tsup` build succeeds; server still boots on stdio with dummy env (tunnel skipped since `MAGENTO_DB_SSH_HOST` unset).
- [ ] Not yet exercised against a real SSH bastion — only unit-tested with a mocked `ssh2` client. If/when a remote DB scenario actually comes up, verify end-to-end against a real SSH host before relying on it.

**Note (2026-08-19):** briefly switched `.env`'s `MAGENTO_DB_READONLY_USER` to `root` at the user's request, then reverted to `mcp_readonly` (SELECT-only) minutes later at the user's own follow-up request. Back to the safe default — no open risk here.

## Phase 4 — Packaging & distribution

- [ ] Decide distribution path: private/internal use only vs. `npx magento-mcp` npm publish vs. MCPB bundle
- [ ] If publishing: package metadata, LICENSE, README polish, version pinning strategy for `@modelcontextprotocol/sdk`
- [ ] `git init` + first commit (manual — see CLAUDE.md: never auto-commit)

## Phase 5 — Optional expansion (only if needed)

- [ ] HTTP/SSE transport for hosted/remote use (currently stdio-only, local-process model)
- [x] ~~OAuth 1.0a auth path~~ — done ahead of schedule, see Phase 3.5. It's now the only REST auth path (admin-token auth was removed, not kept as an alternative).
- [ ] Free-form GraphQL tool (currently only fixed GraphQL-backed tools, by design — revisit only if the fixed set proves too limiting)
