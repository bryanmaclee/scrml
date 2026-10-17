# s468-bootstrap-u1c — progress (append-only, timestamped)

## 2026-10-17T22:45Z — start
- WIP(s468-bootstrap-u1c): start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-aae3dbcfc2fe1ae91
- base = origin/main `1f1b5be4e` (merge-base == origin/main verified). Branch `s468-bootstrap-u1c`.
- Policy limb (S435): BOOTSTRAP — all language work in `compiler/self-host-v2/`; impl#1 untouched.

### Baseline (base 1f1b5be4e)
- `bun test ./compiler/self-host-v2/` — 2280 pass / 1 todo / 0 fail (68 files).
- `bun scripts/bootstrap-conformance.ts` — 1795 attempted: PASS 189 · CODES-ONLY 0 · FAIL 74 · NOT-TWINNED 674 ·
  UNSUPPORTED 858 · CRASH 0. server-db area (81): NOT-TWINNED 19 · UNSUPPORTED 62 · PASS 0. All 12
  `server-db/sql-*-rt` runtime cases are NOT-TWINNED (the §66 twin generator cannot type their legacy cells:
  "`not` initializer needs a type", "empty `[]` needs an element type", "written sequence grants" — O35 / CTX).

### Read (mandated)
- U1 design (incl. the BINDING §13 amendment, S467), arc plan (U1 row), U1b design (Items 1–5), U1b progress
  (#1303), SPEC §12.1–§12.6, §13.1–§13.4, §13.8, §13.9.6, §19.9.1–§19.9.4, §39.2.3.

### Decisions taken before code (each a reading of the governing text, flagged)
1. **URL contract (arc plan ⚑):** the bootstrap keeps ITS OWN matcher — the route MANIFEST (`Output.routes`,
   U1b #1303: `{ fn, path: "/_scrml/call/<sym id>", value }`). It does NOT emit impl#1's
   `/_scrml/__ri_route_<name>_<n>` shape (U1 design §4 recommendation; §12.3 "the developer SHALL NOT reference,
   configure, or even observe it"). The conformance seam matches by the manifest (the U1b stub already does).
2. **The §13 gate mechanism:** the DEFAULT, not the fallback — a Core `waits` fact on server functions. Every
   wait point in a server-side body (a `?{}` query; an in-place call of a server-side function that waits) is a
   `Stmt.Suspend`; a query becomes `Expr.Query(q)`, legal ONLY as a Suspend's `on` (the `Failable.FSql` call of
   Ue becomes `Suspend(o, Query(q), [Attempt(FSettled(o)) …])` — "Suspend waits, Attempt inspects", one shape on
   both sides). `ServerFn.waits` / `Fn.waits` ⟺ the body holds a Suspend (C-S8 widened to ServerFns = C-S8s);
   a call of a waiting function stands only as a Suspend's `on` (counted, as C-S8 already does for Fns). The
   transitive fact is ONE summary dimension (`swaits`), the planner turns it into suspension points with the
   SAME position table as the client (amendment §13 item 2 last bullet), and print-server emits `await` at
   each Suspend and nowhere else. CPS (body split) is OUT of U1c: the design puts it in U1d (row U1d), and
   U1c keeps Split refused.
