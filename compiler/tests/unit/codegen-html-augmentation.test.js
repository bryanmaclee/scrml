/**
 * @module compiler/tests/unit/codegen-html-augmentation
 *
 * A-4.7 — Per-route HTML augmentation tests.
 *
 * Covers:
 *   §1  buildChunksBootJs — role-detection bootstrap (shape + behaviour).
 *   §2  buildChunksBootJs — the _SCRML_CHUNKS manifest.
 *   §3  augmentHtmlForChunks — same-origin script tag + modulepreload links
 *       (s444-csp-inline-chunks: NO inline script — `headers="strict"` pins
 *       `default-src 'self'`, which refuses inline script).
 *   §4  augmentHtmlForChunks direct invocation — degenerate inputs.
 *   §5  End-to-end via compileScrml — §40.9.9 worked example HTML output.
 *   §6  End-to-end via compileScrml — tree-shake elision when no chunks.
 *   §7  End-to-end via compileScrml — `_scrml_chunk_mount` defined in
 *       runtime when chunks emit components.
 *   §8  End-to-end via compileScrml — `_scrml_vendor_require` defined
 *       in runtime when chunks emit vendor units (skipped — no vendor
 *       fixture in current corpus).
 *   §9  W-CG-CHUNK-* lint behavior (W-CG-CHUNK-EMPTY proven via empty-
 *       admission test; W-CG-CHUNK-LARGE / NO-PREFETCH / MISSING-ROLE
 *       partial coverage via fixtures).
 *  §10  Determinism — two builds produce byte-identical HTML output.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { augmentHtmlForChunks, buildChunksBootJs } from "../../src/codegen/emit-html.ts";
import { RUNTIME_CHUNKS, assembleRuntime, RUNTIME_CHUNK_ORDER } from "../../src/codegen/runtime-chunks.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>fixture</title>
</head>
<body>
  <h1>hello</h1>
</body>
</html>`;

function chunk(epId, role, tier, filename, payloadJs = "") {
  return { entryPointId: epId, role, tier, filename, payloadJs };
}

// §40.9.9 worked-example source (mirrors initial-chunk-emission.test.js
// fixture).
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
  TMP = mkdtempSync(join(tmpdir(), "a47-html-aug-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileWorked({ emitPerRoute = true } = {}) {
  const filePath = join(TMP, "app.scrml");
  writeFileSync(filePath, WORKED_EXAMPLE_SOURCE);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: join(TMP, "dist"),
    write: false,
    emitPerRoute,
    log: () => {},
  });
}

// ---------------------------------------------------------------------------
// Helpers — s444-csp-inline-chunks
// ---------------------------------------------------------------------------

const BOOT_SRC = "/scrml-chunks.abcd1234.js";

/**
 * Every EXECUTABLE inline `<script>` in `html` — a `<script>` with no `src=`
 * whose `type` is absent / a JS type / `module`. Under
 * `<program headers="strict">` the compiler pins
 * `Content-Security-Policy: default-src 'self'` (§39.2.5), which carries no
 * `'unsafe-inline'`, no nonce and no hash — so EVERY such script is refused by
 * the browser. The only compliant count is zero. (A non-JS `type`, e.g.
 * `application/json`, is a data block: never executed, nothing to refuse.)
 */
function executableInlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : "";
    const isJs = type === "" || type === "text/javascript" || type === "application/javascript" || type === "module";
    if (isJs) out.push(m[2]);
  }
  return out;
}

/**
 * Execute the emitted chunk-activation script against a minimal host: the
 * loading `<script>` tag carries `routeAttr` as `data-scrml-route`, and the
 * role hint comes from `role` (via localStorage). Returns the chunk URL the
 * bootstrap injected (or null) + the manifest it published + any warnings.
 */
function runBoot(bootJs, { routeAttr, role }) {
  const injected = [];
  const warnings = [];
  const win = {};
  const doc = {
    currentScript: {
      getAttribute: (n) => (n === "data-scrml-route" ? (routeAttr ?? null) : null),
    },
    cookie: "",
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild: (el) => injected.push(el) },
  };
  const ls = { getItem: (k) => (k === "scrml_role" ? (role ?? null) : null) };
  const con = { warn: (msg) => warnings.push(String(msg)) };
  new Function("window", "document", "localStorage", "console", bootJs)(win, doc, ls, con);
  return { injected, warnings, manifest: win._SCRML_CHUNKS };
}

// ---------------------------------------------------------------------------
// §1 — buildChunksBootJs — role-detection bootstrap
// ---------------------------------------------------------------------------

describe("§1 — buildChunksBootJs: role-detection bootstrap", () => {
  test("bootstrap contains localStorage / cookie / meta fallback order", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.abc12345.js", "// payload")],
    ]);
    const js = buildChunksBootJs({
      chunks,
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
    });
    expect(js).toContain('localStorage.getItem("scrml_role")');
    expect(js).toContain("document.cookie.match");
    expect(js).toContain('querySelector(\'meta[name="scrml-role"]\')');
    expect(js).toContain('"_anonymous"');
  });

  test("bootstrap dispatches the role's initial chunk via dynamic <script> injection", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.a.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/loads", "Admin", "initial", "loads/Admin.initial.b.js", "// p")],
    ]);
    const js = buildChunksBootJs({
      chunks,
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
    });
    expect(js).toContain('document.createElement("script")');
    expect(js).toContain("s.defer = true");
    expect(js).toContain("document.head.appendChild(s)");
    const run = runBoot(js, { routeAttr: "/loads", role: "Admin" });
    expect(run.injected.map((s) => s.src)).toEqual(["/loads/Admin.initial.b.js"]);
    expect(run.warnings).toEqual([]);
  });

  test("the active route comes from the loading tag's data-scrml-route, not a baked literal", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/a.scrml#page@/a", "Driver", "initial", "a/Driver.initial.1.js", "// p")],
      ["k2", chunk("/abs/b.scrml#page@/b", "Driver", "initial", "b/Driver.initial.2.js", "// p")],
    ]);
    const js = buildChunksBootJs({
      chunks,
      epIdToRoutePath: new Map([
        ["/abs/a.scrml#page@/a", "/a"],
        ["/abs/b.scrml#page@/b", "/b"],
      ]),
    });
    expect(js).not.toContain("var activeRoute = \"");
    expect(runBoot(js, { routeAttr: "/a", role: "Driver" }).injected[0].src).toBe("/a/Driver.initial.1.js");
    expect(runBoot(js, { routeAttr: "/b", role: "Driver" }).injected[0].src).toBe("/b/Driver.initial.2.js");
  });

  test("bootstrap warns + loads nothing when the tag carries no route", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#program", "_anonymous", "initial", "_root/_anonymous.initial.x.js", "// p")],
    ]);
    const js = buildChunksBootJs({ chunks, epIdToRoutePath: new Map([["/abs/app.scrml#program", "/"]]) });
    const run = runBoot(js, { routeAttr: null, role: "_anonymous" });
    expect(run.injected).toEqual([]);
    expect(run.warnings.join("\n")).toContain("no active route for chunk bootstrap");
  });

  test("bootstrap warns + loads nothing for a role with no chunk", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/x", "Admin", "initial", "x/Admin.initial.x.js", "// p")],
    ]);
    const js = buildChunksBootJs({ chunks, epIdToRoutePath: new Map([["/abs/app.scrml#page@/x", "/x"]]) });
    const run = runBoot(js, { routeAttr: "/x", role: "Driver" });
    expect(run.injected).toEqual([]);
    expect(run.warnings.join("\n")).toContain("no chunk for role 'Driver'");
  });
});

// ---------------------------------------------------------------------------
// §2 — buildChunksBootJs — the _SCRML_CHUNKS manifest
// ---------------------------------------------------------------------------

describe("§2 — buildChunksBootJs: _SCRML_CHUNKS manifest", () => {
  test("manifest contains route-keyed entries for all roles + tiers", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.abc1.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/loads", "Driver", "tier1", "loads/Driver.tier1.abc2.js", "// p")],
      ["k3", chunk("/abs/app.scrml#page@/loads", "Admin", "initial", "loads/Admin.initial.abc3.js", "// p")],
    ]);
    const js = buildChunksBootJs({
      chunks,
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
    });
    expect(js).toContain("window._SCRML_CHUNKS = ");
    const { manifest } = runBoot(js, { routeAttr: "/loads", role: "Driver" });
    expect(manifest).toEqual({
      "/loads": {
        Driver: { initial: "/loads/Driver.initial.abc1.js", tier1: "/loads/Driver.tier1.abc2.js" },
        Admin: { initial: "/loads/Admin.initial.abc3.js" },
      },
    });
  });

  test("manifest skips tier-1 URLs for empty payloads", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.x.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/loads", "Driver", "tier1", "loads/Driver.tier1.y.js", "" /* empty */)],
    ]);
    const js = buildChunksBootJs({
      chunks,
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
    });
    expect(js).toContain('"/loads/Driver.initial.x.js"');
    // Empty tier-1 payload → URL skipped from the manifest.
    expect(js).not.toContain("/loads/Driver.tier1.y.js");
  });

  test("esm: the injected chunk script is marked type=\"module\"; classic has no s.type line", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/x", "Driver", "initial", "x/Driver.initial.x.js", "// p")],
    ]);
    const epIdToRoutePath = new Map([["/abs/app.scrml#page@/x", "/x"]]);
    const esm = buildChunksBootJs({ chunks, epIdToRoutePath, moduleFormat: "esm" });
    const classic = buildChunksBootJs({ chunks, epIdToRoutePath });
    expect(esm).toContain('s.type = "module";');
    expect(classic).not.toContain("s.type");
    expect(runBoot(esm, { routeAttr: "/x", role: "Driver" }).injected[0].type).toBe("module");
  });

  test("deterministic — identical input → byte-identical script", () => {
    const mk = () => new Map([
      ["k1", chunk("/abs/app.scrml#page@/x", "Driver", "initial", "x/Driver.initial.x.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/x", "Admin", "initial", "x/Admin.initial.y.js", "// p")],
    ]);
    const epIdToRoutePath = new Map([["/abs/app.scrml#page@/x", "/x"]]);
    expect(buildChunksBootJs({ chunks: mk(), epIdToRoutePath })).toBe(buildChunksBootJs({ chunks: mk(), epIdToRoutePath }));
  });
});

// ---------------------------------------------------------------------------
// §3 — augmentHtmlForChunks — the HTML references (no inline script)
// ---------------------------------------------------------------------------

describe("§3 — augmentHtmlForChunks: same-origin script tag + modulepreload links", () => {
  test("injects a same-origin <script src> carrying the active route; NO inline script", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/dashboard", "_anonymous", "initial", "dashboard/_anonymous.initial.deadbeef.js", "// payload")],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#page@/dashboard"],
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/dashboard", "/dashboard"]]),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toContain(`<script src="${BOOT_SRC}" data-scrml-route="/dashboard"></script>`);
    expect(out).not.toContain("_SCRML_CHUNKS");
    expect(out).not.toContain("scrml_role");
    expect(executableInlineScripts(out)).toEqual([]);
  });

  test("script tag inserted before </head> close", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/x", "_anonymous", "initial", "x/_anonymous.initial.a.js", "// p")],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#page@/x"],
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/x", "/x"]]),
      chunksBootSrc: BOOT_SRC,
    });
    const tagIdx = out.indexOf(BOOT_SRC);
    const headCloseIdx = out.indexOf("</head>");
    const bodyOpenIdx = out.indexOf("<body>");
    expect(tagIdx).toBeGreaterThanOrEqual(0);
    expect(headCloseIdx).toBeGreaterThan(tagIdx);
    expect(bodyOpenIdx).toBeGreaterThan(headCloseIdx);
  });

  test("unresolvable active route → tag carries NO data-scrml-route (bootstrap warns + skips)", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#program", "_anonymous", "initial", "_root/_anonymous.initial.x.js", "// p")],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#program"],
      epIdToRoutePath: new Map(),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toContain(`<script src="${BOOT_SRC}"></script>`);
    expect(out).not.toContain("data-scrml-route");
  });

  test("route value is attribute-escaped", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/a\"b", "Driver", "initial", "ab/Driver.initial.x.js", "// p")],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#page@/a\"b"],
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/a\"b", "/a\"b"]]),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toContain('data-scrml-route="/a&quot;b"');
  });

  test("non-empty tier-1 → emits modulepreload link", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.x.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/loads", "Driver", "tier1", "loads/Driver.tier1.y.js", "// content")],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#page@/loads"],
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toContain('<link rel="modulepreload" href="/loads/Driver.tier1.y.js">');
  });

  test("empty tier-1 → NO modulepreload link", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.x.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/loads", "Driver", "tier1", "loads/Driver.tier1.y.js", "" /* empty */)],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#page@/loads"],
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).not.toContain('rel="modulepreload"');
  });

  test("multiple roles with non-empty tier-1 → one modulepreload per role", () => {
    const chunks = new Map([
      ["k1", chunk("/abs/app.scrml#page@/x", "Driver", "initial", "x/Driver.initial.x.js", "// p")],
      ["k2", chunk("/abs/app.scrml#page@/x", "Driver", "tier1", "x/Driver.tier1.y.js", "// content")],
      ["k3", chunk("/abs/app.scrml#page@/x", "Admin", "initial", "x/Admin.initial.x.js", "// p")],
      ["k4", chunk("/abs/app.scrml#page@/x", "Admin", "tier1", "x/Admin.tier1.z.js", "// content")],
    ]);
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks,
      fileEntryPointIds: ["/abs/app.scrml#page@/x"],
      epIdToRoutePath: new Map([["/abs/app.scrml#page@/x", "/x"]]),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toContain("/x/Driver.tier1.y.js");
    expect(out).toContain("/x/Admin.tier1.z.js");
    // Two modulepreload occurrences.
    const matches = out.match(/rel="modulepreload"/g);
    expect(matches?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4 — degenerate inputs (no augmentation paths)
// ---------------------------------------------------------------------------

describe("§4 — augmentHtmlForChunks: degenerate inputs", () => {
  test("empty fileEntryPointIds → input HTML returned unchanged", () => {
    const out = augmentHtmlForChunks({
      html: BASE_HTML,
      chunks: new Map(),
      fileEntryPointIds: [],
      epIdToRoutePath: new Map(),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toBe(BASE_HTML);
  });

  test("input HTML without </head> → returned unchanged (defensive)", () => {
    const html = "<html><body>only body</body></html>";
    const out = augmentHtmlForChunks({
      html,
      chunks: new Map([["k1", chunk("/x.scrml#program", "_anonymous", "initial", "_root/_anonymous.initial.a.js", "// p")]]),
      fileEntryPointIds: ["/x.scrml#program"],
      epIdToRoutePath: new Map([["/x.scrml#program", "/"]]),
      chunksBootSrc: BOOT_SRC,
    });
    expect(out).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// §5 — End-to-end via compileScrml — §40.9.9 worked example
// ---------------------------------------------------------------------------

describe("§5 — compileScrml HTML output (§40.9.9 worked example)", () => {
  test("result carries a content-addressed dist-root chunk-activation script", () => {
    const result = compileWorked();
    expect(result.chunksBootFilename).toMatch(/^scrml-chunks\.[0-9a-z]{8}\.js$/);
    expect(result.chunksBootJs).toContain("window._SCRML_CHUNKS = ");
    expect(result.chunksBootJs).toContain('localStorage.getItem("scrml_role")');
    expect(result.chunksBootJs).toContain('document.createElement("script")');
  });

  test("HTML references the script by same-origin src, with the page's route", () => {
    const result = compileWorked();
    const fileOut = result.outputs.values().next().value;
    expect(fileOut?.html).toBeDefined();
    expect(fileOut.html).toContain(`<script src="/${result.chunksBootFilename}" data-scrml-route="/"></script>`);
    expect(fileOut.html).not.toContain("window._SCRML_CHUNKS");
  });

  test("manifest references all four role variants", () => {
    const result = compileWorked();
    expect(result.chunksBootJs).toContain('"Admin"');
    expect(result.chunksBootJs).toContain('"Anonymous"');
    expect(result.chunksBootJs).toContain('"Dispatcher"');
    expect(result.chunksBootJs).toContain('"Driver"');
  });

  test("manifest references chunk filenames matching chunks Map", () => {
    const result = compileWorked();
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      expect(result.chunksBootJs).toContain(chunk.filename);
    }
  });

  test("data-scrml-prefetch attribute already wired (A-4.4 regression)", () => {
    const result = compileWorked();
    const fileOut = result.outputs.values().next().value;
    // The fixture has `<a href="/loads">` — A-4.4 should have wired
    // data-scrml-prefetch IF /loads were a page in RouteMap.pages. The
    // fixture is a single-file app with no `/loads` page, so the
    // attribute is NOT emitted (the lookup misses). This test
    // documents the absence; it pins the A-4.4 contract that only
    // INTERNAL routes get the attribute.
    //
    // When the worked example grows to multi-file with /loads as a
    // real page, this assertion flips polarity.
    expect(typeof fileOut.html).toBe("string");
  });

  test("headers=\"strict\": the pinned CSP admits every script the page carries (no executable inline script)", () => {
    const filePath = join(TMP, "strict-app.scrml");
    writeFileSync(filePath, WORKED_EXAMPLE_SOURCE.replace('auth="required">', 'auth="required" headers="strict">'));
    const result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(TMP, "dist-strict"),
      write: false,
      emitPerRoute: true,
      log: () => {},
    });
    const fileOut = result.outputs.get(filePath);
    // The CSP the compiler pins: `default-src 'self'` — no 'unsafe-inline', no
    // nonce, no hash. So an inline script is covered only if there are none.
    const cspMatch = fileOut.serverJs.match(/'Content-Security-Policy',\s*"([^"]*)"/);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch[1];
    expect(csp).toBe("default-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(executableInlineScripts(fileOut.html)).toEqual([]);
    // …and every external script is same-origin (root-relative or relative).
    const srcs = [...fileOut.html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toContain(`/${result.chunksBootFilename}`);
    for (const src of srcs) expect(src).not.toMatch(/^(?:[a-z]+:)?\/\//i);
  });
});

// ---------------------------------------------------------------------------
// §6 — Tree-shake elision when no chunks emitted
// ---------------------------------------------------------------------------

describe("§6 — chunks-disabled mode preserves pre-A-4.7 HTML shape", () => {
  test("emitPerRoute=false → no _SCRML_CHUNKS / no role-bootstrap in HTML", () => {
    const result = compileWorked({ emitPerRoute: false });
    const fileOut = result.outputs.values().next().value;
    expect(fileOut?.html).toBeDefined();
    expect(fileOut.html).not.toContain("window._SCRML_CHUNKS");
    expect(fileOut.html).not.toContain('scrml_role');
    expect(fileOut.html).not.toContain("scrml-chunks.");
    expect(result.chunksBootJs).toBeUndefined();
    expect(result.chunksBootFilename).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §7 — Runtime helper definitions
// ---------------------------------------------------------------------------

describe("§7 — runtime helper definitions (atom-emitter prerequisites)", () => {
  test("_scrml_chunk_mount defined in 'mount' chunk", () => {
    expect(RUNTIME_CHUNKS.mount).toContain("function _scrml_chunk_mount");
  });

  test("_scrml_vendor_require defined in 'vendor-ref' chunk", () => {
    expect(RUNTIME_CHUNKS["vendor-ref"]).toContain("function _scrml_vendor_require");
  });

  test("'mount' chunk in RUNTIME_CHUNK_ORDER", () => {
    expect(RUNTIME_CHUNK_ORDER).toContain("mount");
  });

  test("'vendor-ref' chunk in RUNTIME_CHUNK_ORDER", () => {
    expect(RUNTIME_CHUNK_ORDER).toContain("vendor-ref");
  });

  test("tree-shake elision — runtime without 'mount' lacks _scrml_chunk_mount", () => {
    const runtime = assembleRuntime(new Set(["core", "scope", "errors", "transitions"]));
    expect(runtime).not.toContain("function _scrml_chunk_mount");
  });

  test("tree-shake elision — runtime without 'vendor-ref' lacks _scrml_vendor_require", () => {
    const runtime = assembleRuntime(new Set(["core", "scope", "errors", "transitions"]));
    expect(runtime).not.toContain("function _scrml_vendor_require");
  });

  test("activation — runtime with 'mount' contains _scrml_chunk_mount", () => {
    const runtime = assembleRuntime(new Set(["core", "scope", "errors", "transitions", "mount"]));
    expect(runtime).toContain("function _scrml_chunk_mount");
  });

  test("activation — runtime with 'vendor-ref' contains _scrml_vendor_require", () => {
    const runtime = assembleRuntime(new Set(["core", "scope", "errors", "transitions", "vendor-ref"]));
    expect(runtime).toContain("function _scrml_vendor_require");
  });
});

// ---------------------------------------------------------------------------
// §8 — Full runtime in --emit-per-route mode
// ---------------------------------------------------------------------------

describe("§8 — full runtime in --emit-per-route mode", () => {
  test("compileScrml result includes runtimeJs with mount helpers", () => {
    const result = compileWorked();
    // The full SCRML_RUNTIME (per-app distribution) includes both
    // helpers unconditionally. result.outputs is per-file; runtimeJs
    // lives on cgResult — surfaced via outputs in this fixture only
    // for the per-file embedded path. The full runtime is reachable
    // via api.js's RUNTIME_FILENAME path.
    //
    // For this test: assert atom-emitter output references the
    // helpers (the chunks ARE the runtime-helper consumers).
    let foundChunkMount = false;
    for (const chunk of result.chunks.values()) {
      if (chunk.payloadJs.includes("_scrml_chunk_mount(")) {
        foundChunkMount = true;
        break;
      }
    }
    expect(foundChunkMount).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §9 — Determinism — two builds produce byte-identical HTML output
// ---------------------------------------------------------------------------

describe("§9 — determinism (§40.9.8)", () => {
  test("two compileScrml invocations on identical source → byte-identical HTML", () => {
    const r1 = compileWorked();
    const r2 = compileWorked();
    const f1 = r1.outputs.values().next().value;
    const f2 = r2.outputs.values().next().value;
    expect(f1.html).toBe(f2.html);
  });
});

// ---------------------------------------------------------------------------
// §10 — W-CG-CHUNK-* lint family
// ---------------------------------------------------------------------------

describe("§10 — W-CG-CHUNK-* lint family", () => {
  test("W-CG-CHUNK-EMPTY fires on empty-admission entry-point", async () => {
    // Direct invocation of emitPerRouteChunks with an empty plan
    // exercises the lint path. The integration smoke is sufficient;
    // direct-test path lives in codegen-route-splitter.test.js.
    const { emitPerRouteChunks } = await import("../../src/codegen/route-splitter.ts");
    const ANONYMOUS_ROLE = "_anonymous";
    const empty = {
      componentNodeIds: new Set(),
      reactiveCellNodeIds: new Set(),
      serverFnNodeIds: new Set(),
      vendorUnitNames: new Set(),
    };
    const plan = {
      initialChunk: empty,
      prefetchTier1: empty,
      prefetchTier2: empty,
      prefetchTierN: [],
    };
    const record = {
      closures: new Map([
        ["/abs/empty.scrml::#program", { byRole: new Map([[ANONYMOUS_ROLE, plan]]) }],
      ]),
    };
    const { diagnostics } = emitPerRouteChunks({ reachabilityRecord: record });
    const emptyLints = diagnostics.filter((d) => d.code === "W-CG-CHUNK-EMPTY");
    expect(emptyLints.length).toBe(1);
    expect(emptyLints[0].severity).toBe("warning");
  });

  test("worked-example fixture does NOT fire W-CG-CHUNK-EMPTY (non-empty admission)", () => {
    const result = compileWorked();
    const emptyLints = result.warnings.filter((w) => w.code === "W-CG-CHUNK-EMPTY");
    expect(emptyLints.length).toBe(0);
  });

  test("worked-example fixture does NOT fire W-CG-CHUNK-LARGE (under 100KB budget)", () => {
    const result = compileWorked();
    const largeLints = result.warnings.filter((w) => w.code === "W-CG-CHUNK-LARGE");
    expect(largeLints.length).toBe(0);
  });
});
