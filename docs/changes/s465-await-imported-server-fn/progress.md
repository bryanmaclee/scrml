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
- 2026-10-13 origin/main moved again during the gates (#1417, f7b7310bf): merged → 7a45390b6. One code hunk:
  compiler/src/codegen/index.ts imports — HEAD added `dropCascadeOnlyErrors` (server-text-guard), main added
  `recordRefusedLowering` + `refuseUnrenderedStatementMarkup` / `markupNotRenderedMessage`; resolved as the union of
  both. known-gaps: main's 15 new S462/S464 entries + every branch entry kept (both id sets verified present),
  counts regenerated; FACTS regenerated.
- Gates on 7a45390b6: pre-commit full 36251 pass / 0 fail; types-gate --check OK (180, 0 NEW); self-host-v2 2280 / 0;
  commands + lsp 726 pass / 3 skip / 0 fail (after `bun run pretest`); s465 test files 533 / 0; `pa-verify.mjs`
  high1LibLambda wrong → REJECTED / right → WELCOME; reviewer probes s1–s14 (206): 0 wrong passwords accepted.

## Fix round 7 (S239 review of 22ed85298) — ROOT fixes; branch s466-await-r7 → pushed to s465-await-r5
- 2026-10-13 r7 start: `git checkout -b s466-await-r7 origin/s465-await-r5` (22ed85298); brief archived as
  BRIEF-r7.md (6465341a2); bun install + pretest OK. Reviewer probe set copied to
  $HOME/.cache/scrml-agent-tmp/s466-await-r7 (harness out dir + BR tag adjusted). r6 tip measured: the set is
  **331** shapes (23 files; the brief's "333" counts 2 more than the files define), **12 wrong passwords
  accepted** (libFnDecl* ×7 — libFnDeclIf appears in both n7 and n8 — and schedShadow* / stdSchedShadow* ×5).
- 2026-10-14 the Claude process exited mid-round; resumed on the same worktree, uncommitted work committed
  hook-gated (2626714f0, full pre-commit suite passed).
- HIGH-A REPRODUCED + root CONFIRMED: `lib.server.js` "ss1: module value exports" shipped a sync `export
  function check` with `if (!inner(p, h))` — the ss1 block ran its OWN `computeAsyncFnNames` over the
  VALUE-EXPORTED functions only. Six readers answered "is this name async" for a file, each over its own
  subset. FIX (one set, one computation): NEW `codegen/file-async-fns.ts` `computeFileAsyncFnNames` — every
  file-scope function declaration (exported or not, `server function`s), every function-valued binding, the
  file's server functions as MEMBERS (each is an async in-process peer on the server) and as triggers, the
  async imports; one fixpoint over the call graph. `codegen/index.ts` `fileAsyncFnNamesOf` computes it ONCE
  per file, memoized for the run (`newFileAsyncMemo`), and the same memoized set answers every importer
  ("is the export I call async?") — the cross-module seed and the file's own emitters cannot disagree.
  Stashed as `_asyncFnNames` (`setFileAsyncFnNames` / `asyncFnNamesOfFile`).
  Readers now on the one set: emit-server ss1 value exports (`asyncFnNames = asyncFnNamesOfFile`), the D-5
  binding closure (`planModuleBindingClosure`), the server callee map (`buildServerCalleeImportMap`: imports
  ∪ async bindings read off the set), the CPS wrapper (via the map), emit-client's binding backstop.
  REMOVED second readers: (1) emit-server ss1 `computeAsyncFnNames(fnDeclByName.values() …)`; (2)
  codegen/index.ts r6 `_asyncLocalBindings` fixpoint; (3) `scheduling.ts asyncLocalBindingsOfFile`; (4)
  emit-tool.ts `collectAsyncFnNamesFromFile` (the cross-module export analysis, no server functions); (5)
  index.ts `asyncExportNamesOf` (→ `fileAsyncFnNamesOf`). `collectTopLevelStatements` moved to collect.ts
  (file-async-fns must not load emit-tool: a module-init TDZ through emit-server).
  Refinement found while fixing: a server function's ss1 VALUE copy keeps its pre-r7 shape when it is in
  the set only as itself (`asyncByBodyOf`): emitting `export server function aL() { session.set(…) }` async
  with a server body raised E-SESSION-CONTEXT (conf-SESSION-PROGRAM-ATTR-SCOPE). Also found: a lib export
  calling a server-PLACED sync helper (`export function quad(x) { return dbl(dbl(x)) }`) shipped sync against
  the async peer `dbl` on r6 — now awaited (pinned, executed: quad(1) == 4). A binding is async by its BODY
  (`asyncFnValuedBindingsOfFile` = by-body ∩ bindings): a top-level `const onOpen` beside a channel's
  `server function onOpen` is not that function (E-CHANNEL-006 clean negatives).
  NOT moved onto the set (stated): the client coloring (`computeClientAsyncSets` — a different question: on
  the client a server fn is a fetch stub), library mode (`emitAsyncLibraryFns`: the GITI-038 guarded walk,
  a client-facing `.js`), tool mode (`generateToolJs` and the serve/tool-lib paths: no stdlib registry
  handed in), and emit-server `_genuineAsync` (it decides the ESCAPE rule's narrower outer facts, #284, not an
  await). Each of those is a remaining per-emitter fixpoint — filed below.
- HIGH-B REPRODUCED + root CONFIRMED and refined: FOUR readers (not two) decided "is this the global
  scheduler" by name: emit-expr's lowering (`KNOWN_DISCARD_HOF.has && !ctx.declaredNames.has` — a file-scope
  `function setTimeout` is not in a body's declaredNames → the lambda went async and the user function's
  Promise was tested), `isKnownDiscardHofCall` + `asyncFnArgRole` (a per-call BOUND_CALLEE_MARK a pre-pass set
  on some paths), fn-valued-bindings `asyncValueUsesIn` (own `SCHEDULERS` list, no shadow test) and
  js-async-analysis (its own `isBound`). SPEC §13.2 (SPEC.md:10311): "The scheduler is global only when the
  file neither binds its name in any form (a declaration of any pattern shape, a parameter, a function, class
  or method name, a catch parameter, an import alias, an object-literal key) nor writes it (`setTimeout = …`,
  `globalThis.setTimeout = …`, `window.setTimeout = …`, a computed write, or a reflective definition such as
  `Object.defineProperty(globalThis, "setTimeout", …)`); otherwise no exemption is given (fail closed)."
  FIX: ONE predicate `async-combinators.ts isGlobalSchedulerCallee(name)` over the file's binding set
  (`schedulerNamesNotProvablyGlobal(fileAST)` — the existing whole-file tree + code-text walk), installed
  once per file by codegen/index.ts (both per-file loops; reset with the other per-file facts; uninstalled →
  NOT global, fail closed). All five readers ask it; BOUND_CALLEE_MARK and SCHEDULERS deleted. The five
  shapes now fail closed (E-ASYNC-STDLIB-IN-SYNC-CALLBACK); the sync-callback and global-scheduler controls
  run.
- MED-C (REGRESSION) FIXED by colouring, not by the fallback: the client coloring fixpoint now includes the
  file's function-valued bindings (`computeClientAsyncSets`), an async one is emitted `async` with the
  async-body facts (`emit-reactive-wiring emitTopStmt` → shared `asyncFnValueDecl`; a block body lowered from
  the tree by `emitServerFnValue` in client mode), and every client call site awaits it through the
  peer-await set (handlers, fn bodies, markup). Found: the group's declaredNames listed the binding names, so
  `const b = (p, h) => a(p, h)` read `a` as a shadowing local — the async binding's emit drops them. The r6
  blanket refusal is now a backstop over the final bundle: a reference that is not `await name(…)` is
  E-ASYNC-FN-ESCAPES-AS-VALUE at the binding's own span (`module-scope-refs awaitedCallsAreNotUses`).
  Executed (happy-dom, stubbed routes): cl2 `persist("x"); @out = "after"` runs and awaits; cl3 `@n =
  loadCount()` → 7; `w(2) ? "Y" : "N"` → "N" (base: always "Y"); an alias `const z = w` refused.
- MED-D FIXED: `emit-logic emitServerFnValue(hatchNode)` takes head and body from the expression parser's own
  node (`EscapeHatchExpr.params` — acorn's structured parameters, defaults as trees — and `bodyRaw`, acorn's
  body span); params emitted by `emit-expr emitFnValueParams`; a default that would need `await` is refused by
  the emitted head's syntax. `splitFnValueText` deleted; `fn-valued-bindings fnValueBody` reads `bodyRaw`
  (the stray `<fn-value>` stderr warning came from re-parsing a mis-split body). All n5 split* / n6 shapes
  run. Test-text relaxation: is-predicate-in-function-expression-1333 C (`function ( v )` → `function(v)`).
- LOW (runLambda code choice) NOT done: the code is chosen at ~7 sink-recording sites in emit-expr and drained
  by 4+ emitters (server route, ss1, library, client); "passed to a user HOF" is not known at the recording
  site. Not trivial → filed (g-lambda-to-user-hof-reports-sync-callback-code-s466).
- ACCEPTANCE — reviewer probe set (probes/s1–s14 + pa-verify + probes2/n1–n8 = 331 shapes, executed vs
  bun:sqlite on the final code tip 71f3f7bf9): r6 tip 22ed85298 → RUN-OK 209 / ERR 98 / runtime-fail-closed 12
  / **ACCEPTED 12**; r7 → RUN-OK 226 / ERR 92 / runtime-fail-closed 13 / **ACCEPTED 0**. Changed shapes: the 7
  libFnDecl* → REJECTED/WELCOME (libFnDeclSql → "no such table: users": the lib has no database of its own —
  it now RUNS the query instead of testing a Promise); the 5 sched*Shadow* → E-ASYNC-STDLIB-IN-SYNC-CALLBACK;
  the 11 MED-D shapes (n5 split* ×6, n6 ×5) → run; topFactoryConst / libFactory gain E-ASYNC-FN-ESCAPES-AS-VALUE
  beside their existing errors. Runtime fail-closed (unchanged from r6/base, all 500s, none a wrong value):
  libReexportStd*, libChainReexport3, reexportLocal (g-local-stdlib-reexport-no-server-emit-s462 family),
  libLambda / libObjExport (g-lib-export-const-lambda-missing-import-s465), propagate / sqlInBindingBlock /
  peerSchedShadowTop (NEW gap g-fn-reached-only-through-lambda-not-on-server-s466), hatchCapMember (the
  program calls a non-function), nestedServerCall NO-ROUTE. MED-C cl2 / cl3: compile and run (happy-dom tests).
- CORPUS DIFFERENTIAL (scripts/corpus-emit-differential.ts; base = archive of f7b7310bf with node_modules
  symlinked, head = this worktree at 71f3f7bf9; roots examples, samples, conformance; 2779 sources): **0 newly
  failing, 0 newly passing**, syntax delta 0, 1 code change (conformance sql/query-not-readable-neg +
  E-SQL-MULTIPLE-STATEMENTS — r5's, unchanged); 169 artifacts differ, 153 only by the absolute tree root; 16
  real — r1–r6's (the hoisted-loop servers ×11, sql-handled-match-scrutinee-rt, endpoint arm-body-valid-scope,
  08-chat, 19-lin-token, gauntlet-r10-rails-blog) + ONE from r7: examples/23-trucking-dispatch
  pages/auth/login.server.js `redirectTo: rolePath(row.role)` → `redirectTo: await rolePath(row.role)` (the
  imported `rolePath` is a server-placed function — an async peer — so the one set lists it; its value copy is
  sync, the await is a no-op on its value: emit-only). Verdict line "NOT A VALID COMPARISON" only because the
  archived base has no .git (as r1–r6). Bare server-fn sites 30 → 29 (19-lin-token, r1's).
- GATES: unit + integration + conformance + compiler/tests/*.test.js — the pre-commit hook (full, no bail
  failure) passed on 2626714f0 and on 71f3f7bf9 (the last code commit); types-gate OK (180, unchanged);
  bootstrap slice: lint-no-default-arm 0 violations, self-host-v2 m1–m4 + codec 2280 / 0; lsp + commands 726
  pass / 3 skip / 0 fail; facts --check PASS (regenerated, +1 module); state --check PASS (regenerated after
  the gaps); regen-spec-index --check OK; corpus-compile-floor --check PASS; host-global-scan --check exit 0
  (the one `[esm]` note, stdlib/auth/password.scrml, is identical on the base tree).
- 2026-10-14 MERGE of origin/main d840885c0 (#1418 E-VALUE-FUNCTION-STORED, #1422) → 30b333824. No code
  conflict (compiler/src auto-merged: type-system.ts, value-function-stored.ts, pipeline-seam.ts,
  runtime-template.js). Doc conflicts: known-gaps.md — the generated count table (regenerated, state --write) and
  one hunk where both sides appended entries after g-tree-path-destructured-arrow-param-s465 (union; every gap
  id of both sides verified present: 2064 main ∪ 2058 branch → 2077 merged); FACTS.md regenerated. spec-index,
  bootstrap-conformance and gen-md-shim current.
  Interactions with #1418 (checked by execution, none needed a code change): #1418 is a type-stage check on
  STORED functions; r7's changes are codegen (colouring / emission). (1) The 331-shape probe set on the merged
  tree: 0 wrong passwords accepted; RUN-OK 226 unchanged; 13 shapes that r7 already refused now ALSO report
  E-VALUE-FUNCTION-STORED (objArrowProp, topObjOfLambdas, topArrOfLambdas, calleeIndex, topDestructLambda,
  topObjDestructLambda, libInnerObj, libInnerArr, libDestrLambda …) or report it INSTEAD of
  E-CODEGEN-INVALID-LOGIC (objMethod, objMethodSync, libObjMethodShorthand); libObjExport moves from a runtime
  ReferenceError (500) to a compile error. (2) MED-C (client colouring of `const persist = (v) => save(v)`):
  a local binding NAMING a function is allowed by #1418 (§14.3 "a local binding may NAME one") — the MED-C
  happy-dom tests pass unchanged; an alias `const z = w` stays refused by r7's backstop. (3) MED-D reads a
  block body via `hatch.bodyRaw` + the arm statement parser; #1418 / §42.3.5 read the same `bodyRaw` via
  `escape-hatch-body.ts` (check-time). Same delimited text, two statement parsers — pre-existing (r1/r4 codegen
  reader vs the S462 check reader), not introduced by the merge; noted, not changed.
  Tests on the merged tree: s465-* (integration + unit), value-function-stored, stdlib-time-debounce-struct,
  fn-expr-member-assign, s441-async-escape-f4-f5, handle-request-body-autoawait, is-predicate-1333,
  s457-handler-call-chain, s462-narrowing-ends-on-write, peer-call-in-template-interp-awaited,
  protect-error/scalar-egress: 1214 pass / 0 fail.
  Gates on 30b333824: pre-commit (unit + integration + conformance + compiler/tests/*.test.js) 36392 pass / 58
  skip / 0 fail; types-gate OK (180, unchanged); lint-no-default-arm 0; self-host-v2 slices 2280 / 0; lsp +
  commands 726 / 3 skip / 0; facts, state, spec-index, bootstrap-conformance, corpus-compile-floor --check PASS;
  host-global-scan exit 0; browser-baseline --check PASS (48 asserted, 0 of 2 env-excluded observed).

## Fix round 8 (S239 review of f84da20a3) — branch s466-await-r8
- 2026-10-14 r8 start: `s466-await-r8` cut from origin/s465-await-r5 f84da20a3; brief archived as BRIEF-r8.md
  (8a7e2f6ec). Reviewer probes3 (m1–m4, 61 shapes) copied; harness gained the reviewer's `files:` support (without
  it the m1 chain3* shapes read as E-IMPORT-006 — a harness artifact, not a compiler change). REPRODUCED all five:
  bindNotBinding, libBindChainNot, topBindingAwaitedInBinding, appExportConstAnn, libExportConstAnnInner →
  wrong password WELCOME.
- HIGH-1 root CONFIRMED: emit-server `planModuleBindingClosure` emitted each module binding with `declaredNames:
  new Set(byName.keys())`, and the server await branches (emit-expr `isStdlibAsyncCallee` path, the peer path)
  treat a declared name as a shadowing local — so `w` in `const v = (p, h) => !w(p, h)` was never awaited. The
  same bug r7 fixed by hand on the client. FIX: ONE rule, `file-async-fns.ts moduleLevelDeclaredNames(names,
  asyncNames)` — a module binding is not a local; the async ones leave the set; the binding's own params / inner
  declarations still shadow (pinned: paramShadowsBinding). Used by the server D-5 copy and the client
  top-level copy (emit-reactive-wiring `emitTopStmt`, r7's hand-written filter replaced). Other emitters checked:
  every other `declaredNames` construction is a params / block-scope set (emit-control-flow / emit-logic
  `blockScopedDeclaredNames`, emitLambda's child set, emitLibraryFnMember's params) — no other module-scope set.
- HIGH-2 root CONFIRMED: `fn-valued-bindings.ts` read an export's init with a regex over `s.raw` that cannot pass
  a `: (p: string) => boolean` annotation; the ss1 emitter read `valueInit`. FIX: the AST builder attaches
  `valueInit` / `valueInitExpr` (the parsed init) to the UNANNOTATED plain function-value export too
  (`export const f = (…) => …` / `= function …` / `= x => …`; same raw — narrowed to function-value inits after
  the gate showed the generic path owns `match` / multi-declarator / `?{}` value exports: 7 tests);
  `fn-valued-bindings` reads `valueInitExpr` (no `raw` read left in fn-valued-bindings.ts / file-async-fns.ts). The
  ss1 copy of an async exported value is emitted `async` with the await facts (emit-server const branch, from the
  parsed init; emit-logic `_logicOptsFromExprCtx` now carries the await facts for a function value lowered from
  an expression context).
- LOW (both fixed): `asyncFnNamesOfFile` without a stash FAILS CLOSED (every file-scope function / binding / known
  async import is async). Channel `onserver:*` handler (ch1): emitted `async` when its emitted body awaits at
  its own level (`bodyTextHasOwnAwait`); the WS callbacks already await it (emit-channel §19.10.6) — was a sync
  function holding `await` → E-CODEGEN-INVALID-LOGIC.
- Found and fixed while measuring: with HIGH-2's parsed init, `export const check = function (p, h) { return
  verifyPassword(p, h) }` in a lib now compiled (r7: E-CODEGEN-INVALID-LOGIC) — and threw `verifyPassword is not
  defined`: the value-only `.server.js` (`_generateValueOnlyServerJs`) was written with NO import lines. It now
  emits the referenced imports (usage-pruned). g-lib-export-const-lambda-missing-import-s465 → resolved.
- MERGE of origin/main 7f2b81418 (#1424 = the squash of r1–r7, tree identical to f84da20a3): the four add/add
  conflicts resolved by a real 3-way merge against the content base f84da20a3 (`git merge-file`) — every file
  merged clean to the r8 version; tree unchanged (3ce0d9bed).
- PROBES (392 = 331 + 61 probes3, executed vs bun:sqlite, final tip): wrong passwords accepted **0**. Old 331:
  RUN-OK 228 / ERR 92 / runtime-fail-closed 11 (r7: 226 / 92 / 13 — libLambda and libFnExpr now run). probes3
  61: RUN-OK 25 / ERR 34 / runtime-fail-closed 2 / ACCEPTED 0 (reviewer on f84da20a3: 20 / 34 / 2 / **5**).
- CORPUS (corpus-emit-differential; base = archive of origin/main 7f2b81418, head = this tree; examples, samples,
  conformance; 2784 sources): 0 newly failing, 0 newly passing, 0 diagnostic changes, syntax delta 0; 165
  artifacts differ — ALL by the absolute tree root only (0 real emit changes).
- GATES: pre-commit (unit + integration + conformance + compiler/tests/*.test.js) 36405 pass / 0 fail on the final
  code commit; types-gate OK (180, unchanged); lint-no-default-arm 0; self-host-v2 slices 2280 / 0; lsp + commands
  726 / 3 skip / 0; facts (regenerated), state, spec-index, bootstrap-conformance, corpus-compile-floor --check
  PASS; host-global-scan exit 0; gen-md-shim current; browser-baseline --check PASS.

## Fix round 9 (S239 review of e4b2c24e4: DO-NOT-LAND) — branch s467-await-r9
- 2026-10-15T09:45:53Z r9 start: s467-await-r9 cut from origin/s466-await-r8 e4b2c24e4. Next: reproduce HIGH-1 (paren/async arrow export init unclassified), HIGH-2 (value-only import lines), MED-1 (import of never-emitted .server.js).
- r9 work (uncommitted until the PAUSED commit below): ast-builder generic export path attaches `valueInitExpr` to every
  plain-named const/let export; fn-valued-bindings.ts classifies the PARSED init (literal in any spelling = the
  binding's function, written `async` read off the node; ternary / `||`/`&&`/`??` arms, aliases, returned functions,
  later `let`/tilde writes = escapes, coloured with the binding via pseudo fns, refused when async —
  E-ASYNC-FN-ESCAPES-AS-VALUE, reported once per binding from codegen/index.ts via file-async-fns
  `fileScopeAsyncEscapesOf`); expression-parser escape hatch carries acorn `async`; api.js
  `reconcileValueOnlyImports` (MED-1/HIGH-2: a value-only .server.js imports only names the target's emitted
  .server.js exports); security-await-pack brought from main + families x1 (reviewer, verbatim) and r9 (18 new),
  KNOWN_FAIL emptied, count 463; new test compiler/tests/integration/s467-await-r9.test.js (10 pass).

## PAUSED (S467)
- DONE: HIGH-1 (root: parsed-init classifier, no token-shape list; `_isFnValueInitAt` kept only as parse routing),
  HIGH-2 / MED-1 (api.js reconcile), PA addendum p2_ternary (client) → E-ASYNC-FN-ESCAPES-AS-VALUE (pinned in
  s467-await-r9.test.js). PROBES on the working tree: full pack 424 + x1 21 = 445 shapes → **0 FAIL**
  (PASS 288 / PASS-REFUSED 138 / PASS-500 14 / PASS-DENY 4 / UNJUDGED 1); base.tsv had 10 FAIL, branch.tsv 4. r9
  family 18 shapes: 0 FAIL. Moved FAIL→REFUSED: m5 libExportTernaryFn / libExportImportedValue / libExportCurried,
  x1 parenArrowSingle (E-ASYNC-FN-ESCAPES-AS-VALUE); x1 asyncArrowExport(Await) / voAsyncArrow → E-ASYNC-NOT-IN-SCRML
  (the async arrow now reaches the checker); m5 libExportParen, x1 voParen → PASS; x1 voTypeImportUse /
  voComponentImportUnused, m7 voUsesClientOnlyComponent → PASS (was PASS-500); m7 voUsesEnumFromTypeLib PASS-DENY
  (as base: enums have no server value in a value-only module — open).
- GATES on the working tree: unit 25837/1 fail (s457-string-url D, flaky under load, passes alone);
  integration+conformance+compiler/tests/*.test.js 10564/1 fail = foreign-sealed-scope "under Node the slice gets a
  working require too" — PRE-EXISTING ON origin/main ON THIS MACHINE (Node v21.6.0: no ESM detection /
  getBuiltinModule). It blocks the pre-commit hook; not bypassed. types:check OK (180 unchanged);
  commands+lsp 726/3 skip/0.
- HALF-DONE: corpus differential (base = origin/main archive, head = origin/main + r8/r9 patch, roots examples,
  samples, conformance/cases, giti + flogence copies) — base captured (2897 / 1776 compiled), head capture was
  running at pause. Scratch: ~/.cache/scrml-agent-tmp/s467-await-r9/corpus/.
- NEXT: (1) run the hook on a machine with Node >= 22 (or have the user rule on the env test) and commit/push;
  (2) finish corpus diff + self-host-v2 bootstrap + facts/state/spec-index/gen-md-shim --check; (3) rerun the
  463-shape pack via `bun compiler/tests/integration/security-await-pack/classify.js`.
- RESUME NOTE: bryan ruled S467 that impl#1 will ENFORCE dpa-023 F4 (a waiting function may be bound only by a
  `function` declaration → E-ASYNC-FN-ESCAPES-AS-VALUE) once the SPEC text lands. That changes round 9's
  direction from COLOURING fn-valued bindings to REFUSING them: the r6–r9 pseudo-fn colouring of `const f = (…) => …`
  becomes a refusal; the escape judge here (fileScopeAsyncEscapesOf) is the natural place to widen.
- 2026-10-15 CORPUS (done after the block above): diff = 0 newly failing / 0 newly passing / 0 diagnostic
  changes / syntax delta 0 / bare server-fn sites 36 = 36; 170 artifact content diffs NOT yet inspected (r8 saw
  165, all absolute-tree-root only); the verdict says INCOMPARABLE only because both archive trees lack a git
  revision. COMMIT BLOCKED by the pre-commit hook (the Node-v21.6 foreign-sealed-scope test above; not bypassed):
  the r9 change set is STAGED in the worktree, NOT committed or pushed. Backup patch (git apply --index):
  ~/.cache/scrml-agent-tmp/s467-await-r9/r9-staged.patch

## RESUMED (S467, round 9 cont.) — branch s467-await-r9
- 2026-10-15 resume at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a0ff927ec641522dc: base origin/s466-await-r8
  e4b2c24e4; commit-blocker fix `deea6e822` (s461 unregisters happy-dom — same content as main #1429); the paused
  patch committed as `9ab02ba1c` (the hook PASSED on Node v26: the Node-21 foreign-sealed-scope failure is gone).
- CORPUS 170 emit diffs, classified by normalising the two archive roots (`…/corpus/base` / `…/corpus/head`):
  165 are `_scrml_project_root` absolute-path noise only; the other 5 (4 content + 1 renamed runtime file) are ONE
  real change in samples/compilation-tests/s457-host-global-alias (page entry): the client runtime gained the
  `equality` chunk (`_scrml_structural_eq`) though no client file calls it. Cause: the r9 `valueInitExpr` copy on
  `export const SAME_SHAPE = { a: 1 } == { a: 1 }` (a server-only value export) was walked by
  compute-pgo-flags' presence walker. FIX `1aad4bb9b`: the three presence walkers skip `valueInitExpr` (a parsed
  copy no client emitter lowers from; a client-emitted export still lights the chunk through the post-emit
  `_scrml_structural_eq(` reference gate). The fixture's runtime is byte-identical to base again; new
  compiler/tests/unit/s467-pgo-value-init-copy.test.js (3) pins both directions.
- MERGE `db1a7eaa7`: origin/main 179f9b346 (#1423, #1425, #1426, #1428, #1429). Real 3-way merge; add/add on the pack
  files kept the branch superset (463 shapes, KNOWN_FAIL empty); s461 test took main; FACTS regenerated; known-gaps
  count hunk regenerated by state.ts (MED 644 = main 645 − the r8-resolved g-lib-export-const-lambda entry), entry
  hunks kept; gap-id set == union of both sides (2101).
- PACK on the merged tip (classify.js and the reviewer run.mjs, both): 463 shapes, **0 FAIL** — PASS 289 /
  PASS-REFUSED 154 / PASS-500 15 / PASS-DENY 4 / UNJUDGED 1. x1: PASS 15 / REFUSED 5 / 500 1; r9: PASS 1 /
  REFUSED 16 / 500 1 (libExportNs: `auth is not defined` at bundle load — fails closed).
- GATES on the merged tip: pre-commit hook 34674 pass / 0 fail; compiler/tests/*.test.js 2239 / 0; types:check OK
  (180, unchanged); facts / state / spec-index / bootstrap-conformance / gen-md-shim --check current;
  corpus-compile-floor PASS; host-global-scan exit 0; lint-no-default-arm (bun) 0 violations; browser-baseline
  --check PASS (48 asserted; a first run under the concurrent pre-push suite timed out, the quiet rerun passed); commands+lsp
  763 / 3 skip / 1 fail — dev-watcher-snapshot-identity (ctime), ALSO FAILS on an origin/main archive on this
  machine (pre-existing, environmental); self-host-v2 2272 / 8 fail — the S440 spread-write all-or-nothing tests
  in slice-m2/front.test.js, pass alone, fail in the combined run, IDENTICAL 8 on an origin/main 179f9b346
  archive (pre-existing, order-dependent).
- F4 NOTE (not implemented here, per bryan's S467 ruling — separate dispatch once the SPEC text lands): the escape
  judge already refuses every async function value that leaves a binding by a route the compiler cannot await
  (alias, ternary / `||` / `&&` / `??` arm, returned function, later `let`/tilde write) — `fileScopeAsyncEscapesOf`
  in codegen/file-async-fns.ts, reported once per binding from codegen/index.ts. What it does NOT refuse is the
  direct `const f = (…) => …` / `const f = async (…) => …` binding itself: that is still COLOURED (pseudo fn in the
  fixpoint, call sites awaited). F4 = widen the same judge so a waiting function bound by anything but a
  `function` declaration is E-ASYNC-FN-ESCAPES-AS-VALUE; the classifier (fn-valued-bindings.ts) already
  identifies exactly those bindings.

## Round 10 (F4 enforcement) — branch s467-await-r10
- 2026-10-16 start at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-ae30b00096cd063da, cut from
  origin/s467-await-r9 e5155a5bb. Rule: dpa-023 F4 (SPEC §13.9.6 on PR #1430; ruling:user-voice-scrml.md S467
  "b it is" + "yes on the impl#1 enforce F4") — an async-colored function is bound ONLY by a `function`
  declaration; every binding / later write whose value is or may be one is E-ASYNC-FN-ESCAPES-AS-VALUE.
- IMPL: codegen/fn-valued-bindings.ts `waitingBindingsOf` (every const/let/lin/tilde decl, every value
  export, every `=`/`||=`/`&&=`/`??=` write, block-nested tilde re-declarations, an export whose init the
  builder split into the next statement) judged by `mayHoldWaitingFn` (tree: a function value whose body
  references an async name at ANY position of the init; an async name used other than as a direct callee;
  escape hatches re-parsed as ESTree by the same rules; unparsed text by a fail-closed text rule). Legal:
  direct calls (data), combinator callbacks (searched for a returned function), scheduler args, `typeof`,
  sync lambdas, parameter shadows. Text-only refusals are `cascadeOnly` (a precise error for the same
  unreadable text is not displaced; the compile fails either way). file-async-fns.ts `waitingBindingsOfFile`
  (+ namespace imports of scrml modules count as async; caller-context-propagated SYNC helpers do not — the
  §12.2 #284 first-class reference, conformance server-db/first-class-fn-ref-server-helper-rt). Reported
  once per binding from codegen/index.ts with the binding name and the `function name(…) { return … }` fix.
  Round 9's escape judge (`escapingAsyncValuesOf` / `fileScopeAsyncEscapesOf`) removed; the pseudo-fn
  colouring KEPT with a comment (dead for shipped output; six emitters still read it on a failing compile).
- COMMIT fd8a1be4f (hook passed: 34888 tests). Fixtures flipped to E-ASYNC-FN-ESCAPES-AS-VALUE, each
  kept with a `function`-declared migrated twin that runs: s465-await-r6 (12 HIGH-1 shapes → F4_REFUSED;
  7 migrated; client H1 split refuse/migrated; shadow probe migrated), r7 (MED-D asyncArrowStrArrow; MED-C
  cl2/cl3/w(2) → refused + migrated, executed), r8 (all 9 → REFUSED; 7 migrated; ss1 test on the
  `function` form), r9 (p3 paren arrow → refused; MED-1 probes rewritten value-only), s440 (arrow-bound
  helper: + the F4 code beside the sync-callback code), peer-call dispatch (+2 binding refusals). New
  compiler/tests/integration/s467-await-r10.test.js (35). Pack + y1/y2/y3 (551; README / count / known-fail
  note). Not migrated: r6 inFileInSomeCallback — `function w` used only inside a `.some` callback is not
  placed on the server (g-fn-reached-only-through-lambda-not-on-server-s466, 500 fail-closed).
- GAPS filed: g-file-scope-let-written-in-block-stale-on-server-s467 (MED-2 data form; the async form is
  now refused), g-server-js-imports-module-without-server-file-s467 (the F4 rewrite target `export
  function` + an enum/component import → unloadable bundle; pre-existing on base). Annotated:
  g-top-level-async-closure-called-later-accept-all (closed by refusal), g-imported-async-server-fn-not-
  awaited-s465.
- MERGE origin/main 22da975a8 (#1427 server param defaults, #1430 the dpa-023 SPEC incl. §13.9.6):
  emit-server onserver:* handler head (kept main's `_wsSig` signature + r8's `_wsHeadIdx` async upgrade);
  FACTS regenerated; known-gaps: count hunk regenerated, main's two new s467 entries + this branch's
  resolved g-lib-export-const-lambda heading; gap-id set == union (2109). SPEC: one carried-gaps sentence
  (§13.2 ⚑ list) made accurate — g-top-level-async-closure… is refused under §13.9.6, not coloured.
- PACK (merged tree, classify.js): 551 shapes, 0 FAIL — PASS 220 / PASS-REFUSED 315 / PASS-500 12 /
  PASS-DENY 3 / UNJUDGED 1. vs r9 tip (same 551): FAIL→REFUSED 9 (y1/voIife, y1/topLetIfWrite, y2/voIife,
  y2/voAnnotIife, y2/topLetIfLit, y3/vo2Iife, vo2IifeLit, vo2Bind, vo2Annot); PASS→REFUSED 87 and
  PASS-500→REFUSED 7 — every one binds a waiting function (list: ~/.cache/scrml-agent-tmp/s467-await-r10/
  flips.txt); PASS-DENY→REFUSED 2 (E-PARAM-DEFAULT-AWAIT, from #1427).
- CORPUS (corpus-emit-differential; base = origin/main f79a624df archive = 22da975a8 for compiler/corpus;
  head = merged tree; examples, samples, conformance/cases, stdlib, giti + flogence copies; 2951 sources):
  0 newly failing / 0 newly passing; 2 diagnostic-code changes, both already-failing conformance negatives
  gaining E-ASYNC-FN-ESCAPES-AS-VALUE beside their sync-callback code (auth-async-stdlib-sync-callback-neg,
  server-fn-in-sync-callback-pos); 165 artifact diffs + 108 text-only = absolute/relative root paths only
  (normalised: 0 real); syntax delta 0; bare server-fn call sites 36 = 36.
