# BRIEF — s430-conformance-carried (P7 infrastructure)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## Ruling (bryan S430, P7): the TS gap ledger is fixed only for cause; every other gap is CARRIED — converted into a
conformance case pinning the CORRECT behaviour, expected-to-fail for impl#1 (TS), required of the bootstrap (impl#2).

## Build two things
1. **Per-implementation expected-failure in the conformance suite.** Today `conformance/run.ts` has no xfail concept
   (PA grep: no `xfail`/`expectedFail`/`known-failing`). Add a field to `expected.json` (propose a name, e.g.
   `"xfail": { "impl1-ts": "<gap-id>" }`) that:
   - makes a case that FAILS on the named impl report as XFAIL (not a failure) and names the gap id;
   - makes a case that PASSES on an impl where it is marked xfail report XPASS **as a failure** (so a fixed gap
     cannot stay silently marked — the unproven-gate / absorbed-hatch lesson);
   - requires the gap id to exist in `docs/known-gaps.md` with `status=carried` (fail loud otherwise);
   - prints `N xfail of M` totals so a hatch absorbing the suite is visible (§8 absorbed escape hatch — ratio, not
     inspection).
   Wire it through `compiler/tests/conformance/corpus-bridge.test.js` (the gated entry). Update `conformance/README.md`.
   PROVE THE BITE: a deliberately-wrong xfail case must go red, restore, green. Record the proof in progress.md.
2. **`status=carried` in the gap ledger tooling.** `scripts/state.ts` parses `<!-- @gap … status=… -->` markers. Add
   `carried` as a recognised status: counted separately from `open` in every rollup/`@generated` block it writes, so boot
   counts distinguish owed-by-TS from owed-by-bootstrap. `bun scripts/state.ts --check` must still gate. Check
   `scripts/boot.ts`, `scripts/review-debt.ts` and any other consumer of the status vocabulary (grep for `status=open`
   across scripts/) and update each — report the consumer list you found.
   Do NOT reclassify any gap — the triage is a separate unit.

Deliverable: one PR-able branch; tests for both pieces.
