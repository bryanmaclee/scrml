# BRIEF — s462-narrowing-round5 (continue s462-narrowing-ends-on-write, fix round 5)

Change-id: `s462-narrowing-round5`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree. You CONTINUE an existing branch whose original agent ran out of context.

## Setup (do this first, after the F4 gate)
The work lives on local branch `worktree-agent-afa1a44af8bd50417` (same repository, shared refs) at df6fddc4be38412b9aad395938bfc55c498ae0c0. In YOUR worktree: `git reset --hard df6fddc4be38412b9aad395938bfc55c498ae0c0` (your worktree branch is fresh — nothing to lose; verify `git log -1` shows df6fddc4b). Do NOT check out or modify the original branch or its worktree. Then fetch this brief: `git fetch origin brief/s462-given-deprecate && git checkout FETCH_HEAD -- docs/changes/s462-narrowing-round5/` and commit it.
READ IN FULL before coding: `docs/changes/s462-narrowing-ends-on-write/progress.md` (the whole history: rulings S462 "b", Q10, Q11, Q12, rounds 1–4) and its BRIEF.md.

## Round 5 findings (re-review #5 of df6fddc4b = FIX-FIRST; reviewer-reproduced in happy-dom)
P1-a (HIGH): `escapeParams` (narrowing-write-set.ts ~:303, non-greedy `/^\(([\s\S]*?)\)\s*=>/`) misreads a param list containing a nested-arrow default or a string with `)=>`: `function noop() { @out = "z" }` · `function show(q) { const run = (f = () => 1, noop) => { if (@user is given) { noop(); @out = @user.name } }⏎ run(1, clear) }` → exit 0, runtime TypeError (`noop` borrows the file fn's empty write set). Also `(f = ")=>", noop) =>`.
P1-b (HIGH): `arrowBodyText` (type-system.ts ~:31754) depth scanner skips quotes but not REGEX literals: `if (@user is given) { @words.forEach((w, i = /\)/) => { @out = @user.name; clear() }) }` → exit 0, runtime TypeError; also `(w, i = /\) => { 1 }/) => { …real body… }`.
These are overlay Rule 7 violations (text scanners in a post-AST stage = second/third readers of text acorn already parsed).

## THE FIX — structural, delete both scanners (reviewer's concrete locus, PA-located-verify)
In `compiler/src/expression-parser.ts`, the `case "ArrowFunctionExpression" / "FunctionExpression"` block-body branch (~:3224-3280) already has `const params = convertParams(node.params, …)` (~:3229) and acorn's `bodyNode` (BlockStatement, `start`/`end` in `rawSource` coordinates) — and discards them for block bodies when it builds the escape-hatch. Put the structured `params` and the acorn-delimited body text (`rawSource.slice(bodyNode.start, bodyNode.end)`, or offsets relative to `raw`) ON the escape-hatch node. Then `checkOptionalMemberAccess` / the write-set reader re-parse that exact body and declare params via `boundNamesOf` over the STRUCTURED params. DELETE `arrowBodyText` and `escapeParams` (and any other raw-text arrow/param scanner you find in presence-narrowing.ts / narrowing-write-set.ts / type-system.ts — grep). The checked text must be, by construction, the text codegen emits. Verify codegen output is byte-identical (the escape-hatch node gains fields; emission must not change) — artifact differential over the corpus.
Also: all P1-a/P1-b repros + the reviewer's held shapes (default `"}"`, `")"`, `"=> { }"`, `({ b = { c: 1 } } = {})`, nested-arrow default, body strings with braces, comment between `)` and `=>`, `function (w, i) {…}`, named fn expr, rest, `(a = 1)`) as unit tests.
§34 provenance (reviewer-verified census blind spot): rewrite the E-TYPE-046 rows' emitter note WITHOUT the line number, as `` `compiler/src/type-system.ts` `checkOptionalMemberAccess` `` so the census checks the SYMBOL (it never validates `:N`). Run `bun scripts/s34-census.ts --check-new --base 42d1a7459` and confirm it now resolves the symbol.
File a LOW gap: `stdlib/auth/index.scrml` produced different diagnostics under parallel load on both trees (nondeterminism, cause unverified) — locus searched:.
LOW conservative nit (do not fix unless trivial): `if (@box is given) { clear(); @user = @box.owner; @out = @user.name }` fires (a narrowed cell's field isn't treated as present) — note in progress.md.

## HOLD
The event-handler-as-closure reading (`<div if=@user><button onclick={ @out = @user.name }>` → E-TYPE-046) awaits bryan's Q18 ruling; the PA will message you — do not change it now.

## Gates (ALL incl. CI-only)
pre-commit · unit `s462-narrowing-ends-on-write.test.js` · conformance · browser tier as ci.yml · types:check · tracking tiers (integration + lsp + commands) as ci.yml after pretest · `bun scripts/s34-census.ts --check-new --base 42d1a7459` · bootstrap slices · corpus re-measure (base 42d1a7459 vs head over samples/ examples/ stdlib/ conformance/ + `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/`): 0 new fires expected; artifact differential: 0 emitted-JS changes from the escape-hatch node change.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped progress.md (in docs/changes/s462-narrowing-ends-on-write/progress.md — continue the existing log) · first commit `WIP(s462-narrowing-round5): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-narrowing-round5/` · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · the structural change (fields added, scanners deleted, grep proof none remain) · P1-a/P1-b before/after · artifact differential result · corpus measure · gates.
