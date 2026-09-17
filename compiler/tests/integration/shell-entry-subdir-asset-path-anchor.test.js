/**
 * Shell entry in a subdir — every asset a composed route document references
 * RESOLVES ON DISK — g-uptoroot-vs-distrel-anchor-mismatch +
 * g-shell-subdir-asset-guard-pins-a-404-path.
 *
 * SPEC §40.8.2: "each route page's emitted document SHALL be the shell with that
 * route's body filled into the shell's route slot, so every route is a complete,
 * server-rendered, chrome-bearing document". A composed document whose shell
 * stylesheet / shell bundle 404s is not the shell.
 *
 * History. S400 fixed the CLIMB half (the composition `upToRoot` anchored on the
 * entry file's dir, so a root-level route emitted `../../app.css`, escaping dist).
 * That left the DESTINATION half: a shell entry at `shell/app.scrml` emits its
 * assets at `dist/shell/`, yet the composed `dist/x.html` referenced a bare
 * `app.css` / `app.client.js` — dist-ROOT siblings that do not exist. The guard
 * that landed with S400 asserted exactly those two strings (it pinned the 404).
 *
 * S419 fix: composition resolves every shell asset it references (stylesheet,
 * shell bundle, runtime) with ONE computation — the dist-relative path from the
 * composed document's dist dir to the asset's actual dist location — the model
 * `computeDependencyClientScripts` already used for the shell's dependencies.
 *
 * The guard is now an EXISTENCE check, not a string check: every `<link href>` /
 * `<script src>` in every composed document must name a file that exists
 * relative to that document. A string assertion is what certified the 404.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "shell-subdir-anchor-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Build a project (rel-path → source), return dist.
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
  expect((result.errors || []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
  return outDir;
}

// Every <link href> / <script src> in an emitted HTML document — the asset refs,
// not anchor hrefs (a nav `<a href>` is a route URL, not a file).
function assetRefs(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  return [...html.matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
}
const isLocal = (r) => !/^(?:[a-z]+:|\/\/|\/|#)/i.test(r);
// Refs that do NOT resolve to an existing file relative to the document.
function brokenRefs(dist, docRel) {
  const htmlPath = join(dist, docRel);
  return assetRefs(htmlPath)
    .filter(isLocal)
    .filter((r) => !existsSync(resolve(dirname(htmlPath), r)));
}

const shellSrc = (authRel) => `<program>
  import { rolePath } from '${authRel}'
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
const page = (h) => `<page>\n  <h1>${h}</h1>\n</page>\n`;

// Each layout: the source files, the shell's own document, and the composed route
// documents (dist-relative) whose every asset ref must resolve.
const LAYOUTS = [
  {
    name: "shell at the dist root (unchanged)",
    files: { "app.scrml": shellSrc("./models/auth.scrml"), "models/auth.scrml": AUTH,
      "pages/x.scrml": page("Route X"), "pages/deep/y.scrml": page("Route Y") },
    shellDoc: "app.html",
    composed: ["x.html", "deep/y.html"],
  },
  {
    name: "shell one level deep",
    files: { "shell/app.scrml": shellSrc("../models/auth.scrml"), "models/auth.scrml": AUTH,
      "pages/x.scrml": page("Route X"), "pages/deep/y.scrml": page("Route Y") },
    shellDoc: "shell/app.html",
    composed: ["x.html", "deep/y.html"],
  },
  {
    name: "shell two levels deep",
    files: { "a/b/app.scrml": shellSrc("../../models/auth.scrml"), "models/auth.scrml": AUTH,
      "pages/x.scrml": page("Route X"), "pages/deep/er/y.scrml": page("Route Y") },
    shellDoc: "a/b/app.html",
    composed: ["x.html", "deep/er/y.html"],
  },
];

describe("composed route documents reference shell assets that exist (g-uptoroot-vs-distrel-anchor-mismatch)", () => {
  for (const L of LAYOUTS) {
    test(`${L.name}: every asset ref in every composed route resolves on disk`, () => {
      const dist = build(L.name.replace(/\W+/g, "-"), L.files);
      for (const doc of L.composed) {
        expect(existsSync(join(dist, doc))).toBe(true);
        const refs = assetRefs(join(dist, doc));
        // The composed document carries the shell's stylesheet AND the shell bundle
        // (the shell chrome's reactive wiring lives there) — not merely "some refs".
        expect(refs.some((r) => r.endsWith("app.css"))).toBe(true);
        expect(refs.some((r) => r.endsWith("app.client.js"))).toBe(true);
        expect({ doc, broken: brokenRefs(dist, doc) }).toEqual({ doc, broken: [] });
      }
    });

    test(`${L.name}: the shell's OWN document resolves on disk too (control)`, () => {
      const dist = build(L.name.replace(/\W+/g, "-") + "-own", L.files);
      expect(brokenRefs(dist, L.shellDoc)).toEqual([]);
    });
  }

  // Byte-level pin for the layout that already worked: a shell at the dist root
  // must keep emitting exactly the refs it did before the S419 fix.
  test("shell at the dist root: composed refs are byte-identical to the pre-fix form", () => {
    const dist = build("root-pin", LAYOUTS[0].files);
    const strip = (refs) => refs.map((r) => r.replace(/scrml-runtime\.[a-z0-9]+\.js$/, "scrml-runtime.H.js"));
    expect(strip(assetRefs(join(dist, "x.html")))).toEqual([
      "app.css", "scrml-runtime.H.js", "models/auth.client.js", "app.client.js", "x.client.js",
    ]);
    expect(strip(assetRefs(join(dist, "deep", "y.html")))).toEqual([
      "../app.css", "../scrml-runtime.H.js", "../models/auth.client.js", "../app.client.js", "y.client.js",
    ]);
  });

  // The layout the gap was filed on, pinned by path so the destination is explicit.
  test("shell one level deep: composed refs point INTO dist/shell/", () => {
    const dist = build("subdir-pin", LAYOUTS[1].files);
    const refs = assetRefs(join(dist, "x.html"));
    expect(refs).toContain("shell/app.css");
    expect(refs).toContain("shell/app.client.js");
    const deep = assetRefs(join(dist, "deep", "y.html"));
    expect(deep).toContain("../shell/app.css");
    expect(deep).toContain("../shell/app.client.js");
  });
});
