# A1b B9 — Phase 0 SURVEY findings

Branch: `phase-a1b-step-b9-validator-arg-exprnode`.
Baseline commit: `e557e30` (S66 close, post-`0cc5632`).

## Decision

**PROCEED.** No STOP trigger fired. All survey preconditions clean.

## Confirmed preconditions

### (a) Step 5 preserves `null` vs `[]` vs `[...]` distinction

Source: `compiler/src/ast-builder.js:3594-3608` in `scanStructuralDeclLookahead()`.

Bareword path (no parens):
```js
validators.push({ name: validatorName, args: null, span: validatorStart });
```

Call-form path (parens):
```js
const argRaw = argTexts.join(" ").trim();
validators.push({
  name: validatorName,
  args: argRaw.length > 0 ? [argRaw] : [],
  span: { ...validatorStart, end: lastTok.span.end },
});
```

Distinction:
- `<x req>` → `args: null` (bareword)
- `<x req()>` → `args: []` (zero-arg call)
- `<x length(>=2)>` → `args: [">= 2"]` (single element, raw joined)

**Note:** call-form ALWAYS produces a single-element array of joined raw text — Step 5 does NOT split on commas. So `length(>=2)` and `pattern(/^x$/)` both arrive as a single-element raw string. B9's parser must dispatch on predicate name to decide whether to split on commas or treat as single relational-predicate.

### (b) Expression-parser handles all standard forms

Probed via `tmp-probe-b9.mjs`:

| Input | Result | Notes |
|---|---|---|
| `[.Admin, .Editor]` | `array` { elements: [ident(".Admin"), ident(".Editor")] } | S66 bare-dot fix works |
| `@signup.password` | `member` { object: ident("@signup"), property: "password" } | @-prefix on base ident |
| `/^[^@]+@[^@]+$/` | `escape-hatch` { estreeType: "Literal", raw: "/.../" } | Regex falls into BigInt/exotic branch in esTreeToExprNode (line 937). Raw preserved. |
| `18` | `lit` (number) | clean |
| `@startDate` | `ident("@startDate")` | clean |
| `.Idle` | `ident(".Idle")` | bare-variant clean |
| `>=2` | `escape-hatch` { estreeType: "ParseError" } | EXPECTED — confirms relational-form sub-grammar needed |
| `@startDate.plus(1, "day")` | `call` { callee: member, args: [lit, lit] } | works for §55.11 worked example |
| `@a + @b` | `binary` { op: "+" } | works |
| `true` | `lit` (bool) | clean |

### (c) IdentExpr walker registry — extension surface

`forEachIdentInExprNode` lives at `compiler/src/expression-parser.ts:2200-2389`. Discriminated `switch (node.kind)` with a `_never` exhaustiveness check at the default arm.

Sister walkers also exhaustive-checked with new union member additions required:
- `exprNodeContainsCall` (line 2411-2468)
- `exprNodeCollectCallees` (line 2477) — uses `forEachCallInExprNode`
- `forEachCallInExprNode` (line 2489)
- `forEachResetExprInExprNode` (line 2538)
- `exprNodeContainsReactiveRef` (line 2600) — uses forEachIdentInExprNode internally; no extension
- `exprNodeContainsAssignment` (line 2614)

Plus `emitStringFromTree` (line 1501) for round-trip emit support.

**Decision:** RelationalPredicateNode is NOT added to the `ExprNode` union — it is a sibling AST kind appearing only inside `ValidatorEntry.args`. This minimises the walker-registry surface area: callers walk validator args via a new B9-introduced helper that knows about the union, OR validator-args are walked directly using a special-cased arm only in `forEachIdentInExprNode` (the only walker B7's dep-tracker uses on validator-arg expressions).

This is the minimal-blast-radius approach: extend `forEachIdentInExprNode` with knowledge of the relational-predicate node, so B7's dep-tracker can walk through `.value`, but DON'T expand the ExprNode discriminated union (which would force changes in 7+ exhaustive walkers).

### (d) B7 dep-graph integration — clean

`compiler/src/dependency-graph.ts:218-256` collects reactive refs by calling `forEachIdentInExprNode` on standard exprNode fields. No validator-specific code today.

Going forward, if `validators[].args` contains ExprNodes (or RelationalPredicateNode-wrapped ExprNodes), and `forEachIdentInExprNode` walks RelationalPredicateNode.value, then dep-tracking through validator args will work transitively when B10 or a follow-up phase wires `validators` into the collected exprNodeFields list.

## Step 5 args content — investigation note

Step 5 stores call-form args as a SINGLE joined raw string (`argTexts.join(" ").trim()`), not split per-arg. This means:
- `length(>=2)` → `args: [">= 2"]`
- `pattern("[a-z]+")` → `args: ['"[a-z]+"']`
- `oneOf([.Admin, .Editor])` → `args: ['[ .Admin , .Editor ]']`
- `eq(@signup.password)` → `args: ['@signup.password']`

Per §55.1 + §55.11, all universal-core predicates take exactly ONE argument (when in call-form). So single-element-array is fine. B9's parser does not need to split on commas — the inner array literal IS the argument.

The only multi-element semantics in §55.1 worked examples are:
- `oneOf([.Admin, .Editor])` — the `[.Admin, .Editor]` IS the argument, an ArrayExpr.
- `length(>=2)` — `>=2` is the argument, a relational-predicate node.

So `args: ExprNode[]` is conceptually `[singleArg]` with one element except in the bareword case.

## Implementation plan (phases 1-7)

1. Define `RelationalPredicateNode` interface in `compiler/src/types/ast.ts`. NOT in ExprNode union — sibling type. Update `ValidatorEntry.args` type to `(ExprNode | RelationalPredicateNode)[] | null`.

2. New module `compiler/src/validator-arg-parser.ts` exporting `parseValidatorArg(name, rawArg, span, filePath, offset)` that:
   - dispatches on `name`: `"length"` → relational-predicate parsing; everything else → standard expression parsing.
   - relational-form: regex-strip leading `<rel-op>`, parse remainder via `parseExprToNode`, build RelationalPredicateNode.
   - standard form: directly delegate to `parseExprToNode`.
   - returns the node; never throws.

3. Wire into `ast-builder.js` — add post-scan transform: for each validator entry whose `args` is non-null and non-empty, parse via `parseValidatorArg` and replace.

4. Extend `forEachIdentInExprNode` in expression-parser.ts to recognise `kind: "relational-predicate"` and walk `.value`. (Plus a small standalone helper `forEachIdentInValidatorArg` for clarity.) Document the asymmetry: relational-predicate is NOT an ExprNode kind for typing purposes, but the walker recognises it for dep-graph traversal.

5. Tests in `compiler/tests/unit/validator-arg-parsing.test.js`:
   - 14 universal-core predicates from §55.1 (one happy-path each)
   - `args: null` (bareword) preservation
   - `args: []` (zero-arg call) preservation
   - relational forms: `length(>=2)`, `length(<=10)`, `length(<5)`, `length(>0)`, `length(=N)`, `length(!=0)`
   - bare-variant array: `oneOf([.Admin, .Editor])`
   - cross-field: `eq(@signup.password)`, `gte(@startDate.plus(1, "day"))`
   - regex: `pattern(/^.../)`
   - numeric: `min(18)`, `max(120)`
   - dep-walker: assert relational-predicate.value identifiers are visited

6. Update `docs/PA-SCRML-PRIMER.md` §13.7 with B9 row.

7. Update existing `parse-shapes-v0next.test.js` tests that read `args[0]` as raw string — those that were testing intermediate Step 5 shape need to be updated to read structured ExprNodes (this is part of the migration; pre-existing tests must reflect new contract).

## Cost estimate update

Survey-discount applies — preconditions cleaner than expected (especially expr-parser bare-dot/@-prefix coverage). Estimating ~3-4h actual vs 4-6h budget.
