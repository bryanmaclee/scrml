# PROGRESS — D-4: server import specifiers emitted in SOURCE space, not stripped DIST space

Append-only. Timestamps UTC.

---

## 2026-07-28T00:00Z — startup verification PASSED

- `pwd` = `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a13a0346a415fdaf4` (XPS clone, `.claude/worktrees/agent-` prefix present).
- `git rev-parse --show-toplevel` == pwd.
- `git merge --no-edit main` -> "Already up to date." HEAD = `89db7981` (the brief's baseline). Tree clean.
- `bun install` -> 217 packages.
- `bun run pretest` -> "Compiled 13 test samples -> samples/compilation-tests/dist/".

## 2026-07-28T00:05Z — maps read

`.claude/maps/primary.map.md` read in full; task-shape routing row for a codegen emit-path fix
followed into `structure.map.md` / `dependencies.map.md` / `domain.map.md` (grep-targeted).
**Finding: NOT load-bearing.** No map row covers `stripPagesPrefix`, the SPEC 47.9.5 `pages/`-strip,
or the source-vs-dist coordinate space of an emitted import specifier. The maps are stamped
`c700c435` (stale vs HEAD `89db7981`) and their codegen rows describe the DB-authoritative /
chunk-namespace / each-reconcile surfaces, none of which touch this defect. Verified the actual
surface by grep + Read against current source instead.

## 2026-07-28T00:20Z — BASELINE captured (unmodified worktree, HEAD 89db7981)

Full suite `bun run test`:
```
28987 pass / 252 skip / 1 todo / 61 fail / 102213 expect() calls
Ran 29301 tests across 1284 files
```

## 2026-07-28T00:30Z — REPRODUCED, exactly as briefed

Fixture at (scratchpad) `d4/repro/`: `models/auth.scrml`, `app.scrml` (root control),
`pages/login.scrml` (depth-1), `pages/auth/deep.scrml` (depth-2).
Compile: exit 0, 0 errors (4 warnings, all unrelated lint).

Emitted BEFORE:

| emitted file | source | specifier | resolves? |
|---|---|---|---|
| `dist/app.server.js`      | `app.scrml`            | `./models/auth.server.js`    | YES |
| `dist/login.server.js`    | `pages/login.scrml`    | `../models/auth.server.js`   | NO |
| `dist/auth/deep.server.js`| `pages/auth/deep.scrml`| `../../models/auth.server.js`| NO |

`cd dist && bun -e "await import('./login.server.js')"` ->
`error: Cannot find module '../models/auth.server.js'`. Same for `auth/deep.server.js`.
Control `app.server.js` imports clean. Constant one-segment overshoot confirmed at both depths.

## 2026-07-28T00:35Z — surface survey (pre-fix)

Sole emission site of a local-`.scrml`->`.server.js` specifier: `emit-server.ts:1886`
(`grep -rn 'server\.js"' compiler/src/` confirms; the deferred/S207 prune pass at :5060 REUSES
`imp.jsSource` computed there, so one fix covers both).

Sole reversal sites: `api.js:2528` (`checkServerImportInvariant`) AND `api.js:2625`
(`emitValueOnlyServerJsForDanglingImports`). **The brief names only the first.** The second has the
IDENTICAL source-space reversal, runs immediately BEFORE the guard, and the guard's correctness
depends on it (it is what materializes a const-only module's `.server.js` so the guard sees
`target.serverJs`). Fixing (1) without it would silently break value-only server emission for any
importer under `pages/`. Treated as in-scope-by-necessity; both routed through ONE shared resolver.

## 2026-07-28T01:10Z — FIX PART 1 landed (`7d0355e0`) — emit-server.ts

New exported `distRelativeServerSpecifier(sourceSpecifier, importerFilePath, outputBaseDir)` plus two
file-local helpers (`isOutsideBase`, `distServerPathOf`), inserted directly under `computeServedPath`
so the two `pathFor`-mirroring computations sit together. Call site at the import loop now routes the
local-`.scrml` rewrite through it. The S207 deferred/prune pass reuses the SAME `imp.jsSource`, so it
is corrected by the one change (verified by reading the prune pass at emit-server.ts:5060).

Verified immediately: `login.server.js` -> `./models/auth.server.js`, `auth/deep.server.js` ->
`../models/auth.server.js`, `app.server.js` UNCHANGED at `./models/auth.server.js`; all three
`await import()` clean.

## 2026-07-28T01:25Z — FIX PART 2 landed (`7c057b32`) — api.js, BOTH reversal sites

The brief named `checkServerImportInvariant`. `emitValueOnlyServerJsForDanglingImports` (api.js:2603,
runs immediately BEFORE the guard) carries the IDENTICAL source-space reversal, and the guard's
correctness depends on it. Proven, not assumed — fixture `repro2/` (a const-only `models/consts.scrml`
imported server-side ONLY from `pages/login.scrml`) compiled with part 1 alone:

- `dist/models/consts.server.js` NOT emitted (the value-only path mis-resolved to
  `pages/models/consts.scrml`, found nothing, skipped);
- `dist/login.server.js` -> `Cannot find module './models/consts.server.js'`;
- and NO `W-SERVER-IMPORT-UNEMITTED` (the guard mis-resolved identically and treated the target as
  external).

So part 1 without part 2 would have converted one broken shape into another. Both sites now route
through ONE shared `serverImportTargetSource(importerSourcePath, relServer)` built on a FORWARD
dist-key index (`distServerKeyToSource` / `distDirOfSource`). Forward index, not inverse transform:
the inverse is genuinely ambiguous — dist `models/auth.server.js` could originate from
`models/auth.scrml` OR `pages/models/auth.scrml`.

Post-part-2 `repro2/`: `dist/models/consts.server.js` emitted, `login.server.js` imports
`./models/consts.server.js`, `await import()` clean.

Also corrected the now-false justification comment on the `.server.js`/`.client.js` skip inside
`rewriteRelativeImportPaths` (api.js:547). The skip stays — but its stated reason ("they live in the
dist tree at the same relative position as their .scrml source") is exactly the §47.9.5 blind spot
that produced this bug, and leaving it would invite a future reader to re-derive it.

## 2026-07-28T01:40Z — VERIFICATION 5: the guard still bites (and part 2 was load-bearing)

Fixture `repro3/`: `models/kinds.scrml` = TYPE-only (`export type Kind:enum`), server-imported by
`pages/login.scrml`. That target emits no `.server.js` and has no server-importable value export, so
the import genuinely dangles — the MISSING-FILE branch.

| compiler state | W-SERVER-IMPORT-UNEMITTED |
|---|---|
| baseline `89db7981` | FIRES (`'../models/kinds.server.js'`) |
| part 1 ONLY (api.js at baseline) | **SILENT** — a genuine dangler went unreported |
| part 1 + part 2 (HEAD) | FIRES (`'./models/kinds.server.js'`, dist-space) |

Then RESTORED the fixture (`export const DEFAULT_KIND` added, page imports the const): warning gone,
`dist/models/kinds.server.js` emitted, `await import('./login.server.js')` clean. Red -> green both
ways, gate intact.

Note on the ORIGINAL blind spot, stated precisely (it is NOT "the guard cannot see MISSING-FILE for a
pages/ importer"): pre-fix, the guard reversed the specifier in source space and the reversal happened
to land on the right source file, so both its branches were evaluated against the right target — it
simply never asked the only question that would have caught D-4, namely *does the emitted specifier
resolve in DIST space*. It was structurally incapable of seeing a specifier that names the right
module in the wrong coordinate system.

## 2026-07-28T01:55Z — VERIFICATION 3 + 4: R26 empirical corpus diff

Compiled an identical corpus twice — once with both files reverted to `89db7981`, once at HEAD —
into `artifacts-base/` and `artifacts-after/`. Corpus: `examples/22-multifile`,
`examples/23-trucking-dispatch` (36 files, nested `pages/`), all 32 single-file `examples/*.scrml`,
the 13 `samples/compilation-tests` pretest samples, and the three D-4 reproducers.

- `.server.js` artifacts produced: **44 -> 44** (no file added, none removed; `diff -rq` reports zero
  `Only in` entries).
- Artifact files whose bytes differ: **23**. Every single delta is ONE import-specifier line losing
  exactly one `../` segment. NOTHING else in any artifact changed.
  - `examples/23-trucking-dispatch`: **20** `.server.js` files changed (all under `pages/`).
  - reproducers: 3.
- **Byte-identity on the no-`pages/` case: HOLDS.** `examples/22-multifile`, all 32 single-file
  examples, and all 13 `samples/compilation-tests` artifacts are byte-identical (the only diffs in
  those trees are the compile-duration lines in the captured stdout logs).
- On-disk resolution of every relative import in every `.server.js`:
  - base: 61 specifiers, **26 DANGLING** across 23 files;
  - after: 61 specifiers, **0 DANGLING**.
  Same specifier count both sides — nothing added, nothing dropped, 26 corrected.
- Executed, not just grepped: at baseline `23-trucking-dispatch/driver/hos.server.js` and
  `auth/login.server.js` both die with `Cannot find module`; at HEAD `driver/hos`, `dispatch/board`
  and `auth/login` all `await import()` clean. **The canonical multi-file example app's server tier
  was non-functional for 20 of its routes on `main` and is functional now.**

## 2026-07-28T02:20Z — VERIFICATION 7: regression tests added

- `compiler/tests/unit/d4-dist-relative-server-specifier.test.js` — 22 tests, pure-function locks on
  the new exported `distRelativeServerSpecifier`. §1 depth-1/2/3 + `pages/`-internal siblings; §2 the
  root CONTROL and four no-`pages/` shapes, each asserted to equal EXACTLY
  `source.replace(/\.scrml$/, ".server.js")` (i.e. the pre-fix bytes — that IS the byte-identity
  lock at unit granularity); §3 segment-alignment (`sub/pages/`, `pages/pages/`, `pages.scrml`,
  `pagesfoo/`, and the TARGET-side strip); §4 the three fallbacks (no outputBaseDir / no importer /
  either endpoint outside the base) preserving pre-fix output verbatim; §5 well-formedness (never a
  BARE specifier, never a host separator, always `.server.js`).
- `compiler/tests/integration/d4-server-import-dist-space.test.js` — 16 tests, end-to-end. §1 the
  reproducer (root control + depth-1 + depth-2) asserting the dist layout, each specifier, that
  EVERY relative import in EVERY emitted `.server.js` resolves ON DISK, and that all three bundles
  actually `await import()` — the failure mode was a runtime resolution error on a green compile, so
  a shape assertion alone would not be honest. §2 the no-`pages/` project. §3 the const-only /
  value-only `.server.js` seam. §4 the `W-SERVER-IMPORT-UNEMITTED` red->green pair.

Both files were run against the BASELINE sources (`git checkout 89db7981 -- <the two files>`) to
confirm they are genuine locks: the integration file goes **9 pass / 7 fail**, and the unit file
fails to load at all (the exported helper does not exist). Sources restored immediately after.

## 2026-07-28T02:45Z — VERIFICATION 6: suite, controlled comparison

Raw `bun run test` (chains pretest):

| | pass | skip | todo | fail | tests | files |
|---|---|---|---|---|---|---|
| baseline `89db7981` (before any edit, before the new test files) | 28987 | 252 | 1 | 61 | 29301 | 1284 |
| HEAD (fix + new tests) | 29026 | 252 | 1 | **59** | 29338 | 1286 |

Raw counts are not a sound comparison on their own (different test-file sets), so the controlled
run: both states executed with the SAME test-file set (the new D-4 files present in both), captured
via `--reporter=junit`, and the failure NAME SETS diffed:

```
baseline failures (excl. the new D-4 tests): 66   ->  59 pre-existing + 7 D-4 (failing as designed)
post-fix failures (excl. the new D-4 tests): 59
NEW failures introduced by the fix: NONE (the set difference is EMPTY)
```

The pre-existing failure sets are **identical**, element for element: `after \ before` is empty and
`before \ after` is exactly the 7 D-4 integration tests. **Zero regressions.**

On the 61-vs-59 raw delta: it is run-to-run variance in the pre-existing failures, not an effect of
this change — the controlled set-diff above holds the test-file set constant and shows 59 in BOTH
states. The suite carries several timing-sensitive happy-dom/browser tests (one of the
soft-nav `M1 if=` cases takes ~990 ms and its output interleaves mid-line across runs). Not
investigated further: out of scope, and pre-existing either way.

## 2026-07-28T02:50Z — surfaced, NOT actioned (deferred; out of the brief's scope)

1. **`compiler/src/codegen/emit-tool.ts:281`** — `source.replace(/\.scrml$/, ".js")` is the SAME
   coordinate-space defect for the §64 `kind="tool"` / library-module artifact (`<base>.js`). A
   library-shaped `.scrml` under `pages/` imported by a tool/library-mode sibling would dangle
   identically. Not touched: different artifact class, its own byte-identity surface, and the brief
   scopes this dispatch to the server import + the guard. `codegen/index.ts:871` uses the same swap
   but only to build an `E-TOOL-006` message string — no emitted specifier, no defect.
2. **`api.js` `rewriteRelativeImportPaths` bare-`.js` skip (~L566)** — skips relocation for a `.js`
   whose `.scrml` this build compiled, on the same "mirrors the source tree at the SAME relative
   position" reasoning that §47.9.5 falsifies. Same latent class as (1); left alone for the same
   reason. The `.server.js`/`.client.js` skip immediately above it IS still correct, and its comment
   has been corrected in this dispatch.
3. **`cgOutputBaseDir` vs the write-phase `outputBaseDir`** — the emitted specifier and the new
   dist index are both computed against `cgOutputBaseDir` (derived from `metaFiles`), while
   `pathFor` derives its base from `[...cgResult.outputs.keys()]`. api.js's own comment asserts
   these coincide ("one output per input file"). If codegen ever dropped a file from `outputs`, the
   two common-prefix computations could diverge and the dist WRITE path would disagree with the
   emitted specifier. Pre-existing hazard, not introduced here; deliberately keyed the index to the
   EMITTER's base so guard and emitter cannot disagree with each other.
4. **No pre-commit hook is installed in this clone.** `.git/hooks/` contains only `*.sample`, and
   `core.hooksPath` is unset — so `git commit` runs no test gate here, contrary to the startup
   block's premise ("pre-commit `bun test` fails without `bun install`"). Every commit in this
   dispatch was made WITHOUT `--no-verify`; the gate was run manually instead (full `bun run test`
   plus the junit set-diff above). Flagging because a future dispatch may assume the hook is
   protecting it.
