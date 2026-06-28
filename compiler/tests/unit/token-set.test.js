/**
 * Unit tests for the `--emit-token-set` projection (token-set.ts) — the
 * scrml-side half of the flogence docs↔code-drift DD (ss54 / S229).
 *
 * R26: the symbol assertions drive from REAL compiled .scrml examples through
 * the full `compileScrml` pipeline (SYM attaches the `_scope` the state-cell
 * projection reads), NOT synthetic AST nodes. The static-field collectors
 * (errorCodes / keywords) are exercised directly, and `buildTokenSet`'s version
 * logic is isolated with injected vocab.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import {
  buildTokenSet,
  serializeTokenSet,
  collectErrorCodes,
  collectKeywords,
} from "../../src/token-set.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const COUNTER = join(REPO_ROOT, "examples", "02-counter.scrml");
const HELLO = join(REPO_ROOT, "examples", "01-hello.scrml");

const OUT = join(import.meta.dir, "__fixtures__/token-set-dist");

afterAll(() => {
  rmSync(OUT, { recursive: true, force: true });
});

function tokenSetOf(file) {
  const result = compileScrml({ inputFiles: [file], outputDir: OUT, write: false });
  expect(result.errors).toEqual([]);
  expect(typeof result.tokenSetJson).toBe("function");
  return JSON.parse(result.tokenSetJson());
}

// ---------------------------------------------------------------------------
// Shape — all four keys populated on a representative source
// ---------------------------------------------------------------------------

describe("token-set shape", () => {
  test("all four keys present and well-formed", () => {
    const ts = tokenSetOf(COUNTER);
    expect(ts).toHaveProperty("version");
    expect(ts).toHaveProperty("symbols");
    expect(ts).toHaveProperty("errorCodes");
    expect(ts).toHaveProperty("keywords");
    expect(Array.isArray(ts.symbols)).toBe(true);
    expect(Array.isArray(ts.errorCodes)).toBe(true);
    expect(Array.isArray(ts.keywords)).toBe(true);
  });

  test("version is an 8-char base36 fnv1a fingerprint", () => {
    const ts = tokenSetOf(COUNTER);
    expect(ts.version).toMatch(/^[0-9a-z]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// symbols — R26: match the declared identifiers of 02-counter
// ---------------------------------------------------------------------------

describe("token-set symbols (R26)", () => {
  test("declared functions are projected with kind:function", () => {
    const ts = tokenSetOf(COUNTER);
    const fns = ts.symbols.filter((s) => s.kind === "function").map((s) => s.name);
    expect(fns).toContain("increment");
    expect(fns).toContain("decrement");
    expect(fns).toContain("clearCount");
  });

  test("declared state-cells are projected with kind:state-cell", () => {
    const ts = tokenSetOf(COUNTER);
    const cells = ts.symbols.filter((s) => s.kind === "state-cell").map((s) => s.name);
    expect(cells).toContain("count");
    expect(cells).toContain("step");
  });

  test("every symbol carries {name, kind} (OQ-2)", () => {
    const ts = tokenSetOf(COUNTER);
    expect(ts.symbols.length).toBeGreaterThan(0);
    for (const s of ts.symbols) {
      expect(typeof s.name).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.kind).toBe("string");
      expect(s.kind.length).toBeGreaterThan(0);
    }
  });

  test("symbols are sorted by (kind, name) and deduped", () => {
    const ts = tokenSetOf(COUNTER);
    const keys = ts.symbols.map((s) => s.kind + "|" + s.name);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// errorCodes — the live source-scan of the §34 set
// ---------------------------------------------------------------------------

describe("token-set errorCodes", () => {
  test("scans the §34 code set (non-trivial, sorted, deduped)", () => {
    const codes = collectErrorCodes();
    expect(codes.length).toBeGreaterThan(100);
    expect(codes).toContain("E-CODEGEN-INVALID-JS");
    expect(codes).toContain("E-NAME-COLLIDES-STATE");
    expect([...codes].sort()).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("the emitted token-set carries the same code set", () => {
    const ts = tokenSetOf(COUNTER);
    expect(ts.errorCodes).toContain("E-CODEGEN-INVALID-JS");
    expect(ts.errorCodes.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// keywords — tokenizer reserved set ∪ stdlib namespaces
// ---------------------------------------------------------------------------

describe("token-set keywords", () => {
  test("includes language keywords and stdlib namespaces (sorted, deduped)", () => {
    const kws = collectKeywords();
    expect(kws).toContain("match");
    expect(kws).toContain("lift");
    expect(kws).toContain("function");
    expect(kws).toContain("scrml:data");
    expect(kws).toContain("scrml:http");
    expect([...kws].sort()).toEqual(kws);
    expect(new Set(kws).size).toBe(kws.length);
  });
});

// ---------------------------------------------------------------------------
// version invariant — the re-check contract (OQ-1)
// ---------------------------------------------------------------------------

describe("token-set version invariant", () => {
  test("stable across recompiles of unchanged source", () => {
    const a = tokenSetOf(COUNTER).version;
    const b = tokenSetOf(COUNTER).version;
    expect(a).toBe(b);
  });

  test("differs across sources with different symbol sets", () => {
    // errorCodes + keywords are static, so the delta is symbol-set-driven.
    const counter = tokenSetOf(COUNTER).version;
    const hello = tokenSetOf(HELLO).version;
    expect(hello).not.toBe(counter);
  });

  test("buildTokenSet version excludes itself and tracks the body", () => {
    const meta = [];
    const v1 = buildTokenSet(meta, { errorCodes: ["E-A"], keywords: ["k"] }).version;
    const v2 = buildTokenSet(meta, { errorCodes: ["E-A"], keywords: ["k"] }).version;
    const v3 = buildTokenSet(meta, { errorCodes: ["E-A", "E-B"], keywords: ["k"] }).version;
    expect(v1).toBe(v2);
    expect(v3).not.toBe(v1);
    expect(v1).toMatch(/^[0-9a-z]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// serialization determinism + no-artifact-without-flag
// ---------------------------------------------------------------------------

describe("token-set serialization", () => {
  test("serializeTokenSet is byte-stable (pretty, trailing newline)", () => {
    const ts = buildTokenSet([], { errorCodes: ["E-A"], keywords: ["k"] });
    const s1 = serializeTokenSet(ts);
    const s2 = serializeTokenSet(ts);
    expect(s1).toBe(s2);
    expect(s1.endsWith("\n")).toBe(true);
    expect(s1).toContain('"version"');
  });

  test("compileScrml does NOT write token-set.json on its own (CLI-gated emit)", () => {
    mkdirSync(OUT, { recursive: true });
    rmSync(join(OUT, "token-set.json"), { force: true });
    compileScrml({ inputFiles: [COUNTER], outputDir: OUT, write: false });
    expect(existsSync(join(OUT, "token-set.json"))).toBe(false);
  });
});
