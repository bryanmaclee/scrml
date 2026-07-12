/**
 * navigate-soft-nav Wave-1b — navigate() lowering + runtime-engine presence.
 *
 * SPEC §20.1–20.3 (navigate soft/hard) + §20.8.2 (soft-nav pipeline). Wave-1b
 * wires the client soft leg:
 *
 *   - a CLIENT caller (or explicit `.Soft`) lowers `navigate(path)` to
 *     `_scrml_navigate_soft(path)` — the §20.8.2 in-place `<outlet>` swap.
 *   - a SERVER-escalated caller (or explicit `.Hard`) keeps the existing
 *     `_scrml_navigate(path)` full-document hard navigation.
 *
 * Also pins the prerequisite scope-allowlist fix: `navigate` is a first-class
 * builtin (tokenizer/ast-builder keyword, emit-expr lowering) that had been
 * omitted from `LOGIC_SCOPE_GLOBAL_ALLOWLIST`, so every `navigate(...)` call
 * fired a spurious fatal E-SCOPE-001 (the render/log/print omission class).
 */

import { describe, test, expect } from "bun:test";
import { rewriteNavigateCalls } from "../../src/codegen/rewrite.ts";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compileToClient(src, base = "nav") {
  const tmp = mkdtempSync(join(tmpdir(), "nav-w1b-"));
  const inFile = join(tmp, `${base}.scrml`);
  writeFileSync(inFile, src);
  const outDir = join(tmp, "dist");
  const result = compileScrml({ inputFiles: [inFile], outputDir: outDir });
  const clientPath = join(outDir, `${base}.client.js`);
  let clientJs = "";
  try { clientJs = readFileSync(clientPath, "utf8"); } catch { /* no client emitted */ }
  let serverJs = "";
  try { serverJs = readFileSync(join(outDir, `${base}.server.js`), "utf8"); } catch { /* no server emitted */ }
  // The external runtime file (scrml-runtime.<hash>.js) carries the tree-shaken
  // runtime; concatenate it so callers can assert the engine was INCLUDED.
  let runtimeJs = "";
  try {
    for (const f of readdirSync(outDir)) {
      if (/^scrml-runtime\..*\.js$/.test(f)) runtimeJs += readFileSync(join(outDir, f), "utf8");
    }
  } catch { /* no runtime file */ }
  return { result, clientJs, serverJs, runtimeJs };
}

function errorCodes(result) {
  return (result.errors || []).map((e) => e && e.code).filter(Boolean);
}

// ---------------------------------------------------------------------------
// §1 — prerequisite: `navigate` no longer fires a spurious E-SCOPE-001
// ---------------------------------------------------------------------------

describe("§1 — navigate scope allowlist (prerequisite)", () => {
  test("bare `navigate(\"/x\")` in a client fn does NOT fire E-SCOPE-001", () => {
    const src = `\${ function go() { navigate("/dashboard") } }\n<button onclick=go()>Go</>`;
    const { result } = compileToClient(src);
    expect(errorCodes(result)).not.toContain("E-SCOPE-001");
  });
});

// ---------------------------------------------------------------------------
// §2 — client-context lowering → _scrml_navigate_soft(path)
// ---------------------------------------------------------------------------

describe("§2 — client navigate lowers to _scrml_navigate_soft", () => {
  test("client `navigate(\"/reports\")` → `_scrml_navigate_soft(\"/reports\")`", () => {
    const src = `\${ function go() { navigate("/reports") } }\n<button onclick=go()>Go</>`;
    const { clientJs } = compileToClient(src);
    expect(clientJs).toContain('_scrml_navigate_soft("/reports")');
  });

  test("explicit `.Soft` also lowers to the soft call", () => {
    const src = `\${ function go() { navigate("/y", .Soft) } }\n<button onclick=go()>Go</>`;
    const { clientJs } = compileToClient(src);
    expect(clientJs).toContain('_scrml_navigate_soft("/y")');
    // The variant is NOT forwarded as a runtime argument.
    expect(clientJs).not.toContain('_scrml_navigate_soft("/y", ".Soft")');
  });
});

// ---------------------------------------------------------------------------
// §3 — explicit `.Hard` from a client caller → hard full-document nav
// ---------------------------------------------------------------------------

describe("§3 — explicit .Hard keeps the full-document hard navigation", () => {
  test("client `navigate(\"/z\", .Hard)` → `_scrml_navigate(\"/z\")` (NOT soft)", () => {
    const src = `\${ function go() { navigate("/z", .Hard) } }\n<button onclick=go()>Go</>`;
    const { clientJs } = compileToClient(src);
    expect(clientJs).toContain('_scrml_navigate("/z")');
    expect(clientJs).not.toContain('_scrml_navigate_soft("/z")');
  });
});

// ---------------------------------------------------------------------------
// §4 — the runtime soft-nav engine is present in the emitted client runtime
// ---------------------------------------------------------------------------

describe("§4 — runtime soft-nav engine present", () => {
  test("SCRML_RUNTIME defines _scrml_navigate_soft + _scrml_rehydrate_region", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_navigate_soft(");
    expect(SCRML_RUNTIME).toContain("function _scrml_rehydrate_region(");
  });

  test("a client `navigate()` app includes the soft engine in its emitted runtime (utilities chunk NOT tree-shaken)", () => {
    const src = `<program>\n  <outlet/>\n  \${ function go() { navigate("/reports") } }\n  <button onclick=go()>Go</>\n</program>`;
    const { clientJs, runtimeJs } = compileToClient(src, "nav-app");
    // The per-file client body carries the lowered call site.
    expect(clientJs).toContain("_scrml_navigate_soft");
    // The external runtime file carries the engine definitions (the navigate()
    // call pulls in the 'utilities' chunk).
    expect(runtimeJs).toContain("function _scrml_navigate_soft(");
    expect(runtimeJs).toContain("function _scrml_rehydrate_region(");
  });

  test("SCRML_RUNTIME defines the region teardown + rebind + same-chunk surface (S239 re-review)", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_region_track(");
    expect(SCRML_RUNTIME).toContain("function _scrml_teardown_region(");
    expect(SCRML_RUNTIME).toContain("function _scrml_nav_same_chunk(");
    expect(SCRML_RUNTIME).toContain("_scrml_nav_token");
  });
});

// ---------------------------------------------------------------------------
// §5 — S239 re-review findings #5/#7 (variant parsing) + #6 (statement-shape)
// ---------------------------------------------------------------------------

describe("§5 — navigate() variant parsing (findings #5/#7)", () => {
  test("finding #5 — `navigate(.Soft)` (no path) fires E-NAV-NO-PATH and never lowers the variant as a path", () => {
    const src = `\${ function d() { navigate(.Soft) } }\n<button onclick=d()>d</button>`;
    const { result, clientJs } = compileToClient(src, "nav-nopath");
    expect(errorCodes(result)).toContain("E-NAV-NO-PATH");
    // The bare `.Soft` must NOT be emitted as the path.
    expect(clientJs).not.toContain('_scrml_navigate_soft(".Soft")');
    expect(clientJs).not.toContain("_scrml_navigate_soft(.Soft)");
    expect(clientJs).not.toContain('_scrml_navigate(".Soft")');
  });

  test("finding #5 — `navigate(\"/x\", .Hard)` lowers path-only (variant not forwarded)", () => {
    const src = `\${ function b() { navigate("/x", .Hard) } }\n<button onclick=b()>b</button>`;
    const { clientJs } = compileToClient(src, "nav-hard2");
    expect(clientJs).toContain('_scrml_navigate("/x")');
    expect(clientJs).not.toContain('.Hard');
  });

  test("finding #7 — explicit `.Soft` in a SERVER function does the server (hard) behavior, not `_scrml_navigate_soft`", () => {
    const src =
      `<program db="./x.db">\n` +
      `  <outlet/>\n` +
      `  \${ server function go() {\n` +
      `    let r = ?{\`SELECT 1 as n\`}.get()\n` +
      `    navigate("/x", .Soft)\n` +
      `  } }\n` +
      `  \${ go() }\n` +
      `</program>`;
    const { serverJs } = compileToClient(src, "nav-srvsoft");
    expect(serverJs).toContain('_scrml_navigate("/x")');
    expect(serverJs).not.toContain("_scrml_navigate_soft");
  });
});

describe("§5b — client navigate string-lowering bounds each call (S239 re-review #1)", () => {
  test("TWO navigate calls in one expression each lower to the correct mode (no cross-contamination)", () => {
    // The SEVERE mode-inversion bug: a `.Hard` modifier regex spanning an
    // intervening plain navigate() flipped BOTH modes. Each call must be bounded.
    const out = rewriteNavigateCalls('navigate("/home") + navigate("/logout", .Hard)', true);
    expect(out).toBe('_scrml_navigate_soft("/home") + _scrml_navigate("/logout")');
    // Reversed order — same independence.
    const out2 = rewriteNavigateCalls('navigate("/logout", .Hard) + navigate("/home")', true);
    expect(out2).toBe('_scrml_navigate("/logout") + _scrml_navigate_soft("/home")');
  });

  test("a comma inside a string arg / nested call is not mistaken for the modifier delimiter", () => {
    expect(rewriteNavigateCalls('navigate(getUrl("a,b"), .Hard)', true)).toBe('_scrml_navigate(getUrl("a,b"))');
    expect(rewriteNavigateCalls('navigate(cond ? "/a" : "/b")', true)).toBe('_scrml_navigate_soft(cond ? "/a" : "/b")');
  });
});

describe("§6 — navigate() as a match-arm tail: statement-shape + soft (findings #6 + #4)", () => {
  test("a client navigate() in a match value-arm lowers to _scrml_navigate_soft (divergence #4) and stays valid JS", () => {
    const src =
      `type Dest:enum = .Home | .Away\n` +
      `<x>: Dest = .Home\n` +
      `\${ function nav() {\n` +
      `  match @x {\n` +
      `    .Home :> navigate("/home")\n` +
      `    .Away :> navigate("/away")\n` +
      `  }\n` +
      `} }\n` +
      `<button onclick=nav()>go</button>`;
    const { result, clientJs } = compileToClient(src, "nav-matcharm");
    // #6 — the isStatementShapeStmt whitelist recognizes `_scrml_navigate_soft(`
    // so the arm tail is not value-wrapped into malformed JS.
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    // #4 — the client string-rewrite path (match value-arm) now SOFT-navs
    // (matches the structured emit-expr lowering), not a hard full reload.
    expect(clientJs).toContain("_scrml_navigate_soft(");
    expect(clientJs).not.toMatch(/[^_]_scrml_navigate\(\s*"\/home"/);
    // The emitted client body must be syntactically valid.
    expect(() => new Function(clientJs.replace(/^\/\/ Requires:.*$/m, ""))).not.toThrow();
  });
});
