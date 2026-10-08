# progress — s455-scrml-fix-r11-sql-failable (append-only)

- startup: worktree verified (pwd == toplevel, clean), base bade5cb9d == origin/main; bun install + pretest OK.
- BRIEF archived (first commit).
- Maps read: primary.map.md header (S454 stamp f38697900) — the #1305 block names the impl#1 surfaces for a
  handled `?{}` in expressions (`extractHandledOperands`, `codegen/sql-attempt.ts`, `emitSqlQueryShape`); the S452
  block names fix-s66 chaining / IMPL1_SAFE_RULES / TWIN_RULES.

## Governing sentences (quoted from compiler/SPEC.md at bade5cb9d)

- §19.8.3: "A `?{}` query is a **failable expression everywhere**. Outside a `!` function it is treated exactly like
  a call to a `!` function whose error type is `SqlError` (§19.4.3): its result SHALL NOT be ignored, and an unhandled
  `?{}` SHALL be a compile error, **E-ERROR-002**. "Outside a `!` function" means that no enclosing function is
  declared `!` (§19.4.1) — including a `?{}` at a body top or in a function without `!`."
- §19.8.3: "**"No row" is not a failure.** A query that runs and matches nothing succeeds: `.get()` on zero rows
  returns `not`, and `.all()` on zero rows returns `[]`, in every context …"
- §19.8.3: "**A `<x server>` hydration load is exempt (S451).** A §52.6.5 Pattern C declaration RHS
  (`<driver server> : Driver = ?{…}.get()`) … SHALL NOT be E-ERROR-002 and needs no handler. … A `?{}` inside that
  load function's own body is author code and follows this section."
- §19.8.3: "**Migrating R11 code (tooling, not language).** The R11 migration route is a `scrml fix` rule that writes
  the struck silent behaviour out explicitly at each site — `.get() !{ _ :> not }`, `.all() !{ _ :> [] }`, and the
  matching shape for `.run()` — so the meaning is preserved and the silence becomes visible. The rule is owed; it is a
  tool behaviour with no normative weight here."
- §19.8.3 (direction): "**impl#1 divergence (Nominal for impl#1, §34.0):** impl#1 emits no E-ERROR-002 for a `?{}` …
  impl#1 never implemented the struck silent mode at run time either — a failed query throws on the server
  (`g-sql-error-surface-unwired`)."
- §19.8.4: "A `?{}` query SHALL be a failable expression in every context. Outside a `!` function it SHALL be handled
  at the site with a `!{}` handler or a `match` (§19.8.3); an unhandled `?{}` there SHALL be E-ERROR-002." ·
  "*(Informative.)* The migration for code the R11 bullet above newly rejects is a `scrml fix` rule (owed; tooling,
  not language — §19.8.3)."
- §19.4.3: "**A `?{}` query is a failable expression too (S451 R11).** Outside a `!` function, a `?{}` query is
  handled like a call to a `!` function whose error type is `SqlError` — with `!{}` or `match` at the site — and an
  unhandled one is E-ERROR-002 (§19.8.3 …)." · value position: "For a `?{}` the success type is the terminator's
  (§44.3): `.get()` yields `Row | not`, so `_ :> not` yields a value; `.all()` yields `Row[]`, so `_ :> []` does." ·
  "In a statement position an arm MAY fall through".
- §8.7: "Outside a `!` function: the query SHALL be handled at the site — a `!{}` handler or a `match` — exactly like
  a call to a `!` function; an unhandled `?{}` there is **E-ERROR-002** (§19.8.3)."
- §44.3: "`.all()` (or bare `?{}`) → `Row[]` · `.get()` → `Row | not` · `.run()` → `void`" and "A query that fails to
  run is not `not` and not `[]` — it is a `SqlError` variant".
- §63.2: "A deprecation is well-formed only if, at Stage-1 landing, it co-lands {a `W-`lint …} + {a reserved `E-`code
  …} + {a `--fix`/`scrml fix` rule, or a designer-card waiver}."
- §63.4: "At Stage 2 (schedule) / Stage 3 (remove): auto-migratability is a **HARD GATE**. A reserved-E MUST NOT be
  scheduled or fired for a form that has no **verified-landed** `scrml fix` rule".
- User voice S451 item 5(a) (read-only, user-voice-scrml.md:20147): "R11 migration = a `scrml fix` rule that writes
  the old silent behaviour out explicitly (`?{…}.get() !{ | _ :> not }`, `.all() !{ | _ :> [] }`,
  `.run() !{ | _ :> {} }`-shape) — meaning-preserving, silence made visible". (Arms written without `|` per S452.)
- S454 freeze exception (user-voice-scrml.md:20329) → #1305.

Note on "meaning-preserving": the struck SPEC text said a failed query returns `not` / `[]`; impl#1 never did that at
run time (a failed query throws on the server). The brief's test is "executes identically to the unhandled form" on
impl#1 — so Phase 0 measures the impl#1 observable value of BOTH forms.

## Phase 0 — re-measured on bade5cb9d (post-#1305). RESULT: STOP (no kind passes the brief's gate)

Method (reproduce: `bun docs/changes/s455-scrml-fix-r11-sql-failable/phase0-probe.ts [kind]`): per kind, one program
with three non-`!` server functions `f_notes` / `f_empties` / `f_gone`, each called from its own button
(`onclick={ @r_T = f_T() !{ .Transport(_) :> { return } } }`). impl#1 = `compileScrml` codes + the conformance
adapter's `runServer(…, { sqlEngine: "real" })` — a REAL bun:sqlite; `notes` = 1 row `{id:7, body:"hello"}`,
`empties` = 0 rows, `gone` = declared in `<schema>`, never created → the query FAILS TO RUN ("no such table: gone").
Value = the client cell after the click (`"init"` = the call never returned a value: impl#1's server handler threw
SQLiteError → HTTP 500 → the client call rejected). Bootstrap = `twinOf` (TWIN_RULES) + `slice-m2/lowered.js
frontEnd`, Error-severity diagnostics (the `<schema>` block is dropped for the bootstrap compile — the bootstrap
refuses `<schema>` itself, unrelated to R11).

| kind | handled spelling | impl#1 codes base → handled | impl#1 value base (row · no-row · FAIL) | impl#1 value handled (row · no-row · FAIL) | bootstrap base → handled |
|---|---|---|---|---|---|
| stmt `.run()` | `.run() !{ _ :> {} }` | same (no E-) | "after" · "after" · **threw** | "after" · "after" · **"after"** | E-ERROR-002 ×3 → clean |
| stmt bare `?{}` | `?{…} !{ _ :> [] }` / `!{ _ :> {} }` (both) | same | "after" · "after" · **threw** | "after" · "after" · **"after"** | E-ERROR-002 ×3 → clean |
| stmt `.get()` (value discarded) | `.get() !{ _ :> not }` | same | "after" · "after" · **threw** | … · **"after"** | E-ERROR-002 ×3 → clean |
| stmt in `if` body | `.run() !{ _ :> {} }` | same | "after" · "after" · **threw** | … · **"after"** | E-ERROR-002 ×3 → clean |
| stmt in `for` body | `.run() !{ _ :> {} }` | same | "after" · "after" · **threw** | … · **"after"** | bootstrap cannot parse `for (const i of …)` either side (pre-existing); E-ERROR-002 not reached |
| `const x = ….get()` | `!{ _ :> not }` | same | "hello" · "none" · **threw** | "hello" · "none" · **"none"** | E-ERROR-002 ×3 + pre-existing (`is`, `.body`, strict decode) → pre-existing only |
| `let x = ….get()` | `!{ _ :> not }` | same | same as const | same as const | same as const |
| `const x = ….all()` / `let` | `!{ _ :> [] }` | same | "n=1" · "n=0" · **threw** | "n=1" · "n=0" · **"n=0"** | E-ERROR-002 ×3 + `.length` → `.length` only |
| `const x = ?{…}` (bare) | `!{ _ :> [] }` | same | "n=1" · "n=0" · **threw** | … · **"n=0"** | as above |
| plain reassignment `x = ….get()` | `!{ _ :> not }` | same | "hello" · "none" · **threw** | "hello" · "none" · **"none"** | E-ERROR-002 ×3 → pre-existing only |
| `return ….get()` | `!{ _ :> not }` | same | {body:"hello"} · null · **threw** | {body:"hello"} · null · **null** | E-ERROR-002 ×3 → pre-existing only |
| `return ….all()` | `!{ _ :> [] }` | same | [{id:7}] · [] · **threw** | [{id:7}] · [] · **[]** | E-ERROR-002 ×3 → pre-existing only |
| `lift ….all()` (fn body) | `!{ _ :> [] }` | same | [{id:7}] · [] · threw | **null · null** · threw | `lift` unknown both sides; E-ERROR-002 cleared |
| `if (….get())` condition | `!{ _ :> not }` | same | "yes" · "no" · **threw** | "yes" · "no" · **"no"** | E-ERROR-002 ×3 → **E-BOOTSTRAP-UNSUPPORTED ×3** ("a handled failable … only as a statement's whole …") |
| `for (r of ….all())` | `!{ _ :> [] }` | **+E-PARSE-001 ×3** | "n=1" · "n=0" · threw | (does not compile) | bootstrap cannot parse the `for` either side |
| `@c = ….get()` in a fn | `!{ _ :> not }` | same (E-DG-002 both) | {body:"hello"} · null · threw | **"init" · "init" · "init"** | E-ERROR-002 ×3 + body-split unsupported → body-split only |
| body top (`${ let u = ?{…} }`, `${ ?{…}.run() }`, `<items> = ?{…}.all()`) | (as above) | W-CG-001 **dropped** (codes change) | dead on impl#1 either side (client `let u;` / `null /* … E-CG-006 */`) | — | not probed (codes gate already fails) |

### Readings
1. **The failure column differs for EVERY kind.** On impl#1 an unhandled `?{}` that fails to run THROWS on the
   server (HTTP 500; the client call rejects; nothing after it runs) — `g-sql-error-surface-unwired`, as SPEC §19.8.3
   already records ("impl#1 never implemented the struck silent mode at run time either"). Since #1305
   (`codegen/sql-attempt.ts`), a HANDLED `?{}` really is caught: the `_ :> not` / `[]` / `{}` arm runs and execution
   continues. So the rewrite turns impl#1's "throws → 500" into the superseded SPEC's silent `not` / `[]` / continue.
   The two success columns are identical for every kind except the silent-wrong ones below.
2. **Brief gate, applied literally:** "executes identically to the unhandled form in all three runtime cases" — NO
   kind passes (the failure case). The brief: "If NO kind passes, STOP and report." → STOPPED. Rule not built;
   corpus not rewritten.
3. **Is E-ERROR-002 emitted by impl#1 for an unhandled R11 site? NO** — every base row above compiles with no
   E-ERROR-002 (and no E- code). The bootstrap emits E-ERROR-002 per site. So, for compile acceptance, the rule is a
   bootstrap-facing migration only; at RUN time on impl#1 it changes the failure path (reading 1).
4. #1305 FIXED the S454 CORRECTION for `?{}`: `return ?{…}.get() !{…}` now returns the success value, and plain
   reassignment `x = ?{…} !{…}` assigns the existing binding (no `var` redeclare) — both measured above.
5. New impl#1 defects in #1305's lowering (silent-wrong, for the PA):
   (a) `lift ?{…}.all() !{ _ :> [] }` in a function body: the success value is DROPPED — server.js emits
       `let r = await _scrml_sql…; if (r && r.__scrml_error) { r = []; }` and never lifts/returns `r` (client gets
       `null`); and the query is NOT wrapped in `_scrml_sql_attempt` (a failure still throws).
   (b) `@c = ?{…}.get() !{ _ :> not }` in a function: the write becomes a SERVER-side
       `_scrml_reactive_set("c", …)` inside the route handler — never reaches the client cell (the base form's write
       did). Cell stays "init" on success.
   (c) `for (const r of ?{…}.all() !{ _ :> [] })` → E-PARSE-001 (unchanged since S454).
   (d) bootstrap: a handled `?{}` as an `if` condition → E-BOOTSTRAP-UNSUPPORTED (bootstrap limit, not impl#1).

### Population at bade5cb9d (`phase0-measure.mjs`, impl#1 front end; examples/ samples/ conformance/cases/ stdlib/; 2338 files)
Unhandled R11 sites by immediate parent : terminator — in a function: statement 131 `.run()` + 10 bare + 4 `.all()`
(parent function-decl) + 13 in `if` bodies + 7 in `for` bodies + 2 transaction-block + 1 defer · const-decl 98 get /
26 all / 18 bare · let-decl 57 get / 14 all / 8 `.first()` / 2 run · return 50 all / 31 get / 4 bare / 3 run / 1
first / 1 prepare · state-decl (`@x =`) 33 bare / 3 all / 2 prepare · lift (parent `sql`) 5 all / 1 get ·
if-condition sql-refs 4 (all in #1305's own cases) · 1 yield. Body top: let 13 bare / 11 all / 6 get, state-decl 13
bare, logic 12 run / 10 bare, const 2 bare / 1 all / 1 get, transaction-block 2. Not R11: in-`!`-fn 39, handled 10,
Pattern C 14, tx-control 2.

### Recommendation to the PA (a ruling is needed; not taken here)
The brief's runtime gate and the S451 ruling disagree on impl#1 by construction: S451 5(a) RULED the spelling as
"meaning-preserving, silence made visible" — meaning the SUPERSEDED SPEC meaning (`not` / `[]` / no error), which
impl#1 never implemented (it throws). No spelling can reproduce impl#1's throw from a non-`!` function (there is no
re-raise outside a `!` function). Options:
- **(a) recommended — gate on the SPEC meaning:** rewrite a kind when both success columns are identical, the
  handled spelling compiles on both implementations with unchanged impl#1 codes, and on failure the handled form
  yields exactly the superseded value (`not` / `[]` / continue). Every rewritten site gets an INFO naming the runtime
  change on impl#1: "a failure here used to throw (HTTP 500, caller aborted); it now yields `not` / `[]`".
  Under (a): REWRITE stmt (`.run()` / bare / discarded `.get()`, incl. inside `if` / `for` bodies), const/let
  `.get()` / `.all()` / bare, plain reassignment, `return ….get()` / `.all()`. LIST: `lift` (5a), `@x =` in a
  function (5b), `for (… of ?{})` (5c), `if (?{})` condition (5d), body top (codes change; dead on impl#1),
  `.first()` / `.prepare()` / yield / transaction-block / defer (not probed / not §44.3 terminators).
  Who pays: impl#1 adopters at ~460 sites — a DB failure that today surfaces as a 500 becomes a silent fallback.
  That is what S451 ruled ("writes the old silent behaviour out explicitly"); the `!{ _ :> … }` at every site is
  the visible marker a human later replaces with real handling.
- (b) bootstrap-only: apply the rule only at grading time (TWIN_RULES), corpus untouched — impl#1 runtime unchanged,
  but the corpus stays R11-invalid for the bootstrap.
- (c) do nothing (impl#1 cannot be aligned: it is frozen).

## PA decision — gate (a) (relayed by the PA; grounded in S451 "your recs on all five" item 5(a))
"proceed with gate (a). … The rule targets the RULED meaning (the old SPEC semantics), not impl#1's divergent
throw." Rewrite a kind iff success values identical (row + no-row), both implementations accept it with impl#1 codes
unchanged, and on a forced failure it yields exactly `not` / `[]` / continue; INFO at every rewrite; LIST lift,
`@x =` in a function, for-of, if-conditions, body top, `.first()`/`.prepare()`/`yield`/`transaction`/`defer`,
anything uncertain.

### Phase 0 addendum — body-split functions (probe kinds split-*)
A function that runs a `?{}` AND writes a cell is split client/server by impl#1 (CPS). `?{}.run() !{ _ :> {} }`
there → **E-RI-002 ×3 (new)**, and the cell write never lands; `const x = ?{}… !{…}` there is already E-RI-002 in
the base. So `?{}` in a body-split function (impl#1 RI `cpsSplit` non-null) is LISTED.

## Phase 1 — DONE (38a4462d5): `compiler/src/commands/fix-sql-failable.js`
- Default rule (`IMPL1_SAFE_RULES`, `S66_RULES`), chained in `fix-s66.js` right after client-server-call;
  excluded from the counter's `TWIN_RULES`; INFOs flow through `fixS66` / the CLI. fix-client-server-call.js now
  exports its scanning / scratch-compile helpers (no behaviour change).
- Classification from the AST + impl#1's captured Route Inference (placement + `cpsSplit` keyed
  `file::span.start`); handled = the `?{}` is the guarded operand of a statement `guarded-expr`, an expression
  `__scrml_guard__` call (#1305 form), or a match subject; Pattern C = a `state-decl` with `isServer`; `!` = any
  enclosing `function-decl.canFail`; reassignment = impl#1's `_bareAssign` const-decl.
- Edit point from the `sql` node's source span (opens `?{`, balanced close == span.end), the terminator the AST
  recorded must follow as written, the statement must end there, and the prefix must be the statement's own
  (`return` / `const|let name =` / `name =` / nothing). Gate per file: front-end re-read (same block-splitter
  E- codes), impl#1 re-compile in the project (codes identical — no tolerance list), unhandled count drops by
  exactly the edits; else the whole file is reverted and reported.
- Tests: compiler/tests/commands/fix-sql-failable.test.js — 16 (spelling; statement kinds incl. if/for bodies;
  const/let/reassign/return; multi-line; idempotence; `!`-fn / handled (stmt, decl, match) / Pattern C negatives;
  lift, `@x =`, if-condition, for-of, body top, `.first()`, chained member, nobatch, `.run()` value, nested and
  captured decls, body-split, tx control; chaining). commands suite 494/494 (fix-s66 rule-id list updated).
  Types gate unchanged (190). Pre-commit gate 30700/0.

### Phase 1 fix rounds (found by Phase 2's whole-corpus checks)
- 3b3d26ce5 tried tolerating W-TYPE-031-UNPROVEN appearing (impl#1 does not infer a function's return type
  through a handled `?{}` declaration; +1 per trucking-dispatch page). The trucking-dispatch diagnostic baseline
  (`trucking-dispatch-smoke-integration.test.js`, pins W-TYPE-031-UNPROVEN at 239 and says it SHALL only fall)
  caught it → 4f0ea2300 removed the tolerance: NO tolerance list; those 19 pages are listed.
- e53af9010 — two gate holes the emit differential exposed: (1) a handled `?{}` in a callee made impl#1 stop
  batching its CALLER's independent calls (`Promise.all` → sequential; sql-transaction-exit-rollback-rt /
  sql-transaction-in-function-rt) — the gate now compares impl#1's own batches (`promiseAllBatches`, read from the
  emitted client JS) before/after; (2) the verify compile could not see a `<db src=…>` file beside the source
  (samples/compilation-tests/gauntlet-s20-sql/protect-select-star-001 lost I-PROTECT-STRIP-001 in place but not
  in the scratch) — sibling `*.db` / `*.sqlite*` files are now mirrored into the scratch project. Test added.
- 4ecb2b858 — a keywordless `x = ?{…}` (impl#1 `_bareAssign`) is impl#1's implicit declaration when `x` is
  unbound (base emits `const x`, handled emits `var x`): nested / captured ones are now listed like `const`/`let`.
  No corpus site changed by it. Test added (18 tests; commands suite 512/512).

## Phase 2 — corpus (8fe995731 + e53af9010) — FINAL
Applied with `scrml fix <dir> --rules=sql-failable` (default gate) over examples/ samples/ conformance/cases/
stdlib/; then re-run FROM BASE with the final rule (e53af9010+): the output reproduced the committed corpus byte for
byte (idempotent and deterministic; a `--check` re-run changes no file except the held-back case below).
- **Rewritten: 238 sites / 148 files** — examples 28/9, samples 85/28, conformance/cases 123/110, stdlib 2/1
  (`stdlib/auth/templates/login.scrml`). By position:terminator — statement `.run()` 75 · statement `.all()` 4 ·
  statement bare 3 · const/let `.get()` 50 · `.all()` 18 · bare 2 · keywordless `x = ?{…}` (bare) 16 · return
  `.get()` 20 · `.all()` 46 · bare 4. By spelling — `!{ _ :> not }` 70 · `!{ _ :> [] }` 93 · `!{ _ :> {} }` 75.
  Every rewritten site carries the INFO.
- **Held back (rule output not applied):** conformance/cases/sql/bare-identifier-body-e-sql-003-neg — the bootstrap
  then reports E-ERROR-013 (its placement gap; F8 held back the same case) and the counter's PASS would drop.
- **Listed: 244 sites** (see the list below).
- impl#1 conformance (`bun conformance/run.ts`): base 1268 pass + 50 xfail → head 1268 pass + 50 xfail; the
  PASS/FAIL/XFAIL sets identical case by case.
- Bootstrap counter (base = this branch's rule commit on the base corpus): PASS 121 → 121, FAIL 56 → 56,
  NOT-TWINNED 514, UNSUPPORTED 627, CRASH 0 — no case changes bucket. E-ERROR-002 leaves the unasserted-error
  lists of the 4 server-fn/e-route-* FAIL cases (still FAIL on their other errors: E-SCOPE-001, E-SQL-004).
- impl#1 emit differential (`scripts/corpus-emit-differential.ts`, base = `git archive` of 3b3d26ce5 — compiler
  identical to bade5cb9d outside `commands/`, corpus = bade5cb9d — vs head working tree): verdict prints
  INCOMPARABLE only because the archive side has no git revision. 2345 sources both sides; compile-failure set
  identical; diagnostic CODE changes 0 (1473 text-only = work-dir paths in messages); syntax 0 new / 0 fixed; bare
  server-fn call sites 197 = 197. **531 of 11456 artifacts differ, every one classified** (`.tmp` classifier,
  normalized diff):
  A 377 noise (375 + 2 SSR server.js mount-anchor renumberings) — content-hash chunk / runtime names, `_scrml_*_N` / `__ri_route_*_N` renumbering, the work-dir path
    (`_scrml_project_root`, a host-import path), AST-node-id renumbering of each / if-chain anchors (the added
    handlers shift node ids);
  B 144 server.js — the handled-`?{}` lowering only: the `_scrml_sql_attempt` / `_scrml_sql_error` helper block
    plus, per rewritten site, `let r = await _scrml_sql_attempt((p) => _scrml_sql\`…\`, [args], (rows) => shape)`
    + `if (r && r.__scrml_error) { r = not|[] }` + `var x = r` / `return r` (incl. multi-line queries);
  X 10 client.js — 2 host-import work-dir path, 8 each / if-chain anchor renumbering (noise, as A).
  No client batching change, no code change, no new syntax failure.

### Sites LISTED for a human (rule output, final)
- **body top / markup** (71): samples/compilation-tests/combined-004-data-table.scrml:6, samples/compilation-tests/combined-007-crud.scrml:6, samples/compilation-tests/combined-013-blog.scrml:6, samples/compilation-tests/edge-009-nested-sql-in-logic.scrml:6, samples/compilation-tests/edge-009-nested-sql-in-logic.scrml:7, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:19, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:29, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:34, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-arith-in-sql-interp-048.scrml:5, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-in-sql-bound-024.scrml:4, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-not-in-sql-098.scrml:3, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-not-on-sql-get-114.scrml:3, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-method-call-sql-088.scrml:3, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-method-call-sql-088.scrml:4, samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-method-call-sql-088.scrml:5, samples/compilation-tests/gauntlet-s20-meta/meta-sql-runtime-007.scrml:10, samples/compilation-tests/gauntlet-s20-sql/sql-all-001.scrml:6, samples/compilation-tests/gauntlet-s20-sql/sql-bound-params-001.scrml:8, samples/compilation-tests/gauntlet-s20-sql/sql-duplicate-param-001.scrml:7, samples/compilation-tests/gauntlet-s20-sql/sql-get-001.scrml:6, samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml:10, samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml:15, samples/compilation-tests/gauntlet-s20-sql/sql-multiline-001.scrml:6, samples/compilation-tests/gauntlet-s20-sql/sql-nobatch-001.scrml:6, samples/compilation-tests/postgres-program-driver.scrml:19, samples/compilation-tests/sql-001-basic-select.scrml:5, samples/compilation-tests/sql-002-where.scrml:5, samples/compilation-tests/sql-003-join.scrml:6, samples/compilation-tests/sql-004-count.scrml:5, samples/compilation-tests/sql-005-insert.scrml:7, samples/compilation-tests/sql-006-update.scrml:6, samples/compilation-tests/sql-007-delete.scrml:6, samples/compilation-tests/sql-008-order-limit.scrml:6, samples/compilation-tests/sql-009-multiple.scrml:6, samples/compilation-tests/sql-009-multiple.scrml:7, samples/compilation-tests/sql-009-multiple.scrml:8, samples/compilation-tests/sql-010-create-table.scrml:6, samples/debate-lin-lift-edge-cases.scrml:59, samples/debate-lin-lift-pipeline.scrml:40, samples/gauntlet-r13/bun-sql-operations.scrml:7, samples/gauntlet-r13/bun-sql-operations.scrml:8, samples/gauntlet-r13/elixir-pipeline.scrml:9, samples/gauntlet-r13/go-api-service.scrml:13, samples/gauntlet-r13/rails-crud-admin.scrml:7, samples/gauntlet-r14/bun-sql-operations.scrml:7, samples/gauntlet-r14/bun-sql-operations.scrml:8, samples/gauntlet-r14/elixir-pipeline.scrml:9, samples/gauntlet-r14/elixir-pipeline.scrml:10, samples/gauntlet-r14/go-api-service.scrml:13, samples/gauntlet-r14/rails-crud-admin.scrml:7, samples/gauntlet-r15/stress-db-markup-onclick.scrml:8, samples/react-dev-lin-lift-edge-cases.scrml:71, samples/react-dev-lin-lift-pipeline.scrml:33, conformance/cases/auth/auth-001-pos/case.scrml:8, conformance/cases/auth/w-serverload-ungated-neg/case.scrml:4, conformance/cases/auth/w-serverload-ungated-pos/case.scrml:4, conformance/cases/body-top/sql-statement-not-shipped/case.scrml:2, conformance/cases/codegen/cg-001-server-block-warn-pos/case.scrml:3, conformance/cases/error/transaction-top-level-neg/case.scrml:9, conformance/cases/error/transaction-top-level-neg/case.scrml:10, conformance/cases/meta/meta-sql-in-runtime-block-neg/case.scrml:2, conformance/cases/server-db/reserved-prefix-raw-driver-neg/case.scrml:4, conformance/cases/server-db/reserved-prefix-raw-driver-pos/case.scrml:4, conformance/cases/server-db/sql-row-contract-mismatch-neg/case.scrml:8, conformance/cases/server-db/sql-row-contract-mismatch-pos/case.scrml:8, conformance/cases/sql/prepare-cps-return-e-sql-006-neg/case.scrml:4, conformance/cases/sql/prepare-pattern-c-cell-e-sql-006-neg/case.scrml:4, conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml:4, conformance/cases/sql/prepare-ws-onserver-e-sql-006-neg/case.scrml:3, conformance/cases/ssr/i-ssr-auth-scoped-prerender-omitted-pos/case.scrml:4, conformance/cases/ssr/i-ssr-auth-scoped-prerender-rowscoped-neg/case.scrml:4
- **body-split function (impl#1 CPS)** (56): samples/compilation-tests/combined-007-crud.scrml:12, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:178, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:189, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:192, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:209, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:232, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:233, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:250, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:251, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:262, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:269, samples/compilation-tests/gauntlet-r10-bun-admin.scrml:270, samples/compilation-tests/gauntlet-r10-htmx-feedback.scrml:103, samples/gauntlet-r13/bun-sql-operations.scrml:13, samples/gauntlet-r13/bun-sql-operations.scrml:18, samples/gauntlet-r13/bun-sql-operations.scrml:23, samples/gauntlet-r13/elixir-pipeline.scrml:13, samples/gauntlet-r13/elixir-pipeline.scrml:18, samples/gauntlet-r13/go-api-service.scrml:17, samples/gauntlet-r13/go-api-service.scrml:22, samples/gauntlet-r13/rails-crud-admin.scrml:13, samples/gauntlet-r13/rails-crud-admin.scrml:24, samples/gauntlet-r14/bun-sql-operations.scrml:16, samples/gauntlet-r14/bun-sql-operations.scrml:22, samples/gauntlet-r14/bun-sql-operations.scrml:27, samples/gauntlet-r14/bun-sql-operations.scrml:33, samples/gauntlet-r14/elixir-pipeline.scrml:18, samples/gauntlet-r14/elixir-pipeline.scrml:24, samples/gauntlet-r14/elixir-pipeline.scrml:25, samples/gauntlet-r14/elixir-pipeline.scrml:32, samples/gauntlet-r14/elixir-pipeline.scrml:33, samples/gauntlet-r14/elixir-pipeline.scrml:39, samples/gauntlet-r14/elixir-pipeline.scrml:40, samples/gauntlet-r14/go-api-service.scrml:20, samples/gauntlet-r14/go-api-service.scrml:25, samples/gauntlet-r14/go-api-service.scrml:30, samples/gauntlet-r14/htmx-forms.scrml:41, samples/gauntlet-r14/rails-crud-admin.scrml:16, samples/gauntlet-r14/rails-crud-admin.scrml:27, samples/gauntlet-r15/stress-db-markup-onclick.scrml:13, samples/gauntlet-r15/stress-db-markup-onclick.scrml:18, samples/gauntlet-r15/stress-db-markup-onclick.scrml:23, conformance/cases/defer/cps-after-last-continuation/case.scrml:15, conformance/cases/defer/cps-after-last-continuation/case.scrml:17, conformance/cases/defer/cps-batch0-failure/case.scrml:15, conformance/cases/defer/cps-batch0-failure/case.scrml:17, conformance/cases/defer/cps-batch1-failure/case.scrml:15, conformance/cases/defer/cps-batch1-failure/case.scrml:17, conformance/cases/defer/server-block-nested-neg/case.scrml:23, conformance/cases/defer/server-in-split-neg/case.scrml:12, conformance/cases/server-db/cps-idempotency-store-driver-mismatch-neg/case.scrml:9, conformance/cases/server-db/cps-idempotency-store-driver-mismatch-pos/case.scrml:9, conformance/cases/server-db/cps-idempotency-store-missing-import-neg/case.scrml:10, conformance/cases/server-db/cps-idempotency-store-missing-import-pos/case.scrml:9, conformance/cases/server-db/cps-nonidem-no-storage-neg/case.scrml:9, conformance/cases/server-db/cps-nonidem-no-storage-pos/case.scrml:9
- **gate: impl#1 codes changed (file reverted)** (42): examples/23-trucking-dispatch/pages/auth/register.scrml:44, examples/23-trucking-dispatch/pages/customer/home.scrml:47, examples/23-trucking-dispatch/pages/customer/invoices.scrml:46, examples/23-trucking-dispatch/pages/customer/load-detail.scrml:39, examples/23-trucking-dispatch/pages/customer/loads.scrml:38, examples/23-trucking-dispatch/pages/customer/profile.scrml:26, examples/23-trucking-dispatch/pages/customer/quote.scrml:33, examples/23-trucking-dispatch/pages/dispatch/billing.scrml:34, examples/23-trucking-dispatch/pages/dispatch/board.scrml:50, examples/23-trucking-dispatch/pages/dispatch/customers.scrml:29, examples/23-trucking-dispatch/pages/dispatch/drivers.scrml:35, examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml:46, examples/23-trucking-dispatch/pages/dispatch/load-new.scrml:34, examples/23-trucking-dispatch/pages/driver/home.scrml:42, examples/23-trucking-dispatch/pages/driver/hos.scrml:91, examples/23-trucking-dispatch/pages/driver/load-detail.scrml:65, examples/23-trucking-dispatch/pages/driver/load-log.scrml:26, examples/23-trucking-dispatch/pages/driver/messages.scrml:35, examples/23-trucking-dispatch/pages/driver/profile.scrml:23, samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml:5, samples/compilation-tests/gauntlet-s20-sql/protect-select-star-001.scrml:7, samples/gauntlet-r13/rails-crud-admin.scrml:18, samples/gauntlet-r14/rails-crud-admin.scrml:21, conformance/cases/fn/sql-access-reject/case.scrml:4, conformance/cases/protect/assign-refresh-runtime/case.scrml:8, conformance/cases/protect/channel-broadcast-strip/case.scrml:12, conformance/cases/protect/comment-prefixed-strip-info/case.scrml:8, conformance/cases/protect/cte-strip-client-visible-runtime/case.scrml:8, conformance/cases/protect/cte-strip-info/case.scrml:8, conformance/cases/protect/descriptor-symbol-e006/case.scrml:8, conformance/cases/protect/endpoint-multikey-arm-response/case.scrml:8, conformance/cases/protect/expr-column-row-strip-runtime/case.scrml:8, conformance/cases/protect/marker-removal-alias-e006/case.scrml:8, conformance/cases/protect/merge-rows-strip-runtime/case.scrml:8, conformance/cases/protect/mounthydrate-redacts/case.scrml:8, conformance/cases/protect/returning-strip-runtime/case.scrml:8, conformance/cases/protect/select-upper-column-row-strip-runtime/case.scrml:8, conformance/cases/protect/spaced-star-strip-runtime/case.scrml:8, conformance/cases/protect/sse-yield-strip/case.scrml:8, conformance/cases/protect/strip-client-visible-runtime/case.scrml:8, conformance/cases/protect/strip-info-select-star/case.scrml:8, conformance/cases/protect/upper-table-row-strip/case.scrml:8
- **cell write `@x = ?{}` in a function** (38): samples/compilation-tests/combined-007-crud.scrml:13, samples/compilation-tests/combined-007-crud.scrml:21, samples/gauntlet-r13/bun-sql-operations.scrml:14, samples/gauntlet-r13/bun-sql-operations.scrml:19, samples/gauntlet-r13/bun-sql-operations.scrml:24, samples/gauntlet-r13/elixir-pipeline.scrml:14, samples/gauntlet-r13/elixir-pipeline.scrml:19, samples/gauntlet-r13/go-api-service.scrml:18, samples/gauntlet-r13/go-api-service.scrml:23, samples/gauntlet-r13/rails-crud-admin.scrml:14, samples/gauntlet-r13/rails-crud-admin.scrml:20, samples/gauntlet-r13/rails-crud-admin.scrml:25, samples/gauntlet-r13/react-auth-dashboard.scrml:26, samples/gauntlet-r14/bun-sql-operations.scrml:17, samples/gauntlet-r14/bun-sql-operations.scrml:23, samples/gauntlet-r14/bun-sql-operations.scrml:28, samples/gauntlet-r14/bun-sql-operations.scrml:34, samples/gauntlet-r14/elixir-pipeline.scrml:19, samples/gauntlet-r14/elixir-pipeline.scrml:26, samples/gauntlet-r14/elixir-pipeline.scrml:27, samples/gauntlet-r14/elixir-pipeline.scrml:34, samples/gauntlet-r14/elixir-pipeline.scrml:35, samples/gauntlet-r14/elixir-pipeline.scrml:41, samples/gauntlet-r14/elixir-pipeline.scrml:42, samples/gauntlet-r14/go-api-service.scrml:21, samples/gauntlet-r14/go-api-service.scrml:26, samples/gauntlet-r14/go-api-service.scrml:31, samples/gauntlet-r14/rails-crud-admin.scrml:17, samples/gauntlet-r14/rails-crud-admin.scrml:23, samples/gauntlet-r14/rails-crud-admin.scrml:28, samples/gauntlet-r15/stress-db-markup-onclick.scrml:14, samples/gauntlet-r15/stress-db-markup-onclick.scrml:19, samples/gauntlet-r15/stress-db-markup-onclick.scrml:24, conformance/cases/reactive/server-fn-cps-authority-marshal/case.scrml:7, conformance/cases/reactive/server-fn-cps-marshal-derived-warn/case.scrml:8, conformance/cases/reactive/server-fn-cps-marshal-raw-silent/case.scrml:7, conformance/cases/sql/prepare-cps-return-e-sql-006-neg/case.scrml:9, conformance/cases/sql/prepare-ws-onserver-e-sql-006-neg/case.scrml:8
- **terminator outside §44.3 (`.first()` / `.prepare()`)** (10): samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:125, samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:170, samples/compilation-tests/gauntlet-r10-elixir-chat.scrml:178, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:110, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:146, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:156, samples/compilation-tests/gauntlet-r10-rails-blog.scrml:186, samples/compilation-tests/protect-001-basic-auth.scrml:24, samples/debate-async-dashboard-react-perspective.scrml:119, conformance/cases/sql/prepare-server-fn-e-sql-006-neg/case.scrml:4
- **`lift`** (6): examples/07-admin-dashboard.scrml:39, examples/17-schema-migrations.scrml:60, samples/admin-panel.scrml:36, samples/admin-panel.scrml:43, samples/admin-panel.scrml:52, samples/user-profile.scrml:21
- **declaration nested / captured (impl#1 `var`)** (6): examples/23-trucking-dispatch/seeds.scrml:301, examples/23-trucking-dispatch/seeds.scrml:320, examples/23-trucking-dispatch/seeds.scrml:356, samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-stmt-sql-in-body-097.scrml:11, conformance/cases/protect/e-protect-003-neg/case.scrml:10, conformance/cases/protect/e-protect-003-pos/case.scrml:10
- **`.run()` as a value** (5): samples/compilation-tests/gauntlet-s20-sql/sql-run-001.scrml:7, samples/compilation-tests/gauntlet-s20-sql/sql-update-delete-001.scrml:7, samples/compilation-tests/gauntlet-s20-sql/sql-update-delete-001.scrml:10, conformance/cases/auth/auth-005-db-context-neg/case.scrml:7, conformance/cases/protect/run-terminator-strip-runtime/case.scrml:8
- **other construct (transaction / defer / yield / arm / closure)** (5): conformance/cases/defer/server-block-nested-neg/case.scrml:11, conformance/cases/defer/server-in-split-neg/case.scrml:11, conformance/cases/error/transaction-non-failable-fn-neg/case.scrml:10, conformance/cases/error/transaction-non-failable-fn-neg/case.scrml:11, conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml:6
- **gate: impl#1 Promise.all batching changed (file reverted)** (2): conformance/cases/server-db/sql-transaction-exit-rollback-rt/case.scrml:23, conformance/cases/server-db/sql-transaction-in-function-rt/case.scrml:25
- **transaction-control statement** (2): conformance/cases/sql/batch-warn-info/case.scrml:4, conformance/cases/sql/batch-warn-info/case.scrml:7
- **impl#1 threw** (1): samples/gauntlet-s19-phase4/nested-comments.scrml:1

## impl#1 defects surfaced (NOT filed — for the PA; reproducers)
1. HIGH silent-wrong — `lift ?{…}.all() !{ _ :> [] }` in a function body drops the success value (no lift /
   return emitted; client gets `null`) and the query is not attempt-wrapped. Repro: `phase0-probe.ts lift-all`.
2. HIGH silent-wrong — `@c = ?{…}.get() !{ _ :> not }` in a function lowers to a SERVER-side
   `_scrml_reactive_set("c", …)` inside the route handler; the client cell is never written. Repro:
   `phase0-probe.ts cell-get`.
3. `for (const r of ?{…}.all() !{ _ :> [] })` → E-PARSE-001. Repro: `phase0-probe.ts for-of-all`.
4. (bootstrap) a handled `?{}` as an `if` condition → E-BOOTSTRAP-UNSUPPORTED. Repro: `phase0-probe.ts if-cond-get`.
5. Fail-open — a handled `?{}` in a `fn` drops E-FN-001 (the pure-`fn` SQL prohibition). Repro: the unit test
   "the gate: … loses E-FN-001" / samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004
   and conformance/cases/fn/sql-access-reject with the rule's rewrite applied.
6. Fail-open — samples/gauntlet-r13/rails-crud-admin.scrml (+ r14): with the rewrite, E-CPS-MULTIBATCH-REORDER and
   E-REACTIVE-003 ×3/×4 disappear.
7. `protect=` diagnostics — a handled `?{}` loses I-PROTECT-STRIP-001 (15 conformance protect/* cases + the
   gauntlet-s20 sample); conformance/cases/protect/assign-refresh-runtime gains E-PROTECT-006 ×2 (fails closed).
   Runtime redaction still holds where measured: protect/strip-client-visible-runtime with `.get() !{ _ :> not }`
   passes its runtime half (passwordHash absent) and fails only the missing I-PROTECT-STRIP-001.
8. Typing — W-TYPE-031-UNPROVEN: return-type inference stops at a handled `?{}` declaration (19 trucking pages).
9. Body-split (CPS) function — `?{…}.run() !{ _ :> {} }` there → E-RI-002 (new) and the cell write never lands.
   Repro: `phase0-probe.ts split-stmt-run`.
10. Caller batching — a handled `?{}` in `balanceOf` makes impl#1 stop `Promise.all`-batching `@b1 = balanceOf(1);
    @b2 = balanceOf(2)` (unit test "the gate: … Promise.all batching").

## S455 RULING — reads only ("b your rec on R11", user-voice-scrml.md §S455; relayed by the PA)
Trigger: S239 review of 32647fcd — a rewritten WRITE (`.run() !{ _ :> {} }`) that fails lets the function continue
(samples/admin-panel doRevokeKey: the UPDATE fails, the audit INSERT records "revoked", the client sees success;
base: 500, nothing logged). Pre-ruling measurement (from the rule's own classification): of the 238 rewritten sites
86 were writes (statement `.run()` 75, bare statement 3, keywordless `x =` … RETURNING 5, return 3), 152 reads.

### Rule (3fa36bfbd)
- `classifySql(query)` — tokenizes the tree's query text (skips `--` / block comments, quoted text, `${…}` params);
  READ only if ONE statement, no write keyword anywhere (INSERT UPDATE DELETE REPLACE UPSERT MERGE RETURNING INTO
  CREATE DROP ALTER TRUNCATE ATTACH DETACH VACUUM REINDEX GRANT REVOKE COPY CALL DO LOCK SET PRAGMA; `replace(…)` the
  string function excepted), and the lead keyword after leading parens / `WITH [RECURSIVE] … AS (…)` clauses is
  SELECT or VALUES. Everything else, incl. unreadable text, = WRITE (fail closed).
- WRITE = any `.run()`, a bare `?{}` statement, or SQL not provably a pure read → LISTED with: "an unhandled `?{}`
  WRITE (…): on impl#1 a failure throws today (HTTP 500, nothing after it runs); a fallback arm would swallow it
  silently and let the function continue as if it succeeded — handle it (retry, surface the failure, or move it
  into a `!` function and handle the result at the caller)". `SQL_FALLBACK.run` removed.
- Tests 22 (classifier read / write tables incl. RETURNING, WITH-led, comment-led, multi-statement, unclassifiable;
  write kinds listed in every position; doRevokeKey shape; reads rewritten; idempotence). commands 516/516.

### Corpus (111751330) — re-applied FROM THE BASE CORPUS with the final rule
- **Rewritten: 150 reads / 117 files** — examples 8/5, samples 40/20, conformance/cases 101/91, stdlib 1/1. By
  kind: const/let `.get()` 50 · `.all()` 18 · bare 2; return `.get()` 19 · `.all()` 42 · bare 4; keywordless `x =`
  bare 11; statement `.all()` 4.
- **Listed: 362** — writes 181 (`.run()` 155, bare statement 11, not-provably-SELECT 15); body top 71; gate:
  impl#1 codes changed 39; `@x =` in a function 38; terminator 10; lift 6; nested / captured decl 6; other 5;
  batching gate 2; tx control 2; body-split 1; impl#1 threw 1. (bare-identifier-body-e-sql-003-neg is now listed —
  `?{q}` is not provably a SELECT — so no hold-back is needed.)
- impl#1 conformance: 1268 pass + 50 xfail both sides, case by case identical. Bootstrap counter: PASS 121 / FAIL 56 /
  NOT-TWINNED 514 / UNSUPPORTED 627 / CRASH 0 both sides.
- Emit differential (base = archive of the base corpus + this compiler, sibling *.db copied): 0 compile-outcome
  changes, 0 diagnostic-code changes, syntax 0/0, bare server-fn sites 197 = 197; 464 of 11456 artifacts differ —
  347 noise (hash / renumbering / work-dir path) + 117 server.js read lowering (`_scrml_sql_attempt` + the `not` /
  `[]` arm). No client batching change.

## S239 r2 (LAND-WITH-NITS) — MED F1 + LOW F2 fixed (9a49a449f)
- A READ is now allowlisted, fail closed: one statement; SELECT / VALUES lead; no write keyword; NO locking clause
  (any `FOR`); every function call in PURE_FUNCTIONS (aggregates, coalesce/ifnull/nullif/iif/cast/greatest/least,
  string, abs/round, date/time, json_extract/object/array); no unmodelled string form (`E'…'`, `U&'…'`/`X'…'`,
  `$…$`, a backslash in quoted text) — else WRITE. `sqlWriteReason` names the cause ("a call of `nextval(…)`, which
  may have side effects"; "a locking clause"). Tests 23 (F1 / F2 shapes listed; allowlisted aggregate / scalar
  reads rewritten; idempotence). commands 517/517; types gate unchanged; pre-commit 30700/0.
- Re-applied from the base corpus: the output is BYTE-IDENTICAL to a78351c06's corpus (same 150 sites / 117 files;
  no site moved to listed). Corpus and compiler/src outside commands/ unchanged, so conformance (case by case),
  the bootstrap counter and the emit differential are as measured at a78351c06.
