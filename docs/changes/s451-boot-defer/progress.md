# s451-boot-defer — progress

## 2026-10-03 start
- Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac7244e168995f44b, base b490f3b75 (== origin/main).
- Baseline: bootstrap-conformance PASS 42 · CODES-ONLY 0 · FAIL 18 · LEGACY 951 · UNSUPPORTED 277 · CRASH 0 (1288 cases).
- Baseline slice suites: m1 99/0 · m2 462/0 · m1-lowered 99/0 · m3 60/0 · m4 551/0 · codec 92/0 · lexer 337/0.

## REPRODUCED on main (b490f3b75)
Source: `function go() { defer { @log = @log + "d" } @log = @log + "b" }` in a §66 program.
- Diags: E-PARSE-OBJECT, E-PARSE-EXPECTED, **E-SCOPE-001 `defer` is not declared**, E-ASSIGN-POSITION, E-TYPE-STRUCT-CONTEXT
  (`defer` read as an identifier followed by an object literal).
- `printProgram(r.core, …)` still returned a JS artifact (the `go()` function with `@log + "b"`).
- Defect (1) confirmed for ANY error: nothing between `analyze`'s diagnostics and `printProgram` — `lower` returns a
  Core unconditionally (`{ core, diags: tp.diags }`) and the printer takes any Core.
- All 47 defer/* conformance cases are LEGACY-bucket (the `rhs-decl` §66.21 marker) — the counter cannot move on them.

## (1) THE DIAGNOSTICS GATE — governing sentences (searched §2, §34, §40, + impl#1 refusal-gate.js)
- NO general SPEC SHALL "a compile with any error writes no artifact" was found. What exists:
  - §2.2.1: "A successful compile (exit 0) guarantees that every emitted JavaScript artifact … is at least
    syntactically valid JavaScript." (defines success; does not forbid artifacts on failure)
  - §6 (line ~3795) E-REACTIVE-005: "E-REACTIVE-005 SHALL block code generation. A file with a circular derived
    dependency SHALL NOT produce compiled output."
  - §15.14.2 E-COMPONENT-035: "The compilation SHALL NOT produce code outputs when this error fires."
  - §34 (§34.1 intro): severity is "carried by the `E-` prefix per the §34 diagnostic-stream convention";
    W-/I- partition into `result.warnings` (non-fatal).
  - impl#1 `compiler/src/commands/refusal-gate.js`: "NARROW SCOPE: only these codes refuse the write. Every other
    hard error keeps the pre-existing posture (artifacts land, exit 1); widening it is an open ruling."
    §34 E-CG-TILDE-UNRESOLVED row: impl#1 "exits non-zero … and the emitted artifacts are still written to disk".
- Reading: the bootstrap has no CLI / exit status / dist. Its only "artifact" is `printProgram`'s output, and nothing
  told a caller the compile had failed except a diags list the caller could ignore. Under the bootstrap's own
  fail-closed refusal policy (brief; analyze.scrml `structuralOwner`) the gate is implemented as a bootstrap
  POLICY, not as a claimed SPEC rule. FORK for PA/bryan: impl#1's posture (artifacts land, exit 1) vs the bootstrap's
  (no Core, nothing to print) diverge only for programs that already fail to compile; no conformance case
  pairs an expected E- code with a runtime half (measured: 0 of 1288), so tier-1 cannot observe it.
- Did the gate exist? NO — reproduced: `lower` returned `{ core, diags }` unconditionally; `printProgram` printed it.
- Implemented: lower.scrml `hasError(tp)` (any `E-` diag OR any parse error span in a FileAst) → `Lowered.core = not`.
  One check at the front-end → back-end hand-off; the printer takes only a Core, so no artifact is reachable.
- Measured: bootstrap-conformance 0 cases changed (PASS 42 · FAIL 18 · LEGACY 951 · UNSUPPORTED 277).
  Slice suites: 1 test changed (m4 failclosed "nothing of it reaches Core" — now asserts no Core at all).
  New: slice-m4/diag-gate.test.js (4 closed shapes + 2 twins).
