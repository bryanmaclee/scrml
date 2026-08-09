/**
 * g-request-is-some-in-value-bool-class-attr — the VALUE / BOOLEAN / CLASS-attr
 * siblings of the S312 `if=`-attr fix (request-ref-is-some-if-attr-misroute.test.js).
 *
 * A `<request>`-ref member used as an `is`-predicate LHS inside a value/boolean/
 * class attribute — `disabled=${<#r>.data is some}`, `class=${<#r>.data is some ?
 * … : …}`, `value=${<#r>.data is some}`, `class:on=${<#r>.data is some}` — reached
 * codegen as an ESCAPE-HATCH (`ast-builder.shouldSkipExprParse` skips the `<#`-
 * leading expr). Pre-fix the escape-hatch → string fallback both mis-routed the
 * ref to the §36 `_scrml_input_state_registry` AND mangled the `is some` LHS into
 *   _scrml_input_state_registry.get("r").(data !== null && data !== undefined)
 * → the BOOLEAN attr aborted the whole compile with E-CODEGEN-INVALID-LOGIC (no
 * client bundle written), while the VALUE / plain-CLASS attr was silently DROPPED
 * (W-CG-VALUE-ATTR-UNLOWERABLE) because the lowerability probe mangled the same
 * escape-hatch.
 *
 * FIX (shared substrate `reparseRequestRefEscapeHatch`): every attribute callsite
 * — the value-attr lowerability probe (emit-html), the reactive-bool-attr toggle
 * + reactive-value-attr write (emit-event-wiring), and the class: directive
 * (emit-bindings, both the top-level and match-arm-condition helpers) — re-parses
 * the `<#`-bearing escape-hatch and threads `requestIds`, so the ref routes to the
 * reactive `_scrml_request_<r>` object (§6.7.7), lowering IDENTICALLY to the `if=`
 * / `${...}` text-interpolation paths. Scoped to `<#`-bearing raws so every other
 * escape-hatch attribute value stays byte-identical.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `req-is-some-vbc-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    return compileScrml({ inputFiles: [tmpInput], outDir: tmpDir, emitClient: true, emitServer: false });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function firstClientJs(result) {
  for (const out of result.outputs?.values?.() ?? []) {
    if (out?.clientJs) return out.clientJs;
  }
  return null;
}

const HEADER = `<program>
\${
  type UserQuery:struct = { id: int }
  type UserResult:enum = { Found(name: string, email: string) NotFound }
  <query>: UserQuery = { id: 1 }
}
<api src="https://example.com/api" base="/v1">
  getUser(UserQuery) -> GET "/users/\${id}" : UserResult
</api>`;

function withBody(body) {
  return `${HEADER}
<div>
  <request id="profile" api="getUser" args=@query></>
  ${body}
</div>
</program>
`;
}

/** Assert: compiled clean, client written, routed to _scrml_request_profile, no misroute/mangle. */
function expectRoutedClean(result) {
  const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
  expect(invalidLogic).toEqual([]);
  const client = firstClientJs(result);
  expect(client).toBeTruthy(); // .client.js written, not left stale / dropped
  // Correct target — the reactive request object routes the `.data` member.
  expect(client).toContain("_scrml_request_profile.data");
  // The mis-route (a <request> never populates the §36 input-state registry).
  expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  // The mangled string-fallback presence guard shape (`.(` right after `get()`).
  expect(client).not.toContain('.get("profile").(');
  return client;
}

describe("g-request-is-some-in-value-bool-class-attr — is-some on value/bool/class attrs", () => {
  test("BOOLEAN attr: `disabled=${<#profile>.data is some}` routes + compiles clean", () => {
    const result = compileSource(withBody(`<button disabled=\${<#profile>.data is some}>go</button>`));
    const client = expectRoutedClean(result);
    // The absence-presence lowering the emitter wraps (matches the if= reference).
    expect(client).toContain('el.setAttribute("disabled", "")');
  });

  test("VALUE attr (plain class=): `class=${<#profile>.data is some ? \"a\" : \"b\"}` routes + is NOT dropped", () => {
    const result = compileSource(withBody(`<div class=\${<#profile>.data is some ? "a" : "b"}>x</div>`));
    const client = expectRoutedClean(result);
    // The value-attr binding must exist (pre-fix the lowerability probe DROPPED it).
    expect(client).toContain("data-scrml-bind-attr-class");
  });

  test("VALUE attr (form-control value=): `value=${<#profile>.data is some}` routes to _scrml_request_profile", () => {
    const result = compileSource(withBody(`<input value=\${<#profile>.data is some}/>`));
    expectRoutedClean(result);
  });

  test("CLASS directive: `class:on=${<#profile>.data is some}` routes to _scrml_request_profile", () => {
    const result = compileSource(withBody(`<div class:on=\${<#profile>.data is some}>x</div>`));
    expectRoutedClean(result);
  });

  test("the OTHER request-state surfaces (`.loading`/`.error`) route on the bool attr too", () => {
    const result = compileSource(withBody(`<button disabled=\${<#profile>.error is some}>go</button>`));
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    expect(client).toContain("_scrml_request_profile.error");
    expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  });
});

// ---------------------------------------------------------------------------
// §GATE — the reparse is gated on a REGISTERED request id, NOT bare `<#`.
// A non-request `<#id>` (input-state ref or typo) must NOT be reparsed onto the
// structured path: for a typo that would emit `_scrml_input_state_registry.get(
// "typo").data` -> `undefined.data` -> a runtime TypeError in the reactive effect
// (strictly worse than the pre-fix value-attr-probe DROP); for a real input-state
// ref it must stay byte-on its pre-fix string-fallback lowering. This is the
// S239-round-2 critical-regression guard.
// ---------------------------------------------------------------------------

describe("g-request-is-some-in-value-bool-class-attr — reparse gated on registered request id", () => {
  test("MISTYPED request id in a VALUE attr is DROPPED, never emitting a crashing registry read", () => {
    // `<#profileTYPO>` names no registered request -> the value-attr lowerability
    // probe keeps the escape-hatch (no reparse) -> mangled -> DROPPED (pre-fix
    // behavior), NOT `_scrml_input_state_registry.get("profileTYPO").data` which
    // would be `undefined.data` at runtime.
    const result = compileSource(withBody(`<div class=\${<#profileTYPO>.data is some ? "a" : "b"}>x</div>`));
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]); // value attr drops rather than aborting
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    // No crashing registry read for the unregistered id, and no phantom request obj.
    expect(client).not.toContain('_scrml_input_state_registry.get("profileTYPO")');
    expect(client).not.toContain("_scrml_request_profileTYPO");
  });

  test("a real INPUT-STATE ref `<#field>.value` in a VALUE attr routes to the §36 registry, NOT reparsed to a request obj", () => {
    // `<#field>` is an input-state ref (a text input), not a <request>. The gate
    // returns the original escape-hatch node so it keeps its pre-fix string
    // fallback -> the §36 registry, never `_scrml_request_field`.
    const src = `<program>
\${ <name>: string = "" }
<div>
  <input type="text" bind:value=@name id="field"/>
  <span title=\${<#field>.value}>t</span>
</div>
</program>
`;
    const result = compileSource(src);
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    // Input-state refs live in the §36 registry — the gate must NOT hijack them.
    expect(client).not.toContain("_scrml_request_field");
  });

  test("REGRESSION (S239 round-3): input-state `if=<#field>.value is some` toggle stays UNGATED (S312) — compiles clean", () => {
    // The `if=`/`show=` regime must reparse ANY `<#`-leading escape-hatch (request
    // OR input-state), UNGATED — exactly what S312 shipped. Gating it to registered
    // requests (a round-2 over-reach) aborted an input-state `is some` toggle with
    // E-CODEGEN-INVALID-LOGIC (the string fallback mangles the `is some` LHS). This
    // pins the input-state toggle back to clean-compile with the `is some` LHS
    // preserved over the §36 registry read.
    const src = `<program>
\${ <name>: string = "" }
<div>
  <input type="text" bind:value=@name id="field"/>
  <p if=\${<#field>.value is some}>has</p>
  <p show=\${<#field>.value is not}>empty</p>
</div>
</program>
`;
    const result = compileSource(src);
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]); // the round-3 regression would make this fail
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    // The is-some presence check is preserved over the §36 registry read (S312).
    expect(client).toContain('_scrml_input_state_registry.get("field").value');
    // An input-state ref is NOT a request object.
    expect(client).not.toContain("_scrml_request_field");
  });
});
