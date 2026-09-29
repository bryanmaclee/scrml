// Nested <program auth="required"> inside <program db>: anonymous page GET + anonymous
// (double-submit-token-carrying) POST to the inner program's server fn.
// usage: bun nestedprobe.ts <buildOut> <port>
import { spawn } from "child_process";
import { Database } from "bun:sqlite";
const [out, port] = process.argv.slice(2);
{ const d = new Database(`${out}/c.db`); d.run("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)"); d.close(); }
const srv = spawn("bun", ["_server.js"], { cwd: out, env: { ...process.env, PORT: port }, stdio: "ignore" });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/"); break; } catch { await Bun.sleep(100); } }
const g = await fetch(base + "/app", { redirect: "manual" });
console.log(`anon GET /app -> ${g.status} button=${(await g.text()).includes(">add</button>")}`);
const tok = "anon-token";
const r = await fetch(base + "/_scrml/__ri_route_add_1", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": tok, Cookie: `scrml_csrf=${tok}` }, body: JSON.stringify({ body: "anon-write" }) });
console.log(`anon POST /_scrml/__ri_route_add_1 -> ${r.status} ${await r.text()}`);
console.log("rows", JSON.stringify(new Database(`${out}/c.db`).query("SELECT body FROM notes").all()));
srv.kill();
process.exit(0);
