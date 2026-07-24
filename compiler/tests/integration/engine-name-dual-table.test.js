/**
 * engine-name-dual-table.test.js
 *
 * Bug: g-engine-name-attr-swallows-var-duplicate (HIGH — compile-clean,
 * runtime-broken). Change-id: engine-name-dual-table-fix-2026-06-20.
 *
 * `<engine name=N for=T>` is RATIFIED-CANONICAL (SPEC §51 P1, DD1 2026-04-30).
 * A MODERN engine (state-child body) declared with `name=N` MAY govern a
 * machine-typed cell `@x: N` (§51.3.3 / §7495: "a machine-typed state cell
 * `@state: M` where `<machine name=M>` governs it").
 *
 * PRE-FIX BUG (codegen dual-table + var-derivation mismatch):
 *   - The §51.0 engine path built a POPULATED transition table keyed on the
 *     `name=`-derived phantom var (`__scrml_engine_modeMachine_transitions`)
 *     and auto-declared a phantom cell `modeMachine`.
 *   - The §51.3 write-guard for the user's `@mode` cell read a DIFFERENT,
 *     EMPTY table `__scrml_transitions_ModeMachine` → `__rule` always null →
 *     every legal transition threw `E-ENGINE-001-RT` at runtime.
 *   - The engine governed the phantom `modeMachine` while the user wrote `@mode`.
 *
 * FIX:
 *   - SYM (registerEngineDecl) binds the engine's variable to the user's
 *     machine-typed cell `@x: N` (§51.3.3); no phantom cell; everything keys
 *     on `@x` (here `mode`).
 *   - buildMachineBindingsMap skips MODERN engines (empty machine.rules) so the
 *     POPULATED §51.0 engine write-guard owns the cell.
 *
 * R26 acceptance (this file): the reproducer COMPILES (exit 0) AND the
 * transition WORKS at runtime — toggling flips `@mode` Nav<->Edit with NO
 * `E-ENGINE-001-RT`.
 *
 * Strategy mirrors bug-ab-engine-direct-ontransition.test.js: compile inline
 * source, concatenate runtime + client into an isolated evaluator, invoke the
 * generated handler, assert runtime state flips.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

function compile(source, suffix = "engine-name-dual") {
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

function errorsOf(errors) {
  return errors.filter((e) => e.severity === "error");
}

describe("engine-name-dual-table — `<engine name=N for=T>` governing `@x: N` (RATIFIED P1)", () => {
  // The exact PA reproducer (machine-typed cell named to coincide with the
  // type-derived var).
  test("modern engine name=N + machine-typed cell @mode: N — transition WORKS at runtime (R26)", () => {
    const src = `<program>
\${
type Mode:enum = { Nav, Edit }
@mode: ModeMachine = Mode.Nav
function toggle() { if (@mode == Mode.Nav) { @mode = .Edit } else { @mode = .Nav } }
}
<engine name=ModeMachine for=Mode initial=.Nav>
  <Nav  rule=.Edit />
  <Edit rule=.Nav />
  <onTransition from=.Nav to=.Edit>\${ @mode = @mode }</onTransition>
  <onTransition from=.Edit to=.Nav>\${ @mode = @mode }</onTransition>
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@mode}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "engine-name-dual-repro");
    try {
      // Compiles clean (exit 0 equivalent — no error-severity diagnostics).
      expect(errorsOf(errors)).toEqual([]);

      // Emit-level guards: the engine governs `@mode` (the unified cell), NOT a
      // phantom `modeMachine`. The write-guard reads the POPULATED engine table.
      expect(clientJs).toContain("__scrml_engine_mode_transitions");
      expect(clientJs).not.toContain("modeMachine");
      // The write routes through the engine direct-set against the populated
      // table (not the empty §51.3 table).
      expect(clientJs).toContain('_scrml_engine_direct_set("mode", "Edit", __scrml_engine_mode_transitions)');
      expect(clientJs).toContain('_scrml_engine_direct_set("mode", "Nav", __scrml_engine_mode_transitions)');
      // No dead empty §51.3 table for the modern engine.
      expect(clientJs).not.toContain("__scrml_transitions_ModeMachine");

      // Runtime: toggling flips @mode Nav<->Edit with no E-ENGINE-001-RT.
      const toggleName = findGeneratedFnName(clientJs, "toggle");
      expect(toggleName).toBeTruthy();
      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      expect(ctx.read("mode")).toBe("Nav");
      ctx.callFn(toggleName); // Nav -> Edit (legal: <Nav rule=.Edit>)
      expect(ctx.read("mode")).toBe("Edit");
      ctx.callFn(toggleName); // Edit -> Nav (legal: <Edit rule=.Nav>)
      expect(ctx.read("mode")).toBe("Nav");
      ctx.callFn(toggleName); // Nav -> Edit again
      expect(ctx.read("mode")).toBe("Edit");
    } finally {
      cleanup();
    }
  });

  // A machine-typed cell whose name does NOT coincide with the type-derived
  // var (`@m: ModeMachine`, type-derived would be `mode`) — the engine still
  // binds to the user's cell `@m` (§51.3.3 name-agnostic).
  test("modern engine name=N + machine-typed cell with a non-type-derived name (@m: N) — works at runtime", () => {
    const src = `<program>
\${
type Mode:enum = { Nav, Edit }
@m: ModeMachine = Mode.Nav
function toggle() { if (@m == Mode.Nav) { @m = .Edit } else { @m = .Nav } }
}
<engine name=ModeMachine for=Mode initial=.Nav>
  <Nav  rule=.Edit />
  <Edit rule=.Nav />
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@m}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "engine-name-dual-m");
    try {
      expect(errorsOf(errors)).toEqual([]);
      // The engine governs `@m`; the write-guard reads the populated table keyed on `m`.
      expect(clientJs).toContain("__scrml_engine_m_transitions");
      expect(clientJs).toContain('_scrml_engine_direct_set("m", "Edit", __scrml_engine_m_transitions)');

      const toggleName = findGeneratedFnName(clientJs, "toggle");
      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      expect(ctx.read("m")).toBe("Nav");
      ctx.callFn(toggleName);
      expect(ctx.read("m")).toBe("Edit");
      ctx.callFn(toggleName);
      expect(ctx.read("m")).toBe("Nav");
    } finally {
      cleanup();
    }
  });

  // Regression guard: the canonical NO-name modern engine (auto-var from type)
  // still compiles + transitions. The user writes the type-derived cell directly.
  test("no-name modern engine (auto-var from for=Type) still transitions — no regression", () => {
    const src = `<program>
type Mode:enum = { Nav, Edit }
function toggle() { if (@mode == Mode.Nav) { @mode = .Edit } else { @mode = .Nav } }
<engine for=Mode initial=.Nav>
  <Nav  rule=.Edit />
  <Edit rule=.Nav />
</engine>
<div><button onclick=toggle()>toggle</button><span>\${@mode}</span></div>
</program>`;
    const { errors, clientJs, runtimeJs, cleanup } = compile(src, "engine-noname");
    try {
      expect(errorsOf(errors)).toEqual([]);
      expect(clientJs).toContain("__scrml_engine_mode_transitions");
      const toggleName = findGeneratedFnName(clientJs, "toggle");
      const ctx = makeEvaluator(runtimeJs, clientJs, [toggleName]);
      expect(ctx.read("mode")).toBe("Nav");
      ctx.callFn(toggleName);
      expect(ctx.read("mode")).toBe("Edit");
      ctx.callFn(toggleName);
      expect(ctx.read("mode")).toBe("Nav");
    } finally {
      cleanup();
    }
  });

  // Regression guard: a GENUINE var collision must STILL fire E-ENGINE-VAR-DUPLICATE.
  // `var=mode` + a SEPARATELY-declared `@mode` cell (NOT a machine-typed binding)
  // is a real collision — the engine OWNS its var per §51.0.C.
  test("genuine collision (var=mode + separate non-machine-typed @mode) STILL fires E-ENGINE-VAR-DUPLICATE", () => {
    const src = `<program>
\${
type Mode:enum = { Nav, Edit }
@mode = Mode.Nav
}
<engine for=Mode var=mode initial=.Nav>
  <Nav  rule=.Edit />
  <Edit rule=.Nav />
</engine>
<div><span>\${@mode}</span></div>
</program>`;
    const { errors, cleanup } = compile(src, "engine-genuine-collision");
    try {
      const codes = errors.map((e) => e.code);
      expect(codes).toContain("E-ENGINE-VAR-DUPLICATE");
    } finally {
      cleanup();
    }
  });
});
