/**
 * ss2 item 4 — engine state-child `:`-shorthand RENDER BODY (§51.0.I), S209.
 *
 * THE BUG: a `:`-shorthand display-text body on an ENGINE state-child (the
 * `<Variant ...> : "text">` form — `:` AFTER the opener attrs, §51.0.I) was
 * SILENTLY DROPPED from rendered output. Both pure literals AND `${...}`
 * interpolations vanished. Compiled with 0 errors; the arm rendered empty.
 *
 * ROOT CAUSE (emit-engine.ts buildEngineArms): the arm render body was derived
 * solely from the ast-builder's `match.children`. For a `:`-shorthand
 * state-child those children are EMPTY (the structural parser does NOT lower the
 * shorthand into child nodes — the body text lives only on `sc.bodyRaw` with
 * `sc.isColonShorthand === true`). So the arm body was `[]` → nothing rendered.
 *
 * THE FIX (mirror of g-shorthand-interp-match-arm-codegen, S196 Bucket 4): when
 * `sc.isColonShorthand`, derive the body from `sc.bodyRaw` —
 *   - §4.18.3 display-text literal (`"..."` / `"...${interp}..."`) → route the
 *     INNER through the SAME free-text fragment lowering the bare-body form uses
 *     (nativeParseFile) so literal segments HTML-escape (§4.18.6) and `${...}`
 *     interpolations wire (§4.18.4) — byte-equivalent to `<Variant ...>...</>`.
 *   - markup-as-value (`<p>x</p>`) → bare-body markup parser.
 *   - bare value-expression (`@label`) → parseExprToNode → synth logic > bare-expr.
 *
 * Full-pipeline (compileScrml) — the lowering runs over the real AST at codegen.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function compileSrc(src, baseName) {
  const tmp = join(tmpdir(), `scrml-engine-shorthand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

// Extract a single engine render fn body (variant-suffixed name; the engine
// varname segment is lowercased in the fn name). Returns the function-source or
// null. Tolerant of the numeric/casing variation in the engine name segment.
function renderFnBody(clientJs, tag) {
  const m = clientJs.match(new RegExp(`function _scrml_engine_[A-Za-z0-9_]*_render_${tag}\\(\\)\\s*\\{(.*?)\\n\\}`, "s"));
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// §1: pure-literal shorthand arm — the escaped literal is in the render fn
// ---------------------------------------------------------------------------

describe("engine-shorthand-body-render §1: pure-literal `:`-shorthand arm renders", () => {
  const src = [
    `<program title="i4a">`,
    `\${ type Phase:enum = { Loading, Empty, Editing } }`,
    `<engine for=Phase initial=.Loading>`,
    `  <Loading rule=(.Empty | .Editing) : "Loading...">`,
    `  <Empty rule=.Editing : "No tasks yet.">`,
    `  <Editing rule=.Empty : "done">`,
    `</>`,
    `</program>`,
  ].join("\n");

  test("compiles clean", () => {
    const { result, cleanup } = compileSrc(src, "esb-1-clean");
    expect(errorCodes(result)).toHaveLength(0);
    cleanup();
  });

  test("each pure-literal shorthand body appears in its render fn (not dropped)", () => {
    const { clientJs, cleanup } = compileSrc(src, "esb-1-lit");
    expect(clientJs).toContain("Loading...");
    expect(clientJs).toContain("No tasks yet.");
    expect(clientJs).toContain("done");
    // and the literal is the render fn's return value, not stray text
    const loading = renderFnBody(clientJs, "Loading");
    expect(loading).not.toBeNull();
    expect(loading).toContain("Loading...");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §2: `${...}` interp shorthand arm — the interp WIRES (not emitted literally)
// ---------------------------------------------------------------------------

describe("engine-shorthand-body-render §2: `${...}` interp `:`-shorthand arm wires", () => {
  const src = [
    `<program title="i4b">`,
    `\${ type Phase:enum = { Editing }`,
    `   <count>: number = 3 }`,
    `<engine for=Phase initial=.Editing>`,
    `  <Editing rule=.Editing : "\${@count} items">`,
    `</>`,
    `</program>`,
  ].join("\n");

  test("compiles clean", () => {
    const { result, cleanup } = compileSrc(src, "esb-2-clean");
    expect(errorCodes(result)).toHaveLength(0);
    cleanup();
  });

  test("the literal `${@count}` substring is ABSENT (lowered, not dead text)", () => {
    const { clientJs, cleanup } = compileSrc(src, "esb-2-noliteral");
    expect(clientJs).not.toContain("${@count}");
    cleanup();
  });

  test("the render fn emits a data-scrml-logic span + the literal ` items` segment", () => {
    const { clientJs, cleanup } = compileSrc(src, "esb-2-wire");
    const editing = renderFnBody(clientJs, "Editing");
    expect(editing).not.toBeNull();
    // <span data-scrml-logic="..."></span> items  (inner `"` backslash-escaped in JS literal)
    expect(editing).toMatch(/<span data-scrml-logic=\\"[^"\\]+\\"><\/span> items/);
    cleanup();
  });

  test("the @count interp wires via _scrml_reactive_get(\"count\")", () => {
    const { clientJs, cleanup } = compileSrc(src, "esb-2-get");
    expect(clientJs).toContain('_scrml_reactive_get("count")');
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §3: byte-equivalence to the bare-body `<Variant ...>...</>` form
// ---------------------------------------------------------------------------

describe("engine-shorthand-body-render §3: shorthand body byte-equivalent to bare-body", () => {
  const shorthand = [
    `<program title="eqa">`,
    `\${ type Phase:enum = { Editing }`,
    `   <count>: number = 3 }`,
    `<engine for=Phase initial=.Editing>`,
    `  <Editing rule=.Editing : "\${@count} items">`,
    `</>`,
    `</program>`,
  ].join("\n");
  const bareBody = [
    `<program title="eqb">`,
    `\${ type Phase:enum = { Editing }`,
    `   <count>: number = 3 }`,
    `<engine for=Phase initial=.Editing>`,
    `  <Editing rule=.Editing>\${@count} items</>`,
    `</>`,
    `</program>`,
  ].join("\n");

  // Normalize the logic-id counter so the comparison is structural.
  function editingReturn(clientJs) {
    const fn = renderFnBody(clientJs, "Editing");
    if (!fn) return null;
    const m = fn.match(/return ("(?:[^"\\]|\\.)*");/);
    return m ? m[1].replace(/data-scrml-logic=\\"[^"\\]+\\"/g, 'data-scrml-logic=\\"ID\\"') : null;
  }

  test("the shorthand and bare-body render-fn return values are byte-equivalent", () => {
    const a = compileSrc(shorthand, "esb-3-short");
    const b = compileSrc(bareBody, "esb-3-bare");
    const shortRet = editingReturn(a.clientJs);
    const bareRet = editingReturn(b.clientJs);
    expect(shortRet).not.toBeNull();
    expect(bareRet).not.toBeNull();
    expect(shortRet).toBe(bareRet);
    a.cleanup(); b.cleanup();
  });
});

// ---------------------------------------------------------------------------
// §4: markup-as-value + bare-expr shorthand bodies also lower
// ---------------------------------------------------------------------------

describe("engine-shorthand-body-render §4: markup-as-value + bare-expr shorthand bodies", () => {
  test("markup-as-value shorthand (`: <strong>hi</strong>`) renders the markup", () => {
    const src = [
      `<program title="mav">`,
      `\${ type P:enum = { On, Off } }`,
      `<engine for=P initial=.On>`,
      `  <On rule=.Off : <strong>hi</strong>>`,
      `  <Off rule=.On : "off">`,
      `</>`,
      `</program>`,
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "esb-4-markup");
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    expect(clientJs).toContain("<strong>hi</strong>");
    cleanup();
  });

  test("bare-expr shorthand (`: @label`) wires a logic span (not literal text)", () => {
    const src = [
      `<program title="bex">`,
      `\${ type P:enum = { On, Off }`,
      `   <label>: string = "hi" }`,
      `<engine for=P initial=.On>`,
      `  <On rule=.Off : @label>`,
      `  <Off rule=.On : "off">`,
      `</>`,
      `</program>`,
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "esb-4-bareexpr");
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    const on = renderFnBody(clientJs, "On");
    expect(on).not.toBeNull();
    expect(on).toMatch(/data-scrml-logic/);
    expect(clientJs).toContain('_scrml_reactive_get("label")');
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §5: mixed engine — SOME arms shorthand, some bare-body — all render
// ---------------------------------------------------------------------------

describe("engine-shorthand-body-render §5: mixed shorthand + bare-body arms all render", () => {
  const src = [
    `<program title="mix">`,
    `\${ type Phase:enum = { Loading, Empty, Editing }`,
    `   <count>: number = 2 }`,
    `<engine for=Phase initial=.Loading>`,
    `  <Loading rule=(.Empty | .Editing) : "Loading...">`,
    `  <Empty rule=.Editing><p>No tasks yet.</p></>`,
    `  <Editing rule=.Empty : "\${@count} items">`,
    `</>`,
    `</program>`,
  ].join("\n");

  test("compiles clean", () => {
    const { result, cleanup } = compileSrc(src, "esb-5-clean");
    expect(errorCodes(result)).toHaveLength(0);
    cleanup();
  });

  test("the shorthand-literal, bare-body, AND shorthand-interp arms all render", () => {
    const { clientJs, cleanup } = compileSrc(src, "esb-5-all");
    expect(clientJs).toContain("Loading...");          // shorthand literal
    expect(clientJs).toContain("<p>No tasks yet.</p>"); // bare-body markup
    expect(clientJs).toContain('_scrml_reactive_get("count")'); // shorthand interp wire
    expect(clientJs).not.toContain("${@count}");        // interp NOT emitted literally
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §6: emitted client.js is `node --check`-clean (no E-CODEGEN-INVALID-JS shape)
// ---------------------------------------------------------------------------

describe("engine-shorthand-body-render §6: emitted client.js is syntactically valid", () => {
  test("a multi-arm shorthand engine emits node --check-clean client.js", async () => {
    const src = [
      `<program title="chk">`,
      `\${ type Phase:enum = { Loading, Empty, Editing }`,
      `   <count>: number = 1 }`,
      `<engine for=Phase initial=.Loading>`,
      `  <Loading rule=(.Empty | .Editing) : "Loading...">`,
      `  <Empty rule=.Editing : "No tasks yet.">`,
      `  <Editing rule=.Empty : "\${@count} items">`,
      `</>`,
      `</program>`,
    ].join("\n");
    const tmp = join(tmpdir(), `scrml-engine-shorthand-chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const srcFile = join(tmp, "chk.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });
    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(errorCodes(result)).toHaveLength(0);
    const clientPath = join(outDir, "chk.client.js");
    // node --check parses without executing; a syntax error exits non-zero.
    const proc = Bun.spawnSync(["node", "--check", clientPath]);
    if (proc.exitCode !== 0) {
      // surface the parse error for the failure message
      throw new Error(`node --check failed:\n${new TextDecoder().decode(proc.stderr)}`);
    }
    expect(proc.exitCode).toBe(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});
