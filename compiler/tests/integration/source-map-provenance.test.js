/**
 * Source Map v3 real-provenance coverage tests
 * (source-map-real-provenance-js-2026-05-31).
 *
 * These tests pin the contract that replaced the degenerate `addMapping(i,0,0)`
 * stub, which mapped every output line of both client and server bundles to
 * source line 0, column 0 — a structurally-valid map that LIES.
 *
 * THE CANARY (the load-bearing assertion of this dispatch):
 *   No SOURCE-DERIVED generated line resolves to source position (0,0).
 *   A source-derived line that falls back to (0,0) renders in devtools as a
 *   wrong / "dead" highlight region ("9 of 14 lines light up, 5 don't") and
 *   reads as a broken compiler. Compiler-SYNTHESIZED lines (runtime preamble,
 *   wiring boilerplate) are allowed to carry a sentinel (0,0), but they MUST be
 *   CATEGORIZED synthetic (via the map's `x_scrml_kinds` sidecar) — never
 *   silently emitted as if they were a real (0,0) author position.
 *
 * SPEC §47 prose promises this: "Source maps (PIPELINE.md §Stage 8) are the
 * specified debugging path back to `.scrml` source."
 *
 * Compiles via the programmatic API (`compileScrml({ inputFiles, sourceMap })`)
 * against a temp .scrml file — the canonical in-tree pattern (see
 * await-import-meta-no-invalid-js.test.js). NOTE: there is no `--source-map`
 * CLI flag yet; the option is API-only (default false).
 */

import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// --- Source Map v3 mappings decoder (test-local; no runtime dependency) -----

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(str) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of str) {
    let digit = B64.indexOf(ch);
    const continuation = digit & 0x20;
    digit &= 0x1f;
    value += digit << shift;
    if (continuation) {
      shift += 5;
    } else {
      const negate = value & 1;
      let n = value >> 1;
      if (negate) n = -n;
      out.push(n);
      shift = 0;
      value = 0;
    }
  }
  return out;
}

/**
 * Decode a Source Map v3 JSON string into per-segment rows:
 *   { generatedLine, generatedColumn, sourceLine, sourceColumn, name, kind }
 * Returns { map, rows }.
 */
function decodeSourceMap(mapJson) {
  const map = JSON.parse(mapJson);
  const groups = map.mappings.split(";");
  const kinds = map.x_scrml_kinds || [];
  const names = map.names || [];
  let srcLine = 0;
  let srcCol = 0;
  let nameIdx = 0;
  const rows = [];
  groups.forEach((group, gLine) => {
    if (!group) return;
    let genCol = 0;
    for (const seg of group.split(",")) {
      const v = decodeVlq(seg);
      genCol += v[0] ?? 0;
      let name = null;
      if (v.length >= 4) {
        srcLine += v[2];
        srcCol += v[3];
      }
      if (v.length >= 5) {
        nameIdx += v[4];
        name = names[nameIdx];
      }
      rows.push({
        generatedLine: gLine,
        generatedColumn: genCol,
        sourceLine: srcLine,
        sourceColumn: srcCol,
        name,
        kind: kinds[gLine],
      });
    }
  });
  return { map, rows };
}

const COUNTER = `<title>Counter</title>
<count> = 0

fn increment() {
  @count = @count + 1
}

<button onclick=increment()>Count: {@count}</button>
`;

/** Compile COUNTER with source maps and return the per-file CG output object. */
function compileCounter() {
  const dir = mkdtempSync(join(tmpdir(), "scrml-srcmap-prov-"));
  const file = join(dir, "counter.scrml");
  writeFileSync(file, COUNTER);
  const result = compileScrml({
    inputFiles: [file],
    outputDir: join(dir, "dist"),
    sourceMap: true,
    write: false,
    log: () => {},
  });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out };
}

describe("source-map real provenance (Phase 1: JS)", () => {
  it("emits a non-degenerate client map (NOT all-0:0)", () => {
    const { out } = compileCounter();
    expect(out).toBeTruthy();
    expect(out.clientJsMap).toBeTruthy();
    const map = JSON.parse(out.clientJsMap);
    // The old stub produced mappings that were exclusively "AAAA" segments
    // (every line -> 0,0,0,0). A real map MUST NOT be all-AAAA.
    const allDegenerate = /^(AAAA)?(;(AAAA)?)*$/.test(map.mappings);
    expect(allDegenerate).toBe(false);
  });

  it("CANARY: no source-derived line resolves to source (0,0)", () => {
    const { out } = compileCounter();

    for (const mapJson of [out.clientJsMap, out.serverJsMap]) {
      if (!mapJson) continue; // server may be absent for a client-only file
      const { rows } = decodeSourceMap(mapJson);
      const badRows = rows.filter(
        (r) => r.kind === "source" && r.sourceLine === 0 && r.sourceColumn === 0
      );
      // A source-derived OUTPUT line that resolves to (0,0) is a forgotten-
      // provenance bug: the counter fixture's author constructs (<count> on
      // source line 1, fn increment on line 3) are NOT at byte 0:0, so any
      // source-kind (0,0) means a line was mis-attributed to the top of file.
      expect(badRows.length).toBe(0);
    }
  });

  it("categorizes every generated line as source or synthetic (no silent gap)", () => {
    const { out } = compileCounter();
    const map = JSON.parse(out.clientJsMap);
    const kinds = map.x_scrml_kinds || [];
    const lineCount = out.clientJs
      .replace(/\n\/\/# sourceMappingURL=.*\n?$/, "")
      .split("\n").length;
    // Every generated line is categorized (length matches, give or take the
    // trailing sourceMappingURL comment line which is synthetic).
    expect(kinds.length).toBeGreaterThanOrEqual(lineCount - 2);
    for (const k of kinds) {
      expect(k === "source" || k === "synthetic").toBe(true);
    }
    // Both categories are exercised by a real app: SOME lines are author-derived
    // and MANY are synthetic preamble/wiring.
    expect(kinds.includes("source")).toBe(true);
    expect(kinds.includes("synthetic")).toBe(true);
  });

  it("recovers author identifiers into the `names` field (§47 encoded -> author)", () => {
    const { out } = compileCounter();
    const map = JSON.parse(out.clientJsMap);
    // The author wrote `count` (a state cell, emitted as `_scrml_t_count`) and
    // `increment` (a function). At least one author name MUST be recovered so a
    // renamed/encoded output identifier resolves back to the author identifier.
    expect(Array.isArray(map.names)).toBe(true);
    expect(map.names.length).toBeGreaterThan(0);
    expect(map.names).toContain("count");
  });

  it("does NOT embed sourcesContent in the client/server map (privacy — no source leakage)", () => {
    // SECURITY: the `.scrml` source contains server-fn bodies (and possibly DB
    // connection strings / secrets) that MUST NOT leak into a deployable
    // `.client.js.map`. The real provenance (line/col + names) is delivered via
    // `sources: ["...scrml"]` + the mappings; devtools resolves the actual
    // source from the served `.scrml` at debug time. This pins the privacy
    // posture of the legacy "sourcesContent is null - no source leakage" test.
    const { out } = compileCounter();
    const clientMap = JSON.parse(out.clientJsMap);
    expect(clientMap.sourcesContent).toBeUndefined();
    if (out.serverJsMap) {
      const serverMap = JSON.parse(out.serverJsMap);
      expect(serverMap.sourcesContent).toBeUndefined();
    }
  });

  it("source-derived lines resolve to plausible NON-zero source positions", () => {
    const { out } = compileCounter();
    const { rows } = decodeSourceMap(out.clientJsMap);
    const sourceRows = rows.filter((r) => r.kind === "source");
    // There is at least one author-derived line.
    expect(sourceRows.length).toBeGreaterThan(0);
    // `count` is declared on source line index 1 (`<count> = 0`, 0-indexed
    // after `<title>` on line 0). At least one source-derived row maps to a
    // line >= 1 (i.e. a real, non-top-of-file construct).
    const nonTrivial = sourceRows.filter((r) => r.sourceLine >= 1);
    expect(nonTrivial.length).toBeGreaterThan(0);
  });

  it("emitted client JS still parses (provenance must not corrupt output)", () => {
    const { result, out } = compileCounter();
    // The compiler's always-on emitted-JS parse gate (S142) would have failed
    // the compile with E-CODEGEN-INVALID-LOGIC if the source-map work corrupted
    // the output. A clean compile with errors-free output proves it didn't.
    expect(
      (result.errors || []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")
    ).toHaveLength(0);
    expect(out.clientJs).toContain("//# sourceMappingURL=");
  });

  it("shipped client JS carries NO leftover provenance markers", () => {
    // The use-site sentinels are an internal mechanism (B1). The deployed JS the
    // adopter ships and devtools loads MUST be marker-free (readability + the
    // S142 parse gate). A leaked marker would also corrupt generated columns.
    const { out } = compileCounter();
    expect(out.clientJs.includes("#scrmlmap#")).toBe(false);
    if (out.serverJs) expect(out.serverJs.includes("#scrmlmap#")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B1 USE-SITE CANARY (source-map-use-site-spans-b1-2026-05-31)
// ---------------------------------------------------------------------------
// The load-bearing regression guard that PINS B1 (use-site) and FORBIDS a
// regression to B2 (declaration-footprint). It compiles a fixture with a cell
// DECLARED on one line and WRITTEN+READ on a DIFFERENT, later line inside a
// handler, then asserts the handler's emitted reactive get/set maps to the USE
// source line — NOT the declaration line.
//
// Under B2, every USE of `count` mapped to the `<count>` DECLARATION (source
// line 1) — so the "maps to USE line 4" assertion below would FAIL. That is
// exactly the confidently-wrong behaviour B1 replaces; this canary keeps it dead.
describe("source-map B1 use-site resolution (NOT declaration-footprint)", () => {
  // 0-indexed source lines: title=0, <count>=1, blank=2, fn=3,
  // "  @count = @count + 1"=4, "}"=5.
  const DECL_LINE = 1; // <count> = 0          (declaration)
  const USE_LINE = 4;  // @count = @count + 1  (use site inside the handler)

  function compileSplit() {
    const dir = mkdtempSync(join(tmpdir(), "scrml-b1-usesite-"));
    const file = join(dir, "counter.scrml");
    writeFileSync(file, COUNTER); // declared line 1, used line 4 — see top of file
    const result = compileScrml({
      inputFiles: [file],
      outputDir: join(dir, "dist"),
      sourceMap: true,
      write: false,
      log: () => {},
    });
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    return { result, out };
  }

  it("the handler's @count write/read maps to the USE line, not the declaration line", () => {
    const { out } = compileSplit();
    const { rows } = decodeSourceMap(out.clientJsMap);

    // The `count` name is recovered at the use sites (the §47 use-site -> author
    // identifier recovery, AT THE USE).
    const countRows = rows.filter((r) => r.name === "count");
    expect(countRows.length).toBeGreaterThan(0);

    // B1 PROOF: at least one `count` mapping points at the USE line (4).
    expect(countRows.some((r) => r.sourceLine === USE_LINE)).toBe(true);

    // The handler body emits BOTH a set and a get of `count` on one generated
    // line (`_scrml_reactive_set("count", _scrml_reactive_get("count") + 1)`).
    // EVERY `count` mapping on that line must be the USE line — never the decl.
    const cleaned = out.clientJs.replace(/\n\/\/# sourceMappingURL=.*\n?$/, "");
    const genLines = cleaned.split("\n");
    const handlerBodyGenLine = genLines.findIndex(
      (l) =>
        l.includes('_scrml_reactive_set("count"') &&
        l.includes('_scrml_reactive_get("count")')
    );
    expect(handlerBodyGenLine).toBeGreaterThanOrEqual(0);
    const handlerRows = countRows.filter((r) => r.generatedLine === handlerBodyGenLine);
    expect(handlerRows.length).toBeGreaterThan(0);
    expect(handlerRows.every((r) => r.sourceLine === USE_LINE)).toBe(true);
    expect(handlerRows.some((r) => r.sourceLine === DECL_LINE)).toBe(false);
  });

  it("the use-site mapping is the HANDLER body, never the top-level initializer line", () => {
    // The handler-body line and the top-level initializer line are DISTINCT
    // generated lines. The use-site `count` mappings belong to the HANDLER line
    // (the use site), proving B1 attributes the read/write to where the code
    // came from.
    //
    // KNOWN-GAP (documented, honest): the top-level `<count> = 0 -> _scrml_
    // reactive_set("count", 0)` lowering is built by the statement emitter
    // (emit-logic), NOT by emitAssign, so it currently carries NO use-site marker
    // and its generated line is categorized SYNTHETIC. That is the honest outcome
    // (never a wrong map). Widening the statement-emitter init path to mark at the
    // decl span is a clean follow-up, out of scope for Phase 1b.
    const { out } = compileSplit();
    const { rows } = decodeSourceMap(out.clientJsMap);
    const cleaned = out.clientJs.replace(/\n\/\/# sourceMappingURL=.*\n?$/, "");
    const genLines = cleaned.split("\n");

    const handlerGenLine = genLines.findIndex(
      (l) =>
        l.includes('_scrml_reactive_set("count"') &&
        l.includes('_scrml_reactive_get("count")')
    );
    const initGenLine = genLines.findIndex(
      (l) => l.includes('_scrml_reactive_set("count", 0)')
    );
    expect(handlerGenLine).toBeGreaterThanOrEqual(0);
    expect(initGenLine).toBeGreaterThanOrEqual(0);
    expect(handlerGenLine).not.toBe(initGenLine);

    // All `count` source mappings live on the handler line (the use site).
    const countRows = rows.filter((r) => r.name === "count");
    expect(countRows.length).toBeGreaterThan(0);
    expect(countRows.every((r) => r.generatedLine === handlerGenLine)).toBe(true);
    // The init line carries no use-site `count` mapping (known-gap: synthetic).
    expect(countRows.some((r) => r.generatedLine === initGenLine)).toBe(false);
  });
});
