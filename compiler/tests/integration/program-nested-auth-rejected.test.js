/**
 * §4.12.2 — `auth=` on a nested `<program>` is a compile error (S443).
 *
 * g-nested-program-auth-attr-silently-ignored (S441, HIGH, PA-reproduced on
 * 6dccbd6cf): an inner `<program auth="required">` inside `<program db>` compiled
 * with no auth at all — `computeProgramConfig` reads `auth=` from the file's FIRST
 * top-level `<program>` only — so an anonymous POST to the inner program's INSERT
 * server fn returned 200 and WROTE THE ROW. No diagnostic.
 *
 * PA ruling (S443, standing S385 class): §4.12.2's nested-attribute table does not
 * list `auth=`, so a nested `auth=` is `E-PROGRAM-NESTED-AUTH` — fail closed, and
 * the message names the fix (top-level `<program>` or `<page>`).
 *
 * Coverage:
 *   1. the error fires (build refuses; no server is written) for the gap's shape,
 *      a named worker, a `<program>` under a `<page>`, and any value of auth=;
 *   2. it does NOT fire for auth= on the top-level `<program>` or for a nested
 *      `<program>` without auth=;
 *   3. the REMEDY the error names, served over HTTP by the shipped `_server.js`
 *      in a child process: anonymous POST rejected and no row written; an
 *      authenticated POST carrying the session-bound CSRF token writes the row.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_program_nested_auth"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

// The gap's reproducer, with the auth= placement spliced in.
const src = ({ outer = "", inner = "" }) => `<program db="./c.db"${outer}>
<schema>
    notes { id: integer primary key
            body: text }
</>
<program${inner}>
function add(body) {
    ?{\`INSERT INTO notes (body) VALUES (\${body})\`}.run()
}
<button onclick=add("x")>add</button>
</>
</>
`;

let n = 0;
function compile(source, rel = "app.scrml") {
  const root = join(_tmp.root, `c${n++}`);
  const input = join(root, "src", rel);
  mkdirSync(dirname(input), { recursive: true });
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: join(root, "dist"), log: () => {} });
  const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
  return { codes: all.map((e) => e.code), nested: all.filter((e) => e.code === "E-PROGRAM-NESTED-AUTH"), errors: r.errors ?? [] };
}

describe("E-PROGRAM-NESTED-AUTH fires", () => {
  test("the gap's shape: <program auth=\"required\"> nested in <program db>", () => {
    const { nested, errors } = compile(src({ inner: ` auth="required"` }));
    expect(nested.length).toBe(1);
    expect(nested[0].severity).toBe("error");
    expect(errors.some((e) => e.code === "E-PROGRAM-NESTED-AUTH")).toBe(true);
    // The message names the fix.
    expect(nested[0].message).toContain("top-level <program>");
    expect(nested[0].message).toContain("<page>");
  });

  test("any value — optional, none, an unrecognised literal — is an error, not a no-op", () => {
    for (const v of ["optional", "none", "Required"]) {
      expect(compile(src({ inner: ` auth="${v}"` })).nested.length).toBe(1);
    }
  });

  test("a named nested worker program", () => {
    const { nested } = compile(`<program>\n<program name="w" auth="required">\n\${ function f() { return 1 } }\n</program>\n<p>x</p>\n</program>\n`);
    expect(nested.length).toBe(1);
  });

  test("a <program> under a <page> (a member page file)", () => {
    const { nested } = compile(
      `<page>\n<program auth="required">\nfunction who() {\n    return "server-ran:" + session.userId\n}\n<p>inner</p>\n</program>\n</page>\n`,
      "pages/x.scrml",
    );
    expect(nested.length).toBe(1);
  });

  test("the CLI build refuses and writes no server", () => {
    const root = join(_tmp.root, "cli-refuses");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), src({ inner: ` auth="required"` }));
    const r = Bun.spawnSync(["bun", CLI, "build", join(root, "src"), "-o", join(root, "dist")], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("E-PROGRAM-NESTED-AUTH");
    expect(existsSync(join(root, "dist", "_server.js"))).toBe(false);
  });
});

describe("E-PROGRAM-NESTED-AUTH does not fire", () => {
  test("auth= on the top-level <program>", () => {
    const { codes, errors } = compile(src({ outer: ` auth="required"` }));
    expect(codes).not.toContain("E-PROGRAM-NESTED-AUTH");
    expect(errors).toEqual([]);
  });

  test("a nested <program> with no auth=", () => {
    expect(compile(src({})).codes).not.toContain("E-PROGRAM-NESTED-AUTH");
  });

  test("<page auth=\"required\"> (the other remedy)", () => {
    expect(compile(`<page auth="required">\n<p>x</p>\n</page>\n`, "pages/p.scrml").codes).not.toContain("E-PROGRAM-NESTED-AUTH");
  });
});

// The remedy, served. Child process: seed one session, import the shipped
// `_server.js` on a free port, probe, print JSON.
const PROBE = `
import { Database } from "bun:sqlite";
const dist = process.argv[2];
process.chdir(dist);
{ const d = new Database("c.db"); d.run("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)"); d.close(); }
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-alice", { userId: 1, role: "user" });
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const base = "http://localhost:" + port;
const serverSrc = await Bun.file(dist + "/app.server.js").text();
const cookieName = serverSrc.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid";
const sess = cookieName + "=sid-alice";
const route = (serverSrc.match(/path: "(\\/_scrml\\/__ri_route_add_\\d+)"/) || [])[1];
const post = async (headers, body) => {
  const r = await fetch(base + route, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ body }) });
  return { status: r.status, location: r.headers.get("location") };
};
const rows = () => new Database("c.db").query("SELECT body FROM notes ORDER BY id").all().map((r) => r.body);
const anon = await post({ "X-CSRF-Token": "anon-token", Cookie: "scrml_csrf=anon-token" }, "anon-write");
const afterAnon = rows();
const doc = await fetch(base + "/app", { redirect: "manual", headers: { Cookie: sess } });
const meta = ((await doc.text()).match(/<meta name="csrf-token" content="([^"]*)">/) || [])[1] ?? "";
const authed = await post({ "X-CSRF-Token": meta, Cookie: sess }, "alice-write");
console.log(JSON.stringify({ route, anon, afterAnon, docStatus: doc.status, authed, rows: rows() }));
process.exit(0);
`;

describe("the remedy (auth= on the top-level <program>), served over HTTP", () => {
  let res;
  beforeAll(() => {
    const root = join(_tmp.root, "served");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.scrml"), src({ outer: ` auth="required"` }));
    const dist = join(root, "dist");
    const b = Bun.spawnSync(["bun", CLI, "build", join(root, "src"), "-o", dist], { stdout: "pipe", stderr: "pipe" });
    if (b.exitCode !== 0) throw new Error(`scrml build failed:\n${b.stdout}\n${b.stderr}`);
    writeFileSync(join(root, "probe.mjs"), PROBE);
    const p = Bun.spawnSync(["bun", join(root, "probe.mjs"), dist], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
    const lines = p.stdout.toString().trim().split("\n");
    res = JSON.parse(lines[lines.length - 1]);
  }, 60_000);

  test("an anonymous POST is redirected to /login and writes nothing", () => {
    expect(res.route).toMatch(/^\/_scrml\/__ri_route_add_\d+$/);
    expect(res.anon.status).toBe(302);
    expect(res.anon.location).toBe("/login");
    expect(res.afterAnon).toEqual([]);
  });

  test("an authenticated POST with the session-bound CSRF token writes the row", () => {
    expect(res.docStatus).toBe(200);
    expect(res.authed.status).toBe(200);
    expect(res.rows).toEqual(["alice-write"]);
  });
});
