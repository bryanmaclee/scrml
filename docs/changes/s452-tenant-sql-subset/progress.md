# progress — s452-tenant-sql-subset

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae4056a4a438b9cd8 (base 38ec5fcab)
- repros executed on base (two seeded tenants, emitted handlers in-process): C1 dq/bracket callee + "count"(*) leak to pinned A; C2 ;SELECT / ;DELETE / ;UPDATE cross-tenant read/delete/update; C2 (SELECT)/TRUNCATE/MERGE/EXPLAIN compile (SQLite syntax error at runtime; PG-only); C3 leaks; H1 x3 compile (SQLite runtime error; PG-only); H2 x2 re-own B's row for A; H3 x2 forge B ownership; M1 compiles (SQLite runs first stmt only; PG unverified). C1 backtick spelling is not representable in the backtick ?{} body (ends at the first backtick) — reachable only in the bare spelling.
- 5e6b39b92 code+tests: tenant-sql-subset.ts (closed-token lexer + statement grammar); tenant-egress.ts / rewrite.ts wired to the one analysis; UPDATE/DELETE now WHERE-injected; new E-TENANT-SQL-SUBSET. All repros refused (executed). Gate: 28131 pass / 58 skip / 0 fail.
- pushed 12825558d (+ known-gaps 521fcb25b, FACTS regen).
- fix round r4 — security review of 12825558d: FIX (narrow). BRIEF-r4.md archived. Items: OR ABORT on injected writes; triggers / cascading FKs refuse writes; query-to-SQL functions (allow-list in exempt queries + any-query rule); file 3 gaps.
