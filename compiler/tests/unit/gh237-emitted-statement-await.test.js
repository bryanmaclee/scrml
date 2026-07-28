/**
 * gh237-emitted-statement-await.test.js — unit coverage for the GH #237 helpers
 * in `codegen/scheduling.ts`.
 *
 * `on mount { … }` is desugared to a SINGLE `bare-expr` carrying the raw body
 * text (SPEC §6.7.1a), and a multi-statement body fails `safeParseExprToNode`,
 * so codegen lowers the whole block through the string pipeline — there is no
 * statement list to hand `scheduleStatements`. `splitEmittedStatements` restores
 * the statement view over the EMITTED text; `liftEmittedStatementAwaits` then
 * delegates every await decision to `injectPromiseAwait` (the single source of
 * truth for the §13.2 lowering).
 *
 * The two properties that matter here:
 *   1. the split is LOSSLESS (`join("") === input`) — the caller reassembles it;
 *   2. a control-flow statement is NEVER handed to `injectPromiseAwait` (its
 *      case-4 fallback would emit `await if (…) { … }`, a syntax error).
 */

import { describe, test, expect } from "bun:test";
import {
  splitEmittedStatements,
  liftEmittedStatementAwaits,
  emittedCodeCallsServerFn,
} from "../../src/codegen/scheduling.ts";

const routeMap = {
  functions: new Map([
    ["n1", { boundary: "server", functionName: "loadMe" }],
    ["n2", { boundary: "client", functionName: "bump" }],
  ]),
};

describe("splitEmittedStatements", () => {
  test("splits on depth-0 semicolons", () => {
    expect(splitEmittedStatements("a();\nb();")).toEqual(["a();", "\nb();"]);
  });

  test("a `;` inside a string / object / for-header does not split", () => {
    expect(splitEmittedStatements(`const s = "a;b";`)).toHaveLength(1);
    expect(splitEmittedStatements(`const o = { a: 1 };`)).toHaveLength(1);
    expect(splitEmittedStatements(`for (let i = 0; i < 3; i++) { f(i); }`)).toHaveLength(1);
  });

  test("`if … } else { …` stays ONE statement", () => {
    const src = "if (x) {\n  a();\n}\nelse {\n  b();\n}";
    expect(splitEmittedStatements(src)).toEqual([src]);
  });

  test("a template literal with `${}` interpolation does not split", () => {
    expect(splitEmittedStatements("const t = `x${ f(1) }y`;")).toHaveLength(1);
  });

  test("the split is lossless", () => {
    const src = `const u = loadMe(1);\n_scrml_reactive_set("you", loadMe(1));\nif (u) {\n  a();\n}\nelse {\n  b();\n}\n`;
    expect(splitEmittedStatements(src).join("")).toBe(src);
  });
});

describe("emittedCodeCallsServerFn", () => {
  test("true only for a `boundary: \"server\"` callee", () => {
    expect(emittedCodeCallsServerFn("const u = loadMe(1);", routeMap)).toBe(true);
    expect(emittedCodeCallsServerFn("bump();", routeMap)).toBe(false);
    expect(emittedCodeCallsServerFn("bump();", { functions: new Map() })).toBe(false);
  });
});

describe("liftEmittedStatementAwaits", () => {
  test("awaits a plain-local declaration (the GH #237 shape)", () => {
    expect(liftEmittedStatementAwaits("const u = loadMe(1);", routeMap, "f.scrml"))
      .toBe("const u = await loadMe(1);");
  });

  test("awaits an assignment RHS", () => {
    expect(liftEmittedStatementAwaits("res = loadMe(1);", routeMap, "f.scrml"))
      .toBe("res = await loadMe(1);");
  });

  test("descends one block deep — §13.2 is position-invariant", () => {
    const out = liftEmittedStatementAwaits(
      "if (x) {\n  const r = loadMe(1);\n}\nelse {\n  const s = loadMe(2);\n}",
      routeMap,
      "f.scrml",
    );
    expect(out).toContain("const r = await loadMe(1);");
    expect(out).toContain("const s = await loadMe(2);");
    // The control-flow statement itself is never prefixed.
    expect(out).not.toContain("await if");
    expect(out).not.toContain("await else");
  });

  test("leaves the reactive-cell destination to emit-client's own async-IIFE lift", () => {
    const src = `_scrml_reactive_set("you", loadMe(1));`;
    expect(liftEmittedStatementAwaits(src, routeMap, "f.scrml")).toBe(src);
  });

  test("never injects `await` into a sync callback (the fail-closed surface)", () => {
    const src = `_scrml_init_set("you", () => loadMe(1));`;
    expect(liftEmittedStatementAwaits(src, routeMap, "f.scrml")).toBe(src);
    const src2 = `el.addEventListener("click", function () { loadMe(1); });`;
    expect(liftEmittedStatementAwaits(src2, routeMap, "f.scrml")).toBe(src2);
  });

  test("a body with no server callee is returned byte-identically", () => {
    const src = "const n = bump();\nif (n) {\n  bump();\n}";
    expect(liftEmittedStatementAwaits(src, routeMap, "f.scrml")).toBe(src);
  });
});
