/**
 * §40.2 (S441 ruling "yes on origin check") — the channel WebSocket upgrade refuses
 * a cross-origin handshake.
 *
 * Closes g-ws-upgrade-no-origin-check-cross-site-websocket-hijacking. The upgrade
 * is a GET (outside the CSRF token mechanism) and a browser attaches the session
 * cookie to it, so before this a page on another origin could open an
 * `auth="required"` channel as the signed-in viewer. Measured (S441 review probe):
 * the cross-origin socket drove the author's `onserver:message` handler and relayed
 * a `__sync` write to every subscriber.
 *
 * Driven over a REAL Bun.serve + real WebSocket clients in a child process (the
 * happy-dom globals sibling browser tests install replace WebSocket/Headers).
 *
 * Absent-Origin decision: browsers ALWAYS send Origin on a WebSocket handshake, so
 * a handshake with no Origin is a non-browser client — it cannot ride a victim's
 * ambient cookie, and it is still subject to the channel's session check. Allowed.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const _tmp = perRunTmp(resolve(testDir, "_tmp_ws_origin_check"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

// The S441 review's reproducer: an auth-required channel whose onserver:message
// handler broadcasts what it receives, plus a synced channel cell.
const CHANNEL_APP = `<program db="./c.db" auth="required">
  <channel name="chat" auth="required" onserver:message=onMsg(msg)>
    <count> = 0
    function onMsg(msg) {
      broadcast({ got: msg })
    }
    function tally(delta) {
      broadcast({ total: delta })
    }
  </channel>
  <p>\${@count}</p>
  <button onclick=tally(1)>Tally</button>
</program>
`;

function compileApp(name, src) {
  const dir = resolve(_tmp.root, name);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const input = join(dir, "app.scrml");
  writeFileSync(input, src);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const errors = (r.errors ?? []).filter((e) => !e.code?.startsWith("W-") && !e.code?.startsWith("I-"));
  return { dir, outDir, errors, serverJs: readFileSync(join(outDir, "app.server.js"), "utf-8") };
}

// Child process: serve the emitted module the way the build's _server.js does
// (routes, WS routes get the server handle, `_scrml_ws_handlers` as websocket),
// then open sockets with chosen Origin / Cookie / X-Forwarded-* headers.
const WS_PROBE = `
const outDir = process.argv[2];
process.chdir(outDir);
(globalThis.__scrml_session_store ??= new Map()).set("sid-alice", { userId: 1, role: "user" });
const mod = await import(outDir + "/app.server.js");
const server = Bun.serve({
  port: 0,
  async fetch(req, srv) {
    const u = new URL(req.url);
    for (const r of mod.routes) if (r.path === u.pathname && r.method === req.method) return r.isWebSocket ? r.handler(req, srv) : r.handler(req);
    return new Response("nf", { status: 404 });
  },
  websocket: mod._scrml_ws_handlers,
});
globalThis._scrml_active_server = server;
const src = await Bun.file(outDir + "/app.server.js").text();
const cookie = (src.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid") + "=sid-alice";
const self = "http://localhost:" + server.port;
const url = "ws://localhost:" + server.port + "/_scrml_ws/chat";
const open = (headers) => new Promise((res) => {
  const w = new WebSocket(url, { headers });
  let done = false;
  w.onopen = () => { if (!done) { done = true; res({ state: "OPEN", w }); } };
  w.onerror = () => { if (!done) { done = true; res({ state: "REJECTED" }); } };
  w.onclose = () => { if (!done) { done = true; res({ state: "REJECTED" }); } };
});
const out = {};
// the legitimate viewer: same origin + session cookie
const victim = await open({ Cookie: cookie, Origin: self });
out.sameOrigin = victim.state;
const got = [];
if (victim.w) victim.w.onmessage = (e) => got.push(String(e.data));
// attacker page on another origin, the browser attaching the victim's cookie
const atk = await open({ Cookie: cookie, Origin: "https://evil.example" });
out.crossOriginWithCookie = atk.state;
if (atk.w) { atk.w.send(JSON.stringify({ attacker: "drove onserver:message" })); atk.w.send(JSON.stringify({ __type: "__sync", cell: "count", value: 999 })); }
// same host, other port = another origin
out.otherPort = (await open({ Cookie: cookie, Origin: "http://localhost:1" })).state;
// opaque origin (sandboxed iframe / file://)
out.nullOrigin = (await open({ Cookie: cookie, Origin: "null" })).state;
// scheme downgrade: an http page on this host when the request is https (via proxy header)
out.httpPageOnHttpsRequest = (await open({ Cookie: cookie, Origin: self, "X-Forwarded-Proto": "https" })).state;
// TLS ended at a proxy that sets no X-Forwarded-Proto: https page, http request
out.httpsPageOnHttpRequest = (await open({ Cookie: cookie, Origin: "https://localhost:" + server.port })).state;
// behind a proxy: the browser's host arrives as X-Forwarded-Host
out.proxiedMatching = (await open({ Cookie: cookie, Origin: "https://app.example", "X-Forwarded-Host": "app.example", "X-Forwarded-Proto": "https" })).state;
out.proxiedMismatch = (await open({ Cookie: cookie, Origin: "https://evil.example", "X-Forwarded-Host": "app.example", "X-Forwarded-Proto": "https" })).state;
// non-browser client (no Origin): allowed WITH a session, still refused without one
out.noOriginWithCookie = (await open({ Cookie: cookie })).state;
out.noOriginNoCookie = (await open({})).state;
// channel traffic between two same-origin clients is unaffected
const peer = await open({ Cookie: cookie, Origin: self });
peer.w.send(JSON.stringify({ hello: "from a peer" }));
peer.w.send(JSON.stringify({ __type: "__sync", cell: "count", value: 3 }));
await Bun.sleep(300);
out.victimReceived = got;
// the raw HTTP answer to a cross-origin upgrade
const raw = await fetch(self + "/_scrml_ws/chat", { headers: { Cookie: cookie, Origin: "https://evil.example", Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" } });
out.crossOriginHttpStatus = raw.status;
console.log(JSON.stringify(out));
server.stop(true);
process.exit(0);
`;

function wsProbe(v) {
  const script = join(v.dir, "wsprobe.mjs");
  writeFileSync(script, WS_PROBE);
  const p = Bun.spawnSync(["bun", script, v.outDir], { timeout: 60000 });
  if (p.exitCode !== 0) throw new Error(`ws probe failed: ${p.stderr.toString()}`);
  return JSON.parse(p.stdout.toString().trim().split("\n").pop());
}

describe("§40.2 — the channel WebSocket upgrade refuses a cross-origin handshake", () => {
  test("emission: one Origin helper per server module, called first in the upgrade route", () => {
    const v = compileApp("emit", CHANNEL_APP);
    expect(v.errors).toEqual([]);
    expect((v.serverJs.match(/function _scrml_ws_origin_ok\(req\)/g) || []).length).toBe(1);
    const route = v.serverJs.slice(v.serverJs.indexOf("export const _scrml_route_ws_chat"));
    const originAt = route.indexOf("_scrml_ws_origin_ok(req)");
    const authAt = route.indexOf("_scrml_auth_check(req)");
    const upgradeAt = route.indexOf("server.upgrade(");
    expect(originAt).toBeGreaterThan(-1);
    expect(originAt).toBeLessThan(upgradeAt);
    expect(authAt).toBeLessThan(upgradeAt);
  });

  test("runtime: cross-origin WITH the session cookie is refused; same-origin works; channel traffic unaffected", () => {
    const r = wsProbe(compileApp("runtime", CHANNEL_APP));
    expect(r.sameOrigin).toBe("OPEN");
    expect(r.crossOriginWithCookie).toBe("REJECTED");
    expect(r.crossOriginHttpStatus).toBe(403);
    expect(r.otherPort).toBe("REJECTED");
    expect(r.nullOrigin).toBe("REJECTED");
    expect(r.httpPageOnHttpsRequest).toBe("REJECTED");
    expect(r.httpsPageOnHttpRequest).toBe("OPEN");
    expect(r.proxiedMatching).toBe("OPEN");
    expect(r.proxiedMismatch).toBe("REJECTED");
    expect(r.noOriginWithCookie).toBe("OPEN");
    expect(r.noOriginNoCookie).toBe("REJECTED"); // the channel's session check still applies
    // Nothing the attacker socket tried reached the legitimate viewer…
    expect(r.victimReceived.some((m) => m.includes("attacker") || m.includes("999"))).toBe(false);
    // …while a same-origin peer's message and __sync still broadcast normally.
    expect(r.victimReceived.some((m) => m.includes("from a peer"))).toBe(true);
    expect(r.victimReceived.some((m) => m.includes("__sync") && m.includes('"value":3'))).toBe(true);
  });
});

describe("§40.2 — `scrml dev`'s parent-side Origin rule agrees with the emitted one", () => {
  test("wsOriginAllowed (dev.js) and _scrml_ws_origin_ok (emitted) decide every case the same way", async () => {
    const v = compileApp("parity", CHANNEL_APP);
    const fnSrc = v.serverJs.match(/function _scrml_ws_origin_ok\(req\) \{[\s\S]+?\n\}/)[0];
    // `_scrml_g`: the bundle's host-global alias (S457 2a).
    const emitted = new Function(`const _scrml_g = globalThis;\n${fnSrc}; return _scrml_ws_origin_ok;`)();
    const { wsOriginAllowed } = await import("../../src/commands/dev.js");
    const req = (url, h) => ({ url, headers: { get: (k) => h[String(k).toLowerCase()] ?? null } });
    const cases = [
      ["http://localhost:3000/_scrml_ws/chat", {}, true],
      ["http://localhost:3000/_scrml_ws/chat", { origin: "http://localhost:3000" }, true],
      ["http://localhost:3000/_scrml_ws/chat", { origin: "https://evil.example" }, false],
      ["http://localhost:3000/_scrml_ws/chat", { origin: "http://localhost:3001" }, false],
      ["http://localhost:3000/_scrml_ws/chat", { origin: "null" }, false],
      ["http://localhost:3000/_scrml_ws/chat", { origin: "https://localhost:3000" }, true],
      ["https://app.example/_scrml_ws/chat", { origin: "http://app.example" }, false],
      ["https://app.example/_scrml_ws/chat", { origin: "https://app.example" }, true],
      ["https://app.example:443/_scrml_ws/chat", { origin: "https://APP.example" }, true],
      ["http://127.0.0.1:9/_scrml_ws/chat", { origin: "https://app.example", "x-forwarded-host": "app.example", "x-forwarded-proto": "https" }, true],
      ["http://127.0.0.1:9/_scrml_ws/chat", { origin: "https://evil.example", "x-forwarded-host": "app.example", "x-forwarded-proto": "https" }, false],
      ["http://127.0.0.1:9/_scrml_ws/chat", { origin: "https://app.example", "x-forwarded-host": "app.example, 10.0.0.1", "x-forwarded-proto": "https, http" }, true],
      ["http://localhost:3000/_scrml_ws/chat", { origin: "not a url" }, false],
    ];
    for (const [url, h, want] of cases) {
      const r = req(url, h);
      expect([url, h, emitted(r)]).toEqual([url, h, want]);
      expect([url, h, wsOriginAllowed(r, new URL(url))]).toEqual([url, h, want]);
    }
  });
});
