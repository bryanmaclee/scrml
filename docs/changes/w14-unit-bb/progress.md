# Progress: Wave 14 Unit BB — compound assign + ++/-- for @x reactive vars

- Branch: `worktree-agent-a6636478297dd055b` (live commits land on main per `feedback_commit_to_main.md`)
- Worktree: `/home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a6636478297dd055b`
- Final SHA: 590eec36

## SPEC scope

- §6.1.2 (lines 1958-1975): canonical compound assign forms — `@varname += 1`, `@varname -= delta`, etc.
- §5.2.3 line 1385: bare-form event handler — `onclick=@count++` (post-inc/dec at handler position)
- §50.13 line 22686: SPEC enumerates `+=`, `-=`, `*=`, `/=`, `%=` as the canonical compound-assign set; compound-as-expression deferred; bitwise compound not mentioned.

## Bugs fixed

**Bug A — tokenizer missing `++`/`--` in MULTI_OPS** (compiler/src/tokenizer.ts).
- `MULTI_OPS` did not list `++` or `--`. They lexed as two single-char PUNCT `+` tokens.
- `joinWithNewlines` in ast-builder reassembled source with a space between adjacent tokens on the same line: `@x + +`.
- Acorn rejected `@x + +`, escape-hatch was emitted, regex pipeline produced broken JS `_scrml_reactive_get("x") + +`.
- Fix: added `"++"` and `"--"` to MULTI_OPS.
- **emit-expr.ts second part of Bug A:** Once the tokenizer produced a single `++` token, codegen produced `_scrml_reactive_get("x")++` — still invalid JS (++ requires lvalue, not the return value of a call). Fix in `emitUnary`: when the postfix target is a reactive `@x`, lower to `_scrml_reactive_set("x", _scrml_reactive_get("x") + 1)`. Server boundary: `_scrml_body["x"]++` is a valid member expression, emit as-is.

**Bug B/C — collectExpr's depth-0 assignment-boundary check missed OPERATOR tokens** (compiler/src/ast-builder.js).
- The existing check at line 2521 only recognized PUNCT `=` as a statement boundary signal after AT_IDENT.
- Compound assigns (`+=`, `-=`, `*=`, `/=`, `%=`) and postfix updates (`++`, `--`) tokenize as OPERATOR (multi-char), not PUNCT.
- Result: a state-decl RHS like `<x> = 0` followed by a newline-separated `@y += 1` greedily swallowed the second statement into the first decl's init string (`init: "0\n@y += 1"`). parseExprToNode reduced the init to LitExpr(0); the @y compound write was silently dropped. Same root cause for Bug C (multi-line).
- Fix: added a parallel `isCompoundOrUpdate` check using a `COMPOUND_OPS` set, gated on `tok.kind === "AT_IDENT"`.

## Out-of-scope decisions

- Bitwise compounds (`<<=`, `>>=`, `&=`, `|=`, `^=`, `>>>=`, `**=`, `&&=`, `||=`, `??=`): NOT in SPEC §50.13; deferred.
- Pre-inc/dec (`++@x`, `--@x`): NOT in SPEC §50.13 nor §5; deferred. SPEC §5 line 1385 explicitly enumerates `@count++` (postfix). Negative test documents the deferred behavior.

## Native parser

Tested with `--parser=scrml-native` — native parser drops EVERY statement in `<program>` body (including `<x> = 0`), not just compound forms. This is the M5-swap residual gap (tracked in `docs/changes/m5-c2-gap-ledger/phase5-triage-2026-05-22.md`), NOT something this unit can fix. Native is opt-in; the live pipeline (default) is correct. Filed as out-of-scope for Unit BB.

The native parser's expression catalog DOES handle compound assigns + ++/-- (parseAssignmentExpr, parseUpdate in `parse-expr.js`). The translate-stmt bridge passes the native ExprNode verbatim into the live `bare-expr.exprNode` field — but the native expr shape (`{kind: "Assignment", target: {kind: "AtCell"}}`) is uppercase/distinct from the live shape (`{kind: "assign", target: {kind: "ident", name: "@x"}}`), and emit-expr.ts doesn't recognize it. A separate M5 unit would need to wire `translate-expr.js` into `parse-file.js`'s bare-expr assembly path.

## Coordination with Wave 14 Unit AA

AA fixed W-LINT-013 false-positive on bare `@x = 5` at statement position. AA's territory was lint suppression; mine extends to actual statement parsing for compound + postfix forms. No coordination conflict; tests do not require W-LINT-013-suppression annotations.

## Tests added

`compiler/tests/unit/reactive-compound-assign-and-postfix.test.js` — 22 tests, 76 expect() calls.

Coverage matrix:
  - 7 operators (`+=`, `-=`, `*=`, `/=`, `%=`, `++`, `--`)
  - 4 positions (inside `${}` function body / bare at program body / arrow handler / bare-form event handler attr)
  - reactive trigger semantics (compound write fires same setter as `@x = @x + 1`; postfix fires setter not bare `++`)
  - negative test for prefix update (deferred-scope lock)

## Test counts

| Stage | Pre | Post |
|---|---|---|
| Baseline (pre-Bug-A) | 13849 pass / 0 fail | — |
| After Bug A fix | 13852 pass / 0 fail | 13852 pass / 0 fail |
| After Bug B/C fix | — | 13852 pass / 0 fail |
| After adding tests | — | 13874 pass / 0 fail (+22 new) |

## Final E2E verification

```scrml
<program>
  <x> = 0
  @x += 1
  @x -= 2
  @x *= 3
  @x /= 4
  @x %= 5
  @x++
  @x--
</>
```

Output (all 7 forms emit correct `_scrml_reactive_set` calls):
```js
_scrml_reactive_set("x", _scrml_reactive_get("x") + 1);
_scrml_reactive_set("x", _scrml_reactive_get("x") - 2);
_scrml_reactive_set("x", _scrml_reactive_get("x") * 3);
_scrml_reactive_set("x", _scrml_reactive_get("x") / 4);
_scrml_reactive_set("x", _scrml_reactive_get("x") % 5);
_scrml_reactive_set("x", _scrml_reactive_get("x") + 1);  // @x++
_scrml_reactive_set("x", _scrml_reactive_get("x") - 1);  // @x--
```

`node --check` passes on all 13 sample compilations.
