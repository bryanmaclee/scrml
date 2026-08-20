/**
 * <program db="..."> driver detection at codegen time (SPEC §44.2)
 *
 * Coverage:
 *   §A  postgres:// passes through (no error)
 *   §B  postgresql:// passes through (no error)
 *   §C  mysql:// passes through (no error)
 *   §D  mongodb:// emits E-SQL-005 with helpful ^{} pointer
 *   §E  Empty db= emits E-SQL-005
 *   §F  Typo'd scheme emits E-SQL-005
 *   §G  SQLite forms (path, :memory:) pass through
 *   §H  _dbScope.driver attribute is set on the program node
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { runCG } from "../../src/code-generator.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/** Build a <program db="..."> markup node with a single child (a logic block, optional). */
function makeProgramNode(dbValue, children = []) {
  return {
    kind: "markup",
    tag: "program",
    attributes: [
      {
        name: "db",
        value: { kind: "string-literal", value: dbValue },
        span: span(10),
      },
    ],
    children,
    selfClosing: false,
    span: span(0),
  };
}

function makeFileAST(nodes) {
  return {
    filePath: "/test/app.scrml",
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
  };
}

function compile(programNode, extraNodes = []) {
  const ast = makeFileAST([...extraNodes, programNode]);
  return runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
}

beforeEach(() => {
  resetVarCounter();
});

describe("§A postgres:// in <program db=> passes without error", () => {
  test("postgres:// — no E-SQL-005", () => {
    const node = makeProgramNode("postgres://user:pass@localhost:5432/mydb");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(false);
  });

  test("postgres:// — _dbScope.driver tagged as 'postgres'", () => {
    const node = makeProgramNode("postgres://localhost/mydb");
    compile(node);
    expect(node._dbScope).toBeDefined();
    expect(node._dbScope.driver).toBe("postgres");
    expect(node._dbScope.connectionString).toBe("postgres://localhost/mydb");
  });
});

describe("§B postgresql:// alias", () => {
  test("postgresql:// — no error, driver=postgres", () => {
    const node = makeProgramNode("postgresql://localhost/mydb");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(false);
    expect(node._dbScope.driver).toBe("postgres");
  });
});

describe("§C mysql:// (Phase 3 — recognized only)", () => {
  test("mysql:// — no E-SQL-005, driver=mysql", () => {
    const node = makeProgramNode("mysql://user:pass@localhost:3306/mydb");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(false);
    expect(node._dbScope.driver).toBe("mysql");
  });
});

describe("§D mongodb:// — E-SQL-005 with ^{} guidance", () => {
  test("mongodb:// emits E-SQL-005", () => {
    const node = makeProgramNode("mongodb://localhost:27017/mydb");
    const { errors } = compile(node);
    const e = errors.find(err => err.code === "E-SQL-005");
    expect(e).toBeDefined();
    expect(e.message).toContain("MongoDB");
    expect(e.message).toContain("^{}");
  });

  test("mongo:// also emits E-SQL-005", () => {
    const node = makeProgramNode("mongo://localhost/mydb");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(true);
  });
});

describe("§E Empty db= value", () => {
  test("empty string emits E-SQL-005", () => {
    const node = makeProgramNode("");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(true);
  });
});

describe("§F Typo'd scheme", () => {
  test("postgress:// (typo) emits E-SQL-005 with scheme echoed", () => {
    const node = makeProgramNode("postgress://localhost/mydb");
    const { errors } = compile(node);
    const e = errors.find(err => err.code === "E-SQL-005");
    expect(e).toBeDefined();
    expect(e.message).toContain("postgress");
    expect(e.message).toContain("Supported schemes");
  });

  test("redis:// emits E-SQL-005", () => {
    const node = makeProgramNode("redis://localhost:6379");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(true);
  });
});

describe("§G SQLite forms pass through", () => {
  test(":memory: — no error, driver=sqlite", () => {
    const node = makeProgramNode(":memory:");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(false);
    expect(node._dbScope.driver).toBe("sqlite");
  });

  test("./app.db — no error, driver=sqlite", () => {
    const node = makeProgramNode("./app.db");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(false);
    expect(node._dbScope.driver).toBe("sqlite");
  });

  test("sqlite: prefix — driver=sqlite", () => {
    const node = makeProgramNode("sqlite:./users.db");
    const { errors } = compile(node);
    expect(errors.some(e => e.code === "E-SQL-005")).toBe(false);
    expect(node._dbScope.driver).toBe("sqlite");
  });
});

describe("§H _dbScope annotation invariants", () => {
  test("named program (with name=) DOES get _dbScope — §4.12.3 makes name= optional, not absent", () => {
    // INVERTED (S356 round 3). This test used to assert `_dbScope` is
    // UNDEFINED here, on the rationale "if name= is present, the program is a
    // worker, not a DB scope". That rationale is the `name=`-keyed over-claim
    // this arc exists to correct: §4.12.3's table spells the row
    // `Scoped DB context | name= (optional), db=`, and §4.12.3's normative
    // statement says a nested `<program>` is an inline worker "if and only if
    // it carries `name=` and carries none of `lang=`, `mode=`, `route=`,
    // `db=`, `port=`".
    //
    // The consequence of the old gate was measurable and silent:
    //   <program db="mongodb://…">                  -> E-SQL-005
    //   <program name="analytics" db="mongodb://…">  -> silent, exit 0
    // The named form got no `?{}` re-scoping and no §44.2 driver resolution,
    // so it queried the PARENT's database while compiling clean.
    const node = {
      kind: "markup",
      tag: "program",
      attributes: [
        { name: "db", value: { kind: "string-literal", value: "postgres://x" }, span: span(10) },
        { name: "name", value: { kind: "string-literal", value: "analytics" }, span: span(20) },
      ],
      children: [],
      selfClosing: false,
      span: span(0),
    };
    compile(node);
    expect(node._dbScope).toBeDefined();
    expect(node._dbScope.driver).toBe("postgres");
    expect(node._dbScope.connectionString).toBe("postgres://x");
  });

  test("a `db=` co-occurring with `mode=` is the WASM context, NOT a DB scope", () => {
    // The precedence guard. `classifyNestedProgram` is exclusive and
    // most-specific-first, so widening the scoped-DB gate must not let a
    // Nominal execution context in through the `db=` door.
    const node = {
      kind: "markup",
      tag: "program",
      attributes: [
        { name: "db", value: { kind: "string-literal", value: "postgres://x" }, span: span(10) },
        { name: "name", value: { kind: "string-literal", value: "calc" }, span: span(20) },
        { name: "mode", value: { kind: "string-literal", value: "wasm" }, span: span(30) },
      ],
      children: [],
      selfClosing: false,
      span: span(0),
    };
    compile(node);
    expect(node._dbScope).toBeUndefined();
  });

  test("scoped dbVar increments per program scope", () => {
    const node1 = makeProgramNode("postgres://localhost/db1");
    const node2 = makeProgramNode("./local.db");
    const ast = makeFileAST([node1, node2]);
    runCG({
      files: [ast],
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectAnalysis: { views: new Map() },
    });
    expect(node1._dbScope.dbVar).toBe("_scrml_sql_1");
    expect(node2._dbScope.dbVar).toBe("_scrml_sql_2");
    expect(node1._dbScope.driver).toBe("postgres");
    expect(node2._dbScope.driver).toBe("sqlite");
  });
});
