# s451-boot-ue progress

- 2026-10-03T19:50:32-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aaeb2774859e7bd1a, base 58178fa6d
- 2026-10-03T20:20 Phase 1: DESIGN.md committed (Core Attempt/Fail, Expr.Sql -> Failable.FSql, codes table,
  scope-out). Baseline counter PASS 89 · FAIL 48 · UNSUPPORTED 652 · NOT-TWINNED 511. No blocking fork (the open
  readings are refused, not decided). Starting Phase 2 with core.scrml.
- 2026-10-03 f52048c03 — Phase 2 implementation: core (Failable / OkArm / ErrArm, Stmt.Attempt, Stmt.Fail, Fn.err,
  ServerFn.err, CoreProgram.sqlError; Expr.Sql removed — a query is an Attempt's FSql), walk, check (C-E1..C-E4, C16
  + Fail, write-witness / C-S1 / C-S3 follow an Attempt's FCall), parse (`!` signatures, `fail`, postfix `?`, `!{}`,
  `match`, shared arms, `transaction` refused naming U1e), analyze (built-in `Error` / `SqlError`; FnInfo.err +
  E-ERROR-011; FailCtx in Env; E-ERROR-001/002/003/004/009/010, E-TYPE-020/021/080/082, E-DEFER-CONTROL-FLOW /
  -UNHANDLED-FAILABLE for fail / ? / arms; FailFact family; every body walker recurses into arm blocks via
  exprBlocks), lower (Attempt before the statement whose whole value is handled; retag arms for `?`), print
  (`rt.failure` / `rt.failed`, `let result;` + if/else chain), runtime (Failure class, failure / failed).
- 2026-10-03 e16256108 — slice-m4/error-model.test.js (84), server.test.js U1a refusals lifted (the handled query
  lowers to an Attempt), typer.test.js §66.19 pin (-4 parse errors: `match` tokens parse). Bites: (1) analyze
  `guarded` exhaustiveness disabled → 3 RED (E-TYPE-020, E-TYPE-080 ×2); (2) check C-E2 totality disabled → the C-E2
  graft RED. Both restored.
- 2026-10-03 — bootstrap tests 1705 pass / 0 fail; counter test 35/35; lint-no-default-arm 0. Counter (live):
  PASS 89 → 97 · FAIL 48 → 65 · UNSUPPORTED 652 → 627 · NOT-TWINNED 511. No case left PASS. New PASS: defer/
  handled-failable-ok, defer/propagate-path, defer/unhandled-failable-neg, error/fail-in-failable-neg,
  error/handler-failable-guard-and-plain-reference-neg, error/handler-recovery-into-cell,
  error/propagate-in-non-failable-fn-neg, error/propagate-non-failable-callee-neg. New FAIL: 14 "severity
  unobservable" (the right code fired; the bootstrap Diag carries no §34 severity — a harness limit, 24 pre-existing
  FAILs are the same), 2 E-SCOPE-001 for `log` (no stdlib: error/handler-exhaustive-neg, handler-wildcard-escape),
  1 E-OPERATOR-OPERAND-TYPE for `"saved " + amount` (the S440 operand rule: defer/fail-path).
- 2026-10-03 S239 review fix round (review of 114e6ef80 = FIX). Red first: 9 new tests in error-model.test.js
  ("S239 review fix round"), all RED on 114e6ef80's sources, GREEN after.
  - HIGH-1: payload enum value is `{ variant, data: [positional] }` (print variantTest / variantBinds /
    variantValueJs) — no field name is ever a key beside the discriminant (`tag` / `variant` / `data` tested at
    runtime). Runtime ValidationError records keep their own `{ tag }` (runtime-internal, no Core pattern reads them).
  - HIGH-2: a function named without a call (alias, return, argument, stored) is E-BOOTSTRAP-UNSUPPORTED (a
    "function values" slice), a `!` one E-ERROR-002 (analyze resolveName, FailCtx.fnRef = the only node allowed to
    name a function: a call's callee or a handler reference). Event-handler references (`onclick=f`, `onclick={ f }`)
    were ALSO lowered as `null` (verified by execution: the handler did nothing) — now they call `f` (parameterless,
    non-failable; with parameters refused). Core has no function-value Expr; lower's `readName` NFn `missing()` is
    now unreachable behind the binder. effect.test.js / value-positions.test.js function-value tests now also see
    the refusal (asserted, then filtered).
  - MED-1: E-TYPE-023 for a second arm of one variant / a second `.Ok` (§18.8.1). LOW-1: an arm after a wildcard is
    refused (no SPEC code). LOW-2: `.V(a) :> fail E.V(a)` parses as a one-statement `fail` arm.
