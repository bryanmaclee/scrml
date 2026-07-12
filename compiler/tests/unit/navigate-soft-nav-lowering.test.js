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
  // The external runtime file (scrml-runtime.<hash>.js) carries the tree-shaken
  // runtime; concatenate it so callers can assert the engine was INCLUDED.
  let runtimeJs = "";
  try {
    for (const f of readdirSync(outDir)) {
      if (/^scrml-runtime\..*\.js$/.test(f)) runtimeJs += readFileSync(join(outDir, f), "utf8");
    }
  } catch { /* no runtime file */ }
  return { result, clientJs, runtimeJs };
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
});
