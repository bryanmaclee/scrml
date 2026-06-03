# BRIEF — Bug 72 (nested `<each>` inside Tier-0 `${for…lift}` body — inner `@.` not codegen-rewritten)

**Dispatched:** S158, 2026-06-03 · **Agent:** `scrml-js-codegen-engineer` (opus, isolation:worktree, bg) · **Agent ID:** aaf169de793675c49 · **Worktree base:** HEAD `1a72c81c` (first S158 dispatch; no prior-landing merge) · **Change-id:** `bug-72-nested-each-in-tier0-lift-2026-06-03`

PA pre-dispatch verification: Rule-4 spec-checked (§17.7.3 line 10564 — nested `<each>` resolves `@.` to innermost scope) + R26-reproduced at HEAD (emit leaks `(@ .)` raw → E-CODEGEN-INVALID-JS) + working-path control confirmed (top-level nested `<each>` → `_scrml_each_item`).

---

(Verbatim `prompt:` text passed to the Agent call follows.)

---

You are fixing **Bug 72** in the scrml compiler (a TypeScript/JavaScript codegen bug). This is a localized codegen-lowering fix. Change-id: `bug-72-nested-each-in-tier0-lift-2026-06-03`.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

## Startup verification (do this BEFORE any other tool call)
1. Run `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as your WORKTREE_ROOT for the rest of the dispatch.
2. Run `git rev-parse --show-toplevel` — MUST equal WORKTREE_ROOT.
3. Run `git rev-parse HEAD` — record it. Your worktree base IS the current main HEAD `1a72c81c` (this is the first dispatch of session S158; NO prior-landing merge is needed this dispatch).
4. Run `git status --short` — confirm clean.
5. Run `bun install` — worktrees do NOT inherit node_modules; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise.
6. Run `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; fresh worktrees have it empty → ~130 ECONNREFUSED browser-test failures without it). For baseline checks use `bun run test` (chains pretest), NOT bare `bun test`.

If ANY check fails: STOP and report; do not proceed.

## Path discipline (enforce on EVERY edit — S99/S126)
- **Apply ALL file edits via Bash** (`perl -i`, `python3`, `cp`, heredoc) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools. The Edit/Write tools have leaked into MAIN's checkout 15+ times historically (the filesystem-divergence class). Bash writes go where `pwd`/`git` resolve, sidestepping the divergence. Echo the target path before each write; re-verify with `git diff` / `grep` after.
- **NEVER `cd` into the main repo (or anywhere outside WORKTREE_ROOT).** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively. A `cd` into main leaks `bun add` / compile / run commands into main (the S90/S126 incident class).
- If any context references a path like `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/...` (main-rooted), translate it to `$WORKTREE_ROOT/compiler/...` before touching it.

# MAPS — REQUIRED FIRST READ
Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). Its §"Task-Shape Routing" → "compiler-source bug fix" routes you to: `error.map.md` (find E-CODEGEN-INVALID-JS + prior each/lift fix notes — S153 each-in-dynamic-context + the S157 Bug 65 engine-ctx-in-lift notes are pattern templates), `domain.map.md` (codegen stage + emit-* file ownership), `structure.map.md` ("Key S148-S156 Source Changes" — exact file/function/line for recently-touched code).

**Map currency: maps reflect HEAD `57edc794` as of 2026-06-02.** They are ~8 commits STALE. **CRITICAL post-map-commit callout:** S157 commit `63fcba72` (Bug 65) modified `emit-lift.js`, `emit-control-flow.ts`, `emit-each.ts`, AND `emit-logic.ts` AFTER the maps were cut — and Bug 65's fix threaded engine-ctx through the EXACT Tier-0 for-stmt→emitForStmt→lift path that Bug 72 lives in. **Treat the maps as a starting hypothesis ONLY for these files; read the CURRENT source via Read/grep — the map's pre-Bug-65 picture of the lift path is wrong.** In your final report include: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing."

# THE BUG (verified by PA at HEAD 1a72c81c — Rule-4 spec-checked + R26 reproduced)

A nested `<each>` placed INSIDE a Tier-0 `${ for (...) { lift <markup> } }` body emits the inner each's `@.` contextual sigil RAW (un-rewritten) → `E-CODEGEN-INVALID-JS`. The inner `@.` is LEGITIMATE — it sits inside the nested `<each>` body, so Bug 70's `E-SYNTAX-064` correctly does NOT fire on it. The gap is purely codegen: the `<each>` iter-scope rewriting (`rewriteIterScopeOnly` / the `@.` → `_scrml_each_item` rewrite) does not reach an `<each>` nested inside a Tier-0 lift body.

**Minimal reproducer (PA-confirmed FAILS at HEAD — recreate it in your worktree at `$WORKTREE_ROOT/repro-bug72.scrml`):**
```scrml
type Row:struct = { id: string, cells: string[] }

<rows>: Row[] = []

<table>
  <tbody>
    ${ for (row of @rows) {
      lift <tr><each in=row.cells><td>${@.}</td></each></tr>
    } }
  </tbody>
</table>
```
PA observed at HEAD: `error [E-CODEGEN-INVALID-JS]` — emitted `repro.client.js` contains `document.createTextNode(String((@ .) ?? ""))` — the inner `@.` left raw.

**The WORKING path to MIRROR (PA-confirmed PASSES at HEAD).** The SAME nested `<each>` at TOP markup level (outer is a Tier-1 `<each>`, not a Tier-0 lift) compiles correctly and emits `createTextNode(String(_scrml_each_item))` — the inner `@.` rewrites to the inner each's iteration variable:
```scrml
<table><tbody>
  <each in=@rows as row>
    <tr><each in=row.cells><td>${@.}</td></each></tr>
  </each>
</tbody></table>
```
That working path goes through `emit-each.ts` `renderTemplateChildToJs` (the each-block recursion, ~lines 234-518) + `rewriteIterScopeOnly` (~line 518) + the `@.` → `_scrml_each_item` rewrite (~lines 755-756). The Tier-0 lift path (`emit-lift.js` rendering lifted markup children + `emit-control-flow.ts emitForStmt`) does NOT route a nested `<each>` child through that machinery.

**Architectural precedent to mirror (READ IT FIRST):** S157 Bug 65 (`63fcba72`) had the IDENTICAL shape for engine-ctx — the Tier-0 lift path dropped engine codegen ctx that the Tier-1 each path threaded. The fix threaded ctx through `for-stmt dispatch (emit-logic.ts) → emitForStmt (emit-control-flow.ts) → the lift call sites (emit-lift.js)` and routed engine handlers through SHARED emit-each.ts machinery (`buildEachEngineCtx` / `emitEngineHandlerBody` exported from emit-each.ts, consumed via `require("./emit-each.ts")` in emit-lift.js — see emit-lift.js lines 14-119). **Bug 72 is the each-nesting analog of that same gap in the same path.** Reuse the SHARED emit-each each-block rendering machinery; do NOT fork/duplicate the iter-scope rewrite logic.

# SPEC AUTHORITY (Rule 4 — confirmed by PA, do not re-litigate the direction)
- **SPEC.md §17.7.3 line 10564:** "Nested `<each>` scopes resolve `@.` to the INNERMOST scope's current value. Outer scopes must use the `as name` form to remain addressable inside nested bodies." → the inner `@.` MUST lower to the inner each's iteration variable. This holds in ANY markup context, including markup lifted from a Tier-0 `for` loop.
- **SPEC.md §17.4** — Tier-0 `${for…lift}` is valid iteration; lifted markup is ordinary markup and may contain a nested `<each>` (Tier-1 §17.7).
- **E-SYNTAX-064 (§34 line 16686 / §17.7.3)** correctly does NOT fire on the inner `@.` (it IS inside an `<each>` body). Do NOT touch the E-SYNTAX-064 fire logic — your fix is purely the codegen lowering of the legitimate inner `@.`. Read these SPEC sections IN FULL before editing (offset+limit).

# YOUR TASK
1. **Phase 0 — survey + reproduce.** Read the maps (per routing), read SPEC §17.7.3 + §17.4 in full, read the CURRENT `emit-lift.js` + `emit-control-flow.ts emitForStmt` + `emit-each.ts` (renderTemplateChildToJs each-block branch + rewriteIterScopeOnly + the `@.` rewrite). Recreate the reproducer + confirm it fails. Then locate the EXACT point in the lift path where a `<each>` child should route into emit-each's each-block machinery but doesn't. **You are AUTHORIZED to correct the locus** if this survey shows the fire site differs from the description above (depth-of-survey discount — report the correction). Report your Phase-0 finding (root cause + proposed fix shape) before the heavy edit if it diverges from "route nested-each-in-lift through shared emit-each machinery."
2. **Implement the fix.** Route a nested `<each>` element appearing in Tier-0 lifted markup through the SHARED emit-each each-block rendering machinery so the inner `@.` gets the iter-scope rewrite — exactly as the top-level path does. Mirror the Bug 65 ctx-threading precedent; reuse, do not fork. Preserve tree-shaking (engine-less / each-less for-lift files must emit byte-identical output — null-carrier guard).
3. **Tests.** Add regression tests (unit + happy-dom where a real DOM render is the canary). Cover: the reproducer shape (nested `<each in=row.cells>` inside `${for row of @rows lift}`); `<each of=N>` nested in a lift (`@.` = index); `as name` alias on the inner each; the `${@.}` interpolation form AND any per-item attribute/handler `@.` forms reachable in the lift-embedded position; and a NEGATIVE/no-regression: a Tier-0 lift with NO nested each still emits byte-identical. Place unit tests in `compiler/tests/unit/` (e.g. `each-in-tier0-lift-bug72.test.js`) and happy-dom in `compiler/tests/browser/`.
4. **Do NOT regress the 6 S157 fixes** — Bug 63 (markup-attr `.advance(.V)` bare-variant check), Bug 65 (Tier-0 lift engine-ctx), Bug 67/71 (match exhaustiveness), Bug 68 (positional-payload enum), Bug 70 (E-SYNTAX-064). The full suite gate covers this; if you touch emit-each/emit-lift/emit-control-flow shared helpers, run the Bug 65 + each-block tests explicitly.

# COMMIT DISCIPLINE (S83 — agent side)
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify; `git -C "$WORKTREE_ROOT" add <file>`; commit IMMEDIATELY. Don't batch — commit per fix-unit / per test-file.
- Your FIRST commit message MUST include the verbatim `pwd` output from startup: `WIP(bug72): start at <pwd-output>`.
- Crash-recovery: write/update `$WORKTREE_ROOT/docs/changes/bug-72-nested-each-in-tier0-lift-2026-06-03/progress.md` after each step (timestamped, append-only — what was done / next / blockers). WIP commits expected. If you crash, your commits + progress.md are how the next agent picks up.
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean (no uncommitted changes). "HEAD unchanged — work in worktree, no commits" is NOT an acceptable terminal report.
- The pre-commit hook runs `bun test {unit,integration,conformance} --bail`. Do NOT use `--no-verify` under any circumstance — it is forbidden without explicit authorization you do not have. If the hook fails, fix the cause.

# PHASE 3 — MANDATORY EMPIRICAL R26 VERIFICATION (S138 — this is a codegen fix relying on AST construction)
Regression tests passing is NOT sufficient. Before reporting DONE, re-compile the real reproducer on your post-fix baseline and confirm the symptom is gone:
```
bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile "$WORKTREE_ROOT"/repro-bug72.scrml --output-dir /tmp/r26-bug72/$(date +%s) 2>&1 | tee /tmp/r26-bug72.log
```
Bug-specific symptom checks (ALL must hold):
- The compile EXITS 0 (no `E-CODEGEN-INVALID-JS`).
- `grep` the emitted `repro-bug72.client.js`: ZERO occurrences of raw `(@ .)` / `(@.)` / `@ .` in the nested-each text node — the inner sigil now reads as the inner each's iteration variable (e.g. `_scrml_each_item` or the `as name` binding).
- `node --check` on the emitted client.js exits 0.
- Confirm the WORKING control (top-level nested `<each>`) STILL compiles clean (no regression).
DO NOT mark DONE without empirical R26 verification passing. Paste the grep counts + node --check exit in your final report.

# FINAL REPORT (return exactly this shape)
- WORKTREE_PATH (your pwd)
- BRANCH + FINAL_SHA (`git -C "$WORKTREE_ROOT" rev-parse HEAD`)
- FILES_TOUCHED (list)
- ROOT CAUSE (one paragraph — the actual locus you fixed; note any locus-correction from the brief's hypothesis)
- FIX SUMMARY (what you changed; how you reused the shared emit-each machinery; tree-shake preservation)
- TEST DELTA (N new tests; full-suite pass/fail/skip counts from `bun run test`)
- R26 EMPIRICAL RESULTS (the grep counts + node --check exits + control-still-works confirmation)
- MAPS feedback line (per the MAPS block)
- ANY SIBLING GAPS surfaced (surface transparently per Rule 5 — do NOT silently fix or skip; report them for PA triage)
- DEFERRED items (anything you scoped out + why)
