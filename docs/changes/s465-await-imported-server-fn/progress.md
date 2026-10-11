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
