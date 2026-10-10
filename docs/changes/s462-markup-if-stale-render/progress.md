# progress — s462-markup-if-stale-render

- [x] fetch + merge origin/main (already up to date, base 91bfe3e03)
- [x] brief archived (cdde6e877)
- [x] read SPEC §10 (lift, in full), §7.4.2 (interpolation reactivity), §17.1 (`if=` sugar)
- [x] fix: arm-selector shape (emit-reactive-wiring emitLiftIfChainGroup + `_scrml_lift_branch_run`),
      IfChainCollector (emit-control-flow / emit-logic), emit-lift LIVE mode (per-binding effects)
- [x] tests: browser-markup-if-arm-rerender-s462 (16, 12 fail on base), request-id-render-bridge
      item 4 re-pinned — committed with the code (ce4c58edb, pre-commit 34156/0 fail)
- [x] conformance: control-flow/markup-if-arm-reads-rerender-pos (bootstrap twin-able) +
      control-flow/markup-if-presence-arm-reads-rerender-pos; FACTS + bootstrap-conformance regen (8c9e01b9c)
- [x] gates so far: s34-census PASS · host-global-scan 0 violations · spec-index OK · severity current ·
      facts regenerated · bootstrap-conformance regenerated · types-gate unchanged · browser-baseline PASS (48)
- [ ] emit-differential (base captured: 2662 enumerated / 0 syntax-failing), snippet-gate,
      corpus-compile-floor, tracking tiers

Findings:
- impl#2 (self-host-v2) has no Tier-0 markup `${ if … lift }` at all — parse-reject
  ("expected `}`, found `{`"); tracked as owed in self-host-v2/progress.md. No guard to port.
- `if=` element form on impl#1: reads in a shown element update (checked in happy-dom).

Pre-existing / env notes:
- full unit+integration+conformance under load average ~20: 6 fails, 5 were load flakes
  (sqlite lock waits, dev-run 90s timeout, a 10s runtime case) — all pass in isolation;
  the 6th (request-id-render-bridge item 4) was a text pin on the old `if (cond)` shape.
- browser-baseline --check: one run hit the "parser disagrees" interleave flake (47 vs 48);
  re-run PASS (48 asserted, name set unchanged).
