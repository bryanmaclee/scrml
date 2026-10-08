/**
 * S458 slice 1 — §53 refinement: ONE reader, a fail-closed judge (F1).
 *
 * Before S458 there were two predicate readers. Declarations were judged off the
 * type-system reader (`resolveTypeExpr`); parameters, returns, server parameters and
 * `bind:value` re-parsed the annotation STRING with a regex mirror in
 * codegen/emit-predicates.ts. The mirror knew only `number|string|integer|boolean`
 * heads, so an enum-subset parameter was never checked. And the judge failed OPEN:
 * an unknown shape / unreadable predicate became a runtime check of `true`, while
 * E-CONTRACT-002/-003 fired only for a LITERAL initializer.
 *
 *   A  F1 — an unjudgeable refinement is refused at its declaration, in every zone
 *      and at every declaring position (let/const/cell, param, return, struct field,
 *      enum payload field), reported once.
 *   B  the reader reads the whole predicate: range form, `[label]`, `T(...)[]`.
 *   C  one reader — codegen judges the TS stamp; enum-subset parameters (client +
 *      server) are now checked; positions checked before S458 are unchanged.
 *   D  the judge fails closed (`false`, never `true`).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { resolveTypeExpr } from "../../src/type-system.js";
import { predicateToJsExpr } from "../../src/codegen/emit-predicates.ts";
import { _scrml_url_shape_ok } from "../../src/runtime-url-guard.js";

function compileSource(source, label) {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s458-reader-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")),
      clientJs: read("app.client.js"),
      serverJs: read("app.server.js"),
      serverPath: resolve(outDir, "app.server.js"),
      dir,
    };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
const codes = (out) => out.errors.map((e) => e.code);

/** Pull one emitted client function out of app.client.js and run it with the real url judge. */
function clientFn(js, name) {
  const head = js.match(new RegExp(`function (_scrml_${name}_\\d+)\\(([^)]*)\\) \\{`));
  if (!head) throw new Error(`no ${name} in client.js`);
  let i = head.index + head[0].length, depth = 1;
  for (; i < js.length && depth > 0; i++) { if (js[i] === "{") depth++; else if (js[i] === "}") depth--; }
  return new Function("_scrml_url_shape_ok", `${js.slice(head.index, i)}; return ${head[1]};`)(_scrml_url_shape_ok);
}

// ---------------------------------------------------------------------------
// A — F1: unjudgeable refinements are refused where they are declared
// ---------------------------------------------------------------------------

describe("A — F1: an unjudgeable refinement is a compile error at its declaration", () => {
  const cases = [
    ["boundary-zone let, unknown shape", "function f(v) {\n    let s: string(ssn) = v\n    return s\n  }", "E-CONTRACT-002"],
    ["boundary-zone cell, unknown shape", "<raw>: string = \"x\"\n  <s>: string(ssn) = @raw", "E-CONTRACT-002"],
    ["param, unknown shape", "function f(s: string(ssn)) {\n    return s\n  }", "E-CONTRACT-002"],
    ["param, trailing garbage", "function f(n: number(>0 foo)) {\n    return n\n  }", "E-CONTRACT-002"],
    // F-A — any tail after `)` other than one `[label]` / `[]` / `?` is malformed (refused, not untyped)
    ["let, text after the predicate", "function f(x) {\n    let q: number(>0) foo = x\n    return q\n  }", "E-CONTRACT-002"],
    ["let, `!` after the predicate", "function f(x) {\n    let q: number(>0)! = x\n    return q\n  }", "E-CONTRACT-002"],
    ["let, text after the label", "function f(x) {\n    let q: number(>0) [pos] x = x\n    return q\n  }", "E-CONTRACT-002"],
    ["let, two labels", "function f(x) {\n    let q: number(>0) [a] [b] = x\n    return q\n  }", "E-CONTRACT-002"],
    ["let, label that is not an identifier", "function f(x) {\n    let q: number(>0) [a-b] = x\n    return q\n  }", "E-CONTRACT-002"],
    ["param, invalid regex", "function f(e: string(pattern(/a)b/))) {\n    return e\n  }", "E-CONTRACT-002"],
    ["param, unknown shared-core word", "function f(n: number(between(0))) {\n    return n\n  }", "E-CONTRACT-002"],
    ["param, cross-field shared-core arg", "<lo>: number = 0\n  function f(n: number(gte(@lo))) {\n    return n\n  }", "E-CONTRACT-003"],
    ["return type, unknown shape", "function f(v) -> string(ssn) {\n    return v\n  }", "E-CONTRACT-002"],
    ["struct field, unknown shape", "type T:struct = { s: string(ssn) }", "E-CONTRACT-002"],
    ["enum payload field, unknown shape", "type E:enum = { A(s: string(ssn)), B }", "E-CONTRACT-002"],
    ["param, external reactive reference", "<cap>: number = 5\n  function f(n: number(<=@cap)) {\n    return n\n  }", "E-CONTRACT-003"],
  ];
  for (const [label, body, code] of cases) {
    test(`${label} → ${code}`, () => {
      const out = compileSource(`<program>\n\${\n  ${body}\n}\n<p>x</p>\n</program>\n`, "f1");
      try {
        expect(codes(out)).toContain(code);
      } finally {
        rmSync(out.dir, { recursive: true, force: true });
      }
    });
  }

  test("a literal-initialized unknown shape reports E-CONTRACT-002 ONCE (no zone double-fire)", () => {
    const out = compileSource(`<program>\n<s>: string(ssn) = "x"\n<p>\${@s}</p>\n</program>\n`, "once");
    try {
      expect(codes(out).filter((c) => c === "E-CONTRACT-002")).toHaveLength(1);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("judgeable refinements still compile clean at every declaring position", () => {
    const src = `<program>
\${
  type T:struct = { u: string(url), n: number(>0) }
  type E:enum = { A(u: string(url)), B }
  <c>: number(0 < value < 10) = 5
  function f(u: string(url), n: integer(>0) [count]) -> string(email || url) {
    let q: string(.length > 2) = u
    return q
  }
}
<p>\${@c}</p>
</program>
`;
    const out = compileSource(src, "clean");
    try {
      expect(out.errors).toHaveLength(0);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B — the reader reads the WHOLE annotation
// ---------------------------------------------------------------------------

describe("B — the reader reads the whole annotation", () => {
  test("range form `0 < value < 10` is the conjunction of two value comparisons", () => {
    const t = resolveTypeExpr("number(0 < value < 10)", new Map());
    expect(t.kind).toBe("predicated");
    const f = new Function("v", `return ${predicateToJsExpr(t.predicate, "v")};`);
    expect([f(0), f(1), f(9), f(10)]).toEqual([false, true, true, false]);
    const t2 = resolveTypeExpr("number(10 >= value > -1)", new Map());
    const g = new Function("v", `return ${predicateToJsExpr(t2.predicate, "v")};`);
    expect([g(-1), g(0), g(10), g(11)]).toEqual([false, true, true, false]);
  });

  test("`[label]` is read; any other tail is not a label", () => {
    expect(resolveTypeExpr("number(>0) [price]", new Map()).label).toBe("price");
    // `string(url)[]` is an ARRAY of refined strings, not `string(url)` with an empty label
    const arr = resolveTypeExpr("string(url)[]", new Map());
    expect(arr.kind).toBe("array");
    expect(arr.element.kind).toBe("predicated");
  });

  test("annotations re-joined from tokens are read as written (space after `.`, between sign and digits)", () => {
    // These are the exact strings the AST builder hands TS for a param / return / struct field.
    const judge = (a) => {
      const t = resolveTypeExpr(a, new Map());
      expect([a, t.kind]).toEqual([a, "predicated"]);
      return new Function("v", `return ${predicateToJsExpr(t.predicate, "v")};`);
    };
    const neg = judge("number ( >= - 1 )"); // source `number(>= -1)` — before S458 this read as `>= 1`
    expect([neg(-1), neg(-2), neg(0)]).toEqual([true, false, true]);
    const len = judge("string(. length>=1)"); // source `string(.length >= 1)` — before S458: unreadable, unchecked
    expect([len(""), len("x")]).toEqual([false, true]);
    const rng = judge("number(-1< value<9.5)");
    expect([rng(-1), rng(0), rng(9.5)]).toEqual([false, true, false]);
    expect(resolveTypeExpr("string( email|| url)[ lbl]", new Map()).label).toBe("lbl");
  });

  test("README flagship `createTask(userId, text: string(.length >= 1))` server param is now enforced", async () => {
    // The flagship's refinement reached the codegen mirror as `string(. length>=1)`, which it could not
    // read — so the server accepted an empty task. One reader reads it.
    const out = compileSource(`<program>
\${
  server function createTask(userId, text: string(.length >= 1)) {
    return text
  }
}
<button onclick=createTask(1, "x")>add</button>
</program>
`, "flagship");
    try {
      expect(out.errors).toHaveLength(0);
      const mod = await import(out.serverPath);
      const route = mod.routes.find((r) => r.method === "POST");
      const call = (text) => mod.fetch(new Request("http://localhost" + route.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
        body: JSON.stringify({ userId: 1, text }),
      }));
      expect((await call("")).status).toBe(400);
      expect((await call("buy milk")).status).toBe(200);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("an unreadable predicate stays REFINED (an `error` predicate), never untyped", () => {
    for (const a of ["number(>0 foo)", "string(pattern(/x/))", "number(min(0))", "number(>0 &&)", "number((>0)", "number((>0 && <5)"]) {
      const t = resolveTypeExpr(a, new Map());
      expect([a, t.kind]).toEqual([a, "predicated"]);
    }
  });
});

// ---------------------------------------------------------------------------
// C — one reader: codegen judges the TS stamp
// ---------------------------------------------------------------------------

describe("C — one reader", () => {
  const ENUM_APP = `<program>
\${
  type Role:enum = { Admin, Editor, Viewer }
  function promote(r: Role oneOf([.Admin, .Editor])) {
    return r
  }
  server function promoteOnServer(r: Role oneOf([.Admin, .Editor])) {
    return r
  }
}
<p>\${promote(.Admin)}</p>
<button onclick=promoteOnServer(.Admin)>go</button>
</program>
`;

  test("an enum-subset CLIENT parameter is checked (was: never)", () => {
    const out = compileSource(ENUM_APP, "enum-client");
    try {
      expect(out.errors).toHaveLength(0);
      const promote = clientFn(out.clientJs, "promote");
      expect(promote("Admin")).toBe("Admin");
      expect(() => promote("Viewer")).toThrow("E-CONTRACT-001-RT");
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("an enum-subset SERVER parameter is checked: out-of-subset → 400, in-subset → 200", async () => {
    const out = compileSource(ENUM_APP, "enum-server");
    try {
      expect(out.errors).toHaveLength(0);
      const mod = await import(out.serverPath);
      const route = mod.routes.find((r) => r.method === "POST");
      const call = (r) => mod.fetch(new Request("http://localhost" + route.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
        body: JSON.stringify({ r }),
      }));
      expect((await call("Viewer")).status).toBe(400);
      expect((await call("Editor")).status).toBe(200);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("positions checked before S458 still refuse (decl, client param, client return)", () => {
    const src = `<program>
\${
  function decl(v) {
    let q: string(url) = v
    return q
  }
  function param(u: string(url)) {
    return u
  }
  function ret(v) -> string(url) {
    return v
  }
}
<p>\${decl("https://a.b")}\${param("https://a.b")}\${ret("https://a.b")}</p>
</program>
`;
    const out = compileSource(src, "controls");
    try {
      expect(out.errors).toHaveLength(0);
      for (const name of ["decl", "param", "ret"]) {
        const f = clientFn(out.clientJs, name);
        expect(f("https://scrml.dev/")).toBe("https://scrml.dev/");
        expect(() => f("javascript:alert(1)")).toThrow("E-CONTRACT-001-RT");
      }
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("the declaration label reaches the runtime message (§53.2.3)", () => {
    const src = `<program>
\${
  function f(v) {
    let q: number(>0) [qty] = v
    return q
  }
}
<p>\${f(1)}</p>
</program>
`;
    const out = compileSource(src, "label");
    try {
      expect(() => clientFn(out.clientJs, "f")(-1)).toThrow("qty");
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D — the judge fails closed
// ---------------------------------------------------------------------------

describe("D — the judge fails closed", () => {
  test("unknown shape / error / unknown kind → a check that refuses everything", () => {
    for (const p of [{ kind: "named-shape", name: "ssn" }, { kind: "error", message: "x" }, { kind: "bogus" }]) {
      const f = new Function("v", `return ${predicateToJsExpr(p, "v")};`);
      expect(f("anything")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// E..H — S458 slice-1 fix round (review F-A..F-F)
// ---------------------------------------------------------------------------

/** Compile `body` (inside `${}`) and return the named emitted client functions. */
function clientFns(body, names, label) {
  const out = compileSource(`<program>\n\${\n${body}\n}\n<p>x</p>\n</program>\n`, label);
  try {
    expect(out.errors).toHaveLength(0);
    return Object.fromEntries(names.map((n) => [n, clientFn(out.clientJs, n)]));
  } finally {
    rmSync(out.dir, { recursive: true, force: true });
  }
}
const refused = (f, ...args) => {
  try { f(...args); return false; } catch (e) { return String(e.message).includes("E-CONTRACT-001-RT"); }
};

describe("E — §55.1 shared-core words inside the parens are JUDGED (§53.6.1, §55.3)", () => {
  test("min / max / length / pattern / oneOf / notIn / eq / req / gt / lt — executed", () => {
    const fns = clientFns(`  function rate(score: number(min(0) && max(100))) { return score }
  function name(n: string(length(>=2 && <=5))) { return n }
  function mail(e: string(pattern(/^[^@]+@[^@]+$/))) { return e }
  function size(s: string(oneOf(["S", "M", "L"]))) { return s }
  function nick(s: string(notIn(["root", "admin"]))) { return s }
  function only(s: string(eq("yes"))) { return s }
  function filled(s: string(req)) { return s }
  function strict(n: number(gt(0) && lt(1))) { return n }`,
      ["rate", "name", "mail", "size", "nick", "only", "filled", "strict"], "shared-core");
    expect([refused(fns.rate, 0), refused(fns.rate, 100), refused(fns.rate, -1), refused(fns.rate, 101)]).toEqual([false, false, true, true]);
    expect([refused(fns.name, "ab"), refused(fns.name, "a"), refused(fns.name, "abcdef")]).toEqual([false, true, true]);
    expect([refused(fns.mail, "a@b"), refused(fns.mail, "ab")]).toEqual([false, true]);
    expect([refused(fns.size, "M"), refused(fns.size, "XL")]).toEqual([false, true]);
    expect([refused(fns.nick, "bob"), refused(fns.nick, "root")]).toEqual([false, true]);
    expect([refused(fns.only, "yes"), refused(fns.only, "no")]).toEqual([false, true]);
    expect([refused(fns.filled, "x"), refused(fns.filled, "")]).toEqual([false, true]);
    expect([refused(fns.strict, 0.5), refused(fns.strict, 0), refused(fns.strict, 1)]).toEqual([false, true, true]);
  });

  test("a literal is judged statically (E-CONTRACT-001), not deferred", () => {
    const out = compileSource(`<program>\n<n>: number(min(0) && max(100)) = 500\n<p>\${@n}</p>\n</program>\n`, "sc-lit");
    try {
      expect(codes(out)).toContain("E-CONTRACT-001");
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });
});

describe("F — the judge checks the BASE TYPE first (review F-D)", () => {
  test("client: number / integer / string bases refuse a value of another type", () => {
    const fns = clientFns(`  function n(x: number(>0)) { return x }
  function i(x: integer(>0)) { return x }
  function s(x: string(.length >= 1)) { return x }`, ["n", "i", "s"], "base");
    expect([refused(fns.n, 5), refused(fns.n, "5"), refused(fns.n, [5]), refused(fns.n, NaN)]).toEqual([false, true, true, true]);
    expect([refused(fns.i, 2), refused(fns.i, 0.5), refused(fns.i, "2")]).toEqual([false, true, true]);
    expect([refused(fns.s, "a"), refused(fns.s, ["a", "b"]), refused(fns.s, { length: 5 }), refused(fns.s, null)]).toEqual([false, true, true, true]);
  });

  test("server: wrong base type, null, a missing field, a throwing toString → 400, never a 500", async () => {
    const out = compileSource(`<program>
\${
  server function createTask(text: string(.length >= 1)) {
    return text
  }
}
<button onclick=createTask("x")>add</button>
</program>
`, "base-server");
    try {
      expect(out.errors).toHaveLength(0);
      const mod = await import(out.serverPath);
      const route = mod.routes.find((r) => r.method === "POST");
      const call = (body) => mod.fetch(new Request("http://localhost" + route.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
        body: JSON.stringify(body),
      }));
      for (const body of [{ text: null }, {}, { text: ["a", "b"] }, { text: { length: 5 } }, { text: { toString: 1 } }, { text: 5 }]) {
        const res = await call(body);
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }
      expect((await call({ text: "buy milk" })).status).toBe(200);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });
});

describe("G — string-literal operands (review F-C)", () => {
  test("a quoted operand is judged as the literal on every path (param, let, return)", () => {
    const fns = clientFns(`  function p(v: string(.length == 3 || .length == 5)) { return v }
  function k(o) {
    let q: string(eq("a b")) = o
    return q
  }
  function r(o) -> string(neq("x")) { return o }`, ["p", "k", "r"], "strings");
    expect([refused(fns.p, "abc"), refused(fns.p, "ab")]).toEqual([false, true]);
    expect([refused(fns.k, "a b"), refused(fns.k, "a")]).toEqual([false, true]);
    expect([refused(fns.r, "y"), refused(fns.r, "x")]).toEqual([false, true]);
  });

  test("a property predicate with a string value is emitted quoted (was: a bare identifier → ReferenceError)", () => {
    const t = resolveTypeExpr(`string(.kind == "a b")`, new Map());
    expect(predicateToJsExpr(t.predicate, "v")).toBe(`(v.kind == "a b")`);
    // the unquoted form is not the same predicate — it does not read at all
    expect(resolveTypeExpr(`string(.kind == a)`, new Map()).predicate.kind).toBe("error");
  });
});

describe("H — refinements inside containers (review F-B)", () => {
  test("`T[]` is judged element-wise; `T | not` / `T?` admit `not`", () => {
    const fns = clientFns(`  function list(v) {
    let a: string(url)[] = v
    return a
  }
  function maybe(v) {
    let m: number(>0) | not = v
    return m
  }
  function opt(v) {
    let o: number(>0)? = v
    return o
  }
  function param(xs: number(>0)[]) { return xs }`, ["list", "maybe", "opt", "param"], "contained");
    expect([refused(fns.list, ["https://a.b", "http://c.d"]), refused(fns.list, ["https://a.b", "javascript:x"]), refused(fns.list, "https://a.b")]).toEqual([false, true, true]);
    expect([refused(fns.maybe, 3), refused(fns.maybe, null), refused(fns.maybe, -1)]).toEqual([false, false, true]);
    expect([refused(fns.opt, 3), refused(fns.opt, null), refused(fns.opt, 0)]).toEqual([false, false, true]);
    expect([refused(fns.param, [1, 2]), refused(fns.param, [1, -2]), refused(fns.param, [])]).toEqual([false, true, false]);
  });

  test("a literal array initializer is judged statically, element by element", () => {
    const bad = compileSource(`<program>\n<links>: string(url)[] = ["https://a.b", "javascript:alert(1)"]\n<p>x</p>\n</program>\n`, "arr-bad");
    const ok = compileSource(`<program>\n<links>: string(url)[] = ["https://a.b"]\n<p>x</p>\n</program>\n`, "arr-ok");
    try {
      expect(codes(bad)).toContain("E-CONTRACT-001");
      expect(ok.errors).toHaveLength(0);
    } finally {
      rmSync(bad.dir, { recursive: true, force: true });
      rmSync(ok.dir, { recursive: true, force: true });
    }
  });
});
