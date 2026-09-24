/**
 * `import:host` — SPEC §21.3.1 + the §22.13 `[capabilities] host-import`
 * manifest entry (change-id s430-import-host).
 *
 * Pre-fix: `import:host { tokenize } from "./tok.js"` compiled at exit 0 with
 * zero diagnostics and the declaration rendered VERBATIM as page text in the
 * emitted `<body>` (gap g-import-host-is-unimplemented-and-renders-as-page-text).
 *
 * Every case runs through BOTH front-ends (the live block-splitter + TAB path
 * and `--parser=scrml-native`), since §22.13 names both ("The block-splitter /
 * native parser SHALL consult the entry").
 *
 * Fixtures live under the OS temp dir, NOT the repo: the manifest lookup stops
 * at a `.git` project boundary, so a fixture inside the checkout would be
 * governed by the checkout's (absent) manifest instead of its own.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";
import {
  readHostImportCapability,
  parseHostImportEntry,
  isHostImportPermitted,
  scanHostModule,
} from "../../src/host-import.js";

const PARSERS = [null, "scrml-native"];
const made = [];

afterAll(() => {
  for (const d of made) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

/** Write `files` (relPath -> content) under a fresh temp project root. */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), "scrml-import-host-"));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function compile(root, entry, { parser = null, mode = undefined, write = false } = {}) {
  return compileScrml({
    inputFiles: [join(root, entry)],
    write,
    outputDir: join(root, "out"),
    log: () => {},
    ...(mode ? { mode } : {}),
    ...(parser ? { parser } : {}),
  });
}

const errorCodes = (r) => (r.errors || []).map((e) => e.code).filter(Boolean);
const count = (r, code) => errorCodes(r).filter((c) => c === code).length;

const SELF_HOST_TOML = '[capabilities]\nhost-import = "self-host-only"\n';
const HOST_JS = 'export function tokenize(s) { return s.split(" ") }\nexport const VERSION = "1"\n';

// ---------------------------------------------------------------------------
// Manifest reader (§22.13)
// ---------------------------------------------------------------------------

describe("§22.13 manifest — [capabilities] host-import", () => {
  test("absent manifest => disabled", () => {
    const root = project({ "a.scrml": "" });
    const cap = readHostImportCapability(join(root, "a.scrml"));
    expect(cap.value).toBe("disabled");
    expect(cap.manifestPath).toBe(null);
  });

  test("manifest without [capabilities] => disabled", () => {
    const root = project({ "scrml.toml": '[language]\nversion = "1.0"\n', "a.scrml": "" });
    expect(readHostImportCapability(join(root, "a.scrml")).value).toBe("disabled");
  });

  test("self-host-only is read; nearest manifest wins", () => {
    const root = project({ "scrml.toml": SELF_HOST_TOML, "stdlib/compiler/a.scrml": "" });
    const cap = readHostImportCapability(join(root, "stdlib/compiler/a.scrml"));
    expect(cap.value).toBe("self-host-only");
    expect(cap.projectRoot).toBe(root);
  });

  test("the walk stops at a .git project boundary", () => {
    const root = project({
      "scrml.toml": SELF_HOST_TOML,
      "inner/.git": "gitdir: elsewhere\n",
      "inner/stdlib/compiler/a.scrml": "",
    });
    const cap = readHostImportCapability(join(root, "inner/stdlib/compiler/a.scrml"));
    expect(cap.value).toBe("disabled");
    expect(cap.manifestPath).toBe(null);
  });

  test("an unrecognised value is E-MANIFEST-001 and fails closed", () => {
    const root = project({ "scrml.toml": '[capabilities]\nhost-import = "everywhere"\n' });
    const entry = parseHostImportEntry(join(root, "scrml.toml"));
    expect(entry.value).toBe("disabled");
    expect(entry.error && entry.error.code).toBe("E-MANIFEST-001");
  });

  test("unparseable TOML fails closed without a manifest error", () => {
    const root = project({ "scrml.toml": "[[[not toml\n" });
    const entry = parseHostImportEntry(join(root, "scrml.toml"));
    expect(entry.value).toBe("disabled");
    expect(entry.error).toBe(null);
    expect(typeof entry.note).toBe("string");
  });

  test("self-host-only admits stdlib/compiler/** only (relative to the manifest dir)", () => {
    const root = project({ "scrml.toml": SELF_HOST_TOML });
    const cap = readHostImportCapability(join(root, "x.scrml"));
    expect(isHostImportPermitted(join(root, "stdlib/compiler/cg.scrml"), cap)).toBe(true);
    expect(isHostImportPermitted(join(root, "stdlib/compiler/deep/x.scrml"), cap)).toBe(true);
    expect(isHostImportPermitted(join(root, "stdlib/other/x.scrml"), cap)).toBe(false);
    expect(isHostImportPermitted(join(root, "src/stdlib/compiler/x.scrml"), cap)).toBe(false);
    expect(isHostImportPermitted(join(root, "app.scrml"), cap)).toBe(false);
  });

  test("E-MANIFEST-001 surfaces through compileScrml, once per manifest", () => {
    const root = project({
      "scrml.toml": '[capabilities]\nhost-import = true\n',
      "a.scrml": "<program><p>hi</p></program>\n",
    });
    const r = compile(root, "a.scrml");
    expect(count(r, "E-MANIFEST-001")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Host-module record (never evaluated)
// ---------------------------------------------------------------------------

describe("§21.3.1 host-module scan", () => {
  test("named exports are extracted without evaluating the module", () => {
    const root = project({
      "h.ts": 'globalThis.__scrmlHostEvaluated = true;\nexport const a: number = 1;\nexport function b() {}\nimport { z } from "./z.scrml";\n',
    });
    delete globalThis.__scrmlHostEvaluated;
    const rec = scanHostModule(join(root, "h.ts"));
    expect(rec.ok).toBe(true);
    expect([...rec.exports].sort()).toEqual(["a", "b"]);
    expect(rec.imports).toEqual(["./z.scrml"]);
    expect(globalThis.__scrmlHostEvaluated).toBe(undefined);
  });

  test("an `export *` makes the export list non-authoritative", () => {
    const root = project({ "h.js": 'export * from "./other.js";\nexport const a = 1;\n' });
    expect(scanHostModule(join(root, "h.js")).exports).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// End to end — both front-ends
// ---------------------------------------------------------------------------

for (const parser of PARSERS) {
  const label = parser ? "native parser" : "live parser";

  describe(`import:host — ${label}`, () => {
    test("pre-fix repro: no manifest => E-IMPORT-008, and the line is NOT page text", () => {
      const root = project({
        "tok.js": HOST_JS,
        "app.scrml": 'import:host { tokenize } from "./tok.js"\n<program>\n<p>${tokenize("a b").length}</p>\n</program>\n',
      });
      const r = compile(root, "app.scrml", { parser });
      expect(count(r, "E-IMPORT-008")).toBe(1);
      // bindings stay in scope — no cascading E-SCOPE-001 on the use site
      expect(errorCodes(r)).not.toContain("E-SCOPE-001");
      const html = [...r.outputs.values()].map((o) => o.html || "").join("\n");
      expect(html).toContain("<p");   // the page WAS emitted — the next check is not vacuous
      expect(html).not.toContain("import:host");
    });

    test("disabled manifest => E-IMPORT-008 even under stdlib/compiler/", () => {
      const root = project({
        "scrml.toml": '[capabilities]\nhost-import = "disabled"\n',
        "host/tok.js": HOST_JS,
        "stdlib/compiler/tok.scrml": 'import:host { tokenize } from "../../host/tok.js"\nexport const t = tokenize\n',
      });
      const r = compile(root, "stdlib/compiler/tok.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-008")).toBe(1);
    });

    test("self-host-only, file outside stdlib/compiler/ => E-IMPORT-008", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "lib/tok.scrml": 'import:host { tokenize } from "../host/tok.js"\nexport const t = tokenize\n',
      });
      const r = compile(root, "lib/tok.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-008")).toBe(1);
    });

    test("self-host-only + stdlib/compiler/: emits a static ES import that runs under bun", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "host/add.ts": "export function add(a: number, b: number): number { return a + b }\n",
        "stdlib/compiler/tok.scrml":
          'import:host { tokenize as _tokenize, VERSION } from "../../host/tok.js"\n' +
          'import:host { add } from "../../host/add.ts"\n\n' +
          "export const tokenize = _tokenize\n" +
          "export fn count(s) { return _tokenize(s).length }\n" +
          "export const version = VERSION\n" +
          "export fn plus(a, b) { return add(a, b) }\n",
      });
      const r = compile(root, "stdlib/compiler/tok.scrml", { parser, mode: "library", write: true });
      expect(errorCodes(r)).toEqual([]);
      const emitted = readFileSync(join(root, "out", "tok.js"), "utf8");
      // a STATIC ES import — never a dynamic import() / Promise
      expect(emitted).toMatch(/^import \{ tokenize as _tokenize, VERSION \} from "\.\.\/host\/tok\.js"/m);
      expect(emitted).toMatch(/^import \{ add \} from "\.\.\/host\/add\.ts"/m);
      expect(emitted).not.toContain("import:host");
      expect(emitted).not.toMatch(/import\s*\(/);

      writeFileSync(
        join(root, "run.mjs"),
        'import { tokenize, count, version, plus } from "./out/tok.js";\n' +
        'console.log(JSON.stringify([tokenize("a b c"), count("x y"), version, plus(2, 3)]));\n',
      );
      const proc = Bun.spawnSync([process.execPath, join(root, "run.mjs")], { cwd: root });
      expect(proc.exitCode).toBe(0);
      expect(JSON.parse(proc.stdout.toString().trim())).toEqual([["a", "b", "c"], 2, "1", 5]);
    });

    test("host-tag other than `host` => E-IMPORT-009", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/m.js": "export const f = 1\n",
        "stdlib/compiler/w.scrml": 'import:wasm { f } from "../../host/m.js"\nexport const g = f\n',
      });
      const r = compile(root, "stdlib/compiler/w.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-009")).toBe(1);
      expect(errorCodes(r)).not.toContain("E-IMPORT-008");
    });

    test("a `host` target that is not a TS/JS module => E-IMPORT-009", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "stdlib/compiler/other.scrml": "export const f = 1\n",
        "stdlib/compiler/w.scrml": 'import:host { f } from "./other.scrml"\nexport const g = f\n',
      });
      const r = compile(root, "stdlib/compiler/w.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-009")).toBe(1);
    });

    test("inside a ${} block or a <program> body => E-IMPORT-003", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "stdlib/compiler/p.scrml":
          "<program>\n" +
          'import:host { tokenize } from "../../host/tok.js"\n' +
          "${\n" +
          '  import:host { VERSION } from "../../host/tok.js"\n' +
          "}\n" +
          "<p>${VERSION}${tokenize}</p>\n" +
          "</program>\n",
      });
      const r = compile(root, "stdlib/compiler/p.scrml", { parser });
      expect(count(r, "E-IMPORT-003")).toBe(2);
      expect(errorCodes(r)).not.toContain("E-IMPORT-008");
    });

    test("inside a function body => E-IMPORT-003 (once)", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "stdlib/compiler/f.scrml":
          "${\n  function inner() {\n" +
          '    import:host { tokenize } from "../../host/tok.js"\n' +
          "    return 1\n  }\n}\n",
      });
      const r = compile(root, "stdlib/compiler/f.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-003")).toBe(1);
    });

    test("missing host module => E-IMPORT-006; missing name => E-IMPORT-004", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "stdlib/compiler/m.scrml":
          'import:host { tokenize, nope } from "../../host/tok.js"\n' +
          'import:host { y } from "../../host/missing.js"\n' +
          "export const t = tokenize\n",
      });
      const r = compile(root, "stdlib/compiler/m.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-004")).toBe(1);
      expect(count(r, "E-IMPORT-006")).toBe(1);
    });

    test("a host module that imports the scrml file back => E-IMPORT-002", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/h.js": 'import { version } from "../stdlib/compiler/a.js"\nexport const x = 1\nexport const v = () => version\n',
        "stdlib/compiler/a.scrml": 'import:host { x } from "../../host/h.js"\nexport const version = x\n',
      });
      const r = compile(root, "stdlib/compiler/a.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-002")).toBe(1);
    });

    test("no host-side cycle => no E-IMPORT-002", () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/h.js": 'import { other } from "./other.js"\nexport const x = other\n',
        "host/other.js": "export const other = 1\n",
        "stdlib/compiler/a.scrml": 'import:host { x } from "../../host/h.js"\nexport const version = x\n',
      });
      const r = compile(root, "stdlib/compiler/a.scrml", { parser, mode: "library" });
      expect(errorCodes(r)).not.toContain("E-IMPORT-002");
    });

    test("a plain `import` is unaffected by the manifest", () => {
      const root = project({
        "tok.js": HOST_JS,
        "app.scrml": 'import { tokenize } from "./tok.js"\n<program>\n<p>${tokenize("a b").length}</p>\n</program>\n',
      });
      const r = compile(root, "app.scrml", { parser });
      expect(errorCodes(r)).toEqual([]);
    });
  });
}
