// Execute a compiled f4-nested-* server bundle's `check` handler with REAL
// scrml:auth hashing: hash("right"), then ask check("wrong", hash).
// Usage: bun exec-server.ts <compiled-dir>   → prints the verdict the server returns.
// An accept-all prints "accepted" for the WRONG password.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const serverFile = readdirSync(dir).find((f) => f.endsWith(".server.js"));
if (!serverFile) { console.log("NO SERVER BUNDLE (compile failed?)"); process.exit(0); }
const mod = await import(join(dir, serverFile));
const auth = await import(join(dir, "_scrml", "auth.js"));
const hash = await auth.hashPassword("right");
const route = (mod.routes as Array<{ path: string; handler: (r: Request) => Promise<Response> }>)
  .find((r) => /__ri_route_check_/.test(r.path));
if (!route) { console.log("NO check ROUTE"); process.exit(0); }
async function ask(pw: string): Promise<unknown> {
  const req = new Request("http://localhost" + route!.path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
    body: JSON.stringify({ pw, hash }),
  });
  const res = await route!.handler(req);
  return await res.json();
}
console.log(`wrong-password -> ${JSON.stringify(await ask("wrong"))}   right-password -> ${JSON.stringify(await ask("right"))}`);
