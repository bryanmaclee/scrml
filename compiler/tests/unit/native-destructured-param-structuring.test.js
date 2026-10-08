// native-destructured-param-structuring.test.js — native translate-bridge fix.
//
// change-id: native-translate-bridge-gaps-2026-06-06 (FIX B)
//
// THE BUG (native-only): the translate bridge's `translateParams` / `paramName`
// (translate-stmt.js) rendered an ObjectPat / ArrayPat function parameter to the
// LOSSY string placeholder `"{...}"` / `"[...]"` on the `params` surface. The
// LIVE param parser (ast-builder.js) emits a STRUCTURED param object
// `{ name: { kind:"destructure-array"|"destructure-object", ... } }`, which the
// type-system scope-binder walks to bind each destructured name into the
// function scope. Against the native string placeholder the destructure path was
// skipped, so body references to the destructured names fired E-SCOPE-001.
//
// THE FIX (translate-stmt.js `translateParam`): for an ObjectPat / ArrayPat (and
// an AssignmentPattern wrapping one), emit the structured `{ name: <pattern> }`.
// Plain-ident params stay STRINGS (type-system.ts handles
// `typeof param === "string"`).
//
// S449 RE-POINT: this file used to compile each source twice (default and the
// retired full-pipeline `--parser=scrml-native` flag) and compare the emitted
// signatures. The bridge is reached in production through `nativeParseFile`
// (component / `^{}` / `<match>` re-parse), so it is now asserted there: the
// native `params` entry for each destructured parameter is structurally equal
// to the default parser's (a fixed-input oracle), and plain params stay strings.

import { describe, test, expect } from "bun:test";
import { nativeAst, liveAst, findNodes, withoutPositions, errorsOf } from "../helpers/native-ast.js";

function fnParams(result) {
  const fn = findNodes(result.ast, (n) => n.kind === "function-decl" && n.name === "f")[0];
  return fn ? withoutPositions(fn.params) : null;
}

const isPattern = (p) => p && typeof p === "object" && p.name && typeof p.name === "object"
  && (p.name.kind === "destructure-object" || p.name.kind === "destructure-array");

describe("native destructured-param structuring (FIX B)", () => {
  const matrix = [
    { name: "object shorthand",   decl: "function f({ a, b }) { return a }",          call: "f({a:1,b:2})" },
    { name: "object rename",      decl: "function f({ a: x, b: y }) { return x }",    call: "f({a:1,b:2})" },
    { name: "array",              decl: "function f([p, q]) { return p }",            call: "f([1,2])" },
    { name: "nested array",       decl: "function f([p, [r, s]]) { return r }",       call: "f([1,[2,3]])" },
    { name: "object rest",        decl: "function f({ a, ...rest }) { return a }",    call: "f({a:1})" },
    { name: "array rest",         decl: "function f([first, ...tail]) { return first }", call: "f([1,2,3])" },
    { name: "mixed bare+pattern", decl: "function f(lead, { mid }, [tail]) { return lead }", call: "f(0,{mid:1},[2])" },
    { name: "fn keyword form",    decl: "fn f({ a, b }) { return a }",                call: "f({a:1,b:2})" },
  ];

  for (const { name, decl, call } of matrix) {
    test(`${name}: destructured params are structured, matching the default parser`, () => {
      const src = [decl, "${", `  <p>\${${call}}</p>`, "}"].join("\n") + "\n";
      const nat = nativeAst(src);
      const live = liveAst(src);
      expect(errorsOf(nat)).toEqual([]);
      const np = fnParams(nat);
      const lp = fnParams(live);
      expect(np).not.toBeNull();
      expect(lp).not.toBeNull();
      expect(np.length).toBe(lp.length);
      expect(np.some(isPattern)).toBe(true);
      for (let i = 0; i < np.length; i++) {
        if (isPattern(lp[i])) {
          // Never the pre-fix lossy placeholder.
          expect(typeof np[i]).toBe("object");
          expect(np[i].name).toEqual(lp[i].name);
        } else {
          // A plain ident: native keeps the string form, the default parser wraps it.
          expect(np[i]).toBe(lp[i].name);
        }
      }
    });
  }

  test("plain-ident params stay plain strings (no structuring regression)", () => {
    const src = ["function f(a, b, c) { return a }", "${", "  <p>${f(1, 2, 3)}</p>", "}"].join("\n") + "\n";
    const nat = nativeAst(src);
    expect(errorsOf(nat)).toEqual([]);
    expect(fnParams(nat)).toEqual(["a", "b", "c"]);
  });
});
