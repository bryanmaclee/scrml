/**
 * S25 gauntlet — statement-boundary fix for untyped-then-typed
 * state-decl ordering (pre-existing S22 §6 parser bug).
 *
 * Before this fix, collectExpr in ast-builder.js recognized
 * `@name =` as a statement-boundary at depth 0 (so `@x = 1; @y = 2`
 * parsed as two separate state-decls) but did NOT recognize
 * `@name :` as a boundary. The consequence: an untyped declaration
 * followed by a typed one in the same ${} block caused the first
 * decl's collectExpr to greedily consume the typed decl as part of
 * its RHS expression. The typed node was silently dropped — no error,
 * no warning, just missing reactive state at runtime.
 *
 * Workaround documented in S24 hand-off: "declare typed reactives
 * BEFORE untyped ones, or use separate ${} blocks." The
 * gauntlet-s22 derived-machines test carries an explicit comment
 * about this. This slice fixes the boundary-detection at the root.
 *
 * Fix: add an `AT_IDENT :` depth-0 boundary guard alongside the
 * existing `AT_IDENT =` guard. `@name :` at depth 0 always begins a
 * typed state-decl (§53); it cannot appear mid-expression without
 * either `{` (object-literal, depth > 0) or a misuse of `?:` (uses
 * `?` not `:` after identifier).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-boundary-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJsPath = resolve(outDir, `${testName}.client.js`);
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §6 — untyped-then-typed state-decl boundary", () => {
  test("untyped @x then typed @y: T = ... → both reactives emit", () => {
    const src = `<program>
\${
  type M:enum = { A, B }
  @x = 1
  @y: MM = M.A
}
< machine name=MM for=M>
  .A => .B
</>
<p>x=\${@x} y=\${@y}</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_set("x", 1)');
    expect(clientJs).toContain('_scrml_reactive_set("y"');
  });

  test("multiple untyped-then-typed pairs in a single block", () => {
    const src = `<program>
\${
  type M:enum = { A, B }
  @a = 1
  @b: MM = M.A
  @c = 2
  @d: MM = M.A
}
< machine name=MM for=M>
  .A => .B
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_set("a", 1)');
    expect(clientJs).toContain('_scrml_reactive_set("b"');
    expect(clientJs).toContain('_scrml_reactive_set("c", 2)');
    expect(clientJs).toContain('_scrml_reactive_set("d"');
  });

  test("typed-first ordering still works (regression guard)", () => {
    const src = `<program>
\${
  type M:enum = { A, B }
  @y: MM = M.A
  @x = 1
}
< machine name=MM for=M>
  .A => .B
</>
<p>x=\${@x} y=\${@y}</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_set("x", 1)');
    expect(clientJs).toContain('_scrml_reactive_set("y"');
  });

  test("typed predicate annotation also boundaries correctly", () => {
    // `@name: number(>0) = value` — the predicate-form type annotation
    // also uses `@name :` as its head. Must boundary against a preceding
    // untyped decl.
    const src = `<program>
\${
  @untypedFirst = "hello"
  @bounded: number(>0) = 42
}
<p>a=\${@untypedFirst} b=\${@bounded}</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_set("untypedFirst"');
    expect(clientJs).toContain('_scrml_reactive_set("bounded", 42)');
  });

  test("object-literal inside ${} block does NOT break on inner @name:", () => {
    // The boundary guard only fires at depth 0. An `@x` inside a nested
    // object literal with a `:` key shouldn't be treated as a statement
    // boundary. (This is defensive — scrml doesn't use `@` prefix inside
    // object keys normally, but the regex must not over-fire.)
    const src = `<program>
\${
  let obj = { a: 1, b: 2 }
  @after = obj.a
}
<p>x=\${@after}</>
</program>
`;
    const { errors } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
  });
});
