/**
 * g-server-fn-bare-dot-payload-variant — server-side bare-dot payload-variant
 * constructor lowering (merge-blocker runtime pin).
 *
 * THE BUG
 * -------
 * A `server function` that returns/assigns a bare-dot PAYLOAD-bearing enum
 * variant — `return .Found("alice")` — emitted `return "Found"("alice");` into
 * the `.server.js`: a string literal invoked as a function → runtime
 *   `TypeError: "Found" is not a function`.
 * It compiled 100% clean (errors []). The CLIENT path lowered the identical
 * `.Found(x)` correctly to `{ variant: "Found", data: { name: x } }`.
 *
 * ROOT
 * ----
 * `emit-expr.ts:emitCall` lowers a bare-dot `.Variant(args)` constructor to the
 * self-contained `{ variant, data }` tagged-object literal ONLY when it can
 * resolve the variant's declared field names. It resolved them via
 * `emit-control-flow.ts:getVariantFieldSchema`, whose registry is populated by
 * `setVariantFieldsForFile` — called on the CLIENT emit pass ONLY. On the SERVER
 * pass that registry is null, so the lowering fell through to the broken
 * `"Variant"(args)` string-as-function emission. The fix consults the rewriter's
 * variant-field registry (populated on BOTH passes) as a fallback at the
 * constructor call site.
 *
 * This test compiles a server-fn returning a payload variant, invokes the REAL
 * emitted route handler, and asserts the returned value is the `{ variant, data }`
 * tagged object — the pin that would go red on the broken `"Variant"(args)`
 * emission (the handler throws / does not return the object).
 *
 * No SQL is used (the bug is orthogonal to SQL — it is the emitExpr lowering),
 * so the compiled `.server.js` is dynamic-imported directly, with a pre-minted
 * CSRF token mirroring sql-server-fn-runtime.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_bare_dot_variant");

let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup; no OS handles are held (no SQL in these programs)
  }
});

function compileToFiles(scrmlSource, testName) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);

  const result = compileScrml({
    inputFiles: [tmpInput],
    write: true,
    outputDir: outDir,
  });

  const serverJsPath = join(outDir, `${tag}.server.js`);
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    serverJsPath,
    tag,
  };
}

// Pre-minted CSRF token — the compiled server.js emits a baseline double-submit
// cookie gate (cookieToken === headerToken). Matching both (any non-empty value)
// passes the gate directly, no 403/retry dance. See the sql-server-fn-runtime
// docstring for the full rationale (happy-dom Set-Cookie filtering).
const TEST_CSRF_TOKEN = "test-csrf-token-bare-dot-variant";

function makeRequest(method, path, bodyObj) {
  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": TEST_CSRF_TOKEN,
      "Cookie": `scrml_csrf=${TEST_CSRF_TOKEN}`,
    },
  };
  if (bodyObj !== undefined) init.body = JSON.stringify(bodyObj);
  return new Request(`http://localhost${path}`, init);
}

function findRoute(mod, fnName) {
  return Object.values(mod).find(
    (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes(fnName),
  );
}

// A hermetic cache-busted import of a compiled server module (no SQL handle to
// dispose — these programs use none).
async function importServer(serverJsPath) {
  const url = `${serverJsPath.replace(/\\/g, "/")}?t=${Date.now()}-${tmpCounter}`;
  return import(url);
}

describe("g-server-fn-bare-dot-payload-variant — server payload-variant constructor lowering", () => {
  const src = `<program>
  type Inner:enum = { Leaf(x:int) }
  type Result:enum = { Found(name:string), Missing, Pair(a:int, b:int), Wrap(node:Inner) }

  server function pick(flag:bool) -> Result {
    if (flag) { return .Found("alice") }
    return .Missing
  }
  server function pairFn() -> Result {
    return .Pair(1, 2)
  }
  server function namedFn() -> Result {
    return .Found(name: "carol")
  }
  <h1>hi</h1>
</program>
`;

  test("emits the { variant, data } object literal (not the broken \"Variant\"(args)) server-side", () => {
    const { errors, serverJsPath } = compileToFiles(src, "emit");
    expect(errors.filter((e) => !(e.code || "").startsWith("W-"))).toEqual([]);
    expect(existsSync(serverJsPath)).toBe(true);
    const serverJs = readFileSync(serverJsPath, "utf-8");

    // The bug's signature: a bare string tag invoked as a function. MUST be gone.
    expect(serverJs).not.toContain('"Found"("alice")');
    expect(serverJs).not.toContain('"Pair"(1, 2)');
    // The correct self-contained tagged-object literal.
    expect(serverJs).toContain('{ variant: "Found", data: { name: "alice" } }');
    expect(serverJs).toContain('{ variant: "Pair", data: { a: 1, b: 2 } }');
    // Nullary variant (constraint #3) still emits the bare string tag.
    expect(serverJs).toContain('return "Missing";');
  });

  test("the REAL handler returns the { variant, data } tagged object (payload variant runs without TypeError)", async () => {
    // happy-dom pollution guard (mirrors sql-server-fn-runtime): when browser
    // tests run first, Request/Response polyfills filter the CSRF headers and
    // the gate 403s. This test's shape (emit correctness) is fully pinned by the
    // emit-level test above, which runs regardless.
    if (typeof globalThis.document !== "undefined") return;

    const { errors, serverJsPath } = compileToFiles(src, "runtime");
    expect(errors.filter((e) => !(e.code || "").startsWith("W-"))).toEqual([]);
    const mod = await importServer(serverJsPath);

    const pickRoute = findRoute(mod, "pick");
    const pairRoute = findRoute(mod, "pairFn");
    const namedRoute = findRoute(mod, "namedFn");
    expect(pickRoute).toBeDefined();
    expect(pairRoute).toBeDefined();
    expect(namedRoute).toBeDefined();

    // pick(true) → the bug case: bare-dot single-field payload variant.
    const foundResp = await pickRoute.handler(makeRequest(pickRoute.method ?? "POST", pickRoute.path, { flag: true }));
    expect(foundResp).toBeInstanceOf(Response);
    expect(foundResp.status).toBe(200);
    const foundBody = await foundResp.json();
    expect(foundBody).toEqual({ variant: "Found", data: { name: "alice" } });

    // pick(false) → nullary variant lowers to the bare string tag (constraint #3).
    const missingResp = await pickRoute.handler(makeRequest(pickRoute.method ?? "POST", pickRoute.path, { flag: false }));
    expect(missingResp.status).toBe(200);
    expect(await missingResp.json()).toBe("Missing");

    // pairFn() → multi-arg positional bare-dot payload variant (constraint #5).
    const pairResp = await pairRoute.handler(makeRequest(pairRoute.method ?? "POST", pairRoute.path, {}));
    expect(pairResp.status).toBe(200);
    expect(await pairResp.json()).toEqual({ variant: "Pair", data: { a: 1, b: 2 } });

    // namedFn() → named-field bare-dot form (already handled by the rewriter;
    // pinned to prove it stays correct alongside the positional fix).
    const namedResp = await namedRoute.handler(makeRequest(namedRoute.method ?? "POST", namedRoute.path, {}));
    expect(namedResp.status).toBe(200);
    expect(await namedResp.json()).toEqual({ variant: "Found", data: { name: "carol" } });
  });

  test("constraint #4 — the `fail .Variant(payload)` error-state envelope is unchanged", () => {
    // A failable server-fn's `fail Err.QueryFailed(...)` lowers to the error
    // envelope via a SEPARATE path (emit-logic.ts:emitFailExpr) that reads the
    // emit-control-flow registry — which this fix leaves untouched. Pin the
    // envelope shape so a future registry-population change can't silently
    // alter it.
    const failSrc = `<program>
  type Err:enum = { QueryFailed(reason:string), Timeout }

  server function mayFail(flag:bool) ! Err {
    if (flag) { fail Err.QueryFailed("boom") }
    return 42
  }
  <h1>hi</h1>
</program>
`;
    const { errors, serverJsPath } = compileToFiles(failSrc, "fail");
    expect(errors.filter((e) => !(e.code || "").startsWith("W-"))).toEqual([]);
    const serverJs = readFileSync(serverJsPath, "utf-8");
    expect(serverJs).toContain('__scrml_error: true');
    expect(serverJs).toContain('variant: "QueryFailed"');
  });

  test("constraint #2 — the qualified `Enum.Variant(args)` form is unaffected", () => {
    const qualSrc = `<program>
  type Result:enum = { Found(name:string), Missing }

  server function qualified() -> Result {
    return Result.Found("bob")
  }
  <h1>hi</h1>
</program>
`;
    const { errors, serverJsPath } = compileToFiles(qualSrc, "qualified");
    expect(errors.filter((e) => !(e.code || "").startsWith("W-"))).toEqual([]);
    const serverJs = readFileSync(serverJsPath, "utf-8");
    // Qualified form still routes through the standard MemberExpr → CallExpr
    // emission (frozen-enum constructor); NOT rewritten to an object literal.
    expect(serverJs).toContain('return Result.Found("bob");');
  });
});
