# progress — native-promote-each-iterable-field-2026-06-05

## 2026-06-05 startup
- WORKTREE: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-aedbda961a5b5fd10
- ff-merge main: c02e2860..2c2e5bb2 (clean, brought in F2-match) — base SHA 2c2e5bb2
- bun install OK; bun run pretest OK (13 test samples compiled)
- map read: primary.map.md (HEAD f11db672, 12+ commits stale; survey supersedes for loci)

## Phase 0 — survey-stop confirm (IN PROGRESS)
- Read live ast-builder.js L5724-5832: live `iterable` string =
    - for-of/scrml-style: `iterExpr.trim()` (iterable text after of/in, INCLUDING trailing `key <expr>`)
    - C-style: `rawParts.join(" ")` = `"( let i = 0 ; i < N ; i ++ )"` (tokenized space-join)
- Read promote.js parseForHeader (846) + iterableIsCellRef (1154) + consumer @1229/1242/1304
- Probed native for-stmt nodes (all rows): `iterable` is undefined on ALL (root confirmed).
    - iterExpr IS a LIVE ExprNode (lowercase ident/binary/call/array) already bridged
    - iterExpr.span is BLOCK-RELATIVE (start:15 -> "acts>: st" in file source) => source-slice OUT
    - C-style cStyleParts present; initExpr is escape-hatch(VarDecl), condExpr binary i<N

## BLOCKER FOUND (Phase-0 check #2 FAILS for row b — key-clause)
- Native parser CANNOT parse `for (let c of @contacts key c.id)`:
    errors E-STMT-EXPECT-RPAREN at `key` + cascade. `key <expr>` is a scrml for-header
    extension the LIVE tokenizer-based for-header collects-to-`)`, but the native
    AST-based for-header parser (parse-stmt.js) rejects `key` as a JS syntax error.
- => key-clause row is NOT a missing-field synthesis. It needs the native for-of
    HEADER PARSER to accept the `key <expr>` clause. Out of brief's field-synthesis scope.

## Phase 0 — empirical baseline + SPEC check
- DEFAULT promote-each: 33 pass / 0 fail (clean baseline)
- NATIVE-flip promote-each: 9 pass / 24 fail (matches brief's ~24 cluster; root confirmed)
- SPEC §17.4b (L10114-10136): `for (let x of collection key x.id)` is NORMATIVE scrml
    for-header grammar (Tier-0 keyed-reconciliation surface). The native parser
    rejecting `key` is a GENUINE native-parser parity gap, NOT out-of-language.
- Only 2 of 24 fails use the `key` for-header clause (row 2 @L110, §4 explicit @L392).
    The other 22 are pure field-synthesis (no key clause).

## DECISION (scope: field-synthesis + key-clause capture)
- Brief Phase-0 #2 FAILS for row b under strict reading (native can't parse `key`).
- Per Rule 2 (full-production fidelity) + Rule 3 (right answer) + §17.4b normativity:
    closing the promote-each FAMILY requires BOTH (a) iterable field-synthesis on the
    2 native for-stmt builders [brief-mandated] AND (b) native for-header `key <expr>`
    capture in finishForInOf [discovered parity gap, SAME locus, parser-bridge charter].
- Both are parser-bridge-only, no codegen, same native for-header locus.
- Scope expansion is EXPLICIT + documented (not silent). Reported to PA in final.

## Implementation
- translate-stmt.js: serializeNativeExprToText + synthForOfIterableString +
    synthCStyleIterableString + serializeForInitClause + serializeNativeArgList +
    serializeNativeArrow; wired into makeForStmtCStyle + makeForStmtInOf (omit
    field when null). ExprKind import added. COMMIT d7862af3.
- parse-stmt.js finishForInOf: capture §17.4b `key <expr>` clause (contextual
    Ident "key" after iterable, before `)`); thread keyExpr -> makeForIn/makeForOf.
- ast-stmt.js makeForIn/makeForOf: +keyExpr param (null default).
- VERIFIED probes:
    a-plain -> "@contacts" (cellRef true)
    d-cstyle -> "( let i = 0 ; i < N ; i++ )" (countMode true, init=0, count=N)
    e-member -> "@tasks.filter(x => x.done)" (cellRef false -> SKIP, matches live)
    skip-array/skip-call -> cellRef false -> SKIP (matches live)
    b-key -> "@contacts key c.id" + 0 parse errors (was E-STMT-EXPECT-RPAREN cascade)
    key-as-ordinary-ident in logic -> 0 errors (contextual scoping correct)

## THIRD gap found + fixed — §17.4a for-loop `else` block
- Native fired E-STMT-STRAY-ELSE ('else' with no matching 'if') on
    `for (...) { } else { }` (normative §17.4a empty-state). 2 promote-each rows
    (row 3 @L135, §5 <empty> @ L471) hit this: promoteEachOnFile short-circuits at
    "source has compile errors" BEFORE the rewrite (promote.js:1441).
- FIX: parse-stmt.js parseForElseBody helper; wired into finishForInOf +
    finishForCStyle after body parse; thread elseBody -> makeFor/ForIn/ForOf.
    ast-stmt.js: +elseBody param (null default) on all 3 for constructors.
- VERIFIED: for-else parses 0 errors (was E-STMT-STRAY-ELSE); live==native both
    compile clean + equivalent output. (elseBody NOT translated to live node yet —
    promote reads else from source; live for-stmt also drops else at parse, renders
    empty-state elsewhere; native matches live.)
- SCOPE: promote-each family = THREE native for-statement parity gaps, all in the
    native for-statement parser/builder locus, all parser-bridge (no codegen):
    (1) iterable field-synthesis, (2) §17.4b key-clause, (3) §17.4a else-block.

## within-node parity reconciliation (Phase-3 (3))
- Initial naive serializer ("clean" source: @tasks.filter(...), i++) caused 27
    within-node FIELD-SHAPE regressions: live `iterable` is the RAW TOKENIZED form
    (every token space-joined): `@tasks . filter ( x => x . done )`, `i ++`,
    `[ 1 , 2 , 3 ]`, `@contacts key c . id`, `getItems ( )`.
- FIX: serializer rewritten to emit space-joined-tokens matching live exactly
    (member ` . `, computed ` [ ` ` ] `, call ` ( ` ` ) `, array `[ e , e ]`,
    update `i ++`, arg sep ` , `). parseForHeader whitespace-normalizes so promote
    still passes; within-node now byte-matches live `iterable`.
- Remaining 8 over-budget after serializer fix = native now PARSES key/else
    correctly (was error-recovering). nested-comments: 35 native parse errors ->
    14 (FIXED 21 key/else errors); more-complete AST shifts divergence counts.
    stdlib http/router/jwt/transform + self-host/ts: +1 EXTRA-FIELD (iterable at
    pre-existing array-misalignment positions). phase2-for-else-050 +
    phase2-for-keyed-051: the canonical fixtures for the fixed features.
- RE-BASELINE: allowlist updated for 8 fixtures to new (correct) profile.
    Aggregate net: MISSING-FIELD -215, FIELD-SHAPE -3 (improvements); EXTRA-FIELD
    +28, COUNT +2, SPAN +5 (correct shadow of more-complete native AST). Total -182.
- within-node: 1005 pass / 0 fail (restored). promote-each default 33/0 + native 33/0.
