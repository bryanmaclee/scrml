/**
 * engine-server-flag-deferred.test.js
 *
 * ss2 item 2 (2026-06-19) — surface the silently-swallowed BARE `server` flag on
 * `<engine>`. `<engine for=T server>` (a standalone `server` flag, NO `=@source`)
 * previously compiled with ZERO diagnostics and emitted JS byte-identical to a plain
 * engine — the flag was parsed-and-DROPPED (a silent no-op of an asserted-valid
 * attribute, worse than an error per `feedback_dont_soft_classify_bugs`).
 *
 * SPEC §51.0.A asserts an engine cell MAY itself be `server`-authoritative (§52
 * Tier 2), but the §52 read/load-INTO-an-engine-cell path (the engine-hydration
 * Approach-F E-leg) is UNBUILT (known-gaps.md:196). The fix is a DEFERRAL WARNING
 * (`W-ENGINE-SERVER-DEFERRED`, severity:"warning") telling the adopter the flag is
 * recognized-but-not-yet-wired, and pointing to the wired alternative `server=@source`
 * (§51.0.E, S199 — the E-leg). The flag stays INERT at codegen until the E-leg lands.
 *
 * Coverage:
 *   §1 Parser — `engineDecl.serverFlagBare === true` for the bare form; `false` +
 *      serverSource set for the `server=@source` E-leg form; both false for a plain engine.
 *   §2 SYM    — bare flag fires W-ENGINE-SERVER-DEFERRED; E-leg / plain do NOT.
 *   §3 Stream partition (feedback_diagnostic_stream_partition, CROSS-STREAM helper) —
 *      the W- code lands in result.warnings (non-fatal); NOT in result.errors; compile
 *      succeeds (no exit-1 → errors empty).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAstFromSource(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs).ast;
}

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return runSYM({ filePath, ast });
}

function findEngineDecl(ast) {
  let found = null;
  function walk(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      if (n.kind === "engine-decl") { if (!found) found = n; return; }
      if (n.children) walk(n.children);
      if (n.body) walk(n.body);
    }
  }
  walk(ast.nodes || []);
  if (!found && ast.machineDecls) {
    for (const m of ast.machineDecls) {
      if (m && m.kind === "engine-decl") { found = m; break; }
    }
  }
  return found;
}

/** SYM-stage codes (runSYM returns a severity-tagged single stream). */
function symCodes(sym) {
  return (sym.errors || []).map((e) => e.code);
}

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "engine-server-deferred-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({
    inputFiles: [fp],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
}

/**
 * CROSS-STREAM helper (feedback_diagnostic_stream_partition): a `W-` code +
 * severity:"warning" partitions to result.warnings — but assert over BOTH streams
 * so a partition regression (the W- code mis-routing to result.errors → CLI exit 1)
 * is CAUGHT, not silently passed.
 */
function deferredDiags(res) {
  return [...(res.errors || []), ...(res.warnings || [])]
    .filter((d) => d.code === "W-ENGINE-SERVER-DEFERRED");
}

// Source shapes -------------------------------------------------------------

const BARE_SERVER = `<program>
type Phase:enum = { Loading, Ready }
<engine for=Phase initial=.Loading server>
  <Loading rule=.Ready : "Loading">
  <Ready rule=.Loading : "Ready">
</>
</program>`;

const E_LEG_SERVER_SOURCE = `<program>
type Phase:enum = { Loading, Ready }
<status> : string = "Ready"
<engine for=Phase server=@status initial=.Loading>
  <Loading rule=.Ready : "Loading">
  <Ready rule=.Loading : "Ready">
</>
</program>`;

const PLAIN_ENGINE = `<program>
type Phase:enum = { Loading, Ready }
<engine for=Phase initial=.Loading>
  <Loading rule=.Ready : "Loading">
  <Ready rule=.Loading : "Ready">
</>
</program>`;

// ---------------------------------------------------------------------------
// §1 — Parser
// ---------------------------------------------------------------------------

describe("§1 parser — bare `server` flag capture (serverFlagBare)", () => {
  test("bare `server` → engineDecl.serverFlagBare === true, serverSource null", () => {
    const eng = findEngineDecl(buildAstFromSource(BARE_SERVER));
    expect(eng).not.toBeNull();
    expect(eng.serverFlagBare).toBe(true);
    expect(eng.serverSource ?? null).toBeNull();
  });

  test("`server=@source` E-leg → serverFlagBare false, serverSource set", () => {
    const eng = findEngineDecl(buildAstFromSource(E_LEG_SERVER_SOURCE));
    expect(eng).not.toBeNull();
    expect(eng.serverFlagBare).toBe(false);
    expect(eng.serverSource).toBe("status");
  });

  test("plain engine (no server) → serverFlagBare false, serverSource null", () => {
    const eng = findEngineDecl(buildAstFromSource(PLAIN_ENGINE));
    expect(eng).not.toBeNull();
    expect(eng.serverFlagBare).toBe(false);
    expect(eng.serverSource ?? null).toBeNull();
  });

  test("attribute-aware: `server` inside a string/`${...}` does NOT trip the flag", () => {
    // A `server` word inside an effect-block body must not be mistaken for the flag.
    const src = `<program>
type Phase:enum = { Loading, Ready }
<engine for=Phase initial=.Loading effect=\${ log("server boot") }>
  <Loading rule=.Ready : "Loading">
  <Ready rule=.Loading : "Ready">
</>
</program>`;
    const eng = findEngineDecl(buildAstFromSource(src));
    expect(eng).not.toBeNull();
    expect(eng.serverFlagBare).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — SYM: W-ENGINE-SERVER-DEFERRED fires only on the bare flag
// ---------------------------------------------------------------------------

describe("§2 SYM — W-ENGINE-SERVER-DEFERRED deferral nudge", () => {
  test("bare `server` flag → W-ENGINE-SERVER-DEFERRED fires", () => {
    expect(symCodes(runUpToSYM(BARE_SERVER))).toContain("W-ENGINE-SERVER-DEFERRED");
  });

  test("`server=@source` (wired E-leg) → does NOT fire W-ENGINE-SERVER-DEFERRED", () => {
    expect(symCodes(runUpToSYM(E_LEG_SERVER_SOURCE))).not.toContain("W-ENGINE-SERVER-DEFERRED");
  });

  test("plain engine (no server) → does NOT fire W-ENGINE-SERVER-DEFERRED", () => {
    expect(symCodes(runUpToSYM(PLAIN_ENGINE))).not.toContain("W-ENGINE-SERVER-DEFERRED");
  });

  test("the deferral diagnostic carries severity:\"warning\" (not error)", () => {
    const sym = runUpToSYM(BARE_SERVER);
    const d = (sym.errors || []).find((e) => e.code === "W-ENGINE-SERVER-DEFERRED");
    expect(d).toBeDefined();
    expect(d.severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// §3 — Full pipeline: stream partition (CROSS-STREAM) + no exit-1
// ---------------------------------------------------------------------------

describe("§3 stream partition — W-ENGINE-SERVER-DEFERRED rides result.warnings", () => {
  test("bare flag: diagnostic present cross-stream, lands in warnings, NOT errors", () => {
    const res = compile(BARE_SERVER);
    // CROSS-STREAM: the diagnostic exists somewhere.
    expect(deferredDiags(res).length).toBe(1);
    // It lands in the NON-FATAL warning stream.
    expect((res.warnings || []).some((w) => w.code === "W-ENGINE-SERVER-DEFERRED")).toBe(true);
    // It does NOT land in the fatal error stream.
    expect((res.errors || []).some((e) => e.code === "W-ENGINE-SERVER-DEFERRED")).toBe(false);
  });

  test("bare flag: compile SUCCEEDS — no error-stream entry (no CLI exit-1)", () => {
    const res = compile(BARE_SERVER);
    expect((res.errors || []).length).toBe(0);
  });

  test("E-leg server=@source: does NOT fire W-ENGINE-SERVER-DEFERRED in either stream", () => {
    const res = compile(E_LEG_SERVER_SOURCE);
    expect(deferredDiags(res).length).toBe(0);
  });

  test("plain engine: does NOT fire W-ENGINE-SERVER-DEFERRED in either stream", () => {
    const res = compile(PLAIN_ENGINE);
    expect(deferredDiags(res).length).toBe(0);
  });
});
