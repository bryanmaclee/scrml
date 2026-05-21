# progress-A2 — M5-swap Unit A2: expression-catalog bridge

Append-only, timestamped. Crash-recovery checkpoint per global rules.

---

## 2026-05-21 — startup + survey

- Startup verification PASSED. WORKTREE_ROOT =
  `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-aa4efd9c9a34715e0`.
  `git merge main --no-edit` → "Already up to date" (worktree base already at
  S117 HEAD `778b1db3`). `bun install` OK. Baseline `bun test compiler/tests/`
  → 18,173 pass / 0 fail / 169 skip / 1 todo (one transient 2-fail flake on the
  first `bun run test` run — pretest dist race, brief-documented; re-runs green).
- Read: DD m5-swap-redecomposition §C3/§A2, primary + domain maps,
  ast-expr.js (native ExprKind catalog), emit-expr.ts (downstream dispatch),
  ast.ts ExprNode union + interfaces, translate-stmt.js (R1 template),
  translate-stmt.scrml, translate-stmt-bridge.test.js, progress-R1.md.

### Survey findings — catalog counts (verified against source)

- **Native ExprKind catalog: 40 entries** in the closed `ExprKind` object
  (ast-expr.js), NOT the DD's "~55". Of the 40, three (RestElement,
  AssignmentPattern, BlockStub) are param/body-stub support nodes that never
  reach translateExpr as a free expression — so ~37 expression-position kinds.
- **Downstream ExprNode union: 20 kinds** (ast.ts:1939 `ExprNode`), NOT the
  DD's "32". The DD's 32 conflated the 20 union members with BinaryExpr `op`
  string values + ObjectProp sub-kinds. `emitExpr` dispatches exactly 20:
  ident lit array object spread unary binary assign ternary member index call
  new lambda cast match-expr sql-ref input-state-ref escape-hatch reset-expr.

### Transforms the bridge handles

- Kind-rename: Conditional→ternary, Assignment→assign, Function/Arrow→lambda,
  Sql→sql-ref, InputStateRef→input-state-ref, Match→match-expr, Paren→unwrap.
- Fan-in: NumberLit/StringLit/BoolLit/RegexLit/TemplateLit → lit;
  Logical→binary; Update→unary.
- Fan-out: IsCheck → binary with op is/is-not/is-some/is-not-not by IsCheckOp;
  NotValue → lit{litType:"not"}; Member computed→index / non-computed→member.
- Escape-hatch passthrough: This/Super/TaggedTemplate/Yield/Render/MarkupValue/
  Sequence have no clean downstream kind — route to escape-hatch w/ nativeKind.

## 2026-05-21 — implementation complete

- `compiler/native-parser/translate-expr.js` — the bridge module.
  `translateExpr(nativeExpr)` — pure 1:1 (with kind-select fan-out) map,
  native `Expr` -> live `ExprNode`. No `idGen` (ExprNode carries no `id` —
  the `BaseNode` id contract is statement/markup-only). `translateExprList`
  helper for C1. Every native ExprKind has a translation arm.
- `compiler/native-parser/translate-expr.scrml` — canonical Pillar 5b mirror
  (doc-heavy skeleton + `${...}` `fn` stubs, mirrors translate-stmt.scrml).
- `compiler/tests/unit/translate-expr-bridge.test.js` — 109 tests: §1 leaf,
  §2 literal fan-in, §3 composite primary + Paren unwrap, §4 operators,
  §5 call/member/new (member→member, computed-member→index), §6 arrow/
  function fan-in, §7 IsCheck fan-out (4 branches), §8 scrml-extension
  forms (Sql/InputStateRef/Match/Tilde), §9 escape-hatch passthrough,
  §10 defensive folds, §11 catalog coverage (all 40 ExprKind entries).
- Probe-verified every native ExprKind shape against live parser output
  before authoring (ast-expr.js Item/Spread/Hole array wrappers,
  KeyValue/Shorthand/Spread/Method object props, IsCheckOp string values,
  Member computed flag, Match structured arms).

### Test results

- A2 file alone: 109 pass / 0 fail.
- Pre-commit gate (unit+integration+conformance): 13,641 pass / 0 fail.
- Full `bun test compiler/tests/`: 18,282 pass / 0 fail / 169 skip / 1 todo
  / 740 files = baseline 18,173 + 109 A2 tests, +1 file. Zero regressions.
- `.scrml` mirror compiles clean (`cli.js compile translate-expr.scrml`);
  forbidden-vocabulary grep clean (no try/catch/throw/===/!==, no malformed
  `is not not` predicate — the mirror has no scrml predicates at all, only
  `fn` stubs + `//` comments).

### Catalog counts — actual vs DD estimate

- Native `ExprKind`: **40 closed entries** (ast-expr.js), DD said "~55".
  Of the 40, 3 (RestElement/AssignmentPattern/BlockStub) are param/body-stub
  support nodes, not free-expression kinds — handled by the lambda param/
  body paths, defensively escape-hatched if they reach `translateExpr`.
- Downstream `ExprNode` union: **20 kinds** (ast.ts:1939), DD said "32".
  The DD's 32 conflated the 20 union members with BinaryExpr `op` strings
  + ObjectProp sub-kinds. `emitExpr`'s switch dispatches exactly 20.

### Gaps SURFACED to PA (escape-hatched, NOT papered over)

Native ExprKinds with no clean downstream `ExprNode` target — routed to
`escape-hatch` (nativeKind set; emit-expr.ts:emitEscapeHatch's dual-mode
path absorbs them via the string-rewrite fallback, keeping codegen correct
+ crash-free). A first-class live kind for each is the proper long-term
target — surfaced, not invented (A2 does not widen scope):

1. `This` / `Super` — no live `this`/`super` ExprNode kind.
2. `TaggedTemplate` — no live tagged-template kind.
3. `Sequence` — no live comma-sequence kind (the live escape-hatch path
   already documents Sequence routes through escape-hatch).
4. `Yield` — no live yield kind (generators are a separate conversation
   per ast-expr.js's makeYield header).
5. `Render` — `render name(args)` (§14.9) has no live ExprNode kind;
   the live pipeline handles `render(...)` as a `call` to a `render`
   ident (emit-expr.ts:emitCall special-cases callee name "render").
   A2's escape-hatch is conservative — a future unit could translate
   `Render` to a `call`-shaped node if the §14.9 contract permits.
6. `MarkupValue` — markup-as-value; no live ExprNode kind (the live
   catalog models markup at the ASTNode layer, not ExprNode).
7. `Lift` / `Fail` at a genuine expression-CHILD position — the common
   statement-position case is intercepted by translate-stmt.js (R1) which
   un-wraps `ExprStmt{Lift|Fail}` into `lift-expr`/`fail-expr`. A2 only
   sees a `Lift`/`Fail` if it nests inside another expression (rare —
   both are statement-shaped per §10/§19.3); escape-hatched so not dropped.

Non-gap hand-offs (documented, owned by a downstream unit):
- `Sql` -> `sql-ref` with `nodeId: -1` (the unresolved sentinel —
  emit-expr.ts:emitSqlRef recognizes `nodeId < 0`). A2 is a leaf
  translator with no file context; C1 (FileAST assembler) holds the
  file-level SQLNode registry and re-stamps `nodeId`.
- `TemplateLit` -> `lit{litType:"template"}` with `${...}` placeholders
  for interpolations. The live `template` litType is STATIC ("no live
  interpolation" per ast.ts:1602); a template with live `@cell`
  interpolation is a shape the live catalog does not structure — A2
  reconstructs the back-tick `raw` and folds interpolations to `${...}`.
  If live-interpolating templates need first-class support that is a
  separate catalog-extension unit, not A2.

A2 STATUS: complete. Self-contained importable unit; C1 wires it into
`nativeParseFile` + the statement bridge's expression-child slots.
