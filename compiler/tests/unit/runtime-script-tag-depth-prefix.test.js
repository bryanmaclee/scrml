/**
 * runtime-script-tag-depth-prefix.test.js
 *
 * Pins g-runtime-script-tag-not-depth-prefixed (HIGH). The shared runtime is
 * written ONCE at the dist root (`dist/scrml-runtime.<hash>.js`), so a NESTED
 * page's runtime `<script src>` must reach it with a `../`-per-subdir prefix.
 *
 * The regression: the OWN-DOCUMENT (non-composed) HTML emit path
 * (`codegen/index.ts`, the doc-envelope `docParts.push(<script src=…>)`) pushed
 * the BARE runtime filename, and the hashed-filename post-pass is a plain string
 * replace that cannot add a prefix. A nested shell-less page therefore emitted
 * `<script src="scrml-runtime.<hash>.js">` while the file lived at
 * `dist/a/b/deep.html` — a 404 on the runtime, so the page booted DOA with ZERO
 * diagnostics. (Depth-0 pages are correct bare and must STAY bare.)
 *
 * Two surfaces, two guards:
 *   §A own-document (shell-less) nested page — the DOA class. Must gain `../../`.
 *   §B composed (shell + nested page) — already correct pre-fix; the fix must NOT
 *      double-prefix it (the composition re-add applies its own `upToRoot`, so a
 *      prefix baked in by the own-document path must not stack → `../../../../`).
 *
 * Assertion style mirrors esm-script-tag-module-format.test.js: in-process
 * compile (`write:false`), read `r.outputs` (filePath → html), match by basename
 * (output keys are OS-native paths, so `/`-anchored suffixes miss on Windows).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { compileScrml } from "../../src/api.js";

const tmpDirs = [];
function freshDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function w(dir, rel, content) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// The runtime `<script src>` of an emitted HTML, matched by basename over the
// compiler's output map (OS-native keys).
function runtimeSrc(outputs, base) {
  for (const [fp, out] of outputs) {
    if (basename(fp) === base && out.html) {
      const m = out.html.match(/<script[^>]*\ssrc="([^"]*scrml-runtime[^"]*)"/);
      if (m) return m[1];
      throw new Error(`no runtime <script src> in ${base}`);
    }
  }
  throw new Error(`no HTML output for ${base}`);
}

// Static leaf pages still ship a client.js + a runtime <script>, so a bare
// `<page><h1>` is enough to exercise the runtime-tag emit path.
const PAGE = (label) => `<page>\n  <h1>${label}</h1>\n</page>\n`;

describe("§A own-document (shell-less) nested page — the DOA class", () => {
  test("nested page runtime src is prefixed to the dist root; depth-0 stays bare", async () => {
    const dir = freshDir("scrml-rt-prefix-shellless-");
    const top = w(dir, "pages/top.scrml", PAGE("top"));
    const deep = w(dir, "pages/a/b/deep.scrml", PAGE("deep"));
    const r = await compileScrml({
      inputFiles: [top, deep],
      outputDir: join(dir, "dist"),
      outputBaseDir: join(dir, "pages"),
      write: false,
      log: () => {},
    });
    expect(r.errors.length).toBe(0);

    const deepSrc = runtimeSrc(r.outputs, "deep.scrml");
    const topSrc = runtimeSrc(r.outputs, "top.scrml");

    // depth-2 page (dist/a/b/deep.html) → exactly two `../`.
    expect(deepSrc).toMatch(/^\.\.\/\.\.\/scrml-runtime\.[0-9a-z]+\.js$/);
    // depth-0 page (dist/top.html) → bare, no prefix (and same hash).
    expect(topSrc).toMatch(/^scrml-runtime\.[0-9a-z]+\.js$/);
    // Same shared runtime → prefix is the only difference.
    expect(deepSrc).toBe(`../../${topSrc}`);
  });
});

describe("§B composed (shell + nested page) — no-double-prefix guard", () => {
  test("composed nested page keeps EXACTLY ONE dist-root prefix", async () => {
    const dir = freshDir("scrml-rt-prefix-composed-");
    // A minimal shell: the bare `<main>` slot is the composition outlet.
    const app = w(dir, "app.scrml", `<program>\n  <header><nav>nav</nav></header>\n  <main></main>\n</program>\n`);
    const index = w(dir, "pages/index.scrml", PAGE("home"));
    const deep = w(dir, "pages/a/b/deep.scrml", PAGE("deep"));
    const r = await compileScrml({
      inputFiles: [app, index, deep],
      outputDir: join(dir, "dist"),
      outputBaseDir: dir,
      write: false,
      log: () => {},
    });
    expect(r.errors.length).toBe(0);

    const deepSrc = runtimeSrc(r.outputs, "deep.scrml");
    const indexSrc = runtimeSrc(r.outputs, "index.scrml");

    // Exactly two `../` — NOT `../../../../` (the double-prefix regression).
    expect(deepSrc).toMatch(/^\.\.\/\.\.\/scrml-runtime\.[0-9a-z]+\.js$/);
    expect(deepSrc).not.toMatch(/(\.\.\/){3}/);
    // depth-0 composed page stays bare.
    expect(indexSrc).toMatch(/^scrml-runtime\.[0-9a-z]+\.js$/);
    expect(deepSrc).toBe(`../../${indexSrc}`);
  });
});
