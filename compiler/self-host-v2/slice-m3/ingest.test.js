// ingest.test.js — the M3 ingest shim (../ingest.scrml), STRUCTURALLY: impl#1's FileAST for real
// conformance cases → the bootstrap Core, asserted node by node (never against impl#1's output —
// S337). Also: the not-yet discipline (an unmapped shape or key is reported, never guessed) and
// that every ingested Core passes the printer's precondition (check.scrml).
//
//   bun test ./compiler/self-host-v2/slice-m3/

import { describe, test, expect } from "bun:test";
import { ingestFiles, loadM3 } from "./substitute.js";
import { cgArgsOf, caseSource } from "./harness.js";

const { mods } = loadM3();

/** Ingest a conformance case (by dir) or a literal source. */
function ingestSource(src) {
  const { args, errors } = cgArgsOf(src);
  expect(errors).toEqual([]);
  return ingestFiles(args.files);
}
const ingestCase = (rel) => ingestSource(caseSource(rel));

// Core values as impl#1 emits them: payload variant = { variant, data }; nullary = a string; not = null.
const tag = (v) => (typeof v === "string" ? v : v.variant);
const program = (core) => core.decls[0];
const fieldNames = (core) => program(core).fields.map((f) => f.sym.hint);
const fnNamed = (core, name) => core.fns.find((f) => f.sym.hint === name);

function ok(r) {
  expect(r.why).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
}

describe("ingest — five conformance cases, structurally", () => {
  test("reactive/counter-increment: one program declaration, a `let` cell, a write, a handler, a hole", () => {
    const core = ok(ingestCase("reactive/counter-increment"));
    expect(core.decls.length).toBe(1);
    const d = program(core);
    expect(d.sym).toEqual(core.program);
    expect(tag(d.kind)).toBe("Program");
    expect(d.single).toBe(true);
    // `<count> = 0` → a field with the transitional all-grant (§66.12.4): replace, a capability.
    expect(fieldNames(core)).toEqual(["count"]);
    const count = d.fields[0];
    expect(tag(count.mode)).toBe("Let");
    expect(tag(count.ty)).toBe("Int");
    expect(count.grants.replace).toBe(true);
    expect(count.wcap).not.toBeNull();
    // `@count = @count + 1` in a top-level function → Write(.Replace) through the SHARED instance (L1).
    const inc = fnNamed(core, "increment");
    expect(inc.body.stmts.length).toBe(1);
    const w = inc.body.stmts[0];
    expect(w.variant).toBe("Write");
    expect(w.data.cap).toEqual(count.wcap);
    expect(tag(w.data.edit)).toBe("Replace");
    expect(w.data.inst).toEqual({ variant: "Shared", data: { decl: core.program } });
    expect(w.data.value.variant).toBe("Prim");
    expect(tag(w.data.value.data.op)).toBe("Add");
    // The renders: <button onclick=increment()> and <p>Count: ${@count}</p>; the newline texts dropped (L13).
    const [button, p] = d.renders;
    expect(d.renders.length).toBe(2);
    expect(button.data.tag).toBe("button");
    const on = button.data.attrs.find((a) => a.variant === "On");
    expect(on.data.event).toBe("click");
    expect(on.data.body.stmts[0].variant).toBe("Eval");
    expect(on.data.body.stmts[0].data.e.data.callee).toEqual(inc.sym);
    expect(p.data.tag).toBe("p");
    expect(p.data.kids.map(tag)).toEqual(["Text", "Dyn"]);
    // Inside the program's renders its fields are reached through the enclosing instance (L2).
    expect(p.data.kids[1].data.e.data.place.data.inst).toEqual({ variant: "Lexical", data: { depth: 0 } });
  });

  test("derived/chain: `const <x> = e` reading cells → DERIVED fields, no capability", () => {
    const core = ok(ingestCase("derived/chain"));
    const d = program(core);
    expect(fieldNames(core)).toEqual(["base", "doubled", "quad"]);
    expect(d.fields.map((f) => tag(f.mode))).toEqual(["Let", "Derived", "Derived"]);
    expect(d.fields[1].wcap).toBeNull();
    expect(d.fields[2].wcap).toBeNull();
    expect(d.fields[1].grants).toEqual({ replace: false, edits: [] });
    // quad = @doubled * 2 reads field 1 of the program.
    const init = d.fields[2].init;
    expect(tag(init.data.op)).toBe("Mul");
    expect(init.data.args[0].data.place.data.path).toEqual([{ owner: core.program, idx: 1 }]);
  });

  test("reactive/multi-cell-interp: string cells; a text between two holes", () => {
    const core = ok(ingestCase("reactive/multi-cell-interp"));
    const d = program(core);
    expect(d.fields.map((f) => tag(f.ty))).toEqual(["Str", "Str"]);
    const p = d.renders[1];
    expect(p.data.kids.map(tag)).toEqual(["Dyn", "Text", "Dyn"]);
    expect(p.data.kids[1].data.text).toBe(" / ");
    const w = fnNamed(core, "rename").body.stmts[0];
    expect(w.data.value).toEqual({ variant: "Lit", data: { lit: { variant: "Str", data: { v: "Byron" } } } });
  });

  test("reactive/if-top-level-absent: `if=` on an element → a one-arm View.Cond (L5)", () => {
    const core = ok(ingestCase("reactive/if-top-level-absent"));
    const cond = program(core).renders[1];
    expect(cond.variant).toBe("Cond");
    expect(cond.data.arms.length).toBe(1);
    expect(cond.data.arms[0].body[0].data.tag).toBe("p");
    expect(cond.data.arms[0].test.variant).toBe("Read");
    // `@open = !@open` → Not.
    const w = fnNamed(core, "toggle").body.stmts[0];
    expect(tag(w.data.value.data.op)).toBe("Not");
  });

  test("control-flow/s437-r5-braced-else-if-chain-comments-fn: an else-if chain is nested If blocks", () => {
    const core = ok(ingestCase("control-flow/s437-r5-braced-else-if-chain-comments-fn"));
    const f = fnNamed(core, "f");
    expect(f.body.stmts.length).toBe(1);
    const outer = f.body.stmts[0];
    expect(outer.variant).toBe("If");
    const inner = outer.data.elseB.stmts[0];
    expect(inner.variant).toBe("If");
    expect(tag(inner.data.cond.data.op)).toBe("Gt");
    expect(inner.data.elseB.stmts[0].variant).toBe("Write");
  });

  test("reactive/name-collides-state-neg: a local `let` is a Let with its own Sym; read back as Local", () => {
    const core = ok(ingestCase("reactive/name-collides-state-neg"));
    const [letS, w] = fnNamed(core, "example").body.stmts;
    expect(letS.variant).toBe("Let");
    expect(letS.data.sym.hint).toBe("tally");
    // `tally + 5` — the local, then the literal; the Sym is the one the Let bound.
    expect(w.data.value.data.args[0]).toEqual({ variant: "Local", data: { sym: letS.data.sym } });
  });

  test("defer/identifier-untouched: a typed parameter becomes a Param; `+` over strings is Concat", () => {
    const core = ok(ingestCase("defer/identifier-untouched"));
    const f = fnNamed(core, "defer");
    expect(f.params.map((p) => [p.sym.hint, tag(p.ty)])).toEqual([["x", "Str"]]);
    const ret = f.body.stmts[0];
    expect(ret.variant).toBe("Return");
    expect(tag(ret.data.e.data.op)).toBe("Concat");
  });
});

describe("ingest — the not-yet discipline", () => {
  test("a statement kind with no Core mapping is reported, never guessed", () => {
    const r = ingestSource(`\${
    <n> = 0
    function f() {
        for (const i of [1, 2]) { @n = @n + i }
    }
}
<button onclick=f()>go</>
`);
    expect(r.why).toContain("stmt: for-stmt");
  });

  test("an element kind the Core does not model yet (<each>) is reported", () => {
    const r = ingestSource(`\${ <xs> = [1, 2] }
<ul><each in=@xs><li>\${@.}</li></each></ul>
`);
    expect(r.why.some((w) => w.startsWith("markup: each-block") || w.startsWith("expr: array"))).toBe(true);
  });

  test("an unmapped KEY on a mapped node (a debounced cell) is reported, not stripped", () => {
    const r = ingestSource(`\${ <q debounced=300ms> = "" }
<p>\${@q}</p>
`);
    expect(r.why).toContain("cell declaration carries unmapped key `reactivity`");
  });

  test("`<x>: T = v` with a primitive T: the annotation is the field's type (§66.21 row 1)", () => {
    const core = ok(ingestSource(`\${ <n>: number = 0 }
<p>\${@n}</p>
`));
    expect(tag(program(core).fields[0].ty)).toBe("Num");
  });

  test("`<x>: T = v` with a non-primitive T is not-yet (no invented type)", () => {
    const r = ingestSource(`\${ <n>: int | not = not }
<p>\${@n}</p>
`);
    expect(r.why).toContain("decl: a cell annotated with a non-primitive type");
  });

  test("a hoisted list on a mapped node is never a silent 'known' key (review item 4: a component definition)", () => {
    const r = ingestSource(`\${ const Foo = <span>foo</span> }
<p>x</p>
`);
    expect(r.why).toContain("top-level `${}` carries unmapped key `components`");
  });

  test("a `const` whose initializer calls a function is declined, not classified (review item 7, §66.9)", () => {
    const r = ingestSource(`\${
    <n> = 1
    function dbl() { return @n * 2 }
    const <d>: int = dbl()
}
<p>\${@d}</p>
`);
    expect(r.why).toContain("decl: `const` initializer calls a function (derived-ness not provable through the call, §66.9)");
  });

  test("an unannotated parameter is not given an invented type (D14)", () => {
    const r = ingestSource(`\${
    <n> = 0
    function add(k) { @n = @n + k }
}
<button onclick=add(1)>go</>
`);
    expect(r.why).toContain("decl: unannotated parameter (Core parameters are typed, D14)");
  });
});

describe("s446 — impl#1's `when-effect` (§6.7.4)", () => {
  test("a dep naming a `const` cell (derived or locked) or no cell: the shim reports E-LIFECYCLE-007 itself", () => {
    const r = ingestCase("lifecycle/when-dep-derived-error");
    expect(r.codes).toEqual(["E-LIFECYCLE-007"]);
    expect(r.why).toEqual([]);                       // a rejected program needs no body mapping
    const locked = ingestSource(`<program>\n  <p> = 1\n  <log> = 0\n  const <k> = 3\n  when @k changes { @log = 1 }\n  <p>\${@log}</p>\n</program>\n`);
    expect(locked.codes).toEqual(["E-LIFECYCLE-007"]);
  });

  test("a valid dep-list: no code, and the body is NOT-YET — impl#1 carries only its first statement as structure", () => {
    const r = ingestSource(`<program>\n  <a> = 1\n  <b> = 0\n  when @a changes {\n    @b = @b + 1\n    @b = 2\n  }\n  <p>\${@b}</p>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.why.join("\n")).toMatch(/when-effect body: impl#1 carries only its first statement/);
  });

  test("the substitute's runCG rejects a coded program with the code and prints nothing", async () => {
    const { runCG } = await import("./substitute.js");
    const { args } = cgArgsOf(caseSource("lifecycle/when-dep-derived-error"));
    const out = runCG(args);
    expect(out.outputs.size).toBe(0);
    expect(out.errors.map((e) => e.code)).toEqual(["E-LIFECYCLE-007"]);
  });
});

describe("footprint — the Core constructs a program uses (dpa-051 §8.2)", () => {
  test("counter-increment's footprint names exactly the constructs its Core contains", () => {
    const core = ok(ingestCase("reactive/counter-increment"));
    expect([...mods.ingest.footprint(core)].sort()).toEqual([
      "Attr.On", "Attr.Static", "Block", "Decl", "EditKind.Replace", "Expr.Call", "Expr.Lit.Int",
      "Expr.Prim.Add", "Expr.Read", "Field.Let", "Fn", "InstRef.Lexical", "InstRef.Shared", "Place.Cell",
      "Program", "Stmt.Eval", "Stmt.Write", "View.Dyn", "View.El", "View.Text",
    ]);
  });
});
