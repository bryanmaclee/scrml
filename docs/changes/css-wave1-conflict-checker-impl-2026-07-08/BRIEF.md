# BRIEF — CSS Wave-1: the `E-STYLE-CONFLICT` checker as a real pipeline pass (with R1/R2/R3)

**Dispatched:** S246, 2026-07-08. **Agent:** scrml-js-codegen-engineer, iso:worktree. **Scope:** the CHECKER ONLY.

## The task
Turn the calibrated dry-run prototype into a **real compile-pipeline pass** that emits the flagship styling diagnostics:
- **`E-STYLE-CONFLICT`** (hard error) — a proven unconditional same-property overlap at the same precedence level.
- **`W-STYLE-CONFLICT-POSSIBLE`** (soft/info) — the fail-closed residue (unprovable pairs).
…implementing the **ratified R1/R2/R3 carve-outs** (now normative in SPEC §65.2.4). This is the V1.0-gating Wave-1 flagship — the styling analog of exhaustive `match`.

**FIRST: `git merge main`** — you need the landed SPEC §65 + the R1/R2/R3 amendments (`10d54ff3`) + the E-COMPONENT-021 sample fix (`de490c29`) + current `compiler/src`.

## Design authority (READ — locked, implement don't re-design)
`compiler/SPEC.md`: **§65.2** (flat specificity + E-STYLE-CONFLICT), **§65.2.1–65.2.3** (unconditional=error; conditional rules=deterministic LAYERS not conflicts; same/cross-axis recursion), **§65.2.4** — the decidable core + fail-closed residue **+ the "Wave-1 calibration carve-outs (R1–R3)" block** (THE spec for what you implement), **§65.5** (precedence, incl. the R1 universal/bare-root layer), **§65.10** (the code table), **§65.11** (the dry-run outcome that produced R1/R2/R3).

## Reference implementation (port it — the §65.2.4 core is already written)
`compiler/scripts/css-conflict-dryrun.ts` (742L, the calibration analyzer). It already implements the decidable core (prove-shared / prove-disjoint against the scope's markup element-set), the conditional-layer carve-out, and the reactive-class-toggle handling. **Port its logic into the pipeline** — but note it was report-only + self-contained; the real pass uses the live infra and emits into the diagnostic stream. The dry-run FLAGGED R1/R2/R3 as recommendations; **the real pass must IMPLEMENT them** (they're now spec).

## The R1/R2/R3 carve-outs the pass MUST implement (§65.2.4)
- **R1** — a universal `*` or bare-root (`html`/`body`) selector rule is a LOWER LAYER (author-reset floor), NOT a same-level conflict. An overlap between a `*`/`html`/`body` rule and a class/id/specific rule is layered → **no diagnostic**.
- **R2** — a `class × class` base+modifier same-property overlap (`.btn`+`.btn-op` on `<button class="btn btn-op">`) is **SOFT (`W-STYLE-CONFLICT-POSSIBLE`) in Wave 1**, NOT hard. (It promotes to hard in Wave 2 once `style=[a,b]` lands — do NOT emit hard for this case now.)
- **R3** — program-scope global `#{}` soft is **FILE-BOUNDED**: fire `W-STYLE-CONFLICT-POSSIBLE` ONLY on a provable *local* (same-file) overlap, NOT on every same-property program-rule pair (the 2941 firehose). The cross-file reach is the OQ-8 weaker-guarantee doc-nudge, not a per-pair warning.
- **Must NOT fire:** conditional rules that distinguish (`:hover`/`[attr]`/`@media`/`@container` — deterministic layers, §65.2.2); explicit `style=[a,b]` order; reactive `class:NAME=@cond` toggles (conditionally present → not a provable unconditional both-match).

## Reusable infra
- `compiler/src/codegen/emit-css.ts` — the `CSSBlock`/`CSSRule` model (grouped selector+decls / flat), `collectCssBlocks` + `_componentScope`, the `@scope` donut. Per-scope rules + selectors.
- `compiler/src/codegen/index.ts` (~1280) — `collectClassNamesFromAst` / `scanClassesFromHtml`: the markup element-set (the co-location key). Now that `css-scope-01.scrml` compiles, component-scope data via CE is reliable.

## Wire-in + outputs
- Integrate as a **pipeline analysis pass** that runs after CSS collection; emit `E-STYLE-CONFLICT` (error) + `W-STYLE-CONFLICT-POSSIBLE` (info/warning) into the standard diagnostic stream with `file:line` + both loci.
- **§34 rows** for `E-STYLE-CONFLICT` + `W-STYLE-CONFLICT-POSSIBLE` land WITH this impl (Rule 4) — add them to the §34 catalog. (The other §65 codes — `E-STYLE-VALUE-*`, `E-THEME-*`, `E-DEFAULTS-*` — are Wave-2/other pieces; do NOT add them here.)
- **Flip the §65.2 Nominal-banner portion** this implements (or note precisely what you flipped for PA review).
- **Tests:** unit (each R1/R2/R3 case + the must-NOT-fire cases + a genuine hard conflict) + a conformance case (codes-half). Re-run the dry-run analyzer post-impl to confirm the corpus behavior matches the calibration (0 hard FP with R1+R2).

## Scope fence (do NOT build these — separate Wave-1 pieces)
NOT the built-in reset, NOT `<theme>`→`:root` lowering, NOT `:where()`-flat emission changes, NOT `--explain-style`, NOT any Wave-2 style-as-value. **The checker + its two diagnostics + R1/R2/R3 only.**

## Constraints
- iso:worktree. Commit incrementally (+ `progress.md`). Do NOT land to main — the PA reviews (S239 adversarial /code-review is OWED on this codegen build) then lands.
- A concurrent session (S247) is live on disjoint threads (build.js/dev.js, parser/default-logic, realtime) — stay in your CSS-pipeline footprint.
- Final message: the pass's integration point + the §34 rows added + the banner flipped + the test results + the post-impl dry-run corpus numbers (confirm 0 hard FP) + any spec-ambiguity Phase-0 stop.
