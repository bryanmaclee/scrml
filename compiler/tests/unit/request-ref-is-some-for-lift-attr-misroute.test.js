/**
 * g-request-is-some-in-for-lift-attr-misroute (S340-peter) — the Tier-0
 * `${for…lift}` sibling of request-ref-is-some-each-attr-misroute.
 *
 * A `<request>`-ref inside a `${ for (…) { lift <li …> } }` body attribute —
 * `lift <li class=${<#r>.data is some ? … : …}>` — arrives at codegen as an
 * ESCAPE-HATCH node (`ast-builder.shouldSkipExprParse` skips the `<`-leading
 * expr), and emit-lift.js handed it straight to `emitExprField` → the string
 * fallback mis-routed to the §36 `_scrml_input_state_registry` AND mangled the
 * `is some` LHS (`.get("r").(data !== null && …)`) → E-CODEGEN-INVALID-LOGIC (no
 * client written). LOUD, unlike the silent `<each>` sibling.
 *
 * FIX: emit-lift.js recovers the structured node via `reparseRequestRefEscapeHatch`
 * (gated on the already-threaded `currentLiftRequestIds()`) at its three attr-value
 * `emitExprField` sites (`if=`, `class:NAME=`, generic `${…}` value) — the same
 * reparse the top-level / <each> value/bool/class-attr siblings got — so the ref
 * routes to the reactive `_scrml_request_<id>` object (§6.7.7) while every
 * non-request lift attr stays byte-identical.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `req-is-some-forlift-${++tmpCounter}`;
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
  <rows> = [1, 2]
}
<api src="https://example.com/api" base="/v1">
  getUser(UserQuery) -> GET "/users/\${id}" : UserResult
</api>`;

function withLiftBody(liAttrs) {
  return `${HEADER}
<div>
  <request id="profile" api="getUser" args=@query></>
  <ul>\${ for (let r of @rows) { lift <li ${liAttrs}>x</li>; } }</ul>
</div>
</program>
`;
}

/** Assert: compiled clean (no E-CODEGEN), client written, request routed, no §36 misroute. */
function expectRoutedClean(result, surface = "data") {
  const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
  expect(invalidLogic).toEqual([]);
  const client = firstClientJs(result);
  expect(client).toBeTruthy();
  expect(client).toContain(`_scrml_request_profile.${surface}`);
  expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  // The mangled string-fallback presence-guard shape.
  expect(client).not.toContain('.get("profile").(');
  return client;
}

describe("g-request-is-some-in-for-lift-attr-misroute — request-ref inside a ${for…lift} attr", () => {
  test("for-lift class= attr: `class=${<#profile>.data is some ? …}` compiles clean + routes", () => {
    const result = compileSource(withLiftBody(`class=\${<#profile>.data is some ? "a" : "b"}`));
    expectRoutedClean(result, "data");
  });

  test("for-lift value attr: `data-x=${<#profile>.data is some}` routes", () => {
    const result = compileSource(withLiftBody(`data-x=\${<#profile>.data is some}`));
    expectRoutedClean(result, "data");
  });

  test("for-lift bare member (`.loading`, no predicate) routes", () => {
    const result = compileSource(withLiftBody(`data-x=\${<#profile>.loading}`));
    expectRoutedClean(result, "loading");
  });

  test("for-lift if= directive over a request ref compiles clean + routes", () => {
    const result = compileSource(withLiftBody(`if=\${<#profile>.data is some}`));
    expectRoutedClean(result, "data");
  });

  // §GATE — non-request lift attr stays on its iter-scope lowering; the reparse
  // is registered-request-gated so it must not touch a plain iter ref.
  test("GATE: a non-request for-lift attr is untouched (no request/registry route)", () => {
    const result = compileSource(withLiftBody(`data-plain="pre-\${r.id}-post"`));
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  });
});
