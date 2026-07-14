/**
 * ast-builder-parseparamlist-destructure — A5-FUP regression suite (2026-05-17).
 *
 * Bug (A5 follow-up): parseParamList did not recognise `[` / `{` at param-start
 * position. Source like `function f([a, b])` accumulated raw text into the
 * `cur` buffer; pushParam treated it as a bare identifier; the param entry was
 * `{ name: "[ a , b ]" }`. Downstream codegen rendered the param as
 * `[object Object]` once the structured form leaked through, and the scope
 * walker bound the malformed name (so body references like `a` surfaced as
 * E-SCOPE-001).
 *
 * Fix (this suite verifies): parseParamList peeks for `[`/`{` (with optional
 * `lin` prefix) at each param-start boundary and routes through
 * parseDestructurePattern. The resulting structured DestructurePattern AST
 * node is stored on `param.name` (replacing the bare-string path).
 *
 * Composition coverage:
 *   - Array / object / shorthand / rename
 *   - Array rest / object rest
 *   - Default for entire pattern (`function f({a, b} = {a:0,b:0})`)
 *   - Default inside pattern (handled by parseDestructurePattern itself)
 *   - Nested patterns (`function f([a, [b, c]])`)
 *   - Mixed bare + destructured params
 *   - Typed bare + destructured combination
 *   - `fn` keyword form
 *   - `lin` prefix
 *   - End-to-end compile: body scope (no E-SCOPE-001) + valid JS output
 *
 * Param shape per the A5 + A3 conventions:
 *   { name: string | DestructurePattern,   // ← A5-FUP: structured form
 *     typeAnnotation?: string,
 *     defaultValue?: string,
 *     isLin?: boolean }
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

function parse(src) {
  const filePath = "/test/fixture.scrml";
  const bs = splitBlocks(filePath, src);
  return buildAST(bs);
}

function findAllNodesOfKind(ast, kind) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.kind === kind) out.push(n);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && k !== "span") walk(v);
    }
  }
  walk(ast);
  return out;
}

function getFn(result, name) {
  const fns = findAllNodesOfKind(result.ast, "function-decl");
  return fns.find((f) => f.name === name);
}

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a complete scrml source string via the production pipeline (disk-tmp).
 * Returns { errors, clientJs } for assertions.
 */
function compileSource(scrmlSource, testName) {
  const dir = resolve(testDir, `_tmp_a5fup_${testName}_${++tmpCounter}`);
  const tmpInput = resolve(dir, `${testName}.scrml`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(dir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(testName)) {
        clientJs = output.clientJs ?? output.libraryJs ?? null;
      }
    }
    return {
      errors: result.errors ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §A — Array destructure params
// ---------------------------------------------------------------------------

describe("§A: array destructure params", () => {
  test("§A.1 — function f([a, b]) — bare array destructure", () => {
    const result = parse("${ function f([a, b]) { return a } }");
    const fn = getFn(result, "f");
    expect(fn).toBeDefined();
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-array",
      elements: [
        { kind: "name", name: "a" },
        { kind: "name", name: "b" },
      ],
    });
  });

  test("§A.2 — function f([a, b, c]) — three elements", () => {
    const result = parse("${ function f([a, b, c]) { return a } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name.kind).toBe("destructure-array");
    expect(fn.params[0].name.elements.map((e) => e.name)).toEqual(["a", "b", "c"]);
  });

  test("§A.3 — function f([a, ...rest]) — array rest", () => {
    const result = parse("${ function f([a, ...rest]) { return a } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-array",
      elements: [{ kind: "name", name: "a" }],
      rest: "rest",
    });
  });

  test("§A.4 — function f([a, [b, c]]) — nested array destructure", () => {
    const result = parse("${ function f([a, [b, c]]) { return a } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-array",
      elements: [
        { kind: "name", name: "a" },
        {
          kind: "nested",
          pattern: {
            kind: "destructure-array",
            elements: [
              { kind: "name", name: "b" },
              { kind: "name", name: "c" },
            ],
          },
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// §B — Object destructure params
// ---------------------------------------------------------------------------

describe("§B: object destructure params", () => {
  test("§B.1 — function f({a, b}) — shorthand bindings", () => {
    const result = parse("${ function f({a, b}) { return a } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-object",
      properties: [
        { kind: "name", fieldName: "a", bindName: "a" },
        { kind: "name", fieldName: "b", bindName: "b" },
      ],
    });
  });

  test("§B.2 — function f({a, b: ren}) — rename binding", () => {
    const result = parse("${ function f({a, b: ren}) { return ren } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-object",
      properties: [
        { kind: "name", fieldName: "a", bindName: "a" },
        { kind: "name", fieldName: "b", bindName: "ren" },
      ],
    });
  });

  test("§B.3 — function f({a, ...rest}) — object rest", () => {
    const result = parse("${ function f({a, ...rest}) { return a } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-object",
      properties: [{ kind: "name", fieldName: "a", bindName: "a" }],
      rest: "rest",
    });
  });
});

// ---------------------------------------------------------------------------
// §C — Default-value composition
// ---------------------------------------------------------------------------

describe("§C: default-value composition", () => {
  test("§C.1 — function f({a, b = 1}) — default INSIDE pattern", () => {
    const result = parse("${ function f({a, b = 1}) { return b } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-object",
      properties: [
        { kind: "name", fieldName: "a", bindName: "a" },
        { kind: "name", fieldName: "b", bindName: "b", default: "1" },
      ],
    });
    // No defaultValue at the param level — default is intra-pattern.
    expect(fn.params[0].defaultValue).toBeUndefined();
  });

  test("§C.2 — function f({a, b} = {a:0, b:0}) — default for ENTIRE pattern", () => {
    const result = parse("${ function f({a, b} = {a:0, b:0}) { return a } }");
    const fn = getFn(result, "f");
    expect(fn.params[0].name.kind).toBe("destructure-object");
    expect(fn.params[0].defaultValue).toBeDefined();
    // Whitespace between tokens is not byte-stable; assert the meaningful content.
    expect(fn.params[0].defaultValue).toMatch(/\{\s*a\s*:\s*0\s*,\s*b\s*:\s*0\s*\}/);
  });

  test("§C.3 — function f([a, b = 0] = []) — both forms of default compose", () => {
    const result = parse("${ function f([a, b = 0] = []) { return a } }");
    const fn = getFn(result, "f");
    // Intra-pattern default on `b`:
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-array",
      elements: [
        { kind: "name", name: "a" },
        { kind: "name", name: "b", default: "0" },
      ],
    });
    // Param-level default for the whole pattern:
    expect(fn.params[0].defaultValue).toMatch(/^\[\s*\]$/);
  });
});

// ---------------------------------------------------------------------------
// §D — Mixed bare + destructured params
// ---------------------------------------------------------------------------

describe("§D: mixed bare + destructured params", () => {
  test("§D.1 — function f(x, [a, b], {c, d}) — three params, three shapes", () => {
    const result = parse("${ function f(x, [a, b], {c, d}) { return x } }");
    const fn = getFn(result, "f");
    expect(fn.params).toHaveLength(3);
    expect(fn.params[0]).toEqual({ name: "x" });
    expect(fn.params[1].name.kind).toBe("destructure-array");
    expect(fn.params[1].name.elements.map((e) => e.name)).toEqual(["a", "b"]);
    expect(fn.params[2].name.kind).toBe("destructure-object");
    expect(fn.params[2].name.properties.map((p) => p.bindName)).toEqual(["c", "d"]);
  });

  test("§D.2 — function f({a, b}, x: string) — destructured + typed bare", () => {
    const result = parse("${ function f({a, b}, x: string) { return x } }");
    const fn = getFn(result, "f");
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name.kind).toBe("destructure-object");
    expect(fn.params[1]).toEqual({ name: "x", typeAnnotation: "string" });
  });
});

// ---------------------------------------------------------------------------
// §E — `fn` keyword form
// ---------------------------------------------------------------------------

describe("§E: fn keyword + destructure", () => {
  test("§E.1 — fn f([a, b]) — array destructure on fn shortcut", () => {
    const result = parse("${ fn f([a, b]) { lift a } }");
    const fn = getFn(result, "f");
    expect(fn).toBeDefined();
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name).toMatchObject({
      kind: "destructure-array",
      elements: [
        { kind: "name", name: "a" },
        { kind: "name", name: "b" },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// §F — lin prefix + destructure
// ---------------------------------------------------------------------------

describe("§F: lin prefix + destructure", () => {
  test("§F.1 — function f(lin [a, b]) — lin prefix is preserved as isLin", () => {
    const result = parse("${ function f(lin [a, b]) { return a } }");
    const fn = getFn(result, "f");
    expect(fn).toBeDefined();
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name.kind).toBe("destructure-array");
    expect(fn.params[0].isLin).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §G — End-to-end compile: scope binding + JS output
// ---------------------------------------------------------------------------

describe("§G: end-to-end compile (scope binding + JS output)", () => {
  test("§G.1 — function f([a, b]) { return a } — body names in scope, valid JS emitted", () => {
    const src = `<program>

function f([a, b]) { return a }

\${
  const r = f([1, 2])
}

</program>
`;
    const { errors, clientJs } = compileSource(src, "g1");
    const errCodes = errors
      .filter((e) => e && e.code && /^E-/.test(e.code))
      .map((e) => e.code);
    expect(errCodes).toEqual([]);
    expect(clientJs).toBeTruthy();
    // Emitted client JS uses native JS destructuring in the signature.
    expect(clientJs).toMatch(/function\s+_scrml_f_\d+\s*\(\s*\[\s*a\s*,\s*b\s*\]\s*\)/);
  });

  test("§G.2 — function f({name, age}) — object destructure, no E-SCOPE-001", () => {
    const src = `<program>

function f({name, age}) { return name }

\${
  const r = f({name: "X", age: 1})
}

</program>
`;
    const { errors, clientJs } = compileSource(src, "g2");
    const errCodes = errors
      .filter((e) => e && e.code && /^E-/.test(e.code))
      .map((e) => e.code);
    expect(errCodes).toEqual([]);
    expect(clientJs).toMatch(/function\s+_scrml_f_\d+\s*\(\s*\{\s*name\s*,\s*age\s*\}\s*\)/);
  });

  test("§G.3 — function f({a, b} = {a:0, b:0}) — default-for-pattern composes in JS", () => {
    const src = `<program>

function f({a, b} = {a: 0, b: 0}) { return a + b }

\${
  const r = f()
}

</program>
`;
    const { errors, clientJs } = compileSource(src, "g3");
    const errCodes = errors
      .filter((e) => e && e.code && /^E-/.test(e.code))
      .map((e) => e.code);
    expect(errCodes).toEqual([]);
    // Emitted signature carries both the destructure pattern and the default.
    expect(clientJs).toMatch(
      /function\s+_scrml_f_\d+\s*\(\s*\{\s*a\s*,\s*b\s*\}\s*=\s*\{\s*a\s*:\s*0\s*,\s*b\s*:\s*0\s*\}\s*\)/
    );
  });

  test("§G.4 — function f([a, [b, c]]) — nested destructure round-trips into JS", () => {
    const src = `<program>

function f([a, [b, c]]) { return a + b + c }

\${
  const r = f([1, [2, 3]])
}

</program>
`;
    const { errors, clientJs } = compileSource(src, "g4");
    const errCodes = errors
      .filter((e) => e && e.code && /^E-/.test(e.code))
      .map((e) => e.code);
    expect(errCodes).toEqual([]);
    expect(clientJs).toMatch(
      /function\s+_scrml_f_\d+\s*\(\s*\[\s*a\s*,\s*\[\s*b\s*,\s*c\s*\]\s*\]\s*\)/
    );
  });

  test("§G.5 — mixed params bind correctly: function f(x, [a, b], {c, d})", () => {
    const src = `<program>

function f(x, [a, b], {c, d}) { return x + a + b + c + d }

\${
  const r = f(0, [1, 2], {c: 3, d: 4})
}

</program>
`;
    const { errors, clientJs } = compileSource(src, "g5");
    const errCodes = errors
      .filter((e) => e && e.code && /^E-/.test(e.code))
      .map((e) => e.code);
    expect(errCodes).toEqual([]);
    expect(clientJs).toMatch(
      /function\s+_scrml_f_\d+\s*\(\s*x\s*,\s*\[\s*a\s*,\s*b\s*\]\s*,\s*\{\s*c\s*,\s*d\s*\}\s*\)/
    );
  });
});
