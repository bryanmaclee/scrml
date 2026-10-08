/**
 * S446 (S439 #4 ruling: a `${s1; s2}` event handler is legal and EVERY statement
 * runs) — MOUNTED (happy-dom) acceptance for the three residual silent drops left
 * after #1106 moved top-level / `<each>` handlers onto the parsed statement list
 * (`handlerBlock.stmts` → emitHandlerStatementList):
 *
 *   1. `for … lift` row handlers kept only the one-expression view — every
 *      statement after the first was dropped (lifted markup is parsed by
 *      parseLiftTag, which never attached `handlerBlock`).
 *   2. A match-arm handler (outside `<each>`) whose arm-binding read sits in a
 *      LATER statement (`f(); @s = note; h()`) stayed a module-scope registry
 *      entry — the arm-name scan read only the first statement's exprNode —
 *      and threw `ReferenceError: note is not defined` at click.
 *   3. `@a++⏎ f()` collected as ONE statement (`@a ++ f ( )`) whose expression
 *      view stopped at `@a++`: `f()` dropped in every handler position AND in
 *      every function body (the same statement collector).
 *
 * Every case is executed: compile, mount the shipped runtime + client chunk,
 * click, read the cells. Positions: top level, `<each>`, `for … lift`, a match
 * arm, an `<each>` inside a match arm, a `for … lift` inside a match arm.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
  // A server call resolves 200 / JSON `1` (no server in happy-dom).
  globalThis.fetch = async () => new Response(JSON.stringify(1), { status: 200, headers: { "content-type": "application/json" } });
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s446-hsl-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    const consoleErrors = [];
    const origErr = console.error;
    console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
    let initError = null;
    try {
      new Function("window", "document",
        `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` +
        captureInsideChunkScope(rd("app.client.js"), "globalThis.__get = _scrml_reactive_get;\n"),
      )(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      initError = e;
    } finally {
      console.error = origErr;
    }
    return {
      errs,
      initError,
      consoleErrors,
      clientJs: rd("app.client.js"),
      get: (n) => globalThis.__get(n),
      click: async (id) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`no element #${id}`);
        const origE = console.error;
        console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
        try { el.dispatchEvent(new window.Event("click", { bubbles: true })); }
        finally { console.error = origE; }
        await new Promise((r) => setTimeout(r, 20));
      },
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const PRE = `  <a> = 0
  <b> = 0
  <s> = ""
  <rows> = [{ id: 1 }]
  \${
    function f() { @a = @a + 1 }
    function h() { @b = @b + 1 }
    server function save() { return 1 }
  }
`;
const HEAD = `  type Doc:enum = { Empty, Note(note: string) }\n  <cur> = Doc.Note("hi")\n`;
const each = (btn) => `<ul><each in=@rows key=@.id as r><li>${btn}</li></each></ul>`;
const lift = (btn) => `<ul>\${ for (r of @rows) { lift <li>${btn}</li>; } }</ul>`;
const arm = (inner) => `<div><match for=Doc on=@cur><Empty><p>none</p></><Note(note)>${inner}</></match></div>`;
const POSITIONS = {
  "top level": (b) => b,
  "<each>": each,
  "for … lift": lift,
  "match arm": (b) => arm(b),
  "<each> in a match arm": (b) => arm(each(b)),
  "for … lift in a match arm": (b) => arm(lift(b)),
};
const ARM_POSITIONS = new Set(["match arm", "<each> in a match arm", "for … lift in a match arm"]);

const program = (pos, handler) => {
  const btn = `<button id="x" onclick=\${${handler}}>x</button>`;
  return `<program>\n${ARM_POSITIONS.has(pos) ? HEAD : ""}${PRE}  ${POSITIONS[pos](btn)}\n</program>\n`;
};

const CASES = [
  ["single statement (unchanged path)", "f()", { a: 1 }],
  ["call; assign with `;` in a string; call", 'f(); @s = "a;b"; h()', { a: 1, b: 1, s: "a;b" }],
  ["same cell written three times", "@a = @a + 1; @a = @a + 1; @a = @a + 1", { a: 3 }],
  ["read-after-write", "@a = 5; @b = @a * 2", { a: 5, b: 10 }],
  ["postfix ++ then newline call", "@a++\n   f()", { a: 2 }],
  ["postfix -- then newline call", "@a--\n   h()", { a: -1, b: 1 }],
  ["call, postfix ++, call on three lines", "f()\n   @a++\n   h()", { a: 2, b: 1 }],
  ["postfix ++ twice with `;`", "@a++; @a++", { a: 2 }],
  ["server call in the middle is awaited, then the rest runs", "f(); save(); h()", { a: 1, b: 1 }],
];
const ARM_CASES = [
  ["arm binding read in a later statement", "f(); @s = note; h()", { a: 1, b: 1, s: "hi" }],
  ["arm binding read in a later statement (newline-separated)", "f()\n   @s = note\n   h()", { a: 1, b: 1, s: "hi" }],
  ["arm binding read in the last statement", 'f(); h(); @s = note + "!"', { a: 1, b: 1, s: "hi!" }],
  ["arm binding read only in a later if condition", 'f(); if (note == "hi") { @s = "yes" }', { a: 1, s: "yes" }],
  ["arm binding read in a single statement (unchanged path)", "@s = note", { s: "hi" }],
];

for (const pos of Object.keys(POSITIONS)) {
  describe(`S446 — every statement of a \`\${…}\` handler runs — ${pos}`, () => {
    const cases = ARM_POSITIONS.has(pos) ? [...CASES, ...ARM_CASES] : CASES;
    for (const [name, handler, want] of cases) {
      test(name, async () => {
        const app = mount(program(pos, handler));
        expect(app.errs).toEqual([]);
        expect(app.initError).toBeNull();
        await app.click("x");
        expect(app.consoleErrors).toEqual([]);
        for (const [k, v] of Object.entries(want)) expect(app.get(k)).toEqual(v);
      });
    }
  });
}

describe("S446 — a function body keeps the statement after a postfix update", () => {
  test("`@a++⏎ h()` / `@a--⏎ h()` in a function body run both statements", async () => {
    const app = mount(`<program>
  <a> = 0
  <b> = 0
  \${
    function h() { @b = @b + 1 }
    function go() {
      @a++
      h()
    }
    function go2() {
      @a--
      h()
    }
  }
  <button id="x" onclick=go()>x</button>
  <button id="y" onclick=go2()>y</button>
</program>
`);
    expect(app.errs).toEqual([]);
    await app.click("x");
    expect([app.get("a"), app.get("b")]).toEqual([1, 1]);
    await app.click("y");
    expect([app.get("a"), app.get("b")]).toEqual([0, 2]);
  });
});
