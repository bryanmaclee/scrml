# s468-cfor-comma-lists — progress (append-only)

## 2026-10-17 start
- WORKTREE_ROOT /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-afdc9a9d506d05360, branch
  s468-cfor-comma-lists from origin/main 5c43c3b8e (merge-base == origin/main verified).
- `bun install` (puppeteer postinstall exits 1 — no browser download; not load-bearing here), `bun run pretest` OK.

## Governing sentence
Ruling, user-voice-scrml.md §S464 (RULED "b"): *"comma lists are legal in a C-style `for` header's init and update
parts, on both client and server; the comma operator stays refused in every value position"* — and: *"one SPEC
sentence beside §40.8 / §4.18.2 "scrml has no comma operator": a C-style `for` header's init (a declarator list) and
update (a discarded-value step list) admit comma-separated lists, on both sides; every value position still refuses
the comma operator."* Direction: newly-accepting, RULED.

## Reproduce (origin/main 5c43c3b8e, executed)
`bun compiler/src/cli.js compile docs/changes/s468-cfor-comma-lists/repro.scrml -o $TMPDIR/out`
- repro.scrml (`for (let i = 0, j = n; i < j; i++, j--) { s = s + j - i }` in a client fn AND a server fn):
  FAILED — 2x E-SCOPE-001 "Undeclared identifier `j`" (stage TS), lines 5:51 and 10:51 — the body's `j`.
- repro-update-only.scrml (`let j = n` outside; `for (let i = 0; i < j; i++, j--)`): compiles; client.js:61 and
  server.js:41 both emit `for (let i = 0; i < j; i++, j--) {`.
- So on current main the S465 r6 codegen (`emitCForHeaderList`, emit-control-flow.ts; value-position refusal,
  emit-expr.ts) already lowers the update list on BOTH sides (the "server refuses `i++, j--`" of the brief was the
  pre-r6 await branch — refined). What still fails is the INIT declarator list: only the first declarator is in scope.

## Locus
Brief locus (parser/codegen) REFINED: the failing decision is type-system.ts `case "for-stmt"` — the C-style init is a
ParseError escape-hatch (`raw: "let i = 0, j = n"`) and the scope bind uses
`/\b(?:let|const|var)\s+(IDENT)/g` over raw text, which matches only the first declarator (`j` has no keyword).

## 2026-10-17 fix (d84bd19ea)
- Second hole found by sweeping value positions: a header with an EMPTY clause (`for (; i < j, j > 0; i++)`)
  carried no `cStyleParts` (ast-builder required all three), so codegen emitted the clauses as raw text and the
  comma operator in the CONDITION compiled at exit 0 on client AND server (executed: `for (; i < j , j > 0; i++)` in
  both client.js and server.js). With all three clauses present it was already refused (E-CODEGEN-INVALID-LOGIC).
- Fix (root, not position): ast-builder `cStyleClausesRead` — record `cStyleParts` when every WRITTEN clause was
  read; an empty clause is absent. type-system binds every declarator via `cStyleInitDeclaration` (the tree codegen
  already emits from). emit-control-flow emits nothing for an empty clause. types/ast.ts parts optional;
  component-expander null-guards them (types-gate OK, unchanged 180).
- Direction: newly-accepting (ruled) for declarator-list inits whose later names are used; newly-rejecting for a
  comma in the condition of an empty-clause header; semantics-changed (improvement) for empty-clause headers in
  general — their clauses now reach every tree walker (scope, route inference, await classification) instead of
  shipping as text.
- First commit attempt of the fix failed the hook on `emit-block-analysis-integration` (e) byte-determinism —
  5011 ms timeout while my base corpus capture was running concurrently; passes alone (13/13) and on retry.

## Corpus measure (executed)
`scripts/corpus-emit-differential.ts capture` on base = `git archive 5c43c3b8e` and head = d84bd19ea, roots
examples,samples,conformance/cases,stdlib: 2840 sources each; compile outcome identical (1700 ok / 1140 fail —
0 newly failing, 0 newly passing, 0 diagnostic code/text changes); 167 of 8562 artifacts differ and ALL 167 differ
only in `_scrml_project_root` (the two compiler roots' paths — verified by diffing every pair with that line
excluded: 0 remaining). Verdict "INCOMPARABLE" is only the archive base's unknown git revision. Newly-rejecting
corpus count: 0.

## SPEC
§40.8, new sub-bullet after the S441 comma-sequence sub-bullet ("The one comma list (S468)") with the inline
provenance; SPEC-INDEX regenerated (`--check` OK). Gap `g-cfor-header-comma-list-s468` filed resolved.
