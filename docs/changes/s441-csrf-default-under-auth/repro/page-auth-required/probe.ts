// Anonymous GET /secret + an anonymous (double-submit-token-carrying) call of the page's server fn.
// usage: bun pageauthprobe.ts <buildOut> <port>
import { spawn } from "child_process";
const [out, port] = process.argv.slice(2);
const srv = spawn("bun", ["_server.js"], { cwd: out, env: { ...process.env, PORT: port }, stdio: "ignore" });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/"); break; } catch { await Bun.sleep(100); } }
for (const p of ["/secret", "/secret.html"]) {
  const r = await fetch(base + p, { redirect: "manual" });
  const t = await r.text();
  console.log(`anon GET ${p} -> ${r.status} secret-marker=${t.includes("secret-marker")}`);
}
const tok = "anon-token";
const r = await fetch(base + "/_scrml/__ri_route_who_1", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": tok, Cookie: `scrml_csrf=${tok}` }, body: "{}" });
console.log(`anon POST /_scrml/__ri_route_who_1 -> ${r.status} ${await r.text()}`);
srv.kill();
process.exit(0);
