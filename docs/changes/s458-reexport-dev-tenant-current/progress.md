# progress — s458-reexport-dev-tenant-current

- [2026-10-07] start. `git rev-parse worktree-agent-a32af25e7d4658f1a` = 700cb88aae9c… (confirmed). `git reset --hard 700cb88aa`,
  `git merge origin/main` (origin/main = 46ed1f8ff) -> merge commit 70585eeb0. NO textual conflicts: git auto-merged all seven
  files both sides touched (compiler/SPEC.md, src/api.js, codegen/emit-client.ts, codegen/emit-server.ts, codegen/index.ts,
  commands/build.js, commands/dev.js). Auto-merge is not proof of semantic merge — each reviewed below.
  BRIEF commit 41d39ecce. bun install + pretest OK (34 dist files).
- [2026-10-07] Main commits since 0d8e9d8ce touching build.js / tenant-startup-check.ts / dev.js
  (`git log 0d8e9d8ce..origin/main -- …`): ONLY 125486345 (#1348 §2.2.1). tenant-startup-check.ts: main did not touch it
  (`git diff --stat 0d8e9d8ce origin/main -- compiler/src/codegen/tenant-startup-check.ts` empty), so no main tenant check
  needs carrying into the relocated text. How #1348 survives, checked by reading the merged hunks:
  - build.js: #1348 rewrote `beforeWrite` (only E-MW-007 onion refusal decided there; `!result.artifactsWritten` drives the
    no-files line). The branch's hunk is ~800 lines earlier (generateServerEntry gate text -> `tenantGateEntryLines`).
    Merged file carries both, untouched by each other (`git diff 46ed1f8ff HEAD -- compiler/src/commands/build.js` shows only
    the branch's import + gate-text hunk).
  - dev.js: #1348 removed the `beforeWrite: hasApplicationScopeRefusal` callback + its import (compileScrml now refuses the
    write on any Error). Merged file: callback still absent, import still absent; branch's additions (gate import,
    registeredTenantGate, devTenantGateResponse, loadServerRoutes collect, fetch gate after compileFailure) present.
  - api.js: #1348's pre-write decision (hasFatalBeforeWrite / writeEligible / artifactsWritten) and #1346's
    scrubPlaceholderTokenDeep run around the branch's emitValueOnly fixpoint + reconcileServerReExports, which only
    rewrite in-memory `output.serverJs` before the pre-write decision and before the emit gate — so the gate and the
    no-write decision see the reconciled text.
  - emit-client.ts / emit-server.ts / index.ts: main's hunks (#1341 urlguard chunk gates, #1347 url-shape helper,
    #1344 program-body SQL policy set/reset/drain) are disjoint from the branch's re-export hunks.
- [2026-10-07] `bun run types:check` on the merge: 1 NEW — emit-client.ts TS7016 for '../module-resolver.js' (the branch's
  new import). Same diagnostic is already baselined for 7 other importers of module-resolver.js (no .d.ts exists).
  Recorded with `bun scripts/types-gate.ts --write` (186/119) rather than authoring a module-resolver.d.ts (that would
  re-key all 8 importers — out of scope for a currency merge; surfaced for the PA).
- [2026-10-07] Branch tests on merged tree: s457-reexport-scrml-module, s457-reexport-resolution,
  s457-dev-tenant-startup-check, dev-db-no-side-file, imported-enum-match-binding — 119 pass / 0 fail.
- [2026-10-07] regen of SPEC-INDEX / FACTS (`regen-spec-index.ts`, `facts.ts --write`) was DENIED by the harness
  permission classifier ("Modify Shared Resources"); not run, files untouched (main's versions as merged). Left for the PA.
- [2026-10-07] Gates on f284a456b: pre-commit core suite 32161 pass / 58 skip / 12 todo / 0 fail (32231 tests, 1486 files);
  `bun conformance/run.ts` 1346/1396 pass + 50 xfail, 0 FAIL; CI gauntlet step (todomvc compile + node --check) OK;
  `bun scripts/browser-baseline.ts --check` PASS (48 asserted, 0 of 2 env-excluded observed); types:check OK 186/119.
- [2026-10-07] EMPIRICAL A (.tmp/empA, `scrml build src -o dist`, `PORT=37581 bun dist/_server.js`, page driven in
  happy-dom with scripts fetched from the live server, .tmp/drive.mjs):
  c.scrml: `export type Color:enum`, `export const Card = <div class="card">…`, `export server fn w()`.
  b.scrml: `export { w as helper, Card, Color } from "./c.scrml"`; b2.scrml: `export * from "./c.scrml"`.
  FIRST BUILD (Card + Color + server fn all imported through b / b2) FAILED on the merged tree:
    app.scrml:21 E-COMPONENT-020 `Card` is not defined (+ VP-2 E-COMPONENT-035) — a component re-exported through an
      intermediate module does not expand (CE). star.scrml: same E-COMPONENT-020, and star.scrml:9 E-TYPE-025
      "Cannot match on asIs-typed subject" — an enum reached through `export *` is untyped in TS, so `match` refuses.
  Same project on origin/main's compiler (git-archived to .tmp/maincomp): app E-COMPONENT-020/035 identical (pre-existing);
    star E-IMPORT-004 ×3 (w/Card/Color "not exported by ./b2.scrml") + the same E-COMPONENT-020/E-TYPE-025.
  So the branch closes: server link + client registry + page script order for named and star re-exports; named enum
  `match`. It does NOT close: (i) component through a re-export (CE), (ii) enum `match` through `export *` (TS).
  SECOND BUILD (Card imported straight from c; star's label without `match`): builds, 3 routes, run:
    health 200; app.html 200 initial out="" lab="is-red" card="card-from-c" -> click srv + flip -> out="from-c|app"
    lab="is-green"; star.html 200 -> out="from-c|star" lab="is-Green"; 0 page errors.
    b.server.js `export { w as helper } from "./c.server.js";` b2.server.js `export { w } from "./c.server.js";`
    page scripts: runtime, c.client, b.client, app.client.
