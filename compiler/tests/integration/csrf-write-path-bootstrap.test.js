/**
 * Issue #2 (parent repo bryanmaclee/scrmlTS) — first mutation after page load
 * returns "403 CSRF validation failed"; the double-submit token bootstrap race.
 *
 * SYMPTOM (from the issue): on a freshly loaded page, initial reads succeed
 * (with mint-on-403 retry recovery) but the FIRST mutation 403s — and its retry
 * ALSO 403s — so the write never lands.
 *
 * ROOT CAUSE. The GITI-010 mint-on-403 retry is cookie-based: the read path
 * routes through `_scrml_fetch_with_csrf_retry`, which reads the freshly-planted
 * `scrml_csrf` cookie via `_scrml_get_csrf_token()`. But the WRITE path for a
 * non-monotone CPS batch (idempotency-key branch in emit-functions.ts) bypassed
 * that helper and read the token from `document.querySelector('meta[name=
 * "csrf-token"]')` — a tag emit-html.ts never emits. So the write path always
 * sent an EMPTY token, and its retry re-read the same empty tag → 403 twice.
 *
 * FIX (two parts):
 *   1. `_scrml_get_csrf_token()` (emit-client.ts) BOOTSTRAPS a same-origin
 *      double-submit token when no cookie exists, so the FIRST request — read
 *      or write — carries a cookie matching its X-CSRF-Token header. The
 *      baseline server gate only checks cookie===header, so it validates on the
 *      first POST: no 403 round-trip, no reliance on retry recovery.
 *   2. The idempotency-key write path (emit-functions.ts) reads the token from
 *      `_scrml_get_csrf_token()` (cookie) in baseline mode instead of the
 *      never-emitted meta tag, so it uses the same working source as reads.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
const TMP_ROOT = resolve(testDir, "_tmp_csrf_write_path");
let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compile(scrmlSource, testName, seedFiles = {}) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const db = new Database(resolve(tmpDir, fileName), { create: true });
    for (const s of stmts) db.exec(s);
    db.close();
  }
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  return {
    errors: result.errors ?? [],
    clientJs: readFileSync(join(outDir, `${tag}.client.js`), "utf-8"),
    serverJsPath: join(outDir, `${tag}.server.js`),
    tmpDir,
  };
}

const ITEMS_SEED = {
  "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"],
};

// A simple mutation (monotone INSERT) — routes through the cookie-based
// _scrml_fetch_with_csrf_retry helper.
const MUTATION_SRC = `<program>
<db src="./items.db" tables="items">
  \${
    server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

// A non-monotone CPS mutation with an idempotency store — exercises the
// idempotency-key write path that previously read the empty meta tag.
const NONMONOTONE_SRC = `<program idempotency-store="sqlite">
<db src="./items.db" tables="items">
  \${ @clicks = 0 }
  \${
    server function bump(id) {
      ?{\`UPDATE items SET name = name WHERE id = \${id}\`}.run()
      const after = ?{\`SELECT id FROM items WHERE id = \${id}\`}.get()
      @clicks = after.id
    }
  }
  <p>\${@clicks}</p>
  <button onclick=bump(1)>Bump</button>
</>
</program>`;

describe("Issue #2 — CSRF write-path bootstrap", () => {
  test("_scrml_get_csrf_token bootstraps a cookie when none exists", () => {
    const { clientJs, errors } = compile(MUTATION_SRC, "bootstrap", ITEMS_SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const helper = clientJs.match(/function _scrml_get_csrf_token\(\)[\s\S]+?\n\}/)[0];
    // The helper returns the existing cookie token up front, then mints + plants
    // one as the fallback when the cookie is absent.
    expect(helper).toContain("if (match) return decodeURIComponent");
    expect(helper).toContain("document.cookie =");
    expect(helper).toContain("scrml_csrf=");
    expect(helper).toContain("SameSite=Strict");
    expect(helper).toContain("crypto.randomUUID");
  });

  test("idempotency write path reads the token from the cookie, not the empty meta tag", () => {
    const { clientJs, errors } = compile(NONMONOTONE_SRC, "writepath", ITEMS_SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    // Confirm we actually exercised the idempotency-key branch.
    expect(clientJs).toContain("Idempotency-Key");
    const stub = clientJs.match(/async function _scrml_fetch_bump[\s\S]+?\n\}\n/)[0];
    // Both the initial token read and the retry read go through the cookie helper.
    const cookieReads = (stub.match(/_scrml_get_csrf_token\(\)/g) || []).length;
    expect(cookieReads).toBe(2);
    // The broken meta-tag read must be gone (baseline mode).
    expect(stub).not.toContain('meta[name="csrf-token"]');
  });

  test("runtime: first mutation from a freshly loaded page returns 200, not 403", async () => {
    // happy-dom-polluted globals strip CSRF headers (see
    // sql-server-fn-runtime.test.js) — the emit-shape tests above guard there.
    if (typeof globalThis.document !== "undefined") return;

    const { serverJsPath, clientJs, tmpDir, errors } = compile(MUTATION_SRC, "runtime", ITEMS_SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);

    const absDbPath = resolve(tmpDir, "items.db");
    writeFileSync(
      serverJsPath,
      readFileSync(serverJsPath, "utf-8").replace(
        'const _scrml_sql = new SQL("sqlite:./items.db");',
        `const _scrml_sql = new SQL(${JSON.stringify("sqlite:" + absDbPath)});`,
      ),
    );

    // Evaluate the client token helper in a fresh-page sandbox: empty cookie jar.
    const tokenFn = clientJs.match(/function _scrml_get_csrf_token\(\)[\s\S]+?\n\}/)[0];
    let cookieJar = "";
    const fakeDoc = {
      get cookie() { return cookieJar; },
      set cookie(v) {
        const pair = v.split(";")[0];
        cookieJar = cookieJar ? `${cookieJar}; ${pair}` : pair;
      },
    };
    const getToken = new Function(
      "document",
      "crypto",
      `${tokenFn}; return _scrml_get_csrf_token;`,
    )(fakeDoc, globalThis.crypto);

    // First client call bootstraps the token + plants the same-origin cookie.
    const token = getToken();
    expect(token).toBeTruthy();
    expect(cookieJar).toContain("scrml_csrf=");

    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const addRoute = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("addItem"),
    );
    // The browser auto-sends the bootstrapped cookie on a same-origin POST;
    // the client sets the matching X-CSRF-Token header. No prior request,
    // no 403 round-trip.
    const firstReq = new Request(`http://localhost${addRoute.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
        "Cookie": cookieJar,
      },
      body: JSON.stringify({ name: "alpha" }),
    });
    const resp = await addRoute.handler(firstReq);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toBe("ok");

    const verify = new Database(absDbPath);
    const rows = verify.query("SELECT name FROM items").all();
    verify.close();
    expect(rows).toEqual([{ name: "alpha" }]);
  });
});
