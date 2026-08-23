/**
 * v0.3.x SPA tree-shake — Phase B regression suite.
 *
 * Covers SCOPING §3.1 (shared-runtime union), §3.2 (`wire` chunk gate
 * for `_scrml_wire_decode`), and §5.3 (a) / §3.3 (content-hashed
 * runtime filename). One test file per scoping concern to keep the
 * crash-recovery story clear if any individual section breaks.
 *
 * Scoping authority:
 *   - docs/changes/v0.3.x-spa-tree-shake/SCOPING.md §3.1 / §3.2 / §3.3.
 *   - SPEC.md §57 (Wire Format dual-decoder) — `_scrml_wire_decode`
 *     trigger surface (gate predicate).
 *
 * Measurement anchors (SCOPING §1.2 / §1.3): pre-fix TodoMVC shared-
 * runtime was 38,681 B gzip; embed-mode TodoMVC was 14,104 B gzip.
 * Phase B 3.1 + 3.2 should bring shared-mode TodoMVC's runtime below
 * 16 KB gzip (the assembly is the same chunk union as embed mode).
 *
 * Coverage:
 *   §1  shared-runtime tree-shake (3.1) — assemble runtime from the
 *       union of `usedRuntimeChunks`; size below 16 KB gzip for SPA
 *       shape; absent chunks excluded from runtime content.
 *   §2  wire-decode chunk gate (3.2) — SPA-shape with zero server-fns
 *       has no `_scrml_wire_decode` in runtime; presence flips on
 *       when a server-fn is declared.
 *   §3  hash-stable filename (3.3) — same compile-unit set produces
 *       same hash (deterministic); different unit set produces
 *       different hash; per-file client.js + html reference the
 *       hashed filename consistently.
 *   §4  embed-mode regression-free path — `embedRuntime: true` still
 *       produces no shared runtime file and an embed bundle that
 *       tree-shakes the wire chunk for SPA shape.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gzipSync } from "zlib";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// SPA shape — no server-fns, no `use foreign:`, single page-less file.
// Modeled on examples/02-counter.scrml.
const SPA_COUNTER = `<count> = 0

<button onclick={ @count = @count + 1 }>
  count is \${@count}
</button>
`;

// Same shape as SPA_COUNTER but with a server-fn declared in a logic block
// — should activate the 'wire' chunk gate.
const SPA_WITH_SERVER_FN = `<count> = 0

\${
  server function loadCount() {
    return 42
  }
}

<button onclick={ @count = @count + 1 }>
  count is \${@count}
</button>
`;

// Multi-file shape — two files sharing one runtime. Used to verify
// the per-file `// Requires:` lines all carry the SAME hash.
const MULTI_A = `<a> = "hello"
<div>\${@a}</div>
`;

const MULTI_B = `<b> = "world"
<span>\${@b}</span>
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "phase-b-spa-tree-shake-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileSingle(source, opts = {}) {
  const inputDir = mkdtempSync(join(TMP, "in-"));
  const outDir = join(inputDir, "dist");
  const filePath = join(inputDir, "app.scrml");
  writeFileSync(filePath, source);
  return {
    result: compileScrml({
      inputFiles: [filePath],
      outputDir: outDir,
      write: true,
      log: () => {},
      ...opts,
    }),
    outDir,
    filePath,
  };
}

function compileMulti(sources /* { name: source } */, opts = {}) {
  const inputDir = mkdtempSync(join(TMP, "multi-"));
  const outDir = join(inputDir, "dist");
  const filePaths = [];
  for (const [name, src] of Object.entries(sources)) {
    const p = join(inputDir, `${name}.scrml`);
    writeFileSync(p, src);
    filePaths.push(p);
  }
  return {
    result: compileScrml({
      inputFiles: filePaths,
      outputDir: outDir,
      write: true,
      log: () => {},
      ...opts,
    }),
    outDir,
    filePaths,
  };
}

// ---------------------------------------------------------------------------
// §1 — shared-runtime tree-shake (SCOPING §3.1)
// ---------------------------------------------------------------------------

describe("§1 shared-runtime tree-shake (Phase B 3.1)", () => {
  test("SPA shape produces a shared runtime under 16 KB gzip", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    expect(result.errors.length).toBe(0);
    expect(result.runtimeFilename).toBeTruthy();
    const runtimeBytes = readFileSync(join(outDir, result.runtimeFilename));
    const gzip = gzipSync(runtimeBytes);
    // Pre-fix TodoMVC shared runtime was 38,681 B gzip. SPA counter
    // assembles fewer chunks; expect well under 16 KB.
    expect(gzip.length).toBeLessThan(16 * 1024);
    // ⚑ SCOPE OF THIS ASSERTION — read before citing it as "the size gate".
    // (Added BELOW the expect on purpose: this file is cited as ":145" from
    // docs/known-gaps.md, handOffs/delta-log.md and handOffs/dpa-queue.md,
    // so nothing may be inserted above it.)
    //
    // 16,384 B is an ASPIRATION for the whole client runtime, and this line
    // asserts it only for the COUNTER shape — `SPA_COUNTER` has no
    // `<program>`, no `<outlet/>`, no routes, no engine and no SSR, so it
    // never assembles the soft-nav chunk. Measured at `36ed3d05`:
    //
    //     SPA_COUNTER (this fixture)          54,773 B raw / 15,495 B gzip -9
    //     `<program>` + `<outlet/>`, 4 lines  82,744 B raw / 26,012 B gzip -9
    //
    // The shell shape is 1.59x the aspiration — 9,628 B over — and always
    // has been. This assertion is therefore NOT a gate on the shape that
    // ships, and re-pointing it at that shape would make it red from its
    // first commit for reasons no change caused. The ruling (S352) was to
    // leave this line exactly as it is and add a separate no-regression
    // RATCHET on the shell shape:
    //
    //     compiler/tests/integration/runtime-size-ratchet.test.js
    //
    // That file also pins its compressor; this one uses the zlib default,
    // which is worth ~38 B here and ~141 B on the shell. Do not compare
    // numbers across the two files without accounting for it.
    // See docs/known-gaps.md → `g-spa-runtime-gzip-budget-knife-edge`.
  });

  test("SPA shape excludes prefetch + mount + vendor-ref + wire chunks from runtime", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    // The targeted SPA-irrelevant chunks should NOT be present.
    expect(runtime).not.toContain("_scrml_prefetch_tier1");
    expect(runtime).not.toContain("_scrml_prefetch_tier2");
    expect(runtime).not.toContain("_scrml_chunk_mount");
    expect(runtime).not.toContain("_scrml_vendor_require");
    expect(runtime).not.toContain("_scrml_wire_decode");
  });

  test("SPA shape includes core + scope + errors (always-present set)", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    // 'core' chunk
    expect(runtime).toContain("_scrml_reactive_get");
    expect(runtime).toContain("_scrml_reactive_set");
    // 'scope' chunk
    expect(runtime).toContain("_scrml_register_cleanup");
    // 'errors' chunk
    expect(runtime).toContain("class _ScrmlError");
    expect(runtime).toContain("class NetworkError");
    // The 'transitions' chunk was in this always-present set until the §38
    // keyframes moved to the emitted stylesheet (codegen/emit-transition-css.ts).
    // An inline <style> is refused under `headers="strict"`'s pinned
    // `default-src 'self'` (§39.2.5); no runtime chunk may inject one again.
    expect(runtime).not.toContain("scrml-fade-in");
    expect(runtime).not.toContain('createElement("style")');
  });

  test("assembled shared runtime is syntactically valid JS", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    // The Function constructor parses the runtime as a function body.
    // Pre-Phase-B-splitter-fix this would have thrown on a bare `§`
    // token from an omitted-chunk's marker prefix.
    expect(() => new Function(runtime)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 — wire-decode chunk gate (SCOPING §3.2)
// ---------------------------------------------------------------------------

describe("§2 wire-decode chunk gate (Phase B 3.2)", () => {
  test("compile with zero server-fns has no _scrml_wire_decode in runtime", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    expect(runtime).not.toContain("function _scrml_wire_decode");
    expect(runtime).not.toContain("__scrml_absent");
  });

  test("compile with a server-fn DOES include _scrml_wire_decode in runtime", () => {
    const { result, outDir } = compileSingle(SPA_WITH_SERVER_FN);
    expect(result.errors.length).toBe(0);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    expect(runtime).toContain("function _scrml_wire_decode");
    expect(runtime).toContain("__scrml_absent");
  });

  test("embed-mode SPA bundle does not ship _scrml_wire_decode either", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER, { embedRuntime: true });
    expect(result.errors.length).toBe(0);
    // Embed mode does not write a shared runtime file to disk (runtimeJs
    // is null, so api.js skips the writeFileSync). The runtimeFilename
    // field may still carry the legacy literal for back-compat with
    // callers that surface it unconditionally.
    const dirEntries = require("fs").readdirSync(outDir);
    const runtimeFiles = dirEntries.filter(f => f.startsWith("scrml-runtime"));
    expect(runtimeFiles.length).toBe(0);
    const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(clientJs).not.toContain("function _scrml_wire_decode");
  });
});

// ---------------------------------------------------------------------------
// §3 — hash-stable filename (SCOPING §3.3)
// ---------------------------------------------------------------------------

describe("§3 hash-stable runtime filename (Phase B 3.3)", () => {
  test("identical compile-unit sets produce identical runtime hashes", () => {
    const a = compileSingle(SPA_COUNTER);
    const b = compileSingle(SPA_COUNTER);
    expect(a.result.runtimeFilename).toBe(b.result.runtimeFilename);
    // Sanity: filename matches the hashed shape.
    expect(a.result.runtimeFilename).toMatch(/^scrml-runtime\.[a-z0-9]{8}\.js$/);
  });

  test("different compile-unit sets produce different runtime hashes", () => {
    // SPA_COUNTER (no server-fns, no wire chunk) vs SPA_WITH_SERVER_FN
    // (server-fn + wire chunk). The chunk union differs → the
    // assembled runtime content differs → the hash differs.
    const a = compileSingle(SPA_COUNTER);
    const b = compileSingle(SPA_WITH_SERVER_FN);
    expect(a.result.runtimeFilename).not.toBe(b.result.runtimeFilename);
  });

  test("per-file `// Requires:` line references the hashed runtime filename", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(clientJs.startsWith(`// Requires: ${result.runtimeFilename}\n`)).toBe(true);
  });

  test("HTML `<script src=...>` tag references the hashed runtime filename", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const html = readFileSync(join(outDir, "app.html"), "utf8");
    expect(html).toContain(`<script src="${result.runtimeFilename}"></script>`);
  });

  test("multi-file compile produces ONE runtime — every per-file client.js carries the SAME hash", () => {
    const { result, outDir, filePaths } = compileMulti({ a: MULTI_A, b: MULTI_B });
    expect(result.errors.length).toBe(0);
    const hashedFilename = result.runtimeFilename;
    expect(hashedFilename).toMatch(/^scrml-runtime\.[a-z0-9]{8}\.js$/);
    // Only one runtime file written.
    const aClient = readFileSync(join(outDir, "a.client.js"), "utf8");
    const bClient = readFileSync(join(outDir, "b.client.js"), "utf8");
    expect(aClient).toContain(`// Requires: ${hashedFilename}`);
    expect(bClient).toContain(`// Requires: ${hashedFilename}`);
    // Neither client.js should carry a competing hash reference.
    const otherHashRegex = /scrml-runtime\.[a-z0-9]{8}\.js/g;
    const aMatches = aClient.match(otherHashRegex) ?? [];
    const bMatches = bClient.match(otherHashRegex) ?? [];
    for (const m of aMatches) expect(m).toBe(hashedFilename);
    for (const m of bMatches) expect(m).toBe(hashedFilename);
  });
});

// ---------------------------------------------------------------------------
// §4 — embed-mode regression-free path
// ---------------------------------------------------------------------------

describe("§4 embed-mode regression-free path", () => {
  test("embedRuntime: true produces no shared runtime file on disk", () => {
    const { outDir } = compileSingle(SPA_COUNTER, { embedRuntime: true });
    // api.js writes a runtime only when both cgResult.runtimeJs (the
    // assembled bytes) AND cgResult.runtimeFilename are truthy.
    // Embed mode sets runtimeJs to null, so no file lands on disk.
    const fsList = require("fs").readdirSync(outDir);
    const runtimeFiles = fsList.filter(f => f.startsWith("scrml-runtime"));
    expect(runtimeFiles.length).toBe(0);
  });

  test("embed-mode SPA bundle tree-shakes (no prefetch / mount / vendor-ref / wire)", () => {
    const { outDir } = compileSingle(SPA_COUNTER, { embedRuntime: true });
    const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(clientJs).not.toContain("_scrml_prefetch_tier1");
    expect(clientJs).not.toContain("_scrml_chunk_mount");
    expect(clientJs).not.toContain("_scrml_vendor_require");
    expect(clientJs).not.toContain("_scrml_wire_decode");
  });
});

// ---------------------------------------------------------------------------
// §5 — 6nz Bug P regression: cross-chunk dependency closure (S124, 2026-05-23)
//
// `_scrml_destroy_scope` (scope chunk, always-seeded) unconditionally calls
// `_scrml_stop_scope_timers` (timers chunk) and `_scrml_cancel_animation_frames`
// (animation chunk) on every reactive scope teardown. Pre-S124, both target
// chunks were tree-shaken when the compile unit had no user-facing timer /
// animation-frame usage, causing `ReferenceError: _scrml_stop_scope_timers
// is not defined` on every reactive cleanup — killed all subsequent reactive
// effects in any non-trivial adopter app (6nz Bug P).
//
// Fix: declarative CHUNK_DEPENDENCIES edge `scope → {timers, animation}` +
// `applyChunkDependencies` closure at the end of detectRuntimeChunks.
// Edge table at codegen/runtime-chunks.ts.
// ---------------------------------------------------------------------------

describe("§5 6nz Bug P — cross-chunk dependency closure", () => {
  test("SPA shape includes _scrml_stop_scope_timers definition (scope → timers dep edge)", () => {
    // SPA_COUNTER has no user-facing timer usage. Pre-fix, the `timers`
    // chunk was tree-shaken and `_scrml_stop_scope_timers` was undefined
    // even though `_scrml_destroy_scope` (always-included scope chunk)
    // calls it. Post-fix, the dep edge pulls timers along.
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    expect(runtime).toContain("function _scrml_stop_scope_timers");
  });

  test("SPA shape includes _scrml_cancel_animation_frames definition (scope → animation dep edge)", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    expect(runtime).toContain("function _scrml_cancel_animation_frames");
  });

  test("SPA shape: every _scrml_stop_scope_timers CALL site has a matching definition", () => {
    // Belt-and-suspenders structural check: pre-fix the call count was 1
    // and the def count was 0; post-fix the def is guaranteed present.
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    const defs = (runtime.match(/function _scrml_stop_scope_timers/g) ?? []).length;
    const calls = (runtime.match(/_scrml_stop_scope_timers\(/g) ?? []).length;
    expect(defs).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1); // sanity — destroy_scope calls it
  });

  test("SPA shape: every _scrml_cancel_animation_frames CALL site has a matching definition", () => {
    const { result, outDir } = compileSingle(SPA_COUNTER);
    const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
    const defs = (runtime.match(/function _scrml_cancel_animation_frames/g) ?? []).length;
    const calls = (runtime.match(/_scrml_cancel_animation_frames\(/g) ?? []).length;
    expect(defs).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test("embed-mode SPA bundle: timers + animation chunks pulled by scope dep edge", () => {
    const { outDir } = compileSingle(SPA_COUNTER, { embedRuntime: true });
    const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
    // Same gate as shared-runtime — embed mode also consumes
    // usedRuntimeChunks post-applyChunkDependencies.
    expect(clientJs).toContain("function _scrml_stop_scope_timers");
    expect(clientJs).toContain("function _scrml_cancel_animation_frames");
  });
});
