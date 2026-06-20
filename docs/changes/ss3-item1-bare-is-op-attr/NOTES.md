# ss3 item1 — `g-attr-bare-compound-is-op-silent-drop`

**Branch:** `spa/ss3` · **Direction:** RATIFIED S209 (user 'b') — REJECT-with-parens (limit-not-widen).

## Bug (R26 reproduced on HEAD db906e40)

A bare-compound is-op in an unquoted CONDITION attribute (`if=` / `show=` /
`else-if=`) silently dropped the keyword run and emitted plain truthiness — no
diagnostic. For `is not` this was also an **inversion**:

```scrml
<p if=getUser() is not>...</>     // emitted: if ((_scrml_getUser_8()))   ← truthiness, absence check DROPPED + INVERTED
<p if=getUser() is some>...</>    // emitted: if ((_scrml_getUser_8()))   ← is some dropped
<p if=(getUser() is not)>...</>   // CONTROL — correct: ... === null || === undefined
```

`is` / `is not` / `is some` / `is not not` were absent from the cluster-A
operator set (`attrConditionOperatorAhead`), so the bare form never became an
`ATTR_OP_REJECT` token and `E-ATTR-UNQUOTED-OPERATOR` never fired.

**Two paths affected** (the call path was a wider latent gap):
- **ident path** (`if=@n is not`): reached the operator-reject branch but the
  keyword ops weren't in the op-set.
- **call path** (`if=fn() is not`): the `ATTR_CALL` emit committed *first* in the
  branch chain and never reached the operator-reject check at all — so it
  silently dropped **every** trailing operator, e.g. `if=fn() && @m` too.

## Fix (`compiler/src/tokenizer.ts`)

1. `attrConditionOperatorAhead` — add the keyword is-operators to the op-set:
   `/^(?:is[ \t]+not[ \t]+not|is[ \t]+some|is[ \t]+not)\b/` (longest-match-first;
   whole-word `is` guarded by the mandatory separator + `\b`, so `island` /
   `isReady` are not mis-matched).
2. Extract the reject-capture loop into a shared `pushConditionOpReject` helper
   and call it from BOTH the bare-ident path and the call path. The call branch
   now checks `isConditionAttrName && attrConditionOperatorAhead` after reading
   the args and rejects `fn(args) <op> <rhs>` instead of emitting a bare
   `ATTR_CALL`.

No message change — the existing diagnostic names the operator and steers to
`if=(expr)` / `if="expr"`, which reads correctly for keyword ops.

## Verify

- R26: bare ident/call `is not`/`is some`/`is not not` + bare `fn() && @m` all
  fire `E-ATTR-UNQUOTED-OPERATOR` once; paren/quoted forms stay clean and lower
  correctly (`=== null || === undefined` / `!== null && !== undefined`).
- No false positives: `@isReady` → E-SCOPE-001 (undeclared), not the reject.
- Tests: `attr-unquoted-operator-reject.test.js` 31→51 pass (+20). Full suite
  24677 pass / 0 fail (after building the gitignored `samples/.../dist/` — the
  S209-ss9 fresh-worktree env-gap, not a regression).
