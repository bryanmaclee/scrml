# scrml dev codegen divergence — progress

## 2026-05-12 — Startup

- WORKTREE_ROOT: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a40c38c38575e2c23`
- TESTS_BEFORE: 11511 pass / 96 skip / 1 todo / 0 fail / 557 files
  - Note: differs from dispatch-expected 11577/114/0/561; first run had 2 ECONNREFUSED (flaky network test). Stable rerun = 0 fail.
- Hooks path: `scripts/git-hooks` enabled.

## 2026-05-12 — Reproduction

- Ran static `bun scrml compile examples/23-trucking-dispatch/`. Compile
  itself fails with 4 × `E-CHANNEL-OUTSIDE-PROGRAM` (the fixture uses pre-
  v0.3 PURE-CHANNEL-FILE pattern; channels live at top level of
  `channels/*.scrml`). That's the v0.3 reversal — unrelated to this
  dispatch.
- DESPITE the SYM-stage errors, the pipeline still runs CG and emits
  `.server.js` + `.client.js` files into `dist/`. Scanning the emitted
  files revealed **the bug is in the emitted import statements, not in
  dev-vs-static divergence**:

  Source:  `${ import { "dispatch-board" as dispatchBoard } from '../../channels/dispatch-board.scrml' }`
  Emitted: `import { dispatch-board } from "../../channels/dispatch-board.server.js";`

  `dispatch-board` is invalid JS identifier syntax — fires
  `SyntaxError: Unexpected token '-'` at file load. ~30 emitted files
  in trucking-dispatch carry this shape (kebab-named channels imported
  in pages on both `.server.js` and `.client.js` sides).

- The dispatch's "dev vs static divergence" framing is **incorrect**.
  Both modes emit the SAME broken output. The static path looks "clean"
  only because `scrml compile` exits with code 1 before loading any
  emitted file; the dev path loads the emitted JS via `import()` at
  route-registration time, where the JS engine surfaces the SyntaxError.
  Recorded as a surprise — see final report.

## 2026-05-12 — Root cause

- `compiler/src/codegen/emit-server.ts:262` and `emit-client.ts:516`
  both emit `import { ${stmt.names.join(", ")} } from ...`.
- `stmt.names` for the source `{ "dispatch-board" as dispatchBoard }`
  is `["dispatch-board"]` (the IMPORTED name with quotes stripped, per
  ast-builder.js:5832-5837). Two problems:
  - Bare kebab is invalid JS → SyntaxError.
  - The channel's compiled exporter does NOT bind the channel name as
    an ES export — channels are inlined by CHX at the consumer site,
    not resolved via ES module bindings. So even fixing the SyntaxError
    (by emitting `import { "dispatch-board" as dispatchBoard }`) would
    just promote the failure mode to a module-link error
    (`does not provide an export named 'dispatch-board'`).
- Also discovered a latent bug at the same locus: aliased imports
  `{ X as Y }` were emitting `import { X }` only — losing the alias.
  Source references to `Y` would fail. Test §C20.1.4 was locking in
  this buggy emission.

## 2026-05-12 — Fix

- New helper `filterChannelImportSpecifiers(stmt, importerPath,
  exportRegistry)` in `compiler/src/codegen/emit-channel.ts`:
  - Resolves each specifier's imported name against MOD's
    exportRegistry (with both literal-key and absolute-resolved-key
    lookups, mirroring `emit-engine.ts:lookupSourceMap`).
  - Drops specifiers with `category === "channel"`.
  - Falls back to a syntactic check (non-JS-identifier-name = drop)
    when no exportRegistry is provided (test paths).
- `emit-server.ts` + `emit-client.ts` import-emit loops call the helper.
  When ALL specifiers are channels, the entire `import { ... } from ...`
  line is suppressed. When MIXED, only channel specifiers are filtered
  and the remaining bindings emit using canonical `{ imported as local }`
  ES form (fixes the latent aliased-import bug too).
- Updated test §C20.1.4 to assert the canonical `{ foo as bar }` shape
  (was asserting the prior buggy `{ bar }` shape).
- Added `codegen/emit-channel.ts` to the P3-FOLLOW isComponent allowlist
  with budget 2 (both occurrences are type-signature annotations only —
  routing read uses `category === "channel"`, never `.isComponent`).

## 2026-05-12 — Verification

- New regression test `compiler/tests/unit/cross-file-channel-import-emit.test.js`
  passes (3/3).
- Re-ran `bun scrml compile examples/23-trucking-dispatch/` — still
  fails with the pre-existing E-CHANNEL-OUTSIDE-PROGRAM (v0.3 reversal,
  out of scope), but every emitted `.server.js` and `.client.js` now
  `node --check`s clean. Zero `import { kebab-name }` lines remain.
  (One unrelated codegen bug in `pages/customer/load-detail.client.js`
  surfaced — a `lift <li>` for-loop body being inlined into a text-node
  literal. Recorded as deferred — separate codegen bug independent of
  channel imports.)
- Full test suite: 11514 pass / 96 skip / 1 todo / 0 fail / 558 files
  (+3 pass, +1 file from baseline).

