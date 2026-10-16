/* SPDX-License-Identifier: MIT
 *
 * Unit — S466 item 2: `ParseError` is import-only (§41.13 / §53.14.6; ruling
 * user-voice-scrml.md S464 "(a) Import-only": "`ParseError` is NOT ambient; it is
 * imported like every stdlib export (bare-variant handling in `!{}` needs no name)").
 *
 * Before: `ParseError` was a BUILTIN_TYPES entry (type-system.ts), so it was bound in
 * every file's global scope and type registry — `ParseError.Malformed(r) :>`,
 * `x: ParseError` and `ParseError.Malformed("x")` all compiled with no import.
 * After: the compiler keeps an INTERNAL `PARSE_ERROR_ENUM`, read only to resolve a
 * parseVariant call's failure type (`!{}` exhaustiveness with bare arms), and the
 * NAME resolves only through `import { ParseError } from 'scrml:data'`.
 *
 * The `!{}` arm-qualifier position had no unknown-name check at all (an undeclared
 * `Zork.Malformed(r) :>` compiled); it now reports E-SCOPE-001 like the same name in
 * any other expression (§34: "Unquoted identifier not resolvable in scope").
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { BUILTIN_TYPES } from "../../src/type-system.ts";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = mkdtempSync(join(tmpdir(), "s466-parseerror-"));

function build(source, name) {
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source);
  const r = compileScrml({ inputFiles: [file], outputDir: join(TMP, `${name}.dist`), write: false, verbose: false, log: () => {} });
  const errs = (r.errors || []).filter((e) => (e.severity ?? "error") === "error");
  return { errors: errs.map((e) => e.code), messages: errs.map((e) => e.message) };
}

const handler = (imports, arms) =>
  "${\n" +
  "  type Shape:enum = { Dot, Line(n: int) }\n" +
  `  import { ${imports} } from 'scrml:data'\n` +
  "  function p(j) {\n" +
  "    const s = parseVariant(j, Shape) !{\n" +
  arms.map((a) => `      ${a}\n`).join("") +
  "    }\n" +
  "    return 2\n" +
  "  }\n" +
  "}\n" +
  "<p>${p(\"{}\")}</p>\n";

describe("§41.13 / §53.14.6 — ParseError is import-only (S464 ruling)", () => {
  test("ParseError is not a built-in type name", () => {
    expect(BUILTIN_TYPES.has("ParseError")).toBe(false);
  });

  test("the S464 repro — a `ParseError.V` arm without the import — is E-SCOPE-001 naming the import", () => {
    const { errors, messages } = build(handler("parseVariant", ["ParseError.Malformed(r) :> { return 0 }", "_ :> { return 1 }"]), "repro");
    expect(errors).toEqual(["E-SCOPE-001"]);
    expect(messages[0]).toContain("import { ParseError } from 'scrml:data'");
  });

  test("the `ParseError::V` spelling without the import is E-SCOPE-001 too", () => {
    const { errors } = build(handler("parseVariant", ["ParseError::Malformed(r) :> { return 0 }", "_ :> { return 1 }"]), "colon");
    expect(errors).toEqual(["E-SCOPE-001"]);
  });

  test("with `import { ParseError } from 'scrml:data'` the qualified arm compiles", () => {
    const { errors } = build(handler("parseVariant, ParseError", ["ParseError.Malformed(r) :> { return 0 }", "_ :> { return 1 }"]), "imported");
    expect(errors).toEqual([]);
  });

  test("bare arms need NO import and are still checked for exhaustiveness against ParseError", () => {
    const all = build(handler("parseVariant", [
      ".MissingDiscriminator :> { return 0 }",
      ".UnknownVariant(tag) :> { return 1 }",
      ".InvalidPayload(field, reason) :> { return 2 }",
      ".Malformed(r) :> { return 3 }",
    ]), "bare-all");
    expect(all.errors).toEqual([]);
    const partial = build(handler("parseVariant", [".MissingDiscriminator :> { return 0 }", ".Malformed(r) :> { return 3 }"]), "bare-partial");
    expect(partial.errors).toEqual(["E-TYPE-080"]);
    expect(partial.messages[0]).toContain("UnknownVariant");
  });

  test("a qualifier naming a DIFFERENT enum on a parseVariant handler is still a mismatch (no import needed to know the handled type)", () => {
    const { errors } = build(handler("parseVariant", ["Shape.Dot :> { return 0 }", "_ :> { return 1 }"]), "mismatch");
    expect(errors).toEqual(["E-TYPE-ARM-QUALIFIER-MISMATCH"]);
  });

  test("`ParseError` in a type annotation without the import is E-TYPE-UNKNOWN-NAME; with it, it resolves", () => {
    const src = (imp) => `\${\n  ${imp}\n  function r(x: ParseError) -> int { return 1 }\n}\n<p>\${r(1)}</p>\n`;
    expect(build(src(""), "annot").errors).toContain("E-TYPE-UNKNOWN-NAME");
    expect(build(src("import { ParseError } from 'scrml:data'"), "annot-imp").errors).not.toContain("E-TYPE-UNKNOWN-NAME");
  });

  test("`ParseError.Malformed(…)` in an expression without the import is E-SCOPE-001", () => {
    const { errors } = build(`\${\n  function q() -> int {\n    const e = ParseError.Malformed("x")\n    return 1\n  }\n}\n<p>\${q()}</p>\n`, "expr");
    expect(errors).toContain("E-SCOPE-001");
  });

  test("an undeclared arm qualifier of any name is E-SCOPE-001 (was silently accepted)", () => {
    const { errors } = build(handler("parseVariant", ["Zork.Malformed(r) :> { return 0 }", "_ :> { return 1 }"]), "zork");
    expect(errors).toEqual(["E-SCOPE-001"]);
  });

  test("the mismatch hint on a parseVariant handler points at the bare form and names the import", () => {
    const { errors, messages } = build(handler("parseVariant", ["Shape.Dot :> { return 0 }", "_ :> { return 1 }"]), "mismatch-hint");
    expect(errors).toEqual(["E-TYPE-ARM-QUALIFIER-MISMATCH"]);
    expect(messages[0]).toContain("Write the arm bare");
    expect(messages[0]).toContain("import { ParseError } from 'scrml:data'");
  });

  test("a user's own `type ParseError:enum` does not hijack parseVariant's failure type", () => {
    const src =
      "${\n  import { parseVariant } from 'scrml:data'\n  type ParseError:enum = { Bad, Worse }\n" +
      "  type Shape:enum = { Dot, Line(n: int) }\n  function p(j) {\n    const s = parseVariant(j, Shape) !{\n" +
      "      .Malformed(r) :> { return 0 }\n      .MissingDiscriminator :> { return 1 }\n" +
      "      .UnknownVariant(t) :> { return 1 }\n      .InvalidPayload(f, r2) :> { return 1 }\n" +
      "    }\n    return 2\n  }\n}\n<p>${p(\"{}\")}</p>\n";
    expect(build(src, "own-pe").errors).toEqual([]);
  });
});

// Fix round 1 (S239 review) — an arm qualifier is "known" by ONE predicate
// (`isKnownErrorTypeName`, over `resolveFailableErrorType`): the registry (declared,
// BUILTIN_TYPES, imports under their LOCAL name) plus the compiler-provided error types
// the SPEC names — `Error` (§19.4.2), `SqlError` (§19.8.1), `ServerCallError` (§19.9).
describe("compiler-provided error types are known arm qualifiers", () => {
  const fnHandler = (decl, failStmt, arms) =>
    "${\n" + `  function mk(v) ${decl} { ${failStmt} }\n` +
    "  function q() {\n    const v = mk(0) !{\n" + arms.map((a) => `      ${a}\n`).join("") +
    "    }\n    return v\n  }\n}\n<p>${q()}</p>\n";

  test("`Error::Generic(m)` / `Error.Generic` arms on a bare-`!` and a `! -> Error` function (§19.4.2)", () => {
    expect(build(fnHandler("!", "if (!v) fail Error::Generic(\"Check failed\"); return 1", ["Error::Generic(m) :> { return 0 }"]), "err-g2").errors).toEqual([]);
    expect(build(fnHandler("!", "fail .Generic", ["Error.Generic :> { return 0 }", "_ :> { return 1 }"]), "err-bang").errors).toEqual([]);
    expect(build(fnHandler("! -> Error", "fail .Generic", ["Error.Generic :> { return 0 }", "_ :> { return 1 }"]), "err-typed").errors).toEqual([]);
  });

  test("a `SqlError.V` arm on a `?{}` query and a `SqlError::V` arm on a `! -> SqlError` function (§19.8.1)", () => {
    const q =
      "<program db=\"./app.db\">\n${\n  server function load(id) {\n" +
      "    const u = ?{`SELECT name FROM users WHERE id = ${id}`}.get() !{\n" +
      "      SqlError.QueryFailed(m) :> { return \"q\" }\n      _ :> { return \"x\" }\n    }\n    return u\n  }\n}\n<p>${load(1)}</p>\n</>\n";
    expect(build(q, "sql-q").errors).not.toContain("E-SCOPE-001");
    expect(build(q, "sql-q").errors).toEqual([]);
    const f =
      "<program db=\"./app.db\">\n${\n  server function loadUser(id)! -> SqlError {\n" +
      "    return ?{`SELECT name FROM users WHERE id = ${id}`}.get()\n  }\n  server function q() {\n" +
      "    const v = loadUser(1) !{\n      SqlError::QueryFailed(m) :> { return \"q\" }\n      _ :> { return \"x\" }\n    }\n" +
      "    return v\n  }\n}\n<p>${q()}</p>\n</>\n";
    expect(build(f, "sql-fn").errors).toEqual([]);
  });

  test("a `ServerCallError.V` arm is a known qualifier (§19.9, compiler-provided)", () => {
    const src = fnHandler("! -> Error", "fail .Generic", ["ServerCallError.Unreachable :> { return 0 }", "_ :> { return 1 }"]);
    // Not E-SCOPE-001: the name exists. (Whether a compiler-provided type's VARIANT
    // SET feeds the qualifier-mismatch / exhaustiveness checks is unchanged by S466 —
    // it does not, as on main.)
    const { errors } = build(src, "sce");
    expect(errors).not.toContain("E-SCOPE-001");
    expect(errors).toEqual([]);
  });

  test("a BUILTIN_TYPES error type (`NetworkError`) is a known qualifier", () => {
    expect(build(fnHandler("! -> NetworkError", "fail NetworkError.X", ["NetworkError.X :> { return 0 }", "_ :> { return 1 }"]), "net").errors).toEqual([]);
  });
});

// Fix round 1, LOW — an aliased import binds its LOCAL name only.
describe("import aliases: only the local name is in scope", () => {
  test("`import { ParseError as PE }`: the `PE.V` arm compiles; `ParseError.V` is E-SCOPE-001", () => {
    expect(build(handler("parseVariant, ParseError as PE", ["PE.Malformed(r) :> { return 0 }", "_ :> { return 1 }"]), "alias-ok").errors).toEqual([]);
    expect(build(handler("parseVariant, ParseError as PE", ["ParseError.Malformed(r) :> { return 0 }", "_ :> { return 1 }"]), "alias-orig").errors)
      .toEqual(["E-SCOPE-001"]);
  });

  test("`import { ParseError as PE }`: `e: ParseError` is E-TYPE-UNKNOWN-NAME, the expression E-SCOPE-001", () => {
    const src =
      "${\n  import { parseVariant, ParseError as PE } from 'scrml:data'\n  type Shape:enum = { Dot, Line(n: int) }\n" +
      "  function q(e: ParseError) { return 1 }\n  const z = ParseError.Malformed(\"x\")\n}\n<p>${q(z)}</p>\n";
    const { errors } = build(src, "alias-leak");
    expect(errors).toContain("E-TYPE-UNKNOWN-NAME");
    expect(errors).toContain("E-SCOPE-001");
  });

  test("the generic annotation leak: `import { HostError as HE }` then `e: HostError` is E-TYPE-UNKNOWN-NAME; `e: HE` resolves", () => {
    const src = (t) => `\${\n  import { safeCall, HostError as HE } from 'scrml:host'\n  function q(e: ${t}) { return 1 }\n}\n<p>\${q(1)}</p>\n`;
    expect(build(src("HostError"), "host-orig").errors).toContain("E-TYPE-UNKNOWN-NAME");
    expect(build(src("HE"), "host-local").errors).not.toContain("E-TYPE-UNKNOWN-NAME");
  });
});

describe("user-declared failables", () => {
  test("a user-declared failable's own qualified arm is unaffected", () => {
    const src =
      "${\n  type E:enum = { Bad(m: string), Worse }\n" +
      "  function f()! -> E { fail E.Worse }\n" +
      "  function g() -> int {\n    const v = f() !{\n      E.Bad(m) :> { return 0 }\n      E.Worse :> { return 1 }\n    }\n    return 2\n  }\n}\n<p>${g()}</p>\n";
    expect(build(src, "user-enum").errors).toEqual([]);
  });
});
