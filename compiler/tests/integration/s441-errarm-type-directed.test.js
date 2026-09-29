/**
 * s441-failable-arm-binding — review round 3 (PA re-review of c4b0d8db9).
 *
 * R2-1 (HIGH, regression): importing an enum that shares a payload-variant NAME
 *   with a LOCAL enum put the name in the bare-name collision set, so the file's
 *   OWN `match` lost its binding (unbound `field` → ReferenceError), its own
 *   `fail` flipped to a raw `data`, and `| .NotFound(f) :>` bound the whole
 *   `.data`. Fix: the registry is TYPE-DIRECTED (`byEnum`: enum → variant →
 *   fields). A `fail` resolves by its target's enum; an `!{}` arm by the handled
 *   call's error enum (type-system.ts annotates `errorTypeName` on the node) —
 *   or, when that is unknown and the variant name is shared, by the envelope's
 *   RUNTIME `type`. The bare-name fallback lets an OWN enum always win.
 * R2-2 (MED): shared names between imported enums (and local + imported) — the
 *   `!{}` arms and the `| err :>` value now resolve by type. The `match` reader
 *   over such an enum is NOT fixed here (pinned as known-failing below).
 * R2-3 (LOW): a renamed re-export `export { IE as JE } from …` now maps back to
 *   IE's declaration.
 * R2-5: the multi-field space form `| ::Two x :>` silently binds the first field
 *   — a carried impl gap (SPEC §19.4.3.1 ⚑), pinned here as today's behaviour.
 *
 * Sources are the PA review's scenarios (scratchpad rv-errarm-r2-out/sc/*).
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


const REGRESS = {"errs.scrml": "${\n  export type ApiError:enum = { NotFound(path: string), Timeout }\n  export fn describeApi(e: ApiError) -> string {\n    return match e {\n      .NotFound(path) :> \"missing \" + path\n      .Timeout :> \"timeout\"\n    }\n  }\n}\n", "app.scrml": "<program>\n${\n  import { ApiError, describeApi } from \"./errs.scrml\"\n  type FormError:enum = { NotFound(field: string), Empty }\n  <r> = \"\"\n  fn show(e: FormError) -> string {\n    return match e {\n      .NotFound(field) :> \"no field \" + field\n      .Empty :> \"empty\"\n    }\n  }\n  function check(w: string) ! FormError {\n    if (w == \"nf\") fail .NotFound(\"email\")\n    fail .Empty\n  }\n  function go(w: string) {\n    check(w) !{\n      | .NotFound(f) :> { @r = \"arm:\" + f + \" / \" + show(FormError.NotFound(\"email\")); return }\n      | .Empty :> { @r = \"empty\"; return }\n    }\n  }\n  function go2() {\n    check(\"nf\") !{\n      | err :> { @r = show(err); return }\n    }\n  }\n}\n<button id=\"nf\" onclick=go(\"nf\")>a</button>\n<button id=\"v\" onclick=go2()>a</button>\n<p id=\"out\">${@r}</p>\n</program>\n"};
const IMPCOLL = {"errs.scrml": "${\n  export type IE:enum = { Unit, One(msg: string), Two(a: string, b: number) }\n  export server function srv(w: string) ! IE {\n    ?{`CREATE TABLE IF NOT EXISTS t (id integer primary key)`}.run()\n    if (w == \"one\") fail IE.One(\"m\")\n    if (w == \"unit\") fail IE.Unit\n    fail IE.Two(\"x\", 2)\n  }\n  \n}\n", "errs2.scrml": "${\n  export type JE:enum = { One(qq: string), Two(c: string, d: number) }\n}\n", "app.scrml": "<program>\n${\n  import { IE, srv } from \"./errs.scrml\"\n  import { JE } from \"./errs2.scrml\"\n  \n  <r> = \"\"\n  fn isOne(e: IE) -> bool { return e == IE.One(\"m\") }\n  fn isUnit(e: IE) -> bool { return e == IE.Unit }\n  fn desc(e: IE) -> string {\n    return match e {\n      .Unit :> \"U\"\n      .One(msg) :> \"O:\" + msg\n      .Two(a, b) :> \"T:\" + a + b\n    }\n  }\n  function loc(w: string) ! IE {\n    if (w == \"one\") fail IE.One(\"m\")\n    if (w == \"unit\") fail .Unit\n    fail .Two(\"x\", 2)\n  }\n  function arms(w: string, remote: bool) {\n    if (remote) {\n      srv(w) !{\n        | .One(m) :> { @r = \"one:\" + m; return }\n        | .Two(a, b) :> { @r = \"two:\" + a + b; return }\n        | .Unit :> { @r = \"unit\"; return }\n      }\n    } else {\n      loc(w) !{\n        | .One(m) :> { @r = \"one:\" + m; return }\n        | .Two(a, b) :> { @r = \"two:\" + a + b; return }\n        | .Unit :> { @r = \"unit\"; return }\n      }\n    }\n  }\n  function val(w: string, remote: bool) {\n    if (remote) {\n      srv(w) !{\n        | err :> { @r = desc(err) + \" isOne=\" + isOne(err) + \" isUnit=\" + isUnit(err); return }\n      }\n    } else {\n      loc(w) !{\n        | err :> { @r = desc(err) + \" isOne=\" + isOne(err) + \" isUnit=\" + isUnit(err); return }\n      }\n    }\n  }\n}\n<button id=\"sOne\" onclick=arms(\"one\", true)>a</button>\n<button id=\"sTwo\" onclick=arms(\"two\", true)>a</button>\n<button id=\"lOne\" onclick=arms(\"one\", false)>a</button>\n<button id=\"lTwo\" onclick=arms(\"two\", false)>a</button>\n<button id=\"vsOne\" onclick=val(\"one\", true)>a</button>\n<button id=\"vsUnit\" onclick=val(\"unit\", true)>a</button>\n<button id=\"vlOne\" onclick=val(\"one\", false)>a</button>\n<button id=\"vlTwo\" onclick=val(\"two\", false)>a</button>\n<p id=\"out\">${@r}</p>\n</program>\n"};
const LOCALCOLL = {"errs.scrml": "${\n  export type IE:enum = { Unit, One(msg: string), Two(a: string, b: number) }\n  export server function srv(w: string) ! IE {\n    ?{`CREATE TABLE IF NOT EXISTS t (id integer primary key)`}.run()\n    if (w == \"one\") fail IE.One(\"m\")\n    if (w == \"unit\") fail IE.Unit\n    fail IE.Two(\"x\", 2)\n  }\n  \n}\n", "app.scrml": "<program>\n${\n  import { IE, srv } from \"./errs.scrml\"\n  type LE:enum = { One(zz: string), Other }\n  <r> = \"\"\n  fn isOne(e: IE) -> bool { return e == IE.One(\"m\") }\n  fn isUnit(e: IE) -> bool { return e == IE.Unit }\n  fn desc(e: IE) -> string {\n    return match e {\n      .Unit :> \"U\"\n      .One(msg) :> \"O:\" + msg\n      .Two(a, b) :> \"T:\" + a + b\n    }\n  }\n  function loc(w: string) ! IE {\n    if (w == \"one\") fail IE.One(\"m\")\n    if (w == \"unit\") fail .Unit\n    fail .Two(\"x\", 2)\n  }\n  function arms(w: string, remote: bool) {\n    if (remote) {\n      srv(w) !{\n        | .One(m) :> { @r = \"one:\" + m; return }\n        | .Two(a, b) :> { @r = \"two:\" + a + b; return }\n        | .Unit :> { @r = \"unit\"; return }\n      }\n    } else {\n      loc(w) !{\n        | .One(m) :> { @r = \"one:\" + m; return }\n        | .Two(a, b) :> { @r = \"two:\" + a + b; return }\n        | .Unit :> { @r = \"unit\"; return }\n      }\n    }\n  }\n  function val(w: string, remote: bool) {\n    if (remote) {\n      srv(w) !{\n        | err :> { @r = desc(err) + \" isOne=\" + isOne(err) + \" isUnit=\" + isUnit(err); return }\n      }\n    } else {\n      loc(w) !{\n        | err :> { @r = desc(err) + \" isOne=\" + isOne(err) + \" isUnit=\" + isUnit(err); return }\n      }\n    }\n  }\n}\n<button id=\"sOne\" onclick=arms(\"one\", true)>a</button>\n<button id=\"sTwo\" onclick=arms(\"two\", true)>a</button>\n<button id=\"lOne\" onclick=arms(\"one\", false)>a</button>\n<button id=\"lTwo\" onclick=arms(\"two\", false)>a</button>\n<button id=\"vsOne\" onclick=val(\"one\", true)>a</button>\n<button id=\"vsUnit\" onclick=val(\"unit\", true)>a</button>\n<button id=\"vlOne\" onclick=val(\"one\", false)>a</button>\n<button id=\"vlTwo\" onclick=val(\"two\", false)>a</button>\n<p id=\"out\">${@r}</p>\n</program>\n"};
const REEXP = {"errs.scrml": "${\n  export type IE:enum = { Unit, One(msg: string), Two(a: string, b: number) }\n  export server function srv(w: string) ! IE {\n    ?{`CREATE TABLE IF NOT EXISTS t (id integer primary key)`}.run()\n    if (w == \"one\") fail IE.One(\"m\")\n    if (w == \"unit\") fail IE.Unit\n    fail IE.Two(\"x\", 2)\n  }\n  \n}\n", "mid.scrml": "${\n  export { IE as JE, srv } from \"./errs.scrml\"\n}\n", "app.scrml": "<program>\n${\n  import { JE, srv } from \"./mid.scrml\"\n  \n  <r> = \"\"\n  fn isOne(e: JE) -> bool { return e == JE.One(\"m\") }\n  fn isUnit(e: JE) -> bool { return e == JE.Unit }\n  function loc(w: string) ! JE {\n    if (w == \"one\") fail JE.One(\"m\")\n    if (w == \"unit\") fail .Unit\n    fail .Two(\"x\", 2)\n  }\n  function arms(w: string, remote: bool) {\n    if (remote) {\n      srv(w) !{\n        | .One(m) :> { @r = \"one:\" + m; return }\n        | .Two(a, b) :> { @r = \"two:\" + a + b; return }\n        | .Unit :> { @r = \"unit\"; return }\n      }\n    } else {\n      loc(w) !{\n        | .One(m) :> { @r = \"one:\" + m; return }\n        | .Two(a, b) :> { @r = \"two:\" + a + b; return }\n        | .Unit :> { @r = \"unit\"; return }\n      }\n    }\n  }\n  function val(w: string, remote: bool) {\n    if (remote) {\n      srv(w) !{\n        | err :> { @r = \" isOne=\" + isOne(err) + \" isUnit=\" + isUnit(err); return }\n      }\n    } else {\n      loc(w) !{\n        | err :> { @r = \" isOne=\" + isOne(err) + \" isUnit=\" + isUnit(err); return }\n      }\n    }\n  }\n}\n<button id=\"sOne\" onclick=arms(\"one\", true)>a</button>\n<button id=\"sTwo\" onclick=arms(\"two\", true)>a</button>\n<button id=\"lOne\" onclick=arms(\"one\", false)>a</button>\n<button id=\"lTwo\" onclick=arms(\"two\", false)>a</button>\n<button id=\"vsOne\" onclick=val(\"one\", true)>a</button>\n<button id=\"vsUnit\" onclick=val(\"unit\", true)>a</button>\n<button id=\"vlOne\" onclick=val(\"one\", false)>a</button>\n<button id=\"vlTwo\" onclick=val(\"two\", false)>a</button>\n<p id=\"out\">${@r}</p>\n</program>\n"};
const SPACE = {"app.scrml": "<program>\n${\n  type E:enum = { Unit, One(msg: string), Two(a: string, b: number) }\n  <r> = \"\"\n  function loc(w: string) ! E {\n    if (w == \"one\") fail E.One(\"m\")\n    if (w == \"unit\") fail .Unit\n    fail .Two(\"x\", 2)\n  }\n  function go(w: string) {\n    loc(w) !{\n      | ::One m :> { @r = \"one:\" + m; return }\n      | ::Two x :> { @r = \"two:\" + JSON.stringify(x); return }\n      | _ e :> { @r = \"wild:\" + JSON.stringify(e); return }\n    }\n  }\n}\n<button id=\"one\" onclick=go(\"one\")>a</button>\n<button id=\"two\" onclick=go(\"two\")>a</button>\n<button id=\"unit\" onclick=go(\"unit\")>a</button>\n<p id=\"out\">${@r}</p>\n</program>\n"};

/** Click `#id` on a fresh mount; return `#out` text. */
async function drive(c, clientOrder, serverFrom, id) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
  const mod = serverFrom ? await importServerJs(c.dir, c.byName[serverFrom].serverJs, "p.db") : null;
  const api = mount(c.byName.app.html, clientOrder.map((n) => c.byName[n].clientJs), mod);
  api.click("#" + id);
  await settle();
  return document.querySelector("#out")?.textContent ?? null;
}

describe("s441 R2-1 — an imported enum never changes what a LOCAL enum's variant means", () => {
  test("own `fail` stays field-keyed; own `match` and `| .NotFound(f) :>` bind the local field", async () => {
    const c = compileFiles(REGRESS);
    expect(c.errors).toEqual([]);
    const app = c.byName.app.clientJs;
    expect(app).toContain(`variant: "NotFound", data: { field: "email" } }`);
    expect(app).not.toContain(`data: "email"`);
    expect(await drive(c, ["errs", "app"], null, "nf")).toBe("arm:email / no field email");
    expect(await drive(c, ["errs", "app"], null, "v")).toBe("no field email");
  });
});

describe("s441 R2-2 — a variant name shared by two IMPORTED enums", () => {
  test("`!{}` payload arms resolve by the enum (local fail and server fail)", async () => {
    const c = compileFiles(IMPCOLL);
    expect(c.errors).toEqual([]);
    for (const [id, want] of [["sOne", "one:m"], ["sTwo", "two:x2"], ["lOne", "one:m"], ["lTwo", "two:x2"]]) {
      expect(await drive(c, ["errs", "errs2", "app"], "errs", id)).toBe(want);
    }
  });

  test("`| err :>` value compares equal to the right variant", async () => {
    const c = compileFiles(IMPCOLL);
    expect(await drive(c, ["errs", "errs2", "app"], "errs", "vsUnit")).toBe("U isOne=false isUnit=true");
  });

  // The `match` reader (`desc(err)` → `.One(msg) :> …`) resolves a payload
  // binding by the bare variant name; with the name shared by IE and JE it has
  // no schema and leaves `msg` unbound. Needs the scrutinee's enum type (or
  // E-VARIANT-AMBIGUOUS). Flip when fixed.
  test.failing("`match` over an imported enum whose variant name another import shares binds the payload", async () => {
    const c = compileFiles(IMPCOLL);
    expect(await drive(c, ["errs", "errs2", "app"], "errs", "vlOne")).toBe("O:m isOne=true isUnit=false");
  });
});

describe("s441 R2-2 — a variant name shared by a LOCAL and an imported enum", () => {
  test("`!{}` payload arms over the IMPORTED enum resolve by type, not by the local name", async () => {
    const c = compileFiles(LOCALCOLL);
    expect(c.errors).toEqual([]);
    for (const [id, want] of [["sOne", "one:m"], ["sTwo", "two:x2"], ["lOne", "one:m"], ["lTwo", "two:x2"], ["vsUnit", "U isOne=false isUnit=true"], ["vlTwo", "T:x2 isOne=false isUnit=false"]]) {
      expect(await drive(c, ["errs", "app"], "errs", id)).toBe(want);
    }
  });

  // Same `match` reader limit: `.One(msg)` over IE resolves by bare name → the
  // LOCAL enum's field (`zz`) → undefined. Flip when fixed.
  test.failing("`match` over the imported enum binds IE's field, not the local enum's", async () => {
    const c = compileFiles(LOCALCOLL);
    expect(await drive(c, ["errs", "app"], "errs", "vlOne")).toBe("O:m isOne=true isUnit=false");
  });
});

describe("s441 R2-3 — renamed re-export `export { IE as JE } from …`", () => {
  test("a `fail JE.V` and the `!{}` arms in the importer are field-keyed", () => {
    const c = compileFiles(REEXP);
    expect(c.errors).toEqual([]);
    const app = c.byName.app.clientJs;
    expect(app).toContain(`type: "JE", variant: "One", data: { msg: "m" } }`);
    expect(app).toContain(`type: "JE", variant: "Two", data: { a: "x", b: 2 } }`);
    expect(app).toMatch(/const m = _scrml__scrml_result_\d+\.data\.msg;/);
    expect(app).toMatch(/const a = _scrml__scrml_result_\d+\.data\.a;/);
  });
});

describe("s441 R2-5 — multi-field space form `| ::Two x :>` (carried impl gap, SPEC §19.4.3.1 ⚑)", () => {
  // §18.7 has no partial binding; impl#1 silently binds the FIRST field. This
  // pins today's behaviour so a change is visible; it is not the ratified rule.
  test("today: single-field `::One m` binds the field; multi-field `::Two x` binds the first field", async () => {
    const c = compileFiles(SPACE);
    expect(c.errors).toEqual([]);
    expect(await drive(c, ["app"], null, "one")).toBe("one:m");
    expect(await drive(c, ["app"], null, "two")).toBe('two:"x"');
    expect(await drive(c, ["app"], null, "unit")).toBe("wild:null");
  });
});
