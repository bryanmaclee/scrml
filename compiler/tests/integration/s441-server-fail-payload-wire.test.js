/**
 * s441-failable-arm-binding — DEFECT 2: a SERVER-side `fail` of a single-field
 * variant emitted a RAW `.data` value while the client emitted it field-keyed.
 *
 *     type E:enum = { Down(reason: string), Other }
 *     function send() ! E { ?{…}.run(); fail .Down("queue full") }   // server (§12 T1)
 *     send() !{ | ::Down(reason) :> … }                                // client
 *
 * Before the fix the server bundle emitted
 *     return { __scrml_error: true, type: "E", variant: "Down", data: "queue full" };
 * while the client arm read `result.data.reason` — the client-side schema — so
 * `reason` bound `undefined`, silently. Root cause: the per-file variant→payload-
 * field registry that `emitFailExpr` (and the `!{}` / `match` binding readers)
 * consult was populated on the CLIENT emit pass only (emit-client.ts
 * `setVariantFieldsForFile`); on the server pass it was null, so the single-arg
 * `fail` fell into the "no declared schema → bare value" branch.
 *
 * Governing text — SPEC §19.9.1: the server serializes the error as
 * `{ __scrml_error: true, type: "EnumType", variant: "VariantName", data: { ... } }`
 * — the canonical `fail`-expression envelope; §19.9.4: "Client code SHALL handle
 * server function errors identically to local function errors. The serialization
 * boundary SHALL be transparent to the developer."
 *
 * These tests EXECUTE: the server bundle is imported and its route handler run,
 * and the client bundle is mounted in happy-dom with `fetch` routed into that
 * real server module — a text grep would not prove the value reaches the cell.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
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

/** Compile a single-file program; returns html/client/server text + a tmp dir. */
function compileSource(name, src) {
  const dir = mkdtempSync(join(tmpdir(), "s441-fail-wire-"));
  const abs = join(dir, `${name}.scrml`);
  writeFileSync(abs, src);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const errors = (result.errors || []).filter((e) => e && (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0] ?? {};
  return { dir, errors, html: out.html ?? "", clientJs: out.clientJs ?? "", serverJs: out.serverJs ?? "" };
}

/**
 * Write the server bundle to disk with its `sqlite:<file>` URL redirected into
 * the tmp dir (so nothing is created in the repo), and import it.
 */
async function importServer(c, dbFile) {
  const js = c.serverJs.replace(/new SQL\("sqlite:[^"]*"\)/, `new SQL(${JSON.stringify("sqlite:" + join(c.dir, dbFile))})`);
  const p = join(c.dir, `server-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, js);
  return import(p);
}

/** A minimal request the emitted handler reads (url, method, headers.get, json). */
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

/**
 * Mount the client bundle in happy-dom with `fetch` dispatched into the REAL
 * emitted server module. Every wire body the client receives is recorded.
 */
function mountWithServer(c, mod) {
  const wire = [];
  globalThis.fetch = async (url, init) => {
    const res = await mod.fetch(stubRequest(String(url), init && init.body));
    const text = await res.text();
    wire.push(JSON.parse(text));
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => JSON.parse(text),
      text: async () => text,
      headers: { get: () => "application/json" },
    };
  };
  const bodyHtml = (c.html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || c.html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code = `(function() {\n${SCRML_RUNTIME}\n` +
    captureInsideChunkScope(c.clientJs, `window.__sg = _scrml_reactive_get;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return {
    wire,
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

const CLIENT_ARM_SRC = `<program db="d2.db">
<db src="d2.db" tables="t">
\${
  type E:enum = { Down(reason: string), Other }
  <msg> = "none"
  function send() ! E {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    fail .Down("queue full")
  }
  function go() {
    send() !{
      | ::Down(reason) :> { @msg = "down: " + reason; return }
      | ::Other        :> { @msg = "other"; return }
    }
  }
}
<button id="go" onclick=go()>go</button>
<p id="out">\${@msg}</p>
</>
</program>
`;

// A server fn consuming ANOTHER server fn's failure with a server-side `!{}`
// arm. Before the fix both ends were raw on the server pass (so this happened
// to agree); the fix moves BOTH ends to the field-keyed shape together, and this
// pins that the server-side reader still binds the field value, not the object.
const SERVER_ARM_SRC = `<program db="d2s.db">
<db src="d2s.db" tables="t">
\${
  type E:enum = { Down(reason: string), Other }
  <msg> = "none"
  function inner() ! E {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    fail .Down("queue full")
  }
  server function outer() -> string {
    ?{\`CREATE TABLE IF NOT EXISTS t (id integer primary key)\`}.run()
    const r = inner() !{
      | ::Down(reason) :> { return "server saw: " + reason }
      | ::Other        :> { return "server saw other" }
    }
    return "ok"
  }
  function go() {
    @msg = outer()
  }
}
<button id="go" onclick=go()>go</button>
<p id="out">\${@msg}</p>
</>
</program>
`;

describe("s441 D2 — a server-side single-field `fail` crosses the wire field-keyed", () => {
  test("the server bundle emits `data: { reason: … }` (field-keyed), matching the client", () => {
    const c = compileSource("d2", CLIENT_ARM_SRC);
    expect(c.errors).toEqual([]);
    expect(c.serverJs).toContain(`variant: "Down", data: { reason: "queue full" } }`);
    expect(c.serverJs).not.toContain(`data: "queue full"`);
    // the client reader keys the same field
    expect(c.clientJs).toContain(`.data.reason;`);
  });

  test("EXECUTES: the server route answers with the field-keyed envelope", async () => {
    const c = compileSource("d2", CLIENT_ARM_SRC);
    const mod = await importServer(c, "d2.db");
    const route = mod.routes[0];
    const res = await mod.fetch(stubRequest(route.path, "{}"));
    const body = JSON.parse(await res.text());
    expect(body).toEqual({ __scrml_error: true, type: "E", variant: "Down", data: { reason: "queue full" } });
  });

  test("EXECUTES end to end: the client `::Down(reason)` arm binds the reason", async () => {
    const c = compileSource("d2", CLIENT_ARM_SRC);
    const mod = await importServer(c, "d2.db");
    const api = mountWithServer(c, mod);
    api.click("#go");
    await settle();
    expect(api.wire.length).toBe(1);
    // Pre-fix: "down: undefined".
    expect(api.get("msg")).toBe("down: queue full");
    expect(document.querySelector("#out").textContent).toBe("down: queue full");
  });

  test("EXECUTES: a server-side `!{}` arm over a server-side `fail` still binds the field value", async () => {
    const c = compileSource("d2s", SERVER_ARM_SRC);
    expect(c.errors).toEqual([]);
    const mod = await importServer(c, "d2s.db");
    const api = mountWithServer(c, mod);
    api.click("#go");
    await settle();
    expect(api.get("msg")).toBe("server saw: queue full");
  });
});

// ---------------------------------------------------------------------------
// examples/09-error-handling.scrml — the flagship, driven end to end.
// ---------------------------------------------------------------------------

const EX09 = readFileSync(join(import.meta.dir, "../../../examples/09-error-handling.scrml"), "utf8");

function setInput(sel, value) {
  const el = document.querySelector(sel);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function submitForm() {
  document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function mount09({ rejectWrites = false } = {}) {
  const c = compileSource("ex09", EX09);
  expect(c.errors).toEqual([]);
  if (rejectWrites) {
    // A BEFORE INSERT trigger that silently drops the row: the INSERT succeeds
    // with zero rows written, which is exactly the case 09's SubmitFailed covers.
    const { SQL } = await import("bun");
    const sql = new SQL("sqlite:" + join(c.dir, "contact.db"));
    await sql`CREATE TABLE IF NOT EXISTS contact_messages (
      id integer primary key, name text not null, email text not null,
      body text not null, received_at timestamp DEFAULT CURRENT_TIMESTAMP)`;
    await sql`CREATE TRIGGER drop_all BEFORE INSERT ON contact_messages BEGIN SELECT RAISE(IGNORE); END`;
    await sql.close();
  }
  const mod = await importServer(c, "contact.db");
  const api = mountWithServer(c, mod);
  return api;
}

const errorText = () => (document.querySelector("p.text-red-600")?.textContent ?? "").trim();

describe("s441 — examples/09-error-handling.scrml end to end", () => {
  test("success path: a valid submission reaches .Succeeded", async () => {
    const api = await mount09();
    setInput('input[type="text"]', "Ada");
    setInput('input[type="email"]', "ada@example.com");
    setInput("textarea", "hello");
    submitForm();
    await settle();
    expect(api.get("phase")).toBe("Succeeded");
    expect(document.body.textContent).toContain("Thanks! We will be in touch.");
  });

  test("server submit failure: the wire envelope is field-keyed (D2)", async () => {
    const api = await mount09({ rejectWrites: true });
    setInput('input[type="text"]', "Ada");
    setInput('input[type="email"]', "ada@example.com");
    setInput("textarea", "hello");
    submitForm();
    await settle();
    expect(api.wire.length).toBe(1);
    expect(api.wire[0]).toEqual({
      __scrml_error: true, type: "ContactError", variant: "SubmitFailed",
      data: { reason: "message could not be queued" },
    });
    expect(api.get("phase").variant).toBe("Failed");
  });

  // DEFECT 1 (ruled S441): the catch-all arm `| err :>` binds the error VALUE.
  // Pre-fix it bound the envelope's `.data` (the PAYLOAD — `null` for a unit
  // variant), so every message below rendered blank.
  const blocked = test;

  blocked("empty name renders 'Name is required.'", async () => {
    await mount09();
    submitForm();
    await settle();
    expect(errorText()).toBe("Name is required.");
  });

  blocked("empty email renders 'Email is required.'", async () => {
    await mount09();
    setInput('input[type="text"]', "Ada");
    submitForm();
    await settle();
    expect(errorText()).toBe("Email is required.");
  });

  blocked("invalid email renders '<email> is not a valid email address.'", async () => {
    await mount09();
    setInput('input[type="text"]', "Ada");
    setInput('input[type="email"]', "nope");
    submitForm();
    await settle();
    expect(errorText()).toBe("nope is not a valid email address.");
  });

  blocked("server submit failure renders 'Submission failed: message could not be queued'", async () => {
    await mount09({ rejectWrites: true });
    setInput('input[type="text"]', "Ada");
    setInput('input[type="email"]', "ada@example.com");
    setInput("textarea", "hello");
    submitForm();
    await settle();
    expect(errorText()).toBe("Submission failed: message could not be queued");
  });
});
