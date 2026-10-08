/**
 * S458 slice 2a — §53 refinement obligations at every write / binding position.
 *
 * The type-system stage decides, once, that a value written into a refined
 * declared type is judged (compiler/src/refinement-obligations.ts), and puts the
 * obligation INTO THE AST: a body-prepended guard for every refined parameter,
 * a stamp on every refined return / reassignment, a placeholder call for every
 * refined assignment expression. Every emitter then emits the check by
 * construction. Positions (gap g-refinement-checks-absent-in-n-positions-s457):
 *   (1) reassignment — `@cell = v`, `x = v`, `@n += k`, `obj.field = v`
 *   (2) struct fields — literal (static) and runtime; struct-typed params
 *   (3) `const` (top level and in a function)
 *   (6) a server function's refined return (R2: a server failure carries no value)
 *   (7) library / tool function parameters
 *   (8) a literal call argument (static zone)
 *   (9) a nested worker <program> function parameter
 *   (11) a struct-typed SERVER parameter (field by field, 400)
 *   + nested-function parameters, unions with a refined member, worker helpers (F3)
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { compileScrml } from "../../src/api.js";
import { _scrml_url_shape_ok } from "../../src/runtime-url-guard.js";
import { validateEmittedArtifact } from "../../src/codegen/validate-emit.ts";

const BAD = "javascript:alert(1)";
const GOOD = "https://scrml.dev/";

function compileSource(source, label, mode) {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s458-oblig-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {}, ...(mode ? { mode } : {}) });
  const read = (name) => {
    const p = resolve(outDir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")),
    clientJs: read("app.client.js"),
    serverJs: read("app.server.js"),
    libJs: read("app.js"),
    workerJs: read("app-wk.worker.js"),
    path: (n) => resolve(outDir, n),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
const codes = (o) => o.errors.map((e) => e.code);

/** One emitted client function, run with the real url judge and a recording cell store. */
function clientFn(js, name) {
  const head = js.match(new RegExp(`function (_scrml_${name}_\\d+)\\(([^)]*)\\) \\{`));
  if (!head) throw new Error(`no ${name} in client.js`);
  let i = head.index + head[0].length, depth = 1;
  for (; i < js.length && depth > 0; i++) { if (js[i] === "{") depth++; else if (js[i] === "}") depth--; }
  const cells = new Map();
  // S458 2a-fix F3 — struct judges are hoisted functions; carry their definitions along.
  const defs = [];
  for (const m of js.matchAll(/function _scrml_judge_[A-Za-z0-9_]+\([^)]*\) \{/g)) {
    let j = m.index + m[0].length, d = 1;
    for (; j < js.length && d > 0; j++) { if (js[j] === "{") d++; else if (js[j] === "}") d--; }
    defs.push(js.slice(m.index, j));
  }
  const f = new Function("_scrml_url_shape_ok", "_scrml_cs_reactive_set", "_scrml_cs_reactive_get",
    `${defs.join("\n")}\n${js.slice(head.index, i)}; return ${head[1]};`)(
    _scrml_url_shape_ok, (k, v) => cells.set(k, v), (k) => cells.get(k));
  f.cells = cells;
  return f;
}
const refused = (f, ...args) => {
  try { f(...args); return false; } catch (e) { return String(e.message).includes("E-CONTRACT-001-RT"); }
};
const csrf = { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" };
async function post(out, body) {
  const mod = await import(out.path("app.server.js") + "?" + Math.random());
  const route = mod.routes.find((r) => r.method === "POST");
  try {
    const res = await mod.fetch(new Request("http://localhost" + route.path, { method: "POST", headers: csrf, body: JSON.stringify(body) }));
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { thrown: String(e.message) };
  }
}
const prog = (body) => `<program>\n\${\n${body}\n}\n<p>x</p>\n</program>\n`;

describe("(1) reassignment of a refined binding", () => {
  test("`@cell = v`, `x = v`, `@n += k`, `l.u = v` — refused at runtime", () => {
    const out = compileSource(`<program>
<u>: string(url) = "${GOOD}"
<n>: number(<10) = 1
\${
  type Link:struct = { u: string(url) }
  function setCell(v) {
    @u = v
  }
  function setLocal(v) {
    let q: string(url) = "${GOOD}"
    q = v
    return q
  }
  function bump(k) {
    @n += k
  }
  function setField(v) {
    let l: Link = { u: "${GOOD}" }
    l.u = v
    return l
  }
}
<p>\${@u}\${@n}</p>
</program>
`, "reassign");
    try {
      expect(out.errors).toHaveLength(0);
      // S458 2a-fix F2 — a CELL write is judged by the runtime setter the cell
      // registers its judge with (executed: conformance refinement/reassign-cell-*
      // and docs/changes/s458-refinement-2a-fix/repro/grid.mjs); no inline check.
      expect(out.clientJs).toMatch(/_scrml_cs_refine_register\("u", \{ ok: \(v\) => \(typeof v === "string" && _scrml_url_shape_ok\(v\)\) \}/);
      expect(out.clientJs).toMatch(/_scrml_cs_refine_register\("n", /);
      expect(refused(clientFn(out.clientJs, "setLocal"), BAD)).toBe(true);
      expect(refused(clientFn(out.clientJs, "setField"), BAD)).toBe(true);
    } finally {
      out.cleanup();
    }
  });

  test("a literal reassignment is decided at compile time (E-CONTRACT-001)", () => {
    const cases = [
      `<u>: string(url) = "${GOOD}"\n\${\n  function f() {\n    @u = "${BAD}"\n  }\n}`,
      `\${\n  function f() {\n    let q: string(url) = "${GOOD}"\n    q = "${BAD}"\n    return q\n  }\n}`,
      `\${\n  type Link:struct = { u: string(url) }\n  function f() {\n    let l: Link = { u: "${GOOD}" }\n    l.u = "${BAD}"\n    return l\n  }\n}`,
    ];
    for (const body of cases) {
      const out = compileSource(`<program>\n${body}\n<p>x</p>\n</program>\n`, "reassign-lit");
      try {
        expect([body.slice(0, 40), codes(out).includes("E-CONTRACT-001")]).toEqual([body.slice(0, 40), true]);
      } finally {
        out.cleanup();
      }
    }
  });
});

describe("(2) struct fields", () => {
  test("a struct literal's refined fields: runtime refusal and compile-time refusal", () => {
    const out = compileSource(prog(`  type Link:struct = { u: string(url), n: number(>0) }
  function mk(v, k) {
    const l: Link = { u: v, n: k }
    return l
  }
  function take(l: Link) {
    return l.u
  }`), "struct");
    try {
      expect(out.errors).toHaveLength(0);
      const mk = clientFn(out.clientJs, "mk");
      expect([refused(mk, GOOD, 1), refused(mk, BAD, 1), refused(mk, GOOD, -1)]).toEqual([false, true, true]);
      const take = clientFn(out.clientJs, "take");
      expect([refused(take, { u: GOOD, n: 1 }), refused(take, { u: BAD, n: 1 }), refused(take, { n: 1 }), refused(take, null)]).toEqual([false, true, true, true]);
    } finally {
      out.cleanup();
    }
    const bad = compileSource(prog(`  type Link:struct = { u: string(url), n: number(>0) }
  function mk() {
    const l: Link = { u: "${BAD}", n: 1 }
    return l
  }`), "struct-lit");
    try {
      expect(codes(bad)).toContain("E-CONTRACT-001");
    } finally {
      bad.cleanup();
    }
  });
});

describe("(3) const", () => {
  test("a refined `const` is judged, in a function and at top level", () => {
    const out = compileSource(prog(`  function pick(v) {
    const q: string(url) = v
    return q
  }
  function bad() {
    return "${BAD}"
  }
  const X: string(url) = bad()`), "const");
    try {
      expect(out.errors).toHaveLength(0);
      expect(refused(clientFn(out.clientJs, "pick"), BAD)).toBe(true);
      expect(refused(clientFn(out.clientJs, "pick"), GOOD)).toBe(false);
      expect(out.clientJs).toMatch(/_scrml_url_shape_ok\(_scrml__?scrml_chk_X/);
    } finally {
      out.cleanup();
    }
  });
});

describe("(6) refined returns", () => {
  test("a server function's refined return refuses; the failure report carries no value (R2)", async () => {
    const out = compileSource(`<program>
\${
  server function make(v) -> string(url) {
    return v
  }
}
<button onclick=make("${GOOD}")>go</button>
</program>
`, "srv-return");
    try {
      expect(out.errors).toHaveLength(0);
      const r = await post(out, { v: BAD });
      expect(r.thrown).toContain("E-CONTRACT-001-RT");
      expect(r.thrown).not.toContain(BAD); // R2 — no value echo from the server
      expect((await post(out, { v: GOOD })).status).toBe(200);
    } finally {
      out.cleanup();
    }
  });

  test("a nested function's return is judged by ITS type, not its parent's", () => {
    const out = compileSource(prog(`  function outer(v) -> string(url) {
    function inner(k) {
      return k
    }
    let n = inner(5)
    return v
  }`), "nested-ret");
    try {
      expect(out.errors).toHaveLength(0);
      const outer = clientFn(out.clientJs, "outer");
      expect(refused(outer, GOOD)).toBe(false); // inner(5) returns 5 — not judged as string(url)
      expect(refused(outer, BAD)).toBe(true);
    } finally {
      out.cleanup();
    }
  });
});

describe("(7) library and tool function parameters", () => {
  test("library mode: an exported function's refined parameter is checked", async () => {
    const out = compileSource(prog(`  export function take(u: string(url)) {
    return u
  }`), "lib", "library");
    try {
      expect(out.errors).toHaveLength(0);
      const mod = await import(out.path("app.js") + "?" + Math.random());
      expect(mod.take(GOOD)).toBe(GOOD);
      expect(() => mod.take(BAD)).toThrow("E-CONTRACT-001-RT");
    } finally {
      out.cleanup();
    }
  });

  test("tool: a refined parameter refuses a value from argv (non-zero exit)", () => {
    const out = compileSource(`<program kind="tool" lang="js">
    function take(u: string(url)): string {
        return u
    }
    function main(args: string[]): number {
        println(take(args[0]))
        return 0
    }
</program>
`, "tool");
    try {
      const ok = spawnSync("bun", [out.path("app.js"), GOOD], { encoding: "utf8" });
      const bad = spawnSync("bun", [out.path("app.js"), BAD], { encoding: "utf8" });
      expect([ok.status, ok.stdout.trim()]).toEqual([0, GOOD]);
      expect(bad.status).not.toBe(0);
      expect(bad.stdout).not.toContain(BAD);
    } finally {
      out.cleanup();
    }
  });
});

describe("(8) a literal call argument", () => {
  test("is decided at compile time", () => {
    const bad = compileSource(`<program>\n\${\n  function take(u: string(url)) {\n    return u\n  }\n}\n<p>\${take("${BAD}")}</p>\n</program>\n`, "arg-bad");
    const ok = compileSource(`<program>\n\${\n  function take(n: number(>0)) {\n    return n\n  }\n}\n<p>\${take(3)}</p>\n</program>\n`, "arg-ok");
    try {
      expect(codes(bad)).toContain("E-CONTRACT-001");
      expect(ok.errors).toHaveLength(0);
    } finally {
      bad.cleanup();
      ok.cleanup();
    }
  });
});

describe("(9) nested worker <program> function parameter + worker helpers (F3)", () => {
  test("the worker bundle judges the parameter; `==` on structs works in a worker", () => {
    const out = compileSource(`<program>
<out> = ""
<program name="wk">
  \${
    function check(u: string(url)) {
      return u
    }
    function same(a, b) {
      return a == b
    }
    when message(data) {
      send(same({ x: 1 }, { x: 1 }) && check(data) == data)
    }
  }
</program>
<p>\${@out}</p>
</program>
`, "worker");
    try {
      expect(out.errors).toHaveLength(0);
      const posted = [];
      const self = { postMessage: (m) => posted.push(m), onmessage: null };
      new Function("self", out.workerJs)(self);
      self.onmessage({ data: { id: 1, data: GOOD } });
      expect(posted).toEqual([{ replyTo: 1, data: true }]);
      expect(() => self.onmessage({ data: { id: 2, data: BAD } })).toThrow("E-CONTRACT-001-RT");
    } finally {
      out.cleanup();
    }
  });
});

describe("(11) a struct-typed SERVER parameter is judged field by field", () => {
  test("400 for a bad field or a missing field, 200 for a valid struct", async () => {
    const out = compileSource(`<program>
\${
  type Link:struct = { u: string(url), n: number(>0) }
  server function save(l: Link) {
    return l.n
  }
}
<button onclick=save({ u: "${GOOD}", n: 1 })>save</button>
</program>
`, "srv-struct");
    try {
      expect(out.errors).toHaveLength(0);
      expect((await post(out, { l: { u: BAD, n: 1 } })).status).toBe(400);
      expect((await post(out, { l: { u: GOOD, n: -1 } })).status).toBe(400);
      expect((await post(out, { l: { u: GOOD } })).status).toBe(400);
      expect((await post(out, { l: "x" })).status).toBe(400);
      expect((await post(out, { l: { u: GOOD, n: 2 } })).status).toBe(200);
    } finally {
      out.cleanup();
    }
  });
});

describe("nested-function parameters and unions", () => {
  test("a nested function's refined parameter is checked", () => {
    const out = compileSource(prog(`  function outer(v) {
    function inner(u: string(url)) {
      return u
    }
    return inner(v)
  }`), "nested-param");
    try {
      expect(out.errors).toHaveLength(0);
      expect(refused(clientFn(out.clientJs, "outer"), BAD)).toBe(true);
      expect(refused(clientFn(out.clientJs, "outer"), GOOD)).toBe(false);
    } finally {
      out.cleanup();
    }
  });

  test("a union with a refined member: the value satisfies one member", () => {
    const out = compileSource(prog(`  function take(v: number(>0) | string) {
    return v
  }`), "union");
    try {
      expect(out.errors).toHaveLength(0);
      const take = clientFn(out.clientJs, "take");
      expect([refused(take, 3), refused(take, "x"), refused(take, -3), refused(take, true)]).toEqual([false, false, true, true]);
    } finally {
      out.cleanup();
    }
  });
});

describe("F2 — an unlowered obligation cannot ship", () => {
  test("the §2.2.1 emit gate refuses the refine placeholder in any artifact", () => {
    const err = validateEmittedArtifact({ name: "x.js", contents: "const a = __scrml_refine_k0123456789abcdef__(b);" });
    expect(err).not.toBeNull();
  });

  test("library mode: a refined function the emitter can only re-print as TEXT is refused, not shipped unchecked", () => {
    // A map read keeps a library function off the structural path (emit-library); the
    // raw-text path strips the parameter's type and every check with it.
    const out = compileSource(prog(`  export function f(u: string(url)) {
    let m = ["a": 1]
    return m["a"]
  }`), "lib-raw", "library");
    try {
      expect(codes(out)).toContain("E-CODEGEN-INVALID-LOGIC");
      expect(out.errors.map((e) => e.message).join("\n")).toContain("refinement checks");
    } finally {
      out.cleanup();
    }
  });

  test("an author cannot spell the placeholder (§47.1.1 reservation)", () => {
    const out = compileSource(prog(`  function f(v) {
    return __scrml_refine__(v)
  }`), "author-ph");
    try {
      expect(codes(out)).toContain("E-NAME-COLLIDES-RESERVED-PREFIX");
    } finally {
      out.cleanup();
    }
  });
});
