# Progress: fix-lift-async-iife-paren

- [start] Worktree on main, clean. Baseline `bun test`: 11463 pass / 0 fail.
- [bug-trace] Reproduced bug: compile examples/18-state-authority.scrml; client.js line 159 has `await ((async () => ...)();)` — invalid `;)` token.
- [bug-trace] Traced to compiler/src/codegen/emit-client.ts:892-897 GITI-001 post-emit rewrite. Always appends trailing `;` to its IIFE wrap regardless of statement-vs-expression context. When the rewritten target appears inside `el.textContent = await (...)` at emit-event-wiring.ts:826/854/855, the `;` becomes invalid.
- [decision] Surgical fix: detect whether the source had a trailing `;` (statement context) and emit the IIFE wrap with `;` only in that case. Expression context emits the wrap without `;`.
- [fix] Edit compiler/src/codegen/emit-client.ts:892-897 — added `hadTrailingSemi` capture + conditional `;` emission.
- [verify] Recompile 18-state-authority.scrml → client.js parses cleanly (PASS). Wrap at line 159 now reads `await ((async () => ...)())`. Statement-context wrap at line 78 still reads `(async () => ...)();` (preserved).
- [test] Extended compiler/tests/unit/request-tag-and-server-fn-reactive.test.js with §6 (5 new test cases). Fixture: `<program db=> ${ server function ... ; <var server> = 0; on mount { @var = serverFn() } } <div><p>${@var}</p></div>`. This minimally reproduces the bug path.
- [test] Reverted fix to confirm test catches bug: 3 of 5 new tests FAIL (parse, no `;)`, well-formed wrap). Re-applied fix: all 11 pass.
- [test] Full suite: 11468 pass / 0 fail (+5 from new test cases, matches expectation).
- [verify] Recompile all 21 examples. Example client.js parse pass: 16/21 (up from 15/21). 18-state-authority now passes. Other 5 failures (admin-dashboard, multi-step-form, navigation, worker, snippets-slots) are pre-existing unrelated bugs.
- [verify] Corpus scan for malformed `)();)` pattern: zero occurrences.
- [verify] Pretest: 12 test samples compiled clean.
- [commit] Pending.

## Tags
#tag-pipeline-progress #tag-s84 #tag-fix-lift-async-iife-paren

## Links
- FIX SITE: /home/bryan/scrmlMaster/scrmlTS/compiler/src/codegen/emit-client.ts:892-905
- TEST FILE: /home/bryan/scrmlMaster/scrmlTS/compiler/tests/unit/request-tag-and-server-fn-reactive.test.js (added §6, lines ~220-285)
- EXAMPLE FIXED: /home/bryan/scrmlMaster/scrmlTS/examples/18-state-authority.scrml
