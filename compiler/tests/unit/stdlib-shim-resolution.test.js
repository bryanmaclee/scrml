/**
 * stdlib-shim-resolution — Bug #8 close (S121)
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
  return [
    "${",
    `    import { ${symbol} } from 'scrml:${moduleName}'`,
    `    server function _useStdlib() {`,
    `        return ${symbol}`,
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
