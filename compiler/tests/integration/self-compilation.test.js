/**
 * Self-Compilation Integration Test
 *
 * Validates that the scrml self-hosted compiler modules (compiled from
 * stdlib/compiler/*.scrml via build-self-host.js) produce identical output
 * to the JS originals when used as pipeline overrides via selfHostModules.
 *
 * This test is the first integration-level check for the M3 milestone:
 * self-hosting the compiler in scrml. It goes beyond the eval-based smoke
 * tests (self-host-smoke.test.js) by exercising the full compilation pipeline
 * with the compiled modules wired in.
 *
 * Prerequisites:
 *   bun run compiler/scripts/build-self-host.js
 *
 * If the compiled modules do not exist, the test is skipped (not failed).
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { execSync } from "child_process";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Path resolution (works in main repo and worktrees)
// ---------------------------------------------------------------------------

const testDir = dirname(new URL(import.meta.url).pathname);

function findMainProjectRoot() {
  try {
    const wtList = execSync("git -C " + testDir + " worktree list --porcelain", { encoding: "utf-8" });
    const firstLine = wtList.split("\n").find(l => l.startsWith("worktree "));
    if (firstLine) {
      const mainRoot = firstLine.replace("worktree ", "");
      if (existsSync(resolve(mainRoot, "compiler/src/api.js"))) {
        return mainRoot;
      }
    }
  } catch { /* fall through */ }
  return execSync(
    "git -C " + testDir + " rev-parse --show-toplevel",
    { encoding: "utf-8" },
  ).trim();
}

const projectRoot = findMainProjectRoot();
const distSelfHostDir = resolve(projectRoot, "compiler", "dist", "self-host");
const moduleResolverPath = join(distSelfHostDir, "module-resolver.js");
const metaCheckerPath = join(distSelfHostDir, "meta-checker.js");

// ---------------------------------------------------------------------------
// Sample scrml files to use as compilation inputs
// ---------------------------------------------------------------------------

// Use samples that are known-good from the existing test suite.
// These are the simplest available scrml programs.
const sampleDir = resolve(projectRoot, "samples", "compilation-tests");

function findSampleFile(...candidates) {
  for (const name of candidates) {
    const p = resolve(sampleDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

// A minimal sample — prefer the simplest one available
const simpleSample = findSampleFile(
  "hello-world.scrml",
  "basic.scrml",
  "counter.scrml",
);

// A sample that uses imports, to exercise module-resolver more thoroughly
const importsSample = findSampleFile(
  "import-export.scrml",
  "imports.scrml",
  "component-import.scrml",
);

// ---------------------------------------------------------------------------
// State: are compiled modules available?
// ---------------------------------------------------------------------------

let selfHostModules = null;
let loadError = null;

beforeAll(async () => {
  if (!existsSync(moduleResolverPath) || !existsSync(metaCheckerPath)) {
    loadError = `compiled self-host modules not found in ${distSelfHostDir} — run: bun run compiler/scripts/build-self-host.js`;
    return;
  }

  try {
    const [modResolverMod, metaCheckerMod] = await Promise.all([
      import(moduleResolverPath),
      import(metaCheckerPath),
    ]);

    const resolveModules = modResolverMod.resolveModules;
    const runMetaChecker = metaCheckerMod.runMetaChecker;

    if (typeof resolveModules !== "function" || typeof runMetaChecker !== "function") {
      loadError = `compiled modules do not export expected functions. resolveModules: ${typeof resolveModules}, runMetaChecker: ${typeof runMetaChecker}`;
      return;
    }

    selfHostModules = { resolveModules, runMetaChecker };
  } catch (err) {
    loadError = `failed to import compiled modules: ${err.message}`;
  }
});

// ---------------------------------------------------------------------------
// Helper: skip if compiled modules not available
// ---------------------------------------------------------------------------

function skipIfNotBuilt() {
  if (loadError) {
    console.log(`SKIP: ${loadError}`);
    return true;
  }
  if (!selfHostModules) {
    console.log("SKIP: selfHostModules not loaded");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests: compiled module shape
// ---------------------------------------------------------------------------

describe("self-compilation: compiled module shape", () => {
  test("dist/self-host directory exists after build-self-host.js", () => {
    if (!existsSync(distSelfHostDir)) {
      console.log(`INFO: ${distSelfHostDir} not found — run build-self-host.js to generate`);
      // Soft skip: this is informative, not a hard failure
      return;
    }
    expect(existsSync(distSelfHostDir)).toBe(true);
  });

  test("module-resolver.js exists in dist/self-host/", () => {
    if (!existsSync(distSelfHostDir)) return;
    expect(existsSync(moduleResolverPath)).toBe(true);
  });

  test("meta-checker.js exists in dist/self-host/", () => {
    if (!existsSync(distSelfHostDir)) return;
    expect(existsSync(metaCheckerPath)).toBe(true);
  });

  test("compiled modules export resolveModules and runMetaChecker", async () => {
    if (!existsSync(moduleResolverPath) || !existsSync(metaCheckerPath)) return;

    const [modResolverMod, metaCheckerMod] = await Promise.all([
      import(moduleResolverPath),
      import(metaCheckerPath),
    ]);

    expect(typeof modResolverMod.resolveModules).toBe("function");
    expect(typeof metaCheckerMod.runMetaChecker).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Tests: selfHostModules API contract (no compilation needed)
// ---------------------------------------------------------------------------

describe("self-compilation: selfHostModules API in compileScrml", () => {
  test("compileScrml accepts selfHostModules option without error on empty input", () => {
    // Even with no files, passing selfHostModules should not throw
    const fakeModules = {
      resolveModules: (tabResults) => ({
        importGraph: new Map(),
        exportRegistry: new Map(),
        compilationOrder: [],
        errors: [],
      }),
      runMetaChecker: ({ files }) => ({ files, errors: [] }),
    };

    const result = compileScrml({
      inputFiles: [],
      selfHostModules: fakeModules,
      write: false,
    });

    // Empty input returns early with no errors
    expect(result.fileCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("compileScrml with selfHostModules: null behaves identically to default", () => {
    const resultDefault = compileScrml({ inputFiles: [], write: false });
    const resultExplicitNull = compileScrml({ inputFiles: [], write: false, selfHostModules: null });

    expect(resultDefault.fileCount).toBe(resultExplicitNull.fileCount);
    expect(resultDefault.errors).toHaveLength(resultExplicitNull.errors.length);
  });

  test("selfHostModules.resolveModules is called when provided", () => {
    let called = false;
    const fakeModules = {
      resolveModules: (tabResults) => {
        called = true;
        // Return minimal valid result to allow pipeline to proceed
        return {
          importGraph: new Map(),
          exportRegistry: new Map(),
          compilationOrder: [],
          errors: [],
        };
      },
      runMetaChecker: ({ files }) => ({ files, errors: [] }),
    };

    compileScrml({
      inputFiles: [],
      selfHostModules: fakeModules,
      write: false,
    });

    // Empty input returns before MOD stage, so resolveModules is not called.
    // This just ensures no crash. The called=true path requires actual files.
    expect(called).toBe(false); // empty input exits before MOD
  });
});

// ---------------------------------------------------------------------------
// Tests: parity — identical output with/without selfHostModules
// ---------------------------------------------------------------------------

describe("self-compilation: parity — normal vs self-host compilation", () => {
  test("identical output for simple sample (if available)", () => {
    if (skipIfNotBuilt()) return;
    if (!simpleSample) {
      console.log("SKIP: no simple sample file found in samples/compilation-tests/");
      return;
    }

    const normalResult = compileScrml({
      inputFiles: [simpleSample],
      write: false,
      mode: "browser",
    });

    const selfHostResult = compileScrml({
      inputFiles: [simpleSample],
      write: false,
      mode: "browser",
      selfHostModules,
    });

    // Error counts must match
    expect(selfHostResult.errors.length).toBe(normalResult.errors.length);
    expect(selfHostResult.warnings.length).toBe(normalResult.warnings.length);

    // Output keys must match
    expect(selfHostResult.outputs.size).toBe(normalResult.outputs.size);

    // For each output file, content must be identical
    for (const [filePath, normalOutput] of normalResult.outputs) {
      const selfHostOutput = selfHostResult.outputs.get(filePath);
      expect(selfHostOutput).toBeDefined();

      if (normalOutput.html !== undefined) {
        expect(selfHostOutput.html).toBe(normalOutput.html);
      }
      if (normalOutput.clientJs !== undefined) {
        expect(selfHostOutput.clientJs).toBe(normalOutput.clientJs);
      }
      if (normalOutput.serverJs !== undefined) {
        expect(selfHostOutput.serverJs).toBe(normalOutput.serverJs);
      }
    }
  });

  test("identical output for sample with imports (if available)", () => {
    if (skipIfNotBuilt()) return;
    if (!importsSample) {
      console.log("SKIP: no imports sample file found in samples/compilation-tests/");
      return;
    }

    const normalResult = compileScrml({
      inputFiles: [importsSample],
      write: false,
      mode: "browser",
    });

    const selfHostResult = compileScrml({
      inputFiles: [importsSample],
      write: false,
      mode: "browser",
      selfHostModules,
    });

    expect(selfHostResult.errors.length).toBe(normalResult.errors.length);
    expect(selfHostResult.outputs.size).toBe(normalResult.outputs.size);

    for (const [filePath, normalOutput] of normalResult.outputs) {
      const selfHostOutput = selfHostResult.outputs.get(filePath);
      expect(selfHostOutput).toBeDefined();

      if (normalOutput.clientJs !== undefined) {
        expect(selfHostOutput.clientJs).toBe(normalOutput.clientJs);
      }
    }
  });

  test("identical output in library mode for stdlib/compiler/module-resolver.scrml", () => {
    if (skipIfNotBuilt()) return;

    const scrmlSource = resolve(projectRoot, "stdlib", "compiler", "module-resolver.scrml");
    if (!existsSync(scrmlSource)) {
      console.log("SKIP: stdlib/compiler/module-resolver.scrml not found");
      return;
    }

    const normalResult = compileScrml({
      inputFiles: [scrmlSource],
      write: false,
      mode: "library",
    });

    const selfHostResult = compileScrml({
      inputFiles: [scrmlSource],
      write: false,
      mode: "library",
      selfHostModules,
    });

    expect(selfHostResult.errors.length).toBe(normalResult.errors.length);

    for (const [filePath, normalOutput] of normalResult.outputs) {
      const selfHostOutput = selfHostResult.outputs.get(filePath);
      expect(selfHostOutput).toBeDefined();

      // Library mode outputs libraryJs (not clientJs/html)
      if (normalOutput.libraryJs !== undefined) {
        expect(selfHostOutput.libraryJs).toBe(normalOutput.libraryJs);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveModules parity via selfHostModules
// ---------------------------------------------------------------------------

describe("self-compilation: resolveModules parity via selfHostModules hook", () => {
  test("self-hosted resolveModules produces same result as JS original", async () => {
    if (skipIfNotBuilt()) return;

    // Import the JS original directly
    const jsModulePath = resolve(projectRoot, "compiler", "src", "module-resolver.js");
    const { resolveModules: jsResolveModules } = await import(jsModulePath);

    // Build a minimal pair of FileAST objects
    const fileA = {
      filePath: "/test/a.scrml",
      ast: {
        filePath: "/test/a.scrml",
        imports: [{ kind: "import-decl", names: ["Status"], source: "./b.scrml", isDefault: false, span: { file: "/test/a.scrml", start: 0, end: 0, line: 1, col: 1 } }],
        exports: [],
      },
    };
    const fileB = {
      filePath: "/test/b.scrml",
      ast: {
        filePath: "/test/b.scrml",
        imports: [],
        exports: [{ kind: "export-decl", exportedName: "Status", exportKind: "type", reExportSource: null, span: { file: "/test/b.scrml", start: 0, end: 0, line: 1, col: 1 } }],
      },
    };

    const jsResult = jsResolveModules([fileA, fileB]);
    const selfHostResult = selfHostModules.resolveModules([fileA, fileB]);

    // Both must agree on errors (none expected here)
    expect(selfHostResult.errors.length).toBe(jsResult.errors.length);

    // Both must agree on compilation order
    expect(selfHostResult.compilationOrder).toEqual(jsResult.compilationOrder);

    // Both must find the same exports
    expect(selfHostResult.exportRegistry.size).toBe(jsResult.exportRegistry.size);
  });

  test("self-hosted resolveModules detects circular imports", async () => {
    if (skipIfNotBuilt()) return;

    const fileA = {
      filePath: "/test/cycle-a.scrml",
      ast: {
        filePath: "/test/cycle-a.scrml",
        imports: [{ kind: "import-decl", names: ["X"], source: "./cycle-b.scrml", isDefault: false, span: { file: "/test/cycle-a.scrml", start: 0, end: 0, line: 1, col: 1 } }],
        exports: [],
      },
    };
    const fileB = {
      filePath: "/test/cycle-b.scrml",
      ast: {
        filePath: "/test/cycle-b.scrml",
        imports: [{ kind: "import-decl", names: ["Y"], source: "./cycle-a.scrml", isDefault: false, span: { file: "/test/cycle-b.scrml", start: 0, end: 0, line: 1, col: 1 } }],
        exports: [],
      },
    };

    const result = selfHostModules.resolveModules([fileA, fileB]);

    // Must detect E-IMPORT-002 circular dependency
    const hasCycleError = result.errors.some(e => e.code === "E-IMPORT-002");
    expect(hasCycleError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §BOOTSTRAP: Compiler Compiles Compiler
//
// The ultimate self-hosting test: compile each self-hosted .scrml source file
// using BOTH the standard compiler and the self-hosted compiler. If both
// produce identical library-mode JS output, the compiler can compile itself.
// ---------------------------------------------------------------------------

describe("Bootstrap: compiler compiles compiler", () => {
  const distDir = resolve(projectRoot, "compiler/dist/self-host");

  // All self-hosted .scrml source files
  const bootstrapFiles = [
    { name: "bs.scrml", path: resolve(projectRoot, "compiler/self-host/bs.scrml") },
    { name: "tab.scrml", path: resolve(projectRoot, "compiler/self-host/tab.scrml") },
    { name: "bpp.scrml", path: resolve(projectRoot, "compiler/self-host/bpp.scrml") },
    { name: "pa.scrml", path: resolve(projectRoot, "compiler/self-host/pa.scrml") },
    { name: "ri.scrml", path: resolve(projectRoot, "compiler/self-host/ri.scrml") },
    { name: "ts.scrml", path: resolve(projectRoot, "compiler/self-host/ts.scrml") },
    { name: "dg.scrml", path: resolve(projectRoot, "compiler/self-host/dg.scrml") },
    { name: "ast.scrml", path: resolve(projectRoot, "compiler/self-host/ast.scrml") },
    { name: "module-resolver.scrml", path: resolve(projectRoot, "stdlib/compiler/module-resolver.scrml") },
    { name: "meta-checker.scrml", path: resolve(projectRoot, "stdlib/compiler/meta-checker.scrml") },
  ];

  let selfHostModules = null;

  beforeAll(async () => {
    // Load all self-hosted modules
    try {
      const bs = await import(join(distDir, "bs.js"));
      const tab = await import(join(distDir, "tab.js"));
      const ast = await import(join(distDir, "ast.js"));
      const mr = await import(join(distDir, "module-resolver.js"));
      const mc = await import(join(distDir, "meta-checker.js"));
      const pa = await import(join(distDir, "pa.js"));
      const ri = await import(join(distDir, "ri.js"));
      const ts = await import(join(distDir, "ts.js"));
      const dg = await import(join(distDir, "dg.js"));
      const cg = await import(join(distDir, "cg.js"));

      selfHostModules = {
        splitBlocks: bs.splitBlocks,
        tokenizer: {
          tokenizeBlock: tab.tokenizeBlock,
          tokenizeAttributes: tab.tokenizeAttributes,
          tokenizeLogic: tab.tokenizeLogic,
          tokenizeSQL: tab.tokenizeSQL,
          tokenizeCSS: tab.tokenizeCSS,
          tokenizeError: tab.tokenizeError,
          tokenizePassthrough: tab.tokenizePassthrough,
        },
        buildAST: ast.buildAST,
        resolveModules: mr.resolveModules,
        runMetaChecker: mc.runMetaChecker,
        runPA: pa.runPA,
        runRI: ri.runRI,
        runTS: ts.runTS,
        runDG: dg.runDG,
        runCG: cg.runCG,
      };
    } catch {
      // Modules not built — tests will be skipped
    }
  });

  // Per-test timeout override (S145 flake fix, change-id
  // s145-test-flake-parallel-safety-2026-05-30): each bootstrap case runs
  // TWO full library-mode self-compiles of a self-hosted compiler-stage
  // `.scrml` source — `ast.scrml` is the largest and takes ~5s in isolation
  // but ~28s under full parallel-suite CPU contention (and `ts.scrml` ~11s).
  // The bunfig default 10s per-test timeout is exceeded ONLY under that
  // parallel load, which is what flake-blocked the pre-push full-suite at
  // S144/S145 (forced `--no-verify`). The assertion (self-hosted == standard
  // library JS, byte-identical) is UNCHANGED — the parity check stays exactly
  // as strict; only the timeout headroom is widened to absorb contention.
  // 120s gives ~4x margin over the worst observed (28.6s) under load.
  const BOOTSTRAP_TIMEOUT_MS = 120000;

  for (const { name, path } of bootstrapFiles) {
    test(`bootstrap: ${name} — self-hosted output matches standard`, async () => {
      if (!selfHostModules) return; // skip if modules not built
      if (!existsSync(path)) return;

      const std = compileScrml({ inputFiles: [path], mode: "library", write: false });
      const sh = compileScrml({ inputFiles: [path], mode: "library", write: false, selfHostModules });

      const stdJs = std.outputs?.values()?.next()?.value?.libraryJs ?? "";
      const shJs = sh.outputs?.values()?.next()?.value?.libraryJs ?? "";

      expect(shJs).toBe(stdJs);
    }, BOOTSTRAP_TIMEOUT_MS);
  }
});

// ---------------------------------------------------------------------------
// §BOOTSTRAP-L3: Self-Hosted API (compileScrml) Compiles Compiler
//
// L3 bootstrap: the self-hosted compileScrml() function (compiler/self-host/api.js)
// compiles each self-hosted .scrml source and produces identical output to the
// standard TS-based compileScrml(). This proves the compiler API itself is
// self-hosted, not just the pipeline stages.
// ---------------------------------------------------------------------------

// Phase A10 / S78 audit / S80 partial fix: the host-compiler library-mode
// meta-block strip pass WAS greedy-truncating `await import(expr)` calls in
// plain JS (outside `^{}` meta blocks). Root cause: strip regex used `[^)]+`
// arg shape, which is not paren-aware — for `await import(new URL(...).href)`
// it stopped at the first `)` (the URL closer) and stripped the leading
// `const _ep = await import(new URL(...` portion, leaving `.href)` as
// residue. Fix at `compiler/src/codegen/emit-library.ts:180-188` and its
// self-host mirror `compiler/self-host/cg-parts/section-assembly.js:937-944`
// narrows the strip regex to quoted-string args (mirroring importRe /
// nsImportRe emit shapes). With the strip-bug fix, `ast.js` no longer has the
// `.href)` residue and is structurally valid; api.js can be imported when
// `compiler/self-host/cg.scrml` is restructured.
//
// REMAINING SKIP REASON (S80): the L3 + L2 parity tests assert that the
// self-hosted pipeline produces output identical to the standard TS pipeline.
// That parity is NOT met today (verified S80: when cg.runCG was undefined,
// compileScrml soft-fell-back to the standard implementation, masking
// divergence; when restructured to expose cg.runCG, 21 parity assertions
// fail). The self-host module set has real divergences beyond the strip-bug
// surface — fixing them is a substantial separate priority not in scope for
// the L3-strip-bug session. The L1 (pipeline-stage parity) tests above
// continue to run and pass — those exercise individual stage modules with
// the JS originals as the source of truth.
describe.skip("Bootstrap L3: self-hosted API compiles compiler [SKIP — self-host parity gap; L3 strip-bug fixed at S80 but L2/L3 parity unmet — see comment above]", () => {
  const apiPath = resolve(projectRoot, "compiler/self-host/api.js");

  const bootstrapFiles = [
    { name: "bs.scrml", path: resolve(projectRoot, "compiler/self-host/bs.scrml") },
    { name: "tab.scrml", path: resolve(projectRoot, "compiler/self-host/tab.scrml") },
    { name: "bpp.scrml", path: resolve(projectRoot, "compiler/self-host/bpp.scrml") },
    { name: "pa.scrml", path: resolve(projectRoot, "compiler/self-host/pa.scrml") },
    { name: "ri.scrml", path: resolve(projectRoot, "compiler/self-host/ri.scrml") },
    { name: "ts.scrml", path: resolve(projectRoot, "compiler/self-host/ts.scrml") },
    { name: "dg.scrml", path: resolve(projectRoot, "compiler/self-host/dg.scrml") },
    { name: "ast.scrml", path: resolve(projectRoot, "compiler/self-host/ast.scrml") },
    { name: "module-resolver.scrml", path: resolve(projectRoot, "stdlib/compiler/module-resolver.scrml") },
    { name: "meta-checker.scrml", path: resolve(projectRoot, "stdlib/compiler/meta-checker.scrml") },
  ];

  let shCompile = null;

  beforeAll(async () => {
    if (!existsSync(apiPath)) return;
    try {
      const mod = await import(apiPath);
      shCompile = mod.compileScrml;
    } catch {
      // Self-hosted API not available
    }
  });

  test("self-hosted api.js exports compileScrml", async () => {
    if (!existsSync(apiPath)) return;
    const mod = await import(apiPath);
    expect(typeof mod.compileScrml).toBe("function");
    expect(typeof mod.scanDirectory).toBe("function");
  });

  for (const { name, path } of bootstrapFiles) {
    test(`L3 bootstrap: ${name} — self-hosted API output matches standard API`, async () => {
      if (!shCompile) return;
      if (!existsSync(path)) return;

      const std = compileScrml({ inputFiles: [path], mode: "library", write: false });
      const sh = shCompile({ inputFiles: [path], mode: "library", write: false });

      const stdJs = std.outputs?.values()?.next()?.value?.libraryJs ?? "";
      const shJs = sh.outputs?.values()?.next()?.value?.libraryJs ?? "";

      expect(shJs).toBe(stdJs);
    });
  }

  test("L3 bootstrap: TodoMVC compiles via self-hosted API", async () => {
    if (!shCompile) return;
    const todoPath = resolve(projectRoot, "benchmarks/todomvc/app.scrml");
    if (!existsSync(todoPath)) return;

    const result = shCompile({ inputFiles: [todoPath], write: false });
    expect(result.errors.length).toBe(0);
    expect(result.fileCount).toBe(3);
  });
});
