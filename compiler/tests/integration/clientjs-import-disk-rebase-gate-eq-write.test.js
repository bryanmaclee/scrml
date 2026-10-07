/**
 * #1045 F1 — client JS gets relative-import re-basing, in BOTH the write phase
 * and the `validateEmit` gate phase, so the gated bytes are the written bytes.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT: every assertion here is (1) the
 * written specifier resolves ON DISK from the written file, and (2) the gated
 * bytes equal the written bytes. It does NOT prove the page works in a
 * browser. That browser half (S440 item 16: copy the helper into dist, and
 * load a classic page's importing bundles as modules) is pinned separately by
 * clientjs-helper-copy-into-dist.test.js; here a plain `.js` helper's
 * specifier is expected to name its dist copy, `_scrml_local/…`.
 *
 * Pre-fix: `api.js` passed `clientJs` through `rewriteStdlibImports` only, while
 * `toolJs` / `serverJs` / `libraryJs` each got `rewriteRelativeImportPaths`
 * first. A plain `.js` helper — or an `import:host` binding — used client-side
 * is emitted with its SOURCE-space specifier, so `<base>.client.js` named a
 * path resolved against the OUTPUT dir, where nothing exists. Valid JS, exit 0.
 *
 * The nearest sibling, bitten here too: under `--module-format=esm` a client
 * chunk's header imports the shared runtime by a `.js` specifier that is
 * already DIST-space. Re-basing it as if it were source-relative breaks every
 * esm page, so it must be left alone.
 *
 * And the gate-vs-write sibling: the gate phase used to rewrite stdlib imports
 * from the output ROOT rather than the file's own dist dir, so a nested
 * artifact's gated bytes differed from its written bytes.
 *
 * The gated bytes are observed by wrapping `validateEmittedArtifacts` (a
 * pass-through: validation behaviour is unchanged).
 */

import { describe, test, expect, mock, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";

const gated = [];
let capturing = false;
const realValidate = { ...(await import("../../src/codegen/validate-emit.ts")) };
mock.module("../../src/codegen/validate-emit.ts", () => ({
  ...realValidate,
  // Forward EVERY argument: `mock.module` is process-global under bun, so this
  // wrapper is what every later test file's compile calls too; an argument it
  // dropped would silently change the gate for the rest of the run (S457).
  validateEmittedArtifacts: (artifacts, ...rest) => {
    if (capturing) gated.push(...artifacts);
    return realValidate.validateEmittedArtifacts(artifacts, ...rest);
  },
}));
const { compileScrml } = await import("../../src/api.js");

const made = [];
afterAll(() => {
  capturing = false;
  for (const d of made) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "scrml-1045-f1-"));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/** Compile with write + gate on; returns { r, out, gated: [{artifact, contents}] }. */
function build(root, entries, outRel, opts = {}) {
  const out = join(root, outRel);
  gated.length = 0;
  capturing = true;
  let r;
  try {
    r = compileScrml({
      inputFiles: entries.map((e) => join(root, e)),
      write: true,
      outputDir: out,
      validateEmit: true,
      log: () => {},
      ...opts,
    });
  } finally {
    capturing = false;
  }
  return { r, out, gated: gated.slice() };
}

const fatal = (r) => (r.errors || []).map((e) => e.code).filter((c) => c && !/^[WI]-/.test(c));

/** Every written file under `dir` (absolute paths). */
function writtenFiles(dir) {
  const acc = [];
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else acc.push(p);
    }
  };
  walk(dir);
  return acc;
}

/** The relative static-import specifiers of an ES module text. */
function relativeImports(js) {
  return [...js.matchAll(/^\s*import\s[^"';]*?from\s*["']([^"']+)["']/gm)]
    .map((m) => m[1])
    .filter((s) => s.startsWith("./") || s.startsWith("../"));
}

/** The one written file whose path ends with `tail` (a POSIX suffix). */
function written(out, tailRe) {
  const hits = writtenFiles(out).filter((p) => tailRe.test(p.split("\\").join("/")));
  expect(hits.length).toBe(1);
  return hits[0];
}

/** The gated bytes for the artifact named `name` whose contents match the written file. */
function gatedFor(g, name) {
  return g.filter((a) => a.artifact === name).map((a) => a.contents);
}

function expectAllImportsResolve(file) {
  const js = readFileSync(file, "utf8");
  const specs = relativeImports(js);
  const dangling = specs.filter((s) => !existsSync(resolve(dirname(file), s)));
  expect(dangling).toEqual([]);
  return specs;
}

const SELF_HOST_TOML = '[capabilities]\nhost-import = "self-host-only"\n';

describe("#1045 F1 — client JS relative specifiers resolve on disk, and gated == written (NOT browser reachability)", () => {
  test("an import:host specifier in .client.js resolves on disk from the written file; gated == written", () => {
    // Source is two dirs deep, the output one — the source-space `../../host/m.ts`
    // overshoots the project root from `out/`.
    const root = project({
      "scrml.toml": SELF_HOST_TOML,
      "host/m.ts": 'export function tokenize(s: string) { return s.split(" ") }\n',
      "stdlib/compiler/page.scrml":
        'import:host { tokenize } from "../../host/m.ts"\n' +
        "<program>\n${ @n = 0 }\n" +
        '<button onclick=${@n = tokenize("a b").length}>go ${@n}</button>\n</program>\n',
    });
    const { r, out, gated: g } = build(root, ["stdlib/compiler/page.scrml"], "out");
    expect(fatal(r)).toEqual([]);
    const file = written(out, /\/out\/page\.client\.js$/);
    const specs = expectAllImportsResolve(file);
    expect(specs).toContain("../host/m.ts");
    expect(gatedFor(g, "page.client.js")).toEqual([readFileSync(file, "utf8")]);
  });

  test("a plain .js helper specifier resolves on disk (flat + nested pages, deeper output dir); gated == written", () => {
    const root = project({
      "scrml.toml": "",
      "vendor/util.js": "export function dbl(x) { return x * 2 }\n",
      "app/page.scrml":
        'import { dbl } from "../vendor/util.js"\n' +
        "<program>\n${ @n = 1 }\n<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n",
      "app/sub/deep.scrml":
        'import { dbl } from "../../vendor/util.js"\n' +
        "<program>\n${ @n = 1 }\n<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n",
    });
    const { r, out, gated: g } = build(root, ["app/page.scrml", "app/sub/deep.scrml"], "build/dist");
    expect(fatal(r)).toEqual([]);
    const top = written(out, /\/build\/dist\/page\.client\.js$/);
    const deep = written(out, /\/build\/dist\/sub\/deep\.client\.js$/);
    // S440 item 16 — the specifier now names the dist COPY (one file for both pages).
    expect(expectAllImportsResolve(top)).toEqual(["./_scrml_local/vendor/util.js"]);
    expect(expectAllImportsResolve(deep)).toEqual(["../_scrml_local/vendor/util.js"]);
    expect(gatedFor(g, "page.client.js")).toEqual([readFileSync(top, "utf8")]);
    expect(gatedFor(g, "deep.client.js")).toEqual([readFileSync(deep, "utf8")]);
  });

  test("esm: the dist-space runtime specifier is NOT re-based; the helper specifier resolves on disk; gated == written", () => {
    const root = project({
      "scrml.toml": "",
      "vendor/util.js": "export function dbl(x) { return x * 2 }\n",
      "app/page.scrml":
        'import { dbl } from "../vendor/util.js"\n' +
        "<program>\n${ @n = 1 }\n<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n",
      "app/sub/deep.scrml":
        'import { dbl } from "../../vendor/util.js"\n' +
        "<program>\n${ @n = 1 }\n<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n",
    });
    const { r, out, gated: g } = build(root, ["app/page.scrml", "app/sub/deep.scrml"], "build/dist", { moduleFormat: "esm" });
    expect(fatal(r)).toEqual([]);
    const top = written(out, /\/build\/dist\/page\.client\.js$/);
    const deep = written(out, /\/build\/dist\/sub\/deep\.client\.js$/);
    const topSpecs = expectAllImportsResolve(top);
    const deepSpecs = expectAllImportsResolve(deep);
    expect(topSpecs.some((s) => /^\.\/scrml-runtime\.[0-9a-z]+\.js$/.test(s))).toBe(true);
    expect(deepSpecs.some((s) => /^\.\.\/scrml-runtime\.[0-9a-z]+\.js$/.test(s))).toBe(true);
    expect(topSpecs).toContain("./_scrml_local/vendor/util.js");
    expect(deepSpecs).toContain("../_scrml_local/vendor/util.js");
    expect(gatedFor(g, "page.client.js")).toEqual([readFileSync(top, "utf8")]);
    expect(gatedFor(g, "deep.client.js")).toEqual([readFileSync(deep, "utf8")]);
  });

  test("content-hashed client bundles carry the on-disk re-based specifier too", () => {
    const root = project({
      "scrml.toml": "",
      "vendor/util.js": "export function dbl(x) { return x * 2 }\n",
      "app/sub/deep.scrml":
        'import { dbl } from "../../vendor/util.js"\n' +
        "<program>\n${ @n = 1 }\n<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n",
      "app/page.scrml": "<program><p>hi</p></program>\n",
    });
    const { r, out } = build(root, ["app/page.scrml", "app/sub/deep.scrml"], "build/dist", { contentHashAssets: true });
    expect(fatal(r)).toEqual([]);
    const deep = written(out, /\/build\/dist\/sub\/deep\.client\.[0-9a-z]+\.js$/);
    expect(expectAllImportsResolve(deep)).toEqual(["../_scrml_local/vendor/util.js"]);
  });

  test("gate sibling: a nested library artifact's stdlib import is gated as written", () => {
    const root = project({
      "lib/top.scrml": 'import { round } from "scrml:math"\nexport fn r(x) { return round(x) }\n',
      "lib/sub/m.scrml": 'import { round } from "scrml:math"\nexport fn r2(x) { return round(x) }\n',
    });
    const { r, out, gated: g } = build(root, ["lib/top.scrml", "lib/sub/m.scrml"], "dist", { mode: "library" });
    expect(fatal(r)).toEqual([]);
    const m = written(out, /\/dist\/sub\/m\.js$/);
    expect(expectAllImportsResolve(m)).toContain("../_scrml/math.js");
    expect(gatedFor(g, "m.js")).toEqual([readFileSync(m, "utf8")]);
  });
});
