/**
 * giti-039-markup-text-verbatim.test.js — regression gate for GITI-039.
 *
 * BUG: literal markup TEXT content inside a `${...}`-interpolated markup VALUE
 * (ternary arm, derived-cell markup ternary, per-item `<each>` ternary, match-arm
 * markup-value, etc.) was run through collectExpr's token collector, whose
 * `joinWithNewlines` reassembled same-line tokens with a SPACE between them
 * BEFORE parseExprWithMarkupValues re-sliced the markup out. So a dotted literal
 * like `a.txt` (tokens `a` `.` `txt`, all same-line, source-adjacent) became
 *   createTextNode("a . txt")            (Defect A — silent, exit 0)
 * and punctuation inside the text (`;`) hit collectExpr's depth-0 `;` statement-
 * boundary break (NOT angleDepth-guarded), truncating collection mid-markup so
 * the element never closed → acorn escape-hatch → E-CODEGEN-INVALID-LOGIC
 *   (Defect B — hard fail, exit 2).
 * The STATIC markup path (`<p>a.txt</p>` outside a `${}`) was always correct
 * because it uses parseLiftTag's span-gap-aware text coalescing.
 *
 * FIX (ast-builder.js): joinWithNewlines is span-adjacency-aware inside markup
 * regions (a partSpans array records each markup-region token's source span);
 * two source-adjacent markup tokens rejoin with NO separator — mirroring
 * parseLiftTag. Scoped to markup (angleDepth>0) ONLY, so pure-expression rejoin
 * stays byte-identical. The depth-0 `;` break is additionally angleDepth-guarded
 * so a `;` inside markup text is treated as literal text, not a boundary.
 *
 * These tests observe the EMITTED text (createTextNode / html), the strongest
 * signal — a green AST alone would not have caught the mangle.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compile(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-giti039-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const DOTTED = "Read a.txt v1.2.3";
const MANGLED = "a . txt"; // the pre-fix corruption signature

describe("GITI-039 — literal markup TEXT verbatim in dynamic-markup emit", () => {
  test("Defect A — ternary-arm markup value: dotted text is emitted VERBATIM", () => {
    const src = [
      "<program>",
      "  <n> = 1",
      '  <div>${ @n > 0 ? <p>Read a.txt v1.2.3</p> : "" }</div>',
      "</program>",
    ].join("\n");
    const { errors, clientJs } = compile(src, "ternary-arm");
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toHaveLength(0);
    expect(clientJs).toContain(`createTextNode("${DOTTED}")`);
    expect(clientJs).not.toContain(MANGLED);
  });

  test("Defect B — punctuation inside markup text compiles (exit 0) and stays VERBATIM", () => {
    const src = [
      "<program>",
      "  <n> = 1",
      '  <div>${ @n > 0 ? <p>Comma, bang! query? colon: semi;</p> : "" }</div>',
      "</program>",
    ].join("\n");
    const { errors, clientJs } = compile(src, "punct");
    // Pre-fix this produced E-CODEGEN-INVALID-LOGIC (the `;` truncated collection).
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toHaveLength(0);
    expect(clientJs).toContain('createTextNode("Comma, bang! query? colon: semi;")');
  });

  test("derived-cell markup ternary: dotted text VERBATIM", () => {
    const src = [
      "<program>",
      "  <n> = 1",
      "  const <badge> = @n > 0 ? <span>Read a.txt v1.2.3</span> : <span>none</span>",
      "  <div>${@badge}</div>",
      "</program>",
    ].join("\n");
    const { errors, clientJs } = compile(src, "derived");
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toHaveLength(0);
    expect(clientJs).toContain(`createTextNode("${DOTTED}")`);
    expect(clientJs).not.toContain(MANGLED);
  });

  test("<each> per-item markup-value ternary: dotted text VERBATIM", () => {
    const src = [
      "<program>",
      "  <items> = [ { on: true } ]",
      "  <ul>",
      "    <each in=@items>",
      '      ${ @.on ? <span>Read a.txt v1.2.3</span> : "" }',
      "    </each>",
      "  </ul>",
      "</program>",
    ].join("\n");
    const { errors, clientJs } = compile(src, "each");
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toHaveLength(0);
    expect(clientJs).toContain(`createTextNode("${DOTTED}")`);
    expect(clientJs).not.toContain(MANGLED);
  });

  test("match-arm markup-value (variant-guard emit path): dotted text VERBATIM", () => {
    const src = [
      "<program>",
      "  type P:enum = { Loading  Loaded(d: string) }",
      '  <x> = P.Loaded("yes")',
      "  <div>",
      "    <match for=P on=@x>",
      "      <Loading><p>loading</p></Loading>",
      '      <Loaded(d)>${ d == "yes" ? <p>Read a.txt v1.2.3</p> : "" }</Loaded>',
      "    </match>",
      "  </div>",
      "</program>",
    ].join("\n");
    const { errors, clientJs } = compile(src, "match");
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toHaveLength(0);
    expect(clientJs).toContain(`createTextNode("${DOTTED}")`);
    expect(clientJs).not.toContain(MANGLED);
  });

  test("STATIC control — markup TEXT outside a ternary stays verbatim (unchanged)", () => {
    const src = [
      "<program>",
      "  <p>Read a.txt v1.2.3</p>",
      "</program>",
    ].join("\n");
    const { errors, html } = compile(src, "static");
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toHaveLength(0);
    expect(html).toContain("<p>Read a.txt v1.2.3</p>");
  });
});
