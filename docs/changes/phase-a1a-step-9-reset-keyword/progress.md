# Phase A1a Step 9 — `reset(@cell)` keyword expression parsing — Progress

Branch: `phase-a1a-step-9-reset-keyword`
Parent baseline HEAD: `556de93` (a1a-step-7 pinned bareword on imports)
Test baseline: 8,804 pass / 43 skip / 0 fail / 8,847 across 436 files.

## Survey notes

[12:18 step-9 startup-verify] Worktree clean, pretest run, baseline `bun run test`
re-run after a single ECONNREFUSED flake → confirmed 8,804 pass / 43 skip / 0 fail.
Branch created.

[12:20 step-9 survey-tokenizer] `reset` confirmed in `tokenizer.ts` line 70 KEYWORDS
set (Step 1 wiring intact). KEYWORD distinction is consulted only by the scrml
**block-level** tokenizer; the **expression-parser** uses acorn directly, which
treats `reset` as a plain JS identifier (no special token kind).

[12:20 step-9 survey-expression-parser] `compiler/src/expression-parser.ts` exists
(104 KB / ~2500 LOC). Architecture:
  - `parseExpression` (line 264) wraps acorn with two scrml plugins (`scrmlAtPlugin`
    for `@ident`, `scrmlEnumPlugin` for `Type::Variant`).
  - `parseExprToNode` (line 1290) is the top-level entry point.
  - `esTreeToExprNode` (line 843) converts ESTree → scrml ExprNode.
  - `CallExpression` case at line 1057.
  - There is NO hand-rolled primary-expression dispatcher — acorn does the parsing,
    we transform after.
  - Existing precedent for KEYWORD-as-identifier transforms in `Identifier` case
    (line 853): `not` → null literal; `__scrml_input_*__` → `input-state-ref`;
    `__scrml_sql_placeholder__` → `sql-ref`. The CallExpression case at lines
    1063-1095 already special-cases scrml synthetic placeholder calls
    (`__scrml_is_not_not__`, `__scrml_is_some__`, `__scrml_match__`, etc.). This is
    EXACTLY the precedent shape Step 9 follows for `reset(...)`.

[12:20 step-9 survey-current-behavior] Verified via `bun -e ...`: today
`reset(@count)` parses to `{ kind: "call", callee: { kind: "ident", name: "reset" },
args: [{ kind: "ident", name: "@count" }] }`. Just a regular call — the `reset`
KEYWORD reservation is irrelevant inside acorn's parse.

[12:20 step-9 survey-spec] SPEC §6.8.2 (line 4843+) is canonical. SPEC §34 line 14199
already has `E-RESET-NO-ARG` defined:
  > `E-RESET-NO-ARG | §6.8 | reset() called with no argument. The reset keyword
  > requires an explicit cell argument: reset(@cell) or reset(@compound.field). | Error`
  No `E-RESET-ARITY` exists. Decision: REUSE `E-RESET-NO-ARG` for both zero-arg AND
  multi-arg with adjusted message. Rationale: a single error code keeps surface area
  small; the spec text already covers the broader intent ("requires an explicit cell
  argument") and the diagnostic message can be variant per the actual count. The
  error class name "NO-ARG" is mildly inaccurate for the multi-arg case but the
  semantic — "wrong arity for reset" — is the same. We'll widen the §34 wording to
  cover both shapes in a follow-up SPEC tweak if needed; current entry is acceptable
  for both conditions.

[12:20 step-9 survey-existing-skeleton] No `reset-expr` skeleton exists in
ast.ts, expression-parser.ts, or ast-builder.js. Step 9 is greenfield for the AST
node kind.

[12:20 step-9 survey-existing-tests] Existing usages of `reset(...)` in test corpus:
  - `compiler/tests/unit/tokenizer-reset-keyword.test.js` — Step 1 lexer tests
    (verifies `reset` tokenizes as KEYWORD).
  - `compiler/tests/integration/parse-shapes-v0next.test.js` line 73 — Step 8 test
    that `function reset() {}` triggers E-RESERVED-IDENTIFIER (decl-site shadow).
  - `compiler/tests/unit/transition-decl-ast.test.js` line 68 — `< A> reset() => < B>`
    transition-decl. NOT through expression-parser; uses signature-text scan in
    ast-builder lines 1311+. Safe.
  - `compiler/tests/unit/stdlib-{auth,store}.test.js` — `limiter.reset(...)` and
    `c.reset(...)` member calls. Callee is MemberExpression, not Identifier;
    bypasses the new branch. Safe.

  Net regression risk: NONE for existing reset-as-method/transition-name uses.

[12:20 step-9 survey-error-surfacing] Diagnostic surfacing pattern: F-SQL-001 is the
precedent (`expression-parser.ts:329-1336`, `ast-builder.js:166-173`). The
ExprNode-conversion produces an EscapeHatchExpr carrying `sqlDiagnostic: { code,
message, offset }`; `safeParseExprToNodeGlobal` (ast-builder.js:166) checks for
`node.kind === "escape-hatch" && node.sqlDiagnostic` and pushes a TABError into the
`errors` array. **Strategy for Step 9: mirror this pattern.** A malformed
`reset(...)` call (zero-arg or multi-arg) returns a `kind: "reset-expr"` node with
an attached `diagnostic: { code: "E-RESET-NO-ARG", message: "..." }` field, and
`safeParseExprToNodeGlobal` (and its closure-scoped sibling) recognise + surface it.

  Optional refinement to consider: instead of attaching diagnostic to a
  `reset-expr`, we could go EscapeHatchExpr-style. Decided against: the AST should
  carry semantic intent ("this WAS a reset call"). A1b can still typecheck the
  target; the diagnostic doesn't change the node shape.

## Plan

1. Extend `compiler/src/types/ast.ts`: add `ResetExpr` interface, add to `ExprNode` union.
2. Modify `compiler/src/expression-parser.ts` `esTreeToExprNode` `CallExpression` case
   (line 1057): detect `callee.type === "Identifier" && callee.name === "reset"`.
   Distinguish three sub-cases by `rawArgs.length`:
     - `=== 1` → emit `{ kind: "reset-expr", target: <converted arg>, span }`
     - `=== 0` → emit `{ kind: "reset-expr", target: <ident "undefined" placeholder>,
       span, diagnostic: { code: "E-RESET-NO-ARG", message: "..." } }`
     - `>= 2` → emit `{ kind: "reset-expr", target: <converted first arg>, span,
       diagnostic: { code: "E-RESET-NO-ARG", message: "reset(...) accepts exactly
       one argument; got N" } }`
3. Update `safeParseExprToNodeGlobal` in `ast-builder.js` to surface `reset-expr`
   diagnostic into the errors array (mirror F-SQL-001 path).
4. Walk through other ExprNode-walk helpers (`forEachIdentInExprNode`, `walk`, etc.)
   in expression-parser.ts to ensure `reset-expr` traversal works (treat it as a
   container for `target`).
5. Add tests at `compiler/tests/integration/parse-reset-keyword.test.js`.
6. Run full `bun run test`. Confirm 0 regressions.

## Implementation log

[12:30 step-9 ast-types] `compiler/src/types/ast.ts` — added `ResetExpr` interface
(kind: "reset-expr", target: ExprNode, span, optional diagnostic field) and
appended `ResetExpr` to the `ExprNode` union. Diagnostic-on-the-node mirrors
F-SQL-001's pattern (EscapeHatchExpr.sqlDiagnostic). Cross-references: §6.8.2,
§34, AST-CONTRACTS-AND-DECOMPOSITION.md §1.3.
