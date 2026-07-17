# RE-INTEGRATE — sPA ss62 Wave-2 · `==` strict-semantics §45 conformance (tier-1 freeze)

**From:** sPA ss62 · **To:** PA · **Date:** 2026-07-15
**List:** `spa-lists/ss62-conformance-value-model-maps-refinement.md` (Wave-2, items 6-10)
**Branch:** `spa/ss62` · **branch tip:** `e9bf7ba5` · **conformance-data commit:** `d9feb935`
**Base:** `origin/main @ 85efaf77`

## TL;DR
Wave-2 of ss62 pins the **tier-1 freeze-blocking `==` strict-semantics family (§45)** — the silent-wrong class where a wrong comparison compiles. 5 codes, 10 new cases under a new `conformance/cases/equality/` category (reject/warn pos + clean neg per code). Full suite GREEN: **`bun conformance/run.ts` 445 → 455** (all 10 PASS, 0 fail). **No impl#1-vs-SPEC §45 divergence.** Wave-1 (items 1-5, maps §59 + refinement §53) already integrated — NOT touched.

## Landed (all @ `d9feb935`, category `conformance/cases/equality/`, codes-half)

| Item | Code | SPEC | pos case | neg case |
|------|------|------|----------|----------|
| 6 | E-EQ-001 | §45 | `cross-type-primitive-reject` (`int == bool`) | `same-type-primitive-clean` |
| 7 | E-EQ-002 | §45 | `eq-not-reject` (`x == not`) | `is-not-clean` (`x is not`) |
| 8 | E-EQ-003 | §45 / §59.4 | `map-key-function-field-reject` (map key = struct w/ fn field) | `map-key-comparable-clean` |
| 9 | E-EQ-004 | §45 | `strict-operator-reject` (`===`) | `equality-operator-clean` (`==`) |
| 10 | W-EQ-PAYLOAD-VARIANT | §45.7 | `payload-variant-compare-warn` (`@phase == Phase.Serving`) | `unit-variant-compare-clean` (`== Phase.Idle`) |

- **Method:** sources lifted from pre-reviewed source-tests (gauntlet-s19 `equality-diagnostics.test.js`; `eq-payload-variant-lint-ss16-c4.test.js`); every reject/clean source EMPIRICALLY probed via `compileScrml` against the live §45 walkers (`gauntlet-phase3-eq-checks.js`, `ast-builder.js`, `type-system.ts`) + SPEC §45 catalog (SPEC.md:18334-18340). No case built on a guessed trigger.
- **Item 10 (W-EQ-PAYLOAD-VARIANT)** is a WARNING (non-fatal, routes to `result.warnings`). Asserted via `codes: ["W-EQ-PAYLOAD-VARIANT"]` + the cross-stream `severity: {"W-EQ-PAYLOAD-VARIANT": "warning"}` check (item 10's named requirement). The pos also carries an incidental `W-PROGRAM-REDUNDANT-LOGIC` (the always-false compare IS redundant logic) — not asserted (superset semantics).
- **Item 8 (E-EQ-003)** authored as the **map-key variant** (item 8's named intent: `type-system.ts` `classifyMapKey` → function-field key). The struct-comparison variant (`gauntlet-phase3-eq-checks.js:583`) is a verified sibling of the SAME code; the map-key pos also fires the sibling `E-STRUCT-FUNCTION-FIELD` (superset-tolerated, not asserted).

## Divergences: NONE
Impl#1 §45 behavior matches the SPEC §45 catalog exactly for all 5 codes. (Contrast Wave-1, which flagged 7 escalations — E-CONTRACT naming, W-MAP severity Info-vs-warning, `.sorted()` runtime gap, etc.; those are in `spa-lists/ss62.progress.md` and unaffected here.)

## Re-integration steps for the PA
1. File-delta `conformance/cases/equality/**` from `d9feb935` onto main (pure-additive, 10 dirs / 20 files).
2. Confirm `bun conformance/run.ts` independently GREEN (expect +10 vs your current baseline).
3. Retire `spa/ss62` after merge (Wave-1 numbers already integrated; Wave-2 completes the list).

## Env note (not a blocker)
The shared main checkout was switched to `main` by concurrent activity mid-run (an `ss71-spa-reintegration-2026-07-15.md` message appeared in `handOffs/incoming/`). I re-asserted `spa/ss62` before every commit and staged only `conformance/cases/equality/` with an explicit pathspec. The PA's uncommitted `hand-off.md` working-tree change was left untouched (never staged). Heads-up: multiple sPA branches (ss62, ss70, ss71) are awaiting re-integration and the checkout is being contended — serialize the merges.
