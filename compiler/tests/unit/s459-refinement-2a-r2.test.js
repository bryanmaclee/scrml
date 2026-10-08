/**
 * S459 refinement 2a fix round 2 — the S459 differential review findings.
 *
 *   MED-1    a refined collection write judges what it changes (a pushed element,
 *            a written element / field, a copy-on-write path update), not the
 *            whole value; the trailing set after an in-place push is not a second
 *            whole judge. Fails closed: an undescribed position (a union) judges
 *            the whole cell.
 *   LOW-4    an array held by two refined cells is judged against both, and a
 *            refused in-place change leaves it unchanged; a released alias no
 *            longer constrains it.
 *   LOW-MED-3 (see the union section) — a union member is never admitted wholesale.
 *
 * The runtime rows evaluate the EMITTED pruned runtime + client (no DOM needed:
 * the client's boot returns early without a document; cells register and write
 * at top level).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compile(source, label) {
  const dir = resolve(tmpdir(), `scrml-s459-r2-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "out"), log: () => {} });
  const p = resolve(dir, "out", "app.client.js");
  const js = existsSync(p) ? readFileSync(p, "utf8") : "";
  const rtName = existsSync(resolve(dir, "out")) ? readdirSync(resolve(dir, "out")).find((f) => /^scrml-runtime\..*\.js$/.test(f)) : undefined;
  const runtime = rtName ? readFileSync(resolve(dir, "out", rtName), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
  return { js, runtime, errors, all: r.errors ?? [] };
}

/** Load the emitted runtime + client; returns the store, the judges, and the runtime's setter / path helper. */
function load(js, runtime) {
  const api = new Function(`${runtime}\n${js}\n;return { state: _scrml_state, judges: _scrml_refine_judges, set: _scrml_reactive_set, deepSet: typeof _scrml_deep_set === "function" ? _scrml_deep_set : null };`)();
  const key = (cell) => Object.keys(api.judges).find((k) => k === cell || k.endsWith("$" + cell));
  return { ...api, key };
}

/** Count calls of descriptor d's ok (and, recursively, of its element / field descriptors). */
function instrument(d, counts, name) {
  const ok = d.ok;
  counts[name] = 0;
  d.ok = (v) => { counts[name]++; return ok(v); };
  if (d.el) instrument(d.el, counts, name + ".el");
  if (typeof d.fields === "function") {
    const fm = d.fields();
    for (const f of Object.keys(fm)) instrument(fm[f], counts, name + "." + f);
    d.fields = () => fm;
  }
}

const throwsContract = (fn) => {
  try { fn(); } catch (e) { return /^E-CONTRACT-001-RT/.test(String(e && e.message)); }
  return false;
};

const page = (decls) => `\${\n  type L:struct = { u: string, n: number(>0) }\n  ${decls}\n}\n<program>\n<p>x</p>\n</program>\n`;

describe("MED-1 — a refined collection write judges only what it changes", () => {
  test("the registration carries a descriptor built from the judge (element, struct fields by a hoisted parts function)", () => {
    const { js, errors } = compile(page(`<ls>: L[] = []\n  function g() {\n    const r = { u: "a", n: 1 }\n    @ls.push(r)\n  }`), "desc");
    expect(errors).toEqual([]);
    expect(js).toMatch(/_scrml_cs_refine_register\("ls", \{ ok: \(v\) => \(Array\.isArray\(v\) && v\.every\(\(_scrml_el0\) => _scrml_judge_L_[a-z0-9]+\(_scrml_el0\)\)\), el: \{ ok: _scrml_judge_L_[a-z0-9]+, fields: _scrml_judge_parts_L_[a-z0-9]+ \} \}, "L\[\]", "ls"\);/);
    expect(js).toMatch(/function _scrml_judge_parts_L_[a-z0-9]+\(\) \{\n  return \{\n    n: \{ ok: \(v\) => \(typeof v === "number" && !Number\.isNaN\(v\) && \(v > 0\)\) \},\n  \};\n\}/);
    expect((js.match(/function _scrml_judge_parts_L_/g) ?? []).length).toBe(1);
  });

  test("N pushes judge N elements and never the whole array (the trailing set is not a second judge)", () => {
    const { js, runtime, errors } = compile(page(`<ls>: number(>0)[] = []`), "push");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("ls");
    const counts = {};
    instrument(rt.judges[k].d, counts, "ls");
    for (let i = 1; i <= 300; i++) {
      rt.state[k].push(i);
      rt.set(k, rt.state[k]); // what `@ls.push(i)` lowers to
    }
    expect(rt.state[k].length).toBe(300);
    expect(counts.ls).toBe(0);
    expect(counts["ls.el"]).toBe(300);
    expect(throwsContract(() => rt.state[k].push(-1))).toBe(true);
    expect(rt.state[k].length).toBe(300);
  });

  test("a field write on an element — in place, and by a copy-on-write path update — judges that field only", () => {
    const { js, runtime, errors } = compile(page(`<ls>: L[] = []\n  function w(i, v) { @ls[i].n = v }`), "field");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("ls");
    const rows = [];
    for (let i = 1; i <= 200; i++) rows.push({ u: "a", n: i });
    rt.set(k, rows); // one whole write: judged whole once
    const counts = {};
    instrument(rt.judges[k].d, counts, "ls");
    for (let i = 0; i < 200; i++) rt.set(k, rt.deepSet(rt.state[k], [i, "n"], i + 5)); // `@ls[i].n = i + 5`
    for (let i = 0; i < 200; i++) rt.state[k][i].n = i + 7; // in place, through the proxy
    expect(counts.ls).toBe(0);
    expect(counts["ls.el"]).toBe(0);
    expect(counts["ls.el.n"]).toBe(400);
    expect(rt.state[k][3].n).toBe(10);
    expect(throwsContract(() => rt.set(k, rt.deepSet(rt.state[k], [3, "n"], -1)))).toBe(true);
    expect(throwsContract(() => { rt.state[k][3].n = -1; })).toBe(true);
    expect(rt.state[k][3].n).toBe(10);
    // an unrefined field is not judged at all
    const before = counts["ls.el.n"];
    rt.state[k][3].u = "zz";
    rt.set(k, rt.deepSet(rt.state[k], [4, "u"], "q"));
    expect(counts["ls.el.n"]).toBe(before);
    expect(counts.ls + counts["ls.el"]).toBe(0);
    expect(rt.state[k][4].u).toBe("q");
  });

  test("fails closed: a position the descriptor does not describe (a union) re-judges the whole cell", () => {
    const { js, runtime, errors } = compile(page(`<u>: number(>0)[] | string = [1, 2]\n  function w(v) { @u[0] = v }`), "union");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("u");
    expect(rt.judges[k].d.el).toBeUndefined();
    const counts = {};
    instrument(rt.judges[k].d, counts, "u");
    rt.state[k].push(3);
    expect(counts.u).toBe(1);
    expect(throwsContract(() => rt.state[k].push(-3))).toBe(true);
    expect(throwsContract(() => rt.set(k, rt.deepSet(rt.state[k], [0], -1)))).toBe(true);
    expect(JSON.parse(JSON.stringify(rt.state[k]))).toEqual([1, 2, 3]);
  });

  test("an object held at two positions of one value is judged at both", () => {
    const { js, runtime, errors } = compile(`\${\n  type P:struct = { a: number(>0)[], b: number(>5)[] }\n  <p>: P = { a: [6], b: [8] }\n}\n<program>\n<p>x</p>\n</program>\n`, "two-pos");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("p");
    const arr = [6, 7];
    rt.set(k, { a: arr, b: arr });
    expect(throwsContract(() => rt.state[k].a.push(3))).toBe(true); // 3 > 0 for a, but not > 5 for b
    expect(JSON.parse(JSON.stringify(rt.state[k]))).toEqual({ a: [6, 7], b: [6, 7] });
    rt.state[k].a.push(9);
    expect(rt.state[k].b.length).toBe(3);
  });
});

describe("LOW-4 — an array shared by two refined cells", () => {
  const src = page(`<y>: number(>5)[] = [6, 7]\n  <x>: number(>0)[] = [1]`);

  test("a push one holder's type refuses is refused, and leaves the array unchanged", () => {
    const { js, runtime, errors } = compile(src, "shared");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const y = rt.key("y"), x = rt.key("x");
    rt.set(x, rt.state[y]); // @x = @y
    for (const via of [x, y]) {
      expect(throwsContract(() => { rt.state[via].push(3); rt.set(via, rt.state[via]); })).toBe(true);
      expect(throwsContract(() => { rt.state[via][0] = 3; })).toBe(true);
      expect(JSON.parse(JSON.stringify(rt.state[y]))).toEqual([6, 7]);
    }
    rt.state[x].push(9); // both types admit it
    expect(rt.state[y].length).toBe(3);
  });

  test("once the alias is released, the released cell's type no longer applies", () => {
    const { js, runtime } = compile(page(`<y>: number(>0)[] = [6, 7]\n  <x>: number(>5)[] = [9]`), "released");
    const rt = load(js, runtime);
    const y = rt.key("y"), x = rt.key("x");
    rt.set(x, rt.state[y]);
    expect(throwsContract(() => rt.state[y].push(3))).toBe(true); // x (> 5) still holds it
    rt.set(x, [8]);
    rt.state[y].push(3);
    expect(JSON.parse(JSON.stringify(rt.state[y]))).toEqual([6, 7, 3]);
  });
});
