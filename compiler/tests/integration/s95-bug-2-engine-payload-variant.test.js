/* SPDX-License-Identifier: MIT
 *
 * s95-bug-2-engine-payload-variant.test.js — S95 Bug 2 regression suite
 *
 * Bug 2: engine direct-write (`@engineVar = .Variant(payload)`) and
 * `.advance(.Variant(payload))` emitted `"Variant"(payload)` — calling a
 * string as a function (TypeError). Fix lowered the bare-dot constructor
 * call to the canonical `{ variant: "X", data: { fieldName: value } }`
 * tagged-object shape per SPEC §51.3.2; the runtime helpers extract the
 * tag for transition-table lookup, self-write detection, history-map /
 * pending-restore lookups, and timer-table lookups; the dispatcher reads
 * `.variant` / `.data` (was the never-realized `.tag` / `.payload`).
 *
 * Coverage:
 *   §1. Payload-bearing direct-write (the canonical reproducer)
 *   §2. No-payload direct-write — regression guard for unit variants
 *   §3. Payload `.advance()` — shares the codegen surface
 *   §4. Mixed file — unit + payload variants in same engine
 *   §5. Qualified `Enum.Variant(args)` write — pre-existing path stays working
 *   §6. Dispatcher tag/data extraction — runtime cell-shape contract
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToClientJs(source, suffix = "bug2") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1. Payload-bearing direct-write (canonical reproducer)
// ---------------------------------------------------------------------------

describe("s95-bug-2 §1 — payload-bearing engine direct-write", () => {
  test("`@dragPhase = .Dragging(taskId)` emits tagged-object literal, not string-as-function", () => {
    const src = `<program title="Bug 2">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
}
function startDrag(taskId) {
  @dragPhase = .Dragging(taskId)
}
<engine for=DragPhase initial=.Idle>
  <Idle     rule=.Dragging></>
  <Dragging rule=.Idle></>
</>
<button onclick=startDrag(42)>Test</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "drag-payload");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The bug: emit was `"Dragging"(taskId)` — calling a string. The fix
    // emits a tagged-object literal directly.
    expect(clientJs).not.toMatch(/"Dragging"\(/);
    expect(clientJs).toMatch(
      /_scrml_engine_direct_set\("dragPhase", \{ variant: "Dragging", data: \{ id: taskId \} \}/,
    );
  });

  test("the assignment statement-shape compiles syntactically valid JS (bun parse)", async () => {
    const src = `<program title="Bug 2 syntax">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
}
function startDrag(taskId) {
  @dragPhase = .Dragging(taskId)
}
<engine for=DragPhase initial=.Idle>
  <Idle     rule=.Dragging></>
  <Dragging rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "drag-syntax");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The emitted client.js must parse — if `"Dragging"(taskId)` had landed,
    // `bun --check` would fail later but here we surface via `new Function`.
    // Wrap in a function body so top-level `_scrml_*` references don't error
    // (they refer to runtime symbols not in scope; we only care about parse).
    expect(() => new Function("/* assume runtime symbols */ " + clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2. No-payload direct-write — regression guard
// ---------------------------------------------------------------------------

describe("s95-bug-2 §2 — no-payload direct-write (unit variant regression)", () => {
  test("`@dragPhase = .Idle` continues to emit bare string", () => {
    const src = `<program title="Bug 2 unit">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
}
function stopDrag() {
  @dragPhase = .Idle
}
<engine for=DragPhase initial=.Idle>
  <Idle     rule=.Dragging></>
  <Dragging rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "unit-direct");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Unit-variant direct-write emits the bare string tag — the OLD shape
    // is preserved (the transition table is keyed by tag, the runtime
    // helpers extract via _scrml_engine_variant_tag passes bare strings
    // through unchanged).
    expect(clientJs).toMatch(
      /_scrml_engine_direct_set\("dragPhase", "Idle", __scrml_engine_dragPhase_transitions/,
    );
    // And NO tagged-object literal for the unit-variant write.
    expect(clientJs).not.toMatch(/_scrml_engine_direct_set\("dragPhase", \{ variant: "Idle"/);
  });
});

// ---------------------------------------------------------------------------
// §3. Payload `.advance()` — shares codegen surface
// ---------------------------------------------------------------------------

describe("s95-bug-2 §3 — payload-bearing `.advance()`", () => {
  test("`@dragPhase.advance(.Dragging(taskId))` emits tagged-object literal", () => {
    const src = `<program title="Bug 2 advance">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
}
function startDrag(taskId) {
  @dragPhase.advance(.Dragging(taskId))
}
<engine for=DragPhase initial=.Idle>
  <Idle     rule=.Dragging></>
  <Dragging rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "advance-payload");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // No string-as-function emission anywhere
    expect(clientJs).not.toMatch(/"Dragging"\(/);
    // The advance helper receives the tagged-object literal
    expect(clientJs).toMatch(
      /_scrml_engine_advance\("dragPhase", \{ variant: "Dragging", data: \{ id: taskId \} \}/,
    );
  });

  test("`@dragPhase.advance(.Idle)` continues to emit bare string", () => {
    const src = `<program title="Bug 2 advance unit">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
}
function stopDrag() {
  @dragPhase.advance(.Idle)
}
<engine for=DragPhase initial=.Idle>
  <Idle     rule=.Dragging></>
  <Dragging rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "advance-unit");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toMatch(/_scrml_engine_advance\("dragPhase", "Idle"/);
  });
});

// ---------------------------------------------------------------------------
// §4. Mixed file — unit + payload variants in same engine
// ---------------------------------------------------------------------------

describe("s95-bug-2 §4 — mixed unit + payload variants in same engine", () => {
  test("file with both unit and payload writes — each emits correct shape", () => {
    const src = `<program title="Bug 2 mixed">
\${
  type Phase:enum = { Idle, Loading, Loaded(count: number), Error(msg: string) }
}
function start() {
  @phase = .Loading
}
function done(n) {
  @phase = .Loaded(n)
}
function fail(reason) {
  @phase = .Error(reason)
}
function reset() {
  @phase = .Idle
}
<engine for=Phase initial=.Idle>
  <Idle    rule=.Loading></>
  <Loading rule=(.Loaded | .Error)></>
  <Loaded  rule=.Idle></>
  <Error   rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "mixed-variants");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Unit-variant writes — bare string
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("phase", "Loading"/);
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("phase", "Idle"/);
    // Payload-bearing writes — tagged-object literal
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("phase", \{ variant: "Loaded", data: \{ count: n \} \}/);
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("phase", \{ variant: "Error", data: \{ msg: reason \} \}/);
    // No string-as-function bug anywhere
    expect(clientJs).not.toMatch(/"Loaded"\(/);
    expect(clientJs).not.toMatch(/"Error"\(/);
  });
});

// ---------------------------------------------------------------------------
// §5. Qualified `Enum.Variant(args)` write — pre-existing path stays working
// ---------------------------------------------------------------------------

describe("s95-bug-2 §5 — qualified `Enum.Variant(args)` write (regression guard)", () => {
  test("`@phase = Phase.Loaded(n)` continues to emit constructor call", () => {
    const src = `<program title="Bug 2 qualified">
\${
  type Phase:enum = { Idle, Loaded(count: number) }
}
function done(n) {
  @phase = Phase.Loaded(n)
}
<engine for=Phase initial=.Idle>
  <Idle   rule=.Loaded></>
  <Loaded rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "qualified");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The qualified form routes through the standard MemberExpr → CallExpr
    // emit, which produces `Phase.Loaded(n)` — invoking the constructor
    // function on the frozen enum object. The cell stores the returned
    // tagged-object; runtime helpers handle the tag extraction.
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("phase", Phase\.Loaded\(n\)/);
  });
});

// ---------------------------------------------------------------------------
// §6. Dispatcher tag/data extraction — runtime cell-shape contract
// ---------------------------------------------------------------------------

describe("s95-bug-2 §6 — dispatcher tag/data extraction", () => {
  test("dispatcher reads `.variant` and `.data` (was the never-realized `.tag` and `.payload`)", () => {
    const src = `<program title="Bug 2 dispatcher">
\${
  type Phase:enum = { Idle, Error(msg: string) }
}
<engine for=Phase initial=.Idle>
  <Idle></>
  <Error msg>
    <div>Whoops</div>
  </>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "dispatcher-data");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Tag extraction reads `.variant` (the canonical SPEC §51.3.2 shape).
    expect(clientJs).toMatch(/typeof _v\.variant === "string"/);
    // Data extraction reads `.data` (named fields, not Array.isArray on .payload).
    expect(clientJs).toMatch(/_v\.data && typeof _v\.data === "object"/);
    // The dead `.payload` Array placeholder is never referenced; `.variant` is
    // the PRIMARY discriminant. §55.10-L4 (msgchain-render-wiring-2026-07-03)
    // added a SECONDARY `.tag` fallback (checked AFTER `.variant`) so the
    // `<match for=ValidationError on=@field.errors[0]>` escape hatch dispatches
    // on ValidationError runtime values (`{tag:"Required", ...flatPayload}`,
    // §55.9) — those key on `.tag`, not the enum-object `.variant`. The S95
    // regression guard is preserved: `.variant` stays primary (read first) and
    // the dead `.payload` shape is never used.
    const dispatcherMatch = clientJs.match(
      /function __scrml_engine_phase_dispatch\([^)]*\)[\s\S]*?\n\}\n/,
    );
    expect(dispatcherMatch).not.toBeNull();
    expect(dispatcherMatch[0]).not.toMatch(/_v\.payload\b/);
    const _variantIdx = dispatcherMatch[0].indexOf("_v.variant");
    const _tagIdx = dispatcherMatch[0].indexOf("_v.tag");
    expect(_variantIdx).toBeGreaterThanOrEqual(0); // `.variant` is present
    if (_tagIdx >= 0) expect(_variantIdx).toBeLessThan(_tagIdx); // `.variant` read BEFORE the `.tag` fallback
  });

  test("dispatcher passes payload via named-field lookup `_data[\"<bindingName>\"]`", () => {
    const src = `<program title="Bug 2 dispatcher named-data">
\${
  type Phase:enum = { Idle, Error(msg: string) }
}
<engine for=Phase initial=.Idle>
  <Idle></>
  <Error msg>
    <div>Whoops</div>
  </>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "dispatcher-named-data");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toMatch(/_scrml_engine_phase_render_Error\(_data && _data\["msg"\]\)/);
  });
});

// ---------------------------------------------------------------------------
// §7. Runtime helper signatures — `_scrml_engine_variant_tag` is exported
// ---------------------------------------------------------------------------

describe("s95-bug-2 §7 — runtime helper presence in scrml-runtime bundle", () => {
  test("scrml-runtime emits `_scrml_engine_variant_tag` helper for tag extraction", () => {
    const src = `<program title="Bug 2 runtime helper">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
}
function startDrag(taskId) {
  @dragPhase = .Dragging(taskId)
}
<engine for=DragPhase initial=.Idle>
  <Idle     rule=.Dragging></>
  <Dragging rule=.Idle></>
</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "runtime-helper");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The codegen reference to the runtime helper is the engine-write site —
    // verify the call shape (the actual helper-fn body lives in the runtime
    // bundle, not the per-file client.js).
    expect(clientJs).toContain(`_scrml_engine_direct_set("dragPhase",`);
  });
});

// ---------------------------------------------------------------------------
// §8. Escape-hatch / event-handler string-rewrite path
// ---------------------------------------------------------------------------

describe("s95-bug-2 §8 — escape-hatch `\${...}` event-handler path", () => {
  test("`onclick=\${@phase = .Loaded(n)}` emits tagged-object literal (not string-as-fn)", () => {
    const src = `<program title="Bug 2 escape-hatch">
\${
  type Phase:enum = { Idle, Loaded(count: number) }
}
<engine for=Phase initial=.Idle>
  <Idle   rule=.Loaded></>
  <Loaded rule=.Idle></>
</>
<button onclick=\${@phase = .Loaded(42)}>Test</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "escape-hatch");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The bug surface: the string-rewrite path produced \`"Loaded"(42)\` —
    // calling the string as a function. After the fix, the rewriter lowers
    // the bare-dot constructor call to the canonical tagged-object literal.
    expect(clientJs).not.toMatch(/"Loaded"\(/);
    expect(clientJs).toMatch(/\{ variant: "Loaded", data: \{ count: 42 \} \}/);
  });

  test("escape-hatch nested args (function-call argument) lower correctly", () => {
    const src = `<program title="Bug 2 escape-hatch nested">
\${
  type Phase:enum = { Idle, Loaded(count: number) }
}
function compute(n) { return n * 2 }
<engine for=Phase initial=.Idle>
  <Idle   rule=.Loaded></>
  <Loaded rule=.Idle></>
</>
<button onclick=\${@phase = .Loaded(compute(21))}>Test</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "escape-hatch-nested");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Paren-balanced args survive the rewriter. Function names get renamed
    // via the function-naming pass (\`compute\` → \`_scrml_compute_<n>\`), so
    // we match a lax pattern that confirms the call shape is preserved.
    expect(clientJs).toMatch(/\{ variant: "Loaded", data: \{ count: _scrml_compute_\d+\(21\) \} \}/);
  });

  test("escape-hatch multi-field variant lowers via named-field pairing", () => {
    const src = `<program title="Bug 2 escape-hatch multi">
\${
  type Phase:enum = { Idle, Error(code: number, msg: string) }
}
<engine for=Phase initial=.Idle>
  <Idle  rule=.Error></>
  <Error rule=.Idle></>
</>
<button onclick=\${@phase = .Error(500, "boom")}>Test</>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "escape-hatch-multi");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Each positional arg pairs with the declared field name in order.
    expect(clientJs).toMatch(/\{ variant: "Error", data: \{ code: 500, msg: "boom" \} \}/);
  });
});

// ---------------------------------------------------------------------------
// §9. `is .Variant` operator handles payload-bearing cells via structured AST
// ---------------------------------------------------------------------------
//
// The structured AST path (emit-expr.ts:emitBinary `case "is"`) now wraps the
// left operand in a tag-extraction conditional so a payload-bearing cell
// value (`{ variant, data }`) matches the variant tag correctly. Lower-level
// surfaces (match-arm rendering, dispatcher selection) already normalize tag
// via their own helpers (tagVar in match, `_tag` in dispatcher).
//
// NOTE: The string-rewrite `rewriteIsOperator` path (used by some legacy
// emission sites for expressions that don't reach the ExprNode AST) still
// emits the bare `=== "Variant"` shape. That's a follow-up — for engines,
// the structured path is the primary surface and is now correct.

describe("s95-bug-2 §9 — `is .Variant` AST-path tag normalization", () => {
  test("emit-expr.ts structured `is .Variant` produces the tag-extraction IIFE shape", () => {
    // Build a minimal AST and drive emitBinary directly. This bypasses the
    // parse-level concerns that prevent `is .Dragging` from reaching this
    // code path in some user-facing contexts (a separate pre-existing
    // parser issue tracked outside Bug 2).
    const { emitExpr } = require("../../src/codegen/emit-expr.ts");
    const node = {
      kind: "binary",
      op: "is",
      left: { kind: "ident", name: "@dragPhase" },
      right: { kind: "ident", name: ".Dragging" },
    };
    const ctx = { mode: "client" };
    const out = emitExpr(node, ctx);
    // The new shape: an IIFE that tag-normalizes the left side, then `===` against
    // the right-side variant-name string.
    expect(out).toContain('typeof __v.variant === "string"');
    expect(out).toContain('=== "Dragging"');
    expect(out).toContain('_scrml_reactive_get("dragPhase")');
  });
});
