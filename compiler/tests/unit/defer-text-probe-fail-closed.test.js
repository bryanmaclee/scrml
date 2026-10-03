/**
 * defer-text-probe-fail-closed.test.js — S432 review A-3.
 *
 * The rule-4 / site checks decide whether TEXT contains a `defer` by parsing it
 * with the native statement parser. When the lexer / parser THROWS, the probe
 * used to answer `false` ("no defer here") — failing OPEN. It now answers
 * `null` (could not be verified) and the checker reports the diagnostic,
 * saying the body could not be verified.
 */

import { describe, test, expect } from "bun:test";
import * as ds from "../../src/validators/defer-structure.ts";
import { runDeferChecks } from "../../src/validators/lint-defer.ts";

const throwing = () => { throw new Error("probe parser failure (test)"); };

describe("text probes fail closed when the parser throws", () => {
  test("each probe answers null (unknown), not false", () => {
    ds.withProbeParserForTest(throwing, () => {
      expect(ds.textContainsDeferStatement("defer f()", false)).toBeNull();
      expect(ds.textContainsDirectDeferStatement("defer f()")).toBeNull();
      expect(ds.textLambdaContainsDefer("() => { defer f() }")).toBeNull();
      expect(ds.textContainsNativeKind("yield 1", true, ["Yield"])).toBeNull();
    });
  });

  test("text without the word never reaches the parser (still a definite no)", () => {
    ds.withProbeParserForTest(throwing, () => {
      expect(ds.textContainsDeferStatement("note(1)", false)).toBe(false);
      expect(ds.textContainsDirectDeferStatement("note(1)")).toBe(false);
    });
  });

  test("the checker reports an unverifiable when body as E-DEFER-OUTSIDE-FUNCTION", () => {
    const ast = { filePath: "x.scrml", nodes: [{ kind: "when-effect", dependencies: ["n"], bodyRaw: "defer note(1)", span: { line: 3, col: 5, start: 10, end: 20 } }] };
    const d = ds.withProbeParserForTest(throwing, () => runDeferChecks(ast));
    expect(d.map((x) => x.code)).toEqual(["E-DEFER-OUTSIDE-FUNCTION"]);
    expect(d[0].message).toContain("could not be parsed to verify");
  });

  test("with the real parser the same body is a plain (verified) finding", () => {
    const ast = { filePath: "x.scrml", nodes: [{ kind: "when-effect", dependencies: ["n"], bodyRaw: "defer note(1)", span: { line: 3, col: 5, start: 10, end: 20 } }] };
    const d = runDeferChecks(ast);
    expect(d.map((x) => x.code)).toEqual(["E-DEFER-OUTSIDE-FUNCTION"]);
    expect(d[0].message).not.toContain("could not be parsed");
  });
});
