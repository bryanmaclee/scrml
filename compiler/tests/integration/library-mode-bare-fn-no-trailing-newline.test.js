/**
 * library-mode-bare-fn-no-trailing-newline.test.js
 *
 * g-library-bare-fn-no-trailing-newline-brace-strip (S363-peter found, S366 fixed).
 *
 * emit-library.ts strips the `${…}` logic-wrapper as a matched pair: `${` prefix
 * off the front, its closing `}` off the back. The back-strip used to fire on any
 * `blockText.endsWith("}")`, WITHOUT checking that a `${` prefix was present. A
 * bare-fn library file (no `<program>`, no `${…}` wrapper — SPEC §21.5 pure-fn
 * module) has no wrapper, so its LAST character is the fn's OWN closing `}` — and
 * the unconditional back-strip consumed it, truncating the fn to
 * `export function add(a, b) { return a + b` → §2.2.1 E-CODEGEN-INVALID-LOGIC.
 *
 * The bug hid in the common case only because a trailing newline left the fn's
 * `}` non-final (endsWith("}") false). A file with NO trailing newline exposed it.
 *
 * Fix: pair the strips — only remove the trailing `}` when a `${` prefix was
 * actually stripped. These cases pin BOTH halves (compiles + emits valid,
 * runnable JS) and GATE the wrapped path against regression from the pairing.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { tmpdir } from "os";

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lib-bare-fn-nonl-"));
});
afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// Compile in library mode. `source` is written VERBATIM — callers that omit a
// trailing newline get a file with no trailing newline (the whole point here).
function compileLib(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    mode: "library",
    // validateEmit:true on purpose — the gap's reported symptom IS the
    // E-CODEGEN-INVALID-LOGIC emit-validation error, so the test must run the
    // gate that produces it (with it off, the truncated-JS build returns no
    // errors and `expect(errors).toEqual([])` would pass on the pre-fix compiler).
    validateEmit: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const libPath = join(outDir, `${name}.js`);
  return {
    errors: errors.map((e) => e.code),
    libPath,
    libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
  };
}

/**
 * True when `js` contains a COMPLETE `export function <name>(…) { … }`
 * declaration — head present, and the body's opening brace balanced by a closing
 * one inside the module.
 *
 * ⚑ WHY THIS IS NOT A `.toContain("export function add(a, b) { return a + b }")`.
 * It used to be, and that assertion was pinning the RAW-TEXT SLICER'S BYTE LAYOUT
 * rather than the invariant this file is named for. The gap here is that the fn's
 * own closing `}` must not be eaten as a `${…}` wrapper close — a structural
 * property, entirely indifferent to whether the emit is one line or four. When
 * S402 routed library fns through the structural emitter by default, the same fn
 * came out as `export function add(a, b) {\n  return a + b;\n}` — whole, valid,
 * callable, and failing four byte-exact assertions. Matching the layout instead
 * of the property is what made a formatting change look like a regression, so the
 * check now asserts the property.
 */
function containsWholeFn(js, name) {
  const head = new RegExp(`export function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = head.exec(js);
  if (!m) return false;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}" && --depth === 0) return true;
  }
  return false;
}

describe("g-library-bare-fn-no-trailing-newline-brace-strip", () => {
  test("bare single fn, NO trailing newline → compiles clean, fn's own brace intact, runs", async () => {
    const src = `export fn add(a, b) { return a + b }`; // NB: no trailing newline
    const r = compileLib("bare_no_nl", src);
    expect(r.errors).toEqual([]); // was [E-CODEGEN-INVALID-LOGIC]
    expect(r.libExists).toBe(true);
    // The fn is emitted whole — its closing brace was NOT consumed as a wrapper `}`.
    expect(containsWholeFn(r.libraryJs, "add")).toBe(true);
    // Runtime half: the emitted module imports and the fn is callable.
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
  });

  test("bare single fn, WITH trailing newline → identical clean result (control)", async () => {
    const src = `export fn add(a, b) { return a + b }\n`;
    const r = compileLib("bare_with_nl", src);
    expect(r.errors).toEqual([]);
    expect(containsWholeFn(r.libraryJs, "add")).toBe(true);
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
  });

  test("two bare fns, NO trailing newline → both braces intact, both callable", async () => {
    const src = `export fn add(a, b) { return a + b }\nexport fn mul(a, b) { return a * b }`;
    const r = compileLib("two_bare_no_nl", src);
    expect(r.errors).toEqual([]);
    expect(containsWholeFn(r.libraryJs, "add")).toBe(true);
    expect(containsWholeFn(r.libraryJs, "mul")).toBe(true);
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
    expect(m.mul(2, 3)).toBe(6);
  });

  // REGRESSION GATE — the pairing must NOT change the wrapped-logic path. A
  // `${…}` wrapper with NO trailing newline still has its wrapper `}` stripped
  // (startsWith("${") is true), leaving both fns' own braces intact.
  test("GATE: `${…}` wrapper, NO trailing newline → wrapper stripped, inner fns intact", async () => {
    const src = `\${\n  export fn add(a, b) { return a + b }\n  export fn mul(a, b) { return a * b }\n}`;
    const r = compileLib("wrapped_no_nl", src);
    expect(r.errors).toEqual([]);
    expect(containsWholeFn(r.libraryJs, "add")).toBe(true);
    expect(containsWholeFn(r.libraryJs, "mul")).toBe(true);
    // No dangling wrapper artifact. This used to be `not.toMatch(/^\}\s*$/m)` —
    // "no `}` alone on a line" — which reads as a leak check but is really a
    // layout check: a structurally-emitted fn closes with exactly that, and did
    // once S402 routed library fns by default. The property actually wanted is
    // that no brace is UNMATCHED, so count them.
    const opens = (r.libraryJs.match(/\{/g) || []).length;
    const closes = (r.libraryJs.match(/\}/g) || []).length;
    expect(closes).toBe(opens);
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
    expect(m.mul(2, 3)).toBe(6);
  });
});
