/**
 * Staged output directory — the write-nothing-on-refusal mechanism shared by
 * `scrml build` and `scrml compile` (g-session-config-refusal-still-writes-dist).
 *
 * WHY. `compileScrml({ write: true })` writes artifacts even when the run carries
 * a hard error; only the §2.2.1 emit gate stops the write phase. For the
 * application-scope refusals — E-MW-008 (§20.5.1, two applications contest one
 * session cookie) and E-MW-007 (§40.3.4, two request onions) — that left a complete
 * dist/ on disk containing the very split the diagnostic refuses. And E-MW-007 is
 * decided AFTER compileScrml returns (from the written `.server.js` units), so the
 * command layer cannot stop the write by passing a flag in: it has to write
 * somewhere the deploy does not look, then decide.
 *
 * So the command compiles into a STAGE and either promotes it into the real
 * output directory or discards it. A discarded stage leaves the output directory
 * BYTE-FOR-BYTE as it was — which matters more than "no dist": writing the new
 * units in place beside a PREVIOUS build's `_server.js` produced a runnable server
 * that booted and served 200 on the refused split (measured S438), strictly worse
 * than either a missing dist or an untouched previous one.
 *
 * WHERE. The stage is a SIBLING of the output directory (same parent). Emitted
 * import specifiers are rewritten relative to the output directory
 * (api.js rewriteRelativeImportPaths / rewriteStdlibImports), so a sibling at the
 * same depth yields byte-identical artifacts; a stage under os.tmpdir() would not.
 *
 * PROMOTE is a merge-copy, not a replace: the in-place write this replaces never
 * cleared the output directory, so files a previous build left there survive a
 * promote exactly as they survived an in-place write.
 */

import { existsSync, rmSync, renameSync, cpSync, mkdirSync } from "fs";
import { dirname, basename, join, resolve } from "path";

/** The hard errors that refuse the build as "two applications in one compiled server". */
export const APPLICATION_SCOPE_REFUSALS = new Set(["E-MW-007", "E-MW-008"]);

/** True when any diagnostic in `errors` is an application-scope refusal. */
export function hasApplicationScopeRefusal(errors) {
  return Array.isArray(errors) && errors.some((e) => e && APPLICATION_SCOPE_REFUSALS.has(e.code));
}

/**
 * @param {string} targetDir — the real output directory the adopter asked for
 * @returns {{ targetDir: string, stageDir: string, promote: () => void, discard: () => void }}
 */
export function createStagedOutput(targetDir) {
  const target = resolve(targetDir);
  const stageDir = join(
    dirname(target),
    `.${basename(target)}.scrml-stage-${process.pid}-${Date.now().toString(36)}`,
  );
  let settled = false;

  function discard() {
    if (settled) return;
    settled = true;
    rmSync(stageDir, { recursive: true, force: true });
  }

  function promote() {
    if (settled) return;
    settled = true;
    // compileScrml bailed before its write phase: the in-place path wrote
    // nothing and created nothing, so neither does a promote.
    if (!existsSync(stageDir)) return;
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      try {
        renameSync(stageDir, target);
        return;
      } catch {
        // fall through to the merge-copy (e.g. a racing mkdir of the target)
      }
    }
    cpSync(stageDir, target, { recursive: true, force: true });
    rmSync(stageDir, { recursive: true, force: true });
  }

  return { targetDir: target, stageDir, promote, discard };
}
