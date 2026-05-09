# A1c C3 Progress — Render-spec expansion at `<x/>` use site

Append-only timestamped log. Each line: what was done, what's next, blockers.

## 2026-05-08 S73 startup

- pwd → `.claude/worktrees/agent-a32259110ec3b4011`. Tree clean. `bun install` (114 packages) + `bun run pretest` (12 samples) ran cleanly.
- Baseline `bun run test` → **9,872 pass / 60 skip / 1 todo / 0 fail / 34,278 expects** (confirms brief's stated baseline).
- Read brief, SPEC §6.4, SPEC §5.4.1, PA-PRIMER §13.7 + §11, C1 SURVEY (full), C2 SURVEY (full), `emit-html.ts` (915 LOC full), `binding-registry.ts` (full), `emit-bindings.ts` (lines 1-505), `emit-logic.ts` (state-decl arm), `emit-lift.js` (`emitCreateElementFromMarkup`), `usage-analyzer.ts`, `context.ts`, `symbol-table.ts` (`runSYM` + `lookupStateCell` + B6 walker).
- Verdict: PROCEED-AS-BRIEFED. Locus confirmed = `emit-html.ts`. Estimate revised to ~3.5h (down from 4-5h). All required infrastructure exists.
- SURVEY.md written.
- Next: WIP-2 — LogicBinding shape extension + lookupStateCell wiring.

## 2026-05-08 S73 — WIP-2 (LogicBinding shape extension + import wiring)

- Extended `LogicBinding` in `compiler/src/codegen/binding-registry.ts`:
  - Added `"render-by-tag"` to the `kind` discriminator union.
  - Added 4 new optional fields: `cellName`, `renderSpecTag`, `renderSpecAttrs`, `declValidators`.
  - Documentation comment block describes the C3 → C4 contract.
- Added `import { lookupStateCell, getCellKind } from "../symbol-table.ts"` to `emit-html.ts`.
- Pre-commit hook passed; full test suite 9,872/60/1/0 unchanged.
- Commit: `77720e7`. Next: WIP-3 — render-by-tag dispatch in emit-html.

## 2026-05-08 S73 — WIP-3 (render-by-tag dispatch + validator-attrs helper)

- Added `_validatorAttrsForCell(declNode)` helper at top of `emit-html.ts` (~80 LOC) — lowers HTML-native validators (`req`, `pattern`, `min`, `max`, `length(>=N)`, `length(<=N)`, `length(=N)`) to HTML attributes per SPEC §6.4.2 step 4.
- Added `fileScope` resolution in `generateHtml`: `const fileScope = fileAST?._scope ?? null;`. Defensive: tests bypassing SYM don't trigger the render-by-tag path.
- Added the render-by-tag dispatch branch in the markup case of `emitNode`, immediately before the generic `<${tag}` open emission. The branch:
  1. Filters: self-closing + lowercase + not void/lifecycle/input-state/request/timeout/channel/etc
  2. Resolves the tag via `lookupStateCell(fileScope, tag)`
  3. Verifies `getCellKind(declNode) === "bindable"`
  4. Emits the cell's `renderSpec.element` markup tree at this DOM position via `emitNode` re-entry, with augmented attributes:
     - The renderSpec's existing attributes (decl-site authoritative)
     - Validator-derived HTML attrs (from `_validatorAttrsForCell`)
     - The C4 hookpoint: `data-scrml-render-by-tag="<id>"`
  5. Records a `LogicBinding { kind: "render-by-tag", placeholderId, cellName, renderSpecTag, renderSpecAttrs, declValidators }` for C4.
- Pre-commit hook passed; full test suite still 9,872/60/1/0 (no test added yet, only wiring).
- Commit: `90106fe`. Next: WIP-4 — unit test suite.

## 2026-05-08 S73 — WIP-4 (c3-render-spec-expansion.test.js)

- Wrote `compiler/tests/unit/c3-render-spec-expansion.test.js` — 23 tests across §C3.1-§C3.11.
- All 23 pass on first run. Coverage:
  - §C3.1: single-use-site (text/email)
  - §C3.2: multi-use-site (L16) with distinct hookpoint ids
  - §C3.3: validator carry-forward (req/length(>=N)/length(<=N)/length(=N)/min/max/multi/non-HTML-native)
  - §C3.4: render-spec shapes (checkbox/file/radio/textarea)
  - §C3.5: compound child render-by-tag
  - §C3.6: hookpoint registration shape (C4 contract)
  - §C3.7: Shape 1 plain doesn't expand
  - §C3.8: PascalCase tag skips
  - §C3.9: HTML built-in `<br/>` / `<hr/>` skips
  - §C3.10: defensive — no `_scope` falls through to raw tag
  - §C3.11: output stability for non-Shape-2 markup + `${@x}` interpolation regression
- Full suite: **9,895 pass / 60 skip / 1 todo / 0 fail / 34,338 expects** (+23 vs baseline 9,872).
- Commit: `d1b68d8`. Next: WIP-5 — finalize report.

## 2026-05-08 S73 — WIP-5 (final report)

- Status: SHIPPED.
- Tests: baseline 9,872 / 60 / 1 / 0 → final 9,895 / 60 / 1 / 0 (+23 pass, 0 regressions).
- Files touched:
  - `compiler/src/codegen/binding-registry.ts` (LogicBinding extension)
  - `compiler/src/codegen/emit-html.ts` (helper + import + dispatch branch + fileScope binding)
  - `compiler/tests/unit/c3-render-spec-expansion.test.js` (NEW, 508 LOC, 23 tests)
  - `docs/changes/phase-a1c-step-c3-render-spec-expansion/SURVEY.md` (NEW)
  - `docs/changes/phase-a1c-step-c3-render-spec-expansion/progress.md` (NEW, this file)
  - `docs/changes/phase-a1c-step-c3-render-spec-expansion/BRIEF.md` (copied from main; not modified)
- Hookpoints left for C4: `registry.logicBindings.filter(b => b.kind === "render-by-tag")` returns entries with `{placeholderId, cellName, renderSpecTag, renderSpecAttrs, declValidators}`. C4 selects bind:* dispatch from renderSpecTag + renderSpecAttrs (`type=...`) per SPEC §5.4.1; emits the actual `inputElement.value = _scrml_reactive_get("cellName")` + event-listener wiring keyed off `[data-scrml-render-by-tag="<id>"]`.
