# s449-bootstrap-no-write-formulas — progress (append-only)

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a3ffde5c54c183da0`, base `origin/main` 8b58ed588.

## 2026-10-02 — startup
- Startup checks clean; `bun install`, `bun run pretest` ran.
- Baseline slice gates: lint 0 violations · m1 99/0 · m2 448/0 · m3 60/0 · m4 465/0 (+1 todo) · codec 92/0 ·
  m1 lowered 99/0 · lexer 337/0.
- Ruling read verbatim: user-voice-scrml.md §S449 item 3 ("Initializers / derived formulas / markup interpolations may
  NOT write reactive state = (a) — a compile error everywhere, directly or through a called function").
- SPEC branch `wip/s449-spec-lifecycle-rulings` @ bcc0edcd3 has item 2 (`<onMount>`, E-MOUNT-WRITES-STATE /
  E-MOUNT-WRITE-UNPROVEN) but NOT item 3 yet. **PROVISIONAL codes** (one constant each, analyze.scrml
  `formulaWritesCode()` / `formulaUnprovenCode()`; the tests name them once in `CODE` / `UNPROVEN` / `SRC`):
  `E-FORMULA-WRITES-STATE`, `E-FORMULA-WRITE-UNPROVEN` — chosen to match the item-2 naming pattern.

## 2026-10-02 — the source-side check (analyze.scrml)
- `sourcePositions` collects every initializer (each program cell's own value; each user declaration's own value,
  attribute-field defaults and child-field initializers at any depth — syntactic walk over `g.decls`) and every
  render position (walk of `declMarkup`: interpolations, every attribute but `on…=` / `bind:` / `as=` — decided by
  NAME, so a refused attribute is still judged — covering `if=`, bound attributes, use-site values, `<each in=>` /
  `key=`, inside `renders` and state-child bodies; `<effect>` nodes skipped — their bodies are the effect rule's).
- Each is scanned with the effect rule's `scanValue` and judged against the same `fnSummaries` fixed point
  (built only when some position refers to a function, or an effect exists). Write / write chain →
  E-FORMULA-WRITES-STATE naming the position and chain; unresolvable / unsummarized → E-FORMULA-WRITE-UNPROVEN.
  Source diags are emitted BEFORE the effect diags (root cause first).
- `scanExpr` now records a write at ANY depth (stmtWrite per node) instead of only at a statement — an
  interpolation has no statement (`${ @xs.push(1) }`); a write nested in a function body's expression is now counted
  too (strictly more conservative).
- impl#1 bug hit (impl#1 frozen, noted): a local `const plain` inside `attrWhat` resolved to the top-level
  `fn plain` when used in a match arm — the message printed the function's JS source. Renamed to `plainWhat`.

## 2026-10-02 — DEAD-PROOF, measured BEFORE removing the special cases
With the source check ON and the effect pass's construction / formula summaries and the reset-value refusal still
present, every hole program from the s449 effect review got the source-side error FIRST, at the writer's own source:
```
hole 1 construction (effect reads @box.k):     E-FORMULA-WRITES-STATE "bumpA()" (initializer of @box.k) · then E-EFFECT-WRITES-STATE "@box.k"
hole 1b construction via a rendered decl:      E-FORMULA-WRITES-STATE "bumpA()" (initializer of @inner.k) · then E-EFFECT-WRITES-STATE
hole 2 derived read via a function:            E-FORMULA-WRITES-STATE "g()" (formula of @d) · then E-EFFECT-WRITES-STATE "peek()"
hole 3 field init reading a writing formula:   E-FORMULA-WRITES-STATE "g()" (formula of @d) · + duplicate at "@d" · then E-EFFECT-WRITES-STATE
hole 4 reset value:                            E-FORMULA-WRITES-STATE "bump()" (initializer of @page) · then E-BOOTSTRAP-UNSUPPORTED
hole 4b reset value via a derived cell:        E-FORMULA-WRITES-STATE "g()" (formula of @d) · + dup · then E-BOOTSTRAP-UNSUPPORTED
```
So each special case only ever co-fired behind the source error → removed.

## 2026-10-02 — SIMPLIFY (removed)
- `constructionRef`, `formulaRef` and their helpers (`sharedDeclRead`, `sharedOf`, `constructionLabel`,
  `formulaFieldRead`, `readField`, `DeclField`, `mkDeclField`, `formulaLabel`), the construction and formula
  summaries in `fnSummaries` (`constructionScan`, `usedDecls`, `useOf`), the `writesThrough` construction / formula
  message arms, and `resetValueDiags` (the E-BOOTSTRAP-UNSUPPORTED "writing reset value" refusal). C11 in check.scrml
  untouched (second line of defence); its two construction / formula tests now build a clean program and GRAFT a
  writer's Core body into the write-free `seed()` / `g()` (no source program can reach Core with one any more).
- After removal (same probe): each hole program reports exactly ONE diagnostic, the source-side one.
- Tests: effect.test.js (the three hole tests rewritten as dead-proofs: only E-FORMULA-WRITES-STATE), reset-on.test.js
  (the reset-value test: only the source error, 3 shapes + negative), new slice-m4/no-write-formulas.test.js (22).
- Bite: `sourcePositions` returning `[]` → slice-m4 24 RED (all 22 new + 3 effect dead-proofs… + reset-on); restored GREEN.

## 2026-10-02 — corpus impact (brief step 5) — STOP-AND-REPORT item
slice-m4 / m1 / m3 / codec / lexer: all green; every `src/*.scrml` program still compiles clean. **slice-m2
front.test.js: 5 tests now fail** — their programs write from a render hole ON PURPOSE (it is what they test), so NOT
migrated (brief: migrate only if incidental):
- `S440 N1 … a side-effecting override in a render hole beside a sibling writer converges` (guarded / unguarded):
  `<p>${e1()}</p>` / `<p>${e2()}</p>` where e1/e2 write `@h` / `@log` — a render-hole write loop's convergence.
- `S440 F-A — a Commit outside a handler batch …` cases A, B, refused: `<p>${react()}</p>` where `react()` writes `@g`
  — the Commit reached from a render hole (outside a handler batch) must be atomic.
Both describe runtime properties that are now UNREACHABLE from source (no render hole, initializer, formula or effect
may write). Fork for the PA (final report).
