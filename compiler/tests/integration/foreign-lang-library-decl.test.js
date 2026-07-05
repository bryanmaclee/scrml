/**
 * §23.6 (S238) — Library Foreign-Language Declaration `<foreign lang="…">`.
 *
 * Surface 2 of the foreign-language declaration (independent of `kind="tool"`,
 * §64 Surface 1). A pure-fn library file (§21.5 — `export` fns, NO top-level
 * `<program>`) declares its `_{}` foreign-code language via a top-level,
 * self-closing `<foreign lang="ts" />` block — the `lang=` sibling of the
 * §44.7.1 module-with-db-context `<db src>`. This CLOSES E-FOREIGN-003 for the
 * library shape (previously a library `_{}` had no ancestor `<program lang>` to
 * resolve against and was un-emittable).
 *
 * Coverage:
 *   - Phase-0 pre-state guard: a library `_{}` with NO `<foreign lang>` still
 *     fires E-FOREIGN-003 (the greenfield §23.6 closes; unchanged).
 *   - E-FOREIGN-003 closure: `<foreign lang="ts" />` resolves the `_{}` lang;
 *     the lanes shape emits a valid ES module (the `_{}` lowers to its §23.2.4a
 *     async IIFE; the enclosing fn becomes `async`).
 *   - E-FOREIGN-LANG-DUPLICATE / E-FOREIGN-LANG-IN-PROGRAM rejects.
 *   - non-ts/js `<foreign lang>` follows §23.2.1 sidecar rules (E-FOREIGN-005).
 *   - fsp-core shape: `<foreign lang>` + `<db src>` + `?{}` + `_{}` — the
 *     SQL+foreign fn prunes to `.server.js` (both lowered), no leak in `.js`.
 *   - orthogonality: `<foreign lang>` alone / `<db src>` alone / both compose.
 *
 * The typer wiring lives in type-system.ts (checkForeignLangLibraryDecl +
 * resolveForeignLibraryLang); the emit wiring in codegen/emit-library.ts
 * (collectForeignNodes + collectAsyncFnKeywordTargets).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { Database } from "bun:sqlite";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
let DB_PATH;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "foreign-lang-lib-"));
  DB_PATH = join(TMP, "flogence.db");
  const db = new Database(DB_PATH);
  db.run("CREATE TABLE fsp_task (id INTEGER PRIMARY KEY, name TEXT)");
  db.close();
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compile(name, source, mode = "library") {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    mode,
    validateEmit: false,
    log: () => {},
  });
  const all = result.errors || [];
  const errors = all.filter((e) => e.severity == null || e.severity === "error");
  const serverPath = join(outDir, `${name}.server.js`);
  const libPath = join(outDir, `${name}.js`);
  return {
    errorCodes: errors.map((e) => e.code),
    serverExists: existsSync(serverPath),
    serverJs: existsSync(serverPath) ? readFileSync(serverPath, "utf8") : "",
    libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
    outDir,
  };
}

// `node --check` the string as an ES module (a `.mjs` forces module parsing, so
// a stray top-level `await` in a non-async function is a hard SyntaxError — the
// `.js` extension would be parsed CommonJS/sloppy and mask it).
function nodeCheckModule(name, js) {
  const p = join(TMP, `${name}.check.mjs`);
  writeFileSync(p, js);
  execFileSync(process.execPath, ["--check", p]); // throws on syntax error
}

describe("§23.6 — <foreign lang> library declaration", () => {
  // -------------------------------------------------------------------------
  // Phase-0 pre-state guard — library `_{}` with NO <foreign lang> → E-FOREIGN-003
  // -------------------------------------------------------------------------
  test("library `_{}` with NO <foreign lang> still fires E-FOREIGN-003", () => {
    const src = `\${
  export fn runOpen(model, prompt) {
    const out = _={ in: { model, prompt }
      model + " " + prompt
    }=
    return out
  }
}`;
    const r = compile("no_foreign", src);
    expect(r.errorCodes).toContain("E-FOREIGN-003");
  });

  // -------------------------------------------------------------------------
  // E-FOREIGN-003 closure — the lanes shape (<foreign lang> ONLY, no db)
  // -------------------------------------------------------------------------
  test("lanes shape: <foreign lang='ts'> closes E-FOREIGN-003 + emits a valid ES module", () => {
    const src = `<foreign lang="ts" />
\${
  export fn runOpen(model, prompt) {
    const out = _={ in: { model, prompt }
      model + " " + prompt
    }=
    return out
  }
}`;
    const r = compile("lanes", src);
    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    // The `_={ … }=` no longer leaks — it lowered to the §23.2.4a async IIFE.
    expect(r.libraryJs).not.toContain("_={");
    expect(r.libraryJs).toContain("await (async (model, prompt) =>");
    // The enclosing fn was async-marked (the injected boundary await needs it).
    expect(r.libraryJs).toContain("export async function runOpen");
    // And the emitted module is valid ES.
    expect(() => nodeCheckModule("lanes", r.libraryJs)).not.toThrow();
  });

  test("lanes shape with `js` lang also resolves (§23.2.4a ts/js)", () => {
    const src = `<foreign lang="js" />
\${
  export fn tag(x) {
    const out = _={ in: { x }
      "tag:" + x
    }=
    return out
  }
}`;
    const r = compile("lanes_js", src);
    expect(r.errorCodes).toEqual([]);
    expect(r.libraryJs).toContain("export async function tag");
    expect(() => nodeCheckModule("lanes_js", r.libraryJs)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Rejects — E-FOREIGN-LANG-DUPLICATE / E-FOREIGN-LANG-IN-PROGRAM
  // -------------------------------------------------------------------------
  test("two top-level <foreign lang> → E-FOREIGN-LANG-DUPLICATE", () => {
    const src = `<foreign lang="ts" />
<foreign lang="js" />
\${
  export fn f(x) { const o = _={ in: { x } x }= return o }
}`;
    const r = compile("dup", src);
    expect(r.errorCodes).toContain("E-FOREIGN-LANG-DUPLICATE");
  });

  test("<foreign lang> in a file that also declares <program> → E-FOREIGN-LANG-IN-PROGRAM", () => {
    const src = `<foreign lang="ts" />
<program lang="ts">
<page>
\${ function f(x) { const o = _={ in: { x } x }= return o } }
</page>
</program>`;
    const r = compile("in_program", src, "browser");
    expect(r.errorCodes).toContain("E-FOREIGN-LANG-IN-PROGRAM");
  });

  test("<foreign lang> nested INSIDE <program> also → E-FOREIGN-LANG-IN-PROGRAM", () => {
    const src = `<program lang="ts">
<foreign lang="ts" />
<page>
\${ function f(x) { const o = _={ in: { x } x }= return o } }
</page>
</program>`;
    const r = compile("in_program_nested", src, "browser");
    expect(r.errorCodes).toContain("E-FOREIGN-LANG-IN-PROGRAM");
  });

  // -------------------------------------------------------------------------
  // non-ts/js <foreign lang> → §23.2.1 sidecar rules (E-FOREIGN-005 for inline)
  // -------------------------------------------------------------------------
  test("non-ts/js <foreign lang='go'> with an inline `_{}` → E-FOREIGN-005 (not E-FOREIGN-003)", () => {
    const src = `<foreign lang="go" />
\${
  export fn f(x) { const o = _={ in: { x } x }= return o }
}`;
    const r = compile("go_lang", src);
    expect(r.errorCodes).toContain("E-FOREIGN-005");
    expect(r.errorCodes).not.toContain("E-FOREIGN-003");
  });

  // -------------------------------------------------------------------------
  // fsp-core shape — <foreign lang> + <db src> + ?{} + _{}
  // -------------------------------------------------------------------------
  test("fsp-core shape: <foreign lang> + <db src> + ?{} + _{} — SQL+foreign fn prunes to .server.js, no leak in .js", () => {
    const src = `<foreign lang="ts" />
<db src="${DB_PATH}" tables="fsp_task">
\${
  export server function dispatch(frame) {
    const rows = ?{\`SELECT id, name FROM fsp_task\`}.all()
    const out = _={ in: { frame }
      "dispatched: " + frame
    }=
    return out
  }
}
</db>`;
    const r = compile("fsp_core", src);
    expect(r.errorCodes).toEqual([]);
    // The library `.js` is the client-facing importable artifact — a server-only
    // (SQL+foreign) fn must NOT leak its `?{}`/`_{}` there.
    expect(r.libExists).toBe(true);
    expect(r.libraryJs).not.toContain("_={");
    expect(r.libraryJs).not.toContain("?{");
    expect(() => nodeCheckModule("fsp_lib", r.libraryJs)).not.toThrow();
    // The .server.js holds the fn and lowers BOTH the SQL and the foreign block.
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).not.toContain("_={");
    expect(r.serverJs).toContain("SELECT id, name FROM fsp_task");
    expect(r.serverJs).toContain("await (async (frame) =>");
  });

  // -------------------------------------------------------------------------
  // Orthogonality — <foreign lang> alone / <db src> alone / both compose
  // -------------------------------------------------------------------------
  test("<db src> alone (no <foreign lang>) still resolves ?{} — §44.7.1 regression", () => {
    const src = `<db src="${DB_PATH}" tables="fsp_task">
\${
  export server function listTasks() {
    return ?{\`SELECT id, name FROM fsp_task\`}.all()
  }
}
</db>`;
    const r = compile("db_only", src);
    expect(r.errorCodes).toEqual([]);
    // No <foreign lang>: no foreign leak concern; the SQL fn lives in .server.js.
    expect(r.serverExists).toBe(true);
    expect(r.serverJs).toContain("SELECT id, name FROM fsp_task");
  });

  test("<foreign lang> alone (no db) resolves _{} with no db-context needed", () => {
    const src = `<foreign lang="ts" />
\${
  export fn shout(msg) {
    const out = _={ in: { msg }
      msg + "!"
    }=
    return out
  }
}`;
    const r = compile("foreign_only", src);
    expect(r.errorCodes).toEqual([]);
    expect(r.libraryJs).toContain("export async function shout");
    expect(() => nodeCheckModule("foreign_only", r.libraryJs)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Adversarial (S215) — admission + async-mark + crossing-shadow + value-flow
  // -------------------------------------------------------------------------
  test("a BARE non-value-returning `_{}` in a library is still E-FOREIGN-004 (lang context does not admit it)", () => {
    const src = `<foreign lang="ts" />
\${
  export fn f(x) {
    _={ in: { x }
      console.log(x)
    }=
    return x
  }
}`;
    const r = compile("bare_foreign", src);
    expect(r.errorCodes).toContain("E-FOREIGN-004");
  });

  test("impure `function` (not `fn`) with `_{}` is async-marked too (keyword `function`)", () => {
    const src = `<foreign lang="ts" />
\${
  export function doubler(x) {
    const o = _={ in: { x }
      x * 2
    }=
    return o
  }
}`;
    const r = compile("impure_fn", src);
    expect(r.errorCodes).toEqual([]);
    expect(r.libraryJs).toContain("export async function doubler");
    expect(() => nodeCheckModule("impure_fn", r.libraryJs)).not.toThrow();
  });

  test("multiple `_{}` blocks in one fn all lower; one async-mark", () => {
    const src = `<foreign lang="ts" />
\${
  export fn combine(a, b) {
    const x = _={ in: { a } a + 1 }=
    const y = _={ in: { b } b + 2 }=
    return x + y
  }
}`;
    const r = compile("multi_foreign", src);
    expect(r.errorCodes).toEqual([]);
    // exactly one `export async function combine` (single async-mark).
    expect(r.libraryJs.match(/export async function combine/g)?.length).toBe(1);
    expect(r.libraryJs).not.toContain("_={");
    expect(() => nodeCheckModule("multi_foreign", r.libraryJs)).not.toThrow();
  });

  test("crossing-shadow fires E-FOREIGN-006 (not a silent invalid emit)", () => {
    const src = `<foreign lang="ts" />
\${
  export fn k(x) {
    const o = _={ in: { x }
      const x = 5
      x
    }=
    return o
  }
}`;
    const r = compile("shadow", src);
    // The slice re-declares the crossing `x` at top level → E-FOREIGN-006, and
    // the emitted module stays syntactically well-formed (sentinel splice).
    expect(r.errorCodes).toContain("E-FOREIGN-006");
    expect(() => nodeCheckModule("shadow", r.libraryJs)).not.toThrow();
  });

  test("runtime: the lowered `_{}` value flows back through the imported fn", async () => {
    const src = `<foreign lang="ts" />
\${
  export fn runOpen(model, prompt) {
    const out = _={ in: { model, prompt }
      model.toUpperCase() + " :: " + prompt
    }=
    return out
  }
}`;
    const r = compile("rt", src);
    expect(r.errorCodes).toEqual([]);
    const p = join(TMP, "rt.import.mjs");
    writeFileSync(p, r.libraryJs);
    const mod = await import(`${p}?v=${Date.now()}`);
    await expect(mod.runOpen("gpt", "hello world")).resolves.toBe("GPT :: hello world");
  });
});
