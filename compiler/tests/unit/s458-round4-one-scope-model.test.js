/**
 * S458 D1 fourth round — ONE binding / scope model for component prop substitution.
 *
 * The structured logic-body walker (component-expander `substitutePropsInLogicStmt`) and
 * the JS-text substituter (`substitutePropsInJsSource`) both answer "which names does this
 * binding position bind?" with `boundNamesOf` (binding-names.ts) and apply the same scope
 * rules (its header: a declaration shadows from its point of declaration onward; params
 * shadow in the body; loop binders — the keywordless `for (x of …)` included — shadow in
 * the loop; destructuring defaults read the enclosing scope).
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { boundNamesOf } from "../../src/binding-names.ts";
import { substitutePropsInJsSource, bindingNamesOfForHeader } from "../../src/component-prop-js-substitute.ts";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compile(src) {
  const tmp = join(tmpdir(), `s458-r4-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, "t.scrml");
  writeFileSync(file, src);
  try {
    const result = compileScrml({ inputFiles: [file], outputDir: join(tmp, "dist"), write: true, log: () => {} });
    const entry = [...(result.outputs ?? new Map()).values()][0] ?? {};
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    return { codes: errors.map((e) => e.code), errors, clientJs: entry.clientJs ?? "" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("boundNamesOf — every binding-position shape", () => {
  test("identifier, parameter text, typed / defaulted / rest / lin parameter text", () => {
    expect(boundNamesOf("n")).toEqual(["n"]);
    expect(boundNamesOf("n: number = 2")).toEqual(["n"]);
    expect(boundNamesOf("...rest")).toEqual(["rest"]);
    expect(boundNamesOf("{ a, b: c, d = 1, ...e }")).toEqual(["a", "c", "d", "e"]);
    expect(boundNamesOf("[x, [y, { z }], ...w]")).toEqual(["x", "y", "z", "w"]);
  });
  test("scrml DestructurePattern (nested / renamed / rest) and parameter entries", () => {
    const pat = {
      kind: "destructure-object",
      properties: [
        { kind: "name", fieldName: "a", bindName: "ren" },
        { kind: "nested", fieldName: "b", pattern: { kind: "destructure-array", elements: [{ kind: "name", name: "n" }, { kind: "hole" }], rest: "r" } },
      ],
      rest: "others",
    };
    expect(boundNamesOf(pat)).toEqual(["ren", "n", "r", "others"]);
    expect(boundNamesOf([{ name: "a", typeAnnotation: "number" }, { name: pat }, "k"])).toEqual(["a", "ren", "n", "r", "others", "k"]);
    expect(boundNamesOf({ name: "__destructured__", boundNames: ["p", "q"] })).toEqual(["p", "q"]);
  });
  test("for headers: declared, destructured and KEYWORDLESS binders; a member head binds nothing", () => {
    expect(bindingNamesOfForHeader("(let i = 0; i < 3; i++)")).toEqual(["i"]);
    expect(bindingNamesOfForHeader("(const [k, n] of xs)")).toEqual(["k", "n"]);
    expect(bindingNamesOfForHeader("(n of xs)")).toEqual(["n"]);
    expect(bindingNamesOfForHeader("(o.k of xs)")).toEqual([]);
  });
});

describe("JS-text path follows the same scope rules", () => {
  const writes = [];
  const sub = (src, P = { n: "@v", label: '"L"' }) => substitutePropsInJsSource(src, false, new Set(), {
    replacementFor: (x) => (x in P ? P[x] : null),
    onWrite: (x) => writes.push(x),
  });
  test("a declaration shadows from its point onward (its own initializer reads the prop)", () => {
    expect(sub("x => { const a = n; let n = n + 1; return n }")).toBe("x => { const a = @v; let n = @v + 1; return n }");
  });
  test("destructured declarations / params / loop binders shadow; the default reads the enclosing scope", () => {
    expect(sub("x => { let { n } = { n: 1 }; n = 100; return n }")).toBe("x => { let { n } = { n: 1 }; n = 100; return n }");
    expect(sub("x => { let [n] = [1]; n++; return n }")).toBe("x => { let [n] = [1]; n++; return n }");
    expect(sub("x => { for (let [k, n] of [[1, 2]]) { n = 77 } }")).toBe("x => { for (let [k, n] of [[1, 2]]) { n = 77 } }");
    expect(sub("({ n } = { n: label }) => n")).toBe('({ n } = { n: "L" }) => n');
    expect(sub("x => { const { a = n } = {}; return a }")).toBe("x => { const { a = @v } = {}; return a }");
  });
  test("a keywordless `for (n of xs)` is a binder, a member head is a write target", () => {
    writes.length = 0;
    expect(sub("x => { for (n of xs) { n } return n }")).toBe("x => { for (n of xs) { n } return @v }");
    expect(writes).toEqual([]);
  });
});

describe("structured path — destructured bindings never reach the bind channel (F5) nor read the prop (F3)", () => {
  test("bind prop: destructured local / param / loop binder writes are local", () => {
    const r = compile(`<program>
<v> = 7
const C = <div props={ bind n: number }>
    \${
      function b1() { let { n } = { n: 1 }; n = 100; return n }
      function b2() { let [n] = [1]; n++; return n }
      function f({ n }) { n = 50; return n }
      function b4() { for (let [k, n] of [[1, 2]]) { n = 77 } }
    }
    <button onclick=b1()>x</button>
</>
<C bind:n=@v/>
</program>`);
    expect(r.codes).toEqual([]);
    // the only write to @v is its own initialization
    expect(r.clientJs.match(/_scrml_cs_reactive_set\("v"/g)?.length).toBe(1);
  });
  test("by-value prop: a destructured parameter write is legal (no E-COMPONENT-PROP-WRITE); a prop read outside still substitutes", () => {
    const r = compile(`<program>
<v> = 7
<o> = 0
const C = <div props={ n: number }>
    \${
      function f9({ n }) { n = n + 1; return n }
      function run() { @o = f9({ n: 1 }) + n }
    }
    <button onclick=run()>x</button>
</>
<C n=@v/>
</program>`);
    expect(r.codes).toEqual([]);
    // the only write to @v is its own initialization
    expect(r.clientJs.match(/_scrml_cs_reactive_set\("v"/g)?.length).toBe(1);
  });
});

describe("markup binders and lift targets share the statement scope (F7, F9)", () => {
  test("`<each … as label>` is a declaration: never rewritten, shadows the prop in the body", () => {
    const r = compile(`<program>
<xs> = ["a"]
const C = <div props={ label: string, items: string[] }>
    <ul><each in=items as label><li>\${label}</li></each></ul>
    <p>\${label}</p>
</>
<C label="Lbl" items=@xs/>
</program>`);
    expect(r.codes).toEqual([]);
    // the prop value appears once (the <p> outside the each), never as the binder
    expect((r.clientJs.match(/Lbl/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(r.clientJs).not.toMatch(/\("Lbl"\s*,/);
  });
  test("a prop in a lifted markup target is substituted (bare / for); a loop binder shadows it", () => {
    const r = compile(`<program>
const C = <div props={ label: string }>
    <ul>\${ lift <li>\${label}</li> }</ul>
    <ul>\${ for (x of [1]) { lift <li>\${label}\${x}</li> } }</ul>
    <ul>\${ for (label of ["s"]) { lift <li>\${label}</li> } }</ul>
</>
<C label="Lbl"/>
</program>`);
    expect(r.codes).toEqual([]);
    expect((r.clientJs.match(/Lbl/g) ?? []).length).toBe(2);
  });
});

describe("F1 — scrml operators in unstructured text parse with the expression parser's own front", () => {
  const P = { label: '"L"', n: "@v" };
  const sub = (src, asProgram = false) => substitutePropsInJsSource(src, asProgram, new Set(), {
    replacementFor: (x) => (x in P ? P[x] : null),
    onWrite: () => {},
  });
  test("`is some` / `is not` / `is not not` / `.Variant` / `::` — substituted, never refused; an `is` operand is grouped", () => {
    expect(sub("x => { return label is some }")).toBe('x => { return ("L") is some }');
    expect(sub("x => { if (n is .Active) { return Status::Done } return not }")).toBe("x => { if (@v is .Active) { return Status::Done } return not }");
    expect(sub("x => { return n == .Active && label is not not }")).toBe('x => { return @v == .Active && ("L") is not not }');
  });
  test("a statement body (a `when` / handler body) with scrml operators; locals still shadow", () => {
    expect(sub("if (label is not) { @x = 1 } else { const label = 2; @y = label }", true))
      .toBe('if (("L") is not) { @x = 1 } else { const label = 2; @y = label }');
  });
  test("text that does not parse is still null (refused by the caller), never text-rewritten", () => {
    expect(sub("x => { return label is }")).toBe(null);
  });
  test("a parenthesized string literal operand of `is` lowers in the raw rewrite (it spans three code segments)", async () => {
    const { rewriteExprArrowBody } = await import("../../src/codegen/rewrite.ts");
    expect(rewriteExprArrowBody('x => { return ("L") is some }')).toBe('x => { return ("L" !== null && "L" !== undefined) }');
    expect(rewriteExprArrowBody('x => { return "(\\"a\\") is some" }')).toBe('x => { return "(\\"a\\") is some" }');
  });
});

describe("N1 — a component bind target that is not a cell is refused ONCE", () => {
  test.each([["bind:n=v"], ['bind:n="s"'], ["bind:n=@v.k"], ["bind:n=${@v + 1}"]])("%s → exactly one diagnostic, E-ATTR-010", (attr) => {
    const r = compile(`<program>
<v> = 1
const C = <div props={ bind n: number }>\${n}</>
<C ${attr}/>
</program>`);
    expect(r.codes).toEqual(["E-ATTR-010"]);
  });
  test("the bare-identifier message names the §15.11.1 form and never offers a state path", () => {
    const r = compile(`<program>
<v> = 1
const C = <div props={ bind n: number }>\${n}</>
<C bind:n=v/>
</program>`);
    const msg = r.errors.map((e) => e.message).join("\n");
    expect(msg).toContain("bind:n=@cell");
    expect(msg).not.toContain("state field path");
  });
});
