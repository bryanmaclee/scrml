/**
 * s441-failable-arm-binding — review round (S441 PA review of af62bce5a).
 *
 * F1 (HIGH, regression) + F3 (MED), one root: the variant→payload-field
 * registry (`buildVariantFieldsRegistry`) read only the file's OWN typeDecls.
 * After D2 the DECLARING file emits field-keyed payloads, but an IMPORTING file
 * had no schema for the imported enum, so
 *   - F1: a client `| .One(m) :>` over an imported enum bound the whole `.data`
 *         (`one:[object Object]`, was `one:m`);
 *   - F3: a LOCAL `fail` of an imported enum emitted a raw `data: "m"`, so the
 *         `| err :>` value was `{variant, data: "m"}` and `err == IE.One("m")`
 *         was false.
 * Fix: codegen/index.ts collects every file's imported enum decls (through
 * re-export chains) and emit-client.ts:buildVariantFieldsRegistry folds them in
 * on BOTH the client and the server pass.
 *
 * F5: a SERVER `match` over an imported payload enum compared the whole value
 *     against the tag string; with the schema known it dispatches on `.variant`.
 * F4 (LOW): a unit variant emitted with `data: {}` (parseVariant's
 *     `ParseError.MissingDiscriminator`) normalized to `{variant, data: {}}`; it
 *     is now the unit value.
 * F2 (MED, carried gap g-bang-brace-arm-bodies-have-no-tree-form…): `==` written
 *     INSIDE an `!{}` arm body lowers to `===`, so a payload comparison there is
 *     false. Pinned as known-failing below, with a sibling asserting today's
 *     behaviour and the working route (a `fn`).
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

/** Compile a set of files together; returns per-basename outputs. */
function compileFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), "s441-errarm-rr-"));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  const result = compileScrml({
    inputFiles: Object.keys(files).map((n) => join(dir, n)),
    outputDir: join(dir, "dist"),
    write: false,
    log: () => {},
  });
  const errors = (result.errors || []).filter((e) => e && (e.severity ?? "error") === "error");
  const byName = {};
  for (const [k, o] of result.outputs || new Map()) {
    const base = k.split("/").pop().replace(/\.scrml$/, "");
    byName[base] = o;
  }
  return { dir, errors, byName };
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

async function importServerJs(dir, serverJs, dbFile) {
  const js = serverJs.replace(/new SQL\("sqlite:[^"]*"\)/g, `new SQL(${JSON.stringify("sqlite:" + join(dir, dbFile))})`);
  const p = join(dir, `server-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, js);
  return import(p);
}

/** Mount `html` + the given client bundles (dependency first) in happy-dom. */
function mount(html, clientJsList, serverMod) {
  if (serverMod) {
    globalThis.fetch = async (url, init) => {
      const res = await serverMod.fetch(stubRequest(String(url), init && init.body));
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
  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const last = clientJsList[clientJsList.length - 1];
  const deps = clientJsList.slice(0, -1).join("\n");
  const code = `(function() {\n${SCRML_RUNTIME}\n${deps}\n` +
    captureInsideChunkScope(last, `window.__sg = _scrml_reactive_get;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return {
    get: (n) => window.__sg(n),
    click: (sel) => document.querySelector(sel).dispatchEvent(new Event("click", { bubbles: true })),
  };
}

async function settle() {
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

// --- F1: a server fail in the DECLARING file, bound in the IMPORTING file ---

const F1_ERRS = `\${
  export type IE:enum = { One(msg: string), Two(a: string, b: number) }
  export server function srv(w: string) ! IE {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    if (w == "one") fail IE.One("m")
    fail IE.Two("x", 2)
  }
}
`;

const F1_APP = `<program>
\${
  import { IE, srv } from "./errs.scrml"
  <r> = ""
  function go(w: string) {
    srv(w) !{
      | .One(m) :> { @r = "one:" + m; return }
      | .Two(a, b) :> { @r = "two:" + a + b; return }
    }
  }
}
<button id="one" onclick=go("one")>a</button>
<button id="two" onclick=go("two")>b</button>
<p>\${@r}</p>
</program>
`;

describe("s441 F1 — payload arms over an IMPORTED enum project the field", () => {
  test("the importing client reads `.data.msg` / `.data.a` / `.data.b`", () => {
    const c = compileFiles({ "errs.scrml": F1_ERRS, "app.scrml": F1_APP });
    expect(c.errors).toEqual([]);
    const app = c.byName.app.clientJs;
    expect(app).toMatch(/const m = _scrml__scrml_result_\d+\.data\.msg;/);
    expect(app).toMatch(/const a = _scrml__scrml_result_\d+\.data\.a;/);
    expect(app).not.toMatch(/const m = _scrml__scrml_result_\d+\.data;/);
  });

  test("EXECUTES: server fail in errs.scrml → client arm in app.scrml binds the fields", async () => {
    const c = compileFiles({ "errs.scrml": F1_ERRS, "app.scrml": F1_APP });
    const mod = await importServerJs(c.dir, c.byName.errs.serverJs, "p.db");
    let api = mount(c.byName.app.html, [c.byName.errs.clientJs, c.byName.app.clientJs], mod);
    api.click("#one");
    await settle();
    // Pre-fix: "one:[object Object]".
    expect(api.get("r")).toBe("one:m");
    await GlobalRegistrator.unregister();
    await GlobalRegistrator.register();
    api = mount(c.byName.app.html, [c.byName.errs.clientJs, c.byName.app.clientJs], mod);
    api.click("#two");
    await settle();
    expect(api.get("r")).toBe("two:x2");
  });
});

// --- F3: a LOCAL fail of an imported enum; `| err :>` compares to IE.One("m") ---

const F3_ERRS = `\${
  export type IE:enum = { Unit, One(msg: string) }
}
`;

const F3_APP = `<program>
\${
  import { IE } from "./errs.scrml"
  <which> = "Unit"
  <res> = ""
  fn isOne(e: IE) -> bool { return e == IE.One("m") }
  fn isUnit(e: IE) -> bool { return e == IE.Unit }
  fn desc(e: IE) -> string {
    return match e {
      .Unit :> "U"
      .One(msg) :> "O:" + msg
    }
  }
  function check() ! IE {
    if (@which == "Unit") fail .Unit
    fail .One("m")
  }
  function go() {
    check() !{
      | err :> { @res = desc(err) + " isOne=" + isOne(err) + " isUnit=" + isUnit(err); return }
    }
  }
  function pickOne() { @which = "One" }
}
<button id="one" onclick=pickOne()>a</button>
<button id="go" onclick=go()>g</button>
<p>\${@res}</p>
</program>
`;

describe("s441 F3 — a local `fail` of an IMPORTED enum is field-keyed", () => {
  test("the importing file emits `data: { msg: \"m\" }`", () => {
    const c = compileFiles({ "errs.scrml": F3_ERRS, "app.scrml": F3_APP });
    expect(c.errors).toEqual([]);
    expect(c.byName.app.clientJs).toContain(`variant: "One", data: { msg: "m" } }`);
    expect(c.byName.app.clientJs).not.toContain(`data: "m"`);
  });

  test("EXECUTES: `err == IE.One(\"m\")` and `err == IE.Unit` hold on the bound value", async () => {
    const c = compileFiles({ "errs.scrml": F3_ERRS, "app.scrml": F3_APP });
    let api = mount(c.byName.app.html, [c.byName.errs.clientJs, c.byName.app.clientJs]);
    api.click("#go");
    await settle();
    expect(api.get("res")).toBe("U isOne=false isUnit=true");
    await GlobalRegistrator.unregister();
    await GlobalRegistrator.register();
    api = mount(c.byName.app.html, [c.byName.errs.clientJs, c.byName.app.clientJs]);
    api.click("#one");
    api.click("#go");
    await settle();
    // Pre-fix: "O:undefined isOne=false …" — the raw `data: "m"` had no `.msg`.
    expect(api.get("res")).toBe("O:m isOne=true isUnit=false");
  });
});

// --- F5: a SERVER match over an imported payload enum dispatches on the tag ---

const F5_ERRS = `\${
  export type IE:enum = { P(a: string), Q(b: string), R }
  export server function ping() -> string {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    return "x"
  }
}
`;

const F5_APP = `<program db="p.db">
<db src="p.db" tables="t">
\${
  import { IE } from "./errs.scrml"
  <r1> = ""
  server function classify(w: string) -> string {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    let v: IE = IE.R
    if (w == "P") v = IE.P("x")
    return match v {
      .P :> "p"
      .Q :> "q"
      .R :> "r"
    }
  }
  function go(w: string) { @r1 = classify(w) }
}
<button id="P" onclick=go("P")>a</button>
</>
</program>
`;

describe("s441 F5 — server `match` over an imported payload enum", () => {
  test("dispatches on `.variant`, not on the whole value", () => {
    const c = compileFiles({ "errs.scrml": F5_ERRS, "app.scrml": F5_APP });
    expect(c.errors).toEqual([]);
    const s = c.byName.app.serverJs;
    // Pre-fix: `if (_scrml_match_N === "P")` — an object never equals a string.
    expect(s).toMatch(/const (_scrml_tag_\d+) = \((_scrml_match_\d+) != null && typeof \2 === "object"\) \? \2\.variant : \2;/);
    expect(s).not.toMatch(/if \(_scrml_match_\d+ === "P"\)/);
  });
});

// --- F4: a unit variant carried with `data: {}` binds the unit value ---

const F4_SRC = `<program>
  import { parseVariant, ParseError } from 'scrml:data'
  type LoadResult:enum = { Success(rows: int), Empty }
  <r> = ""
  <held>: ParseError | not = not
  fn kind(e: ParseError) -> string {
    return match e {
      .MissingDiscriminator :> "missing"
      .UnknownVariant(tag) :> "unknown:" + tag
      .InvalidPayload(field, reason) :> "invalid:" + field
      .Malformed(reason) :> "malformed"
    }
  }
  function decode(s: string) {
    parseVariant(s, LoadResult) !{
      | err :> { @held = err; @r = kind(err); return }
    }
  }
  <button id="a" onclick=decode('{"foo":1}')>a</button>
  <button id="b" onclick=decode('{"tag":"Nope"}')>b</button>
  <p>\${@r}</p>
</program>
`;

describe("s441 F4 — a unit variant emitted with `data: {}` binds the unit value", () => {
  test("MissingDiscriminator (data: {}) binds the variant value; a payload variant keeps its fields", async () => {
    const c = compileFiles({ "p.scrml": F4_SRC });
    expect(c.errors).toEqual([]);
    let api = mount(c.byName.p.html, [c.byName.p.clientJs]);
    api.click("#a");
    await settle();
    // Pre-fix: { variant: "MissingDiscriminator", data: {} } — not == the unit value.
    expect(api.get("held")).toBe("MissingDiscriminator");
    expect(api.get("r")).toBe("missing");
    await GlobalRegistrator.unregister();
    await GlobalRegistrator.register();
    api = mount(c.byName.p.html, [c.byName.p.clientJs]);
    api.click("#b");
    await settle();
    expect(api.get("held")).toEqual({ variant: "UnknownVariant", data: { tag: "Nope" } });
    expect(api.get("r")).toBe("unknown:Nope");
  });
});

// --- F2: `==` written INSIDE an arm body (carried gap) ---

const F2_SRC = `<program>
  type E:enum = { Unit, One(msg: string) }
  <inArm> = ""
  <viaFn> = ""
  fn isOne(e: E) -> bool { return e == E.One("m") }
  function check() ! E {
    fail E.One("m")
  }
  function go() {
    check() !{
      | err :> { @inArm = "" + (err == E.One("m")); @viaFn = "" + isOne(err); return }
    }
  }
  <button id="go" onclick=go()>g</button>
  <p>\${@inArm} \${@viaFn}</p>
</program>
`;

describe("s441 F2 — payload `==` inside an `!{}` arm body (gap g-bang-brace-arm-bodies-have-no-tree-form…)", () => {
  // §19.4.3.1 promises `err == ErrorType.V(args)` holds on the bound value. It
  // does through a `fn` (sibling below) but NOT when written in the arm body,
  // because the arm body is lowered from a string and `==` becomes `===`.
  // Flip to `test` when the arm-body tree-form gap closes.
  test.failing("in-arm `err == E.One(\"m\")` is true (§19.4.3.1)", async () => {
    const c = compileFiles({ "p.scrml": F2_SRC });
    const api = mount(c.byName.p.html, [c.byName.p.clientJs]);
    api.click("#go");
    await settle();
    expect(api.get("inArm")).toBe("true");
  });

  test("current behaviour: in-arm `==` is reference `===` (false); the `fn` route is structural (true)", async () => {
    const c = compileFiles({ "p.scrml": F2_SRC });
    expect(c.errors).toEqual([]);
    expect(c.byName.p.clientJs).toMatch(/err === E\.One \( "m" \)/);
    const api = mount(c.byName.p.html, [c.byName.p.clientJs]);
    api.click("#go");
    await settle();
    expect(api.get("inArm")).toBe("false");
    expect(api.get("viaFn")).toBe("true");
  });
});
