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
