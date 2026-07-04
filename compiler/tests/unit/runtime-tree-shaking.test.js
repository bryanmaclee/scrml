/**
 * runtime-tree-shaking.test.js — Unit tests for runtime chunk tree-shaking.
 *
 * Tests for:
 *   RUNTIME_CHUNKS — that the runtime is correctly split into named chunks
 *   assembleRuntime — that chunk assembly produces correct subsets
 *   detectRuntimeChunks (via generateClientJs) — that AST feature detection works
 *
 * TREE-SHAKE change: docs/changes/TREE-SHAKE/
 */

import { describe, test, expect } from "bun:test";
import { SCRML_RUNTIME, RUNTIME_FILENAME } from "../../src/runtime-template.js";
import { RUNTIME_CHUNKS, RUNTIME_CHUNK_ORDER, assembleRuntime } from "../../src/codegen/runtime-chunks.ts";

// ---------------------------------------------------------------------------
// RUNTIME_CHUNKS structure
// ---------------------------------------------------------------------------

describe("RUNTIME_CHUNKS", () => {
  test("exports the expected 14 chunks", () => {
    const expectedChunks = [
      'core', 'derived', 'lift', 'scope', 'timers', 'animation',
      'reconciliation', 'utilities', 'meta', 'transitions', 'errors',
      'input', 'equality', 'deep_reactive',
    ];
    for (const name of expectedChunks) {
      expect(RUNTIME_CHUNKS).toHaveProperty(name);
      expect(typeof RUNTIME_CHUNKS[name]).toBe("string");
    }
  });

  test("all chunks are non-empty strings", () => {
    for (const name of RUNTIME_CHUNK_ORDER) {
      const chunk = RUNTIME_CHUNKS[name];
      expect(typeof chunk).toBe("string");
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test("concatenating all chunks reproduces SCRML_RUNTIME", () => {
    const assembled = RUNTIME_CHUNK_ORDER
      .map(name => RUNTIME_CHUNKS[name] ?? '')
      .join('');
    expect(assembled).toBe(SCRML_RUNTIME);
  });

  test("core chunk contains _scrml_reactive_set and _scrml_reactive_get", () => {
    expect(RUNTIME_CHUNKS.core).toContain("_scrml_reactive_set");
    expect(RUNTIME_CHUNKS.core).toContain("_scrml_reactive_get");
    expect(RUNTIME_CHUNKS.core).toContain("_scrml_reactive_subscribe");
  });

  test("derived chunk contains _scrml_derived_declare and flush", () => {
    expect(RUNTIME_CHUNKS.derived).toContain("_scrml_derived_declare");
    expect(RUNTIME_CHUNKS.derived).toContain("_scrml_derived_get");
    expect(RUNTIME_CHUNKS.derived).toContain("function flush");
  });

  test("lift chunk contains _scrml_lift", () => {
    expect(RUNTIME_CHUNKS.lift).toContain("_scrml_lift");
    // Should NOT contain timer or effect code
    expect(RUNTIME_CHUNKS.lift).not.toContain("_scrml_timer_start");
  });

  // GitHub #19 (Peter, peter-19-spa-lift-target-tree-shake): the shared
  // `let _scrml_lift_target = null;` ambient MUST travel WITH the lift chunk.
  // The chunk marker is `function _scrml_lift`, so a decl placed on the line
  // BEFORE the function belongs to the PREVIOUS chunk — which is tree-shaken
  // out of an SPA/embed build while `lift` is kept, leaving _scrml_lift_target
  // undeclared. The first dynamic <each> insert then reads it and throws
  // `_scrml_lift_target is not defined`. Fix: declare it INSIDE the lift chunk
  // (after the function, still module scope for the generated writers).
  test("lift chunk contains the _scrml_lift_target ambient declaration (GitHub #19)", () => {
    expect(RUNTIME_CHUNKS.lift).toContain("function _scrml_lift");
    expect(RUNTIME_CHUNKS.lift).toContain("let _scrml_lift_target = null;");
  });

  test("_scrml_lift_target ambient is declared in EXACTLY ONE chunk (no duplication)", () => {
    const declaringChunks = RUNTIME_CHUNK_ORDER.filter(
      (name) => (RUNTIME_CHUNKS[name] ?? "").includes("let _scrml_lift_target = null;"),
    );
    expect(declaringChunks).toEqual(["lift"]);
  });

  test("scope chunk contains _scrml_register_cleanup and _scrml_destroy_scope", () => {
    expect(RUNTIME_CHUNKS.scope).toContain("_scrml_register_cleanup");
    expect(RUNTIME_CHUNKS.scope).toContain("_scrml_destroy_scope");
    expect(RUNTIME_CHUNKS.scope).toContain("_scrml_cleanup_registry");
  });

  test("timers chunk contains _scrml_timer_start and _scrml_timer_stop", () => {
    expect(RUNTIME_CHUNKS.timers).toContain("_scrml_timer_start");
    expect(RUNTIME_CHUNKS.timers).toContain("_scrml_timer_stop");
    expect(RUNTIME_CHUNKS.timers).toContain("_scrml_timer_pause");
    expect(RUNTIME_CHUNKS.timers).toContain("_scrml_timer_resume");
  });

  test("animation chunk contains requestAnimationFrame helpers", () => {
    expect(RUNTIME_CHUNKS.animation).toContain("_scrml_animation_frame");
    expect(RUNTIME_CHUNKS.animation).toContain("animationFrame");
    expect(RUNTIME_CHUNKS.animation).toContain("_scrml_cancel_animation_frames");
  });

  test("reconciliation chunk contains _scrml_reconcile_list and _scrml_lis", () => {
    expect(RUNTIME_CHUNKS.reconciliation).toContain("_scrml_reconcile_list");
    expect(RUNTIME_CHUNKS.reconciliation).toContain("_scrml_lis");
  });

  test("utilities chunk contains deep_set, debounce, throttle, upload, navigate", () => {
    expect(RUNTIME_CHUNKS.utilities).toContain("_scrml_deep_set");
    expect(RUNTIME_CHUNKS.utilities).toContain("_scrml_debounce");
    expect(RUNTIME_CHUNKS.utilities).toContain("_scrml_throttle");
    expect(RUNTIME_CHUNKS.utilities).toContain("_scrml_upload");
    expect(RUNTIME_CHUNKS.utilities).toContain("_scrml_navigate");
  });

  test("meta chunk contains _scrml_meta_emit and _scrml_meta_effect", () => {
    expect(RUNTIME_CHUNKS.meta).toContain("_scrml_meta_emit");
    expect(RUNTIME_CHUNKS.meta).toContain("_scrml_meta_effect");
  });

  test("transitions chunk contains CSS animation keyframes", () => {
    expect(RUNTIME_CHUNKS.transitions).toContain("scrml-fade-in");
    expect(RUNTIME_CHUNKS.transitions).toContain("scrml-slide-in");
  });

  test("errors chunk contains built-in error classes", () => {
    expect(RUNTIME_CHUNKS.errors).toContain("class NetworkError");
    expect(RUNTIME_CHUNKS.errors).toContain("class ValidationError");
    expect(RUNTIME_CHUNKS.errors).toContain("class _ScrmlError");
  });

  test("input chunk contains keyboard, mouse, gamepad handlers", () => {
    expect(RUNTIME_CHUNKS.input).toContain("_scrml_input_keyboard_create");
    expect(RUNTIME_CHUNKS.input).toContain("_scrml_input_mouse_create");
    expect(RUNTIME_CHUNKS.input).toContain("_scrml_input_gamepad_create");
  });

  test("equality chunk contains _scrml_structural_eq", () => {
    expect(RUNTIME_CHUNKS.equality).toContain("_scrml_structural_eq");
  });

  test("deep_reactive chunk contains _scrml_effect and proxy infrastructure", () => {
    expect(RUNTIME_CHUNKS.deep_reactive).toContain("_scrml_effect");
    expect(RUNTIME_CHUNKS.deep_reactive).toContain("_scrml_deep_reactive");
    expect(RUNTIME_CHUNKS.deep_reactive).toContain("_scrml_effect_static");
    expect(RUNTIME_CHUNKS.deep_reactive).toContain("_scrml_computed");
  });
});

// ---------------------------------------------------------------------------
// assembleRuntime
// ---------------------------------------------------------------------------

describe("assembleRuntime", () => {
  test("assembles all chunks when all names are given", () => {
    const all = new Set(RUNTIME_CHUNK_ORDER);
    const assembled = assembleRuntime(all);
    expect(assembled).toBe(SCRML_RUNTIME);
  });

  test("assembles only core when only 'core' is given", () => {
    const result = assembleRuntime(new Set(['core']));
    expect(result).toBe(RUNTIME_CHUNKS.core);
    expect(result).toContain("_scrml_reactive_set");
    expect(result).not.toContain("function _scrml_derived_declare");
    expect(result).not.toContain("function _scrml_effect");
  });

  test("assembles core+derived when both are given", () => {
    const result = assembleRuntime(new Set(['core', 'derived']));
    expect(result).toContain("_scrml_reactive_set");
    expect(result).toContain("_scrml_derived_declare");
    expect(result).not.toContain("function _scrml_lift");
    expect(result).not.toContain("_scrml_timer_start");
  });

  test("assembles in RUNTIME_CHUNK_ORDER regardless of input Set order", () => {
    // Set with chunks in reverse order
    const reversed = assembleRuntime(new Set(['derived', 'core']));
    // The assembly always follows RUNTIME_CHUNK_ORDER, so core comes first
    const expected = RUNTIME_CHUNKS.core + RUNTIME_CHUNKS.derived;
    expect(reversed).toBe(expected);
  });

  test("ignores unknown chunk names without crashing", () => {
    const result = assembleRuntime(new Set(['core', 'nonexistent_chunk']));
    expect(result).toBe(RUNTIME_CHUNKS.core);
  });

  test("core+scope+errors subset is valid JS (no runtime errors)", () => {
    const result = assembleRuntime(new Set(['core', 'scope', 'errors']));
    // Should be valid JS — evaluating it should not throw
    const fn = new Function(`
      const window = { addEventListener: () => {} };
      const document = { querySelector: () => null };
      ${result}
      return typeof _scrml_reactive_set === "function" && typeof _scrml_register_cleanup === "function";
    `);
    expect(fn()).toBe(true);
  });

  test("full runtime is valid JS when assembled from all chunks", () => {
    const result = assembleRuntime(new Set(RUNTIME_CHUNK_ORDER));
    const fn = new Function(`
      const window = { addEventListener: () => {} };
      const document = {
        querySelector: () => null,
        createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, innerHTML: "", textContent: "" }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      const requestAnimationFrame = () => 0;
      const cancelAnimationFrame = () => {};
      const navigator = { getGamepads: () => [] };
      const setInterval = globalThis.setInterval;
      const clearInterval = globalThis.clearInterval;
      ${result}
      return typeof _scrml_reactive_set === "function"
        && typeof _scrml_effect === "function"
        && typeof _scrml_reconcile_list === "function";
    `);
    expect(fn()).toBe(true);
  });

  test("timers subset requires scope to work correctly", () => {
    // timers+scope+core subset should be valid and have _scrml_timer_start
    const result = assembleRuntime(new Set(['core', 'scope', 'timers']));
    const fn = new Function(`
      const window = { addEventListener: () => {} };
      const document = { querySelector: () => null };
      const setInterval = globalThis.setInterval;
      const clearInterval = globalThis.clearInterval;
      ${result}
      return typeof _scrml_timer_start === "function" && typeof _scrml_register_cleanup === "function";
    `);
    expect(fn()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size verification
// ---------------------------------------------------------------------------

describe("runtime size", () => {
  test("full SCRML_RUNTIME is over 40KB (sanity check)", () => {
    expect(SCRML_RUNTIME.length).toBeGreaterThan(40_000);
  });

  test("core+scope+errors subset is smaller than full runtime", () => {
    const minimal = assembleRuntime(new Set(['core', 'scope', 'errors']));
    expect(minimal.length).toBeLessThan(SCRML_RUNTIME.length);
    // Core should be at most 30% of the full runtime
    expect(minimal.length).toBeLessThan(SCRML_RUNTIME.length * 0.30);
  });

  test("RUNTIME_CHUNK_ORDER has 30 chunks", () => {
    // 30 chunks post-§52.8 (ssr-b-substrate): 'ssr' chunk added for the SSR
    // pre-render seed (_scrml_ssr_seed_apply + _scrml_ssr_seeded). Activated by a
    // POST-EMIT `_scrml_ssr_` scan (emit-client.ts) when a server-authority cell
    // is present (emit-reactive-wiring emits the seed-apply call + per-fetch
    // seed-skip guards); a non-server-authority page emits none and omits the chunk.
    //
    // 29 chunks post-§20.6 (S174 log-builtin): 'log' chunk added for the
    // location-transparent log() builtin runtime (_scrml_log + _scrml_log_render).
    // Activated by a POST-EMIT scan (emit-client.ts) when the emitted JS contains
    // a `_scrml_log(` call — a shadowed or production-stripped build emits none and
    // omits the chunk (so the prod bundle carries zero _scrml_log bytes, F4=A).
    //
    // 28 chunks post-§59 (S169 map-arc phase-c D3): 'map' chunk added for the
    // §59 value-native map runtime (_scrml_fnv1a + _scrml_value_canonical +
    // _scrml_map_*). Activated per-compile-unit by detectRuntimeChunks when a
    // map is used (D4 wires the trigger). The map == BRANCH lives in the
    // 'equality' chunk (_scrml_structural_eq), not 'map'.
    //
    // 27 chunks post-known-gaps-#6 (S152): 'modules' chunk added for the
    // §21.3 cross-file _scrml_modules registry (Approach B). Sibling to the
    // _scrml_stdlib registry; activated per-compile-unit by detectRuntimeChunks
    // when a local .scrml import/export crosses a file boundary.
    //
    // 26 chunks post-Bug 18 S95: 4 'stdlib-<name>' chunks added for the
    // _scrml_stdlib registry — one per hand-written shim under
    // compiler/runtime/stdlib/ (auth, crypto, data, host). Each chunk
    // populates `_scrml_stdlib.<name>` so the import-rewrite at
    // emit-client.ts resolves at runtime in classic-script (non-module)
    // context. Activated per-file when the source imports from
    // `scrml:<name>`.
    //
    // 22 chunks post-v0.3.x SPA tree-shake Phase B 3.2: 'wire' chunk added
    // for the §57 dual-decoder (_scrml_wire_decode). Activated by
    // detectRuntimeChunks when ANY file in the compile unit has a server
    // 'function-decl' OR a 'use foreign:' use-decl.
    //
    // 21 chunks post-A-4.7: 'mount' + 'vendor-ref' chunks added for SPEC
    // §40.9.7 chunk-side record-keeping helpers (_scrml_chunk_mount,
    // _scrml_vendor_require). Chunk-detection trigger: detectRuntimeChunks
    // scans the per-file ReachabilityRecord and adds 'mount' / 'vendor-ref'
    // when ANY entry-point chunk admits a non-empty components / vendor-
    // units set.
    //
    // Prior milestones:
    //   19 chunks post-A-4.3: 'prefetch' chunk for §40.9.7 tier-1 idle-
    //   prefetch (helper: _scrml_prefetch_tier1).
    //   18 chunks post-C13: 'engine' chunk for §51.0.F + §51.0.G engine
    //   state-machine runtime hooks.
    //   17 chunks post-C10: 'messages' chunk for §55.10.
    expect(RUNTIME_CHUNK_ORDER.length).toBe(30);
  });
});
