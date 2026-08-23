/**
 * Per-file exemption for the §40.8 default-logic BODY-TOP diagnostics.
 *
 * Two codes share this locus and therefore share this list:
 *   - `E-WRITE-NOT-IN-LOGIC-CONTEXT` (S123 "Unit CC") — a bare `@x = expr` write
 *     at the immediate body-top of `<program>` / `<page>` / `<channel>`.
 *   - `E-CALL-NOT-IN-LOGIC-CONTEXT` (S368) — a bare `loadData()` call at the
 *     same position.
 *
 * Both are NEWLY-REJECTING against a corpus that predates the rule, and both
 * name the SAME body-top surface, so a file that needs suppression needs it for
 * the surface, not for one code. Splitting the list per code would make an
 * adopter migrate the same file twice.
 *
 * Sunset is intentionally per-file and MANUAL — an entry disappears when its
 * file is migrated, so migration progress is visible in version control. (This
 * is unlike V-kill's `compiler/native-parser/*.scrml` carve-out, which
 * auto-sunsets on file deletion; the files here are adopter source, not
 * scheduled deletion targets.)
 *
 * Extracted from `symbol-table.ts` at S368 so the TAB stage can consult it too.
 * The dependency direction matters: TAB runs BEFORE SYM, so ast-builder.js must
 * not import from symbol-table.ts. Both stages import this leaf module instead.
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
