/**
 * S445 fix round (adversarial review of b0b9e65a4) + rulings S445 item 1 / item 3.
 *
 *   F1 (HIGH, introduced by the first cut) — a member page `pages/member.scrml` holding
 *      a `<div>`-wrapped worker `<program name="w">` became a "program file", so route
 *      inference stopped treating it as a member page and it LOST the application's
 *      gate: anonymous POST to its server fn 302 (base) → 200 (first cut).
 *      Ruling S445 item 1: "When an application program exists, every `<program>` in one
 *      of its route files (`pages/`, `routes/`) counts as nested … the route file keeps
 *      inheriting the app's auth; `auth=` on it is `E-PROGRAM-NESTED-AUTH`". The direct
 *      form (`pages/member.scrml` = `<program>…</program>`, 200 on base too) inherits now.
 *      A build with NO application program (legacy all-`<program>` `routes/` set) is
 *      unaffected.
 *   item 3 — a session attribute on a nested `<program>` is `E-PROGRAM-NESTED-SESSION`
 *      (before: a nested `session-secure="false"` silently downgraded the app cookie).
 *   F2 (HIGH, pre-existing) — a `<program>` produced by a component expansion was
 *      invisible to the PRECG config reader: `const Svc = <div><program auth="required">
 *      …</program></div>` + `<Svc/>` answered anonymous callers with 200 "s3cret".
 *      Now `E-PROGRAM-CONFIG-UNREAD`, and the build writes nothing.
 * All four new refusals write no output (build / compile / dev).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_program_role_implied_ancestor"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const APP = `<program auth="required" loginRedirect="/login">\n\${ server function secret() { return "s3cret" } }\n<button onclick=secret()>go</button>\n</program>\n`;
const LOGIN = `<page auth="none">\n<p>login</p>\n</page>\n`;
const MEMBER_FN = `\${ server function memberSecret() { return "m-secret" } }\n<button onclick=memberSecret()>m</button>\n`;

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
  const serverJs = (name) => {
    const f = join(p.dist, name);
    return existsSync(f) ? readFileSync(f, "utf8") : "";
  };
  return { p, errors: r.errors ?? [], codes: [...(r.errors ?? []), ...(r.warnings ?? [])].map((e) => e.code), serverJs };
}
const isGated = (src) => /_scrml_session|scrml_sid/.test(src) && /302|401/.test(src);
const run = (args) => Bun.spawnSync(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });

describe("S445 item 1 — a route file's <program>s are nested when an application program exists", () => {
  test("F1 (w/mf5): a member page with a <div>-wrapped worker program keeps the application's gate", () => {
    const { errors, serverJs } = compile({
      "app.scrml": APP, "pages/login.scrml": LOGIN,
      "pages/member.scrml": `${MEMBER_FN}<div>\n<program name="w">\n\${ function work() { return 1 } }\n</program>\n</div>\n`,
    });
    expect(errors).toEqual([]);
    expect(isGated(serverJs("member.server.js"))).toBe(true);
  });

  test("w/mf3: a member page that IS a <div>-wrapped <program> inherits the gate", () => {
    const { errors, serverJs } = compile({
      "app.scrml": APP, "pages/login.scrml": LOGIN,
      "pages/member.scrml": `<div>\n<program>\n${MEMBER_FN}</program>\n</div>\n`,
    });
    expect(errors).toEqual([]);
    expect(isGated(serverJs("member.server.js"))).toBe(true);
  });

  test("w/mf4: a member page written as <program>…</program> inherits the gate (was served anonymously on base)", () => {
    const { errors, serverJs } = compile({
      "app.scrml": APP, "pages/login.scrml": LOGIN,
      "pages/member.scrml": `<program>\n${MEMBER_FN}</program>\n`,
    });
    expect(errors).toEqual([]);
    expect(isGated(serverJs("member.server.js"))).toBe(true);
  });

  test("auth= on a route file's <program> is E-PROGRAM-NESTED-AUTH (it no longer governs its own file)", () => {
    const { errors } = compile({
      "app.scrml": APP, "pages/login.scrml": LOGIN,
      "pages/m.scrml": `<program auth="optional">\n${MEMBER_FN}</program>\n`,
    });
    expect(errors.map((e) => e.code)).toEqual(["E-PROGRAM-NESTED-AUTH"]);
  });

  test("a route file's two <program>s are two NESTED programs, not E-PROGRAM-002", () => {
    const { codes } = compile({
      "app.scrml": APP, "pages/login.scrml": LOGIN,
      "pages/m.scrml": `<program name="a">\n<p>a</p>\n</program>\n<program name="b">\n<p>b</p>\n</program>\n${MEMBER_FN}`,
    });
    expect(codes).not.toContain("E-PROGRAM-002");
  });

  test("CONTROL — a legacy all-<program> routes/ set with NO application entry is unaffected", () => {
    const { errors, serverJs } = compile({
      "routes/a.scrml": `<program auth="required">\n\${ server function a() { return "A" } }\n<button onclick=a()>a</button>\n</program>\n`,
      "routes/b.scrml": `<program>\n\${ server function b() { return "B" } }\n<button onclick=b()>b</button>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    expect(isGated(serverJs("a.server.js"))).toBe(true);
    expect(isGated(serverJs("b.server.js"))).toBe(false);
  });
});

describe("S445 item 3 — E-PROGRAM-NESTED-SESSION", () => {
  test("w/sess2: a nested <div>-wrapped program's session-secure= / sessionExpiry= are errors (one each)", () => {
    const { errors } = compile({
      "app.scrml": `<program csrf="off" session-secure="true" sessionExpiry="15m">\n\${ export function login() {\n  session.set("userId", 1)\n  return true\n} }\n<button onclick=login()>in</button>\n<div><program db="./x.db" session-secure="false" sessionExpiry="30d"><p>x</p></program></div>\n</program>\n`,
    });
    const e = errors.filter((x) => x.code === "E-PROGRAM-NESTED-SESSION");
    expect(e.length).toBe(2);
    expect(e[0].severity).toBe("error");
  });

  test("a named worker with a session attribute, and a route-file program with one, are errors too", () => {
    expect(compile({ "app.scrml": `<program>\n<program name="w" sessionExpiry="30d">\nwhen message(d) { send(d) }\n</program>\n<p>x</p>\n</program>\n` })
      .errors.map((e) => e.code)).toEqual(["E-PROGRAM-NESTED-SESSION"]);
    expect(compile({ "app.scrml": APP, "pages/login.scrml": LOGIN, "pages/m.scrml": `<program session-secure="false">\n${MEMBER_FN}</program>\n` })
      .errors.map((e) => e.code)).toEqual(["E-PROGRAM-NESTED-SESSION"]);
  });

  test("CONTROL — session attributes on the top-level program are fine", () => {
    const { errors } = compile({ "app.scrml": `<div>\n<program session-secure="false" sessionExpiry="7d">\n<p>x</p>\n</program>\n</div>\n` });
    expect(errors).toEqual([]);
  });
});

describe("F2 — a top-level <program> produced by a component expansion is E-PROGRAM-CONFIG-UNREAD", () => {
  const COMP = `const Svc = <div><program auth="required">\n\${ server function secret() { return "s3cret" } }\n<button onclick=secret()>go</button>\n</program></div>\n<Svc/>\n`;

  test("w/top_compunnamed: refused, with the fix named", () => {
    const { errors } = compile({ "app.scrml": COMP });
    const e = errors.filter((x) => x.code === "E-PROGRAM-CONFIG-UNREAD");
    expect(e.length).toBe(1);
    expect(e[0].message).toContain("component");
  });

  test("the build writes no server (was: anonymous POST 200 \"s3cret\")", () => {
    const p = project({ "app.scrml": COMP });
    const r = run(["build", p.src, "-o", p.dist]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("E-PROGRAM-CONFIG-UNREAD");
    expect(existsSync(p.dist)).toBe(false);
  });

  test("CONTROL — a component used INSIDE a directly-written program is fine", () => {
    const { errors } = compile({ "app.scrml": `const Card = <div><p>card</p></div>\n<program auth="required">\n<Card/>\n\${ server function secret() { return "s3cret" } }\n<button onclick=secret()>go</button>\n</program>\n` });
    expect(errors.map((e) => e.code)).not.toContain("E-PROGRAM-CONFIG-UNREAD");
  });
});

describe("E-PROGRAM-002 advice no longer sends an auth= program inside the first", () => {
  test("the message says a nested program takes neither auth= nor session attributes", () => {
    const { errors } = compile({ "app.scrml": `<program><p>a</p></program>\n<div><program auth="required"><p>b</p></program></div>\n` });
    const m = errors.find((e) => e.code === "E-PROGRAM-002").message;
    expect(m).toContain("WITHOUT auth=");
    expect(m).not.toContain("or place it inside the first (");
  });
});

// F1, served. Anonymous (self-minted double-submit pair) POST to every server route.
const PROBE = `
const dist = process.argv[2];
process.chdir(dist);
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const out = {};
for (const f of ["app.server.js", "member.server.js"]) {
  const src = await Bun.file(dist + "/" + f).text();
  for (const m of src.matchAll(/path: "(\\/_scrml\\/__ri_route_[A-Za-z0-9_]+)"/g)) {
    const r = await fetch("http://localhost:" + port + m[1], { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" }, body: "{}" });
    out[m[1].replace(/_\\d+$/, "")] = { status: r.status, body: (await r.text()).slice(0, 40) };
  }
}
console.log(JSON.stringify(out));
process.exit(0);
`;

describe("F1 served over HTTP (w/mf5)", () => {
  let res;
  beforeAll(() => {
    const p = project({
      "app.scrml": APP, "pages/login.scrml": LOGIN,
      "pages/member.scrml": `${MEMBER_FN}<div>\n<program name="w">\n\${ function work() { return 1 } }\n</program>\n</div>\n`,
    });
    const b = run(["build", p.src, "-o", p.dist]);
    if (b.exitCode !== 0) throw new Error(`scrml build failed:\n${b.stdout}\n${b.stderr}`);
    writeFileSync(join(p.root, "probe.mjs"), PROBE);
    const r = Bun.spawnSync(["bun", join(p.root, "probe.mjs"), p.dist], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`probe failed:\n${r.stdout}\n${r.stderr}`);
    const lines = r.stdout.toString().trim().split("\n");
    res = JSON.parse(lines[lines.length - 1]);
  }, 60_000);

  test("anonymous POST to the member page's server fn is refused (302), as is the app's", () => {
    expect(res["/_scrml/__ri_route_memberSecret"].status).toBe(302);
    expect(res["/_scrml/__ri_route_memberSecret"].body).not.toContain("m-secret");
    expect(res["/_scrml/__ri_route_secret"].status).toBe(302);
  });
});
