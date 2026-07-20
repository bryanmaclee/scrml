# BRIEF — GITI-039: literal markup TEXT expression-lexed in ternary/dynamic-markup emit

Dispatched S271 (bryan), 2026-07-19. Baseline main `72ba19d6`. Agent: `scrml-js-codegen-engineer`, `isolation:"worktree"`, opus, background. This file is the verbatim dispatch prompt (archival).

---

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST, then its Task-Shape Routing for a parser/codegen change (`structure.map.md`, `dependencies.map.md`). Maps stamped `99ae45ca` (pre-#108/#110/#111); the loci below are current-truth (verified against `72ba19d6` by a fresh trace). Report any map/source divergence.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)
1. FIRST: `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP + report.
2. `git rev-parse --show-toplevel` == worktree root; clean tree.
3. `bun install` (worktrees don't inherit node_modules — hook fails "cannot find package 'acorn'" otherwise).
4. `bun run pretest` (gitignored browser fixtures). Use `bun run test` for baselines.
5. Edits use worktree-ABSOLUTE paths; NEVER `cd` into main; `--cwd "$WORKTREE_ROOT"` / `git -C "$WORKTREE_ROOT"`. First commit: `WIP(giti-039): start at $(pwd)`.
6. Commit after every edit + append-only `progress.md`.

## THE BUG (GITI-039, P1)
Literal markup TEXT content inside a `${...}`-interpolated markup value (ternary-arm, bare markup-value, derived-cell markup ternary, etc.) is run through the EXPRESSION tokenizer, which space-separates same-line tokens.
- **Defect A (silent, exit-0):** `${ true ? <p>Read file a.txt now</p> : "" }` emits `createTextNode("Read file a . txt now")` (`a.txt` → `a . txt`; `v1.2.3` → `v1 .2 .3`).
- **Defect B (hard fail):** `${ true ? <p>Comma, bang! query? colon: semi;</p> : "" }` → `E-CODEGEN-INVALID-LOGIC`, exit 2.
- **STATIC control is CORRECT:** `<p>Read file a.txt now</p>` outside a ternary → verbatim in the `.html`.

## ROOT CAUSE (traced, verified on `72ba19d6`) — the emit sites are INNOCENT
The corruption is UPSTREAM in the parser, NOT the `createTextNode` emitters (they faithfully `JSON.stringify` whatever text they're handed).
- **THE ROOT:** `compiler/src/ast-builder.js:3927-3935` `joinWithNewlines(parts, partLines)` — reassembles collected tokens and ALWAYS inserts a separator between same-line parts: `const sep = (partLines[i] > partLines[i-1]) ? "\n" : " "`. It has only LINE numbers, never source-span adjacency → `a`,`.`,`txt` (same line) → `a . txt`.
- `collectExpr` (`ast-builder.js:4739`) collects the whole `${...}` body (incl. the markup's literal text) via `joinWithNewlines` BEFORE anything knows it's markup.
- `parseExprWithMarkupValues` (`ast-builder.js:3674`, slice at `:3778`, re-tokenize at `:3800`, wrap `markup-value` at `:3824`; bail-`null` on unbalanced at `:3760`) recovers the markup by re-slicing text children out of the ALREADY-SPACED string → text child = `"Read file a . txt now"`. Entry: `safeParseExprToNode` (`:3523-3529`).
- **WHY the static path is correct (the fix template):** `parseLiftTag` text coalescing at `ast-builder.js:5104-5128` is SPAN-GAP-AWARE — `if (prev.kind==="text" && t.span.start > prev.span.end) prev.value += " " + t.text; else prev.value += t.text;` → adjacent tokens (no gap) concatenate with NO separator → `a.txt` verbatim. Static markup / `lift <markup>` / `<each>` static text / `return <markup>` all use `parseLiftTag`.
- **Defect B is the SAME root escalated:** punctuation (`;`/`?`/`:`) perturbs `collectExpr`'s `ternaryDepth` + the depth-0 `;` break truncates collection (the `;` break checks brace depth, not ternaryDepth) → `<p>` never closes → `parseExprWithMarkupValues` balanced-span scanner bails `null` → fallback to acorn on the mangled string → SyntaxError → escape-hatch raw → `validate-emit.ts:74-94` acorn gate → `E-CODEGEN-INVALID-LOGIC`. Not a second bug — a severity gradient off the one locus.
- **RED HERRING (do NOT chase):** `rewritten` at `emit-each.ts:730` is `rewriteContextualSigil` (`@.`-only), NOT the mangle.

## THE FIX (Option A — the single-point recommended fix)
Make the token-rejoin SPAN-GAP-AWARE inside markup regions.
- `collectExpr` already tracks `angleDepth`. Thread a parallel **`partSpans`** array alongside `parts`/`partLines` (capture each token's source span as it's collected).
- In `joinWithNewlines` (`ast-builder.js:3927`), emit **NO separator** between two tokens whose source spans are ADJACENT (`prevSpan.end === curSpan.start`) — mirroring `parseLiftTag`'s logic at `ast-builder.js:5115-5120`. A real source gap → one space (or `\n` across lines) as today.
- **CRITICAL SCOPING — the load-bearing blast-radius constraint:** apply the span-adjacency rejoin ONLY inside markup regions (`angleDepth > 0`). Pure-expression output (`angleDepth === 0`) MUST stay **BYTE-IDENTICAL** to today — downstream string-rewrite passes depend on the current spacing (see `expression-parser.ts:3003` comment "matches collectExpr's joinWithNewlines which adds spaces"). Changing pure-expression spacing WILL break downstream passes. This is the #1 thing your fix must NOT do.
- This single change repairs ALL 7 affected consumer paths at once (they all consume `parseExprWithMarkupValues` output) AND fixes Defect B (markup preserved verbatim → `<p>…</p>` closes → the span scanner balances → no escape-hatch fallback).
- In-repo precedent: `return <markup>` (`ast-builder.js:8416-8424`) already routes through `parseLiftTag` EXPLICITLY to dodge the collectExpr mangle. GITI-017 fence precedent: `code-segments.ts:1-17`.
- (Option B — re-derive text children from raw source in `parseExprWithMarkupValues` — is more invasive [needs source/offset plumbing not in the `parseLogicBody` closure]; use A unless A proves unworkable, and report if so.)

## BLAST RADIUS (the fix must make ALL correct, and NOT regress the NOT-affected set)
**AFFECTED (must become verbatim), all via `markup-value` dispatch `emit-expr.ts:638` [+ each twin `emit-each.ts:882`]:** (1) ternary-arm interp `${cond ? <m> : …}`; (2) bare `${<m>}`; (3) derived-cell markup ternary `const <badge> = @n>0 ? <span>…</span> : …`; (4) `<each>` per-item markup-value ternary `${@.active ? <span>ON</span> : ""}`; (5) match-arm markup-value; (6) engine state-child markup-value; (7) variant-guard conditional markup arm (`emit-variant-guard.ts:556-568`).
**NOT affected (must stay byte-identical):** static top-level (`emit-html.ts:1350`), `lift <markup>` blocks, `<each>` per-item STATIC text (`emit-each.ts:690-731`), `return <markup>` (`emit-logic.ts:2647` via parseLiftTag), `if=`/`show=` blocks, reactive re-render wiring.

## VERIFICATION (MANDATORY — observe emitted output, do NOT trust green alone)
1. **Defect A:** each of the 7 affected shapes with a dotted-text literal (`a.txt`, `v1.2.3`) → the emitted `createTextNode(...)` string is VERBATIM (`"Read file a.txt now"`, `"v1.2.3"`). Build a probe per shape; grep the `.client.js`. (Construct the ternary, bare, derived-cell, each-per-item, match-arm, engine-arm, variant-guard cases.)
2. **Defect B:** `${ true ? <p>Comma, bang! query? colon: semi;</p> : "" }` → compiles exit-0 AND emits the verbatim punctuation text.
3. **Static control unchanged:** `<p>Read file a.txt now</p>` outside a ternary → still verbatim.
4. **PURE-EXPRESSION BYTE-IDENTITY (the critical regression gate):** compile a set of real corpus samples with NON-markup `${...}` expressions (arithmetic, member chains, ternaries WITHOUT markup, string ops) on your post-fix baseline vs a clean `72ba19d6` checkout, and confirm the emitted `.js` is BYTE-IDENTICAL for the pure-expression paths. Any diff in pure-expression emit = the fix leaked out of the markup region → FIX THE SCOPING. Report the exact diff command + result.
5. **Full suite green** (`bun run test`). Add unit coverage for the 7 shapes + a regression fixture for the giti repro-36 shape.

## THE REPRO (write to `<worktree>/repro36.scrml`, compile each block SEPARATELY per giti's method note — multiple sequential ternary-markup blocks trip the separate GITI-032 family)
```
<program>
  <page>
    ${ true ? <p>Read file a.txt now</p> : "" }
  </page>
</program>
```
(+ construct the Defect-B punctuation variant + the other 6 affected shapes + the static control, each in its own file.)

## REPORT BACK
Workspace pwd, final SHA, files-touched, per-shape verbatim-text results (all 7), Defect-B compile result, the pure-expression byte-identity diff command + result, full-suite counts, and whether you used Option A or fell back to B (with reason). The PA runs an independent S239 adversarial `/code-review high` (the pure-expression byte-identity is the key blast-radius risk) + re-verifies before landing.
