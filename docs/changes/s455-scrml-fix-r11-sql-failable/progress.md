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
