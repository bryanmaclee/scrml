/**
 * meta-review-r3-s458.test.js — S458 differential review, round 3.
 *
 * All findings are one class: the allow-list's idea of what a name is / where a block
 * sits differed from what codegen emits. The boundary moved, not the position:
 *   HIGH-1 the meta-block FINDER (meta-checker.findMetaBlocks) and the compile-time
 *          evaluator (meta-eval.processNodeList) are now TOTAL — they descend every AST
 *          child container, so a `^{}` in an `if` / `else` branch, a match arm, a loop
 *          of any shape, a function body, is checked and (if compile-time) evaluated
 *          wherever it sits. Before: a `^{ meta.emit.constructor(…)() }` in an if-branch
 *          ran in the browser; a compile-time `^{ emit(…) }` in an if-branch was emitted
 *          as a runtime effect (`emit is not defined`).
 *   HIGH-2 a name that is a host global (`window`, `location`, …) is refused inside a
 *          `^{}` body even when the file declares a cell or function of that name — the
 *          emitted body cannot tell the author's binding from the global. A reactive
 *          cell is admitted only as `@name` / `meta.get`, never bare.
 *   MED    the enclosing-scope binder covers every binding form: C-style `for`,
 *          destructured for-of, destructured params, match-arm payloads.
 *   LOW    a body-local shadowing an outer decl no longer prepends the outer (parse
 *          error); a decl read by a RUNTIME `^{}` or client code stays in the client.
 *
 * NOTE on the security assertion: `compileScrml` returns a best-effort `outputs` map
 * ALONGSIDE `errors`; it is the CLI / build path that writes NO artifact when a compile
 * errors (S457). So a refusal is asserted as "E-META-001 is among the errors" (a compile
 * that errors writes nothing); an empirical no-artifact CLI check is in the dispatch report.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-review-r3-s458");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  const out = [...(result.outputs?.values?.() ?? [])];
  return { codes: errors.map((e) => e.code), messages: errors.map((e) => e.message), clientJs: out.map((o) => o.clientJs ?? "").join("\n"), html: out.map((o) => o.html ?? "").join("\n") };
}

// A ^{} body that reaches the host through a prototype chain, placed in CONTAINER.
const PWN = `meta.emit.constructor("globalThis.__r3 = 1")()`;
const PRE = `<flag> = true\n<n> = 0\n<x> = 0\n`;

describe("S458 r3 HIGH-1 — a ^{} is checked wherever it sits (total descent)", () => {
  const containers = {
    "if branch": `\${ if (@flag) { ^{ meta.get("x"); ${PWN} } } }`,
    "else branch": `\${ if (@flag) { } else { ^{ meta.get("x"); ${PWN} } } }`,
    "else-if branch": `\${ if (@flag) { } else if (@n > 0) { ^{ meta.get("x"); ${PWN} } } }`,
    "for-of body": `\${ for (const i of [1, 2]) { ^{ meta.get("x"); ${PWN} } } }`,
    "C-style for body": `\${ for (let i = 0; i < 2; i = i + 1) { ^{ meta.get("x"); ${PWN} } } }`,
    "while body": `\${ let g = true\n while (g) { g = false\n ^{ meta.get("x"); ${PWN} } } }`,
    "function body": `\${ function go() { ^{ meta.get("x"); ${PWN} } } }`,
  };
  for (const [where, logic] of Object.entries(containers)) {
    test(`refused in an ${where}`, () => {
      const r = compile(`<program>\n${PRE}<div>\n${logic}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
    });
  }

  test("a computed prototype reach (k = \"constr\"+\"uctor\") in an if-branch is refused", () => {
    const r = compile(`<program>\n${PRE}<div>\n\${ if (@flag) { ^{ meta.get("x"); const k = "constr" + "uctor"; const f = meta.get[k][k]; f("1")() } } }\n</div>\n</program>\n`);
    expect(r.codes).toContain("E-META-001");
  });

  test("side bug: a compile-time ^{ emit(…) } in an if-branch is evaluated, not emitted as a runtime effect", () => {
    const r = compile(`<program>\n\${ if (true) { ^{ emit("<p>ct</p>") } } }\n</program>\n`);
    expect(r.clientJs).not.toMatch(/_scrml_meta_effect\([^)]*\bemit\(/);
    expect(r.codes.filter((c) => c === "E-META-EVAL-001")).toEqual([]);
  });

  test("a legitimate runtime ^{} in an if-branch still compiles", () => {
    const r = compile(`<program>\n<flag> = true\n<x> = 0\n<div>\n\${ if (@flag) { ^{ meta.get("x"); meta.emit("<p>ok</p>") } } }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
  });
});

describe("S458 r3 HIGH-2 — a host-global name is not reachable from a ^{} body", () => {
  test("a cell named `location` is refused as a bare reference", () => {
    const r = compile(`<program>\n<location> = ""\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  location.href = "javascript:1"\n  meta.emit("<p>r</p>")\n}\n</div>\n</program>\n`);
    expect(r.messages.some((m) => m.includes("'location' is not available"))).toBe(true);
  });

  test("a function named `window` is refused — the emitted ref cannot be told from the global", () => {
    const r = compile(`<program>\n<x> = 0\n\${ function window(n) { return n } }\n<div>\n^{\n  meta.get("x")\n  window.eval("1")\n  meta.emit("<p>r</p>")\n}\n</div>\n</program>\n`);
    expect(r.messages.some((m) => m.includes("'window' is not available"))).toBe(true);
  });

  test("a cell named `document` used bare is refused; @document / meta.get reaches it", () => {
    const bare = compile(`<program>\n<document> = ""\n<x> = 0\n<div>\n^{ meta.get("x"); meta.emit("<p>" + document + "</p>") }\n</div>\n</program>\n`);
    expect(bare.messages.some((m) => m.includes("'document' is not available"))).toBe(true);
    const viaGet = compile(`<program>\n<document> = "a"\n<x> = 0\n<div>\n^{ meta.get("x"); meta.emit("<p>" + meta.get("document") + "</p>") }\n</div>\n</program>\n`);
    expect(viaGet.codes).toEqual([]);
  });

  test("a real body-LOCAL shadowing a global name is allowed (it is a lexical binding)", () => {
    const r = compile(`<program>\n^{\n  const location = "x"\n  emit("<p>" + location + "</p>")\n}\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<p>x</p>");
  });
});

describe("S458 r3 MED — the enclosing binder covers every binding form (no E-META-001)", () => {
  const forms = {
    "C-style for": `\${ for (let i = 0; i < 2; i = i + 1) { ^{ meta.get("x"); meta.emit("<p>" + i + "</p>") } } }`,
    "destructured for-of (array)": `\${ const ps = [[1, 2]]\n for (const [a, b] of ps) { ^{ meta.get("x"); meta.emit("<p>" + a + b + "</p>") } } }`,
    "destructured for-of (object)": `\${ const rs = [{ id: 1 }]\n for (const { id } of rs) { ^{ meta.get("x"); meta.emit("<p>" + id + "</p>") } } }`,
    "destructured param": `\${ function r2({ a, b }) { ^{ meta.get("x"); meta.emit("<p>" + a + b + "</p>") }\n return a } }`,
  };
  for (const [form, logic] of Object.entries(forms)) {
    test(`${form}: the binding is admitted`, () => {
      const r = compile(`<program>\n${PRE}<div>\n${logic}\n</div>\n</program>\n`);
      expect(r.codes).not.toContain("E-META-001");
    });
  }

  test("match-arm payload binding is admitted (no E-META-001)", () => {
    const r = compile(`<program>\n<x> = 0\ntype Shape:union = Circle(number) | Square(number)\n<shape>: Shape = Shape.Circle(3)\n<div>\n\${ match @shape { .Circle(r) :> { ^{ meta.get("x"); meta.emit("<p>" + r + "</p>") } } .Square(s) :> { } } }\n</div>\n</program>\n`);
    expect(r.codes).not.toContain("E-META-001");
  });
});

describe("S458 r3 LOW", () => {
  test("a body-local shadowing an outer decl does not prepend the outer (no parse error)", () => {
    const r = compile(`<program>\n\${ const max = 10 }\n^{\n  const max = 1\n  emit("<p>" + max + "</p>")\n}\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<p>1</p>");
  });

  test("a decl read by a runtime ^{} stays in the client (not stripped as compile-time-only)", () => {
    const r = compile(`<program>\n<x> = 0\n\${ const pageSize = 25 }\n^{ emit("<p>" + pageSize + "</p>") }\n<div>\n^{ meta.get("x"); meta.emit("<p>" + pageSize + "</p>") }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain("const pageSize = 25");
  });
});
