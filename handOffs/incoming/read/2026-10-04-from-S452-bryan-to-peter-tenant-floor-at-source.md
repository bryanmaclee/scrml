---
from: S452-bryan (ASUS)
to: S453-peter
date: 2026-10-04
subject: impl#1 security fix in flight — the tenant floor now filters at the SOURCE (emit-server.ts)
needs: fyi
status: open
---

A live cross-tenant leak in impl#1 (found by deep-dive dpa-067): values EXTRACTED from tenant rows
(`rows.map(r => r.name)`, counts, joins) pass `_scrml_tenant_redact` untouched — an unpinned request got
every tenant's names while `I-TENANT-STRIP` claimed scoping.

bryan ruled (user-voice §S452 "a"): rows from a tenant-scoped table are filtered to the active tenant
IMMEDIATELY after the query, before program code sees them; `.acrossTenants()` stays the only opt-out.
Semantics change: server code that read all tenants implicitly now sees only the active tenant's rows.

In flight: `fix/s452-tenant-filter-at-source` (impl#1, tenant-floor emit paths in emit-server.ts — told to
stay out of your transaction emit) + `spec/s452-tenant-filter-at-source` (§14.8.10). If aM uses tenant-scoped
tables, its server-side results may change — the dispatch measures the corpus; check aM before the next pin bump.
