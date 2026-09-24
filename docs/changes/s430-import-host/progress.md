# progress — s430-import-host
- 2026-09-23 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0d0b326ea9a3a0a9; base 15e60e4b; install+pretest OK
- 2026-09-23 repro confirmed on base (both parsers): `import:host {…}` at file top -> page text in <body>, E-SCOPE-001 on the use site only.
- 2026-09-23 7aac6fca compiler/src/host-import.js — manifest reader (Bun.TOML, nearest scrml.toml up to a .git boundary), post-parse gate (E-IMPORT-003/008/009), host-module scan (Bun.Transpiler.scan, never evaluated).
- 2026-09-24 cd210d50 live front-end: IMPORT_HOST_LIFT_RE lift + parseLogicBody hostTag; api.js MANIFEST stage before BS + gate after TAB; emit-library tag strip; rewriteRelativeImportPaths re-bases .ts/.mts/.mjs + tolerates trailing blanks.
- 2026-09-24 e8d3773a module-resolver: host-module record -> E-IMPORT-006 / E-IMPORT-004; host edges in E-IMPORT-002 DFS.
- 2026-09-24 620a7f2a native parser: parseImport `import:` branch (+ .scrml mirror), lift, hostTag carried in translate-stmt + collect-hoisted.
- 2026-09-24 307708df tests: compiler/tests/integration/import-host.test.js (34, both parsers, e2e runs under bun) + 4 conformance codes-half cases.
- 2026-09-24 corpus A/B (scripts/corpus-emit-differential.ts, base 15e60e4b vs head 307708df): 0 compile-failure delta, 0 diagnostic-code changes, 0 artifact content diffs over 1929 common sources. (1244 "text-only" = the `<OUT>` path normalization missing because the head work dir sat inside the head compiler root — measurement artefact.) 3 new syntax-failing artifacts = the new reject conformance cases' client.js (a failed compile's emitted classic script carrying an `import`).
- 2026-09-24 full `bun run test`: head 32518 pass / 59 fail; base 32480 pass / 59 fail; failure SETS identical (browser/dev-server/self-host-parity, pre-existing in worktree env).
