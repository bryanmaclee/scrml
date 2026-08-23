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

describe("g-library-bare-fn-no-trailing-newline-brace-strip", () => {
  test("bare single fn, NO trailing newline → compiles clean, fn's own brace intact, runs", async () => {
    const src = `export fn add(a, b) { return a + b }`; // NB: no trailing newline
    const r = compileLib("bare_no_nl", src);
    expect(r.errors).toEqual([]); // was [E-CODEGEN-INVALID-LOGIC]
    expect(r.libExists).toBe(true);
    // The fn is emitted whole — its closing brace was NOT consumed as a wrapper `}`.
    expect(r.libraryJs).toContain("export function add(a, b) { return a + b }");
    // Runtime half: the emitted module imports and the fn is callable.
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
  });

  test("bare single fn, WITH trailing newline → identical clean result (control)", async () => {
    const src = `export fn add(a, b) { return a + b }\n`;
    const r = compileLib("bare_with_nl", src);
    expect(r.errors).toEqual([]);
    expect(r.libraryJs).toContain("export function add(a, b) { return a + b }");
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
  });

  test("two bare fns, NO trailing newline → both braces intact, both callable", async () => {
    const src = `export fn add(a, b) { return a + b }\nexport fn mul(a, b) { return a * b }`;
    const r = compileLib("two_bare_no_nl", src);
    expect(r.errors).toEqual([]);
    expect(r.libraryJs).toContain("export function add(a, b) { return a + b }");
    expect(r.libraryJs).toContain("export function mul(a, b) { return a * b }");
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
    expect(r.libraryJs).toContain("export function add(a, b) { return a + b }");
    expect(r.libraryJs).toContain("export function mul(a, b) { return a * b }");
    // No dangling wrapper artifact: the emitted module has no stray top-level `}`
    // on its own line where the wrapper close would have leaked.
    expect(r.libraryJs).not.toMatch(/^\}\s*$/m);
    const m = await import(pathToFileURL(r.libPath).href);
    expect(m.add(2, 3)).toBe(5);
    expect(m.mul(2, 3)).toBe(6);
  });
});
