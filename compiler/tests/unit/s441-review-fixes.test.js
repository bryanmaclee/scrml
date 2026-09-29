/**
 * S441 review round (PA review of feaf5ed8b) — regression tests, one block per
 * finding. Default pipeline unless the finding is about native parity.
 * Probes: scratchpad rv-prose-out/probe/pN.txt.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const DIR = "/tmp/s441-review-fixes-fixtures";
mkdirSync(DIR, { recursive: true });
let n = 0;
function compile(source, parser) {
  const f = join(DIR, `c-${++n}.scrml`);
  writeFileSync(f, source);
  const out = join(DIR, `out-${n}`);
  if (existsSync(out)) rmSync(out, { recursive: true });
  const r = compileScrml({ inputFiles: [f], outputDir: out, write: true, log: () => {}, parser: parser ?? null });
  const errors = r.errors ?? [];
  const warnings = r.warnings ?? [];
  const read = (ext) => (existsSync(join(out, `c-${n}.${ext}`)) ? readFileSync(join(out, `c-${n}.${ext}`), "utf8") : "");
  const m = read("html").match(/<body>([\s\S]*?)<script/);
  return {
    errors, codes: errors.map((e) => e.code), warns: warnings.map((w) => w.code),
    body: (m ? m[1] : "").replace(/\s+/g, " ").trim(), client: read("client.js"),
  };
}

describe("#1 — a word infix operator (`and` / `or`) at a line end continues the expression", () => {
  for (const op of ["and", "or"]) {
    test(`\`const <r> = @a ${op}⏎ @b\` compiles and keeps both operands`, () => {
      const r = compile(`<program>\n<a> = true\n<b> = false\nconst <r> = @a ${op}\n  @b\n<p>\${@r}</p>\n</program>\n`);
      expect(r.errors).toHaveLength(0);
      expect(r.client).toContain(op === "and" ? "&&" : "||");
    });
  }
  test("the same inside a function body and an explicit `${}`", () => {
    expect(compile("<program>\n<a> = true\n<b> = false\nfunction f() {\n  const r = @a and\n    @b\n  return r\n}\n<p>${f()}</p>\n</program>\n").errors).toHaveLength(0);
    expect(compile("<program>\n<a> = true\n<b> = false\n${\n  const r = @a or\n    @b\n}\n<p>x</p>\n</program>\n").errors).toHaveLength(0);
  });
});

describe("#2 — a bare `@cell` expression statement stops at a statement on the next line", () => {
  for (const [label, tail, needle] of [
    ["return", "return x", "return x;"],
    ["if", "if (x > 0) { @n = 9 }", "if (x > 0)"],
    ["const", "const k = 5\n  return k", "const k = 5;"],
  ]) {
    test(`\`@y⏎${label} …\` keeps the ${label}`, () => {
      const r = compile(`<program>\n<y> = 2\n<n> = 0\nfunction f() {\n  let x = 1\n  @y\n  ${tail}\n}\n<p>\${f()}</p>\n</program>\n`);
      expect(r.client).toContain(needle);
    });
  }
  test("`@y.a⏎return x` keeps the return", () => {
    const r = compile("<program>\n<y> = { a: 1 }\nfunction f() {\n  let x = 1\n  @y.a\n  return x\n}\n<p>${f()}</p>\n</program>\n");
    expect(r.client).toContain("return x;");
  });
  test("`@y⏎return 7` as the FIRST statement keeps the return (pre-existing drop)", () => {
    const r = compile("<program>\n<y> = 2\nfunction f() {\n  @y\n  return 7\n}\n<p>${f()}</p>\n</program>\n");
    expect(r.client).toContain("return 7;");
  });
});

for (const [label, parser] of [["default", null], ["scrml-native", "scrml-native"]]) {
  describe(`#3/#4/#5 — a prose line that swallows the next line is rejected; the next line survives (${label})`, () => {
    test("`Welcome here.⏎<count> = 0` → ONE E-UNQUOTED-DISPLAY-TEXT, the declaration still exists", () => {
      const r = compile("<program>\nWelcome here.\n<count> = 0\n<p>${@count}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
    test("`Welcome here.⏎<count> = 0` with no read still errors (was 0 errors, both lines vanished)", () => {
      const r = compile("<program>\nWelcome here.\n<count> = 0\n<p>static</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
    for (const line of ["Welcome here", "Welcome.", "Welcome here!", "Hi there, friend.", "Welcome to the app"]) {
      test(`\`${line}⏎<count> = 0\` → only E-UNQUOTED-DISPLAY-TEXT`, () => {
        const r = compile(`<program>\n${line}\n<count> = 0\n<p>\${@count}</p>\n</program>\n`, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      });
    }
    test("`Welcome here.⏎function go(){…}` → no E-SCOPE-001 cascade on `go`", () => {
      const r = compile("<program>\nWelcome here.\nfunction go() { return 1 }\n<p>${go()}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
    test("`Totals below.⏎const <b> = @a * 2` → the derived cell survives", () => {
      const r = compile("<program>\n<a> = 1\nTotals below.\nconst <b> = @a * 2\n<p>${@b}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
    test("three prose lines in a row are ONE diagnostic", () => {
      const r = compile("<program>\nWelcome to the dashboard.\nif you want the archive, ask an admin.\nItems for sale (all of them) ship on Friday.\n<p>x</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
  });
}
