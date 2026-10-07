/**
 * s457 (§21.4) — a `.scrml` RE-EXPORT reaches every emitted artifact.
 *
 * §21.4: "A file MAY re-export bindings from another file … Re-export follows standard
 * ES module `export { name } from 'source'` syntax."
 *
 * Before: `export { w as helper } from "./c.scrml"` in b.scrml was dropped from b's
 * `.server.js` (emit-server's value-export block skipped every re-export), so a.server.js
 * — `import { helper } from "./b.server.js"` — failed to LINK ("Export named 'helper'
 * not found"), or found no b.server.js at all when the re-export was b's only content.
 * The client registry footer dropped it too, and c.client.js was never put on the page.
 * `export * from` was refused outright (false E-IMPORT-004: the registry never
 * enumerated a star).
 *
 * Every test here RUNS the emitted artifact (server bundle imported and its route
 * called in-process; client chunks evaluated in order) — a text grep is not the check.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";
import { compileScrml } from "../../src/api.js";

const D = "$";
let ROOT;
beforeAll(() => { ROOT = mkdtempSync(join(tmpdir(), "s457-reexport-")); });
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

/** Write `files` into a fresh project dir, compile `a.scrml`, return helpers over the output. */
function build(name, files, extra = {}) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, src] of Object.entries(files)) writeFileSync(join(dir, f), src);
  const out = join(dir, "dist");
  const r = compileScrml({ inputFiles: [join(dir, "a.scrml")], outputDir: out, write: true, log: () => {}, ...extra });
  const diags = [...(r.errors ?? []), ...(r.warnings ?? [])];
  return {
    out,
    errors: diags.filter((e) => (e.severity ?? "error") === "error").map((e) => e.code),
    codes: diags.map((e) => e.code),
    read: (f) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : null),
  };
}

/** Import `<out>/a.server.js` and call its first route the way the client would. */
async function callFirstRoute(out) {
  const a = await import(`${join(out, "a.server.js")}?v=${Math.random()}`);
  const route = a.routes[0];
  const res = await route.handler(new Request("http://x" + route.path, {
    method: "POST",
    headers: { Cookie: "scrml_csrf=t", "X-CSRF-Token": "t", "Content-Type": "application/json" },
    body: "{}",
  }));
  return [res.status, await res.json()];
}

const C = `${D}{
    export const K = "kay"

    export fn p(n: string) -> string {
        return "p:" + n
    }

    export server fn w() -> string {
        return "from-c"
    }
}
`;

const A = (importClause, call) => `<program>
import { ${importClause} } from "./b.scrml"

server fn callIt() -> string {
    return ${call}
}

<msg> = ""
<button id="srv" onclick=${D}{ @msg = callIt() }>go</button>
<p id="out">${D}{@msg}</p>
<p id="k">${D}{K}</p>
</program>
`;

describe("§21.4 — the server bundle links through a re-export", () => {
  test("re-export is the module's ONLY content: b.server.js is emitted with the re-export and the route runs", async () => {
    const b = build("only", {
      "c.scrml": C,
      "b.scrml": `${D}{\n    export { w as helper, K } from "./c.scrml"\n}\n`,
      "a.scrml": A("helper, K", 'helper() + "|" + K'),
    });
    expect(b.errors).toEqual([]);
    expect(b.codes).not.toContain("W-SERVER-IMPORT-UNEMITTED");
    expect(b.read("b.server.js")).toContain('export { w as helper, K } from "./c.server.js";');
    expect(await callFirstRoute(b.out)).toEqual([200, "from-c|kay"]);
  });

  test("the re-exporter has its own server content (the reported 'Export named helper not found' shape)", async () => {
    const b = build("own", {
      "c.scrml": C,
      "b.scrml": `${D}{\n    export { w as helper, p, K } from "./c.scrml"\n\n    export server fn own() -> string {\n        return "own-b"\n    }\n}\n`,
      "a.scrml": A("helper, p, K, own", 'helper() + "|" + p(K) + "|" + own()'),
    });
    expect(b.errors).toEqual([]);
    expect(b.codes).not.toContain("W-SERVER-IMPORT-UNEMITTED");
    expect(await callFirstRoute(b.out)).toEqual([200, "from-c|p:kay|own-b"]);
  });

  test("`export * from` — accepted (no false E-IMPORT-004), expanded to names, never re-exports the source's routes", async () => {
    const b = build("star", {
      "c.scrml": C,
      "b.scrml": `${D}{\n    export * from "./c.scrml"\n\n    export server fn own() -> string {\n        return "own-b"\n    }\n}\n`,
      "a.scrml": A("w as helper, p, K, own", 'helper() + "|" + p(K) + "|" + own()'),
    });
    expect(b.errors).toEqual([]);
    const bjs = b.read("b.server.js");
    expect(bjs).toContain('export { K, p, w } from "./c.server.js";');
    expect(bjs).not.toMatch(/export\s*\*/);
    expect(bjs).not.toMatch(/export \{[^}]*\b(routes|fetch|__ri_route_\w+)\b[^}]*\} from/);
    expect(await callFirstRoute(b.out)).toEqual([200, "from-c|p:kay|own-b"]);
  });

  test("a chain (a -> b -> c -> d) settles: every hop links", async () => {
    const b = build("chain", {
      "d.scrml": C,
      "c.scrml": `${D}{\n    export { w, K } from "./d.scrml"\n}\n`,
      "b.scrml": `${D}{\n    export { w as helper, K } from "./c.scrml"\n}\n`,
      "a.scrml": A("helper, K", 'helper() + "|" + K'),
    });
    expect(b.errors).toEqual([]);
    expect(b.read("c.server.js")).toContain('export { w, K } from "./d.server.js";');
    expect(await callFirstRoute(b.out)).toEqual([200, "from-c|kay"]);
  });

  test("a re-exported TYPE and COMPONENT have no server value: left out, and the module still links", async () => {
    const b = build("typecomp", {
      "c.scrml": `${D}{\n    export type Row:struct = { id: string }\n    export const Card = <div class="card">card</div>\n    export const K = "kay"\n    export server fn w() -> string {\n        return "from-c"\n    }\n}\n`,
      "b.scrml": `${D}{\n    export { Row, Card, K, w as helper } from "./c.scrml"\n}\n`,
      "a.scrml": A("helper, K", 'helper() + "|" + K'),
    });
    expect(b.errors).toEqual([]);
    const bjs = b.read("b.server.js");
    expect(bjs).toContain("export { K, w as helper } from");
    expect(bjs).not.toMatch(/\bRow\b/);
    expect(bjs).not.toMatch(/\bCard\b/);
    expect(await callFirstRoute(b.out)).toEqual([200, "from-c|kay"]);
  });
});

describe("§21.4 — the client reads a re-export through the registry", () => {
  test("footer registers the re-export from its source; the source loads first; the chunks evaluate", () => {
    const b = build("client", {
      "c.scrml": C,
      "b.scrml": `${D}{\n    export { w as helper, K } from "./c.scrml"\n}\n`,
      "a.scrml": A("helper, K", 'helper() + "|" + K'),
    });
    expect(b.errors).toEqual([]);
    const html = b.read("a.html");
    const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.startsWith("scrml-runtime"));
    expect(order).toEqual(["c.client.js", "b.client.js", "a.client.js"]);
    expect(b.read("b.client.js")).toContain(
      '_scrml_modules["b.client.js"] = { helper: _scrml_modules["c.client.js"].w, K: _scrml_modules["c.client.js"].K };',
    );
    // c's K is READ client-side (through b) — so c emits its client binding (#358 seed followed through the re-export).
    expect(b.read("c.client.js")).toMatch(/_scrml_modules\["c\.client\.js"\] = \{[^}]*\bK: K\b/);
    // Evaluate c then b (classic scripts share one registry) and compare identities.
    const ctx = vm.createContext({ _scrml_modules: {} });
    vm.runInContext(b.read("c.client.js"), ctx);
    vm.runInContext(b.read("b.client.js"), ctx);
    const reg = ctx._scrml_modules;
    expect(typeof reg["c.client.js"].w).toBe("function");
    expect(reg["b.client.js"].helper).toBe(reg["c.client.js"].w);
    expect(reg["b.client.js"].K).toBe("kay");
  });

  test("--module-format=esm: the re-export is read off the source NAMESPACE (no link-error-prone `export … from`)", () => {
    const b = build("esm", {
      "c.scrml": C,
      "b.scrml": `${D}{\n    export { w as helper, K } from "./c.scrml"\n}\n`,
      "a.scrml": A("helper, K", 'helper() + "|" + K'),
    }, { moduleFormat: "esm" });
    expect(b.errors).toEqual([]);
    const bjs = b.read("b.client.js");
    expect(bjs).toContain('import * as __scrml_dep_0 from "./c.client.js";');
    expect(bjs).toContain("const __scrml_reexport_helper = __scrml_dep_0.w;");
    expect(bjs).toMatch(/export \{[^}]*__scrml_reexport_helper as helper[^}]*\};/);
    expect(bjs).not.toContain("_scrml_modules");
    expect(bjs).not.toMatch(/export \{[^}]*\} from/);
  });
});
