/**
 * S441 review round (PA review of feaf5ed8b) — regression tests, one block per
 * finding. Default pipeline unless the finding is about native parity.
 * Probes: scratchpad rv-prose-out/probe/pN.txt.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const DIR = join(tmpdir(), "s441-review-fixes-fixtures");
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
  // SPEC §2.2.1 (S457 "1a"): a compile that reports an Error writes NO file —
  // the cases that report one are read from the in-memory outputs.
  if (errors.length > 0) expect(existsSync(out)).toBe(false);
  const output = r.outputs.get(f) ?? {};
  const m = (output.html ?? "").match(/<body>([\s\S]*?)<script/);
  return {
    errors, codes: errors.map((e) => e.code), warns: warnings.map((w) => w.code),
    body: (m ? m[1] : "").replace(/\s+/g, " ").trim(), client: output.clientJs ?? "",
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

for (const [label, parser] of [["default", null]]) { // S449: native full-pipeline arm retired
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

for (const [label, parser] of [["default", null]]) { // S449: native full-pipeline arm retired
  describe(`#6 — a comma sequence of bare words is not a scrml expression (${label})`, () => {
    for (const line of ["Hi, there", "Hello, world", "Yes, please", "First, second, third", "Thanks, Bob", "Hello, world, again"]) {
      test(`\`${line}\` → E-UNQUOTED-DISPLAY-TEXT, and nothing ships to the client`, () => {
        const r = compile(`<program>\n${line}\n<p id="z">z</p>\n</program>\n`, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(r.client).not.toContain(" , ");
      });
    }
  });
}

describe("#8 — a body-top CODE template literal stays whole (not cut at `${`)", () => {
  test("default: `const msg = \`total is ${n + 1} units\`` compiles to the whole template", () => {
    const r = compile("<program>\nconst n = 3\nconst msg = `total is ${n + 1} units`\n<p>${msg}</p>\n</program>\n");
    expect(r.errors).toHaveLength(0);
    expect(r.client).toContain("`total is ${n + 1} units`");
    expect(r.client).not.toMatch(/^units/m);
  });
  test("default: a body-top template behaves exactly as the same template in an explicit `${}`", () => {
    const bare = compile("<program>\n<total> = 3\nconst msg = `total is ${@total} units`\n<p>${msg}</p>\n</program>\n");
    const explicit = compile("<program>\n<total> = 3\n${ const msg = `total is ${@total} units` }\n<p>${msg}</p>\n</program>\n");
    expect(bare.codes).toEqual(explicit.codes);
    // Never the pre-fix shape: the template's tail lifted as code.
    expect(bare.client).not.toContain("units `");
  });
  // S449 re-point: was a full compile under `--parser=scrml-native`; asserted on
  // the native parser's own tree (no statement carries the template's tail).
  test("native: the tail is not lifted as code (no runtime ReferenceError shape)", () => {
    const r = nativeParseFile("/s441-native/c.scrml", "<program>\nconst n = 3\nconst msg = `total is ${n + 1} units`\n<p>${msg}</p>\n</program>\n");
    expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    expect(JSON.stringify(r.ast.nodes)).not.toContain("units `");
  });
  test("a stray backtick in prose cannot swallow the next element", () => {
    const r = compile("<program>\nuse `this` wisely\n<p id=\"z\">z</p>\n</program>\n");
    expect(r.body).toContain("<p id=\"z\">z</p>");
  });
});

for (const [label, parser] of [["default", null]]) { // S449: native full-pipeline arm retired
  describe(`#9/#10 — a \`"..."\` whose expression continues on the next line is code, not display text (${label})`, () => {
    test("`\"abc\"⏎ .toUpperCase()` is not rendered", () => {
      const r = compile("<program>\n\"abc\"\n  .toUpperCase()\n<p id=\"z\">z</p>\n</program>\n", parser);
      expect(r.body).toBe("<p id=\"z\">z</p>");
    });
    test("`\"a\"⏎ + \"b\"` is not rendered", () => {
      const r = compile("<program>\n\"a\"\n  + \"b\"\n<p id=\"z\">z</p>\n</program>\n", parser);
      expect(r.body).toBe("<p id=\"z\">z</p>");
    });
    test("control: `\"a\";⏎ + x` — a `;` ends the literal statement, so it renders", () => {
      const r = compile("<program>\n\"shown\";\n<p id=\"z\">z</p>\n</program>\n", parser);
      expect(r.body).toContain("shown");
    });
  });
}

describe("#9 — `@a and⏎ \"d\"`: a word operator at a line end makes the next-line string its operand (default)", () => {
  test("the string is not split out as display text", () => {
    const r = compile("<program>\n<a> = true\nconst s = @a and\n  \"d\"\n<p id=\"z\">${s}</p>\n</program>\n");
    expect(r.errors).toHaveLength(0);
    expect(r.body).not.toContain(">d<");
    expect(r.client).toContain("&&");
  });
});

for (const [label, parser] of [["default", null]]) { // S449: native full-pipeline arm retired
  test(`#11 — the suggested display-text literal is itself valid (quotes escaped) (${label})`, () => {
    const r = compile("<program>\nprose then \"quoted\" word\n<p id=\"z\">z</p>\n</program>\n", parser);
    const e = r.errors.find((x) => x.code === "E-UNQUOTED-DISPLAY-TEXT");
    expect(e).toBeDefined();
    expect(e.message).toContain('"prose then \\"quoted\\" word"');
  });
}
