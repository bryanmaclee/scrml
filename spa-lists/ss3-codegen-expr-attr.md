# sPA ss3 — codegen-expr-attr

**Launch:** `read spa.md ss3` · **Branch:** `spa/ss3` · **Worktree:** `../scrml-spa-ss3`

**Fill:** ~55% · `at-ceiling` (post-S210 big-wave drain; same-ingestion siblings integrated or routed to design)

## Shared ingestion
Codegen expression/attribute lowering surface: how bare-compound is-ops, is-op ternaries, and
`@.`-sigil expressions are rewritten/lowered at the codegen-expr stage. Shared loci:
`codegen/rewrite.ts` (`_rewriteParenthesizedIsOp`), `emit-event-wiring.ts`, `emit-html.ts`, the
expr-parser `scrmlAtPlugin` `@.` path, plus the attribute-condition fallback-rewrite path. All three
items are attribute/expr-condition lowering bugs reachable from the same understanding of the
attr-fallback + is-op rewrite machinery.

## Core files
`compiler/src/codegen/rewrite.ts` · `compiler/src/codegen/emit-event-wiring.ts` · `compiler/src/codegen/emit-html.ts` · `compiler/src/expression-parser.ts`

## Items (least-ingestion-first)
1. **`g-attr-bare-compound-is-op-silent-drop`** `[status=open]` MED · tier med — `<p if=fn() is not>` drops the `is not`, emits `if((fn()))` (truthiness, INVERTED), no diagnostic — `is`/`is not` not in cluster-A op-set so `E-ATTR-UNQUOTED-OPERATOR` doesn't fire. Paren form correct; logic-body bare-compound works (AST-level). Locus = attribute-condition fallback rewrite `codegen/rewrite.ts` `_rewriteParenthesizedIsOp`:734-789. status=open verified HEAD 956460af.
   > **Brief seed:** DIRECTION RATIFIED S209 (user 'b'): REJECT-with-parens — extend `E-ATTR-UNQUOTED-OPERATOR` family to require the parenthesized form (limit-not-widen, §5.2/§17.1 cluster-A rule). R26 verify the silent-wrong inversion reproduces before fix; assert the paren form stays correct.
2. **`bug-18`** `[status=open]` LOW · tier med — GITI-015 — is-op ternary with computed-LHS not lowered (`E-CODEGEN-INVALID-JS`). `arr[i+1] is some ? a : b` (is-op ternary + computed-LHS) NOT lowered → caught LOUD by `E-CODEGEN-INVALID-JS` (was SILENT at cbfefef). R26 REPRODUCED on HEAD (ss14 item6 de-stubbed). Repro `handOffs/incoming/read/2026-05-23-0703-giti-015-is-some-ternary-with-computed-lhs.scrml`. known-gaps:1552. giti inbox needs:action.
   > **Brief seed:** Lower the is-op ternary with a computed-LHS at the codegen-expr stage. Mirror the existing is-op lowering for non-computed LHS. R26 against the giti repro; value-assert (not just compiles).
3. **`g-each-body-sigil-root-expr-parser`** `[status=open]` LOW · tier low — `<each>`-body `@.`-sigil expr-parser gap (root of the ss14 classifier false-positive). PA FINDING from ss14: the expr-node-corpus-invariant classifier fix (landed) stops the false-positive only; ROOT is expr-parser `scrmlAtPlugin` `@.` gap (Phase-2). bare `@.`/`@.field` in `<each>` body ParseErrors. §17.7.3 `@.` grammar; `E-SYNTAX-064` fires `@.` outside `<each>`.
   > **Brief seed:** Close the expr-parser `scrmlAtPlugin` `@.`-sigil parse gap so bare `@.`/`@.field` inside an `<each>` body parse cleanly (Phase-2 expr-parser surface). Cross-check §17.7.3 grammar; the classifier whitelist is a band-aid over this.

## Progress
`ss3.progress.md`. Land on `spa/ss3`; ping PA inbox when ready. Do not advance main / do not push.
