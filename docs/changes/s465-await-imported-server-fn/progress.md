# progress — s465-await-imported-server-fn

- 2026-10-11 branch cut from origin/main 1c1e9eee5; brief + PA change-of-plan archived; bun install + pretest OK.
- 2026-10-11 REPRODUCED on origin/main 1c1e9eee5 (executed, bun:sqlite + route call): x1 (plain server fn,
  `if (!check(pass, row.pw))` on imported `check` → `verifyPassword`) wrong password → "WELCOME bob".
  Also on main: CPS-split h1x — the continuation `if (!check(…))` runs in the browser wrapper
  `_scrml_cps_login_N`, un-awaited (and main still ships the pw hash to the client — the CPS P0, not this change).
- Root cause: the server await classifier (`isPromiseReturningImportedCallee`, #1399) answers only for stdlib
  exports; the TREE-derived cross-module async facts (`asyncImportedLocalsOf`, codegen/index.ts, stashed as
  `fileAST._asyncImportedLocals`) were consumed only as async-COLORING seeds (ss1 value exports, client fn
  coloring, tool path), never as a call-site await fact on the route-handler/peer path.
- Fix (reuses #1399's callee-map mechanism, no second classifier):
  * scheduling.ts `buildCalleeImportMap` carries `asyncImportedLocals` (from the stash; also read via `.ast`);
  * module-resolver.js `isPromiseReturningImportedCallee` answers true for those locals → every await site
    (emit-expr server branch, combinator lift, sync-callback fail-closed, scheduling injector, library paths);
  * codegen/index.ts `asyncImportedLocalsOf` follows §21.4 re-export chains (`resolveExportedBinding`) to the
    DECLARING module and asks its analysis (re-exported `reCheck` was classified sync); stash mirrored onto `.ast`;
  * emit-functions.ts: the CPS wrapper's client continuation statements (never routed through
    `scheduleStatements`) now get the same `injectFnBodyServerCallAwaits` over the same candidate set
    (this file's server fns, owning-file filtered + Promise-returning imports).
- Tests: integration/s465-await-imported-server-fn.test.js (17: 7 server shapes × wrong/right + no-bare-call
  scan + CPS continuation executed in happy-dom wrong/right) — base 9 FAIL / head 17 pass;
  unit/s465-callee-map-async-imported-locals.test.js (3).
- Gate run 1 found 5 CLIENT regressions (crossmodule-async-markup-position-autoawait ×4,
  cross-module-client-value-position-autoawait §6): client emitters read the classifier as "stdlib-owned"
  (`_stdlibOwnedImport`), and the module-level server classifier (`setServerAsyncClassifier`, never reset
  between files) is a client-mode fallback in `isStdlibAsyncCallee`. NARROWED: only SERVER maps carry the facts
  (`buildServerCalleeImportMap`, emit-server route/peer + ss1 value exports); client-mode `isStdlibAsyncCallee`
  uses the stdlib-only `isPromiseReturningStdlibImportedCallee`; the CPS wrapper adds the stash explicitly.
- Gate run 2 (32970 tests): 13 fail, none mine — dev-db-no-side-file ×5 + headless-serve-bind-host (container:
  dev prints 127.0.0.1 / no ::1 twin), promote-safety read-only (runs as root), expr-node-corpus-invariant ×2
  (ALSO FAILS ON BASE 1c1e9eee5: 5 s timeouts), tenant-floor-project-set ×3 + conf-MARKUP-001 (pass alone on
  head — load flakes, 2 sibling suites on the box).
- Corpus differential head vs origin/main 1c1e9eee5 (each side compiles ITS OWN tree; per-file standalone; 2806
  files: samples, examples, conformance, stdlib, scrml-support gauntlet-r25 (4); ../giti and ../flogence are NOT
  cloned in this container — skipped): newly refused 0, code-set changes 0, emit changes 1:
  examples/19-lin-token.client.js — CPS continuation `const ticket = _scrml_fetch_mintTicket_12(…)` →
  `const ticket = await _scrml_fetch_mintTicket_12(…)` (a same-file server fn in the wrapper continuation; was a
  Promise). No server artifact in the corpus changed (no corpus program calls an imported async helper from
  server code); the server shapes are pinned by the executed integration test.
- Gates (head 8d4fad12c): pre-commit full (32970): 13 fail, all environmental/pre-existing (see above);
  root-level 2239/0; e2e-render-map 259/0; self-host-v2 slices 2274/0; lsp+commands 713/11 — all 11 are
  `scrml dev`/`serve` bind/watch tests (no ::1 / host display in this container); browser-baseline --check:
  1 NEW name (each-alias-in-lifted-markup nested <each>, passes alone) — IDENTICAL on base 1c1e9eee5 (ran
  --check in a base tree: same single new name) → environmental; facts (regenerated, +2 test files);
  spec-index, host-global-scan, s34-census --check-new --base 1c1e9eee5, state, conflict-marker, types-gate,
  snippet-gate 128/128, corpus-compile-floor, bootstrap-conformance, severity, delta-lint: PASS.

## Fix round 1 (S239 review of f8309fd6)

- 2026-10-11 r1: worktree reset to f8309fd6; brief archived as BRIEF-fix-round-1.md. Governing text, SPEC §13.2
  (SPEC.md:10284): "An **async-colored function** is one the compiler emits `async`: a server function, a
  Promise-returning standard-library function, or any function that (transitively) calls one. … It MAY be called
  directly (the compiler awaits the call), and it MAY be passed as the first argument of an awaited collection
  method (`.some`, `.every`, `.find`, `.findIndex`, `.filter`, `.map`, `.forEach`, `.reduce`, `.flatMap` — the
  compiler lowers the call to a combinator that awaits every invocation)."
- 2026-10-11 r1: REPRODUCED all four findings on f8309fd6 (reviewer probes c3/c5/c7/c9/c10/c11).
- 2026-10-11 r1 F1+F2 root: where structure is lost — the AST builder keeps a literal / alternation / §18.19 product
  arm with a `{ … }` body as RAW TEXT (no `match-arm-block` form for `"a" :> {`, `1 | 2 :> {`, `(a, b) :> {`), and
  every inline arm's result is a string (`_matchArmInlineToMatchArm` drops `resultExpr`). Four match routes
  (stmt inline, decl inline A/B, value IIFE C/D, multi-scrutinee stmt/decl/IIFE) then re-lowered that text via
  `rewriteBlockBody` / `rewriteServerExpr` (`emitExprField(null, text)`), which never ask the await classifier.
  `!{}` handler arms (`emitArmBody`) lowered in a hard-coded CLIENT ctx (`_makeExprCtx({})`, `rewriteBlockBody`).
  Fix (NEW codegen/arm-structure.ts): on the SERVER the arm text is parsed with the compiler's own parsers
  (`armBodyStatementsFromText` → statements; `parseExprToNode`, refusing escape hatches / lost trailing content)
  and emitted through the normal emitters: `structureServerArm` turns a raw block arm into `structuredBody` in
  every arm collector (so it takes the existing structured route); `emitArmValue` emits arm values from the tree;
  the value-IIFE and decl block-arm raw paths share the structured-route bodies (`structuredIifeArmInner`,
  `_emitStructuredArmToVar`, factored out unchanged); the decl route's structured tail now uses `stmt.exprNode`;
  `emitArmBody` lowers server handler arms from the tree in the guarded expression's own server ctx. Client
  emission of arm text is unchanged (client mode returns null from both parsers).
- Other server raw-text positions checked: block-bodied arrow in a server fn (g-server-block-arrow-body-raw-tokens-
  bypass-trap-s462) — fails CLOSED (E-ASYNC-STDLIB-IN-SYNC-CALLBACK, probe c12, imported + stdlib); `when … changes` /
  worker `when message` bodies (`rewriteBlockBody` server mode) are SYNC wrappers (no await legal) — unchanged;
  `if`-as-expression arms already structured (probe: correct on base).
- 2026-10-11 r1 F3: the CPS continuation now lowers with the async facts of an ASYNC client fn body
  (`_cpsAsyncOpts`: clientAsyncBody + peer-await set + stdlib classifier + server-fn names + the fail-closed sink;
  the client async-set computation moved above Step 2 unchanged). Found while doing it: the facts were dropped one
  hop into every control-flow CONDITION ctx (if / while / do-while / for ×3) and nested body — so
  `if ([p].some(x => check(x, h)))` was a truthy Promise in ORDINARY async client fns too (pre-existing; executed
  probe c7b) and the structural backstop (which assumes the combinator lowering) stayed silent. NEW
  `hostAsyncFacts(opts)` travels wherever `clientAsyncBody` was forwarded and into each condition ctx.
- 2026-10-11 r1 F4: `asyncStdlibSyncCallbackError` takes an optional `userModule`; emit-server passes the importing
  file-relative module of a callee that is async because it is a USER `.scrml` export. Code unchanged.
- Out of scope (recorded): same-file server fn called from another server fn's match arm → `ReferenceError: peer is
  not defined` (c3 mPeer; pre-existing) — gap filed below.
- Tests: NEW integration/s465-await-arm-bodies.test.js (66): 15 server shapes × {imported `check`, direct
  `verifyPassword`} × {wrong → REJECTED, right → WELCOME} executed vs bun:sqlite, a raw-token scan, 4 happy-dom
  CPS/client combinator cases × 2, the F4 message. On f8309fd6: every wrong-password / false / scan / message test
  FAILS (32), handlerStmt does not compile there (E-CODEGEN-INVALID-LOGIC `_scrml_result = if ( … )`).
- Gate (pre-commit full, 32969): 10 fail — dev-db-no-side-file ×5, tenant-floor-project-set ×3 (24/24 alone),
  promote-safety read-only, headless-serve-bind-host — all on the known env list.
- 2026-10-11 r1 corpus differential (scripts/corpus-emit-differential.ts, head 917d4847 vs origin/main 1c1e9eee5 —
  base = `git archive origin/main`, so the prior round's change is in the delta; 2809 sources: examples, samples,
  conformance, stdlib, benchmarks; ../giti and ../flogence NOT cloned in this container — skipped): 0 newly
  failing, 0 newly passing, 0 diagnostic-code changes (1 text-only: stdlib/auth/index.scrml — the F4 module note);
  171 artifacts differ, 163 only by the absolute `_scrml_project_root` (the two trees live at different paths);
  8 real emit changes:
  * driver-card.server.js ×2, status-picker.server.js, sql-handled-match-scrutinee-rt: arm values now from the
    tree — token spacing only (`[ "OnDuty" , "SleeperBerth" ]` → `["OnDuty", "SleeperBerth"]`, `row . body` →
    `row.body`); behaviour-identical.
  * 19-lin-token.client.js: the prior round's CPS `await _scrml_fetch_mintTicket_12(…)`.
  * 08-chat.client.js (`await _scrml_sendMessage_14()` inside `if` in async `handleKey`),
    gauntlet-r10-rails-blog.client.js (`await _scrml_showList_77()` ×3 inside `if (result.ok)`): hostAsyncFacts
    now reaches nested bodies — a FIXED bug: executed probe (happy-dom) `if (flag) { load() } @seen = "after=" + @x`
    reads "after=init" on origin/main and "after=bob" on head; pinned in the new test.
  * sql-handled-split-write-rt case.server.js: `!{ _ :> {} }` lowered as the VALUE `{}` (truthy) — a defect of
    this round, FIXED (a braced handler is always a block; empty → `= null`); recompiled byte-identical to main;
    pinned by the `handlerEmpty` test.
- Gate after the fix (33037): 10 fail, the same env set; dev-db-no-side-file ×5 / promote-safety / headless-serve
  -bind-host fail identically in the origin/main tree (7/7); tenant-floor 24/24 alone.
- 2026-10-12 r1 final: head re-captured after the `{}` fix → 7 real emit changes (the list above minus
  sql-handled-split-write-rt), 0 newly failing. browser tier: head 49 fail ⊂ origin/main-tree 51 fail (main's extra
  two: TodoMVC dist not built in that tree) — the name set is environmental (browser-baseline --check refuses: its
  parser counts 50 of 51 on this box); corpus-compile-floor PASS; facts regenerated.

## Fix round 2 (S239 re-review of afc77f87)

- 2026-10-12T00:20Z r2: worktree reset to afc77f87; brief archived as BRIEF-fix-round-2.md; origin/main 41af4153a
  merged (merge commit). Maps (`primary.map.md`, stamp 8ce6d61b5) read; its #1106 headline ("a multi-statement handler
  value is PARSED with the function-body statement parser") pointed at `parseStatementText` — verified in source: the
  arm reader IS the function-top-level parser (body wrapped in a probe function).
- 2026-10-12T00:30Z r2 REPRODUCED (reviewer probes s5/s6 on afc77f87): wCForPP / wCForStd / wCForVal / wBlock / wMulti /
  wForIn — wrong password → WELCOME; xLabelLoopArm + xLabelLoopTop E-CODEGEN-INVALID-LOGIC (`continue outer`
  unsyntactic); xLabelArm runtime `ReferenceError: blk`.
- Root causes: (1) `serverArmBlockStatements` / `serverArmExprNode` returned null on any refusal and every caller kept
  its raw-token path (fail open). (2) the parser refused two forms the front-end carries with a parse-error hatch BY
  DESIGN at top level too: a C-style `for` declaration init (`cStyleParts.initExpr` = hatch `let i = 0`) and a bare
  block statement (`bare-expr` whose text is the block). Every other refusal (switch / try / throw / for…in / `let a =
  1, b = 2` / `var`) is a fatal front-end diagnostic — the same one top level gets. (3) the for-stmt emitter dropped
  `node.label` (the front-end keeps it, as on while/do) — same at top level.
- Fix: `defer-structure.ts` `parseStatementTextDetailed` (the one reader; `parseStatementText` delegates) returns the
  refusal reason (front-end code + message, or the unreadable text); accepts the C-for declaration init when its
  declarators read (`cStyleInitDeclaration`) and a bare block whose body reads (recursively); strict mode (codegen)
  also refuses lost trailing content. `arm-structure.ts`: on the server both readers return a tree for every non-empty
  body; a refusal is recorded in the run-wide refused-lowering sink (top-level code, else E-STMT-UNEXPECTED-TOKEN) and
  reads as an inert `null` placeholder — the raw server arm path is unreachable (emitArmBody's server branch returns
  unconditionally). emit-control-flow: C-for declaration init lowered through emitExpr; `forLabelPrefix` on all
  three plain `for` headers. emit-logic: a server bare block is lowered structurally (top level too).
- Tests: NEW integration/s465-await-arm-r2.test.js (57): 12 shapes × {check, verifyPassword} × wrong/right executed,
  a raw-token scan over every bundle the file produces, 8 compile-error tests (switch / try / throw / for…in /
  multi-declarator at top level AND in an arm — same code; switch in a `!{}` arm and in a value arm; labelled block).
  On afc77f87: 37 fail (every wrong-password case, both label shapes, the handler shape, the scan, all 8 error tests).
- Gaps: filed g-client-match-arm-text-body-skips-statement-checks-s465 (client arm `switch` ships raw JS); annotated
  g-bare-block-statement-is-silently-dropped with the traced deciding site (collectExpr swallows a next-line block).
- 2026-10-12T02:10Z r2 gate 1 found 1 regression of mine: `boom() !{ | _ :> return 7 }` (transaction-in-function-body)
  — an UNBRACED leave arm reached the value reader and was refused; emitArmBody's server branch now reads a §18.2
  leave statement as a statement first. Fixed; that suite 26/26.
- 2026-10-12T02:40Z r2 corpus differential (corpus-emit-differential.ts; head 5ce2060b+r2 working tree vs origin/main
  41af4153a via git archive; 2809 sources: examples, samples, conformance, stdlib, benchmarks; ../giti and ../flogence
  NOT cloned in this container — skipped): **1a newly failing = 0**, 0 newly passing, 0 diagnostic-code changes, 1
  text-only (stdlib/auth/index.scrml — r1's F4 note); 171 artifacts differ, 164 only by the absolute project root;
  the 7 real emit changes are EXACTLY r1's list (sql-handled-match-scrutinee-rt, 08-chat, 19-lin-token,
  status-picker, driver-card ×2, gauntlet-r10-rails-blog) — r2 changes no corpus artifact.
- Gates (head 6b55e889 + cf84772e): pre-commit full 33095: 12 fail — dev-db-no-side-file ×5, tenant-floor-project-set
  ×3, promote-safety read-only, headless-serve-bind-host (known env list), conf-MARKUP-001 + for-unparenthesized-head
  "OBJECT-destructure" (load flakes: 12/12 and 13/13 alone). root 2239/0; e2e-render-map 259/0; lsp+commands 713/11
  (all `scrml dev`/`serve` bind/watch, same as r1); browser-baseline --check: 1 NEW name (nested <each> in lifted row)
  — IDENTICAL in an origin/main tree → environmental; types-gate (180, unchanged), host-global-scan, facts (regen),
  state (regen, MED +1), spec-index, s34-census --check-new --base origin/main, bootstrap-conformance, severity,
  conflict-marker, delta-lint, gen-md-shim, snippet-gate 128/128, corpus-compile-floor: PASS.
- 2026-10-12T03:18Z r3 start: worktree reset to fd3e365c (origin/main 41af4153a already merged); brief archived.

## Fix round 3 (S239 re-review of fd3e365c)
- 2026-10-12 r3 REPRODUCED (reviewer probes rv3 t1–t6, copied to .tmp): gArmTwoBlk / gArmTwoBlkV / gArmThree /
  gTopTwoBlk wrong → WELCOME; eSeqTern "A" / eSeqPlus "xyy" / eSeqTop "A"; aSeqVal / aSeqArm / aSeqTop wrong →
  WELCOME; fAsgArm / fAsgTop TDZ ReferenceError, fAsgArmIf "R0123456789".
- F1 root (a): `ast-builder.js` collectExpr BUG-ASI-NEWLINE — a `{` on a later line after a value ends the statement
  (bare block, SPEC §7.2.2 "Terms"), unless a depth-0 brace-head word (function/fn/match/if/else/for/while/do/switch/
  try/catch/finally/given/when/class/partial/transaction/server/import/type/use) was collected or immediately
  precedes the collection (the import handler eats `import` first — `import:host⏎{ tok } from …` regressed import-host
  F1 until that was added). (b) defer-structure `soleProbeFunction`: refuse unless the probe built to ONE logic node
  holding ONE function-decl (the probe fn). (c) NEW `compiler/src/brace-pair.ts` `isWholeBraceBlock` (strings,
  templates with nested `${}`, regex literals, comments) gates the strip in parseStatementTextDetailed and
  bareBlockText (a first version without regex awareness broke defer-statement "regex with a quote" — fixed).
  (d) expression-parser stamps `_s465DroppedStatement` when the "trailing content would be silently dropped" warning
  fires; emit-expr `emitExpr` refuses (E-STMT-UNEXPECTED-TOKEN) any server node carrying it OR `_s441Trailing`
  (the warning's own newline+word test missed `let ok = 1⏎!(r = guard())` — measured wrong → WELCOME silently on
  base AND head). Corpus: newly rejects 0. The warning was FALSE for match-stmt arm statements (`"a" :> { … }` — the
  arm is read from text by parseMatchArm); it is now held there (parseOneStatement, arm level + arm arrow).
- F4: bArmAfterVal / bArmAfterValSemi / bArmAfterCall / bArmTwo and all bTop* now lower and run (R1, R1, Rxy, R12;
  RB, RIB, R1B, RIN …). bTopShadow throws "name is a constant" identically on base (assigning a parameter) — not r3.
- F2: SPEC §4.18 — "scrml has no comma operator": a SequenceExpression hatch on the server is E-CODEGEN-INVALID-LOGIC
  (arm value, arm block, top level). Refusing EVERY non-arrow hatch on the server was measured: it rejects legal scrml
  (g-server-fn-bare-dot-payload-variant `.Found(name: …)` ParseError hatch; protect-scalar-egress tagged templates) —
  narrowed to the sequence; the residue (a tagged template's substitutions ship un-awaited on the server, executed
  probe hTagTop) filed as g-server-text-hatch-unawaited-call-s465 (HIGH, pre-existing on base). Duplication root:
  `makeEscapeHatch` stored the WHOLE expression text as every hatch's raw; it now slices the node's own span (a
  sequence keeps its parens) — `(0, "x") + "y"` client lowering evaluates "xy".
- F3: emit-control-flow C-style `for` adds the header's declared names (`cStyleDeclaredLoopNames`) to the body's
  declaredNames: fAsgArm/fAsgTop "R49", fAsgArmIf/fAsgTopIf "R789", aCForUpd wrong → REJECTED.
- Tests: NEW integration/s465-await-arm-r3.test.js (59: 9 route shapes × {check, verifyPassword} × wrong/right, a
  raw-token + dropped-content-warning scan, 11 executed value tests, 9 compile-error tests, 2 hatch-text tests):
  41 fail on origin/main, 49 fail on fd3e365c. NEW unit/brace-pair-s465.test.js (17).
- Corpus differential (head 422d99663 vs origin/main 41af4153a via git archive; 2809 sources; ../giti and
  ../flogence NOT cloned — skipped): 0 newly failing, 0 newly passing, 0 code changes, 0 text-only; 171 artifacts
  differ, 164 only by the absolute project root; the 7 real changes are exactly r1's list (sql-handled-match-
  scrutinee-rt, 08-chat, 19-lin-token, status-picker, driver-card ×2, gauntlet-r10-rails-blog). r3 changes no corpus
  artifact. (Verdict line says "NOT A VALID COMPARISON" only because the base tree has no .git — same as r2.)
- Gates (head 6cf88812b): pre-commit full 33170: 10 fail — dev-db-no-side-file ×5, tenant-floor-project-set ×3
  (pass alone), promote-safety read-only, headless-serve-bind-host (known env list). An earlier run (pre-regex-fix)
  also had emit-block-analysis determinism, conf-MARKUP-001 and expr-node-corpus-invariant 12-snippets 5 s timeouts —
  pass alone / identical timeout on base (load). root 2239/0; e2e-render-map 259/0; lsp+commands 713/11 (all
  `scrml dev`/`serve` bind/watch, same as r1/r2); browser-baseline --check: 1 NEW name (nested <each> in lifted row)
  — IDENTICAL in the origin/main tree → environmental; types-gate (180, unchanged — after a cast fix), host-global-
  scan, facts (regen), state (regen, +1 HIGH gap), spec-index, s34-census --check-new --base origin/main,
  bootstrap-conformance, severity, conflict-marker, delta-lint, gen-md-shim, lint-no-default-arm, snippet-gate
  128/128, corpus-compile-floor: PASS.

## Fix round 4 (S239 re-review of 41df4784) — close the CLASS
- 2026-10-12T06:40Z r4 start: worktree reset to 41df4784 (origin/main 41af4153a already merged); brief archived as
  BRIEF-fix-round-4.md; node_modules symlinked (package.json unchanged vs origin/main); pretest OK.
- 2026-10-12T06:55Z r4 REPRODUCED on 41df4784 (rv6 probes, copied to .tmp/rv6, W= fixed): wrong password → WELCOME for
  s12 zPos/zPosVP, s8 xTwo/xTwoFirst/xThree/xBlkPos/xIfBody/xForBody, s7 bTwoSameLine, s2 pObjDef…pNegObjDef (8),
  s3 vObjDef…vNegObjDef (8), s1 sDestrDefault + sNegGuard (tagged template); xFirstStmt ReferenceError. s4 qGiven
  WELCOME/WELCOME is CORRECT (`given ok` is a presence test; `ok` is `await check(…)` = false, present).
- Server text-lowering call sites (inventory; every one now passes ONE guard):
  * emit-expr.ts:1044 `serverTextLowering` — NEW, the only caller of `rewriteServerExpr` /
    `rewriteServerExprArrowBody` (the server string rewriters, rewrite.ts:3095/3213). It asks
    `refuseServerTextCall` (NEW codegen/server-text-guard.ts → brace-pair.ts `firstCallInText`) first: a text that
    holds a call is E-CODEGEN-INVALID-LOGIC and lowers to `null /* E-CODEGEN-INVALID-LOGIC */`.
  * emit-expr.ts:1076 `emitExprField(null, text)` server branch → serverTextLowering. Through it: rewriteBlockBody in
    server mode (emit-control-flow.ts:2513, its every statement goes `lowerExpr` → emitExprField(null)) — reached
    from emit-logic.ts:4670/4722/4747 (`when … changes` / worker `when message` bodies, server boundary) and
    emit-control-flow.ts:3051/3054/3532 (server matchMode arm text — r1/r2 structure every server arm first, so
    only a residue can reach here).
  * emit-expr.ts:4722 `emitMatchExpr` server shim → serverTextLowering (guard on the arms text; the subject is
    already emitted from the tree).
  * emit-expr.ts:4933 `emitEscapeHatch` server branch (ParseError hatches, arrow/function values, every other
    hatch kind) → serverTextLowering; a SequenceExpression stays refused first (r3).
  * emit-expr.ts:4851 `emitTaggedTemplateFromText` — NEW: a server TaggedTemplateExpression hatch is lowered from
    its parts (tag + each `${…}` read by parseExprToNode, emitted by emitExpr; quasis verbatim) — tagged
    templates are now STRUCTURAL on the server (g-server-text-hatch-unawaited-call-s465 un-awaited half closed).
  * emit-destructure-pattern.ts:55-69 destructuring defaults (`el.default` / `prop.default` TEXT pasted verbatim on
    BOTH sides) — now `emitDestructurePatternText(p, lowerDefault)`; callers pass a lowerer that emits
    `defaultExpr` (the builder's parse) through emitExpr (`emitExprFromText`, emit-expr.ts:1065, parses the text
    when the builder kept none; an unreadable text takes the guarded text path): emit-logic.ts:2489/2583 (let /
    const), :4260 (guarded decl), :5393/:5879 (for with ~), emit-control-flow.ts:853/1339 (for-of, hoisted
    for). emit-lift.js:2934 (client lift `for`) keeps text — client-only.
  * utils.ts:404 `paramSignature(p, i, lowerDefault?)` — parameter defaults (`defaultValue` TEXT, also pattern
    defaults in a destructured param) were pasted verbatim. emit-logic.ts:5125 (nested function-decl) passes
    `serverParamDefaultLowerer` on the SERVER: lowered from the tree; a default that needs `await` is
    E-CODEGEN-INVALID-LOGIC ("a parameter default cannot await" — `await` is a SyntaxError in a parameter list).
    Probe paramDefPat (`function inner({ ok = check(…) })`) shipped `check ( pass , row . pw )` raw on 41df4784
    (it "worked" only because `return ok` re-awaited the Promise). Client callers (emit-functions.ts:1550,
    emit-library-shared.ts:1140, emit-tool.ts:206) and emit-server.ts:1443 (a client-boundary session helper)
    are unchanged.
  * Client-only rewriteBlockBody callers (emit-event-wiring 1103/1202, emit-each 2269/4182, emit-variant-guard
    1217/1244, emit-logic 874/6321) — client mode, never server; see g-client-bare-block-text-lowered-s465.
  * The unused `rewriteServerExprArrowBody` import in emit-event-wiring.ts:2 is removed; the structural test pins
    that only emit-expr.ts imports / calls the server rewriters.
- F1: emit-logic.ts:2269 a server bare-expr that is SEVERAL whole blocks on one line (`{ A } { B }` / `{ A }; { B }`,
  NEW defer-structure.ts `bareBlockSequenceTexts`) lowers each block as its own bare block; the arm reader
  (`parseStatementTextDetailed` scan) accepts the same sequence, so `{A} {B}` in a server match arm reads too.
- F2: as above (destructuring defaults through emitExpr, both sides; param defaults server-side).
- F3: ast-builder.js collectExpr — (a) `sawBraceHeadAtDepth0` is cleared when a `}` closes back to depth 0 (the head's
  body is over); (b) a head word counts only when it is not a property name (after `.` / `?.`) and, for a
  statement-only head (`type`, `import`, `use`, `class`, `server`, `partial`, `transaction`), only when it LEADS
  the collection (NEW `EXPR_BRACE_HEAD_WORDS` for the expression-construct heads); (c) a keyword-spelled property
  (`row.type`) now ENDS A VALUE for the newline bare-block boundary (it did not: KEYWORD was not a value). u1
  uType/uUse/…/uClass, mType/mDo, s4 qBlkAfterTypeProp: E-STMT-UNEXPECTED-TOKEN → run (REJECTED/WELCOME);
  c4 kFnExpr / kTypeProp (CLIENT): the `{ r = 5 }` block was silently DROPPED (r = 0) → now runs (5).
- F4: client bare blocks are still lowered from text (c1 cAt SyntaxError, cMatch E-CODEGEN-INVALID-LOGIC, cMulti one
  line, cl3 E-SERVER-FN-IN-SYNC-CALLBACK) — not covered cheaply (every client bare block's output would change);
  filed g-client-bare-block-text-lowered-s465 (MED, prov=review:s465-await-r4).
- F5: the comma refusal now cites SPEC §40.8 (the S441 bullet, SPEC.md:29931: "A comma sequence … is not a scrml
  expression — §4.18.2 lists what a bare run may be, and scrml has no comma operator") + §4.18.2. C-for header
  commas (`for (i = 0, j = 5; …; i++, j--)`): the SPEC names no exception for a `for` header — the sentence is a
  general statement that scrml has no comma operator — so the server keeps refusing them (executed: E-CODEGEN-
  INVALID-LOGIC citing §40.8). FOR THE OWNER: confirm a C-style `for` header comma is out (the client still lowers
  it from text, as JS).
- 2026-10-12T08:30Z r4 MEASURE 1 (corpus-emit-differential, head working tree vs origin/main 41af4153a, base tree =
  an archive of origin/main; 3556 sources: examples, samples, conformance, stdlib, benchmarks, docs; ../giti and
  ../flogence NOT cloned — skipped): **21 newly failing** — every one a READABLE expression reaching the text path
  with a call, not an unreadable one: `emitExprField(null, "Date.now()")` (readme-snippets tasks ×2,
  postgres-program-driver), `consumeMarker.substring(8)` (23-trucking-dispatch ×3), `norm(name)`,
  `{ echo: handleDispatch(…) }` (endpoint arm), compiler-emitted `(await _scrml_batch_read_N(it.id))` (11
  hoisted-loop conformance cases + 1 repro), and two block-bodied arrows `x => { return o.m(x) }` (s441 repros).
  Not migrated — the guard was made to LOWER these structurally instead (the brief's first option), then
  re-measured:
  * `serverTextLowering` reads a text that holds a call with the expression parser first; a readable tree is
    emitted by emitExpr (classified, awaited). A block-bodied arrow / function value is lowered by NEW emit-logic
    `emitServerFnValueFromText` (body read by the function-body statement parser, emitted by the statement
    emitter in the server ctx; a body needing `await` — a sync callback cannot — or a head with an annotation /
    call is refused). Only text NEITHER reads is refused.
  * `firstCallInText`: a call directly under `await` that ends its chain (`await f(x)`, `(await f(x))`) is
    already awaited — not a finding (`await f(x).g()` still reports `f`). The callee excerpt no longer joins
    words across whitespace (`returno.m` → `o.m`).
  All 21 recompile clean on head.
- 2026-10-12T09:40Z r4 gate run 1 (33333 tests): 21 fail — 10 on the known env list (dev-db-no-side-file ×5,
  tenant-floor-project-set ×3, promote-safety read-only, headless-serve-bind-host) and 11 of mine, all fixed:
  * duplicate diagnostics (server-fn-calls-server-fn C1 + callback matrix, sql-in-arrow-body ss19 #12, sql-one-
    statement F4): the precise code (E-SERVER-FN-IN-SYNC-CALLBACK / E-SQL-009 / E-SQL-QUERY-NOT-READABLE) PLUS the
    guard's E-CODEGEN-INVALID-LOGIC. The guard's refusal is now a BACKSTOP (`cascadeOnly`): runCG drops it when the
    compile already holds another error (`dropCascadeOnlyErrors`, codegen/index.ts) — nothing ships either way.
    And `firstCallInText` treats a `?{ … }` query's driver chain (`.get()`, `.acrossTenants()`) and unbackticked
    SQL text (`count(*)`) as the SQL lowering's, not author calls (rewriteSqlRefs emits the driver call awaited).
  * serve-target-tool FIX 8 ×2 + R26: an `<endpoint>` arm `{ …: compute() }` is now lowered from the tree with
    `await compute()`; `isSingleJsExpression` (validate-emit.ts) parsed without `allowAwaitOutsideFunction` and
    called it E-ENDPOINT-MULTI-STATEMENT-ARM. Fixed (the arm is emitted inside `await (…)` in an async handler).
  * protect-scalar-egress charCode + conformance protect/scalar-encoding-e006: `String.fromCharCode(...Array.from(h,
    …))` was a ParseError hatch — expression-parser's bare-variant mask read the third dot of `...Array` as the
    variant `.Array`. The mask's lookbehind now excludes a preceding `.` (spread of a capitalised name reads:
    `[...Ab]`, `{...A}`, `f(...A.b(x))`); the protect gate sees the tree again → E-PROTECT-006 as before.
  * is-predicate-in-function-expression-1333 C (server) and sql-one-reader-s457 (1): output-TEXT assertions on a
    statement now lowered from the tree (`filter(function ( v ) {⏎ return … })`, `${g("if(") / 2}`) — same
    semantics; assertions relaxed to the shape (whitespace) with an S465 r4 note.
- Tests (r4): NEW integration/s465-server-text-guard.test.js (26: the structural pin — only emit-expr imports / calls
  the server rewriters, and serverTextLowering asks the guard first — plus 22 fixture files =
  fixtures/s465-server-shapes/ (rv6 s1–s12, t1–t6, u1; rv3 s5/s6; r4) compiled shape by shape, every compiled
  app.server.js scanned with acorn: no `check` / `verifyPassword` call outside an `await`, no `x ( ` / `a . b`
  raw-token spacing; ≥150 shapes must compile). NEW integration/s465-await-arm-r4.test.js (98: 23 shapes ×
  {check, verifyPassword} × wrong/right executed vs bun:sqlite, a raw-token/un-awaited scan, 3 compile-error
  tests, 2 client F3 tests). NEW unit/s465-first-call-in-text.test.js (52). On 41df4784 (tests copied into an
  archive of it): guard 9 fail (both structural + 7 fixture files: r4, s1, s2, s3, s7, s8, s12), r4 file 56 fail.
- 2026-10-12T11:30Z r4 MEASURE 2 (head e74ceea7b vs origin/main 41af4153a, same 3556 sources, same roots): **0 newly
  failing, 0 newly passing, 0 diagnostic-code changes** (3555 text-only = the absolute tree path in messages);
  220 artifacts differ, 208 only by the absolute project root; 12 real: r1's 7 (sql-handled-match-scrutinee-rt,
  08-chat, 19-lin-token, status-picker, driver-card ×2, gauntlet-r10-rails-blog) + 5 from r4 —
  endpoint/arm-body-valid-scope-clean (`{ echo: … }` → `{echo: …}`, spacing), s441 repros fp1b / fp1d (block
  arrow `x => { return o . m ( x ) }` → statement-emitted `return o.m(x);`), blast-fnbody2.client.js (`await
  _scrml_fetch_isOk_5 ( 1 )` → `(1)`), and **blast-fnbody2.server.js: `const { d = verifyPassword ( pw , h ) } =
  {}` → `const { d = await verifyPassword(pw, h) } = {}` — a corpus instance of F2, un-awaited on main.**
  ../giti and ../flogence are NOT cloned in this container — skipped.
- Gates (head e74ceea7b + docs): pre-commit full 33338: 10 fail — exactly the known env list (dev-db-no-side-file
  ×5, tenant-floor-project-set ×3, promote-safety read-only, headless-serve-bind-host); root-level 2239/0;
  e2e-render-map 259/0; self-host + parser-conformance 2192/0; lsp+commands 713/11 (all `scrml dev`/`serve`
  bind/watch/HTTP, same count as r1–r3); browser-baseline --check: 1 NEW name (nested <each> in a lifted row) —
  IDENTICAL in the origin/main tree (ran there) → environmental; types-gate OK (180, unchanged); host-global-scan
  0 violations; facts + state regenerated (gap counts: +1 MED); spec-index OK; s34-census --check-new --base
  origin/main PASS; bootstrap-conformance exit 0; severity current; conflict-marker PASS; delta-lint PASS;
  gen-md-shim current; lint-no-default-arm 0; snippet-gate 128/128; corpus-compile-floor PASS.
- Maps: primary.map.md (stamp 8ce6d61b5) read for routing; NOT load-bearing — no row covers the server text-
  lowering surface (rewriteServerExpr / emitEscapeHatch / destructure defaults); every locus here was found by
  grep in source.

## Fix round 5 (S239 re-review of 55cdda9d8) — branch s465-await-r5
- 2026-10-12T11:50Z r5 start: worktree cut from origin/auto/s465-await-imported-server-fn @ 55cdda9d8 as
  `s465-await-r5`; origin/main already contained; brief archived (BRIEF-fix-round-5.md); bun install + pretest OK.
  Probe harness: a server fn `f(name, pass)` reading `row.pw`, imported async helpers `check` / `of` (lib.scrml →
  `verifyPassword`), executed vs bun:sqlite, wrong + right password (shapes now pinned in
  integration/s465-await-r5.test.js).
- r5 REPRODUCED F1 (both halves HELD) on 55cdda9d8: `const r = [of(pass, row.pw), .Found(name: "c")]⏎if (!r[0])`
  → wrong password WELCOME (`of` is in NOT_CALLEE_WORDS); `[i++ / 1 + (check(pass, row.pw) ? 1 : 0) / 1, .Found(…)]`
  → WELCOME (`/ … /` after `++` read as a regex literal). Control: the same array with `check` refused.
- F1 fix (the reviewer's root, fail closed): NEW brace-pair.ts `lexicalCallInText` — purely lexical, NOTHING skipped
  (no string / template / comment / regex reading): any `(` or backtick after a value is a call, except the
  grammar's own non-calls (a reserved word's head — reserved in an ES module, so `of`/`async`/`let`/`get` count; a
  parameter list `function f(` / `function* f(`; `new X(`; a `.Variant(` payload constructor after no value or after
  a reserved word). `serverTextLowering` (both the structural-read gate and the refusal), `refuseServerTextCall` and
  the `emitServerFnValueFromText` head check use it; `firstCallInText` is no longer a guard (kept, unit-tested).
  A false positive (a `(` in a string) first tries the tree (`readableExprTree`), so it refuses only text that is
  ALSO unreadable.
- Found while measuring F1 (pre-existing on origin/main, silent): the expression parser's SQL-block mask
  (`replaceSqlBlockPlaceholder`) replaced a `?{` inside a quoted string or template TEXT with
  `__scrml_sql_placeholder__` — `const v = "?{\`SELECT 1\`}"` evaluated to "__scrml_sql_placeholder__" (main,
  executed). The lexical guard routed `if (x == "?{…}")` onto that tree path (sql-one-reader-s457 caught it). Fixed:
  the mask skips quoted strings and tracks template text (a `${…}` substitution is code again).
- F2 REPRODUCED, REFINED: (a) `__destructured__` HELD — but it is NOT r4-new at its root: every destructured lambda
  parameter emitted from the expression tree was the placeholder (origin/main, executed: `[{ a: 1 }].map(({ a }) =>
  a + 1)` in a server fn throws `a is not defined`; also inside a function declaration). r4 extended it to every
  lambda nested in a block-bodied server value (base ran those as text). Fix: expression-parser `convertParams`
  structures the pattern (`LambdaParam.pattern`, a DestructurePattern, defaults as ExprNodes); emitLambdaParam writes
  it back through emit-destructure-pattern with defaults lowered from their trees; a computed key is refused
  (E-CODEGEN-INVALID-LOGIC; gap g-destructured-lambda-param-computed-key-s465, LOW). Note: the block-bodied value's
  OWN destructured parameter (`({ a }) => { … }`) was never broken (head kept as text) — the reviewer's shape is the
  nested lambda. (b) the word `await` in a string: HELD (`/\bawait\b/` on the emitted body) — now syntactic (the
  body must parse as a non-async function in a module, acorn). switch / try / throw / for…in: HELD as a code
  regression only — SPEC §7.2.1 makes each "rejected at the parse layer" in every position (for…in: E-CTRL-011), so
  there is NO legal host position; base RAN them only because the arrow body was never read. r5 reports the
  front-end's own code (E-SWITCH-FORBIDDEN / E-TRY-NOT-IN-SCRML / E-THROW-NOT-IN-SCRML / E-CTRL-011) instead of the
  generic E-CODEGEN-INVALID-LOGIC. Residue filed: g-js-exclusions-unchecked-in-block-arrow-value-bodies-s465 (MED) —
  the same bodies compile clean on the client always and on the server when the body holds no call (both sides,
  pre-existing).
- F3 adjudicated by SPEC §13.2 (SPEC.md:10290): "A call the compiler awaits yields the resolved value, not a Promise.
  Reading `.then`, `.catch` or `.finally` off such a call SHALL be a compile error (`E-ASYNC-CALL-PROMISE-METHOD`)."
  Neither base (silent no-op on the un-awaited Promise; `verifyPassword(…).then` threw on base too) nor r4 (TypeError
  → 500) met it. Fix: emitMember on the server records E-ASYNC-CALL-PROMISE-METHOD when the receiver is the awaited
  form `(await …)`. Not widened (index access `x["then"]` not covered).
- Test-text relaxations (same semantics): hoisted-loop reads `(await _scrml_batch_read_N(it.id))` are now lowered
  from the tree as `await _scrml_batch_read_N(it.id)` (s455-hoist-allow-list, s455-hoist-keyed-read-depth,
  sql-loop-hoist-rewrite, s455-handled-sql-guard-consumers); sql-one-statement F4 also reports
  E-SQL-MULTIPLE-STATEMENTS alongside E-SQL-QUERY-NOT-READABLE (the tree reader reads the two statements).
- Tests: NEW integration/s465-await-r5.test.js (51) — on 55cdda9d8 38 of 45 (pre-template additions) FAIL; NEW
  unit/s465-lexical-call-in-text.test.js (42). Gate (pre-merge, 33411): 0 fail.
- origin/main moved during the round (#1407, #1409): merged 5d0565dc0 (generated gap-counts / FACTS hunks resolved by
  regenerating; hand entries kept).
- 2026-10-12T15:40Z r5 CORPUS (scripts/corpus-emit-differential.ts; base = archive of origin/main 5d0565dc0, head =
  archive of 50329d051 (r5 + that main merged); 3557 sources: examples, samples, conformance, stdlib, benchmarks,
  docs; ../giti and ../flogence not measured; verdict line "NOT A VALID COMPARISON" only because archived trees have
  no .git — same as r1–r4): **0 newly failing, 0 newly passing**; syntax delta 0; 1 diagnostic-code change
  (conformance sql/query-not-readable-neg — already a failing neg case — now also reports E-SQL-MULTIPLE-STATEMENTS);
  1 text-only (s441 repro match-arm-bare-binding: the r3-held "trailing content dropped" warning gone); 221 artifacts
  differ, 197 only by the absolute project root; 24 real = r1–r4's 12 + r5's 12: ten hoisted-loop conformance
  servers + the nplus1 repro (`(await _scrml_batch_read_N(it.id))` → `await _scrml_batch_read_N(it.id)`, tree path)
  and s441 repro fp1a (`x => { return "m(" + x }` — a `(` in a string; lexical false positive → read by the
  statement emitter; same function, multi-line). **The F1 lexical refusal newly refuses 0 corpus sources.** The
  template-aware mask (50329d051) changes no corpus artifact (head before it: identical 24).
- Gates: pre-commit full at 34eb17922 (pre-merge) 33411/0 fail; at db4e5b6d4 (merge) and 50329d051: 35824/35830
  pass ("Pre-commit checks passed"); types-gate OK (180, unchanged — after casting the new ESNode field reads
  through unknown); host-global-scan 0 violations; state + facts --check PASS (regenerated at the merge).
- 2026-10-12T19:30Z r5 merged origin/main 3cebd3387 (#1414 batch; generated hunks regenerated, hand entries unioned —
  every main gap id kept). known-gaps: g-tree-path-destructured-arrow-param-s465 → resolved (r5); annotated
  g-imported-async-server-fn-not-awaited-s465 (r5 status; stays open until landed) and
  g-destructure-string-default-loses-quotes-s465 — CORRECTION, executed: the branch does NOT fix it on the server
  (`const user = "admin"⏎const { v = "user" } = {}` → "admin" on branch and main; root: ast-builder.js
  parseDestructurePattern → collectDefaultText joins token `.text`, a STRING token has no quotes). Not fixed here.
- ab1415e74 tightening (self-review): `x?.Check(…)` and `{ A: f }.A(…)` are calls, not `.Variant(…)` constructors.
- FINAL CORPUS (base = archive of origin/main 3cebd3387; head = 075f9bf43 + ab1415e74's brace-pair.ts; 3583 sources,
  same roots): 0 newly failing, 0 newly passing, syntax delta 0, 1 code change (sql/query-not-readable-neg +
  E-SQL-MULTIPLE-STATEMENTS), 1 text-only, 221 artifacts differ — 197 root-path only, 24 real (identical list to the
  5d0565dc0 measurement). F1 lexical refusal: **0 corpus sources newly refused.**
- FINAL GATE (pre-commit at ab1415e74): 35960 pass / 0 fail.

## Fix round 6 (S239 adversarial review of dcbbd64d7) — branch s465-await-r5
- 2026-10-12 r6 start: brief archived (BRIEF-fix-round-6.md); origin/main had no new commits (merged #1415 later).
  Harness: the reviewer's `harness.mjs` copied to .tmp (out dir → TMPDIR); base = archive of origin/main 3cebd3387.
- HIGH-1 REPRODUCED (branch + main): lib `const inner = (p, h) => verifyPassword(p, h)` + `export function check` →
  wrong password WELCOME; in-file `const w = (a, b) => check(a, b)`; stdlib twin. Root: computeAsyncFnNames saw
  `function` declarations only. FIX (fn-valued-bindings.ts): a top-level `const/let/export const NAME = <lambda | fn
  expr | block arrow>` is a pseudo function declaration for the fixpoint — cross-file (collectAsyncFnNamesFromFile)
  and in-file (codegen/index.ts `_asyncLocalBindings`, seeded by async imports, Promise stdlib imports, `?{}` and this
  file's server functions). The server callee map carries the set (module-resolver answers it before the registry
  check) so every server call site awaits it; D-5 (emitReferencedModuleConstLines) emits the binding `async` (tree
  lambda `isAsync`; block body via emitServerFnValueFromText `{async:true}`), closes over bindings read only by other
  emitted bindings (was `ReferenceError: a`), refuses a module value that aliases / stores / calls one
  (E-ASYNC-FN-ESCAPES-AS-VALUE), and drains the sync-callback sink after itself (`const mk = (h) => (p) => check(p,
  h)` → E-ASYNC-STDLIB-IN-SYNC-CALLBACK). In function bodies the existing escape machinery sees the binding through
  the classifier (alias / object / pass-to-user-fn → E-ASYNC-FN-ESCAPES-AS-VALUE). CLIENT half: the client does not
  colour the binding; a client use (scope-aware over the emitted bundle, module-scope-refs.ts) is refused — executed
  `w(2) ? "Y" : "N"` was always "Y". Colouring the client copy is left open (gap annotated).
- MED-1 REPRODUCED (11 regex shapes refused, "it calls `/[A-Z]`"): the parser keeps a regex as a Literal hatch.
  FIX: a hatch acorn parses as ONE Literal token lowers without the guard (serverTextLowering `literal`).
- MED-2 REPRODUCED (`badmatch:undefined` at exit 0; base refused): a function value's body is never type-checked,
  so a variant `match` in it had no subject type. FIX: E-TYPE-025 (what the same body gets in a `function`); a
  string-literal match in a function value still lowers (and now runs — base refused it).
- LOW-1 REPRODUCED: `const s = "?{`SELECT pw FROM users`}"` in a client fn → E-CG-006. FIX: isServerOnlyNode
  tests only hatch text of a parsed tree (a real query is a `sql-ref` node); the client leak scan blanks string /
  template-text contents (acorn tokenizer; untokenizable → read raw).
- LOW-2 REPRODUCED (`.Found(name: "a (b)")`, `.Found(name: name.trim())` refused, fake callee). FIX: named /
  mixed named-argument variants are put in declared field order and lowered from the tree (arguments awaited —
  `.Found(name: String(check(…)))` now carries "false"/"true"; main ships "[object Promise]"). The refusal text no
  longer names a callee ("holds what may be a call (at `x(`)").
- LOW-3 per ruling S464 cfor-comma "b": a C-style `for` header comma list (init / update) is lowered element by
  element (server and client); a VALUE-position comma stays refused on the server and is now refused on the client
  too (cascade-only; api.js drops cascade-only CG refusals behind an earlier stage's error — defer-outside-function).
- Found while fixing: a local `splitTopLevelCommas` I added shadowed emit-expr's import and broke multi-scrutinee
  match lowering (`if (true)` arms) — caught by the gate, removed.
- Pre-existing, filed (executed): g-top-level-fn-param-default-dropped-server-s465 (HIGH: `function g(x = 5)` →
  `g()` is undefined on the server), g-lib-export-const-lambda-missing-import-s465 (MED, ReferenceError — fails
  closed), g-lib-exported-fn-destructured-param-codegen-s465 (MED, compiler defect — fails closed),
  g-typed-arrow-param-in-server-fn-value-s465 (LOW). `export { verifyPassword as check } from "scrml:auth"` →
  already g-local-stdlib-reexport-no-server-emit-s462. `new verifyPassword(…)` is ALREADY refused
  (E-ASYNC-FN-ESCAPES-AS-VALUE) — my r5 note was wrong.
- Tests: NEW integration/s465-await-r6.test.js (39): on dcbbd64d7 32 of 37 (pre-client-half) FAIL; the 5 that pass
  there are controls (fn-decl twin, sync lambda, string match, mixed variant, value comma). Updated to the ruling /
  new reading: s465-await-arm-r3 (client comma → refused), -r4 (for-header comma → value comma), -r5 (hatch shapes
  use an unknown field so they stay unreadable; the readable ones run in r6).
- Reviewer probe set (s1–s14, 206 shapes) on the final head: 0 wrong passwords accepted; failures are compile
  errors or the pre-existing re-export IMPORT-FAILs (fail closed).
- CORPUS (corpus-emit-differential; base = archive of origin/main 707c499fb, head = archive of bd743f3ac; 3583
  sources: examples, samples, conformance, stdlib, benchmarks, docs): 3 newly failing — exactly the S441 gap
  reproducers docs/changes/s441-async-escape-f4-f5/review-repro/{tl-arrow-const, tl-arrow-handler, tl-fnexpr-const}
  (the client accept-all this round refuses: E-ASYNC-FN-ESCAPES-AS-VALUE); 0 newly passing; syntax delta 0; 4 code
  changes (those 3 + query-not-readable-neg's extra E-SQL-MULTIPLE-STATEMENTS from r5); bare `_scrml_fetch_*` sites
  78 → 74; 221 artifacts differ, 197 by the project root only, 24 real — the SAME list as r5 (r6 changes no other
  corpus artifact).
- EXTERNAL CORPUS (the reviewer's list.txt: 231 files across giti / flogence / scrml-site / 6nz; per-file compile,
  status + hash of emitted .js): 0 status changes (14 failing on both sides), 3 emit-only changes, all inspected:
  6nz playground-four (C-for header lowered from the tree: `n.children.length` spacing), giti cli-args (`const i = i
  + 1` → `i = i + 1` inside a C-for body: main ships a TDZ ReferenceError — the r3 for-header-names fix), flogence
  fsp-wire-tool (`await (rpc(…))` → `await (await rpc(…))`: `rpc` is a function-valued binding now coloured async;
  same value).
- 2026-10-13 r6 merge of origin/main 351c11b7c (#1416, #1419) → 0352fea45. Code conflicts: emit-server.ts only (4
  hunks) — #1419 replaced `emitReferencedModuleConstLines` with `planModuleBindingClosure` (transitive closure in
  dependency order, E-ROUTE-002 refusals, N1–N4) and `checkUserModuleDeclCollisions`, and moved the D-5 call after
  every helper block. Resolved by taking main's side of all 4 hunks and re-applying r6 inside it: (1) two new
  optional params `asyncCalleeMap` / `asyncExportRegistry` + `asyncLocalBindingsOfFile(fileAST)`; (2) in the value
  branch, before `emitLogicNode`: the r6 module-value escape refusal (E-ASYNC-FN-ESCAPES-AS-VALUE, the binding added to
  `refused`) and the async emission (`asyncFnValueDecl` + the async facts in the emit opts); (3) the web-app call site
  passes `_asyncCalleeMap` / `_asyncExportRegistry` and drains the sync-callback sink after the closure. r6's own
  "referenced is transitive" fixpoint is dropped — main's closure supersedes it (it follows lambda bodies through
  `codeTokens`). The value-only module path (`generateValueOnlyServerJs`) is unchanged (it has no export registry —
  pre-existing). One import fix (auto-merged, not a conflict hunk): emit-server's scheduling import now carries both
  main's `buildCalleeImportMap` and r1's `buildServerCalleeImportMap` (types-gate caught the missing name).
  known-gaps: both sides' entries kept (every main gap id present), counts regenerated; FACTS regenerated.
- Gates on 0352fea45: pre-commit full 36163 pass / 0 fail; types-gate --check OK (180, 0 NEW); self-host-v2 2280 / 0;
  commands + lsp 726 pass / 3 skip / 0 fail (after `bun run pretest`); s465 test files (8 integration + 5 unit) 533 /
  0; PA repro `pa-verify.mjs` high1LibLambda wrong → REJECTED, right → WELCOME; reviewer probes s1–s14 (206 shapes):
  0 wrong passwords accepted (3 IMPORT-FAIL = the filed stdlib re-export gap, fail closed).
