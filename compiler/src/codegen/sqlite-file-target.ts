/**
 * sqlite-file-target.ts — how an emitted server / tool module OPENS a SQLite file
 * (s445-dev-db-side-file; adopter flogence S49 + S51; SPEC §8.1.1).
 *
 * THE DEFECT. The compile-time schema read resolved `src="./app.db"` against the
 * DECLARING source file's directory, while the emitted handle carried the literal
 * `new SQL("sqlite:./app.db")` — opened relative to the PROCESS CWD — and Bun's
 * sqlite adapter CREATES a missing file. So `scrml dev src/app.scrml` run from the
 * project root silently created an empty `./app.db` beside the project, and in a
 * multi-directory project an artifact from an earlier compile created empty files
 * exactly where the next compile's schema read looked (E-PA-004).
 *
 * WHAT IS EMITTED, per SQLite FILE handle:
 *
 *   const _scrml_sql = new SQL(_scrml_sqlite_file("../app.db", "./app.db", "app.scrml", false));
 *
 *   1. WHERE (`runtimeDbSpecifier` — THE runtime path resolution, ONE function). The
 *      file the compiler resolved (`db-target.ts resolveDbFilePath`), written relative
 *      to the module's own output location and turned back into an absolute path at
 *      load from `import.meta.url`, so the process CWD plays no part. ⚑ Where a BUILT
 *      server looks for its database after the output is moved/deployed is an open
 *      design question (S445 review F2); keep it in this one function.
 *
 *   2. WHETHER IT MAY CREATE (`db-ownership.ts decideOwnedDbFiles` — THE ownership
 *      decision, ONE function; §8.1.1 *Ownership* / *Creation*). An owning program
 *      (declares the database's schema) opens with `create: true` and prints ONE
 *      stderr line when it actually creates the file (S445 review F1 — a relative path
 *      written for the CWD otherwise switched silently to a new empty database). A
 *      referencing program opens with `create: false` and refuses to load when the file
 *      is missing, naming the path and the value it came from.
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
  basename as _pathBasename,
  join as _pathJoin,
  isAbsolute as _pathIsAbsolute,
  sep as _pathSep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { classifyDbTarget, resolveDbFilePath } from "../db-target.ts";
import { decideOwnedDbFiles } from "../db-ownership.ts";
import { stripPagesPrefix } from "./utils.ts";

/** The emitted helper's name. Not matched by the `\b_scrml_sql(?:_\d+)?\b` handle scan. */
export const SQLITE_FILE_HELPER_NAME = "_scrml_sqlite_file";

/** The import the helper needs, emitted beside `import { SQL } from "bun";`. */
export const SQLITE_FILE_HELPER_IMPORT =
  'import { existsSync as _scrml_db_file_exists } from "node:fs";';

/**
 * The emitted helper, as source lines. Emit ONCE per module that opens at least one
 * SQLite FILE, then `new SQL(_scrml_sqlite_file(<specifier>, <declared>, <declaredIn>, <owns>))`
 * per handle. The "created" line goes to STDERR: a `kind="tool"` program's stdout is
 * its output and is parsed.
 */
export const SQLITE_FILE_HELPER_LINES: readonly string[] = Object.freeze([
  "// --- §8.1.1 / §44.2 (s445): SQLite database files (compiler-generated) ---",
  "// A relative `db=` / `<db src=>` path names a file relative to the .scrml file that",
  "// declares it — the file the compiler read the schema from. The path below is that same",
  "// file, written relative to THIS module, so the working directory the server was started",
  "// in never changes which database opens. A program that declares the database's schema",
  "// (its own CREATE TABLE or a <schema>) owns it and may create the file — and says so when",
  "// it does; a program that only references it never does: a missing file is an error.",
  "function _scrml_sqlite_file(specifier, declaredAs, declaredIn, ownsSchema) {",
  "  const filename = Bun.fileURLToPath(new URL(specifier, import.meta.url));",
  "  if (!_scrml_db_file_exists(filename)) {",
  "    if (!ownsSchema) {",
  "      throw new Error(",
  "        `scrml: database file not found: ${filename} — declared as \"${declaredAs}\" in ` +",
  "        `${declaredIn}, which is resolved against the directory of that .scrml file. This ` +",
  "        `program declares no schema for it (no CREATE TABLE, no <schema>), so it only ` +",
  "        `references the database and never creates it: create the file or correct the path.`,",
  "      );",
  "    }",
  "    console.error(`scrml: created new database ${filename} (declared as \"${declaredAs}\" in ${declaredIn})`);",
  "  }",
  '  return { adapter: "sqlite", filename, create: ownsSchema, readwrite: true };',
  "}",
]);

/**
 * The directory an emitted module for `sourceFile` is WRITTEN to — mirrors api.js
 * `pathFor` (`join(outputDir, stripPagesPrefix(dirname(relative(outputBaseDir, file))))`),
 * which writes a source's `.server.js`, tool `.js` and library `.js` into the same
 * directory. Null when there is no dist coordinate (no output dir / base threaded —
 * direct `runCG` callers — or a source outside the base).
 */
function emittedModuleDir(
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
 * ⚑ THE RUNTIME PATH RESOLUTION — the URL specifier, resolved at load against the
 * emitted module's `import.meta.url`, that names `absDbPath`.
 *
 * A relative, percent-encoded `./` / `../` specifier when the module's output
 * directory is known and both sit on one root; otherwise the file's absolute `file:`
 * URL (still exactly the file the compiler resolved — never a CWD guess). An AUTHORED
 * absolute path stays absolute: the author pinned a location.
 */
export function runtimeDbSpecifier(
  absDbPath: string,
  declaringSourceFile: string,
  outputDir: string | null | undefined,
  outputBaseDir: string | null | undefined,
  authoredAbsolute: boolean,
): string {
  const moduleDir = emittedModuleDir(declaringSourceFile, outputDir, outputBaseDir);
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
 * stamps on every file AST (`_ownedDbFiles`, from `decideOwnedDbFiles`), or — for a
 * direct single-file emit call that never ran that pass — the same decision over this
 * one file.
 */
export function ownedDbFilesFor(fileAST: unknown, nodes: unknown, filePath: string): ReadonlySet<string> {
  const stamped = (fileAST as { _ownedDbFiles?: unknown } | null)?._ownedDbFiles;
  if (stamped instanceof Set) return stamped as ReadonlySet<string>;
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
  const spec = runtimeDbSpecifier(absDb, declaringSourceFile, outputDir, outputBaseDir, _pathIsAbsolute(cls.sqlitePath));
  const owns = ownedDbFiles.has(absDb);
  const declaredIn = declaredInLabel(declaringSourceFile, outputBaseDir);
  return `${SQLITE_FILE_HELPER_NAME}(${JSON.stringify(spec)}, ${JSON.stringify(cls.trimmed)}, ${JSON.stringify(declaredIn)}, ${owns})`;
}
