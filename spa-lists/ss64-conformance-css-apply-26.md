# sPA ss64 — conformance: CSS §26 / `@apply` (Tailwind utility composition)

**Launch:** `read spa.md ss64` · **Branch:** `spa/ss64` · **Worktree:** `../scrml-spa-ss64`

**Fill:** conformance-authoring cluster (compile-time), ~7 cases · NEW S252 · thin/at-ceiling

## Shared ingestion
Author conformance cases pinning **§26.8 `@apply`** (Tailwind utility composition in author CSS) —
IMPLEMENTED ss40, 3 `E-APPLY-*` codes wired + catalogued §34, currently **0 cases mention `@apply`**
(16 `style/` cases exist but pin `E-STYLE-*`/`W-TAILWIND-*`, a different surface). **All COMPILE-TIME.**
Emitted CSS shape is impl-freedom (never byte-asserted) → contract = **code presence/absence only**
(structural-effect-via-codes, exactly like `schema-for/happy-canonical-expansion`). **Mirror
`conformance/cases/style/`** (`clean-single-rule`, `theme-*`). Read the README case-format section FIRST.

## Core files
`conformance/README.md` · `conformance/run.ts` · `compiler/SPEC.md` §26.8 (**grep `### 26.8`; ~17253-17313**)
+ §26.7 (composing families) + §26.5 (author-class lint) · `conformance/cases/style/` (pattern-to-mirror)

## Items (author each; commit per-case; codes-only assertions)
1. **`apply-unknown-utility-neg`** `[status=landed-on-branch 40ddc015]` — `.x { @apply flexx; }` unresolved token → **E-APPLY-UNKNOWN-UTILITY** (Error). ✓ severity+disjointness pinned.
2. **`apply-variant-unsupported-neg`** `[status=landed-on-branch 40ddc015]` — `.y { @apply hover:bg-blue-500; }` variant-prefixed → **E-APPLY-VARIANT-UNSUPPORTED**. ✓
3. **`apply-non-inlinable-neg`** `[status=landed-on-branch 40ddc015]` — `.z { @apply prose; }` (multi-rule) → **E-APPLY-NON-INLINABLE-UTILITY**. ✓ (prose empirically fires NON-INLINABLE, not UNKNOWN — matches §26.8.2).
4. **`apply-bare-clean-pos`** `[status=landed-on-branch 40ddc015]` — `.btn { @apply px-4 py-2 rounded-md bg-blue-500 text-white; }` fires nothing → `notCodePrefixes:["E-APPLY-","W-TAILWIND-"]`. ✓
5. **`apply-composing-family-pos`** `[status=landed-on-branch 40ddc015]` — `.card { @apply ring-2 shadow-lg; }` composes via §26.7 (clean; codes-only). ✓
6. **`apply-arbitrary-value-pos`** `[status=landed-on-branch 40ddc015]` — `@apply bg-[#1da1f2] p-[3px]` resolves via §26.4 (clean). ✓
7. **`apply-author-class-no-lint-pos`** `[status=landed-on-branch 40ddc015]` — a class defined via `@apply`, applied dynamically `class="${@active ? 'card' : ''}"`, draws no **W-TAILWIND-UNRECOGNIZED-CLASS** → `notCodes:["W-TAILWIND-UNRECOGNIZED-CLASS"]` (§26.8.1/§26.5). ✓ (cell also read in text to keep the program well-formed — see observation below).

## Progress
`ss64.progress.md`. Land on `spa/ss64`; ping the PA inbox when ready. Do not touch main / do not push.

**STATUS: COMPLETE — all 7 landed on `spa/ss64` @ `40ddc015`. conformance 393/393 (was 386, +7).**

**PA observation (non-blocking, not a case defect):** in the dynamic-class fixture,
`@active` read *only* inside `class="${@active ? 'card' : ''}"` false-fires **E-DG-002**
("declared but never consumed") — a class-attr interpolation read is NOT counted as a DG
consumption. Worked around here by also reading the cell in text (`<p>${@active}</p>`), so
the case stays a clean positive. Possible real DG gap (parallel to the resolved `<span : @label>`
E-DG-002 false-fire, SPEC:1009) — flagged for the PA to triage, out of sPA scope.
