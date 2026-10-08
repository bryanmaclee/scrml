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
