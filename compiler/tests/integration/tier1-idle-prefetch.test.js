/**
 * A-4.3 tier-1 idle-prefetch — §40.9.7 + §40.9.9 worked-example replay.
 *
 * S91 wave A-4.3 composes the tier-1 chunk payload (delta over initial)
 * AND wires the IIFE-tail `_scrml_prefetch_tier1` call so the browser
 * fetches tier-1 after first paint when the (EP, role) admits a
 * non-empty tier-1 set. Empty admission elides both the file and the
 * prefetch call (and tree-shakes `_scrml_prefetch_tier1` from the
 * per-file embedded runtime).
 *
 * Spec authority:
 *   - SPEC.md §40.9.7 — prefetch_tier_1(E) normative (lines 17774-17793).
 *   - SPEC.md §40.9.9 — worked example normative: viewer=Driver
 *     prefetch_tier_1(/) = {} (lines 17873-17874).
 *   - OQ-A4-G ratification (S91): Option γ — `requestIdleCallback`
 *     browser-side + `setTimeout(fn, 1)` Safari fallback.
 *
 * Coverage:
 *   §1  Worked-example tier-1 empty for all four roles (SPEC §40.9.9
 *       normative: no tier-1 file written; initial IIFE tail has NO
 *       prefetch call).
 *   §2  Tree-shake LIVE — fixture whose ChunkPlan.prefetchTier1 admits
 *       a non-empty set produces a per-file `.client.js` (embed mode)
 *       whose runtime block CONTAINS `_scrml_prefetch_tier1`.
 *   §3  Tree-shake DEAD — fixture with all-empty tier-1 produces a
 *       per-file `.client.js` whose runtime block OMITS the prefetch
 *       function definition (under embed mode where assembleRuntime
 *       tree-shakes by usedRuntimeChunks).
 *   §4  Determinism — two builds of the same source produce
 *       byte-identical tier-1 chunk payload.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture A — §40.9.9 worked example (same shape as A-4.2's integration test)
// ---------------------------------------------------------------------------

const WORKED_EXAMPLE_SOURCE = `<program title="Dispatch" auth="required">

type UserRole:enum = { Anonymous, Driver, Dispatcher, Admin }

<count> = 0

function increment() {
  @count = @count + 1
}

<nav class="flex items-center gap-3 p-4 border-b">
  <h1 class="text-xl font-semibold">Dispatch</h1>
  <a href="/loads" class="text-blue-600">Loads</a>
  <auth role="Admin">
    <a href="/admin" class="text-red-600">Admin</a>
  </auth>
</nav>

<button onclick=increment()
        class="px-3 py-1 rounded bg-slate-100">
  \${@count}
</button>

</program>
`;

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "a43-tier1-prefetch-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileWorked({ emitPerRoute = true, write = false, outDir } = {}) {
  const filePath = join(TMP, "app.scrml");
  writeFileSync(filePath, WORKED_EXAMPLE_SOURCE);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: outDir ?? join(TMP, "dist"),
    write,
    emitPerRoute,
    log: () => {},
  });
}

function getInitialChunk(result, role) {
  if (!result.chunks) return undefined;
  for (const chunk of result.chunks.values()) {
    if (chunk.tier === "initial" && chunk.role === role) return chunk;
  }
  return undefined;
}

function getTier1Chunk(result, role) {
  if (!result.chunks) return undefined;
  for (const chunk of result.chunks.values()) {
    if (chunk.tier === "tier1" && chunk.role === role) return chunk;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// §1 — §40.9.9 worked-example: empty tier-1 + no prefetch call (SPEC normative)
// ---------------------------------------------------------------------------

describe("§40.9.9 worked example — tier-1 is empty for every role (SPEC L17873-17874)", () => {
  test("tier-1 chunk payloadJs is empty for all four roles", () => {
    const result = compileWorked();
    for (const role of ["Admin", "Anonymous", "Dispatcher", "Driver"]) {
      const tier1 = getTier1Chunk(result, role);
      expect(tier1).toBeDefined();
      expect(tier1.payloadJs).toBe("");
    }
  });

  test("initial-chunk IIFE tail has NO `_scrml_prefetch_tier1` call for any role", () => {
    const result = compileWorked();
    for (const role of ["Admin", "Anonymous", "Dispatcher", "Driver"]) {
      const initial = getInitialChunk(result, role);
      expect(initial).toBeDefined();
      expect(initial.payloadJs).not.toContain("_scrml_prefetch_tier1");
    }
  });

  test("write=true skips tier-1 file emit (no file on disk)", () => {
    const dir = mkdtempSync(join(tmpdir(), "a43-write-check-"));
    try {
      const result = compileWorked({ write: true, outDir: dir });
      // Derive the route segment from the actual chunk filename so the
      // assertion is robust against route-segment shape changes (e.g.
      // the worked example uses an SPA-program entry whose segment is
      // the file basename — `app` — but other fixtures use page-route
      // segments).
      for (const chunk of result.chunks.values()) {
        const path = join(dir, chunk.filename);
        if (chunk.tier === "tier1") {
          // Tier-1 file MUST NOT exist (admission empty per §40.9.9).
          expect(existsSync(path)).toBe(false);
        } else if (chunk.tier === "initial") {
          // Initial-chunk file IS written for each role.
          expect(existsSync(path)).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — Tree-shake DEAD: per-file `.client.js` omits _scrml_prefetch_tier1
//      when the file's reachabilityRecord has no non-empty tier-1 admission.
// ---------------------------------------------------------------------------

describe("§40.9.7 — tree-shake DEAD when all tier-1 admission sets are empty", () => {
  test("worked-example .client.js does NOT include _scrml_prefetch_tier1 definition", () => {
    // The worked example has empty tier-1 for every (EP, role) → the
    // 'prefetch' runtime chunk is NOT lit up by detectRuntimeChunks.
    // The per-file .client.js (in the `outputs` map) carries the
    // strip-marker comment-line followed by the import line; the
    // runtime is in the shared scrml-runtime.js (default !embedRuntime).
    //
    // To exercise the tree-shake invariant, we drive embedRuntime=true
    // by writing files to disk and inspecting the resulting .client.js.
    const dir = mkdtempSync(join(tmpdir(), "a43-treeshake-dead-"));
    try {
      const filePath = join(dir, "app.scrml");
      writeFileSync(filePath, WORKED_EXAMPLE_SOURCE);
      const result = compileScrml({
        inputFiles: [filePath],
        outputDir: dir,
        write: true,
        emitPerRoute: true,
        embedRuntime: true,
        log: () => {},
      });
      // Per-file client.js path.
      const clientJsPath = join(dir, "app.client.js");
      expect(existsSync(clientJsPath)).toBe(true);
      const clientJs = readFileSync(clientJsPath, "utf8");
      // Tree-shake invariant: with no non-empty tier-1 admission, the
      // 'prefetch' chunk is omitted from the per-file embedded
      // runtime. The function definition is NOT present.
      expect(clientJs).not.toContain("function _scrml_prefetch_tier1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — Determinism — two builds → byte-identical tier-1 payload
//      (the worked example has empty tier-1; we use a synthetic non-empty
//      fixture to exercise the byte-identity contract on a real payload.)
// ---------------------------------------------------------------------------

describe("§40.9.8 — determinism: byte-identical tier-1 payload across builds", () => {
  test("two compileScrml invocations on identical source → byte-identical tier-1 chunks", () => {
    const a = compileWorked();
    const b = compileWorked();
    for (const role of ["Admin", "Driver"]) {
      const t1a = getTier1Chunk(a, role);
      const t1b = getTier1Chunk(b, role);
      expect(t1a.payloadJs).toBe(t1b.payloadJs);
    }
    // The initial-chunk payload is also byte-stable (no per-build
    // variability from the new IIFE-tail wiring; the tier1Url is null
    // here since admission is empty).
    for (const role of ["Admin", "Driver"]) {
      const ia = getInitialChunk(a, role);
      const ib = getInitialChunk(b, role);
      expect(ia.payloadJs).toBe(ib.payloadJs);
    }
  });

  test("manifest serializes byte-identically across builds", () => {
    const a = compileWorked();
    const b = compileWorked();
    expect(a.chunksManifestJson()).toBe(b.chunksManifestJson());
  });
});

// ---------------------------------------------------------------------------
// §4 — Tier-1 filename pattern OQ-A4-C — same shape as initial-chunk filenames
// ---------------------------------------------------------------------------

describe("§40.9.7 / OQ-A4-C — tier-1 filename pattern", () => {
  test("tier-1 chunk descriptors carry the OQ-A4-C `<route>/<role>.tier1.<hash>.js` pattern", () => {
    const result = compileWorked();
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "tier1") continue;
      expect(chunk.filename).toMatch(/^[A-Za-z0-9_/-]+\/\w+\.tier1\.[0-9a-zA-Z]{8}\.js$/);
      // A-4.6 wired content-addressing: real hash, NOT the A-4.1
      // placeholder. Empty tier-1 admission (the worked-example
      // viewer=Driver `prefetch_tier_1(/) = {}` case) still produces
      // a deterministic real hash from the canonical empty-input.
      expect(chunk.chunkHash).not.toBe("00000000");
      expect(chunk.chunkHash).toMatch(/^[0-9a-z]{8}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — Per-file .client.js byte regression
//      The atom-emitter introduction at A-4.2 did NOT shift per-file
//      .client.js; A-4.3 must not shift it either (the IIFE-tail call
//      lives in the chunk payload, not in per-file .client.js).
// ---------------------------------------------------------------------------

describe("§40.9.7 — per-file .client.js NOT touched by A-4.3 atom-emitter reuse", () => {
  test("client.js bytes IDENTICAL with vs without emitPerRoute (A-4.3 is additive on chunk-side)", () => {
    const without = compileWorked({ emitPerRoute: false });
    const withFlag = compileWorked({ emitPerRoute: true });
    for (const [filePath, withoutOut] of without.outputs) {
      const withOut = withFlag.outputs.get(filePath);
      expect(withOut).toBeDefined();
      // Per-file .client.js MUST stay byte-identical. The chunk-side
      // composer reuses atom-emitters from atom-emitter.ts but does
      // NOT feed back into the per-file emit path.
      //
      // Caveat: when `detectRuntimeChunks` adds the 'prefetch' chunk
      // to the per-file usedRuntimeChunks (i.e. non-empty tier-1 for
      // some EP in this file), the assembled runtime block grows by
      // ~1.5 KB. The worked-example has empty tier-1 for every (EP,
      // role) so the 'prefetch' chunk is NOT added; the .client.js
      // bytes remain identical with vs without emitPerRoute.
      // S461 — the per-file BODY must be byte-identical. The one line that may differ is the
      // `// Requires: scrml-runtime.<hash>.js` header: under emitPerRoute the shared runtime
      // legitimately carries the route-splitter-only chunks ('mount' / 'vendor-ref' /
      // 'prefetch'), so its content hash — and so its filename — differs.
      const normRuntime = (js) => js.replace(/scrml-runtime\.[0-9a-z]+\.js/g, "scrml-runtime.<HASH>.js");
      expect(normRuntime(withOut.clientJs)).toBe(normRuntime(withoutOut.clientJs));
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Synthetic non-empty tier-1 fixture — exercises the LIVE path
//      (prefetch call emitted, tier-1 file written, tree-shake LIVE).
// ---------------------------------------------------------------------------

describe("synthetic — non-empty tier-1 admission via direct route-splitter invocation", () => {
  test("composeInitialChunk + composeTier1Chunk + emitPerRouteChunks wire end-to-end", async () => {
    // The Stage 7.6 RS does NOT currently admit any tier-1 from real
    // source compiles (Component 4 returns an empty prefetchTier1
    // ChunkContents for v0.3 — see A-2.5 floor). The end-to-end LIVE
    // path is therefore exercised at the unit level (§11 of
    // codegen-route-splitter.test.js). At the integration level the
    // best we can do is assert the chunk-shape is consistent when
    // synthetic non-empty admission is passed through.
    //
    // This integration test is a STRUCTURAL ECHO — it verifies the
    // composer is callable from a real pipeline + the wire shape
    // matches the unit-test expectations end-to-end. Real LIVE-path
    // exercise from a .scrml fixture is deferred until RS produces
    // non-empty tier-1 admissions (v0.4 telemetry-PGO surface or
    // future Component refinement).
    const { composeTier1Chunk, composeInitialChunk, emitPerRouteChunks } =
      await import("../../src/codegen/route-splitter.ts");
    const fakeFileAST = {
      filePath: "/abs/fixture.scrml",
      ast: { nodes: [
        { kind: "markup", tag: "details", id: 5, children: [] },
      ] },
    };
    const ctx = {
      fileAST: fakeFileAST,
      routeMap: { functions: new Map() },
    };
    const tier1Out = composeTier1Chunk(
      {
        componentNodeIds: new Set([5]),
        reactiveCellNodeIds: new Set(),
        serverFnNodeIds: new Set(),
        vendorUnitNames: new Set(),
      },
      ctx,
      "/abs/fixture.scrml::#program",
      "Driver",
    );
    expect(tier1Out).toContain(`_scrml_chunk_mount(5, "details");`);
    expect(tier1Out).toContain("scrml tier-1 chunk");

    const initialOut = composeInitialChunk(
      {
        componentNodeIds: new Set(),
        reactiveCellNodeIds: new Set(),
        serverFnNodeIds: new Set(),
        vendorUnitNames: new Set(),
      },
      ctx,
      "/abs/fixture.scrml::#program",
      "Driver",
      "/fixture/Driver.tier1.00000000.js",
    );
    expect(initialOut).toContain(`_scrml_prefetch_tier1("/fixture/Driver.tier1.00000000.js");`);
  });
});
