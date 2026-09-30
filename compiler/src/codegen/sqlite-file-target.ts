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
 *   2. CREATE ONLY WHAT YOU OWN (§44.2, ruling:user-voice-scrml.md S445 item 6). A
 *      program that declares schema for the database (its own `CREATE TABLE` in a
 *      `?{}`, or a `<schema>` — `db-ownership.ts`) OWNS it and opens it with
 *      `create: true`. Any other program only REFERENCES it: `create: false`, and
 *      the module refuses to load when the file is absent, naming the path it
 *      looked for and the value it came from — a referencing server that invented
 *      an empty database would answer every query with "no such table" or nothing
 *      at all. Ownership is decided at compile time, per database file, across the
 *      whole program. `:memory:` is unaffected, and Postgres / MySQL connection
 *      strings pass through untouched.
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
import { collectOwnedDbFiles } from "../db-ownership.ts";
import { stripPagesPrefix } from "./utils.ts";

/** The emitted helper's name. Not matched by the `\b_scrml_sql(?:_\d+)?\b` handle scan. */
export const SQLITE_FILE_HELPER_NAME = "_scrml_sqlite_file";

/** The import the helper needs, emitted beside `import { SQL } from "bun";`. */
export const SQLITE_FILE_HELPER_IMPORT =
  'import { existsSync as _scrml_db_file_exists } from "node:fs";';

/**
 * The emitted helper, as source lines. Emit ONCE per module that opens at least one
 * SQLite FILE, then `new SQL(_scrml_sqlite_file(<specifier>, <declared>, <owns>))`
 * per handle.
 */
export const SQLITE_FILE_HELPER_LINES: readonly string[] = Object.freeze([
  "// --- §44.2 (s445): SQLite database files (compiler-generated) ---",
  "// A relative `db=` / `<db src=>` path names a file relative to the .scrml file that",
  "// declares it — the file the compiler read the schema from. The path below is that same",
  "// file, written relative to THIS module, so the working directory the server was started",
  "// in never changes which database opens. A program that declares the database's schema",
  "// (its own CREATE TABLE or a <schema>) owns it and may create the file; a program that only",
  "// references it never does — a missing file is an error, not an empty stand-in.",
  "function _scrml_sqlite_file(specifier, declaredAs, ownsSchema) {",
  "  const filename = Bun.fileURLToPath(new URL(specifier, import.meta.url));",
  "  if (!ownsSchema && !_scrml_db_file_exists(filename)) {",
  "    throw new Error(",
  "      `scrml: database file not found: ${filename} — declared as \"${declaredAs}\", which is ` +",
  "      `resolved against the directory of the .scrml file that declares it. This program ` +",
  "      `declares no schema for it (no CREATE TABLE, no <schema>), so it only references the ` +",
  "      `database and never creates it: create the file or correct the path.`,",
  "    );",
  "  }",
  '  return { adapter: "sqlite", filename, create: ownsSchema, readwrite: true };',
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
 * The database files this module's program owns: the program-wide set codegen/index.ts
 * stamps on every file AST (`_ownedDbFiles`), or — for a direct single-file emit call
 * that never ran that pass — the file's own declarations.
 */
export function ownedDbFilesFor(fileAST: unknown, nodes: unknown, filePath: string): ReadonlySet<string> {
  const stamped = (fileAST as { _ownedDbFiles?: unknown } | null)?._ownedDbFiles;
  if (stamped instanceof Set) return stamped as ReadonlySet<string>;
  return collectOwnedDbFiles(nodes, filePath);
}

/**
 * The argument expression for `new SQL(…)` when `connectionString` names a SQLite
 * FILE, or null when it does not (`:memory:`, Postgres, MySQL, anything else —
 * those keep their existing emission). `ownedDbFiles` decides `create`.
 */
export function sqliteFileHandleArg(
  connectionString: string,
  declaringSourceFile: string,
  outputDir: string | null | undefined,
  outputBaseDir: string | null | undefined,
  ownedDbFiles: ReadonlySet<string>,
): string | null {
  const cls = classifyDbTarget(connectionString);
  if (cls.kind !== "sqlite-file" || cls.sqlitePath === null || !declaringSourceFile) return null;
  // `sqlite::memory:` is the in-memory database spelled with the prefix, not a file.
  if (cls.sqlitePath === ":memory:") return null;
  const absDb = resolveDbFilePath(cls, declaringSourceFile);
  const moduleDir = emittedModuleDir(declaringSourceFile, outputDir, outputBaseDir);
  const spec = sqliteRuntimeSpecifier(absDb, moduleDir, _pathIsAbsolute(cls.sqlitePath));
  const owns = ownedDbFiles.has(absDb);
  return `${SQLITE_FILE_HELPER_NAME}(${JSON.stringify(spec)}, ${JSON.stringify(cls.trimmed)}, ${owns})`;
}
