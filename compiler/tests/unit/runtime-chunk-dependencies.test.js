/**
 * runtime-chunks — CHUNK_DEPENDENCIES + applyChunkDependencies
 *
 * Unit tests for the cross-chunk dependency closure helper introduced at
 * S124 (2026-05-23) to close 6nz Bug P (`_scrml_destroy_scope` calling
 * `_scrml_stop_scope_timers` / `_scrml_cancel_animation_frames` across a
 * tree-shake boundary).
 *
 * Scope:
 *   §1  CHUNK_DEPENDENCIES table contents — declarative edges
 *   §2  applyChunkDependencies closure — direct edge pull
 *   §3  applyChunkDependencies closure — idempotency
 *   §4  applyChunkDependencies closure — no spurious pulls when source absent
 *   §5  applyChunkDependencies closure — fixed-point shape (deeper chains)
 */

import { describe, test, expect } from "bun:test";
import { CHUNK_DEPENDENCIES, applyChunkDependencies } from "../../src/codegen/runtime-chunks.ts";

describe("§1 CHUNK_DEPENDENCIES table", () => {
  test("scope has NO edge (S461: the S124 scope → timers/animation edge is retired)", () => {
    // `_scrml_destroy_scope` now typeof-guards its two cross-chunk calls; an edge from an
    // always-seeded chunk would re-ship timers + animation on every page.
    expect(CHUNK_DEPENDENCIES.scope).toBeUndefined();
  });

  test("meta → metaemit → {urlguard, errors}; urlguard → errors (§22.4.1, S461)", () => {
    expect(CHUNK_DEPENDENCIES.meta).toContain("metaemit");
    expect(CHUNK_DEPENDENCIES.metaemit).toContain("urlguard");
    expect(CHUNK_DEPENDENCIES.metaemit).toContain("errors");
    expect(CHUNK_DEPENDENCIES.urlguard).toContain("errors");
  });
});

describe("§2 applyChunkDependencies — direct edge pull", () => {
  test("scope present → timers + animation NOT pulled (S461)", () => {
    const chunks = new Set(["core", "scope"]);
    applyChunkDependencies(chunks);
    expect(chunks.has("timers")).toBe(false);
    expect(chunks.has("animation")).toBe(false);
  });

  test("reset present → errors pulled (its reset-apply reports through _scrml_error_boundary_log)", () => {
    const chunks = new Set(["core", "scope", "reset"]);
    applyChunkDependencies(chunks);
    expect(chunks.has("errors")).toBe(true);
  });

  test("ssr present → errors pulled", () => {
    const chunks = new Set(["core", "ssr"]);
    applyChunkDependencies(chunks);
    expect(chunks.has("errors")).toBe(true);
  });
});

describe("§3 applyChunkDependencies — idempotency", () => {
  test("running twice produces the same set", () => {
    const chunks = new Set(["core", "scope"]);
    applyChunkDependencies(chunks);
    const snapshot = new Set(chunks);
    applyChunkDependencies(chunks);
    expect(chunks.size).toBe(snapshot.size);
    for (const c of snapshot) expect(chunks.has(c)).toBe(true);
  });

  test("running on a fully-closed set is a no-op", () => {
    const chunks = new Set(["core", "scope", "timers", "animation", "errors"]);
    const sizeBefore = chunks.size;
    applyChunkDependencies(chunks);
    expect(chunks.size).toBe(sizeBefore);
  });
});

describe("§4 applyChunkDependencies — no spurious pulls when source absent", () => {
  test("scope absent → timers NOT pulled", () => {
    // Hypothetical: a compile unit producing zero scope usage (impossible in
    // practice today since scope is always-seeded — see context.ts:211 — but
    // the helper must be correct for arbitrary input sets).
    const chunks = new Set(["core", "errors"]);
    applyChunkDependencies(chunks);
    expect(chunks.has("timers")).toBe(false);
    expect(chunks.has("animation")).toBe(false);
  });

  test("scope absent + timers present (independently activated) → animation NOT pulled by scope edge", () => {
    // Timer-using compile unit without scope (synthetic — not a real shape).
    const chunks = new Set(["core", "timers"]);
    applyChunkDependencies(chunks);
    expect(chunks.has("animation")).toBe(false);
  });
});

describe("§5 applyChunkDependencies — fixed-point shape", () => {
  test("the helper returns the same set instance for chaining", () => {
    const chunks = new Set(["core", "scope"]);
    const ret = applyChunkDependencies(chunks);
    expect(ret).toBe(chunks);
  });

  test("multi-pass closure: changes propagate transitively", () => {
    // meta → metaemit → urlguard → errors is a depth-3 chain in today's table.
    const chunks = new Set(["meta"]);
    applyChunkDependencies(chunks);
    expect([...chunks].sort()).toEqual(["errors", "meta", "metaemit", "urlguard"]);
  });
});
