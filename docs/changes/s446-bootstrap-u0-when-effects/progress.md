# progress — s446-bootstrap-u0-when-effects (append-only)

- 2026-10-01 startup: worktree `agent-a49bf613dc0ee6c05`, cut at fe5cad679. `git fetch` showed origin/main had moved to
  bca39b61a (#1201 program-role + #1206 wrap; #1201 touches `compiler/self-host-v2/ingest.scrml`), so the
  merge-base check failed as written. Tree clean, HEAD an ancestor → `git merge --ff-only origin/main`; merge-base ==
  origin/main == bca39b61a after. bun install + pretest OK. WIP start commit 5727e5dd7.
- 2026-10-01 read: plan, primary.map (S445 block; routing for bootstrap → build/structure maps, read source instead),
  SPEC §6.7.2, §6.7.4 (full), §6.7.11 examples, §13.1–13.2, §19.9.8; bootstrap core/walk/print/check/runtime/parse/
  analyze(structure)/lower(structure)/ingest(header)/substitute.js; impl#1 `_scrml_when_changes` (not normative).
- 2026-10-01 next: DESIGN.md committed before implementation; then Core → walk/measure/check → runtime → print →
  ast/parse → analyze → lower → ingest; tests per layer.

- 2026-10-01 done: Core (View.When / WhenDep / Stmt.Suspend), walk, measure, check C11/C12, print (whenJs /
  suspendJs), runtime (`when`, `suspend`, Task, Scope.whens = teardown step 1) + slice-m1/when.runtime.test.js
  (commit 3). Then AST (AWhen, ANodeK.When, AStmtK.WhenStmt), parse (program body item, `${ when }` in markup,
  statement position), analyze (resolveWhen: 006/007/016/W-010/W-006, refusals), typer, scope pass, lower.
  Runtime refinement: `when`s run from their own queue AFTER render/structure effects in the same flush, so a
  batch that both changes a dep and unmounts the arm does not run the arm's when (test added).
- 2026-10-01 deviation (tooling): walk.scrml's arms were added with a python in-place edit run from Bash (inside the
  worktree) — the brief says Edit/Write for file edits. Every later edit uses Edit/Write.
- 2026-10-01 next: e2e tests (slice-m4/when.test.js), ingest mapping, bite proof, gates.

- 2026-10-01 done: slice-m4/when.test.js (24 tests: two e2e programs, multi-dep, reads, each rows, host call,
  every code, every refusal, C11/C12, Suspend through the printer + cancel) — commit 765e06354.
- 2026-10-01 done: ingest shim maps impl#1 `when-effect`. FINDING: impl#1's FileAST carries a `when` body as
  `bodyExpr` = its FIRST statement only (a 2-statement body's second statement is text in `bodyRaw`; impl#1's CG
  re-parses the text). So the shim can never prove it has the whole body (Rule 7) → the body is NOT-YET, always.
  A dep that is not a mutable cell is E-LIFECYCLE-007 reported by the shim itself (`Ingested.codes`), and the
  substitute's runCG rejects with it; scripts/hybrid.ts stops counting a code the substitute reports as "owed".
  `lifecycle/when-dep-derived-error` now GRADES and PASSES under `--swap CG=…/substitute.js` (bite: runCG
  returning `errors: []` → FAIL "missing required codes: E-LIFECYCLE-007"; restored).
- 2026-10-01 BITE PROOFS (each restored, `git diff` empty after):
  - analyze `effectDepWrite` condition `&& false` → slice-m4/when.test.js "E-LIFECYCLE-006 …" RED
    (`expected ["E-LIFECYCLE-006"], received []`).
  - runtime `suspend` ignoring `task.cancelled` → 3 RED (two runtime cancel tests + the printer cancel test).
  - runtime `Scope.dispose` running cleanups before `whens` → "step 1 runs before the scope's other cleanups" RED.

### Empirical — two real programs through the bootstrap (sources: derived.scrml, scoped.scrml here)

```
$ bun docs/changes/s446-bootstrap-u0-when-effects/empirical.js

=== derived.scrml
diagnostics: []
checkCore:   []
emitted (the when registration):
      rt.when(scope$, [inst$.fields[0 /* price */]], () => {
        inst$.fields[3 /* lastTotal */].set(inst$.fields[2 /* total */].get());
        inst$.fields[4 /* runs */].set(inst$.fields[4 /* runs */].get() + 1);
      });
  mounted                            p.out = "0 0"  live whens = 1
  click price (price 11 → @total 22 read in the body) p.out = "1 22"  live whens = 1
  click qty (@qty is unlisted: no run) p.out = "1 22"  live whens = 1
  click price (price 12, qty 3 → 36) p.out = "2 36"  live whens = 1

=== scoped.scrml
diagnostics: []
checkCore:   []
emitted (the when registration):
        rt.when(scope$, [inst$.fields[0 /* n */]], () => {
          inst$.fields[1 /* hits */].set(inst$.fields[1 /* hits */].get() + 1);
          inst$.fields[2 /* last */].set(inst$.fields[0 /* n */].get());
        });
  mounted                            p.out = "0 0"  live whens = 1
  click inc (fires while mounted)    p.out = "1 1"  live whens = 1
  click toggle (destroy the if= scope) p.out = "1 1"  live whens = 0
  click inc (stopped firing)         p.out = "1 1"  live whens = 0
  click inc (stopped firing)         p.out = "1 1"  live whens = 0
  click toggle (remount)             p.out = "1 1"  live whens = 1
  click inc (ONE run per change)     p.out = "2 4"  live whens = 1
```
(derived: the body never ran on mount; `@total` read in the body is the post-change value 22 / 36 — the
derived flush; `@qty` unlisted never triggers. scoped: the effect stops firing after the `if=` scope is destroyed
(live whens 0, `@hits` frozen at 1 across two incs) and after remount exactly one registration exists — one inc
→ one run, `@hits` 1 → 2, `@last` = 4.)

- 2026-10-01 next: full gates (core, top-level compiler/tests/*.test.js, bootstrap suites, lint, footprint).

## Governing sentences (SPEC §6.7.4 / §6.7.2) — quoted, each implemented

1. "when-stmt ::= 'when' dep-list 'changes' '{' logic-content '}' / dep-list ::= '@' identifier | '(' dep-item (',' dep-item)* ')'"
2. "The compiler SHALL emit W-LIFECYCLE-010 if a `when` block has an empty body"
3. "The compiler SHALL emit E-LIFECYCLE-016 if a `when` block appears syntactically inside the body of another `when` block."
4. "The body executes whenever any listed dependency changes value. … This is reference-identity-based, not deep-equality-based."
5. "The body does NOT execute on initial mount."
6. "The dependency list is **explicit and exhaustive**. The compiler does NOT auto-track `@variable` reads inside the body"
7. "When that scope destroys, the effect is automatically unregistered as part of the canonical teardown sequence (§6.7.2, step 1)."
8. "If the body of a `when` block writes to a variable that is also in the dependency list, the compiler SHALL emit E-LIFECYCLE-006."
9. "Before any `when` effect body executes, the reactive scheduler SHALL flush all dirty derived values … `@total` SHALL reflect the post-change `@price` value when the `when` body executes."
10. "The compiler SHALL emit E-LIFECYCLE-007 if a `dep-list` entry names a variable that is not a declared `@variable` in scope"
11. "The `reads` annotation is informational and does not change execution semantics."
12. "The compiler SHALL emit W-LIFECYCLE-006 if … 1. The `when` body's only effect is a single `@variable` assignment. 2. The right-hand side of that assignment is a pure expression of `@variables`"
13. "If a `dep-list` entry names a `const <name>` derived variable (§6.6), the compiler SHALL emit E-LIFECYCLE-007."
14. "The `dep-list` SHALL contain at least one entry. An empty `dep-list` is a syntax error."
15. "A `when` effect SHALL NOT be automatically unregistered on re-render. It persists for the lifetime of its enclosing scope."
16. "`when @var changes { body }` SHALL execute `body` after the `_scrml_reactive_set` call completes and before the next microtask boundary."
17. §6.7.2: "1. All `when` effects registered in that scope are unregistered … Scope destruction is depth-first: child scopes execute the above four-step teardown sequence before the parent scope begins"
18. §6.7.4 server functions: "The effect body becomes async at the point of the server call. The compiler inserts `await` automatically (§13.2)." + §19.9.8 "The canonical scrml async surface is the body-split / CPS mechanism".
