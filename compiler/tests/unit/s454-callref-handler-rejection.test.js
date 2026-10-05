/**
 * s454-callref-handler-rejection.test.js — EMISSION bite-proofs for bryan's S454
 * ruling (`scrml-support/user-voice-scrml.md` §S454):
 *
 *   "a yes, b yes, root fix"
 *
 * — every event-handler rejection reaches the §19.6.8 logging surface, whatever
 * the handler's form, and the §5.2.2 call-ref form `onclick=fn()` takes the SAME
 * async colouring as the `${…}` form instead of an emit-site `.catch` patch.
 *
 * WHY. S453 (A3) made an async-coloured listener log its rejection, but the
 * call-ref form was never coloured: emit-event-wiring substituted the MANGLED
 * callee name (`fnNameMap.get(handlerName)`) into the wrapper BEFORE
 * `colorHandlerAsync` ran, and the colouring resolves callees by AUTHOR name
 * (`outerAsyncRootFromFacts`), so `_scrml_fetch_save_4()` matched nothing and the
 * listener stayed a sync `function(event) { _scrml_fetch_save_4(); }` whose
 * rejection escaped as a bare `unhandledrejection`. The `${fn()}` form carries the
 * author name through colouring and is mangled afterwards by emit-client's
 * post-fn-name-mangle pass. The root fix builds the call-ref wrapper with the
 * author name too, so both forms run one pipeline.
 *
 * SITES (enumerated, not assumed): the emit-event-wiring call-ref branch feeds the
 * delegated registry, the non-delegable per-element listeners and the arm-bound
 * factory; its `<formFor>` submit and bare-ref (`onclick=handler`) branches used to
 * `continue` past colouring; emit-variant-guard's in-arm non-delegable wiring
 * never coloured at all (a 16th registration site, missing from the S453
 * inventory). `<each>` rows and `for … lift` rows already kept the author name
 * and are pinned here as controls.
 *
 * BITE. Every "async callee" `expect` below fails on b35593879 (the pre-change
 * tree): the call-ref listener there is a plain sync wrapper with no arm.
 *
 * The MOUNTED acceptance (the rejection reaches the log, does not escape, and
 * `preventDefault()` keeps its timing) is
 * `compiler/tests/browser/callref-handler-rejection-log-s454.browser.test.js`.
 */

import { describe, test, expect } from "bun:test";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { colorAsyncFunctionExpr } from "../../src/codegen/js-async-analysis.ts";

const PRE = `  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("hi")
  <x> = 0
  <y> = 0
  <rows> = [{ id: 1 }]
  server function save() { return 10 }
  server function save1(n: number) { return n }
  function go() { @x = save() + 1 }
  function goArg(n: number) { @x = save1(n) + 1 }
  function syncFn() { @y = 1 }
`;

function emit(markup, pre = PRE) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s454-emit-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, `<program>\n${pre}  ${markup}\n  <p id="o">\${@x} \${@y}</p>\n</program>\n`);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const p = resolve(outDir, "app.client.js");
    return {
      errs: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code),
      js: existsSync(p) ? readFileSync(p, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Every `_scrml_error_boundary_log("<id>", …)` arm that a listener `catch` binds. */
function catchArms(js) {
  return (js.match(/catch \(_scrml_async_err[^)]*\) \{ _scrml_error_boundary_log\("([^"]*)"/g) || [])
    .map((m) => m.match(/_scrml_error_boundary_log\("([^"]*)"/)[1]);
}

/** The registry entry text for one placeholder (delegated / non-delegable maps). */
function entry(js, placeholderPrefix) {
  const m = js.match(new RegExp(`"(${placeholderPrefix}_\\d+)": ([^\\n]*),\\n`));
  return m ? { id: m[1], text: m[2] } : null;
}

describe("S454 — `onclick=fn()` and `onclick=${fn()}` emit the SAME listener", () => {
  test("async client fn (transitively async through a server call)", () => {
    const r = emit(`<button id="a" onclick=go()>a</button><button id="b" onclick=\${go()}>b</button>`);
    expect(r.errs).toEqual([]);
    const [a, b] = [...r.js.matchAll(/"_scrml_attr_onclick_\d+": ([^\n]*),\n/g)].map((m) => m[1]);
    // identical modulo the per-site boundary id
    const strip = (s) => s.replace(/"onclick _scrml_attr_onclick_\d+"/, '"<id>"');
    expect(strip(a)).toBe(strip(b));
    expect(a).toMatch(/^async function\(event\) \{ try \{ await _scrml_go_\d+\(\); \} catch \(_scrml_async_err\) \{ _scrml_error_boundary_log\("onclick _scrml_attr_onclick_\d+", _scrml_async_err\); \} \}$/);
  });

  test("server fn called directly, with a literal arg (`onclick=fn(1)`)", () => {
    const r = emit(`<button id="a" onclick=save1(1)>a</button><button id="b" onclick=\${save1(1)}>b</button>`);
    expect(r.errs).toEqual([]);
    const [a, b] = [...r.js.matchAll(/"_scrml_attr_onclick_\d+": ([^\n]*),\n/g)].map((m) => m[1]);
    const strip = (s) => s.replace(/"onclick _scrml_attr_onclick_\d+"/, '"<id>"');
    expect(strip(a)).toBe(strip(b));
    expect(a).toMatch(/await _scrml_fetch_save1_\d+\(1\);/);
  });

  test("a SYNC callee stays the plain wrapper — byte-identical to the pre-S454 text", () => {
    const r = emit(`<button id="a" onclick=syncFn()>a</button>`);
    expect(r.errs).toEqual([]);
    // exactly what b35593879 emitted: the mangled name, no async, no arm
    expect(r.js).toMatch(/"_scrml_attr_onclick_\d+": function\(event\) \{ _scrml_syncFn_\d+\(\); \},\n/);
    expect(r.js).not.toContain("async function(event)");
    expect(r.js).not.toContain("_scrml_error_boundary_log");
  });

  test("the post-pass still mangles every call-ref callee (no author name leaks)", () => {
    const r = emit(`<button id="a" onclick=syncFn()>a</button><button id="b" onclick=go()>b</button>`);
    expect(r.js).not.toMatch(/[^_\w]syncFn\(\)/);
    expect(r.js).not.toMatch(/await go\(\)/);
  });
});

describe("S454 — every call-ref registration path colours an async callee", () => {
  test("delegated (click)", () => {
    const r = emit(`<button id="b" onclick=go()>b</button>`);
    expect(r.errs).toEqual([]);
    expect(catchArms(r.js)).toEqual([expect.stringMatching(/^onclick _scrml_attr_onclick_\d+$/)]);
  });

  test("non-delegable (input, change)", () => {
    const r = emit(`<input id="i" oninput=go() /><select id="s" onchange=go()><option>a</option></select>`);
    expect(r.errs).toEqual([]);
    const arms = catchArms(r.js);
    expect(arms.length).toBe(2);
    expect(arms.some((a) => /^oninput /.test(a))).toBe(true);
    expect(arms.some((a) => /^onchange /.test(a))).toBe(true);
  });

  test("submit — the auto-injected preventDefault() stays in the synchronous prefix", () => {
    const r = emit(`<form id="f" onsubmit=go()><button>go</button></form>`);
    expect(r.errs).toEqual([]);
    const e = entry(r.js, "_scrml_attr_onsubmit");
    expect(e.text).toMatch(/^async function\(event\) \{ try \{ event\.preventDefault\(\); await _scrml_go_\d+\(\); \} catch/);
  });

  test("match arm at page level (registry entry)", () => {
    const r = emit(`<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><button id="m" onclick=go()>b</button></></match>`);
    expect(r.errs).toEqual([]);
    expect(catchArms(r.js)).toEqual([expect.stringMatching(/^onclick _scrml_attr_onclick_\d+$/)]);
  });

  test("arm-bound factory (call-ref reading a payload binding)", () => {
    const r = emit(`<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><button id="m" onclick=goArg(note.length)>b</button></></match>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/function _scrml_armh_\w+\(note\) \{ return async function\(event\) \{ try \{ await _scrml_goArg_\d+\(note\.length\);/);
    expect(catchArms(r.js).length).toBe(1);
  });

  test("in-arm NON-delegable listener (emit-variant-guard — never coloured before S454)", () => {
    const r = emit(`<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><input id="m" oninput=go() /></></match>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/const _h = async function\(event\) \{ try \{ await _scrml_go_\d+\(event\); \} catch \(_scrml_async_err\) \{ _scrml_error_boundary_log\("oninput _scrml_attr_oninput_\d+"/);
  });

  test("in-arm NON-delegable listener with a SYNC callee is unchanged", () => {
    const r = emit(`<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><input id="m" oninput=syncFn() /></></match>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/const _h = function\(event\) \{ _scrml_syncFn_\d+\(event\); \};/);
    expect(r.js).not.toContain("_scrml_error_boundary_log");
  });

  test("in-arm NON-delegable `${…}` handler — awaited like its page-level twin (s441 class at the missed site)", () => {
    // Same registration site, the expression form: before S454 the condition
    // tested a Promise (always truthy) and its rejection was unobserved, while
    // the identical page-level handler awaited it.
    const pre = PRE + `  server function isOk(n: number) { return n > 0 }\n`;
    const r = emit(
      `<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><input id="m" oninput=\${ if (isOk(1)) { @y = 1 } } /></></match>` +
      `<input id="t" oninput=\${ if (isOk(1)) { @y = 1 } } />`,
      pre,
    );
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/const _h = async function\(event\) \{ try \{ if \(await _scrml_fetch_isOk_\d+\(1\)\)/);
    // the page-level twin is the oracle
    expect(r.js).toMatch(/"_scrml_attr_oninput_\d+": async function\(event\) \{ try \{ if \(await _scrml_fetch_isOk_\d+\(1\)\)/);
    expect(catchArms(r.js).length).toBe(2);
  });

  test("in-arm NON-delegable `${…}` handler with no async call is unchanged", () => {
    const r = emit(`<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><input id="m" oninput=\${@y = 1} /></></match>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/const _h = function\(event\) \{ _scrml_cs_reactive_set\("y", 1\); \};/);
    expect(r.js).not.toContain("_scrml_error_boundary_log");
  });

  test("component body", () => {
    const r = emit(`<Btn/>`, PRE + `  const Btn = <button id="c" onclick=go()>go</>\n`);
    expect(r.errs).toEqual([]);
    expect(catchArms(r.js)).toEqual([expect.stringMatching(/^onclick /)]);
  });

  test("<each> row (control — already coloured before S454)", () => {
    const r = emit(`<ul><each in=@rows key=@.id as r><li><button id="e" onclick=go()>b</button></li></each></ul>`);
    expect(r.errs).toEqual([]);
    expect(catchArms(r.js)).toEqual(["onclick <each> row"]);
  });

  test("for … lift row (control — already coloured before S454)", () => {
    const r = emit(`<ul>\${ for (r of @rows) { lift <li><button id="l" onclick=go()>b</button></li>; } }</ul>`);
    expect(r.errs).toEqual([]);
    expect(catchArms(r.js)).toEqual(["onclick lift row"]);
  });

  test("`<formFor>` submit (used to `continue` past colouring)", () => {
    const pre = `  import { formFor } from 'scrml:data'
  type Signup:struct = { name: string req }
  server function persist(values: Signup) ! string { return "ok" }
`;
    const src = `\${\n${pre}}\n<program>\n  <formFor for=Signup onsubmit=persist/>\n</program>\n`;
    const tmpDir = mkdtempSync(join(tmpdir(), "s454-ff-"));
    try {
      const input = resolve(tmpDir, "app.scrml");
      writeFileSync(input, src);
      compileScrml({ inputFiles: [input], write: true, outputDir: resolve(tmpDir, "out"), log: () => {} });
      const js = readFileSync(resolve(tmpDir, "out", "app.client.js"), "utf8");
      expect(js).toMatch(/async function\(event\) \{ try \{ event\.preventDefault\(\); _scrml_cs_reactive_set\("signup\.submitted", true\); await _scrml_fetch_persist_\d+\(/);
      expect(catchArms(js)).toEqual([expect.stringMatching(/^onsubmit /)]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("S454 — the bare-ref form `onclick=handler`", () => {
  test("an async handler is wrapped, still handed the DOM event, and logs", () => {
    const r = emit(`<button id="b" onclick=go>b</button>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/"_scrml_attr_onclick_\d+": async function\(event\) \{ try \{ await _scrml_go_\d+\(event\); \} catch \(_scrml_async_err\) \{ _scrml_error_boundary_log\("onclick _scrml_attr_onclick_\d+"/);
  });

  test("a SYNC handler stays the DIRECT reference (no wrapper) — byte-identical", () => {
    const r = emit(`<button id="b" onclick=syncFn>b</button>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/"_scrml_attr_onclick_\d+": _scrml_syncFn_\d+,\n/);
    expect(r.js).not.toContain("_scrml_error_boundary_log");
  });
});

// ---------------------------------------------------------------------------
// THENABLE SAFETY (the `_scrml_reset_apply` lesson): the wrapper `await`s the
// callee's return. `await` on a non-promise is the value; on an arbitrary
// thenable it calls `then` in a LATER job, and a throwing `then` (or a throwing
// `then` getter) rejects the awaited promise — inside the `try`. The callee
// throwing synchronously is also inside the `try`. So nothing can throw
// synchronously out of the listener, and every failure is logged. Executed, not
// argued.
// ---------------------------------------------------------------------------
describe("S454 — the wrapper is thenable-safe", () => {
  const facts = (n) => (n === "f" ? { root: { kind: "server", via: "f" }, local: false } : null);
  const listenerSrc = colorAsyncFunctionExpr(`function(event) { f(); }`, facts, { boundaryId: "onclick X" }).code;

  function build(f) {
    const logged = [];
    const listener = new Function("f", "_scrml_error_boundary_log", `return (${listenerSrc});`)(
      f, (id, err) => logged.push([id, err && err.message !== undefined ? err.message : err]),
    );
    return { listener, logged };
  }

  const CASES = [
    ["returns a plain value", () => 5, []],
    ["returns undefined", () => undefined, []],
    ["returns a thenable that resolves", () => ({ then(res) { res(1); } }), []],
    ["returns a thenable whose then THROWS", () => ({ then() { throw new Error("then threw"); } }), ["then threw"]],
    ["returns an object whose then GETTER throws", () => ({ get then() { throw new Error("getter threw"); } }), ["getter threw"]],
    ["throws synchronously", () => { throw new Error("sync throw"); }, ["sync throw"]],
    ["returns a rejected promise", () => Promise.reject(new Error("rejected")), ["rejected"]],
  ];

  for (const [name, f, expectedLogs] of CASES) {
    test(name, async () => {
      const { listener, logged } = build(f);
      let ret;
      // never throws synchronously out of the listener
      expect(() => { ret = listener({}); }).not.toThrow();
      // and the listener's own promise never rejects (nothing escapes)
      await expect(ret).resolves.toBeUndefined();
      expect(logged.map((l) => l[1])).toEqual(expectedLogs);
      for (const l of logged) expect(l[0]).toBe("onclick X");
    });
  }

  test("a thenable that never settles does not block the dispatch (returns at once)", () => {
    const { listener } = build(() => ({ then() {} }));
    const ret = listener({});
    expect(ret).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// B-2 — an async `<errorBoundary>` with no `fallback=` (folds in
// g-errorboundary-async-render-rejection-unobserved-s453).
// ---------------------------------------------------------------------------
describe("S454 — an async <errorBoundary> render's rejection is observed", () => {
  const EB_PRE = `  <x> = 0
  server function boom() { return 10 }
`;

  test("no fallback: the render call sites carry a .catch arm; the body logs, then returns", () => {
    const r = emit(`<errorBoundary><p id="q">\${boom() + @x}</p></errorBoundary>`, EB_PRE);
    expect(r.js).toMatch(/async function _eb_render_\w+\(\)/);
    // both call sites — the initial render and the reactive re-run
    const calls = r.js.match(/_eb_render_\w+\(\)\.catch\(function\(_eb_err\) \{ _scrml_error_boundary_log\("_scrml_error_boundary_\d+", _eb_err\); \}\)/g) || [];
    expect(calls.length).toBe(2);
    // no unobserved re-throw left in the async render
    expect(r.js).not.toContain("throw _eb_err;");
    expect(r.js).not.toContain("throw _scrml_error_boundary_uncaught");
    // each throw site still logs exactly once (before its return)
    expect((r.js.match(/_scrml_error_boundary_log\("_scrml_error_boundary_\d+", _eb_err\);\n\s*return;/g) || []).length).toBe(1);
  });

  test("a SYNC boundary is unchanged (re-throw kept, no .catch)", () => {
    const r = emit(`<errorBoundary><p id="q">\${@x + 1}</p></errorBoundary>`, EB_PRE);
    expect(r.js).toContain("throw _eb_err; // §19.6.8 B3 — no fallback; propagate to enclosing boundary/host");
    expect(r.js).not.toMatch(/_eb_render_\w+\(\)\.catch/);
  });

  test("an async boundary WITH fallback keeps its fallback path and gains only the call-site arm", () => {
    const r = emit(`<errorBoundary fallback={<div>oops</>}><p id="q">\${boom()}</p></errorBoundary>`, EB_PRE);
    // the host-throw arm still renders the fallback and returns (unchanged)
    expect(r.js).toMatch(/_scrml_error_boundary_log\("_scrml_error_boundary_\d+", _eb_err\);\n\s*el\.innerHTML = \([^\n]*oops[^\n]*\);\n\s*return;/);
    expect(r.js).toMatch(/_eb_render_\w+\(\)\.catch\(/);
  });
});
