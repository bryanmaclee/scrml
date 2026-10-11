/**
 * S465 — SPEC §19.9.9.8 rule 4: "Statements before the function's first server
 * statement are never moved: `@busy = true` ahead of the query renders before the
 * request leaves."
 *
 * Before S465 a client local declared ahead of the first server statement and read
 * by it was pulled into the server batch — and with it every statement reading that
 * local. `const n = @clicks + 1; @clicks = n; ?{INSERT … ${n}}.run()` ran BOTH
 * earlier statements on the server: the optimistic `@clicks` update appeared only
 * after the response. `const draft = localStorage.getItem("draft")` ahead of the
 * query was refused (E-RI-002) with a message claiming it would send `draft` "to the
 * browser" — `draft` IS browser data.
 *
 * Now those statements stay in the browser and the locals the server work reads are
 * carried into the request like parameters (`carriedLocals`). A shape that cannot be
 * carried is refused with an E-RI-002 that describes the real reason.
 *
 * Every program below is compiled; the server route is driven over a Request against
 * a real bun:sqlite database, and the browser half runs in happy-dom with a fetch
 * that holds the request open, so the test sees what the page shows WHILE the
 * request is in flight.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const T = 30_000;
const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function build(src) {
  const dir = mkdtempSync(join(tmpdir(), "s465-rule4-"));
  dirs.push(dir);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE notes (s TEXT)");
  db.close();
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  return { dir, outDir, file, result, errors };
}

function rows(dir) {
  const db = new Database(join(dir, "app.db"));
  try { return db.query("SELECT s FROM notes").all().map((r) => String(r.s)); } finally { db.close(); }
}

async function callRoute(outDir, fn, body) {
  const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => new RegExp(`__ri_route_${fn}_\\d+$`).test(r.path));
  expect(route).toBeDefined();
  const res = await mod.fetch(new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, text: await res.text() };
}

/**
 * Run the page in happy-dom, click `#go`, and snapshot `#out` while the request is
 * held open. Returns { during, after, sent } — the text before the response, after
 * it, and the parsed request body.
 */
async function runHeld(outDir, setup = () => {}) {
  const html = await Bun.file(join(outDir, "app.html")).text();
  const clientJs = await Bun.file(join(outDir, "app.client.js")).text();
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  try {
    const g = globalThis;
    const RealResponse = g.Response;
    let release;
    const gate = new Promise((r) => { release = r; });
    let sent = null;
    g.fetch = async (_url, init) => {
      sent = JSON.parse(init.body);
      await gate;
      return new RealResponse("null", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    setup(g);
    const bodyHtml = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) ?? [null, html])[1];
    g.document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    (0, eval)("(function () {\n" + SCRML_RUNTIME + "\n" + clientJs + "\n})();");
    g.document.dispatchEvent(new g.Event("DOMContentLoaded", { bubbles: true }));
    g.document.querySelector("#go").click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
    const during = g.document.querySelector("#out").textContent.trim();
    release();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
    const after = g.document.querySelector("#out").textContent.trim();
    return { during, after, sent };
  } finally {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  }
}

const OPTIMISTIC = `<program db="./app.db">
<clicks> = 0
function save() {
  const n = @clicks + 1
  @clicks = n
  ?{\`INSERT INTO notes (s) VALUES (\${n})\`}.run()
}
<button id="go" onclick={ save() }>save</button>
<p id="out">\${@clicks}</p>
</program>
`;

const DRAFT = `<program db="./app.db">
<busy> = false
function save() {
  const draft = localStorage.getItem("draft")
  @busy = true
  ?{\`INSERT INTO notes (s) VALUES (\${draft})\`}.run()
  @busy = false
}
<button id="go" onclick={ save() }>save</button>
<p id="out">\${@busy}</p>
</program>
`;

describe("§19.9.9.8 rule 4 — the optimistic update stays in the browser", () => {
  test("compiles clean; the server batch binds `n` from the request and does not touch `@clicks`", () => {
    const { errors, outDir } = build(OPTIMISTIC);
    expect(errors.map((e) => e.code)).toEqual([]);
    const server = require("fs").readFileSync(join(outDir, "app.server.js"), "utf8");
    expect(server).toContain(`const n = _scrml_body["n"];`);
    expect(server).not.toMatch(/_scrml_cell_clicks = n|const n = _scrml_cell_clicks/);
  });

  test("EXECUTED: `@clicks` shows 1 while the request is in flight, and the request carries n = 1", async () => {
    const { outDir } = build(OPTIMISTIC);
    const r = await runHeld(outDir);
    expect(r.during).toBe("1");
    expect(r.after).toBe("1");
    expect(r.sent.n).toBe(1);
  }, T);

  test("EXECUTED: the route stores the carried value", async () => {
    const { dir, outDir } = build(OPTIMISTIC);
    const res = await callRoute(outDir, "save", { n: 7, clicks: 6 });
    expect(res.status).toBe(200);
    expect(rows(dir)).toEqual(["7"]);
  }, T);
});

describe("§19.9.9.8 rule 4 — a browser value read before the first server statement is sent with the request", () => {
  test("compiles clean (was E-RI-002 saying it would send `draft` \"to the browser\")", () => {
    const { errors } = build(DRAFT);
    expect(errors.map((e) => e.code)).toEqual([]);
  });

  test("EXECUTED: the spinner shows while the request is in flight; the request carries the draft", async () => {
    const { outDir } = build(DRAFT);
    const r = await runHeld(outDir, (g) => g.localStorage.setItem("draft", "hello"));
    expect(r.during).toBe("true");
    expect(r.after).toBe("false");
    expect(r.sent.draft).toBe("hello");
  }, T);

  test("EXECUTED: the route stores the draft", async () => {
    const { dir, outDir } = build(DRAFT);
    const res = await callRoute(outDir, "save", { draft: "hello", busy: true });
    expect(res.status).toBe(200);
    expect(rows(dir)).toEqual(["hello"]);
  }, T);
});

// A nested helper declared before the first server statement: the declaration
// stays in the browser AND is declared in the batch handler (it touches no cell
// and needs nothing browser-only, so it runs identically on either side).
const HELPER = `<program db="./app.db">
<v> = "x"
function save() {
  function fmt(x) { return x + "!" }
  @v = "saving"
  ?{\`INSERT INTO notes (s) VALUES (\${fmt(@v)})\`}.run()
}
<button id="go" onclick={ save() }>save</button>
<p id="out">\${@v}</p>
</program>
`;

describe("§19.9.9.8 rule 4 — a pre-first nested helper the server calls is declared on both sides", () => {
  test("EXECUTED: `@v` shows \"saving\" while the request is in flight", async () => {
    const { errors, outDir } = build(HELPER);
    expect(errors.map((e) => e.code)).toEqual([]);
    const r = await runHeld(outDir);
    expect(r.during).toBe("saving");
    expect(r.sent.v).toBe("saving");
  }, T);

  test("EXECUTED: the batch calls the helper on the server", async () => {
    const { dir, outDir } = build(HELPER);
    const res = await callRoute(outDir, "save", { v: "saving" });
    expect(res.status).toBe(200);
    expect(rows(dir)).toEqual(["saving!"]);
  }, T);
});

// Shapes a request cannot carry: refused, never moved — and the message names the
// real reason (browser data that cannot reach the request), not a server value
// crossing to the browser.
const REFUSED = {
  "a browser local declared AFTER the server work began": `<program db="./app.db">
<busy> = false
function save() {
  @busy = true
  ?{\`INSERT INTO notes (s) VALUES ('a')\`}.run()
  const d = localStorage.getItem("x")
  ?{\`INSERT INTO notes (s) VALUES (\${d})\`}.run()
  @busy = false
}
<button id="go" onclick={ save() }>save</button>
<p id="out">\${@busy}</p>
</program>
`,
  "a local the server half reassigns": `<program db="./app.db">
<busy> = false
function save() {
  let n = 1
  @busy = true
  n = ?{\`SELECT count(*) AS c FROM notes\`}.get()
  ?{\`INSERT INTO notes (s) VALUES (\${n})\`}.run()
  @busy = false
}
<button id="go" onclick={ save() }>save</button>
<p id="out">\${@busy}</p>
</program>
`,
  "a nested function the server half calls that needs the browser": `<program db="./app.db">
<v> = "x"
function save() {
  function fmt(x) { return x + localStorage.getItem("suffix") }
  @v = "saving"
  ?{\`INSERT INTO notes (s) VALUES (\${fmt(@v)})\`}.run()
}
<button id="go" onclick={ save() }>save</button>
<p id="out">\${@v}</p>
</program>
`,
};

describe("§19.9.9.8 rule 4 — shapes that cannot be carried are refused with an accurate E-RI-002", () => {
  for (const [label, src] of Object.entries(REFUSED)) {
    test(label, () => {
      const { errors } = build(src);
      const ri = errors.filter((e) => e.code === "E-RI-002");
      expect(ri.length).toBe(1);
      expect(ri[0].message).toContain("A browser value reaches the server only as part of the request");
      expect(ri[0].message).not.toContain("to the browser and trusting");
    });
  }
});
