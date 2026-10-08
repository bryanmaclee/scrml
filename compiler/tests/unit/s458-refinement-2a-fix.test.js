/**
 * S458 refinement 2a-fix — the review findings of slice 2a (F1-F4).
 *
 *   F1  one accessor for a refinement: codegen never reads a raw predicate off a
 *       stamp; the bind:value gate judges the BOUND position (a field by path).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { refinementOf, refinementAtPath, htmlPredicateOf, judgeBaseType } from "../../src/codegen/emit-predicates.ts";
import { judgeTypeOf } from "../../src/refinement-obligations.ts";

const CODEGEN = resolve(import.meta.dir, "../../src/codegen");

describe("F1 — one accessor for a refinement", () => {
  test("no codegen consumer reads a raw predicate off a stamp or calls the predicate-level primitives", () => {
    const offenders = [];
    for (const f of readdirSync(CODEGEN)) {
      if (!f.endsWith(".ts") || f === "emit-predicates.ts") continue;
      const src = readFileSync(resolve(CODEGEN, f), "utf8");
      const lines = src.split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (/(predicateCheck|refinement|refineReturn|refineAssign|_pc|_pParsed|PredInfo|predInfo)\??\.predicate\b/.test(l)
          || /\b(predicateToJsExpr|judgeExpr|emitRuntimeCheck|emitServerParamCheck)\s*\(/.test(l)) {
          offenders.push(`${f}:${i + 1}: ${l.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("a whole-type stamp yields no predicate; the field path yields the field's own judge", () => {
    const struct = judgeTypeOf({ kind: "struct", name: "P", fields: new Map([["name", { kind: "primitive", name: "string" }], ["n", { kind: "predicated", baseType: "number", predicate: { kind: "comparison", op: ">", value: 0 }, label: null }]]) });
    expect(struct.k).toBe("struct");
    expect(Object.keys(struct).sort()).toEqual(["id", "k", "name"]); // a reference, never an inline copy
    const r = refinementOf({ judge: struct, predicate: undefined });
    expect(Object.keys(r).sort()).toEqual(["judge", "label"]);
    expect(htmlPredicateOf(r)).toBeNull();
    expect(refinementAtPath(r, ["name"])).toBeNull(); // unrefined field: no judge, no gate
    const n = refinementAtPath(r, ["n"]);
    expect(n.judge.k).toBe("pred");
    expect(judgeBaseType(n.judge)).toBe("number");
    expect(htmlPredicateOf(n).baseType).toBe("number");
  });

  test("a plain refinement inside containers becomes the container judge", () => {
    const r = refinementOf({ predicate: { kind: "comparison", op: ">", value: 0 }, baseType: "number", label: "pos", wrap: ["array", "nullable"] });
    expect(r.judge.k).toBe("array");
    expect(r.judge.of.k).toBe("nullable");
    expect(r.judge.of.of.k).toBe("pred");
    expect(r.label).toBe("pos");
    expect(htmlPredicateOf(r)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F3 — one hoisted judge per struct type per bundle (linear output)
// ---------------------------------------------------------------------------

function compileClient(source, label) {
  const dir = resolve(tmpdir(), `scrml-s458-2afix-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "out"), log: () => {} });
  const p = resolve(dir, "out", "app.client.js");
  const js = existsSync(p) ? readFileSync(p, "utf8") : "";
  const rtName = existsSync(resolve(dir, "out")) ? readdirSync(resolve(dir, "out")).find((f) => /^scrml-runtime\..*\.js$/.test(f)) : undefined;
  const runtime = rtName ? readFileSync(resolve(dir, "out", rtName), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { js, runtime, errors: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")) };
}

/** 4 struct levels, each reusing the level below `k` times, 40 refined fields, `fns` functions taking the top. */
function stress(k, fns) {
  const L = [];
  let i = 0;
  const field = () => { i++; return i % 2 ? `f${i}: number(>${i})` : `s${i}: string(.length >= ${i % 5})`; };
  L.push(`  type S0:struct = { ${Array.from({ length: 10 }, field).join(", ")} }`);
  for (let lvl = 1; lvl < 4; lvl++) {
    const fs = Array.from({ length: k }, (_, c) => `c${c}: S${lvl - 1}`);
    for (let n = 0; n < 10; n++) fs.push(field());
    L.push(`  type S${lvl}:struct = { ${fs.join(", ")} }`);
  }
  for (let f = 0; f < fns; f++) L.push(`  function take${f}(x: S3) { return x.c0 }`);
  L.push(`  <top>: S3 | not = not`);
  const uses = Array.from({ length: fns }, (_, f) => `<p>\${take${f}(@top)}</p>`).join("\n");
  return `\${\n${L.join("\n")}\n}\n<program>\n${uses}\n</program>\n`;
}

describe("F3 — hoisted struct judges", () => {
  test("output is linear in struct reuse: k=3 vs k=6 differ by < 5%, and each struct judge is defined once", () => {
    const a = compileClient(stress(3, 10), "k3");
    const b = compileClient(stress(6, 10), "k6");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    // S459 MED-1: the refined cell's descriptor lists each struct-typed field once
    // (`cN: { ok: _scrml_judge_S…, fields: _scrml_judge_parts_S… }`), so k=3 -> k=6
    // adds 3 levels x 3 fields of ~100 B — linear in k. A k^depth copy would be x6.
    expect(Math.abs(b.js.length - a.js.length) / a.js.length).toBeLessThan(0.08);
    const c = compileClient(stress(12, 10), "k12");
    expect((c.js.length - b.js.length) / (b.js.length - a.js.length)).toBeLessThan(2.5); // 6 more fields per level vs 3: ~2x
    for (const lvl of [0, 1, 2, 3]) {
      expect((b.js.match(new RegExp(`function _scrml_judge_S${lvl}_[a-z0-9]+\\(`, "g")) ?? []).length).toBe(1);
    }
    // every site calls the hoisted judge; the struct's fields are not copied into the site
    expect((b.js.match(/_scrml_judge_S3_[a-z0-9]+\(x\)/g) ?? []).length).toBe(10);
  });

  test("a nested struct is a call to its own judge, and a failure report names the type", () => {
    const { js, errors } = compileClient(`\${\n  type A:struct = { n: number(>0) }\n  type B:struct = { a: A, b: A, m: string(.length >= 1) }\n  function f(x: B) { return x.m }\n}\n<program>\n<p>\${f({ a: { n: 1 }, b: { n: 2 }, m: "z" })}</p>\n</program>\n`, "nested");
    expect(errors).toEqual([]);
    const bDef = js.slice(js.indexOf("function _scrml_judge_B_"));
    expect(bDef).toMatch(/_scrml_judge_A_[a-z0-9]+\(v\.a\) &&/);
    expect(bDef).toMatch(/_scrml_judge_A_[a-z0-9]+\(v\.b\) &&/);
    expect(js).toContain(`"  Constraint: (" + "B" + ")"`);
    expect(js).toContain("// §53 judge — B { a: A, b: A, m: string(.length >= 1) }");
  });
});

// ---------------------------------------------------------------------------
// F2 — the judge at the runtime cell write path (executed grid:
// docs/changes/s458-refinement-2a-fix/repro/grid.mjs; conformance
// refinement/cell-write-origins-*, local-write-forms-*, engine-payload-*)
// ---------------------------------------------------------------------------

describe("F2 — refined cells register their judge; the shipped runtime carries the guarded setter", () => {
  test("a refined cell registers before its first write; no inline check at its writes; the pruned runtime has the registry + proxy", () => {
    const { js, runtime, errors } = compileClient(`\${\n  <n>: number(>0) = 1\n  <ls>: number(>0)[] = [1]\n  function g(v) { @n = v }\n  function h(v) { @ls.push(v) }\n}\n<program>\n<button onclick=g(-1)>g</button><button onclick=h(1)>h</button>\n<p>\${@n} \${@ls.length}</p>\n</program>\n`, "reg");
    expect(errors).toEqual([]);
    const reg = js.indexOf(`_scrml_cs_refine_register("n", `);
    expect(reg).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(js.indexOf(`_scrml_cs_reactive_set("n", 1)`));
    expect(js).not.toContain("E-CONTRACT-001-RT boundary check for 'n'");
    expect(runtime).toContain("function _scrml_refine_register(");
    expect(runtime).toContain("function _scrml_refine_check(");
    expect(runtime).toContain("function _scrml_deep_reactive(");
    // the setter judges FIRST (before any timing rule / commit), and the proxy hooks are installed
    expect(runtime).toMatch(/_scrml_reactive_set = function \(name, value\) \{\n\s*if \(_scrml_refine_judges\[name\] !== undefined\) value = _scrml_refine_check\(name, value\);/);
    expect(runtime).toContain("_scrml_deep_reactive = function (value) {");
  });

  test("a page with no refined cell ships no registration", () => {
    const { js, runtime } = compileClient(`<program>\n  <n> = 1\n  <p>\${@n}</p>\n</program>\n`, "noreg");
    expect(js).not.toContain("refine_register");
    expect(runtime).not.toContain("_scrml_refine_");
  });

  test("a block-bodied arrow writing an outer refined LOCAL is refused; a shadowing parameter is not", () => {
    const bad = compileClient(`\${\n  function g(v) {\n    let k: number(>0) = 1\n    const f = () => { k = v }\n    f()\n    return k\n  }\n}\n<program><p>\${g(2)}</p></program>\n`, "arrow-bad");
    expect(bad.errors.map((e) => e.code)).toContain("E-CONTRACT-002");
    const ok = compileClient(`\${\n  function g(v) {\n    let k: number(>0) = 1\n    const f = (k) => { k = v }\n    f(1)\n    const h = () => { let k = 0\n k = v }\n    h()\n    return k\n  }\n}\n<program><p>\${g(2)}</p></program>\n`, "arrow-ok");
    expect(ok.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F4 — the worker helper scan reads calls with a tokenizer
// ---------------------------------------------------------------------------

describe("F4 — a `_scrml_*(` mention in a worker's template literal is not a missing helper", () => {
  const worker = (body) => `<program>\n<out> = ""\n<program name="wk">\n  \${\n    when message(data) {\n${body}\n    }\n  }\n</program>\n<p>\${@out}</p>\n</program>\n`;
  test("template-literal text naming a helper compiles", () => {
    const r = compileClient(worker("      const t = `see _scrml_foo(1) docs`\n      send(t)"), "f4-tpl");
    expect(r.errors.map((e) => e.code)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });
  test("a real call to an uninlined helper is still refused", async () => {
    const { unmetWorkerHelperRefsForTest } = await import("../../src/codegen/emit-worker.ts");
    expect(unmetWorkerHelperRefsForTest("const t = `see _scrml_foo(1) docs`; /* _scrml_bar(2) */ // _scrml_baz(3)\nx.y._scrml_m(1);")).toEqual([]);
    expect(unmetWorkerHelperRefsForTest("const t = `a ${_scrml_foo(1)} b`;")).toEqual(["_scrml_foo"]);
    expect(unmetWorkerHelperRefsForTest("_scrml_bar(2); function _scrml_ok() {} _scrml_ok();")).toEqual(["_scrml_bar"]);
  });
});
