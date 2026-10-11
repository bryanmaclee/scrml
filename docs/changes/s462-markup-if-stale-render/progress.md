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

## Fix round 1 (S239 review of db40d22a8 → FIX; brief: BRIEF-fix1.md)

- [x] F1 HIGH — LIVE bindings no longer close over mutable arm locals. `liftArmMutableLocals`
      (emit-lift.js) walks the chain's AST: a name is safe only if it is a `const`/`lin`, a
      function name or parameter, a per-iteration `for … of` binder, or a single keywordless
      declaration, AND is never assigned, updated, or the root of a member write or method call.
      Each LIVE push carries that set; a binding (or a keyed list's untracked first render) whose
      emitted expression reads one (acorn free-identifier walk) stays unwrapped, so the arm effect
      re-renders it. Residual: mutation through a function the local is passed to is not seen.
- [x] F2 MED — the chain's conditions are evaluated only by the selector. The selector
      (`_scrml_lift_if_group`) owns the selected arm; every arm-run gate compares against it.
      Glitch safety without re-evaluation: an outgoing arm's effect that throws before the
      selector runs is reported only if the arm is still current a microtask later.
- [x] F3 MED-LOW — re-entrancy: the arm renders into a fragment that reaches the host only if
      the run is still alive after body(); effects created after the run stopped are disposed at
      once; the render effect, disposed mid-run (the runtime re-subscribes it when the run
      returns), is disposed again on a microtask.
- [x] F4 LOW — every effect a render creates, early or late (keyed rows added later), is owned
      by that render and disposed on re-render / swap.
- Tests: 7 new browser cases (F1 ×4, F2, F3 200-cycle live count, F4 101 rows); the 6 bug
  cases fail on db40d22a8.

⚑ COORDINATION (narrowing branch — runtime effect PRIORITY): the selector effect is the group's
render gate. It is created at exactly ONE place: `const d = mkEffect(select);` inside
`_scrml_lift_if_group` (LIFT_BRANCH_RUN_HELPER, emit-reactive-wiring.ts). Attach the render-gate
priority there. Once render gates run first, the microtask-deferred error reporting in
`_scrml_lift_arm_run`'s gate becomes a no-op path (it stays correct). Scheduler not changed here.
- [x] merged origin/main 801419299 (known-gaps conflict = @generated:gap-counts hunk only →
      resolved + `state.ts --write`; FACTS / bootstrap-conformance regenerated; master-list = main).
- [x] host-global-scan caught Set / queueMicrotask / console in the new driver → routed via `_scrml_g`.
- [x] gates on 888a9dd23: pre-commit 34336/0 · tiers 5630/0/10 skip · browser-baseline PASS (48) ·
      s34-census PASS (base 801419299) · host-global-scan 0 · facts · state · spec-index ·
      bootstrap-conformance · severity · snippet-gate 128/0 · corpus-compile-floor · types-gate.
- [x] emit-differential base 801419299 vs head: 0 compile/diagnostic/syntax deltas; 172 artifact
      diffs = 165 project-root-path only + the same 7 chain-group client.js files.

## Fix round 2 (re-review #2 of 821da6c69 → FIX)

- [x] F1 (round 2) HIGH — the mutability analysis was unsound (aliases, closures, mutation through
      a callee). Replaced by the conservative rule: a binding gets its own LIVE effect ONLY when its
      expression reads no name declared inside the chain (`liftArmDeclaredNames`: let/const/lin/
      keywordless decls, loop binders incl. C-style counters, destructured names, function and
      lambda names + params). Cells, file-scope names and globals are fine. `liftArmMutableLocals`
      deleted. Tests m1_1, m1_2, m1_3, m1_4, m1_6, m1_7 (the five named ones fail on 821da6c69);
      m1_5 (`[o.v] = [40]`) fails the compile with E-CODEGEN-INVALID-LOGIC on base and head alike —
      not a runtime case.
- [x] SIGNAL received (narrowing #1396 at 3d5fab91c). Merged origin/main (be7762efa): import-line
      conflicts in emit-control-flow.ts / emit-logic.ts kept both sides; generated docs regenerated.
- [x] Item 2 MED-HIGH — the selector is a render gate: `mkEffect(select, true)`. The mount-deferred
      and nested-group `own` wrappers, and the arm run's own wrapper, now pass the gate flag through
      (they dropped every second argument). Test g1: hist never records 0.
- [x] Item 3 MED — the microtask error suppression is gone. During the group's creation an error
      throws out of init, as the plain group's first render does (e3, both forms). After init an
      effect of the group that throws is reported AT ONCE with the runtime's own line and stays
      subscribed (e1, both forms: same error count, synchronous). That last part is the kept
      improvement: the plain group's effect loses its subscriptions with one error (blank for good);
      the chain keeps rendering — and nothing is hidden.
- [x] Item 4 — an arm started during a write's gate pass renders that write's state; its bindings
      (born in the gate pass, skipped for that write) track the next write (test).
