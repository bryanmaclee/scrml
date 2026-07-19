/**
 * W3 splitter — trucking-dispatch characterization (post-W2 baseline lock).
 *
 * **Why this test exists (ss30 survey, S221).** The A-4 codegen splitter
 * (A-4.1..A-4.7) was BUILT in the S91-era wave but only ever exercised
 * against EMPTY ReachabilityRecords (the `ChunkPlan`s were unpopulated
 * until W2 threaded RouteMap into `enumerateEntryPoints` + descended
 * `<db>` state-wrappers, landed S221 `8657f7cc`). This test pins the
 * FIRST empirically-verified split of a real adopter corpus now that the
 * plans are non-empty — so the next wave (W4 runtime-loader / role
 * projection / Component-3 N≥1) flags consciously when this surface moves.
 *
 * It complements (does NOT duplicate) `trucking-dispatch-smoke-integration`
 * which only asserts the coarse `chunks.size > 0` + hash-format + manifest↔
 * chunks key consistency. The invariants locked here are the ones a future
 * wave is EXPECTED to change:
 *
 *   1. 21 RS entry points (the W2-verified count: app `#program` + 20
 *      filesystem-routed `pages/**`). If this drifts, W2 enumeration moved.
 *   2. `_anonymous` is the ONLY role variant emitted. Role-keyed splitting
 *      (driver / dispatcher / customer surfaces) is NOT yet projected —
 *      this is the dominant parked design fork. When per-role surfaces land
 *      this assertion SHOULD fail and be updated.
 *   3. Initial chunks carry REAL admitted-component content (non-empty
 *      `payloadJs` with `_scrml_chunk_mount(` markers) — proves W2 populated
 *      the plans + the A-4.2 composer consumes them.
 *   4. tier1 / tier2 chunks are EMPTY (`payloadJs === ""`). The N≥1
 *      interaction delta (Component-3) + server-fn projection are not yet
 *      computed (`serverFnNodeIds === 0` everywhere), so the prefetch tiers
 *      have nothing to admit. When Component-3 lands these go non-empty.
 *
 * SPEC anchors: §40.9.7 (per-tier admission) · §47 (chunks.json manifest).
 * Survey: `spa-lists/ss30.progress.md` (S221).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const TD_DIR = join(import.meta.dir, "..", "..", "..", "examples", "23-trucking-dispatch");

function findScrml(dir) {
  const out = [];
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...findScrml(p));
    else if (p.endsWith(".scrml")) out.push(p);
  }
  return out.sort();
}

const TD_FILES = findScrml(TD_DIR);

let TMP;
let RESULT;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "td-w3-char-"));
  RESULT = compileScrml({
    inputFiles: TD_FILES,
    outputDir: join(TMP, "dist"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

describe("W3 splitter — trucking post-W2 baseline", () => {
  test("manifest enumerates exactly 21 RS entry points (W2 baseline)", () => {
    expect(RESULT.chunksManifest).toBeDefined();
    const epKeys = Object.keys(RESULT.chunksManifest.entryPoints);
    expect(epKeys.length).toBe(21);
    // app `#program` shell + the 20 filesystem-routed `pages/**` entries.
    expect(epKeys.some((k) => k.endsWith("app.scrml#program"))).toBe(true);
  });

  test("the ONLY role variant emitted is `_anonymous` (role-projection parked)", () => {
    const roles = new Set();
    for (const perRole of Object.values(RESULT.chunksManifest.entryPoints)) {
      for (const role of Object.keys(perRole)) roles.add(role);
    }
    // When per-role surfaces (driver/dispatcher/customer) land, this set
    // grows — update this assertion + the survey at that point.
    expect([...roles].sort()).toEqual(["_anonymous"]);
  });

  test("initial chunks carry real admitted-component content", () => {
    const initials = [...RESULT.chunks.values()].filter((c) => c.tier === "initial");
    expect(initials.length).toBe(21);
    // Every initial chunk is non-empty AND emits at least one mount marker.
    for (const c of initials) {
      expect(c.payloadJs.length).toBeGreaterThan(0);
      expect(c.payloadJs).toContain("_scrml_chunk_mount(");
    }
    // Spot-check the dispatch board EP — the survey measured >30 admitted
    // components on it (the W2 `<db>`-descent yielded 21 non-empty closures).
    const board = initials.find((c) =>
      // entryPointId embeds a NATIVE-separator file path; normalize to POSIX
      // separators before the substring test so it matches on Windows
      // (`pages\dispatch\board.scrml`) as well as POSIX. No-op on POSIX.
      String(c.entryPointId).replace(/\\/g, "/").includes("pages/dispatch/board.scrml")
    );
    expect(board).toBeDefined();
    expect(board.componentNodeIds.size).toBeGreaterThan(30);
  });

  test("tier1 / tier2 chunks are EMPTY pre-Component-3 (N≥1 not yet projected)", () => {
    const tiers = [...RESULT.chunks.values()].filter(
      (c) => c.tier === "tier1" || c.tier === "tier2"
    );
    // The tiers exist as descriptors but admit nothing — serverFnNodeIds is
    // 0 everywhere (Component-3 N≥1 interaction projection is a later wave),
    // so the prefetch delta is empty + no tier file is written to disk.
    for (const c of tiers) {
      expect(c.payloadJs).toBe("");
      expect(c.serverFnNodeIds.size).toBe(0);
    }
  });
});
