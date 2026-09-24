/**
 * forbidden-js-native-fallback.test.js — S430 round 4.
 *
 * E-CLASS-NOT-IN-SCRML / E-DYNAMIC-IMPORT-NOT-IN-SCRML are decided on the
 * native parser's tree in both pipelines (native-walker/forbidden-js-native.ts).
 * When the native tree cannot speak for a default-parser statement that holds
 * a construct acorn itself found, the default pipeline must not silently pass
 * it: it reports the construct at the STATEMENT's start (the fallback).
 */

import { describe, test, expect } from "bun:test";
import { forbiddenJsDiagnosticsForDefault } from "../../src/native-walker/forbidden-js-native.ts";

const stmt = (start, line, col, exprNode) => ({
  id: 7, kind: "bare-expr", expr: "x", exprNode,
  span: { file: "f.scrml", start, end: start + 5, line, col },
});
const astWith = (statement) => ({
  nodes: [{ id: 1, kind: "logic", body: [statement], span: { file: "f.scrml", start: 0, end: 40, line: 1, col: 1 } }],
});

describe("fallback — native silent, acorn found a construct", () => {
  // The source says `class` only in prose, so the native tree reports nothing;
  // the (synthetic) default statement carries an acorn ClassExpression.
  const source = "<p>a class act</p>";
  test("reported once, at the statement start, and counted", () => {
    const ast = astWith(stmt(12, 2, 3, { kind: "escape-hatch", nativeKind: "ClassExpression", raw: "class {}" }));
    const r = forbiddenJsDiagnosticsForDefault("f.scrml", source, ast);
    expect(r.fallbackUsed).toBe(1);
    expect(r.diagnostics.map((d) => `${d.code}@${d.span.line}:${d.span.col}`)).toEqual(["E-CLASS-NOT-IN-SCRML@2:3"]);
  });

  test("no construct in the default tree — nothing reported", () => {
    const ast = astWith(stmt(12, 2, 3, { kind: "ident", name: "x" }));
    const r = forbiddenJsDiagnosticsForDefault("f.scrml", source, ast);
    expect(r.fallbackUsed).toBe(0);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("the native tree decides; the fallback stays quiet when native agrees", () => {
  test("a real class declaration — one diagnostic, at the keyword, no fallback", () => {
    const source = "<program>\n${\n  const K = class { }\n}\n</program>\n";
    const statement = { ...stmt(14, 3, 3, { kind: "escape-hatch", nativeKind: "ClassExpression", raw: "class { }" }),
      span: { file: "f.scrml", start: 14, end: 33, line: 3, col: 3 } };
    const r = forbiddenJsDiagnosticsForDefault("f.scrml", source, astWith(statement));
    expect(r.fallbackUsed).toBe(0);
    expect(r.diagnostics.map((d) => `${d.code}@${d.span.line}:${d.span.col}`)).toEqual(["E-CLASS-NOT-IN-SCRML@3:13"]);
  });
});
