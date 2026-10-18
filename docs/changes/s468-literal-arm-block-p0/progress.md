# progress — s468-literal-arm-block-p0 (append-only)

- 2026-10-17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a6812cf6b2096749e, branch s468-literal-arm-block-p0 from origin/main bbddfd7b9. bun install: puppeteer postinstall exit 1 (browser download; non-blocking for unit/integration). pretest OK.

## 2026-10-17 — reproduce (main bbddfd7b9)

- Reproducer family (55 shapes; final file = compiler/tests/integration/security-await-pack/shapes/la1.js), driven by the
  reviewer's `drive.mjs` against this worktree at bbddfd7b9: **29 FAIL** (wrong password -> 200 "WELCOME"), 10 PASS,
  6 PASS-500, 2 PASS-DENY, 8 PASS-REFUSED. Every reviewer FAIL shape reproduces (matchArmInF, matchArmNestedFnIf,
  matchArmInFLet, matchArmInFLetDecl, matchArmInFObj, strArm, strArmColon, boolArm, strArmObj, matchNumArmIfOnly).
- Sweep beyond the review (all FAIL on main): `'bob' :>`, `"bob" ->`, `false :>`, `-1 :>`, `0x1F :>`, `1.5 :>`,
  `1 | 2 :>`, `"al" | "bob" :>`, `true | false :>`, `_ :> {`, `.A | .B :> {` (variant alternation!), a literal arm
  inside a C-for loop, value-position `const ok = match n { 1 :> { const g = check … } }`, `return match` with a
  literal block arm, and — a second limb — SINGLE-EXPRESSION literal / alternation arms: `1 :> drive(check, …)`,
  `1 | 2 :>`, `true :>`, `.A | .B :>` (FAIL once `drive` is reachable; otherwise PASS-500 only because `drive`
  was never emitted — reachability did not see the call either).
- `::A :> { … }` (the §18.2 `::` alias with a block body): PASS-DENY — the arm NEVER matched (silent miscompile).
- AST dump (reviewer's ast.mjs, then my dump.mjs): literal / alternation / `_` / `::V` arm with `{` body =
  `bare-expr { expr: <whole arm text>, exprNode: <the literal only> }`.

## Locus — hypothesis HELD (refined)

Traced: `parseMatchBodyWithArity` -> `parseRecursiveBody` -> the statement parser's arm forms (ast-builder.js
Forms 1/1b/2/3 = `.V {`, `.V(…) {`, `else {`, `not {`; Inline Forms 1–5). No form for any other head, so the
default path's `collectExpr` kept the arm as text (the S465 r3 arm-level hold at ~:14254 keeps the
expression view = the literal). Downstream, every analysis that walks nodes (F4 local-async-fns /
fn-valued-bindings, E-ERROR-002, reachability / peer harvest, scope, E-MU-001) saw only the literal;
codegen re-parsed the text (S465 `structureServerArm`) so DIRECT calls were awaited, but an alias / HOF
was not refused. Refinement: the same root covers single-expression literal / alternation arms, the `_`
block arm, the variant-alternation block arm and the `::V` block arm, not only literal blocks.

## Governing sentences

- §18.2 grammar: `match-arm ::= arm-pattern (':>' | '=>' | '->') arm-body` · `arm-body ::= expression |
  block-body | leave-stmt` · `block-body ::= '{' statement* expression? '}'`; §18.16.1 `arm-pattern ::=
  variant-pattern | literal-arm-pattern | wildcard-arm | is-pattern`. A literal arm's body is a block of
  STATEMENTS exactly as a variant arm's is — nothing in §18 makes it text.
- §18.5: "An arm body SHALL be a single expression, a `{ }` block, or a single leave statement".
- §13.2 (SPEC.md:10318): "An async-colored function SHALL NOT be used as a value. It MAY be called directly
  (the compiler awaits the call) … Passing it to any other function …, aliasing it, storing it in an array or
  object … SHALL be a compile error (`E-ASYNC-FN-ESCAPES-AS-VALUE`)."
- §13.9.6 (SPEC.md:11113): "An async-colored function (§13.2) SHALL be bound only by a `function` declaration".
- §18.2: "An alternation containing a wildcard alternate (`_` / `else`) is the wildcard arm."
- §42.2.3 (SPEC.md:32129): "The old form `(x) =>` is removed from the language. Any source file using `(x) =>`
  as a presence guard SHALL be a compile error (E-SYNTAX-043)."

## Fix (the root: the parser)

- ast-builder.js: `readArmHead` (token reader over the existing `scanArmPatternAlternate` grammar);
  **Form 4** — at a match body's ARM level, any head chain (`armPatternChainArrowOffset`) + arrow + `{` that is
  not owned by Forms 1–3 → `match-arm-block` with `parseRecursiveBody()` body and the head recorded:
  `literals` (JS source per alternate), `alternates` (variant alternation), `isWildcard` (`_`, or an
  alternation holding `_`/`else`), `variant` (single `::V`), `pattern` (as written). **Inline Form 6** — the
  same heads with a single-expression body → `match-arm-inline` (`test`, `literals`/`alternates`, `result`,
  `resultExpr`). Forms 1/1b accept the `::` prefix. Not taken (text path unchanged): a head mixing literal and
  variant alternates; an alternation alternate with a payload binding (E-MATCH-ALT-BINDING owns it).
- codegen: ONE block-arm reader `matchArmBlockToMatchArm` (emit-control-flow.ts) used by the statement /
  IIFE lowering, the decl lowering (emit-logic.ts) and meta-eval; `_matchArmInlineToMatchArm` reads
  `literals` / `alternates` first. emitMatchExprDecl: an object-literal block arm is a VALUE
  (pre-existing E-CODEGEN-INVALID-LOGIC for `.A :> { x: 1 }` in library decl position, now reached by
  literal arms too).
- type-system.ts: exhaustiveness (`extractArmsFromMatchNode`) and the SQL-match head list count every
  variant alternate; a literal arm records an `unknown` pattern (as the inline string arm always did);
  W-MATCH-ARROW-LEGACY labels a Form 4/6 arm by its `pattern`.
- No text scan added. No regex over source in a post-AST stage added (the arm head is read from tokens in
  the parser; the existing `parseMatchArm` text reader is untouched and now reached only by heads Forms 4/6
  decline and by expression-parser `rawArms`).
