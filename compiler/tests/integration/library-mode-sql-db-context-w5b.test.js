/**
 * W5b — library-mode `?{}` emission (module-with-db-context, §44.7.1).
 *
 * A `.scrml` library file (§21.5 pure-fn module — no `<program>`, exports
 * functions) MAY declare its own top-level `<db src="...">` and run `?{}` SQL
 * (module-with-db-context, §44.7.1). Before W5b, generateLibraryJs sliced the
 * whole logic block VERBATIM into the importable library `.js`, so the raw
 * `?{}` leaked into the client-facing artifact → invalid JS → the §2.2.1
 * E-CODEGEN-INVALID-LOGIC emit gate (or, gate-off, an unparseable `.js`).
 *
 * The fix (change-id w5b-library-db-emit-2026-07-04):
 *   - emit-library.ts prunes every fn whose BODY carries `?{}`/transaction from
 *     the library `.js` (it lives only in `.server.js`); a pure export / a
 *     `scrml:fs` import fn / an explicit-server fn with a pure body all STAY.
 *   - emit-server.ts retains the `?{}` fn's route-handler wrapper (server home)
 *     even when the `?{}` is nested in a const/let init (§12.6 intent).
 *   - collect.ts `containsSqlOrTransaction` — the shared deep SQL-node scan.
 *
 * These are the flogence-shaped R26 reproducers, encoded as regression tests.
 * `validateEmit: true` proves the §2.2.1 emit gate now passes (a leak would
 * abort the compile with E-CODEGEN-INVALID-LOGIC and write no artifacts).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
let DB;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lib-sql-db-w5b-"));
  DB = join(TMP, "test.db");
  const db = new Database(DB);
  db.run("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("INSERT INTO projects (name) VALUES ('alpha')");
  db.run("INSERT INTO projects (name) VALUES ('beta')");
  db.close();
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** Compile a single library `.scrml`, return artifact contents. */
function compileLib(name, source, extra = {}) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    // validateEmit ON — a leaked `?{}` would abort with E-CODEGEN-INVALID-LOGIC.
    validateEmit: true,
    log: () => {},
    ...extra,
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const libPath = join(outDir, `${name}.js`);
  const serverPath = join(outDir, `${name}.server.js`);
  return {
    errorCodes: errors.map((e) => e.code),
    libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
    serverExists: existsSync(serverPath),
    serverJs: existsSync(serverPath) ? readFileSync(serverPath, "utf8") : "",
  };
}

describe("W5b — library-mode `?{}` module-with-db-context (§44.7.1)", () => {
  // (1) The flogence R26 — bare `export function` + `?{}` + file-own `<db>`.
  test("(1) bare `export function` + `?{}` → clean library `.js`, real SQL in `.server.js`", () => {
    const src = `<db src="${DB}" tables="projects" />
\${
export function countProjects() {
  const r = ?{\`SELECT COUNT(*) AS c FROM projects\`}.get()
  return r.c
}
}`;
    const r = compileLib("w5b_bare", src);

    // (a) exit-0 — the §2.2.1 emit gate did not fire.
    expect(r.errorCodes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.errorCodes).toEqual([]);
    // (b) the client-facing library `.js` carries NO raw `?{}` / server fn body.
    expect(r.libExists).toBe(true);
    expect(r.libraryJs).not.toContain("?{");
    expect(r.libraryJs).not.toContain("SELECT COUNT");
    expect(r.libraryJs).not.toContain("countProjects");
    // (c) the `.server.js` still carries the real SQL + a route handler.
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).toContain("new SQL(");
    expect(r.serverJs).toContain("SELECT COUNT(*) AS c FROM projects");
    expect(r.serverJs).toContain("_scrml_handler_countProjects");
  });

  // (2) Explicit `export server function` + `?{}` (the leaked shape the dispatch
  // observed) — `.server.js` was already correct; the library `.js` must stop
  // dumping `export server function ... ?{...}` verbatim.
  test("(2) explicit `export server function` + `?{}` → clean library `.js`", () => {
    const src = `<db src="${DB}" tables="projects" />
\${
export server function countProjects() {
  const r = ?{\`SELECT COUNT(*) AS c FROM projects\`}.get()
  return r.c
}
}`;
    const r = compileLib("w5b_explicit", src);

    expect(r.errorCodes).toEqual([]);
    expect(r.libraryJs).not.toContain("?{");
    expect(r.libraryJs).not.toContain("export server function");
    expect(r.libraryJs).not.toContain("SELECT COUNT");
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).toContain("_scrml_handler_countProjects");
  });

  // (3) Adversarial — a library with BOTH a `?{}` server fn AND client-safe pure
  // fns: ONLY the SQL fn is sliced from the library `.js`; the pure fns stay.
  test("(3) mixed pure fns + `?{}` fn → only the SQL fn is pruned", () => {
    const src = `<db src="${DB}" tables="projects" />
\${
export function addOne(n) {
  return n + 1
}
export function countProjects() {
  const r = ?{\`SELECT COUNT(*) AS c FROM projects\`}.get()
  return r.c
}
export function double(n) {
  return n * 2
}
}`;
    const r = compileLib("w5b_mixed", src);

    expect(r.errorCodes).toEqual([]);
    // Pure client-safe exports survive.
    expect(r.libraryJs).toContain("export function addOne");
    expect(r.libraryJs).toContain("export function double");
    // The SQL fn is pruned — no leak.
    expect(r.libraryJs).not.toContain("?{");
    expect(r.libraryJs).not.toContain("countProjects");
    // Server half intact.
    expect(r.serverJs).toContain("SELECT COUNT(*) AS c FROM projects");
  });

  // (4) A pure-only library (no `?{}`) is entirely unaffected — every export
  // stays in the library `.js`, no `.server.js`.
  test("(4) pure-only library — all exports stay, no `.server.js`", () => {
    const src = `\${
export function addOne(n) {
  return n + 1
}
export function square(n) {
  return n * n
}
}`;
    const r = compileLib("w5b_pure", src);

    expect(r.errorCodes).toEqual([]);
    expect(r.libraryJs).toContain("export function addOne");
    expect(r.libraryJs).toContain("export function square");
    expect(r.serverExists).toBe(false);
  });

  // (5) W5a auto-detect-library — no explicit `mode`; the file auto-classifies
  // as a library (no `<program>`, exports-bearing) and the `?{}` still does not
  // leak into the client `.js`.
  test("(5) W5a auto-detect (no explicit mode) — `?{}` still pruned from client `.js`", () => {
    const src = `<db src="${DB}" tables="projects" />
\${
export function countProjects() {
  const r = ?{\`SELECT COUNT(*) AS c FROM projects\`}.get()
  return r.c
}
}`;
    // No `mode` passed — relies on W5a auto-detect.
    const r = compileLib("w5b_autodetect", src, { mode: undefined });

    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    expect(r.libraryJs).not.toContain("?{");
    expect(r.serverJs).toContain("SELECT COUNT(*) AS c FROM projects");
  });
});

describe("W5b — cross-file: a page imports a `?{}` library fn", () => {
  // (6) The page compiles in browser mode (mixed build); the library's `?{}` fn
  // reaches the page's client as a fetch-stub, NEVER as raw SQL. No server-only
  // symbol (`_scrml_sql` / `new SQL(`) appears in any client artifact.
  test("(6) page imports lib → client artifacts clean, server carries the SQL", () => {
    const libPath = join(TMP, "xlib.scrml");
    const pagePath = join(TMP, "xpage.scrml");
    writeFileSync(
      libPath,
      `<db src="${DB}" tables="projects" />
\${
export function countProjects() {
  const r = ?{\`SELECT COUNT(*) AS c FROM projects\`}.get()
  return r.c
}
}`,
    );
    writeFileSync(
      pagePath,
      `<program>
\${
import { countProjects } from "./xlib.scrml"
}
<page>
  <main>
    <button onClick={() => { let n = countProjects() }}>Count</button>
  </main>
</page>
</program>`,
    );
    const outDir = join(TMP, "xpage.dist");
    const result = compileScrml({
      inputFiles: [pagePath],
      outputDir: outDir,
      write: true,
      validateEmit: true,
      log: () => {},
    });
    const errors = (result.errors || []).filter(
      (e) => e.severity == null || e.severity === "error",
    );
    expect(errors.map((e) => e.code)).toEqual([]);

    // Every CLIENT artifact must be free of raw SQL and server-only symbols.
    for (const name of ["xlib.client.js", "xpage.client.js"]) {
      const p = join(outDir, name);
      expect(existsSync(p)).toBe(true);
      const js = readFileSync(p, "utf8");
      expect(js).not.toContain("?{");
      expect(js).not.toContain("_scrml_sql");
      expect(js).not.toContain("new SQL(");
    }
    // The lib server bundle carries the real SQL + a route handler.
    const serverJs = readFileSync(join(outDir, "xlib.server.js"), "utf8");
    expect(serverJs).toContain("SELECT COUNT(*) AS c FROM projects");
    expect(serverJs).toContain("_scrml_handler_countProjects");
  });
});
