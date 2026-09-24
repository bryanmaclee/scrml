# progress s430-stage-swap

- 2026-09-23T21:37:51-06:00 start; base 15e60e4b == origin/main; bun install + pretest ok
- 2026-09-23T22:00 seam landed (7379f8c7): compiler/src/pipeline-seam.ts (36-stage registry + contract validators), PRECG body moved verbatim to compiler/src/precg.ts, api.js routes every stage call through seams.pick(); selfHostModules routed through the same validated seam.
- calibration (every stage = its own TS default, routed through the seam): corpus 1929/1929 identical, docs+compiler+handOffs 648/648, conformance 906/906. Calibration found 3 PIPELINE.md contract drifts (BS block types test/foreign; RI boundary "middleware"; ~{} test-case body = string[]) and one pre-existing non-hermetic compile (emit-logic.ts _structuralDeclNamesForFile leaks across compiles) -> differential redesigned to lockstep per-side worker processes.
- scripts/hybrid.ts runner (--list / --conformance / --differential) + conformance/adapters/hybrid.ts (impl1-ts overlay; run.ts reused).
