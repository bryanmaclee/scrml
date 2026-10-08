/**
 * c16-refinement-runtime.test.js — A1c Step C16 unit tests
 *
 * Tests the §53 refinement-type runtime emission:
 *   §C16.1   §53.7.1 HTML attr generation: numeric range → min/max
 *   §C16.2   §53.7.1 HTML attr generation: string length → minlength/maxlength
 *   §C16.3   §53.7.1 HTML attr generation: named-shape email → type="email"
 *   §C16.4   §53.7.1 HTML attr generation: named-shape url → type="url"
 *   §C16.5   §53.7.1 HTML attr generation: integer base type → type="number"
 *   §C16.6   §53.7.1 HTML attr generation: AND composition derives both
 *   §C16.7   §53.7.1 HTML attr generation: OR composition emits no static attrs
 *   §C16.8   §53.7.1 HTML attr generation: NO emission when var has no predicate
 *   §C16.9   §53.7.3 E-CONTRACT-004-WARN: explicit type conflicts with shape-derived
 *   §C16.10  §53.7.3 E-CONTRACT-004-WARN: matching dev attr → no warning
 *   §C16.11  §53.7.3 shape-derived precedence: derived attr overrides developer attr
 *   §C16.12  §53.9.1 Locus 3: client function param boundary check emitted
 *   §C16.13  §53.9.1 Locus 3: param check throws E-CONTRACT-001-RT
 *   §C16.14  §53.9.1 Locus 3: NO emission when param has no predicate
 *   §C16.15  §53.9.3 Locus 4: function-return boundary check emitted
 *   §C16.16  §53.9.3 Locus 4: NO emission when return type is not predicated
 *   §C16.17  §53.9.3 Locus 4: returnTypeAnnotation captured by AST builder (`:` form)
 *   §C16.18  §53.9.3 Locus 4: returnTypeAnnotation captured (`->` form)
 *
 * Sub-step coverage parallels SCOPE row C16. Trusted-zone elision is OUT OF
 * SCOPE per S60 Q6 (deferred to v0.3.0); E-CONTRACT-001-RT runtime semantics
 * are tested at the emit-predicates utility level (predicate-codegen.test.js).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateHtml } from "../../src/codegen/emit-html.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { emitFunctions } from "../../src/codegen/emit-functions.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse + run SYM + run HTML gen → returns html, errors, registry, fileAST. */
function compileHtml(source, filePath = "/test/c16.scrml") {
  resetVarCounter();
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = {
    filePath,
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
  };
  runSYM({ filePath, ast: fileAST });
  const registry = new BindingRegistry();
  const errors = [];
  const html = generateHtml(fileAST.nodes, errors, false, registry, fileAST);
  return { html, errors, registry, fileAST };
}

/** Parse + run SYM + run emitFunctions → returns lines, fnNameMap, errors. */
function compileFunctions(source, filePath = "/test/c16.scrml") {
  resetVarCounter();
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = {
    filePath,
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
  };
  runSYM({ filePath, ast: fileAST });
  const errors = [];
  // Minimal CompileContext shape needed by emitFunctions
  const ctx = {
    filePath,
    fileAST,
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map() },
    errors,
    csrfEnabled: false,
    registry: new BindingRegistry(),
    analysis: {},
  };
  const { lines, fnNameMap } = emitFunctions(ctx);
  return { lines, js: lines.join("\n"), fnNameMap, errors, fileAST };
}

/** Parse only — returns the AST for direct field inspection. */
function parseOnly(source, filePath = "/test/c16.scrml") {
  resetVarCounter();
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return ast;
}

beforeEach(() => {
  resetVarCounter();
});

// ===========================================================================
// §C16.1 — §53.7.1 HTML attr generation: numeric range
// ===========================================================================

describe("C16 §C16.1 — HTML attr generation: numeric range", () => {
  test("number(>0 && <10000) on bind:value=<input> emits min='1' max='9999'", () => {
    const source = `<program>
\${
@invoiceAmount: number(>0 && <10000) = 0
}
<input type="number" bind:value=@invoiceAmount/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('min="1"');
    expect(html).toContain('max="9999"');
  });

  test("number(>=5 && <=100) emits min='5' max='100'", () => {
    const source = `<program>
\${
@score: number(>=5 && <=100) = 5
}
<input type="number" bind:value=@score/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('min="5"');
    expect(html).toContain('max="100"');
  });
});

// ===========================================================================
// §C16.2 — §53.7.1 HTML attr generation: string length
// ===========================================================================

describe("C16 §C16.2 — HTML attr generation: string length", () => {
  test("string(.length > 2 && .length < 32) emits minlength='3' maxlength='31'", () => {
    const source = `<program>
\${
@username: string(.length > 2 && .length < 32) = ""
}
<input bind:value=@username/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('minlength="3"');
    expect(html).toContain('maxlength="31"');
  });

  test("string(.length >= 8 && .length <= 64) emits minlength='8' maxlength='64'", () => {
    const source = `<program>
\${
@password: string(.length >= 8 && .length <= 64) = ""
}
<input type="password" bind:value=@password/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('minlength="8"');
    expect(html).toContain('maxlength="64"');
  });
});

// ===========================================================================
// §C16.3 — Named shape: email
// ===========================================================================

describe("C16 §C16.3 — Named shape: email", () => {
  test("string(email) emits type='email' on bind:value=<input>", () => {
    const source = `<program>
\${
@email: string(email) = ""
}
<input bind:value=@email/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('type="email"');
  });
});

// ===========================================================================
// §C16.4 — Named shape: url
// ===========================================================================

describe("C16 §C16.4 — Named shape: url", () => {
  test("string(url) emits type='url' on bind:value=<input>", () => {
    const source = `<program>
\${
@homepage: string(url) = ""
}
<input bind:value=@homepage/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('type="url"');
  });
});

// ===========================================================================
// §C16.5 — Integer base type emits type='number'
// ===========================================================================

describe("C16 §C16.5 — Integer base type", () => {
  test("integer(>0 && <100) implicitly adds type='number'", () => {
    const source = `<program>
\${
@count: integer(>0 && <100) = 1
}
<input bind:value=@count/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="99"');
  });
});

// ===========================================================================
// §C16.6 — AND composition (handled in deriveHtmlAttrs)
// ===========================================================================

describe("C16 §C16.6 — AND predicate composition", () => {
  test("number(>0 && <100) emits both min and max", () => {
    const source = `<program>
\${
@quantity: number(>0 && <100) = 0
}
<input type="number" bind:value=@quantity/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).toMatch(/min="1"/);
    expect(html).toMatch(/max="99"/);
  });
});

// ===========================================================================
// §C16.7 — OR composition emits no static attrs (conservative)
// ===========================================================================

describe("C16 §C16.7 — OR predicate composition", () => {
  test("number(<0 || >100) (OR) emits no min/max attrs (conservative)", () => {
    const source = `<program>
\${
@outOfRange: number(<0 || >100) = -1
}
<input type="number" bind:value=@outOfRange/>
</program>`;
    const { html } = compileHtml(source);
    // OR cannot be represented in HTML; deriveHtmlAttrs skips it
    expect(html).not.toMatch(/\bmin="/);
    expect(html).not.toMatch(/\bmax="/);
  });
});

// ===========================================================================
// §C16.8 — No emission when var has no predicate
// ===========================================================================

describe("C16 §C16.8 — No emission for non-predicated vars", () => {
  test("plain `string` typeAnnotation does NOT emit minlength/maxlength", () => {
    const source = `<program>
\${
@name: string = ""
}
<input bind:value=@name/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).not.toContain('minlength');
    expect(html).not.toContain('maxlength');
  });

  test("no typeAnnotation at all → no attrs injected", () => {
    const source = `<program>
\${
@x = ""
}
<input bind:value=@x/>
</program>`;
    const { html } = compileHtml(source);
    expect(html).not.toContain('minlength');
    expect(html).not.toContain('type="email"');
  });
});

// ===========================================================================
// §C16.9 — E-CONTRACT-004-WARN: explicit type conflicts
// ===========================================================================

describe("C16 §C16.9 — E-CONTRACT-004-WARN: type attr conflict", () => {
  test("explicit type='text' on @email: string(email) fires E-CONTRACT-004-WARN", () => {
    const source = `<program>
\${
@email: string(email) = ""
}
<input type="text" bind:value=@email/>
</program>`;
    const { errors } = compileHtml(source);
    const warns = errors.filter((e) => e.code === "E-CONTRACT-004-WARN");
    expect(warns.length).toBe(1);
    expect(warns[0].message).toContain("E-CONTRACT-004-WARN");
    expect(warns[0].message).toContain("email");
    expect(warns[0].severity).toBe("warning");
  });
});

// ===========================================================================
// §C16.10 — Matching dev attr → no warning
// ===========================================================================

describe("C16 §C16.10 — Matching dev attr (no conflict)", () => {
  test("explicit type='email' on @email: string(email) fires NO warning", () => {
    const source = `<program>
\${
@email: string(email) = ""
}
<input type="email" bind:value=@email/>
</program>`;
    const { errors } = compileHtml(source);
    const warns = errors.filter((e) => e.code === "E-CONTRACT-004-WARN");
    expect(warns.length).toBe(0);
  });
});

// ===========================================================================
// §C16.11 — Shape-derived precedence
// ===========================================================================

describe("C16 §C16.11 — Shape-derived precedence (§53.7.3)", () => {
  test("conflicting type='text' is overridden by shape-derived type='email'", () => {
    const source = `<program>
\${
@email: string(email) = ""
}
<input type="text" bind:value=@email/>
</program>`;
    const { html } = compileHtml(source);
    // Shape-derived type=email is emitted, NOT the developer-supplied type=text
    expect(html).toContain('type="email"');
    expect(html).not.toContain('type="text"');
  });
});

// ===========================================================================
// §C16.12 — Locus 3: Client function param boundary check
// ===========================================================================

describe("C16 §C16.12 — Locus 3: client param check emitted", () => {
  test("function processPayment(amount: number(>0 && <10000)) emits param check", () => {
    const source = `<program>
function processPayment(amount: number(>0 && <10000)) {
  return amount
}
</program>`;
    const { js } = compileFunctions(source);
    // The boundary check appears as an `if (!(...))` followed by a throw block
    expect(js).toContain("E-CONTRACT-001-RT");
    expect(js).toContain("amount > 0");
    expect(js).toContain("amount < 10000");
  });
});

// ===========================================================================
// §C16.13 — Locus 3: param check uses throw (client-side)
// ===========================================================================

describe("C16 §C16.13 — Locus 3: client param check throws", () => {
  test("client function param check throws E-CONTRACT-001-RT (not Response)", () => {
    const source = `<program>
function f(x: number(>0)) {
  return x
}
</program>`;
    const { js } = compileFunctions(source);
    expect(js).toContain("throw new _scrml_g.Error");
    expect(js).toContain("E-CONTRACT-001-RT");
    expect(js).not.toMatch(/new (?:_scrml_g\.)?Response/); // server path uses Response — client uses throw
  });
});

// ===========================================================================
// §C16.14 — Locus 3: no emission when param has no predicate
// ===========================================================================

describe("C16 §C16.14 — Locus 3: no emission for non-predicated params", () => {
  test("function f(x: number) emits no boundary check", () => {
    const source = `<program>
function f(x: number) {
  return x
}
</program>`;
    const { js } = compileFunctions(source);
    expect(js).not.toContain("E-CONTRACT-001-RT");
  });

  test("function f(x) (no annotation) emits no boundary check", () => {
    const source = `<program>
function f(x) {
  return x
}
</program>`;
    const { js } = compileFunctions(source);
    expect(js).not.toContain("E-CONTRACT-001-RT");
  });
});

// ===========================================================================
// §C16.15 — Locus 4: function-return boundary check
// ===========================================================================

describe("C16 §C16.15 — Locus 4: return-stmt boundary check", () => {
  test("function f(): number(>0) { return -1 } emits return-stmt check", () => {
    const source = `<program>
function f(): number(>0) {
  return -1
}
</program>`;
    const { js } = compileFunctions(source);
    expect(js).toContain("E-CONTRACT-001-RT");
    expect(js).toContain("_scrml_chk_ret");
    // The boundary check expression mentions the predicate value
    expect(js).toMatch(/_scrml_chk_ret_\d+\s*>\s*0/);
  });
});

// ===========================================================================
// §C16.16 — Locus 4: no emission for non-predicated return
// ===========================================================================

describe("C16 §C16.16 — Locus 4: no emission for non-predicated returns", () => {
  test("function f(): number { return 1 } emits no return-stmt check", () => {
    const source = `<program>
function f(): number {
  return 1
}
</program>`;
    const { js } = compileFunctions(source);
    expect(js).not.toContain("E-CONTRACT-001-RT");
    expect(js).not.toContain("_scrml_chk_ret");
  });

  test("function f() { return 1 } (no return type) emits no return-stmt check", () => {
    const source = `<program>
function f() {
  return 1
}
</program>`;
    const { js } = compileFunctions(source);
    expect(js).not.toContain("_scrml_chk_ret");
  });
});

// ===========================================================================
// §C16.17 — AST: returnTypeAnnotation captured (`:` form)
// ===========================================================================

describe("C16 §C16.17 — AST capture: `:` return-type form", () => {
  test("function f(): number(>0) {} captures returnTypeAnnotation in AST", () => {
    const source = `<program>
function f(): number(>0) {
  return 1
}
</program>`;
    const ast = parseOnly(source);
    // Find the function-decl node (may be inside a logic block at program scope)
    const findFn = (nodes) => {
      for (const n of nodes ?? []) {
        if (!n || typeof n !== "object") continue;
        if (n.kind === "function-decl") return n;
        if (Array.isArray(n.body)) {
          const found = findFn(n.body);
          if (found) return found;
        }
        if (Array.isArray(n.children)) {
          const found = findFn(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    const fnNode = findFn(ast.nodes);
    expect(fnNode).not.toBeNull();
    expect(fnNode.hasReturnType).toBe(true);
    expect(fnNode.returnTypeAnnotation).toBeDefined();
    expect(fnNode.returnTypeAnnotation).toContain("number");
    expect(fnNode.returnTypeAnnotation).toContain(">");
    expect(fnNode.returnTypeAnnotation).toContain("0");
  });
});

// ===========================================================================
// §C16.18 — AST: returnTypeAnnotation captured (`->` form)
// ===========================================================================

describe("C16 §C16.18 — AST capture: `->` return-type form", () => {
  test("function f() -> number(>0) {} captures returnTypeAnnotation in AST", () => {
    const source = `<program>
function f() -> number(>0) {
  return 1
}
</program>`;
    const ast = parseOnly(source);
    const findFn = (nodes) => {
      for (const n of nodes ?? []) {
        if (!n || typeof n !== "object") continue;
        if (n.kind === "function-decl") return n;
        if (Array.isArray(n.body)) {
          const found = findFn(n.body);
          if (found) return found;
        }
        if (Array.isArray(n.children)) {
          const found = findFn(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    const fnNode = findFn(ast.nodes);
    expect(fnNode).not.toBeNull();
    expect(fnNode.hasReturnType).toBe(true);
    expect(fnNode.returnTypeAnnotation).toBeDefined();
    expect(fnNode.returnTypeAnnotation).toContain("number");
  });
});
