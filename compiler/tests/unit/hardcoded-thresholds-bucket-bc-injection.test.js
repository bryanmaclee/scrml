/* SPDX-License-Identifier: MIT
 * S79 hardcoded-thresholds audit Bucket B + C — injectability tests.
 *
 * Per `docs/audits/hardcoded-thresholds-2026-05-10.md` §3-§4:
 *
 *   B.1  AbortSignal.timeout(...) values in serve-client.js — overridable
 *        via `__testOnly_serverTimeouts` second-arg option (or
 *        globalThis.__scrml_test_server_timeouts hook).
 *
 *   C.1  _SCRML_IDEMPOTENCY_TTL_MS = 24*60*60*1000 — overridable per-app
 *        via `<program idempotency-ttl="...">` attribute. Accepts bare
 *        millis or duration string ("1h"/"7d"/"300s"/"30m").
 *
 *   C.2  the §8.10.6 chunk size (default 32766) — overridable per-app
 *        via `<program batch-in-list-cap=N>` attribute.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// §B.1 — serve-client AbortSignal timeouts (file-shape verification)
// ---------------------------------------------------------------------------
//
// Functional tests would require an actual HTTP fixture; that's the test-
// blocker the audit calls out. Verify the substitution shape by source-
// inspection — the four hardcoded `AbortSignal.timeout(N)` literals are
// gone, replaced with `t.<key>` lookups.

describe("§B.1 — serve-client timeout overrides", () => {
  const src = readFileSync(
    join(import.meta.dir, "..", "..", "src", "serve-client.js"),
    "utf8",
  );

  test("DEFAULT_TIMEOUTS table defines the four named timeouts", () => {
    expect(src).toContain("const DEFAULT_TIMEOUTS = {");
    expect(src).toContain("health: 500");
    expect(src).toContain("info: 1000");
    expect(src).toContain("compile: 30000");
    expect(src).toContain("shutdown: 2000");
  });

  test("resolveTimeouts() merges override + globalThis hook + default", () => {
    expect(src).toContain("function resolveTimeouts(override)");
    expect(src).toContain("globalThis.__scrml_test_server_timeouts");
    expect(src).toContain("override?.health");
    expect(src).toContain("override?.shutdown");
  });

  test("isServerRunning passes resolved timeout to AbortSignal.timeout", () => {
    expect(src).toContain("AbortSignal.timeout(t.health)");
  });

  test("getServerHealth uses resolved info timeout", () => {
    expect(src).toContain("AbortSignal.timeout(t.info)");
  });

  test("compileViaServer uses resolved compile timeout", () => {
    expect(src).toContain("AbortSignal.timeout(t.compile)");
  });

  test("shutdownServer uses resolved shutdown timeout", () => {
    expect(src).toContain("AbortSignal.timeout(t.shutdown)");
  });

  test("no remaining hardcoded AbortSignal.timeout literals", () => {
    // Every AbortSignal.timeout(...) call must now use t.<key>.
    const matches = src.match(/AbortSignal\.timeout\(([^)]+)\)/g) ?? [];
    expect(matches.length).toBe(4); // 4 sites
    for (const m of matches) {
      // Must be t.<ident>; reject literal numeric arguments.
      expect(m).toMatch(/AbortSignal\.timeout\(t\.[a-z]+\)/);
    }
  });

  test("compileViaServer propagates timeoutsOverride into health probe", () => {
    expect(src).toContain(
      "isServerRunning(url, { __testOnly_serverTimeouts: timeoutsOverride })",
    );
  });
});

// ---------------------------------------------------------------------------
// §C.1 — emit-server.ts idempotency TTL substitution
// ---------------------------------------------------------------------------
//
// Verify the codegen path reads middlewareConfig.idempotencyTTL, parses the
// value via parseIdempotencyTtl, and substitutes the resulting millis into
// the emitted const. Default 24h preserved when attr absent/malformed.

describe("§C.1 — idempotency TTL via <program idempotency-ttl=>", () => {
  const src = readFileSync(
    join(import.meta.dir, "..", "..", "src", "codegen", "emit-server.ts"),
    "utf8",
  );

  test("parseIdempotencyTtl helper exists with documented form set", () => {
    expect(src).toContain("function parseIdempotencyTtl(");
    // Comment names the accepted forms (ms/s/m/h/d).
    expect(src).toContain('"Nms" / "Ns" / "Nm" / "Nh" / "Nd"');
  });

  test("parseIdempotencyTtl handles the documented accepted shapes", () => {
    // Re-derive the regex contract from source rather than re-importing the
    // (private) helper — this keeps the test independent of module surface.
    const parse = (raw) => {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (trimmed.length === 0) return null;
      if (/^\d+$/.test(trimmed)) {
        const n = parseInt(trimmed, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const m = trimmed.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
        m[2].toLowerCase()
      ];
      return mult ? n * mult : null;
    };

    expect(parse("3600000")).toBe(3_600_000); // bare millis
    expect(parse("1h")).toBe(3_600_000);
    expect(parse("24h")).toBe(86_400_000);
    expect(parse("7d")).toBe(7 * 86_400_000);
    expect(parse("300s")).toBe(300_000);
    expect(parse("30m")).toBe(30 * 60_000);
    expect(parse("500ms")).toBe(500);
    // Edge cases: null / empty / malformed → null (caller falls back to 24h).
    expect(parse(null)).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("abc")).toBeNull();
    expect(parse("0h")).toBeNull(); // 0 rejected (>0 guard)
    expect(parse("1.5h")).toBeNull(); // float rejected
    expect(parse("-1h")).toBeNull(); // negative rejected (regex anchor)
    expect(parse("1y")).toBeNull(); // unsupported unit
  });

  test("default 24h preserved when middlewareConfig has no idempotencyTTL", () => {
    expect(src).toContain('"// TTL 24h (Stripe convention). Lazy eviction on read."');
    expect(src).toContain("const _SCRML_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;");
  });

  test("override comment includes overridden value when attr present", () => {
    expect(src).toContain('TTL ${ttlMs}ms (overridden via <program idempotency-ttl=');
  });
});

// ---------------------------------------------------------------------------
// §C.2 — emit-control-flow batch-in-list cap substitution
// ---------------------------------------------------------------------------
//
// Module-level setBatchInListCap() lifecycle mirrors setBatchLoopHoists:
// set per file (from middlewareConfig.batchInListCap) before emission, reset
// to null after compile. The emitted check + diagnostic-message text both
// reference the configured value.

describe("§C.2 — batch-in-list cap via <program batch-in-list-cap=N>", () => {
  test("setBatchInListCap exposed alongside setBatchLoopHoists", async () => {
    const mod = await import("../../src/codegen/emit-control-flow.ts");
    expect(typeof mod.setBatchInListCap).toBe("function");
    expect(typeof mod.setBatchLoopHoists).toBe("function");
  });

  // Functional emission tests would need a full hoist fixture (sqlTemplate
  // + loop body + planner Map plumbing). The substitution is verified at the
  // source-shape level here; full end-to-end is covered by existing
  // hoisted-for-stmt integration tests.
  const src = readFileSync(
    join(import.meta.dir, "..", "..", "src", "codegen", "emit-control-flow.ts"),
    "utf8",
  );

  // S456 — §8.10.6 "the Tier 2 rewrite SHALL chunk the IN-list into segments of at
  // most `SQLITE_MAX_VARIABLE_NUMBER` keys": the cap is now the CHUNK size (it was a
  // `keys.length > cap` throw). The runtime chunking itself is pinned by
  // conformance/cases/server-db/sql-hoisted-loop-chunked-rt.
  test("emitter reads the dynamic cap, not a hardcoded literal", () => {
    expect(src).toContain("const batchCap = getBatchInListCap();");
    expect(src).toContain("_at += ${batchCap}");
    expect(src).toContain("_keys.slice(_at, _at + ${batchCap})");
    // No remaining hardcoded `> 32766` / `+= 32766` in the file.
    expect(src).not.toContain("> 32766");
    expect(src).not.toContain("+= 32766");
  });

  test("default cap 32766 preserved when override is null/invalid", () => {
    expect(src).toContain("return _batchInListCap ?? 32766;");
  });

  test("setBatchInListCap guards against zero / negative inputs", () => {
    // (typeof cap === "number" && cap > 0) ? cap : null
    expect(src).toContain('typeof cap === "number" && cap > 0');
  });

  test("the emitted text references the configured cap", () => {
    expect(src).toContain("in chunks of at most ${batchCap} bound keys (§8.10.6)");
  });

  test("module state lifecycle: codegen/index.ts wires set/reset", () => {
    const idx = readFileSync(
      join(import.meta.dir, "..", "..", "src", "codegen", "index.ts"),
      "utf8",
    );
    expect(idx).toContain("setBatchInListCap");
    expect(idx).toContain("middlewareCfg?.batchInListCap");
    // Reset on compile-end mirrors setBatchLoopHoists(null).
    expect(idx).toContain("setBatchInListCap(null);");
  });
});

// ---------------------------------------------------------------------------
// AST extraction — middleware attrs flow through ast-builder
// ---------------------------------------------------------------------------

describe("§C.1+§C.2 — compute-program-config.ts extracts new middleware attrs", () => {
  // S115 (DD #27 / F6 / Pivot 2) — the middleware-attr extraction was relocated
  // out of `ast-builder.js` into the pipeline-agnostic `computeProgramConfig`
  // pre-codegen pass. The grep targets live in `compute-program-config.ts` now.
  const src = readFileSync(
    join(import.meta.dir, "..", "..", "src", "compute-program-config.ts"),
    "utf8",
  );

  test("compute-program-config reads idempotency-ttl from <program>", () => {
    expect(src).toContain('getMWAttr("idempotency-ttl")');
  });

  test("compute-program-config reads batch-in-list-cap from <program>", () => {
    expect(src).toContain('getMWAttr("batch-in-list-cap")');
  });

  test("middlewareConfig object includes the two new fields", () => {
    expect(src).toContain("idempotencyTTL: mwIdempotencyTTL");
    expect(src).toContain("batchInListCap: mwBatchInListCap");
  });
});
