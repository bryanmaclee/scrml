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
