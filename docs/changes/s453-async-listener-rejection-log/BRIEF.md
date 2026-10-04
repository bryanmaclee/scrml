# BRIEF — s453-async-listener-rejection-log (A3, bryan-RULED)

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing** for a codegen change;
then the maps it routes you to for `codegen/` (event wiring / client emit). Map stamp: commit
`d3e660a08`, 2026-10-04. **HEAD is `df6dad5a`** — factor in three post-map landings: `54ba3271`
(#1271 S451 wrap), `488abeed` (#1270 bootstrap §34 severity), `df6dad5a` (#1272 SPEC currency).
Treat map content as a **verify-against-source hypothesis**. Report which map content was
load-bearing — "not load-bearing" is a valid, useful answer.

## Context — ruled, and it closes a gap that WIDENED last session

`scrml-support/user-voice-scrml.md` §S449, bryan: **"A3 = yes: every async event listener routes its
rejection to `_scrml_error_boundary_log`"** — *"(extends B5 to handlers; closes
`g-handler-level-rejection-bypasses-scrml-logging`)"*.

Why it is owed now: S450's **#1242** made a nested server-call write **awaited in place** inside a
handler, which colours the handler `async`. An `async` listener handed to `addEventListener` returns
a Promise **nobody observes**, so a failed call that previously reached scrml's logging surface now
surfaces only as a browser unhandled rejection. The PA's reading at the time — *"newly-awaited writes
no longer reach `_scrml_error_boundary_log` on a failed call; rec: route an async listener's rejection
to `_scrml_error_boundary_log` (one emit change)"* — is what bryan said yes to.

`_scrml_error_boundary_log` is the established surface: it lives in the **always-included `errors`
runtime chunk** (so it needs no new chunk wiring) and is already the sink for `on mount`
(`emit-reactive-wiring.ts`), engine opener `effect=` (`emit-engine.ts`), markup server-fn writes and
`session.destroy` (`emit-client.ts`), and `<errorBoundary>` (`emit-event-wiring.ts`). Mirror the
existing pattern; do not invent a second logging path.

## Starting point

```
git fetch origin brief/s453 && git checkout FETCH_HEAD -- docs/changes/s453-async-listener-rejection-log/
```

Your worktree is cut from `origin/main` (`df6dad5a`). Assert it: `git merge-base HEAD origin/main`
== `origin/main`.

## Falsifiable premises — I located these by search, I did NOT trace execution. Verify first, report held/refined/wrong

- **The seam is `colorHandlerAsync(...)` at `compiler/src/codegen/emit-event-wiring.ts:~1340`** — the
  call that colours a handler `async` (S441 + S446 lineage; the comment above it describes the
  await-in-place behaviour). The handler expression it returns is what ends up registered as a
  listener, either via the `document.addEventListener` delegation path (`~:1564`), the non-delegable
  element path, or an **arm-bound factory** (`armFactoryLines`, `~:1378` — a handler inside a
  `match`/engine arm or an `<each>` row). **All THREE registration paths must be covered** — a fix
  that only covers delegation leaves the arm/row handlers silently unlogged, which is exactly the
  incomplete-fix shape that costs a second PR.
- `compiler/src/codegen/js-async-analysis.ts` (`colorAsyncFunctionExpr`, `handlerStatementListColor`,
  `unanalyzableHandlerUses`) is where the colouring itself is decided, and may be the better home if
  the wrap belongs with the colouring rather than at the call site.
- A handler that is NOT coloured async must come out **byte-identical** (see the differential gate
  below).

## What to build

Route the rejection of an async-coloured event listener to `_scrml_error_boundary_log`.

**PA lean on the shape (yours to confirm or overturn with a reason):** wrap the coloured body in a
`try { … } catch (e) { _scrml_error_boundary_log(<id>, e); }` **inside** the `async function(event)`,
rather than converting the listener to a sync function that fires an async IIFE and `.catch`es it.
Reason: the sync prefix of a handler body currently runs synchronously up to the first `await`, and
`event.preventDefault()` / `stopPropagation()` live in that prefix. An IIFE wrapper would move them
past a microtask boundary and silently break event semantics — a behaviour change nobody asked for.
If you find the try/catch shape cannot catch some path the IIFE would (e.g. a rejection from a
detached promise the body created), say so and name it rather than widening the change.

**The `<id>` argument** (first parameter of `_scrml_error_boundary_log`, the "boundary id"): pick a
stable, debuggable identifier for the handler and mirror the existing convention — `emit-engine.ts`
uses `` `${meta.varName} effect=` ``, `emit-reactive-wiring.ts` uses `"on mount"`. Something naming
the event and the handler site (its `placeholderId`) is the lean. State what you chose.

**Do not** change which handlers get coloured async, and do not touch the await-injection logic. The
scope is: when a listener is async, its rejection is logged.

**`<errorBoundary>` interaction — check it and report.** `emit-event-wiring.ts:~2393` already logs to
`_scrml_error_boundary_log(bId, …)` from the boundary render path. Make sure a handler inside an
`<errorBoundary>` does not now log **twice**, and that the boundary's own fallback behaviour is
unchanged. If double-logging is unavoidable without a larger change, report it rather than
restructuring the boundary.

## Verification — all of it is required

1. **Bite-prove the fix.** A test that asserts the `.catch`/`catch` arm exists must FAIL on the
   pre-change tree. A test that cannot fail is not a test (base §8, the unproven gate).
2. **Runtime proof in happy-dom, not emission-grep alone.** Compile a file whose event handler
   awaits a failing server call, mount the client output in happy-dom, dispatch the event, and assert
   `_scrml_error_boundary_log` was reached (and that the page did not take an unhandled rejection).
   The recipe to mirror is `compiler/tests/browser/browser-bind-value.test.js` (GlobalRegistrator +
   `SCRML_RUNTIME` + `captureInsideChunkScope`); the scheduler is synchronous there, so findings are
   browser-faithful. Cover a handler on **each** of the three registration paths (delegated,
   non-delegable, arm/row-bound).
3. **The differential is the load-bearing gate here, in BOTH directions.** Run
   `bun scripts/corpus-emit-differential.ts` (or the equivalent base-vs-head emit compare the repo
   provides — find it and say which you used) over the corpus and report:
   (a) every file whose emitted client JS changed is one with an **async-coloured handler**, and
   (b) **a count of async-coloured handler sites in the corpus** — i.e. how many sites the fix
   actually reaches. ⚑ A differential of "N files changed" without that population count cannot tell
   a complete fix from one that caught a third of the sites (base §8, the coverage blind spot; and
   the truncated-probe rule — have the probe print `N of M`, never a `head`-cut list).
4. **Phase 3 — R26 empirical.** Recompile real adopter sources on the post-fix baseline:
   `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>` over
   `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` and the in-repo corpus. The symptom check
   is a specific grep/shape assertion on the emitted handler, NOT "tests pass". **Do not mark DONE
   without the empirical pass.**
5. **Direction-of-change classification** (base §8 + `pa-profile-pjoliver11.md`): state inert /
   newly-rejecting / newly-accepting / semantics-changed with your evidence. My expectation is
   **semantics-changed** (a rejection that escaped now gets logged) with **no diagnostic delta** —
   the weakest-gated class, which is why (3) is not optional.
6. **Close the gap entry** `g-handler-level-rejection-bypasses-scrml-logging` in
   `docs/known-gaps.md` (and the widening note #1242 added to it), with `prov=ruling:user-voice-scrml.md S449`
   on the marker. Then `bun scripts/state.ts --write` + `--check`.
7. `bun scripts/facts.ts --check` and `bun scripts/state.ts --check` must PASS at the end (run
   `--write` first where they fail — these gate the PR ~3 min into CI otherwise).
8. Local suite: `bun run test` (chains pretest) for a baseline, plus at minimum
   `bun test compiler/tests/{unit,integration,conformance}`.

## Workspace discipline (read in full; these are incident-earned, not boilerplate)

- **STARTUP GATE, first action, before any edit:** `pwd` must be your assigned worktree under
  `.../scrml/.claude/worktrees/agent-<id>/`; `git rev-parse --show-toplevel` must equal it; tree
  clean. Then `bun install` (a worktree does NOT inherit `node_modules` — the hook fails "cannot find
  package 'acorn'" otherwise) and `bun run pretest` **run plainly from the worktree CWD** (⚑
  `bun --cwd <path> run <script>` silently NO-OPS and exits 0 — it needs `--cwd=<path>` with the `=`;
  verify `samples/compilation-tests/dist/` actually appeared, exit code proves nothing). The browser
  tests need that fixture directory — without it you get ~130 ECONNREFUSED-shaped failures that are an
  ENV gap, not a regression. **If ANY check fails, STOP and report.**
- **Every Read/Write/Edit uses a worktree-ABSOLUTE path.** A relative path resolves against the
  integration checkout. NEVER `cd` into the main checkout; use `git -C "$WORKTREE_ROOT"` and run
  `bun` from the worktree CWD.
- ⚑ **NEVER `git stash`.** `refs/stash` lives in the COMMON `.git` dir and is shared across every
  worktree — a stash here can be popped into another tree, and the PA's stash can land in yours
  (witnessed S385, both directions in one race). Do base-vs-build flips by **file copy**.
- ⚑ **NEVER a bare `pkill -f` / `killall` on a command string** (e.g. `pkill -f "bun test"`) — every
  checkout shares it and you would silently kill the PA's or a sibling's run, leaving no trace. Kill
  by PID captured at launch, or filter on cwd.
- Scratch goes under `<worktree>/.tmp/`; set
  `TMPDIR=~/.cache/scrml-agent-tmp/s453-async-listener-rejection-log/` per command (⚑ `TMPDIR` must
  NOT point inside any repo — tests build throwaway projects under it and walk UP for
  `scrml.toml`/`.git`). Delete your scratch before the final report.
- **Commit after every meaningful edit** (WIP commits expected, the branch is the checkpoint) and keep
  `docs/changes/s453-async-listener-rejection-log/progress.md` as an append-only timestamped log: what
  you just did, what is next, blockers. First commit message:
  `WIP(s453-async-listener-rejection-log): start at $(pwd)`. A clean `git status` before you report
  DONE is mandatory.

## Out of scope — do not touch

`compiler/src/codegen/emit-logic.ts`, `compiler/src/ast-builder.js`,
`compiler/src/validators/lint-transaction.ts`, `compiler/SPEC.md` §19.10, and the `transaction`
conformance cases — a sibling dispatch owns those this session. `compiler/src/codegen/emit-server.ts`
and `compiler/self-host-v2/**` are also off-limits (the latter is another machine's live lane).
`docs/known-gaps.md` is shared with that sibling: edit only YOUR gap entry, and expect me to resolve
the §0 count hunk at landing.

## Report back

Final message: worktree path · final commit SHA · files touched · premise verdicts
(held/refined/wrong) · the wrap shape you chose and why · the boundary-id you chose · the
double-logging finding · the differential's `N of M` numbers · direction-of-change · which maps were
load-bearing · anything you deliberately did NOT do. Do **not** open a PR and do **not** push to
main — I review the delta, land it on a feature branch and run the S239 adversarial pass before it
merges.
