/**
 * S440 item 16 (bryan RULED: copy, not a diagnostic) — the BROWSER half of
 * g-clientjs-skips-relative-import-rebasing-so-a-host-import-dangles.
 *
 * #1113 re-based a client bundle's plain-`.js` helper specifier so it resolved
 * ON DISK — back into the source tree, which a browser served from dist cannot
 * reach (esm: 404), and in the default classic format the bundle's top-level
 * `import` was a SyntaxError as a classic <script> whatever the specifier.
 *
 * Now: the helper (and its transitive relative imports) is copied to
 * `<dist>/_scrml_local/<project-root-relative path>`, the specifier names the
 * copy, the §47.13 manifest admits it through the import closure, and a classic
 * page whose bundles carry an ES import loads its bundle tags as modules.
 * Fail-closed: a helper outside the project root, in a §47.13 denied class, or
 * missing is a compile error and nothing is copied.
 *
 * Verified in a real browser (headless Chrome over CDP) while building this —
 * these tests pin the emitted shape that run depended on.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { tmpdir, platform } from "os";
import { join, dirname, resolve } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { spawnSync } from "child_process";

const made = [];
afterAll(() => {
  for (const d of made) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "scrml-s440-16-"));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function build(root, entries, opts = {}) {
  const out = join(root, "dist");
  const r = compileScrml({
    inputFiles: entries.map((e) => join(root, e)),
    write: true,
    outputDir: out,
    validateEmit: true,
    log: () => {},
    ...opts,
  });
  return { r, out };
}

const fatal = (r) => (r.errors || []).map((e) => e.code).filter((c) => c && !/^[WI]-/.test(c));

function files(dir) {
  const acc = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else acc.push(p);
    }
  };
  walk(dir);
  return acc.map((p) => p.slice(dir.length + 1).split("\\").join("/")).sort();
}

/** Relative module specifiers (static, export-from) of a JS text. */
function relSpecs(js) {
  return [...js.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith("./") || s.startsWith("../"));
}

/** Every relative specifier of `rel` resolves to a file INSIDE `out`. */
function expectResolvesInDist(out, rel) {
  const file = join(out, rel);
  const specs = relSpecs(readFileSync(file, "utf8"));
  for (const s of specs) {
    expect(s.includes("\\")).toBe(false); // Windows: emitted specifiers are POSIX
    const target = resolve(dirname(file), s);
    expect(target.startsWith(resolve(out))).toBe(true);
    expect(existsSync(target)).toBe(true);
  }
  return specs;
}

const manifest = (out) => JSON.parse(readFileSync(join(out, ".scrml-client-assets.json"), "utf8")).clientAssets;
const page = (imports, expr) =>
  `${imports}\n<program>\n<n> = 1\n<button onclick=\${@n = ${expr}}>go \${@n}</button>\n</program>\n`;
const scripts = (html) => [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]);

const HELPERS = {
  "scrml.toml": "",
  "lib/x.js": 'import { inc } from "./inner/y.js";\nexport function dbl(x) { return inc(x * 2) - 1 }\nexport const lazy = () => import("./lazy.js");\n',
  "lib/lazy.js": "export const L = 1;\n",
  "lib/inner/y.js": 'export { three } from "../z.mjs";\nexport function inc(x) { return x + 1 }\n',
  "lib/z.mjs": "export const three = 3;\n",
  "lib/srv.js": "export function secretSum(a, b) { return a + b + 1000 }\n",
};

describe("S440 item 16 — client-reachable plain-JS helpers are copied into dist", () => {
  test("parent-dir helper + transitive imports (import, export-from, .mjs, dynamic) land in _scrml_local, byte-identical", () => {
    const root = project({
      ...HELPERS,
      "app/a.scrml": page('import { dbl } from "../lib/x.js"\nimport { three } from "../lib/inner/y.js"', "dbl(@n) + three - 3"),
    });
    const { r, out } = build(root, ["app/a.scrml"]);
    expect(fatal(r)).toEqual([]);
    expect(expectResolvesInDist(out, "a.client.js")).toEqual(["./_scrml_local/lib/x.js", "./_scrml_local/lib/inner/y.js"]);
    for (const rel of ["lib/x.js", "lib/inner/y.js", "lib/z.mjs", "lib/lazy.js"]) {
      expect(readFileSync(join(out, "_scrml_local", rel), "utf8")).toBe(HELPERS[rel]);
      expect(manifest(out)).toContain(`_scrml_local/${rel}`);
    }
    expectResolvesInDist(out, "_scrml_local/lib/x.js");
    expectResolvesInDist(out, "_scrml_local/lib/inner/y.js");
  });

  test("one helper imported by two pages (one nested) is ONE copy; a server-only helper is NOT copied", () => {
    const root = project({
      ...HELPERS,
      "app/a.scrml": page('import { dbl } from "../lib/x.js"', "dbl(@n)"),
      "app/sub/b.scrml":
        'import { dbl } from "../../lib/x.js"\nimport { secretSum } from "../../lib/srv.js"\n' +
        "<program>\n<n> = 1\nserver function total(a, b) { return secretSum(a, b) }\n" +
        "<button onclick=${@n = dbl(@n)}>go ${@n}</button>\n</program>\n",
    });
    const { r, out } = build(root, ["app/a.scrml", "app/sub/b.scrml"]);
    expect(fatal(r)).toEqual([]);
    expect(expectResolvesInDist(out, "a.client.js")).toEqual(["./_scrml_local/lib/x.js"]);
    expect(expectResolvesInDist(out, "sub/b.client.js")).toEqual(["../_scrml_local/lib/x.js"]);
    const local = files(out).filter((f) => f.startsWith("_scrml_local/"));
    expect(local).toEqual(["_scrml_local/lib/inner/y.js", "_scrml_local/lib/lazy.js", "_scrml_local/lib/x.js", "_scrml_local/lib/z.mjs"]);
    expect(files(out).some((f) => f.endsWith("srv.js"))).toBe(false);
    expect(manifest(out).some((f) => f.endsWith("srv.js"))).toBe(false);
  });

  test("classic: a page whose bundle imports a helper loads its bundle tags as modules; a page without one is unchanged", () => {
    const root = project({
      ...HELPERS,
      "app/a.scrml": page('import { dbl } from "../lib/x.js"', "dbl(@n)"),
      "app/plain.scrml": page("", "@n + 1"),
    });
    const { r, out } = build(root, ["app/a.scrml", "app/plain.scrml"]);
    expect(fatal(r)).toEqual([]);
    const a = scripts(readFileSync(join(out, "a.html"), "utf8"));
    expect(a.some((t) => /^<script src="scrml-runtime\.[0-9a-z]+\.js">$/.test(t))).toBe(true); // runtime stays classic
    expect(a).toContain('<script type="module" src="a.client.js">');
    const plain = scripts(readFileSync(join(out, "plain.html"), "utf8"));
    expect(plain).toContain('<script src="plain.client.js">');
    expect(plain.some((t) => t.includes("type=\"module\""))).toBe(false);
  });

  test("classic: a .scrml DEPENDENCY that imports a helper flips the page's own bundle too (module order = document order)", () => {
    const root = project({
      "scrml.toml": "",
      "lib/w.js": "export function dbl(x) { return x * 2 }\n",
      "app/shared.scrml": '${\nimport { dbl } from "../lib/w.js"\nexport function twice(x) { return dbl(x) }\n}\n',
      "app/page.scrml": page('import { twice } from "./shared.scrml"', "twice(@n)"),
    });
    const { r, out } = build(root, ["app/page.scrml"]);
    expect(fatal(r)).toEqual([]);
    const tags = scripts(readFileSync(join(out, "page.html"), "utf8"));
    expect(tags).toContain('<script type="module" src="shared.client.js">');
    expect(tags).toContain('<script type="module" src="page.client.js">');
    expect(tags.indexOf('<script type="module" src="shared.client.js">'))
      .toBeLessThan(tags.indexOf('<script type="module" src="page.client.js">'));
    expectResolvesInDist(out, "shared.client.js");
  });

  test("content-hash + --emit-per-route (classic and esm): the hashed bundle's helper specifier resolves into dist", () => {
    for (const moduleFormat of ["classic", "esm"]) {
      const root = project({ ...HELPERS, "app/a.scrml": page('import { dbl } from "../lib/x.js"', "dbl(@n)") });
      const { r, out } = build(root, ["app/a.scrml"], { contentHashAssets: true, emitPerRoute: true, moduleFormat });
      expect(fatal(r)).toEqual([]);
      const bundle = files(out).find((f) => /^a\.client\.[0-9a-z]+\.js$/.test(f));
      expect(bundle).toBeDefined();
      expect(expectResolvesInDist(out, bundle)).toContain("./_scrml_local/lib/x.js");
      expect(scripts(readFileSync(join(out, "a.html"), "utf8"))).toContain(`<script type="module" src="${bundle}">`);
      expect(manifest(out)).toContain("_scrml_local/lib/x.js");
    }
  });
});

describe("S440 item 16 fix round — the manifest is seeded from the copy set (review F2)", () => {
  // The §47.13 closure's text scan wants whitespace around `from`; a minified or
  // oddly-wrapped helper's dep used to be COPIED but left out of the manifest, so
  // the server 404'd it and the page died with exit 0.
  const shapes = {
    "minified named import": 'import{t as q}from"./dep.js";export function dbl(x){return q(x)}\n',
    "minified export-star": 'export*from"./dep.js";\nexport function dbl(x){return x*2}\n',
    "import split across lines": 'import \n{ t }\nfrom\n"./dep.js"\nexport function dbl(x){return t(x)}\n',
  };
  for (const [name, minJs] of Object.entries(shapes)) {
    test(`${name}: every copied helper is in the client-asset manifest`, () => {
      const root = project({
        "scrml.toml": "",
        "lib/min.js": minJs,
        "lib/dep.js": "export function t(x){return x*2}\n",
        "app/page.scrml": page('import { dbl } from "../lib/min.js"', "dbl(@n)"),
      });
      const { r, out } = build(root, ["app/page.scrml"]);
      expect(fatal(r)).toEqual([]);
      const local = files(out).filter((f) => f.startsWith("_scrml_local/"));
      expect(local).toEqual(["_scrml_local/lib/dep.js", "_scrml_local/lib/min.js"]);
      for (const f of local) expect(manifest(out)).toContain(f);
    });
  }
});

describe("S440 item 16 fix round — Windows 8.3 short names cannot slip the denied class (review F1)", () => {
  /** The 8.3 short name of `abs`, or null when the volume does not generate them. */
  function shortNameOf(abs) {
    if (platform() !== "win32") return null;
    const r = spawnSync("cmd", ["/c", "dir", "/x", dirname(abs)], { encoding: "utf8" });
    const want = abs.split(/[\\/]/).pop();
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      const m = line.match(/\s(\S+~\d\S*)\s+(\S+)\s*$/);
      if (m && m[2] === want) return m[1];
    }
    return null;
  }
  for (const [label, file] of [["a *.server.js helper", "lib/secret.server.js"], ["a dot-file helper", "lib/.secrets.js"]]) {
    // SKIPS (passes vacuously, logging why) off Windows or on a volume with 8.3
    // name generation disabled — there is then no short alias to import by.
    test(`${label} imported by its 8.3 short name -> E-IMPORT-011, nothing copied`, () => {
      const root = project({ "scrml.toml": "", [file]: "export function dbl(x){return x*2} // SECRET\n" });
      const short = shortNameOf(join(root, file));
      if (!short) {
        console.log(`[skip] no 8.3 short name for ${file} on this volume/platform — F1 cannot arise here`);
        return;
      }
      mkdirSync(join(root, "app"), { recursive: true });
      writeFileSync(join(root, "app", "page.scrml"), page(`import { dbl } from "../lib/${short.toLowerCase()}"`, "dbl(@n)"));
      const { r, out } = build(root, ["app/page.scrml"]);
      expect(fatal(r)).toContain("E-IMPORT-011");
      expect(files(out).some((f) => f.startsWith("_scrml_local/"))).toBe(false);
    }, 30000); // a real `cmd /c dir /x` spawn + a compile: 5 s timed out under co-run load (S450)
  }
});

describe("S440 item 16 — fail-closed: nothing outside the project, nothing unservable, nothing missing", () => {
  const noCopies = (out) => expect(files(out).some((f) => f.startsWith("_scrml_local/"))).toBe(false);

  test("a helper outside the project root -> E-IMPORT-011, nothing copied", () => {
    const root = project({
      "outside.js": "export function dbl(x) { return x * 2 }\n",
      "proj/scrml.toml": "",
      "proj/app/page.scrml": page('import { dbl } from "../../outside.js"', "dbl(@n)"),
    });
    const { r, out } = build(join(root, "proj"), ["app/page.scrml"]);
    expect(fatal(r)).toContain("E-IMPORT-011");
    noCopies(out);
  });

  test("with no project marker the build's source root is the boundary (a sibling lib/ is outside it)", () => {
    const root = project({
      "lib/w.js": "export function dbl(x) { return x * 2 }\n",
      "app/page.scrml": page('import { dbl } from "../lib/w.js"', "dbl(@n)"),
    });
    const { r, out } = build(root, ["app/page.scrml"]);
    expect(fatal(r)).toContain("E-IMPORT-011");
    noCopies(out);
  });

  test("a helper whose TRANSITIVE import escapes the root -> E-IMPORT-011, and NO helper is copied", () => {
    const root = project({
      "evil.js": "export const E = 1;\n",
      "proj/scrml.toml": "",
      "proj/lib/t.js": 'export { E } from "../../evil.js";\nexport function dbl(x) { return x * 2 }\n',
      "proj/app/page.scrml": page('import { dbl, E } from "../lib/t.js"', "dbl(@n) + E"),
    });
    const { r, out } = build(join(root, "proj"), ["app/page.scrml"]);
    expect(fatal(r)).toContain("E-IMPORT-011");
    noCopies(out);
  });

  test("a helper whose dist path is a §47.13 denied class (dot-directory) -> E-IMPORT-011", () => {
    const root = project({
      "scrml.toml": "",
      "lib/.hidden/h.js": "export function dbl(x) { return x * 2 }\n",
      "app/page.scrml": page('import { dbl } from "../lib/.hidden/h.js"', "dbl(@n)"),
    });
    const { r, out } = build(root, ["app/page.scrml"]);
    expect(fatal(r)).toContain("E-IMPORT-011");
    noCopies(out);
  });

  test("a missing client helper -> E-IMPORT-006 (it used to compile clean and 404)", () => {
    const root = project({
      "scrml.toml": "",
      "app/page.scrml": page('import { dbl } from "./nope.js"', "dbl(@n)"),
    });
    const { r } = build(root, ["app/page.scrml"]);
    expect(fatal(r)).toContain("E-IMPORT-006");
  });
});
