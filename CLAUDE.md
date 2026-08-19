# CLAUDE.md

Guidance for Claude Code (or any AI agent) working in this repo.

## What this is

`magento-mcp` — an MCP server exposing a Magento 2 store to AI assistants via three surfaces:

1. **REST Admin API** (`src/magento/`, `src/tools/catalog.ts|orders.ts|customers.ts|cms.ts|inventory.ts|promotions.ts|store-config.ts`) — authenticated via OAuth 1.0a (`src/magento/oauth.ts`) against a Magento Integration, not admin-user password auth
2. **GraphQL** (`src/graphql/`, `src/tools/graphql-catalog.ts`) — storefront-shaped queries
3. **Direct read-only MySQL** (`src/db/`, `src/tools/db-query.ts`) — analytical insight not available via REST/GraphQL; the DB connection is optionally tunneled over SSH (`src/db/ssh-tunnel.ts`) when `MAGENTO_DB_SSH_HOST` is set

Published on npm as [`@fahadhussain777/magento-mcp`](https://www.npmjs.com/package/@fahadhussain777/magento-mcp) — bump `version` in `package.json` before every `npm publish` (npm rejects re-publishing an existing version), and never publish without running `npm test`/`npm run typecheck` first (`prepublishOnly` does this automatically, don't remove it).

Full design rationale lives in `/home/fahad/.claude/plans/i-want-to-create-sorted-rain.md` (the approved implementation plan). Development phases and status are tracked in `PROGRESS.md` — read it first to see what's done and what's next.

## Non-negotiable rules

- **Never commit.** Leave all changes uncommitted for manual review. Do not run `git add`/`git commit`/`git push` under any circumstance unless explicitly asked in that specific message.
- **Destructive REST tools must stay confirm-gated.** Any tool that mutates Magento state (`update_*`, `delete_*`, `cancel_*`, `refund_*`, `set_config_value`) must accept a `confirm` boolean (see `ConfirmField` in `src/tools/shared.ts`) and no-op with a preview when it's false. Don't remove this pattern when adding new write tools.
- **DB access is read-only, defense in depth.** `src/db/guard.ts` (`assertSafeSelect`) is a second layer on top of the DB user's `SELECT`-only MySQL grants — never treat the app-level guard as the sole safety boundary, and never wire up a DB credential with write grants. When touching `guard.ts`, watch for substring false-positives on legitimate Magento column names (e.g. `update` vs `updated_at` — must use `\b` word-boundary matching, not `.includes()`).
- **Keep the "full admin surface" pattern**: one `tools/*.ts` file per Magento domain, each exporting a `registerXTools(server)` function called from `src/index.ts`. Follow this when adding new domains rather than growing an existing file unboundedly.
- **OAuth1 signs method+URL only, not the JSON body.** `getOAuthHeader` in `src/magento/oauth.ts` must be called with the exact URL (including query string) and method used for the actual `fetch` call, per request — the signature is time/nonce-bound and can't be cached or reused across requests like the old admin-token was.
- **DB pool is lazily initialized, not a module-level singleton anymore.** `src/db/pool.ts`'s `getPool()` must be awaited before touching the pool (needed since establishing the optional SSH tunnel is async) — don't reintroduce an eagerly-created `mysql.createPool()` at module load time, it would race the tunnel setup.

## Commands

- `npm run dev` — run from TS source directly (`tsx`)
- `npm run build` — compile via `tsup` to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest (`src/db/guard.test.ts` covers SQL safety guardrails — extend this file when changing guard logic)
- `npx @modelcontextprotocol/inspector node dist/index.js` — interactively list/invoke MCP tools against a running build

## Plugins enabled for this project

- `mcp-server-dev` — MCP server design/build guidance
- `typescript-lsp` — TS/JS language server for code intelligence
- `security-guidance` — pattern-based + LLM security review on edits, given the DB/admin-credential surface here
- `context7` — up-to-date library docs (MCP SDK, mysql2, graphql-request) instead of relying on training-data recall

## Environment

Requires a filled-in `.env` (see `.env.example`). The Magento DB user referenced by `MAGENTO_DB_READONLY_*` must actually be `SELECT`-only at the MySQL grant level — see `README.md` for the exact `GRANT` statement.
