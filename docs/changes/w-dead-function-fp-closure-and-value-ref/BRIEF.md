# BRIEF — W-DEAD-FUNCTION false positives (adopter issue #195)

change-id: `w-dead-function-fp-closure-and-value-ref`
dispatched: 2026-07-26 (S289-peter / AdiPDesk) · agent: general-purpose (iso worktree, opus)
DONE-PROBE: `bun test compiler/tests/unit/route-inference.test.js` green with the new cases + control cases + the server-placement regression guard.

## The bug (adopter issue #195, filed by pjoliver11 — Peter's lane)

`W-DEAD-FUNCTION` (§12.2 Trigger 6) fires two classes of FALSE POSITIVE. Both reproduce on HEAD
(`97182dfb`). Warning-only (nothing miscompiles — the tree-shaker `usage-analyzer.ts` already keeps
these functions; only the `route-inference.ts` dead-warn walk has the blind spots), but acting on the
warning deletes live code (it would have removed 5 live functions from the adopter's real app).

- **Case 1 — call inside a NESTED CLOSURE body.** A function whose only call site is inside an arrow
  (`=>`) or `function`-expression body within a reachable function is flagged dead:
  ```
  function usedInLambda(x) { return x * 2 }
  function sortIt(list) { return list.slice().sort((a, b) => usedInLambda(a) - usedInLambda(b)) }
  ```
  `usedInLambda` → false W-DEAD-FUNCTION.
- **Case 2 — function passed as a FIRST-CLASS VALUE** (referenced, never called at a direct call site):
  ```
  function usedAsValue() { @tick = @tick + 1 }
  function arm() { setTimeout(usedAsValue, 10) }
  ```
  `usedAsValue` → false W-DEAD-FUNCTION. Same class: `el.onscroll = fn`, `addEventListener("x", fn)`,
  `[fn1, fn2]`, `{ handler: fn }`, `arr.map(fn)`, `fn` in a ternary/return.

## Root cause (already diagnosed — DO NOT re-derive from scratch, verify then fix)

The D4 dead-warn walk in `compiler/src/route-inference.ts` (the emit block ~line 4660-4714, gated at
~line 4701) decides "dead" from `inverseCallerMap` (built ~line 4161-4169 from `record.callees`).
`record.callees` comes from `exprNodeCollectCallees` → `forEachCallInExprNode`
(`compiler/src/expression-parser.ts`), which:
- **line ~4170 `case "lambda": return;`** — never descends into arrow/`function`-expression bodies → Case 1.
- records **only `call.callee` idents** — a bare fn-name passed as an argument/value is never a call
  node, so it is never counted as a use → Case 2.

## THE FIX — additive, dead-code-reachability ONLY

Build a NEW suppression set in `route-inference.ts` (parallel to the existing `markupReferencedNames`
at ~line 4405), call it e.g. `logicReferencedFnNames`, mapping fn-name → Set<enclosing-fn-nodeId>:
collect every function name that is **referenced from reachable logic** — as a call callee OR as a
bare value-reference (`ident`) — while **descending into nested closure bodies** (arrow lambdas AND
`function`-expression bodies), attributed to the enclosing function it was found in.

Then add ONE suppression term to the D4 gate (line ~4701):
```
const isLogicReferenced =
  logicReferencedFnNames.has(fnName) &&
  Array.from(logicReferencedFnNames.get(fnName)!).some(id => id !== fnNodeId); // non-self, mirrors hasCallers
```
and add `&& !isLogicReferenced` to the `if (...)` that fires the warning.

Implementation freedom: descend structurally where the closure body is a walkable ExprNode (arrow
`lambda.body`); for opaque/raw closure or `function`-expression bodies, an IDENT_RE string scan over
the raw body text is acceptable and matches the existing `markupReferencedNames` philosophy
(over-inclusive → only ever SUPPRESSES an advisory warning → the safe direction; see the comment at
route-inference.ts ~line 4426-4428). Whatever mechanism you pick, the test suite below is the gate.

### HARD CONSTRAINT (the load-bearing scoping rule — read twice)

**DO NOT modify `exprNodeCollectCallees`, `forEachCallInExprNode`, `record.callees`, or
`inverseCallerMap`.** Those are SHARED — they also drive server-placement inference (Step 5c
caller-context propagation, route-inference.ts ~line 4195) and E-ROUTE-001. Broadening them to descend
into closures would silently change §12.2 server/client placement (spec-implicating, OUT OF SCOPE for
this warning-only bug, and a real regression risk — e.g. a server-only helper called inside a client
`.sort()` comparator). The fix is a NEW dead-code-only reference set + ONE gate term. Nothing else.

### Bug-CLASS coverage (not just the 2 reported shapes)

The fix must suppress the false warning for the WHOLE class, and must NOT over-suppress:
- SUPPRESS (no W-DEAD): call inside an arrow body; call inside a `function`-expression body; fn passed
  as a call argument (`setTimeout(fn, 10)`); fn assigned (`el.onscroll = fn`); fn in an array literal;
  fn as an object-property value; fn in a ternary branch; fn as a return value.
- STILL FIRE (controls — must NOT be masked): a genuinely-unreferenced function; a function that calls
  ONLY itself (self-recursive-only); a function referenced ONLY by itself as a value
  (`function f(){ setTimeout(f, 10) }` with no external caller).

## SPEC edit (co-located, per Peter's ruling S289) — `compiler/SPEC.md` §12.2 Trigger 6, line ~7148

Amend the enumerated non-dead forms + name closure-descent. Change the sentence beginning
"A function declared but called from neither a server-classified context..." to:

> A function declared but called from neither a server-classified context nor a client-classified
> context, not exported, not server-annotated, not referenced from markup, and **not referenced as a
> first-class value from reachable logic** (passed as a call argument, assigned, stored in an
> array/object, or otherwise named without being called — a bare function reference keeps it reachable
> and un-tree-shakeable), SHALL fire `W-DEAD-FUNCTION` at its declaration site (§34). A call or
> reference located **inside a nested closure body (an arrow `=>` or `function` expression) within a
> reachable function counts as a use** — reachability descends into nested closure scopes. The
> function will be tree-shaken from the output.

Do NOT regenerate SPEC-INDEX line ranges unless the net line delta is non-trivial; if you must, run
`bun run scripts/regen-spec-index.ts`. This is a prose clarification (no new §34 code, no behavior
change beyond the warning suppression), so no §34 catalog row is added.

## TESTS — `compiler/tests/unit/route-inference.test.js` (the W-DEAD-FUNCTION home)

Add a describe block. Compile each fixture through the real pipeline (mirror the existing
route-inference.test.js patterns) and assert on the W-DEAD-FUNCTION warnings:
1. Case 1 — fn called only in an arrow body → NO W-DEAD for it.
2. Case 1b — fn called only in a `function`-expression body → NO W-DEAD.
3. Case 1c — real-app shape `.sort((a,b) => cmp(a,b))` → NO W-DEAD for `cmp`.
4. Case 2 — `setTimeout(fn, 10)` → NO W-DEAD for `fn`.
5. Case 2b — `el.onscroll = fn`, `[fn]`, `{h: fn}`, ternary `c ? fn : other` → NO W-DEAD.
6. Control — genuinely-dead fn → STILL W-DEAD.
7. Control — self-recursive-only fn → STILL W-DEAD.
8. Control — self-value-ref-only fn → STILL W-DEAD.
9. **Server-placement regression guard** — a helper with a server-only trigger (e.g. a `?{}` SQL read)
   that is called ONLY inside a client-context arrow keeps its CURRENT placement classification
   (verify the fix did not leak into Step 5c / `record.callees`). Assert placement is unchanged from
   HEAD behavior.

## EXECUTED verification (do this, paste the output into progress.md)

Compile this exact fixture on your post-fix build and confirm `usedInLambda` + `usedAsValue` NO LONGER
warn, and `trulyDead` STILL warns:
```
<tick> = 0
<rows> = [3, 1, 2]

function usedInLambda(x) { return x * 2 }
function sortIt(list) {
  const copy = list.slice()
  return copy.sort((a, b) => usedInLambda(a) - usedInLambda(b))
}
function usedAsValue() { @tick = @tick + 1 }
function arm() { setTimeout(usedAsValue, 10) }

function trulyDead(z) { return z + 1 }

<button onclick=arm()>arm</button>
<div>${sortIt(@rows).join(",")}</div>
<div>${@tick}</div>
```
Compile: `bun compiler/bin/scrml.js compile <that-file>.scrml --output-dir /tmp/o` and grep for
`W-DEAD-FUNCTION`. Expected AFTER fix: exactly ONE W-DEAD-FUNCTION, for `trulyDead`.

## STARTUP + PATH DISCIPLINE (worktree isolation — AdiPDesk / Windows)

1. FIRST action: confirm your CWD is your assigned worktree (a path containing
   `\.claude\worktrees\agent-`). If it is the main checkout
   (`C:\Users\poliv\Documents\GitHub\scrml` with NO `worktrees\agent-` segment), STOP and report — do
   not write.
2. `bun install` in the worktree (worktrees do NOT inherit `node_modules`; the test run fails with
   "cannot find package 'acorn'" otherwise).
3. Edit ONLY files under your worktree root, using worktree-absolute paths. Do NOT `cd` into the main
   checkout.
4. Targeted gate: `bun test compiler/tests/unit/route-inference.test.js` (this is the DONE-PROBE). Also
   run `bun test compiler/tests/unit/usage-analyzer.test.js` + `compiler/tests/unit/endpoint-private-arm-reachability.test.js`
   (sibling dead-code/reachability suites) to catch any regression. You do NOT need the full suite
   (this machine's full-suite baseline has ~11 pre-existing lift/each + ~8 integration fails unrelated
   to this change; the Linux cloud gate is the authority).
5. Commit after each meaningful change (WIP commits fine) + keep an append-only `progress.md`
   (timestamped: what was done, what's next, blockers). The branch + progress.md are the recovery
   anchor.

## Files you will touch
- `compiler/src/route-inference.ts` (the fix — additive set + gate term)
- `compiler/SPEC.md` §12.2 Trigger 6 (the 1-line clarification)
- `compiler/tests/unit/route-inference.test.js` (the new describe block)
- (only if net SPEC line delta is non-trivial) `compiler/SPEC-INDEX.md` via `regen-spec-index.ts`

## Return in your final message
- Branch name + final commit SHA.
- Files touched (exact paths).
- The route-inference.test.js run result (pass/fail counts).
- The executed-verification grep output (the compile of the fixture above).
- Confirmation you did NOT modify `exprNodeCollectCallees` / `forEachCallInExprNode` / `record.callees`
  / `inverseCallerMap` (the hard constraint), and the server-placement regression-guard test result.
- Any shape you were unsure about (so the PA adversarial review can probe it).
