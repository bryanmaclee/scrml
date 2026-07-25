# DB-authoritative security — Milestone 1 (reads-authoritative, one table)

Branch: worktree-agent-abd62f450714e91cd
Plan of record: `scrml-support/docs/deep-dives/db-authoritative-security-PHASING-PLAN-2026-07-25.md`
Evidence DD: `scrml-support/docs/deep-dives/db-authoritative-security-design-2026-07-25.md`

M1 = P0 + P1 on one table (`invoices`), reads-authoritative only, opt-in per table,
Postgres-only, `E-DBAUTH-SQLITE` hard-fail on SQLite. Stacks with §14.8.10 (defense-in-depth).

## Fire-site reality (verified against source this dispatch)

- `diffSchema`/`generateCreateTable`/`readActualSchema` in `schema-differ.js` are NOT wired into
  the emitted server runtime. `diffSchema` has ZERO callers in `src/`; the only in-src consumers of
  `parseSchemaBlock`/`generateCreateTable` are `protect-analyzer.ts` (shadow-DB for §14.8.10 typing),
  `channel-watches.ts`, and `gauntlet-phase1-checks.js`. There is NO compiler-emitted
  `_scrml_migrations` apply path — `_scrml_migrations` appears only in schema-differ's actual-state
  reader exclusion filter. `emit-server.ts` does not consume `<schema>` for runtime DDL at all.
  → The M1 DDL emitters live in `schema-differ.js` as the canonical migration-SQL producers
    (`diffSchema` output). The negative test + conformance apply that DDL directly. Surfaced as a
    finding: there is no runtime migration-apply seam to hook; M1 produces the DDL, wiring a runtime
    apply path is out of M1 scope.
- `_scrml_active_tenant(_scrml_req)` (tenant-egress.ts:382) is the pinned tenant scalar → feeds
  `set_config('scrml.tenant', …)`.
- `_scrml_req` is passed explicitly to every handler (no AsyncLocalStorage) → principal available
  in every handler body.

## Build steps

- [x] Part 1: decl surface (`parseSchemaBlock` trailing `db-authoritative`) + `E-DBAUTH-SQLITE` gate + catalog — commit ab0fdaa6
- [x] Part 2: S7-minimal fence (no 12-step DROP on postgres; native ALTER) — commit ab0fdaa6
- [x] Part 3: S1 RLS + S6 bounded-role DDL emitters, wired into `diffSchema` — commit ab0fdaa6
- [x] Part 4: A1/S2 principal txn-wrapper + conditional engagement (byte-identical when zero db-auth tables) — commit 6178d84a
- [x] Part 5: negative test (live PG16, skip-graceful) — `compiler/tests/integration/db-authoritative-pg.test.js`
- [x] Part 6: SPEC §14.8.11 + conformance `conf-DBAUTH-M1.test.js` (E-DBAUTH-SQLITE codes + DDL-shape + A1-wrapper compile-shape + byte-identical guard)

## Negative-test result (real PG16, validated this dispatch)
- control (superuser, no role drop, bypasses FORCE RLS): 3 rows — proves S6 mandatory (finding F1).
- (a) bounded `scrml_app`, NO set_config → 0 rows (fail-closed). PASS.
- (b) bounded `scrml_app`, set_config(tenantA) → 2 rows, all tenant-A. PASS.

## Findings surfaced
- `uuid`/`decimal` are not §39.4-legal scrml `<schema>` column types (E-SCHEMA-004). A
  fully-compilable db-authoritative app uses core types (text/real); the DDL emitter passes
  PG-native types (uuid/decimal) through verbatim, and the negative test drives the emitter
  directly with the brief's uuid/decimal shape (mirroring the spike). Postgres-native `<schema>`
  column types is a separate owner-ruled type-system thread.
- The DD's illustrative single-line column form (`invoices { id: uuid … tenant_id: uuid … }`)
  does not parse — `parseColumns` is newline-based (one column per line). Canonical form is one
  column per line; SPEC §14.8.11 example uses the newline form.
- No compiler-emitted runtime `_scrml_migrations` apply path exists; `diffSchema` has zero src
  callers. The DDL emitters ARE the migration-SQL producers; M1 does not wire a runtime apply seam.
- A1 wrapper targets server-fn handler `?{}` queries (all take `_scrml_req`). SSR `/__serverLoad`
  query wrapping (different request binding) + the §8.9.2 write-envelope composition are P1-tail/P2.
