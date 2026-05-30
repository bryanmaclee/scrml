# Progress: library-mode-suppress-body-escalated-server-js-2026-05-30

User-ratified (S145): in `--mode library`, a function escalated to server PURELY
by body content (escalationReasons all `kind:"server-only-resource"`, no explicit
`route=`) SHALL emit as a plain server-side export — NO `.server.js` HTTP-handler
wrapper. Explicit `export server function` / explicit `route=` RETAINS the wrapper.
App (browser) mode unchanged.

## Startup baseline
- WORKTREE_ROOT verified == show-toplevel; status clean; bun install + pretest OK.
- `bun run test` baseline: 22262 pass / 223 skip / 1 todo. Known parallel-load flakes:
  self-compilation.test.js (2 bootstrap tests) + trucking-dispatch determinism.
  Confirmed self-compilation PASSES in isolation (22 pass / 0 fail) -> flake, not regression.

## Empirical pre-change findings
- GITI-024 (plain `export function` + `scrml:fs`) compiles in library mode:
  library `.js` emits CLEAN `export function readLines` (NO E-CG-006);
  `.server.js` emits full HTTP-handler wrapper (CSRF + _scrml_body + Response).
  -> IN SCOPE for suppression.
- Compound case (`scrml:fs` import + inline `?{}` inside fn body): library `.js`
  emits the `?{}` sigil VERBATIM (invalid JS, separate gap) -> would NOT emit
  cleanly -> OUT OF SCOPE (must NOT suppress).
- Discrimination data: route.escalationReasons (kinds: server-only-resource /
  explicit-annotation / protected-field-access) + route.explicitRoute/explicitMethod
  on FunctionRoute (route-inference.ts:232-242).

## SPEC line anchors (verified current HEAD)
- §12 ends before line 6973; §12.6 inserted before the `---` at 6971.
- §12.3 Generated Infrastructure: 6887. §13.4 Server Function Composition: 7019.
- §21.5 Pure-Type Files: 13896 ("sole output" L13903; "not pages" L13904-5).
- §44.7.1 staged lifecycle: 21141 (server route generation staged, L21161-2).

## Plan
1. SPEC §12.6 + §21.5 cross-ref (normative SHALL/SHALL-NOT).
2. Codegen: thread `mode` to generateServerJs; per-fn discrimination in emit-server.ts.
3. Regression tests covering (a) GITI-024 suppress, (b) explicit retain, (c) browser retain.

## Log
- [start] branch + progress + maps + baselines + empirical probes complete.

## Implementation complete
- [codegen] emit-server.ts: added `isBodyOnlyEscalation(route, fnNode)` helper +
  trailing optional `modeLegacy` param + `effectiveMode` resolution
  (ctx.mode ?? modeLegacy ?? "browser") + per-fn library-mode skip. Imported
  `isServerOnlyNode` from collect.ts for the scope guard. Commit 9d5250b6.
- [codegen] index.ts: threaded live `mode` into the one production
  generateServerJs call. Commit 9d5250b6.
- [SPEC] §12.6 "Library-mode Emission" inserted before §13 (SPEC line ~6971);
  §21.5 cross-ref bullet added. Commit a9876063.
- [test] integration/library-mode-suppress-body-escalated-server-js.test.js —
  4 tests (a/b/c1/c2), all pass. Commit 98162e35.

## E-CG-006 scope-guard — empirical confirmation
- GITI-024 (fs import only): library .js emits CLEAN `export function`; suppress OK.
- Compound (fs import + inline `?{}` in body): library .js emits `?{}` VERBATIM
  (invalid JS); `isServerOnlyNode` body scan returns true → NOT suppressed →
  current behavior preserved (out of scope). Gate confirmed correct.

## Acceptance (empirical, R26)
- (a) GITI-024 library compile: NO .server.js; plain `export function readLines`
  in library .js; exit 0; `node --check --input-type=module` clean on both
  emitted artifacts. PASS. (Side benefit: the GITI-024 E-CODEGEN-INVALID-JS
  symptom disappears — the buggy server handler is no longer emitted.)
- (b) explicit `export server function` library compile: .server.js RETAINED
  (handler present). PASS.
- (c) browser-mode server fn (SQL-body c1 + explicit c2): .server.js STILL
  emitted; handler present. No app-mode regression. PASS.

## Regression gate
- Baseline: 22262 pass / 223 skip; 3-5 flaky fails (self-compilation bootstrap
  x2 + trucking-dispatch determinism) — pass in isolation.
- Post-change: 22267 pass (+4 new tests) / 223 skip; 3 fail — SAME flakes,
  confirmed pass in isolation (self-compilation 22/0; trucking-dispatch 13/0).
  0 regressions.

## Deferred / out of scope
- Library-mode CLIENT `.js` emitting `export server function` verbatim (invalid
  JS) — PA filing separately; tests use validateEmit:false to sidestep.
- W5a/W5b pure-fn-library staged lifecycle (top-level `?{}` under-emission).

- [done] all commits landed; status clean.
