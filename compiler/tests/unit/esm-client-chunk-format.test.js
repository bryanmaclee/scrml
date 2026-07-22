/**
 * esm-client-chunk-format.test.js — ESM chunks arc, Unit 2.
 *
 * Unit 2 makes each client `.client.js` chunk a valid ES module under
 * `--module-format=esm` (default `classic` stays byte-identical):
 *   §1  `toEsmClientChunk` pure transform — footer→export, registry read→namespace
 *       import, runtime import surface, URL resolution (incl. pages/ strip), the
 *       `_scrml_lift_target` globalThis bridge, and the fail-loud guard.
 *   §2  compile integration — esm chunks carry NO `_scrml_modules` reference, no
 *       IIFE wrap, and every chunk parses as an ES module; classic default is
 *       byte-identical to explicit `--module-format=classic`.
 *   §3  module linkage EXECUTES — the esm runtime + chunks, loaded as REAL modules
 *       via bun's native ESM loader, LINK (runtime + cross-chunk imports resolve)
 *       and reactivity roundtrips (the "emitted != runs" bar; full-DOM `<script
 *       type=module>` proof lives in tests/browser + the PA's R26 Chromium pass).
 *   §4  the `g-nav-chunk-lexical-collision` gap dissolves — two chunks declaring
 *       the same `type Phase:enum` collide in one CLASSIC script scope (a real
 *       `SyntaxError`) but coexist as separate ES modules.
 *   §5  runtime R2 — the esm runtime bridges the shared-mutable `_scrml_lift_target`
 *       through globalThis (a U1 gap surfaced by U2's real chunks).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { toEsmClientChunk } from "../../src/codegen/emit-client-esm.ts";
import { toEsmRuntime } from "../../src/codegen/runtime-esm.ts";
import { assembleRuntime, RUNTIME_CHUNK_ORDER } from "../../src/codegen/runtime-chunks.ts";
import * as acorn from "acorn";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../bin/scrml.js");
const MF_EXAMPLE = join(import.meta.dir, "../../../examples/22-multifile");

const tmpDirs = [];
function freshDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// A tiny synthetic runtime slice — its top-level decls are the import universe.
const RUNTIME_SLICE = [
  `function _scrml_reactive_get(n) { return n; }`,
  `function _scrml_reactive_set(n, v) {}`,
  `function _scrml_lift(f) {}`,
  `var _scrml_lift_target = null;`,
  `var _scrml_stdlib = {};`,
  ``,
].join("\n");

function esm(body, opts = {}) {
  return toEsmClientChunk(body, {
    runtimeSlice: RUNTIME_SLICE,
    runtimePlaceholder: "__RT__",
    importerDistDir: opts.importerDistDir ?? ".",
  });
}

describe("§1 toEsmClientChunk — the pure transform", () => {
  test("registration footer becomes `export { emit as pub }` (mangled → public)", () => {
    const body =
      `// Requires: __RT__\n` +
      `function _scrml_foo_3() {}\n` +
      `const Color = Object.freeze({ Red: "Red" });\n` +
      `// --- cross-file module registry footer (known-gaps-#6, §21.3) ---\n` +
      `_scrml_modules["dep.client.js"] = { foo: _scrml_foo_3, Color: Color };\n`;
    const out = esm(body);
    expect(out).toContain("export { _scrml_foo_3 as foo, Color };");
    expect(out).not.toContain("_scrml_modules");
  });

  test("empty footer becomes `export {};` (still a module)", () => {
    const body =
      `// Requires: __RT__\n` +
      `_scrml_modules["dep.client.js"] = {  };\n`;
    const out = esm(body);
    expect(out).toContain("export {};");
    expect(out).not.toContain("_scrml_modules");
  });

  test("registry read becomes a deduped namespace import + local destructure", () => {
    const body =
      `// Requires: __RT__\n` +
      `const { LoadCard, formatRate } = _scrml_modules["components/load-card.client.js"];\n` +
      `const { LoadCardRow } = _scrml_modules["components/load-card.client.js"];\n` +
      `const { UserRole } = _scrml_modules["schema.client.js"];\n`;
    const out = esm(body);
    // One namespace import PER unique key (deduped), first-appearance order.
    expect(out).toContain(`import * as __scrml_dep_0 from "./components/load-card.client.js";`);
    expect(out).toContain(`import * as __scrml_dep_1 from "./schema.client.js";`);
    expect((out.match(/import \* as __scrml_dep_0/g) || []).length).toBe(1);
    // Reads rewritten to the alias — namespace access yields `undefined` for a
    // missing export (a component/type name), matching classic registry semantics.
    expect(out).toContain(`const { LoadCard, formatRate } = __scrml_dep_0;`);
    expect(out).toContain(`const { LoadCardRow } = __scrml_dep_0;`);
    expect(out).toContain(`const { UserRole } = __scrml_dep_1;`);
    expect(out).not.toContain("_scrml_modules");
  });

  test("default read becomes `= alias.default`", () => {
    const body =
      `// Requires: __RT__\n` +
      `const Thing = _scrml_modules["thing.client.js"].default;\n`;
    const out = esm(body);
    expect(out).toContain(`import * as __scrml_dep_0 from "./thing.client.js";`);
    expect(out).toContain(`const Thing = __scrml_dep_0.default;`);
  });

  test("runtime import surface = referenced ∩ runtime-exports − chunk-own-decls", () => {
    const body =
      `// Requires: __RT__\n` +
      `function _scrml_reactive_get() { return 1; }\n` + // chunk-own decl SHADOWS runtime name → excluded
      `const x = _scrml_reactive_set("a", 1);\n` +        // referenced runtime export → imported
      `const y = document.body;\n`;                       // a global, not a runtime export → not imported
    const out = esm(body);
    expect(out).toContain(`import { _scrml_reactive_set } from "./__RT__";`);
    // shadowed name is NOT imported (would be a redeclaration)
    expect(out).not.toMatch(/import \{[^}]*_scrml_reactive_get/);
    // a plain global is never imported
    expect(out).not.toContain("document } from");
  });

  test("`_scrml_lift_target` is routed through globalThis, never imported (R2 bridge)", () => {
    const body =
      `// Requires: __RT__\n` +
      `_scrml_lift_target = document.querySelector("#x");\n` +
      `_scrml_lift(() => document.createElement("li"));\n` +
      `_scrml_lift_target = null;\n`;
    const out = esm(body);
    expect(out).toContain(`globalThis._scrml_lift_target = document.querySelector("#x");`);
    expect(out).toContain(`globalThis._scrml_lift_target = null;`);
    // _scrml_lift (a normal fn) IS imported; _scrml_lift_target is NOT.
    expect(out).toContain(`import { _scrml_lift } from "./__RT__";`);
    expect(out).not.toMatch(/import \{[^}]*_scrml_lift_target/);
  });

  test("fail-loud: assigning a NON-bridged runtime global throws (would break at eval)", () => {
    const body =
      `// Requires: __RT__\n` +
      `_scrml_stdlib = {};\n`; // _scrml_stdlib is a runtime export, not globalThis-bridged
    expect(() => esm(body)).toThrow(/assigns runtime global.*_scrml_stdlib/);
  });

  test("fail-loud covers destructure + for-of/for-in write forms (not just `x = …`)", () => {
    // Every write FORM that binds the bare runtime global `_scrml_reactive_get`
    // (an unbridged export) must trip the guard — else a future codegen change
    // using one of these ships a chunk that imports a read-only binding and then
    // assigns it (module-eval throw, green compile, dead chunk).
    const wrap = (stmt) => `// Requires: __RT__\nconst o = { _scrml_reactive_get: 1 };\nconst a = [1];\n${stmt}\n`;
    const forms = [
      `({ _scrml_reactive_get } = o);`,        // object-destructure assignment
      `({ x: _scrml_reactive_get } = o);`,     // renamed object-destructure target
      `[ _scrml_reactive_get ] = a;`,          // array-destructure assignment
      `({ ..._scrml_reactive_get } = o);`,     // rest element
      `for (_scrml_reactive_get of a) { break; }`, // for-of loop target
      `for (_scrml_reactive_get in o) { break; }`, // for-in loop target
      `_scrml_reactive_get++;`,                // update expression
    ];
    for (const stmt of forms) {
      expect(() => esm(wrap(stmt))).toThrow(/assigns runtime global.*_scrml_reactive_get/);
    }
    // A NEW local via `for (const x of …)` is NOT a write to the outer binding —
    // it must NOT trip the guard (would be a false positive).
    expect(() => esm(`// Requires: __RT__\nfor (const _scrml_reactive_get of [1]) { break; }\n`)).not.toThrow();
    // A property write to a member (`o._scrml_reactive_get = …`) binds no bare
    // identifier — also not a hazard, must not trip.
    expect(() => esm(`// Requires: __RT__\nconst o = {};\no._scrml_reactive_get = 1;\n`)).not.toThrow();
  });

  test("URL resolution: nested importer + pages/ strip (mirrors the dist WRITE layout)", () => {
    const body =
      `// Requires: __RT__\n` +
      `const { X } = _scrml_modules["components/c.client.js"];\n`;
    // Importer source dir `pages/dispatch` → dist `dispatch` (pages stripped).
    const out = esm(body, { importerDistDir: "pages/dispatch" });
    // dep `components/c.client.js` is at root → `../components/c.client.js` from `dispatch`.
    expect(out).toContain(`import * as __scrml_dep_0 from "../components/c.client.js";`);
    // runtime (root) → `../__RT__` (depth 1 after strip), NOT `../../`.
    // (no runtime import here — the body references no runtime symbol — so assert URL via a runtime-referencing body)
    const rtBody =
      `// Requires: __RT__\n` +
      `const v = _scrml_reactive_get("a");\n`;
    const rtOut = esm(rtBody, { importerDistDir: "pages/dispatch" });
    expect(rtOut).toContain(`from "../__RT__";`);
  });

  test("the transformed body has no `_scrml_modules` reference and parses as an ES module", () => {
    const body =
      `// Requires: __RT__\n` +
      `const { A } = _scrml_modules["a.client.js"];\n` +
      `function _scrml_foo_9() { return _scrml_reactive_get("x"); }\n` +
      `_scrml_modules["self.client.js"] = { foo: _scrml_foo_9 };\n`;
    const out = esm(body);
    expect(out).not.toContain("_scrml_modules");
    expect(() => acorn.parse(out, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });
});

// --- compile helpers (shell out to the real CLI so outputBaseDir / pages-strip /
//     composition behave exactly as production) ---
function compileDir(srcDir, moduleFormat) {
  const out = freshDir(`scrml-u2-out-`);
  const args = [CLI, "compile", srcDir, "-o", out];
  if (moduleFormat) args.push(`--module-format=${moduleFormat}`);
  const r = spawnSync("bun", args, { encoding: "utf8" });
  return { out, r };
}
function clientChunks(dir) {
  const found = [];
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else if (n.name.endsWith(".client.js")) found.push(p);
    }
  };
  walk(dir);
  return found;
}
function runtimeFileIn(dir) {
  const n = readdirSync(dir).find((f) => f.startsWith("scrml-runtime.") && f.endsWith(".js"));
  return n ? join(dir, n) : null;
}

describe("§2 compile integration — esm chunks are ES modules; classic stays byte-identical", () => {
  test("esm chunks have NO _scrml_modules / IIFE and all parse as ES modules", () => {
    const { out, r } = compileDir(MF_EXAMPLE, "esm");
    expect(r.status).toBe(0);
    const chunks = clientChunks(out);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      const src = readFileSync(c, "utf8");
      expect(src.includes("_scrml_modules")).toBe(false);
      // No cross-file IIFE WRAP under esm — the wrap opens a column-0 `(function() {`
      // enclosing the whole body (a lowered `match` IIFE is indented, so excluded).
      expect(/^\(function\(\) \{/m.test(src)).toBe(false);
      expect(() => acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    }
    // The runtime is a module too.
    const rt = runtimeFileIn(out);
    expect(() => acorn.parse(readFileSync(rt, "utf8"), { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });

  test("default (no flag) === explicit --module-format=classic, byte-identical per file", () => {
    const a = compileDir(MF_EXAMPLE, undefined);
    const b = compileDir(MF_EXAMPLE, "classic");
    expect(a.r.status).toBe(0);
    expect(b.r.status).toBe(0);
    const aFiles = clientChunks(a.out).map((p) => p.slice(a.out.length));
    const bFiles = clientChunks(b.out).map((p) => p.slice(b.out.length));
    expect(aFiles.sort()).toEqual(bFiles.sort());
    for (const rel of aFiles) {
      expect(Buffer.compare(readFileSync(join(a.out, rel)), readFileSync(join(b.out, rel)))).toBe(0);
    }
    // Same runtime hash == same runtime bytes.
    expect(runtimeFileIn(a.out).split("/").pop()).toBe(runtimeFileIn(b.out).split("/").pop());
  });
});

describe("§3 module linkage EXECUTES (bun native ESM loader)", () => {
  test("runtime + cross-chunk imports resolve as real modules and reactivity roundtrips", async () => {
    const { out, r } = compileDir(MF_EXAMPLE, "esm");
    expect(r.status).toBe(0);

    // Runtime module — reactivity roundtrip + subscriber.
    const rt = runtimeFileIn(out);
    const rtMjs = rt + ".mjs";
    copyFileSync(rt, rtMjs);
    const runtime = await import(rtMjs);
    runtime._scrml_reactive_set("probe", 41);
    let fired = 0;
    runtime._scrml_reactive_subscribe("probe", () => { fired++; });
    runtime._scrml_reactive_set("probe", 42);
    expect(runtime._scrml_reactive_get("probe")).toBe(42);
    expect(fired).toBeGreaterThanOrEqual(1);

    // A pure exporter chunk — its enum + fn are cross-chunk-visible module exports.
    const types = await import(join(out, "types.client.js"));
    expect(types.UserRole?.Admin).toBe("Admin");
    expect(typeof types.badgeColor).toBe("function");

    // A cross-chunk importer — `components` imports `types`; the import graph LINKS
    // (bun would throw a resolution/link error here if the emitted URL were wrong).
    const components = await import(join(out, "components.client.js"));
    expect(components).toBeDefined();
  });
});

describe("§4 g-nav-chunk-lexical-collision dissolves under module scope", () => {
  function writeCollisionApp() {
    const dir = freshDir("scrml-u2-collision-");
    mkdirSync(join(dir, "pages"), { recursive: true });
    const enumDecl = `type Phase:enum = { Idle, Loading, Done }\n`;
    writeFileSync(
      join(dir, "app.scrml"),
      `<program>\n  ${enumDecl}\n  <appPhase> = Phase.Idle\n\n  <main data-scrml-lift-target>\n    <h1>Shell</h1>\n    <p>@appPhase</p>\n    <outlet></outlet>\n  </main>\n</program>\n`,
    );
    writeFileSync(
      join(dir, "pages", "detail.scrml"),
      `${enumDecl}\n<detailPhase> = Phase.Loading\n\n<section>\n  <h2>Detail</h2>\n  <p>@detailPhase</p>\n</section>\n`,
    );
    return dir;
  }

  test("classic: two chunks both declare top-level `const Phase_toEnum` → collide in one script scope", () => {
    const src = writeCollisionApp();
    const { out, r } = compileDir(src, "classic");
    expect(r.status).toBe(0);
    const app = readFileSync(join(out, "app.client.js"), "utf8");
    const detail = readFileSync(join(out, "detail.client.js"), "utf8");
    expect(app).toContain("const Phase_toEnum");
    expect(detail).toContain("const Phase_toEnum");
    // Simulate the shared classic-<script> document scope: concatenating both
    // bodies into ONE scope is a hard redeclaration SyntaxError — the collision.
    expect(() =>
      acorn.parse(app + "\n" + detail, { ecmaVersion: 2022, sourceType: "script" }),
    ).toThrow(/already been declared/);
  });

  test("esm: each chunk's `Phase_toEnum` is module-local → the two modules coexist", async () => {
    const src = writeCollisionApp();
    const { out, r } = compileDir(src, "esm");
    expect(r.status).toBe(0);
    const appSrc = readFileSync(join(out, "app.client.js"), "utf8");
    const detailSrc = readFileSync(join(out, "detail.client.js"), "utf8");
    // Still top-level `const Phase_toEnum` in each — but now module-scoped.
    expect(appSrc).toContain("const Phase_toEnum");
    expect(detailSrc).toContain("const Phase_toEnum");
    // Each parses as a module independently — module scope makes `Phase_toEnum`
    // module-LOCAL, so the classic shared-scope redeclaration cannot occur. The
    // contrast is exact: the same two bodies concatenated as classic scripts
    // (previous test) throw `already been declared`; as modules they don't.
    expect(() => acorn.parse(appSrc, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    expect(() => acorn.parse(detailSrc, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    // Neither chunk cross-references the other's `Phase_toEnum` (no shared registry).
    expect(appSrc).not.toContain("_scrml_modules");
    expect(detailSrc).not.toContain("_scrml_modules");
  });
});

describe("§5 runtime R2 — shared lift-target bridged through globalThis (U1-gap close)", () => {
  test("toEsmRuntime routes the _scrml_lift container read through globalThis._scrml_lift_target", () => {
    const rt = toEsmRuntime(assembleRuntime(new Set(RUNTIME_CHUNK_ORDER)));
    expect(rt).toContain("globalThis._scrml_lift_target");
    // The read consults the globalThis slot FIRST, then the classic module-local.
    expect(rt).toMatch(/globalThis\._scrml_lift_target\)\s*\n\s*\|\| _scrml_lift_target/);
  });
});

describe("§6 U3 BLOCKER — build+esm content-hash must rewrite in-chunk import URLs", () => {
  // PINNED, SKIPPED requirement (known-gap `g-esm-build-content-hash-import-urls`,
  // MED, DEFERRED to U3). `scrml build --module-format=esm` content-hashes the
  // chunk FILES (`x.client.js` → `x.client.<hash>.js`) and rewrites the HTML
  // <script src> refs, but NOT the in-chunk ES `import` specifiers U2 emits — so a
  // cross-chunk `import * as __scrml_dep_0 from "./types.client.js"` points at the
  // PRE-hash name → 404 on disk → dead module graph. Harmless today (the esm path
  // is browser-DOA + `W-MODULE-FORMAT-ESM-INCOMPLETE`-warned until U3). U3 must
  // extend the content-hash rewrite to in-chunk import URLs (or hard-gate
  // build+esm), then UN-SKIP this test.
  test.skip("every cross-chunk import specifier in a build+esm chunk resolves on disk", () => {
    const src = MF_EXAMPLE;
    const out = freshDir("scrml-u2-build-esm-");
    const r = spawnSync("bun", [CLI, "build", src, "--output", out, "--module-format=esm"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const chunk of clientChunks(out)) {
      const dir = chunk.slice(0, chunk.lastIndexOf("/"));
      const srcText = readFileSync(chunk, "utf8");
      for (const m of srcText.matchAll(/import (?:\* as \w+|\{[^}]*\}) from "(\.\.?\/[^"]+)"/g)) {
        const resolved = join(dir, m[1]);
        expect(existsSync(resolved)).toBe(true); // FAILS today: spec is the pre-hash name
      }
    }
  });
});
