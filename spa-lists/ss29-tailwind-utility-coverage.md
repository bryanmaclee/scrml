# sPA ss29 — Tailwind utility coverage (the generator's named-scale + variant gaps)

**Launch:** `read spa.md ss29` · **Branch:** `spa/ss29` · **Worktree:** `../scrml-spa-ss29`

**Fill:** the Tailwind-style class generator's coverage gaps — the existing `bug-1` safelist/@apply remainder + two flogence S14-reported families (group/group-hover parent-state variant; bare transition/duration/ease named-scale). NEW S221 (flogence triage). **fireable now** (`tailwind-classes.js` is a disjoint surface — safe with any ss22/23/25/26/28 lane). The "silent-no-op" DX family: a class compiles, ghost-lints (`W-TAILWIND-UNRECOGNIZED-CLASS`/`W-TAILWIND-001`), renders nothing.

## Shared ingestion
The **Tailwind class generator** `compiler/src/tailwind-classes.js`: the static utility registry, `STATE_PSEUDO_CLASSES` (variant suffixes), `ARBITRARY_PROP_MAP` (the `[...]` bracket forms), and the variant-emission paths (pseudo/media kinds). **READ FIRST:** the bug-1 history — SPEC §26 (the Tailwind subset; §26.7 transform Phase 3 landed S191) + the ss8 landing (`115dabe3`, string-shaped + ring-offset arbitrary values, S210) + bug-1's known-gaps entry. The flogence S14 report + the triage findings: `docs/known-gaps.md` g-tailwind-* + `handOffs/incoming/read/2026-06-25-1500-from-flogence-tailwind-gen-subset-no-group-hover-transition.md`.

## Core files
`compiler/src/tailwind-classes.js` (static registry · `STATE_PSEUDO_CLASSES:1544` · `ARBITRARY_PROP_MAP:1686-1689` · exclusions `:2537`/`:3060`) · the generated-CSS test fixtures

## Items (least-ingestion-first)

1. **`g-tailwind-bare-transition-family`** (MED) `[status=open]` — bare `transition`/`transition-all`/`transition-colors` + `duration-{N}`/`ease-{named}` produce no CSS (only the arbitrary-value `transition-[...]`/`duration-[200ms]` forms resolve, in `ARBITRARY_PROP_MAP:1686-1689`). **Same failure mode as bug-1.** **Fix:** add static-registry entries — bare `transition` (default prop set + `150ms` + `cubic-bezier(.4,0,.2,1)`), `transition-{all,colors,opacity,transform,shadow}`, the `duration-{75..1000}` scale, `ease-{linear,in,out,in-out}`, `delay-{N}`. Pure registry-extension; smallest. flogence S14.
2. **`bug-1`** (MED, partial-impl) `[status=PARKED→PA]` — the SOLE remaining bug-1 sub-arc: **safelist / @apply** (sub-arc 2; string-shaped + ring-offset LANDED S210 `115dabe3`). §26.5-deferred. **Verify the current scope first** (bug-1 is long-lived; confirm what sub-arc-2 still needs vs SPEC §26.5) before building. Same registry/generator ingestion. — **VERIFY-SCOPE OUTCOME (sPA ss29): PARKED.** It's a DESIGN RULING, not a buildable scope: SPEC §26.5 "Open Items" + known-gaps bug-1 (L1281) both say "no ruled direction → PARKED to PA (safelist config knob vs `@apply` vs `#{}`-scan suppression)"; the `lint.tailwind-unrecognized-class = off` (§28) escape hatch already covers heavy-custom-CSS adopters. Escalated in the re-integration message.
3. **`g-tailwind-group-parent-state-variant`** (MED) `[status=open]` — `group` + `group-hover:*` unsupported (`STATE_PSEUDO_CLASSES:1544` has no group entries; excluded `:2537`/`:3060`). **Structurally NEW** — a parent-state variant needs a descendant-combinator selector (`.group:hover .group-hover\:X { … }`), a new variant KIND, NOT a `:pseudo` suffix. **Fix:** register `group` as a marker class + lower `group-hover:X` to the descendant-combinator rule (distinct emission path from pseudo/media). Heaviest (new variant kind) — ordered last. flogence S14.

## Progress
`ss29.progress.md`. Land on `spa/ss29`; ping PA inbox per-item. Do NOT advance main / push. PA re-integrates (S67 + R26: compile a repro using each new utility, grep the generated CSS for the rule, confirm no ghost-lint). #2 bug-1 = verify-scope-first (STOP-if-materially-bigger; it's a long arc). flogence reply owed on land (S14 closed).
