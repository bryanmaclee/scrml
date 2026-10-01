/**
 * g-wrapped-program-auth-silently-dropped (S443 post-merge review of #1177, HIGH,
 * fail-open) — closed by ruling user-voice-scrml.md S445 option b (§4.12):
 *
 *   "A `<program>` is top-level if it has no `<program>` or `<page>` ancestor,
 *    whatever markup wraps it. It's nested if it has one. Wrapper `<div>`s never
 *    change a program's role."
 *
 * Before (PA-reproduced on c53b297a7): a `<div><program auth="required">…</program></div>`
 * was top-level to NOBODY (compute-program-config and the E-PROGRAM-002 count read only
 * the file's direct nodes) and nested to NOBODY (E-PROGRAM-NESTED-AUTH tracked only
 * `<program>`/`<page>` ancestors): its `auth=` was dropped with no error, the emitted
 * server had CSRF only, and an anonymous POST to its server function returned 200
 * "s3cret". A plain `<program>` followed by a `<div>`-wrapped `<program auth="required">`
 * compiled with 0 errors.
 *
 * After: all of them read `program-role.ts`.
 *   (i)   the wrapped program IS the application program — its server functions and
 *         its document are gated (served over HTTP below: anon POST → 302 /login,
 *         authenticated → 200 "s3cret");
 *   (ii)  two outermost programs, one wrapped → E-PROGRAM-002;
 *   (iii) a program nested in the app program through a <div> keeps
 *         E-PROGRAM-NESTED-AUTH (control).
 * Plus the blast-radius shapes and the build refusal (no fail-open server.js written).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_program_role_by_ancestor"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const FN = '${ server function secret() { return "s3cret" } }\n<button onclick=secret()>go</button>\n';
const wrapped = (open, close, attrs = ` auth="required"`) => `${open}\n<program${attrs}>\n${FN}</program>\n${close}\n`;

let n = 0;
function project(files) {
  const root = join(_tmp.root, `c${n++}`);
  for (const [rel, s] of Object.entries(files)) {
    const abs = join(root, "src", rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s);
  }
  return { root, src: join(root, "src"), dist: join(root, "dist"), inputs: Object.keys(files).map((r) => join(root, "src", r)) };
}
function compile(files) {
  const p = project(files);
  const r = compileScrml({ inputFiles: p.inputs, write: true, outputDir: p.dist, log: () => {} });
  const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
  const serverJs = (name) => {
    const f = join(p.dist, name);
    return existsSync(f) ? readFileSync(f, "utf8") : "";
  };
  return { p, codes: all.map((e) => e.code), errors: r.errors ?? [], all, serverJs };
}
function isGated(serverSrc) {
  // The gate the auth middleware emits: a session lookup + a 302/401 refusal.
  // (Measured: the pre-S445 output for (i) carried neither — CSRF only.)
  return /_scrml_session|scrml_sid/.test(serverSrc) && /302|401/.test(serverSrc);
}

describe("(i) a <div>-wrapped <program auth=\"required\"> is the application program", () => {
  test("no error, no W-PROGRAM-001, and the emitted server is gated", () => {
    const { codes, errors, serverJs } = compile({ "app.scrml": wrapped("<div>", "</div>") });
    expect(errors).toEqual([]);
    expect(codes).not.toContain("W-PROGRAM-001");
    expect(isGated(serverJs("app.server.js"))).toBe(true);
  });

  for (const [open, close] of [["<main>", "</main>"], ["<section>", "</section>"], ["<div><div><section>", "</section></div></div>"]]) {
    test(`also through ${open}`, () => {
      const { errors, serverJs } = compile({ "app.scrml": wrapped(open, close) });
      expect(errors).toEqual([]);
      expect(isGated(serverJs("app.server.js"))).toBe(true);
    });
  }

  test("the wrapped program's middleware is read and validated (E-MW-002 fires on a bad ratelimit=)", () => {
    const { codes } = compile({ "app.scrml": wrapped("<div>", "</div>", ` ratelimit="bad"`) });
    expect(codes).toContain("E-MW-002");
  });

  test("the wrapped program's title= is the document title", () => {
    const { p } = compile({ "app.scrml": `<div>\n<program title="Wrapped T">\n<p>x</p>\n</program>\n</div>\n` });
    expect(readFileSync(join(p.dist, "app.html"), "utf8")).toContain("<title>Wrapped T</title>");
  });

  test("multi-file: the wrapped entry program is the application root — an unannotated member page inherits its gate", () => {
    const { errors, serverJs } = compile({
      "app.scrml": wrapped("<div>", "</div>", ` auth="required" loginRedirect="/login"`),
      "pages/member.scrml": `<page>\n\${ server function memberSecret() { return "m" } }\n<button onclick=memberSecret()>m</button>\n</page>\n`,
      "pages/login.scrml": `<page auth="none">\n<p>login</p>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    expect(isGated(serverJs("member.server.js"))).toBe(true);
  });
});

describe("(ii) two outermost programs, one wrapped → E-PROGRAM-002", () => {
  test("plain <program> then a <div>-wrapped <program auth=\"required\">", () => {
    const { errors } = compile({ "app.scrml": `<program><p>public</p></program>\n${wrapped("<div>", "</div>")}` });
    const e = errors.filter((x) => x.code === "E-PROGRAM-002");
    expect(e.length).toBe(1);
    expect(e[0].severity).toBe("error");
    // The message is true: it is an error, and it does not claim either program's settings win.
    expect(e[0].message).not.toMatch(/FIRST program's settings/);
    expect(e[0].message).toContain("whatever markup");
  });

  test("two <div>-wrapped programs", () => {
    const { errors } = compile({ "app.scrml": `<div><program><p>a</p></program></div>\n${wrapped("<div>", "</div>")}` });
    expect(errors.filter((x) => x.code === "E-PROGRAM-002").length).toBe(1);
  });
});

describe("(iii) nested stays nested — E-PROGRAM-NESTED-AUTH unchanged", () => {
  test("a <program auth=> inside the app program through a <div>", () => {
    const { errors } = compile({ "app.scrml": `<program>\n<div>\n<program name="svc" auth="required">\n${FN}</program>\n</div>\n</program>\n` });
    expect(errors.map((e) => e.code)).toEqual(["E-PROGRAM-NESTED-AUTH"]);
  });

  test("a <program auth=> inside a <div>-wrapped app program through another <div>", () => {
    const { errors } = compile({ "app.scrml": `<div>\n<program>\n<div>\n<program name="svc" auth="required">\n${FN}</program>\n</div>\n</program>\n</div>\n` });
    expect(errors.map((e) => e.code)).toEqual(["E-PROGRAM-NESTED-AUTH"]);
  });

  test("a <program auth=> in a <page> file, wrapped in markup", () => {
    const { errors } = compile({ "pages/x.scrml": `<page>\n<div>\n<program name="w" auth="required">\n${FN}</program>\n</div>\n</page>\n` });
    expect(errors.map((e) => e.code)).toContain("E-PROGRAM-NESTED-AUTH");
  });

  test("a named worker under a <div> inside an auth=required app: nested, no E-PROGRAM-002, app still gated", () => {
    const { codes, errors, serverJs } = compile({
      "app.scrml": `<program auth="required">\n<div>\n<program name="w">\nwhen message(d) { send(d) }\n</program>\n</div>\n${FN}</program>\n`,
    });
    expect(errors).toEqual([]);
    expect(codes).not.toContain("E-PROGRAM-002");
    expect(isGated(serverJs("app.server.js"))).toBe(true);
  });

  test("W-PROGRAM-TITLE-NESTED reads the same definition (a <page>-nested program counts as nested)", () => {
    const { codes } = compile({ "pages/y.scrml": `<page>\n<div>\n<program name="w" title="T">\n<p>w</p>\n</program>\n</div>\n</page>\n` });
    expect(codes).toContain("W-PROGRAM-TITLE-NESTED");
  });
});

describe("the build refuses E-PROGRAM-002 / E-PROGRAM-NESTED-AUTH before any write", () => {
  const run = (args) => Bun.spawnSync(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });

  test("scrml build — E-PROGRAM-002 writes no dist (no fail-open server.js)", () => {
    const p = project({ "app.scrml": `<program><p>public</p></program>\n${wrapped("<div>", "</div>")}` });
    const r = run(["build", p.src, "-o", p.dist]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("E-PROGRAM-002");
    expect(`${r.stdout}${r.stderr}`).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
  });

  test("scrml compile — E-PROGRAM-NESTED-AUTH writes no output directory", () => {
    const p = project({ "app.scrml": `<program>\n<div>\n<program name="svc" auth="required">\n${FN}</program>\n</div>\n</program>\n` });
    const r = run(["compile", p.src, "-o", p.dist]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("E-PROGRAM-NESTED-AUTH");
    expect(existsSync(p.dist)).toBe(false);
  });

  test("a refused REBUILD leaves the previous good dist untouched (the old server.js is not overwritten)", () => {
    const p = project({ "app.scrml": wrapped("<div>", "</div>") });
    expect(run(["build", p.src, "-o", p.dist]).exitCode).toBe(0);
    const before = readFileSync(join(p.dist, "app.server.js"), "utf8");
    writeFileSync(join(p.src, "app.scrml"), `<program><p>public</p></program>\n${wrapped("<div>", "</div>")}`);
    const r = run(["build", p.src, "-o", p.dist]);
    expect(r.exitCode).not.toBe(0);
    expect(readFileSync(join(p.dist, "app.server.js"), "utf8")).toBe(before);
  });
});

// (i), served. Child process: plant one session, import the shipped `_server.js`
// on a free port, probe, print JSON (the harness program-nested-auth-rejected uses).
const PROBE = `
const dist = process.argv[2];
process.chdir(dist);
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
const route = (serverSrc.match(/path: "(\\/_scrml\\/__ri_route_secret_\\d+)"/) || [])[1];
const post = async (headers) => {
  const r = await fetch(base + route, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });
  return { status: r.status, location: r.headers.get("location"), body: await r.text() };
};
const anon = await post({ "X-CSRF-Token": "anon-token", Cookie: "scrml_csrf=anon-token" });
const anonDoc = await fetch(base + "/app", { redirect: "manual" });
const doc = await fetch(base + "/app", { redirect: "manual", headers: { Cookie: sess } });
const meta = ((await doc.text()).match(/<meta name="csrf-token" content="([^"]*)">/) || [])[1] ?? "";
const authed = await post({ "X-CSRF-Token": meta, Cookie: sess });
console.log(JSON.stringify({ route, anon, anonDoc: { status: anonDoc.status, location: anonDoc.headers.get("location") }, docStatus: doc.status, authed }));
process.exit(0);
`;

describe("(i) served over HTTP by the shipped _server.js", () => {
  let res;
  beforeAll(() => {
    const p = project({ "app.scrml": wrapped("<div>", "</div>") });
    const b = Bun.spawnSync(["bun", CLI, "build", p.src, "-o", p.dist], { stdout: "pipe", stderr: "pipe" });
    if (b.exitCode !== 0) throw new Error(`scrml build failed:\n${b.stdout}\n${b.stderr}`);
    writeFileSync(join(p.root, "probe.mjs"), PROBE);
    const r = Bun.spawnSync(["bun", join(p.root, "probe.mjs"), p.dist], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`probe failed:\n${r.stdout}\n${r.stderr}`);
    const lines = r.stdout.toString().trim().split("\n");
    res = JSON.parse(lines[lines.length - 1]);
  }, 60_000);

  test("an anonymous POST to the wrapped program's server function is refused (was 200 \"s3cret\")", () => {
    expect(res.route).toMatch(/^\/_scrml\/__ri_route_secret_\d+$/);
    expect(res.anon.status).toBe(302);
    expect(res.anon.location).toBe("/login");
    expect(res.anon.body).not.toContain("s3cret");
  });

  test("the anonymous document request is redirected to /login", () => {
    expect(res.anonDoc.status).toBe(302);
    expect(res.anonDoc.location).toBe("/login");
  });

  test("an authenticated call with the session-bound CSRF token still succeeds", () => {
    expect(res.docStatus).toBe(200);
    expect(res.authed.status).toBe(200);
    expect(res.authed.body).toContain("s3cret");
  });
});
