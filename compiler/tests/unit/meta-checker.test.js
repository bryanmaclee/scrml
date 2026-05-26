/**
 * Meta Checker (MC) — Unit Tests
 *
 * Tests for src/meta-checker.js (Stage 6.5).
 *
 * Coverage:
 *   §1  collectMetaLocals — collects let/const declared inside meta body
 *   §2  collectMetaLocals — collects function declarations inside meta body
 *   §3  collectMetaLocals — collects for-loop iteration variables
 *   §4  collectMetaLocals — empty body returns empty set
 *   §5  extractIdentifiers — extracts simple identifiers from expressions
 *   §6  extractIdentifiers — ignores property accesses after dot
 *   §7  extractIdentifiers — ignores string contents
 *   §8  extractIdentifiers — handles template literals
 *   §9  extractIdentifiers — handles empty/null input
 *   §10 checkExprForRuntimeVars — no error for meta-local variables
 *   §11 checkExprForRuntimeVars — no error for META_BUILTINS (bun, process, etc.)
 *   §12 checkExprForRuntimeVars — E-META-001 for runtime variable reference
 *   §13 checkExprForRuntimeVars — no error for type names
 *   §14 checkExprForRuntimeVars — no error for JS keywords
 *   §15 checkMetaBlock — clean usage: all variables declared inside meta
 *   §16 checkMetaBlock — E-META-001: runtime variable referenced in compile-time meta
 *   §17 checkMetaBlock — nested ^{} can reference outer ^{} locals
 *   §18 checkMetaBlock — compile-time builtins allowed everywhere
 *   §19 checkReflectCalls — no error for known type
 *   §20 checkReflectCalls — E-META-003 for unknown type
 *   §21 checkReflectCalls — multiple reflect calls in one expression
 *   §22 runMetaChecker — output shape: files array and errors array
 *   §23 runMetaChecker — empty input produces empty output
 *   §24 runMetaChecker — integration: clean meta block (no errors)
 *   §25 runMetaChecker — integration: runtime var in compile-time meta (E-META-001)
 *   §26 runMetaChecker — integration: reflect on unknown type (E-META-003)
 *   §27 createReflect — enum reflection returns kind, name, variants
 *   §28 createReflect — struct reflection returns kind, name, fields
 *   §29 createReflect — unknown type throws
 *   §30 createReflect — non-string input throws
 *   §31 buildFileTypeRegistry — registers enums from typeDecls
 *   §32 buildFileTypeRegistry — registers structs from typeDecls
 *   §33 buildFileTypeRegistry — includes built-in types
 *   §34 parseEnumVariantsFromRaw — basic enum variants
 *   §35 parseEnumVariantsFromRaw — enum with payload variants
 *   §36 parseEnumVariantsFromRaw — empty body
 *   §37 parseStructFieldsFromRaw — basic struct fields
 *   §38 parseStructFieldsFromRaw — empty body
 *   §39 collectRuntimeVars — collects let/const outside meta
 *   §40 collectRuntimeVars — collects reactive vars
 *   §41 collectRuntimeVars — does not collect vars inside meta blocks
 *   §42 typeToString — primitive types
 *   §43 typeToString — array types
 *   §44 typeToString — union types
 *   §45 checkExprForRuntimeVars — multiple runtime vars each produce an error
 *   §46 E-META-001 error message includes variable name and hint
 *   §47 checkMetaBlock — let initializer checked for runtime vars
 *   §48 nested meta — inner ^{} can see outer ^{} const
 *
 *   Runtime meta classification (SPEC §22.5):
 *   §49 bodyUsesCompileTimeApis — returns false for empty body
 *   §50 bodyUsesCompileTimeApis — returns true when reflect() is present
 *   §51 bodyUsesCompileTimeApis — returns true when bun.eval() is present
 *   §52 bodyUsesCompileTimeApis — returns true when emit() is present
  *   §54 bodyUsesCompileTimeApis — returns false for pure runtime body
 *   §55 checkMetaBlock — runtime meta: NO E-META-001 for @reactive var reference
 *   §56 checkMetaBlock — runtime meta: NO E-META-001 for arbitrary runtime vars
 *   §57 checkMetaBlock — compile-time meta with reflect(): E-META-001 fires for runtime vars
 *   §58 runMetaChecker — runtime meta block with @reactive var produces no E-META-001
 *   §59 runMetaChecker — compile-time meta with reflect() + runtime var produces E-META-001
 *   §60 bodyUsesCompileTimeApis — returns false when bun.readFile is used (not bun.eval)
 *
 *   Extended reflect() — function signatures, state types, component shapes:
 *   §61 createReflect — function reflection: no params returns {kind, name, params: [], returnType}
 *   §62 createReflect — function with typed params: params parsed into {name, type} objects
 *   §63 createReflect — function with untyped params: type defaults to "unknown"
 *   §64 createReflect — state reflection returns {kind, name, attributes}
 *   §65 createReflect — state with no attributes returns empty array
 *   §66 createReflect — component reflection returns {kind, name, props}
 *   §67 createReflect — component props carry optional and bindable flags
 *   §68 buildFileTypeRegistry — registers function-decl nodes from logic bodies
 *   §69 buildFileTypeRegistry — registers state-constructor-def nodes
 *   §70 buildFileTypeRegistry — registers component-def nodes from fileAST.components
 *   §71 buildFileTypeRegistry — component props from propsDecl when present
 *   §72 checkReflectCalls — no E-META-003 for function/state/component names in registry
 *   §73 checkReflectCalls — no E-META-003 when reflect arg is a meta-local const/let/for-var
 *   §74 checkReflectCalls — E-META-003 still fires for genuinely unknown type names
 *
 *   §22.7 Runtime meta guard (meta.runtime = false):
 *   §75 runMetaChecker — E-META-001 fires for runtime ^{} when meta.runtime is false
 *   §76 runMetaChecker — no E-META-001 for runtime ^{} when meta.runtime is true (default)
 *
 *   §22.8 Phase separation (E-META-005):
 *   §77 bodyMixesPhases — returns true for block with reflect() + runtime var
 *   §78 bodyMixesPhases — returns false for compile-time-only block
 *   §79 bodyMixesPhases — returns false for runtime-only block
 *   §80 runMetaChecker — E-META-005 fires for mixed compile-time + runtime block
 *   §81 runMetaChecker — no E-META-005 for pure compile-time block
 *
 *   §22.9 Interaction with other features (E-META-006, E-META-007):
 *   §82 bodyContainsLift — detects lift() call
 *   §83 bodyContainsLift — returns null for body without lift
 *   §84 bodyContainsSqlContext — detects ?{} SQL context
 *   §85 bodyContainsSqlContext — returns null for body without SQL context
 *   §86 runMetaChecker — E-META-006 fires for lift() in ^{} block
 *   §87 runMetaChecker — no E-META-006 for block without lift()
 *   §88 runMetaChecker — E-META-007 fires for ?{} in runtime ^{} block
 *   §89 runMetaChecker — no E-META-007 for ?{} in compile-time ^{} block
 */

import { describe, test, expect } from "bun:test";
import { parseExprToNode } from "../../src/expression-parser.ts";
import {
  runMetaChecker,
  createReflect,
  MetaError,
  collectMetaLocals,
  extractIdentifiers,
  extractParamBindings,
  extractDestructuredLocals,
  checkMetaBlock,
  checkReflectCalls,
  checkExprForRuntimeVars,
  buildFileTypeRegistry,
  parseEnumVariantsFromRaw,
  parseStructFieldsFromRaw,
  collectRuntimeVars,
  typeToString,
  META_BUILTINS,
  JS_KEYWORDS,
  bodyUsesCompileTimeApis,
  bodyContainsLift,
  bodyContainsSqlContext,
  bodyMixesPhases,
  bodyReferencesCompilerNamespace,
  COMPILE_TIME_API_PATTERNS,
  isVariableIdent,
} from "../../src/meta-checker.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFileAST({
  filePath = "/test/app.scrml",
  nodes = [],
  typeDecls = [],
  components = [],
} = {}) {
  return {
    filePath,
    nodes,
    typeDecls,
    imports: [],
    exports: [],
    components,
    spans: {},
  };
}

function makeMetaNode(body, id = 100) {
  return {
    id,
    kind: "meta",
    body,
    parentContext: "markup",
    span: span(0),
  };
}

function makeLetDecl(name, init = null, id = 1) {
  return {
    id,
    kind: "let-decl",
    name,
    init,
    span: span(0),
  };
}

function makeConstDecl(name, init = null, id = 1) {
  return {
    id,
    kind: "const-decl",
    name,
    init,
    span: span(0),
  };
}

function makeBareExpr(expr, id = 1) {
  return {
    id,
    kind: "bare-expr",
    expr,
    exprNode: parseExprToNode(expr, "/test/app.scrml", 0),
    span: span(0),
  };
}

function makeFnDecl(name, body = [], id = 1) {
  return {
    id,
    kind: "function-decl",
    name,
    params: [],
    body,
    span: span(0),
  };
}

function makeForLoop(variable, body = [], id = 1) {
  return {
    id,
    kind: "for-loop",
    variable,
    indexVariable: null,
    body,
    span: span(0),
  };
}

function makeTypeDecl(name, typeKind, raw, id = 1) {
  return {
    id,
    kind: "type-decl",
    name,
    typeKind,
    raw,
    span: span(0),
  };
}

function makeReactiveDecl(name, init = null, id = 1) {
  return {
    id,
    kind: "state-decl",
    name,
    init,
    span: span(0),
  };
}

// ---------------------------------------------------------------------------
// §1-4: collectMetaLocals
// ---------------------------------------------------------------------------

describe("collectMetaLocals", () => {
  test("§1 collects let/const declared inside meta body", () => {
    const body = [
      makeLetDecl("x"),
      makeConstDecl("CONFIG"),
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("x")).toBe(true);
    expect(locals.has("CONFIG")).toBe(true);
    expect(locals.size).toBe(2);
  });

  test("§2 collects function declarations inside meta body", () => {
    const body = [
      makeFnDecl("helper"),
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("helper")).toBe(true);
  });

  test("§3 collects for-loop iteration variables", () => {
    const body = [
      makeForLoop("item"),
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("item")).toBe(true);
  });

  test("§4 empty body returns empty set", () => {
    const locals = collectMetaLocals([]);
    expect(locals.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5-9: extractIdentifiers
// ---------------------------------------------------------------------------

describe("extractIdentifiers", () => {
  test("§5 extracts simple identifiers from expressions", () => {
    const ids = extractIdentifiers("foo + bar * baz");
    expect(ids).toContain("foo");
    expect(ids).toContain("bar");
    expect(ids).toContain("baz");
  });

  test("§6 ignores property accesses after dot", () => {
    const ids = extractIdentifiers("obj.prop.deep");
    expect(ids).toContain("obj");
    // .prop and .deep should not appear as standalone identifiers
    // since they follow a dot
    expect(ids.filter(id => id === "prop")).toHaveLength(0);
    expect(ids.filter(id => id === "deep")).toHaveLength(0);
  });

  test("§7 ignores string contents", () => {
    const ids = extractIdentifiers('x + "hello world" + y');
    expect(ids).toContain("x");
    expect(ids).toContain("y");
    expect(ids).not.toContain("hello");
    expect(ids).not.toContain("world");
  });

  test("§8 handles template literals", () => {
    const ids = extractIdentifiers("x + `template ${y}` + z");
    // template content is stripped, but the overall approach is conservative
    expect(ids).toContain("x");
    expect(ids).toContain("z");
  });

  test("§9 handles empty/null input", () => {
    expect(extractIdentifiers("")).toHaveLength(0);
    expect(extractIdentifiers(null)).toHaveLength(0);
    expect(extractIdentifiers(undefined)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §10-14: checkExprForRuntimeVars
// ---------------------------------------------------------------------------

describe("checkExprForRuntimeVars", () => {
  test("§10 no error for meta-local variables", () => {
    const errors = [];
    const locals = new Set(["CONFIG", "x"]);
    const registry = new Map();
    checkExprForRuntimeVars("CONFIG + x", locals, registry, span(), "/test.scrml", errors);
    expect(errors).toHaveLength(0);
  });

  test("§11 no error for META_BUILTINS (JSON, Object, Math, etc.)", () => {
    // S133 Step A — `bun` / `process` / `Bun` / `console` retired from
    // META_BUILTINS per SPEC §22.12. The remaining built-ins are JS-language
    // values (compile-time-evaluable) + scrml meta API + reserved `compiler`.
    const errors = [];
    const locals = new Set();
    const registry = new Map();
    checkExprForRuntimeVars("JSON.stringify(Object.keys(Math))", locals, registry, span(), "/test.scrml", errors);
    expect(errors).toHaveLength(0);
  });

  test("§11b E-META-001 fires for retired JS-host globals (S133 Step A — SPEC §22.12)", () => {
    // Regression guard for the latent spec-vs-impl divergence closed in S133:
    // `bun.eval(...)`, `process.env.X`, `Bun.serve(...)`, `console.log(...)`
    // SHALL fire E-META-001 when referenced inside a compile-time ^{} meta
    // context. checkExprForRuntimeVars is the inner helper called from
    // checkMetaBlock; runtime-meta blocks early-return before reaching here.
    {
      const errors = [];
      checkExprForRuntimeVars("bun.eval('1+1')", new Set(), new Map(), span(), "/test.scrml", errors);
      expect(errors.filter(e => e.code === "E-META-001" && e.message.includes("'bun'"))).toHaveLength(1);
    }
    {
      const errors = [];
      checkExprForRuntimeVars("process.env.PORT", new Set(), new Map(), span(), "/test.scrml", errors);
      expect(errors.filter(e => e.code === "E-META-001" && e.message.includes("'process'"))).toHaveLength(1);
    }
    {
      const errors = [];
      checkExprForRuntimeVars("Bun.serve({})", new Set(), new Map(), span(), "/test.scrml", errors);
      expect(errors.filter(e => e.code === "E-META-001" && e.message.includes("'Bun'"))).toHaveLength(1);
    }
    {
      const errors = [];
      checkExprForRuntimeVars("console.log('x')", new Set(), new Map(), span(), "/test.scrml", errors);
      expect(errors.filter(e => e.code === "E-META-001" && e.message.includes("'console'"))).toHaveLength(1);
    }
  });

  test("§12 E-META-001 for runtime variable reference", () => {
    const errors = [];
    const locals = new Set();
    const registry = new Map();
    checkExprForRuntimeVars("providerKey.toUpperCase()", locals, registry, span(), "/test.scrml", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-META-001");
    expect(errors[0].message).toContain("providerKey");
  });

  test("§13 no error for type names", () => {
    const errors = [];
    const locals = new Set();
    const registry = new Map([["PostStatus", { kind: "enum", name: "PostStatus" }]]);
    checkExprForRuntimeVars("reflect(PostStatus)", locals, registry, span(), "/test.scrml", errors);
    expect(errors).toHaveLength(0);
  });

  test("§14 no error for JS keywords", () => {
    const errors = [];
    const locals = new Set();
    const registry = new Map();
    checkExprForRuntimeVars("let x = return new typeof", locals, registry, span(), "/test.scrml", errors);
    // "x" is the only non-keyword identifier, but it's preceded by "let" so
    // may appear in the identifier list
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // "x" would be flagged. That's expected — it's used without being declared in the meta block.
    // Keywords like "let", "return", "new", "typeof" should NOT be flagged.
    for (const err of meta001s) {
      expect(err.message).not.toContain("'let'");
      expect(err.message).not.toContain("'return'");
      expect(err.message).not.toContain("'new'");
      expect(err.message).not.toContain("'typeof'");
    }
  });

  test("§45 multiple runtime vars each produce an error", () => {
    const errors = [];
    const locals = new Set();
    const registry = new Map();
    checkExprForRuntimeVars("alpha + beta + gamma", locals, registry, span(), "/test.scrml", errors);
    expect(errors).toHaveLength(3);
    const varNames = errors.map(e => {
      const m = e.message.match(/Runtime variable '(\w+)'/);
      return m ? m[1] : null;
    });
    expect(varNames).toContain("alpha");
    expect(varNames).toContain("beta");
    expect(varNames).toContain("gamma");
  });

  test("§46 E-META-001 error message includes variable name and hint", () => {
    const errors = [];
    checkExprForRuntimeVars("providerKey", new Set(), new Map(), span(), "/test.scrml", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("providerKey");
    expect(errors[0].message).toContain("compile time");
    expect(errors[0].message).toContain("Hint:");
  });
});

// ---------------------------------------------------------------------------
// §15-18: checkMetaBlock
// ---------------------------------------------------------------------------

describe("checkMetaBlock", () => {
  test("§15 clean usage: all variables declared inside meta", () => {
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("CONFIG", 'bun.eval(`return { port: 3000 }`)'),
      makeBareExpr("CONFIG.port"),
    ]);
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    expect(errors).toHaveLength(0);
  });

  test("§16 E-META-001: runtime variable referenced in compile-time meta", () => {
    const errors = [];
    // Uses reflect() → compile-time meta → E-META-001 applies
    const meta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeBareExpr("providerKey.toUpperCase()"),
    ]);
    const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
    checkMetaBlock(meta, null, registry, "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    expect(meta001s.length).toBeGreaterThanOrEqual(1);
    expect(meta001s[0].message).toContain("providerKey");
  });

  test("§17 nested ^{} can reference outer ^{} locals", () => {
    const errors = [];
    const innerMeta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeBareExpr("outerVar + 1"),
    ], 200);
    const outerMeta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeConstDecl("outerVar", "42"),
      innerMeta,
    ]);
    const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
    checkMetaBlock(outerMeta, null, registry, "/test.scrml", errors);
    expect(errors).toHaveLength(0);
  });

  test("§18 META_BUILTINS allowed inside compile-time meta", () => {
    // S133 Step A — META_BUILTINS narrowed per SPEC §22.12. JS-language values
    // (JSON / Object / Math / Date / etc.) remain compile-time-evaluable.
    // The retired JS-host globals (bun / process / Bun / console) are
    // exercised in §18b below.
    const errors = [];
    const meta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeBareExpr("JSON.stringify(Object.keys({}))"),
      makeBareExpr("Math.max(1, 2, 3)"),
      makeBareExpr("Date.now()"),
    ]);
    const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
    checkMetaBlock(meta, null, registry, "/test.scrml", errors);
    expect(errors.filter(e => e.code === "E-META-001")).toHaveLength(0);
  });

  test("§18b E-META-001 fires for retired JS-host globals in compile-time meta (S133 Step A)", () => {
    // SPEC §22.12 line 14687: JS-host ambient globals (`bun`, `process`, `Bun`,
    // `console`, `setInterval`, `fetch`, …) are NOT in META_BUILTINS and SHALL
    // trigger E-META-001 inside a compile-time `^{}` block. This guards the
    // latent spec-vs-impl divergence closed in S133 — under the prior set,
    // `^{ const x = bun.eval(...); emit(...) }` silently folded to a literal.
    {
      const errors = [];
      const meta = makeMetaNode([
        makeBareExpr("reflect(SomeType)"),
        makeBareExpr("bun.eval(`return 1`)"),
      ]);
      const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
      checkMetaBlock(meta, null, registry, "/test.scrml", errors);
      const bunErrs = errors.filter(e => e.code === "E-META-001" && e.message.includes("'bun'"));
      expect(bunErrs.length).toBeGreaterThanOrEqual(1);
    }
    {
      const errors = [];
      const meta = makeMetaNode([
        makeBareExpr("reflect(SomeType)"),
        makeBareExpr("Object.keys(process.env)"),
      ]);
      const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
      checkMetaBlock(meta, null, registry, "/test.scrml", errors);
      const processErrs = errors.filter(e => e.code === "E-META-001" && e.message.includes("'process'"));
      expect(processErrs.length).toBeGreaterThanOrEqual(1);
    }
    {
      const errors = [];
      const meta = makeMetaNode([
        makeBareExpr("reflect(SomeType)"),
        makeBareExpr("Bun.serve({})"),
      ]);
      const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
      checkMetaBlock(meta, null, registry, "/test.scrml", errors);
      const bunCapErrs = errors.filter(e => e.code === "E-META-001" && e.message.includes("'Bun'"));
      expect(bunCapErrs.length).toBeGreaterThanOrEqual(1);
    }
    {
      const errors = [];
      const meta = makeMetaNode([
        makeBareExpr("reflect(SomeType)"),
        makeBareExpr("console.log(Date.now())"),
      ]);
      const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
      checkMetaBlock(meta, null, registry, "/test.scrml", errors);
      const consoleErrs = errors.filter(e => e.code === "E-META-001" && e.message.includes("'console'"));
      expect(consoleErrs.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("§47 let initializer checked for runtime vars", () => {
    const errors = [];
    // Uses reflect() → compile-time meta → E-META-001 applies
    const meta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeLetDecl("x", "runtimeVar + 1"),
    ]);
    const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
    checkMetaBlock(meta, null, registry, "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    expect(meta001s.length).toBeGreaterThanOrEqual(1);
    expect(meta001s[0].message).toContain("runtimeVar");
  });

  test("§48 nested meta — inner ^{} can see outer ^{} const", () => {
    const errors = [];
    const innerMeta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeBareExpr("CONFIG.port"),
    ], 200);
    const outerMeta = makeMetaNode([
      makeBareExpr("reflect(SomeType)"),
      makeConstDecl("CONFIG", "{}"),
      innerMeta,
    ]);
    const registry = new Map([["SomeType", { kind: "enum", name: "SomeType" }]]);
    checkMetaBlock(outerMeta, null, registry, "/test.scrml", errors);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §19-21: checkReflectCalls
// ---------------------------------------------------------------------------

describe("checkReflectCalls", () => {
  test("§19 no error for known type", () => {
    const errors = [];
    const registry = new Map([["PostStatus", { kind: "enum", name: "PostStatus", variants: [] }]]);
    const body = [makeBareExpr("reflect(PostStatus)")];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);
    expect(errors).toHaveLength(0);
  });

  test("§20 E-META-003 for unknown type", () => {
    const errors = [];
    const registry = new Map();
    const body = [makeBareExpr("reflect(NonExistent)")];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-META-003");
    expect(errors[0].message).toContain("NonExistent");
  });

  test("§21 multiple reflect calls in one expression", () => {
    const errors = [];
    const registry = new Map([
      ["PostStatus", { kind: "enum", name: "PostStatus", variants: [] }],
    ]);
    const body = [makeBareExpr("reflect(PostStatus).variants.concat(reflect(Unknown).variants)")];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);
    // PostStatus exists, Unknown does not
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-META-003");
    expect(errors[0].message).toContain("Unknown");
  });
});

// ---------------------------------------------------------------------------
// §22-26: runMetaChecker integration
// ---------------------------------------------------------------------------

describe("runMetaChecker", () => {
  test("§22 output shape: files array and errors array", () => {
    const result = runMetaChecker({ files: [] });
    expect(result).toHaveProperty("files");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.files)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  test("§23 empty input produces empty output", () => {
    const result = runMetaChecker({ files: [] });
    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("§24 integration: clean meta block (no errors)", () => {
    // S134 Bug 17 fix retired the `bun.eval(...)` initializer from this test —
    // it now fires E-META-001 unconditionally per SPEC §22.12 line 14687
    // (JS-host ambient globals are not in META_BUILTINS). The replacement uses
    // `JSON.stringify(...)` (JSON is still in META_BUILTINS) as a compile-time-
    // evaluable initializer that preserves §24's "clean meta block" intent.
    const fileAST = makeFileAST({
      nodes: [
        makeMetaNode([
          makeConstDecl("CONFIG", 'JSON.parse(\'{ "port": 3000 }\')'),
        ]),
      ],
    });
    const result = runMetaChecker({ files: [fileAST] });
    expect(result.errors).toHaveLength(0);
  });

  test("§25 integration: runtime var in compile-time meta (E-META-001)", () => {
    const fileAST = makeFileAST({
      nodes: [
        makeLetDecl("runtimeVar", "42", 1),
        makeMetaNode([
          // Uses reflect() → compile-time meta → E-META-001 applies
          makeBareExpr("reflect(SomeType)"),
          makeBareExpr("runtimeVar + 1"),
        ]),
      ],
      typeDecls: [
        makeTypeDecl("SomeType", "enum", "{ A | B }"),
      ],
    });
    const result = runMetaChecker({ files: [fileAST] });
    const meta001s = result.errors.filter(e => e.code === "E-META-001");
    expect(meta001s.length).toBeGreaterThanOrEqual(1);
    expect(meta001s[0].message).toContain("runtimeVar");
  });

  test("§26 integration: reflect on unknown type (E-META-003)", () => {
    const fileAST = makeFileAST({
      nodes: [
        makeMetaNode([
          makeBareExpr("reflect(NonExistent)"),
        ]),
      ],
    });
    const result = runMetaChecker({ files: [fileAST] });
    const meta003s = result.errors.filter(e => e.code === "E-META-003");
    expect(meta003s.length).toBe(1);
    expect(meta003s[0].message).toContain("NonExistent");
  });
});

// ---------------------------------------------------------------------------
// §27-30: createReflect
// ---------------------------------------------------------------------------

describe("createReflect", () => {
  test("§27 enum reflection returns kind, name, variants", () => {
    const registry = new Map([
      ["PostStatus", {
        kind: "enum",
        name: "PostStatus",
        variants: [{ name: "Draft" }, { name: "Published" }, { name: "Archived" }],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("PostStatus");
    expect(result.kind).toBe("enum");
    expect(result.name).toBe("PostStatus");
    expect(result.variants).toEqual(["Draft", "Published", "Archived"]);
  });

  test("§28 struct reflection returns kind, name, fields", () => {
    const fields = new Map([
      ["username", { kind: "primitive", name: "string" }],
      ["email", { kind: "primitive", name: "string" }],
      ["age", { kind: "primitive", name: "number" }],
    ]);
    const registry = new Map([
      ["UserProfile", {
        kind: "struct",
        name: "UserProfile",
        fields,
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("UserProfile");
    expect(result.kind).toBe("struct");
    expect(result.name).toBe("UserProfile");
    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]).toEqual({ name: "username", type: "string" });
    expect(result.fields[1]).toEqual({ name: "email", type: "string" });
    expect(result.fields[2]).toEqual({ name: "age", type: "number" });
  });

  test("§29 unknown type throws", () => {
    const registry = new Map();
    const reflect = createReflect(registry);
    expect(() => reflect("NonExistent")).toThrow("E-META-003");
  });

  test("§30 non-string input throws", () => {
    const registry = new Map();
    const reflect = createReflect(registry);
    expect(() => reflect(123)).toThrow("requires a type name string");
    expect(() => reflect(null)).toThrow("requires a type name string");
  });
});

// ---------------------------------------------------------------------------
// §31-33: buildFileTypeRegistry
// ---------------------------------------------------------------------------

describe("buildFileTypeRegistry", () => {
  test("§31 registers enums from typeDecls", () => {
    const fileAST = makeFileAST({
      typeDecls: [
        makeTypeDecl("PostStatus", "enum", "{ Draft | Published | Archived }"),
      ],
    });
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("PostStatus")).toBe(true);
    const type = registry.get("PostStatus");
    expect(type.kind).toBe("enum");
    expect(type.variants).toHaveLength(3);
    expect(type.variants[0].name).toBe("Draft");
  });

  test("§32 registers structs from typeDecls", () => {
    const fileAST = makeFileAST({
      typeDecls: [
        makeTypeDecl("UserProfile", "struct", "{ username: string, email: string }"),
      ],
    });
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("UserProfile")).toBe(true);
    const type = registry.get("UserProfile");
    expect(type.kind).toBe("struct");
    expect(type.fields.has("username")).toBe(true);
    expect(type.fields.has("email")).toBe(true);
  });

  test("§33 includes built-in types", () => {
    const fileAST = makeFileAST();
    const registry = buildFileTypeRegistry(fileAST);
    expect(registry.has("number")).toBe(true);
    expect(registry.has("string")).toBe(true);
    expect(registry.has("boolean")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §34-38: parseEnumVariantsFromRaw, parseStructFieldsFromRaw
// ---------------------------------------------------------------------------

describe("parseEnumVariantsFromRaw", () => {
  test("§34 basic enum variants", () => {
    const variants = parseEnumVariantsFromRaw("{ Draft | Published | Archived }");
    expect(variants).toHaveLength(3);
    expect(variants[0].name).toBe("Draft");
    expect(variants[1].name).toBe("Published");
    expect(variants[2].name).toBe("Archived");
  });

  test("§35 enum with payload variants", () => {
    const variants = parseEnumVariantsFromRaw("{ Loading | Success(data: string) | Error(msg: string) }");
    expect(variants).toHaveLength(3);
    expect(variants[0].name).toBe("Loading");
    expect(variants[1].name).toBe("Success");
    expect(variants[2].name).toBe("Error");
  });

  test("§36 empty body", () => {
    const variants = parseEnumVariantsFromRaw("{}");
    expect(variants).toHaveLength(0);
  });
});

describe("parseStructFieldsFromRaw", () => {
  test("§37 basic struct fields", () => {
    const fields = parseStructFieldsFromRaw("{ username: string, email: string, age: number }");
    expect(fields.size).toBe(3);
    expect(fields.has("username")).toBe(true);
    expect(fields.has("email")).toBe(true);
    expect(fields.has("age")).toBe(true);
  });

  test("§38 empty body", () => {
    const fields = parseStructFieldsFromRaw("{}");
    expect(fields.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §39-41: collectRuntimeVars
// ---------------------------------------------------------------------------

describe("collectRuntimeVars", () => {
  test("§39 collects let/const outside meta", () => {
    const fileAST = makeFileAST({
      nodes: [
        makeLetDecl("x"),
        makeConstDecl("y"),
      ],
    });
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("x")).toBe(true);
    expect(vars.has("y")).toBe(true);
  });

  test("§40 collects reactive vars", () => {
    const fileAST = makeFileAST({
      nodes: [
        makeReactiveDecl("count"),
      ],
    });
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("count")).toBe(true);
    expect(vars.has("@count")).toBe(true);
  });

  test("§41 does not collect vars inside meta blocks", () => {
    const fileAST = makeFileAST({
      nodes: [
        makeMetaNode([
          makeLetDecl("metaVar"),
        ]),
      ],
    });
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("metaVar")).toBe(false);
  });

  test("§41b does not collect vars declared inside function-decl body (Bug 6)", () => {
    // 6nz Bug 6 repro: ^{} meta over-captures function-local bindings.
    // `function loadExternal() { const host = ...; const nl = ...; const doc = ...; }`
    // followed by `^{ loadExternal() }` produced an Object.freeze({ host, nl, doc })
    // at module scope where those names don't exist → ReferenceError on mount.
    //
    // The bug: collectRuntimeVars walks into function-decl body and records
    // function-local const/let as if they were module-scope.
    // Fix: function-body scope is not module scope; locals stay inside.
    const fn = makeFnDecl("loadExternal", [
      makeConstDecl("host"),
      makeConstDecl("nl"),
      makeConstDecl("doc"),
    ]);
    const fileAST = makeFileAST({
      nodes: [fn],
    });
    const vars = collectRuntimeVars(fileAST);
    // The function name itself IS module-scope — should be captured.
    expect(vars.has("loadExternal")).toBe(true);
    // Function-local bindings are NOT module-scope — must not leak out.
    expect(vars.has("host")).toBe(false);
    expect(vars.has("nl")).toBe(false);
    expect(vars.has("doc")).toBe(false);
  });

  test("§41c does not collect vars declared inside nested function bodies", () => {
    // Defense-in-depth: a function inside a function, with locals in both.
    const innerFn = makeFnDecl("inner", [
      makeLetDecl("innerLocal"),
    ]);
    const outerFn = makeFnDecl("outer", [
      makeConstDecl("outerLocal"),
      innerFn,
    ]);
    const fileAST = makeFileAST({ nodes: [outerFn] });
    const vars = collectRuntimeVars(fileAST);
    expect(vars.has("outer")).toBe(true);
    // Inner function name is function-local too; should NOT surface at module scope.
    expect(vars.has("inner")).toBe(false);
    expect(vars.has("outerLocal")).toBe(false);
    expect(vars.has("innerLocal")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §42-44: typeToString
// ---------------------------------------------------------------------------

describe("typeToString", () => {
  test("§42 primitive types", () => {
    expect(typeToString({ kind: "primitive", name: "string" })).toBe("string");
    expect(typeToString({ kind: "primitive", name: "number" })).toBe("number");
    expect(typeToString({ kind: "primitive", name: "boolean" })).toBe("boolean");
  });

  test("§43 array types", () => {
    expect(typeToString({ kind: "array", element: { kind: "primitive", name: "string" } })).toBe("string[]");
  });

  test("§44 union types", () => {
    expect(typeToString({
      kind: "union",
      members: [
        { kind: "primitive", name: "string" },
        { kind: "primitive", name: "null" },
      ],
    })).toBe("string | null");
  });
});

// ---------------------------------------------------------------------------
// §49-60: Runtime meta classification (SPEC §22.5)
// ---------------------------------------------------------------------------

describe("bodyUsesCompileTimeApis", () => {
  test("§49 returns false for empty body", () => {
    expect(bodyUsesCompileTimeApis([])).toBe(false);
  });

  test("§49b returns false for null/undefined", () => {
    expect(bodyUsesCompileTimeApis(null)).toBe(false);
    expect(bodyUsesCompileTimeApis(undefined)).toBe(false);
  });

  test("§50 returns true when reflect() is present in bare-expr", () => {
    const body = [makeBareExpr("fields = reflect(UserProfile).fields")];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });

  test("§51 returns false when bun.eval() is present — retired per HU-2 Q4 (F-003)", () => {
    // Per S130 Approach C extension: `bun.eval()` retires as a recognized
    // compile-time-API pattern. The META primitive set closes at reflect /
    // emit / emit.raw (SPEC §22.12). A body containing only `bun.eval(...)`
    // is no longer classified as compile-time meta.
    const body = [makeConstDecl("CONFIG", "bun.eval(`return { port: 3000 }`)")];
    expect(bodyUsesCompileTimeApis(body)).toBe(false);
  });

  test("§52 returns true when emit() is present", () => {
    const body = [makeBareExpr("emit('some-code')")];
    expect(bodyUsesCompileTimeApis(body)).toBe(true);
  });

  test("§54 returns false for pure runtime body (no compile-time APIs)", () => {
    // This block only uses DOM references and reactive vars — runtime meta
    const body = [
      makeBareExpr("document.getElementById('btn').addEventListener('click', handler)"),
      makeBareExpr("@count + 1"),
    ];
    expect(bodyUsesCompileTimeApis(body)).toBe(false);
  });

  test("§60 returns false when bun.readFile is used", () => {
    // bun.readFile is not in the compile-time API patterns. Post-S130, neither
    // is `bun.eval()` (retired per HU-2 Q4 / F-003 — META set closes at
    // reflect / emit / emit.raw per §22.12). The only recognized compile-time
    // API patterns are reflect and emit/emit.raw.
    const body = [makeBareExpr("bun.readFile('./data.json')")];
    expect(bodyUsesCompileTimeApis(body)).toBe(false);
  });

  test("§60b returns false for block referencing only reactive vars", () => {
    const body = [
      makeLetDecl("doubled", "@value * 2"),
      makeBareExpr("console.log(doubled)"),
    ];
    expect(bodyUsesCompileTimeApis(body)).toBe(false);
  });
});

describe("checkMetaBlock — runtime meta classification", () => {
  test("§55 runtime meta: NO E-META-001 for @reactive var reference", () => {
    // Block has no compile-time APIs → runtime meta → no E-META-001
    const errors = [];
    const meta = makeMetaNode([
      makeBareExpr("@count + 1"),
    ]);
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    expect(meta001s).toHaveLength(0);
  });

  test("§56 runtime meta: NO E-META-001 for arbitrary runtime vars", () => {
    // Block has no compile-time APIs → runtime meta → no E-META-001
    const errors = [];
    const meta = makeMetaNode([
      makeBareExpr("document.getElementById('root')"),
      makeBareExpr("someRuntimeVariable.doThing()"),
    ]);
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    expect(meta001s).toHaveLength(0);
  });

  test("§57 compile-time meta with reflect(): E-META-001 fires for runtime vars", () => {
    // Block uses reflect() → compile-time meta → E-META-001 applies
    const errors = [];
    const registry = new Map([["PostStatus", { kind: "enum", name: "PostStatus" }]]);
    const meta = makeMetaNode([
      makeBareExpr("info = reflect(PostStatus)"),
      makeBareExpr("runtimeVar.doSomething()"),
    ]);
    checkMetaBlock(meta, null, registry, "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    expect(meta001s.length).toBeGreaterThanOrEqual(1);
    // Checker flags unknown identifiers — may flag 'info' or 'runtimeVar'
    expect(meta001s.some(e => e.message.includes("runtimeVar") || e.message.includes("info"))).toBe(true);
  });
});

describe("runMetaChecker — runtime meta integration", () => {
  test("§58 runtime meta block with @reactive var produces no E-META-001", () => {
    // A meta block with no compile-time APIs that references a reactive var
    // declared outside: should be classified as runtime meta → no E-META-001.
    const fileAST = makeFileAST({
      nodes: [
        makeReactiveDecl("count", "0", 1),
        makeMetaNode([
          makeBareExpr("@count + 1"),
        ]),
      ],
    });
    const result = runMetaChecker({ files: [fileAST] });
    const meta001s = result.errors.filter(e => e.code === "E-META-001");
    expect(meta001s).toHaveLength(0);
  });

  test("§59 compile-time meta with reflect() + runtime var produces E-META-001", () => {
    // A meta block that uses reflect() (compile-time) AND references a runtime var
    // should still produce E-META-001 for the runtime var reference.
    const fileAST = makeFileAST({
      nodes: [
        makeLetDecl("runtimeVar", "42", 1),
        makeMetaNode([
          makeBareExpr("reflect(PostStatus)"),
          makeBareExpr("runtimeVar.doSomething()"),
        ]),
      ],
      typeDecls: [
        makeTypeDecl("PostStatus", "enum", "{ Draft | Published }"),
      ],
    });
    const result = runMetaChecker({ files: [fileAST] });
    const meta001s = result.errors.filter(e => e.code === "E-META-001");
    expect(meta001s.length).toBeGreaterThanOrEqual(1);
    expect(meta001s[0].message).toContain("runtimeVar");
  });
});

// ---------------------------------------------------------------------------
// §61-67: createReflect — extended types (functions, state, components)
// ---------------------------------------------------------------------------

describe("createReflect — function signatures", () => {
  test("§61 function reflection: no params returns {kind, name, params: [], returnType}", () => {
    const registry = new Map([
      ["greet", {
        kind: "function",
        name: "greet",
        params: [],
        returnType: "unknown",
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("greet");
    expect(result.kind).toBe("function");
    expect(result.name).toBe("greet");
    expect(result.params).toEqual([]);
    expect(result.returnType).toBe("unknown");
  });

  test("§62 function with typed params: params parsed into {name, type} objects", () => {
    // Params stored as raw strings like "x: number" from parseParamList()
    const registry = new Map([
      ["add", {
        kind: "function",
        name: "add",
        params: ["x: number", "y: number"],
        returnType: "unknown",
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("add");
    expect(result.kind).toBe("function");
    expect(result.params).toHaveLength(2);
    expect(result.params[0]).toEqual({ name: "x", type: "number" });
    expect(result.params[1]).toEqual({ name: "y", type: "number" });
  });

  test("§63 function with untyped params: type defaults to 'unknown'", () => {
    // Params stored as plain names with no colon annotation
    const registry = new Map([
      ["log", {
        kind: "function",
        name: "log",
        params: ["msg", "level"],
        returnType: "unknown",
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("log");
    expect(result.params).toHaveLength(2);
    expect(result.params[0]).toEqual({ name: "msg", type: "unknown" });
    expect(result.params[1]).toEqual({ name: "level", type: "unknown" });
  });
});

describe("createReflect — state types", () => {
  test("§64 state reflection returns {kind, name, attributes}", () => {
    const registry = new Map([
      ["TodoItem", {
        kind: "state",
        name: "TodoItem",
        attributes: [
          { name: "title", type: "string" },
          { name: "done", type: "boolean" },
        ],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("TodoItem");
    expect(result.kind).toBe("state");
    expect(result.name).toBe("TodoItem");
    expect(result.attributes).toHaveLength(2);
    expect(result.attributes[0]).toEqual({ name: "title", type: "string" });
    expect(result.attributes[1]).toEqual({ name: "done", type: "boolean" });
  });

  test("§65 state with no attributes returns empty array", () => {
    const registry = new Map([
      ["EmptyState", {
        kind: "state",
        name: "EmptyState",
        attributes: [],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("EmptyState");
    expect(result.kind).toBe("state");
    expect(result.attributes).toEqual([]);
  });
});

describe("createReflect — component shapes", () => {
  test("§66 component reflection returns {kind, name, props}", () => {
    const registry = new Map([
      ["Card", {
        kind: "component",
        name: "Card",
        props: [
          { name: "title", type: "string", optional: false, bindable: false },
          { name: "subtitle", type: "string", optional: true, bindable: false },
        ],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Card");
    expect(result.kind).toBe("component");
    expect(result.name).toBe("Card");
    expect(result.props).toHaveLength(2);
    expect(result.props[0]).toEqual({ name: "title", type: "string", optional: false, bindable: false });
    expect(result.props[1]).toEqual({ name: "subtitle", type: "string", optional: true, bindable: false });
  });

  test("§67 component props carry optional and bindable flags", () => {
    const registry = new Map([
      ["Input", {
        kind: "component",
        name: "Input",
        props: [
          { name: "value", type: "string", optional: false, bindable: true },
          { name: "placeholder", type: "string", optional: true, bindable: false },
        ],
      }],
    ]);
    const reflect = createReflect(registry);
    const result = reflect("Input");
    expect(result.props[0].bindable).toBe(true);
    expect(result.props[0].optional).toBe(false);
    expect(result.props[1].bindable).toBe(false);
    expect(result.props[1].optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §68-72: buildFileTypeRegistry — new sources
// ---------------------------------------------------------------------------

describe("buildFileTypeRegistry — function-decl nodes", () => {
  test("§68 registers function-decl nodes from logic bodies", () => {
    // Simulate a logic node with a function-decl inside (as ast-builder produces)
    const logicNode = {
      kind: "logic",
      body: [
        {
          kind: "function-decl",
          name: "formatDate",
          params: ["date: string", "locale"],
          fnKind: "function",
          isServer: false,
          span: span(0),
        },
      ],
      imports: [],
      exports: [],
      typeDecls: [],
      components: [],
      span: span(0),
    };

    const fileAST = makeFileAST({ nodes: [logicNode] });
    const registry = buildFileTypeRegistry(fileAST);

    expect(registry.has("formatDate")).toBe(true);
    const fn = registry.get("formatDate");
    expect(fn.kind).toBe("function");
    expect(fn.name).toBe("formatDate");
    expect(fn.params).toEqual(["date: string", "locale"]);
  });

  test("§68b function from registry can be reflected on", () => {
    const logicNode = {
      kind: "logic",
      body: [
        {
          kind: "function-decl",
          name: "sum",
          params: ["a: number", "b: number"],
          fnKind: "fn",
          isServer: false,
          span: span(0),
        },
      ],
      imports: [], exports: [], typeDecls: [], components: [],
      span: span(0),
    };

    const fileAST = makeFileAST({ nodes: [logicNode] });
    const registry = buildFileTypeRegistry(fileAST);
    const reflect = createReflect(registry);
    const result = reflect("sum");

    expect(result.kind).toBe("function");
    expect(result.params).toHaveLength(2);
    expect(result.params[0]).toEqual({ name: "a", type: "number" });
    expect(result.params[1]).toEqual({ name: "b", type: "number" });
  });
});

describe("buildFileTypeRegistry — state-constructor-def nodes", () => {
  test("§69 registers state-constructor-def nodes", () => {
    // Simulate a state-constructor-def node (as ast-builder produces for < Name attr(type)>)
    const stateNode = {
      kind: "state-constructor-def",
      stateType: "TodoItem",
      typedAttrs: [
        { name: "title", type: "string" },
        { name: "done", type: "boolean" },
      ],
      attrs: [],
      children: [],
      span: span(0),
    };

    const fileAST = makeFileAST({ nodes: [stateNode] });
    const registry = buildFileTypeRegistry(fileAST);

    expect(registry.has("TodoItem")).toBe(true);
    const st = registry.get("TodoItem");
    expect(st.kind).toBe("state");
    expect(st.name).toBe("TodoItem");
    expect(st.attributes).toHaveLength(2);
    expect(st.attributes[0]).toEqual({ name: "title", type: "string" });
    expect(st.attributes[1]).toEqual({ name: "done", type: "boolean" });
  });

  test("§69b state type can be reflected on", () => {
    const stateNode = {
      kind: "state-constructor-def",
      stateType: "Counter",
      typedAttrs: [{ name: "value", type: "number" }],
      attrs: [], children: [], span: span(0),
    };

    const fileAST = makeFileAST({ nodes: [stateNode] });
    const registry = buildFileTypeRegistry(fileAST);
    const reflect = createReflect(registry);
    const result = reflect("Counter");

    expect(result.kind).toBe("state");
    expect(result.attributes[0]).toEqual({ name: "value", type: "number" });
  });
});

describe("buildFileTypeRegistry — component-def nodes", () => {
  test("§70 registers component-def nodes from fileAST.components", () => {
    // Simulate a component-def node without propsDecl (not yet processed by CE)
    const componentDef = {
      kind: "component-def",
      name: "Card",
      raw: "<div>...</div>",
      span: span(0),
    };

    const fileAST = makeFileAST({ components: [componentDef] });
    const registry = buildFileTypeRegistry(fileAST);

    expect(registry.has("Card")).toBe(true);
    const comp = registry.get("Card");
    expect(comp.kind).toBe("component");
    expect(comp.name).toBe("Card");
    expect(comp.props).toEqual([]);
  });

  test("§71 component props from propsDecl when present", () => {
    // Simulate a component-def node with propsDecl already attached
    // (e.g., in a pre-processed AST or test setup)
    const componentDef = {
      kind: "component-def",
      name: "Button",
      raw: "<button>...</button>",
      propsDecl: [
        { name: "label", type: "string", optional: false, bindable: false },
        { name: "disabled", type: "boolean", optional: true, bindable: false },
      ],
      span: span(0),
    };

    const fileAST = makeFileAST({ components: [componentDef] });
    const registry = buildFileTypeRegistry(fileAST);
    const reflect = createReflect(registry);
    const result = reflect("Button");

    expect(result.kind).toBe("component");
    expect(result.props).toHaveLength(2);
    expect(result.props[0]).toEqual({ name: "label", type: "string", optional: false, bindable: false });
    expect(result.props[1]).toEqual({ name: "disabled", type: "boolean", optional: true, bindable: false });
  });
});

describe("checkReflectCalls — extended type names do not produce E-META-003", () => {
  test("§72 no E-META-003 for function/state/component names in registry", () => {
    // All three new kinds should be recognised as valid reflect() targets
    const registry = new Map([
      ["formatDate", { kind: "function", name: "formatDate", params: [], returnType: "unknown" }],
      ["TodoItem", { kind: "state", name: "TodoItem", attributes: [] }],
      ["Card", { kind: "component", name: "Card", props: [] }],
    ]);

    const body = [
      makeBareExpr("reflect(formatDate)"),
      makeBareExpr("reflect(TodoItem)"),
      makeBareExpr("reflect(Card)"),
    ];
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    // No E-META-003 because all three names are in the registry
    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// §73-74: checkReflectCalls — meta-local variable fix
//
// reflect(metaLocalVar) must NOT produce E-META-003 when metaLocalVar is
// declared with let/const inside the same ^{} block. The identifier will
// resolve at eval time to a string value passed to createReflect().
// ---------------------------------------------------------------------------

describe("checkReflectCalls — meta-local variables do not produce E-META-003", () => {
  test("§73 no E-META-003 when reflect argument is a meta-local const", () => {
    // The meta block body declares: const typeName = "Color"
    // Then calls: reflect(typeName)
    // Since typeName is a meta-local, it resolves at eval time — no E-META-003.
    const body = [
      { id: 1, kind: "const-decl", name: "typeName", init: '"Color"', span: span() },
      { id: 2, kind: "bare-expr", expr: "reflect(typeName)", exprNode: parseExprToNode("reflect(typeName)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map([
      ["Color", { kind: "enum", name: "Color", variants: [{ name: "Red" }] }],
    ]);
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    // typeName is meta-local — must not fire E-META-003
    const e003 = errors.filter(e => e.code === "E-META-003");
    expect(e003).toHaveLength(0);
  });

  test("§73b no E-META-003 for meta-local let variable in reflect()", () => {
    const body = [
      { id: 1, kind: "let-decl", name: "typeName", init: '"Status"', span: span() },
      { id: 2, kind: "bare-expr", expr: "let info = reflect(typeName)", exprNode: parseExprToNode("let info = reflect(typeName)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map([
      ["Status", { kind: "enum", name: "Status", variants: [{ name: "Active" }] }],
    ]);
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });

  test("§74 E-META-003 is still emitted for genuinely unknown type names", () => {
    // UnknownType is NOT in the registry and NOT a meta-local — must fire E-META-003.
    const body = [
      { id: 1, kind: "bare-expr", expr: "reflect(UnknownType)", exprNode: parseExprToNode("reflect(UnknownType)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map(); // empty registry
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(1);
    expect(errors[0].message).toContain("UnknownType");
  });

  test("§74b for-loop variable in reflect() does not produce E-META-003", () => {
    // for (const t of types) { reflect(t) }
    // t is the for-loop variable — it is a meta-local, must not fire E-META-003.
    const body = [
      {
        id: 1, kind: "for-loop", variable: "t", indexVariable: null,
        iterable: "typeNames",
        body: [
          { id: 2, kind: "bare-expr", expr: "reflect(t)", exprNode: parseExprToNode("reflect(t)", "/test/app.scrml", 0), span: span() },
        ],
        span: span(),
      },
    ];
    const registry = new Map([
      ["Color", { kind: "enum", name: "Color", variants: [] }],
    ]);
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // §75-§82: reflect(variable) hybrid resolution — strategy 2
  // -------------------------------------------------------------------------

  test("§75 isVariableIdent — PascalCase is NOT a variable", () => {
    expect(isVariableIdent("Color")).toBe(false);
    expect(isVariableIdent("UserType")).toBe(false);
    expect(isVariableIdent("A")).toBe(false);
  });

  test("§76 isVariableIdent — camelCase IS a variable", () => {
    expect(isVariableIdent("typeName")).toBe(true);
    expect(isVariableIdent("selectedType")).toBe(true);
    expect(isVariableIdent("x")).toBe(true);
  });

  test("§77 isVariableIdent — @var IS a variable", () => {
    expect(isVariableIdent("@selectedType")).toBe(true);
    expect(isVariableIdent("@count")).toBe(true);
  });

  test("§78 isVariableIdent — underscore/dollar prefixed IS a variable", () => {
    expect(isVariableIdent("_temp")).toBe(true);
    expect(isVariableIdent("$ref")).toBe(true);
  });

  test("§79 checkReflectCalls — reflect(variableName) no E-META-003", () => {
    // reflect(typeName) where typeName is camelCase — skip validation
    const body = [
      { id: 1, kind: "bare-expr", expr: "reflect(typeName)", exprNode: parseExprToNode("reflect(typeName)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map(); // empty — typeName is not a type
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });

  test("§80 checkReflectCalls — reflect(@reactiveVar) no E-META-003", () => {
    const body = [
      { id: 1, kind: "bare-expr", expr: "reflect(@selectedType)", exprNode: parseExprToNode("reflect(@selectedType)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map();
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });

  test("§81 checkReflectCalls — reflect(UnknownType) still triggers E-META-003", () => {
    const body = [
      { id: 1, kind: "bare-expr", expr: "reflect(UnknownType)", exprNode: parseExprToNode("reflect(UnknownType)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map();
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    expect(errors.filter(e => e.code === "E-META-003")).toHaveLength(1);
    expect(errors[0].message).toContain("UnknownType");
  });

  test("§82 checkReflectCalls — reflect(KnownType) in compile-time block still inlines", () => {
    const body = [
      { id: 1, kind: "bare-expr", expr: "reflect(Color)", exprNode: parseExprToNode("reflect(Color)", "/test/app.scrml", 0), span: span() },
    ];
    const registry = new Map([
      ["Color", { kind: "enum", name: "Color", variants: ["Red", "Green", "Blue"] }],
    ]);
    const errors = [];
    checkReflectCalls(body, registry, "/test.scrml", span(), errors);

    // Known type — no errors at all
    expect(errors).toHaveLength(0);
  });

  test("§83 runMetaChecker — reflect(variable) compiles without error", () => {
    // Integration test: a file with reflect(typeName) in a meta block
    const fileAST = {
      filePath: "/test/app.scrml",
      ast: {
        nodes: [
          {
            id: 1,
            kind: "meta",
            body: [
              { id: 2, kind: "let-decl", name: "typeName", init: '"Color"', span: span() },
              { id: 3, kind: "bare-expr", expr: "reflect(typeName)", exprNode: parseExprToNode("reflect(typeName)", "/test/app.scrml", 0), span: span() },
            ],
            span: span(),
          },
        ],
      },
      typeDecls: [
        { name: "Color", typeKind: "enum", raw: "{ Red | Green | Blue }" },
      ],
    };

    const result = runMetaChecker({ files: [fileAST] });
    // No E-META-003 errors because typeName is a meta-local variable
    expect(result.errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });

  test("§84 runMetaChecker — reflect(selectedType) with camelCase non-local var: no E-META-003", () => {
    // selectedType is camelCase, not a meta-local — it's a runtime variable
    // that will be resolved at runtime. No E-META-003.
    const fileAST = {
      filePath: "/test/app.scrml",
      ast: {
        nodes: [
          {
            id: 1,
            kind: "meta",
            body: [
              { id: 2, kind: "bare-expr", expr: "reflect(selectedType)", exprNode: parseExprToNode("reflect(selectedType)", "/test/app.scrml", 0), span: span() },
            ],
            span: span(),
          },
        ],
      },
      typeDecls: [],
    };

    const result = runMetaChecker({ files: [fileAST] });
    expect(result.errors.filter(e => e.code === "E-META-003")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §75-79: for-stmt (JS-style for-of) inside ^{} — E-META-001 false-positive fix
//
// `for (const x of array)` inside compile-time ^{} blocks must NOT trigger
// E-META-001 for the loop variable `x`. The parser now produces:
//   { kind: "for-stmt", variable: "x", iterable: "array", body: [...] }
// and collectMetaLocals must recognise for-stmt as a loop kind.
// ---------------------------------------------------------------------------

function makeForStmt(variable, iterable, body = [], id = 1) {
  return {
    id,
    kind: "for-stmt",
    variable,
    iterable,
    body,
    span: span(0),
  };
}

describe("collectMetaLocals — for-stmt (JS-style for-of)", () => {
  test("§75 collects for-stmt iteration variable", () => {
    const body = [makeForStmt("x", "items")];
    const locals = collectMetaLocals(body);
    expect(locals.has("x")).toBe(true);
  });

  test("§76 for-stmt variable is in locals alongside let/const", () => {
    const body = [
      makeConstDecl("items", "['a', 'b']"),
      makeForStmt("x", "items"),
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("items")).toBe(true);
    expect(locals.has("x")).toBe(true);
  });
});

describe("checkMetaBlock — for-stmt iterator variable does not trigger E-META-001", () => {
  test("§77 for-stmt loop variable not flagged in loop body", () => {
    // compile-time ^{} with: for (const x of items) { emit(x) }
    // x is the loop variable — must not trigger E-META-001
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("items", "['a', 'b']", 1),
      makeForStmt("x", "items", [
        makeBareExpr("emit(x)"),
      ], 2),
    ]);
    // make it compile-time by adding a bare-expr with emit() at top level
    meta.body.push(makeBareExpr("emit('done')"));
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // x and items are both meta-locals — neither should fire E-META-001
    const xErrors = meta001s.filter(e => e.message.includes("'x'"));
    expect(xErrors).toHaveLength(0);
  });

  test("§78 for-stmt iterable expression does not shadow unrelated vars", () => {
    // The iterable is a meta-local const, should not fire E-META-001
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("typeNames", "['Foo', 'Bar']", 1),
      makeForStmt("t", "typeNames", [
        makeBareExpr("emit(t)"),
      ], 2),
      makeBareExpr("emit('done')"),
    ]);
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    const tErrors = meta001s.filter(e => e.message.includes("'t'"));
    const typeNamesErrors = meta001s.filter(e => e.message.includes("'typeNames'"));
    expect(tErrors).toHaveLength(0);
    expect(typeNamesErrors).toHaveLength(0);
  });

  test("§79 for-stmt: actual runtime var outside meta still fires E-META-001", () => {
    // runtimeCount is declared outside the meta block — must fire E-META-001
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("items", "['a', 'b']", 1),
      makeForStmt("x", "items", [
        makeBareExpr("runtimeCount + x"),
      ], 2),
      makeBareExpr("emit('done')"),
    ]);
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // runtimeCount is not in metaLocals — must fire
    const runtimeErrors = meta001s.filter(e => e.message.includes("'runtimeCount'"));
    expect(runtimeErrors.length).toBeGreaterThanOrEqual(1);
    // x is a meta-local loop variable — must NOT fire
    const xErrors = meta001s.filter(e => e.message.includes("'x'"));
    expect(xErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §75-83: Destructuring, rest params, default params (E-META-001 false positives)
// ---------------------------------------------------------------------------

describe("extractIdentifiers — destructuring, rest, and default params", () => {
  test("§75 destructured arrow params are locals, not external refs", () => {
    const ids = extractIdentifiers("({ name, age }) => name + age");
    expect(ids).not.toContain("name");
    expect(ids).not.toContain("age");
  });

  test("§76 destructured function params are locals", () => {
    const ids = extractIdentifiers("function({ x, y }) { return x + y }");
    expect(ids).not.toContain("x");
    expect(ids).not.toContain("y");
  });

  test("§77 rest arrow params are locals", () => {
    const ids = extractIdentifiers("(...args) => args.map(a => a)");
    expect(ids).not.toContain("args");
    expect(ids).not.toContain("a");
  });

  test("§78 rest function params are locals", () => {
    const ids = extractIdentifiers("function(a, ...rest) { return rest }");
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("rest");
  });

  test("§79 default param with literal: binding is local", () => {
    const ids = extractIdentifiers("(x = 10) => x + 1");
    expect(ids).not.toContain("x");
  });

  test("§80 default param with reference: binding is local but default IS a reference", () => {
    const ids = extractIdentifiers("(x = defaultVal) => x");
    expect(ids).not.toContain("x");
    expect(ids).toContain("defaultVal");
  });
});

describe("extractParamBindings — unit tests", () => {
  test("simple params", () => {
    const out = new Set();
    extractParamBindings("a, b, c", out);
    expect(out).toEqual(new Set(["a", "b", "c"]));
  });

  test("rest param", () => {
    const out = new Set();
    extractParamBindings("a, ...rest", out);
    expect(out).toEqual(new Set(["a", "rest"]));
  });

  test("destructured object param", () => {
    const out = new Set();
    extractParamBindings("{ name, age }", out);
    expect(out).toEqual(new Set(["name", "age"]));
  });

  test("destructured array param", () => {
    const out = new Set();
    extractParamBindings("[x, y]", out);
    expect(out).toEqual(new Set(["x", "y"]));
  });

  test("object destructuring with rename", () => {
    const out = new Set();
    extractParamBindings("{ name: n, age: a }", out);
    expect(out).toEqual(new Set(["n", "a"]));
  });

  test("default value is NOT a binding", () => {
    const out = new Set();
    extractParamBindings("x = 10, y = defaultVal", out);
    expect(out).toEqual(new Set(["x", "y"]));
    expect(out.has("defaultVal")).toBe(false);
  });

  test("rest with destructuring", () => {
    const out = new Set();
    extractParamBindings("...{ a, b }", out);
    expect(out).toEqual(new Set(["a", "b"]));
  });
});

describe("collectMetaLocals — destructured declarations", () => {
  test("§81 const { a, b } = expr collects a and b as locals", () => {
    // AST builder produces name: "" and init: "{ a, b } = obj" for destructured const
    const body = [
      { id: 1, kind: "const-decl", name: "", init: "{ a, b } = obj", span: span() },
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("a")).toBe(true);
    expect(locals.has("b")).toBe(true);
  });

  test("§82 const [x, ...rest] = arr collects x and rest as locals", () => {
    const body = [
      { id: 1, kind: "const-decl", name: "", init: "[x, ...rest] = arr", span: span() },
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("x")).toBe(true);
    expect(locals.has("rest")).toBe(true);
  });

  test("§83 let { ...rest } = expr collects rest as local", () => {
    const body = [
      { id: 1, kind: "let-decl", name: "", init: "{ ...rest } = expr", span: span() },
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("rest")).toBe(true);
  });
});

describe("extractDestructuredLocals — unit tests", () => {
  test("object destructuring", () => {
    const locals = extractDestructuredLocals("{ a, b } = obj");
    expect(locals).toContain("a");
    expect(locals).toContain("b");
  });

  test("array destructuring", () => {
    const locals = extractDestructuredLocals("[x, y] = arr");
    expect(locals).toContain("x");
    expect(locals).toContain("y");
  });

  test("nested destructuring", () => {
    const locals = extractDestructuredLocals("{ a, nested: { b } } = obj");
    expect(locals).toContain("a");
    expect(locals).toContain("b");
    expect(locals).not.toContain("nested");
  });

  test("rest in destructuring", () => {
    const locals = extractDestructuredLocals("{ a, ...rest } = obj");
    expect(locals).toContain("a");
    expect(locals).toContain("rest");
  });

  test("non-destructuring returns empty", () => {
    expect(extractDestructuredLocals("x = 10")).toEqual([]);
    expect(extractDestructuredLocals("")).toEqual([]);
    expect(extractDestructuredLocals(null)).toEqual([]);
  });
});

describe("checkMetaBlock — destructuring integration (E-META-001)", () => {
  test("§84 destructured const inside compile-time meta does not produce false E-META-001", () => {
    // ^{
    //   const { a, b } = someObj   // a, b are locals
    //   emit(a + b)                // should NOT flag a or b
    // }
    const metaNode = makeMetaNode([
      { id: 1, kind: "const-decl", name: "", init: "{ a, b } = someCompileObj", span: span() },
      { id: 2, kind: "bare-expr", expr: "emit(a + b)", exprNode: parseExprToNode("emit(a + b)", "/test/app.scrml", 0), span: span() },
    ]);
    const errors = [];
    const registry = new Map();
    checkMetaBlock(metaNode, null, registry, "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // a and b should not be flagged — they are meta-locals via destructuring
    for (const err of meta001s) {
      expect(err.message).not.toContain("'a'");
      expect(err.message).not.toContain("'b'");
    }
  });
});

// ---------------------------------------------------------------------------
// §22.7: Runtime meta guard (meta.runtime = false)
// ---------------------------------------------------------------------------

describe("§22.7 Runtime meta guard", () => {
  test("§75 E-META-001 fires for runtime ^{} when meta.runtime is false", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([
            makeBareExpr("console.log(someVar)"),
          ]),
        ],
      })],
      options: { metaRuntime: false },
    });

    const runtimeGuardErrors = result.errors.filter(
      e => e.code === "E-META-001" && e.message.includes("meta.runtime"),
    );
    expect(runtimeGuardErrors.length).toBeGreaterThanOrEqual(1);
  });

  test("§76 no E-META-001 for runtime ^{} when meta.runtime is true (default)", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([
            makeBareExpr("console.log(someVar)"),
          ]),
        ],
      })],
    });

    const runtimeGuardErrors = result.errors.filter(
      e => e.code === "E-META-001" && e.message.includes("meta.runtime"),
    );
    expect(runtimeGuardErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §22.8: Phase separation (E-META-005)
// ---------------------------------------------------------------------------

describe("§22.8 Phase separation (E-META-005)", () => {
  test("§77 bodyMixesPhases — returns true for block with reflect() + runtime var", () => {
    const body = [
      makeBareExpr("info = reflect(MyEnum)"),
      makeBareExpr("console.log(myRuntimeVar)"),
    ];
    const registry = new Map([
      ["MyEnum", { kind: "enum", name: "MyEnum", variants: [] }],
    ]);
    expect(bodyMixesPhases(body, registry)).toBe(true);
  });

  test("§78 bodyMixesPhases — returns false for compile-time-only block", () => {
    const body = [
      makeConstDecl("info", "reflect(MyEnum)"),
      makeBareExpr("emit(info)"),
    ];
    const registry = new Map([
      ["MyEnum", { kind: "enum", name: "MyEnum", variants: [] }],
    ]);
    expect(bodyMixesPhases(body, registry)).toBe(false);
  });

  test("§79 bodyMixesPhases — returns false for runtime-only block", () => {
    const body = [
      makeBareExpr("console.log(someVar)"),
    ];
    const registry = new Map();
    expect(bodyMixesPhases(body, registry)).toBe(false);
  });

  test("§80 runMetaChecker — E-META-005 fires for mixed compile-time + runtime block", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([
            makeBareExpr("info = reflect(MyEnum)"),
            makeBareExpr("myRuntimeVar.doSomething()"),
          ]),
        ],
        typeDecls: [makeTypeDecl("MyEnum", "enum", "{ A | B }")],
      })],
    });

    const e005 = result.errors.filter(e => e.code === "E-META-005");
    expect(e005.length).toBeGreaterThanOrEqual(1);
    expect(e005[0].message).toContain("Phase separation");
  });

  test("§81 runMetaChecker — no E-META-005 for pure compile-time block", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([
            makeConstDecl("info", "reflect(MyEnum)"),
            makeBareExpr("emit(info)"),
          ]),
        ],
        typeDecls: [makeTypeDecl("MyEnum", "enum", "{ A | B }")],
      })],
    });

    const e005 = result.errors.filter(e => e.code === "E-META-005");
    expect(e005).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §22.9: Interaction with other features (E-META-006, E-META-007)
// ---------------------------------------------------------------------------

describe("§22.9 Interaction with other features (E-META-006, E-META-007)", () => {
  test("§82 bodyContainsLift — detects lift() call", () => {
    const body = [makeBareExpr("lift(someComponent)")];
    expect(bodyContainsLift(body)).not.toBeNull();
  });

  test("§83 bodyContainsLift — returns null for body without lift", () => {
    const body = [
      makeBareExpr("console.log('hello')"),
      makeConstDecl("x", "42"),
    ];
    expect(bodyContainsLift(body)).toBeNull();
  });

  test("§84 bodyContainsSqlContext — detects ?{} SQL context", () => {
    const body = [makeBareExpr("let result = ?{ SELECT * FROM users }")];
    expect(bodyContainsSqlContext(body)).not.toBeNull();
  });

  test("§85 bodyContainsSqlContext — returns null for body without SQL context", () => {
    const body = [makeBareExpr("console.log('no sql here')")];
    expect(bodyContainsSqlContext(body)).toBeNull();
  });

  test("§86 runMetaChecker — E-META-006 fires for lift() in ^{} block", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([makeBareExpr("lift(MyComponent)")]),
        ],
      })],
    });

    const e006 = result.errors.filter(e => e.code === "E-META-006");
    expect(e006.length).toBeGreaterThanOrEqual(1);
    expect(e006[0].message).toContain("lift");
  });

  test("§87 runMetaChecker — no E-META-006 for block without lift()", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([makeBareExpr("console.log('hello')")]),
        ],
      })],
    });

    const e006 = result.errors.filter(e => e.code === "E-META-006");
    expect(e006).toHaveLength(0);
  });

  test("§88 runMetaChecker — E-META-007 fires for ?{} in runtime ^{} block", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([makeBareExpr("result = ?{ SELECT 1 }")]),
        ],
      })],
    });

    const e007 = result.errors.filter(e => e.code === "E-META-007");
    expect(e007.length).toBeGreaterThanOrEqual(1);
    expect(e007[0].message).toContain("SQL");
  });

  test("§89 runMetaChecker — no E-META-007 for ?{} in compile-time ^{} block", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([
            makeBareExpr("info = reflect(MyEnum)"),
            makeBareExpr("result = ?{ SELECT 1 }"),
          ]),
        ],
        typeDecls: [makeTypeDecl("MyEnum", "enum", "{ A | B }")],
      })],
    });

    const e007 = result.errors.filter(e => e.code === "E-META-007");
    expect(e007).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// §22.4 / S48: `compiler.*` namespace reserved (E-META-010), and
// E-META-009 nested-meta regression guard.
//
// Per recon docs/recon/compiler-dot-api-decision-2026-04-29.md (Option B):
// `compiler.*` is removed from §22.4 classification. Any reference inside
// any ^{} block fires E-META-010 at meta-checker time.
//
//   §S48a runMetaChecker — E-META-010 fires for compiler.X(...) (depth 2)
//   §S48b runMetaChecker — E-META-010 fires for compiler.options.X (depth 3)
//   §S48c runMetaChecker — reflect/emit/bun.eval still classify compile-time (regression guard)
//   §S48d runMetaChecker — E-META-009 fires for nested ^{} inside compile-time meta
//   §S48e bodyReferencesCompilerNamespace — direct unit test (positive + negative)
// ---------------------------------------------------------------------------

describe("§22.4 / S48 — compiler.* phantom closed (E-META-010) + E-META-009 backfill", () => {
  test("§S48a runMetaChecker — E-META-010 fires for compiler.X(...) (depth 2)", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([makeBareExpr("emit('<p>' + compiler.version + '</p>')")]),
        ],
      })],
    });
    const e010 = result.errors.filter(e => e.code === "E-META-010");
    expect(e010.length).toBeGreaterThanOrEqual(1);
    expect(e010[0].message).toContain("compiler.*");
    expect(e010[0].message.toLowerCase()).toContain("reserved");
  });

  test("§S48b runMetaChecker — E-META-010 fires for compiler.options.X (depth 3)", () => {
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [
          makeMetaNode([makeBareExpr("emit('<p>' + compiler.options.htmlContentModel + '</p>')")]),
        ],
      })],
    });
    const e010 = result.errors.filter(e => e.code === "E-META-010");
    expect(e010.length).toBeGreaterThanOrEqual(1);
  });

  test("§S48c runMetaChecker — reflect/emit still classify compile-time (regression guard)", () => {
    // After removing the `compiler.*` regex, the remaining compile-time API
    // classifiers (reflect, emit, emit.raw) MUST still trigger compile-time
    // classification. This guards against accidental breakage during the
    // deletion.
    //
    // Post-S130: `bun.eval()` retired from this list per HU-2 Q4 (F-003) /
    // SPEC §22.12 Approach C extension. The closed primitive set is now
    // reflect / emit / emit.raw.
    const reflectResult = runMetaChecker({
      files: [makeFileAST({
        nodes: [makeMetaNode([makeBareExpr("info = reflect(Color)")])],
        typeDecls: [makeTypeDecl("Color", "enum", "{ Red | Blue }")],
      })],
    });
    expect(reflectResult.errors.filter(e => e.code === "E-META-010")).toHaveLength(0);

    const emitBody = [makeBareExpr("emit('<p>hi</p>')")];
    expect(bodyUsesCompileTimeApis(emitBody)).toBe(true);

    const emitRawBody = [makeBareExpr("emit.raw('<p>hi</p>')")];
    expect(bodyUsesCompileTimeApis(emitRawBody)).toBe(true);

    const reflectBody = [makeBareExpr("reflect(Color)")];
    expect(bodyUsesCompileTimeApis(reflectBody)).toBe(true);
  });

  test("§S48d runMetaChecker — E-META-009 fires for nested ^{} inside compile-time meta", () => {
    // E-META-009 already exists in source (meta-checker.ts:1568) but was not
    // tabled in §22.11 / §34. This test guards the firing path.
    const innerMeta = makeMetaNode([makeBareExpr("emit('<span>inner</span>')")], 200);
    const outerMeta = makeMetaNode([
      makeBareExpr("info = reflect(Color)"),
      innerMeta,
    ]);
    const result = runMetaChecker({
      files: [makeFileAST({
        nodes: [outerMeta],
        typeDecls: [makeTypeDecl("Color", "enum", "{ Red | Blue }")],
      })],
    });
    const e009 = result.errors.filter(e => e.code === "E-META-009");
    expect(e009.length).toBeGreaterThanOrEqual(1);
    expect(e009[0].message.toLowerCase()).toContain("nested");
  });

  test("§S48e bodyReferencesCompilerNamespace — positive and negative cases", () => {
    // Direct positive
    expect(bodyReferencesCompilerNamespace([makeBareExpr("compiler.version")])).toBe(true);
    // Inside a call argument
    expect(bodyReferencesCompilerNamespace([makeBareExpr("emit(compiler.version)")])).toBe(true);
    // Deep member access
    expect(bodyReferencesCompilerNamespace([makeBareExpr("compiler.options.htmlContentModel")])).toBe(true);
    // In a const-decl init
    expect(bodyReferencesCompilerNamespace([makeConstDecl("v", "compiler.version")])).toBe(true);
    // Negative: bare ident `compiler` with no member access — not flagged
    // (the recon scopes E-META-010 to MEMBER access; a bare ident `compiler`
    //  is most likely a user-named variable). `bodyReferencesCompilerNamespace`
    //  detects MemberExpr.object===Ident("compiler") only.
    expect(bodyReferencesCompilerNamespace([makeBareExpr("let compiler = 1")])).toBe(false);
    // Negative: a property name 'compiler' on something else — also not flagged
    expect(bodyReferencesCompilerNamespace([makeBareExpr("obj.compiler")])).toBe(false);
    // Negative: empty body
    expect(bodyReferencesCompilerNamespace([])).toBe(false);
    // Negative: pure runtime expression
    expect(bodyReferencesCompilerNamespace([makeBareExpr("@count + 1")])).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// §90-94: function-decl params inside ^{} — E-META-001 false-positive fix
//
// When a function declaration inside a compile-time ^{} meta block has
// destructured, rest, or default parameters, references to those params
// in the function body must NOT trigger E-META-001.
//
// Before fix: collectMetaLocals only added the function name — not its params.
// After fix: extractParamBindings is called on each param string so that
//   function process({a, b}) { emit(a + b) } — a, b are meta-locals.
//
//   §90  collectMetaLocals — function-decl with destructured object param
//   §91  collectMetaLocals — function-decl with rest param
//   §92  collectMetaLocals — function-decl with default param
//   §93  checkMetaBlock — function-decl body: destructured params no E-META-001
//   §94  checkMetaBlock — function-decl body: actual runtime var STILL fires
// ---------------------------------------------------------------------------

describe("collectMetaLocals — function-decl params", () => {
  test("§90 destructured object param adds bindings as locals", () => {
    const body = [
      {
        id: 1,
        kind: "function-decl",
        name: "process",
        params: ["{a, b}"],
        body: [],
        span: span(),
      },
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("process")).toBe(true);
    expect(locals.has("a")).toBe(true);
    expect(locals.has("b")).toBe(true);
  });

  test("§91 rest param adds binding as local", () => {
    const body = [
      {
        id: 1,
        kind: "function-decl",
        name: "log",
        params: ["...args"],
        body: [],
        span: span(),
      },
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("log")).toBe(true);
    expect(locals.has("args")).toBe(true);
  });

  test("§92 default param adds binding as local (not default value)", () => {
    const body = [
      {
        id: 1,
        kind: "function-decl",
        name: "greet",
        params: ["x = 5"],
        body: [],
        span: span(),
      },
    ];
    const locals = collectMetaLocals(body);
    expect(locals.has("greet")).toBe(true);
    expect(locals.has("x")).toBe(true);
  });
});

describe("checkMetaBlock — function-decl params do not trigger E-META-001", () => {
  test("§93 function-decl with destructured object params: no false E-META-001", () => {
    // ^{
    //   function process({a, b}) { emit(a + b) }  -- a, b are params, not runtime vars
    //   process({a: 1, b: 2})
    // }
    const fnDecl = {
      id: 1,
      kind: "function-decl",
      name: "process",
      params: ["{a, b}"],
      body: [makeBareExpr("emit(a + b)", 2)],
      span: span(),
    };
    const meta = makeMetaNode([fnDecl, makeBareExpr("process({a: 1, b: 2})", 3)]);
    const errors = [];
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // a and b are params — must NOT be flagged
    const aErrors = meta001s.filter(e => e.message.includes("'a'"));
    const bErrors = meta001s.filter(e => e.message.includes("'b'"));
    expect(aErrors).toHaveLength(0);
    expect(bErrors).toHaveLength(0);
  });

  test("§94 function-decl body: actual runtime var outside params STILL fires E-META-001", () => {
    // ^{
    //   function process({a}) { emit(a + runtimeVar) }  -- runtimeVar is NOT a param
    //   process({a: 1})
    // }
    const fnDecl = {
      id: 1,
      kind: "function-decl",
      name: "process",
      params: ["{a}"],
      body: [makeBareExpr("emit(a + runtimeVar)", 2)],
      span: span(),
    };
    const meta = makeMetaNode([fnDecl, makeBareExpr("process({a: 1})", 3)]);
    const errors = [];
    checkMetaBlock(meta, null, new Map(), "/test.scrml", errors);
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // runtimeVar is not a param — must still fire E-META-001
    const rtErrors = meta001s.filter(e => e.message.includes("'runtimeVar'"));
    expect(rtErrors.length).toBeGreaterThanOrEqual(1);
    // a IS a param — must NOT fire E-META-001
    const aErrors = meta001s.filter(e => e.message.includes("'a'"));
    expect(aErrors).toHaveLength(0);
  });
});
