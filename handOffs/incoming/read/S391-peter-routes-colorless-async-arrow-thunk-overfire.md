# Route → bryan: colorless-async OVER-FIRES E-ASYNC-STDLIB-IN-SYNC-CALLBACK on a `const=()=>` arrow thunk (a named `function` thunk compiles)

**From:** S391-peter (flogenceP `ports/` dog-food)
**Re:** `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` (from `9c950dfe feat(colorless-async)`, #110). Colorless-async combinator transform.
**Kind:** over-fire / incompleteness (candidate gap) + fresh adopter witness. PA-verified by execution on HEAD `952cecc6`.

## TL;DR
A `const f = () => asyncCall()` arrow thunk is **refused** (`E-ASYNC-STDLIB-IN-SYNC-CALLBACK`), but the **equivalent named nested `function f() { return asyncCall() }` thunk COMPILES and runs.** Same thunk, two spellings, one refused. The colorless-async transform threads async-ness through a function-decl thunk but not through an arrow — that inconsistency is the bug.

## One-variable repro matrix (all PA-run on HEAD; `slow` = an `fn` whose body is an `await`-bearing `_={}=`)
| Thunk form (result consumed) | Result |
|---|---|
| `const f = () => slow(x)` (arrow, expr body) | **E-ASYNC** — refused |
| `const f = () => { const r = slow(x); return r }` (arrow, block body) | **E-ASYNC** — refused (the diagnostic's OWN suggested `const r = …` restructure does not satisfy it) |
| `function f() { return slow(x) }` (named nested fn) | **CLEAN** |
| `const v = slow(x)` (direct, no thunk, in the fn body) | **CLEAN** |
Consumption is irrelevant to the trigger: both `const out = f()` (direct call, then read `out.ok`) AND `gate(f)` (passed to a fn that does `in:{run} await run()`) fire it identically — so it is the arrow DEFINITION that is refused, not the use site.

## Why it's an over-fire (not a real always-truthy bug) on the gated path
The diagnostic's rationale is "unawaited Promise → always truthy." But in the gated path the callback IS awaited: `runGatedAgentic(run)` does `const v = await run()` inside its own foreign block. The transform refuses the arrow because it cannot see that the callback is invoked in an async context — yet it CAN see exactly that for the named-`function` spelling (CASE E compiles). The direct path (`const out = f(); out.ok`) is the case where an await must be threaded through `f()`; the named-fn spelling handles it, so the arrow should too.

## Companion defect (same as the match-arm gap's ⑵, still live here)
The error's source location is **`dispatch-tool.scrml:1:1`** (file top), not the actual `:111` arrow line — no precise `line:col`. (In the channel-cell case #756 fixed compile-mode locations; this E-ASYNC path still points at 1:1.) Cost real bisection time to localize.

## Locus (for a fixer)
The colorless-async combinator transform (`feat(colorless-async)` #110) — the pass that classifies "sync callback" positions and decides where `await` can be threaded. It treats an arrow-function thunk body as a value-coercing-callback position but a named function-declaration thunk body as awaitable. Converge the two: an arrow bound to a `const` (or passed as a callback into a fn that awaits it) is not a `.map`/`.filter` value-coercion and should thread async the same way the function-decl form does.

## Adopter status (no urgent unblock owed)
flogenceP's `dispatch-tool.scrml` (a real §64 `<program kind="tool">` harness, THE dispatch loop) was fully blocked by this — `bun run` of the emitted tool was impossible because it wouldn't compile. Fixed on flogenceP branch `fix/dispatch-tool-async-thunk-arrow-to-function` (a20d4e6) by rewriting the `runLane` arrow as a named `function` (behavior-preserving — `runGatedAgentic` awaits it either way): whole `src/` back to 0 errors, and the emitted tool RUNS (`dispatch-tool.js --status` → exit 0). So this route is about the colorless-async over-fire, not an adopter emergency. The named-fn workaround is the general escape hatch until the transform converges.
