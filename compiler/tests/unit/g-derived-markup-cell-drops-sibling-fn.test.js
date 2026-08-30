/**
 * g-derived-markup-cell-drops-sibling-fn — regression gate.
 *
 * BUG: a Shape-3 markup-typed derived cell whose RHS is a TERNARY of markup arms
 *   const <badge> = @admin ? <span>ADMIN</span> : <span>USER</span>
 * declared BEFORE a sibling client `function` in the same logic block SWALLOWED
 * that function into the cell's raw init text. The `function` never became an AST
 * node, so it was never emitted — yet an `onclick=toggle()` handler still called it
 * by bare name → `ReferenceError: toggle is not defined` at click. Compiled clean,
 * zero diagnostics.
 *
 * Root (ast-builder.js collectExpr): the markup-RHS over-consumption break
 * (`markupRootClosed`) stood down for the ENTIRE remainder of the RHS once a ternary
 * opened (the forever-latched `sawTernaryAtRoot`), so after the alternate arm closed
 * the collector kept vacuuming — the following `function` was read as a function
 * EXPRESSION (the markup close `>` looked like a `>`-operator RHS context). Fix:
 * re-arm the break at ternary completion (`ternaryDepth === 0`) and reset
 * `markupRootClosed` at the `:` separator so a consequent-arm close does not trip
 * it before the alternate arm is read.
 *
 * DISCRIMINATORS (locked in as tests): a function BEFORE the cell always worked; a
 * SCALAR-armed ternary derived (`@c ? 1 : 0`) never triggered it; both ternary arms
 * must survive; and a NON-ternary markup derived + fn (the original S190 boundary)
 * must still work.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve(import.meta.dir, "..", ".tmp-derived-markup-sibling-fn");

function compileToClient(source, suffix) {
  const name = `${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = resolve(tmpRoot, name);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** The mangled name of a user fn is `_scrml_<name>_<N>`; the call site must use the
 *  SAME mangled name the definition declares (not a bare `toggle()`). */
function assertFnDefinedAndCalled(clientJs, fnName) {
  const defRe = new RegExp(`function (_scrml_${fnName}_\\d+)\\s*\\(`);
  const m = clientJs.match(defRe);
  expect(m, `expected a definition for user function \`${fnName}\``).toBeTruthy();
  const mangled = m[1];
  // The onclick handler must call the SAME emitted name…
  expect(clientJs).toContain(`${mangled}()`);
  // …and must NOT call the bare, undefined name.
  expect(clientJs).not.toContain(`function(event) { ${fnName}(); }`);
}

// The bug reproduces specifically inside an EXPLICIT `<program>${ … }` logic block
// (the reported repro shape) — that path routes the derived-cell RHS through the
// `collectExpr` markup-over-consumption boundary. Each source below wraps the logic
// in `<program>${ … }` accordingly.
const prog = (logic, markup) => `<program>\${\n${logic}\n}\n${markup}\n</program>`;

describe("g-derived-markup-cell-drops-sibling-fn", () => {
  test("markup-ternary derived cell BEFORE a fn: the fn is emitted and its handler calls the emitted name", () => {
    const src = prog(
      `  <admin> = false
  const <badge> = @admin ? <span>ADMIN</span> : <span>USER</span>
  function toggle() { @admin = !@admin }`,
      `  <button onclick=toggle()>x</button>
  <div>\${@badge}</div>`,
    );
    const { errors, clientJs } = compileToClient(src, "sibling-fn");
    expect(errors.filter(e => e.code && e.code.startsWith("E-"))).toHaveLength(0);
    assertFnDefinedAndCalled(clientJs, "toggle");
    // Both ternary arms survive (no dropped alternate).
    expect(clientJs).toContain('document.createTextNode("ADMIN")');
    expect(clientJs).toContain('document.createTextNode("USER")');
  });

  test("TWO functions after the markup-ternary cell are both emitted", () => {
    const src = prog(
      `  <admin> = false
  const <badge> = @admin ? <span>ADMIN</span> : <span>USER</span>
  function toggle() { @admin = !@admin }
  function reset2() { @admin = false }`,
      `  <button onclick=toggle()>x</button>
  <button onclick=reset2()>r</button>
  <div>\${@badge}</div>`,
    );
    const { errors, clientJs } = compileToClient(src, "two-fns");
    expect(errors.filter(e => e.code && e.code.startsWith("E-"))).toHaveLength(0);
    assertFnDefinedAndCalled(clientJs, "toggle");
    assertFnDefinedAndCalled(clientJs, "reset2");
  });

  test("discriminator: fn declared BEFORE the markup cell still works", () => {
    const src = prog(
      `  <admin> = false
  function toggle() { @admin = !@admin }
  const <badge> = @admin ? <span>ADMIN</span> : <span>USER</span>`,
      `  <button onclick=toggle()>x</button>
  <div>\${@badge}</div>`,
    );
    const { errors, clientJs } = compileToClient(src, "fn-before");
    expect(errors.filter(e => e.code && e.code.startsWith("E-"))).toHaveLength(0);
    assertFnDefinedAndCalled(clientJs, "toggle");
  });

  test("discriminator: SCALAR-armed ternary derived + fn still works", () => {
    const src = prog(
      `  <admin> = false
  const <flag> = @admin ? 1 : 0
  function toggle() { @admin = !@admin }`,
      `  <button onclick=toggle()>x</button>
  <div>\${@flag}</div>`,
    );
    const { errors, clientJs } = compileToClient(src, "scalar");
    expect(errors.filter(e => e.code && e.code.startsWith("E-"))).toHaveLength(0);
    assertFnDefinedAndCalled(clientJs, "toggle");
  });

  test("discriminator: NON-ternary markup derived + fn still works (S190 boundary)", () => {
    const src = prog(
      `  <admin> = false
  const <badge> = <span>ADMIN</span>
  function toggle() { @admin = !@admin }`,
      `  <button onclick=toggle()>x</button>
  <div>\${@badge}</div>`,
    );
    const { errors, clientJs } = compileToClient(src, "nonternary");
    expect(errors.filter(e => e.code && e.code.startsWith("E-"))).toHaveLength(0);
    assertFnDefinedAndCalled(clientJs, "toggle");
  });
});
