/**
 * §23.2.4a — an inline `_={ … }=` slice runs in a SEALED scope.
 *
 *   "The named values are the ONLY things that cross — there is NO free lexical capture
 *    (the slice sees only what `in:{}` names)."
 *
 * Gap closed: g-foreign-iife-captures-module-scope-s454. The slice used to be spliced in
 * place as an async IIFE, which closes over every enclosing local and every module binding.
 * Executed on c5c95bc64, a `<program lang="js">` server function returned all three:
 *
 *     _={ _scrml_sql.unsafe("SELECT 1 AS one") }=   → [{"one":1}]          (the raw db handle)
 *     _={ hidden }=                                 → "ENCLOSING-LOCAL"    (an uncrossed local)
 *     _={ banner }=                                 → "MODULE-BINDING"     (a module const)
 *
 * Every test here EXECUTES the emitted artifact (a server route through the bundle's own
 * WinterCG `fetch`, or a `kind="tool"` module run with `bun`) — the sealing is a runtime
 * property, so an emit-string assertion would not prove it. Mechanism: foreign-seal.ts.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const _dirs = [];
afterAll(() => { for (const d of _dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const codes = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code);
const errCodes = (r) => (r.errors ?? []).map((d) => d.code);

/** Compile one web-app program to disk (write:true) and import its server bundle. */
async function buildServer(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `foreign-sealed-${name}-`));
  _dirs.push(dir);
  const dbPath = join(dir, "app.db");
  new Database(dbPath).close(); // a referenced sqlite file opens, never creates (s445)
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  const serverPath = join(dist, `${name}.server.js`);
  const clientPath = join(dist, `${name}.client.js`);
  const serverJs = readFileSync(serverPath, "utf8");
  const clientJs = readFileSync(clientPath, "utf8");
  const mod = await import(serverPath);
  return { result, mod, serverJs, clientJs };
}

/** POST to the route of source fn `fnName`; returns { status, body } or { threw }. */
async function call(mod, fnName, args = {}) {
  const route = mod.routes.find((r) => r.path.includes(`__ri_route_${fnName}_`));
  if (!route) throw new Error(`no route for ${fnName}: ${mod.routes.map((r) => r.path).join(", ")}`);
  const req = new Request("http://localhost" + route.path, {
    method: "POST",
    headers: { "Cookie": "scrml_csrf=tok", "X-CSRF-Token": "tok", "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  try {
    const res = await mod.fetch(req);
    return { status: res.status, body: JSON.parse(await res.text()) };
  } catch (e) {
    return { threw: e };
  }
}

/** Compile a `kind="tool"` program to disk and run it with `bun`. */
function runTool(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `foreign-sealed-tool-${name}-`));
  _dirs.push(dir);
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  const jsPath = join(dist, `${name}.js`);
  const run = Bun.spawnSync({ cmd: ["bun", jsPath], cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { result, dist, run, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

function compileOnly(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `foreign-sealed-c-${name}-`));
  _dirs.push(dir);
  new Database(join(dir, "app.db")).close();
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], write: false, log: () => {} });
}

// ---------------------------------------------------------------------------------------
// 1. The three reproducers from the gap, now refused at runtime by the seal.
// ---------------------------------------------------------------------------------------

const REPRO = `<program lang="js" db="./app.db">
\${
  const banner = "MODULE-BINDING"
  function probeSql() {
    const a = _={ _scrml_sql.unsafe("SELECT 1 AS one") }=
    return a
  }
  function probeLocal() {
    const hidden = "ENCLOSING-LOCAL"
    const b = _={ hidden }=
    return b
  }
  function probeModule() {
    const c = _={ banner }=
    return c
  }
  function probeCrossed(n) {
    const d = _={ in: { n } n * 2 }=
    return d
  }
}
<button onclick=probeSql()>a</button>
<button onclick=probeLocal()>b</button>
<button onclick=probeModule()>c</button>
<button onclick=probeCrossed(21)>d</button>
</program>
`;

describe("§23.2.4a — no free lexical capture (the gap's reproducers, executed)", () => {
  let built;
  const get = async () => (built ??= await buildServer("repro", REPRO));

  test("compiles clean (opacity: the compiler does not parse the interior for free names)", async () => {
    const { result } = await get();
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    // The seal helper itself must not trip the server-output `undefined` lint (§42).
    expect(codes(result)).not.toContain("W-CG-UNDEFINED-INTERPOLATION");
  });

  test("the raw db handle `_scrml_sql` is NOT reachable from a slice", async () => {
    const r = await call((await get()).mod, "probeSql");
    expect(r.threw).toBeInstanceOf(ReferenceError);
    expect(r.threw.message).toContain("_scrml_sql is not defined");
  });

  test("an enclosing local NOT in in:{} is NOT reachable", async () => {
    const r = await call((await get()).mod, "probeLocal");
    expect(r.threw).toBeInstanceOf(ReferenceError);
    expect(r.threw.message).toContain("hidden is not defined");
  });

  test("a module-level scrml binding is NOT reachable", async () => {
    const r = await call((await get()).mod, "probeModule");
    expect(r.threw).toBeInstanceOf(ReferenceError);
    expect(r.threw.message).toContain("banner is not defined");
  });

  test("the ReferenceError names the slice's source site and the rule", async () => {
    const r = await call((await get()).mod, "probeLocal");
    expect(r.threw.message).toContain("repro.scrml:10");
    expect(r.threw.message).toContain("only the names in its in:{} header cross");
    expect(r.threw.message).toContain("§23.2.4a");
  });

  test("an in:{} crossing DOES cross", async () => {
    const r = await call((await get()).mod, "probeCrossed", { n: 21 });
    expect(r.status).toBe(200);
    expect(r.body).toBe(42);
  });

  test("the slice and the seal helper never reach client output", async () => {
    const { clientJs } = await get();
    expect(clientJs).not.toContain("_scrml_foreign_seal");
    expect(clientJs).not.toContain("_scrml_sql.unsafe");
  });
});

// ---------------------------------------------------------------------------------------
// 2. Everything §23.2.4a says still holds, executed.
// ---------------------------------------------------------------------------------------

const SHAPES = `<program lang="js" db="./app.db">
\${
  function hostGlobals() {
    const g = _={ [typeof Bun, typeof process, typeof fetch, typeof Response, typeof globalThis].join(",") }=
    return g
  }
  function innerAwait(n) {
    const v = _={ in: { n } await Promise.resolve(n + 1) }=
    return v
  }
  function multi(a, b) {
    const v = _={ in: { a, b }
      const parts = [a];
      for (let i = 0; i < b; i++) parts.push("x");
      return parts.join("-");
    }=
    return v
  }
  function multiNoReturn(a) {
    const v = _={ in: { a }
      const unused = a + 1;
    }=
    if (v is not) { return "absent" }
    return "present"
  }
  function trailingComment(n) {
    const v = _={ in: { n } n + 1 // a trailing line comment
    }=
    return v
  }
  function argsAndThis(a, b) {
    const v = _={ in: { a, b } [arguments.length, typeof this].join(",") }=
    return v
  }
  function strict() {
    const v = _={
      let mode = "sloppy";
      try { undeclaredGlobal = 1; } catch (e) { mode = e.name; }
      return mode;
    }=
    return v
  }
}
<button onclick=hostGlobals()>1</button>
<button onclick=innerAwait(1)>2</button>
<button onclick=multi("a", 2)>3</button>
<button onclick=multiNoReturn("a")>4</button>
<button onclick=trailingComment(1)>5</button>
<button onclick=argsAndThis(1, 2)>6</button>
<button onclick=strict()>7</button>
</program>
`;

describe("§23.2.4a — crossings, host globals, both slice shapes, the boundary await (executed)", () => {
  let built;
  const get = async () => (built ??= await buildServer("shapes", SHAPES));

  test("compiles clean", async () => {
    const { result } = await get();
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  test("host globals stay reachable (the seal is not a sandbox)", async () => {
    const r = await call((await get()).mod, "hostGlobals");
    expect(r.body).toBe("object,object,function,function,object");
  });

  test("a single-expression slice may `await` internally; the boundary await settles it", async () => {
    const r = await call((await get()).mod, "innerAwait", { n: 1 });
    expect(r.body).toBe(2);
  });

  test("a multi-statement slice runs verbatim and returns through its own `return`", async () => {
    const r = await call((await get()).mod, "multi", { a: "a", b: 2 });
    expect(r.body).toBe("a-x-x");
  });

  test("a multi-statement slice with no `return` settles to `not`", async () => {
    const r = await call((await get()).mod, "multiNoReturn", { a: "a" });
    expect(r.body).toBe("absent");
  });

  test("a single-expression slice ending in a `//` comment still lowers", async () => {
    const r = await call((await get()).mod, "trailingComment", { n: 1 });
    expect(r.body).toBe(2);
  });

  test("`arguments` inside a slice is its crossings; `this` is undefined", async () => {
    const r = await call((await get()).mod, "argsAndThis", { a: 1, b: 2 });
    expect(r.body).toBe("2,undefined");
  });

  test("the slice runs in strict mode (as the module-scoped IIFE did)", async () => {
    const r = await call((await get()).mod, "strict");
    expect(r.body).toBe("ReferenceError");
  });

  test("each slice is built ONCE, not per call (the EMITTED helper's cache)", async () => {
    // A Proxy over globalThis.Function cannot count the builds: Bun resolves
    // `new Function(...)` without going through the global binding (measured — a
    // replaced globalThis.Function saw zero constructions). So the helper the
    // artifact actually ships is lifted out of it and driven directly.
    const { serverJs } = await get();
    const at = serverJs.indexOf("function _scrml_foreign_seal(site, source) {");
    expect(at).toBeGreaterThanOrEqual(0);
    const helperSrc = serverJs.slice(at, serverJs.indexOf("\n}\n", at) + 2);
    // No module context under `new Function`: `import.meta` reads a plain object here (as the
    // conformance adapter does), so no host name is bound — what this test asserts on.
    const seal = new Function("const _scrml_g = globalThis;\n" + helperSrc.replace(/import\.meta\b/g, "({})") + "\nreturn _scrml_foreign_seal;")();
    const src = "async function (n) {\nreturn (n * 2\n);\n}";
    const first = seal("t.scrml:1", src);
    for (let i = 0; i < 4; i++) expect(seal("t.scrml:1", src)).toBe(first); // same built function
    expect(seal.cache.size).toBe(1);
    expect(await first(21)).toBe(42);
    const other = seal("t.scrml:2", "async function (n) {\nreturn (n + 1\n);\n}");
    expect(other).not.toBe(first);
    expect(seal.cache.size).toBe(2);
    expect(await other(1)).toBe(2);
  });

  test("repeated calls through the route keep working off the cached slice", async () => {
    const { mod } = await get();
    for (let i = 0; i < 4; i++) {
      const r = await call(mod, "multi", { a: "q", b: i });
      expect(r.body).toBe(["q", ...Array(i).fill("x")].join("-"));
    }
  });
});

// ---------------------------------------------------------------------------------------
// 3. `kind="tool"`: the module's host context (require / __dirname / __filename / dynamic
//    import) crosses the seal; the module's scrml bindings do not. lang="ts" slices too.
// ---------------------------------------------------------------------------------------

describe("§23.2.4a — tool host I/O form (executed with bun)", () => {
  test("host context reachable; module bindings and uncrossed locals are not", () => {
    const { result, run, stdout, stderr } = runTool("hostctx", `<program kind="tool" lang="js">
    const banner = "MODULE"
    function main(args: string[]): number {
        const hidden = "LOCAL"
        const n = 5
        _={ in: { n }
            const path = require("node:path");
            console.log("req=" + path.basename("/a/b.txt"));
            console.log("dir=" + (typeof __dirname) + "/" + (typeof __filename));
            console.log("free=" + (typeof hidden) + "/" + (typeof banner));
            console.log("n=" + n);
        }=
        const ext = _={ (await import("node:path")).extname("x.md") }=
        println("dyn=" + ext)
        return 0
    }
</program>`);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(stdout).toContain("req=b.txt");
    expect(stdout).toContain("dir=string/string");
    expect(stdout).toContain("free=undefined/undefined");
    expect(stdout).toContain("n=5");
    expect(stdout).toContain("dyn=.md");
  });

  // S458 (s458-alias-r3) — under Node an ES module has no `import.meta.require`; the seal
  // builds the module's require with `module.createRequire(import.meta.url)`.
  test.skipIf(!Bun.which("node"))("under Node the slice gets a working require too", () => {
    const { result, dist } = runTool("hostctx_node", `<program kind="tool" lang="js">
    function main(args: string[]): number {
        _={
            const path = require("node:path");
            console.log("req=" + path.basename("/a/b.txt"));
            console.log("dir=" + (typeof __dirname) + "/" + (typeof __filename));
        }=
        return 0
    }
</program>`);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    const run = Bun.spawnSync({ cmd: ["node", join(dist, "hostctx_node.js")], stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain("req=b.txt");
    expect(run.stdout.toString()).toContain("dir=string/string");
  });

  test("the slice text survives being carried as source: backticks, ${}, backslashes, regex", () => {
    // The slice travels inside a template literal in the artifact; its COOKED value
    // must be the author's text byte for byte (same output as the old in-place IIFE).
    const { result, run, stdout } = runTool("escapes", `<program kind="tool" lang="js">
    function main(args: string[]): number {
        const name = "w"
        const v = _={ in: { name }
            const t = \`x-\${name}-\\\`q\\\`-\${"a\\\\nb".length}\`;
            const re = /\\d+\\$/.test("12$");
            return t + "|" + re + "|" + "tab\\there".length + "|" + '\${not}';
        }=
        println(v)
        return 0
    }
</program>`);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(stdout).toBe("x-w-`q`-4|true|8|${not}\n");
  });

  test("a lang=\"ts\" program's (type-free) slices run sealed too", () => {
    const { result, run, stdout } = runTool("tsprog", `<program kind="tool" lang="ts">
    function main(args: string[]): number {
        const n = 3
        const v = _={ in: { n } n * 7 }=
        println("v=" + v)
        return 0
    }
</program>`);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(stdout).toContain("v=21");
  });
});

// ---------------------------------------------------------------------------------------
// 4. Compile-time: E-FOREIGN-006 unchanged; a slice that cannot be built is E-FOREIGN-007.
// ---------------------------------------------------------------------------------------

describe("§23.2.4a — compile-time diagnostics", () => {
  const prog = (body) => `<program lang="js" db="./app.db">
\${
  function f(x) {
${body}
    return out
  }
}
<button onclick=f(1)>go</button>
</program>
`;

  test("E-FOREIGN-006 (crossing-shadow) still fires", () => {
    const r = compileOnly("shadow", prog(`    const out = _={ in: { x }\n      const x = 1;\n      return x;\n    }=`));
    expect(errCodes(r)).toContain("E-FOREIGN-006");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("a slice that is not valid JS is E-FOREIGN-007 (an author error, not a compiler defect)", () => {
    const r = compileOnly("badsyntax", prog(`    const out = _={ in: { x } x + }=`));
    expect(errCodes(r)).toContain("E-FOREIGN-007");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    const e = r.errors.find((d) => d.code === "E-FOREIGN-007");
    expect(e.message).toContain("badsyntax.scrml:");
  });

  test("statements with no top-level `;`/`return` are E-FOREIGN-007 naming the SHAPE, not 'invalid JavaScript'", () => {
    // A lone `try { … } catch { … }` has no top-level `;` and no top-level `return`, so
    // §23.2.4a rule 1 reads it as a single expression. The text IS valid as statements:
    // the diagnostic must say which shape it was read as and how to write the other.
    const r = compileOnly("shape", prog(`    const out = _={ in: { x }\n      try { JSON.parse(x) } catch (e) { console.error(e) }\n    }=`));
    const e = (r.errors ?? []).find((d) => d.code === "E-FOREIGN-007");
    expect(e).toBeTruthy();
    expect(e.message).toContain("SINGLE EXPRESSION");
    expect(e.message).toContain("multi-statement");
    expect(e.message).not.toContain("not valid JavaScript");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("`import.meta` in a slice is E-FOREIGN-007 and the message names the alternatives", () => {
    const r = compileOnly("meta", prog(`    const out = _={ import.meta.dir }=`));
    expect(errCodes(r)).toContain("E-FOREIGN-007");
    const e = r.errors.find((d) => d.code === "E-FOREIGN-007");
    expect(e.message).toContain("import.meta");
    expect(e.message).toContain("__dirname");
  });

  test("TypeScript type syntax in a slice is E-FOREIGN-007 (the slice is not transpiled)", () => {
    const r = compileOnly("tstypes", prog(`    const out = _={ in: { x }\n      const y: number = x;\n      return y;\n    }=`).replace('lang="js"', 'lang="ts"'));
    expect(errCodes(r)).toContain("E-FOREIGN-007");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });
});

// ---------------------------------------------------------------------------------------
// 5. §14.8.9: the seal helper is not misread as a code evaluator, and a protected row
//    crossing into a slice still fails closed.
// ---------------------------------------------------------------------------------------

describe("§23.2.4a × §14.8.9 — protect provenance across the seal", () => {
  const protectProg = (body) => `<program lang="js">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
${body}
    }
  </db>
  <div><p>hi</p></div>
</program>
`;

  test("a slice that touches nothing protected adds NO E-PROTECT-006", () => {
    const r = compileOnly("protbenign", protectProg(`      function stamp() {\n        const t = _={ Date.now() }=\n        return t\n      }`));
    expect(codes(r)).not.toContain("E-PROTECT-006");
  });

  test("a protected row crossing into a slice comes back out protected (fail closed)", () => {
    const r = compileOnly("protrow", protectProg(`      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let payload = _={ in: { u } JSON.stringify(u) }=\n        return payload\n      }`));
    expect(codes(r)).toContain("E-PROTECT-006");
  });

  test("a fully revealed row crossing into a slice is clean", () => {
    const r = compileOnly("protreveal", protectProg(`      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let r = u.reveal("passwordHash")\n        let payload = _={ in: { r } JSON.stringify(r) }=\n        return payload\n      }`));
    expect(codes(r)).not.toContain("E-PROTECT-006");
    expect(codes(r)).not.toContain("E-PROTECT-004");
  });
});
