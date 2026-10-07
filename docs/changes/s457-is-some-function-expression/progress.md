# progress — s457-is-some-function-expression (append-only)

## 2026-10-07 — startup
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4d6f8b53831fd9ee`, base `0d8e9d8ce` == origin/main. Brief committed `ef4e4bd80`.

## 2026-10-07 — governing text (SPEC §42, quoted)
- §42.2.2a: "`expr is some` SHALL evaluate to `true` when `expr` is not `not`, and `false` when `expr` is `not`." … "**Codegen:** `x is some` → `x !== null && x !== undefined` in JavaScript output."
- §42.2.4: "`expr is not` and `expr is some` SHALL be valid for any expression `expr` …" / "The compiler SHALL evaluate `expr` exactly once. Any side effects of `expr` occur exactly once."
- §42.8: "The `is not` operator SHALL compile to `(x === null || x === undefined)` in JavaScript output." / "The `is not not` double-negation pattern (presence check) SHALL compile to `(x !== null && x !== undefined)` in JavaScript output."
- §2.2.1 (the gate): "A codegen path that cannot lower a construct SHALL emit a hard diagnostic … rather than a silent stub". NOTE: §2.2.1 also says the gate "is a syntactic backstop only — it catches malformed (unparseable) emission, not semantically-incorrect-but-parseable emission." The placeholder check widens the gate past that sentence → SPEC amendment text proposed in the final report.

## 2026-10-07 — reproduced + traced
- Issue reproducer (minus the invalid `path="/"` on `<page>`, E-PAGE-INVALID-ATTR) emits `if (__scrml_is_some__(v))`.
- Locus hypothesis (expression-parser.ts:1652 `case "is-some"`) REFINED: the placeholder is written there correctly; esTreeToExprNode converts it back only where it builds a tree. A block-bodied FunctionExpression/ArrowFunctionExpression becomes an escape-hatch whose `raw` is sliced from the PREPROCESSED text (S97: acorn offsets are in that text), so the placeholder rides `raw` into rewrite.ts's string passes, which had no rule for it.
- Issue's "arrow callbacks lower correctly" is FALSE for block-bodied arrows (leak measured); true only for expression-bodied arrows.
- Positions measured leaking at base: function expr arg, `is not`/`is not not`, call-tail and member operands, block arrow, object-literal function value, fn-expr in fn-expr, fn-expr in `fn`, `when … changes` body, engine `effect=`, `<each>` row, `onclick=${…}` handler, `server function` body.
- Second gap defect reproduced: `(expr) is not` on the string path emitted `((expr) == null)`, then client pass rewriteEqualityOps made it `=== null` (undefined dropped). Also `return (f(n)) is not` was a ParseError: scanLhsLeft took `return` as the callee of `(f(n))`.

## 2026-10-07 — fix (commit 5895abfe5)
- NEW `compiler/src/codegen/is-predicate-lowering.ts` — one lowering (presence/absence/variant), used by emit-expr AND rewrite.ts; `lowerIsPlaceholders` lowers placeholder calls code-aware.
- rewrite.ts Pass 2.2 (client + server) after rewriteNotKeyword; `_rewriteParenthesizedIsOp` emits the shared both-halves form.
- expression-parser.ts scanLhsLeft: keyword left of a `(…)` group stops the LHS.
- Pre-commit gate: 31787 pass / 58 skip / 0 fail.

## 2026-10-07 — fail-closed gate
- validate-emit.ts: the parse gate's acorn pass reads identifier tokens and refuses any `__scrml_<name>__` (shape, not name list) with E-CODEGEN-INVALID-LOGIC naming the placeholder. Live catch found: `[:]` inside a function-expression body → `__scrml_map_lit__` compiled CLEAN at base (silent ReferenceError); now refused.
- Corpus (samples/ examples/ conformance/, 2360 files, one compile each): base vs after artifacts byte-identical (`diff -rq` = 0); `__scrml_is_(some|not)__` in artifacts 0 → 0; E-CODEGEN-INVALID-LOGIC 34 → 34; gate placeholder refusals 0. Only placeholder on disk either side: `__scrml_render_header__` in conformance `components/missing-required-slot-reject` (an E-COMPONENT-010 reject case; gate skipped on prior fatal error; artifacts still written = impl#1 divergence g-impl1-artifacts-written-on-error-s451).
- New test file discriminates: 35 of 47 fail against the base tree, 47/47 pass after.

## 2026-10-07 — S239 review round (R1-R4) on 00679a367
- R1/R3: IS_LHS_STOP_KEYWORDS narrowed to return/throw/case/else/do/in/instanceof (reserved everywhere, never a callee). `of`, `yield`, `await` dropped (legal identifiers); `typeof`/`void`/`delete`/`not`/`and`/`or`/`if`… dropped (pre-#1333 reading kept). Probed base vs head: R1 a/b/c and R3 a-d byte-identical to base.
- R2: the reviewer's "base emitted a correct IIFE" reproduces only for `(new Object(v)) is some` (unchanged). Bare `new Object(v) is some` was `new __scrml_is_some__(Object(v))` at BASE too (ReferenceError). Fixed at the root: scanLhsLeft folds a preceding `new` into the operand → `IIFE(new Object(v))`.
- R4: gate exempts placeholder-shaped names whose exact text occurs in this compilation's source files (api.js passes `userWrittenPlaceholderNames`). `const __scrml_x__`, `{ __scrml_meta__: v }.__scrml_meta__`, `^{ const __scrml_y__ = 3 }` compile + run; `[:]` leak beside an author name still refused.
- Found while committing: integration gate-eq-write's process-global `mock.module` wrapper dropped the 2nd arg → later tests' compiles lost the exemption (G4 red only in the full gate). Wrapper now forwards all args.
- emit-html value-attr lowerability probe made syntax-only (a placeholder check there would drop an attr with a warning instead of the loud artifact-gate refusal).
- Pre-commit 31839 pass / 58 skip / 0 fail; conformance 1341/1391 + 50 xfail; corpus base vs head: 0 artifact diffs, is_some/is_not in artifacts 0/0, E-CODEGEN-INVALID-LOGIC 34/34.

## 2026-10-07 — re-review round 2 (N1, N2) on e0648cb17
- N1: `yield` back in IS_LHS_STOP_KEYWORDS — `function* gg() { yield (v) is some }` inside a callback now yields the boolean (emitted `yield IIFE(v)`), G6 runs it.
- N2: exemption by author IDENTIFIER token only. NEW codegen/author-placeholder-names.ts walks the compile's own Stage-2 `bsResults` (no new splitBlocks call — a first draft that re-split tripped hybrid-stage-swap's PARSE_REENTRY_FILES inventory) and tokenizes code-bearing blocks with tokenizeBlock (acorn tokenizer for `_{}`); IDENT + ATTR_CALL names count; comment / string / template text / quoted attr / markup text / HTML comment do not. G7 pins the exact set; G8: a `//` comment or a string naming `__scrml_map_lit__` does not exempt the `[:]` leak.
- Pre-commit 31842 pass / 58 skip / 0 fail; conformance 1341/1391 + 50 xfail; corpus base vs head 0 diffs.

## 2026-10-07 — re-review round 3 (N2 false refusals) on ef28e0c57
- Gate now has two exemption legs. Leg 1 (new, validate-emit.ts): walk the emitted AST; only a placeholder-shaped identifier in REFERENCE position that the artifact never BINDS (declarator / param / catch / class / import) is refused; property names are not references. Leg 2 (author-placeholder-names.ts): author identifiers per FILE — attribute values read as code (ATTR_EXPR/BLOCK/IDENT/NAME/CALL args, `${}` in quoted strings), text children of each/match/engine/PascalCase bodies; acorn tokenizer, fallback = words outside comments/strings (errs toward exempting). The attribute tokenizer drops the quotes of a `:`-shorthand string body, so non-string-token names must also appear outside strings in the opening tag.
- Base vs head on author names in: onclick lambda param, title="${}", if=(), `:`-shorthand, each-as + body, each-row attr, match arm, engine state-child, component prop (+ lambda param), attr ident, attr block — all compile on both.
- Pre-commit 31856 pass / 58 skip / 0 fail; conformance 1341/1391 + 50 xfail; corpus base vs head 0 diffs.

## 2026-10-07 — SPLIT (PA): branch s457-is-some-core from 934ac062c
- The placeholder gate waits on a ruling (reserve `__scrml_` for authors → plain shape test). worktree-agent-a4d6f8b53831fd9ee stays at 934ac062c as the gate's record.
- s457-is-some-core: validate-emit.ts / api.js / emit-html.ts restored to base; author-placeholder-names.ts deleted; mock arg-forwarding kept. Removed tests: B1 B2 B2b B3 B4, E1, G4 G5 G7 G8, G9b ×6, G10, G11. Kept: A, C, D, F, G1 G2 G3 G6, G9 ×5.
- `[:]` inside a function-expression body ships `__scrml_map_lit__` silently again (as on base).
- Pre-commit 31838 pass / 58 skip / 0 fail; conformance 1341/1391 + 50 xfail; corpus base vs head 0 diffs.
