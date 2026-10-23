# s469-lift-if-render-gate — progress

Branch `s469-lift-if-render-gate`, cut from origin/main `29b6320ad` (includes #1502 @ 0cb90a9a0).

Task: `if=` inside lifted markup becomes a real render gate (element⇄comment swap via `_scrml_ifrow_apply`,
the one mechanism `<each>` rows use) instead of a `style.display` toggle. Primary gap
`g-lift-row-if-is-display-toggle-not-a-render-gate-s462` + cluster.

## Log

- [x] startup: worktree clean, bun install (puppeteer postinstall fails — not needed, happy-dom), pretest.
- [x] probe family `security-failable-pack/shapes/n22.js` written; measured on base: every display-toggle
      position FAILs (textContent still LOGGED IN after revoke). `lifted each root` CRASHES the harness
      (`ReferenceError: y is not defined` — the `<each>` root is emitted as a literal element).
      The inline `${ for x of @xs lift … }` form is now refused (E-FOR-UNPARENTHESIZED-HEAD).
- [ ] base corpus capture (scripts/corpus-emit-differential.ts) — running
- [ ] emit-lift.js: one gate helper for every lifted `if=` (AST path)
- [ ] emit-lift.js: `<each>` as the lifted root routes through emitNestedEachFromMarkup
- [ ] string-attr path (emitSetAttrs) — measure reachability first
- [ ] tests: unit, browser, pack n22
- [ ] SPEC §17.1 exception sentence; SPEC-INDEX regen
- [ ] known-gaps entries + count hunk (scripts/state.ts)
- [ ] corpus diff head vs base
