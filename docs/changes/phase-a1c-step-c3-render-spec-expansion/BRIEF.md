# Phase A1c — Step C3: Render-spec expansion at `<x/>` use site

**Phase:** A1c (codegen+runtime). Wave 1 (foundational state-decl emission).
**Position:** C3 — third of Wave 1's four steps (C1 ✓ S72, C2 ✓ S72, **C3 next**, C4 closes wave).
**Estimate:** ~4-5 h focused.
**Dispatched:** 2026-05-08 (S73).
**Authority chain:** SPEC §6.4 (Render-By-Tag Semantics) + SPEC §5.4.1 (bind-dispatch table — informational; C3 emits the expansion shape, C4 fills the bind dispatch); L3 (decl-coupled-with-render-spec); L16 (multi-render via existing access paths). SCOPE-AND-DECOMPOSITION row C3 (`docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md:206`).

## Goal (one paragraph)

When a self-closing lowercase markup tag — `<userName/>`, `<agree/>`, etc. — appears in markup body and the tag name resolves to a registered **Shape 2 decl-with-spec** cell (`_cellKind === "bindable"` per A1b B5 + B6), the codegen pass MUST expand that use site into the cell's `renderSpec.element` markup tree, with reactive wiring for the cell's value flowing through. The expansion is identical at every use site (no per-site overrides per §6.4.4). C3 emits the EXPANSION SHAPE only — the actual `bind:value` / `bind:checked` / `bind:files` / `bind:group` dispatch by render-spec element type is C4's territory (§5.4.1 dispatch table). C3's deliverable: `<userName/>` in the source emits HTML that renders the cell's `<input type="text"/>` (or whatever the renderSpec is) at that DOM position, with a hookpoint C4 will wire the bind: dispatch into.

## What's already in place (depth-of-survey signal)

- **AST surface:** `state-decl.renderSpec: RenderSpecNode | null` exists (`compiler/src/types/ast.ts:447-453`); `renderSpec.element` is the bindable markup root. Populated by ast-builder Step 5 (`ast-builder.js:3310`).
- **A1b annotations:** B5 sets `_cellKind` (`"bindable"` for Shape 2 with bindable RHS); B6 fires E-CELL-NO-RENDER-SPEC / E-CELL-RENDER-SPEC-NOT-BINDABLE on illegal use sites. So C3 only needs to handle the LEGAL case — B6 already gated illegal uses out at A1b time.
- **C1+C2 deliverables:** C1 emits the cell-side `_scrml_reactive_set("userName", undefined)` declaration (`emit-logic.ts`) for Shape 2 cells. C2 emits derived-cell reactive computation closures and walks renderSpec.element for derived-dep collection (`emit-logic.ts:331-340, 822-854`). C3 builds on top by emitting the USE-SITE expansion that consumes the cell that C1 declared.
- **Markup walker:** `emit-html.ts:generateHtml` (915 LOC) walks markup AST nodes and dispatches by tag. Render-by-tag for state cells does NOT yet have a branch — C3 adds it. Cross-check `compiler/src/codegen/binding-registry.ts` and `compiler/src/codegen/emit-bindings.ts` for the existing bind-registry surface that C4 will consume.
- **Usage-analyzer:** `usage-analyzer.ts:530` already classifies `usage.renderSpec = true` when a Shape-2 cell exists, and walks renderSpec.element children. C3 may extend this with a use-site flag if useful for Wave-2 tree-shaking.

## Scope (in / out)

**IN scope (C3):**
1. Walker addition in the markup-emit path (most likely `emit-html.ts`; survey may correct to a sibling module): for every self-closing lowercase markup tag whose name resolves to a Shape-2 `bindable` state cell, emit the cell's `renderSpec.element` HTML at that DOM position with a `data-scrml-render-by-tag="<cellName>"` (or equivalent) anchor C4 will use for bind: dispatch.
2. Multi-render correctness (L16): the same cell may appear at multiple use sites in the same scope — each expansion is fresh; reactive value propagation from the underlying cell to all rendered instances is preserved (the underlying reactive cell is shared; the rendered DOM nodes are siblings).
3. **Validators carry forward as HTML attributes** per §6.4.2 step 4 ("Any validators declared on the cell are wired as HTML attributes and connected to the validity surface (§6.11)"). C3 emits the attribute SHAPE; the validity-surface wiring lives at C7+ (synthesis surface). For C3, this means: per the renderSpec.element's existing attributes plus any predicate attributes lowered to HTML (e.g., `req` → `required`, `pattern(re)` → `pattern="..."`, `min(N)` → `min="N"` where the HTML semantic exists). Survey-first whether attribute-registry.js / emit-html already emits these — if they do, C3 just routes through.
4. Tests covering: single-use-site expansion (text input cell); multi-use-site expansion (same cell rendered twice in different markup positions); validator attribute carry-forward (req/pattern/min/max where HTML-native); compound-child render-by-tag (`<formRes><name/></>` per §6.3 — `name` is a Shape-2 cell inside the compound).

**OUT of scope (deferred):**
- bind: dispatch by render-spec element type (`bind:value` / `bind:checked` / `bind:files` / `bind:group`) — that's **C4** per SCOPE table.
- Validity-surface wiring (`@cell.isValid` / `.errors`) — **C7+ Wave 3**.
- Component render-specs (PascalCase tags) — defer per A1b B6 specifics ("Component RHS render-specs DEFERRED" until B14/M18/M20 component prop catalog lands; A1b B6 v1 accepts silently). C3 mirrors: PascalCase use-sites pass through emit-html unchanged.
- Markup-typed Shape 3 cells (`const <badge> = <span>...</span>`) at use site as `<badge/>` — per §6.4.1 / §6.4.3 this is **NOT supported**; use `${@badge}` interpolation instead. B6 already fires E-CELL-NO-RENDER-SPEC on `<badge/>`. C3 does not need to handle this case.
- `<errors of=expr/>` — C11.
- `<x/>` for engine state-children (`<engine for=Phase>`'s `<Loading/>`, `<Idle/>`, etc.) — engine code path is C12-C15.

## Spec verification (pa.md Rule 4)

I (PA) verified the following spec claims before encoding them in this brief:

- **§6.4.1 — Cell-kind table.** Shape 1 plain → E-CELL-NO-RENDER-SPEC. Shape 2 decl-with-render-spec → expands to bound input with bind: dispatch. Shape 3 numeric/string derived → E-CELL-NO-RENDER-SPEC. Shape 3 markup-typed derived → use `${@varname}` interpolation, NOT `<varname/>`. (`SPEC.md:1899-1907`.) ✓
- **§6.4.2 — Shape 2 expansion.** Compiler looks up renderSpec, emits the markup, wires bind:, validators wire as HTML attrs + validity surface. (`SPEC.md:1908-1916`.) ✓
- **§6.4.4 — No runtime overrides.** Render-spec is decl-site authoritative; no per-site override syntax. (`SPEC.md:1931-1933`.) ✓
- **§5.4.1 — Bind-dispatch table.** Compiler dispatches bind: by render-spec element type (text → bind:value, checkbox → bind:checked, file → bind:files, radio → bind:group). (`SPEC.md:1318-1343`.) ✓ Informational for C3; load-bearing for C4.

## Dispatch protocol (worktree-as-scratch + file-delta landing)

This dispatch follows the S67 standing rule (`pa.md:352-415`): worktree-as-scratch with PA-side `git checkout <branch> -- <files>` landing. Agent does NOT need to fight the harness on branch names; commit incrementally per global crash-recovery directive.

**On completion, agent reports:**
- WORKTREE_PATH
- FINAL_SHA
- FILES_TOUCHED list
- Tests pass count delta vs baseline (baseline at S73 open: **9,872 / 60 / 1 / 0** via `bun run test`)
- Any deferred items + reasoning (per depth-of-survey: brief authorizes touchpoint correction)

**PA will:**
1. Diff `main..<agent-branch>` filtered to FILES_TOUCHED
2. `git checkout <agent-branch> -- <files>` to land
3. Single PA-authored commit to main (with explicit user authorization)
4. Worktree branch retained for forensic

## Authorized decisions

- **File locus:** SCOPE names `codegen/markup-emit.ts` (which doesn't exist). The actual markup emitter is `compiler/src/codegen/emit-html.ts`. **Agent is authorized to correct the locus** per depth-of-survey-discount (PA-PRIMER §12, S64 amendment) — if the survey reveals the right home is `emit-html.ts` (likely) or a NEW sibling for cleanliness, proceed without re-asking.
- **Commit cadence:** WIP commits are expected per global crash-recovery directive. Branch-name-doesn't-have-to-match-brief.
- **Test addition:** add unit test file `compiler/tests/unit/c3-render-spec-expansion.test.js` (mirrors C1+C2 naming convention).

## Anti-patterns reading (mandatory)

This is a **compiler TS dispatch** (NOT scrml-writing). Skip the LLM kickstarter (which is for agents writing scrml code). Read for context:
- `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — JSX/React/Vue/Svelte reflex catalog; relevant if you find yourself reaching for framework idioms while reasoning about markup expansion semantics.

## File-modification inventory expected

| File | Reason |
|---|---|
| `compiler/src/codegen/emit-html.ts` (most likely) OR new sibling | render-by-tag walker addition |
| `compiler/src/codegen/binding-registry.ts` (likely) | record render-by-tag use-sites for C4 bind dispatch |
| `compiler/src/codegen/runtime-template.js` (possible) | hookpoint helper if needed |
| `compiler/tests/unit/c3-render-spec-expansion.test.js` (NEW) | unit test coverage |
| `docs/changes/phase-a1c-step-c3-render-spec-expansion/progress.md` (NEW, append-only) | crash-recovery progress trace |
| `docs/changes/phase-a1c-step-c3-render-spec-expansion/SURVEY.md` (NEW) | survey output if depth-of-survey reveals corrections |

## Definition of Done

- All authorized items in §scope IN landed.
- Test count: 0 regressions vs baseline (9,872 pass / 0 fail). Net delta: +N pass tests (forecast +15 to +30 per Wave-1-step velocity).
- Spec claims verified against SPEC.md text directly (Rule 4).
- Progress.md captures incremental commits.
- Final report includes the worktree-as-scratch deliverables list.

## Cross-refs

- C1 brief + survey: `docs/changes/phase-a1c-step-c1-shape-aware-cell-emit/`
- C2 brief + survey: `docs/changes/phase-a1c-step-c2-derived-reactive-computation/`
- A1c parent: `docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md`
- Master-list §0.1 (A1c row): `master-list.md`
- Primer §13.7 B5 + B6 specifics: `docs/PA-SCRML-PRIMER.md`
