/**
 * g-stdlib-clientinline-shim-import (S177) — the CLIENT stdlib inliner must
 * follow SIBLING-shim imports.
 *
 * Bug: `_loadStdlibChunk` (runtime-template.js) stripped ALL `import`
 * statements before IIFE-wrapping a client-inlined shim (auth/crypto/data/
 * host). A client-inlined shim that imported a sibling shim (`./math.js`)
 * therefore lost the import but kept the call reference -> browser
 * ReferenceError. This blocked routing the client-inlined shims' raw `Math.*`
 * through `scrml:math` (the single-Math-source invariant from S176 DD1-Fork-1).
 *
 * Fix: the inliner classifies each top-level import. A SIBLING shim (relative
 * `./X.js`) is INLINED — the imported symbols' definitions are pulled out of
 * the sibling and prepended to the IIFE body (transitive + deduped + renamed-
 * in-place to honor `as`-aliases and side-step collisions). An EXTERNAL import
 * (`bun`, `bun:sqlite`, `node:*`) is STRIPPED (loud-fail preserved — the symbol
 * ReferenceErrors on the client, intended for server-only surfaces).
 *
 * Acceptance is RUNTIME CALLABILITY, not compile-clean: the inlined sibling
 * fns must actually execute inside the client IIFE. data.js routes clamp/
 * paginate through scrml:math; auth.js routes its JWT/TOTP/rate-limit
 * arithmetic through scrml:math AND its wall-clock through scrml:time
 * (clockNow — the S177-deferred clock de-leak, completed S179).
 *
 * §1  data chunk inlines math (mathMin/mathMax/ceil), no bare import.
 * §2  data.clamp / data.paginate are CALLABLE + correct in the evaluated runtime.
 * §3  auth chunk inlines floor/mathMax/clockNow, no bare import, clock via scrml:time.
 * §4  auth.createRateLimiter is CALLABLE + correct (the local-`max` collision case).
 * §5  the de-leaked shims emit NO bare `import` anywhere in SCRML_RUNTIME.
 * §6  EXTERNAL imports still STRIP (synthetic shim importing `bun:sqlite`).
 * §7  end-to-end browser smoke (happy-dom): an app using data.clamp renders.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync,
  mkdtempSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME, _inlineSiblingShimImports } from "../../src/runtime-template.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const __dir = dirname(fileURLToPath(import.meta.url));
const STDLIB_DIR = join(__dir, "../../runtime/stdlib");

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "clientinline-sibling-"));
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

// Slice a named stdlib chunk (`// --- chunk: stdlib-<name> ---`) out of the
// runtime string, up to the next chunk marker (or end of string).
function sliceChunk(runtime, name) {
  const start = runtime.indexOf(`// --- chunk: stdlib-${name} ---`);
  if (start === -1) return "";
  const nextMarker = /\/\/ --- chunk: stdlib-/g;
  nextMarker.lastIndex = start + 1;
  const m = nextMarker.exec(runtime);
  return runtime.slice(start, m ? m.index : undefined);
}

// Evaluate the whole runtime once and return the populated _scrml_stdlib
// registry — exactly how a classic <script> populates it in the browser.
function loadStdlibRegistry() {
  // eslint-disable-next-line no-new-func
  const fn = new Function(SCRML_RUNTIME + "\nreturn _scrml_stdlib;");
  return fn();
}

describe("client-inliner follows sibling-shim imports (S177)", () => {
  test("§1  data chunk inlines scrml:math (mathMin/mathMax/ceil), no bare import", () => {
    const chunk = sliceChunk(SCRML_RUNTIME, "data");
    expect(chunk.length).toBeGreaterThan(0);
    // Inlined under their LOCAL alias names (rename-in-place).
    expect(/function mathMin\b/.test(chunk)).toBe(true);
    expect(/function mathMax\b/.test(chunk)).toBe(true);
    expect(/function ceil\b/.test(chunk)).toBe(true);
    // No bare ES `import` survived into the classic-script chunk.
    expect(/^import\b/m.test(chunk)).toBe(false);
    // data.js's OWN min/max validator factories are untouched (not shadowed).
    expect(/function min\(minimum, message\)/.test(chunk)).toBe(true);
    expect(/function max\(maximum, message\)/.test(chunk)).toBe(true);
  });

  test("§2  data.clamp / data.paginate are CALLABLE + correct at runtime", () => {
    const stdlib = loadStdlibRegistry();
    // clamp routes Math.min(Math.max(...)) through the inlined math arithmetic.
    expect(stdlib.data.clamp(15, 0, 10)).toBe(10);
    expect(stdlib.data.clamp(-5, 0, 10)).toBe(0);
    expect(stdlib.data.clamp(7, 0, 10)).toBe(7);
    // paginate routes Math.ceil(...) through the inlined math arithmetic.
    const pg = stdlib.data.paginate([1, 2, 3, 4, 5, 6, 7], 2, 3);
    expect(pg.items).toEqual([4, 5, 6]);
    expect(pg.totalPages).toBe(3);
    expect(pg.page).toBe(2);
    expect(pg.hasNext).toBe(true);
    // data's OWN `min`/`max` VALIDATORS still produce validator objects (the
    // collision did not clobber them).
    expect(typeof stdlib.data.min).toBe("function");
    const v = stdlib.data.min(5);
    expect(typeof v.check).toBe("function");
  });

  test("§3  auth chunk inlines floor/mathMax/clockNow, no bare import, clock via scrml:time", () => {
    const chunk = sliceChunk(SCRML_RUNTIME, "auth");
    expect(chunk.length).toBeGreaterThan(0);
    expect(/function floor\b/.test(chunk)).toBe(true);
    expect(/function mathMax\b/.test(chunk)).toBe(true);
    expect(/function clockNow\b/.test(chunk)).toBe(true); // scrml:time now() inlined (S179 clock de-leak)
    expect(/^import\b/m.test(chunk)).toBe(false);
    // auth's OWN arithmetic AND wall-clock now route through the inlined helpers —
    // the only `Math.*` / `Date.now()` left are INSIDE the inlined scrml:math /
    // scrml:time wrappers (the sanctioned single touches), never in auth's own
    // JWT/TOTP/rate-limit code. Assert the de-leaked shapes are present and the
    // old raw shapes are gone.
    expect(/floor\(clockNow\(\) \/ 1000\)/.test(chunk)).toBe(true);    // de-leaked clock shape (was Date.now())
    expect(/mathMax\(0, limiter\.max - entry\.count\)/.test(chunk)).toBe(true); // S462 limiter struct
    expect(/floor\(Date\.now\(\) \/ 1000\)/.test(chunk)).toBe(false);  // old raw clock shape gone (S179)
    expect(/Math\.floor\(Date\.now/.test(chunk)).toBe(false);          // old raw shape gone
    expect(/Math\.max\(0,/.test(chunk)).toBe(false);                   // old raw shape gone
    // The ONLY surviving raw host touches are the inlined wrappers — one each:
    expect((chunk.match(/Math\.floor/g) || []).length).toBe(1); // function floor(n){ return Math.floor(n); }
    expect((chunk.match(/Math\.max/g) || []).length).toBe(1);   // function mathMax(...){ return Math.max(...); }
    expect((chunk.match(/Date\.now\(\)/g) || []).length).toBe(1); // function clockNow(){ return Date.now(); } only
  });

  test("§4  auth.createRateLimiter is CALLABLE + correct (local-`max` collision case)", () => {
    const stdlib = loadStdlibRegistry();
    // S462: the limiter is a struct; check / peek are free functions.
    const { createRateLimiter, check, peek } = stdlib.auth;
    const rl = createRateLimiter({ windowMs: 60000, max: 3 });
    expect(check(rl, "ip").remaining).toBe(2);
    expect(check(rl, "ip").remaining).toBe(1);
    expect(check(rl, "ip").remaining).toBe(0);
    const over = check(rl, "ip");
    expect(over.allowed).toBe(false);
    // mathMax(0, max - count) clamps remaining at 0 — proves the inlined math
    // `max` (mathMax) coexists with the local rate-limit ceiling `max`.
    expect(over.remaining).toBe(0);
    expect(peek(rl, "ip").remaining).toBe(0);
  });

  test("§5  no bare `import` survives anywhere in SCRML_RUNTIME", () => {
    expect(/^import\b/m.test(SCRML_RUNTIME)).toBe(false);
  });

  test("§6  classifier: SIBLING import inlines, EXTERNAL import (bun:sqlite) strips", () => {
    // Drive the classifier directly with synthetic shims in a temp dir.
    const shimDir = join(TMP, "synth");
    mkdirSync(shimDir, { recursive: true });
    // A sibling leaf shim providing one fn.
    writeFileSync(
      join(shimDir, "leaf.js"),
      "export function helper(x) {\n  return x * 2;\n}\n",
    );
    // The importing shim: ONE sibling import (inline) + ONE external import
    // (strip — the symbol must NOT be inlined; it would ReferenceError if used).
    const importing =
      'import { helper } from "./leaf.js";\n' +
      'import { Database } from "bun:sqlite";\n' +
      "\n" +
      "export function useHelper(n) {\n  return helper(n) + 1;\n}\n" +
      "export function openDb(path) {\n  return new Database(path);\n}\n";

    const { prelude, body } = _inlineSiblingShimImports(
      importing,
      shimDir,
      new Set(),
    );

    // SIBLING: `helper` definition is INLINED into the prelude.
    expect(/function helper\(x\)/.test(prelude)).toBe(true);
    // EXTERNAL: `Database` is NOT inlined anywhere — strip preserved.
    expect(prelude).not.toContain("Database");
    expect(body).not.toContain("Database = ");
    // Both `import` statements are removed from the body (no bare ES import).
    expect(/^import\b/m.test(body)).toBe(false);
    expect(body).not.toContain("bun:sqlite");
    // The importing shim's own functions survive verbatim in the body.
    expect(body).toContain("function useHelper(n)");
    expect(body).toContain("function openDb(path)");
    // The stripped external reference REMAINS in the body (ReferenceError on
    // call — the intended loud-fail for a server-only surface on the client).
    expect(body).toContain("new Database(path)");

    // Assemble the IIFE the inliner would emit and confirm the SIBLING path is
    // callable while the EXTERNAL path throws on use.
    const iife =
      "(function() {\n" + prelude + "\n" + body.replace(/^export /gm, "") +
      "\n  return { useHelper, openDb };\n})()";
    // eslint-disable-next-line no-new-func
    const mod = new Function("return " + iife)();
    expect(mod.useHelper(5)).toBe(11); // helper(5)=10, +1 -> 11
    expect(() => mod.openDb("/x")).toThrow(); // Database is undefined -> throws

    // Sanity: no `from "bun` / `from "node:` specifier survives in the runtime.
    expect(SCRML_RUNTIME).not.toContain(`from "bun`);
    expect(SCRML_RUNTIME).not.toContain(`from "node:`);
  });

  test("§7  browser smoke — an app using data.clamp renders with no console errors", () => {
    const REPRO = `<program title="clamp repro">
    \${ import { clamp } from 'scrml:data' }

    <n> = clamp(99, 0, 42)

    <p>\${@n}</p>
</program>
`;
    const src = fx("smoke/repro.scrml", REPRO);
    const outDir = join(TMP, "smoke/dist");
    const result = compileScrml({
      inputFiles: [src], outputDir: outDir, write: true, log: () => {},
    });
    expect(result.errors).toEqual([]);

    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    // No bare scrml: specifier leaked into the client.
    expect(clientJs).not.toContain(`from "scrml:`);
    expect(clientJs).not.toContain(`from 'scrml:`);
    const runtimeFile = findRuntimeFile(outDir);
    expect(runtimeFile).toBeDefined();
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    expect(runtimeJs).toContain("--- chunk: stdlib-data ---");
    // The emitted runtime file ITSELF has the inlined math + no bare import.
    expect(/function ceil\b/.test(runtimeJs)).toBe(true);
    expect(/^import\b/m.test(runtimeJs)).toBe(false);

    // Fresh happy-dom realm (avoid cross-file effect pollution — S105 pattern).
    GlobalRegistrator.unregister();
    GlobalRegistrator.register();

    const htmlContent = readFileSync(join(outDir, "repro.html"), "utf8");
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
      // eslint-disable-next-line no-eval
      eval(`(function() {\n${runtimeJs}\n${clientJs}\n})();`);
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      initError = e;
    } finally {
      console.error = origErr;
    }
    expect(initError).toBeNull();
    expect(errors).toEqual([]);
    // clamp(99, 0, 42) === 42 — proves the inlined math `mathMin`/`mathMax`
    // executed in the browser realm (no ReferenceError on the stripped import).
    const p = document.querySelector("p");
    expect(p && p.textContent).toBe("42");
  });
});

// DOM-global hygiene: happy-dom's GlobalRegistrator (registered above, or by the conformance adapter's
// run()) replaces Bun's native Response/Request/Headers/fetch/URL/setTimeout/... on globalThis.
// Unregister at file end so every later file in the same `bun test` process sees Bun's natives.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
