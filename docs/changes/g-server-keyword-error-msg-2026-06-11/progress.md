# progress — g-server-keyword-error-msg (S181)

Reword compiler user-facing strings that still TEACH the deprecated `server function` form.
Canon: the `server` modifier is deprecated; the server boundary is INFERRED (§12.2 Triggers).
NO codegen change. Canon-consistency polish only.

## 2026-06-11 — startup
- worktree verified: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a7a4c78e181b0eedf
- git rev-parse --show-toplevel == worktree; tree clean post `git merge main` (Already up to date, base b81fe03f)
- bun install OK (204 pkgs); bun run pretest OK (dist populated)
- maps: read .claude/maps/primary.map.md in full; task-shape = compiler-source string + spec-text edit
- grepped `server function` in compiler/src (~71 mentions, mostly comments) + compiler/SPEC.md

## 2026-06-11 — compiler/src reword (committed 480815ef)
Reworded user-facing diagnostic/lint/fix-hint strings that TEACHED the eliminated form:
- type-system.ts:8502 W-AUTH-001  'assign from a server function' -> 'a server-side function'
- type-system.ts:8533 E-AUTH-002  'via `server function`' -> 'in a server-side function'
- type-system.ts:17874 E-FN-004   'from a `function` or `server function`' -> 'from a `function` (boundary inferred per §12.2)'
- lint-ghost-patterns.js:897 W-LINT-019  Solid-resource '${ server function fetch() }' -> '${ function fetch() }'
- codegen/scheduling.ts x3 + codegen/emit-functions.ts x2 E-CG-006  'Move it to a server function' -> 'a server-side function'
LEFT (descriptive noun phrase / deprecation-context, match SPEC canon, do NOT teach the form):
- type-system.ts:3821 E-ROUTE-003 ("a server function's return value crosses the network boundary")
- emit-test.ts:101 E-TEST-006 / symbol-table.ts:9742 + ast-builder.js:11263/11336 E-TEST-005 (noun phrase; `server fn` preserved)
- route-inference.ts:3202 (inside the W-DEPRECATED-SERVER-MODIFIER message itself)
- route-splitter.ts:729 W-CG-CHUNK-EMPTY / build.js:662 W-DEPLOY-001 (plural artifact-kind noun)
- commands/migrate.js 2362/2366/2386/2388/2863 (the deprecation tooling strings — describe migrating FROM the form)
- emit-logic.ts:1622/1728 (EMITTED-JS comments — brief says NO codegen change; left)

## 2026-06-11 — SPEC.md error-output depictions
- ~3297 saveOrder (E-REACTIVE-003 depicted output): 'server function saveOrder' -> 'function saveOrder'
- ~14022 getUser (E-SCOPE-012 depicted output): 'Add the `server` annotation: `server function getUser()`' -> server-escalation-by-inference guidance (§12.2)
- ~28689 logEdit (E-AUTH-001 depicted output): 'pass it to a server function first' + 'server function logEdit' -> 'a server-side function' + 'function logEdit'
NOT TOUCHED (out of brief's named scope): §20.5 example INPUT blocks 13968 (`server function getProfile`) + 14006 (`server function checkAuth`) still depict the form in "Syntax developer writes"/"worked example valid" blocks — surfaced as DEFERRED (example-input, not error-output depictions).

## 2026-06-11 — test
- NEW compiler/tests/unit/server-keyword-error-msg-canon.test.js (3 tests, cross-stream collector):
  W-AUTH-001 + E-FN-004 via compileScrml; W-LINT-019 via lintGhostPatterns direct entry. All green.
