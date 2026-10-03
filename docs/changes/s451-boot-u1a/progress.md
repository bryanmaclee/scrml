# s451-boot-u1a progress

- 2026-10-03T16:49:28-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ad6cd418779d1459c (base ce00c296a)
- 2026-10-03 baseline: `bun test ./compiler/self-host-v2/` 1358 pass / 0 fail; `bun scripts/bootstrap-conformance.ts`
  PASS 91 · FAIL 57 · UNSUPPORTED 641 (bootstrap-unsupported 379 · parse-reject 262) · NOT-TWINNED 511.
- 2026-10-03 stage 1 (053998cf0): parse `?{}` + chain, the `server` / `!` flags, Ue refusals; Core Expr.Sql /
  SqlQuery / Db / ServerFn.ret / CoreProgram.dbs; check C-SQL1, C-S1..C-S4; the printer refusal.
- 2026-10-03 stage 2 (2e0ce67f1): `sql.scrml` (the fact scanner), analyze `placePass`, lower ServerFn + Expr.Sql.
- 2026-10-03 stage 3: slice tests `slice-m4/server.test.js` (83), both bites proven and restored; the conformance
  script reads a printer refusal as UNSUPPORTED. Bootstrap tests 1441 pass / 0 fail. Counter: PASS 92 · FAIL 57 ·
  UNSUPPORTED 640 (bootstrap-unsupported 419 · parse-reject 221).

## What U1a builds (front end + Core, no emission)

- **parse** — `?{ `…` }` read from the ONE lexer's template tokens (the lexer's fold already is §44.8's bracket-
  matched scanner: template / `${}` frames / strings / brackets); the chain `.all()` / `.get()` / `.run()` /
  `.nobatch()` absorbed into `AExprK.Sql(ASql)`; `?{` is a sigil, never a ternary `?`. `server function` / `server fn`
  → `AFn.server`; `function f()! …` → `AFn.failable` + refusal; `expr !{ … }` and `match ?{…} { … }` → refusal.
- **sql.scrml** — `sqlFacts(chunks)`: kind (SqlSelect / SqlWrite), reads / writes (TablesKnown / TablesUnknown),
  columns (ColsAll / ColsListed / ColsNone / ColsUnknown), createsTable (§8.1.1 Ownership). Fail-closed rules in its
  header.
- **analyze placePass** — per-function direct facts (`?{}` sites, cell reads, writes via the effect rule's BodyScan,
  DOM-global roots), placement Ambient / Client / Server / Split, client reach / unresolved reach / async color as
  fixed points with witness chains; the program's Dbs; every diagnostic below. Facts in `Tables.server`
  (`servers`, `sqls`, `dbs`, `places`).
- **lower** — a Server-placed function → Core `ServerFn { sym, params, ret, body }`; a `?{}` → `Expr.Sql(SqlQuery)`
  with params DEDUPED by structural equality of the lowered Expr (§8.2) and slots in first-appearance order.
- **check** — C-SQL1, C-S1 (incl. through a called Fn), C-S2, C-S3, C-S4.
- **print** — `Output.refused`: a program with a ServerFn (or any query) prints NOTHING, naming U1c.

## Governing sentences (quoted; SPEC @ ce00c296a)

- §8.1 "`${}` inside a SQL template SHALL be compiled to a positional bound parameter … SHALL NOT be compiled to
  string interpolation under any circumstance." → `ASql.chunks`/`params`, Core `chunks`/`params`/`slots`: no node can
  carry a value into SQL text (E-SQL-001 unrepresentable).
- §8.2 "If the same expression appears more than once in a single SQL template, the compiler SHALL assign it a single
  positional parameter slot and reuse that slot at every occurrence." · "starting at `?1` … in order of first appearance".
- §8.3 / §44.3 "`.prepare()` is **removed** … SHALL be compile error E-SQL-006"; "`.all()` (or bare `?{}`)".
- §8.6 E-SQL-003 "SQL template content is a runtime expression, not a literal string template"; §8.4 example
  ``?{`${sql}`}`` → E-SQL-003.
- §44.8 "the compiler SHALL emit `E-SQL-008` with the source offset of the offending `?{`."
- §8.1.1 "If no ancestor `<program>` has a `db=` attribute, the `?{}` block SHALL be a compile error (E-SQL-004)" ·
  "An unrecognized prefix SHALL be a compile error (E-SQL-005 …)" · "A plain path without prefix … SHALL be treated as
  `sqlite:./app.db`" · "A `file:` URI is not a path and SHALL be E-SQL-005" · the table's `mongo*` "NOT VALID for `?{}`" ·
  Ownership "it has a `?{}` block holding a statement that creates a table … A `TEMP` / `TEMPORARY` table does not count".
- §12.1 "The compiler SHALL decide where each function executes. The default is client-side execution."
- §12.2 T1 "The function accesses a resource not accessible from the client" with §8.5.4 "any function that contains a
  `?{}` block is server-escalated"; T4 "an explicit `server` annotation (§52.10). **DEPRECATED**".
- §52.10 "During the deprecation window, the parser SHALL accept `server function` declarations and emit
  `W-DEPRECATED-SERVER-MODIFIER`".
- §19.9.5 "A function whose body mixes a server-trigger statement with a reactive-assignment statement is split across
  the client/server boundary" + §6.6.9 "A function that also performs a reactive assignment (`@cell = …`) is CPS-split —
  a CLIENT function with an embedded server round-trip." → Split, refused (U1d).
- §6.6.9 "A WHOLLY server-escalated function body that READS a client cell … SHALL be a compile error, E-REACTIVE-003."
- §34 E-RI-002 "Server-escalated function mutates `@` reactive variable" (+ §12.4 R2's "keeps its own codes
  (E-REACTIVE-003 for a read, E-RI-002 for a write)").
- §12.4 (R2) "A server-escalated function whose static call graph reaches such an access through a callee, directly or
  transitively, SHALL be E-ROUTE-002, and the message SHALL name the chain down to the function that touches the cell
  and the cell itself."
- §12.4 (R3) "A function that the compiler cannot fully analyze for route placement SHALL be a compile error (E-ROUTE-001)."
- §12.4 E-ROUTE-005 "A *single* function whose own body accesses BOTH a server-only resource … AND a client-only
  global (a DOM global with no server-side referent) … (`document`, `window`); an access rooted at a name bound by an
  in-scope local, parameter, or import is a domain object, not the global".
- §12.5.3 E-ROUTE-003 / E-ROUTE-004 (non-serializable return / parameter; "a live **state object** (has identity, is
  not a value)").
- §13.7 (R1) "A **value position** … SHALL NOT contain an expression whose value arrives only after the program waits"
  — items 1 (server call), 2 (a client function that reaches one), 3 (a `?{}` in the position); item 4 (a Promise-
  returning stdlib call) has no bootstrap source form (no stdlib imports).
- §19.8.3 (R11) "Outside a `!` function it is treated exactly like a call to a `!` function whose error type is
  `SqlError` (§19.4.3): its result SHALL NOT be ignored, and an unhandled `?{}` SHALL be a compile error, **E-ERROR-002**."
  · "'No row' is not a failure" (nothing to implement: no failure model yet).
- §2.2.1 any error → no artifact: lower.scrml's gate, unchanged.

## Codes

Implemented: E-SQL-003, E-SQL-004, E-SQL-005, E-SQL-006, E-SQL-008, W-DEPRECATED-SERVER-MODIFIER, E-ERROR-002 (for
`?{}`), E-VALUE-SERVER-CALL (items 1-3), E-ROUTE-001, E-ROUTE-002 (cell limb R2 + DOM limb), E-ROUTE-003, E-ROUTE-004,
E-ROUTE-005, E-REACTIVE-003, E-RI-002; parse-level E-PARSE-SQL-CHAIN (an argument to / a second terminator in the chain).

Refused (E-BOOTSTRAP-UNSUPPORTED, naming the slice): a Split function (U1d); a `?{}` in a handler / `<effect>` body
(U1d); a client→server call from a function, handler or effect (U1b); the printer, any program with a ServerFn (U1c);
a payload-enum server parameter / return (codec has no R8 shape yet — U1c); `!` signatures, `!{}`, `match` on a query
(Ue); a `?{}` in an imported module (module-with-db-context, §44.7.1); a non-literal `db=`; `<x server>` (already
refused, §52 — outside U1); `<db>` (already refused — see "Design divergences").

## Bites (proven, restored)

1. `sql.scrml` `kindOf` forced to `return SqlKind.SqlSelect` → `server.test.js` 3 RED (the INSERT-is-SqlWrite test, the
   UPDATE/DELETE test, the fail-closed test). Restored → green.
2. check.scrml C-S1's per-node report disabled → the C-S1 graft test RED. Restored → green.

## Design divergences / findings (recorded, not silent)

- **E-REACTIVE-003 / E-RI-002 vs the design's §2 table.** The table makes any S≠∅ ∧ C≠∅ function Split, which leaves
  "A Server fn reads a client cell → E-REACTIVE-003; writes one → E-RI-002" unreachable. SPEC decides: a split is
  triggered by a reactive ASSIGNMENT (§6.6.9, §19.9.5), so reads alone leave a function WHOLLY server (E-REACTIVE-003);
  a write splits it — unless the deprecated `server` modifier declares the whole body server (§52.10 "historically
  forced server-side execution"), where a write is E-RI-002. The legacy pin `server-db/server-fn-writes-reactive-cell-pos`
  (query + `@count = rows.length`, expects E-RI-002) is impl#1's CPS-eligibility answer; under §19.9.5 the same shape is
  a split (refused, U1d).
- **E-ROUTE-005 vs the design's §2 table.** The table assigns E-ROUTE-005 to a Split body with a "mixed" statement;
  §12.4 defines E-ROUTE-005 by a DOM global ONLY (and R2 left E-ROUTE-005's root set narrow). U1a fires it per SPEC
  (`document` / `window` unbound, in a server-triggered body; the binder's E-SCOPE-001 for that name is dropped so it is
  reported once). The bootstrap still has no DOM API: elsewhere `document` stays E-SCOPE-001.
- **`<db src=>` → Db NOT built.** The `<db>` element is a state block carrying `tables=` schema-derived types (§14.8)
  and `protect=` (§52) the bootstrap does not build — accepting it with only `src=` would ignore both (fail open). And
  §8.1.1's Ownership bullet ("every `?{}` in a file runs on the file's default database — its first `<db src=>` in
  document order") reads differently from its resolution bullet ("the closest ancestor `<program>` element with a
  `db=` attribute") — a SPEC question for whoever lands `<db>`. `<db>` stays refused (its pre-existing message).
- **Query facts recorded at ANALYSIS, not lowering** (design §1 "recorded at lowering, once") — the bootstrap's
  convention is analyze decides, lower copies; same "once", same consumer.
- **The kind scan fails closed on FUNCTIONS too** (beyond design §1's verb list): a SELECT calling a function outside a
  known read-only list (`nextval`, `setval`, a user function) is SqlWrite (R4 "provably read-only"); `INTO` counts as
  a write verb (`SELECT … INTO t` creates a table on Postgres); a write's reads include its own target.
- **A query result has no row type.** §14.8 schema-derived types are not in the bootstrap, so `.get().n` /
  `.all().length` is refused by the binder's generic member-access refusal. Moot in U1a (every query is E-ERROR-002
  until Ue), owed with the row-type unit.
- **U1b refusal over-reach.** A non-server helper calling a server function is refused even when only server
  functions call the helper (§12.2 T5 would make it server-only by emission). Fail closed; U1b/U1c revisit with
  routed-ness.
- **E-ROUTE-001 is reported for a server-placed function** whose call graph reaches an unresolvable call (directly or
  through non-server callees). A client function's placement is complete regardless, so it is not reported there; a
  value position reaching one is already E-VALUE-WRITE-UNPROVEN (§6.15, fail-closed).
- **impl#1 finding (file a gap):** impl#1's expression pre-scan (`expression-parser.ts`
  `replaceSqlBlockPlaceholder`) rewrites a `?{` found ANYWHERE in an expression — inside a string literal too — into its
  SQL placeholder, so a bootstrap message containing the sigil came out as `__scrml_sql_placeholder__`. Workaround: the
  sigil is spelled `"?" + "{"` (`sqlSigil()` in parse / analyze / check / print). Proposed id:
  `g-impl1-sql-placeholder-rewrites-string-literals`.
