/**
 * S461 — §47.9.9 "one reader" for `--module-format=esm` per-route chunks.
 *
 * "The strip is the last transform of each artifact's bytes and runs BEFORE everything that
 * reads or names them … every content hash — … the per-route chunk hash (§47.5, §40.9.8) … — is
 * computed over the stripped bytes, so a content address always names the bytes that ship."
 *
 * Before S461 the esm chunk transform (`toEsmClientChunk`) ran in `runCG` AFTER
 * `emitPerRouteChunks` had stripped and hashed each chunk: every written esm chunk shipped the
 * transform's `// --- runtime + cross-file imports (esm-chunks) ---` header comment and an
 * unstripped import line, and its filename hash named bytes that were not the bytes on disk
 * (gap g-ship-strip-esm-chunks-after-strip-s459). The order is now, inside
 * `finalizeChunkHash`: esm transform -> strip -> hash.
 *
 * Pins, on the bytes WRITTEN to disk:
 *   1. an esm chunk carries no comment the strip removes;
 *   2. the strip is a fixed point on it (nothing ran after the strip);
 *   3. its filename hash == computeChunkHash(admission sets, shipped bytes);
 *   4. every reference to a chunk (chunks.json, the chunk-activation script, the HTML
 *      modulepreload) names a file that exists on disk;
 *   5. classic per-route chunks are unchanged by the hook (no esm hook => identity).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore
import * as acorn from "acorn";
import { compileScrml, scanDirectory } from "../../src/api.js";
import { computeChunkHash } from "../../src/codegen/route-splitter.ts";
import { shipStrip } from "../../src/codegen/ship-strip.ts";

const APP = join(import.meta.dir, "../../../examples/22-multifile");

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

// Mirrors ship-strip.ts KEEP_COMMENT: the comments a toolchain reads survive the strip.
const KEEP = /^!|__PURE__|__NO_SIDE_EFFECTS__|@license|@preserve|^[#@]\s*source(Mapping)?URL=/;
function strippableComments(js, sourceType) {
  const out = [];
  acorn.parse(js, {
    ecmaVersion: "latest",
    sourceType,
    onComment: (_block, text) => { if (!KEEP.test(text)) out.push(text); },
  });
  return out;
}

function build(moduleFormat, stripShippedJs) {
  const outDir = freshDir(`s461-${moduleFormat}-`);
  const r = compileScrml({
    inputFiles: scanDirectory(APP),
    outputDir: outDir,
    emitPerRoute: true,
    write: true,
    moduleFormat,
    stripShippedJs,
    log: () => {},
  });
  expect(r.errors.filter((e) => e.severity !== "warning")).toEqual([]);
  expect(r.chunks && r.chunks.size > 0).toBe(true);
  const written = [...r.chunks.values()].filter((c) => existsSync(join(outDir, c.filename)));
  expect(written.length).toBeGreaterThan(0);
  return { r, outDir, written };
}

describe("S461 §47.9.9 — esm per-route chunk: transform, then strip, then hash", () => {
  const esm = build("esm", true);

  test("every written esm chunk is an ES module with no strippable comment", () => {
    for (const c of esm.written) {
      const bytes = readFileSync(join(esm.outDir, c.filename), "utf8");
      expect(bytes).toContain("import{"); // the esm transform ran — and was stripped
      expect(bytes).not.toContain("--- runtime + cross-file imports (esm-chunks) ---");
      expect(strippableComments(bytes, "module")).toEqual([]);
    }
  });

  test("the strip is the last transform: re-stripping a shipped chunk changes nothing", () => {
    for (const c of esm.written) {
      const bytes = readFileSync(join(esm.outDir, c.filename), "utf8");
      expect(shipStrip(bytes).text).toBe(bytes);
    }
  });

  test("each chunk's filename hash names its shipped bytes", () => {
    for (const c of esm.r.chunks.values()) {
      const p = join(esm.outDir, c.filename);
      const shipped = existsSync(p) ? readFileSync(p, "utf8") : c.payloadJs;
      expect(shipped).toBe(c.payloadJs);
      const h = computeChunkHash(c, shipped);
      expect(c.chunkHash).toBe(h);
      expect(c.filename.endsWith(`.${h}.js`)).toBe(true);
    }
  });

  test("every chunk reference (chunks.json, activation script, HTML) names a file on disk", () => {
    const manifest = JSON.parse(readFileSync(join(esm.outDir, "chunks.json"), "utf8"));
    const urls = [];
    for (const roles of Object.values(manifest.entryPoints)) {
      for (const e of Object.values(roles)) if (e.initial) urls.push(e.initial);
    }
    const boot = readdirSync(esm.outDir).find((f) => /^scrml-chunks\..+\.js$/.test(f));
    expect(boot).toBeDefined();
    const bootJs = readFileSync(join(esm.outDir, boot), "utf8");
    const htmlRefs = readdirSync(esm.outDir)
      .filter((f) => f.endsWith(".html"))
      .flatMap((f) => [...readFileSync(join(esm.outDir, f), "utf8").matchAll(/"(\/[^"]+\.(?:initial|tier\w*)\.[0-9a-z]{8}\.js)"/g)].map((m) => m[1]));
    const bootRefs = [...bootJs.matchAll(/"(\/[^"]+\.(?:initial|tier\w*)\.[0-9a-z]{8}\.js)"/g)].map((m) => m[1]);
    expect(bootRefs.length).toBeGreaterThan(0);
    for (const u of [...urls, ...bootRefs, ...htmlRefs]) {
      expect(existsSync(join(esm.outDir, u.slice(1)))).toBe(true);
    }
    // The written initial chunk is referenced by its final (post-strip) name.
    for (const c of esm.written.filter((w) => w.tier === "initial")) {
      expect(bootRefs).toContain(`/${c.filename}`);
    }
  });

  test("classic chunks carry no esm transform and stay hash-consistent", () => {
    const classic = build("classic", true);
    for (const c of classic.written) {
      const bytes = readFileSync(join(classic.outDir, c.filename), "utf8");
      expect(bytes).not.toContain("import{");
      expect(strippableComments(bytes, "script")).toEqual([]);
      expect(computeChunkHash(c, bytes)).toBe(c.chunkHash);
    }
  });
});
