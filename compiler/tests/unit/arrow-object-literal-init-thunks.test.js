/**
 * arrow-object-literal-init-thunks.test.js — Hand-written `() => <body>` thunks
 *
 * Regression: GITI-014 (giti inbound 2026-05-23).
 *
 * Sibling of arrow-object-literal-body.test.js (GITI-013, ed9766d7). GITI-013
 * fixed the structured emitLambda path. GITI-014 covers the OTHER emit code
 * paths in compiler/src/codegen/emit-logic.ts that hand-assemble arrows by
 * string concatenation rather than going through emitLambda:
 *
 *   - `_scrml_init_set("name", () => <init>);`        (lines 634 / 644)
 *   - `_scrml_default_set("name", () => <default>);`  (line 560)
 *   - `_scrml_derived_declare("name", () => <body>);` (lines 1448 / 1781)
 *
 * Before the fix, a state-decl with an object-literal initializer
 *   @probe = { error: not, count: 0 }
 * emitted
 *   _scrml_init_set("probe", () => {error: null, count: 0});   // BROKEN
 * which JS parses as a block statement with a label `error:` — `bun --check`
 * / `node --check` reject with `Expected ";" but found ":"`.
 *
 * After the fix:
 *   _scrml_init_set("probe", () => ({error: null, count: 0})); // valid expr
 *
 * Coverage:
 *   §1  init_set zero-arg arrow — `@probe = { error: not, count: 0 }`
 *       (the literal repro filed by adopter giti).
 *   §2  default_set zero-arg arrow — `@x = 1 default= { a: 1, b: 2 }`.
 *       (Same defect class; surfaced during the GITI-014 scope audit.)
 *   §3  derived_declare zero-arg arrow — `@s = { value: @x, count: 0 }`
 *       where the init has reactive deps. (Same defect class.)
 *   §4  Sanity — scalar init `@n = 0` does NOT get spurious parens.
 *   §5  Sanity — array init `@xs = [1, 2, 3]` does NOT get spurious parens.
 *   §6  Regression guard for GITI-013: single-arg arrow with object body
 *       still works (`f => ({...})`). The two fixes coexist.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as acornParse } from "acorn";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/arrow-object-literal-init-thunks");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

/**
 * Parse a JS module string. Returns null on success; returns the SyntaxError
 * message on failure.
 */
function parseModule(src) {
  try {
    acornParse(src, { ecmaVersion: 2024, sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

let initSetFx, defaultSetFx, derivedDeclareFx, scalarInitFx, arrayInitFx, giti013GuardFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // §1: faithful copy of the GITI-014 repro (adopter giti)
  initSetFx = fix("init-set.scrml", `<program>
\${
  @probe = { error: not, count: 0 }
}
<div>\${@probe.error} / \${@probe.count}</div>
</program>
`);

  // §2: default= sidecar with object literal default value
  // Syntax: `<name default=<expr>> = <init>` — default= is a markup-attribute
  // form on the state-decl head (SPEC §6.8 / Phase A1a Step 6).
  defaultSetFx = fix("default-set.scrml", `<program>
\${
  <cfg default={ mode: "off", retries: 0 }> = { mode: "live", retries: 3 }
}
<div>\${@cfg.mode}</div>
</program>
`);

  // §3: derived_declare arm — reactive @-decl with object init referencing
  // another reactive cell (forces the C5 derived-declare path).
  derivedDeclareFx = fix("derived-declare.scrml", `<program>
\${
  @x = 1
  @snapshot = { value: @x, count: 0 }
}
<div>\${@snapshot.value}</div>
</program>
`);

  // §4: scalar init — should NOT get spurious parens
  scalarInitFx = fix("scalar-init.scrml", `<program>
\${
  @n = 42
}
<div>\${@n}</div>
</program>
`);

  // §5: array init — should NOT get spurious parens (no ambiguity)
  arrayInitFx = fix("array-init.scrml", `<program>
\${
  @xs = [1, 2, 3]
}
<div>\${@xs[0]}</div>
</program>
`);

  // §6: regression guard — GITI-013's single-arg arrow with object body
  // still works (this is the structured emitLambda path).
  giti013GuardFx = fix("giti-013-guard.scrml", `<program>
\${
  @items = [{ id: 1 }, { id: 2 }]
  @rows = []
  function rebuild() {
    @rows = @items.map(it => ({ key: it.id }))
  }
}
<button onclick=rebuild()>go</button>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

// ---------------------------------------------------------------------------
// §1: _scrml_init_set zero-arg arrow with object body — THE GITI-014 REPRO
// ---------------------------------------------------------------------------

describe("§1: _scrml_init_set with object-literal init", () => {
  test("compiles without errors", () => {
    const result = compile(initSetFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js: _scrml_init_set body is paren-wrapped", () => {
    const result = compile(initSetFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(initSetFx).clientJs));
    // Canonical fix shape — `_scrml_init_set("probe", () => ({error: ...})`
    expect(clientJs).toMatch(/_scrml_init_set\("probe",\s*\(\)\s*=>\s*\(\s*\{\s*error/);
    // Bug shape — `_scrml_init_set("probe", () => {error:` — must NOT appear
    expect(clientJs).not.toMatch(/_scrml_init_set\("probe",\s*\(\)\s*=>\s*\{\s*error\s*:/);
  });

  test("client.js parses as a valid ESM module (no block-vs-object collision)", () => {
    const result = compile(initSetFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(initSetFx).clientJs));
    const err = parseModule(clientJs);
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2: _scrml_default_set zero-arg arrow with object body
// ---------------------------------------------------------------------------

describe("§2: _scrml_default_set with object-literal default", () => {
  test("compiles without errors", () => {
    const result = compile(defaultSetFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js: _scrml_default_set body is paren-wrapped when object", () => {
    const result = compile(defaultSetFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(defaultSetFx).clientJs));
    expect(clientJs).toMatch(/_scrml_default_set\("cfg",\s*\(\)\s*=>\s*\(\s*\{\s*mode/);
    expect(clientJs).not.toMatch(/_scrml_default_set\("cfg",\s*\(\)\s*=>\s*\{\s*mode\s*:/);
  });

  test("client.js parses as a valid ESM module", () => {
    const result = compile(defaultSetFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(defaultSetFx).clientJs));
    expect(parseModule(clientJs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3: _scrml_derived_declare zero-arg arrow with object body
// ---------------------------------------------------------------------------

describe("§3: _scrml_derived_declare with object-literal derived body", () => {
  test("compiles without errors", () => {
    const result = compile(derivedDeclareFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js: derived-declare body OR init_set sidecar uses paren-wrap", () => {
    const result = compile(derivedDeclareFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(derivedDeclareFx).clientJs));
    // The @-decl with reactive-cell-referencing object init can route through
    // either _scrml_derived_declare (if classified derived) OR
    // _scrml_reactive_set + _scrml_init_set (if classified reactive). Either
    // way, the zero-arg arrow body must be paren-wrapped.
    const hasDerived = /_scrml_derived_declare\("snapshot",\s*\(\)\s*=>\s*\(\s*\{\s*value/.test(clientJs);
    const hasInit = /_scrml_init_set\("snapshot",\s*\(\)\s*=>\s*\(\s*\{\s*value/.test(clientJs);
    expect(hasDerived || hasInit).toBe(true);
    // Bug shape must NOT appear in either form
    expect(clientJs).not.toMatch(/_scrml_derived_declare\("snapshot",\s*\(\)\s*=>\s*\{\s*value\s*:/);
    expect(clientJs).not.toMatch(/_scrml_init_set\("snapshot",\s*\(\)\s*=>\s*\{\s*value\s*:/);
  });

  test("client.js parses as a valid ESM module", () => {
    const result = compile(derivedDeclareFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(derivedDeclareFx).clientJs));
    expect(parseModule(clientJs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §4: scalar init — no spurious parens
// ---------------------------------------------------------------------------

describe("§4: scalar init — no spurious parens", () => {
  test("client.js init_set body is the bare scalar (no extra parens)", () => {
    const result = compile(scalarInitFx);
    expect(result.errors).toEqual([]);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(scalarInitFx).clientJs));
    // Either no init_set at all (constant-fold path) or `() => 42` not `() => (42)`.
    if (clientJs.includes("_scrml_init_set")) {
      expect(clientJs).toMatch(/_scrml_init_set\("n",\s*\(\)\s*=>\s*42\)/);
      expect(clientJs).not.toMatch(/_scrml_init_set\("n",\s*\(\)\s*=>\s*\(\s*42\s*\)/);
    }
  });
});

// ---------------------------------------------------------------------------
// §5: array init — no spurious parens
// ---------------------------------------------------------------------------

describe("§5: array init — no spurious parens", () => {
  test("client.js init_set body is the bare array (no extra parens)", () => {
    const result = compile(arrayInitFx);
    expect(result.errors).toEqual([]);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(arrayInitFx).clientJs));
    // Array literals are unambiguous as arrow expression bodies.
    if (clientJs.includes("_scrml_init_set")) {
      expect(clientJs).toMatch(/_scrml_init_set\("xs",\s*\(\)\s*=>\s*\[/);
      expect(clientJs).not.toMatch(/_scrml_init_set\("xs",\s*\(\)\s*=>\s*\(\s*\[/);
    }
  });

  test("client.js parses as a valid ESM module", () => {
    const result = compile(arrayInitFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(arrayInitFx).clientJs));
    expect(parseModule(clientJs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §6: GITI-013 regression guard — single-arg arrow path still works
// ---------------------------------------------------------------------------

describe("§6: GITI-013 single-arg arrow regression guard", () => {
  test("single-arg `(it) => ({...})` is still paren-wrapped via emitLambda", () => {
    const result = compile(giti013GuardFx);
    expect(result.errors).toEqual([]);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(giti013GuardFx).clientJs));
    expect(clientJs).toMatch(/=>\s*\(\s*\{\s*key\s*:/);
    expect(clientJs).not.toMatch(/=>\s*\{\s*key\s*:/);
  });

  test("client.js parses as a valid ESM module", () => {
    const result = compile(giti013GuardFx);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(result.outputs.get(giti013GuardFx).clientJs));
    expect(parseModule(clientJs)).toBeNull();
  });
});
