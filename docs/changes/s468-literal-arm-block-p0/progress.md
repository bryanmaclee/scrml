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

## 2026-10-17 — FIX ROUND 1 (S239 review of 4369d0bb9, PR #1450; artifacts ~/.cache/scrml-agent-tmp/s468-rev-litarm/)

Resumed after a machine shutdown: pushed 12cd1f95a, committed + pushed 4369d0bb9 (progress), then the round.
Every finding reproduced first on this branch with the reviewer's driver before fixing.

**Correction to the first round.** "a `_ :> { … }` whole-product arm of a multi-scrutinee match is the
wildcard (was a false E-TYPE-020 / dropped arm)" — WRONG as written: the typer stopped reporting E-TYPE-020,
but all three multi-scrutinee lowerings still DROPPED the block body (`msWildDeny*` FAIL on base and on
12cd1f95a; `msLitAltWild` newly FAIL on 12cd1f95a). Fixed below (F2).

- **F1 (P0, INTRODUCED by round 0).** `const o = match name { "bob" :> { g: check } … }` then
  `o.g(pass, hash)`: codegen emitted `_scrml_tilde = {g: check}` (its reader: the brace body as an object),
  while value-function-stored / the F4 walks read the body's one statement, whose exprNode was the FIRST KEY
  (`g`) — two readers disagreed. Reproduced: objArmDecl, objArmDeclVariant, objDeclLet, objDeclArr,
  objDeclNested, objDeclStr, objReturnLit, serverFnObjRet FAIL on 4369d0bb9; objReturnVariant FAIL on main too.
  Fix: ONE reader `objectLiteralArmValue` (arm-body-statements.ts); the parser applies it to every block-arm
  body (`markObjectLiteralArmBody`: the body's statement now carries the object tree), and the typer's
  `objectLiteralArmBodyNode` and codegen's `_objectLiteralArmFromStructuredBody` delegate to it. All refused
  now (E-ASYNC-FN-ESCAPES-AS-VALUE + E-VALUE-FUNCTION-STORED); objArmStmtReturn / objArmDirectCall (a direct
  call result in an object arm) still PASS. The E-ERROR-002 closure the reviewer confirmed is kept.
- **F2 (P0, pre-existing).** `emitMultiScrutineeMatch` (value IIFE), `emitMultiScrutineeMatchStmt` and the
  decl lowering (emit-logic `emitMatchExprDecl` multi-scrutinee callback) emitted a whole-product wildcard from
  `child.result`, which a `match-arm-block` lacks. Now the block's statements (IIFE: `structuredIifeArmInner`
  with the single-scrutinee leave rule; statement: `stmtArmBodyLines` on the structured arm; decl: object arm
  as value else `_emitStructuredArmToVar`). msWildDeny / Else / Decl / DeclElse / msLitAltWild PASS;
  sem2 multiScrutWild* return "wild".
- **F3 (P0, pre-existing).** A COMMENT in an arm head made every arm form decline. `dropArmHeadComments`
  (ast-builder.js) runs at the start of `parseOneStatement` and of `rejectDanglingElse` (for
  `else /* c */ :>`): at arm level, when the tokens up to the arm arrow — comments skipped — form an arm head
  (`armPatternChainArrowOffset`, or `not`), the COMMENT tokens from the head through the arrow are spliced out
  (precedent: the tokens.splice at the markup-text relex). cmtVariant / cmtElse / cmtAltMid /
  cmtLineBeforeArrow / cmtStrHead / cmtInlineHof / commentBeforeArrow… all now read as structured arms.
- **F4 / F5.** `unclassifiableArmHead` (ast-builder.js) — at arm level, before Form 4 — refuses with
  E-PARSE-001 a head whose alternates are outside §18.2 / §18.16 or mix kinds: literal + variant mixed (no
  wildcard), `(1) :>`, `1 | not :>`, a template literal. Governing: §18.16.1 `literal-arm-pattern ::=
  string-literal | number-literal | boolean-literal` (a template is not a string literal; `` `${name}` `` is
  not constant); §18.2 `arm-pattern ::= variant-pattern | wildcard-arm | whole-error-arm | is-pattern` +
  §18.16's `literal-arm-pattern` — `not` and `( … )` are not alternates. These arms were silently dropped by
  codegen (fail open: mixedDrop / parenDrop / notAltDrop FAIL on base and round 0). E-PARSE-001 is the code
  the parser already uses for "not a match arm" (`reportOrphanArmLines`); the message names §18.2 / §18.16.
  An alternation holding `_` / `else` stays the wildcard arm (not refused).
- **Filed:** g-match-arm-brace-shorthand-object-vs-block-tail-s468 (F6, LOW, ruling owed — `{ foo }` reads as
  object shorthand, §18.5 would read a block tail; recommendation in the entry) and
  g-mu-001-c-for-loop-var-read-in-condition-s468 (LOW, pre-existing false E-MU-001).

**Gates (fix round 1).**
- Reviewer families on the branch: la2 (= atk1–atk5 verbatim, 101 shapes): 0 FAIL (14 PASS, 86 PASS-REFUSED,
  1 PASS-DENY `cpsMsWild` — a CPS-split response the instrument cannot read; the wrong password returns
  `__scrml_exit REJECTED`). sem1/sem2 semantic shapes: tmplHead / tmplInterp now E-PARSE-001 (were "matched"),
  multiScrutWild* now "wild" (were "none").
- Unit file s468-literal-arm-block-parsed: 53 pass (adds unclassifiable-head refusals, comment-in-head
  reading, the object-arm tree, object-arm refusal ×3, multi-scrutinee wildcard block executed ×3).
- Corpus differential (2840 sources, base bbddfd7b9 vs round-1 head): 0 newly failing / 0 newly passing,
  0 E-PARSE-001 anywhere; same 9 diagnostic-code changes (info / W-DEAD-FUNCTION removals) and the same 3
  formatting-only artifact diffs as round 0. giti + flogence: 0 error-code differences.
- Real (non-test-fixture) sites newly refused: 0.

## 2026-10-17T22:02:37-06:00 — s469-literal-arm-r1 resume at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a47310f83fb21b193; fast-forwarded to 0322961fe (from old worktree)

## 2026-10-17 — FIX ROUND 1, continued (s469-literal-arm-r1; resumed from 0322961fe after the prior agent died)

Verified F1–F5 by re-running the reviewer's instruments on 0322961fe (do not trust the commit message):
- la2 (classify.js, 101 shapes): 14 PASS · 86 PASS-REFUSED · 1 PASS-DENY (`cpsMsWild`, REJECTED inside a CPS
  envelope) · **0 FAIL**. Every shape that was FAIL in the reviewer's atk*-head.txt at 4369d0bb9 (23 of them:
  objArmDecl, objArmDeclVariant, objDecl*, objReturn*, serverFnObjRet = F1; msWildDeny*, msLitAltWild = F2;
  cmt*, commentBeforeArrow = F3; mixedDrop, parenDrop, notAltDrop = F4) is now PASS / PASS-REFUSED.
- sem1/sem2 (reviewer semantic shapes): tmplHead / tmplInterp / tmplInterp2 now E-PARSE-001 (were "matched",
  F5); multiScrutWild / multiScrutWildDecl / multiScrutWildStmtRet return "wild" (were "none" / null, F2).
- Pre-commit gate on the start commit 2206094b4: 37762 pass · 0 fail.

New this round:
- **One reader, codegen side (F1 follow-through).** Codegen still emitted an object-literal block arm from its
  brace TEXT (`emitArmValue(text)` — on the client that is the token rewriter, a second reader of the arm).
  New `emitObjectLiteralArm` (emit-control-flow.ts) emits the object TREE the parser stored
  (`objectLiteralArmValue`) in both modes; the four call sites (IIFE, statement, decl, multi-scrutinee decl)
  use it; the text accessor `_objectLiteralArmFromStructuredBody` is deleted. Output change: `{ x }` -> `{x}`
  spacing (one assertion in g-library-fn-match-else-arm-object-literal.test.js relaxed to accept both).
- **F6 (S468 ruling item 5).** SPEC §18.5 bullet: a brace arm body that reads as an object literal is the
  arm's value in every position; `{ foo }` = `{ foo: foo }`. New info lint W-MATCH-ARM-SHORTHAND-OBJECT
  (§34 row; type-system.ts `checkMatchDiagnostics`) on a single-shorthand body, naming `{ foo: foo }` and bare
  `foo`. Not linted: a `match` nested inside an expression (rawArms text locus, already deferred). Gap
  g-match-arm-brace-shorthand-object-vs-block-tail-s468 -> resolved. Unit (D) in s468-literal-arm-block-parsed.
- Filed (found while testing, both LOW, both pre-existing loci): g-expr-position-wildcard-only-match-malformed-s469
  (a wildcard-only `match` inside an expression emits `else` with no `if` -> E-CODEGEN-INVALID-LOGIC, fails
  closed); g-dg-002-false-on-read-in-match-arm-block-in-fn-s469 (false E-DG-002 for a cell read only inside a
  decl-position match arm block in a function; also for `.V` arms).

## 2026-10-17 — FIX ROUND 2 (S239 re-review of 435d55cd4 = DO-NOT-LAND)

- **Blocker reproduced** (new family la3, 27 shapes, classify.js): on 435d55cd4 21 FAIL — a one-statement
  BLOCK arm `{ ok; }` read as the shorthand object `{ ok: ok }` (truthy) in every head form (`1`, `-1`,
  `1 | 2`, `"bob"`, `"bob" | "amy"`, `true`, `.A`, `::A`, `.A | .B`, `else`, multi-scrutinee `_` / `else`),
  `const` / `let`, multi-line, and `return` position. Cause confirmed: `objectLiteralArmValue` rebuilt
  `{ ${expr} }` from the statement text, which had lost the `;`. On origin/main aef6cfcb9: 3 FAIL
  (semiRetLit / semiRetVariant / semiRetAltStr — return position, arm text).
- **Fix:** the decision moved into the parser, from TOKENS: `armBraceBodyObjectShape` (ast-builder.js)
  — object iff a non-empty comma list of `key: v` / `...s` / `[k]: v` / lone IDENT entries with no
  top-level `;`; `parseArmBraceBody` collects an object arm with the parser's own `collectBracedBody` and
  stores the object node + `objectLiteralArm` (+ `singleShorthand`) at parse time, else `parseRecursiveBody`.
  `markObjectLiteralArmBody` deleted; `objectLiteralArmValue` now only reads the parser's mark (the
  text rebuild + `parseExprToNode` are gone). F6 switch: `SINGLE_SHORTHAND_ARM_BODY` (arm-body-statements.ts)
  — "error" makes the lint site (`singleShorthandArmDiagnostic`, type-system.ts) a compile error.
- la3 on fix round 2: 26 PASS + 1 PASS-REFUSED (`semiWild`, wildcard-only decl match: E-CODEGEN-INVALID-LOGIC
  on main and 435d55cd4 too — gap g-expr-position-wildcard-only-match-malformed-s469 widened). Pack 826 pass.
- `{ undefined }`: `undefined` is a KEYWORD token, so not a shorthand: a block again, as on main (item 2
  restored naturally). Unit (E) pins it.
- SPEC §18.5 bullet now states the token rule; provenance corrected — semantics-changed for a `.V` / `::V`
  arm in a `const` declaration (base bbddfd7b9 blockTailIdentV = `R:7`, now `{ foo: 7 }`), inert for the
  other measured positions; the single-shorthand form is flagged as under re-confirmation. Gap entry
  corrected ("base and branch alike" was wrong) and set RULING-GATED.
- Corpus differential (examples, samples, conformance, stdlib — 2840 sources), round 2 vs 435d55cd4:
  0 newly failing / 0 newly passing, 0 diagnostic changes, 0 artifact content changes after normalising the
  compiler-root path. (vs origin/main aef6cfcb9 the branch also differs by main's commits since bbddfd7b9 —
  not a valid measure of this PR; the round-0 measurement vs bbddfd7b9 stands.)
- Pre-commit gate on bac1c7ccd: 37795 pass, 0 fail.

## 2026-10-18 — FIX ROUND 3 (ruling S469 "Compile error (Recommended)")

- `{ foo }` (exactly one bare shorthand name, no `;`) is now **E-MATCH-ARM-SHORTHAND-AMBIGUOUS** (code name
  provisional — owner's call) in every position. Raised by the PARSER where it reads the arm's tokens
  (`parseArmBraceBody`); a `match` inside a larger expression (arms carried as text by the expression parser)
  is re-read with the statement parser by `checkExpressionMatchArmBodies` (ast-builder.js, beside the S462
  `given` re-read), forwarding only this code. The info lint W-MATCH-ARM-SHORTHAND-OBJECT and the
  `SINGLE_SHORTHAND_ARM_BODY` switch are retired (no form still needs the lint). SPEC §18.5 bullet + §34 row
  replaced; provenance S469, supersedes S468 item 5; direction newly-rejecting. Gap resolved.
- **Corpus, measured** (`corpus-emit-differential`, roots examples, samples, conformance, stdlib, benchmarks —
  2847 sources; base = git archive ae833fb26, head = this round): 0 newly failing, 0 newly passing, 0
  diagnostic changes, 0 artifact content changes after root-path normalisation. giti + flogence (113 `.scrml`,
  each compiled with head): 0 E-MATCH-ARM-SHORTHAND-AMBIGUOUS. **Real sites newly refused: 0.**
- Test fixtures migrated: g-library-fn-match-else-arm-object-literal.test.js (`{ x }` -> `{ x: x }`, its
  parity intent kept). Unit (D) rewritten: refused once in decl / let / return / argument / multi-scrutinee /
  statement / lambda; the explicit spellings, `{ foo, bar }` and `{ foo; }` compile and run.
- security-await-pack family `la4` (50 shapes: 12 head forms x const / let / return / argument, + statement +
  lambda): all PASS-REFUSED with E-MATCH-ARM-SHORTHAND-AMBIGUOUS. Pack: 873 shapes, 876 pass.
- Not covered (surfaced, not changed): a `!{}` handler arm `.E :> { foo }` reads as a block whose result is
  `foo` (not an object) — the ruling's "every position" is read as every `match` position.

## 2026-10-18 — FIX ROUND 4 (S239 delta re-review of 187294fd8 = LAND-WITH-FOLLOWUPS)

- **1 (HIGH, pre-existing): §18.19 product arms** kept their body as text — `match (a, b) { (1, 2) :> { ok }
  (_, _) :> false }` let a wrong password in on 187294fd8 and on main. The product-arm parser now reads a
  `{ … }` body with the SAME `parseArmBraceBody`: `{ ok }` / `{ ok, }` -> E-MATCH-ARM-SHORTHAND-AMBIGUOUS; an
  object body is the arm's value (`result`/`resultExpr` = the parser's object, `objectLiteralArm`); a block is
  `structuredBody`, emitted by both multi-scrutinee lowerings (IIFE: `structuredIifeArmInner` + the payload
  prelude + the leave rule; statement/decl: the `armBody(result, structuredBody)` callback). Payload bindings
  resolve inside the block (unit F, `(.B(n), 2) :> { const q = n + 1⏎ q }` = 4). la4 + 9 product shapes: 7
  refused, `{ ok; }` and a keyed object REJECT.
- **2 (LOW): keyword shorthand.** A lone word JS reads as a shorthand property — an IDENT, or a scrml KEYWORD
  that is NOT an ECMAScript strict-mode reserved word — is the single-shorthand form: refused `{ type }`,
  `{ from }`, `{ is }`, `{ as }`, `{ get }`, `{ set }`, `{ server }`, `{ fn }`, `{ async }`, `{ undefined }`,
  `{ of }`, `{ match }`, `{ lift }`, `{ fail }`, … (`when` / `partial` / `given` / `not` lex as IDENT and were
  already refused). Left as blocks: the ES reserved words (`return`, `break`, `continue`, `null`, `this`,
  `true`, `false`, `let`, `static`, `public`, `await`, `yield`, `typeof`, `new`, …). Error raised from the
  tokens even when the expression parser cannot read the word as an object. `{ undefined }` is therefore now
  refused (round 2 had made it a block).
- **3 filed:** shapes added to g-match-value-position-server-call-no-autoawait (MED, open — same sync value
  IIFE mechanism); NEW g-raw-match-arm-object-failable-call-unhandled-s469 (MED). Pack family la5 (4 shapes):
  the three client shapes listed in UNJUDGED as KNOWN HOLES (the server-route instrument cannot judge a client
  decision — a KNOWN_FAIL entry needs a judged FAIL); the server twin is PASS-REFUSED (E-CODEGEN-INVALID-LOGIC).
- Corpus (2847 sources, base = archive of 187294fd8): 0 newly failing / passing, 0 diagnostic changes; 3
  artifacts differ — formatting only (product-arm blocks now structured-emitted; one `;;` empty statement
  in returned-multi-match-braced-leave-and-inner-break, the pre-existing `bodyLines.join("; ")` in
  structuredIifeArmInner). giti + flogence (113): 0 error-code differences.

## 2026-10-18 — FIX ROUND 5 (S239 delta re-review of 5c795a428 = DO-NOT-LAND)

**Blocker (INTRODUCED by r4), reproduced:** `const allowed = match (a, b) { (1, 2) :> { chk(pass, row.pw) }
(_, _) :> false }` (`chk` is `! -> AuthErr`) compiled clean and answered WELCOME. Cause confirmed: r4 put the
product block on a `match-arm-inline` as `structuredBody`; the E-ERROR-002 walk (failable-value-calls.ts
`STATEMENT_CHILD_KEYS`, which lists `body` but not `structuredBody`) never visited it.

**Fix of the class:** the product BLOCK arm is now a `match-arm-block` — `{ kind: "match-arm-block",
productPatterns, body, payloadBindings }` — the shape every analysis already walks for a `.V {` / `_ {` block arm,
and the field codegen emits (both multi-scrutinee lowerings read `child.body`). No analysis reads
`structuredBody` off an AST arm any more (`structuredBody` survives only on codegen's internal `MatchArm`
records). `payloadBindings` come from the product positions' TOKENS (`productPositionBindings`), so the scope
checker binds `n` in `(.B(n), 2) :> { … n … }`. lint-defer's binder table gains the `match-arm-block`
`productPatterns` row.

**Walker enumeration — who reads a match arm's body, and does it see a product BLOCK now** (verified by
execution, la5 `prodBlk*` / unit (F) / probes; "=" means it reads the product block exactly as it reads a
`_ :> { … }` / `.V :> { … }` block):

| analysis | reads | product block (r5) | evidence |
|---|---|---|---|
| E-ERROR-002 (failable-value-calls.ts + type-system §19 walker) | `body` (STATEMENT_CHILD_KEYS) | = yes | la5 prodBlkFailable* x9 refused E-ERROR-002; unit (F) |
| E-ASYNC-FN-ESCAPES-AS-VALUE / F4 local-async-fns, fn-valued-bindings | statement tree | = yes | la5 prodBlkAlias, prodBlkHof refused |
| E-VALUE-FUNCTION-STORED (value-function-stored.ts) | statement tree | = yes | la5 prodBlkObjStore refused |
| server-call await + async colouring (codegen `_awaitMatchArmServerCalls`, emit-library-shared) | emitted body | = yes | la5 prodBlkServerCall REJECTS; client probe: `await _scrml_fetch_srv` in an async fn |
| route inference / server reach (route-inference.ts) | statement tree | = yes | client probe: server fn reached from a client product block gets its route + fetch |
| E-REACTIVE-003 / at-refs (server cell read) | statement tree | = yes | la5 prodBlkCellRead refused |
| scope (type-system `match-arm-block` case, payloadBindings) | `body` | = yes | E-SCOPE-001 on an undeclared name; `n` bound (unit F) |
| §4 statement checks (E-SWITCH-FORBIDDEN, …) | statement tree | = yes | probe: `switch` in a product block refused |
| exhaustiveness / arity (checkMultiScrutineeMatch) | `productPatterns` (kind-agnostic) | = yes | unit + conformance suites |
| W-MATCH-ARROW-LEGACY | every `match-arm-block` | = yes | — |
| lint-defer binder census | `payloadBindings`, `productPatterns` | = yes (row added) | defer-binder-completeness.test.js |
| E-DG-002 reader accounting (dependency-graph.ts) | — | = NO, same as every block arm in a function | pre-existing: g-dg-002-false-on-read-in-match-arm-block-in-fn-s469 |
| same-file peer harvest (emit-server) | — | = NO for a `!{}`-handled failable peer in a helper's arm, product and single-scrutinee alike | pre-existing residual: g-server-match-arm-same-file-peer-call-not-defined-s465 (narrowed) |
| meta-eval / meta-checker | `matchArmBlockToMatchArm` / `body` | = (not separately exercised) | — |

- LOW nested match as a block tail (yields undefined): NOT product-specific — `1 :> { match m { _ :> { … } } }`
  is the same on single-scrutinee arms and the whole-product `_` arm. Filed g-match-as-block-tail-yields-undefined-s469
  (fails closed; la5/prodBlkNested PASS-DENY).
- LOW same-file failable peer: shapes la5/prodBlkPeerHelper(+Single, +Plain) added to
  g-server-match-arm-same-file-peer-call-not-defined-s465, status resolved -> narrowed.
- Corpus (2847 sources incl. benchmarks, base = archive of 5c795a428): 0 newly failing / passing, 0 diagnostic
  changes, 0 artifact content changes after root-path normalisation.
