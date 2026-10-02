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

## 2026-10-02 — the SPEC landed: §6.15, E-VALUE-WRITES-STATE / E-VALUE-WRITE-UNPROVEN (commit 17e272804)
- PA relayed + I read `wip/s449-spec-lifecycle-rulings` @ a8aba4380 §6.15 in full. Codes renamed from the
  provisional E-FORMULA-* (still one constant each: `valueWritesCode()` / `valueUnprovenCode()`).
- **SPEC overrides the brief on one removal (Rule 4).** §6.15: "Each value position is summarized like a function,
  so a READ of something that evaluates a value position carries that position's summary" and "§6.7.4's write
  summary still follows reads into formulas and constructions — it now finds nothing there for a well-formed
  program, and the check stays as defence in depth." So `constructionRef` / `formulaRef` and their summaries were
  RESTORED (removed in a59e40582). The reset-value E-BOOTSTRAP-UNSUPPORTED stays removed — §6.15 names it
  superseded.
- **Echo suppression (PA reading for veto).** With both checks live, an ill-formed program reports its root at the
  value position AND an echo at every reader (effect body, interpolation reading the derived cell). effectPass
  computes ROOTS (chains not through a formula / construction label) and, when any root exists, drops chains through
  a value position; when none exists the echoes are reported — that is the defence in depth firing because the
  value-position walk missed something. Bite: value-position walk off → slice-m4 24 RED, and the effect-hole
  programs then report E-EFFECT-WRITES-STATE through the formula / construction (defence in depth seen working).
  Known imprecision: a function summary keeps only its FIRST witness; if that one runs through a formula while
  another callee writes directly, the direct chain is hidden until the formula is fixed (the program is rejected
  either way).
- Messages: position named per §6.15 ("the initializer of `@page`", "the formula of derived `@d`", "the
  interpolation", "the `class=` value on `<p>`", "the `if=` condition on `<p>`", "the use-site value `title=` of
  `<card>`"), cell, chain, and §6.15's fix by shape verbatim (initializer / formula / render). Line numbers are not
  in the text (the diagnostic span carries the location).

## 2026-10-02 — partition check against §6.15 (match exactly; ambiguities noted, not decided)
- Value positions covered: initializers (program cell own value, user-decl own value, attribute defaults, child
  fields any depth, use-site construction values), derived formulas, render expressions (interpolations, every
  attribute value incl. `class=` / `show=` / `if=` / `<each in=>` / `key=`, in program body / `renders` / state-child
  bodies). Absent from the bootstrap (nothing to judge): `default=`, multi-statement `${ }` in markup, Tier-0
  `for … lift`, display-text `${ }`, `<match on=>` — listed as owed in `g-bootstrap-value-writes-state-owed`.
- NOT value positions honored: `on*=`, `bind:`, function bodies, `<effect>` bodies (skipped by the walk), body-top
  `${ }` (measured: in the bootstrap a program body-top `${ … }` is a LOGIC BLOCK of items — `${ h(@a) }` there is
  E-PARSE-ITEM — never an Interp node, so the walk never sees it). `<request>` / `<onMount>` / `<timer>` / engine
  `effect=` / `<onTransition>` do not exist in the bootstrap.
- **Ambiguous / readings (not decided by SPEC text):**
  (a) `as=` — not in either §6.15 list; it binds a handle NAME, nothing is evaluated → excluded.
  (b) state-child `rule=` values and other non-handler attributes on state children / `<each>` are walked like any
      attribute (they name variants / cells; scanning finds nothing) — harmless superset.
  (c) declaration opener modifiers (`reset-on=[…]`, `single`) are not walked — a cell list, not an evaluated value.
  (d) validator arguments on a declaration opener (`min(…)`, `eq(@x)`) — §6.15 is silent (§55 validators); not
      judged here. The bootstrap lowers validators to HTML-native attributes only and refuses non-exact forms, so no
      evaluated validator argument reaches the runtime today. Flag for the SPEC.
  (e) a locked initializer that CALLS a function but reads no cell is labelled "the formula of derived …" (the
      bootstrap's `valueReads` counts a call as a read, which decides FieldMode.Derived); its fix text is the formula
      one.
- impl#1-dialect conformance case `control-flow/ctrl-027-arm-body-tilde-read-and-recovery-pos` (named by the SPEC
  change's `g-impl1-value-writes-state-s449` as rejected by §6.15): legacy dialect, not parseable by the bootstrap;
  NOT touched (impl#1 frozen contract) — noted for the PA.

## 2026-10-02 — conformance + gaps (commit a85e55b5a)
- 14 cases `conformance/cases/reactive/no-write-*` in the §66 opener form: own-init / field-init / derived / interp /
  attr / if × pos/neg, `unproven-pos`, `handler-neg`. impl#1 does not parse the §66 opener form; positives xfail under
  the NEW carried `g-impl1-value-writes-state-codes-unimplemented-s449` (signatures from `run.ts --xfail-signature`).
  The bootstrap executes all 14 (value-positions.test.js; negatives must be fully clean): 14/14.
- `bun conformance/run.ts`: 1222/1256 pass + 34 xfail, 0 fail. FACTS regenerated (1242 → 1256); gap counts
  regenerated (`state.ts --write`; the HIGH/LOW deltas beyond my +1 carried MED are pre-existing drift on main;
  master-list.md's regenerated recent-sessions block was reverted — PA-owned).
- known-gaps: `g-bootstrap-value-writes-state-owed` filed RESOLVED; `g-bootstrap-render-writer-call-hangs` RESOLVED in
  place; the effect entry's "⚑ PA question — may an initializer write" marked RULED; `g-bootstrap-slice-m2-render-
  hole-write-tests-s449` filed open (the PA fork).
- Final slice gates: lint 0 · m1 99/0 · m2 443/5 (the filed five) · m3 60/0 · m4 504/0 (+1 todo) · codec 92/0 ·
  m1 lowered 99/0 · lexer 337/0.

## 2026-10-02 — PA round: fork (a), merge, two filings (commits 43b6df6f6, b4bad1b44)
- Merged `origin/main` (#1236 protect r9, #1237 SPEC §6.15; main's migrated ctrl-027 taken). Conflicts: FACTS.md
  (took main's, regenerated → 1256), known-gaps.md (counts hunk regenerated; the tail hunk kept BOTH sections —
  §S449-spec-lifecycle then §S449-bootstrap-no-write-formulas). `@gap id=` union proof: ours 1555 · main 1558 ·
  union 1561 · merged 1561, missing 0, extra 0. master-list.md left untouched (state.ts's rewrite reverted; its
  recent-sessions block is stale on main itself).
- slice-m2 fork (a): the five N1 / F-A tests assert the original source is E-VALUE-WRITES-STATE, compile the
  write-free twin, graft `<name>W`'s lowered body into `<name>` (`graftWriters`), checkCore, and keep the S440
  runtime assertions unchanged. slice-m2 448/0; bite (graft off) → exactly those five RED.
  `g-bootstrap-slice-m2-render-hole-write-tests-s449` resolved.
- Filed `g-impl1-client-mangler-renames-local-shadow-in-match-arm` (MED; re-executed on 43b6df6f6 — the two-file
  reproducer returns the mangled fn from both arms; one-file compile is correct) and
  `g-spec-6-15-validator-argument-value-position-silent` (LOW).
- Final: slices lint 0 · m1 99 · m2 448 · m3 60 · m4 504 (+1 todo) · codec 92 · m1-lowered 99 · lexer 337, all 0 fail;
  unit+integration+conformance 27548 pass / 58 skip / 0 fail; conformance/run.ts 1222/1256 + 34 xfail, 0 fail.
