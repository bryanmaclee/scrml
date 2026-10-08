/**
 * meta-allow-list-s457.test.js — §22.12 closed allow-list for `^{}` bodies (S457).
 *
 * bryan S457: "On ^{} blocks … I don't want JS there. I would prefer scrml." §22.12
 * (S114 Approach C) already ratifies it: a `^{}` body is scrml-native + the enumerated
 * primitive set. The S134 enforcement was a DENY list of nine host names; anything not
 * on it reached the compiler's host realm through `new Function`. These tests pin the
 * replacement (compiler/src/meta-allow-list.ts):
 *
 *   1. ESCAPES REFUSED — every known route from a meta body to the host (`Function`
 *      via `.constructor` on ANY value, primitives included; `globalThis`; `Reflect`;
 *      `this`; `import()`; `eval`; `Symbol.for`; `Object.defineProperty` getters;
 *      computed keys; destructuring a constructor; the serializer's string->template
 *      rewrite; captured declarations) is E-META-001 AND is never executed (a
 *      host-side marker stays unset).
 *   2. LEGITIMATE BODIES UNCHANGED — locals, captured bindings, reflect / emit /
 *      emit.raw, meta.*, the closed builtin members, lambdas, loops.
 *   3. THE REALM — compile-time evaluation runs in a fresh `node:vm` context with no
 *      `process` / `Bun` / `require` (defence in depth; the allow-list is the authority).
 *   4. EMIT OUTPUT — re-parsed emit() output is held to source rules: `<script>` is
 *      E-SCRIPT-001, `_scrml_` names are E-NAME-COLLIDES-RESERVED-PREFIX, and logic /
 *      functions / `?{}` / components (which would bypass TS + RI) are refused.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { checkExecutedMetaJs, META_REFUSED_MEMBERS } from "../../src/meta-allow-list.ts";
import { runInMetaRealm } from "../../src/meta-eval.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-allow-list-s457");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });
beforeEach(() => { delete globalThis.__s457_pwn; });

let seq = 0;
function compileSource(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  return { errors: result.errors ?? [], outputs: result.outputs };
}
const codes = (errors) => errors.map((e) => e.code);
const meta001 = (errors) => errors.filter((e) => e.code === "E-META-001");

// ---------------------------------------------------------------------------
// 1. Escapes — compile-time bodies (these ran in the compiler process before S457)
// ---------------------------------------------------------------------------

const PWN = `globalThis.__s457_pwn = 1`;
const COMPILE_TIME_ESCAPES = [
  ["string constructor chain", `const F = "".constructor.constructor\n  F("${PWN}")()`],
  ["array method constructor", `const F = [].map.constructor\n  F("${PWN}")()`],
  ["emit.constructor (PA addendum)", `emit.constructor("${PWN}")()`],
  ["emit.raw.constructor", `emit.raw.constructor("${PWN}")()`],
  ["reflect.constructor", `reflect.constructor("${PWN}")()`],
  ["emit.call / bind chain", `const g = emit.call.bind(emit)\n  g("x")`],
  ["globalThis", `globalThis.__s457_pwn = 1`],
  ["Reflect", `Reflect.set(emit, "x", 1)`],
  ["eval", `eval("${PWN}")`],
  ["Function", `Function("${PWN}")()`],
  ["Symbol.for", `const s = Symbol.for("x")`],
  ["Object.defineProperty getter", `Object.defineProperty(emit, "raw", { get: emit })`],
  ["Object.getPrototypeOf", `const p = Object.getPrototypeOf(emit)`],
  ["builtin as a bare value", `const O = Object\n  const p = O.getPrototypeOf(emit)`],
  ["literal bracket constructor", `const F = emit["constructor"]\n  F("${PWN}")()`],
  ["computed key", `const k = "constr" + "uctor"\n  const F = emit[k]\n  F("${PWN}")()`],
  ["__proto__", `const p = emit.__proto__`],
  ["prototype", `const p = emit.prototype`],
  ["__lookupGetter__", `const g = emit.__lookupGetter__("x")`],
  ["process", `process.exit(3)`],
  ["Bun", `Bun.write("/tmp/x", "y")`],
  ["write to a primitive member", `emit.raw = reflect`],
  ["JS-host builtin Object", `const k = Object.keys({ a: 1 })`],
  ["JS-host builtin JSON", `const s = JSON.stringify(1)`],
  ["JS-host builtin Math", `const m = Math.max(1, 2)`],
  ["JS-host undefined", `const u = undefined`],
  ["runtime-only const destructure of constructor", `const { constructor: C } = emit\n  C("${PWN}")()`],
  ["destructured lambda parameter", `const f = ({ constructor: C }) => C\n  f(emit)("${PWN}")()`],
];

describe("S457 — compile-time escape attempts are E-META-001 and never run", () => {
  for (const [label, stmt] of COMPILE_TIME_ESCAPES) {
    test(label, () => {
      const { errors } = compileSource(`<program>\n^{\n  ${stmt}\n  emit("<p>ok</p>")\n}\n</program>\n`);
      expect(globalThis.__s457_pwn).toBeUndefined();
      expect(meta001(errors).length).toBeGreaterThan(0);
    });
  }

  test("every refused member name is refused on a primitive (emit / reflect / meta)", () => {
    for (const m of META_REFUSED_MEMBERS) {
      for (const prim of ["emit", "reflect", "emit.raw"]) {
        const { errors } = compileSource(`<program>\n^{\n  const x = ${prim}.${m}\n  emit("<p>x</p>")\n}\n</program>\n`);
        expect(meta001(errors).some((e) => e.message.includes(`'${m}'`))).toBe(true);
      }
    }
  });

  test("the message names the identifier and the allowed set", () => {
    const { errors } = compileSource(`<program>\n^{\n  const t = globalThis\n  emit("<p>x</p>")\n}\n</program>\n`);
    const hit = meta001(errors).find((e) => e.message.includes("'globalThis'"));
    expect(hit).toBeDefined();
    expect(hit.message).toContain("emit / emit.raw");
    expect(hit.message).toContain("meta.clearTimeout");
    expect(hit.message).toContain("§22.12");
  });

  test("a body the checker refused is not executed even when the refused name is harmless-looking", () => {
    // Before S457 meta-eval ran a body the checker had already refused.
    const { errors } = compileSource(`<program>\n^{\n  globalThis.__s457_pwn = 1\n  emit("<p>x</p>")\n}\n</program>\n`);
    expect(codes(errors)).toContain("E-META-001");
    expect(codes(errors)).not.toContain("E-META-EVAL-001");
    expect(globalThis.__s457_pwn).toBeUndefined();
  });
});

describe("S457 — runtime ^{} bodies are held to the same allow-list", () => {
  const RUNTIME = [
    ["meta.get.constructor", `const F = meta.get.constructor`, "constructor"],
    ["globalThis", `const w = globalThis`, "globalThis"],
    ["document", `const d = document.cookie`, "document"],
    ["window", `const w = window`, "window"],
    ["setInterval (use meta.interval)", `const id = setInterval(() => meta.emit("x"), 10)`, "setInterval"],
    ["meta member outside the 12", `meta.unknownThing()`, "meta.unknownThing"],
    ["destructured constructor (no evaluator backstop at runtime)", `const { constructor: K } = meta.get`, "constructor"],
    ["JSON", `meta.emit(JSON.stringify(1))`, "JSON"],
  ];
  for (const [label, stmt, name] of RUNTIME) {
    test(label, () => {
      const { errors } = compileSource(`<program>\n\${ <n> = 1 }\n<div>\n^{\n  ${stmt}\n  meta.set("n", 2)\n}\n</div>\n</program>\n`);
      expect(meta001(errors).some((e) => e.message.includes(`'${name}'`))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// The second reader — the executed text
// ---------------------------------------------------------------------------

describe("S457 — the executed text is checked, not only the scrml AST", () => {
  test("emit(\"…${x}…\") — the serializer turns it into a template literal; the interpolation is checked", () => {
    const { errors } = compileSource(`<program>\n^{\n  emit("<p>\${globalThis.__s457_pwn = 1}</p>")\n}\n</program>\n`);
    expect(globalThis.__s457_pwn).toBeUndefined();
    expect(meta001(errors).length).toBeGreaterThan(0);
  });

  test("a captured enclosing declaration is evaluated with the block and is checked", () => {
    const { errors } = compileSource(`<program>\n\${\n  const evil = "".constructor.constructor("${PWN}")()\n}\n^{\n  emit("<p>x</p>")\n}\n</program>\n`);
    expect(globalThis.__s457_pwn).toBeUndefined();
    const hit = meta001(errors).find((e) => e.message.includes("captures from its enclosing scope"));
    expect(hit).toBeDefined();
  });

  test("checkExecutedMetaJs refuses a body that escapes its wrapper", () => {
    const v = checkExecutedMetaJs(`(function (emit, reflect) {\n})(); globalThis.x = 1; (function () {\n})`, { captured: new Set(), typeNames: new Set() });
    expect(v.length).toBeGreaterThan(0);
  });

  test("checkExecutedMetaJs refuses `this`, import(), import.meta, tagged templates, classes, getters", () => {
    const ctx = { captured: new Set(), typeNames: new Set() };
    for (const body of [
      "const t = this;",
      "import('fs');",
      "const C = class {};",
      "emit`x`;",
      "const o = { get x() { return 1; } };",
      "const { constructor: C } = emit;",
      "for (const k in emit) { emit[k]; }",
    ]) {
      const v = checkExecutedMetaJs(`(function (emit, reflect) {\n"use strict";\n${body}\n})`, ctx);
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Legitimate bodies — unchanged
// ---------------------------------------------------------------------------

describe("S457 — legitimate meta bodies still compile", () => {
  test("locals, loops, lambdas, value methods, reflect, emit, emit.raw", () => {
    const src = `<program>
type Color:enum = { Red, Green }
\${ const title = "Palette" }
^{
  const info = reflect(Color)
  const names = info.variants.map(v => v.toLowerCase())
  const joined = names.join(", ")
  const n = names.length
  emit("<h2>" + title + "</h2>")
  for (const name of names) {
    emit("<p>" + name + " " + n + "</p>")
  }
  emit("<p>" + names.at(0) + "</p>")
  emit.raw("<pre>" + joined + "</pre>")
}
</program>
`;
    const { errors, outputs } = compileSource(src);
    expect(errors).toEqual([]);
    const html = [...outputs.values()].map((o) => o.html ?? "").join("");
    expect(html).toContain("<p>red 2</p>");
    expect(html).toContain("<h2>Palette</h2>");
  });

  test("runtime body using the meta API and captured bindings", () => {
    const src = `<program>
\${ <count> = 0 }
<div>
^{
  const id = meta.interval(1000, () => meta.set("count", meta.get("count") + 1))
  meta.cleanup(() => meta.clearInterval(id))
}
</div>
</program>
`;
    const { errors } = compileSource(src);
    expect(meta001(errors)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The realm
// ---------------------------------------------------------------------------

describe("S457 — compile-time evaluation realm (defence in depth)", () => {
  test("the realm has no process / Bun / require, even through a constructor chain", () => {
    const r = runInMetaRealm(
      `(function (emit, reflect) {\n"use strict";\nemit(("").constructor.constructor("return [typeof process, typeof Bun, typeof require, typeof globalThis.process].join()")())\n})`,
      new Map(),
    );
    expect(r.ok).toBe(true);
    expect(r.emitted[0].code).toBe("undefined,undefined,undefined,undefined");
  });

  test("emit is the realm's own function — its constructor does not reach the host", () => {
    const r = runInMetaRealm(
      `(function (emit, reflect) {\n"use strict";\nemit(String(emit.constructor("return typeof process")()))\n})`,
      new Map(),
    );
    expect(r.ok).toBe(true);
    expect(r.emitted[0].code).toBe("undefined");
  });

  test("reflect inside the realm returns the registry entry and throws E-META-003 on unknown", () => {
    const reg = new Map([["Color", { kind: "enum", name: "Color", variants: ["Red"] }]]);
    const ok = runInMetaRealm(`(function (emit, reflect) {\nemit(reflect("Color").variants[0])\n})`, reg);
    expect(ok).toEqual({ ok: true, emitted: [{ code: "Red", raw: false }] });
    const bad = runInMetaRealm(`(function (emit, reflect) {\nreflect("Nope")\n})`, reg);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("E-META-003");
  });
});

// ---------------------------------------------------------------------------
// 4. Emit output re-enters the source checks
// ---------------------------------------------------------------------------

describe("S457 — emit() output is held to the rules source is held to", () => {
  test("<script> in emit output is E-SCRIPT-001 (was emitted into the HTML verbatim)", () => {
    const { errors } = compileSource(`<program>\n^{ emit("<div><script>alert(1)</script></div>") }\n</program>\n`);
    expect(codes(errors)).toContain("E-SCRIPT-001");
  });

  test("a `_scrml_` declaration in emit output is E-NAME-COLLIDES-RESERVED-PREFIX", () => {
    const { errors } = compileSource(`<program>\n^{ emit("<div>" + "$" + "{ const _scrml_x = 1 }</div>") }\n</program>\n`);
    expect(codes(errors)).toContain("E-NAME-COLLIDES-RESERVED-PREFIX");
  });

  test("an emitted server function (would bypass route inference) is refused", () => {
    const { errors, outputs } = compileSource(`<program>\n^{ emit("<div>" + "$" + "{ server function nuke() { return 1 } }</div>") }\n</program>\n`);
    expect(codes(errors)).toContain("E-META-EVAL-002");
  });

  test("an emitted component reference is refused", () => {
    const { errors } = compileSource(`<program>\n^{ emit("<div><Widget/></div>") }\n</program>\n`);
    expect(codes(errors)).toContain("E-META-EVAL-002");
  });

  test("plain HTML (incl. pre / code / thead / meta / svg) is admitted unchanged", () => {
    const { errors } = compileSource(`<program>\n^{ emit("<table><thead><tr><th>a</th></tr></thead></table><pre><code>x</code></pre><svg><circle r=\\"1\\"/></svg>") }\n</program>\n`);
    expect(errors).toEqual([]);
  });
});
