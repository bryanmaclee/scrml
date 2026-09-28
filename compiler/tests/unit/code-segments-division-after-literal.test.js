/**
 * s440-f18 fix round (S239 review F1/F2) — regex-vs-division context in the
 * shared `rewriteCodeSegments` fence.
 *
 * The fence decided "does this `/` open a regex?" from the CURRENT code
 * segment only. After a string / template / regex literal (or a block comment)
 * closed, the segment restarted empty, so a following division `/` looked
 * expression-initial and opened a "regex"; with no later `/` the rest of the
 * expression was an unterminated regex and was passed through UNTRANSFORMED.
 * Postfix `++` / `--` ended in `+` / `-`, which also admitted a regex.
 *
 * Once f18 routed `::`, `~`, `render name(` and `? .` through the fence, this
 * became a silent wrong output:
 *
 *   function k() { return "8" / 2 + Color::Green }  →  return "8" / 2 + Color;
 *
 * Fix: the fence tracks the significant prefix across literals (a closed
 * literal is a VALUE, a comment is whitespace), and `regexAllowedAfter`
 * treats a trailing `++` / `--` as ending a value.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { rewriteCodeSegments, regexAllowedAfter } from "../../src/codegen/code-segments.ts";
import fs from "fs";
import path from "path";
import os from "os";

function compileLogic(logicBody, call) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fence-div-"));
  const srcPath = path.join(tmpDir, "t.scrml");
  const src =
    `<program>\n<s> = "a"\n\${\n${logicBody}\n}\n` +
    `<button onclick=\${@s = "" + ${call}}>x</button>\n<p>\${@s}</p>\n</program>\n`;
  fs.writeFileSync(srcPath, src);
  try {
    const r = compileScrml({ inputFiles: [srcPath], write: true, outputDir: tmpDir, log: () => {} });
    const clientPath = path.join(tmpDir, "t.client.js");
    const client = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf-8") : null;
    return { client, errors: (r.errors ?? []).map((e) => e.code) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const ENUM = "type Color:enum = { Red, Green }\n";

describe("§1 — division after a closed literal / postfix op is division (end-to-end)", () => {
  const cases = [
    ['string "8" / 2 + Color::Green', 'function k() { return "8" / 2 + Color::Green }', "k()", /return "8" \/ 2 \+ Color\.Green;/],
    ["template `${n}` / 2 + Color::Green", "function k(n) { return `${n}` / 2 + Color::Green }", "k(1)", /return `\$\{n\}` \/ 2 \+ Color\.Green;/],
    ["regex /a/ / 2 + Color::Green", "function k() { return /a/ / 2 + Color::Green }", "k()", /return \/a\/ \/ 2 \+ Color\.Green;/],
    ["i++ / 2 + Color::Green", "function k() { let i = 4\n return i++ / 2 + Color::Green }", "k()", /return i\+\+ \/ 2 \+ Color\.Green;/],
    ["i-- / 2 + Color::Green", "function k() { let i = 4\n return i-- / 2 + Color::Green }", "k()", /return i-- \/ 2 \+ Color\.Green;/],
  ];
  for (const [name, body, call, expected] of cases) {
    test(name, () => {
      const { client } = compileLogic(ENUM + body, call);
      expect(client).not.toBeNull();
      expect(client).toMatch(expected);
    });
  }

  test('"8" / 2 + ~ resolves the accumulator (was E-CODEGEN-INVALID-LOGIC)', () => {
    const { client, errors } = compileLogic(
      "function inc(x) { return x + 1 }\nfunction k() {\n  inc(1)\n  return \"8\" / 2 + ~\n}",
      "k()",
    );
    expect(errors).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_tilde__");
    expect(client).toMatch(/return "8" \/ 2 \+ _scrml_tilde_\d+;/);
  });

  test('"8" / 2 + o? .x collapses the optional chain (was E-CODEGEN-INVALID-LOGIC)', () => {
    const { client, errors } = compileLogic(
      'function k(o) { return "8" / 2 + o? .x }',
      "k(1)",
    );
    expect(errors).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(client).not.toBeNull();
    expect(client).toMatch(/return "8" \/ 2 \+ o\?\.x;/);
  });
});

describe("§2 — parser level", () => {
  test('"x" / 2 + render foo(1) keeps the call', () => {
    const n = parseExprToNode('"x" / 2 + render foo(1)', "t.scrml", 0);
    expect(n.kind).toBe("binary");
    expect(n.right.kind).toBe("call");
  });

  test("F2: a /* c */ / b + ~ parses (block comment close does not reset the prefix)", () => {
    const n = parseExprToNode("a /* c */ / b + ~", "t.scrml", 0);
    expect(n.kind).toBe("binary");
    expect(n.right.kind).toBe("ident");
    expect(n.right.name).toBe("~");
  });
});

describe("§3 — fence unit level", () => {
  const upper = (c) => c.toUpperCase();
  test('division after a string closes: the tail is code', () => {
    expect(rewriteCodeSegments('"a" / b + c', upper)).toBe('"a" / B + C');
  });
  test("division after a template closes", () => {
    expect(rewriteCodeSegments("`a` / b + c", upper)).toBe("`a` / B + C");
  });
  test("division after a regex closes", () => {
    expect(rewriteCodeSegments("/a/g / b + c", upper)).toBe("/a/g / B + C");
  });
  test("division after a block comment", () => {
    expect(rewriteCodeSegments("a /* x */ / b + c", upper)).toBe("A /* x */ / B + C");
  });
  test("division after postfix ++ / --", () => {
    expect(rewriteCodeSegments("i++ / b + c", upper)).toBe("I++ / B + C");
    expect(rewriteCodeSegments("i-- / b + c", upper)).toBe("I-- / B + C");
  });
  test("division inside a template interpolation after a string", () => {
    expect(rewriteCodeSegments('`${"a" / b + c}`', upper)).toBe('`${"a" / B + C}`');
  });
  test("regexAllowedAfter: ++ / -- end a value; binary + / - do not", () => {
    expect(regexAllowedAfter("i++")).toBe(false);
    expect(regexAllowedAfter("i--")).toBe(false);
    expect(regexAllowedAfter("a +")).toBe(true);
    expect(regexAllowedAfter("a -")).toBe(true);
  });
});

describe("§4 — regex forms stay regexes (content not transformed)", () => {
  const upper = (c) => c.toUpperCase();
  const cases = [
    ["return /re/.test(s)", "RETURN /re/.TEST(S)"],
    ['/"/.test(s)', '/"/.TEST(S)'],
    ['s.replace(/a/g, "b")', 'S.REPLACE(/a/g, "b")'],
    ["x = (/a/)", "X = (/a/)"],
    ["[/a/, /b/]", "[/a/, /b/]"],
    ["f(/x/)", "F(/x/)"],
    ['"s" + /x/.source', '"s" + /x/.SOURCE'],
    ["a; /x/.test(s)", "A; /x/.TEST(S)"],
  ];
  for (const [src, out] of cases) {
    test(src, () => {
      expect(rewriteCodeSegments(src, upper)).toBe(out);
    });
  }

  // NB: a regex whose body STARTS with `::Upper` (`/::A/`) is corrupted to
  // `/"A"/` by a separate, pre-existing codegen pass (rewrite.ts, filed as
  // g-codegen-enum-colon-rewrite-unfenced) — so this probe keeps a char before `::`.
  test("end-to-end: regex with ~ / :: content stays verbatim", () => {
    const { client } = compileLogic(
      ENUM + 'function k(s) { return /x ~ x::A/.test(s) ? Color::Green : Color::Red }',
      'k("x")',
    );
    expect(client).not.toBeNull();
    expect(client).toMatch(/\/x ~ x::A\/\.test\(s\) \? Color\.Green : Color\.Red/);
  });
});
