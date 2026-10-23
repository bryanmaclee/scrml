# s469-effect-scope-dispose — progress

Gap: `g-row-and-arm-effect-scopes-never-disposed-s469` (MED; stale-effect security class).
Branch `s469-effect-scope-dispose`, cut from origin/main @ 29b6320ad (includes #1502).

## Log

- [x] Startup: bun install, pretest. Reproduced both faces with a new browser test
      (`compiler/tests/browser/row-arm-effect-scope-dispose-s469.browser.test.js`): 11 of 12 cases FAIL on
      main (the engine-arm case passed pre-fix only because it set the wrong cell; corrected), incl. a removed
      row's node being WRITTEN after its key returned (`b:0` → `b:8`).
- [x] Runtime (`cd0af1e94`): owner-scope tree in a NEW chunk `owner` — row scopes around createFn, arm scopes
      (`_scrml_arm_scope`), depth-first `_scrml_owner_destroy`, effects capture / run in / die with their
      creation scope. First attempt put it in the always-included `scope` chunk: +770 B gzip on the shell,
      over the S461 size ratchet (6,087 / 6,095 B) — moved to its own chunk; shell byte-identical.
      Dropped: a subscriber-runs-in-its-registration-scope wrapper in `core` (no bytes for it; filed as
      `g-module-mount-owner-recorded-from-writer-scope-s469`).
- [x] Codegen (`bcecd3717`): the variant-guard dispatcher wires inside `_scrml_arm_scope`; a module-scope
      mount with an each-bearing arm releases its boot-rendered rows (`_scrml_release_rows`).
- [x] `1de100f33`: the owner-chunk presence guard reads the `_scrml_scope_recs` CONST — a sibling runtime
      eval'd into the same global (browser harnesses) leaks function decls and broke if-mount-ref-clobber §2
      in the full browser run.
- [x] Self-attack (`2db14705b`): the SAME write removes a row and changes what its arm reads — the detached arm
      is never written; a row removed mid arm-switch keeps nothing alive.
- [x] security-failable-pack n22 (`0d58c731a`): 9 shapes, 9/9 FAIL on 29b6320ad (measured with a git-archive
      extract of origin/main), 9/9 PASS after. Pack 465 shapes.
- [x] Corpus emit diff (2,859 sources, scratch harness — base = git-archive of origin/main): only runtime
      bundles (owner chunk + effect owner capture) and dispatcher wiring in client.js changed. See report.
- [x] SPEC §17.7.2 sentence + regen-spec-index (`6bc5a7fc7`).
- [x] known-gaps: entry + the folded LOW resolved; two residual LOWs filed; `bun scripts/state.ts --write`.

## Round 2 (review of ffbe1cf2b: FIX)

- [x] F1 HIGH (`79435fdc6`): reproduced (match + engine). A mount already in the document now takes its
      STRUCTURAL owner (`_scrml_structural_owner`: if= range marker `_scrml_if_sid`, arm marker `_scrml_arm_sid`,
      row head `_scrml_row_scope`), never the writer's scope; a mount still being built takes the active (row)
      scope. Probes: top-level `<each>` rendered from a row write, top-level `if=` first flipped from a row,
      derived first read in a row — all already correct; pinned as browser tests anyway.
- [x] n22 +2 shapes (`2e7e91300`): FAIL on ffbe1cf2b, PASS on main and after. 467 shapes.
- [x] LOW: `_scrml_arm_scope` tears its scope down if `wire` throws (in `79435fdc6`).
- [x] LOW: on a page without the owner chunk an effect no longer re-enters its creation scope (no cleanups
      under a dead `if_N` key) — in `79435fdc6`.
- [x] Gap re-rated HIGH (branch-only) and resolved.
- Power loss mid-round; resumed from 2e7e91300 + the staged known-gaps edit (committed as-is).
- Hook flake: `slice-m1/counter.browser.test.js`'s inner `beforeAll` has the default 5 s timeout and its first
  `printCore` takes ~4 s on main, ffbe1cf2b and head alike (measured); it times out under load. Not this change.

## Pre-existing (not this change)

Browser suite on main in this environment: 61 failing tests (49 after this branch = 61 − the 12 fixed here).
Nine files fail identically on main run alone (navigate cross-chunk / soft-nav, transitions, engine-gated-each,
engine-message-dispatch-s155, g-each-peritem-markup-value-ternary, g-emit-lift-markup-text-interp,
i174-formcontrol-value-property, render-by-tag-nested-compound-bug60). `bun install` reports the puppeteer
postinstall failing.
