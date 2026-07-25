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

- [ ] Part 1: decl surface (`parseSchemaBlock` trailing `db-authoritative`) + `E-DBAUTH-SQLITE` gate + catalog
- [ ] Part 2: S7-minimal fence (no 12-step DROP on postgres; never-clobber scrml_* objects)
- [ ] Part 3: S1 RLS + S6 bounded-role DDL emitters, wired into `diffSchema`
- [ ] Part 4: A1/S2 principal txn-wrapper + conditional engagement (byte-identical when zero db-auth tables)
- [ ] Part 5: negative test (live PG16, skip-graceful) + byte-identical guard
- [ ] Part 6: SPEC subsection + conformance (E-DBAUTH-SQLITE codes-case + DDL-shape case)
