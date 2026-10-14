/**
 * @module commands/fix-verify-shared
 * Shared by the `scrml fix` rules whose verify compiles the file before and after the rewrite and
 * compares the diagnostic codes and the emitted artifacts (given-presence, is-some, arm-pipe).
 *
 * A file that does not compile cannot be verified that way. impl#1 emits no artifacts for it, so
 * "same codes, same (absent) artifacts" holds for any rewrite at all — a vacuous pass (S462 review
 * of s462-fix-rule-followups, repros: a markup guard whose body writes the guarded cell, a guard
 * inside `<each>`, a two-name guard — each E-TYPE-046 before and after). Such a file is refused.
 *
 * S464 ruling ("your recs", user-voice-scrml.md) made the refusal general: client-server-call and
 * sql-failable refuse the same way (their `compileWithRI` carries `errs`), and the CLI (fix.js)
 * refuses ANY file that does not compile before any rule runs (`compileErrorsInPlace`) — which
 * also covers pre-migrate / unwrap-logic / program-wrap / program-move and the §66 declaration
 * rules, whose "same codes before and after" checks were vacuous on a broken file (measured S464:
 * unwrap-logic deleted the `${` / `}` lines of a file whose other function emits invalid JS).
 */

import { existsSync, readdirSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { validateEmittedArtifacts } from "../codegen/validate-emit.ts";
import { compileScrml } from "../api.js";
import { captureTrailingContentWarnings } from "../expression-parser.ts";
import { dirname, resolve, join } from "node:path";

/**
 * Mirror the database files beside `filePath` (`*.db`, `*.sqlite`, `*.sqlite3`) into `targetDir`,
 * so a scratch verify compile sees what an in-place compile sees: a `<db src="./test.db">` whose
 * file is missing is E-PA-002 (when no CREATE TABLE is in the source), which the refusal below would
 * otherwise read as "does not compile" (measured: samples/compilation-tests/gauntlet-s20-sql/
 * sql-transaction-001 compiles clean in place). The same mirroring as fix-sql-failable.js. Best effort.
 */
export function mirrorSiblingDatabases(filePath, targetDir) {
  try {
    const here = dirname(resolve(filePath));
    if (!existsSync(here)) return;
    for (const f of readdirSync(here)) {
      if (/\.(db|sqlite3?)$/i.test(f)) copyFileSync(join(here, f), join(targetDir, f));
    }
  } catch { /* best effort: the compile then runs without the database */ }
}

/** The reason a rule gives for a site in a file that does not compile. */
export const FILE_DOES_NOT_COMPILE = "file does not compile; cannot verify";

/**
 * The codes of the error-severity diagnostics of one compile result: every entry of `errors`
 * (unless it carries a non-error severity) and any entry of `warnings` that carries severity
 * "error". Warning- and info-severity codes — E-DG-002 at warning severity, the lints — do not count.
 */
export function errorSeverityCodes(result) {
  return [...new Set(errorSeverityDiagnostics(result).map((d) => d.code))].sort();
}

/**
 * The error-severity diagnostics of one compile result (the set `errorSeverityCodes` reads), each
 * as `{ code, line, message }` — `line` the 1-based source line when the diagnostic carries one,
 * else null; `message` its first line. Deduplicated on (code, line, message).
 */
export function errorSeverityDiagnostics(result) {
  const out = [];
  const add = (d) => {
    if (!d || typeof d.code !== "string") return;
    const line = typeof d.span?.line === "number" ? d.span.line : typeof d.line === "number" ? d.line : null;
    const message = String(d.message ?? "").split("\n")[0].replace(new RegExp(`^${d.code}:\\s*`), "").trim();
    out.push({ code: d.code, line, message });
  };
  // The emitted-JS parse gate (E-CODEGEN-INVALID-LOGIC) runs only on a WRITING compile (api.js —
  // it gates the write), and the verify compiles with `write: false`. Run it here on the emitted
  // artifacts, so a file whose real build fails on invalid emitted JS is not "verified" either
  // (measured: `${@u.name} - ${@n}` in a markup guard emits `-;`).
  try {
    const arts = [];
    for (const [file, v] of result?.outputs ?? new Map()) {
      for (const f of ["clientJs", "serverJs", "libraryJs", "toolJs"]) {
        if (typeof v?.[f] === "string" && v[f].length > 0) arts.push({ sourceFile: file, artifact: `${f}`, contents: v[f] });
      }
    }
    for (const e of validateEmittedArtifacts(arts)) add(e);
  } catch {
    out.push({ code: "(the emitted-JS check threw)", line: null, message: "" });
  }
  for (const d of result?.errors ?? []) if ((d?.severity ?? "error") === "error") add(d);
  for (const d of result?.warnings ?? []) if (d?.severity === "error") add(d);
  const seen = new Set();
  return out.filter((d) => {
    const k = `${d.code}\u0000${d.line}\u0000${d.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * S464 ruling ("your recs", user-voice-scrml.md): `scrml fix` refuses — no rewrite, a message naming
 * the compile errors — any file that does not compile before the rewrite; a rewrite of a file the
 * compiler cannot fully read cannot be verified. The CLI's whole-file gate: compile `filePath` IN
 * PLACE (as `scrml compile` reads it — its imports and its sibling database files from disk; nothing
 * is written) and return its error-severity diagnostics (`errorSeverityDiagnostics`). Empty = the file
 * compiles (warnings and info do not count). A compile that throws is itself a refusal.
 */
export function compileErrorsInPlace(filePath) {
  const out = mkdtempSync(join(tmpdir(), "scrml-fix-refuse-"));
  const saved = { log: console.log, warn: console.warn, error: console.error, so: process.stdout.write, se: process.stderr.write };
  try {
    let r;
    try {
      console.log = console.warn = console.error = () => {};
      process.stdout.write = process.stderr.write = () => true;
      r = captureTrailingContentWarnings(() => compileScrml({ inputFiles: [resolve(filePath)], write: false, outputDir: out, log: () => {} })).result;
    } finally {
      console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
      process.stdout.write = saved.so; process.stderr.write = saved.se;
    }
    return errorSeverityDiagnostics(r);
  } catch (e) {
    return [{ code: "(the compile threw)", line: null, message: String(e?.message ?? e).split("\n")[0] }];
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** One compile error for a refusal message: `CODE (line N): message` — the line / message when known. */
export function formatCompileError(d) {
  return `${d.code}${d.line != null ? ` (line ${d.line})` : ""}${d.message ? `: ${d.message}` : ""}`;
}

/** The full reason for a file whose original compile reports these error codes. */
export function doesNotCompileReason(codes) {
  return `${FILE_DOES_NOT_COMPILE} (impl#1 reports ${codes.join(", ")} before the rewrite)`;
}
