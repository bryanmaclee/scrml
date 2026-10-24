/**
 * engine-in-if-chain-refused-s469 — an `<engine>` under a branch of an `if=` / `else-if=` /
 * `else` chain is refused, never dropped.
 *
 * Gap: `g-engine-in-if-else-chain-branch-renders-nothing-s469` (HIGH). The chain renderer
 * (emit-html.ts, the `if-chain` case: one `<template>` per branch under a
 * `data-scrml-if-chain` host) has no engine lowering — `collectHoisted` (ast-builder) walks
 * only `markup.children`, so an engine under `branches[].element` / `elseBranch` never reaches
 * `machineDecls` and gets no substrate or dispatcher. The program compiled at exit 0 and the
 * branch mounted an empty element, in EVERY branch kind and at every depth.
 *
 * The language allows an engine there (a chain branch is a singleton position — §17.1.1 places
 * no limit on branch content; §51.0.D: declaration is mount). impl#1 cannot lower it, so it
 * refuses it as an unsupported emission (E-CG-003) and the message names the workaround.
 * In a component body the engine is refused by the language rule instead
 * (E-COMPONENT-ENGINE-SCOPE, §51.0.K) — the component expander's body walk now reaches an
 * engine-decl under a chain.
 *
 * Every position is either EXECUTED (renders) or refused; nothing compiles clean and renders
 * an empty branch. Out of scope here and tracked separately:
 *   - an engine inside a `<match>` arm (in or out of a chain) — g-engine-in-match-arm-emits-nothing-s469;
 *   - an engine that IS a chain member (`<engine else>`) — g-structural-element-if-chain-and-show-composition-nominal.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-engine-in-if-chain-s469");

function compile(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, "app.scrml");
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter(
    (e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""),
  );
  return { result, errors, outDir };
}

function compileAndMount(source) {
  const c = compile(source);
  if (c.errors.length > 0) return { errors: c.errors.map((e) => e.code) };
  const html = readFileSync(resolve(c.outDir, "app.html"), "utf8");
  const clientJs = readFileSync(resolve(c.outDir, "app.client.js"), "utf8");
  const runtimeJs = readFileSync(resolve(c.outDir, c.result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__ec_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors: [] };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__ec_set(name, v); await flush(); };
const count = (sel) => document.querySelectorAll(sel).length;

const T = `type Phase:enum = { Idle, Active }\n`;
const E = `<engine for=Phase initial=.Active><Idle rule=.Active><p class="idle">idle</p></><Active rule=.Idle><p class="act">act</p></></>`;
const M = `<match for=Phase on=@ph><Idle><p class="idle">i</p></><Active><p class="act">a</p></></>`;

function expectRefused(source, code = "E-CG-003") {
  const { errors } = compile(T + source);
  expect(errors.map((e) => e.code)).toEqual([code]);
  return errors[0];
}

describe("an <engine> under an if= / else-if= / else chain branch is refused (E-CG-003)", () => {
  test("THE REPRO (gap entry) — engine in the if= branch, located at the engine, naming the workaround", () => {
    const err = expectRefused(`<f> = true\n<div id="out"><div if=@f>${E}</div><div else>b</div></div>\n`);
    expect(err.message).toContain("`<engine for=Phase ...>` inside the `if=` branch of an `if=` / `else-if=` / `else` chain");
    expect(err.message).toContain("The language allows an engine here");
    expect(err.message).toContain("impl#1 refuses it rather than dropping it");
    expect(err.message).toContain("declare the engine outside the chain");
    expect(err.span.line).toBe(3);
    expect(err.span.col).toBe(26);
  });

  const POSITIONS = [
    ["the else branch", `<f> = false\n<div id="out"><div if=@f>a</div><div else>${E}</div></div>\n`, "else"],
    ["an else-if= branch", `<f> = false\n<g> = true\n<div id="out"><div if=@f>a</div><div else-if=@g>${E}</div><div else>c</div></div>\n`, "else-if="],
    ["an else-if= branch of a chain with no else", `<f> = false\n<g> = true\n<div id="out"><div if=@f>a</div><div else-if=@g>${E}</div></div>\n`, "else-if="],
    ["deep inside a branch", `<f> = true\n<div id="out"><div if=@f><section><span>${E}</span></section></div><div else>b</div></div>\n`, "if="],
    ["a chain at file top level", `<f> = true\n<div if=@f id="out">${E}</div><div else>b</div>\n`, "if="],
    ["a chain nested in markup", `<f> = true\n<div id="out"><ul><li><div if=@f>${E}</div><div else>b</div></li></ul></div>\n`, "if="],
    ["a chain inside <program>", `<program>\n<f> = true\n<div id="out"><div if=@f>${E}</div><div else>b</div></div>\n</program>\n`, "if="],
    ["a chain nested in a chain branch", `<f> = true\n<g> = true\n<div id="out"><div if=@f><div if=@g>${E}</div><div else>x</div></div><div else>b</div></div>\n`, "if="],
    ["a lone if= inside a chain branch", `<f> = true\n<g> = true\n<div id="out"><div if=@f><div if=@g>${E}</div></div><div else>b</div></div>\n`, "if="],
  ];
  for (const [where, src, form] of POSITIONS) {
    test(`refused in ${where}`, () => {
      const err = expectRefused(src);
      expect(err.message).toContain(`inside the \`${form}\` branch`);
    });
  }

  test("an engine nested inside a refused engine is reported once (the outermost)", () => {
    const inner = `<engine for=Sub initial=.X><X rule=.Y><i>x</i></><Y rule=.X><i>y</i></></>`;
    const src = `type Sub:enum = { X, Y }\n<f> = true\n<div id="out"><div if=@f><engine for=Phase initial=.Active><Idle rule=.Active><p>i</p></><Active rule=.Idle>${inner}</></></div><div else>b</div></div>\n`;
    const { errors } = compile(T + src);
    expect(errors.map((e) => e.code)).toEqual(["E-CG-003"]);
    expect(errors[0].message).toContain("`<engine for=Phase ...>`");
  });

  test("two engines in two branches are two errors", () => {
    const { errors } = compile(T + `<f> = true\n<div id="out"><div if=@f>${E}</div><div else>${E.replace("for=Phase", "for=Phase name=other")}</div></div>\n`);
    const codes = errors.map((e) => e.code).filter((c) => c === "E-CG-003");
    expect(codes.length).toBe(2);
  });
});

describe("other refusals keep their own code under a chain (one diagnostic per engine)", () => {
  test("an engine in an <each> row inside a chain branch — E-COMPONENT-ENGINE-SCOPE (the row rule)", () => {
    expectRefused(`<xs> = [1]\n<f> = true\n<div id="out"><div if=@f><each in=@xs as x><li>${E}</li></each></div><div else>z</div></div>\n`, "E-COMPONENT-ENGINE-SCOPE");
  });

  test("an engine in an <each> <empty> fallback inside a chain branch — E-CG-003 (the empty message)", () => {
    const err = expectRefused(`<xs> = []\n<f> = true\n<div id="out"><div if=@f><each in=@xs as x><i>x</i><empty>${E}</empty></each></div><div else>z</div></div>\n`);
    expect(err.message).toContain("`<empty>` fallback");
  });

  test("a chain inside an engine state-child — E-IF-IN-DISPATCHED-ARM (unchanged)", () => {
    const { errors } = compile(T + `type Q:enum = { A, B }\n<f> = true\n<div id="out"><engine for=Q initial=.A><A rule=.B><div if=@f>${E}</div><div else>b</div></><B rule=.A>x</></></div>\n`);
    expect(errors.map((e) => e.code)).toContain("E-IF-IN-DISPATCHED-ARM");
    expect(errors.map((e) => e.code)).not.toContain("E-CG-003");
  });

  for (const [label, use] of [["used", "<C/>"], ["unused", "z"]]) {
    test(`a chain in a component body (${label}) — E-COMPONENT-ENGINE-SCOPE, exactly once`, () => {
      const { errors } = compile(T + `<f> = true\nconst C = <div><div if=@f>${E}</div><div else>b</div></div>\n<div id="out">${use}</div>\n`);
      expect(errors.map((e) => e.code)).toEqual(["E-COMPONENT-ENGINE-SCOPE"]);
      expect(errors[0].message).toContain("appears inside the body of component `C`");
    });
  }

  test("an <each> row engine in an UNUSED component body is refused too (CE now reaches it)", () => {
    const { errors } = compile(T + `<xs> = [1]\nconst C = <div><each in=@xs as x><li>${E}</li></each></div>\n<div id="out">z</div>\n`);
    expect(errors.map((e) => e.code)).toEqual(["E-COMPONENT-ENGINE-SCOPE"]);
  });
});

describe("not refused — executed", () => {
  test("a lone if= (no chain) renders the engine and toggles it", async () => {
    const app = compileAndMount(T + `<on> = true\n<div id="out"><div if=@on>${E}</div></div>\n`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out p.act")).toBe(1);
    await set("on", false);
    expect(count("#out p.act")).toBe(0);
    await set("on", true);
    expect(count("#out p.act")).toBe(1);
  });

  test("the workaround — separate if= elements with exclusive conditions — renders the engine in either slot", async () => {
    const app = compileAndMount(T + `<f> = true\n<div id="out"><div if=@f>${E}</div><div if=(@f == false)><b>other</b></div></div>\n`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out p.act")).toBe(1);
    expect(count("#out b")).toBe(0);
    await set("f", false);
    expect(count("#out p.act")).toBe(0);
    expect(count("#out b")).toBe(1);
  });

  test("the workaround — the engine beside the chain, gated by its own if= — renders", async () => {
    const app = compileAndMount(T + `<f> = true\n<div id="out"><engine if=@f for=Phase initial=.Active><Idle rule=.Active><p class="idle">idle</p></><Active rule=.Idle><p class="act">act</p></></><div if=@f>a</div><div else>b</div></div>\n`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out p.act")).toBe(1);
  });

  for (const [where, src] of [
    ["the if= branch", `<f> = true\n<ph>: Phase = .Active\n<div id="out"><div if=@f>${M}</div><div else>b</div></div>\n`],
    ["the else branch", `<f> = false\n<ph>: Phase = .Active\n<div id="out"><div if=@f>a</div><div else>${M}</div></div>\n`],
    ["deep in an else-if= branch", `<f> = false\n<g> = true\n<ph>: Phase = .Active\n<div id="out"><div if=@f>a</div><div else-if=@g><span>${M}</span></div><div else>c</div></div>\n`],
  ]) {
    test(`a <match> in ${where} renders its arm`, async () => {
      const app = compileAndMount(T + src);
      expect(app.errors).toEqual([]);
      await flush();
      expect(count("#out p.act")).toBe(1);
    });
  }
});
