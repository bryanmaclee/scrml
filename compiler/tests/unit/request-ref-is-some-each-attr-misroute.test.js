/**
 * g-request-is-some-in-each-loop-attr-misroute (S340-peter) — the PER-ITEM
 * `<each>`/`<for>`-body sibling of request-ref-is-some-value-bool-class-attr-misroute.
 *
 * A `<request>`-ref member used inside a per-item `<each>` body attribute —
 * `<li class=${<#r>.data is some ? … : …}>`, `<li data-x=${<#r>.data is some}>` —
 * mis-routed: `renderTemplateAttrToJs`'s per-item lowering (`lowerEachExpr`)
 * already parsed the ref node but called `emitExprField` WITHOUT `requestIds`, so
 * `emitExpr` defaulted the registered `<#r>` node to the §36
 * `_scrml_input_state_registry` (which a `<request>` never populates →
 * `undefined.data` → runtime TypeError). A SILENT MISCOMPILE (compiled clean,
 * exit 0), unlike the LOUD value/bool/class-attr sibling.
 *
 * FIX: thread the file's registered-request id set (`collectRequestIds`) onto the
 * module-level each ctx (`_eachRequestIds`), read by `lowerEachExpr`, gated on a
 * registered `<#id>` (`rawReferencesRegisteredRequest`) so the ref routes to the
 * reactive `_scrml_request_<id>` object (§6.7.7) while EVERY non-request each-attr
 * stays byte-identical.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `req-is-some-each-${++tmpCounter}`;
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

function withEachBody(liAttrs) {
  return `${HEADER}
<div>
  <request id="profile" api="getUser" args=@query></>
  <ul><each in=@rows><li ${liAttrs}>x</li></each></ul>
</div>
</program>
`;
}

/** Assert: compiled clean, client written, request routed, no §36 misroute. */
function expectRoutedClean(result, surface = "data") {
  const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
  expect(invalidLogic).toEqual([]);
  const client = firstClientJs(result);
  expect(client).toBeTruthy();
  expect(client).toContain(`_scrml_request_profile.${surface}`);
  // The mis-route a `<request>` never populates.
  expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  return client;
}

describe("g-request-is-some-in-each-loop-attr-misroute — request-ref inside a per-item each attr", () => {
  test("each-body class= attr: `<li class=${<#profile>.data is some ? …}>` routes to _scrml_request_profile", () => {
    const result = compileSource(withEachBody(`class=\${<#profile>.data is some ? "ready" : "wait"}`));
    expectRoutedClean(result, "data");
  });

  test("each-body value attr: `<li data-x=${<#profile>.data is some}>` routes to _scrml_request_profile", () => {
    const result = compileSource(withEachBody(`data-x=\${<#profile>.data is some}`));
    expectRoutedClean(result, "data");
  });

  test("each-body other request surface (`.loading`) routes too", () => {
    const result = compileSource(withEachBody(`data-x=\${<#profile>.loading}`));
    expectRoutedClean(result, "loading");
  });

  // §GATE — the reparse is gated on a REGISTERED request id. A non-request each
  // attr (plain iter ref) must stay on its per-item iter-scope lowering
  // (`_scrml_each_item`) and must NOT reach the request/input-state paths at all.
  test("GATE: a non-request each attr is untouched (iter-scope lowering, no request/registry route)", () => {
    const result = compileSource(withEachBody(`data-plain="pre-\${@.id}-post"`));
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    expect(client).toContain("_scrml_each_item.id");
    expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  });
});
