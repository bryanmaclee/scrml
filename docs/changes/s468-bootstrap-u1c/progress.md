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

## 2026-10-17T23:40Z — step 1: the §13 gate + the server artifact (Core, analyze, lower, check, print, print-server, runtimes)

### Governing sentences (quoted)
- §13.2: "The compiler SHALL insert `await` at every call site where a server-generated fetch call is made." · "The
  compiler SHALL wrap any function containing at least one server call in an `async` function in generated code."
- §13.8 (S467, the one rule): "A waiting value SHALL stand only in one of two places: (i) At a suspension point of an
  action position, where the compiler awaits it. The action positions are … a function body (client or server) …"
  · "Everywhere else a waiting value SHALL be a compile error." · item 2 of "a waiting value": "a `?{}` query (§8),
  written in the position or reached through a function it calls".
- §13.4: "The callee SHALL NOT generate an additional HTTP route when called from a server-escalated caller." · "If
  function A (server-escalated) calls function B (server-escalated), and function B is also referenced from client
  code, the compiler SHALL generate TWO representations of B".
- §12.3: "For each server-escalated function, the compiler SHALL generate: A server-side route handler. … Serialization
  and deserialization for all arguments and return values." · route names: "the developer SHALL NOT reference,
  configure, or even observe it in scrml source."
- §12.5.3: "A generated route handler SHALL produce a COMPLETE HTTP RESPONSE, not a bare value … on every path".
- §8.1 / §8.2: "`${}` inside a SQL template SHALL be compiled to a positional bound parameter" · "If the same expression
  appears more than once in a single SQL template, the compiler SHALL assign it a single positional parameter slot …
  Complex expressions (function calls, member accesses) are NOT deduplicated unless they are syntactically identical."
- §19.9.1 / §19.9.2: the `fail` envelope `{ __scrml_error: true, type, variant, data }` and the status heuristic
  (NotFound 404, Auth/Forbidden/Unauthorized 403, Validation/Invalid 400, else 500).
- §39.2.3: "without `auth=`, baseline double-submit cookie helpers are auto-emitted on routes that mutate state."
- §57.4 (R10): the decoder on a compiler-internal route "SHALL be strict".
- U1 design §13 (S467, BINDING): "print-server SHALL NOT decide whether to await a call by looking at the callee's
  name … It prints what Core says." · "a Core `waits` fact on server Fns … `checkCore` re-verifies it (a new check
  C-S8s, or C-S8 widened to ServerFns). The printer emits `await` exactly at each Suspend".

### Locus (PA-located-verify) — traced
The brief's locus was the design doc's U1c row (print-server, srt, route, server-executor seam). Traced from the entry:
`print.scrml printProgram` printed the client half only; server bodies were lowered (`lower.scrml lowerServerFn`) with
queries as `Attempt(FSql)` and in-place server→server calls as plain `Call`s — no wait was represented in Core on the
server side at all (C-S1 forbade a Suspend in a ServerFn). So the hypothesis "U1c = a printer over the existing server
Core" was REFINED: the server half needed its waits made Core FIRST (the §13 gate), then the printer.

### What changed (one mechanism, each fact in one place)
- core.scrml: `Expr.Query(q)` (a query is a Suspend's `on`); `Failable.FSql` removed; `ServerFn.waits`.
- analyze.scrml: summary dimension `swaits` (own `?{}`, closed over CALLS — computed once); the suspension plan now
  covers SERVER bodies (server-placed + Trigger-5 inherited) with kinds `SQuery` / `SLocal(callee)` and the SAME
  position table as the client (refused: `&&`/`||` right operand, ternary branch, `!{}`/`match` arm, `defer` body,
  lambda, indexed-write value — amendment item 2 last bullet); §8.2 dedup decided on the syntax tree
  (`sqlParamKey` / `distinctSqlParams` / `sqlParamRep`) so a waiting value in a query is ONE slot evaluated ONCE.
- lower.scrml: queries lower to `Suspend(o, Query(q), [Attempt(…, FSettled(o), SqlError, …) …])`, in-place waiting
  calls to `Suspend(b, Call(f, args), …)`; server-side bodies through the continuation pass with no Return tail;
  `ServerFn.waits` / `Fn.waits` from the plan.
- check.scrml: C-S8s (ServerFn.waits ⟺ holds a Suspend; a call of a waiting Fn OR ServerFn only as a Suspend's `on`),
  C-SQL2 (a Query only as a Suspend's `on`), C-S7 extended to a Query (`SqlError` set) and to a `!` ServerFn callee,
  C12 widened (a server body is a continuation owner), C-S1: a Suspend is no longer client state (its `on` is judged —
  a ServerCall there still is).
- print.scrml: a server mode (`Ctx.server`): a Suspend prints `const b = await on;` + its `then` flattened, a Join's body
  follows its If, a Jump prints nothing — `await` is printed THERE AND NOWHERE ELSE; `queryJs` →
  `rt.query(db$<id>, mode, sql$<site>, [distinct values], [slots])`; the client artifact omits a function only server
  functions reach (design §2 "Trigger 5 is emission").
- print-server.scrml (NEW): `printServer(core) → { js, refused, routes }` — `manifest`, `route$<fn>` (the SAME
  `routeJs` tables as the client), `sql$<site>` texts frozen at load, `createServer(host$)` with one injected
  connection per database, the reached server/ambient functions (async iff Core waits), `rt.server(host$, [rt.route…])`.
- slice-m1/runtime/server-runtime.js (NEW): `connection` (host.connect, default Bun.SQL), `query` (bound values only,
  a driver error → a `SqlError` Failure + a server log line), `route` / `server` (POST only, §39.2.3 double-submit,
  strict decode → 400 before the body, 200 / 204 / the `fail` envelope with §19.9.2 status / a fixed 500 on a throw —
  a complete response on every path, built by `host.respond` or the global `Response`).
- slice-m1/runtime/runtime.js: `call` sends `X-CSRF-Token` from the `scrml_csrf` cookie and retries ONCE when a 403
  plants a new token; `CSRF_COOKIE` / `CSRF_HEADER` one definition (server-runtime.js imports them).
- js.scrml: `JAwait`, `SAsyncFunc`, `SExportConst`, `SExportFunc`.

### Readings flagged (for veto)
- R-a: a `defer` in a waiting SERVER function is NOT refused (the client refuses it): native `async` + the `try … finally`
  the printer already emits runs it at the real exit (§19.16.2). A `defer` body still cannot wait (C16).
- R-b: the waiting AMBIENT function (one a client root reaches that makes a client call of a server function) called
  from a server function stays REFUSED (E-BOOTSTRAP-UNSUPPORTED, message reworded): its two representations differ in
  body, and Core holds one body per function. Non-waiting ambient functions ARE emitted per side.
- R-c: the server builds responses through `host.respond(status, headers, body)` when given (default: the host's global
  `Response`) — §12.5.3 binds observable behaviour, not a JS shape (S278).

### Evidence (executed)
- `bun test ./compiler/self-host-v2/` — 2347 pass / 1 todo / 0 fail (69 files; +66 = slice-m4/server-artifact.test.js,
  +1 C12 bite). `SLICE_CORE=lowered … slice-m1` 99/0 · self-host-v2-lexer 337/0 · lint-no-default-arm 0 violations.
- `bootstrap-conformance.ts` — identical to baseline (189/74/674/858; per-case diff empty).
- The await probes (slice-m4/server-await-probes.js, 31 shapes): 25 PASS (wrong → REJECTED, right → WELCOME), 6
  REFUSED at compile time (andRight, ternaryBranch, lambdaFilter, armBody, fnValueAlias → E-BOOTSTRAP-UNSUPPORTED;
  valuePosition → E-VALUE-SERVER-CALL). 0 FAIL.
- Bite: f's `Suspend(Call(check))` unsuspended → checkCore C-S8s RED; `check.waits` forced false → C-S8s RED; the
  unsuspended program printed anyway ANSWERS "WELCOME" TO A WRONG PASSWORD (the defect class, reproduced and gated).

## 2026-10-17T23:45Z — step 1 landed; measurements; step 2 (the server-executor seam + the server-db twins)
(Correction: the step-1 heading above says 23:40Z; it was written at ~23:25Z.)

### Direction of change + measured corpus impact (step 1)
- Classification: **inert for acceptance on every program the bootstrap compiled before**, except one deliberate
  **newly-rejecting** limb: a call of a function that WAITS ON THE SERVER, standing in a position that cannot wait
  (`&&`/`||` right operand, a ternary branch, a `!{}`/`match` arm, a `defer` body, a lambda, an indexed-write value)
  INSIDE a server-side body, is now E-BOOTSTRAP-UNSUPPORTED (before: accepted, lowered to a plain in-place call — the
  printer emitted no server artifact, so it never ran). Governing: §13.8 "Everywhere else a waiting value SHALL be a
  compile error" + U1 design §13 item 2 last bullet (the same refusal positions as the client).
- MEASURED (bootstrap front end, base = origin/main archive vs head, every `.scrml` under examples/, samples/,
  conformance/cases/, stdlib/ — 2840 files, each compiled alone): **0 files changed** (Error-code multisets identical;
  54 compile clean on both). `bootstrap-conformance.ts`: per-case diff vs baseline EMPTY.
- The impl#1 security-await pack (424 shapes) through the BOOTSTRAP front end, as written
  (slice-m4/server-await-pack.test.js): **424 / 424 refused at compile time** — every shape imports `scrml:auth`
  (no stdlib import in the bootstrap; E-IMPORT-NOT-EXPORTED 420, E-BOOTSTRAP-UNSUPPORTED 424) and uses the legacy
  dialect (E-PARSE-CLOSER / E-PARSE-UNCLOSED 424, untyped parameters). 0 compiled, so 0 could accept a wrong password.
  These refusals are NOT "the SPEC's code" (amendment item 4's pass criterion for a refusal); they are fail-closed, and
  the pass-criterion evidence is the bootstrap-expressible translation (server-await-probes.js: 25 PASS, 5 refused
  E-BOOTSTRAP-UNSUPPORTED — not-yet-lowered positions, fail closed —, 1 refused E-VALUE-SERVER-CALL — the SPEC's code).

### Step 2 — the server-executor seam + the server-db twins (executed)
- scripts/bootstrap-conformance.ts: `serverDb` is no longer a non-client key. A `serverDb` case's runtime half runs the
  client artifact against the bootstrap's OWN server artifact (`serverFetch`: print-server.scrml's `createServer` with
  `host.connect` = the case's database — `sqlEngine: "real"` → a fresh in-memory Bun.SQL SQLite, tables loose-inferred
  from the seed rows (impl#1's adapter rule; a `<schema>` case never gets here — the bootstrap refuses `<schema>`);
  otherwise impl#1's stub rule (a query answers its FROM table's rows); `host.respond` = plain records (the global
  Request/Response are happy-dom's and drop Cookie/Set-Cookie); the page at `http://localhost/` so `document.cookie`
  works; `settled()` waits until no request is in flight). URL contract: the MANIFEST (decision 1) — the seam never
  matches a URL shape.
- 10 new conformance cases, `conformance/cases/server-db/<case>-twin` — the §66 twin of each `<schema>`-less
  `sql-*-rt` case: the case's program, seed, clicks and asserted values (two cell SHAPES differ — a `T | not` cell the
  §66 opener cannot type yet is typed cells; said in each description). Bootstrap: **10/10 PASS (codes + runtime)**.
  impl#1 (`bun conformance/run.ts`): 4 PASS outright (aggregate-group, join-two-tables, order-limit, update-returning —
  no mark), 6 XFAIL on the carried gap `g-impl1-value-writes-state-codes-unimplemented-s449` (impl#1 does not parse
  the §66 `let <x:T=v/>` opener — E-MARKUP-001 / E-STATE-UNDECLARED / E-SCOPE-001), signatures captured with
  `--xfail-signature`. Two twins were re-shaped so impl#1's failure is ONLY that gap's: no `ServerCallError` in a type
  annotation (impl#1's OPEN `g-builtin-error-types-unknown-in-annotation-position-s466`), no `=-1` initializer
  (impl#1 E-ATTR-001). conformance (impl#1): 1728/1805 pass + 77 xfail (was 71 of 1795) — 0 fail.
- Counter: PASS 189 → **199** (exactly the 10 twins; per-case diff vs baseline: 10 NEW, 0 changed). Runtime half
  executed for 81 cases (was 71). `docs/bootstrap-conformance.md` regenerated; `--check` current.
- Counter tests: fixtures `runtime/server-db` (stub engine) + `runtime/server-db-real` (real engine), with two bites
  (a changed seed → FAIL on the state; the real-engine case on the stub engine → FAIL). 46/46.
- FACTS: conformance cases 1795 → 1805 (`facts.ts --write`; `--check` PASS). `state.ts --check`: gap-counts PASS;
  `@generated:recent-sessions (master-list.md)` STALE — not touched by this branch (master-list.md unchanged; the
  section is projected from session-WRAP commits, and this branch adds none), left for the PA's wrap.
- The 2 `<schema>` cases (insert-returning, unique-constraint) are graded by slice-m4/server-artifact.test.js only
  (the case's DDL created by the test; the bootstrap refuses `<schema>`), with the case's seed and assertions.
