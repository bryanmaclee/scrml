/**
 * known-gaps-#6 (S152) — multi-file cross-file CLIENT module-loading browser
 * test (Approach B, `_scrml_modules` registry). This is the scenario that
 * SILENTLY miscompiled: an entry page imports a fn/enum (`types.scrml`) + a
 * component (`components.scrml`) from sibling `.scrml` files, and the emitted
 * `app.client.js` shipped a bare ES `import` into a CLASSIC <script> — which
 * SyntaxErrors at parse time and runs ZERO client code.
 *
 * The fix lowers local `.scrml` imports to `_scrml_modules` registry reads,
 * emits a registration footer on each dependency `.client.js`, and loads the
 * dependency scripts BEFORE the entry's (topo order, deps-first). This test
 * faithfully reproduces the classic-script load order in one happy-dom IIFE:
 *   runtime → types.client.js → components.client.js → app.client.js
 * and asserts (a) no parse/eval error, (b) the registry is populated with the
 * exported fn/enum, (c) the team-badge DOM rendered.
 *
 * SPEC anchors: §21.3 (cross-file imports), §40 (client emit).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { tmpdir } from "os";

const APP = resolve(import.meta.dir, "../../../examples/22-multifile/app.scrml");
const tmpRoot = resolve(tmpdir(), "scrml-multifile-import-browser");

/**
 * Compile examples/22-multifile/app.scrml (auto-gathers types.scrml +
 * components.scrml) and return the entry HTML + every emitted artifact's text,
 * plus the ordered dependency `<script src>` list parsed from the entry HTML.
 */
function compileMultifile() {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const outDir = resolve(tmpRoot, `case-${uniq}`);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = compileScrml({ inputFiles: [APP], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const read = (rel) => {
      const p = resolve(outDir, rel);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    const html = read("app.html");
    const runtimeJs = read(result.runtimeFilename ?? "scrml-runtime.js");
    // Ordered dependency <script src> list (deps-first), then the entry script.
    const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    return {
      errors,
      html,
      runtimeJs,
      runtimeFilename: result.runtimeFilename,
      clientByName: {
        types: read("types.client.js"),
        components: read("components.client.js"),
        app: read("app.client.js"),
      },
      scriptSrcs,
    };
  } finally {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Load the compiled artifacts the way a real browser would: each script is a
 * SEPARATE top-level program sharing ONE global scope (NOT one combined IIFE).
 * This is the faithful model that exposes the global-lexical `const` collision
 * the IIFE wrap fixes: two scripts each declaring top-level `const UserRole`
 * across the shared global lexical env → "Identifier already declared". We
 * evaluate runtime → deps (deps-first) → entry as distinct `eval` calls in the
 * SAME global scope (happy-dom installs `globalThis`), capturing any throw.
 */
function loadAsSeparateScripts(c) {
  let threw = null;
  try {
    // Each script body is global-eval'd; the runtime establishes shared globals
    // (incl. `var _scrml_modules`), then each .client.js IIFE registers/reads.
    // (0, eval) forces indirect (global-scope) eval, mirroring <script> eval.
    const globalEval = (src) => (0, eval)(src);
    globalEval(c.runtimeJs);
    globalEval(c.clientByName.types);
    globalEval(c.clientByName.components);
    globalEval(c.clientByName.app);
  } catch (e) {
    threw = e;
  }
  return threw;
}

describe("known-gaps-#6 — multi-file cross-file client module loading (browser)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  test("compiles with zero errors and emits all three client.js artifacts", () => {
    const c = compileMultifile();
    expect(c.errors).toEqual([]);
    expect(c.clientByName.types.length).toBeGreaterThan(0);
    expect(c.clientByName.components.length).toBeGreaterThan(0);
    expect(c.clientByName.app.length).toBeGreaterThan(0);
  });

  test("entry HTML loads dependency scripts BEFORE the entry, deps-first", () => {
    const c = compileMultifile();
    // Expected order: runtime, types, components, app (types is a leaf;
    // components imports types; app imports both).
    const runtimeIdx = c.scriptSrcs.findIndex((s) => s === c.runtimeFilename);
    const typesIdx = c.scriptSrcs.indexOf("types.client.js");
    const componentsIdx = c.scriptSrcs.indexOf("components.client.js");
    const appIdx = c.scriptSrcs.indexOf("app.client.js");
    expect(runtimeIdx).toBeGreaterThanOrEqual(0);
    expect(typesIdx).toBeGreaterThan(runtimeIdx);
    expect(componentsIdx).toBeGreaterThan(typesIdx);
    expect(appIdx).toBeGreaterThan(componentsIdx);
  });

  test("separate classic <script> eval (faithful browser model): no collision / no parse error", () => {
    // THE regression guard for the global-lexical `const` collision. Pre-fix
    // (no IIFE wrap), evaluating types.client.js then app.client.js as separate
    // global-scope scripts threw "Identifier 'UserRole' has already been
    // declared" (the exporter's top-level `const UserRole` collides with the
    // importer's `const { UserRole } = _scrml_modules[...]`). The per-file IIFE
    // wrap scopes both — they share only the global `_scrml_modules` registry.
    const c = compileMultifile();
    expect(c.errors).toEqual([]);
    const bodyMatch = c.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = (bodyMatch ? bodyMatch[1] : c.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    document.body.innerHTML = bodyHtml;
    const threw = loadAsSeparateScripts(c);
    expect(threw).toBeNull();
  });

  test("loading runtime + deps + entry as CLASSIC scripts: no parse/eval error", () => {
    const c = compileMultifile();
    expect(c.errors).toEqual([]);
    // Strip the entry HTML's own <script> tags; install the body markup so the
    // lift target query in app.client.js can resolve.
    const bodyMatch = c.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = (bodyMatch ? bodyMatch[1] : c.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    document.body.innerHTML = bodyHtml;

    // Faithful classic-script sequential eval: runtime, then deps deps-first,
    // then the entry — all sharing one global scope (one document, one runtime).
    const exec = new Function(
      "window",
      "document",
      `${c.runtimeJs}\n` +
        `${c.clientByName.types}\n` +
        `${c.clientByName.components}\n` +
        `${c.clientByName.app}\n` +
        `globalThis.__scrml_modules__ = _scrml_modules;\n`,
    );
    let threw = null;
    try {
      exec(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      threw = e;
    }
    // The pre-fix bug raised "Cannot use import statement outside a module" at
    // parse time, or "ReferenceError: ... is not defined". Both → threw !== null.
    expect(threw).toBeNull();
  });

  test("the _scrml_modules registry exposes the exported fn + enum from types.client.js", () => {
    const c = compileMultifile();
    const exec = new Function(
      "window",
      "document",
      `${c.runtimeJs}\n${c.clientByName.types}\n${c.clientByName.components}\n${c.clientByName.app}\n` +
        `globalThis.__scrml_modules__ = _scrml_modules;\n`,
    );
    exec(window, document);
    const reg = globalThis.__scrml_modules__;
    expect(typeof reg).toBe("object");
    // types.scrml exports `fn badgeColor` + `enum UserRole`.
    const types = reg["types.client.js"];
    expect(types).toBeDefined();
    expect(typeof types.badgeColor).toBe("function");
    // The enum variant object is registered under its public name.
    expect(types.UserRole).toBeDefined();
    expect(types.UserRole.Admin).toBe("Admin");
    // badgeColor resolves the enum-keyed color (the cross-file fn actually runs).
    expect(types.badgeColor("Admin")).toBe("red");
    expect(types.badgeColor("Guest")).toBe("gray");
  });

  test("the team-badge DOM rendered (the scenario that silently miscompiled)", () => {
    const c = compileMultifile();
    const bodyMatch = c.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = (bodyMatch ? bodyMatch[1] : c.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    document.body.innerHTML = bodyHtml;
    const exec = new Function(
      "window",
      "document",
      `${c.runtimeJs}\n${c.clientByName.types}\n${c.clientByName.components}\n${c.clientByName.app}\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // The page renders a <ul> of team members; the seed data has 5 members.
    // The static markup tree is rendered by the .html payload + the lift loop;
    // assert the team heading + at least the list scaffold is present.
    const team = document.querySelector(".team");
    expect(team).not.toBeNull();
    const items = document.querySelectorAll("li");
    // The lift loop appends one <li> per team member (5 seed members). In the
    // classic-script model the lift target resolves and the loop runs.
    expect(items.length).toBeGreaterThanOrEqual(5);
  });
});
