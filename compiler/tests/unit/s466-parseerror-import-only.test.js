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

  test("a user-declared failable's own qualified arm is unaffected", () => {
    const src =
      "${\n  type E:enum = { Bad(m: string), Worse }\n" +
      "  function f()! -> E { fail E.Worse }\n" +
      "  function g() -> int {\n    const v = f() !{\n      E.Bad(m) :> { return 0 }\n      E.Worse :> { return 1 }\n    }\n    return 2\n  }\n}\n<p>${g()}</p>\n";
    expect(build(src, "user-enum").errors).toEqual([]);
  });
});
