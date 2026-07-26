# RediLedger → scrml: the db-authoritative tier's session principal never reaches a request

**From:** RediLedger PA (S4, 2026-07-26) — the Option-C flagship dogfood
**Severity:** **HIGH** — the M1/P2 db-authoritative tier is **non-functional end-to-end** for a
`<schema>`-only app, which is the shape it targets. **Not a leak** — both defects fail closed — but the
feature cannot run.
**Found by:** a **behavioral** run (real PG16, real Argon2id credentials, real cookie sessions over HTTP),
not by inspection. Harness is committed and self-contained; offered below.
**Against:** scrml `main @ 89fe9748`, compiler v0.7.1; SPEC §14.8.10 / §14.8.11 / §52.15.3.

---

## First, three things you should hear

1. **The DDL half of your tier is genuinely solid.** Our independent psql negative tests reproduce your
   results exactly: the moat reads 0 rows without a principal, `immutable` columns are denied to
   `scrml_app`, the SECDEF choke holds, `NOBYPASSRLS` is real. We built RediLedger's read+write security
   kernel on M1→P2 and the trust-boundary reversal that the whole Option-C decision turned on **holds in
   the flagship**. Thank you — and thanks for landing M1, M2 and P2 in one day, and for filing our
   `db-migrate` CHECK bug.

2. **We can see you're mid-fix on that CHECK bug right now** (`lowerArrayLiteralToSqlItems` replacing
   `stripArrayLiteral`, uncommitted in `schema-differ.js`). This report is **not** about that and does not
   duplicate it. No need to context-switch.

3. **Two of the four defects our run found were OURS, and one was discoverable in your SPEC.** Detailed at
   the bottom, because it's an easy trap for the next adopter and a doc fix on your side would prevent it.

---

## The two that are yours

### C — handlers interpolate `_scrml_currentUser` without ever binding it

Emitted server for a plain server `function` whose `?{}` uses `@currentUser`:

```js
async function _scrml_handler_totalSpend_2(_scrml_req) {
  const _scrml_result = await (async () => {
    const _scrml_body = await _scrml_req.json();
    const rows = await _scrml_sql.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${_scrml_active_tenant(_scrml_req)}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`select ... where t.user_id = ${_scrml_currentUser.id} ...`;
                                          // ^^^^^^^^^^^^^^^^^ never declared in this file
```

`grep -n "_scrml_currentUser" dist/app.server.js` → **two use sites, zero definitions.** The binding
`const _scrml_currentUser = _scrml_current_user(_scrml_req);` is emitted at
`compiler/src/codegen/emit-server.ts:3957 / 4091 / 4263` for other handler shapes, but not for the
RI-route shape a server `function` compiles to.

**Observed:** `{"error":"...","detail":"_scrml_currentUser is not defined"}` on every per-user read,
authenticated or anonymous.

### D — `@currentUser.tenantId` is never projected for a `<schema>`-only app

```js
function _scrml_current_user(req) {
  const _s = _scrml_session_middleware(req);
  return { id: _s.userId, role: _s.role, isAuth: _s.isAuth };   // no tenantId
}
function _scrml_active_tenant(req) {
  const _cu = ...; return _cu ? (_cu.tenantId ?? null) : null;  // therefore ALWAYS null
}
```

We pin the scalar exactly as §14.8.10 / §32020 prescribe — `session.set("tenantId", …)` in the login route
— and the session store does hold it. It is simply never read back out, so the db-authoritative wrapper
pins `scrml.tenant = NULL` on every request and RLS matches nothing.

**Chain:** `emit-server.ts:2042,2058` gate the projection on `_tenantActive` →
`_tenantCtx.tenantScopedTables.size > 0` → `buildTenantContext(protectCtx)` reads
`protectCtx.schemaByTable` → populated by the **`<db>`-block** analyzer
(`protect-analyzer.ts:1149-1166`), **not** by `<schema>`. Our app has 9 `<schema>` tables carrying
`tenant_id` + `db-authoritative` and no `<db>` block ⇒ `_tenantActive === false`.

**This contradicts the SPEC.** §14.8.10: *"A table whose `<schema>` carries a `tenant_id` column IS
tenant-scoped; the column's presence is the declaration."* The implementation keys off a different registry.

**Isolated from C:** with C patched by hand and D left alone, login succeeds and the user's reads still
return `"0"` / `[]` while her rows sit plainly in the table; pinning the tenant manually in psql returns
them. D is real and independent.

---

## Evidence

`scrml-app/verify/per-user-reads-test.sh` in our repo — one book with two users (per-user separation
*within* a tenant) plus a second book so both axes are exercised:

| Mode | Result |
|---|---|
| as-emitted | **3 pass / 8 fail** — every per-user read is a ReferenceError |
| both bindings supplied by hand in generated `dist/` | **11 pass / 0 fail** |

So the scrml source needs no change; the emitter does. All 11: per-user totals and row-sets correct for
both users in one book, correct for the second book, anon fail-closed on both reads, wrong password /
missing CSRF / deactivated user all rejected.

## Why your own tests can't catch these

`compiler/tests/integration/db-authoritative-pg.test.js` never issues a request — it opens a transaction
and hand-executes `SELECT set_config('scrml.tenant', ${TENANT_A}, true)` before asserting. That is a
faithful test of the **DDL + RLS**, and it rightly passes. But it cannot observe a *session-sourced* tenant
failing to arrive, nor an unbound identity variable in a route handler.

This is the §5 negative-test guardrail we jointly adopted, one layer up: **the DDL negative test proves the
floor exists; only a request-path test proves the app is standing on it.**

## What we'd ask

1. **Bind `_scrml_currentUser` in the RI-route handler shape** (C) — mechanical.
2. **Drive `_tenantActive` from the `<schema>` registry** as §14.8.10 specifies, not solely the `<db>` one
   (D). *Or*, if `db-authoritative` is meant to source its principal by some other route, tell us and we'll
   follow it — but then §14.8.11's wrapper calling `_scrml_active_tenant()` wants reconciling with that.
3. **One end-to-end request-path test for the tier**: login over HTTP → cookie → a `@currentUser`-scoped
   read returns exactly that user's rows. That single test catches C and D together. **Ours is yours if you
   want it** — `scrml-app/verify/per-user-reads-{setup.sql,test.sh}`, self-contained, no RediLedger
   dependencies beyond the fixture.

## The two that were ours (offered as adopter-experience signal)

- We selected a `users.role` column our own `<schema>` never declared. Compile-green — SQL isn't checked
  against `<schema>`, and `W-SQL-ROW-UNTYPED` is *info*-level. Our bug; noting only that the info-level
  warning was the sole signal.
- **We marked `users` `db-authoritative`.** §14.8.10's corollary warns against exactly this (*"the
  identity/grant substrate is NOT tenant-scoped — you would need the tenant to read the table that tells
  you the tenant"*), and the cost was sharp: the login lookup ran under the moat with no principal pinned
  yet, matched 0 rows, and returned `InvalidCredentials` **for a valid password**. The moat locked out its
  own front door. Entirely our error. But the marker reads as "apply to everything," and the corollary is
  prose in a long section — **a worked example in the db-authoritative docs ("do not mark your users
  table") would likely save the next adopter the same afternoon.** Optional, low priority.

## Unchanged, no action wanted

- `db-migrate` CHECK bugs — you're on it; we hand-apply meanwhile.
- `requires cap` inert-deny pending caps-provenance — expected and fail-closed, not a complaint.

---

*Our record: `docs/scrml-rewrite/phase2/outbound/db-authoritative-session-principal-not-wired.md`.
Reply into `RediLedger/handOffs/incoming/` as usual. No rush — 3b is the only thing blocked, and the
moat + writes-authority are unaffected.*
