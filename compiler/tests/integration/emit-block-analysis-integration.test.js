/**
 * Integration test for the block-analysis PER-FILE static sidecar
 * (`--emit-block-analysis` -> `<base>.block-analysis.json`) over REAL compiled
 * .scrml files.
 *
 * This is the D3 R26 empirical-verification anchor (S138 doctrine): the builder
 * + the CLI write-loop run against actual adopter source through the FULL
 * pipeline, NOT a synthesized AST. `_record.engineMeta` (the engine block's
 * span/name source) is a SYM-pass product, so an engine-bearing fixture must go
 * through the real pipeline for its engine blocks to appear at all.
 *
 * THE DIVERGENCE this test guards: unlike `--emit-engine-graph` (which merges
 * all engines across all files into ONE graph written to every sidecar),
 * block-analysis is PER-FILE — each `<base>.block-analysis.json` contains ONLY
 * that source file's blocks. The multi-file distinctness assertions below are
 * the regression guard against a merged-blob mistake.
 *
 * Source under test:
 *   - examples/14-mario-state-machine.scrml — rich single file (3 type decls,
 *     4 functions incl. eatPowerUp with a real read/write footprint, the
 *     MarioState engine + the derived HealthRisk engine). Anchors the
 *     "all kinds + real footprint + engine via SYM pass" content assertions.
 *   - examples/25-triage-board.scrml — a second real engine-bearing file, for
 *     the multi-file per-file-distinctness proof.
 *   - examples/23-trucking-dispatch/pages/dispatch/load-new.scrml — a real
 *     adopter page whose `@loadForm.originCity = ...` / `@loadForm.originState
 *     = ...` writes exercise the BREAK-1 dotted-grain footprint (distinct
 *     fields of one compound cell stay distinct, NOT root-collapsed). Gather
 *     pulls its imports in, so its compile yields MORE analyses than input
 *     files — the exact case that makes the write-loop's identity match (not
 *     order-zip) load-bearing.
 */
import { test, expect, describe } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const CLI = join(REPO_ROOT, "compiler", "src", "cli.js");

const MARIO = join(REPO_ROOT, "examples", "14-mario-state-machine.scrml");
const TRIAGE = join(REPO_ROOT, "examples", "25-triage-board.scrml");
const LOAD_NEW = join(
  REPO_ROOT,
  "examples",
  "23-trucking-dispatch",
  "pages",
  "dispatch",
  "load-new.scrml",
);
// D6 fixture: a page that IMPORTS the driver-events channel and only CALLS its
// `publishDriverEvent` fn (line 163). The channel import inlines the channel's
// fns into the page AST; block discovery must not count them as page blocks.
const MESSAGES = join(
  REPO_ROOT,
  "examples",
  "23-trucking-dispatch",
  "pages",
  "driver",
  "messages.scrml",
);

// In-process: the per-file analyses the api.js accessor surfaces (the same
// objects the CLI write-loop serializes). Returns BlockAnalysis[] (one per
// compiled file — a superset of inputFiles when gather pulls imports).
function analysesFor(...files) {
  const result = compileScrml({ inputFiles: files, write: false });
  expect(result.errors.length).toBe(0);
  expect(typeof result.blockAnalyses).toBe("function");
  return result.blockAnalyses();
}

function analysisForFileEndingWith(analyses, suffix) {
  return analyses.find((a) => a.file.endsWith(suffix));
}

// End-to-end: spawn the REAL CLI binary with `--emit-block-analysis` and read
// the written sidecars back. This is the only path that exercises the flag
// parse + the per-file write-loop + the identity match. Returns a map of
// { <base>: parsedSidecar }.
async function emitAndReadSidecars(inputs, outDir) {
  const proc = Bun.spawn(
    ["bun", CLI, "compile", ...inputs, "--emit-block-analysis", "-o", outDir],
    { stdout: "pipe", stderr: "pipe", cwd: REPO_ROOT },
  );
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  expect(exitCode).toBe(0);
  const sidecars = {};
  for (const f of inputs) {
    const base = basename(f, ".scrml");
    const p = join(outDir, `${base}.block-analysis.json`);
    sidecars[base] = { path: p, exists: existsSync(p) };
    if (sidecars[base].exists) {
      const raw = readFileSync(p, "utf8");
      sidecars[base].raw = raw;
      sidecars[base].json = JSON.parse(raw);
    }
  }
  return { sidecars, stderr };
}

describe("block-analysis content (in-process) over examples/14-mario-state-machine.scrml", () => {
  test("(a) one analysis for the file, with version + file + a non-empty blocks array", () => {
    const [mario] = analysesFor(MARIO);
    expect(mario.version).toBe(1);
    expect(mario.file.endsWith("14-mario-state-machine.scrml")).toBe(true);
    expect(Array.isArray(mario.blocks)).toBe(true);
    expect(mario.blocks.length).toBeGreaterThan(0);
  });

  test("(b) it surfaces all real block kinds — type, function, AND engine (engine via the SYM pass)", () => {
    const [mario] = analysesFor(MARIO);
    const kinds = new Set(mario.blocks.map((b) => b.kind));
    expect(kinds.has("type")).toBe(true);
    expect(kinds.has("function")).toBe(true);
    // The engine block only exists because the full pipeline populated
    // `_record.engineMeta` — a raw AST would have produced none.
    expect(kinds.has("engine")).toBe(true);
    const engine = mario.blocks.find((b) => b.kind === "engine" && b.name === "marioState");
    expect(engine).toBeDefined();
    expect(engine.id).toBe(`${mario.file}::marioState`);
    expect(typeof engine.span.line).toBe("number");
    expect(typeof engine.span.endLine).toBe("number");
  });

  test("(c) a function block carries its id, span lines, and SORTED dotted footprint with no @ prefix", () => {
    const [mario] = analysesFor(MARIO);
    const eat = mario.blocks.find((b) => b.kind === "function" && b.name === "eatPowerUp");
    expect(eat).toBeDefined();
    expect(eat.id).toBe(`${mario.file}::eatPowerUp`);
    expect(eat.span.start).toBeGreaterThan(0);
    expect(eat.span.end).toBeGreaterThan(eat.span.start);
    expect(eat.span.line).toBeGreaterThan(0);
    // reads/writes are sorted, de-duped, and never carry the `@` sigil.
    expect(eat.reads).toEqual([...eat.reads].sort());
    expect(eat.writes).toEqual([...eat.writes].sort());
    for (const p of [...eat.reads, ...eat.writes]) {
      expect(p.startsWith("@")).toBe(false);
    }
    expect(eat.writes).toContain("marioState");
    expect(eat.footprintDepth).toBe("shallow");
  });

  test("(d) blocks are in source order (span.start ascending)", () => {
    const [mario] = analysesFor(MARIO);
    for (let i = 1; i < mario.blocks.length; i++) {
      expect(mario.blocks[i].span.start).toBeGreaterThanOrEqual(mario.blocks[i - 1].span.start);
    }
  });
});

describe("block-analysis dotted-grain footprint (BREAK-1) over real adopter source", () => {
  test("distinct fields of one compound cell stay distinct dotted writes (NOT root-collapsed)", () => {
    const analyses = analysesFor(LOAD_NEW);
    // Gather pulls load-new's imports in, so we get MORE analyses than the one
    // input file — proves order-zip would be wrong and identity match is needed.
    expect(analyses.length).toBeGreaterThan(1);
    const ln = analysisForFileEndingWith(analyses, "load-new.scrml");
    expect(ln).toBeDefined();
    const setOriginCity = ln.blocks.find((b) => b.name === "setOriginCity");
    const setOriginState = ln.blocks.find((b) => b.name === "setOriginState");
    expect(setOriginCity).toBeDefined();
    expect(setOriginState).toBeDefined();
    // The whole point of BREAK-1: these are NOT both `loadForm`.
    expect(setOriginCity.writes).toContain("loadForm.originCity");
    expect(setOriginState.writes).toContain("loadForm.originState");
    expect(setOriginCity.writes).not.toContain("loadForm.originState");
    expect(setOriginState.writes).not.toContain("loadForm.originCity");
  });
});

describe("block-analysis span.endLine derives the REAL multi-line extent (D5 regression)", () => {
  // The D5 bug: the metaFiles-stage builder call passed no source, so `endLine`
  // collapsed to `line` on EVERY block (a 22-line function reported endLine ===
  // line). The pre-D5 test only asserted `endLine` was a number — present, not
  // CORRECT. These assertions bind `endLine` to the RAW source text the span
  // byte-offsets index into, so a re-collapse (or an off-by-one from counting a
  // trailing newline) fails loudly.

  // 1-based line of a byte offset in `src` (newline count before it, + 1).
  function lineOfByte(src, byte) {
    return src.slice(0, byte).split("\n").length;
  }

  test("(f) a known multi-line function reports endLine > line — NEVER collapsed to line", () => {
    const [mario] = analysesFor(MARIO);
    // eatPowerUp is a ~20-line match-bearing function — a hard collapse case.
    const eat = mario.blocks.find((b) => b.kind === "function" && b.name === "eatPowerUp");
    expect(eat).toBeDefined();
    expect(eat.span.endLine).toBeGreaterThan(eat.span.line);
    // It really does span many lines (guard against a 1-line off-by-one passing).
    expect(eat.span.endLine - eat.span.line).toBeGreaterThan(5);
  });

  test("(g) endLine equals the line of the span's LAST byte in the REAL source (exact, off-by-one guard)", () => {
    const [mario] = analysesFor(MARIO);
    const src = readFileSync(MARIO, "utf8");
    // Re-derive endLine independently from the RAW source for EVERY block: the
    // 1-based line of the last content byte (span.end - 1). This is the same
    // text the AST spans index into, so it must match exactly — catches both
    // the collapse (endLine === line) and a trailing-newline off-by-one.
    for (const b of mario.blocks) {
      const expectedEndLine = lineOfByte(src, b.span.end - 1);
      expect(b.span.endLine).toBe(expectedEndLine);
      // And `line` itself must be the line of the first content byte.
      expect(b.span.line).toBe(lineOfByte(src, b.span.start));
    }
  });

  test("(h) the end-to-end sidecar carries the SAME correct multi-line endLine (write-loop parity)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba-emit-endline-"));
    try {
      const { sidecars } = await emitAndReadSidecars([MARIO], join(dir, "dist"));
      const mario = sidecars["14-mario-state-machine"];
      expect(mario.exists).toBe(true);
      const eat = mario.json.blocks.find((b) => b.kind === "function" && b.name === "eatPowerUp");
      expect(eat).toBeDefined();
      expect(eat.span.endLine).toBeGreaterThan(eat.span.line);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("--emit-block-analysis CLI write-loop (end-to-end, real binary)", () => {
  test("(a)+(b) a single engine-bearing file writes a sidecar that parses with ONLY its own blocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba-emit-single-"));
    try {
      const { sidecars } = await emitAndReadSidecars([MARIO], join(dir, "dist"));
      const mario = sidecars["14-mario-state-machine"];
      expect(mario.exists).toBe(true); // (a) written
      expect(mario.json.version).toBe(1); // (b) parses
      expect(mario.json.file.endsWith("14-mario-state-machine.scrml")).toBe(true);
      // (c) every block's id is rooted at THIS file — no other file's blocks.
      for (const b of mario.json.blocks) {
        expect(b.id.startsWith(`${mario.json.file}::`)).toBe(true);
      }
      expect(mario.json.blocks.some((b) => b.kind === "engine" && b.name === "marioState")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(d) a file with no leasable blocks gets an honest-empty blocks:[] sidecar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba-emit-empty-"));
    try {
      // A markup-only file declares no named function/component/engine/type/channel.
      const empty = join(dir, "empty-page.scrml");
      writeFileSync(
        empty,
        `<program title="Empty">\n  <page>\n    <h1>nothing leasable here</h1>\n  </page>\n</program>\n`,
      );
      const { sidecars } = await emitAndReadSidecars([empty], join(dir, "dist"));
      const sc = sidecars["empty-page"];
      expect(sc.exists).toBe(true);
      expect(sc.json.version).toBe(1);
      expect(sc.json.blocks).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(c)+per-file proof: a multi-file compile writes DISTINCT sidecars, each only its own file's blocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba-emit-multi-"));
    try {
      const { sidecars } = await emitAndReadSidecars([MARIO, TRIAGE], join(dir, "dist"));
      const mario = sidecars["14-mario-state-machine"];
      const triage = sidecars["25-triage-board"];
      expect(mario.exists).toBe(true);
      expect(triage.exists).toBe(true);
      // The merged-blob trap: the two sidecars MUST NOT be identical.
      expect(mario.raw).not.toBe(triage.raw);
      expect(mario.json.file).not.toBe(triage.json.file);
      expect(mario.json.file.endsWith("14-mario-state-machine.scrml")).toBe(true);
      expect(triage.json.file.endsWith("25-triage-board.scrml")).toBe(true);
      // Each block belongs to its own file — no cross-contamination.
      for (const b of mario.json.blocks) {
        expect(b.id.startsWith(`${mario.json.file}::`)).toBe(true);
      }
      for (const b of triage.json.blocks) {
        expect(b.id.startsWith(`${triage.json.file}::`)).toBe(true);
      }
      // The DragPhase engine lives in triage's sidecar, NOT mario's.
      const triageHasDragPhase = triage.json.blocks.some(
        (b) => b.kind === "engine" && b.name === "dragPhase",
      );
      const marioHasDragPhase = mario.json.blocks.some(
        (b) => b.kind === "engine" && b.name === "dragPhase",
      );
      expect(triageHasDragPhase).toBe(true);
      expect(marioHasDragPhase).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(e) byte-determinism — two compiles of the same input produce byte-identical sidecars", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "ba-emit-detA-"));
    const dirB = mkdtempSync(join(tmpdir(), "ba-emit-detB-"));
    try {
      const a = await emitAndReadSidecars([MARIO, TRIAGE], join(dirA, "dist"));
      const b = await emitAndReadSidecars([MARIO, TRIAGE], join(dirB, "dist"));
      for (const base of ["14-mario-state-machine", "25-triage-board"]) {
        expect(a.sidecars[base].exists).toBe(true);
        expect(b.sidecars[base].exists).toBe(true);
        expect(a.sidecars[base].raw).toBe(b.sidecars[base].raw);
        // Determinism contract: pretty-printed + trailing newline.
        expect(a.sidecars[base].raw.endsWith("\n")).toBe(true);
      }
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  // D6 (S207 "g-block-analysis-phantom-block", landed ss14): a channel import
  // (`import { "driver-events" as … } from "…/driver-events.scrml"`) inlines the
  // channel's fns into the importing page's AST so the page can CALL them. Those
  // nodes carry the CHANNEL's `span.file`. Block discovery formerly counted them
  // as page blocks → a phantom whose span indexes the wrong source and OVERLAPS a
  // real local block (the block-lease two-holders failure). messages.scrml only
  // CALLS publishDriverEvent (line 163); it must NOT be a block of the page.
  test("(f) D6 — an import-inlined channel fn is NOT a block of the importing page", () => {
    const analyses = analysesFor(MESSAGES);
    const messages = analysisForFileEndingWith(
      analyses,
      "pages/driver/messages.scrml",
    );
    expect(messages).toBeDefined();
    // The phantom guard: publishDriverEvent is DECLARED in the channel, only
    // CALLED here — it must not appear among the page's blocks.
    const names = messages.blocks.map((b) => b.name);
    expect(names).not.toContain("publishDriverEvent");
    // The page's blocks are exactly its 11 locally-declared functions.
    // 10 since S443: the per-page getCurrentUser helper was inlined into its callers
    // (a `?{}` helper compiled to its own public route — a user-lookup oracle).
    expect(messages.blocks.length).toBe(10);
    // The channel's OWN sidecar still declares publishDriverEvent — the fix
    // removes the phantom from the CONSUMER, never the real decl from its owner.
    const channel = analysisForFileEndingWith(
      analyses,
      "channels/driver-events.scrml",
    );
    expect(channel).toBeDefined();
    expect(channel.blocks.some((b) => b.name === "publishDriverEvent")).toBe(true);
  });
});
