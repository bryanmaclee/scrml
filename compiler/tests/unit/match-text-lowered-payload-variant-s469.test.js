/**
 * S469 r8 — g-impl1-text-lowered-match-payload-variant-misdispatch-s469 (HIGH; fixed in
 * s469-impl1-arm-commas). A match lowered from TEXT (`rewriteMatchExpr`: a server function's
 * `v = match …` / `String(match …)`, an engine `derived=match`) compared a PAYLOAD variant value —
 * `{ variant: "Circle", data: { r: 5 } }` — with the name `"Circle"`: never equal, so the else arm
 * ran silently, and `.Circle(r)` never bound `r`. It now dispatches on the tag and binds `.data`.
 *
 * These tests EXECUTE the emitted server function on payload and unit values (the route is called
 * the way the client calls it) and check the result, in the newline and comma spellings.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "text-match-payload-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const PRE = `type Shape:enum = { Circle(r: number), Square(s: number), Rect(w: number, h: number), Tri, Dot }\n<n> = ""\n`;
const POS = {
  "server reassignment `v = match`": (a) => `\${\n  server function pick(k: Shape) {\n    let v = ""\n    v = match k {\n${a}\n    }\n    return v\n  }\n  function go() { @n = pick(.Tri) }\n}\n<button onclick=go()>go</>`,
  "server call argument `String(match …)`": (a) => `\${\n  server function pick(k: Shape) {\n    return String(match k {\n${a}\n    })\n  }\n  function go() { @n = pick(.Tri) }\n}\n<button onclick=go()>go</>`,
  "server `return match`": (a) => `\${\n  server function pick(k: Shape) {\n    return match k {\n${a}\n    }\n  }\n  function go() { @n = pick(.Tri) }\n}\n<button onclick=go()>go</>`,
};
const ARMS = [`.Circle(r) :> "c" + r`, `.Square(s) :> "s" + s`, `.Rect(w: a, h: b) :> "r" + a + b`, `.Tri | .Dot :> "unit"`, `else :> "o"`];
const VALUES = [
  [{ variant: "Circle", data: { r: 5 } }, "c5"],
  [{ variant: "Square", data: { s: 2 } }, "s2"],
  [{ variant: "Rect", data: { w: 3, h: 4 } }, "r34"],
  ["Tri", "unit"],
  ["Dot", "unit"],
];

let slot = 0;
async function runRoute(src) {
  const dir = join(TMP, `p-${++slot}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "app.scrml"), src);
  const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], outputDir: join(dir, "out"), write: true, log: () => {} });
  const errs = (r.errors || []).filter((e) => !/^[WI]-/.test(e.code)).map((e) => e.code);
  if (errs.length) return { errs };
  const sp = resolve(dir, "out", "app.server.js");
  expect(existsSync(sp)).toBe(true);
  const mod = await import(pathToFileURL(sp).href + "?" + slot);
  const route = (mod.routes ?? []).find((x) => /pick/.test(x.path));
  const call = async (k) => {
    const res = await mod.fetch(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
      body: JSON.stringify({ k }),
    }));
    return JSON.parse(await res.text());
  };
  return { errs, call, js: readFileSync(sp, "utf8") };
}

describe("a text-lowered server match dispatches payload variants and binds their fields", () => {
  for (const [pn, page] of Object.entries(POS)) {
    for (const [sn, sep] of [["newline", ""], ["comma", ","]]) {
      test(`${pn} (${sn})`, async () => {
        const { errs, call } = await runRoute(PRE + page(ARMS.map((a) => "      " + a + sep).join("\n")));
        expect(errs).toEqual([]);
        for (const [v, want] of VALUES) expect({ v, got: await call(v) }).toEqual({ v, got: want });
      });
    }
  }
});

describe("unit-variant-only text-lowered matches keep the direct comparison", () => {
  test("`v = match k { .Tri :> …, else :> … }` emits no tag discriminator", async () => {
    const { errs, call, js } = await runRoute(PRE + POS["server reassignment `v = match`"]([`      .Tri :> "t"`, `      else :> "o"`].join("\n")));
    expect(errs).toEqual([]);
    expect(await call("Tri")).toBe("t");
    expect(await call({ variant: "Circle", data: { r: 1 } })).toBe("o");
    expect(js).not.toMatch(/_scrml_tag_\d+ = \(/);
  });
});
