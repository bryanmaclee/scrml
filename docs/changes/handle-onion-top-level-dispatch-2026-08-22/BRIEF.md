# BRIEF — handle-onion-top-level-dispatch-2026-08-22

> Archived verbatim at dispatch time.

Implement a ratified operator ruling: **`handle()` is a literal onion.** Change-id: `handle-onion-top-level-dispatch-2026-08-22`.

## 0. SETUP

```
git fetch origin
git checkout -B handle-onion-top-level-dispatch origin/main    # main is a0e30329 and MOVES — re-fetch before you finish
git log --oneline -3
```

⚑ **A sibling operator lands on `main` continuously.** Rebase or merge before you push; **never file-delta** a shared file. Generated docs (`docs/FACTS.md`, `compiler/SPEC-INDEX.md`) → regenerate after the last content commit, never hand-merge.

**Discipline:** commit and push after EVERY item; never `--no-verify` or override `core.hooksPath`; write only inside your worktree; do not touch `handOffs/*`, `master-list.md`, `hand-off.md`. Create `docs/changes/handle-onion-top-level-dispatch-2026-08-22/progress.md` and archive this brief verbatim as `BRIEF.md` beside it. ⚑ A `(fail) <name>` here may be a **timeout**, not an assertion — re-run in isolation before believing it.

## 1. ⭐ THE RULING (banked, delta-log `[1677]`)

> **`handle()` PRE wraps ALL top-level dispatch.** Every request enters `handle()` first; only `resolve()` proceeds to route → static → 404. Custom-path interception inside `handle()` — an `if (url.pathname == …) return Response` with **no author `route=`** — is **within contract**.

**This is a conformance fix, not a widening.** The SPEC already says it three times; the implementation is non-conformant:
- **§40.3 Trigger-8** — *"a server-executing onion-model interceptor, not a route … woven into the request pipeline"*
- **§39.3 (`SPEC.md:22652`)** — *"`handle()` MAY return a response directly without calling `resolve()`. This short-circuits the pipeline and prevents the route handler from running."*
- **§61.8 (`SPEC.md:36077`)** — *"`handle()` is the **global, untyped** raw escape (**it sees every request** as a raw `request`) … the interim raw escape for an untypeable per-path need."*

Do **not** re-litigate the §12.3 `route=` carve-out: it governs *naming and observability* of author-declared foreign-facing URLs, not dispatch, and the operator ruled it never opposed the onion.

## 2. THE DEFECT — PA-verified by execution

`emit-server.ts:~3558` and `:~4407` apply the body via `_scrml_mw_wrap(handlerName)` **per route handler**. Both dispatchers only invoke a handler on a **registered-route match** — the single-file WinterCG `fetch()` aggregate, and the production `Bun.serve` fetch in `compiler/src/commands/build.js`. So a `handle()` PRE short-circuit for any path that is not already a registered route is unreachable.

**Measured on a `handle()`-only program (no sibling route):**
```
_scrml_mw_wrap   defined at line 43, called ZERO times
fetch export     absent
routes           absent
file             60 lines — the middleware is 100% dead code
```

## 3. WHAT TO BUILD

Wrap the **top-level dispatcher** in the onion, in **both** emitters:
- the emitted single-file `fetch()` aggregate (`emit-server.ts`)
- the production `Bun.serve` fetch (`compiler/src/commands/build.js`)

Required shape: `handle()` PRE runs for **every** request → if it returns a `Response` without calling `resolve()`, that response is served and routing never happens → if it calls `resolve(request)`, dispatch proceeds to route match → static file → 404, and `handle()` POST (code after `resolve()`) still runs on the way out.

**Determine and report, do not assume:**
- What `resolve(request)` must return so POST-middleware composes — today's per-route wrap gives it a route handler's result; at top level it must be the *whole* downstream dispatch including static-file and 404.
- Whether the per-route `_scrml_mw_wrap` call sites should be **removed** once the top-level wrap exists. Double-wrapping would run PRE twice per request. **Verify by execution which sites remain reachable**, and say what you removed and why.
- A `handle()`-only program must now emit a real dispatcher. Today it emits none.
- Interaction with the cookie/session wrapper the comment at `emit-server.ts:~4393` calls *"OUTERMOST (around any `_scrml_mw_wrap`)"* — the onion moving up may change what outermost means. Report the resulting order.

## 4. VERIFICATION BAR

- **Two-sided bite proof.** The adopter shape must 404 before and serve after:
  ```scrml
  function handle(request, resolve) {
    const url = new URL(request.url)
    if (url.pathname == "/quote.pdf") { return new Response("PDF", { status: 200 }) }
    return resolve(request)
  }
  ```
- **Execute, don't grep.** Import the emitted `fetch` (and drive `build.js`'s server) and hit: an intercepted custom path; a registered route (must still work, and POST-middleware must still run); a static file; an unmatched path (must still 404 **through** the onion); and a `handle()`-only program with no routes at all.
- **PRE must run exactly once per request.** Prove it with an observable side effect (a counter or header), not by reading the emitted source.
- **Regression floor:** compile the corpus on both trees and report diagnostic-code deltas. Every source with a `handle()` gets its emitted server **diffed and explained**. Extract any base tree completely (`git archive` + real/symlinked `node_modules`; verify `stdlib/` present) — a missing `stdlib/` makes every `scrml:` import fail and reads as a large regression.
- Run `bun conformance/run.ts`, the middleware/handle/route test files, and — **if you touch any §34 row** — `bun scripts/s34-census.ts --check-new --base origin/main` after your last SPEC edit.
- ⚑ Fresh worktrees lack gitignored build artifacts — rule that ENV-GAP out before calling a failure a regression.

## 5. SPEC

The SPEC text is already correct and does **not** need amending for the ruling. If you find a section that describes the *per-route* behaviour as intended, that is a defect in the text — report it, do not silently rewrite it.

## 6. NOT YOURS

- **Whether `protect=` / auth coverage extends to `handle()`-served paths.** The operator has that as an open question. Your fix makes those paths reachable, which makes the question live — **report what you observe** about whether a protected column can now reach a `handle()`-served response, but do **not** build a gate for it.
- `docs/known-gaps.md` — the entry `g-handle-onion-applied-per-route-not-top-level-custom-paths-404` is PA-owned; note your resolution in `progress.md` and the PA will flip it.

## 7. DELIVERABLE

Push and report: branch + final SHA; what you changed in each dispatcher; what `resolve()` returns now; whether per-route wraps were removed and the evidence; the five executed scenarios with output; the PRE-runs-once proof; the regression floor with every `handle()`-bearing source explained; and anything you observed about protected columns reaching a `handle()`-served response.
