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

import { Database, constants as sqliteConstants } from "bun:sqlite";
import { resolve, dirname } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import type { Span, AttrNode, ASTNode, StateNode } from "./types/ast.ts";
import { redactDbUri } from "./db-uri-redact.ts";
import { classifyDbTarget, type DbTargetClass } from "./db-target.ts";
import {
  parseSchemaBlock,
  generateCreateTable,
  // THE ONE `CREATE TABLE` RECOGNIZER, and it lives in schema-differ.js on
  // purpose. Line 631 below records that this early PA stage deliberately does
  // not pull a codegen module; the mirror of that invariant is that consumers
  // of the recognizer must not be forced to pull THIS module (and with it
  // `bun:sqlite` + `node:fs`) just to ask what counts as a table declaration.
  // `schema-differ.js` is the `< schema>` parser and imports nothing but
  // `sql-ident.ts`, so both security floors and the GCP1 checks read it freely.
  harvestCreateTables,
  harvestRawCreateTables,
} from "./schema-differ.js";

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
  /**
   * Where `Note(PA):` lines go. Default: stderr. `compileScrml` passes a sink
   * that runs each note through the compile unit's secret redactor (the
   * s430-dev-db-stub output chokepoint) before it reaches the terminal.
   */
  onNote?: (line: string) => void;
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
 * Classification goes through the ONE shared classifier (`db-target.ts`, also
 * behind codegen's `resolveDbDriver`) — s430-dev-db-stub R2-1. It accepts
 * exactly what codegen accepts (case-sensitive driver prefixes, trimmed).
 *
 *  - "driver":      postgres / mysql — skip the filesystem, shadow-DB path.
 *  - "unsupported": any other `scheme://` shape (Mongo, a typo'd or
 *                   upper-case scheme — what codegen rejects as E-SQL-005).
 *                   It is NOT a file either: same shadow / E-PA-002 flow as a
 *                   driver URI, but reported as an unsupported target, never as
 *                   a driver and never as a resolved file path.
 *  - "file":        `sqlite:` (prefix stripped to its path — SPEC §8.1.1) or a
 *                   bare path.
 */
type SrcTargetKind = "driver" | "unsupported" | "file";

function srcTargetKind(cls: DbTargetClass): SrcTargetKind {
  if (cls.kind === "postgres" || cls.kind === "mysql") return "driver";
  if (cls.kind === "mongo" || cls.kind === "unsupported-scheme") return "unsupported";
  return "file";
}

// ---------------------------------------------------------------------------
// SQLite schema introspection
// ---------------------------------------------------------------------------

/**
 * What an E-PA-004 says about the database it read. `where` completes the
 * sentence "Table `t` was not found in …"; `detail` is zero or more whole
 * sentences (each ending in a space) appended after it.
 */
interface DbSourceDescription {
  where: string;
  detail: string;
}

/** Where a shadow (in-memory) schema's tables come from — both sources feed createTableMap. */
const SHADOW_WHERE =
  "the in-memory schema built from this file's `CREATE TABLE` declarations " +
  "(its `?{}` blocks and its `<schema>` block)";

/**
 * Describe the database a `< db>` block's schema was read from, for E-PA-004.
 *
 *  - A real file: its resolved absolute path, the `src=` it was resolved from
 *    and the directory it was resolved against. When the database holds NO
 *    tables at all it is called out explicitly (front-loaded "EMPTY") with its
 *    byte size and how such stubs arise.
 *  - The shadow schema (file absent, or a driver URI): says so. A driver URI is
 *    NOT echoed — it can carry credentials.
 *
 * Empty detection (s430-dev-db-stub F5) asks SQLite, not the byte size. Measured
 * on bun:sqlite: a 0- or 1-byte file opens as an empty database, while ANY
 * other non-database file of 2+ bytes (zero-filled or not, up to and past 512)
 * fails to open with "file is not a database" — E-PA-003, never E-PA-004. A
 * real database file with no tables (e.g. 4096 bytes after `PRAGMA
 * journal_mode=WAL`) is just as empty. So "has no tables" is the true
 * predicate; `sqlite_master` answers it for every case (user tables AND views,
 * not SQLite's own `sqlite_*` bookkeeping tables — R2-5).
 *
 * Exported for unit tests.
 */
export function describeDbSource(
  dbPath: string,
  srcRaw: string,
  sourceDir: string,
  isDriverUri: boolean,
  db: Database | null = null,
  isUnsupportedTarget: boolean = false,
): DbSourceDescription {
  if (isUnsupportedTarget) {
    return {
      where: SHADOW_WHERE,
      detail: "The `src=` value has a URI scheme no `?{}` driver accepts (see E-SQL-005); it is not a " +
        "file and is not introspected. ",
    };
  }
  if (isDriverUri) {
    return {
      where: SHADOW_WHERE,
      detail: "A driver-URI `src=` is not introspected at compile time. ",
    };
  }
  if (!existsSync(dbPath)) {
    return {
      where: SHADOW_WHERE,
      detail: `The database file \`${dbPath}\` does not exist, so it was not read. `,
    };
  }
  let size = -1;
  try { size = statSync(dbPath).size; } catch { /* size stays unknown */ }
  let tableCount = -1;
  if (db !== null) {
    try {
      // R2-5: USER objects only — tables AND views, excluding SQLite's own
      // `sqlite_*` bookkeeping (`sqlite_sequence`, `sqlite_stat1`, ...). A
      // views-only database is not empty; one holding only sqlite_* tables is.
      const row = db.query(
        "SELECT count(*) AS n FROM sqlite_master " +
        "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
      ).get() as { n: number } | null;
      if (row) tableCount = row.n;
    } catch { /* count stays unknown */ }
  }
  const isEmpty = tableCount === 0;
  const sizeText = size === 0 ? "zero bytes" : size === 1 ? "1 byte" : `${size} bytes`;
  const emptyDetail = isEmpty
    ? `That database is EMPTY — it has no tables or views at all (the file is ${sizeText}). An empty ` +
      `database is usually a stub created as a side effect when some other process (for ` +
      `example a running server that resolves the same relative path from a different ` +
      `working directory) opened this path before a real database existed there. If your ` +
      `real database lives elsewhere, delete this file and point \`src=\` at the real one. `
    : "";
  return {
    // "EMPTY" (and "ZERO-BYTE") is front-loaded ahead of the (possibly long)
    // path: `scrml dev` and `scrml build` print only the first 120 characters.
    where:
      `the ${isEmpty ? (size === 0 ? "EMPTY (ZERO-BYTE) " : "EMPTY ") : ""}database \`${dbPath}\` ` +
      `(\`src="${srcRaw}"\` resolved against the source file's directory \`${sourceDir}\`)`,
    detail: emptyDetail,
  };
}

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
  describeSource: () => DbSourceDescription = () => ({ where: "the database", detail: "" }),
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
    // E-PA-004: table not found in the database. The message names WHICH
    // database was read (s430-dev-db-stub): an adopter whose relative `src=`
    // resolved to a different file than they meant — or to a zero-byte stub
    // some other process created — could not tell from "the database" alone.
    const source = describeSource();
    errors.push(new PAError(
      "E-PA-004",
      `E-PA-004: Table \`${tableName}\` was not found in ${source.where}. ` +
      source.detail +
      `Verify the table name is correct and that this is the database you meant.`,
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
 * Open an EXISTING SQLite file for compile-time schema reading, such that the
 * read leaves no trace on disk. Always SQLITE_OPEN_READONLY (a write through
 * this handle throws). Two cases (s430-dev-db-stub F1):
 *
 *  - No `<path>-wal` beside the file: open with the URI parameter
 *    `immutable=1`. SQLite then takes no locks and creates NO side files. A
 *    plain read-only open of a WAL-mode database creates `-wal` + `-shm` and,
 *    being read-only, cannot delete them on close — they persisted. With no
 *    `-wal` file the main file holds the whole committed database, so
 *    immutable reads it completely.
 *  - A `-wal` file exists (a live writer, e.g. a running dev server): a plain
 *    read-only open. `immutable=1` would ignore the WAL and miss committed but
 *    un-checkpointed schema (a table created a moment ago). The side files
 *    here belong to the writer; the read creates nothing that was not there.
 *
 * Exported for the unit tests that pin both properties.
 */
export function openSchemaReadHandle(dbPath: string): Database {
  if (existsSync(`${dbPath}-wal`)) {
    return new Database(dbPath, { readonly: true });
  }
  return new Database(
    `${sqliteFileUri(dbPath)}?immutable=1`,
    sqliteConstants.SQLITE_OPEN_READONLY | sqliteConstants.SQLITE_OPEN_URI,
  );
}

/**
 * A `file:` URI for an absolute path. SQLite's URI parser treats `?` as the
 * query start, `#` as the fragment and `%` as an escape, so those three are
 * percent-encoded; Windows separators become `/` and a drive path gets the
 * leading `/` SQLite expects (`file:/C:/…`).
 */
function sqliteFileUri(absPath: string): string {
  let p = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(p)) p = "/" + p;
  return "file:" + p.replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
}

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
  /** The run's note sink (PAInput.onNote), carried here so resolveDb can reach it. */
  readonly note: (line: string) => void;

  constructor(note?: (line: string) => void) {
    this._dbs = new Map();
    this.note = note ?? ((line: string) => { process.stderr.write(line); });
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
      db = openSchemaReadHandle(dbPath);
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
   * and cache it under dbPath PLUS the exact statement set, so it is reused only
   * by a < db> block that needs precisely the same tables from the same DDL.
   *
   * s430-dev-db-stub F2: the key used to be dbPath alone. The cache lives for
   * the whole runPA() call (all files) while the statement set is per block
   * (its tables= subset of its own file's DDL), so a second < db> block on the
   * same src= with a different tables= — in the same file or another — got the
   * FIRST block's shadow and a false E-PA-004 for every table the first block
   * had not asked for.
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
    // "\0" cannot occur in a path or in SQL text, so the key is unambiguous.
    const key = `shadow\0${dbPath}\0${[...createStatements].sort().join("\0")}`;
    if (this._dbs.has(key)) return this._dbs.get(key)!;

    let db: Database;
    try {
      db = new Database(":memory:");
    } catch (err) {
      errors.push(new PAError(
        "E-PA-003",
        `E-PA-003: Failed to create in-memory SQLite database for shadow schema: ${(err as Error).message}`,
        blockSpan,
      ));
      this._dbs.set(key, null);
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
        this._dbs.set(key, null);
        return null;
      }
    }

    this._dbs.set(key, db);
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
 * The `CREATE TABLE` recognizer moved to `schema-differ.js` (dpa-039 arc B round 2)
 * and is imported above. It now also accepts — and NORMALIZES AWAY — a schema
 * qualifier (`CREATE TABLE public.assets (…)`), the ordinary Postgres spelling,
 * which this file used to miss entirely. Normalizing matters here specifically:
 * `resolveDb` REPLAYS these statements into an in-memory SQLite shadow DB, and an
 * unstripped `public.assets` throws and takes the whole `< db>` block down with
 * `E-PA-003`.
 */

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
      // `overwrite: true` preserves this walker's long-standing last-wins
      // behaviour across nodes (the raw-DDL `< schema>` harvest is first-wins).
      harvestCreateTables(node.query as string, result, true);
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
// F-SCHEMA-001 — `< schema>` DDL as a third ColumnDef source (§39, §14.8)
// ---------------------------------------------------------------------------

/**
 * Walk the AST for `< schema>` state blocks, parse their declarative DDL bodies
 * via schema-differ.js `parseSchemaBlock`, and synthesize a `CREATE TABLE`
 * statement per declared table via `generateCreateTable`. Returns a
 * `Map<tableName (lowercased), CREATE TABLE SQL>`.
 *
 * This is the THIRD ColumnDef source after (1) the live DB file and (2) the
 * `CREATE TABLE` statements harvested from `?{}` blocks. The schema DDL is
 * authoritative scrml-side schema-as-code (§39): a DDL-first app with no
 * materialized DB and no harvested `CREATE TABLE` still gets generated table
 * types from its `< schema>` block — closing the "schema-is-code promise of §39"
 * gap where the flagship had to bootstrap a `dispatch.db` just to get types.
 *
 * PRECEDENCE (see `resolveDb`): live DB file > harvested `CREATE TABLE` (`?{}`)
 * > `< schema>` DDL. The schema DDL only fills the gap when the higher-precedence
 * sources are absent for a given table.
 *
 * The body text is the concatenated `text`-kind children of the `< schema>`
 * node (the same shape schema-differ's own consumers read).
 *
 * g-schema-block-raw-ddl — a `< schema>` block may instead carry RAW
 * `CREATE TABLE … (…)` SQL (the same DDL the `?{}` harvester reads) written
 * directly in the block rather than the declarative `tableName { … }` form. We
 * harvest those statements too (via `harvestRawCreateTables`) so a raw-DDL
 * `< schema>` feeds the shadow DB exactly like a `?{}` CREATE TABLE — otherwise
 * the raw form reaches NEITHER `parseSchemaBlock` NOR the `?{}` walker and
 * E-PA-002 false-fires even though the author DID supply DDL.
 */
/**
 * Concatenate the `text`-kind children of a `<schema>` state node into its raw
 * body text (the same shape schema-differ's `parseSchemaBlock` consumers read).
 * Hoisted to module scope + exported so the §38.13 `<channel watches=>` machinery
 * (channel-watches.ts) reuses ONE implementation rather than duplicating it.
 */
export function collectSchemaBodyText(node: unknown): string {
  const children = (node as { children?: ASTNode[] } | null | undefined)?.children;
  if (!Array.isArray(children)) return "";
  let text = "";
  for (const c of children) {
    if (c && (c as { kind?: string }).kind === "text" &&
        typeof (c as { value?: unknown }).value === "string") {
      text += (c as { value: string }).value;
    }
  }
  return text;
}

function extractSchemaCreateTableStatements(nodes: ASTNode[]): Map<string, string> {
  const result = new Map<string, string>();

  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.kind === "state" && node.stateType === "schema") {
      const body = collectSchemaBodyText(node as unknown as ASTNode);
      if (body.trim().length > 0) {
        let parsed: { tables: Array<{ name: string; columns: unknown[] }> };
        try {
          parsed = parseSchemaBlock(body) as typeof parsed;
        } catch {
          parsed = { tables: [] };
        }
        for (const table of parsed.tables ?? []) {
          if (!table || typeof table.name !== "string") continue;
          // schemaFor-style synthesized tables can be empty (no columns) — skip
          // those so we never feed a degenerate `CREATE TABLE x ()` to SQLite.
          if (!Array.isArray(table.columns) || table.columns.length === 0) continue;
          const key = table.name.toLowerCase();
          // First `< schema>` declaration of a table wins (a later duplicate is
          // ignored — schema-as-code should not declare a table twice).
          if (!result.has(key)) {
            try {
              result.set(key, generateCreateTable(table));
            } catch {
              // A malformed table decl — skip; PA's existing E-PA-002 path will
              // surface the missing-table error if no other source covers it.
            }
          }
        }
        // g-schema-block-raw-ddl — the `< schema>` block may ALSO carry raw
        // `CREATE TABLE … (…)` SQL (the same DDL the `?{}` harvester reads),
        // written directly here instead of the declarative `tableName { … }`
        // form. Harvest those too so a raw-DDL `< schema>` feeds the shadow DB
        // exactly like a `?{}` CREATE TABLE. Declarative tables registered
        // above win within this source; the runPA merge keeps a `?{}` CREATE
        // TABLE / live DB winning over the whole `< schema>` source.
        harvestRawCreateTables(body, result);
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
// g-schemafor-pa-unrecognized — Form-B `schemaFor(StructType)` inside `< schema>`
// as a fourth ColumnDef source (§41.15, §41.15.2)
// ---------------------------------------------------------------------------

/**
 * §41.15.2 pluralization — "lowercase the identifier; append `s` unless it
 * already ends in `s`". Local mirror of `pluralizeStructName` in
 * `codegen/emit-schema-for.ts` (kept here so the early PA stage does not pull a
 * codegen module). KEEP IN SYNC with §41.15.2 / emit-schema-for.ts.
 *
 *   "Driver" -> "drivers"   "User" -> "users"   "News" -> "news"
 */
function paPluralizeStructName(structName: string): string {
  if (!structName) return structName;
  const lower = structName.toLowerCase();
  return lower.endsWith("s") ? lower : lower + "s";
}

/**
 * Split a struct-body field list on TOP-LEVEL commas (commas not nested inside
 * `()` / `[]` / `{}`). The struct `raw` carried on a `type-decl` node is the
 * brace-wrapped field list, e.g.
 *   `{ id : integer , name : string req length ( >= 2 ) , age : number min(18) }`
 * Validator clauses (`length(>=2)`, `oneOf([.A,.B])`) carry internal commas, so
 * a naive `split(",")` would shred them.
 */
function splitStructFieldsTopLevel(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) fields.push(cur);
  return fields;
}

/**
 * F-SCHEMA-001 companion — recognize the canonical §41.15 Form-B
 * `< schema> ${ schemaFor(StructType) } </>` usage as a table-definition source.
 *
 * Why this exists: the F-SCHEMA-001 path (`extractSchemaCreateTableStatements`)
 * reads only the LITERAL `text`-kind children of a `< schema>` block. The Form-B
 * surface puts a `${ schemaFor(Driver) }` logic-escape interpolation in the
 * block body instead — the L22 codegen expansion (`emit-schema-for.ts`) runs in
 * the CODEGEN stage, long AFTER this early PA stage, so at PA time the body is
 * still the unexpanded call and `parseSchemaBlock` sees no table. Result: a
 * FALSE `E-PA-002` ("no CREATE TABLE … for table `drivers`") whenever the db
 * file does not pre-exist (the common first-run / dev case), even though the
 * literal-`< schema>` equivalent compiles clean.
 *
 * Fix (PA-side recognition): resolve each `schemaFor(StructType)` call in a
 * `< schema>` block to the struct's `type-decl`, pluralize per §41.15.2, and
 * synthesize a `< schema>`-shaped table body (`< plural> { <struct fields> }`)
 * that we feed through the SAME literal-path lowering (`parseSchemaBlock` +
 * `generateCreateTable`). This gives the shadow DB the same columns the literal
 * form would, so E-PA-002 does not false-fire AND the generated table type is
 * available downstream — without duplicating the full schemaFor lowering.
 *
 * Robustness: if the struct can't be resolved (forward-ref / unresolved import)
 * or the synthesized body yields no columns, we skip that call and fall through
 * to the existing behavior (a genuinely missing table still errors). Returns a
 * `Map<tableName (lowercased), CREATE TABLE SQL>`.
 */
function extractSchemaForCreateTableStatements(nodes: ASTNode[]): Map<string, string> {
  const result = new Map<string, string>();

  // 1. Local names bound to `schemaFor` via `import { schemaFor } from "scrml:data"`
  //    (supports aliasing: `import { schemaFor as sf }`). If no scrml:data import
  //    is present we make NO assumption — an undefined `schemaFor` is not ours.
  const schemaForLocals = new Set<string>();
  // 2. Struct registry: struct type-name -> raw brace-wrapped field-list body.
  const structRaw = new Map<string, string>();

  const collect = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.kind === "import-decl" && node.source === "scrml:data") {
      const specifiers = node.specifiers as Array<{ imported?: string; local?: string }> | undefined;
      if (Array.isArray(specifiers)) {
        for (const spec of specifiers) {
          if (spec && spec.imported === "schemaFor" && typeof spec.local === "string") {
            schemaForLocals.add(spec.local);
          }
        }
      } else if (Array.isArray(node.names) && (node.names as unknown[]).includes("schemaFor")) {
        schemaForLocals.add("schemaFor");
      }
    }
    if (node.kind === "type-decl" && node.typeKind === "struct" &&
        typeof node.name === "string" && typeof node.raw === "string") {
      // First declaration of a struct name wins (a later duplicate is a separate
      // E-TYPE-001 concern; PA just needs one resolvable body).
      if (!structRaw.has(node.name)) structRaw.set(node.name, node.raw);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      collect(node[key], depth + 1);
    }
  };
  collect(nodes, 0);

  if (schemaForLocals.size === 0) return result;

  // Extract the struct-arg name from a `schemaFor(Struct[, options])` call node.
  const schemaForStructArg = (exprNode: unknown): string | null => {
    if (!exprNode || typeof exprNode !== "object") return null;
    const call = exprNode as { kind?: string; callee?: { kind?: string; name?: string }; args?: unknown[] };
    if (call.kind !== "call" || !call.callee || call.callee.kind !== "ident") return null;
    if (typeof call.callee.name !== "string" || !schemaForLocals.has(call.callee.name)) return null;
    const firstArg = Array.isArray(call.args) ? call.args[0] : undefined;
    const arg = firstArg as { kind?: string; name?: string } | undefined;
    if (!arg || arg.kind !== "ident" || typeof arg.name !== "string") return null;
    return arg.name;
  };

  // Resolve a struct name to a synthesized CREATE TABLE for its pluralized table,
  // reusing the literal-`< schema>` lowering. Returns null on any failure so the
  // caller can fall through to the existing missing-table behavior.
  const synthCreateTable = (structName: string): { key: string; sql: string } | null => {
    const raw = structRaw.get(structName);
    if (typeof raw !== "string") return null; // unresolved struct — fall through
    // Strip the outer braces from the struct raw body, split fields on top-level
    // commas, and re-join with newlines so `parseColumns` (which splits on `\n`)
    // sees one field per line.
    let body = raw.trim();
    if (body.startsWith("{")) body = body.slice(1);
    if (body.endsWith("}")) body = body.slice(0, -1);
    const fields = splitStructFieldsTopLevel(body)
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    if (fields.length === 0) return null;
    const tableName = paPluralizeStructName(structName);
    // A `< schema>`-shaped table block: `< plural> {\n  field: type preds\n  ... }`.
    const schemaBody = `${tableName} {\n${fields.join("\n")}\n}`;
    let parsed: { tables: Array<{ name: string; columns: unknown[] }> };
    try {
      parsed = parseSchemaBlock(schemaBody) as typeof parsed;
    } catch {
      return null;
    }
    const table = (parsed.tables ?? [])[0];
    if (!table || typeof table.name !== "string" ||
        !Array.isArray(table.columns) || table.columns.length === 0) {
      return null; // no resolvable columns — fall through
    }
    try {
      return { key: tableName.toLowerCase(), sql: generateCreateTable(table) };
    } catch {
      return null;
    }
  };

  // Walk `< schema>` blocks for `schemaFor(Struct)` calls in their logic-escape
  // children and register the synthesized table.
  const visitSchemaCall = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    const structName = schemaForStructArg((value as { exprNode?: unknown }).exprNode);
    if (structName) {
      const synth = synthCreateTable(structName);
      if (synth && !result.has(synth.key)) result.set(synth.key, synth.sql);
    }
    if (Array.isArray(value)) {
      for (const item of value) visitSchemaCall(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      visitSchemaCall(node[key], depth + 1);
    }
  };

  const visitSchemaBlocks = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) visitSchemaBlocks(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.kind === "state" && node.stateType === "schema") {
      visitSchemaCall(node.children, 0);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      visitSchemaBlocks(node[key], depth + 1);
    }
  };
  visitSchemaBlocks(nodes, 0);

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
  srcIsUnsupported: boolean = false,
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
    // F4 (s430-dev-db-stub): a driver URI can carry a password — it is never
    // echoed verbatim. The `db-migrate` remedy stays copy-pasteable when the URI
    // carries no credentials; when it does, a redacted URI would not run, so the
    // remedy names a placeholder instead.
    const shownTarget = srcIsDriverUri ? redactDbUri(dbPath) : dbPath;
    const migrateTarget = srcIsDriverUri && shownTarget !== dbPath ? "<your connection string>" : dbPath;
    const what = srcIsUnsupported
      ? `Database target \`${shownTarget}\` uses a URI scheme no \`?{}\` driver accepts ` +
        `(E-SQL-005 — supported: \`postgres://\`, \`postgresql://\`, \`mysql://\`, \`sqlite:\`), ` +
        `so it is not a file and cannot be introspected,`
      : srcIsDriverUri
      ? `Driver URI \`${shownTarget}\` cannot be introspected at compile time yet (Phase 2)`
      : `Database file \`${shownTarget}\` does not exist`;
    errors.push(new PAError(
      "E-PA-002",
      `E-PA-002: ${what} and no CREATE TABLE statement ` +
      `was found in any \`?{}\` block for ${tableWord} \`${missingList}\`. ` +
      `First remedy: declare ${tableWord} \`${missingList}\` in a \`<schema>\` block, then run ` +
      `\`scrml db-migrate . --db ${migrateTarget}\` to create ${tableWord === "table" ? "it" : "them"}. ` +
      `The compiler generates that DDL from your \`<schema>\` — do NOT hand-write the schema ` +
      `or rebuild it by hand against \`bun:sqlite\`. ` +
      (srcIsDriverUri
        ? `Otherwise add a CREATE TABLE statement (e.g. in a startup \`?{}\` block) so the compiler ` +
          `can validate the schema. Real Postgres / MySQL introspection lands in a future phase.`
        : `Otherwise create the database file first, or add a CREATE TABLE statement in a \`?{}\` ` +
          `block so the compiler can validate the schema at compile time.`),
      blockSpan,
    ));
    return null;
  }

  // All tables have CREATE TABLE statements. Build shadow DB.
  const what = srcIsUnsupported
    ? `Unsupported database target '${redactDbUri(dbPath)}' (no \`?{}\` driver accepts its URI scheme — E-SQL-005)`
    : srcIsDriverUri ? `Driver URI '${redactDbUri(dbPath)}'` : `Database file '${dbPath}' does not exist`;
  cache.note(
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
  const cache = new SchemaCache(input.onNote);

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

      // F-SCHEMA-001 — third ColumnDef source: synthesize CREATE TABLE from the
      // file's `< schema>` DDL block(s) (§39, schema-as-code). Merge as a LOWER-
      // precedence fallback: a `?{}`-harvested CREATE TABLE for the same table
      // ALWAYS wins (it is the materialized truth the app actually runs). The
      // live DB file, when present, still wins over both via resolveDb's
      // existsSync check. This lets a DDL-first app with no materialized DB get
      // generated table types without bootstrapping a throwaway `.db`.
      const schemaCreateTableMap = extractSchemaCreateTableStatements(nodes);
      for (const [tableKey, createSql] of schemaCreateTableMap) {
        if (!createTableMap.has(tableKey)) createTableMap.set(tableKey, createSql);
      }

      // g-schemafor-pa-unrecognized — FOURTH (lowest-precedence) ColumnDef
      // source: recognize the canonical §41.15 Form-B
      // `< schema> ${ schemaFor(StructType) } </>` usage as a table-definition
      // source so it does not false-fire E-PA-002 (the L22 schemaFor codegen
      // expansion runs in the CG stage, long after this PA stage — at PA time
      // the `< schema>` body is still the unexpanded interpolation). Only fills
      // a table that neither a `?{}`-harvested CREATE TABLE nor a literal
      // `< schema>` DDL block already defined.
      const schemaForCreateTableMap = extractSchemaForCreateTableStatements(nodes);
      for (const [tableKey, createSql] of schemaForCreateTableMap) {
        if (!createTableMap.has(tableKey)) createTableMap.set(tableKey, createSql);
      }

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
      `E-PA-006: The \`<db>\` state block is missing the required \`src=\` attribute. ` +
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
  const srcClass = classifyDbTarget(srcRaw);
  const srcKind = srcTargetKind(srcClass);
  const isDriverConnectionUri = srcKind !== "file";
  const sourceDir = dirname(filePath);

  if (isDriverConnectionUri) {
    // Use the (trimmed) URI as the cache key — no path resolution.
    dbPath = srcClass.trimmed;
  } else {
    const resolvedRaw = resolve(sourceDir, srcClass.sqlitePath ?? srcClass.trimmed);

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
      `E-PA-005: The \`<db>\` state block is missing the required \`tables=\` attribute. ` +
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
      `E-PA-005: The \`tables=\` attribute on the \`<db>\` block produced an empty table name list ` +
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
  const db = resolveDb(dbPath, tableNames, createTableMap, cache, blockSpan, errors, isDriverConnectionUri, srcKind === "unsupported");
  if (db === null) return;

  // ------------------------------------------------------------------
  // Step 6: Read the full schema for each named table.
  // E-PA-003 / E-PA-004 are emitted by readTableSchema on failure.
  // Accumulate errors for all tables before bailing — this gives the
  // developer a complete picture rather than one error at a time.
  // ------------------------------------------------------------------

  const tableSchemas = new Map<string, ColumnDef[]>();
  let anyTableFailed = false;

  const dbSource = (): DbSourceDescription =>
    describeDbSource(dbPath, srcRaw, sourceDir, isDriverConnectionUri, db, srcKind === "unsupported");
  for (const tableName of tableNames) {
    const schema = readTableSchema(db, tableName, blockSpan, errors, dbSource);
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
