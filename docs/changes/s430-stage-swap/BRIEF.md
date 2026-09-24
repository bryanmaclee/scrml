# BRIEF — s430-stage-swap (P5 prerequisite: the hybrid-compiler harness)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## Ruling (bryan S430, P5): a bootstrap module is DONE when a HYBRID compiler — the TS pipeline with that ONE stage
swapped for the bootstrap build of it — passes the full conformance suite; a corpus artifact differential vs pure TS
runs as TRIAGE (each divergence classified TS-bug / bootstrap-bug / spec-gap), not as a gate. "It compiles" is NOT a gate.
The ruling says: build this mechanism properly BEFORE any module is ported.

## Known state
- The only existing swap hook the PA knows of: `compiler/src/codegen/compat/parser-workarounds.js` `setBPPOverrides(mod)`
  (PA-LOCATED-VERIFY). Survey `compiler/src/api.js` for how stages are invoked; `compiler/PIPELINE.md` has the stage
  contracts (BS, TAB, … CG).
- `compiler/tests/self-host/*.test.js` are BROKEN BY DESIGN: e.g. `ast.test.js` text-substitutes `fn`→`function`, wraps the
  result in a Blob and `import()`s scrml source AS JAVASCRIPT (`:101`, `:116-118`), is `describe.skip`-ed, and
  `compiler/tests/self-host` is not in the gate. Do not extend that approach.

## Build
1. A **stage-substitution seam** in the pipeline: a way to run `compileScrml`/the api pipeline with any named stage replaced
   by a module exporting the same entry signature. No behaviour change when no substitution is given (prove: corpus
   artifact differential byte-identical with the seam present vs HEAD).
2. **Seam validation**: at each substituted stage boundary, check the substitute's output against the stage contract
   (shape, required fields). A mismatch fails LOUD with the stage name and the first divergent path — never silently
   feeds a malformed AST downstream.
3. A runner, e.g. `bun scripts/hybrid.ts --swap <stage>=<module-path> [--conformance] [--differential]`:
   `--conformance` runs the suite through the hybrid (reuse `conformance/adapters/impl1-ts.ts`; add an adapter variant
   rather than forking the runner); `--differential` compiles the tracked corpus through hybrid AND pure TS and prints a
   divergence report (file, artifact, first diff hunk), with `N of M` totals.
4. **Prove it bites**: swap a stage for a deliberately-perturbed copy of the TS stage (e.g. one that drops a node kind)
   — conformance must go red and the differential must name it; swap in an UNPERTURBED re-export — both green.
5. Replace/retire the broken `compiler/tests/self-host/*.test.js` eval-as-JS premise: either delete with a note pointing at
   the new runner, or convert to hybrid-runner tests. Report which.
Do NOT port any module to scrml. Where the bootstrap lives (`stdlib/compiler/**` vs `compiler/self-host/`) is unsettled —
make the runner location-agnostic.
