/**
 * Schema differ — computes migration SQL from desired vs actual database state.
 *
 * SPEC §38.6: reads desired state from < schema> AST, reads actual state from
 * SQLite PRAGMA table_info(), generates migration SQL.
 *
 * @module schema-differ
 */

/**
 * Parse a < schema> AST node into structured table declarations.
 *
 * @param {object} schemaNode — AST node with kind: "schema" and body text
 * @returns {{ tables: TableDecl[] }}
 */
export function parseSchemaBlock(schemaBody) {
  const tables = [];
  const text = typeof schemaBody === "string" ? schemaBody : (schemaBody?.body ?? "");

  // Match: tableName { ... }
  const tablePattern = /(\w+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = tablePattern.exec(text)) !== null) {
    const tableName = match[1];
    const columnsText = match[2];
    const columns = parseColumns(columnsText);
    tables.push({ name: tableName, columns });
  }

  return { tables };
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
    const columns = db.query(`PRAGMA table_info("${name}")`).all();
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
 * @param {{ driver?: "sqlite"|"postgres"|"mysql" }} [options]
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
        sql.push(`ALTER TABLE "${table.name}" RENAME COLUMN "${col.renameFrom}" TO "${col.name}";`);
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
        } else {
          // Needs 12-step rebuild
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
        // DROP COLUMN requires 12-step rebuild on older SQLite
        const rebuildSql = generate12StepRebuild(table, actualTable, driver);
        sql.push(...rebuildSql);
        break;
      }
    }
  }

  // 3. Dropped tables (in actual but not desired)
  for (const actualTable of actual.tables) {
    if (!desiredMap.has(actualTable.name)) {
      warnings.push(`W-SCHEMA-002: Dropping table "${actualTable.name}" — all data will be lost.`);
      sql.push(`DROP TABLE IF EXISTS "${actualTable.name}";`);
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
    let def = `"${col.name}" ${col.type}`;
    if (col.primaryKey) def += " PRIMARY KEY";

    // SQL-mirror NOT NULL OR shared-core req → NOT NULL.
    // Avoid duplicate NOT NULL when both forms present.
    const wantsNotNull = col.notNull || hasReqPredicate(col);
    if (wantsNotNull) def += " NOT NULL";

    if (col.unique) def += " UNIQUE";
    if (col.default !== null) def += ` DEFAULT (${col.default})`;
    if (col.references) def += ` REFERENCES "${col.references.table}"("${col.references.column}")`;

    // §39.5.8 shared-core lowering: append CHECK clauses (and the req empty-
    // string check for text/blob).
    const checkClauses = lowerSharedCoreToChecks(col, driver);
    for (const clause of checkClauses) {
      def += ` ${clause}`;
    }

    return "  " + def;
  });

  return `CREATE TABLE "${table.name}" (\n${colDefs.join(",\n")}\n);`;
}

/**
 * Generate ALTER TABLE ADD COLUMN SQL.
 */
function generateAddColumn(tableName, col, driver = "sqlite") {
  let def = `ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${col.type}`;

  // NOT NULL on ADD COLUMN requires a default (handled by the diff
  // canSimpleAdd guard). When both shared-core req and a default are present,
  // emit NOT NULL.
  const wantsNotNull = (col.notNull || hasReqPredicate(col)) && col.default !== null;
  if (wantsNotNull) def += " NOT NULL";

  if (col.unique) def += " UNIQUE";
  if (col.default !== null) def += ` DEFAULT (${col.default})`;
  if (col.references) def += ` REFERENCES "${col.references.table}"("${col.references.column}")`;

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
  const quotedCol = `"${colName}"`;

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
      return `"${renames.get(name)}" AS "${name}"`;
    }
    if (actualCols.has(name)) {
      return `"${name}"`;
    }
    // New column — use default or NULL
    const col = desiredTable.columns.find(c => c.name === name);
    if (col?.default !== null) {
      return `${col.default} AS "${name}"`;
    }
    return `NULL AS "${name}"`;
  });

  lines.push(`INSERT INTO "${tmpName}" (${desiredCols.map(n => `"${n}"`).join(", ")}) SELECT ${selectCols.join(", ")} FROM "${desiredTable.name}";`);

  // 3. Drop old table
  lines.push(`DROP TABLE "${desiredTable.name}";`);

  // 4. Rename temp to final
  lines.push(`ALTER TABLE "${tmpName}" RENAME TO "${desiredTable.name}";`);

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
