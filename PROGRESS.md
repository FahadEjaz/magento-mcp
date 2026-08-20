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

**Decided (2026-08-19):** publish as a scoped npm package, `npx`-installable — not private/internal-only, not an MCPB bundle (for now). `npm view magento-mcp` showed the unscoped name is already taken by an unrelated package, so went with `@fahadhussain777/magento-mcp` (always available under the user's own npm account, no collision risk).

- [x] `package.json`: renamed to `@fahadhussain777/magento-mcp`, added `license: MIT`, `author`, `keywords`, `publishConfig.access: "public"` (required for a scoped package to publish for free — otherwise npm defaults scoped packages to private/paid), `prepublishOnly` script (typecheck + test + build, runs automatically before `npm publish`). `bin` command name stays `magento-mcp` (independent of the scoped package name — that's normal and fine).
- [x] `LICENSE` (MIT) added.
- [x] Verified end-to-end, not just configured: `npm pack` → tarball contents inspected (LICENSE, README.md, dist/index.js + map, package.json — 5 files, 25.8kB packed) → installed the tarball into a scratch project with `npm install <tarball>` → confirmed all runtime deps resolve → ran the installed `node_modules/.bin/magento-mcp` bin directly and confirmed it boots ("magento-mcp server running on stdio") with dummy env, same as the in-repo dev flow.
- [x] `README.md`: added a **Publishing** section (login, prepublishOnly, `npm publish` with the scoped-public flow, version-bump reminder, local tarball-testing instructions) and a note in Setup step 5 that `npx -y @fahadhussain777/magento-mcp` becomes available as a config option once actually published.
- [x] **Published to the npm registry** (2026-08-19) — `@fahadhussain777/magento-mcp@0.1.0` is live: `npm view @fahadhussain777/magento-mcp` confirms it, and `npx -y @fahadhussain777/magento-mcp` was run against the real registry (not the local tarball) with dummy env and confirmed it boots ("magento-mcp server running on stdio").
  - Along the way, hit and diagnosed a false alarm: `npx -y @fahadhussain777/magento-mcp` failed once with `sh: 1: magento-mcp: not found` right after an `npm cache clean --force` — re-ran with verbose logging from a clean directory and it worked correctly (reached the app's own "Missing required env var" error, i.e. bin resolution was fine). Treated as a one-off cache-clean-timing fluke, not a real packaging bug — the tarball's `bin` entry, permissions, and `npm install <tarball>` path had already been verified working before publish.
  - `README.md` Setup section now leads with `npx` (published package) as the primary path, source-build (`npm install` + `npm run build` + local `node dist/index.js`) as the alternative for developing on this repo. Publishing section rewritten past-tense with the actual npm link. Added an npm version badge.
- [ ] Version pinning strategy for `@modelcontextprotocol/sdk`: left as `^1.12.0` (standard caret range) — no active reason found to pin tighter; revisit only if an SDK release breaks something.
- [x] `git init` + first commit — done by the user (repo now at `github.com/FahadEjaz/magento-mcp`, not something this session did per the never-auto-commit rule).
- [x] Package metadata polish (2026-08-19): added `repository`/`homepage`/`bugs` to `package.json` pointing at the GitHub repo (npm's package page now links back to it). README restructured into **Prerequisites** / **Quick Start** (npx, consumer-facing) / **Development** (repo-facing) instead of one mixed numbered list; added an **Issues & contributing** footer.
- **Note:** at some point outside this session's tracking, the user bumped `package.json` version to `"0.1.02"` and attempted to publish — invalid semver (leading zero), npm silently normalized it to `0.1.2`, which was already published (registry had `0.1.0`/`0.1.1`/`0.1.2` by then from the user's own publishes), so the publish had no effect. Diagnosed via `npm publish --dry-run` (showed the auto-correct warning) and fixed by bumping to a genuinely new version. Current published version at last check: `0.1.3`; `package.json` locally is at `0.1.4` (user-edited, not yet confirmed published — check `npm view @fahadhussain777/magento-mcp version` before assuming it matches).

### Phase 3.8 — guard.ts blocklist hardening (2026-08-20)

User-requested safety review turned up two gaps in `src/db/guard.ts`'s defense-in-depth blocklist (not the primary safety boundary, which remains the DB user's SELECT-only grants):

- [x] `FORBIDDEN_KEYWORDS` was missing timing/DoS primitives (`SLEEP`, `BENCHMARK`, `GET_LOCK`, `PROCEDURE ANALYSE`) — these passed through untouched and could tie up a pool connection beyond what the best-effort query timeout catches.
- [x] `SENSITIVE_TABLES` was missing `oauth_consumer` and `integration` — both store the same class of OAuth credential material this server itself uses to authenticate.
- [x] Tests added to `guard.test.ts` for both. Suite now 48 tests (was 47), all passing; `tsc --noEmit` clean.
- Noted but not actioned (blocklists are inherently incomplete): moving `run_readonly_sql` to a table allowlist, and audit logging for confirmed-destructive REST calls / raw SQL — flagged to the user, deferred pending a decision on scope.

### Phase 3.7 — Configurable OAuth1 signature method (2026-08-19)

User's real Magento instance rejected every REST request: `{"message":"Signature method %1 is not supported","parameters":["HMAC-SHA1"]}` — that instance requires HMAC-SHA256, not the HMAC-SHA1 hardcoded since Phase 3.5.

- [x] Added `MAGENTO_OAUTH_SIGNATURE_METHOD` env var (`HMAC-SHA1` default for backward compat, or `HMAC-SHA256`) — `src/config.ts` validates it's one of the two allowed values and throws a clear error otherwise. No such env var existed before this (checked before adding one, per the user's own instruction to verify).
- [x] `src/magento/oauth.ts`: both the `signature_method` passed to `oauth-1.0a` and the actual `crypto.createHmac` algorithm are now derived from the same `NODE_HASH_ALGORITHM` lookup table keyed by `config.magento.oauthSignatureMethod` — they can't drift independently (that mismatch is exactly the class of bug that would silently reintroduce this failure).
- [x] Tests: `oauth.test.ts` extended with an isolated-module-state test that sets `MAGENTO_OAUTH_SIGNATURE_METHOD=HMAC-SHA256` and spies on `crypto.createHmac` to confirm `"sha256"` (not `"sha1"`) is actually used — not just that the header claims SHA256. Plus a test confirming an invalid value throws at config-load time. Suite is now 47 tests, all passing.
- [x] `.env.example` documents the var with the exact error message to watch for. `.env` (real file) set to `HMAC-SHA256` per the user's stated instance requirement.
- [x] `scripts/test-connections.mjs` updated to use the configured signature method (was hardcoded HMAC-SHA1) and to hit `/rest/V1/store/websites` (the endpoint the user asked to verify against) instead of `/rest/V1/store/storeConfigs`.
- [x] **Verified against the real instance (2026-08-19)**: `GET /rest/V1/store/websites` with `HMAC-SHA256` returned `200` with real website data. The fix works.
  - Getting there required fixing two unrelated environmental drifts, both caused by the Docker stack having restarted since it was last tested: (1) `MAGENTO_DB_HOST` (`172.21.0.3`) was stale — container IPs on the Docker bridge network shifted on restart, DB moved to `.2`, `.3` became the nginx container. Fixed in `.env`. (2) The nginx container generates its own mkcert CA independently of the host's `mkcert -CAROOT`, and regenerates it on container recreation — the previously-working `NODE_EXTRA_CA_CERTS` path pointed at a now-wrong CA (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` even though the cert itself was otherwise fine). Fixed by extracting the container's current CA via `docker cp` and pointing `NODE_EXTRA_CA_CERTS` at that instead.
  - Both caveats documented in README's "Local dev with self-signed certs" section so this doesn't cost another debugging pass next restart.
  - GraphQL still broken with the same pre-existing server-side schema error (`"Config element \"ID\" is not declared in GraphQL schema"`, reproducible even on `{ __typename }`) — unrelated to OAuth, still needs attention on the Magento instance itself, not this codebase.

### Phase 3.9 — Optional DB mode & OAuth searchCriteria encoding fix (2026-08-20)

- [x] **Made DB optional when `MAGENTO_DB_HOST` is unset:** `src/config.ts` returns `config.db = null` when `MAGENTO_DB_HOST` is not set. `src/tools/db-query.ts` (`registerDbTools`) logs that DB tools are disabled and returns without registering them. `src/db/pool.ts` (`initPool`) throws a clear error if called when DB is not configured. Allows running the MCP server in REST/GraphQL-only mode without requiring MySQL connection environment variables.
- [x] **OAuth1 `searchCriteria` query key encoding fix:** `src/magento/client.ts` (`buildSearchCriteriaQuery`) refactored. `oauth-1.0a`'s `deParam()` function percent-decodes query string values but leaves keys intact (`searchCriteria[pageSize]`). Standard `URLSearchParams` percent-encodes brackets in keys (`searchCriteria%5BpageSize%5D`), which caused `oauth-1.0a` to produce a mismatched signature base string and Magento to reject requests. Fixed by manually percent-encoding query values while keeping key brackets literal.

## Phase 6 — Full-project review: findings + remediation plan (2026-08-20)

Two reviews landed on the same day, from opposite directions. Both are recorded here **before** any
fix work, so the plan below is the single source of truth for what's actually wrong right now.

1. **Code-level analysis** (this session, over all of `src/`) — found 5 real bugs, 3 security-depth
   gaps, and a set of robustness/coverage gaps.
2. **External posture review** (user-supplied, `~/Downloads/magento-mcp-security-review.txt`, from a
   ChatGPT session titled "Assess Package Security") — reviewed the **public GitHub repo + README +
   tool list only, not the source**. Rated the project "reasonably designed, but not something to
   give unrestricted production Magento access to yet." Found no backdoor/malware.

**How the two relate:** they barely overlap, which is the useful part. The external review is a
deployment-posture review and its findings are almost all ops/config/docs. It could not see any of
the code bugs below. Note one place it is actively wrong: it rates *"SQL injection protection:
Green — reasonable defense in depth"* and credits the guard with *"applies row limits"* — finding
6.1 below is a verified bypass of exactly that row limit. Do not treat its Greens as code-level
assurance; it never read `guard.ts`.

Baseline at time of review: 48 tests passing, `tsc --noEmit` clean.

### 6.1 — P0 bugs found by code review (all verified by execution, none fixed yet)

- [ ] **`db/guard.ts:100` — row cap silently bypassed by a trailing SQL comment.** `LIMIT_PATTERN`
      is anchored to `$`, so a query ending in a comment has no match, falls through to the append
      path at `guard.ts:107`, and the appended clause lands *inside the comment*. Verified:
      `SELECT 1 FROM quote LIMIT 10 -- note` → `SELECT 1 FROM quote LIMIT 10 -- note LIMIT 500`, and
      `SELECT * FROM sales_order -- x` returns the whole table uncapped. Fix: strip trailing
      `--`/`/* */` comments off the *masked* copy before `enforceLimit`, the same way `guard.ts:65`
      already handles a comment after a trailing semicolon. This is the third distinct bug in this
      one function (see Phase 3 code-review and Phase 3.8) — the fix should come with regression
      tests for comment + semicolon + both LIMIT forms together.
- [ ] **`config.ts:69-71` — a malformed numeric env var poisons the row cap.** `Number(...)` of a
      typo'd `MAGENTO_DB_MAX_ROWS` yields `NaN`; `rowCount <= NaN` is false, so `enforceLimit` emits
      a literal `LIMIT NaN` and *every* DB query fails. Same unchecked `Number()` on
      `MAGENTO_DB_PORT`, `_POOL_SIZE`, `_QUERY_TIMEOUT_MS`, `MAGENTO_DB_SSH_PORT`. Fix: numeric parse
      helpers with `Number.isFinite` + range validation, failing fast at config load like
      `required()` already does.
- [ ] **`db/pool.ts:11,27` + `index.ts` — SSH tunnel is never closed, process can't exit.**
      `tunnelHandle` is assigned and then never read. The tunnel's `net.createServer` listener keeps
      the event loop alive, and there is no `SIGINT`/`SIGTERM`/stdin-close handler and no
      `pool.end()`. Fix: export a `closeDb()` from `pool.ts` (close tunnel, end pool) and wire
      shutdown handlers in `index.ts`.
- [ ] **`tools/db-query.ts:8-35` — the 3 prebuilt queries bypass the row cap.** Their `LIMIT 20/100/100`
      is hardcoded and never passes through `enforceLimit`, so with `MAGENTO_DB_MAX_ROWS=50`,
      `low_stock_items` still returns 100 rows. Fix: route them through `assertSafeSelect` too —
      which doubles as a startup self-test that the guard accepts our own queries.
- [ ] **`index.ts:16` — version drift.** Hardcoded `0.1.0` in the `McpServer` constructor vs
      `0.1.6` in `package.json`, so clients report the wrong version. Fix: derive from
      `package.json`. (Also still open from Phase 4: confirm what's actually published with
      `npm view @fahadhussain777/magento-mcp version` — local is at `0.1.6`.)

### 6.2 — Runtime tool gating (raised by the external review; the highest-leverage item on either list)

The external review's central recommendation is to start read-only and "initially disable or tightly
restrict" the 9 destructive tools plus `run_readonly_sql`. **That is currently impossible without
editing source** — every tool registers unconditionally in `index.ts:19-28`, and `.env.example` has
no feature flags at all. This also subsumes the "table allowlist for `run_readonly_sql`" item
deferred at the end of Phase 3.8.

- [ ] Gate at **registration** time, not call time — an unregistered tool cannot be invoked and the
      model never sees it in the tool list, which is strictly stronger than refusing at call time.
- [ ] Proposed env surface: `MAGENTO_MCP_MODE=read-only|full` (read-only skips every confirm-gated
      tool), `MAGENTO_MCP_ENABLE_RAW_SQL=false` (keeps the 3 prebuilt insight queries),
      `MAGENTO_MCP_DISABLED_TOOLS=refund_order,set_config_value` (explicit per-tool opt-out).
- [ ] Additive only — the `confirm` gate stays exactly as-is on every write tool per CLAUDE.md's
      non-negotiable rule. Gating is a second, outer boundary, not a replacement.
- [ ] Decide default mode. Leaning `full` to avoid breaking existing installs at a patch version,
      with the README leading on `read-only`; revisit for a 0.2.0.

### 6.3 — Security depth (code review + external review agree on the direction)

- [ ] **`db/ssh-tunnel.ts:65-72` — SSH host key is not verified.** No `hostVerifier`/`hostHash` in
      `conn.connect()`, so ssh2 accepts *any* host key and the tunnel is MITM-able. Fix: optional
      `MAGENTO_DB_SSH_HOST_FINGERPRINT` and reject on mismatch; when unset, at minimum warn on
      stderr. (Not caught by either review — found reading the source.)
- [ ] **`db/guard.ts:27` — `mysql.*` / `performance_schema.*` / `sys.*` not in `SENSITIVE_TABLES`.**
      `SELECT user, authentication_string FROM mysql.user` passes the guard (verified). A correctly
      scoped SELECT-only user has no grant on `mysql`, so the real boundary holds — but blocklist
      depth is this file's entire purpose. Keep `information_schema` **allowed** (it is the only
      schema-discovery path we have — see 6.5) or put it behind its own flag.
- [ ] **Credential/PII column blocklist.** `SELECT email, password_hash FROM customer_entity` passes
      (verified). Add `password_hash`, `password`, `rp_token`, `api_key`, `token`, `secret` as a
      column-level blocklist alongside the table list. This is the concrete form of the external
      review's only Orange rating ("sensitive data exposure — possible through read access").
- [ ] **`confirm: true` is not an authorization boundary** (external review's point 1, and correct —
      the agent can set the flag itself). Keep `confirm`, then layer: MCP tool `annotations`
      (`readOnlyHint`/`destructiveHint`/`idempotentHint`) so clients can gate natively, and MCP
      **elicitation** (`elicitInput`) for genuine human-in-the-loop on `refund_order`, `delete_*`,
      `set_config_value`. That is the "human approval" step in the external review's proposed
      architecture, done in-protocol instead of by convention.
- [ ] Consider whether `abandoned_carts` handing customer emails to an LLM should itself be opt-in.

### 6.4 — Documentation / deployment posture (all from the external review; all verified real)

- [ ] **`README.md:47-48` uses `CREATE USER 'mcp_readonly'@'%'`** — any host can authenticate as that
      user. Change the documented example to `@'localhost'` (or a specific private IP), with a note
      on which host to use in the SSH-tunnel case. Worth noting the Phase 2 real-instance setup
      created the user as `'mcp_readonly'@'%'` too, following this same README — so the local
      instance should be tightened alongside the docs.
- [ ] **No Magento Integration ACL guidance** — README never says which API resources to grant, so
      users will tick "All" (which the external review rates Red). Add a table mapping tool groups
      to the minimum Magento resources they need.
- [ ] **`README.md:58` MCP config example is `"args": ["-y", "@fahadhussain777/magento-mcp"]`** —
      resolves to latest on every launch. Pin a version in the documented example and mention
      `npm ci` / `npm audit` for repo users. (`package-lock.json` *is* already committed — the
      external review's "keep package-lock.json" item is already satisfied; only the npx example
      and the audit habit are genuine gaps.)

### 6.5 — Robustness, coverage, tooling (code review only)

- [ ] **No request timeout anywhere** — `magento/client.ts:46` and `graphql/client.ts:4` both use bare
      `fetch`/`GraphQLClient` with no `AbortSignal.timeout()`, so a hung Magento leaves an MCP tool
      call pending forever. Add `MAGENTO_REQUEST_TIMEOUT_MS` (default ~30s) to both.
- [ ] **`MagentoApiError.status` is discarded at the tool layer** — errors throw past the handlers and
      the SDK stringifies them, losing status and `parameters`. "SKU not found" (404) vs "OAuth
      signature rejected" (401) is a large difference to the model. `errorResult` already exists
      (`tools/shared.ts:19`) and is only used by `db-query.ts`.
- [ ] **No 429/503 handling** — add one `Retry-After` backoff retry, **GET only** (POST/PUT/DELETE are
      not idempotent).
- [ ] **Zero tests for `src/tools/*`** — 10 tool files, 0 tests. Highest-value case: assert that
      `confirm:false` returns a preview and fires **no** HTTP call, for every gated tool. That is
      CLAUDE.md's non-negotiable rule and nothing currently enforces it.
- [ ] **`WITH`/CTE queries are rejected** (`guard.ts:74` requires `^select\b`) — analytical reporting
      is exactly where CTEs earn their keep. Allow a leading `WITH ... SELECT`, verifying no DML in
      the body.
- [ ] **`REPLACE()` false positive** (`guard.ts:11`) — `SELECT REPLACE(sku,'a','b')` is rejected
      (verified). Match `\breplace\s+into\b` / statement-leading `replace` instead of the bare word.
      Same false-positive class as the `update`/`updated_at` bug from Phase 1.
- [ ] **No response trimming** — `list_categories` (`catalog.ts:77`) returns the entire category tree
      and `get_product` every EAV attribute; both can exhaust the context window on a real store.
      Add an optional `fields` param mapping to Magento's REST `fields=` parameter.
- [ ] **No schema-discovery tool** — the model has to guess Magento table/column names when writing
      raw SQL (and Phase 2 already flagged that our own prebuilt queries were written from memory
      and are still unverified). A `describe_table`/`list_tables` tool over `information_schema`
      would fix both.
- [ ] **No lint/format/CI** — no eslint, no prettier, no `.github/workflows`. `prepublishOnly` is the
      only gate and it runs on the publisher's machine.
- [ ] **Domain gaps** — no invoices/shipments/credit-memos, no order comments, no product
      attributes/attribute sets. Per CLAUDE.md these go in new `tools/*.ts` files (e.g.
      `tools/sales-documents.ts`), not by growing existing ones.

### 6.6 — Execution order

Ordered by blast-radius reduction per unit of work. Each step ends green (`npm test` +
`tsc --noEmit`) before the next starts.

1. **6.2 tool gating** — biggest single risk reduction, and it unblocks the external review's whole
   "restricted initial tool set" recommendation. One new module (or a `features` block in
   `config.ts`) + `index.ts` wiring + tests asserting disabled tools are absent from the tool list.
2. **6.1 P0 bugs** — five small, independent, unit-testable fixes. No live Magento needed.
3. **6.3 security depth** — SSH host verification, `mysql.*` tables, credential-column blocklist.
   Annotations + elicitation can follow separately (they touch all 10 tool files).
4. **6.4 docs** — cheap, and the `@'%'` grant is a real live-instance exposure, not just a doc typo.
5. **6.5** — timeouts and error shaping first (they change behaviour), then tool tests, then
   lint/CI, then the guard ergonomics (CTE, `REPLACE()`), then response trimming, schema
   discovery, and new domains last.

Phase 2's real-instance verification items stay open and blocked independently of all of the above;
none of this work needs a live instance, which is why it can proceed now.

## Phase 5 — Optional expansion (only if needed)

- [ ] HTTP/SSE transport for hosted/remote use (currently stdio-only, local-process model)
- [x] ~~OAuth 1.0a auth path~~ — done ahead of schedule, see Phase 3.5. It's now the only REST auth path (admin-token auth was removed, not kept as an alternative).
- [ ] Free-form GraphQL tool (currently only fixed GraphQL-backed tools, by design — revisit only if the fixed set proves too limiting)
