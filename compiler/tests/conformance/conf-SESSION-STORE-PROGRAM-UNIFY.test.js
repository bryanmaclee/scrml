/**
 * CONF-SESSION-STORE-PROGRAM-UNIFY | §20.5 — one program, one durable store (#282)
 *
 * SPEC §20.5: "The READ middleware and the WRITE path SHALL consult the SAME
 * durable store (a login that mints a cookie the middleware cannot resolve is a
 * defect)." In a COMPOSED multi-page app this SHALL is CROSS-UNIT: the login page
 * (the WRITE unit — `session.set`) and every read-only page (the READ units —
 * `session.isAuth` / `session.userId`) are separate compilation units, each with
 * its own `*.server.js`. They must all emit the IDENTICAL session-store expression
 * (same global, same path key) so a cookie minted by the writer resolves in the
 * readers' middleware.
 *
 * The #282 defect: the store choice (durable path-keyed SQLite vs in-memory Map)
 * was computed PER COMPILATION UNIT (`astUsesSessionWrite(fileAST)` scanned only
 * THIS unit's AST). So the ONE unit that wrote the session emitted the durable
 * path-keyed store (`globalThis.__scrml_session_stores[_scrml_session_db_path]`),
 * while every read-only unit emitted a fresh in-memory `Map` on a DIFFERENTLY-named
 * global (`globalThis.__scrml_session_store`). Readers never saw the minted session
 * → `session.isAuth` stayed false forever, `session.userId` null, 0 errors / 0
 * warnings.
 *
 * The fix makes session establishment a PROGRAM property: the driver pre-scans ALL
 * units once, and if ANY unit writes the session, EVERY server unit emits the
 * durable path-keyed store. A truly session-less program keeps the in-memory Map
 * (no unrequested on-disk store / startup I/O).
 *
 * Firing site: the program-wide `_programAnySessionWrite` pre-scan in
 * codegen/index.ts, consumed by `_anySessionWrite` in codegen/emit-server.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "conf-session-store-unify-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

// Write a fixture directory and return { inputFiles, result }. Compiles the
// WHOLE directory as one program (write:false).
function compileFixture(name, files) {
  const root = join(TMP, name);
  const inputFiles = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
    inputFiles.push(abs);
  }
  inputFiles.sort();
  const result = compileScrml({ inputFiles, outputDir: join(root, "dist"), write: false, log: () => {} });
  return { inputFiles, result };
}

// Pull the emitted serverJs for the unit whose source path ends with `suffix`.
function serverJsFor(result, suffix) {
  for (const [path, out] of result.outputs) {
    if (path.replace(/\\/g, "/").endsWith(suffix)) return out.serverJs ?? "";
  }
  return null;
}

const nonWarn = (errs) => (errs ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));

const DURABLE = "globalThis.__scrml_session_stores";      // plural, path-keyed
const MAP_STORE = "globalThis.__scrml_session_store ??= new Map()"; // singular Map

// ---------------------------------------------------------------------------
// Composed auth app: a WRITE page (login, `session.set`) + a READ-only page
// (`session.isAuth` / `session.userId`). Program-level auth=required applies the
// session middleware to both.
// ---------------------------------------------------------------------------
const WRITER = `<program db="sqlite:./t.db" auth="required" loginRedirect="/login" sessionExpiry="7d">
<schema>
  ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)\`}
</schema>
<db src="sqlite:./t.db" tables="users">
  \${
    server function doLogin() {
      let row = ?{\`SELECT id, email FROM users WHERE email = \${"a@b.test"}\`}.get()
      if (row is not) return { error: "no" }
      session.set("userId", row.id)
      return { ok: true }
    }
  }
  <div><button onclick=doLogin()>sign in</button><outlet/></div>
</db>
</program>`;

// A read-only unit: it only READS the session (`session.isAuth` / `session.userId`).
// The bare `session` read server-escalates the fn and forces session infra ON (§20.5
// WRITE-half gate), so this unit emits a session store WITHOUT writing the session —
// exactly the shape that regressed. No `<db>`/SQL, to keep the cross-page db-path
// resolution out of the picture (irrelevant to the store-unification defect).
const READER = `<page>
  \${
    <who> = not
    server function loadMe() {
      if (!session.isAuth) return not
      return session.userId
    }
    on mount { @who = loadMe() }
  }
  <div><p>\${@who}</p></div>
</page>`;

describe("CONF-SESSION-STORE-PROGRAM-UNIFY §20.5 (#282)", () => {
  test("both the WRITE unit and the READ-only unit emit the SAME durable path-keyed store", () => {
    const { result } = compileFixture("composed-auth", {
      "index.scrml": WRITER,
      "pages/reader.scrml": READER,
    });
    expect(nonWarn(result.errors)).toEqual([]);

    const writerJs = serverJsFor(result, "/index.scrml") ?? serverJsFor(result, "index.scrml");
    const readerJs = serverJsFor(result, "/reader.scrml") ?? serverJsFor(result, "reader.scrml");
    expect(writerJs).toBeTruthy();
    expect(readerJs).toBeTruthy();

    // The writer emits the durable path-keyed store (unchanged behavior).
    expect(writerJs).toContain(DURABLE);
    expect(writerJs).not.toContain(MAP_STORE);

    // #282 CORE: the read-only unit ALSO emits the durable path-keyed store —
    // NOT the singleton Map on a differently-named global.
    expect(readerJs).toContain(DURABLE);
    expect(readerJs).not.toContain(MAP_STORE);

    // The store expression must be BYTE-IDENTICAL across units (same global, same
    // path key) — a cookie minted by one resolves in the other.
    const line = (js) => js.split("\n").find((l) => l.includes("_scrml_session_store ="));
    expect(line(writerJs)).toBeTruthy();
    expect(line(writerJs)).toBe(line(readerJs));
    // Both units resolve the store beside their own bundle via the same path key.
    expect(readerJs).toContain("_scrml_session_db_path");
    expect(readerJs).toContain('from "bun:sqlite"');
  });

  test("negative control — a program that NEVER writes the session keeps the in-memory Map (no durable store)", () => {
    // Same two-page shape, auth=required, but NO session.set anywhere: read-only
    // auth. The store must stay the in-memory Map — no unrequested on-disk SQLite.
    const NOWRITE_WRITER = `<program db="sqlite:./t.db" auth="required" loginRedirect="/login">
<schema>
  ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)\`}
</schema>
<db src="sqlite:./t.db" tables="users">
  \${ server function listUsers() { return ?{\`SELECT id, email FROM users\`}.all() } }
  <div><button onclick=listUsers()>list</button><outlet/></div>
</db>
</program>`;
    const NOWRITE_READER = `<page>
  \${ <who> = not  server function loadMe() { if (!session.isAuth) return not; return session.userId }  on mount { @who = loadMe() } }
  <div><p>\${@who}</p></div>
</page>`;
    const { result } = compileFixture("readonly-auth", {
      "index.scrml": NOWRITE_WRITER,
      "pages/reader.scrml": NOWRITE_READER,
    });
    expect(nonWarn(result.errors)).toEqual([]);

    const writerJs = serverJsFor(result, "index.scrml");
    // The read middleware still emits (auth infra), but on the in-memory Map — NOT
    // the durable bun:sqlite store (no unrequested startup I/O).
    expect(writerJs).toContain(MAP_STORE);
    expect(writerJs).not.toContain(DURABLE);
    expect(writerJs).not.toContain(".scrml-sessions.db");
  });
});
