// =============================================================================
// scrml bootstrap SERVER runtime — unit U1c (the server half of the server
// boundary). TARGET code: the JavaScript a server artifact printed by
// compiler/self-host-v2/print-server.scrml runs against. It is not compiler code.
//
// Design authority: scrml-support/docs/deep-dives/bootstrap-u1-server-boundary-
// design-2026-10-03.md §4 ("Server artifact = a factory, not a module with
// globals"), §5 ("Lower (U1c)"), and the S467 §13 amendment; the wire contract
// is the U1b design's Item 3 (bootstrap-u1b-client-server-call-design-
// 2026-10-04.md), whose CLIENT half is runtime.js `call` / `classify`.
//
// What lives here, each in ONE place:
//   - `connection(host, desc)` — one per database a program declares, built by
//     `createServer(host)`: the host INJECTS the driver (`host.connect(desc)`,
//     a Bun.SQL-shaped tagged-template function), so nothing is a module-level
//     global shared by every request (design §4, "Injected connection").
//   - `query(conn, mode, text, params, slots)` — a `?{}` (SPEC §8): the SQL text is a
//     frozen template (`sqlText`) and the values travel ONLY as the driver's
//     bound parameters — there is no path on which a value becomes SQL text
//     (§8.1, E-SQL-001 unrepresentable). A driver failure is a VALUE: a Failure
//     whose error is a `SqlError` variant (§19.8.1), plus a server log line.
//   - `route(desc, run)` + `server(host, routes)` — every compiler-internal
//     route through one handler: method, the §39.2.3 baseline double-submit CSRF
//     check, a STRICT decode of the arguments (§57.4 R10: malformed → 400, the
//     body never runs), the body, the encode of its answer (200 + the value, 204
//     for a function that yields no value, or the §19.9.1 / §57.8 `fail`
//     envelope with the §19.9.2 status) — and a COMPLETE response on every path
//     (§12.5.3), including an exception (500, a fixed text; the reason goes to
//     the server log, never to the client).
//
// The server bodies themselves are plain async JavaScript: Core's
// `Stmt.Suspend` prints as `await` (and nothing else does), so this module
// never decides what to await (S467 §13 gate item 1).
// =============================================================================

import { encode, decode, failure, failed, runDefers, eq, CodecDefect, CSRF_COOKIE, CSRF_HEADER } from "./runtime.js";

// What printed server bodies call through `rt.` (print.scrml prints them for
// both artifacts): a failure value, the test for one, the `defer` stack, and
// structural equality (§45).
export { failure, failed, runDefers, eq };

// ---------------------------------------------------------------------------
// SQL text. A query site's literal runs, frozen once at module load, in the
// shape a tagged-template driver takes (an array with `raw`): Bun.SQL refuses a
// plain array as a template (it reads it as a value list).
// ---------------------------------------------------------------------------
export function sqlText(chunks) {
  const strings = [...chunks];
  Object.defineProperty(strings, "raw", { value: Object.freeze([...chunks]), enumerable: false });
  return Object.freeze(strings);
}

// ---------------------------------------------------------------------------
// Connections (§8.1.1 / §44.2). `desc` = { driver: "sqlite" | "postgres" |
// "mysql", target, file }: `target` is the connection value with any `sqlite:`
// prefix removed, `file` the project-relative path of the declaring file (a
// relative SQLite path resolves against ITS directory, §8.1.1 "Resolution
// base"). The driver is opened lazily, once, on the first query.
// ---------------------------------------------------------------------------
export function connection(host, desc) {
  let sql = null;
  return {
    desc,
    open() {
      if (sql === null) sql = connectWith(host, desc);
      return sql;
    },
    log(line) { logLine(host, line); },
  };
}

function connectWith(host, desc) {
  if (host && typeof host.connect === "function") return host.connect(desc);
  // The default host: Bun's SQL client — the engine a deployed server runs.
  const SQL = globalThis.Bun && globalThis.Bun.SQL;
  if (typeof SQL !== "function") throw new Error("scrml server: no database driver — pass `host.connect(desc)` to createServer");
  if (desc.driver === "sqlite") {
    if (desc.target === ":memory:") return new SQL(":memory:");
    return new SQL("sqlite://" + resolveSqlitePath(host, desc));
  }
  return new SQL(desc.target);
}

function resolveSqlitePath(host, desc) {
  const t = desc.target;
  if (t.startsWith("/")) return t;
  const root = host && typeof host.root === "string" ? host.root : (globalThis.process ? globalThis.process.cwd() : ".");
  const dir = desc.file.includes("/") ? desc.file.slice(0, desc.file.lastIndexOf("/")) : "";
  const parts = [root, dir, t].filter((s) => s !== "");
  return parts.join("/").replace(/\/\.\//g, "/");
}

function logLine(host, line) {
  if (host && typeof host.log === "function") {
    try { host.log(line); } catch { /* a logger must not take the request down */ }
    return;
  }
  globalThis.console.error(line);
}

// ---------------------------------------------------------------------------
// A query (§8.3): `mode` "all" → the rows (an array of plain objects), "get"
// → the first row or `not` (null), "run" → nothing (null). "No row" is not a
// failure (§19.8.3). A driver error is the Failure the query's Attempt
// inspects — its error a `SqlError` value (§19.8.1: QueryFailed(message),
// ConstraintViolation(field), ConnectionLost), in the runtime's enum shape
// (a unit variant is its name; a payload variant `{ variant, data: [...] }`).
// The message stays on the server: it reaches a client only if the author's
// own code returns it.
// ---------------------------------------------------------------------------
// `params`: each DISTINCT value, evaluated once (§8.2); `slots[i]`: the param the
// template's i-th `${}` binds (core.scrml SqlQuery — C-SQL1 lines them up).
export async function query(conn, mode, text, params, slots) {
  let rows;
  try {
    const values = slots.map((i) => params[i]);
    const sql = conn.open();
    rows = await sql(text, ...values);
  } catch (e) {
    const err = sqlErrorOf(e);
    conn.log(`scrml server: a query on ${conn.desc.driver}:${conn.desc.file} failed — ${messageOf(e)}`);
    return failure(err);
  }
  if (mode === "run") return null;
  const list = [];
  for (const r of rows ?? []) list.push(plainRow(r));
  if (mode === "get") return list.length > 0 ? list[0] : null;
  return list;
}

// A row as a value: a fresh plain object of the row's own columns.
function plainRow(r) {
  const out = {};
  if (r === null || typeof r !== "object") return out;
  for (const k of Object.keys(r)) {
    Object.defineProperty(out, k, { value: r[k], enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function messageOf(e) {
  try { return String(e && e.message !== undefined ? e.message : e); } catch { return "an error"; }
}

const CONNECTION_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE",
  "ERR_POSTGRES_CONNECTION_CLOSED", "ERR_POSTGRES_CONNECTION_TIMEOUT", "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_MYSQL_CONNECTION_CLOSED", "ERR_MYSQL_CONNECTION_TIMEOUT",
  "SQLITE_CANTOPEN", "SQLITE_NOTADB", "SQLITE_IOERR",
]);

// §19.8.1's variants, by the driver's error code (SQLite's `SQLITE_CONSTRAINT*`,
// Postgres class 23 — integrity constraint violation).
export function sqlErrorOf(e) {
  const code = e && typeof e.code === "string" ? e.code : "";
  const msg = messageOf(e);
  if (code.startsWith("SQLITE_CONSTRAINT") || /^23\d\d\d$/.test(code)) {
    const m = /constraint failed: (.*)$/.exec(msg);
    let field = m ? m[1] : "";
    if (field === "" && e && typeof e.column === "string") field = e.column;
    if (field === "" && e && typeof e.constraint === "string") field = e.constraint;
    return { variant: "ConstraintViolation", data: [field] };
  }
  if (CONNECTION_CODES.has(code) || [...CONNECTION_CODES].some((c) => code.startsWith(c))) return "ConnectionLost";
  return { variant: "QueryFailed", data: [msg] };
}

// ---------------------------------------------------------------------------
// The §19.9.1 / §57.8 `fail` envelope: the error value encoded as the same
// variant would be as a value (`"V"` or `{ variant, data: {field: v} }`), plus
// `__scrml_error: true` and `type` (the enum's name). The client decodes it
// strictly against the callee's declared enum (runtime.js `decodeError`).
// ---------------------------------------------------------------------------
export function encodeError(table, value) {
  const root = table && table.root;
  if (root === null || typeof root !== "object" || root.k !== "ref") throw new CodecDefect("codec: encodeError needs a table whose root is an enum ref");
  const d = table.defs[root.def];
  if (d === undefined || d.k !== "enum") throw new CodecDefect("codec: encodeError against a def that is not an enum");
  const r = encode(table, value);
  if (!r.ok) return r;
  const w = r.wire;
  if (typeof w === "string") return { ok: true, wire: { __scrml_error: true, type: d.name, variant: w, data: {} } };
  return { ok: true, wire: { __scrml_error: true, type: d.name, variant: w.variant, data: w.data } };
}

// §19.9.2: the status of a `fail` response. The bootstrap has no `httpStatus`
// attribute on a variant, so the heuristic decides, on the variant's NAME
// (case-insensitive): NotFound → 404; Auth / Forbidden / Unauthorized → 403;
// Validation / Invalid → 400; otherwise 500. (Every declared variant is >= 400
// — the U1b wire contract: a 2xx envelope is Malformed on the client.)
export function failStatus(variant) {
  const v = String(variant).toLowerCase();
  if (v.includes("notfound")) return 404;
  if (v.includes("auth") || v.includes("forbidden") || v.includes("unauthorized")) return 403;
  if (v.includes("validation") || v.includes("invalid")) return 400;
  return 500;
}

// ---------------------------------------------------------------------------
// §39.2.3 baseline double-submit CSRF ("without `auth=`, baseline
// double-submit cookie helpers are auto-emitted on routes that mutate state").
// Every compiler-internal route is a POST, so every one is checked: the
// `scrml_csrf` cookie and the `X-CSRF-Token` header must both be present and
// equal. A request that fails gets 403 (not an envelope — the client reads it
// as Transport(Refused(403))) and a cookie to retry with; the client runtime
// retries ONCE with it (runtime.js `call`).
// ---------------------------------------------------------------------------
// (The pair's names are ONE definition, runtime.js — the client sends what this checks.)
export { CSRF_COOKIE, CSRF_HEADER };

function cookieValue(header, name) {
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

// Equal strings in time that does not depend on where they first differ.
function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function freshToken() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Responses — every path ends in one of these (§12.5.3: "a COMPLETE HTTP
// RESPONSE, not a bare value"). The host builds the response object
// (`host.respond(status, headers, body)`), as it supplies the driver: a WinterCG
// host — Bun.serve, the default — is answered with its own `Response`; a test
// host can stand in a plain one. (§12.5.3 binds the artifact's observable
// behaviour, not a JS shape — S278.)
// ---------------------------------------------------------------------------
function respond(host, status, headers, body) {
  if (host && typeof host.respond === "function") return host.respond(status, headers, body);
  return new globalThis.Response(body, { status, headers });
}

function jsonResponse(host, status, body, extra) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (extra) Object.assign(headers, extra);
  return respond(host, status, headers, JSON.stringify(body));
}

function noContent(host) {
  return respond(host, 204, { "Cache-Control": "no-store" }, null);
}

const FIXED = {
  400: { error: "Bad Request" },
  403: { error: "Forbidden" },
  404: { error: "Not Found" },
  405: { error: "Method Not Allowed" },
  500: { error: "Internal Server Error" },
};

// A route: its wire descriptor (the SAME table the client artifact's
// `route$<fn>` constant holds — print.scrml `routeJs`, one function for both
// ends) and the function that runs its body with the decoded arguments.
export function route(desc, run) {
  return { path: desc.path, desc, run };
}

// The server a `createServer(host)` returns: its routes, and `fetch(request)`
// — a WinterCG handler (Bun.serve's `fetch`, or a test calling it directly).
// The request is read through `url`, `method`, `headers.get(name)` and `text()`
// only.
export function server(host, routes) {
  const byPath = new Map();
  for (const r of routes) byPath.set(r.path, r);
  return {
    routes: routes.map((r) => ({ path: r.path, method: "POST" })),
    async fetch(request) {
      let path;
      try { path = new URL(request.url, "http://localhost").pathname; } catch { return jsonResponse(host, 400, FIXED[400]); }
      const r = byPath.get(path);
      if (r === undefined) return jsonResponse(host, 404, FIXED[404]);
      try {
        return await handle(host, r, request);
      } catch (e) {
        // a defect in this module or the host (never a scrml failure — those are values)
        logLine(host, `scrml server: ${path} — ${messageOf(e)}`);
        return jsonResponse(host, 500, FIXED[500]);
      }
    },
  };
}

async function handle(host, r, request) {
  if (request.method !== "POST") return jsonResponse(host, 405, FIXED[405], { Allow: "POST" });
  // CSRF first: an unproven request runs nothing, decodes nothing.
  const cookie = cookieValue(request.headers.get("Cookie"), CSRF_COOKIE);
  const header = request.headers.get(CSRF_HEADER) ?? "";
  if (!sameToken(cookie, header)) {
    const tok = cookie !== "" ? cookie : freshToken();
    return jsonResponse(host, 403, FIXED[403], { "Set-Cookie": `${CSRF_COOKIE}=${encodeURIComponent(tok)}; Path=/; SameSite=Strict` });
  }
  // The arguments: a JSON ARRAY, one per parameter, each STRICTLY decoded
  // against its parameter's table (§57.4 R10). Anything else is 400 and the
  // body never runs.
  let text;
  try { text = await request.text(); } catch { return jsonResponse(host, 400, FIXED[400]); }
  let wire;
  try { wire = JSON.parse(text); } catch { return jsonResponse(host, 400, FIXED[400]); }
  const params = r.desc.params;
  if (!Array.isArray(wire) || wire.length !== params.length) return jsonResponse(host, 400, FIXED[400]);
  const args = [];
  for (let i = 0; i < params.length; i++) {
    const d = decode(params[i], wire[i], { canonicalOnly: true });
    if (!d.ok) return jsonResponse(host, 400, FIXED[400]);
    args.push(d.value);
  }
  let result;
  try {
    result = await r.run(args);
  } catch (e) {
    logLine(host, `scrml server: ${r.path} threw — ${messageOf(e)}`);
    return jsonResponse(host, 500, FIXED[500]);
  }
  if (failed(result)) {
    if (r.desc.error === null) {
      logLine(host, `scrml server: ${r.path} returned a failure but declares no error type`);
      return jsonResponse(host, 500, FIXED[500]);
    }
    const env = encodeError(r.desc.error, result.error);
    if (!env.ok) {
      logLine(host, `scrml server: ${r.path} — its error does not encode (${env.error.reason})`);
      return jsonResponse(host, 500, FIXED[500]);
    }
    return jsonResponse(host, failStatus(env.wire.variant), env.wire);
  }
  if (r.desc.result === null) return noContent(host);
  const out = encode(r.desc.result, result);
  if (!out.ok) {
    logLine(host, `scrml server: ${r.path} — its answer does not encode (${out.error.reason})`);
    return jsonResponse(host, 500, FIXED[500]);
  }
  return jsonResponse(host, 200, out.wire);
}
