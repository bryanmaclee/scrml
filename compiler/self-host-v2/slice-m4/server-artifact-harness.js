// server-artifact-harness.js — s468 bootstrap unit U1c: compile a §66 program
// with the bootstrap, print BOTH artifacts (client: print.scrml printProgram;
// server: print-server.scrml printServer), load the server artifact against a
// REAL in-memory SQLite (Bun.SQL — the engine a deployed server runs) or a
// driver spy, and talk to it the way the client does (POST, the CSRF
// double-submit pair, a JSON array of arguments).
//
// Nothing here decides what a program means: it only feeds the artifacts the
// printers produced to the runtimes they were printed for.

import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQL } from "bun";
import { loadM2, frontEnd } from "./harness.js";

const RUNTIME_DIR = join(import.meta.dir, "..", "slice-m1", "runtime");

let modsCache = null;
export function mods() {
  if (modsCache === null) modsCache = loadM2().mods;
  return modsCache;
}

/** The front end over one §66 source (or several files), clean or it throws with every diagnostic. */
export function compile(src, path = "app.scrml") {
  const files = Array.isArray(src) ? src : [{ path, src }];
  const r = frontEnd(mods(), files);
  const errs = r.diags.filter((d) => d.severity !== "Warning" && d.severity !== "Info");
  if (errs.length > 0 || !r.core) {
    throw new Error("the bootstrap front end reported errors:\n" + errs.map((d) => `${d.code} ${d.file}@${d.span.start}: ${d.message}`).join("\n"));
  }
  return r;
}

/** Every diagnostic code the front end reports for `src`. */
export function codes(src, path = "app.scrml") {
  return frontEnd(mods(), [{ path, src }]).diags.map((d) => d.code);
}

/** checkCore's findings for a Core. */
export function check(core) {
  return mods().check.checkCore(core);
}

/** Both artifacts of a lowered Core. */
export function artifacts(core) {
  const m = mods();
  const client = m.print.printProgram(core, "app.client.js", "scrml-runtime.js");
  const server = m["print-server"].printServer(core, "app.server.js", "scrml-server-runtime.js");
  return { client, server };
}

/**
 * Write the server artifact (+ the runtimes it imports) into a fresh directory and import it.
 * Returns the module (`createServer`, `manifest`).
 */
export async function loadServer(serverJs) {
  const dir = mkdtempSync(join(tmpdir(), "u1c-server-"));
  copyFileSync(join(RUNTIME_DIR, "runtime.js"), join(dir, "runtime.js"));
  copyFileSync(join(RUNTIME_DIR, "server-runtime.js"), join(dir, "scrml-server-runtime.js"));
  writeFileSync(join(dir, "app.server.js"), serverJs);
  return await import(join(dir, "app.server.js"));
}

/** A fresh in-memory SQLite (Bun.SQL), set up by `ddl` statements and seeded by `rows`. */
export async function realDb(ddl = [], rows = {}) {
  const sql = new SQL(":memory:");
  for (const s of ddl) await sql.unsafe(s);
  for (const [table, list] of Object.entries(rows)) {
    for (const r of list) {
      const keys = Object.keys(r);
      await sql.unsafe(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => r[k]));
    }
  }
  return sql;
}

/**
 * A driver SPY: a tagged-template function that records every call — the
 * literal runs and the bound values, apart — and answers from `answer(strings, values)`.
 */
export function spyDriver(answer = () => []) {
  const calls = [];
  const fn = (strings, ...values) => {
    calls.push({ strings: [...strings], raw: strings.raw ? [...strings.raw] : null, values });
    return Promise.resolve(answer(strings, values));
  };
  return { fn, calls };
}

// The request / response objects a WinterCG host exchanges, as plain records:
// the server runtime reads a request through `url`, `method`, `headers.get` and
// `text()`, and builds its answer through `host.respond` — so the test is not at
// the mercy of the GLOBAL Request/Response, which happy-dom (registered by the
// client half of these tests) replaces with browser-side classes that drop
// `Cookie` / `Set-Cookie` (forbidden header names in a page script).
function headerBag(h) {
  const m = new Map();
  for (const [k, v] of Object.entries(h ?? {})) m.set(k.toLowerCase(), String(v));
  return { get: (n) => (m.has(String(n).toLowerCase()) ? m.get(String(n).toLowerCase()) : null), entries: () => [...m.entries()] };
}
export function plainRequest(path, method, headers, body) {
  return { url: "http://localhost" + path, method, headers: headerBag(headers), text: async () => (body ?? "") };
}
export function plainRespond(status, headers, body) {
  return { status, headers: headerBag(headers), text: async () => (body === null || body === undefined ? "" : body) };
}

/** A server over `driver` (a Bun.SQL or a spy) — the host injects the connection and builds responses. */
export async function serve(core, driver, logs = []) {
  const { server } = artifacts(core);
  if (server.refused.length > 0) throw new Error("the server printer refused: " + server.refused.join("; "));
  const mod = await loadServer(server.js);
  const srv = mod.createServer({ connect: () => driver, log: (l) => logs.push(l), respond: plainRespond });
  return { srv, mod, js: server.js, routes: server.routes, logs };
}

/** POST a route the way the client does: the CSRF pair, a JSON array of arguments. */
export async function post(srv, path, args, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (opts.csrf !== false) {
    headers.Cookie = "scrml_csrf=tok-1";
    headers["X-CSRF-Token"] = "tok-1";
  }
  const body = opts.method === "GET" ? "" : (opts.raw ?? JSON.stringify(args));
  const res = await srv.fetch(plainRequest(path, opts.method ?? "POST", headers, body));
  const text = await res.text();
  let json;
  try { json = text === "" ? undefined : JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, text, json, headers: res.headers };
}

/** The route path of the server function named `fn` (the manifest — impl-neutral by scrml name). */
export function pathOf(routes, fn) {
  const r = routes.find((x) => x.fn === fn);
  if (!r) throw new Error(`no route for ${fn} (routes: ${routes.map((x) => x.fn).join(", ")})`);
  return r.path;
}

/**
 * Bridge a client artifact's `fetch` to a server artifact's `fetch`, as a browser
 * talks to its origin: the request carries `document.cookie`, a `Set-Cookie`
 * answer is applied to it (the browser's cookie jar — a page script never reads
 * `Set-Cookie` itself).
 */
export function bridge(srv) {
  // a page served from an origin (happy-dom starts at about:blank, where a document has no cookies)
  if (globalThis.happyDOM && globalThis.location && globalThis.location.protocol === "about:") globalThis.happyDOM.setURL("http://localhost/");
  return async (path, init) => {
    const headers = { ...(init.headers ?? {}) };
    const jar = globalThis.document ? globalThis.document.cookie : "";
    if (jar) headers.Cookie = jar;
    const res = await srv.fetch(plainRequest(path, init.method, headers, init.body));
    const set = res.headers.get("Set-Cookie");
    if (set && globalThis.document) globalThis.document.cookie = set.split(";")[0] + "; Path=/";
    return res;
  };
}
