/**
 * browser-handler-if-else-helpers-s462 — S462 s462-braceless-if-else-dropped, review
 * round 2 (S465). EXECUTES the emitted client JS (happy-dom, the pruned runtime the build
 * ships) for the two findings:
 *
 *  1. An if/else (or multi-statement) event handler that writes a nested path / an index
 *     (`@o.a.b = 5`, `@xs[0] = 9`, `@rows[0].v = 5` in an `<each>` row) lowers to
 *     `_scrml_deep_set(...)`; the runtime-chunk walk did not visit handler statement
 *     lists, so the `utilities` chunk that defines it was tree-shaken out and every
 *     click threw `ReferenceError`. Each case clicks BOTH arms and reads the DOM.
 *     (Static guard over every emitted helper call:
 *     `compiler/tests/unit/s462-handler-runtime-helpers-shipped.test.js`.)
 *  2. §14.10 + §66.3 rule 5(a): `<col> = Col.Red` gives the cell the type `Col`, so a
 *     bare-variant write `@col = .Blue` resolves — in a one-line if/else handler (newly
 *     rejected E-VARIANT-AMBIGUOUS by the s462 reroute) AND in a function body (rejected
 *     on base too).
 *
 * The same shapes were driven in Chromium during the fix (reported in progress.md).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-handler-if-else-helpers-s462");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (errors.length > 0) return { errors };
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;
  const exec = new Function("window", "document", `${runtimeJs}\n${clientJs}`);
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (sel) => document.querySelector(sel)?.textContent ?? "<missing>";

/** Click #b, read #o, toggle @c, click #b, read #o — collecting any thrown error. */
async function bothArms() {
  const seen = [];
  const onError = (e) => { seen.push(String(e?.error ?? e?.message ?? e)); };
  window.addEventListener("error", onError);
  const origConsoleError = console.error;
  console.error = (...a) => { seen.push(a.map(String).join(" ")); };
  const out = [];
  try {
    await flush();
    document.querySelector("#b").click(); await flush();
    out.push(text("#o"));
    document.querySelector("#tog").click(); await flush();
    document.querySelector("#b").click(); await flush();
    out.push(text("#o"));
  } finally {
    window.removeEventListener("error", onError);
    console.error = origConsoleError;
  }
  return { out, seen };
}

const TOG = `<button id="tog" onclick={ @c = !@c }>tog</button>\n`;
const O = `<c> = true\n<o> = { a: { b: 1 } }\n`;
const P = `<p id="o">\${@o.a.b}</p>\n`;

const DEEP = [
  ["one-line braced", O + `<button id="b" onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button>\n` + TOG + P, ["5", "9"]],
  ["braceless", O + `<button id="b" onclick={ if (@c) @o.a.b = 5 else @o.a.b = 9 }>b</button>\n` + TOG + P, ["5", "9"]],
  ["onclick=${…}", O + `<button id="b" onclick=\${ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button>\n` + TOG + P, ["5", "9"]],
  ["multi-line (base failed too)", O + `<button id="b" onclick={\n  if (@c) {\n    @o.a.b = 5\n  } else {\n    @o.a.b = 9\n  }\n}>b</button>\n` + TOG + P, ["5", "9"]],
  ["inside <program>", `<program>\n` + O + `<button id="b" onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button>\n` + TOG + P + `</program>\n`, ["5", "9"]],
  ["`;`-sequence (base failed too)", O + `<r> = "-"\n<button id="b" onclick={ @r = "s"; @o.a.b = 5 }>b</button>\n` + TOG + `<p id="o">\${@o.a.b}\${@r}</p>\n`, ["5s", "5s"]],
  ["@p2.x", `<c> = true\n<p2> = { x: 1 }\n<button id="b" onclick={ if (@c) { @p2.x = 5 } else { @p2.x = 9 } }>b</button>\n` + TOG + `<p id="o">\${@p2.x}</p>\n`, ["5", "9"]],
  ["@xs[0]", `<c> = true\n<xs> = [1, 2]\n<button id="b" onclick={ if (@c) { @xs[0] = 9 } else { @xs[0] = 4 } }>b</button>\n` + TOG + `<p id="o">\${@xs[0]}</p>\n`, ["9", "4"]],
  ["<each> row handler", `<c> = true\n<rows> = [{ id: 1, v: 0 }]\n<ul><each in=@rows key=@.id as r><li><button id="b" onclick={ if (@c) { @rows[0].v = 5 } else { @rows[0].v = 9 } }>\${r.v}</button></li></each></ul>\n` + TOG + `<p id="o">\${@rows[0].v}</p>\n`, ["5", "9"]],
];

describe("S462 r2 F1 — an if/else handler's runtime helpers ship (executed)", () => {
  for (const [label, src, want] of DEEP) {
    test(label, async () => {
      const { errors } = compileAndMount(src, "deep");
      expect(errors).toEqual([]);
      const { out, seen } = await bothArms();
      expect(seen).toEqual([]);
      expect(out).toEqual(want);
    });
  }
});

const EN = `type Col:enum = { Red, Blue }\n<c> = true\n<col> = Col.Red\n`;
const ENP = TOG + `<p id="o">\${@col}</p>\n`;

describe("S462 r2 F2 — §14.10: `<col> = Col.Red` types the cell, a bare `.V` write resolves (executed)", () => {
  const cases = [
    ["one-line if/else handler", EN + `<button id="b" onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n` + ENP],
    ["braceless if/else handler", EN + `<button id="b" onclick={ if (@c) @col = .Blue else @col = .Red }>b</button>\n` + ENP],
    ["multi-line handler", EN + `<button id="b" onclick={\n  if (@c) {\n    @col = .Blue\n  } else {\n    @col = .Red\n  }\n}>b</button>\n` + ENP],
    ["function body", EN + `\${ function go() { if (@c) { @col = .Blue } else { @col = .Red } } }\n<button id="b" onclick=go()>b</button>\n` + ENP],
  ];
  for (const [label, src] of cases) {
    test(label, async () => {
      const { errors } = compileAndMount(src, "en");
      expect(errors).toEqual([]);
      const { out, seen } = await bothArms();
      expect(seen).toEqual([]);
      expect(out).toEqual(["Blue", "Red"]);
    });
  }

  test("a payload construction `Sh.Circle(2)` types the cell too", async () => {
    const src = `type Sh:enum = { Dot, Circle(r: number) }\n<c> = true\n<sh> = Sh.Circle(2)\n` +
      `<button id="b" onclick={ if (@c) { @sh = .Dot } else { @sh = .Circle(3) } }>b</button>\n` + TOG +
      `<p id="o">\${@sh == Sh.Dot ? "dot" : "circ"}</p>\n`;
    const { errors } = compileAndMount(src, "sh");
    expect(errors).toEqual([]);
    const { out, seen } = await bothArms();
    expect(seen).toEqual([]);
    expect(out).toEqual(["dot", "circ"]);
  });

  test("a variant the enum does not declare is rejected (E-TYPE-063), never emitted as a string", () => {
    const src = EN + `<button id="b" onclick={ if (@c) { @col = .Green } else { @col = .Red } }>b</button>\n` + ENP;
    expect(compileAndMount(src, "wrong").errors).toContain("E-TYPE-063");
  });

  test("a cell with no enum type keeps E-VARIANT-AMBIGUOUS (§14.10: no type context)", () => {
    const src = `<c> = true\n<col> = "Red"\n<button id="b" onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n` + ENP;
    expect(compileAndMount(src, "str").errors).toContain("E-VARIANT-AMBIGUOUS");
  });
});
