# DB-authoritative P2 — writes-authority (S3 + S4) — PROGRESS

Ruled DD: `scrml-support/docs/deep-dives/db-authoritative-p2-writes-authority-2026-07-26.md`
Base: `main @ 79cd79ce`. Branch: worktree branch (harness-named).

## Ruling (do not re-open)
- S3: per-column `immutable` keyword + reshape the M1 blanket table-level GRANT to column-scoped.
- S4: `fn NAME(args) security definer owner(<role>) requires cap("x") { """<plpgsql>""" }` inside `<schema>` (co-location).
- SECDEF hardening = codegen invariant: `SECURITY DEFINER SET search_path = pg_catalog, public` + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO scrml_app`, owned by a bounded NOLOGIN owner role.
- Capability-GUC: single JSON `scrml.principal.caps` + `scrml_has_cap(text)` helper.
- Composition: STACK — direct writes stay banned; SECDEF CALL is the sole sanctioned mutation path.
- Phasing: P2 = S3 + S4 only. S5 double-entry trigger stays P3.

## Body-contract decision (surface is M1-PROVISIONAL per DD §14.8.11)
The triple-quoted `fn` body carries the plpgsql STATEMENTS only (no outer `BEGIN`/`END`).
scrml owns the `BEGIN ... END` envelope and injects the cap check as the FIRST statement
inside it — so the cap gate is un-bypassable and always runs first. This is the only reading
of the brief's "prepend the cap check to the verbatim body, wrap in `$$`" that yields valid
plpgsql (an `IF` before `BEGIN` is a syntax error). The DD example wrote its own `BEGIN/END`;
that was illustrative. Documented in SPEC §14.8.11.2 + the emitter comment.

## search_path = pg_catalog, public (NOT pg_temp)
The DD example wrote `pg_catalog, pg_temp`, but a SECDEF body references unqualified tables
(e.g. `invoices` in `public`), so `public` MUST be on the path or the body fails at runtime.
`pg_catalog` FIRST pins the built-ins against shadowing (CVE-2020-25695). Brief rules this shape;
the acceptance gate asserts `proconfig` contains `search_path=pg_catalog, public`.

## Steps
- [x] 1. parseSchemaBlock brace-depth-aware upgrade (+ `fns`) + backward-compat regression test
      (also: `immutable` keyword parse in parseColumns; introspect self-verify now KEEPS balanced-brace
       defaults like jsonb `'{}'` — data-fidelity gain, sibling drop-path test added)
- [x] 2. S3 immutable column keyword + GRANT reshape (byte-identical when zero immutable)
- [x] 3. S4 generateSecdefDDL (owner role + hardened CREATE FUNCTION + EXECUTE lockdown) + scrml_has_cap
      + wired into diffSchema (postgres-only; scrml_has_cap once when fns present)
- [x] 4. caps-GUC injection in wrapPrincipalTxn + `_scrml_active_caps` resolver (SERVER_TENANT_HELPER)
- [x] 5. M2 apply-seam wiring (extractDesiredSchema fns → parseProjectSchema → desired.fns → diffSchema;
      classifyStatement function/role(quoted)/revoke kinds; E-DBAUTH-SQLITE also fires on fns
      (db-migrate + codegen/index compile gate))
- [x] 6. live-PG 4-assertion acceptance gate (db-authoritative-p2-pg.test.js — 7/7 pass on PG16) +
      compile-shape conformance (conf-DBAUTH-P2.test.js — 8/8) + SPEC §14.8.11.2 + E-DBAUTH-SQLITE §34 update

## Deploy-role finding (surfaced during the acceptance run)
`ALTER FUNCTION … OWNER TO <owner>` under a NON-superuser migrator requires (a) the migrator can SET
ROLE to the owner and (b) the owner holds CREATE on the function's schema. The emitter now provisions
both: `GRANT <owner> TO CURRENT_USER;` + `GRANT CREATE ON SCHEMA public TO <owner>;` before the ALTER.
SECURITY-CRITICAL: without the ownership reassignment the SECDEF would run as the powerful migrator,
not the bounded owner. PG16 plain GRANT membership defaults SET TRUE (PG15-portable). A cluster where a
DIFFERENT migrator pre-created the owner role hits the M1 cluster-global-role open (documented).

## DONE — all 6 steps landed; acceptance gate green on live PG16.

## PA adversarial-review hardening round (review came back CLEAN — no HIGH/MED; 3 LOW folded in)
1. proowner REGRESSION LOCK — acceptance assertion (4b): pg_proc JOIN pg_roles asserts the SECDEF owner
   is the bounded per-run owner role (NOT the migrator), rolsuper=false, rolbypassrls=false.
2. SPEC §14.8.11.2 THREAT-MODEL note (tier-wide honesty bar): the GUC principal (scrml.tenant +
   scrml.principal.caps) is self-settable by a scrml_app with an injectable SQL channel → cap gate +
   tenant isolation enforce against a NON-compromised app (parameterized emission is what keeps the
   channel un-injectable); the hard DB-authorities that survive full app compromise are the immutable
   REVOKE + the SECDEF-only choke + NOBYPASSRLS. Do NOT present the cap check as DB-enforced authz.
3. Schema-qualify the injected guard: `public.scrml_has_cap('x')` (belt over the pinned search_path).
Acceptance re-run: 8/8 on PG16 (incl. proowner). NOT built (PA-filed gaps): auto-immutable-PK,
owner over-grant on all db-auth tables, real caps source (S8), $user-schema-migrator edge.

## Caps-source disposition
`_scrml_active_caps(req)` resolves from the session-derived `_scrml_current_user(req)` (reads
`_cu.caps` if present, else `[]`). Server-resolved, never client-supplied (mirrors tenantId /
E-REACTIVE-003). No caps SOURCE field exists on the session record yet → M1-PROVISIONAL open:
the resolver defaults to an empty array (fail-closed — no caps ⇒ no privileged mutation).
