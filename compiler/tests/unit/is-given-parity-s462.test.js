/**
 * is-given-parity-s462.test.js
 *
 * §42.2.4 (S460 "a′, go"): `x is given` is THE explicit presence test, valid
 * wherever `x is some` is. S462 ("a, validator too, go") soft-deprecates
 * `is some` with a `scrml fix` rewrite to `is given` — which is only sound if
 * `is given` compiles to the same program in every position `is some` does.
 *
 * Before S462 it did not. These are the positions that diverged on impl#1
 * (measured by compiling each probe twice, once per spelling, at one path):
 *   - a value-position compound `const ok = @n is given && @b` → E-CODEGEN-INVALID-LOGIC
 *   - `@b && @n is given` → `@b && @n` (the test silently DROPPED)
 *   - `return (g(1)) is given` → `return g(1)` (silently dropped)
 *   - a derived `const <l> = @u is given ? … : …` → E-UNQUOTED-DISPLAY-TEXT
 *   - an `<each>` row attribute `${r.a is given}` → E-CODEGEN-INVALID-LOGIC
 *   - a value-form match arm result `.A :> @u is given` → `is given` left in the JS
 *   - a library-mode `arr[i + 1] is given ? 1 : 0` → `return arr[i + 1]`
 *   - a bare unquoted `if=@u is given` → accepted with the test dropped (no
 *     E-ATTR-UNQUOTED-OPERATOR, which `is some` gets)
 * Root causes: ast-builder.js collectExpr broke the expression at the `given`
 * statement keyword even right after `is`; the codegen string-rewrite fallback
 * (codegen/rewrite.ts) and the unquoted-attribute operator scan
 * (unquoted-attr-value.ts) knew only `is some`.
 *
 * FULL-PIPELINE (compileScrml) per the R26 doctrine; both spellings compile at
 * the SAME path, because emitted names carry a token hashed from the path.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const RUN_DIR = join(tmpdir(), `scrml-is-given-parity-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);

function compileSpelling(tmpl, spelling) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(join(RUN_DIR, "dist"), { recursive: true });
  const file = join(RUN_DIR, "h.scrml");
  writeFileSync(file, tmpl.replaceAll("SPELL", `is ${spelling}`));
  const r = compileScrml({ inputFiles: [file], outputDir: join(RUN_DIR, "dist"), log: () => {} });
  const outs = [];
  for (const [, v] of (r.outputs ?? new Map())) {
    for (const [k, text] of Object.entries(v ?? {})) {
      if (typeof text === "string" && !k.toLowerCase().includes("map")) outs.push(`${k}=${text}`);
    }
  }
  rmSync(RUN_DIR, { recursive: true, force: true });
  return {
    errors: (r.errors ?? []).map((e) => e.code),
    out: outs.join("\n#####\n"),
  };
}

const D = "$";
const PROBES = {
  "value-position compound, `is given` first": `<program>\n<n>: int | not = not\n<b>: bool = true\n${D}{\n  function f() {\n    const ok = @n SPELL && @b\n    return ok\n  }\n}\n<p>${D}{f()}</p>\n</program>\n`,
  "value-position compound, `is given` last": `<program>\n<n>: int | not = not\n<b>: bool = true\n${D}{\n  function f() {\n    const ok = @b && @n SPELL\n    return ok\n  }\n}\n<p>${D}{f()}</p>\n</program>\n`,
  "return of a parenthesized call": `<program>\n${D}{\n  function g(n) { if (n > 0) { return n } return not }\n  function f() {\n    return (g(1)) SPELL\n  }\n}\n<p>${D}{f()}</p>\n</program>\n`,
  "interpolated ternary": `<program>\n<user>: string | not = not\n<p>${D}{@user SPELL ? "a" : "b"}</p>\n</program>\n`,
  "derived declaration": `<program>\ntype U:struct = { name: string }\n<user>: U | not = not\nconst <label> = @user SPELL ? @user.name : "anon"\n<p>${D}{@label}</p>\n</program>\n`,
  "library mode (string-rewrite path)": `${D}{\n  export function f(x) {\n    if (x SPELL) { return 1 }\n    return 0\n  }\n  export function g(arr, i) { return arr[i + 1] SPELL ? 1 : 0 }\n}\n`,
  "each row attributes": `<program>\ntype R:struct = { id: int, a: string | not }\n<rows>: R[] = []\n<ul>\n<each in=@rows as r key=r.id>\n  <li class:on=${D}{r.a SPELL} data-x=${D}{r.a SPELL}>${D}{r.a SPELL ? "y" : "n"}</li>\n</each>\n</ul>\n</program>\n`,
  "value-form match arm result": `<program>\ntype K:enum = { A, B }\n<user>: string | not = not\n${D}{\n  function f(k: K) {\n    return match k {\n      .A :> @user SPELL\n      .B :> false\n    }\n  }\n}\n<p>${D}{f(K.A)}</p>\n</program>\n`,
  "narrowing block": `<program>\ntype U:struct = { name: string }\n<user>: U | not = not\n<n>: int = 0\n${D}{\n  function f() {\n    if (@user SPELL && @n > 0) { return @user.name }\n    return ""\n  }\n}\n<p>${D}{f()}</p>\n</program>\n`,
  "while with an assignment operand": `<program>\n${D}{\n  function f(s) {\n    const re = /a/g\n    let m = not\n    let c = 0\n    while ((m = re.exec(s)) SPELL) { c = c + 1 }\n    return c\n  }\n}\n<p>${D}{f("aaa")}</p>\n</program>\n`,
  "parenthesized attribute condition": `<program>\n<user>: string | not = not\n<n>: int = 0\n<p if=(@user SPELL && @n > 0)>hi</p>\n</program>\n`,
};

describe("§42.2.4 — `is given` compiles exactly as `is some` (S462 conformance restoration)", () => {
  for (const [name, tmpl] of Object.entries(PROBES)) {
    test(name, () => {
      const some = compileSpelling(tmpl, "some");
      const given = compileSpelling(tmpl, "given");
      expect(given.errors).toEqual(some.errors);
      expect(some.errors.filter((c) => c.startsWith("E-"))).toEqual([]);
      expect(given.out).toBe(some.out);
      expect(given.out).not.toContain("is given");
    });
  }

  test("a bare unquoted `if=@x is given` is refused like `is some` (E-ATTR-UNQUOTED-OPERATOR)", () => {
    const tmpl = `<program>\n<user>: string | not = not\n<p if=@user SPELL>hi</p>\n</program>\n`;
    expect(compileSpelling(tmpl, "some").errors).toContain("E-ATTR-UNQUOTED-OPERATOR");
    expect(compileSpelling(tmpl, "given").errors).toContain("E-ATTR-UNQUOTED-OPERATOR");
  });
});
