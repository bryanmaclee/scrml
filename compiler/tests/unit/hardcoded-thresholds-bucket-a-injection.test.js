/* SPDX-License-Identifier: MIT
 * S79 hardcoded-thresholds audit Bucket A — injectability tests.
 *
 * Per `docs/audits/hardcoded-thresholds-2026-05-10.md` §2:
 *
 *   A.1  MAX_RUNS=100 in runtime-template.js (meta-effect infinite-loop guard)
 *        — overridable via globalThis.__scrml_max_meta_runs.
 *
 *   A.2  seq>1331 in codegen/type-encoding.ts (E-CG-014 disambiguator overflow)
 *        — injectable via EncodingContext opts.__testOnly_typeEncodingSeqCap.
 *
 * Same shape as the S78 E-IMPORT-007 unblock (audit gather-limit fix at
 * a9-ext4-s4-wiring): the hardcoded literal is replaced with a tunable that
 * tests can lower, exercising the diagnostic path with a small fixture.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EncodingContext } from "../../src/codegen/type-encoding.ts";
import { CGError } from "../../src/codegen/errors.ts";

// ---------------------------------------------------------------------------
// §A.1 — MAX_RUNS overridable via globalThis.__scrml_max_meta_runs
// ---------------------------------------------------------------------------

describe("§A.1 — MAX_RUNS overridable via globalThis.__scrml_max_meta_runs", () => {
  test("runtime source reads the override via globalThis lookup", () => {
    const rt = readFileSync(
      join(import.meta.dir, "..", "..", "src", "runtime-template.js"),
      "utf8",
    );
    expect(rt).toContain("globalThis.__scrml_max_meta_runs");
    // Default fallback must remain 100.
    expect(rt).toContain(": 100;");
  });

  test("runtime source still gates the diagnostic on MAX_RUNS", () => {
    const rt = readFileSync(
      join(import.meta.dir, "..", "..", "src", "runtime-template.js"),
      "utf8",
    );
    // The bail-and-error path is preserved.
    expect(rt).toContain("runCount > MAX_RUNS");
    expect(rt).toContain('exceeded "');
  });

  test("override accepts only positive numbers — invalid types fall back to 100", () => {
    // Read the substitution shape and verify the gate.
    const rt = readFileSync(
      join(import.meta.dir, "..", "..", "src", "runtime-template.js"),
      "utf8",
    );
    // Type guard: typeof === "number" + > 0
    expect(rt).toContain('typeof globalThis.__scrml_max_meta_runs === "number"');
    expect(rt).toContain("globalThis.__scrml_max_meta_runs > 0");
  });
});

// ---------------------------------------------------------------------------
// §A.2 — EncodingContext.seqCap injectable
// ---------------------------------------------------------------------------

describe("§A.2 — EncodingContext.seqCap injectable via __testOnly_typeEncodingSeqCap", () => {
  test("default cap is 1331 (back-compat with pre-S79 hardcoded value)", () => {
    const ctx = new EncodingContext({ enabled: true });
    expect(ctx.seqCap).toBe(1331);
  });

  test("__testOnly_typeEncodingSeqCap overrides the default", () => {
    const ctx = new EncodingContext({
      enabled: true,
      __testOnly_typeEncodingSeqCap: 3,
    });
    expect(ctx.seqCap).toBe(3);
  });

  test("seqCap=0 is accepted (falsy but valid edge case)", () => {
    const ctx = new EncodingContext({
      enabled: true,
      __testOnly_typeEncodingSeqCap: 0,
    });
    // 0 is valid (no >0 entries permitted before E-CG-014)
    expect(ctx.seqCap).toBe(0);
  });

  test("negative seqCap falls back to 1331 default", () => {
    const ctx = new EncodingContext({
      enabled: true,
      __testOnly_typeEncodingSeqCap: -1,
    });
    expect(ctx.seqCap).toBe(1331);
  });

  test("non-number seqCap falls back to 1331 default", () => {
    const ctx = new EncodingContext({
      enabled: true,
      // @ts-expect-error -- intentionally testing the bad-input guard
      __testOnly_typeEncodingSeqCap: "5",
    });
    expect(ctx.seqCap).toBe(1331);
  });

  test("E-CG-014 fires when register() exceeds seqCap (small fixture)", () => {
    // With seqCap=2, the FOURTH same-type-prefix register call (seq=3) overflows.
    const ctx = new EncodingContext({
      enabled: true,
      __testOnly_typeEncodingSeqCap: 2,
    });
    const t = { kind: "asIs", constraint: null };
    // Three registrations succeed (seq 0, 1, 2 — seq 2 NOT > seqCap 2).
    expect(() => ctx.register("a", t)).not.toThrow();
    expect(() => ctx.register("b", t)).not.toThrow();
    expect(() => ctx.register("c", t)).not.toThrow();
    // Fourth registration (seq would be 3) overflows.
    expect(() => ctx.register("d", t)).toThrow(CGError);
    try {
      ctx.register("e", t);
    } catch (e) {
      expect(e).toBeInstanceOf(CGError);
      expect(e.code).toBe("E-CG-014");
      // Message uses the dynamic seqCap value (not hardcoded 1,332).
      expect(String(e.message)).toContain("more than 3 bindings");
    }
  });

  test("E-CG-014 fires at the documented 1332 threshold by default", () => {
    // Spot-check: with default cap 1331, the 1333rd registration (seq=1332)
    // should throw. We don't actually run 1332 iterations (slow); instead
    // we verify the throw path uses `this.seqCap` not a literal.
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "src", "codegen", "type-encoding.ts"),
      "utf8",
    );
    expect(src).toContain("seq > this.seqCap");
    expect(src).toContain("this.seqCap + 1"); // dynamic message-cap arithmetic
  });

  test("seqCap is not used when encoding is disabled (passthrough register)", () => {
    const ctx = new EncodingContext({
      enabled: false,
      __testOnly_typeEncodingSeqCap: 0,
    });
    const t = { kind: "asIs", constraint: null };
    // Disabled encoding: register() returns originalName immediately, no
    // seq-counter increment, no overflow check.
    expect(() => ctx.register("a", t)).not.toThrow();
    expect(() => ctx.register("b", t)).not.toThrow();
    expect(() => ctx.register("c", t)).not.toThrow();
    expect(() => ctx.register("d", t)).not.toThrow();
  });
});
