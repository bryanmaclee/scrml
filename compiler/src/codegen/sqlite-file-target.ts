/**
 * sqlite-file-target.ts — how an emitted server / tool module OPENS a SQLite file
 * (s445-dev-db-side-file; adopter flogence S49 + S51; SPEC §8.1.1, §47.14).
 *
 * THE DEFECT. The compile-time schema read resolved `src="./app.db"` against the
 * DECLARING source file's directory, while the emitted handle carried the literal
 * `new SQL("sqlite:./app.db")` — opened relative to the PROCESS CWD — and Bun's
 * sqlite adapter CREATES a missing file. So `scrml dev src/app.scrml` run from the
 * project root silently created an empty `./app.db` beside the project.
 *
 * WHAT IS EMITTED, per SQLite FILE handle (two shapes, chosen per DECLARING FILE):
 *
 *   // this file declares the database's schema (its own CREATE TABLE / <schema>):
 *   const _scrml_sql = new SQL(_scrml_sqlite_owned("src/app.db", "./app.db", "app.scrml"));
 *   // this file only uses the database:
 *   const _scrml_sql = _scrml_sqlite_referenced("src/app.db", "./app.db", "app.scrml");
 *
 *   1. WHICH FILE (`runtimeDbPath` — THE runtime path rule, ONE function; ruling
 *      user-voice-scrml.md S445 "data root"). The compiler resolves the value against
 *      the declaring `.scrml` file (§8.1.1, the file the schema read opened) and
 *      records it RELATIVE TO THE PROJECT ROOT (`projectRootFor`). At runtime the
 *      module resolves that against ONE data root: `SCRML_DATA_DIR` when set, else
 *      the project root recorded at build. With neither (a build output moved to a
 *      machine without the project and no `SCRML_DATA_DIR`) the module refuses to
 *      open the database, naming `SCRML_DATA_DIR` — never a create in a guessed place.
 *      `scrml dev`, `scrml build`'s server, a `kind="tool"` program and a
 *      module-with-db-context all follow this one rule.
 *
 *   2. WHETHER IT MAY CREATE (`db-ownership.ts decideOwnedDbFiles` — ONE function;
 *      ruling S445 "per-file ownership"). Only a file that declares the schema may
 *      create the database: its handle opens at load with `create: true` and prints
 *      one stderr line when it does create it. Every other handle is REFERENCING:
 *      it opens LAZILY at first use, never creates, and a still-missing file at that
 *      point is a loud error naming the path. Load order therefore no longer matters,
 *      and a module compiles to the same handle alone or inside any build.
 *
 * ⛔ THE EMITTED MODULE MUST STAY TOP-LEVEL-AWAIT-FREE and its handle declaration
 * must stay ONE LINE (`const _scrml_sql… = …;`): the conformance runtime adapter and
 * several in-process test harnesses evaluate a server module with `new Function(...)`,
 * stripping exactly that line and the helper's `node:fs` import. The helpers below are
 * hoisted declarations, inert once the handle line is stripped.
 */

import {
  resolve as _pathResolve,
  relative as _pathRelative,
  dirname as _pathDirname,
  basename as _pathBasename,
  isAbsolute as _pathIsAbsolute,
  sep as _pathSep,
} from "node:path";
import { classifyDbTarget, resolveDbFilePath } from "../db-target.ts";
import { decideOwnedDbFiles } from "../db-ownership.ts";
import { findManifest } from "../host-import.js";

/** The import the helpers need, emitted beside `import { SQL } from "bun";`. */
export const SQLITE_FILE_HELPER_IMPORT =
  'import { existsSync as _scrml_db_file_exists, mkdirSync as _scrml_db_mkdir } from "node:fs";';

/**
 * The emitted helpers, as source lines, for a module whose project root (recorded at
 * build) is `projectRoot`. Emit ONCE per module that opens at least one SQLite FILE.
 * The "created" line goes to STDERR: a `kind="tool"` program's stdout is its output.
 * A referencing handle runs `_scrml_sqlite_configure` (the §44 WAL / busy-timeout
 * defaults) when it first opens, so that helper must be emitted alongside.
 */
export function sqliteFileHelperLines(projectRoot: string): string[] {
  return [
    "// --- §8.1.1 / §47.14 (s445): SQLite database files (compiler-generated) ---",
    "// Each database path below is the file the compiler read the schema from, recorded",
    "// relative to the project root. At runtime it resolves against ONE data root:",
    "// SCRML_DATA_DIR when set, else the project root recorded at build. A file that declares",
    "// the database's schema (its own CREATE TABLE or a <schema>) may create it, and says so;",
    "// every other handle opens on first use and never creates — a missing file is an error.",
    `const _scrml_project_root = ${JSON.stringify(projectRoot)};`,
    "function _scrml_sqlite_path(dbPath) {",
    "  if (/^(?:\\/|[A-Za-z]:[\\\\/])/.test(dbPath)) return dbPath; // outside the project root: absolute",
    "  const dataDir = process.env.SCRML_DATA_DIR;",
    "  if (dataDir) return dataDir.replace(/[\\\\/]+$/, \"\") + \"/\" + dbPath;",
    "  if (!_scrml_db_file_exists(_scrml_project_root)) {",
    "    throw new Error(",
    "      `scrml: cannot locate database \"${dbPath}\": SCRML_DATA_DIR is not set and the project ` +",
    "      `root recorded at build (${_scrml_project_root}) does not exist here — this build was ` +",
    "      `moved. Set SCRML_DATA_DIR to the directory that holds your databases.`,",
    "    );",
    "  }",
    "  return _scrml_project_root + \"/\" + dbPath;",
    "}",
    "function _scrml_sqlite_owned(dbPath, declaredAs, declaredIn) {",
    "  const filename = _scrml_sqlite_path(dbPath);",
    "  if (!_scrml_db_file_exists(filename)) {",
    "    _scrml_db_mkdir(filename.replace(/[\\\\/][^\\\\/]*$/, \"\") || \"/\", { recursive: true });",
    "    console.error(`scrml: created new database ${filename} (declared as \"${declaredAs}\" in ${declaredIn})`);",
    "  }",
    '  return { adapter: "sqlite", filename, create: true, readwrite: true };',
    "}",
    "function _scrml_sqlite_referenced(dbPath, declaredAs, declaredIn) {",
    "  let handle = null;",
    "  let ready = null; // the §44 WAL / busy-timeout setup, finished before the first statement",
    "  const open = () => {",
    "    if (handle) return handle;",
    "    const filename = _scrml_sqlite_path(dbPath);",
    "    if (!_scrml_db_file_exists(filename)) {",
    "      throw new Error(",
    "        `scrml: database file not found: ${filename} — declared as \"${declaredAs}\" in ` +",
    "        `${declaredIn}, which only uses it (it declares no CREATE TABLE or <schema> for it), ` +",
    "        `so it never creates it: create the file, run the program that declares its schema ` +",
    "        `first, or correct the path.`,",
    "      );",
    "    }",
    '    handle = new SQL({ adapter: "sqlite", filename, create: false, readwrite: true });',
    "    ready = _scrml_sqlite_configure(handle);",
    "    return handle;",
    "  };",
    "  // Opens on first use: a query (_scrml_sql`…`) or a method (.unsafe / .begin / .close).",
    "  // Every use is awaited by the code that makes it, so each returns a promise that runs",
    "  // after the connection's defaults are in place.",
    "  return new Proxy(function () {}, {",
    "    apply: (_target, _this, args) => {",
    "      const h = open();",
    "      return ready.then(() => h(...args));",
    "    },",
    "    get: (_target, key) => {",
    "      const h = open();",
    "      const value = h[key];",
    "      return typeof value === \"function\" ? (...args) => ready.then(() => value.apply(h, args)) : value;",
    "    },",
    "  });",
    "}",
  ];
}

/**
 * ⚑ THE PROJECT ROOT (§47.14): the directory holding the declaring file's nearest
 * `scrml.toml`, else its enclosing `.git` checkout (`host-import.js findManifest`, the
 * compiler's one project-root walk), else the build root — the deepest directory
 * containing every compiled file (`outputBaseDir`). With a manifest the answer is a
 * property of the file; without one it is the build's, and a file compiled alone may
 * record a different root than inside a larger build.
 */
export function projectRootFor(declaringSourceFile: string, outputBaseDir: string | null | undefined): string {
  const found = findManifest(declaringSourceFile);
  if (found && typeof found.projectRoot === "string") return _pathResolve(found.projectRoot);
  if (outputBaseDir) return _pathResolve(outputBaseDir);
  return _pathDirname(_pathResolve(declaringSourceFile));
}

/**
 * ⚑ THE RUNTIME PATH RULE (§47.14, ruling S445 "data root") — the path recorded in
 * the module for `absDbPath`: POSIX and relative to `projectRoot`, which the module
 * resolves against `SCRML_DATA_DIR` ?? the recorded project root. A database OUTSIDE
 * the project root, or one the author wrote as an absolute path, is recorded
 * absolute: the data root does not move it.
 */
export function runtimeDbPath(absDbPath: string, projectRoot: string, authoredAbsolute: boolean): string {
  if (!authoredAbsolute) {
    const rel = _pathRelative(projectRoot, absDbPath);
    if (rel.length > 0 && !_pathIsAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + _pathSep) && !rel.startsWith("../")) {
      return rel.split(_pathSep).join("/");
    }
  }
  return absDbPath.split(_pathSep).join("/");
}

/**
 * The databases this file owns (§8.1.1 *Ownership*, per DECLARING file): ONE call to
 * the ownership decision over this file alone.
 */
export function ownedDbFilesFor(nodes: unknown, filePath: string): ReadonlySet<string> {
  return decideOwnedDbFiles([{ filePath, nodes }]);
}

/** How the declaring file is named in runtime messages: relative to the build's source base. */
function declaredInLabel(declaringSourceFile: string, outputBaseDir: string | null | undefined): string {
  if (outputBaseDir) {
    const rel = _pathRelative(_pathResolve(outputBaseDir), _pathResolve(declaringSourceFile));
    if (rel && !rel.startsWith("..") && !_pathIsAbsolute(rel)) return rel.split(_pathSep).join("/");
  }
  return _pathBasename(declaringSourceFile);
}

export interface SqliteFileHandle {
  /** The right-hand side of `const _scrml_sql… = <expr>;` */
  expr: string;
  /** True for an owning handle (opens at load, may create); false = referencing (lazy). */
  owns: boolean;
  /** The project root recorded at build (emitted once per module). */
  projectRoot: string;
}

/**
 * The handle declaration for `connectionString` when it names a SQLite FILE, or null
 * when it does not (`:memory:`, Postgres, MySQL — those keep their existing emission).
 */
export function sqliteFileHandle(
  connectionString: string,
  declaringSourceFile: string,
  outputBaseDir: string | null | undefined,
  ownedDbFiles: ReadonlySet<string>,
): SqliteFileHandle | null {
  const cls = classifyDbTarget(connectionString);
  if (cls.kind !== "sqlite-file" || cls.sqlitePath === null || !declaringSourceFile) return null;
  // `sqlite::memory:` is the in-memory database spelled with the prefix, not a file.
  if (cls.sqlitePath === ":memory:") return null;
  const absDb = resolveDbFilePath(cls, declaringSourceFile);
  const projectRoot = projectRootFor(declaringSourceFile, outputBaseDir);
  const dbPath = runtimeDbPath(absDb, projectRoot, _pathIsAbsolute(cls.sqlitePath));
  const owns = ownedDbFiles.has(absDb);
  const args = `${JSON.stringify(dbPath)}, ${JSON.stringify(cls.trimmed)}, ${JSON.stringify(declaredInLabel(declaringSourceFile, outputBaseDir))}`;
  return {
    expr: owns ? `new SQL(_scrml_sqlite_owned(${args}))` : `_scrml_sqlite_referenced(${args})`,
    owns,
    projectRoot: projectRoot.split(_pathSep).join("/"),
  };
}
