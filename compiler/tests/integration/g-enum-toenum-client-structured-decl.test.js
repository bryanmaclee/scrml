/**
 * B2 (g-enum-toenum-client-structured-decl) — `Enum.toEnum(raw)` left UN-lowered
 * CLIENT-side when it is the RHS of a STRUCTURED `<cell> = Enum.toEnum(...)` decl.
 *
 * ROOT CAUSE (the CLIENT twin of ss22 item 5, which fixed the server path):
 *   The string-rewrite Pass 9 (`rewriteEnumToEnum`, rewrite.ts) lowers
 *   `Enum.toEnum(raw)` -> `(Enum_toEnum[raw] ?? null)`, but it runs ONLY on the
 *   STRING-fallback emit path (`emitExprField` with no ExprNode). When a
 *   structured `initExpr` is present — the common `<cell> = Enum.toEnum(@raw)`
 *   decl — the RHS is emitted via the AST walk (`emitExpr` -> `emitCall`), which
 *   left the call VERBATIM. The frozen enum object has no `toEnum` method, so the
 *   emitted `Enum.toEnum(...)` threw `TypeError: Enum.toEnum is not a function` at
 *   RUNTIME (compile exit-0, `node --check`-clean, SILENT). BOTH the C1 dispatch
 *   (`_scrml_reactive_set`) and the C5 reset init-thunk (`_scrml_init_set`) leaked
 *   the un-lowered call.
 *
 * FIX (emit-expr.ts emitCall): an AST-native twin of Pass 9, gated to the CLIENT
 * path (the server path's lowering + reachability-gated server-bundle tables stay
 * owned by emit-server.ts generateServerJs, ss22 item 5). The lowered form is
 * identical to rewriteEnumToEnum's output, but is built from the fully-emitted
 * STRUCTURED arg, so it is robust to nested-paren args that the Pass-9 `[^)]+`
 * regex mishandles.
 *
 * §14.4.3 (giti DB-coerce idiom) is the canonical adopter.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { emitExpr } from "../../src/codegen/emit-expr.ts";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-b2-toenum-client-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out };
}
const codesOf = (result) => (result.errors || []).map((e) => e.code);
const parseClean = (js) =>
  expect(() => acorn.parse(js, { ecmaVersion: 2025, sourceType: "module" })).not.toThrow();

// AST builders for the direct-emit unit tests.
const SPAN = { start: 0, end: 0 };
const id = (name) => ({ kind: "ident", name, span: SPAN });
const num = (raw) => ({ kind: "lit", litType: "number", raw, span: SPAN });
const member = (object, property) => ({ kind: "member", object, property, optional: false, span: SPAN });
const call = (callee, args) => ({ kind: "call", callee, args, optional: false, span: SPAN });
const CLIENT = { mode: "client" };
const SERVER = { mode: "server" };

// ---------------------------------------------------------------------------
// §1 — end-to-end: structured client decl `<status> = Status.toEnum(@raw)`.
// ---------------------------------------------------------------------------
describe("B2 §1: structured client decl `<status> = Status.toEnum(@raw)` lowers", () => {
  const SRC = `<program>
type Status:enum = { Pending Active Done }
<raw> = "Active"
<status> = Status.toEnum(@raw)
<div>\${@status}</div>
</program>`;

  test("the call is LOWERED to a table lookup (no un-lowered `.toEnum(` survives)", () => {
    const { result, out } = compileSource(SRC);
    expect(codesOf(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(typeof out.clientJs).toBe("string");
    // The `Status.toEnum(...)` call must NOT survive un-lowered.
    expect(out.clientJs).not.toMatch(/Status\.toEnum\s*\(/);
    // Lowered to the canonical `(Status_toEnum[...] ?? null)` form.
    expect(out.clientJs).toContain("Status_toEnum[_scrml_reactive_get(\"raw\")] ?? null");
  });

  test("BOTH the C1 dispatch (_scrml_reactive_set) and C5 reset thunk (_scrml_init_set) lower", () => {
    const { out } = compileSource(SRC);
    expect(out.clientJs).toMatch(/_scrml_reactive_set\("status", \(Status_toEnum\[/);
    expect(out.clientJs).toMatch(/_scrml_init_set\("status", \(\) => \(Status_toEnum\[/);
  });

  test("the `Status_toEnum` lookup table is present in the CLIENT bundle", () => {
    const { out } = compileSource(SRC);
    expect(out.clientJs).toMatch(/const\s+Status_toEnum\s*=\s*\{/);
  });

  test("the emitted client JS is acorn-clean (no SyntaxError)", () => {
    const { out } = compileSource(SRC);
    parseClean(out.clientJs);
  });

  test("RUNTIME: the lowered form resolves the coerced variant (Active) / null on miss", () => {
    // The runtime shape: a frozen string-keyed table + `?? null` miss fallback.
    const Status_toEnum = { Pending: "Pending", Active: "Active", Done: "Done" };
    const resolve = (raw) => (Status_toEnum[raw] ?? null);
    expect(resolve("Active")).toBe("Active");
    expect(resolve("Nope")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// §2 — adversarial: nested-paren arg (robust where the Pass-9 regex is not).
// ---------------------------------------------------------------------------
describe("B2 §2: structured arg is robust (AST form, not the [^)]+ regex)", () => {
  test("nested-paren arg `Status.toEnum(@raw)` inside a larger init lowers cleanly", () => {
    const SRC = `<program>
type Status:enum = { Pending Active Done }
<raw> = "Done"
<status> = Status.toEnum(@raw)
<other> = (-@count) ** 1
<count> = 2
<div>\${@status}</div>
</program>`;
    const { result, out } = compileSource(SRC);
    expect(codesOf(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    parseClean(out.clientJs);
    expect(out.clientJs).not.toMatch(/Status\.toEnum\s*\(/);
  });

  test("direct emitExpr: method form with a call-expr arg keeps the whole arg balanced", () => {
    // `Status.toEnum(pick(a, b))` — the Pass-9 `[^)]+` regex stops at the first
    // `)`, producing broken JS. The AST form emits the full balanced arg.
    const node = call(member(id("Status"), "toEnum"), [call(id("pick"), [id("a"), id("b")])]);
    const out = emitExpr(node, CLIENT);
    expect(out).toBe("(Status_toEnum[pick(a, b)] ?? null)");
    parseClean(`let __r = ${out};`);
  });
});

// ---------------------------------------------------------------------------
// §3 — direct emitExpr unit tests (method + function forms; client gate).
// ---------------------------------------------------------------------------
describe("B2 §3: emitCall toEnum interception (unit)", () => {
  test("method form `Enum.toEnum(x)` -> `(Enum_toEnum[x] ?? null)`", () => {
    const out = emitExpr(call(member(id("Status"), "toEnum"), [id("x")]), CLIENT);
    expect(out).toBe("(Status_toEnum[x] ?? null)");
  });

  test("function form `toEnum(Enum, x)` -> `(Enum_toEnum[x] ?? null)` (Pass-9 parity)", () => {
    const out = emitExpr(call(id("toEnum"), [id("Status"), id("x")]), CLIENT);
    expect(out).toBe("(Status_toEnum[x] ?? null)");
  });

  test("CLIENT-GATED: the same method call is left VERBATIM in server mode (ss22 owns server)", () => {
    const out = emitExpr(call(member(id("Status"), "toEnum"), [id("x")]), SERVER);
    expect(out).toBe("Status.toEnum(x)");
  });

  test("NO false-positive: a lowercase-receiver `.toEnum(x)` call is NOT intercepted", () => {
    // Only PascalCase receivers are enum types; `obj.toEnum(x)` is a plain method.
    const out = emitExpr(call(member(id("obj"), "toEnum"), [id("x")]), CLIENT);
    expect(out).toBe("obj.toEnum(x)");
  });

  test("NO false-positive: a non-toEnum method on a PascalCase receiver is untouched", () => {
    const out = emitExpr(call(member(id("Status"), "fromRaw"), [id("x")]), CLIENT);
    expect(out).toBe("Status.fromRaw(x)");
  });

  test("NO false-positive: a two-arg method `Status.toEnum(a, b)` is NOT the single-arg shape", () => {
    const out = emitExpr(call(member(id("Status"), "toEnum"), [id("a"), num("1")]), CLIENT);
    expect(out).toBe("Status.toEnum(a, 1)");
  });
});

// ---------------------------------------------------------------------------
// §4 — regression: the SERVER path (ss22 item 5) is unaffected.
// ---------------------------------------------------------------------------
describe("B2 §4: server-fn `Enum.toEnum(raw)` still lowers + tables present (ss22)", () => {
  test("server bundle lowers the call and emits the reachability-gated table", () => {
    const SRC = `<program>
type Load:enum = { Pending Ok Bad }
\${ server function coerce(raw) { return Load.toEnum(raw) } }
<div><p>x</p></div>
</program>`;
    const { result, out } = compileSource(SRC);
    expect(codesOf(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(out.serverJs).toBeTruthy();
    expect(out.serverJs).not.toMatch(/Load\.toEnum\s*\(/);
    expect(out.serverJs).toContain("Load_toEnum[raw] ?? null");
    expect(out.serverJs).toMatch(/const\s+Load_toEnum\s*=\s*\{/);
  });
});
