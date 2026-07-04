// ---------------------------------------------------------------------------
// <endpoint> multi-statement bare-body arm → E-ENDPOINT-MULTI-STATEMENT-ARM
// (W4 codegen, g-endpoint-multi-statement-arm-diagnostic-2026-06-26)
// ---------------------------------------------------------------------------
//
// SPEC §61.2 / §61.10. An `<endpoint>` arm body is a SINGLE value-expression the
// compiler envelopes as the JSON response (§61.5). A multi-statement bare body
// (`<Variant>…two or more statements…</>`) is NOT yet lowered — a future-wave gap
// (§61.10). BEFORE this fix the malformed `await (<expr>)` tripped the generic
// `E-CODEGEN-INVALID-LOGIC` emit gate (a cryptic "compiler defect" message the
// adopter cannot act on); W4 now detects the multi-statement case at codegen
// (`emitEndpointArmEnvelope`, via `isSingleJsExpression` reusing the §2.2.1 emit
// gate's acorn) and fires the clean, adopter-actionable named diagnostic
// `E-ENDPOINT-MULTI-STATEMENT-ARM` at the arm, naming the variant + the
// workaround.
//
// The THREE SUPPORTED forms MUST stay green (byte-identical codegen, no new
// diagnostic): the `:`-shorthand single-expression arm, the single-expression
// bare body (`<Variant>expr</>`), and the self-closing no-op arm (→ 204). A
// single value-expression that legitimately spans multiple source lines is still
// ONE expression and is unaffected.
//
// Diagnostic-stream partition: E-ENDPOINT-MULTI-STATEMENT-ARM is an Error →
// result.errors, NEVER result.warnings (the W-/I- partition).

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "endpoint-multistmt-"));

function compile(src) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function errCodes(r) {
  return (r.errors ?? []).map((e) => e.code ?? "");
}
function warnCodes(r) {
  return (r.warnings ?? []).map((w) => w.code ?? "");
}
function multiStmtErr(r) {
  return (r.errors ?? []).find((e) => (e.code ?? "") === "E-ENDPOINT-MULTI-STATEMENT-ARM");
}

const ENUM =
  `type FspMethod:enum = {\n` +
  `  FleetStatus\n` +
  `  Dispatch(prompt: string, project: string)\n` +
  `  DeltaSince(seq: int)\n` +
  `}\n`;
const FS = `  <FleetStatus : { jsonrpc: "2.0", result: { active: 3 } }>\n`;
const DI = `  <Dispatch(prompt, project) : { jsonrpc: "2.0", result: { accepted: true } }>\n`;

// Wrap a set of arms in a complete, W2/W3-clean <program>/<endpoint>.
function ep(arms) {
  return (
    `<program>\n` +
    ENUM +
    `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
    arms +
    `</endpoint>\n` +
    `</program>\n`
  );
}

// ===========================================================================
describe("<endpoint> multi-statement bare-body arm (§61.10)", () => {
  // The canonical reproducer: a bare body with TWO statements (a bare value
  // expression `seq`, then the JSON-RPC result object).
  const MULTI =
    FS + DI +
    `  <DeltaSince(seq)>\n` +
    `    seq\n` +
    `    { jsonrpc: "2.0", result: { since: seq, count: 0 } }\n` +
    `  </>\n`;

  test("fires E-ENDPOINT-MULTI-STATEMENT-ARM (NOT the generic E-CODEGEN-INVALID-LOGIC)", () => {
    const r = compile(ep(MULTI));
    expect(errCodes(r)).toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    // The whole point: the clean named diagnostic REPLACES the cryptic gate.
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("the diagnostic names the offending variant + the workaround", () => {
    const e = multiStmtErr(compile(ep(MULTI)));
    expect(e).toBeTruthy();
    expect(e.message).toContain("<DeltaSince> arm");
    expect(e.message).toContain("multi-statement body");
    expect(e.message).toContain("future wave");
    // Names the workaround (extract to a server fn, call via :-shorthand).
    expect(e.message).toContain("computeResult(...)");
  });

  test("partitions into result.errors (Error), NEVER result.warnings", () => {
    const r = compile(ep(MULTI));
    expect(warnCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    const e = multiStmtErr(r);
    expect(e.severity).toBe("error");
  });

  // ---- the THREE supported forms MUST stay green -------------------------

  test("supported: `:`-shorthand single-expression arms do NOT fire", () => {
    const r = compile(ep(FS + DI + `  <DeltaSince(seq) : { jsonrpc: "2.0", result: { since: seq } }>\n`));
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    expect(errCodes(r).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  test("supported: single-expression BARE body does NOT fire", () => {
    const r = compile(
      ep(FS + DI + `  <DeltaSince(seq)>\n    { jsonrpc: "2.0", result: { since: seq, count: 0 } }\n  </>\n`),
    );
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    expect(errCodes(r).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  test("supported: self-closing no-op arm (→ 204) does NOT fire", () => {
    const r = compile(ep(FS + DI + `  <DeltaSince/>\n`));
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    expect(errCodes(r).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  // ---- adversarial edges --------------------------------------------------

  test("edge (a): a `;` inside a string / object literal is NOT a false-positive", () => {
    // The `;` lives inside a string AND the object spans the body — still ONE
    // expression. Must NOT trip the statement detector.
    const r = compile(
      ep(FS + DI + `  <DeltaSince(seq) : { jsonrpc: "2.0", note: "a;b;c", result: { since: seq } }>\n`),
    );
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
  });

  test("edge (b): a single call expression spanning multiple lines is NOT a false-positive", () => {
    const r = compile(
      ep(
        FS + DI +
        `  <DeltaSince(seq)>\n` +
        `    deltaWindow(\n` +
        `      seq,\n` +
        `      0\n` +
        `    )\n` +
        `  </>\n`,
      ),
    );
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
  });

  test("edge (d): the wildcard <_> arm with a multi-statement body fires identically", () => {
    const r = compile(
      `<program>\n` + ENUM +
      `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
      FS + DI +
      `  <_>\n    seq\n    { jsonrpc: "2.0", result: {} }\n  </>\n` +
      `</endpoint>\n</program>\n`,
    );
    const e = multiStmtErr(r);
    expect(e).toBeTruthy();
    expect(e.message).toContain("<_> arm");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // ---- @-led multi-statement bare body (g-endpoint-at-led-arm-trailing-expr-dropped, ss49)
  //
  // An @-led bare body (`@x = …` / `@x` followed by the intended return value)
  // previously ESCAPED this guard: rewriteServerExpr's AST path consumed only the
  // first expression and SILENTLY DROPPED the trailing value-expr, so the lowered
  // expr parsed as a single expression and no diagnostic fired — the arm's
  // response value was lost (silent-wrong). The fix preserves the multi-statement
  // shape so an @-led multi-statement body fires E-ENDPOINT-MULTI-STATEMENT-ARM
  // identically to the non-@ case (multi-statement lowering stays a §61.10
  // future-wave gap — the §60.7 LIMIT-PRIMITIVES boundary). ------------------

  test("@-led multi-statement bare body fires E-ENDPOINT-MULTI-STATEMENT-ARM (no silent drop)", () => {
    const r = compile(
      ep(
        FS + DI +
        `  <DeltaSince(seq)>\n` +
        `    @cursor = seq + 1\n` +
        `    { jsonrpc: "2.0", result: { since: cursor, count: 0 } }\n` +
        `  </>\n`,
      ),
    );
    expect(errCodes(r)).toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    // The whole point: the value-expr is no longer silently dropped to a clean compile.
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(multiStmtErr(r).message).toContain("<DeltaSince> arm");
  });

  test("@-led bare-ref + trailing value-expr fires E-ENDPOINT-MULTI-STATEMENT-ARM", () => {
    const r = compile(
      ep(
        FS + DI +
        `  <DeltaSince(seq)>\n` +
        `    @seq\n` +
        `    { jsonrpc: "2.0", result: { since: seq } }\n` +
        `  </>\n`,
      ),
    );
    expect(errCodes(r)).toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("@-led multi-statement WILDCARD arm fires identically, naming <_>", () => {
    const r = compile(
      `<program>\n` + ENUM +
      `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
      FS + DI +
      `  <_>\n    @x = 1\n    { jsonrpc: "2.0", result: {} }\n  </>\n` +
      `</endpoint>\n</program>\n`,
    );
    const e = multiStmtErr(r);
    expect(e).toBeTruthy();
    expect(e.message).toContain("<_> arm");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("supported: a single-expression @-bearing bare body does NOT fire (no over-fire)", () => {
    // A LEGITIMATE single-expression arm body that reads a request-body field via
    // `@field` must remain green — the fix must not over-fire on single exprs.
    // (The @seq value lowering to _scrml_body["seq"] in the envelope is asserted
    // by the R26 CLI repro in the dispatch evidence.)
    const r = compile(
      ep(FS + DI + `  <DeltaSince(seq)>\n    { jsonrpc: "2.0", result: { since: @seq, count: 0 } }\n  </>\n`),
    );
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    expect(errCodes(r).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  // ---- regression / no-op proof on the canonical example -----------------

  test("example 33 (all single-expression arms) fires no endpoint codegen diagnostic", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "..", "examples", "33-endpoint.scrml"),
      "utf8",
    );
    const r = compile(src);
    expect(errCodes(r)).not.toContain("E-ENDPOINT-MULTI-STATEMENT-ARM");
    expect(errCodes(r).filter((c) => c.startsWith("E-"))).toEqual([]);
  });
});
