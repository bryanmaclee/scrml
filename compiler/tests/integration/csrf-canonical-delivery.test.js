/**
 * Canonical CSRF-token delivery + the /_scrml/session projection endpoint
 * (scrml, change-id csrf-canonical-session-projection-2026-07-04).
 *
 * Builds ON the S238 auth-path CSRF synchronizer-token landing. S238 delivered
 * the token via a 403 + Set-Cookie retry on the first mutating POST. This wave
 * adds the SPEC-canonical §39.2.3 delivery vehicles so the FIRST POST already
 * carries the token (no 403), keeping the 403-retry as a fallback:
 *
 *  D1 (/_scrml/session GET projection). The client's `@session` reactive
 *     projection does `fetch('/_scrml/session')` on load; there was no server
 *     GET handler → `@session` resolved null (g-session-projection-no-server-
 *     handler). We emit the handler (sibling of _scrml_session_destroy); it
 *     returns { isAuth, userId, role } plus `csrfToken` when csrf="auto".
 *
 *  D2 (<meta name="csrf-token">). An empty placeholder is emitted into the
 *     static head for an auth + csrf="auto" app; the request-time HTML-
 *     composition route (§52.8 compose handler, now also emitted for auth+csrf
 *     with no SSR seed) fills it with the loading viewer's session synchronizer
 *     token. Per-session, so it cannot be baked into the static file.
 *
 *  D3 (client reads the meta first). `_scrml_get_csrf_token()` prefers the meta
 *     tag over the cookie, so the first mutating POST carries the right token.
 *
 * Server validation is UNCHANGED (header === session.csrfToken) — the server is
 * the authoritative synchronizer; a forged/absent token still 403s.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
const TMP_ROOT = resolve(testDir, "_tmp_csrf_canonical");
let tmpCounter = 0;

beforeAll(() => {
  // Recurrence-proof isolation (a killed / --bail'd prior run skips afterAll).
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

const ITEMS_SEED = {
  "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"],
};

function compile(scrmlSource, testName, seedFiles = ITEMS_SEED) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const db = new Database(resolve(tmpDir, fileName), { create: true });
    for (const s of stmts) db.exec(s);
    db.close();
  }
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = join(outDir, `${tag}.client.js`);
  const htmlPath = join(outDir, `${tag}.html`);
  return {
    tag,
    errors: result.errors ?? [],
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf-8") : null,
    serverJs: readFileSync(join(outDir, `${tag}.server.js`), "utf-8"),
    serverJsPath: join(outDir, `${tag}.server.js`),
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf-8") : null,
    tmpDir,
  };
}

const nonWarn = (errors) => errors.filter((e) => !e.code?.startsWith("W-") && !e.code?.startsWith("I-"));

const AUTH_CSRF_SRC = `<program auth="required" csrf="auto">
<db src="./items.db" tables="items">
  \${
    export server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

const AUTH_NOCSRF_SRC = `<program auth="required" csrf="off">
<db src="./items.db" tables="items">
  \${
    export server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

const BASELINE_SRC = `<program>
<db src="./items.db" tables="items">
  \${
    server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

describe("D1 — /_scrml/session GET projection handler", () => {
  test("server emits the projection route (sibling of session.destroy)", () => {
    const { serverJs, errors } = compile(AUTH_CSRF_SRC, "d1-emit");
    expect(nonWarn(errors)).toEqual([]);
    expect(serverJs).toContain("export const _scrml_session_projection = {");
    expect(serverJs).toContain('path: "/_scrml/session",');
    expect(serverJs).toMatch(/_scrml_session_projection[\s\S]+?method: "GET"/);
    // csrf=auto → the projection carries csrfToken.
    expect(serverJs).toContain("csrfToken: _s.csrfToken");
  });

  test("csrf=off auth app STILL emits the projection (so @session resolves) but WITHOUT csrfToken", () => {
    const { serverJs, errors } = compile(AUTH_NOCSRF_SRC, "d1-off");
    expect(nonWarn(errors)).toEqual([]);
    expect(serverJs).toContain("export const _scrml_session_projection = {");
    const proj = serverJs.match(/export const _scrml_session_projection = \{[\s\S]+?\n\};/)[0];
    expect(proj).not.toContain("csrfToken");
  });

  test("baseline (no-auth) app emits NO /_scrml/session route", () => {
    const { serverJs, errors } = compile(BASELINE_SRC, "d1-baseline");
    expect(nonWarn(errors)).toEqual([]);
    expect(serverJs).not.toContain("_scrml_session_projection");
    expect(serverJs).not.toContain('path: "/_scrml/session"');
  });
});

describe("D2 — <meta name=csrf-token> placeholder + request-time fill", () => {
  test("static HTML head carries the empty placeholder (auth + csrf=auto)", () => {
    const { html, errors } = compile(AUTH_CSRF_SRC, "d2-html");
    expect(nonWarn(errors)).toEqual([]);
    expect(html).toContain('<meta name="csrf-token" content="">');
  });

  test("csrf=off + baseline emit NO meta tag", () => {
    const off = compile(AUTH_NOCSRF_SRC, "d2-off");
    const base = compile(BASELINE_SRC, "d2-base");
    expect(off.html).not.toContain("csrf-token");
    expect(base.html).not.toContain("csrf-token");
  });

  test("the SSR compose route is emitted for auth+csrf even with no server-authority seed", () => {
    const { serverJs } = compile(AUTH_CSRF_SRC, "d2-compose");
    expect(serverJs).toContain("_scrml_ssr_compose_handler");
    expect(serverJs).toContain("export const _scrml_route___ssr = {");
    // It fills the meta placeholder with the session token, and — with no seed —
    // emits no window.__scrml_ssr_state scaffolding.
    expect(serverJs).toContain('<meta name="csrf-token" content="">');
    expect(serverJs).not.toContain("const _scrml_ssr_state = {};");
  });
});

describe("D3 — client reads the meta token first", () => {
  test("_scrml_get_csrf_token prefers the meta tag, then the cookie", () => {
    const { clientJs } = compile(AUTH_CSRF_SRC, "d3-order");
    const fn = clientJs.match(/function _scrml_get_csrf_token\(\) \{[\s\S]+?\n\}/)[0];
    const metaIdx = fn.indexOf('meta[name="csrf-token"]');
    const cookieIdx = fn.indexOf("document.cookie.match");
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(cookieIdx).toBeGreaterThanOrEqual(0);
    expect(metaIdx).toBeLessThan(cookieIdx);
  });

  test("eval: returns the meta token over the cookie; falls back to cookie when no meta", () => {
    const { clientJs } = compile(AUTH_CSRF_SRC, "d3-eval");
    const fn = clientJs.match(/function _scrml_get_csrf_token\(\) \{[\s\S]+?\n\}/)[0];
    const getToken = new Function("document", `${fn}; return _scrml_get_csrf_token();`);
    const withMeta = { querySelector: () => ({ getAttribute: () => "META-TOK" }), cookie: "scrml_csrf=COOKIE-TOK" };
    expect(getToken(withMeta)).toBe("META-TOK");
    const noMeta = { querySelector: () => null, cookie: "scrml_csrf=COOKIE-TOK" };
    expect(getToken(noMeta)).toBe("COOKIE-TOK");
  });
});

describe("end-to-end — first POST with the delivered token PASSES (no 403); fallback still 403s", () => {
  test("projection + meta fill deliver the session token; a POST carrying it passes; forged/absent 403", async () => {
    // happy-dom-polluted globals (loaded by sibling browser tests in the full
    // suite) STRIP the forbidden Cookie header from Request, so scrml_sid never
    // reaches the middleware and the auth-check 302s before CSRF. Guard: run the
    // runtime round-trip only under bun's native Request. Mirrors the S238 test.
    if (typeof globalThis.document !== "undefined") return;

    const { serverJsPath, tmpDir, errors } = compile(AUTH_CSRF_SRC, "e2e");
    expect(nonWarn(errors)).toEqual([]);

    const absDbPath = resolve(tmpDir, "items.db");
    writeFileSync(
      serverJsPath,
      readFileSync(serverJsPath, "utf-8").replace(
        'const _scrml_sql = new SQL("sqlite:./items.db");',
        `const _scrml_sql = new SQL(${JSON.stringify("sqlite:" + absDbPath)});`,
      ),
    );

    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const store = globalThis.__scrml_session_store;
    const SID = `sid-${Math.random().toString(36).slice(2)}`;
    store.set(SID, { userId: 7, role: "user" });
    const cookie = `scrml_sid=${SID}`;

    const routes = mod.routes;
    const sessionRoute = routes.find((r) => r.path === "/_scrml/session");
    const composeRoute = routes.find((r) => r.method === "GET" && r.path !== "/_scrml/session" && !r.path.startsWith("/_scrml/"));
    const mutRoute = routes.find((r) => r.path.includes("addItem"));
    const statusOf = (r) => (r instanceof Response ? r.status : null);

    // D1 runtime — projection returns the session identity + token.
    const sResp = await sessionRoute.handler(new Request("http://localhost/_scrml/session", { headers: { Cookie: cookie } }));
    const sBody = await sResp.json();
    const sessionToken = store.get(SID).csrfToken;
    expect(sBody.isAuth).toBe(true);
    expect(sBody.userId).toBe(7);
    expect(sBody.role).toBe("user");
    expect(sBody.csrfToken).toBe(sessionToken);

    // Anonymous projection — isAuth false, csrfToken null (no session record).
    const anon = await sessionRoute.handler(new Request("http://localhost/_scrml/session", {}));
    const anonBody = await anon.json();
    expect(anonBody.isAuth).toBe(false);
    expect(anonBody.csrfToken).toBe(null);

    // D2 runtime — the compose route fills the meta with the session token.
    const cResp = await composeRoute.handler(new Request(`http://localhost${composeRoute.path}`, { headers: { Cookie: cookie } }));
    expect((cResp.headers.get("Content-Type") || "")).toContain("text/html");
    const html = await cResp.text();
    const meta = html.match(/<meta name="csrf-token" content="([^"]*)">/);
    expect(meta).toBeTruthy();
    expect(meta[1]).toBe(sessionToken);
    expect(html).not.toContain('<meta name="csrf-token" content="">');
    // No SSR-state scaffolding on a csrf-only compose route.
    expect(html).not.toContain("window.__scrml_ssr_state");

    // Anonymous first paint → the meta stays empty (no session token to inject).
    const anonCompose = await composeRoute.handler(new Request(`http://localhost${composeRoute.path}`, {}));
    expect(await anonCompose.text()).toContain('<meta name="csrf-token" content="">');

    // D3 integration — a first POST carrying the delivered token PASSES (no 403).
    const postWith = (headers) => new Request(`http://localhost${mutRoute.path}`, { method: "POST", headers, body: JSON.stringify({ name: "delivered" }) });
    const rPass = await mutRoute.handler(postWith({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": meta[1] }));
    expect(statusOf(rPass)).not.toBe(403);
    expect(rPass).toBe("ok");

    // Adversarial — a forged token still 403s (server-authoritative synchronizer).
    const rForged = await mutRoute.handler(postWith({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": "forged" }));
    expect(statusOf(rForged)).toBe(403);

    // Fallback — an absent token 403s AND plants the token via Set-Cookie so the
    // single-shot client retry (S238) recovers.
    const rAbsent = await mutRoute.handler(postWith({ "Content-Type": "application/json", Cookie: cookie }));
    expect(statusOf(rAbsent)).toBe(403);
    expect(rAbsent.headers.get("Set-Cookie") || "").toMatch(/scrml_csrf=/);

    // The delivered-token mutation actually inserted the row.
    const db = new Database(absDbPath);
    const rows = db.query("SELECT name FROM items").all();
    db.close();
    expect(rows.some((x) => x.name === "delivered")).toBe(true);
  });
});
