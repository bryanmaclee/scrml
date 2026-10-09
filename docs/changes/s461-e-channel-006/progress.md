# progress — s461-e-channel-006
- 2026-10-09T18:04:57Z WIP(s461-e-channel-006): start at /home/user/scrml/.claude/worktrees/agent-a0fbb1056f00a75b9 (base origin/main 078caf8)
- 2026-10-09T18:09:23Z Phase 2: E-CHANNEL-006 check in type-system.ts checkClientHandlerNotServer (beside checkChannelHandlerBindings); imported decls threaded runTS->processFile->annotateNodes. Repros a(channel-body server function) b(top-level server fn) c(imported) i(re-exported) j(exported channel module) fire; d(onserver server fn) e(plain fn) clean.

## Governing sentence (SPEC.md §38.10.3, re-read at :28391)
> **E-CHANNEL-006:** A function designated as the handler for an `onclient:*` attribute SHALL NOT be declared `server function`. The compiler SHALL emit E-CHANNEL-006 and reject the program.

§34 row (:26141): `| E-CHANNEL-006 | §38.9 | \`onclient:*\` handler function declared as \`server function\` | Error |`; §38.9 table row :28293. Direction: newly-rejecting. No SPEC text edited; no new code.

- 2026-10-09T18:25:02Z Phase 2b: unit tests (11 pass) + conformance cases handler-onclient-server-fn{,-toplevel,-imported,-ok}; conformance/run.ts 1518 pass + 65 xfail / 1583, 0 FAIL. FACTS.md + bootstrap-conformance.md regenerated (stale only from the 4 new cases/1 new test file). types:check OK (184, unchanged). spec-index --check OK.
- 2026-10-09T18:25:02Z Phase 3: measuring 3356 .scrml (samples/ examples/ conformance/cases/ stdlib/ docs/) base (git archive origin/main compiler+stdlib, outside repo) vs head, in-process compileScrml write:false, sha256 over outputs+runtime.
