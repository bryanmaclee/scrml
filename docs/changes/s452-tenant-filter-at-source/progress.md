# progress — s452-tenant-filter-at-source (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a882b142eb7a8e6ef (base d23e6cc6d = origin/main)

## SPEC sentences relied on / superseded (read at base d23e6cc6d + amended spec branch 98698f44)

Relied on (base §14.8.10, unchanged by the amendment):
- "The floor CONSUMES an app-established session scalar `@currentUser.tenantId` and NEVER computes one."
- "`@currentUser.tenantId is not` (anonymous / unpinned) → the redact predicate matches **zero rows**"
- ".acrossTenants() ... is the **only** way to emit an unscoped read against a tenant-scoped table"
- E-TENANT-AGG / E-TENANT-WRITE / E-TENANT-RAW-EGRESS hard-fail bullets (kept as is).

Superseded by ruling S452 "a" (base text):
- "**Redaction is the guaranteeing FLOOR.** ... at the client-egress sink, every row whose `tenant_id` ≠ the ambient `@currentUser.tenantId` is dropped"
- "This **inherits §14.8.9's entire soundness argument verbatim**"
- Soundness scope: "It does **NOT** cover: ... derived/implicit flows (a value computed *from* tenant rows but of independent identity)"
- "An unresolvable dynamic read degrades to redact-at-sink"
- I-TENANT-STRIP: "the egress sink dropped one or more non-matching-tenant rows"

Amended SPEC (spec/s452-tenant-filter-at-source 98698f44) readings to implement: (1) .get() first row AFTER filter; (2) LIMIT/OFFSET before filter (accepted short-read); (3) JOIN: every tenant source must match, NULL never matches; (4) tenant table only in subquery/CTE/derived → E-TENANT-AGG; (5) unresolvable → zero rows; (6) floor-added key column removed after filter; (7) outside any request → zero rows; (8) watches= per-subscriber filter at published frame.

## Findings while mapping emit sites (base)
- rewrite.ts rewriteSqlRefs + emit-logic.ts case "sql": `.get()` tags `(await q)[0] ?? null` — first row BEFORE the filter (contradicts reading 1).
- `.run()` and bare `?{SELECT…}` used as a value: NO tenant tag at all (pre-existing leak; egress redact passes untagged rows).
- Peer callables (`async function inner()` "in-process peer callable") have no `_scrml_req` in scope → the tenant key must come from a request-scoped store, not the lexical `_scrml_req`.
- JOIN: only the FIRST tenant-scoped FROM table is keyed (`scopedFrom[0]`) — a second tenant table's foreign rows join through (pre-existing leak vs reading 3).
- Subquery in WHERE / projection over a tenant table with a non-tenant FROM: no floor at all (resolvable, fromTables has no tenant table).
C4 BEFORE (base d23e6cc6d, executed in-process via .tmp harness): unpinned rowsOut 200 [] / unpinned namesOut 200 ["A-secret-asset","B-secret-asset"] / pinned A rowsOut [{id:1,...A}] / pinned A namesOut ["A-secret-asset","B-secret-asset"]
- C4 AFTER (branch, same harness): unpinned rowsOut [] / unpinned namesOut [] / pinned A rowsOut [A row] / pinned A namesOut ["A-secret-asset"].
- S354 globalThis.Response evasion: base unpinned + pinned A both served A and B rows; branch: [] / [A row only].
- Suite: base d23e6cc6d 27930 pass / 58 skip / 0 fail; branch 27957 pass / 58 skip / 0 fail / 0 error.
- Corpus differential (examples, samples/compilation-tests, conformance/cases, compiler/tests/conformance/cases, stdlib; 2249 .scrml, each compiled alone, server JS normalized for the tree path): 2249 identical, 0 changed, 0 tenant-active files.
- Found, not fixed: INSERT tenant injection uses lexical `_scrml_req` → ReferenceError inside an in-process peer callable (pre-existing; fails closed, 500).
- Landed: d87d4bb4d (code+tests), ccea4639d (known-gaps). master-list.md recent-sessions hunk from state.ts --write reverted per brief.

## fix round r2 (BRIEF-r2.md; review of 1239366814c)
- start r2 at 1239366814c
- r2 repros (conf-TENANT-SOURCE-FILTER "r2" blocks), each EXECUTED against two seeded tenants: on 1239366814c 17 of the r2 cases fail (H1 ×3, H2, H3 json_group_array + unknown fn, L2 window, H4 `GROUP BY cost > 0 ORDER BY tenant_id`, L1 `SELECT *, 'A' AS tenant_id` + reserved alias, L3 literal false positive, INSERT ×5); all pass on the fix.
- H4 note: the reviewer's literal `ORDER BY tenant_id` with NO GROUP BY was already E-TENANT-AGG at 1239366814c (the loose regex needs a GROUP BY somewhere); the live bypass is `GROUP BY <other> … ORDER BY tenant_id` — that is the pinned repro.
- Found in the audit (not in the review): the E-TENANT-AGG / E-TENANT-WRITE scan read only the backtick spelling `?{\`…\`}` from source text — `?{ select count(*) … }` and `?{ update assets … }` compiled clean and ran unscoped / unconstrained. Moved both refusals to the lowering choke (`_lowerTenantForQuery`), which every spelling passes through. Also: a `kind="tool"` program lowered SQL with the tenant floor unarmed.
- DISTINCT is refused on a tenant read per the brief's allow-list (it is provably safe once the reserved per-source key is in the projection; flagged for the owner, not relaxed).

### SQL emit-site audit (compiler/src/codegen, `.unsafe(` + raw sql tags + every emitLogicNode server lowering)

| site | before r2 | after r2 |
|---|---|---|
| rewrite.ts `rewriteSqlRefs` (all terminators + bare `?{}`) | scoped | scoped |
| emit-logic.ts `case "sql"` (branches A/B/C + no-chain `.unsafe`) | scoped | scoped |
| emit-server.ts §52 `/__serverLoad` Tier-1 `SELECT *` hand site | scoped | scoped |
| emit-server.ts SSR-seed Tier-1 hand site; Pattern-C via emitLogicNode | scoped | scoped |
| db-authoritative.ts `wrapPrincipalTxn` (rewrites `_scrml_sql.unsafe` → `tx.unsafe` inside an already-scoped expression) | scoped | scoped |
| **emit-control-flow.ts:1071 §8.10 loop-hoist IN-query `.unsafe(...)`** | **UNSCOPED (H2)** | refused for any query touching a tenant table → per-iteration scoped query |
| **emit-tool.ts generateToolJs / serve-harness extras / generateToolLibraryJs** | **UNSCOPED (floor unarmed)** | armed from the file's `<schema>`: reads zero rows (no request), INSERT refused at runtime, E-TENANT-AGG/WRITE at compile |
| **emit-server.ts E-TENANT-AGG/WRITE source scan** | **backtick spelling only** | decided at the lowering choke (every spelling) |
| emit-channel.ts:1082/1084 `watches=` re-SELECT → :1090 `_server.publish` (Postgres LISTEN) | unscoped | unscoped — reading 8 (per-subscriber filter), Postgres-only, gap updated, NOT fixed per brief |
| emit-channel.ts:1035-1037 trigger DDL | n/a | n/a |
| emit-server.ts `_scrml_idempotency_keys` reads/writes | n/a (internal table) | n/a |
| emit-server.ts / emit-logic.ts BEGIN / COMMIT / ROLLBACK; sql-tx-guard savepoints + proxy | n/a (control) | n/a |
| db-authoritative.ts `set_config` / `SET LOCAL ROLE` | n/a (control) | n/a |

Residual (tool mode): a tool library whose tenant tables are declared only in ANOTHER file, or only through a `<db>` registry, is not armed (tool emit has no protect registry). Filed in the r2 gap entry.
