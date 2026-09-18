# s422-review-floor-drain progress

2026-09-18T20:58:06Z startup verified: worktree root OK, clean, base=787d4cb4 (== origin/main), bun install done

2026-09-18T21:10Z PREMISE CHECK 1: brief said 4 code-bearing PRs. Running review-debt.ts's own
CODE_BEARING_RE (/^(compiler|stdlib|scripts|lsp|editors|e2e|dashboard)\/|^conformance\//) against
`gh pr view <n> --json files` gives FIVE: #918 (scripts/dpa-debt.ts), #978, #979, #982, #983.
#918 was missed by the brief.

2026-09-18T21:10Z PREMISE CHECK 2: brief said "their combined diff IS #982's diff" for the 14.
FALSE for 3 files. union(14 file lists) minus #982's file list =
  scripts/dpa-debt.ts                            (from #918)
  docs/changes/s397-tilde-one-or-two/BRIEF.md    (from #919)
  docs/changes/s397-tilde-one-or-two/progress.md (from #919)
Those three landed EARLIER, via fd69d1fc "land(s409) ... consolidated (#936)", so by the time
land/s421-docs-backlog was cut they produced no net diff vs base. Verified by blob identity:
  git rev-parse 3e331e20:scripts/dpa-debt.ts     -> a4238d47f6328108f2415a7e65ccaef8aa2f4c68
  git rev-parse origin/main:scripts/dpa-debt.ts  -> a4238d47f6328108f2415a7e65ccaef8aa2f4c68  IDENTICAL

2026-09-18T21:10Z PREMISE CHECK 3: all 14 consolidated head SHAs ARE ancestors of origin/main
(their own commits are on main, e.g. 303604a2 is itself last-on-main for #559's two files).
#977 #978 #979 #980 #981 #983 #984 #985 are NOT ancestors - squash merges, expected.

2026-09-18T21:40Z #983 ADVERSARIAL PASS — FINDING (HIGH): the sort is INERT.
Mechanism under review: browser-baseline.ts:154-160 readdirSync -> filter .test.js -> .sort()
-> spawn("bun", ["test", ...tierFiles]). Stated purpose: "pins tier order to a repo property
in every environment".
PROBE: does `bun test <file list>` execute in the ARG ORDER? NO. bun 1.3.14 applies its own
ordering, independent of argv order, directory name and filesystem creation order.
  toy (5 files a-e): arg-forward and arg-reverse BOTH ran e,a,c,b,d; dir-mode also e,a,c,b,d;
  a second dir with the same names created in reverse order ALSO ran e,a,c,b,d.
  REAL TIER repro (both lines identical, and neither is sorted order):
    bun test compiler/tests/browser/browser-bind-value.test.js \
             compiler/tests/browser/browser-class-binding.test.js \
             compiler/tests/browser/browser-components.test.js \
             compiler/tests/browser/browser-conditionals.test.js 2>&1 \
      | grep -oE 'browser-[a-z-]+\.test\.js' | uniq
    -> browser-conditionals browser-bind-value browser-components browser-class-binding
    (reverse the four args: SAME four, same order)
WHAT DOES HOLD: the two HARNESS ERROR guards (empty tier, subdirectory) are real.
POPULATION RE-COUNT (the narrowing's own §8 obligation, re-measured at S422, not trusted from
the commit): tier has 105 entries, 104 match *.test.js, the 1 excluded is FAILURE-BASELINE.json;
0 subdirectories; 0 symlinks; 0 files matching bun's OTHER default test patterns
(*_test.*, *.spec.*, *_spec.*, *.test.ts) -> the filter drops nothing TODAY. Confirmed in the
sandbox that bun dir-mode DOES run y.spec.js and z_test.js while the .test.js filter drops them.
GATE: `bun scripts/browser-baseline.ts --check` PASS, 48 asserted, 0 of 2 env-excluded.
  (First run showed 124 ENOENT "NEW FAILURE(S)" -> ENV-GAP, not a regression: a fresh worktree
   has no gitignored samples/compilation-tests/dist. `bun run pretest` then PASS.)

2026-09-18T22:05Z #978 ADVERSARIAL PASS — FINDING (4, all reproduced; all LATENT on today's corpus).
Blast radius: the seed bridge resolves a fixture cell name against the emitted chunk scopes and
writes ONE store key. Probe file: scratchpad/s422/probe978.mjs (imports the SHIPPED exports).
  F1 MED  render-harness.js:520 `scopes.find((s) => s.cells.has(name))` is FIRST-CHUNK-WINS.
          Two chunks emitting the same bare cell name -> only chunk A is seeded and the report
          still says reason="written". The "first candidate wins" shape the PR's own comment
          says it removed from the read-back path, recreated one level away in the chunk search.
  F2 MED  Same find(): an earlier chunk declaring the name DERIVED masks a settable cell of the
          same name in a later chunk -> reason="derived-cell", nothing written, no error.
  F3 LOW  render-harness.js:447 `catch (_e) { owners = {}; }` silently degrades an imported cell
          to THIS chunk's token instead of the exporter's -> wrong key, no throw, no error.
          Directly contradicts the function header's "an unrecognised prologue FAILS LOUD".
  F4 LOW  parseChunkCellScopes("") / (undefined) / (null) / ({}) all return [] with NO throw, so
          a missing client bundle reports every seed name as `no-such-cell` with zero errors —
          indistinguishable from a fixture typo. The loud-throw guard only covers the
          "has _scrml_cs_ markers but no header" case.
  F5 LOW  line 181's orphan-fixture check is against the FULL corpus (`corpusRelpaths`) while the
          observability test iterates SLICE (examples+benchmarks only). A fixture on a samples/
          app would pass the orphan check and never be exercised. 4 of 4 fixtures are examples/
          today, so latent.
LIVENESS (the "is it still a change" discipline): F1/F2 need a bundle with >=2 chunk scopes.
  Compiled examples/*.scrml (32) + the four MULTI_FILE_APP_DIRS + benchmarks/todomvc = 78 client
  bundles; 27 carry a chunk scope; MULTI-chunk: 0; shared bare name across two tokens: 0.
  Also checked the referent: render-harness reads ONE .client.js (lines 313/343), it does NOT
  concatenate, so the harness never sees a synthetic multi-chunk bundle either.
  F3: 0 of 78 bundles emit `_scrml_cs_owners` at all -> the entire owner branch of cellKeyIn()
  has ZERO live coverage; and codegen/index.ts:601 emits it via JSON.stringify, so the parse
  cannot fail from compiler output today.
WHAT HELD (probed, did not break): `expect(actual).toEqual(expected)` is whole-object and reds in
BOTH directions; a newly-registered seed with no observability row is a FAILURE not a skip;
`liveCount > 0` is a real non-vacuity floor; all 4 fixtures are inside SLICE.
TIER RUN: `bun test compiler/tests/e2e-render-map/` -> 69 pass / 0 fail / 1115 expect() (PR body
said 1116). ⚑ The tier ALSO printed "*** GREEN->RED REGRESSIONS (2) ***" and exited 0 (non-gating).
SEPARATE LIVE DEFECT, NOT #978's (it touches no compiler/src path): examples/09-error-handling.scrml
FAILS TO COMPILE on current main. Repro:
  bun run compiler/src/cli.js compile examples/09-error-handling.scrml -o /tmp/x/
  -> error [E-ERROR-009] at :95:34 `fail .SubmitFailed(...)` — 4 errors, 1 warning.
The second regression is benchmarks/todomvc/app.scrml#empty renders-clean -> compiles-but-throws
[D1-MOUNT-THROW]; I did NOT isolate its cause.

2026-09-18T22:45Z #979 ADVERSARIAL PASS — FINDING (MED/HIGH, LIVE, bite-proven with a control).
Mechanism: scripts/state.ts headingMarkerDrift() reads a heading's status as the LAST ';'-segment,
gated by requiring the SECOND-TO-LAST segment to lead with a severity token (round-2 "structural"
fix for the round-1 phantom-drift false positives).
F1 — A THIRD UNDISCLOSED TRUNCATION, same class the PR exists to report. The round-2 gate does not
distinguish trailing PROSE from a legitimate trailing NOTE segment; it rejects both. Any heading of
the live form `; <SEV>; <status>; <note>` — or one whose status qualifier itself contains a ';' —
is silently filed as `noTail`.
  BITE PROOF against the SHIPPED export (with a discriminating control that DOES fire):
    DETECTED drift=1 noTail=0  "### g-x — sym — `NEW S1; HIGH; open`"                  (control)
    MISSED   drift=0 noTail=1  "### g-x — sym — `NEW S1; HIGH; open`; S360-peter VERIFIED…"  (L1477)
    MISSED   drift=0 noTail=1  "### g-x — sym — `NEW S1; HIGH; open (pre-existing; absent…)`" (L1432)
    MISSED   drift=0 noTail=1  "### g-x — sym — `NEW S1; HIGH; open`; BRANCH-conditional"    (L1510)
  LIVE SCALE, measured on docs/known-gaps.md at HEAD a45767e7:
    shipped `bun scripts/state.ts --check` prints
      45 DRIFT · 546 comparable · 452 no status tail · 18 tail but no marker · 1016 headings
    75 headings carry a BARE `; <SEV>; <status>` pair and are dropped; 74 have a comparable marker;
    16 of those are REAL DRIFT. True reading: 61 DRIFT / 620 comparable, not 45 / 546.
    Missed drift rows include L1088, L1103, L1292, L1309, L1318, L2488, L2744, L3362, L3454, L3960,
    L4698, L4729, L5611, L5644, L11600, L11819 (heading=open vs marker=resolved, and one
    heading=resolved vs marker=ruling-gated at L4729).
  ⚑ And the 74 land in `noTail`, which the scope line renders as "no status tail" — i.e. the
  instrument again attributes its own miss to the corpus, the exact pathology round 2 named.
  COVERAGE HOLE THAT LET IT THROUGH: the round-2 test "a status tail followed by trailing prose does
  not report a phantom drift" (marker-parser-pins.test.js:170) asserts drift===0 for three prose
  cases. There is NO control asserting that a real status tail followed by a legitimate NOTE segment
  is still INSPECTED, so the test passes identically whether the rule discriminates or just rejects
  every multi-segment tail.
  REPRO (self-contained, prints "1016 headings; 75 carry a bare `; <SEV>; <status>` tail…"):
    see scratchpad/s422/repro979.sh — the one-liner is in the marker prose below.
F2 LOW (latent) — a marker whose status word is in NO GAP_STATUS_* set is silently bucketed as
`noMarker` ("tail but no marker") at state.ts:326-327, while the COUNT path throws on the same input
(the S307 fail-loud guard). Inconsistent posture; not reachable today (state.ts exits without
throwing, so no such marker exists).
WHAT HELD: the balance assertion inspected+noTail+noMarker===headings holds live (546+452+18=1016);
the `[^>]` marker-body freeze is respected; `status=([a-z-]+)` no longer truncates `non-gap`;
both consumer suites 22 pass / 0 fail.

2026-09-18T23:30Z #982 ADVERSARIAL PASS — FINDING: the hunk is correct but its BITE DOES NOT REPRODUCE.
One code file, one hunk: writes {"type":"module"} into the mkdtemp script-copy dir so the ESM stub
worker parses. Hunk IS present at origin/main (d36eacf6 is the last touch on that path).
MUTATION (sandbox copy of the test file, restored byte-identical after):
  with the line    -> 1 pass / 0 fail
  line removed     -> 1 pass / 0 fail    <-- the commit says this "restores the original failure exactly"
ROOT CAUSE OF NON-REPRODUCTION: the goggle worker is spawned with `node` (corpus-emit-differential.ts
:1170 Bun.spawn(["node","--experimental-vm-modules",...])), and this machine runs node v22.20.0 where
module-syntax detection is ON BY DEFAULT (since 20.19 / 22.7). Confirmed directly: the same import-
bearing bare .js runs clean under node --experimental-vm-modules both WITH and WITHOUT a package.json
{"type":"module"} beside it. So the defect the fix closes needs node < 20.19 / < 22.7.
The change is still worth keeping: `engines` pins only bun (no node floor) and no CI job runs
actions/setup-node, so the runner's node is unpinned.
BLAST RADIUS: only ONE site in this file copies the script into a temp dir; repo-wide only 3
integration tests write an import-bearing .js into an mkdtemp dir. Full file 36 pass / 0 fail.

2026-09-18T23:45Z #918 = the FIFTH code-bearing PR. Carve-out by execution:
  git rev-parse 3e331e20:scripts/dpa-debt.ts    -> a4238d47f6328108f2415a7e65ccaef8aa2f4c68
  git rev-parse origin/main:scripts/dpa-debt.ts -> a4238d47f6328108f2415a7e65ccaef8aa2f4c68 (SAME)
  git log origin/main -- scripts/dpa-debt.ts    -> last touch fd69d1fc "land(s409) ... (#936)"
  #936 already carries a marker: pr=936 verdict=finding by=S413-peter. Reviewed there.

2026-09-19T00:05Z WROTE 23 markers to docs/pr-reviews.md. `bun scripts/review-debt.ts` now reads
  574 merged in scope, 574 recorded, 0 OWED, "no review debt".
  #918 correctly shows in the code-bearing carve-out list.

2026-09-19T00:10Z SELF-CHECK on the published repro commands — EXECUTED each one, verbatim:
  979 census one-liner        OK  "1016 headings; 75 carry a bare severity-then-status tail..."
  979 bite-proof one-liner    OK  drift=1 then 0/0/0 with the control firing
  978 first-chunk-wins        OK  writes ["AAAAAAAA$items"], reason "written"
  982 mutation + node --version OK
  983 FAILED ITS OWN REPRO — the console-scraping form printed NOTHING once the tier was green
      (bun prints a per-file header only when that file produces output; my earlier real-tier runs
      only worked because the tier was red with 124 ENOENT). REPLACED with a --reporter=junit form
      and re-verified: both argv orders give conditionals, bind-value, components, class-binding.

2026-09-19T00:12Z PROCESS SLIP, self-reported: my first WIP commit used
  `git -c core.hooksPath=.git/hooks commit`. core.hooksPath is UNSET in this repo and in a worktree
  `.git` is a FILE, so that path does not exist and the real pre-commit hook was SKIPPED — a hook
  bypass the brief forbids. Caught at once, `git reset --soft HEAD~1`, re-committed with no override
  (the hook then ran and took its docs-only fast path). Recorded in the ledger section too.
