/**
 * jwt-auth-bypass-2026-07-11.test.js — HIGH security regression.
 *
 * `scrml:auth/jwt`'s exports (signJwt/verifyJwt/…) were DROPPED at compile,
 * so the STDLIB-EXPORT-SEED (api.js) never saw the async fns → they were
 * classified SYNC → a server fn emitted `verifyJwt(...)` UNAWAITED → the
 * returned Promise is truthy → `if (!result.valid)` never fires → accept-all
 * auth bypass (same class as issue #26, on the JWT path).
 *
 * Root causes (BOTH fixed):
 *   1. block-splitter.js — a slash-star block comment inside a `dollar-brace`
 *      logic context was scanned char-by-char; a `Promise<string>` in JSDoc was
 *      mis-read as a tag-opener, leaking `tagNesting` onto later `bang-brace`
 *      error-effect BLOCK_REFs, so collectExpr's boundary break was bypassed and
 *      the failable handler was absorbed ("statement boundary not detected").
 *   2. tokenizer.ts — a regex literal beginning with `=` (the base64url padding
 *      strip at jwt.scrml:42) was excluded from regex detection and lexed as the
 *      slash-equals divide-assign OPERATOR, corrupting base64urlEncode and
 *      cascading to DROP every subsequent `export function` (the actual export
 *      drop / auth bypass).
 *
 * Defense-in-depth (api.js STDLIB-EXPORT-SEED): a server-only `scrml:*`
 * re-export that cannot be resolved to a terminal {kind, isAsync} now FAILS
 * CLOSED (defaults to async) instead of fail-open to sync.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { isServerOnlyScrmlModuleSource } from "../../src/route-inference.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const JWT_PATH = resolve(__dirname, "../../../stdlib/auth/jwt.scrml");

// Replicates api.js `_parseStdlibExports`: splitBlocks + buildAST → ast.exports.
function parseStdlibExports(absPath) {
  const bs = splitBlocks(absPath, readFileSync(absPath, "utf8"));
  const tab = buildAST(bs);
  return (tab && tab.ast && tab.ast.exports) || [];
}

describe("JWT auth-bypass — jwt.scrml export set is restored (seed sees the async fns)", () => {
  test("_parseStdlibExports(jwt.scrml) returns ALL exports, not just JwtError", () => {
    const exports = parseStdlibExports(JWT_PATH);
    const byName = new Map(exports.map((e) => [e.exportedName, e]));
    // The full export surface of scrml:auth/jwt (decodeJwtParts is an internal
    // non-`export` helper and is correctly absent).
    for (const name of ["JwtError", "signJwt", "verifyJwt", "verifyJwtJwks", "decodeJwt"]) {
      expect(byName.has(name)).toBe(true);
    }
  });

  test("signJwt and verifyJwt are seen as isAsync:true (so the classifier awaits them)", () => {
    const exports = parseStdlibExports(JWT_PATH);
    const byName = new Map(exports.map((e) => [e.exportedName, e]));
    expect(!!byName.get("signJwt")?.isAsync).toBe(true);
    expect(!!byName.get("verifyJwt")?.isAsync).toBe(true);
    expect(byName.get("signJwt")?.exportKind).toBe("function");
    expect(byName.get("verifyJwt")?.exportKind).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a server fn calling verifyJwt in an auth guard must AWAIT it.
// Pre-fix the emitted server.js had `const result = verifyJwt(...)` (a truthy
// Promise → `if (!result.valid)` never fires → accept-all bypass).
// ---------------------------------------------------------------------------
const FIXTURE_DIR = join(__dirname, "__fixtures__/jwt-auth-bypass");

function compileServer(name, src) {
  const dir = join(FIXTURE_DIR, name + "-" + Math.random().toString(36).slice(2, 8));
  mkdirSync(dir, { recursive: true });
  const inputPath = join(dir, name + ".scrml");
  writeFileSync(inputPath, src);
  const outDir = join(dir, "dist");
  const result = compileScrml({ inputFiles: [inputPath], outputDir: outDir, write: true, log: () => {} });
  function walk(d) {
    if (!existsSync(d)) return [];
    const out = [];
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }
  let serverJs = "";
  for (const f of walk(outDir)) {
    if (f.endsWith(".server.js") && !f.includes("/_scrml/")) serverJs = readFileSync(f, "utf8");
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  const errors = (result.errors || []).filter((e) => e.severity !== "warning" && e.code !== "E-PA-002");
  return { serverJs, errors };
}

const authPage = `<page auth="optional">
  <db src="./app.db" protect="password_hash" tables="users">
    \${
      import { verifyJwt } from 'scrml:auth'

      server function checkToken(token, secret) {
        const result = verifyJwt(token, secret)
        if (!result.valid) {
          return { ok: false }
        }
        return { ok: true, payload: result.payload }
      }
    }
    <form onsubmit=checkToken("t", "s")><button type="submit">go</button></form>
  </>
</page>
`;

describe("JWT auth-bypass — server fn AWAITS verifyJwt (bypass closed end-to-end)", () => {
  test("emitted server.js awaits the verifyJwt call in the auth guard", () => {
    const { serverJs, errors } = compileServer("guard", authPage);
    expect(errors).toEqual([]);
    // The call site MUST be awaited — a bare `verifyJwt(...)` leaks the Promise.
    expect(/const\s+result\s*=\s*await\s+verifyJwt\s*\(/.test(serverJs)).toBe(true);
    expect(/const\s+result\s*=\s*verifyJwt\s*\(/.test(serverJs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth gating — isServerOnlyScrmlModuleSource. The fail-closed
// seed default only fires for SERVER-ONLY `scrml:*` modules (and submodules).
// ---------------------------------------------------------------------------
describe("JWT auth-bypass — server-only module detection (fail-closed gate)", () => {
  test("server-only modules + submodules are recognized", () => {
    expect(isServerOnlyScrmlModuleSource("scrml:auth")).toBe(true);
    expect(isServerOnlyScrmlModuleSource("scrml:auth/jwt")).toBe(true);
    expect(isServerOnlyScrmlModuleSource("scrml:crypto")).toBe(true);
    expect(isServerOnlyScrmlModuleSource("scrml:http")).toBe(true);
    expect(isServerOnlyScrmlModuleSource("scrml:oauth")).toBe(true);
  });

  test("non-server-only modules are NOT flagged (fail-closed stays scoped)", () => {
    expect(isServerOnlyScrmlModuleSource("scrml:test")).toBe(false);
    expect(isServerOnlyScrmlModuleSource("scrml:format")).toBe(false);
    expect(isServerOnlyScrmlModuleSource("scrml:math")).toBe(false);
    // A lookalike that only shares a prefix substring must not match.
    expect(isServerOnlyScrmlModuleSource("scrml:authenticator")).toBe(false);
  });
});
