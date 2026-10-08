/**
 * `test-bind` Codegen Support — Unit Tests (Phase A8 / A6-4)
 *
 * Tests the test-mode dispatch hook emitted by `generateTestJs()` in
 * `compiler/src/codegen/emit-test.ts`. The dispatch hook lives ENTIRELY
 * within the generated test JS file (`<base>.test.js`) — production
 * `clientJs` / `serverJs` outputs are unaffected, satisfying SPEC §19.12.7's
 * "0-byte production cost" guarantee structurally.
 *
 * Coverage:
 *   §1  Positive — handler form (function literal RHS) emission shape
 *   §2  Positive — return-stub form emission shape (lambda-wrap)
 *   §3  Positive — defensive default (`bindKind` undefined → return-stub)
 *   §4  Positive — multiple bindings per `~{}` block
 *   §5  Positive — scope isolation across sibling `~{}` blocks
 *   §6  Positive — E-TEST-006 thrower stubs for unbound same-file server-fns
 *   §7  Positive — bound server-fns suppress thrower-stub emission
 *   §8  Negative — empty testBinds + empty serverFnNames → no dispatch lines
 *   §9  Edge     — testBinds present but serverFnNames empty
 *   §10 Edge     — serverFnNames present but testBinds empty
 *   §11 Regression — backward-compat 3-arg signature still works
 *   §12 End-to-end — runCG produces test JS with dispatch hook
 *   §13 0-byte production cost — clientJs/serverJs identical with/without test-bind
 *
 * Source-of-truth: SPEC §19.12.6 (declaration grammar + scope rule),
 * §19.12.7 (dispatch contract + 0-byte production guarantee), §47.5
 * (encoded-name surface), §34 row E-TEST-006.
 */

import { describe, expect, test } from "bun:test";
import { generateTestJs } from "../../src/codegen/emit-test.ts";
import { runCG } from "../../src/codegen/index.ts";
import { buildAST } from "../../src/ast-builder.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { runSYM } from "../../src/symbol-table.ts";
import { runRI } from "../../src/route-inference.ts";
import { analyzeAll } from "../../src/codegen/analyze.ts";

// ---------------------------------------------------------------------------
// Helpers — synthetic TestGroup builders
// ---------------------------------------------------------------------------

function group({
  name = null,
  line = 1,
  tests = [{ name: "case1", line: 2, body: [], asserts: [] }],
  before = null,
  after = null,
  testBinds = [],
}) {
  return { name, line, tests, before, after, testBinds };
}

function bind(identifier, expression, bindKind, line = 1) {
  return { identifier, expression, line, bindKind };
}

// ---------------------------------------------------------------------------
// §1 — Handler form emission shape
// ---------------------------------------------------------------------------

describe("test-bind codegen §1: handler form emission", () => {
  test("arrow-function RHS emits as `const ident = expr;`", () => {
    const groups = [
      group({
        testBinds: [bind("fetchUser", "(id) => ({ id, name: \"Alice\" })", "handler")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain('const fetchUser = (id) => ({ id, name: "Alice" });');
  });

  test("zero-arg arrow RHS emits handler-form binding", () => {
    const groups = [
      group({
        testBinds: [bind("nullary", "() => 42", "handler")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain("const nullary = () => 42;");
  });

  test("identifier-bound function RHS emits as `const ident = expr;`", () => {
    // A6-3 SYM PASS 18: a single identifier resolving to a function-decl
    // gets bindKind "handler". The codegen emits the identifier verbatim;
    // the test body's lexical scope must resolve it (e.g. via a previous
    // statement in the same describe).
    const groups = [
      group({
        testBinds: [bind("svc", "fakeSvc", "handler")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain("const svc = fakeSvc;");
  });
});

// ---------------------------------------------------------------------------
// §2 — Return-stub form emission shape (lambda-wrap)
// ---------------------------------------------------------------------------

describe("test-bind codegen §2: return-stub form emission", () => {
  test("literal-value RHS emits as `const ident = () => (expr);`", () => {
    const groups = [
      group({
        testBinds: [bind("fetchPosts", "[]", "return-stub")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    // Per §19.12.7: ignore call-site args, return value verbatim.
    // Wrapped lambda makes `fetchPosts(...)` callable while ignoring args.
    expect(out).toContain("const fetchPosts = () => ([]);");
  });

  test("number literal RHS emits return-stub form", () => {
    const groups = [
      group({
        testBinds: [bind("count", "42", "return-stub")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain("const count = () => (42);");
  });

  test("object literal RHS emits return-stub form", () => {
    const groups = [
      group({
        testBinds: [bind("getUser", '{ id: 1, name: "Alice" }', "return-stub")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain('const getUser = () => ({ id: 1, name: "Alice" });');
  });
});

// ---------------------------------------------------------------------------
// §3 — Defensive default: undefined bindKind → return-stub
// ---------------------------------------------------------------------------

describe("test-bind codegen §3: undefined bindKind defaults to return-stub", () => {
  test("missing bindKind annotation falls back to return-stub form", () => {
    // Defensive default per IR comment in `ir.ts:188-191` — codegen still
    // emits a dispatch even if SYM PASS 18 was bypassed.
    const groups = [
      group({
        testBinds: [bind("noKind", '"value"', undefined)],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain('const noKind = () => ("value");');
  });
});

// ---------------------------------------------------------------------------
// §4 — Multiple bindings per `~{}` block (declaration order preserved)
// ---------------------------------------------------------------------------

describe("test-bind codegen §4: multiple bindings per block", () => {
  test("two distinct bindings emit in declaration order", () => {
    const groups = [
      group({
        testBinds: [
          bind("fetchUser", "(id) => ({ id, name: \"Alice\" })", "handler"),
          bind("fetchPosts", "[]", "return-stub"),
        ],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    const idxUser = out.indexOf("const fetchUser =");
    const idxPosts = out.indexOf("const fetchPosts =");
    expect(idxUser).toBeGreaterThan(-1);
    expect(idxPosts).toBeGreaterThan(-1);
    expect(idxUser).toBeLessThan(idxPosts);
  });

  test("worked example from SPEC §19.12.8 emits both binding forms", () => {
    const groups = [
      group({
        name: "engine reaches .Success given synthetic HTTP",
        line: 5,
        testBinds: [
          bind("fetchUser", "(id) => ({ id, name: \"Alice\", email: \"a@b.com\" })", "handler"),
          bind("fetchPosts", "[]", "return-stub"),
        ],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain('const fetchUser = (id) => ({ id, name: "Alice", email: "a@b.com" });');
    expect(out).toContain("const fetchPosts = () => ([]);");
  });
});

// ---------------------------------------------------------------------------
// §5 — Scope isolation across sibling `~{}` blocks
// ---------------------------------------------------------------------------

describe("test-bind codegen §5: scope-local across sibling blocks", () => {
  test("each sibling block emits its bindings inside its own describe scope", () => {
    const groups = [
      group({
        name: "block A",
        line: 5,
        testBinds: [bind("svcA", "() => 1", "handler")],
      }),
      group({
        name: "block B",
        line: 15,
        testBinds: [bind("svcB", "() => 2", "handler")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    // Bindings appear once each — in distinct describe scopes per SPEC §19.12.6.
    const blockAIdx = out.indexOf('describe("block A (line 5)"');
    const blockBIdx = out.indexOf('describe("block B (line 15)"');
    const svcAIdx = out.indexOf("const svcA");
    const svcBIdx = out.indexOf("const svcB");
    expect(blockAIdx).toBeGreaterThan(-1);
    expect(blockBIdx).toBeGreaterThan(-1);
    // svcA appears between block A's open and block B's open.
    expect(svcAIdx).toBeGreaterThan(blockAIdx);
    expect(svcAIdx).toBeLessThan(blockBIdx);
    // svcB appears after block B's open.
    expect(svcBIdx).toBeGreaterThan(blockBIdx);
  });

  test("block A's binding does NOT appear inside block B's describe", () => {
    const groups = [
      group({
        name: "A",
        line: 1,
        testBinds: [bind("only_in_A", "1", "return-stub")],
      }),
      group({
        name: "B",
        line: 10,
        testBinds: [],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    // The binding should appear exactly once.
    const matches = out.match(/const only_in_A/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6 — E-TEST-006 thrower stubs for unbound same-file server-fns
// ---------------------------------------------------------------------------

describe("test-bind codegen §6: E-TEST-006 thrower stubs", () => {
  test("unbound same-file server-fn emits an E-TEST-006 thrower stub", () => {
    const groups = [
      group({ testBinds: [] }),
    ];
    const out = generateTestJs("/src/app.scrml", groups, [], ["sendEmail"]);
    expect(out).toContain("const sendEmail = (...args) => { throw new _scrml_g.Error(");
    expect(out).toContain("E-TEST-006");
    expect(out).toContain("sendEmail");
  });

  test("thrower stub error message names the unbound fn and references SPEC §19.12.7", () => {
    const groups = [group({ testBinds: [] })];
    const out = generateTestJs("/src/app.scrml", groups, [], ["unbound"]);
    expect(out).toContain("server function `unbound`");
    expect(out).toContain("test-bind unbound = <stub>");
    expect(out).toContain("§19.12.7");
  });

  test("multiple unbound server-fns emit independent thrower stubs", () => {
    const groups = [group({ testBinds: [] })];
    const out = generateTestJs("/src/app.scrml", groups, [], ["a", "b", "c"]);
    expect(out).toContain("const a = (...args) => { throw new _scrml_g.Error(");
    expect(out).toContain("const b = (...args) => { throw new _scrml_g.Error(");
    expect(out).toContain("const c = (...args) => { throw new _scrml_g.Error(");
  });
});

// ---------------------------------------------------------------------------
// §7 — Bound server-fns suppress thrower-stub emission
// ---------------------------------------------------------------------------

describe("test-bind codegen §7: bound server-fns suppress thrower stubs", () => {
  test("a `test-bind` for a server-fn omits the thrower stub for that name", () => {
    const groups = [
      group({
        testBinds: [bind("fetchUser", "(id) => ({ id })", "handler")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups, [], ["fetchUser", "sendEmail"]);
    // fetchUser appears as a bound dispatch, not a thrower:
    expect(out).toContain("const fetchUser = (id) => ({ id });");
    // sendEmail still gets a thrower:
    expect(out).toContain("const sendEmail = (...args) => { throw new _scrml_g.Error(");
    // fetchUser does NOT appear as a thrower (no double-declaration):
    const throwerCount = (out.match(/const fetchUser = \(\.\.\.args\)/g) ?? []).length;
    expect(throwerCount).toBe(0);
  });

  test("scope isolation: bound in block A, thrown in block B (no leak)", () => {
    // Block A binds `svc`; block B does not. Both get serverFnNames=["svc"].
    // In block A: `svc` is bound (no thrower). In block B: `svc` thrower.
    const groups = [
      group({
        name: "A",
        line: 1,
        testBinds: [bind("svc", "() => 1", "handler")],
      }),
      group({
        name: "B",
        line: 10,
        testBinds: [],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups, [], ["svc"]);
    // Should appear exactly twice as `const svc = ...`: once bound, once thrower.
    const allDecls = out.match(/const svc =/g);
    expect(allDecls).not.toBeNull();
    expect(allDecls.length).toBe(2);
    expect(out).toContain("const svc = () => 1;");
    expect(out).toContain("const svc = (...args) => { throw new _scrml_g.Error(");
  });
});

// ---------------------------------------------------------------------------
// §8 — Empty testBinds + empty serverFnNames → no dispatch emission
// ---------------------------------------------------------------------------

describe("test-bind codegen §8: empty inputs → zero dispatch lines", () => {
  test("no testBinds and no serverFnNames → no `const`-shadowing emission", () => {
    const groups = [group({ testBinds: [] })];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).not.toContain("const fetchUser");
    expect(out).not.toContain("E-TEST-006");
    expect(out).not.toContain("(...args) => { throw");
  });

  test("test JS is well-formed with no dispatch hooks (back-compat)", () => {
    const groups = [
      group({
        tests: [
          {
            name: "basic",
            line: 2,
            body: ["assert 1 == 1"],
            asserts: [{ raw: "1 == 1", op: "==", lhs: "1", rhs: "1" }],
          },
        ],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups);
    expect(out).toContain("expect(1).toEqual(1);");
  });
});

// ---------------------------------------------------------------------------
// §9 — testBinds present, serverFnNames empty
// ---------------------------------------------------------------------------

describe("test-bind codegen §9: testBinds without serverFnNames", () => {
  test("bound dispatches emit; no thrower stubs", () => {
    const groups = [
      group({
        testBinds: [bind("svc", "(x) => x", "handler")],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups, []);
    expect(out).toContain("const svc = (x) => x;");
    expect(out).not.toContain("E-TEST-006");
  });
});

// ---------------------------------------------------------------------------
// §10 — serverFnNames present, testBinds empty
// ---------------------------------------------------------------------------

describe("test-bind codegen §10: serverFnNames without testBinds", () => {
  test("all serverFnNames get thrower stubs", () => {
    const groups = [group({ testBinds: [] })];
    const out = generateTestJs("/src/app.scrml", groups, [], ["a", "b"]);
    expect(out).toContain("const a = (...args) => { throw new _scrml_g.Error(");
    expect(out).toContain("const b = (...args) => { throw new _scrml_g.Error(");
  });
});

// ---------------------------------------------------------------------------
// §11 — Backward-compat: 3-arg signature
// ---------------------------------------------------------------------------

describe("test-bind codegen §11: backward-compat 3-arg signature", () => {
  test("3-arg call (filePath, groups, scopeSnapshot) still works", () => {
    const groups = [
      group({
        tests: [
          {
            name: "basic",
            line: 2,
            body: [],
            asserts: [{ raw: "x == 5", op: "==", lhs: "x", rhs: "5" }],
          },
        ],
      }),
    ];
    const out = generateTestJs("/src/app.scrml", groups, [{ name: "x", initValue: "5" }]);
    expect(out).toContain("let x = 5;");
    expect(out).toContain("expect(x).toEqual(5);");
  });
});

// ---------------------------------------------------------------------------
// §12 — End-to-end via runCG
// ---------------------------------------------------------------------------

function runCompilePipeline(filePath, source, opts = {}) {
  const bs = splitBlocks(filePath, source);
  const { ast, errors: tabErrors } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  // RI works on a multi-file map.
  const ri = runRI({ files: [{ filePath, ast }] });
  const cg = runCG({
    files: [ast],
    routeMap: ri.routeMap,
    depGraph: { nodes: new Map(), edges: [] },
    testMode: opts.testMode ?? false,
    mode: "browser",
    embedRuntime: true,
  });
  return { ast, sym, tabErrors, cg };
}

describe("test-bind codegen §12: end-to-end runCG produces test JS with dispatch hook", () => {
  test("testMode=true with bound server-fn emits handler dispatch in test JS", () => {
    // Note: the A6-2 parser tokenizes the RHS and the codegen emits the
    // joined-token form, so punctuation is space-separated and string-token
    // quotes are stripped (parser tokenizer produces STRING token with raw
    // text without quotes). This is a known artefact of the raw-token-join
    // approach used for `test-bind` RHS — the JS so emitted is still valid
    // JavaScript with whitespace inside expressions.
    const src = `\${
  server fn fetchUser(id) { id }
}
~{
  test-bind fetchUser = (id) => ({ id, name: 1 })
  test "user load" { assert true }
}
`;
    const { cg } = runCompilePipeline("/src/app.scrml", src, { testMode: true });
    const out = cg.outputs.get("/src/app.scrml");
    expect(out).toBeTruthy();
    expect(out.testJs).toBeTruthy();
    // Match key fragments without being brittle to tokenizer whitespace.
    expect(out.testJs).toContain("const fetchUser =");
    expect(out.testJs).toMatch(/const fetchUser = \( id \) => \( \{ id , name : 1 \} \)/);
  });

  test("testMode=true with unbound same-file server-fn emits E-TEST-006 thrower", () => {
    const src = `\${
  server fn sendEmail(to) { to }
}
~{
  test "side-effect" { assert true }
}
`;
    const { cg } = runCompilePipeline("/src/app.scrml", src, { testMode: true });
    const out = cg.outputs.get("/src/app.scrml");
    expect(out.testJs).toBeTruthy();
    expect(out.testJs).toContain("const sendEmail = (...args) => { throw new _scrml_g.Error(");
    expect(out.testJs).toContain("E-TEST-006");
  });

  test("testMode=true mixed: bound + unbound server-fns → mixed emission", () => {
    const src = `\${
  server fn fetchUser(id) { id }
  server fn sendEmail(to) { to }
}
~{
  test-bind fetchUser = (id) => ({ id })
  test "mixed" { assert true }
}
`;
    const { cg } = runCompilePipeline("/src/app.scrml", src, { testMode: true });
    const out = cg.outputs.get("/src/app.scrml");
    // fetchUser → handler-form binding (whitespace tolerant)
    expect(out.testJs).toMatch(/const fetchUser = \( id \) => \( \{ id \} \)/);
    // sendEmail → E-TEST-006 thrower stub
    expect(out.testJs).toContain("const sendEmail = (...args) => { throw new _scrml_g.Error(");
  });
});

// ---------------------------------------------------------------------------
// §13 — 0-byte production cost (SPEC §19.12.7 normative)
// ---------------------------------------------------------------------------

describe("test-bind codegen §13: 0-byte production cost", () => {
  test("testMode=false produces no test JS even when test-bind declarations are present", () => {
    const src = `\${
  server fn fetchUser(id) { id }
}
~{
  test-bind fetchUser = (id) => ({ id })
  test "case" { assert true }
}
`;
    const { cg } = runCompilePipeline("/src/app.scrml", src, { testMode: false });
    const out = cg.outputs.get("/src/app.scrml");
    expect(out).toBeTruthy();
    // Production binary: no test JS output.
    expect(out.testJs).toBeFalsy();
  });

  test("clientJs is bit-identical with vs without test-bind declarations (testMode=false)", () => {
    const srcWith = `\${
  server fn fetchUser(id) { id }
}
~{
  test-bind fetchUser = (id) => ({ id })
  test "case" { assert true }
}
<div>hello</div>
`;
    const srcWithout = `\${
  server fn fetchUser(id) { id }
}
<div>hello</div>
`;
    const cgWith = runCompilePipeline("/src/app.scrml", srcWith, { testMode: false }).cg;
    const cgWithout = runCompilePipeline("/src/app.scrml", srcWithout, { testMode: false }).cg;
    const outWith = cgWith.outputs.get("/src/app.scrml");
    const outWithout = cgWithout.outputs.get("/src/app.scrml");
    // §19.12.7 normative: production binary is bit-identical.
    expect(outWith.clientJs).toBe(outWithout.clientJs);
    expect(outWith.serverJs).toBe(outWithout.serverJs);
  });
});
