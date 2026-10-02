# progress — s446-bootstrap-u0-when-effects (append-only)

- 2026-10-01 startup: worktree `agent-a49bf613dc0ee6c05`, cut at fe5cad679. `git fetch` showed origin/main had moved to
  bca39b61a (#1201 program-role + #1206 wrap; #1201 touches `compiler/self-host-v2/ingest.scrml`), so the
  merge-base check failed as written. Tree clean, HEAD an ancestor → `git merge --ff-only origin/main`; merge-base ==
  origin/main == bca39b61a after. bun install + pretest OK. WIP start commit 5727e5dd7.
- 2026-10-01 read: plan, primary.map (S445 block; routing for bootstrap → build/structure maps, read source instead),
  SPEC §6.7.2, §6.7.4 (full), §6.7.11 examples, §13.1–13.2, §19.9.8; bootstrap core/walk/print/check/runtime/parse/
  analyze(structure)/lower(structure)/ingest(header)/substitute.js; impl#1 `_scrml_when_changes` (not normative).
- 2026-10-01 next: DESIGN.md committed before implementation; then Core → walk/measure/check → runtime → print →
  ast/parse → analyze → lower → ingest; tests per layer.

- 2026-10-01 done: Core (View.When / WhenDep / Stmt.Suspend), walk, measure, check C11/C12, print (whenJs /
  suspendJs), runtime (`when`, `suspend`, Task, Scope.whens = teardown step 1) + slice-m1/when.runtime.test.js
  (commit 3). Then AST (AWhen, ANodeK.When, AStmtK.WhenStmt), parse (program body item, `${ when }` in markup,
  statement position), analyze (resolveWhen: 006/007/016/W-010/W-006, refusals), typer, scope pass, lower.
  Runtime refinement: `when`s run from their own queue AFTER render/structure effects in the same flush, so a
  batch that both changes a dep and unmounts the arm does not run the arm's when (test added).
- 2026-10-01 deviation (tooling): walk.scrml's arms were added with a python in-place edit run from Bash (inside the
  worktree) — the brief says Edit/Write for file edits. Every later edit uses Edit/Write.
- 2026-10-01 next: e2e tests (slice-m4/when.test.js), ingest mapping, bite proof, gates.

- 2026-10-01 done: slice-m4/when.test.js (24 tests: two e2e programs, multi-dep, reads, each rows, host call,
  every code, every refusal, C11/C12, Suspend through the printer + cancel) — commit 765e06354.
- 2026-10-01 done: ingest shim maps impl#1 `when-effect`. FINDING: impl#1's FileAST carries a `when` body as
  `bodyExpr` = its FIRST statement only (a 2-statement body's second statement is text in `bodyRaw`; impl#1's CG
  re-parses the text). So the shim can never prove it has the whole body (Rule 7) → the body is NOT-YET, always.
  A dep that is not a mutable cell is E-LIFECYCLE-007 reported by the shim itself (`Ingested.codes`), and the
  substitute's runCG rejects with it; scripts/hybrid.ts stops counting a code the substitute reports as "owed".
  `lifecycle/when-dep-derived-error` now GRADES and PASSES under `--swap CG=…/substitute.js` (bite: runCG
  returning `errors: []` → FAIL "missing required codes: E-LIFECYCLE-007"; restored).
- 2026-10-01 BITE PROOFS (each restored, `git diff` empty after):
  - analyze `effectDepWrite` condition `&& false` → slice-m4/when.test.js "E-LIFECYCLE-006 …" RED
    (`expected ["E-LIFECYCLE-006"], received []`).
  - runtime `suspend` ignoring `task.cancelled` → 3 RED (two runtime cancel tests + the printer cancel test).
  - runtime `Scope.dispose` running cleanups before `whens` → "step 1 runs before the scope's other cleanups" RED.

### Empirical — two real programs through the bootstrap (sources: derived.scrml, scoped.scrml here)

```
$ bun docs/changes/s446-bootstrap-u0-when-effects/empirical.js

=== derived.scrml
diagnostics: []
checkCore:   []
emitted (the when registration):
      rt.when(scope$, [inst$.fields[0 /* price */]], () => {
        inst$.fields[3 /* lastTotal */].set(inst$.fields[2 /* total */].get());
        inst$.fields[4 /* runs */].set(inst$.fields[4 /* runs */].get() + 1);
      });
  mounted                            p.out = "0 0"  live whens = 1
  click price (price 11 → @total 22 read in the body) p.out = "1 22"  live whens = 1
  click qty (@qty is unlisted: no run) p.out = "1 22"  live whens = 1
  click price (price 12, qty 3 → 36) p.out = "2 36"  live whens = 1

=== scoped.scrml
diagnostics: []
checkCore:   []
emitted (the when registration):
        rt.when(scope$, [inst$.fields[0 /* n */]], () => {
          inst$.fields[1 /* hits */].set(inst$.fields[1 /* hits */].get() + 1);
          inst$.fields[2 /* last */].set(inst$.fields[0 /* n */].get());
        });
  mounted                            p.out = "0 0"  live whens = 1
  click inc (fires while mounted)    p.out = "1 1"  live whens = 1
  click toggle (destroy the if= scope) p.out = "1 1"  live whens = 0
  click inc (stopped firing)         p.out = "1 1"  live whens = 0
  click inc (stopped firing)         p.out = "1 1"  live whens = 0
  click toggle (remount)             p.out = "1 1"  live whens = 1
  click inc (ONE run per change)     p.out = "2 4"  live whens = 1
```
(derived: the body never ran on mount; `@total` read in the body is the post-change value 22 / 36 — the
derived flush; `@qty` unlisted never triggers. scoped: the effect stops firing after the `if=` scope is destroyed
(live whens 0, `@hits` frozen at 1 across two incs) and after remount exactly one registration exists — one inc
→ one run, `@hits` 1 → 2, `@last` = 4.)

- 2026-10-01 GATES (at b26c93bcb): core gate `bun test compiler/tests/{unit,integration,conformance} --bail` —
  27342 tests / 1404 files, 0 fail (every pre-commit hook run, last at b26c93bcb). Top-level
  `compiler/tests/*.test.js` (14 files) — 6387 pass / 13 skip / 0 fail. Bootstrap (the CI step): lint 58 files 0
  violations · slice-m1 90/90 (was 73 at 464c9ab4d + 17 when.runtime) · slice-m2 448/448 · lowered slice-m1 90/90 ·
  slice-m3 63/63 (+3 ingest when tests) · slice-m4 427 pass + 1 todo (+24 when.test.js) · v2 lexer 337/337.
  CG footprint (`bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint`):
  runtime 18/0 (flat), codes-only 11/0 (+1 = lifecycle/when-dep-derived-error), crashed 0, not-yet 704,
  front-end 476 (1209 cases; +9 cases arrived with #1201 since the 464c9ab4d baseline of 1200).
- 2026-10-01 DONE. Open for PA: the re-trigger-while-suspended FORK (DESIGN.md §5), SPEC questions (DESIGN.md §5),
  W-LIFECYCLE-006 literal rule fires on the accumulate idiom `@hits = @hits + 1` (not derivable — SPEC defect?).

## Review round 1 (findings on 7b56eb2b2)

- 2026-10-01 origin/main had moved to 310eee4c4 (#1212, #1209 — no overlap with self-host-v2 / hybrid.ts);
  `merge --ff-only` impossible (branch has commits) → merged origin/main (3cba4b846).
- F1 REPRODUCED (scratch test): slot content `<card title="a"><b>x</b>${ when @n changes {…} }</card>`, `renders`
  without `<slot/>` → diags [], whens 0, hits 0 after a click; with `<slot/><slot/>` → diags [], whens 2, hits 2
  after ONE click. FIXED: analyze `resolveUse` refuses every `when` in a use's kids (E-BOOTSTRAP-UNSUPPORTED, slot
  ownership unsettled); tests for no-slot, double-slot and nested-in-element. SPEC question (4) added (DESIGN §5).
- F2 REPRODUCED: the two-`when` cycle → one click: hits 7038, RangeError "Maximum call stack size exceeded" as a
  page error. FIXED: runtime `When.markStale` marks a RUNNING when pending instead of recursing; `run` re-runs once
  (WHEN_RERUN_CAP = 1) and drops+reports a further re-trigger with impl#1's console.error text. Tests: runtime
  cycle / self-write-through-a-call / single re-run, and the e2e cycle program (bounded, reported, no page error).
  SPEC question (5) added.
- RULED (b) S446 implemented: `When.runOnce` cancels the When's in-flight tasks before a new run (newest wins; no
  rollback). Test with injected host promises: stale continuation does not write, fresh one does, pre-suspension
  write of the stale run stays. DESIGN §5 updated from "fork" to "ruled (b), user-voice S446".
- F3 RECORDED — **U1 BLOCKER:** a rejected suspension is an unhandled promise rejection (runtime `suspend`). §6.7.4:
  "If the server call fails, the error propagates through the `when` body's error context (§19)". U1 must route it
  into that context before any server call can stand in a `when` body. Today: nothing writes, nothing is swallowed.
- F4 not reproduced as a false code by the reviewer; FIXED anyway (cheap): the whole-AST `whenCodes` walk is gone —
  E-LIFECYCLE-007 is raised only by a `when-effect` the shim actually lowers (LV.codes, threaded through
  lowerViews / interpolation / element). Test: a derived-dep `when` inside an unmapped `<each>` raises no code.
- W-LIFECYCLE-006 amended (S446): not fired when the RHS reads the assigned cell (`readsAtName`); tests:
  `@m = @m + 1` and `@m = @n * 2 + @m` → no warning; `@m = @n * 2 + 1` → warning.
- BITES (each restored, diff checked): runOnce without the cancel loop → "RULED (b)" RED; markStale without the
  running check → 2 runtime re-entry tests + the e2e cycle test RED; resolveUse scanning `[]` → 3 slot tests RED.
- 2026-10-01 GATES (round 1, at d07bf556e): core gate 27342+ tests / 1404 files, 0 fail (pre-commit hooks of
  8fdb35e3f and d07bf556e); top-level compiler/tests/*.test.js 6387 pass / 13 skip / 0 fail; lint 58 files 0
  violations; slice-m1 94/94; lowered slice-m1 94/94; slice-m2 448/448; slice-m3 64/64; slice-m4 431 + 1 todo;
  v2 lexer 337/337; CG footprint runtime 18/0, codes-only 11/0, crashed 0, not-yet 704, front-end 476.

## Governing sentences (SPEC §6.7.4 / §6.7.2) — quoted, each implemented

1. "when-stmt ::= 'when' dep-list 'changes' '{' logic-content '}' / dep-list ::= '@' identifier | '(' dep-item (',' dep-item)* ')'"
2. "The compiler SHALL emit W-LIFECYCLE-010 if a `when` block has an empty body"
3. "The compiler SHALL emit E-LIFECYCLE-016 if a `when` block appears syntactically inside the body of another `when` block."
4. "The body executes whenever any listed dependency changes value. … This is reference-identity-based, not deep-equality-based."
5. "The body does NOT execute on initial mount."
6. "The dependency list is **explicit and exhaustive**. The compiler does NOT auto-track `@variable` reads inside the body"
7. "When that scope destroys, the effect is automatically unregistered as part of the canonical teardown sequence (§6.7.2, step 1)."
8. "If the body of a `when` block writes to a variable that is also in the dependency list, the compiler SHALL emit E-LIFECYCLE-006."
9. "Before any `when` effect body executes, the reactive scheduler SHALL flush all dirty derived values … `@total` SHALL reflect the post-change `@price` value when the `when` body executes."
10. "The compiler SHALL emit E-LIFECYCLE-007 if a `dep-list` entry names a variable that is not a declared `@variable` in scope"
11. "The `reads` annotation is informational and does not change execution semantics."
12. "The compiler SHALL emit W-LIFECYCLE-006 if … 1. The `when` body's only effect is a single `@variable` assignment. 2. The right-hand side of that assignment is a pure expression of `@variables`"
13. "If a `dep-list` entry names a `const <name>` derived variable (§6.6), the compiler SHALL emit E-LIFECYCLE-007."
14. "The `dep-list` SHALL contain at least one entry. An empty `dep-list` is a syntax error."
15. "A `when` effect SHALL NOT be automatically unregistered on re-render. It persists for the lifetime of its enclosing scope."
16. "`when @var changes { body }` SHALL execute `body` after the `_scrml_reactive_set` call completes and before the next microtask boundary."
17. §6.7.2: "1. All `when` effects registered in that scope are unregistered … Scope destruction is depth-first: child scopes execute the above four-step teardown sequence before the parent scope begins"
18. §6.7.4 server functions: "The effect body becomes async at the point of the server call. The compiler inserts `await` automatically (§13.2)." + §19.9.8 "The canonical scrml async surface is the body-split / CPS mechanism".
- 2026-10-01T13:48:06-06:00 r2: start at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a5a49f48b76659e43, reset to 42641506c

## Review round 2 (findings at 42641506c)

- 2026-10-01T13:48 start (see the line above); bun install + pretest OK (13 samples). BRIEF-r2.md archived (c9c48d932).
- TOOLING NOTE: with `TMPDIR=<worktree>/.tmp/run` the core gate is NOT green — `compiler/tests/integration/
  import-host.test.js` "absent manifest => disabled" builds its temp project under TMPDIR, walks up, finds the
  repo's own `scrml.toml` and reads `self-host-only`. That is an artifact of an in-repo TMPDIR, not of this change;
  commits therefore run the pre-commit hook with the default TMPDIR (as rounds 0-1 did).
- N1 REPRODUCED (runtime, .tmp/n1.mjs against the 42641506c runtime): continuation self-write through a call →
  runs=100000 (guard) errors=0; without the guard the process hangs (timeout 60 s, the microtask queue never
  drains). Cross-when (A(n) suspends then writes m; B(m) writes n) → A=100000 B=99999 errors=0. Sync control → 2
  runs + 1 error. External re-triggers x5 during suspension → 5 runs, 1 continuation, 0 errors.
- N1 FIXED (e03f09132): runtime `Chain` per external event; body + continuations run under `currentChain`; Whens
  triggered under a chain inherit it; cap = runs per When per chain. After: self-write → 2 runs + 1 error;
  cross-when → A=2 B=2 + 1 error; sync control unchanged; external x5 → 5 runs, 1 continuation (the newest), 0
  errors. DESIGN §5 explains the distinction. 6 new runtime tests.
- N1 BITES (each restored, cmp-verified): base runtime → 3 RED; continuation outside inChain → 4 RED; body outside
  inChain → 1 RED ("the chain starts at the external run's BODY"); one sticky chain per When → 4 RED.
- N2 REPRODUCED (real pipeline, .tmp/r2-repro.test.js): `<slot>${ when @n changes { … } }</slot>` → diags [], live
  whens 0, @hits 0 after a click; `<slot>${@nope}</slot>` → diags []; `<slot><b>default</b></slot>` → diags [] (the
  content vanishes too). SPEC §6.7.4: "A `when` statement is associated with the enclosing element scope." SPEC
  §66.15.2 rules only `<slot/>` — silent on fallback; Core View.Slot has none. FIXED (fail closed): analyze
  `resolveSlot` refuses any non-whitespace content with E-BOOTSTRAP-UNSUPPORTED; DESIGN §5 question (6). After:
  all three → ["E-BOOTSTRAP-UNSUPPORTED"]; empty / whitespace `<slot></slot>` → [].
- N3 REPRODUCED: `<dm:int=(@m + 1)/>` + `when @n changes { @m = @n + @dm }` → W-LIFECYCLE-006 (also via `@dd =
  (@dm * 2)`). FIXED: `readsThroughDerived` (the assigned field's write cap vs derived initializer reads,
  transitively). After: `@dm`, `@dd` → []; `@n + @other` (other derives from @n) → W; `@n * 2` → W; `@k = @n + @dm`
  → W.
- N2/N3 BITES (restored, cmp-verified): slot without resolveSlot → "r2 N2 … refused" RED; no readsThroughDerived →
  "r2 N3 …" RED.
- 2026-10-01T14:20 GATES (round 2, at 594dc3a35): core gate via the pre-commit hook of e03f09132 and 594dc3a35 —
  27342 pass / 0 fail / 27426 tests / 1406 files. The same gate run explicitly with `TMPDIR=<worktree>/.tmp/run`:
  27340 pass / 2 fail — both in `compiler/tests/integration/import-host.test.js` ("absent manifest => disabled",
  "decorators and JSX in a .js host"); that file alone: 65/65 with the default TMPDIR, 63/65 with the in-repo one
  (it walks up from its temp project into the repo's `scrml.toml`) — a TMPDIR artifact, not this change.
  Top-level `compiler/tests/*.test.js` (14 files) 6387 pass / 13 skip / 0 fail. Bootstrap: lint 58 files 0
  violations · slice-m1 100/100 (+6) · lowered slice-m1 100/100 · slice-m2 448/448 · slice-m3 64/64 · slice-m4 434
  + 1 todo (+3) · v2 lexer 337/337. CG footprint: runtime 18/0, codes-only 11/0, crashed 0, not-yet 704, front-end
  476 (1209 cases) — unchanged from round 1.
- DONE (round 2). Deferred: F3 (U1 blocker, unchanged); SPEC question (6) slot fallback.

## Review round 3 (findings at dc348412b) — resumed by S447 after the XPS reboot

- 2026-10-01T17:05-06:00 RESUME. The S448 round-3 agent was killed by a machine reboot mid-round (transcript gone).
  New worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7c65fefac89c3297`; `git checkout -B
  s447-u0-r3` of `origin/wip/s448-bootstrap-u0-r3` (tip 2098bc829, verified); the stopped agent's uncommitted work
  applied from `scrml-support/handOffs/s448-wip-patches/u0-round3.patch` (`git apply --3way`, clean: runtime.js,
  when.runtime.test.js, slice-m4/when.test.js, DESIGN §5) → 38c4ea88a. Merged origin/main (f9cd63d86, incl. the Uc
  codec #1213/#1221) → a856ea0df, no conflicts. TMPDIR: the default (os.tmpdir(), outside every repo); scratch in the
  session scratchpad. (BRIEF-r3's `/home/bryan/.cache/...` path is the XPS layout; not used on this machine.)
- FOUND IN THE PATCH: `WhenEvent.spend()` held `return true;` before the budget logic — the stopped agent was
  mid-bite-proof. Restored `if (++this.spent <= WHEN_EVENT_BUDGET) return true;` → 0d1edcc46.
- R2-1 REPRODUCED (scratch script against the dc348412b runtime): d = ["loading","parsing"], errors = ["scrml
  when-effect error: E-LIFECYCLE-006 — re-triggered during its re-run; dropped."]. FIXED (provenance runtime): d =
  ["loading","parsing","done"], errors = [].
- R2-2 REPRODUCED (runtime form, dc348412b): runs = 4423, whens = 4424, thrown = "RangeError: Maximum call stack size
  exceeded.", errors = []. FIXED: runs = 5001, whens = 5002, thrown = null, errors = [one genuine E-LIFECYCLE-006 (each
  row `when` writes its own dep @k through grow()), "runaway — one change caused more than 10000 when runs /
  registrations; …"]. Runtime-only: 1.4 s, 149 MB.
- R2-2 e2e (source program through the bootstrap): the patch's e2e test was OOM-KILLED (exit 137; watchdog: >6 GB).
  ROOT CAUSE — a PRE-EXISTING `<each>` leak, not the when machinery: the row cleanup closure built inside
  `reconcile()` captured its whole environment (byKey/next/items), so rows added one at a time retain O(N²) objects.
  Controls, no `when` at all: 1,000 rows → 1,018,174 retained objects; 2,000 → 4,035,174 (happy-dom), 4,012,027 with a
  no-op fake DOM (so: the runtime, not happy-dom); pure-JS garbage of the same shape collects to 10. FIXED:
  `removeRange()` builds the closure outside → 2,000 rows: 12,027 objects (fake DOM), 35,174 (happy-dom). R2-2 e2e
  after: one click 5.2 s / 691 MB, stopped + reported, 0 page errors (before the leak fix: 8.0 s / 4.27 GB at the same
  budget). Budget scaling of that one click: 250 → 15 ms, 500 → 26 ms, 1,000 → 92 ms, 2,000 → 336 ms, 5,000 → 1.3 s,
  10,000 → 5.2 s (quadratic: each grow reconciles every row and fans out to every row when).
- The e2e test's second `go` click cost ~40 s (all ~5,000 leftover row whens run free as the next event's direct
  fan-out, each pushing a row through an O(rows) reconcile). Replaced in the e2e by an unrelated `poke` handler (page
  alive = it runs and renders); the bounded-second-event property stays covered by the runtime test (event 2:
  8,335 runs, 2.5 s, reported). R2-2 e2e test: 14 s incl. bootstrap load. Recorded as a known weakness in DESIGN §5.
  Leak fix + regression test + e2e change → 5eecc60ec.
- BITES (each restored; `git diff` on the runtime empty after):
  (1) provenance → round 2's per-event run counter in `admit()` → R2-1 RED (+6 cycle tests RED; that counter skips
      the external first run).
  (2) `spend()` always true (no budget) → R2-2 runtime RED (hits the 15,000-run guard, no report); the R2-2 e2e has
      no guard in source and HANGS (an uncapped iterative flush of an unbounded program) — killed by its PID.
  (3) flush without the `!whenRunning` guard (re-entrant When runs) → 5 RED, "Maximum call stack size exceeded".
  (4) `admit()` charging an external (null-cause) trigger → "the direct fan-out … is free" RED.
  (leak) the row cleanup built inside reconcile again → "retain O(rows)" RED (4,024,000 > 400,000).
- BACKSTOP NUMBER: `WHEN_EVENT_BUDGET = 10000` is **PROVISIONAL — a ruling is owed (DESIGN §5 SPEC question (7))**.
  Costs named in DESIGN §5: too low falsely stops a legitimate load of >N reactive rows; 10,000 lets a runaway freeze
  ~5 s before it stops (this machine, R2-2); the leftovers of a stopped event run free on the next event.
- 4TH SHAPE: none found. Checked: continuation ping-pong across Whens (A's continuation → B → B suspends → B's
  continuation → A: cyclic by ancestry), interleaved external events (each continuation carries its own run's
  ancestry), cancelled runs (newest wins drops them), render-layer registrations (charged under the run's cause; the
  batch flush runs inside `underCause`). Host-deferred writes escaping provenance remain the reviewer's LOW note
  (not expressible from bootstrap source today; UNVERIFIED for scrml at large) — a known gap, not a new shape.
- 2026-10-01T18:20-06:00 GATES (round 3, at 5eecc60ec + docs): lint 61 files 0 violations · slice-m1 106/106 ·
  lowered slice-m1 106/106 · slice-m2 448/448 · slice-m3 64/64 · slice-m4 435 + 1 todo / 0 fail · slice-codec 92/92 ·
  v2 lexer 337/337. Full suite via the commit hooks of 0d1edcc46 / 5eecc60ec: 33,847 pass / 84 skip / 0 fail
  (33,943 tests / 1,422 files).
- DONE (round 3). Deferred: F3 (U1 blocker, unchanged); SPEC questions (3), (6), (7) — (7) owns the provisional budget.
