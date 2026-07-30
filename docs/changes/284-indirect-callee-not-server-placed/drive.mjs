import { Database } from "bun:sqlite";
const db = new Database("./i284.db");
db.run("delete from entries");
db.run("insert into entries (id, job, amount) values (1,'roofing',100.0),(2,'siding',250.0)");
db.close();

const mod = await import("./outA3/symptomA3.server.js");
const tok = "t0k3n";
const req = new Request("http://localhost/_scrml/__ri_route_loadAdjustEntries_1", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Cookie": `scrml_csrf=${tok}`, "X-CSRF-Token": tok },
  body: JSON.stringify({ which: "job" }),
});
try {
  const res = await mod.__ri_route_loadAdjustEntries_1.handler(req);
  console.log("HTTP", res.status);
  console.log("BODY", await res.text());
} catch (e) {
  console.log("THREW:", e.constructor.name + ":", e.message);
}
