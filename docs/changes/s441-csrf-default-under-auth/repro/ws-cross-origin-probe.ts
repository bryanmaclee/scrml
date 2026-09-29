// S441 reproducer probe (g-ws-upgrade-no-origin-check-cross-site-websocket-hijacking) — authored by the
// S441 PA security review. usage: bun ws-cross-origin-probe.ts <compiled out dir of ws-channel-under-auth.scrml>
const out = process.argv[2];
process.chdir(out);
const mod = await import(out + "/app.server.js");
(globalThis.__scrml_session_store ??= new Map()).set("sid-alice", { userId: 1, role: "user" });
const server = Bun.serve({ port: 0,
  async fetch(req, srv) {
    const u = new URL(req.url);
    for (const r of mod.routes) if (r.path === u.pathname && r.method === req.method) { const res = await r.handler(req, srv); return res; }
    return new Response("nf", { status: 404 });
  },
  websocket: mod._scrml_ws_handlers });
globalThis._scrml_active_server = server;
const url = "ws://localhost:" + server.port + "/_scrml_ws/chat";
// victim-side subscriber (legit client) to observe the broadcast
const got = [];
const victim = new WebSocket(url, { headers: { Cookie: "__Host-scrml_sid=sid-alice", Origin: "http://localhost:" + server.port } });
victim.onmessage = (e) => got.push(String(e.data));
await new Promise(r => victim.onopen = r);
// anonymous cross-origin attempt (no cookie)
const anon = await new Promise((res) => { const w = new WebSocket(url, { headers: { Origin: "https://evil.example" } }); w.onopen = () => { res("OPEN"); w.close(); }; w.onerror = () => res("REJECTED"); w.onclose = () => res("CLOSED"); });
// cross-origin WITH ambient session cookie (the browser attaches it if SameSite allows)
const atk = new WebSocket(url, { headers: { Cookie: "__Host-scrml_sid=sid-alice", Origin: "https://evil.example" } });
const st = await new Promise((res) => { atk.onopen = () => res("OPEN"); atk.onerror = () => res("REJECTED"); });
if (st === "OPEN") {
  atk.send(JSON.stringify({ attacker: "drove onserver:message" }));
  atk.send(JSON.stringify({ __type: "__sync", cell: "count", value: 999 }));
}
await Bun.sleep(300);
console.log(JSON.stringify({ anonCrossOrigin: anon, cookieCrossOrigin: st, victimReceived: got }));
server.stop(true); process.exit(0);
