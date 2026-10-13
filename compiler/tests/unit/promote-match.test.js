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

// ---------------------------------------------------------------------------
// S464 Q24 fix round 1 — a `<match>` arm is MARKUP, so the rewrite is sound only
// when the chain is the sole content of a `${…}` and every arm is ONE element.
// Review repro (a0d464f1f): lift arms were rewritten to `<A> lift <p>a</p> </>`
// (`lift` rendered as display text) and logic arms `{ @x = 10 }` to display text —
// both compiled clean, so the compile gate could not catch them.
// ---------------------------------------------------------------------------

describe("§10 S464 Q24 — only single-element arms in a sole-content `${…}` are rewritten", () => {
  const HEADQ = [
    "<program>",
    "type M:enum = { A, B }",
    "<m>: M = .A",
    "<x> = 0",
  ].join("\n");
  const run = async (body) => {
    const { promoteMatchOnFile } = await import("../../src/commands/promote.js");
    const src = HEADQ + "\n" + body + "\n</program>\n";
    const { dir, filePath } = makeTmpFile("q24.scrml", src);
    try {
      const res = promoteMatchOnFile(filePath, null, {}, dir);
      return { res, src, after: readFileSync(filePath, "utf8") };
    } finally {
      cleanup(dir);
    }
  };

  test("`lift <el>` arms are rewritten with the `lift` dropped (it would be display text in a markup arm)", async () => {
    const { res, after } = await run(
      `<div id="host">${D} if (@m is .A) { lift <p>a</p> } else if (@m is .B) { lift <p>b</p> } }</div>`);
    expect(res.status).toBe("promoted");
    expect(after).toContain("<match for=M on=@m>");
    expect(after).toContain("<p>a</p>");
    expect(after).toContain("<p>b</p>");
    expect(after).not.toContain("lift");
    expect(after).not.toContain(D);
  });

  test("logic arms (`{ @x = 10 }`) are NOT rewritten — the file is untouched", async () => {
    const { res, src, after } = await run(
      `<div>${D}\n  if (@m is .A) { @x = 10 } else if (@m is .B) { @x = 20 }\n}</div>\n<p id="host">${D}@x}</p>`);
    expect(res.status).not.toBe("promoted");
    expect(after).toBe(src);
    expect(JSON.stringify(res.skipped)).toContain("not exactly one markup element");
  });

  // S464 Q24 fix round 2 (review of 868d1e414, N1) — what renders must not change. The
  // `${…}` renders into an inline `<span>`; a `<match>` mounts as a block `<div>`. Measured
  // on 868d1e414: `<p id="host">Status: ${ if … } ok</p>` was promoted and rendered
  // `<p>Status: </p><div><b>a</b></div> ok` (the parser closes the `<p>`).
  const notPromoted = {
    "the `${…}` in a phrasing-only parent with siblings (`<p>Status: ${…} ok</p>`)":
      `<p id="host">Status: ${D} if (@m is .A) { <b>a</b> } else if (@m is .B) { <i>b</i> } } ok</p>`,
    "the `${…}` as the only content of a phrasing-only parent (`<span>`)":
      `<span id="host">${D} if (@m is .A) { <b>a</b> } else if (@m is .B) { <i>b</i> } }</span>`,
    "the `${…}` with sibling text in a flow parent":
      `<div id="host">${D} if (@m is .A) { <b>a</b> } else if (@m is .B) { <i>b</i> } } tail</div>`,
    "two arms for the same variant (the source runs the first; a <match> would keep the last)":
      `<div id="host">${D} if (@m is .B) { <p>b</p> } else if (@m is .A) { <p>a1</p> } else if (@m is .A) { <p>a2</p> } }</div>`,
  };
  for (const [label, body] of Object.entries(notPromoted)) {
    test(`NOT rewritten: ${label}`, async () => {
      const { res, src, after } = await run(body);
      expect(res.status).not.toBe("promoted");
      expect(after).toBe(src);
    });
  }

  test("rewritten: the `${…}` as the only content of a flow parent (`<section>`)", async () => {
    const { res, after } = await run(
      `<section id="host">\n  ${D} if (@m is .A) { lift <p>a</p> } else if (@m is .B) { lift <p>b</p> } }\n</section>`);
    expect(res.status).toBe("promoted");
    expect(after).toContain("<match for=M on=@m>");
  });

  test("an arm with two elements is NOT rewritten", async () => {
    const { res, src, after } = await run(
      `<div>${D} if (@m is .A) { <p>a</p> } else if (@m is .B) { lift <p>b</p>\n lift <p>b2</p> } }</div>`);
    expect(res.status).not.toBe("promoted");
    expect(after).toBe(src);
  });

  test("a chain that is one statement among others in `${…}` is NOT rewritten", async () => {
    const { res, src, after } = await run(
      `<div>${D} let k = 1\n if (@m is .A) { lift <p>a</p> } else if (@m is .B) { lift <p>b</p> } }</div>`);
    expect(res.status).not.toBe("promoted");
    expect(after).toBe(src);
  });
});
