/**
 * meta-final-s458.test.js — the S458 final differential review of the `^{}` allow-list
 * branch (s458-meta-final). Every runtime assertion here EXECUTES the shipped runtime text
 * (SCRML_RUNTIME) together with the compiled client.js of a real compile.
 *
 * F4 — §22.5.1 `meta.get(varName)` "Read a reactive `@variable` by name". A cell lives in
 *      the store under its chunk-namespaced key (`<token>$name`); meta.get / meta.set /
 *      meta.subscribe read the RAW name, so every author cell read as `undefined`. The
 *      chunk cell-scope wrapper now hands the runtime the chunk's own key fn
 *      (`_scrml_cs_key`) — the same resolver every compiled cell read goes through.
 *      §22.5.1 `meta.interval(ms, callback)` — `(number, fn)`: a non-number / NaN /
 *      Infinity / negative `ms` is refused (was a 0 ms busy interval for `undefined`).
 *      §22.5.2 per-run `meta.bindings` snapshot — see meta-review-r3-s458.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-final-s458");
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
    clientJs: out.map((o) => o.clientJs ?? "").join("\n"),
  };
}

/**
 * Run the real runtime + a compiled client.js in one function scope. `meta.emit` output
 * is captured (the runtime's `_scrml_meta_emit` is a mutable function binding);
 * `setInterval` / `setTimeout` are recorded. `then` runs after load, with `key(name)`
 * mapping an author cell name to its store key.
 */
function run(clientJs, then = "") {
  const token = (clientJs.match(/chunk cell scope \((\w+)\)/) ?? [])[1] ?? "";
  const body = clientJs.replace(/^\/\/ Requires:.*$/m, "");
  // eslint-disable-next-line no-new-func
  const f = new Function("setInterval", "setTimeout", "__log", `
    ${SCRML_RUNTIME}
    const out = [];
    _scrml_meta_emit = (id, v) => out.push(String(v));
    const key = (n) => ${JSON.stringify(token ? token + "$" : "")} + n;
    ${body}
    ${then}
    return out;
  `);
  const timers = [];
  const errors = [];
  const fake = (kind) => (fn, ms) => { timers.push({ kind, ms }); return timers.length; };
  const saved = console.error;
  console.error = (...a) => errors.push(a.map(String).join(" "));
  let out;
  try { out = f(fake("interval"), fake("timeout"), () => {}); } finally { console.error = saved; }
  return { out, timers, errors, token };
}

describe("S458 final F4 — meta.get / meta.set / meta.subscribe resolve an author cell name", () => {
  test("meta-proto-cell-name-pos: meta.get(\"constructor\") reads the cell's real value 0", () => {
    const src = readFileSync(resolve(import.meta.dir, "../../../conformance/cases/meta/meta-proto-cell-name-pos/case.scrml"), "utf8");
    const r = compile(src);
    expect(r.codes).toEqual([]);
    const { out, errors, token } = run(r.clientJs);
    expect(token).not.toBe("");
    expect(out).toEqual(["<p>0</p>"]);
    expect(errors).toEqual([]);
  });

  test("meta.get establishes a dependency on the namespaced key: a cell change re-runs the effect", () => {
    const r = compile(`<program>\n<count> = 1\n<div>\n^{\n  meta.emit("<p>" + meta.get("count") + "</p>")\n}\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    const { out } = run(r.clientJs, `_scrml_reactive_set(key("count"), 7);`);
    expect(out).toEqual(["<p>1</p>", "<p>7</p>"]);
  });

  test("meta.set writes the author cell the compiled code reads", () => {
    const r = compile(`<program>\n<count> = 1\n<div>\n^{\n  meta.set("count", 3)\n}\n<p>\${@count}</p>\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    const { out } = run(r.clientJs, `out.push("store:" + _scrml_reactive_get(key("count")));`);
    expect(out).toEqual(["store:3"]);
  });

  test("meta.subscribe fires on a change to the author cell", () => {
    const r = compile(`<program>\n<count> = 1\n<div>\n^{\n  meta.subscribe("count", () => { meta.emit("changed") })\n}\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    const { out } = run(r.clientJs, `_scrml_reactive_set(key("count"), 2);`);
    expect(out).toEqual(["changed"]);
  });

  test("meta-cleanup-001: meta.interval(meta.get(\"interval\"), …) ticks at 1000 ms", () => {
    const src = readFileSync(resolve(import.meta.dir, "../../../samples/compilation-tests/gauntlet-s20-meta/meta-cleanup-001.scrml"), "utf8");
    const r = compile(src);
    expect(r.codes).toEqual([]);
    const { timers, errors } = run(r.clientJs);
    expect(timers).toEqual([{ kind: "interval", ms: 1000 }]);
    expect(errors).toEqual([]);
  });
});

describe("S458 final F4 — meta timers refuse a delay that is not a finite number >= 0 (§22.5.1)", () => {
  function timerRun(msExpr) {
    const timers = [];
    const errors = [];
    const fake = (kind) => (fn, ms) => { timers.push({ kind, ms }); return 1; };
    // eslint-disable-next-line no-new-func
    const f = new Function("setInterval", "setTimeout", `
      ${SCRML_RUNTIME}
      _scrml_meta_effect("s", (meta) => { meta.interval(${msExpr}, () => {}); meta.timeout(${msExpr}, () => {}); });
    `);
    const saved = console.error;
    console.error = (...a) => errors.push(a.map(String).join(" "));
    try { f(fake("interval"), fake("timeout")); } finally { console.error = saved; }
    return { timers, errors };
  }
  for (const bad of ["undefined", "NaN", "Infinity", "-1", "\"1000\"", "null"]) {
    test(`ms = ${bad} is refused (no host timer, an error is logged)`, () => {
      const { timers, errors } = timerRun(bad);
      expect(timers).toEqual([]);
      expect(errors.join("\n")).toContain("ms must be a finite number >= 0");
    });
  }
  for (const ok of ["0", "1000", "2.5"]) {
    test(`ms = ${ok} is admitted`, () => {
      const { timers, errors } = timerRun(ok);
      expect(timers).toEqual([{ kind: "interval", ms: Number(ok) }, { kind: "timeout", ms: Number(ok) }]);
      expect(errors).toEqual([]);
    });
  }
});

describe("S458 final F3 — a compile-time ^{} in a logic body is refused, never silently dropped", () => {
  // §22.4: "The compiler SHALL evaluate compile-time meta blocks during compilation and
  // inline the result." emit() output is markup; a ${} statement list / branch / loop /
  // function has no markup position, and the spliced markup was dropped by codegen with
  // no diagnostic (base: emitted as a runtime effect calling a free `emit`).
  const cases = {
    "if branch (the review repro)": `\${ const tag = "T"\n  if (@n > 0) { ^{ emit("<p>" + tag + "</p>") } } else { ^{ meta.emit("<p>else</p>") } } }`,
    "else branch": `\${ if (@n > 0) { log("x") } else { ^{ emit("<p>e</p>") } } }`,
    "top of a logic block": `\${ ^{ emit("<p>X</p>") } }`,
    "for-of body": `\${ for (const i of [1, 2]) { ^{ emit("<p>i</p>") } } }`,
    "function body": `\${ function go() { ^{ emit("<p>f</p>") } } }`,
  };
  for (const [where, logic] of Object.entries(cases)) {
    test(`refused in a ${where} (E-META-EVAL-002 naming the cause)`, () => {
      const r = compile(`<program>\n<n> = 1\n<div>\n${logic}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-EVAL-002");
      expect(r.messages.join("\n")).toContain("emits markup from inside a ${} logic block");
    });
  }

  test("a compile-time ^{} in markup position still splices (top level and inside an element)", () => {
    const r = compile(`<program>\n<x> = 0\n^{ emit("<p>top</p>") }\n<div>\n^{ emit("<i>in</i>") }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
  });

  test("a compile-time ^{} in a logic body that emits nothing is not refused", () => {
    const r = compile(`<program>\n<n> = 1\n<div>\n\${ if (@n > 0) { ^{ emit("  ") } } }\n</div>\n</program>\n`);
    expect(r.codes).not.toContain("E-META-EVAL-002");
  });

  test("the runtime ^{} in an else branch runs when the branch is taken (meta.emit)", () => {
    const r = compile(`<program>\n<n> = 0\n<div>\n\${ if (@n > 0) { log("pos") } else { ^{ meta.emit("<p>else</p>") } } }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    const { out, errors } = run(r.clientJs);
    expect(out).toEqual(["<p>else</p>"]);
    expect(errors).toEqual([]);
  });

  test("a declaration captured by a compile-time ^{} stays in the client when a runtime ^{} binds it in meta.bindings", () => {
    const r = compile(`<program>\n<x> = 0\n\${ const tag = "T" }\n^{ emit("<p>" + tag + "</p>") }\n<div>\n^{ meta.emit("<b>" + meta.get("x") + "</b>") }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain("tag: tag");
    expect(r.clientJs).toContain(`const tag = "T"`);
    const { out, errors } = run(r.clientJs);
    expect(out).toEqual(["<b>0</b>"]);
    expect(errors).toEqual([]);
  });
});

describe("S458 final F1 — a meta primitive is only ever called directly", () => {
  // §22.12: "A primitive's member outside this list (`emit.call`, `meta.unknown`) is outside
  // the allow-list." Closed by construction: no value read, alias, destructure or member.
  const RUNTIME_REFUSED = [
    `meta.emit.apply(not, ["<p>a</p>"])`,
    `const g = meta.get.bind(not)`,
    `const t = meta.types.foo`,
    `const s = meta.set.toString()`,
    `const e = meta.emit\n  e.call(not, "<p>x</p>")`,
    `const { emit } = meta`,
    `const m = meta`,
    `const n = new meta.emit("x")`,
    `meta.emit.raw("x")`,
    `const k = meta["get"]`,
  ];
  for (const stmt of RUNTIME_REFUSED) {
    test(`runtime: ${stmt.split("\n")[0]} → E-META-001`, () => {
      const r = compile(`<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  ${stmt}\n}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
    });
  }
  const COMPILE_TIME_REFUSED = [
    `emit.call(not, "<p>a</p>")`,
    `const e = emit\n  e("<p>x</p>")`,
    `const n = reflect.name\n  emit("<p>a</p>")`,
  ];
  for (const stmt of COMPILE_TIME_REFUSED) {
    test(`compile-time: ${stmt.split("\n")[0]} → E-META-001`, () => {
      const r = compile(`<program>\n<div>\n^{\n  ${stmt}\n}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
    });
  }
  test("controls: direct calls and the data members compile", () => {
    for (const stmt of [
      `meta.emit(meta.get("x"))`,
      `meta.emit("<p>" + meta.scopeId.length + "</p>")`,
      `const b = meta.bindings`,
      `const r = meta.types.reflect("X")`,
      `meta.interval(1000, () => { meta.emit("t") })`,
    ]) {
      const r = compile(`<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  ${stmt}\n}\n</div>\n</program>\n`);
      expect(r.codes).toEqual([]);
    }
    const ct = compile(`<program>\n<div>\n^{\n  emit("<p>a</p>")\n  emit.raw("<p>b</p>")\n}\n</div>\n</program>\n`);
    expect(ct.codes).toEqual([]);
  });
});

describe("S458 final F2 — caller / arguments / callee refused; runtime bodies are strict", () => {
  for (const m of ["caller", "arguments", "callee"]) {
    test(`runtime: f.${m} → E-META-001`, () => {
      const r = compile(`<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  const f = () => 1\n  meta.emit("<p>" + f.${m} + "</p>")\n}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
      expect(r.messages.join("\n")).toContain(`member '${m}'`);
    });
    test(`compile-time: f.${m} → E-META-001`, () => {
      const r = compile(`<program>\n<div>\n^{\n  const f = () => 1\n  emit("<p>" + f.${m} + "</p>")\n}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
    });
  }
  test("the emitted runtime effect body opens with a \"use strict\" directive", () => {
    const r = compile(`<program>\n<x> = 0\n<div>\n^{\n  meta.emit("<p>" + meta.get("x") + "</p>")\n}\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toMatch(/meta_effect\("_scrml_meta_\w+", function\(meta\) \{\n  "use strict";\n/);
    expect(run(r.clientJs).out).toEqual(["<p>0</p>"]);
  });
});

describe("S458 final F5/F6 — refusal messages name the source form, not an internal node kind", () => {
  test("an unquoted emit() attribute says to quote the value", () => {
    const r = compile(`<program>\n<div>\n^{\n  emit("<p class=nav>x</p>")\n}\n</div>\n</program>\n`);
    expect(r.codes).toContain("E-META-EVAL-002");
    const msg = r.messages.join("\n");
    expect(msg).toContain("quote the attribute value");
    expect(msg).not.toContain("variable-ref");
  });
  test("a plain `=` reassignment in a ^{} body is described as source, not 'tilde-decl'", () => {
    const r = compile(`<program>\n<div>\n^{\n  let s = "a"\n  s = "b"\n  emit("<p>" + s + "</p>")\n}\n</div>\n</program>\n`);
    expect(r.codes).toContain("E-META-001");
    const msg = r.messages.join("\n");
    expect(msg).not.toContain("tilde-decl");
    expect(msg).toContain("reassigning a binding with a plain `=`");
  });
  test("a write to a captured binding: \"assigns to the captured binding `counter`\"", () => {
    const r = compile(`<program>\n<x> = 0\n\${ let counter = 1 }\n<div>\n^{\n  meta.get("x")\n  counter += 1\n}\n</div>\n</program>\n`);
    expect(r.codes).toContain("E-META-001");
    const msg = r.messages.join("\n");
    expect(msg).toContain("assigns to the captured binding `counter`");
    expect(msg).not.toContain("(assignment to a captured binding)");
  });
});

describe("S458 final F7 — a runtime ^{} in an <each> row is refused with its cause", () => {
  test("reading the `as` binding: one E-META-001 saying per-row ^{} is unsupported (not 'person' is not available)", () => {
    const r = compile(`<program>\n<people> = [{ name: "Ann" }]\n<ul>\n<each in=@people as person><li>^{ meta.emit(person.name) }</li></each>\n</ul>\n</program>\n`);
    expect(r.codes).toEqual(["E-META-001"]);
    expect(r.messages[0]).toContain("a runtime ^{} inside an <each> row is not supported");
    expect(r.messages[0]).not.toContain("'person' is not available");
  });
  test("a runtime ^{} in a row that reads no binding is refused too (it never ran — base dropped it)", () => {
    const r = compile(`<program>\n<people> = [{ name: "Ann" }]\n<x> = 0\n<ul>\n<each in=@people as person><li>^{ meta.emit(meta.get("x")) }</li></each>\n</ul>\n</program>\n`);
    expect(r.codes).toEqual(["E-META-001"]);
  });
  test("a compile-time ^{} in a row splices its static markup into every row", () => {
    const r = compile(`<program>\n<people> = [{ name: "Ann" }, { name: "Bo" }]\n<ul>\n<each in=@people as person>^{ emit("<li>row</li>") }</each>\n</ul>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain(`"row"`);
  });
});
