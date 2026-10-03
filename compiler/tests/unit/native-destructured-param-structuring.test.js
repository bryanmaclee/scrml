// native-destructured-param-structuring.test.js — native-parser-swap parity-closer.
//
// change-id: native-translate-bridge-gaps-2026-06-06 (FIX B)
//
// THE BUG (native-only): the translate bridge's `translateParams` / `paramName`
// (translate-stmt.js) rendered an ObjectPat / ArrayPat function parameter to the
// LOSSY string placeholder `"{...}"` / `"[...]"` on the `params` surface. The
// LIVE param parser (ast-builder.js:7783) emits a STRUCTURED param object
// `{ name: { kind:"destructure-array"|"destructure-object", ... } }`, which the
// type-system scope-binder (type-system.ts:5945, gated on
// `isDestructurePattern`) walks to bind each destructured name into the function
// scope. Against the native string placeholder the destructure path was skipped,
// so body references to the destructured names fired E-SCOPE-001.
//
// THE FIX (translate-stmt.js `translateParam`): for an ObjectPat / ArrayPat (and
// an AssignmentPattern wrapping one), emit the structured `{ name: <pattern> }`
// via the already-present `translateObjectPattern` / `translateArrayPattern`
// translators. Plain-ident params stay STRINGS (type-system.ts:5953 handles
// `typeof param === "string"`). NO type-system change — its binders already read
// the right fields once native emits the right shape.
//
// VERIFIED HERE: native compiles the destructure-param composition matrix with
// ZERO E-SCOPE-001, and the generated function signatures byte-match the default
// (LIVE) emit.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-dps-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function scopeErrors(errors) {
  return errors.filter((e) => String(e.code ?? "") === "E-SCOPE-001");
}

// The function-signature line for `_scrml_<fn>_<id>(...)`.
function sigLine(clientJs, fnName) {
  const re = new RegExp(`function _scrml_${fnName}_\\d+\\([^)]*\\)`);
  const m = clientJs.match(re);
  return m ? m[0].replace(/_\d+\(/, "_N(") : null;
}

describe("native destructured-param structuring (FIX B)", () => {
  // Each row: a fn with a destructured param + a body ref to a destructured
  // name. Pre-fix the body ref fired E-SCOPE-001 under native; post-fix it
  // resolves and the signature byte-matches LIVE.
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
    test(`${name}: no E-SCOPE-001 + signature byte-matches default`, () => {
      const src = [
        decl,
        "${",
        `  <p>\${${call}}</p>`,
        "}",
      ].join("\n") + "\n";

      const live = compileWith(src, null, "live");
      const native = compileWith(src, "scrml-native", "native");

      expect(scopeErrors(native.errors)).toHaveLength(0);
      expect(scopeErrors(live.errors)).toHaveLength(0);

      const liveSig = sigLine(live.clientJs, "f");
      const nativeSig = sigLine(native.clientJs, "f");
      expect(liveSig).not.toBeNull();
      expect(nativeSig).not.toBeNull();
      expect(nativeSig).toBe(liveSig);
    });
  }

  test("plain-ident params stay plain (no structuring regression)", () => {
    const src = [
      "function f(a, b, c) { return a }",
      "${",
      "  <p>${f(1, 2, 3)}</p>",
      "}",
    ].join("\n") + "\n";
    const native = compileWith(src, "scrml-native", "plain");
    expect(scopeErrors(native.errors)).toHaveLength(0);
    expect(native.clientJs).toMatch(/function _scrml_f_\d+\(a, b, c\)/);
  });
});
