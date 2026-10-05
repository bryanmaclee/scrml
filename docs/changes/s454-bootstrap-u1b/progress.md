# s454 bootstrap U1b — progress (append-only)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4f8638bf1914ccea
base: 859f60f79 (contains #1295 b13fd9064, #1298 96751008d)

## Baseline (base 859f60f79)
- `bun test ./compiler/self-host-v2/` — 1917 pass / 1 todo / 0 fail (56 files).
- `bun scripts/bootstrap-conformance.ts` — 1312 attempted: PASS 121 · CODES-ONLY 0 · FAIL 48 · NOT-TWINNED 514 ·
  UNSUPPORTED 629 · CRASH 0 (per-case JSON kept in .tmp/counter-before.json for the before/after diff).

## Map
- `.claude/maps/primary.map.md` (stamp 7ce905ac2) — LOAD-BEARING for one fact: "the bootstrap's write / placement /
  binder rules read ONE effect summary per callable … add a new transitive fact as a summary DIMENSION, not a new
  walker". U1b's transitive questions (async colour, Trigger-5 inheritance, client caller of a helper) are summary
  queries; the per-site position plan is not transitive. The routing rows say nothing else about self-host-v2.

## Governing text read in full
SPEC §19.9.10 (as amended by #1298), §19.9.5, §19.4.3, §19.5.3, §13.7, §57.8; design Items 1-5; user-voice §S454.

## [U]/[I] markers checked against source (before building on them)
- [U] design §2.2 "a body-top statement … when a body-top block exists in the bootstrap" — FALSIFIED as a position:
  the bootstrap AST has no body-top statement (AItemK = Import/Type/Fn/Decl/Markup/Program; no statement item). The
  position does not exist, so nothing is lowered or refused for it.
- [U] OQ1 "is `return` legal in an event-handler body" — settled by SPEC (#1298 quotes §5.2.3); in the bootstrap a
  braced handler is a block parsed by the statement grammar (handlerBlock → lowerBlock), so `return` parses there.
- [I] design §1.0 "fetch has none [deadline] by default" — superseded by S454 F3 (the runtime SHALL apply a deadline).
- [R-checked] C1 claims: `suspend` runs `k` untracked, NOT batched, and re-throws a rejection on a live task — TRUE
  (runtime.js `suspend`). `on` runs the handler as one batch — TRUE. Codec (#1295) `decodeError` exists, unused — TRUE.
- [R-checked] "the summary has `places`/`waits`" — TRUE; placement has NO Trigger 5 at all (direct + ambient→client by
  client reach only) — U1a's own note "U1b refusal over-reach … §12.2 T5" confirms. Trigger 5 is built here.
- [I] design 3.2 "Malformed.reason … the codec never echoes a whole foreign value" — codec `show()` bounds strings to
  40 chars and never prints an object/array body; keys through keyText (bounded). Verified by reading runtime.js show/keyText.

## SPEC-vs-design conflicts (SPEC wins)
- Design §1.0 "No timeout variant … fetch has none by default; if a deadline is ruled later, `TimedOut` is added".
  SPEC §19.9.10 (S454): "The client runtime SHALL apply a deadline to every client call of a server function. A call
  that has not produced a response when its deadline passes SHALL fail with `Unreachable` — there is no separate
  timeout variant". → built: a deadline, exceeding it is `Unreachable`.
- Design §1.6 F5 (a): "at a site that turns out server→server a `.Transport` arm is dead (reported like E-ERROR-013's
  dead handler)". SPEC: "When the callee is not declared `!`, the whole handler is attached to a call that cannot fail
  and is **E-ERROR-013**. When the callee is declared `!`, only the `.Transport` arm is dead; it SHALL be reported as
  dead handling in the manner of E-ERROR-013 (the message names the callee and says the call is server→server)."
  → built per SPEC: whole handler E-ERROR-013 for a non-`!` callee; the `.Transport` arm reported (code E-ERROR-013,
  message names the callee + server→server) for a `!` callee.
- Design §2.2 "a function NAMED as a value → E-ASYNC-FN-ESCAPES-AS-VALUE when the function waits". The bootstrap
  refuses EVERY function value already (E-BOOTSTRAP-UNSUPPORTED, "function values arrive with a later slice"); a `!`
  one is E-ERROR-002. Kept (fail closed, a superset); not a SPEC conflict.

## Plan (what is built where)
- analyze phaseA: built-in `ServerCallError`; per own-server-triggered callee its remote failure enum (`E + Transport`
  minted per declared enum, `E` itself when it declares `Transport(t: ServerCallError)`, one shared `Transport` for
  non-`!` callees); FnInfo.serverOwn (§12.2 T1/T4, syntactic — the design's phaseA own-trigger fact).
- binder: a call of a serverOwn callee is judged by its SITE: an own-triggered server caller = server→server
  (unchanged local rules); a handler / effect = remote; a function body with no own trigger = PENDING, decided in
  rulesPass from the whole-program placement (F5 a). E-ERROR-016 at a remote site.
- summary: Trigger-5 inheritance (greatest fixpoint over the reference graph; a client position or a construction /
  formula reference disqualifies); `waits` edges of an inherited function cut (its calls are in place).
- a post-summary SUSPENSION PLAN (per site, not transitive): which call sites suspend (remote handled forms, calls
  of waiting client functions), position verdicts (refusals named), and the binder-minted Syms lower needs (outcome,
  join, ANF temps).
- lower: Expr.ServerCall / Failable.FSettled / Stmt.Suspend+Attempt / Join+Jump (CPS pass), Fn.waits.
- check: C-S3 (+ T5 re-derived from Core), C-S7, C-S8, C-E1/C-E2 extended, C12 widened.
- print + runtime: rt.call (deadline, Item-3.2 classification, never rejects), suspend in batch + one reporter,
  handler tasks, waiting functions return a Promise; the client artifact of a program with server functions.

## S1 — DONE (ServerCallError, the client-call failure enums, E-ERROR-016)
- analyze `builtinTypeDecls` + `builtinTyped`: the built-in `ServerCallError` = `Unreachable` · `Refused(status: int)`
  · `ServerFault(status: int)` · `Malformed(reason: string)` (§19.9.10 S454). A user `type ServerCallError` is
  E-BOOTSTRAP-REDECLARE (the `SqlError` precedent; "the developer SHALL NOT redefine it"). `renders` NOT modelled —
  the bootstrap AST has no `renders` on a variant (same as SqlError), and no bootstrap surface displays one (no
  `<errorBoundary>` / `<formFor>`). OWED with the boundary unit; flagged in the report.
- FnInfo += `serverOwn` (§12.2 T1/T4, syntactic, phase A — the design §2.5 own-trigger fact) and `rerr` (the remote
  failure enum). `remoteEnums` (phase A, after the functions): per declared enum ONE minted `E + Transport` (E's
  variants first, same indices, fresh Syms; then `Transport(t: ServerCallError)`), `E` itself when it declares exactly
  `Transport(t: ServerCallError)` ("that variant IS the wrapper"), ONE shared `Transport` enum for every non-`!`
  callee; `not` (and E-ERROR-016 at the client site) for a `Transport` of another payload or none. Minted enums live
  in the built-in file, so Core ships one only when it names it.
- E-ERROR-016 (`transportConflict`), at the client call site; message names f, its enum and `(t: ServerCallError)`.
  The bootstrap's code; `severity.scrml` regenerated (`bun scripts/gen-bootstrap-severity.ts`) — "E-ERROR-016 — no §34
  row" (fail-closed Error). In S1 it rides the existing U1b refusal loops; S2 moves it to the binder's site judgement.
- Tests: NEW `slice-m4/server-call.test.js` (11). `bun test ./compiler/self-host-v2/` 1928 pass / 0 fail.
- DOGFOOD FINDING (impl#1, file a gap): a narrowed local `const known: Sym | not` read after `if (known is some)`
  compiled to `_scrml_known_907` — the mangled name of the top-level `fn known(ty)` in the same module. impl#1
  resolves a local that shares a module function's name to the FUNCTION in that position (a silent mis-bind). Worked
  around by renaming the local (`prior`). Proposed id: `g-impl1-narrowed-local-shadowed-by-module-fn`.

## S2 — DONE (Core, the site judgement, lowering positions)
- Core: `Expr.ServerCall(fn, args)`, `Failable.FSettled(outcome)`, `Stmt.Join(k, body)` / `Stmt.Jump(k)`,
  `Fn.waits`, `CoreProgram.serverCallError`. walk / measure / ingest / check / print totality arms.
- Binder (analyze): FailCtx += fnSym / serverOwn. A call of a server-triggered callee is judged by SITE
  (`siteOf`): own-triggered server caller = SiteLocal (server→server, the callee's own set); handler / effect =
  SiteRemote; a function with no own trigger = SitePending → `PendRule.RemoteOr(caller, remote, local)` decided in
  rulesPass from the WHOLE-PROGRAM placement (F5 a); a value position = SiteValue (E-VALUE-SERVER-CALL only, "not
  reported a second time as E-ERROR-002"). `remoteHandled` resolves arms against the client set (E's variants first,
  then Transport); totality (`coverDiags`) per set; server→server: a non-`!` callee's handler is E-ERROR-013, a `!`
  callee's `.Transport` arm is reported dead (E-ERROR-013 code, message names the callee + server→server — the SPEC
  wording). `?`: E-ERROR-010 with the SPEC message naming `Transport(t: ServerCallError)` + the enclosing enum; no
  E-ERROR-004 on a client call of a non-`!` callee. `remoteUnhandled`: E-ERROR-002 (E-DEFER-UNHANDLED-FAILABLE in a
  deferred statement). A handler REFERENCE to a server function: E-ERROR-002. PendRule.ServerOrDead + the U1a
  `u1bText` refusals are gone (the binder judges every client call).
- Summary: Trigger 5 (`inheritedFns`, greatest fixpoint over the reference graph; client positions — handlers,
  effects, value positions — and constructions / formulas disqualify); `waits` edges of an inherited function cut;
  `clientCauses` — the client referrer of a helper a server function also calls, named with file:line (FileAst gains
  `lines`, parse.scrml `lineStarts`) and appended to every remote diagnostic RemoteOr raises in that helper.
- A server function (or an inherited one) calling a client function that WAITS → E-BOOTSTRAP-UNSUPPORTED naming U1c
  (per-side emission of an ambient function).
- The SUSPENSION PLAN (`planPass`, post-summary, per site — not transitive): suspension points (remote handled forms,
  calls / handled calls / handler references of waiting client functions), position verdicts (lowered: whole value,
  argument, operand, element, condition, `if`/`given` branch → Join; refused, named: `&&`/`||` right operand, ternary
  branch, `!{}`/`match` arm, `defer` body, any `defer` in a waiting function, lambda, indexed-write value), minted
  temps (ANF: every non-literal sibling evaluated before a later suspension) and join continuations; `waiting` = the
  client functions with a suspension point (Fn.waits); `rets` = the wire type of a routed callee that declares none.
- READING (flagged): a `!` function has no success-type slot (§19.4.1 "its success type is inferred from its
  returns", §19.4.2), so the client's decode type for a routed `!` callee is the ONE type all its `return`s carry by
  the typer's proven types (`provenReturn`); not provable → refused at the client call site, named. A non-`!` callee
  with no `-> T` gets the same inference; a no-value callee is the 204 contract.
- Lower: `lowerExpr` substitutes temps / binds; `hoistExpr` emits Lets + `Suspend(bind, ServerCall|Call, [])` (+ the
  `Attempt(FSettled)`) before the statement in the planner's order; `attemptOf` picks the effective set (`effErr`:
  the callee's own enum when the caller turned out server-placed) and adds the Transport retag on a client call;
  `cpsBody` moves each block's rest into its Suspend / Join markers (Join before the If, Jump(k) at every branch end;
  a waiting function's paths all end in `Return(not)`). ServerFn.ret = declared or the plan's proven type.
- Print (needed for S2 to compile; exercised in S4): Return / Fail through `ret$` in a waiting function, Join / Jump,
  `rt.call(route$f, [args], task$)`, a waiting function takes `task$` and returns `rt.waiting((ret$) => …)`, handlers
  that suspend take `task$`, route constants + `Output.routes` (manifest), the U1c refusal of a program with server
  functions lifted (client artifact only), server-only (T5) functions omitted.
- Tests: NEW `slice-m4/server-call-core.test.js` (28). Migrated (U1b lifted them — each was the old refusal):
  server.test.js (the e-route-002-neg twin now E-ERROR-002 ×2; the §13.7 fixture's `label()` handles its client call;
  the "→ U1b" refusals are now E-ERROR-002; the printer prints the client artifact), error-rulings.test.js (a client
  call of a server-triggered function with a handler is VALID; the `<db src>` program prints). self-host-v2 1956 pass.
- Counter after S2: PASS 121 · FAIL 58 · UNSUPPORTED 619 (10 moved UNSUPPORTED → FAIL, every one the stale-corpus
  shape design Item 5.1 predicted: E-ERROR-002 on an unhandled client call — 7; E-TYPE-080 on a handler that lacks
  `.Transport` — 3 (cell-assign-failable-*); E-DEFER-UNHANDLED-FAILABLE — defer/deferred-server-call-completes).

## S3 — DONE (Core checks, each proven to bite)
- check.scrml: C12 REWRITTEN as a block walk (`tailBlock`): a Suspend / Jump must be the last statement of a client
  owner's continuation block — an Effect body, a handler block (Attr.On), a client Fn body, a Suspend's `then`, a Join
  body, or a branch of an If that ends such a block; a Join immediately precedes the If that ends its block; a Jump
  names the Join of an enclosing If. Never in an Attempt's branches, a Defer body, a ServerFn, a bind's write, a
  reset-on reset.
- `checkClientCalls`: C-S3 (a ServerCall names a ServerFn and stands only as a Suspend's `on`; a ServerFn never
  suspends; client code — a Fn a client root reaches, or one that touches client state — never plain-calls a ServerFn:
  Trigger 5 re-derived from Core); C-S7 (a Suspend on a failable call — a ServerCall, or a Call of a `!` Fn — begins
  its `then` with Attempt(FSettled(bind)); the bind is read nowhere else; FSettled stands only there); C-S8 (Fn.waits
  ⟺ the body holds a Suspend; a waiting Fn's call stands only as a Suspend's `on`); C-E2 extended (`checkClientSet`:
  the Attempt over a ServerCall handles the callee's CLIENT set — its declared variants in order then ONE
  `Transport(t: ServerCallError)`, or the declared enum when it declares the wrapper, or `{ Transport }` for a
  non-`!` callee). C-E1 now exempts a failable Call that is a Suspend's `on` (count-based).
- U1a's per-Fn C-S3 in `clientSide` is superseded for Fn roots by the reachability rule above.
- Tests: NEW `slice-m4/server-call-check.test.js` (16: the worked program's Core is clean; 15 bites, one per rule,
  each a corrupted Core the check reports by its own tag). Shared sources moved to `slice-m4/server-call-fixtures.js`.
  effect.test.js's C12 message assertion migrated to the widened message. self-host-v2 1972 pass / 0 fail.

## S4 — DONE (runtime) + the EMPIRICAL run
- slice-m1/runtime/runtime.js:
  - `call(route, args, task)` → a Promise that RESOLVES with the outcome — never rejects; `classify(route, status,
    text)` (exported, pure) implements the design Item 3.2 table with the #1295 codec (`decode` / `decodeError`,
    `canonicalOnly: true` always — R10 strict). Request: POST `route.path`, `Content-Type: application/json`, body =
    JSON ARRAY of the arguments, each `encode`d against its parameter's table (an argument that does not encode is a
    compiler defect: reported to the host-error reporter, and the call settles as Transport(Malformed)).
  - THE DEADLINE: `SERVER_CALL_DEADLINE_MS = 30000` — ⚑ PA PLACEHOLDER pending a ruling (SPEC §19.9.10: "⚑ OPEN (not
    ruled): the deadline's value / configurability"). One named exported constant; a call with no answer read when it
    passes settles `Transport(Unreachable)`; an earlier answer wins (the timer is cleared).
  - READING (flagged): statuses outside 2xx/4xx/5xx (a 1xx / 3xx reaching the client) → Transport(Malformed) — the
    design table names only 2xx / 4xx / 5xx; a 3xx is not a route's answer and fetch follows redirects itself.
  - READING (flagged): a body that cannot be READ (reset mid-body) → Unreachable (no response arrived, kind 1).
  - `suspend`: the continuation runs as ONE `batch` (untracked); a host exception in it, or a rejection of the
    suspended value on a live task, goes to ONE reporter (`reportHostError`; `setHostErrorReporter` replaces it) —
    never an unhandled rejection; a cancelled task drops its continuation (nothing aborts).
  - `waiting(executor)` — a waiting function's Promise, settled by `ret$` on every exit.
  - `on`: each invocation runs in its own Task (passed as the handler's first argument); scope teardown cancels the
    live ones. READING (design §2.3, flagged): a second event does NOT cancel the first's task.
- Print: `Output.routes` entries carry `value` (false = the 204 no-value contract), for the conformance stub.
- Migrated: slice-m1/effect.runtime.test.js "a rejection … on a live task it is re-raised" → it now reaches the
  host-error reporter and is NOT an unhandled rejection (design §2.4 item 3 — the old behaviour is what U1b fixes).
- Tests: NEW `slice-m4/server-call-runtime.test.js` (32): classify per row (incl. strict-not-dual, bounded
  Malformed.reason), call (request shape, rejected / throwing fetch, unreadable body, the deadline with a hung
  server, an early answer beats the deadline), suspend (one flush for two writes, one reporter, cancel drops),
  handler tasks (per invocation, teardown cancels), `waiting`, and the EMPIRICAL rows. self-host-v2 2003 pass / 0 fail.

### EMPIRICAL — the design's notes editor, compiled by the bootstrap, run in happy-dom, every Item-3.2 row
Program: NOTES_SRC in server-call-runtime.test.js (the design's Item 1 B `save()` + `recount()`, adapted: rows are
not read — no row types; a declared variant's payload is recorded in `@seen` — scrml has no implicit string + int;
`callProblem`'s inner `match t` is replaced by `@cause = t` — no `match` over a non-failable value in the bootstrap,
the §18 match unit). The front end reports no error; `checkCore` is clean; the printed client artifact holds no
server body, no SQL, no database path. `fetch` is stubbed per row; the Save click shows "saving" synchronously, then:

| stubbed answer to `saveNote` | handled outcome (`@status` / other cells) |
|---|---|
| 200 `2` | "saved", `@version` = 2 |
| 2xx + `"two"` (does not decode as int) | "transport", `@cause` = Malformed(…), version unchanged |
| 2xx + a `__scrml_error` envelope | "transport", `@cause` = Malformed(…) |
| 409 + declared envelope `Conflict {current: 7}` | "conflict", `@seen` = 7 |
| 500 + declared envelope `Storage {}` | "the server could not store it" |
| 500 + FOREIGN envelope (`type: "CpsError"`) | "transport", `@cause` = Malformed(…) |
| 403, not an envelope | "transport", `@cause` = Refused(403) |
| 500, not an envelope | "transport", `@cause` = ServerFault(500) |
| fetch rejects | "transport", `@cause` = Unreachable |
| no answer; the deadline passes | "transport", `@cause` = Unreachable |
| `wordCount`: 200 `12`, then 503 | `@words` = 12, then kept at 12 (`.Transport(t) :> @words`) |
| `touch` (yields NO value): 204, then 200 `1` | `stamp()`: "stamped"; then "stamp failed", `@cause` = Malformed(…) (a body for a no-value function) |

## S5 — DONE (the conformance harness's server-stub hook, design §3.4)
- scripts/bootstrap-conformance.ts: `serverStub` is no longer a non-client runtime key — `stubFetch(stub, routes)`
  answers the client artifact's `rt.call`s over the printer's route manifest (`Output.routes`), keyed by the
  impl-neutral scrml-source function name: a plain value → 200 + its JSON; `null` / no stub → 204 for a no-value
  function, 200 `null` for a value function (impl#1's "deterministic empty 200", which the strict client reads as
  Malformed); `__serverError {type, variant, data?, status?}` → status (default 500) + the §57.8 envelope
  (`data` absent → `{}`); `__httpError` → raw status + body; `__batches` → batch 0 (no body split in the bootstrap).
  `runBootstrapArtifact` installs it for the run and restores `fetch` after. The U1a printer-refusal comment updated.
- compiler/tests/integration/bootstrap-conformance-counter: the CODES-ONLY fixture used `serverStub` as its
  "server half the bootstrap cannot run" — it now names `ssr: true` (still CODES-ONLY); NEW fixture
  `runtime/server-stub` (PASS: a handler's client call answered by the stub, runtime executed) + a bite: the same case
  with an impl#1-shaped `CpsError` error stub becomes Transport(Malformed) under strict decoding, the `.Transport(t)`
  arm runs, and the case FAILs on the state it expected.
- OUTCOME CHANGES IN THE CORPUS from the hook: **0**. None of the 30 `serverStub` cases reaches the runtime half on the
  bootstrap today (counter JSON, per case): 15 UNSUPPORTED — `<schema>` (defer/cps-after-last-continuation [+ a
  body split, U1d], defer/cps-batch0-failure, defer/cps-batch1-failure, defer/server-callee-error-total-handler [+ a
  server call in a `defer` body — refused by the plan], defer/server-callee-error-total-handler-twin), `<formFor>`
  (form-for/formfor-submit-collects-values), `<request>` (server-fn/error-boundary-request-error-twin), unannotated
  parameters (server-db/inline-handler-server-call-condition-runtime, nested-helper-server-fn-some-runtime,
  nested-helper-sibling-block-let-some-runtime, on-mount-server-call-some-runtime), parse-reject
  (server-fn/branch-declared-server-fn-routes-to-server; server-fn/cell-assign-{independent-writes-batched,
  read-after-write, successive-writes-ordered} — the legacy `server fn … : T`); 11 NOT-TWINNED; 4 FAIL at the codes
  half, stale against §19.9.10 (defer/deferred-server-call-completes; server-fn/cell-assign-failable-{arm-return-live,
  recovery-value, success-then-read}). The impl#1-shaped `{"type":"CpsError","variant":"ServerError"}` stubs
  (defer/server-callee-error-total-handler, -twin, defer/cps-batch0-failure, defer/cps-batch1-failure) will decode as
  Transport(Malformed) when they reach the runtime half — the -twin's `_ :>` arm still catches it (its expected
  outcome is unchanged); the cps-batch cases are body-split (U1d).
- Counter (final): before (base 859f60f79) PASS 121 · FAIL 48 · NOT-TWINNED 514 · UNSUPPORTED 629 · CRASH 0 → after
  PASS 121 · FAIL 58 · NOT-TWINNED 514 · UNSUPPORTED 619 · CRASH 0. 0 cases moved to PASS (the design measured 0 of
  13; confirmed). 10 moved UNSUPPORTED → FAIL, each now failing on a §19.9.10 diagnostic the stale corpus does not
  assert: E-ERROR-002 on an unhandled client call — server-db/sql-configured-db-no-e-sql-004,
  server-db/sql-missing-db-e-sql-004-neg, server-fn/e-route-002-neg, -002-pos, -005-neg, -005-pos; E-TYPE-080 on a
  handler without `.Transport` — server-fn/cell-assign-failable-arm-return-live, -recovery-value, -success-then-read;
  E-DEFER-UNHANDLED-FAILABLE — defer/deferred-server-call-completes. (The other 3 of the design's 13 —
  server-fn/cell-assign-{read-after-write, successive-writes-ordered, independent-writes-batched} — stay parse-reject.)
  The counter's per-case JSON holds no diagnostic naming U1b. `docs/bootstrap-conformance.md` regenerated
  (`--write`); `--check` → current.
