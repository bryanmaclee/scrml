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
- 2026-08-23 FINDING 2 (MED) CLOSED — commit d12ea36a. SCOPE CORRECTION: the brief's
  remediation was measured and REJECTED as unsound.
  - Locus HELD: protect-egress.ts ESCAPE_HATCH_SQL_RE, consumed in escapeHatchSurface,
    fired at the escape-hatch truncation arm. False positive REPRODUCED verbatim: a
    protect-active file with `for (let i = 0; i < n ? { } : { }; i++)` raised E-PROTECT-004
    saying "a `?{}` inside it cannot be resolved" with no `?{}` in the file.
  - THE PROPOSED FIX (narrow to the structural/adjacent form) FAILS OPEN. Every premise of
    the adjacency argument is TRUE (tokenizer.ts x2, block-splitter.js x1 all require
    `?` immediately followed by `{`, and the splitter's next branch takes a bare `?` as a
    ternary) but the conclusion does not follow: the predicate sees an escape-hatch `raw`,
    which on the `!{}`-arm path is a LOSSY TOKEN RE-JOIN. Dumped:
      for-header : "( let i = 0 ; i < ?{"              adjacency SURVIVES
      !{} arm    : "...let u = ? { `SELECT * FROM users...` } . get ( )"  adjacency DESTROYED
    Narrowed, the branch's OWN pin "FIRES — a protected `?{}` hidden inside an `!{}` arm
    fails the body CLOSED" goes silent. Caught by the full suite.
  - Backtick discriminator also unsound: SPEC §44 defines the `?{...}` body as a
    JS-EXPRESSION context; `tokenizeSQL` has an explicit non-backtick fallback.
  - RULE 7 satisfied by MEASUREMENT: substituting `couldHoldSql: false` sends a REAL
    protected `?{}` in a for-header + manual Response completely SILENT (no E-PROTECT-004,
    no I-PROTECT-STRIP-001) while the same query in an ordinary binding still fires via the
    tree's co-occurrence arm. An escape-hatch has no tree BY CONSTRUCTION and its `?{}` is
    not extracted as a `sql` node anywhere the walk reaches. No better oracle exists.
  - SO: predicate unchanged (soundness of a confidentiality floor is non-negotiable); the
    MESSAGE is fixed. It now states what is KNOWN (no tree form) vs what could not be
    RULED OUT (a `?{}`), leads with the always-applicable remedy, keeps SPEC's `?{}` remedy
    conditionally, and discloses the over-approximation.
  - DIRECTION OF CHANGE: no program's accept/reject verdict moves. Message text only.
    GOVERNING SPEC SENTENCE FOUND — SPEC.md:19367 (§34, E-PROTECT-004 row):
      "an expression the parser could not represent as a tree, i.e. an `escape-hatch`
       whose source text COULD HOLD a `?{}` (move the `?{}` out of that expression, or
       rewrite it into a parseable form)."
    "could hold" is exactly the modality the new message uses and the old one overstated.
    No SPEC amendment needed; no ruling handed back.
  - 7 new tests incl. a direct regex-level pin that `/\?\s*\{/` matches the arm re-join and
    `/\?\{/` does not, so a future narrowing goes red AT the predicate with the reason.
- 2026-08-23 FIVE-SINK RE-VERIFICATION by COMPILING programs — all five closed, exit 0:
  server-fn return / handle() body / SSR seed (_{} foreign) / channel broadcast / SSE
  generator all fire E-PROTECT-004, none leaks to clientJs. (First run showed SSE not
  firing — that was MY FIXTURE, missing the §37 `route=` and wrongly `export`ed; the
  predicate is behaviourally identical to the tip so a regression was impossible.)
