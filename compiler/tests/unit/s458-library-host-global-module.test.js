/**
 * S458 (s458-alias-r3, N1) — a written `--mode library` `<base>.js` takes the host-global
 * alias from a same-origin `_scrml/_global.js`, not a `data:` module.
 *
 * The library module is the client-facing artifact (SPEC §12.6: "the client-facing
 * library `<base>.js`"); a browser loading it unbundled under
 * `Content-Security-Policy: script-src 'self'` refuses a `data:` module import and the
 * importing module never runs. The alias's own `globalThis` read still sits in a module
 * no user code shares (S457 F5).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { HOST_GLOBAL_MODULE_TEXT, relocateHostGlobalImport, HOST_GLOBAL_ALIAS_DECL } from "../../src/codegen/host-global-alias.ts";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dir, "..", "..", "..", ".tmp", `s458-libglobal-${process.pid}`);
const LIB = "${ export function f(a) { return { s: `${a}`, same: { a: 1 } == { a: 1 } } } export type Color:enum = { Red, Green } }\n";

function write(rel, text) {
  const p = join(ROOT, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  return p;
}

function compile(files, outDir) {
  return compileScrml({ inputFiles: files, mode: "library", outputDir: outDir, write: true, log: () => {} });
}

function fatal(result) {
  return (result.errors || []).filter((e) => e.severity !== "warning" && e.severity !== "info");
}

beforeAll(() => { rmSync(ROOT, { recursive: true, force: true }); mkdirSync(ROOT, { recursive: true }); });
afterAll(() => { rmSync(ROOT, { recursive: true, force: true }); });

describe("S458 — library artifacts import the alias from a same-origin module", () => {
  test("a library <base>.js imports ./_scrml/_global.js; no data: import is written", async () => {
    const src = write("flat/src/l.scrml", LIB);
    const out = join(ROOT, "flat/dist");
    const r = compile([src], out);
    expect(fatal(r)).toEqual([]);
    const js = readFileSync(join(out, "l.js"), "utf8");
    expect(js).toContain('import _scrml_g from "./_scrml/_global.js";');
    expect(js).not.toContain("data:");
    expect(readFileSync(join(out, "_scrml/_global.js"), "utf8")).toBe(HOST_GLOBAL_MODULE_TEXT);
    // The written module runs: the alias resolves to the global object.
    const mod = await import(pathToFileURL(join(out, "l.js")).href);
    expect(mod.f(5)).toEqual({ s: "5", same: true });
    expect(mod.Color.Green).toBe("Green");
  });

  test("a nested library file's specifier is relative to its own directory", async () => {
    const a = write("nested/src/a.scrml", LIB);
    const b = write("nested/src/sub/deep/b.scrml", LIB);
    const out = join(ROOT, "nested/dist");
    const r = compile([a, b], out);
    expect(fatal(r)).toEqual([]);
    expect(readFileSync(join(out, "a.js"), "utf8")).toContain('from "./_scrml/_global.js"');
    const bjs = readFileSync(join(out, "sub/deep/b.js"), "utf8");
    expect(bjs).toContain('from "../../_scrml/_global.js"');
    expect(bjs).not.toContain("data:");
    const mod = await import(pathToFileURL(join(out, "sub/deep/b.js")).href);
    expect(mod.f(1).same).toBe(true);
  });

  test("a library that never names a host global writes no alias module", () => {
    const src = write("plain/src/p.scrml", "${ export function g(a) { return a + 1 } }\n");
    const out = join(ROOT, "plain/dist");
    const r = compile([src], out);
    expect(fatal(r)).toEqual([]);
    expect(readFileSync(join(out, "p.js"), "utf8")).not.toContain("_scrml_g");
    expect(existsSync(join(out, "_scrml/_global.js"))).toBe(false);
  });

  test("a user source compiling onto _scrml/_global.js is E-CG-015 and nothing is written", () => {
    const a = write("clash/src/a.scrml", LIB);
    const b = write("clash/src/_scrml/_global.scrml", "${ export function h(a) { return a } }\n");
    const out = join(ROOT, "clash/dist");
    const r = compile([a, b], out);
    expect(fatal(r).map((e) => e.code)).toContain("E-CG-015");
    expect(existsSync(join(out, "a.js"))).toBe(false);
  });

  test("relocateHostGlobalImport rewrites only the alias import line", () => {
    const js = `// header\n${HOST_GLOBAL_ALIAS_DECL}\nconst s = "data:text/javascript,export default globalThis";\n`;
    const out = relocateHostGlobalImport(js, "../_scrml/_global.js");
    expect(out).toContain('import _scrml_g from "../_scrml/_global.js";');
    expect(out).toContain('const s = "data:text/javascript,export default globalThis";');
    expect(relocateHostGlobalImport("const x = 1;\n", "./_scrml/_global.js")).toBe("const x = 1;\n");
  });
});
