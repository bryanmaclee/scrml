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
