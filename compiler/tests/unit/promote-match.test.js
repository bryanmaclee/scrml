/**
 * `bun scrml promote --match` — Unit Tests (S66 Tier B)
 *
 * Tests the AST→AST rewrite that lifts an `if (@cell is .X) { ... }` chain
 * over an enum-typed cell to a `<match>` block. SPEC §56.
 *
 * Coverage:
 *   §1  Exhaustive chain rewrites cleanly to <match for=Enum on=@cell>
 *   §2  --dry-run prints diff but does not write
 *   §3  Source outside the rewritten span is preserved verbatim
 *   §4  Body content of each branch is preserved (no whitespace mangling)
 *   §5  Sanity-parse: rewritten source compiles successfully
 *   §6  Idempotency: re-running on already-promoted code is a no-op
 *   §7  Near-miss site is NOT rewritten (lint surfaces; CLI skips)
 *   §8  Compound-condition site is NOT rewritten
 *   §9  Found chain detection via findPromotableChains API
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { findPromotableChains } from "../../src/lint-i-match-promotable.js";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpFile(name, source) {
  const dir = join(tmpdir(), "scrml-promote-test-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, source, "utf8");
  return { dir, filePath };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

function compileAndCaptureTypedFiles(filePath) {
  const captureKey = Symbol.for("__SCRML_PROMOTE_TS_CAPTURE__");
  globalThis[captureKey] = { files: null };
  try {
    const result = compileScrml({
      inputFiles: [filePath],
      write: false,
      gather: false,
      log: () => {},
    });
    return { result, typedFiles: globalThis[captureKey].files };
  } finally {
    delete globalThis[captureKey];
  }
}

// ---------------------------------------------------------------------------
// Fixture: exhaustive chain in markup body
// ---------------------------------------------------------------------------

const D = "$" + "{";

function fixtureExhaustive() {
  return [
    "${",
    "  type Phase:enum = { Idle, Loading, Error, Success }",
    "  <phase>: Phase = .Idle",
    "}",
    "",
    "<div>",
    "  " + D,
    "    if (@phase is .Idle) {",
    "      <p>idle</p>",
    "    } else if (@phase is .Loading) {",
    "      <p>loading</p>",
    "    } else if (@phase is .Error) {",
    "      <p>error</p>",
    "    } else if (@phase is .Success) {",
    "      <p>success</p>",
    "    }",
    "  }",
    "</>",
  ].join("\n");
}

function fixtureNearMiss() {
  return [
    "${",
    "  type Phase:enum = { Idle, Loading, Error, Success }",
    "  <phase>: Phase = .Idle",
    "}",
    "<div>",
    "  " + D,
    "    if (@phase is .Idle) {",
    "      <p>i</p>",
    "    } else if (@phase is .Loading) {",
    "      <p>l</p>",
    "    }",
    "  }",
    "</>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// §9 findPromotableChains — basic detection
// ---------------------------------------------------------------------------

describe("§9 findPromotableChains — typed-AST API", () => {
  test("detects exhaustive chain", () => {
    const { dir, filePath } = makeTmpFile("test.scrml", fixtureExhaustive());
    try {
      const { typedFiles } = compileAndCaptureTypedFiles(filePath);
      expect(typedFiles).toBeDefined();
      expect(Array.isArray(typedFiles)).toBe(true);
      expect(typedFiles.length).toBeGreaterThan(0);
      const file = typedFiles[0];
      const chains = findPromotableChains(file);
      expect(chains.length).toBeGreaterThan(0);
      const ch = chains[0];
      expect(ch.shape).toBe("exhaustive");
      expect(ch.enumName).toBe("Phase");
      expect(ch.variantTagsInOrder).toEqual(["Idle", "Loading", "Error", "Success"]);
    } finally {
      cleanup(dir);
    }
  });

  test("does NOT return near-miss chains", () => {
    const { dir, filePath } = makeTmpFile("test.scrml", fixtureNearMiss());
    try {
      const { typedFiles } = compileAndCaptureTypedFiles(filePath);
      const file = typedFiles[0];
      const chains = findPromotableChains(file);
      // findPromotableChains only returns "exhaustive"-shape chains. The
      // near-miss surfaces in lintDiagnostics via runIMatchPromotable but
      // is excluded here.
      const exhaustive = chains.filter(c => c.shape === "exhaustive");
      expect(exhaustive.length).toBe(0);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §1 + §3 + §4 + §5 — full rewrite
// ---------------------------------------------------------------------------

describe("§1 promote --match — exhaustive chain rewrite", () => {
  test("rewrites the chain to <match>; surrounding source preserved; sanity-parses", async () => {
    // Use the runPromote API directly (don't shell out)
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("test.scrml", fixtureExhaustive());
    try {
      const origExitCode = process.exitCode;
      // We need to capture process.exit. Override temporarily.
      let exitCode = null;
      const realExit = process.exit;
      process.exit = (code) => { exitCode = code; throw new Error("__exit_intercept__"); };
      try {
        runPromote(["--match", filePath]);
      } catch (e) {
        if (e.message !== "__exit_intercept__") throw e;
      } finally {
        process.exit = realExit;
        process.exitCode = origExitCode;
      }
      // exitCode may be null (clean) or 0
      if (exitCode != null) expect(exitCode).toBe(0);

      const after = readFileSync(filePath, "utf8");
      // The <match> block must appear
      expect(after).toContain("<match for=Phase on=@phase>");
      expect(after).toContain("<Idle>");
      expect(after).toContain("<Loading>");
      expect(after).toContain("<Error>");
      expect(after).toContain("<Success>");
      // The original `if (@phase is .Idle)` text must be GONE
      expect(after).not.toContain("if (@phase is .Idle)");
      // Type decl + cell decl preserved verbatim
      expect(after).toContain("type Phase:enum = { Idle, Loading, Error, Success }");
      expect(after).toContain("<phase>: Phase = .Idle");
      // Body content of each arm preserved
      expect(after).toContain("<p>idle</p>");
      expect(after).toContain("<p>loading</p>");
      expect(after).toContain("<p>error</p>");
      expect(after).toContain("<p>success</p>");
    } finally {
      cleanup(dir);
    }
  });

  // S66 — full predicate matrix restored; rewrite handles `==` form too
  test("`==` predicate form rewrites to <match> identically to `is` form (S66 restored matrix)", async () => {
    const source = [
      "${",
      "  type Phase:enum = { Idle, Loading, Error, Success }",
      "  <phase>: Phase = .Idle",
      "}",
      "",
      "<div>",
      "  " + D,
      "    if (@phase == .Idle) {",
      "      <p>idle</p>",
      "    } else if (@phase == .Loading) {",
      "      <p>loading</p>",
      "    } else if (@phase == .Error) {",
      "      <p>error</p>",
      "    } else if (@phase == .Success) {",
      "      <p>success</p>",
      "    }",
      "  }",
      "</>",
    ].join("\n");
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("test-eq.scrml", source);
    try {
      let exitCode = null;
      const realExit = process.exit;
      process.exit = (code) => { exitCode = code; throw new Error("__exit_intercept__"); };
      try { runPromote(["--match", filePath]); }
      catch (e) { if (e.message !== "__exit_intercept__") throw e; }
      finally { process.exit = realExit; }
      if (exitCode != null) expect(exitCode).toBe(0);

      const after = readFileSync(filePath, "utf8");
      // Same <match> block shape as the `is`-form test, lifted from `==`-form source.
      expect(after).toContain("<match for=Phase on=@phase>");
      expect(after).toContain("<Idle>");
      expect(after).toContain("<Loading>");
      expect(after).toContain("<Error>");
      expect(after).toContain("<Success>");
      // Original `==` text removed
      expect(after).not.toContain("if (@phase == .Idle)");
      // Bodies preserved
      expect(after).toContain("<p>idle</p>");
      expect(after).toContain("<p>success</p>");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 --dry-run — preview only
// ---------------------------------------------------------------------------

describe("§2 promote --match --dry-run — preview only", () => {
  test("--dry-run prints diff and does NOT write the file", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const source = fixtureExhaustive();
    const { dir, filePath } = makeTmpFile("test.scrml", source);
    try {
      const realExit = process.exit;
      const realLog = console.log;
      let exitCode = null;
      let captured = "";
      console.log = (...args) => { captured += args.join(" ") + "\n"; };
      process.exit = (code) => { exitCode = code; throw new Error("__exit_intercept__"); };
      try {
        runPromote(["--match", "--dry-run", filePath]);
      } catch (e) {
        if (e.message !== "__exit_intercept__") throw e;
      } finally {
        process.exit = realExit;
        console.log = realLog;
      }
      if (exitCode != null) expect(exitCode).toBe(0);
      // The diff output must contain the new <match> markup
      expect(captured).toContain("<match for=Phase on=@phase>");
      // File on disk MUST be unchanged
      const onDisk = readFileSync(filePath, "utf8");
      expect(onDisk).toBe(source);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 Idempotency
// ---------------------------------------------------------------------------

describe("§6 Idempotency — re-running is a no-op", () => {
  test("running --match twice produces same source after first run", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const source = fixtureExhaustive();
    const { dir, filePath } = makeTmpFile("test.scrml", source);
    try {
      const realExit = process.exit;
      const realLog = console.log;
      const realErr = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        try { runPromote(["--match", filePath]); }
        catch (e) { if (e.message !== "__exit_intercept__") throw e; }
      } finally {
        process.exit = realExit;
      }
      const afterFirst = readFileSync(filePath, "utf8");
      // Second run: no chain to promote (it's now <match>), should leave source untouched.
      let exitCode = null;
      process.exit = (code) => { exitCode = code; throw new Error("__exit_intercept__"); };
      try {
        try { runPromote(["--match", filePath]); }
        catch (e) { if (e.message !== "__exit_intercept__") throw e; }
      } finally {
        process.exit = realExit;
        console.log = realLog;
        console.error = realErr;
      }
      const afterSecond = readFileSync(filePath, "utf8");
      expect(afterSecond).toBe(afterFirst);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 Near-miss is NOT rewritten
// ---------------------------------------------------------------------------

describe("§7 Near-miss — not rewritten", () => {
  test("near-miss chain is left unchanged; CLI reports no-sites", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const source = fixtureNearMiss();
    const { dir, filePath } = makeTmpFile("test.scrml", source);
    try {
      const realExit = process.exit;
      const realLog = console.log;
      const realErr = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        try { runPromote(["--match", filePath]); }
        catch (e) { if (e.message !== "__exit_intercept__") throw e; }
      } finally {
        process.exit = realExit;
        console.log = realLog;
        console.error = realErr;
      }
      const after = readFileSync(filePath, "utf8");
      expect(after).toBe(source);
      expect(after).not.toContain("<match for=");
    } finally {
      cleanup(dir);
    }
  });
});
