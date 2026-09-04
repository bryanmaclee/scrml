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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
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
    // The shell's own assets are reachable from the dist-root route (same dir).
    expect(refs).toContain("app.css");
    expect(refs).toContain("app.client.js");
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
