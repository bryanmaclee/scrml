/**
 * S446 (S439 #4 ruling: a `${s1; s2}` handler is legal and EVERY statement runs,
 * IN ORDER; §13.2 auto-await, normative) — MOUNTED (happy-dom) acceptance for the
 * stale read after a server-call cell write in a §5.2.3 statement-list handler.
 *
 * Pre-fix, `${@x = save(); @y = @x + 1}` emitted the write as a DETACHED
 * `(async () => _scrml_reactive_set("x", await save()))()` and ran the next
 * statement immediately: `@y` was computed from the PRE-fetch `@x`. The same
 * statements in a function body (and a bare `save(); h()` in a handler) were
 * already awaited in place. The fix routes the statement-list handler through the
 * SAME async-listener lowering — the write is awaited in place, the handler is
 * `async`.
 *
 * Every case is executed: compile, mount the shipped runtime + client chunk,
 * click, let the (delayed, stubbed) fetches settle, read the cells. Positions:
 * top level, `<each>`, `for … lift`, a match arm, `<each>` / `for … lift` inside
 * a match arm. A 1-statement `${@x = save()}` handler keeps its fire-and-forget
 * emit (a separate language question) — pinned below.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// The server call resolves on a LATER macrotask, so a statement that runs before
// the write lands observes the pre-fetch value (the defect this file pins).
let inflight = 0;
function stubFetch() {
  globalThis.fetch = async (path) => {
    inflight++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      const p = String(path);
      let v = 0;
      let status = 200;
      if (/save2/.test(p)) v = 20;
      else if (/okf/.test(p)) v = 10;
      else if (/boom/.test(p)) {
        v = { __scrml_error: true, type: "LoadError", variant: "QueryFailed", data: { reason: "x" } };
        status = 500;
      } else if (/save/.test(p)) v = 10;
      return new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    } finally {
      inflight--;
    }
  };
}

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
  inflight = 0;
  stubFetch();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s446-hsa-"));
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
        // Settle: every in-flight server call has resolved (bounded).
        for (let t = 0; t < 50; t++) {
          await new Promise((r) => setTimeout(r, 20));
          if (inflight === 0) break;
        }
        await new Promise((r) => setTimeout(r, 20));
      },
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const PRE = `  <x> = 0
  <x2> = 0
  <y> = 0
  <s> = ""
  <c> = true
  <rows> = [{ id: 1 }]
  type LoadError:enum = { QueryFailed(reason: string) }
  \${
    server function save() { return 10 }
    server function save2() { return 20 }
    server function boom() ! LoadError { return 1 }
    server function okf() ! LoadError { return 10 }
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
  const btn = `<button id="b" onclick=\${${handler}}>b</button>`;
  return `<program>\n${ARM_POSITIONS.has(pos) ? HEAD : ""}${PRE}  ${POSITIONS[pos](btn)}\n  <p id="o">\${@x}</p>\n</program>\n`;
};

const CASES = [
  ["cell write then read of that cell", "@x = save(); @y = @x + 1", { x: 10, y: 11 }],
  ["cell write then read (newline-separated)", "@x = save()\n   @y = @x + 1", { x: 10, y: 11 }],
  ["let from a server call then read", "let v = save(); @y = v + 1", { y: 11 }],
  ["two server-call writes in sequence", "@x = save(); @x2 = save2(); @y = @x + @x2", { x: 10, x2: 20, y: 30 }],
  ["server call inside a ternary RHS", "@x = @c ? save() : 0; @y = @x + 1", { x: 10, y: 11 }],
  ["server call as an operand of the RHS", "@x = save() + 1; @y = @x + 1", { x: 11, y: 12 }],
  ["write then a DOM read of the rendered cell", '@x = save(); @s = document.getElementById("o").textContent', { x: 10, s: "10" }],
  ["non-final write, then a statement, then a DOM read", '@x = save(); @c = false; @s = document.getElementById("o").textContent', { x: 10, s: "10" }],
  ["write inside an if, then read", "if (@c) { @x = save() }; @y = @x + 1", { x: 10, y: 11 }],
  ["`!{}` error arm (success path), then read", '@x = okf() !{ | e :> { @s = "err" } }; @y = @x + 1', { s: "", x: 10, y: 11 }],
  ["`!{}` error arm (failure path) runs before the next statement", '@x = boom() !{ | e :> { @s = "err" } }; @y = @s == "err" ? 1 : 2', { s: "err", y: 1 }],
  ["single statement (unchanged path) still writes", "@x = save()", { x: 10 }],
];

for (const pos of Object.keys(POSITIONS)) {
  describe(`S446 — a server-call write in a \`\${…}\` handler is awaited before the next statement — ${pos}`, () => {
    for (const [name, handler, want] of CASES) {
      test(name, async () => {
        const app = mount(program(pos, handler));
        expect(app.errs).toEqual([]);
        expect(app.initError).toBeNull();
        await app.click("b");
        const got = {};
        for (const k of Object.keys(want)) got[k] = app.get(k);
        expect(got).toEqual(want);
      });
    }
  });
}

describe("S446 — a 1-statement `${@x = save()}` handler keeps its emit (fire-and-forget)", () => {
  test("top level: no `async` listener, the detached IIFE write is unchanged", () => {
    const app = mount(program("top level", "@x = save()"));
    expect(app.errs).toEqual([]);
    const line = app.clientJs.split("\n").find((l) => /_scrml_attr_onclick/.test(l) && /save/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain(": function(event) { (async () => _scrml_cs_reactive_set(\"x\", await _scrml_fetch_save_");
    expect(line).toContain(".catch(_scrml_async_err => _scrml_error_boundary_log(\"x\", _scrml_async_err));");
  });
  test("statement list: `async` listener, the write awaited in place", () => {
    const app = mount(program("top level", "@x = save(); @y = @x + 1"));
    expect(app.errs).toEqual([]);
    const line = app.clientJs.split("\n").find((l) => /_scrml_attr_onclick/.test(l) && /save/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain(": async function(event) { _scrml_cs_reactive_set(\"x\", await _scrml_fetch_save_");
    expect(line).not.toContain("(async () =>");
  });
});
