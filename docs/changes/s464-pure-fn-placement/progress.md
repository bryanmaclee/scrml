2026-10-12T14:44:17-06:00 start; branch s464-pure-fn-placement at 707c499fb
2026-10-12T14:45:18-06:00 gate: §12.4 pure clause + §13.4 callee no route + §48.3.5 fn always sync → conformance fix
2026-10-12T14:50:51-06:00 fix: 5c skip for plain fn + computePureFnSidePlacement (RI) + emit-server pure helper emission + emit-functions client skip; repro/shop verified by execution (status 200, 3240)
2026-10-12T15:15:31-06:00 fail-closed amendment: a fn reaching @-state keeps prior placement (E-REACTIVE-003 still fires; p3 transitive case byte-identical to main). New tests: compiler/tests/integration/s464-pure-fn-placement.test.js (7; 5 fail on origin/main, 2 are guards)
