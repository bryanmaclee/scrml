# progress — s456-tenant-identity-substrate (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a357142e62eb0480c, base 2dd6d35d9 (== origin/main).
- Maps: .claude/maps/primary.map.md read (S455 block + Task-Shape Routing rows for the §14.8.10 tenant floor:
  `compilationTenantSet` computed ONCE at the api.js TENANT-SCHEMA stage, post-ME / pre-DG). Load-bearing:
  it named the one place where the compilation's tenant set and the expanded file ASTs (function bodies)
  coexist — the locus for Task A. s455-tenant-floor-project-set/progress.md read in full.

## Governing sentences (SPEC §14.8.10, read in full: "The tenant key" + "Declaration")

- The tenant key: "The floor CONSUMES an app-established session scalar `@currentUser.tenantId` and NEVER
  computes one. The app's login / tenant-switch code (policy) resolves the active tenant from whatever grant
  logic it likes and **pins** it: `session.set("tenantId", t)` (§20.5.1). From that moment the ambient tenant
  is a plain server-resolved scalar, exactly like `role`. The floor SHALL NOT read grant/role tables to derive
  a tenant — that would require policy knowledge, force a choice among multiple grants (a policy decision),
  and query a tenant-scoped table to bootstrap tenant-scoping (circular). … **Corollary:** the identity/grant
  substrate (`users` / `user_roles`) is NOT tenant-scoped — you would need the tenant to read the table that
  tells you the tenant (infinite regress). The tenant-scoped set is the DOMAIN tables (assets, orders,
  work-orders), never the substrate the tenant is resolved from."
- Declaration: "A table whose `<schema>` carries a `tenant_id` column IS tenant-scoped; the column's
  **presence is the declaration** (detection via the FROM-tables of `extractSelectProjection()`, the same
  extractor §14.8.9 uses). There is no per-table opt-in attribute: a forgettable declaration is isomorphic to
  the forgettable `WHERE tenant_id=` predicate the floor exists to eliminate — forget to annotate a new
  `invoices` table and its reads silently leak."
- Runtime (tenant-egress.ts SERVER_TENANT_HELPER): the active tenant is "Read per query, so a tenant switch
  earlier in the same request is honored" — so a read BEFORE the pin sees the tenant active before it
  (none in a fresh login session → zero rows; the previous tenant in a switch).

## Task A reproduction (EXECUTED at 104a54fcc == 2dd6d35d9 + BRIEF; harness .tmp/reproA/run.mjs, scratch)

| variant | diagnostics (login.scrml) | emitted read | login("a@x"), user u1 of tenant A seeded |
|---|---|---|---|
| two-file (users declared in app.scrml) | W-PROGRAM-*, W-SQL-ROW-UNTYPED, I-TENANT-STRIP | `_scrml_tenant_scope(await _scrml_sql\`SELECT id, tenant_id, users.tenant_id AS __scrml_tenant_0 FROM users WHERE email = ${email}\`…)[0] ?? null` | 200 `"bad"` |
| one-file (users declared in login.scrml) | same | same | 200 `"bad"` |

RELAYED premise CONFIRMED: every login silently fails; the only tenant signal is info I-TENANT-STRIP.

## Task A — built (31f5fbb9a, code + tests one commit; pre-commit 31477 pass / 0 fail)
- Locus: api.js TENANT-SCHEMA stage (the one place `compilationTenantSet` and every file's expanded AST
  coexist). NEW compiler/src/tenant-substrate-read.ts `fileTenantSubstrateReads(fileAST, ctx)`; ctx =
  `buildTenantContext(protect, [], "", undefined, compilationTenant)`; reads classified by the floor's own
  `resolveTenantScoping` (kind read | unresolvable).
- Code: **W-TENANT-SUBSTRATE-SCOPED** (Warning). Trigger AS BUILT: within one `function-decl` body, walked in
  evaluation order up to its first `session.set("tenantId", v)` call ExprNode (literal key; `v` not literal
  `not`; skipped when the function or file binds `session`), a `sql` node / `sql-ref` ExprNode that is a
  tenant-scoped read and not `.acrossTenants()` whose result DECIDES the pin: it is in the pin's value, or in a
  `condExpr` / `headerExpr` / c-style for test evaluated before the pin, directly or through a local
  (const/let/tilde/lin decl, `x =` assign) derived from it. Nested function-decls / lambdas skipped.
- PA-brief divergence (surfaced): the brief's trigger was "any scoped read before the pin" on the premise
  "before the pin no tenant is active". The runtime reads the tenant PER QUERY, so in a tenant SWITCH the
  read before the pin sees the previous tenant — a switch that reads the old tenant's domain rows on purpose
  would be a false positive with no correct silencing (`.acrossTenants()` is wrong there). Narrowed to reads
  that DECIDE the pin — the corollary's regress, provable in every session state.
- NOT built: interprocedural pin (already E-SESSION-CONTEXT — a peer call has no session; test pins it);
  userId-only login reading a tenant-scoped users table, incl. `scrml generate auth`'s template (org-first
  flows pin the tenant earlier; per-tenant users then work — not provable); raw-text-only `?{}`.
- After (same harness): two-file + one-file → W-TENANT-SUBSTRATE-SCOPED@login.scrml line 4 / 8, message
  names the corollary + both fixes; executed result unchanged ("bad") — warning only. `.acrossTenants()`
  fix → no warning, "ok:u1"; dropping tenant_id from users → no warning, "ok:u1".
- SPEC: §34 row + one §14.8.10 sentence with the brief's Provenance line. SPEC-INDEX regen, FACTS regen.

## Task B (b) — reproduced on 2dd6d35d9 (.tmp/reproB/b.mjs, postgres dialect)
- §14.8.10 allow-list clause quoted: a `<schema>` admits "`CREATE POLICY … AS RESTRICTIVE` (its body read in
  the tenant SQL subset — "Bodies" below — and its calls held to the expression allow-list below …)".
- base: `AS /* x */ RESTRICTIVE` → "body outside the tenant SQL subset — a `/* */` comment" + "permissive
  policy — its `AS` clause (`x`) could not be read"; `AS --x⏎ RESTRICTIVE` → same two with `--`;
  `ON assets /* c */ AS RESTRICTIVE` → "PERMISSIVE (the default when `AS` is omitted)"; non-tenant table →
  "body outside … comment" + "not admitted".
- Cause: the `content` reading lexes comment text as tokens (`x` read as the AS mode / the table's next
  token), and the policy body (read in the subset, which admits no comment) started right after the table,
  so it held the AS clause. Fix: `readPolicyHead` — comment-content tokens (`Tok.cmt`, new) are stepped over
  inside a live statement (a commented-out policy is still read whole); the body starts after the AS mode.
- head: all four admitted; still charged: comment inside USING, PERMISSIVE behind a comment, `/* RESTRICTIVE
  */ PERMISSIVE`, `--RESTRICTIVE⏎ PERMISSIVE`, evil() behind a comment, nested-`/*` divergent, commented-out
  permissive policy.

## Task B (c) — measured on 2dd6d35d9 (.tmp/reproB/c.mjs)
- base: "a{"×10k 0.8 s / ×20k 3.4 s / ×40k 13.5 s; "fn f("×40k 18.4 s; 'a{ """ '×20k 5.2 s; "a {{"×20k 6.7 s;
  'x{ """ b{ c{ }…'×5k 4.1 s. Also the paren scan of `fn` heads and the modifier-run regexes were quadratic.
- head: every case ≤ 46 ms; results byte-identical (JSON hash per case equal); differential fuzz vs the base
  module (random bodies over braces / parens / quotes / `"""` / fn modifiers): 300k (len ≤30) + 200k (len ≤30)
  + 50k (len ≤120) → 0 diffs.

## Measurements (base 2dd6d35d9 compiler sources flipped in place, restored after)
- Corpus write:true (examples/ samples/ conformance/cases/ stdlib/ = 2371 single-file; projects ex22, ex23,
  examples, stdlib, flogence/src): 0 artifact diffs; diagnostic diffs ONLY in the 2 new conformance cases
  (+W-TENANT-SUBSTRATE-SCOPED in substrate-scoped-login-warn; −4 E-TENANT-SCHEMA-HAZARD in
  schema-policy-comment-in-as-clause-pos). Corpus files gaining the warning: NONE. One pre-existing crash on
  both sides (samples/gauntlet-s19-phase4/nested-comments.scrml, RangeError max call stack) — unchanged.
- Conformance: head 1299/1349 + 50 xfail; on base sources substrate-scoped-login-warn and
  schema-policy-comment-in-as-clause-pos FAIL (substrate-across-read-pos passes on both — a negative pin).

## Task A hardening (self-review, after 191f095e7)
- Adversarial pass on my own trigger: the condition limb as first built charged ANY condition before the pin,
  incl. one guarding unrelated work, and a tenant SWITCH that tests the previous tenant's domain rows on
  purpose ("save your drafts first") — a false positive with no correct silencing.
- Rebuilt as two limbs: (1) VALUE — the read reaches the pinned value (always charged); (2) CONDITION — the read
  reaches a condition that CONTROLS the pin (pin inside the statement, or it can return / throw / fail first),
  charged only when the function also pins `userId` (a login: identity establishment hinging on the previous
  identity's tenant, or none). Added: a loop iterable is a condition; a `for … of` variable binds the rows.
- Documented miss (test-pinned): a switch validated by a tenant-scoped GRANT table via a condition only — broken in
  every state, but indistinguishable in the AST from the legitimate drafts check.
- Message names the limb ("pins the tenant on the result of a read" / "establishes a login behind a condition on").
  SPEC §14.8.10 sentence + §34 row restated to match. Corpus re-run (head2 vs base): still 0 artifact diffs; diag
  diffs only in the 2 new conformance cases; 0 corpus files gain the warning.
