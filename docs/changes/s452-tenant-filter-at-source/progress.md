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
