/**
 * scrml-compiler-import-host-bridge.test.js — S430 P4 migration.
 *
 * stdlib/compiler/*.scrml (the `scrml:compiler` family) used to bridge into
 * the host TypeScript compiler with `^{ const { … } = await import("…") }`.
 * That form is now E-DYNAMIC-IMPORT-NOT-IN-SCRML (SPEC §21.3.2); the files use
 * the file-top `import:host { … } from "…"` declaration (§21.3.1) instead,
 * admitted by the repo-root `scrml.toml`:
 *
 *   [capabilities]
 *   host-import = "self-host-only"     # §22.13 — admits stdlib/compiler/** only
 *
 * This file proves:
 *   1. RUNTIME — the compiled umbrella + per-stage library modules import under
 *      bun and re-export the REAL TS compiler functions (identity, not copies),
 *      and a re-exported entry point actually runs.
 *   2. GATE — the repo manifest admits ONLY stdlib/compiler/**: an `import:host`
 *      anywhere else in this repository is still E-IMPORT-008, including a path
 *      that merely CONTAINS `stdlib/compiler/` below the project root.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const STDLIB_COMPILER = join(REPO, "stdlib/compiler");

// The two stdlib/compiler files that are ports (not bridges) and still carry
// unmigrated `class` sites (P1b) — they are not part of the runtime bridge.
const PORTS = new Set(["meta-checker.scrml", "module-resolver.scrml"]);

describe("S430 P4 — scrml:compiler bridges run under bun (import:host)", () => {
  let outDir;
  let tmpRoot;
  beforeAll(() => {
    // Nested output dir: relative host specifiers must be rebased (#1045).
    tmpRoot = mkdtempSync(join(tmpdir(), "scrml-compiler-bridge-"));
    outDir = join(tmpRoot, "a", "b");
    const files = readdirSync(STDLIB_COMPILER)
      .filter((f) => f.endsWith(".scrml") && !PORTS.has(f))
      .map((f) => join(STDLIB_COMPILER, f));
    const r = compileScrml({ inputFiles: files, outputDir: outDir, mode: "library", write: true, log: () => {} });
    expect(r.errors).toEqual([]);
  });
  afterAll(() => { if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true }); });

  test("the umbrella re-exports the TS compiler's own functions (identity)", async () => {
    const idx = await import(join(outDir, "index.js"));
    const exported = Object.keys(idx);
    expect(exported.length).toBe(16);
    for (const k of exported) expect(typeof idx[k]).toBe("function");
    expect(idx.compileScrml).toBe((await import("../../src/api.js")).compileScrml);
    expect(idx.splitBlocks).toBe((await import("../../src/block-splitter.js")).splitBlocks);
    expect(idx.buildAST).toBe((await import("../../src/ast-builder.js")).buildAST);
    expect(idx.runTS).toBe((await import("../../src/type-system.ts")).runTS);
    expect(idx.runCG).toBe((await import("../../src/codegen/index.ts")).runCG);
    expect(idx.parseExpression).toBe((await import("../../src/expression-parser.ts")).parseExpression);
  });

  test("every per-stage module's exports are defined", async () => {
    for (const stage of ["bs", "tab", "mod", "ce", "bpp", "pa", "ri", "ts", "mc", "me", "dg", "cg", "expr"]) {
      const m = await import(join(outDir, `${stage}.js`));
      const names = Object.keys(m);
      expect(names.length).toBeGreaterThan(0);
      for (const k of names) expect(m[k]).toBeDefined();
    }
  });

  test("a re-exported entry point runs", async () => {
    const idx = await import(join(outDir, "index.js"));
    const out = idx.splitBlocks("x.scrml", "<program><p>hi</p></program>");
    expect(Array.isArray(out.blocks)).toBe(true);
    expect(out.blocks.length).toBeGreaterThan(0);
  });
});

describe("S430 P4 — the repo manifest admits import:host ONLY under stdlib/compiler/", () => {
  // Written INSIDE the repository so the real repo-root scrml.toml governs it.
  const probeRoot = join(REPO, "compiler/tests", `.tmp-import-host-gate-${process.pid}`);
  const HOST = join(REPO, "compiler/src/block-splitter.js");
  afterAll(() => rmSync(probeRoot, { recursive: true, force: true }));

  function probe(relDir) {
    const dir = join(probeRoot, relDir);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "probe.scrml");
    const spec = relative(dir, HOST);
    writeFileSync(f, `import:host { splitBlocks } from "${spec}"\nexport const s = splitBlocks\n`);
    const r = compileScrml({ inputFiles: [f], outputDir: join(probeRoot, "dist"), mode: "library", write: false, log: () => {} });
    return (r.errors || []).map((e) => e.code);
  }

  test("a file outside stdlib/compiler still gets E-IMPORT-008", () => {
    expect(probe("plain")).toContain("E-IMPORT-008");
  });

  test("a path that merely contains stdlib/compiler/ below the root is NOT admitted", () => {
    expect(probe("nested/stdlib/compiler")).toContain("E-IMPORT-008");
  });

  test("the real stdlib/compiler files are admitted (no E-IMPORT-008)", () => {
    const r = compileScrml({
      inputFiles: [join(STDLIB_COMPILER, "bs.scrml")], outputDir: join(probeRoot, "dist2"),
      mode: "library", write: false, log: () => {},
    });
    expect((r.errors || []).map((e) => e.code)).toEqual([]);
  });
});
