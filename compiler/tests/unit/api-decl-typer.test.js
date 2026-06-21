// ---------------------------------------------------------------------------
// <api> typer — type resolution + checks (A2 W3, api-primitive-a2-2026-06-20)
// ---------------------------------------------------------------------------
//
// SPEC §60 (Typed External API). W3 (the type-system wave) RESOLVES the endpoint
// request/response type-refs against §53/§14 and CHECKS the boundary surface:
//
//   E-TYPE-UNKNOWN-NAME      — an endpoint reqShape/responseType references an
//                              undeclared type (the §14.1.2 machinery reused —
//                              `<api>` introduces NO new type machinery, §60.2).
//   E-API-PATH-PARAM-UNBOUND — a `${param}` in an endpoint path template has no
//                              corresponding request-shape field (§60.2).
//   E-API-ENDPOINT-UNKNOWN   — `<request api="X">` names no declared endpoint (§60.4).
//   E-API-REQ-SHAPE-MISMATCH — the `<request args=>` value does not type-check
//                              against the endpoint's request shape (§60.4).
//
// W3 is RESOLVE + CHECK only — NO codegen (the fetch callable + parseVariant
// wiring + the `<request>` runtime integration land in W4). A typed-and-checked
// `<api>` + `<request api=>` STILL emits nothing runtime; §60.6 client-only is
// confirmed (an `<api>`-only app compiles to a pure client bundle — no serverJs,
// no §12.2 server placement).
//
// Diagnostic-stream partition: every E-* code is an Error → result.errors, NEVER
// result.warnings (the W-/I- partition). Each code test asserts BOTH streams.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runBlockSplitter } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "api-typer-"));

// ---- helpers --------------------------------------------------------------
let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function errCodes(r, code) {
  return (r.errors ?? []).filter(e => (e.code ?? "") === code);
}
function warnCodes(r, code) {
  return (r.warnings ?? []).filter(w => (w.code ?? "") === code);
}
function allCodes(r) {
  return (r.errors ?? []).map(e => e.code).filter(Boolean);
}
// AST-stage helper: confirm the W2 api-decl node is what the typer consumes.
function apiNode(src) {
  const bs = runBlockSplitter({ filePath: "t.scrml", source: src });
  const { ast } = buildAST(bs);
  return (ast.nodes ?? []).find(n => n && n.kind === "api-decl") ?? null;
}
// Does any emitted artifact carry a server bundle?
function hasServerBundle(r) {
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry.serverJs === "string" && entry.serverJs.length > 0) return true;
  }
  return false;
}

// ===========================================================================
describe("<api> typer — valid declaration + <request api=> resolves clean (§60.2/§60.4)", () => {
  const VALID =
    `type UserQuery :struct = { id: number }\n` +
    `type User :struct = { id: number, name: string }\n` +
    `<query>: UserQuery = { id: 0 }\n` +
    `<api base="https://api.example.com">\n` +
    `  getUser(UserQuery) -> GET "/users/\${id}" : User\n` +
    `</api>\n` +
    `<request id="profile" api="getUser" args=@query></>\n` +
    `<p>hi</p>\n`;

  test("a valid <api> + <request api=> fires NO E-API-* / E-TYPE-UNKNOWN-NAME errors", () => {
    const r = compile(VALID);
    const apiErrs = (r.errors ?? []).filter(e =>
      (e.code ?? "").startsWith("E-API-") || (e.code ?? "") === "E-TYPE-UNKNOWN-NAME");
    expect(apiErrs).toEqual([]);
  });

  test("the api-decl node the typer consumes carries the resolvable type-refs", () => {
    const n = apiNode(VALID);
    expect(n).not.toBeNull();
    expect(n.endpoints[0].reqShape).toBe("UserQuery");
    expect(n.endpoints[0].responseType).toBe("User");
    // The `${id}` path param resolves against UserQuery.id (declared) — clean.
    expect(n.endpoints[0].path).toBe("/users/${id}");
  });

  test("a no-reqShape, no-path-param endpoint is clean (listUsers())", () => {
    const r = compile(
      `type UserList :struct = { count: number }\n` +
      `<api base="https://api.example.com">\n` +
      `  listUsers() -> GET "/users" : UserList\n` +
      `</api>\n` +
      `<p>hi</p>\n`
    );
    const apiErrs = (r.errors ?? []).filter(e =>
      (e.code ?? "").startsWith("E-API-") || (e.code ?? "") === "E-TYPE-UNKNOWN-NAME");
    expect(apiErrs).toEqual([]);
  });
});

// ===========================================================================
describe("<api> typer — E-TYPE-UNKNOWN-NAME on an undeclared endpoint type-ref (§14.1.2 reuse)", () => {
  test("an undeclared reqShape type fires E-TYPE-UNKNOWN-NAME", () => {
    const r = compile(
      `type User :struct = { id: number }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(NopeQuery) -> GET "/u" : User\n` +
      `</api>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-TYPE-UNKNOWN-NAME").length).toBeGreaterThanOrEqual(1);
    expect(warnCodes(r, "E-TYPE-UNKNOWN-NAME").length).toBe(0);
  });

  test("an undeclared responseType fires E-TYPE-UNKNOWN-NAME", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/u" : NopeResponse\n` +
      `</api>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-TYPE-UNKNOWN-NAME").length).toBeGreaterThanOrEqual(1);
  });

  test("a DECLARED reqShape/responseType does NOT fire E-TYPE-UNKNOWN-NAME", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-TYPE-UNKNOWN-NAME").length).toBe(0);
  });
});

// ===========================================================================
describe("<api> typer — E-API-PATH-PARAM-UNBOUND (§60.2)", () => {
  test("a `${id}` path param with no matching reqShape field fires the code", () => {
    const r = compile(
      `type Q :struct = { name: string }\n` +
      `type User :struct = { id: number }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-PATH-PARAM-UNBOUND").length).toBe(1);
    expect(warnCodes(r, "E-API-PATH-PARAM-UNBOUND").length).toBe(0);
  });

  test("a path param IS bound when the field exists → no fire", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-PATH-PARAM-UNBOUND").length).toBe(0);
  });

  test("a path param on a no-reqShape endpoint is unbound (no field source)", () => {
    const r = compile(
      `type User :struct = { id: number }\n` +
      `<api base="https://x.com">\n` +
      `  getUser() -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-PATH-PARAM-UNBOUND").length).toBe(1);
  });
});

// ===========================================================================
describe("<api> typer — E-API-ENDPOINT-UNKNOWN (§60.4)", () => {
  test("a <request api=X> naming no declared endpoint fires the code", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number }\n` +
      `<query>: Q = { id: 0 }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="r" api="getUserMISSPELLED" args=@query></>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-ENDPOINT-UNKNOWN").length).toBe(1);
    expect(warnCodes(r, "E-API-ENDPOINT-UNKNOWN").length).toBe(0);
  });

  test("a <request api=X> naming a declared endpoint does NOT fire", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number }\n` +
      `<query>: Q = { id: 0 }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="r" api="getUser" args=@query></>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-ENDPOINT-UNKNOWN").length).toBe(0);
  });
});

// ===========================================================================
describe("<api> typer — E-API-REQ-SHAPE-MISMATCH (§60.4)", () => {
  test("an args value missing a required reqShape field fires the code", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type Wrong :struct = { name: string }\n` +
      `type User :struct = { id: number }\n` +
      `<query>: Wrong = { name: "a" }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="r" api="getUser" args=@query></>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-REQ-SHAPE-MISMATCH").length).toBe(1);
    expect(warnCodes(r, "E-API-REQ-SHAPE-MISMATCH").length).toBe(0);
  });

  test("an args value satisfying the reqShape does NOT fire", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number }\n` +
      `<query>: Q = { id: 0 }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="r" api="getUser" args=@query></>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-REQ-SHAPE-MISMATCH").length).toBe(0);
  });

  test("an args value with a SUPERSET of fields is tolerated (over-supply ok)", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type Big :struct = { id: number, extra: string }\n` +
      `type User :struct = { id: number }\n` +
      `<query>: Big = { id: 0, extra: "z" }\n` +
      `<api base="https://x.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="r" api="getUser" args=@query></>\n` +
      `<p>x</p>\n`
    );
    expect(errCodes(r, "E-API-REQ-SHAPE-MISMATCH").length).toBe(0);
  });
});

// ===========================================================================
describe("<api> typer — §60.6 client-only confirmation (no §12.2 server placement)", () => {
  test("an <api>-only app compiles exit-0 and emits NO server bundle", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number, name: string }\n` +
      `<query>: Q = { id: 0 }\n` +
      `<api base="https://api.example.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="profile" api="getUser" args=@query></>\n` +
      `<p>hi</p>\n`
    );
    // No E-API-* / E-TYPE-UNKNOWN-NAME errors on the valid declaration.
    const apiErrs = (r.errors ?? []).filter(e =>
      (e.code ?? "").startsWith("E-API-") || (e.code ?? "") === "E-TYPE-UNKNOWN-NAME");
    expect(apiErrs).toEqual([]);
    // §60.6 — a raw external fetch is NOT a §12.2 server-placement trigger, and
    // <api> introduces none: the app is a pure client bundle.
    expect(hasServerBundle(r)).toBe(false);
  });

  test("W3 emits NO runtime for <api> — base URL / endpoint name do not leak into any artifact", () => {
    const r = compile(
      `type Q :struct = { id: number }\n` +
      `type User :struct = { id: number }\n` +
      `<query>: Q = { id: 0 }\n` +
      `<api base="https://secret-backend.example.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<request id="r" api="getUser" args=@query></>\n` +
      `<p>hi</p>\n`
    );
    let checkedAnArtifact = false;
    for (const [, entry] of (r.outputs ?? new Map())) {
      const fields = entry && typeof entry === "object" ? entry : { v: entry };
      for (const v of Object.values(fields)) {
        if (typeof v !== "string") continue;
        checkedAnArtifact = true;
        // W3 wires NO codegen — the api-decl contributes nothing to any artifact.
        expect(v).not.toContain("secret-backend.example.com");
      }
      if (typeof entry?.html === "string") expect(entry.html).toContain("hi");
    }
    expect(checkedAnArtifact).toBe(true);
  });
});
