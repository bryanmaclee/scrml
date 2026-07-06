/**
 * §20.7 — print() / println() clean-stdout builtins: emit-expr lowering + the
 * SERVER_PRINT_HELPER + the print-shadow detection, in isolation.
 *
 * Lowering: `print(...)` → `_scrml_print(<space-joined args>)`, `println(...)`
 * → `_scrml_print(<joined> + "\n")`. NOT stripped in production (program
 * output, §20.7.4). A user-shadowed `print`/`println` yields (§20.7.5).
 *
 * The full-compile behaviour (tool-inline, server-escalation, the
 * E-PRINT-NON-PRIMITIVE + W-PRINT-SHADOWED diagnostics, the real-tool stdout)
 * is in `print-builtin-integration.test.js` + the conformance case.
 *
 * Landed S241 (SPEC §20.7; forks A(i)/B(i)).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  emitExpr,
  setLogProductionStrip,
  setPrintShadowedNames,
} from "../../src/codegen/emit-expr.ts";
import {
  filePrintBuiltinsShadowed,
  SERVER_PRINT_HELPER,
} from "../../src/codegen/log-loc.ts";

function ctx(over = {}) {
  return { mode: "client", ...over };
}

const litStr = (s) => ({ kind: "lit", litType: "string", raw: JSON.stringify(s), value: s });
const litNum = (n) => ({ kind: "lit", litType: "number", raw: String(n), value: n });
const litBool = (b) => ({ kind: "lit", litType: "bool", raw: String(b), value: b });
const printCall = (name, args) => ({
  kind: "call",
  callee: { kind: "ident", name },
  args,
  optional: false,
  span: { file: "/x/app.scrml", start: 0, end: 0, line: 1, col: 1 },
});

function assertValidJs(jsExpr) {
  expect(() => new Function(`return (${jsExpr});`)).not.toThrow();
}

beforeEach(() => {
  setLogProductionStrip(false);
  setPrintShadowedNames([]);
});

// ---------------------------------------------------------------------------
// §A — basic lowering
// ---------------------------------------------------------------------------

describe("§20.7 — print()/println() lowering", () => {
  test("print(x) lowers to _scrml_print(x), no newline", () => {
    const js = emitExpr(printCall("print", [litStr("hi")]), ctx());
    expect(js).toBe('_scrml_print(("hi"))');
    expect(js).not.toContain("\\n");
    assertValidJs(js);
  });

  test("println(x) appends exactly one \\n", () => {
    const js = emitExpr(printCall("println", [litStr("hi")]), ctx());
    expect(js).toBe('_scrml_print(("hi") + "\\n")');
    assertValidJs(js);
  });

  test("multiple args are space-joined", () => {
    const js = emitExpr(printCall("println", [litStr("a"), litStr("b")]), ctx());
    expect(js).toBe('_scrml_print(("a") + " " + ("b") + "\\n")');
    // evaluate: "a b\n"
    expect(new Function(`return (${js.replace("_scrml_print", "(x=>x)")});`)()).toBe("a b\n");
  });

  test("mixed primitive args coerce via string concat", () => {
    const js = emitExpr(printCall("println", [litStr("n="), litNum(42), litBool(true)]), ctx());
    const evaluated = new Function(`return (${js.replace("_scrml_print", "(x=>x)")});`)();
    expect(evaluated).toBe("n= 42 true\n");
  });

  test("zero-arg print() emits the empty string", () => {
    const js = emitExpr(printCall("print", []), ctx());
    expect(js).toBe('_scrml_print("")');
    assertValidJs(js);
  });

  test("zero-arg println() emits a bare newline", () => {
    const js = emitExpr(printCall("println", []), ctx());
    expect(js).toBe('_scrml_print("\\n")');
    expect(new Function(`return (${js.replace("_scrml_print", "(x=>x)")});`)()).toBe("\n");
  });

  test("emit is identical in server and client mode (no side tag, unlike log)", () => {
    const c = emitExpr(printCall("print", [litStr("x")]), ctx({ mode: "client" }));
    const s = emitExpr(printCall("print", [litStr("x")]), ctx({ mode: "server" }));
    expect(c).toBe(s);
    expect(c).not.toContain("client");
    expect(c).not.toContain("server");
  });
});

// ---------------------------------------------------------------------------
// §B — production: NOT stripped (§20.7.4) — the contrast with log()
// ---------------------------------------------------------------------------

describe("§20.7 — production survival (NOT stripped)", () => {
  test("production strip flag does NOT strip print (program output survives)", () => {
    setLogProductionStrip(true);
    const js = emitExpr(printCall("println", [litStr("real output")]), ctx());
    expect(js).toContain("_scrml_print");
    expect(js).toContain("real output"); // arg + its evaluation survive verbatim
    expect(js).not.toBe("(void 0)");
    assertValidJs(js);
  });
});

// ---------------------------------------------------------------------------
// §C — shadowing (§20.7.5): a user print/println wins → ordinary call
// ---------------------------------------------------------------------------

describe("§20.7 — shadowing", () => {
  test("local declaredNames 'print' yields an ordinary call (no _scrml_print)", () => {
    const js = emitExpr(
      printCall("print", [litStr("x")]),
      ctx({ declaredNames: new Set(["print"]) }),
    );
    expect(js).toBe('print("x")');
    expect(js).not.toContain("_scrml_print");
  });

  test("file-level shadow of println yields an ordinary call", () => {
    setPrintShadowedNames(["println"]);
    const js = emitExpr(printCall("println", [litStr("x")]), ctx());
    expect(js).toBe('println("x")');
    expect(js).not.toContain("_scrml_print");
  });

  test("shadow is name-precise: `function print` does NOT disable the println builtin", () => {
    setPrintShadowedNames(["print"]);
    const js = emitExpr(printCall("println", [litStr("x")]), ctx());
    expect(js).toBe('_scrml_print(("x") + "\\n")');
  });

  test("filePrintBuiltinsShadowed detects each name independently", () => {
    expect(filePrintBuiltinsShadowed({ nodes: [
      { kind: "function-decl", name: "print", body: [] },
    ] })).toEqual(["print"]);
    expect(filePrintBuiltinsShadowed({ nodes: [
      { kind: "function-decl", name: "println", body: [] },
    ] })).toEqual(["println"]);
    expect(filePrintBuiltinsShadowed({ nodes: [
      { kind: "function-decl", name: "other", body: [] },
    ] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §D — SERVER_PRINT_HELPER is valid JS + writes raw stdout
// ---------------------------------------------------------------------------

describe("§20.7 — server/tool inline helper", () => {
  test("SERVER_PRINT_HELPER is valid JS and defines _scrml_print", () => {
    expect(SERVER_PRINT_HELPER).toContain("function _scrml_print(");
    expect(SERVER_PRINT_HELPER).toContain("process.stdout.write");
    expect(() => new Function(SERVER_PRINT_HELPER)).not.toThrow();
  });

  test("the helper writes its argument verbatim to process.stdout", () => {
    const fn = new Function(SERVER_PRINT_HELPER + "\nreturn _scrml_print;")();
    const orig = process.stdout.write.bind(process.stdout);
    let captured = "";
    // @ts-ignore — temporary spy
    process.stdout.write = (s) => { captured += s; return true; };
    try {
      fn("hello 42\n");
      fn("tail");
    } finally {
      process.stdout.write = orig;
    }
    expect(captured).toBe("hello 42\ntail");
  });

  test("the helper never decorates (no [server]/[client] tag, no file:line)", () => {
    expect(SERVER_PRINT_HELPER).not.toContain("[server]");
    expect(SERVER_PRINT_HELPER).not.toContain("[client]");
    expect(SERVER_PRINT_HELPER).not.toContain("console.log");
  });
});
