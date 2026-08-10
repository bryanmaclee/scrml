# progress — `tare(@cell)` statement-position reset baseline

Append-only. Crash anchor for the S337 dispatch.

## Startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0565f339b2799993` — OK, worktree-isolated.
- `git rev-parse --show-toplevel` matches; tree clean at base `2cc0e4fca07ecc24e4064bd2ba0fc45613f4e491` (== `main` tip at dispatch).
- Branch: `worktree-agent-a0565f339b2799993`.
- `bun install` — 217 packages OK.
- `bun run pretest` — samples/compilation-tests/dist populated OK.
- BRIEF.md was untracked in the main checkout; copied verbatim into this change dir and committed here as the archive (S133).

## Survey findings (empirical, at base `2cc0e4fc`)

**Bug reproduced verbatim.** `${ @x = 0  @x = @x + 1 }` emits, in module-init source order:
```js
_scrml_cs_reactive_set("x", 0);
_scrml_cs_init_set("x", () => 0);
_scrml_cs_reactive_set("x", _scrml_cs_reactive_get("x") + 1);
_scrml_cs_init_set("x", () => _scrml_cs_reactive_get("x") + 1);   // clobbers
```

**The placement mechanism the brief predicted EXISTS and is verified.** A top-level `reset(@x)`
statement inside `${ … }` emits `_scrml_cs_reset("x");` into module-init **in source order**, between
the surrounding cell writes. So a statement-position `tare(@x)` lands exactly where the author put it —
no static analysis needed, source position does the discriminating.

**Free diagnostics (verified by compiling, not by reading):**
- `reset(@nope)` on an undeclared cell already fires `E-STATE-UNDECLARED` via the generic `@`-read
  check, purely because `forEachIdentInExprNode` recurses into the reset target. `tare` inherits it by
  mirroring that recursion — zero new code.
- `reset(@derivedConst)` compiles CLEAN today (no `E-DERIVED-WRITE`), even though §6.8.1/§6.8.2 say it
  is a write error. That is a PRE-EXISTING `reset` gap, filed below as a deferred item. `tare` fires the
  error at birth (newly-accepting surface ⇒ no migration cost); retrofitting `reset` would be a
  newly-REJECTING change to shipped surface and needs its own ruling.

**Reserved-name migration re-verified: ZERO.** `git grep -nw tare -- '*.scrml'` over 2359 tracked
`.scrml` files returns nothing; the only repo-wide `.md` hits are this change dir.

## Surface to touch (mapped from source, not guessed)

| file | why |
|---|---|
| `compiler/src/tokenizer.ts` | `tare` joins `reset` in `KEYWORDS` (reserved name) |
| `compiler/src/types/ast.ts` | `TareExpr` node + `ExprNode` union member |
| `compiler/src/expression-parser.ts` | lift `tare(…)`; 9 exhaustive-switch walkers; new `forEachTareExprInExprNode` |
| `compiler/src/ast-builder.js` | `TYPE_BOUNDARY_KEYWORDS`; 4 `E-RESERVED-IDENTIFIER` decl sites; 2 parse-diagnostic surfacing sites |
| `compiler/src/symbol-table.ts` | B22 target validation → `E-TARE-INVALID-TARGET`; derived-const → `E-DERIVED-WRITE` |
| `compiler/src/component-expander.ts` | prop substitution into target + defaultExpr |
| `compiler/src/meta-checker.ts`, `compiler/src/body-dg-builder.ts` | ExprNode walkers |
| `compiler/src/codegen/emit-expr.ts` | the lowering |
| `compiler/src/runtime-template.js` | `_scrml_tare`, under its own `'tare'` chunk marker |
| `compiler/src/codegen/index.ts` | `CELL_SCOPE_ACCESSORS` → gives `_scrml_cs_tare` for free |
| `compiler/src/codegen/emit-client.ts` | post-emit chunk gate |
| `compiler/src/codegen/runtime-chunks.ts` | the new `'tare'` chunk + its marker |

## Design decisions taken (with reasons)

1. **`tare` is a distinct node kind (`tare-expr`), not a flag on `reset-expr`.** A flag would make every
   existing reset consumer treat a tare as a reset.
2. **ONE traversal, two typed façades.** `forEachResetExprInExprNode` and `forEachTareExprInExprNode`
   both delegate to a single private `forEachResetFamilyExprInExprNode`. Adding a second full copy of a
   60-line walker is exactly the "four places answer the same question and disagree" shape this repo
   keeps paying for (primary.map invariant 49).
3. **`_scrml_tare` gets its OWN `'tare'` runtime chunk** (revised — see "Corrections" below), gated
   SOLELY on `_scrml_tare(` in the emitted text. Gating on the emitted call rather than an AST shape is
   the ground-truth form invariant 42 requires, so the definition can never end up narrower than the
   reference.
4. **`tare(@x)` with no init thunk yet is a documented NO-OP, not a diagnostic.** Reasons: (a) tare's
   contract is "promote the CURRENT init thunk" — with none, there is nothing to promote; (b) writing
   the absent slot would put `undefined` in `_scrml_default_fns`, and undefined does not exist in scrml
   (§42); (c) the no-op leaves §6.8.1's init fallback intact, i.e. exactly what the program would have
   done without the tare — the reversible direction; (d) the genuinely-wrong shape (the cell does not
   exist at all) is already an ERROR via `E-STATE-UNDECLARED`, so the silent case is only "you tared
   before the first write", which no static check can distinguish from a legitimate tare inside a
   handler.
5. **Two new §34 codes: `E-TARE-NO-ARG`, `E-TARE-INVALID-TARGET`.** Reusing the `RESET`-named codes for
   a `tare(...)` call would put two unrelated meanings on one code (invariant 23) and print the word
   "reset" at a `tare` call site. `E-DERIVED-WRITE`, `E-RESERVED-IDENTIFIER` and `E-STATE-UNDECLARED`
   ARE reused — those rules are about the CELL, not the keyword.

## Corrections made mid-build (both caught by MEASURING, not by reading)

**(a) The runtime chunk was wrong the first time.** `_scrml_tare` initially went into the existing
`'reset'` chunk. The byte-identity probe then showed the runtime bundle for a `default=`-only fixture
changing size against base — i.e. every page that merely calls `reset()` was now carrying a helper it
never references, which violates the runtime-minimality rule. `_scrml_tare` touches only
`_scrml_init_fns` / `_scrml_default_fns`, both of which live in `'core'`, so it has NO dependency on the
reset runtime; and reset-without-tare is the common shape by a wide margin. It now has its own `'tare'`
chunk. Knock-on: `compute-pgo-flags.ts` needed no change at all and was reverted to base — lighting the
reset chunk from a `tare-expr` would have shipped the whole reset runtime to a tare-only page. After the
split, the `default=` fixture's `client.js`, `.html` AND runtime bundle are byte-identical to base.

**(b) Backticks in `runtime-template.js` are a syntax error.** The whole runtime is a JS template
literal, so a `` `name` `` in a comment terminates it. This cost one red gate: an edit landed while a
background commit's test suite was running, and the failure surfaced as a live-Postgres integration test
reporting `relation "invoices" does not exist` — the CLI could not load the compiler at all, so
`db-migrate` never ran. Two rules for a future editor: no backticks and no `${` inside
`runtime-template.js`, and do not edit source while a background gate is running.

## Verification (all EXECUTED, not inferred)

**Runtime values, printed by `compiler/tests/browser/tare-observed-values.probe.mjs`** (compiles, loads
the real runtime + client bundle in happy-dom, dispatches real clicks, reads the live store):

```
[1] counter, NO tare — compile errors: []
    after module-init : @x = 1
    after reset(@x)   : @x = 2      <- INCREMENTS (the defect)

[2] counter, tare(@x) after the first write — compile errors: []
    after module-init : @x = 1
    after reset(@x)   : @x = 0      <- RESTORES 0
    after reset again : @x = 0      <- idempotent

[3] config merge, tare(@config) after the last write — compile errors: []
    after module-init : @config = {"theme":"dark","size":1}
    after scramble    : @config = {"theme":"scrambled","size":99}
    after reset       : @config = {"theme":"dark","size":1}   <- RESTORES THE MERGED VALUE
    rendered <p>      : "dark"

[4] tare(@n, @factor * 2) — compile errors: []
    after module-init : @n = 999, @factor = 10
    after reset(@n)   : @n = 20     <- @factor(10) * 2
    @factor -> 50, reset again : @n = 100    <- THUNK re-evaluated, not a snapshot
```

**Structural `default=` path byte-identity.** Same fixture, same absolute input path, compiled by the
BASE compiler and the HEAD compiler: `probe.client.js` byte-identical, `probe.html` byte-identical, and
the runtime bundle byte-identical (59,828 bytes both sides).

**Corpus emit-differential** (`bun scripts/corpus-emit-differential.ts`, base `2cc0e4fc` vs head, roots
`examples,samples,conformance,stdlib,benchmarks`): base 1904 sources / 7375 artifacts, head 1911 / 7396.

- compile-failure delta **0 newly failing / 0 newly passing**
- diagnostic **code** changes **0**
- artifact SET delta **0 added / 0 removed** — the runtime bundle filename embeds its content hash, so
  this alone proves the runtime is byte-identical for all 1870 emitting corpus sources
- artifact CONTENT diffs 1014 of 7375 — **all 1014 classified as token-only** and **0 real emission
  differences**. Both captures compile the same sources from different absolute roots, and the per-chunk
  namespace token is a hash of the source PATH; after normalizing that token (and the runtime-hash
  filename) every one of the 1014 pairs is byte-identical. The single "text-only diagnostic change"
  (`control-flow/if-in-dispatched-arm-neg`) is the same token inside a dispatcher name
  (`match_00m4n0d0_8` vs `match_00r1enft_8`).
- syntax delta under both goggles **0 new / 0 fixed / 0 message-changed**; load-context changes 0
- bare client server-fn call sites base 145 / head 145 (delta 0)
- source-set delta **7** — exactly the seven new conformance cases. The tool reports
  `NOT A VALID COMPARISON` purely because the source sets differ; every measured axis is still reported
  and is listed above.

**Diagnostics emitted by the 7 new sources — exactly the intended codes, nothing else:**

| case | exit | codes |
|---|---|---|
| tare-first-write-baseline-rt | 0 | I-FN-PROMOTABLE, W-PROGRAM-001 |
| tare-last-write-baseline-rt | 0 | I-FN-PROMOTABLE, W-PROGRAM-001 |
| tare-explicit-default-thunk-rt | 0 | I-FN-PROMOTABLE, W-PROGRAM-001 |
| tare-no-arg-pos | 1 | **E-TARE-NO-ARG**, W-CG-UNDEFINED-INTERPOLATION, W-PROGRAM-001 |
| tare-invalid-target-pos | 1 | **E-TARE-INVALID-TARGET**, W-CG-UNDEFINED-INTERPOLATION, W-PROGRAM-001 |
| tare-derived-write-pos | 1 | **E-DERIVED-WRITE**, W-PROGRAM-001 |
| tare-reserved-identifier | 1 | **E-RESERVED-IDENTIFIER**, W-DEAD-FUNCTION, W-PROGRAM-001 |

The companion `W-PROGRAM-001` / `I-FN-PROMOTABLE` / `W-CG-UNDEFINED-INTERPOLATION` / `W-DEAD-FUNCTION`
notices are the same ones the sibling `reset-*` conformance cases carry (none of them wrap in
`<program>` either).

**§34 census** (`bun scripts/s34-census.ts`): 807 → **809** rows. `PINNED` 341 → **343** (both new codes
are positively asserted by a conformance case, not merely catalogued). `IMPL-SITES` 320 and
`FALSE-CLAIM` 95 unchanged.

**Reserved-name migration re-verified at the base SHA:** `git grep -nw tare 2cc0e4fc -- '*.scrml'`
returns **0**. At head the only hits are the seven new conformance cases.

**Bite test.** `tare-first-write-baseline-rt` was given a deliberately wrong expected value; the
conformance run went 888 pass / 1 fail, then back to 889 / 0 on revert. The case is not a no-op.

**Full suite at the landing commit:** 28,778 tests across 1,234 files, 0 failures.

---

# FIX ROUND (S337) — 3 adversarial findings

All three reproduced by execution before any code was touched. Two are confirmed as stated; one
finding's REPRODUCER was wrong (the finding itself was right); one finding turned out to be a
pre-existing family-wide property rather than a tare defect, proven against the BASE compiler.

## Finding 1 — HIGH — false `E-TYPE-001` on `tare(@cell.field)` — FIXED

**Before:** `tare(@user.token)` on a lifecycle-annotated struct field → 2× `E-TYPE-001`; the
byte-identical program with `reset(@user.token)` → clean.
**After:** clean, and equal to the reset program.

**The suggested fix would have been wrong, and both halves are now pinned by tests.** Adding
`tare-expr` to reset's `bare-expr` interception does two damaging things:

1. it REVERTS §6.8.3 per-access lifecycle state. §6.8.3 reverts "based on the resulting written
   value" — a reset writes the cell, a tare writes only `_scrml_default_fns`. Reverting swaps a
   false positive for a false negative.
2. it `continue`s past `extractAccesses`, silently swallowing a genuine pre-transition read in the
   two-argument form's second slot (`tare(@n, @user.token)`). `reset` has no second argument, so its
   whole-call span is safe; tare's is not.

Installing the naive variant makes the two design tests go red — measured, not asserted. So the
suppression is TARGET-ONLY (`tare(@target`, no closing paren) and performs no revert.

**Site enumeration, by execution not grep.** A reset-vs-tare diagnostic-parity probe over 7
lifecycle/compound shapes: 1 divergence before, 0 after. Checked and NOT affected —
- **Tracker 1** (Shape-1 cell-value lifecycle, bare and dotted): clean both ways. Its
  `FIELD_ACCESS_RE` needs a dot, and its `RESET_CALL_RE` drives a revert a tare must not have.
- **`usage-analyzer.ts` `usage.reset`**: computed and never read — no consumer anywhere in the tree.
- **`compute-pgo-flags.ts` / `emit-client.ts` reset probe**: correct as-is. `tare` has its own runtime
  chunk and its own post-emit gate, so it must NOT light the reset one. `emit-client.ts` is contended
  and was not touched.

## Finding 2 — the serious one — FIXED as `E-TARE-BEFORE-DECL` (new §34 code)

**I agree with the finding and disagree with its reproducer.** The stated reproducer uses a
STRUCTURAL `<x> = 0`, and that program is already correct today:

```
tare(@x)          f2_structural_forward, BEFORE the fix:
<x> = 0             after module-init : @x = 1
@x = @x + 1         after reset(@x)   : @x = 0    <- CORRECT, no increment
```

because #417's reassignment guard stops the second write registering an init thunk, so reset resolves
through the INIT path. The tare no-ops, but nothing observable goes wrong. The real reproducer needs
an IMPLICIT cell, where BOTH writes register thunks:

```
tare(@x)          f2_implicit_forward, BEFORE the fix:
@x = 0              after module-init : @x = 1
@x = @x + 1         after reset(@x)   : @x = 2    <- INCREMENTS. zero diagnostics.
```

**Ruling taken: REJECT, not warn.** `tare`'s entire contract is that source position is the
discriminator; a call positioned where it provably cannot promote anything is a mistake, not a style
choice. Rejecting is also the reversible direction on brand-new surface — relaxing an error later
(e.g. if a "pending tare" semantic is ever ruled) is easy; un-accepting a silent wrong answer is not.
I deliberately did NOT invent a pending-tare runtime semantic, which would be a design change needing
its own ruling.

**Two implementation traps hit and fixed, both found by measuring:**

- **Coordinate space.** The first draft compared the tare ExprNode's span to the decl's span. An
  ExprNode span is BLOCK-LOCAL (`start: 0, line: 1` for the first statement of a `${ … }` block)
  while a state-decl span is FILE-ABSOLUTE — two origins, so the check silently never fired. It now
  uses the enclosing STATEMENT node's span (invariant 19: pick one coordinate space).
- **Last-wins scope records.** The second draft compared against `StateCellRecord.declNode`, which for
  an IMPLICIT cell points at the LAST write — so it REJECTED the flagship worked case
  (`@x = 0; tare(@x); @x = @x + 1`). It now uses a lazily-built `cellName -> EARLIEST state-decl
  offset` map. Lazy because a file with no `tare` must not pay for the walk across the ~1900-source
  corpus.

**False-positive sweep — 4 must-fire, 8 must-not-fire, 0 problems.** Must-not-fire includes: the
correctly-ordered worked case, a tare inside a function body above the decl, a tare inside a LAMBDA
above the decl (the family walker gained a `skipDeferredBodies` option for exactly this), the two-arg
form, and `reset` above a decl (the rule is tare-only).

**The runtime comment's false rationale is corrected.** It claimed the only route to the no-op was a
cell that does not exist, "a COMPILE error, E-STATE-UNDECLARED". That was false and it is the part
worth flagging: it told the next reader there was nothing to look for. The corrected comment names
the two honest remaining routes (a deferred tare firing before anything wrote the cell; an
object-literal compound with no per-field thunks).

## Finding 3 — LOW — documented in §6.8.4, NOT diagnosed — with the reason

**It is not a tare defect. It is pre-existing and family-wide, proven against the BASE compiler**
(which has no `tare` at all):

```
base compiler, f3_objlit_resetonly — NO tare anywhere in the source:
    <form> = { a: 1, b: 2 };  scramble -> {"a":1,"b":99};  reset(@form.b) -> {"a":1,"b":99}
base compiler, f3_structural_resetonly:
    <form><a/><b/>;           scramble -> {"a":1,"b":99};  reset(@form.b) -> {"a":1,"b":2}
```

An object-literal compound registers ONE reset target (`form`), so `@form.b` is not a target for
EITHER keyword. `tare` inherits it exactly and adds nothing.

**Why documented rather than diagnosed.** Diagnosing it for `tare` only would leave two members of one
family disagreeing about the same target — strictly worse than the shared limit. Diagnosing it for the
whole family is a newly-REJECTING change to shipped `reset` surface and needs its own ruling; it is
surfaced to PA instead. §6.8.4 now carries it as a named known limit with the reason and the fix (use
the structural child form). The test asserts the durable property — that tare and reset AGREE on this
target — which keeps holding after a future family-wide fix, whereas pinning today's no-op would have
to be deleted by it.

## Fix-round verification

- unit `tare-emit-and-diagnostics.test.js`: 17 → **27 tests**, all green.
- browser: `browser-tare-reset-baseline.test.js` (4) + NEW `browser-tare-forward-position.test.js` (2)
  — the latter EXECUTES both sides: the refused bundle really does yield 2, the corrected one yields 0.
- conformance: **+1 case** (`reactive/tare-before-decl-pos`), 890 pass / 0 fail.
- §34 census: 809 → **810** rows; PINNED 343 → **344**; IMPL-SITES 320 and FALSE-CLAIM 95 unchanged.
- `default=` byte-identity vs base: client.js, html AND runtime bundle still byte-identical
  (59,828 bytes both sides).
- corpus delta vs base — **unchanged from the pre-fix-round result**: 0 newly failing / 0 newly
  passing, **0 diagnostic CODE changes**, 0 artifact set delta, 1014 artifact content diffs of which
  **1014 are token-only and 0 are real emission differences**, syntax delta 0/0/0, bare server-fn
  sites 145 → 145. Source-set delta 8 = exactly the tare conformance cases. The 1 "text-only
  diagnostic change" is the same pre-existing chunk-token-in-a-dispatcher-name artifact as before.

### Before/after per finding

| finding | before | after |
|---|---|---|
| 1 false E-TYPE-001 | 2 unit tests RED (`…not a READ`, `…PARITY`) | green; parity probe 1 divergence → 0 |
| 1 design (naive fix) | 2 unit tests RED on the naive variant (`…does NOT revert`, `…SECOND argument`) | green on the real fix |
| 2 forward-position tare | executed: `reset(@x)` → **2** (increment), 0 diagnostics | `E-TARE-BEFORE-DECL`; corrected program executes → **0** |
| 3 object-literal compound | tare and reset both silent no-ops | unchanged by design; parity asserted, limit documented in §6.8.4 |
