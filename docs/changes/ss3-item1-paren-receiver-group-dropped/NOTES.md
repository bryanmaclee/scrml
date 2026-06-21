# ss3 item1 — g-paren-binary-group-dropped-before-method

**Branch:** `spa/ss3` · **Mode:** sPA-direct · **Base:** 8c27805e (= origin/main)

## Bug (R26-reproduced, HEAD 8c27805e)

`(a + " " + b).toUpperCase()` emitted as `a + " " + b.toUpperCase()` in the
**CLIENT** codegen path — the grouping parens around a parenthesized binary
expression in **member/method/index/call receiver position** were dropped, so the
method/index/call re-associates onto the last operand. Silent precedence
miscompile: green compile, `node --check` clean. Killed a flogence TF-IDF router
(repro `handOffs/incoming/read/2026-06-20-from-flogence-BUG-paren-grouping-dropped-before-method.md`).

Path-sensitive: **LIBRARY** mode emitted correctly (verbatim string copy); only
the ExprNode-serializer (client) path dropped the parens. Acorn discards source
ParenthesizedExpression nodes (no `preserveParens`), so `(a+b).m()` parses to
`Call(Member(Binary(a+b), m))` and the un-guarded receiver printer flattens it.

## Fix

Receiver-position sibling of **Bug W** (binary-OPERAND paren guard) and **S205
g-emit-string-tree-paren-drop** (the round-trip twin). Member/index/call/new all
bind tighter than every operator, so a receiver/callee whose top form is a
looser-binding operator (binary · ternary · assign · unary · arrow) must be
re-wrapped.

- `compiler/src/codegen/emit-expr.ts` — added `receiverNeedsParens` +
  `emitReceiver`; applied at `emitMember` (obj), `emitIndex` (obj), `emitCall`
  (callee), `emitNew` (callee). This is THE reproduced locus.
- `compiler/src/expression-parser.ts` — same gap in the `emitStringFromTree`
  round-trip printer (`member`/`index`/`call`/`new` cases); added
  `receiverNeedsParensRT` + `emitReceiverRT` (kind-match, not `exprPrec`, because
  `exprPrec` lumps `unary` in with the atomics at 99).

Primaries (idents · literals · array/object literals · member/call/index/new
chains) gain NO parens; is-op binaries already self-bracket so the extra wrap is
harmless-redundant, never wrong.

## Verification

- R26 value-assert: client `(a + " " + b).toUpperCase()`, library path still
  correct, `(a + b)[c]`, `(a ? b : a)()` all keep parens; `arr.map(...)`,
  `obj.a.b`, `s.trim()`, `[1,2].length` gain NO spurious parens.
- New tests: `compiler/tests/integration/g-paren-receiver-group-dropped.test.js`
  (§1 printer + §2 no-over-wrap + §3 e2e flogence repro) + receiver cases added
  to `compiler/tests/unit/emit-string-tree-precedence.test.js`.
- Full suite: 24692 pass / 0 fail (clean run; a first run showed 2 flaky
  timing-effect fails that did not reproduce).

## PA residual

`emitStringFromTree`'s receiver fix is defense-in-depth — the reproduced bug is
emit-expr.ts (client). No empirical miscompile was found through the
`emitStringFromTree` path, but it carried the identical gap in the same
serializer cluster, so it was closed with the same fix shape.
