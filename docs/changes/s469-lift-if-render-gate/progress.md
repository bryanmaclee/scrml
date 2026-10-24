# s469-lift-if-render-gate — progress

Branch `s469-lift-if-render-gate`, cut from origin/main `29b6320ad` (includes #1502 @ 0cb90a9a0).

Task: `if=` inside lifted markup becomes a real render gate (element⇄comment swap via `_scrml_ifrow_apply`,
the one mechanism `<each>` rows use) instead of a `style.display` toggle. Primary gap
`g-lift-row-if-is-display-toggle-not-a-render-gate-s462` + cluster.

## Log

- [x] startup: worktree clean, bun install (puppeteer postinstall fails — not needed, happy-dom), pretest.
- [x] probe family `security-failable-pack/shapes/n23.js`; base: every display-toggle position FAILs (textContent
      still LOGGED IN after revoke); call-ref / quoted `if=` not gated at all (written as an attribute); the
      lifted `<each>` root CRASHES the harness (`ReferenceError: y is not defined`). The inline
      `${ for x of @xs lift … }` form is refused today (E-FOR-UNPARENTHESIZED-HEAD) — dropped from the family.
- [x] base corpus capture (scripts/corpus-emit-differential.ts, base tree = `git archive` of 29b6320ad).
- [x] emit-lift.js `emitLiftIfGate`: the one lowering for every lifted `if=` (AST + string-attr paths);
      `tryEmitLiftIfReactive` and the sole-root discriminant (`buildLiftReconcileCtx.soleRootMarkupNode`) removed.
- [x] `<each>` as the lifted root → `tryEmitNestedLiftEach` (shared emit-each lowering).
- [x] call-ref / quoted `if=` read; bare `if` / unknown kind → E-CG-003 (gated false).
- [x] emit-client.ts: `_scrml_ifrow_apply(` ships the `reconciliation` chunk (post-emit gate).
- [x] value-indexed predicate reading the row: live-keyed effect follows the row's value + moves the bucket;
      cell untracked (O(2) kept — measured by swap count).
- [x] tests: unit `lift-if-render-gate-s469`, browser `lift-if-render-gate-s469` (all fail on base), pack n23
      (62 shapes, base 59 FAIL + 3 crashes → 61 PASS + 1 PASS-REFUSED); select-row + todomvc-fixture updated.
- [x] SPEC §17.1 exception sentence replaced; §17.1.2.3 note updated; SPEC-INDEX regen (no line shift).
- [x] known-gaps entries + count hunk (`bun scripts/state.ts --write`).
- [x] corpus diff head vs base: 193 artifacts differ — 171 path-only (server.js embeds the compiler root path;
      base tree lives elsewhere), 12 genVar renumbering in shared modules, 4 gate-flag only (conformance
      for-lift-per-item-if-reactive), 6 display-toggle → swap (todomvc, 12-snippets-slots, trucking invoices /
      load-detail, rust-orders, odin-filebrowser). 0 compile-outcome / diagnostic / syntax changes.

## Round 2 (review of f2226103b — FIX)

- [x] F5: pack family renamed n22 -> n23 (sibling lane adds n22).
- [x] F1: every non-row lifted gate is a tracking render-gate effect; the `@name`-token subscriptions are gone;
      value-indexed (rows only) decided by detectPredicateShapeBind alone. Pack n23 +indirect guards, +for over a literal.
- [x] F2: row gate effects self-dispose (queued) when the key no longer resolves; the value bucket is released.
- [x] F4: lifted bind: input listener guarded (guardDetachedListener).
- [x] F3: SPEC §17.1 states the lifecycle divergence; gap g-row-and-lift-if-gate-not-memoryless-s469.
- [x] (a) top-level bare `<b if>` -> E-CG-003 (resolved); (b) component `@ok` in lift -> cell (resolved);
      (c) timer under a gated element keeps ticking (filed, open); (d) lifted show= -> display toggle (resolved).
- [x] merged origin/main twice (fb741076a, 7b2f7cac8); power loss between them lost nothing committed.
- [x] corpus diff round 2, base = main 0a2d747d3 vs head 7b2f7cac8 (2860 sources): 0 compile-outcome / diagnostic
      changes (the top-level bare-if E-CG-003 rejects nothing in the corpus); 194 artifacts differ — 171 path-only
      server.js, 12 trucking shared-module renumbering, 4 conformance for-lift row-gate self-dispose, 7 lift if=
      (display toggle / token subs -> swap + tracking effect + row self-dispose + bind guard: todomvc, invoices,
      load-detail, odin-filebrowser, 12-snippets-slots, rust-orders), 1 bind guard only (go-contacts).

## Round 3 (review of 060495fe2 — FIX)

- [x] F1 HIGH: body locals read by a lifted gate are snapshot at render (effect scope params); outside a row
      the condition is also read inline. Browser + pack n23 body-local shapes (568 shapes).
- [x] F2 MED: filed g-lift-gate-not-released-on-outer-owner-teardown-s469 (needs s469-effect-scope-dispose's
      owner-scope teardown; measured 2->4->6->8 buckets over arm toggles).
- [x] filed LOW: top-level bare show, top-level quoted show, lifted disabled=@ok set once, test-isolation
      TypeError leak; and MED g-while-lift-in-reconciled-row-escapes-the-row-s469 (found writing the tests).

## Round 4 (review of e7c7f7a28 — FIX)

- [x] F-A HIGH: one fail-closed rule — a gate is its own effect only when every name it reads is a compiler name,
      the row item / item-derived local, a file function or a JS global; else inline (and a keyed loop lowered plain).
      Snapshot machinery removed. Browser 24 + pack n23 +12 (591 shapes).
- [x] F-B: g-while-lift-in-reconciled-row-escapes-the-row-s469 rewritten and raised to HIGH (measured, main too).
- [x] F-C: mutated local array/object behave inline; 24 browser cases pass (all fail on main); nothing to file.
- [x] F-D: _scrml_ifrow_apply in the lift chunk — lifted-if page stripped gzip 7,453 -> 4,303 B (main 4,016);
      runtime-size-ratchet §4.

## Round 5 (review of 5e18bc99e — FIX, re-scoped)

- [x] main's evaluation placement is the oracle: A sole row root / B row-reading per-item effect / C LIVE arm effect /
      D at build + main's subscriptions; swap instead of display. All classifiers / own effects / snapshots /
      keyed->plain fallback removed. show= at B/C/D.
- [x] kept: call-ref/quoted read, E-CG-003 bare if, component @ fix, bind guard, lifted <each> root, owner-tree
      release (mount_track'd subscriptions/buckets; arm render scope via typeof-guarded calls).
- [x] ifrow runtime chunk; ratchet §4 three shapes (lift if 4,186 / each row if 8,245 / lift no-if 4,016 = main).
- [x] stale-on-main positions: browser test.failing (21), pack KNOWN_FAIL (36); gap g-lift-gate-placement-inherits-main-staleness-s469.
- [x] H1–H3 + M1b visible sets equal main's at every step (hidden absent); H4 refused as on main; M1a ReferenceError (main too).

## Round 6 (review of 3214a9a60)

- [x] F1: an escaped (ambient-target) lift inside a row keeps main's plain subscriptions (_withLiftTarget); 18-shape
      while-in-row oracle block (head visible == main visible at every step; 16 fail on 3214a9a60). Gap text corrected.
- [x] F3: arm-run helper is main's byte-for-byte unless the file has owner-tracked content (scoped variant, no comments);
      ifrow chunk keeps its own separator (lift chunk identical to main); ratchet §4 comment fixed.
- [x] F2: one-line note on the staleness gap.
- [x] reviewer differential (cases/cases2/cases3 + 18 while-in-row, 954 cases vs main e09b7be97): equal 618, head-hides-more 264,
      both-error 32, error-diff 20 (E-CG-003 bare if; show= shapes main refused), BOTH 20 (main crashes at mount: component @,
      lifted <each> root; markup_fn_row: main renders the hidden element's HTML as text, head a placeholder);
      HEAD-SHOWS-MORE 0.
