/**
 * API (compileScrml) — Unit Tests
 *
 * Tests for src/api.js — the programmatic compilation interface.
 *
 * Coverage:
 *   §1  compileScrml returns expected shape: errors, warnings, fileCount, durationMs, outputs
 *   §2  Valid minimal input produces no errors
 *   §3  outputs is a Map keyed by file path
 *   §4  durationMs is a non-negative number
 *   §5  scanDirectory finds .scrml files recursively
 *   §6  write:false suppresses disk writes, outputs still populated
 *   §7  BS-stage errors are surfaced in result.errors with stage: "BS"
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from "fs";
import { join, resolve, sep } from "path";
import { compileScrml, scanDirectory } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/api-test");
const FIXTURE_FILE = join(FIXTURE_DIR, "hello.scrml");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

// Minimal valid scrml: plain markup, no <program> wrapper.
// Matches the pattern in examples/hello.scrml.
const MINIMAL_SCRML = 'h1 "Hello, world"\n';

// BS-error fixture: unclosed markup tag triggers E-CTX-003.
// BS now returns errors[] instead of throwing, so api.js must call
// collectErrors("BS", result.errors) — this test verifies it does.
const BS_ERROR_FILE = join(FIXTURE_DIR, "bs-error.scrml");
const BS_ERROR_SCRML = "<div\n  p \"unclosed div, never closed\"\n";

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURE_FILE, MINIMAL_SCRML);
  writeFileSync(BS_ERROR_FILE, BS_ERROR_SCRML);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §1 Return shape
// ---------------------------------------------------------------------------

describe("compileScrml return shape", () => {
  test("result has required fields", () => {
    const result = compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("fileCount");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("outputs");
    expect(result).toHaveProperty("outputDir");
  });

  test("errors and warnings are arrays", () => {
    const result = compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test("outputs is a Map", () => {
    const result = compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    expect(result.outputs instanceof Map).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 Valid input produces no errors
// ---------------------------------------------------------------------------

describe("compileScrml with valid input", () => {
  test("no errors on minimal valid scrml file", () => {
    const result = compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    // Errors array should be empty for valid input
    expect(result.errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3 outputs keyed by file path
// ---------------------------------------------------------------------------

describe("compileScrml outputs map", () => {
  test("outputs map uses file paths as keys", () => {
    const result = compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    // Map should have at least one entry for the compiled file
    expect(result.outputs.size).toBeGreaterThanOrEqual(1);
    // All keys should be strings
    for (const key of result.outputs.keys()) {
      expect(typeof key).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// §4 durationMs
// ---------------------------------------------------------------------------

describe("compileScrml timing", () => {
  test("durationMs is a non-negative number", () => {
    const result = compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// §5 scanDirectory
// ---------------------------------------------------------------------------

describe("scanDirectory", () => {
  test("finds .scrml files recursively", () => {
    // FIXTURE_DIR already has hello.scrml
    const subDir = join(FIXTURE_DIR, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "other.scrml"), 'p "test"\n');

    const files = scanDirectory(FIXTURE_DIR);

    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.every(f => f.endsWith(".scrml"))).toBe(true);
    // Results should be sorted
    expect([...files].sort()).toEqual(files);
  });

  test("returns empty array for directory with no .scrml files", () => {
    const emptyDir = join(FIXTURE_DIR, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const files = scanDirectory(emptyDir);
    expect(files).toEqual([]);
  });

  // scandir-storm fix (reported by scrml-site, S154): `scrml dev <dir>` walked
  // node_modules / .git / dist and followed `bun link`ed symlinked dep trees,
  // producing a compile-storm. scanDirectory must skip those.
  test("skips node_modules, dist, and dot-dirs", () => {
    for (const skip of ["node_modules", "dist", ".git", ".claude"]) {
      const d = join(FIXTURE_DIR, skip);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "decoy.scrml"), 'p "should not be found"\n');
    }
    const files = scanDirectory(FIXTURE_DIR);
    expect(files.some(f => f.includes("node_modules"))).toBe(false);
    expect(files.some(f => f.includes(`${sep}dist${sep}`))).toBe(false);
    expect(files.some(f => f.includes(`${sep}.git${sep}`))).toBe(false);
    expect(files.some(f => f.includes(`${sep}.claude${sep}`))).toBe(false);
    // Real source still found.
    expect(files.some(f => f.endsWith("hello.scrml"))).toBe(true);
  });

  test("does not follow symlinked directories", () => {
    // A symlinked dir (mimics a `bun link`ed dep) must not be descended. The
    // real target lives OUTSIDE the scanned dir, so the only path to its
    // .scrml is via the symlink — finding it would prove the symlink was
    // followed.
    const realExternal = join(FIXTURE_DIR, "..", "api-test-external");
    mkdirSync(realExternal, { recursive: true });
    writeFileSync(join(realExternal, "external.scrml"), 'p "external"\n');
    const linkPath = join(FIXTURE_DIR, "linked");
    try {
      symlinkSync(resolve(realExternal), linkPath, "dir");
    } catch {
      // Some platforms/CI forbid symlink creation without privilege; the
      // assertion below still holds trivially (no symlink → nothing followed).
    }
    const files = scanDirectory(FIXTURE_DIR);
    expect(files.some(f => f.includes("external.scrml"))).toBe(false);
    rmSync(realExternal, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §6 write:false suppresses disk writes
// ---------------------------------------------------------------------------

describe("compileScrml write:false", () => {
  test("does not write files to disk when write is false", () => {
    const outputDir = join(FIXTURE_DIR, "no-write-dist");

    compileScrml({
      inputFiles: [FIXTURE_FILE],
      outputDir,
      write: false,
    });

    // outputDir should not have been created
    expect(existsSync(outputDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7 BS errors surfaced in result.errors
// ---------------------------------------------------------------------------

describe("compileScrml BS error surfacing", () => {
  test("unclosed markup tag produces a BS-stage error in result.errors", () => {
    const result = compileScrml({
      inputFiles: [BS_ERROR_FILE],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });

    // Must have at least one error
    expect(result.errors.length).toBeGreaterThan(0);

    // At least one error must come from the BS stage
    const bsErrors = result.errors.filter(e => e.stage === "BS");
    expect(bsErrors.length).toBeGreaterThan(0);

    // The error code should be E-CTX-003 (unclosed context at EOF)
    const unclosedError = bsErrors.find(e => e.code === "E-CTX-003");
    expect(unclosedError).toBeDefined();
    expect(typeof unclosedError.message).toBe("string");
    expect(unclosedError.message.length).toBeGreaterThan(0);
  });
});
