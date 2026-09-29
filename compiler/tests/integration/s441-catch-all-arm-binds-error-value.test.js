/**
 * s441-failable-arm-binding — DEFECT 1 (ruled S441): an identifier-binding
 * catch-all `!{}` arm `| err :> …` binds the ERROR VALUE, normalized to the
 * enum-value representation — a unit variant is the variant value itself (what
 * `E.Unit` evaluates to), a payload variant is the constructed shape
 * `{ variant, data: { field… } }` — so `err == E.Unit` and `match err` behave as
 * they do on a constructed value, on the client AND the server.
 *
 * Ruling: scrml-support/user-voice-scrml.md S441 ("`| err :>` binds the error
 * value"); SPEC §18.2 / §19.4.3.
 *
 * Pre-fix the arm lowered to `const err = result.data` — the PAYLOAD (`null`
 * for a unit variant, the bare field object for a payload variant) — so every
 * comparison / match below came out false / undefined, silently.
 *
 * These tests EXECUTE the emitted bundle (client in happy-dom; the server
 * bundle imported and its route run) — the property is the runtime value.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

afterEach(() => {
  delete globalThis.fetch;
});

function compileSource(name, src) {
  const dir = mkdtempSync(join(tmpdir(), "s441-catch-all-"));
  const abs = join(dir, `${name}.scrml`);
  writeFileSync(abs, src);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const errors = (result.errors || []).filter((e) => e && (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0] ?? {};
  return { dir, errors, html: out.html ?? "", clientJs: out.clientJs ?? "", serverJs: out.serverJs ?? "" };
}

function stubRequest(path, bodyText) {
  const token = "s441-csrf";
  const headers = new Map([
    ["content-type", "application/json"],
    ["x-csrf-token", token],
    ["cookie", "scrml_csrf=" + token],
  ]);
  return {
    url: "http://localhost" + path,
    method: "POST",
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    json: async () => (bodyText ? JSON.parse(bodyText) : {}),
  };
}

async function importServer(c, dbFile) {
  const js = c.serverJs.replace(/new SQL\("sqlite:[^"]*"\)/, `new SQL(${JSON.stringify("sqlite:" + join(c.dir, dbFile))})`);
  const p = join(c.dir, `server-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, js);
  return import(p);
}

function mount(c, mod) {
  if (mod) {
    globalThis.fetch = async (url, init) => {
      const res = await mod.fetch(stubRequest(String(url), init && init.body));
      const text = await res.text();
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        json: async () => JSON.parse(text),
        text: async () => text,
        headers: { get: () => "application/json" },
      };
    };
  }
  const bodyHtml = (c.html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || c.html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code = `(function() {\n${SCRML_RUNTIME}\n` +
    captureInsideChunkScope(c.clientJs, `window.__sg = _scrml_reactive_get;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return {
    get: (n) => window.__sg(n),
    click: (sel) => document.querySelector(sel).dispatchEvent(new Event("click", { bubbles: true })),
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const CLIENT_SRC = `<program>
  type E:enum = { Unit, Pay(msg: string) }
  type Phase:enum = { Idle, Failed(err: E) }
  <kind> = "unit"
  <phase>: Phase = .Idle
  <isUnit> = false
  <isPay> = false
  <isPayOther> = false
  <label> = ""
  <nested> = ""
  function check() ! E {
    if (@kind == "unit") fail .Unit
    fail .Pay("boom")
  }
  fn isUnitErr(e: E) -> bool { return e == E.Unit }
  fn isPayBoom(e: E) -> bool { return e == E.Pay("boom") }
  fn isPayOther(e: E) -> bool { return e == E.Pay("other") }
  fn describe(e: E) -> string {
    return match e {
      .Unit     :> "unit"
      .Pay(msg) :> "pay:" + msg
    }
  }
  function useUnit() { @kind = "unit" }
  function usePay() { @kind = "pay" }
  function runEq() {
    check() !{
      | err :> { @isUnit = isUnitErr(err); @isPay = isPayBoom(err); @isPayOther = isPayOther(err); return }
    }
  }
  function runMatch() {
    check() !{
      | e :> { @label = describe(e); return }
    }
  }
  function runHold() {
    check() !{
      | err :> { @phase = .Failed(err); return }
    }
  }
  function runNested() {
    const r = check() !{
      | outer :> {
        const s = check() !{
          | inner :> { @nested = describe(outer) + "/" + describe(inner) }
        }
      }
    }
  }
  <button id="u" onclick=useUnit()>u</button>
  <button id="p" onclick=usePay()>p</button>
  <button id="eq" onclick=runEq()>eq</button>
  <button id="m" onclick=runMatch()>m</button>
  <button id="h" onclick=runHold()>h</button>
  <button id="n" onclick=runNested()>n</button>
  <p id="out">\${@label} \${@nested} \${@isUnit} \${@isPay} \${@isPayOther}</p>
  <match for=Phase on=@phase>
    <Idle><p id="held">idle</p></>
    <Failed err><p id="held">\${describe(err)}</p></>
  </>
</program>
`;

describe("s441 D1 — `| err :>` binds the error value (client)", () => {
  test("emits the normalized value, not the bare payload", () => {
    const c = compileSource("d1", CLIENT_SRC);
    expect(c.errors).toEqual([]);
    expect(c.clientJs).toMatch(/const err = \((_scrml__scrml_result_\d+)\.data == null \|\| \(typeof \1\.data === "object" && Object\.keys\(\1\.data\)\.length === 0\)\) \? \1\.variant : \{ variant: \1\.variant, data: \1\.data \};/);
    expect(c.clientJs).not.toMatch(/const err = _scrml__scrml_result_\d+\.data;/);
  });

  test("unit variant: `err == E.Unit` is true, payload comparisons false", async () => {
    const api = mount(compileSource("d1", CLIENT_SRC));
    api.click("#eq");
    await settle();
    expect(api.get("isUnit")).toBe(true);
    expect(api.get("isPay")).toBe(false);
    expect(api.get("isPayOther")).toBe(false);
  });

  test("payload variant: `err == E.Pay(\"boom\")` true, different payload false", async () => {
    const api = mount(compileSource("d1", CLIENT_SRC));
    api.click("#p");
    api.click("#eq");
    await settle();
    expect(api.get("isUnit")).toBe(false);
    expect(api.get("isPay")).toBe(true);
    expect(api.get("isPayOther")).toBe(false);
  });

  test("`match err` dispatches on the bound value (unit + payload)", async () => {
    const api = mount(compileSource("d1", CLIENT_SRC));
    api.click("#m");
    await settle();
    expect(api.get("label")).toBe("unit");
    api.click("#p");
    api.click("#m");
    await settle();
    expect(api.get("label")).toBe("pay:boom");
  });

  test("held in a state (`.Failed(err)`) and rendered by the `<Failed err>` arm", async () => {
    const api = mount(compileSource("d1", CLIENT_SRC));
    api.click("#h");
    await settle();
    expect(api.get("phase")).toEqual({ variant: "Failed", data: { err: "Unit" } });
    expect(document.querySelector("#held").textContent).toBe("unit");
  });

  test("nested `!{}`: outer and inner catch-all names both bind error values", async () => {
    const api = mount(compileSource("d1", CLIENT_SRC));
    api.click("#p");
    api.click("#n");
    await settle();
    expect(api.get("nested")).toBe("pay:boom/pay:boom");
  });
});

// Server-side `!{}`: the catch-all arm on the SERVER binds the error value. The
// arm body returns it (a success value of the non-failable server fn) so the
// client can inspect exactly what the server-side name was bound to; a second
// fn compares it to a unit variant on the server.
//
// (Helpers are kept out of the server-side arm body on purpose: an `!{}` arm body
// is still lowered from a string — known gap
// g-bang-brace-arm-bodies-have-no-tree-form… — so a `fn` referenced ONLY from a
// server-side arm body is not carried into the server bundle, and `==` in an
// arm body lowers to `===`. Neither is what this test is about.)
const SERVER_SRC = `<program db="d1s.db">
<db src="d1s.db" tables="t">
\${
  type E:enum = { Unit, Pay(msg: string) }
  <out> = ""
  <sawUnit> = false
  fn describe(e: E) -> string {
    return match e {
      .Unit     :> "unit"
      .Pay(msg) :> "pay:" + msg
    }
  }
  function inner(which: string) ! E {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    if (which == "unit") fail .Unit
    fail .Pay("boom")
  }
  server function caught(which: string) -> E {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    const r = inner(which) !{
      | err :> { return err }
    }
    return E.Pay("unreached")
  }
  server function isUnitOnServer(which: string) -> bool {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    const r = inner(which) !{
      | err :> { return err == E.Unit }
    }
    return false
  }
  function goUnit() { @out = describe(caught("unit")); @sawUnit = isUnitOnServer("unit") }
  function goPay() { @out = describe(caught("pay")); @sawUnit = isUnitOnServer("pay") }
}
<button id="u" onclick=goUnit()>u</button>
<button id="p" onclick=goPay()>p</button>
<p id="out">\${@out} \${@sawUnit}</p>
</>
</program>
`;

describe("s441 D1 — `| err :>` binds the error value (server-side `!{}`)", () => {
  test("the server bundle emits the same normalized binding", () => {
    const c = compileSource("d1s", SERVER_SRC);
    expect(c.errors).toEqual([]);
    expect(c.serverJs).toMatch(/const err = \(([\w$]+)\.data == null \|\| \(typeof \1\.data === "object" && Object\.keys\(\1\.data\)\.length === 0\)\) \? \1\.variant : \{ variant: \1\.variant, data: \1\.data \};/);
  });

  test("EXECUTES: server-side catch-all sees unit and payload error values", async () => {
    const c = compileSource("d1s", SERVER_SRC);
    const mod = await importServer(c, "d1s.db");
    const api = mount(c, mod);
    api.click("#u");
    await settle();
    expect(api.get("out")).toBe("unit");
    expect(api.get("sawUnit")).toBe(true);
    api.click("#p");
    await settle();
    expect(api.get("out")).toBe("pay:boom");
    expect(api.get("sawUnit")).toBe(false);
  });
});

// The explicit-wildcard spelling `| _ e :>` is NOT the identifier-binding arm:
// the S441 ruling covers `| err :>`, and flogence (viewapp/view.scrml,
// src/app.scrml) reads `e.message` off the payload through `| _ e :>`. It keeps
// its payload binding; whether it should follow the ruling is surfaced to the PA.
const WILDCARD_NAMED_SRC = `<program>
  type E:enum = { Pay(msg: string) }
  <m> = ""
  function check() ! E {
    fail .Pay("boom")
  }
  function run() {
    check() !{
      | _ e :> { @m = e.msg; return }
    }
  }
  <button id="go" onclick=run()>go</button>
  <p>\${@m}</p>
</program>
`;

describe("s441 D1 — `| _ e :>` (explicit wildcard + name) is unchanged", () => {
  test("still binds the payload", async () => {
    const c = compileSource("wild", WILDCARD_NAMED_SRC);
    expect(c.errors).toEqual([]);
    expect(c.clientJs).toMatch(/const e = _scrml__scrml_result_\d+\.data;/);
    const api = mount(c);
    api.click("#go");
    await settle();
    expect(api.get("m")).toBe("boom");
  });
});
