/**
 * division-in-ternary-arm tests — g-division-in-ternary-arm (S188)
 *
 * A `/` division inside EITHER arm of a ternary — `@e > 0 ? @h / @e : @h` —
 * emitted invalid JS (E-CODEGEN-INVALID-LOGIC, "compiler defect"). The divide-with-
 * guard idiom `cond ? a/b : fallback` (guard divide-by-zero) broke everywhere it
 * was idiomatically written.
 *
 * ROOT (Phase-0 diagnosed; the brief's `/`-as-regex / code-segments.ts hypothesis
 * was WRONG): the truncation was in `collectExpr()` (ast-builder.js, inside
 * parseLogicBody), NOT the tokenizer / regex-fence / ExprNode parser. The S25
 * typed-reactive boundary break treats a depth-0 `@ident :` as the start of a
 * typed reactive state-decl (`@name: Type`). A ternary consequent CAN be a bare
 * `@cell` (`cond ? @cell : alt`), so the depth-0 `@cell :` there is the ternary
 * value-arm separator — NOT a typed-decl start. Mis-firing the break truncated
 * the raw `init` at the consequent (`@e > 0 ? @h /`, with the `@e : @h` dropped),
 * `safeParseExprToNode` then fell back to an `escape-hatch`, and codegen emitted
 * the raw truncated string.
 *
 * The `/` was a RED HERRING — `@e > 0 ? @h : @z` (no `/` at all) truncated
 * identically; `@e > 0 ? 1 / 2 : 3` (`/` present, NON-`@` arms) was always clean.
 * The actual trigger is an `@cell` immediately before a ternary value-arm `:`.
 *
 * FIX: track `ternaryDepth` in collectExpr (depth-0 `?` opens, matching `:`
 * closes) and guard the typed-reactive break with `ternaryDepth === 0`.
 *
 * @see compiler/src/ast-builder.js — collectExpr ternaryDepth tracking
 * @see docs/known-gaps.md — g-division-in-ternary-arm
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as acornParse } from "acorn";

// ---------------------------------------------------------------------------
// AST-level helpers — assert collectExpr no longer truncates the raw init
// ---------------------------------------------------------------------------

function declsInLogic(body) {
  const source = `\${\n${body}\n}`;
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  const found = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (
      n.kind === "const-decl" ||
      n.kind === "let-decl" ||
      (n.kind === "state-decl" && (n.shape === "derived" || n.shape === "plain"))
    ) {
      found.push(n);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(ast);
  return found;
}

// ---------------------------------------------------------------------------
// Full-compile helpers — assert emitted client JS is valid + correct division
// ---------------------------------------------------------------------------

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "div-ternary-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  const res = compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  return { res, fp };
}

// Returns null when `src` is valid JS, an Error message when it does not parse.
function parseModule(src) {
  try {
    acornParse(src, { ecmaVersion: 2024, sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    return null;
  } catch (e) {
    return e.message;
  }
}

function errCodes(res) {
  return (res.errors || []).map((e) => e.code);
}

// ---------------------------------------------------------------------------
// AST-level — the raw `init` must be the FULL ternary, never truncated
// ---------------------------------------------------------------------------

describe("collectExpr — ternary arm no longer truncates at `@cell :`", () => {
  test("`/` in CONSEQUENT arm — full ternary collected, initExpr is ternary", () => {
    const decls = declsInLogic(`const x = @e > 0 ? @h / @e : @h`);
    expect(decls).toHaveLength(1);
    expect(decls[0].init).toBe("@e > 0 ? @h / @e : @h");
    expect(decls[0].initExpr.kind).toBe("ternary");
  });

  test("`/` in ALTERNATIVE arm — full ternary collected, initExpr is ternary", () => {
    const decls = declsInLogic(`const x = @e == 0 ? @h : @h / @e`);
    expect(decls).toHaveLength(1);
    expect(decls[0].init).toBe("@e == 0 ? @h : @h / @e");
    expect(decls[0].initExpr.kind).toBe("ternary");
  });

  test("Shape-3 derived `const <ratio>` with `/` consequent — full ternary", () => {
    const decls = declsInLogic(`const <ratio> = @e > 0 ? @h / @e : @h`);
    const derived = decls.find((d) => d.name === "ratio");
    expect(derived).toBeDefined();
    expect(derived.init).toBe("@e > 0 ? @h / @e : @h");
    expect(derived.initExpr.kind).toBe("ternary");
  });

  test("RED HERRING control — `@cell` before `:` truncates even WITHOUT a `/`", () => {
    // Pre-fix this truncated at `?`; the `/` was never the trigger.
    const decls = declsInLogic(`const x = @e > 0 ? @h : @z`);
    expect(decls).toHaveLength(1);
    expect(decls[0].init).toBe("@e > 0 ? @h : @z");
    expect(decls[0].initExpr.kind).toBe("ternary");
  });

  test("nested ternary with `@cell` arms — both `:` separators handled", () => {
    const decls = declsInLogic(`const x = @a > 0 ? @b : @c > 0 ? @d : @e`);
    expect(decls).toHaveLength(1);
    expect(decls[0].init).toBe("@a > 0 ? @b : @c > 0 ? @d : @e");
    expect(decls[0].initExpr.kind).toBe("ternary");
  });
});

// ---------------------------------------------------------------------------
// AST-level — the S25 typed-reactive boundary MUST still fire (regression guard)
// ---------------------------------------------------------------------------

describe("collectExpr — S25 typed-reactive boundary still splits (no regression)", () => {
  test("`@x = 1` then `@y: number = 2` splits into two decls", () => {
    const decls = declsInLogic(`@x = 1\n@y: number = 2`);
    expect(decls).toHaveLength(2);
    expect(decls[0].name).toBe("x");
    expect(decls[0].init).toBe("1");
    expect(decls[1].name).toBe("y");
    expect(decls[1].typeAnnotation).toBe("number");
  });

  test("ternary decl FOLLOWED by a typed-reactive decl — both parse", () => {
    const decls = declsInLogic(`const r = @e > 0 ? @h : @z\n@y: number = 5`);
    expect(decls).toHaveLength(2);
    const r = decls.find((d) => d.name === "r");
    const y = decls.find((d) => d.name === "y");
    expect(r.init).toBe("@e > 0 ? @h : @z");
    expect(y.typeAnnotation).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Full compile — emitted client JS must be valid + emit correct division
// ---------------------------------------------------------------------------

const HEAD = `<program>\n  \${\n    @h = 10\n    @e = 2\n    @a = 5\n`;
const FOOT = `  }\n  <p>\${@h}</p>\n</program>`;

describe("full compile — division in a ternary arm emits valid division JS", () => {
  test("derived cell, `/` in CONSEQUENT — 0 errors, valid client JS, division present", () => {
    const { res, fp } = compile(`${HEAD}    const <ratio> = @e > 0 ? @h / @e : @h\n${FOOT}`);
    expect(errCodes(res)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect((res.errors || []).length).toBe(0);
    const clientJs = res.outputs.get(fp).clientJs ?? "";
    expect(parseModule(clientJs)).toBeNull();
    expect(clientJs).toContain(`_scrml_reactive_get("h") / _scrml_reactive_get("e")`);
  });

  test("derived cell, `/` in ALTERNATIVE — 0 errors, valid client JS, division present", () => {
    const { res, fp } = compile(`${HEAD}    const <ratio> = @e == 0 ? @h : @h / @e\n${FOOT}`);
    expect(errCodes(res)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect((res.errors || []).length).toBe(0);
    const clientJs = res.outputs.get(fp).clientJs ?? "";
    expect(parseModule(clientJs)).toBeNull();
    expect(clientJs).toContain(`_scrml_reactive_get("h") / _scrml_reactive_get("e")`);
  });

  test("logic-const (plain `const`), `/` in consequent — valid client JS", () => {
    const { res, fp } = compile(`${HEAD}    const ratio = @e > 0 ? @h / @e : @h\n${FOOT}`);
    expect(errCodes(res)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect((res.errors || []).length).toBe(0);
    expect(parseModule(res.outputs.get(fp).clientJs ?? "")).toBeNull();
  });

  test("markup interpolation `${ ... }`, `/` in consequent — valid client JS, division present", () => {
    const { res, fp } = compile(`<program>\n  \${\n    @h = 10\n    @e = 2\n  }\n  <p>\${@e > 0 ? @h / @e : @h}</p>\n</program>`);
    expect(errCodes(res)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect((res.errors || []).length).toBe(0);
    const clientJs = res.outputs.get(fp).clientJs ?? "";
    expect(parseModule(clientJs)).toBeNull();
    expect(clientJs).toContain(`_scrml_reactive_get("h") / _scrml_reactive_get("e")`);
  });
});

// ---------------------------------------------------------------------------
// Full compile — CLEAN cases must STAY clean (no regression)
// ---------------------------------------------------------------------------

describe("full compile — clean cases stay clean", () => {
  test("standalone `@h / @e` (no ternary) — valid client JS, division present", () => {
    const { res, fp } = compile(`${HEAD}    const ratio = @h / @e\n${FOOT}`);
    expect((res.errors || []).length).toBe(0);
    const clientJs = res.outputs.get(fp).clientJs ?? "";
    expect(parseModule(clientJs)).toBeNull();
    expect(clientJs).toContain(`_scrml_reactive_get("h") / _scrml_reactive_get("e")`);
  });

  test("ternary with literal arms `@e > 0 ? 1 : 2` — valid client JS", () => {
    const { res, fp } = compile(`${HEAD}    const r = @e > 0 ? 1 : 2\n${FOOT}`);
    expect((res.errors || []).length).toBe(0);
    expect(parseModule(res.outputs.get(fp).clientJs ?? "")).toBeNull();
  });

  test("ternary with `*` in an arm `@a > 0 ? @a * 2 : @a` — valid client JS", () => {
    const { res, fp } = compile(`${HEAD}    const r = @a > 0 ? @a * 2 : @a\n${FOOT}`);
    expect((res.errors || []).length).toBe(0);
    expect(parseModule(res.outputs.get(fp).clientJs ?? "")).toBeNull();
  });

  test("regex `/not found/i` in a `.filter` (GITI-017) — survives verbatim, NOT corrupted", () => {
    const { res, fp } = compile(`<program>\n  \${\n    @names = ["x"]\n    const hits = @names.filter(n => /not found/i.test(n))\n  }\n  <p>\${hits}</p>\n</program>`);
    expect(errCodes(res)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect((res.errors || []).length).toBe(0);
    const clientJs = res.outputs.get(fp).clientJs ?? "";
    expect(parseModule(clientJs)).toBeNull();
    // The regex body must appear verbatim — the fix must not regress the
    // `/`-vs-regex disambiguation.
    expect(clientJs).toContain("/not found/i.test");
  });
});
