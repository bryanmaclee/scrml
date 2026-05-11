/**
 * A9 Ext 5 — `<program idempotency-store=>` attribute + default-resolution
 * helper tests (SPEC §39.2.6).
 *
 * D2 territory:
 *   - ast-builder.js extracts the attribute into middlewareConfig.idempotencyStore
 *   - usage-analyzer.ts FeatureUsage.idempotencyStore captures the value
 *   - idempotency-store-resolver.ts resolveIdempotencyStore() implements
 *     the default-resolution algorithm
 */

import { describe, test, expect } from "bun:test";
import { runTAB } from "../../src/ast-builder.js";
import { splitBlocks } from "../../src/block-splitter.js";
import {
  resolveIdempotencyStore,
  extractDbDriverFromValue,
} from "../../src/idempotency-store-resolver.ts";
import { analyzeUsage, emptyUsage } from "../../src/codegen/usage-analyzer.ts";

function tab(source) {
  const bs = splitBlocks("/test/app.scrml", source);
  return runTAB(bs);
}

// ---------------------------------------------------------------------------
// ast-builder.js — middlewareConfig.idempotencyStore extraction
// ---------------------------------------------------------------------------

describe("ast-builder.js — `<program idempotency-store=>` extraction", () => {
  test("idempotency-store=\"auto\" sets middlewareConfig.idempotencyStore", () => {
    const result = tab(`<program idempotency-store="auto">content</program>`);
    expect(result.ast.middlewareConfig).toBeTruthy();
    expect(result.ast.middlewareConfig.idempotencyStore).toBe("auto");
  });

  test("idempotency-store=\"sqlite\" extracted", () => {
    const result = tab(`<program idempotency-store="sqlite">content</program>`);
    expect(result.ast.middlewareConfig.idempotencyStore).toBe("sqlite");
  });

  test("idempotency-store=\"redis\" extracted", () => {
    const result = tab(`<program idempotency-store="redis">content</program>`);
    expect(result.ast.middlewareConfig.idempotencyStore).toBe("redis");
  });

  test("idempotency-store=\"none\" extracted", () => {
    const result = tab(`<program idempotency-store="none">content</program>`);
    expect(result.ast.middlewareConfig.idempotencyStore).toBe("none");
  });

  test("absence — middlewareConfig.idempotencyStore is null", () => {
    const result = tab(`<program cors="*">content</program>`);
    // middlewareConfig is created (cors= triggers it); idempotencyStore is null.
    expect(result.ast.middlewareConfig).toBeTruthy();
    expect(result.ast.middlewareConfig.idempotencyStore).toBeNull();
  });

  test("idempotency-store= alongside other middleware attrs — coexists", () => {
    const result = tab(`<program cors="*" log="structured" idempotency-store="postgres">content</program>`);
    expect(result.ast.middlewareConfig.cors).toBe("*");
    expect(result.ast.middlewareConfig.log).toBe("structured");
    expect(result.ast.middlewareConfig.idempotencyStore).toBe("postgres");
  });
});

// ---------------------------------------------------------------------------
// extractDbDriverFromValue — db= URI parsing
// ---------------------------------------------------------------------------

describe("extractDbDriverFromValue — db= driver detection", () => {
  test("sqlite: prefix → 'sqlite'", () => {
    expect(extractDbDriverFromValue("sqlite:./app.db")).toBe("sqlite");
  });
  test("file ending .db → 'sqlite'", () => {
    expect(extractDbDriverFromValue("./local.db")).toBe("sqlite");
  });
  test("file ending .sqlite → 'sqlite'", () => {
    expect(extractDbDriverFromValue("/var/data/store.sqlite")).toBe("sqlite");
  });
  test("postgres:// prefix → 'postgres'", () => {
    expect(extractDbDriverFromValue("postgres://user:pass@host:5432/db")).toBe("postgres");
  });
  test("postgresql:// prefix → 'postgres'", () => {
    expect(extractDbDriverFromValue("postgresql://localhost/db")).toBe("postgres");
  });
  test("mysql:// prefix → 'mysql'", () => {
    expect(extractDbDriverFromValue("mysql://localhost/db")).toBe("mysql");
  });
  test("unknown / null / undefined → null", () => {
    expect(extractDbDriverFromValue(null)).toBeNull();
    expect(extractDbDriverFromValue(undefined)).toBeNull();
    expect(extractDbDriverFromValue("")).toBeNull();
    expect(extractDbDriverFromValue("foo://bar")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveIdempotencyStore — default-resolution algorithm
// ---------------------------------------------------------------------------

describe("resolveIdempotencyStore — default-resolution algorithm", () => {
  describe("explicit-attr branches", () => {
    test('"none" → backend "none"', () => {
      const r = resolveIdempotencyStore("none", "sqlite", false);
      expect(r.backend).toBe("none");
      expect(r.mismatch).toBe(false);
      expect(r.missingRedisImport).toBe(false);
      expect(r.reason).toBe("explicit-attr");
    });

    test('"redis" with import → backend "redis"', () => {
      const r = resolveIdempotencyStore("redis", null, true);
      expect(r.backend).toBe("redis");
      expect(r.missingRedisImport).toBe(false);
    });

    test('"redis" WITHOUT import → backend "redis" + missingRedisImport=true', () => {
      const r = resolveIdempotencyStore("redis", null, false);
      expect(r.backend).toBe("redis");
      expect(r.missingRedisImport).toBe(true);
      expect(r.reason).toBe("explicit-attr-redis-but-no-import");
    });

    test('"sqlite" matching db driver → no mismatch', () => {
      const r = resolveIdempotencyStore("sqlite", "sqlite", false);
      expect(r.backend).toBe("sqlite");
      expect(r.mismatch).toBe(false);
    });

    test('"postgres" with sqlite db driver → mismatch=true', () => {
      const r = resolveIdempotencyStore("postgres", "sqlite", false);
      expect(r.backend).toBe("postgres");
      expect(r.mismatch).toBe(true);
      expect(r.reason).toBe("explicit-attr-driver-mismatch");
    });

    test('"sqlite" with no db driver → no mismatch (driver "null" is permissive)', () => {
      // When db= is absent, an explicit storage-backend attr stands alone.
      const r = resolveIdempotencyStore("sqlite", null, false);
      expect(r.backend).toBe("sqlite");
      expect(r.mismatch).toBe(false);
    });
  });

  describe('"auto" default-resolution', () => {
    test("auto + sqlite db → sqlite shadow table", () => {
      const r = resolveIdempotencyStore("auto", "sqlite", false);
      expect(r.backend).toBe("sqlite");
      expect(r.reason).toBe("auto-db-driver");
    });

    test("auto + postgres db → postgres shadow table", () => {
      const r = resolveIdempotencyStore("auto", "postgres", false);
      expect(r.backend).toBe("postgres");
      expect(r.reason).toBe("auto-db-driver");
    });

    test("auto + no db + redis import → redis", () => {
      const r = resolveIdempotencyStore("auto", null, true);
      expect(r.backend).toBe("redis");
      expect(r.reason).toBe("auto-redis-import");
    });

    test("auto + no db + no redis → none (fallthrough)", () => {
      const r = resolveIdempotencyStore("auto", null, false);
      expect(r.backend).toBe("none");
      expect(r.reason).toBe("auto-fallthrough-none");
    });

    test("undefined attr (absent) treated as auto", () => {
      const r = resolveIdempotencyStore(undefined, "postgres", false);
      expect(r.backend).toBe("postgres");
      expect(r.reason).toBe("auto-db-driver");
    });

    test("auto + db precedes redis (db wins when both present)", () => {
      const r = resolveIdempotencyStore("auto", "mysql", true);
      expect(r.backend).toBe("mysql"); // db-driver-shadow-table FIRST per OQ-Ext5-6
      expect(r.reason).toBe("auto-db-driver");
    });
  });
});

// ---------------------------------------------------------------------------
// usage-analyzer.ts — FeatureUsage.idempotencyStore capture
// ---------------------------------------------------------------------------

describe("FeatureUsage.idempotencyStore — captured by usage walker", () => {
  test("emptyUsage() has idempotencyStore: undefined", () => {
    const u = emptyUsage();
    expect(u.idempotencyStore).toBeUndefined();
    expect(u.idempotencyStoreUsed).toBe(false);
  });

  test("file with `<program idempotency-store=\"sqlite\">` sets usage.idempotencyStore", () => {
    const result = tab(`<program idempotency-store="sqlite">
      <div>content</div>
    </program>`);
    const usage = analyzeUsage(result.ast);
    expect(usage.idempotencyStore).toBe("sqlite");
  });

  test("file WITHOUT idempotency-store= leaves usage.idempotencyStore undefined", () => {
    const result = tab(`<program>
      <div>content</div>
    </program>`);
    const usage = analyzeUsage(result.ast);
    expect(usage.idempotencyStore).toBeUndefined();
  });

  test("file with `<program idempotency-store=\"redis\">` captured", () => {
    const result = tab(`<program idempotency-store="redis">
      <div>content</div>
    </program>`);
    const usage = analyzeUsage(result.ast);
    expect(usage.idempotencyStore).toBe("redis");
  });
});
