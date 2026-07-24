/**
 * bug-ab-engine-direct-ontransition.test.js
 *
 * Bug-AB (6nz) — reopened 2026-05-30.
 *
 * The CANONICAL / DOCUMENTED `<onTransition>` placement (SPEC §51.0.H /
 * PRIMER §7) is a DIRECT child of `<engine>` with BOTH endpoints explicit:
 *
 *     <engine for=Mode initial=.Nav>
 *       <Nav rule=.Edit />
 *       <Edit rule=.Nav />
 *       <onTransition from=.Nav to=.Edit>${ ... }</onTransition>
 *     </engine>
 *
 * Pre-fix this engine-DIRECT form was SILENTLY DROPPED by the parser:
 * `parseEngineStateChildren` only recognizes PascalCase openers, so the
 * lowercase-led `<onTransition>` never entered the state-child set. The only
 * pre-existing capture path (`scanForOnTransitionEntries` over each
 * state-child's bodyRaw) covers the NESTED placement only. Result:
 * `collectEngineHooks` returned []  →  no `__scrml_engine_<var>_fire_hooks`
 * function, no fire call  →  the effect never ran. No diagnostic.
 *
 * This CORRECTS the S144 record (commit 5113f3ea): the "fire_hooks generated,
 * only routing missing" claim was TRUE ONLY for the NESTED placement. For the
 * engine-direct form the fire machinery was never reached.
 *
 * The pre-existing S144 test (s144-ontransition-program-scope-dispatch.test.js)
 * exercises the NESTED placement exclusively — a test-silent gap on the
 * canonical engine-direct shape. This test closes that gap.
 *
 * Strategy mirrors s144-ontransition-program-scope-dispatch.test.js: compile
 * inline source, concatenate runtime + client into an isolated evaluator,
 * invoke the generated program-scope function, assert the engine-direct
 * <onTransition> body ran.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

function compile(source, suffix = "bug-ab-direct") {
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

function makeEvaluator(runtimeJs, clientJs, generatedFnNames) {
  const clientStripped = clientJs.replace(/^\/\/ Requires:.*\n/, "");
  const exportLines = generatedFnNames
    .map((fn) => `      ${JSON.stringify(fn)}: (typeof ${fn} !== "undefined" ? ${fn} : null),`)
    .join("\n");
  const wrappedSrc = `
    "use strict";
    const setTimeout = arguments[0];
    const clearTimeout = arguments[1];
    const console = arguments[2];
    const document = arguments[3];
    const window = arguments[4];
    ${runtimeJs}
    ${clientStripped}
    return {
      reactiveGet: (n) => _scrml_reactive_get(n),
      fns: {
${exportLines}
      },
    };
  `;
  const fn = new Function(wrappedSrc);
  const exports = fn(() => 0, () => {}, console, globalThis.document, globalThis.window);
  return {
    read: (n) => exports.reactiveGet(n),
    callFn: (genName, ...args) => {
      const f = exports.fns[genName];
      if (typeof f !== "function") throw new Error(`generated fn ${genName} not found`);
      return f(...args);
    },
  };
}

function findGeneratedFnName(clientJs, origName) {
  const re = new RegExp(`function\\s+(_scrml_${origName}_\\d+)\\s*\\(`);
  const m = clientJs.match(re);
  return m ? m[1] : null;
}

describe("Bug-AB — engine-DIRECT <onTransition> (canonical §51.0.H / PRIMER §7 placement)", () => {
  test("engine-direct <onTransition from=.X to=.Y> emits fire_hooks fn + effect body + fire call, and fires at runtime", () => {
    const src = `<program>
type Mode:enum = { Nav, Edit }
<transitions> = 0
function toggle() { if (@mode == Mode.Nav) { @mode = .Edit } else { @mode = .Nav } }
<engine for=Mode initial=.Nav>
  <Nav rule=.Edit />
  <Edit rule=.Nav />
  <onTransition from=.Nav to=.Edit>\${ @transitions = @transitions + 1 }</onTransition>
  <onTransition from=.Edit to=.Nav>\${ @transitions = @transitions + 1 }</onTransition>
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@mode}</span><span>\${@transitions}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "bug-ab-direct");
    try {
      expect(errors.filter((e) => e.severity === "error")).toEqual([]);

      // Emit-level guards: the fire-hooks machinery must EXIST and be wired.
      expect(clientJs).toContain("function __scrml_engine_mode_fire_hooks");
      // Both engine-direct edges present, each incrementing transitions.
      expect(clientJs).toContain(`if (fromVariant === "Nav" && toVariant === "Edit")`);
      expect(clientJs).toContain(`if (fromVariant === "Edit" && toVariant === "Nav")`);
      // The effect body is emitted (NOT just the <transitions>=0 init).
      const effectMatches = clientJs.match(
        /_scrml_reactive_set\("transitions", _scrml_reactive_get\("transitions"\) \+ 1\)/g,
      );
      expect(effectMatches && effectMatches.length).toBe(2);
      // The fire call is wired on the direct-set path.
      expect(clientJs).toMatch(/__scrml_engine_mode_fire_hooks\(/);

      // Runtime: clicking toggle twice must fire BOTH engine-direct edges.
      const toggleName = findGeneratedFnName(clientJs, "toggle");
      expect(toggleName).toBeTruthy();
      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      expect(ctx.read("mode")).toBe("Nav");
      expect(ctx.read("transitions")).toBe(0);
      ctx.callFn(toggleName); // Nav -> Edit
      expect(ctx.read("mode")).toBe("Edit");
      expect(ctx.read("transitions")).toBe(1);
      ctx.callFn(toggleName); // Edit -> Nav
      expect(ctx.read("mode")).toBe("Nav");
      expect(ctx.read("transitions")).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("NESTED <onTransition> placement still works (no regression, no double-count)", () => {
    const src = `<program>
type Mode:enum = { Nav, Edit }
<transitions> = 0
function toggle() { if (@mode == Mode.Nav) { @mode = .Edit } else { @mode = .Nav } }
<engine for=Mode initial=.Nav>
  <Nav rule=.Edit>
    <onTransition to=.Edit>\${ @transitions = @transitions + 1 }</onTransition>
  </>
  <Edit rule=.Nav>
    <onTransition to=.Nav>\${ @transitions = @transitions + 1 }</onTransition>
  </>
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@mode}</span><span>\${@transitions}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "bug-ab-nested");
    try {
      expect(errors.filter((e) => e.severity === "error")).toEqual([]);
      expect(clientJs).toContain("function __scrml_engine_mode_fire_hooks");
      // Exactly 2 effect bodies — nested entries NOT double-counted via the
      // new engine-direct scan (skip-region exclusion).
      const effectMatches = clientJs.match(
        /_scrml_reactive_set\("transitions", _scrml_reactive_get\("transitions"\) \+ 1\)/g,
      );
      expect(effectMatches && effectMatches.length).toBe(2);

      const toggleName = findGeneratedFnName(clientJs, "toggle");
      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      expect(ctx.read("transitions")).toBe(0);
      ctx.callFn(toggleName);
      expect(ctx.read("transitions")).toBe(1);
      ctx.callFn(toggleName);
      expect(ctx.read("transitions")).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("MIXED nested + engine-direct compose (each fires once, no double-count)", () => {
    const src = `<program>
type Mode:enum = { Nav, Edit }
<navHits> = 0
<editHits> = 0
function toggle() { if (@mode == Mode.Nav) { @mode = .Edit } else { @mode = .Nav } }
<engine for=Mode initial=.Nav>
  <Nav rule=.Edit>
    <onTransition to=.Edit>\${ @editHits = @editHits + 1 }</onTransition>
  </>
  <Edit rule=.Nav />
  <onTransition from=.Edit to=.Nav>\${ @navHits = @navHits + 1 }</onTransition>
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@mode}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "bug-ab-mixed");
    try {
      expect(errors.filter((e) => e.severity === "error")).toEqual([]);
      // Nested edit-arm fires on Nav->Edit; engine-direct nav-arm on Edit->Nav.
      const editHitMatches = clientJs.match(/_scrml_reactive_set\("editHits"/g);
      const navHitMatches = clientJs.match(/_scrml_reactive_set\("navHits"/g);
      // 1 init + 1 effect each (init = `=0`, effect = `+ 1`).
      expect((editHitMatches || []).length).toBe(2);
      expect((navHitMatches || []).length).toBe(2);

      const toggleName = findGeneratedFnName(clientJs, "toggle");
      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      expect(ctx.read("editHits")).toBe(0);
      expect(ctx.read("navHits")).toBe(0);
      ctx.callFn(toggleName); // Nav -> Edit : nested edit-arm fires
      expect(ctx.read("editHits")).toBe(1);
      expect(ctx.read("navHits")).toBe(0);
      ctx.callFn(toggleName); // Edit -> Nav : engine-direct nav-arm fires
      expect(ctx.read("editHits")).toBe(1);
      expect(ctx.read("navHits")).toBe(1);
    } finally {
      cleanup();
    }
  });
});
