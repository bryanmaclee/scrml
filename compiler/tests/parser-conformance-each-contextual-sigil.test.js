// parser-conformance-each-contextual-sigil.test.js — #2f unit C.
//
// The native lexer PREVIOUSLY recognized `@` only when followed by an
// ident-start char (`@count`, `@user`). For the §each contextual sigil `@.`
// the next char is `.` (NOT ident-start), so the `@ident` branch failed and the
// bare `@` fell to the lexer's "Unknown — skip" fallback and was SILENTLY
// DISCARDED; the trailing `.name` was then independently lexed as a BareVariant.
// Net: `${@.name}` produced exprNode `ident{name:".name"}` (the `@` gone) and
// `${@.}` produced a malformed member — so a `<each>` per-item body using `@.`
// mis-compiled (E-CODEGEN-INVALID-JS) under `--parser=scrml-native`.
//
// The fix adds a dedicated `@`-followed-by-`.` lexer branch that consumes `@.`
// PLUS the optional dotted-ident chain as ONE `ScrmlAt` token whose `name`
// carries everything after the `@` (".name" / "." / ".foo.bar"). The existing
// `parsePrimary` ScrmlAt arm -> `makeAtCell(name)`; the `translate-expr` AtCell
// arm prepends `@` -> `ident{name:"@.name"}`. That string round-trips through
// `emitStringFromTree` and `rewriteContextualSigil` (emit-each.ts) to the
// iter-var-resolved member access — REUSING all existing codegen.
//
// Assertion layers:
//   (1) LEXER  — `@.name` / `@.` / `@.foo.bar` lex to a SINGLE ScrmlAt token
//                whose `name` is the `.`-prefixed chain.
//   (2) BRIDGE — parse + translate yields the faithful `ident{name:"@.name"}`.
//   (3) REGRESSION GUARD — `.Idle` / `.Loading` (uppercase, NO `@`) STILL lex
//                to BareVariant, untouched. The fix keys off the preceding `@`,
//                NOT letter-case.
//   (4) PARITY — full compile of `@.`-bearing each shapes under both parsers is
//                byte-identical (mod local-id offsets).

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";

import { lex as scrmlNativeLex } from "../native-parser/lex.js";
import { parseExpr as scrmlNativeParseExpr } from "../native-parser/parse-expr.js";
import { translateExpr } from "../native-parser/translate-expr.js";
import { TokenKind } from "../native-parser/token.js";
import { compileScrml } from "../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Lex `source` and return only the non-EOF tokens.
function lexTokens(source) {
  return scrmlNativeLex(source).filter((t) => t.kind !== TokenKind.EOF);
}

// Parse a single expression source -> live ExprNode (native parse + translate).
function liveExprNode(source) {
  const { ast } = scrmlNativeParseExpr(scrmlNativeLex(source));
  return translateExpr(ast);
}

// Compile `source` to client.js under `parser` (null = default live BS+TAB;
// "scrml-native" = native pipeline).
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-sigil-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Normalize local-id numeric suffixes (`_4`, `_tn_6`, …) so the only remaining
// difference between native + default output is id ordering.
const normIds = (s) => s.replace(/_\d+\b/g, "_N");

// ===========================================================================
// §1 — LEXER: `@.` contextual sigil lexes to a single ScrmlAt token.
// ===========================================================================

describe("each-contextual-sigil §1 — lexer recognizes `@.`", () => {
  test("`@.name` -> ONE ScrmlAt token (name carries the `.`-prefixed chain)", () => {
    const toks = lexTokens("@.name");
    expect(toks).toHaveLength(1);
    expect(toks[0].kind).toBe(TokenKind.ScrmlAt);
    expect(toks[0].name).toBe(".name");
    expect(toks[0].text).toBe("@.name");
  });

  test("bare `@.` (count-form) -> ONE ScrmlAt token with name `.`", () => {
    const toks = lexTokens("@.");
    expect(toks).toHaveLength(1);
    expect(toks[0].kind).toBe(TokenKind.ScrmlAt);
    expect(toks[0].name).toBe(".");
    expect(toks[0].text).toBe("@.");
  });

  test("`@.foo.bar` chained -> ONE ScrmlAt token with full dotted chain", () => {
    const toks = lexTokens("@.foo.bar");
    expect(toks).toHaveLength(1);
    expect(toks[0].kind).toBe(TokenKind.ScrmlAt);
    expect(toks[0].name).toBe(".foo.bar");
    expect(toks[0].text).toBe("@.foo.bar");
  });

  test("`@.` does NOT over-consume a trailing non-ident-chained `.`", () => {
    // `@.a.0` — the chain stops at `.a` because `0` is not ident-start; the
    // `.0` re-lexes independently. The ScrmlAt covers only `@.a`.
    const toks = lexTokens("@.a.0");
    expect(toks[0].kind).toBe(TokenKind.ScrmlAt);
    expect(toks[0].name).toBe(".a");
    expect(toks[0].text).toBe("@.a");
  });
});

// ===========================================================================
// §2 — BRIDGE: parse + translate yields the faithful ident{name:"@.name"}.
// ===========================================================================

describe("each-contextual-sigil §2 — native->live bridge produces @-prefixed ident", () => {
  test("`@.name` -> ident{name:'@.name'}", () => {
    const node = liveExprNode("@.name");
    expect(node.kind).toBe("ident");
    expect(node.name).toBe("@.name");
  });

  test("bare `@.` -> ident{name:'@.'}", () => {
    const node = liveExprNode("@.");
    expect(node.kind).toBe("ident");
    expect(node.name).toBe("@.");
  });

  test("`@.foo.bar` -> ident{name:'@.foo.bar'}", () => {
    const node = liveExprNode("@.foo.bar");
    expect(node.kind).toBe("ident");
    expect(node.name).toBe("@.foo.bar");
  });

  test("plain `@count` reactive ref is UNCHANGED -> ident{name:'@count'}", () => {
    const node = liveExprNode("@count");
    expect(node.kind).toBe("ident");
    expect(node.name).toBe("@count");
  });
});

// ===========================================================================
// §3 — REGRESSION GUARD: a real uppercase bare-variant (NO `@`) is untouched.
// ===========================================================================

describe("each-contextual-sigil §3 — bare-variant regression guard (no `@`)", () => {
  test("`.Idle` (no `@`) STILL lexes to BareVariant", () => {
    const toks = lexTokens(".Idle");
    expect(toks).toHaveLength(1);
    expect(toks[0].kind).toBe(TokenKind.BareVariant);
    expect(toks[0].name).toBe("Idle");
  });

  test("`.Loading` (no `@`) STILL lexes to BareVariant", () => {
    const toks = lexTokens(".Loading");
    expect(toks).toHaveLength(1);
    expect(toks[0].kind).toBe(TokenKind.BareVariant);
    expect(toks[0].name).toBe("Loading");
  });

  test("`x is .Idle` bare-variant comparison -> binary is + ident{name:'.Idle'}", () => {
    const node = liveExprNode("x is .Idle");
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is");
    expect(node.right.kind).toBe("ident");
    expect(node.right.name).toBe(".Idle");
  });
});

// ===========================================================================
// §4 — PARITY: full compile of `@.`-bearing each shapes is native==default.
// ===========================================================================

describe("each-contextual-sigil §4 — native==default compile parity", () => {
  test("`<li>${@.name}</li>` per-item resolves to iter-var.name (native==default)", () => {
    const src = `<program>
<items> = [{ name: "Ann" }, { name: "Bob" }]
<ul>
<each in=@items>
<li>${"$"}{@.name}</li>
</each>
</ul>
</program>`;
    const native = compileWith(src, "scrml-native", "sigil-name-nat");
    const def = compileWith(src, null, "sigil-name-def");
    expect(native.errors).toHaveLength(0);
    expect(def.errors).toHaveLength(0);
    expect(native.clientJs).toContain("_scrml_each_item.name");
    expect(def.clientJs).toContain("_scrml_each_item.name");
    expect(normIds(native.clientJs)).toBe(normIds(def.clientJs));
  });

  test("`<li>Item ${@.}</li>` count-form resolves to the bare iter var (native==default)", () => {
    const src = `<program>
<ul>
<each of=3>
<li>Item ${"$"}{@.}</li>
</each>
</ul>
</program>`;
    const native = compileWith(src, "scrml-native", "sigil-bare-nat");
    const def = compileWith(src, null, "sigil-bare-def");
    expect(native.errors).toHaveLength(0);
    expect(def.errors).toHaveLength(0);
    expect(normIds(native.clientJs)).toBe(normIds(def.clientJs));
  });

  test("`<li>${@.foo.bar}</li>` chained sigil resolves to iter-var.foo.bar (native==default)", () => {
    const src = `<program>
<items> = [{ foo: { bar: "x" } }]
<ul>
<each in=@items>
<li>${"$"}{@.foo.bar}</li>
</each>
</ul>
</program>`;
    const native = compileWith(src, "scrml-native", "sigil-chain-nat");
    const def = compileWith(src, null, "sigil-chain-def");
    expect(native.errors).toHaveLength(0);
    expect(def.errors).toHaveLength(0);
    expect(native.clientJs).toContain("_scrml_each_item.foo.bar");
    expect(def.clientJs).toContain("_scrml_each_item.foo.bar");
    expect(normIds(native.clientJs)).toBe(normIds(def.clientJs));
  });

  test("a real bare-variant `.Idle` alongside `@.name` does NOT regress (native==default)", () => {
    const src = `<program>
type Flag:enum = { Idle, Busy }
<flag>: Flag = .Idle
<items> = [{ name: "a" }]
<ul>
<each in=@items>
<li>${"$"}{@.name}</li>
</each>
</ul>
</program>`;
    const native = compileWith(src, "scrml-native", "sigil-ctrl-nat");
    const def = compileWith(src, null, "sigil-ctrl-def");
    expect(native.errors).toHaveLength(0);
    expect(def.errors).toHaveLength(0);
    expect(native.clientJs).toContain("_scrml_each_item.name");
    expect(native.clientJs).toContain("Idle");
    expect(normIds(native.clientJs)).toBe(normIds(def.clientJs));
  });
});
