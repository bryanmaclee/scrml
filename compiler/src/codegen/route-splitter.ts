/**
 * @module codegen/route-splitter
 *
 * Per-route artifact splitter — wave A-4 (SPEC §40.9.7).
 *
 * Iterates the Stage 7.6 Reachability Solver's per-(entry-point, role)
 * `ChunkPlan` shape and produces per-(EP, role, tier) chunk descriptors.
 * Sits ABOVE the per-file codegen pipeline (Stage 8): per-file codegen
 * produces atoms; the route-splitter composes atoms into chunks.
 *
 * Sub-phase A-4.1 (this file's initial scope):
 *   - Iteration scaffold ONLY. Empty `payloadJs: ""` body per chunk.
 *   - Placeholder 8-character hash `"00000000"` until A-4.6 lands content-
 *     addressing.
 *   - Correctly-shaped `ChunkKey` / `ChunkOutput` / `ChunksManifest` so
 *     A-4.2..A-4.7 can attach to a stable contract.
 *
 * Subsequent sub-phases:
 *   - A-4.2 — populate `payloadJs` for `initialChunk` from per-file
 *     emitter atoms.
 *   - A-4.3/A-4.4 — populate `payloadJs` for `prefetchTier1` /
 *     `prefetchTier2` + idle/hover runtime wiring.
 *   - A-4.5 — `prefetchTierN` (N ≥ 3) dispatch hook.
 *   - A-4.6 — content-addressed `chunkHash` (FNV-1a base36, §47.1.3).
 *   - A-4.7 — per-route HTML augmentation + W-CG-CHUNK-* lints.
 *
 * Output filename convention per SCOPING OQ-A4-C (ratified):
 *
 *   <route-path>/<RoleVariant>.<tier>.<8-char-hash>.js
 *
 * where:
 *   - `<route-path>` mirrors §47.9.2 path-preserve for the entry point's
 *     routePath (or the SPA-program file basename for `shape: "spa-program"`).
 *   - `<RoleVariant>` is the role-enum variant name (or `_anonymous` for
 *     the floor case).
 *   - `<tier>` is one of `initial` / `tier1` / `tier2` / `tierN<N>`.
 *   - `<8-char-hash>` is the content-addressed hash (placeholder
 *     `"00000000"` at A-4.1).
 *
 * Cross-references:
 *   - SPEC.md §40.9.7 (L17774-17793) — per-tier output structure.
 *   - SPEC.md §40.9.8 (L17794-17812) — determinism preservation.
 *   - SPEC.md §47.5 (L19152-19174) — content-addressing scope of application.
 *   - SPEC.md §47.9.2 — output path encoding + path-preserve rule.
 *   - PIPELINE.md Stage 8 (L2414-2495) — codegen orchestrator contract.
 *   - docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md
 *     §3.1 — A-4.1 sub-phase scope (this file).
 *   - docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md
 *     §4.2 — Shape B (RECOMMENDED) architectural pattern.
 */

import type {
  ChunkContents,
  ChunkPlan,
  EntryPointId,
  ReachabilityRecord,
  RoleVariant,
  VendorUnitId,
  NodeId,
} from "../types/reachability.ts";
import type { CompileContext } from "./context.ts";
import type { CgFileOutput } from "./index.ts";
import { CGError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Public types — chunk descriptor shapes (A-4.1)
// ---------------------------------------------------------------------------

/**
 * Canonical per-chunk tier name.
 *
 *   - `"initial"`   → `ChunkPlan.initialChunk`
 *   - `"tier1"`     → `ChunkPlan.prefetchTier1`
 *   - `"tier2"`     → `ChunkPlan.prefetchTier2`
 *   - `"tierN<N>"`  → `ChunkPlan.prefetchTierN[N - 3]` (N ≥ 3)
 *
 * Tier-N is structurally empty in v0.3 per OQ-A2-B Option a — the
 * iteration produces zero `tierN*` entries until RS extends to N ≥ 3.
 */
export type ChunkTier = "initial" | "tier1" | "tier2" | `tierN${number}`;

/**
 * Canonical chunk identifier.
 *
 * Composed from the three iteration axes: entry point × role × tier.
 * Used as the Map key for `EmitPerRouteResult.chunks` AND as the
 * canonical reference label in `ChunksManifest` entries.
 *
 * Format: `${EntryPointId}::${RoleVariant}::${ChunkTier}`.
 *
 * Determinism: the ChunkKey is a pure projection of `(EpId, Role, Tier)`
 * with no compile-time side input. Identical source produces identical
 * key shapes (§40.9.8).
 */
export type ChunkKey = `${EntryPointId}::${RoleVariant}::${ChunkTier}`;

/**
 * The emit-shape for a single per-(entry-point, role, tier) chunk.
 *
 * At A-4.1 `payloadJs` is always `""` (empty placeholder body) and
 * `chunkHash` is always `"00000000"` (placeholder). A-4.2 populates
 * `payloadJs`; A-4.6 populates `chunkHash`.
 *
 * The atom-id sets are pass-through copies from `ChunkContents` so A-4.2
 * (and later) can compose payloads without re-reading the
 * ReachabilityRecord.
 */
export interface ChunkOutput {
  /** Canonical `${EpId}::${Role}::${Tier}` key. */
  key: ChunkKey;
  /** Entry-point id this chunk belongs to. */
  entryPointId: EntryPointId;
  /** Role variant this chunk admits content for. */
  role: RoleVariant;
  /** Tier label per `ChunkTier`. */
  tier: ChunkTier;
  /**
   * Output filename relative to the per-app dist root.
   *
   * Shape (OQ-A4-C): `<route-path>/<RoleVariant>.<tier>.<8-char-hash>.js`.
   *
   * Computed at A-4.1; the `<8-char-hash>` segment is the placeholder
   * `"00000000"` until A-4.6 lands real content-addressing.
   */
  filename: string;
  /**
   * 8-character content-address hash. Placeholder `"00000000"` at A-4.1;
   * real FNV-1a base36 hash (§47.1.3) lands at A-4.6.
   */
  chunkHash: string;
  /**
   * The chunk's JS payload body. Empty string at A-4.1; A-4.2 populates
   * for `tier === "initial"`; A-4.3/A-4.4 for tier1/tier2.
   */
  payloadJs: string;
  /** Component DG node ids admitted to this chunk (pass-through from ChunkContents). */
  componentNodeIds: Set<NodeId>;
  /** Reactive cell DG node ids admitted to this chunk. */
  reactiveCellNodeIds: Set<NodeId>;
  /** Server-fn DG node ids admitted to this chunk. */
  serverFnNodeIds: Set<NodeId>;
  /** Vendor unit names admitted to this chunk (§41 atom set). */
  vendorUnitNames: Set<VendorUnitId>;
}

/**
 * Per-tier manifest entries for a single (entry-point, role) pair.
 *
 * Maps tier → ChunkKey. Missing tier keys indicate the tier produced no
 * chunk (e.g. tierN is unpopulated in v0.3 per OQ-A2-B Option a).
 */
export interface ChunksManifestEntry {
  initial?: ChunkKey;
  tier1?: ChunkKey;
  tier2?: ChunkKey;
  /** Index-aligned with `ChunkPlan.prefetchTierN`; sparse-empty in v0.3. */
  tierN?: ChunkKey[];
}

/**
 * Per-app chunks.json manifest shape.
 *
 * Per OQ-A4-A (ratified) the manifest is ALWAYS emitted when
 * `--emit-per-route` is set. Per §40.9.8 the manifest itself is
 * deterministic-from-source-only — identical source produces identical
 * manifest bytes.
 *
 * `version: 1` is the manifest schema version. The shape MAY extend in
 * v0.4+ (telemetry-PGO hints per Approach B); version bump signals
 * incompatibility.
 *
 * `compiler` is the compiler identity string — diagnostic-only, not
 * a determinism axis (per §40.9.8 the compiler version is NOT an input
 * to chunk content hashes; the manifest field is informational).
 */
export interface ChunksManifest {
  version: 1;
  compiler: string;
  /** entryPoints[<EntryPointId>][<RoleVariant>] = ChunksManifestEntry. */
  entryPoints: Record<EntryPointId, Record<RoleVariant, ChunksManifestEntry>>;
}

/**
 * Input contract for `emitPerRouteChunks`.
 *
 * The function consumes the RS output (`reachabilityRecord`), the
 * per-file CompileContext (for cross-referencing AST + analysis when
 * A-4.2 populates real payloads), and the per-file output map produced
 * by the per-file emit phase (for atom-emitter access at A-4.2).
 *
 * At A-4.1 only `reachabilityRecord` is structurally consumed; the
 * other two fields are reserved for A-4.2+.
 */
export interface EmitPerRouteInput {
  reachabilityRecord: ReachabilityRecord;
  /**
   * Per-file CompileContexts produced during per-file analysis/plan/emit.
   * Map key is the absolute source file path.
   *
   * Reserved for A-4.2 — at A-4.1 this is unused (kept on the input
   * shape so the public contract is stable across sub-phases).
   */
  cgContextByFile?: Map<string, CompileContext>;
  /**
   * Per-file output map from `runCG`'s per-file emit pass.
   *
   * Reserved for A-4.2 — at A-4.1 this is unused for the same stability
   * reason as `cgContextByFile`.
   */
  perFileOutputs?: Map<string, CgFileOutput>;
}

/**
 * Output of `emitPerRouteChunks`.
 *
 *   - `chunks` — per-chunk descriptor map keyed by canonical `ChunkKey`.
 *   - `manifest` — `chunks.json` shape (per OQ-A4-A always-emit).
 *   - `diagnostics` — `CGError[]` for splitter-surfaced lints / errors.
 *     Empty at A-4.1; A-4.7 introduces W-CG-CHUNK-* lints.
 */
export interface EmitPerRouteResult {
  chunks: Map<ChunkKey, ChunkOutput>;
  manifest: ChunksManifest;
  diagnostics: CGError[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Placeholder hash used at A-4.1 before A-4.6 lands content-addressing.
 *
 * Eight zeros — distinct from any real FNV-1a base36 hash so tests can
 * assert the placeholder is present (and A-4.6's tests can assert it is
 * REPLACED).
 */
export const CHUNK_HASH_PLACEHOLDER = "00000000";

/**
 * Anonymous role tag used when the app has no role enum (SPEC §40.1.1).
 *
 * Mirrors `reachability/component-4.ts:ANONYMOUS_ROLE` and the
 * PIPELINE Stage 7.6 L2380 convention.
 */
const ANONYMOUS_ROLE: RoleVariant = "_anonymous";

/**
 * Compiler identity string surfaced in `ChunksManifest.compiler`.
 *
 * Informational only — per §40.9.8 the compiler version is NOT a
 * chunk-hash input. The field exists for adopter tooling (debug
 * inspectors, future telemetry-PGO surfaces) to identify the compiler
 * that produced the manifest.
 */
const COMPILER_IDENTITY = "scrml-0.3.0";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Emit per-(entry-point, role, tier) chunk descriptors from the Stage 7.6
 * ReachabilityRecord.
 *
 * At A-4.1: iteration scaffold only. Each chunk descriptor carries:
 *   - Correct canonical `key` / `entryPointId` / `role` / `tier`.
 *   - Correct OQ-A4-C filename with `CHUNK_HASH_PLACEHOLDER`.
 *   - Empty `payloadJs: ""`.
 *   - Pass-through atom id sets from the underlying `ChunkContents`.
 *
 * No actual chunk-content emission happens at A-4.1; A-4.2 populates
 * `payloadJs` for `initial` tier; A-4.3/A-4.4 for tier1/tier2.
 *
 * Iteration order:
 *
 *   for each (epId, rps) in reachabilityRecord.closures:
 *     for each (role, plan) in rps.byRole:
 *       for tier in ["initial", "tier1", "tier2", ...tierN]:
 *         emit chunk descriptor
 *
 * Per SPEC §40.9.8 the iteration is deterministic: the underlying RS
 * output uses canonical Map ordering (insertion-order of EpId enumeration
 * + sorted RoleVariant), so iteration here preserves that order without
 * additional sorting.
 *
 * @param input Reachability record + (reserved) per-file context map.
 * @returns ChunkKey-indexed chunk descriptors + manifest + diagnostics.
 */
export function emitPerRouteChunks(
  input: EmitPerRouteInput,
): EmitPerRouteResult {
  const chunks = new Map<ChunkKey, ChunkOutput>();
  const manifest: ChunksManifest = {
    version: 1,
    compiler: COMPILER_IDENTITY,
    entryPoints: {},
  };
  const diagnostics: CGError[] = [];

  const { reachabilityRecord } = input;
  if (!reachabilityRecord) {
    // Defensive: a caller may pass an undefined record when
    // `--emit-per-route` is set but RS produced no output (degenerate
    // pipeline-bypass case). Return the empty result shape.
    return { chunks, manifest, diagnostics };
  }

  for (const [epId, rps] of reachabilityRecord.closures) {
    const roleMap: Record<RoleVariant, ChunksManifestEntry> = {};
    for (const [role, plan] of rps.byRole) {
      const entry: ChunksManifestEntry = {};

      // initial
      const initialChunk = makeChunkOutput(epId, role, "initial", plan.initialChunk);
      chunks.set(initialChunk.key, initialChunk);
      entry.initial = initialChunk.key;

      // tier1
      const tier1Chunk = makeChunkOutput(epId, role, "tier1", plan.prefetchTier1);
      chunks.set(tier1Chunk.key, tier1Chunk);
      entry.tier1 = tier1Chunk.key;

      // tier2
      const tier2Chunk = makeChunkOutput(epId, role, "tier2", plan.prefetchTier2);
      chunks.set(tier2Chunk.key, tier2Chunk);
      entry.tier2 = tier2Chunk.key;

      // tierN (N ≥ 3). Empty in v0.3 per OQ-A2-B Option a; iteration is
      // structurally present for v0.4+ compatibility.
      if (plan.prefetchTierN.length > 0) {
        entry.tierN = [];
        for (let i = 0; i < plan.prefetchTierN.length; i++) {
          const nLabel = `tierN${i + 3}` as ChunkTier;
          const tierNChunk = makeChunkOutput(epId, role, nLabel, plan.prefetchTierN[i]);
          chunks.set(tierNChunk.key, tierNChunk);
          entry.tierN.push(tierNChunk.key);
        }
      }

      roleMap[role] = entry;
    }
    manifest.entryPoints[epId] = roleMap;
  }

  return { chunks, manifest, diagnostics };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a single ChunkOutput descriptor for an (EP, role, tier) triple.
 *
 * At A-4.1 the payload is `""` and the hash is `CHUNK_HASH_PLACEHOLDER`.
 * The atom id sets are FRESH copies (so downstream A-4.2 emission can
 * mutate without aliasing the RS record).
 */
function makeChunkOutput(
  entryPointId: EntryPointId,
  role: RoleVariant,
  tier: ChunkTier,
  contents: ChunkContents,
): ChunkOutput {
  const key = makeChunkKey(entryPointId, role, tier);
  const filename = makeChunkFilename(entryPointId, role, tier, CHUNK_HASH_PLACEHOLDER);
  return {
    key,
    entryPointId,
    role,
    tier,
    filename,
    chunkHash: CHUNK_HASH_PLACEHOLDER,
    payloadJs: "",
    componentNodeIds: new Set(contents.componentNodeIds),
    reactiveCellNodeIds: new Set(contents.reactiveCellNodeIds),
    serverFnNodeIds: new Set(contents.serverFnNodeIds),
    vendorUnitNames: new Set(contents.vendorUnitNames),
  };
}

/**
 * Compose the canonical `${EpId}::${Role}::${Tier}` key.
 */
function makeChunkKey(
  entryPointId: EntryPointId,
  role: RoleVariant,
  tier: ChunkTier,
): ChunkKey {
  return `${entryPointId}::${role}::${tier}` as ChunkKey;
}

/**
 * Compose the OQ-A4-C filename: `<route-path>/<RoleVariant>.<tier>.<hash>.js`.
 *
 * The `<route-path>` segment is derived from the EntryPointId. By
 * convention (RS A-2.2 enumeration) the id encodes either the page's
 * routePath (e.g. `"<file>::#page::/dashboard"`) or the file's
 * SPA-program anchor (`"<file>::#program"`). A-4.1 extracts a
 * filesystem-safe route segment from the id; A-4.7 will refine this with
 * the real `RouteMap` cross-reference at HTML emission time.
 *
 * Filesystem-safety rules:
 *   - Leading `/` is stripped (routes like `/dashboard` → `dashboard`).
 *   - SPA-program entries (`shape: "spa-program"`) use the entry file's
 *     basename as the route segment.
 *   - Empty / root routes (`/`) map to the literal `"_root"` segment so
 *     the filename pattern stays well-formed.
 *   - Any characters outside `[A-Za-z0-9/_-]` are replaced with `_`
 *     (defense-in-depth; well-formed routes don't trigger this).
 */
function makeChunkFilename(
  entryPointId: EntryPointId,
  role: RoleVariant,
  tier: ChunkTier,
  hash: string,
): string {
  const routeSegment = routeSegmentFromEntryPointId(entryPointId);
  return `${routeSegment}/${role}.${tier}.${hash}.js`;
}

/**
 * Extract a filesystem-safe route segment from an EntryPointId.
 *
 * EntryPointId shape (per `reachability/entry-points.ts`):
 *   - `"<absolute-file-path>::#page::<routePath>"` for `<page>` entries.
 *   - `"<absolute-file-path>::#program"` for SPA-program entries.
 *
 * The function partitions on the `::` separator and uses the trailing
 * segment for routing. A-4.7 may refine this once the full RouteMap is
 * threaded through (the current shape suffices for filename derivation).
 */
function routeSegmentFromEntryPointId(epId: EntryPointId): string {
  const idStr = String(epId);
  // Find the LAST `::` group — typical shape ends with `::#program` or
  // `::#page::<routePath>`.
  const pageMarker = "::#page::";
  const programMarker = "::#program";

  let raw: string;
  const pageIdx = idStr.lastIndexOf(pageMarker);
  if (pageIdx !== -1) {
    raw = idStr.substring(pageIdx + pageMarker.length);
  } else if (idStr.endsWith(programMarker)) {
    // SPA-program: use the file's basename (without `.scrml`) as the segment.
    const filePart = idStr.substring(0, idStr.length - programMarker.length);
    raw = basenameOfFile(filePart);
  } else {
    // Fallback: use the whole id, sanitized. Degenerate path — covers
    // synthesized ids in test fixtures that don't match either marker.
    raw = idStr;
  }

  // Strip leading slashes; map empty / "/" to "_root".
  let cleaned = raw.replace(/^\/+/, "");
  if (cleaned === "" || cleaned === "/") {
    cleaned = "_root";
  }
  // Sanitize: keep [A-Za-z0-9/_-], replace anything else with `_`.
  cleaned = cleaned.replace(/[^A-Za-z0-9/_-]/g, "_");
  return cleaned;
}

/**
 * Basename of a file path, stripping `.scrml` if present.
 *
 * Independent of `node:path` to keep this module pure-ts and trivially
 * portable to the eventual self-host scrml rewrite.
 */
function basenameOfFile(filePath: string): string {
  const slashIdx = filePath.lastIndexOf("/");
  const tail = slashIdx === -1 ? filePath : filePath.substring(slashIdx + 1);
  if (tail.endsWith(".scrml")) {
    return tail.substring(0, tail.length - ".scrml".length);
  }
  return tail;
}

// ---------------------------------------------------------------------------
// Manifest serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a ChunksManifest to canonical JSON.
 *
 * Per §40.9.8 the output is deterministic: identical input produces
 * identical bytes. `JSON.stringify` with a 2-space indent suffices —
 * the Map iteration upstream is already in canonical (insertion) order
 * and `Record<>` field insertion order is preserved by ES2015+ engines.
 *
 * Exported so api.js can call it to write `chunks.json` post-codegen
 * without re-implementing the contract.
 */
export function serializeChunksManifest(manifest: ChunksManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

// Re-export the ANONYMOUS_ROLE constant for test convenience without
// requiring direct imports of `reachability/component-4.ts`. Kept private
// inside this module to avoid creating a parallel canonical declaration.
export { ANONYMOUS_ROLE };
