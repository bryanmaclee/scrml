# BRIEF r2 — s452-tenant-filter-at-source fix round (archived verbatim)

PA → tenant filter-at-source agent: the security review of 1239366814c returned FIX. Nothing is worse than base, but four HIGH bypasses remain, and the gap's "resolved/closed" claims are false. Fix round on the same branch, same rules. Archive this as BRIEF-r2.md, and add "fix round r2" to progress.md. Reproduce each first, then fix.

DIRECTION (S451 durable: "text classification cannot prove a query safe"): stop enumerating. Every SQL-text check becomes FAIL-CLOSED, with an allow-list rather than a deny-list.

H1 — comments defeat the subquery → E-TENANT-AGG rule (tenant-egress.ts ~248-262). `SELECT (/**/SELECT group_concat(name) FROM assets) AS names` leaked both tenants. Fix: run EVERY tenant SQL check on one normalized text, with comments AND string literals stripped, the same normalization `normalizeQuery` uses. One shared normalizer, not a second copy. This also fixes L3 (a string literal false positive).

H2 — the §8.10 N+1 loop hoist (emit-control-flow.ts ~1071) emits a raw `.unsafe(...)` IN-query with no scope. A's loop got B's asset. Fix: wrap the hoisted rows with the same source filter (`_lowerTenantForQuery` / `wrapWithTenantScope`). If that can't be done soundly, REFUSE the hoist for tenant tables (fall back to the per-iteration query). Then audit EVERY other emit path that issues SQL without going through the scoped lowering: grep for `.unsafe(` and the raw sql tag under compiler/src/codegen. List each site with scoped/unscoped/not-applicable in progress.md, and fix or refuse each unscoped one that can reach a tenant table.

H3 — the aggregate check is a fixed name list (~237): `json_group_array` / `array_agg` / `string_agg` / `json_agg` leak. Fix with an ALLOW-LIST: a tenant-table query is a plain row query only if, after normalization:
- it has no `GROUP BY`, `HAVING`, `OVER` (window), `DISTINCT`, `UNION` / `INTERSECT` / `EXCEPT`, and no subquery;
- every function call is in an explicit allow-list of per-row scalar functions (e.g. lower, upper, length, trim, substr, coalesce, ifnull, abs, round, date, datetime, strftime, cast — keep it small and documented).
Anything else is an aggregate-like query → E-TENANT-AGG (unless `.acrossTenants()`, or the GROUP BY exemption below). Unknown function → refused (fail-closed). This also covers L2 (window functions).

H4 — the `GROUP BY tenant_id` exemption is a loose regex (~326: `GROUP BY[^;]*tenant_id`, satisfied by `ORDER BY tenant_id`). Fix: extract the GROUP BY clause's column list structurally (up to the next clause keyword: HAVING, ORDER BY, LIMIT, WINDOW, end), and exempt only when the tenant column (qualified or not, for EACH tenant source) is in that list. If it can't be determined, it is not exempt.

L1 — the author-written `SELECT *, 'A' AS tenant_id` overrides the key. Fix: the compiler-added key column uses a reserved alias that can't collide (e.g. `__scrml_tenant_<n>`), and an author projection naming that alias is an error. Filter on the reserved alias only.

Also:
- Correct docs/known-gaps.md. The C4 entry stays resolved for the extraction class only. File one new entry (sev=HIGH, status=resolved by this round) for H1–H4 + L1 + L2. Note `g-tenant-channel-sse-per-subscriber-filter`: the reviewer read a live pg LISTEN publish path at emit-channel.ts:1080 that publishes to every subscriber unfiltered, so the entry looks stale. Re-verify by reading, and update the entry's text/locus (do not fix; Postgres-only).
- Leave the INSERT-in-peer gap open; a ruling is pending.

Tests: every repro (H1 three forms, H2, H3 with json_group_array + one unknown function, H4, L1, L2, L3) fails on 1239366814c and passes after the fix, executed against two seeded tenants like conf-TENANT-SOURCE-FILTER. Re-run all tenant test files, the corpus differential, and the full gate. Then `git merge origin/main` (resolve generated hunks only), and push.

FINAL REPORT (<450 words): FINAL_SHA (== pushed tip), per finding, the SQL-emit-site audit table, tests, `git status` clean.
