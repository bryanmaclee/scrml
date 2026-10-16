/**
 * stdlib-shim-export-parity — S462 (s462-stdlib-import-004)
 *
 * A `scrml:NAME` import is judged at compile time against the module's `.scrml`
 * export list (E-IMPORT-004, module-resolver `validateStdlibImports`, fed by the
 * STDLIB-EXPORT-SEED stage), but it RUNS against the hand-written JS shim at
 * `compiler/runtime/stdlib/NAME.js`. If the two lists disagree, a program the
 * compiler accepts fails when its server bundle links (`does not provide an
 * export named …`) or reads `undefined` on the client.
 *
 * For every importable stdlib module (`scrml:NAME` and `scrml:NAME/sub`, the
 * deferred `scrml:compiler*` family excepted) this pins, using the shim's REAL
 * ES-module export list (dynamic import, not a regex):
 *   §1  the shim file exists for every module that exports anything;
 *   §2  every `.scrml` export is a shim export — functions, consts, re-exports
 *       and ENUM types (enums have a run-time value: the variant constructors).
 *       A `:struct` type has no run-time value and is not required; a server
 *       import of one is pruned by usage at emit time;
 *   §3  every shim export is a `.scrml` export (no run-time-only surface the
 *       compiler would refuse to import), except the named allow-list below;
 *   §4  every ENUM the module exports has the same SHAPE in the shim as in the
 *       `.scrml` declaration (read by the compiler's own buildTypeRegistry):
 *       the same variant names, a unit variant is its name string, a payload
 *       variant is a constructor whose parameters are the payload field names in
 *       order, and `variants` lists the variant names in declaration order;
 *   §5  the type checker's internal ParseError (type-system.ts PARSE_ERROR_ENUM —
 *       NOT a built-in name since S466; it resolves only a parseVariant call's
 *       failure type) is the same enum stdlib/data/parse.scrml declares (drift
 *       guard), and `ParseError` is absent from BUILTIN_TYPES (import-only);
 *   §6  (S462 P0) every exported FUNCTION has the same async-ness in both: the
 *       `.scrml` declaration is `async` exactly when the shim function is an
 *       AsyncFunction, and a sync shim function never hands back a Promise (no
 *       `new Promise` / `.then(` / `Promise.` and no call to an async function of
 *       its own shim or a shim it imports). The compiler awaits a stdlib call
 *       only when the `.scrml` side says `async` (§13.2); a shim that returns a
 *       Promise behind a sync declaration leaks it un-awaited, and a Promise is
 *       truthy — `if (verifyJwtJwks(garbage, url).valid)` … read `.valid` off a
 *       Promise, and `if (hmac(k, m) == sig)` compared a Promise.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { listStdlibModules } from "../../src/module-resolver.js";
import { buildTypeRegistry, BUILTIN_TYPES, PARSE_ERROR_ENUM } from "../../src/type-system.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SHIM_ROOT = resolve(here, "../../runtime/stdlib");

// Shim exports that are deliberately NOT part of the module's scrml surface.
// `scrml:mcp` — compiler-internal (MCP V0 Sub-unit D, auto-bundled by the
// compiler); the runtime/tool helpers below are consumed by generated code and
// the MCP sidecar, not by scrml source. Each entry is a named exception, never a
// pattern: a new shim export must be declared in the `.scrml` source or listed here.
const SHIM_ONLY_EXPORTS = {
  "scrml:mcp": [
    "install", "uninstall", "loadSidecars", "stopWatchers", "getCurrentVariant",
    "getFormStatus", "getChannelState", "_stateForTests", "_resetForTests",
    "toolGetAppTopology", "toolListEngines", "toolGetEngine", "toolListForms",
    "toolGetFormStatus", "toolListRoutes", "toolGetRouteChunks",
    "toolListServerFunctions", "toolListChannels", "toolGetChannelState",
    "toolGetReachableServerFns", "buildToolSpecs", "TOOL_NAMES", "registerMcpTools",
  ],
};

function parse(absPath) {
  return buildAST(splitBlocks(absPath, readFileSync(absPath, "utf8"))).ast;
}

/** The declared shape of every enum `absPath` declares: name → [[variant, fields|null]]. */
function declaredEnums(absPath) {
  const ast = parse(absPath);
  const reg = buildTypeRegistry(ast.typeDecls || [], [], { file: absPath, start: 0, end: 0, line: 1, col: 1 });
  const out = new Map();
  for (const td of ast.typeDecls || []) {
    const t = reg.get(td.name);
    if (t?.kind !== "enum") continue;
    out.set(td.name, (t.variants || []).map((v) => [v.name, v.payload ? [...v.payload.keys()] : null]));
  }
  return out;
}

/** The parameter names of a shim constructor (`function(a, b) { … }`). */
function paramNames(fn) {
  const m = /^[^(]*\(([^)]*)\)/.exec(Function.prototype.toString.call(fn));
  return m ? m[1].split(",").map((p) => p.trim()).filter(Boolean) : [];
}

/** The shape a shim enum object presents, in the form `declaredEnums` returns. */
function shimEnumShape(obj, declared) {
  return declared.map(([name]) => {
    const v = obj?.[name];
    if (typeof v === "function") return [name, paramNames(v)];
    return [name, v === name ? null : `<not the variant name: ${JSON.stringify(v)}>`];
  });
}

/** Terminal kind of every exported name ("struct" | "enum" | "value"), re-exports chased. */
function exportKinds(absPath, depth = 0) {
  const ast = parse(absPath);
  const typeKind = new Map((ast.typeDecls || []).map((t) => [t.name, t.typeKind]));
  const out = new Map();
  for (const exp of ast.exports || []) {
    if (!exp.exportedName) continue;
    const names = exp.exportedName.split(",").map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      if (exp.exportKind === "re-export" && exp.reExportSource && depth < 8) {
        const local = Array.isArray(exp.renames)
          ? (exp.renames.find((r) => r && r.exported === name)?.local ?? name)
          : name;
        const src = resolve(dirname(absPath), exp.reExportSource);
        out.set(name, exportKinds(src, depth + 1).get(local) ?? "value");
      } else if (exp.exportKind === "type") {
        out.set(name, typeKind.get(name) === "struct" ? "struct" : "enum");
      } else {
        out.set(name, "value");
      }
    }
  }
  return out;
}

/** Async-ness of every exported FUNCTION, re-exports chased: name → { isAsync, file }. */
function exportedFnAsync(absPath, depth = 0) {
  const ast = parse(absPath);
  const out = new Map();
  for (const exp of ast.exports || []) {
    if (!exp.exportedName) continue;
    for (const name of exp.exportedName.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (exp.exportKind === "re-export" && exp.reExportSource && depth < 8) {
        const local = Array.isArray(exp.renames)
          ? (exp.renames.find((r) => r && r.exported === name)?.local ?? name)
          : name;
        const hit = exportedFnAsync(resolve(dirname(absPath), exp.reExportSource), depth + 1).get(local);
        if (hit) out.set(name, hit);
      } else if (exp.exportKind === "function" || exp.exportKind === "fn") {
        out.set(name, { isAsync: !!exp.isAsync, file: absPath });
      }
    }
  }
  return out;
}

/** Names of the async functions a shim file declares, and those of the relative shims it imports. */
function shimAsyncNames(shimPath, seen = new Set()) {
  const out = new Set();
  if (seen.has(shimPath) || !existsSync(shimPath)) return out;
  seen.add(shimPath);
  const text = readFileSync(shimPath, "utf8");
  for (const m of text.matchAll(/async\s+function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of text.matchAll(/from\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
    for (const n of shimAsyncNames(resolve(dirname(shimPath), m[1]), seen)) out.add(n);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[$]/g, "\\$");

const modules = listStdlibModules();

describe("stdlib shim export parity (.scrml export list vs runtime shim)", () => {
  test("the module list covers the stdlib (sanity)", () => {
    const specs = modules.map((m) => m.specifier);
    expect(specs).toContain("scrml:data");
    expect(specs).toContain("scrml:auth/jwt");
    expect(specs.some((s) => s.startsWith("scrml:compiler"))).toBe(false);
  });

  for (const { specifier, absPath } of modules) {
    const kinds = exportKinds(absPath);
    if (kinds.size === 0) continue; // nothing importable (e.g. a markup template)
    const shimPath = join(SHIM_ROOT, `${specifier.slice("scrml:".length)}.js`);

    test(`${specifier}: §1 shim exists, §2 every .scrml export is a shim export, §3 and vice versa`, async () => {
      expect(existsSync(shimPath)).toBe(true);
      const shimNames = new Set(Object.keys(await import(shimPath)));
      const missingInShim = [...kinds]
        .filter(([name, kind]) => kind !== "struct" && !shimNames.has(name))
        .map(([name]) => name);
      expect(missingInShim).toEqual([]);
      const allowed = new Set(SHIM_ONLY_EXPORTS[specifier] ?? []);
      const shimOnly = [...shimNames].filter((n) => !kinds.has(n) && !allowed.has(n));
      expect(shimOnly).toEqual([]);
    });

    const fnAsync = exportedFnAsync(absPath);
    if (fnAsync.size > 0) {
      test(`${specifier}: §6 every exported function has the same async-ness in the .scrml and the shim`, async () => {
        const mod = await import(shimPath);
        const asyncHere = shimAsyncNames(shimPath);
        const mismatches = [];
        for (const [name, { isAsync }] of fnAsync) {
          const f = mod[name];
          if (typeof f !== "function") continue; // §2 reports a missing export
          const shimAsync = f.constructor.name === "AsyncFunction";
          if (shimAsync !== isAsync) {
            mismatches.push(`${name}: .scrml ${isAsync ? "async" : "sync"}, shim ${shimAsync ? "async" : "sync"}`);
            continue;
          }
          if (shimAsync) continue;
          const body = Function.prototype.toString.call(f);
          const promiseText = /new\s+Promise\b|\.then\s*\(|\bPromise\s*\./.test(body);
          const callsAsync = [...asyncHere].filter(
            (n) => n !== name && new RegExp(`(?<![\\w$.])${escapeRe(n)}\\s*\\(`).test(body),
          );
          if (promiseText || callsAsync.length > 0) {
            mismatches.push(`${name}: declared sync but its shim body ${promiseText ? "builds a Promise" : `calls async ${callsAsync.join(", ")}`}`);
          }
        }
        expect(mismatches).toEqual([]);
      });
    }

    const enums = declaredEnums(absPath);
    if (enums.size > 0) {
      test(`${specifier}: §4 every declared enum has the same variants / payload fields in the shim`, async () => {
        const mod = await import(shimPath);
        for (const [name, declared] of enums) {
          if (!kinds.has(name)) continue; // a module-private enum is not part of the surface
          expect({ name, shape: shimEnumShape(mod[name], declared) }).toEqual({ name, shape: declared });
          expect({ name, variants: mod[name]?.variants }).toEqual({ name, variants: declared.map(([v]) => v) });
        }
      });
    }
  }

  test("§5 the internal ParseError is the enum stdlib/data/parse.scrml declares; it is not a built-in name", () => {
    const parsePath = modules.find((m) => m.specifier === "scrml:data/parse").absPath;
    const declared = declaredEnums(parsePath).get("ParseError");
    expect(BUILTIN_TYPES.has("ParseError")).toBe(false);
    const builtin = PARSE_ERROR_ENUM;
    expect(builtin?.kind).toBe("enum");
    expect(builtin.variants.map((v) => [v.name, v.payload ? [...v.payload.keys()] : null])).toEqual(declared);
  });
});
