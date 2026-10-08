/**
 * meta-review-s458.test.js — the S458 differential review of the `^{}` allow-list landing.
 *
 * change-id: s458-meta-allow-list-land (fix round). Each block pins one review finding:
 *   F1  a declared TYPE name in value position resolved as a local in both readers, but
 *       nothing binds a value under it — `type Function:enum` + `Function("…")()` reached
 *       the host `Function` (compile-time realm AND client). A type name is now admitted
 *       only as the argument of `reflect(T)`.
 *   F1b a microtask queued in the realm ran on the host loop after the bounded call
 *       returned — the context now uses `microtaskMode: "afterEvaluate"`.
 *   F2  a block-scoped declaration (`while (…) { const window = 1 }`) counted as a module
 *       capture, admitting the GLOBAL `window` in a runtime body.
 *   F3  the emit() gate admitted logic attribute values (`onclick=${…}`, `title=${…}`,
 *       `if=…`, unquoted refs); §22.4.1 says "plain attribute values".
 *   F4  every earlier const/let was prepended to a compile-time body, used or not.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { runInMetaRealm } from "../../src/meta-eval.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-review-s458");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  const out = [...(result.outputs?.values?.() ?? [])];
  return {
    codes: errors.map((e) => e.code),
    messages: errors.map((e) => e.message),
    html: out.map((o) => o.html ?? "").join("\n"),
    clientJs: out.map((o) => o.clientJs ?? "").join("\n"),
  };
}

const DECL = {
  enum: (n) => `type ${n}:enum = { A, B }`,
  struct: (n) => `type ${n}:struct = { a: number }`,
  union: (n) => `type ${n}:union = Admin | Editor`,
};

describe("S458 F1 — a type name in value position is not a binding", () => {
  for (const kind of Object.keys(DECL)) {
    test(`compile-time: \`${DECL[kind]("Function")}\` + Function("…")() is E-META-001 and never runs`, () => {
      globalThis.__s458_f1 = undefined;
      const r = compile(`${DECL[kind]("Function")}\n^{\n  const f = Function("globalThis.__s458_f1 = 1; return 1")\n  emit("<p>" + f() + "</p>")\n}\n`);
      expect(r.codes).toContain("E-META-001");
      expect(r.messages.some((m) => m.includes("'Function' is not available"))).toBe(true);
      expect(globalThis.__s458_f1).toBeUndefined();
    });

    test(`runtime: \`${DECL[kind]("Function")}\` + Function("window.PWNED=…")() is E-META-001`, () => {
      const r = compile(`${DECL[kind]("Function")}\n<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  Function("window.PWNED = 1")()\n  meta.emit("<p>r</p>")\n}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
      expect(r.messages.some((m) => m.includes("'Function' is not available"))).toBe(true);
    });
  }

  for (const name of ["Reflect", "Promise", "Proxy", "Symbol", "Object", "Array"]) {
    test(`a type named ${name} does not reopen the host ${name} (compile-time and runtime)`, () => {
      const ct = compile(`${DECL.union(name)}\n^{\n  const v = ${name}\n  emit("<p>x</p>")\n}\n`);
      expect(ct.messages.some((m) => m.includes(`'${name}' is not available`))).toBe(true);
      const rt = compile(`${DECL.union(name)}\n<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  const v = ${name}\n  meta.emit("<p>r</p>")\n}\n</div>\n</program>\n`);
      expect(rt.messages.some((m) => m.includes(`'${name}' is not available`))).toBe(true);
    });
  }

  test("reflect(T) on a type named after a global stays legal — its argument is a type NAME", () => {
    const r = compile(`type Function:enum = { A, B }\n^{\n  emit("<p>" + reflect(Function).variants.length + "</p>")\n}\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<p>2</p>");
  });
});

describe("S458 F1b — a realm microtask cannot outlive the bounded call", () => {
  test("a queued promise reaction that never ends is stopped at the limit (the realm's own Promise)", () => {
    const t = Date.now();
    const r = runInMetaRealm(`(function (emit, reflect) {\n"use strict";\nPromise.resolve(1).then(() => { while (true) {} });\n})`, new Map(), 300);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("did not finish within 300 ms");
    expect(Date.now() - t).toBeLessThan(5000);
  });

  test("a promise reaction runs inside the call, so its emit() is collected", () => {
    const r = runInMetaRealm(`(function (emit, reflect) {\n"use strict";\nPromise.resolve(1).then(() => emit("<p>late</p>"));\n})`, new Map(), 2000);
    expect(r.ok).toBe(true);
  });
});

describe("S458 F2 — captured names are the names in scope at the ^{} site", () => {
  test("a block-scoped `const window` in a while body does not admit the global window", () => {
    const r = compile(`<program>\n<x> = 0\n\${\n  let go = true\n  while (go) {\n    const window = 1\n    go = false\n  }\n}\n<div>\n^{\n  meta.get("x")\n  window.eval("window.PWNED = 1")\n  meta.emit("<p>r</p>")\n}\n</div>\n</program>\n`);
    expect(r.messages.some((m) => m.includes("'window' is not available"))).toBe(true);
    expect(r.clientJs).not.toContain("window: window");
  });

  test("a module-scope declaration is still captured", () => {
    const r = compile(`<program>\n<x> = 0\n\${\n  const label = "hi"\n}\n<div>\n^{\n  meta.get("x")\n  meta.emit("<p>" + label + "</p>")\n}\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
  });
});

describe("S458 F3 — emit() output admits plain attribute values only (§22.4.1)", () => {
  const D = "$";
  const refused = {
    "onclick=${…} logic": `<program>\n<count> = 0\n^{\n  emit.raw("<button onclick=${D}{ nosuchFunction(@count) }>b</button>")\n}\n</program>\n`,
    "title=${ assignment }": `<program>\n^{\n  emit.raw("<p title=${D}{ window.PWNED = 1 }>t</p>")\n}\n</program>\n`,
    "if=<call>": `<program>\n^{\n  emit.raw("<p if=window.eval('1')>t</p>")\n}\n</program>\n`,
    "unquoted onclick=name": `<program>\n^{\n  emit("<button onclick=save>b</button>")\n}\n</program>\n`,
    "quoted literal carrying ${…}": `<program>\n^{\n  emit.raw("<p class=\\"a ${D}{ window.PWNED = 1 }\\">t</p>")\n}\n</program>\n`,
  };
  for (const [what, src] of Object.entries(refused)) {
    test(`${what} is E-META-EVAL-002`, () => {
      const r = compile(src);
      expect(r.codes).toContain("E-META-EVAL-002");
      expect(r.html).not.toContain("PWNED");
    });
  }

  test("double-quoted literal values and bare boolean attributes are admitted", () => {
    const r = compile(`<program>\n^{\n  emit("<p class=\\"a\\" id=\\"b\\" hidden>t</p>")\n}\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain('class="a"');
  });
});

describe("S458 F4 — a compile-time body captures only the declarations it reads", () => {
  test("an unread `const n = double(4)` is not prepended (and stays in the client)", () => {
    const r = compile(`<program>\n\${\n  function double(v) { return v * 2 }\n  const n = double(4)\n}\n^{\n  emit("<p>x</p>")\n}\n<p>\${n}</p>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toMatch(/const n = /);
  });

  test("an unread `const m = Math.max(1, 2)` is not prepended", () => {
    const r = compile(`<program>\n\${\n  const m = Math.max(1, 2)\n}\n^{\n  emit("<p>x</p>")\n}\n<p>\${m}</p>\n</program>\n`);
    expect(r.codes).toEqual([]);
  });

  test("a READ declaration is still captured and held to the allow-list", () => {
    const r = compile(`<program>\n\${\n  const m = Math.max(1, 2)\n}\n^{\n  emit("<p>" + m + "</p>")\n}\n</program>\n`);
    expect(r.codes).toContain("E-META-001");
  });

  test("capture is transitive: b reads a; an unrelated declaration is left alone", () => {
    const r = compile(`<program>\n\${\n  const a = 2\n  const b = a * 3\n  const unrelated = Math.max(1, 2)\n}\n^{\n  emit("<p>" + b + "</p>")\n}\n<p>\${unrelated}</p>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<p>6</p>");
    expect(r.clientJs).toContain("const unrelated = Math.max(1, 2)");
  });
});
