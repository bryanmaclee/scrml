# CSS Wave-1 §65.11 CALIBRATION dry-run — progress

Task: REPORT-ONLY prototype E-STYLE-CONFLICT checker (§65.2.4 decidable core), dry-run on the
83 `#{}`-bearing corpus files, MEASURE + tune the decidable/fail-closed boundary. No pipeline
change, no emission change, no hard error shipped.

## Recon findings (settled)
- Corpus = 83 files, **187 TEXTUAL `#{` occurrences** — but that count includes `//` comments
  and `<code>#{}</code>` prose in article/doc files. The REAL analyzable CSS-block surface via
  `collectCssBlocks` = **96 program-scope blocks** + a handful in component-def `raw`.
- Scope split (pre-CE structural census over all 83):
  - program-global css-inline blocks: **96** (all `_componentScope==null`)
  - css-inline inside state-constructor: **0**
  - component-def nodes whose `raw` contains `#{`: **3** (2 files: css-scope-01 [Badge,Card],
    css-flat-and-scoped-001 [Card]) + 1 projected-content inline `#{}` (component-scoped-css `.account-note`)
- Per §65.2.4 + §65.14: program-level `#{}` = global escape hatch -> **SOFT only** (unbounded reach).
  Component-scoped `#{}` (gets `@scope` donut) = **DECIDABLE -> HARD-eligible**.
- Pipeline reality: current CLI/compileScrml FAILS to expand these component defs (E-COMPONENT-021
  re-parse failure) — so CE-tagged `_componentScope` is unreliable in-harness AND live. Analyzer is
  therefore SELF-CONTAINED: program scope via collectCssBlocks, component scope via piecewise raw
  extraction (CSS bodies + markup frame both recoverable).

## Approach
Standalone `compiler/scripts/css-conflict-dryrun.ts` (analysis-only). BS+TAB per file (reliable).
Program scope = collectCssBlocks + full static-markup walk (static vs reactive-toggle classes).
Component scope = piecewise `#{}`/markup extraction from component-def `raw`.
Pairwise same-property §65.2.4 checker -> HARD / SOFT / WHAT-IF-hard-on-program / disjoint / layer.

## Incident note
Early recon writes leaked into the MAIN checkout via `cd <main> && ...` (CWD-routing trap). No git
mutation landed in main (shared-index lock rejected the commits); leaked probe/progress files removed
from main by filesystem rm; PA's concurrent staged work untouched. All subsequent work uses absolute
worktree paths only.

## Status: COMPLETE

Deliverables:
- `compiler/scripts/css-conflict-dryrun.ts` — report-only §65.2.4 checker prototype (committed 040e1d46)
- `CALIBRATION-REPORT.md` — the report (this dir)

Headline results (83 files, 625 grouped rules, 62 program + 3 component scopes):
- HARD (fires today) = 0 (all corpus conflicts are program-level -> soft; 3 component scopes trivial)
- WHATIF-hard (program provable) = 20 = 13 universal-`*`-reset (FALSE POS) + 7 BEM base+modifier (judgment)
- same-axis (§65.2.3, BEM on :hover) = 7
- soft structural (intended) = 5
- soft program-unbounded FIREHOSE = 2941 across 49 files (literal reading = unusable)
- shorthand/longhand overlap = 14 (spec gap)

Recommendation: axis is right; add 2 carve-outs before shipping hard — (R1) universal-`*`/bare-element
rules = lower layer not conflict (kills 65% of FPs); (R2) BEM base+modifier starts SOFT until Wave-2
`style=[a,b]` migration target exists. Plus (R3) program-scope soft must be file-bounded not the 2941
unbounded firehose. With R1+R2 the residual hard false-positive rate = 0 -> safe to ship.
