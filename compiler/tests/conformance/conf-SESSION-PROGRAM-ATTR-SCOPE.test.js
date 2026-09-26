/**
 * CONF-SESSION-PROGRAM-ATTR-SCOPE | §20.5 / §20.5.1 — `<program>` session config is
 * PROGRAM-scoped, never BUILD-scoped (the S436 security fix)
 *
 * THE DEFECT (measured, both input orders, zero hard errors and zero diagnostics
 * distinguishing the two runs): the S433 pre-scan in `codegen/index.ts` that makes
 * `sessionExpiry` / `session-secure` visible to a program's OTHER units iterated the
 * ENTIRE `files` array with no program-membership test and stamped the single
 * build-wide answer onto EVERY fileAST. So in a compile set holding TWO unrelated
 * programs, program A's `session-secure="false"` silently reconfigured program B:
 *
 *   - B compiled ALONE           → `__Host-scrml_sid` (correct, secure default)
 *   - A + B compiled TOGETHER    → B emitted plain `scrml_sid`
 *
 * `__Host-` is BROWSER-ENFORCED hardening (no Domain attribute, Path must be `/`,
 * always Secure). Losing it is a real security downgrade, not a cosmetic rename. The
 * same mechanism bled `sessionExpiry`: B inherited A's 604800 instead of its own
 * 3600 default.
 *
 * THE FIX: the pre-scan's inheritance is scoped to a SINGLE-program compile set. The
 * compiler has no reliable unit -> owning-`<program>` relation (see the standing note
 * at the shell-composition post-pass in `codegen/index.ts`: entry identity is a BUILD
 * fact per SPEC §40.8, inferred here from file CONTENT, and `E-PROGRAM-002` is
 * reserved-not-implemented so a second top-level `<program>` is silently tolerated),
 * so the fix FAILS CLOSED on the count: 0 or 1 `<program>`-bearing file in the set →
 * inheritance as before (byte-identical, the #282 multi-unit single-program case
 * this pre-scan exists for); 2 or more → no cross-unit inheritance at all, and every
 * unit resolves its OWN declaration or the language default.
 *
 * NOT CLOSED BY THIS TEST: the separate, already-filed and SPEC §20.5-disclosed
 * `g-session-store-namespace-not-discriminated-per-program` (two programs in one
 * dist sharing one `.scrml-sessions.db` and one `"session"` namespace). Different
 * mechanism, different fix.
 *
 * Firing site: the `<program>`-declaration count guard on `_readProgramAttr` in
 * codegen/index.ts, consumed by `_programSessionSecure` / `_programSessionExpiry`
 * in codegen/emit-server.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "conf-session-attr-scope-")); });
afterAll(() => {
  // Best-effort. The runtime case below `import`s an emitted `.server.js` that opens
  // a bun:sqlite session store, and Windows keeps that file handle open for the life
  // of the process — `rmSync` then throws EBUSY. A temp dir the OS will reap is not
  // worth failing a conformance run over.
  try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {}
});

let _n = 0;
// Compile a fixture directory as ONE compile set. `order: "rev"` feeds the same
// files in the opposite input order — the pre-scan took the FIRST match, so order
// is load-bearing evidence and every multi-program case is run both ways.
function compileFixture(name, files, order = "fwd") {
  const root = join(TMP, `${name}-${order}-${_n++}`);
  const inputFiles = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
    inputFiles.push(abs);
  }
  inputFiles.sort();
  if (order === "rev") inputFiles.reverse();
  return compileScrml({ inputFiles, outputDir: join(root, "dist"), write: false, log: () => {} });
}

// `result.outputs` is keyed by the SOURCE path, not the emitted `.server.js` path.
function serverJsFor(result, suffix) {
  for (const [path, out] of result.outputs) {
    if (path.replace(/\\/g, "/").endsWith(suffix)) return out.serverJs ?? "";
  }
  return null;
}

// Read the cookie NAME out of the EMITTED TEXT (never a summary field). `__Host-`
// swallows the bare token, so a secure build yields exactly ["__Host-scrml_sid"].
function cookieNames(js) {
  return [...new Set([...String(js).matchAll(/(?:__Host-)?scrml_sid/g)].map((m) => m[0]))].sort();
}
function maxAgeSecs(js) {
  return [...new Set([...String(js).matchAll(/_scrml_session_max_age\s*=\s*(\d+)/g)].map((m) => m[1]))].sort();
}
// A hard error is anything that is not a W-* warning or an I-* lint note. All three
// diagnostic channels are collected — `.errors` alone reports a false zero.
const hardErrors = (result) =>
  [...(result.errors ?? []), ...(result.warnings ?? []), ...(result.lintDiagnostics ?? [])]
    .filter((d) => !/^[WI]-/.test(d.code ?? ""));

const SECURE = ["__Host-scrml_sid"];
const PLAIN = ["scrml_sid"];
const DEFAULT_MAXAGE = ["3600"];   // the §20.5 1h default
const SEVEN_DAYS = ["604800"];

// Program A — declares BOTH attributes, and `session-secure="false"` is the
// downgrade that bled.
const PROG_A = `<program auth="optional" csrf="off" sessionExpiry="7d" session-secure="false">
  \${
    server function aLogin() {
      session.set("userId", 1)
      return { ok: true }
    }
  }
  <div><button onclick=aLogin()>a</button><outlet/></div>
</program>`;

// Program B — an UNRELATED program in a subdirectory. Declares NEITHER attribute,
// so it must resolve to the language defaults whatever else is in the compile set.
const PROG_B = `<program auth="optional" csrf="off">
  \${
    server function bLogin() {
      session.set("userId", 2)
      return { ok: true }
    }
  }
  <div><button onclick=bLogin()>b</button><outlet/></div>
</program>`;

// A NON-program unit of the SAME program (no `<program>` opener) that MINTS the
// session — the #282 / S433 shape the pre-scan was built for. It carries no
// declaration of its own and MUST keep inheriting the program's.
const MEMBER_MINTER = `<page>
  \${
    <ok> = not
    server function memberLogin() {
      session.set("userId", 3)
      return true
    }
    on mount { @ok = memberLogin() }
  }
  <div><p>\${@ok}</p></div>
</page>`;

describe("CONF-SESSION-PROGRAM-ATTR-SCOPE §20.5.1 — program-scoped, not build-scoped", () => {
  // -------------------------------------------------------------------------
  // Controls: each program compiled ALONE. These pin what "correct" means and
  // also prove the harness can SEE both cookie names and both Max-Ages, so a
  // later equality assertion is not reading a constant.
  // -------------------------------------------------------------------------
  test("control — B alone (declares neither attribute) gets the SECURE default", () => {
    const result = compileFixture("b-alone", { "sub/zzz.scrml": PROG_B });
    expect(hardErrors(result)).toEqual([]);
    const js = serverJsFor(result, "sub/zzz.scrml");
    expect(js).toBeTruthy();
    expect(cookieNames(js)).toEqual(SECURE);
    expect(maxAgeSecs(js)).toEqual(DEFAULT_MAXAGE);
  });

  test("control — A alone honours its OWN declarations (harness can see the downgrade)", () => {
    const result = compileFixture("a-alone", { "aaa.scrml": PROG_A });
    expect(hardErrors(result)).toEqual([]);
    const js = serverJsFor(result, "/aaa.scrml");
    expect(js).toBeTruthy();
    expect(cookieNames(js)).toEqual(PLAIN);
    expect(maxAgeSecs(js)).toEqual(SEVEN_DAYS);
  });

  // -------------------------------------------------------------------------
  // THE DEFECT — two unrelated programs in one compile set.
  // -------------------------------------------------------------------------
  for (const order of ["fwd", "rev"]) {
    test(`A + B in one compile set (input order: ${order}) — B keeps __Host- and its own 1h default`, () => {
      const result = compileFixture("a-plus-b", { "aaa.scrml": PROG_A, "sub/zzz.scrml": PROG_B }, order);
      expect(hardErrors(result)).toEqual([]);

      const bJs = serverJsFor(result, "sub/zzz.scrml");
      expect(bJs).toBeTruthy();
      // CORE (security): B declared no `session-secure`, so A's `"false"` must not
      // reach it. Pre-fix this was ["scrml_sid"] — the `__Host-` hardening gone.
      expect(cookieNames(bJs)).toEqual(SECURE);
      // CORE (the same mechanism, second attribute): B's expiry is its own default.
      expect(maxAgeSecs(bJs)).toEqual(DEFAULT_MAXAGE);

      // A is unaffected — it resolves its own declarations from its own file.
      const aJs = serverJsFor(result, "/aaa.scrml");
      expect(aJs).toBeTruthy();
      expect(cookieNames(aJs)).toEqual(PLAIN);
      expect(maxAgeSecs(aJs)).toEqual(SEVEN_DAYS);
    });
  }

  test("B's emitted session config is IDENTICAL whether B is compiled alone or beside A", () => {
    const alone = serverJsFor(compileFixture("iso-alone", { "sub/zzz.scrml": PROG_B }), "sub/zzz.scrml");
    const beside = serverJsFor(
      compileFixture("iso-beside", { "aaa.scrml": PROG_A, "sub/zzz.scrml": PROG_B }),
      "sub/zzz.scrml",
    );
    expect(alone).toBeTruthy();
    expect(beside).toBeTruthy();
    const sessionLines = (js) =>
      String(js).split(/\r?\n/).map((l) => l.trim()).filter((l) => /scrml_sid|_scrml_session_max_age/.test(l));
    expect(sessionLines(beside)).toEqual(sessionLines(alone));
  });

  // -------------------------------------------------------------------------
  // THE PRESERVED CASE — the #282 / S433 reason the pre-scan exists. ONE program
  // spread over several units: a member unit with no declaration of its own MUST
  // still inherit, or the writer and the reader disagree on the cookie name.
  // -------------------------------------------------------------------------
  for (const order of ["fwd", "rev"]) {
    test(`ONE program over two units (input order: ${order}) — the member unit STILL inherits (#282 preserved)`, () => {
      const result = compileFixture(
        "single-program-multi-unit",
        { "index.scrml": PROG_A, "pages/minter.scrml": MEMBER_MINTER },
        order,
      );
      expect(hardErrors(result)).toEqual([]);

      const progJs = serverJsFor(result, "/index.scrml");
      const memberJs = serverJsFor(result, "minter.scrml");
      expect(progJs).toBeTruthy();
      expect(memberJs).toBeTruthy();

      // Both units agree, and both carry the PROGRAM's declarations — the whole
      // point of the pre-scan. A regression here means the writer mints a cookie
      // the reader's compile-time-specialized regex cannot match.
      expect(cookieNames(progJs)).toEqual(PLAIN);
      expect(cookieNames(memberJs)).toEqual(PLAIN);
      expect(maxAgeSecs(progJs)).toEqual(SEVEN_DAYS);
      expect(maxAgeSecs(memberJs)).toEqual(SEVEN_DAYS);
    });
  }

  // -------------------------------------------------------------------------
  // RUNTIME — and the downgrade is WORSE than the cookie NAME. Executing the
  // emitted route pre-fix showed the bled `session-secure="false"` also strips the
  // `Secure` ATTRIBUTE from the `Set-Cookie` header, so B's session cookie was
  // transmissible over plain HTTP. Emit-inspection alone would have reported this
  // as "the `__Host-` prefix is missing" and understated it, so the header is
  // asserted from a real `Response`, not from emitted text.
  //
  // `write: true` + `chdir` + `import` the `.server.js` + a CSRF'd `Request` +
  // `route.handler` — the db-src-runtime-path-consistency recipe. NO happy-dom: its
  // globals strip CSRF and the handler answers 403.
  // -------------------------------------------------------------------------
  test("runtime — B's REAL Set-Cookie keeps `Secure` and `__Host-` even with program A in the set", async () => {
    if (typeof globalThis.document !== "undefined") return; // happy-dom-polluted worker

    const root = join(TMP, `runtime-${_n++}`);
    const src = join(root, "src");
    const inputFiles = [];
    for (const [rel, s] of Object.entries({ "aaa.scrml": PROG_A, "sub/zzz.scrml": PROG_B })) {
      const abs = join(src, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, s);
      inputFiles.push(abs);
    }
    inputFiles.sort();
    const dist = join(root, "dist");
    const result = compileScrml({ inputFiles, outputDir: dist, write: true, log: () => {} });
    expect(hardErrors(result)).toEqual([]);

    const walk = (d, acc = []) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, acc); else acc.push(p);
      }
      return acc;
    };
    const bServer = walk(dist).find((p) => p.replace(/\\/g, "/").endsWith("zzz.server.js"));
    expect(bServer).toBeTruthy();

    const cwdBefore = process.cwd();
    process.chdir(dist);
    try {
      const mod = await import(`file:///${bServer.replace(/\\/g, "/")}?v=${Date.now()}-${Math.random()}`);
      const routes = Object.values(mod).filter(
        (v) => v && typeof v === "object" && typeof v.path === "string" && typeof v.handler === "function",
      );
      const route = routes.find((r) => /bLogin/i.test(r.path)) ?? routes[0];
      expect(route).toBeDefined();

      const TOKEN = "s436-csrf";
      const resp = await route.handler(new Request(`http://localhost${route.path}`, {
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
      // Pre-fix this header was:
      //   scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800
      // — no `__Host-`, NO `Secure`, and A's 7-day lifetime.
      expect(sid).toContain("__Host-scrml_sid=");
      expect(sid).toMatch(/;\s*Secure\b/);
      expect(sid).toContain("Max-Age=3600");
      expect(sid).toContain("Path=/");
      expect(sid).not.toContain("Max-Age=604800");
    } finally {
      process.chdir(cwdBefore);
    }
  });
});
