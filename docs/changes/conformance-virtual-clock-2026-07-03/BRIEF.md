# BRIEF — conformance virtual clock (Track-B Phase 1): `fake-clock.ts` + the `advance-time` verb (S235, 2026-07-03)

change-id: `conformance-virtual-clock-2026-07-03`. Base: main HEAD `cfa5303e`. Agent: `abc1db95`.

## MISSION
Build the conformance suite's VIRTUAL CLOCK so timer-dependent surfaces (`<onTimeout>` §51.0.M, `<onIdle>` §51.0.R, debounce/throttle §6.13, engine-temporal §51.12) become conformance-testable. The `{"advance-time": ms}` driver verb is a **RATIFIED normative language-1.0 conformance contract verb** (user-ratified S235 — impl#2 must honor it; the contract adopts a virtual-clock model). Deliverable: a deterministic fake clock + the verb, with the existing 69 cases still green and ≥1 new timer case proving it works.

## PRECISE SCOPE (verified loci — a survey mapped these; confirm against live code first)
The conformance harness: `conformance/adapters/impl1-ts.ts` `run()` (L280-339) evals `SCRML_RUNTIME + clientJs + CONFORMANCE_SHIM` in a single IIFE (L317) inside a happy-dom global env installed by `GlobalRegistrator.register()` (L287). Emitted timer code funnels through globals: `_scrml_machine_arm_timer`→`setTimeout` · onIdle watchdog · debounce `setTimeout` / throttle `Date.now`+`setTimeout` · `_scrml_timer_start`→`setInterval` · idle-prefetch `requestIdleCallback` (all `compiler/src/runtime-template.js`). `CONFORMANCE_SHIM.settled()` (impl1-ts.ts L153-159) itself does one microtask + one `setTimeout(…,0)` macrotask hop.

1. **NEW `conformance/fake-clock.ts`** (adapter-internal). Controller: virtual `now` + sorted `{id, fireAt, fn, intervalMs?}`.
   - `install()`: capture the REAL `setTimeout` first; override globalThis `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval`/`Date.now`/`requestIdleCallback`/`cancelIdleCallback`.
   - **delay===0 RULE (correctness-critical):** faked `setTimeout(fn,0)` (+ falsy/≤0 ms) passes through to the REAL `setTimeout` (task-queue ordering, not time) — keeps `settled()` working + drains 0-clamped debounce/throttle without `advance-time`. Only ms>0 (+ all intervals) go virtual.
   - `advance(ms)`: pop virtual timers with `fireAt<=now+ms` in fireAt order (set now per fire, re-arm intervals), `await` a microtask drain after each fire; finally `now=now+ms`.
   - `restore()`: restore all globals.
2. **impl1-ts.ts `run()`:** install after `GlobalRegistrator.register()` (L287), before the eval (L317); restore in `finally` (L334-338). Thread the clock into `driveInputs`.
3. **driver.ts:** `| { "advance-time": number }` in the `InputStep` union (L25-33) + an `applyInput` branch (L66) → `await clock.advance(...); await hook.settled();`. Thread through `driveInputs`(L122) + the run() call site (L327).
4. **run.ts:** verify no schema change (input flows; hasRuntimeHalf triggers on input).
5. **README.md:** document `advance-time` as a normative contract verb (impl#2 must honor; deterministic — ms>0 fires ONLY on advance-time).

## ACCEPTANCE
1. **69 cases stay GREEN** (`bun conformance/run.ts`) — the #1 regression risk (naive fake clock hangs settled via setTimeout(0); the delay===0 pass-through prevents it). PROVE it.
2. **≥1 NEW timer case** (engine `<onTimeout>` / onIdle / debounce): `"input":[{...},{"advance-time":N}]` fires deterministically; WITHOUT the verb it does NOT fire (determinism proof).
3. **Full `bun run test` GREEN** (the corpus-bridge runs in it).

## ADVERSARIAL (S215)
settled-drain (setTimeout(0) pass-through) · intervals re-arm across advances · clear on a virtual timer · Date.now determinism · restore-on-throw (finally).

## DO NOT
None of the other 7 harness extensions (multi-file/serverJs/DB/SSE/nav/worker/WS). ONLY the virtual clock + advance-time.

## STARTUP + PATH DISCIPLINE
Worktree under `.claude/worktrees/agent-<id>/`. `pwd`-verify (S90); `merge --ff-only main` (base cfa5303e); `bun install`; **`bun run pretest`** OR symlink `samples/compilation-tests/dist` from main (S209 — empty dist → ~130 ECONNREFUSED). Bash-edits on worktree-absolute paths; no Edit/Write, no main-rooted paths, no `cd` into main; first-commit `pwd` (S99). Commit `timeout:600000`; full `bun run test` green; report FINAL_SHA + acceptance + adversarial results.
