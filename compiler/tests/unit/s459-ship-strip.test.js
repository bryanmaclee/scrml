/**
 * S459 (SPEC §47.9.9) — the production strip of shipped browser JavaScript.
 *
 * `codegen/ship-strip.ts` removes comments and non-required whitespace by re-joining the
 * input's token stream verbatim, and ships the result only after PROVING it token-identical
 * (type, exact text, line-break-before) in every goal the input parses in. These tests pin:
 *   §1 what is removed and what survives (ASI line breaks, toolchain comments);
 *   §2 that token contents are never touched (strings / templates / regexes holding `//`,
 *      `/*`, `</script>`);
 *   §3 the fusion guards (`a - -b`, `/re/ in o`, `1 .x`, `<!--`, `-->`);
 *   §4 the fail-closed path (a candidate that is NOT token-identical never ships);
 *   §5 behaviour on executed code (the stripped program computes the same values).
 */

import { describe, test, expect } from "bun:test";
import {
  shipStrip,
  shipText,
  shipStripFallbackWarning,
} from "../../src/codegen/ship-strip.ts";

const strip = (src) => {
  const r = shipStrip(src);
  expect(r.mode).toBe("full");
  return r.text;
};

// ---------------------------------------------------------------------------
// §1 — comments go, line structure stays
// ---------------------------------------------------------------------------

describe("§1 comments and indentation are removed; line breaks that decide ASI are kept", () => {
  test("line and block comments are removed, indentation is dropped", () => {
    const src = [
      "// header comment",
      "function f(a, b) {",
      "  /* block */",
      "  return a + b; // trailing",
      "}",
      "",
    ].join("\n");
    expect(strip(src)).toBe("function f(a,b){\nreturn a+b;\n}\n");
  });

  test("a removed block comment that spanned a line stays a line break (ASI)", () => {
    // `a /*\n*/ ++b` is `a; ++b;` — the comment's line terminator ends the statement.
    const src = "let a = 1, b = 1;\na /*\n*/ ++b\n";
    const out = strip(src);
    expect(out).toBe("let a=1,b=1;\na\n++b\n");
    const run = (s) => new Function(s + "; return [a, b];")();
    expect(run(out)).toEqual(run(src));
  });

  test("a removed one-line block comment between tokens on one line is not a line break", () => {
    // `return /* x */ 5` must stay `return 5`, never `return\n5` (which returns undefined).
    const src = "function g() { return /* x */ 5 }";
    const out = strip(src);
    expect(out).toBe("function g(){return 5}");
    expect(new Function(out + "; return g();")()).toBe(5);
  });

  test("`return` followed by a newline keeps its newline (restricted production)", () => {
    const src = "function g() {\n  return\n  5\n}";
    const out = strip(src);
    expect(out).toBe("function g(){\nreturn\n5\n}");
    expect(new Function(out + "; return g();")()).toBe(undefined);
  });

  test("toolchain comments survive: /*! */, @license, __PURE__, sourceMappingURL", () => {
    const src = [
      "/*! keep me */",
      "/** @license MIT */",
      "const x = /* @__PURE__ */ make();",
      "function make() { return 1; }",
      "//# sourceMappingURL=app.client.js.map",
      "",
    ].join("\n");
    const out = strip(src);
    expect(out).toContain("/*! keep me */");
    expect(out).toContain("/** @license MIT */");
    expect(out).toContain("/* @__PURE__ */");
    expect(out).toContain("//# sourceMappingURL=app.client.js.map");
    expect(out).not.toContain("  ");
  });

  test("a hashbang line survives", () => {
    const out = strip("#!/usr/bin/env bun\n// c\nconst a = 1;\n");
    expect(out.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(out).toContain("const a=1;");
  });
});

// ---------------------------------------------------------------------------
// §2 — token contents are copied verbatim
// ---------------------------------------------------------------------------

describe("§2 strings, templates and regexes are never touched", () => {
  test("`//` and `/*` inside strings and templates are not comments", () => {
    const src = 'const u = "http://x.y/*z*/";\nconst t = `a // b /* c */ ${ u } d`;\n';
    const out = strip(src);
    expect(out).toContain('"http://x.y/*z*/"');
    expect(out).toContain("`a // b /* c */ ${u} d`");
  });

  test("template literal whitespace (including blank lines and indentation) is preserved", () => {
    const src = "const t = `line1\n\n    indented   \n`;\n";
    const out = strip(src);
    expect(out).toContain("`line1\n\n    indented   \n`");
    expect(new Function(out + "; return t;")()).toBe("line1\n\n    indented   \n");
  });

  test("regex literals holding `//`, `/*` and spaces are untouched", () => {
    const src = "const r = /a\\/\\/b|\\/\\*  c/g;\nconst s = /[/*]/;\n";
    const out = strip(src);
    expect(out).toContain("/a\\/\\/b|\\/\\*  c/g");
    expect(out).toContain("/[/*]/");
  });

  test("`</script>` inside a string is untouched", () => {
    const src = 'const h = "<p>x</p></script><script>";\n';
    expect(strip(src)).toContain('"<p>x</p></script><script>"');
  });

  test("string escapes and quote styles are kept exactly", () => {
    const src = "const a = 'it\\'s'; const b = \"\\u00e9\\n\";\n";
    const out = strip(src);
    expect(out).toContain("'it\\'s'");
    expect(out).toContain('"\\u00e9\\n"');
  });
});

// ---------------------------------------------------------------------------
// §3 — joining two tokens never fuses them
// ---------------------------------------------------------------------------

describe("§3 the join never creates a different token", () => {
  const cases = [
    ["a - -b", "a- -b"],
    ["a + +b", "a+ +b"],
    ["a - --b", "a- --b"],
    ["x = a++ + b", "x=a++ +b"],
    ["const o = 1 .toString()", "const o=1 .toString()"],
    ["const f = /re/ in o", "const f=/re/ in o"],
    ["x = a / /re/.source.length", "x=a/ /re/.source.length"],
    ["typeof x === 'y'", "typeof x==='y'"],
    ["const v = a ? .5 : 1", "const v=a? .5:1"],
  ];
  for (const [src, expected] of cases) {
    test(`${src}  ->  ${expected}`, () => {
      const r = shipStrip(src);
      expect(r.mode).toBe("full");
      expect(r.text).toBe(expected);
    });
  }

  test("`a < !--b` never becomes the script-goal HTML comment opener `<!--`", () => {
    const r = shipStrip("var a = 1, b = 3;\nvar c = a < !--b;\n");
    expect(r.mode).toBe("full");
    expect(r.text).not.toContain("<!--");
  });

  test("`a-- > b` never becomes `-->`", () => {
    const r = shipStrip("var a = 3, b = 1;\nvar c = a-- > b;\n");
    expect(r.mode).toBe("full");
    expect(r.text).not.toContain("-->");
  });

  test("`<` followed by a regex never becomes `</`", () => {
    const r = shipStrip("var c = 1 < /script>/.source.length;\n");
    expect(r.mode).toBe("full");
    expect(r.text).not.toContain("</script");
  });
});

// ---------------------------------------------------------------------------
// §4 — fail closed
// ---------------------------------------------------------------------------

describe("§4 a candidate that is not token-identical never ships", () => {
  const src = "// c\nfunction f(a) {\n  return a + 1; // c\n}\n";

  test("a corrupted full strip falls back to the comment-only form (verified)", () => {
    const r = shipStrip(src, { corruptFull: (t) => t.replace("a+1", "a+2") });
    expect(r.mode).toBe("comments");
    expect(r.reason).toContain("token stream differs");
    expect(r.text).not.toContain("// c");
    expect(r.text).toContain("return a + 1;");
  });

  test("a full strip that changes a line break (ASI) is refused", () => {
    // `return\n5` vs `return 5` — same tokens, different program.
    const s = "function g() {\n  return 5\n}\n";
    const r = shipStrip(s, { corruptFull: (t) => t.replace("return 5", "return\n5") });
    expect(r.mode).toBe("comments");
  });

  test("when both candidates are corrupt, the input ships unchanged", () => {
    const r = shipStrip(src, {
      corruptFull: (t) => t + "x",
      corruptComments: (t) => t.replace("a + 1", "a - 1"),
    });
    expect(r.mode).toBe("none");
    expect(r.text).toBe(src);
    expect(r.reason).toContain("comment-only fallback");
  });

  test("an unparseable candidate is refused", () => {
    const r = shipStrip(src, { corruptFull: (t) => t + "{" });
    expect(r.mode).toBe("comments");
    expect(r.reason).toContain("does not parse");
  });

  test("an input that does not parse is returned as is and is not reported as a strip fallback", () => {
    const r = shipStrip("function (");
    expect(r.mode).toBe("none");
    expect(r.inputParses).toBe(false);
    const seen = [];
    expect(shipText("function (", true, "x.js", (...a) => seen.push(a))).toBe("function (");
    expect(seen).toEqual([]);
  });

  test("shipText reports a fallback through the sink with the W-CG-SHIP-STRIP-FALLBACK shape", () => {
    const w = shipStripFallbackWarning("app.client.js", "comments", "why");
    expect(w.code).toBe("W-CG-SHIP-STRIP-FALLBACK");
    expect(w.message).toContain("app.client.js");
    expect(w.message).toContain("why");
  });

  test("shipText is the identity when the strip is off", () => {
    expect(shipText(src, false, "x.js")).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// §5 — executed equivalence
// ---------------------------------------------------------------------------

describe("§5 the stripped program computes the same values", () => {
  test("a program exercising ASI, regex/division, templates and getters", () => {
    const src = `
      // a comment
      const xs = [1, 2, 3]
      const total = xs
        .map((x) => x * 2) /* doubled */
        .reduce((a, b) => a + b, 0)
      let i = 0
      i++
      const ratio = total / 2 / 3
      const re = /\\d+/g
      const found = "a1b22c333".match(re).join("|")
      const tpl = \`total=\${ total } ratio=\${ ratio.toFixed(2) }\`
      const o = { get v() { return i } }
      function g() {
        return (
          o.v + 1
        )
      }
      return [total, i, ratio, found, tpl, g()]
    `;
    // A top-level `return` parses in neither goal, so the body is shipped inside a function.
    const prog = `(function () {${src}})()`;
    const out = strip(prog);
    expect(new Function("return " + out)()).toEqual(new Function("return " + prog)());
    expect(out.length).toBeLessThan(prog.length);
  });
});
