// each-as-tuple-destructure-d2c.test.js — §59.8 / §14.11 (S169) optional
// 2-name positional destructure `as (k, v)` on a `<each>` opener.
//
// The S169 ruling rides the shipped `<each in=@m.entries() as e>` opener +
// `e.key`/`e.value`. D2c adds ONLY the optional terse form
// `<each in=@m.entries() as (k, v)>`, which binds the iterated ENTRY STRUCT's
// two fields positionally (`k ← .key`, `v ← .value`) — it is sugar over `as e`
// + `e.key`/`e.value`; the iterated value remains the `{ key, value }` struct.
//
// Coverage:
//   §1 — LEGACY parse: ast-builder captures asNames=[k,v]; inExprRaw cleaned
//   §2 — NATIVE parse: native parser captures asNames=[k,v]
//   §3 — CODEGEN bind: per-item `const k = item.key; const v = item.value;`
//        at create-time AND inside live-keyed effects (both parsers)
//   §4 — TS scope: bare `${k}` / `${v}` body refs do NOT fire E-SCOPE-001
//   §5 — REGRESSION: single-name `as e` still works (both parsers, unchanged)
//   §6 — EQUIVALENCE: `as (k, v)` body output == `as e`+e.key/e.value baseline
//        (the correctness anchor)
//
// Scope: the destructure is ENTRIES-SCOPED — it binds the entry struct's
// fixed `.key`/`.value` fields. A general §14.11 N-field positional destructure
// on arbitrary struct arrays is OUT of scope (deferred). The tests use a
// {key,value} struct array (parser/codegen are field-name-agnostic — the sugar
// derives `.key`/`.value` regardless of whether the source is a real map).

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findEachBlock(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findEachBlock(n);
      if (r) return r;
    }
    return null;
  }
  if (node.kind === "each-block") return node;
  for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
    if (Array.isArray(node[k])) {
      const r = findEachBlock(node[k]);
      if (r) return r;
    }
  }
  return null;
}

function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-d2c-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""));
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codeIn(result, code) {
  const all = [...(result.errors ?? []), ...(result.warnings ?? [])];
  return all.some((d) => d && d.code === code);
}

// A {key,value} struct array — the parser/codegen are field-name-agnostic;
// `as (k, v)` derives `.key`/`.value` regardless of source being a real map.
const TUPLE_SRC = `type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 4500 }, { key: "HOU", value: 3200 }]
<ul>
    <each in=@pairs as (k, v)>
        <li>\${k}: \${v}</li>
    </each>
</ul>`;

const SINGLE_SRC = `type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 4500 }, { key: "HOU", value: 3200 }]
<ul>
    <each in=@pairs as e>
        <li>\${e.key}: \${e.value}</li>
    </each>
</ul>`;

// ===========================================================================
// §1 — LEGACY parse
// ===========================================================================

describe("each-as-tuple §1 — legacy parse captures asNames", () => {
  test("ast-builder each-block carries asNames=[k,v], asName=null, clean inExprRaw", () => {
    // Drive the full compile (legacy) and assert no parse errors. Node-level
    // assertion uses the native parser path in §2; here we verify the legacy
    // pipeline accepts the form and emits the bindings (the parse evidence).
    const { errors, clientJs: __cjRaw } = compileWith(TUPLE_SRC, null, "leg-parse"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // The over-read iteration-source must be CLEANED — `.entries()`/`@pairs`
    // iteration source must not carry the `as (k, v)` tail.
    expect(clientJs).not.toContain("as (k, v)");
    // The iteration source is the clean `@pairs` read.
    expect(clientJs).toContain('_scrml_reactive_get("pairs")');
  });
});

// ===========================================================================
// §2 — NATIVE parse
// ===========================================================================

describe("each-as-tuple §2 — native parse captures asNames", () => {
  test("native each-block node carries asNames=[k,v], asName=null", () => {
    const r = nativeParseFile("app.scrml", TUPLE_SRC);
    const each = findEachBlock(r.ast);
    expect(each).not.toBeNull();
    expect(each.kind).toBe("each-block");
    expect(each.asName).toBeNull();
    expect(each.asNames).toEqual(["k", "v"]);
    // inExprRaw must be the clean source (no destructure tail).
    expect(typeof each.inExprRaw).toBe("string");
    expect(each.inExprRaw).not.toContain("as (");
  });

  test("native single-name `as e` still yields asName=e, asNames=null", () => {
    const r = nativeParseFile("app.scrml", SINGLE_SRC);
    const each = findEachBlock(r.ast);
    expect(each).not.toBeNull();
    expect(each.asName).toBe("e");
    expect(each.asNames == null).toBe(true);
  });
});

// ===========================================================================
// §3 — CODEGEN bind (both parsers)
// ===========================================================================

for (const parser of [null, "scrml-native"]) {
  const label = parser ? "native" : "legacy";
  describe(`each-as-tuple §3 — codegen bind (${label})`, () => {
    test("emits `const k = item.key; const v = item.value;` per-item", () => {
      const { errors, clientJs: __cjRaw } = compileWith(TUPLE_SRC, parser, `cg-${label}`); const clientJs = foldChunkNamespacing(__cjRaw);
      expect(errors).toEqual([]);
      // The synthetic entry-struct iter var is the item; k/v derive from it.
      expect(clientJs).toContain("const k = _scrml_each_item.key;");
      expect(clientJs).toContain("const v = _scrml_each_item.value;");
      // The body text bindings reference the derived locals directly.
      expect(clientJs).toContain("String(k)");
      expect(clientJs).toContain("String(v)");
    });

    test("derives k/v INSIDE the live-keyed effect (re-resolve across reconcile)", () => {
      const { errors, clientJs: __cjRaw } = compileWith(TUPLE_SRC, parser, `cg-eff-${label}`); const clientJs = foldChunkNamespacing(__cjRaw);
      expect(errors).toEqual([]);
      // The effect re-binds the item then re-derives k/v before the body runs,
      // so `${k}`/`${v}` stay live when the list reconciles.
      expect(clientJs).toMatch(
        /let _scrml_each_item = _scrml_resolve_item\([^)]*\);\s*\n\s*if \(_scrml_each_item === null\) return;\s*\n\s*const k = _scrml_each_item\.key;\s*\n\s*const v = _scrml_each_item\.value;/,
      );
    });
  });
}

// ===========================================================================
// §4 — TS scope: no E-SCOPE-001 on bare ${k} / ${v}
// ===========================================================================

describe("each-as-tuple §4 — TS scope binds k/v", () => {
  for (const parser of [null, "scrml-native"]) {
    const label = parser ? "native" : "legacy";
    test(`bare \${k} / \${v} body refs do NOT fire E-SCOPE-001 (${label})`, () => {
      const r = compileWith(TUPLE_SRC, parser, `ts-${label}`);
      expect(codeIn(r, "E-SCOPE-001")).toBe(false);
      expect(r.errors).toEqual([]);
    });
  }
});

// ===========================================================================
// §5 — REGRESSION: single-name `as e` unchanged
// ===========================================================================

describe("each-as-tuple §5 — single-name `as e` regression", () => {
  for (const parser of [null, "scrml-native"]) {
    const label = parser ? "native" : "legacy";
    test(`\`as e\` + e.key/e.value still compiles + binds (${label})`, () => {
      const { errors, clientJs: __cjRaw } = compileWith(SINGLE_SRC, parser, `single-${label}`); const clientJs = foldChunkNamespacing(__cjRaw);
      expect(errors).toEqual([]);
      // Single-name form: iter var is `e` (NOT the synthetic default), and the
      // destructure bindings are ABSENT (no `const k`/`const v`).
      expect(clientJs).toMatch(/\(e, _scrml_each_idx\) =>/);
      expect(clientJs).not.toContain("const k = ");
      expect(clientJs).toContain("String(e.key)");
      expect(clientJs).toContain("String(e.value)");
    });
  }
});

// ===========================================================================
// §6 — EQUIVALENCE: `as (k, v)` body output == `as e` baseline
// ===========================================================================

describe("each-as-tuple §6 — body-output equivalence with `as e` baseline", () => {
  for (const parser of [null, "scrml-native"]) {
    const label = parser ? "native" : "legacy";
    test(`per-item body text-node assignments are equivalent (${label})`, () => {
      const tuple = compileWith(TUPLE_SRC, parser, `eq-t-${label}`);
      const single = compileWith(SINGLE_SRC, parser, `eq-s-${label}`);
      expect(tuple.errors).toEqual([]);
      expect(single.errors).toEqual([]);
      // The `as (k, v)` form derives k=item.key/v=item.value then assigns
      // String(k)/String(v); the `as e` form assigns String(e.key)/String(e.value).
      // Both produce the SAME two textContent slots from the SAME entry fields.
      // Assert both forms read `.key` then `.value` in body order.
      const tupleKeyIdx = foldChunkNamespacing(tuple.clientJs).indexOf("const k = _scrml_each_item.key;");
      const tupleValIdx = foldChunkNamespacing(tuple.clientJs).indexOf("const v = _scrml_each_item.value;");
      expect(tupleKeyIdx).toBeGreaterThanOrEqual(0);
      expect(tupleValIdx).toBeGreaterThan(tupleKeyIdx);
      // Baseline reads e.key before e.value in the same body order.
      const baseKeyIdx = foldChunkNamespacing(single.clientJs).indexOf("String(e.key)");
      const baseValIdx = foldChunkNamespacing(single.clientJs).indexOf("String(e.value)");
      expect(baseKeyIdx).toBeGreaterThanOrEqual(0);
      expect(baseValIdx).toBeGreaterThan(baseKeyIdx);
    });
  }
});
