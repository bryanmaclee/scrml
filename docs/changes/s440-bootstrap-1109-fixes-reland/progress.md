# s440-bootstrap-1109-fixes-reland — progress (append-only)

## 2026-09-28 — startup
- WORKTREE_ROOT `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9f8000418c542f73`, base = origin/main = `d244a6f3b`.
- bun install + pretest OK.
- Baselines (before any change):
  - `bun test ./compiler/self-host-v2/slice-m1 ./slice-m2 ./slice-m3` → 381 pass / 0 fail (15 files).
  - mutations.js → 72 mutation(s), 0 problem(s), exit 0 (234 s).
  - bite-matrix.js → 32 CERTIFIED / 0 UNCERTIFIED, exit 0 (110 s).
  - footprint (`bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint`) → 18 RUNTIME passes of 18.
- Maps: primary.map.md read; the S438 block records the CRLF drift-guard failure (Windows clone, 72/74) — that IS F3.
  Otherwise not load-bearing (predates #1117/#1118/#1122).

## 2026-09-28 — Peter's tests applied verbatim (`git show eb3de63d` test hunks apply cleanly), RED on main code
front.test.js + parse.test.js against MAIN's analyze/lower: 49 pass / 10 fail:
```
(fail) O58 (b) — a spread reads ONE snapshot … > a struct-cell swap `{ ...@p, x: @p.y, y: @p.x }` swaps   Expected "2,1" Received "2,2"
(fail) … > override order does not matter: `{ ...@p, y: @p.x + 10, x: @p.y }` → 2,11                     Expected "2,11" Received "11,11"
(fail) … > a value reading its own and a sibling field sees the pre-write snapshot → 3,1                  Expected "3,1" Received "3,3"
(fail) … > an INSTANCE spread swap `{ ...@pp, a: @pp.b, b: @pp.a }` swaps                                Expected "2,1" Received "2,2"
(fail) … > the classification is unchanged: … values evaluated first
(fail) §66.7.5 — `@h` is narrowed inside its own given > a direct READ `@color.value` inside the block is accepted
(fail) … > a direct WRITE `@color.value = …` inside the block is accepted
(fail) … > the direct write lowers exactly as the write through `c` does
(fail) … > at runtime the direct write lands while mounted
(fail) … > nested: an outer narrowing holds inside an inner `given`; an inner one ends with its block
```
F3 (parse.test.js drift guard) is GREEN on this LF Linux checkout, so its RED is shown on a CRLF copy
(scratch script re-running both guards over `\r\n`-converted SPEC.md + sources):
```
OLD guard on CRLF: blocks found = 0 ; counter found = false
NEW guard on CRLF: 66.19.1 ok = true ; 66.19.3 ok = true
```
F3 is test-only → committed alone. F1/F2 tests stay uncommitted until their fix lands (one commit each).

## 2026-09-28 — F1 + F2 re-applied (GREEN)
- F2: analyze Env gains `narrows: NarrowB[]` (+ withNarrow / lookupNarrow); resolveAt resolves a narrowed `@h`
  to `NInst(iDecl, Narrowed(c))`, maybe=false (Peter's `Fact.FInst` → the #1122 names family `addName`).
  resolveGiven pushes the subject's narrowing. The new typer (#1117) needed nothing: Peter's tests pass.
- F1: SpreadWrite gains `tmp: Sym | not` (the typer's `oneWrite` — new since Peter's base — carries `not`);
  both spread resolvers mint the local; lower emits Lets before Writes when ≥2 overrides.
- slice suites: 396 pass / 0 fail; SLICE_CORE=lowered slice-m1 73/73; lint-no-default-arm 0 violations.
- Next: Part 2 (atomic commit) — this F1 shape still applies override 1 before override 2's runtime edge check.
