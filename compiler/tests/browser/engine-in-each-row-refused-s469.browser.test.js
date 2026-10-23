/**
 * engine-in-each-row-refused-s469 — an `<engine>` declared inside an `<each>` row is a
 * compile error (E-COMPONENT-ENGINE-SCOPE), never a silent drop.
 *
 * Gap: `g-engine-inside-each-row-renders-nothing` (HIGH). The row renderer
 * (emit-each.ts `renderTemplateChildToJs`) had no `engine-decl` case: the engine fell
 * through to a `// each: unhandled template child` comment, so the program compiled at
 * exit 0 and every row rendered WITHOUT its engine — no state body, no transition table,
 * no diagnostic. With an `if=` on the engine it rendered nothing for the right password
 * AND the wrong one (fail-closed, but the author gets no signal).
 *
 * The SPEC already rules the language (§51.0.K, S439 ruling #10 — "Rec: refuse it"): a row
 * is a multi-instance context, an engine is a singleton, so an engine in a row SHALL be
 * refused with E-COMPONENT-ENGINE-SCOPE and the message SHALL name the per-row form (an
 * ordinary declaration, keyed per row, §66.7.3). The SPEC text said "Nominal for this case
 * on impl#1"; this file pins that impl#1 now emits it, in every row position:
 *
 *   - SYM PASS 13.B (`walkRejectEnginesInEachRows`) — every row the TAB parsed, by total
 *     descent (row root, nested element, `if=` element, multi-root, nested `<each>`, a
 *     `<match>` arm in a row, an engine nested in a refused engine, `:`-shorthand bodies);
 *   - codegen backstops for the rows only codegen parses — an `<each>` inside a `<match>`
 *     arm (emit-each `renderTemplateChildToJs`), and an engine in a `<match>` arm whose
 *     match sits in a row (emit-match `refuseEnginesInRowScopedArms`).
 *
 * An engine in the `<empty>` fallback of a list that is NOT in a row is not a row position
 * (the fallback renders once) — the row rule does not reach it — but impl#1 cannot lower an
 * engine there either, so it is refused as an unsupported emission (E-CG-003) instead of
 * being dropped. Whether it should render is an owner question.
 *
 * The EXECUTED half: the supported spelling (one engine declared outside the `<each>`, read
 * and advanced from the rows) renders, dispatches its arms, enforces `rule=` through the
 * write-guard, follows keyed reorder / same-key replace / row removal, and a removed row's
 * handlers and effects are disposed by the S469 owner-scope tree (no second mechanism).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-engine-in-row-s469");

function compile(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter(
    (e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""),
  );
  return { result, errors, outDir, baseName };
}

// Counts live effects (+1 on create, -1 on first dispose), as the S469 dispose test does.
const INSTRUMENT = `
  globalThis.__fx = { live: 0 };
  const __wrap = (orig) => function (fn, gate) {
    const d = orig(fn, gate);
    globalThis.__fx.live++;
    let gone = false;
    return function () { if (!gone) { gone = true; globalThis.__fx.live--; } return d(); };
  };
  if (typeof _scrml_effect === "function") _scrml_effect = __wrap(_scrml_effect);
  if (typeof _scrml_effect_static === "function") _scrml_effect_static = __wrap(_scrml_effect_static);
`;

function compileAndMount(source) {
  const c = compile(source);
  if (c.errors.length > 0) return { errors: c.errors.map((e) => e.code) };
  const html = readFileSync(resolve(c.outDir, `${c.baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(c.outDir, `${c.baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(c.outDir, c.result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n${INSTRUMENT}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__er_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;
globalThis.__er_get = typeof _scrml_cs_reactive_get === "function" ? _scrml_cs_reactive_get : _scrml_reactive_get;
globalThis.__er_subs = (n) => {
  const k = typeof _scrml_cs_key === "function" ? _scrml_cs_key(n) : n;
  const m = _scrml_prop_subscribers.get(_scrml_state);
  const s = m && m.get(k);
  return s ? s.size : 0;
};\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors: [] };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__er_set(name, v); await flush(); };
const subs = (name) => globalThis.__er_subs(name);
const live = () => globalThis.__fx.live;
const texts = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent);
const variantOf = (v) => (v && typeof v === "object" ? v.variant ?? v.tag ?? v._tag : v);

const T = `type Phase:enum = { Idle, Active }\n`;
const ENGINE = `<engine for=Phase initial=.Active><Idle rule=.Active><p class="idle">idle</p></><Active rule=.Idle><p class="act">act</p></></>`;

function expectRefused(source, code = "E-COMPONENT-ENGINE-SCOPE") {
  const { errors } = compile(source);
  const hits = errors.filter((e) => e.code === code);
  expect(errors.map((e) => e.code)).toEqual([code]);
  expect(hits).toHaveLength(1);
  return hits[0];
}

describe("an <engine> in an <each> row is refused (§51.0.K, S439 #10)", () => {
  test("THE REPRO (gap entry) — refused with E-COMPONENT-ENGINE-SCOPE, located at the engine, naming the per-row form", () => {
    const src = T + `<groups> = [{ id: 1, name: "one" }, { id: 2, name: "two" }]
<ul>
<each in=@groups key=@.id as g>
  <li>row:\${g.name}
    <engine for=Phase initial=.Active>
      <Idle rule=.Active><p class="idle">idle</p></>
      <Active rule=.Idle><p class="act">act</p></>
    </>
  </li>
</each>
</ul>
`;
    const err = expectRefused(src);
    expect(err.message).toContain("`<engine for=Phase ...>` is declared inside an `<each>` row");
    expect(err.message).toContain("ordinary declaration");
    expect(err.message).toContain("§66.7.3");
    expect(err.span.line).toBe(6);
  });

  test("THE S469 if= REPRO — the gated engine is refused (it was dropped for the right password AND the wrong one)", () => {
    expectRefused(`type Phase:enum = { Idle, Active }
<pw> = "secret"
<xs> = [1]
<div id="out"><each in=@xs as y><engine for=Phase initial=.Idle if=(@pw == "secret")><Idle rule=.Active>"LOGGED IN"</><Active rule=.Idle>"LOGGED IN"</></></each></div>
`);
  });

  const positions = {
    "the row root": `<each in=@groups key=@.id as g>${ENGINE}</each>`,
    "a multi-root row (between two roots)": `<each in=@groups key=@.id as g><b>\${g.id}</b>${ENGINE}<i>tail</i></each>`,
    "a nested element": `<each in=@groups key=@.id as g><li><span>\${g.id}${ENGINE}</span></li></each>`,
    "an if= element in the row": `<each in=@groups key=@.id as g><div if=@on>${ENGINE}</div></each>`,
    "an engine carrying its own if=": `<each in=@groups key=@.id as g><engine for=Phase initial=.Idle if=@on><Idle rule=.Active>"i"</><Active rule=.Idle>"a"</></></each>`,
    "a row of a nested <each>": `<each in=@groups key=@.id as g><section><each in=g.xs as x><span>\${x}${ENGINE}</span></each></section></each>`,
    "the <empty> fallback of a list inside a row": `<each in=@groups key=@.id as g><ol><each in=g.xs as x><b>\${x}</b><empty>${ENGINE}</empty></each></ol></each>`,
    "`:`-shorthand state-children": `<each in=@groups key=@.id as g><li><engine for=Phase initial=.Active><Idle rule=.Active : "idle"><Active rule=.Idle : "act"></></li></each>`,
    "a <match> arm in the row": `<each in=@groups key=@.id as g><li><match for=Mode on=@mode><A>${ENGINE}</><B><p>b</p></></></li></each>`,
    "a <match> arm in the row that also holds an <each> (codegen-only arm parse)": `<each in=@groups key=@.id as g><li><match for=Mode on=@mode><A>${ENGINE}<each in=g.xs as x><s>\${x}</s></each></><B><p>b</p></></></li></each>`,
    "a row of an <each> inside a <match> arm (codegen-only arm parse)": `<match for=Mode on=@mode><A><each in=@groups key=@.id as g><li>\${g.id}${ENGINE}</li></each></><B><p>b</p></></>`,
    "a row of an <each> in a <match> arm in a row": `<each in=@groups key=@.id as g><li><match for=Mode on=@mode><A><each in=g.xs as x><s>\${x}${ENGINE}</s></each></><B><p>b</p></></></li></each>`,
    "a row of an <each> inside a top-level engine's state-child": `<engine for=Mode var=outer initial=.A><A rule=.B><each in=@groups key=@.id as g><i>\${g.id}${ENGINE}</i></each></><B rule=.A><p>b</p></></>`,
  };
  for (const [where, markup] of Object.entries(positions)) {
    test(`refused in ${where}`, () => {
      expectRefused(T + `type Mode:enum = { A, B }
<mode>: Mode = .A
<on> = true
<groups> = [{ id: 1, xs: [1, 2] }]
<div id="out">${markup}</div>
`);
    });
  }

  test("an engine nested inside a refused row engine is reported once (the outermost)", () => {
    const err = expectRefused(T + `type Outer:enum = { On, Off }
<groups> = [{ id: 1 }]
<div id="out"><each in=@groups key=@.id as g><engine for=Outer initial=.On><On rule=.Off>${ENGINE}</><Off rule=.On><p>off</p></></></each></div>
`);
    expect(err.message).toContain("`<engine for=Outer ...>`");
  });

  test("a component body's <each> row is refused too (CE does not see an engine nested in its list)", () => {
    expectRefused(T + `const Card = <div class="card"><each in=@groups key=@.id as g><li>\${g.id}${ENGINE}</li></each></div>
<groups> = [{ id: 1 }]
<div id="out"><Card/></div>
`);
  });

  test("two row engines are two errors", () => {
    const { errors } = compile(T + `<groups> = [{ id: 1 }]
<div id="out"><each in=@groups key=@.id as g>${ENGINE}</each><each in=@groups key=@.id as h><b>\${h.id}</b>${ENGINE}</each></div>
`);
    expect(errors.map((e) => e.code)).toEqual(["E-COMPONENT-ENGINE-SCOPE", "E-COMPONENT-ENGINE-SCOPE"]);
  });
});

describe("an <engine> in a top-level <empty> fallback is refused as an unsupported emission (E-CG-003)", () => {
  test("a top-level list's <empty>", () => {
    const err = expectRefused(T + `<groups> = []
<ul id="out"><each in=@groups key=@.id as g><li>\${g.id}</li><empty>${ENGINE}</empty></each></ul>
`, "E-CG-003");
    expect(err.message).toContain("`<empty>` fallback");
  });

  test("the <empty> of a list inside a <match> arm", () => {
    expectRefused(T + `type Mode:enum = { A, B }
<mode>: Mode = .A
<groups> = []
<div id="out"><match for=Mode on=@mode><A><each in=@groups key=@.id as g><li>\${g.id}</li><empty>${ENGINE}</empty></each></><B><p>b</p></></></div>
`, "E-CG-003");
  });
});

describe("not refused — an engine that is not in a row", () => {
  test("a top-level engine renders its initial arm", async () => {
    const app = compileAndMount(T + `<div id="out">${ENGINE}</div>\n`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(texts("#out p")).toEqual(["act"]);
  });

  test("an <each> inside an engine's state-child renders its rows", async () => {
    const app = compileAndMount(T + `<groups> = [{ id: 1 }, { id: 2 }]
<div id="out"><engine for=Phase initial=.Active><Idle rule=.Active><p>idle</p></><Active rule=.Idle><each in=@groups key=@.id as g><i>\${g.id}</i></each></></></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(texts("#out i")).toEqual(["1", "2"]);
  });

  test("a top-level engine declared AFTER the <each> whose rows read and advance it (no false refusal)", async () => {
    const app = compileAndMount(`<program>
type Phase:enum = { Idle, Active }
<rows> = [{ id: 1, t: "a" }]
<ul id="out"><each in=@rows key=@.id as r><li class="row" onclick=@phase.advance(.Active)>\${r.t}:\${@phase == .Active ? "on" : "off"}<match for=Phase on=@phase><Idle>"i"</><Active>"a"</></></li></each></ul>
<engine for=Phase initial=.Idle>
  <Idle rule=.Active><p class="idle">idle</p></>
  <Active rule=.Idle><p class="act">act</p></>
</>
</program>`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(document.querySelectorAll("p.idle").length).toBe(1);
    document.querySelector("#out li.row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelectorAll("p.act").length).toBe(1);
    expect(document.querySelector("#out li.row").textContent).toContain("a:on");
  });

  test("an engine in an if= element outside any row", async () => {
    const app = compileAndMount(T + `<on> = true\n<div id="out"><div if=@on>${ENGINE}</div></div>\n`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(document.querySelectorAll("#out p.act").length).toBeGreaterThan(0);
  });
});

describe("the supported spelling — one engine outside the <each>, read and advanced from the rows", () => {
  const SRC = `<program>
type Phase:enum = { Idle, Active }
<rows> = [{ id: 1, t: "a" }, { id: 2, t: "b" }]
<engine for=Phase initial=.Idle>
  <Idle rule=.Active><p class="idle">idle</p></>
  <Active rule=.Idle><p class="act">act</p></>
</>
<ul id="out">
  <each in=@rows key=@.id as r>
    <li class="row" onclick=@phase.advance(.Active)>\${r.t}:\${@phase == .Active ? "on" : "off"}</li>
  </each>
</ul>
</program>`;

  test("rows render, a row click transitions the shared engine, its arm dispatches and every row re-reads it", async () => {
    const app = compileAndMount(SRC);
    expect(app.errors).toEqual([]);
    await flush();
    expect(texts("#out li.row")).toEqual(["a:off", "b:off"]);
    expect(document.querySelectorAll("p.idle").length).toBe(1);
    document.querySelectorAll("#out li.row")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    expect(variantOf(globalThis.__er_get("phase"))).toBe("Active");
    expect(document.querySelectorAll("p.act").length).toBe(1);
    expect(document.querySelectorAll("p.idle").length).toBe(0);
    expect(texts("#out li.row")).toEqual(["a:on", "b:on"]);
  });

  test("keyed reorder and same-key replace keep the rows reading the shared engine", async () => {
    const app = compileAndMount(SRC);
    expect(app.errors).toEqual([]);
    await flush();
    await set("rows", [{ id: 2, t: "b" }, { id: 1, t: "a" }]);
    expect(texts("#out li.row")).toEqual(["b:off", "a:off"]);
    await set("rows", [{ id: 2, t: "B" }, { id: 1, t: "a" }]);
    expect(texts("#out li.row")).toEqual(["B:off", "a:off"]);
    document.querySelector("#out li.row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    expect(texts("#out li.row")).toEqual(["B:on", "a:on"]);
  });

  test("a removed row stops reading the engine — its effect is disposed by the owner tree", async () => {
    const app = compileAndMount(SRC);
    expect(app.errors).toEqual([]);
    await flush();
    const baseSubs = subs("phase");
    const baseLive = live();
    const dead = document.querySelectorAll("#out li.row")[1];
    await set("rows", [{ id: 1, t: "a" }]);
    expect(subs("phase")).toBe(baseSubs - 1);
    const oneRowLive = live();
    expect(oneRowLive).toBeLessThan(baseLive);
    dead.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    document.querySelector("#out li.row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    expect(dead.textContent).toBe("b:off");
    expect(texts("#out li.row")).toEqual(["a:on"]);
    for (let i = 0; i < 4; i++) {
      await set("rows", [{ id: 1, t: "a" }, { id: 2, t: "b" }]);
      await set("rows", [{ id: 1, t: "a" }]);
    }
    expect(subs("phase")).toBe(baseSubs - 1);
    expect(live()).toBe(oneRowLive);
  });

  test("rule= is enforced on a row's write exactly as at top level (an illegal write is refused)", async () => {
    const app = compileAndMount(`<program>
type Phase:enum = { Idle, Active, Done }
<rows> = [{ id: 1 }]
<engine for=Phase initial=.Idle>
  <Idle rule=.Active><p class="idle">idle</p></>
  <Active rule=.Done><p class="act">act</p></>
  <Done rule=.Idle><p class="done">done</p></>
</>
<ul id="out"><each in=@rows key=@.id as r><li class="row" onclick=\${@phase = .Done}>\${r.id}</li></each></ul>
</program>`);
    expect(app.errors).toEqual([]);
    await flush();
    // The write-guard throws E-ENGINE-INVALID-TRANSITION from the handler; happy-dom reports a
    // listener's throw through console.error (window + global) rather than to the dispatcher.
    const seen = [];
    const origErr = console.error;
    const origWinErr = window.console?.error;
    const capture = (...a) => { seen.push(a.map(String).join(" ")); };
    console.error = capture;
    if (window.console) window.console.error = capture;
    try {
      document.querySelector("#out li.row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    } catch (e) {
      seen.push(String(e));
    } finally {
      console.error = origErr;
      if (window.console) window.console.error = origWinErr;
    }
    expect(seen.some((m) => m.includes("E-ENGINE-INVALID-TRANSITION"))).toBe(true);
    // Idle -> Done is not in Idle's rule=: the write-guard refuses it, the engine stays Idle.
    expect(variantOf(globalThis.__er_get("phase"))).toBe("Idle");
    expect(document.querySelectorAll("p.idle").length).toBe(1);
    expect(document.querySelectorAll("p.done").length).toBe(0);
  });
});
