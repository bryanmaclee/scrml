/**
 * Schema differ — computes migration SQL from desired vs actual database state.
 *
 * SPEC §38.6: reads desired state from < schema> AST, reads actual state from
 * SQLite PRAGMA table_info(), generates migration SQL.
 *
 * @module schema-differ
 */

import { quoteIdent } from "./codegen/sql-ident.ts";

/**
 * Parse a < schema> AST node into structured table declarations.
 *
 * BACKWARD-COMPAT (§14.8.11.2 P2): the return shape stays `{ tables: [...] }` — all
 * six consumers (`protect-analyzer`, `channel-watches`, `gauntlet-phase1-checks`,
 * `codegen/index`, `db-authoritative`, this module) read `.tables ?? []`. The P2
 * SECURITY-DEFINER `fn` surface adds an ADDITIVE `fns: [...]` (empty for a schema
 * with no `fn` — so existing schemas are unaffected).
 *
 * The scan is BRACE-DEPTH-AWARE (a hand scan, not the old non-nested
 * `/(\w+)\s*\{([^}]*)\}/g` regex): a P2 `fn` carries a `"""…"""`-quoted plpgsql body
 * that itself contains `{`/`}` (an `IF … END IF`), which the `[^}]*` regex would
 * truncate at the first inner `}`. The scanner tolerates a braced/triple-quoted
 * body and still parses a plain `tableName { … }` table identically to the old
 * regex (a table body has no nested braces, so depth returns to 0 at the SAME `}`).
 *
 * @param {object} schemaBody — AST node with body text, or the raw body string
 * @returns {{ tables: TableDecl[], fns: SecdefFnDecl[] }}
 */
export function parseSchemaBlock(schemaBody) {
  const tables = [];
  const fns = [];
  const text = typeof schemaBody === "string" ? schemaBody : (schemaBody?.body ?? "");
  const n = text.length;
  let i = 0;

  while (i < n) {
    // Skip whitespace between top-level entries.
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;

    const rest = text.slice(i);

    // §14.8.11.2 S4 — a SECURITY-DEFINER `fn` decl: `fn NAME(args) …modifiers… { body }`.
    const fnHead = /^fn\s+([A-Za-z_]\w*)\s*\(/.exec(rest);
    if (fnHead) {
      const parsed = parseFnDecl(text, i, fnHead);
      if (parsed) {
        fns.push(parsed.fn);
        i = parsed.next;
        continue;
      }
      // Malformed `fn` head — advance one char and resume (graceful, never throws).
      i++;
      continue;
    }

    // A plain table: `tableName { … }` optionally followed by the `db-authoritative` marker.
    const tblHead = /^([A-Za-z_]\w*)\s*\{/.exec(rest);
    if (tblHead) {
      const tableName = tblHead[1];
      const braceOpen = i + tblHead[0].length - 1; // index of the `{`
      const braceClose = findSchemaBlockEnd(text, braceOpen);
      if (braceClose === -1) {
        // Unbalanced braces — bail on this entry (mirrors the old regex silently
        // not matching an unterminated block).
        i = braceOpen + 1;
        continue;
      }
      const columnsText = text.slice(braceOpen + 1, braceClose);
      const table = { name: tableName, columns: parseColumns(columnsText) };
      i = braceClose + 1;

      // §14.8.11 opt-in DB-authoritative marker — a bareword `db-authoritative`
      // immediately after the table's closing `}` relocates the tenant-isolation
      // floor to the DB. M1-PROVISIONAL surface. Postgres-only; SQLite hard-fails
      // E-DBAUTH-SQLITE downstream in codegen.
      const trailing = text.slice(i).match(/^\s*db-authoritative\b/);
      if (trailing) {
        table.dbAuthoritative = true;
        i += trailing[0].length;
      }

      tables.push(table);
      continue;
    }

    // Nothing recognized at this position — advance one char (skips stray tokens
    // like a dangling `db-authoritative` marker whose table already consumed it).
    i++;
  }

  return { tables, fns };
}

/**
 * Find the index of the `}` that closes the block opened at `openIdx` (which MUST
 * point at a `{`), tracking brace depth and SKIPPING over `"""…"""` triple-quoted
 * regions (a plpgsql `fn` body, whose `IF … END IF` braces must not miscount).
 * Returns -1 if unbalanced.
 *
 * DELIBERATELY NOT quote-aware for single/double quotes: a plain table body has no
 * nested braces, so brace-depth alone stops at the SAME `}` the old
 * `/\{([^}]*)\}/` regex captured — byte-identical on existing schemas, INCLUDING a
 * `pattern(/o'brien/)` whose lone `'` must stay an ordinary char (skipping to a
 * "matching" quote would swallow the closing brace). A P2 `fn` block is `{ """…""" }`
 * — its plpgsql quotes live inside the triple-quoted region this DOES skip.
 */
function findSchemaBlockEnd(text, openIdx) {
  if (text[openIdx] !== "{") return -1;
  const n = text.length;
  let depth = 0;
  let i = openIdx;
  while (i < n) {
    // Triple-quoted plpgsql body — skip the whole `"""…"""` region verbatim.
    if (text.startsWith('"""', i)) {
      const close = text.indexOf('"""', i + 3);
      i = close === -1 ? n : close + 3;
      continue;
    }
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Parse a P2 SECURITY-DEFINER `fn` declaration starting at `startIdx`
 * (`fnHead` = the `/^fn\s+NAME\s*\(/` match already run by the caller).
 *
 * Surface (M1-PROVISIONAL, §14.8.11.2):
 *   `fn NAME(arg: type, …) security definer owner(<role>) [returns <type>]
 *      [lang="plpgsql"] [requires cap("x")] { """ <plpgsql statements> """ }`
 *
 * The body carries the plpgsql STATEMENTS only (no outer BEGIN/END — the emitter
 * owns the envelope so the injected cap check is un-bypassable and always first).
 * Every identifier (fn name, arg names, owner role) is captured with a STRICT
 * `[A-Za-z_]\w*` pattern, so a `$`/quote cannot enter and later break a dollar-quote
 * or an identifier — the parse-time defense that complements emit-time quoteIdent.
 *
 * @returns {{ fn: SecdefFnDecl, next: number } | null} null on a malformed decl.
 */
function parseFnDecl(text, startIdx, fnHead) {
  const name = fnHead[1];
  const parenOpen = startIdx + fnHead[0].length - 1; // index of `(`
  const parenClose = findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;

  const argText = text.slice(parenOpen + 1, parenClose).trim();
  const args = parseFnArgs(argText);
  if (args === null) return null;

  // The modifier run is everything between `)` and the body-opening `{`.
  const braceOpen = text.indexOf("{", parenClose + 1);
  if (braceOpen === -1) return null;
  const modifiers = text.slice(parenClose + 1, braceOpen);

  // owner(<role>) — MANDATORY (the SECDEF runs as this bounded NOLOGIN role, NOT
  // scrml_app). Strict identifier capture.
  const ownerMatch = /\bowner\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(modifiers);
  if (!ownerMatch) return null;
  const owner = ownerMatch[1];

  // returns <type> — optional; defaults to `void`.
  const returnsMatch = /\breturns\s+([A-Za-z_]\w*)/i.exec(modifiers);
  const returns = returnsMatch ? returnsMatch[1] : "void";

  // requires cap("x") — optional in-body capability gate (extracted, NOT trusted
  // verbatim; the quotes bound the value so no `'` can enter, and we still escape).
  const capMatch = /\brequires\s+cap\s*\(\s*["']([^"']*)["']\s*\)/i.exec(modifiers);
  const cap = capMatch ? capMatch[1] : null;

  // `security definer` is the only supported mode in P2; its presence is advisory
  // here (every P2 `fn` emits SECURITY DEFINER). We record it for future modes.
  const isSecurityDefiner = /\bsecurity\s+definer\b/i.test(modifiers);

  const braceClose = findSchemaBlockEnd(text, braceOpen);
  if (braceClose === -1) return null;
  const blockText = text.slice(braceOpen + 1, braceClose);

  // The body: the `"""…"""` triple-quoted plpgsql statements.
  const bodyMatch = /"""([\s\S]*?)"""/.exec(blockText);
  const body = bodyMatch ? bodyMatch[1] : blockText;

  return {
    fn: { name, args, owner, returns, cap, isSecurityDefiner, body },
    next: braceClose + 1,
  };
}

/**
 * Parse a `fn` argument list: comma-separated `name: type` (or `name type`) pairs.
 * Returns `[{ name, type }]`, or `[]` for an empty list, or `null` if any arg is
 * malformed (a strict identifier is required for both name and type token).
 */
function parseFnArgs(argText) {
  if (argText.length === 0) return [];
  const out = [];
  for (const raw of argText.split(",")) {
    const part = raw.trim();
    if (part.length === 0) return null;
    // `name: type` (canonical) or `name type` (SQL-ish).
    const m = /^([A-Za-z_]\w*)\s*(?::\s*|\s+)([A-Za-z_]\w*)$/.exec(part);
    if (!m) return null;
    out.push({ name: m[1], type: m[2] });
  }
  return out;
}

/**
 * Parse column declarations from inside a table block.
 * Format: columnName: type constraint1 constraint2 ...
 *
 * Recognizes:
 *   - SQL-mirror constraints: primary key, not null, unique, default(...),
 *     references table(col), rename from id
 *   - Shared-core predicates (§39.5.7, L4): req, length(...), pattern(...),
 *     min(n), max(n), gt(n), lt(n), gte(n), lte(n), eq(n), neq(n),
 *     oneOf([...]), notIn([...]). Each captured into `sharedCorePredicates`.
 */
function parseColumns(text) {
  const columns = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const name = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    // Parse type (first word)
    const parts = rest.split(/\s+/);
    const type = parts[0] || "text";
    const restStr = rest.slice(type.length).trim();

    const col = {
      name,
      type: mapSqliteType(type),
      scrmlType: type.toLowerCase(),  // preserved for cell-type-aware lowering (e.g., req on text/blob)
      primaryKey: /primary\s+key/i.test(restStr),
      notNull: /not\s+null/i.test(restStr),
      unique: /unique/i.test(restStr),
      // §14.8.11.2 S3 — a per-column `immutable` keyword (mirrors `not null`/`unique`).
      // Consumed ONLY by generateDbAuthoritativeDDL, which narrows the bounded role's
      // table-level UPDATE grant to the mutable columns (a Postgres column-level
      // REVOKE cannot narrow a table GRANT, so the grant itself is re-shaped). On a
      // non-db-authoritative table the flag is inert (there is no bounded-role grant
      // to narrow) — a db-authoritative table is required for enforcement, and that
      // is Postgres-gated by the E-DBAUTH-SQLITE compile gate.
      immutable: /\bimmutable\b/i.test(restStr),
      default: null,
      references: null,
      renameFrom: null,
      sharedCorePredicates: [],
    };

    // Parse default(...)
    const defaultMatch = restStr.match(/default\(([^)]+)\)/i);
    if (defaultMatch) col.default = defaultMatch[1];

    // Parse references table(column)
    const refMatch = restStr.match(/references\s+(\w+)\((\w+)\)/i);
    if (refMatch) col.references = { table: refMatch[1], column: refMatch[2] };

    // Parse rename from identifier
    const renameMatch = restStr.match(/rename\s+from\s+(\w+)/i);
    if (renameMatch) col.renameFrom = renameMatch[1];

    // Parse shared-core predicates (§39.5.7, L4 additive vocabulary).
    col.sharedCorePredicates = parseSharedCorePredicates(restStr);

    columns.push(col);
  }

  return columns;
}

/**
 * Universal-core predicate names recognized at the schema locus (§39.5.7).
 * `is some` is enumerated in §55.1 but NOT listed in §39.5.7 — schema has no
 * "EXISTS" notion beyond NOT NULL (handled by `req`).
 */
const SCHEMA_LOCUS_PREDICATES = new Set([
  "req",
  "length", "pattern",
  "min", "max",
  "gt", "lt", "gte", "lte",
  "eq", "neq",
  "oneOf", "notIn",
]);

/**
 * Parse the 13 shared-core predicates from a column constraint string.
 *
 * `req` is bareword-only; it must be matched with whitespace boundaries so
 * `requirement` or `required` (hypothetical user constraint names) don't
 * false-positive. The other predicates are call-form: `name(...)`. Predicate
 * argument extraction tracks nested `()` / `[]` so that `oneOf([1,2,3])`
 * and `pattern(/^abc$/)` capture cleanly without splitting on inner commas.
 *
 * @returns {SharedCorePredicate[]}
 *   Each entry: { name, raw, arg } where `arg` is the verbatim text inside
 *   the outermost parens (`null` for bareword `req`).
 */
function parseSharedCorePredicates(restStr) {
  const predicates = [];
  let i = 0;
  const n = restStr.length;

  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(restStr[i])) i++;
    if (i >= n) break;

    // Try to match an identifier (predicate name or other token)
    const identMatch = restStr.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (!identMatch) {
      // Skip non-ident character (e.g., punctuation from another constraint we don't own)
      i++;
      continue;
    }
    const ident = identMatch[0];
    const identEnd = i + ident.length;

    if (!SCHEMA_LOCUS_PREDICATES.has(ident)) {
      i = identEnd;
      continue;
    }

    // For `req`: must be a bareword (followed by whitespace, end, or another
    // alphanum-leading constraint). A `(` after `req` would mean it's not the
    // bareword form — but §55.1 documents `req` as 0+inline (`req("Please...")`).
    // For the schema locus the inline-message form is permitted but currently
    // emits the same lowering; we accept both forms and treat them as the
    // same predicate for emission (the message is purely client-facing and
    // does NOT affect SQL).
    if (ident === "req") {
      // Skip optional inline-message arg `req("...")`
      let nextChar = identEnd;
      while (nextChar < n && /\s/.test(restStr[nextChar])) nextChar++;
      if (nextChar < n && restStr[nextChar] === "(") {
        const closingIdx = findMatchingParen(restStr, nextChar);
        if (closingIdx === -1) {
          // Malformed; bail without recording the predicate
          i = identEnd;
          continue;
        }
        predicates.push({ name: "req", arg: null, raw: restStr.slice(i, closingIdx + 1) });
        i = closingIdx + 1;
      } else {
        predicates.push({ name: "req", arg: null, raw: ident });
        i = identEnd;
      }
      continue;
    }

    // All other predicates require parens.
    let parenStart = identEnd;
    while (parenStart < n && /\s/.test(restStr[parenStart])) parenStart++;
    if (parenStart >= n || restStr[parenStart] !== "(") {
      // Predicate name without parens — not a valid call form. Skip.
      i = identEnd;
      continue;
    }
    const closingIdx = findMatchingParen(restStr, parenStart);
    if (closingIdx === -1) {
      i = identEnd;
      continue;
    }
    const argRaw = restStr.slice(parenStart + 1, closingIdx).trim();
    predicates.push({
      name: ident,
      arg: argRaw,
      raw: restStr.slice(i, closingIdx + 1),
    });
    i = closingIdx + 1;
  }

  return predicates;
}

/**
 * Given a string and the index of an opening `(`, return the index of the
 * matching `)` (taking nested parens and `[...]` into account). Returns -1
 * if unbalanced. Conservative: does NOT track string literals inside.
 * (Schema column constraints don't embed parens inside strings in practice;
 * if a future extension needs that, this helper will need string-tracking.)
 */
function findMatchingParen(str, openIdx) {
  if (str[openIdx] !== "(") return -1;
  let depth = 0;
  let bracketDepth = 0;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && bracketDepth === 0) return i;
    } else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }
  return -1;
}

/**
 * Map scrml schema types to SQLite affinity types (§38.4).
 */
function mapSqliteType(type) {
  const map = {
    text: "TEXT",
    integer: "INTEGER",
    real: "REAL",
    blob: "BLOB",
    boolean: "INTEGER", // SQLite has no BOOLEAN — maps to INTEGER
    timestamp: "TEXT",   // SQLite has no TIMESTAMP — maps to TEXT
  };
  return map[type.toLowerCase()] || "TEXT";
}

/**
 * Map a scrml schema type token to its Postgres-native column type. Used ONLY
 * on the Postgres CREATE-TABLE path (the SQLite path keeps the affinity map
 * above, so existing SQLite output stays byte-identical). The §39.4 core types
 * map to their PG equivalents; any OTHER token (`uuid`, `decimal`, `numeric`,
 * `jsonb`, …) passes through VERBATIM — those are already valid Postgres types
 * and a DB-authoritative table (`id: uuid`, `amount: decimal`) needs them
 * emitted faithfully, not flattened to TEXT. The token is a single whitespace-
 * free word taken from the column declaration at compile time (developer-
 * authored), never runtime input.
 */
function mapPostgresType(scrmlType) {
  const key = String(scrmlType ?? "").toLowerCase();
  const map = {
    text: "text",
    integer: "integer",
    real: "real",
    blob: "bytea",
    boolean: "boolean",
    timestamp: "timestamptz",
  };
  return map[key] || scrmlType;
}

/**
 * Read actual database schema via PRAGMA table_info().
 *
 * @param {object} db — bun:sqlite Database instance
 * @returns {{ tables: ActualTable[] }}
 */
export function readActualSchema(db) {
  const tables = [];
  const tableNames = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_scrml_migrations'"
  ).all();

  for (const { name } of tableNames) {
    const columns = db.query(`PRAGMA table_info(${quoteIdent(name)})`).all();
    tables.push({
      name,
      columns: columns.map(c => ({
        name: c.name,
        type: c.type || "TEXT",
        notNull: c.notnull === 1,
        default: c.dflt_value,
        primaryKey: c.pk === 1,
        // Shared-core predicates are NOT recoverable from PRAGMA table_info
        // (CHECK constraint text isn't exposed through PRAGMA). The diff is
        // structural-only for now — adding a CHECK to an existing column
        // shows up via the schema-rebuild path, not as a per-predicate diff.
        sharedCorePredicates: [],
      })),
    });
  }

  return { tables };
}

/**
 * Compute migration SQL by diffing desired vs actual schema.
 *
 * SPEC §38.6: diff operations are ADD TABLE, ADD COLUMN, DROP TABLE,
 * DROP COLUMN, ALTER COLUMN (via 12-step rebuild), RENAME COLUMN.
 *
 * The optional `options.driver` argument controls driver-specific lowering
 * forms per §39.5.8 (currently only `pattern()` differs across drivers:
 * Postgres uses `~`; SQLite/MySQL use `REGEXP`). Defaults to `"sqlite"` to
 * preserve existing behavior.
 *
 * @param {{ tables: TableDecl[] }} desired
 * @param {{ tables: ActualTable[] }} actual
 * @param {{ driver?: "sqlite"|"postgres"|"mysql", allowDestructive?: boolean }} [options]
 *   `allowDestructive` (default false) gates the §14.8.11-M2 fence: a bare
 *   `DROP TABLE` for an actual-but-not-desired table is emitted ONLY when true
 *   (on Postgres a DROP CASCADE-drops attached RLS policies/grants); when false
 *   the drop is suppressed with a `W-SCHEMA-DESTRUCTIVE-DROP` warning.
 * @returns {{ sql: string[], warnings: string[] }}
 */
export function diffSchema(desired, actual, options = {}) {
  const driver = options.driver ?? "sqlite";
  const sql = [];
  const warnings = [];

  const actualMap = new Map(actual.tables.map(t => [t.name, t]));
  const desiredMap = new Map(desired.tables.map(t => [t.name, t]));

  // 1. New tables (in desired but not actual)
  for (const table of desired.tables) {
    if (!actualMap.has(table.name)) {
      sql.push(generateCreateTable(table, driver));
    }
  }

  // 2. Modified tables (in both — check columns)
  for (const table of desired.tables) {
    const actualTable = actualMap.get(table.name);
    if (!actualTable) continue;

    const actualColMap = new Map(actualTable.columns.map(c => [c.name, c]));
    const desiredColMap = new Map(table.columns.map(c => [c.name, c]));

    // New columns
    for (const col of table.columns) {
      // Check rename
      if (col.renameFrom && actualColMap.has(col.renameFrom)) {
        sql.push(`ALTER TABLE ${quoteIdent(table.name)} RENAME COLUMN ${quoteIdent(col.renameFrom)} TO ${quoteIdent(col.name)};`);
        continue;
      }

      if (!actualColMap.has(col.name)) {
        // Simple ADD COLUMN (SQLite supports this for nullable columns without constraints).
        // A column with shared-core `req` lowers to NOT NULL — same constraint,
        // same fast-path requirement (default required for non-null ADD COLUMN).
        const lowersToNotNull = col.notNull || hasReqPredicate(col);
        const canSimpleAdd = !lowersToNotNull || col.default !== null;
        if (canSimpleAdd) {
          sql.push(generateAddColumn(table.name, col, driver));
        } else if (driver === "postgres") {
          // S7-minimal fence (§14.8.11): Postgres has native ADD COLUMN — NEVER
          // DROP/recreate the table (that CASCADE-drops its RLS policy + grants).
          // A NOT NULL add without a default may fail at apply time on a non-empty
          // table, but that is a legitimate migration error, not a silent drop.
          sql.push(generateAddColumn(table.name, col, driver));
        } else {
          // Needs 12-step rebuild (SQLite only)
          const rebuildSql = generate12StepRebuild(table, actualTable, driver);
          sql.push(...rebuildSql);
          break; // Rebuild handles all column changes at once
        }
      }
    }

    // Dropped columns (in actual but not desired, and not renamed)
    const renamedFrom = new Set(table.columns.filter(c => c.renameFrom).map(c => c.renameFrom));
    for (const actualCol of actualTable.columns) {
      if (!desiredColMap.has(actualCol.name) && !renamedFrom.has(actualCol.name)) {
        warnings.push(`W-SCHEMA-002: Dropping column "${actualCol.name}" from table "${table.name}" — data will be lost.`);
        if (driver === "postgres") {
          // S7-minimal fence: native per-column DROP; never rebuild-via-DROP-TABLE.
          sql.push(`ALTER TABLE ${quoteIdent(table.name)} DROP COLUMN ${quoteIdent(actualCol.name)};`);
          continue;
        }
        // DROP COLUMN requires 12-step rebuild on older SQLite
        const rebuildSql = generate12StepRebuild(table, actualTable, driver);
        sql.push(...rebuildSql);
        break;
      }
    }
  }

  // §14.8.11 — DB-authoritative DDL (S1 RLS + S6 bounded role). Emitted for every
  // `db-authoritative` table on a Postgres driver, for BOTH new and existing
  // tables: the statements are idempotent, so re-running a migration re-asserts
  // the policy/role (the never-clobber fence — a live policy survives a
  // re-migration). SQLite hard-fails E-DBAUTH-SQLITE upstream in codegen, so this
  // path only runs on Postgres. Appended AFTER all table create/alter statements
  // so the table always exists before ENABLE ROW LEVEL SECURITY runs.
  if (driver === "postgres") {
    for (const table of desired.tables) {
      if (table.dbAuthoritative) {
        sql.push(...generateDbAuthoritativeDDL(table));
      }
    }
    // §14.8.11.2 S4 — the SECURITY-DEFINER mutation choke. Emitted AFTER the
    // db-authoritative table DDL (the tables + tenant policy + bounded role must
    // exist first). The `scrml_has_cap` read helper is emitted ONCE when any `fn`
    // is present. All SECDEF/owner-role/grant statements are idempotent (CREATE OR
    // REPLACE FUNCTION, DO-block role, idempotent GRANT/REVOKE), so a re-migration
    // re-asserts them — and scrml NEVER emits a DROP FUNCTION / DROP ROLE, so the
    // never-clobber fence holds by construction for these objects.
    const fns = desired.fns ?? [];
    if (fns.length > 0) {
      const dbAuthTables = desired.tables.filter((t) => t.dbAuthoritative).map((t) => t.name);
      sql.push(generateScrmlHasCapDDL());
      for (const fn of fns) sql.push(...generateSecdefDDL(fn, dbAuthTables));
    }
  }

  // 3. Dropped tables (in actual but not desired).
  //
  // §14.8.11 M2 fence (ruled — Fork 3): a bare `DROP TABLE` is NEVER emitted by
  // default. On Postgres a `DROP TABLE` CASCADE-drops the table's attached RLS
  // policy, grants, and role membership — the exact db-authoritative security
  // objects the tier installs — so the destructive drop is gated behind an
  // explicit `--allow-destructive` opt-in (mirrors Prisma's destructive-change
  // gate). Suppressed → a `W-SCHEMA-DESTRUCTIVE-DROP` warning points the operator
  // at the opt-in; opted-in → the historical `W-SCHEMA-002` + the DROP. A
  // scrml-managed security object is a role/policy, never a table, so the
  // table-DROP gate is the whole fence at the table grain.
  for (const actualTable of actual.tables) {
    if (!desiredMap.has(actualTable.name)) {
      if (options.allowDestructive) {
        warnings.push(`W-SCHEMA-002: Dropping table "${actualTable.name}" — all data will be lost.`);
        sql.push(`DROP TABLE IF EXISTS ${quoteIdent(actualTable.name)};`);
      } else {
        warnings.push(
          `W-SCHEMA-DESTRUCTIVE-DROP: table "${actualTable.name}" exists in the database but ` +
          `not in <schema> — refusing to DROP it (on Postgres a DROP would CASCADE-drop any ` +
          `attached RLS policy, grants, and role membership). Re-run with --allow-destructive to ` +
          `drop it, or add "${actualTable.name}" to <schema> to keep it.`,
        );
      }
    }
  }

  return { sql, warnings };
}

/**
 * Generate CREATE TABLE SQL from a table declaration.
 *
 * Emits SQL-mirror constraints (PRIMARY KEY / NOT NULL / UNIQUE / DEFAULT /
 * REFERENCES) as before, then appends shared-core lowered constraints per
 * §39.5.8. Shared-core `req` adds `NOT NULL` (and a `CHECK (col != '')` for
 * text/blob), other shared-core predicates add `CHECK (...)` clauses.
 */
export function generateCreateTable(table, driver = "sqlite") {
  const colDefs = table.columns.map(col => {
    // On Postgres emit the native type (`uuid`, `decimal`, `timestamptz`, …);
    // on SQLite keep the affinity type (`col.type`) so existing output is
    // byte-identical.
    const columnType = driver === "postgres" ? mapPostgresType(col.scrmlType) : col.type;
    let def = `${quoteIdent(col.name)} ${columnType}`;
    if (col.primaryKey) def += " PRIMARY KEY";

    // SQL-mirror NOT NULL OR shared-core req → NOT NULL.
    // Avoid duplicate NOT NULL when both forms present.
    const wantsNotNull = col.notNull || hasReqPredicate(col);
    if (wantsNotNull) def += " NOT NULL";

    if (col.unique) def += " UNIQUE";
    if (col.default !== null) def += ` DEFAULT (${col.default})`;
    if (col.references) def += ` REFERENCES ${quoteIdent(col.references.table)}(${quoteIdent(col.references.column)})`;

    // §39.5.8 shared-core lowering: append CHECK clauses (and the req empty-
    // string check for text/blob).
    const checkClauses = lowerSharedCoreToChecks(col, driver);
    for (const clause of checkClauses) {
      def += ` ${clause}`;
    }

    return "  " + def;
  });

  return `CREATE TABLE ${quoteIdent(table.name)} (\n${colDefs.join(",\n")}\n);`;
}

// ---------------------------------------------------------------------------
// §14.8.11 DB-authoritative tier (Milestone 1 — reads-authoritative, Postgres).
//
// The spike-validated (real PG16) target shape for a `db-authoritative` table:
//   S6 — a bounded NOLOGIN NOBYPASSRLS role the per-request principal drops to
//        (MANDATORY: a superuser/table-owner BYPASSES `FORCE RLS`, so A1 without
//        S6 is a silent no-op — the exact "looks enforced and isn't" trap).
//   S1 — `ENABLE`+`FORCE ROW LEVEL SECURITY` + a tenant-isolation policy keyed on
//        the pinned `scrml.tenant` GUC (consumed, never derived — stays on the
//        invariant side of the §14.8.10 firewall). `current_setting(..., true)`
//        returns NULL (not an error) for a missing GUC → a NULL tenant matches no
//        row = fail-closed read.
//
// All statements are idempotent so a re-migration NEVER clobbers a live policy
// mid-flight: the role is guarded by a `duplicate_object` catch; ENABLE/FORCE/
// GRANT are naturally idempotent; the policy is `DROP POLICY IF EXISTS` +
// `CREATE POLICY` (only the scrml-managed `scrml_tenant_iso` name is touched —
// a hand-authored policy on the same table survives).
// ---------------------------------------------------------------------------

/** The bounded principal role the per-request A1 wrapper drops to (S6). */
export const DBAUTH_ROLE = "scrml_app";
/** The compiler-managed tenant-isolation policy name (S1). */
export const DBAUTH_POLICY = "scrml_tenant_iso";
/** The transaction-scoped GUC carrying the pinned tenant scalar (S2). */
export const DBAUTH_TENANT_GUC = "scrml.tenant";
/**
 * §14.8.11.2 S4 — the transaction-scoped GUC carrying the principal's capability
 * SET as a JSON array (`["void","reconcile"]`). Injected alongside the tenant GUC
 * by the A1 wrapper (server-resolved, never client-supplied — the E-REACTIVE-003
 * discipline `tenantId` already follows) and READ by the `scrml_has_cap(text)`
 * helper inside a SECURITY-DEFINER body.
 */
export const DBAUTH_CAPS_GUC = "scrml.principal.caps";

/**
 * Emit the S6 bounded-role DDL. Cluster-global and app-shared (a PG role is
 * cluster-global, not per-DB — the shared-`authenticator` PostgREST pattern), so
 * it is emitted once and guarded against duplicate creation.
 *
 * @returns {string} a single idempotent DO-block statement
 */
export function generateBoundedRoleDDL() {
  return (
    `DO $$ BEGIN CREATE ROLE ${DBAUTH_ROLE} NOLOGIN NOBYPASSRLS; ` +
    `EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
  );
}

/**
 * Emit the S1 (RLS + policy) + the per-table S6 GRANT DDL for one
 * `db-authoritative` table. Postgres-only; the caller (diffSchema on a postgres
 * driver) is responsible for gating on the driver.
 *
 * The policy casts the GUC to the `tenant_id` column's Postgres type so the
 * comparison is well-typed (`tenant_id = current_setting('scrml.tenant',
 * true)::uuid`). If the table declares no `tenant_id` column the comparison
 * falls back to a text compare (M1 keys tenant isolation on `tenant_id`; a
 * db-authoritative table is expected to carry one — the §14.8.10 convention).
 *
 * §14.8.11.2 S3 (writes-authority) — a per-column `immutable` keyword narrows the
 * bounded role's write authority. A Postgres column-level `REVOKE` CANNOT narrow a
 * table-level `GRANT`, so when ANY column is `immutable` the blanket table-level
 * `GRANT … UPDATE …` is RE-SHAPED to `GRANT SELECT, INSERT, DELETE` + a `REVOKE
 * UPDATE` (clears any prior table-level UPDATE, e.g. from an M1 migration) + a
 * column-scoped `GRANT UPDATE (<mutable cols>)`. Result: `scrml_app` can never
 * UPDATE an immutable column — the sole sanctioned path is the S4 SECDEF choke.
 * ANTI-REGRESSION: a table with ZERO immutable columns emits BYTE-IDENTICAL to M1
 * (the single table-level `GRANT SELECT, INSERT, UPDATE, DELETE`).
 *
 * @param {TableDecl} table — a table with `dbAuthoritative: true`
 * @returns {string[]} the ordered DDL statements
 */
export function generateDbAuthoritativeDDL(table) {
  const t = quoteIdent(table.name);
  const tenantCol = (table.columns ?? []).find((c) => c.name === "tenant_id");
  const castType = tenantCol ? mapPostgresType(tenantCol.scrmlType) : null;
  const guc = `current_setting('${DBAUTH_TENANT_GUC}', true)`;
  const rhs = castType ? `${guc}::${castType}` : guc;

  const cols = table.columns ?? [];
  const immutableCols = cols.filter((c) => c.immutable);

  // S6 — the bounded role's write grant.
  let grantStmts;
  if (immutableCols.length === 0) {
    // No immutable columns → BYTE-IDENTICAL to M1 (a single table-level grant).
    grantStmts = [`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${DBAUTH_ROLE};`];
  } else {
    // S3 — column-scoped write authority: no table-level UPDATE, only the mutable
    // columns. The REVOKE UPDATE clears any prior table-level grant (idempotent —
    // harmless on a fresh table, load-bearing when migrating from M1).
    const mutableCols = cols.filter((c) => !c.immutable);
    grantStmts = [
      `GRANT SELECT, INSERT, DELETE ON ${t} TO ${DBAUTH_ROLE};`,
      `REVOKE UPDATE ON ${t} FROM ${DBAUTH_ROLE};`,
    ];
    if (mutableCols.length > 0) {
      const colList = mutableCols.map((c) => quoteIdent(c.name)).join(", ");
      grantStmts.push(`GRANT UPDATE (${colList}) ON ${t} TO ${DBAUTH_ROLE};`);
    }
    // (all columns immutable → no UPDATE grant at all — insert-once, never-update.)
  }

  return [
    // S6 — the bounded principal role (idempotent).
    generateBoundedRoleDDL(),
    // S6 — grant the bounded role its write authority (table-level, or S3 column-scoped).
    ...grantStmts,
    // S1 — turn RLS on and FORCE it (so even the table owner is subject to it).
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    // S1 — the tenant-isolation policy, re-created idempotently (never clobbers a
    // hand-authored policy — only the scrml-managed name is dropped).
    `DROP POLICY IF EXISTS ${DBAUTH_POLICY} ON ${t};`,
    `CREATE POLICY ${DBAUTH_POLICY} ON ${t} USING ("tenant_id" = ${rhs});`,
  ];
}

// ---------------------------------------------------------------------------
// §14.8.11.2 DB-authoritative tier (Milestone 2 — writes-authoritative, Postgres).
//
// P2 is the FIRST milestone that crosses the §14.8.10 invariant/policy firewall:
// scrml begins emitting AUTHORIZATION (who-may-perform-which-operation), not just
// relocating the isolation invariant. The S4 SECURITY-DEFINER mutation choke is the
// sole sanctioned write path for a column `scrml_app` was revoked from (S3).
//
// SECDEF HARDENING is a CODEGEN INVARIANT (a SECDEF that forgot `SET search_path`
// is a CVE-2020-25695 privesc hole — WORSE than no enforcement):
//   • SECURITY DEFINER SET search_path = pg_catalog, public
//       (pg_catalog FIRST pins the built-ins against shadowing; public is REQUIRED
//        so the body's unqualified table refs — `UPDATE invoices …` in public —
//        resolve. `pg_temp` is deliberately NOT on the path.)
//   • owned by a bounded NOLOGIN owner role DISTINCT from scrml_app (a SECDEF runs
//     AS its owner; scrml_app lacks the immutable-column UPDATE, a superuser would
//     over-privilege the choke).
//   • REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO scrml_app (no ambient EXECUTE).
// Every identifier is escaped via quoteIdent (the M2-HIGH lesson) — and the parser
// already constrained fn/owner/arg names to `[A-Za-z_]\w*`, so a `$` can never
// enter and break a dollar-quote.
// ---------------------------------------------------------------------------

/**
 * §14.8.11.2 S4 — the `scrml_has_cap(text)` read helper. Emitted ONCE per apply
 * (idempotent CREATE OR REPLACE) when a schema declares ≥1 SECDEF `fn`. Reads the
 * txn-scoped `scrml.principal.caps` JSON-array GUC; a missing/unpinned GUC yields
 * FALSE (fail-closed — no caps ⇒ no privileged mutation). NOT security-definer
 * (a pure GUC read needs no elevated privilege); still search_path-pinned so the
 * `::jsonb` cast + `?` operator resolve to pg_catalog and cannot be shadowed.
 *
 * @returns {string}
 */
export function generateScrmlHasCapDDL() {
  return (
    `CREATE OR REPLACE FUNCTION scrml_has_cap(cap text) RETURNS boolean\n` +
    `  LANGUAGE sql STABLE\n` +
    `  SET search_path = pg_catalog, public\n` +
    `  AS $scrml_hascap$\n` +
    `    SELECT coalesce(current_setting('${DBAUTH_CAPS_GUC}', true)::jsonb ? cap, false)\n` +
    `  $scrml_hascap$;`
  );
}

/**
 * Pick a dollar-quote tag that does NOT occur in `body`, so an author's plpgsql
 * text can never accidentally terminate the `$…$` wrapper. Tries `$scrml_fn$`,
 * then `$scrml_fn0$`, `$scrml_fn1$`, … (correctness robustness, not a security
 * boundary — the body is compile-time author source at the same trust level as the
 * rest of the schema).
 */
function dollarTag(body) {
  let tag = "scrml_fn";
  let i = 0;
  while (body.includes(`$${tag}$`)) tag = `scrml_fn${i++}`;
  return `$${tag}$`;
}

/**
 * §14.8.11.2 S4 — emit the hardened SECURITY-DEFINER DDL for one `fn` declaration.
 * The body carries the plpgsql STATEMENTS only; the emitter OWNS the `BEGIN … END`
 * envelope and injects the `requires cap("x")` check as the FIRST statement inside
 * it, so the capability gate is un-bypassable and always runs first.
 *
 * The bounded owner role is granted full CRUD on the db-authoritative tables so the
 * body (running AS the owner) can mutate an immutable column scrml_app is revoked
 * from — but the owner is STILL subject to the tenant-isolation policy (which has no
 * TO-clause ⇒ applies to every role), so the SECDEF's writes STACK on top of tenant
 * isolation (the caps txn pins `scrml.tenant`; an unpinned txn ⇒ the body touches
 * zero rows, fail-closed). No permissive owner-bypass policy is emitted — that would
 * let the choke escape tenant scope.
 *
 * @param {SecdefFnDecl} fn — a parsed `fn` (name, args, owner, returns, cap, body)
 * @param {string[]} dbAuthTables — the db-authoritative table names in the schema
 * @returns {string[]} the ordered DDL statements
 */
export function generateSecdefDDL(fn, dbAuthTables = []) {
  const fnName = quoteIdent(fn.name);
  const owner = quoteIdent(fn.owner);
  const createArgs = (fn.args ?? [])
    .map((a) => `${quoteIdent(a.name)} ${mapPostgresType(a.type)}`)
    .join(", ");
  const typeArgs = (fn.args ?? []).map((a) => mapPostgresType(a.type)).join(", ");
  const signature = `${fnName}(${typeArgs})`; // ALTER/REVOKE/GRANT identify by arg TYPES
  const ret = mapPostgresType(fn.returns || "void");

  // The cap gate (first statement inside BEGIN). The cap value came from the parser
  // bounded by quotes (no `'` inside); escaped anyway (SQL single-quote doubling).
  const capEsc = String(fn.cap ?? "").replace(/'/g, "''");
  const capGuard = fn.cap
    ? `    IF NOT scrml_has_cap('${capEsc}') THEN RAISE EXCEPTION 'denied'; END IF;\n`
    : "";

  const bodyText = indentPlpgsqlBody(fn.body ?? "");
  const tag = dollarTag(fn.body ?? "");

  const stmts = [];

  // 1. the bounded NOLOGIN owner role (idempotent; distinct from scrml_app).
  stmts.push(
    `DO $scrml_secdef$ BEGIN CREATE ROLE ${owner} NOLOGIN NOBYPASSRLS; ` +
      `EXCEPTION WHEN duplicate_object THEN NULL; END $scrml_secdef$;`,
  );
  // 2. provision the owner so the (non-superuser) migrator can reassign the function
  //    to it below — SECURITY-CRITICAL: without the reassignment the SECDEF would run
  //    as the powerful migrator, not the bounded owner. `ALTER FUNCTION … OWNER TO`
  //    requires (a) the migrator can SET ROLE to the owner and (b) the owner holds
  //    CREATE on the function's schema. Both idempotent; both succeed on first deploy
  //    (the migrator created the owner ⇒ holds ADMIN OPTION). PG16 plain GRANT
  //    membership defaults SET TRUE (PG15-portable). (A cluster where a DIFFERENT
  //    migrator pre-created the owner role hits the M1 cluster-global-role open.)
  stmts.push(`GRANT ${owner} TO CURRENT_USER;`);
  stmts.push(`GRANT CREATE ON SCHEMA public TO ${owner};`);
  // 3. grant the owner CRUD on the db-authoritative tables (table-level UPDATE, i.e.
  //    including the immutable columns scrml_app cannot touch). Idempotent.
  for (const tbl of dbAuthTables) {
    stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdent(tbl)} TO ${owner};`);
  }
  // 4. the hardened SECDEF function (idempotent CREATE OR REPLACE).
  stmts.push(
    `CREATE OR REPLACE FUNCTION ${fnName}(${createArgs}) RETURNS ${ret}\n` +
      `  LANGUAGE plpgsql\n` +
      `  SECURITY DEFINER\n` +
      `  SET search_path = pg_catalog, public\n` +
      `  AS ${tag}\n` +
      `  BEGIN\n` +
      capGuard +
      bodyText +
      `\n  END\n` +
      `  ${tag};`,
  );
  // 5. bind ownership (the SECDEF now runs as the bounded owner, NOT the migrator).
  stmts.push(`ALTER FUNCTION ${signature} OWNER TO ${owner};`);
  // 6. lock down EXECUTE — no ambient PUBLIC EXECUTE; only the runtime role may CALL.
  stmts.push(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC;`);
  stmts.push(`GRANT EXECUTE ON FUNCTION ${signature} TO ${DBAUTH_ROLE};`);

  return stmts;
}

/**
 * Re-indent a plpgsql body (the `"""…"""` content) to sit cleanly inside the
 * emitter-owned `BEGIN … END`: trim outer blank lines, strip the common leading
 * indentation, then indent every non-empty line by 4 spaces. Readability only —
 * plpgsql is whitespace-insensitive.
 */
function indentPlpgsqlBody(body) {
  const lines = String(body).replace(/\t/g, "  ").split("\n");
  // Drop leading/trailing blank lines.
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return "";
  // Common leading whitespace across non-blank lines.
  const indents = lines
    .filter((l) => l.trim() !== "")
    .map((l) => (l.match(/^[ ]*/) || [""])[0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((l) => (l.trim() === "" ? "" : "    " + l.slice(common)))
    .join("\n");
}

/**
 * Generate ALTER TABLE ADD COLUMN SQL.
 */
function generateAddColumn(tableName, col, driver = "sqlite") {
  let def = `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${quoteIdent(col.name)} ${col.type}`;

  // NOT NULL on ADD COLUMN requires a default (handled by the diff
  // canSimpleAdd guard). When both shared-core req and a default are present,
  // emit NOT NULL.
  const wantsNotNull = (col.notNull || hasReqPredicate(col)) && col.default !== null;
  if (wantsNotNull) def += " NOT NULL";

  if (col.unique) def += " UNIQUE";
  if (col.default !== null) def += ` DEFAULT (${col.default})`;
  if (col.references) def += ` REFERENCES ${quoteIdent(col.references.table)}(${quoteIdent(col.references.column)})`;

  // Shared-core CHECK clauses (per §39.5.8).
  const checkClauses = lowerSharedCoreToChecks(col, driver);
  for (const clause of checkClauses) {
    def += ` ${clause}`;
  }

  return def + ";";
}

/**
 * Returns true if the column has a shared-core `req` predicate.
 */
function hasReqPredicate(col) {
  return Array.isArray(col.sharedCorePredicates)
    && col.sharedCorePredicates.some(p => p.name === "req");
}

/**
 * Lower a column's shared-core predicates to standard SQL DDL CHECK clauses
 * (and, for `req` on text/blob, an additional CHECK for the empty-string
 * exclusion). Returns the clauses as an array of strings, in source order;
 * the caller concatenates them with leading whitespace.
 *
 * Per §39.5.8:
 *
 *   req               → NOT NULL (emitted by caller) + (text/blob only)
 *                       CHECK (col != '')
 *   length(<rel>)     → CHECK (length(col) <op> N)
 *   pattern(/re/)     → driver-specific:
 *                       SQLite/MySQL: CHECK (col REGEXP 're')
 *                       Postgres:     CHECK (col ~ 're')
 *   min(n)/max(n)     → CHECK (col >= n) / CHECK (col <= n)
 *   gt/lt/gte/lte/eq/neq → analogous CHECK (col <op> n)
 *   oneOf([v1,v2,...]) → CHECK (col IN (v1,v2,...))
 *   notIn([v1,v2,...]) → CHECK (col NOT IN (v1,v2,...))
 *
 * The `?{}` SQL passthrough block is inviolable per §39.5.8 line 16447 — this
 * function emits ONLY DDL constraint clauses; it never touches `?{}` text.
 *
 * @param {ColumnDecl} col
 * @param {"sqlite"|"postgres"|"mysql"} driver
 * @returns {string[]}
 */
function lowerSharedCoreToChecks(col, driver) {
  const out = [];
  const preds = col.sharedCorePredicates ?? [];
  const colName = col.name;
  const quotedCol = quoteIdent(colName);

  for (const p of preds) {
    switch (p.name) {
      case "req": {
        // §39.5.8 line 16445: req → NOT NULL + (text/blob only) CHECK (col != '').
        // The NOT NULL is emitted by generateCreateTable / generateAddColumn at
        // the column-clause level. Here we add the empty-string check ONLY for
        // string-shaped columns (text/blob). Numeric/timestamp columns can't
        // hold the empty string anyway.
        if (col.scrmlType === "text" || col.scrmlType === "blob") {
          out.push(`CHECK (${quotedCol} != '')`);
        }
        break;
      }
      case "length": {
        const inner = lowerLengthArg(p.arg, quotedCol);
        if (inner !== null) out.push(`CHECK (${inner})`);
        break;
      }
      case "pattern": {
        const re = stripPatternLiteral(p.arg);
        if (re === null) break;
        if (driver === "postgres") {
          out.push(`CHECK (${quotedCol} ~ '${escapeSqlString(re)}')`);
        } else {
          // sqlite + mysql
          out.push(`CHECK (${quotedCol} REGEXP '${escapeSqlString(re)}')`);
        }
        break;
      }
      case "min":
        out.push(`CHECK (${quotedCol} >= ${p.arg})`);
        break;
      case "max":
        out.push(`CHECK (${quotedCol} <= ${p.arg})`);
        break;
      case "gt":
        out.push(`CHECK (${quotedCol} > ${p.arg})`);
        break;
      case "lt":
        out.push(`CHECK (${quotedCol} < ${p.arg})`);
        break;
      case "gte":
        out.push(`CHECK (${quotedCol} >= ${p.arg})`);
        break;
      case "lte":
        out.push(`CHECK (${quotedCol} <= ${p.arg})`);
        break;
      case "eq":
        out.push(`CHECK (${quotedCol} = ${p.arg})`);
        break;
      case "neq":
        out.push(`CHECK (${quotedCol} != ${p.arg})`);
        break;
      case "oneOf": {
        const items = stripArrayLiteral(p.arg);
        if (items === null) break;
        out.push(`CHECK (${quotedCol} IN (${items}))`);
        break;
      }
      case "notIn": {
        const items = stripArrayLiteral(p.arg);
        if (items === null) break;
        out.push(`CHECK (${quotedCol} NOT IN (${items}))`);
        break;
      }
      // No default — unknown predicates were already filtered by
      // parseSharedCorePredicates' SCHEMA_LOCUS_PREDICATES gate.
    }
  }

  return out;
}

/**
 * Lower the `length(<relational>)` argument to a SQL boolean expression.
 * `arg` is the raw string between the parens of `length(...)`. Per the spec,
 * the inner is a relational predicate: `>=N`, `>N`, `<=N`, `<N`, `==N`, `!=N`.
 *
 * @returns {string|null} — SQL like `length("col") >= 2`, or null on parse fail.
 */
function lowerLengthArg(arg, quotedCol) {
  if (typeof arg !== "string") return null;
  const m = arg.trim().match(/^(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const op = m[1] === "==" ? "=" : m[1];
  const n = m[2];
  return `length(${quotedCol}) ${op} ${n}`;
}

/**
 * Extract the regex source from `pattern(/re/)`. Accepts the slash-delimited
 * form (`/re/`) and a bare-string fallback (`'re'` or `"re"`). Returns null on
 * parse failure.
 */
function stripPatternLiteral(arg) {
  if (typeof arg !== "string") return null;
  const trimmed = arg.trim();
  // /re/ form
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  // /re/flags form — strip flags (DDL-level CHECK can't honor JS regex flags;
  // emit pattern bare so the DBMS regex engine evaluates it case-sensitively
  // unless the source literal had no flags). For now, drop flags conservatively.
  const flagMatch = trimmed.match(/^\/(.+)\/[gimsuy]*$/);
  if (flagMatch) return flagMatch[1];
  // 'string' / "string" fallback
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return null;
}

/**
 * Extract array-literal contents from `oneOf([v1, v2, ...])` or
 * `notIn([...])`. Returns the verbatim contents (without surrounding `[` `]`),
 * suitable for direct injection into a SQL `IN (...)` clause. Items are passed
 * through verbatim — string literals retain their quotes, numerics their digits.
 *
 * @returns {string|null}
 */
function stripArrayLiteral(arg) {
  if (typeof arg !== "string") return null;
  const trimmed = arg.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed.slice(1, -1).trim();
}

/**
 * Escape single-quotes for SQL string literal embedding (regex source for the
 * `pattern()` lowering). Not a full SQL injection guard — the regex source is
 * developer-authored at compile time, not user-supplied at runtime.
 */
function escapeSqlString(s) {
  return s.replace(/'/g, "''");
}

/**
 * Generate the 12-step SQLite ALTER TABLE workaround (§38.6.3).
 * Used when column changes can't be done with simple ALTER TABLE.
 */
function generate12StepRebuild(desiredTable, actualTable, driver = "sqlite") {
  const tmpName = `_scrml_tmp_${desiredTable.name}`;
  const lines = [];

  // 1. Create new table with desired schema (temp name)
  lines.push(generateCreateTable({ ...desiredTable, name: tmpName }, driver));

  // 2. Copy data — map columns that exist in both
  const desiredCols = desiredTable.columns.map(c => c.name);
  const actualCols = new Set(actualTable.columns.map(c => c.name));
  const renames = new Map(desiredTable.columns.filter(c => c.renameFrom).map(c => [c.name, c.renameFrom]));

  const selectCols = desiredCols.map(name => {
    if (renames.has(name) && actualCols.has(renames.get(name))) {
      return `${quoteIdent(renames.get(name))} AS ${quoteIdent(name)}`;
    }
    if (actualCols.has(name)) {
      return `${quoteIdent(name)}`;
    }
    // New column — use default or NULL
    const col = desiredTable.columns.find(c => c.name === name);
    if (col?.default !== null) {
      return `${col.default} AS ${quoteIdent(name)}`;
    }
    return `NULL AS ${quoteIdent(name)}`;
  });

  lines.push(`INSERT INTO ${quoteIdent(tmpName)} (${desiredCols.map(n => quoteIdent(n)).join(", ")}) SELECT ${selectCols.join(", ")} FROM ${quoteIdent(desiredTable.name)};`);

  // 3. Drop old table
  lines.push(`DROP TABLE ${quoteIdent(desiredTable.name)};`);

  // 4. Rename temp to final
  lines.push(`ALTER TABLE ${quoteIdent(tmpName)} RENAME TO ${quoteIdent(desiredTable.name)};`);

  return lines;
}

// ---------------------------------------------------------------------------
// Postgres schema introspection (`scrml introspect`, BaaS #3)
//
// The inverse of the SQLite `readActualSchema` + `generateCreateTable` path:
// read a LIVE Postgres database's structure and emit the equivalent scrml
// `<schema>` SOURCE text (NOT SQL DDL). Eases adopter migration. Additive.
//
// PRINCIPLE — SELF-VERIFYING EMIT. `parseSchemaBlock` (this file) is a regex
// parser with real footguns (`[^}]*` table body, line-split columns, a
// `default\(([^)]+)\)` paren-delimited capture, an in-string predicate-name
// scanner). Rather than enumerate those footguns one-by-one, emitScrmlSchemaSource
// GUARANTEES its output round-trips: it re-parses its OWN output via
// parseSchemaBlock and drops any field (default / FK reference / column / table)
// that does NOT survive identically — WITH a W-INTROSPECT-* warning naming what
// was dropped and why. This is the honest best-effort-migration model (Prisma
// db pull / Drizzle introspect: emit what round-trips, loudly flag the rest).
//
// v1 scope (SPEC §39): base tables · columns · single-column PRIMARY KEY /
// NOT NULL / UNIQUE / DEFAULT / single-column FOREIGN KEY · the PG-type map.
// Composite constraints, function/expression defaults, and non-representable
// identifiers are SKIPPED-with-a-warning, never silently corrupted. Out of
// scope: CHECK → shared-core recovery, indexes, enums, views, non-public
// schemas, sequences (serial → integer).
// ---------------------------------------------------------------------------

/**
 * Postgres `information_schema.columns.data_type` (and common pg_catalog short
 * aliases) → scrml `<schema>` column type (SPEC §39.4:
 * text | integer | real | blob | boolean | timestamp). `real` and `boolean`
 * are valid §39.4 column types, so the numeric / boolean families map without
 * loss. Types with no scrml equivalent fall through mapPgTypeToScrml's default
 * to `text` + a warning.
 */
const PG_TYPE_MAP = {
  // integer family
  "integer": "integer", "int": "integer", "int2": "integer", "int4": "integer",
  "int8": "integer", "smallint": "integer", "bigint": "integer",
  "smallserial": "integer", "serial": "integer", "bigserial": "integer",
  // text family
  "text": "text", "varchar": "text", "character varying": "text",
  "char": "text", "character": "text", "bpchar": "text", "citext": "text",
  // boolean
  "boolean": "boolean", "bool": "boolean",
  // real family
  "numeric": "real", "decimal": "real", "real": "real",
  "double precision": "real", "float4": "real", "float8": "real",
  // timestamp family
  "timestamp": "timestamp", "timestamp without time zone": "timestamp",
  "timestamptz": "timestamp", "timestamp with time zone": "timestamp",
  "date": "timestamp",
};

/**
 * Map a raw Postgres data_type string to a scrml `<schema>` column type.
 * Returns `{ scrmlType, unmapped }` — `unmapped: true` (with `scrmlType: "text"`)
 * when the PG type has no scrml equivalent, so the caller can raise
 * W-INTROSPECT-TYPE-UNMAPPED.
 *
 * @param {string} pgType
 * @returns {{ scrmlType: "text"|"integer"|"real"|"boolean"|"timestamp", unmapped: boolean }}
 */
export function mapPgTypeToScrml(pgType) {
  const key = String(pgType ?? "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PG_TYPE_MAP, key)) {
    return { scrmlType: PG_TYPE_MAP[key], unmapped: false };
  }
  return { scrmlType: "text", unmapped: true };
}

/**
 * Whether a scrml identifier (table or column name) is representable in
 * `<schema>` source. parseSchemaBlock scans names with `\w+`, so a Postgres
 * name that is non-`\w` (`"user-profiles"`, `"my col"`, a quoted reserved word)
 * cannot round-trip and MUST NOT be emitted verbatim.
 */
function isRepresentableIdentifier(name) {
  return typeof name === "string" && /^[A-Za-z_]\w*$/.test(name);
}

/**
 * Strip a single trailing Postgres type-cast from a default expression. The
 * cast type may be schema-qualified (`::public.mood`), quoted (`::"My Type"`),
 * multi-word (`::character varying`), and/or an array (`::int[]`).
 */
function stripPgCast(s) {
  return s.replace(/::(?:"?\w+"?\.)?"?\w[\w ]*"?(\[\])?$/, "").trim();
}

/**
 * Whether a (cast-stripped, paren-normalized) Postgres default is a scrml
 * `default(<literal>)` LITERAL (SPEC §39 `default '(' literal ')'`): a number,
 * a boolean, a bare keyword (`CURRENT_TIMESTAMP`), or a single-quoted string
 * with NO parens inside. NOTE: this is a NECESSARY-not-sufficient screen — the
 * self-verify (defaultRoundTrips) is the final authority, catching literals that
 * still mis-parse (`'{}'` braces, embedded newlines, in-string predicate names).
 */
function isEmittableDefaultLiteral(s) {
  if (typeof s !== "string" || s === "") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return true;            // number
  if (/^(?:true|false)$/i.test(s)) return true;            // boolean
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return true;     // bare keyword (CURRENT_TIMESTAMP, …)
  if (/^'(?:[^'()]|'')*'$/.test(s)) return true;           // single-quoted string, no parens inside
  return false;
}

/**
 * Classify a Postgres `column_default` for emission (the SEMANTIC screen; the
 * self-verify is the SYNTACTIC authority on top). Returns:
 *   { kind: "none" }                   — NULL / empty → drop, no warning
 *   { kind: "sequence" }               — `nextval(...)` → drop, no warning
 *                                        (serial → integer; documented mapping)
 *   { kind: "literal", value }         — a candidate scrml default(<literal>)
 *   { kind: "expression", value: raw } — a non-literal default (function call /
 *                                        expression) → drop + W-INTROSPECT-
 *                                        DEFAULT-DROPPED
 *
 * Postgres wraps a negative-numeric default in parens (`DEFAULT -1` serializes
 * as `(-1)`); that wrapping pair is stripped so the literal survives (a negative
 * literal IS representable — `default(-1)` round-trips).
 *
 * @param {string|null|undefined} rawDef
 */
function classifyPgDefault(rawDef) {
  if (typeof rawDef !== "string") return { kind: "none" };
  const trimmed = rawDef.trim();
  if (trimmed === "") return { kind: "none" };
  // Sequence-backed serial/identity default — dropped (serial → integer).
  if (/^nextval\s*\(/i.test(trimmed)) return { kind: "sequence" };
  let candidate = stripPgCast(trimmed);
  // Postgres parenthesizes negative numeric defaults: `(-1)` → `-1`.
  const parenNum = candidate.match(/^\(\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (parenNum) candidate = parenNum[1];
  if (isEmittableDefaultLiteral(candidate)) return { kind: "literal", value: candidate };
  return { kind: "expression", value: trimmed };
}

/**
 * SELF-VERIFY probe: does `default(<literal>)` survive a round-trip through
 * parseSchemaBlock IN ISOLATION? Emits a minimal one-column probe schema and
 * confirms the parsed column recovered EXACTLY this default and introduced NO
 * spurious shared-core predicate (an in-string predicate name like `'req'`) and
 * NO extra table/column (a `}` in the literal truncates the probe body). The
 * probe is byte-faithful to the real emission (same `{ … }` body + line shape),
 * so any breakage that would occur in context also breaks the probe.
 */
function defaultRoundTrips(scrmlType, literal) {
  const probe = `<schema>\n  _probe {\n    _col: ${scrmlType} default(${literal})\n  }\n</>`;
  const parsed = parseSchemaBlock(probe);
  if (parsed.tables.length !== 1) return false;
  const t = parsed.tables[0];
  if (t.name !== "_probe" || t.columns.length !== 1) return false;
  const c = t.columns[0];
  return c.name === "_col"
    && c.default === literal
    && (c.sharedCorePredicates?.length ?? 0) === 0;
}

/**
 * SELF-VERIFY probe: does `references <table>(<column>)` survive a round-trip?
 * A target whose NAME collides with a shared-core predicate (`references max(id)`)
 * re-parses as BOTH a reference AND a spurious `max(id)` predicate — that is a
 * structural divergence, so the reference is dropped.
 */
function referencesRoundTrips(refTable, refColumn) {
  const probe = `<schema>\n  _probe {\n    _col: integer references ${refTable}(${refColumn})\n  }\n</>`;
  const parsed = parseSchemaBlock(probe);
  if (parsed.tables.length !== 1) return false;
  const t = parsed.tables[0];
  if (t.name !== "_probe" || t.columns.length !== 1) return false;
  const c = t.columns[0];
  return c.name === "_col"
    && c.references != null
    && c.references.table === refTable
    && c.references.column === refColumn
    && (c.sharedCorePredicates?.length ?? 0) === 0;
}

/**
 * Push a composite-constraint skip warning (shared by the PK/UNIQUE and FK
 * grouping loops).
 */
function pushCompositeSkip(warnings, tableName, type, cols) {
  warnings.push(
    `W-INTROSPECT-COMPOSITE-CONSTRAINT-SKIPPED: table "${tableName}" ${type} ` +
    `(${cols.join(", ")}) is a composite (multi-column) constraint — scrml ` +
    `<schema> supports single-column constraints only (v1); skipped. Re-add it ` +
    `via a ?{} migration block.`,
  );
}

/**
 * Read every base-table name in the current schema (used by the CLI to build a
 * helpful "available tables" list when `--table <name>` names a missing table).
 *
 * @param {object} sql — a Bun.SQL tagged-template handle (async)
 * @returns {Promise<string[]>}
 */
export async function readTableNamesPg(sql) {
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema = current_schema()
      AND table_name <> '_scrml_migrations'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

/**
 * Read the actual schema from a LIVE Postgres database via `information_schema`
 * — the ASYNC Postgres sibling of the sync SQLite `readActualSchema`.
 *
 * Returns the SAME structure as readActualSchema, extended per column with
 * `unique` + `references`. Column `type` is the RAW Postgres `data_type` string;
 * emitScrmlSchemaSource maps it. Composite (multi-column) constraints are
 * SKIPPED with a W-INTROSPECT-COMPOSITE-CONSTRAINT-SKIPPED warning.
 *
 * When `opts.tableFilter` is set, only that table is read (the filter is pushed
 * into the `information_schema.tables` WHERE clause, PARAMETERIZED — never
 * string-interpolated) so warnings are naturally scoped to the requested table.
 *
 * @param {object} sql — a Bun.SQL tagged-template handle (async)
 * @param {{ tableFilter?: string|null }} [opts]
 * @returns {Promise<{ tables: Array<object>, warnings: string[] }>}
 */
export async function readActualSchemaPg(sql, opts = {}) {
  const tableFilter = opts.tableFilter ?? null;
  const warnings = [];
  const tables = [];

  const tableRows = tableFilter
    ? await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema = current_schema()
          AND table_name <> '_scrml_migrations'
          AND table_name = ${tableFilter}
        ORDER BY table_name
      `
    : await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema = current_schema()
          AND table_name <> '_scrml_migrations'
        ORDER BY table_name
      `;

  for (const t of tableRows) {
    const tableName = t.table_name;

    const columnRows = await sql`
      SELECT column_name, data_type, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;

    // PRIMARY KEY / UNIQUE columns. The kcu join is correlated on
    // constraint_name + table_schema + TABLE_NAME (Postgres constraint names
    // are unique per-table, NOT schema-global, so the table_name correlation
    // prevents a same-named constraint on another table from cross-contaminating).
    const pkUniqueRows = await sql`
      SELECT tc.constraint_type,
             tc.constraint_name AS constraint_name,
             kcu.column_name    AS column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema   = kcu.table_schema
       AND tc.table_name     = kcu.table_name
      WHERE tc.table_schema = current_schema()
        AND tc.table_name   = ${tableName}
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      ORDER BY tc.constraint_name, kcu.ordinal_position
    `;

    // FOREIGN KEY columns + targets. Uses referential_constraints so each child
    // column is paired with its parent column by POSITION
    // (kcu.position_in_unique_constraint = ccu.ordinal_position) — not
    // "first ccu row" (which mis-pairs / cross-contaminates). Correlated on
    // table_name as above.
    const fkRows = await sql`
      SELECT tc.constraint_name AS constraint_name,
             kcu.column_name    AS column_name,
             kcu.ordinal_position AS key_ordinal,
             ccu.table_name     AS foreign_table,
             ccu.column_name    AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema   = kcu.table_schema
       AND tc.table_name     = kcu.table_name
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name    = rc.constraint_name
       AND tc.constraint_schema  = rc.constraint_schema
      JOIN information_schema.key_column_usage ccu
        ON rc.unique_constraint_name   = ccu.constraint_name
       AND rc.unique_constraint_schema = ccu.constraint_schema
       AND kcu.position_in_unique_constraint = ccu.ordinal_position
      WHERE tc.table_schema = current_schema()
        AND tc.table_name   = ${tableName}
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.constraint_name, kcu.ordinal_position
    `;

    const pkCols = new Set();
    const uniqueCols = new Set();
    const fkByColumn = new Map();

    // PK/UNIQUE grouping — composite (>1 distinct column) is skipped + warned.
    const pkuGroups = new Map();
    for (const r of pkUniqueRows) {
      let g = pkuGroups.get(r.constraint_name);
      if (!g) { g = { type: r.constraint_type, columns: [] }; pkuGroups.set(r.constraint_name, g); }
      g.columns.push(r.column_name);
    }
    for (const [, g] of pkuGroups) {
      const cols = [...new Set(g.columns)];
      if (cols.length > 1) { pushCompositeSkip(warnings, tableName, g.type, cols); continue; }
      if (g.type === "PRIMARY KEY") pkCols.add(cols[0]);
      else uniqueCols.add(cols[0]);
    }

    // FK grouping — composite is skipped + warned; single-column keeps its
    // position-paired target.
    const fkGroups = new Map();
    for (const r of fkRows) {
      let g = fkGroups.get(r.constraint_name);
      if (!g) { g = { rows: [] }; fkGroups.set(r.constraint_name, g); }
      g.rows.push(r);
    }
    for (const [, g] of fkGroups) {
      const cols = [...new Set(g.rows.map((r) => r.column_name))];
      if (cols.length > 1) { pushCompositeSkip(warnings, tableName, "FOREIGN KEY", cols); continue; }
      const row = g.rows[0];
      fkByColumn.set(row.column_name, { table: row.foreign_table, column: row.foreign_column });
    }

    const columns = columnRows.map((c) => ({
      name: c.column_name,
      type: c.data_type || "text",       // RAW pg type; emitter maps it
      notNull: c.is_nullable === "NO",
      default: c.column_default ?? null,  // RAW pg default; emitter classifies it
      primaryKey: pkCols.has(c.column_name),
      unique: uniqueCols.has(c.column_name),
      references: fkByColumn.get(c.column_name) ?? null,
      // CHECK constraints are NOT recovered in v1 (readActualSchema punts too).
      sharedCorePredicates: [],
    }));

    tables.push({ name: tableName, columns });
  }

  return { tables, warnings };
}

/**
 * Render a resolved emit-model (tables → columns, all pieces already
 * representable) to scrml `<schema>` source text.
 */
function renderSchemaModel(model) {
  const lines = ["<schema>"];
  for (const table of model) {
    lines.push(`  ${table.name} {`);
    for (const col of table.columns) {
      const parts = [`${col.name}: ${col.scrmlType}`];
      if (col.primaryKey) parts.push("primary key");
      if (col.emittedNotNull) parts.push("not null");
      if (col.emittedUnique) parts.push("unique");
      if (col.references) parts.push(`references ${col.references.table}(${col.references.column})`);
      if (col.default !== null) parts.push(`default(${col.default})`);
      lines.push(`    ${parts.join(" ")}`);
    }
    lines.push("  }");
  }
  lines.push("</>");
  return lines.join("\n") + "\n";
}

function sameRef(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.table === b.table && a.column === b.column;
}

/**
 * Does a parsed column (from parseSchemaBlock) match the emit-model column
 * EXACTLY, in every representable field? (The emit-model already reflects PK
 * suppression, so emittedNotNull/emittedUnique are the tokens actually emitted.)
 */
function parsedColumnMatches(m, p) {
  return !!p
    && p.scrmlType === m.scrmlType
    && !!p.primaryKey === m.primaryKey
    && !!p.notNull === m.emittedNotNull
    && !!p.unique === m.emittedUnique
    && sameRef(p.references ?? null, m.references)
    && (p.default ?? null) === (m.default ?? null)
    && (p.sharedCorePredicates?.length ?? 0) === 0;
}

/**
 * Emit scrml `<schema>` SOURCE text from an actual-schema structure (as read by
 * readActualSchemaPg) — the source-emitting inverse of generateCreateTable.
 *
 * SELF-VERIFYING: the output is GUARANTEED to round-trip through parseSchemaBlock.
 * The pipeline is (1) build an emit-model applying the semantic guards
 * (identifier / type / composite / default classification), (2) per-field probe
 * every default + FK reference and drop any that does not round-trip in
 * isolation, (3) render, then (4) a whole-schema self-verify that re-parses the
 * rendered source and drops (one per bounded pass) any column/table that still
 * diverges. Every drop emits a W-INTROSPECT-* warning naming what + why.
 *
 * @param {{ tables: Array<object> }} actual
 * @param {{ tableFilter?: string|null }} [opts]
 * @returns {{ source: string, warnings: string[], emittedTables: string[], droppedCount: number }}
 */
export function emitScrmlSchemaSource(actual, opts = {}) {
  const warnings = [];
  let droppedCount = 0;
  const tableFilter = opts.tableFilter ?? null;
  const allTables = Array.isArray(actual?.tables) ? actual.tables : [];
  const filtered = tableFilter ? allTables.filter((t) => t.name === tableFilter) : allTables;

  // (1) Build the emit-model, applying the semantic guards.
  const model = [];
  for (const table of filtered) {
    if (!isRepresentableIdentifier(table.name)) {
      warnings.push(
        `W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE: table "${table.name}" has a name ` +
        `that is not a valid scrml identifier (letters/digits/underscore, ` +
        `non-digit leading char) — the whole table was skipped. Rename it, or ` +
        `map it by hand.`,
      );
      droppedCount++;
      continue;
    }
    const cols = [];
    for (const col of table.columns ?? []) {
      if (!isRepresentableIdentifier(col.name)) {
        warnings.push(
          `W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE: column "${table.name}.${col.name}" ` +
          `has a name that is not a valid scrml identifier — the column was ` +
          `skipped. Rename it, or map it by hand.`,
        );
        droppedCount++;
        continue;
      }
      const { scrmlType, unmapped } = mapPgTypeToScrml(col.type);
      if (unmapped) {
        warnings.push(
          `W-INTROSPECT-TYPE-UNMAPPED: column "${table.name}.${col.name}" has ` +
          `Postgres type "${col.type}" with no scrml column-type equivalent — ` +
          `emitted as \`text\`. Review and adjust if a tighter type applies.`,
        );
      }

      // FK reference — identifier-guarded here; self-verified below.
      let ref = null;
      if (col.references && col.references.table && col.references.column) {
        if (isRepresentableIdentifier(col.references.table) &&
            isRepresentableIdentifier(col.references.column)) {
          ref = { table: col.references.table, column: col.references.column };
        } else {
          warnings.push(
            `W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE: column "${table.name}.${col.name}" ` +
            `references "${col.references.table}(${col.references.column})", whose name ` +
            `is not a valid scrml identifier — the references clause was dropped.`,
          );
          droppedCount++;
        }
      }

      // Default — semantic classification here; self-verified below.
      let dflt = null;
      const cls = classifyPgDefault(col.default);
      if (cls.kind === "literal") {
        dflt = cls.value;
      } else if (cls.kind === "expression") {
        warnings.push(
          `W-INTROSPECT-DEFAULT-DROPPED: column "${table.name}.${col.name}" has a ` +
          `non-literal Postgres default \`${cls.value}\` — scrml <schema> ` +
          `default(...) is literal-only (SPEC §39), so it was dropped. Set this ` +
          `default in application code or a ?{} block.`,
        );
        droppedCount++;
      }
      // kind "none" (NULL) / "sequence" (nextval → serial) drop silently.

      cols.push({
        name: col.name,
        scrmlType,
        primaryKey: !!col.primaryKey,
        emittedNotNull: !!col.notNull && !col.primaryKey,
        emittedUnique: !!col.unique && !col.primaryKey,
        references: ref,
        default: dflt,
      });
    }
    model.push({ name: table.name, columns: cols });
  }

  // (2) Per-field self-verify probes — drop any default / reference that does
  // not round-trip in isolation (braces / newlines / in-string predicate names
  // in a literal; a predicate-named FK target).
  for (const table of model) {
    for (const col of table.columns) {
      if (col.default !== null && !defaultRoundTrips(col.scrmlType, col.default)) {
        warnings.push(
          `W-INTROSPECT-DEFAULT-DROPPED: column "${table.name}.${col.name}" default ` +
          `\`${col.default}\` does not round-trip through the scrml <schema> parser ` +
          `(reserved shape — brace / newline / parser-reserved token) — dropped.`,
        );
        col.default = null;
        droppedCount++;
      }
      if (col.references !== null && !referencesRoundTrips(col.references.table, col.references.column)) {
        warnings.push(
          `W-INTROSPECT-REFERENCE-DROPPED: column "${table.name}.${col.name}" reference ` +
          `to "${col.references.table}(${col.references.column})" does not round-trip ` +
          `(target name collides with a scrml schema predicate) — the references ` +
          `clause was dropped.`,
        );
        col.references = null;
        droppedCount++;
      }
    }
  }

  // (3) + (4) Render, then whole-schema self-verify: re-parse the rendered
  // source and drop (one per bounded pass) any column/table that still diverges
  // from the emit-model, until the source round-trips exactly. Belt over the
  // per-field probes — guarantees the INVARIANT even for a shape they missed.
  let source = renderSchemaModel(model);
  const totalCols = model.reduce((n, t) => n + t.columns.length, 0);
  for (let pass = 0; pass <= totalCols + 1; pass++) {
    const parsed = parseSchemaBlock(source);
    const parsedByName = new Map(parsed.tables.map((t) => [t.name, t]));
    let dropped = false;
    outer:
    for (const table of model) {
      const pt = parsedByName.get(table.name);
      if (!pt) {
        warnings.push(
          `W-INTROSPECT-TABLE-DROPPED: table "${table.name}" does not round-trip ` +
          `through the scrml <schema> parser — dropped.`,
        );
        model.splice(model.indexOf(table), 1);
        droppedCount++;
        dropped = true;
        break outer;
      }
      const pcByName = new Map(pt.columns.map((c) => [c.name, c]));
      for (const col of table.columns) {
        if (!parsedColumnMatches(col, pcByName.get(col.name))) {
          warnings.push(
            `W-INTROSPECT-COLUMN-DROPPED: column "${table.name}.${col.name}" does not ` +
            `round-trip through the scrml <schema> parser — dropped.`,
          );
          table.columns.splice(table.columns.indexOf(col), 1);
          droppedCount++;
          dropped = true;
          break outer;
        }
      }
    }
    if (!dropped) break;
    source = renderSchemaModel(model);
  }

  const emittedTables = model.filter((t) => t.columns.length > 0).map((t) => t.name);
  return { source, warnings, emittedTables, droppedCount };
}
