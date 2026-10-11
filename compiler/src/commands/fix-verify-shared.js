/**
 * @module commands/fix-verify-shared
 * Shared by the `scrml fix` rules whose verify compiles the file before and after the rewrite and
 * compares the diagnostic codes and the emitted artifacts (given-presence, is-some, arm-pipe).
 *
 * A file that does not compile cannot be verified that way. impl#1 emits no artifacts for it, so
 * "same codes, same (absent) artifacts" holds for any rewrite at all — a vacuous pass (S462 review
 * of s462-fix-rule-followups, repros: a markup guard whose body writes the guarded cell, a guard
 * inside `<each>`, a two-name guard — each E-TYPE-046 before and after). Such a file is refused.
 */

import { existsSync, readdirSync, copyFileSync } from "node:fs";
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
  const out = [];
  for (const d of result?.errors ?? []) {
    if (d && typeof d.code === "string" && (d.severity ?? "error") === "error") out.push(d.code);
  }
  for (const d of result?.warnings ?? []) {
    if (d && typeof d.code === "string" && d.severity === "error") out.push(d.code);
  }
  return [...new Set(out)].sort();
}

/** The full reason for a file whose original compile reports these error codes. */
export function doesNotCompileReason(codes) {
  return `${FILE_DOES_NOT_COMPILE} (impl#1 reports ${codes.join(", ")} before the rewrite)`;
}
