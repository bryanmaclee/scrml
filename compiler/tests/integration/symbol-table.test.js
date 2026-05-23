/**
 * Symbol Table — Phase A1b Step B1
 *
 * Tests the per-scope state-cell symbol table constructed by Stage 3.06 SYM
 * (`compiler/src/symbol-table.ts`). B1 is FOUNDATIONAL infrastructure —
 * fires NO diagnostics; B2 onward fires the first diagnostics
 * (E-NAME-COLLIDES-STATE).
 *
 * Per BRIEF §4 invariants:
 *   §B1.1  file-level state-decl registers in file scope
 *   §B1.2  legacy @-form state-decl registers in same scope
 *   §B1.3  function body creates child scope
 *   §B1.4  Variant C compound parent + children register correctly
 *   §B1.5  nested compound supports qualified-path registration
 *   §B1.6  derived cell registers with isConst:true + shape:"derived"
 *   §B1.7  pinned modifier captured in record
 *   §B1.8  typed-decl annotation captured
 *   §B1.9  validator presence captured
 *   §B1.10 defaultExpr presence captured
 *   §B1.11 lookupStateCell walks parent chain
 *   §B1.12 scope kinds receive correct ScopeKind label
 *   §B1.13 empty compound parent registers without children
 *   §B1.14 getScopeForNode reverse-lookup works
 *   §B1.15 re-entrancy invariant — simulating B11 adding records post-B1
 *
 * Per BRIEF §4.3 (anti-folklore guard): every test asserts BOTH the
 * symbol-table state AND the underlying record-field shape.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runSYM,
  lookupStateCell,
  lookupQualifiedStateCell,
  getScopeForNode,
} from "../../src/symbol-table.ts";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function buildSymbolTable(source) {
  const { ast, errors } = parse(source);
  const sym = runSYM({ filePath: "test.scrml", ast });
  return { ast, errors, sym };
}

/**
 * Walk an AST recursively and collect every node with `kind === target`.
 * Skips circular `block` and `parent` back-refs that some BS-derived nodes
 * carry by ignoring keys that point to nodes we've already visited.
 */
function findKind(ast, target) {
  const out = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.kind === target) out.push(n);
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return out;
}

describe("§B1.1 file-level state-decl registers in file scope", () => {
  test("Shape 1 plain `<count> = 0` registers in file scope", () => {
    const { sym } = buildSymbolTable(`<program>\${ <count> = 0 }</program>`);
    expect(sym.fileScope.kind).toBe("file");
    expect(sym.fileScope.parent).toBeNull();
    expect(sym.fileScope.qualifiedPath).toBe("");
    expect(sym.fileScope.stateCells.has("count")).toBe(true);

    const rec = sym.fileScope.stateCells.get("count");
    expect(rec).toBeDefined();
    expect(rec.name).toBe("count");
    expect(rec.qualifiedPath).toBe("count");
    expect(rec.structuralForm).toBe(true);
    expect(rec.shape).toBe("plain");
    expect(rec.isConst).toBe(false);
    expect(rec.isCompoundParent).toBe(false);
    expect(rec.isCompoundChild).toBe(false);
    expect(rec.scope).toBe(sym.fileScope);
  });

  test("multiple file-level state-decls all register", () => {
    const src = `<program>\${ <a> = 0; <b> = 1 }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(sym.fileScope.stateCells.has("a")).toBe(true);
    expect(sym.fileScope.stateCells.has("b")).toBe(true);
    expect(sym.fileScope.stateCells.get("a").qualifiedPath).toBe("a");
    expect(sym.fileScope.stateCells.get("b").qualifiedPath).toBe("b");
  });
});

describe("§B1.2 legacy @-form state-decl registers in same scope", () => {
  test("legacy `@count = 0` registers with structuralForm:false", () => {
    const { sym } = buildSymbolTable(`<program>\${ @count = 0 }</program>`);
    expect(sym.fileScope.stateCells.has("count")).toBe(true);
    const rec = sym.fileScope.stateCells.get("count");
    expect(rec.name).toBe("count");
    expect(rec.structuralForm).toBe(false);
    // The legacy form goes through the same registration path; downstream
    // discriminants depend on structuralForm to know which syntax was used.
  });

  test("structural and legacy forms coexist when names differ", () => {
    const src = `<program>\${ <a> = 0; @b = 1 }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(sym.fileScope.stateCells.size).toBe(2);
    expect(sym.fileScope.stateCells.get("a").structuralForm).toBe(true);
    expect(sym.fileScope.stateCells.get("b").structuralForm).toBe(false);
  });
});

describe("§B1.3 function body creates child scope", () => {
  test("state-decl inside function body registers in function scope, NOT file scope", () => {
    const src = `<program>\${
      function foo() { @x = 1 }
    }</program>`;
    const { ast, sym } = buildSymbolTable(src);

    // x is in function scope, not file scope.
    expect(sym.fileScope.stateCells.has("x")).toBe(false);

    // Locate the function-decl node and verify its _scope annotation.
    const fnDecls = findKind(ast, "function-decl");
    expect(fnDecls.length).toBe(1);
    const fnScope = fnDecls[0]._scope;
    expect(fnScope).toBeDefined();
    expect(fnScope.kind).toBe("function");
    expect(fnScope.parent).toBe(sym.fileScope);
    expect(fnScope.stateCells.has("x")).toBe(true);
    expect(fnScope.stateCells.get("x").scope).toBe(fnScope);
  });
});

describe("§B1.4 Variant C compound parent + children register correctly", () => {
  // Variant C compound syntax (Step 11.0a): `<NAME><child>=...<child>=... </>`.
  // The closer is anonymous `</>`. Children are nested state-decls; no
  // wrapping `{}` braces — children sit directly in the compound body.
  test("compound `<formRes><name>=\"\" <email>=\"\" </>` registers parent + children", () => {
    const src = `<program>\${ <formRes><name>="" <email>="" </> }</program>`;
    const { sym } = buildSymbolTable(src);

    // Parent registered in file scope.
    expect(sym.fileScope.stateCells.has("formRes")).toBe(true);
    const parent = sym.fileScope.stateCells.get("formRes");
    expect(parent.name).toBe("formRes");
    expect(parent.qualifiedPath).toBe("formRes");
    expect(parent.isCompoundParent).toBe(true);
    expect(parent.isCompoundChild).toBe(false);

    // Compound sub-scope attached to the parent's decl node.
    const compoundScope = parent.declNode._scope;
    expect(compoundScope).toBeDefined();
    expect(compoundScope.kind).toBe("compound");
    expect(compoundScope.parent).toBe(sym.fileScope);
    expect(compoundScope.qualifiedPath).toBe("formRes.");

    // Children registered in compound sub-scope with qualified paths.
    expect(compoundScope.stateCells.has("name")).toBe(true);
    expect(compoundScope.stateCells.has("email")).toBe(true);
    const nameRec = compoundScope.stateCells.get("name");
    expect(nameRec.name).toBe("name");
    expect(nameRec.qualifiedPath).toBe("formRes.name");
    expect(nameRec.isCompoundChild).toBe(true);
    expect(nameRec.isCompoundParent).toBe(false);
    const emailRec = compoundScope.stateCells.get("email");
    expect(emailRec.qualifiedPath).toBe("formRes.email");
  });

  test("compound parent NOT visible at compound sub-scope level (it lives in enclosing scope)", () => {
    const src = `<program>\${ <formRes><name>="" </> }</program>`;
    const { sym } = buildSymbolTable(src);
    const parent = sym.fileScope.stateCells.get("formRes");
    const compoundScope = parent.declNode._scope;
    // formRes itself is in fileScope, not compoundScope.
    expect(compoundScope.stateCells.has("formRes")).toBe(false);
    expect(sym.fileScope.stateCells.has("name")).toBe(false);
  });
});

describe("§B1.5 nested compound supports qualified-path registration", () => {
  test("nested compound `<outer><inner><leaf>=\"\"</></></>` produces three-level path", () => {
    const src = `<program>\${ <outer><inner><leaf>=""</></></> }</program>`;
    const { sym } = buildSymbolTable(src);

    // outer in file scope.
    expect(sym.fileScope.stateCells.has("outer")).toBe(true);
    const outerRec = sym.fileScope.stateCells.get("outer");
    expect(outerRec.qualifiedPath).toBe("outer");
    expect(outerRec.isCompoundParent).toBe(true);

    // inner in outer's sub-scope.
    const outerScope = outerRec.declNode._scope;
    expect(outerScope.qualifiedPath).toBe("outer.");
    expect(outerScope.stateCells.has("inner")).toBe(true);
    const innerRec = outerScope.stateCells.get("inner");
    expect(innerRec.qualifiedPath).toBe("outer.inner");
    expect(innerRec.isCompoundParent).toBe(true);

    // leaf in inner's sub-scope.
    const innerScope = innerRec.declNode._scope;
    expect(innerScope.qualifiedPath).toBe("outer.inner.");
    expect(innerScope.stateCells.has("leaf")).toBe(true);
    const leafRec = innerScope.stateCells.get("leaf");
    expect(leafRec.qualifiedPath).toBe("outer.inner.leaf");
    expect(leafRec.isCompoundParent).toBe(false);
    expect(leafRec.isCompoundChild).toBe(true);

    // lookupQualifiedStateCell resolves the full path.
    const fromLookup = lookupQualifiedStateCell(sym.fileScope, ["outer", "inner", "leaf"]);
    expect(fromLookup).toBe(leafRec);
  });
});

describe("§B1.6 derived cell registers with isConst:true + shape:'derived'", () => {
  test("`const <doubled> = @count * 2` derived shape captured in record", () => {
    const src = `<program>\${
      <count> = 0
      const <doubled> = @count * 2
    }</program>`;
    const { sym } = buildSymbolTable(src);

    expect(sym.fileScope.stateCells.has("doubled")).toBe(true);
    const rec = sym.fileScope.stateCells.get("doubled");
    expect(rec.name).toBe("doubled");
    expect(rec.isConst).toBe(true);
    expect(rec.shape).toBe("derived");
    expect(rec.structuralForm).toBe(true);
  });
});

describe("§B1.7 pinned modifier captured in record", () => {
  test("`<x pinned> = 0` records isPinned:true", () => {
    const src = `<program>\${ <x pinned> = 0 }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(sym.fileScope.stateCells.has("x")).toBe(true);
    const rec = sym.fileScope.stateCells.get("x");
    expect(rec.isPinned).toBe(true);
  });

  test("`<y> = 0` (no pinned) records isPinned:false", () => {
    const src = `<program>\${ <y> = 0 }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("y");
    expect(rec.isPinned).toBe(false);
  });
});

describe("§B1.8 typed-decl annotation captured", () => {
  test("`<count>: number = 0` records hasTypeAnnotation:true", () => {
    const src = `<program>\${ <count>: number = 0 }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("count");
    expect(rec).toBeDefined();
    expect(rec.hasTypeAnnotation).toBe(true);
  });

  test("`<count> = 0` (untyped) records hasTypeAnnotation:false", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("count");
    expect(rec.hasTypeAnnotation).toBe(false);
  });
});

describe("§B1.9 validator presence captured", () => {
  test("`<email req email> = <input type=\"email\"/>` records hasValidators:true", () => {
    const src = `<program>\${ <email req email> = <input type="email"/> }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("email");
    expect(rec).toBeDefined();
    expect(rec.hasValidators).toBe(true);
  });

  test("`<x> = 0` (no validators) records hasValidators:false", () => {
    const src = `<program>\${ <x> = 0 }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("x");
    expect(rec.hasValidators).toBe(false);
  });
});

describe("§B1.10 defaultExpr presence captured", () => {
  test("`<startTime default=null> = Date.now()` records hasDefaultExpr:true", () => {
    const src = `<program>\${ <startTime default=null> = Date.now() }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("startTime");
    expect(rec).toBeDefined();
    expect(rec.hasDefaultExpr).toBe(true);
  });

  test("`<count> = 0` (no default) records hasDefaultExpr:false", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { sym } = buildSymbolTable(src);
    const rec = sym.fileScope.stateCells.get("count");
    expect(rec.hasDefaultExpr).toBe(false);
  });
});

describe("§B1.11 lookupStateCell walks parent chain", () => {
  test("file-scope cell visible from inside function body via parent walk", () => {
    const src = `<program>\${
      <count> = 0
      function foo() { @y = 1 }
    }</program>`;
    const { ast, sym } = buildSymbolTable(src);

    const fnDecls = findKind(ast, "function-decl");
    const fnScope = fnDecls[0]._scope;

    // From the function scope, `count` resolves via parent chain (it's in file).
    const countRec = lookupStateCell(fnScope, "count");
    expect(countRec).toBeDefined();
    expect(countRec.name).toBe("count");
    expect(countRec.scope).toBe(sym.fileScope);

    // `y` resolves locally (it's in fnScope).
    const yRec = lookupStateCell(fnScope, "y");
    expect(yRec).toBeDefined();
    expect(yRec.scope).toBe(fnScope);
  });

  test("lookupStateCell returns null for unregistered name", () => {
    const { sym } = buildSymbolTable(`<program>\${ <count> = 0 }</program>`);
    expect(lookupStateCell(sym.fileScope, "missing")).toBeNull();
  });

  test("lookupStateCell handles null scope without throwing", () => {
    expect(lookupStateCell(null, "anything")).toBeNull();
    expect(lookupStateCell(undefined, "anything")).toBeNull();
  });
});

describe("§B1.12 scope kinds receive correct ScopeKind label", () => {
  test("file root is kind:'file'; function body is kind:'function'; compound parent is kind:'compound'", () => {
    const src = `<program>\${
      <formRes><name>="" </>
      function foo() {}
    }</program>`;
    const { ast, sym } = buildSymbolTable(src);

    expect(sym.fileScope.kind).toBe("file");

    const fnDecls = findKind(ast, "function-decl");
    expect(fnDecls.length).toBe(1);
    expect(fnDecls[0]._scope.kind).toBe("function");

    const formRes = sym.fileScope.stateCells.get("formRes");
    expect(formRes.declNode._scope.kind).toBe("compound");
  });
});

describe("§B1.13 empty compound parent registers without children", () => {
  test("`<empty></>` registers parent with compound sub-scope (post-B11: holds 4 synth cells)", () => {
    const src = `<program>\${ <empty></> }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(sym.fileScope.stateCells.has("empty")).toBe(true);
    const rec = sym.fileScope.stateCells.get("empty");
    expect(rec.isCompoundParent).toBe(true);
    expect(rec.declNode._scope).toBeDefined();
    expect(rec.declNode._scope.kind).toBe("compound");
    // B11 (S68): every compound parent — including empty ones — receives
    // four synthesized validity-surface cells (isValid, errors, touched,
    // submitted) per §55.5 predictability rule. So an empty compound's
    // sub-scope holds ONLY those four synth cells (no dev children).
    expect(rec.declNode._scope.stateCells.size).toBe(4);
    for (const synthName of ["isValid", "errors", "touched", "submitted"]) {
      const synthRec = rec.declNode._scope.stateCells.get(synthName);
      expect(synthRec).toBeDefined();
      expect(synthRec.isSynthesized).toBe(true);
    }
  });
});

describe("§B1.14 getScopeForNode reverse-lookup works", () => {
  test("getScopeForNode on a state-decl returns its registered scope", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast, sym } = buildSymbolTable(src);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(getScopeForNode(decls[0])).toBe(sym.fileScope);
  });

  test("getScopeForNode on a function-decl returns its function scope", () => {
    const src = `<program>\${ function foo() {} }</program>`;
    const { ast } = buildSymbolTable(src);
    const fnDecls = findKind(ast, "function-decl");
    expect(fnDecls.length).toBe(1);
    const scope = getScopeForNode(fnDecls[0]);
    expect(scope).toBeDefined();
    expect(scope.kind).toBe("function");
  });

  test("getScopeForNode on an unrelated node returns null", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast } = buildSymbolTable(src);
    const fragments = findKind(ast, "html-fragment");
    if (fragments.length > 0) {
      expect(getScopeForNode(fragments[0])).toBeNull();
    } else {
      // No html-fragment in this case; pass trivially.
      expect(true).toBe(true);
    }
  });

  test("getScopeForNode handles null/undefined safely", () => {
    expect(getScopeForNode(null)).toBeNull();
    expect(getScopeForNode(undefined)).toBeNull();
  });
});

describe("§B1.15 re-entrancy invariant — post-B12 simulation (still future)", () => {
  test("an EXTRA record can be added to existing scope post-SYM and looked up (re-entrancy)", () => {
    // Post-B11 (S68): the four compound-level synth cells are already
    // registered by `runSYM`. This test verifies the SCOPE re-entrancy
    // invariant: the scope is still mutable post-runSYM (B12 will add
    // per-field synth cells; future B-steps may add more). The injection
    // here uses a non-synth-property name so it doesn't conflict with B11.
    const src = `<program>\${ <signup><name>="" </> }</program>`;
    const { sym } = buildSymbolTable(src);

    const signupRec = sym.fileScope.stateCells.get("signup");
    expect(signupRec).toBeDefined();
    const signupScope = signupRec.declNode._scope;
    expect(signupScope).toBeDefined();

    // B11 synth cells already there; verify pre-existing state.
    expect(signupScope.stateCells.has("isValid")).toBe(true);

    // Construct an EXTRA synthetic record (simulating a future B-step's
    // addition) and inject into the existing scope.
    const extraName = "_someFutureBStepCell";
    expect(signupScope.stateCells.has(extraName)).toBe(false);
    const synthRec = {
      name: extraName,
      qualifiedPath: "signup." + extraName,
      declNode: { kind: "state-decl", name: extraName, _synthesized: true },
      scope: signupScope,
      structuralForm: true,
      shape: "derived",
      isConst: true,
      isPinned: false,
      isCompoundParent: false,
      isCompoundChild: true,
      hasValidators: false,
      hasDefaultExpr: false,
      hasTypeAnnotation: false,
    };
    signupScope.stateCells.set(extraName, synthRec);

    // Lookup recovers the injected record.
    expect(signupScope.stateCells.has(extraName)).toBe(true);
    expect(signupScope.stateCells.get(extraName)).toBe(synthRec);

    // Qualified-path lookup also finds it.
    const fromQualified = lookupQualifiedStateCell(sym.fileScope, ["signup", extraName]);
    expect(fromQualified).toBe(synthRec);
    expect(fromQualified.qualifiedPath).toBe("signup." + extraName);
  });
});

describe("SYM general invariants", () => {
  test("runSYM emits no errors at B1 (foundational pass)", () => {
    const src = `<program>\${
      <count> = 0
      <formRes><name>="" <email>="" </>
      const <doubled> = @count * 2
      function foo() { @x = 1 }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(sym.errors).toEqual([]);
  });

  test("FileAST gains _scope back-pointer after runSYM", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast, sym } = buildSymbolTable(src);
    expect(ast._scope).toBe(sym.fileScope);
  });

  test("stats counts match registered records and scopes", () => {
    const src = `<program>\${
      <a> = 0
      <b> = 1
      <compound><child1>="" <child2>="" </>
    }</program>`;
    const { sym } = buildSymbolTable(src);
    // a, b, compound (parent), child1, child2 = 5 records
    expect(sym.stats.totalRecords).toBe(5);
    expect(sym.stats.compoundParents).toBe(1);
    expect(sym.stats.compoundChildren).toBe(2);
    // file scope + compound scope = 2 scopes (no functions in this src)
    expect(sym.stats.totalScopes).toBe(2);
  });

  test("lookupQualifiedStateCell handles edge cases", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { sym } = buildSymbolTable(src);

    // Empty path returns null.
    expect(lookupQualifiedStateCell(sym.fileScope, [])).toBeNull();

    // Non-array path returns null.
    expect(lookupQualifiedStateCell(sym.fileScope, null)).toBeNull();

    // Single-segment path equivalent to lookupStateCell.
    const single = lookupQualifiedStateCell(sym.fileScope, ["count"]);
    expect(single).toBe(sym.fileScope.stateCells.get("count"));

    // Path that descends through a non-compound returns null.
    const tooDeep = lookupQualifiedStateCell(sym.fileScope, ["count", "foo"]);
    expect(tooDeep).toBeNull();

    // Missing first segment returns null.
    expect(lookupQualifiedStateCell(sym.fileScope, ["missing"])).toBeNull();
  });
});

// ===========================================================================
// §B2 — V5-strict local-decl shadow check (E-NAME-COLLIDES-STATE)
// ===========================================================================
//
// Per SPEC §6.1.3 + §34: a local `let`/`const`/`tilde`/`lin` declaration whose
// name matches a registered state-cell name in scope (or any enclosing scope)
// is `E-NAME-COLLIDES-STATE`. V5-strict invariant: locals cannot shadow
// registered state.
//
// Tests below exercise:
//   - Positive collisions across all four local-decl kinds.
//   - Negative cases (no fire when the name isn't registered).
//   - Nested scope shadowing (parent-chain walk).
//   - Compound-cell collisions (qualifiedPath disambiguation).
//   - Forward-ref hoisting (state-decl appears AFTER the local in source order).
//   - Multi-collision (multiple local-decls firing in the same scope).
// ===========================================================================

function symErrorCount(sym) {
  return sym.errors.filter((e) => e.code === "E-NAME-COLLIDES-STATE").length;
}

function symErrorAt(sym, name) {
  return sym.errors.find(
    (e) => e.code === "E-NAME-COLLIDES-STATE" && e.message.includes("`" + name + "\`"),
  );
}

describe("§B2.1 positive — let-decl shadows file-scope state cell", () => {
  test("`<count> = 0` + function body `let count = 5` fires E-NAME-COLLIDES-STATE", () => {
    const src = `<program>\${
      <count> = 0
      function inc() {
        let count = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const err = sym.errors[0];
    expect(err.code).toBe("E-NAME-COLLIDES-STATE");
    expect(err.severity).toBe("error");
    // Anti-folklore guard: message identifies the local + the cell.
    expect(err.message).toContain("count");
    expect(err.message).toContain("E-NAME-COLLIDES-STATE");
    expect(err.message).toContain("V5-strict");
  });
});

describe("§B2.2 positive — const-decl shadows state cell", () => {
  test("`<userName> = \"\"` + function body `const userName = \"guest\"` fires", () => {
    const src = `<program>\${
      <userName> = ""
      function format() {
        const userName = "guest"
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    expect(sym.errors[0].message).toContain("const userName");
    expect(sym.errors[0].message).toContain("<userName>");
  });
});

describe("§B2.3 negative — no fire when name does NOT match a state cell", () => {
  test("`<count> = 0` + function body `let total = 5` does NOT fire", () => {
    const src = `<program>\${
      <count> = 0
      function f() {
        let total = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(0);
  });

  test("function body `let count = 5` with NO state cell does NOT fire", () => {
    const src = `<program>\${
      function f() {
        let count = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(0);
  });
});

describe("§B2.4 positive — multiple decls colliding in same function fire multiple diagnostics", () => {
  test("two locals each shadowing a different state cell each fire once", () => {
    const src = `<program>\${
      <count> = 0
      <name> = ""
      function f() {
        let count = 5
        let name = "x"
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(2);
    expect(symErrorAt(sym, "let count")).toBeDefined();
    expect(symErrorAt(sym, "let name")).toBeDefined();
  });
});

describe("§B2.5 positive — tilde-decl (bare `name = expr`) shadows state cell", () => {
  test("`<count> = 0` + function body `count = 5` fires (bare-name = tilde-decl)", () => {
    // Per ast-builder.js:7274, bare `IDENT = expr` in logic position parses
    // as tilde-decl. This is a v0.next form (~-typed must-use variable).
    const src = `<program>\${
      <count> = 0
      function f() {
        count = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    // tilde-decl displays as bare name (no leading keyword).
    const err = sym.errors[0];
    expect(err.message).toContain("`count`");
    expect(err.message).toContain("<count>");
  });
});

describe("§B2.6 positive — lin-decl shadows state cell", () => {
  test("`<token> = null` + function body `lin token = makeToken()` fires", () => {
    const src = `<program>\${
      <token> = null
      function f() {
        lin token = makeToken()
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    expect(sym.errors[0].message).toContain("lin token");
  });
});

describe("§B2.7 positive — forward-reference: state-decl AFTER local-decl still fires", () => {
  test("local-decl appearing BEFORE state-decl in source still triggers (hoisting)", () => {
    // State cells hoist per SPEC §6 — the let-decl's `count` collides even
    // though `<count>` is declared after the function in source order. The
    // two-pass walker design (PASS 1 registers, PASS 2 checks) handles this
    // cleanly without source-order dependency.
    const src = `<program>\${
      function f() {
        let count = 5
      }
      <count> = 0
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    expect(sym.errors[0].message).toContain("count");
  });
});

describe("§B2.8 positive — nested function inherits collision check via parent-chain walk", () => {
  test("collision in inner function with state cell at file scope fires", () => {
    const src = `<program>\${
      <count> = 0
      function outer() {
        function inner() {
          let count = 5
        }
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
  });
});

describe("§B2.9 positive — compound-parent collision", () => {
  test("compound parent name collides with outer let-decl", () => {
    // The compound parent `signup` registers in the FILE scope; an outer
    // `let signup` in a sibling function therefore collides.
    const src = `<program>\${
      <signup>
        <name> = ""
        <email> = ""
      </>
      function f() {
        let signup = "x"
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    expect(sym.errors[0].message).toContain("let signup");
    expect(sym.errors[0].message).toContain("<signup>");
  });
});

describe("§B2.10 negative — compound-child name does NOT register at file scope", () => {
  test("compound CHILD `name` is NOT shadowed by outer-function `let name`", () => {
    // Per B1: compound children register in the PARENT'S compound sub-scope,
    // NOT at file scope. So a `let name` in an outer function does NOT collide
    // with `signup.name` (the qualified path) — only with a hypothetical
    // top-level `<name>` cell.
    const src = `<program>\${
      <signup>
        <name> = ""
        <email> = ""
      </>
      function f() {
        let name = "x"
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    // No collision: `name` is only registered as `signup.name` (compound-
    // child), so the top-level `let name` doesn't shadow the leaf.
    expect(symErrorCount(sym)).toBe(0);
  });
});

describe("§B2.11 spans + cross-cell-display", () => {
  test("error span points at the local-decl, not the state-decl", () => {
    const src = `<program>\${
      <count> = 0
      function f() {
        let count = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    // The span should be on the `let count = 5` line, NOT on the `<count>` decl.
    const err = sym.errors[0];
    expect(err.span).toBeDefined();
    // The let-decl appears AFTER the state-decl in this source; the span's
    // start offset should be greater than the state-decl's offset.
    const stateDeclStart = src.indexOf("<count> = 0");
    expect(err.span.start).toBeGreaterThan(stateDeclStart);
  });

  test("error message includes the qualified path for compound cells", () => {
    const src = `<program>\${
      <form>
        <name> = ""
      </>
      function f() {
        let form = "x"
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    // The cell's qualifiedPath is `form` (top-level compound parent).
    expect(sym.errors[0].message).toContain("<form>");
  });
});

// ===========================================================================
// §B2.12 — Wave 13 Unit Z: did-you-mean hint on let-decl collisions
// ===========================================================================
//
// E-NAME-COLLIDES-STATE for `let-decl` carries an additional "did you mean"
// hint covering the JS-transliteration shape (`let p = 0` + `@p = @p + 1`).
// The hint names two fix paths in scrml-author terms (no compiler jargon):
//   (a) remove the `let`, write to `@cell` directly
//   (b) rename the local, use plain reassignment
//
// const/lin/tilde decls keep the existing message UNCHANGED (different
// ergonomics — once-bound forms don't need a reassignment hint).
// ===========================================================================

describe("§B2.12 hint — let-decl collision carries did-you-mean for V5-strict fix paths", () => {
  test("`let p` shadowing `<p>` includes the JS-transliteration hint", () => {
    const src = `<program>\${
      <p> = 0
      function f() {
        let p = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const err = sym.errors[0];
    // Base message preserved (existing assertions still hold).
    expect(err.message).toContain("E-NAME-COLLIDES-STATE");
    expect(err.message).toContain("let p");
    expect(err.message).toContain("V5-strict");
    // Hint additive — labelled `hint:` and names both fix paths.
    expect(err.message).toContain("hint:");
    expect(err.message).toContain("`let p = ...`");
    expect(err.message).toContain("`@p = ...`");
    expect(err.message).toContain("(a)");
    expect(err.message).toContain("(b)");
    // The hint uses the qualifiedPath in its (a) path so it matches the
    // base message's cell reference.
    expect(err.message).toContain("`@p` directly");
    // The hint names a concrete rename for fix path (b).
    expect(err.message).toContain("pLocal");
  });

  test("`const p` shadowing `<p>` does NOT include the hint (different ergonomics)", () => {
    const src = `<program>\${
      <p> = 0
      function f() {
        const p = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const err = sym.errors[0];
    // Base diagnostic still fires.
    expect(err.message).toContain("E-NAME-COLLIDES-STATE");
    expect(err.message).toContain("const p");
    // No JS-transliteration hint on const-decl.
    expect(err.message).not.toContain("hint:");
    expect(err.message).not.toContain("JS-style");
  });

  test("`lin p` shadowing `<p>` does NOT include the hint", () => {
    const src = `<program>\${
      <p> = 0
      function f() {
        lin p = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const err = sym.errors[0];
    expect(err.message).toContain("E-NAME-COLLIDES-STATE");
    expect(err.message).toContain("lin p");
    expect(err.message).not.toContain("hint:");
  });

  test("tilde-decl `p = 5` shadowing `<p>` does NOT include the hint", () => {
    const src = `<program>\${
      <p> = 0
      function f() {
        p = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const err = sym.errors[0];
    expect(err.message).toContain("E-NAME-COLLIDES-STATE");
    expect(err.message).toContain("`p`");
    expect(err.message).not.toContain("hint:");
  });

  test("let-decl hint uses compound qualified-path for nested cells", () => {
    // The hint's (a) path writes to `@<qualifiedPath>` — for compound
    // collisions, the cell display uses the full dotted path.
    const src = `<program>\${
      <form>
        <name> = ""
      </>
      function f() {
        let form = "x"
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const err = sym.errors[0];
    expect(err.message).toContain("let form");
    expect(err.message).toContain("<form>");
    // Hint fires for let-decl + names the qualified cell.
    expect(err.message).toContain("hint:");
    expect(err.message).toContain("`@form`");
  });

  test("no collision = no hint (no E-NAME-COLLIDES-STATE at all)", () => {
    // Negative regression: hint must NOT appear in any unrelated diagnostic
    // (or as a literal string) when there's nothing to collide with.
    const src = `<program>\${
      function f() {
        let p = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(0);
    // No diagnostic should contain the hint text.
    for (const e of sym.errors) {
      expect(e.message).not.toContain("hint: This often arises");
    }
  });

  test("snapshot — full message text for the canonical let-shadow case", () => {
    // Anti-folklore snapshot: lock the exact final message wording so any
    // future drift (typo, rephrase) surfaces in review.
    const src = `<program>\${
      <count> = 0
      function f() {
        let count = 5
      }
    }</program>`;
    const { sym } = buildSymbolTable(src);
    expect(symErrorCount(sym)).toBe(1);
    const msg = sym.errors[0].message;
    // Spot-check key phrases — the test is intentionally not a verbatim
    // string compare to allow trivial wording cleanup, but the load-bearing
    // tokens are pinned.
    expect(msg).toContain(
      "E-NAME-COLLIDES-STATE: local `let count` shadows registered state cell `<count>`",
    );
    expect(msg).toContain("Rename the local, or use `@count`");
    expect(msg).toContain(
      "hint: This often arises when JS-style code uses `let count = ...`",
    );
    expect(msg).toContain("The structural cell `<count>` is the reactive store");
    expect(msg).toContain("(a) If you wanted to mutate the state cell");
    expect(msg).toContain("remove the `let count` line");
    expect(msg).toContain("use `@count` directly (read) and `@count = expr` (write)");
    expect(msg).toContain("(b) If you wanted a separate local, rename it");
    expect(msg).toContain("`let countLocal = ...`");
  });
});
