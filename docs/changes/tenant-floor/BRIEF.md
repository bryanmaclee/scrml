# BRIEF — Tenant-row isolation floor (§14.8.10)

**change-id:** tenant-floor · **opened:** S273 (bryan) 2026-07-20
**Authority:** DD `scrml-support/docs/deep-dives/tenant-floor-design-2026-07-19.md` — bryan RULED all forks S271.

DONE-PROBE: grep -rqE "E-TENANT-(AGG|WRITE|RAW-EGRESS)" compiler/src/

> The probe asserts the **V1-minimal impl** fired (the compiler emits the `E-TENANT-*` codes). It stays OPEN
> after the SPEC-only (Nominal) landing and flips DONE only when the redact-floor impl wave lands. The
> SPEC amendment is the "designed-before-built" half (§14.8.9 pattern).

## The arc
scrml owns a compiler-enforced **tenant-isolation floor** — the row-level twin of the §14.8.9 `protect=`
column floor. A `<schema>` table with a `tenant_id` column is tenant-scoped; every compiler-emitted read
against it is filtered by the ambient `@currentUser.tenantId` **by construction**, a read the compiler
cannot constrain fails closed, and cross-tenant reads take a loud `.acrossTenants()` opt-out. It owns the
**isolation invariant** only — not policy (roles/grants/who-may-act-as, all app-owned).

## Rulings (S271, bryan — all forks)
- **Q1 GO** · **Fork B** session-derived `@currentUser.tenantId`, CONSUME-not-derive (the crux — the app pins
  `session.set("tenantId",t)`, the floor never computes one) · **Fork A A3** `tenant_id` column convention
  (fail-closed-by-default) · **Fork C HYBRID** redaction = the guaranteeing floor, injection = the optimization
  + mandatory for aggregate-without-discriminator + writes (hard-fails `E-TENANT-AGG`/`E-TENANT-WRITE`/
  `E-TENANT-RAW-EGRESS`; `.acrossTenants()` sole opt-out) · **Fork D** clean 4th confidentiality axis
  (+ tenant-filter the §38.13 `watches=` frame per-subscriber) · **FREEZE** V1-minimal = redact-floor + hard-fails
  (NO WHERE-parser); INJECT optimization = v1.next.

## Stage 1 — SPEC amendment (THIS landing, S273 — Nominal)
`SPEC-AMENDMENT.md` (this dir). New `#### 14.8.10` after §14.8.9 + cross-amends §52.15.1 (`@currentUser.tenantId`)
/ §52.15.4 (4th axis) / §38.13.9(d) (per-subscriber tenant filter) / §20.5.1 (`session.set("tenantId")`).
`E-TENANT-*` / `I-TENANT-*` codes NAMED (§34 rows land WITH impl per Rule 4). No codegen, no tests. SPEC-INDEX regenerated.

## Stage 2 — V1-minimal impl (NEXT arc — the redact floor + the hard-fails)
Reuse the shipped §14.8.9 sink (`compiler/src/codegen/protect-egress.ts` tag/redact; `rewrite.ts:139-152`
choke; `sql-projection.ts` `extractSelectProjection().fromTables` for tenant-scoped detection). Tag rows with
`tenant_id` origin → strip non-matching at the egress sink (reads); hard-fail `E-TENANT-AGG`/`E-TENANT-WRITE`/
`E-TENANT-RAW-EGRESS`; `.acrossTenants()` suppressor; fail-closed-when-`@currentUser.tenantId is not` (zero rows).
NO new SQL-WHERE-parser (that is the v1.next INJECT optimization — the `OR`-precedence hazard). §34 catalog rows
land in this wave. Conformance case pinning the surface (both codes-half + runtime-half) = the merge-blocker.
Dispatch = `scrml-js-codegen-engineer` iso:worktree; brief BOTH anti-pattern docs; S239 adversarial pass +
R26 empirical MANDATORY (security floor — EXECUTE the bundle, not grep).

## Watch
- Tenant-key **consume-not-derive** is the invariant/policy firewall — reject any impl that reads grants to derive a tenant.
- Writes hard-fail without an injectable tenant value — verify a committed cross-tenant write cannot slip past (no egress sink for writes).
- `@currentUser.tenantId` server-resolved / never client-supplied (E-REACTIVE-003) — the unspoofable property.
