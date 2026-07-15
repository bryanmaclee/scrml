# GITI-036 — progress / resolution record

Branch: `fix/giti036-structural-eq-treeshake` (base `211dc076`).

## Status: COMPLETE

## Mechanism (fully diagnosed)

The `equality` runtime chunk (defines `_scrml_structural_eq`) is gated by the
AST-cached `hasEqualityExpr` flag. That flag is computed at **PRECG** time by
`compiler/src/compute-pgo-flags.ts:detectEqualityExprPresence`, which walks the
AST looking for a `binary` node with op `==`/`!=`.

But a `<match>` arm body is stored **RAW at TAB** and only lowered to ExprNodes
at **CG** time — `compiler/src/codegen/emit-match.ts` caches the lowered arms on
`matchBlock.__scrmlCachedArms` (line ~984). When a `==` lives inside such a
deferred arm body — specifically when the arm also carries an `<each>` nested in
a markup-valued ternary, which forces the deferred-lowering path — there is **no
`binary` node in the AST at PRECG**, so `detectEqualityExprPresence` returns
false → `hasEqualityExpr === false` → the `equality` chunk is tree-shaken out.
The CG lowering then emits `_scrml_structural_eq(` into `*.client.js`, leaving a
dangling reference → `ReferenceError` at runtime.

Ground-truth confirmation (temporary debug instrumentation, since reverted):
- `status.scrml`: `eqFlag=false`, yet an unconditional-descent walk at CG time
  finds `binEq=3` binary `==` nodes (all under `__scrmlCachedArms[2]`).
- The PGO walker's kind-gated descent is not the issue per se — the binary nodes
  **do not exist at all** at PRECG (they are created during CG). So a walker fix
  cannot help; the post-emit scan (which keys on actual CG output) is the only
  robust fix.

## Fix (narrow-vs-general choice: TARGETED GENERAL)

`compiler/src/codegen/emit-client.ts` — added a POST-EMIT reference gate right
after the existing `log` / `ssr` post-emit gates in `generateClientJs`. It scans
the emitted client body (ground truth) for the helper CALL and seeds the
defining chunk:

```
["_scrml_structural_eq(", "equality"]   // GITI-036, empirically confirmed
["_scrml_reset(",         "reset"]      // same PRECG-walker root cause, defensive
```

Chose **targeted-general** (the two PRECG-presence-walker-gated helpers) over
(a) narrow equality-only and (b) a full auto-derived helper→chunk index:
- Narrow-only would leave the identical-root-cause `reset` sibling latent
  (Rule 2 — no ship-the-smaller-surface).
- The full auto-index is NOT clean+low-risk: it collides with the ss27-4 stdlib-
  chunk prune and needs fragile per-chunk definition-name extraction.
- The targeted table matches the established `log`/`ssr` post-emit idiom + the
  server's `emitted.includes` precedent, is reference-gated (over-inclusion
  guard preserved), and additive-only (worst case a few KB, never a dropped
  chunk).

`equality` handles map comparison inline via the `__scrml_map` tag (no call into
the `map` chunk) → seeding `equality` alone is self-contained; no
`applyChunkDependencies` re-run needed.

## Sibling analysis

- `_scrml_reset` (reset chunk): shares the EXACT root cause (same PRECG walker
  `detectResetExprPresence`, same deferred-arm lowering). Covered defensively.
  A reproduction attempt (reset in an `on:click` inside a deferred ternary-markup
  branch) emitted 0 client `_scrml_reset(` calls, so NOT empirically reproduced
  via that path — the reference gate makes the reset seed a no-op unless a build
  actually emits `_scrml_reset(`.
- `_scrml_log` / `_scrml_ssr_`: already have post-emit gates — safe.
- `map` helpers: gated by `fileHasMapUsage` on DECLARED map cells (top-level),
  not by an expression-presence walker — not exposed to the deferred-arm miss.

## Verification (R26 empirical, pre + post)

`status.scrml` (adopter):
- pre-fix: client `_scrml_structural_eq` = 2, runtime `function _scrml_structural_eq` = 0 (BUG)
- post-fix: client = 2, runtime = 1 (FIXED)

Minimal standalone repro (`==` in deferred match arm with `<each>`):
- pre-fix: client 1 / runtime 0 → post-fix: client 1 / runtime 1

Over-inclusion guard (structurally identical `==`-free page):
- client 0 / runtime 0 (equality chunk still tree-shaken OUT) — both pre and post.

## Tests

`compiler/tests/integration/giti-036-structural-eq-treeshake.test.js` (9 tests):
- pairing: client emits `_scrml_structural_eq(` AND runtime DEFINES it;
- no-dangling-reference invariant;
- over-inclusion guard (`==`-free page excludes the chunk);
- valid-JS (`vm.Script`) for both client + runtime.
Verified failing (2 fails) against pre-fix `emit-client.ts`; passing post-fix.

## Gate

Full pre-commit hook (whole suite + browser checks) ran GREEN on both the fix
commit and the test commit. Never used `--no-verify`.
