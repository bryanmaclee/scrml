# BRIEF — s446-bootstrap-u0-when-effects (bootstrap arc U0: reactive effects + async-capable effect layer)

You are working on the scrml **bootstrap compiler** (impl#2, `compiler/self-host-v2/**`, written in scrml, run by
impl#1). This is unit **U0** of the bootstrap server-boundary arc. Plan (READ FIRST, it is short):
`/home/bryan/scrmlMaster/scrml-support/docs/deep-dives/bootstrap-server-boundary-arc-plan-2026-09-30.md`.
Loci in that plan are [R]ead or [I]nferred at `29eb80c31` — treat every locus as PA-located-verify and report whether
each held, was refined, or was wrong.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` MUST
   equal `pwd`. `git status --short` MUST be clean. `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main`
   (you are cut from origin/main). If any check fails: STOP, report, exit.
2. `bun install` then `bun run pretest` (run plainly from the worktree CWD — `bun --cwd <path> run` silently no-ops).
3. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. NEVER write a path under
   `/home/bryan/scrmlMaster/scrml/` that is not inside your worktree. NEVER `cd` into the main checkout. Use Edit/Write,
   not Bash heredocs/redirects, for file edits.
4. NEVER use `git stash` (the stash is shared across all worktrees). NEVER `pkill -f`/`killall`; kill only by a PID you
   captured at launch.
5. First commit: `WIP(s446-u0): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (stamp `464c9ab4d`, 2026-10-01) first and follow its Task-Shape Routing for
self-host / bootstrap work (2–4 maps max). Post-map landings on main up to `fe5cad679` are docs/maps/wrap only (#1203
#1204 #1205) — no source moved. Treat map content as a hypothesis to verify against source. Report whether the maps
were load-bearing ("not load-bearing" is a valid answer).

## Policy (S435)
impl#1 (the TS compiler, `compiler/src/**`) is NOT changed by this unit. All work is in `compiler/self-host-v2/**`
(+ its tests). If you find an impl#1 defect, record it in your report; do not fix it.

## What to build
### Part A — `when` reactive effects, end-to-end in the bootstrap (the observable deliverable)
Governing source: **SPEC §6.7.4** (`when @var changes {}`) and **§6.7.2** (teardown order, step 1). Read §6.7.4 IN FULL
before writing code and quote the sentences you implement in your progress.md (governing-sentence gate). Key SHALLs
(verify each against the text — this list is the PA's reading, not normative):
- grammar `when dep-list changes { logic-content }`, single `@x` or parenthesized list; optional `reads @y` annotation
  (informational, no semantics).
- body does NOT run on initial mount; runs after the triggering set completes and before the next microtask boundary;
  dirty derived values are flushed before the body runs (observable — test it).
- dep-list is explicit; unlisted reads are not triggers.
- E-LIFECYCLE-006 (body writes a dep), E-LIFECYCLE-007 (dep not a declared mutable cell in scope, incl. a derived cell),
  E-LIFECYCLE-016 (nested `when`), W-LIFECYCLE-010 (empty body), empty dep-list = syntax error.
- the effect is owned by its enclosing scope and unregistered on scope destroy as teardown step 1 — the plan names
  `Scope.own` in `slice-m1/runtime/runtime.js` [I]; verify.
- ⚑ The bootstrap parses ONLY §66 declaration syntax. Write every test program in §66 forms (`<let x:int=0/>` etc.) —
  look at existing `slice-m*/` tests for the canonical shapes. Do not invent syntax; if §66 + §6.7.4 do not tell you how a
  form is written, STOP and report it as a SPEC question rather than guessing.
- Fail closed: anything in a `when` body the bootstrap cannot lower must be refused with the existing
  E-BOOTSTRAP-UNSUPPORTED mechanism, never silently dropped.
- Conformance: `conformance/cases/lifecycle/when-dep-derived-error` exists. Find how bootstrap grading against
  conformance works (look for an impl#2/bootstrap adapter under `conformance/adapters/`) and make that case pass under
  the bootstrap if the adapter exists; add bootstrap-side tests either way.

### Part B — an async-capable effect layer (groundwork for U1, keep it minimal)
SPEC §6.7.4 "Interaction with Server Functions" + **§13.2** (auto-await; no `async`/`await` in source, §19.9.8): a
`when` body (and later a server call anywhere) may become async; the compiler inserts the await. The bootstrap runtime is
purely synchronous today. Add the MINIMUM Core + runtime shape so that an effect/statement sequence can suspend on a
host promise and resume in order, with teardown cancelling a suspended effect's continuation (a destroyed scope's effect
must not resume and write cells). There is no server boundary yet (U1) — exercise this layer from tests via an injected
host promise, not via new source syntax. Write a short design note in `docs/changes/s446-bootstrap-u0-when-effects/DESIGN.md`
first (Core node(s), runtime API, how U1's `ServerCall` will plug in, what is deliberately NOT done) and commit it before
the implementation. If the design needs a decision that SPEC does not settle, stop and report the fork with options +
your rec — do not pick silently.

## Verification (do not report DONE without all of these)
- bootstrap test suites (`compiler/self-host-v2/**` tests + `slice-m*/` tests) green; the core gate
  `bun test compiler/tests/{unit,integration,conformance} --bail` green (the pre-commit hook runs it; never `--no-verify`).
- The top-level `compiler/tests/*.test.js` files are NOT in the hook but ARE in the cloud gate — run them too.
- Empirical: compile + run at least two real programs through the bootstrap using `when` (one with a derived read in the
  body, one inside an `if=` scope that is destroyed and remounted — show the effect stops firing after destroy and does not
  double-register after remount). Paste the commands and outputs into progress.md.
- Bite proof: break your E-LIFECYCLE-006 check deliberately, show a test goes red, restore.

## Discipline
Commit after every meaningful unit (WIP commits expected); keep `docs/changes/s446-bootstrap-u0-when-effects/progress.md`
append-only with timestamped lines (done / next / blockers). Clean `git status` before reporting.

## Report (final message)
worktree path · branch · FINAL SHA · files touched · governing sentences quoted · loci verdicts (held/refined/wrong) ·
maps load-bearing? · tests run + counts · empirical outputs · forks/SPEC questions surfaced · impl#1 defects seen ·
path-discipline incidents.
