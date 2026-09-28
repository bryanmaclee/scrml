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
- Committed `21f91f277`.

## 2026-09-28 — Part 2: spread writes ALL-OR-NOTHING (RULED S440)
- RED first (front.test.js "RULED S440 — … ALL-OR-NOTHING", against the F1 Lets+Writes shape): 4 of 6 fail —
  every case where a granted override precedes the refused one (`phase: .Gone, stage: .Gone` after live();
  `note: "n1", stage: .Gone`; `stage: .Live, phase: .Draft`; the same through `given c = @g`). The two
  "refused-first" / "all granted" cases pass either way (order-independence + non-no-op guards).
- Finding: analyze's transitionCheck NEVER emits `Check.Static` today (always RuntimeEdge, or a compile error
  for an unreachable variant) — so every instance-spread graph override is runtime-checked.
- Where a runtime refusal can happen in a spread today: ONLY a RuntimeEdge Transition (instance spread over a
  graph field). Struct-cell spreads lower to FieldAt/Static writes (no runtime check exists for them); lifecycle
  and sequence grants are compile-time classified (no runtime refusal path in the bootstrap).
- Design: new Core statement `Stmt.Commit(writes: Stmt[])` — an all-or-nothing group: every write's check first,
  then every write; on a refusal none applied. Lower emits `Let tmp…` + `Commit([Write … Local(tmp)])` for ≥2
  overrides; a lone override stays a plain Write; zero overrides lower to nothing. check.scrml C7: a Commit holds
  ≥2 Writes and nothing else, each storing a Local. print: `rt.checkEdge(...)` per RuntimeEdge transition, then
  each write as Static (`.set` / `rt.setIn`). runtime.js: `checkEdge` split out of `transition` (the mutation
  anchors `if (from === to) return;` / `if (!allowed || …) {` still occur exactly once).
  walk / measure / check / print gain the arm (no default arms — lint 0 violations).
- SPEC atomicity sentence: searched §66.10, §66.11 (all of .1–.7 incl. the S437 amendment), §66.13, §66.20, and a
  whole-SPEC grep for `atomic|all-or-nothing|partial|rollback` — NO governing sentence for spread-write atomicity.
  SPEC.md NOT edited (per brief); PA to write the line.
- Adversarial shapes (tests added where expressible):
  - through a `given`-narrowed handle — test (atomic).
  - row-scoped `as=` handle inside `<each>`, inline handler — test (atomic, per row).
  - zero overrides (instance + struct cell) — test (nothing written).
  - contract-free-of-graph `let` field alongside a graph field — test (not applied on refusal).
  - nested spread `{ ...@p, q: { ...@p.q, a: 1 } }` and a sub-path spread `@p.q = { ...@p.q, … }` — NOT expressible:
    E-BOOTSTRAP-UNSUPPORTED ("a spread `...` is in slice M2 only as `@x = { ...@x, f: v }`").
  - struct-cell multi-override — covered by the snapshot tests; no runtime refusal exists on that path.
  - DUPLICATE override of one field `{ ...@g, phase: .Gone, phase: .Live }` — compiles; the Commit checks BOTH
    edges from the snapshot (Draft→Gone refused) although last-wins object semantics would give phase=.Live.
    SPEC is silent on duplicate struct-literal keys → surfaced to PA, not changed.
- slice suites: 407 pass / 0 fail; SLICE_CORE=lowered slice-m1 73/73; lint 0 violations.
- Committed `c2e8ea9f6`. After Parts 1-2: mutations 72/0 problems; bite matrix 32 CERTIFIED exit 0;
  footprint 18/18 runtime.

## 2026-09-28 — Part 3: Peter's F12/F13/F14 workarounds reverted (#1119 on main)
- F13 (`e181164f3`): check.scrml `writeCheck`, print.scrml `writeCheck` + `eachHandles` accessors removed —
  Stmt.Write / View.Each bound in one 5-field arm; notes in ast / analyze / lower / print updated. ast.scrml's
  ≤3-field payload SHAPE kept (it is a design, not a workaround call site).
- F14 (`e4923409f`): LB()/RB() removed from js.scrml, parse.scrml, analyze.scrml; every use is a plain literal.
- F12: lint-no-default-arm's "non-first alternation arm" rule retired; lint.test.js updated (non-first
  alternation = clean; the real-tree bite now plants `_ | .Int` in a later arm); lex.scrml `dispatch` reordered so
  its alternation arm is NOT first (a real-tree proof: every lexer test runs through it; a glued arm would break
  the `.InCode` arm); notes in lex / print / parse / analyze updated. mutations.js: the retired rule's mutation
  ("F8 non-first alternation arm not flagged") removed (its anchor is gone) and 6 S440 mutations added.
- All verified by compiling the bundle under impl#1 (validateEmit) + slice suites 407/0, lowered M1 73/0,
  lint 0 violations.
- Final: mutations 77 mutation(s), 0 problem(s) (all 6 S440 mutations RED); bite matrix 32 CERTIFIED /
  0 UNCERTIFIED exit 0; footprint 18/18 runtime.
- Committed `41f8416de`.

## 2026-09-28 — FIX ROUND (S239 review: DO-NOT-LAND until F-A)
- Merged origin/main (`e84a3d74a`, `d9f183c41` — docs/inbox/master-list only) → `3f3445ba4`, no conflicts.
- F-A reproduced with the PA's probe (zzprobe2) on the merged tip, before the fix:
  ```
  A observer saw: ["Draft/Draft","Live/Draft","Live/Live"] final: Live/Live
  B thrown: E-ENGINE-INVALID-TRANSITION: .Draft → .Gone …   final: {"phase":"Live","stage":"Draft"}
  ```
  after the fix: A and B both `["Draft/Draft","Live/Live"]`, final Live/Live, nothing thrown.
- Fix:
  - print.scrml commitJs: the writes are emitted inside ONE `rt.batch(() => { … })`. The checks stay OUTSIDE,
    before it: they are pure `peek` reads with no side effect, nothing can run between them and the batch, and
    a refusal throws before any batch bookkeeping (a throw inside `batch` would still run its `finally` flush).
  - Resolve the instance once: `EffectFact.ESpread` gains `inst: Sym` (minted by analyze's new `spreadEffect`);
    lower emits `Let inst = Handle(<the write's InstRef>)` first and every Commit Write goes through
    `Narrowed(inst)` — the existing Core idiom for "a local holding an instance identity" (check C4 already
    resolves it via the Let's Handle initializer). Emitted JS: `const gate = shared_program().handles[0].get();`
    then `rt.checkEdge(gate.fields[…], …)` ×n, then `rt.batch(() => { gate.fields[…].set(…); … })`.
- Tests (front.test.js, "S440 F-A"): probe case A (observer never sees the half state), probe case B (the
  half-state watcher never fires, final Live/Live), and a Commit REFUSED outside a batch (byte-identical, the
  observer never re-ran). Updated shapes: `Let(inst), Let, Let, Commit`; writes via `Narrowed(inst)`; the JS test
  asserts `rt.batch` after the checks and one `handles[` read.
- Mutations: "S440 F-A: the Commit's writes not batched" and "S440 F-A: the Commit re-resolves the instance per
  write" added; the S440 F1 and commit-order anchors updated to the new lines.
- Gates after the fix: slices 410/0; lowered M1 73/0; lint 0; mutations 79, 0 problems (both F-A RED: 3 / 4
  failing); bite matrix 32 CERTIFIED / 0 UNCERTIFIED exit 0; footprint 18/18 runtime.
- OPEN (SPEC-silent; PA/bryan to rule — NOT acted on):
  1. a duplicate override key `{ ...@g, phase: .Gone, phase: .Live }` — both edges checked from the snapshot.
  2. an override value calling a function that writes the same field (`x: bump()` observed 5,99,99): the value
     Lets run the call before the Commit, so the callee's write lands and the Commit's write then overwrites it.
  (Both RULED later this round — see the next section.)
- Committed `1f458ad79`.

## 2026-09-28 — RULING UPDATE (bryan S440 "all recs"): strict snapshot + duplicate key
- BEFORE (on `1f458ad79`, probe program P = { let x, let y, let z } = {1,2,3}; bump writes @p.z = 99, returns 5;
  touch writes @p.x = 99, returns 7):
  ```
  bump       { ...@p, x: bump(), y: @p.z }            => 5,99,99
  swap-call  { ...@p, x: @p.y, y: touch(), z: @p.x }  => 2,7,99
  rotate3    { ...@p, x: @p.y, y: @p.z, z: @p.x }     => 2,3,1   (already right: F1's tmp locals)
  lone-call  { ...@p, y: bump() + @p.z }              => 1,104,99
  dup-spread { ...@p, x: 5, x: 6 }                    => accepted, 6,2,3 (last wins)
  dup-plain  @p = { x: 5, x: 6, y: 1, z: 1 }          => accepted, 6,1,1 (last wins)
  ```
- AFTER:
  ```
  bump 5,3,99 · swap-call 2,7,1 · rotate3 2,3,1 · lone-call 1,8,99
  dup-spread → E-BOOTSTRAP-DUP-OVERRIDE ("`x` is overridden twice in this spread …")
  dup-plain  → still accepted, last wins (NOT changed — the ruling was about the spread shape)
  ```
- (1) STRICT SNAPSHOT: ESpread gains `snap: Sym` (analyze `spreadEffect` mints it, hint "before"). The instance
  spread now resolves its operand `...@h` (resolveHandleSubject — a subject, no read check). lower: the operand
  lowers to the target's cell read; the override values lower under an LC whose `snap` maps any read of that
  place (or under it — same decl, same InstRef spelling, path prefix) to the local (`cellRead`). If any value
  reads it, `Let before = <operand>` is emitted ONCE before every value Let (through the instance local when
  there is a Commit). Emitted JS: `const before = rt.snapshot(gate); const stage = before.phase; …`.
  A callee's write to a NON-overridden field survives (the Commit writes only overridden fields) — tested:
  bump's z = 99 survives; the instance case keeps mark()'s phase: Live. Only reads LEXICALLY in the literal are
  snapshotted; the callee's own reads of `@x` are live (ruling text: "in a spread-override literal").
  Tracking note: an INSTANCE snapshot is `rt.snapshot(inst)`, which tracks every field when the spread runs
  inside an effect (a render hole) — a wider subscription than the individual field reads it replaces. It
  converges (a re-run writes equal values; `Cell.set` is a no-op on `Object.is`) but can cost one extra re-run.
- (2) DUPLICATE KEY: §66.20 names no code → provisional `E-BOOTSTRAP-DUP-OVERRIDE`, reported at each repeated key
  (the repeat is not written). Plain struct literals do NOT reject duplicates today (analyze's `resolveObject`
  takes the LAST prop with that name; last-wins) — left alone, reported to the PA.
- OWES-A-§34-ROW: `E-BOOTSTRAP-DUP-OVERRIDE` (provisional, bootstrap-local; the PA writes the SPEC row).
- Tests (front.test.js): "STRICT SNAPSHOT" ×5 (bump, swap-with-call, rotate-3, lone-call, instance + mark()),
  "duplicate override key" ×3; shape tests updated (`Let inst, Let before, Let x, Let y, Commit`; values read
  `LocalPath(before, …)`; a lone override reading `@p` is `Let before, Write`, one that does not is `Write`).
- Mutations: "STRICT SNAPSHOT off" and "duplicate key accepted" added.
- Gates: slices 418/0; lowered M1 73/0; lint 0; mutations 81, 0 problems (strict-snapshot RED 6, dup RED 3);
  bite matrix 32 CERTIFIED / 0 UNCERTIFIED exit 0; footprint 18/18 runtime.
- Committed `ece7bc96b`. main moved again (#1125 `7e4bc8155`, touches compiler/src/api.js + commands/) → merged
  as `a6fe0000e`, no conflicts; re-ran on the merged tip: slices 418/0, lowered M1 73/0, lint 0, footprint 18/18.
