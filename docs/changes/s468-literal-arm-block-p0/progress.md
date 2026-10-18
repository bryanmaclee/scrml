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

## Direction of change + measured impact

- **Semantics-changed** for literal / alternation / `_` / `::V` arms: their bodies (block) and values (single
  expression) are now analysed by every stage. **Newly-rejecting** where the newly visible code breaks an
  existing rule; each rejection matches what the same code gets at function top level or in a `.V` arm:
  E-ASYNC-FN-ESCAPES-AS-VALUE (§13.2 / §13.9.6 — the P0), E-SWITCH-FORBIDDEN and the other §4 statement codes
  (client), E-MU-001, E-SYNTAX-043 (§42.2.3 `(x) :>` glued after a literal arm), E-MATCH-ARM-SEPARATOR (§18.2
  `,` after a literal arm), E-CODEGEN-INVALID-LOGIC for an aliased map bracket read (S415 limb 1, was silent
  `undefined`). **Newly-correct:** `::V :> { … }` now matches (was never taken); a `_ :> { … }` whole-product
  arm of a multi-scrutinee match is the wildcard (was a false E-TYPE-020 / dropped arm); a fresh name in a
  literal arm's block is the arm's own (was an unbound bare assignment); a same-file server peer called from a
  literal arm has its callable (was a 500); a nested `match` in a literal arm lowers (client + server).
- **Corpus, compiled** (`scripts/corpus-emit-differential.ts`, roots examples, samples, conformance, stdlib —
  2840 sources; base = `git archive bbddfd7b9`, head = the same + this branch's `compiler/src`):
  **0 newly failing, 0 newly passing** (failure SET identical, 1140 / 1140); 0 artifacts added / removed; 0
  syntax-goggle changes. After normalising the two compiler-root paths (`_scrml_project_root`), artifact
  content changed in exactly 3 sources — all conformance `match-block` cases with literal block arms, all
  formatting of the same statements (structured emit instead of re-tokenised text) plus one dead local
  (`let _scrml_tilde_N = o.n = 2;`) that the `.V` arm form already emits on base (pre-existing). Diagnostic
  CODE changes in 9 sources, none an error: 2 gain info-level W-MATCH-ARROW-LEGACY (literal arms written with
  `=>` / `->`) / W-EACH-PROMOTABLE (inside a now-visible literal arm); 7 LOSE a false W-DEAD-FUNCTION (a function
  called only from a top-level `0 -> f()` / `_ -> f()` arm — route-inference now reads `resultExpr`); text-only
  changes in 2 (W-TYPE-031 over the now-visible bodies). The tool's verdict line says INCOMPARABLE only because
  both sides are `git archive` trees with no revision to read. (Final capture = cd-head2, with the
  route-inference change; normalised artifact diff still exactly the 3 match-block sources above — the
  W-DEAD-FUNCTION scan widening moved no code placement.)
- **giti + flogence** (113 `.scrml`, each compiled alone with base and head): 0 error-code differences.
- **Real (non-test-fixture) sites newly refused: 0.** The two security-await-pack fixtures that moved
  (`y2/voMatch` PASS-500 → PASS-REFUSED, `z3/matchWrite` PASS → PASS-REFUSED) both use a `,` between arms
  (`match 1 { 1 => …, else => … }`), which §18.2 makes E-MATCH-ARM-SEPARATOR; they are test probes.

## Gate results

- security-await-pack classify, head (this worktree): PASS 271 · PASS-REFUSED 404 · PASS-500 16 · PASS-DENY 3 ·
  UNJUDGED 1 · **FAIL 0** · total 695. Base (640 shapes): FAIL 0. Per-shape over the shared 640: only the two
  `,`-separator fixtures above changed class. `la1` on base: 29 FAIL; on head: 9 PASS + 46 PASS-REFUSED.
- New unit file `compiler/tests/unit/s468-literal-arm-block-parsed.test.js`: 34 pass.
- `state.ts --check` PASS, `facts.ts --check` PASS (regenerated: gap counts MED 654 → 652; FACTS lines/test files).
- Pre-commit hook on the fix commit 12cd1f95a: 37504 pass · 125 skip · **0 fail** (1592 files).
- A dev-copy full run (git-archive tree) showed 44 failures, all environmental (no .git / benchmarks /
  docs/website in the archive); every failing file re-run in this worktree: 348 pass, 0 fail.

## Deferred (surfaced, not closed here)

- §18.19 PRODUCT arm `(p1, …, pN) :> { … }` still keeps its body as text: on the client a `switch` inside
  it ships raw (g-client-match-arm-text-body-skips-statement-checks-s465, now `narrowed`). Not a password
  hole — F4 already refuses product-arm aliases / HOF passes (prodBlockAlias … prodBlockHof PASS-REFUSED
  on base and fix).
- Expression-parser `rawArms` (a `match` nested inside a larger expression, e.g. `String(match n { … })`)
  keeps EVERY arm kind as text; analyses read it through text helpers (numArmArgMatchTest is refused,
  E-ASYNC-FN-ESCAPES-AS-VALUE + E-CODEGEN-INVALID-LOGIC, base and fix). Same one-reader concern, separate locus.
- A head mixing literal and variant alternates (`.A | 1 :>`) stays on the text path; codegen's `parseMatchArm`
  reads no form for it (pre-existing silent arm drop, not measured in the corpus).
- Decl-position block arm whose tail is an assignment (`{ …; o.n = 2 }`) emits a dead
  `let _scrml_tilde_N = o.n = 2;` — pre-existing for `.V` arms, now shared by literal arms. Correct, not tidy.
- E-MU-001 fires on `for (let i = 0; i < 1; …) { i = 5 }` although `i` is read in the condition
  (pre-existing at top level; seen via the s465-r3 fixture).
