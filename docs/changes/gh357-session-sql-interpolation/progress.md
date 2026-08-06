# gh357-session-sql-interpolation — progress log (append-only)

Worktree: C:/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/gh357
Branch: fix/gh357-session-sql-interpolation (off main @ d8044cf2)

## 2026-08-05 — startup
- Confirmed toplevel == worktree root, clean status, branch correct.
- `bun install` (with PUPPETEER_SKIP_DOWNLOAD=true — Windows puppeteer postinstall fails otherwise, matches CI windows-job) OK.
- `bun run pretest` OK (populated samples/compilation-tests/dist/).
- Read BRIEF (+ dpa-021 revision header, which GOVERNS), dpa-021 artifact, primary.map.md.

## Root cause — HELD (verified by execution + emitted artifact)
- Reproducer compiled on pre-fix baseline: ordinary `session.isAuth` lowers to
  `_scrml_req._scrml_sess.isAuth` (AST member), but bare `session.userId` inside a `?{}` SQL
  interpolation survives as a free variable.
- Execution harness (real handler, seeded session store + csrf/sid cookies, seeded sqlite):
  PRE-FIX => `THROWN: ReferenceError: session is not defined`.
- Blast-radius probe pre-fix (one `?{}`, four ambients):
  `@currentUser.id`->`_scrml_currentUser.id`; `@uid`->`_scrml_body["uid"]`;
  `route.query.id`->`route.query.id`; `session.userId`->`session.userId` (BARE — the bug).

## _scrml_sess object shape (read at emit-server.ts:2419-2454)
- getters: userId/role/isAuth; methods: set(k,v)/get(k)/destroy(); RAW props: sid,_rec,_changes,_dirty,_destroy,_reset.
- `.get(k)` reads inner `_rec[k] ?? null`. A RAW bind would make `session[k]` read raw props
  (sid,_rec incl csrfToken) and `session[customKey]` read undefined — confirming the dpa-021
  confidentiality hazard. => Proxy binding required.

## Fix implemented (all in compiler/src/codegen/emit-server.ts) — commit 47a73ad4
1. `astSqlQueryUsesSession` (+ `_SESSION_BARE_TEXT_RE`), OR'd into `_anySessionBuiltin` (detection).
2. `_scrml_session_bind(_s)` Proxy helper emitted in the `if (_anySessionBuiltin)` infra block.
3. Prologue SPLICE `const session = _scrml_session_bind(_scrml_req._scrml_sess);` (mirrors @currentUser splice).
4. KEEP AST lowering (emit-expr untouched); widened cookie-wrap decision + E-SESSION-CONTEXT scan to match bare form.
- Accessor decision: Proxy (NOT raw). AST lowering STAYS (both coexist + AGREE — custom/dynamic keys both via `.get()`).

## Verification results
1. Execution harness — PRE: `THROWN: ReferenceError: session is not defined`; POST: `status: 200 {"id":1,"email":"a@b.c"}`.
2. Blast-radius (4 ambients, one ?{}), POST-fix emitted line:
   `@currentUser.id`->`_scrml_currentUser.id`; `@uid`->`_scrml_body["uid"]`; `route.query.id`->`route.query.id`;
   `session.userId`->`session.userId` (now BOUND via prologue Proxy at handler scope). First three unchanged vs main.
3. Ordinary no-regression: `session.isAuth`->`_scrml_req._scrml_sess.isAuth`; `session["userId"]`->`.userId`;
   `session[k]`->`_scrml_req._scrml_sess.get(k)`; `session.tenantId`->`.get("tenantId")`. Confidentiality (executed,
   index in interpolation via Proxy): k=email->value, k=userId->1, k=sid->null, k=_rec->null, k=missing->null.
4. DONE-PROBE test compiler/tests/integration/gh357-session-sql-interpolation.test.js: 4 pass / 28 assertions.
5. R26 sweep: 36 sources (4 dev-r25 + 32 examples); 17 emit .server.js in both main & post-fix; 17 identical, 0 differ.
   CONFIRMED inert: ZERO of the 36 use the `session` builtin (the 2 "session" hits are prose/comments), matching
   dpa-021's "byte-identical corpus proves nothing" caveat. Sweep methodology soundness proven: repro.server.js
   DIFFERS pre vs post (so the sweep would catch a real change). Efficacy proven by the harness, not the corpus.

## @gap locus corrected (commit 8a54aa27)
- docs/known-gaps.md marker: locus rewrite.ts:387,2831 -> emit-server.ts:astSqlQueryUsesSession+_scrml_session_bind+
  session-prologue-splice(root:raw-text-at-rewrite.ts:387). Fixed the "expression children" prose (there are none —
  interpolations are strings). §20.5:15427 quoted in the fix commit body (newly-accepting-toward-the-contract).
- FACTS.md regenerated (commit for LOC change).

## S323-peter — PA adversarial pass + trimmed landing (2026-08-05)

**REGRESSION caught (fix-vs-prefix), not in the agent's report.** Full conformance on the
branch failed `CONF-SESSION-STORE-PROGRAM-UNIFY` (§20.5) — green on main, so a real regression.
Root cause (PA-reproduced single-threaded, DETERMINISTIC — not the "concurrency flake" the first
revert comment claimed): the Part-4b E-SESSION-CONTEXT scan widening string-matched a bare
`session.`/`session[` in the assembled `lines`, which also matches the compiler's OWN emitted
`// --- session.destroy() handler ---` comment and generated `if (!session.isAuth)` auth guard,
build-blocking a clean app.

**Trimmed fix = the ruled route-handler fix only** (detection + Proxy prologue binding +
cookie-wrap on the bare form). The Part-4b scan widening is REVERTED. Verified: probe ERROR
COUNT 0 · full conformance 1443 pass / 0 fail · DONE-PROBE 5 pass / 0 fail. Root-cause comment
at the scan site corrected to the deterministic reason.

**Two findings ROUTED-TO-BRYAN (language-surface, filed in docs/known-gaps.md):**
1. `g-session-get-reserved-key-read-disclosure` (HIGH) — `session[k]`, k="csrfToken" discloses the
   §40.2 token via `.get()` at HTTP 200 (PA-reproduced: `{"status":200,"leaked":"CSRFSECRET"}`).
   Pre-existing in the AST `session[expr]` path; gh357 extends it to the interpolation position.
   Read-side reserved-key guard (mirror the B5/S266 write guard) is a `semantics-changed` call.
   Encoded as an executable KNOWN-GAP regression-detector test (flip to `null` when the guard lands).
2. `g-session-context-scan-bare-form-sound` (MED) — the §6.1 non-route residual build-block needs a
   lowering-site record, not a text scan; the residual is a pre-existing silent free-var (not a regression).

**Lane:** RULED to Peter S322-bryan (language act discharged S316/S319); built + landed trimmed by S323-peter.
Integration/unit deferred to the cloud gate (authority; Windows-local baseline noise). On merge: close #357 with SHA.
