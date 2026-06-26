# Approach A — "Feel of Performance" splitter: implementation scoping

**Change-id:** `feel-of-performance-approach-a-impl-2026-06-26` · **Status:** SCOPING (S221) · **Spec anchor:** SPEC §40.9 / PIPELINE Stage 7.6

> The whole-stack-closure splitter (the "minimal playable surface" — ship/prefetch exactly the components +
> reactive cells + server-fns + vendor units reachable from an entry point within N interactions, per role).
> Auto-derived from the reactive graph, NOT dev-annotated. The user's "feel of performance" thread.

## 0. This is NOT a fresh design bet — it's a ratified, spec-anchored, half-built feature

- **Ratified:** Approach A won the 5-voice A-vs-D debate (**Insight 29**, 2026-05-11) → the v0.3 spec-amendment target. Underwritten by the **S84 empirical gate** (reactive graph 99-100% statically resolvable).
- **De-risked on real adopter code (S221):** the OQ#1 probe extended to giti / 6nz / flogence — all clear the 70% gate; the one idiom beyond the curated corpus (6nz's dynamic-key `@arr[i]`, 30 sites) is **splitter-benign** (reads the whole root cell; cell-granularity closure unaffected). Confidence MEDIUM → **HIGH for real-world scrml**. See `scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md` § S221 ADDENDUM.
- **Spec'd:** SPEC §40.9 (closure analysis) + PIPELINE Stage 7.6 (full input/output/precondition/responsibility contract). The `ReachabilityRecord` / `RolePlayableSurface` / `ChunkPlan` / `ChunkContents` shapes are normative.

**So the question is not "should we build A" — it's "finish the remaining waves to make it actually split."**

> **S221 UPDATE (W1 survey-first STOP, agent ab777f6d) — W1 is ALREADY FULLY BUILT; the real first wave is W2.**
> The DG markup-context `reads` edge-lift (§40.9.3) landed at **S88** across A-1.2..A-1.6 — hardcoded ON (`dependency-graph.ts:2340 markupContextEmitEdges=true`, flipped from false in `da786092`); Component 2 (`reachability/component-2.ts`) consumes the real edges; E-DG-002 is additive (sentinel preserved). Verified end-to-end: a tiny `${@count}` repro puts `@count` in `reactiveCellNodeIds` (only possible via a real `reads` edge). The "256-edge ceiling" was a historical S84 *pre-lift corpus count*, fulfilled by S88 — NOT an edge ceiling. The PIPELINE "~40-80h unbuilt" estimate was STALE (Rule 4: code over derived doc).
> **The actual first-buildable wave is W2 — and it is a precise, bounded wiring fix:** `enumerateEntryPoints(files)` (`reachability/entry-points.ts:76`, called at `reachability-solver.ts:170`) is passed ONLY `files`, no RouteMap → it enumerates `<program>` roots + inline `<page>` children but SKIPS filesystem-routed page files (`pages/dispatch/board.scrml` etc., no `<program>` root → skipped at `entry-points.ts:82`). The `routeMap` IS available to RS (`api.js:2004`) but isn't threaded into the enumerator (and the `entry-points.ts:31-34` docstring falsely claims it reads RouteMap — a doc/code mismatch). **Thread RouteMap into `enumerateEntryPoints` so filesystem-routed pages become RS entry points → that's what yields non-empty trucking closures.** Smaller than the original W2 estimate.

## 1. Current build status (verified S221)

| piece | status | evidence |
|---|---|---|
| Reachability Solver core (components 1-5 + outer fixpoint + determinism serializer) | ✅ **BUILT** (A-2.x, S86-S91) | `compiler/src/reachability/` (4,399 LOC) + `reachability-solver.ts`; 21 determinism tests; component-1..4 tests |
| `W-AUTH-RUNTIME-FALLBACK` / `E-CLOSURE-001/002` static-vs-runtime instrumentation | ✅ **BUILT** | the diagnostic vocabulary that records conservative fallbacks |
| §40 AuthGraph derivation | ✅ **BUILT** | `compiler/src/auth-graph.ts` + `types/auth-graph.ts` |
| **DG markup-context `reads` edge-lift (§40.9.3)** | ✅ **BUILT** (S88, A-1.2..A-1.6; verified S221) | `dependency-graph.ts:2340` hardcoded ON; Component 2 consumes; end-to-end verified — was the *assumed* W1, turns out done |
| **Live-pipeline activation** (Stage 7.6 wired active; DG+AuthGraph fed to RS) | ❌ **NOT done** — Stage 7.6 INACTIVE | `--emit-reachability` produces EMPTY closures today (DG+AuthGraph not wired into the emit path) |
| **A-4 codegen splitter** (consume ChunkPlans → emit tiered chunks) | ❌ **NOT built** | `codegen/index.ts:962` "Empty until A-2.2+"; `:190/:201` A-4 wave + feature-flag notes |
| Runtime tiered-chunk loader (initialChunk + prefetchTier1/2/N progressive load) | ❌ **NOT built** | depends on A-4 |

**The headline:** the hard analytical core (the solver + auth-graph + the static-resolvability instrumentation — ~120-240h of the original 300-640h estimate) is DONE. What remains is the **plumbing** (DG edge-lift + activation) and the **payload** (codegen splitter + runtime loader).

## 2. Remaining waves (dependency-ordered; estimates from Insight 29 band)

- **W1 — DG markup-context `reads` edge-lift (§40.9.3).** ~40-80h. **THE prerequisite — RS aborts without it.** Today the DG counts markup `@`-reads (`${@x}`, `bind:value=@x`, `if=@x`, `for(... of @x)` in markup) only via the `MARKUP_READER_SENTINEL` for E-DG-002 accounting; it does NOT emit them as real `reads` edges. Lift them into the edge list so the `reactive_dep_closure` is complete. **First buildable. Self-contained (DG-only). Verifiable** (the S84 probe's "implicit markup reads" count becomes edge-shaped; RS stops aborting). Largest single risk-reducer.
- **W2 — live-pipeline activation + wiring.** Smaller than the original ~40-120h (the AuthGraph pass already exists). Wire Stage 7.6 active after Stage 7.5; feed the post-W1 DG + AuthGraph + RouteMap + RoleEnum into `runReachabilitySolver`; make `--emit-reachability` produce REAL closures (today empty). Re-run the trucking probe → non-empty per-role ChunkPlans = W2 done.
- **W3 — A-4 codegen splitter.** ~60-120h. The payload wave. Codegen consumes the per-(EP, role) ChunkPlans → emits actual per-tier chunk files + the manifest. Behind a feature flag, default-on at the v0.3.0 cut.
- **W4 — runtime tiered-chunk loader.** Client-side progressive load of initialChunk → prefetchTier1/2/N (idle/interaction-triggered). May fold into W3. This is where "feel of performance" becomes observable.
- **W5 — integration tests + the flagship demo.** ~40-80h. End-to-end TTI measurement on a real app (trucking / flux MMORPG) under both split + no-split; the empirical "is it user-perceptible" study (the dive's OQ#2).

## 3. Decisions that need a ruling (before/during build)

1. **Sequencing vs the v0.2.0 backlog.** This is a v0.3 multi-session arc (~180-400h remaining). The dive's brutal counter-argument still stands: *"whether scrml can build it before Qwik/Marko/Solid catch up is an engineering question."* Fork: (a) start W1 now as a parallel arc, (b) finish the v0.2.0 backlog first then this, (c) interleave (W1 is self-contained, fits between adopter-bug waves). **Recommend (c)** — W1 is a clean, bounded, high-value DG fix that doesn't block the backlog.
2. **Approach B (telemetry-PGO) in or out.** The dive deferred B to "future extension, not v1." User S83 voice: *"I strongly lean A + B."* Recommend: **A fully first (W1-W5), B as a follow-on arc** once A ships + we have real TTI numbers to PGO against.
3. **`<switch>` / runtime-conditional render worst-case (dive OQ#5).** Runtime-conditional branches go to worst-case union (ship both arms). Trucking + 6nz use heavy `<match>`/`<engine>`. Likely fine (union is bounded + correct), but: ruling on whether W3 optimizes it or accepts the union for v1. **Recommend accept-union for v1** (correctness over payload-optimality; revisit if a real app's union dominates).
4. **Recoverability coupling (dive OQ#8).** Does the build-story / comp-time shape need to capture the solver's split decisions (for R4 reproducibility)? Defer to the build-story arc unless W3 surfaces a hard coupling.

### Banked coupling — block-lease conflict query falls out of W3 (S221)
flogence's **block-lease** core inference ("can these two edits run in parallel?") = `closure(regionA) ∩ closure(regionB) == ∅` — the SAME per-region reactive touch-set the §40.9 solver computes. Once W1-W3 land, expose a near-free **`--emit-region-touch-map` / `conflictsWith(regionA, regionB)` query (W3.5)** over the closure the compiler already computes. block-lease then shrinks from "an inference engine re-deriving the dep graph (badly, at the agent layer)" to "an orchestrator consuming a compiler-emitted fact" — the S214 deterministic-layer framing (compiler owns program-inference; flogence owns process-coordination). Dividing line: program-inference (dep/reachability/conflict/dead-structural) → compiler-native; process-coordination (lease-holding, dispatch, baton-pass, reasoning provenance) → flogence-layer. NOT W1-blocking; revisit at W3.

## 4. Proposed first step — REVISED S221 (W1 done → W2 is the first buildable)

**W2 — thread RouteMap into `enumerateEntryPoints`.** The W1 survey proved the DG edge-lift is done; the real first wave is the entry-point/RouteMap wiring. Bounded + precise (the agent located it exactly): `reachability/entry-points.ts:enumerateEntryPoints` takes only `files` and skips filesystem-routed pages (no `<program>` root). Thread the `routeMap` (already at `api.js:2004`) into the enumerator so each `pages/**/*.scrml` becomes an RS entry point; fix the `entry-points.ts:31-34` doc/code mismatch in the same change. **Acceptance:** `examples/23-trucking-dispatch --emit-reachability` produces NON-empty per-page closures (today the static `<program>` shell is correctly empty; the reactive `pages/` get skipped). Then re-run the role-keyed closure check. After W2, codegen still doesn't *split* (that's W3/A-4) — but the closures become real + inspectable, which is the gate for scoping W3.

## Links
- SPEC §40.9 · PIPELINE Stage 7.6 (`compiler/PIPELINE.md` ~L2350) · Insight 29 (`~/.claude/design-insights.md`)
- Source dive: `scrml-support/archive/deep-dives/smart-app-splitting-feel-of-performance-2026-04-26.md` (status: superseded — fed the ratification)
- Empirical gate + adopter extension: `scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md`
- Solver: `compiler/src/reachability/` + `reachability-solver.ts` · AuthGraph: `compiler/src/auth-graph.ts`
