/**
 * protect= Analyzer — Stage 4 of the scrml compiler pipeline (PA).
 *
 * Input:  { files: FileAST[] }
 * Output: { protectAnalysis: ProtectAnalysis, errors: PAError[] }
 *
 * ProtectAnalysis = {
 *   views: Map<StateBlockId, DBTypeViews>,
 * }
 *
 * DBTypeViews = {
 *   stateBlockId: StateBlockId,
 *   dbPath: string,              // resolved canonical absolute path
 *   tables: Map<string, TableTypeView>,
 * }
 *
 * TableTypeView = {
 *   tableName: string,
 *   fullSchema: ColumnDef[],
 *   clientSchema: ColumnDef[],
 *   protectedFields: Set<string>,
 * }
 *
 * ColumnDef = {
 *   name: string,
 *   sqlType: string,
 *   nullable: boolean,
 *   isPrimaryKey: boolean,
 * }
 *
 * StateBlockId = "{filePath}::{span.start}"
 *   filePath  — FileAST.filePath (already canonical absolute, set by pipeline coordinator)
 *   span.start — character offset of the opening '<' in preprocessed source
 *
 * Error codes produced:
 *   E-PA-001  src= file does not exist AND no CREATE TABLE statements found in ?{} blocks
 *             (legacy name retained; in practice E-PA-002 supersedes it for the missing-file case
 *              when ?{} blocks are present; E-PA-001 fires when no recovery is possible at all)
 *   E-PA-002  src= file does not exist and one or more tables= names have no CREATE TABLE
 *             statement in any ?{} block in the same file
 *   E-PA-003  Bun SQLite schema introspection failed
 *   E-PA-004  tables= references a table not found in the database
 *   E-PA-005  tables= absent or its parsed value is empty
 *   E-PA-006  src= absent from a <db> block
 *   E-PA-007  protect= field matches no column in any listed table (security error)
 *
 * Shadow DB:
 *   When the real DB file is missing but CREATE TABLE statements for all needed tables
 *   are found in ?{} SQL nodes in the same file, PA builds an in-memory SQLite database,
 *   runs the PRAGMA introspection against it, then discards it after PA completes. The
 *   compiler never writes to the real DB path.
 *
 * What PA does NOT do:
 *   - No SQL query execution or validation.
 *   - No route assignment (RI's concern).
 *   - No scope analysis (TS's concern).
 *   - No ColumnDef[] → named-type translation (TS's concern).
 *   - No mutation of the input AST.
 */

import { Database } from "bun:sqlite";
import { resolve, dirname } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import type { Span, AttrNode, ASTNode, StateNode } from "./types/ast.ts";

// ---------------------------------------------------------------------------
// PA-internal types
// ---------------------------------------------------------------------------

/** A single column from PRAGMA table_info(). */
export interface ColumnDef {
  name: string;
  sqlType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

/** The view of a single table: full schema, client-safe schema, protected fields. */
export interface TableTypeView {
  tableName: string;
  fullSchema: ColumnDef[];
  clientSchema: ColumnDef[];
  protectedFields: Set<string>;
}

/** All table views for one < db> block. */
export interface DBTypeViews {
  stateBlockId: string;
  dbPath: string;
  tables: Map<string, TableTypeView>;
}

/** The output of the PA stage. */
export interface ProtectAnalysis {
  views: Map<string, DBTypeViews>;
}

/**
 * PA accepts either a raw FileAST (unit tests) or a TABResult-shaped object
 * where the FileAST is nested under `.ast`. We preserve the JS duck-typing
 * with a loose input shape.
 */
interface PAFileInput {
  filePath: string;
  /** Flat shape (FileAST directly). */
  nodes?: ASTNode[];
  /** TABResult shape — FileAST is nested. */
  ast?: { nodes: ASTNode[] };
}

interface PAInput {
  files: PAFileInput[];
}

interface PAPragmaRow {
  name: string;
  type: string | null;
  notnull: number;
  pk: number;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class PAError {
  code: string;
  message: string;
  span: Span;

  constructor(code: string, message: string, span: Span) {
    this.code = code;
    this.message = message;
    this.span = span;
  }
}

// ---------------------------------------------------------------------------
// ASCII whitespace set per §11.1.1 and §4.10.1
//   U+0020 space, U+0009 HT, U+000A LF, U+000D CR, U+000C FF
// ---------------------------------------------------------------------------

const ASCII_WS = new Set(["\u0020", "\u0009", "\u000A", "\u000D", "\u000C"]);

/**
 * Trim only the five canonical ASCII whitespace codepoints from both ends of
 * a string, as specified in §11.1.1 steps 1 and 3.
 *
 * JavaScript's String.prototype.trim() additionally strips other Unicode
 * whitespace. We must use this narrow implementation to be spec-compliant.
 */
function trimAsciiWS(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && ASCII_WS.has(s[start])) start++;
  while (end > start && ASCII_WS.has(s[end - 1])) end--;
  return s.slice(start, end);
}

/**
 * Canonical four-step parse algorithm from §11.1.1.
 * Applies identically to protect= and tables= attribute values.
 *
 * 1. Trim ASCII whitespace from the whole string.
 * 2. Split on the literal ',' character.
 * 3. Trim ASCII whitespace from each token.
 * 4. Discard empty tokens.
 */
function parseCommaList(raw: string): string[] {
  // Step 1: trim the whole value.
  const trimmed = trimAsciiWS(raw);
  // Step 2: split on ','.
  const parts = trimmed.split(",");
  // Step 3+4: trim each token, discard empty results.
  const result: string[] = [];
  for (const part of parts) {
    const tok = trimAsciiWS(part);
    if (tok.length > 0) result.push(tok);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Driver URI detection (§44.2)
// ---------------------------------------------------------------------------

/**
 * Test whether a `<db src=>` value is a PostgreSQL connection URI. Recognizes
 * both `postgres://` and `postgresql://` per SPEC §44.2.
 *
 * For Postgres URIs the protect-analyzer skips file-existence checking and
 * routes directly to shadow-DB construction (CREATE TABLE statements harvested
 * from ?{} blocks). The shadow DB itself still uses bun:sqlite — Phase 2 does
 * NOT add a real Postgres connection at compile time. That is Phase 2.5.
 *
 * MySQL URIs (`mysql://`) get the same treatment for symmetry; full support
 * lands in Phase 3.
 */
function isPostgresUri(s: string): boolean {
  return s.startsWith("postgres://") || s.startsWith("postgresql://");
}

function isMysqlUri(s: string): boolean {
  return s.startsWith("mysql://");
}

/**
 * Test whether a `<db src=>` value is a non-filesystem driver URI that should
 * skip file resolution.
 */
function isDriverUri(s: string): boolean {
  return isPostgresUri(s) || isMysqlUri(s);
}

// ---------------------------------------------------------------------------
// SQLite schema introspection
// ---------------------------------------------------------------------------

/**
 * Open a SQLite database and read the full schema for a named table using
 * PRAGMA table_info().
 *
 * Returns null (and populates errors) if opening or introspection fails.
 *
 * PRAGMA table_info() returns rows with columns:
 *   cid, name, type, notnull, dflt_value, pk
 *
 * We map this to ColumnDef[]:
 *   name       — column name
 *   sqlType    — the declared type string (may be empty for untyped columns)
 *   nullable   — true when notnull === 0 (i.e. the column allows NULL)
 *   isPrimaryKey — true when pk > 0 (composite PKs are each individually flagged)
 */
function readTableSchema(
  db: Database,
  tableName: string,
  blockSpan: Span,
  errors: PAError[],
): ColumnDef[] | null {
  let rows: PAPragmaRow[];
  try {
    // PRAGMA table_info() returns an empty result set (zero rows) when the
    // table does not exist — it does not throw.
    rows = db.query(`PRAGMA table_info(${JSON.stringify(tableName)})`).all() as PAPragmaRow[];
  } catch (err) {
    errors.push(new PAError(
      "E-PA-003",
      `E-PA-003: SQLite schema introspection failed for table \`${tableName}\`: ${(err as Error).message}`,
      blockSpan,
    ));
    return null;
  }

  if (rows.length === 0) {
    // E-PA-004: table not found in the database.
    errors.push(new PAError(
      "E-PA-004",
      `E-PA-004: Table \`${tableName}\` was not found in the database. ` +
      `Verify the table name is correct and the database file is up to date.`,
      blockSpan,
    ));
    return null;
  }

  return rows.map((row) => ({
    name: row.name,
    sqlType: row.type ?? "",
    nullable: row.notnull === 0,
    isPrimaryKey: row.pk > 0,
  }));
}

// ---------------------------------------------------------------------------
// Schema cache: one open per unique dbPath (I/O deduplication per PIPELINE §4)
// ---------------------------------------------------------------------------

/**
 * Lightweight schema cache. Keyed by resolved dbPath. Each entry is either an
 * open Database for a successful open, or null indicating the database failed
 * to open (E-PA-001 / E-PA-002 / E-PA-003).
 *
 * The cache lives for the lifetime of a single runPA() call (not module-level)
 * so that tests remain isolated without any explicit teardown.
 */
class SchemaCache {
  private _dbs: Map<string, Database | null>;

  constructor() {
    this._dbs = new Map();
  }

  /**
   * Return an open Database for dbPath, or null if it cannot be opened.
   * Emits E-PA-003 on failure; subsequent calls for the same path return
   * null silently (error already recorded).
   *
   * NOTE: This method assumes the file exists. Callers should use resolveDb()
   * which handles the "file missing" case by checking for shadow DB eligibility.
   */
  openDb(dbPath: string, blockSpan: Span, errors: PAError[]): Database | null {
    if (this._dbs.has(dbPath)) return this._dbs.get(dbPath)!;

    let db: Database;
    try {
      // Open read-only. Bun SQLite flag 0x00000001 = SQLITE_OPEN_READONLY.
      db = new Database(dbPath, { readonly: true });
    } catch (err) {
      errors.push(new PAError(
        "E-PA-003",
        `E-PA-003: Failed to open SQLite database at \`${dbPath}\`: ${(err as Error).message}`,
        blockSpan,
      ));
      this._dbs.set(dbPath, null);
      return null;
    }

    this._dbs.set(dbPath, db);
    return db;
  }

  /**
   * Build an in-memory SQLite database from the provided CREATE TABLE statements
   * and cache it under dbPath (so the same shadow DB is reused across multiple
   * < db> blocks pointing to the same nonexistent file).
   *
   * Emits E-PA-003 if any CREATE TABLE statement fails to execute.
   * Returns the in-memory Database on success, or null on failure.
   */
  openShadowDb(
    dbPath: string,
    createStatements: string[],
    blockSpan: Span,
    errors: PAError[],
  ): Database | null {
    if (this._dbs.has(dbPath)) return this._dbs.get(dbPath)!;

    let db: Database;
    try {
      db = new Database(":memory:");
    } catch (err) {
      errors.push(new PAError(
        "E-PA-003",
        `E-PA-003: Failed to create in-memory SQLite database for shadow schema: ${(err as Error).message}`,
        blockSpan,
      ));
      this._dbs.set(dbPath, null);
      return null;
    }

    for (const stmt of createStatements) {
      try {
        db.run(stmt);
      } catch (err) {
        errors.push(new PAError(
          "E-PA-003",
          `E-PA-003: Failed to execute CREATE TABLE statement in shadow database: ${(err as Error).message}. ` +
          `Statement: ${stmt.slice(0, 120)}`,
          blockSpan,
        ));
        try { db.close(); } catch { /* ignore */ }
        this._dbs.set(dbPath, null);
        return null;
      }
    }

    this._dbs.set(dbPath, db);
    return db;
  }

  /** Close all open connections. Call at the end of runPA(). */
  closeAll(): void {
    for (const db of this._dbs.values()) {
      if (db !== null) {
        try { db.close(); } catch { /* ignore close errors */ }
      }
    }
    this._dbs.clear();
  }
}

// ---------------------------------------------------------------------------
// CREATE TABLE extraction from ?{} SQL nodes
// ---------------------------------------------------------------------------

/**
 * Regex that matches CREATE TABLE (with or without IF NOT EXISTS) statements.
 * Captures:
 *   group 1 — table name (may be quoted with backtick, double-quote, or single-quote)
 *   group 2 — column definitions body (the content between the outer parens)
 *
 * Limitations: does not handle arbitrarily nested subexpressions. Sufficient
 * for the common case of a flat CREATE TABLE as written in ?{} blocks.
 */
const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`']?(\w+)["`']?\s*\(([^)]+(?:\([^)]*\)[^)]*)*)\)/gi;

/**
 * Walk ALL AST nodes depth-first and collect CREATE TABLE statements from
 * `kind === "sql"` nodes. Returns a Map<tableName (lowercased), fullStatement>.
 *
 * The map is keyed by lowercase table name for case-insensitive lookup against
 * the tables= attribute value.
 */
function extractCreateTableStatements(nodes: ASTNode[]): Map<string, string> {
  const result = new Map<string, string>();

  // Generic depth-first walk over the AST. A `?{}` SQL node (`kind === "sql"`)
  // can appear in MANY positions — not only as a markup `children` entry, but
  // under `body` (a top-level `${...}` logic block's `body`, a `function`/`fn`
  // declaration's `body`), `consequent` / `alternate` (`if`), `arms` (`match`),
  // and so on. The prior recursion descended ONLY `children`, so a CREATE TABLE
  // written in a startup `?{}` block inside a function — or even a bare
  // top-level `${ ?{ CREATE TABLE … } }` — was invisible to the scanner, and
  // E-PA-002 fired spuriously while the diagnostic's own message told the
  // adopter to "add a CREATE TABLE statement in a `?{}` block" (R28-4).
  //
  // We therefore visit every enumerable child-bearing field, skipping `span`
  // and `_`-prefixed annotation / back-reference fields (`_scope`, `_record`,
  // etc., which can introduce cycles) and capping depth defensively.
  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.kind === "sql" && typeof node.query === "string") {
      // Reset lastIndex before each exec to avoid stateful regex issues.
      CREATE_TABLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CREATE_TABLE_RE.exec(node.query as string)) !== null) {
        // Store the full match (the entire CREATE TABLE ... (...) substring).
        result.set(m[1].toLowerCase(), m[0]);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      visit(node[key], depth + 1);
    }
  };

  visit(nodes, 0);
  return result;
}

// ---------------------------------------------------------------------------
// DB resolution helper (real file vs shadow)
// ---------------------------------------------------------------------------

/**
 * Resolve a database handle for the given dbPath. Tries the following in order:
 *
 * 1. If the real file exists → open it read-only via SchemaCache.openDb().
 * 2. If the file does NOT exist:
 *    a. Check createTableMap for all tableNames (case-insensitive).
 *    b. If ALL tables have CREATE TABLE statements → build shadow DB via
 *       SchemaCache.openShadowDb(), emit an info note to stderr, return db.
 *    c. If ANY table is missing a CREATE TABLE statement → emit E-PA-002,
 *       return null.
 */
function resolveDb(
  dbPath: string,
  tableNames: string[],
  createTableMap: Map<string, string>,
  cache: SchemaCache,
  blockSpan: Span,
  errors: PAError[],
  srcIsDriverUri: boolean = false,
): Database | null {
  // Driver URI (postgres:// / mysql://) — skip the filesystem check entirely.
  // Schema validation at compile time happens via the shadow-DB path. Real
  // driver introspection is deferred to a later phase.
  if (!srcIsDriverUri && existsSync(dbPath)) {
    return cache.openDb(dbPath, blockSpan, errors);
  }

  // File is missing OR src= is a driver URI. Check shadow DB eligibility.
  const missingTables: string[] = [];
  const createStmts: string[] = [];

  for (const tableName of tableNames) {
    const key = tableName.toLowerCase();
    const stmt = createTableMap.get(key);
    if (stmt === undefined) {
      missingTables.push(tableName);
    } else {
      createStmts.push(stmt);
    }
  }

  if (missingTables.length > 0) {
    // E-PA-002: cannot build shadow DB — missing CREATE TABLE for at least one table.
    const missingList = missingTables.join(", ");
    const tableWord = missingTables.length === 1 ? "table" : "tables";
    const what = srcIsDriverUri
      ? `Driver URI \`${dbPath}\` cannot be introspected at compile time yet (Phase 2)`
      : `Database file \`${dbPath}\` does not exist`;
    errors.push(new PAError(
      "E-PA-002",
      `E-PA-002: ${what} and no CREATE TABLE statement ` +
      `was found in any \`?{}\` block for ${tableWord} \`${missingList}\`. ` +
      (srcIsDriverUri
        ? `Add a CREATE TABLE statement (e.g. in a startup \`?{}\` block) so the compiler ` +
          `can validate the schema. Real Postgres / MySQL introspection lands in a future phase.`
        : `Either create the database file first, or add a CREATE TABLE statement in a \`?{}\` ` +
          `block so the compiler can validate the schema at compile time.`),
      blockSpan,
    ));
    return null;
  }

  // All tables have CREATE TABLE statements. Build shadow DB.
  const what = srcIsDriverUri ? `Driver URI '${dbPath}'` : `Database file '${dbPath}' does not exist`;
  process.stderr.write(
    `Note(PA): ${what}. ` +
    `Using in-memory schema from ?{} blocks for compile-time validation.\n`,
  );

  return cache.openShadowDb(dbPath, createStmts, blockSpan, errors);
}

// ---------------------------------------------------------------------------
// State block walker
// ---------------------------------------------------------------------------

/**
 * Walk an AST node tree (depth-first) and collect all StateNode nodes
 * where stateType === 'db'.
 */
function collectDbBlocks(nodes: ASTNode[]): StateNode[] {
  const result: StateNode[] = [];
  for (const node of nodes) {
    if (!node) continue;
    if (node.kind === "state" && node.stateType === "db") {
      result.push(node as StateNode);
    }
    // Recurse into children for markup and state nodes.
    if ("children" in node && node.children && node.children.length > 0) {
      result.push(...collectDbBlocks(node.children));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Attribute lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find an attribute by name in an AttrNode[] array.
 * Returns the AttrNode or undefined.
 */
function findAttr(attrs: AttrNode[], name: string): AttrNode | undefined {
  return attrs.find((a) => a.name === name);
}

/**
 * Extract the string value from a 'string-literal' AttrValue.
 * Returns null if the attribute is absent or its value is not a string-literal.
 *
 * PA's input invariant (enforced by TAB/E-ATTR-001) guarantees that all
 * attribute values on < db> blocks that reached PA are string-literals. We
 * still check defensively and return null on any unexpected shape rather than
 * throwing.
 */
function attrStringValue(attrNode: AttrNode | undefined): string | null {
  if (!attrNode) return null;
  if (attrNode.value && attrNode.value.kind === "string-literal") {
    return attrNode.value.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the protect= Analyzer (PA, Stage 4).
 */
export function runPA(input: PAInput): { protectAnalysis: ProtectAnalysis; errors: PAError[] } {
  const { files } = input;

  const views = new Map<string, DBTypeViews>();
  const errors: PAError[] = [];
  const cache = new SchemaCache();

  try {
    for (const fileAST of files) {
      const filePath = fileAST.filePath; // canonical absolute — set by pipeline coordinator
      const nodes: ASTNode[] = fileAST.ast
        ? fileAST.ast.nodes                // { filePath, ast: { nodes }, ... } shape
        : (fileAST.nodes ?? []);           // { filePath, nodes, ... } flat shape

      // Extract CREATE TABLE statements from ?{} SQL nodes before processing
      // < db> blocks. These statements are used to build a shadow in-memory DB
      // when the real DB file does not exist yet.
      const createTableMap = extractCreateTableStatements(nodes);

      const dbBlocks = collectDbBlocks(nodes);

      for (const block of dbBlocks) {
        processDbBlock(block, filePath, cache, views, errors, createTableMap);
      }
    }
  } finally {
    cache.closeAll();
  }

  return {
    protectAnalysis: { views },
    errors,
  };
}

// ---------------------------------------------------------------------------
// Per-block processing (Steps 1–11 from PIPELINE.md §Stage 4 Transformation)
// ---------------------------------------------------------------------------

/**
 * Process a single < db> state block through the full PA transformation.
 * Emits errors and, on success, inserts a DBTypeViews entry into views.
 */
function processDbBlock(
  block: StateNode,
  filePath: string,
  cache: SchemaCache,
  views: Map<string, DBTypeViews>,
  errors: PAError[],
  createTableMap: Map<string, string>,
): void {
  const blockSpan = block.span;

  // ------------------------------------------------------------------
  // Step 1: Verify src= is present. Emit E-PA-006 and skip if absent.
  // ------------------------------------------------------------------
  const srcAttr = findAttr(block.attrs, "src");
  const srcRaw = attrStringValue(srcAttr);

  if (srcRaw === null) {
    errors.push(new PAError(
      "E-PA-006",
      `E-PA-006: The \`< db>\` state block is missing the required \`src=\` attribute. ` +
      `Specify the path to the SQLite database file, e.g. \`src="path/to/db.sqlite"\`.`,
      blockSpan,
    ));
    return;
  }

  // ------------------------------------------------------------------
  // Step 2: Resolve src= against the source file's directory to get the
  //         canonical absolute dbPath.
  //
  // §44.2: when src= is a Postgres or MySQL connection URI we skip filesystem
  // resolution entirely. The URI itself becomes the cache key. Schema
  // introspection routes through the shadow-DB path (CREATE TABLE harvested
  // from ?{} blocks). Real driver introspection at compile time is deferred
  // to a future phase.
  // ------------------------------------------------------------------
  let dbPath: string;
  const isDriverConnectionUri = isDriverUri(srcRaw);

  if (isDriverConnectionUri) {
    // Use the URI verbatim as the cache key — no path resolution.
    dbPath = srcRaw;
  } else {
    const sourceDir = dirname(filePath);
    const resolvedRaw = resolve(sourceDir, srcRaw);

    // realpathSync resolves symlinks to a canonical path. We only call it if
    // the file exists; if it doesn't exist, resolveDb() handles the missing case.
    try {
      dbPath = existsSync(resolvedRaw) ? realpathSync(resolvedRaw) : resolvedRaw;
    } catch {
      dbPath = resolvedRaw;
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Verify tables= is present. Emit E-PA-005 and skip if absent.
  // ------------------------------------------------------------------
  const tablesAttr = findAttr(block.attrs, "tables");
  const tablesRaw = attrStringValue(tablesAttr);

  if (tablesRaw === null) {
    errors.push(new PAError(
      "E-PA-005",
      `E-PA-005: The \`< db>\` state block is missing the required \`tables=\` attribute. ` +
      `Specify which tables to bring into scope, e.g. \`tables="users"\`.`,
      blockSpan,
    ));
    return;
  }

  // ------------------------------------------------------------------
  // Step 4: Parse tables= to get table names early (needed for resolveDb).
  // An empty parsed table list is equivalent to absent tables= (E-PA-005).
  // ------------------------------------------------------------------
  const tableNames = parseCommaList(tablesRaw);

  if (tableNames.length === 0) {
    errors.push(new PAError(
      "E-PA-005",
      `E-PA-005: The \`tables=\` attribute on the \`< db>\` block produced an empty table name list ` +
      `after parsing (value: \`"${tablesRaw}"\`). Provide at least one valid table name.`,
      blockSpan,
    ));
    return;
  }

  // ------------------------------------------------------------------
  // Step 5: Open the database (real file or shadow in-memory).
  // resolveDb() handles:
  //   - real file exists → open readonly
  //   - file missing + CREATE TABLE in ?{} blocks → shadow DB
  //   - file missing + no CREATE TABLE → E-PA-002
  //   - driver URI (postgres:// / mysql://) → forced shadow DB; no file check
  // ------------------------------------------------------------------
  const db = resolveDb(dbPath, tableNames, createTableMap, cache, blockSpan, errors, isDriverConnectionUri);
  if (db === null) return;

  // ------------------------------------------------------------------
  // Step 6: Read the full schema for each named table.
  // E-PA-003 / E-PA-004 are emitted by readTableSchema on failure.
  // Accumulate errors for all tables before bailing — this gives the
  // developer a complete picture rather than one error at a time.
  // ------------------------------------------------------------------

  const tableSchemas = new Map<string, ColumnDef[]>();
  let anyTableFailed = false;

  for (const tableName of tableNames) {
    const schema = readTableSchema(db, tableName, blockSpan, errors);
    if (schema === null) {
      anyTableFailed = true;
    } else {
      tableSchemas.set(tableName, schema);
    }
  }

  if (anyTableFailed) {
    // One or more required tables could not be read. Skip this block.
    return;
  }

  // ------------------------------------------------------------------
  // Step 7: Apply canonical parse algorithm to protect= value (if present).
  // An absent or empty protect= produces the empty candidate list.
  // ------------------------------------------------------------------
  const protectAttr = findAttr(block.attrs, "protect");
  const protectRaw = attrStringValue(protectAttr); // null if absent

  const candidateFields = protectRaw !== null ? parseCommaList(protectRaw) : [];

  // ------------------------------------------------------------------
  // Step 8: Validate every candidate protect= field name against the
  // combined column set across all tables (E-PA-007).
  // ------------------------------------------------------------------

  // Build a fast lookup: column name → set of tables that contain it.
  const columnToTables = new Map<string, Set<string>>();
  for (const [tableName, cols] of tableSchemas) {
    for (const col of cols) {
      if (!columnToTables.has(col.name)) columnToTables.set(col.name, new Set());
      columnToTables.get(col.name)!.add(tableName);
    }
  }

  let anyFieldError = false;
  for (const field of candidateFields) {
    if (!columnToTables.has(field)) {
      // E-PA-007: field name does not match any column in any table.
      // Build a sorted, deduplicated list of all available column names across
      // all tables to help the developer identify the typo.
      const allColumns = [...columnToTables.keys()].sort();
      const tableList = tableNames.join(", ");
      errors.push(new PAError(
        "E-PA-007",
        `E-PA-007: Field name \`${field}\` in \`protect=\` does not match any column in ` +
        `table${tableNames.length === 1 ? "" : "s"} \`${tableList}\`. ` +
        `Available columns: ${allColumns.join(", ")}.`,
        blockSpan,
      ));
      anyFieldError = true;
    }
  }

  if (anyFieldError) {
    // Security requirement: a protect= typo is a hard compile error.
    // The block gets no views entry.
    return;
  }

  // ------------------------------------------------------------------
  // Step 9: For each table, construct fullSchema and clientSchema.
  // Per-table protectedFields is the subset of candidateFields whose name
  // matches a column in that specific table.
  // ------------------------------------------------------------------

  const tableViews = new Map<string, TableTypeView>();

  for (const [tableName, cols] of tableSchemas) {
    const protectedFields = new Set(
      candidateFields.filter((f) => cols.some((c) => c.name === f)),
    );

    const fullSchema = cols; // ColumnDef[] — all columns
    const clientSchema = cols.filter((c) => !protectedFields.has(c.name));

    tableViews.set(tableName, {
      tableName,
      fullSchema,
      clientSchema,
      protectedFields,
    });
  }

  // ------------------------------------------------------------------
  // Step 10: Construct StateBlockId.
  // Format: "{FileAST.filePath}::{block.span.start}"
  // filePath is the canonical absolute path already present in FileAST.
  // span.start is the character offset of the opening '<'.
  // ------------------------------------------------------------------
  const stateBlockId = `${filePath}::${blockSpan.start}`;

  // ------------------------------------------------------------------
  // Step 11: Store DBTypeViews under the StateBlockId key.
  // ------------------------------------------------------------------
  views.set(stateBlockId, {
    stateBlockId,
    dbPath,
    tables: tableViews,
  });
}
