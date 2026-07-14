# sPA ss64 → PA — RE-INTEGRATE `spa/ss64`

**List:** `spa-lists/ss64-conformance-css-apply-26.md` — conformance: §26.8 `@apply` utility composition
**Branch:** `spa/ss64` · **Base:** `40b580c5` · **Branch tip:** `0f5a8b59`
**Status:** COMPLETE — all 7 items `landed-on-branch`. Nothing parked, nothing dropped.

## What landed
New `conformance/cases/apply/` category — 7 compile-time, codes-only cases pinning
**§26.8 `@apply`** (Tailwind utility composition in author CSS). Emitted CSS is D3
impl-freedom (never byte-asserted) → contract = code presence/absence only. Lifted from
`compiler/tests/integration/apply-utility-composition.test.js` (Option-D pre-reviewed twin);
**every expected code empirically verified** against the impl#1 adapter before locking (README OQ4).

| # | case | source | contract |
|---|------|--------|----------|
| 1 | `apply-unknown-utility-neg`      | `@apply flexx`                     | `E-APPLY-UNKNOWN-UTILITY` (Error) + disjoint from siblings + no W-TAILWIND |
| 2 | `apply-variant-unsupported-neg`  | `@apply hover:bg-blue-500`         | `E-APPLY-VARIANT-UNSUPPORTED` (Error) |
| 3 | `apply-non-inlinable-neg`        | `@apply prose`                     | `E-APPLY-NON-INLINABLE-UTILITY` (Error) — prose is recognized-but-multi-rule, NOT unknown |
| 4 | `apply-bare-clean-pos`           | `@apply px-4 py-2 rounded-md …`    | `notCodePrefixes:["E-APPLY-","W-TAILWIND-"]` |
| 5 | `apply-composing-family-pos`     | `@apply ring-2 shadow-lg`          | clean (§26.7 var() model) |
| 6 | `apply-arbitrary-value-pos`      | `@apply bg-[#1da1f2] p-[3px]`      | clean (§26.4 arbitrary path) |
| 7 | `apply-author-class-no-lint-pos` | dynamic `class="${@active?'card':''}"` | `notCodes:["W-TAILWIND-UNRECOGNIZED-CLASS"]` (§26.8.1/§26.5) |

## Commits (in order)
- `40ddc015` — the 7 `apply/` cases (14 files, +157). Pre-commit full suite green (20031 pass / 0 fail).
- `0f5a8b59` — sPA bookkeeping: list marked landed + `spa-lists/ss64.progress.md`.

## Verification
- `bun conformance/run.ts`: **393/393 pass** (was 386, +7). All 7 apply cases PASS.
- Pre-commit gate (unit + integration + conformance, browser-excluded) passed on commit 1.
- Coherence: `main...spa/ss64` = 0 left / 2 right; main untouched at `40b580c5`.

## ⚠ Observation for PA triage (non-blocking — NOT a case defect)
**E-DG-002 false-fire on class-attr interpolation reads.** A state cell read *only* inside
`class="${@cell ? 'x' : ''}"` false-fires **E-DG-002** ("declared but never consumed") — the
dependency graph does not count a class-attr interpolation read as a consumption. Parallels the
already-resolved `<span : @label>` E-DG-002 false-fire (SPEC.md:1009, "the expression IS consumed
→ false-fire gone"). Worked around in the case-7 fixture by also reading the cell in text
(`<p>${@active}</p>`), keeping it a clean positive. **Possible real DG gap** — out of sPA scope,
flagged for you to reproduce/triage (candidate `g-` bug: class-attr interpolation reads should
count as DG consumptions, same as `:`-shorthand / text interpolations).

## Env note
Worktree `../scrml-spa-ss64` has `node_modules` symlinked from main (fresh worktree checks out
only tracked files). No `dist` needed — pre-commit suite excludes browser tests.
