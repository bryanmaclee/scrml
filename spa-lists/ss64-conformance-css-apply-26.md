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
1. **`apply-unknown-utility-neg`** `[status=open]` — `.x { @apply flexx; }` unresolved token → **E-APPLY-UNKNOWN-UTILITY** (Error).
2. **`apply-variant-unsupported-neg`** `[status=open]` — `.x { @apply hover:bg-blue-500; }` variant-prefixed → **E-APPLY-VARIANT-UNSUPPORTED**.
3. **`apply-non-inlinable-neg`** `[status=open]` — `.x { @apply prose; }` (multi-rule / `::before`-bearing) → **E-APPLY-NON-INLINABLE-UTILITY**.
4. **`apply-bare-clean-pos`** `[status=open]` — `.btn { @apply px-4 py-2 rounded-md bg-blue-500 text-white; }` fires nothing → `notCodePrefixes:["E-APPLY-"]`.
5. **`apply-composing-family-pos`** `[status=open]` — `.card { @apply ring-2 shadow-lg; }` composes via §26.7 (clean; codes-only).
6. **`apply-arbitrary-value-pos`** `[status=open]` — `@apply bg-[#1da1f2] p-[3px]` resolves via §26.4 (clean).
7. **`apply-author-class-no-lint-pos`** `[status=open]` — a class defined via `@apply`, applied dynamically `class="${c ? 'card' : ''}"`, draws no **W-TAILWIND-UNRECOGNIZED-CLASS** → `notCodes:["W-TAILWIND-UNRECOGNIZED-CLASS"]` (§26.8.1/§26.5).

## Progress
`ss64.progress.md`. Land on `spa/ss64`; ping the PA inbox when ready. Do not touch main / do not push.
