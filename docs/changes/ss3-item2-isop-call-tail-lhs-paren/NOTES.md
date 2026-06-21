# ss3 item2 — g-isop-call-tail-lhs-paren-miscompile

**Branch:** `spa/ss3` · **Mode:** sPA-direct · **Base:** aae34c26 (item1 landing)

## Bug (R26-reproduced, library mode)

`re.exec(s) is some` (an is-op whose LHS ends in a **call**) emitted
`re.exec((s) != null)` in `--mode library` — the receiver `re.exec` was swallowed
into the comparison; only the call's OWN argument-parens `(s)` became the
null-check. Valid JS, NO `E-CODEGEN-INVALID-JS` — **silent-WRONG**. The
client/AST path was already correct (`rewriteIsPredicates` → `scanLhsLeft`); only
the LIBRARY line-by-line string-rewrite (`emit-library.ts` →
`rewriteIsOperator(rewriteNotKeyword(line))`) was affected.

## Root

`_rewriteParenthesizedIsOp` (`codegen/rewrite.ts`) is the Phase-A handler for the
parenthesized form `(expr) is X`. It matched the `)` immediately before
` is some` and walked back to its balanced `(` — but for `re.exec(s) is some`
that `)` closes the CALL, so the walk landed on the call's `(`, capturing only
`(s)`. It blindly treated those call-arg parens as a grouping `(expr)`.

## Fix

Distinguish a GROUPING paren from a CALL paren by the char immediately left of
the matching `(` (whitespace-tolerant):

- `)` / `]` → a curried/chained call (`f()()`, `arr[i]()`) → CALL paren.
- an identifier → a callee → CALL paren, UNLESS the identifier is a keyword that
  introduces a grouped expression (`return (x)`, `typeof (x)`, `await (x)`,
  `not (x)`, …) — a keyword `(` is GROUPING, not a call (`PAREN_PRECEDING_KEYWORDS`).
- anything else → GROUPING paren (unchanged behaviour).

For a CALL paren the real LHS is the WHOLE call/member chain ending at the matched
`)`. Captured single-eval via `_scanChainStartLeft` (the string-rewrite twin of
expression-parser.ts `scanLhsLeft` — a balanced-bracket, whitespace-tolerant
leftward scanner), emitting `(re.exec(s) != null)`. Single-evaluation (not the
double-eval `!== null && !== undefined` regex form) is preserved — calls have
side effects, so evaluating the chain once is load-bearing.

## Why NOT just the DOTTED_LHS regex

The seed suggested extending the `DOTTED_LHS` regex to call-tails, but
`_rewriteParenthesizedIsOp` runs FIRST and would still mis-grab `(s)` before the
regex saw the line. And the regex form double-evaluates the LHS — fine for an
index read, WRONG for a side-effecting call. Fixing the paren-walker is the
documented design intent (the existing comment routes call-tails through it).

## Keyword-swallow edge (found + fixed during R26)

First cut mis-read `(re.exec(s)) is some` — the explicit-grouping form — as a
call because `return` precedes the `(`. Added the keyword exclusion;
`(re.exec(s)) is some` → `((re.exec(s)) != null)` and
`return re.exec(s) is some` → `return (re.exec(s) != null)` (chain base stops at
`re`, `return` preserved).

## Verification

- R26 value-assert (ran the emitted ES modules): 14/14 runtime assertions across
  call / nested-call / member-chain-call / index-member-call / explicit-group /
  is-not / is-not-not — all correct. `node --check` clean.
- The bare-ident / dotted regex path is untouched (`x is some`,
  `obj.prop is some` still emit the double-eval `!== null && !== undefined` form).
- +9 unit tests `not-keyword.test.js` §5k-§5r. Full suite green.

## Relationship to item1

Same ss3 shared-ingestion cluster (the paren/span serializer family) but a
DISTINCT locus: item1 = the CLIENT ExprNode serializer (emit-expr.ts); item2 =
the LIBRARY string-rewrite (rewrite.ts). The seed's "one fix may cover both"
hypothesis was R26-FALSIFIED — two pipeline stages, two fixes.
