/**
 * §20.5 / §20.5.1 — the session config is PROGRAM-scoped, not per-compilation-unit.
 * S433, three defects of one class, all silent at HTTP 200 with zero diagnostics:
 *
 *   g-session-store-keyed-per-compilation-unit-not-per-program (HIGH, security)
 *     The durable store path was built from `import.meta.dir` — the EMITTING
 *     module's own directory. A nested page emits to `dist/admin/`, so it opened a
 *     SECOND `.scrml-sessions.db` with its own session namespace: a user logged in
 *     on the root unit read `session.isAuth === false` FOREVER. SPEC §20.5: "The
 *     READ middleware and the WRITE path SHALL consult the SAME durable store (a
 *     login that mints a cookie the middleware cannot resolve is a defect)."
 *
 *   g-program-sessionexpiry-inert-on-separate-login-unit (MED)
 *     Max-Age came from `authMiddlewareEntry`, this unit's OWN route-inference
 *     output. A minting unit (a login page) declares no `auth=` and so has none →
 *     `<program sessionExpiry="7d">` yielded a 1h cookie on exactly the unit that
 *     mints it. Operator ruling S385 B5: propagate the program setting.
 *
 *   the cookie NAME (found while probing the class above)
 *     `session-secure=` was read from this unit's own nodes only, so a unit that
 *     declares nothing fell to the secure default: the write path set
 *     `__Host-scrml_sid` while the read middleware's compile-time-specialized regex
 *     matched `scrml_sid`. This one defeats the store fix ON ITS OWN.
 *
 * The store-path case is measured TWO WAYS, because each catches a different half:
 *  - the EMITTED text, so a regression is caught even where execution is skipped;
 *  - EXECUTION of both units in one process, which is the only thing that proves
 *    the session actually crosses the unit boundary.
 *
 * ⚑ And the store key is asserted to equal `path.join(distRoot, ".scrml-sessions.db")`
 * EXACTLY. The pre-fix expression concatenated a literal `/` onto `import.meta.dir`,
 * so on Windows the key was MIXED-SEPARATOR (`C:\…\dist/.scrml-sessions.db`) and no
 * consumer computing the path with `path.join` could find it — which is why the
 * sibling `session-secure-b4b5-roundtrip.test.js` B5 case died at a SETUP assertion
 * on Windows (its real CSRF assertion never ran) while passing on Linux CI. A key
 * asserted in ONE normal form is what keeps that gate from going hollow again.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";

import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
// Unique per RUN: the teardown can legitimately fail with EBUSY on Windows (the
// emitted module caches a live `bun:sqlite` handle on `globalThis` for the process
// lifetime), so a fixed path would leave last run's tree behind for this one to trip
// over. It also keeps the `startsWith(outDir)` store-key filter below unambiguous.
const TMP_ROOT = resolve(testDir, `_tmp_session_program_scope-${process.pid}-${Date.now().toString(36)}`);
let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  // The durable store is a REAL `bun:sqlite` handle held for the process lifetime
  // (the emitted module caches it on `globalThis`), so on Windows the `.db` file is
  // still locked at teardown and `rm` throws EBUSY. A cleanup failure is not a test
  // result — swallowing it is what keeps this suite from reporting a phantom
  // `(unnamed)` failure the way the sibling B4/B5 suite does on this platform.
  try {
    if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch { /* locked sqlite handle — the OS reclaims the temp tree */ }
});

const nonWarn = (errors) => errors.filter((e) => !/^[WI]-/.test(e.code ?? ""));

/**
 * Compile a MULTI-FILE program. `files` maps a source-relative POSIX path to its
 * text; the returned `serverPathFor` mirrors api.js `pathFor` (the `pages/` segment
 * is stripped from the dist dirname, the basename is not).
 */
function compileProgram(files, tag) {
  const tmpDir = resolve(TMP_ROOT, `${tag}-${++tmpCounter}`);
  const srcDir = resolve(tmpDir, "src");
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(outDir, { recursive: true });
  const inputFiles = [];
  for (const [rel, text] of Object.entries(files)) {
    const abs = resolve(srcDir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    inputFiles.push(abs);
  }
  const result = compileScrml({ inputFiles, write: true, outputDir: outDir, log: () => {} });
  const serverPathFor = (rel) => {
    const segs = rel.replace(/\.scrml$/, "").split("/");
    const base = segs.pop();
    const dirSegs = segs[0] === "pages" ? segs.slice(1) : segs;
    return join(outDir, ...dirSegs, `${base}.server.js`);
  };
  return { errors: result.errors ?? [], outDir, serverPathFor };
}

const readServer = (p) => readFileSync(p, "utf8");
const storeKeyExprOf = (src) =>
  src.split(/\r?\n/).find((l) => l.includes("const _scrml_session_db_path =")) ?? "";
const maxAgeOf = (src) =>
  Number(src.match(/const _scrml_session_max_age = (\d+);/)?.[1] ?? NaN);
const cookieNameOf = (src) =>
  src.match(/const _scrml_session_cookie_name|_scrml_read_session_id[\s\S]{0,200}?\(\?:\^\|;\\s\*\)(__Host-scrml_sid|scrml_sid)=/)?.[1]
  ?? src.match(/return `(__Host-scrml_sid|scrml_sid)=\$\{_newSid\}/)?.[1]
  ?? null;

// ---------------------------------------------------------------------------
// A two-unit program: the ROOT unit mints the session, a NESTED page reads it.
// The nested source is NOT under `pages/`, so it emits to `dist/admin/` — a
// different directory, and therefore a different `import.meta.dir`.
// ---------------------------------------------------------------------------
const ROOT_MINTS = `<program auth="optional" csrf="off" session-secure="false">
  \${
    export server function doLogin() {
      session.set("userId", "u-1")
      session.set("role", "admin")
      return "ok"
    }
  }
  <button onclick=doLogin()>login</button>
</program>`;

const NESTED_READS = `<page>
  \${
    export server function whoAmI() {
      return { auth: session.isAuth, uid: session.userId }
    }
  }
  <button onclick=whoAmI()>who</button>
</page>`;

describe("§20.5 — ONE durable session store per PROGRAM, not per compilation unit", () => {
  test("a nested unit and the root unit key the store on the SAME dist-root path", () => {
    const { errors, outDir, serverPathFor } = compileProgram(
      { "index.scrml": ROOT_MINTS, "admin/panel.scrml": NESTED_READS },
      "store-key",
    );
    expect(nonWarn(errors)).toEqual([]);

    const rootExpr = storeKeyExprOf(readServer(serverPathFor("index.scrml")));
    const nestedExpr = storeKeyExprOf(readServer(serverPathFor("admin/panel.scrml")));
    expect(rootExpr).not.toBe("");
    expect(nestedExpr).not.toBe("");

    // The nested unit ASCENDS one level; the root unit ascends none. Pre-fix BOTH
    // read a bare `import.meta.dir`, which is what made them differ at runtime.
    expect(rootExpr).toContain('""');
    expect(nestedExpr).toContain('".."');
    // The key is built by path.resolve, NOT string concatenation — the normalization
    // that keeps a Windows key comparable to a `path.join` key.
    expect(rootExpr).toContain("_scrmlSessionPathResolve");
    expect(rootExpr).not.toContain('+ "/.scrml-sessions.db"');
    expect(nestedExpr).not.toContain('+ "/.scrml-sessions.db"');
    expect(outDir.length).toBeGreaterThan(0);
  });

  test("EXECUTED: a session minted on the root unit resolves on the nested unit", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only

    const { errors, outDir, serverPathFor } = compileProgram(
      { "index.scrml": ROOT_MINTS, "admin/panel.scrml": NESTED_READS },
      "store-exec",
    );
    expect(nonWarn(errors)).toEqual([]);

    const v = `${Date.now()}-${Math.random()}`;
    const rootMod = await import(`file://${serverPathFor("index.scrml")}?v=${v}`);
    const nestedMod = await import(`file://${serverPathFor("admin/panel.scrml")}?v=${v}`);

    // ONE store for the program, and its key is the EXACT `path.join` spelling of
    // the dist-root path (the Windows mixed-separator regression guard).
    const expectedKey = join(outDir, ".scrml-sessions.db");
    const keys = Object.keys(globalThis.__scrml_session_stores ?? {});
    expect(keys).toContain(expectedKey);
    // Exactly one key belongs to THIS build's dist tree (other tests in the same
    // process register their own builds' stores on the same global).
    const mine = keys.filter((k) => k.startsWith(outDir));
    expect(mine).toEqual([expectedKey]);

    const routesOf = (mod) => mod.routes || Object.values(mod).filter((x) => x && x.path && x.handler);
    const routeFor = (mod, frag) => routesOf(mod).find((r) => r.path.includes(frag));
    const loginR = routeFor(rootMod, "doLogin");
    const whoR = routeFor(nestedMod, "whoAmI");
    expect(loginR).toBeTruthy();
    expect(whoR).toBeTruthy();

    const post = (route, headers, body) =>
      route.handler(new Request(`http://localhost${route.path}`, {
        method: "POST", headers, body: JSON.stringify(body ?? {}),
      }));
    const cookieVal = (resp, name) => {
      const all = typeof resp.headers.getSetCookie === "function"
        ? resp.headers.getSetCookie() : [resp.headers.get("Set-Cookie") ?? ""];
      for (const c of all) { const m = c.match(new RegExp(`${name}=([^;]*)`)); if (m) return { value: m[1], raw: c }; }
      return null;
    };

    // CSRF double-submit handshake (no `auth=required` → cookie token).
    const r0 = await post(loginR, { "Content-Type": "application/json" }, {});
    const csrf = cookieVal(r0, "scrml_csrf").value;
    const authed = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };

    const rLogin = await post(loginR, authed, {});
    expect(rLogin.status).toBe(200);
    const sid = cookieVal(rLogin, "scrml_sid");
    expect(sid).toBeTruthy();

    // THE ASSERTION: the NESTED unit, handed the cookie the ROOT unit minted,
    // resolves the session. Pre-fix this answered {auth:false, uid:null} at 200.
    const rWho = await post(whoR, {
      "Content-Type": "application/json",
      Cookie: `scrml_csrf=${csrf}; scrml_sid=${sid.value}`,
      "X-CSRF-Token": csrf,
    }, {});
    expect(rWho.status).toBe(200);
    expect(await rWho.json()).toEqual({ auth: true, uid: "u-1" });
  });
});

// ---------------------------------------------------------------------------
// The sessionExpiry / session-secure siblings: a `<program>` unit that declares
// both, and a SEPARATE `pages/login.scrml` that does the minting and declares
// neither. Note `pages/` IS stripped, so both units land at the dist root — the
// store path is uniform here even pre-fix, which isolates these two defects.
// ---------------------------------------------------------------------------
const PROGRAM_DECLARES = `<program auth="required" csrf="off" sessionExpiry="7d" loginRedirect="/login" session-secure="false">
  \${
    export server function whoAmI() {
      return { auth: session.isAuth, uid: session.userId }
    }
  }
  <button onclick=whoAmI()>who</button>
</program>`;

const LOGIN_MINTS = `<page>
  \${
    export server function doLogin() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=doLogin()>login</button>
</page>`;

describe("§20.5 — the program's sessionExpiry governs the MINTING unit", () => {
  test("a separate login unit emits the program's Max-Age, not the 1h default", () => {
    const { errors, serverPathFor } = compileProgram(
      { "index.scrml": PROGRAM_DECLARES, "pages/login.scrml": LOGIN_MINTS },
      "expiry",
    );
    expect(nonWarn(errors)).toEqual([]);

    const SEVEN_DAYS = 7 * 24 * 60 * 60; // 604800
    expect(maxAgeOf(readServer(serverPathFor("index.scrml")))).toBe(SEVEN_DAYS);
    // Pre-fix this was 3600: the login page carries no `auth=`, so it had no
    // authMiddlewareEntry and `parseSessionExpirySeconds(null)` returned the 1h
    // default — on the one unit that actually mints the cookie.
    expect(maxAgeOf(readServer(serverPathFor("pages/login.scrml")))).toBe(SEVEN_DAYS);
  });
});

describe("§20.5 — a unit's OWN sessionExpiry outranks a SIBLING program's (F1-1)", () => {
  // The program-wide stash answers with the FIRST declaring file in the compile set, so
  // it is only safe as the LAST resort. `session-secure` always had a per-unit raw read
  // between the middleware entry and the stash; `sessionExpiry` did not, and the
  // asymmetry was a live defect: a unit declaring its own `sessionExpiry` but carrying
  // no `auth=` (hence no middleware entry) skipped straight to the stash and was
  // governed by a sibling. MEASURED before the fix: `aaa` (30m) and `zzz` (7d) BOTH
  // emitted 1800, in both input orders.
  //
  // The cookie name is carried through as the CONTROL: it resolved correctly per unit
  // even pre-fix, which is what identified the missing step rather than a broken stash.
  const noAuthProgram = (expiry, secure) => `<program csrf="off" sessionExpiry="${expiry}" session-secure="${secure}">
  \${
    export server function doLogin() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=doLogin()>login</button>
</program>`;

  for (const order of [["aaa.scrml", "zzz.scrml"], ["zzz.scrml", "aaa.scrml"]]) {
    test(`each unit keeps its own Max-Age and cookie name — input order ${order.join(", ")}`, () => {
      const files = {
        "aaa.scrml": noAuthProgram("30m", "false"),
        "zzz.scrml": noAuthProgram("7d", "true"),
      };
      // Compile in the requested order to prove the result is order-INSENSITIVE.
      const ordered = {};
      for (const k of order) ordered[k] = files[k];
      const { errors, serverPathFor } = compileProgram(ordered, "own-expiry");
      expect(nonWarn(errors)).toEqual([]);

      const aaa = readServer(serverPathFor("aaa.scrml"));
      const zzz = readServer(serverPathFor("zzz.scrml"));

      expect(maxAgeOf(aaa)).toBe(30 * 60);          // 1800
      expect(maxAgeOf(zzz)).toBe(7 * 24 * 60 * 60); // 604800 — was 1800 pre-fix
      expect(cookieNameOf(aaa)).toBe("scrml_sid");
      expect(cookieNameOf(zzz)).toBe("__Host-scrml_sid");
    });
  }
});

describe("§20.5.1 — the program's session-secure governs the cookie NAME on every unit", () => {
  test("both units agree on the cookie name the write path sets and the read path matches", () => {
    const { errors, serverPathFor } = compileProgram(
      { "index.scrml": PROGRAM_DECLARES, "pages/login.scrml": LOGIN_MINTS },
      "cookie-name",
    );
    expect(nonWarn(errors)).toEqual([]);

    const progSrc = readServer(serverPathFor("index.scrml"));
    const loginSrc = readServer(serverPathFor("pages/login.scrml"));

    // `session-secure="false"` → the PLAIN name, on BOTH units. Pre-fix the login
    // unit emitted `__Host-scrml_sid` (the secure default) because it read the
    // attribute from its OWN nodes only — so the writer set `__Host-scrml_sid` and
    // the program unit's reader matched `scrml_sid`. Unresolvable either way.
    expect(cookieNameOf(progSrc)).toBe("scrml_sid");
    expect(cookieNameOf(loginSrc)).toBe("scrml_sid");
    expect(loginSrc).not.toContain("__Host-scrml_sid");

    // The READ middleware's regex is compile-time specialized to the same name.
    expect(progSrc).toContain("(?:^|;\\s*)scrml_sid=");
    expect(loginSrc).toContain("(?:^|;\\s*)scrml_sid=");
  });

  test("the secure DEFAULT is unchanged when no unit declares session-secure", () => {
    const NO_DECL = PROGRAM_DECLARES.replace(' session-secure="false"', "");
    const { errors, serverPathFor } = compileProgram(
      { "index.scrml": NO_DECL, "pages/login.scrml": LOGIN_MINTS },
      "cookie-default",
    );
    expect(nonWarn(errors)).toEqual([]);
    for (const rel of ["index.scrml", "pages/login.scrml"]) {
      expect(cookieNameOf(readServer(serverPathFor(rel)))).toBe("__Host-scrml_sid");
    }
  });
});
