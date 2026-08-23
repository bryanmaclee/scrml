# raw-egress-r9 — fix round (append-only)

Branch: `raw-egress-r9-work`, cut from `raw-egress-r8-work` @ 41b4dc1a1a29cd7ed09b183f82c862e5684e6ad0.
Scope: two surgical fixes from the adversarial DO-NOT-LAND review. No redesign.

- FINDING 1 (BLOCKING): `emit-server.ts:4037` `Response` passthrough emitted BEFORE `_egressRedact` in the
  baseline-CSRF arm. Remediation: gate on `!_protectActive && !_tenantActive`.
- FINDING 2 (MED): `protect-egress.ts:501` `ESCAPE_HATCH_SQL_RE = /\?\s*\{/` is a text test on source;
  a ternary with object-literal branches spells `? {`. Rule 7 violation. Remediation: structural route.

## Log

- 2026-08-23 start. worktree=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae306b9274202cb14 HEAD=41b4dc1a1a29cd7ed09b183f82c862e5684e6ad0
- 2026-08-23 FINDING 1 (BLOCKING) CLOSED — commit 5049964a.
  - Locus HELD: emit-server.ts:4037, added by branch commit f60ccdb9 (its ONLY code change).
  - REFINEMENT to the brief's reachability claim: `protectProgram`-style fixtures do NOT
    reach the baseline-CSRF arm. A protect-active file is AUTO-ESCALATED to auth="required"
    (route-inference.ts:6073), which sets `authMiddlewareEntry` and forces the NON-baseline
    arm. The two co-occur only when the file carries an explicit `auth="optional"`/`"none"` —
    which is the login-page shape, confirmed on examples/23-trucking-dispatch/pages/auth/login.scrml
    (`<page auth="optional">` + `<db protect="password_hash">`). First reproducer attempt
    measured the WRONG (pre-existing) arm; the anti-vacuity test now pins the arm.
  - Leak reproduced BY EXECUTION at the tip: 200 {"id":1,...,"passwordHash":"$argon2id$SECRET"}.
    After gate: 200 {} — no protected column. Bite proof both directions, exit codes direct:
    gate present -> probe exit 0; gate removed -> probe exit 1 + round-9 tests 3 pass/1 fail.
  - The 2 dependent tests in authed-server-fn-response-http.test.js ARE non-protect shapes
    (`<db src="./items.db" tables="items">`), so the GATED form keeps them green (deletion
    would not have). Brief's prediction HELD.
  - Compensating-control claim VERIFIED not assumed: a RESOLVABLE manual Response on a
    protect-active app is refused loudly with E-PROTECT-004.
  - NEW RESIDUAL discovered: the `JSON.stringify(<a Response>) === "{}"` containment is
    Response-IMPLEMENTATION-dependent. Under happy-dom (full-suite global pollution) it
    yields `{"body":{},...,"status":200,...}`. Body stays opaque on both impls so the floor
    holds, but this is a backstop, not a guarantee. Recorded in the test.
  - TESTS_BEFORE 28996 pass/0 fail/86 skip/1 todo -> TESTS_AFTER 29000 pass/0 fail (+4 new).
