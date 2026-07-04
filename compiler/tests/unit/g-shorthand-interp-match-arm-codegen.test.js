/**
 * g-shorthand-interp-match-arm-codegen (S195 MED / S196 prereq-bug Bucket 4 — H2)
 *
 * `${...}` interpolation inside a `<match>`-arm `:`-shorthand DISPLAY-TEXT LITERAL
 * (§4.18.4) was emitted LITERALLY: `<Failed reason : "Failed: ${reason}">`
 * COMPILED CLEAN but emitted `return "Failed: ${reason}"` (the `${...}` dead text,
 * no `data-scrml-logic` wire) — silent wrong output. The bare-body form
 * `<Failed reason><p>${reason}</p></>` lowered correctly.
 *
 * Root cause (emit-match.ts buildMatchArms shorthand path): a display-text literal
 * was handed to parseExprToNode, which parsed `"Failed: ${reason}"` as a plain JS
 * STRING literal (the scrml `"..."` display-text literal is template-string-shaped
 * per §4.18.4, NOT a JS double-quote string). Fix: recognise a §4.18.3 display-text
 * literal, decode its three escapes, and route its INNER content through the SAME
 * free-text fragment lowering the bare-body form uses — segments + `${...}` wire
 * byte-equivalent to the bare-body reference (§4.18.4 + §4.18.6).
 *
 * Full-pipeline (compileScrml) — the lowering runs over the real AST at codegen.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function compileSrc(src, baseName) {
  const tmp = join(tmpdir(), `scrml-g-simac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  const srcFile = join(tmp, `${baseName}.scrml`);
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
  let clientJs = "";
  try { clientJs = readFileSync(join(outDir, `${baseName}.client.js`), "utf8"); } catch { /* compile failed */ }
  return { result, clientJs, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

const errorCodes = (result) => (result.errors || []).map((e) => e.code);

// ---------------------------------------------------------------------------
// §1: the interpolation is LOWERED, not emitted literally
// ---------------------------------------------------------------------------

describe("g-shorthand-interp-match-arm-codegen §1: `${...}` is lowered", () => {
  const src = [
    "<program>",
    "  ${",
    "    type Phase:enum = { Editing, Failed(reason: string) }",
    "    <phase>: Phase = .Editing",
    "  }",
    "  <div>",
    "    <match for=Phase on=@phase>",
    "      <Editing : \"Editing...\">",
    "      <Failed reason : \"Failed: ${reason}\">",
    "    </>",
    "  </div>",
    "</program>",
  ].join("\n");

  test("compiles clean", () => {
    const { result, cleanup } = compileSrc(src, "simac-1");
    expect(result.errors ?? []).toHaveLength(0);
    cleanup();
  });

  test("the literal `${reason}` substring is ABSENT from emitted JS", () => {
    const { clientJs, cleanup } = compileSrc(src, "simac-2");
    expect(clientJs).not.toContain("${reason}");
    cleanup();
  });

  test("the Failed render emits the literal segment + a data-scrml-logic span", () => {
    const { clientJs, cleanup } = compileSrc(src, "simac-3");
    // render: "Failed: <span data-scrml-logic=\"...\"></span>" (the inner `"` is
    // backslash-escaped in the emitted JS string literal).
    expect(clientJs).toMatch(/Failed:\s*<span data-scrml-logic=\\"[^"\\]+\\"><\/span>/);
    cleanup();
  });

  test("the Failed wire renders the `reason` payload via _scrml_render_value", () => {
    const { clientJs, cleanup } = compileSrc(src, "simac-4");
    // GITI-032: arm-body `${...}` display routes through the node-aware
    // _scrml_render_value(el, v) helper (parity with the top-level S201 path),
    // NOT a bare `el.textContent =` (which would stringify a markup-value DOM
    // node). Byte-identical to textContent for string/primitive values.
    expect(clientJs).toMatch(/_scrml_render_value\(el,\s*reason\)/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §2: byte-equivalent display to the bare-body form
// ---------------------------------------------------------------------------

describe("g-shorthand-interp-match-arm-codegen §2: byte-equivalent to bare-body", () => {
  const shorthand = [
    "<program>",
    "  ${ type Phase:enum = { Failed(reason: string) }\n <phase>: Phase = .Failed(\"x\") }",
    "  <div><match for=Phase on=@phase>",
    "    <Failed reason : \"Failed: ${reason}\">",
    "  </></div>",
    "</program>",
  ].join("\n");
  const bareBody = [
    "<program>",
    "  ${ type Phase:enum = { Failed(reason: string) }\n <phase>: Phase = .Failed(\"x\") }",
    "  <div><match for=Phase on=@phase>",
    "    <Failed reason><p>Failed: ${reason}</p></>",
    "  </></div>",
    "</program>",
  ].join("\n");

  // Normalize away the function-name numeric suffix + logic-id counter so the
  // comparison is structural (render-fn body + wire-fn body), not id-identical.
  function renderFailedBody(clientJs) {
    const m = clientJs.match(/render_Failed\([^)]*\)\s*\{\s*return ("(?:[^"\\]|\\.)*");/);
    // strip the inner span's logic-id so the two forms compare structurally
    return m ? m[1].replace(/data-scrml-logic=\\"[^"\\]+\\"/g, 'data-scrml-logic=\\"ID\\"') : null;
  }

  test("shorthand render body content matches the bare-body's <p>-stripped content", () => {
    const a = compileSrc(shorthand, "simac-eq-a");
    const b = compileSrc(bareBody, "simac-eq-b");
    const shortRender = renderFailedBody(a.clientJs);
    const bareRender = renderFailedBody(b.clientJs);
    expect(shortRender).not.toBeNull();
    expect(bareRender).not.toBeNull();
    // bare-body wraps in <p>...</p>; shorthand is the unwrapped equivalent. The
    // INNER content (literal segment + the data-scrml-logic span) is identical.
    expect(bareRender).toContain("Failed: <span data-scrml-logic=\\\"ID\\\"></span>");
    expect(shortRender).toContain("Failed: <span data-scrml-logic=\\\"ID\\\"></span>");
    a.cleanup(); b.cleanup();
  });
});

// ---------------------------------------------------------------------------
// §3: NEGATIVES — plain text + value-expression shorthands unaffected
// ---------------------------------------------------------------------------

describe("g-shorthand-interp-match-arm-codegen §3: no regression on other shorthand bodies", () => {
  test("a plain display-text literal (no interp) still renders its text", () => {
    const src = [
      "<program>",
      "  ${ type S:enum = { A, B }\n <s>: S = .A }",
      "  <div><match for=S on=@s>",
      "    <A : \"hello\">",
      "    <B : \"world\">",
      "  </></div>",
      "</program>",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "simac-plain");
    expect(result.errors ?? []).toHaveLength(0);
    expect(clientJs).toContain('"hello"');
    expect(clientJs).toContain('"world"');
    cleanup();
  });

  test("a value-expression shorthand body (`: fn()`) still routes via parseExprToNode", () => {
    const src = [
      "<program>",
      "  ${ type S:enum = { A, B }\n <s>: S = .A\n fn cap() -> string { return \"c\" } }",
      "  <div><match for=S on=@s>",
      "    <A : cap()>",
      "    <B : \"plain\">",
      "  </></div>",
      "</program>",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "simac-value");
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    // the call is wired as a logic interpolation (data-scrml-logic +
    // _scrml_render_value(el, cap()) — GITI-032 node-aware display parity)
    expect(clientJs).toMatch(/_scrml_render_value\(el,\s*_scrml_cap_\d+\(\)\)/);
    cleanup();
  });

  test("a markup-as-value shorthand body (`: <p>x</p>`) still routes via the markup path", () => {
    const src = [
      "<program>",
      "  ${ type S:enum = { A, B }\n <s>: S = .A }",
      "  <div><match for=S on=@s>",
      "    <A : <strong>bold</strong>>",
      "    <B : \"plain\">",
      "  </></div>",
      "</program>",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "simac-markup");
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(clientJs).toContain("<strong>bold</strong>");
    cleanup();
  });
});
