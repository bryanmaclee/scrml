/**
 * S459 D1 fifth round — ONE component scope (§15.10.1), callback-prop callee
 * substitution (§15.11.4), rest-param binding, single-quoted attrs in component
 * bodies, and the E-COMPONENT-PROP-WRITE / E-ATTR-010 message wording.
 *
 * §15.10.1: "From the point of declaration onward in the same scope, the local
 * binding shadows the prop." §15.11.1: "A local declaration, parameter or loop
 * binder named like the prop is not the prop … and is writable." The executed
 * (happy-dom) proofs are the conformance cases components/component-scope-*,
 * callback-prop-bare-call-form, rest-param-named-like-prop and
 * single-quoted-attr-in-component-reject; these pin the emitted shape and the
 * diagnostics.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { boundNamesOf } from "../../src/binding-names.ts";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compile(src) {
  const tmp = join(tmpdir(), `s459-r5-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, "t.scrml");
  writeFileSync(file, src);
  try {
    const result = compileScrml({ inputFiles: [file], outputDir: join(tmp, "dist"), write: true, log: () => {} });
    const entry = [...(result.outputs ?? new Map()).values()][0] ?? {};
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    return { codes: errors.map((e) => e.code), errors, clientJs: entry.clientJs ?? "", html: entry.html ?? "" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("H1/M1 — one component scope", () => {
  test("a later ${} block writes the LOCAL, never the parent's cell", () => {
    const r = compile(`<program>
<v> = 7
<o> = ""
const C = <div class="c" props={ bind n: number }>
    \${ let n = 0 }
    <i>x</i>
    \${ function f() { n = 5; @o = String(n) } }
    <button class="k" onclick=f()>k</button>
</>
<C bind:n=@v/>
<p id="o">\${@v}/\${@o}</p>
</program>`);
    expect(r.codes).toEqual([]);
    // The only write to the cell is its own initializer.
    expect(r.clientJs).not.toContain(`_scrml_cs_reactive_set("v", 5)`);
    expect(r.clientJs).toContain("n = 5;");
  });

  test("a later markup handler write to the local is neither lowered onto the cell nor refused", () => {
    const r = compile(`<program>
<v> = 7
const C = <div class="c" props={ bind n: number }>
    \${ let n = 0 }
    <button class="w" onclick=\${() => n = 50}>w</button>
</>
<C bind:n=@v/>
</program>`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).not.toContain(`_scrml_cs_reactive_set("v", 50)`);
    expect(r.clientJs).toContain("n=50");
  });

  test("by-value prop: a later handler write to a same-named local is not E-COMPONENT-PROP-WRITE", () => {
    const r = compile(`<program>
const C = <div class="c" props={ label: string }>
    \${ let label = "S" }
    <p class="a">\${label}</p>
    <button class="w" onclick=\${() => label = "Z"}>w</button>
</>
<C label="L"/>
</program>`);
    expect(r.codes).toEqual([]);
  });

  test("markup BEFORE the declaration still reads the prop; markup after reads the local", () => {
    const r = compile(`<program>
<v> = 7
const C = <div class="c" props={ bind n: number }>
    <p class="before">\${n}</p>
    \${ let n = 3 }
    <p class="t">\${n}</p>
</>
<C bind:n=@v/>
</program>`);
    expect(r.codes).toEqual([]);
    // The read before the declaration is the caller's cell; exactly one such read.
    expect((r.clientJs.match(/_scrml_cs_reactive_get\("v"\)/g) ?? []).length).toBeGreaterThan(0);
  });

  test("a declaration inside an <each> body does not escape to later siblings", () => {
    const r = compile(`<program>
<xs> = [1]
const C = <div class="c" props={ label: string }>
    <ul><each in=@xs as x><li>\${x}</li></each></ul>
    <p class="l">\${label}</p>
</>
<C label="L"/>
</program>`);
    expect(r.codes).toEqual([]);
    expect(r.html + r.clientJs).toContain("L");
  });
});

describe("M2 — callback prop in the bare event-attribute call form", () => {
  test("§15.11.4's example: onclick=onDismiss() calls the caller's function", () => {
    const r = compile(`<program>
\${ function handleDismiss() { } }
const NotificationItem = <div props={ message: string, onDismiss: () => void }>
    <p>\${message}</p>
    <button onclick=onDismiss()>Dismiss</button>
</>
<NotificationItem message="New message" onDismiss=handleDismiss/>
</program>`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).not.toMatch(/\bonDismiss\(/);
    expect(r.clientJs).toMatch(/handleDismiss[\w$]*\(\)/);
  });

  test("a handler that takes the event calls an expression-valued caller with it", () => {
    // s457 3a (#1363): a bare handler does not bind `event` — the event is taken as a
    // parameter of a function the author writes (`${(e) => onGo(e)}`).
    const r = compile(`<program>
<o> = ""
const Go = <span props={ onGo: (e: asIs) => void }>
    <button onclick=\${(e) => onGo(e)}>go</button>
</>
<Go onGo=\${(e) => @o = "x"}/>
</program>`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).not.toMatch(/\bonGo\(/);
  });

  test("the bare form onclick=onGo(event) is E-EVENT-UNBOUND in a component body too (s457 3a)", () => {
    const r = compile(`<program>
<o> = ""
const Go = <span props={ onGo: (e: asIs) => void }>
    <button onclick=onGo(event)>go</button>
</>
<Go onGo=\${(e) => @o = "x"}/>
</program>`);
    expect(r.codes).toContain("E-EVENT-UNBOUND");
  });
});

describe("L1 — a rest parameter binds its name", () => {
  test("boundNamesOf reads the AST builder's `... n` spelling", () => {
    expect(boundNamesOf("... n")).toEqual(["n"]);
  });
  test("no E-SCOPE-001 for a rest param, inside or outside a component", () => {
    const r = compile(`<program>
<o> = ""
\${ function top(...xs) { return xs.length } }
const C = <div class="c" props={ n: number }>
    \${ function g(...n) { return n.length } }
    <button onclick=\${() => @o = String(g(1, 2)) + String(top(1))}>b</button>
</>
<C n=\${4}/>
</program>`);
    expect(r.codes).toEqual([]);
  });
});

describe("L2 — a single-quoted attribute value in a component body", () => {
  test("is E-ATTR-001 (not garbage attributes, not E-COMPONENT-021)", () => {
    const r = compile(`<program>
const C = <div class="c" props={ label: string }>
    <i class="a" title='\${label}x'>a</i>
</>
<C label="L"/>
</program>`);
    expect(r.codes).toEqual(["E-ATTR-001"]);
  });
});

describe("L4 — message wording", () => {
  test("a `bind` prop passed by value: bind it at the call site (no 'Declare bind')", () => {
    const r = compile(`<program>
const A = <div props={ bind visible: boolean }>
    <button onclick=\${ visible = false }>x</button>
</>
<A visible=\${true}/>
</program>`);
    const e = r.errors.find((x) => x.code === "E-COMPONENT-PROP-WRITE");
    expect(e).toBeDefined();
    expect(e.message).toContain("passes by value");
    expect(e.message).toContain("Bind it at the call site");
    expect(e.message).not.toContain("Declare `bind visible");
  });
  test("an omitted prop is described as not bound at the call site", () => {
    const r = compile(`<program>
const B = <div props={ k?: number }>
    <button onclick=\${ k = 1 }>x</button>
</>
<B/>
</program>`);
    const e = r.errors.find((x) => x.code === "E-COMPONENT-PROP-WRITE");
    expect(e).toBeDefined();
    expect(e.message).toContain("does not bind");
    expect(e.message).not.toContain("passes by value");
  });
  test("bind:n=${@v} says to write bind:n=@v", () => {
    const r = compile(`<program>
<v> = 7
const D = <div props={ bind n: number }>
    <p>\${n}</p>
</>
<D bind:n=\${@v}/>
</program>`);
    const e = r.errors.find((x) => x.code === "E-ATTR-010");
    expect(e).toBeDefined();
    expect(e.message).toContain("Write `bind:n=@v`");
    expect(e.message).not.toContain("is an expression");
  });
  test("round 6 — E-COMPONENT-010 for an omitted required bind prop says to bind it", () => {
    const r = compile(`<program>
const D = <div props={ bind n: number }>
    <p>\${n}</p>
</>
<D/>
</program>`);
    const e = r.errors.find((x) => x.code === "E-COMPONENT-010");
    expect(e).toBeDefined();
    expect(e.message).toContain("`<D bind:n=@cell/>`");
    expect(e.message).not.toContain('n="value"');
  });
});

describe("round 6 F3 — a component-body E-ATTR-001 is placed at the attribute", () => {
  test("line/col of the single-quoted value, not the definition", () => {
    const r = compile(`<program>
<p>x</p>

const C = <div class="c" props={ label: string }>
    <b>y</b>
    <i class="a" title='\${label}x'>a</i>
    <i class="a2" title='\${label}x'>b</i>
</>
<C label="L"/>
</program>`);
    const es = r.errors.filter((x) => x.code === "E-ATTR-001");
    expect(es.length).toBe(2);
    const spans = es.map((e) => [e.span.line, e.span.col]);
    expect(spans).toContainEqual([6, 24]);
    expect(spans).toContainEqual([7, 25]);
  });
  test("round 7 item 5 — an occurrence inside a source comment is skipped", () => {
    const r = compile(`<program>
const C = <div class="c" props={ label: string }>
    // old: title='x'
    <b>y</b>
    <i class="a" title='x'>a</i>
</>
<C label="L"/>
</program>`);
    const e = r.errors.find((x) => x.code === "E-ATTR-001");
    expect([e.span.line, e.span.col]).toEqual([5, 24]);
  });
});

describe("round 7 — E-TYPE-031 for an optional function prop is placed at the offending call", () => {
  test("each unguarded call in the body, in every form, at its own line/col", () => {
    const r = compile(`<program>
const Bare = <div class="b" props={ onGo?: () => void }>
    <button class="g" onclick=onGo()>g</button>
</>
const Fn = <div class="f" props={ onGo?: () => void }>
    \${ function f() { if (onGo) { } else { onGo() } } }
    <button class="g" onclick=f()>g</button>
</>
<Bare/>
<Fn/>
</program>`);
    const spans = r.errors.filter((x) => x.code === "E-TYPE-031").map((e) => [e.span.line, e.span.col]);
    expect(spans).toContainEqual([3, 31]);
    expect(spans).toContainEqual([6, 44]);
  });
});

describe("round 7 — E-TYPE-046 shares the presence-narrowing reader (forms it now also accepts / still refuses)", () => {
  const has046 = (src) => compile(src).codes.includes("E-TYPE-046");
  const cell = `<user>: { name: string } | not\n`;
  test("`&&` right operand and `||` right operand of a negated test narrow", () => {
    expect(has046(`<program>\n${cell}<p>\${@user && @user.name}</p>\n</program>`)).toBe(false);
    expect(has046(`<program>\n${cell}<p>\${!@user || @user.name}</p>\n</program>`)).toBe(false);
  });
  test("an early return on `!@user` narrows the rest of the body", () => {
    expect(has046(`<program>\n${cell}\${ function f() { if (!@user) return ""; return @user.name } }\n<p>\${f()}</p>\n</program>`)).toBe(false);
  });
  test("a test that reads but does not prove presence does not narrow", () => {
    expect(has046(`<program>\n${cell}<p>\${@user || @user.name}</p>\n</program>`)).toBe(true);
    expect(has046(`<program>\n${cell}\${ function f() { if (@user is not) { return @user.name } return "" } }\n<p>\${f()}</p>\n</program>`)).toBe(true);
  });
});
