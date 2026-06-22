# ss15 item-2 — `g-on-mount-bare-call-render-slot` (sPA ss15 dispatch brief)

> Archived per pa.md S136. change-id: `ss15-item2-onmount-render-slot-2026-06-22`. Agent: `scrml-js-codegen-engineer`, `isolation:"worktree"`, `model:opus`. Landed by sPA on `spa/ss15`. Base: `origin/main` 1ce8de34. **This touches `emit-html.ts` core render-slot allocation — SCOPE-FIRST, report before band-aiding.**

## The bug + FOOTPRINT CORRECTION (sPA R26-verified — the original list matrix was WRONG)
A bare expression-statement in a logic-context body is emitted with a spurious render slot: a `<span data-scrml-logic>` + an `addLogicBinding` that becomes `_scrml_render_value(el, <expr>)`, printing the statement's return as a text node (async fn → visible "[object Promise]" at page top).

**Root cause:** `stmtContainsRenderableLogic(node)` (`compiler/src/codegen/emit-html.ts:113`) returns `true` for ANY `bare-expr` node. The logic-node handler (`emit-html.ts` ~line 2200, and the body-walk at ~2275–2312) then, when `bodyHasRenderableContent` is true, allocates a `data-scrml-logic` placeholder span AND calls `registry.addLogicBinding({placeholderId, expr,…})` for each `bare-expr` child → the reactive-display wiring emits `_scrml_render_value`.

**sPA empirical findings (these CORRECT the list's briefSeed matrix — verify them yourself):**
- `on mount { val() }` (val returns 42) → BOTH a correct mount effect `_scrml_val_2();` AND a spurious `_scrml_render_value(el, _scrml_val_2())`. (`/tmp/onmount-repro.scrml`)
- **The bug is NOT `on mount`-specific:** a bare `${ val() }` at `<program>`-body level emits the SAME spurious slot. (probe: `<program> fn val(){return 42} ${ val() } <div>hi</div> </program>`)
- **The briefSeed's "pure-assignment body = 0 slots" is WRONG:** `on mount { @x = val() }` ALSO emits a spurious slot (`_scrml_render_value(el, _scrml_reactive_set("x", _scrml_val_2()))`).
- **CRITICAL over-fix guard:** a call in MARKUP-INTERPOLATION position — `<div>${ val() }</div>` — emits the SAME `_scrml_render_value(el, _scrml_val_2())`, but THERE IT IS CORRECT (the div must render 42). The two positions emit byte-identical code today; the handler cannot currently tell them apart.

## The SPEC (R4 — read before fixing)
- **§6.7.1a** `on mount { body }`: "SHALL execute `body` exactly once after the first DOM render … SHALL be desugared to a bare expression before the TAB pass completes." It is an EFFECT, not a render.
- **§17.3** Lifecycle of Bare Expressions: "A bare expression in a **logic context** … executes at initial render. `${ loadItems() }` — calls `loadItems()` once, at initial mount." A logic-context bare expression is an EFFECT; it does NOT render its return value.
- **§40.8** program/component body is **default-logic** mode (bare statements are logic/effects). A markup element's body is markup mode (interpolations RENDER).

→ The rule is **POSITIONAL**: a `${...}` / desugared-`on mount` bare-expr in a **default-logic body** (program / component root / lifecycle-hook) is an EFFECT (no render slot). A `${...}` interpolation that is a **child of a markup element** RENDERS (keep current behavior).

## THE WORK — Phase 0 SCOPE-FIRST (report before writing the fix)
The fix MUST be keyed on POSITION, NOT on expression type. Do NOT make "calls don't render" — that would break `<div>${formatName()}</div>` / `<span>${items.length}</span>` (the overwhelmingly common render case). 

Phase 0 — map and REPORT:
1. In the `emit-html.ts` markup walker, how does the `node.kind === "logic"` branch (~line 2200) know its enclosing context? Find the signal that distinguishes (a) a logic node that is a child of a real markup element (interpolation → render) from (b) a logic node at `<program>`/component-root / a desugared `on mount` body (default-logic → effect). Candidates: a walk-time parent/mode flag, the parent element kind, or an AST annotation on the desugared `on mount`/program-body logic node.
2. Confirm how `on mount {}` desugars (grep `on mount` / `on-mount` in the parser/TAB pass + ast-builder) and whether the desugared node carries a "lifecycle/effect" marker you can key on.
3. REPORT the chosen discriminator + the blast radius (how many corpus samples shift) BEFORE applying.

**The fix:** when a logic node is in default-logic/effect position (program/component-body bare statement OR desugared lifecycle-hook body), its bare-expr children run as file-scope/mount effects (that emission already happens — the `_scrml_val_2();` line) and MUST NOT allocate a `data-scrml-logic` span or call `addLogicBinding`. Markup-interpolation logic nodes are UNCHANGED.

## Corrected behavior matrix (sPA-verified targets — assert these)
| source | render slot? |
|---|---|
| `<program> ${ val() } …` (bare call, program-body) | **0** (effect only) |
| `on mount { val() }` | **0** (effect only) |
| `on mount { @x = val() }` | **0** (effect only; assignment runs) |
| `on mount { @x = 5 }` (pure assignment) | **0** |
| `<div>${ val() }</div>` (markup interpolation) | **1** (UNCHANGED — renders) |
| `<div>${ @count }</div>` (markup interpolation) | **1** (UNCHANGED) |
| `<span>${ items.length }</span>` | **1** (UNCHANGED) |
Cover BOTH default-logic mode AND `${}` mode. A trailing assignment does NOT suppress/alter sibling statements.

## R26 EMPIRICAL VERIFICATION (S138 — before DONE)
Recompile `/tmp/onmount-repro.scrml` + the bare-`${ val() }` probe + a `<div>${ val() }</div>` markup-interp control. Verify: logic-position cases emit the mount effect call but ZERO `_scrml_render_value` / ZERO `data-scrml-logic` span; the markup-interp control STILL emits its render slot unchanged. `node --check` clean. Paste before/after client.js + html shape evidence for all three.

## TESTS
Add tests asserting the matrix above (grep existing `data-scrml-logic` / `_scrml_render_value` / `on mount` tests under `compiler/tests/`). The markup-interpolation-still-renders cases are the regression guard. Coupled code+test = ONE commit (S113).

## MANDATORY (F4 / S99-S126 / S83 / S198)
- **F4 startup:** `pwd` MUST contain `.claude/worktrees/agent-`. `bun install --cwd "$WORKTREE_ROOT"` + `bun run --cwd "$WORKTREE_ROOT" pretest` before work.
- **Path discipline:** ALL edits via Bash (`perl`/`python3`/heredoc) on WORKTREE-ABSOLUTE paths; NEVER `cd` into a main checkout; NO Edit/Write tools. First commit message includes verbatim `pwd`.
- **Tests:** `emit-html.ts` is CORE — run the FULL `bun run --cwd "$WORKTREE_ROOT" test` (incl. browser + within-node parity canary) before DONE. Re-baseline any shifted within-node fixture (`M6.5.b.0` allowlist — set per-class to printed `raw`, in-place, key order preserved) IN THE SAME LANDING. Expect corpus client.js/html snapshot shifts for samples with program-body/lifecycle bare-exprs — re-baseline them honestly and LIST what shifted.
- Commit incrementally; `git status` clean before DONE; NEVER `--no-verify`. Progress → `$WORKTREE_ROOT/docs/changes/ss15-item2-onmount-render-slot-2026-06-22/progress.md`.

## REPORT BACK
WORKTREE_PATH · FINAL_SHA · AGENT_BRANCH · FILES_TOUCHED (worktree-absolute) · Phase-0 discriminator finding · matrix R26 evidence (all 3+ shapes) · full-suite pass/skip/fail · within-node re-baseline + list of shifted snapshots. sPA lands via S67 file-delta onto `spa/ss15`.
