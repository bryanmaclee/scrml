/**
 * A-5.4 — W-* lint family end-to-end integration tests.
 *
 * Fourth sub-phase of the A-5 wave (final Approach A wave; v0.3.0
 * critical path). Drives FOUR families of compiler diagnostics from
 * the full `compileScrml` driver against fixtures crafted to fire
 * each lint code in coherent end-to-end context:
 *
 *   §1 W-AUTH-RUNTIME-FALLBACK (Info, severity="info") via FX-5
 *      — fired by `compiler/src/reachability/component-4.ts:230-241`
 *      when an auth-role-block gate's classification carries
 *      `closed_form: false` (the `check=` form per SPEC §40.9.5
 *      line 17724 is unconditionally runtime-fallback).
 *
 *   §2 W-CG-CHUNK-EMPTY (Warning, severity="warning") via inline
 *      `<program></program>` shape
 *      — fired by `compiler/src/codegen/route-splitter.ts:emitChunkLints`
 *      when an entry-point's per-(role, tier) admission sets are
 *      uniformly empty.
 *
 *   §3 W-CG-CHUNK-LARGE (Warning, severity="warning") via FX-7
 *      — fired by route-splitter when initial-chunk payloadJs byte
 *      length exceeds the soft size budget. Tests EXPLICITLY exercise
 *      Q-OPEN-5 `chunkSizeBudgetBytes` plumbing through the
 *      `compileScrml` API surface (default = 100 000 → no fire;
 *      explicit small value → fire with effective-budget message).
 *
 *   §4 W-CG-CHUNK-NO-PREFETCH (Info, severity="info") via FX-8a
 *      — Q-OPEN-6 case 1: multi-route app with NO internal `<a href>`
 *      links at all on the entry-point.
 *
 *   §5 W-CG-CHUNK-PREFETCH-UNRESOLVED (Warning, severity="warning")
 *      via FX-8b
 *      — Q-OPEN-6 case 2: multi-route app with internal-shaped
 *      `<a href>` links present but NONE resolving to a sibling
 *      page in the compile unit. Verifies severity discrimination
 *      from the case-1 Info lint and the mutual-exclusivity
 *      invariant in the full-driver path.
 *
 *   §6 Cross-lint inter-stage ordering and severity-shape audit.
 *
 * **Diagnostic-collection contract (api.js:1674-1675):**
 *   `compileScrml()`'s public return shape splits diagnostics:
 *     - `result.errors`   = entries whose code does NOT start with `W-`
 *                           AND severity !== "warning"
 *     - `result.warnings` = entries whose code starts with `W-` OR
 *                           severity === "warning"
 *   So Info-level W-* lints (W-AUTH-RUNTIME-FALLBACK,
 *   W-CG-CHUNK-NO-PREFETCH) live in `result.warnings`, NOT
 *   `result.errors`. We assert against the collection that actually
 *   carries them — the per-section helper `allDiags(result)` returns
 *   the union for the negative-case asserts where the lint should
 *   NOT fire.
 *
 * Spec authority:
 *   - SPEC.md §34 (lint catalog) — severities asserted below match the
 *     catalog rows verbatim.
 *   - SPEC.md §40.9.11 (lint family table) — Q-OPEN-6 split row for
 *     W-CG-CHUNK-PREFETCH-UNRESOLVED present at L17921 (S92 catalog
 *     addition).
 *   - SPEC.md §40.9.5 — runtime-fallback semantics (L17724).
 *   - compiler/src/codegen/route-splitter.ts:emitChunkLints — fire-site.
 *   - compiler/src/reachability/component-4.ts — W-AUTH-RUNTIME-FALLBACK.
 *
 * SCOPING: scrml-support/docs/deep-dives/a-5-integration-tests-SCOPING-2026-05-14.md
 *   §3.1 families F-4 + F-5 + §3.2 fixtures FX-5/FX-6/FX-7/FX-8 +
 *   §4.2 A-5.4 sub-phase.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combine `result.errors` and `result.warnings` into one array. Used
 * for negative-case assertions (the lint should NOT fire anywhere)
 * because `result.errors` excludes W-* codes per api.js:1674-1675.
 */
function allDiags(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}

/** Fixture paths — absolute, anchored to this test file's directory. */
const FX5_PATH = join(
  import.meta.dir,
  "fixtures",
  "a5",
  "runtime-fallback-async-gate.scrml",
);
const FX7_PATH = join(
  import.meta.dir,
  "fixtures",
  "a5",
  "lint-large-initial-chunk.scrml",
);
const FX8A_DIR = join(
  import.meta.dir,
  "fixtures",
  "a5",
  "lint-no-prefetch",
  "routes",
);
const FX8A_INPUTS = [
  join(FX8A_DIR, "index.scrml"),
  join(FX8A_DIR, "other.scrml"),
];
const FX8B_DIR = join(
  import.meta.dir,
  "fixtures",
  "a5",
  "lint-prefetch-unresolved",
  "routes",
);
const FX8B_INPUTS = [
  join(FX8B_DIR, "index.scrml"),
  join(FX8B_DIR, "about.scrml"),
];

/** Inline-string FX-6 (degenerate empty <program>) and a sibling
 *  `non-empty` baseline for the negative-case assertion. We materialize
 *  these to disk per-test (compileScrml expects file paths). */
const FX6_EMPTY_SOURCE = `<program></program>\n`;
const FX6_NONEMPTY_BASELINE = `<program><h1>Hi</h1></program>\n`;

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "a5-lint-family-e2e-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function writeInline(name, source) {
  const filePath = join(TMP, name);
  writeFileSync(filePath, source);
  return filePath;
}

async function compileFx5() {
  return compileScrml({
    inputFiles: [FX5_PATH],
    outputDir: join(TMP, "dist-fx5"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

async function compileFx6Empty() {
  const filePath = writeInline("fx6-empty.scrml", FX6_EMPTY_SOURCE);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: join(TMP, "dist-fx6-empty"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

async function compileFx6Nonempty() {
  const filePath = writeInline("fx6-nonempty.scrml", FX6_NONEMPTY_BASELINE);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: join(TMP, "dist-fx6-nonempty"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

async function compileFx7(opts = {}) {
  return compileScrml({
    inputFiles: [FX7_PATH],
    outputDir: join(TMP, "dist-fx7"),
    write: false,
    emitPerRoute: true,
    log: () => {},
    ...opts,
  });
}

async function compileFx8a() {
  return compileScrml({
    inputFiles: FX8A_INPUTS,
    outputDir: join(TMP, "dist-fx8a"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

async function compileFx8b() {
  return compileScrml({
    inputFiles: FX8B_INPUTS,
    outputDir: join(TMP, "dist-fx8b"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

// ---------------------------------------------------------------------------
// §1 — W-AUTH-RUNTIME-FALLBACK (FX-5)
// ---------------------------------------------------------------------------

describe("§1 — W-AUTH-RUNTIME-FALLBACK end-to-end (FX-5)", () => {
  test("fires once at Info severity for the <auth check=> gate", async () => {
    const r = await compileFx5();
    const fires = r.warnings.filter((e) => e.code === "W-AUTH-RUNTIME-FALLBACK");
    expect(fires.length).toBe(1);
    expect(fires[0].severity).toBe("info");
    // Message includes the runtime-fallback prose anchor.
    expect(fires[0].message).toContain("cannot be statically resolved");
    expect(fires[0].message).toContain("checkAdminAsync");
  });

  test("no E-CLOSURE-001 / E-CLOSURE-002 / E-AUTH-GRAPH-* cascade", async () => {
    const r = await compileFx5();
    const all = allDiags(r);
    expect(all.filter((e) => e.code === "E-CLOSURE-001")).toEqual([]);
    expect(all.filter((e) => e.code === "E-CLOSURE-002")).toEqual([]);
    expect(all.filter((e) => e.code === "E-AUTH-GRAPH-002")).toEqual([]);
    expect(all.filter((e) => e.code === "E-AUTH-GRAPH-003")).toEqual([]);
    expect(all.filter((e) => e.code === "E-AUTH-GRAPH-004")).toEqual([]);
  });

  test("gated component ships eagerly in the initial chunk for every role", async () => {
    // The runtime-fallback verdict (closed_form=false in component-4)
    // collapses to "include for every effective role" per
    // component-4.ts:381-387 — every role's initial-chunk admission
    // includes the gated subtree's componentNodeIds.
    const r = await compileFx5();
    const initial = [...r.chunks.values()].filter((c) => c.tier === "initial");
    expect(initial.length).toBe(3); // 1 EP × 3 roles (Anonymous, Driver, Admin)
    // All three initial chunks share the same component admission count
    // (eager-ship for runtime-fallback gates).
    const counts = initial.map((c) => c.componentNodeIds.size).sort();
    expect(counts[0]).toBe(counts[2]);
    // And the count is non-zero (the gated <section> + descendants
    // are admitted, not filtered).
    expect(counts[0]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — W-CG-CHUNK-EMPTY (FX-6 inline)
// ---------------------------------------------------------------------------

describe("§2 — W-CG-CHUNK-EMPTY end-to-end (FX-6 inline)", () => {
  test("fires at Warning severity for an empty <program></program>", async () => {
    const r = await compileFx6Empty();
    const fires = r.warnings.filter((e) => e.code === "W-CG-CHUNK-EMPTY");
    expect(fires.length).toBe(1);
    expect(fires[0].severity).toBe("warning");
    // Message anchors the prose.
    expect(fires[0].message).toContain("zero non-empty chunks");
  });

  test("does NOT fire on a non-empty baseline (single <h1> in body)", async () => {
    const r = await compileFx6Nonempty();
    const fires = allDiags(r).filter((e) => e.code === "W-CG-CHUNK-EMPTY");
    expect(fires).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 — W-CG-CHUNK-LARGE (FX-7) + Q-OPEN-5 chunkSizeBudgetBytes plumbing
// ---------------------------------------------------------------------------

describe("§3 — W-CG-CHUNK-LARGE end-to-end (FX-7) + Q-OPEN-5 budget plumbing", () => {
  test("default budget (100 000) → no W-CG-CHUNK-LARGE fires (FX-7 stays well under)", async () => {
    const r = await compileFx7();
    const fires = allDiags(r).filter((e) => e.code === "W-CG-CHUNK-LARGE");
    expect(fires).toEqual([]);
    // Sanity — initial chunk does have a non-trivial payload (proves
    // the splitter actually ran against this fixture).
    const initial = [...r.chunks.values()].find((c) => c.tier === "initial");
    expect(initial).toBeDefined();
    expect(initial.payloadJs.length).toBeGreaterThan(0);
  });

  test("explicit small budget (500) → W-CG-CHUNK-LARGE fires at Warning severity", async () => {
    const r = await compileFx7({ chunkSizeBudgetBytes: 500 });
    const fires = r.warnings.filter((e) => e.code === "W-CG-CHUNK-LARGE");
    expect(fires.length).toBe(1);
    expect(fires[0].severity).toBe("warning");
  });

  test("budget value propagates end-to-end — message reports EFFECTIVE budget (500), not default (100000)", async () => {
    // Q-OPEN-5 acceptance: the lint message text reports the effective
    // budget — this is what makes the CLI flag adopter-visible.
    const r = await compileFx7({ chunkSizeBudgetBytes: 500 });
    const fires = r.warnings.filter((e) => e.code === "W-CG-CHUNK-LARGE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("500 bytes");
    expect(fires[0].message).not.toContain("100000 bytes");
    // Message shape matches the CGError emit:
    //   "is <N> bytes — exceeds the soft size budget of 500 bytes"
    expect(fires[0].message).toMatch(
      /is \d+ bytes — exceeds the soft size budget of 500 bytes/,
    );
  });

  test("large explicit budget (10 000 000) → suppresses W-CG-CHUNK-LARGE", async () => {
    const r = await compileFx7({ chunkSizeBudgetBytes: 10_000_000 });
    const fires = allDiags(r).filter((e) => e.code === "W-CG-CHUNK-LARGE");
    expect(fires).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 — W-CG-CHUNK-NO-PREFETCH (FX-8a) — Q-OPEN-6 case 1 (Info)
// ---------------------------------------------------------------------------

describe("§4 — W-CG-CHUNK-NO-PREFETCH end-to-end (FX-8a) — Q-OPEN-6 case 1", () => {
  test("multi-route app with NO internal <a href> links → fires at Info severity", async () => {
    const r = await compileFx8a();
    const fires = r.warnings.filter((e) => e.code === "W-CG-CHUNK-NO-PREFETCH");
    // Both pages have zero internal links → both fire the Info lint.
    expect(fires.length).toBe(2);
    for (const f of fires) {
      expect(f.severity).toBe("info");
      // Message contains the structural-cause keyword.
      expect(f.message).toContain("no internal");
    }
  });

  test("PREFETCH-UNRESOLVED does NOT fire when no internal links exist (mutual exclusion)", async () => {
    const r = await compileFx8a();
    const unresolved = allDiags(r).filter(
      (e) => e.code === "W-CG-CHUNK-PREFETCH-UNRESOLVED",
    );
    expect(unresolved).toEqual([]);
  });

  test("FX-1 baseline (canonical multipage with valid internal links) fires NEITHER lint", async () => {
    // FX-1 lives at fixtures/a5/multipage-multirole/routes/{index,loads,admin}.scrml
    // and uses correctly-resolving internal links — A-5.1 cornerstone
    // already exercises this. We re-import its inputs as a baseline
    // negative-case assertion: neither prefetch-family lint fires.
    const FX1_DIR = join(
      import.meta.dir,
      "fixtures",
      "a5",
      "multipage-multirole",
      "routes",
    );
    const r = await compileScrml({
      inputFiles: [
        join(FX1_DIR, "index.scrml"),
        join(FX1_DIR, "loads.scrml"),
        join(FX1_DIR, "admin.scrml"),
      ],
      outputDir: join(TMP, "dist-fx1-baseline"),
      write: false,
      emitPerRoute: true,
      log: () => {},
    });
    const all = allDiags(r);
    expect(all.filter((e) => e.code === "W-CG-CHUNK-NO-PREFETCH")).toEqual([]);
    expect(
      all.filter((e) => e.code === "W-CG-CHUNK-PREFETCH-UNRESOLVED"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5 — W-CG-CHUNK-PREFETCH-UNRESOLVED (FX-8b) — Q-OPEN-6 case 2 (Warning)
// ---------------------------------------------------------------------------

describe("§5 — W-CG-CHUNK-PREFETCH-UNRESOLVED end-to-end (FX-8b) — Q-OPEN-6 case 2", () => {
  test("multi-route app with internal links that resolve nowhere → fires at Warning severity", async () => {
    const r = await compileFx8b();
    const fires = r.warnings.filter(
      (e) => e.code === "W-CG-CHUNK-PREFETCH-UNRESOLVED",
    );
    // Home page has two unresolved links → fires once for that EP
    // (per-EP scan, not per-link). About has one resolving link →
    // does NOT fire on About.
    expect(fires.length).toBe(1);
    expect(fires[0].severity).toBe("warning");
    expect(fires[0].message).toContain("internal-shaped");
  });

  test("severity is WARNING (not Info) — Q-OPEN-6 split discriminator", async () => {
    // The whole point of the Q-OPEN-6 split is severity discrimination:
    // case 1 (no links) is Info (informational signal); case 2 (links
    // exist but unresolved) is Warning (actionable). This test pins
    // the severity verbatim against SPEC §34 catalog L14735 + §40.9.11
    // L17921 ("Warning" column).
    const r = await compileFx8b();
    const fires = r.warnings.filter(
      (e) => e.code === "W-CG-CHUNK-PREFETCH-UNRESOLVED",
    );
    expect(fires.length).toBe(1);
    expect(fires[0].severity).toBe("warning");
    expect(fires[0].severity).not.toBe("info");
  });

  test("NO-PREFETCH does NOT fire when internal links exist — split is mutually exclusive", async () => {
    // Q-OPEN-6 invariant: NO-PREFETCH and PREFETCH-UNRESOLVED never
    // both fire on the same EP — the route-splitter's `if/else` branch
    // structure guarantees this in the full driver.
    const r = await compileFx8b();
    const noPrefetch = allDiags(r).filter(
      (e) => e.code === "W-CG-CHUNK-NO-PREFETCH",
    );
    expect(noPrefetch).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 — Cross-lint inter-stage ordering + severity-shape audit
// ---------------------------------------------------------------------------

describe("§6 — Cross-lint inter-stage ordering + severity-shape audit", () => {
  test("severity strings match SPEC §34 catalog rows verbatim (regression guard)", async () => {
    // For each lint exercised above, capture the severity string the
    // splitter / RS Component 4 actually emits and compare against the
    // SPEC §34 catalog row. This pins the severity-shape so any future
    // refactor that drops severity (e.g. via a Map filter) breaks
    // loudly. The catalog rows are at:
    //   - W-AUTH-RUNTIME-FALLBACK         L14940 + L17911 → "Info"
    //   - W-CG-CHUNK-EMPTY                L14732 + L17918 → "Warning"
    //   - W-CG-CHUNK-LARGE                L14733 + L17919 → "Warning"
    //   - W-CG-CHUNK-NO-PREFETCH          L14734 + L17920 → "Info"
    //   - W-CG-CHUNK-PREFETCH-UNRESOLVED  L14735 + L17921 → "Warning"
    const fx5 = await compileFx5();
    const fx6 = await compileFx6Empty();
    const fx7 = await compileFx7({ chunkSizeBudgetBytes: 500 });
    const fx8a = await compileFx8a();
    const fx8b = await compileFx8b();

    expect(
      fx5.warnings.find((e) => e.code === "W-AUTH-RUNTIME-FALLBACK")?.severity,
    ).toBe("info");
    expect(
      fx6.warnings.find((e) => e.code === "W-CG-CHUNK-EMPTY")?.severity,
    ).toBe("warning");
    expect(
      fx7.warnings.find((e) => e.code === "W-CG-CHUNK-LARGE")?.severity,
    ).toBe("warning");
    expect(
      fx8a.warnings.find((e) => e.code === "W-CG-CHUNK-NO-PREFETCH")?.severity,
    ).toBe("info");
    expect(
      fx8b.warnings.find((e) => e.code === "W-CG-CHUNK-PREFETCH-UNRESOLVED")
        ?.severity,
    ).toBe("warning");
  });

  test("W-CG-CHUNK-* lints fire AFTER chunk emission — diagnostics carry filenames matching the chunk-output entries", async () => {
    // Stage-ordering invariant: the route-splitter's per-EP post-emit
    // scan composes chunks BEFORE iterating diagnostics. Therefore
    // every fired W-CG-CHUNK-* lint refers to an entry-point that has
    // a corresponding chunk in `result.chunks`. This pins the call-site
    // ordering: emission-then-scan, not scan-then-emit.
    const r = await compileFx7({ chunkSizeBudgetBytes: 500 });
    const lint = r.warnings.find((e) => e.code === "W-CG-CHUNK-LARGE");
    expect(lint).toBeDefined();
    // The lint message embeds the entry-point id; assert at least one
    // chunk's entryPointId is present in the message.
    const epIds = new Set();
    for (const c of r.chunks.values()) epIds.add(c.entryPointId);
    let foundMatch = false;
    for (const epId of epIds) {
      if (lint.message.includes(epId)) {
        foundMatch = true;
        break;
      }
    }
    expect(foundMatch).toBe(true);
  });
});
