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
 * Sub-phase history:
 *   - A-4.1 — Iteration scaffold + empty `payloadJs: ""` + placeholder
 *     `"00000000"` hash; correctly-shaped `ChunkKey` / `ChunkOutput` /
 *     `ChunksManifest` so A-4.2..A-4.7 attach to a stable contract.
 *   - A-4.2 — Populates `payloadJs` for `initialChunk` from per-file
 *     emitter atoms.
 *   - A-4.3 — Populates `payloadJs` for `prefetchTier1` + idle-prefetch
 *     runtime wiring (`_scrml_prefetch_tier1`).
 *   - **A-4.6** — Content-addressed `chunkHash` (FNV-1a base36 over
 *     `(admission_sets, payloadJs)`, per §47.5 / §40.9.8 / §47.1.3).
 *     The placeholder `"00000000"` is now ALWAYS replaced via
 *     `finalizeChunkHash` BEFORE the chunk descriptor surfaces on the
 *     public return; the constant `CHUNK_HASH_PLACEHOLDER` is retained
 *     solely as the regression-guard sentinel ("assert NOT placeholder").
 *
 * Subsequent sub-phases:
 *   - A-4.4 — Populate `payloadJs` for `prefetchTier2` + hover-prefetch.
 *   - A-4.5 — `prefetchTierN` (N ≥ 3) dispatch hook.
 *   - A-4.7 — Per-route HTML augmentation + W-CG-CHUNK-* lints.
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
 *   - `<8-char-hash>` is the FNV-1a base36 content-addressed hash
 *     (real after A-4.6; replaces the A-4.1 `"00000000"` placeholder).
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
import {
  emitReactiveCellAtom,
  emitServerFnStubAtom,
  emitVendorUnitRef,
  emitComponentAtom,
  canonicalNodeIdArray,
  canonicalVendorUnitArray,
  findNodeById,
  type RouteInfo,
} from "./atom-emitter.ts";
import { fnv1aHash } from "./fnv1a-hash.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
 * Post-A-4.6:
 *   - `chunkHash` is the FNV-1a base36 8-char content-addressed hash
 *     of `(admission_sets, payloadJs)` per §47.5 / §40.9.8 / §47.1.3.
 *     The A-4.1 placeholder `"00000000"` is replaced by
 *     `finalizeChunkHash` before any chunk descriptor leaves the
 *     splitter.
 *   - `filename` mirrors the real hash via the same finalization step.
 *   - `payloadJs` is populated for `tier === "initial"` (A-4.2) and
 *     `tier === "tier1"` (A-4.3) when a CompileContext is supplied;
 *     remains `""` for the unit-test direct-invocation path and for
 *     `tier2` / `tierN` until A-4.4 / A-4.5 land their composers.
 *
 * The atom-id sets are pass-through copies from `ChunkContents` so the
 * downstream composers can compose payloads without re-reading the
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
   * Post-A-4.6: the `<8-char-hash>` segment is the real FNV-1a base36
   * content-addressed hash. The A-4.1 placeholder is replaced by
   * `finalizeChunkHash` immediately after payload composition.
   */
  filename: string;
  /**
   * 8-character content-address hash (FNV-1a base36 over the canonical
   * `(admission_sets, payloadJs)` input — §47.1.3 + §47.5).
   *
   * Post-A-4.6: real hash; the A-4.1 `"00000000"` placeholder is
   * never observable on a public ChunkOutput.
   */
  chunkHash: string;
  /**
   * The chunk's JS payload body. Populated for `tier === "initial"`
   * (A-4.2) and `tier === "tier1"` (A-4.3) when a CompileContext is
   * supplied. Empty `""` for the unit-test direct-invocation path AND
   * for `tier2` / `tierN` (until A-4.4 / A-4.5).
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
  /**
   * Q-OPEN-5 — Soft size budget (bytes) for the `W-CG-CHUNK-LARGE` lint.
   * When unset, the splitter uses `CHUNK_LARGE_SOFT_BUDGET_BYTES`
   * (default 100 000) — i.e. the existing v0.3 default behavior is
   * preserved when no caller threads a value here.
   *
   * Surfaced via the `--chunk-size-budget=<bytes>` CLI flag on
   * `scrml compile` (parsed in `commands/compile.js`, threaded through
   * `compileScrml` in `api.js`, then into `runCG`'s `CgInput`).
   *
   * Non-positive or non-finite values are ignored (default applies).
   */
  chunkSizeBudgetBytes?: number;
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
 * Sentinel hash retained as the A-4.6 regression guard.
 *
 * Eight zeros — distinct from any real FNV-1a base36 hash. Post-A-4.6
 * the placeholder is NEVER observable on a public ChunkOutput
 * (`finalizeChunkHash` replaces it with the real content-addressed
 * hash before the chunk surfaces on `emitPerRouteChunks`'s return).
 * The constant is kept for two reasons:
 *
 *   1. **Regression-guard sentinel.** Tests assert
 *      `chunk.chunkHash !== CHUNK_HASH_PLACEHOLDER` to prove the
 *      placeholder was replaced. If a future refactor accidentally
 *      drops the `finalizeChunkHash` call, these tests fail loudly.
 *
 *   2. **Internal stamp before finalize.** `makeChunkOutput` still
 *      uses this value as the initial `chunkHash` / filename hash
 *      segment. The value is overwritten by `finalizeChunkHash`
 *      before the chunk surfaces externally; it is never the final
 *      value on any emitted chunk.
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
 * Sentinel surfaced when scrml `package.json` cannot be read or its
 * `version` field is missing/non-string. The `chunks.json` manifest's
 * `compiler` field is informational only — a fallback value is always
 * preferable to throwing inside codegen (Q-OPEN-4 ratification, S92).
 */
const COMPILER_IDENTITY_FALLBACK = "scrml-unknown";

/**
 * Cached `compiler` identity string. Populated on first call to
 * `getCompilerIdentity()`; subsequent calls reuse the cached value.
 *
 * `undefined` is the un-loaded sentinel; once loaded, the value is the
 * string `"scrml-" + V` (where `V` is `package.json` `version`) on
 * success, or `COMPILER_IDENTITY_FALLBACK` on any read/parse failure.
 */
let cachedCompilerIdentity: string | undefined;

/**
 * Compute the `ChunksManifest.compiler` identity string from the
 * scrml `package.json` `version` field (Q-OPEN-4, S92).
 *
 * Single-sourced from `package.json` so the manifest tracks the shipped
 * compiler version without a manually-synced string constant. The value
 * has shape `"scrml-" + V` where `V` is the literal `version` field
 * (e.g. `"scrml-0.3.0-alpha.0"`).
 *
 * Informational only — per §40.9.8 the compiler version is NOT a
 * chunk-hash input. The field exists for adopter tooling (debug
 * inspectors, future telemetry-PGO surfaces) to identify the compiler
 * that produced the manifest. See SPEC §47.5 for the normative anchor.
 *
 * Defensive contract: this function NEVER throws. If `package.json`
 * cannot be read, cannot be parsed, or has no string `version` field,
 * the function returns `COMPILER_IDENTITY_FALLBACK` (`"scrml-unknown"`).
 * The `chunks.json` manifest's `compiler` field MUST always carry SOME
 * string value — adopter tooling SHOULD treat the fallback sentinel as
 * a "version not determinable from this build" signal.
 *
 * Caching: the result is memoized at module scope after the first call.
 * Tests that need to assert the fallback path SHOULD invoke this
 * function fresh in a child process or directly stub the helper's
 * read path; in-process cache invalidation is intentionally not
 * exposed.
 */
export function getCompilerIdentity(): string {
  if (cachedCompilerIdentity !== undefined) {
    return cachedCompilerIdentity;
  }
  // Locate scrml package.json relative to this module:
  //   compiler/src/codegen/route-splitter.ts → ../../../package.json
  // Use `import.meta.url` so the resolution is correct regardless of
  // whether the module is imported from source (Bun TS loader) or from
  // a future bundled distribution.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "..", "..", "package.json");
  cachedCompilerIdentity = _computeCompilerIdentityFromPath(pkgPath);
  return cachedCompilerIdentity;
}

/**
 * Read+parse `package.json` at the given path and compute the
 * `compiler` identity string without caching. Internal seam for the
 * Q-OPEN-4 fallback-contract tests at
 * `codegen-chunk-manifest-compiler-identity.test.js §4`.
 *
 * Production callers SHOULD use `getCompilerIdentity()` (cached,
 * path-resolved relative to this module). The leading underscore on
 * the name + the `_internalDoNotUse` parameter name mark this as a
 * test-only seam; downstream code MUST NOT depend on it.
 *
 * Returns `COMPILER_IDENTITY_FALLBACK` (`"scrml-unknown"`) on any
 * read/parse failure, missing `version` field, non-string `version`
 * field, or empty-string `version` field. NEVER throws.
 *
 * @internal
 */
export function _computeCompilerIdentityFromPath(
  _internalDoNotUse: string,
): string {
  try {
    const raw = readFileSync(_internalDoNotUse, "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      return `scrml-${pkg.version}`;
    }
  } catch {
    // Swallow — fall through to fallback. The `compiler` field is
    // informational; an unreadable package.json must NOT block codegen.
  }
  return COMPILER_IDENTITY_FALLBACK;
}

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
    compiler: getCompilerIdentity(),
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

  // A-4.2 — entry-point filePath resolution so `composeInitialChunk` can
  // look up the right per-file `CompileContext` for atom emission. The
  // EntryPointId encodes the source filepath as a prefix; we extract it
  // once per epId so the composer doesn't have to re-parse the id.
  const ctxByFile = input.cgContextByFile;

  for (const [epId, rps] of reachabilityRecord.closures) {
    const roleMap: Record<RoleVariant, ChunksManifestEntry> = {};
    const epFilePath = filePathFromEntryPointId(epId);
    const epCtx = (ctxByFile && epFilePath) ? ctxByFile.get(epFilePath) : undefined;

    // -- A-4.4 — read the `hasPrefetchableLinks` flag once per entry
    // point. The flag is set by `emit-html.ts` when at least one
    // `<a href="/...">` resolves to a `RouteMap.pages` urlPattern AND
    // is decorated with `data-scrml-prefetch`. The route-splitter
    // forwards this single boolean into `composeInitialChunk` for
    // every role under this entry point (the flag is file-scoped,
    // not role-scoped — the same set of links exists in HTML for
    // every viewer role; the *runtime* `_scrml_current_role()` call
    // decides which target-route chunk URL is fetched at hover-time).
    const hasPrefetchableLinks = Boolean(
      (epCtx as undefined | { hasPrefetchableLinks?: boolean })?.hasPrefetchableLinks,
    );

    for (const [role, plan] of rps.byRole) {
      const entry: ChunksManifestEntry = {};

      // -- tier1 (A-4.3) -- compose FIRST so the initial-chunk IIFE
      // tail can reference the tier-1 chunk URL when the admission set
      // is non-empty. Empty admission → empty payloadJs (skipped by
      // api.js write loop) + null IIFE-tail (no prefetch call emitted)
      // + `_scrml_prefetch_tier1` tree-shaken from SCRML_RUNTIME.
      //
      // The composer is only invoked when (a) we have a CompileContext
      // (unit-test direct invocations may not) AND (b) the admission
      // set is non-empty. Both checks compose: any of (a)-(b) failing
      // leaves `payloadJs = ""` and `tier1Url = null`.
      const tier1Chunk = makeChunkOutput(epId, role, "tier1", plan.prefetchTier1);
      const tier1NonEmpty = !isChunkContentsEmpty(plan.prefetchTier1);
      if (epCtx && tier1NonEmpty) {
        tier1Chunk.payloadJs = composeTier1Chunk(plan.prefetchTier1, epCtx, epId, role);
      }
      // -- A-4.6 § content-addressing -- The placeholder `"00000000"`
      // hash is replaced with the real FNV-1a base36 hash computed
      // over `(admissionSets, payloadJs)`. We MUST hash the tier-1
      // chunk BEFORE deriving `tier1Url` so the URL passed into the
      // initial-chunk IIFE tail references the content-addressed
      // filename, not the placeholder one. See SPEC §47.5 + §40.9.8 +
      // SCOPING §3.6 for the normative contract.
      finalizeChunkHash(tier1Chunk);

      // The IIFE-tail prefetch URL is the tier-1 chunk's filename
      // resolved relative to the per-app dist root. We emit it as an
      // absolute-path URL (`/<filename>`) so the runtime fetch resolves
      // against the same origin as the initial chunk's host page. The
      // tier-1 URL is only passed when the admission is non-empty AND
      // we actually composed a real chunk payload.
      const tier1Url = (epCtx && tier1NonEmpty)
        ? `/${tier1Chunk.filename}`
        : null;

      // -- initial (A-4.2) -- composer optionally appends an IIFE-tail
      // `_scrml_prefetch_tier1(<tier1Url>)` call when `tier1Url` is
      // non-null AND a hover-handler attachment block when
      // `hasPrefetchableLinks` is true. When the route-splitter has no
      // CompileContext (unit-test direct invocation with `makeRecord`),
      // the initial-chunk payload falls back to the empty string; the
      // byte-deterministic canonical empty is `""` which composes
      // safely with the manifest determinism contract.
      const initialChunk = makeChunkOutput(epId, role, "initial", plan.initialChunk);
      if (epCtx) {
        initialChunk.payloadJs = composeInitialChunk(
          plan.initialChunk,
          epCtx,
          epId,
          role,
          tier1Url,
          hasPrefetchableLinks,
        );
      }
      // -- A-4.6 -- Hash AFTER payload composition. The tier-1-URL
      // reference inside the initial payload contributes to its bytes,
      // so the hash bakes in the tier-1 chunk's filename. This makes
      // the initial-chunk hash sensitive to upstream tier-1 changes
      // (which is the right behavior — a tier-1 hash flip means the
      // initial chunk's prefetch URL changed, so the initial chunk's
      // observable behavior changed too).
      finalizeChunkHash(initialChunk);

      chunks.set(initialChunk.key, initialChunk);
      entry.initial = initialChunk.key;

      chunks.set(tier1Chunk.key, tier1Chunk);
      entry.tier1 = tier1Chunk.key;

      // -- tier2 (A-4.4 + A-4.6 merged) -- compose payload (A-4.4)
      // then content-address hash (A-4.6). Empty admission → empty
      // payloadJs (skipped by api.js write loop); non-empty admission
      // → real chunk file. Per SCOPING §3.4 the v0.3 RS A-2.5 floor
      // admits NO components for intra-route tier-2; the composer is
      // structurally present for v0.4 RS refinement (OQ-A4-B deferred).
      //
      // The cross-route hover-prefetch wiring (the dominant case for
      // tier-2 — nav `<a href>` hovers warming target-route initial
      // chunks) lives in `composeInitialChunk`'s IIFE-tail attachment
      // block (driven by `hasPrefetchableLinks` above), NOT here.
      //
      // Empty-payload chunks still get a real hash per §40.9.8 (the
      // canonical empty-input hash is deterministic); the manifest
      // entry is preserved per OQ-A4-A always-emit. When A-4.4 lands
      // a real tier-2 composer payload, the hash picks it up.
      const tier2Chunk = makeChunkOutput(epId, role, "tier2", plan.prefetchTier2);
      const tier2NonEmpty = !isChunkContentsEmpty(plan.prefetchTier2);
      if (epCtx && tier2NonEmpty) {
        tier2Chunk.payloadJs = composeTier2Chunk(plan.prefetchTier2, epCtx, epId, role);
      }
      finalizeChunkHash(tier2Chunk);
      chunks.set(tier2Chunk.key, tier2Chunk);
      entry.tier2 = tier2Chunk.key;

      // tierN (N ≥ 3). Empty in v0.3 per OQ-A2-B Option a; iteration is
      // structurally present for v0.4+ compatibility.
      if (plan.prefetchTierN.length > 0) {
        entry.tierN = [];
        for (let i = 0; i < plan.prefetchTierN.length; i++) {
          const nLabel = `tierN${i + 3}` as ChunkTier;
          const tierNChunk = makeChunkOutput(epId, role, nLabel, plan.prefetchTierN[i]);
          // -- A-4.6 -- Same empty-payload hash treatment as tier-2.
          finalizeChunkHash(tierNChunk);
          chunks.set(tierNChunk.key, tierNChunk);
          entry.tierN.push(tierNChunk.key);
        }
      }

      roleMap[role] = entry;
    }
    manifest.entryPoints[epId] = roleMap;
  }

  // -------------------------------------------------------------------------
  // A-4.7 — W-CG-CHUNK-* lint family (per-entry-point post-emission scan).
  //
  // After all per-(EP, role, tier) chunks are produced, scan the chunks +
  // manifest + per-file context for the four §40.9.11 lint conditions:
  //
  //   - W-CG-CHUNK-EMPTY        — entry-point has zero non-empty chunks.
  //   - W-CG-CHUNK-LARGE        — initial chunk exceeds soft size budget.
  //   - W-CG-CHUNK-NO-PREFETCH  — internal <a> links present but tier-2
  //                                hover-prefetch wiring missing.
  //   - W-CG-CHUNK-MISSING-ROLE — <auth role=X> references a role with no
  //                                per-role chunk.
  //
  // The scan fires at most one lint of each kind per entry-point. The
  // implementation is intentionally conservative: lints fire only when the
  // signal is unambiguous (the goal is signal-to-noise, not catch-all).
  // -------------------------------------------------------------------------
  emitChunkLints(
    reachabilityRecord,
    chunks,
    ctxByFile,
    diagnostics,
    resolveChunkSizeBudget(input.chunkSizeBudgetBytes),
  );

  return { chunks, manifest, diagnostics };
}

/**
 * Q-OPEN-5 — Resolve the effective `W-CG-CHUNK-LARGE` soft size budget
 * for a single `emitPerRouteChunks` invocation.
 *
 * The default `CHUNK_LARGE_SOFT_BUDGET_BYTES` (100 000) applies when:
 *   - the caller did not pass `chunkSizeBudgetBytes`, OR
 *   - the value is not a finite positive number (defensive — guards
 *     against `--chunk-size-budget=foo` rotting through type-erasure
 *     into a `NaN` here).
 *
 * Otherwise the floor-of-input value is used. We floor because the
 * lint compares against a byte count (integer); fractional inputs are
 * meaningless. A budget of `0` (or any non-positive value) reverts to
 * the default — passing `0` is unambiguous "use default" and avoids
 * silent disabling of the lint.
 */
function resolveChunkSizeBudget(input: number | undefined): number {
  if (input === undefined) return CHUNK_LARGE_SOFT_BUDGET_BYTES;
  if (typeof input !== "number") return CHUNK_LARGE_SOFT_BUDGET_BYTES;
  if (!Number.isFinite(input)) return CHUNK_LARGE_SOFT_BUDGET_BYTES;
  if (input <= 0) return CHUNK_LARGE_SOFT_BUDGET_BYTES;
  return Math.floor(input);
}

/**
 * Soft size budget for the W-CG-CHUNK-LARGE lint.
 *
 * Default 100 000 bytes (~100 KB raw, ~25-35 KB gzipped — comfortably
 * within the §40.9.7 time-to-interactive target). Initial chunks
 * larger than this trigger the lint; the build still completes. The
 * threshold is intentionally exposed as a top-level constant so
 * adopters can audit it (and so a future v0.4 `--chunk-size-budget`
 * CLI flag has a single source-of-truth).
 */
export const CHUNK_LARGE_SOFT_BUDGET_BYTES = 100_000;

/**
 * Emit the W-CG-CHUNK-* lint family (A-4.7).
 *
 * Walks the produced chunks Map + reachability record once per entry
 * point. Each lint fires at most once per (EP, role) so the noise
 * floor stays low.
 *
 * @param reachabilityRecord The Stage 7.6 RS output (closures Map).
 * @param chunks The chunks Map produced by the per-EP iteration.
 * @param ctxByFile Per-file CompileContext map (for routeMap + auth
 *   gate inspection). When undefined, the role-coverage lint is
 *   skipped (we cannot resolve auth role refs without ctx).
 * @param diagnostics Output array — lints are pushed here as CGError
 *   instances with severity='warning'.
 * @param chunkSizeBudgetBytes Q-OPEN-5 — effective soft size budget
 *   for the `W-CG-CHUNK-LARGE` lint. Defaults to
 *   `CHUNK_LARGE_SOFT_BUDGET_BYTES` (100 000) when the caller did not
 *   thread an override (or threaded a non-positive value).
 */
function emitChunkLints(
  reachabilityRecord: ReachabilityRecord,
  chunks: Map<ChunkKey, ChunkOutput>,
  ctxByFile: Map<string, CompileContext> | undefined,
  diagnostics: CGError[],
  chunkSizeBudgetBytes: number = CHUNK_LARGE_SOFT_BUDGET_BYTES,
): void {
  // Aggregate per-EP chunk shapes for the lint scans.
  const chunksByEp = new Map<EntryPointId, ChunkOutput[]>();
  for (const chunk of chunks.values()) {
    let list = chunksByEp.get(chunk.entryPointId);
    if (!list) {
      list = [];
      chunksByEp.set(chunk.entryPointId, list);
    }
    list.push(chunk);
  }

  // Defensive span — when the lint cannot pin a precise source span,
  // use a file-scoped synthetic span anchored at offset 0. The lint
  // surfaces the EP id in the message; adopters can locate the source
  // site without a precise span.
  function makeDefensiveSpan(filePath: string): CGSpanLike {
    return { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  }

  for (const [epId, epChunks] of chunksByEp) {
    const filePath = filePathFromEntryPointId(epId);
    const span = makeDefensiveSpan(filePath);

    // -- W-CG-CHUNK-EMPTY ----------------------------------------------
    //
    // Fires when ALL chunks across all roles + tiers for this EP have
    // empty admission sets AND empty payloads (the build still emitted
    // initial chunks with the IIFE shell, but they admit nothing — no
    // reactive cells, no server fns, no vendor units, no markup
    // components). Probable cause: misconfigured `<page>` or empty
    // `<program>` body.
    //
    // We check the SHAPE (admission sets) rather than payload bytes
    // because an initial chunk's payload always includes the IIFE shell
    // + chunk header comments (~200 bytes minimum), so the empty check
    // must be admission-set-based.
    let totalAdmissionCount = 0;
    for (const c of epChunks) {
      totalAdmissionCount +=
        c.componentNodeIds.size +
        c.reactiveCellNodeIds.size +
        c.serverFnNodeIds.size +
        c.vendorUnitNames.size;
    }
    if (totalAdmissionCount === 0) {
      diagnostics.push(
        new CGError(
          "W-CG-CHUNK-EMPTY",
          `W-CG-CHUNK-EMPTY: Entry-point \`${epId}\` produces zero non-empty chunks ` +
          `across all roles. The per-(role, tier) admission sets are all empty (no ` +
          `reactive cells, server functions, vendor units, or admitted markup ` +
          `components). Probable cause: a misconfigured \`<page>\` or empty ` +
          `\`<program>\` body. The build still completes; the per-route HTML ships ` +
          `the role-bootstrap which warns at runtime when the manifest lookup ` +
          `misses. Resolution: remove the empty entry point OR add content to the ` +
          `\`<page>\` / \`<program>\` body. (§40.9.7 / §40.9.11)`,
          span,
          "warning",
        ),
      );
    }

    // -- W-CG-CHUNK-LARGE ----------------------------------------------
    //
    // Fires when the per-(EP, role) INITIAL chunk's payload exceeds the
    // soft size budget. Tier-1 / tier-2 / tier-N chunks are NOT scanned
    // — they're prefetched, not blocking; their size budget is more
    // forgiving. The initial chunk is the time-to-interactive critical
    // path; large initial-chunk payloads degrade perceived performance.
    //
    // One lint per (EP, role) so multi-role apps surface per-role size
    // signals without aggregating them.
    for (const c of epChunks) {
      if (c.tier !== "initial") continue;
      const byteLen = utf8ByteLength(c.payloadJs);
      if (byteLen > chunkSizeBudgetBytes) {
        diagnostics.push(
          new CGError(
            "W-CG-CHUNK-LARGE",
            `W-CG-CHUNK-LARGE: Initial chunk for entry-point \`${epId}\` role ` +
            `\`${c.role}\` is ${byteLen} bytes — exceeds the soft size budget ` +
            `of ${chunkSizeBudgetBytes} bytes (~${Math.round(
              chunkSizeBudgetBytes / 1000,
            )} KB). Large initial chunks ship eagerly to first paint; they ` +
            `degrade time-to-interactive. Probable causes: a route that should ` +
            `be split, vendor units that should move to tier-1, or a single-page ` +
            `bundle that should tier-split. The build still completes; the lint ` +
            `surfaces the size-budget signal. Resolution: split the route OR ` +
            `move heavy admissions to tier-1 / tier-2 OR accept the warning if ` +
            `the size is unavoidable. (§40.9.7 / §40.9.11)`,
            span,
            "warning",
          ),
        );
      }
    }

    // -- W-CG-CHUNK-NO-PREFETCH / W-CG-CHUNK-PREFETCH-UNRESOLVED ------
    //
    // Q-OPEN-6 — split the single "no prefetch wired" signal into two
    // codes so adopters can distinguish two structurally different
    // situations:
    //
    //   - `W-CG-CHUNK-NO-PREFETCH` (INFO) — case 1: the file has NO
    //     internal-shaped `<a href="/...">` links at all. There is
    //     genuinely "no prefetch possible"; the build is not buggy,
    //     this is just informational signal that hover-prefetch is
    //     dead-code for this entry-point.
    //
    //   - `W-CG-CHUNK-PREFETCH-UNRESOLVED` (WARNING) — case 2: the
    //     file has internal-shaped `<a href="/...">` links BUT none of
    //     them resolved to a known `RouteMap.pages` urlPattern (typo,
    //     missing page, or unimplemented route). This is the
    //     actionable case — adopters likely expected hover-prefetch
    //     and aren't getting it.
    //
    // Both lints fire only in multi-route apps (`pageCount > 1`) where
    // cross-route hover-prefetch would be valuable. Single-route
    // apps (SPAs) get no false positive — there are no other routes
    // to prefetch.
    //
    // The two flags `hasInternalLinks` (structural-existence) and
    // `hasPrefetchableLinks` (resolution-succeeded) are populated by
    // `emit-html.ts` during the markup walk; see `context.ts` for
    // their definitions.
    const epCtx = ctxByFile?.get(filePath);
    if (epCtx) {
      const pages = epCtx.routeMap?.pages;
      const pageCount = (pages && typeof pages.size === "number") ? pages.size : 0;
      const hasInternalLinks = Boolean(
        (epCtx as { hasInternalLinks?: boolean }).hasInternalLinks,
      );
      const hasPrefetchableLinks = Boolean(
        (epCtx as { hasPrefetchableLinks?: boolean }).hasPrefetchableLinks,
      );
      if (pageCount > 1 && !hasPrefetchableLinks) {
        if (hasInternalLinks) {
          // Case 2 — links exist but none resolved. Warning-level.
          diagnostics.push(
            new CGError(
              "W-CG-CHUNK-PREFETCH-UNRESOLVED",
              `W-CG-CHUNK-PREFETCH-UNRESOLVED: Entry-point \`${epId}\` is in a multi-route ` +
              `application (${pageCount} pages in RouteMap) and its HTML contains internal-shaped ` +
              `\`<a href="/...">\` links — but NONE of them resolved to a known ` +
              `\`RouteMap.pages\` urlPattern. Cross-route navigation loses the §40.9.7 ` +
              `hover-warming speedup. Probable causes: a typo in the \`<a href>\` value; ` +
              `the linked route is not yet a \`<page>\` in this compilation unit; OR the ` +
              `link points at a sub-path of a parametric route that A-4.4 exact-match ` +
              `does not yet recognize (deferred to A-4.7+). The build still completes. ` +
              `Resolution: verify the \`<a href>\` paths match a \`<page>\` urlPattern ` +
              `exactly (no trailing slash mismatch, no typo), OR confirm intentional opt-out. ` +
              `(§40.9.7 / §40.9.11)`,
              span,
              "warning",
            ),
          );
        } else {
          // Case 1 — no internal links at all. Info-level.
          diagnostics.push(
            new CGError(
              "W-CG-CHUNK-NO-PREFETCH",
              `W-CG-CHUNK-NO-PREFETCH: Entry-point \`${epId}\` is in a multi-route ` +
              `application (${pageCount} pages in RouteMap) but its HTML contains no internal ` +
              `\`<a href="/...">\` links at all — so cross-route hover-prefetch wiring is ` +
              `genuinely dead-code for this entry-point. The build is not buggy; this lint ` +
              `is informational. Probable causes: navigation lives entirely in JS handlers ` +
              `(not declarative \`<a href>\`); the entry-point is a leaf page with no ` +
              `outbound navigation; OR all \`<a>\` elements use external URLs / template ` +
              `interpolation / fragment-only hrefs. Resolution: if cross-route ` +
              `hover-prefetch was expected, switch to declarative \`<a href="/route">\` ` +
              `links; otherwise no action required. (§40.9.7 / §40.9.11)`,
              span,
              "info",
            ),
          );
        }
      }
    }

    // -- W-CG-CHUNK-MISSING-ROLE --------------------------------------
    //
    // Fires when the per-file source contains `<auth role="X">` blocks
    // referencing a role variant `X` that has NO per-role chunk emitted
    // (RS Component 4 produced no `ChunkPlan` for that role). Runtime
    // users with that role get the `_anonymous` fallback chunk.
    //
    // Detection: walk the file's AST for `<auth role>` attribute values
    // (string literals only — interpolated role= is skipped); collect
    // the set of named roles; compare against the set of role names in
    // this EP's chunks Map (each ChunkOutput.role).
    //
    // Best-effort — when ctx is unavailable (test direct-invocation
    // paths), the lint is skipped.
    if (epCtx && epCtx.fileAST) {
      const referencedRoles = collectAuthRoleReferences(epCtx.fileAST);
      const emittedRoles = new Set<string>();
      for (const c of epChunks) emittedRoles.add(c.role);
      for (const role of referencedRoles) {
        if (!emittedRoles.has(role)) {
          diagnostics.push(
            new CGError(
              "W-CG-CHUNK-MISSING-ROLE",
              `W-CG-CHUNK-MISSING-ROLE: An \`<auth role="${role}">\` block in ` +
              `entry-point \`${epId}\` references a role variant that has NO ` +
              `per-role chunk emitted (Reachability Solver Component 4 produced no ` +
              `ChunkPlan for this role). Runtime users with role \`${role}\` will ` +
              `get the \`_anonymous\` fallback chunk, which admits a more ` +
              `conservative set than intended. Probable causes: the role variant ` +
              `is named in the gate but not in the resolved app-scope role-enum ` +
              `(would also fire \`E-AUTH-GRAPH-003\`); OR RS Component 4 ` +
              `misclassified the role and produced an empty closure. Resolution: ` +
              `verify role \`${role}\` exists in the role-enum; if it does, file a ` +
              `compiler bug with the source. (§40.9.7 / §40.9.11)`,
              span,
              "warning",
            ),
          );
        }
      }
    }
  }
}

/**
 * UTF-8 byte length of a string. Pure-ts implementation independent
 * of `Buffer` so the function is portable to the eventual self-host
 * scrml rewrite. Matches `Buffer.byteLength(s, "utf8")` for valid
 * UTF-16 input.
 */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF) {
      // High surrogate — count the surrogate pair as 4 bytes.
      bytes += 4;
      i++; // skip low surrogate
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Loose CGError span shape. Matches the `CGSpan` interface in
 * `errors.ts` but allows extra fields without import friction.
 */
type CGSpanLike = { file: string; start: number; end: number; line: number; col: number };

/**
 * Walk a FileAST and collect every `<auth role="X">` reference where
 * `X` is a string-literal value (interpolated `role=${@x}` references
 * are skipped — they can't be statically resolved at compile time).
 *
 * Returns the set of role-name strings.
 *
 * Used by the W-CG-CHUNK-MISSING-ROLE lint to compare source-cited
 * roles against the set of roles for which the route-splitter
 * actually emitted chunks.
 */
function collectAuthRoleReferences(fileAST: unknown): Set<string> {
  const roles = new Set<string>();
  const ast = (fileAST as { ast?: { nodes?: unknown[] } })?.ast;
  const nodes: unknown[] = Array.isArray(ast?.nodes)
    ? (ast!.nodes as unknown[])
    : Array.isArray((fileAST as { nodes?: unknown[] })?.nodes)
      ? ((fileAST as { nodes: unknown[] }).nodes)
      : [];

  function visit(list: unknown[]): void {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const n = raw as Record<string, unknown>;
      if (n.kind === "markup" && n.tag === "auth") {
        const attrs = (Array.isArray(n.attributes) ? n.attributes : Array.isArray(n.attrs) ? n.attrs : []) as Array<{ name?: string; value?: { kind?: string; value?: string; variant?: string } }>;
        for (const a of attrs) {
          if (a?.name !== "role") continue;
          const v = a.value;
          if (!v) continue;
          // Accept string-literal "X" OR variant-literal `Role.X` shapes.
          if (v.kind === "string-literal" && typeof v.value === "string" && v.value !== "") {
            roles.add(v.value);
          } else if ((v.kind === "variant-literal" || v.kind === "enum-variant") && typeof v.variant === "string" && v.variant !== "") {
            roles.add(v.variant);
          }
        }
      }
      if (Array.isArray(n.children)) visit(n.children as unknown[]);
      if (Array.isArray(n.body)) visit(n.body as unknown[]);
    }
  }

  visit(nodes);
  return roles;
}

// ---------------------------------------------------------------------------
// composeInitialChunk — A-4.2 §40.9.7 initial_chunk(E) emitter
// composeTier1Chunk   — A-4.3 §40.9.7 prefetch_tier_1(E) emitter
// ---------------------------------------------------------------------------

/**
 * Anonymous-role sentinel used in the hover-handler fallback when no
 * `_scrml_current_role()` runtime helper is present (A-4.4 ships with
 * the placeholder; A-4.7 lands the real role-bootstrap per OQ-A4-E
 * hybrid). Mirrors `ANONYMOUS_ROLE` below.
 */
const HOVER_HANDLER_ROLE_FALLBACK = "_anonymous";

/**
 * Compose the `payloadJs` body for an `initial`-tier chunk from a
 * `ChunkContents` admission set + the per-file `CompileContext`.
 *
 * **§40.9.7 normative shape:**
 *
 *   `initial_chunk(E)` SHALL contain every component, server-fn stub,
 *   and vendor unit in `playable_surface(E, N=0)`.
 *
 * The composer walks the four admission sets in canonical order
 * (stratified comparator per A-2.8) and calls the matching atom
 * emitter for each id:
 *
 *   1. Vendor units (emit FIRST so subsequent atoms can reference
 *      the bound namespace variable).
 *   2. Server-fn fetch stubs.
 *   3. Reactive cell init lines.
 *   4. Component mount markers (admitted markup nodes).
 *
 * The result is wrapped in an IIFE so the chunk is self-contained when
 * evaluated as a regular `<script>` (no global-scope pollution); the
 * shared `SCRML_RUNTIME` symbols are assumed to be in scope as global
 * declarations from the always-loaded runtime file (which the per-app
 * dist root carries at `scrml-runtime.js` per `index.ts`).
 *
 * **Determinism (§40.9.8):** every set iteration uses the canonical
 * comparator; the output is byte-identical across runs for identical
 * input. Two builds of the same source produce identical chunk-payload
 * bytes — a prerequisite for A-4.6 content-addressed hashing.
 *
 * **`null` for absence (§42.5/§42.8):** any literal absence in the
 * emitted JS is `null`. The atoms here delegate to `atom-emitter.ts`,
 * which enforces this internally.
 *
 * **A-4.3 IIFE-tail prefetch call.** When the corresponding (EP, role)
 * `ChunkPlan` has a non-empty `prefetchTier1` admission set, the
 * initial-chunk IIFE is augmented with a trailing
 * `_scrml_prefetch_tier1("<chunk-url>")` call before the IIFE close so
 * the browser begins fetching tier-1 after first paint. Empty tier-1
 * admission sets produce NO prefetch call (and no tier-1 file —
 * `_scrml_prefetch_tier1` is tree-shaken from `SCRML_RUNTIME` in that
 * case).
 *
 * **A-4.4 IIFE-tail hover-handler attachment.** When
 * `hasPrefetchableLinks` is true (set by `emit-html.ts` after at least
 * one `<a href="/internal-route">` was wired with
 * `data-scrml-prefetch`), the IIFE tail also attaches a
 * `mouseenter` + `focus` once-listener pair that calls
 * `_scrml_prefetch_tier2(routePath, role)` on first hover/focus.
 * `_scrml_current_role()` is consulted for the live viewer role with a
 * `"_anonymous"` fallback (the runtime helper is provided by A-4.7's
 * role-bootstrap; A-4.4 ships the fallback).
 *
 * Per OQ-A4-E ratification (hybrid: ONE HTML per route +
 * role-bootstrap), the `data-scrml-prefetch` attribute lives on the
 * `<a>` element so the runtime scan is a single
 * `document.querySelectorAll("a[data-scrml-prefetch]")` pass — no
 * server-side per-link prefetch tag, no per-role HTML variance for the
 * link attachment.
 *
 * @param contents The `ChunkContents` admission set for `initial` tier.
 * @param ctx The per-file CompileContext for the entry point's source
 *   file. Used to resolve node ids → AST nodes for atom emission.
 * @param epId Entry-point id (informational; surfaces in the chunk
 *   header comment for adopter debugging).
 * @param role Role variant (informational; surfaces in the chunk
 *   header comment so per-role chunks are visually distinguishable).
 * @param tier1Url When non-null, a `_scrml_prefetch_tier1(<tier1Url>)`
 *   call is appended to the IIFE tail. `null` (default) emits no
 *   prefetch call — used when the (EP, role)'s tier-1 admission set is
 *   empty so the prefetch runtime is tree-shaken.
 * @param hasPrefetchableLinks When true, a hover-handler attachment
 *   block is appended to the IIFE tail. The block scans the DOM for
 *   `<a data-scrml-prefetch>` elements and wires `mouseenter` +
 *   `focus` once-listeners. Default `false` — `emit-html.ts` sets
 *   `ctx.hasPrefetchableLinks` to `true` when at least one internal
 *   `<a href="/...">` is wired; `emitPerRouteChunks` reads that flag
 *   and forwards it here.
 * @returns The fully-composed `payloadJs` string.
 */
export function composeInitialChunk(
  contents: ChunkContents,
  ctx: CompileContext,
  epId: EntryPointId,
  role: RoleVariant,
  tier1Url: string | null = null,
  hasPrefetchableLinks: boolean = false,
): string {
  const lines: string[] = [];

  // Chunk header — adopter-readable, deterministic, role-aware.
  lines.push(`// scrml initial chunk — entryPoint=${epId} role=${role}`);
  lines.push(`// §40.9.7 initial_chunk(E) — admitted set per playable_surface(E, N=0)`);
  lines.push(`(function () {`);
  lines.push(`  "use strict";`);

  appendAtomLines(lines, contents, ctx);

  // -- A-4.3 IIFE-tail tier-1 idle-prefetch call. --
  //
  // When the (EP, role)'s ChunkPlan.prefetchTier1 admits a non-empty
  // set, the route-splitter passes the tier-1 chunk URL here and the
  // initial chunk schedules an idle-callback prefetch after first
  // paint. When the admission set is empty, `tier1Url` is null and no
  // call is emitted — the corresponding tier-1 file is also not
  // written, and the `_scrml_prefetch_tier1` runtime function is
  // tree-shaken from SCRML_RUNTIME (see `runtime-chunks.ts:prefetch`
  // marker + `emit-client.ts:detectRuntimeChunks`).
  //
  // Per SPEC §40.9.7: "prefetch_tier_1(E) SHALL be idle-prefetched
  // after initial render. The implementation SHOULD use
  // `requestIdleCallback` ...". The runtime function implements that
  // SHOULD using `requestIdleCallback` browser-side with a
  // `setTimeout(fn, 1)` Safari fallback (OQ-A4-G ratification S91 —
  // Option γ).
  if (tier1Url !== null) {
    lines.push(``);
    lines.push(`  // --- §40.9.7 tier-1 idle prefetch (OQ-A4-G Option γ) ---`);
    lines.push(`  _scrml_prefetch_tier1(${JSON.stringify(tier1Url)});`);
  }

  // -- A-4.4 IIFE-tail hover-handler attachment for cross-route
  // prefetch. --
  //
  // Scans the DOM for `<a data-scrml-prefetch="<route>">` elements
  // (wired by `emit-html.ts` when an internal `<a href="/...">` resolves
  // to a `RouteMap.pages` entry) and attaches a `mouseenter` + `focus`
  // once-listener pair. On first hover/focus, the listener calls
  // `_scrml_prefetch_tier2(route, _scrml_current_role())` which issues
  // a `<link rel="prefetch">` for the target route's initial chunk —
  // making cross-route navigation feel instant when the user actually
  // clicks.
  //
  // Per OQ-A4-E ratification (hybrid: ONE HTML per route +
  // role-bootstrap), the role detection is centralized in
  // `_scrml_current_role()` (provided by A-4.7's role-bootstrap). At
  // A-4.4 the helper does not yet exist; we fall back to the
  // `"_anonymous"` sentinel (matches `reachability/component-4.ts`'s
  // `ANONYMOUS_ROLE`) so the chunk URL composes against the
  // anonymous-role chunk hash. When A-4.7 lands, the fallback path
  // becomes the unauth case rather than the default.
  //
  // Listener semantics — `{ once: true, passive: true }`:
  //   - `once: true` — fire exactly once per element. The browser HTTP
  //     cache handles repeat hovers (the second `<link rel="prefetch">`
  //     would be a no-op cache hit).
  //   - `passive: true` — signals that the listener does not call
  //     `preventDefault()`; browsers can optimize scroll/touch on
  //     touchscreens (per the §40.9.7 SHOULD on hover signal).
  //
  // Tree-shake invariant: when `hasPrefetchableLinks` is false (no
  // `data-scrml-prefetch` attrs were emitted in HTML), the attachment
  // block is omitted from the IIFE. The `_scrml_prefetch_tier2` runtime
  // function is also tree-shaken from SCRML_RUNTIME (the `prefetch`
  // chunk fails the `detectRuntimeChunks` activation gate).
  if (hasPrefetchableLinks) {
    lines.push(``);
    lines.push(`  // --- §40.9.7 tier-2 hover-prefetch wiring (A-4.4) ---`);
    lines.push(`  if (typeof document !== "undefined") {`);
    lines.push(`    var _scrml_links = document.querySelectorAll("a[data-scrml-prefetch]");`);
    lines.push(`    for (var i = 0; i < _scrml_links.length; i++) {`);
    lines.push(`      (function (el) {`);
    lines.push(`        var attach = function () {`);
    lines.push(`          var route = el.getAttribute("data-scrml-prefetch");`);
    lines.push(`          var roleFn = (typeof _scrml_current_role === "function")`);
    lines.push(`            ? _scrml_current_role`);
    lines.push(`            : function () { return ${JSON.stringify(HOVER_HANDLER_ROLE_FALLBACK)}; };`);
    lines.push(`          _scrml_prefetch_tier2(route, roleFn());`);
    lines.push(`        };`);
    lines.push(`        el.addEventListener("mouseenter", attach, { once: true, passive: true });`);
    lines.push(`        el.addEventListener("focus", attach, { once: true, passive: true });`);
    lines.push(`      })(_scrml_links[i]);`);
    lines.push(`    }`);
    lines.push(`  }`);
  }

  lines.push(`})();`);
  // Trailing newline so chunks concatenate cleanly when sequenced into
  // a single SSR-injected `<script>` block (a v1.0 polish target).
  lines.push("");

  return lines.join("\n");
}

/**
 * Compose the `payloadJs` body for a `tier1`-tier chunk from a
 * `ChunkContents` admission set + the per-file `CompileContext`.
 *
 * **§40.9.7 normative shape:**
 *
 *   `prefetch_tier_1(E) := playable_surface(E, N=1) − initial_chunk(E)`
 *
 * The tier-1 chunk is the DELTA over the initial chunk — only the
 * components / server-fn stubs / reactive cells / vendor units that
 * become reachable at interaction depth N=1 but were NOT already
 * admitted to the initial chunk. The RS solver (A-2.5 Component 4)
 * computes this delta and surfaces it as
 * `ChunkPlan.prefetchTier1.{componentNodeIds, reactiveCellNodeIds,
 * serverFnNodeIds, vendorUnitNames}`. The composer here just walks
 * those sets in canonical order and concatenates the atom outputs.
 *
 * **Empty tier-1 contract.** When all four admission sets are empty,
 * the caller (`emitPerRouteChunks`) MUST skip both the prefetch call
 * AND the tier-1 file write (so the tree-shake elides
 * `_scrml_prefetch_tier1` from SCRML_RUNTIME). This composer is NOT
 * called in that case — its non-empty-input contract is enforced at
 * the call site via `isChunkContentsEmpty`.
 *
 * **Determinism (§40.9.8):** byte-identical input → byte-identical
 * output. Reuses the same canonical comparator + atom emitters as
 * `composeInitialChunk` to preserve the §40.9.8 hash-input invariant.
 *
 * **§40.9.9 worked example normative.** For the worked example with
 * viewer=Driver, `prefetch_tier_1(/) = {}` (lines 17873-17874): the
 * RS solver produces an empty tier-1 plan, the composer is not
 * invoked, no file is written, no prefetch call is emitted, and the
 * runtime helper is tree-shaken. The integration test asserts this
 * end-to-end.
 *
 * @param contents The `ChunkContents` admission set for `tier1` tier.
 * @param ctx The per-file CompileContext for the entry point's source
 *   file. Used to resolve node ids → AST nodes for atom emission.
 * @param epId Entry-point id (informational; chunk header comment).
 * @param role Role variant (informational; chunk header comment).
 * @returns The fully-composed `payloadJs` string.
 */
export function composeTier1Chunk(
  contents: ChunkContents,
  ctx: CompileContext,
  epId: EntryPointId,
  role: RoleVariant,
): string {
  const lines: string[] = [];

  // Chunk header — distinct from initial chunk by tier label so adopters
  // can visually verify which file they are inspecting.
  lines.push(`// scrml tier-1 chunk — entryPoint=${epId} role=${role}`);
  lines.push(`// §40.9.7 prefetch_tier_1(E) — playable_surface(E, N=1) − initial_chunk(E)`);
  lines.push(`(function () {`);
  lines.push(`  "use strict";`);

  appendAtomLines(lines, contents, ctx);

  lines.push(`})();`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Compose the `payloadJs` body for a `tier2`-tier chunk from a
 * `ChunkContents` admission set + the per-file `CompileContext`.
 *
 * **§40.9.7 normative shape:**
 *
 *   `prefetch_tier_2(E) := playable_surface(E, N=2) − playable_surface(E, N=1)`
 *
 * The tier-2 chunk is the DELTA over the tier-1 surface — only the
 * components / server-fn stubs / reactive cells / vendor units that
 * become reachable at interaction depth N=2 but were NOT already
 * admitted at N=1. The §40.9.7 normative wording also describes a
 * SECOND tier-2 dispatch shape — cross-route hover-prefetch (`<a>`
 * link hovers warm the target route's INITIAL chunk). A-4.4 implements
 * both surfaces; this composer handles the intra-route side (i.e. the
 * chunk file contents when the RS solver admits N=2 components for the
 * current entry point).
 *
 * **Empirical floor (v0.3 SCOPING §3.4).** Per RS A-2.5 Component 4 the
 * intra-route tier-2 admission set is currently empty (`prefetchTier2.
 * componentNodeIds = new Set()` floor). The composer is present
 * structurally for v0.4 RS refinement (OQ-A4-B deferred); it is rarely
 * invoked in v0.3 (the caller `emitPerRouteChunks` only invokes it
 * when `isChunkContentsEmpty(contents)` is false, which means the
 * synthetic unit-test path is the typical exerciser).
 *
 * **Cross-route vs intra-route — DO NOT CONFUSE.** Cross-route
 * hover-prefetch (the dominant case — nav `<a href>` hovers) is wired
 * by `composeInitialChunk`'s IIFE-tail attachment block. The tier-2
 * CHUNK FILE here is the intra-route deep-interaction surface
 * (focus-or-hover on an interactive component fires the chunk fetch
 * for that component's tier-2 cascade — empty in v0.3).
 *
 * **Empty tier-2 contract.** When all four admission sets are empty,
 * the caller (`emitPerRouteChunks`) MUST skip both the chunk file
 * write AND any cross-reference to the tier-2 chunk URL. This composer
 * is NOT called in that case — its non-empty-input contract is
 * enforced at the call site via `isChunkContentsEmpty`.
 *
 * **Determinism (§40.9.8):** byte-identical input → byte-identical
 * output. Reuses the same canonical comparator + atom emitters as
 * `composeInitialChunk` / `composeTier1Chunk` to preserve the §40.9.8
 * hash-input invariant.
 *
 * @param contents The `ChunkContents` admission set for `tier2` tier.
 * @param ctx The per-file CompileContext for the entry point's source
 *   file. Used to resolve node ids → AST nodes for atom emission.
 * @param epId Entry-point id (informational; chunk header comment).
 * @param role Role variant (informational; chunk header comment).
 * @returns The fully-composed `payloadJs` string.
 */
export function composeTier2Chunk(
  contents: ChunkContents,
  ctx: CompileContext,
  epId: EntryPointId,
  role: RoleVariant,
): string {
  const lines: string[] = [];

  // Chunk header — distinct from initial / tier-1 chunks by tier label
  // so adopters can visually verify which file they are inspecting.
  lines.push(`// scrml tier-2 chunk — entryPoint=${epId} role=${role}`);
  lines.push(`// §40.9.7 prefetch_tier_2(E) — playable_surface(E, N=2) − playable_surface(E, N=1)`);
  lines.push(`(function () {`);
  lines.push(`  "use strict";`);

  appendAtomLines(lines, contents, ctx);

  lines.push(`})();`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Shared atom-section emitter used by both `composeInitialChunk` and
 * `composeTier1Chunk`.
 *
 * Walks the four admission sets in canonical order (per A-2.8
 * stratified comparator) and appends the matching atom-emitter output
 * to `lines`. The same section-header comments + indentation are used
 * across tiers so adopter-side visual inspection is consistent.
 *
 * Section ordering:
 *
 *   1. Vendor units (must be first — later atoms may reference the
 *      bound namespace variable).
 *   2. Server-fn fetch stubs.
 *   3. Reactive cell init lines.
 *   4. Component mount markers.
 *
 * Section headers are emitted ONLY when the corresponding admission
 * set is non-empty. Empty sections produce no header (clean output
 * for tier-1 deltas that admit only one section).
 */
function appendAtomLines(
  lines: string[],
  contents: ChunkContents,
  ctx: CompileContext,
): void {
  // -- 1. Vendor unit references (alphabetical-codepoint order). --
  const vendorUnits = canonicalVendorUnitArray(contents.vendorUnitNames);
  if (vendorUnits.length > 0) {
    lines.push(``);
    lines.push(`  // --- vendor units (§41) ---`);
    for (const unitName of vendorUnits) {
      // Vendor units lower to top-level `import` statements; an IIFE
      // body cannot host them, so we surface the import as a chunk-
      // top reference comment. Real `import` emission lives in the
      // per-file `.client.js`; the chunk records the dependency via
      // a runtime `_scrml_vendor_require` call so the bundler can
      // pre-resolve the unit's module ahead of chunk evaluation.
      const atom = emitVendorUnitRef(unitName, ctx.fileAST);
      const specifier = `vendor:${unitName}`;
      lines.push(`  _scrml_vendor_require(${JSON.stringify(specifier)});`);
      // Preserve the import-line as a comment for adopter-debug
      // traceability of the original §41 reference.
      lines.push(`  // ${atom.replace(/\n$/, "")}`);
    }
  }

  // -- 2. Server-fn fetch stubs (canonical node-id order). --
  const serverFnIds = canonicalNodeIdArray(contents.serverFnNodeIds);
  if (serverFnIds.length > 0) {
    lines.push(``);
    lines.push(`  // --- server-fn fetch stubs (§40.9.4 / §52.10) ---`);
    for (const fnId of serverFnIds) {
      const stub = composeServerFnAtom(fnId, ctx);
      if (stub === "") continue;
      // Indent the stub body so the IIFE shell stays well-formed.
      const indented = stub
        .split("\n")
        .map((line) => (line === "" ? "" : `  ${line}`))
        .join("\n");
      lines.push(indented);
    }
  }

  // -- 3. Reactive cell init lines (canonical node-id order). --
  //
  // Reactive cell node ids use the DG `reactive::<filePath>::<span.start>::
  // <counter>` string shape (see `dependency-graph.ts:makeNodeId`). The
  // route-splitter splits on `::` to recover `span.start` and then walks
  // the AST to find the state-decl with that exact span.start.
  const reactiveIds = canonicalNodeIdArray(contents.reactiveCellNodeIds);
  if (reactiveIds.length > 0) {
    lines.push(`  // --- reactive cells (§6) ---`);
    for (const cellId of reactiveIds) {
      const node = resolveReactiveDGNodeIdToAst(cellId, ctx.fileAST);
      if (!node) continue;
      const atom = emitReactiveCellAtom(node, ctx);
      if (atom === "") continue;
      lines.push(`  ${atom.replace(/\n$/, "")}`);
    }
  }

  // -- 4. Component mount markers (admitted markup nodes). --
  const componentIds = canonicalNodeIdArray(contents.componentNodeIds);
  if (componentIds.length > 0) {
    lines.push(`  // --- admitted components (§40.9.2) ---`);
    for (const compId of componentIds) {
      const atom = emitComponentAtom(compId, ctx);
      if (atom === "") continue;
      lines.push(`  ${atom.replace(/\n$/, "")}`);
    }
  }
}

/**
 * Test the four-set admission shape for emptiness.
 *
 * Used by `emitPerRouteChunks` to decide whether to compose a tier-1
 * chunk + emit the IIFE-tail prefetch call. Empty admission across all
 * four sets means:
 *
 *   - NO tier-1 file is written (`payloadJs` stays `""` so api.js's
 *     write loop skips it).
 *   - NO `_scrml_prefetch_tier1` call is emitted in the initial-chunk
 *     IIFE tail.
 *   - The `prefetch` runtime chunk is tree-shaken (no chunk references
 *     `_scrml_prefetch_tier1` so `detectRuntimeChunks` does not add
 *     `prefetch` to the runtime chunk set).
 *
 * Exported so unit tests can pin the empty-detection contract.
 */
export function isChunkContentsEmpty(contents: ChunkContents): boolean {
  return (
    contents.componentNodeIds.size === 0 &&
    contents.reactiveCellNodeIds.size === 0 &&
    contents.serverFnNodeIds.size === 0 &&
    contents.vendorUnitNames.size === 0
  );
}

/**
 * Resolve a reactive-cell DG node id to its AST `state-decl` node.
 *
 * DG node id shape (per `dependency-graph.ts:makeNodeId`):
 *
 *   `reactive::<filePath>::<span.start>::<counter>`
 *
 * The span.start segment is the AUTHORITATIVE link to the AST node —
 * each state-decl in the file has a unique span.start. We parse it and
 * walk the AST for a state-decl whose `span.start` matches.
 *
 * Returns null when:
 *   - The id is not a string (defensive).
 *   - The shape doesn't match (id from a non-reactive DG node kind).
 *   - No state-decl AST node has the parsed span.start.
 */
function resolveReactiveDGNodeIdToAst(
  cellId: NodeId,
  fileAST: unknown,
): Record<string, unknown> | null {
  // Two id shapes are supported:
  //   - Real-pipeline DG ids: `"reactive::<filePath>::<span.start>::
  //     <counter>"` — parse out span.start and walk for a state-decl.
  //   - Synthetic-test ids (numeric or arbitrary string): fall through
  //     to a direct `id ===` match via `findNodeById`.
  if (typeof cellId === "string") {
    const segs = cellId.split("::");
    if (segs.length >= 4 && segs[0] === "reactive") {
      const spanStart = parseInt(segs[segs.length - 2], 10);
      if (Number.isFinite(spanStart)) {
        const found = findStateDeclBySpanStart(fileAST, spanStart);
        if (found) return found;
      }
    }
  }

  // Synthetic id fallback: numeric id or arbitrary string that matches
  // an AST node's `id` field directly. Returns state-decl matches only
  // (defensive: a markup node with the same id would not produce a
  // valid reactive-cell atom).
  const direct = findNodeById(fileAST, cellId) as Record<string, unknown> | null;
  if (direct && direct.kind === "state-decl") return direct;
  return null;
}

/**
 * Walk the AST for the FIRST state-decl whose `span.start` matches.
 */
function findStateDeclBySpanStart(
  fileAST: unknown,
  spanStart: number,
): Record<string, unknown> | null {
  const ast = (fileAST as { ast?: { nodes?: unknown[] } })?.ast;
  const rootNodes: unknown[] = Array.isArray(ast?.nodes)
    ? (ast!.nodes as unknown[])
    : Array.isArray((fileAST as { nodes?: unknown[] })?.nodes)
      ? ((fileAST as { nodes: unknown[] }).nodes)
      : [];

  function visit(nodeList: unknown[]): Record<string, unknown> | null {
    for (const raw of nodeList) {
      if (!raw || typeof raw !== "object") continue;
      const n = raw as Record<string, unknown>;
      if (n.kind === "state-decl") {
        const span = n.span as { start?: number } | undefined;
        if (span && span.start === spanStart) return n;
      }
      if (Array.isArray(n.children)) {
        const sub = visit(n.children as unknown[]);
        if (sub) return sub;
      }
      if (Array.isArray(n.body)) {
        const sub = visit(n.body as unknown[]);
        if (sub) return sub;
      }
    }
    return null;
  }

  return visit(rootNodes);
}

/**
 * Compose a single server-fn fetch stub from a server-fn node id.
 *
 * The id is a stable `${filePath}::${span.start}` shape per
 * `emit-functions.ts:fnNodeId` convention. We split the id on `::` to
 * recover the per-file fnNode (which is keyed by its `span.start`).
 *
 * The route metadata (path + method) lives in `ctx.routeMap.functions`,
 * keyed by the same id. We extract `path` + `method` and hand the pair
 * to `emitServerFnStubAtom`.
 *
 * Returns the empty string when the id cannot be resolved to a
 * function-decl + route entry; the caller skips empties (defensive
 * shape — well-formed RS output should always resolve cleanly).
 */
function composeServerFnAtom(fnId: NodeId, ctx: CompileContext): string {
  const route = ctx.routeMap?.functions?.get(String(fnId));
  if (!route || route.boundary !== "server") return "";

  // The fnId encodes the function-decl's span.start in the file. Find
  // the matching fn node by walking the AST.
  const fnNode = findFunctionNodeByFnId(ctx.fileAST, String(fnId));
  if (!fnNode) return "";

  // Route path: explicit route override OR generated route name as
  // path. Mirror `emit-functions.ts` lines 158-160 routing convention.
  const path: string = (route.explicitRoute as string | undefined)
    ?? (route.generatedRouteName ? `/_scrml/${route.generatedRouteName}` : "");
  if (path === "") return "";
  const method: string = (route.explicitMethod as string | undefined) ?? "POST";

  const routeInfo: RouteInfo = { path, method };
  return emitServerFnStubAtom(fnNode, routeInfo, ctx);
}

/**
 * Walk a FileAST and find a `function-decl` node whose `${filePath}::
 * ${span.start}` matches the target fnId.
 *
 * Mirrors `emit-functions.ts` line 151's fnNodeId construction
 * convention — the RouteMap keys by this same shape.
 */
function findFunctionNodeByFnId(
  fileAST: unknown,
  targetFnId: string,
): Record<string, unknown> | null {
  const ast = (fileAST as { ast?: { nodes?: unknown[] }; filePath?: string });
  const filePath = ast?.filePath ?? "";
  if (!filePath) return null;
  const nodes: unknown[] = Array.isArray(ast?.ast?.nodes)
    ? (ast.ast!.nodes as unknown[])
    : Array.isArray((fileAST as { nodes?: unknown[] })?.nodes)
      ? ((fileAST as { nodes: unknown[] }).nodes)
      : [];

  function visit(nodeList: unknown[]): Record<string, unknown> | null {
    for (const raw of nodeList) {
      if (!raw || typeof raw !== "object") continue;
      const n = raw as Record<string, unknown>;
      if (n.kind === "function-decl") {
        const span = n.span as { start?: number } | undefined;
        if (span && typeof span.start === "number") {
          if (`${filePath}::${span.start}` === targetFnId) return n;
        }
      }
      if (Array.isArray(n.children)) {
        const sub = visit(n.children as unknown[]);
        if (sub) return sub;
      }
      if (Array.isArray(n.body)) {
        const sub = visit(n.body as unknown[]);
        if (sub) return sub;
      }
    }
    return null;
  }

  return visit(nodes);
}

/**
 * Extract the source `filePath` segment from an EntryPointId.
 *
 * EntryPointId encodings supported:
 *
 *   Real pipeline (per `reachability/entry-points.ts` `spaEntryId` /
 *   `pageEntryId`):
 *     - `"<filePath>#program"`         — SPA-program entry.
 *     - `"<filePath>#page@<routePath>"` — per-`<page>` entry by route.
 *     - `"<filePath>#page-<index>"`    — per-`<page>` entry by index.
 *
 *   Legacy / synthetic (A-4.1 test fixtures, route-splitter
 *   `routeSegmentFromEntryPointId`):
 *     - `"<filePath>::#program"`         — synthetic SPA-program.
 *     - `"<filePath>::#page::<routePath>"` — synthetic per-`<page>`.
 *
 * Both formats are recognized so A-4.2 chunk emission works whether
 * fed real-pipeline EpIds or synthetic-test EpIds.
 *
 * Order of attempts:
 *   1. `"::"` separator (legacy / synthetic shape).
 *   2. `"#"` separator (real-pipeline shape).
 *   3. Fallback: the whole id (no separator found).
 */
function filePathFromEntryPointId(epId: EntryPointId): string {
  const idStr = String(epId);
  const dblColonIdx = idStr.indexOf("::");
  if (dblColonIdx !== -1) return idStr.substring(0, dblColonIdx);
  const hashIdx = idStr.indexOf("#");
  if (hashIdx !== -1) return idStr.substring(0, hashIdx);
  return idStr;
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
 * Replace a ChunkOutput's placeholder hash + filename with the real
 * content-addressed hash (per A-4.6).
 *
 * Called by `emitPerRouteChunks` AFTER `payloadJs` is composed for the
 * chunk. Computes `computeChunkHash(contents, payloadJs)` and rebuilds
 * the filename so the on-disk path reflects the content-addressed
 * 8-char hash instead of the A-4.1 `CHUNK_HASH_PLACEHOLDER` sentinel.
 *
 * Per SPEC §47.5 + §40.9.8: the resulting hash is deterministic-from-
 * source-only. Two builds of the same source → identical hash →
 * identical filename → adopter cache (browser, CDN, service-worker)
 * sees a stable URL across builds.
 *
 * The ChunkContents pass-through fields (`componentNodeIds`,
 * `reactiveCellNodeIds`, `serverFnNodeIds`, `vendorUnitNames`) on the
 * ChunkOutput are read by the hash computation — they're the
 * authoritative admission-set source even before payload composition.
 * The payload bytes are read from the ChunkOutput's `payloadJs` field
 * (which has been set by the composer call upstream).
 *
 * Mutates the input. Returns nothing — the chunk descriptor is updated
 * in-place so the caller can continue using the same reference.
 */
function finalizeChunkHash(chunk: ChunkOutput): void {
  const contents: ChunkContents = {
    componentNodeIds: chunk.componentNodeIds,
    reactiveCellNodeIds: chunk.reactiveCellNodeIds,
    serverFnNodeIds: chunk.serverFnNodeIds,
    vendorUnitNames: chunk.vendorUnitNames,
  };
  const realHash = computeChunkHash(contents, chunk.payloadJs);
  chunk.chunkHash = realHash;
  chunk.filename = makeChunkFilename(
    chunk.entryPointId,
    chunk.role,
    chunk.tier,
    realHash,
  );
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
 * EntryPointId shapes recognized:
 *
 *   Real pipeline (per `reachability/entry-points.ts` `spaEntryId` /
 *   `pageEntryId`):
 *     - `"<filePath>#program"`           — SPA-program entry.
 *     - `"<filePath>#page@<routePath>"`  — `<page>` entry with explicit route.
 *     - `"<filePath>#page-<index>"`      — `<page>` entry positional.
 *
 *   Legacy / synthetic (A-4.1 test fixtures):
 *     - `"<filePath>::#page::<routePath>"`  — synthetic per-`<page>`.
 *     - `"<filePath>::#program"`            — synthetic SPA-program.
 *
 * The function dispatches per-shape:
 *
 *   - Explicit-route shapes (`#page@<route>` / `::#page::<route>`)
 *     use `<route>` as the segment.
 *   - Program shapes (`#program` / `::#program`) use the file's basename
 *     (without `.scrml`) as the segment.
 *   - Positional shapes (`#page-<N>`) use the file's basename plus
 *     `_page<N>` as the segment so multiple positional entries in the
 *     same file resolve to distinct directories.
 *   - Anything else falls back to the whole id, sanitized — degenerate
 *     path for test fixtures that don't match any known shape.
 *
 * A-4.7 fix: pre-A-4.7 only the synthetic `::#page::` / `::#program`
 * shapes were recognized; real-pipeline IDs fell through to the whole-
 * id sanitized fallback (chunk filenames landed at absurd paths like
 * `_home_user_app_scrml_program/...`). Each of the three real-
 * pipeline shapes is now handled explicitly.
 *
 * Filesystem-safety rules:
 *   - Leading `/` is stripped (routes like `/dashboard` → `dashboard`).
 *   - Empty / root routes (`/`) map to the literal `"_root"` segment so
 *     the filename pattern stays well-formed.
 *   - Any characters outside `[A-Za-z0-9/_-]` are replaced with `_`
 *     (defense-in-depth; well-formed routes don't trigger this).
 */
function routeSegmentFromEntryPointId(epId: EntryPointId): string {
  const idStr = String(epId);

  let raw: string | null = null;

  // -- Real-pipeline shapes (per `reachability/entry-points.ts`) --
  //
  // Order matters: `#page@` is a strict prefix of `#page-` (NO — they
  // share `#page` only). Check `#page@` BEFORE `#page-` since the
  // `@<route>` form is more specific.
  const realPageAtIdx = idStr.indexOf("#page@");
  const realPageIdxIdx = idStr.indexOf("#page-");
  const realProgramIdx = idStr.indexOf("#program");

  // Synthetic shapes (used by A-4.1 / A-4.2 test fixtures).
  const synthPageIdx = idStr.lastIndexOf("::#page::");
  const synthProgramMarker = "::#program";

  if (synthPageIdx !== -1) {
    // Synthetic `<file>::#page::<route>` — preserve A-4.1 contract.
    raw = idStr.substring(synthPageIdx + "::#page::".length);
  } else if (idStr.endsWith(synthProgramMarker)) {
    // Synthetic `<file>::#program` — preserve A-4.1 contract.
    const filePart = idStr.substring(0, idStr.length - synthProgramMarker.length);
    raw = basenameOfFile(filePart);
  } else if (realPageAtIdx !== -1) {
    // Real-pipeline `<file>#page@<route>` — A-4.7 fix.
    raw = idStr.substring(realPageAtIdx + "#page@".length);
  } else if (realPageIdxIdx !== -1) {
    // Real-pipeline `<file>#page-<N>` — A-4.7 fix. Positional pages
    // need a unique-per-N segment so multiple positional pages in the
    // same file don't collide; use `<basename>_page<N>`.
    const filePart = idStr.substring(0, realPageIdxIdx);
    const nPart = idStr.substring(realPageIdxIdx + "#page-".length);
    raw = `${basenameOfFile(filePart)}_page${nPart}`;
  } else if (realProgramIdx !== -1 && idStr.endsWith("#program")) {
    // Real-pipeline `<file>#program` — A-4.7 fix. Use file basename
    // (matches the synthetic-program shape).
    const filePart = idStr.substring(0, realProgramIdx);
    raw = basenameOfFile(filePart);
  } else {
    // Fallback: use the whole id, sanitized. Degenerate path — covers
    // synthesized ids in test fixtures that don't match any known shape.
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
// Content-addressed chunk hashing — A-4.6 (SPEC §47.5 / §40.9.8 / §47.1.3)
// ---------------------------------------------------------------------------

/**
 * Canonical-string field separator for `computeChunkHash`.
 *
 * Choice rationale: ASCII Unit Separator (U+001F, `\x1F`). Reasons:
 *
 *   1. **Collision-prone delimiters rejected.** A literal newline / comma
 *      / pipe could appear inside the JS payload bytes (the last field
 *      of the canonical input) and ambiguate the field boundary. The
 *      Unit Separator is reserved by ASCII for exactly this purpose:
 *      separating data fields in a structured record where the field
 *      contents are otherwise opaque.
 *
 *   2. **Forbidden in JS source.** A `\x1F` byte cannot appear in
 *      well-formed JavaScript outside a string literal — even inside a
 *      string literal it would normally be escaped. The chunk payload
 *      bytes (the last field) are well-formed JS by construction
 *      (`composeInitialChunk` / `composeTier1Chunk` produce template-
 *      literal-style assembled output with explicit `JSON.stringify`
 *      for any embedded string). So `\x1F` cannot collide with payload
 *      content; the field boundary is unambiguous.
 *
 *   3. **Stable across SPEC amendments.** §47.1.4 canonical-string
 *      normalization for per-binding name encoding uses `{}` / `()` /
 *      `:` / `,` as structural delimiters. The chunk-hash canonical
 *      input layers on top of those: each node id (string OR number)
 *      is converted to its string-rep, the four admission sets are
 *      joined with `,` internally, and `\x1F` separates the five
 *      top-level fields (4 admission sets + payload bytes). The choice
 *      does NOT conflict with §47.1.4.
 *
 * The constant is not exported — `computeChunkHash` is the SOLE caller
 * and the boundary is an internal contract. Tests pin the
 * canonical-input shape end-to-end (via hash byte-identity assertions)
 * rather than introspecting the separator.
 */
const CHUNK_HASH_FIELD_SEPARATOR = "\x1F";

/**
 * Canonical-string field-inner separator for `computeChunkHash`.
 *
 * Joins individual node-id / vendor-unit strings WITHIN a single
 * admission-set field. Choice rationale parallel to the field
 * separator: a comma cannot appear in a canonical NodeId string (the
 * pipeline uses `::` for path-segment joining; no comma is ever a
 * structural part of an id) so the comma is a clean inner-separator.
 */
const CHUNK_HASH_ID_SEPARATOR = ",";

/**
 * Compute the §47.5 content-addressed hash for a single chunk.
 *
 * **Algorithm (per SPEC §47.5 + §40.9.8 + A-4 SCOPING §3.6):**
 *
 * ```
 *   canonical_chunk_input := <componentNodeIds_sorted>
 *                          | <reactiveCellNodeIds_sorted>
 *                          | <serverFnNodeIds_sorted>
 *                          | <vendorUnitNames_sorted>
 *                          | <chunk_js_bytes>
 *   chunk_hash := fnv1a_base36(canonical_chunk_input)[0..8]
 * ```
 *
 * Where:
 *   - Each admission-set field is built by `canonicalNodeIdArray` /
 *     `canonicalVendorUnitArray` (stratified comparator: numbers <
 *     strings; codepoint compare within stratum — A-2.8 pattern),
 *     `String(id)`-coerced, then joined with `","` (the inner
 *     separator).
 *   - Field-to-field boundaries use the ASCII Unit Separator (U+001F)
 *     — see `CHUNK_HASH_FIELD_SEPARATOR` for the rationale.
 *   - `chunk_js_bytes` is `chunk.payloadJs` verbatim. A-4.2's R1
 *     determinism test (`compiler/tests/integration/
 *     initial-chunk-emission.test.js` "two compileScrml invocations on
 *     identical source → byte-identical initial chunk JS") is the
 *     PRECONDITION: identical source → identical `payloadJs` →
 *     identical hash. If the precondition is violated the hash
 *     determinism breaks; the precondition is a separate test surface.
 *
 * **Determinism contract (§40.9.8).** Two builds of the same source
 * produce identical `payloadJs` (A-4.2 R1) AND identical admission
 * sets (RS canonical Map ordering) AND therefore identical
 * `canonical_chunk_input` AND therefore identical hashes. No source-
 * environment axis (timestamp, env var, build flag) participates.
 *
 * **Why include both admission sets AND payload bytes?** The §47.5 +
 * SCOPING §3.6 contract reads:
 *
 *   > all inputs to `playable_surface(E, R, N)` PLUS the chunk's
 *   > content-bytes itself
 *
 * Admission sets ARE inputs to the chunk identity (a chunk's "what's
 * inside" surface — same admission set across two roles produces the
 * same hash even if the same role-tag is irrelevant to the payload).
 * Payload bytes are the "produced output". Hashing the concatenation
 * means: a change to either side flips the hash. The cache invalidates
 * IFF the chunk's observable behavior changed.
 *
 * **Empty-chunk case.** When all four admission sets are empty AND
 * `payloadJs === ""`, the canonical input is exactly four field
 * separators (`\x1F\x1F\x1F\x1F\x1F`-with-nothing-between since the
 * fields are empty strings interspersed with separators). The hash is
 * a deterministic constant — not the placeholder `"00000000"` (FNV-1a
 * of four-or-five-byte input lands in the 8-char base36 space with
 * extremely low probability of zero collision). The brief notes the
 * disposition for what to do with empty-chunk MANIFEST entries
 * separately (per Sub-task 3 — current A-4.1 behavior skips writing
 * empty chunk files but still surfaces a manifest entry; the hash
 * computed here is the same deterministic empty-input hash).
 *
 * @param contents The `ChunkContents` admission set for this chunk.
 *   Sourced from `ChunkPlan.{initialChunk|prefetchTier1|prefetchTier2|
 *   prefetchTierN[i]}`.
 * @param payloadJs The fully-composed `chunk.payloadJs` body — typically
 *   the output of `composeInitialChunk` / `composeTier1Chunk` /
 *   `composeTier2Chunk` (A-4.4) / etc. Empty string when the chunk
 *   would not have been written (still hashed for manifest determinism).
 * @returns 8-char lowercase base36 zero-padded hash string. Bit-
 *   identical to the per-binding-encoding `fnv1aHash` output for the
 *   same canonical input (§47.1.3 normative parameters).
 */
export function computeChunkHash(
  contents: ChunkContents,
  payloadJs: string,
): string {
  // Sort each admission set into its canonical order. The stratified
  // comparator (numbers < strings) lifts to a stable codepoint compare
  // within each stratum — mirrors A-2.8's `sortedArrayFromSet`.
  const compIds = canonicalNodeIdArray(contents.componentNodeIds)
    .map((id) => String(id))
    .join(CHUNK_HASH_ID_SEPARATOR);
  const reactIds = canonicalNodeIdArray(contents.reactiveCellNodeIds)
    .map((id) => String(id))
    .join(CHUNK_HASH_ID_SEPARATOR);
  const fnIds = canonicalNodeIdArray(contents.serverFnNodeIds)
    .map((id) => String(id))
    .join(CHUNK_HASH_ID_SEPARATOR);
  const vendorIds = canonicalVendorUnitArray(contents.vendorUnitNames)
    .join(CHUNK_HASH_ID_SEPARATOR);

  // Field order is FIXED. Documented as the §47.5 canonical input
  // shape. Reordering would break the determinism contract for any
  // cached chunk-hash artifact; the order MUST be preserved across
  // releases.
  //
  //   1. componentNodeIds
  //   2. reactiveCellNodeIds
  //   3. serverFnNodeIds
  //   4. vendorUnitNames
  //   5. payloadJs
  const canonicalInput = [
    compIds,
    reactIds,
    fnIds,
    vendorIds,
    payloadJs,
  ].join(CHUNK_HASH_FIELD_SEPARATOR);

  return fnv1aHash(canonicalInput);
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
 * **A-4.6 polish — on-disk JSON carries content-addressed URLs.**
 * The in-memory `ChunksManifestEntry` shape stores `ChunkKey` strings
 * (`${epId}::${role}::${tier}`) so adopter-side in-process tools can
 * dereference each entry into a full `ChunkOutput` via the `chunks`
 * Map. The ON-DISK chunks.json artifact instead carries URL-style
 * filenames (e.g. `"/app/Driver.initial.a4b9c2d1.js"`) so the
 * browser-cache / CDN / service-worker layer can consume the manifest
 * without re-deriving filenames from the ChunkKey shape. The transform
 * lives here so the dual-shape contract is centralized.
 *
 * The `chunks` Map is the lookup table from ChunkKey → ChunkOutput
 * (which carries `filename`). The transform is a 1:1 Map lookup per
 * tier entry — keys that don't resolve (defensive) are surfaced as
 * `null` in the on-disk shape so adopter tools can detect a bad
 * manifest at parse time.
 *
 * Exported so api.js can call it to write `chunks.json` post-codegen
 * without re-implementing the contract.
 *
 * @param manifest The in-memory manifest (ChunkKey-valued).
 * @param chunks   Optional ChunkKey → ChunkOutput Map. When supplied,
 *                 the on-disk JSON uses URL-style filenames. When
 *                 omitted (e.g., back-compat callers, unit tests that
 *                 pre-dated A-4.6), the manifest is serialized
 *                 unchanged (ChunkKey-valued JSON) — preserves the
 *                 existing pre-A-4.6 contract.
 */
export function serializeChunksManifest(
  manifest: ChunksManifest,
  chunks?: Map<ChunkKey, ChunkOutput>,
): string {
  if (!chunks) {
    // Back-compat path: pre-A-4.6 callers (or tests that pass only the
    // manifest) get the ChunkKey-valued JSON unchanged.
    return JSON.stringify(manifest, null, 2) + "\n";
  }

  // A-4.6 transform: ChunkKey → URL-style content-addressed filename.
  // Build a parallel `Record<>` shape with filename-valued entries so
  // the JSON.stringify call produces the adopter-facing shape. The
  // top-level `version` + `compiler` fields pass through unchanged.
  const transformed: {
    version: 1;
    compiler: string;
    entryPoints: Record<string, Record<string, {
      initial?: string | null;
      tier1?: string | null;
      tier2?: string | null;
      tierN?: Array<string | null>;
    }>>;
  } = {
    version: manifest.version,
    compiler: manifest.compiler,
    entryPoints: {},
  };
  const keyToUrl = (k: ChunkKey | undefined): string | null => {
    if (k === undefined) return null;
    const chunk = chunks.get(k);
    if (!chunk) return null;
    // URL-style: leading slash so the cache layer treats it as a
    // path-absolute URL relative to the deployment origin. Matches the
    // tier-1 prefetch URL convention (`emitPerRouteChunks` already
    // composes `/${chunk.filename}` for that purpose — same shape).
    return `/${chunk.filename}`;
  };
  for (const [epId, roleMap] of Object.entries(manifest.entryPoints)) {
    const transformedRoleMap: Record<string, {
      initial?: string | null;
      tier1?: string | null;
      tier2?: string | null;
      tierN?: Array<string | null>;
    }> = {};
    for (const [role, entry] of Object.entries(roleMap)) {
      const transformedEntry: {
        initial?: string | null;
        tier1?: string | null;
        tier2?: string | null;
        tierN?: Array<string | null>;
      } = {};
      if (entry.initial !== undefined) transformedEntry.initial = keyToUrl(entry.initial);
      if (entry.tier1 !== undefined) transformedEntry.tier1 = keyToUrl(entry.tier1);
      if (entry.tier2 !== undefined) transformedEntry.tier2 = keyToUrl(entry.tier2);
      if (entry.tierN !== undefined) {
        transformedEntry.tierN = entry.tierN.map((k) => keyToUrl(k));
      }
      transformedRoleMap[role] = transformedEntry;
    }
    transformed.entryPoints[epId] = transformedRoleMap;
  }
  return JSON.stringify(transformed, null, 2) + "\n";
}

// Re-export the ANONYMOUS_ROLE constant for test convenience without
// requiring direct imports of `reachability/component-4.ts`. Kept private
// inside this module to avoid creating a parallel canonical declaration.
export { ANONYMOUS_ROLE };
