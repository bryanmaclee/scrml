# progress — s462-markup-if-stale-render

- [x] fetch + merge origin/main (already up to date, base 91bfe3e03)
- [x] brief archived (cdde6e877)
- [x] read SPEC §10 (lift, in full), §7.4.2 (interpolation reactivity), §17.1 (`if=` sugar)
- [x] fix: arm-selector shape (emit-reactive-wiring emitLiftIfChainGroup + `_scrml_lift_branch_run`),
      IfChainCollector (emit-control-flow / emit-logic), emit-lift LIVE mode (per-binding effects) — ce4c58edb
- [x] self-review fix: LIVE/collector re-emission ONLY for a single-`if` effect-wrapped lift group;
      every other group byte-identical to base; side-channel entries withdrawn by identity — 242bb2fbf
- [x] tests: browser-markup-if-arm-rerender-s462 (18 cases; 12 of the original 16 fail on base),
      request-id-render-bridge item 4 re-pinned, odin-filebrowser shape pin (d1561ee54)
- [x] conformance: control-flow/markup-if-arm-reads-rerender-pos (bootstrap twin-able) +
      control-flow/markup-if-presence-arm-reads-rerender-pos (8c9e01b9c)
- [x] gates (on 242bb2fbf): pre-commit 34157/0 · tracking tiers 5630 pass/0 fail/10 skip ·
      browser-baseline PASS (48) · s34-census PASS · host-global-scan 0 violations ·
      facts regenerated · spec-index OK · bootstrap-conformance current · severity current ·
      snippet-gate 128/0 · corpus-compile-floor PASS · types-gate unchanged
- [x] emit-differential vs base: 0 compile/diagnostic/syntax deltas; 172 artifact diffs = 165
      project-root-path-only (env) + 7 real client.js changes (5 conformance cases, 2 gauntlet samples)

Findings:
- impl#2 (self-host-v2) has no Tier-0 markup `${ if … lift }` at all — parse-reject
  ("expected `}`, found `{`"); tracked as owed in self-host-v2/progress.md. No guard to port.
- `if=` element form on impl#1: reads in a shown element update (checked in happy-dom).
- gauntlet-r10-odin-filebrowser / -rails-blog throw at load on base AND head (pre-existing:
  `child is not defined`; `currentPost.published` on null) — changed groups executed in reduced form.

Pre-existing / env notes:
- full unit+integration+conformance under load average ~20: 6 fails, 5 were load flakes
  (sqlite lock waits, dev-run 90s timeout, a 10s runtime case) — all pass in isolation;
  the 6th (request-id-render-bridge item 4) was a text pin on the old `if (cond)` shape.
- browser-baseline --check: one run hit the "parser disagrees" interleave flake (47 vs 48);
  re-runs PASS (48 asserted, name set unchanged).
