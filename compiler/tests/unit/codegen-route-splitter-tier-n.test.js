/**
 * Codegen Per-Route Artifact Splitter — A-4.5 tier-N on-demand dispatch hook
 *
 * S91 wave A-4.5 ships the runtime-side dispatch surface for
 * `prefetch_tier_N(E)` for N>=3 per SPEC §40.9.7 normative paragraph
 * (L17790-17791). The runtime function `_scrml_fetch_chunk(epId, role, tier)`
 * lives in `runtime-template.js` inside the existing `prefetch` chunk section
 * (alongside `_scrml_prefetch_tier1`). Per OQ-A2-B Option a (S89 ratification)
 * + OQ-A4-D Option a (S91 ratification), RS in v0.3 always emits
 * `prefetchTierN: []` — A-4.5 is structurally complete but never fires in
 * v0.3 because no codegen path emits a call site for `_scrml_fetch_chunk`.
 *
 * Coverage:
 *   §1 Runtime function presence + fetch resolution — synthetic invocation
 *      with a fake `_SCRML_CHUNKS` manifest + fake `fetch` returns the
 *      registered URL's source.
 *   §2 Missing entry returns JS `null` (canonical scrml absence per §42.5 /
 *      §42.8) — adopter MUST null-check before chaining.
 *   §3 Tree-shake LIVE — when no (EP, role) has non-empty tier-1 or tier-N
 *      admission, `detectRuntimeChunks` does NOT activate the `prefetch`
 *      chunk; the assembled runtime omits both `_scrml_prefetch_tier1` AND
 *      `_scrml_fetch_chunk`.
 *   §4 Tree-shake DEAD (forward-compat) — when ANY (EP, role) has non-empty
 *      tier-N admission, `detectRuntimeChunks` activates the `prefetch`
 *      chunk; the assembled runtime includes `_scrml_fetch_chunk`. This
 *      branch never fires in v0.3 (RS emits empty tier-N) but proves the
 *      structural scaffolding is wired.
 *   §5 Splitter emits tier-N chunk key when prefetchTierN is populated
 *      (sanity check that A-4.5 doesn't regress A-4.1's tier-N structural
 *      slot).
 *   §6 Determinism — two builds of identical reachabilityRecord shape produce
 *      byte-identical runtime assemblies.
 *   §7 Chunk-position invariant — `_scrml_fetch_chunk` appears AFTER
 *      `_scrml_prefetch_tier1` AND BEFORE the `// §22.5 meta.emit()` chunk
 *      boundary marker in SCRML_RUNTIME. This is the contract that keeps
 *      the function inside the `prefetch` chunk's slice bounds.
 *
 * Cross-references:
 *   - SPEC.md §40.9.7 (L17790-17791) — tier-N normative paragraph.
 *   - SPEC.md §42.5 / §42.8 — emitted-runtime JS represents scrml `not` as
 *     JS `null`.
 *   - docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md §3.5.
 *   - docs/changes/a-4-5-tier-n-on-demand/BRIEF.md.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  emitPerRouteChunks,
  ANONYMOUS_ROLE,
} from "../../src/codegen/route-splitter.ts";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { RUNTIME_CHUNKS, assembleRuntime } from "../../src/codegen/runtime-chunks.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";

// ---------------------------------------------------------------------------
// Helpers — sandbox-eval the runtime function for direct invocation tests.
// ---------------------------------------------------------------------------

/**
 * Extract a single top-level function declaration's source bytes from the
 * SCRML_RUNTIME string. The runtime is a backtick-template literal pieced
 * together at module init; functions appear verbatim. We scan for the
 * `function <name>(...)` declaration head and balance braces to find the
 * closing `}`. This is sufficient for the small set of well-formed runtime
 * functions; it does NOT handle nested function declarations with the
 * same name (none exist in the runtime).
 */
function extractRuntimeFunctionSource(name) {
  const head = `function ${name}(`;
  const start = SCRML_RUNTIME.indexOf(head);
  if (start < 0) return null;
  // Find the opening brace of the function body.
  const bodyOpen = SCRML_RUNTIME.indexOf("{", start);
  if (bodyOpen < 0) return null;
  let depth = 1;
  let i = bodyOpen + 1;
  while (i < SCRML_RUNTIME.length && depth > 0) {
    const ch = SCRML_RUNTIME[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return SCRML_RUNTIME.slice(start, i);
}

/**
 * Evaluate `_scrml_fetch_chunk` in a sandbox with a controlled
 * `_SCRML_CHUNKS` manifest and a fake `fetch`. Returns the function bound
 * to the sandbox closure.
 */
function buildFetchChunkSandbox({ manifest, fetchImpl }) {
  const src = extractRuntimeFunctionSource("_scrml_fetch_chunk");
  if (!src) throw new Error("_scrml_fetch_chunk not found in SCRML_RUNTIME");
  // Wrap in a factory that returns the function, with _SCRML_CHUNKS + fetch
  // captured by closure. The runtime function uses `typeof _SCRML_CHUNKS`
  // and references `fetch` as a free variable; we provide both via factory
  // parameters.
  const factory = new Function(
    "_SCRML_CHUNKS",
    "fetch",
    `${src}\nreturn _scrml_fetch_chunk;`
  );
  return factory(manifest, fetchImpl);
}

// ---------------------------------------------------------------------------
// §1 — runtime function presence + fetch resolution
// ---------------------------------------------------------------------------

describe("§1 _scrml_fetch_chunk — registered (epId, role, tier) resolves via fetch", () => {
  test("present in SCRML_RUNTIME source bytes", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_fetch_chunk(");
    // Signature: three params (epId, role, tier).
    expect(SCRML_RUNTIME).toContain("_scrml_fetch_chunk(epId, role, tier)");
  });

  test("fetches the registered URL and returns its text body via Promise<string>", async () => {
    const manifest = {
      "/abs/app.scrml::#page::/deep": {
        Admin: {
          tierN3: "/deep/Admin.tierN3.deadbeef.js",
        },
      },
    };
    const fetched = [];
    const fakeFetch = (url) => {
      fetched.push(url);
      return Promise.resolve({
        text: () => Promise.resolve(`/* chunk bytes for ${url} */`),
      });
    };
    const fn = buildFetchChunkSandbox({ manifest, fetchImpl: fakeFetch });
    const result = await fn("/abs/app.scrml::#page::/deep", "Admin", "tierN3");
    expect(fetched).toEqual(["/deep/Admin.tierN3.deadbeef.js"]);
    expect(result).toBe("/* chunk bytes for /deep/Admin.tierN3.deadbeef.js */");
  });
});

// ---------------------------------------------------------------------------
// §2 — missing-entry returns JS null (canonical scrml absence)
// ---------------------------------------------------------------------------

describe("§2 _scrml_fetch_chunk — missing entry returns JS null", () => {
  test("unknown epId → returns null (not undefined, no throw, no fetch)", () => {
    const manifest = {
      "/abs/app.scrml::#program": {
        Driver: { tierN3: "/dispatch/Driver.tierN3.cafebabe.js" },
      },
    };
    let fetchCalls = 0;
    const fakeFetch = () => {
      fetchCalls++;
      return Promise.resolve({ text: () => Promise.resolve("") });
    };
    const fn = buildFetchChunkSandbox({ manifest, fetchImpl: fakeFetch });
    const result = fn("/abs/UNKNOWN.scrml::#program", "Driver", "tierN3");
    expect(result).toBe(null);
    expect(fetchCalls).toBe(0);
  });

  test("known epId but unknown role → returns null", () => {
    const manifest = {
      "/abs/app.scrml::#program": {
        Driver: { tierN3: "/dispatch/Driver.tierN3.cafebabe.js" },
      },
    };
    const fn = buildFetchChunkSandbox({
      manifest,
      fetchImpl: () => { throw new Error("should not be called"); },
    });
    expect(fn("/abs/app.scrml::#program", "Admin", "tierN3")).toBe(null);
  });

  test("known epId and role but unknown tier → returns null", () => {
    const manifest = {
      "/abs/app.scrml::#program": {
        Driver: { tierN3: "/dispatch/Driver.tierN3.cafebabe.js" },
      },
    };
    const fn = buildFetchChunkSandbox({
      manifest,
      fetchImpl: () => { throw new Error("should not be called"); },
    });
    expect(fn("/abs/app.scrml::#program", "Driver", "tierN4")).toBe(null);
  });

  test("no _SCRML_CHUNKS at all (typeof undefined branch) → returns null", () => {
    // The runtime function guards `typeof _SCRML_CHUNKS !== "undefined"`.
    // Build the function in a sandbox where _SCRML_CHUNKS literally does
    // not exist as a binding by passing `undefined` to the factory.
    const fn = buildFetchChunkSandbox({
      manifest: undefined,
      fetchImpl: () => { throw new Error("should not be called"); },
    });
    expect(fn("/abs/app.scrml::#program", "Driver", "tierN3")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// §3 — tree-shake LIVE: empty tier-1 + empty tier-N → prefetch chunk omitted
// ---------------------------------------------------------------------------

describe("§3 tree-shake LIVE — empty tier-1 + empty tier-N → prefetch chunk omitted", () => {
  function makeRecord({ tier1NonEmpty = false, tierNNonEmpty = false } = {}) {
    const empty = () => ({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    });
    const nonEmpty = () => ({
      componentNodeIds: new Set([42]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    });
    const tier1 = tier1NonEmpty ? nonEmpty() : empty();
    const tierN = tierNNonEmpty ? [nonEmpty()] : [];
    return {
      closures: new Map([
        [
          "/abs/app.scrml::#program",
          {
            byRole: new Map([
              [
                ANONYMOUS_ROLE,
                {
                  initialChunk: empty(),
                  prefetchTier1: tier1,
                  prefetchTier2: empty(),
                  prefetchTierN: tierN,
                },
              ],
            ]),
          },
        ],
      ]),
      diagnostics: [],
    };
  }

  test("v0.3 default — both tiers empty → prefetch chunk NOT in usedRuntimeChunks", () => {
    const ctx = makeCompileContext({
      fileAST: { filePath: "/abs/app.scrml", ast: { nodes: [] } },
      filePath: "/abs/app.scrml",
      reachabilityRecord: makeRecord({ tier1NonEmpty: false, tierNNonEmpty: false }),
    });
    // generateClientJs invokes detectRuntimeChunks; we drive the same code path
    // by calling generateClientJs and inspecting the assembled runtime indirectly.
    // For an isolated check, the simpler path is to assemble what detectRuntimeChunks
    // populates after invocation. detectRuntimeChunks is not exported, so we drive it
    // via generateClientJs (which is the public entry).
    const { generateClientJs } = require("../../src/codegen/emit-client.ts");
    generateClientJs(ctx);
    expect(ctx.usedRuntimeChunks.has("prefetch")).toBe(false);
    // Assembled runtime omits both functions.
    const runtime = assembleRuntime(ctx.usedRuntimeChunks);
    expect(runtime).not.toContain("_scrml_prefetch_tier1");
    expect(runtime).not.toContain("_scrml_fetch_chunk");
  });
});

// ---------------------------------------------------------------------------
// §4 — tree-shake DEAD (forward-compat): non-empty tier-N → prefetch chunk live
// ---------------------------------------------------------------------------

describe("§4 forward-compat — non-empty tier-N admission lights up prefetch chunk", () => {
  function makeRecord({ tier1NonEmpty = false, tierNNonEmpty = false } = {}) {
    const empty = () => ({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    });
    const nonEmpty = () => ({
      componentNodeIds: new Set([42]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    });
    const tier1 = tier1NonEmpty ? nonEmpty() : empty();
    const tierN = tierNNonEmpty ? [nonEmpty()] : [];
    return {
      closures: new Map([
        [
          "/abs/app.scrml::#program",
          {
            byRole: new Map([
              [
                ANONYMOUS_ROLE,
                {
                  initialChunk: empty(),
                  prefetchTier1: tier1,
                  prefetchTier2: empty(),
                  prefetchTierN: tierN,
                },
              ],
            ]),
          },
        ],
      ]),
      diagnostics: [],
    };
  }

  test("non-empty tier-N (tier-1 still empty) → prefetch chunk admitted; _scrml_fetch_chunk in runtime", () => {
    const ctx = makeCompileContext({
      fileAST: { filePath: "/abs/app.scrml", ast: { nodes: [] } },
      filePath: "/abs/app.scrml",
      reachabilityRecord: makeRecord({ tier1NonEmpty: false, tierNNonEmpty: true }),
      // S461 — the splitter (the only caller of the prefetch helpers) runs only under
      // emitPerRoute, and the chunk is admitted only then.
      emitPerRoute: true,
    });
    const { generateClientJs } = require("../../src/codegen/emit-client.ts");
    generateClientJs(ctx);
    expect(ctx.usedRuntimeChunks.has("prefetch")).toBe(true);
    const runtime = assembleRuntime(ctx.usedRuntimeChunks);
    // Both runtime functions land — the prefetch chunk is one slice and
    // tree-shake operates at chunk granularity.
    expect(runtime).toContain("function _scrml_prefetch_tier1(");
    expect(runtime).toContain("function _scrml_fetch_chunk(");
  });

  test("non-empty tier-1 (tier-N still empty) → prefetch chunk admitted; _scrml_fetch_chunk in runtime", () => {
    // A-4.3 path — tier-1 non-empty admits the prefetch chunk; _scrml_fetch_chunk
    // rides along because both functions live in the same chunk slice.
    const ctx = makeCompileContext({
      fileAST: { filePath: "/abs/app.scrml", ast: { nodes: [] } },
      filePath: "/abs/app.scrml",
      reachabilityRecord: makeRecord({ tier1NonEmpty: true, tierNNonEmpty: false }),
      // S461 — the splitter (the only caller of the prefetch helpers) runs only under
      // emitPerRoute, and the chunk is admitted only then.
      emitPerRoute: true,
    });
    const { generateClientJs } = require("../../src/codegen/emit-client.ts");
    generateClientJs(ctx);
    expect(ctx.usedRuntimeChunks.has("prefetch")).toBe(true);
    const runtime = assembleRuntime(ctx.usedRuntimeChunks);
    expect(runtime).toContain("function _scrml_fetch_chunk(");
  });

  test("S461: the same non-empty admission WITHOUT emitPerRoute does not admit the chunk (no splitter, no caller)", () => {
    const ctx = makeCompileContext({
      fileAST: { filePath: "/abs/app.scrml", ast: { nodes: [] } },
      filePath: "/abs/app.scrml",
      reachabilityRecord: makeRecord({ tier1NonEmpty: true, tierNNonEmpty: true }),
    });
    const { generateClientJs } = require("../../src/codegen/emit-client.ts");
    generateClientJs(ctx);
    expect(ctx.usedRuntimeChunks.has("prefetch")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — splitter emits tier-N chunk key when prefetchTierN populated
// ---------------------------------------------------------------------------

describe("§5 splitter emits tier-N chunk key (A-4.1 structural slot stays green under A-4.5)", () => {
  test("synthetic record with non-empty prefetchTierN → chunks Map has the tierN3 key", () => {
    const empty = () => ({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    });
    const tierNContents = {
      componentNodeIds: new Set([7]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const record = {
      closures: new Map([
        [
          "/abs/app.scrml::#program",
          {
            byRole: new Map([
              [
                "Driver",
                {
                  initialChunk: empty(),
                  prefetchTier1: empty(),
                  prefetchTier2: empty(),
                  prefetchTierN: [tierNContents],
                },
              ],
            ]),
          },
        ],
      ]),
      diagnostics: [],
    };
    const { chunks } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(chunks.has(`/abs/app.scrml::#program::Driver::tierN3`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — determinism — two assemblies on identical chunk-set inputs match byte-for-byte
// ---------------------------------------------------------------------------

describe("§6 determinism — runtime assembly byte-identical for identical chunk set", () => {
  test("two assembleRuntime calls with same chunk set → identical bytes", () => {
    const set = new Set(["core", "scope", "errors", "transitions", "prefetch"]);
    const a = assembleRuntime(set);
    const b = assembleRuntime(set);
    expect(a).toBe(b);
    expect(a).toContain("_scrml_fetch_chunk");
  });
});

// ---------------------------------------------------------------------------
// §7 — chunk-position invariant: _scrml_fetch_chunk lives inside the prefetch slice
// ---------------------------------------------------------------------------

describe("§7 chunk-position invariant — _scrml_fetch_chunk inside the prefetch slice", () => {
  test("_scrml_fetch_chunk appears AFTER _scrml_prefetch_tier1 in SCRML_RUNTIME", () => {
    const tier1Idx = SCRML_RUNTIME.indexOf("function _scrml_prefetch_tier1(");
    const fetchIdx = SCRML_RUNTIME.indexOf("function _scrml_fetch_chunk(");
    expect(tier1Idx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(tier1Idx);
  });

  test("_scrml_fetch_chunk appears BEFORE the §22.5 meta.emit() chunk boundary marker", () => {
    const fetchIdx = SCRML_RUNTIME.indexOf("function _scrml_fetch_chunk(");
    const metaMarkerIdx = SCRML_RUNTIME.indexOf("§22.5 meta.emit()");
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(metaMarkerIdx).toBeGreaterThan(fetchIdx);
  });

  test("RUNTIME_CHUNKS.prefetch slice contains both _scrml_prefetch_tier1 AND _scrml_fetch_chunk", () => {
    const slice = RUNTIME_CHUNKS.prefetch;
    expect(slice).toContain("function _scrml_prefetch_tier1(");
    expect(slice).toContain("function _scrml_fetch_chunk(");
    // Sanity: slice does NOT bleed into the meta chunk (no §22.5 marker).
    expect(slice).not.toContain("§22.5 meta.emit()");
  });
});
