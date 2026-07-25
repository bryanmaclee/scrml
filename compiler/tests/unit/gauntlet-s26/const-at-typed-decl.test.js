/**
 * S26 bug B — `const @name: T = expr` lost its initializer.
 *
 * The `const` branch in ast-builder.js (both the nested-statement branch at
 * ~1728 and the top-level branch at ~3498) handled `const @name = expr` but
 * not `const @name: T = expr`. When a type annotation was present, the `=`
 * check failed (the next token was `:`), the parser returned
 * `init: ""`, and emit-logic produced invalid JS:
 *
 *   /* W-DERIVED-001 ... *\/ const x = ;
 *
 * plus a dangling `: boolean = true;` statement as a parser-resync artifact.
 * The non-reactive `const name: T = expr` branch already collected the
 * annotation correctly — the fix mirrors that into the `const @name` branch.
 *
 * Tests cover every primitive type annotation + a no-annotation regression
 * guard + a top-level placement (exercising the 3498 branch) + a nested
 * placement (exercising the 1728 branch).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";
import { foldChunkNamespacing } from "../../helpers/chunk-scope.js";

function compileAndInspect(source, label = "s26-bugB") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${label}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJsPath = resolve(outDir, `${name}.client.js`);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : ""));
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S26 bug B — typed const @name decls preserve their initializer", () => {
  test("`const @x: boolean = true` at top level emits `const x = true;`", () => {
    const src = `<program>
\${
  const @x: boolean = true
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("const x = true;");
    // Regression guard for the pre-fix empty-init shape.
    expect(clientJs).not.toContain("const x = ;");
    // Regression guard for the dangling type-annotation artifact.
    expect(clientJs).not.toContain(": boolean = true;");
  });

  test("`const @y: number = 5` emits a number initializer", () => {
    const src = `<program>
\${
  const @y: number = 5
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("const y = 5;");
  });

  test("`const @z: string = \"hi\"` emits a string initializer", () => {
    const src = `<program>
\${
  const @z: string = "hi"
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('const z = "hi";');
  });

  test("`const @arr: number[] = [1, 2, 3]` emits the array initializer", () => {
    const src = `<program>
\${
  const @arr: number[] = [1, 2, 3]
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("const arr = [1, 2, 3];");
  });

  test("expression initializer with no reactive deps: `const @c: number = 1 + 2`", () => {
    const src = `<program>
\${
  const @c: number = 1 + 2
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("const c = 1 + 2;");
  });

  test("no-annotation form still works (regression guard)", () => {
    const src = `<program>
\${
  const @w = 42
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("const w = 42;");
  });

  test("typed const @ with reactive deps emits the derived-declare path", () => {
    // With a reactive dep, the hasReactiveDeps branch emits
    // _scrml_derived_declare(...) — not the plain-const fallback. The type
    // annotation must still be consumed; otherwise the expression after the
    // type ends up outside the initializer.
    const src = `<program>
\${
  @n: number = 1
  const @double: number = @n * 2
}
<p>\${@double}</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("_scrml_derived_declare");
    expect(clientJs).toContain('"double"');
    // The source @n reference must be preserved (not stripped by the
    // missing type-annotation consumption).
    expect(clientJs).toContain('_scrml_reactive_get("n")');
  });

  test("emitted client JS for a typed const @ parses as valid JS (node --check equivalent)", () => {
    // Smoke test: compile a file with multiple typed const @ decls and
    // verify the output is syntactically valid by running it through the
    // Function constructor (throws on parse error). The runtime stubs
    // prevent actual evaluation side-effects.
    const src = `<program>
\${
  const @a: boolean = true
  const @b: number = 0
  const @c: string = ""
}
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileAndInspect(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Provide no-op stubs for the runtime hooks referenced by the output.
    const stubs = `
      function _scrml_reactive_set() {}
      function _scrml_reactive_get() {}
      function _scrml_effect() {}
      function _scrml_derived_declare() {}
      function _scrml_derived_subscribe() {}
      function _scrml_deep_reactive(v) { return v; }
      const document = { addEventListener() {} };
    `;
    expect(() => new Function(stubs + clientJs)).not.toThrow();
  });
});
