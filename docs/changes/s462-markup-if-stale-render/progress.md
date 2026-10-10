# progress — s462-markup-if-stale-render

- [x] fetch + merge origin/main (already up to date, base 91bfe3e03)
- [x] brief archived
- [x] read SPEC §10 (lift, in full), §7.4.2 (interpolation reactivity), §17.1 (`if=` sugar)
- [x] fix: arm-selector shape (emit-reactive-wiring emitLiftIfChainGroup + `_scrml_lift_branch_run`),
      IfChainCollector (emit-control-flow / emit-logic), emit-lift LIVE mode (per-binding effects)
- [x] tests: browser-markup-if-arm-rerender-s462 (16, 12 fail on base), conformance
      control-flow/markup-if-arm-reads-rerender-pos, request-id-render-bridge item 4 re-pinned
- [ ] commit code + tests (one commit)
- [ ] gates (tracking tiers, browser-baseline, s34-census, host-global-scan, facts, spec-index,
      bootstrap-conformance, severity, snippet-gate, corpus-compile-floor, emit-differential)
- [ ] bootstrap check / known-gaps entry

Pre-existing / env notes:
- full unit+integration+conformance under load average ~20: 6 fails, 5 were load flakes
  (sqlite lock waits, dev-run 90s timeout, a 10s runtime case) — all pass in isolation;
  the 6th (request-id-render-bridge item 4) was a text pin on the old `if (cond)` shape.
- browser-baseline --check: one run hit the "parser disagrees" interleave flake (47 vs 48);
  re-run PASS (48 asserted, name set unchanged).
