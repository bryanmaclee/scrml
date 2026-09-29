/**
 * S441 (s441-demo-blockers, DEFECT 2) — a SPEC §7.2.1 not-scrml construct written
 * directly in a `<program>` / `<page>` body (the §40.8 default-logic body-top)
 * must get the SAME E-*-NOT-IN-SCRML diagnostic it gets inside `${ }`, not ship
 * as page text at exit 0.
 *
 * SPEC §7.2.1: "§7.2's "all JavaScript is valid" sentence has exclusions, and
 * they are rejected at the parse layer, each under a code of the
 * `E-*-NOT-IN-SCRML` family."
 * SPEC §40.8: "Inside `<program>`, the body parses in default-logic mode …"
 *
 * The fix lifts a text run by its brace-delimited grammar head (`class`,
 * `async function|fn`, `try`, `switch`, `for await`) in BOTH the live lift
 * (`liftBareDeclarations`) and the native mirror (`liftBareBlocks`, whose tree
 * decides E-CLASS-NOT-IN-SCRML for both pipelines). Prose that merely contains
 * the WORD never has a brace-delimited head and must stay text.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { forbiddenConstructHead as liveHead } from "../../src/ast-builder.js";
import { forbiddenConstructHead as nativeHead } from "../../native-parser/parse-markup.js";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compile(src, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "s441-d2-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, src);
    const out = join(dir, "out");
    const r = compileScrml({ inputFiles: [file], write: true, outputDir: out, log: () => {}, ...opts });
    let html = "";
    try {
      for (const f of readdirSync(out)) if (f.endsWith(".html")) html += readFileSync(join(out, f), "utf8");
    } catch {}
    return { errors: (r.errors ?? []).map((d) => ({ code: d.code, line: d.span?.line, col: d.span?.col })), html };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const codesOf = (r) => r.errors.map((e) => e.code);

const CONSTRUCTS = {
  class: { src: "class Counter {\n    inc() { return 1 }\n}", code: "E-CLASS-NOT-IN-SCRML", text: "class Counter" },
  "class extends": { src: "class Sub extends Base {\n}", code: "E-CLASS-NOT-IN-SCRML", text: "class Sub" },
  "export class": { src: "export class Counter { }", code: "E-CLASS-NOT-IN-SCRML", text: "class Counter" },
  "async function": { src: "async function load() {\n    return 1\n}", code: "E-ASYNC-NOT-IN-SCRML", text: "async function" },
  "async fn": { src: "async fn load() {\n    return 1\n}", code: "E-ASYNC-NOT-IN-SCRML", text: "async fn" },
  "try/catch": { src: "try {\n    go()\n} catch (e) {\n    go()\n}", code: "E-TRY-NOT-IN-SCRML", text: "try {" },
  switch: { src: "switch (k) {\n    case 1: break\n}", code: "E-SWITCH-FORBIDDEN", text: "switch (" },
  "for await": { src: "for await (const x of xs) {\n    log(x)\n}", code: "E-FOR-AWAIT-NOT-IN-SCRML", text: "for await" },
};

describe("S441 — a §7.2.1 construct at the <program> body-top gets its ${ } diagnostic", () => {
  for (const [name, c] of Object.entries(CONSTRUCTS)) {
    test(`${name}: after markup in <program>`, () => {
      const top = compile(`<program>\n<p>hi</p>\n${c.src}\n<p>after</p>\n</program>\n`);
      expect(codesOf(top)).toContain(c.code);
      expect(top.html).not.toContain(c.text);
    });
    test(`${name}: first thing in a <page> body`, () => {
      const page = compile(`<page>\n${c.src}\n<p>hi</p>\n</page>\n`);
      expect(codesOf(page)).toContain(c.code);
    });
    test(`${name}: same code at the same keyword position as inside \${ }`, () => {
      // Line 3 in both shapes: the construct's first line.
      const inLogic = compile(`<program>\n<p>hi</p>\n\${\n${c.src}\n}\n</program>\n`);
      const bare = compile(`<program>\n<p>hi</p>\n${c.src}\n</program>\n`);
      const a = inLogic.errors.find((e) => e.code === c.code);
      const b = bare.errors.find((e) => e.code === c.code);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(b.line).toBe(a.line - 1); // the `${` line shifts the in-logic form by one
      expect(b.col).toBe(a.col);
    });
  }

  test("the native pipeline (--parser=scrml-native) fires E-CLASS-NOT-IN-SCRML at the body-top too", () => {
    const r = compile(`<program>\n<p>hi</p>\nclass Counter { }\n</program>\n`, { parser: "scrml-native" });
    expect(codesOf(r)).toContain("E-CLASS-NOT-IN-SCRML");
  });
});

describe("S441 — the WORD is not the construct: prose and attributes stay silent", () => {
  const FAMILY = ["E-CLASS-NOT-IN-SCRML", "E-TRY-NOT-IN-SCRML", "E-SWITCH-FORBIDDEN", "E-ASYNC-NOT-IN-SCRML", "E-FOR-AWAIT-NOT-IN-SCRML"];
  const PROSE = {
    "`class` in element text": `<p>The class of 2026</p>`,
    "a class= attribute": `<div class="card">x</div>`,
    "a bare prose line opening with `class`": `class of 2026 reunion`,
    "prose `class … extends` with no brace": `class action extends to all members`,
    "prose opening with `try`": `try harder next time`,
    "prose `switch` with a parenthetical": `switch it off (please)`,
    "prose `async function` with no header": `async function calls are slow`,
    "prose `for await`": `for await the results, see below`,
  };
  for (const [name, line] of Object.entries(PROSE)) {
    test(name, () => {
      const r = compile(`<program>\n<p>x</p>\n${line}\n<p>y</p>\n</program>\n`);
      for (const code of FAMILY) expect(codesOf(r)).not.toContain(code);
      expect(r.errors).toEqual([]);
    });
  }
});

describe("S441 — live and native recognisers agree (drift guard)", () => {
  const TABLE = [
    ["class Foo {", "class"], ["export class Foo {", "class"], ["export default class {", "class"],
    ["class Foo extends Bar {", "class"], ["class Foo\n{", "class"], ["  class A extends mix(B, C) {", "class"],
    ["try {", "try"], ["try{", "try"],
    ["switch (x) {", "switch"], ["switch (f(a, \")\")) {", "switch"],
    ["for await (const x of y) log(x)", "for await"],
    ["async function f() {", "async"], ["async function f(a, b) -> number {", "async"], ["export async function f() {", "async"],
    ["server async function f() {", "async"], ["async fn f {", "async"], ["async fn f(x) {", "async"],
    ["class of 2026", null], ["classify {", null], ["class action extends to all", null], ["try harder", null],
    ["switch it off (now)", null], ["switch (on) the light", null], ["async function calls are slow", null],
    ["for await the day", null], ["throw new Error(\"x\")", null], ["await load()", null], ["import(\"./x.js\")", null],
    ["async () => 1", null], ["<p>class Foo {</p>", null], ["The class Foo { } example", null],
  ];
  for (const [raw, want] of TABLE) {
    test(JSON.stringify(raw) + " -> " + String(want), () => {
      expect(liveHead(raw)).toBe(want);
      expect(nativeHead(raw)).toBe(want);
    });
  }
});
