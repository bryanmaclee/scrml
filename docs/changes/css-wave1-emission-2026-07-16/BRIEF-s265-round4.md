# CSS Wave-1 EMISSION — round 4 (land-prep build) — dev brief

You are `scrml-js-codegen-engineer`. You are finishing the **CSS Wave-1 emission arc (§65)** so it can land. The emission core is ALREADY BUILT on the base branch (theme→:root token lowering, `.Variant`/`@media` variant selectors, the §65.3.4 reset layer, `:where()`-flat, the `@`-sigil token model, component-scope-beats-program-global via `@layer`). Your job is FOUR remaining pieces + their SPEC/tests/conformance, then a clean R26 empirical pass. Do NOT re-touch the already-built core except where a task below says so.

Model: Opus. Isolation: worktree (you are in a fresh worktree — see F4).

---

## CRITICAL — F4 STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST, before any other work)

PATH-DISCIPLINE INCIDENT COUNTER: (leaks-to-main this arc: 0 — keep it 0)

1. **Verify + set your base.** Run:
   - `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report — you are in the wrong repo/worktree.
   - `git rev-parse --abbrev-ref HEAD` and `git status --short`.
   - **Base your work on the rebased CSS branch:** `git reset --hard feat/css-wave1-emission` (this is commit `07a1a694`, already rebased onto current `main` `c82550dd`). Confirm with `git log --oneline -1` → should show `... [2] component-scope beats program-global via @layer`. After `git fetch origin`, confirm `git rev-list --count HEAD..origin/main` is 0 (you are current with main). (Note: `git reset --hard feat/css-wave1-emission` is correct — do NOT `git checkout feat/css-wave1-emission`, it is checked out in another worktree.)
2. **Deps + fixtures:** `bun install` (worktrees do NOT inherit node_modules — the `acorn` error means you skipped this) then `bun run pretest` (populates gitignored `samples/compilation-tests/dist/` — ~130 ECONNREFUSED fails without it). If a browser test needs `dist/`, symlink from `/home/bryan-maclee/scrmlMaster/scrml/dist` (gitignored ENV, not a regression).
3. **Baseline:** `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` — the PA verified this base is GREEN (20641 pass / 0 fail). Confirm you see 0 fail before changing anything; if not, report the exact fails before proceeding.
4. **Path discipline (per edit):** every Write/Edit/Bash-write targets an ABSOLUTE path under your worktree root. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml` (the main checkout). Use `git -C "$PWD"`, `bun --cwd "$PWD"`, worktree-absolute paths only. Prefer editing via Bash on absolute worktree paths (echo before, `git diff` after) — the path-discipline hook does not catch Bash writes.
5. **Commit incrementally** — after EACH task below, `git add -A && git commit` (WIP commits fine). Append a timestamped line to `docs/changes/css-wave1-emission-2026-07-16/progress.md` (it already exists — APPEND, do not overwrite). The branch + progress.md are your crash-recovery anchor. Commit foreground; the pre-commit gate (`bun test compiler/tests/{unit,integration,conformance} --bail`, ~120s) runs — do NOT `--no-verify`.

## MAPS — REQUIRED FIRST READ
Read `/home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md` FIRST (stamp `commit: 0a79d838`; HEAD is `c82550dd` = a docs-only wrap, so the map is CURRENT for code navigation). Follow its Task-Shape Routing to the codegen maps. The pipeline is `compileScrml()` in `compiler/src/api.js` (block-split → AST-build → type-check → codegen); §65 CSS emission lives in `compiler/src/codegen/`. Treat map content as a verify-against-source hypothesis; report which map entries were load-bearing (incl. "not load-bearing").

## Anti-pattern briefing (for the conformance `.scrml` you author)
Skim `docs/articles/llm-kickstarter-v2-2026-05-04.md` (canonical scrml shape + stdlib) + `../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` before writing any `.scrml` case — counters the React/Vue reflex. V5-strict decl/access: `<count>=0` declares, `@count` reads. No `null`/`undefined` (use `not`). No try/catch (use `!{}`). No async/await.

---

## THE NORMATIVE SOURCE — read §65 BEFORE coding
Read `compiler/SPEC.md` §65 IN FULL (search `## 65. The scrml-native CSS Model`, ~line 35230-35620) + §25.7 (`<theme>` lowering) + §65.6 (reactive theming) + §65.8 (the `@layer` order). The base branch already amended §65.3.2/§65.5/§65.6/§65.8/§25.7 to the `@`-sigil form and the `reset, global` Wave-1 layer sub-order. SPEC is normative (Rule 4). Every code you fire must have a §34 catalog row (land the row WITH the impl).

Key spec facts you will rely on:
- §65.3.2: a token DECLARED bare in `<theme>` (`brand = #2563eb`), REFERENCED with the `@` sigil (`color: @brand`) → `var(--brand)`. A bare identifier (`color: red`) is literal CSS, never a token. `@name` ∉ (theme tokens ∪ declared cells) → `E-THEME-TOKEN-UNKNOWN`.
- §65.6: `<theme for=@cell>` binds variant sub-blocks (`.Dark { … }`) that re-bind a subset of tokens; switching `@cell` (`@mode = .Dark`) re-binds the active custom-property set — "the whole page flips." The variant selector emitted is `:root[data-scrml-theme-<cell>="Dark"] { … }`.
- §65.8 Wave-1 emission ships `@layer reset, global;` with the component author scope UNLAYERED (unlayered > every layer). `<theme>` :root custom-property definitions are UNLAYERED (they define var VALUES). Full §65.8 `reset,thirdparty,base,tokens,utilities,author` chain + Tailwind-in-utilities-layer is Wave-3 (DO NOT build it here).

---

## THE FOUR TASKS

### TASK 1 — [399] `@import` / `@charset` must not be trapped in `@layer global {}` (REGRESSION, drops sheets)
Program-global `#{}` CSS is wrapped in `@layer global { … }` (`emit-css.ts` ~line 399). But `@charset` and `@import` are INVALID inside a `@layer` block → the browser drops them (a regression vs the pre-Wave-1 verbatim emission). Corpus exposure today is ~0, but it is a real correctness regression — fix it right.
- **Fix:** before wrapping `programGlobalCss` in `@layer global {}`, EXTRACT any top-level `@charset "...";` and `@import ...;` statements and HOIST them to the correct stylesheet position. CSS ordering law: `@charset` MUST be the very first thing in the stylesheet (byte 0); `@import` MUST come after `@charset` and after any `@layer name;` statement, but BEFORE any style rule or `@layer {}` block. So emitted order becomes: `@charset` → `@layer reset, global;` (order decl) → `@import`s → `@layer reset {…}` → `@layer global { <rest, imports stripped> }` → unlayered component/theme.
- Only hoist TOP-LEVEL `@charset`/`@import` from the program-global block (not ones nested inside other at-rules). Preserve their source order among themselves.
- **Test:** a program-global `#{}` containing `@import url("x.css");` → emitted CSS has the `@import` at top level (NOT inside `@layer global`), and the rest of the program-global rules stay in `@layer global`. Add to `compiler/tests/unit/css-wave1-emission.test.js`.

### TASK 2 — [86] flat-inline `#{}` token lowering (make `@token` work in the dominant `#{}` pattern)
`renderFlatDeclarationAsInlineStyle` (`emit-css.ts:73`, called from `emit-html.ts:1902`) emits a flat inline `#{}` (e.g. `<div #{ color: @brand }>`) to a `style="…"` attribute — but it does NOT run the token-lowering, so `@brand` passes through verbatim (invalid / no-op). The selector-path already lowers via `lowerCssValueRefs`; the flat-inline path does not. This is the DOMINANT `#{}` corpus pattern — the theme feature must work there.
- **Fix:** thread the theme context (token names + declared cell names, from `collectThemeContext` in `emit-theme-reset.ts`) into `renderFlatDeclarationAsInlineStyle` and its `emit-html.ts` call site, and run `lowerCssValueRefs` on each declaration value so `@brand` → `var(--brand)` (theme) / `var(--scrml-name)` (cell) / `E-THEME-TOKEN-UNKNOWN` (neither). Match the exact membership + error semantics the selector path uses (do NOT fork the logic — reuse `lowerCssValueRefs`).
- Threading the theme context to the emit-html flat path may require passing it through the emit-html call chain — do this minimally; follow how `emit-css.ts` already obtains `collectThemeContext`.
- **Test:** `<div #{ color: @brand }>` with `<theme> brand = #2563eb </theme>` → emitted `style="color: var(--brand)"`; unknown `@nope` → `E-THEME-TOKEN-UNKNOWN`; bare `color: red` → untouched.

### TASK 3 — descendant-combinator space collapse in component-scope selectors (pre-existing silent MISCOMPILE)
A component `#{ .card .title { } }` tokenizes to selector `.card.title` — the descendant SPACE is LOST, so a descendant selector silently becomes a COMPOUND selector (matches an element with BOTH classes, not a descendant). Program-level `#{}` preserves the space; only the component path collapses it. Pre-existing on the base (NOT introduced by this arc) — the CSS agent confirmed `wrapSelectorWhere` receives `.card.title` (space already gone upstream). It is a silent miscompile sitting in the code you are touching — fix it.
- **Find** where component-scope `#{}` selectors are tokenized/collected (`collect.ts` and the component CSS path) and where the descendant space is dropped. Fix so `.card .title` stays `.card .title` (descendant) through `:where()` wrapping → `:where(.card .title)`.
- Be surgical: do NOT change compound-selector behavior (`.card.title` with no space must stay compound). Only the whitespace-descendant-combinator is being lost; restore it.
- **Test:** a component with `#{ .card .title { color: red } }` → emitted selector contains `.card .title` (with the space, as a descendant), wrapped `:where(.card .title)`. Add a regression test.

### TASK 4 — runtime theme-switch (§65.6 client half) — the headline: make themes ACTUALLY switch
Currently `<theme for=@cell>` emits the `:root[data-scrml-theme-<cell>="Dark"]` variant selectors, but NOTHING reflects the bound cell's active variant onto `<html>` at runtime → **the theme never switches when `@cell` changes** (verified: zero `data-scrml-theme` reflection in `emit-client.ts`). Wire the client-side reflection so §65.6's promise ("switch the cell → the whole page flips") holds.
- **Contract to emit:** for each `<theme for=@cell>`, emit a client-side reactive binding that, at MOUNT and on EVERY `@cell` change, sets `document.documentElement.setAttribute("data-scrml-theme-<cellName>", <activeVariantTagName>)`. The attribute name (`data-scrml-theme-<cellName>`) MUST match the emitted variant selector's attribute exactly. The value is the enum-variant TAG name string (`@mode = .Dark` → `"Dark"`).
- At initial mount, set the attribute to the cell's INITIAL variant (so the first paint matches the reactive cell's initial value).
- Reuse the EXISTING reactive-cell subscription machinery in `emit-client.ts` (find how a reactive cell's subscribers/effects are emitted; the enum-variant cell's active tag name is already computed somewhere for rendering — reuse it, do NOT reinvent variant→string). Look at how `emit-each.ts` does `setAttribute("data-scrml-...")` for a DOM-attr precedent (line ~566).
- The `@media (prefers-color-scheme: dark)` auto-bind variant is CSS-native (the media query selects) and needs NO runtime reflection — only the manually-switched CELL variant needs the data-attr. Both coexist: emit the cell reflection regardless; the `@media` variant just works on top.
- **SSR/placement:** if there is a server-prerender path, the initial `data-scrml-theme-<cell>` should also be present on the prerendered `<html>` so there is no flash (best-effort — if the SSR path makes this hard, emit the client-side init and NOTE the SSR flash as a follow-on; do not block the task on SSR).
- Likely NO new §34 code (reuse existing cell/variant diagnostics). If you find a genuinely-needed new diagnostic, NAME it, add the §34 row, and FLAG it in progress.md for PA review.
- **Test:** compile a `<theme for=@mode>` app; assert the emitted CLIENT bundle contains the `setAttribute("data-scrml-theme-mode", …)` reflection wired to `@mode`'s subscription, AND the initial-mount set. A browser/integration test that toggles `@mode` and checks `<html>`'s attribute updates is ideal if the harness supports it; otherwise a codegen-shape assertion on the emitted client JS.

---

## SPEC AMENDMENTS (land WITH the impl — Rule 4)
- **§65.6:** add a normative paragraph: the bound cell's active variant is reflected onto `:root` as `data-scrml-theme-<cell>` by a **compiler-emitted client-side reactive binding** (mount + on-change); this is what realizes "switch the cell → the whole page flips." Flip the §65.6 runtime half from Nominal to Implemented.
- **§65.4 / §65.3.2:** if either carries a Nominal note that flat-inline `#{}` token lowering is not covered, update it — it is now covered (Task 2).
- **§65 top banner (~line 35232):** update the "remaining compiler wiring" list to reflect what is now Implemented after this round (token→:root lowering, reset layer, :where()-flat, `@`-sigil use-site check, flat-inline lowering, runtime theme-switch). Leave genuinely-deferred items (style-as-value §65.4 Wave-2, full §65.8 Tailwind-layer Wave-3, `--explain-style`) marked as follow-on.
- Regenerate the §34 line ranges if you add/move rows: `bun run scripts/regen-spec-index.ts`.

## CONFORMANCE
Add conformance cases under `conformance/cases/style/` for the new behavior where it is DATA-testable (emitted-CSS / emitted-JS shape + codes): flat-inline token lowering (pos + unknown-neg), the descendant-space preservation (pos), the `@import` hoist (pos). The runtime-switch is client-JS — a conformance case can assert the emitted client bundle contains the reflection if the harness captures client output; else cover it by unit test. Run `bun conformance/run.ts` — report the case count delta.

## R26 EMPIRICAL (do NOT mark DONE without this)
After all 4 tasks + SPEC + tests are green:
1. Recompile the arc's themed-app repro `docs/changes/css-wave1-emission-2026-07-16/repros/themed-app.scrml` on your final baseline: `bun compiler/bin/scrml.js compile <repro> --output-dir /tmp/css-r26`. Verify: (a) the client bundle contains the `data-scrml-theme-<cell>` reflection; (b) flat-inline `@token` lowers to `var(--...)`; (c) no `@import`/`@charset` trapped in `@layer`.
2. Recompile 2-3 real adopter `.scrml` that use `#{}` styling (grep `samples/` / `examples/` for `#{`), confirm NO regression in their emitted CSS (compare byte-shape sanity; theme features are additive).
3. Full gate: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` → all green (report counts vs baseline 20641 pass / 0 fail). If any browser/lsp/self-host test is touched by your change, run `bun run test`.
4. Append an R26 result block to progress.md with the exact symptom-gone checks (NOT "tests pass" — the specific grep/shape checks above).

## FIRST COMMIT — archive this brief
Your FIRST commit: write this brief VERBATIM to `docs/changes/css-wave1-emission-2026-07-16/BRIEF-s265-round4.md` and commit it. Then proceed task-by-task, one commit each.

## DONE REPORT (return to the PA)
Report: your worktree path; the FINAL commit SHA; files-touched (grouped by task); the baseline→final test/conformance counts; the R26 symptom-gone results; any new §34 code you added (with rationale); anything you DEFERRED or could not close (SSR flash, etc.); and which map entries were load-bearing. Do NOT claim "done" without the R26 empirical block. The PA runs an independent S239 adversarial review on your diff before landing — surface any shape you are unsure about so it gets scrutiny.
