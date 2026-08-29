/**
 * Per-file exemption for the §40.8 default-logic BODY-TOP diagnostics.
 *
 * ⚑ LIVE CONSUMERS TODAY: EXACTLY ONE.
 *   - `E-WRITE-NOT-IN-LOGIC-CONTEXT` (S123 "Unit CC") — a bare `@x = expr` write
 *     at the immediate body-top of `<program>` / `<page>` / `<channel>`.
 *     Emitted at `symbol-table.ts` PASS 3, which calls this through the local
 *     `isUnitCCExempt` alias.
 *
 * ⚑ WHY THIS IS A SEPARATE MODULE WITH ONE CONSUMER, WHICH LOOKS LIKE OVER-
 * FACTORING AND IS NOT. It was extracted from `symbol-table.ts` at S368 for a
 * SECOND consumer — a TAB-stage bare-call gate (`E-CALL-NOT-IN-LOGIC-CONTEXT`)
 * naming this same §40.8 body-top locus. **That gate is HELD as of S379 and is
 * NOT in the compiler**; do not read this header as evidence that the code
 * exists. It is being re-derived under its own arc because its recognizer
 * decided a scrml question by asking a JS parser, which is the premise the S368
 * operator ruling struck.
 *
 * ⚑ S383 — THERE ARE NOW **TWO** HELD TAB-STAGE CONSUMERS, NOT ONE, and both
 * name this same locus. The second is ruling 3's §40.8 arm of
 * `E-CONTROL-FLOW-IN-MARKUP` (`ast-builder.js`), held at S383 for the same
 * class of reason: its recognizer needs a `{` to tell code from prose, so
 * `if (@a) log(1)` (braceless), `switch (@a) { }`, a labelled `for` and a
 * `do { … } while (@a)` all ship raw into the DOM with zero diagnostics — a
 * permanent hole inside the very class the code exists to close. It needs a
 * grammar-derived implementation, not another regex. See
 * `docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md`.
 * Neither held gate is in the compiler; the extraction survives both holds
 * because the dependency direction below is what justifies it, not the
 * consumer count.
 *
 * The extraction is kept because the DEPENDENCY DIRECTION is the whole point and
 * it does not depend on which codes consume the list: **TAB runs BEFORE SYM, so
 * `ast-builder.js` must not import from `symbol-table.ts`.** Any future TAB-stage
 * gate at this locus imports this leaf module. Do not "simplify" by folding the
 * list back into `symbol-table.ts` — that reintroduces the stage-order coupling
 * this module exists to avoid.
 *
 * Whatever consumes it, the list is per-SURFACE and not per-CODE: every code at
 * this locus is NEWLY-REJECTING against a corpus that predates its rule, and a
 * file needing suppression needs it for the surface. Splitting the list per code
 * would make an adopter migrate the same file twice.
 *
 * Sunset is intentionally per-file and MANUAL — an entry disappears when its
 * file is migrated, so migration progress is visible in version control. (This
 * is unlike V-kill's `compiler/native-parser/*.scrml` carve-out, which
 * auto-sunsets on file deletion; the files here are adopter source, not
 * scheduled deletion targets.)
 *
 * List shape: repo-relative path strings, e.g. `"samples/contact-directory.scrml"`.
 * Loaded once at module init via synchronous `readFileSync`; the JSON lives in
 * `compiler/src/` so it ships with the compiler.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename_exempt = fileURLToPath(import.meta.url);
const __dirname_exempt = dirname(__filename_exempt);

const EXEMPTION_LIST: string[] = (() => {
  try {
    const raw = readFileSync(join(__dirname_exempt, "unit-cc-exemption-list.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
})();

const EXEMPT_SET = new Set<string>(EXEMPTION_LIST);

/**
 * True when `filePath` is on the per-file exemption list.
 *
 * Matching is strict-then-lenient. Strict: direct membership, for a caller that
 * already holds a repo-relative path. Lenient: a suffix match, because spans
 * typically carry ABSOLUTE paths and the checkout location varies (a worktree
 * harness inserts a `.claude/worktrees/agent-XXX/` segment). The suffix match
 * requires a `/` boundary immediately before the entry — or the entry to BE the
 * whole path — so a short entry like `"a.scrml"` cannot accidentally claim
 * `/foo/bar/not-a.scrml`.
 */
export function isDefaultLogicBodyTopExempt(filePath: string): boolean {
  if (!filePath) return false;
  if (EXEMPT_SET.has(filePath)) return true;
  for (const entry of EXEMPT_SET) {
    if (filePath.endsWith(entry)) {
      const idx = filePath.length - entry.length;
      if (idx === 0 || filePath[idx - 1] === "/") return true;
    }
  }
  return false;
}
