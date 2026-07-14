/**
 * §12.6 Library-mode Emission — body-escalated `.server.js` suppression.
 *
 * Ratified S145 (2026-05-30). In `--mode library`, a function escalated to the
 * server PURELY by body content — escalationReasons all
 * `kind:"server-only-resource"` (§12.2 Trigger 1: a server-only import like
 * `scrml:fs`; or Trigger 3: `?{}` SQL) and NO explicit `route=`/`server`
 * annotation — SHALL emit as a plain server-side export and SHALL NOT generate
 * the §12.3 HTTP route-handler / client fetch-stub bundle. An EXPLICIT
 * `export server function` (explicit-annotation reason) RETAINS the `.server.js`
 * wrapper (host `mount(server)` use case, Insight 22). App (browser) mode is
 * UNCHANGED.
 *
 * Grounding: §12.3 (the bundle is indivisible — no client, nothing fetches the
 * route in library mode), §13.4 (escalated callee with no wire caller → no
 * separate HTTP route), §21.5 (a library file's sole output is its exported
 * bindings), §44.7.1 (library server-route generation is a staged lifecycle).
 *
 * Scope guard: only the import-escalated shape (which emits cleanly as a plain
 * library export) is suppressed; a body whose top-level statement is a
 * server-only node (inline `?{}`/transaction) does NOT emit cleanly today
 * (W5a/W5b / E-CG-006 staged lifecycle) and keeps its current behavior.
 *
 * Mechanism: codegen/emit-server.ts isBodyOnlyEscalation() + the library-mode
 * skip in the per-fn loop; mode threaded from codegen/index.ts. Browser mode
 * is structurally unreachable by the gate (`effectiveMode === "library"`).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lib-server-js-12-6-"));
  // Real sqlite db so the browser-mode SQL-body fixture passes PA (E-PA-002).
  const db = new Database(join(TMP, "real.db"));
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
  db.close();
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compile(name, source, mode) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  // validateEmit:false — sidesteps the SEPARATE, out-of-scope pre-existing
  // defect where the library CLIENT `.js` emits `export server function`
  // verbatim (invalid JS). That defect is unrelated to wrapper suppression.
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    mode,
    validateEmit: false,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const serverPath = join(outDir, `${name}.server.js`);
  const libPath = join(outDir, `${name}.js`);
  return {
    errors: errors.map((e) => e.code),
    serverExists: existsSync(serverPath),
    serverJs: existsSync(serverPath) ? readFileSync(serverPath, "utf8") : "",
    libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
    outDir,
  };
}

describe("§12.6 Library-mode Emission — body-escalated .server.js suppression", () => {
  // (a) GITI-024 shape: plain `export function` importing `scrml:fs`.
  test("(a) library mode + body-only (scrml:fs import) → NO .server.js, clean library export", () => {
    const src = `\${
  import { readFileSync } from "scrml:fs"

  export function readLines(path) {
    const out = []
    for (const line of readFileSync(path, "utf8").split("\\n")) {
      out.push(line)
    }
    return out
  }
}`;
    const r = compile("a_giti024_bodyonly", src, "library");
    expect(r.errors).toEqual([]);
    // No HTTP-handler wrapper emitted.
    expect(r.serverExists).toBe(false);
    // The function survives as a plain export in the library .js.
    expect(r.libExists).toBe(true);
    expect(r.libraryJs).toContain("export function readLines");
    // The §12.3 handler boilerplate must NOT be present anywhere.
    expect(r.libraryJs).not.toContain("_scrml_handler_readLines");
    expect(r.libraryJs).not.toContain("new Response");
  });

  // (b) Explicit `export server function` → wrapper RETAINED.
  test("(b) library mode + explicit `export server function` → .server.js RETAINED", () => {
    const src = `\${
  export server function getThing(id) {
    return id
  }
}`;
    const r = compile("b_explicit_server", src, "library");
    expect(r.errors).toEqual([]);
    // The explicit endpoint keeps its handler (mount(server) use case).
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).toContain("_scrml_handler_getThing");
  });

  // (c1) Browser mode + body-content (SQL) escalation → .server.js unchanged.
  test("(c1) browser mode + SQL-body escalation → .server.js STILL emitted (no app regression)", () => {
    const src = `<program db="./real.db">
<schema>
  table users {
    id: integer primary key
    name: text
  }
</>
<db src="./real.db" tables="users">
\${
  function listUsers() {
    return ?{\`SELECT id, name FROM users\`}.all()
  }
}
</db>
<page>
  <main>
    <button onClick={() => { let u = listUsers() }}>Load</button>
  </main>
</page>
</program>`;
    const r = compile("c1_browser_sql", src, "browser");
    expect(r.errors).toEqual([]);
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).toContain("_scrml_handler_listUsers");
  });

  // (c2) Browser mode + explicit server fn → .server.js unchanged.
  test("(c2) browser mode + explicit server fn → .server.js STILL emitted (no app regression)", () => {
    const src = `<program>
<page>
\${
  server function compute(x) {
    return x + 1
  }
}
  <main>
    <button onClick={() => { let r = compute(2) }}>Go</button>
  </main>
</page>
</program>`;
    const r = compile("c2_browser_explicit", src, "browser");
    expect(r.errors).toEqual([]);
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).toContain("_scrml_handler_compute");
  });
});
