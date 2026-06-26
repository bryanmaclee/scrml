/**
 * Bug 18 (S95) — `scrml:NAME` capability imports in client JS.
 *
 * Pre-fix behaviour:
 *   Client JS emitted `import { sortBy } from "scrml:data";` as a literal
 *   bare ES-module specifier. Two cascading browser failures:
 *     1. Bare `scrml:NAME` is not resolvable without an import map.
 *     2. The `<script src="...">` tag is classic (no `type="module"`),
 *        so the browser refuses to parse ES `import` syntax at all
 *        — `SyntaxError: import declarations may only appear at top
 *        level of a module`.
 *
 * Post-fix behaviour:
 *   Client JS emits `const { sortBy } = _scrml_stdlib.data;` reading
 *   from a global registry populated by the `stdlib-data` runtime chunk.
 *   No `type="module"` change to the script tag; no importmap; the
 *   runtime stays a classic script. Tree-shaking gates `stdlib-<name>`
 *   chunks per-file based on detected scrml: imports.
 *
 * Tests:
 *   §1  Compile minimal `scrml:data` consumer; assert client.js has
 *       no bare `scrml:` import specifier left.
 *   §2  Assert client.js contains `const { ... } = _scrml_stdlib.data;`.
 *   §3  Assert the emitted runtime ships the `stdlib-data` chunk so
 *       the destructure resolves at load time.
 *   §4  Assert HTML script tags are unchanged (no `type="module"`).
 *   §5  Browser-runtime smoke (happy-dom): runtime + client load
 *       in the same realm, the `<ul>` renders sorted items, no
 *       console errors.
 *   §6  Tree-shake: a file that does NOT import `scrml:NAME` emits a
 *       runtime that does NOT include any `stdlib-<name>` chunk.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "bug-18-"));
  if (!globalThis.document) GlobalRegistrator.register();
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function findRuntimeFile(outDir) {
  return readdirSync(outDir).find(
    (f) => f.startsWith("scrml-runtime") && f.endsWith(".js"),
  );
}

// Bug 18 brief's repro — minimal `scrml:data` consumer + render loop.
const REPRO = `<program title="Bug 18 Repro">
    \${ import { sortBy } from 'scrml:data' }

    <items> = [{ name: "b", order: 2 }, { name: "a", order: 1 }]

    <ul>
        \${ for (let it of sortBy(@items, "order")) {
            lift <li>\${it.name}</li>
        } }
    </ul>
</program>
`;

describe("Bug 18 — scrml:NAME client imports do not emit as bare ES specifiers", () => {
  test("§1  emitted client.js has no `from \"scrml:\"` substring", () => {
    const src = fx("c1/repro.scrml", REPRO);
    const outDir = join(TMP, "c1/dist");
    const result = compileScrml({
      inputFiles: [src],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);
    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    expect(clientJs).not.toContain(`from "scrml:`);
    expect(clientJs).not.toContain(`from 'scrml:`);
  });

  test("§2  emitted client.js contains the _scrml_stdlib destructure", () => {
    const src = fx("c2/repro.scrml", REPRO);
    const outDir = join(TMP, "c2/dist");
    compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    expect(clientJs).toContain("const { sortBy } = _scrml_stdlib.data;");
  });

  test("§3  emitted runtime ships the stdlib-data chunk", () => {
    const src = fx("c3/repro.scrml", REPRO);
    const outDir = join(TMP, "c3/dist");
    compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    const runtimeFile = findRuntimeFile(outDir);
    expect(runtimeFile).toBeDefined();
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    expect(runtimeJs).toContain("--- chunk: stdlib-data ---");
    expect(runtimeJs).toContain("_scrml_stdlib.data = (function()");
    expect(runtimeJs).toContain("function sortBy(array, keyOrFn, direction)");
  });

  test("§4  HTML script tags remain classic (no type=\"module\" change)", () => {
    const src = fx("c4/repro.scrml", REPRO);
    const outDir = join(TMP, "c4/dist");
    compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    const html = readFileSync(join(outDir, "repro.html"), "utf8");
    // Both <script> tags are classic — no type="module".
    expect(html).toMatch(/<script src="scrml-runtime\.[a-z0-9]+\.js"><\/script>/);
    expect(html).toContain(`<script src="repro.client.js"></script>`);
    expect(html).not.toContain(`type="module"`);
  });

  test("§5  browser-runtime smoke — list renders sorted with no console errors", () => {
    const src = fx("c5/repro.scrml", REPRO);
    const outDir = join(TMP, "c5/dist");
    compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });

    const htmlContent = readFileSync(join(outDir, "repro.html"), "utf8");
    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");

    // S105 G1 fix — happy-dom env pollution from prior browser tests.
    //
    // `compiler/tests/browser/browser-components.test.js` and sibling browser
    // tests evaluate the SCRML_RUNTIME inside an IIFE per test, registering
    // reactive effects + subscribers + DOM references via the IIFE's closure.
    // Those effects PERSIST across test files in the same `bun test ...`
    // process — the IIFE closure is not GC'd because the runtime maintains
    // module-level effect references inside.
    //
    // Observable failure when this test runs after browser-components in the
    // same process: stale OLD-runtime effects re-fire after this test does
    // `document.body.innerHTML = cleanHtml`. The OLD effects query
    // `[data-scrml-logic="_scrml_logic_N"]` (compile-counter IDs collide
    // across compiles because each fresh compile resets the counter), find
    // this test's freshly-rendered spans, and overwrite their content with
    // stale data ("My Title" / "pending" from combined-021-component-basic).
    // The OLD effects ALSO overwrite this test's lift target span, replacing
    // the rendered `<li>` items with stale text. Diagnostic surfaced via
    // `[G1-DIAG]` instrumentation at S105 investigation.
    //
    // Fix: re-register happy-dom from scratch via GlobalRegistrator. The
    // unregister + register sequence wipes document/window/global state +
    // detaches any leaked effect subscriptions to old DOM, giving this test
    // a guaranteed-fresh happy-dom environment.
    //
    // Root-cause cleanup (browser-test helpers should not leak effects via
    // closure) is a v0.4 candidate; the surgical fix here closes the
    // immediate pre-push gate symptom.
    GlobalRegistrator.unregister();
    GlobalRegistrator.register();

    // Mirror the existing browser-test loader pattern: strip script tags
    // from the document body, then eval runtime + client in a shared
    // closure so they share lexical scope (same as two adjacent classic
    // <script> tags in a real browser).
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
    const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    document.body.innerHTML = cleanHtml;

    const errors = [];
    const origErr = console.error;
    console.error = (...args) => {
      errors.push(args.map((a) => String(a)).join(" "));
      origErr(...args);
    };

    let initError = null;
    try {
      const code = `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n})();`;
      // eslint-disable-next-line no-eval
      eval(code);
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      initError = e;
    } finally {
      console.error = origErr;
    }

    expect(initError).toBeNull();
    expect(errors).toEqual([]);

    const items = Array.from(document.querySelectorAll("ul li")).map(
      (li) => li.textContent,
    );
    expect(items).toEqual(["a", "b"]);
  });

  test("§6  tree-shake — file without scrml: imports emits no stdlib-<name> chunks", () => {
    const noStdlib = `<program><items> = [1, 2, 3]<ul>\${ for (let n of @items) { lift <li>\${n}</li> } }</ul></program>\n`;
    const src = fx("c6/plain.scrml", noStdlib);
    const outDir = join(TMP, "c6/dist");
    compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    const runtimeFile = findRuntimeFile(outDir);
    expect(runtimeFile).toBeDefined();
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    expect(runtimeJs).not.toContain("--- chunk: stdlib-data ---");
    expect(runtimeJs).not.toContain("--- chunk: stdlib-auth ---");
    expect(runtimeJs).not.toContain("--- chunk: stdlib-crypto ---");
    expect(runtimeJs).not.toContain("--- chunk: stdlib-host ---");
  });

  // -------------------------------------------------------------------------
  // ss19 #5 — server-only `scrml:` stdlib imports must not leak into client.js
  // -------------------------------------------------------------------------
  //
  // A page that imports a server-only capability (`scrml:store`/`auth`/`crypto`)
  // and uses it ONLY inside a server-fn body still had the lowered read
  // `const { x } = _scrml_stdlib.<mod>;` emitted into the CLIENT bundle. Client
  // emission lowers the server fn to a fetch stub (the body — and the binding
  // name — never appears client-side), and the server-only module's runtime
  // chunk is never shipped, so `_scrml_stdlib.<mod>` is `undefined` and the
  // destructure threw a TypeError at module load, killing the whole page. The
  // GITI-003 post-prune pass now also drops these lowered reads when every
  // bound name is unreferenced in the remaining client body.

  test("§7  scrml: stdlib import used only in a server fn is stripped from client.js", () => {
    const serverOnly = `<program title="ss19 server-only">
    \${
        import { createSessionStore } from 'scrml:store'

        <msg> = ""

        server function load() ! string {
            const store = createSessionStore("sess.db")
            return "loaded"
        }

        on mount { @msg = load() }
    }
    <p>\${@msg}</p>
</program>
`;
    const src = fx("c7/server-only.scrml", serverOnly);
    const outDir = join(TMP, "c7/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const clientJs = readFileSync(join(outDir, "server-only.client.js"), "utf8");
    // The lowered `const { createSessionStore } = _scrml_stdlib.store;` read must
    // be gone — store's runtime chunk is server-only (never shipped to client),
    // so destructuring `_scrml_stdlib.store` (undefined) would throw at load.
    expect(clientJs).not.toContain("_scrml_stdlib.store");
    expect(clientJs).not.toContain("createSessionStore");
    // The client bundle must still parse (no dangling destructure of undefined).
    expect(() => new Function(clientJs)).not.toThrow();
    // Server side keeps the capability — the strip is client-only.
    const serverJs = readFileSync(join(outDir, "server-only.server.js"), "utf8");
    expect(serverJs).toContain("createSessionStore");
  });

  test("§8  scrml: stdlib import used in client code is preserved (no over-strip)", () => {
    const src = fx("c8/repro.scrml", REPRO);
    const outDir = join(TMP, "c8/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    // sortBy drives the client render loop — the read must survive the prune.
    expect(clientJs).toContain("const { sortBy } = _scrml_stdlib.data;");
  });

  test("§9  mixed-binding stdlib import preserved when any name is client-used", () => {
    const mixed = `<program title="ss19 mixed">
    \${
        import { sortBy, groupBy } from 'scrml:data'

        <items> = [{ name: "b", order: 2 }, { name: "a", order: 1 }]
        <buckets> = ""

        server function bucketize() ! string {
            const g = groupBy(@items, "name")
            return "ok"
        }

        on mount { @buckets = bucketize() }
    }
    <ul>
        \${ for (let it of sortBy(@items, "order")) {
            lift <li>\${it.name}</li>
        } }
    </ul>
</program>
`;
    const src = fx("c9/mixed.scrml", mixed);
    const outDir = join(TMP, "c9/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const clientJs = readFileSync(join(outDir, "mixed.client.js"), "utf8");
    // sortBy is client-used → the whole read is kept (both names), not pruned.
    expect(clientJs).toContain("const { sortBy, groupBy } = _scrml_stdlib.data;");
  });

  // -------------------------------------------------------------------------
  // ss27-4 — client-SAFE stdlib runtime chunk must NOT ship when the module
  // is imported + used ONLY inside a server fn (runtime-minimality).
  // -------------------------------------------------------------------------
  //
  // A client-safe capability (`scrml:data`/`format`/`math`) imported and used
  // ONLY inside a server-fn body lit up its `stdlib-<name>` runtime chunk from
  // IMPORT PRESENCE alone (detectRuntimeChunks), so `_scrml_stdlib.<name>` was
  // defined-but-unused dead weight in the client runtime. The chunk is now
  // tree-shaken at the post-emit / pre-assembly point: server-fn bodies are
  // already lowered to fetch stubs there, so a bound name's absence from the
  // emitted client body proves it is server-only. Pruning the chunk BEFORE
  // assembly fixes BOTH the shared-runtime union (index.ts) and the embed-mode
  // splice (emit-client.ts).
  //
  // Interaction note: pre-fix, the embedded `stdlib-data` chunk carries
  // `function sortBy(...)`, which falsely satisfied the GITI-003/ss19#5 read
  // prune's body-reference check (that pass scans client code WITH the runtime
  // spliced), so the lowered read leaked into client.js too. Removing the chunk
  // first ALSO un-blocks the read-line strip for client-safe modules.

  const SERVER_ONLY_DATA = `<program title="ss27-4 server-only client-safe">
    \${
        import { sortBy } from 'scrml:data'

        <msg> = ""

        server function load() ! string {
            const sorted = sortBy([3, 1, 2], "")
            return "ok"
        }

        on mount { @msg = load() }
    }
    <p>\${@msg}</p>
</program>
`;

  test("§10 client-safe stdlib used only in a server fn — chunk tree-shaken from shared runtime", () => {
    const src = fx("c10/server-only.scrml", SERVER_ONLY_DATA);
    const outDir = join(TMP, "c10/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const runtimeFile = findRuntimeFile(outDir);
    expect(runtimeFile).toBeDefined();
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    // The fix: the dead stdlib-data chunk must not ship to the client runtime.
    expect(runtimeJs).not.toContain("--- chunk: stdlib-data ---");
    expect(runtimeJs).not.toContain("_scrml_stdlib.data =");
    // Server keeps the capability (server bundle uses the shim route).
    const serverJs = readFileSync(join(outDir, "server-only.server.js"), "utf8");
    expect(serverJs).toContain("sortBy");
  });

  test("§11 client-safe stdlib used only in a server fn — no dangling read in client.js, parses clean", () => {
    const src = fx("c11/server-only.scrml", SERVER_ONLY_DATA);
    const outDir = join(TMP, "c11/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const clientJs = readFileSync(join(outDir, "server-only.client.js"), "utf8");
    // With the chunk gone, the GITI-003/ss19#5 post-prune also strips the
    // lowered read — client.js carries no `_scrml_stdlib.data`.
    expect(clientJs).not.toContain("_scrml_stdlib.data");
    // The client bundle must still parse (no dangling destructure of undefined).
    expect(() => new Function(clientJs)).not.toThrow();
  });

  test("§12 adversarial — client-USED stdlib chunk preserved (no over-strip)", () => {
    const src = fx("c12/repro.scrml", REPRO);
    const outDir = join(TMP, "c12/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    const runtimeFile = findRuntimeFile(outDir);
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    // sortBy drives the client render loop — chunk + read both survive.
    expect(runtimeJs).toContain("--- chunk: stdlib-data ---");
    expect(clientJs).toContain("const { sortBy } = _scrml_stdlib.data;");
  });

  test("§13 adversarial — mixed import, one name client-used → chunk preserved", () => {
    const mixed = `<program title="ss27-4 mixed">
    \${
        import { sortBy, groupBy } from 'scrml:data'

        <items> = [{ name: "b", order: 2 }, { name: "a", order: 1 }]
        <buckets> = ""

        server function bucketize() ! string {
            const g = groupBy(@items, "name")
            return "ok"
        }

        on mount { @buckets = bucketize() }
    }
    <ul>
        \${ for (let it of sortBy(@items, "order")) {
            lift <li>\${it.name}</li>
        } }
    </ul>
</program>
`;
    const src = fx("c13/mixed.scrml", mixed);
    const outDir = join(TMP, "c13/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
    expect(result.errors).toEqual([]);
    const runtimeFile = findRuntimeFile(outDir);
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    // sortBy is client-used → the chunk is kept even though groupBy is server-only.
    expect(runtimeJs).toContain("--- chunk: stdlib-data ---");
  });

  test("§14 embed mode — server-only client-safe chunk tree-shaken from per-file bundle", () => {
    const src = fx("c14/server-only.scrml", SERVER_ONLY_DATA);
    const outDir = join(TMP, "c14/dist");
    const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, embedRuntime: true, log: () => {} });
    expect(result.errors).toEqual([]);
    // embed mode inlines the runtime into client.js — the dead chunk must not appear.
    const clientJs = readFileSync(join(outDir, "server-only.client.js"), "utf8");
    expect(clientJs).not.toContain("--- chunk: stdlib-data ---");
    expect(clientJs).not.toContain("_scrml_stdlib.data =");
    expect(() => new Function(clientJs)).not.toThrow();
  });
});
