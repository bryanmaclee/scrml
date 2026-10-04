# progress — s452-arm-pipe-deprecation (append-only)

- start: base e7fb5fba5; branch feat/s452-arm-pipe-deprecation; bun install + pretest OK.
- Unit A committed e1efdc451 (lint). Differential base e7fb5fba5 vs e1efdc451 (same compiler-root path): 0 artifact diffs, 0 outcome changes, 70 code-set changes all = +W-ARM-PIPE-LEGACY only.
- Unit B committed 7d73e564d (scrml fix arm-pipe rule + tests). legacyPipe offsets made span-relative (attribute-value handlers).
- C1 committed: legacy-purpose conformance cases (error/arm-pipe-legacy-handler, engine/arm-pipe-legacy-message) + bootstrap counter TWIN_RULES excludes arm-pipe.
- C2 (migration): scrml fix --rules=arm-pipe over examples, samples, conformance/cases, stdlib, docs/readme-snippets, benchmarks, docs/tutorial-snippets; hand edits (tool-unplaceable sites, each verified artifact-identical): tasks-app engine-opener effect= arm, component prop-neg case (1-arm), jwt ~{} test block arm; README/NERDME/PRIMER/tutorial.md mirrors in lockstep. Left: 2 multi-arm component cases (impl#1 compiles pipe-less multi-arm handlers in a component body wrong — E-CODEGEN-INVALID-LOGIC), samples/login (malformed arm), 5 E-CTX-broken samples, stdlib/store/kv (object-literal method !{} emitted raw).
- Final differential base e7fb5fba5 vs f23e6917a (same compiler-root path, roots examples,samples,conformance,stdlib,benchmarks,docs/readme-snippets): 0/11406 artifact diffs; 0 compile-outcome changes; 3 code-set changes (all +W-ARM-PIPE-LEGACY: 2 unmigrated component cases + samples/login); 8 text-only (code-frame excerpts / columns of the edited lines); +2 sources (new legacy-purpose cases). Gate green (hook); commands+lsp 658/0; snippet-gate 122/0; drift 18/0; conformance 1253 pass + 50 xfail.

## fix round r2 (BRIEF-r2.md; review of f3021d9f LAND-WITH-NITS)
- NOTE for PA (item 6): the rule rewrites a headless `| e :>` to `_ e :>` (impl#1 has always read it as the whole-error arm; a pipe-less `e :>` is E-MATCH-BARE-BINDER). The §19.4.5 table does not name this case — SPEC.md not edited; PA to decide whether the table should.
- r2 committed 0258a2239 (lint coverage/spans/messages, items 1-4,7) + 19ed5b0f0 (fix rule: nested, completeness net, CRLF, gaps filed); merged origin/main 6700ff591 (966dde67e; bootstrap-conformance.ts import conflict resolved keeping both; FACTS regenerated).
- r2 differential base 6700ff591 vs 966dde67e (same compiler-root path): 0/11406 artifact diffs, 0 outcome changes, 3 code changes (+W only: 2 component cases, samples/login), 8 text-only (code frames), +2 sources. Gate 30190/0; commands+lsp 664/0.
