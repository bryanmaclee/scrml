/**
 * gate-flip-and-residuals (S142) — Residual 1: a scrml STMT_KEYWORD used as a
 * plain variable name (e.g. `const type = ...`) inside an expression that
 * continues across a value-expecting operator must NOT truncate the expression.
 *
 * ROOT CAUSE (stdlib/compiler/meta-checker.scrml byte 10606): collectExpr's
 * STMT_KEYWORD statement-boundary guard (ast-builder.js) broke at a keyword
 * token used as an identifier in member-access position when it followed a
 * ternary `?` operator. For:
 *     const variants = Array.isArray(type.variants)
 *         ? type.variants.map(...)
 *         : []
 * the second `type` (in `type.variants.map`) is the `type` KEYWORD; collectExpr
 * saw `parts[-1] === "?"` (not ".") and broke, truncating the init to
 * `Array.isArray(type.variants) ?` and emitting `const variants = ... ?;`
 * (invalid JS — the gate's E-CODEGEN-INVALID-LOGIC).
 *
 * FIX: in RHS context (previous part is a value-expecting operator), a
 * STMT_KEYWORD followed by `.`/`(`/`[`/`?.` is an IDENTIFIER operand, not a
 * statement opener — the expression continues. Expression-opener keywords
 * (`if`/`match`/`for`/`partial`/...) are NOT exempted; their dedicated handlers
 * fire before collectExpr.
 *
 * This compiles minimal snippets with the gate ON and asserts no
 * E-CODEGEN-INVALID-LOGIC + acorn-parse-clean emitted client.js.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-kw-ident-ternary-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
}

function assertCleanClient(result, mustContain) {
  const invalid = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
  expect(invalid).toHaveLength(0);
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  expect(out?.clientJs).toBeTruthy();
  // Must NOT contain the dangling `?;` (or `?` then a new statement-terminator).
  expect(out.clientJs).not.toMatch(/\?\s*;/);
  expect(out.clientJs).toContain(mustContain);
  expect(() => acorn.parse(out.clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  return out.clientJs;
}

describe("keyword-as-identifier across a continuation operator does not truncate the expression", () => {
  test("multi-line ternary const-init with `const type` (the keyword as a varname)", () => {
    const src = `function pick(reg) {
    const type = reg.get("x")
    const variants = Array.isArray(type.variants)
        ? type.variants.map(v => v)
        : []
    return variants
}`;
    assertCleanClient(compileSource(src), "type.variants.map");
  });

  test("single-line ternary with the `type` keyword as a member-access operand", () => {
    const src = `function pick(reg) {
    const type = reg.get("x")
    const out = Array.isArray(type.variants) ? type.variants : []
    return out
}`;
    assertCleanClient(compileSource(src), "type.variants");
  });

  test("keyword as a call-position operand after a binary operator", () => {
    const src = `function run(reg) {
    const type = reg.get("x")
    const ok = type.valid && type.check()
    return ok
}`;
    assertCleanClient(compileSource(src), "type.check()");
  });
});
