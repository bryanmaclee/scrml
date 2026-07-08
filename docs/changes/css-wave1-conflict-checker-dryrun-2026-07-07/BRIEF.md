# BRIEF — CSS Wave-1 §65.11 calibration dry-run (E-STYLE-CONFLICT checker)

**Dispatched:** S246, 2026-07-07. **Agent:** scrml-js-codegen-engineer, iso:worktree. **Type:** CALIBRATION (analysis-only — NOT a shipping feature).

## The task — the §65.11 make-or-break, in one sentence
Build a **REPORT-ONLY prototype** `E-STYLE-CONFLICT` checker (SPEC §65.2 / §65.2.4 decidable core) and **dry-run it on the 83 `#{}`-bearing corpus files** to measure + tune the decidable / fail-closed boundary **BEFORE any hard error ships**. The deliverable is a **CALIBRATION REPORT**, not a pipeline change.

**Why this first (do not skip to shipping the error):** the predictability *guarantee* is §65's whole thesis, and its teeth depend entirely on this boundary. Too eager → it blocks legitimate code and adopters disable the lint (the guarantee dies as a convention). Too lax → silent last-wins (the guarantee was never real). Only a corpus-wide dry-run can calibrate it. The boundary tuning that comes out of your report is a **bryan design decision** that gates the actual hard-error ship — so your job is MEASURE + RECOMMEND, not ship.

## Design authority — READ THESE (landed spec)
`compiler/SPEC.md` **§65.2** (flat specificity + E-STYLE-CONFLICT), **§65.2.4** (decidability — the co-location-resolved core + the fail-closed residue; this is the algorithm you implement), **§65.2.1–65.2.3** (unconditional-overlap = error; conditional rules = deterministic layers NOT conflicts; same-axis/cross-axis recursion), **§65.11** (this MVP gate). The rulings are LOCKED — implement them, do not re-design.

## Reusable infra (verified — reuse, don't rebuild)
- `compiler/src/codegen/emit-css.ts` (343L) — the `CSSBlock`/`CSSRule` model: a rule is **grouped** (selector + declarations) or **flat** (prop + value). `collectCssBlocks` tags each with its `_componentScope`; `generateCss` wraps component scopes in the `@scope ([data-scrml="Name"]) to ([data-scrml])` donut. This gives you the per-scope rule set + selectors.
- `compiler/src/codegen/index.ts` (~line 1280) — `collectClassNamesFromAst(nodes)` + `scanClassesFromHtml(htmlBody)`: the markup class-set extraction that powers dead-CSS elimination (§26.2). **This is the co-location key §65.2.4 says to reuse** — it resolves selectors against the KNOWN, bounded element-set of the scope's actual markup. Extend it to also carry tag names + attribute-presence per element as needed.

## The checker (§65.2.4 decidable core)
For each component scope, for each PAIR of same-property CSS rules (R1, R2): does some element in the scope's static markup **provably match BOTH** (provably-shared), UNCONDITIONALLY (no `:hover`/`:focus`/`[attr]`/`@media`/`@container` distinguisher), with no author-declared order? → would fire **hard `E-STYLE-CONFLICT`**.
- **Decidable → hard:** tag×tag (same tag shared; different tag provably-disjoint), class×class, tag×class, id×*, attribute-presence / mutually-exclusive attr-values, combinators over STATIC markup.
- **Fail-closed → soft `W-STYLE-CONFLICT-POSSIBLE`:** combinator / `:not()` / `:has()` / sibling (`~`,`+`) over DYNAMIC markup (`<each>`, conditional subtrees); `@media`×`@container` cross-axis pairs you can't prove co-occur; program-level global `#{}` (unbounded element-set).
- **NOT a conflict (must NOT fire):** conditional rules (`:hover`/`[attr]`/`@media`/`@container`) that distinguish — deterministic LAYERS. Explicit `style=[a,b]` order. This carve-out is what keeps the guarantee affordable — verify you get it right.

## The corpus (the 83 files)
`grep -rlF --include='*.scrml' '#{' . | grep -vE '/node_modules/|/\.claude/|/\.git/'` → 83 files, 187 `#{}` blocks (verified 2026-07-07). Run the prototype over ALL of them.

## The CALIBRATION REPORT (the deliverable) — write to `docs/changes/css-wave1-conflict-checker-dryrun-2026-07-07/CALIBRATION-REPORT.md`
1. **Hard-error rate:** count of `E-STYLE-CONFLICT` that WOULD fire, each with `file:line` + the two conflicting rules + the shared element.
2. **Soft rate:** count of `W-STYLE-CONFLICT-POSSIBLE`, each with loci.
3. **FALSE-POSITIVE AUDIT (the crux):** for EVERY hard error, classify — REAL conflict (a today-bug worth surfacing) vs FALSE POSITIVE (legit code mis-flagged). This is what calibrates the boundary. Show your reasoning per case.
4. **Boundary recommendation:** is the decidable/fail-closed split (§65.2.4) right as specified, or does the corpus evidence say adjust it (which cases move from hard→soft or soft→hard, and why)? Is the hard-error false-positive rate low enough to ship the hard error, or should more cases start as soft?
5. **Spec gaps:** any §65.2.4 case the corpus exercises that the spec's rules don't cleanly resolve (→ a SPEC follow-up).

## Constraints
- **iso:worktree. `git merge main` FIRST** — your base may be stale; you need the landed §65 SPEC (`compiler/SPEC.md` §65) + current `compiler/src`.
- **ANALYSIS-ONLY.** Build the prototype as a standalone script/tool (e.g. `compiler/scripts/css-conflict-dryrun.ts`). Do **NOT** wire it into the compile pipeline as a hard error, do NOT change any emission, do NOT edit shared pipeline files in a behavior-changing way. New files + read-only reuse of the infra.
- Commit your prototype + report incrementally in your worktree (per-step + a `progress.md`). Do NOT land to main (the PA lands; commits are on hold this window).
- Your final message = the report's executive summary (rates + false-positive verdict + boundary recommendation) — the facts, for the PA to review with bryan.
