/**
 * g-http-client-inline-private-helper-drop (S245) — the CLIENT stdlib inliner
 * must inline the SAME-FILE private helpers (and same-file sibling exports) that
 * an imported symbol references, not just the imported symbol itself.
 *
 * Bug: `_inlineSiblingShimImports` (runtime-template.js) extracted an imported
 * symbol's definition and recursed only into the SIBLING's cross-file `import`
 * statements — it never scanned the extracted def's BODY for the sibling's own
 * top-level helpers. compiler/runtime/stdlib/http.js's get/post/put/del/patch/
 * uploadFile all call an unexported top-level `_request`; a client-inlined `get`
 * therefore emitted a call to an undefined `_request` -> browser
 * `ReferenceError: _request is not defined`. This concretely broke the auth
 * client chunk (auth.js imports `get as httpGet` from http.js).
 *
 * Fix: after extracting the imported def, inline the transitive closure of
 * same-file top-level names it references, in dependency order, deduped,
 * collision-guarded (importing shim's own def wins), extracted UNDER ORIGINAL
 * names. The body scan skips member-access-position identifiers (`obj.name`) so
 * a false positive like `_request`'s `opts.retry` token cannot spuriously pull
 * the `retry` export (whose raw `Math.*` would breach the single-scrml:math-
 * source runtime invariant).
 *
 * §1  real http.js: `import { get }` inlines `_request` (defined, before `get`, once).
 * §2  every http private-referencing export inlines its needed helpers, parseable.
 * §3  dependency-order + dedup: withDefaults -> get/post/... -> _request (each once).
 * §4  2-level transitive (synthetic): export A -> private B -> private C, ordered + callable.
 * §5  original-named under `as`-alias: `get as fetchIt` -> `function fetchIt` calls bare `_request`.
 * §6  collision guard: importing shim's OWN `_request` wins; the sibling's is skipped.
 * §7  member-access false-positive guard: `import { get }` does NOT pull `retry` (no raw Math leak).
 * §8  spread reference is kept: `...defaults` still drags in a top-level `defaults`.
 * §9  real auth chunk (SCRML_RUNTIME): defines `_request`, IIFE evaluates, no undefined helper.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import {
  SCRML_RUNTIME,
  _inlineSiblingShimImports,
} from "../../src/runtime-template.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const STDLIB_DIR = join(__dir, "../../runtime/stdlib");

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "clientinline-privhelper-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function shim(dir, name, source) {
  const abs = join(dir, name);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
}

// Assemble the inlined chunk body exactly as _loadStdlibChunk would: prelude
// (inlined siblings + same-file helper closure) + export-stripped body.
function assemble(source, dir) {
  const { prelude, body } = _inlineSiblingShimImports(source, dir, new Set());
  return (prelude ? prelude + "\n" : "") + body.replace(/^export /gm, "");
}

// Count top-level function/const/let/var declarations of `name`.
function defCount(code, name) {
  const fn = (code.match(new RegExp(`\\bfunction\\s+${name}\\b`, "g")) || []).length;
  const decl = (code.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, "g")) || []).length;
  return fn + decl;
}
function defines(code, name) {
  return defCount(code, name) > 0;
}
// Index of the definition of `name` (function/const), or -1.
function defIndex(code, name) {
  const m = new RegExp(`\\b(?:function|const|let|var)\\s+${name}\\b`).exec(code);
  return m ? m.index : -1;
}

describe("client-inliner inlines same-file private-helper closure (S245)", () => {
  test("§1  real http.js: import { get } inlines _request (defined, before get, once)", () => {
    const src =
      'import { get } from "./http.js";\n' +
      "export function useGet(u){ return get(u); }\n";
    const out = assemble(src, STDLIB_DIR);
    expect(defines(out, "get")).toBe(true);          // imported symbol inlined
    expect(defines(out, "_request")).toBe(true);     // same-file private helper inlined
    expect(defCount(out, "_request")).toBe(1);       // exactly once
    // Dependency order: _request defined BEFORE the get that calls it.
    expect(defIndex(out, "_request")).toBeGreaterThanOrEqual(0);
    expect(defIndex(out, "_request")).toBeLessThan(defIndex(out, "get"));
    // get's body still calls _request (bare) — now resolvable.
    expect(/return\s+_request\(/.test(out)).toBe(true);
    // The assembled chunk is syntactically valid JS (no undefined-at-parse).
    expect(() => new Function(out)).not.toThrow();
  });

  test("§2  every http private-referencing export inlines its helpers, parseable", () => {
    // name -> same-file top-level names that MUST be present in the assembled out.
    const expectations = {
      get: ["_request"],
      post: ["_request"],
      put: ["_request"],
      del: ["_request"],
      patch: ["_request"],
      uploadFile: ["_request", "multipart"], // uploadFile calls multipart AND _request
    };
    for (const [name, needed] of Object.entries(expectations)) {
      const out = assemble(`import { ${name} } from "./http.js";\n`, STDLIB_DIR);
      expect(defines(out, name)).toBe(true);
      for (const helper of needed) {
        expect({ name, helper, defined: defines(out, helper) }).toEqual({
          name, helper, defined: true,
        });
        expect(defCount(out, helper)).toBe(1); // deduped
      }
      // Parseable — no dangling undefined top-level helper at compile.
      expect(() => new Function(out)).not.toThrow();
    }
  });

  test("§3  dependency-order + dedup: withDefaults -> get/post/... -> _request (each once)", () => {
    const out = assemble('import { withDefaults } from "./http.js";\n', STDLIB_DIR);
    // withDefaults references the sibling exports get/post/put/del/patch...
    for (const method of ["get", "post", "put", "del", "patch"]) {
      expect(defines(out, method)).toBe(true);
      expect(defCount(out, method)).toBe(1);
      // ...which transitively drag in the single shared _request.
      expect(defIndex(out, "_request")).toBeLessThan(defIndex(out, method));
    }
    expect(defCount(out, "_request")).toBe(1); // shared, deduped across all 5
    expect(() => new Function(out)).not.toThrow();
  });

  test("§4  2-level transitive (synthetic): export A -> private B -> private C, ordered + callable", () => {
    const dir = join(TMP, "transitive");
    shim(
      dir,
      "chain.js",
      "function _c(x) {\n  return x + 1;\n}\n" +
        "function _b(x) {\n  return _c(x) * 10;\n}\n" +
        "export function a(x) {\n  return _b(x) + 100;\n}\n",
    );
    const out = assemble('import { a } from "./chain.js";\n', dir);
    expect(defines(out, "a")).toBe(true);
    expect(defines(out, "_b")).toBe(true); // level-1 private
    expect(defines(out, "_c")).toBe(true); // level-2 private (transitive)
    // Dependency order: _c before _b before a.
    expect(defIndex(out, "_c")).toBeLessThan(defIndex(out, "_b"));
    expect(defIndex(out, "_b")).toBeLessThan(defIndex(out, "a"));
    // Deduped.
    expect(defCount(out, "_b")).toBe(1);
    expect(defCount(out, "_c")).toBe(1);
    // Actually callable end-to-end.
    const mod = new Function(out + "\nreturn { a };")();
    expect(mod.a(2)).toBe((2 + 1) * 10 + 100); // _c(2)=3 -> _b=30 -> a=130
  });

  test("§5  original-named under `as`-alias: get as fetchIt -> function fetchIt calls bare _request", () => {
    const out = assemble('import { get as fetchIt } from "./http.js";\n', STDLIB_DIR);
    // The imported symbol is renamed...
    expect(/function\s+fetchIt\b/.test(out)).toBe(true);
    expect(/function\s+get\b/.test(out)).toBe(false); // renamed, not under original
    // ...but the private helper keeps its ORIGINAL name (body references it so).
    expect(defines(out, "_request")).toBe(true);
    expect(defCount(out, "_request")).toBe(1);
    expect(/return\s+_request\(/.test(out)).toBe(true);
    expect(defIndex(out, "_request")).toBeLessThan(defIndex(out, "fetchIt"));
  });

  test("§6  collision guard: importing shim's OWN _request wins; sibling's is skipped", () => {
    const dir = join(TMP, "collision");
    // Sibling provides `get` (calls _request) AND its own _request.
    shim(
      dir,
      "sib.js",
      'function _request(u) {\n  return "SIBLING:" + u;\n}\n' +
        "export function get(u) {\n  return _request(u);\n}\n",
    );
    // Importer defines its OWN _request and imports get from the sibling.
    const importer =
      'import { get } from "./sib.js";\n' +
      'function _request(u) {\n  return "OWN:" + u;\n}\n' +
      "export function useGet(u) {\n  return get(u);\n}\n";
    const out = assemble(importer, dir);
    // Exactly ONE _request — the importer's own (the collision guard skipped
    // inlining the sibling's, mirroring the :143 export-collision rule).
    expect(defCount(out, "_request")).toBe(1);
    const mod = new Function(out + "\nreturn { useGet, _request };")();
    // The importer's _request wins: get() routes through "OWN:".
    expect(mod.useGet("z")).toBe("OWN:z");
  });

  test("§7  member-access false-positive guard: import { get } does NOT pull `retry` (no raw Math leak)", () => {
    const out = assemble('import { get } from "./http.js";\n', STDLIB_DIR);
    // `_request`'s body mentions `opts.retry` (member access) — a bare word scan
    // would spuriously match the exported `retry`, whose body carries raw
    // Math.pow/Math.max, breaching the single-scrml:math-source invariant.
    expect(defines(out, "retry")).toBe(false);
    expect(/Math\.pow/.test(out)).toBe(false);
    expect(/Math\.max\(0,/.test(out)).toBe(false);
  });

  test("§8  spread reference is kept: `...defaults` drags in a top-level defaults", () => {
    const dir = join(TMP, "spread");
    shim(
      dir,
      "sp.js",
      "const _defaults = { a: 1 };\n" +
        "export function make(extra) {\n  return { ..._defaults, ...extra };\n}\n",
    );
    const out = assemble('import { make } from "./sp.js";\n', dir);
    // `_defaults` is referenced ONLY via spread `..._defaults` — the scan must
    // keep it (a `...` leading dot is not member access).
    expect(defines(out, "_defaults")).toBe(true);
    const mod = new Function(out + "\nreturn { make };")();
    expect(mod.make({ b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("§9  real auth chunk (SCRML_RUNTIME): defines _request, IIFE evaluates, exports present", () => {
    const start = SCRML_RUNTIME.indexOf("// --- chunk: stdlib-auth ---");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = SCRML_RUNTIME.slice(start);
    const nextIdx = rest.indexOf("// --- chunk:", 1);
    const chunk = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
    // The fix: the auth chunk (auth.js imports get as httpGet from http.js) now
    // carries the _request definition its httpGet calls.
    expect(/function\s+_request\b/.test(chunk)).toBe(true);
    expect(/_request\(/.test(chunk)).toBe(true);
    // The IIFE evaluates without a ReferenceError and produces the registry.
    const registry = new Function(
      "const _scrml_stdlib = {};\n" + chunk + "\nreturn _scrml_stdlib;",
    )();
    expect(registry.auth).toBeDefined();
    expect(Object.keys(registry.auth).length).toBeGreaterThan(0);
  });
});
