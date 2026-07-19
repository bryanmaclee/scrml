# BRIEF — GITI-038: async color in a returned NAMED function expression (Row 1 transform + Defect 2)

Dispatched S271 (bryan), 2026-07-19. Baseline main `9c950dfe`. Agent: `scrml-js-codegen-engineer`, `isolation:"worktree"`, model opus, background.

This file is the verbatim dispatch prompt (archival per pa-scrml-overlay `{{archive_brief_fills}}`).

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its Task-Shape Routing for a codegen/compiler-source change (`structure.map.md`, `dependencies.map.md`, `build.map.md`). Maps are stamped **commit `99ae45ca`** (2026-07-18) — HEAD is `9c950dfe`. **STALENESS WARNING:** the async-emission surface you are editing (`emit-library.ts`, `emit-library-shared.ts`, `async-combinators.ts`, `scheduling.ts`, `emit-logic.ts`) was heavily changed by PR #108 (colorless-async Seam-A Phase-1) and #110 (Phase-2 combinator) AFTER the map stamp. Treat the maps as navigation hypothesis only for that surface; the exact loci below are current-truth (verified against `9c950dfe` by a fresh in-memory reproduction). Report any map/source divergence you hit (load-bearing or not).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST action: `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report (wrong-repo allocation).
2. Confirm `git rev-parse --show-toplevel` equals the worktree root; confirm a clean tree.
3. `bun install` (worktrees do NOT inherit `node_modules` — the hook fails "cannot find package 'acorn'" otherwise).
4. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/` browser-test fixtures; ~130 ECONNREFUSED-shaped fails without it). Use `bun run test` (chains pretest) for baselines, NOT `bun test` directly.
5. If a fresh worktree lacks gitignored `dist/`, symlink from main (ENV-GAP, not a regression).
6. Every Read/Write/Edit uses a worktree-ABSOLUTE path under the worktree root. NEVER `cd` into the main checkout; use `--cwd "$WORKTREE_ROOT"` for `bun` and `git -C "$WORKTREE_ROOT"`. First commit message: `WIP(giti-038): start at $(pwd)`.
7. Commit after EVERY meaningful edit (WIP commits expected) + keep an append-only `progress.md` (timestamped: what was just done, what's next, blockers). The branch + progress.md are your crash-recovery anchor.

---

## THE BUG (GITI-038, P1 — a hole in the Phase-1 no-silent-leak guarantee)

A scrml library-mode compile of a factory that RETURNS a named function expression whose body contains an async-colored `safeCallAsync(...) !{}` failable **miscompiles silently** (exit-0, `node --check` clean, wrong runtime).

SOURCE:
```
${
    import { safeCall, safeCallAsync } from "scrml:host"
    export function composeFail(handlers) {
        return function dispatch(req) {
            const r = safeCallAsync(() => handlers[0](req)) !{
                | ::Thrown(msg) :> ({ __err: msg })
            }
            return r
        }
    }
}
```

EMITTED (WRONG, `9c950dfe --mode library`):
```js
export async function composeFail(handlers) {   // ← async wrongly on the OUTER factory
  return;                                        // ← return value DROPPED
  async function dispatch(req) { ... await safeCallAsync ... }   // ← hoisted, orphaned, unreachable
}
```
Runtime: `composeFail([...])` → `Promise{undefined}`; `await` it → `undefined`; calling the result → `TypeError: not a function`. (Empirically confirmed by executing the emitted bundle.)

REQUIRED EMIT (the target — verify by executing the bundle, not just grepping):
```js
export function composeFail(handlers) {          // ← OUTER stays NON-async
  return async function dispatch(req) {          // ← returned fn-expr, async, INLINE in return position
    let _scrml__scrml_result_1 = await safeCallAsync(() => handlers[0](req));
    if (_scrml__scrml_result_1 && _scrml__scrml_result_1.__scrml_error) {
      if (_scrml__scrml_result_1.variant === "Thrown") { const msg = _scrml__scrml_result_1.data; _scrml__scrml_result_1 = {__err: msg}; }
      else { return _scrml__scrml_result_1; }
    }
    var r = _scrml__scrml_result_1;
    return r;
  };
}
```
Runtime target: `composeFail(handlers)` returns a FUNCTION (not a Promise); `await dispatch(req)` yields the result; `dispatch` is `async`.

## THE TWO DEFECTS + EXACT LOCI (current-truth, verified on `9c950dfe`)

**Shared root:** library mode emits each top-level fn VERBATIM from source (already `!{}`-lowered); only **async-colored** fns are pulled out of verbatim and re-emitted from AST (`emit-library.ts:452-483`, filter `asyncFnNames.has(fn.name)`). The parser ALWAYS mis-splits `return function name(){…}` into an emptied `return;` + a sibling `function-decl` (latent — invisible on the verbatim path). **Defect 2 routes `composeFail` into AST re-emission, where the latent split (Defect 1) becomes visible.**

**DEFECT 2 — async color over-propagates to the enclosing factory.**
- `collectCalleeIdents` (`compiler/src/codegen/emit-library-shared.ts:66-80`) recurses through EVERY object key (`:75-79`) with NO nested-function boundary guard → it collects `safeCallAsync` (which lives in `dispatch`'s body) into `composeFail`'s callee set → `callsStdlibPromise(callees)` true at `:148` → `composeFail` colored async.
- The correct sibling that HAS the guard: `scheduling.ts:173-178` `hasServerCallees` "deliberately does NOT descend into nested function-decl / lambda / sync-callback bodies."
- **BLAST-RADIUS CONSTRAINT (do not break #110's combinator):** a BLUNT "stop descending" breaks the Phase-2 combinator — a fn whose body does `xs.map(x => safeCallAsync(x))` is CORRECTLY colored async today *because* this walk descends into the callback lambda (the combinator transform awaits the mapped Promises). The fix must be POSITION-AWARE: descend into a lambda that is a **callback-arg of a call awaited in this body**, but NOT into a function that is a **returned / assigned / bound function VALUE** (that value has its OWN async scope).

**DEFECT 1 — returned function EXPRESSION hoisted to a declaration + `return` emptied.**
- Parser root: `compiler/src/ast-builder.js:8288-8296` — `RETURN_DECL_KW = {const,let,type,function,fn}`; when the token after `return` is `function`/`fn`, it emits a bare `return-stmt{expr:""}` and does NOT consume `function`, so `function dispatch(){…}` parses as the NEXT statement (a nested `function-decl`). Gap acknowledged at `:8868-8873`. NOTE: `return const/let/type` are genuinely invalid, but `return function name(){}` is a VALID function expression — the heuristic is wrong to strip it.
- Emit surfacing: `emit-logic.ts:2653-2659` (empty `return;`) + `:3811-3862` (`case "function-decl"` hoist; async kw at `:3851-3854`), reached via `emit-library-shared.ts:476-505` → `emit-logic.ts:3917-3943`.

## THE CRITICAL ROUTING SUBTLETY (read twice — the naive fix creates a NEW silent bug)

Await-insertion for the inner `dispatch` happens ONLY in the AST re-emission path. So if you fix Defect 2 such that `composeFail` is no longer in `asyncFnNames`, `composeFail` falls back to the VERBATIM path — and the inner `dispatch` would then emit WITHOUT `async`/`await` → `safeCallAsync` returns an unawaited Promise → the `!{}` check runs on a Promise (always truthy, `.__scrml_error` undefined) → a DIFFERENT silent miscompile.

Therefore the classifier must separate **two distinct questions**:
1. **Does THIS function need `async` on its OWN signature?** — true iff its OWN DIRECT body (excluding nested returned/assigned function values) awaits an async call. `composeFail` → NO; `dispatch` → YES.
2. **Does THIS function need AST re-emission?** — true iff it, OR any nested function it contains, needs async transformation. `composeFail` → YES (it contains `dispatch`, which must be transformed).

`composeFail` must be ROUTED to re-emission (so `dispatch` gets transformed) but emitted with NO `async` on its own signature; the returned `function dispatch` must be emitted as an INLINE `return async function dispatch(){…}` expression (not hoisted, not drop-return), with `dispatch` correctly `async`+`await`. Nested named functions containing async calls are async in THEIR scope only; that async-ness does NOT propagate to an enclosing function that merely returns/holds them.

## RULING + SCOPE BOUNDARY (bryan, S271 — hard constraints)

- **Transform, right direction** — the compiler owns the wiring; a returned async closure is a natural shape, NOT something the developer restructures around (S259 thesis-integrity ruling). Emit it correctly.
- **IN SCOPE:** the NAMED function expression returned (or assigned/bound then returned) whose body is STRUCTURALLY parsed (`function-decl`). That is the shape GITI-038 actually hits.
- **OUT OF SCOPE — DO NOT TOUCH:** arrow forms (`return (req)=>{…}`) and anonymous-function-expression forms (`const d = function(){…}; return d`). Those are stored as **escape-hatch raw text** — the compiler cannot lower ANY scrml construct inside them today (proven: even the SYNC `safeCall(...) !{}` inside an arrow/anon-fn-expr body fires `E-CODEGEN-INVALID-LOGIC`). They stay FAIL-CLOSED via `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`. Making them transform is a separate feature arc (structural closure-body lowering), filed as a follow-on. Your fix MUST NOT regress their current fail-closed behavior.
- **PRESERVE the fail-closed backstop** (`collectNonAwaitableAsyncCalls`, `emit-library-shared.ts:360-464`) for genuinely host-constrained positions: `.sort` callbacks, parameter defaults, raw escape-hatch bodies, AND the arrow/anon-fn-expr closures above.
- **PRESERVE #110's combinator coloring:** `xs.some/every/find/filter/map/forEach/reduce/flatMap(asyncFn)` must still color the enclosing async fn and transform correctly.

## INVARIANTS (all MUST hold — this is the acceptance contract)

1. `composeFail` → OUTER not `async`; inner `dispatch` `async`; return preserved (returns the function); `!{}` lowered. Execute the bundle: `composeFail(handlers)` returns a function; `await dispatch(req)` returns the value; NO Promise leak.
2. Controls `composeOkSync` (sync `safeCall`) + `composeOkBare` (bare call) → UNCHANGED (still correct).
3. A legitimately-async outer fn that ALSO returns a named fn-expr (outer awaits something in its OWN body AND `return function inner(){…}`) → outer `async`, return PRESERVED (this exercises Defect 1's independent latent half; construct this case yourself).
4. `xs.map(x => safeCallAsync(x))` inside a fn body → enclosing fn still colored async, combinator transform intact.
5. Arrow + const-bound async-closure forms → still FAIL-CLOSED with `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` (unchanged).
6. Full suite green (`bun run test`); pre-commit gate green. Add unit coverage in the async-emission test file + a fixture for the giti repro shape.

## VERIFICATION (in-agent, MANDATORY before reporting DONE)

- **R26 empirical:** compile the giti repro (reproduced below as `repro35.scrml`) with `bun compiler/bin/scrml.js compile <f> --mode library` on your post-fix baseline; then EXECUTE the emitted `repro35.js` via a small node driver (import `composeFail`, assert it returns a FUNCTION not a Promise, assert `await dispatch("x")` works). Grepping the emitted text is NOT sufficient — the recurring "emitted ≠ runs" lesson; execute the bundle.
- Run the full test suite; record pass/fail counts.
- Do NOT mark DONE without: invariants 1-6 all verified + the executed-bundle runtime witness for invariant 1.

## THE REPRO (write to `<worktree>/repro35.scrml`)

```
${
    import { safeCall, safeCallAsync } from "scrml:host"
    export function composeFail(handlers) {
        return function dispatch(req) {
            const r = safeCallAsync(() => handlers[0](req)) !{
                | ::Thrown(msg) :> ({ __err: msg })
            }
            return r
        }
    }
    export function composeOkSync(handlers) {
        return function dispatchSync(req) {
            const r = safeCall(() => handlers[0](req)) !{
                | ::Thrown(msg) :> ({ __err: msg })
            }
            return r
        }
    }
    export function composeOkBare(handlers) {
        return function dispatchBare(req) {
            const r = handlers[0](req)
            return r
        }
    }
}
```

## REPORT BACK

Workspace path (pwd), final commit SHA, files-touched list, the emitted `composeFail` (verbatim), the executed-bundle runtime witness, full-suite counts, and any deferred items. The PA runs an independent S239 adversarial `/code-review high` on your diff before landing (you cannot run it in-agent) — expect a possible fix round.
