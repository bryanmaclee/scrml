/**
 * s144-ontransition-program-scope-dispatch.test.js
 *
 * S144 Cluster E / Bug-AB — Defect 1.
 *
 * An engine transition triggered by `@engineVar = .Variant` (direct write) OR
 * `@engineVar.advance(.Variant)` from inside a free-standing program-scope
 * `function` body MUST fire the engine's `<onTransition>` handlers.
 *
 * ROOT (pre-fix): the `if-stmt` case in emit-logic.ts dropped the engine
 * context (engineBindings / engineVarNames / enginesWithHooks / …) when
 * threading opts into the if/else body, so a nested `@mode = .Edit` emitted a
 * bare `_scrml_reactive_set` (no dispatch) and `@mode.advance(.Edit)` emitted a
 * method call on the variant-string value. `__scrml_engine_<var>_fire_hooks`
 * was never invoked.
 *
 * FIX: thread engine + machine context through `emitIfStmt`'s body opts.
 *
 * SPEC §51.0.H — `<onTransition>` semantics attach to a STATE-CHILD (`to=` in
 * the FROM-state). These fixtures place the handler inside `<Nav>` accordingly.
 *
 * Strategy mirrors engine-ontimeout-end-to-end.test.js: compile inline source,
 * concatenate runtime + client into an isolated evaluator, then invoke the
 * generated program-scope function by its emitted name and assert the
 * onTransition body ran.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

function compile(source, suffix = "s144-ab1") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const runtimeFilename = result.runtimeFilename ?? "scrml-runtime.js";
    const runtimePath = resolve(outDir, runtimeFilename);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
      cleanup: () => existsSync(tmpDir) && rmSync(tmpDir, { recursive: true, force: true }),
    };
  } catch (e) {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Run runtime + client in an isolated function scope. Exposes the
 * reactive get/set plus a `callFn(generatedName)` that invokes a generated
 * top-level function (e.g. `_scrml_toggle_4`).
 */
function makeEvaluator(runtimeJs, clientJs, generatedFnNames) {
  const clientStripped = clientJs.replace(/^\/\/ Requires:.*\n/, "");
  const setTimeoutNoop = () => 0;
  const clearTimeoutNoop = () => {};
  const exportLines = generatedFnNames
    .map((fn) => `      ${JSON.stringify(fn)}: (typeof ${fn} !== "undefined" ? ${fn} : null),`)
    .join("\n");
  const wrappedSrc = `
    "use strict";
    const setTimeout = arguments[0];
    const clearTimeout = arguments[1];
    const console = arguments[2];
    const Math = arguments[3];
    const Date = arguments[4];
    const isFinite = arguments[5];
    const Array = arguments[6];
    const Object = arguments[7];
    const JSON = arguments[8];
    const document = arguments[9];
    const window = arguments[10];
    ${runtimeJs}
    ${clientStripped}
    return {
      reactiveGet: (n) => _scrml_reactive_get(n),
      reactiveSet: (n, v) => _scrml_reactive_set(n, v),
      fns: {
${exportLines}
      },
    };
  `;
  const fn = new Function(wrappedSrc);
  const exports = fn(setTimeoutNoop, clearTimeoutNoop, console, Math, Date, isFinite, Array, Object, JSON, globalThis.document, globalThis.window);
  return {
    read: (n) => exports.reactiveGet(n),
    set: (n, v) => exports.reactiveSet(n, v),
    callFn: (genName, ...args) => {
      const f = exports.fns[genName];
      if (typeof f !== "function") throw new Error(`generated fn ${genName} not found / not a function`);
      return f(...args);
    },
  };
}

/** Find the emitted name of a program-scope function (`function _scrml_<orig>_<n>(`). */
function findGeneratedFnName(clientJs, origName) {
  const re = new RegExp(`function\\s+(_scrml_${origName}_\\d+)\\s*\\(`);
  const m = clientJs.match(re);
  return m ? m[1] : null;
}

describe("S144 Bug-AB Defect 1 — program-scope function triggers fire <onTransition>", () => {
  test("direct write `@mode = .Edit` inside an if-body dispatches through _scrml_engine_direct_set + fire_hooks", () => {
    const src = `<program>
type Mode:enum = { Nav, Edit }
<transitions> = 0
function toggle() { if (@mode == Mode.Nav) { @mode = .Edit } else { @mode = .Nav } }
<engine for=Mode initial=.Nav>
  <Nav rule=.Edit>
    <onTransition to=.Edit>\${ @transitions = @transitions + 1 }</onTransition>
  </>
  <Edit rule=.Nav />
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@mode}</span><span>\${@transitions}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "s144-ab-direct");
    try {
      expect(errors.filter((e) => e.severity === "error")).toEqual([]);

      // Emit-level guard: the if-body write must route through the engine
      // dispatcher, NOT a bare reactive_set, and fire_hooks must be emitted.
      expect(clientJs).toContain("_scrml_engine_direct_set(\"mode\", \"Edit\"");
      expect(clientJs).toContain("__scrml_engine_mode_fire_hooks");
      expect(clientJs).not.toMatch(/_scrml_reactive_set\("mode", "Edit"\)/);

      const toggleName = findGeneratedFnName(clientJs, "toggle");
      expect(toggleName).toBeTruthy();

      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      // Initial: Nav, transitions 0
      expect(ctx.read("mode")).toBe("Nav");
      expect(ctx.read("transitions")).toBe(0);
      // First toggle: Nav → Edit fires the onTransition handler → transitions 0→1
      ctx.callFn(toggleName);
      expect(ctx.read("mode")).toBe("Edit");
      expect(ctx.read("transitions")).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("`@mode.advance(.Edit)` inside an if-body dispatches through _scrml_engine_advance + fire_hooks", () => {
    const src = `<program>
type Mode:enum = { Nav, Edit }
<transitions> = 0
function go() { if (@mode == Mode.Nav) { @mode.advance(.Edit) } }
<engine for=Mode initial=.Nav>
  <Nav rule=.Edit>
    <onTransition to=.Edit>\${ @transitions = @transitions + 1 }</onTransition>
  </>
  <Edit rule=.Nav />
</engine>
<div><button onclick=go()>go</button><span>\${@mode}</span><span>\${@transitions}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "s144-ab-advance");
    try {
      expect(errors.filter((e) => e.severity === "error")).toEqual([]);

      // Emit-level guard: routes through _scrml_engine_advance (NOT a method
      // call on the variant-string value).
      expect(clientJs).toContain("_scrml_engine_advance(\"mode\", \"Edit\"");
      expect(clientJs).toContain("__scrml_engine_mode_fire_hooks");
      expect(clientJs).not.toMatch(/_scrml_reactive_get\("mode"\)\.advance\(/);

      const goName = findGeneratedFnName(clientJs, "go");
      expect(goName).toBeTruthy();

      const ctx = makeEvaluator(runtimeJs, clientJs, [goName]);
      expect(ctx.read("mode")).toBe("Nav");
      expect(ctx.read("transitions")).toBe(0);
      ctx.callFn(goName);
      expect(ctx.read("mode")).toBe("Edit");
      expect(ctx.read("transitions")).toBe(1);
    } finally {
      cleanup();
    }
  });
});
