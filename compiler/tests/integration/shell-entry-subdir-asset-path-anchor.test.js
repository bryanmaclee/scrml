/**
 * Shell entry in a subdir — composed-route asset paths stay inside dist —
 * g-uptoroot-vs-distrel-anchor-mismatch.
 *
 * Filed S280 (S239 finder B), MED. Fixed S400-peter.
 *
 * Symptom (before fix): the per-page COMPOSITION `upToRoot` (index.ts) anchored on
 * `relative(dirname(entryFilePath), dirname(filePath))` — the ENTRY file's dir —
 * while the real dist layout (`toDistRel` / `pathFor` / the own-document
 * `ownUpToRoot`) anchors on `relative(cgOutputBaseDir, …)`. The two coincide only
 * when the entry sits at the base or base/pages. A shell entry in some OTHER
 * subdir (`shell/app.scrml`) made a ROOT-LEVEL route (`pages/x.scrml` → dist
 * `x.html`) emit the shell's assets as `../../app.css` / `../../app.client.js` /
 * `../../scrml-runtime…` — escaping the dist root, so the route loaded none of the
 * shell's CSS/JS/runtime. The fix anchors the composition depth on the dist layout.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "shell-subdir-anchor-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Build a project (rel-path → source) with the shell entry in a subdir, return dist.
function build(name, files) {
  const root = join(TMP, name);
  mkdirSync(root, { recursive: true });
  const inputs = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
    inputs.push(abs);
  }
  const outDir = join(root, "dist");
  const result = compileScrml({ inputFiles: inputs, write: true, outputDir: outDir, log: () => {} });
  expect((result.errors || []).map(e => e.code)).toEqual([]);
  return outDir;
}

// All src=/href= asset refs in an emitted HTML file.
function assetRefs(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
}
// A ref escapes the dist root if it climbs two-or-more `..` segments (from a
// dist-root-level document, one `..` already leaves dist).
function escapesDist(ref) {
  return ref.split("/").filter(s => s === "..").length >= 2;
}

const SHELL = `<program>
  import { rolePath } from '../models/auth.scrml'
  <role> = "admin"
  <h1>Shell</h1>
  <nav><a href="\${rolePath(@role)}">Dash</a></nav>
  <outlet/>
</program>
`;
const AUTH = `export function rolePath(role: string) -> string {
  match role {
    "admin" :> "/admin"
    _       :> "/patron"
  }
}
`;

describe("shell entry in a subdir — composed-route asset paths stay inside dist (g-uptoroot-vs-distrel-anchor-mismatch)", () => {
  test("a root-level route references the shell's assets without escaping the dist root", () => {
    const dist = build("subdir", {
      "shell/app.scrml": SHELL,
      "models/auth.scrml": AUTH,
      "pages/x.scrml": `<page>\n  <h1>Route X</h1>\n</page>\n`,
    });
    // pages/x → dist/x.html (the `pages/` strip puts it at the dist root).
    const refs = assetRefs(join(dist, "x.html"));
    expect(refs.length).toBeGreaterThan(0);
    const escaping = refs.filter(escapesDist);
    expect(escaping).toEqual([]);
    // ⚑ S410 — these two assertions are PINNING A 404, and the comment they used to
    // carry ("the shell's own assets are reachable from the dist-root route (same
    // dir)") was simply false. The shell's assets emit at `dist/shell/`, so a bare
    // `app.css` / `app.client.js` reference from `dist/x.html` resolves to
    // `dist/app.css` — which does not exist. Measured on HEAD:
    //     emitted: shell/app.css, shell/app.client.js, shell/app.html,
    //              x.html, x.client.js, models/auth.client.js, scrml-runtime.*.js
    //     dist/app.css       -> 404
    //     dist/app.client.js -> 404
    // The refs ARE emitted, so these two lines pass; they are kept because they still
    // pin the emitted SHAPE, but they no longer pretend the shape is correct.
    // g-shell-subdir-asset-guard-pins-a-404-path.
    expect(refs).toContain("app.css");
    expect(refs).toContain("app.client.js");
  });

  // ⚑ The honest assertion, marked `failing` so the gate stays green while the bug is
  // recorded as a bug rather than as a passing test. `test.failing` INVERTS: it passes
  // while the body throws, and it FAILS THE SUITE the moment the body starts passing —
  // so whoever fixes the emitter is told to flip this to a plain `test`, and the fix
  // cannot land silently. A green `test` asserting a 404 was the worse of the two.
  test.failing("every asset ref in a composed route resolves on disk (g-uptoroot-vs-distrel-anchor-mismatch)", () => {
    const dist = build("subdir-resolve", {
      "shell/app.scrml": SHELL,
      "models/auth.scrml": AUTH,
      "pages/x.scrml": `<page>\n  <h1>Route X</h1>\n</page>\n`,
    });
    const refs = assetRefs(join(dist, "x.html"));
    const local = refs.filter((r) => !/^(https?:|\/\/|#|mailto:|_scrml_attr_tpl)/.test(r));
    const broken = local.filter((r) => !existsSync(join(dist, r)));
    expect(broken).toEqual([]);
  });

  test("the shell's OWN document is unaffected (own-document path already correct)", () => {
    const dist = build("subdir-own", {
      "shell/app.scrml": SHELL,
      "models/auth.scrml": AUTH,
      "pages/x.scrml": `<page>\n  <h1>Route X</h1>\n</page>\n`,
    });
    // dist/shell/app.html references its sibling app.css + a `../` runtime — one
    // `..` is correct (it sits one level below dist), never two.
    const refs = assetRefs(join(dist, "shell", "app.html"));
    expect(refs.filter(escapesDist)).toEqual([]);
    expect(refs).toContain("app.css");
  });
});
