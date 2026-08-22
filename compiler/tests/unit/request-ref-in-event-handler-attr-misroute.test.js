/**
 * g-request-ref-in-lift-event-handler-attr-misroute (S362-peter) — the
 * event-handler seam of the request-ref-attr-misroute family, the one attr-value
 * position left unpatched after the value/bool/class/if siblings (S340).
 *
 * A `<#id>`-leading EVENT-HANDLER attr — `onclick=${<#profile>.reload()}` — arrives
 * at codegen as an ESCAPE-HATCH node (`ast-builder.shouldSkipExprParse` skips the
 * `<`-leading expr). The two event-handler emitters handed that node straight to
 * `emitExprField`, taking the string fallback that mis-routes the ref to the §36
 * `_scrml_input_state_registry` — a registry a `<request>` NEVER populates, and
 * which is not even declared in a request-only bundle → a ReferenceError at click,
 * SILENT at exit 0 (client written, no diagnostic).
 *
 * Two seams, both fixed to recover the structured node via the same reparse the
 * value/bool/class/if siblings use, gated to registered `<request>` ids:
 *   - top-level: emit-event-wiring.ts (the `_scrml_boot()` handler-body emitter)
 *   - for-lift / <each>: emit-lift.js `emitCreateElementFromMarkup` on-event branch
 *
 * The ref then routes to the reactive `_scrml_request_<id>` object (§6.7.7); every
 * non-request handler emits byte-identically (the reparse is registered-request-gated).
 *
 * Each positive case asserts the ACTUAL HANDLER LINE (the `addEventListener` /
 * `_scrml_change_handlers` body that reads `profile`) routes to `_scrml_request_profile`
 * — a negative `not.toContain(registry)` alone is near-vacuous (an errored compile
 * satisfies it), so the load-bearing signal is the positive route on the handler line.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `req-evt-handler-${++tmpCounter}`;
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

/** The emitted handler line(s) that mention the request id `profile`. */
function handlerLinesFor(client) {
  return (client ?? "")
    .split("\n")
    .filter((l) => l.includes("profile") && (l.includes("addEventListener") || l.includes("function(event)") || l.includes("reload")));
}

const HEADER = `<program>
\${
  type UserQuery:struct = { id: int }
  type UserResult:enum = { Found(name: string, email: string) NotFound }
  <query>: UserQuery = { id: 1 }
  <rows> = [1, 2]
  <count> = 0
}
<api src="https://example.com/api" base="/v1">
  getUser(UserQuery) -> GET "/users/\${id}" : UserResult
</api>`;

const topLevel = (attrs) => `${HEADER}
<div>
  <request id="profile" api="getUser" args=@query></>
  <button ${attrs}>go</button>
</div>
</program>
`;
const forLift = (attrs) => `${HEADER}
<div>
  <request id="profile" api="getUser" args=@query></>
  <ul>\${ for (let r of @rows) { lift <li ${attrs}>x</li>; } }</ul>
</div>
</program>
`;
/**
 * Assert: compiled clean, client written, a handler that reads `profile` was
 * emitted, and it routes to the reactive `_scrml_request_profile` object — NOT the
 * §36 registry. The POSITIVE `_scrml_request_profile` route on the handler is the
 * load-bearing signal (a bare `not.toContain(registry)` alone is near-vacuous — an
 * errored compile satisfies it); the clean-compile + handler-present checks are what
 * make the negative meaningful.
 */
function expectHandlerRouted(result) {
  const invalidLogic = (result.errors ?? []).filter(
    (e) => e.code === "E-CODEGEN-INVALID-LOGIC" || e.code === "E-SCOPE-001",
  );
  expect(invalidLogic).toEqual([]);
  const client = firstClientJs(result);
  expect(client).toBeTruthy();
  // A handler reading the request was actually emitted (guards against a compile
  // that routed nothing at all still satisfying the negative registry assertion).
  const handlerLines = handlerLinesFor(client);
  expect(handlerLines.length).toBeGreaterThan(0);
  // Load-bearing: the request ref routes to its reactive object, and nowhere in the
  // client does it misroute to the §36 input-state registry.
  expect(client).toContain("_scrml_request_profile");
  expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  return client;
}

describe("g-request-ref-in-lift-event-handler-attr-misroute — <#request>-leading event handlers", () => {
  test("top-level onclick call: `onclick=${<#profile>.reload()}` routes on the handler line (emit-event-wiring seam)", () => {
    expectHandlerRouted(compileSource(topLevel(`onclick=\${<#profile>.reload()}`)));
  });

  test("for-lift onclick call routes (emit-lift on-event seam)", () => {
    expectHandlerRouted(compileSource(forLift(`onclick=\${<#profile>.reload()}`)));
  });

  test("event-name agnostic: for-lift oninput routes the same way as onclick", () => {
    expectHandlerRouted(compileSource(forLift(`oninput=\${<#profile>.reload()}`)));
  });

  // S362 GUARD (regression pin) — a MULTI-STATEMENT `<#id>`-leading handler cannot
  // reparse to a single ExprNode without dropping the trailing statements, so the
  // reparse is skipped and the whole body is preserved on its pre-fix path. Without
  // the `rawHasTopLevelStatementSep` guard the reparse routed `<#profile>.reload()`
  // but SILENTLY DROPPED `; other()` — a misroute→truncation trade-down.
  test("GUARD: a multi-statement handler keeps ALL its statements (no truncation)", () => {
    const client = compileSource(topLevel(`onclick=\${<#profile>.reload(); doOther()}`));
    const c = firstClientJs(client);
    expect(c).toBeTruthy();
    // Both statements survive (the guard leaves this rare shape on its pre-fix path).
    expect(c).toContain("reload()");
    expect(c).toContain("doOther()");
  });

  // §GATE — the reparse is registered-request-gated: a non-request handler must NOT
  // be wired to any request object (a valid reactive-assign handler compiles clean).
  test("GATE: a non-request handler is untouched (no request/registry route)", () => {
    const result = compileSource(topLevel(`onclick=\${@count = @count + 1}`));
    const invalidLogic = (result.errors ?? []).filter(
      (e) => e.code === "E-CODEGEN-INVALID-LOGIC" || e.code === "E-SCOPE-001",
    );
    expect(invalidLogic).toEqual([]);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
    expect(client).not.toContain("_scrml_request_profile.reload");
  });
});
