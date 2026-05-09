# Progress — B14 PASS 10.B path-shape mismatch fix

## Phase 0: Survey (DONE)

- See SURVEY.md.
- Bug confirmed at `compiler/src/symbol-table.ts:4088` (`walkValidateCrossFileEngineMounts`).
- Same bug pattern at line 997 (`fireImportPinnedInvalid`).
- Chosen approach: option (a) — lookup-site fix with try-literal-then-absolute pattern.
- C15 workaround retained (different stage, parallel fix, no dependency).

## Phase 1: Fix (DONE)

- Imported `resolveModulePath` from `module-resolver.js` into `symbol-table.ts`.
- Added the `lookupExportRegistry(exportRegistry, sourcePath, importerPath)` helper at line ~998 (just before `fireImportPinnedInvalid`). Tries literal first, then absolute-resolved fallback for relative specifiers when the importer path is known.
- Applied at:
  - `fireImportPinnedInvalid` (line ~1006) — `filePath` piped through; signature gained 4th param.
  - `walkValidateCrossFileEngineMounts` (line ~4152) — uses local `filePath` parameter the function already had.
- Call site of `fireImportPinnedInvalid` updated (line ~6735) to pass `filePath`.

### Scope expansion the fix surfaced

The path-shape mismatch was MASKING a second bug: in production runs, PASS 10.B silently no-op'd, so cross-file `<channelName/>` mounts (legit P3.A CHX semantics) never tripped E-ENGINE-MOUNT-NOT-ENGINE. The fix exposed 11 channel-flavored test failures (P3.A CHX cross-file inline expansion + multi-page broadcast), all firing the false positive.

Resolution: extended the suppression list to include `category === "channel"` alongside `user-component`. CHX (CE phase 2) inlines the source `<channel>` decl into the consumer at the use-site, so `<channelName/>` IS the legitimate cross-file mount and SYM PASS 10.B must NOT fire.

Also flipped the existing `engine-binding-b14.test.js:474` test ("imported channel mounted as <X/> → fires") to `→ suppressed` with a doc comment explaining the convergence.

### Budget bump

`symbol-table.ts`'s isComponent count rose from 6 to 8 (two new mentions in the helper's type signature — pure type-shape, no routing reads). Bumped the P3-FOLLOW budget at `p3-follow-no-isComponent-routing.test.js:94` accordingly.

### Test result

Post-Phase-1: 10669 pass / 69 skip / 1 todo / 3 fail (pre-existing self-host parity). Net +1 pass vs baseline because Phase 1's flipped channel-mount test now expects the correct behavior.

## Phase 2: Tests (DONE)

Added 8 tests under a new describe block "B14 SYM PASS 10.B — path-shape resilience (S75 fix)" in `engine-binding-b14.test.js`:

1. Absolute-keyed exportRegistry + engine import → no diagnostic (positive case the bug currently failed in production).
2. Absolute-keyed + non-engine (function) → fires E-ENGINE-MOUNT-NOT-ENGINE (regression).
3. Absolute-keyed + user-component → suppressed (regression).
4. Absolute-keyed + channel → suppressed (regression for the P3.A CHX surface that drove the 11-test regression during Phase 1).
5. Deep-nested relative path (`./subdir/engines.scrml`) → resolves correctly.
6. Parent-relative path (`../shared/engines.scrml`) → resolves correctly.
7. Synthetic importer path (no on-disk file) → absolute fallback still works (purely-string `resolve()` logic).
8. No exportRegistry (test-harness path) → skips silently (regression).

Final test count: 10677 pass / 69 skip / 1 todo / 3 fail (pre-existing self-host parity).
Delta: +9 vs baseline (8 new + 1 flipped).
