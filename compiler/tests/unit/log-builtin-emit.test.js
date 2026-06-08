/**
 * §20.6 — location-transparent `log()` builtin: emit-expr lowering unit tests.
 *
 * Covers the AST-level lowering in isolation (emit-expr.ts) + the log-loc.ts
 * file:line resolver + fileDeclaresLog shadowing walker + the readable runtime
 * render. The full-compile behaviour (side-tag per route, prod-strip, the
 * W-LOG-SHADOWED diagnostic, server inlining) is in the integration suite
 * `log-builtin-integration.test.js`.
 *
 * Ratified S173 (deep-dive log-location-transparency-2026-06-07.md);
 * built S174.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  emitExpr,
  setLogProductionStrip,
  setLogShadowedInFile,
} from "../../src/codegen/emit-expr.ts";
import {
  resolveLogLoc,
  registerFileSource,
  resetLogLoc,
  fileDeclaresLog,
  SERVER_LOG_HELPER,
} from "../../src/codegen/log-loc.ts";

// A minimal EmitExprContext. `mode` ("client"|"server") is the compiler-certain
// side; `stmtSpan` carries the real statement byte offset for file:line.
function ctx(over = {}) {
  return { mode: "client", ...over };
}

const litStr = (s) => ({ kind: "lit", litType: "string", raw: JSON.stringify(s), value: s });
const spanAt = (file, start) => ({ file, start, end: start + 1, line: 1, col: 1 });
// A `log(...)` call node. The call's own span is the not-set sentinel (start 0),
// mirroring the codegen re-parse; the real offset rides on stmtSpan in ctx.
const logCall = (args, span) => ({
  kind: "call",
  callee: { kind: "ident", name: "log" },
  args,
  optional: false,
  span: span ?? { file: "/x/app.scrml", start: 0, end: 0, line: 1, col: 1 },
});

function assertValidJs(jsExpr) {
  expect(() => new Function(`return (${jsExpr});`)).not.toThrow();
}

beforeEach(() => {
  // Reset the module-level toggles so tests don't leak state into each other.
  setLogProductionStrip(false);
  setLogShadowedInFile(false);
  resetLogLoc();
});

// ---------------------------------------------------------------------------
// §A — basic lowering: log(...) -> _scrml_log(side, loc, ...args)
// ---------------------------------------------------------------------------

describe("§20.6 — log() lowering", () => {
  test("client-mode log() tags [client]", () => {
    const js = emitExpr(logCall([litStr("hi")]), ctx({ mode: "client" }));
    expect(js).toStartWith('_scrml_log("client", ');
    expect(js).toContain('"hi"');
    assertValidJs(js);
  });

  test("server-mode log() tags [server]", () => {
    const js = emitExpr(logCall([litStr("hi")]), ctx({ mode: "server" }));
    expect(js).toStartWith('_scrml_log("server", ');
    assertValidJs(js);
  });

  test("zero-arg log() lowers without a trailing comma", () => {
    const js = emitExpr(logCall([]), ctx());
    // _scrml_log("client", "<loc>") — two args, no trailing comma.
    expect(js).toMatch(/^_scrml_log\("client", "[^"]*"\)$/);
    assertValidJs(js);
  });

  test("multi-arg log() passes every rendered arg through", () => {
    const js = emitExpr(logCall([litStr("a"), litStr("b")]), ctx());
    expect(js).toContain('"a"');
    expect(js).toContain('"b"');
    assertValidJs(js);
  });
});

// ---------------------------------------------------------------------------
// §B — file:line resolution (log-loc.ts)
// ---------------------------------------------------------------------------

describe("§20.6 — file:line resolution", () => {
  test("resolves basename:line from a registered source byte offset", () => {
    const file = "/proj/app.scrml";
    const src = "line1\nline2\nlog(\"x\")\n"; // log( starts at offset 12 -> line 3
    registerFileSource(file, src);
    const loc = resolveLogLoc(spanAt(file, src.indexOf("log(")));
    expect(loc).toBe("app.scrml:3");
  });

  test("the lowering uses ctx.stmtSpan when the call node span is not set", () => {
    const file = "/proj/app.scrml";
    const src = "a\nb\nc\nlog(\"x\")\n"; // log( at offset 6 -> line 4
    registerFileSource(file, src);
    const js = emitExpr(
      logCall([litStr("x")]), // call node span.start === 0 (not set)
      ctx({ stmtSpan: spanAt(file, src.indexOf("log(")) }),
    );
    expect(js).toContain('"app.scrml:4"');
  });

  test("unregistered file falls back to basename only (no throw)", () => {
    const loc = resolveLogLoc({ file: "/proj/app.scrml", start: 0, line: 1 });
    expect(loc).toBe("app.scrml");
  });

  test("no file -> empty loc (caller omits the suffix)", () => {
    expect(resolveLogLoc(null)).toBe("");
    expect(resolveLogLoc({ start: 5 })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §C — production strip (F4=A)
// ---------------------------------------------------------------------------

describe("§20.6 — production strip", () => {
  test("production mode lowers log() to a no-op with zero _scrml_log reference", () => {
    setLogProductionStrip(true);
    const js = emitExpr(logCall([litStr("secret")]), ctx());
    expect(js).toBe("(void 0)");
    expect(js).not.toContain("_scrml_log");
    expect(js).not.toContain("secret"); // args dropped — no side-effect residue
    assertValidJs(js);
  });

  test("dev mode (default) keeps the _scrml_log call", () => {
    const js = emitExpr(logCall([litStr("x")]), ctx());
    expect(js).toContain("_scrml_log");
  });
});

// ---------------------------------------------------------------------------
// §D — shadowing (Open-Q3): a user `log` wins
// ---------------------------------------------------------------------------

describe("§20.6 — shadowing", () => {
  test("local declaredNames containing 'log' yields an ordinary call", () => {
    const js = emitExpr(
      logCall([litStr("x")]),
      ctx({ declaredNames: new Set(["log"]) }),
    );
    expect(js).toBe('log("x")');
    expect(js).not.toContain("_scrml_log");
  });

  test("file-level shadow flag yields an ordinary call", () => {
    setLogShadowedInFile(true);
    const js = emitExpr(logCall([litStr("x")]), ctx());
    expect(js).toBe('log("x")');
    expect(js).not.toContain("_scrml_log");
  });

  test("fileDeclaresLog detects a top-level function-decl named log", () => {
    const ast = { nodes: [
      { kind: "function-decl", name: "log", body: [] },
      { kind: "function-decl", name: "bump", body: [] },
    ] };
    expect(fileDeclaresLog(ast)).toBe(true);
  });

  test("fileDeclaresLog detects a nested fn-decl named log", () => {
    const ast = { ast: { nodes: [
      { kind: "logic", body: [{ kind: "fn-decl", name: "log", body: [] }] },
    ] } };
    expect(fileDeclaresLog(ast)).toBe(true);
  });

  test("fileDeclaresLog is false when no log declaration exists", () => {
    const ast = { nodes: [{ kind: "function-decl", name: "other", body: [] }] };
    expect(fileDeclaresLog(ast)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §E — SERVER_LOG_HELPER is syntactically valid + carries the helpers
// ---------------------------------------------------------------------------

describe("§20.6 — server inline helper", () => {
  test("SERVER_LOG_HELPER is valid JS and defines both helpers", () => {
    expect(SERVER_LOG_HELPER).toContain("function _scrml_log(");
    expect(SERVER_LOG_HELPER).toContain("function _scrml_log_render(");
    expect(() => new Function(SERVER_LOG_HELPER)).not.toThrow();
  });

  test("SERVER_LOG_HELPER carries no bare `undefined` keyword (W-CG-UNDEFINED)", () => {
    // The canonical paired check is exempt, but this helper uses typeof guards;
    // there must be no bare `=== undefined` / `!== undefined`.
    expect(/[!=]==\s*undefined/.test(SERVER_LOG_HELPER)).toBe(false);
  });

  test("the inlined render produces a readable value-faithful string", () => {
    // Exercise the actual server-inlined render over representative values.
    const mod = new Function(SERVER_LOG_HELPER + "\nreturn _scrml_log_render;")();
    expect(mod("hello")).toBe("hello");
    expect(mod(42)).toBe("42");
    expect(mod(true)).toBe("true");
    expect(mod(null)).toBe("not");          // absence (§42)
    expect(mod(undefined)).toBe("not");      // both null + undefined -> not
    expect(mod([1, 2, 3])).toBe("[1, 2, 3]");
    expect(mod({ name: "Ann", age: 3 })).toBe("{age: 3, name: Ann}"); // alpha-sorted
    expect(mod({ _tag: "Flower", power: 3 })).toBe("Flower(power: 3)"); // enum
    expect(mod({ _tag: "Mushroom" })).toBe("Mushroom");                 // payloadless enum
  });
});
