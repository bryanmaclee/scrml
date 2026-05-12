# Bug 4 — TodoMVC form-submit + edit-mode + W-DEAD-FUNCTION + E-DG-002 — progress

Append-only progress.

---

## 2026-05-12 startup

- `pwd` + `git rev-parse --show-toplevel` match: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a95ce630849c2c3b9`
- `git status --short` clean.
- `bun install` — 117 packages.
- `bun run pretest` — 12 samples compiled OK.

Maps read: `primary.map.md`, `error.map.md` (referenced for E-code families).

## Surface investigation findings (before any edits)

### TodoMVC fixture state (HEAD `7a00b1b`, post-S86)

Compiled `bun run compiler/src/cli.js compile benchmarks/todomvc/app.scrml`:

- 4 × W-DEAD-FUNCTION (`commitEdit`, `cancelEdit`, `completedCount`, `visibleTodos`)
- 1 × E-DG-002 (`@editingId`)
- 1 × W-PROGRAM-001 (cosmetic)

### Cross-check against fixture (`benchmarks/todomvc/app.scrml`)

Per `grep` for each name:

- `commitEdit` — defined line 89; NEVER referenced from any markup attribute,
  bare-expr, or text. **W-DEAD-FUNCTION is GENUINE.**
- `cancelEdit` — defined line 106; NEVER referenced. **GENUINE.**
- `visibleTodos` — defined line 119; NEVER referenced. **GENUINE.**
- `completedCount` — defined line 115; called at line 182 in
  `${if (completedCount() > 0) { lift <button .../> }}`. **W-DEAD-FUNCTION
  is a FALSE FIRE.**
- `@editingId` — written at lines 17, 85, 102, 107. Never READ anywhere
  (no `${@editingId}`, no `if=@editingId`, no read inside any function body).
  **E-DG-002 is GENUINE.**

### Form-submit "not propagating" — actual root cause

The compiled `app.client.js` line 159 contains:
```
_scrml_activeCount_25();
```
which dispatches to:
```
function _scrml_activeCount_25() {
  return _scrml_reactive_get("todos").filter().length;
}
```

`.filter()` with NO callback throws `TypeError: undefined is not a function`.
This is the **`.filter(cb).<member>` callback-strip codegen bug** (Bug 5 / Trio B
per the dispatch brief — explicitly OUT OF SCOPE here).

The top-level `_scrml_activeCount_25()` call throws at script load BEFORE the
`DOMContentLoaded` event-wiring block runs. So `addTodo`'s submit handler never
gets registered with the document. Hence "form-submit doesn't propagate".

**The form-submit symptom is a downstream effect of Bug 5, NOT a bug in
`emit-event-wiring.ts`.** The wiring codegen is correct (verified by reading
the compiled output — `data-scrml-bind-onsubmit` attr + `_scrml_attr_onsubmit_2`
handler closure ARE generated correctly).

### Edit-mode "never rendered" — root cause

The fixture `benchmarks/todomvc/app.scrml` simply does NOT render an edit input.
There is no `<input class="edit" if=@editingId == todo.id>` anywhere in the
markup. The `commitEdit` / `cancelEdit` / `@editingId` declarations are
literally orphans because the corresponding markup was never written.

The dispatch brief states the fixture is OUT OF SCOPE to edit. Therefore AC7
(double-click → edit mode) cannot pass.

## Bug-brief reconciliation

The dispatch brief asserts:
> "4 W-DEAD-FUNCTION warnings at compile time on functions that ARE called
> from event handlers."

This is **incorrect for 3 of the 4 functions** (`commitEdit`, `cancelEdit`,
`visibleTodos` are TRULY uncalled per AST inspection — they are not wired into
any markup attr or bare-expr).

Only `completedCount` is a genuine false-fire, and the root cause is in the
`walkMarkupContext` walker in `route-inference.ts:2070`, which fails to
collect identifiers from string `condition` fields of `if-stmt` nodes nested
inside markup-level logic blocks.

The dispatch brief's E-DG-002 assertion is similarly incorrect: `@editingId`
is GENUINELY unread (the fixture never reads it).

## Plan

1. **Fix the genuine false-fire** — extend `walkMarkupContext` in
   `route-inference.ts` to walk string-typed `condition` (and other expr-bearing
   string fields) on AST nodes nested inside markup-context logic blocks.
2. **Add regression-guard unit tests** for both the fixed case (false-fire
   suppressed) and the genuine case (truly-dead function still fires
   W-DEAD-FUNCTION).
3. **Surface to PA:** the 3 other W-DEAD-FUNCTION warnings + 1 E-DG-002 are
   genuine, and form-submit AC2/etc cannot pass without Bug 5 fix. AC1 +
   AC2 of the dispatch brief are not achievable under the stated
   constraints.

## Step — landed fix

`compiler/src/route-inference.ts` — extended `walkMarkupContext` (~line 2070)
with a string-fallback scan over `expr|init|condition|value|test|header|
iterable` and an ExprNode sibling scan over `condExpr|valueExpr|exprNode|
testExpr|headerExpr`. Mirrors the dependency-graph `sweepNodeForAtRefs`
field-set (dep-graph.ts:1785).

`compiler/tests/unit/route-inference.test.js` — new §31 describe block with
+7 unit tests:
- 5 fix-cases: if-stmt.condition / for-stmt.header / while-stmt.condition /
  let-decl.init / nested if+for chain — all should NOT fire W-DEAD-FUNCTION.
- 2 regression-guards: truly-dead function in same file with one live
  function + body-callee-only without markup-ref both still fire.

Test count delta: 11593 -> 11600 pass (+7); 0 fail.

Recompile of `benchmarks/todomvc/app.scrml`: 6 warnings -> 5
(`completedCount` W-DEAD-FUNCTION false-fire eliminated).

## Findings to surface to PA

### Dispatch brief disagreement with on-disk reality

The brief claims "4 W-DEAD-FUNCTION false-fires + E-DG-002 false-fire" on the
TodoMVC fixture. AST-level inspection of `benchmarks/todomvc/app.scrml`
(lines confirmed via grep of each name) shows:

- `completedCount` — REAL false-fire (called from markup-level
  `if (completedCount() > 0)`). FIXED.
- `commitEdit`, `cancelEdit`, `visibleTodos` — GENUINELY uncalled;
  W-DEAD-FUNCTION is correct. The fixture simply does not wire these
  functions into any markup attr / bare-expr / call-ref.
- `@editingId` — GENUINELY unread (only written in 4 sites:
  initialization + startEdit + commitEdit + cancelEdit; never
  `${@editingId}`, `if=@editingId`, or function-body read). E-DG-002 is
  correct.

The fixture is INCOMPLETE — the canonical TodoMVC edit-mode markup
(`<input class="edit" if=@editingId == todo.id>`) was never written. AC7
(double-click → edit mode) physically cannot pass against this fixture.
The dispatch brief acknowledges this elsewhere as a "Wave 3 sub-bug"
(per the spec test header comment) but lists fixture-edit as out of scope
for this dispatch.

### Form-submit "not propagating" root cause is Bug 5, not event-wiring

Compiled `app.client.js` line 159 contains the top-level call
`_scrml_activeCount_25();` which dispatches to:
```js
function _scrml_activeCount_25() {
  return _scrml_reactive_get("todos").filter().length;
}
```

`.filter()` with no callback throws `TypeError: undefined is not a
function` at script load — BEFORE the `DOMContentLoaded` event-wiring
block runs. Hence the form-submit handler is never registered with the
document. AC1's "undefined is not a function" + AC2's "form-submit doesn't
propagate" are downstream effects of the **Bug 5 / Trio B `.filter(cb).
<member>` callback-strip codegen bug** — explicitly OUT OF SCOPE per the
brief.

The `emit-event-wiring.ts` codegen ITSELF is correct (verified by reading
the compiled output — `data-scrml-bind-onsubmit="_scrml_attr_onsubmit_2"`
on the `<form>` + the `submit` document delegator + the `addTodo()`
handler closure ARE all generated correctly). No event-wiring fix is
needed.

### Single root cause finding

Per the brief's hypothesis ("call-detection walker AND read-detection
walker share a missing recognizer for event-handler call/read references"):
**there is NO single shared root cause.** The `walkMarkupContext` walker
in route-inference.ts and the `sweepNodeForAtRefs` walker in
dependency-graph.ts are separate codepaths with different responsibilities.
The DG walker already handled string `condition` fields via its
`exprFields` fallback (line 1785). The RI walker did not. The fix is a
one-sided addition to RI to bring it to parity with DG.

The DG side has a related-but-distinct latent gap: `call-ref` attribute
values (e.g. `onclick=fn(@var)`) skip the `attrVal.kind === "call-ref"`
branch in the markup-attr scan. Args containing `@var` references would
NOT be credited to the @var's reader set. This was not exercised by the
TodoMVC fixture (all call-ref args use loop-vars, not @-vars), but is a
latent E-DG-002 false-fire shape. Filing as separate finding for PA.

### AC scoring

- AC1 (TodoMVC e2e PASSES on 3 browsers) — CANNOT achieve here. Blocked
  by Bug 5 (out of scope per brief). Fixture also missing edit-mode
  markup for AC7.
- AC2 (0 W-DEAD-FUNCTION on fixture) — CANNOT achieve here. Only 1 of 4
  W-DEAD-FUNCTION was a false-fire and that is now FIXED. The other 3
  are GENUINE; would require fixture edits (out of scope).
- AC3 (0 E-DG-002 on fixture) — CANNOT achieve here. The 1 E-DG-002 is
  GENUINE; would require fixture edits (out of scope).
- AC4 (regression guard) — ACHIEVED. 0 fail; +2 explicit regression-guard
  tests; +5 fix-case tests confirm the new walker doesn't mask genuine
  fire-cases.
- AC5 (+6 to +12 unit tests) — ACHIEVED. +7 unit tests (within range).

## Final status

PARTIAL. Real bug found and fixed (1 of 4 W-DEAD-FUNCTION false-fires).
The other 3 W-DEAD-FUNCTION + 1 E-DG-002 + form-submit + edit-mode are
NOT compiler bugs; they're either fixture incompleteness (out of scope)
or downstream effects of Bug 5 (out of scope as separate dispatch).

Surfacing to PA per the brief's instruction:
> "If you hit 6h without converging, STOP and surface to PA."

Walltime: ~2h. Converged on the actually-fixable bug; the brief's
diagnosis was over-inclusive (assumed 4 false-fires; only 1 is).

