# progress — s454-scrml-fix-f8-r11 (append-only)

- startup: worktree verified, base 3261a4423 == origin/main, bun install + pretest OK. Branch feat/s454-scrml-fix-f8-r11.

## Phase 0 — dual-implementation compatibility (MEASURED; result = STOP)

Method: probe programs (`.tmp/p0/`, deleted at end — reproduce from the table) compiled by
impl#1 (`compileScrml` for codes + artifacts; `bun compiler/bin/scrml.js compile` for the exit status, which runs the
emitted-JS parse gate) and by the bootstrap exactly as the counter grades a corpus case (`twinOf` with TWIN_RULES, then
`slice-m2/lowered.js frontEnd`). Base 3261a4423. "boot" = Error-severity bootstrap diagnostics.

### §19.9.10 site kinds (callees: `touch()` non-`!` statement, `getN() -> int` non-`!`, `save()! SaveError`)

| kind | spelling | impl#1 | bootstrap |
|---|---|---|---|
| (a) handler stmt, braced | BEFORE `onclick={ touch() }` (also unbraced) | exit 0 | E-ERROR-002 |
| (a) | `touch() !{ .Transport(t) :> return }` | exit 0 | **E-SCOPE-001 "`return` is not declared"** (bare `return` is not an arm-body: §18.2 `arm-body ::= expression \| block-body`) |
| (a) | `touch() !{ .Transport(t) :> { return } }` | exit 0, behaviour unchanged (see below) | clean |
| (a) | `touch() !{ _ :> { return } }` | exit 0 | clean |
| (a) | 2 stmts `{ touch() !{ .Transport(t) :> { return } }; @msg = "done" }` | exit 0 | clean |
| (b) handler assign | `@count = getN() !{ .Transport(t) :> { return } }` | exit 0 | clean |
| (b) | `… !{ _ :> { return } }` | exit 0 | clean |
| (c) client fn body | `touch() !{ .Transport(t) :> { return } }` / `@count = getN() !{ .Transport(t) :> { return } }` | exit 0 | clean |
| (d) handled `! E`, no catch-all | BEFORE `save() !{ .Boom :> {…} }` | exit 0 | E-TYPE-080 (Transport uncovered) |
| (d) | `+ .Transport(t) :> { return }` | exit 0 | clean |
| (d) | `+ _ :> { return }` | exit 0 | clean |

Dual-accepted spelling, kinds (a)–(d): **`.Transport(t) :> { return }`** (BRACED arm body). The SPEC's informal
`:> return` (§19.9.10 migration note; also §13.2's example) is rejected by the bootstrap — see NOTES.

impl#1 artifact diff BEFORE→after (client.js): the call gains impl#1's standard `!{}` lowering (`let r = await
_scrml_fetch_f(); if (r && r.__scrml_error) { if (r.variant === "Transport") { const t = r.data; return; } else
{ return r; } }`). On impl#1 the arm is DEAD: a plain stub throws on a non-2xx non-envelope response (`throw new
Error("HTTP " + status)`) — the throw propagates exactly as before — and impl#1's server never sends a variant named
`Transport` (its CpsError variants are NetworkError / ServerError). For a non-`!` callee the route sends no envelope
at all. So the observable behaviour is unchanged; residual deltas: (1) the `chunk cell scope` content hash changes
(source-hash, cosmetic); (2) for a client-function-body site impl#1 dropped the unused `prefetch` runtime chunk
(`_scrml_prefetch_tier1` — not called by either artifact); (3) the theoretical case of a success value that is itself
an object with `__scrml_error: true` would now stop instead of being written. `_ :> { return }` is weaker on impl#1
for (d) (an unmatched declared-envelope variant would `return` instead of `return r`), so `.Transport(t)` is the pick.

### R11 site kinds (`?{}` outside a `!` function; inside a server-placed non-`!` fn)

| kind | spelling | impl#1 | bootstrap |
|---|---|---|---|
| `.run()` / bare `?{}` statement | `… !{ _ :> {} }` | exit 0; the arm is dead (impl#1 throws on a failed query, no try) → unchanged | clean |
| `return ?{}.get()` | `… !{ _ :> not }` | exit 0, unchanged | clean |
| `@cell = ?{}.get()/.all()` | `… !{ _ :> not / [] }` | exit 0 (fallback lands in a temp, dead) | clean (the function's own body-split refusal is pre-existing) |
| **`const/let x = ?{}.get()/.all()`** | `… !{ _ :> not / [] }` | **exit 1 — E-CODEGEN-INVALID-LOGIC**: server.js `let _scrml__scrml_result_N = ;` | clean |
| same | `!{ _ :> { not } }`, `!{ else :> not }`, `!{ _ e :> not }`, all named arms, parenthesized `(… !{…})` | **exit 1** (all; the paren form emits raw `!{ _ :> null }` into JS) | clean |
| same | plain assignment `x = ?{}.get() !{ _ :> not }` | **exit 1** | clean |
| same | `match ?{}.get() { ::Ok(r) :> r  _ :> not }` | exit 0 BUT broken: the function becomes CLIENT-placed, the query becomes `null /* sql-ref unresolved … */.get()` (runtime TypeError; no server route) | clean |
| `if (?{}.get())` condition | `… !{ _ :> not }` | **exit 1** (raw `!{` in emitted JS) | E-BOOTSTRAP-UNSUPPORTED (handled failable only as a statement) |
| `for (… of ?{}.all())` | `… !{ _ :> [] }` | **E-PARSE-001** | (bootstrap does not parse this `for` form at all — pre-existing) |

**SPEC's own §19.8.3 example 1** (`const row = ?{…}.get() !{ .QueryFailed(m) :> {…} … _ :> {…} }` in a non-`!`
function) compiled on impl#1 → **exit 1, E-CODEGEN-INVALID-LOGIC** (same `let … = ;`). No known-gaps entry exists for
this defect (searched).

Population (impl#1 AST walk, adapted s451 measure.mjs, examples/ samples/ conformance/cases/ stdlib/; 2335 files):
602 unhandled R11 sites; by enclosing statement: const-decl 142 + let-decl 81 + let-decl@top 30 + const-decl@top 4 =
**257 declaration-RHS (43%)** · return 90 · `@x =` (state-decl) 38 + 13@top · none (bare/expression statement) 149 +
24@top · if 14 · for 7 · lift 10. So the blocked kinds cover ≥ 278 of 602 R11 sites (decl + if + for).

### Verdict — STOP (brief: "If for ANY site kind no dual-accepted spelling exists, STOP")

The §19.9.10 kinds (a)–(d) have a dual-accepted spelling. The R11 declaration-RHS kind (and the if-condition / for-of
kinds) has NONE: every handled spelling either fails impl#1's emit gate (exit 1) or (match) silently relocates the
function to the client with a dead query. The cause is an impl#1 codegen defect (a `!{}`-handled `?{}` as a
declaration / assignment RHS lowers to an empty initializer), not a spelling choice. Operator ruling needed (S435
freeze exception to fix that impl#1 lowering, or a bootstrap-only R11 migration, or build the §19.9.10 rule alone
now). Rules NOT built; corpus NOT rewritten.

## Part 0b — DONE (c90e3eade)
- SPEC §19.9.10: the "⚑ OPEN (not ruled): the deadline's value / configurability" line replaced by the ruling (30 s,
  fixed, not configurable) + a handler-task paragraph (a second event does not cancel an in-flight invocation; each
  runs to completion; last-to-complete wins; newest-wins is `<effect>` / `<request>` only), each with a Provenance
  block quoting S454 "your recs on both, then go on F8"; the two normative bullets updated/added.
- Bootstrap runtime.js `SERVER_CALL_DEADLINE_MS` comment: placeholder → ruled; its test comment likewise (value unchanged, 30000).
- SPEC-INDEX + FACTS regenerated; `regen-spec-index.ts --check` OK 72/72; `facts.ts --check` PASS.
- Pre-commit gate on that commit: 30642 pass / 0 fail.
- Scratch `.tmp/p0` deleted.

## PA decision (after the STOP) — OPTION 2
Build ONLY `client-server-call` (§19.9.10) with `!{ .Transport(t) :> { return } }`; `sql-failable` (R11) NOT built,
pending an operator ruling. SPEC bare-`:> return` examples NOT edited (separate question). BRIEF.md left as is.

### New evidence for the EXISTING gap `g-sql-handler-arm-on-all-in-fn-statement-emits-empty-assign-s454` (no duplicate filed)
- Reach: 257 declaration-RHS sites of 602 unhandled R11 sites (43%) — every `!{}`-handled spelling of them fails impl#1
  (all arm forms, `_ e :>`, named arms, parenthesized, plain assignment `x = ?{}… !{…}`; `.get()` as well as `.all()`).
- SPEC §19.8.3 example 1 (`const row = ?{…}.get() !{ .QueryFailed(m) :> {…} … _ :> {…} }`) → exit 1, E-CODEGEN-INVALID-LOGIC.
- SILENT-WRONG variant: `const row = match ?{…}.get() { ::Ok(r) :> r  _ :> not }` compiles at EXIT 0 but impl#1 moves
  the function to the CLIENT and emits `null /* sql-ref unresolved: nodeId=-1 … */.get()` (runtime TypeError; no route).
- `if (?{…}.get() !{ _ :> not })` emits a raw `!{ _ :> null }` into server JS (exit 1); `for (const r of ?{…}.all() !{…})` → E-PARSE-001.

### CORRECTION to the Phase-0 table (found in Phase 2)
- The R11 row "`return ?{}.get()` + `!{ _ :> not }` → exit 0, unchanged" is WRONG: impl#1 DROPS the success return
  for any `return X !{…}` (it emits `let r = X; if (r.__scrml_error) {…}` and never returns `r`) — silent-wrong.
  Same for a client call: `return f() !{ .Transport(t) :> { return } }` turned conformance
  lifecycle/request-body-client-wrapper-rt red. Plain reassignment `x = f() !{…}` re-declares `x` (`var x`,
  invalid JS). Both shapes are LISTED by the rule, not rewritten. (Probably the same impl#1 family as the
  decl-RHS gap: a guarded-expr whose guarded node is a statement loses the statement's own effect.)

## Phase 1 — DONE: `scrml fix` rule `client-server-call` (c8335cc3c, 2823507ee, 94c8c9810, f8479997c)
- `compiler/src/commands/fix-client-server-call.js`; chained in `fix-s66.js` right after arm-pipe; a DEFAULT rule
  (`IMPL1_SAFE_RULES`, `S66_RULES`); excluded from the bootstrap counter's `TWIN_RULES`; `fixS66` / the CLI carry
  `infos`. Tests: `compiler/tests/commands/fix-client-server-call.test.js` (18).
- Rewrites (dual-accepted spelling from Phase 0): `f(…) !{ .Transport(t) :> { return } }` at an unhandled client
  call of a non-`!` server function that is a whole statement (expression statement, `const`/`let` RHS, `@x =`) in
  a client function of an ENTRY file (+ INFO "callers no longer abort"), or in a handler value (bare call / bare
  assignment / one-line `${…}` without `event` → braced).
- Listed, never rewritten: value positions, body top, lifecycle / defer bodies, closures, handler / match arms,
  handler references, handled calls without `.Transport`/`_`, `?`, `return f()`, `x = f()`, a bare `onsubmit=f()`
  (impl#1 adds preventDefault only to the bare call-ref form), function bodies of module / route files or any file
  that exports (§19.9.10 F5 — placement is whole-program; stdlib modules are `<program>`-rooted and export).
- Gate per file: re-parse (front end codes unchanged), re-compile (errors + warnings + lint codes unchanged;
  W-/E-CPS-NEEDS-FAILABLE may drop; I-FN-PROMOTABLE may appear — impl#1 false positive), sites resolved; else the
  whole file is reverted and reported.

## Phase 2 — DONE: corpus (d330aa594)
- Rewritten: 229 sites / 167 files — examples 16/11, samples 82/35, conformance/cases 130/120, stdlib 1/1
  (`stdlib/auth/templates/login.scrml`; every other stdlib site is in an exporting module → listed). 124 handler
  values (bare / `${}` → braced), 105 client-function-body sites (each with the INFO).
  S451 measured 170 handler + 139 client-fn = 309 rewrite candidates at `dbb671c2d`; the gap is the listed kinds.
- Held back from the rule's output (left as written): 12 conformance cases —
  11 where the BOOTSTRAP judges the callee not server-placed and the rewrite adds E-ERROR-013 (a bootstrap
  placement gap: body-split callees, Trigger-3 `scrml:auth`, E-SQL-003 negative cases with a malformed `?{}` body):
  derived/e-derived-server-only-reach-fn-path, server-db/cps-idempotency-store-driver-mismatch-neg/-pos,
  server-db/cps-idempotency-store-missing-import-neg/-pos, server-db/cps-nonidem-no-storage-neg/-pos,
  server-db/server-fn-writes-reactive-cell-neg/-pos, sql/bare-identifier-body-e-sql-003-neg (was a counter PASS),
  sql/runtime-expr-body-e-sql-003-neg; and server-fn/cell-assign-independent-writes-batched (its description pins
  impl#1's Promise.all batching, which a handled call no longer gets).
- impl#1 conformance (`bun conformance/run.ts`): base 1265 pass + 50 xfail → head 1265 pass + 50 xfail, the
  PASS/FAIL/XFAIL sets identical case by case.
- Bootstrap counter (base e4f1c02c1 → head): PASS 121 → 121 · FAIL 58 → 56 · UNSUPPORTED 622 → 624 · NOT-TWINNED
  514 → 514 · CRASH 0. Moved: server-db/sql-configured-db-no-e-sql-004 and server-db/sql-missing-db-e-sql-004-neg
  FAIL → UNSUPPORTED (their client call is now handled; the next blocker is the bootstrap's strict decode needing a
  declared return type on `getUsers`). E-ERROR-002 left the unexpected-error set of 17 more UNSUPPORTED cases
  (auth/async-fn-escapes-* ×8, auth/nested-helper-* ×3, reactive/server-fn-{ambient-identity-clean,
  authority-wholly-server-error,rawvar-read-error}, server-db/nested-helper-server-fn-sort-neg,
  server-fn/cell-assign-{read-after-write,successive-writes-ordered}) — each still refused for a non-U1b reason.
  The #1303 targets: server-fn/e-route-002-neg/-pos, e-route-005-neg/-pos rewritten but still FAIL on their
  pre-existing errors (R11 `?{}`, E-SCOPE-001, E-SQL-004); server-fn/cell-assign-failable-{arm-return-live,
  recovery-value,success-then-read} LISTED (handled `! E` without `.Transport` — a human picks the arm);
  defer/deferred-server-call-completes LISTED (defer body).
- impl#1 emit differential (`scripts/corpus-emit-differential.ts`, base e4f1c02c1 vs head working tree at
  f8479997c + the corpus): 2342 sources both sides; compile-failure set identical; syntax (both goggles) identical
  (75 = 75); 204 of 11438 artifacts differ, every one classified:
  A 35 noise only (content-hash names, temp / anchor numbering; incl. all 4 server.js + html/assets);
  B 142 the handler lowering only (dead on impl#1: a non-`!` stub throws on failure, never returns a
    `Transport` envelope); C 18 the same + `const`/`let` → `var` for the declared name (impl#1's guarded-decl
    lowering; no redeclaration failure in the syntax check);
  E 3 runtime: the unused `prefetch` chunk dropped (no artifact calls it);
  G 4 the now-handled independent calls lose impl#1's Promise.all batching (sequential — timing only:
    sql-transaction-exit-rollback-rt, sql-transaction-in-function-rt, admin-panel, debate-async-dashboard);
  H 1 htmx-debate-dashboard: impl#1 now batches two plain `let x = @cell` reads in a Promise.all (one extra
    microtask before the optimistic update; values unchanged, neither is reassigned);
  I 1 gauntlet-r10-elixir-chat.html: an empty `<span data-scrml-logic>` no client code references is gone.
  CPS (body-split) callees DO return a CpsError envelope on failure: all 26 rewritten CPS sites are the LAST
  statement of their handler / function, so nothing that used to run is skipped (the function now returns the
  envelope instead of undefined). The `__scrml_error`-shaped-success stop is theoretical (no corpus value).
  Diagnostic codes changed in 27 sources: I-FN-PROMOTABLE appears in 25 (impl#1 false positive — its purity probe
  does not see a call inside a guarded statement), W-CPS-NEEDS-FAILABLE + E-CPS-NEEDS-FAILABLE cleared in
  gauntlet-r10-htmx-feedback. "diagnostic-TEXT-only 1414" = work-dir paths in messages.
- New impl#1 defects surfaced (not filed — for the PA): (1) `return X !{…}` drops the success return; (2)
  `x = f() !{…}` emits `var x` (redeclare); (3) E-DG-002 false positive for a cell read only as an argument of a
  `!{}`-guarded call; (4) I-FN-PROMOTABLE false positive (above); (5) impl#1's onsubmit preventDefault is tied to
  the bare call-ref form.

### Sites LISTED for a human (rule output, after the 12 hold-backs)
- **module/route-file function** (33): examples/23-trucking-dispatch/pages/customer/invoices.scrml:177, examples/23-trucking-dispatch/pages/customer/invoices.scrml:203, examples/23-trucking-dispatch/pages/customer/load-detail.scrml:212, examples/23-trucking-dispatch/pages/customer/load-detail.scrml:248, examples/23-trucking-dispatch/pages/customer/loads.scrml:99, examples/23-trucking-dispatch/pages/customer/profile.scrml:57, examples/23-trucking-dispatch/pages/customer/quote.scrml:144, examples/23-trucking-dispatch/pages/customer/quote.scrml:176, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:145, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:157, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:163, examples/23-trucking-dispatch/pages/dispatch/board.scrml:77, examples/23-trucking-dispatch/pages/dispatch/customers.scrml:66, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:224, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:247, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:258, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:286, examples/23-trucking-dispatch/pages/dispatch/load-new.scrml:140, examples/23-trucking-dispatch/pages/dispatch/load-new.scrml:171, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:374, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:395, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:403, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:441, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:464, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:488, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:511, examples/23-trucking-dispatch/pages/driver/load-log.scrml:80, examples/23-trucking-dispatch/pages/driver/messages.scrml:120, examples/23-trucking-dispatch/pages/driver/messages.scrml:145, examples/23-trucking-dispatch/pages/driver/profile.scrml:88, examples/23-trucking-dispatch/pages/driver/profile.scrml:122, stdlib/compiler/module-resolver.scrml:95, stdlib/store/kv.scrml:212
- **value position (inside an expression)** (19): conformance/cases/server-db/event-after-await-e01-destructure-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e02-dynkey-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e04-dotcall-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e09-objwrap-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e10-methodref-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e13-fndecl-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e16-closure-param-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e20-comma-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e21-arrayalias-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e22-returnValue-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e23-cancelBubble-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e25-before-ok-pos/case.scrml:4, conformance/cases/server-db/event-after-await-h03-helper-after-await-neg/case.scrml:5, conformance/cases/server-db/event-after-await-h08-n3-inner-pos/case.scrml:4, conformance/cases/server-db/event-control-after-await-alias-neg/case.scrml:6, conformance/cases/server-db/event-control-after-await-bracket-neg/case.scrml:6, conformance/cases/server-db/event-control-after-await-closure-neg/case.scrml:6, conformance/cases/server-db/event-control-after-await-neg/case.scrml:5, stdlib/compiler/module-resolver.scrml:3
- **body top** (16): examples/17-schema-migrations.scrml:147, examples/18-state-authority.scrml:1, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:91, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:92, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:93, samples/compilation-tests/gauntlet-r10-go-contacts.scrml:48, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:339, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:341, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml:9, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-server-prefix-013.scrml:8, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-with-sql-002.scrml:1, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-server-003.scrml:9, samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-stmt-sql-in-body-097.scrml:16, conformance/cases/auth/auth-001-neg/case.scrml:13, conformance/cases/fn/sql-access-in-function-clean/case.scrml:8, conformance/cases/fn/sql-access-reject/case.scrml:8
- **handled call, no .Transport / catch-all** (8): samples/compilation-tests/gauntlet-s20-error-test/server-failable-001.scrml:19, conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:26, conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:32, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:28, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:33, conformance/cases/server-fn/cell-assign-failable-arm-return-live/case.scrml:13, conformance/cases/server-fn/cell-assign-failable-recovery-value/case.scrml:12, conformance/cases/server-fn/cell-assign-failable-success-then-read/case.scrml:12
- **impl#1 lowering: return f()** (8): conformance/cases/lifecycle/request-body-client-wrapper-rt/case.scrml:10, conformance/cases/server-db/nested-helper-server-fn-some-runtime/case.scrml:5, conformance/cases/server-db/nested-helper-server-fn-sort-neg/case.scrml:4, conformance/cases/server-db/nested-helper-sibling-block-let-some-runtime/case.scrml:5, stdlib/auth/flows.scrml:127, stdlib/auth/flows.scrml:137, stdlib/auth/flows.scrml:148, stdlib/store/kv.scrml:194
- **value position (initializer)** (6): examples/03-contact-book.scrml:36, examples/08-chat.scrml:94, samples/compilation-tests/gauntlet-r10-go-contacts.scrml:237, samples/gauntlet-r11-task-dashboard.scrml:212, conformance/cases/server-fn/sse-generator-binding-seed-survives/case.scrml:7, conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml:9
- **bare onsubmit (preventDefault)** (5): examples/19-lin-token.scrml:134, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:419, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:496, samples/compilation-tests/gauntlet-s20-sql/sql-run-001.scrml:11, samples/compilation-tests/server-008-form-handler.scrml:14
- **gate: impl#1 codes changed (file reverted)** (4): samples/compilation-tests/gauntlet-r10-bun-admin.scrml:327, samples/compilation-tests/gauntlet-r10-go-contacts.scrml:173, samples/gauntlet-r11-task-dashboard.scrml:179, samples/multi-step-form.scrml:75
- **lifecycle body** (3): samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:62, samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:72, samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:86
- **value position (attribute)** (2): examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:441, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:7
- **could not be placed/confirmed** (2): samples/compilation-tests/gauntlet-r10-bun-admin.scrml:599, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:661
- **defer body** (2): samples/compilation-tests/gauntlet-r10-go-contacts.scrml:240, conformance/cases/defer/deferred-server-call-completes/case.scrml:10
- **impl#1 threw** (1): samples/gauntlet-s19-phase4/nested-comments.scrml:1
- **handler reference** (1): conformance/cases/form-for/formfor-onsubmit-signature/case.scrml:19
- **value position (inside a handler expression)** (1): conformance/cases/server-db/async-call-then-in-handler-neg/case.scrml:5
- **closure** (1): conformance/cases/server-db/inline-handler-server-call-sort-neg/case.scrml:6

### PA addendum — SPEC bare-`return` arm-body correction: NOT DONE
The edit (`:> return` → `:> { return }`, `:> fail …` → `:> { fail … }` at §13.3, §19.5.2, §19.9.10, §19.10.3, plus
the dpa-068 line under §18.2) was refused by the auto-mode permission classifier ("Instruction Poisoning" — the
ruling text arrived by agent message and could not be verified from here; a read of user-voice-scrml.md to verify
it was refused too). Left for the PA. Sites found: SPEC.md lines 10093-10095, 10099 (prose quoting the handler),
18430, 19453/19455 (the migration note — which also still says "The rule is not built."), 19593 (inline example).

## S239 fix round (review of e17b7cc59) — rule 6aa399cc1, corpus 521b7591f
**Supersedes, in the Phase-2 section above:** the corpus counts (229 / 167), class G described as "timing only"
(it is NOT — see 2), and the listed-sites block. Current values below.
1. HIGH — guarded `const`/`let` → impl#1 `var`: inside a loop / nested block, or captured by a closure, the binding is
   shared (reviewer's repro: "1,2,3" → "3,3,3" on the success path). Such declarations are LISTED. Corpus: 3 sites
   (gauntlet-r10-rails-blog ×2 — nested `if` blocks — and stdlib/compiler/module-resolver, already a module); none of
   the previously rewritten `var` sites was in a loop or captured.
2. MED — class G was not timing-only: a `.Transport` `return` makes sibling independent calls a control dependency
   (on the 2nd call's failure the 1st write lands; on the 1st's failure the 2nd is never sent; §13.2 parallelism
   lost). A call impl#1 batches with Promise.all — read from impl#1's OWN emitted client JS of the before compile
   (`promiseAllBatches`), not re-derived — is LISTED. The 4 affected files (samples/admin-panel,
   samples/debate-async-dashboard-react-perspective, conformance server-db/sql-transaction-exit-rollback-rt and
   sql-transaction-in-function-rt) are back to base source; their artifacts are byte-identical to base (no entry in
   the differential).
3. MED — entry vs module from the PARSED tree: a top-level `<program>` node, else (caller says entry AND not under
   pages/ or routes/). The 6 trucking pages (auth/login, auth/register, customer/home, dispatch/drivers, driver/home,
   driver/hos — 8 sites) matched only on a COMMENT `<program`; reverted, consistent with their sibling pages (listed).
4. LOW-MED — `match-stmt` arms (`match-arm-*` nodes under `body`) are LISTED: admin-panel ×5, debate-async ×1
   reverted (their Info "returns from `executeConfirm`" was wrong — impl#1 lowers the match to an inner function).
5. NIT — the binder is `_`: `!{ .Transport(_) :> { return } }`. Measured: impl#1 exit 0 with no binding emitted;
   bootstrap clean (handler-statement and client-fn shapes).
- Teaching-quality note for the examples owner (not changed — the rewrite is the faithful old behaviour):
  samples/htmx-debate-dashboard.scrml:130 `@orderSubmitting = true … createOrder(…) !{ .Transport(_) :> { return } }`
  leaves `@orderSubmitting` true on a transport failure (as the old rejection did); a teaching sample should reset it.

### Re-verification (corpus at 521b7591f vs base 3261a4423)
- Rule tests 22/22; fix-s66 + fix-arm-pipe green; pre-commit gate 30642/0 on both fix-round commits.
- Corpus: 203 sites / 157 files — examples 8/5, samples 68/33, conformance/cases 126/118, stdlib 1/1; 124 handler
  values, 79 client-function-body sites (79 INFOs). Against the previous rewrite: only the intended reverts above
  plus `(t)` → `(_)`.
- `scrml fix … --rules=client-server-call --check` over examples/ samples/ conformance/cases/ stdlib/: would change
  exactly the 11 held-back conformance cases (the 12th, cell-assign-independent-writes-batched, is now listed by the
  rule itself — Promise.all); every other file is a fixed point.
- impl#1 conformance: 1265 pass + 50 xfail, case-by-case identical to base.
- Bootstrap counter: PASS 121 → 121 (PASS name set identical) · FAIL 58 → 56 · UNSUPPORTED 622 → 624;
  sql-configured-db-no-e-sql-004 and sql-missing-db-e-sql-004-neg FAIL → UNSUPPORTED; E-ERROR-002 left the
  unexpected-error set of the same 17 UNSUPPORTED cases as before.
- Emit differential: 0 compile-outcome changes, syntax 75 = 75, 170 of 11438 artifacts differ — A 11 noise ·
  B 142 handler lowering only · C 12 handler lowering + `const`/`let` → `var` (function top level, not captured) ·
  E 3 unused `prefetch` runtime chunk dropped · H 1 htmx-debate-dashboard (two plain cell reads joined in a
  Promise.all — one extra microtask, values unchanged) · I 1 gauntlet-r10-elixir-chat.html (an unreferenced empty
  logic span gone). **Class G: 0.** Codes: I-FN-PROMOTABLE appears in 25 sources (impl#1 false positive);
  W-/E-CPS-NEEDS-FAILABLE cleared in 1. Bare-site delta −6 (sql-delete-reflects-rt, sql-unique-constraint-rt) =
  the `prefetch` chunk's stub references (class E).

### Sites LISTED for a human (fix round)
rewritten: 203 sites (124 handler values written braced, 79 inserted; 79 client-function-body INFOs) in 157 files
- **module/route-file function** (40): examples/23-trucking-dispatch/pages/auth/login.scrml:85, examples/23-trucking-dispatch/pages/auth/register.scrml:82, examples/23-trucking-dispatch/pages/customer/home.scrml:120, examples/23-trucking-dispatch/pages/customer/invoices.scrml:177, examples/23-trucking-dispatch/pages/customer/invoices.scrml:203, examples/23-trucking-dispatch/pages/customer/load-detail.scrml:212, examples/23-trucking-dispatch/pages/customer/load-detail.scrml:248, examples/23-trucking-dispatch/pages/customer/loads.scrml:99, examples/23-trucking-dispatch/pages/customer/profile.scrml:57, examples/23-trucking-dispatch/pages/customer/quote.scrml:144, examples/23-trucking-dispatch/pages/customer/quote.scrml:176, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:145, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:157, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:163, examples/23-trucking-dispatch/pages/dispatch/board.scrml:77, examples/23-trucking-dispatch/pages/dispatch/customers.scrml:66, examples/23-trucking-dispatch/pages/dispatch/drivers.scrml:76, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:224, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:247, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:258, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:286, examples/23-trucking-dispatch/pages/dispatch/load-new.scrml:140, examples/23-trucking-dispatch/pages/dispatch/load-new.scrml:171, examples/23-trucking-dispatch/pages/driver/home.scrml:146, examples/23-trucking-dispatch/pages/driver/home.scrml:165, examples/23-trucking-dispatch/pages/driver/hos.scrml:255, examples/23-trucking-dispatch/pages/driver/hos.scrml:274, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:374, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:395, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:403, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:441, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:464, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:488, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:511, examples/23-trucking-dispatch/pages/driver/load-log.scrml:80, examples/23-trucking-dispatch/pages/driver/messages.scrml:120, examples/23-trucking-dispatch/pages/driver/messages.scrml:145, examples/23-trucking-dispatch/pages/driver/profile.scrml:88, examples/23-trucking-dispatch/pages/driver/profile.scrml:122, stdlib/store/kv.scrml:212
- **value position (inside an expression)** (19): conformance/cases/server-db/event-after-await-e01-destructure-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e02-dynkey-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e04-dotcall-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e09-objwrap-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e10-methodref-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e13-fndecl-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e16-closure-param-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e20-comma-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e21-arrayalias-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e22-returnValue-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e23-cancelBubble-neg/case.scrml:4, conformance/cases/server-db/event-after-await-e25-before-ok-pos/case.scrml:4, conformance/cases/server-db/event-after-await-h03-helper-after-await-neg/case.scrml:5, conformance/cases/server-db/event-after-await-h08-n3-inner-pos/case.scrml:4, conformance/cases/server-db/event-control-after-await-alias-neg/case.scrml:6, conformance/cases/server-db/event-control-after-await-bracket-neg/case.scrml:6, conformance/cases/server-db/event-control-after-await-closure-neg/case.scrml:6, conformance/cases/server-db/event-control-after-await-neg/case.scrml:5, stdlib/compiler/module-resolver.scrml:3
- **body top** (16): examples/17-schema-migrations.scrml:147, examples/18-state-authority.scrml:1, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:91, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:92, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:93, samples/compilation-tests/gauntlet-r10-go-contacts.scrml:48, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:339, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:341, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml:9, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-server-prefix-013.scrml:8, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-with-sql-002.scrml:1, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-server-003.scrml:9, samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-stmt-sql-in-body-097.scrml:16, conformance/cases/auth/auth-001-neg/case.scrml:13, conformance/cases/fn/sql-access-in-function-clean/case.scrml:8, conformance/cases/fn/sql-access-reject/case.scrml:8
- **held back (bootstrap placement / batching description)** (12): conformance/cases/derived/e-derived-server-only-reach-fn-path/case.scrml, conformance/cases/server-db/cps-idempotency-store-driver-mismatch-neg/case.scrml, conformance/cases/server-db/cps-idempotency-store-driver-mismatch-pos/case.scrml, conformance/cases/server-db/cps-idempotency-store-missing-import-neg/case.scrml, conformance/cases/server-db/cps-idempotency-store-missing-import-pos/case.scrml, conformance/cases/server-db/cps-nonidem-no-storage-neg/case.scrml, conformance/cases/server-db/cps-nonidem-no-storage-pos/case.scrml, conformance/cases/server-db/server-fn-writes-reactive-cell-neg/case.scrml, conformance/cases/server-db/server-fn-writes-reactive-cell-pos/case.scrml, conformance/cases/server-fn/cell-assign-independent-writes-batched/case.scrml, conformance/cases/sql/bare-identifier-body-e-sql-003-neg/case.scrml, conformance/cases/sql/runtime-expr-body-e-sql-003-neg/case.scrml
- **Promise.all batch (impl#1)** (10): samples/admin-panel.scrml:87, samples/admin-panel.scrml:88, samples/admin-panel.scrml:89, samples/debate-async-dashboard-react-perspective.scrml:148, samples/debate-async-dashboard-react-perspective.scrml:149, samples/debate-async-dashboard-react-perspective.scrml:150, conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:38, conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:39, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:38, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:39
- **handled call, no .Transport / catch-all** (8): samples/compilation-tests/gauntlet-s20-error-test/server-failable-001.scrml:19, conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:26, conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:32, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:28, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:33, conformance/cases/server-fn/cell-assign-failable-arm-return-live/case.scrml:13, conformance/cases/server-fn/cell-assign-failable-recovery-value/case.scrml:12, conformance/cases/server-fn/cell-assign-failable-success-then-read/case.scrml:12
- **impl#1 lowering: return f()** (8): conformance/cases/lifecycle/request-body-client-wrapper-rt/case.scrml:10, conformance/cases/server-db/nested-helper-server-fn-some-runtime/case.scrml:5, conformance/cases/server-db/nested-helper-server-fn-sort-neg/case.scrml:4, conformance/cases/server-db/nested-helper-sibling-block-let-some-runtime/case.scrml:5, stdlib/auth/flows.scrml:127, stdlib/auth/flows.scrml:137, stdlib/auth/flows.scrml:148, stdlib/store/kv.scrml:194
- **value position (initializer)** (6): examples/03-contact-book.scrml:36, examples/08-chat.scrml:94, samples/compilation-tests/gauntlet-r10-go-contacts.scrml:237, samples/gauntlet-r11-task-dashboard.scrml:212, conformance/cases/server-fn/sse-generator-binding-seed-survives/case.scrml:7, conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml:9
- **handler / match arm** (6): samples/admin-panel.scrml:102, samples/admin-panel.scrml:104, samples/admin-panel.scrml:106, samples/admin-panel.scrml:109, samples/admin-panel.scrml:110, samples/debate-async-dashboard-react-perspective.scrml:186
- **bare onsubmit (preventDefault)** (5): examples/19-lin-token.scrml:134, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:419, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:496, samples/compilation-tests/gauntlet-s20-sql/sql-run-001.scrml:11, samples/compilation-tests/server-008-form-handler.scrml:14
- **gate: impl#1 codes changed (file reverted)** (4): samples/compilation-tests/gauntlet-r10-bun-admin.scrml:327, samples/compilation-tests/gauntlet-r10-go-contacts.scrml:173, samples/gauntlet-r11-task-dashboard.scrml:179, samples/multi-step-form.scrml:75
- **lifecycle body** (3): samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:62, samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:72, samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:86
- **decl in nested block / captured (var scoping)** (3): samples/compilation-tests/gauntlet-r10-rails-blog.scrml:317, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:326, stdlib/compiler/module-resolver.scrml:95
- **value position (attribute)** (2): examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:441, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:7
- **could not be placed/confirmed** (2): samples/compilation-tests/gauntlet-r10-bun-admin.scrml:599, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:661
- **defer body** (2): samples/compilation-tests/gauntlet-r10-go-contacts.scrml:240, conformance/cases/defer/deferred-server-call-completes/case.scrml:10
- **impl#1 threw** (1): samples/gauntlet-s19-phase4/nested-comments.scrml:1
- **handler reference** (1): conformance/cases/form-for/formfor-onsubmit-signature/case.scrml:19
- **value position (inside a handler expression)** (1): conformance/cases/server-db/async-call-then-in-handler-neg/case.scrml:5
- **closure** (1): conformance/cases/server-db/inline-handler-server-call-sort-neg/case.scrml:6

## Merge of origin/main (8041451f4: #1305 handled-?{}, #1306 wrap, #1307 maps) — c7de2d181
- Conflicts only in generated docs (compiler/SPEC-INDEX.md totals + §18/§19+ line ranges; docs/FACTS.md table):
  resolved by REGENERATING (`regen-spec-index.ts`, `facts.ts --write`; both `--check` OK; `state.ts --check` all
  @generated sections current). SPEC.md auto-merged: the Part 0b deadline / handler-task text and #1306's bare-`return`
  correction both present. (Still stale on main's text, not touched here: §19.9.10 migration note "The rule is not
  built." — the rule is built.)
- Pre-commit gate on the merge: 30700 pass / 0 fail. Rule tests 22/22; fix-s66 + fix-arm-pipe green.
- `scrml fix --rules=client-server-call --check` over the corpus: would change the 11 held-back cases (as before)
  PLUS #1305's three new cases — server-db/sql-handled-decl-rhs-rt (7 sites), sql-handled-in-condition-rt (3),
  sql-handled-match-scrutinee-rt (4): each case's client driver `go()` writes cells from client calls of non-`!`
  server functions with no handler (written after the migration, so not §19.9.10-shaped). Those functions write /
  fail, so impl#1 does not batch them; the gate passes. NOT applied — they are #1305's contract cases; PA's call.
- impl#1 conformance vs main (main corpus vs this branch, same merged compiler): 1268 pass + 50 xfail both, identical
  case by case.
- Bootstrap counter vs main: PASS 121 = 121 (name set identical) · FAIL 58 → 56 · UNSUPPORTED 625 → 627 · the same
  two FAIL → UNSUPPORTED moves (sql-configured-db-no-e-sql-004, sql-missing-db-e-sql-004-neg) and the same 17
  unexpected-error-set changes as at fd3a012b9. Counts/classes otherwise unchanged vs fd3a012b9.

## PA follow-up — #1305 cases migrated (20334bfdc) + SPEC migration note (811a40f2e)
- `scrml fix --rules=client-server-call` applied to server-db/sql-handled-{decl-rhs,in-condition,match-scrutinee}-rt
  (14 sites, all in each case's client driver `go()`). impl#1 conformance: 1268 pass + 50 xfail, 0 FAIL, 0 XPASS; all
  three PASS. Bootstrap counter: PASS 121 (unchanged; the three cases are UNSUPPORTED before and after). Pre-commit
  gate 30700/0.
- SPEC §19.9.10 migration note: "The rule is not built." → the rule is built (S454), writes `.Transport(_)`, and LISTS
  the shapes it cannot preserve; Provenance S454 "your recs on both, then go on F8" (verified in
  user-voice-scrml.md:20318). SPEC-INDEX + FACTS regenerated; both `--check` OK.
- Final corpus: 217 sites / 160 files — examples 8/5, samples 68/33, conformance/cases 140/121, stdlib 1/1.
