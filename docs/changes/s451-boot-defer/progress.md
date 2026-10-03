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

## (2) `defer` — FULL implementation for every exit the bootstrap has (2026-10-03)
Governing sentences (SPEC §19.16, read in full, lines 18563-18933):
- §19.16.1 syntax + contextual keyword: "It opens a defer statement ONLY at statement start, and ONLY when the next
  token is on the same source line and can begin a statement — an identifier (other than the word operators
  `or`/`and`), an `@`-cell, a `?{}` block, a `{`, a `[` SEPARATED from `defer` by whitespace …, or a statement
  keyword other than `is`/`as`/`of`/`in`/`instanceof`/`else`/`from`/`extends`/`case`/`catch`/`finally`/`default`."
  (lead set mirrors impl#1 ast-builder.js `isDeferStatementLead`.)
- §19.16.1 E-DEFER-AMBIGUOUS-LEAD: "Where a binding named `defer` is in scope, a single-statement `defer` led by an
  array literal SHALL be a compile error naming both spellings".
- §19.16.2 Registration/Exit/Not-reached/Order/Evaluation time: "every deferred body registered in that block runs
  exactly once, on EVERY exit path: falling off the end of the block; `return` (after the return value has been
  evaluated …)"; "reverse registration order (LIFO)"; "evaluated in full at exit".
- §19.16.2 E-DEFER-UNSUPPORTED-SITE: "a `defer` that is the whole UNBRACED body of an `if` / `else` … SHALL be a
  compile error".
- §19.16.2 E-DEFER-LATER-SHADOW: "If the deferred body reads a name that such a later declaration (re)binds, the
  program SHALL be rejected".
- §19.16.2 host error: "every remaining one still runs, in LIFO order. After all of them have run, the FIRST host
  error raised by a deferred body propagates" (runtime.js `runDefers`).
- §19.16.3 rule 1 E-DEFER-CONTROL-FLOW ("SHALL NOT contain a `return`…"), rule 2 E-DEFER-NESTED, rule 4
  E-DEFER-OUTSIDE-FUNCTION ("`defer` SHALL appear only inside the body of a function DECLARATION").
- §19.16.4: the deferred body in a `fn` "is subject to EVERY §48.3 prohibition exactly as if it were written at each
  exit" (resolved with the function's env → E-FN-003/-004 identical; test pins it).
- §19.16.6 shape (informative): per-block stack + `try { … } finally { … }` — followed.

Exits the bootstrap does NOT have: loops/`break`/`continue`, `fail`, `?`, `yield`, CPS body-split, server functions,
failable (`!`) functions, function declarations inside a body. None has a source form the bootstrap parses (each
is a parse/scope error → no Core, by the s451 gate), so NO defer combination with them can be mis-run, and
E-DEFER-UNHANDLED-FAILABLE / -DUPLICATE-FUNCTION / -SERVER-IN-SPLIT have no parseable trigger. When any of those
constructs lands in the bootstrap, its defer interaction must land with it (noted in analyze.scrml's section head).

Files: ast.scrml (AStmtK.Defer), parse.scrml (deferAhead/parseDefer/bareDefer), analyze.scrml (resolveDefer,
deferChecks pass, tDeferEnv narrowing rule, 8 one-line match arms + 1 call), lower.scrml (Stmt.Defer), core.scrml
(Stmt.Defer), walk/check(C16)/measure/print/js.scrml (STry), slice-m1/runtime/runtime.js (runDefers).

Narrowing decision: a deferred body is typed with only the narrowings nothing can undo before the exit — `#id`
locals never rebound (no EAssignLocal); cell narrowings dropped (fail closed). Without this either a narrowed param
read in a deferred body was falsely rejected (first cut, "narrow it first" message), or a rebound local was trusted.

Measured: bootstrap-conformance buckets unchanged (all 47 defer/* cases are LEGACY — §66.21 `rhs-decl`); 7 cases'
emitted codes changed (now carry E-DEFER-AMBIGUOUS-LEAD / -LATER-SHADOW / -NESTED / -UNSUPPORTED-SITE in place of
E-SCOPE-001/E-PARSE-* debris). defer/scope-redeclare-with-defer-neg now emits E-DEFER-LATER-SHADOW alongside
E-SCOPE-REDECLARE — impl#1 emits the same pair (verified: `scrml compile` → E-DEFER-LATER-SHADOW, E-SCOPE-REDECLARE).
Slice suites: m4 582/0 (+25 defer.test.js, +6 diag-gate.test.js), all others unchanged.
