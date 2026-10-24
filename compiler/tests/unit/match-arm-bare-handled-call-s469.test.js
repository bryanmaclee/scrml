/**
 * S469 r6 — g-impl1-stmt-match-arm-bare-handled-call-dropped-s469 (HIGH; fixed in
 * s469-impl1-arm-commas). A statement-match arm whose body is a BARE handled call —
 * `1 :> risky(2) !{ … }`, no braces — was wrapped whole in a guarded-expr that no match lowering
 * reads, so the arm was silently DROPPED (no `=== 1` branch). In a statement match it now compiles
 * byte-identically to the braced form `1 :> { risky(2) !{ … } }`; in a value match (no braced
 * equivalent — a block arm yields with `lift`) it is refused, E-PARSE-001.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "bare-handled-arm-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileAt(src, slot) {
  const dir = join(TMP, slot);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, src);
  const r = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const outs = {};
  let js = "";
  if (r.outputs instanceof Map) for (const [k, v] of r.outputs) { outs[k] = v; js += (v && v.clientJs) || ""; }
  return { codes: (r.errors || []).filter((e) => !/^[WI]-/.test(e.code)).map((e) => e.code), out: JSON.stringify(outs), js };
}

const PRE = `type E:enum = { Bad(m: string), Worse }
<k>: number | string = 1
<n> = 0
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
`;
const HANDLERS = {
  "legacy `|` handler arms": `risky(2) !{ | ::Bad e -> { @msg = "bad" } | _ e -> { @msg = "other" } }`,
  "pipe-less handler arms": `risky(2) !{ .Bad(m) :> { @msg = m } else :> { @msg = "other" } }`,
  "inline handler arm bodies, comma list": `risky(2) !{ .Bad(m) :> @msg = m, .Worse :> @msg = "w" }`,
};
const stmtPage = (arms) => `${PRE}  function go() {
    match @k {
${arms.map((a) => "      " + a).join("\n")}
    }
  }
}
<button onclick=go()>go</>
<p>\${@msg}</>`;

describe("statement match: a bare handled-call arm body compiles exactly like the braced form", () => {
  let slot = 0;
  for (const [hn, h] of Object.entries(HANDLERS)) {
    for (const [where, build] of [
      ["first arm", (b) => [`1 :> ${b}`, `2 :> { @n = 2 }`, `else :> @n = 0`]],
      ["middle arm", (b) => [`1 :> { @n = 1 }`, `2 :> ${b}`, `else :> @n = 0`]],
      ["last (wildcard) arm", (b) => [`1 :> { @n = 1 }`, `else :> ${b}`]],
    ]) {
      for (const [sn, sep] of [["newline", ""], ["comma", ","]]) {
        test(`${hn} — ${where} (${sn})`, () => {
          const id = `s-${++slot}`;
          const bare = compileAt(stmtPage(build(h).map((l) => l + sep)), id);
          const braced = compileAt(stmtPage(build(`{ ${h} }`).map((l) => l + sep)), id);
          expect(bare.codes).toEqual([]);
          expect(braced.codes).toEqual([]);
          expect(bare.out).toBe(braced.out);
          expect(bare.js).toContain("_scrml_risky_");
          if (where !== "last (wildcard) arm") expect(bare.js).toMatch(where === "first arm" ? /=== 1\b/ : /=== 2\b/);
        });
      }
    }
  }
});

describe("value match: a bare handled-call arm body is refused, never dropped", () => {
  const H = `risky(2) !{ .Bad(m) :> 7, else :> 8 }`;
  const CASES = {
    "const v = match": `${PRE}  function go() {\n    const v = match @k {\n      1 :> ${H}\n      2 :> 5\n      else :> 0\n    }\n    @n = v\n  }\n}\n<button onclick=go()>go</>\n<p>\${@n}</>`,
    "return match": `${PRE}  function pick(k: number | string) {\n    return match k {\n      1 :> ${H}\n      2 :> 5\n      else :> 0\n    }\n  }\n  function go() { @n = pick(@k) }\n}\n<button onclick=go()>go</>\n<p>\${@n}</>`,
    "@n = match": `${PRE}  function go() {\n    @n = match @k {\n      1 :> ${H}\n      2 :> 5\n      else :> 0\n    }\n  }\n}\n<button onclick=go()>go</>\n<p>\${@n}</>`,
  };
  let slot = 0;
  for (const [name, src] of Object.entries(CASES)) {
    test(name, () => {
      const r = compileAt(src, `v-${++slot}`);
      expect(r.codes.length).toBeGreaterThan(0);
    });
  }
});
