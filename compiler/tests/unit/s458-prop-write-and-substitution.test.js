/**
 * S458 D1 fix round (F1–F5) — component prop substitution is structural, and only a
 * `bind:`-bound prop may be written.
 *
 *   F1 precedence / one simultaneous pass / string-literal content (substituteExprText)
 *   F2 a body write to a by-value prop is refused (E-ASSIGN-004 — routed for a ruling),
 *      never lowered onto the caller's cell; `bind:value=value` forwards only a bound prop
 *   F3 `bind:prop=@derived` is E-DERIVED-WRITE at the bind site
 *   F5 a write to an unbound bindable prop with a default is refused; `bind:n=@v.k` is E-ATTR-010
 *   emitStringFromTree keeps a unary operator's compound operand grouped
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode, emitStringFromTree } from "../../src/expression-parser.ts";
import { substitutePropsInJsSource } from "../../src/component-prop-js-substitute.ts";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// A compile with an error writes NO artifact (SPEC §2.2.1, S457), so a refused write
// can never ship as a write to the caller's cell or to an undeclared global; the
// refusal tests below therefore assert the diagnostic AND that nothing is written.
function compile(src) {
  const tmp = join(tmpdir(), `s458-propsub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, "t.scrml");
  writeFileSync(file, src);
  try {
    const dist = join(tmp, "dist");
    const result = compileScrml({ inputFiles: [file], outputDir: dist, write: true, log: () => {} });
    const entry = [...(result.outputs ?? new Map()).values()][0] ?? {};
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const wrote = existsSync(join(dist, "t.client.js"));
    return { codes: errors.map((e) => e.code), clientJs: entry.clientJs ?? "", wrote };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("F1 — structural substitution", () => {
  test("precedence: `n * 2` with `n=${@a + 1}` lowers to `(@a + 1) * 2`, unquoted and quoted", () => {
    const { codes, clientJs } = compile(`<program>
<a> = 3
const Q = <span title=\${n * 2} props={ n: number }>q</span>
const Q2 = <span class="q2" title="v=\${n*2}" props={ n: number }>q</span>
<Q n=\${@a + 1}/>
<Q2 n=\${@a + 1}/>
</program>`);
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`(_scrml_cs_reactive_get("a") + 1) * 2`);
    expect(clientJs).not.toContain(`_scrml_cs_reactive_get("a") + 1 * 2`);
  });

  test("one pass: a caller expression is never re-scanned; literals inside it stay", () => {
    const { codes, clientJs } = compile(`<program>
<y> = "Y"
<rows> = ["r1"]
const L = <a href=\${href} props={ href: string, label: string }>\${label}</a>
const L2 = <a class="l2" href="/q/\${href}" props={ href: string, label: string }>\${label}</a>
<ul><each in=@rows as label><li><L href=\${"/x/" + label} label=\${@y}/><L2 href=\${"/z/" + "label"} label=\${@y}/></li></each></ul>
</program>`);
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`"/x/" + label`);
    expect(clientJs).toContain('`/q/${"/z/" + "label"}`');
  });

  test("string-literal content inside an attribute expression is never rewritten", () => {
    const { codes, clientJs } = compile(`<program>
<y> = "Y"
const T = <span title="\${label + ' label'}" props={ label: string }>t</span>
const V = <span class="v" title="\${visible ? 'visible' : 'hidden'}" props={ visible: boolean }>v</span>
<T label=\${@y}/>
<V visible=\${true}/>
</program>`);
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`_scrml_cs_reactive_get("y") + ' label'`);
    expect(clientJs).toContain(`true ? 'visible' : 'hidden'`);
  });
});

describe("F2 — only a `bind:`-bound prop is writable", () => {
  for (const [label, call] of [["${expr} caller", "<C n=${@v}/>"], ["@cell caller", "<C n=@v/>"]]) {
    test(`a body write to a by-value prop (${label}) is E-ASSIGN-004, and @v is never written`, () => {
      const { codes, wrote } = compile(`<program>
<v> = 1
const C = <div props={ n: number }><button onclick=\${ n = n + 1 }>+</button></div>
${call}
</program>`);
      expect(codes).toContain("E-ASSIGN-004");
      expect(wrote).toBe(false);
    });
  }

  test("a compound / ++ write to a by-value prop is refused too", () => {
    const { codes } = compile(`<program>
<v> = 1
const C = <div props={ n: number }><button onclick=\${ n++ }>a</button><button onclick=\${ n += 2 }>b</button></div>
<C n=@v/>
</program>`);
    expect(codes).toContain("E-ASSIGN-004");
  });

  test("`<input bind:value=value>` with a PLAIN caller `value=@text` is a write to a by-value prop", () => {
    const { codes, wrote } = compile(`<program>
<text> = ""
const TF = <input type="text" bind:value=value props={ value: string }/>
<TF value=@text/>
</program>`);
    expect(codes).toContain("E-ASSIGN-004");
    expect(wrote).toBe(false);
  });

  test("a READ of a by-value prop is untouched (no diagnostic)", () => {
    const { codes } = compile(`<program>
<v> = 1
const C = <div props={ n: number }><span>\${n + 1}</span></div>
<C n=@v/>
</program>`);
    expect(codes).toEqual([]);
  });

  test("a local that shadows the prop may be written", () => {
    const { codes } = compile(`<program>
<v> = 1
const C = <div props={ n: number }><button onclick=\${ (n) => { n = 2 } }>x</button></div>
<C n=@v/>
</program>`);
    expect(codes).not.toContain("E-ASSIGN-004");
  });
});

describe("F3 / F5 — bind-site refusals", () => {
  test("`bind:n=@d` of a derived cell is E-DERIVED-WRITE at the bind site", () => {
    const { codes } = compile(`<program>
<v> = 1
const <d> = @v * 2
const C = <div props={ bind n: number }><span>\${n}</span></div>
<C bind:n=@d/>
</program>`);
    expect(codes).toContain("E-DERIVED-WRITE");
  });

  test("`bind:n=@v.k` is E-ATTR-010 (§15.11.1 grammar: '@' identifier)", () => {
    const { codes } = compile(`<program>
<v> = { k: 1 }
const C = <div props={ bind n: number }><span>\${n}</span></div>
<C bind:n=@v.k/>
</program>`);
    expect(codes).toContain("E-ATTR-010");
  });

  test("a body write to an UNBOUND bindable prop with a default is E-ASSIGN-004, not `5 = …`", () => {
    const { codes, wrote } = compile(`<program>
const D = <div props={ bind n: number = 5 }><button onclick=\${ n = n + 1 }>+</button></div>
<D/>
</program>`);
    expect(codes).toContain("E-ASSIGN-004");
    expect(wrote).toBe(false);
  });
});

describe("emitStringFromTree — a unary operator keeps its compound operand grouped", () => {
  test("`not (x is not)` round-trips with its parentheses", () => {
    const out = emitStringFromTree(parseExprToNode("not (x is not)", "t", 0));
    expect(out).toBe("!(x is not)");
    expect(emitStringFromTree(parseExprToNode(out, "t", 0))).toBe(out);
  });
});

describe("third round — substitution in unstructured JS text is scope-aware (substitutePropsInJsSource)", () => {
  const hooks = (props, writes = []) => ({
    replacementFor: (n) => (n in props ? props[n] : null),
    onWrite: (n) => writes.push(n),
  });
  const sub = (src, props, writes) => substitutePropsInJsSource(src, false, new Set(), hooks(props, writes));
  const P = { label: '"L"', n: "@v" };

  test("object KEYS, member names, regex / string / comment content are never references", () => {
    expect(sub("x => { const o = { label: 2 }; return o.label }", P)).toBe("x => { const o = { label: 2 }; return o.label }");
    expect(sub("x => { /* label */ return /label/.test('label') }", P)).toBe("x => { /* label */ return /label/.test('label') }");
    expect(sub("it => { return { label: it.name, id: it.id } }", P)).toBe("it => { return { label: it.name, id: it.id } }");
  });

  test("a shorthand `{ label }` is a READ: the key is kept, the value substituted", () => {
    expect(sub("x => { return { label } }", P)).toBe('x => { return { label: "L" } }');
  });

  test("locals, nested params (plain / arrow / destructured), catch and loop binders shadow the prop", () => {
    const w = [];
    expect(sub("x => { let label = 10; label = label + 1; return label }", P, w)).toBe("x => { let label = 10; label = label + 1; return label }");
    expect(sub("x => { function g(label) { return label } const h = (label) => label; const d = ({ label }) => label; return g(1) }", P, w))
      .toBe("x => { function g(label) { return label } const h = (label) => label; const d = ({ label }) => label; return g(1) }");
    expect(sub("x => { for (let n = 0; n < 3; n++) {} for (const n of [1]) { n } }", P, w)).toBe("x => { for (let n = 0; n < 3; n++) {} for (const n of [1]) { n } }");
    expect(w).toEqual([]);
  });

  test("a READ outside every shadow is substituted; a WRITE is reported", () => {
    const w = [];
    expect(sub("x => { n = n + label; n++ }", P, w)).toBe('x => { @v = @v + "L"; @v++ }');
    expect(w).toEqual(["n", "n"]);
  });

  test("text that does not parse is returned as null (never text-rewritten)", () => {
    expect(sub("x => { label +", P)).toBe(null);
  });
});

describe("third round — refusals instead of text rewrites", () => {
  test("`bind:n=${@w + 1}` names the bad right-hand side (E-ATTR-010)", () => {
    const { codes } = compile(`<program>
<w> = 1
const C = <div props={ bind n: number }><span>\${n}</span></div>
<C bind:n=\${@w + 1}/>
</program>`);
    expect(codes).toContain("E-ATTR-010");
  });

  test("a C-style `for (let n …)` in a body function is never a write to the prop, nor a write to the caller's cell", () => {
    const { codes, clientJs } = compile(`<program>
<v> = 1
<out> = 0
const C = <div props={ n: number }>
  \${ function run() { let t = 0
    for (let n = 0; n < 3; n++) { t = t + n }
    @out = t } }
  <button onclick=run()>r</button>
</div>
<C n=@v/>
</program>`);
    expect(codes).not.toContain("E-ASSIGN-004");
    // Pre-existing (main too): a declaration-form C-style init is dropped by the component
    // re-parse, so the loop variable is unresolved — loud, never the caller's cell.
    // only the cell's own initialisation writes @v
    expect(clientJs.split('_reactive_set("v"').length - 1).toBe(1);
  });
});
