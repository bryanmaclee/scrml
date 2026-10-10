/**
 * is-some-locator-fixround-s462.test.js — S462 fix round F3 / F5.
 *
 * F3a: `is some` inside a template-literal interpolation in logic lowers like any
 *      other site; it is now a W-IS-SOME-DEPRECATED site and a `scrml fix` site
 *      (ast-builder.js `noteIsSomeInInterpolations` over a template STRING token).
 * F3 : a `^{}` meta body lowers `is some` too; it is a site.
 * F3b: `given` is a scrml word in the `^{}` allow-list's raw-text reader, so an
 *      unparseable `x is given` gets the same diagnostic as `x is some` (it used to
 *      say "'given' is not available inside ^{} meta blocks").
 * F5 : `is some` closing a typed declaration opener (`<mid: string is some>`) gets
 *      the validator message.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { checkMetaBodyNodes } from "../../src/meta-allow-list.ts";
import { fixIsSome } from "../../src/commands/fix-is-some.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const RUN_DIR = join(tmpdir(), `scrml-is-some-fixround-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
function compileSrc(src) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(join(RUN_DIR, "dist"), { recursive: true });
  const file = join(RUN_DIR, "h.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: join(RUN_DIR, "dist"), log: () => {} });
  rmSync(RUN_DIR, { recursive: true, force: true });
  return result;
}
const lints = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d.code === "W-IS-SOME-DEPRECATED");
const errorCodes = (r) => (r.errors ?? []).map((e) => e.code);
const D = "$";
const B = "`";

const TEMPLATE_SRC = [
  "<program>",
  "<out> = \"\"",
  `${D}{`,
  "    function f(v) {",
  `        const t = ${B}v ${D}{v is some ? 1 : 2} and \\${D}{not this} ${D}{${B}nested ${D}{v is some}${B}}${B}`,
  "        @out = t",
  "    }",
  "}",
  `<p onclick=f(1)>${D}{@out}</p>`,
  "</program>",
  "",
].join("\n");

describe("S462 fix round — locator coverage", () => {
  test("F3a: template-literal interpolations (and a nested one) are sites; an escaped `\\${` is not", () => {
    const r = compileSrc(TEMPLATE_SRC);
    expect(errorCodes(r)).toEqual([]);
    const ws = lints(r);
    expect(ws.length).toBe(2);
    expect(ws.map((w) => w.span.line)).toEqual([5, 5]);
  });

  test("F3a: `scrml fix` rewrites them (verified) and nothing else", () => {
    const fp = join(tmpdir(), `scrml-fixround-${process.pid}`, "h.scrml");
    const out = fixIsSome(TEMPLATE_SRC, { filePath: fp });
    expect(out.blockers).toEqual([]);
    expect(out.applied.length).toBe(2);
    expect(out.output.split("\n")[4]).toBe(`        const t = ${B}v ${D}{v is given ? 1 : 2} and \\${D}{not this} ${D}{${B}nested ${D}{v is given}${B}}${B}`);
  });

  test("F3: `is some` in a `^{}` meta body is a site", () => {
    const src = ["<program>", "<c>: int | not = not", "<div>", "    ^{ const ok = @c is some; meta.emit(ok ? \"<p>y</p>\" : \"<p>n</p>\") }", "</div>", "</program>", ""].join("\n");
    const r = compileSrc(src);
    expect(errorCodes(r)).toEqual([]);
    expect(lints(r).length).toBe(1);
  });

  test("F5: `is some` closing a typed opener gets the validator message", () => {
    const src = ["<program>", `${D}{`, "    <signup>", "        <mid: string is some> = <input id=\"mid\" type=\"text\"/>", "    </>", "}", "</program>", ""].join("\n");
    const ws = lints(compileSrc(src));
    expect(ws.length).toBe(1);
    expect(ws[0].message).toContain("validator `is some`");
  });
});

describe("S462 F3b — `given` in the `^{}` allow-list raw-text reader", () => {
  const run = (s) => checkMetaBodyNodes(
    [{ kind: "let-decl", name: "x", init: "1" }, { kind: "bare-expr", expr: `x is ${s} ; ?` }],
    { captured: new Set(), typeNames: new Set() },
  ).map((v) => v.message.replace(/x is (some|given) ; \?/, "x is _ ; ?"));
  test("an unparseable `x is given` body gets the same diagnostic as `x is some`", () => {
    expect(run("given")).toEqual(run("some"));
    expect(run("given").join("")).not.toContain("'given' is not available");
  });
});
