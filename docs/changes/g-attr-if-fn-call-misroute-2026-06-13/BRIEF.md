# DISPATCH BRIEF — g-attr-if-fn-call-misroute (S191, 2026-06-13)

Route `if=fn()` / `show=fn()` (bare-call condition) as a reactive CONDITIONAL instead of a (wrong)
DOM event binding. This is a SMALL routing fix in ONE codegen file. Full scope + survey:
`docs/changes/g-attr-if-fn-call-misroute-2026-06-13/SCOPE-AND-DECOMPOSITION.md` — READ IT FIRST.

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The
§"Task-Shape Routing" section tells you which additional maps to consult for a compiler-source
codegen bug fix — follow it.

Map currency: maps reflect HEAD 1e17213e as of 2026-06-13. Current HEAD is 7ba053e6 (a docs-only
wrap commit that touched NO compiler source). `emit-html.ts` / `emit-event-wiring.ts` are unchanged
since the map watermark — treat map content as current for this fix.

Feedback: in your final report include either "Maps consulted: [list]; load-bearing finding: <one
sentence>" or "Maps consulted but not load-bearing".

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

S99/S126 leak history: path-discipline leaks have recurred. This dispatch must not be the next one.

Your worktree path is whatever `pwd` reports — it MUST start with
`/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.

## Startup verification (BEFORE any other tool call)
1. `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.
   If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is
   the S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` (worktrees don't inherit node_modules).
5. `git merge main` (or `git rev-parse main` to confirm your base is at or after 7ba053e6 — if your
   base predates it, `git merge main` to pick up current source; the fix files are unchanged so no
   conflict is expected).
6. `git log --oneline -1` — record your base SHA.

If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- Apply ALL file edits via **Bash** (`perl -0pi`/`python3`/heredoc) on **worktree-absolute paths**
  that include the `.claude/worktrees/agent-<id>/` segment — NOT the Edit/Write tools, and NOT
  main-rooted absolute paths. Echo the target path before each write; re-verify with `git diff` /
  `grep` after.
- NEVER `cd` into the main repo (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`,
  `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively for edits, compiles, tests.
- First commit message MUST embed your startup `pwd`: `WIP(g-attr): start at $(pwd)`.

# THE TASK

## The bug (already R26-confirmed by PA on HEAD 7ba053e6)
`<p if=isVisible()>` (bare-call condition) compiles clean but the element ALWAYS renders. Root:
`compiler/src/codegen/emit-html.ts` ~line 1761 — the `val.kind === "call-ref"` value branch
unconditionally routes to `registry.addEventBinding(...)` for ANY attribute name (only a
`SERVER_ONLY_CALL` guard, no condition-attr gate). So `if=fn()` emits `data-scrml-bind-if=…` +
`el.addEventListener("if", …)` — a nonexistent DOM "if" event, never a render predicate. No diagnostic.

## SPEC basis (Rule 4 — normative)
SPEC §5.1 line 1352: an unquoted CONDITION attr (`if=`/`show=`/`else-if=`) "admits ONLY the atomic
forms: an identifier reference (`@var`/`obj.prop`), **a call (`fn()`)**, or a prefix-`!` negation."
`if=fn()` is therefore a spec-VALID condition that SHALL render conditionally. The event-binding
routing violates §5.1. NO new error code — it should just compile to the right thing.

## Why this is SMALL (the survey reversal — do NOT build interprocedural analysis)
The runtime `_scrml_effect` does dynamic dependency tracking. The conditional calls the function
INSIDE the effect, so cells the fn reads auto-subscribe at runtime — ZERO compile-time read-set
analysis. The paren form `if=(isVisible())` already works exactly this way. And the conditional
codegen already handles empty refs: `emit-event-wiring.ts:947` has a `FIX(IS-VARIANT-ATTR)` comment
("condExpr is valid even when refs is empty — emit unconditionally"); the effect emission gates on
`subscribeVars !== undefined`, NOT `.length > 0`. A bare call has no `@`-refs → already covered.

## The fix (ONE locus — mirror the expr branch)
In `compiler/src/codegen/emit-html.ts`, the `else if (val.kind === "call-ref")` branch (~1761): add a
leading guard `if (name === "if" || name === "show") { … } else { …existing addEventBinding… }`.
The if/show guard mirrors the `val.kind === "expr"` if/show block directly above it (~1707-1723):
emit the `data-scrml-bind-if` / `data-scrml-bind-show` placeholder and call
`registry.addLogicBinding({ placeholderId, expr: condRaw, isConditionalDisplay (if) | isVisibilityToggle (show),
condExpr: condRaw, condExprNode, refs, …transitions })` where:
- `condRaw = \`${val.name}(${(val.args ?? []).join(", ")})\`` (e.g. `"isVisible()"`, `"check(@x, 5)"`).
- `condExprNode`: prefer synthesizing a `call` ExprNode (`{kind:"call", callee:{kind:"ident",
  name: val.name}, args: val.argExprNodes ?? []}`) so `emitExprField` + ref-extraction behave
  identically to the expr branch. If you VERIFY that `emitExprField(undefined, condRaw)` emits correct
  client JS, passing `condExprNode: undefined` with the raw string is acceptable — pick the cleaner
  path after reading `emitExprField`.
- `refs`: extract `@`-refs from `val.argExprNodes` if convenient, or `[]` (empty is fine — the
  IS-VARIANT-ATTR gate + dynamic tracking make it correct either way).

Scope = `if=` + `show=` ONLY (the exact predicate the expr branch uses at line 1708). `else-if=` is
if-chain-handled on a separate path and the expr branch does NOT handle it here either — leave it
out. IF you find `else-if=fn()` ALSO reaches branch 1761 with a call-ref and mis-routes, fix it the
same way; otherwise add a one-line follow-up note in progress.md and do NOT expand scope.

ZERO change to the event-binding path for non-condition attrs (the `else` keeps `on*` etc. intact).

## Tests (add to the appropriate existing codegen/emit unit suite — match the surrounding test style)
- `if=fn()` → emits `data-scrml-bind-if` + a conditional that calls `fn()`; assert `addEventListener("if"`
  is ABSENT from the emitted client JS.
- `show=fn()` → emits `data-scrml-bind-show` conditional (isVisibilityToggle); not event-bound.
- `if=fn(@x)` (reactive arg) → conditional; the arg present in the condition code.
- CONTROL regressions (must still pass / still emit conditionals): `if=(fn())`, `if=@count`.
- CONTROL: `onclick=fn()` STILL event-binds (the `else` path untouched).

# COMMIT DISCIPLINE (S83 two-sided)
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify; `git -C "$WORKTREE_ROOT" add <file>`;
  commit IMMEDIATELY. Don't batch. The code fix and its coupled tests are ONE logical unit — commit
  them together (a code change without its test creates a transiently-red window).
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean. "work in worktree, no commits"
  is NOT an acceptable terminal report.

# PHASE 3 — R26 EMPIRICAL VERIFY (MANDATORY — S138 codegen-fix doctrine)
After the fix + tests pass, compile a real reproducer on YOUR post-fix baseline and verify the
symptom is gone. Use this reproducer (write it under /tmp, compile via your worktree binary):
```
<program>
  <page>
    <count> = 0
    fn isVisible() { return @count > 2 }
    <button onclick=${@count = @count + 1}>inc</button>
    <p if=isVisible()>shown when count > 2</p>
    <p if=(isVisible())>paren control</p>
  </>
</program>
```
Run: `bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/g-attr-r26/repro.scrml --output-dir /tmp/g-attr-r26/dist`
Assert in the emitted `*.client.js`:
- `addEventListener("if"` is ABSENT (was present pre-fix).
- a `_scrml_effect`-wrapped conditional calling `isVisible()` is PRESENT (mount/unmount or display-toggle).
- `node --check` on the emitted client JS exits 0.
DO NOT mark DONE without Phase-3 R26 verification passing. Report the grep results verbatim.

# Pre-DONE gate (full-suite-adjacent)
Run `bun --cwd "$WORKTREE_ROOT" run test` (chains pretest) OR at minimum the pre-commit subset
(`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`) and
confirm 0 regressions before reporting DONE. Report the pass/skip/fail counts.

# FINAL REPORT shape
- WORKTREE_PATH (your pwd), BASE_SHA, FINAL_SHA, FILES_TOUCHED list.
- The exact emit-html.ts change (the new guard).
- Test count delta + pass/skip/fail.
- Phase-3 R26 grep output (verbatim).
- Maps feedback line.
- Any deferred/follow-up notes (e.g. else-if assessment, impure-function-in-condition footgun).

Commit after each meaningful change — don't batch. Update
`docs/changes/g-attr-if-fn-call-misroute-2026-06-13/progress.md` after each step. WIP commits are
expected. If you crash, your commits + progress file are how the next agent picks up.
