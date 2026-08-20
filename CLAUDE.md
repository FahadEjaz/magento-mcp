# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`magento-mcp` — an MCP server exposing a Magento 2 store to AI assistants via three surfaces:

1. **REST Admin API** (`src/magento/`, `src/tools/catalog.ts|orders.ts|customers.ts|cms.ts|inventory.ts|promotions.ts|store-config.ts`) — authenticated via OAuth 1.0a (`src/magento/oauth.ts`) against a Magento Integration, not admin-user password auth
2. **GraphQL** (`src/graphql/`, `src/tools/graphql-catalog.ts`) — storefront-shaped queries
3. **Direct read-only MySQL** (`src/db/`, `src/tools/db-query.ts`) — analytical insight not available via REST/GraphQL; the DB connection is optionally tunneled over SSH (`src/db/ssh-tunnel.ts`) when `MAGENTO_DB_SSH_HOST` is set

Entrypoint is `src/index.ts`: it constructs one `McpServer`, calls each domain's `registerXTools(server)`, registers the `magento://store/config` resource (`src/resources/store-info.ts`), then connects over stdio — no HTTP/SSE transport in this codebase.

Published on npm as [`@fahadhussain777/magento-mcp`](https://www.npmjs.com/package/@fahadhussain777/magento-mcp) — bump `version` in `package.json` before every `npm publish` (npm rejects re-publishing an existing version, and a leading-zero version like `0.1.02` gets silently semver-normalized rather than rejected, so double check `npm view @fahadhussain777/magento-mcp version` if a publish seems to have no effect). Never publish without running `npm test`/`npm run typecheck` first (`prepublishOnly` does this automatically, don't remove it).

Full design rationale lives in `/home/fahad/.claude/plans/i-want-to-create-sorted-rain.md` (the approved implementation plan). Development phases and status are tracked in `PROGRESS.md` — read it first to see what's done, what's next, and known environmental gotchas (e.g. stale Docker container IPs, mkcert CA regeneration) already diagnosed for this specific setup.

## Non-negotiable rules

- **Never commit.** Leave all changes uncommitted for manual review. Do not run `git add`/`git commit`/`git push` under any circumstance unless explicitly asked in that specific message.
- **Destructive REST tools must stay confirm-gated.** Any tool that mutates Magento state (`update_*`, `delete_*`, `cancel_*`, `refund_*`, `set_config_value`) must accept a `confirm` boolean (see `ConfirmField` in `src/tools/shared.ts`) and no-op with a preview (`confirmPreview`) when it's false. Don't remove this pattern when adding new write tools.
- **DB access is read-only, defense in depth.** `src/db/guard.ts` (`assertSafeSelect`) is a second layer on top of the DB user's `SELECT`-only MySQL grants — never treat the app-level guard as the sole safety boundary, and never wire up a DB credential with write grants. When touching `guard.ts`, watch for substring false-positives on legitimate Magento column names (e.g. `update` vs `updated_at` — must use `\b` word-boundary matching, not `.includes()`) and on string literals in the query itself (mask quoted content before scanning for forbidden keywords/tables). Also watch the `LIMIT` parser: MySQL's `LIMIT offset, row_count` form and `LIMIT row_count OFFSET offset` form must both be distinguished correctly, or the row cap silently reads the wrong number.
- **Keep the "full admin surface" pattern**: one `tools/*.ts` file per Magento domain, each exporting a `registerXTools(server)` function called from `src/index.ts`. Follow this when adding new domains rather than growing an existing file unboundedly.
- **OAuth1 signs method+URL only, not the JSON body.** `getOAuthHeader` in `src/magento/oauth.ts` must be called with the exact URL (including query string) and method used for the actual `fetch` call, per request — the signature is time/nonce-bound and can't be cached or reused across requests like the old admin-token was.
- **OAuth1 signature method is configurable, not hardcoded.** `MAGENTO_OAUTH_SIGNATURE_METHOD` (`HMAC-SHA1` default, or `HMAC-SHA256`) — Magento instances vary on which one they accept. In `src/magento/oauth.ts`, the `signature_method` config value and the actual `crypto.createHmac` algorithm are both derived from `config.magento.oauthSignatureMethod` via the same lookup table — never let these two drift independently, or Magento accepts the header shape but rejects the signature.
- **DB pool is lazily initialized, not a module-level singleton anymore.** `src/db/pool.ts`'s `getPool()` must be awaited before touching the pool (needed since establishing the optional SSH tunnel is async) — don't reintroduce an eagerly-created `mysql.createPool()` at module load time, it would race the tunnel setup.

## Commands

- `npm run dev` — run from TS source directly (`tsx`)
- `npm run build` — compile via `tsup` to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest (`src/db/guard.test.ts` covers SQL safety guardrails — extend this file when changing guard logic); run a single file with `npx vitest run src/db/guard.test.ts`
- `npm run test:connections` — live smoke test (`scripts/test-connections.mjs`) of REST/GraphQL/DB reachability against the real values in `.env`; not a substitute for `npm test`, and requires a real Magento instance + filled-in `.env`
- `npx @modelcontextprotocol/inspector node dist/index.js` — interactively list/invoke MCP tools against a running build

## Plugins enabled for this project

- `mcp-server-dev` — MCP server design/build guidance
- `typescript-lsp` — TS/JS language server for code intelligence
- `security-guidance` — pattern-based + LLM security review on edits, given the DB/admin-credential surface here
- `context7` — up-to-date library docs (MCP SDK, mysql2, graphql-request) instead of relying on training-data recall

## Environment

Requires a filled-in `.env` (see `.env.example`) — `src/config.ts` is the single source of truth for env vars and fails fast (`required()`) on anything missing. The Magento DB user referenced by `MAGENTO_DB_READONLY_*` must actually be `SELECT`-only at the MySQL grant level — see `README.md` for the exact `GRANT` statement. `MAGENTO_DB_SSH_*` and `MAGENTO_OAUTH_SIGNATURE_METHOD` are optional; leaving `MAGENTO_DB_SSH_HOST` unset skips the SSH tunnel entirely (direct DB connection).
