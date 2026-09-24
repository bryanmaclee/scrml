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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "fs";
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

// ---------------------------------------------------------------------------
// S430 fix round (adversarial review of ea01e11a)
// ---------------------------------------------------------------------------

function compileMany(root, entries, { parser = null, outDir = "dist" } = {}) {
  return compileScrml({
    inputFiles: entries.map((e) => join(root, e)),
    write: true,
    outputDir: join(root, outDir),
    mode: "library",
    log: () => {},
    ...(parser ? { parser } : {}),
  });
}

/** Run a small ESM script with bun from `root`; returns parsed JSON stdout. */
function runModule(root, name, body) {
  const file = join(root, name);
  writeFileSync(file, body);
  const proc = Bun.spawnSync([process.execPath, file], { cwd: root });
  return {
    exitCode: proc.exitCode,
    stderr: proc.stderr.toString(),
    value: proc.exitCode === 0 ? JSON.parse(proc.stdout.toString().trim()) : null,
  };
}

// F1 — the manifest gate cannot be bypassed by comments. Every gap kind in
// every slot (`import` _ `:` _ `host` _ `{`), at every position, both parsers.
// With no manifest, each one must yield exactly the placement-appropriate
// codes — never zero diagnostics, never page text.
const GAPS = ["", " ", "/* c */", " /* c */ ", "// c\n", " // c\n  ", "\n", "/*a*/ // b\n /*c*/"];
const COMMENT_FORMS = [];
for (const g of GAPS) {
  COMMENT_FORMS.push(`import${g}:host { tok } from "./h.js"`);
  COMMENT_FORMS.push(`import:${g}host { tok } from "./h.js"`);
  COMMENT_FORMS.push(`import:host${g}{ tok } from "./h.js"`);
}
COMMENT_FORMS.push(`import/* a */:// b\nhost /* c */ { /* d */ tok // e\n } from "./h.js"`);

const COMMENT_POSITIONS = {
  top: { wrap: (f) => `${f}\n<program>\n<p>\${tok}</p>\n</program>\n`, want: { "E-IMPORT-008": 1 }, total: 1 },
  logic: { wrap: (f) => `\${\n  ${f}\n}\n<program>\n<p>\${tok}</p>\n</program>\n`, want: { "E-IMPORT-003": 1, "E-IMPORT-008": 1 }, total: 2 },
  program: { wrap: (f) => `<program>\n${f}\n<p>\${tok}</p>\n</program>\n`, want: { "E-IMPORT-003": 1, "E-IMPORT-008": 1 }, total: 2 },
  fnbody: { wrap: (f) => `\${\n  function g() {\n    ${f}\n    return 1\n  }\n}\n<program>\n<p>\${g()}</p>\n</program>\n`, want: { "E-IMPORT-003": 1 } },
  nestedIf: { wrap: (f) => `\${\n  if (true) {\n    ${f}\n  }\n}\n<program>\n<p>hi</p>\n</program>\n`, want: { "E-IMPORT-003": 1 } },
};

describe("F1 — comments anywhere in `import:host` never bypass the gate", () => {
  for (const parser of PARSERS) {
    for (const [pos, spec] of Object.entries(COMMENT_POSITIONS)) {
      test(`${parser ?? "live"} / ${pos}: ${COMMENT_FORMS.length} comment placements`, () => {
        const failures = [];
        for (const form of COMMENT_FORMS) {
          const root = project({ "h.js": "export const tok = 1\n", "app.scrml": spec.wrap(form) });
          const r = compile(root, "app.scrml", { parser });
          const got = errorCodes(r);
          const ok =
            Object.entries(spec.want).every(([c, n]) => got.filter((x) => x === c).length === n) &&
            (spec.total === undefined || got.length === spec.total);
          const html = [...r.outputs.values()].map((o) => o.html || "").join("\n");
          if (!ok || /import\s*(\/\*|\/\/|:)|host\s*\{/.test(html)) failures.push(`${JSON.stringify(form)} -> ${got.join(",")}`);
        }
        expect(failures).toEqual([]);
      });
    }
  }

  test("a clause broken before `from` is reported (E-STMT-EXPECT-FROM), never silently dropped", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "stdlib/compiler/c.scrml": 'import:host { tokenize } // why\n  from "../../host/tok.js"\nexport const t = 1\n',
      });
      const r = compile(root, "stdlib/compiler/c.scrml", { parser, mode: "library" });
      // The live statement collector ends the declaration at the newline
      // (the same limit a plain `import { a }\n from` has); the native parser
      // accepts it. Either way nothing is silently lost.
      if (parser === null) expect(errorCodes(r)).toContain("E-STMT-EXPECT-FROM");
      else expect(errorCodes(r)).toEqual([]);
    }
  });

  test("the api.js fast path is a superset: any source the parsers see as `import` is walked", () => {
    // The only host import is written with a comment between `import` and
    // `:` — the exact case the old `/\bimport\s*:/` fast path skipped.
    const root = project({
      "h.js": "export const tok = 1\n",
      "app.scrml": '${ import /* c */ :host { tok } from "./h.js" }\n<program>\n<p>${tok}</p>\n</program>\n',
    });
    for (const parser of PARSERS) {
      const r = compile(root, "app.scrml", { parser });
      expect(errorCodes(r)).toContain("E-IMPORT-008");
    }
  });

  test("a permitted import:host with comments emits a runnable static import", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": HOST_JS,
        "stdlib/compiler/c.scrml":
          'import /* a */ : // b\n host /* c */ {\n  // d\n  tokenize\n} from "../../host/tok.js"\n' +
          "export const t = tokenize\n",
      });
      const r = compileMany(root, ["stdlib/compiler/c.scrml"], { parser });
      expect(errorCodes(r)).toEqual([]);
      const run = runModule(root, "run.mjs",
        'import { t } from "./dist/c.js";\nconsole.log(JSON.stringify(t("a b")));\n');
      expect(run.stderr).toBe("");
      expect(run.value).toEqual(["a", "b"]);
    }
  });
});

// F3 — relative imports are re-based from the directory each file is WRITTEN
// to, not from the output root. Nested outputs, plain and host, executed.
// F4 — more than one import declaration on a line is re-based.
describe("F3/F4 — nested output dirs + several imports per line, executed under bun", () => {
  for (const parser of PARSERS) {
    test(`${parser ?? "live"} parser`, () => {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/tok.js": 'export const TOK = "tok";\n',
        "host/add.ts": "export function add(a: number, b: number): number { return a + b }\n",
        "vendor/util.js": 'export const UTIL = "util";\n',
        "vendor/more.js": 'export const MORE = "more";\n',
        "stdlib/compiler/cg.scrml": 'import:host { TOK } from "../../host/tok.js"\nexport const cg = TOK\n',
        "stdlib/compiler/sub/cg2.scrml":
          'import:host { TOK as T } from "../../../host/tok.js"; import:host { add } from "../../../host/add.ts"\n' +
          "export const cg2 = T\nexport fn plus(a, b) { return add(a, b) }\n",
        "stdlib/compiler/lib/sub/m.scrml":
          'import { UTIL } from "../../../../vendor/util.js"; import { MORE } from "../../../../vendor/more.js"\n' +
          "export const m = UTIL + MORE\n",
      });
      const r = compileMany(root, [
        "stdlib/compiler/cg.scrml",
        "stdlib/compiler/sub/cg2.scrml",
        "stdlib/compiler/lib/sub/m.scrml",
      ], { parser });
      expect(errorCodes(r)).toEqual([]);
      const run = runModule(root, "run.mjs", [
        'import { cg } from "./dist/cg.js";',
        'import { cg2, plus } from "./dist/sub/cg2.js";',
        'import { m } from "./dist/lib/sub/m.js";',
        "console.log(JSON.stringify({ cg, cg2, plus: plus(2, 3), m }));",
      ].join("\n"));
      expect(run.stderr).toBe("");
      expect(run.value).toEqual({ cg: "tok", cg2: "tok", plus: 5, m: "utilmore" });
    });
  }
});

describe("F3 — plain `.js` imports from a nested source into a deeper output dir", () => {
  // Base (15e60e4b) emitted `../../vendor/util.js` into build/dist/sub/m.js
  // (re-based from the output ROOT) -> `Cannot find module` at run time.
  test("re-based from each file's own write directory, executed", () => {
    const root = project({
      "vendor/util.js": 'export const UTIL = "util";\n',
      "vendor/more.js": 'export const MORE = "more";\n',
      "lib/top.scrml": 'import { UTIL } from "../vendor/util.js"\nexport const top = UTIL\n',
      "lib/sub/m.scrml":
        'import { UTIL } from "../../vendor/util.js"\nimport { MORE } from "../../vendor/more.js"\nexport const m = UTIL + MORE\n',
    });
    const r = compileMany(root, ["lib/top.scrml", "lib/sub/m.scrml"], { outDir: "build/dist" });
    expect(errorCodes(r)).toEqual([]);
    const run = runModule(root, "run.mjs",
      'import { top } from "./build/dist/top.js";\nimport { m } from "./build/dist/sub/m.js";\n' +
      "console.log(JSON.stringify({ top, m }));\n");
    expect(run.stderr).toBe("");
    expect(run.value).toEqual({ top: "util", m: "utilmore" });
  });
});

describe("F5/F6/F7 — host-module record is structural", () => {
  test("F5: a host module with a syntax error is E-IMPORT-006 (not silent)", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/bad.js": "export const = ;\n",
        "host/bad.ts": "export function f(: number { }\n",
        "stdlib/compiler/b.scrml":
          'import:host { x } from "../../host/bad.js"\nimport:host { f } from "../../host/bad.ts"\nexport const y = x\n',
      });
      const r = compile(root, "stdlib/compiler/b.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-006")).toBe(2);
      expect(errorCodes(r)).not.toContain("E-IMPORT-004");
    }
  });

  test("F6: `export *` inside a comment or string does not disable E-IMPORT-004", () => {
    const root = project({
      "h.js": '// export * from "./nope.js"\nconst s = "export * from x";\nexport const a = s;\n',
    });
    const rec = scanHostModule(join(root, "h.js"));
    expect(rec.exports).not.toBe(null);
    expect([...rec.exports]).toEqual(["a"]);
    for (const parser of PARSERS) {
      const p = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/h.js": '// export * from "./nope.js"\nexport const a = 1;\n',
        "stdlib/compiler/c.scrml": 'import:host { a, missing } from "../../host/h.js"\nexport const b = a\n',
      });
      const r = compile(p, "stdlib/compiler/c.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-004")).toBe(1);
    }
  });

  test("F6: a real `export *` (structural) still skips the name check", () => {
    const root = project({ "h.js": 'export * from "./other.js";\n', "other.js": "export const z = 1\n" });
    expect(scanHostModule(join(root, "h.js")).exports).toBe(null);
  });

  test("F7: a CommonJS host module is not false-rejected, and runs", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/cjs.js": 'module.exports = { greet(n) { return "hi " + n } };\n',
        "stdlib/compiler/c.scrml": 'import:host { greet } from "../../host/cjs.js"\nexport const g = greet\n',
      });
      expect(scanHostModule(join(root, "host/cjs.js")).exports).toBe(null);
      const r = compileMany(root, ["stdlib/compiler/c.scrml"], { parser });
      expect(errorCodes(r)).toEqual([]);
      const run = runModule(root, "run.mjs", 'import { g } from "./dist/c.js";\nconsole.log(JSON.stringify(g("x")));\n');
      expect(run.value).toBe("hi x");
    }
  });

  test("export names come from every declaration shape", () => {
    const root = project({
      "h.ts":
        "export const { a, b: [c, ...d] } = { a: 1, b: [2, 3] } as any;\n" +
        "export function f() {}\nexport class K {}\nconst g = 1; export { g as h, g as \"q-q\" };\n" +
        "export default 1;\nexport * as ns from \"./x.js\";\nexport type T = string;\n",
    });
    const rec = scanHostModule(join(root, "h.ts"));
    expect([...rec.exports].sort()).toEqual(["K", "a", "c", "d", "default", "f", "h", "ns", "q-q"]);
  });
});

describe("F9 — the allow-list is judged on REAL paths", () => {
  test("a symlink AT stdlib/compiler pointing elsewhere does not grant the capability", () => {
    const elsewhere = project({ "x.scrml": 'import:host { TOK } from "./tok.js"\nexport const t = TOK\n', "tok.js": "export const TOK = 1\n" });
    const root = project({ "scrml.toml": SELF_HOST_TOML, "stdlib/.keep": "" });
    symlinkSync(elsewhere, join(root, "stdlib/compiler"), "dir");
    for (const parser of PARSERS) {
      const r = compile(root, "stdlib/compiler/x.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-008")).toBe(1);
    }
  });

  test("a symlinked alias is judged by its real path (both directions)", () => {
    const root = project({
      "scrml.toml": SELF_HOST_TOML,
      "host/tok.js": HOST_JS,
      "stdlib/compiler/real.scrml": 'import:host { VERSION } from "../../host/tok.js"\nexport const v = VERSION\n',
      "stdlib/other/.keep": "",
      "outside.scrml": 'import:host { VERSION } from "./host/tok.js"\nexport const v = VERSION\n',
    });
    // an alias OUTSIDE stdlib/compiler/ of a real stdlib/compiler/ file: permitted
    symlinkSync(join(root, "stdlib/compiler/real.scrml"), join(root, "stdlib/other/alias.scrml"));
    // an alias INSIDE stdlib/compiler/ of a real file outside it: not permitted
    symlinkSync(join(root, "outside.scrml"), join(root, "stdlib/compiler/fake.scrml"));
    const cap = readHostImportCapability(join(root, "stdlib/compiler/real.scrml"));
    expect(isHostImportPermitted(join(root, "stdlib/other/alias.scrml"), cap)).toBe(true);
    expect(isHostImportPermitted(join(root, "stdlib/compiler/fake.scrml"), cap)).toBe(false);
    for (const parser of PARSERS) {
      expect(errorCodes(compile(root, "stdlib/other/alias.scrml", { parser, mode: "library" }))).not.toContain("E-IMPORT-008");
      expect(count(compile(root, "stdlib/compiler/fake.scrml", { parser, mode: "library" }), "E-IMPORT-008")).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// S430 re-review of d130c878
// ---------------------------------------------------------------------------

describe("re-review 1 — a .js host module is parsed the way Bun loads it", () => {
  test("decorators and JSX in a .js host: no false E-IMPORT-006, names checked, runs", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/dec.js":
          "function logged(c) { return c }\n@logged export class D { static tag() { return \"D\" } }\nexport const x = 1\n",
        "host/view.js":
          "export const n = 2\nexport function V() { return <div id=\"v\">hi</div> }\n",
        "stdlib/compiler/c.scrml":
          'import:host { D, x } from "../../host/dec.js"\n' +
          'import:host { n } from "../../host/view.js"\n' +
          "export const out = D.tag() + x + n\n",
      });
      const r = compileMany(root, ["stdlib/compiler/c.scrml"], { parser });
      expect(errorCodes(r)).toEqual([]);
      const run = runModule(root, "run.mjs", 'import { out } from "./dist/c.js";\nconsole.log(JSON.stringify(out));\n');
      expect(run.stderr).toBe("");
      expect(run.value).toBe("D12");
    }
  });

  test("JSX in a .mjs host is rejected (E-IMPORT-006) — exactly as Bun rejects it at load", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/view.mjs": "export function V() { return <b/> }\n",
        "stdlib/compiler/c.scrml": 'import:host { V } from "../../host/view.mjs"\nexport const v = V\n',
      });
      const r = compile(root, "stdlib/compiler/c.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-006")).toBe(1);
    }
  });

  test("the export list is still checked for such modules (E-IMPORT-004)", () => {
    for (const parser of PARSERS) {
      const root = project({
        "scrml.toml": SELF_HOST_TOML,
        "host/view.js": "export function V() { return <b/> }\n",
        "stdlib/compiler/c.scrml": 'import:host { V, nope } from "../../host/view.js"\nexport const v = V\n',
      });
      const r = compile(root, "stdlib/compiler/c.scrml", { parser, mode: "library" });
      expect(count(r, "E-IMPORT-004")).toBe(1);
      expect(errorCodes(r)).not.toContain("E-IMPORT-006");
    }
  });
});

describe("re-review 2 — `import:` prose that is not a declaration gives ONE diagnostic", () => {
  const PROSE = [
    "import: this page documents the bridge.",
    "import : this page documents the bridge.",
    "import: 3 things matter here.",
    "import:notes about the build",
  ];
  for (const parser of PARSERS) {
    test(`${parser ?? "live"} parser`, () => {
      for (const line of PROSE) {
        const root = project({ "a.scrml": `${line}\n<program>\n<p>hi</p>\n</program>\n` });
        const r = compile(root, "a.scrml", { parser });
        expect({ line, codes: errorCodes(r) }).toEqual({ line, codes: ["E-IMPORT-009"] });
        const msg = r.errors.find((e) => e.code === "E-IMPORT-009").message;
        expect(msg).toContain("is not an `import:host` declaration");
      }
    });
  }

  test("a real non-host tag with a clause is still the host-tag error (+ manifest)", () => {
    for (const parser of PARSERS) {
      const root = project({ "a.scrml": 'import:wasm { f } from "./m.js"\n<program>\n<p>${f}</p>\n</program>\n' });
      const r = compile(root, "a.scrml", { parser });
      expect(count(r, "E-IMPORT-009")).toBe(1);
      expect(errorCodes(r)).toContain("E-IMPORT-008");
    }
  });
});
