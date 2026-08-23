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
- 2026-08-23 MERGE onto current main (25 behind at run time, brief said 19 — re-checked
  rather than trusted). `emit-server.ts` + `SPEC.md` auto-merged clean; only the two
  GENERATED docs conflicted, and both conflicts were verified DERIVED-ONLY before
  resolving (stripping every digit from the two SPEC-INDEX sides makes them
  byte-identical; every FACTS hunk is a count). Resolved by REGENERATING:
  `scripts/regen-spec-index.ts` + `scripts/facts.ts --write`. Commit 7c1643e9.
  Post-merge: suite 29204 pass / 0 fail; leak probe exit 0; five-sink probe exit 0.
  Divergence after merge: 0 behind / 45 ahead.

- 2026-08-23 POPULATION of the gated arm, measured on the corpus (2198 .scrml scanned):
  78 sources declare `protect=`/`tenant=`; 12 of those also declare
  `auth="optional"|"none"` and therefore reach the BASELINE-CSRF arm floor-active —
  the shape the round-9 gate moves. Both examples the review named are in the list
  (examples/23-trucking-dispatch/pages/auth/{login,register}.scrml), plus
  app.scrml, stdlib/auth/templates/login.scrml and 8 conformance cases.
  Corroborates the review's "14 baseline-CSRF-arm handlers" (handlers > files).

## DEFERRED — filed, not fixed, each with its reason

1. THE PRE-EXISTING `Response`-passthrough TWIN on the non-baseline arm
   (`emit-server.ts`, the `auth=`-bearing / non-baseline exit). Same shape as the
   BLOCKING finding and the same leak on a floor-active app; NOT introduced by this
   branch. Out of scope by explicit instruction this round. Note for whoever takes it:
   its in-source comment ("Placed BEFORE the redact deliberately") reasons about
   redaction MANGLING a `Response` and never considered that the envelope's
   destruction of it was the containment — so that comment should not be read as the
   question having been settled. The round-9 gate (`!_protectActive && !_tenantActive`)
   ports to it verbatim.

2. UPSTREAM: an unparsed region's `raw` is a LOSSY TOKEN RE-JOIN that destroys `?{`
   adjacency on the `!{}`-arm path. This is the ROOT CAUSE of Finding 2's false
   positive: with adjacency preserved, `/\?\{/` becomes both sound and precise and the
   `n ? { } : { }` ternary compiles. Deferred because the owning stages (block splitter
   / ast-builder) are held by concurrent agents this round.

3. NEW RESIDUAL found while pinning Finding 1: the `JSON.stringify(<a Response>) === "{}"`
   containment is Response-IMPLEMENTATION-dependent. Under happy-dom (globally
   registered by sibling browser tests in a full-suite run) it yields
   `{"body":{},"bodyUsed":false,...,"status":200,...}`. Both implementations measured
   keep the BODY opaque, so the floor holds on both — but it is a BACKSTOP, not a
   guarantee, and a `Response` whose body were an enumerable own property would leak
   through this path. The control is the §14.8.9 gate resolving these callee shapes;
   `JSON.stringify` opacity must not be relied on as the primary defence.
   (This also cost a test: an initial `expect(body).toBe("{}")` passed standalone and
   failed in the full suite. The pin now asserts the security property, not the bytes.)
