# s427-lift-body-lowering — adversarial review round 1 (HOLD) — repros + round-2 spec

The fix is **held**, not merged: `origin/hold/s427-lift-body-lowering` @ `089c0414` (base `b497b892`).
The brief is on that ref at `docs/changes/s427-lift-body-lowering/BRIEF.md`; the dev agent's full report and
gate are in its `progress.md`.

Run a repro: `bun h.mjs <worktree> rN.scrml s-rN.mjs` (set `OUTDIR` to a temp dir). `h.mjs` compiles with
the worktree's own compiler, mounts in happy-dom, and prints the DOM + console errors; it counts
`_scrml_resolve_item` calls via `globalThis.__rc`.

## Findings (reviewer, frozen 089c0414 vs b497b892)

- **H1 — HIGH, loud → silent AND newly-accepting.** The per-group declared-name set turns a tilde-decl on an
  already-declared name into a plain assignment WITHOUT checking whether that declaration is `const`/`lin`.
  `const x = 1; x = 2` → base: compile error (wrong code, E-CODEGEN-INVALID-LOGIC, but loud); head: exit 0,
  boot `TypeError: Attempted to assign to readonly property`. Corpus: `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-to-const-081.scrml`
  (a NEGATIVE fixture, still `fails-compile` in the e2e-render-map baseline). Repros r3, r3b, r3c. §50:
  *"`const` variables are immutable; assigning to a `const` as an expression is E-ASSIGN-004."*
  ⚑ `E-ASSIGN-004` is NOT in `compiler/src/` — it lives in bryan's OPEN #996. **Round 2 must keep
  const/lin reassignment failing LOUD exactly as base does** (fall back to the old emission for a
  const/lin-declared name) and must NOT mint or wire `E-ASSIGN-004`.
- **M1 — MED, changes a program that worked on base.** `mixedHoistStrandsADeclaration` matches every
  identifier in the hoisted keyed setup against the block's top-level declarations with NO scope analysis, so
  a row-local `const name` sharing a name with a block-level `const name` demotes a working keyed list to a
  plain loop (row element identity lost on push/reverse — focus, input state, `ref=`). r5 (demoted) vs r5b
  (renamed, stays keyed); r4 same class. Needs scope-aware resolution.
- **M2 — MED, loud → silent.** `_forLoopWritesOuterBinding` uses a flat per-loop `local` set including
  nested-block declarations, so `n = n + 1` plus a nested `let n` in an `if` is judged pure → keyed → renders
  `3:a,3:b,3:c` (base: loud TDZ). r6.
- **M3 — MED-class, incomplete (loud → silent for the counter shape).** A loop demoted to plain re-renders only
  on cell REASSIGNMENT, not in-place `push`. r1 (the brief's own counter repro) and corpus
  `gauntlet-r10-svelte-dashboard` render correctly then go stale on push. Base was dead at boot there — so
  this turns a loud failure into a silently stale list. The demoted path needs the same deep-mutation
  subscription the keyed path has.
- **L1 — LOW, pre-existing:** member writes (`acc.n = acc.n + 1`) are not detected as impurity (r7).
- **Info:** `conformance/cases/loop/w-assign-001-severity-pos` (`do { x = x - 1 } while (x = 5)`) now runs as
  the faithful infinite loop its source describes — any tier that MOUNTS conformance cases will hang on it.
  `gauntlet-r10-odin-filebrowser` gets past `crumbIndex` and dies on a pre-existing `child is not defined`.

## Confirmed clean (keep)
The 29 rebinds (10 mounted: base TDZ-dead, head correct) · `phase1-let-bare-001` and
`phase3-assign-expr-chained-080` are genuine restorations (§50) · nested shadow / loop-local decls keep their
own bindings · §7.6 cross-block `let` assignment works · function-body tilde-decls unchanged · import
redeclaration stays loud · no dangling registry entries from the guard's withdrawal · post-lift statements
unchanged.
