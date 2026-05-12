# Pre-Snapshot: fix-lift-async-iife-paren

Recorded 2026-05-11 before any code changes.

## Test Baseline (`bun test`)
- 11463 pass / 77 skip / 1 todo / 0 fail (38105 expect calls, 14.71s)

## E2E Compile Baseline (`examples/dist/*.client.js`)
- 15 client.js pass `new Function()` parse
- 6 client.js FAIL:
  - `07-admin-dashboard.client.js` — `Cannot use the undeclared label 'emit'.` (pre-existing, NOT this bug)
  - `05-multi-step-form.client.js` — `Unexpected token ':'` (pre-existing, NOT this bug)
  - `21-navigation.client.js` — `Unexpected token '.'` (pre-existing, NOT this bug)
  - **`18-state-authority.client.js` — `Unexpected token ';'. Expected ')' to end a compound expression.` ← THIS BUG**
  - `13-worker.client.js` — `Unexpected token ':'` (pre-existing, NOT this bug)
  - `12-snippets-slots.client.js` — `Unexpected token '<'` (pre-existing, NOT this bug)

## Expected after fix
- 16 client.js pass (18 fixed, others unchanged)
- 5 client.js FAIL (all pre-existing, unrelated to this bug)

## Bug Site Identification

`compiler/src/codegen/emit-client.ts` lines 825-900 — GITI-001 string-rewrite of
`_scrml_reactive_set("name", _scrml_fetch_X(args));` → `(async () => ...)();`

Root cause: the rewrite assumes statement context (always appends trailing `;`)
but the `_scrml_reactive_set(...)` it matches can also appear in expression context,
specifically when wrapped inside `(async () => { try { el.textContent = await (${rewrittenExpr}); ...})()`
at `compiler/src/codegen/emit-event-wiring.ts:854-855`.

When the inner `rewrittenExpr` is itself an `@var = serverFn()` assignment, the
expression form `_scrml_reactive_set("var", _scrml_fetch_X(args))` is correctly
emitted. Then GITI-001's regex finds it and adds the IIFE wrapper plus a trailing
`;`, producing `await ((async () => _scrml_reactive_set(...))();)` — the `;)`
sequence is invalid JS.

## Misnaming note

The original bug ticket called this "lift+async malformed syntax" because the
example involves `lift <li>` in a `for` loop. But the malformed `(async () => ...)();)`
pattern is NOT actually emitted by lift codegen — it's emitted by GITI-001 inside
the reactive display wiring (`emit-event-wiring.ts:826,854,855`) where a server-fn
call appears inside an `await (...)` expression. The lift in the example is a
red herring — the bug site is elsewhere.

## Tags
#tag-pipeline-pre-snapshot #tag-s84 #tag-fix-lift-async-iife-paren #tag-bug

## Links
- WORKTREE: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a6d4c9846d3a1877c
- BUG SITE: /home/bryan/scrmlMaster/scrmlTS/compiler/src/codegen/emit-client.ts:825-900
- SYMPTOM SITE: /home/bryan/scrmlMaster/scrmlTS/compiler/src/codegen/emit-event-wiring.ts:820-862
- EXAMPLE: /home/bryan/scrmlMaster/scrmlTS/examples/18-state-authority.scrml
- COMPILED OUTPUT (broken): /home/bryan/scrmlMaster/scrmlTS/examples/dist/18-state-authority.client.js line 159
