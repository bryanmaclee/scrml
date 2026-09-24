# progress — s430-conformance-carried

- 2026-09-23T21:38:12-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af80dde4ab3161256 (base 15e60e4b = origin/main). bun install + pretest OK.

- 2026-09-23 ~21:50 — **unit 1: status=carried in the gap tooling** (commit c002a0bb — NOTE its subject line
  wrongly reads "WIP ... start at ..." : the message file was not rewritten because a compound shell command
  was refused by the isolation guard; the content is the state.ts unit, see `git show --stat c002a0bb`).
  - scripts/state.ts: `GAP_STATUS_CARRIED` + exported `classifyGapStatus`; the unknown-status guard moved
    from gapCounts() into gapCountsFromTokens() (reachable from tests + the conformance runner);
    carried counted per severity (HIGH/MED/LOW/NOMINAL) in its own `carried` object, never in high/med/low;
    §0 gap-counts table now 3 columns; digest board adds a Carried line + named carried HIGHs; PRINT adds a
    carried inventory; heading/marker drift classifies carried as its own class.
  - docs/known-gaps.md: §0 static header -> 3 columns; per-gap status legend gains `carried`; the stale
    Count-basis legend now defers to the classifier sets; `--write` regenerated gap-counts (0 carried).
  - scripts/flograph.ts: `--report` prints a carried line; `classDef carried` for the mermaid render.
  - tests: state-gap-integrity.test.js §5 (5 tests). Mutation (GAP_STATUS_CARRIED emptied) -> 3 red; restored -> green.

- 2026-09-23 ~22:20 — **unit 2: xfail in the conformance suite**
  - conformance/adapters/impl1-ts.ts: `export const IMPL_ID = "impl1-ts"`.
  - conformance/run.ts: `xfail` top-level field; `KNOWN_IMPL_IDS`; `gapStatusIndexFromText` /
    `loadGapStatusIndex` (via state.ts parseGapMarkers + gapCountsFromTokens — one marker parser);
    `resolveXfail`, `classifyOutcome` (pass/fail/xfail/xpass), `unpinnedCarriedGaps` (reverse pairing),
    `evaluateCase` (both halves + outcome; a throwing runtime half is recorded, not escaped), `failureSummary`,
    `xfailRatioLine`; runAll returns xfailed/xpassed/unpinnedCarried; main() prints XFAIL/XPASS/UNPINNED +
    the ratio, exit 1 on fail / XPASS / unpinned.
  - compiler/tests/conformance/corpus-bridge.test.js (gated) + conformance/conformance-corpus.test.js:
    xfail-marked cases asserted by outcome; new test "every status=carried gap is pinned"; afterAll ratio.
  - compiler/tests/unit/conformance-xfail.test.js: 13 tests over synthetic case dirs + synthetic ledger,
    real impl#1 compile.
  - conformance/README.md: schema example + an xfail section.

## BITE PROOF (live corpus, live ledger, through the GATED bridge `compiler/tests/conformance/corpus-bridge.test.js`)
Target case: conformance/cases/api/api-clean-pos (a passing case). Probe gap id: g-s430-bite-probe.
1. xfail `{impl1-ts: g-s430-bite-probe}` on the passing case, NO such marker in the ledger
   -> RED: `xfail['impl1-ts'] names gap 'g-s430-bite-probe', which has no @gap marker in docs/known-gaps.md`.
2a. restore the case; append `<!-- @gap id=g-s430-bite-probe sev=LOW status=carried -->` to the ledger
   -> RED: "every status=carried gap ... is pinned" fails listing `g-s430-bite-probe`.
   (state.ts --check simultaneously reports gap-counts STALE; the counter reads carried {low:1}, open unchanged 126/284/105.)
2b. re-add the xfail on the (still passing) case
   -> RED: outcome xpass, "XPASS — every assertion holds on impl1-ts, so gap 'g-s430-bite-probe' is FIXED here";
      ratio line `conformance (impl1-ts): 0 xfail of 906 cases, 1 XPASS (failures)`.
      `bun conformance/run.ts` exit=1 with the XPASS line.
2c. make the case deliberately wrong (expect.codes = ["E-S430-BITE-NEVER-FIRES"]) keeping the xfail
   -> GREEN: `api/api-clean-pos: XFAIL (g-s430-bite-probe): missing ["E-S430-BITE-NEVER-FIRES"]`,
      `conformance (impl1-ts): 1 xfail of 906 cases`; `bun conformance/run.ts` exit=0, prints
      `XFAIL  api/api-clean-pos  [xfail impl1-ts: g-s430-bite-probe]` + `(expected) missing [...]`.
3. restore both files from backup -> bridge 908 pass / 0 fail, `0 xfail of 906 cases`; state.ts --check gap-counts PASS.
   Top-level wrapper `bun test ./conformance/conformance-corpus.test.js` also 908/0.

## Verification
- pre-commit gate on 45a1de24 (unit + integration + conformance): 30603 pass / 84 skip / 0 fail; post-commit hook exit 0.
- `bun run test` (full compiler/tests incl. browser): HEAD 32499 pass / 179 skip / 59 fail; BASE 15e60e4b (my
  files reverted in place) 32480 pass / 179 skip / 59 fail. The (fail) sets are IDENTICAL (comm both ways empty):
  browser/happy-dom runtime, dev-server hot-reload, transition-001, self-host tokenizer parity — pre-existing,
  not introduced here. +19 pass = the new tests.

## Round 2 (PA: NOTE 3 — the mark must pin HOW the case fails)
- Shape: `"xfail": { "impl1-ts": { "gap": "<carried-gap-id>", "fails": { "codes"?: [...], "runtime"?: "sha256:<16hex>" } } }`.
  codes = exact sorted set of failed codes-half assertions (`missing:`/`forbidden:`/`prefix:`/`severity:`/`codeCounts:`);
  runtime = sha256 (16 hex) of the sorted runtime-half failure lines (the state/DOM/anchored diff text).
  Bare-string form, missing `fails`, empty `fails`, unknown keys, bad digest -> all RED ("xfail needs a failure signature").
- A marked case failing with a DIFFERENT signature -> FAIL (diff printed both directions: NEW failure / recorded failure gone / runtime digest moved).
- Helper: `bun conformance/run.ts --xfail-signature <case-id|relDir>` -> paste-ready JSON on stdout, the pinned failures on stderr; exit 1 if the case passes.
- Unit tests: conformance-xfail.test.js now 21 (incl. a REAL runtime-half case: capture, same -> XFAIL, different wrong value -> FAIL, passes -> XPASS).

### BITE PROOF round 2 (live corpus + live ledger, gated bridge; probe gap g-s430-bite-probe status=carried appended to the ledger)
Codes half — api/api-clean-pos with expect.codes = ["E-S430-BITE-NEVER-FIRES"]:
- S0 bare-string mark -> RED: `xfail['impl1-ts'] is a bare gap id — xfail needs a failure signature ... Capture it with bun conformance/run.ts --xfail-signature api-clean-pos`.
- S1 `--xfail-signature api-clean-pos` exit 0 -> `{"xfail":{"impl1-ts":{"gap":"<carried-gap-id>","fails":{"codes":["missing:E-S430-BITE-NEVER-FIRES"]}}}}` (stderr: `missing ["E-S430-BITE-NEVER-FIRES"]`).
- S2 pasted (gap filled) -> GREEN: `api/api-clean-pos: XFAIL (g-s430-bite-probe): missing [...]`, `1 xfail of 906 cases`; run.ts exit 0.
- S3 perturbed to fail differently (codes = ["E-S430-BITE-OTHER-REGRESSION"]) -> RED outcome fail:
  `codes: NEW failure not in the recorded signature: missing:E-S430-BITE-OTHER-REGRESSION | codes: recorded failure no longer occurs: missing:E-S430-BITE-NEVER-FIRES`; run.ts exit 1, `0 xfail of 906`.
- S3b recorded failure PLUS a new one -> RED: `NEW failure not in the recorded signature: missing:E-S430-BITE-OTHER-REGRESSION`.
- S4 passes (codes = []) -> RED XPASS, `0 xfail of 906 cases, 1 XPASS (failures)`.
Runtime half — forms/checkbox-check with expect.state = {agreed:false} (true is correct):
- R1 capture -> `{"runtime":"sha256:a42af8cb0a6faaae"}` (stderr `runtime state: cell 'agreed' expected false, got true`).
- R2 pasted -> GREEN XFAIL; a second capture in a fresh process reproduced sha256:a42af8cb0a6faaae (stable).
- R3 same failure + a new domAnchored failure -> RED: `runtime: recorded sha256:a42af8cb0a6faaae, observed sha256:f8bd9aa226eb3dbb`.
- R4 same cell, different wrong value (agreed:"maybe") -> RED: observed sha256:ebeee5c56515fad4.
- R5 runtime passes -> RED XPASS.
Restore all three files from backup -> bridge + unit 942 pass / 0 fail, top-level wrapper 908/0, `0 xfail of 906`, state.ts gap-counts PASS.

- Commit subject of c002a0bb is still wrong ("WIP ... start"); branch is UNPUSHED, left as is per PA (squash-merge fixes it).

## Round 3 (adversarial review of a5b36238 — fix round)
- Merged origin/main (7b3fe980). Conflict in conformance/adapters/impl1-ts.ts: kept BOTH `IMPL_ID` and main's
  `compileOverlay`/`setCompileOverlay`. §0 gap-counts regenerated over the merged ledger (HIGH 136 / MED 293 / LOW 106).
- MED 1 (unstable tool signature): the runtime digest now hashes structured KEYS, not display text.
  tool run -> `stdout:{expected, actual, exitCode, error head}` (never raw stderr); thrown half ->
  `threw:<name>: <normalised message>`; every other line -> normalizeVolatile(line) (tmp paths -> <TMP>,
  Bun vX.Y.Z -> Bun <VERSION>, <TMP>:line:col -> <TMP>:<L>, `NN |` gutter -> `N |`).
  Reviewer reproducer (`const n = args[7].length`, wrong stdout): sha256:78547c61c91f8237 on two runs from two
  different case paths (unit test); live: print/tool-println-clean-stdout perturbed the same way captured
  sha256:7d9dcc52ae05fa3f twice (once by id, once by dir).
- LOW 2: codes signature includes the emitted E-* multiset `emitted:<code>=<n>` (only for a failing case;
  W-/I- not pinned). Unit test: clean-source signature {missing:E-NEVER}; same contract on a source that also
  emits E-API-BASE-MISSING -> FAIL `NEW failure ... emitted:E-API-BASE-MISSING=1`; multiplicity test (=1 vs =2).
- LOW 3: flograph consumes state.ts parseGapMarkers + classifyGapStatus (GAP_RE deleted). `--report` round-trip
  now HIGH open=136 · MED open=293 · LOW open=106 == state.ts (was 9/71/40). S416 freeze does not cover it: the
  freeze is about widening `[^>]` in NODE_RE / state.ts:248 / boot / corpus-zero; GAP_RE was not one of the
  four sites, and marker-parser-pins stays green. Unparseable markers outside docs/known-gaps.md are warned +
  skipped (--with-support may quote templates); in the ledger they throw, as state.ts does.
  `flograph --check` FAILs with 2 duplicate ids BOTH before and after (pre-existing:
  g-db-migrate-check-constraint-oneof-pattern, g-gap-counts-silently-drops-unrecognised-status).
  New test flograph-gap-parser.test.js: red against the old flograph, green now.
- MED 4 (P5 x P7): scripts/hybrid.ts runHybridConformance routes through evaluateCase. XFAIL ok (listed),
  different failure red, XPASS reported + counted but NOT red, non-carried/unsigned mark red; a StageSeamError
  from the runtime half is re-thrown by evaluateCase so the hybrid still labels it SEAM VIOLATION.
  New test hybrid-xfail.test.js (identity TAB, synthetic carried case): red against the old hybrid.ts, green now.
- Cosmetic: bridge/wrapper ratio denominator = cases actually run (honours -t): `2 xfail of 2 cases`.
- failureSummary collapses multi-line runtime failures onto one line (a stdout mismatch now says what mismatched).

### BITE round 3 (live corpus, gated bridge + hybrid CLI; probe gap g-s430-bite-probe carried)
- B1 api-clean-pos (codes [E-S430-BITE-NEVER-FIRES]) + tool-println-clean-stdout (crashing source) both marked with
  captured signatures -> GREEN twice in a row: `2 xfail of 2 cases`; run.ts exit 0 `2 xfail of 910 cases`;
  hybrid --swap TAB=identity exit 0 `1 xfail of 1` for each.
- B2 both perturbed (api codes -> E-S430-BITE-OTHER-REGRESSION; tool expected stdout changed) -> RED, both
  `FAILS DIFFERENTLY` (codes diff both directions; runtime recorded sha256:7d9dcc52ae05fa3f observed
  sha256:90bfea0fd4f8c121); hybrid exit 1 `1 FAILED`.
- B3 both now pass -> bridge RED `0 xfail of 2 cases, 2 XPASS (failures)`; hybrid exit 0,
  `XPASS api/api-clean-pos … (reported, not red)`.
- Restored -> touched suites 994 pass / 0 fail, `0 xfail of 910 cases`; state.ts --check both sections PASS.
