# unit-id: s468-cps-unbound-cluster
Gaps (one unit, same mechanism family — read both entries in full):
1. `g-cps-split-local-from-session-unbound-on-server-s467` (HIGH) — a local in a CPS-split function initialised from the
   session is unbound on the server half. Locus searched (not traced): emit-server.ts CPS route handler body +
   emit-functions.ts CPS client wrapper.
2. `g-server-fn-calls-cps-split-fn-unbound-s467` (MED) — a server function calling a CPS-split function: peer-callable
   emission skips CPS-split functions. Locus searched: emit-server.ts peer-callable emission + route-inference.ts.
Governing: §19.9.9.8 (CPS placement — server logic and server values stay on the server; ratified S464 incl. the rule-3
amendment) and §19.9.9.7. #1435 (merged, 0083fc156) rewrote this area: read its diff first
(`git show --stat 0083fc156`, then the cps-cell-writes.ts / route-inference buildCpsStatementServerProbe changes).
⚑ Do NOT weaken any #1435 guarantee: re-run its tests (cps-server-logic-stays-server-s462 + browser, s465-cps-pre-first-
stays-client, s466-cps-guard-stays-server, s467-cps-carried-admission, s467-cps-nested-writes-and-callees, unit
cps-split-server-tier-s462, conformance server-db/cps-*) — all pass. Executed runtime verification, not emission
eyeballing. ⚑ Concurrency: #1434 + the trigger5 unit also touch emit-server.ts.
