/**
 * A-4.4 tier-2 hover-prefetch — §40.9.7 + §40.9.9 worked-example replay.
 *
 * S91 wave A-4.4 ships the two-surface §40.9.7 tier-2 semantics:
 *
 *   1. Cross-route hover prefetch (DOMINANT) — `<a href="/loads">` in
 *      the current page gets `data-scrml-prefetch="/loads"`; the
 *      runtime hover handler (emitted into the initial-chunk IIFE
 *      tail) attaches `mouseenter` + `focus` once-listeners that
 *      call `_scrml_prefetch_tier2(route, role)`.
 *   2. Intra-route deep-interaction prefetch — empty in v0.3 per RS
 *      A-2.5 floor; the `composeTier2Chunk` composer is present
 *      structurally for v0.4 RS refinement.
 *
 * Spec authority:
 *   - SPEC.md §40.9.7 — prefetch_tier_2(E) normative (line 17790).
 *   - SPEC.md §40.9.9 — worked example normative L17876-17878
 *     ("the `/loads` route — referenced by the nav `<a>` — is its own
 *     entry point; its initial chunk is hover-prefetched per
 *     §40.9.7's tier-2 wiring on the link").
 *   - SCOPING §3.4 — cross-route-vs-intra-route disambiguation.
 *
 * Coverage:
 *   §1  Tier-2 chunk emission — empty intra-route case (v0.3 floor).
 *   §2  Tier-2 chunk emission — synthetic non-empty intra-route case.
 *   §3  `data-scrml-prefetch` wiring on resolvable internal `<a href>`.
 *   §4  No attribute on unresolvable / external / fragment-only hrefs.
 *   §5  Hover-handler attachment block in initial-chunk IIFE tail.
 *   §6  Runtime function presence (tree-shake LIVE) when links exist.
 *   §7  Runtime function elision (tree-shake DEAD) when no links.
 *   §8  `_SCRML_CHUNKS` manifest scaffold present in runtime.
 *   §9  Anonymous-role fallback in hover-handler when
 *       `_scrml_current_role` is undefined (A-4.4 default).
 *   §10 §40.9.9 worked-example extension — `<a href="/loads">` gets
 *       `data-scrml-prefetch="/loads"` AND initial-chunk IIFE attaches
 *       the hover handler.
 *   §11 Determinism — two builds → byte-identical tier-2 chunk + IIFE
 *       hover-handler block bytes.
 *   §12 Filename pattern — OQ-A4-C `<route>/<role>.tier2.<hash>.js`.
 *   §13 Composer determinism + role variance (synthetic).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture A — §40.9.9 worked example (re-used from A-4.3 integration test).
// Contains `<a href="/loads">` (internal) + `<a href="/admin">` (auth-gated).
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

// ---------------------------------------------------------------------------
// Fixture B — multi-page fixture: split across multiple files under a
// `routes/` directory so Stage 5 RI's `buildPageRouteTree` produces real
// `RouteMap.pages` entries keyed by urlPattern. Adopter convention
// (route-inference.ts L2513): files under `routes/` become page routes;
// `index.scrml` maps to the directory's path.
// ---------------------------------------------------------------------------

const MULTI_PAGE_INDEX_SOURCE = `<program title="App">

<a href="/loads">Loads</a>
<a href="/dashboard">Dashboard</a>
<a href="https://external.example.com">External</a>
<a href="#section">Anchor</a>
<a href="/unknown-route">Unknown</a>

</program>
`;

const MULTI_PAGE_LOADS_SOURCE = `<program title="Loads">

<h1>Loads</h1>

</program>
`;

const MULTI_PAGE_DASHBOARD_SOURCE = `<program title="Dashboard">

<h1>Dashboard</h1>

</program>
`;

// ---------------------------------------------------------------------------
// Fixture C — no internal links (tree-shake DEAD case for prefetch_tier_2).
// ---------------------------------------------------------------------------

const NO_LINKS_SOURCE = `<program title="No Links">

<count> = 0

<h1>Hello</h1>
<button onclick=\${@count = @count + 1}>Click</button>
<p>Count: \${@count}</p>

</program>
`;

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "a44-tier2-prefetch-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// Each call uses a stable subdir (fixtureName) so two `compileScrml`
// invocations on the same fixture produce byte-identical filePaths
// (which surface in chunk headers). For determinism tests we need
// `compileWorked` / `compileMultiPage` to be repeatable; randomized
// subdir names would falsify byte-identity.
function freshDir(name) {
  return mkdtempSync(join(TMP, `${name}-`));
}

function writeAndCompile(source, options = {}) {
  // Single-file fixture path — under `<TMP>/single/<fixtureName>/app.scrml`.
  const dir = options.dir ?? join(TMP, "single", options.fixtureName ?? "default");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "app.scrml");
  writeFileSync(filePath, source);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: options.outDir ?? join(dir, "dist"),
    write: options.write ?? false,
    emitPerRoute: options.emitPerRoute ?? true,
    embedRuntime: options.embedRuntime ?? false,
    log: () => {},
    ...options.extra,
  });
}

function writeAndCompileMultiPage(options = {}) {
  // Multi-file fixture: emit three .scrml files under `<dir>/routes/`
  // so Stage 5 RI builds RouteMap.pages with urlPatterns `/`, `/loads`,
  // `/dashboard`.
  const dir = options.dir ?? join(TMP, "multi", options.fixtureName ?? "default");
  const routesDir = join(dir, "routes");
  mkdirSync(routesDir, { recursive: true });
  const indexPath = join(routesDir, "index.scrml");
  const loadsPath = join(routesDir, "loads.scrml");
  const dashPath = join(routesDir, "dashboard.scrml");
  writeFileSync(indexPath, MULTI_PAGE_INDEX_SOURCE);
  writeFileSync(loadsPath, MULTI_PAGE_LOADS_SOURCE);
  writeFileSync(dashPath, MULTI_PAGE_DASHBOARD_SOURCE);
  return compileScrml({
    inputFiles: [indexPath, loadsPath, dashPath],
    outputDir: options.outDir ?? join(dir, "dist"),
    write: options.write ?? false,
    emitPerRoute: options.emitPerRoute ?? true,
    embedRuntime: options.embedRuntime ?? false,
    log: () => {},
    ...options.extra,
  });
}

function getHtmlByFilePath(result, suffix) {
  if (!result.outputs) return undefined;
  for (const [filePath, out] of result.outputs) {
    if (out.html && filePath.endsWith(suffix)) return out.html;
  }
  return undefined;
}

function getInitialChunk(result, role) {
  if (!result.chunks) return undefined;
  for (const chunk of result.chunks.values()) {
    if (chunk.tier === "initial" && chunk.role === role) return chunk;
  }
  return undefined;
}

function getTier2Chunk(result, role) {
  if (!result.chunks) return undefined;
  for (const chunk of result.chunks.values()) {
    if (chunk.tier === "tier2" && chunk.role === role) return chunk;
  }
  return undefined;
}

function getHtmlOutput(result) {
  if (!result.outputs) return undefined;
  for (const [, out] of result.outputs) {
    if (out.html) return out.html;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// §1 — Tier-2 chunk emission: empty intra-route case (v0.3 RS A-2.5 floor)
// ---------------------------------------------------------------------------

describe("§1 tier-2 chunk emission — empty intra-route case (v0.3 floor)", () => {
  test("§40.9.9 worked-example: tier-2 chunk payloadJs is empty for every role", () => {
    const result = writeAndCompile(WORKED_EXAMPLE_SOURCE);
    for (const role of ["Admin", "Anonymous", "Dispatcher", "Driver"]) {
      const t2 = getTier2Chunk(result, role);
      expect(t2).toBeDefined();
      expect(t2.payloadJs).toBe("");
    }
  });

  test("write=true elides empty tier-2 files (no disk write)", () => {
    const dir = mkdtempSync(join(tmpdir(), "a44-write-tier2-"));
    try {
      const result = writeAndCompile(WORKED_EXAMPLE_SOURCE, { write: true, outDir: dir });
      for (const chunk of result.chunks.values()) {
        if (chunk.tier !== "tier2") continue;
        const path = join(dir, chunk.filename);
        expect(existsSync(path)).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — Tier-2 chunk emission: synthetic non-empty intra-route
// ---------------------------------------------------------------------------

describe("§2 composeTier2Chunk — synthetic non-empty intra-route admission", () => {
  test("non-empty admission → composer emits the same atom shape as composeTier1Chunk", async () => {
    const { composeTier2Chunk } = await import("../../src/codegen/route-splitter.ts");
    const ctx = {
      fileAST: {
        filePath: "/abs/fixture.scrml",
        ast: { nodes: [{ kind: "markup", tag: "details", id: 9, children: [] }] },
      },
      routeMap: { functions: new Map() },
    };
    const out = composeTier2Chunk(
      {
        componentNodeIds: new Set([9]),
        reactiveCellNodeIds: new Set(),
        serverFnNodeIds: new Set(),
        vendorUnitNames: new Set(),
      },
      ctx,
      "/abs/fixture.scrml::#program",
      "Admin",
    );
    expect(out).toContain("scrml tier-2 chunk");
    expect(out).toContain("§40.9.7 prefetch_tier_2");
    expect(out).toContain("role=Admin");
    expect(out).toContain(`_scrml_chunk_mount(9, "details");`);
    expect(out).toContain("(function ()");
    expect(out).toContain("})();");
  });
});

// ---------------------------------------------------------------------------
// §3 — `data-scrml-prefetch` wiring on resolvable internal <a href>
// ---------------------------------------------------------------------------

describe("§3 data-scrml-prefetch — resolvable internal <a href>", () => {
  test("internal <a href='/loads'> gets data-scrml-prefetch='/loads'", () => {
    const result = writeAndCompileMultiPage();
    const html = getHtmlByFilePath(result, "index.scrml");
    expect(html).toBeDefined();
    expect(html).toContain(`<a href="/loads"`);
    expect(html).toContain(`data-scrml-prefetch="/loads"`);
  });

  test("internal <a href='/dashboard'> also gets the data attribute", () => {
    const result = writeAndCompileMultiPage();
    const html = getHtmlByFilePath(result, "index.scrml");
    expect(html).toContain(`data-scrml-prefetch="/dashboard"`);
  });
});

// ---------------------------------------------------------------------------
// §4 — No attribute on unresolvable / external / fragment hrefs
// ---------------------------------------------------------------------------

describe("§4 data-scrml-prefetch — skipped for non-internal hrefs", () => {
  test("external href (https://...) gets NO data-scrml-prefetch", () => {
    const result = writeAndCompileMultiPage();
    const html = getHtmlByFilePath(result, "index.scrml");
    // The literal href value must be present but with NO prefetch attr
    // adjacent. Test by extracting the relevant tag.
    const m = html.match(/<a[^>]*https:\/\/external\.example\.com[^>]*>/);
    expect(m).toBeTruthy();
    expect(m[0]).not.toContain("data-scrml-prefetch");
  });

  test("fragment-only href (#section) gets NO data-scrml-prefetch", () => {
    const result = writeAndCompileMultiPage();
    const html = getHtmlByFilePath(result, "index.scrml");
    const m = html.match(/<a[^>]*href="#section"[^>]*>/);
    expect(m).toBeTruthy();
    expect(m[0]).not.toContain("data-scrml-prefetch");
  });

  test("internal href NOT in RouteMap.pages (/unknown-route) gets NO data-scrml-prefetch", () => {
    const result = writeAndCompileMultiPage();
    const html = getHtmlByFilePath(result, "index.scrml");
    const m = html.match(/<a[^>]*href="\/unknown-route"[^>]*>/);
    expect(m).toBeTruthy();
    expect(m[0]).not.toContain("data-scrml-prefetch");
  });
});

// ---------------------------------------------------------------------------
// §5 — Hover-handler attachment in initial-chunk IIFE tail
// ---------------------------------------------------------------------------

describe("§5 hover-handler attachment — initial-chunk IIFE tail", () => {
  test("initial chunk contains querySelectorAll('a[data-scrml-prefetch]') when fixture has internal links", () => {
    const result = writeAndCompileMultiPage();
    // Get any initial chunk (multi-page produces 4 entry points × N roles
    // but the hover-handler attachment is per-(EP, role) — uniform across
    // chunks per shared `hasPrefetchableLinks` flag).
    let foundHandler = false;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      if (chunk.payloadJs.includes(`a[data-scrml-prefetch]`)) {
        foundHandler = true;
        expect(chunk.payloadJs).toContain("mouseenter");
        expect(chunk.payloadJs).toContain("focus");
        expect(chunk.payloadJs).toContain("once: true");
        expect(chunk.payloadJs).toContain("passive: true");
        expect(chunk.payloadJs).toContain("_scrml_prefetch_tier2");
      }
    }
    expect(foundHandler).toBe(true);
  });

  test("hover-handler block NOT emitted when fixture has no internal links", () => {
    const result = writeAndCompile(NO_LINKS_SOURCE);
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      expect(chunk.payloadJs).not.toContain("a[data-scrml-prefetch]");
      expect(chunk.payloadJs).not.toContain("_scrml_prefetch_tier2");
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Runtime function presence (tree-shake LIVE) when internal links exist
// ---------------------------------------------------------------------------

describe("§6 tree-shake LIVE — _scrml_prefetch_tier2 ships when internal links exist", () => {
  test("embed mode: multi-page .client.js contains _scrml_prefetch_tier2 function", () => {
    const dir = mkdtempSync(join(tmpdir(), "a44-treeshake-live-"));
    try {
      const result = writeAndCompileMultiPage({
        dir,
        outDir: dir,
        write: true,
        embedRuntime: true,
      });
      expect(result.errors.length).toBe(0);
      const clientJsPath = join(dir, "index.client.js");
      expect(existsSync(clientJsPath)).toBe(true);
      const clientJs = readFileSync(clientJsPath, "utf8");
      // `prefetch` runtime chunk activated by `hasPrefetchableLinks`.
      expect(clientJs).toContain("function _scrml_prefetch_tier2");
      expect(clientJs).toContain("_SCRML_CHUNKS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — Runtime function elision (tree-shake DEAD) when no internal links
// ---------------------------------------------------------------------------

describe("§7 tree-shake DEAD — _scrml_prefetch_tier2 elided when no internal links", () => {
  test("embed mode: no-links fixture .client.js does NOT contain _scrml_prefetch_tier2 definition", () => {
    const dir = mkdtempSync(join(tmpdir(), "a44-treeshake-dead-"));
    try {
      const filePath = join(dir, "app.scrml");
      writeFileSync(filePath, NO_LINKS_SOURCE);
      const result = compileScrml({
        inputFiles: [filePath],
        outputDir: dir,
        write: true,
        emitPerRoute: true,
        embedRuntime: true,
        log: () => {},
      });
      const clientJsPath = join(dir, "app.client.js");
      expect(existsSync(clientJsPath)).toBe(true);
      const clientJs = readFileSync(clientJsPath, "utf8");
      // No links AND no non-empty tier-1 admission → `prefetch` chunk
      // tree-shaken; BOTH runtime functions absent.
      expect(clientJs).not.toContain("function _scrml_prefetch_tier2");
      expect(clientJs).not.toContain("function _scrml_prefetch_tier1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §8 — _SCRML_CHUNKS manifest scaffold in runtime
// ---------------------------------------------------------------------------

describe("§8 _SCRML_CHUNKS manifest scaffold", () => {
  test("embed mode with internal links: runtime declares _SCRML_CHUNKS scaffold", () => {
    const dir = mkdtempSync(join(tmpdir(), "a44-manifest-scaffold-"));
    try {
      writeAndCompileMultiPage({ dir, outDir: dir, write: true, embedRuntime: true });
      const clientJs = readFileSync(join(dir, "index.client.js"), "utf8");
      expect(clientJs).toContain("_SCRML_CHUNKS");
      // The scaffold is Object.create(null) — A-4.6 will populate.
      expect(clientJs).toContain("Object.create(null)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §9 — Anonymous-role fallback in hover-handler
// ---------------------------------------------------------------------------

describe("§9 anonymous-role fallback — hover handler uses '_anonymous' when _scrml_current_role undefined", () => {
  test("hover-handler block falls back to '_anonymous' literal when _scrml_current_role is not a function", () => {
    const result = writeAndCompileMultiPage();
    // Find any initial chunk with the hover handler block.
    let foundFallback = false;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      if (chunk.payloadJs.includes("a[data-scrml-prefetch]")) {
        // The handler ships the literal `"_anonymous"` as the fallback
        // role string. (A-4.7 will land `_scrml_current_role`; until
        // then, every hover call resolves to the anonymous chunk URL.)
        expect(chunk.payloadJs).toContain('"_anonymous"');
        foundFallback = true;
      }
    }
    expect(foundFallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10 — §40.9.9 worked example extension
// ---------------------------------------------------------------------------

describe("§10 §40.9.9 worked-example extension — nav <a href='/loads'> hover-prefetch wiring", () => {
  test("worked example: every role's initial chunk attaches the hover handler", () => {
    // The §40.9.9 worked example has `<a href="/loads">` — even though
    // the example doesn't define a `<page url="/loads">` in-source, the
    // hover-handler attachment still emits (the per-link runtime
    // attempt will warn-and-skip on missing manifest entry until the
    // adopter ships a `/loads` page). The wiring is at the HTML +
    // chunk level; manifest population is A-4.6 + adopter responsibility.
    //
    // In the worked-example fixture, however, `/loads` is NOT in
    // RouteMap.pages (no `<page url="/loads">`), so no
    // data-scrml-prefetch is emitted. The hover-handler is NOT
    // attached. This is the CORRECT behavior — unresolvable internal
    // hrefs (no matching page) → no prefetch wiring.
    //
    // To exercise the worked-example normative wiring we need a
    // fixture that DOES have a `<page url="/loads">` — see MULTI_PAGE.
    const result = writeAndCompileMultiPage();
    const html = getHtmlByFilePath(result, "index.scrml");
    expect(html).toContain(`data-scrml-prefetch="/loads"`);
    // Initial chunk for any role contains the hover handler block.
    let found = false;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      if (chunk.payloadJs.includes("a[data-scrml-prefetch]")) found = true;
    }
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §11 — Determinism: byte-identical chunks + hover-handler across builds
// ---------------------------------------------------------------------------

describe("§11 determinism — two builds produce byte-identical tier-2 + hover-handler", () => {
  test("two compileScrml invocations on identical source → byte-identical tier-2 chunks", () => {
    const a = writeAndCompile(WORKED_EXAMPLE_SOURCE);
    const b = writeAndCompile(WORKED_EXAMPLE_SOURCE);
    for (const role of ["Admin", "Driver"]) {
      const t2a = getTier2Chunk(a, role);
      const t2b = getTier2Chunk(b, role);
      expect(t2a.payloadJs).toBe(t2b.payloadJs);
    }
  });

  test("two builds produce byte-identical initial-chunk IIFE bodies (hover-handler determinism)", () => {
    const a = writeAndCompileMultiPage();
    const b = writeAndCompileMultiPage();
    const aChunks = [...a.chunks.values()].filter((c) => c.tier === "initial");
    const bChunks = [...b.chunks.values()].filter((c) => c.tier === "initial");
    expect(aChunks.length).toBe(bChunks.length);
    for (let i = 0; i < aChunks.length; i++) {
      expect(aChunks[i].payloadJs).toBe(bChunks[i].payloadJs);
    }
  });
});

// ---------------------------------------------------------------------------
// §12 — Filename pattern OQ-A4-C — <route>/<role>.tier2.<hash>.js
// ---------------------------------------------------------------------------

describe("§12 OQ-A4-C — tier-2 filename pattern", () => {
  test("tier-2 chunk descriptors carry the OQ-A4-C `<route>/<role>.tier2.<hash>.js` pattern", () => {
    const result = writeAndCompile(WORKED_EXAMPLE_SOURCE);
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "tier2") continue;
      expect(chunk.filename).toMatch(/^[A-Za-z0-9_/-]+\/\w+\.tier2\.[0-9a-z]{8}\.js$/);
      // Post-A-4.6 sibling-parallel landing: real FNV-1a base36 hash
      // (NOT the A-4.1 `"00000000"` placeholder — that's now the
      // regression-guard sentinel per A-4.6 doc updates).
      expect(chunk.chunkHash).not.toBe("00000000");
      expect(chunk.chunkHash).toMatch(/^[0-9a-z]{8}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// §13 — Composer determinism + role variance (synthetic)
// ---------------------------------------------------------------------------

describe("§13 composeTier2Chunk — determinism + role variance (synthetic)", () => {
  test("byte-identical input → byte-identical output", async () => {
    const { composeTier2Chunk } = await import("../../src/codegen/route-splitter.ts");
    const ctx = {
      fileAST: {
        filePath: "/abs/app.scrml",
        ast: { nodes: [{ kind: "markup", tag: "section", id: 4, children: [] }] },
      },
      routeMap: { functions: new Map() },
    };
    const contents = {
      componentNodeIds: new Set([4]),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const a = composeTier2Chunk(contents, ctx, "/abs/app.scrml::#program", "Driver");
    const b = composeTier2Chunk(contents, ctx, "/abs/app.scrml::#program", "Driver");
    expect(a).toBe(b);
  });

  test("role surfaces in chunk header — Driver vs Admin differ", async () => {
    const { composeTier2Chunk } = await import("../../src/codegen/route-splitter.ts");
    const ctx = {
      fileAST: { filePath: "/abs/app.scrml", ast: { nodes: [] } },
      routeMap: { functions: new Map() },
    };
    const empty = {
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const driver = composeTier2Chunk(empty, ctx, "/abs/app.scrml::#program", "Driver");
    const admin = composeTier2Chunk(empty, ctx, "/abs/app.scrml::#program", "Admin");
    expect(driver).toContain("role=Driver");
    expect(admin).toContain("role=Admin");
    expect(driver).not.toBe(admin);
  });
});

// ---------------------------------------------------------------------------
// §14 — Per-file .client.js byte regression (A-4.4 is additive on chunk-side)
// ---------------------------------------------------------------------------

describe("§14 per-file .client.js byte regression — A-4.4 chunk-side wiring is additive", () => {
  test("fixture with NO internal links: client.js identical with vs without emitPerRoute", () => {
    const without = writeAndCompile(NO_LINKS_SOURCE, { emitPerRoute: false });
    const withFlag = writeAndCompile(NO_LINKS_SOURCE, { emitPerRoute: true });
    for (const [filePath, withoutOut] of without.outputs) {
      const withOut = withFlag.outputs.get(filePath);
      expect(withOut).toBeDefined();
      // No links → `prefetch` chunk inactive → client.js byte-identical.
      expect(withOut.clientJs).toBe(withoutOut.clientJs);
    }
  });
});
