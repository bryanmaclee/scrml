# S365 — instrument partial blindness

Branch: `fix/s365-instrument-partial-blindness` (cut from `origin/main` @ 11966341)
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8312d09e5de4d0ab`

Status: **COMPLETE.** Both rulings implemented, bite-proved, and committed.

## Ruling 1 (Q7) — delta-lint partial blindness + `--fix` corruption

**Strategy chosen: REFUSAL-PLUS-WIDEN** (the PA's lean), with a deliberately NARROW widen.

`ENTRY` / `DELTA_ENTRY` now accept an OPTIONAL leading marker token that must START with a
non-word non-space character (`[^\w\s]\S*`) — the real convention and nothing else.
`[9] two words · body` is still unparsed, and the new unconditional `bracketed` vs `total`
refusal then NAMES it. A permissive `(?:\S+\s+)?` widen would have fixed these four and
swallowed the next drift; that mutation is pinned red in the test suite.

Named capture groups replace positional ones so adding a capture cannot silently reindex a
consumer.

- `scripts/delta-lint.ts` — widen + `refuseUnparsedEntries()` (exit 2, names offending lines)
  + `--fix` clean-parse gate + an explicit merge-hazard warning scoped so it cannot read as
  having solved the (still open) merge-orientation defect.
- `scripts/state.ts` — same widen in lockstep; marker captured and DISCARDED so `kind` still
  drives the rulings/activity buckets; `refuseUnparsedDeltaEntries()` wired into `--write`,
  `--check` AND `--digest`; scoping moved to line-indexed so diagnostics name file lines;
  `parseDeltaLog` exported pure (this file's own S307 doctrine) with `entries[]` returned.

Live figures (this worktree, at `origin/main` content, 3 entries ahead of the PA's reading):

| | bracketed | parsed | unparsed |
|---|---|---|---|
| BEFORE | 1405 | 1401 | 4 — lines 1206 1207 1210 1404 = `[561] [562] [565] [727]` |
| AFTER | 1405 | 1405 | 0 |

Capture drift on the 1401 already-parsed entries: **0**. `handOffs/delta-log.md` UNTOUCHED;
the 9 baselined duplicates stay baselined; `--fix` never run on the real log.

## Ruling 2 (Q6) — the `expect`-vocabulary container policy

One table (`EXPECT_SHAPES`) + one exported validator (`validateExpectContainers`) covering the
whole vocabulary. `codeCounts`' inline container check was GENERALISED into it and deleted, not
duplicated. `loadCases` no longer launders a present-but-null `codes`/`notCodes` into `[]`.
`corpus-bridge.test.js` asserts `r.shapeErrors` FIRST.

Rules: absent = free · `[]` = legal no-op · non-conforming container = hard error · empty RECORD
= hard error where the record IS the assertion · `serverStub`/`serverDb` the single stated
exception (mock + seed, not assertions) · a violation fails ONE case, never throws.

Beyond the literal ruling and stated as such: an UNRECOGNISED `expect` key is also refused.
Zero blast radius measured (all 14 keys in corpus use are in the table). PA may veto.

## Verification

- Corpus: **883/883, exit 0** — unchanged.
- Full suite: BEFORE (origin/main content, in this worktree) 30155 pass / 53 fail ·
  AFTER 30275 pass / 53 fail. Failure NAME SETS **identical** (`comm` both directions empty).
  +120 pass = exactly the three new test files (14 + 18 + 88).
- Six blocking CI gates at the final SHA: all exit 0. `facts.ts --check` went red on this
  branch only (the 3 new test files move a published figure) and was closed by a mechanical
  `--write` — one table cell, 1,369 -> 1,372.

## Deferred / surfaced (NOT closed here)

1. `--fix` merge-orientation defect — out of scope by instruction; warning added only.
2. The flogence bridge (`src/ports/bridge-tool.scrml`, other repo) still carries the NARROW
   entry shape and is therefore still dropping the same four entries.
3. `runDigest()` does not call `refuseDegenerateProjection()` — the known-gaps / session-anchor
   halves of the hollow-projection guard remain absent from the digest write path.
4. `docs/known-gaps.md`: `g-delta-lint-partially-blind-on-emoji-kind-entries` and
   `g-delta-lint-fix-corrupts-log-under-partial-blindness` are now closeable. NOT edited —
   known-gaps is a PA-owned shared doc.
5. `delta-lint.ts` is a top-level CLI with import-time side effects, so its guards are only
   reachable by spawn. The S307 `import.meta.main` treatment given to `state.ts` was never
   applied here.
