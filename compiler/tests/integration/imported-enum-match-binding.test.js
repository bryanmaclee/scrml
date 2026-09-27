/**
 * g-impl1-match-miscompiles-hit-by-the-bootstrap — F11 / F15 / F16 / F17.
 *
 * Every case here COMPILES CLEAN and then runs wrong (or throws) on the pre-fix
 * compiler, so each test compiles a multi-file program, evaluates the emitted
 * client chunks in dependency order (the same `_scrml_modules` registry the
 * browser uses), and asserts on the VALUE a function returns — not on emitted text.
 *
 * SPEC §18.7 (Payload Destructuring): "Positional form: Bindings are assigned
 * left-to-right in the order the fields were declared in the enum definition."
 * "Named form: Bindings are assigned by field name." Nothing in §18.7 restricts
 * either form to an enum declared in the same file.
 *
 *   F11 — positional binding over an IMPORTED enum was dropped (the per-file
 *         variant registry held only the current file's enums) → ReferenceError.
 *         Also: a variant name shared by two enums (a local one + an aliased
 *         import, or two imports) bound against the WRONG enum's field order.
 *   F16 — tag-only arms over an imported PAYLOAD enum compared the tagged
 *         object to a string → no arm matched, the match returned undefined.
 *   F17 — a block-form arm (`.V(f: x) :> { k: x }`) lost its NAMED binding
 *         (rebuilt from the local names only → positional), and the
 *         object-literal body's KEYS were scope-checked as references
 *         (a false E-SCOPE-001, and the VALUES went unchecked).
 *   F15 — a payload field named like a same-file function was renamed by the
 *         fn-name mangler inside the constructor → `.field` read undefined.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "imported-enum-match-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function listClientJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listClientJs(p, out);
    else if (e.name.endsWith(".client.js")) out.push(p);
  }
  return out;
}

/** Compile `files` (name → source; the first is the `<program>` entry) and load every chunk. */
function build(name, files) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const inputFiles = [];
  for (const [f, src] of Object.entries(files)) {
    writeFileSync(join(dir, f), src);
    inputFiles.push(join(dir, f));
  }
  const outDir = join(dir, "out");
  const result = compileScrml({ inputFiles, outputDir: outDir, write: true, validateEmit: true, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e && e.code !== undefined);
  const chunks = listClientJs(outDir).map((file) => {
    const src = readFileSync(file, "utf8");
    const reg = /_scrml_modules\["([^"]+)"\]\s*=/.exec(src);
    const deps = [...src.matchAll(/=\s*_scrml_modules\["([^"]+)"\];/g)].map((m) => m[1]);
    return { src, name: reg ? reg[1] : null, deps };
  });
  const registry = {};
  const pending = chunks.filter((c) => c.name !== null);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  while (pending.length > 0) {
    const i = pending.findIndex((c) => c.deps.every((d) => d in registry));
    if (i === -1) throw new Error("unresolvable chunk deps: " + pending.map((c) => c.name).join(", "));
    const [c] = pending.splice(i, 1);
    new Function("_scrml_modules", "_scrml_structural_eq", c.src)(registry, eq);
  }
  const mods = {};
  for (const [k, v] of Object.entries(registry)) mods[k.replace(/\.client\.js$/, "").replace(/^.*\//, "")] = v;
  return { errors, mods };
}

const ENTRY = (importLine) => `<program>\n    ${importLine}\n    fn probe() -> string { return "p" }\n</program>\n`;

const CORE = `\${
    export type Expr:enum = { Lit(n: int), Add(a: int, b: int), Nil }
    export type Wide:enum = {
        W1(a: int),
        W2(a: int, b: int),
        W3(a: int, b: int, c: int),
        W4(a: int, b: int, c: int, d: int),
        W5(a: int, b: int, c: int, d: int, e: int),
        W6(a: int, b: int, c: int, d: int, e: int, f: int)
    }
    export type Attr:enum = { Static(name: string), Bound(name: string, v: int), On(ev: string) }
    export type Pair:enum = { P(first: int, second: int), Q }
}
`;

describe("F11 — positional payload binding over an IMPORTED enum", () => {
  let mods, errors;
  beforeAll(() => {
    ({ mods, errors } = build("f11", {
      "bundle.scrml": ENTRY(`import { pos } from "./use.scrml"`),
      "core.scrml": CORE,
      "use.scrml": `import { Expr, Wide } from "./core.scrml"
\${
    export fn pos(e: Expr) -> string {
        return match e {
            .Lit(n) :> "lit" + n
            .Add(a, b) :> "add" + (a + b)
            .Nil :> "nil"
        }
    }
    export fn wide(w: Wide) -> string {
        return match w {
            .W1(a) :> "" + a
            .W2(a, b) :> "" + a + b
            .W3(a, b, c) :> "" + a + b + c
            .W4(a, b, c, d) :> "" + a + b + c + d
            .W5(a, b, c, d, e) :> "" + a + b + c + d + e
            .W6(a, b, c, d, e, f) :> "" + a + b + c + d + e + f
        }
    }
    export fn built() -> string {
        const e: Expr = .Add(4, 5)
        return pos(e)
    }
}
`,
    }));
  });
  test("compiles clean", () => { expect(errors).toEqual([]); });
  test("one- and two-field positional binds", () => {
    expect(mods.use.pos(mods.core.Expr.Lit(5))).toBe("lit5");
    expect(mods.use.pos(mods.core.Expr.Add(2, 3))).toBe("add5");
    expect(mods.use.pos(mods.core.Expr.Nil)).toBe("nil");
  });
  test("payloads of 1..6 fields bind in declaration order", () => {
    const W = mods.core.Wide;
    expect(mods.use.wide(W.W1(1))).toBe("1");
    expect(mods.use.wide(W.W2(1, 2))).toBe("12");
    expect(mods.use.wide(W.W3(1, 2, 3))).toBe("123");
    expect(mods.use.wide(W.W4(1, 2, 3, 4))).toBe("1234");
    expect(mods.use.wide(W.W5(1, 2, 3, 4, 5))).toBe("12345");
    expect(mods.use.wide(W.W6(1, 2, 3, 4, 5, 6))).toBe("123456");
  });
  test("a bare-dot constructor of an imported payload variant builds the tagged object", () => {
    // Pre-fix: `.Add(4, 5)` lowered to `"Add"(4, 5)` — a TypeError at runtime.
    expect(mods.use.built()).toBe("add9");
  });
});

describe("F11 — a variant name shared by two enums binds against the SUBJECT's enum", () => {
  let mods, errors;
  beforeAll(() => {
    ({ mods, errors } = build("f11-collide", {
      "bundle.scrml": ENTRY(`import { core } from "./use.scrml"`),
      "core.scrml": CORE,
      "other.scrml": `\${
    export type Expr:enum = { Lit(tag: string, n: int), Neg(x: int), Nil }
}
`,
      "use.scrml": `import { Expr } from "./core.scrml"
import { Expr as OExpr } from "./other.scrml"
\${
    type Local:enum = { Neg(y: int, z: int), Solo }
    export fn core(e: Expr) -> string {
        return match e {
            .Lit(n) :> "c" + n
            .Add(a, b) :> "add"
            .Nil :> "nil"
        }
    }
    export fn other(e: OExpr) -> string {
        return match e {
            .Lit(t, n) :> t + n
            .Neg(x) :> "neg" + x
            .Nil :> "onil"
        }
    }
    export fn local(l: Local) -> string {
        return match l {
            .Neg(y, z) :> "l" + y + "/" + z
            .Solo :> "solo"
        }
    }
    export fn localBuilt() -> string {
        const l: Local = .Neg(1, 2)
        return local(l)
    }
}
`,
    }));
  });
  test("compiles clean", () => { expect(errors).toEqual([]); });
  test("two imported enums sharing `Lit` (one aliased) each bind their own fields", () => {
    expect(mods.use.core(mods.core.Expr.Lit(5))).toBe("c5");
    expect(mods.use.other(mods.other.Expr.Lit("t", 7))).toBe("t7");
  });
  test("an imported `Neg(x)` beside a local `Neg(y, z)` binds `x`, not the local's first field", () => {
    expect(mods.use.other(mods.other.Expr.Neg(3))).toBe("neg3");
  });
  test("the local enum still binds its own fields", () => {
    expect(mods.use.localBuilt()).toBe("l1/2");
  });
});

describe("F11 — re-exported enums (one and two hops)", () => {
  let mods, errors;
  beforeAll(() => {
    ({ mods, errors } = build("f11-reexport", {
      "bundle.scrml": ENTRY(`import { viaHop } from "./use.scrml"`),
      "core.scrml": CORE,
      "mid.scrml": `\${\n    export { Pair } from './core.scrml'\n}\n`,
      "hop.scrml": `\${\n    export { Pair } from './mid.scrml'\n}\n`,
      "use.scrml": `import { Pair } from "./hop.scrml"
\${
    export fn viaHop(p: Pair) -> int {
        return match p {
            .P(x, y) :> x * 10 + y
            .Q :> -1
        }
    }
}
`,
    }));
  });
  test("compiles clean", () => { expect(errors).toEqual([]); });
  test("positional binding resolves through the re-export chain", () => {
    // The value is built in the canonical tagged shape directly: a library
    // chunk that only re-exports (`export { Pair } from …`) registers an EMPTY
    // `_scrml_modules` entry, so the enum OBJECT is not reachable at runtime
    // through the chain (a separate, pre-existing value-re-export gap). What
    // this pins is the MATCH lowering, whose schema comes from the type chain.
    expect(mods.use.viaHop({ variant: "P", data: { first: 3, second: 4 } })).toBe(34);
    expect(mods.use.viaHop("Q")).toBe(-1);
  });
});

describe("F16 — tag-only arms over an IMPORTED payload enum", () => {
  let mods, errors;
  beforeAll(() => {
    ({ mods, errors } = build("f16", {
      "bundle.scrml": ENTRY(`import { kind } from "./use.scrml"`),
      "core.scrml": CORE,
      "use.scrml": `import { Attr, Pair } from "./core.scrml"
\${
    export fn kind(a: Attr) -> int {
        return match a {
            .Static :> 1
            .Bound :> 2
            .On :> 3
        }
    }
    export fn pairKind(p: Pair) -> int {
        return match p {
            .P :> 1
            .Q :> 2
        }
    }
}
`,
    }));
  });
  test("compiles clean", () => { expect(errors).toEqual([]); });
  test("each payload variant matches its own tag-only arm", () => {
    const A = mods.core.Attr;
    expect(mods.use.kind(A.Static("x"))).toBe(1);
    expect(mods.use.kind(A.Bound("x", 1))).toBe(2);
    expect(mods.use.kind(A.On("click"))).toBe(3);
  });
  test("a mixed payload/unit enum matches both kinds of value", () => {
    expect(mods.use.pairKind(mods.core.Pair.P(1, 2))).toBe(1);
    expect(mods.use.pairKind(mods.core.Pair.Q)).toBe(2);
  });
});

describe("F17 — block-form arms keep NAMED bindings; object-literal bodies scope their values only", () => {
  let mods, errors;
  beforeAll(() => {
    ({ mods, errors } = build("f17", {
      "bundle.scrml": ENTRY(`import { obj } from "./use.scrml"`),
      "core.scrml": CORE,
      "use.scrml": `import { Attr, Pair } from "./core.scrml"
\${
    export fn obj(a: Attr) {
        return match a {
            .Static(name: n) :> { k: "s", v: n }
            .Bound(v: vv) :> { k: "b", v: vv }
            .On(ev: e) :> { k: "o", v: e }
        }
    }
    export fn declNamed(a: Attr) -> string {
        const out = match a {
            .Static(name: nm) => { lift "s" + nm }
            .Bound(v: vv) => { lift "b" + vv }
            .On(ev: e) => { lift "o" + e }
        }
        return out
    }
    export fn declPositional(a: Attr) -> string {
        const out = match a {
            .Static(nm) => { lift "s" + nm }
            .Bound(nm, v) => { lift "b" + nm + v }
            .On(ev) => { lift "o" + ev }
        }
        return out
    }
    export fn multi(a: Attr, p: Pair) -> string {
        return match (a, p) {
            (.Bound(nm, v), .P(x, y)) :> nm + v + x + y
            _ :> "other"
        }
    }
}
`,
    }));
  });
  test("compiles clean (no E-SCOPE-001 on the object keys `k` / `v`)", () => { expect(errors).toEqual([]); });
  test("a named binding of the SECOND field binds that field, not the first", () => {
    expect(mods.use.obj(mods.core.Attr.Bound("nm", 7))).toEqual({ k: "b", v: 7 });
    expect(mods.use.obj(mods.core.Attr.Static("x"))).toEqual({ k: "s", v: "x" });
  });
  test("block arms of a `const x = match` bind (named and positional)", () => {
    expect(mods.use.declNamed(mods.core.Attr.Bound("nm", 7))).toBe("b7");
    expect(mods.use.declPositional(mods.core.Attr.Bound("nm", 7))).toBe("bnm7");
  });
  test("multi-scrutinee positional binding over imported enums", () => {
    expect(mods.use.multi(mods.core.Attr.Bound("nm", 7), mods.core.Pair.P(3, 4))).toBe("nm734");
  });
});

describe("F17 — an undeclared name in an object-literal arm VALUE is still an error", () => {
  test("E-SCOPE-001 names the value, never the key", () => {
    const { errors } = build("f17-neg", {
      "bundle.scrml": ENTRY(`import { obj } from "./use.scrml"`),
      "core.scrml": CORE,
      "use.scrml": `import { Attr } from "./core.scrml"
\${
    export fn obj(a: Attr) {
        return match a {
            .Static(name: n) :> { k: undeclaredZ, v: n }
            .Bound(v: vv) :> { k: "b", v: vv }
            .On(ev: e) :> { k: "o", v: e }
        }
    }
}
`,
    });
    const scope = errors.filter((e) => e.code === "E-SCOPE-001").map((e) => e.message);
    expect(scope.length).toBe(1);
    expect(scope[0]).toContain("undeclaredZ");
  });
});

describe("F15 — a payload field named like a same-file function", () => {
  let mods, errors;
  beforeAll(() => {
    ({ mods, errors } = build("f15", {
      "bundle.scrml": ENTRY(`import { mk } from "./core.scrml"`),
      "core.scrml": `\${
    export type JsStmt:enum = { SFunc(name: string, params: string[], body: string), SNone }
    export fn params(n: int) -> string[] { return ["p" + n] }
    export fn mk() -> JsStmt { return JsStmt.SFunc("f", params(1), "b") }
    export fn readParams(s: JsStmt) -> string {
        return match s {
            .SFunc(params: ps) :> ps.join(",")
            .SNone :> ""
        }
    }
}
`,
    }));
  });
  test("compiles clean", () => { expect(errors).toEqual([]); });
  test("the constructor keeps the declared field name", () => {
    expect(mods.core.JsStmt.SFunc("f", ["x"], "b").data).toEqual({ name: "f", params: ["x"], body: "b" });
    expect(mods.core.mk().data.params).toEqual(["p1"]);
  });
  test("the field reads back through a match", () => {
    expect(mods.core.readParams(mods.core.mk())).toBe("p1");
  });
  test("the same-named function still resolves", () => {
    expect(mods.core.params(2)).toEqual(["p2"]);
  });
});
