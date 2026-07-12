# progress — string-blind-scanners-tokenizer-2026-07-12

WORKTREE: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa5d2156710971af7
Base: main @ 40b580c5

## Startup (done)
- pwd == worktree; rev-parse == worktree; clean; `bun install` OK; `bun run pretest` OK.
- Map read: `.claude/maps/primary.map.md` (index). Load-bearing facts: server/client boundary is
  INFERRED from usage; a fail-closed acorn-exact scan (E-CG-001) backstops leaks. Routed to
  domain/error maps for detail (not needed further — bug is in named source files).

## Empirical reproduction (R26 discipline — both FPs confirmed on base)
- #2 FP: client fn with `@msg = "docs mention Bun.serve(x)"` -> errors `[E-CPS-NONIDEM-NO-STORAGE]`,
  serverJs has `__ri_route` (spurious server-escalation). CONFIRMED.
- #1 FP: client fn with `s.replace(/there is no match/i, "ok")` -> errors `[E-EQ-005]` (false). CONFIRMED.

## Characterization findings

### route-inference.ts (#2)
- `detectServerOnlyResource(expr:string)` regex-scans a string built from
  `emitStringFromTree(exprNode)`. `emitStringFromTree` renders a string-literal node as its quoted
  content, so `Bun.serve(` inside a `"..."` literal matches the regex -> FP. Called at 4 sites:
  bare-expr (1120), let/const/tilde-decl (1255), state-decl (1322), return-stmt/throw-stmt (1383).
- Precedent for the fix already exists: `exprNodeCallsPrintBuiltin` (:543) — AST-node print detector,
  string/comment-safe by construction. Test model: print-builtin-compile.test.js sec D2.
- ExprNode shape (from emitStringFromTree): member `{kind:"member",object,property,optional}`,
  call `{kind:"call",callee,args}`, new `{kind:"new",callee,args}`, ident `{kind:"ident",name}`.
  `Bun.serve(x)` == call(callee=member(object=ident"Bun",property="serve")).

### expression-parser.ts (#1)
- `rewriteIsPredicates` (:1259) forward-scans, ALREADY skips `"`/`'`/backtick STRING interiors via
  its own inString tracking, but NOT regex or comment interiors -> `/there is no.../i` FPs.
- `preprocessForAcorn` runs is-lowering (1464) UN-fenced, but not/or/and-lowering (1516/1598) ARE
  fenced through `rewriteCodeSegments` (GITI-017, code-segments.ts).
- The GITI-017 fence IS sound / context-tracking: `regexAllowedAfter(codeBefore)` decides
  regex-vs-division by the ECMA preceding-token rule (permissive keyword set + operator-position
  punctuation), NOT a raw-char-only heuristic. This is exactly what the S244 raw scanner lacked.
- CRUX: naive `rewriteCodeSegments`-wrap of rewriteIsPredicates BREAKS `scanLhsLeft` — an `is`
  LHS can span a string/regex literal (`foo("bar") is some`); the fence would fragment the code
  segment (`foo(` | `"bar"` | `) is some`) and scanLhsLeft(`) is some`) fails (no matching `(`).
  => Cannot fully fence the transform. Instead: extend rewriteIsPredicates' OWN forward scanner to
  ALSO skip regex + comment interiors (reusing the imported `regexAllowedAfter` for the regex-open
  decision). Keeps the single-pass full-string scan intact (LHS-spanning preserved), adds only
  "skip `is` inside regex/comment". This is the faithful realization of "route through the fence".

## Plan (DONE)
1. #2: add `exprNodeCallsServerOnlyResource` AST detector (Bun.*/process.* member set); split
   SERVER_ONLY_PATTERNS -> keep Bun/process as a string FALLBACK for the rare exprNode-absent path
   (fail-closed, no leak); wire the unified `detectServerOnlyResourceForNode` at ALL sites. + tests.
2. #1: extend rewriteIsPredicates scanner with regex/comment skipping via regexAllowedAfter. + tests.
3. Adversarial matrix (S244 failure modes) before DONE.

## CRITICAL AUDIT (the S244-class trap avoided)
Removing Bun.*/process.* from the shared SERVER_ONLY_PATTERNS string set meant EVERY caller of
`detectServerOnlyResource` would lose Bun/process detection = a false-negative LEAK if not re-wired.
There are 7 detection sites across 4 functions (walkBodyForTriggers x4, scanExprNodeField,
hasServerOnlyResourceInInit, controlFlowContainsServerTrigger, isServerTriggerStatement x2). ALL
were routed through the new unified `detectServerOnlyResourceForNode(exprNode, str)` so the AST
detector runs at every site (fail-closed string fallback only when no exprNode). Verified: every
site now escalates on a genuine Bun/process access.

## BOTH FIXES — implemented + landed
- #2 committed `24d56e97`: route-inference.ts + route-inference-namespace-signal-ast.test.js (10 cases).
- #1 committed `ded89d74`: expression-parser.ts + is-predicate-regex-comment-literal-blind.test.js (10).
- No NEW diagnostic codes introduced (both fix false-POSITIVES on existing E-CPS-NONIDEM-NO-STORAGE
  / E-EQ-005) -> no SPEC §34 rows needed. No SPEC touched.

## ADVERSARIAL before/after matrix (empirical, via compileScrml)
### #2 g-route-inference-signals-string-blind
| case                                          | BEFORE (base 40b580c5) | AFTER            |
|-----------------------------------------------|------------------------|------------------|
| `@msg="docs mention Bun.serve(x)"` (client)   | escalated + E-CPS FP   | client, no errs  |  <- FP FIXED
| `Bun.serve(` in a // comment                  | escalated FP           | client, no errs  |  <- FP FIXED
| `foo.Bun.serve()` (Bun as property)           | escalated FP (regex)   | client, no errs  |  <- precision gain
| genuine `Bun.serve({...})` in web fn          | escalated              | escalated,no leak|  <- TP preserved
| genuine `process.argv` in return              | escalated              | escalated,no leak|  <- TP preserved
| `let f = Bun.file("/x")` init                 | escalated              | escalated        |  <- TP preserved
| ADV `x++ / process.env.PORT` (S244 leak)      | (S244 raw-scan leaked) | escalated,no leak|  <- leak class GONE (AST, no `/`-scan)

### #1 g-is-predicate-scanner-regex-literal-blind
| case                                          | BEFORE | AFTER            |
|-----------------------------------------------|--------|------------------|
| `/there is no match/i` regex literal          | E-EQ-005 FP | no E-EQ-005 |  <- FP FIXED
| `is` in a // line comment                     | E-EQ-005 FP | no E-EQ-005 |  <- FP FIXED
| `is` in a /*...*/ block comment               | E-EQ-005 FP | no E-EQ-005 |  <- FP FIXED
| real `x is 0` (value RHS)                     | E-EQ-005    | E-EQ-005    |  <- TP preserved
| `x is not` absence predicate                  | clean       | clean       |  <- TP preserved
| LHS spans string `foo("bar") is not`          | clean       | clean       |  <- no fragmentation
| LHS spans regex `/a/.test(x) is not`          | clean       | clean       |  <- no fragmentation
| `(x / y) is not` (division, not regex)        | clean       | clean       |  <- regexAllowedAfter=div
| ADV `x++ / y is not` (unterminated-regex bail)| clean       | clean       |  <- `/` treated as code

RESIDUAL #1 (documented, acceptable): a CONTRIVED `x++ / y is 0 / z` (post-inc division admitted as
regex-open by `++`, value-RHS `is` between two closing slashes) suppresses that ONE E-EQ-005 lint.
Missed LINT, never a leak (E-EQ-005 is not a boundary), and the SAME conservative masking the
already-shipped not/or/and fence exhibits. No valid-code parse-error regression.

## S239 SECURITY RE-REVIEW — Finding 1 (HIGH leak) FIXED  [commit f0c9c10f]
The PA's independent S239 review caught a false-NEGATIVE LEAK in the #2 AST detector:
`exprNodeCallsServerOnlyResource` matched only a member whose `object` was the bare ident
`Bun`/`process`, so a `globalThis.`/`window.`-rooted chain (the canonical explicit global access)
did NOT escalate and SILENTLY shipped to the client:
  - `globalThis.Bun.serve({port})`, `globalThis.Bun.file("/etc/passwd")`, `globalThis.process.cwd()`,
    `window.Bun.file(...)`, `self.process.argv`, `globalThis.process.env.X`.
Root: for `globalThis.process.env` the `process.env` member's `object` is a member
(`globalThis.process`), not an ident. NOTE: base's string regex `\bBun\.serve\(` DID catch the
dot-form `globalThis.Bun.serve(` (substring match) — so my AST migration REGRESSED it. A regression
= a leak.

FIX (AST-only — NO raw-string fallback, which would reintroduce the string-literal FP): new
`resolveServerOnlyNamespaceRoot` unwraps a leading `globalThis`/`window`/`self`/`global` prefix,
treating `globalThis.Bun` / `window.process` as EQUIVALENT to the bare global. A USER local
(`foo.process.env`) is NOT unwrapped → FP fix preserved.

Re-verified matrix (all pass):
  globalThis.Bun.serve / globalThis.Bun.file / globalThis.process.cwd / globalThis.process.env /
  window.Bun.file / self.process.argv  -> escalate=TRUE, no Bun./process. in clientJS.
  user `foo.process.env` -> escalate=FALSE (FP preserved). string "globalThis.Bun.serve" -> FALSE.
  bare Bun.serve()/process.env.X -> escalate=TRUE. +7 regression tests added.

PRE-EXISTING (NOT a regression; distinct from Finding 1; out of "Only Finding 1" review scope) —
surfaced for PA: the COMPUTED bracket form `globalThis["Bun"].serve()` / `Bun["serve"]()` does NOT
escalate and leaks. Base's string regex ALSO missed it (no literal `.serve(`), so this is a
pre-existing computed-member-access hole in BOTH the old and new detector — same class as the
E-ROUTE-001 computed-access warnings. Recommend a separate ticket if the egress E-CG-001/006 backstop
is deemed insufficient here.

## Test gate
- New: 27 cases (17 #2 incl. 7 globalThis/window + 10 #1), all pass.
- Full pre-commit suite (unit+integration+conformance, --bail): 20051 pass / 0 fail / 65 skip / 1 todo
  across 1100 files (180s). Zero new failures.
