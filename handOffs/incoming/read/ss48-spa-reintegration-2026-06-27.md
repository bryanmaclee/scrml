# sPA re-integration — ss48 (FBIP increment-2: `lin`-annotated in-place)

**From:** sPA (list `ss48-fbip-lin-annotated-in-place.md`) · **Date:** 2026-06-27
**Branch:** `spa/ss48` (base origin/main `c134e500`) · **branch tip = base** (no source build)
**Disposition:** 1/1 item **PARKED** — needs USER/PA design ruling. Run complete-as-parked.

## TL;DR

Item 1 (`lin`-annotated in-place codegen) **cannot be built within its ratified
constraints.** The SURVEY-FIRST gate caught a soundness fork in Phase 0: the increment's
central premise — *"soundness is carried ENTIRELY by the §35 `lin` pass"* — is **incomplete**.
The agent built nothing; I (sPA) independently verified the load-bearing fact. **This is the
gate working as designed**, not a failed dispatch.

## The fork (soundness-critical; sPA-verified on the primary fact)

§35 certifies **binding-level** exactly-once + dead-after. In-place mutation additionally
requires **storage-level** uniqueness — no *other live binding* aliases the value's backing
storage. **§35 does not establish that**, and accepts a `lin` binding that aliases live
storage with zero error.

**sPA-VERIFIED (R26, real pipeline):**
```scrml
@export fn probe(): int {
  const base = [1, 2, 3]
  lin a = base                  // ← compiles ZERO E-LIN (verified, 2 clean compiles)
  const result = a.concat([4])  // the single lin consumption
  return base.length
}
```
`lin` is a §35 linear-*type* annotation (analysis-only — no runtime defensive copy), so
`lin a = base` necessarily lowers to a bare alias `const a = base`. Today's clone path:
`a.concat([4])` → new array → `base.length === 3` (correct). An in-place rewrite
(`a.push(4); a`) corrupts the still-live `base` → `4` (**silent purity violation — the
worst case the brief names**). The differential harness's "stays-a-clone" class would NOT
catch this: it's a false-POSITIVE fire on an aliasing case the lin proof wrongly certifies.

Two alias channels §35 accepts without error: (1) initializer aliasing `lin x = <live>`;
(2) `lin` param bound to a still-live caller arg (§35.2.1 constrains consumption inside the
body, not caller ownership).

## Secondary findings (agent-claimed; PA to confirm — each independently neuters a target)

- **Map seam has no valid target.** The map-op dispatch (`emit-expr.ts` `MAP_METHOD_HELPERS`)
  is `@`-reactive-gated (`mode:"client"`) — fires only for reactive `@` cells, which are the
  **carve-out** (must stay clone). Non-reactive local maps (`let m = [:]`) reportedly emit a
  raw `m.insert(...)` on a methodless object (a separate pre-existing emit bug). *(I could not
  re-confirm this probe — the test fn tree-shook before emit; PA to verify.)*
- **Array seam unreachable for `lin`.** §35.2 makes `lin` bindings immutable (rejects
  reassignment), so the `acc = acc.concat(x)` threaded-accumulator shape can't be `lin`;
  §34.4.4 bars consuming an outer `lin` in a loop. The headline targets (DG-fixpoint,
  lexer-token accumulators) are `let`/`const` = the **inferred tier (out of scope)**.

## Why this is NOT relitigating Q-FIP S224

Q-FIP ratified *marker = `lin` reuse* + *silent-fallback-to-clone*. Neither is contested.
The fork is an **unstated load-bearing assumption** the fbip-feasibility deep-dive made —
that `lin`'s binding-death == storage-uniqueness. Deep-dive Open-Question (~line 613) defers
escape/return-alias checking to the *inferred* tier; the annotated tier was assumed to
inherit a proof the inferred tier was meant to provide. SPEC-grounded, not corpus-grounded.

## Decision-ready options for USER/PA

- **(a) Re-scope annotated tier to a provably-fresh subset** — fire only when the `lin`
  binding is initialized from a literal/constructor/fresh-returning call (never a bare alias)
  AND is a local. Needs a small syntactic freshness check ≈ the smallest slice of the
  inferred tier (which the brief forbids). Marginal value even if built (single consumption,
  no loop).
- **(b) Fold annotated tier into the inferred-tier Road-B wave** *(agent + sPA-concurred
  recommendation)* — the escape/alias analysis the inferred tier always needed is the *same*
  analysis required to make the annotated tier sound. Defer item 1 to that wave.
- **(c) Fix non-reactive-map `.insert` emit (separate, independent bug)** — worth its own
  dispatch regardless of FBIP. **PA: confirm the emit-broken claim first** (I couldn't).
- **(d) HAMT-transient runtime path** — sound but no win under exactly-once consumption
  (first-and-only touch copies the shared node anyway). Not recommended.

## Landed on `spa/ss48`

Tracking/record only — **no source change**:
- `docs/changes/fbip-lin-inplace-2026-06-27/BRIEF.md` (archived dispatch brief)
- `spa-lists/ss48-fbip-lin-annotated-in-place.md` (item 1 → PARKED + fork summary)
- `spa-lists/ss48.progress.md` (run log)

Agent transcript: task `a7cc926f329994478`. Worktree clean, no leak (FINAL_SHA == base).
