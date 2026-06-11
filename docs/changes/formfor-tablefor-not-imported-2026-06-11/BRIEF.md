# DISPATCH BRIEF — `<formFor>`/`<tableFor>` unimported → hard error (E-FORMFOR-NOT-IMPORTED + E-TABLEFOR-NOT-IMPORTED)

Change-id: `formfor-tablefor-not-imported-2026-06-11`. You are `scrml-js-codegen-engineer`, worktree-isolated.

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The §"Task-Shape Routing" section tells you which additional maps to consult for a compiler-source bug fix (error.map + structure.map are the relevant ones here). Map currency: maps reflect HEAD `8307ea7a` as of `2026-06-11` (they were just refreshed this session and INCLUDE the engine-effect diagnostics). If your work touches files modified after that point, treat map content as a starting hypothesis to verify against current source. In your final report, include either "Maps consulted: [list]; load-bearing finding: <one sentence>" or "Maps consulted but not load-bearing."

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is whatever `pwd` returns at startup — call it WORKTREE_ROOT.

## Startup verification (BEFORE any other tool call)
1. Run `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `git merge main` (or confirm base includes HEAD `8307ea7a`) — your base may be the session-start commit; the engine-effect-diagnostics code (`E-ENGINE-EFFECT-NOT-INTERPOLATED`) and the maps must be present.
5. `bun install` (worktrees do NOT inherit node_modules; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
6. `bun run pretest` (populates `samples/compilation-tests/dist/` for browser tests).

## Path discipline (S99/S126 — this leak class has bitten repeatedly)
- **Apply ALL file edits via Bash** (`perl -i` / `python3` / heredoc / `cp`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (they have leaked to MAIN). Echo the target path before each write; re-verify with `git diff` / `grep` after.
- **NEVER `cd` into the main repo** (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`, worktree-absolute paths, `--cwd "$WORKTREE_ROOT"` for bun.
- Your FIRST commit message MUST include the verbatim `pwd` output: `WIP(formfor-not-imported): start at $(pwd)`.

# THE TASK

A `<formFor for=T .../>` or `<tableFor for=T rows=@c/>` markup element used **without** `import { formFor } from 'scrml:data'` (resp. `tableFor`) currently compiles clean (exit 0, zero diagnostic) and emits a **literal `<formFor>`/`<tableFor>` HTML tag** → silent blank. User ruled this a hard **ERROR** (S183), same class as the S182 `E-ENGINE-EFFECT-NOT-INTERPOLATED` fix.

Read the full scope at `docs/changes/formfor-tablefor-not-imported-2026-06-11/SCOPE-AND-DECOMPOSITION.md` (in your worktree) — it has the empirical matrix, the root-cause seam, and the edge cases. Read SPEC §41.14 (formFor recognition) + §41.16 (tableFor recognition) + §34 (catalog) IN FULL before editing (pa.md Rule 4 — SPEC is normative).

## Root seam
`compiler/src/type-system.ts` gates the L22 markup walkers on the import-locals set:
- `~7243`: `if (formForLocals.size > 0) { walkAndExpandFormForNodes(...) }`
- `~7375`: `if (tableForLocals.size > 0) { walkAndExpandTableForNodes(...) }`
Import absent → set empty → walker never runs → node forwarded as literal. Both walkers match the node by **literal markup tag** (`tableForLocals` is `void`'d inside the walker — the tag is the gate); the set only gates whether the walker runs. `formFor`/`tableFor` are registered structural elements (`html-elements.js:656`/`:699`) → a literal lowercase `<formFor>`/`<tableFor>` is unambiguously the L22 element → zero false-positive for a hard error.

## Implement (Approach A — additive `else`-arm detection scan; do NOT restructure the existing walkers)
1. When `formForLocals.size === 0`, walk the markup tree (mirror `collectFormForImports`'s recursion: descend `children`/`body`/`defChildren`/`consequent`/`alternate`/`arms[].body`) for any `kind:"markup"` node whose tag (`node.tag` ?? `node.tagName`) === `"formFor"`. For each, push a `TSError` with new code **`E-FORMFOR-NOT-IMPORTED`** (Error), span = the node's span. Message names the fix: the `formFor` primitive is used but not imported; add `${ import { formFor } from 'scrml:data' }`. Cross-ref SPEC §41.14.
2. Symmetric scan for tag `"tableFor"` when `tableForLocals.size === 0` → **`E-TABLEFOR-NOT-IMPORTED`** (Error). Cross-ref §41.16.
3. One error per offending node (fan-out). Place the scans right after the existing `if (...Locals.size > 0)` blocks (the natural `else` site). Keep the existing happy-path walkers byte-unchanged.

## SPEC
- §41.14 — add a normative statement (parallel to §41.14.1's `for=`-SHALL-be-`:struct` shape): a `<formFor>` element present without the `scrml:data` `formFor` import SHALL emit `E-FORMFOR-NOT-IMPORTED`.
- §41.16 — symmetric statement for `E-TABLEFOR-NOT-IMPORTED`.
- §34 — +2 rows: `E-FORMFOR-NOT-IMPORTED` in the `E-FORMFOR-*` block (~16955), `E-TABLEFOR-NOT-IMPORTED` in the `E-TABLEFOR-*` block (~16971). Both severity Error. Match the existing row format exactly.

## OUT OF SCOPE (do NOT touch)
- `schemaFor` — already fires `E-SCOPE-001` on the unimported call form (verified S183). Leave it.
- The aliased-import happy path; emit-form-for / emit-table-for / the existing expansion walkers.

# TESTS
New file `compiler/tests/unit/formfor-tablefor-not-imported.test.js` (mirror the structure of `compiler/tests/unit/engine-effect-not-interpolated.test.js`):
- `<formFor>` without import → `E-FORMFOR-NOT-IMPORTED` fires.
- `<tableFor>` without import → `E-TABLEFOR-NOT-IMPORTED` fires.
- Canonical `<formFor>` WITH import → NO `*-NOT-IMPORTED`; expansion still happens (`data-scrml-formfor` present in HTML).
- Canonical `<tableFor>` WITH import → NO `*-NOT-IMPORTED`; expansion still happens.
- Import `formFor` but use `<tableFor>` → `E-TABLEFOR-NOT-IMPORTED` fires (the missing one).
Use `compileScrml` from `../../src/api.js` and partition diagnostics correctly: these are Errors, so assert on `result.errors` (the cross-stream helper `[...result.errors, ...result.warnings]` is safest). Severity is Error → the code lands in `result.errors`.

# PHASE 3 — R26 EMPIRICAL VERIFICATION (MANDATORY — do NOT mark DONE without this passing)

Regression tests synthesize/feed AST; R26 verifies the real end-to-end `.scrml` → compiler path. Re-compile real source on your post-fix baseline:

```
mkdir -p /tmp/r26-formfor-verify
# BAD (no import) — MUST now error:
cat > /tmp/r26-formfor-verify/ff-bad.scrml <<'EOF'
${
  type Signup:struct = { name: string req length(>=2), agree: boolean req }
  server function persistSignup(values: Signup) ! string { return "ok" }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
EOF
cat > /tmp/r26-formfor-verify/tf-bad.scrml <<'EOF'
${
  type Load:struct = { id: string, status: string }
  <rows>: Load[] = []
}
<program>
  <tableFor for=Load rows=@rows/>
</program>
EOF
for f in ff-bad tf-bad; do
  bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/r26-formfor-verify/$f.scrml --output-dir /tmp/r26-formfor-verify/out-$f > /tmp/r26-formfor-verify/$f.log 2>&1
  echo "$f exit: $?  (EXPECT 1)"
  grep -E "E-FORMFOR-NOT-IMPORTED|E-TABLEFOR-NOT-IMPORTED" /tmp/r26-formfor-verify/$f.log && echo "  ^ correct" || echo "  !! MISSING the error"
done
```
- BOTH must exit 1 with the respective `*-NOT-IMPORTED` code.
- ALSO re-compile a canonical WITH-import `<formFor>` + `<tableFor>` and confirm exit 0, NO `*-NOT-IMPORTED`, and the expansion still emits (`data-scrml-formfor` / `data-scrml-tablefor` in HTML) — the happy path must be untouched.
- Confirm `samples/compilation-tests/tableFor-basic.scrml` + `examples/27-type-derived-table.scrml` (both HAVE the import) still compile clean (no new error).

# COMMIT DISCIPLINE (crash-recovery)
- Commit after each meaningful unit (the type-system scan / the SPEC+§34 edits / the tests) — don't batch. WIP commits fine. Update `docs/changes/formfor-tablefor-not-imported-2026-06-11/progress.md` after each step (append-only, timestamped).
- Before reporting DONE: `git status` MUST be clean (everything committed). Run the full `bun run test` and confirm 0 fail.
- The code change + its coupled test land as ONE logical unit (don't split into a transiently-red window).

# FINAL REPORT (return as your last message)
- WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED (list).
- The exact `E-FORMFOR-NOT-IMPORTED` + `E-TABLEFOR-NOT-IMPORTED` §34 rows you added (verbatim).
- R26 results (both bad-cases exit 1 + code; happy path untouched; the 2 named corpus files still clean).
- Full-suite pass/skip/fail counts.
- Maps feedback (consulted + load-bearing or not).
- Any deferred items / surprises.
