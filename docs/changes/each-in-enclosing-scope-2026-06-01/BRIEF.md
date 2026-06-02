# BRIEF — `<each>` over an enclosing-scope binding doesn't work (nested-each + component-each)

**Change-id:** `each-in-enclosing-scope-2026-06-01`
**Dispatched:** S153 (2026-06-01), scrmlTS PA → scrml-js-codegen-engineer, `isolation: "worktree"`.
**Severity:** MED (two bugs). **Type:** codegen architecture (NO spec change). Pre-existing. **Survey-first, then sequential.**

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is under `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-<id>/`.

## Startup (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP (S90). Save as `WORKTREE_ROOT`.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == `WORKTREE_ROOT`. 3. status clean. 4. `bun install`. 5. `bun run pretest`.
6. You are branched from current main (HEAD `c89c1cb1` — includes ALL S153 each/engine/match/colon fixes).

## Path discipline (S99/S126)
- **All edits via Bash** (`perl -i`/`python`/heredoc) on **worktree-absolute paths** with the `.claude/worktrees/agent-<id>/` segment. NOT Edit/Write. Echo target before each write; verify with `git -C "$WORKTREE_ROOT" diff` after.
- **NEVER `cd` into main.** Use `git -C`, `bun --cwd`, absolute paths.
- First commit message includes verbatim `pwd`: `WIP(each-enclosing-scope): start at <pwd>`.

## Commit discipline (S83) — INCREMENTAL IS LOAD-BEARING HERE
- This is TWO bugs done SEQUENTIALLY in one worktree. Commit Bug A (nested-each) FULLY (code + test + green) BEFORE starting Bug B (component-each). If you crash mid-Bug-B, Bug A is recoverable. `git -C "$WORKTREE_ROOT" status` clean before DONE. Update `docs/changes/each-in-enclosing-scope-2026-06-01/progress.md` per step.

## MAPS
`.claude/maps/` refreshed S153 — starting hypothesis; verify against source. Task-Shape: compiler-source codegen.

---

# THE ROOT (one cause, two symptoms — PA-confirmed at HEAD c89c1cb1)

Every `<each>` render fn is emitted at **FILE SCOPE**: `collectEachBlocks(fileAST)` (emit-each.ts) walks the whole file and `emitEachBodyRenderForFile` emits a top-level `function _scrml_each_render_N() { const _items = <source>; ... }` for each. That works when `<source>` is a **top-level reactive cell** (`_scrml_reactive_get("todos")` — in scope at top level), but produces broken JS when the each's source (or its `@.`-bearing body) depends on an **enclosing-scope binding** that only exists inside an enclosing factory/render fn.

## Bug A — nested `<each>` (the documented `as` pattern; primer §6.3)
`repro-1-nested-each.scrml`: `<each in=@groups as g key=g.id> <each in=g.items key=@.id> <li>${@.name}</li> </each> </each>`. The INNER each is lifted to a top-level `_scrml_each_render_12()` that emits `const _items = g.items;` — but `g` (the outer alias) is only bound inside the OUTER each's per-item factory. At top level `g` is `undefined` → runtime `ReferenceError`. Compiles clean; runtime-dead.

**The fix is the EXACT R28-1b precedent, applied to an each-block child instead of a match-block child.** `renderTemplateChildToJs` (emit-each.ts ~line 303-327) ALREADY handles a `<match>` child of an each by: creating an item-local mount, appending it to the item fragment, and calling an ITEM-SCOPED dispatch `__scrml_match_match_<id>_dispatch(mount, <per-item discriminant>)` INSIDE the factory (where the iter var is bound). The nested each-block currently FALLS THROUGH to "unhandled template child kind" (line ~332) — yet `collectEachBlocks` ALSO lifts it to top-level (double-handling: a phantom top-level render fn referencing the outer iter var). Mirror the match case: add an `each-block` branch to `renderTemplateChildToJs` that emits an item-local each-mount + an item-scoped inner-each render call (the inner each's source `g.items` is valid in the factory scope), AND stop `collectEachBlocks`/`emitEachBodyRenderForFile` from emitting the phantom top-level render fn for a nested each. The inner each re-renders per outer item on collection change (the outer factory re-runs via `_scrml_effect_static`). Inner `@.` resolves to the INNER iter var (innermost scope wins — `rewriteContextualSigil` already takes the iter var as a param).

## Bug B — `<each>` in a component body
`repro-2-component-each.scrml`: a component `const TodoList = <ul props={ items: Todo[] }> <each in=items key=@.id> <li>${@.name}</li> </each> </ul>` → `E-SCOPE-001` on `key=@.id` + `E-CODEGEN-INVALID-JS` (`@.name` leaks as bare `.name`). The component body is rendered by the component render fn (component scope, where the `items` prop is bound); the each is again lifted to a top-level render fn that can't see `items` and doesn't resolve `@.`. Fix: emit the component-body each scoped to the component's render fn (where props are bound + `@.` resolves) — the same scoped-emission idea, adapted to the component-expander / `emit-functions.ts` component-render path (survey how component bodies render markup + how the prop scope is established; reuse the Bug-A scoped-each infrastructure if it generalizes).

## What MUST keep working (regression anchors — top-level cell source)
- `anchor-errorboundary-each.scrml` (each in `<errorBoundary>` body) and `anchor-if-each.scrml` (each under `if=`) COMPILE + RENDER today (their each iterates the top-level cell `@todos`). They MUST stay working.
- All S153 fixes: engine-gated-each, each-in-block-form-match, `_scrml_remount_each`, colon-shorthand. R28-1b (`<match>` inside `<each>`). Plain top-level each, `<each of=N>`, `<empty>`, `as` alias, inferred `key=`.

---

# SEQUENCE (do A fully, commit, then B)

1. **SURVEY** (no edits): read `collectEachBlocks` + `emitEachBodyRenderForFile` (emit-each.ts), the R28-1b match-child handling (emit-each.ts ~303-327 + emit-variant-guard.ts `itemScopedDispatch` + emit-match.ts), and the component-render path (component-expander / emit-functions.ts). Confirm the two roots. Write the survey to progress.md.
2. **Bug A — nested each.** Implement item-scoped nested-each emission. Verify (below). Commit.
3. **Bug B — component each.** Implement component-scoped each emission. Verify. Commit.

If Bug B's survey reveals it's much larger than Bug A (component-render architecture doesn't admit the scoped-each infra cleanly), STOP after Bug A, commit A, and report Bug B as needs-rescoping with your findings — do NOT half-land B.

---

# VERIFICATION (S138 R26 — runtime proof for BOTH)

For each bug, on your post-fix baseline:
1. **Compile the repro** — no E-CODEGEN-INVALID-JS / E-SCOPE-001; `node --check` clean on the emitted client.js; the inner/component each's source resolves in scope (NO bare top-level reference to an enclosing binding like `g.items` at module scope; NO bare `.name` leak).
2. **happy-dom test** (mirror `compiler/tests/browser/engine-gated-each-populate.browser.test.js`): load the compiled module in real module-init order and assert the nested / component list ACTUALLY renders the items (`alpha`/`beta`) in the DOM. This is the canary — compile-clean is NOT enough (the engine/match lesson).
3. **Regression:** compile `anchor-errorboundary-each.scrml` + `anchor-if-each.scrml` (must still compile + render). Run the FULL engine + match + each + R28-1b test suites.
4. **Full suite:** `bun --cwd "$WORKTREE_ROOT" run test`. 0 regressions. Parser-shape is unchanged (codegen-only) so no within-node rebump expected — if it flags, investigate (a codegen change shouldn't move parser parity).

DO NOT mark a bug DONE without its happy-dom render test passing + full suite green.

---

# REPORT BACK
- WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, the per-bug commit SHAs.
- Per bug: the root confirmed, the scoped-emission mechanism, whether Bug-B reused Bug-A's infra.
- Empirical: both repros compile + RENDER (happy-dom); anchors still work; full-suite counts.
- If you stopped after Bug A: why, + Bug-B rescoping findings.
- Maps line. Further follow-ups (deeper nesting? each-in-snippet? each-in-match-arm-in-each?).
