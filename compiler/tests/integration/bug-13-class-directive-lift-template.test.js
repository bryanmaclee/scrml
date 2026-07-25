/**
 * Bug 13 regression — `class:NAME=...` directive inside `lift` templates
 * was emitted as a literal HTML attribute (`setAttribute("class:NAME", ...)`)
 * instead of the §5.5.2 reactive `classList.toggle` effect.
 *
 * Pre-fix: all four §5.5.2 grammar arms (`@var`, `obj.path`, `(expr)`, `fn()`)
 * inside a `lift` template fell through to the generic setAttribute branch.
 *
 * Post-fix: emit `_scrml_effect(() => elVar.classList.toggle("NAME", !!(expr)))`
 * directly on the lift factory's element variable (no marker attribute needed
 * because the factory closure already holds the element reference).
 *
 * Top-level (non-lift) emission is unchanged — still uses the
 * `data-scrml-class-NAME` marker + querySelector pattern in emit-bindings.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "bug-13-class-lift-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  let clientJs = "";
  try {
    clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, `${name}.client.js`), "utf8")));
  } catch {
    // file missing — leave clientJs empty so assertions surface a clear failure
  }
  return { errors, clientJs };
}

describe("Bug 13: class:NAME directive inside lift template", () => {
  test("Form 1 (@var) — emits classList.toggle, NOT setAttribute('class:NAME', ...)", () => {
    const src = `<program title="form1">
    <items>: number[] = [1, 2, 3]
    <isActive>: boolean = false
    <ul>\${
        for (let item of @items) {
            lift <li class:active=@isActive>Item \${item}</li>
        }
    }</ul>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("form1-varref", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
    expect(clientJs).toMatch(/classList\.toggle\("active",\s*!!\(_scrml_reactive_get\("isActive"\)\)/);
  });

  test("Form 2 (obj.path) — emits classList.toggle reading closure-captured iterable", () => {
    const src = `<program title="form2">
    <items>: { id: number, done: boolean }[] = [{ id: 1, done: false }]
    <ul>\${
        for (let item of @items) {
            lift <li class:done=item.done>Item \${item.id}</li>
        }
    }</ul>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("form2-objpath", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
    expect(clientJs).toMatch(/classList\.toggle\("done",\s*!!\(item\.done\)/);
  });

  test("Form 3 (parens expr) — emits classList.toggle with reactive subscription on @var", () => {
    const src = `<program title="form3">
    <items>: number[] = [1, 2, 3]
    <selected>: number = 1
    <ul>\${
        for (let item of @items) {
            lift <li class:active=(item == @selected)>Item \${item}</li>
        }
    }</ul>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("form3-parens", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
    expect(clientJs).toMatch(/classList\.toggle\("active"/);
    expect(clientJs).toMatch(/_scrml_reactive_get\("selected"\)/);
  });

  test("Form 4 (call-ref) — emits classList.toggle invoking the function", () => {
    const src = `<program title="form4">
    <items>: number[] = [1, 2, 3]
    <ul>\${
        for (let item of @items) {
            lift <li class:pulse=isPulsing()>Item \${item}</li>
        }
    }</ul>
    fn isPulsing() -> boolean { return true }
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("form4-callref", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
    expect(clientJs).toMatch(/classList\.toggle\("pulse",\s*!!\(_scrml_isPulsing_\d+\(\)\)/);
  });

  test("Static class= coexists with class:NAME= in lift template", () => {
    const src = `<program title="coexist">
    <items>: number[] = [1, 2, 3]
    <active>: boolean = false
    <ul>\${
        for (let item of @items) {
            lift <li class="task" class:active=@active>Item \${item}</li>
        }
    }</ul>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("coexist", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Static class= still uses setAttribute (correct)
    expect(clientJs).toMatch(/setAttribute\("class",\s*"task"\)/);
    // Conditional class: is a classList.toggle effect
    expect(clientJs).toMatch(/classList\.toggle\("active"/);
    // No literal class:* attribute anywhere
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
  });
});

describe("Bug 13: top-level (non-lift) class:NAME emission still uses marker pattern", () => {
  test("Top-level @var form still emits data-scrml-class-* marker + querySelector wiring", () => {
    const src = `<program title="toplevel">
    <isActive>: boolean = false
    <button class:active=@isActive>Toggle</button>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("toplevel-varref", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Top-level wiring uses the marker attribute + querySelector lookup
    expect(clientJs).toMatch(/document\.querySelector\('\[data-scrml-class-active=/);
    expect(clientJs).toMatch(/classList\.toggle\("active"/);
    // And no literal class:* setAttribute anywhere
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
  });

  test("Top-level parens form still emits reactive effect (regression guard for the working path)", () => {
    const src = `<program title="toplevel-parens">
    <count>: number = 0
    <button class:hot=(@count > 5)>Toggle</button>
</program>
`;
    const { errors, clientJs: __cjRaw } = compileSource("toplevel-parens", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/document\.querySelector\('\[data-scrml-class-hot=/);
    expect(clientJs).toMatch(/_scrml_reactive_get\("count"\)/);
    expect(clientJs).not.toMatch(/setAttribute\(\s*"class:/);
  });
});
