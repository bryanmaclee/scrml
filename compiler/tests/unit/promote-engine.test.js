/**
 * `bun scrml promote --engine` — Unit Tests (S210 ruling B build)
 *
 * Tests the Tier-1 → Tier-2 state-machine lift: a `<match for=T on=@cell>`
 * block whose arms accrue inert `rule=` attributes (the W-MATCH-RULE-INERT
 * condition) → `<engine for=T initial=.V0>` where the rules become active
 * transitions. Span-only rewrite (arms carried VERBATIM), fail-closed gate.
 * SPEC §56.6.
 *
 * Coverage map → SPEC §56.6 subsections:
 *   §1  Core rewrite — opener/closer rewritten, arms verbatim (§56.6.1)
 *   §2  initial= default from first arm's variant tag (§56.6.3)
 *   §3  Verbatim arm preservation — rule= / multi-target / payload (§56.6.1.2)
 *   §4  Fail-closed safety gate — name collision + wildcard (§56.6.2)
 *   §5  Idempotency — engine input is a no-op (§56.6.4)
 *   §6  Detector — non-promotable match (no rule= arm) is not a site
 *   §7  CLI surface — runPromote dispatch, --dry-run, --check, --help
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// `${` literal — JS template literals would interpolate, so split.
const D = "$" + "{";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTmpFile(name, source) {
  const dir = join(tmpdir(), "scrml-promote-engine-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, source, "utf8");
  return { dir, filePath };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Count blocking (error-severity) diagnostics from a compile of `filePath`.
function blockingErrorCount(filePath) {
  const r = compileScrml({ inputFiles: [filePath], write: false, gather: true, log: () => {} });
  return (r.errors || []).filter((e) => !e.severity || e.severity === "error").length;
}

// Capture process.exit + console output during a runPromote() call.
function captureRun(runPromote, args) {
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let exitCode = null;
  let stdout = "";
  let stderr = "";
  process.exit = (code) => {
    exitCode = code;
    throw new Error("__exit_intercept__");
  };
  console.log = (...a) => { stdout += a.join(" ") + "\n"; };
  console.error = (...a) => { stderr += a.join(" ") + "\n"; };
  try {
    try { runPromote(args); }
    catch (e) { if (e.message !== "__exit_intercept__") throw e; }
  } finally {
    process.exit = realExit;
    console.log = realLog;
    console.error = realErr;
  }
  return { exitCode, stdout, stderr };
}

// A canonical promotable match: 3-variant enum, arms accrue rule=, on=@status
// references a DISTINCT cell so the engine's auto-declared @phase does not
// collide (the clean-promote shape — see §4 for the same-name revert case).
const PROMOTABLE_MATCH = `<program>
type Phase:enum = { Idle, Loading, Ready }

<status>: Phase = .Idle

<match for=Phase on=@status>
    <Idle rule=.Loading>
        <p>idle</p>
    </>
    <Loading rule=.Ready>
        <p>loading</p>
    </>
    <Ready>
        <p>ready</p>
    </>
</match>

<p>cur: ${D}@status.variant}</p>
</program>`;

// ---------------------------------------------------------------------------
// §1 — Core rewrite (§56.6.1)
// ---------------------------------------------------------------------------

describe("§1 Core rewrite — §56.6.1", () => {
  test("lifts <match for=T on=@cell> → <engine for=T initial=.V0> and compiles clean", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("core.scrml", PROMOTABLE_MATCH);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      expect(r.count).toBe(1);
      const after = readFileSync(filePath, "utf8");
      // Opener rewritten; on=@cell dropped; initial= synthesized.
      expect(after).toContain("<engine for=Phase initial=.Idle>");
      expect(after).not.toContain("<match");
      expect(after).not.toContain("on=@status");
      // Closer rewritten to engine block-form.
      expect(after).toContain("</>");
      expect(after).not.toContain("</match>");
      // The "promoted" status implies sanityCheckParse passed — re-assert.
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test("source outside the match-block span is preserved verbatim", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("preserve.scrml", PROMOTABLE_MATCH);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // The type decl, the separate cell, and the trailing <p> survive verbatim.
      expect(after).toContain("type Phase:enum = { Idle, Loading, Ready }");
      expect(after).toContain("<status>: Phase = .Idle");
      expect(after).toContain("<p>cur: " + D + "@status.variant}</p>");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — initial= default from first arm (§56.6.3)
// ---------------------------------------------------------------------------

describe("§2 initial= default — §56.6.3", () => {
  test("initial= is the FIRST arm's variant tag, not a later one", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<status>: Phase = .Idle

<match for=Phase on=@status>
    <Loading rule=.Ready>
        <p>loading</p>
    </>
    <Idle rule=.Loading>
        <p>idle</p>
    </>
    <Ready>
        <p>ready</p>
    </>
</match>

<p>${D}@status.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("first.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // First arm is <Loading>, so initial=.Loading.
      expect(after).toContain("<engine for=Phase initial=.Loading>");
    } finally {
      cleanup(dir);
    }
  });

  test("single-arm match (1-variant enum, self-loop rule) promotes", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Only:enum = { Solo }

<o>: Only = .Solo

<match for=Only on=@o>
    <Solo rule=.Solo>
        <p>solo</p>
    </>
</match>

<p>${D}@o.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("single.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<engine for=Only initial=.Solo>");
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — Verbatim arm preservation (§56.6.1 rule 2)
// ---------------------------------------------------------------------------

describe("§3 Verbatim arm preservation — §56.6.1", () => {
  test("multi-target rule=(.A | .B) is carried forward verbatim", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<status>: Phase = .Idle

<match for=Phase on=@status>
    <Idle rule=(.Loading | .Ready)>
        <p>idle</p>
    </>
    <Loading rule=.Ready>
        <p>loading</p>
    </>
    <Ready rule=.Idle>
        <p>ready</p>
    </>
</match>

<p>${D}@status.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("mt.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<Idle rule=(.Loading | .Ready)>");
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test("parenthesized payload binding (§51.0.B.1) is carried forward verbatim", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type BracketStack:enum = {
    Balanced,
    OpenAt(depth: int, opener: int, line: int)
}

<bs>: BracketStack = .Balanced

<match for=BracketStack on=@bs>
    <Balanced rule=.OpenAt>
        <p>balanced</p>
    </>
    <OpenAt(depth, opener, line) rule=(.Balanced | .OpenAt)>
        <p>Depth: ${D}depth}</p>
    </>
</match>

<p>${D}@bs.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("paren.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<OpenAt(depth, opener, line) rule=(.Balanced | .OpenAt)>");
      expect(after).toContain("<engine for=BracketStack initial=.Balanced>");
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test("bare-attribute payload binding (§51.0.B.1) is carried forward verbatim", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Book:enum = {
    Idle,
    Loaded(title: string, author: string, count: int)
}

<shelf>: Book = .Idle

<match for=Book on=@shelf>
    <Idle rule=.Loaded>
        <p>idle</p>
    </>
    <Loaded title author count rule=.Idle>
        <h2>${D}title}</h2>
    </>
</match>

<p>${D}@shelf.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("bare.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<Loaded title author count rule=.Idle>");
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — Fail-closed safety gate (§56.6.2)
// ---------------------------------------------------------------------------

describe("§4 Fail-closed safety gate — §56.6.2", () => {
  // g-promote-engine-same-named-cell-no-lift: the idiomatic `<phase>: Phase` +
  // `<match for=Phase on=@phase>` shape. Before the fix the surviving same-named
  // decl collided with the engine's auto-declared cell → E-ENGINE-VAR-DUPLICATE
  // → the gate REVERTED and `--engine` silently did nothing. Now the redundant
  // decl is lifted in the same pass so the promotion lands.
  test("same-named cell (on=@phase == type-derived) LIFTS the redundant decl and promotes clean", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<phase>: Phase = .Idle

<match for=Phase on=@phase>
    <Idle rule=.Loading>
        <p>idle</p>
    </>
    <Loading rule=.Ready>
        <p>loading</p>
    </>
    <Ready>
        <p>ready</p>
    </>
</match>

<p>cur: ${D}@phase.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("samename.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      expect(r.count).toBe(1);
      const after = readFileSync(filePath, "utf8");
      // Engine emitted; the redundant same-named `<phase>` decl is GONE.
      expect(after).toContain("<engine for=Phase initial=.Idle>");
      expect(after).not.toContain("<phase>: Phase = .Idle");
      expect(after).not.toContain("<match");
      // A downstream `@phase` read still resolves (engine owns the cell now).
      expect(after).toContain("cur: " + D + "@phase.variant}");
      // Promotion implies sanityCheckParse passed — re-assert it compiles.
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  // The lifted decl carries the TRUE initial state. When the cell's declared
  // initial differs from the first arm, `initial=` must follow the DECL (.Ready)
  // — never the first-arm default (.Idle) — or the promotion silently changes
  // the machine's starting state.
  test("lifted decl seeds initial= from the cell's declared value, not the first arm", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<phase>: Phase = .Ready

<match for=Phase on=@phase>
    <Idle rule=.Loading>
        <p>idle</p>
    </>
    <Loading rule=.Ready>
        <p>loading</p>
    </>
    <Ready>
        <p>ready</p>
    </>
</match>
</program>`;
    const { dir, filePath } = makeTmpFile("samename-differ.scrml", src);
    try {
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // initial= follows the DECL (.Ready), not the first arm (.Idle).
      expect(after).toContain("<engine for=Phase initial=.Ready>");
      expect(after).not.toContain("initial=.Idle");
      expect(after).not.toContain("<phase>");
      expect(blockingErrorCount(filePath)).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  // Idempotency of the lift path: the lifted output has no match-block AND no
  // surviving same-named decl, so a second pass finds nothing to do.
  test("re-running after a same-named lift is a no-op", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<phase>: Phase = .Idle

<match for=Phase on=@phase>
    <Idle rule=.Loading></>
    <Loading rule=.Ready></>
    <Ready></>
</match>
</program>`;
    const { dir, filePath } = makeTmpFile("samename-idem.scrml", src);
    try {
      const r1 = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r1.status).toBe("promoted");
      const r2 = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r2.status).toBe("no-sites");
    } finally {
      cleanup(dir);
    }
  });

  test("wildcard-only exhaustiveness reverts via E-ENGINE-STATE-CHILD-MISSING", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<status>: Phase = .Idle

<match for=Phase on=@status>
    <Idle rule=.Loading>
        <p>idle</p>
    </>
    <_>
        <p>other</p>
    </>
</match>

<p>${D}@status.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("wild.scrml", src);
    try {
      const before = readFileSync(filePath, "utf8");
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("failed");
      expect(r.reason).toContain("E-ENGINE-STATE-CHILD-MISSING");
      // File left UNTOUCHED — still a <match>.
      expect(readFileSync(filePath, "utf8")).toBe(before);
      expect(readFileSync(filePath, "utf8")).toContain("<match");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — Idempotency (§56.6.4)
// ---------------------------------------------------------------------------

describe("§5 Idempotency — §56.6.4", () => {
  test("re-running on an <engine> reports no-sites (detector finds only match-block)", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<engine for=Phase initial=.Idle>
    <Idle rule=.Loading></>
    <Loading rule=.Ready></>
    <Ready></>
</>

<p>${D}@phase.variant}</p>
</program>`;
    const { dir, filePath } = makeTmpFile("already-engine.scrml", src);
    try {
      const before = readFileSync(filePath, "utf8");
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("no-sites");
      expect(readFileSync(filePath, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  test("promote, then re-promote the output → second pass is no-sites", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("twice.scrml", PROMOTABLE_MATCH);
    try {
      const r1 = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r1.status).toBe("promoted");
      const r2 = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r2.status).toBe("no-sites");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Detector (non-promotable match)
// ---------------------------------------------------------------------------

describe("§6 Detector — non-promotable match", () => {
  test("a <match> with NO rule= arm is not a promotable site (no-sites)", async () => {
    const { promoteEngineOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Phase:enum = { Idle, Loading, Ready }

<status>: Phase = .Idle

<match for=Phase on=@status>
    <Idle>
        <p>idle</p>
    </>
    <Loading>
        <p>loading</p>
    </>
    <Ready>
        <p>ready</p>
    </>
</match>
</program>`;
    const { dir, filePath } = makeTmpFile("norule.scrml", src);
    try {
      const before = readFileSync(filePath, "utf8");
      const r = promoteEngineOnFile(filePath, null, { dryRun: false, check: false }, dir);
      expect(r.status).toBe("no-sites");
      expect(readFileSync(filePath, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — CLI surface (runPromote)
// ---------------------------------------------------------------------------

describe("§7 CLI surface — runPromote dispatch", () => {
  test("--engine no longer prints the Tier-C 'pending' stub", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("cli.scrml", PROMOTABLE_MATCH);
    try {
      const { stdout, stderr } = captureRun(runPromote, ["--engine", filePath]);
      const all = stdout + stderr;
      expect(all).not.toContain("implementation pending");
      expect(all).not.toContain("Tier C");
      expect(all).toContain("promoted");
    } finally {
      cleanup(dir);
    }
  });

  test("--dry-run prints a diff and writes nothing", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("dry.scrml", PROMOTABLE_MATCH);
    try {
      const before = readFileSync(filePath, "utf8");
      const { stdout } = captureRun(runPromote, ["--engine", "--dry-run", filePath]);
      expect(stdout).toContain("<engine for=Phase initial=.Idle>");
      expect(stdout).toContain("<match for=Phase on=@status>");
      // Nothing written.
      expect(readFileSync(filePath, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  test("--check exits 1 when a site would promote, writes nothing", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("check.scrml", PROMOTABLE_MATCH);
    try {
      const before = readFileSync(filePath, "utf8");
      const { exitCode } = captureRun(runPromote, ["--engine", "--check", filePath]);
      expect(exitCode).toBe(1);
      expect(readFileSync(filePath, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  test("--help lists --engine without 'pending' / 'Tier C deferred'", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { stdout } = captureRun(runPromote, ["--help"]);
    expect(stdout).toContain("--engine");
    expect(stdout).not.toContain("pending");
    expect(stdout).not.toContain("Tier C");
  });
});
