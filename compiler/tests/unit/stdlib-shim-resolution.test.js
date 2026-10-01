/**
 * stdlib-shim-resolution — Bug #8 close (S121) + Wave 8 Unit F extension (S121)
 *
 * Verifies the 13 stdlib runtime shims landed by Bug #8 dispatch resolve
 * correctly through the compiler's bundle + import-rewrite path AND that
 * the new W-STDLIB-SHIM-MISSING warning fires for any name without a shim.
 *
 * The bug: `compiler/runtime/stdlib/` shipped only 5 of 18 stdlib shims
 * (auth, crypto, data, host, store). Importing any of the other 13
 * (`scrml:fs`, `scrml:cron`, etc.) silently bypassed bundling and left
 * the literal `scrml:NAME` in emitted JS — Node's resolver rejected the
 * scheme and the server module failed to load at runtime, returning 404
 * for server-fn endpoints.
 *
 * Wave 8 Unit F extension (S121 follow-on): the scrml:compiler family
 * (umbrella + 13 per-stage siblings) is KNOWN-DEFERRED per Wave 7 Unit E
 * survey memo Option (d). The bundler reclassifies any `scrml:compiler` or
 * `scrml:compiler/*` reference from W-STDLIB-SHIM-MISSING to a new
 * W-STDLIB-COMPILER-DEFERRED warning that points at the deferral memo +
 * the two viable resolution paths (CLI / direct compiler/src/ import).
 *
 * Coverage:
 *   §1  Per-shim resolution (13 cases): each scrml:NAME import compiles +
 *       produces a server.js whose `from "scrml:NAME"` is rewritten to
 *       `from "./_scrml/NAME.js"` AND the shim file exists on disk.
 *   §2  Missing-shim regression guard: a synthetic `scrml:does-not-exist`
 *       import produces a `W-STDLIB-SHIM-MISSING` warning with the right
 *       name embedded in the message.
 *   §3  Dashboard load smoke: dashboard/app.scrml (the S120 verification
 *       dashboard) compiles cleanly with no W-STDLIB-SHIM-MISSING warning
 *       — proves the dashboard's `scrml:fs` import resolves through the
 *       new shim.
 *   §4  scrml:compiler family (Wave 8 Unit F): per-stage thunk shims
 *       resolve to `_scrml/compiler/<stage>.js`; bundler emits
 *       W-STDLIB-COMPILER-DEFERRED (NOT W-STDLIB-SHIM-MISSING) for every
 *       scrml:compiler* name; the thunk imports throw at call time with
 *       attribution.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join, dirname, resolve as resolvePath } from "path";
import { tmpdir } from "os";
import { compileScrml, bundleStdlibForRun } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "stdlib-shim-res-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

// ---------------------------------------------------------------------------
// §1. Per-shim resolution — 13 cases, one symbol per module.
//
// The fixture is a server-classified import: `${ import { SYM } from 'scrml:NAME' }`
// inside a `server function`. The server function forces server.js emission;
// the import rewrite + shim copy fire under `write: true`.
// ---------------------------------------------------------------------------

// Each entry: { module name, one symbol from that module's .scrml exports }
const NEW_SHIM_MANIFEST = [
  { name: "fs", symbol: "readFileSync" },
  { name: "cron", symbol: "schedule" },
  { name: "format", symbol: "formatCurrency" },
  { name: "math", symbol: "round" },
  { name: "random", symbol: "random" },
  { name: "http", symbol: "get" },
  { name: "oauth", symbol: "memoryAdapter" },
  { name: "path", symbol: "join" },
  { name: "process", symbol: "cwd" },
  { name: "redis", symbol: "set" },
  { name: "regex", symbol: "test" },
  { name: "router", symbol: "match" },
  { name: "test", symbol: "assertEqual" },
  { name: "time", symbol: "formatDate" },
  { name: "compiler", symbol: "compileScrml" },
];

function fixtureFor(symbol, moduleName) {
  // Use the symbol as a side-effecting reference so DG keeps the import.
  // The server function forces server.js emission so the rewrite fires.
  // s441 — `typeof`, not the bare value: returning an async stdlib function
  // (`scrml:http` `get`, `scrml:redis` `set`) as a value is E-ASYNC-FN-ESCAPES-AS-VALUE
  // (S440 F4); `typeof` reads it without calling it.
  return [
    "${",
    `    import { ${symbol} } from 'scrml:${moduleName}'`,
    `    server function _useStdlib() {`,
    `        return typeof ${symbol}`,
    `    }`,
    "}",
    'h1 "shim-resolution smoke"',
  ].join("\n");
}

describe("§1: per-shim resolution (13 cases — one symbol per new shim)", () => {
  for (const { name, symbol } of NEW_SHIM_MANIFEST) {
    test(`scrml:${name} → _scrml/${name}.js rewrite + shim exists`, () => {
      const ROOT = join(TMP, `s1-${name}`);
      const src = fx(`s1-${name}/app.scrml`, fixtureFor(symbol, name));
      const outDir = join(ROOT, "dist");

      const result = compileScrml({
        inputFiles: [src],
        outputDir: outDir,
        write: true,
        log: () => {},
      });

      // Compilation must succeed (no fatal errors).
      expect(result.errors).toEqual([]);

      // The shim file was copied into <outputDir>/_scrml/<name>.js.
      const shimPath = join(outDir, "_scrml", `${name}.js`);
      expect(existsSync(shimPath)).toBe(true);

      // The emitted server.js rewrites `scrml:NAME` → `./_scrml/NAME.js`.
      const serverJs = readFileSync(join(outDir, "app.server.js"), "utf8");
      expect(serverJs).toContain(`from "./_scrml/${name}.js"`);
      // No literal scrml: scheme survives in the server-side output.
      expect(serverJs).not.toContain(`from "scrml:${name}"`);

      // No spurious W-STDLIB-SHIM-MISSING warning for this name — the shim
      // is real; the warning only fires for absent shims (covered in §2).
      const missingForThisName = (result.warnings || []).filter(
        (w) => w.code === "W-STDLIB-SHIM-MISSING" && w.message.includes(`scrml:${name}`),
      );
      expect(missingForThisName).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// §2. Missing-shim regression guard.
//
// `W-STDLIB-SHIM-MISSING` is emitted by bundleStdlibForRun when a referenced
// `scrml:NAME` has no JS shim at compiler/runtime/stdlib/<name>.js. The
// guard exercises bundleStdlibForRun directly — using a name with no shim
// (and no .scrml source) avoids any MOD-stage interference with the
// bundler-only behavior under test.
//
// After Bug #8 lands, every stdlib module has a shim — so the natural
// compileScrml() flow never fires this warning. The test surface here is
// the regression guard for FUTURE stdlib additions: if someone adds a new
// stdlib .scrml module without the matching JS shim, the warning catches it.
// ---------------------------------------------------------------------------

describe("§2: missing-shim regression guard — W-STDLIB-SHIM-MISSING fires for un-shimmed names", () => {
  test("bundleStdlibForRun pushes a W-STDLIB-SHIM-MISSING warning for a name with no shim", () => {
    const outDir = join(TMP, "s2-missing-bundle");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(["does-not-exist-fake-stdlib"]);
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    // The name was NOT bundled (no shim to copy).
    expect(bundled.has("does-not-exist-fake-stdlib")).toBe(false);
    expect(bundled.size).toBe(0);

    // The warning fired with the right shape.
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing.length).toBe(1);
    expect(missing[0].severity).toBe("warning");
    expect(missing[0].message).toContain("scrml:does-not-exist-fake-stdlib");
    expect(missing[0].message).toContain("compiler/runtime/stdlib/does-not-exist-fake-stdlib.js");

    // No shim file got created.
    expect(existsSync(join(outDir, "_scrml/does-not-exist-fake-stdlib.js"))).toBe(false);
  });

  test("bundleStdlibForRun does NOT emit the warning when a real shim exists", () => {
    const outDir = join(TMP, "s2-real-bundle");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(["fs"]); // real shim landed by Bug #8
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    expect(bundled.has("fs")).toBe(true);
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing).toEqual([]);
    expect(existsSync(join(outDir, "_scrml/fs.js"))).toBe(true);
  });

  test("bundleStdlibForRun emits the warning AND continues for mixed sets (one missing + one real)", () => {
    const outDir = join(TMP, "s2-mixed-bundle");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(["fs", "another-fake-module-z"]);
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    // The real one was bundled; the fake one was not.
    expect(bundled.has("fs")).toBe(true);
    expect(bundled.has("another-fake-module-z")).toBe(false);

    // The warning fired exactly once (for the missing name).
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing.length).toBe(1);
    expect(missing[0].message).toContain("another-fake-module-z");
  });
});

// ---------------------------------------------------------------------------
// §3. Dashboard load smoke.
//
// `dashboard/app.scrml` (S120 verification dashboard) imports `scrml:fs`.
// After Bug #8 lands, the dashboard must compile clean AND emit NO
// W-STDLIB-SHIM-MISSING warning (the fs shim now exists).
// ---------------------------------------------------------------------------

describe("§3: dashboard load smoke", () => {
  test("dashboard/app.scrml compiles with no W-STDLIB-SHIM-MISSING warning", () => {
    // Resolve dashboard/app.scrml relative to the project root. The unit-
    // tests directory is .../compiler/tests/unit; project root is two
    // levels up.
    const projectRoot = resolvePath(import.meta.dir, "..", "..", "..");
    const dashboardApp = join(projectRoot, "dashboard", "app.scrml");
    if (!existsSync(dashboardApp)) {
      // Dashboard not in this checkout — skip cleanly (the dashboard is
      // an S120 addition; older snapshots may not have it).
      return;
    }

    const outDir = join(TMP, "s3-dashboard-dist");
    const result = compileScrml({
      inputFiles: [dashboardApp],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    // Zero fatal errors.
    expect(result.errors).toEqual([]);

    // No W-STDLIB-SHIM-MISSING warning — the dashboard's only stdlib
    // import is `scrml:fs`, which Bug #8 shipped.
    const missing = (result.warnings || []).filter(
      (w) => w.code === "W-STDLIB-SHIM-MISSING",
    );
    expect(missing).toEqual([]);

    // The fs shim landed at the expected output location.
    expect(existsSync(join(outDir, "_scrml/fs.js"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4. scrml:compiler family (Wave 8 Unit F — KNOWN-DEFERRED close).
//
// The umbrella scrml:compiler + its 13 per-stage siblings (bs, tab, mod, ce,
// bpp, pa, ri, ts, mc, me, dg, cg, expr) ship deferred-thunk shims. The
// bundler reclassifies any scrml:compiler / scrml:compiler/* reference to
// W-STDLIB-COMPILER-DEFERRED (not W-STDLIB-SHIM-MISSING). The thunks throw
// at call time with attribution to the survey memo.
//
// Ref docs/changes/bug-8-followup/scrml-compiler-shim-survey-s121-2026-05-22.md.
// ---------------------------------------------------------------------------

// Each entry: { stage subpath, one symbol from that stage's .scrml exports }.
// Mirrors the surfaces declared in stdlib/compiler/<stage>.scrml — the test
// asserts each stage's shim file exists AND one of its exports is a thunk.
const COMPILER_FAMILY_MANIFEST = [
  { stage: "bs", symbol: "splitBlocks" },
  { stage: "tab", symbol: "buildAST" },
  { stage: "mod", symbol: "resolveModules" },
  { stage: "ce", symbol: "runCE" },
  { stage: "bpp", symbol: "runBPP" },
  { stage: "pa", symbol: "runPA" },
  { stage: "ri", symbol: "runRI" },
  { stage: "ts", symbol: "runTS" },
  { stage: "mc", symbol: "runMetaChecker" },
  { stage: "me", symbol: "runMetaEval" },
  { stage: "dg", symbol: "runDG" },
  { stage: "cg", symbol: "runCG" },
  { stage: "expr", symbol: "parseExpression" },
];

describe("§4: scrml:compiler family — per-stage thunk shim resolution (13 cases)", () => {
  for (const { stage, symbol } of COMPILER_FAMILY_MANIFEST) {
    test(`scrml:compiler/${stage} → _scrml/compiler/${stage}.js rewrite + thunk shim exists`, () => {
      const ROOT = join(TMP, `s4-compiler-${stage}`);
      const src = fx(`s4-compiler-${stage}/app.scrml`, fixtureFor(symbol, `compiler/${stage}`));
      const outDir = join(ROOT, "dist");

      const result = compileScrml({
        inputFiles: [src],
        outputDir: outDir,
        write: true,
        log: () => {},
      });

      // Compilation must succeed (no fatal errors).
      expect(result.errors).toEqual([]);

      // The per-stage shim was copied to <outputDir>/_scrml/compiler/<stage>.js.
      const shimPath = join(outDir, "_scrml", "compiler", `${stage}.js`);
      expect(existsSync(shimPath)).toBe(true);

      // The emitted server.js rewrites `scrml:compiler/<stage>` →
      // `./_scrml/compiler/<stage>.js`. Literal scrml: scheme MUST NOT survive.
      const serverJs = readFileSync(join(outDir, "app.server.js"), "utf8");
      expect(serverJs).toContain(`from "./_scrml/compiler/${stage}.js"`);
      expect(serverJs).not.toContain(`from "scrml:compiler/${stage}"`);

      // No W-STDLIB-SHIM-MISSING for this name — the bundler reclassifies
      // the compiler family to DEFERRED.
      const shimMissingForThis = (result.warnings || []).filter(
        (w) => w.code === "W-STDLIB-SHIM-MISSING" && w.message.includes(`scrml:compiler/${stage}`),
      );
      expect(shimMissingForThis).toEqual([]);

      // A W-STDLIB-COMPILER-DEFERRED warning fired for this name.
      const deferredForThis = (result.warnings || []).filter(
        (w) =>
          w.code === "W-STDLIB-COMPILER-DEFERRED"
          && w.message.includes(`scrml:compiler/${stage}`),
      );
      expect(deferredForThis.length).toBeGreaterThanOrEqual(1);
      expect(deferredForThis[0].severity).toBe("warning");
    });
  }

  test("scrml:compiler/<stage> thunks throw at call time with attribution", async () => {
    // Spot-check three diverse stages — the canonical thunk shape is
    // identical across the family, so the contract is fully exercised by
    // these representatives.
    const cases = [
      { stage: "bs", symbol: "splitBlocks" },
      { stage: "pa", symbol: "runPA" },
      { stage: "expr", symbol: "parseExpression" },
    ];
    for (const { stage, symbol } of cases) {
      const mod = await import(`../../runtime/stdlib/compiler/${stage}.js`);
      expect(typeof mod[symbol]).toBe("function");
      let threw = false;
      let msg = "";
      try {
        mod[symbol]();
      } catch (e) {
        threw = true;
        msg = String(e?.message ?? e);
      }
      expect(threw).toBe(true);
      expect(msg).toContain(`[scrml:compiler/${stage}]`);
      expect(msg).toContain(symbol);
      expect(msg).toContain("DEFERRED");
      expect(msg).toContain("scrml-compiler-shim-survey-s121-2026-05-22.md");
    }
  });
});

describe("§5: scrml:compiler family — bundler reclassification + regression guards", () => {
  test("bundleStdlibForRun emits W-STDLIB-COMPILER-DEFERRED (NOT W-STDLIB-SHIM-MISSING) for the umbrella", () => {
    const outDir = join(TMP, "s5-umbrella-bundle");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(["compiler"]);
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    // Umbrella shim IS on disk (Bug 8 close) — it gets bundled.
    expect(bundled.has("compiler")).toBe(true);

    // The DEFERRED warning fired exactly once for the umbrella.
    const deferred = diagnostics.filter((d) => d.code === "W-STDLIB-COMPILER-DEFERRED");
    expect(deferred.length).toBe(1);
    expect(deferred[0].severity).toBe("warning");
    expect(deferred[0].message).toContain("scrml:compiler");
    expect(deferred[0].message).toContain("DEFERRED");
    expect(deferred[0].message).toContain("scrml-compiler-shim-survey-s121-2026-05-22.md");

    // No SHIM-MISSING for the umbrella — reclassification is the whole point.
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing).toEqual([]);
  });

  test("bundleStdlibForRun emits W-STDLIB-COMPILER-DEFERRED for each scrml:compiler/<stage> sibling", () => {
    const outDir = join(TMP, "s5-siblings-bundle");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(COMPILER_FAMILY_MANIFEST.map((c) => `compiler/${c.stage}`));
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    // All 13 per-stage shims were bundled.
    expect(bundled.size).toBe(13);

    // One DEFERRED warning per stage; zero SHIM-MISSING.
    const deferred = diagnostics.filter((d) => d.code === "W-STDLIB-COMPILER-DEFERRED");
    expect(deferred.length).toBe(13);
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing).toEqual([]);

    for (const { stage } of COMPILER_FAMILY_MANIFEST) {
      const forThis = deferred.filter((d) => d.message.includes(`scrml:compiler/${stage}`));
      expect(forThis.length).toBe(1);
      // The per-stage shim landed on disk too.
      expect(existsSync(join(outDir, "_scrml", "compiler", `${stage}.js`))).toBe(true);
    }
  });

  test("bundleStdlibForRun emits W-STDLIB-COMPILER-DEFERRED (not SHIM-MISSING) for a synthetic missing compiler/<stage>", () => {
    // Regression guard: even if a scrml:compiler/<stage> name has no shim
    // on disk, the warning is DEFERRED (the deferral is a property of the
    // family, not of shim presence).
    const outDir = join(TMP, "s5-missing-compiler-stage");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    // A compiler/<X> name with no shim file backing it.
    const names = new Set(["compiler/nonexistent-stage-z"]);
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    // Not bundled (no shim file).
    expect(bundled.has("compiler/nonexistent-stage-z")).toBe(false);

    // The warning is DEFERRED, NOT SHIM-MISSING.
    const deferred = diagnostics.filter((d) => d.code === "W-STDLIB-COMPILER-DEFERRED");
    expect(deferred.length).toBe(1);
    expect(deferred[0].message).toContain("scrml:compiler/nonexistent-stage-z");
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing).toEqual([]);
  });

  test("non-compiler stdlib names still emit W-STDLIB-SHIM-MISSING (regression guard)", () => {
    // The compiler-family special-case MUST NOT change behavior for any
    // other stdlib name. A synthetic non-compiler name with no shim fires
    // SHIM-MISSING, not DEFERRED.
    const outDir = join(TMP, "s5-non-compiler-missing");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(["definitely-not-a-compiler-name-zzz"]);
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    expect(bundled.size).toBe(0);

    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing.length).toBe(1);
    expect(missing[0].message).toContain("scrml:definitely-not-a-compiler-name-zzz");
    const deferred = diagnostics.filter((d) => d.code === "W-STDLIB-COMPILER-DEFERRED");
    expect(deferred).toEqual([]);
  });

  test("a name starting with 'compiler' but NOT 'compiler' / 'compiler/' is NOT reclassified", () => {
    // Edge case: a name like 'compilerish' must NOT match the family.
    // The predicate is `name === "compiler" || name.startsWith("compiler/")`.
    const outDir = join(TMP, "s5-edge-compilerish");
    mkdirSync(outDir, { recursive: true });

    const diagnostics = [];
    const names = new Set(["compilerish-not-a-real-stage"]);
    const bundled = bundleStdlibForRun(names, outDir, null, diagnostics);

    expect(bundled.size).toBe(0);

    // SHIM-MISSING fires (this name is NOT the compiler family).
    const missing = diagnostics.filter((d) => d.code === "W-STDLIB-SHIM-MISSING");
    expect(missing.length).toBe(1);
    const deferred = diagnostics.filter((d) => d.code === "W-STDLIB-COMPILER-DEFERRED");
    expect(deferred).toEqual([]);
  });
});
