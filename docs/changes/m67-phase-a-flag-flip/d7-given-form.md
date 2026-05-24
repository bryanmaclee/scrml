# M6.7-D7 — FIX-NATIVE: the `given x [, y]* => { body }` presence-guard form

Worktree: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a565e090358275ad0
Branch:   worktree-agent-a565e090358275ad0
Startup pwd: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a565e090358275ad0
Base HEAD: 003ee3a8 (S127 close). bun install + pretest clean.

Maps consulted: primary.map.md (full) + Task-Shape Routing "Native-parser bug fix" row.
**Maps feedback:** primary.map.md was consulted; load-bearing finding = the routing
row correctly pointed at the native-parser surface, BUT the watermark's claim "native
sources UNCHANGED" is now STALE (D1/D2/C1/C2 landed parse-stmt/translate-stmt changes
since 3a909c1d). The function-level landmarks were NOT in primary.map.md (it is an index,
not a function map) — I navigated via grep + the live ast-builder oracle, not the map.
Recommend a native-parser function-landmark refresh before the next D-unit.

## Phase 0 — ROOT-CAUSE CONFIRMATION (pinned via DIRECT parser calls)

### The brief's bucket label (§42, `given x => ...`) was IMPRECISE — pinned the real shape.
SPEC §4.11.4 defines `given` as the machine-rule-guard keyword (`given (expr)`), "a valid
identifier in all other positions". The REAL live-accepted form firing in the corpus is the
**SPEC §42.2.3 presence guard** `given ident [, ident]* => { body }` (narrows `T | not` to
`T`; multi-var is all-or-nothing). The live ast-builder produces a `given-guard` LogicStatement
(ast-builder.js:5485 / 9477 — two identical sites): `{kind:"given-guard", variables, body, span}`.

### DIRECT-parser pre-check (parseProgram(lex(src),src) for native; splitBlocks+buildAST for LIVE)
| Form | LIVE (oracle) | NATIVE (before) |
|---|---|---|
| `given name => { ... }` (stmt)     | given-guard{variables:["name"], body:[...]} | E-EXPR-UNEXPECTED:KwGiven + E-STMT-UNEXPECTED-TOKEN |
| `given a, b => { ... }` (multi)    | given-guard{variables:["a","b"], body:[...]} | same cascade |
| `given n` inside `match { }` arm   | given-guard{variables:["n"], body:[]}        | E-EXPR-MATCH-PATTERN cascade |
| `is given` (presence suffix)       | clean                                        | clean (already handled, parse-expr.js:2468) |
| `given + 1` / `given(x)` (ident expr) | binary/ident — `given` is a bare ident   | (was cascade; now consumed by the stmt arm) |

### ROOT CAUSE (confirmed in native source)
The native lexer lexes `given` -> `KwGiven` UNCONDITIONALLY (token.js:213 — a HARD keyword,
not contextual). But `parsePrimary` had NO `KwGiven` arm AND the statement dispatcher
(parse-stmt.js:480) had no `given` arm. So a statement-position `given` fell through to
parseExprStatement, where KwGiven is not a valid expression head -> E-EXPR-UNEXPECTED:KwGiven,
the stranded cursor cascaded to E-STMT-UNEXPECTED-TOKEN ("no statement begins here"), bailing
the whole `${...}` block. Inside a `match { }` arm the same KwGiven-unhandled fault cascaded
through E-EXPR-MATCH-PATTERN. The `is given` suffix was the ONLY place native handled KwGiven.

### ONE production gap, BOTH positions — D3b SUBSUMED.
The standalone form and the in-match-arm form share ONE root cause: the missing statement-
position `given` production. A `match { }` body is parsed by the SAME statement-list parser
(`parseStatementList`), so the single new `parseGivenGuard` arm closes BOTH. The D3b follow-on
("given-binding in match arms") is therefore **SUBSUMED** by this unit — verified: the in-match
`given n` now produces the matching given-guard node (parity-check.mjs). The match fixture's
REMAINING native errors are the match-arm `->`/`:>` thin-arrow inline form (`not -> handleAbsence()`,
`-> handlePresence(n)`) — a SEPARATE cluster (the D3 match-arm domain), NOT the given form.

### parity-COMPLETENESS, NOT subset expansion — confirmed live accepts the exact forms.
LIVE accepts the standalone `given x => {body}` cleanly and emits a proper given-guard
(realErrs []). NOT corpus-stale. No bounded-JS-subset line crossed — `given-guard` is core
scrml (§42.2.3); the native node mirrors the live shape exactly.

## THE FIX (3 native-parser files; codegen UNTOUCHED)
1. **ast-stmt.js** — `StmtKind.GivenGuard` + `makeGivenGuard(variables, body, span)`
   (node `{kind:"GivenGuard", variables, body, span}`).
2. **parse-stmt.js** — `import { makeGivenGuard }`; a statement-dispatch arm
   `if (kind === KwGiven) return parseGivenGuard(ctx)` (placed after the tilde-decl arm,
   before the control-flow leads); the `parseGivenGuard` production: consume `given`, collect
   comma-separated bare idents (`@x` stripped per live), reject property paths with E-SYNTAX-044
   (mirroring live ast-builder.js:5494) + skip the dotted tail, consume `=>` (Arrow) if present,
   parse the `{ body }` as a FLAT statement list (the live given-guard body shape; not a Block).
3. **translate-stmt.js** — `import { makeGivenGuard }` (already had StmtKind); a
   `case StmtKind.GivenGuard` -> `makeGivenGuardNode` bridge producing the live
   `given-guard{kind, variables, body, span}` (variables copied; body translated recursively
   via appendTranslatedStmt; NO `init`/`raw` companion — matches live's exact field set).

An expression-position `given` is UNAFFECTED — no parsePrimary arm was added, so the rare bare
`given` identifier use (§4.11.4 admits it) is untouched; `is given` is untouched.

## POST-FIX PARITY (dual-pipeline; gauntlet-s19 fixtures)
phase2/phase3-given-single/multi-087/088/094/095: native given-guard {variables, bodyKinds}
MATCHES live byte-for-byte, ZERO native realErrs. phase3-match-given-arm-075: the `given n`
portion now produces a matching given-guard {variables:["n"], body:[]} (the surrounding `->`
match arms remain a separate D3 cluster).

## MANDATORY GATES (all hold; baseline in THIS worktree)
1. **Strict-pass EXACT — HOLDS at 964** (gate ≥ 964). Corpus canary 1000/1001 (99.9%),
   histogram UNCHANGED {EXACT:964, LIVE-DEGENERATE:12, GAP-state-block:1, LIVE-PHANTOM:1,
   DEFERRAL-test-block:21, LIVE-HOIST-MISCLASSIFY:2}. (1019 pass / 0 fail in the suite.)
2. **Within-node canary GREEN — 1005 pass / 0 fail** after a TARGETED allowlist regen
   (SAME COMMIT d98becbd) of ONLY the 8 gauntlet-s19 given fixtures; every other entry
   byte-identical. Per-class deltas (across the 8 moved fixtures):
     KIND-NAME -9, MISSING-FIELD -32, EXTRA-FIELD -22, COUNT-LENGTH -4 (net; the 6
     single/multi fixtures DROP COUNT-LENGTH -1 each, the 2 match fixtures RISE +1 each =
     the new given-guard node), FIELD-SHAPE +3, SPAN-COORD +39 (cosmetic).
   CONTENT classes IMPROVE (native now emits the proper given-guard subtree instead of a
   truncated escape-hatch fragment) — only SPAN-COORD + the new-subtree FIELD-SHAPE rise.
   Aggregate total UNCHANGED at 95239 (content improvement offsets the span rise).
   **Fixtures moved (the PA regenerates the allowlist on main from THESE 8):**
     samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-given-single-087.scrml
     samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-given-multi-088.scrml
     samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-given-property-path-090.scrml
     samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-given-single-094.scrml
     samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-given-multi-095.scrml
     samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-given-property-path-096.scrml
     samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-match-given-arm-075.scrml
     samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-match-optional-no-arms-076.scrml
3. **Full `bun run test` — 0 fail** (21348 pass / 174 skip / 1 todo / 781 files on a clean
   re-run; one run showed 2 transient fails = the known double-compile/bootstrap flaky class,
   cleared on re-run; the pre-commit hook reported 0 fail on every commit).
4. **New unit — LOAD-BEARING:** compiler/tests/unit/m67-d7-given-form-parse.test.js — 11 pass
   with the fix / **10 fail against pre-fix sources** (the 1 always-pass is the `is given`
   non-regression case). Drives both pipelines + asserts native parses ZERO errors + the
   bridged given-guard matches the live shape, standalone AND in-match.
5. **Corpus NSBH impact:** E-STMT-UNEXPECTED-TOKEN 293 -> 285 (-8) across 110 -> 104 files (-6);
   **KwGiven (E-EXPR-UNEXPECTED:KwGiven) 8 -> 0** (fully closed). No NEW match-pattern fires
   (E-EXPR-MATCH-PATTERN 40 -> 40; E-EXPR-PARAM 20 -> 20 — both SEPARATE clusters, unchanged).

## E-EXPR-PARAM CLARIFICATION (the brief's bucket overlap hypothesis — DISPROVED)
The brief framed the cluster as "E-EXPR-PARAM (12 files) + overlap E-EXPR-MATCH-PATTERN". The
DIRECT pre-check shows E-EXPR-PARAM is a DISTINCT cluster — `function f(lin token: T)`,
`fn isReachable(from, to, adj)`, `function(fn)` param-list parse failures — with ZERO `given`
content. E-EXPR-PARAM did NOT change (20 -> 20). The actual `given` fires were E-EXPR-UNEXPECTED:
KwGiven (8 fires across 7 sample fixtures + 1 property-path). The given gap is fully closed; the
E-EXPR-PARAM / match-arm-`->` clusters are independent flip residuals.

## FOLLOW-ONS SURFACED (DISTINCT, OUT OF D7 SCOPE — filed, not fixed)
- **E-EXPR-PARAM cluster** (function/fn param-list: `lin` params, multi-arg `fn(from,to)`,
  `function(fn)`): 20 fires / 12 first-error files. Native param parser gap. (Overlaps the
  D2-residual lin-param note.)
- **match-arm `->`/`:>` thin-arrow INLINE form** (`pattern -> expr` with no braces, and bare
  `not -> ...` / `.Variant -> ...` arms): E-EXPR-MATCH-PATTERN/E-EXPR-MATCH-ARROW cluster
  (40 + 13 fires). The D3 match-arm domain — the match-given-arm fixture's residual is HERE,
  not in `given`.
- E-STMT-FUNCTION-BODY (38) / E-AWAIT-NOT-IN-SCRML (23) / E-MARKUP-002 (25) — separate clusters
  for future D-units (see the first-error histogram in the final report).

## STOP CONDITIONS
None hit. (a) NOT corpus-stale — live accepts the exact forms. (b) ONE production closed both
positions (D3b subsumed) — no re-file needed for given. (c) NO bounded-JS-subset line crossed —
given-guard is core §42.2.3. (d) Real locus is the parser, NOT codegen — codegen UNTOUCHED.

## FILES TOUCHED
- compiler/native-parser/ast-stmt.js          (StmtKind.GivenGuard + makeGivenGuard)
- compiler/native-parser/parse-stmt.js        (KwGiven dispatch arm + parseGivenGuard + import)
- compiler/native-parser/translate-stmt.js    (GivenGuard case + makeGivenGuardNode + import)
- compiler/tests/parser-conformance-within-node-allowlist.json  (TARGETED regen, 8 entries, SAME COMMIT)
- compiler/tests/unit/m67-d7-given-form-parse.test.js  (NEW, 11 tests, load-bearing)

## COMMITS (worktree branch)
- d0f5a886  WIP: StmtKind.GivenGuard + makeGivenGuard (ast-stmt.js)
- 6c892b75  WIP: native parses given x [, y]* => {body} (parse-stmt + translate-stmt)
- d98becbd  test: given-form parity unit + targeted within-node allowlist regen

## Tags
#m6-7-d7 #native-parser #parse-stmt #translate-stmt #ast-stmt #given-guard #given-form
#presence-guard #spec-42-2-3 #d3b-subsumed #within-node-canary #parity-completeness
#scrml-flip #phase-0-root-cause #kwgiven

## Links
- [ast-stmt.js](../../../compiler/native-parser/ast-stmt.js)
- [parse-stmt.js](../../../compiler/native-parser/parse-stmt.js)
- [translate-stmt.js](../../../compiler/native-parser/translate-stmt.js)
- [m67-d7 test](../../../compiler/tests/unit/m67-d7-given-form-parse.test.js)
- [within-node allowlist](../../../compiler/tests/parser-conformance-within-node-allowlist.json)
- [d1-arrow-callarg.md](./d1-arrow-callarg.md)
- [d2-server-function.md](./d2-server-function.md)
- [primary.map.md](../../../.claude/maps/primary.map.md)
