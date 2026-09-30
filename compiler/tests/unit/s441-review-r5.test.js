/**
 * S441 declared-prose — review round 5 (PA review `review/s443-prose-r4`,
 * docs/known-gaps.md `g-body-top-invariant-bypassed-by-raw-text-nodes`).
 *
 * The coverage invariant credits a body-top statement only for the tokens it
 * COMPILES (SPEC §40.8 S441 coverage bullet; ruling S443 item 4 — "a node
 * covers only tokens it compiles"). Shared grammar: native-parser/
 * body-top-coverage.js.
 *   A — import / export / type stop where their grammar ends: the rest of the
 *       line is reported, a swallowed next line is compiled; a declaration that
 *       compiles nothing (`import stuff`, `type here`, `export data`,
 *       `fn heading`) and a bare literal statement (`404`) are errors.
 *   B — a body-top `;` is formatting (native fired E-INTERNAL on it).
 *   C — a label on a statement that is not a loop compiles nothing
 *       (`Total: 42` vanished on native).
 *   D — a tagged template the native bridge drops is no longer silent.
 * Every case runs on BOTH front ends.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const DIR = "/tmp/s441-review-r5-fixtures";
mkdirSync(DIR, { recursive: true });
writeFileSync(join(DIR, "a.js"), "export const a = 1; export default 2;\n");
let n = 0;
function compile(bodyLines, parser) {
  const f = join(DIR, `c-${++n}.scrml`);
  writeFileSync(f, `<program>\nfunction log(x) { console.log(x) }\n${bodyLines}\n<p id="z">end</p>\n</program>\n`);
  const out = join(DIR, `out-${n}`);
  if (existsSync(out)) rmSync(out, { recursive: true });
  const r = compileScrml({ inputFiles: [f], outputDir: out, write: true, log: () => {}, parser: parser ?? null });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (ext) => (existsSync(join(out, `c-${n}.${ext}`)) ? readFileSync(join(out, `c-${n}.${ext}`), "utf8") : "");
  return { errors, codes: errors.map((e) => e.code), client: read("client.js"), html: read("html") };
}
const at = (e) => e.tabSpan ?? e.span ?? {};
const BOTH = [["default", null], ["scrml-native", "scrml-native"]];

for (const [label, parser] of BOTH) {
  describe(`A — a statement covers only what it compiles (${label})`, () => {
    // ruling S443 item 4: body-top code that does nothing is a compile error.
    for (const src of ["import stuff", "type here", "export data", "fn heading", "404", "-1", "true", "[1, 2]", "\"a\" + 1"]) {
      test(`\`${src}\` compiles nothing → a compile error at line 3, never silent`, () => {
        const r = compile(src, parser);
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.codes).not.toContain("E-INTERNAL-BODY-TOP-DROPPED");
        expect(r.errors.some((e) => at(e).line === 3 || at(e).line === 4)).toBe(true);
      });
    }
    for (const [src, rest] of [
      ["type Color = \"red\" | \"blue\" zqxone zqxtwo", "zqxone"],
      ["type N = number zqxone", "zqxone"],
      ["export type T = number zqxone", "zqxone"],
    ]) {
      test(`\`${src}\` — the type ends before the line does: \`${rest}\` is reported`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(r.errors[0].message).toContain(rest);
        expect(at(r.errors[0]).line).toBe(3);
      });
    }
    test("`type Color = \"red\" | \"blue\",⏎Welcome to the store` — both lines reported", () => {
      const r = compile("type Color = \"red\" | \"blue\",\nWelcome to the store", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT", "E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors.map((e) => at(e).line).sort()).toEqual([3, 4]);
    });
    test("a body token named like an Object.prototype member (`toString`, `constructor`) is not read as a bracket", () => {
      const r = compile("function enc(h) {\n    return String(h).toString() + \"constructor\".valueOf()\n}\nlog(enc(1))", parser);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("toString");
    });
    test("well-formed declarations still compile, and the next line is its own statement", () => {
      const r = compile("import { a } from \"./a.js\";\ntype T = number;\ntype U = \"x\" | \"y\"\ntype P = number(>0)\nexport type Q = number\nlog(\"after\")", parser);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("after");
    });
  });

  describe(`B — a body-top \`;\` is source formatting (${label})`, () => {
    for (const src of ["<count> = 0\n@count = 1;", "log(1); log(2);", ";", "log(1); ; log(2)"]) {
      test(`${JSON.stringify(src)} compiles clean`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual([]);
      });
    }
  });

  describe(`C — a label on a non-loop compiles nothing (${label})`, () => {
    for (const src of ["Total: 42", "Step1: \"Install the app\"", "Docs: https://example.com/x", "Status: ready"]) {
      test(`\`${src}\` → E-UNQUOTED-DISPLAY-TEXT at line 3`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(at(r.errors[0]).line).toBe(3);
      });
    }
    test("a label on a LOOP is code (§49), not prose", () => {
      // (A labelled `break` does not compile inside an explicit `${ … }`
      // either — a pre-existing codegen gap outside this check — so the
      // loop here does not use its label.)
      const r = compile("outer: for (const x of [1, 2]) { log(\"loop\" + x) }", parser);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("loop");
    });
  });
}

describe("A — default front end: a declaration that swallowed the next line gives it back", () => {
  test("`import { a } from \"./a.js\" -⏎log(\"side effect\")` — `-` reported, the call compiles", () => {
    const r = compile("import { a } from \"./a.js\" -\nlog(\"side effect\")", null);
    expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    expect(r.errors[0].message).toContain("`-`");
    expect(at(r.errors[0]).line).toBe(3);
  });
  for (const [src, rest] of [
    ["import zz from \"./a.js\" zqxone", "zqxone"],
    ["export 3.14 zqF", "3.14"],
    ["export const zq = 1 zqxone", "zqxone"],
    ["export function f2() { return 1 } zqxone", "zqxone"],
    ["export { log } zqxone", "zqxone"],
    ["export * from \"./a.js\" zqxone", "zqxone"],
  ]) {
    test(`\`${src}\` → the uncompiled \`${rest}\` is reported`, () => {
      const r = compile(src, null);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain(rest);
    });
  }
});

describe("D — native: a tagged template the bridge drops is not silent", () => {
  test("`log`x`` at body top fails closed on native (the bridge translates it to an empty escape-hatch)", () => {
    const r = compile("log`x`", "scrml-native");
    expect(r.codes).toEqual(["E-INTERNAL-BODY-TOP-DROPPED"]);
  });
});
