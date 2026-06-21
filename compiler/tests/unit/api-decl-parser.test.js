// ---------------------------------------------------------------------------
// <api> declaration — parser recognition (A2 W2, api-primitive-a2-2026-06-20)
// ---------------------------------------------------------------------------
//
// SPEC §60 (Typed External API). W2 (the parser wave) makes the parser
// RECOGNIZE the `<api base= [src=]> endpoint-decl+ </api>` declaration and
// fire the four parse-level diagnostics. This is parser-only — no codegen, no
// HTML/server emission; a VALID `<api>` parses to an `api-decl` AST node and
// emits nothing (later waves consume the node).
//
// §60.2 grammar:
//   api-decl      ::= '<api' api-attrs '>' endpoint-decl+ '</api>'
//   api-attrs     ::= src-attr? base-attr        (base required, src optional)
//   endpoint-decl ::= identifier '(' req-shape? ')' '->'
//                     http-method string-literal ':' response-type
//   http-method   ::= GET | POST | PUT | PATCH | DELETE
//
// Two assertion surfaces:
//   (A) AST shape — via runBlockSplitter + buildAST (the parser stage directly)
//   (B) diagnostics + exit partition — via compileScrml (the real result.errors
//       stream; §34 Errors land in result.errors, NEVER result.warnings).

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runBlockSplitter } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "api-decl-"));

// ---- (A) parser-stage helpers (AST shape) --------------------------------
function parse(src) {
  const bs = runBlockSplitter({ filePath: "t.scrml", source: src });
  return buildAST(bs);
}
function apiNode(src) {
  const { ast } = parse(src);
  return (ast.nodes ?? []).find(n => n && n.kind === "api-decl") ?? null;
}
function tabCodes(src) {
  const { errors } = parse(src);
  return (errors ?? []).map(e => e.code).filter(Boolean);
}

// ---- (B) full-compile helpers (diagnostic partition + exit) --------------
function compile(src) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function errCodes(r, code) {
  return (r.errors ?? []).filter(e => (e.code ?? "") === code);
}
function warnCodes(r, code) {
  return (r.warnings ?? []).filter(w => (w.code ?? "") === code);
}

// ===========================================================================
describe("<api> parser — valid declaration → api-decl AST node (§60.2)", () => {
  const VALID =
    `<api base="https://api.example.com">\n` +
    `  getUser(UserQuery)      -> GET    "/users/\${id}"   : User\n` +
    `  createOrder(OrderInput) -> POST   "/orders"        : Order\n` +
    `  deleteOrder(OrderId)    -> DELETE "/orders/\${id}"  : Deleted\n` +
    `</api>\n`;

  test("produces a single api-decl node with base, src=null, 3 endpoints", () => {
    const n = apiNode(VALID);
    expect(n).not.toBeNull();
    expect(n.kind).toBe("api-decl");
    expect(n.base).toBe("https://api.example.com");
    expect(n.src).toBeNull();
    expect(Array.isArray(n.endpoints)).toBe(true);
    expect(n.endpoints.length).toBe(3);
  });

  test("endpoint[0] captures name/reqShape/method/path/responseType verbatim", () => {
    const n = apiNode(VALID);
    const e0 = n.endpoints[0];
    expect(e0.name).toBe("getUser");
    expect(e0.reqShape).toBe("UserQuery");
    expect(e0.method).toBe("GET");
    // path template preserved verbatim — `${id}` is NOT interpreted as an
    // interpolation at the declaration stage.
    expect(e0.path).toBe("/users/${id}");
    expect(e0.responseType).toBe("User");
  });

  test("endpoints carry the remaining methods + paths (POST / DELETE)", () => {
    const n = apiNode(VALID);
    expect(n.endpoints[1]).toMatchObject({
      name: "createOrder", reqShape: "OrderInput", method: "POST",
      path: "/orders", responseType: "Order",
    });
    expect(n.endpoints[2]).toMatchObject({
      name: "deleteOrder", reqShape: "OrderId", method: "DELETE",
      path: "/orders/${id}", responseType: "Deleted",
    });
  });

  test("each endpoint carries a per-line span (line advances per endpoint)", () => {
    const n = apiNode(VALID);
    expect(n.endpoints[0].span.line).toBe(2);
    expect(n.endpoints[1].span.line).toBe(3);
    expect(n.endpoints[2].span.line).toBe(4);
  });

  test("valid declaration fires NO E-API-* parse diagnostics", () => {
    const codes = tabCodes(VALID).filter(c => c.startsWith("E-API-"));
    expect(codes).toEqual([]);
  });

  test("optional src= is captured; both src= and base= present is clean", () => {
    const src =
      `<api src="openapi.json" base="https://api.example.com">\n` +
      `  getUser(UserQuery) -> GET "/users/\${id}" : User\n` +
      `</api>\n`;
    const n = apiNode(src);
    expect(n.src).toBe("openapi.json");
    expect(n.base).toBe("https://api.example.com");
    expect(tabCodes(src).filter(c => c.startsWith("E-API-"))).toEqual([]);
  });

  test("req-shape is optional — a no-arg `name()` endpoint parses clean", () => {
    const src =
      `<api base="https://api.example.com">\n` +
      `  listUsers() -> GET "/users" : UserList\n` +
      `</api>\n`;
    const n = apiNode(src);
    expect(n.endpoints.length).toBe(1);
    expect(n.endpoints[0].reqShape).toBeNull();
    expect(n.endpoints[0].name).toBe("listUsers");
    expect(tabCodes(src).filter(c => c.startsWith("E-API-"))).toEqual([]);
  });
});

// ===========================================================================
describe("<api> parser — E-API-BASE-MISSING (§60.9)", () => {
  const SRC =
    `<api src="x.json">\n` +
    `  getUser(UserQuery) -> GET "/users/\${id}" : User\n` +
    `</api>\n`;

  test("an <api> with no base= fires E-API-BASE-MISSING (parser stage)", () => {
    expect(tabCodes(SRC)).toContain("E-API-BASE-MISSING");
  });

  test("the Error lands in result.errors, never result.warnings", () => {
    const r = compile(SRC);
    expect(errCodes(r, "E-API-BASE-MISSING").length).toBe(1);
    expect(warnCodes(r, "E-API-BASE-MISSING").length).toBe(0);
  });
});

// ===========================================================================
describe("<api> parser — E-API-METHOD-INVALID (§60.9)", () => {
  const SRC =
    `<api base="https://api.example.com">\n` +
    `  getUser(UserQuery) -> FETCH "/users/\${id}" : User\n` +
    `</api>\n`;

  test("an unrecognized HTTP method fires E-API-METHOD-INVALID (parser stage)", () => {
    expect(tabCodes(SRC)).toContain("E-API-METHOD-INVALID");
  });

  test("the Error lands in result.errors, never result.warnings", () => {
    const r = compile(SRC);
    expect(errCodes(r, "E-API-METHOD-INVALID").length).toBe(1);
    expect(warnCodes(r, "E-API-METHOD-INVALID").length).toBe(0);
  });

  test("the four recognized methods + a verb-only method gate correctly", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const ok =
        `<api base="https://api.example.com">\n` +
        `  ep(Req) -> ${m} "/p" : Res\n` +
        `</api>\n`;
      expect(tabCodes(ok)).not.toContain("E-API-METHOD-INVALID");
    }
    const bad =
      `<api base="https://api.example.com">\n` +
      `  ep(Req) -> HEAD "/p" : Res\n` +
      `</api>\n`;
    expect(tabCodes(bad)).toContain("E-API-METHOD-INVALID");
  });
});

// ===========================================================================
describe("<api> parser — E-API-RESPONSE-TYPE-UNDECLARED (§60.9)", () => {
  const SRC =
    `<api base="https://api.example.com">\n` +
    `  getUser(UserQuery) -> GET "/users/\${id}"\n` +
    `</api>\n`;

  test("a well-formed head with no `: ResponseT` fires the precise code", () => {
    const codes = tabCodes(SRC);
    expect(codes).toContain("E-API-RESPONSE-TYPE-UNDECLARED");
    // It is the PRECISE code, not the catch-all malformed code.
    expect(codes).not.toContain("E-API-ENDPOINT-MALFORMED");
  });

  test("the parser RECOVERS — the endpoint is recorded with responseType null", () => {
    const n = apiNode(SRC);
    expect(n.endpoints.length).toBe(1);
    expect(n.endpoints[0].name).toBe("getUser");
    expect(n.endpoints[0].responseType).toBeNull();
  });

  test("the Error lands in result.errors, never result.warnings", () => {
    const r = compile(SRC);
    expect(errCodes(r, "E-API-RESPONSE-TYPE-UNDECLARED").length).toBe(1);
    expect(warnCodes(r, "E-API-RESPONSE-TYPE-UNDECLARED").length).toBe(0);
  });
});

// ===========================================================================
describe("<api> parser — E-API-ENDPOINT-MALFORMED (§60.9, NEW S210 W2)", () => {
  const SRC =
    `<api base="https://api.example.com">\n` +
    `  getUser -> GET "/users/\${id}" : User\n` +     // missing ( )
    `</api>\n`;

  test("a body line that conforms to none of the shapes fires the catch-all", () => {
    const codes = tabCodes(SRC);
    expect(codes).toContain("E-API-ENDPOINT-MALFORMED");
  });

  test("the Error lands in result.errors, never result.warnings", () => {
    const r = compile(SRC);
    expect(errCodes(r, "E-API-ENDPOINT-MALFORMED").length).toBe(1);
    expect(warnCodes(r, "E-API-ENDPOINT-MALFORMED").length).toBe(0);
  });

  test("stray prose in the body (no `->` arrow) is malformed-as-endpoint", () => {
    const stray =
      `<api base="https://api.example.com">\n` +
      `  this is just prose\n` +
      `</api>\n`;
    expect(tabCodes(stray)).toContain("E-API-ENDPOINT-MALFORMED");
  });

  test("blank lines + comment lines in the body are skipped (no false-fire)", () => {
    const withComments =
      `<api base="https://api.example.com">\n` +
      `\n` +
      `  // the user endpoint\n` +
      `  getUser(UserQuery) -> GET "/users/\${id}" : User\n` +
      `\n` +
      `</api>\n`;
    const codes = tabCodes(withComments).filter(c => c.startsWith("E-API-"));
    expect(codes).toEqual([]);
    expect(apiNode(withComments).endpoints.length).toBe(1);
  });
});

// ===========================================================================
describe("<api> parser — no codegen / no emission (W2 contract)", () => {
  test("a valid <api> compiles exit-clean and emits no api-decl content", () => {
    // W3 (the typer wave) RESOLVES the endpoint type-refs against §53/§14 and
    // checks the `${id}` path param binds a request-shape field — so a genuinely
    // valid fixture declares the request/response types (UserQuery carries the
    // `id` field the path template references). (The pre-W3 fixture omitted these
    // declarations; that is now correctly an E-TYPE-UNKNOWN-NAME +
    // E-API-PATH-PARAM-UNBOUND, not a clean compile.)
    const r = compile(
      `type UserQuery :struct = { id: number }\n` +
      `type User :struct = { id: number, name: string }\n` +
      `<api base="https://api.example.com">\n` +
      `  getUser(UserQuery) -> GET "/users/\${id}" : User\n` +
      `</api>\n` +
      `<p>hello</p>\n`
    );
    // No E-API-* errors on the valid declaration.
    const apiErrs = (r.errors ?? []).filter(e => (e.code ?? "").startsWith("E-API-"));
    expect(apiErrs).toEqual([]);
    // No api-decl content leaks into any emitted output. Each output entry is
    // an object of emitted artifacts ({ html, css, clientJs, serverJs }); check
    // every string-valued artifact field.
    let checkedAnArtifact = false;
    for (const [, entry] of (r.outputs ?? new Map())) {
      const fields = entry && typeof entry === "object" ? entry : { v: entry };
      for (const v of Object.values(fields)) {
        if (typeof v !== "string") continue;
        checkedAnArtifact = true;
        expect(v).not.toContain("api.example.com");
        expect(v).not.toContain("getUser");
      }
      // The sibling `<p>hello</p>` SHOULD render — confirms the file emitted.
      if (typeof entry?.html === "string") {
        expect(entry.html).toContain("hello");
      }
    }
    expect(checkedAnArtifact).toBe(true);
  });
});
