// ---------------------------------------------------------------------------
// E-FOR-UNPARENTHESIZED-HEAD — braceless `for … of` loop head (§17.4a, S308)
// ---------------------------------------------------------------------------
//
// SPEC §17.4a: the Tier-0 loop head MUST be parenthesized — `for (x of iterable)`.
// The braceless-head parse branch (ast-builder.js) handles only the legacy English
// `in` form (`for item in @items { ... }`, value-iteration); a braceless `of` is
// NOT consumed, so collectExpr mis-reads the iterable as the bare token `of` and
// codegen emits `for (const x of of)` — valid to `node --check`, a `ReferenceError`
// at module-eval (a silent-broken bundle). The fix fires E-FOR-UNPARENTHESIZED-HEAD
// and recovers by consuming `of` + collecting the real iterable.
//
// This regression test asserts BOTH halves of the contract:
//   (1) the braceless `of` head FIRES the diagnostic (once per head), across
//       braced / `lift` / non-render bodies;
//   (2) the canonical `for (x of ...)` head, the legacy `for x in ...` sugar, and
//       prose starting with `for` do NOT over-fire; and RECOVERY: no broken
//       `for (const x of of)` reaches any emitted output.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "fuph-"));
function compile(src) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function fuphErrors(r) {
  return (r.errors ?? []).filter(e => (e.code ?? "") === "E-FOR-UNPARENTHESIZED-HEAD");
}
function allEmittedJs(r) {
  let js = "";
  if (r.outputs && typeof r.outputs.forEach === "function") {
    r.outputs.forEach(v => { js += (v?.clientJs ?? "") + "\n" + (v?.serverJs ?? ""); });
  }
  return js;
}
const W = body => `<program>\n\${\n  <items> = [1, 2, 3]\n}\n${body}\n</program>\n`;

describe("E-FOR-UNPARENTHESIZED-HEAD — fires on a braceless `for … of` head", () => {
  test("braceless `of` + braced body fires once (Error → result.errors)", () => {
    const r = compile(W(`<ul>\${\n  for x of @items { lift <li>\${x}</> }\n}</>`));
    expect(fuphErrors(r).length).toBe(1);
    // Partition: a §34 Error lands in result.errors, never result.warnings.
    const inWarnings = (r.warnings ?? []).filter(w => (w.code ?? "") === "E-FOR-UNPARENTHESIZED-HEAD");
    expect(inWarnings.length).toBe(0);
  });

  test("braceless `of` + braceless `lift` body (the reported formB) fires", () => {
    const r = compile(W(`<ul>\${\n  for x of @items lift <li>\${x}</>\n}</>`));
    expect(fuphErrors(r).length).toBe(1);
  });

  test("braceless `of` in a non-render logic body fires", () => {
    const r = compile(W(`\${\n  for x of @items { log(x) }\n}\n<p>ok</>`));
    expect(fuphErrors(r).length).toBe(1);
  });

  test("braceless `of` in a for-AS-EXPRESSION fires (the S308 adversarial-found copy)", () => {
    // `const names = for item of @items { lift item }` routes through
    // parseOneForStmt (the for-as-expression parser) — a THIRD braceless-head
    // copy that the first cut left unpatched (residual `for (const item of of)`).
    const r = compile(W(`\${\n  const names = for item of @items { lift item }\n}\n<p>ok</>`));
    expect(fuphErrors(r).length).toBe(1);
    expect(/of\s+of\b/.test(allEmittedJs(r))).toBe(false);
  });

  test("the message steers to the parenthesized head + cites §17.4a", () => {
    const e = fuphErrors(compile(W(`\${\n  for x of @items { log(x) }\n}\n<p>ok</>`)));
    expect(e.length).toBe(1);
    expect(e[0].message).toMatch(/for \(x of/);   // names the parenthesized fix
    expect(e[0].message).toMatch(/17\.4a/);        // cites §17.4a
  });

  test("RECOVERY: no broken `for (const x of of)` reaches any emitted output", () => {
    const r = compile(W(`\${\n  for x of @items { log(x) }\n}\n<p>ok</>`));
    expect(fuphErrors(r).length).toBe(1);
    expect(/of\s+of\b/.test(allEmittedJs(r))).toBe(false);
  });
});

describe("E-FOR-UNPARENTHESIZED-HEAD — does NOT false-fire on legitimate forms", () => {
  test("canonical parenthesized `for (x of @items) { lift ... }` is clean", () => {
    expect(fuphErrors(compile(W(`<ul>\${\n  for (x of @items) { lift <li>\${x}</> }\n}</>`))).length).toBe(0);
  });

  test("legacy braceless English `for item in @items { lift ... }` is clean (unchanged)", () => {
    expect(fuphErrors(compile(W(`<ul>\${\n  for item in @items { lift <li>\${item}</> }\n}</>`))).length).toBe(0);
  });

  test("prose starting with `for` does not over-fire", () => {
    const r = compile(`<program>\n<p>for sale: one of many</p>\n</program>\n`);
    expect(fuphErrors(r).length).toBe(0);
  });
});
