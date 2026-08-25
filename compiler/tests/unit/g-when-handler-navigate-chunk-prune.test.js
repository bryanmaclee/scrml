/**
 * g-when-handler-navigate-chunk-prune (S372)
 *
 * A `navigate(...)` call inside a `when …` handler body pruned the `utilities`
 * runtime chunk, so the emitted `_scrml_navigate_soft(` reference threw
 * `ReferenceError` on first dependency change.
 *
 * ROOT (re-derived, reproduce-first — the filed gap's stated locus was WRONG):
 * the runtime-chunk gate is `detectRuntimeChunks` (codegen/emit-client.ts), NOT
 * the `usage-analyzer.ts` FeatureUsage bitmap (that bitmap is DEAD — its output
 * is never read to gate emission). `detectRuntimeChunks` lights the `utilities`
 * chunk for `navigate()` only via its `case "bare-expr"` ExprNode probe. A
 * `when @dep changes { … }` / `when message from <#w> { … }` handler body is NOT
 * stored as walkable child `bare-expr` nodes — it lives as `bodyRaw` (string) +
 * `bodyExpr` (STATEMENT 1's ExprNode only). So a `navigate()` ANYWHERE in a
 * when-handler body (single-statement OR stmts 2+) is invisible to the pre-emit
 * walk → `utilities` is tree-shaken → the emitted `_scrml_navigate_soft(`
 * reference is undefined at runtime. Unlike `reset`/`equality`/`messages`/
 * `ifmount`, `utilities` had no post-emit helper-reference backstop and is not a
 * scope dependency, so nothing caught it. This reproduces with a SINGLE
 * statement — it is NOT multi-statement-specific; #693/#695 (which made when-
 * handler stmts 2+ actually EMIT) only newly EXPOSED it for stmts 2+, it did not
 * introduce it.
 *
 * FIX: extend the GITI-036 POST_EMIT_HELPER_CHUNK_GATES (emit-client.ts) — the
 * ground-truth, AST-shape-immune scan — with `_scrml_navigate_soft(` /
 * `_scrml_navigate(` → `utilities`. Reference-gated: a navigate-free page emits
 * neither token and still tree-shakes `utilities` out (no over-inclusion).
 *
 * These tests are BITING: pre-fix, `_scrml_navigate_soft` is REFERENCED in the
 * client but ABSENT (pruned) from the assembled runtime bundle.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

const tmpDirs = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function freshDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// Compile `src` and return { clientJs, runtimeJs, errors }.
function compile(src) {
  const inDir = freshDir("scrml-navchunk-in-");
  const outDir = freshDir("scrml-navchunk-out-");
  const input = join(inDir, "app.scrml");
  writeFileSync(input, src);
  const result = compileScrml({ inputFiles: [input], outputDir: outDir, write: true, log: () => {} });
  const clientJs = readFileSync(join(outDir, "app.client.js"), "utf-8");
  const rtName = readdirSync(outDir).find((n) => n.startsWith("scrml-runtime.") && n.endsWith(".js"));
  const runtimeJs = rtName ? readFileSync(join(outDir, rtName), "utf-8") : "";
  return { clientJs, runtimeJs, errors: result.errors ?? [] };
}

const WORKER = `<program name="w">\${ when message(d) { send(d) } }</program>`;

// The `utilities` chunk is included iff its `_scrml_navigate_soft` definition is
// in the assembled runtime bundle. Pre-fix this definition is pruned.
function runtimeDefinesNavigateSoft(runtimeJs) {
  return /function\s+_scrml_navigate_soft\b/.test(runtimeJs);
}

describe("g-when-handler-navigate-chunk-prune (utilities chunk / §20.8 navigate)", () => {
  test("§1 SINGLE-statement `when @dep changes { navigate() }` keeps the utilities chunk", () => {
    // BITING + proves the bug is NOT multi-statement-specific.
    const src =
      `<program>\n  \${\n    <count> = 0\n` +
      `    when @count changes {\n      navigate("/done")\n    }\n  }\n` +
      `  <button onclick=inc()>inc</button>\n  <p>\${@count}</p>\n</program>\n`;
    const { clientJs, runtimeJs, errors } = compile(src);
    expect(errors.filter((e) => e.severity === "error" || e.code?.startsWith("E-"))).toHaveLength(0);
    // The client emits the soft-nav reference...
    expect(clientJs).toContain("_scrml_navigate_soft(");
    // ...so the runtime MUST define it (pre-fix: pruned → ReferenceError).
    expect(runtimeDefinesNavigateSoft(runtimeJs)).toBe(true);
  });

  test("§2 MULTI-statement `when @dep changes` with navigate in STMT 2 keeps utilities", () => {
    // The #693/#695-exposed shape: stmt 1 benign, stmt 2 is the navigate.
    const src =
      `<program>\n  \${\n    <count> = 0\n    <a> = 0\n` +
      `    when @count changes {\n      @a = @count\n      navigate("/done")\n    }\n  }\n` +
      `  <button onclick=inc()>inc</button>\n  <p>\${@a}</p>\n</program>\n`;
    const { clientJs, runtimeJs, errors } = compile(src);
    expect(errors.filter((e) => e.severity === "error" || e.code?.startsWith("E-"))).toHaveLength(0);
    expect(clientJs).toContain("_scrml_navigate_soft(");
    expect(runtimeDefinesNavigateSoft(runtimeJs)).toBe(true);
  });

  test("§3 `when message from <#w>` handler with navigate keeps utilities", () => {
    // The parent-side worker-message handler (when-worker-message) — same body
    // shape (bodyRaw), same blind spot.
    const src =
      `<program>\n  ${WORKER}\n` +
      `  \${\n    <a> = 0\n` +
      `    when message from <#w> (m) {\n      @a = m\n      navigate("/done")\n    }\n  }\n` +
      `  <p>\${@a}</p>\n</program>\n`;
    const { clientJs, runtimeJs, errors } = compile(src);
    expect(errors.filter((e) => e.severity === "error" || e.code?.startsWith("E-"))).toHaveLength(0);
    expect(clientJs).toContain("_scrml_navigate_soft(");
    expect(runtimeDefinesNavigateSoft(runtimeJs)).toBe(true);
  });

  test("§4 NEGATIVE (no over-inclusion): a navigate-free when-handler prunes utilities", () => {
    // The fix widens detection to the emitted body, but must NOT spuriously pull
    // the chunk for a handler that emits no navigate reference.
    const src =
      `<program>\n  \${\n    <count> = 0\n    <a> = 0\n` +
      `    when @count changes {\n      @a = @count\n      @a = @a + 1\n    }\n  }\n` +
      `  <button onclick=inc()>inc</button>\n  <p>\${@a}</p>\n</program>\n`;
    const { clientJs, runtimeJs, errors } = compile(src);
    expect(errors.filter((e) => e.severity === "error" || e.code?.startsWith("E-"))).toHaveLength(0);
    // No navigate emitted...
    expect(clientJs).not.toContain("_scrml_navigate");
    // ...so the utilities chunk stays tree-shaken out.
    expect(runtimeDefinesNavigateSoft(runtimeJs)).toBe(false);
  });
});
