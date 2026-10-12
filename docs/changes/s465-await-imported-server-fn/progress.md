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
