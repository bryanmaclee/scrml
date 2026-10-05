# progress — s455-tenant-floor-project-set (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a533df4b6feb30120, base e014f20ce (== origin/main, #1313).
- Maps: .claude/maps/primary.map.md read (stamp f38697900, predates #1313); #1313 progress.md read in full.

## Governing sentences (SPEC §14.8.10, read in full; §14.8.11 read in full)

- Isolation invariant (§14.8.10 ¶3): "It owns exactly the **isolation invariant** — *a row belonging to tenant A is never observed by code serving a request whose ambient tenant is B, and so never reaches that request* — and nothing else."
- Declaration (§14.8.10 "Declaration — the `tenant_id` column convention"): "A table whose `<schema>` carries a `tenant_id` column IS tenant-scoped; the column's **presence is the declaration** … There is no per-table opt-in attribute: a forgettable declaration is isomorphic to the forgettable `WHERE tenant_id=` predicate the floor exists to eliminate — forget to annotate a new `invoices` table and its reads silently leak."
- Source filter (§14.8.10 Enforcement): "Rows read from a tenant-scoped table SHALL be filtered to the active tenant immediately after the query executes, before any program code observes them … It fires `I-TENANT-STRIP`."
- Soundness scope: "The guarantee is **complete for reads of statically-declared tenant-scoped tables**".
- The text being amended (S455 #1313, "The rule reads the schema as it will exist"): "This scopes the declaration rule only — the floor's own query scoping stays per file." and "…and neither is a column added by `ALTER TABLE … ADD COLUMN tenant_id`." (both recorded there as pre-existing gaps, not rulings.)
- The compilation-scoped set (same paragraph): "there is ONE tenant set — the union of the tenant tables of every file compiled together, whatever database each names".

## Reproductions (EXECUTED at compiler == e014f20ce; harness .tmp/repro1/run.mjs, scratch)

- ITEM 1: app.scrml (`<schema>` CREATE TABLE assets (…, tenant_id)) + admin.scrml (no schema, same `db="app.db"`), compiled together; seeded bun:sqlite with A/B rows; pinned A via session.set in each module; called each read in-process.
  - app.server.js:   `_scrml_tenant_scope(await _scrml_sql\`SELECT name, assets.tenant_id AS __scrml_tenant_0 FROM assets\`, …)` → `[{"name":"A-asset"}]`
  - admin.server.js: `return await _scrml_sql\`SELECT name FROM assets\`;` → `[{"name":"A-asset"},{"name":"B-secret-asset"}]`  **LEAK — B's row served to a request pinned to A.** Diags: only I-TENANT-STRIP@app.scrml.
- ITEM 2: notes.scrml `<schema>` CREATE TABLE notes (id, body) + `ALTER TABLE notes ADD COLUMN tenant_id TEXT`; pinned A → `SELECT body FROM notes` emitted unfiltered → `[{"body":"A-note"},{"body":"B-secret-note"}]` **LEAK**; no diagnostics. noteshaz.scrml adds `CREATE VIEW all_notes AS SELECT * FROM notes` → compiles with NO E-TENANT-SCHEMA-HAZARD (accepted).

## Traced loci (brief hypotheses)

- emit-server.ts `_tenantCtx = buildTenantContext(_protectCtx, extractDesiredSchema(fileAST).tenantTables, …)` — HELD: the `<schema>` half is per file.
- tenant-egress.ts `buildTenantContext` — REFINED: correct as a merge; the defect is its INPUT (one file's schema). Its `<db tables=>` half (`protectCtx.schemaByTable`) is ALREADY compilation-wide.
- protect-analyzer.ts — WRONG as a locus for item 1: `paResult.protectAnalysis` is one compilation-wide analysis (its views map spans every file's `<db>`).
- Additional locus found: emit-tool.ts `beginToolTenantFloor` (a `kind="tool"` program) — same per-file build.
- Item 2: schema-differ.js `schemaTableDeclarations` (the shared recognizer feeding extractDesiredSchema's tenantTables union, #1313's `schemaTenantTableNames`, and E-SCHEMA-015's `findTenantDeclarationDisagreements`) reads CREATE TABLE column lists and DSL heads only — HELD.
