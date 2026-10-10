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
 * HISTORY: first recorded at 26,080 B (`36ed3d05`, 2026-08-19, unstripped —
 * then the only shape there was), plus the 188 B band. Lowered S459 to the
 * production (stripped) shape — see the block directly below.
 *
 * ⚑ ASPIRATION: 16,384 B (16 KB) is the aspirational gzip budget for the
 *   client runtime, asserted as a `<` gate on the COUNTER shape at
 *   `v0-3-x-spa-tree-shake-phase-b.test.js:145`. Until S459 the SHELL shape
 *   never met it (26,080 B unstripped, 1.59x). The shipped (stripped) shell
 *   runtime is 7,442 B — under half the aspiration — and §3 below now asserts
 *   that instead of the old "does NOT meet it" record.
 */
//
// ⚑ LOWERED S459 — 26,268 B -> 7,630 B. `scrml build` now ships the runtime
//   STRIPPED (SPEC §47.9.9: comments + indentation removed, tokens and line
//   structure untouched, proven token-identical before it ships), so this file
//   measures the PRODUCTION shape (`stripShippedJs: true` in
//   `compileAndReadRuntime`) — the bytes a deployed app actually serves.
//   Measured at `6fcde7f7e` + the strip, this file's pinned compressor:
//
//       shape     emitted (dev)           shipped (build)
//       shell     82,730 raw / 26,211 B   28,845 raw / 7,442 B
//       counter   57,017 raw / 16,328 B   22,579 raw / 5,101 B
//
//   GNU gzip 1.12 `-9` on the shipped shell runtime: 7,439 B (spread 3 B).
//   The band stays 188 B (re-derive it before lowering it further).
//   The dev (unstripped) runtime is deliberately NOT ratcheted: comments in
//   the runtime template cost a deployed app nothing, and a gate on them
//   would tax documentation.
//
// ⚑ LOWERED S461 — 7,630 B -> 6,095 B. Runtime tree-shake (ruling S459 "measure
//   first, 1 and 3 for sure"; docs/changes/s461-runtime-tree-shake): the shell
//   no longer ships the errors chunk (a), timers + animation (b, the retired
//   scope edge), the §51.12/§51.14 machine helpers that sat in core (c), or the
//   route-splitter-only mount chunk (d). Same pinned compressor, stripped:
//
//       shape     before (S459)           after (S461)
//       shell     28,842 raw / 7,442 B    22,202 raw / 5,907 B
//       counter   22,574 raw / 5,101 B    16,088 raw / 3,604 B
//
//   Shell chunks now: core, scope, utilities. Its reachability floor (every
//   runtime statement reachable from the one helper its client calls) is
//   3,510 B; the rest of the gap is the utilities chunk, which carries the
//   soft-nav engine together with helpers the shell never calls.
const SHELL_RUNTIME_GZIP_CEILING = 5907 + RUNTIME_GZIP_TOLERANCE_BAND; // 6,095 B

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

/**
 * Compile one source to disk and hand back the assembled shared runtime — in the
 * PRODUCTION shape `scrml build` ships (S459, §47.9.9: `stripShippedJs`).
 */
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
    stripShippedJs: true,
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
          `  ceiling  : ${SHELL_RUNTIME_GZIP_CEILING} B  (5,907 recorded S461, stripped + ${RUNTIME_GZIP_TOLERANCE_BAND} B band)`,
          `  over by  : ${gzipped - SHELL_RUNTIME_GZIP_CEILING} B`,
          "",
          "SHELL_RUNTIME_GZIP_CEILING is a RATCHET. It may be LOWERED freely.",
          "It may NOT be raised without an explicit operator ruling. If your",
          "change genuinely needs these bytes, that is the conversation to",
          "have — do not bump the constant to make this green.",
          "",
          "The band already absorbs every compressor difference measured on",
          "this artifact (3 B, bun zlib vs GNU gzip, both -9, on the stripped",
          "runtime; 235 B on the old unstripped one), so a failure here is",
          "code, not compression.",
        ].join("\n"),
      );
    }

    expect(gzipped).toBeLessThanOrEqual(SHELL_RUNTIME_GZIP_CEILING);
  });

  test("the shell runtime is measured, not silently absent", () => {
    // Guards the failure mode where the ratchet passes because it is
    // measuring nothing — an empty or truncated runtime would sail under
    // any ceiling. The shell must assemble a substantial runtime and must
    // parse as JS. (S461: 22,202 B raw stripped; S459: 28,845 B; was > 50,000 unstripped.)
    const runtimeBytes = compileAndReadRuntime(SPA_SHELL);
    expect(runtimeBytes.length).toBeGreaterThan(15_000);
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

  // S459 — the "SHELL shape does NOT meet the 16 KB aspiration" record was
  // retired by its own instructions (lower the ceiling, delete the test,
  // update g-spa-runtime-gzip-budget-knife-edge): the shipped (stripped)
  // shell runtime is 7,442 B. The ratchet in §1 (ceiling 7,630 B) is now the
  // binding gate and is far tighter than the aspiration; this records the
  // aspiration as MET on the shell shape too.
  test("the SHELL shape meets the 16 KB aspiration in its shipped (stripped) form", () => {
    const shell = gzipSize(compileAndReadRuntime(SPA_SHELL));
    expect(shell).toBeLessThan(COUNTER_RUNTIME_GZIP_ASPIRATION);
    expect(SHELL_RUNTIME_GZIP_CEILING).toBeLessThan(COUNTER_RUNTIME_GZIP_ASPIRATION);
  });
});
