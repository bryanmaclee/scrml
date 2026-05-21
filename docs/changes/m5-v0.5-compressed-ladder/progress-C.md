# Dispatch C — F3 collectHoisted analogue — progress

Append-only timestamped log.

## 2026-05-21 — startup
- Startup verification PASS: worktree root confirmed, `git merge main` fast-forward
  to `ea97993e`, `bun install` + `bun run pretest` clean.
- Phase 0 survey complete. Findings:
  - Native parser top-level output: `parseMarkup(source)` → flat `Block[]`
    (`ctx.nodes`). Block shape `{ kind, span, commentForm, ...payload }`.
  - 11 BlockKinds: Text / DisplayTextLiteral / Comment / Markup / LogicEscape /
    Sql / Css / ErrorEffect / Meta / Test / ForeignCode.
  - `Markup` block: `{ kind, name, children:Block[], closerForm, tagClass, span }`.
  - `LogicEscape` block: `{ kind, bodyText, body:Stmt[], span }` — body is parsed
    JS Stmt AST (parseProgram). NOT pre-filtered into import/export arrays.
  - Stmt catalog has `Import` / `Export` StmtKind; NO `type-decl` / `component-def`
    / `engine-decl` — those are scrml-markup-layer concepts the native parser does
    not yet model (M5-divergence-ledger.md confirms: type/component/engine/state
    are "NOT produced" at this milestone).
- Decision: author `collect-hoisted.{scrml,js}` new pair. Walker collects what the
  native parser produces TODAY: imports/exports from LogicEscape bodies,
  channelDecls + hasProgramRoot from Markup blocks. typeDecls/components/
  machineDecls are collected via the same recursion but resolve empty at v0.5
  (their native BlockKinds land at v0.6 F7) — the walker's recursion + collection
  slots are present so v0.6 lights them up without a structural rewrite.

## 2026-05-21 — walker + conformance landed (commit 0bc2c529)
- Authored `compiler/native-parser/collect-hoisted.{scrml,js}` — the walker
  pair. `.scrml` carries the canonical Pillar-5b shape; `.js` runs.
  `collectHoisted(blocks)` + `hasProgramRoot(blocks)` exported.
- Authored `compiler/tests/parser-conformance-collect-hoisted.test.js` —
  54 conformance tests, all PASS:
    §1 output shape (7 keys, defensive) · §2 imports/exports from LogicEscape
    bodies · §3 channelDecls + hasProgramRoot · §4 v0.5 deferred-collections
    empty · §5 curated parity vs live `collectHoisted` (7 micro-corpus shapes,
    counts + boolean agree) · §6 ~20 corpus-exemplar no-throw audit.
- Pre-commit full suite gate PASSED at commit.
- No `compiler/src/` files touched (verified — only native-parser + tests).

