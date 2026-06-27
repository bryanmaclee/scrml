# BRIEF — ss48 item 1: `lin`-annotated in-place codegen (FBIP increment-2)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Branch base:** origin/main `c134e500` (sPA lands on `spa/ss48`)
**Mode:** SURVEY-FIRST · adversarial-verify MANDATORY · soundness-critical

---

## What this is

The SECOND graduated step of the FBIP (functional-but-in-place) program. Increment-1
(HAMT structural-sharing maps) already LANDED as ss38 (`5fb41cb9`). This increment adds
the **annotated tier**: at a copy-on-write (COW) site whose receiver is a **`lin`-bound
value** and whose update is the **single (last) consumption**, codegen emits the
**in-place** form (mutate the existing storage, skip the clone). Everywhere else, today's
clone is emitted UNCHANGED.

**RATIFIED design constraints (do NOT relitigate — these are settled, Q-FIP S224):**
- The annotated-tier marker is the **existing `lin`** keyword (REUSE — NOT a new
  Koka-style `fip` keyword). Do not add any new source surface.
- **SILENT fallback to clone** when in-place is unprovable. NO loud
  "prove-in-place-or-error" diagnostic. Clone-always is the FREE sound floor.
- Soundness is carried **ENTIRELY by the existing §35 `lin` linear pass**
  (exactly-once consumption + dead-after-consumption). **NO new inference pass** in this
  increment. (The inferred tier for un-annotated accumulators is a later Road-B program
  wave — explicitly OUT OF SCOPE here.)
- **Source stays 100% pure.** In-place is an UNOBSERVABLE emit-time optimization. The
  source language is NOT widened (`feedback_limit_primitives_not_godify`).

---

## Phase 0 — SURVEY FIRST (read-only; gate before any build)

Confirm the four load-bearing facts. If ANY is false, or you find a **genuine design
fork** (not a mechanical detail), **STOP and return your findings as a PARK** — do NOT
build past a fork on soundness-critical code. The sPA escalates forks to the PA→user.

1. **The §35 lin pass already computes the fact we need, with no new pass.**
   `checkLinear` lives at `compiler/src/type-system.ts:15016`. The consumption descriptors
   (codes E-LIN-001/002/003/006) are around `type-system.ts:14718–14796`; there are ~74
   E-LIN sites total. CONFIRM the pass already knows, at each consumption site, that a
   `lin` binding is consumed exactly-once AND is dead-after that consumption — and that
   this fact can be SURFACED to codegen (an annotation on the AST node / a side-table
   keyed by the consumption span) WITHOUT adding a new analysis pass.

2. **The precise COW seam(s) to branch.**
   - Map ops dispatch table: `compiler/src/codegen/emit-expr.ts:365–368`
     (`insert→_scrml_map_insert`, `update→_scrml_map_update`,
     `insertAll→_scrml_map_insert_all`). This is the single non-reactive seam where
     `.insert/.update/.insertAll` lower to runtime calls.
   - Array threaded-accumulator: `acc = acc.concat(x)` at top level — `collectReassignedNames`
     in `compiler/src/codegen/scheduling.ts:~308+` already models this reassignment shape
     (both the `bare-expr`/`assign` form AND the `tilde-decl`/`lin-decl` re-use form) AND
     **already skips `@`-reactive targets**. This is the carve-out, free.
   - Runtime targets: `_scrml_map_insert` (`runtime-template.js:4588`), `_scrml_map_update`
     (`:4615`), `_scrml_map_insert_all` (`:4632`). The HAMT comment at `:4190` states
     "every method returns a NEW map value" — so **no `_inplace` runtime variant exists
     yet** (runtime-chunks.ts:60 names `set_inplace` only in a comment). You will ADD the
     in-place runtime variant(s).

3. **The reactive-cell carve-out is STRUCTURALLY enforceable.** Reactive `@` cells are
   EXCLUDED (§6.5.3 keyed reconciliation needs the new reference). Target = non-reactive
   `let`/`const`/`fn`-param/`lin` accumulators ONLY. CONFIRM no `@`-cell write can reach
   the in-place branch (the `_scrml_deep_set` lowering at `emit-bindings.ts:565` is
   reactive-cell-targeted and must stay clone; `collectReassignedNames` already skips `@`).

4. **The soundness frontier "stays a clone" cases are identifiable.** A `lin` value that
   is: read again on another path / captured in a closure (§35.6) / returned-aliased in a
   struct field / crosses the server boundary (§35.7) — each must NOT be flagged in-place.
   CONFIRM these are exactly the cases where the lin pass does NOT certify single-
   consumption + dead-after (i.e. the proof already excludes them — you inherit the
   exclusion, you do not re-derive it).

---

## Build (only if Phase 0 is clean)

1. **type-system.ts:** surface the lin exactly-once + dead-after proof as a codegen-
   consumable **"in-place-safe" flag** at each COW site whose receiver is `lin` +
   single-consumption + dead-after. (AST annotation or span-keyed side-table — whichever
   the pipeline already uses for threaded SYM facts; do NOT invent a parallel channel if
   one exists.)
2. **codegen (emit-expr.ts map-op seam + the array threaded-accumulator seam):** when the
   flag is set, emit the **in-place** call variant (e.g. `_scrml_map_insert_inplace`, and
   the array mutate-in-place form instead of `.concat`-clone); when unset, emit today's
   clone-emitting call UNCHANGED (the silent fallback).
3. **runtime-template.js:** ADD the in-place variant(s) (`_scrml_map_insert_inplace` etc.)
   that mutate the receiver's existing storage (HAMT `_root` / the leaf path) instead of
   returning a new map value. This is the Clojure-**transient** case: it is sound ONLY
   because the lin proof guarantees the whole map value is uniquely owned + dead-after, so
   no other live reference can observe the mutation. Register any new runtime symbol in
   the chunk system (`runtime-chunks.ts`) so it assembles into the `map` chunk.
4. **A compile-time FBIP toggle.** No FBIP flag exists today. Add a codegen option
   (e.g. `fbipInPlace?: boolean`, default ON once landed) so the differential harness can
   compile the SAME corpus with the optimization ON and OFF.

**Default to clone on ANY doubt.** A wrong in-place flag is a SILENT purity violation —
the worst possible failure (no error, wrong answer). Flag in-place ONLY on the lin proof.

---

## Soundness gate — NEW differential-testing harness (PERMANENT)

Mirror the SHAPE of `compiler/tests/unit/value-native-map-hamt-differential-ss38.test.js`
(read it first), but at the **COMPILE level**: compile a corpus with FBIP-on and FBIP-off.
The harness has THREE assertion classes — all three are required:

- **(A) Observable equivalence (the core soundness invariant):** for EVERY corpus program,
  the FBIP-on and FBIP-off compiled outputs produce **observably-identical runtime
  results**. In-place is unobservable → any runtime divergence is a BUG.
- **(B) Stays-a-clone proof:** for the carve-out + frontier corpus (reactive `@` cell;
  read-again-on-another-path; closure-captured §35.6; returned-aliased struct field;
  crosses-server-boundary §35.7), the FBIP-on emitted JS must be **byte-identical** to
  FBIP-off (proving the optimization correctly did NOT fire).
- **(C) It-actually-fired proof (anti-vacuous):** for the sweet-spot corpus — a `lin`
  threaded accumulator, the **DG-fixpoint shape**, and the **lexer-token-accumulator
  shape** from the de-risk slices — the FBIP-on emitted JS must DIFFER from FBIP-off
  (proving in-place DID fire). Without (C) the harness can be vacuously green by never
  optimizing. If you bound the corpus, `log`/comment exactly what was dropped — no silent
  caps.

---

## Verify (all required before returning)

- **R26 reproducer:** author a `lin`-accumulator `.scrml` reproducer, compile it, run
  `node --check` on the emitted JS, and assert runtime correctness (the in-place path
  produces the right answer).
- **S215 adversarial (constructed-edge):** explicitly construct each frontier case and
  assert it STAYS A CLONE (this is harness class B, but also eyeball the emitted JS for
  each). Random-sample ~10× your own in-place sites to confirm each one genuinely has the
  single-consumption + dead-after proof. (`feedback_adversarial_verify_not_confirmatory`:
  happy-path green ≠ done.)
- **FULL `bun run test`** — NOT the pre-commit subset. The differential harness and
  within-node parity live in the full suite. Pre-commit hook runs the full ~17.6k suite
  (~108–124s) so budget for it.

---

## SPEC (small — lands WITH the impl, Rule 4)

An OPTIONAL §35/§34 normative note: in-place is an unobservable emit-time optimization;
`lin` is reused as the annotated-tier marker; the silent-fallback-to-clone guarantee.
Keep it minimal. Do not write a large spec section.

---

## Commit discipline

- Work in your worktree; `git merge origin/main` at startup if your base is stale.
- Commit INCREMENTALLY in your worktree (crash-recovery anchor) — do NOT batch.
- Coupled code+test = one commit (`feedback_coupled_code_test_commit`).
- NEVER `--no-verify`. NEVER write outside your worktree (no main-absolute paths).
- Return: branch tip SHA, files changed, Phase-0 findings (or PARK + the fork), harness
  pass/fail with the A/B/C class breakdown, and full-suite result.

## Authority

`docs/changes/compiler-reimagining-derisk-2026-06-26/RULING.md` §"mechanics-beauty
program" (2) · `scrml-support/docs/deep-dives/fbip-feasibility-2026-06-26.md` §"Minimal
first increment" (2)+(3) + §"Soundness frontier" · Q-FIP S224 · ss38 precedent
(`5fb41cb9`).
