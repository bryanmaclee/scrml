/**
 * g-request-ref-nested-in-lift-misroute (CONVERGENCE, S349-peter) — a `<#request>`
 * ref reached through a Tier-0 LIFT body mis-routed to the §36 input-state registry
 * (`_scrml_input_state_registry.get("<id>")`) instead of the reactive
 * `_scrml_request_<id>` object. The registry symbol is tree-shaken out of the runtime
 * when the file declares no §36 input state, so the emitted client hits a hard
 * ReferenceError at mount that kills the ENTIRE bundle — silently (exit 0, no
 * diagnostic).
 *
 * ROOT CAUSE: the file-global registered-request id set (`collectRequestIds`) was
 * recomputed + hand-threaded per call-site by 3+ independent mechanisms that did NOT
 * cover every control-flow position:
 *   - `EmitExprContext.requestIds` (threaded through emitter opts)
 *   - emit-lift's `_scrml_lift_request_ids_stack` — pushed ONLY by emitIfStmt /
 *     emitForStmt, so `while`/`do…while` lift bodies never carried it
 *   - emit-each's `_eachRequestIds` — set only by emitEachBodyRenderForFile, so an
 *     `<each>` reached FROM a lift body never carried it
 * so a `<#id>` ref reached through a while/do-while lift body, or an `<each>` reached
 * from a lift body, carried an EMPTY set → routed to the registry. Prior fixes (#511,
 * #512) patched individual positions; this re-opened the family twice.
 *
 * FIX (CONVERGENCE — single source of truth, NOT per-path patching): establish the
 * file's registered-request id set ONCE per file at the client-codegen entry
 * (`generateClientJs` → `setCurrentFileRequestIds(collectRequestIds(fileAST))`,
 * cleared to null after). Every `<#id>` request-vs-input-state routing seam in
 * emit-expr (the escape-hatch reparse gate, the bare-`_scrml_input_<id>_` recovery in
 * emitIdent, and the structured `emitInputStateRef`) consults an EFFECTIVE set: the
 * hand-threaded `ctx.requestIds` when non-empty, else this per-file fallback. So every
 * lift-nested / each-in-lift position routes without adding a 4th/5th per-path thread.
 *
 * §GATE (holds by construction): the effective set only ever holds REAL registered
 * request-ids, so a non-request `<#id>` (input-state ref or typo) is never captured and
 * stays on its pre-fix path.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `req-nested-lift-${++tmpCounter}`;
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

function withBody(body) {
  return `${HEADER}
<div>
  <request id="profile" api="getUser" args=@query></>
  ${body}
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
  // The mis-route a `<request>` never populates (dangling → tree-shaken symbol).
  expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  return client;
}

describe("g-request-ref-nested-in-lift-misroute — request-ref reached through a Tier-0 lift body", () => {
  // --- the two reproduced misroutes (banked on HEAD) ---
  test("while-lift TEXT interp: `while (…) { lift <li>${<#profile>.data is some}</li> }` routes to _scrml_request_profile", () => {
    const result = compileSource(withBody(`\${ while (@rows.length > 5) { lift <li>\${<#profile>.data is some}</li> } }`));
    expectRoutedClean(result, "data");
  });

  test("each-in-for-lift value attr routes to _scrml_request_profile", () => {
    const result = compileSource(
      withBody(`\${ for (let r of @rows) { lift <ul><each in=@rows><li data-x=\${<#profile>.data is some}>x</li></each></ul> } }`),
    );
    expectRoutedClean(result, "data");
  });

  // --- do-while parity (the other never-threaded lift kind) ---
  test("do-while-lift TEXT interp routes to _scrml_request_profile", () => {
    const result = compileSource(withBody(`\${ do { lift <li>\${<#profile>.data is some}</li> } while (@rows.length > 5) }`));
    expectRoutedClean(result, "data");
  });

  test("do-while-lift bare `if=` attr routes to _scrml_request_profile", () => {
    const result = compileSource(withBody(`\${ do { lift <li if=\${<#profile>.data is some}>x</li> } while (@rows.length > 5) }`));
    expectRoutedClean(result, "data");
  });

  // --- <each> reached from a while/do-while lift body (emit-each's _eachRequestIds
  //     is never set on this path — covered now by the per-file fallback) ---
  test("each-in-while-lift class:x directive routes to _scrml_request_profile", () => {
    const result = compileSource(
      withBody(`\${ while (@rows.length > 5) { lift <ul><each in=@rows><li class:on=\${<#profile>.data is some}>x</li></each></ul> } }`),
    );
    expectRoutedClean(result, "data");
  });

  test("each-in-do-while-lift TEXT interp routes to _scrml_request_profile", () => {
    const result = compileSource(
      withBody(`\${ do { lift <ul><each in=@rows><li>\${<#profile>.data is some}</li></each></ul> } while (@rows.length > 5) }`),
    );
    expectRoutedClean(result, "data");
  });

  // --- a non-`.data` request surface still routes ---
  test("while-lift TEXT reading `.loading` routes to _scrml_request_profile.loading", () => {
    const result = compileSource(withBody(`\${ while (@rows.length > 5) { lift <li>\${<#profile>.loading}</li> } }`));
    expectRoutedClean(result, "loading");
  });

  // --- each-in-each-in-for-lift (nested collection reach) ---
  test("each-in-each-in-for-lift value attr routes to _scrml_request_profile", () => {
    const result = compileSource(
      withBody(
        `\${ for (let r of @rows) { lift <ul><each in=@rows><li><each in=@rows><span data-x=\${<#profile>.data is some}>y</span></each></li></each></ul> } }`,
      ),
    );
    expectRoutedClean(result, "data");
  });

  // §GATE — the routing is gated on a REGISTERED request id. A non-request `<#id>`
  // (a typo whose id is NOT a `<request>` in this file) must NOT be routed to the
  // request path, even reached through the never-threaded lift kinds.
  test("GATE: a non-request `<#id>` in a while-lift TEXT is NOT routed to the request path", () => {
    const result = compileSource(withBody(`\${ while (@rows.length > 5) { lift <li>\${<#notareq>.data is some}</li> } }`));
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    // The typo id must not be lifted into a request-state object; it stays on the
    // §36 input-state path (`_scrml_input_state_registry.get("notareq")`).
    expect(client).not.toContain("_scrml_request_notareq");
    expect(client).toContain('_scrml_input_state_registry.get("notareq")');
  });

  test("GATE: a non-request `<#id>` in an each-in-do-while-lift attr is NOT routed to the request path", () => {
    const result = compileSource(
      withBody(`\${ do { lift <ul><each in=@rows><li data-x=\${<#notareq>.data is some}>x</li></each></ul> } while (@rows.length > 5) }`),
    );
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    expect(client).not.toContain("_scrml_request_notareq");
  });
});
