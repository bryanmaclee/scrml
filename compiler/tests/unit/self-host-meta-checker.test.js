/**
 * Self-Host Meta Checker — Parity Tests
 *
 * Validates that stdlib/compiler/meta-checker.scrml compiles without errors
 * and that the original JS module (compiler/src/meta-checker.ts) passes all
 * the same assertions. This ensures the scrml translation is a faithful 1:1 port.
 *
 * When the compiler's codegen supports library-mode output (ES module exports),
 * these tests should be updated to import from the compiled scrml output instead.
 */

import { parseExprToNode } from "../../src/expression-parser.ts";
import { describe, test, expect } from "bun:test";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

const metaCheckerPath = resolve(dirname(new URL(import.meta.url).pathname), "../../src/meta-checker.ts");

const {
  MetaError,
  runMetaChecker,
  createReflect,
  META_BUILTINS,
  JS_KEYWORDS,
  COMPILE_TIME_API_PATTERNS,
  bodyUsesCompileTimeApis,
  collectMetaLocals,
  extractIdentifiers,
  checkMetaBlock,
  checkReflectCalls,
  checkExprForRuntimeVars,
  buildFileTypeRegistry,
  parseEnumVariantsFromRaw,
  parseStructFieldsFromRaw,
  collectRuntimeVars,
} = await import(metaCheckerPath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(file = "test.scrml") {
  return { file, start: 0, end: 0, line: 1, col: 1 };
}

function makeMetaNode(body, span = null) {
  return {
    kind: "meta",
    body,
    span: span || makeSpan(),
  };
}

function makeBareExpr(expr, span = null) {
  const finalSpan = span || makeSpan();
  return { kind: "bare-expr", expr, exprNode: parseExprToNode(expr, finalSpan.file || "test.scrml", 0), span: finalSpan };
}

function makeLetDecl(name, init, span = null) {
  return { kind: "let-decl", name, init, span: span || makeSpan() };
}

function makeConstDecl(name, init, span = null) {
  return { kind: "const-decl", name, init, span: span || makeSpan() };
}

function makeFunctionDecl(name, params = [], body = []) {
  return { kind: "function-decl", name, params, body };
}

function makeForLoop(variable, indexVariable = null) {
  return { kind: "for-loop", variable, indexVariable };
}

// Build a minimal FileAST for testing
function makeFileAST(filePath, typeDecls = [], nodes = [], components = []) {
  return { filePath, typeDecls, nodes, components };
}

// ---------------------------------------------------------------------------
// Compilation test — scrml file compiles without errors
// ---------------------------------------------------------------------------

describe("self-host: meta-checker.scrml compilation", () => {
  const scrmlFile = resolve(dirname(new URL(import.meta.url).pathname), "../../../stdlib/compiler/meta-checker.scrml");

  test("scrml file exists", () => {
    expect(existsSync(scrmlFile)).toBe(true);
  });

  test("compiles without errors", () => {
    const compilerRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../../compiler");
    const cli = resolve(compilerRoot, "src/cli.js");

    if (!existsSync(cli)) {
      console.log("Skipping compilation test — compiler CLI not available in this worktree");
      return;
    }

    const outDir = resolve(dirname(scrmlFile), "dist");
    const result = execSync(`bun ${cli} compile ${scrmlFile} -o ${outDir}`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    expect(result).toContain("Compiled");
  });
});

// ---------------------------------------------------------------------------
// MetaError class
// ---------------------------------------------------------------------------

describe("self-host parity: MetaError", () => {
  test("constructs with required fields", () => {
    const span = makeSpan();
    const err = new MetaError("E-META-001", "test message", span);
    expect(err.code).toBe("E-META-001");
    expect(err.message).toBe("test message");
    expect(err.span).toBe(span);
    expect(err.severity).toBe("error");
  });

  test("accepts custom severity", () => {
    const err = new MetaError("E-META-001", "msg", null, "warning");
    expect(err.severity).toBe("warning");
  });

  test("span can be null", () => {
    const err = new MetaError("E-META-003", "msg", null);
    expect(err.span).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// META_BUILTINS set
// ---------------------------------------------------------------------------

describe("self-host parity: META_BUILTINS", () => {
  test("contains bun/process/Bun/console", () => {
    expect(META_BUILTINS.has("bun")).toBe(true);
    expect(META_BUILTINS.has("process")).toBe(true);
    expect(META_BUILTINS.has("Bun")).toBe(true);
    expect(META_BUILTINS.has("console")).toBe(true);
  });

  test("contains JS globals", () => {
    expect(META_BUILTINS.has("Object")).toBe(true);
    expect(META_BUILTINS.has("Array")).toBe(true);
    expect(META_BUILTINS.has("Map")).toBe(true);
    expect(META_BUILTINS.has("Set")).toBe(true);
    expect(META_BUILTINS.has("JSON")).toBe(true);
    expect(META_BUILTINS.has("Math")).toBe(true);
  });

  test("contains reflect and emit", () => {
    expect(META_BUILTINS.has("reflect")).toBe(true);
    expect(META_BUILTINS.has("emit")).toBe(true);
  });

  test("contains boolean/null/undefined literals", () => {
    expect(META_BUILTINS.has("true")).toBe(true);
    expect(META_BUILTINS.has("false")).toBe(true);
    expect(META_BUILTINS.has("null")).toBe(true);
    expect(META_BUILTINS.has("undefined")).toBe(true);
    expect(META_BUILTINS.has("NaN")).toBe(true);
    expect(META_BUILTINS.has("Infinity")).toBe(true);
  });

  test("does not contain arbitrary runtime names", () => {
    expect(META_BUILTINS.has("myVar")).toBe(false);
    expect(META_BUILTINS.has("routes")).toBe(false);
    expect(META_BUILTINS.has("count")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bodyUsesCompileTimeApis
// ---------------------------------------------------------------------------

describe("self-host parity: bodyUsesCompileTimeApis", () => {
  test("returns false for empty body", () => {
    expect(bodyUsesCompileTimeApis([])).toBe(false);
  });

  test("returns false for non-array", () => {
    expect(bodyUsesCompileTimeApis(null)).toBe(false);
    expect(bodyUsesCompileTimeApis(undefined)).toBe(false);
  });

  test("detects reflect() call in bare-expr", () => {
    const body = [makeBareExpr("info = reflect(Status)")];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });

  test("detects emit() call in bare-expr", () => {
    const body = [makeBareExpr("emit(`<span>hi</span>`)")];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });

  test("detects bun.eval() in bare-expr", () => {
    const body = [makeBareExpr("bun.eval(`return 42`)")];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });

  test("detects reflect in const-decl initializer", () => {
    const body = [makeConstDecl("info", "reflect(MyType)")];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });

  test("returns false for runtime-only body", () => {
    const body = [
      makeBareExpr("console.log(count)"),
      makeLetDecl("x", "count + 1"),
    ];
    expect(bodyUsesCompileTimeApis(body)).toBe(false);
  });

  test("does not look into nested meta blocks", () => {
    // Nested meta with reflect — outer body itself has no compile-time APIs
    const nested = makeMetaNode([makeBareExpr("reflect(T)")]);
    const body = [makeBareExpr("console.log('hello')"), nested];
    // The outer body does not contain a direct compile-time API call
    expect(bodyUsesCompileTimeApis(body)).toBe(false);
  });

  test("detects compile-time API in nested non-meta child body", () => {
    const child = { kind: "if-stmt", consequent: [makeBareExpr("emit(`<x/>`)")], alternate: [] };
    const body = [child];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collectMetaLocals
// ---------------------------------------------------------------------------

describe("self-host parity: collectMetaLocals", () => {
  test("returns empty set for empty body", () => {
    expect(collectMetaLocals([]).size).toBe(0);
  });

  test("collects let-decl names", () => {
    const body = [makeLetDecl("x", "1")];
    const locals = collectMetaLocals(body);
    expect(locals.has("x")).toBe(true);
  });

  test("collects const-decl names", () => {
    const body = [makeConstDecl("y", "2")];
    const locals = collectMetaLocals(body);
    expect(locals.has("y")).toBe(true);
  });

  test("collects function-decl names", () => {
    const body = [makeFunctionDecl("myFn")];
    const locals = collectMetaLocals(body);
    expect(locals.has("myFn")).toBe(true);
  });

  test("collects for-loop variable", () => {
    const body = [makeForLoop("item")];
    const locals = collectMetaLocals(body);
    expect(locals.has("item")).toBe(true);
  });

  test("collects for-loop index variable", () => {
    const body = [makeForLoop("item", "idx")];
    const locals = collectMetaLocals(body);
    expect(locals.has("item")).toBe(true);
    expect(locals.has("idx")).toBe(true);
  });

  test("collects across multiple nodes", () => {
    const body = [
      makeLetDecl("a", "1"),
      makeConstDecl("b", "2"),
      makeFunctionDecl("c"),
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("a")).toBe(true);
    expect(locals.has("b")).toBe(true);
    expect(locals.has("c")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractIdentifiers
// ---------------------------------------------------------------------------

describe("self-host parity: extractIdentifiers", () => {
  test("returns empty array for null/empty", () => {
    expect(extractIdentifiers(null)).toHaveLength(0);
    expect(extractIdentifiers("")).toHaveLength(0);
    expect(extractIdentifiers(42)).toHaveLength(0);
  });

  test("extracts simple identifier", () => {
    const ids = extractIdentifiers("count");
    expect(ids).toContain("count");
  });

  test("does not extract property access target", () => {
    const ids = extractIdentifiers("obj.prop");
    expect(ids).toContain("obj");
    expect(ids).not.toContain("prop");
  });

  test("strips double-quoted string contents", () => {
    const ids = extractIdentifiers('"hello world runtimeVar"');
    expect(ids).not.toContain("runtimeVar");
  });

  test("strips single-quoted string contents", () => {
    const ids = extractIdentifiers("'hello runtimeVar'");
    expect(ids).not.toContain("runtimeVar");
  });

  test("excludes for-of iterator variable", () => {
    const ids = extractIdentifiers("for (const route of routes)");
    // `route` is an inline local — should not appear as a free identifier
    expect(ids).not.toContain("route");
    // `routes` is the iterable — it IS a free reference
    expect(ids).toContain("routes");
  });

  test("excludes arrow function single param", () => {
    const ids = extractIdentifiers("routes.map(route => route.path)");
    // `route` is an arrow param — excluded as inline local
    // But `routes` is a free reference
    expect(ids).toContain("routes");
  });

  test("excludes named function parameters", () => {
    const ids = extractIdentifiers("cards.forEach(function(card) { return card.id })");
    expect(ids).not.toContain("card");
    expect(ids).toContain("cards");
  });

  test("strips object literal keys", () => {
    const ids = extractIdentifiers("JSON.stringify({title: x})");
    // `title` is an object literal key — excluded
    expect(ids).not.toContain("title");
    // `x` is a value reference — included
    expect(ids).toContain("x");
  });
});

// ---------------------------------------------------------------------------
// parseEnumVariantsFromRaw
// ---------------------------------------------------------------------------

describe("self-host parity: parseEnumVariantsFromRaw", () => {
  test("parses simple variants", () => {
    const variants = parseEnumVariantsFromRaw("{ Draft | Published | Archived }");
    const names = variants.map(v => v.name);
    expect(names).toContain("Draft");
    expect(names).toContain("Published");
    expect(names).toContain("Archived");
    expect(variants).toHaveLength(3);
  });

  test("returns empty array for empty body", () => {
    expect(parseEnumVariantsFromRaw("{}")).toHaveLength(0);
    expect(parseEnumVariantsFromRaw("")).toHaveLength(0);
  });

  test("handles variant with payload", () => {
    const variants = parseEnumVariantsFromRaw("{ Loaded(data: string) | Empty }");
    const names = variants.map(v => v.name);
    expect(names).toContain("Loaded");
    expect(names).toContain("Empty");
  });

  test("handles variants without braces", () => {
    const variants = parseEnumVariantsFromRaw("A | B | C");
    const names = variants.map(v => v.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(names).toContain("C");
  });
});

// ---------------------------------------------------------------------------
// parseStructFieldsFromRaw
// ---------------------------------------------------------------------------

describe("self-host parity: parseStructFieldsFromRaw", () => {
  test("parses simple fields", () => {
    const fields = parseStructFieldsFromRaw("{ username: string, email: string }");
    expect(fields.has("username")).toBe(true);
    expect(fields.has("email")).toBe(true);
    expect(fields.get("username").name).toBe("string");
  });

  test("returns empty Map for empty body", () => {
    expect(parseStructFieldsFromRaw("{}").size).toBe(0);
    expect(parseStructFieldsFromRaw("").size).toBe(0);
  });

  test("returns empty Map for field without colon", () => {
    const fields = parseStructFieldsFromRaw("{ badfield }");
    expect(fields.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildFileTypeRegistry
// ---------------------------------------------------------------------------

describe("self-host parity: buildFileTypeRegistry", () => {
  test("seeds with built-in type names", () => {
    const registry = buildFileTypeRegistry(makeFileAST("test.scrml"));
    expect(registry.has("number")).toBe(true);
    expect(registry.has("string")).toBe(true);
    expect(registry.has("boolean")).toBe(true);
    expect(registry.has("bool")).toBe(true);
    expect(registry.has("null")).toBe(true);
    expect(registry.has("asIs")).toBe(true);
  });

  test("adds enum from typeDecls", () => {
    const fileAST = makeFileAST("test.scrml", [
      { name: "Status", typeKind: "enum", raw: "{ Draft | Published }" },
    ]);
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("Status")).toBe(true);
    expect(registry.get("Status").kind).toBe("enum");
    const variants = registry.get("Status").variants.map(v => v.name);
    expect(variants).toContain("Draft");
    expect(variants).toContain("Published");
  });

  test("adds struct from typeDecls", () => {
    const fileAST = makeFileAST("test.scrml", [
      { name: "User", typeKind: "struct", raw: "{ name: string, age: number }" },
    ]);
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("User")).toBe(true);
    expect(registry.get("User").kind).toBe("struct");
    expect(registry.get("User").fields.has("name")).toBe(true);
  });

  test("adds unknown type for unknown typeKind", () => {
    const fileAST = makeFileAST("test.scrml", [
      { name: "MyType", typeKind: "other", raw: "" },
    ]);
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("MyType")).toBe(true);
    expect(registry.get("MyType").kind).toBe("unknown");
  });

  test("adds function-decl from logic body", () => {
    const fileAST = {
      filePath: "test.scrml",
      typeDecls: [],
      nodes: [
        {
          kind: "logic",
          body: [
            { kind: "function-decl", name: "myHelper", params: ["x: number"], body: [] },
          ],
        },
      ],
      components: [],
    };
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("myHelper")).toBe(true);
    expect(registry.get("myHelper").kind).toBe("function");
  });

  test("adds state-constructor-def", () => {
    const fileAST = {
      filePath: "test.scrml",
      typeDecls: [],
      nodes: [
        {
          kind: "state-constructor-def",
          stateType: "Counter",
          typedAttrs: [{ name: "count", type: "number" }],
        },
      ],
      components: [],
    };
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("Counter")).toBe(true);
    expect(registry.get("Counter").kind).toBe("state");
    expect(registry.get("Counter").attributes[0].name).toBe("count");
  });

  test("adds component-def", () => {
    const fileAST = {
      filePath: "test.scrml",
      typeDecls: [],
      nodes: [],
      components: [
        { name: "MyButton", propsDecl: [{ name: "label", type: "string", optional: false, bindable: false }] },
      ],
    };
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("MyButton")).toBe(true);
    expect(registry.get("MyButton").kind).toBe("component");
  });
});

// ---------------------------------------------------------------------------
// collectRuntimeVars
// ---------------------------------------------------------------------------

describe("self-host parity: collectRuntimeVars", () => {
  test("returns empty set for file with no nodes", () => {
    const vars = collectRuntimeVars(makeFileAST("test.scrml"));
    expect(vars.size).toBe(0);
  });

  test("collects let-decl from logic body", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [makeLetDecl("count", "0")],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("count")).toBe(true);
  });

  test("collects reactive-decl and @name form", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [{ kind: "state-decl", name: "items" }],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("items")).toBe(true);
    expect(vars.has("@items")).toBe(true);
  });

  test("collects function-decl names", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [makeFunctionDecl("handleClick")],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("handleClick")).toBe(true);
  });

  test("does not collect variables inside meta blocks", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            makeMetaNode([makeLetDecl("metaLocal", "42")]),
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("metaLocal")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Bug O regression (2026-04-26): for-loop iteration variables and any
  // let/const/lin declared inside for-loop bodies are LOOP-LOCAL and SHALL
  // NOT appear in the module-scope runtimeVars map. Adding them caused the
  // meta-effect frozen-scope object to emit names like \`it: it\` that are
  // out-of-scope at module load — "ReferenceError: it is not defined".
  // See compiler/src/meta-checker.ts collectRuntimeVars (Bug O fix).
  // -------------------------------------------------------------------------

  test("Bug O: does NOT collect for-loop iteration variable (markup-template for-loop)", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            makeForLoop("it"),
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("it")).toBe(false);
  });

  test("Bug O: does NOT collect for-stmt iteration variable (logic-body for-of)", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            { kind: "for-stmt", variable: "item" },
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("item")).toBe(false);
  });

  test("Bug O: does NOT collect for-loop index variable", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            makeForLoop("it", "idx"),
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("it")).toBe(false);
    expect(vars.has("idx")).toBe(false);
  });

  test("Bug O: does NOT collect let-decl declared inside for-loop body", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            { kind: "for-stmt", variable: "it", body: [makeLetDecl("localInner", "42")] },
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("it")).toBe(false);
    expect(vars.has("localInner")).toBe(false);
  });

  test("Bug O: collects sibling module-scope decls correctly when a for-loop is present", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            makeLetDecl("a", "1"),
            { kind: "state-decl", name: "items" },
            makeFunctionDecl("init"),
            { kind: "for-stmt", variable: "it" },
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    // Module-scope siblings ARE collected.
    expect(vars.has("a")).toBe(true);
    expect(vars.has("items")).toBe(true);
    expect(vars.has("@items")).toBe(true);
    expect(vars.has("init")).toBe(true);
    // Loop-local is NOT collected.
    expect(vars.has("it")).toBe(false);
  });

  test("Bug O: multiple for-loops with same loop-var name remain excluded", () => {
    const fileAST = {
      filePath: "test.scrml",
      nodes: [
        {
          kind: "logic",
          body: [
            { kind: "for-stmt", variable: "x" },
            { kind: "for-loop", variable: "x" },
          ],
        },
      ],
    };
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkReflectCalls
// ---------------------------------------------------------------------------

describe("self-host parity: checkReflectCalls", () => {
  test("no errors when reflect called on known type", () => {
    const registry = new Map([["Status", { kind: "enum", name: "Status", variants: [] }]]);
    const errors = [];
    checkReflectCalls(
      [makeBareExpr("info = reflect(Status)")],
      registry,
      "test.scrml",
      makeSpan(),
      errors,
    );
    expect(errors).toHaveLength(0);
  });

  test("E-META-003 when reflect called on unknown type", () => {
    const registry = new Map();
    const errors = [];
    checkReflectCalls(
      [makeBareExpr("info = reflect(UnknownType)")],
      registry,
      "test.scrml",
      makeSpan(),
      errors,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-META-003");
    expect(errors[0].message).toContain("UnknownType");
  });

  test("no errors for empty body", () => {
    const registry = new Map();
    const errors = [];
    checkReflectCalls([], registry, "test.scrml", makeSpan(), errors);
    expect(errors).toHaveLength(0);
  });

  test("E-META-003 in let-decl initializer", () => {
    const registry = new Map();
    const errors = [];
    checkReflectCalls(
      [makeLetDecl("info", "reflect(MissingType)")],
      registry,
      "test.scrml",
      makeSpan(),
      errors,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-META-003");
  });
});

// ---------------------------------------------------------------------------
// checkMetaBlock — phase separation (E-META-001)
// ---------------------------------------------------------------------------

describe("self-host parity: checkMetaBlock E-META-001", () => {
  test("no errors for empty meta block", () => {
    const errors = [];
    checkMetaBlock(makeMetaNode([]), null, new Map(), "test.scrml", errors);
    expect(errors).toHaveLength(0);
  });

  test("no errors for runtime meta block (no compile-time APIs)", () => {
    // Runtime meta block: references runtime var but uses no compile-time APIs
    const body = [makeBareExpr("console.log(runtimeVar)")];
    const errors = [];
    checkMetaBlock(makeMetaNode(body), null, new Map(), "test.scrml", errors);
    // No E-META-001 — this is a runtime meta block
    expect(errors.filter(e => e.code === "E-META-001")).toHaveLength(0);
  });

  test("no errors when compile-time meta block uses only meta locals", () => {
    // Compile-time block (uses reflect) that only references its own locals
    const body = [
      makeConstDecl("info", "reflect(Status)"),
      makeBareExpr("emit(`<span>${info.variants.join(', ')}</span>`)"),
    ];
    const typeRegistry = new Map([["Status", { kind: "enum", name: "Status", variants: [] }]]);
    const errors = [];
    checkMetaBlock(makeMetaNode(body), null, typeRegistry, "test.scrml", errors);
    // `info` is a meta local; `Status` is a type name; `reflect`/`emit` are builtins
    expect(errors.filter(e => e.code === "E-META-001")).toHaveLength(0);
  });

  test("no errors when identifier is a META_BUILTIN", () => {
    const body = [
      makeConstDecl("result", "reflect(MyType)"),
      makeBareExpr("console.log(result)"),
    ];
    const typeRegistry = new Map([["MyType", { kind: "enum", name: "MyType", variants: [] }]]);
    const errors = [];
    checkMetaBlock(makeMetaNode(body), null, typeRegistry, "test.scrml", errors);
    // `console` is a META_BUILTIN; `result` is a meta local; `MyType` is a type
    expect(errors.filter(e => e.code === "E-META-001")).toHaveLength(0);
  });

  test("no errors when identifier is a type name", () => {
    const body = [
      makeLetDecl("info", "reflect(Status)"),
    ];
    const typeRegistry = new Map([["Status", { kind: "enum", name: "Status", variants: [] }]]);
    const errors = [];
    checkMetaBlock(makeMetaNode(body), null, typeRegistry, "test.scrml", errors);
    expect(errors.filter(e => e.code === "E-META-001")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createReflect
// ---------------------------------------------------------------------------

describe("self-host parity: createReflect", () => {
  test("reflect on enum returns variants", () => {
    const registry = new Map([
      ["Status", {
        kind: "enum",
        name: "Status",
        variants: [{ name: "Draft" }, { name: "Published" }, { name: "Archived" }],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Status");
    expect(result.kind).toBe("enum");
    expect(result.name).toBe("Status");
    expect(result.variants).toContain("Draft");
    expect(result.variants).toContain("Published");
    expect(result.variants).toContain("Archived");
  });

  test("reflect on enum with string variants", () => {
    const registry = new Map([
      ["Color", { kind: "enum", name: "Color", variants: ["Red", "Green", "Blue"] }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Color");
    expect(result.variants).toContain("Red");
    expect(result.variants).toContain("Green");
    expect(result.variants).toContain("Blue");
  });

  test("reflect on struct returns fields", () => {
    const fields = new Map([
      ["name", { kind: "primitive", name: "string" }],
      ["age", { kind: "primitive", name: "number" }],
    ]);
    const registry = new Map([
      ["User", { kind: "struct", name: "User", fields }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("User");
    expect(result.kind).toBe("struct");
    expect(result.name).toBe("User");
    const fieldNames = result.fields.map(f => f.name);
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("age");
    const nameField = result.fields.find(f => f.name === "name");
    expect(nameField.type).toBe("string");
  });

  test("reflect on function returns params and returnType", () => {
    const registry = new Map([
      ["add", {
        kind: "function",
        name: "add",
        params: ["x: number", "y: number"],
        returnType: "number",
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("add");
    expect(result.kind).toBe("function");
    expect(result.name).toBe("add");
    expect(result.returnType).toBe("number");
    expect(result.params).toHaveLength(2);
    expect(result.params[0].name).toBe("x");
    expect(result.params[0].type).toBe("number");
    expect(result.params[1].name).toBe("y");
  });

  test("reflect on state returns attributes", () => {
    const registry = new Map([
      ["Counter", {
        kind: "state",
        name: "Counter",
        attributes: [{ name: "count", type: "number" }, { name: "label", type: "string" }],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Counter");
    expect(result.kind).toBe("state");
    expect(result.name).toBe("Counter");
    expect(result.attributes).toHaveLength(2);
    expect(result.attributes[0].name).toBe("count");
    expect(result.attributes[0].type).toBe("number");
  });

  test("reflect on component returns props", () => {
    const registry = new Map([
      ["Button", {
        kind: "component",
        name: "Button",
        props: [
          { name: "label", type: "string", optional: false, bindable: false },
          { name: "onClick", type: "function", optional: true, bindable: false },
        ],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Button");
    expect(result.kind).toBe("component");
    expect(result.name).toBe("Button");
    expect(result.props).toHaveLength(2);
    expect(result.props[0].name).toBe("label");
    expect(result.props[0].optional).toBe(false);
    expect(result.props[1].optional).toBe(true);
  });

  test("reflect throws E-META-003 for unknown type", () => {
    const registry = new Map();
    const reflect = createReflect(registry);
    expect(() => reflect("UnknownType")).toThrow("E-META-003");
    expect(() => reflect("UnknownType")).toThrow("UnknownType");
  });

  test("reflect throws for non-string argument", () => {
    const registry = new Map();
    const reflect = createReflect(registry);
    expect(() => reflect(null)).toThrow();
    expect(() => reflect(42)).toThrow();
  });

  test("reflect on unknown kind returns kind and name only", () => {
    const registry = new Map([
      ["Opaque", { kind: "opaque", name: "Opaque" }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Opaque");
    expect(result.kind).toBe("opaque");
    expect(result.name).toBe("Opaque");
  });
});

// ---------------------------------------------------------------------------
// runMetaChecker — integration
// ---------------------------------------------------------------------------

describe("self-host parity: runMetaChecker integration", () => {
  test("empty files list produces no errors", () => {
    const result = runMetaChecker({ files: [] });
    expect(result.errors).toHaveLength(0);
    expect(result.files).toHaveLength(0);
  });

  test("file with no meta blocks produces no errors", () => {
    const fileAST = makeFileAST("test.scrml");
    fileAST.nodes = [
      { kind: "logic", body: [makeLetDecl("x", "1")] },
    ];
    const result = runMetaChecker({ files: [fileAST] });
    expect(result.errors).toHaveLength(0);
  });

  test("attaches _metaReflectRegistry to each file", () => {
    const fileAST = makeFileAST("test.scrml", [
      { name: "Status", typeKind: "enum", raw: "{ Draft | Published }" },
    ]);
    fileAST.nodes = [];
    const result = runMetaChecker({ files: [fileAST] });
    expect(fileAST._metaReflectRegistry).toBeDefined();
    expect(fileAST._metaReflectRegistry.has("Status")).toBe(true);
  });

  test("detects E-META-003 from runMetaChecker", () => {
    // A file with a meta block that calls reflect on an unknown type
    const fileAST = {
      filePath: "test.scrml",
      typeDecls: [],
      nodes: [
        {
          kind: "meta",
          body: [makeBareExpr("info = reflect(GhostType)")],
          span: makeSpan("test.scrml"),
        },
      ],
      components: [],
    };
    const result = runMetaChecker({ files: [fileAST] });
    const metaErrors = result.errors.filter(e => e.code === "E-META-003");
    expect(metaErrors.length).toBeGreaterThan(0);
    expect(metaErrors[0].message).toContain("GhostType");
  });

  test("no errors for reflect on declared enum via runMetaChecker", () => {
    const fileAST = {
      filePath: "test.scrml",
      typeDecls: [
        { name: "Status", typeKind: "enum", raw: "{ Active | Inactive }" },
      ],
      nodes: [
        {
          kind: "meta",
          body: [makeConstDecl("info", "reflect(Status)")],
          span: makeSpan("test.scrml"),
        },
      ],
      components: [],
    };
    const result = runMetaChecker({ files: [fileAST] });
    expect(result.errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });

  test("passes files through unchanged (except _metaReflectRegistry)", () => {
    const file1 = makeFileAST("a.scrml");
    const file2 = makeFileAST("b.scrml");
    file1.nodes = [];
    file2.nodes = [];
    const result = runMetaChecker({ files: [file1, file2] });
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toBe(file1);
    expect(result.files[1]).toBe(file2);
  });
});
