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
 *  2. §14.10: a bare-variant write `@col = .Blue` resolves against a cell with a KNOWN
 *     type (`<col>: Col = .Red`) — in every if/else handler spelling AND a function body.
 *     (S466: an UNANNOTATED `<col> = Col.Red` has type `Col` — ruling user-voice-scrml.md
 *     S464 "(a) Infer from initializer" — so it resolves on every path too. This supersedes
 *     the S465 round-3 PA ruling that made it E-VARIANT-AMBIGUOUS.)
 *  3. (round 3) the same handlers inside `<match>` arms, and engine bodies re-parsed at
 *     emit time (message arm, opener `effect=`).
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

// Review round 3 (S465) F1 — the same handlers inside a `<match>` arm (arm bodies are raw
// text until emit-match re-parses them; the chunk walk now walks the lowered arm bodies),
// plus the engine bodies that are re-parsed at emit time (message arm, opener `effect=`).
const MC = `type Col:enum = { Red, Blue }\n<col>: Col = .Red\n` + O;
const MH = `onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }`;
const mArm = (red, open = `<match on=@col>`) => `${open}\n  <Red>${red}</>\n  <Blue><span>blue</span></>\n</match>\n`;
const mBtn = (h = MH) => `<button id="b" ${h}>b</button>`;
const MATCH = [
  ["<match> arm, one-line if/else (the reviewer repro)", MC + mArm(mBtn()) + TOG + P, ["5", "9"]],
  ["<match> arm, onclick=${…}", MC + mArm(mBtn(`onclick=\${ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }`)) + TOG + P, ["5", "9"]],
  ["<match for=Col on=@col>", MC + mArm(mBtn(), `<match for=Col on=@col>`) + TOG + P, ["5", "9"]],
  ["<match> arm, button in <div><section>", MC + mArm(`<div><section>${mBtn()}</section></div>`) + TOG + P, ["5", "9"]],
  ["<match> arm, braceless", MC + mArm(mBtn(`onclick={ if (@c) @o.a.b = 5 else @o.a.b = 9 }`)) + TOG + P, ["5", "9"]],
  ["<match> arm, multi-line (base failed too)", MC + mArm(mBtn(`onclick={\n    if (@c) {\n      @o.a.b = 5\n    } else {\n      @o.a.b = 9\n    }\n  }`)) + TOG + P, ["5", "9"]],
  ["<match> arm, `;`-sequence (base failed too)", MC + `<r> = "-"\n` + mArm(mBtn(`onclick={ @r = "s"; @o.a.b = 5 }`)) + TOG + `<p id="o">\${@o.a.b}\${@r}</p>\n`, ["5s", "5s"]],
  ["<match> arm, @xs[0] = 7", `type Col:enum = { Red, Blue }\n<col>: Col = .Red\n<c> = true\n<xs> = [1, 2]\n` + mArm(mBtn(`onclick={ if (@c) { @xs[0] = 7 } else { @xs[0] = 4 } }`)) + TOG + `<p id="o">\${@xs[0]}</p>\n`, ["7", "4"]],
  ["<match> `:` shorthand arm", MC + `<match on=@col>\n  <Red> : ${mBtn()}\n  <Blue> : <span>blue</span>\n</match>\n` + TOG + P, ["5", "9"]],
  ["<match> arm that also holds an <each>", MC + `<rows> = [1]\n` + mArm(`<ul><each in=@rows as r><li>\${r}</li></each></ul>${mBtn()}`) + TOG + P, ["5", "9"]],
  ["<match> in a component", MC + `const Panel = <div>\n${mArm(mBtn())}</div>\n<Panel/>\n` + TOG + P, ["5", "9"]],
  ["<match> in an <engine> state arm", `type Phase:enum = { Idle, Active }\n` + MC + `<program>\n<engine for=Phase initial=.Active>\n  <Idle rule=.Active><p>idle</p></>\n  <Active rule=.Idle>${mArm(mBtn())}</>\n</>\n` + TOG + P + `</program>\n`, ["5", "9"]],
  // (A `<match>` nested inside a `<match>` arm never renders its inner arm — on origin/main
  // too, Chromium-verified; filed g-match-nested-in-match-arm-inner-arm-never-renders-s465.
  // Its helper shipping is pinned in the unit guard.)
];

describe("S462 r3 F1 — `<match>` arm handlers ship their runtime helpers (executed)", () => {
  for (const [label, src, want] of MATCH) {
    test(label, async () => {
      const { errors } = compileAndMount(src, "m");
      expect(errors).toEqual([]);
      const { out, seen } = await bothArms();
      expect(seen).toEqual([]);
      expect(out).toEqual(want);
    });
  }

  const ENG = `<program>\n\${\n  type Ph:enum = { Idle, Busy }\n  type Msg:enum = { Go, Stop }\n}\n` + O;
  test("engine (state × message) arm body writing a nested path", async () => {
    const src = ENG + `<engine for=Ph initial=.Idle accepts=Msg>\n  <Idle rule=.Busy>\n    | .Go :> { @o.a.b = 5; .Busy }\n    | _ :> @ph\n    <p id="st">idle</p>\n  </>\n  <Busy rule=.Idle>\n    | .Stop :> .Idle\n    | _ :> @ph\n    <p id="st">busy</p>\n  </>\n</>\n<button id="b" onclick=@ph.advance(.Go)>b</button>\n` + P + `</program>\n`;
    const { errors } = compileAndMount(src, "msg");
    expect(errors).toEqual([]);
    const seen = [];
    const origConsoleError = console.error;
    console.error = (...a) => { seen.push(a.map(String).join(" ")); };
    try {
      await flush();
      expect(text("#o")).toBe("1");
      document.querySelector("#b").click(); await flush();
    } finally { console.error = origConsoleError; }
    expect(seen).toEqual([]);
    expect(text("#o")).toBe("5");
  });

  test("engine opener effect= writing a nested path runs at boot", async () => {
    const seen = [];
    const origConsoleError = console.error;
    console.error = (...a) => { seen.push(a.map(String).join(" ")); };
    let errors;
    try {
      ({ errors } = compileAndMount(ENG + `<engine for=Ph initial=.Idle effect=\${\n    @o.a.b = 5\n}>\n  <Idle rule=.Busy><p>idle</p></>\n  <Busy rule=.Idle><p>busy</p></>\n</>\n` + P + `</program>\n`, "eff"));
      await flush();
    } finally { console.error = origConsoleError; }
    expect(errors).toEqual([]);
    expect(seen).toEqual([]);
    expect(text("#o")).toBe("5");
  });
});

const EN = `type Col:enum = { Red, Blue }\n<c> = true\n<col>: Col = .Red\n`;
const ENP = TOG + `<p id="o">\${@col}</p>\n`;

describe("S462 r2/r3 F2 — §14.10: `<col>: Col` types the cell, a bare `.V` write resolves (executed)", () => {
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

  test("an annotated payload-enum cell `<sh>: Sh = Sh.Circle(2)` resolves `.Dot` / `.Circle(3)`", async () => {
    const src = `type Sh:enum = { Dot, Circle(r: number) }\n<c> = true\n<sh>: Sh = Sh.Circle(2)\n` +
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

  // S466 — ruling user-voice-scrml.md S464 "(a) Infer from initializer" (§14.10, §66.3
  // rule 5): an UNANNOTATED `<col> = Col.Red` HAS type `Col`, so the bare writes resolve
  // in a handler and a function body alike. (Supersedes the S465 round-3 pin that made
  // it E-VARIANT-AMBIGUOUS on every path.)
  test("an UNANNOTATED `<col> = Col.Red` is typed `Col`: bare writes resolve in a handler and a function body (§14.10; S464 ruling)", async () => {
    const U = `type Col:enum = { Red, Blue }\n<c> = true\n<col> = Col.Red\n`;
    const r1 = compileAndMount(U + `<button id="b" onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n` + ENP, "un1");
    expect(r1.errors).toEqual([]);
    const { out, seen } = await bothArms();
    expect(seen).toEqual([]);
    expect(out).toEqual(["Blue", "Red"]);
    expect(compileAndMount(U + `\${ function go() { @col = .Blue } }\n<button id="b" onclick=go()>b</button>\n` + ENP, "un2").errors)
      .toEqual([]);
  });

  test("a cell with no enum type keeps E-VARIANT-AMBIGUOUS (§14.10: no type context)", () => {
    const src = `<c> = true\n<col> = "Red"\n<button id="b" onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n` + ENP;
    expect(compileAndMount(src, "str").errors).toContain("E-VARIANT-AMBIGUOUS");
  });
});

// Review round 4 (S465) — markup LIFTED inside a component body / `<match>` arm. The pre-emit
// chunk walk never visited the lifted markup's handler blocks; the chunk set is now completed
// from the emitted text against the runtime-derived helper index (runtime-chunks.ts
// chunksForEmittedHelpers). Every lift position × every helper family, both arms executed.
const LO = `<c> = true\n<o> = { a: { b: 1 } }\n<xs> = [1, 2]\n<n> = 1\n`;
const LP = `<p id="o">\${@o.a.b}|\${@xs[0]}|\${@n}</p>\n`;
const LH = [
  ["if/else", `{ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }`, ["5|1|1", "9|1|1"]],
  ["braceless", `{ if (@c) @o.a.b = 5 else @o.a.b = 9 }`, ["5|1|1", "9|1|1"]],
  ["multi-line", `{\n  if (@c) {\n    @o.a.b = 5\n  } else {\n    @o.a.b = 9\n  }\n}`, ["5|1|1", "9|1|1"]],
  ["`;`-sequence", `{ @n = 2; @o.a.b = 7 }`, ["7|1|2", "7|1|2"]],
  ["index set", `{ if (@c) { @xs[0] = 5 } else { @xs[0] = 9 } }`, ["1|5|1", "1|9|1"]],
  ["compound", `{ if (@c) { @o.a.b += 2 } else { @o.a.b -= 1 } }`, ["3|1|1", "2|1|1"]],
  ["delete", `{ if (@c) { delete @o.a.b } else { @o.a.b = 3 } }`, ["|1|1", "3|1|1"]],
];
const lBtn = (h, dollar = false) => `<button id="b" onclick=${dollar ? "$" : ""}${h}>b</button>`;
const lArm = (inner) => `type Col:enum = { Red, Blue }\n<col>: Col = .Red\n<match on=@col>\n  <Red><div>${inner}</div></>\n  <Blue><span>blue</span></>\n</match>\n`;
const LS = [
  ["component, `${ if … { lift … } }`", (h) => `const Panel = <div>\${ if (@n > 0) { lift ${lBtn(h)} } }</div>\n<Panel/>\n`],
  ["component, `${ if … { lift … } }`, onclick=${…}", (h) => `const Panel = <div>\${ if (@n > 0) { lift ${lBtn(h, true)} } }</div>\n<Panel/>\n`],
  ["component, `${ lift … }`", (h) => `const Panel = <div>\${ lift ${lBtn(h)} }</div>\n<Panel/>\n`],
  ["component, `${ for … { lift … } }`", (h) => `const Panel = <div>\${ for (const x of [1]) { lift ${lBtn(h)} } }</div>\n<Panel/>\n`],
  ["<match> arm, `${ lift … }`", (h) => lArm(`\${ lift ${lBtn(h)} }`)],
  ["<match> arm, `${ if … { lift … } }`", (h) => lArm(`\${ if (@n > 0) { lift ${lBtn(h)} } }`)],
];

describe("S462 r4 — lifted-markup handlers in a component / `<match>` arm ship their helpers (executed)", () => {
  for (const [sl, sf] of LS) {
    for (const [hl, h, want] of LH) {
      // Braceless `onclick=${ if (c) a else b }` in a component's lift is E-COMPONENT-021 on
      // cf4b0a6e too (CE re-parse; filed g-component-lift-dollar-braceless-else-ce-reparse-rejects-s465).
      if (sl.includes("onclick=${") && hl === "braceless") continue;
      test(`${sl} × ${hl}`, async () => {
        const { errors } = compileAndMount(LO + sf(h) + TOG + LP, "lift");
        expect(errors).toEqual([]);
        const { out, seen } = await bothArms();
        expect(seen).toEqual([]);
        expect(out).toEqual(want);
      });
    }
  }
});
