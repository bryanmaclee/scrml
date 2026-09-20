# progress — s424-d6-set-threw-partial-seed (item 3)

Append-only. Newest at the bottom.

## 2026-09-20T12:20Z — F4 gate PASSED, brief read, locus confirmed

- `pwd` = `.../scrml/.claude/worktrees/agent-a71015035753d3d7b` OK (worktree, not the shared checkout)
- `git rev-parse --show-toplevel` = same OK
- `git status --short` = only `A docs/changes/s424-d6-set-threw-partial-seed/BRIEF.md`, which is the
  file the dispatch told me to check out in step 1 OK
- `git merge-base HEAD origin/main` = `6f213495d1bda3376d87d71b2838ad542ccbfe3e` = `origin/main` OK
- `bun install` — FAILED first on puppeteer's postinstall (the chrome 146 cache dir exists but the exe
  is missing). Re-ran with `PUPPETEER_SKIP_DOWNLOAD=true`: 218 installs OK, `node_modules/acorn`
  present. This tier needs no browser fixtures, so the skip is sound. NOT a blocker.
- `bun run pretest` deliberately NOT run.

## 2026-09-20T12:22Z — maps: NOT load-bearing (reported as the brief asks)

`grep -i 'render-map|render-harness|render-detector|D6'` over `.claude/maps/primary.map.md` returns
**two** hits and both are per-directory TEST-FILE-COUNT rows (`e2e-render-map 2`). `test.map.md` adds
only more count rows plus one line noting the harness "was substantially reworked without its file
count moving". **There is no routing, no symbol index and no claim about this tier's semantics
anywhere in the maps.** So the staleness warning in the brief was moot in the safest way: the map had
nothing to be stale ABOUT here. The locus came from source, as intended.

## 2026-09-20T12:25Z — the traced locus HELD, verbatim

`render-harness.js:741` is exactly as quoted. `applySeed` (`:511`) confirms the four reason codes
(`no-such-cell`, `derived-cell`, `written`, `set-threw`) and that only `set-threw` pushes a
`[seed-set <name>]` line into `seedReport.errors` — which, on the non-throwing path, is NEVER
forwarded into `obs.consoleErrors`. So today a partial `set-threw` is invisible to every detector.

NEXT: baseline tier run (done, exit 0), then the question-B measurement.

## 2026-09-20T12:35Z — BASELINE tier run

`bun test compiler/tests/e2e-render-map/` -> **150 pass / 0 fail**, 1350 expect(), 2 files, 38.38s.
GREEN->RED regressions: **exactly the 2 the brief named** (`benchmarks/todomvc/app.scrml#empty`
D1-MOUNT-THROW, `examples/09-error-handling.scrml#empty` D0-COMPILE-ERROR). Also 1 ORPHAN baseline
cell and 3 NEW cells, all pre-existing. Baseline reconciles with the brief exactly.

## 2026-09-20T12:40Z — QUESTION B MEASURED. Answer: LOUD, and NO VETO.

Ran `runDetectors` directly on the partial-delivery shape (`items` set-threw + `title` written,
empty body, `gainedContent:false`), four ways:

| # | configuration          | state                      | smells                                 |
|---|------------------------|----------------------------|----------------------------------------|
| 1 | TODAY: silent, no veto | `renders-empty-with-data`  | `S-EMPTY-WITH-DATA`                    |
| 2 | REQ-A: loud, no veto   | `compiles-but-throws`      | `D2-CONSOLE-ERROR`,`S-EMPTY-WITH-DATA` |
| 3 | REQ-A + veto           | `compiles-but-throws`      | `D2-CONSOLE-ERROR`                     |
| 4 | veto ALONE, silent     | **`renders-empty`** (GREEN)| (none)                                 |

Row 1 reproduces the gap. Three findings decide question B:

1. **The veto is a no-op on the VERDICT.** Rows 2 and 3 have the IDENTICAL state, because
   `runDetectors`'s **state-resolution** block short-circuits: its `consoleErrors.length > 0` arm
   `return`s `compiles-but-throws` BEFORE the `smells.includes("S-EMPTY-WITH-DATA")` arm below it
   is reached. Once requirement A exists, `renders-empty-with-data` is already displaced, so vetoing
   buys nothing the loudness has not already bought.
   ⛑ **CORRECTED (PA, post-landing) — my original wording here said "D2's console-error branch
   RETURNS — it is terminal", and that is WRONG.** The D2 SMELL branch does NOT return: it pushes
   `D2-CONSOLE-ERROR` and deliberately falls through ("Continue scanning for smells too ... but the
   state is already the throws tier"). The table and the conclusion are unaffected — rows 2 and 3
   really are the same state — but the POINTER was wrong, and anyone re-deriving the argument from
   it would land on a comment saying the opposite and doubt the whole table. Verified in source:
   the D2 smell branch and the returning state-resolution arm are two different blocks, which is
   also precisely why the veto is a no-op on the VERDICT while still being lossy on the RECORD —
   the smell is GATHERED in one place and RESOLVED in another.
2. **The veto has a real COST.** Its only observable effect (row 2 vs row 3) is deleting
   `S-EMPTY-WITH-DATA` / `detail.emptyWithData` — which is exactly the corroborating evidence you
   would want if the `set-threw` turns out to be a broken emitted accessor (a COMPILER defect).
   That is the hiding the brief worried about, and it is now measured rather than supposed.
3. **The veto ALONE is FAIL-OPEN** (row 4): it scores the cell **GREEN** (`renders-empty`). The
   loudness is the load-bearing half. Since the two are separable in code, shipping the veto would
   plant a live hazard for whoever next touches the loudness — the same shape that has already
   shipped wrong twice here.

**So the PA's lean is CONFIRMED, but promoted from "the reversible direction" to "a measured no-op
with a measured cost, whose standalone form is fail-open."** Not implementing a veto.

## 2026-09-20T12:50Z — REQUIREMENT A implemented + the bite, both ways

Predicate EXTRACTED as the exported `seedThrewNotice(seedReport)` in `render-harness.js`. Reason:
rounds 1 and 2 were pinned only by a MIRROR of the condition re-typed into `detector-validation.js`
plus a `toContain` over source text. A mirror asserts nothing about the code that runs — the §8
hollow-gate shape, and precisely how both wrong rounds shipped green. The F4 loudness cases now
call the real function, so every one of them is a bite on production.

THE BITE, isolated to the condition (same file, same structure, same export, same call site — only
the gate differs; the pre-fix variant was built by FILE COPY, never `git stash`):
- **pre-fix (round-2 condition reinstated): 139 pass / 7 fail**
- **post-fix: 146 pass / 0 fail**
The 7 are all behavioural: 3 F4 loudness cases, plus 4 in the new S424 block.
Against the LITERAL `origin/main` harness the file does not even load (missing export) — 1 error,
0 tests run. Recorded, but the isolated round-2 variant is the honest bite because it changes ONE
variable.

ONE UNPLANNED FIX, and the existing gate caught me: the "condition is neither broken form"
source-text test read the WHOLE FILE, so it fired on the harness's own new COMMENT documenting the
two broken forms (written so a fourth round would not re-derive them). A gate that forbids NAMING a
defect in a comment is not measuring code. It now strips comments before asserting.

## 2026-09-20T12:58Z — TIER RUN AFTER. Cell-state delta: ZERO.

`bun test compiler/tests/e2e-render-map/` -> **162 pass / 0 fail**, 1376 expect(), 38.09s.
- +12 tests, +26 expects = exactly the new tests. No pre-existing test changed outcome.
- `diff` of every `*.scrml#*` cell-state line, before vs after: **IDENTICAL, exit 0.**
- GREEN->RED still the SAME 2 pre-existing cells. ORPHAN still 1. NEW still 3.

Predicted and confirmed: no corpus cell moves, because **no corpus fixture produces `set-threw`
today** (SEED_OBSERVABILITY records `written` / `derived-cell` / `no-such-cell` / `written`). The
fix is latent-by-design until the fixture-rewrite arc makes the fixtures multi-key, which is what
the gap says takes it live.

## 2026-09-20T13:02Z — DEFERRED (found, verified by reading, NOT fixed — out of item 3's scope)

1. **`needs-server` can MASK the F4 notice.** In `runDetectors`, the needs-server carve-out fires on
   `consoleErrors.some(isServerAbsenceMessage)` — ANY, not EVERY — and its `hasHardSmell` guard
   lists only S-OBJECT-IN-DOM / S-RAW-INTERP / S-NULLISH-TEXT, NOT S-EMPTY-WITH-DATA. Measured: a
   server-dependent app with a server-absence console error scores **`needs-server` (GREEN)** both
   with and without our loud `[seed-bridge]` line. So requirement A's loudness is not universally
   red. **This is PRE-EXISTING and unchanged by this work** (the with/without states are identical),
   and it masks D6 today independently of the seed bridge — but it is a genuine fourth latent path
   in the same gap's family and should be filed.
2. **A compiler defect that `console.error`s instead of THROWING during seeding is invisible.**
   `mountAndObserve` installs its `console.error` shim at `:646` and restores it at `:683` in its
   own `finally`; `applySeed` runs AFTER that returns. So console errors raised by the app's
   reactive update DURING the seed write are not captured by anything. Directly relevant to the
   brief's "a `set-threw` may itself be a compiler defect" — the throwing case is now covered, the
   console-erroring case is not.

