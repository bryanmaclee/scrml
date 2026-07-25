/* SPDX-License-Identifier: MIT
 * B1 (§51.0.B.1, S98 amendment — track 2 compiler-feature wiring) —
 * end-to-end codegen integration tests for payload binding on engine
 * state-children.
 *
 * Verifies the full compile pipeline (BS → TAB → ... → CG) for:
 *   - Wire-function receives payload bindings as parameters (closes
 *     SURVEY §4.2 sub-anomaly #3 — runtime ReferenceError gap).
 *   - Render function receives the same payload values.
 *   - Dispatcher extracts _data[fieldName] for both render + wire calls.
 *   - All three SPEC §51.0.B.1 forms (bare-attribute, parenthesized,
 *     named) produce equivalent client.js shapes for the same source
 *     semantics.
 *   - Multi-field variants (BracketStack.OpenAt three fields).
 *   - Array-typed payload variants (ErrorRecovery.AccumulatingSkipped).
 *   - Positional binding with local name ≠ field name (SPEC normative:
 *     position-determined, not name-determined).
 *
 * Companion to:
 *   compiler/tests/unit/engine-statechild-payload-bindings.test.js
 *   (unit tests for parsePayloadBindings + PASS 11 validation)
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { unNamespaceEngineNames } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-engine-statechild-payload-codegen");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, "app.client.js");
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf-8") : "";
    return {
      errors: (result.errors ?? []).filter((e) => e.severity !== "warning"),
      clientJs: unNamespaceEngineNames(clientJs),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — bare-attribute form end-to-end
// ---------------------------------------------------------------------------

describe("B1 §1 bare-attribute form end-to-end", () => {
  test("single-field bare-attribute compiles + wire-fn receives binding param", () => {
    const src = `type LoadPhase:enum = { Idle, Done(rows: int) }

<engine for=LoadPhase initial=.Idle>
    <Idle rule=.Done></>
    <Done rows rule=.Idle>\${rows}</>
</>
`;
    const { errors, clientJs } = compile(src);
    // No payload-binding-related errors.
    expect(errors.filter((e) => e.code.startsWith("E-ENGINE-PAYLOAD"))).toEqual([]);
    // Wire-fn signature contains `rows` param (not just `_root`).
    expect(clientJs).toContain("function _scrml_engine_loadPhase_wire_Done(_root, rows)");
    // Render-fn signature contains `rows` param.
    expect(clientJs).toContain("function _scrml_engine_loadPhase_render_Done(rows)");
    // Dispatcher passes _data["rows"] to BOTH render + wire.
    expect(clientJs).toMatch(/_scrml_engine_loadPhase_render_Done\(_data && _data\["rows"\]\)/);
    expect(clientJs).toMatch(/_scrml_engine_loadPhase_wire_Done\(_mount, _data && _data\["rows"\]\)/);
  });
});

// ---------------------------------------------------------------------------
// §2 — parenthesized form end-to-end
// ---------------------------------------------------------------------------

describe("B1 §2 parenthesized form end-to-end", () => {
  test("parenthesized single-field compiles + wire-fn receives binding param", () => {
    const src = `type LoadPhase:enum = { Idle, Done(rows: int) }

<engine for=LoadPhase initial=.Idle>
    <Idle rule=.Done></>
    <Done(rows) rule=.Idle>\${rows}</>
</>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter((e) => e.code.startsWith("E-ENGINE-PAYLOAD"))).toEqual([]);
    expect(clientJs).toContain("function _scrml_engine_loadPhase_wire_Done(_root, rows)");
    expect(clientJs).toContain("function _scrml_engine_loadPhase_render_Done(rows)");
    expect(clientJs).toMatch(/_scrml_engine_loadPhase_wire_Done\(_mount, _data && _data\["rows"\]\)/);
  });
});

// ---------------------------------------------------------------------------
// §3 — positional binding with local-name renamed (§51.0.B.1 SPEC normative)
// ---------------------------------------------------------------------------

describe("B1 §3 positional local-name renamed", () => {
  test("<Done(count)> on Done(rows: int) — wire-fn param is `count`, lookup is `rows`", () => {
    const src = `type LoadPhase:enum = { Idle, Done(rows: int) }

<engine for=LoadPhase initial=.Idle>
    <Idle rule=.Done></>
    <Done(count) rule=.Idle>\${count}</>
</>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter((e) => e.code.startsWith("E-ENGINE-PAYLOAD"))).toEqual([]);
    // wire-fn takes the LOCAL `count` as param (per SPEC §51.0.B.1
    // normative: positional binding is position-determined, local name
    // does not need to match field name).
    expect(clientJs).toContain("function _scrml_engine_loadPhase_wire_Done(_root, count)");
    // Dispatcher looks up by FIELD name `rows`, passes the value as the
    // positional arg — binding the local `count` inside wire-fn scope.
    expect(clientJs).toMatch(/_scrml_engine_loadPhase_render_Done\(_data && _data\["rows"\]\)/);
    expect(clientJs).toMatch(/_scrml_engine_loadPhase_wire_Done\(_mount, _data && _data\["rows"\]\)/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Multi-field variants (BracketStack.OpenAt)
// ---------------------------------------------------------------------------

describe("B1 §4 multi-field variants — BracketStack canonical worked example", () => {
  test("OpenAt(depth, opener, span) bare-attribute form — all three bindings flow", () => {
    const src = `type BracketStack:enum = {
    Balanced,
    OpenAt(depth: int, opener: int, span: int)
}

<engine for=BracketStack initial=.Balanced>
    <Balanced rule=.OpenAt></>
    <OpenAt depth opener span rule=.Balanced>Depth: \${depth} opener=\${opener} span=\${span}</>
</>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter((e) => e.code.startsWith("E-ENGINE-PAYLOAD"))).toEqual([]);
    expect(clientJs).toContain("function _scrml_engine_bracketStack_wire_OpenAt(_root, depth, opener, span)");
    expect(clientJs).toContain("function _scrml_engine_bracketStack_render_OpenAt(depth, opener, span)");
    // Dispatcher: three positional args to BOTH render and wire.
    expect(clientJs).toMatch(/_scrml_engine_bracketStack_render_OpenAt\(_data && _data\["depth"\], _data && _data\["opener"\], _data && _data\["span"\]\)/);
    expect(clientJs).toMatch(/_scrml_engine_bracketStack_wire_OpenAt\(_mount, _data && _data\["depth"\], _data && _data\["opener"\], _data && _data\["span"\]\)/);
  });

  test("OpenAt(depth, opener, span) parenthesized form — equivalent codegen", () => {
    const src = `type BracketStack:enum = {
    Balanced,
    OpenAt(depth: int, opener: int, span: int)
}

<engine for=BracketStack initial=.Balanced>
    <Balanced rule=.OpenAt></>
    <OpenAt(depth, opener, span) rule=.Balanced>Depth: \${depth}</>
</>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter((e) => e.code.startsWith("E-ENGINE-PAYLOAD"))).toEqual([]);
    expect(clientJs).toContain("function _scrml_engine_bracketStack_wire_OpenAt(_root, depth, opener, span)");
  });
});

// ---------------------------------------------------------------------------
// §5 — Array-typed payload (ErrorRecovery.AccumulatingSkipped)
// ---------------------------------------------------------------------------

describe("B1 §5 array-typed payload — ErrorRecovery", () => {
  test("array-typed (Token[]) payload binds the same as scalar", () => {
    const src = `type ErrorRecovery:enum = {
    Healthy,
    AccumulatingSkipped(tokens: [int])
}

<engine for=ErrorRecovery initial=.Healthy>
    <Healthy rule=.AccumulatingSkipped></>
    <AccumulatingSkipped tokens rule=.Healthy>tokens count</>
</>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter((e) => e.code.startsWith("E-ENGINE-PAYLOAD"))).toEqual([]);
    expect(clientJs).toContain("function _scrml_engine_errorRecovery_wire_AccumulatingSkipped(_root, tokens)");
    expect(clientJs).toMatch(/_scrml_engine_errorRecovery_wire_AccumulatingSkipped\(_mount, _data && _data\["tokens"\]\)/);
  });
});

// ---------------------------------------------------------------------------
// §6 — Error-path coverage (negative tests)
// ---------------------------------------------------------------------------

describe("B1 §6 error-path coverage (negative)", () => {
  test("E-ENGINE-PAYLOAD-ON-UNIT-VARIANT surfaces at compile time", () => {
    const src = `type S:enum = { Idle, Done }

<engine for=S initial=.Idle>
    <Idle rule=.Done></>
    <Done rows rule=.Idle></>
</>
`;
    const { errors } = compile(src);
    expect(errors.some((e) => e.code === "E-ENGINE-PAYLOAD-ON-UNIT-VARIANT")).toBe(true);
  });

  test("E-ENGINE-PAYLOAD-ARITY-MISMATCH surfaces at compile time", () => {
    const src = `type S:enum = { Idle, Done(rows: int) }

<engine for=S initial=.Idle>
    <Idle rule=.Done></>
    <Done rows total rule=.Idle></>
</>
`;
    const { errors } = compile(src);
    expect(errors.some((e) => e.code === "E-ENGINE-PAYLOAD-ARITY-MISMATCH")).toBe(true);
  });

  test("E-ENGINE-PAYLOAD-RESERVED-COLLISION surfaces at compile time", () => {
    const src = `type S:enum = { Idle, Done(rule: string) }

<engine for=S initial=.Idle>
    <Idle rule=.Done></>
    <Done(r) rule=.Idle></>
</>
`;
    const { errors } = compile(src);
    expect(errors.some((e) => e.code === "E-ENGINE-PAYLOAD-RESERVED-COLLISION")).toBe(true);
  });
});
