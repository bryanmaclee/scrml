/* SPDX-License-Identifier: MIT
 *
 * Unit — S466 item 1: an unannotated cell declared with a QUALIFIED variant has
 * that enum type (§14.10, §66.3 rule 5; ruling user-voice-scrml.md S464
 * "(a) Infer from initializer").
 *
 *     type Col:enum = { Red, Blue }
 *     <col> = Col.Red
 *     ${ function flip() { @col = .Red } }      // was E-VARIANT-AMBIGUOUS
 *
 * §66.3 rule 5 readings: "a QUALIFIED unit variant `E.V` (§14.10: legal everywhere)
 * is a **literal** of `E` (a); the bare `.V` stays O35(b); a payload variant's
 * construction `E.V(…)` is a **call** whose declared type is `E` (g)".
 *
 * The inferred type must flow wherever an annotated `<col>: Col = .Red` does:
 * handler writes, function-body writes, `is` tests, match exhaustiveness. A bare
 * `.Red` initializer has no type context and stays E-VARIANT-AMBIGUOUS; a collapsed
 * REASSIGNMENT (`@x = Col.Red` in a function body) never retypes its cell.
 * Execution of the repro is pinned in
 * `compiler/tests/browser/s466-enum-cell-infer.browser.test.js`.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = mkdtempSync(join(tmpdir(), "s466-enum-infer-"));

function build(source, name) {
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source);
  const outDir = join(TMP, `${name}.dist`);
  const r = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, verbose: false, log: () => {} });
  const errors = (r.errors || []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  let client = "";
  try {
    for (const f of readdirSync(outDir)) if (f.endsWith(".client.js")) client += readFileSync(join(outDir, f), "utf8");
  } catch { /* no artifact */ }
  return { errors, client };
}

const ENUM = "${\n  type Col:enum = { Red, Blue, Green }\n}\n";

describe("§14.10 / §66.3 rule 5 — enum cell inferred from a qualified-variant initializer", () => {
  test("the S464 repro compiles: bare writes in a handler AND a function body resolve against Col", () => {
    const { errors, client } = build(
      ENUM +
        "<col> = Col.Red\n" +
        "<button onclick={ @col = .Blue }>b</button>\n" +
        "${ function flip() { @col = .Red } }\n" +
        "<button onclick={ flip() }>f</button>\n" +
        "<p>${@col}</p>\n",
      "repro",
    );
    expect(errors).toEqual([]);
    expect(client).toContain('_scrml_cs_reactive_set("col", "Blue")');
    expect(client).toContain('_scrml_cs_reactive_set("col", "Red")');
  });

  test("the `Col::Red` spelling infers the same type", () => {
    const { errors } = build(
      ENUM + "<col> = Col::Red\n${ function flip() { @col = .Blue } }\n<button onclick={ flip() }>f</button>\n<p>${@col}</p>\n",
      "colon",
    );
    expect(errors).toEqual([]);
  });

  test("the annotated form is unchanged", () => {
    const { errors, client } = build(
      ENUM +
        "<col>: Col = .Red\n" +
        "<button onclick={ @col = .Blue }>b</button>\n" +
        "${ function flip() { @col = .Red } }\n" +
        "<button onclick={ flip() }>f</button>\n" +
        "<p>${@col}</p>\n",
      "annotated",
    );
    expect(errors).toEqual([]);
    expect(client).toContain('_scrml_cs_reactive_set("col", "Blue")');
  });

  test("a bare `.Red` initializer has no type context — still E-VARIANT-AMBIGUOUS", () => {
    const { errors } = build(ENUM + "<col> = .Red\n<p>${@col}</p>\n", "bare-init");
    expect(errors).toContain("E-VARIANT-AMBIGUOUS");
  });

  test("a handler write of a variant NOT in Col is E-TYPE-063 (was silently accepted)", () => {
    const { errors } = build(ENUM + "<col> = Col.Red\n<button onclick={ @col = .Purple }>b</button>\n<p>${@col}</p>\n", "foreign-handler");
    expect(errors).toEqual(["E-TYPE-063"]);
  });

  test("a function-body write of a variant NOT in Col is E-TYPE-063", () => {
    const { errors } = build(
      ENUM + "<col> = Col.Red\n${ function flip() { @col = .Purple } }\n<button onclick={ flip() }>f</button>\n<p>${@col}</p>\n",
      "foreign-fn",
    );
    expect(errors).toEqual(["E-TYPE-063"]);
  });

  test("`@col is .Purple` checks the variant against Col", () => {
    const { errors } = build(ENUM + "<col> = Col.Red\n<p>${ @col is .Purple ? \"p\" : \"n\" }</p>\n", "is-test");
    expect(errors).toEqual(["E-TYPE-063"]);
  });

  test("a match over @col is checked for exhaustiveness against Col", () => {
    const partial = build(
      ENUM + "<col> = Col.Red\n<p>${ match @col {\n  .Red :> \"r\"\n  .Blue :> \"b\"\n} }</p>\n",
      "match-partial",
    );
    expect(partial.errors).toEqual(["E-TYPE-020"]);
    const full = build(
      ENUM + "<col> = Col.Red\n<p>${ match @col {\n  .Red :> \"r\"\n  .Blue :> \"b\"\n  .Green :> \"g\"\n} }</p>\n",
      "match-full",
    );
    expect(full.errors).toEqual([]);
  });

  test("a payload construction `Shape.Line(3)` infers Shape (rule 5 (g))", () => {
    const src =
      "${\n  type Shape:enum = { Dot, Line(n: int) }\n}\n" +
      "<s> = Shape.Line(3)\n" +
      "${\n  function toDot() { @s = .Dot }\n  function grow() { @s = .Line(4) }\n}\n" +
      "<button onclick={ toDot() }>d</button>\n<button onclick={ grow() }>g</button>\n" +
      "<p>${ match @s {\n  .Dot :> \"d\"\n  .Line(n) :> \"l\"\n} }</p>\n";
    expect(build(src, "payload").errors).toEqual([]);
    const bad = build(src.replace("@s = .Dot", "@s = .Nope"), "payload-bad");
    expect(bad.errors).toEqual(["E-TYPE-063"]);
  });

  test("a REASSIGNMENT `@x = Col.Red` does not retype an untyped cell", () => {
    const { errors } = build(
      ENUM +
        "<x> = 0\n" +
        "${\n  function a() { @x = Col.Red }\n  function b() { @x = .Blue }\n}\n" +
        "<button onclick={ a() }>a</button>\n<button onclick={ b() }>b</button>\n<p>${@x}</p>\n",
      "reassign",
    );
    expect(errors).toContain("E-VARIANT-AMBIGUOUS");
  });

  test("a non-variant member initializer (`obj.field`) is not inferred as an enum", () => {
    const { errors } = build(
      "${\n  const cfg = { Red: 1 }\n}\n<n> = cfg.Red\n<p>${@n}</p>\n",
      "member",
    );
    expect(errors).toEqual([]);
  });
});
