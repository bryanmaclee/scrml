/**
 * is-some-deprecated-lint-s462.test.js
 *
 * §42.2.2a / §55.1 / §63 / §34 — W-IS-SOME-DEPRECATED (S462; ruling:
 * user-voice-scrml.md S462 "a, validator too, go"). `x is some` and the
 * `<x is some>` validator are SOFT-DEPRECATED spellings of `is given` (§63.1
 * Stage 1): they parse identically and surface one info-level
 * W-IS-SOME-DEPRECATED per site, naming `is given` and `scrml fix`.
 * `E-IS-SOME-DEPRECATED` is reserved, never emitted.
 *
 * Emit site (impl#1): api.js stage TAB, from ast-builder.js `legacyIsSomeSites`
 * (impl#1's own token streams) confirmed against the source by
 * is-some-deprecation.ts `confirmIsSomeSites`.
 *
 * Also pinned here: the §55.1 validator `is given` / `is some` now DECLARES
 * its cell (before S462 the scan declined on the `is` keyword and the cell
 * silently vanished — every read blamed with E-SCOPE-001 / E-STATE-UNDECLARED).
 *
 * FULL-PIPELINE (compileScrml) per the R26 doctrine.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { confirmIsSomeSites, IS_SOME_LINT } from "../../src/is-some-deprecation.ts";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const RUN_DIR = join(tmpdir(), `scrml-is-some-lint-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);

function compileSrc(src) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(join(RUN_DIR, "dist"), { recursive: true });
  const file = join(RUN_DIR, "h.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: join(RUN_DIR, "dist"), log: () => {} });
  const p = join(RUN_DIR, "dist", "h.client.js");
  const clientJs = existsSync(p) ? readFileSync(p, "utf8") : "";
  rmSync(RUN_DIR, { recursive: true, force: true });
  return { result, clientJs };
}

const lints = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d.code === IS_SOME_LINT);
const errorCodes = (r) => (r.errors ?? []).map((e) => e.code);
const D = "$";

describe("W-IS-SOME-DEPRECATED — the expression form `x is some`", () => {
  const SRC = [
    "<program>",
    "type U:struct = { name: string }",
    "<user>: U | not = not",
    "<n>: int = 0",
    `${D}{`,
    "  function f() {",
    "    if (@user is some) { return @user.name }",
    "    return \"\"",
    "  }",
    "}",
    `<p if=(@user is some && @n > 0)>${D}{f()}</p>`,
    `<p>${D}{@user is some ? "yes" : "no"}</p>`,
    "</program>",
    "",
  ].join("\n");

  test("one info-level lint per site, in result.warnings, never an error", () => {
    const { result } = compileSrc(SRC);
    expect(errorCodes(result)).toEqual([]);
    const ws = lints(result);
    expect(ws.length).toBe(3);
    for (const w of ws) expect(w.severity).toBe("info");
    expect((result.errors ?? []).some((e) => e.code === IS_SOME_LINT)).toBe(false);
  });

  test("each lint is placed at its `is some` (line and column of the `is`)", () => {
    const { result } = compileSrc(SRC);
    const at = lints(result).map((w) => `${w.span.line}:${w.span.col}`).sort();
    // line 7 `    if (@user is some)` → col 15; line 11 `<p if=(@user is some` → col 14;
    // line 12 `<p>${@user is some` → col 12.
    expect(at).toEqual(["11:14", "12:12", "7:15"]);
  });

  test("the message names the canonical spelling, `scrml fix` and §42.2.2a", () => {
    const { result } = compileSrc(SRC);
    const [w] = lints(result);
    expect(w.message).toContain("`x is given`");
    expect(w.message).toContain("scrml fix");
    expect(w.message).toContain("§42.2.2a");
  });

  test("the canonical `is given` draws no lint", () => {
    const { result } = compileSrc(SRC.replaceAll("is some", "is given"));
    expect(errorCodes(result)).toEqual([]);
    expect(lints(result)).toEqual([]);
  });

  test("runtime identity: both spellings emit byte-identical client JS (§63.5)", () => {
    const a = compileSrc(SRC).clientJs;
    const b = compileSrc(SRC.replaceAll("is some", "is given")).clientJs;
    expect(a.length).toBeGreaterThan(0);
    // The emitted JS carries no source spelling except in comments that echo an
    // attribute's source text; compare with those normalized.
    expect(a.replaceAll("is some", "is given")).toBe(b);
  });

  test("prose, comments and strings are not sites", () => {
    const src = [
      "<program>",
      "<user>: string | not = not",
      `${D}{`,
      "  // this is some comment",
      "  function f() { return \"this is some text\" }",
      "}",
      `<p>This is some prose. ${D}{f()}</p>`,
      "</program>",
      "",
    ].join("\n");
    const { result } = compileSrc(src);
    expect(lints(result)).toEqual([]);
  });

  test("no duplicate per site: an `<each>` row, a component body, a `<#request>` read", () => {
    const src = [
      "<program>",
      "type R:struct = { id: int, a: string | not }",
      "<rows>: R[] = []",
      "const C = <div props={ x?: string }>",
      `    <button onclick=${D}{() => { if (x is some) { log(x) } }}>b</button>`,
      "</>",
      `${D}{ function log(v) { return v } }`,
      `${D}{ server function load() { return "u" } }`,
      `<request id="userReq">${D}{ load() }</request>`,
      `<p if=${D}{<#userReq>.data is some}>x</p>`,
      "<ul>",
      "<each in=@rows as r key=r.id>",
      `  <li data-x=${D}{r.a is some}>${D}{r.a is some ? "y" : "n"}</li>`,
      "</each>",
      "</ul>",
      "<C/>",
      "</program>",
      "",
    ].join("\n");
    const { result } = compileSrc(src);
    const ws = lints(result);
    const keys = ws.map((w) => `${w.span.line}:${w.span.col}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ws.length).toBe(4);
  });
});

describe("W-IS-SOME-DEPRECATED — the §55.1 validator `<x is some>`", () => {
  const VAL = (spelling) => [
    "<program>",
    `<mid ${spelling}> = ""`,
    "<input bind:value=@mid>",
    `<p>${D}{@mid}</p>`,
    "</program>",
    "",
  ].join("\n");

  test("the validator declares its cell (both spellings) — no E-SCOPE-001 / E-STATE-UNDECLARED", () => {
    // (A top-level Shape-1 cell's validators emit no runtime on impl#1 for ANY
    // predicate — g-top-level-scalar-validators-dead, §55.5.1 Nominal. What is
    // pinned here is that the declaration is read; the Shape-2 test below pins the
    // emitted validator.)
    for (const s of ["is some", "is given"]) {
      const { result, clientJs } = compileSrc(VAL(s));
      expect(errorCodes(result)).toEqual([]);
      expect(clientJs).toContain('_scrml_cs_reactive_set("mid", "")');
    }
  });

  test("`<x is some>` draws one lint with the validator message; `<x is given>` draws none", () => {
    const some = lints(compileSrc(VAL("is some")).result);
    expect(some.length).toBe(1);
    expect(some[0].message).toContain("validator `is some`");
    expect(some[0].message).toContain("§55.1");
    expect(some[0].span.line).toBe(2);
    expect(lints(compileSrc(VAL("is given")).result)).toEqual([]);
  });

  test("runtime identity: both validator spellings emit byte-identical client JS", () => {
    expect(compileSrc(VAL("is some")).clientJs).toBe(compileSrc(VAL("is given")).clientJs);
  });

  test("a Shape-2 compound field validator is read too", () => {
    const src = [
      "<signup>",
      "  <name is some> = <input type=\"text\"/>",
      "</>",
      "<program>",
      `<p>${D}{@signup.name}</p>`,
      "</program>",
      "",
    ].join("\n");
    const { result, clientJs } = compileSrc(src);
    expect(errorCodes(result)).toEqual([]);
    expect(lints(result).length).toBe(1);
    expect(clientJs).toContain("_scrml_validator_fire(\"is given\"");
  });
});

describe("confirmIsSomeSites — a candidate the source does not confirm is dropped", () => {
  const src = "if (x is some) { y }  // is some\nis someone";
  test("a real site is confirmed with the `is` offset", () => {
    const at = src.indexOf("some");
    const [s] = confirmIsSomeSites(src, [{ start: at, end: at + 4, kind: "expr" }]);
    expect(s.isStart).toBe(src.indexOf("is some"));
    expect(s.line).toBe(1);
  });
  test("a misplaced offset, a non-word, and a missing `is` are dropped", () => {
    expect(confirmIsSomeSites(src, [{ start: 3, end: 7, kind: "expr" }])).toEqual([]);
    const someone = src.indexOf("someone");
    expect(confirmIsSomeSites(src, [{ start: someone, end: someone + 4, kind: "expr" }])).toEqual([]);
    const y = "xyz some";
    expect(confirmIsSomeSites(y, [{ start: 4, end: 8, kind: "expr" }])).toEqual([]);
  });
});
