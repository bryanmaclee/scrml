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
  composeInitialChunk,
  composeTier1Chunk,
  isChunkContentsEmpty,
  CHUNK_HASH_PLACEHOLDER,
  ANONYMOUS_ROLE,
} from "../../src/codegen/route-splitter.ts";
import {
  emitReactiveCellAtom,
  emitServerFnStubAtom,
  emitVendorUnitRef,
  emitComponentAtom,
  canonicalNodeIdArray,
  canonicalVendorUnitArray,
  stratifiedNodeIdCompare,
} from "../../src/codegen/atom-emitter.ts";
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
    // A-4.7 — empty-admission entry-point fires W-CG-CHUNK-EMPTY (info-level
    // warning). Filter out the lint for this structural test; the
    // chunks/manifest shape is what we're verifying.
    const nonLintDiagnostics = diagnostics.filter(
      (d) => d.code !== "W-CG-CHUNK-EMPTY",
    );
    expect(nonLintDiagnostics).toEqual([]);
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
    // A-4.6: filename now carries the real FNV-1a base36 content hash.
    // The placeholder is the regression-guard sentinel: assert NOT it.
    expect(initial.chunkHash).not.toBe(CHUNK_HASH_PLACEHOLDER);
    // OQ-A4-C shape: <route>/<role>.<tier>.<8-char-base36>.js
    expect(initial.filename).toMatch(/^dispatch\/board\/Admin\.initial\.[0-9a-z]{8}\.js$/);
    // Per-chunk identity is reproducible across invocations on the
    // same source — re-emit and assert byte-identical filename + hash.
    const { chunks: chunks2 } = emitPerRouteChunks({ reachabilityRecord: record });
    const initial2 = chunks2.get(`/abs/foo.scrml::#page::/dispatch/board::Admin::initial`);
    expect(initial2.chunkHash).toBe(initial.chunkHash);
    expect(initial2.filename).toBe(initial.filename);
    // payloadJs falls back to "" when no CompileContext is provided
    // (synthetic-test direct invocation); the canonical empty-input
    // hash is still deterministic and distinct from "00000000".
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
    // A-4.6: real hash; placeholder is the negative-assertion sentinel.
    expect(initial.chunkHash).not.toBe(CHUNK_HASH_PLACEHOLDER);
    expect(initial.filename).toMatch(/^app\/_anonymous\.initial\.[0-9a-z]{8}\.js$/);
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

// ---------------------------------------------------------------------------
// §9 — A-4.2: atom-emitter idempotency + canonical iteration
// ---------------------------------------------------------------------------

describe("§9 A-4.2 atom-emitter idempotency", () => {
  test("emitReactiveCellAtom — same node → same output (no side effects)", () => {
    const node = {
      kind: "state-decl",
      name: "count",
      initExpr: { kind: "lit", value: 0 },
      id: 5,
    };
    const fakeCtx = /** @type {any} */ ({});
    const a = emitReactiveCellAtom(node, fakeCtx);
    const b = emitReactiveCellAtom(node, fakeCtx);
    expect(a).toBe(b);
    expect(a).toBe(`_scrml_reactive_set("count", 0);\n`);
  });

  test("emitReactiveCellAtom — non-literal init lowers to `null` (no `undefined` per §42.5/§42.8)", () => {
    const node = {
      kind: "state-decl",
      name: "user",
      initExpr: { kind: "call", callee: { kind: "ident", name: "fetchUser" } },
      id: 9,
    };
    const fakeCtx = /** @type {any} */ ({});
    expect(emitReactiveCellAtom(node, fakeCtx)).toBe(`_scrml_reactive_set("user", null);\n`);
  });

  test("emitReactiveCellAtom — string + boolean literals are JSON-encoded", () => {
    const stringNode = {
      kind: "state-decl",
      name: "label",
      initExpr: { kind: "lit", value: "hello" },
    };
    const boolNode = {
      kind: "state-decl",
      name: "active",
      initExpr: { kind: "lit", value: true },
    };
    const ctx = /** @type {any} */ ({});
    expect(emitReactiveCellAtom(stringNode, ctx)).toBe(`_scrml_reactive_set("label", "hello");\n`);
    expect(emitReactiveCellAtom(boolNode, ctx)).toBe(`_scrml_reactive_set("active", true);\n`);
  });

  test("emitReactiveCellAtom — defensive: unrelated node kinds return empty string", () => {
    expect(emitReactiveCellAtom({ kind: "markup", tag: "div" }, /** @type {any} */ ({}))).toBe("");
    expect(emitReactiveCellAtom({}, /** @type {any} */ ({}))).toBe("");
    expect(emitReactiveCellAtom(null, /** @type {any} */ ({}))).toBe("");
  });

  test("emitServerFnStubAtom — idempotent for same fn + route", () => {
    const fnNode = {
      kind: "function-decl",
      name: "fetchUser",
      params: ["id:number"],
    };
    const route = { path: "/_scrml/fetchUser", method: "POST" };
    const a = emitServerFnStubAtom(fnNode, route, /** @type {any} */ ({}));
    const b = emitServerFnStubAtom(fnNode, route, /** @type {any} */ ({}));
    expect(a).toBe(b);
    expect(a).toContain("async function _scrml_fetch_fetchUser(id)");
    expect(a).toContain(`await _scrml_g.fetch("/_scrml/fetchUser"`);
    expect(a).toContain(`_scrml_wire_decode`);
  });

  test("emitServerFnStubAtom — GET method skips body construction", () => {
    const fnNode = {
      kind: "function-decl",
      name: "ping",
      params: [],
    };
    const route = { path: "/_scrml/ping", method: "GET" };
    const out = emitServerFnStubAtom(fnNode, route, /** @type {any} */ ({}));
    expect(out).toContain(`await _scrml_g.fetch("/_scrml/ping", { method: "GET" })`);
    expect(out).not.toContain("Content-Type");
    expect(out).not.toContain("_scrml_body");
  });

  test("emitVendorUnitRef — idempotent + sanitizes binding name", () => {
    const a = emitVendorUnitRef("lodash-es");
    const b = emitVendorUnitRef("lodash-es");
    expect(a).toBe(b);
    expect(a).toBe(`import * as _scrml_vendor_lodash_es from "vendor:lodash-es";\n`);
  });

  test("emitVendorUnitRef — empty / non-string → empty output", () => {
    expect(emitVendorUnitRef("")).toBe("");
    expect(emitVendorUnitRef(/** @type {any} */ (null))).toBe("");
  });

  test("emitComponentAtom — idempotent + records id + tag", () => {
    const fakeFileAST = {
      ast: { nodes: [
        { kind: "markup", tag: "div", id: 42, children: [] },
      ] },
    };
    const ctx = /** @type {any} */ ({ fileAST: fakeFileAST });
    const a = emitComponentAtom(42, ctx);
    const b = emitComponentAtom(42, ctx);
    expect(a).toBe(b);
    expect(a).toBe(`_scrml_chunk_mount(42, "div");\n`);
  });

  test("emitComponentAtom — unknown id → empty string (defensive)", () => {
    const fakeFileAST = { ast: { nodes: [] } };
    const ctx = /** @type {any} */ ({ fileAST: fakeFileAST });
    expect(emitComponentAtom(999, ctx)).toBe("");
  });
});

describe("§9 A-4.2 canonical iteration ordering (stratified comparator)", () => {
  test("stratifiedNodeIdCompare — numbers sort before strings", () => {
    const ids = ["zebra", 1, "apple", 2, "fn-x"];
    const sorted = [...ids].sort(stratifiedNodeIdCompare);
    expect(sorted).toEqual([1, 2, "apple", "fn-x", "zebra"]);
  });

  test("stratifiedNodeIdCompare — within-stratum codepoint compare", () => {
    expect(stratifiedNodeIdCompare("ab", "ac")).toBeLessThan(0);
    expect(stratifiedNodeIdCompare("ac", "ab")).toBeGreaterThan(0);
    expect(stratifiedNodeIdCompare("ab", "ab")).toBe(0);
    expect(stratifiedNodeIdCompare(5, 10)).toBeLessThan(0);
    expect(stratifiedNodeIdCompare(10, 5)).toBeGreaterThan(0);
  });

  test("canonicalNodeIdArray — orders insertion-randomized Set deterministically", () => {
    const s = new Set([5, "z", 2, "a", 100]);
    expect(canonicalNodeIdArray(s)).toEqual([2, 5, 100, "a", "z"]);
  });

  test("canonicalVendorUnitArray — codepoint sort of vendor-unit names", () => {
    const s = new Set(["zebra", "apple", "Beta", "alpha"]);
    expect(canonicalVendorUnitArray(s)).toEqual(["Beta", "alpha", "apple", "zebra"]);
  });
});

// ---------------------------------------------------------------------------
// §10 — composeInitialChunk shape + content admission filter
// ---------------------------------------------------------------------------

describe("§10 composeInitialChunk — chunk shape + admission filter", () => {
  // A minimal fake CompileContext suitable for composer testing.
  function makeFakeCtx({ stateDecls = [], fnDecls = [], markupNodes = [], routeMap = null } = {}) {
    const nodes = [...stateDecls, ...fnDecls, ...markupNodes];
    const fileAST = {
      filePath: "/abs/app.scrml",
      ast: { nodes },
    };
    const functions = new Map();
    if (routeMap) {
      for (const [id, entry] of Object.entries(routeMap)) {
        functions.set(id, entry);
      }
    }
    return { fileAST, routeMap: { functions } };
  }

  test("empty admission set → IIFE shell only (no atoms)", () => {
    const ctx = makeFakeCtx();
    const out = composeInitialChunk(emptyContents(), /** @type {any} */ (ctx), "/abs/app.scrml::#program", ANONYMOUS_ROLE);
    expect(out).toContain("scrml initial chunk");
    expect(out).toContain('(function ()');
    expect(out).toContain("})();");
    // No atom section headers when admission set is empty.
    expect(out).not.toContain("// --- reactive cells");
    expect(out).not.toContain("// --- server-fn fetch stubs");
    expect(out).not.toContain("// --- admitted components");
    expect(out).not.toContain("// --- vendor units");
  });

  test("reactive-cell admission → registration line present", () => {
    const countDecl = {
      kind: "state-decl",
      name: "count",
      initExpr: { kind: "lit", value: 0 },
      id: 7,
    };
    const ctx = makeFakeCtx({ stateDecls: [countDecl] });
    const contents = {
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set([7]),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const out = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    expect(out).toContain("// --- reactive cells");
    expect(out).toContain(`_scrml_reactive_set("count", 0);`);
  });

  test("component admission → mount markers emitted for admitted nodes only", () => {
    const navMarkup = { kind: "markup", tag: "nav", id: 11, children: [] };
    const linkAdmin = { kind: "markup", tag: "a", id: 22, children: [] };
    const ctx = makeFakeCtx({ markupNodes: [navMarkup, linkAdmin] });

    // Driver: only nav admitted, link omitted.
    const driverContents = {
      componentNodeIds: new Set([11]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const driverOut = composeInitialChunk(driverContents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    expect(driverOut).toContain(`_scrml_chunk_mount(11, "nav");`);
    expect(driverOut).not.toContain(`_scrml_chunk_mount(22`);

    // Admin: both admitted.
    const adminContents = {
      componentNodeIds: new Set([11, 22]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const adminOut = composeInitialChunk(adminContents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Admin");
    expect(adminOut).toContain(`_scrml_chunk_mount(11, "nav");`);
    expect(adminOut).toContain(`_scrml_chunk_mount(22, "a");`);
  });

  test("canonical iteration order — component ids emit in stratified order regardless of Set insertion order", () => {
    const a = { kind: "markup", tag: "div", id: 100, children: [] };
    const b = { kind: "markup", tag: "span", id: 5, children: [] };
    const c = { kind: "markup", tag: "p", id: 50, children: [] };
    const ctx = makeFakeCtx({ markupNodes: [a, b, c] });

    // Insertion order: 100 → 5 → 50
    const contents = {
      componentNodeIds: new Set([100, 5, 50]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const out = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", ANONYMOUS_ROLE);
    // Expected canonical order: 5, 50, 100.
    const idx5 = out.indexOf(`_scrml_chunk_mount(5,`);
    const idx50 = out.indexOf(`_scrml_chunk_mount(50,`);
    const idx100 = out.indexOf(`_scrml_chunk_mount(100,`);
    expect(idx5).toBeGreaterThan(-1);
    expect(idx50).toBeGreaterThan(idx5);
    expect(idx100).toBeGreaterThan(idx50);
  });

  test("vendor-unit admission → _scrml_vendor_require call emitted (alpha order)", () => {
    const ctx = makeFakeCtx();
    const contents = {
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(["zebra", "alpha"]),
    };
    const out = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", ANONYMOUS_ROLE);
    expect(out).toContain("// --- vendor units");
    expect(out).toContain(`_scrml_vendor_require("vendor:alpha");`);
    expect(out).toContain(`_scrml_vendor_require("vendor:zebra");`);
    // Alpha order: alpha before zebra.
    const idxAlpha = out.indexOf("vendor:alpha");
    const idxZebra = out.indexOf("vendor:zebra");
    expect(idxAlpha).toBeLessThan(idxZebra);
  });

  test("determinism — two composeInitialChunk calls on identical input → byte-identical output", () => {
    const ctx = makeFakeCtx({
      stateDecls: [{ kind: "state-decl", name: "count", initExpr: { kind: "lit", value: 0 } }],
      markupNodes: [{ kind: "markup", tag: "button", id: 3, children: [] }],
    });
    const contents = {
      componentNodeIds: new Set([3]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const a = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    const b = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    expect(a).toBe(b);
  });

  test("role surfaces in chunk header — Driver vs Admin chunk headers differ", () => {
    const ctx = makeFakeCtx();
    const contents = emptyContents();
    const driver = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    const admin = composeInitialChunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Admin");
    expect(driver).toContain("role=Driver");
    expect(admin).toContain("role=Admin");
  });
});

// ---------------------------------------------------------------------------
// §11 — A-4.3: composeTier1Chunk + isChunkContentsEmpty + IIFE-tail wiring
// ---------------------------------------------------------------------------

describe("§11 A-4.3 composeTier1Chunk — chunk shape + admission filter", () => {
  function makeFakeCtx({ stateDecls = [], fnDecls = [], markupNodes = [], routeMap = null } = {}) {
    const nodes = [...stateDecls, ...fnDecls, ...markupNodes];
    const fileAST = {
      filePath: "/abs/app.scrml",
      ast: { nodes },
    };
    const functions = new Map();
    if (routeMap) {
      for (const [id, entry] of Object.entries(routeMap)) {
        functions.set(id, entry);
      }
    }
    return { fileAST, routeMap: { functions } };
  }

  test("tier-1 chunk header carries §40.9.7 prefetch_tier_1 reference + tier label", () => {
    const ctx = makeFakeCtx({
      markupNodes: [{ kind: "markup", tag: "details", id: 3, children: [] }],
    });
    const contents = {
      componentNodeIds: new Set([3]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const out = composeTier1Chunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    expect(out).toContain("scrml tier-1 chunk");
    expect(out).toContain("§40.9.7 prefetch_tier_1");
    expect(out).toContain("role=Driver");
    expect(out).toContain("(function ()");
    expect(out).toContain("})();");
  });

  test("tier-1 chunk emits the delta atoms — reactive cells + components + server fns + vendor units", () => {
    const stateDecl = {
      kind: "state-decl",
      name: "expanded",
      initExpr: { kind: "lit", value: false },
      id: 12,
    };
    const markupA = { kind: "markup", tag: "section", id: 30, children: [] };
    const ctx = makeFakeCtx({
      stateDecls: [stateDecl],
      markupNodes: [markupA],
    });
    const contents = {
      componentNodeIds: new Set([30]),
      reactiveCellNodeIds: new Set([12]),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(["chartjs"]),
    };
    const out = composeTier1Chunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    expect(out).toContain(`_scrml_reactive_set("expanded", false);`);
    expect(out).toContain(`_scrml_chunk_mount(30, "section");`);
    expect(out).toContain(`_scrml_vendor_require("vendor:chartjs");`);
  });

  test("tier-1 determinism — byte-identical output for byte-identical input", () => {
    const ctx = makeFakeCtx({
      stateDecls: [{ kind: "state-decl", name: "count", initExpr: { kind: "lit", value: 0 } }],
      markupNodes: [{ kind: "markup", tag: "button", id: 3, children: [] }],
    });
    const contents = {
      componentNodeIds: new Set([3]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const a = composeTier1Chunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    const b = composeTier1Chunk(contents, /** @type {any} */ (ctx), "/abs/app.scrml::#program", "Driver");
    expect(a).toBe(b);
  });
});

describe("§11 isChunkContentsEmpty — four-set admission emptiness", () => {
  test("all four sets empty → true", () => {
    expect(isChunkContentsEmpty({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    })).toBe(true);
  });

  test("any single non-empty set → false", () => {
    expect(isChunkContentsEmpty({
      componentNodeIds: new Set([1]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    })).toBe(false);
    expect(isChunkContentsEmpty({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set([5]),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    })).toBe(false);
    expect(isChunkContentsEmpty({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(["fn-a"]),
      vendorUnitNames: new Set(),
    })).toBe(false);
    expect(isChunkContentsEmpty({
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(["lodash"]),
    })).toBe(false);
  });
});

describe("§11 IIFE-tail _scrml_prefetch_tier1 call — composeInitialChunk hook", () => {
  function makeFakeCtx() {
    return {
      fileAST: { filePath: "/abs/app.scrml", ast: { nodes: [] } },
      routeMap: { functions: new Map() },
    };
  }

  test("composeInitialChunk WITHOUT tier1Url → no prefetch call in IIFE tail", () => {
    const out = composeInitialChunk(
      {
        componentNodeIds: new Set(),
        reactiveCellNodeIds: new Set(),
        serverFnNodeIds: new Set(),
        vendorUnitNames: new Set(),
      },
      /** @type {any} */ (makeFakeCtx()),
      "/abs/app.scrml::#program",
      "Driver",
      // tier1Url omitted → defaults to null
    );
    expect(out).not.toContain("_scrml_prefetch_tier1");
    expect(out).not.toContain("§40.9.7 tier-1 idle prefetch");
  });

  test("composeInitialChunk WITH tier1Url → prefetch call emitted at IIFE tail", () => {
    const out = composeInitialChunk(
      {
        componentNodeIds: new Set(),
        reactiveCellNodeIds: new Set(),
        serverFnNodeIds: new Set(),
        vendorUnitNames: new Set(),
      },
      /** @type {any} */ (makeFakeCtx()),
      "/abs/app.scrml::#page::/dashboard",
      "Admin",
      "/dashboard/Admin.tier1.00000000.js",
    );
    expect(out).toContain(`_scrml_prefetch_tier1("/dashboard/Admin.tier1.00000000.js");`);
    expect(out).toContain("§40.9.7 tier-1 idle prefetch");
    // Call is BEFORE the IIFE close brace.
    const callIdx = out.indexOf("_scrml_prefetch_tier1");
    const closeIdx = out.indexOf("})();");
    expect(callIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(callIdx);
  });

  test("emitPerRouteChunks wires tier1Url into initial chunk when tier-1 admission is non-empty", () => {
    // Use a synthetic CompileContext + reachabilityRecord with a
    // non-empty prefetchTier1 ChunkContents. The orchestrator should
    // compose a tier-1 payload AND append the IIFE-tail call to the
    // initial chunk.
    const fileAST = {
      filePath: "/abs/app.scrml",
      ast: { nodes: [{ kind: "markup", tag: "details", id: 7, children: [] }] },
    };
    const ctx = /** @type {any} */ ({ fileAST, routeMap: { functions: new Map() } });
    const ctxByFile = new Map([["/abs/app.scrml", ctx]]);
    const record = {
      closures: new Map([
        [
          "/abs/app.scrml::#program",
          {
            byRole: new Map([
              [
                "Driver",
                {
                  initialChunk: {
                    componentNodeIds: new Set(),
                    reactiveCellNodeIds: new Set(),
                    serverFnNodeIds: new Set(),
                    vendorUnitNames: new Set(),
                  },
                  prefetchTier1: {
                    componentNodeIds: new Set([7]),
                    reactiveCellNodeIds: new Set(),
                    serverFnNodeIds: new Set(),
                    vendorUnitNames: new Set(),
                  },
                  prefetchTier2: {
                    componentNodeIds: new Set(),
                    reactiveCellNodeIds: new Set(),
                    serverFnNodeIds: new Set(),
                    vendorUnitNames: new Set(),
                  },
                  prefetchTierN: [],
                },
              ],
            ]),
          },
        ],
      ]),
      diagnostics: [],
    };
    const { chunks } = emitPerRouteChunks({
      reachabilityRecord: record,
      cgContextByFile: ctxByFile,
    });
    const initial = chunks.get(`/abs/app.scrml::#program::Driver::initial`);
    const tier1 = chunks.get(`/abs/app.scrml::#program::Driver::tier1`);
    expect(initial).toBeDefined();
    expect(tier1).toBeDefined();
    // Initial chunk IIFE tail carries the prefetch call referencing the
    // tier-1 chunk's emitted filename (absolute URL).
    expect(initial.payloadJs).toContain(`_scrml_prefetch_tier1("/${tier1.filename}");`);
    // Tier-1 chunk has non-empty payload (admitted component mount marker).
    expect(tier1.payloadJs).toContain(`_scrml_chunk_mount(7, "details");`);
    expect(tier1.payloadJs.length).toBeGreaterThan(0);
  });

  test("emitPerRouteChunks does NOT wire tier1Url + leaves tier-1 payload empty when admission is empty", () => {
    const fileAST = {
      filePath: "/abs/app.scrml",
      ast: { nodes: [] },
    };
    const ctx = /** @type {any} */ ({ fileAST, routeMap: { functions: new Map() } });
    const ctxByFile = new Map([["/abs/app.scrml", ctx]]);
    const record = {
      closures: new Map([
        [
          "/abs/app.scrml::#program",
          {
            byRole: new Map([
              [
                "Driver",
                {
                  initialChunk: {
                    componentNodeIds: new Set(),
                    reactiveCellNodeIds: new Set(),
                    serverFnNodeIds: new Set(),
                    vendorUnitNames: new Set(),
                  },
                  prefetchTier1: {
                    componentNodeIds: new Set(),
                    reactiveCellNodeIds: new Set(),
                    serverFnNodeIds: new Set(),
                    vendorUnitNames: new Set(),
                  },
                  prefetchTier2: {
                    componentNodeIds: new Set(),
                    reactiveCellNodeIds: new Set(),
                    serverFnNodeIds: new Set(),
                    vendorUnitNames: new Set(),
                  },
                  prefetchTierN: [],
                },
              ],
            ]),
          },
        ],
      ]),
      diagnostics: [],
    };
    const { chunks } = emitPerRouteChunks({
      reachabilityRecord: record,
      cgContextByFile: ctxByFile,
    });
    const initial = chunks.get(`/abs/app.scrml::#program::Driver::initial`);
    const tier1 = chunks.get(`/abs/app.scrml::#program::Driver::tier1`);
    // Tier-1 admission empty → tier-1 payload empty (api.js write loop
    // skips the file write).
    expect(tier1.payloadJs).toBe("");
    // Initial chunk IIFE tail has NO prefetch call.
    expect(initial.payloadJs).not.toContain("_scrml_prefetch_tier1");
  });
});
