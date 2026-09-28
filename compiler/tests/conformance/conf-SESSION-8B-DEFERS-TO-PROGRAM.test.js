/**
 * CONF-SESSION-8B-DEFERS-TO-PROGRAM | §20.5 / §20.5.1 — a protect= / `<page auth="required">`
 * unit's session cookie is governed by its OWN `<program>`'s declaration, not by
 * route-inference's hard-coded defaults; and a contested one is refused (`E-MW-008`)
 *
 * ── THE DEFECT (S438; g-route-inference-8b-session-defaults-outrank-program-declaration,
 *    and the S433 source-derived g-route-inference-substituted-default-outranks-program-declaration)
 * route-inference Step 8b registers an `authMiddleware` entry for a unit that is
 * auto-escalated by a `protect=` column, or that carries `<page auth="required">` over one.
 * Both limbs stamped `sessionExpiry: "1h"` and `sessionSecure: true` whether or not the unit
 * declared anything. `session-config-resolve.ts` step 1 reads ANY defined middleware value
 * as the unit's own answer, so the stamp outranked the unit's own `<program>` and the
 * program stash — and made the unit "attributable", hiding it from `E-MW-008`.
 * MEASURED on 4e72ec6a, read from the emitted server JS:
 *   (a) `<program csrf="off" sessionExpiry="7d" session-secure="false">` + a protect= `<db>`
 *       → `__Host-scrml_sid` / Max-Age 3600 / `_scrml_session_expiry = "1h"`  (program: 7d plain)
 *   (b) root `<program … session-secure="false" sessionExpiry="7d">` + a protect= member page
 *       → root `scrml_sid`/604800, member `__Host-scrml_sid`/3600 — ONE app, two cookie names:
 *       a login on the root never authenticates the member (executed below)
 *   (c) two programs, one declaring 7d/plain, one declaring nothing + protect= → NO `E-MW-008`
 *       in either input order
 *   nearest sibling: `<page auth="required">` over protect= inside `<program sessionExpiry="7d">`
 *       → 3600, and as a member page of (b)'s root → the same split as (b).
 *
 * ── THE FIX
 * 8b sets a session field ONLY when the unit itself declares it, so the shared resolver
 * falls through to the unit's `<program>` / the program stash; `emit-server`'s
 * `_scrml_session_expiry` goes through the same resolver instead of reading the entry.
 * The auto-escalated GATE is unchanged (auth="required", csrf="auto", the warning). 8a
 * (`<program auth="required">`) still fills the §20.5 defaults — those are that program's
 * own answer, which is why two `auth="required"` programs compile (SPEC E-MW-008 row).
 * Direction: never less secure than the unit's own program declares; nothing declared →
 * `__Host-` / Secure / 1h.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "conf-session-8b-")); });
afterAll(() => {
  // Best-effort: the runtime case imports emitted server modules that hold bun:sqlite
  // handles open for the life of the process on Windows (EBUSY on rmSync).
  try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// The `<db>` needs a real schema at compile time.
function seedDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, password_hash TEXT)");
  db.close();
}

let _n = 0;
function writeFixture(name, files, order) {
  const root = join(TMP, `${name}-${order}-${_n++}`);
  const inputFiles = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    seedDb(join(dirname(abs), "app.db"));
    writeFileSync(abs, src);
    inputFiles.push(abs);
  }
  inputFiles.sort();
  if (order === "rev") inputFiles.reverse();
  return { root, inputFiles };
}
function compileFixture(name, files, order = "fwd") {
  const { root, inputFiles } = writeFixture(name, files, order);
  return compileScrml({ inputFiles, outputDir: join(root, "dist"), write: false, log: () => {} });
}

function serverJsFor(result, suffix) {
  for (const [path, out] of result.outputs) {
    if (path.replace(/\\/g, "/").endsWith(suffix)) return out.serverJs ?? "";
  }
  return null;
}
// Read from the EMITTED TEXT.
function cookieNames(js) {
  return [...new Set([...String(js).matchAll(/(?:__Host-)?scrml_sid/g)].map((m) => m[0]))].sort();
}
function maxAgeSecs(js) {
  return [...new Set([...String(js).matchAll(/_scrml_session_max_age\s*=\s*(\d+)/g)].map((m) => m[1]))].sort();
}
function expiryConst(js) {
  return [...String(js).matchAll(/const _scrml_session_expiry = ([^;]*);/g)].map((m) => m[1]);
}
const allDiags = (r) => [...(r.errors ?? []), ...(r.warnings ?? []), ...(r.lintDiagnostics ?? [])];
const hardErrors = (r) => allDiags(r).filter((d) => !/^[WI]-/.test(d.code ?? ""));
const codes = (r) => hardErrors(r).map((d) => d.code).sort();
const warnCodes = (r) => allDiags(r).map((d) => d.code);

const SECURE = ["__Host-scrml_sid"];
const PLAIN = ["scrml_sid"];

// A protect= `<db>` block with a reader and a minting server function.
const DB = `<db src="./app.db" tables="users" protect="password_hash">
  \${
    server function loadNames() {
      <rows> = ?{\`SELECT id, name FROM users\`}.all()
      return @rows
    }
    server function login() {
      session.set("userId", 1)
      return true
    }
  }
  <button onclick=loadNames()>go</button>
  <button onclick=login()>in</button>
</>`;

// (a) one program declaring 7d / plain over a protect= `<db>`.
const SINGLE_PROTECT = `<program csrf="off" sessionExpiry="7d" session-secure="false">
${DB}
</program>`;

// (b) a root declaring 7d / plain that mints; members below it.
const ROOT = `<program auth="optional" csrf="off" session-secure="false" sessionExpiry="7d">
  \${
    server function rootLogin() { session.set("userId", 1); return true }
  }
  <div><button onclick=rootLogin()>x</button><outlet/></div>
</program>`;
const MEMBER_PROTECT = `<page>
${DB}
</page>`;
const MEMBER_PAGE_REQUIRED = `<page auth="required">
${DB}
</page>`;

// (c) a second, unrelated program that declares both attributes.
const DECLARING = `<program auth="optional" csrf="off" sessionExpiry="7d" session-secure="false">
  \${ server function aLogin() { session.set("userId", 1); return true } }
  <div><button onclick=aLogin()>a</button></div>
</program>`;
const PROTECT_DECLARES_NOTHING = `<program csrf="off">
${DB}
</program>`;

describe("CONF-SESSION-8B-DEFERS-TO-PROGRAM §20.5.1 — the unit's own program governs", () => {
  test("(a) a protect= unit takes its OWN program's 7d / plain cookie; the auto-escalated gate stays", () => {
    const r = compileFixture("a-single", { "index.scrml": SINGLE_PROTECT });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    expect(js).toBeTruthy();
    // On 4e72ec6a: ["__Host-scrml_sid"], ["3600"], ['"1h"'].
    expect(cookieNames(js)).toEqual(PLAIN);
    expect(maxAgeSecs(js)).toEqual(["604800"]);
    expect(expiryConst(js)).toEqual(['"7d"']);
    // The gate itself is not what changed.
    expect(js).toContain("function _scrml_auth_check(req)");
    expect(js).toContain("function _scrml_validate_csrf(req, session)");
    expect(warnCodes(r)).toContain("W-AUTH-MIDDLEWARE-AUTO-INJECTED");
  });

  for (const order of ["fwd", "rev"]) {
    test(`(b) a protect= member page and its root read ONE cookie (${order})`, () => {
      const r = compileFixture("b-member", { "index.scrml": ROOT, "pages/secret.scrml": MEMBER_PROTECT }, order);
      expect(codes(r)).toEqual([]);
      const root = serverJsFor(r, "/index.scrml");
      const member = serverJsFor(r, "pages/secret.scrml");
      expect(member).toContain("function _scrml_auth_check(req)");
      expect(cookieNames(root)).toEqual(PLAIN);
      // On 4e72ec6a the member was ["__Host-scrml_sid"] / ["3600"] — the #282 split.
      expect(cookieNames(member)).toEqual(PLAIN);
      expect(maxAgeSecs(member)).toEqual(["604800"]);
      expect(maxAgeSecs(root)).toEqual(["604800"]);
    });
  }

  for (const order of ["fwd", "rev"]) {
    test(`(c) two programs, one declaring nothing + protect= → E-MW-008 (${order})`, () => {
      const r = compileFixture("c-two", { "aaa.scrml": DECLARING, "sub/zzz.scrml": PROTECT_DECLARES_NOTHING }, order);
      // On 4e72ec6a: [] — the stamped defaults made `zzz` look attributable.
      expect(codes(r)).toEqual(["E-MW-008"]);
      const m = String(hardErrors(r).find((d) => d.code === "E-MW-008").message);
      expect(m).toContain("zzz.scrml");
    });
  }

  test("sibling — `<page auth=\"required\">` over protect= inside a 7d program takes 7d", () => {
    const r = compileFixture("s1-page-req", {
      "index.scrml": `<program csrf="off" sessionExpiry="7d">\n<page auth="required">\n${DB}\n</page>\n</program>`,
    });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    // On 4e72ec6a: ["3600"]. The page declares no cookie mode; the program declares none
    // either, so the SECURE default stands.
    expect(maxAgeSecs(js)).toEqual(["604800"]);
    expect(cookieNames(js)).toEqual(SECURE);
    expect(js).toContain("function _scrml_auth_check(req)");
    // An explicit page auth= is not auto-injected.
    expect(warnCodes(r)).not.toContain("W-AUTH-MIDDLEWARE-AUTO-INJECTED");
  });

  test("sibling — a `<page auth=\"required\">` protect= MEMBER page reads its root's cookie", () => {
    const r = compileFixture("s2-page-req-member", { "index.scrml": ROOT, "pages/secret.scrml": MEMBER_PAGE_REQUIRED });
    expect(codes(r)).toEqual([]);
    const member = serverJsFor(r, "pages/secret.scrml");
    expect(member).toContain("function _scrml_auth_check(req)");
    // On 4e72ec6a: ["__Host-scrml_sid"] / ["3600"].
    expect(cookieNames(member)).toEqual(PLAIN);
    expect(maxAgeSecs(member)).toEqual(["604800"]);
  });
});

describe("CONF-SESSION-8B-DEFERS-TO-PROGRAM — controls (the defaults and 8a are unchanged) + direction", () => {
  test("control — protect= with nothing declared anywhere keeps __Host- / Secure / 1h", () => {
    const r = compileFixture("ctl-nothing", { "index.scrml": PROTECT_DECLARES_NOTHING });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    expect(cookieNames(js)).toEqual(SECURE);
    expect(maxAgeSecs(js)).toEqual(["3600"]);
    expect(expiryConst(js)).toEqual(['"1h"']);
    expect(warnCodes(r)).toContain("W-AUTH-MIDDLEWARE-AUTO-INJECTED");
  });

  test("direction — a secure 30m program's protect= unit takes 30m and STAYS secure (never weaker than its program)", () => {
    const r = compileFixture("dir-secure", {
      "index.scrml": `<program csrf="off" sessionExpiry="30m" session-secure="true">\n${DB}\n</program>`,
    });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    expect(cookieNames(js)).toEqual(SECURE);
    // On 4e72ec6a: ["3600"] — the stamped 1h outranked the program's shorter 30m.
    expect(maxAgeSecs(js)).toEqual(["1800"]);
  });

  test("control — 8a: `<program auth=\"required\">` declaring nothing keeps its own defaults", () => {
    const r = compileFixture("ctl-8a", { "index.scrml": `<program auth="required" csrf="auto">\n${DB}\n</program>` });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    expect(cookieNames(js)).toEqual(SECURE);
    expect(maxAgeSecs(js)).toEqual(["3600"]);
  });

  for (const order of ["fwd", "rev"]) {
    test(`control — an \`auth="required"\` program declaring nothing beside a declaring one still compiles (${order})`, () => {
      // SPEC E-MW-008: such a program resolves for itself (8a registers its defaults).
      const r = compileFixture("ctl-8a-two", {
        "aaa.scrml": DECLARING,
        "sub/zzz.scrml": `<program auth="required" csrf="auto">\n${DB}\n</program>`,
      }, order);
      expect(codes(r)).toEqual([]);
      expect(cookieNames(serverJsFor(r, "sub/zzz.scrml"))).toEqual(SECURE);
      expect(cookieNames(serverJsFor(r, "/aaa.scrml"))).toEqual(PLAIN);
    });
  }
});

// ── RUNTIME — the functional impact of (b): a login on the root must authenticate the
// protect= member. On 4e72ec6a the member's reader was specialized to `__Host-scrml_sid`
// while the root minted `scrml_sid`, so the member's document guard answered 302.
describe("CONF-SESSION-8B-DEFERS-TO-PROGRAM — runtime", () => {
  test("runtime — the root's login cookie opens the protect= member (no lockout)", async () => {
    if (typeof globalThis.document !== "undefined") return; // happy-dom-polluted worker

    const { root, inputFiles } = writeFixture("rt-b", { "index.scrml": ROOT, "pages/secret.scrml": MEMBER_PROTECT }, "fwd");
    const dist = join(root, "dist");
    const result = compileScrml({ inputFiles, outputDir: dist, write: true, log: () => {} });
    expect(codes(result)).toEqual([]);
    // The emitted `<db>` handle is CWD-relative (`sqlite:./app.db`).
    copyFileSync(join(root, "app.db"), join(dist, "app.db"));

    const walk = (d, acc = []) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, acc); else acc.push(p);
      }
      return acc;
    };
    const all = walk(dist).map((p) => p.replace(/\\/g, "/"));
    const rootServer = all.find((p) => p.endsWith("/index.server.js"));
    const memberServer = all.find((p) => p.endsWith("/secret.server.js"));
    expect(rootServer).toBeTruthy();
    expect(memberServer).toBeTruthy();

    const cwdBefore = process.cwd();
    process.chdir(dist);
    try {
      const bust = `?v=${Date.now()}-${Math.random()}`;
      const rootMod = await import(`file:///${rootServer}${bust}`);
      const memberMod = await import(`file:///${memberServer}${bust}`);
      const routes = Object.values(rootMod).filter(
        (v) => v && typeof v === "object" && typeof v.path === "string" && typeof v.handler === "function",
      );
      const login = routes.find((r) => /rootLogin/i.test(r.path));
      expect(login).toBeDefined();

      const TOKEN = "s438-csrf";
      const resp = await login.handler(new Request(`http://localhost${login.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, Cookie: `scrml_csrf=${TOKEN}` },
        body: JSON.stringify({}),
      }));
      expect(resp.status).toBe(200);
      const setCookies = resp.headers.getSetCookie
        ? resp.headers.getSetCookie()
        : [resp.headers.get("set-cookie")].filter(Boolean);
      const sid = setCookies.find((c) => /scrml_sid=/.test(c));
      expect(sid).toBeTruthy();
      expect(sid).toMatch(/^scrml_sid=/);
      expect(sid).toContain("Max-Age=604800");
      const pair = sid.split(";")[0];

      // Unauthenticated → the member's document guard redirects (the gate is live) …
      const guard = memberMod._scrml_protected_document.guard;
      const anon = guard(new Request("http://localhost/secret"));
      expect(anon && anon.status).toBe(302);
      // … and the root's session cookie is ACCEPTED. On 4e72ec6a this was a 302 (lockout).
      const authed = guard(new Request("http://localhost/secret", { headers: { Cookie: pair } }));
      expect(authed).toBeNull();
    } finally {
      process.chdir(cwdBefore);
    }
  });
});

// ── S438 review F1 — 2+ `<program>` nodes in ONE file keep the stamped secure defaults.
// The resolver's step 2 (`readRawUnitSessionAttr`) answers with the LAST declaring
// `<program>` in document order (g-two-programs-one-file-session-attr-last-wins; what a
// second `<program>` in one file means is reserved for E-PROGRAM-002). c9d97065 removed
// 8b's stamp everywhere, so a protect= unit whose FIRST program declares
// `session-secure="true" sessionExpiry="15m"` fell through to a LATER program's
// `session-secure="false" sessionExpiry="30d"`: `scrml_sid` / 2592000, zero diagnostics,
// and the gate accepted a plain (sibling-subdomain-plantable) `scrml_sid` — the
// cookie-tossing vector `__Host-` closes (§20.5.1). Measured on 37d1a83a (pre-fix base):
// `__Host-scrml_sid` / 3600 — which is what these units are pinned to again.
const SECURE_15M = `<program csrf="off" session-secure="true" sessionExpiry="15m">
${DB}
</program>`;
const PLAIN_30D = `<program csrf="off" auth="optional" session-secure="false" sessionExpiry="30d"><p>x</p></program>`;
const TWO_IN_FILE = {
  "sibling-after": `${SECURE_15M}\n${PLAIN_30D}\n`,
  "nested": SECURE_15M.replace("\n</program>", `\n<div>${PLAIN_30D}</div>\n</program>`),
};

describe("CONF-SESSION-8B-DEFERS-TO-PROGRAM — 2+ <program>s in one file keep the stamped secure gate (S438 F1)", () => {
  // The reverse in-file order (plain 30d program FIRST): the file's `authConfig` is the
  // first program's `auth="optional"`, so 8b does not escalate at all and registers no
  // entry — identical on the pre-fix base; that is g-two-programs-one-file-session-attr-
  // last-wins territory (E-PROGRAM-002), not this fix's. Pinned so the cookie at least
  // never goes plain: step 2's last-wins lands on the SECURE 15m program here.
  test("emitted: plain program FIRST → no escalation (as on base), cookie stays __Host-", () => {
    const r = compileFixture("f1-sibling-before", { "index.scrml": `${PLAIN_30D}\n${SECURE_15M}\n` });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    expect(cookieNames(js)).toEqual(SECURE);
    expect(maxAgeSecs(js)).toEqual(["900"]);
  });

  test("emitted: the `<page auth=\"required\">` limb, nested plain 30d program → __Host-scrml_sid / 3600", () => {
    // Same carve-out, 8b's other limb. On c9d97065: ["scrml_sid"] / ["2592000"].
    const src = `<program csrf="off" sessionExpiry="15m">\n<page auth="required">\n${DB}\n</page>\n<div>${PLAIN_30D}</div>\n</program>`;
    const r = compileFixture("f1-page-req-nested", { "index.scrml": src });
    expect(codes(r)).toEqual([]);
    const js = serverJsFor(r, "/index.scrml");
    expect(js).toContain("function _scrml_auth_check(req)");
    expect(cookieNames(js)).toEqual(SECURE);
    expect(maxAgeSecs(js)).toEqual(["3600"]);
  });

  for (const [shape, src] of Object.entries(TWO_IN_FILE)) {
    test(`emitted: ${shape} → __Host-scrml_sid / 3600, never the later program's plain 30d`, () => {
      const r = compileFixture(`f1-${shape}`, { "index.scrml": src });
      expect(codes(r)).toEqual([]);
      const js = serverJsFor(r, "/index.scrml");
      expect(js).toContain("function _scrml_auth_check(req)");
      // On c9d97065 (sibling-after, nested): ["scrml_sid"] / ["2592000"].
      expect(cookieNames(js)).toEqual(SECURE);
      expect(maxAgeSecs(js)).toEqual(["3600"]);
      expect(expiryConst(js)).toEqual(['"1h"']);
    });
  }

  for (const shape of ["sibling-after", "nested"]) {
    test(`executed: ${shape} — a planted plain scrml_sid is REFUSED (302); the __Host- one is accepted`, async () => {
      if (typeof globalThis.document !== "undefined") return; // happy-dom-polluted worker

      const { root, inputFiles } = writeFixture(`f1-rt-${shape}`, { "index.scrml": TWO_IN_FILE[shape] }, "fwd");
      const dist = join(root, "dist");
      const result = compileScrml({ inputFiles, outputDir: dist, write: true, log: () => {} });
      expect(codes(result)).toEqual([]);
      copyFileSync(join(root, "app.db"), join(dist, "app.db"));

      const walk = (d, acc = []) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p, acc); else acc.push(p);
        }
        return acc;
      };
      const server = walk(dist).map((p) => p.replace(/\\/g, "/")).find((p) => p.endsWith("/index.server.js"));
      expect(server).toBeTruthy();

      const cwdBefore = process.cwd();
      process.chdir(dist);
      try {
        const mod = await import(`file:///${server}?v=${Date.now()}-${Math.random()}`);
        // Plant an authenticated session record directly in the durable store the
        // module just opened (namespace "session", ms expiry) — an attacker who can
        // toss a cookie needs only a sid the store resolves.
        const store = walk(dist).find((p) => p.endsWith(".scrml-sessions.db"));
        expect(store).toBeTruthy();
        const SID = `planted-${Math.random().toString(36).slice(2)}`;
        const db = new Database(store);
        db.run("INSERT OR REPLACE INTO kv_store (namespace, key, value, expires_at) VALUES (?, ?, ?, ?)",
          ["session", SID, JSON.stringify({ userId: 7 }), Date.now() + 3600_000]);
        db.close();

        const guard = mod._scrml_protected_document.guard;
        // On c9d97065 this was null — the plain cookie authenticated.
        const plain = guard(new Request("http://localhost/", { headers: { Cookie: `scrml_sid=${SID}` } }));
        expect(plain && plain.status).toBe(302);
        // Positive control: the plant itself resolves under the hardened name.
        const hardened = guard(new Request("http://localhost/", { headers: { Cookie: `__Host-scrml_sid=${SID}` } }));
        expect(hardened).toBeNull();
      } finally {
        process.chdir(cwdBefore);
      }
    });
  }
});
