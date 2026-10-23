# s469-lift-if-render-gate — progress

Branch `s469-lift-if-render-gate`, cut from origin/main `29b6320ad` (includes #1502 @ 0cb90a9a0).

Task: `if=` inside lifted markup becomes a real render gate (element⇄comment swap via `_scrml_ifrow_apply`,
the one mechanism `<each>` rows use) instead of a `style.display` toggle. Primary gap
`g-lift-row-if-is-display-toggle-not-a-render-gate-s462` + cluster.

## Log

- [x] startup: worktree clean, bun install (puppeteer postinstall fails — not needed, happy-dom), pretest.
- [x] probe family `security-failable-pack/shapes/n22.js`; base: every display-toggle position FAILs (textContent
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
- [x] tests: unit `lift-if-render-gate-s469`, browser `lift-if-render-gate-s469` (all fail on base), pack n22
      (62 shapes, base 59 FAIL + 3 crashes → 61 PASS + 1 PASS-REFUSED); select-row + todomvc-fixture updated.
- [x] SPEC §17.1 exception sentence replaced; §17.1.2.3 note updated; SPEC-INDEX regen (no line shift).
- [x] known-gaps entries + count hunk (`bun scripts/state.ts --write`).
- [x] corpus diff head vs base: 193 artifacts differ — 171 path-only (server.js embeds the compiler root path;
      base tree lives elsewhere), 12 genVar renumbering in shared modules, 4 gate-flag only (conformance
      for-lift-per-item-if-reactive), 6 display-toggle → swap (todomvc, 12-snippets-slots, trucking invoices /
      load-detail, rust-orders, odin-filebrowser). 0 compile-outcome / diagnostic / syntax changes.
