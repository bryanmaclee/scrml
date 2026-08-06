---
status: current
last-reviewed: 2026-08-06
---

# Limb 2 — retire the whole-buffer fn-name mangler: POPULATION COUNT + scoping

**S325-bryan, 2026-08-06.** Measurement agent `limb2-mangler-population-count`, worktree branch
`worktree-agent-a991f86dc83d4aebf` @ `c352e966` (throwaway instrumentation, NOT intended to land —
retained so the measurement is reproducible). Base main `cff2af5e`.

**Why a count came first.** `pa-base` §8's fifth gate-design entry — *before narrowing any check,
count what it will stop looking at* — was earned on the SIBLING limb (Limb 1, S322), where a
coverage-removing mitigation shipped twice with a clean artifact/diagnostic differential BOTH times.
Retiring this pass removes a catch-all. The count is owed before the arc is scoped, and it changed
the arc's shape.

## THE HEADLINE

> **871 emitted call sites, in 234 cleanly-compiling sources, would carry an unmangled name if the
> pass were deleted today.**

- **(a) sites some other pass would still fix: 0.** MEASURED per (source, name) group — the encoded-token
  count in the deleted artifact drops by *exactly* the probe's rewrite count; residual ≠ 0 in zero groups.
- **(b) sites surviving unmangled: 871.** acorn scope analysis over the deleted artifacts: **856 FREE**
  (unbound anywhere, not a browser global), 15 in artifacts acorn cannot parse, **0 bound**, **0 globals**.
- **Verified by EXECUTION, not inference** — all 235 sources mounted in happy-dom (runtime + client.js +
  body HTML, `DOMContentLoaded` dispatched):

  | | baseline | mangle deleted |
  |---|---|---|
  | ReferenceError at load | **0** | **145** |

- **Corpus differential** (1878 sources / 7254 artifacts): 408 artifacts differ · 0 newly failing or
  passing compiles · **0 syntax delta under both goggles**. The entire class is invisible to
  `node --check` / `vm.Script` — invariant 41, again.
- Instrumentation proven a no-op with the env unset (differential: NO DIFFERENCES).

Totals reported `N of M` throughout. **Not measured: the 490 `.scrml` outside the five default roots**
(`compiler/` 160, `docs/` 282, `handOffs/` 47, `dashboard/` 1).

## Attribution — 1413 genuine user call sites, provenance exact, no unattributed bucket

| n | emitter |
|---|---|
| 598 | `emit-functions.ts` — fetch stubs, CPS wrappers, client fn bodies |
| 543 | `emit-reactive-wiring.ts` — top-level logic + module-init |
| 225 | `emit-event-wiring.ts` — handler wiring + reactive display |
| 43 | body-render dispatchers (`emit-engine` / `emit-match` / `emit-each`) |
| 4 | `emit-engine.ts` — substrate, hook-firing fns, opener effects |

Largest shapes: bare statement call 422 · argument position 332 · assign/prop-value 190 ·
`await NAME(` 171 · `return NAME(` 105.

## ⚑ THE BLOCKER — reachability, and it is ORDERING, not plumbing

The encoded name is **not a function of the user name**: `genVar` (`codegen/var-counter.ts:17-21`)
returns `_scrml_<sanitized>_<N>` with `N` a monotonic per-compile counter. The mapping exists in
exactly one object — `fnNameMap`, built at `emit-functions.ts:604`, returned at `:1512`.
**`CompileContext` does not carry it** (`ctx.fnNameMap`: zero occurrences in `compiler/src/`).

| emitter (n) | stage order vs `emitFunctions` | encoded name reachable at emission? |
|---|---|---|
| `emit-event-wiring` (225) | AFTER | **YES — already receives `fnNameMap`**; consults it for `handlerName` but not for condExprs/args/bodies |
| `emit-reactive-wiring` (543) | AFTER | **NO — but reachable by THREADING only.** The map exists and is complete; it is simply not passed |
| `emit-functions` (598) | *is* the builder | **PARTIAL** — server stubs/CPS resolvable; a call to a client peer declared LATER is not yet in the map |
| body-render dispatchers (43) | **BEFORE** | **NO — ordering-impossible.** The encoded names have not been generated yet |
| `emit-engine` (4) | 2 BEFORE, 1 AFTER | **NO** — `emitEngineOpenerEffectsForFile(fileAST)` takes no `ctx` at all |
| `emit-expr.ts` (the shared tail ALL of the above route through) | n/a | **NO** — leaf expression emitter, no map access |

**So ~47 sites are not unthreaded, they are ordering-blocked**, and the generic `emitCall` tail
(`emit-expr.ts:3527-3528`) — the uncommented structural free-rider that produces essentially all 1413 —
sits at a leaf with no map at all.

## Nine DELIBERATE free-riders — emitters that emit an unmangled name ON PURPOSE

The load-bearing one is **`emit-expr.ts:3264-3287`** (the #429 client server-fn await): it emits the
SOURCE name deliberately, and the comment states the coupling — *"`post-fn-name-mangle` rewrites it to
the fetch stub afterwards. Its regex matches a name followed by `(`, which `await loadRows()` still
satisfies."* **The pass's lookahead is a documented API of the emit contract**, relied on in three files.

Others: `emit-html.ts:1451`/`:3419` (structural + attribute `if=fn()` condExprs — the S191 shape) ·
`emit-expr.ts:3436` (`render()` shadow, referenced from three files) · `:3511` (`print`/`println` shadow) ·
`:1712` (`isClientServerFnCall` predicate doc) · `emit-each.ts:1658` · `emit-variant-guard.ts:889`
(free-riding *by admission of unreachability*) · and the generic tail above.

**Negative dependency, in the other direction:** `emit-client.ts:127-137` and `:2519-2520` reason
explicitly that the pass will NOT corrupt the module-registry footer *because property keys are followed
by `:`, outside the lookahead set*. The lookahead is load-bearing for code that is deliberately NOT
rewritten, too — narrowing it is not free either.

## Two of the five accumulated patches defend EMPTY populations

MEASURED corpus-wide: **`...NAME(` spread-call incidence is ZERO** (the `g-spread` lookbehind fix), and
**zero records are preceded by a genuine member dot** (so Bug D's lookbehind never fires on a real
`obj.name`). This is the S322 corollary verbatim — *a fix built before the problem is measured is a fix
whose value is unmeasured.*

**Do NOT read that as "remove them."** Removing a guard is itself coverage-removal, which is the trap
running the other direction; and both guards are cheap. Recorded as a fact about how this pass accreted.

## Three defect classes surfaced by the count (filed separately, none fixed)

- [[g-embed-runtime-ships-mangled-runtime-identifiers]] — **HIGH, live, EXECUTED.** 138 rewrites land
  inside the runtime slot; inert by default but SHIPPED corrupted under `--embed-runtime`.
- [[g-mangler-empty-name-whole-buffer-insertion]] — MED, masked. An empty `fnNameMap` key → 781
  zero-width injections in one file.
- [[g-mangler-scope-blind-shorthand-key-rename]] — MED. Object-shorthand KEYS renamed → silent `undefined`.

## Scoping conclusion (PA, S325)

**"Retire the mangler" is NOT a single arc and must not be dispatched as one.** 871 live sites, 0 repaired
by any other pass, 145 measured load-time ReferenceErrors on deletion, and ~47 sites where the encoded
name does not yet exist when the site is emitted.

The tractable decomposition, if by-construction is the goal, is ordered by reachability and NOT yet
authorized:

1. **`emit-event-wiring` (225)** — the map is already a parameter. Smallest real step.
2. **`emit-reactive-wiring` (543)** — thread the map. 768 of 1413 (54%) after step 2.
3. **`emit-expr`'s generic `emitCall` tail** — the actual root; needs the map at a leaf emitter, and
   every free-rider above is a consumer of the current behaviour.
4. **body-render + engine (47)** — needs pipeline REORDERING, a separate question from threading.

Each step must keep the pass in place until its own population reaches zero — the pass is the fail-safe,
and removing it before the last consumer migrates is precisely the coverage-removal failure this count
exists to prevent. **The three filed defects are independently fixable and do not wait on any of this.**

## Reproduce

Commands in the measurement agent's report; the probe is env-gated
(`SCRML_MANGLE_PROBE_DIR`, `SCRML_MANGLE_DELETE=1`) on branch `worktree-agent-a991f86dc83d4aebf`.
