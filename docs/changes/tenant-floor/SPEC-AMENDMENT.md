# SPEC amendment — Tenant-row isolation floor (§14.8.10, Nominal)

**Session:** S273 (bryan) · **Date:** 2026-07-20
**Authority:** DD `scrml-support/docs/deep-dives/tenant-floor-design-2026-07-19.md` — bryan RULED all forks S271 (RULINGS banner). Design-insight recorded (Fork-C: isolation ≠ confidentiality; redact-floor hybrid).
**Kind:** SPEC-TEXT only, **Nominal / spec-ahead**. The V1-minimal impl wave (redact-floor + hard-fails, reusing the shipped §14.8.9 sink) flips the banner and fires the codes. NO codegen at this landing.
**Named-codes-land-with-impl (Rule 4):** the `E-TENANT-*` / `I-TENANT-*` codes are NAMED in §14.8.10; their §34 main-catalog rows land WITH the impl wave (the §14.8.9 / §38.13.8 / §60 / §61 precedent). NO §34 rows added at this landing.

---

## Rulings captured (S271, bryan)

- **Q1 GO** — scrml owns the tenant-**isolation invariant** (a row of tenant A never reaches a request whose ambient tenant is B); NOT policy (which tenant a user may act as, roles, grants — app-owned).
- **Fork B — key:** session-derived, **CONSUME-not-derive.** App pins `session.set("tenantId", t)`; the floor reads `@currentUser.tenantId` and NEVER computes one.
- **Fork A — declaration:** **A3 — the `tenant_id` column convention** (fail-closed-by-default; a `<schema>` table with a `tenant_id` column IS tenant-scoped). No per-table opt-in.
- **Fork C — enforcement:** **HYBRID** — REDACTION is the guaranteeing FLOOR (reuse the §14.8.9 tag/redact sink, one predicate deeper); INJECTION is the optimization + the mandatory mechanism for the classes redaction can't cover (aggregate-without-discriminator, writes). Hard-fails: `E-TENANT-AGG` / `E-TENANT-WRITE` / `E-TENANT-RAW-EGRESS`. `.acrossTenants()` = the sole loud opt-out.
- **Fork D — composition:** clean 4th confidentiality axis; the §38.13 `watches=` published frame is tenant-filtered per-subscriber at the same sink that already runs protect-redaction.
- **FREEZE:** V1-minimal = the redact floor + the hard-fails (NO new WHERE-parser); the INJECT optimization (WHERE-parser, defense-in-depth, aggregate-over-tenant, scale) is **v1.next**.

---

## New subsection — inserted after §14.8.9 (before §14.9), as `#### 14.8.10`

> The exact text applied to `compiler/SPEC.md`. §14.8.10 is a subsection of §14.8 — the section count is unchanged; the Sections-table line ranges from §14.8 onward shift and are regenerated via `bun run scripts/regen-spec-index.ts`.

```
#### 14.8.10 Server→client confidentiality — tenant-row isolation floor

**Added:** 2026-07-20 (S273) — ratifies the tenant-scoping-floor design (DD
`scrml-support/docs/deep-dives/tenant-floor-design-2026-07-19.md`; bryan RULED all forks
S271). **Nominal / spec-ahead-of-implementation.** This subsection specifies the contract;
the V1-minimal impl wave (the redact floor + the hard-fails, reusing the §14.8.9 sink — see
"Implementation status" below) flips this banner and fires the codes.

This is the **row-level twin of §14.8.9**. §14.8.9 strips protected **columns** at the
compiler-owned client-egress sinks; this floor isolates tenant **rows** at the same sinks. It
owns exactly the **isolation invariant** — *a row belonging to tenant A never reaches a request
whose ambient tenant is B* — and nothing else. It does **not** own policy: which tenant a user
may act as, which roles/grants exist, what each may do. Those stay app-owned server logic
(§52.15.2 trusts `@currentUser.role` without re-deriving it — the same discipline).

**The tenant key — consume, never derive (the invariant/policy firewall).** The floor
CONSUMES an app-established session scalar `@currentUser.tenantId` and NEVER computes one. The
app's login / tenant-switch code (policy) resolves the active tenant from whatever grant logic
it likes and **pins** it: `session.set("tenantId", t)` (§20.5.1). From that moment the ambient
tenant is a plain server-resolved scalar, exactly like `role`. The floor SHALL NOT read
grant/role tables to derive a tenant — that would require policy knowledge, force a choice among
multiple grants (a policy decision), and query a tenant-scoped table to bootstrap tenant-scoping
(circular). `@currentUser.tenantId` is server-resolved and **never client-supplied**
(E-REACTIVE-003, §52.15.1) → unspoofable, inheriting `role`'s integrity. **Corollary:** the
identity/grant substrate (`users` / `user_roles`) is NOT tenant-scoped — you would need the
tenant to read the table that tells you the tenant (infinite regress). The tenant-scoped set is
the DOMAIN tables (assets, orders, work-orders), never the substrate the tenant is resolved from.

**Declaration — the `tenant_id` column convention (fail-closed at the declaration layer).** A
table whose `<schema>` carries a `tenant_id` column IS tenant-scoped; the column's **presence
is the declaration** (detection via the FROM-tables of `extractSelectProjection()`, the same
extractor §14.8.9 uses). There is no per-table opt-in attribute: a forgettable declaration is
isomorphic to the forgettable `WHERE tenant_id=` predicate the floor exists to eliminate —
forget to annotate a new `invoices` table and its reads silently leak. The convention encodes
the ratified security property "a uniform `tenant_id` on every scoped table is itself a security
property." The `tenant`-family vocabulary does NOT collide with §23.5 `capabilities=` (foreign-code
host caps — `network` / `fs` / `spawn` / `db`, an unrelated sense of "capability").

**Enforcement — HYBRID (redaction guarantees, injection optimizes).** Rows are not columns, and
that asymmetry drives the mechanism split:

- **Redaction is the guaranteeing FLOOR.** Every row read against a tenant-scoped table is tagged
  with its source `tenant_id` at query-lowering (the §14.8.9 `_scrml_protect_tag` primitive, one
  predicate deeper) and, at the client-egress sink, every row whose `tenant_id` ≠ the ambient
  `@currentUser.tenantId` is dropped (`_scrml_protect_redact`, extended with the row-level
  predicate). This **inherits §14.8.9's entire soundness argument verbatim** — sound by
  construction, no query rewriting, no value-flow-completeness obligation — and reuses the
  shipped egress paths (server-fn response, SSR `/__serverLoad`, channel `broadcast()`, SSE
  `data:`). It fires `I-TENANT-STRIP` (the redaction is never silent).
- **Injection is the optimization + the mandatory mechanism for what redaction can't cover.** For
  a statically-rewritable row read, the compiler MAY inject `AND tenant_id = ${@currentUser.tenantId}`
  into the WHERE (rows never materialize off the DB; indexes filter) — a **v1.next** optimization
  gated on a SQL-WHERE-parser (it must parenthesize the existing WHERE — the `OR`-precedence
  hazard makes every parser bug a silent leak, so it is deliberately deferred behind the redact
  floor). Injection is **mandatory** (inject-or-hard-fail) exactly where redaction is unsound:
  - **Aggregate / scalar** over a tenant-scoped table WITH an output tenant discriminator
    (`GROUP BY tenant_id`) → redaction strips non-matching groups. WITHOUT a discriminator (a bare
    `COUNT(*)` folds every tenant into one scalar — no row to key on) → inject the constraint, and
    if un-injectable, **hard-fail `E-TENANT-AGG`** (redaction is UNSOUND here).
  - **Write** (INSERT / UPDATE / DELETE) against a tenant-scoped table → **inject-or-hard-fail
    `E-TENANT-WRITE`.** There is no egress sink for a write; a committed cross-tenant write is
    durable before any redaction could run, so it must fail closed at compile. An INSERT gets
    `tenant_id = @currentUser.tenantId` injected into its column-set; an UPDATE/DELETE without an
    injectable tenant constraint hard-fails.
- **Raw / foreign egress** (a `_{}` foreign-code block §23, a manual `Response` / `handle()` body
  §40, an `asIs`-typed value §14.1.1) carrying a tenant-scoped table's rows → **hard-fail
  `E-TENANT-RAW-EGRESS`** — the compiler cannot tag/redact an un-analyzable egress. The
  confidentiality sibling of `E-PROTECT-004`, in the row-isolation direction. A `.acrossTenants()`
  on the query suppresses it (explicit cross-tenant intent).
- **Fail-closed when the tenant scalar is absent.** `@currentUser.tenantId is not` (anonymous /
  unpinned) → the redact predicate matches **zero rows**; an unpinned request sees nothing —
  fail-closed by construction, identical to §52.15.3's shipped anonymous-`NULL`-matches-zero shape.

**Declassification — `.acrossTenants()` (the sole loud opt-out).** A greppable `?{…}.acrossTenants()`
method suppresses tenant-scoping for one query, for legitimate cross-tenant reads (platform-admin
dashboards, cross-tenant reporting). It is the **only** way to emit an unscoped read against a
tenant-scoped table — the unscoped path is unrepresentable without it — and it fires
`I-TENANT-ACROSS` so an audit can grep every cross-tenant read in the codebase. It mirrors
`reveal()` (§14.8.9): the sole, checked, greppable admit path; the floor checks the marker, never
trusts an annotation.

**Composition — the fourth confidentiality axis.**
- **§52.15 stacking axes** — tenant-scope is a **fourth, coarser row-selection axis**:
  route-admission (§52.15.2) ⟂ **tenant-scope (§14.8.10)** ⟂ per-user row-selection (§52.15.3) ⟂
  column-redaction (§14.8.9). They STACK; none substitutes — a per-user-scoped payload can still
  leak a wrong tenant's rows if the request's tenant is unconstrained, and a tenant-scoped payload
  can still leak another user's rows within the tenant.
- **§52 authority** — a `authority="server" table=` Tier-1 cell's compiler-generated `SELECT *`
  initial load (§52.3) is the **easiest** tag site (fully compiler-controlled, no author SQL);
  the floor and §52's generated loads reinforce each other.
- **§14.8.9 protect** — orthogonal (columns vs rows); both reuse `extractSelectProjection` and
  compose at the same lowering choke and the same egress sink.
- **§38.13 `watches=`** — the realtime feed re-SELECTs the changed row and publishes it, and the
  published frame already runs §14.8.9 protect-redaction (§38.13.9 Phase-2 (d)). The tenant filter
  SHALL slot in at the **same sink, per-subscriber** — a subscriber receives only its own tenant's
  row changes; otherwise the realtime feed reopens the cross-tenant leak the read floor closed.

**Soundness scope (normative bound — the prose SHALL NOT over-claim).** The guarantee is
**complete for reads of statically-declared tenant-scoped tables whose row `tenant_id` origin is
resolvable, by origin.** It does **NOT** cover: covert channels (timing, row presence/absence);
derived/implicit flows (a value computed *from* tenant rows but of independent identity);
cross-database tenant joins (the predicate form is single-DB). An unresolvable dynamic read
degrades to redact-at-sink (never accept-unknown); aggregate-without-discriminator, writes, and
raw egress fail closed at compile.

**Anti-pattern (named) — auto-deriving the tenant.** The Trojan-horse design: have the floor join
`user_roles` at query time to compute the tenant. It needs the grant schema (policy), must pick
among possibly-many grants (policy), and queries a tenant-scoped table to bootstrap tenant-scoping
(circular). The floor SHALL consume a pinned scalar, never compute one — this single prohibition
is the entire invariant/policy firewall.

**Diagnostics** (named now; emitted when the floor build lands, per the §14.8.9 / §38.13.8 / §60 /
§61 named-codes-land-with-impl precedent — Rule 4):
- **`E-TENANT-AGG`** (Error) — an aggregate/scalar over a tenant-scoped table with no output tenant
  discriminator and no injectable tenant constraint (redaction has no row to key on).
- **`E-TENANT-WRITE`** (Error) — an INSERT/UPDATE/DELETE against a tenant-scoped table with no
  injectable tenant value (no egress sink can redact a durable write; it must fail closed).
- **`E-TENANT-RAW-EGRESS`** (Error) — a tenant-scoped table's rows reach a compiler-unanalyzable
  egress (raw `_{}` / manual `Response` / `asIs`); the row-isolation sibling of `E-PROTECT-004`.
  Suppressed by an explicit `.acrossTenants()`.
- **`I-TENANT-STRIP`** (Info) — the egress sink dropped one or more non-matching-tenant rows (the
  redaction is never silent). Also fires on the wholesale-strip fallback of an unresolvable dynamic
  read. Mirrors `I-PROTECT-STRIP-001`.
- **`I-TENANT-ACROSS`** (Info) — a `.acrossTenants()` opt-out emitted an unscoped read against a
  tenant-scoped table (the cross-tenant audit surface).

**Implementation status (Nominal — V1-minimal = the redact floor + the hard-fails).**
- **V1-minimal (the freeze scope — a second deliberate security-feature exception, alongside CSS
  Wave-1):** the REDACT floor + the hard-fails — tag-then-strip at the shipped §14.8.9 egress sink
  (reads), the `E-TENANT-AGG` / `E-TENANT-WRITE` / `E-TENANT-RAW-EGRESS` hard-fails, `.acrossTenants()`,
  and the fail-closed-when-unpinned zero-row behavior. Reuses the shipped §14.8.9 machinery;
  requires **NO** new SQL-WHERE-parser. Robustness note: the "DB-inside-the-TCB → redact is
  sufficient" premise holds for the LAN SQLite target; injection coverage grows as shared/cloud
  Postgres arrives.
- **v1.next (the INJECT optimization):** predicate injection (`WHERE tenant_id=`) — which needs a
  SQL-WHERE-parser (the `OR`-precedence hazard, deferred behind the redact floor) — for
  defense-in-depth (rows never materialize off the DB), aggregate-over-tenant injection, and scale
  (DB-side indexed filtering vs full-table-then-strip).

**Cross-references:** §14.8.9 (the column twin — shares the tag/redact sink + the extractor);
§52.15 (the per-user row-scope precedent + the stacking axes + `@currentUser`); §20.5.1
(`session.set("tenantId", …)` — the tenant-key establishment); §38.13.9 (the `watches=`
published-frame sink — per-subscriber tenant filter); §23.5 (`capabilities=` — a different sense
of "capability"; no collision). Authority: DD `scrml-support/docs/deep-dives/tenant-floor-design-2026-07-19.md`
(bryan RULED all forks S271) + design-insight (2026-07-20).
```

---

## Cross-amendments (surgical additions)

### §52.15.1 — add the `@currentUser.tenantId` projection (after the `.isAuth` bullet)
```
- `@currentUser.tenantId : string | not` — the ambient tenant key; `not` when unpinned. Server-resolved
  from the session `tenantId` scalar (§20.5.1) the app pins via `session.set("tenantId", …)`; the §14.8.10
  tenant-row isolation floor CONSUMES it (consume-not-derive) and never computes one. Never client-supplied
  (E-REACTIVE-003) → unspoofable, inheriting `role`'s integrity.
```

### §52.15.4 — name the fourth stacking axis (append to the axis sentence)
Append to §52.15.4: a sentence noting §14.8.10 tenant-row isolation adds a fourth, coarser
row-selection axis (whole-tenant) that stacks with the three and substitutes for none.

### §38.13.9 Phase-2 (d) — the per-subscriber tenant filter note (extend the redaction clause)
Extend the "(d) §14.8.9 protect-egress redaction of the published row" clause with: per §14.8.10,
the tenant filter slots in at this SAME sink **per-subscriber** — a subscriber receives only its
own tenant's row changes (else the read floor's guarantee has a realtime hole). Nominal (rides the
tenant-floor impl wave).

### §20.5.1 — note the `tenantId` establishment key (near the reserved-keys / worked-example area)
Add: `session.set("tenantId", t)` establishes the ambient tenant the §14.8.10 floor reads via
`@currentUser.tenantId`. It is a **preference-key write** (does not touch `userId`), so a
tenant-switch updates the record in place — no session-id rotation, no logout of an in-flight
request. Set it after login (identity-establishing writes rebuild the record from this request's
changes alone — include `tenantId` in the login write, or set it in the same request).

---

## Index + landing
- Regenerate the Sections table: `bun run scripts/regen-spec-index.ts` (§14.8 onward line ranges shift; section count unchanged — §14.8.10 is a subsection).
- SPEC-INDEX front-matter: prepend a recent-landings banner entry for this amendment.
- No §34 rows, no codegen, no tests at this landing (Nominal). The impl wave (V1-minimal redact-floor) is the follow-on arc.
