## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: S99/S314/S385 leaks — absolute main-rooted paths or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == `pwd`; `git status --short` clean. Any failure: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree. Never a main-checkout path; never `cd` into main. Do NOT touch the other worktrees `agent-abcf0e48a556b9bd9` or `rev-await-r6` (read-only reference is fine).
3. NEVER `git stash`, NEVER `pkill -f`/`killall` by command string, NEVER `--no-verify` / hooksPath changes, NEVER force-push.
4. `bun install`, then `bun run pretest` plainly from the worktree CWD (verify `samples/compilation-tests/dist/` exists).
5. TMPDIR never inside a repo: `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-await-r7` per command.
6. The machine is memory-constrained (4 other agents running): never run two full test suites at once; run targeted tests while iterating, the full gates once at the end.
7. Branch setup (`s465-await-r5` is checked out elsewhere — do not check it out by name):
   `git fetch origin && git checkout -b s466-await-r7 origin/s465-await-r5` (tip must be `22ed85298`). Append to the existing `docs/changes/s465-await-imported-server-fn/progress.md`; write this prompt verbatim to `docs/changes/s465-await-imported-server-fn/BRIEF-r7.md` as your first commit (`WIP(s466-await-r7): start at $(pwd)`). Commit after each step; code+tests are one unit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `41af4153a`). Then read `docs/changes/s465-await-imported-server-fn/progress.md` IN FULL — rounds 1–6 and their findings.

## Context
Gap `g-imported-async-server-fn-not-awaited-s465` (HIGH P0, LIVE ON MAIN): an async server helper called without `await` → `if (!check(pass, hash))` accepts a WRONG PASSWORD. Round 6 (`22ed85298`) closed all round-5/6 findings. The S239 round-6 review on a frozen `22ed85298` returned FIX: across 125 new probes, 11 wrong passwords still accepted on the branch (81 on base). PA REPRODUCED both HIGHs below by execution.

**This is round 7 and it is the LAST round before landing (owner precedent S464: "fix + land"; residual position holes get filed, not rounded).** Six rounds of position-by-position fixes is the bug generator. This round SHALL be a ROOT fix: remove the second readers. Do not add another position check.

## Findings to close (reviewer's reproducers live under `/home/bryan-maclee/.cache/scrml-review-await-r6/` — READ-ONLY; copy what you need into your TMPDIR. Harness: `bun harness.mjs <compilerRoot> <shapesFile> [filter]`; copy it and change its hard-coded `base` output path to your TMPDIR, and its BR/BASE tag test (root.includes("rev-await")) to match your worktree)

**HIGH-A — a lib's NON-EXPORTED `function` helper is not awaited.**
```
// lib.scrml
function inner(p, h) { return verifyPassword(p, h) }
export function check(p, h) { if (!inner(p, h)) { return false } return true }
```
`lib.server.js` "ss1: module value exports" emits a SYNC `export function check` with `if (!inner(p, h))` — `inner` is an async server peer → tests a Promise → WELCOME. Also via two hops, `server function inner`, inner calling an imported async lib fn, inner doing `?{}` (probes2/n8.mjs libFnDecl*, n7.mjs libFnDeclIf). Reviewer-located root (verify): the ss1 `computeAsyncFnNames(fnDeclByName…)` in `emit-server.ts` (~:1127) runs over VALUE-EXPORTED fns only and is not seeded with the file's server-fn/peer names; r6's computation in `codegen/index.ts` passes `_serverFnNames`.
**ROOT FIX REQUIRED:** ONE async-name set per file, computed once in `codegen/index.ts` (every function declaration exported or not, function-valued bindings, server functions + peers, async imports — a fixpoint over the call graph), and EVERY server emitter (ss1 module value exports, D-5 binding closure, routes, library/tool mode, CPS stubs) reads that one set. Delete the per-emitter fixpoints. Report every former reader you removed.

**HIGH-B — a program-defined `setTimeout` treated as the global fire-and-forget scheduler (partial REGRESSION vs base).**
```
function setTimeout(cb) { return cb() }
if (!setTimeout(() => check(pass, row.pw))) { return "REJECTED" }
```
Branch emits `if (!setTimeout(async () => await check(...)))` — the async peer `setTimeout` not awaited → WELCOME. Base emitted `if (!await setTimeout(() => check(...)))` → REJECTED. Also local `const setTimeout = …`, and with stdlib `verifyPassword` (probes2/n1 schedShadowLambda, n3 schedShadowLambdaNoArgs/schedShadowLocal, n4 stdSchedShadowTop/stdSchedShadowLocal). SPEC §13.2 (SPEC.md ~:10311) requires fail-closed when the file binds the scheduler name in ANY form — quote the sentence in progress.md.
Root: two readers decide "is the global scheduler" by name — `async-combinators.ts` `KNOWN_DISCARD_HOF`/`isKnownDiscardHofCall` (shadow check against `declaredNames` misses file-scope functions and function-local consts) and `fn-valued-bindings.ts` `asyncValueUsesIn` (own `SCHEDULERS` set, no shadow check). **ROOT FIX:** ONE shared predicate built on the file's real binding set (every declaration form, every scope that can shadow — file-scope fn/const/let/import, function-local, params), used by both; any binding of the name anywhere in scope → NOT the global scheduler (fail closed).

**MED-C — direct client call of an async top-level arrow binding refused (REGRESSION).** `const persist = (v) => save(v)` + `onclick={ persist("x") }` (reviewer `cl2/app.scrml`), and a block arrow doing `@n = loadCount()` (`cl3`). Base compiled+ran; branch → E-ASYNC-FN-ESCAPES-AS-VALUE at 1:1. §13.2: an async function "MAY be called directly". Fix: colour the client copy of the binding so a direct call is awaited (preferred). If that is not achievable this round, keep the refusal but with its own accurate message + the binding's span, and say so.

**MED-D — legal sync function values in server code newly refused.** `function (a, s = ")") {…}`, `(a, k = (x) => x) => {…}`, `(a, s = "=>") => {…}` (top level / inside a server fn) → E-CODEGEN-INVALID-LOGIC "could not read it" + stray `<fn-value>` stderr warning. Root: `splitFnValueText` (first `=>`, paren counting without string skipping) + `emitServerFnValueFromText` (rejects heads with quotes or `>`, regex param names). Fix: take head/params/body from the expression parser's node — no text re-read (Rule 7: don't ask the text what the tree already knows). probes2/n6.mjs, n5.mjs split*.

**LOW:** `runLambda` refused with E-ASYNC-STDLIB-IN-SYNC-CALLBACK where SPEC names E-ASYNC-FN-ESCAPES-AS-VALUE — fix the code choice if trivial.

## Acceptance (do NOT report DONE without all of it)
- Re-run the FULL reviewer probe set on your final tip: `probes/s1–s14` + `probes/pa-verify.mjs` + `probes2/n1–n8` (333 shapes). Wrong passwords accepted: MUST be 0. Report the table. Also MED-C cl2/cl3 run correctly; MED-D shapes run.
- Add regression tests pinning HIGH-A (all 6 libFnDecl shapes), HIGH-B (all 5), MED-C, MED-D into the s465 test files.
- Corpus differential base (`f7b7310bf`, detached tree under `.claude/worktrees/`, symlinked node_modules) vs your tip over `examples/ samples/ conformance/`: newly failing must be 0 (report emit-only diffs).
- Gates: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`; `bun scripts/types-gate.ts --check`; bootstrap slice (`bun scripts/lint-no-default-arm.js && bun test ./compiler/self-host-v2/slice-m1/ ./compiler/self-host-v2/slice-m2/ ./compiler/self-host-v2/slice-m3/ ./compiler/self-host-v2/slice-m4/ ./compiler/self-host-v2/slice-codec/`); `bun test compiler/tests/lsp compiler/tests/commands`; `bun test compiler/tests/*.test.js`; `bun scripts/facts.ts --check`; `bun scripts/state.ts --check`; `bun run scripts/regen-spec-index.ts --check`; `bun scripts/corpus-compile-floor.ts --check`; `bun scripts/host-global-scan.ts --check`.
- Residual position holes you could NOT close by the root fix: file each as a gap in `docs/known-gaps.md` (locus=, prov=review:s466-await-r6) and regen `bun scripts/state.ts --write`.
- Push: `git push origin HEAD:s465-await-r5` (fast-forward; if rejected, fetch+merge, never force). Do NOT open a PR.

## Report (short)
Worktree; final SHA; for each finding: root cause confirmed/refined + what changed (file:symbol); list of removed second readers; probe table (old/new, accepted counts); corpus diff; gate lines; residual gaps filed.
