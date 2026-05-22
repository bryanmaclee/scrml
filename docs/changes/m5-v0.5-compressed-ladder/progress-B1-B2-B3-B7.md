# Progress — M5-swap Wave 2 — B1 + B2 + B3 + B7

Combined dispatch: B1 (`?` propagate-expr), B2 (`!{}` guarded-expr),
B3 (`~` tilde-decl), B7 (`throw`/`try` forbidden-vocabulary diagnostic).

Authority: `scrml-support/docs/deep-dives/m5-swap-redecomposition-2026-05-21.md`
§B1 / §B2 / §B3 / §B7.

---

## 2026-05-22T01:37Z — startup

- Worktree verified: `.claude/worktrees/agent-accb1ca0f2df62358`.
- `git merge main` — fast-forward to `fffdaf50` (Wave 1 B4/B5/B6 + README + v0.5/v0.6).
- `bun install` OK. Baseline: `bun test unit+integration+conformance` = 13675 pass / 0 fail;
  other suites 726 pass / 0 fail. The 2 fails in the combined `bun run test` are flaky
  (promote-match /tmp races + browser parallelism) — confirmed each suite green individually.
- Maps consulted: `.claude/maps/primary.map.md` -> `domain.map.md` routing for native-parser.
- Read source: ast-stmt.js, ast-expr.js, token.js, parse-expr.js (parsePostfixChain /
  parseConditional / parseUnary), parse-stmt.js (parseStatement / parseLinDecl /
  parseTypeDecl / parseThrow / parseTry), translate-expr.js, translate-stmt.js,
  parse-error-body.js, ast.ts (PropagateExprNode / GuardedExprNode).

### Design decisions
- B1/B2: `propagate-expr` + `guarded-expr` are LogicStatement kinds (BaseNode-extending,
  carry id). Native side emits `Propagate` / `GuardedExpr` ExprKinds; the
  STATEMENT bridge un-wraps `ExprStmt{Propagate|GuardedExpr}` -> the LogicStatement
  (exact pattern translate-stmt.js already uses for Lift/Fail). translate-expr.js
  gets escape-hatch arms for the rare genuine-expression-child position.
- B3: `tilde-decl` is a StmtKind; `~`-led declaration production at statement position.
- Disambiguations:
  - ternary-vs-propagate: propagate `?` is consumed in parsePostfixChain only when
    NOT followed by a ternary-consequent (`?` followed by a non-expression-start
    token, or by `!{`). Ternary `?` is always followed by an expression then `:`.
  - prefix-`!`-vs-`!{`: prefix `!` is parsed in parseUnary at expression START;
    postfix `!{` fires in parsePostfixChain (after a parsed base) only when `Bang`
    is immediately followed by `LBrace`. B6's signature `!` is consumed in
    parseScrmlFunctionDecl before the body — never reaches parsePostfixChain.
  - prefix-`~`-vs-tilde-decl: `~` lexes as BitNot. tilde-decl fires at statement
    position only when `~` is source-adjacent to an `Ident` that is followed by `=`.

## 2026-05-22T01:50Z — B7 DONE

- parse-stmt.js + .scrml mirror: parseThrow fires E-THROW-NOT-IN-SCRML,
  parseTry fires E-TRY-NOT-IN-SCRML at the keyword lead; both recover by
  parsing the construct. Mirrors E-ASYNC-NOT-IN-SCRML.
- SPEC §34.1: +2 rows (E-THROW-NOT-IN-SCRML, E-TRY-NOT-IN-SCRML); prologue
  count 74->79 (anticipating B2/B3 codes); SPEC-INDEX regenerated + changelog.
- New test file native-parser-scrml-extension-exprs.test.js §B7 — 9 tests pass.
- Next: B3 (~ tilde-decl), then B1 (? propagate), then B2 (!{} guarded).

## 2026-05-22T02:10Z — B3 DONE

- ast-stmt.js + .scrml: TildeDecl StmtKind + makeTildeDecl(name,init,span).
- parse-stmt.js + .scrml: parseTildeDecl production + tildeDeclLeadFollows
  disambiguator (source-adjacency + trailing `=`); dispatch in parseStatement
  at the BitNot lead. `~x` bitwise-NOT and standalone-`~` accumulator unaffected.
- translate-stmt.js: TildeDecl arm -> makeTildeDeclNode -> live `tilde-decl`
  (structural twin of makeLinDeclNode). translate-stmt.scrml header updated.
- SPEC §34.1: E-STMT-TILDE-NAME / E-STMT-TILDE-INIT rows landed in the B7 commit.
- Tests: §B3 — 10 tests (incl. `~bits = ~rawBits` disambiguation, non-adjacent
  `~ total`, prefix bitwise-`~`). 19 total in the file, all pass.
- NOTE: the §32 `|>` pipeline operator is a SEPARATE native-parser expression-
  grammar gap (not in B3 scope) — surfaced as a deferred item.

## 2026-05-22T02:50Z — B1 + B2 DONE

- ast-expr.js + .scrml: Propagate + GuardedExpr ExprKinds + makePropagate /
  makeGuardedExpr constructors.
- parse-expr.js + .scrml: parsePostfixChain gains a `?` propagate branch
  (gated by propagateFollows — the ternary-vs-propagate disambiguator) and a
  `!{` guarded-expr branch -> parseGuardedExprTail (balanced-brace scan +
  parseErrorArms reuse). parse-error-body import added (no module cycle).
- translate-stmt.js: ExprStmt arm un-wraps Propagate -> propagate-expr and
  GuardedExpr -> guarded-expr (makePropagateExpr / makeGuardedExprNode). The
  guarded-expr's inner bare-expr consumes one id from the shared counter.
- translate-expr.js: Propagate/GuardedExpr escape-hatch arms (genuine
  expression-child position — same posture as Lift/Fail).
- SPEC §34.1: E-EXPR-GUARDED-UNCLOSED row landed in the B7 commit's prologue
  count; the expr-table row added here.
- translate-expr-bridge.test.js catalog-count guard 40 -> 42 (coupled).
- Tests: §B1 (12) + §B2 (12) + §B1+B2 combo (1) — 40 total in the file.
- Disambiguations verified by smoke + tests: ternary `a?b:c` / `count is
  some ? c : 0` / `a ? -b : c` stay Conditional; `f()?` / `f(a()?,b()?)` are
  Propagate; prefix `!flag` / `!{}` stay Unary; postfix `!{` is GuardedExpr.

## STATUS — all four units DONE. Full gate 13717 pass / 0 fail.

## 2026-05-22T03:30Z — B7 conformance-test reconciliation

- The M3.3/M3.4 parser-conformance try/throw tests + the bench-corpus
  stmt-try-catch fixture asserted a ZERO-error parse on try/throw — pre-B7
  behavior. B7 deliberately makes try/throw fire E-TRY/E-THROW-NOT-IN-SCRML
  (SPEC §19.3; mirrors E-ASYNC-NOT-IN-SCRML). These were locked tests
  locking pre-B7 behavior — updated to tolerate exactly the B7 codes:
  - parser-conformance-stmt.test.js: try/throw corpus entries tagged
    `forbidsVocab`; Tier-1 conformance + native-shape tests use
    nonVocabErrors() (node-kind sequence still asserted against Acorn).
  - parser-conformance-corpus.test.js: bench-corpus diagnostic-free gate
    filters the B7 codes (the stmt-try-catch fixture exercises parse shape).
  - The seam tests now assert the seam-specific thing (no E-STMT-FORWARD-M3-3
    + node kind) rather than a blanket empty-error-list.
- Full gate (unit+integration+conformance+parser-conformance): 15431 pass /
  0 fail / 0 regressions.
