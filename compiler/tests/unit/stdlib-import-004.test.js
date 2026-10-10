/**
 * stdlib-import-004 — S462 (s462-stdlib-import-004)
 *
 * §21.3 / §41.3.1: a `scrml:` import of a name the stdlib module does not export
 * is E-IMPORT-004, judged against the export table the STDLIB-EXPORT-SEED stage
 * reads from the module's `.scrml` source. Before S462 such an import compiled
 * clean and the name was `undefined` at run time (`required is not a function`).
 *
 *   §1  a missing name is refused; the message names module + name
 *   §2  a near-miss gets "Did you mean"
 *   §3  a name another stdlib module exports points there (verifyHash → scrml:crypto)
 *   §4  a name a submodule exports but the umbrella does not re-export is refused;
 *       the subpath import of it is accepted
 *   §5  re-exported names and exported types count as exports
 *   §6  a default import from a stdlib module is refused (no default export)
 *   §7  the deferred `scrml:compiler*` family is not judged here
 *   §8  a missing MODULE stays E-IMPORT-006 only (no second report)
 *   §9  validateStdlibImports — unit: skips in-graph, unreadable and non-stdlib targets
 *   §10 a :struct stdlib type is erased from server / tool / library ES imports (loaded under bun)
 *   §11-12 §53.14.6 — stdlib types reach the importer's type registry
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { validateStdlibImports } from "../../src/module-resolver.js";

let root;
beforeAll(() => { root = mkdtempSync(join(tmpdir(), "scrml-stdlib-import-004-")); });
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

let n = 0;
function compileImport(importLine, body = "<p>hi</>") {
  const dir = join(root, `c${n++}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, `\${\n    ${importLine}\n}\n${body}\n`);
  const res = compileScrml({ inputFiles: [file], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const all = [...(res.errors ?? []), ...(res.warnings ?? [])];
  return {
    import004: all.filter((e) => e.code === "E-IMPORT-004"),
    codes: all.map((e) => e.code),
  };
}

describe("E-IMPORT-004 for scrml: stdlib imports", () => {
  test("§1 a name the module does not export is refused, naming module and name", () => {
    const { import004 } = compileImport("import { totallyBogus } from 'scrml:data'");
    expect(import004.length).toBe(1);
    expect(import004[0].message).toContain("`totallyBogus` is not exported by `scrml:data`");
    expect(import004[0].message).toContain("stdlib/data/index.scrml");
  });

  test("§2 a near-miss suggests the closest export", () => {
    const { import004 } = compileImport("import { requird } from 'scrml:data'");
    expect(import004.length).toBe(1);
    expect(import004[0].message).toContain("Did you mean `required`?");
  });

  test("§3 a name another stdlib module exports points to that module", () => {
    const { import004 } = compileImport("import { verifyHash } from 'scrml:auth'");
    expect(import004.length).toBe(1);
    expect(import004[0].message).toContain("`verifyHash` is exported by `scrml:crypto`");
  });

  test("§4 a submodule-only name is refused from the umbrella and accepted by subpath", () => {
    const umbrella = compileImport("import { JwtError } from 'scrml:auth'");
    expect(umbrella.import004.length).toBe(1);
    expect(umbrella.import004[0].message).toContain("`scrml:auth/jwt`");
    const sub = compileImport("import { JwtError, signJwt } from 'scrml:auth/jwt'");
    expect(sub.import004).toEqual([]);
    expect(sub.codes).not.toContain("E-IMPORT-006");
    const oauth = compileImport("import { OAuthError } from 'scrml:oauth'");
    expect(oauth.import004.length).toBe(1);
    expect(oauth.import004[0].message).toContain("`scrml:oauth/google`");
  });

  test("§5 re-exports and exported types are exports", () => {
    expect(compileImport("import { verifyPassword, hashPassword } from 'scrml:auth'").import004).toEqual([]);
    expect(compileImport("import { TableSort, ParseError, tableFor } from 'scrml:data'").import004).toEqual([]);
    expect(compileImport("import { CryptoError, generateUUID } from 'scrml:crypto'").import004).toEqual([]);
  });

  test("§6 a default import from a stdlib module is refused", () => {
    const { import004 } = compileImport("import time from 'scrml:time'");
    expect(import004.length).toBe(1);
    expect(import004[0].message).toContain("`scrml:time` has no default export");
  });

  test("§7 the scrml:compiler family is not judged by this check", () => {
    const { import004 } = compileImport("import { notAThing } from 'scrml:compiler'");
    expect(import004).toEqual([]);
  });

  test("§8 a missing stdlib module is E-IMPORT-006 only", () => {
    const { import004, codes } = compileImport("import { x } from 'scrml:no-such-module-zz'");
    expect(codes).toContain("E-IMPORT-006");
    expect(import004).toEqual([]);
  });
});

describe("ES-module emit: a stdlib :struct type is erased from its import (server, tool, library)", () => {
  // Each output is WRITTEN and then LOADED under bun: a `:struct` name left in an
  // ES import fails at link time ("Export named 'TableSort' not found"). The
  // program also mentions "TableSort" in a string, which must not keep the import
  // (erasure is by declared kind, not a text scan). Enums stay — every shim
  // exports its enums.
  async function writeAndLoad(name, src, mode, artifact) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "app.scrml");
    writeFileSync(file, src);
    const outDir = join(dir, "dist");
    const res = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {}, ...(mode ? { mode } : {}) });
    expect((res.errors ?? []).filter((e) => !String(e.code).startsWith("W-"))).toEqual([]);
    const js = readFileSync(join(outDir, artifact), "utf8");
    let loadError = null;
    try { await import(join(outDir, artifact)); } catch (e) { loadError = String(e?.message ?? e); }
    return { js, loadError };
  }

  test("§10a server bundle: TableSort erased, ParseError / CryptoError / generateUUID kept, module links", async () => {
    const { js, loadError } = await writeAndLoad("emit-server", [
      "<program>",
      "${ import { TableSort, ParseError } from 'scrml:data' }",
      "${ import { generateUUID, CryptoError } from 'scrml:crypto' }",
      "<s> = \"\"",
      "${ server function mk() { const t: TableSort = { field: \"TableSort\", direction: \"asc\" }",
      "  return generateUUID() + t.field } }",
      "<button onclick={ @s = mk() }>go</button>",
      "<div>${@s}</div>",
      "</program>",
      "",
    ].join("\n"), null, "app.server.js");
    const imports = js.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(imports.some((l) => /\bTableSort\b/.test(l))).toBe(false);
    expect(imports.some((l) => /\bParseError\b/.test(l))).toBe(true);
    expect(imports.some((l) => /\bgenerateUUID\b/.test(l) && /\bCryptoError\b/.test(l))).toBe(true);
    expect(loadError).toBe(null);
  });

  test("§10b kind=\"tool\" module: TableSort erased, module links", async () => {
    const { js, loadError } = await writeAndLoad("emit-tool", [
      "<program kind=\"tool\">",
      "${ import { TableSort } from \"scrml:data\" }",
      "${ import { generateUUID } from \"scrml:crypto\" }",
      "${",
      "    function main() {",
      "        const t: TableSort = { field: \"name\", direction: \"asc\" }",
      "        return generateUUID() + t.field + \"TableSort\"",
      "    }",
      "}",
      "</program>",
      "",
    ].join("\n"), null, "app.js");
    expect(js.split("\n").filter((l) => /^\s*import\b/.test(l)).some((l) => /\bTableSort\b/.test(l))).toBe(false);
    expect(loadError).toBe(null);
  });

  test("§10c library mode: TableSort erased, module links", async () => {
    const { js, loadError } = await writeAndLoad("emit-library", [
      "${",
      "    import { TableSort } from \"scrml:data\"",
      "    import { generateUUID } from \"scrml:crypto\"",
      "    export function mk() {",
      "        const t: TableSort = { field: \"name\", direction: \"asc\" }",
      "        return generateUUID() + t.field + \"TableSort\"",
      "    }",
      "}",
      "",
    ].join("\n"), "library", "app.js");
    expect(js.split("\n").filter((l) => /^\s*import\b/.test(l)).some((l) => /\bTableSort\b/.test(l))).toBe(false);
    expect(loadError).toBe(null);
  });
});

describe("§53.14.6 — imported stdlib types reach the importer's type registry", () => {
  function compileProgram(name, src) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "app.scrml");
    writeFileSync(file, src);
    const res = compileScrml({ inputFiles: [file], outputDir: join(dir, "dist"), write: false, log: () => {} });
    return (res.errors ?? []).map((e) => e.code);
  }

  test("§11 a stdlib enum types a bare variant and a match subject; a struct types an annotation", () => {
    const codes = compileProgram("types-ok", [
      "<program>",
      "${ import { CryptoError, generateUUID } from 'scrml:crypto' }",
      "${ import { JwtError } from 'scrml:auth/jwt' }",
      "${ import { TableSort } from 'scrml:data' }",
      "<s> = \"\"",
      "${",
      "    function describe(e: JwtError) -> string {",
      "        return match e {",
      "            .DecodeFailed(m) :> \"decode: \" + m",
      "        }",
      "    }",
      "    function mk() {",
      "        const c: CryptoError = .VerifyFailed(\"bad\")",
      "        const t: TableSort = { field: \"name\", direction: \"asc\" }",
      "        return generateUUID() + t.field + describe(JwtError.DecodeFailed(\"x\"))",
      "    }",
      "}",
      "<button onclick={ @s = mk() }>go</button>",
      "</program>",
      "",
    ].join("\n"));
    // Before S462: E-VARIANT-AMBIGUOUS (`.VerifyFailed`) + E-TYPE-025 (`match e`, asIs subject).
    expect(codes).not.toContain("E-VARIANT-AMBIGUOUS");
    expect(codes).not.toContain("E-TYPE-025");
    expect(codes.filter((c) => !c.startsWith("W-"))).toEqual([]);
  });

  test("§12 a variant the stdlib enum does not declare is now refused (E-TYPE-063)", () => {
    const codes = compileProgram("types-bad", [
      "<program>",
      "${ import { CryptoError } from 'scrml:crypto' }",
      "<s> = \"\"",
      "${ function mk() { const c: CryptoError = .Nope(\"bad\")",
      "  return \"x\" } }",
      "<button onclick={ @s = mk() }>go</button>",
      "</program>",
      "",
    ].join("\n"));
    expect(codes).toContain("E-TYPE-063");
  });
});

describe("§21.4 (S462 Q19) — a named re-export from scrml: is checked", () => {
  test("§13 `export { NotAThing } from \"scrml:crypto\"` is E-IMPORT-004 at the re-export; valid and aliased names pass", () => {
    const dir = join(root, "reexport");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "m.scrml"), [
      "${",
      "    export { NotAThing, hash } from \"scrml:crypto\"",
      "    export { generateUUID as uuid } from \"scrml:crypto\"",
      "}",
      "",
    ].join("\n"));
    writeFileSync(join(dir, "app.scrml"), "${\n    import { hash, uuid } from './m.scrml'\n}\n<p>${hash}${uuid}</>\n");
    const res = compileScrml({
      inputFiles: [join(dir, "app.scrml"), join(dir, "m.scrml")],
      outputDir: join(dir, "dist"), write: false, log: () => {},
    });
    const e4 = (res.errors ?? []).filter((e) => e.code === "E-IMPORT-004");
    expect(e4.length).toBe(1);
    expect(e4[0].message).toContain("`NotAThing` is not exported by `scrml:crypto`, so it cannot be re-exported");
    expect(String(e4[0].span?.file ?? "")).toContain("m.scrml");
  });

  test("§14 a named re-export from a vendor: module is not checked (unchanged)", () => {
    const graph = new Map([["/app/m.scrml", { imports: [], exports: [
      { name: "x", localName: "x", reExportSource: "/app/vendor/v.scrml", reExportSpecifier: "vendor:v" },
    ] }]]);
    expect(validateStdlibImports(graph, () => new Set())).toEqual([]);
  });
});

describe("validateStdlibImports (unit)", () => {
  const imp = (source, names, extra = {}) => ({
    source, names, absSource: `/std/${source.slice(6)}.scrml`, isDefault: false, span: null, ...extra,
  });
  test("§9 judges only out-of-graph stdlib targets with a readable export set", () => {
    const graph = new Map([
      ["/app/a.scrml", { imports: [
        imp("scrml:data", ["pick", "nope"]),
        imp("scrml:auth", ["x"]),           // namesOf → null (unreadable): skipped
        imp("scrml:compiler", ["y"]),       // deferred family: skipped
        { source: "./b.scrml", names: ["z"], absSource: "/app/b.scrml", isDefault: false },
      ] }],
    ]);
    const sets = new Map([["/std/data.scrml", new Set(["pick"])], ["/std/auth.scrml", null]]);
    const errs = validateStdlibImports(graph, (p) => sets.get(p));
    expect(errs.map((e) => [e.code, e.missingName])).toEqual([["E-IMPORT-004", "nope"]]);
    expect(errs[0].importerFile).toBe("/app/a.scrml");
    expect(errs[0].targetFile).toBe("/std/data.scrml");
  });
});
