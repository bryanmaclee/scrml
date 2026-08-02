/**
 * g-request-data-is-some-misroute (S312) — a `<request>`/input-state ref member
 * used as an `is`-predicate LHS in an `if=` ATTRIBUTE (`if=<#r>.data is some`)
 * miscompiled to invalid JS and shipped a stale client.
 *
 * WITNESS: adopter assetManagement (S67 Portal deploy) — `is some` on fetched
 * data reported "server compiled, client stayed stale, no error." The PA-repro
 * on `d949f06c`: `<request id="r">` + `<div if=${<#r>.data is some}>` emitted
 *   _scrml_input_state_registry.get("r").(data !== null && data !== undefined)
 * → E-CODEGEN-INVALID-LOGIC, NO `.client.js` written → the previously-built
 * client bundle left STALE (a green server + a silently-not-regenerated client).
 *
 * ROOT CAUSE — two coupled defects, both on the ATTRIBUTE path (the `${...}`
 * text-interpolation path was already correct):
 *
 *  1. PARSE. `rewriteIsPredicates` runs on the RAW string BEFORE `parseExpression`
 *     normalizes `<#id>` → `__scrml_input_id__`, so `scanLhsLeft` met the sigil's
 *     own `>` and read it as a chain terminator — fragmenting `<#r>.data is some`
 *     to a bare `.data` LHS (`<#r>.__scrml_is_some__(.data)` → acorn ParseError).
 *     AND `ast-builder.shouldSkipExprParse` skipped ANY expr starting with `<`
 *     (an HTML-fragment guard) — including the `<#id>` sigil — so the attribute's
 *     exprNode was an escape-hatch (SkippedExpr) that fell to the string pipeline.
 *  2. ROUTE. `emit-event-wiring`'s `if=` toggle-condition lowering did not thread
 *     `requestIds`, so even a well-formed member routed `<#r>` to the §36
 *     input-state registry (which a `<request>` never populates) rather than the
 *     reactive `_scrml_request_<r>` object.
 *
 * FIX: scanLhsLeft recognizes `<#ident>` as an is-predicate LHS base;
 * shouldSkipExprParse lets the `<#` sigil through to the parser; the if= toggle
 * conditions thread `requestIds`. Net: the attribute path now lowers `<#r>.data
 * is some` IDENTICALLY to the text-interpolation path (request-state routed,
 * full member preserved, valid JS).
 */

import { describe, test, expect } from "bun:test";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `req-is-some-${++tmpCounter}`;
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

// ---------------------------------------------------------------------------
// §1 — parseExprToNode: the request-ref sigil is a valid is-predicate LHS base
// ---------------------------------------------------------------------------

describe("g-request-data-is-some-misroute — parseExprToNode", () => {
  test("`<#r>.data is some` → binary is-some over member(input-state-ref, data) (was escape-hatch)", () => {
    const node = parseExprToNode("<#r>.data is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.kind).toBe("input-state-ref");
    expect(node.left.object.name).toBe("r");
    expect(node.left.property).toBe("data");
  });

  test("`<#r>.data is not` (negation) preserves the sigil-rooted member LHS", () => {
    const node = parseExprToNode("<#r>.data is not", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-not");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.kind).toBe("input-state-ref");
    expect(node.left.property).toBe("data");
  });

  test("`<#r>.loading is some` — the other request-state surface parses too", () => {
    const node = parseExprToNode("<#r>.loading is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.left.kind).toBe("member");
    expect(node.left.property).toBe("loading");
  });

  test("bare `<#r> is some` (no member) — documents the PRE-EXISTING shape (out of scope)", () => {
    // The bare-sigil `is`-predicate is rejected by scanLhsLeft's tailChar gate
    // (the LHS ends in `>`, not an ident/`)`/`]`), so the predicate is dropped
    // and the node is just the ref. This is UNCHANGED by the S312 fix (that fix's
    // sigil-base branch is only reached after a member-chain link) and is not the
    // reported gap — `<#r>` as a whole object is always present, so the check is
    // vacuous. Locked in only to flag if a future change alters it.
    const node = parseExprToNode("<#r> is some", "/t.scrml", 0);
    expect(node.kind).toBe("input-state-ref");
    expect(node.name).toBe("r");
  });

  test("GUARD: a real greater-than `a > b.c is some` is NOT read as a sigil base", () => {
    // The `<#ident>` matcher must only fire on the tight sigil, never on a `>`
    // that is genuinely a comparison operator — else the LHS scope would swallow
    // `a > b.c` instead of `b.c`.
    const node = parseExprToNode("a > b.c is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    // Top op is the comparison; the `is some` binds to its RHS member `b.c`.
    const json = JSON.stringify(node);
    expect(json).not.toContain('"kind":"escape-hatch"');
    expect(json).not.toContain('"property":"__scrml_is_some__"');
  });
});

// ---------------------------------------------------------------------------
// §2 — End-to-end: `if=<#r>.data is some` compiles clean + routes to request-state
// ---------------------------------------------------------------------------

const REQ_SOURCE = `<program>
\${
  type UserQuery:struct = { id: int }
  type UserResult:enum = { Found(name: string, email: string) NotFound }
  <query>: UserQuery = { id: 1 }
}
<api src="https://example.com/api" base="/v1">
  getUser(UserQuery) -> GET "/users/\${id}" : UserResult
</api>
<div>
  <request id="profile" api="getUser" args=@query></>
  <div if=\${<#profile>.data is some}><p>loaded</p></div>
</div>
</program>
`;

describe("g-request-data-is-some-misroute — end-to-end if= attribute", () => {
  test("compiles WITHOUT E-CODEGEN-INVALID-LOGIC and emits a client bundle", () => {
    const result = compileSource(REQ_SOURCE);
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]);
    expect(firstClientJs(result)).toBeTruthy(); // .client.js was written, not left stale
  });

  test("the emitted if= condition routes `<#profile>.data` to _scrml_request_profile (not the §36 registry)", () => {
    const result = compileSource(REQ_SOURCE);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    // The request-state routing — the correct target.
    expect(client).toContain("_scrml_request_profile.data");
    // The mis-route (a <request> never populates the input-state registry).
    expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
    // The mangled shape from the string-fallback presence guard (`.(` after get()).
    expect(client).not.toContain('.get("profile").(');
  });
});

// ---------------------------------------------------------------------------
// §3 — REGRESSION GUARD: reactive value/bool/class attributes on a request ref.
// The first cut of the S312 fix widened `shouldSkipExprParse` globally, which
// rerouted these OFF their (correct) string path onto a structured path that
// dropped `requestIds` → `_scrml_input_state_registry.get("profile").loading`
// (undefined.loading → silent runtime TypeError, green build). The adversarial
// pass caught it; this locks the routing so it cannot silently return.
// ---------------------------------------------------------------------------

const ATTR_SOURCE = `<program>
\${
  type UserQuery:struct = { id: int }
  type UserResult:enum = { Found(name: string, email: string) NotFound }
  <query>: UserQuery = { id: 1 }
}
<api src="https://example.com/api" base="/v1">
  getUser(UserQuery) -> GET "/users/\${id}" : UserResult
</api>
<div>
  <request id="profile" api="getUser" args=@query></>
  <button disabled=\${<#profile>.loading}>go</button>
  <input value=\${<#profile>.data}/>
  <div class=\${<#profile>.loading ? "busy" : "idle"}>x</div>
</div>
</program>
`;

describe("g-request-data-is-some-misroute — value/bool/class attr routing (regression guard)", () => {
  test("disabled=/value=/class= on a request ref route to _scrml_request_profile, never the §36 registry", () => {
    const result = compileSource(ATTR_SOURCE);
    const invalidLogic = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalidLogic).toEqual([]);
    const client = firstClientJs(result);
    expect(client).toBeTruthy();
    expect(client).toContain("_scrml_request_profile.loading");
    // The silent mis-route the adversarial pass caught (undefined.loading at runtime).
    expect(client).not.toContain('_scrml_input_state_registry.get("profile")');
  });
});
