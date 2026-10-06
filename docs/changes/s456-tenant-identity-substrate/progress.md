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
