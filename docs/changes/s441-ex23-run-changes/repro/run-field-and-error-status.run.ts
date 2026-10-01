// s441-ex23-run-changes repro (verified on 5c366fe15). Setup, from this dir:
//   bun -e 'import {Database} from "bun:sqlite"; const d=new Database("app.db",{create:true}); d.exec("CREATE TABLE items (id integer primary key, name text not null, used_at text)"); d.exec("INSERT INTO items (id,name) VALUES (1,\"a\")")'
//   bun ../../../../compiler/bin/scrml.js compile run-field-and-error-status.scrml -o dist
//   bun run-field-and-error-status.run.ts
// Expect today: (a) both consumes "ok"; (b) every failure variant at HTTP 200.
import { resolve } from "path";
process.chdir(import.meta.dir);
const m = await import(resolve(import.meta.dir, "dist/run-field-and-error-status.server.js"));
const find = (n: string) => m.routes.find((r: any) => r.path.includes(`__ri_route_${n}_`));
const CSRF = "t";
async function call(r: any, body: any) {
  const res: Response = await r.handler(new Request(`http://localhost${r.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF, "Cookie": `scrml_csrf=${CSRF}` },
    body: JSON.stringify(body),
  }));
  return `${res.status} ${await res.text()}`;
}
const consume = find("consume"), findItem = find("findItem");
console.log("(a) consume(1) 1st:", await call(consume, { id: 1 }));
console.log("(a) consume(1) 2nd (row already used):", await call(consume, { id: 1 }));
console.log("(b) findItem(1) ok:", await call(findItem, { id: 1 }));
console.log("(b) findItem(2) NotFound   (SPEC 404):", await call(findItem, { id: 2 }));
console.log("(b) findItem(-1) InvalidInput (SPEC 400):", await call(findItem, { id: -1 }));
console.log("(b) findItem(99) Forbidden (SPEC 403):", await call(findItem, { id: 99 }));
process.exit(0);
