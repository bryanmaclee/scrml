# sPA ss4 — block-splitter-native-parser

**Launch:** `read spa.md ss4` · **Branch:** `spa/ss4` · **Worktree:** `../scrml-spa-ss4`

**Fill:** ~55% · `healthy` (multiple same-ingestion parse-front-end items; big M2-M6 flip arc → Bucket B)

## Shared ingestion
Block-splitter + native-parser parse-context: `block-splitter.js`/`.ts`, `component-expander.ts`,
`native-parser/lex.js`+`token.js`, `ast-builder.js` (fn-decl span computation + block-analysis
upstream). Shared understanding = how the splitter recognizes match arms across lift/each contexts +
how fn-decl spans are computed. The block-match-in-lift parse-context gap, the fn-span overshoot
(ast-builder upstream), and the 3 lexer residuals all key on the parse-front-end understanding. (Big
M2-M6 native-parser flip arc routed to Bucket B as a standing user decision.)

## Core files
`compiler/src/block-splitter.js` · `compiler/src/component-expander.ts` · `compiler/src/ast-builder.js` · `compiler/native-parser/lex.js` · `compiler/native-parser/token.js`

## Items (least-ingestion-first)
1. **`g-block-match-in-lift-misparsed-as-components`** `[status=open]` LOW · tier med — block `<match>` inside `${ for … lift }` mis-parses arms as components → misleading `E-COMPONENT-035`. a per-item block `<match for=T on=expr>` inside a Tier-0 `${for…lift}` loop: arm tags `<Open>`/`<Closed>` not recognized as match arms in the lift context, fall to uppercase-tag→component path, rejected `E-COMPONENT-035` + `E-COMPONENT-020` with a phantom 'cross-file component import' hint. SAME block `<match>` inside Tier-1 `<each>` works. Fails LOUD (not silent) — DX/error-quality + parse-context gap. Confirmed HEAD; giti inbox 2026-06-20-1215. giti renders lists mostly via `${for…lift}`. status=open.
   > **Brief seed:** Two fix shapes (PA picks): (a) SUPPORT block-`<match>` inside `${…lift}` by extending match-arm recognition into the Tier-0 lift loop body (port the `<each>`-path recognition — the cohesive fix, touches the lift parse-context); OR (b) emit a TARGETED diagnostic 'block `<match>` not supported inside `${…lift}`; use `<each>`' replacing the misleading `E-COMPONENT-035/020` (lowest-effort). Workaround = `<each>`.
2. **`native-parser-lexer-3-residuals`** `[status=open]` LOW · tier med — 3 byte-identical native-vs-Acorn lexer residuals (decl-class, expr-optional-chain, expr-template-literal). 5/8 M1.2-* bench files flipped to byte-identical (M1.3/M1.5 normalizers landed, integrated ss4). 3 genuine residuals stay skipped: decl-class, expr-optional-chain, expr-template-literal. `native-parser/lex.js` + `token.js`; `parser-conformance-lexer.test.js:581`. status=open (residual).
   > **Brief seed:** Close the 3 remaining byte-identical lexer residuals (decl-class, expr-optional-chain, expr-template-literal) in native-parser/lex.js + token.js. Per-residual normalizer like the 5 already flipped; re-measure parser-conformance-lexer.test.js:581.
3. **`g-block-analysis-fn-span-overshoot`** `[status=open]` MED · tier med — every local function-decl block's byte end/endLine overshoots into the next function. in `messages.scrml` every LOCAL fn block's end/endLine overshoots into the next fn (`getCurrentUser`'s `}` at line 38 but block end=line 40 inside `fetchMessages`); all 11 adjacent pairs share a boundary line. Root = function-decl span computation in parser/ast-builder.js (UPSTREAM of block-analysis.ts; distinct from the D6 channel-import root, also surfaced as a SEPARATE PA finding from the LANDED D6 fix). NOT adopter-facing (block-analysis is non-shipping flogence tooling); blocks clean block-lease assignment. The prior 'other 11 blocks correct' claim was WRONG. status=open.
   > **Brief seed:** Fix function-decl span end/endLine computation in ast-builder.js so each fn block's byte end lands at its OWN closing brace, not the next fn's boundary. R26 against `messages.scrml` (11 adjacent pairs); this is the separate ast-builder bug surfaced by the LANDED ss14 D6 block-analysis fix.

## Progress
`ss4.progress.md`. Land on `spa/ss4`; ping PA inbox when ready. Do not advance main / do not push.
