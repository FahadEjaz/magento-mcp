import { config } from "../config.js";

const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "create",
  "grant",
  "revoke",
  "replace",
  "into outfile",
  "into dumpfile",
  "load_file",
  "load data",
  "call ",
  "exec ",
  "execute ",
];

const SENSITIVE_TABLES = ["admin_user", "admin_passwords", "oauth_token"];

export class QueryRejectedError extends Error {
  constructor(reason: string) {
    super(`Query rejected: ${reason}`);
    this.name = "QueryRejectedError";
  }
}

/**
 * Blanks out the contents of quoted string literals (keeping the quotes and
 * overall string length so indices still line up with the original SQL).
 * Used so keyword/sensitive-table/semicolon scanning isn't fooled by SQL
 * syntax appearing inside a literal value, e.g. a WHERE clause matching the
 * word "update" inside a customer note.
 */
function maskStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, (m) =>
    m[0] + " ".repeat(Math.max(0, m.length - 2)) + m[m.length - 1]
  );
}

/**
 * Application-level defense in depth on top of the DB user's SELECT-only grants.
 * Never treat this as the sole safety boundary — the DB user's grants are.
 */
export function assertSafeSelect(rawSql: string): string {
  const trimmed = rawSql.trim();

  if (!trimmed) {
    throw new QueryRejectedError("empty query");
  }

  const masked = maskStringLiterals(trimmed);

  // Strip a single trailing semicolon and an optional trailing SQL comment
  // after it (e.g. "SELECT 1; -- note"), using the masked string so a ';' or
  // '--' inside a quoted literal can't affect where we cut.
  const trailingSemicolon = masked.match(/;\s*(--[^\n]*|\/\*[\s\S]*?\*\/)?\s*$/);
  const core = trailingSemicolon ? trimmed.slice(0, trailingSemicolon.index) : trimmed;
  const coreMasked = trailingSemicolon ? masked.slice(0, trailingSemicolon.index) : masked;

  // Any semicolon still remaining marks a second, stacked statement.
  if (coreMasked.includes(";")) {
    throw new QueryRejectedError("multiple statements are not allowed");
  }

  if (!/^select\b/i.test(core)) {
    throw new QueryRejectedError("only single SELECT statements are allowed");
  }

  const lowerMasked = coreMasked.toLowerCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // \b word-boundary matching avoids false positives on substrings that are
    // legitimate Magento column names, e.g. "update" must not match "updated_at".
    const pattern = new RegExp(`\\b${keyword.trim().replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(lowerMasked)) {
      throw new QueryRejectedError(`forbidden keyword: "${keyword.trim()}"`);
    }
  }

  for (const table of SENSITIVE_TABLES) {
    const pattern = new RegExp(`\\b${table}\\b`, "i");
    if (pattern.test(lowerMasked)) {
      throw new QueryRejectedError(`access to table "${table}" is not allowed`);
    }
  }

  return enforceLimit(core.trim());
}

// Matches either "LIMIT row_count", "LIMIT row_count OFFSET offset", or the
// MySQL-specific "LIMIT offset, row_count" form.
const LIMIT_PATTERN = /\blimit\s+(\d+)\s*(?:(,)\s*(\d+)|(offset)\s+(\d+))?\s*$/i;

function enforceLimit(sql: string): string {
  const maxRows = config.db.maxRows;
  const match = sql.match(LIMIT_PATTERN);

  if (!match) {
    return `${sql} LIMIT ${maxRows}`;
  }

  const [, first, comma, commaRowCount, offsetKeyword, offsetValue] = match;
  const isCommaForm = Boolean(comma);
  const rowCount = Number(isCommaForm ? commaRowCount : first);
  const offset = isCommaForm ? Number(first) : offsetKeyword ? Number(offsetValue) : 0;

  if (rowCount <= maxRows) {
    return sql;
  }

  const prefix = sql.slice(0, match.index).trimEnd();
  const cappedClause = offset > 0 ? `LIMIT ${maxRows} OFFSET ${offset}` : `LIMIT ${maxRows}`;
  return `${prefix} ${cappedClause}`;
}
