/**
 * Codegen Per-Route Artifact Splitter — A-4.1 Scaffold Tests
 *
 * S91 wave A-4.1 delivers the orchestrator slot + per-(EP, role, tier)
 * iteration scaffold + opt-in `--emit-per-route` CLI flag. Subsequent
 * waves (A-4.2 .. A-4.7) implement initial-chunk emission, tier-1/2
 * prefetch wiring, content-addressing, and HTML augmentation per
 * SPEC §40.9.7.
 *
 * Coverage at A-4.1 (8-12 tests, per dispatch brief):
 *   §1  Trivial 1-EP 1-role corpus — chunks Map has the expected keys.
 *   §2  Multi-role corpus — chunks Map has per-role keys.
 *   §3  Multi-tier admission — initial/tier1/tier2 keys present per
 *       (EP, role); tierN absent unless plan populated it.
 *   §4  Filename pattern conforms to OQ-A4-C
 *       `<route>/<RoleVariant>.<tier>.<8-char-hash>.js`.
 *   §5  chunks.json manifest shape — version=1, entryPoints map nested
 *       per role → tier → ChunkKey.
 *   §6  Opt-in default-off — without `emitPerRoute: true` the chunks
 *       map is absent on the public return.
 *   §7  Pass-through atom id sets — chunk descriptors carry fresh
 *       copies of the underlying ChunkContents id sets.
 *   §8  Deterministic across runs — identical source → identical
 *       ChunkKey ordering + manifest JSON.
 *
 * Cross-references:
 *   - SPEC.md §40.9.7 (L17774-17793) — per-tier output structure.
 *   - SPEC.md §40.9.8 — determinism.
 *   - docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md §3.1.
 */

import { describe, test, expect } from "bun:test";
import {
  emitPerRouteChunks,
  serializeChunksManifest,
  CHUNK_HASH_PLACEHOLDER,
  ANONYMOUS_ROLE,
} from "../../src/codegen/route-splitter.ts";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic ReachabilityRecord for direct splitter invocation.
 * Bypasses the full compile pipeline so tests can pin specific
 * (EP, role, tier) shapes without authoring full .scrml fixtures.
 */
function makeRecord(entries) {
  const closures = new Map();
  for (const { epId, byRole } of entries) {
    const roleMap = new Map();
    for (const [role, plan] of byRole) {
      roleMap.set(role, plan);
    }
    closures.set(epId, { byRole: roleMap });
  }
  return { closures, diagnostics: [] };
}

function emptyContents() {
  return {
    componentNodeIds: new Set(),
    reactiveCellNodeIds: new Set(),
    serverFnNodeIds: new Set(),
    vendorUnitNames: new Set(),
  };
}

function makePlan({ initial = emptyContents(), tier1 = emptyContents(), tier2 = emptyContents(), tierN = [] } = {}) {
  return {
    initialChunk: initial,
    prefetchTier1: tier1,
    prefetchTier2: tier2,
    prefetchTierN: tierN,
  };
}

// ---------------------------------------------------------------------------
// §1 — trivial 1-EP 1-role corpus
// ---------------------------------------------------------------------------

describe("§1 trivial 1-EP 1-role corpus — chunks Map carries the expected keys", () => {
  test("single EP + single role → three chunk descriptors (initial / tier1 / tier2)", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [[ANONYMOUS_ROLE, makePlan()]],
      },
    ]);
    const { chunks, manifest, diagnostics } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(diagnostics).toEqual([]);
    expect(chunks.size).toBe(3);
    expect(chunks.has(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::initial`)).toBe(true);
    expect(chunks.has(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::tier1`)).toBe(true);
    expect(chunks.has(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::tier2`)).toBe(true);
    expect(Object.keys(manifest.entryPoints)).toEqual(["/abs/app.scrml::#program"]);
  });

  test("empty ReachabilityRecord → empty chunks + manifest with no entry points + no diagnostics", () => {
    const record = makeRecord([]);
    const { chunks, manifest, diagnostics } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(chunks.size).toBe(0);
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.entryPoints)).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — multi-role corpus
// ---------------------------------------------------------------------------

describe("§2 multi-role corpus — chunks Map has per-role keys", () => {
  test("one EP, two roles → six chunk descriptors (3 tiers × 2 roles)", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#page::/dashboard",
        byRole: [
          ["Driver", makePlan()],
          ["Admin", makePlan()],
        ],
      },
    ]);
    const { chunks, manifest } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(chunks.size).toBe(6);
    for (const role of ["Driver", "Admin"]) {
      for (const tier of ["initial", "tier1", "tier2"]) {
        expect(chunks.has(`/abs/app.scrml::#page::/dashboard::${role}::${tier}`)).toBe(true);
      }
    }
    // Manifest groups by EP then role.
    const ep = manifest.entryPoints["/abs/app.scrml::#page::/dashboard"];
    expect(Object.keys(ep).sort()).toEqual(["Admin", "Driver"]);
    expect(ep.Driver.initial).toBe("/abs/app.scrml::#page::/dashboard::Driver::initial");
    expect(ep.Admin.tier2).toBe("/abs/app.scrml::#page::/dashboard::Admin::tier2");
  });
});

// ---------------------------------------------------------------------------
// §3 — multi-tier admission incl. tierN structural slot
// ---------------------------------------------------------------------------

describe("§3 multi-tier admission — initial/tier1/tier2 always; tierN structural", () => {
  test("plan with prefetchTierN populated → tierN3 chunk key emitted; manifest entry.tierN populated", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [
          [ANONYMOUS_ROLE, makePlan({ tierN: [emptyContents()] })],
        ],
      },
    ]);
    const { chunks, manifest } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(chunks.size).toBe(4);
    expect(chunks.has(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::tierN3`)).toBe(true);
    const entry = manifest.entryPoints["/abs/app.scrml::#program"][ANONYMOUS_ROLE];
    expect(entry.tierN).toEqual([`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::tierN3`]);
  });

  test("plan with empty prefetchTierN (v0.3 default) → no tierN keys; manifest entry.tierN absent", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [[ANONYMOUS_ROLE, makePlan({ tierN: [] })]],
      },
    ]);
    const { chunks, manifest } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(chunks.size).toBe(3);
    for (const k of chunks.keys()) {
      expect(k.endsWith("::tierN3")).toBe(false);
    }
    const entry = manifest.entryPoints["/abs/app.scrml::#program"][ANONYMOUS_ROLE];
    expect(entry.tierN).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §4 — filename pattern conforms to OQ-A4-C
// ---------------------------------------------------------------------------

describe("§4 OQ-A4-C filename pattern", () => {
  test("page entry → <route>/<RoleVariant>.<tier>.<8-char-hash>.js with the route segment + leading slash stripped", () => {
    const record = makeRecord([
      {
        epId: "/abs/foo.scrml::#page::/dispatch/board",
        byRole: [["Admin", makePlan()]],
      },
    ]);
    const { chunks } = emitPerRouteChunks({ reachabilityRecord: record });
    const initial = chunks.get(`/abs/foo.scrml::#page::/dispatch/board::Admin::initial`);
    expect(initial).toBeDefined();
    expect(initial.filename).toBe(`dispatch/board/Admin.initial.${CHUNK_HASH_PLACEHOLDER}.js`);
    expect(initial.chunkHash).toBe(CHUNK_HASH_PLACEHOLDER);
    // payloadJs is empty at A-4.1; A-4.2 populates initial-tier content.
    expect(initial.payloadJs).toBe("");
  });

  test("SPA-program entry → route segment derived from file basename (no .scrml suffix)", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [[ANONYMOUS_ROLE, makePlan()]],
      },
    ]);
    const { chunks } = emitPerRouteChunks({ reachabilityRecord: record });
    const initial = chunks.get(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::initial`);
    expect(initial.filename).toBe(`app/${ANONYMOUS_ROLE}.initial.${CHUNK_HASH_PLACEHOLDER}.js`);
  });
});

// ---------------------------------------------------------------------------
// §5 — chunks.json manifest shape + serialization
// ---------------------------------------------------------------------------

describe("§5 chunks.json manifest shape + serialization", () => {
  test("manifest carries version=1 + compiler identity + nested entryPoints map", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [[ANONYMOUS_ROLE, makePlan()]],
      },
    ]);
    const { manifest } = emitPerRouteChunks({ reachabilityRecord: record });
    expect(manifest.version).toBe(1);
    expect(typeof manifest.compiler).toBe("string");
    expect(manifest.compiler).toMatch(/^scrml-/);
    const entry = manifest.entryPoints["/abs/app.scrml::#program"][ANONYMOUS_ROLE];
    expect(entry.initial).toBe(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::initial`);
    expect(entry.tier1).toBe(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::tier1`);
    expect(entry.tier2).toBe(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::tier2`);
  });

  test("serializeChunksManifest produces stable, parseable JSON with a trailing newline", () => {
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [[ANONYMOUS_ROLE, makePlan()]],
      },
    ]);
    const { manifest } = emitPerRouteChunks({ reachabilityRecord: record });
    const json = serializeChunksManifest(manifest);
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.entryPoints["/abs/app.scrml::#program"][ANONYMOUS_ROLE].initial).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §6 — opt-in default-off behaviour through compileScrml
// ---------------------------------------------------------------------------

describe("§6 opt-in default-off — chunks absent without --emit-per-route", () => {
  test("compileScrml() WITHOUT emitPerRoute → result.chunks undefined; no chunk files written; no chunks.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-default-off-"));
    try {
      const src = join(dir, "app.scrml");
      writeFileSync(src, "<program>\n  <body>\n    hello\n  </body>\n</program>\n");
      const result = compileScrml({
        inputFiles: [src],
        outputDir: dir,
        write: true,
        log: () => {},
      });
      expect(result.chunks).toBeUndefined();
      expect(result.chunksManifest).toBeUndefined();
      expect(existsSync(join(dir, "chunks.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("compileScrml() WITH emitPerRoute → result.chunks populated; chunks.json written to outputDir", () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-default-on-"));
    try {
      const src = join(dir, "app.scrml");
      writeFileSync(src, "<program>\n  <body>\n    hello\n  </body>\n</program>\n");
      const result = compileScrml({
        inputFiles: [src],
        outputDir: dir,
        write: true,
        log: () => {},
        emitPerRoute: true,
      });
      expect(result.chunks).toBeDefined();
      expect(result.chunksManifest).toBeDefined();
      // With a single SPA-program entry + anonymous role, expect three chunk keys.
      expect(result.chunks.size).toBeGreaterThanOrEqual(3);
      // chunks.json is always emitted when the flag is set (OQ-A4-A).
      const manifestPath = join(dir, "chunks.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifestBytes = readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(manifestBytes);
      expect(parsed.version).toBe(1);
      expect(Object.keys(parsed.entryPoints).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — atom id pass-through
// ---------------------------------------------------------------------------

describe("§7 atom id sets pass through from ChunkContents — fresh copies", () => {
  test("ChunkOutput sets are fresh copies, not aliases of the input ChunkContents", () => {
    const sharedComponentIds = new Set([1, 2, 3]);
    const initial = {
      componentNodeIds: sharedComponentIds,
      reactiveCellNodeIds: new Set([10]),
      serverFnNodeIds: new Set(["fn-a"]),
      vendorUnitNames: new Set(["vendor:lodash"]),
    };
    const record = makeRecord([
      {
        epId: "/abs/app.scrml::#program",
        byRole: [[ANONYMOUS_ROLE, makePlan({ initial })]],
      },
    ]);
    const { chunks } = emitPerRouteChunks({ reachabilityRecord: record });
    const chunk = chunks.get(`/abs/app.scrml::#program::${ANONYMOUS_ROLE}::initial`);
    // Same contents, fresh Set instance.
    expect(chunk.componentNodeIds).not.toBe(sharedComponentIds);
    expect(Array.from(chunk.componentNodeIds).sort()).toEqual([1, 2, 3]);
    expect(Array.from(chunk.reactiveCellNodeIds)).toEqual([10]);
    expect(Array.from(chunk.serverFnNodeIds)).toEqual(["fn-a"]);
    expect(Array.from(chunk.vendorUnitNames)).toEqual(["vendor:lodash"]);
    // Mutating the chunk's set must not write back to the input record.
    chunk.componentNodeIds.add(99);
    expect(sharedComponentIds.has(99)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8 — determinism
// ---------------------------------------------------------------------------

describe("§8 deterministic across runs — same input → same manifest bytes", () => {
  test("two splitter invocations on identical input → byte-identical serialized manifests", () => {
    const buildInput = () =>
      makeRecord([
        {
          epId: "/abs/app.scrml::#page::/dashboard",
          byRole: [
            ["Admin", makePlan()],
            ["Driver", makePlan()],
          ],
        },
      ]);
    const a = serializeChunksManifest(emitPerRouteChunks({ reachabilityRecord: buildInput() }).manifest);
    const b = serializeChunksManifest(emitPerRouteChunks({ reachabilityRecord: buildInput() }).manifest);
    expect(a).toBe(b);
  });
});
