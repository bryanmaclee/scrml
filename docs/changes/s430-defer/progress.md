# s430-defer progress
- 2026-09-24T06:55:50-06:00 start, base f554e171
- 2026-09-24 live parser (77c3c015) + native parser (a7c5e705) landed: contextual `defer` -> live `defer-stmt {body[], blockForm}`.
- checks: validators/lint-defer.ts (E-DEFER-OUTSIDE-FUNCTION / -NESTED / -CONTROL-FLOW) wired in api.js; RI: defer-stmt tiered by its body, E-DEFER-SERVER-IN-SPLIT; TS: E-DEFER-UNHANDLED-FAILABLE replaces E-ERROR-002 inside deferred bodies.
- codegen: codegen/lower-defer.ts (defer -> try-stmt{deferLowered}; skips CPS-split top level), emitDeferScope, fn tail, CPS wrappers open try at defer / close after last batch.
- conformance/cases/defer/* (17 cases, codes + runtime incl. CPS after-last-continuation + intermediate-batch failure). Adversarial: naive top-level lowering FAILS cps-after-last-continuation ("start;D;").
- adapter fix: impl1-ts ROUTE_RE greedy capture never matched multi-batch routes (pre-existing).
