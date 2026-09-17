2026-09-17T01:17:55Z start at /c/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-ac51cb62e910cb69a; branch fix/s419-differential-verdict-coverage off d1bf550f
2026-09-17T01:21:51Z script: every error path -> exit 2 (loadManifest die + shape check, capture self-check aborts 1->2, top-level guard), gitRevision toplevel check, strict intFlag for --concurrency/--expect-total. Manual probes: missing=2 corrupt=2 selfcheck=2 crash(ENOTDIR root)=2 --concurrency abc=2, subdir compiler-root -> <unknown>. Existing suite still 9/0.
2026-09-17T01:24:49Z tests: 12 isolated per-term exit-1 cases + census + same-rev opt-in case + capture numeric-flag case (replaces --reverify-limit) + 6 invalid-run exit-2 cases + 4 revision-provenance cases; anchored DIFFERING regex; corrected comment. Suite 33 pass / 0 fail / 174 expects (6.7s).
2026-09-16 bite-proof run 1 (script md5 f8697e31): 24 mutations, each applied to a file copy, suite run, restored by copy, md5 verified identical after every one. NOTE: must run with Git usr/bin find on PATH; from bare PowerShell `find` is Windows find.exe and the fixture capture fails (the new guard reported that as exit 2 NOT A VALID RUN, not exit 1).
2026-09-16 run 1 NON-BITES: (a) canonicalDir win32 separator/case fold removed -> 33/0: realpathSync.native already canonicalises, fold was dead -> REMOVED from script (and the unproven MSYS /c/ prefix fold with it). (b) try/catch rethrow with process.on handlers kept -> 33/0: the two guard layers are mutually redundant on every tested route; removing BOTH bites (2 red). Kept both: process.on also covers rejections outside the awaited chain, which try/catch cannot reach; that route is not separately bite-proven.
2026-09-16 added case-variant compiler-root case (win32 upper-cased path) to pin the canonicalisation claim. Suite 34 pass / 0 fail / 176 expects.
2026-09-16 bite-proof run 2 (script md5 4df43bc8), all restored md5-identical:
  drop srcDelta.onlyA      -> RED: exit 1 on a source REMOVED in head ALONE (+ CENSUS)
  drop srcDelta.onlyB      -> RED: exit 1 on a source ADDED in head ALONE (+ CENSUS)
  drop newlyFailing        -> RED: exit 1 on a source NEWLY FAILING ALONE (+ CENSUS)
  drop newlyPassing        -> RED: exit 1 on a source NEWLY PASSING ALONE (+ CENSUS)
  drop diagChanged         -> RED: exit 1 on a diagnostic-CODE change ALONE (+ CENSUS)
  drop streamChanged       -> RED: exit 1 on a diagnostic-TEXT-only change ALONE (+ CENSUS)
  drop artifactAdded       -> RED: exit 1 on an artifact ADDED ALONE (+ CENSUS)
  drop artifactRemoved     -> RED: exit 1 on an artifact REMOVED ALONE (+ CENSUS)
  drop contentDiffs        -> RED: content ALONE, whole-fixture content case, same-rev opt-in case (+ CENSUS)
  drop checkDelta.onlyA    -> RED: syntax FIXED in head ALONE (+ CENSUS)
  drop checkDelta.onlyB    -> RED: syntax NEW in head ALONE (+ CENSUS)
  drop messageChanged      -> RED: syntax message CHANGED ALONE (+ CENSUS)
  whole sum -> contentDiffs.length (the PA's S419 probe; was 9/0) -> 22 pass / 12 fail: all 11 other per-term cases + CENSUS
  add 13th term loadContextChanged -> RED: CENSUS only
  verdict=0 when same-rev opt-in effective -> RED: SAME revision + --allow-same-revision + real difference
  loadManifest unwrapped (guard kept) -> RED: MISSING, CORRUPT, not-a-manifest (message assertions)
  guard removed (try/catch AND process.on) -> RED: unexpected throw in diff (--json EISDIR), unexpected throw in capture (root is a file)
  try/catch rethrow, process.on kept -> 34/0 (redundant layers, see above)
  PRE-FIX gap 1 (both) -> RED: all 5 invalid-run diff/capture-throw cases
  capture self-check abort returns 1 -> RED: capture SELF-CHECK abort exits 2
  intFlag -> Number() coercion -> RED: numeric flag rejection case
  PRE-FIX gap 2 gitRevision -> RED: non-toplevel records <unknown>, guard REFUSES inherited-revision manifest
  canonicalDir plain resolve -> RED: junction case, case-variant case
2026-09-17T01:33:36Z GATE: suite 34 pass / 0 fail / 176 expects; no other test imports or spawns the script (grep); facts.ts --write no change, --check PASS; state.ts --check PASS. DIFFERING regex verified: matches '4 of 4 compared' (with or without CR), rejects '4 of 40' and '14 of 4'. bun install: puppeteer postinstall exited 1 (browser download), unrelated to this suite.
2026-09-17T01:47:17Z FIX ROUND (review of 1e10b073): (1) --json report now written BEFORE the verdict banner; everything from banner to return is console output of computed values. Guard test now reads STDOUT alone (no VERDICT: on exit 2) with a clean-run control that stdout does carry VERDICT. (2) new cases for the artifact-stage abort (stub emits two scrml-runtime.*.js -> duplicate key) and the syntax-stage abort (byte-identical script copy beside a worker that answers nothing; unreachable via the shipped worker, which answers every job id). (3) header documents strict numeric flags + the --concurrency 0 break; +2 / ' 3' / 1e1 refusal intended and now pinned. (4) sources[] element shape check kept and pinned by a malformed-element case. Suite 36 pass / 0 fail / 202 expects. Script md5 69504bd2.
2026-09-17T01:58Z FIX ROUND bite-proof (script md5 69504bd2, restored md5-identical after every mutation):
  JSON write moved back after banner (faithful block move) -> RED: unexpected throw in diff (--json EISDIR). Only the new STDOUT assertion can fail there: pre-fix the exit was already 2 and combined output already carried NOT A VALID RUN. (A first, cruder mutation writing "{}" also reddened the 12 per-term cases via the report shape; discarded as unfaithful.)
  artifact-stage abort return 1 -> RED: capture ARTIFACT-stage abort (duplicate key) exits 2
  syntax-stage abort return 1 -> RED: capture SYNTAX-stage abort (goggle worker no result) exits 2
  sources[] element shape check removed -> RED: valid JSON that is not a manifest (malformed-element message)
  numeric regex accepts sign/padding -> RED: numeric flag case (+2, ' 3')
  --concurrency floor 0 -> RED: numeric flag case ('0')
  full earlier table re-run on the new script: unchanged (every mutation red as before; try/catch-only rethrow still 36/0, redundant with process.on by design).
2026-09-17T01:59Z GATE: suite 36 pass / 0 fail; facts --check PASS; state --check PASS. Tag s419-review-differential untouched at 1e10b073.
