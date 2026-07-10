# BRIEF — conformance cases for the scrml-native CSS model §65 (WAVE-1 surface)

Change-id: `conformance-css-style-65-2026-07-10`
Dispatched to: JS Codegen Engineer (isolation: worktree)

## Verbatim dispatch

Author conformance cases for the scrml-native CSS model §65 — WAVE-1 surface only (the flagship third-leg, landed S246). Isolated worktree — do NOT land to main; commit per-item on your branch; the PA reviews + integrates. Mirror the landed realtime/endpoint/capability conformance pattern (`conformance/cases/{channel,endpoint,capability}/`) — same method + discipline.

### VERIFY FIRST (the planning docs run stale — verify ground truth)
1. `grep -rlF '<theme' conformance/cases/` · `grep -rlF 'E-STYLE-CONFLICT' conformance/cases/` · `grep -rlF '#{' conformance/cases/` — confirm what §65 coverage exists (last check: ZERO). Do NOT duplicate.
2. `bun conformance/run.ts` — baseline oracle (currently 279). DoD vs the real number.

### Rule 4 — read SPEC §65 IN FULL
`compiler/SPEC.md` §65 — esp §65.2 (flat-specificity / E-STYLE-CONFLICT), §65.2.4 + §65.5 + §65.11 (the R1/R2/R3 Wave-1 boundary carve-outs, ratified S246 `10d54ff3`), §65.3 (`<theme>` tokens + `<defaults>`), §65.6 (reactive theming, theme-variant infer-from-`for=`), §65.8 (@layer order), + the §34 code rows. Author to the SPEC.

### SCOPE — WAVE-1 ONLY (Waves 2-3 are v1.next, do NOT author them)
Wave-1 (V1.0 floor, LANDED): E-STYLE-CONFLICT (unconditional same-property overlap on a provably-shared element = compile error) with the R1/R2/R3 carve-outs · E-STYLE-CONDITION-OVERLAP (cross-axis conditional layering) · `<theme>` tokens + E-THEME-TOKEN-UNKNOWN · `<defaults>` element-defaults + E-DEFAULTS-DEAD / E-DEFAULTS-MISUSE · the built-in reset · flat-local resolution on the existing `#{}` surface · one interop `!important` (E-STYLE-IMPORTANT-INTERNAL forbids internal use).
DO NOT author (v1.next): style-as-value (E-STYLE-VALUE-*, `style=name`/`[a,b]`), keyframes (E-STYLE-KEYFRAMES-COLLISION), Tailwind-integration, token-unification.

### The R1/R2/R3 boundary
R1: universal-`*`/bare-root reset = a LOWER layer, NOT a same-level conflict. R2: BEM base+modifier is SOFT in Wave-1. R3: program-scope soft is FILE-BOUNDED. Author a positive-conflict case AND negatives proving R1/R2/R3 do NOT fire.

### Method (the suite contract)
`conformance/README.md`: each case = `conformance/cases/<category>/<case-id>/{case.scrml,expected.json}`; assert (a) codes-fire + (b) runtime effect. Put cases under a `style` (or `css`) category. Use CANONICAL shapes. EMPIRICAL-FIRST + Rule 4: probe impl#1 AND read the §65 subsection before locking each expected.json; author to SPEC, ESCALATE any impl-vs-SPEC divergence.

### Verify + land (branch only)
`bun conformance/run.ts` all green + `bun test compiler/tests/conformance/corpus-bridge.test.js`. Commit per-item; do NOT push/advance main.

## What was actually authored (see progress.md)

Category `style/` — 14 cases covering the EMPIRICALLY-IMPLEMENTED Wave-1 surface:
E-STYLE-CONFLICT (hard, 3 shapes) + R1/R2/R3 negatives + conditional/disjoint negatives +
program-scope soft + `<theme>` recognition/typer/inference + E-VARIANT-AMBIGUOUS + E-TYPE-063.

See `progress.md` for the impl-vs-brief scope reconciliation (several brief-listed
"Wave-1 LANDED" codes are actually Phase-B / v1.next per the SPEC §65 banner + empirical probe).
