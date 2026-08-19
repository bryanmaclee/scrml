/**
 * Client-runtime size RATCHET — no-regression gate on the shape that ships.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * Before this file, `v0-3-x-spa-tree-shake-phase-b.test.js:145` was the ONLY
 * gzip assertion in the entire test tree. It measures `SPA_COUNTER` — a
 * five-line counter button with no `<program>`, no `<outlet/>`, no routes,
 * no engine and no SSR — and its own comment admits that fixture "assembles
 * fewer chunks". So the one size gate we had could not go red for the shape
 * anyone actually deploys. Measured at `36ed3d05`:
 *
 *     shape                                raw        gzip -9    vs 16,384
 *     SPA_COUNTER (the gated fixture)      54,773 B   15,495 B   0.95x  PASS
 *     <program> + <outlet/>, four lines    82,744 B   26,012 B   1.59x  +9,628 B
 *
 * The ruling (S352): keep the counter assertion as-is, and add a
 * NO-REGRESSION RATCHET on an outlet-bearing shell, pinned at today's bytes.
 * 16,384 B stays on the books as an ASPIRATION for the counter shape — it is
 * NOT a gate on the shell shape, because a gate that is red from its first
 * commit for reasons no change caused gets bypassed and then deleted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A RATCHET IS
 * ─────────────────────────────────────────────────────────────────────────
 * The ceiling below is a high-water mark, not a budget. It may be LOWERED
 * freely and at any time — that is the point of a ratchet, and lowering it
 * after a win is encouraged. It may NOT be raised without an explicit
 * operator ruling. If a change needs the bytes, that is a conversation to
 * have, not a constant to bump.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE COMPRESSOR IS PINNED (and why there is a band)
 * ─────────────────────────────────────────────────────────────────────────
 * gzip output size is implementation- and setting-dependent. Measured on the
 * SAME runtime bytes for the shell fixture at `36ed3d05`:
 *
 *     cli `gzip -9` on a file named scrml-runtime.00qpgjuj.js   26,012 B
 *     cli `gzip -9` from stdin (no FNAME header)                25,986 B
 *     cli `gzip -6` from stdin                                  26,019 B
 *     node/bun zlib gzipSync(bytes, { level: 9 })               26,080 B
 *     node/bun zlib gzipSync(bytes)   [library default]         26,221 B
 *                                                     full range: 235 B
 *
 * Three independent axes hide in that 235 B:
 *
 *   1. FNAME header — 26 B. `gzip <file>` stores the original filename in
 *      the gzip header (name + NUL). scrml runtime filenames are 25-char
 *      content hashes, so the CLI figure carries 26 B that are not code.
 *   2. Compression level — 141 B between the zlib library default and
 *      level 9. A bun upgrade could change that default under us.
 *   3. Implementation — 94 B between node/bun's zlib and GNU gzip 1.12 at
 *      the same level 9.
 *
 * This file closes axes 1 and 2 outright: it gzips an in-memory Buffer (so
 * no FNAME field can exist) at an EXPLICIT level (so the library default is
 * irrelevant). Axis 3 is the only one left open, and the band covers it —
 * see RUNTIME_GZIP_TOLERANCE_BAND below.
 *
 * The compile itself contributes no noise: five recompiles from five
 * distinct temp dirs produce byte-identical runtimes, and gzipSync at a
 * pinned level returns one size across twenty calls.
 *
 * Related: `docs/known-gaps.md` → `g-spa-runtime-gzip-budget-knife-edge`,
 * and `docs/changes/runtime-size-ratchet/progress.md` for the raw probes.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gzipSync } from "zlib";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// The pinned compressor — single source of truth
// ---------------------------------------------------------------------------

/**
 * Explicit gzip level. NOT the zlib library default: the default is a moving
 * target across runtime upgrades and is worth 141 B on this artifact.
 * Changing this number invalidates every ceiling in this file.
 */
const RUNTIME_GZIP_LEVEL = 9;

/**
 * The one place the runtime gets compressed. Takes a Buffer, never a path —
 * compressing a file would fold the 25-char content-hashed filename into the
 * gzip FNAME header and add 26 B of non-code to the measurement.
 */
function gzipSize(bytes) {
  return gzipSync(bytes, { level: RUNTIME_GZIP_LEVEL }).length;
}

// ---------------------------------------------------------------------------
// The ratchet constants — single source of truth
// ---------------------------------------------------------------------------

/**
 * Tolerance band, in bytes. 188 B = 2 x the largest measured
 * cross-implementation delta (94 B, node/bun zlib vs GNU gzip 1.12, both at
 * level 9, on the shell runtime; the counter runtime gave 93 B).
 *
 * After pinning the level and avoiding the FNAME header, the ONLY remaining
 * source of variance is which zlib implementation the JS runtime links.
 * The one alternative available when this was measured differs by 94 B and
 * does so in the FAVOURABLE direction (it compresses better). Doubling that
 * covers an equal-magnitude drift in the unfavourable direction with 100%
 * headroom. It is a measured multiple, not a round number.
 *
 * The cost, stated plainly: a change that adds under 188 B gzip (0.72% of
 * the current artifact) passes silently. That is the price of not shipping
 * a gate that can redden for free. Anything that is actually a regression
 * is far larger — see the §2 bite proof.
 */
const RUNTIME_GZIP_TOLERANCE_BAND = 188;

/**
 * ⚑ RATCHET — the shell-shape ceiling, in gzip bytes at RUNTIME_GZIP_LEVEL.
 *
 * ⚑ THIS NUMBER MAY ONLY EVER BE LOWERED. Raising it requires an explicit
 *   operator ruling, recorded in `docs/known-gaps.md`. Do not bump it to
 *   make a red build green.
 *
 * Measured 26,080 B at `36ed3d05` on 2026-08-19, plus the 188 B band.
 *
 * ⚑ ASPIRATION, recorded so the next reader sees a decision and not an
 *   oversight: 16,384 B (16 KB) is the aspirational gzip budget for the
 *   client runtime, and it is asserted for real — as a `<` gate — on the
 *   COUNTER shape at `v0-3-x-spa-tree-shake-phase-b.test.js:145`, where it
 *   passes at 15,495 B (`gzip -9`) / 15,562 B (this file's pinned
 *   compressor). The SHELL shape does NOT meet it and never has: 26,080 B
 *   is 1.59x the aspiration, 9,696 B over. That gap is deliberate, known,
 *   and tracked; it is not something this ratchet is trying to hide. The
 *   ratchet's job is to stop the gap WIDENING while the aspiration is
 *   worked toward.
 */
const SHELL_RUNTIME_GZIP_CEILING = 26080 + RUNTIME_GZIP_TOLERANCE_BAND; // 26,268 B

/** The counter shape's aspiration, for the §3 cross-check. Not a ratchet. */
const COUNTER_RUNTIME_GZIP_ASPIRATION = 16 * 1024;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The shape that ships: a `<program>` shell with an `<outlet/>`. Verbatim
 * from `conformance/cases/outlet/recognized-clean/case.scrml`. This is the
 * minimum shape that assembles the soft-nav engine chunk — which is exactly
 * the chunk `SPA_COUNTER` never pulls in.
 */
const SPA_SHELL = `<program>
  <h1>App shell</h1>
  <outlet/>
</program>
`;

/**
 * The shape the pre-existing 16 KB gate measures. Verbatim from
 * `v0-3-x-spa-tree-shake-phase-b.test.js`. Kept here so §3 can state the
 * two shapes' sizes side by side under ONE pinned compressor.
 */
const SPA_COUNTER = `<count> = 0

<button onclick={ @count = @count + 1 }>
  count is \${@count}
</button>
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "runtime-size-ratchet-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

/** Compile one source to disk and hand back the assembled shared runtime. */
function compileAndReadRuntime(source) {
  const inputDir = mkdtempSync(join(TMP, "in-"));
  const outDir = join(inputDir, "dist");
  const filePath = join(inputDir, "app.scrml");
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  expect(result.errors.length).toBe(0);
  expect(result.runtimeFilename).toBeTruthy();
  return readFileSync(join(outDir, result.runtimeFilename));
}

// ---------------------------------------------------------------------------
// §1 — the ratchet
// ---------------------------------------------------------------------------

describe("§1 client-runtime size ratchet (outlet-bearing shell)", () => {
  test("the assembled shell runtime does not exceed the recorded ceiling", () => {
    const runtimeBytes = compileAndReadRuntime(SPA_SHELL);
    const gzipped = gzipSize(runtimeBytes);

    // A bare toBeLessThanOrEqual prints "expected 26400 to be <= 26268" and
    // says nothing about what to do next. Fail through a message that does.
    if (gzipped > SHELL_RUNTIME_GZIP_CEILING) {
      throw new Error(
        [
          "CLIENT-RUNTIME SIZE REGRESSION — outlet-bearing shell shape.",
          "",
          `  measured : ${gzipped} B gzip (level ${RUNTIME_GZIP_LEVEL}), ${runtimeBytes.length} B raw`,
          `  ceiling  : ${SHELL_RUNTIME_GZIP_CEILING} B  (26,080 recorded + ${RUNTIME_GZIP_TOLERANCE_BAND} B band)`,
          `  over by  : ${gzipped - SHELL_RUNTIME_GZIP_CEILING} B`,
          "",
          "SHELL_RUNTIME_GZIP_CEILING is a RATCHET. It may be LOWERED freely.",
          "It may NOT be raised without an explicit operator ruling. If your",
          "change genuinely needs these bytes, that is the conversation to",
          "have — do not bump the constant to make this green.",
          "",
          "The band already absorbs every compressor difference measured on",
          "this artifact (235 B across all levels and implementations), so a",
          "failure here is code, not compression.",
        ].join("\n"),
      );
    }

    expect(gzipped).toBeLessThanOrEqual(SHELL_RUNTIME_GZIP_CEILING);
  });

  test("the shell runtime is measured, not silently absent", () => {
    // Guards the failure mode where the ratchet passes because it is
    // measuring nothing — an empty or truncated runtime would sail under
    // any ceiling. The shell must assemble a substantial runtime and must
    // parse as JS.
    const runtimeBytes = compileAndReadRuntime(SPA_SHELL);
    expect(runtimeBytes.length).toBeGreaterThan(50_000);
    const runtime = runtimeBytes.toString("utf8");
    expect(() => new Function(runtime)).not.toThrow();
  });

  test("the shell shape really does assemble more than the counter shape", () => {
    // The premise of this whole file. If these two ever converge, the
    // counter gate would be sufficient again and this ratchet could retire.
    const shell = gzipSize(compileAndReadRuntime(SPA_SHELL));
    const counter = gzipSize(compileAndReadRuntime(SPA_COUNTER));
    expect(shell).toBeGreaterThan(counter);
  });
});

// ---------------------------------------------------------------------------
// §2 — the compressor pin holds
// ---------------------------------------------------------------------------

describe("§2 the pinned compressor is deterministic", () => {
  test("gzipSize is stable across repeated calls on identical bytes", () => {
    const runtimeBytes = compileAndReadRuntime(SPA_SHELL);
    const sizes = new Set();
    for (let i = 0; i < 10; i++) sizes.add(gzipSize(runtimeBytes));
    expect(sizes.size).toBe(1);
  });

  test("compiling the same source twice yields byte-identical runtimes", () => {
    // If the compile were non-deterministic, the ratchet would be measuring
    // noise and the band would be doing the wrong job.
    const a = compileAndReadRuntime(SPA_SHELL);
    const b = compileAndReadRuntime(SPA_SHELL);
    expect(a.length).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });

  test("the band is wider than the measured cross-implementation spread", () => {
    // Documents the arithmetic in code so it cannot drift from the comment:
    // the band must strictly exceed the 94 B implementation delta it exists
    // to absorb, or it is not doing its job.
    const MEASURED_IMPLEMENTATION_SPREAD = 94;
    expect(RUNTIME_GZIP_TOLERANCE_BAND).toBeGreaterThan(
      MEASURED_IMPLEMENTATION_SPREAD,
    );
  });
});

// ---------------------------------------------------------------------------
// §3 — the aspiration, recorded
// ---------------------------------------------------------------------------

describe("§3 the 16 KB aspiration, measured on both shapes", () => {
  test("the COUNTER shape meets the 16 KB aspiration (as the phase-b gate asserts)", () => {
    // Same claim as `v0-3-x-spa-tree-shake-phase-b.test.js:145`, restated
    // here under this file's pinned compressor so the two shapes are
    // comparable on one ruler. That gate stays where it is; this is a
    // cross-check, not a replacement.
    const counter = gzipSize(compileAndReadRuntime(SPA_COUNTER));
    expect(counter).toBeLessThan(COUNTER_RUNTIME_GZIP_ASPIRATION);
  });

  test("the SHELL shape does NOT meet the 16 KB aspiration — recorded, not hidden", () => {
    // The fact the whole ruling turns on, asserted rather than commented so
    // that it cannot quietly stop being true without anyone noticing.
    //
    // This is the ONE assertion in this file that can go red on an
    // IMPROVEMENT, and that is deliberate: getting the shell under 16 KB is
    // a 37% reduction, not an accident, and it should force this file to be
    // revisited rather than sail past unnoticed.
    const shell = gzipSize(compileAndReadRuntime(SPA_SHELL));

    if (shell <= COUNTER_RUNTIME_GZIP_ASPIRATION) {
      throw new Error(
        [
          "THIS IS GOOD NEWS, NOT A BUG.",
          "",
          `The outlet-bearing shell runtime is now ${shell} B gzip — at or under`,
          `the ${COUNTER_RUNTIME_GZIP_ASPIRATION} B aspiration it has never met before (it was`,
          "26,080 B when this ratchet was recorded).",
          "",
          "Do this:",
          `  1. Lower SHELL_RUNTIME_GZIP_CEILING to ${shell} + the band.`,
          "  2. Delete this test — its premise is retired.",
          "  3. Update docs/known-gaps.md → g-spa-runtime-gzip-budget-knife-edge.",
        ].join("\n"),
      );
    }

    expect(shell).toBeGreaterThan(COUNTER_RUNTIME_GZIP_ASPIRATION);
  });
});
