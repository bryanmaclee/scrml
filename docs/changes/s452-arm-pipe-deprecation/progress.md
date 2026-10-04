# progress — s452-arm-pipe-deprecation (append-only)

- start: base e7fb5fba5; branch feat/s452-arm-pipe-deprecation; bun install + pretest OK.
- Unit A committed e1efdc451 (lint). Differential base e7fb5fba5 vs e1efdc451 (same compiler-root path): 0 artifact diffs, 0 outcome changes, 70 code-set changes all = +W-ARM-PIPE-LEGACY only.
- Unit B committed 7d73e564d (scrml fix arm-pipe rule + tests). legacyPipe offsets made span-relative (attribute-value handlers).
- C1 committed: legacy-purpose conformance cases (error/arm-pipe-legacy-handler, engine/arm-pipe-legacy-message) + bootstrap counter TWIN_RULES excludes arm-pipe.
- C2 (migration): scrml fix --rules=arm-pipe over examples, samples, conformance/cases, stdlib, docs/readme-snippets, benchmarks, docs/tutorial-snippets; hand edits (tool-unplaceable sites, each verified artifact-identical): tasks-app engine-opener effect= arm, component prop-neg case (1-arm), jwt ~{} test block arm; README/NERDME/PRIMER/tutorial.md mirrors in lockstep. Left: 2 multi-arm component cases (impl#1 compiles pipe-less multi-arm handlers in a component body wrong — E-CODEGEN-INVALID-LOGIC), samples/login (malformed arm), 5 E-CTX-broken samples, stdlib/store/kv (object-literal method !{} emitted raw).
