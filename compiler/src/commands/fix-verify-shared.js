/**
 * @module commands/fix-verify-shared
 * Shared by every `scrml fix` rule whose verify compiles the file before and after the rewrite in
 * a scratch copy of its project (arm-pipe, is-some, given-presence, client-server-call,
 * sql-failable, and fix-s66's `compiledCodes` for pre-migrate / unwrap-logic / program-wrap /
 * program-move), and by the CLI's does-it-compile gate (fix.js).
 *
 * A file that does not compile cannot be verified that way. impl#1 emits no artifacts for it, so
 * "same codes, same (absent) artifacts" holds for any rewrite at all — a vacuous pass (S462 review
 * of s462-fix-rule-followups, repros: a markup guard whose body writes the guarded cell, a guard
 * inside `<each>`, a two-name guard — each E-TYPE-046 before and after). Such a file is refused.
 *
 * S464 ruling ("your recs", user-voice-scrml.md) made the refusal general: the CLI (fix.js)
 * refuses ANY file that does not compile — judged the way `scrml compile` judges it
 * (`compileErrorsTogether`) — before any rule runs, and every rule refuses on its own scratch
 * compile too. A scratch compile that errors where the in-place compile is clean is NOT "does not
 * compile": it is the verify's own divergence, reported as such (`scratchRefusalReason`).
 *
 * ONE scratch-project builder (`writeScratchProject`): the file, its project, and every SQLite
 * database file the project's sources name (`db=` / `<db src=>`, resolved exactly as the compiler
 * resolves them — db-target.ts `resolveDbFilePath`) placed at the same relative spot under the
 * scratch root, so a `db="../../dispatch.db"` reads the same schema in the scratch compile as in
 * place (S466 review: a missing database is E-PA-002, which read as "does not compile").
 */

import { existsSync, readdirSync, copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { compileScrml, isNonFatalDiagnostic } from "../api.js";
import { captureTrailingContentWarnings } from "../expression-parser.ts";
import { classifyDbTarget, resolveDbFilePath } from "../db-target.ts";
import { dirname, resolve, join, relative, isAbsolute, sep } from "node:path";

// ---------------------------------------------------------------------------
// The scratch project
// ---------------------------------------------------------------------------

/** An aux key as an absolute path: absolute keys stay, relative ones resolve against the file's dir. */
export function absKey(filePath, key) {
  return isAbsolute(key) ? resolve(key) : resolve(dirname(resolve(filePath)), key);
}

/** The deepest directory containing every given absolute path. */
export function commonDir(paths) {
  let parts = dirname(paths[0]).split(sep);
  for (const p of paths.slice(1)) {
    const q = dirname(p).split(sep);
    let i = 0;
    while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(sep) || sep;
}

/**
 * The SQLite database files `source` (the text of `filePath`) names in a `db=` or `<db src=>`
 * value that exist on disk, as absolute paths — resolved by the compiler's own resolver against the
 * declaring file's directory (§8.1.1). Absolute paths are left out (the scratch compile reads them
 * where they are); `:memory:` and driver URIs name no file. A text scan: it may over-collect a value
 * the compiler does not read, which costs one copied file and changes nothing.
 */
export function namedDatabaseFiles(filePath, source) {
  const out = new Set();
  const values = [];
  for (const m of String(source).matchAll(/\bdb\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) values.push(m[1] ?? m[2] ?? m[3]);
  for (const m of String(source).matchAll(/<db\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) values.push(m[1] ?? m[2] ?? m[3]);
  for (const raw of values) {
    const v = raw === undefined ? "" : raw.replace(/\/$/, ""); // an unquoted value before `/>`
    const cls = classifyDbTarget(v ?? "");
    if (cls.kind !== "sqlite-file" || !cls.sqlitePath || cls.sqlitePath === ":memory:" || isAbsolute(cls.sqlitePath)) continue;
    const abs = resolveDbFilePath(cls, resolve(filePath));
    if (existsSync(abs)) out.add(abs);
  }
  return [...out];
}

/**
 * Write the scratch copy of `filePath`'s project under `dir`: the file (`source`), every aux file
 * (path → text; keys absolute or relative to the file), every database file any of them names
 * (`namedDatabaseFiles`, with its `-wal` / `-shm` companions), and the database files beside the
 * file (`*.db` / `*.sqlite` / `*.sqlite3` — a project may open one by a path the scan cannot see).
 * Everything keeps its relative layout under one root, so imports and `db=` paths resolve as they
 * do on disk. Returns `{ target }`, the scratch path of the file.
 */
export function writeScratchProject(dir, filePath, source, auxSources) {
  const self = resolve(filePath);
  const files = new Map([[self, source]]);
  for (const [p, s] of Object.entries(auxSources ?? {})) {
    const ap = absKey(filePath, p);
    if (ap !== self) files.set(ap, s);
  }
  const dbs = new Set();
  for (const [ap, s] of files) for (const d of namedDatabaseFiles(ap, s)) dbs.add(d);
  try {
    const here = dirname(self);
    if (existsSync(here)) for (const f of readdirSync(here)) if (/\.(db|sqlite3?)$/i.test(f)) dbs.add(join(here, f));
  } catch { /* best effort */ }
  const root = commonDir([...files.keys(), ...dbs]);
  const base = join(dir, "src");
  let target = null;
  for (const [ap, s] of files) {
    const out = join(base, relative(root, ap));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, s);
    if (ap === self) target = out;
  }
  for (const d of dbs) {
    for (const f of [d, `${d}-wal`, `${d}-shm`]) {
      try {
        if (!existsSync(f)) continue;
        const out = join(base, relative(root, f));
        mkdirSync(dirname(out), { recursive: true });
        copyFileSync(f, out);
      } catch { /* best effort: the compile then runs without that file */ }
    }
  }
  return { target };
}

// ---------------------------------------------------------------------------
// Error-severity diagnostics
// ---------------------------------------------------------------------------

/** The source file a diagnostic names, or null. */
function diagFile(d) {
  const f = d?.file ?? d?.filePath ?? d?.span?.file ?? null;
  return typeof f === "string" && f.length > 0 ? f : null;
}

/**
 * The error-severity diagnostics of one compile result, by the compiler's own fatal predicate
 * (api.js `isNonFatalDiagnostic` — the one that decides whether `scrml compile` fails), each as
 * `{ code, file, line, message }`: `file` absolute (or null), `line` the 1-based SOURCE line when the
 * diagnostic carries one (E-CODEGEN-INVALID-LOGIC carries none — its position is in emitted JS),
 * `message` the first line. The emitted-JS parse check already ran inside the compile (api.js runs
 * it on every compile, `write: false` included), so it is not run again here.
 */
export function errorSeverityDiagnostics(result) {
  const out = [];
  for (const d of [...(result?.errors ?? []), ...(result?.warnings ?? [])]) {
    if (!d || typeof d.code !== "string" || isNonFatalDiagnostic(d)) continue;
    const line = typeof d.span?.line === "number" ? d.span.line : typeof d.line === "number" ? d.line : null;
    const message = String(d.message ?? "").split("\n")[0].replace(new RegExp(`^${d.code}:\\s*`), "").trim();
    const f = diagFile(d);
    out.push({ code: d.code, file: f ? resolve(f) : null, line, message });
  }
  return out;
}

/** The sorted, distinct codes of `errorSeverityDiagnostics`. */
export function errorSeverityCodes(result) {
  return [...new Set(errorSeverityDiagnostics(result).map((d) => d.code))].sort();
}

/**
 * Compile `files` (absolute paths) together IN PLACE — as `scrml compile <them>` reads them: their
 * imports and databases from disk; nothing is written — and return the error-severity
 * diagnostics (`errorSeverityDiagnostics`). A compile that throws is one diagnostic with no file.
 */
export function compileErrorsTogether(files) {
  const out = mkdtempSync(join(tmpdir(), "scrml-fix-refuse-"));
  const saved = { log: console.log, warn: console.warn, error: console.error, so: process.stdout.write, se: process.stderr.write };
  try {
    let r;
    try {
      console.log = console.warn = console.error = () => {};
      process.stdout.write = process.stderr.write = () => true;
      r = captureTrailingContentWarnings(() => compileScrml({ inputFiles: files.map((f) => resolve(f)), write: false, outputDir: out, log: () => {} })).result;
    } finally {
      console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
      process.stdout.write = saved.so; process.stderr.write = saved.se;
    }
    return errorSeverityDiagnostics(r);
  } catch (e) {
    return [{ code: "(the compile threw)", file: null, line: null, message: String(e?.message ?? e).split("\n")[0] }];
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** `scrml compile <filePath>`'s error-severity diagnostics (compileErrorsTogether of one file). */
export function compileErrorsInPlace(filePath) {
  return compileErrorsTogether([filePath]);
}

/** One compile error for a refusal message: `CODE (line N): message` — the line / message when known. */
export function formatCompileError(d) {
  return `${d.code}${d.line != null ? ` (line ${d.line})` : ""}${d.message ? `: ${d.message}` : ""}`;
}

// ---------------------------------------------------------------------------
// A rule's refusal reason
// ---------------------------------------------------------------------------

/** The reason a rule gives for a site in a file that does not compile. */
export const FILE_DOES_NOT_COMPILE = "file does not compile; cannot verify";
/** The reason a rule gives when its scratch compile errors but the file compiles in place. */
export const SCRATCH_DIVERGES = "cannot verify: the scratch compile diverges";

/** The full reason for a file whose original compile reports these error codes. */
export function doesNotCompileReason(codes) {
  return `${FILE_DOES_NOT_COMPILE} (impl#1 reports ${codes.join(", ")} before the rewrite)`;
}

/**
 * A rule's reason when the scratch compile of the ORIGINAL reports error `codes`. "Does not compile"
 * only when the file really does not compile in place; when it does compile in place, the scratch
 * copy diverged from it (a file the scratch project could not reproduce) — said as such.
 *   inPlaceClean  true: the caller (the CLI gate) already compiled the file in place, clean.
 *                 Otherwise, when `filePath` exists with exactly `source`, it is compiled in place
 *                 here (only on this refusal path); else (a virtual path, or text that is not on
 *                 disk) the scratch compile is the only reading there is.
 */
export function scratchRefusalReason(codes, filePath, source, inPlaceClean) {
  let clean = inPlaceClean === true;
  if (!clean && filePath && typeof source === "string") {
    try {
      const abs = resolve(filePath);
      if (existsSync(abs) && readFileSync(abs, "utf8") === source) clean = compileErrorsInPlace(abs).length === 0;
    } catch { /* not readable: the scratch reading stands */ }
  }
  return clean ? `${SCRATCH_DIVERGES} (${codes.join(", ")})` : doesNotCompileReason(codes);
}
