/**
 * esm-script-tag-module-format.test.js — ESM chunks arc, Unit 3 (scope A).
 *
 * Under `--module-format=esm` every emitted client-chunk + runtime `<script src>`
 * tag must carry `type="module"` (a classic `<script src>` throws
 * `SyntaxError: Cannot use import statement outside a module` on an ES-module
 * chunk). Classic (the default) emits the exact classic tags → byte-identical to
 * pre-arc output. This file pins that across the three emit surfaces:
 *
 *   §1  single-file / flat-multifile envelope (`codegen/index.ts` doc envelope)
 *   §2  composed MPA per-page re-emit (`codegen/index.ts` shell composition)
 *   §3  role-detection bootstrap dynamic `<script>` inject
 *       (`codegen/emit-html.ts:augmentHtmlForChunks`)
 *
 * Byte-identity of the classic path is proven separately (esm-client-chunk-format
 * §2 + the corpus diff in the U3 report); here we assert the presence/absence of
 * the `type="module"` marker per format.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { compileScrml, scanDirectory } from "../../src/api.js";
import { augmentHtmlForChunks } from "../../src/codegen/emit-html.ts";
import { toEsmClientChunk } from "../../src/codegen/emit-client-esm.ts";

const FLAT_MULTIFILE = join(import.meta.dir, "../../../examples/22-multifile");
const WEBSITE_MPA = join(import.meta.dir, "../../../docs/website");

const tmpDirs = [];
function freshDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// In-process compile (NO `bun compile` subprocess) — returns filePath → html for
// every output that has HTML, mirroring the CLI's shell composition + script-tag
// emit (same runCG) WITHOUT spawning a process per call. Deliberately off the
// parallel pre-commit suite's CPU critical path: a sibling real-HTTP integration
// test (`serve-target-tool-r26`) races its server boot under load, and a fan of
// concurrent `bun compile` subprocesses from this file measurably worsened that
// pre-existing flake. In-process compilation asserts the exact same emitted tags
// with a fraction of the CPU footprint.
async function compileHtml(srcDir, moduleFormat) {
  const files = scanDirectory(srcDir);
  const r = await compileScrml({
    inputFiles: files,
    outputDir: "/tmp/scrml-u3-inproc-noop", // write:false → never touched
    outputBaseDir: srcDir,
    write: false,
    moduleFormat,
    log: () => {},
  });
  expect(r.errors.length).toBe(0);
  const htmlByFile = new Map();
  for (const [fp, out] of r.outputs) if (out.html) htmlByFile.set(fp, out.html);
  return htmlByFile;
}
function entryHtml(htmlByFile, base) {
  // basename(), not `endsWith("/" + base)` — the compiler's output keys are
  // OS-native paths, so a `/`-anchored suffix match never fires on Windows and
  // every caller here threw `no HTML output for …` on the windows canary.
  for (const [fp, html] of htmlByFile) if (basename(fp) === base) return html;
  throw new Error(`no HTML output for ${base}`);
}

// All `<script src=...>` tags that reference a client chunk or the shared runtime
// (i.e. the tags Unit 3 modularizes). Inline `<script>…</script>` blocks (the
// _SCRML_CHUNKS manifest, the role bootstrap) have no `src=` and are excluded.
function scriptSrcTags(html) {
  return [...html.matchAll(/<script[^>]*\ssrc="[^"]*"><\/script>/g)].map((m) => m[0]);
}

describe("§1 single-file / flat-multifile envelope — runtime + chunk tags", () => {
  test("esm: every runtime + client-chunk <script src> carries type=\"module\"", async () => {
    const html = entryHtml(await compileHtml(FLAT_MULTIFILE, "esm"), "app.scrml");
    const tags = scriptSrcTags(html);
    // runtime + types + components + app = 4 chunk/runtime tags in this fixture.
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const t of tags) expect(t).toContain('type="module"');
    // No un-moduled client-chunk / runtime tag left behind.
    expect(/<script src="[^"]*\.js"><\/script>/.test(html)).toBe(false);
  });

  test("classic: the same tags carry NO type attr (byte-shape unchanged)", async () => {
    const html = entryHtml(await compileHtml(FLAT_MULTIFILE, "classic"), "app.scrml");
    const tags = scriptSrcTags(html);
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const t of tags) expect(t).not.toContain("type=");
  });

  test("default (no flag) === classic for the envelope tags", async () => {
    const def = entryHtml(await compileHtml(FLAT_MULTIFILE, undefined), "app.scrml");
    const cls = entryHtml(await compileHtml(FLAT_MULTIFILE, "classic"), "app.scrml");
    expect(scriptSrcTags(def)).toEqual(scriptSrcTags(cls));
    expect(scriptSrcTags(def).every((t) => !t.includes("type="))).toBe(true);
  });
});

describe("§2 composed MPA — per-page re-emitted script set (docs/website)", () => {
  test("esm: composed per-page + shell tags all carry type=\"module\" (incl. nested upToRoot)", async () => {
    const htmlByFile = await compileHtml(WEBSITE_MPA, "esm");
    expect(htmlByFile.size).toBeGreaterThan(1); // shell + composed pages
    let sawComposedPage = false;
    let sawNestedUpToRoot = false;
    for (const [, html] of htmlByFile) {
      const tags = scriptSrcTags(html);
      for (const t of tags) {
        expect(t).toContain('type="module"');
        if (/src="\.\.\//.test(t)) sawNestedUpToRoot = true; // ../ prefix (nested page)
      }
      // A composed page pulls in the shell's app.client.js in addition to its own.
      if (tags.some((t) => /app\.client\.js/.test(t)) && tags.length >= 2) sawComposedPage = true;
      // Zero classic (un-moduled) client-chunk / runtime tags anywhere in the MPA.
      expect(/<script src="[^"]*\.js"><\/script>/.test(html)).toBe(false);
    }
    expect(sawComposedPage).toBe(true);
    expect(sawNestedUpToRoot).toBe(true);
    // Compiles the full 98-file docs/website in-process (~13s locally, slower on a
    // loaded CI runner); the default 5s test timeout tripped on the cloud gate.
    // Generous timeout for now; TODO(esm-u3-followup) swap to a small shell+nested-page
    // fixture so this stays sub-second and OS-path-agnostic (Windows canary).
  }, 60_000);

  test("classic: composed per-page + shell tags carry NO type attr", async () => {
    const htmlByFile = await compileHtml(WEBSITE_MPA, "classic");
    for (const [, html] of htmlByFile) {
      for (const t of scriptSrcTags(html)) expect(t).not.toContain("type=");
    }
  }, 60_000);
});

// Role-detection bootstrap: the pure-function surface (emit-html.ts). The
// bootstrap dynamically injects the per-role initial chunk; under esm the
// injected script must be `s.type = "module"`.
function chunkDesc(epId, role, tier, filename, payloadJs = "// payload") {
  return { entryPointId: epId, role, tier, filename, payloadJs };
}
const BOOT_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>x</title></head>
<body><h1>hi</h1></body></html>`;

describe("§3 role-detection bootstrap dynamic inject — augmentHtmlForChunks", () => {
  const baseInput = {
    html: BOOT_HTML,
    chunks: new Map([
      ["k1", chunkDesc("/abs/app.scrml#page@/loads", "Driver", "initial", "loads/Driver.initial.abc12345.js")],
    ]),
    fileEntryPointIds: ["/abs/app.scrml#page@/loads"],
    epIdToRoutePath: new Map([["/abs/app.scrml#page@/loads", "/loads"]]),
  };

  test("esm: the injected chunk script is marked type=\"module\"", () => {
    const out = augmentHtmlForChunks({ ...baseInput, moduleFormat: "esm" });
    expect(out).toContain('document.createElement("script")');
    expect(out).toContain('s.type = "module";');
    expect(out).toContain("s.defer = true"); // module scripts are deferred anyway
  });

  test("classic (default): the injected chunk script has NO s.type line", () => {
    const outDefault = augmentHtmlForChunks(baseInput);
    const outClassic = augmentHtmlForChunks({ ...baseInput, moduleFormat: "classic" });
    expect(outDefault).not.toContain('s.type = "module"');
    expect(outClassic).not.toContain('s.type = "module"');
    // Default and explicit-classic are identical for the bootstrap.
    expect(outDefault).toBe(outClassic);
    expect(outDefault).toContain("s.defer = true");
  });
});

// The per-route INITIAL chunk the bootstrap injects (route-splitter output,
// written RAW at api.js:3163) is a CLASSIC IIFE calling runtime functions as
// FREE GLOBALS. Marking the injected script `type="module"` (§3) WITHOUT
// converting the chunk to import those symbols ships a browser-DOA chunk —
// module scope hides the runtime globals → uncaught ReferenceError. §3 only
// checks the marker is present; this block EXECUTES the chunk against a real
// ES-module runtime (bun native loader), the S265 "emitted ≠ runs" discipline.
//
// The route-splitter chunk shape: a `// scrml initial chunk` comment then an
// IIFE calling `_scrml_reactive_set` / `_scrml_chunk_mount` as bare globals.
const PER_ROUTE_PAYLOAD =
  `// scrml initial chunk — role=_anonymous\n` +
  `(function () {\n` +
  `  "use strict";\n` +
  `  _scrml_reactive_set("search", "");\n` +
  `  _scrml_chunk_mount(29, "h1");\n` +
  `})();\n`;
// A minimal CLASSIC runtime slice — its top-level decls are the export universe.
const RUNTIME_SLICE_STUB =
  `function _scrml_reactive_set(n, v) {}\n` +
  `function _scrml_chunk_mount(id, tag) {}\n`;

describe("§4 per-route chunk EXECUTES as a module (the S265 'emitted ≠ runs' trap)", () => {
  test("NEGATIVE control: the RAW payload loaded as a module throws ReferenceError (DOA if only marked)", async () => {
    const dir = freshDir("scrml-u3-perroute-raw-");
    const f = join(dir, "raw.mjs");
    writeFileSync(f, PER_ROUTE_PAYLOAD); // classic IIFE, NO imports → free globals
    let err = null;
    try {
      await import(f); // real module scope → `_scrml_reactive_set` is not defined
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(String(err)).toMatch(/_scrml_reactive_set is not defined|ReferenceError/);
  });

  test("the CONVERTED payload links + executes against the esm runtime (no ReferenceError)", async () => {
    const dir = freshDir("scrml-u3-perroute-esm-");
    // A real ES-module runtime exporting the two symbols as call-recorders.
    writeFileSync(
      join(dir, "scrml-runtime.deadbeef.js"),
      `export function _scrml_reactive_set(n, v) { (globalThis.__perRouteCalls ??= []).push(["set", n, v]); }\n` +
        `export function _scrml_chunk_mount(id, tag) { (globalThis.__perRouteCalls ??= []).push(["mount", id, tag]); }\n`,
    );
    const converted = toEsmClientChunk(PER_ROUTE_PAYLOAD, {
      runtimeSlice: RUNTIME_SLICE_STUB,
      runtimePlaceholder: "scrml-runtime.deadbeef.js",
      importerDistDir: ".",
      runtimeUrl: "./scrml-runtime.deadbeef.js", // Unit 3 per-route explicit URL
    });
    // The free-global calls now bind to imported runtime symbols.
    expect(converted).toContain(
      'import { _scrml_chunk_mount, _scrml_reactive_set } from "./scrml-runtime.deadbeef.js";',
    );
    const chunkFile = join(dir, "chunk.mjs");
    writeFileSync(chunkFile, converted);
    globalThis.__perRouteCalls = [];
    await import(chunkFile); // links the runtime import + runs the IIFE — no ReferenceError
    expect(globalThis.__perRouteCalls).toEqual([
      ["set", "search", ""],
      ["mount", 29, "h1"],
    ]);
    delete globalThis.__perRouteCalls;
  });
});
