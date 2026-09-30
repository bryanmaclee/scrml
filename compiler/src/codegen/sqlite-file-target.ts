/**
 * sqlite-file-target.ts — how an emitted server / tool module OPENS a SQLite file
 * (s445-dev-db-side-file; adopter flogence S49 + S51).
 *
 * THE DEFECT. The compile-time schema read resolved `src="./app.db"` against the
 * DECLARING source file's directory, while the emitted handle carried the literal
 * `new SQL("sqlite:./app.db")` — opened relative to the PROCESS CWD — and Bun's
 * sqlite adapter CREATES a missing file. So `scrml dev src/app.scrml` run from the
 * project root silently created an empty `./app.db` beside the project (and served
 * queries against it), and in a multi-directory project an artifact from an earlier
 * compile created empty files exactly where the next compile's schema read looked,
 * which then reported every declared table missing (E-PA-004). Two resolvers and a
 * create-on-open made the running app and the compiler talk about different files.
 *
 * THE FIX, in two halves, both emitted here:
 *
 *   1. ONE RESOLVER. The absolute path comes from `resolveDbFilePath`
 *      (`db-target.ts`) — the function the schema read calls. It is written into
 *      the module RELATIVE TO THE MODULE'S OWN OUTPUT LOCATION and turned back into
 *      an absolute path at load time from `import.meta.url`, so the process CWD
 *      plays no part and the build output stays relocatable as a unit with its
 *      database (the same anchoring the §20.5 session store uses).
 *
 *   2. NEVER CREATE. The handle is opened with `create: false`, and the module
 *      refuses to load when the file is absent, naming the path it looked for and
 *      the value it came from. A server that invents an empty database answers
 *      every query with "no such table" or nothing at all; a missing database is a
 *      configuration error and is reported as one. SPEC is silent on runtime
 *      creation; this is the fail-closed reading. `:memory:` is unaffected, and
 *      Postgres / MySQL connection strings pass through untouched.
 *
 * ⛔ THE EMITTED MODULE MUST STAY TOP-LEVEL-AWAIT-FREE and its handle declaration
 * must stay ONE LINE (`const _scrml_sql… = new SQL(…);`): the conformance runtime
 * adapter and several in-process test harnesses evaluate a server module with
 * `new Function(...)`, stripping exactly that line and the `import` lines. The
 * helper below is a hoisted declaration that is inert when the line is stripped.
 */

import {
  resolve as _pathResolve,
  relative as _pathRelative,
  dirname as _pathDirname,
  join as _pathJoin,
  isAbsolute as _pathIsAbsolute,
  sep as _pathSep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { classifyDbTarget, resolveDbFilePath } from "../db-target.ts";
import { stripPagesPrefix } from "./utils.ts";

/** The emitted helper's name. Not matched by the `\b_scrml_sql(?:_\d+)?\b` handle scan. */
export const SQLITE_FILE_HELPER_NAME = "_scrml_sqlite_file";

/** The import the helper needs, emitted beside `import { SQL } from "bun";`. */
export const SQLITE_FILE_HELPER_IMPORT =
  'import { existsSync as _scrml_db_file_exists } from "node:fs";';

/**
 * The emitted helper, as source lines. Emit ONCE per module that opens at least one
 * SQLite FILE, then `new SQL(_scrml_sqlite_file(<specifier>, <declared>))` per handle.
 */
export const SQLITE_FILE_HELPER_LINES: readonly string[] = Object.freeze([
  "// --- §44.2 (s445): SQLite database files (compiler-generated) ---",
  "// A relative `db=` / `<db src=>` path names a file relative to the .scrml file that",
  "// declares it — the file the compiler read the schema from. The path below is that same",
  "// file, written relative to THIS module, so the working directory the server was started",
  "// in never changes which database opens. The file must already exist: a scrml server",
  "// never creates its database (an empty stand-in would answer every query wrongly).",
  "function _scrml_sqlite_file(specifier, declaredAs) {",
  "  const filename = Bun.fileURLToPath(new URL(specifier, import.meta.url));",
  "  if (!_scrml_db_file_exists(filename)) {",
  "    throw new Error(",
  "      `scrml: database file not found: ${filename} — declared as \"${declaredAs}\", which is ` +",
  "      `resolved against the directory of the .scrml file that declares it. scrml does not ` +",
  "      `create a database at runtime: create it (for a <schema>, \\`scrml db-migrate\\`) or ` +",
  "      `correct the path.`,",
  "    );",
  "  }",
  '  return { adapter: "sqlite", filename, create: false, readwrite: true };',
  "}",
]);

/**
 * The directory an emitted module for `sourceFile` is WRITTEN to — mirrors api.js
 * `pathFor` (`join(outputDir, stripPagesPrefix(dirname(relative(outputBaseDir, file))))`),
 * which writes a source's `.server.js`, tool `.js` and library `.js` into the same
 * directory. Returns null when there is no dist coordinate to express (no output
 * dir / base threaded — direct `runCG` callers — or a source outside the base).
 */
export function emittedModuleDir(
  sourceFile: string,
  outputDir: string | null | undefined,
  outputBaseDir: string | null | undefined,
): string | null {
  if (!sourceFile || !outputDir || !outputBaseDir) return null;
  const relSource = _pathRelative(_pathResolve(outputBaseDir), _pathResolve(sourceFile));
  if (relSource === ".." || relSource.startsWith(".." + _pathSep) || relSource.startsWith("../") || _pathIsAbsolute(relSource)) {
    return null;
  }
  const relDir = stripPagesPrefix(_pathDirname(relSource));
  const out = _pathResolve(outputDir);
  return (relDir === "." || relDir === "") ? out : _pathJoin(out, relDir);
}

/**
 * The URL specifier, resolved against the module's `import.meta.url`, that names
 * `absDbPath`. A relative, percent-encoded `./` / `../` specifier when the module's
 * directory is known and both sit on one root; otherwise the file's absolute
 * `file:` URL (still exactly the file the compiler resolved — never a CWD guess).
 * An AUTHORED absolute path stays absolute: the author pinned a location.
 */
export function sqliteRuntimeSpecifier(
  absDbPath: string,
  moduleDir: string | null,
  authoredAbsolute: boolean,
): string {
  if (moduleDir && !authoredAbsolute) {
    const rel = _pathRelative(moduleDir, absDbPath);
    if (rel.length > 0 && !_pathIsAbsolute(rel)) {
      const encoded = rel.split(_pathSep).join("/").split("/").map(encodeURIComponent).join("/");
      return encoded.startsWith("../") ? encoded : "./" + encoded;
    }
  }
  return pathToFileURL(absDbPath).href;
}

/**
 * The argument expression for `new SQL(…)` when `connectionString` names a SQLite
 * FILE, or null when it does not (`:memory:`, Postgres, MySQL, anything else —
 * those keep their existing emission).
 */
export function sqliteFileHandleArg(
  connectionString: string,
  declaringSourceFile: string,
  outputDir: string | null | undefined,
  outputBaseDir: string | null | undefined,
): string | null {
  const cls = classifyDbTarget(connectionString);
  if (cls.kind !== "sqlite-file" || cls.sqlitePath === null || !declaringSourceFile) return null;
  // `sqlite::memory:` is the in-memory database spelled with the prefix, not a file.
  if (cls.sqlitePath === ":memory:") return null;
  const absDb = resolveDbFilePath(cls, declaringSourceFile);
  const moduleDir = emittedModuleDir(declaringSourceFile, outputDir, outputBaseDir);
  const spec = sqliteRuntimeSpecifier(absDb, moduleDir, _pathIsAbsolute(cls.sqlitePath));
  return `${SQLITE_FILE_HELPER_NAME}(${JSON.stringify(spec)}, ${JSON.stringify(cls.trimmed)})`;
}
