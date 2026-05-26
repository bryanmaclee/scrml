/**
 * meta-checker-bug17.test.js — Bug 17 / S134
 *
 * Regression-guard tests for the categorical §22.12 enforcement of JS-host
 * ambient globals inside `^{}` meta bodies. Bug 17 closed the second-order
 * gap surfaced during S133 D Step A: the META_BUILTINS narrowing fired
 * E-META-001 for compile-time meta blocks only (the `bodyUsesCompileTimeApis`
 * gate at meta-checker.ts:~1131), but a pure runtime `^{ const x = bun.eval(...) }`
 * with no `reflect`/`emit` still silently passed meta-checker and reached
 * the browser, where `bun` is not defined.
 *
 * The fix adds `JS_HOST_FORBIDDEN` (a 9-member set: `bun`, `Bun`, `process`,
 * `console`, `setInterval`, `setTimeout`, `clearInterval`, `clearTimeout`,
 * `fetch`) and a parallel UNCONDITIONAL walker `checkMetaBlockForJsHostGlobals`
 * that runs on every `^{}` body regardless of compile-time vs runtime
 * classification. Per SPEC §22.12 line 14687 + §22.5 line 14375, these
 * SHALL trigger E-META-001.
 *
 * Coverage groups:
 *   bug17-RT-1  Runtime meta + bun         → E-META-001
 *   bug17-RT-2  Runtime meta + process     → E-META-001
 *   bug17-RT-3  Runtime meta + fetch       → E-META-001
 *   bug17-RT-4  Runtime meta + setInterval → E-META-001
 *   bug17-RT-5  Runtime meta + setTimeout  → E-META-001
 *   bug17-RT-6  Runtime meta + Bun         → E-META-001
 *   bug17-RT-7  Runtime meta + console     → E-META-001
 *   bug17-NC-1  Runtime meta + META_BUILTINS (JSON / Object) → no E-META-001
 *   bug17-NC-2  Runtime meta + local let/const                → no E-META-001
 *   bug17-NC-3  Runtime meta + meta.* API                     → no E-META-001
 *
 * Test pattern: each E-META-001 assertion is exercised at TWO surfaces:
 *   (a) the unit-level `checkMetaBlockForJsHostGlobals` direct call (fast,
 *       deterministic; matches §11b/§18b S133 style)
 *   (b) end-to-end via `compileScrml` with a real .scrml fixture file
 *       (matches `runtime-meta-integration.test.js` `compileSource` style)
 *
 * SPEC anchors:
 *   §22.5 line 14375 — "Using `setInterval` / `setTimeout` directly inside
 *                       a `^{}` body SHALL emit `E-META-001`."
 *   §22.12 line 14687 — "JS-host ambient globals (`bun`, `process`,
 *                        `setInterval`, `fetch`, etc.) are NOT in the
 *                        META_BUILTINS set and trigger `E-META-001`."
 *   §22.11           — E-META-001 catalog row (broadened in this dispatch
 *                       to enumerate the three fire conditions).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import {
  runMetaChecker,
  checkMetaBlockForJsHostGlobals,
  JS_HOST_FORBIDDEN,
  MetaError,
} from "../../src/meta-checker.ts";

// ---------------------------------------------------------------------------
// Fixture setup (end-to-end suite)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-checker-bug17");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Unit-level helpers (mirror meta-checker.test.js style)
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeConstDecl(name, init) {
  return {
    id: 1,
    kind: "const-decl",
    name,
    init,
    initExpr: parseExprToNode(init, "/test/app.scrml", 0),
    span: span(0),
  };
}

function makeBareExpr(expr) {
  return {
    id: 1,
    kind: "bare-expr",
    expr,
    exprNode: parseExprToNode(expr, "/test/app.scrml", 0),
    span: span(0),
  };
}

function makeMetaNode(body, id = 100) {
  return {
    id,
    kind: "meta",
    body,
    parentContext: "markup",
    span: span(0),
  };
}

// ---------------------------------------------------------------------------
// End-to-end helper (mirror runtime-meta-integration.test.js style)
// ---------------------------------------------------------------------------

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: FIXTURE_OUTPUT,
    write: false,
  });
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
  };
}

function hasEMeta001For(errors, id) {
  return errors.some(
    (e) =>
      e.code === "E-META-001" &&
      typeof e.message === "string" &&
      e.message.includes(`'${id}'`),
  );
}

// ---------------------------------------------------------------------------
// JS_HOST_FORBIDDEN — sanity (set composition)
// ---------------------------------------------------------------------------

describe("Bug 17 — JS_HOST_FORBIDDEN composition", () => {
  test("exports the expected 9-member set per SPEC §22.12 line 14687 + §22.5 line 14375", () => {
    // Bun/Node ambient host
    expect(JS_HOST_FORBIDDEN.has("bun")).toBe(true);
    expect(JS_HOST_FORBIDDEN.has("Bun")).toBe(true);
    expect(JS_HOST_FORBIDDEN.has("process")).toBe(true);
    expect(JS_HOST_FORBIDDEN.has("console")).toBe(true);
    // S114 timers (replaced by meta.interval / meta.timeout)
    expect(JS_HOST_FORBIDDEN.has("setInterval")).toBe(true);
    expect(JS_HOST_FORBIDDEN.has("setTimeout")).toBe(true);
    expect(JS_HOST_FORBIDDEN.has("clearInterval")).toBe(true);
    expect(JS_HOST_FORBIDDEN.has("clearTimeout")).toBe(true);
    // Network (replaced by server-fn boundary)
    expect(JS_HOST_FORBIDDEN.has("fetch")).toBe(true);
    // No accidental additions
    expect(JS_HOST_FORBIDDEN.size).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// bug17-RT-1 through bug17-RT-7 — runtime ^{} body with each forbidden id
//
// "Runtime" here means: the body contains NO compile-time API pattern
// (no `reflect(...)`, no `emit(...)`). Under S133 Step A, such a body
// early-returns from `checkMetaBlock` and never reaches META_BUILTINS
// enforcement; only the new unconditional walker fires.
// ---------------------------------------------------------------------------

describe("Bug 17 — runtime ^{} block + JS-host global fires E-META-001", () => {
  const cases = [
    { id: "bun",          expr: 'bun.eval("Date.now()")' },
    { id: "process",      expr: "process.env.PORT" },
    { id: "fetch",        expr: 'fetch("/api/x")' },
    { id: "setInterval",  expr: "setInterval(function () { return 0 }, 1000)" },
    { id: "setTimeout",   expr: "setTimeout(function () { return 0 }, 100)" },
    { id: "Bun",          expr: "Bun.serve({})" },
    { id: "console",      expr: 'console.log("hi")' },
  ];

  for (const { id, expr } of cases) {
    test(`bug17-RT — runtime ^{} referencing '${id}' fires E-META-001 (unit-level)`, () => {
      const errors = [];
      const meta = makeMetaNode([
        // Runtime body: no reflect/emit. Pure const-init of a JS-host call.
        makeConstDecl("x", expr),
      ]);
      checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
      expect(hasEMeta001For(errors, id)).toBe(true);
    });

    test(`bug17-RT — runtime ^{} referencing '${id}' fires E-META-001 (via runMetaChecker)`, () => {
      // Runs the full meta-checker pipeline (which now invokes the new walker
      // unconditionally) on a fileAST containing a runtime meta node.
      const fileAST = {
        filePath: "/test/app.scrml",
        nodes: [
          makeMetaNode([makeConstDecl("x", expr)]),
        ],
        typeDecls: [],
        imports: [],
        exports: [],
        components: [],
        spans: {},
      };
      const result = runMetaChecker({ files: [fileAST] });
      expect(hasEMeta001For(result.errors, id)).toBe(true);
    });

    test(`bug17-RT — runtime ^{} referencing '${id}' fires E-META-001 (end-to-end compileScrml)`, () => {
      const source = `p "test"
^{
  const x = ${expr}
}
`;
      const { errors } = compileSource(source, `bug17-rt-${id}.scrml`);
      expect(hasEMeta001For(errors, id)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Bare-expression form (no const wrapper) — verifies the walker handles
// bare-expr nodes, not just let/const-decl initializers.
// ---------------------------------------------------------------------------

describe("Bug 17 — runtime ^{} bare-expression form", () => {
  test("bare-expr 'fetch(\"/api\")' inside runtime ^{} fires E-META-001", () => {
    const errors = [];
    const meta = makeMetaNode([
      makeBareExpr('fetch("/api/x")'),
    ]);
    checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
    expect(hasEMeta001For(errors, "fetch")).toBe(true);
  });

  test("bare-expr 'setInterval(...)' inside runtime ^{} fires E-META-001", () => {
    const errors = [];
    const meta = makeMetaNode([
      makeBareExpr("setInterval(function () { return 0 }, 1000)"),
    ]);
    checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
    expect(hasEMeta001For(errors, "setInterval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bug17-NC-1 — negative control: META_BUILTINS members in runtime meta
// ---------------------------------------------------------------------------

describe("Bug 17 — negative controls (no E-META-001)", () => {
  test("bug17-NC-1 runtime ^{} referencing META_BUILTINS (Object/JSON/Math) does NOT fire E-META-001", () => {
    {
      const errors = [];
      const meta = makeMetaNode([
        makeConstDecl("keys", "Object.keys({ a: 1 })"),
      ]);
      checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
      expect(errors.filter((e) => e.code === "E-META-001")).toHaveLength(0);
    }
    {
      const errors = [];
      const meta = makeMetaNode([
        makeConstDecl("s", 'JSON.stringify({ a: 1 })'),
      ]);
      checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
      expect(errors.filter((e) => e.code === "E-META-001")).toHaveLength(0);
    }
    {
      const errors = [];
      const meta = makeMetaNode([
        makeConstDecl("m", "Math.max(1, 2, 3)"),
      ]);
      checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
      expect(errors.filter((e) => e.code === "E-META-001")).toHaveLength(0);
    }
  });

  test("bug17-NC-2 runtime ^{} referencing local let/const does NOT fire E-META-001", () => {
    // The walker honors metaLocals (collectMetaLocals walks decls in the body).
    // `y = x + 1` should reach checkIdent for `x`, but `x` is NOT in
    // JS_HOST_FORBIDDEN — so no error from the new walker. Likewise `y`.
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("x", "1"),
      makeConstDecl("y", "x + 1"),
    ]);
    checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
    expect(errors.filter((e) => e.code === "E-META-001")).toHaveLength(0);
  });

  test("bug17-NC-2b runtime ^{} that LOCALLY DECLARES 'process' as a const shadows the host global (no E-META-001)", () => {
    // Per SPEC §22.12 the host global is forbidden, but a user can locally
    // declare a binding with the same name; the walker honors local
    // declarations as shadowing (`metaLocals.has(id)` skip in checkIdent).
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("process", "42"),
      makeConstDecl("y", "process + 1"),
    ]);
    checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
    expect(errors.filter((e) => e.code === "E-META-001")).toHaveLength(0);
  });

  test("bug17-NC-3 runtime ^{} referencing meta.* API does NOT fire E-META-001", () => {
    // `meta.set` is a method on the runtime `meta` API; `meta` is the
    // implicit parameter to the effect body, not a JS-host global. The
    // walker's checkIdent skips identifiers not in JS_HOST_FORBIDDEN, so
    // `meta` (the identifier) does not match.
    const errors = [];
    const fileAST = {
      filePath: "/test/app.scrml",
      nodes: [
        makeMetaNode([
          makeBareExpr('meta.set("cell", meta.get("cell") + 1)'),
        ]),
      ],
      typeDecls: [],
      imports: [],
      exports: [],
      components: [],
      spans: {},
    };
    const result = runMetaChecker({ files: [fileAST] });
    // Allow other diagnostics, but JS_HOST_FORBIDDEN should not fire.
    const eMeta001ForJsHost = result.errors.filter(
      (e) =>
        e.code === "E-META-001" &&
        // any of the 9 forbidden idents quoted in the message body
        [...JS_HOST_FORBIDDEN].some((id) => e.message.includes(`'${id}'`)),
    );
    expect(eMeta001ForJsHost).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Migration hint coverage — verifies the diagnostic includes the correct
// SPEC anchor + hint string per identifier class.
// ---------------------------------------------------------------------------

describe("Bug 17 — diagnostic message shape", () => {
  test("setInterval/setTimeout/clearInterval/clearTimeout get the meta.interval/timeout hint", () => {
    const ids = ["setInterval", "setTimeout", "clearInterval", "clearTimeout"];
    for (const id of ids) {
      const errors = [];
      const meta = makeMetaNode([
        makeConstDecl("x", `${id}(function () { return 0 }, 100)`),
      ]);
      checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
      const hit = errors.find(
        (e) => e.code === "E-META-001" && e.message.includes(`'${id}'`),
      );
      expect(hit).toBeDefined();
      expect(hit.message).toContain("meta.interval / meta.timeout");
      expect(hit.message).toContain("§22.5.1");
    }
  });

  test("fetch gets the server-fn boundary hint", () => {
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("x", 'fetch("/api/x")'),
    ]);
    checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
    const hit = errors.find(
      (e) => e.code === "E-META-001" && e.message.includes("'fetch'"),
    );
    expect(hit).toBeDefined();
    expect(hit.message).toContain("server-fn boundary");
  });

  test("bun/Bun/process/console get the generic 'not available' hint", () => {
    const ids = ["bun", "Bun", "process", "console"];
    for (const id of ids) {
      const errors = [];
      // For "Bun.serve" / "process.env" / "console.log" / "bun.eval" — first
      // identifier is the JS-host ambient. Use a generic call shape.
      const meta = makeMetaNode([
        makeConstDecl("x", `${id}.member`),
      ]);
      checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
      const hit = errors.find(
        (e) => e.code === "E-META-001" && e.message.includes(`'${id}'`),
      );
      expect(hit).toBeDefined();
      expect(hit.message).toContain("not available inside");
    }
  });

  test("all diagnostics reference SPEC §22.12 (Approach C)", () => {
    const errors = [];
    const meta = makeMetaNode([
      makeConstDecl("x", "bun.eval('1+1')"),
    ]);
    checkMetaBlockForJsHostGlobals(meta, "/test.scrml", errors);
    const hit = errors.find((e) => e.code === "E-META-001");
    expect(hit).toBeDefined();
    expect(hit.message).toContain("§22.12");
    expect(hit.message).toContain("Approach C");
  });
});

// ---------------------------------------------------------------------------
// Regression — Bug 17 canonical reproducer
// ---------------------------------------------------------------------------

describe("Bug 17 — canonical reproducer from docs/known-gaps.md", () => {
  test("`p \"test\"` + runtime `^{ const x = bun.eval(...) }` fires E-META-001 end-to-end", () => {
    const source = `p "test"
^{
  const x = bun.eval("Date.now()")
}
`;
    const { errors } = compileSource(source, "bug17-canonical-repro.scrml");
    expect(hasEMeta001For(errors, "bun")).toBe(true);
  });
});
