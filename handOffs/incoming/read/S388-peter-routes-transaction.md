# S388-peter → bryan — ONE routed item (a parser/transaction-semantics fix, turnkey)

**From:** S388-peter (Windows). **Date:** 2026-08-29. **Base:** main `c7e2d6e0` (post-#765).
**Lane:** this is parser + transaction-semantics (how `transaction {}` §19.10.2 lowers), not a scoped
adopter codegen fix — front-end/language territory, so it's yours. Everything short of the fix-direction
ruling is done below. Surfaced by the 2a aM-db-migration proving arc (harness: scrml
`scratchpad/dogfood/db-migration-proof/`).

---

## `g-transaction-block-not-recognized-inside-a-function-body` — HIGH

**One-line:** the `transaction { … }` block (§19.10.2, normative) compiles fine at the top level of a
`${}` logic block but is **NOT recognized inside a function body** — there it degrades to a bare
identifier and fires `E-SCOPE-001: Undeclared identifier transaction`. Since every real transaction
lives in a function, the feature is effectively unavailable, and there is **no working native atomic
multi-write** as a result (see the atomicity consequence below).

### PA-CONFIRMED by execution — and reproduced on the COMMITTED sample
The committed sample `samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001.scrml` (its own
comment: *"Should compile clean."*) **does NOT compile on HEAD** — `E-PA-002` (sandbox db-path, ignore)
+ **`E-SCOPE-001` on `transaction`**, plus a `[scrml] warning: statement boundary not detected —
trailing content would be silently dropped` from the ASI/trailing-content guard.

**Positional isolation (`scratchpad/dogfood/db-migration-proof/tx-isolate.mjs`), content held constant:**

| case | result |
|---|---|
| `transaction { ?{…}.run() }` at **top level** of `${}` | ✅ compiles clean (BEGIN/COMMIT emit) |
| `transaction { log("a") }` at top level (no sql) | ✅ compiles clean |
| `transaction { log("a") }` **inside a `function` body** | ❌ **E-SCOPE-001** |

Purely positional — the body content (sql vs not) is irrelevant. It fails iff the `transaction {}` is
inside a function body. (Reproduced across 6 wrapper variants incl. `<db src>`/`<program db=>`,
`server function`/`function … !`.)

### PA-traced root (a HYPOTHESIS — re-derive; the fix direction is yours)
The correct handler EXISTS: `ast-builder.js:13707` builds a `transaction-block` node when
`tok.kind === "KEYWORD" && tok.text === "transaction"`, and `STMT_KEYWORDS` (ast-builder.js:4500,
5469) already includes `"transaction"`. But that handler sits on the **statement path** the
function-body collection never reaches: `collectExpr` (ast-builder.js:4417) funnels the function body's
`transaction { … }` into `parseExpression`, where `transaction` parses as an identifier and the `{…}`
body is dropped as trailing content — that is the `expression-parser.ts:3013-3015` warning. So the
degradation is: function-body statements are collected as an expression init instead of routed through
the `transaction-block` statement handler. **Not a missing-keyword-list gap** (the lists have it) — a
body-routing gap. The exact seam is yours to converge; I did not want to over-specify the collector
line.

### NOT gate-covered (why it rotted)
Nothing in `compiler/tests` compiles a `transaction {}`-in-function to green. The sample is referenced
only by `e2e-render-map-baseline.json` + `parser-conformance-within-node-allowlist.json` — neither
asserts a clean compile. A merge-blocker conformance case pinning `transaction {}`-in-function (codes-half
= compiles clean; runtime-half = atomic rollback) is owed with the fix.

### ⚑ THE ATOMICITY CONSEQUENCE — this is why it's HIGH, not just a broken sample
`transaction {}` is the ONLY primitive that auto-emits `?{ROLLBACK}` (§19.10.3). With it unavailable in
functions, the two workarounds are BOTH unsafe — PA-CONFIRMED by execution (a forced mid-loop dup-PK
throw during a whole-table replace-all; `scratchpad/dogfood/db-migration-proof/atomicity.mjs`):

| pattern | on a mid-write error |
|---|---|
| explicit `?{BEGIN}`/`?{COMMIT}` (non-`!`) | table unchanged BUT **DB left LOCKED** — tx never closed → `SQLITE_BUSY` for every later writer (§19.10.4 "no tx left open" violation) |
| implicit per-handler §19.10.5 (`!` handler, no BEGIN) | **PARTIAL DATA persists** — DELETE + 1st INSERT committed; the envelope does not wrap DELETE+INSERT writes (autocommit), for a loop AND a static set |

So a native app has **no safe atomic replace-all** — the exact guarantee an adopter's host-JS
`db.js` gets free from bun's `d.transaction(fn)`. This blocks the aM Fleet-domain db.js→`?{}` migration
(the guarded whole-table replace-all across Assets + 5 positional-key domains). Everything ELSE in the
migration is PA-proven working natively (CRUD, ordered SELECT→struct[], sha256 optimistic-concurrency
guard on the HAPPY path, role-union gate, targeted UPDATE, regex/date derivation) — atomicity-on-error
is the sole gap.

### THE FORK (direction is yours; both are language rulings)
- **Fork A — fix the routing (recommended): make `transaction {}` reach its handler inside function
  bodies.** Route function-body statement collection through the `transaction-block` path
  (ast-builder.js:13707) the same way the top-level statement loop does, so `transaction { … }` in a
  function lowers to `?{BEGIN}`…`?{COMMIT}`/`?{ROLLBACK}` per §19.10.3. Class: conformance restoration
  TOWARD §19.10.2 (newly-**accepting** a form the spec already mandates — not a widening; cf. the S385
  channel-cell §6.1.2 restoration). This is the fix that unblocks the migration and closes the atomicity
  hole in one move. **Test-sketch:** the `atomicity.mjs` explicit-vs-transaction pair — a `transaction {}`
  version of `saveExplicit` must, on the dup-PK throw, leave the table UNCHANGED *and* the DB WRITABLE
  (no lock leak).
- **Fork B — if `transaction {}`-in-function is intentionally out of scope**, then §19.10.2's own example
  (`function transferFunds(…)! { transaction {…} }`) and the sample must be struck/amended, AND a safe
  atomic-replace-all path documented (fix the §19.10.5 envelope to actually wrap multi-write handlers, or
  a `.tx()` builder). This is the higher-cost branch and leaves the sample/spec example lying until done.

**PA recommendation: A.** The spec's own §19.10.2 example puts `transaction {}` inside a function; the
committed sample does too; the handler already exists and is correct — this reads as a body-routing
regression that the gate never guarded, not a design boundary. B only if you actually intend
`transaction {}` to be top-level-only, which the normative example contradicts.

### Not blocking a Peter build (if you scope the fix direction)
The atomicity hole blocks the aM migration, but the migration itself is otherwise ordinary compute and
does not wait on you — only the transaction ruling + fix does. If you rule direction A and scope the
collector seam, the build can come to Peter (conformance-restoration, reviewed); the parser-architecture
call is what's yours.
