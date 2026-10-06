/**
 * §14.8.10 corollary — W-TENANT-SUBSTRATE-SCOPED (S456).
 *
 * SPEC §14.8.10: *"**Corollary:** the identity/grant substrate (`users` / `user_roles`) is
 * NOT tenant-scoped — you would need the tenant to read the table that tells you the
 * tenant (infinite regress)."* and *"A table whose `<schema>` carries a `tenant_id` column
 * IS tenant-scoped; the column's **presence is the declaration**"*.
 *
 * EXECUTED (S455 review of #1316, reproduced S456 on 2dd6d35d9): app.scrml declares
 * `users (…, tenant_id)`; login.scrml reads users by email and pins `u.tenant_id` →
 * every login returns "bad" (the read is filtered to the tenant active before the pin:
 * none). The only signal was info-level I-TENANT-STRIP. The warning names the corollary
 * and the two fixes; the trigger is a read that DECIDES the pin (its value, or a
 * condition evaluated before it) — see compiler/src/tenant-substrate-read.ts.
 */
import { describe, test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

setDefaultTimeout(30_000);

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const BT = "`";
const CODE = "W-TENANT-SUBSTRATE-SCOPED";
const q = (s) => `?{${BT}${s}${BT}}`;

const schema = (usersCols = "id TEXT PRIMARY KEY, email TEXT, tenant_id TEXT") => `  <schema>
    ${q(`CREATE TABLE users (${usersCols})`)}
    ${q("CREATE TABLE user_roles (user_id TEXT, role TEXT, tenant_id TEXT)")}
    ${q("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)")}
  </schema>
`;
const APP = (usersCols) => `<program db="app.db">
${schema(usersCols)}  \${
    function appAssets() {
      return ${q("SELECT name FROM assets ORDER BY id")}.all()
    }
  }
  <button onclick=\${ appAssets() }>x</button>
</program>
`;
const prog = (fns, call = "f()") => `<program db="app.db">
  \${
${fns}
  }
  <button onclick=\${ ${call} }>x</button>
</program>
`;
const LOGIN = (read = `${q("SELECT id, tenant_id FROM users WHERE email = ${email}")}.get()`) => prog(`    function login(email: string) {
      const u = ${read}
      if (u is not) {
        return "bad"
      }
      session.set("userId", u.id)
      session.set("tenantId", u.tenant_id)
      return "ok:" + u.id
    }`, `login("a@x")`);

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "tenant-substrate-"));
  _tmp.push(dir);
  const paths = Object.entries(files).map(([name, src]) => {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, src);
    return p;
  });
  const db = new Database(join(dir, "app.db"), { create: true });
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, tenant_id TEXT)");
  db.exec("INSERT INTO users VALUES ('u1', 'a@x', 'A')");
  db.close();
  const out = join(dir, "out");
  const result = compileScrml({ inputFiles: paths, write: true, outputDir: out, log: () => {} });
  return { dir, out, result };
}
const all = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])];
const fatal = (r) => (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
const hits = (r, file) => all(r).filter((d) => d.code === CODE &&
  (file === undefined || String(d.span?.file ?? d.file ?? d.filePath ?? "").endsWith(file)));
const codes = (src) => { const r = project({ "app.scrml": APP(), "x.scrml": src }).result; expect(fatal(r)).toEqual([]); return hits(r).length; };

const CSRF = "tenant-substrate-csrf";
async function login(out) {
  const mod = await import(`${join(out, "login.server.js")}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => /login/.test(r.path));
  const res = await route.handler(new Request(`https://localhost${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json", Cookie: `scrml_csrf=${CSRF}`, "X-CSRF-Token": CSRF },
    body: JSON.stringify({ email: "a@x" }),
  }));
  expect(res.status).toBe(200);
  return await res.json();
}

describe("W-TENANT-SUBSTRATE-SCOPED — the login reads a tenant-scoped identity table", () => {
  test("EXECUTED: users declared in ANOTHER file — the login fails silently, and now warns (non-fatal)", async () => {
    const p = project({ "app.scrml": APP(), "login.scrml": LOGIN() });
    expect(fatal(p.result)).toEqual([]);
    const w = hits(p.result, "login.scrml");
    expect(w.length).toBe(1);
    expect(w[0].severity).toBe("warning");
    expect((p.result.warnings ?? []).some((d) => d.code === CODE)).toBe(true);
    expect(w[0].message).toContain("`login()`");
    expect(w[0].message).toContain("`users`");
    expect(w[0].message).toContain("identity/grant substrate (`users` / `user_roles`) is NOT tenant-scoped");
    expect(w[0].message).toContain("drop `tenant_id` from `users`");
    expect(w[0].message).toContain(".acrossTenants()");
    expect(w[0].span?.line).toBe(4);
    expect(await login(p.out)).toBe("bad");   // the behavior the warning names
  });

  test("fix 1 — `.acrossTenants()` on the identity read: no warning, the login succeeds", async () => {
    const p = project({ "app.scrml": APP(), "login.scrml": LOGIN(`${q("SELECT id, tenant_id FROM users WHERE email = ${email}")}.acrossTenants().get()`) });
    expect(fatal(p.result)).toEqual([]);
    expect(hits(p.result)).toEqual([]);
    expect(await login(p.out)).toBe("ok:u1");
  });

  test("fix 2 — drop `tenant_id` from `users` (a grant table carries the tenant): no warning, the login succeeds", async () => {
    const p = project({ "app.scrml": APP("id TEXT PRIMARY KEY, email TEXT, home_tenant TEXT"), "login.scrml": LOGIN().replace("SELECT id, tenant_id FROM users", "SELECT id, email AS tenant_id FROM users") });
    expect(fatal(p.result)).toEqual([]);
    expect(hits(p.result)).toEqual([]);
    expect(await login(p.out)).toBe("ok:u1");
  });

  test("the same file declares users — fires", () => {
    const src = LOGIN().replace("<program db=\"app.db\">\n", `<program db="app.db">\n${schema()}`);
    expect(hits(project({ "login.scrml": src }).result).length).toBe(1);
  });

  test("a `!{}`-handled identity read (the auth template's shape) — fires", () => {
    expect(codes(LOGIN(`${q("SELECT id, tenant_id FROM users WHERE email = ${email}")}.get() !{ _ :> not }`))).toBe(1);
  });
});

describe("the read DECIDES the pin — value, condition, or a binding derived from it", () => {
  test("the read is the pin's value directly", () => {
    expect(codes(prog(`    function f() {
      session.set("tenantId", ${q("SELECT tenant_id FROM user_roles WHERE user_id = 'u1'")}.get().tenant_id)
      return "ok"
    }`))).toBe(1);
  });
  test("a tenant switch validated by a tenant-scoped grant table (the condition decides the pin)", () => {
    expect(codes(prog(`    function switchTo(t: string) {
      const g = ${q("SELECT role FROM user_roles WHERE user_id = 'u1' AND tenant_id = ${t}")}.get()
      if (g is not) {
        return "denied"
      }
      session.set("tenantId", t)
      return "ok"
    }`, `switchTo("B")`))).toBe(1);
  });
  test("a binding derived from the read decides the pin through a condition", () => {
    expect(codes(prog(`    function f(org: string) {
      const u = ${q("SELECT id, email FROM users WHERE email = 'a@x'")}.get()
      const ok = u is some
      if (!ok) {
        return "bad"
      }
      session.set("tenantId", org)
      return "ok"
    }`, `f("A")`))).toBe(1);
  });
});

describe("not charged — each case is not provable from the AST", () => {
  test("a tenant-scoped read before the pin that does not decide it (a switch reading the old tenant's rows)", () => {
    expect(codes(prog(`    function f(t: string) {
      const before = ${q("SELECT name FROM assets")}.all()
      session.set("tenantId", t)
      return before.length
    }`, `f("B")`))).toBe(0);
  });
  test("a read AFTER the pin", () => {
    expect(codes(prog(`    function f(t: string) {
      session.set("tenantId", t)
      const u = ${q("SELECT id FROM users WHERE email = 'a@x'")}.get()
      if (u is not) {
        return "none"
      }
      return u.id
    }`, `f("A")`))).toBe(0);
  });
  test("a logout that clears the tenant (`not`)", () => {
    expect(codes(prog(`    function f() {
      const u = ${q("SELECT id FROM users WHERE email = 'a@x'")}.get()
      if (u is not) {
        return "none"
      }
      session.set("tenantId", not)
      return "bye"
    }`))).toBe(0);
  });
  test("the pin is in a CALLEE — already E-SESSION-CONTEXT (a peer call has no session); not charged here", () => {
    const r = project({ "app.scrml": APP(), "x.scrml": prog(`    function pin(t: string) {
      session.set("tenantId", t)
      return "ok"
    }
    function f() {
      const u = ${q("SELECT tenant_id FROM users WHERE email = 'a@x'")}.get()
      return pin(u.tenant_id)
    }`) }).result;
    expect(fatal(r).map((e) => e.code)).toContain("E-SESSION-CONTEXT");
    expect(hits(r)).toEqual([]);
  });
  test("a login that pins only userId (an org-first flow may have pinned the tenant earlier)", () => {
    expect(codes(prog(`    function f() {
      const u = ${q("SELECT id FROM users WHERE email = 'a@x'")}.get()
      if (u is not) {
        return "bad"
      }
      session.set("userId", u.id)
      return "ok"
    }`))).toBe(0);
  });
  test("a non-tenant identity table", () => {
    const p = project({ "app.scrml": APP("id TEXT PRIMARY KEY, email TEXT"), "login.scrml": LOGIN().replace("SELECT id, tenant_id FROM users", "SELECT id, email AS tenant_id FROM users") });
    expect(hits(p.result)).toEqual([]);
  });
  test("a function-local `session` shadows the builtin", () => {
    expect(codes(prog(`    function f() {
      const session = { set: (k, v) => v }
      const u = ${q("SELECT tenant_id FROM users WHERE email = 'a@x'")}.get()
      session.set("tenantId", u.tenant_id)
      return "ok"
    }`))).toBe(0);
  });
  test("no tenant-scoped table in the compilation", () => {
    const plain = LOGIN().replace("<program db=\"app.db\">\n", `<program db="app.db">\n  <schema>\n    ${q("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)")}\n  </schema>\n`)
      .replace("SELECT id, tenant_id FROM users", "SELECT id, email AS tenant_id FROM users");
    expect(hits(project({ "login.scrml": plain }).result)).toEqual([]);
  });
});
