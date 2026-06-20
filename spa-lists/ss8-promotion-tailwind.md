# sPA ss8 — promotion-tailwind

**Launch:** `read spa.md ss8` · **Branch:** `spa/ss8` · **Worktree:** `../scrml-spa-ss8`

**Fill:** ~58% · `at-ceiling`

## Shared ingestion
Tailwind utility-class compilation + the promote CLI lift. Shared loci: `tailwind-classes.js`
(bracket/arbitrary-value parser + utility families + safelist), `collect-class-names.ts`,
`codegen/emit-css.ts`, and `commands/promote.js` (the `--match`/`--each`/`--engine` lift mechanics).
Both the arbitrary-value remainder and the `--engine` lift are scopable from the same tailwind/promote
understanding.

## Core files
`compiler/src/tailwind-classes.js` · `compiler/src/collect-class-names.ts` · `compiler/src/codegen/emit-css.ts` · `compiler/src/commands/promote.js`

## Items (least-ingestion-first)
1. **`bug-1`** `[status=open]` MED · tier med — Tailwind arbitrary-value remainder — string-shaped values + safelist/@apply precision + arbitrary `ring-offset-[len]` (+ verify P2/P3/P4 closure). P1-P4 composing families LANDED (S191, Approach C inline `var()` fallbacks, §26.7). THREE sub-arcs stay open: (1) string-shaped arbitrary values (`content-['text']`/`font-[Inter]`) need bracket-parser extension; (2) safelist/@apply lint precision; (3) lone arbitrary `ring-offset-[len]`. Inventory also lists P2-gradient/P3-transform/P4-filter as 'remaining' — VERIFY against §26.7 phase-status (SPEC-INDEX says P3 transform RECOGNIZED S191) before re-opening. tailwind-classes.js. status=open. Workaround = `#{}` CSS shim.
   > **Brief seed:** THREE smaller arcs in tailwind-classes.js: (1) extend the bracket-parser for string-shaped arbitrary values (`content-`/`font-`); (2) safelist/@apply lint precision; (3) add arbitrary `ring-offset-[len]`. FIRST currency-check P2/P3/P4: SPEC-INDEX shows §26.7.2 transform Phase-3 RECOGNIZED S191 — don't re-build landed families (cookbook-vs-empirical, verify the live phase-status table).
2. **`bug-20`** `[status=open]` LOW · tier med — `promote --engine` (Tier-1→2 `<match>`→`<engine>` lift) deferred stub + `W-MATCH-TRANSITIONS-ACCRUING` lint. `--match` shipped S66 (Tier-0→1). `--engine` flag deferred — prints a 'deferred' stub (promote.js:1535 Tier C; flag-parse ~89); pairs with a not-yet-existing `W-MATCH-TRANSITIONS-ACCRUING` lint needing its own §34 catalog row + groundwork. Mirror shipped `--match`/`--each`. status=open.
   > **Brief seed:** Build `W-MATCH-TRANSITIONS-ACCRUING` (§34 catalog row + groundwork) first, then implement the `--engine` Tier-1→2 mechanical lift (mirror the shipped `--match`/`--each` in commands/promote.js). SPEC §34 touch flags PA.

## Progress
`ss8.progress.md`. Land on `spa/ss8`; ping PA inbox when ready. Do not advance main / do not push.
