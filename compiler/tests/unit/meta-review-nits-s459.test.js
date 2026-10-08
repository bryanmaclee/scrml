/**
 * meta-review-nits-s459.test.js — the PR #1359 (`^{}` allow-list) review nits, landed on the
 * s459 meta.emit gate branch.
 *
 *   1  (MED) a compile-time `^{}` dropped `while` / `function` / `match` statements: the
 *      serializer's `default:` returned "". Now every statement is EMITTED (while, plain
 *      function, break / continue, lin, and `match` per §22.9 — statement, or value with
 *      expression arms) or the block is REFUSED with E-META-EVAL-001 naming the form (payload-
 *      binding arm, block-arm match value, destructuring, any kind the serializer does not
 *      write) — by construction: the default case throws.
 *   2  (LOW) `function wrap(){}` in a compile-time `^{}` was reported as "'wrap' is not available".
 *   3  (LOW) a runtime `^{}` reading `window` reported E-META-001 twice.
 *   4  (LOW) the plain-`=` reassignment message spliced its advice into the refused form.
 *   6  (LOW) `_SCRML_DEFAULT_MESSAGES` / `_SCRML_TAG_TO_VALIDATOR` were plain `{}` indexed by data.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { serializeNode, MetaSerializeRefusal } from "../../src/meta-eval.ts";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-review-nits-s459");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  const out = [...(result.outputs?.values?.() ?? [])];
  return {
    codes: errors.map((e) => e.code),
    messages: errors.map((e) => e.message),
    html: out.map((o) => o.html ?? "").join("\n"),
  };
}

describe("nit 1 — no statement of a compile-time ^{} is dropped", () => {
  test("a while loop building <li>s is evaluated (was: empty <ul>, no diagnostic)", () => {
    const r = compile(`<program>\n<ul id="w">\n^{\n  let i = 0\n  let s = ""\n  while (i < 3) { s += "<li>" + i + "</li>"; i += 1 }\n  emit(s)\n}\n</ul>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<li>0</li><li>1</li><li>2</li>");
  });

  test("break / continue inside a while are evaluated", () => {
    const r = compile(`<program>\n<ul>\n^{\n  let i = 0\n  let s = ""\n  while (i < 10) {\n    i += 1\n    if (i == 2) { continue }\n    if (i > 3) { break }\n    s += "<li>" + i + "</li>"\n  }\n  emit(s)\n}\n</ul>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<li>1</li><li>3</li>");
    expect(r.html).not.toContain("<li>2</li>");
  });

  test("a plain function declared in the body is evaluated, with a default parameter", () => {
    const r = compile(`<program>\n<ul>\n^{\n  function wrap(x, tag = "li") { return "<" + tag + ">" + x + "</" + tag + ">" }\n  emit(wrap("a"))\n}\n</ul>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<li>a</li>");
  });

  test("a match statement is EVALUATED (§22.9) — literal, alternation, not and else arms (was: silently dropped)", () => {
    const r = compile(`<program>\n<ul>\n^{\n  const k = "b"\n  match k {\n    "a" :> { emit("<li>A</li>") }\n    "b" | "c" :> emit("<li>BC</li>")\n    else :> { emit("<li>other</li>") }\n  }\n  match k {\n    "a" :> { emit("<li>sa</li>") }\n    not :> { emit("<li>none</li>") }\n    else :> { emit("<li>so</li>") }\n  }\n}\n</ul>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<li>BC</li><li>so</li>");
    expect(r.html).not.toContain("<li>A</li>");
    expect(r.html).not.toContain("<li>other</li>");
  });

  test("a match VALUE with expression arms is evaluated (was: `const m;`, i.e. never assigned)", () => {
    const r = compile(`<program>\n<ul>\n^{\n  const k = "c"\n  const m = match k {\n    "a" :> "<li>A</li>"\n    "b" | "c" :> "<li>BC</li>"\n    else :> "<li>other</li>"\n  }\n  emit(m)\n}\n</ul>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<li>BC</li>");
  });

  test("an arm's break / continue act on the enclosing loop (the match is an if-chain, not a closure)", () => {
    const text = serializeNode({
      kind: "for-stmt", variable: "v", iterable: "xs",
      body: [{ kind: "match-stmt", header: "v", body: [{ kind: "match-arm-block", variant: null, isWildcard: true, body: [{ kind: "continue-stmt", label: null }] }] }],
    });
    expect(text).toContain("continue;");
    expect(text).not.toMatch(/=>|function\s*\(/);
  });

  test("a payload-binding arm is REFUSED naming the cause, never skipped", () => {
    expect(() => serializeNode({ kind: "match-stmt", header: "v", body: [{ kind: "match-arm-block", variant: "Circle", payloadBindings: ["r"], isWildcard: false, body: [] }] }))
      .toThrow(/binds a variant payload/);
  });

  test("a match arm the reader cannot read is REFUSED, never skipped", () => {
    expect(() => serializeNode({ kind: "match-stmt", header: "v", body: [{ kind: "some-future-arm" }] }))
      .toThrow(/`match` arm of a form impl#1 cannot read/);
  });

  test("a match value with a block arm is refused", () => {
    expect(() => serializeNode({ kind: "const-decl", name: "m", init: "", matchExpr: { kind: "match-expr", header: "k", body: [{ kind: "match-arm-block", variant: null, isWildcard: true, body: [] }] } }))
      .toThrow(/block arm/);
  });

  test("a destructuring declaration is refused, never written as `const [object Object]`", () => {
    expect(() => serializeNode({ kind: "const-decl", name: { kind: "destructure-object", properties: [] }, init: "x" }))
      .toThrow(/destructuring declaration/);
  });

  test("an unknown statement kind is refused by the default case (fail closed)", () => {
    expect(() => serializeNode({ kind: "some-future-stmt", exprNode: null, expr: "x" })).toThrow(MetaSerializeRefusal);
  });

  test("the corpus sample meta-match-in-meta-001 still compiles clean (its match now runs)", () => {
    // reflect(T).variants are variant NAMES (strings), so the sample's `match v.name` matches no
    // arm and emits nothing — the same empty output as before S459, now because the match ran
    // and matched nothing rather than because it was dropped.
    const src = readFileSync(join(import.meta.dir, "../../../samples/compilation-tests/gauntlet-s20-meta/meta-match-in-meta-001.scrml"), "utf8");
    const r = compile(src);
    expect(r.codes).toEqual([]);
  });

  test("a match over reflect(T).variants evaluates each arm per variant, and `continue` still works after it", () => {
    const text = serializeNode({ kind: "match-stmt", header: "v", body: [
      { kind: "match-arm-inline", test: "\"Circle\"", result: "emit ( \"<li>Round</li>\" )" },
      { kind: "bare-expr", expr: "\"Square\" | \"Triangle\" :> emit ( \"<li>Corners</li>\" )" },
    ] });
    // Evaluate the serialized statement in a plain function with a recording emit.
    const out = [];
    const run = new Function("emit", "xs", `for (const v of xs) {\n${text}\n}`);
    run((s) => out.push(s), ["Circle", "Square", "Triangle", "Hex"]);
    expect(out).toEqual(["<li>Round</li>", "<li>Corners</li>", "<li>Corners</li>"]);
  });
});

describe("nit 2 — a function declared in a compile-time body is not 'unavailable'", () => {
  test("no E-META-001 for the function's own name", () => {
    const r = compile(`<program>\n<ul>\n^{\n  function wrap(x) { return "<li>" + x + "</li>" }\n  emit(wrap("a"))\n}\n</ul>\n</program>\n`);
    expect(r.codes).not.toContain("E-META-001");
    expect(r.messages.some((m) => m.includes("'wrap' is not available"))).toBe(false);
  });
});

describe("nit 3 — a runtime ^{} free name is reported once", () => {
  test("reading `window` is ONE E-META-001", () => {
    const r = compile(`<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  meta.emit("<p>" + window.location + "</p>")\n}\n</div>\n</program>\n`);
    expect(r.codes.filter((c) => c === "E-META-001").length).toBe(1);
    expect(r.messages[0]).toContain("'window'");
  });
});

describe("nit 4 — the plain-`=` reassignment message reads as one sentence plus advice", () => {
  test("form, then 'is not admitted', then the advice as its own sentence", () => {
    const r = compile(`<program>\n<ul>\n^{\n  let s = ""\n  s = "<li>a</li>"\n  emit(s)\n}\n</ul>\n</program>\n`);
    const m = r.messages.find((x) => x.includes("reassigning a binding"));
    expect(m).toContain("reassigning a binding with a plain `=` (`x = …`) is not admitted inside ^{} meta blocks. " +
      "Use a compound assignment (`x += …`) or declare a new `const`.");
    expect(m).not.toContain("`const` is not admitted");
  });
});

describe("nit 6 — tag-keyed message tables are null-prototype", () => {
  const rt = new Function(SCRML_RUNTIME + "\nreturn { _scrml_message_for, _SCRML_DEFAULT_MESSAGES, _SCRML_TAG_TO_VALIDATOR };")();
  test("both tables have no prototype", () => {
    expect(Object.getPrototypeOf(rt._SCRML_DEFAULT_MESSAGES)).toBeNull();
    expect(Object.getPrototypeOf(rt._SCRML_TAG_TO_VALIDATOR)).toBeNull();
  });
  for (const tag of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    test(`tag "${tag}" falls back to the generic message (a string), not an Object.prototype member`, () => {
      const out = rt._scrml_message_for({ tag }, "Email", "signup.email");
      expect(typeof out).toBe("string");
      expect(out).not.toContain("[object");
      expect(out).toBe(rt._scrml_message_for({ tag: "NoSuchTag" }, "Email", "signup.email"));
    });
  }
  test("a known tag still resolves to its shipped default", () => {
    expect(rt._scrml_message_for({ tag: "Required" }, "Email")).toBe("Email is required.");
  });
});
