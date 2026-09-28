/**
 * s440-f18 — `~` placeholder leaked into string / template / regex literals.
 *
 * preprocessForAcorn (compiler/src/expression-parser.ts) rewrites the §32
 * pipeline-accumulator keyword `~` to the placeholder identifier
 * `__scrml_tilde__` BEFORE acorn tokenizes (acorn cannot parse a bare `~`).
 * The rewrite ran as an UNFENCED whole-string replace, so a literal whose
 * content was a standalone `~` was silently corrupted:
 *
 *   function f() { return "~" }   →   return "__scrml_tilde__";
 *
 * The reverse mapping is structural (Identifier nodes only), so the
 * placeholder buried in a parsed STRING was unreachable and leaked into the
 * emitted runtime value. Fix: route the rewrite through rewriteCodeSegments
 * (the shared literal/comment fence already used by the bare-variant, `not`
 * and `or`/`and` passes in the same function).
 *
 * Three sibling unfenced rewrites in the same pre-pass had the identical
 * one-line bug and are fenced in the same change:
 *   - `render name(` → `__scrml_render_name__(`   (`"render foo("`)
 *   - `::Upper`      → `.Upper`                   (`"a::B"`)
 *   - `? .x`         → `?.x`                      (`"why? .x"`)
 *
 * SPEC authority: §32 (`~` keyword) — `~` is a keyword in CODE position only;
 * a literal's content is data.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import fs from "fs";
import path from "path";
import os from "os";

function compileLogic(logicBody, call) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tilde-fence-"));
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

describe("§1 — `~` inside a literal is data, not the accumulator (end-to-end)", () => {
  const cases = [
    ["double-quoted \"~\" (the f18 repro)", 'function f() { return "~" }', /return "~";/],
    ["single-quoted '~'", "function f() { return '~' }", /return '~';|return "~";/],
    ["no-interpolation template `~`", "function f() { return `~` }", /return `~`;/],
    ["interpolated template `a${x}~` (static span)", "function f(x) { return `a${x}~` }", /return `a\$\{x\}~`;/],
    ["\"a~b\" (control — never matched)", 'function f() { return "a~b" }', /return "a~b";/],
    ["regex literal /~/", "function f(t) { return /~/.test(t) }", /return \/~\/\.test\(t\);/],
  ];
  for (const [name, body, expected] of cases) {
    test(name, () => {
      const { client } = compileLogic(body, "f(1)");
      expect(client).not.toBeNull();
      expect(client).not.toContain("__scrml_tilde__");
      expect(client).toMatch(expected);
    });
  }

  test("`~` in a // comment does not corrupt the function", () => {
    const { client } = compileLogic("function f() {\n  // a ~ here\n  return 1\n}", "f()");
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_tilde__");
    expect(client).toMatch(/return 1;/);
  });

  test("reverse direction: a string literally containing __scrml_tilde__ stays verbatim", () => {
    const { client } = compileLogic('function f() { return "__scrml_tilde__" }', "f()");
    expect(client).not.toBeNull();
    expect(client).toMatch(/return "__scrml_tilde__";/);
    expect(client).not.toMatch(/return "~";/);
  });
});

describe("§2 — parser level: literal content round-trips", () => {
  test('"~" parses as a string lit with value ~', () => {
    const n = parseExprToNode('"~"', "t.scrml", 0);
    expect(n.kind).toBe("lit");
    expect(n.value).toBe("~");
  });
  test("`~` parses as a template lit with value ~", () => {
    const n = parseExprToNode("`~`", "t.scrml", 0);
    expect(n.kind).toBe("lit");
    expect(n.value).toBe("~");
  });
  test("bare ~ still parses as the accumulator ident", () => {
    const n = parseExprToNode("~", "t.scrml", 0);
    expect(n.kind).toBe("ident");
    expect(n.name).toBe("~");
  });
  test('"~" + ~ : literal stays data, keyword stays keyword', () => {
    const n = parseExprToNode('"~" + ~', "t.scrml", 0);
    expect(n.kind).toBe("binary");
    expect(n.left.kind).toBe("lit");
    expect(n.left.value).toBe("~");
    expect(n.right.kind).toBe("ident");
    expect(n.right.name).toBe("~");
  });
  test("bitwise-NOT ~x is untouched", () => {
    const n = parseExprToNode("~x", "t.scrml", 0);
    expect(n.kind).toBe("unary");
    expect(n.op).toBe("~");
  });
});

describe("§3 — the §32 `~` keyword still works", () => {
  test("return ~ after an unassigned call", () => {
    const { client } = compileLogic(
      "function inc(x) { return x + 1 }\nfunction k() {\n  inc(1)\n  return ~\n}",
      "k()",
    );
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_tilde__");
    expect(client).toMatch(/let (_scrml_tilde_\d+) = _scrml_inc_\d+\(1\);\s*return \1;/);
  });

  test("pipeline: inc(1) then inc(~) then return ~", () => {
    const { client } = compileLogic(
      "function inc(x) { return x + 1 }\nfunction k() {\n  inc(1)\n  inc(~)\n  return ~\n}",
      "k()",
    );
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_tilde__");
    expect(client).toMatch(/let (_scrml_tilde_\d+) = _scrml_inc_\d+\(1\);\s*let (_scrml_tilde_\d+) = _scrml_inc_\d+\(\1\);\s*return \2;/);
  });

  test('"~" + ~ in one expression: literal verbatim, keyword resolved', () => {
    const { client } = compileLogic(
      "function inc(x) { return x + 1 }\nfunction k() {\n  inc(1)\n  return \"~\" + ~\n}",
      "k()",
    );
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_tilde__");
    expect(client).toMatch(/return "~" \+ _scrml_tilde_\d+;/);
  });

  test("lift in a value-if initializes ~ and return ~ reads it", () => {
    const { client } = compileLogic(
      'function k() {\n  const v = if (@s == "a") { lift 1 } else { lift 2 }\n  return ~\n}',
      "k()",
    );
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_tilde__");
    expect(client).toMatch(/const v = (_scrml_tilde_\d+);\s*return \1;/);
  });
});

describe("§4 — sibling unfenced rewrites in the same pre-pass", () => {
  test('"render foo(" stays verbatim', () => {
    const { client } = compileLogic('function f() { return "render foo(" }', "f()");
    expect(client).not.toBeNull();
    expect(client).not.toContain("__scrml_render_");
    expect(client).toMatch(/return "render foo\(";/);
  });

  test('"a::B" stays verbatim', () => {
    const { client } = compileLogic('function f() { return "a::B" }', "f()");
    expect(client).not.toBeNull();
    expect(client).toMatch(/return "a::B";/);
  });

  test('"why? .x" stays verbatim', () => {
    const { client } = compileLogic('function f() { return "why? .x" }', "f()");
    expect(client).not.toBeNull();
    expect(client).toMatch(/return "why\? \.x";/);
  });

  test("code-position Color::Green still lowers to Color.Green", () => {
    const { client } = compileLogic(
      "type Color:enum = { Red, Green }\nfunction f() { return Color::Green }",
      "f()",
    );
    expect(client).not.toBeNull();
    expect(client).toMatch(/return Color\.Green;/);
  });
});
