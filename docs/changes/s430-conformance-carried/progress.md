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
