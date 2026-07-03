# ss58 sPA re-integration → PA

**List:** `spa-lists/ss58-conformance-error-model-19.md` (conformance authoring — value-level error model §19, freeze-gate flagship pillar #3)
**Branch:** `spa/ss58` · **tip:** `f175ab05` · **base:** `origin/main` @ `1c7526f6` (7 commits ahead, 0 behind)
**Date:** 2026-07-03 · **Built:** sPA-direct in sibling worktree `../scrml-spa-ss58` (pure-additive `conformance/cases/` data — tightest empirical golden-capture loop; full §19 SPEC pre-ingested, no per-item re-brief)

## Landed (per-item)
| item | cases | status | SHA |
|---|---|---|---|
| 1 — failable fn + `!{}` handler lift (RT) | error/failable-handler-lift{,-timeout,-success} | **landed** | `8d4a0dc6` |
| 2 — `?` propagate §19.5 (RT) | error/propagate-reaches-handler, propagate-success-unwrap | **landed** | `a48cdf61` |
| 3 — `fail` expr forms §19.3 (codes) | error/fail-outside-failable, fail-in-failable-neg | **partial** (see #1) | `502decd9` |
| 4 — `!{}` arm exhaustiveness (codes) | error/handler-non-exhaustive, handler-wildcard-escape, handler-exhaustive-neg | **landed** | `4f88cf93` |
| 5 — variant `renders` §19.2 (RT) | error-boundary/no-renders-falls-to-fallback, renders-multifield-payload | **landed** | `7002ab6e` |
| 6 — per-handler tx §19.10.5 (codes; RT gated) | error/implicit-tx-explicit-begin | **partial** (see #2) | `8d83625a` |
| close-out (progress SHA fill) | — | — | `f175ab05` (tip) |

**13 cases added: 69 baseline → 82, all green** (`bun conformance/run.ts`). **Parked:** the two sub-surfaces under escalations #1/#2. **Dropped:** none.

## What landed
The value-level error model (`fail`/`?`/`!{}` — scrml's try/catch replacement) moves from UNCOVERED (one codes-only `error-008` case) to conformance-covered:
- **`!{}` call-site handler errors-as-states lift** (§19.4.3): each error variant routed into a Phase state enum — payload lift (`.NotFound(mid)` → `Phase.Missing`), no-payload lift (`.Timeout` → bare-string `TimedOut`), success passthrough (→ `Phase.Loaded`).
- **`?` propagation** (§19.5): error crosses an intermediate `!` frame to the caller's handler; success unwraps.
- **`fail` placement** (§19.3.3): E-ERROR-001 outside a `!` fn; silent inside.
- **`!{}` exhaustiveness** (§19.7): non-exhaustive → **E-TYPE-080** (NOT the E-TYPE-020 the §19.7.1 prose names for logic-`match`; §34 catalog L17735 maps E-TYPE-080→§19.7, so impl is conformant); `_` wildcard + full-enumeration escapes.
- **variant `renders` priority** (§19.6.5 / §19.2.2): completes the priority table — no-renders variant → boundary `fallback` (#2, complementing the existing variant-renders #1 case); multi-field payload access in a renders clause.
- **implicit per-handler tx** (§8.9.2 / §19.10.5): W-BATCH-001 (explicit `?{BEGIN}` suppresses the implicit envelope).

## Verification
- **82/82** conformance cases green at tip `f175ab05` (re-run standalone after the doc-only close-out commit).
- Each per-item commit passed the **full pre-commit suite** (the hook commits only on green; the corpus-bridge runs the new cases on the gate).
- All (b) runtime halves execute the POST-run live DOM (state snapshots + domAnchored). Golden-capture: every state/DOM assertion matched impl#1's actual output first-run; all cross-checked against the cited §.

## ESCALATIONS (need a PA ruling — NOT decided by sPA; not enshrined)

### #1 — `fail`-variant validation UNIMPLEMENTED in impl#1 (§19.3.3 / §19.4.2 vs impl)
§19.3.3: "The variant specified in the `fail` statement SHALL be a valid variant of that error enum type … SHALL be a compile error (E-TYPE-001)." **impl#1 emits nothing** for `fail MyError.Nonexistent(…)` (undeclared variant), `fail Other.Whatever` inside `function f()! MyError` (foreign enum), `fail Plain("x")` (payload on a nullary variant), or `fail "string"` (non-enum). Verified LIVE (chain wired to `onclick`, no dead-code skip); grep confirms impl#1's E-TYPE-001 is wired ONLY for §14.3 lifecycle checks. **I did NOT author a "no-code" case** (would enshrine the gap against the spec — §19.9.1 precedent). Authored only the conformant E-ERROR-001 path. **Ruling:** conformance-bug (impl adds the checks → re-author the reject cases) vs spec-relaxation.

### #2 — E-BATCH-001 NOT source-reachable in impl#1 (parser limitation)
§8.9.2/§19.10.5 mandate E-BATCH-001 for a `!` handler with both an implicit envelope (2+ `?{}`) AND an explicit `transaction { }`. But impl#1's parser drops `?{}.run()` inside `transaction { }` in fn-body position → E-SCOPE-001 + "statement boundary not detected", never E-BATCH-001. **Documented in impl#1's own `compiler/tests/unit/batch-planner.test.js` §11/§13** (both bypass the parser with a hand-built AST + direct `runBatchPlanner`). The conformance harness compiles from SOURCE → E-BATCH-001 (and the `.nobatch()`-resolves path) is unauthorable until the parser lands `transaction { <sql> }` in fn-body position. Case dir carries a `NOTES.md`. **Also gated:** the SQL-rollback RUNTIME (§8.9.2 `?{ROLLBACK}` on re-throw) — harness mocks only `fetch`, no `?{}` DB (track B, needs a real-DB adapter). **Naming:** the list's `@nosql-tx` opt-out does not exist; the real per-query opt-out is `.nobatch()` (§8.9.5). **Ruling:** file the parser gap as an impl bug (→ re-author E-BATCH-001) vs accept a unit-test-only carve-out. (Incidental: `server function` surfaces W-DEPRECATED-SERVER-MODIFIER — explicit `server` deprecated for `?{}` auto-escalation.)

## Notes for the PA
- **Re-integration:** `conformance/cases/error*/**` is pure-additive data (13 new dirs, disjoint from compiler source + all sibling lists) — clean S67 file-delta onto main; confirm `bun conformance/run.ts` = 82/82 independently.
- **Worktree** `../scrml-spa-ss58` left in place (clean tree); `node_modules` is a symlink → main. Remove the worktree at re-integration (`git worktree remove ../scrml-spa-ss58`).
- Branch based on `origin/main` @ `1c7526f6` per the boot contract; local `main` is 1 ahead (the planning commit `0821ba1a` that added the ss58 list — not harness code), so a FF or file-delta both apply cleanly.
- `spa-lists/ss58.progress.md` (on the branch) carries the full per-item log + both escalations with inline reproducers. Probe scripts were in the sPA scratchpad (session-local); the escalations contain the exact snippets + observed codes to reproduce.
