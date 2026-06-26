/**
 * library-mode-auto-detect.test.js
 *
 * W5a (g-library-mode-sql-no-db-context, ss23) — auto-detect-library.
 *
 * A `.scrml` file with NO `<program>` root that bears `export`s is a library /
 * pure-fn module (SPEC §21.5). Such a file SHALL compile in library mode WITHOUT
 * the explicit `--mode library` flag: it emits an importable ES module
 * (`<base>.js`), NOT a browser page (`<base>.client.js` + `<base>.html` + a
 * runtime chunk). The library shaping it gates already exists (S145
 * library-mode-suppress-body-escalated-server-js); W5a just SETS the mode the
 * existing path already handles, by classifying the build.
 *
 * Regression guards:
 *   - a file WITH a `<program>` root still classifies as a page (browser), even
 *     though it has no exports.
 *   - an explicit `mode: "library"` still works (no double-flip, no regression).
 *   - a file with neither a `<program>` nor any exports (e.g. a bare markup
 *     fragment / page file) is NOT auto-flipped to library — auto-detect keys
 *     on the presence of exports, per §21.5 pure-fn-module shape.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lib-auto-detect-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// Compile WITHOUT specifying mode — exercises the default-browser + auto-detect
// path. `mode` is left unset so the api.js default ('browser') applies unless
// auto-detect flips it.
function compileNoMode(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    validateEmit: false,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  return {
    errors: errors.map((e) => e.code),
    outDir,
    libPath: join(outDir, `${name}.js`),
    clientPath: join(outDir, `${name}.client.js`),
    htmlPath: join(outDir, `${name}.html`),
    libExists: existsSync(join(outDir, `${name}.js`)),
    clientExists: existsSync(join(outDir, `${name}.client.js`)),
    htmlExists: existsSync(join(outDir, `${name}.html`)),
    libraryJs: existsSync(join(outDir, `${name}.js`))
      ? readFileSync(join(outDir, `${name}.js`), "utf8")
      : "",
  };
}

function compileWithMode(name, source, mode) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    mode,
    validateEmit: false,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  return {
    errors: errors.map((e) => e.code),
    libExists: existsSync(join(outDir, `${name}.js`)),
    clientExists: existsSync(join(outDir, `${name}.client.js`)),
    libraryJs: existsSync(join(outDir, `${name}.js`))
      ? readFileSync(join(outDir, `${name}.js`), "utf8")
      : "",
  };
}

describe("W5a — auto-detect-library (no <program> + exports → library shaping without --mode)", () => {
  // §1 — the core gap: a no-<program> exports file auto-classifies as library.
  test("§1 no <program> + exports → emits <base>.js (library), NOT <base>.client.js / .html", () => {
    const src = `\${
  export function add(a, b) {
    return a + b
  }
  export function greet(name) {
    return "hi " + name
  }
}`;
    const r = compileNoMode("pure_lib", src);
    expect(r.errors).toEqual([]);
    // Library shaping: importable ES module emitted.
    expect(r.libExists).toBe(true);
    expect(r.libraryJs).toContain("export function add");
    expect(r.libraryJs).toContain("export function greet");
    // NOT browser shaping: no client bundle, no HTML page.
    expect(r.clientExists).toBe(false);
    expect(r.htmlExists).toBe(false);
  });

  // §2 — regression: a <program>-rooted file still classifies as a page.
  test("§2 <program> root → still browser (no auto-flip to library)", () => {
    const src = `<program>
  <page>
    <main>
      <h1>Hello</h1>
    </main>
  </page>
</program>`;
    const r = compileNoMode("with_program", src);
    expect(r.errors).toEqual([]);
    // Browser shaping retained.
    expect(r.clientExists).toBe(true);
    expect(r.libExists).toBe(false);
  });

  // §3 — regression: explicit mode:"library" still works (no double-flip).
  test("§3 explicit mode:library still emits library .js", () => {
    const src = `\${
  export function mul(a, b) {
    return a * b
  }
}`;
    const r = compileWithMode("explicit_lib", src, "library");
    expect(r.errors).toEqual([]);
    expect(r.libExists).toBe(true);
    expect(r.libraryJs).toContain("export function mul");
    expect(r.clientExists).toBe(false);
  });

  // §4 — regression: a no-<program> file with NO exports is NOT auto-flipped.
  //      Auto-detect keys on the §21.5 pure-fn-module shape (exports present).
  test("§4 no <program> + no exports → NOT auto-flipped to library", () => {
    const src = `\${
  function helper(x) {
    return x + 1
  }
}`;
    const r = compileNoMode("no_exports", src);
    // No library .js emitted — the file is not a pure-fn module (no exports).
    expect(r.libExists).toBe(false);
  });
});
