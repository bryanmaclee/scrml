/**
 * @module types/reachability
 *
 * Reachability Solver — PIPELINE Stage 7.6 type surface (SPEC §40.9).
 *
 * Authored S89 wave A-2.1 — type-surface scaffolding only. No algorithm.
 *
 * Output contract MIRRORED VERBATIM from PIPELINE.md Stage 7.6 lines
 * 2351-2373:
 *
 *   interface ReachabilityRecord {
 *     closures: Map<EntryPointId, RolePlayableSurface>;
 *     diagnostics: ReachabilityDiagnostic[];
 *   }
 *
 *   interface RolePlayableSurface {
 *     byRole: Map<RoleVariant, ChunkPlan>;
 *   }
 *
 *   interface ChunkPlan {
 *     initialChunk: ChunkContents;        // playable_surface(E, N=0)
 *     prefetchTier1: ChunkContents;       // playable_surface(E, N=1) − initialChunk
 *     prefetchTier2: ChunkContents;       // playable_surface(E, N=2) − playable_surface(E, N=1)
 *     prefetchTierN: ChunkContents[];     // N ≥ 3, on-demand
 *   }
 *
 *   interface ChunkContents {
 *     componentNodeIds: Set<NodeId>;      // DG render-nodes + state-children
 *     reactiveCellNodeIds: Set<NodeId>;   // DG reactive-nodes (via Component 2)
 *     serverFnNodeIds: Set<NodeId>;       // RI/§52 boundary (via Component 3)
 *     vendorUnitNames: Set<VendorUnitId>; // §41 (via Component 5)
 *   }
 *
 * This file additionally surfaces the IMPLEMENTATION-level shapes the
 * runReachabilitySolver entry point exposes — `RSInput`, `RSOutput`,
 * `RSError`, `ReachabilityEntryPoint`, `PlayableSurface`, and
 * `RoleClassificationEntry` — so downstream components (A-2.2…A-2.7) and
 * future A-4 chunk-emit consumers can be authored against stable
 * symbols.
 *
 * Cross-references:
 *   - PIPELINE.md Stage 7.6 (lines 2332-2412) — verbatim contract.
 *   - SPEC.md §40.9 — Closure Analysis (Minimal Playable Surface).
 *   - SPEC.md §40.9.1 — five-component union + closure fixed point.
 *   - SPEC.md §40.9.4 — Component 3 + interaction-graph projection.
 *   - SPEC.md §40.9.5 — Component 4 + W-AUTH-RUNTIME-FALLBACK.
 *   - SPEC.md §40.9.7 — Per-tier output structure (ChunkPlan tier math).
 *   - SPEC.md §40.9.11 — E-CLOSURE-001 + W-AUTH-RUNTIME-FALLBACK codes.
 */

// ---------------------------------------------------------------------------
// Primitive aliases
// ---------------------------------------------------------------------------

/**
 * DG node identifier. Mirrors `NodeId` from `batch-planner.ts` and the
 * pipeline-wide convention. Stable across the lifetime of a single
 * compile invocation; not stable across invocations (no content
 * addressing at this surface).
 */
export type NodeId = string | number;

/**
 * Stable identifier for a single entry point.
 *
 * Per SPEC §40.9.1 + §40.8: one entry point per `<page>` declaration
 * plus the entry-file `<program>` body for SPAs. The id encodes the
 * source file path + the entry-point's role within the file.
 */
export type EntryPointId = string;

/**
 * A single variant of the app-scope role enum (SPEC §40.1.1).
 *
 * For applications with no role-enum declared and no auth gates, the
 * solver synthesizes a single anonymous viewer variant
 * (canonically `"_anonymous"` per PIPELINE Stage 7.6 line 2380).
 */
export type RoleVariant = string;

/**
 * Identifier for a §41 vendor unit declaration. Matches the vendor
 * unit's declared name in `import { ... } from "vendor:NAME"`.
 */
export type VendorUnitId = string;

// ---------------------------------------------------------------------------
// PIPELINE-verbatim shapes — ReachabilityRecord output contract
// ---------------------------------------------------------------------------

/**
 * The per-app output of Stage 7.6.
 *
 * One closure entry per entry point (page or SPA-program). The
 * `diagnostics` array captures `E-CLOSURE-001` (defensive error) and
 * `W-AUTH-RUNTIME-FALLBACK` (info-level lint) per SPEC §40.9.11.
 */
export interface ReachabilityRecord {
  closures: Map<EntryPointId, RolePlayableSurface>;
  diagnostics: ReachabilityDiagnostic[];
}

/**
 * Per-entry-point per-role chunk plan.
 *
 * One `ChunkPlan` per role variant of the app-scope role enum
 * (§40.1.1). Identical role variants observed across entry points
 * MAY share computation upstream but the per-entry-point ChunkPlan
 * is logically independent (different reachable surfaces per page).
 */
export interface RolePlayableSurface {
  byRole: Map<RoleVariant, ChunkPlan>;
}

/**
 * Per-tier chunk contents for a single (entry-point, role) pair.
 *
 * Monotonicity invariant (PIPELINE Stage 7.6 line 2392):
 *   initialChunk ⊆ initialChunk ∪ prefetchTier1 ⊆ ... ∪ prefetchTierN
 *
 * Tier math per SPEC §40.9.7.
 */
export interface ChunkPlan {
  /** playable_surface(E, N=0), payload-minimized. */
  initialChunk: ChunkContents;
  /** playable_surface(E, N=1) − initialChunk. */
  prefetchTier1: ChunkContents;
  /** playable_surface(E, N=2) − playable_surface(E, N=1). */
  prefetchTier2: ChunkContents;
  /** N ≥ 3, on-demand per OQ-A2-B (resolved in A-2.4: hard cap N=2). */
  prefetchTierN: ChunkContents[];
}

/**
 * The atom set of a single chunk: components, reactive cells, server
 * functions, and vendor units. All four sets are populated by the
 * five-component union per SPEC §40.9.1.
 *
 * markup-read DG nodes are NOT directly emitted into the chunk —
 * they are the substrate edges Component 2 uses to discover which
 * reactive cells a component reads. The chunk contains the reactive
 * cells themselves (the `to` of the `reads` edge), not the markup-
 * read intermediary (per SCOPING §2.4).
 */
export interface ChunkContents {
  /** From DG render-nodes + state-children (Component 1). */
  componentNodeIds: Set<NodeId>;
  /** From DG reactive-nodes (Component 2 — reactive_dep_closure). */
  reactiveCellNodeIds: Set<NodeId>;
  /** From RI/§52 boundary (Component 3 — server_fn_reachable_within). */
  serverFnNodeIds: Set<NodeId>;
  /** From §41 vendor unit declarations (Component 5). */
  vendorUnitNames: Set<VendorUnitId>;
}

// ---------------------------------------------------------------------------
// Diagnostic shape
// ---------------------------------------------------------------------------

/**
 * Reachability-solver diagnostic.
 *
 * Codes (per SPEC §40.9.11):
 *   - `E-CLOSURE-001` — error, defensive. Closure analysis fails to
 *     terminate. Fired by A-2.7's `FixedPointDriver` when the
 *     iteration cap (`2 × |DG_nodes|` per OQ-A2-G disposition,
 *     scheduled A-2.7) is reached.
 *   - `E-CLOSURE-002` — error. Application uses `<auth role=...>`
 *     variant-referencing gates but declares no app-scope role enum
 *     (`:enum` type per SPEC §40.1.1). Fired by A-2.5 per OQ-A2-F
 *     ratification (S89 — author code in v0.3, fire from RS not A-3).
 *   - `W-AUTH-RUNTIME-FALLBACK` — info-level lint. Auth gate uses an
 *     async-only check; the gated component is shipped eagerly.
 *     Fired by A-2.5 per OQ-A2-I disposition (single fire-site
 *     inside RS).
 */
export interface ReachabilityDiagnostic {
  code: "E-CLOSURE-001" | "E-CLOSURE-002" | "W-AUTH-RUNTIME-FALLBACK";
  severity: "error" | "info";
  message: string;
  /** Optional source-location span (mirrors compiler error shape). */
  span?: unknown;
  /** Optional entry-point context — populated when the fire-site is per-entry-point. */
  entryPoint?: EntryPointId;
  /** Optional role-variant context — populated when the fire-site is per-role. */
  role?: RoleVariant;
}

// ---------------------------------------------------------------------------
// Implementation-surface shapes — entry points, surfaces, role classification
// ---------------------------------------------------------------------------

/**
 * A single entry point enumerated from the v0.3 program shape (§40.8).
 *
 * One per `<page>` declaration; one per entry-file `<program>` body
 * for SPAs. Enumerated by A-2.2.a.
 */
export interface ReachabilityEntryPoint {
  id: EntryPointId;
  /** Source file containing the entry point. */
  filePath: string;
  /** Page route path (e.g. "/dashboard") or null for SPA-program entry. */
  routePath: string | null;
  /**
   * Distinguishes the SPA shape (one entry point at the entry file's
   * `<program>` body) from multi-page shapes (one entry point per
   * `<page>` declaration). Per SPEC §40.8.
   */
  shape: "page" | "spa-program";
  /** AST node id of the entry-point root (page-decl or program-decl). */
  rootNodeId: NodeId;
}

/**
 * A single tier of the playable surface for a single (entry-point, role).
 *
 * Used internally during the A-2.7 outer fixed-point construction
 * before the final `ChunkPlan` is materialized. The N value names
 * the tier (0 = initial, 1 = tier-1 prefetch, 2 = tier-2 prefetch).
 */
export interface PlayableSurface {
  entryPoint: EntryPointId;
  role: RoleVariant;
  /** Interaction depth — 0 for initial render, 1 / 2 / N for prefetch tiers. */
  tier: number;
  contents: ChunkContents;
}

/**
 * Per-role classification of an auth-gated boundary.
 *
 * One entry per role variant per auth gate. Populated by Component 4
 * (A-2.5) per SPEC §40.9.5. Three terminal classifications:
 *   - "in" — role variant satisfies the gate's predicate (closed-form).
 *   - "out" — role variant does NOT satisfy the gate (closed-form).
 *   - "runtime-fallback" — gate uses async-only check; gated component
 *     is shipped eagerly and W-AUTH-RUNTIME-FALLBACK fires.
 *
 * Type authored at A-2.1 even though Component 4 doesn't land until
 * A-2.5; the type pins the contract A-2.5 must satisfy and lets
 * downstream A-4 chunk-emit be authored against the symbol.
 */
export interface RoleClassificationEntry {
  /** AST node id of the auth gate (`<auth role=>`, `<page auth=>`, `<channel auth=>`). */
  gateNodeId: NodeId;
  role: RoleVariant;
  classification: "in" | "out" | "runtime-fallback";
  /**
   * The auth-gate's source-text predicate (e.g. `role == "admin"`),
   * preserved for diagnostic emission. Not normative; the
   * `classification` field is the authoritative output.
   */
  predicateSource?: string;
}

// ---------------------------------------------------------------------------
// Entry-point input / output contracts
// ---------------------------------------------------------------------------

/**
 * Input to `runReachabilitySolver`.
 *
 * Mirrors PIPELINE Stage 7.6 "Input contract" (lines 2340-2347)
 * verbatim. Duck-typed at the boundary — concrete pipeline types
 * live in the upstream stages (DG / RI / MOD / §40 auth derivation).
 *
 * Optional fields default to absent — A-2.1 scaffold treats every
 * field as no-op and returns the empty record regardless.
 */
export interface RSInput {
  /** From Stage 7 DG — finalized, lift-checked. */
  depGraph: { nodes: Map<NodeId, unknown>; edges: unknown[] } | null | undefined;
  /** From Stage 5 RI — per-route entry-point list per §40.8. */
  routeMap?: unknown;
  /**
   * Derived from §40 auth-attribute classification — A-3's `AuthGraph`
   * output (consumed by A-2.5). NULL when the pipeline bypasses A-3
   * entirely (e.g. unit tests for A-2.2..A-2.6 that don't exercise
   * Component 4); A-2.5 degrades to the single-anonymous-role floor.
   * Imported via the `AuthGraph` symbol from `./auth-graph.ts`.
   */
  authGraph?: import("./auth-graph.ts").AuthGraph | null | undefined;
  /** From RI / §52 — classified server-fn set (consumed by A-2.4). */
  serverFnBoundary?: unknown;
  /** From MOD / §41 — declared vendor units per file (consumed by A-2.6). */
  vendorUnitDeclarations?: unknown;
  /** From §40.1.1 static-role-classification — app-scope role enum. */
  roleEnum?: unknown;
  /** From Stage 7.5 BP — informational only (per PIPELINE line 2347). */
  batchPlan?: unknown;
  /** Per-file AST set, used by the A-2.4 interaction-graph projection. */
  files?: unknown[];
  /**
   * PGO P1.2 — when `true`, the solver emits per-component timing lines
   * (`[RS-COMPONENT 1] initially-rendered: Nms` etc.) plus a single
   * `[RS-OUTER-FIXPOINT] <iters> iters, Nms` line via the `log`
   * channel. Off by default; zero overhead when unset
   * (no `performance.now()` calls are issued on the false branch).
   */
  debugPerf?: boolean;
  /**
   * PGO P1.2 — log sink used when `debugPerf === true`. Matches the
   * `log` channel plumbed through `compileScrml`. Defaults to
   * `console.log` when omitted; tests can pass a sink-recording function.
   */
  log?: (msg: string) => void;
}

/**
 * Output of `runReachabilitySolver`.
 *
 * The `record` is the public Stage 7.6 output; `errors` is the
 * diagnostic stream surfaced through `collectErrors()` in `api.js`.
 *
 * Note: `record.diagnostics` and `errors` overlap but are kept
 * separate. `record.diagnostics` is the in-record artifact (for the
 * `--emit-reachability` JSON output and downstream consumers).
 * `errors` is the api.js-level error stream used by the
 * compile-error aggregator (analogous to `bpResult.errors` for the
 * batch planner).
 */
export interface RSOutput {
  record: ReachabilityRecord;
  errors: RSError[];
}

/**
 * Top-level error shape for the solver — mirrored on
 * `BatchPlannerError` from `batch-planner.ts`.
 *
 * `E-CLOSURE-001` and `E-CLOSURE-002` are emitted as error;
 * `W-AUTH-RUNTIME-FALLBACK` is emitted as info-level lint. The api.js
 * error filter routes by `severity` and the `W-`/`I-` code prefix.
 *
 * `E-CLOSURE-002` is fired by A-2.5 Component 4 when the application
 * uses `<auth role=...>` variant-referencing gates without declaring an
 * app-scope role enum per SPEC §40.1.1. Per OQ-A2-F (S89 ratification)
 * the fire-site is RS, NOT A-3 — A-3's role-enum resolver produces an
 * `isImplicitAnonymous: true` signal and A-2.5 acts on that signal in
 * combination with auth-role-block gate presence.
 */
export interface RSError {
  code: "E-CLOSURE-001" | "E-CLOSURE-002" | "W-AUTH-RUNTIME-FALLBACK";
  severity: "error" | "warning" | "info";
  message: string;
  span?: unknown;
}

// ---------------------------------------------------------------------------
// Empty-record factory (scaffold no-op + downstream default-initialization)
// ---------------------------------------------------------------------------

/**
 * Produce a fresh empty `ReachabilityRecord`.
 *
 * Used by:
 *   - `runReachabilitySolver` scaffold body (A-2.1) — returns this for
 *     every input.
 *   - `CompileContext` factory default (`makeCompileContext`) — pre-
 *     populates the field for tests + harnesses that bypass the full
 *     pipeline.
 *   - `--emit-reachability` CLI flag at A-2.1 — emits this shape.
 *
 * Every Map / Set is FRESH so callers can mutate without
 * aliasing. Determinism per PIPELINE Stage 7.6 line 2391.
 */
export function emptyReachabilityRecord(): ReachabilityRecord {
  return {
    closures: new Map(),
    diagnostics: [],
  };
}
