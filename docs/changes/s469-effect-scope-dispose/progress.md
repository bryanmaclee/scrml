# s469-effect-scope-dispose — progress

Gap: `g-row-and-arm-effect-scopes-never-disposed-s469` (MED; stale-effect security class).
Branch `s469-effect-scope-dispose`, cut from origin/main @ 29b6320ad (includes #1502).

## Log

- [x] Startup: bun install, pretest. Reproduced both faces with a new browser test
      (`compiler/tests/browser/row-arm-effect-scope-dispose-s469.browser.test.js`): 11 of 12 cases FAIL on
      main (the engine-arm case passed pre-fix), incl. a removed row's node being WRITTEN after its key
      returned (`b:0` → `b:8`).
- [ ] Runtime: owner-scope tree + row scopes + arm scopes + effect owner capture.
- [ ] Codegen: dispatcher runs the arm wire / each remount inside `_scrml_arm_scope`.
- [ ] security-failable-pack shapes.
- [ ] Corpus emit diff.
- [ ] SPEC §17 sentence + regen-spec-index.
- [ ] known-gaps entry resolved + state.ts count regen.
