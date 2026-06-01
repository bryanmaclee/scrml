/**
 * Unit tests for the rewritten SourceMapBuilder API + the build-source-map
 * bridge (source-map-real-provenance-js-2026-05-31).
 *
 * Covers the NEW public surface added when the degenerate line-only, all-0:0
 * stub was replaced:
 *   - LineIndex (byte-offset -> 0-indexed {line, column})
 *   - SourceMapBuilder.addSourceMapping (real columns + names)
 *   - SourceMapBuilder.addSyntheticLine (categorized sentinel)
 *   - generate(): names array, sourcesContent embed, x_scrml_kinds sidecar
 *   - collectAuthorBindings / buildSourceMap (AST -> map)
 *
 * The legacy line-level addMapping contract + VLQ primitives are pinned by the
 * sibling `source-map.test.js`; this file pins the column/name/kind additions.
 */

import { describe, it, expect } from "bun:test";
import {
  SourceMapBuilder,
  LineIndex,
  encodeVlqGroup,
} from "../../src/codegen/source-map.ts";
import {
  collectAuthorBindings,
  buildSourceMap,
} from "../../src/codegen/build-source-map.ts";
import {
  // The PURE (un-gated) marker formatter. Tests use it so they never toggle the
  // shared module gate (enable/disableSrcmapProvenance) — bun runs test files
  // concurrently and a gate flip would race a concurrent compile's emission.
  formatSrcmapMark,
  srcmapMark,
  enableSrcmapProvenance,
  disableSrcmapProvenance,
  stripSrcmapMarks,
  findSrcmapMarks,
} from "../../src/codegen/srcmap-provenance.ts";

/** Module-scope VLQ segment decoder (shared by the B1 describe block). */
function decodeVlqString(seg) {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let shift = 0, value = 0;
  const out = [];
  for (const ch of seg) {
    let digit = B64.indexOf(ch);
    const cont = digit & 0x20;
    digit &= 0x1f;
    value += digit << shift;
    if (cont) { shift += 5; }
    else { const neg = value & 1; let n = value >> 1; if (neg) n = -n; out.push(n); shift = 0; value = 0; }
  }
  return out;
}

describe("LineIndex", () => {
  it("locates offset 0 at line 0, column 0", () => {
    const idx = new LineIndex("hello\nworld\n");
    expect(idx.locate(0)).toEqual({ line: 0, column: 0 });
  });

  it("locates a mid-first-line offset", () => {
    const idx = new LineIndex("hello\nworld\n");
    expect(idx.locate(3)).toEqual({ line: 0, column: 3 });
  });

  it("locates the start of the second line", () => {
    const idx = new LineIndex("hello\nworld\n");
    // "hello\n" is 6 bytes; offset 6 is line 1 column 0.
    expect(idx.locate(6)).toEqual({ line: 1, column: 0 });
  });

  it("locates a mid-second-line offset", () => {
    const idx = new LineIndex("hello\nworld\n");
    expect(idx.locate(8)).toEqual({ line: 1, column: 2 });
  });

  it("clamps out-of-range offsets to the end", () => {
    const idx = new LineIndex("ab\ncd");
    const loc = idx.locate(9999);
    expect(loc.line).toBe(1);
    expect(loc.column).toBe(2);
  });

  it("clamps negative offsets to (0,0)", () => {
    const idx = new LineIndex("ab\ncd");
    expect(idx.locate(-5)).toEqual({ line: 0, column: 0 });
  });
});

describe("SourceMapBuilder — columns + names + kinds", () => {
  it("emits the names array when a mapping carries an author name", () => {
    const b = new SourceMapBuilder("app.scrml");
    b.addSourceMapping(0, 4, 1, 2, "count");
    const map = JSON.parse(b.generate("app.client.js"));
    expect(map.names).toEqual(["count"]);
  });

  it("dedups repeated author names in the names array", () => {
    const b = new SourceMapBuilder("app.scrml");
    b.addSourceMapping(0, 0, 1, 0, "count");
    b.addSourceMapping(1, 0, 1, 0, "count");
    const map = JSON.parse(b.generate("app.client.js"));
    expect(map.names).toEqual(["count"]);
  });

  it("encodes a 5-field segment (with name index) for named mappings", () => {
    const b = new SourceMapBuilder("app.scrml");
    // gen line 0, gen col 0; src line 0, src col 0; name index 0.
    b.addSourceMapping(0, 0, 0, 0, "x");
    const map = JSON.parse(b.generate("app.client.js"));
    // [0,0,0,0,0] -> "AAAAA" (5 fields).
    expect(map.mappings).toBe("AAAAA");
    expect(encodeVlqGroup([0, 0, 0, 0, 0])).toBe("AAAAA");
  });

  it("encodes a 4-field segment for unnamed source mappings", () => {
    const b = new SourceMapBuilder("app.scrml");
    b.addSourceMapping(0, 0, 0, 0);
    const map = JSON.parse(b.generate("app.client.js"));
    expect(map.mappings).toBe("AAAA");
  });

  it("preserves the generated column delta", () => {
    const b = new SourceMapBuilder("app.scrml");
    // Two segments on the same generated line at columns 0 and 4.
    b.addSourceMapping(0, 0, 0, 0);
    b.addSourceMapping(0, 4, 0, 0);
    const map = JSON.parse(b.generate("app.client.js"));
    // Second segment's genCol delta is +4 -> "I" in VLQ ([4]<<1 = 8 -> "I").
    expect(map.mappings.split(";")[0].split(",").length).toBe(2);
    expect(map.mappings).toContain(",I");
  });

  it("embeds sourcesContent when source content is provided", () => {
    const b = new SourceMapBuilder("app.scrml", "<count> = 0\n");
    const map = JSON.parse(b.generate("app.client.js"));
    expect(map.sourcesContent).toEqual(["<count> = 0\n"]);
  });

  it("omits sourcesContent (absent) when no content is provided — privacy default", () => {
    const b = new SourceMapBuilder("app.scrml");
    b.addMapping(0, 0, 0);
    const map = JSON.parse(b.generate("app.client.js"));
    // No content -> the key is absent (parsed.sourcesContent is undefined).
    expect(map.sourcesContent).toBeUndefined();
  });

  it("records per-line kinds: source vs synthetic", () => {
    const b = new SourceMapBuilder("app.scrml");
    b.addSourceMapping(0, 0, 5, 0, "count"); // source
    b.addSyntheticLine(1); // synthetic
    const map = JSON.parse(b.generate("app.client.js"));
    expect(map.x_scrml_kinds[0]).toBe("source");
    expect(map.x_scrml_kinds[1]).toBe("synthetic");
  });

  it("a generated line with no mapping is categorized synthetic", () => {
    const b = new SourceMapBuilder("app.scrml");
    b.addSourceMapping(0, 0, 1, 0);
    b.addSourceMapping(2, 0, 2, 0); // line 1 has no mapping
    const map = JSON.parse(b.generate("app.client.js"));
    expect(map.x_scrml_kinds[1]).toBe("synthetic");
  });
});

describe("collectAuthorBindings", () => {
  it("collects named declarations with their source positions", () => {
    const source = "<title>X</title>\n<count> = 0\nfn greet() {}\n";
    const idx = new LineIndex(source);
    const countStart = source.indexOf("<count>");
    const fnStart = source.indexOf("fn greet");
    const nodes = [
      { kind: "state-decl", name: "count", span: [countStart, countStart + 7] },
      { kind: "fn", name: "greet", span: [fnStart, fnStart + 12] },
    ];
    const bindings = collectAuthorBindings(nodes, idx);
    expect(bindings.get("count").sourceLine).toBe(1);
    expect(bindings.get("greet").sourceLine).toBe(2);
  });

  it("tolerates object-shaped spans ({start,end})", () => {
    const source = "<count> = 0\n";
    const idx = new LineIndex(source);
    const nodes = [{ kind: "state-decl", name: "count", span: { start: 0, end: 7 } }];
    const bindings = collectAuthorBindings(nodes, idx);
    expect(bindings.get("count")).toEqual({ name: "count", sourceLine: 0, sourceColumn: 0 });
  });

  it("ignores nodes without a name or span", () => {
    const idx = new LineIndex("x\n");
    const nodes = [
      { kind: "state-decl" }, // no name
      { kind: "fn", name: "f" }, // no span
      { kind: "markup", name: "div", span: [0, 1] }, // not a named-decl kind
    ];
    const bindings = collectAuthorBindings(nodes, idx);
    expect(bindings.size).toBe(0);
  });

  it("recurses into children and body", () => {
    const source = "component Card {\n  <n> = 0\n}\n";
    const idx = new LineIndex(source);
    const nStart = source.indexOf("<n>");
    const nodes = [
      {
        kind: "component",
        name: "Card",
        span: [0, 9],
        children: [{ kind: "state-decl", name: "n", span: [nStart, nStart + 3] }],
      },
    ];
    const bindings = collectAuthorBindings(nodes, idx);
    expect(bindings.has("Card")).toBe(true);
    expect(bindings.has("n")).toBe(true);
    expect(bindings.get("n").sourceLine).toBe(1);
  });
});

describe("build-source-map — B1 use-site provenance resolver", () => {
  // B1 records the source BYTE OFFSET at the USE site via a block-comment
  // sentinel riding inside the emitted string (see srcmap-provenance.ts). Tests
  // use the PURE formatSrcmapMark (gate-independent) so they never touch the
  // shared module gate. build-source-map converts the recorded byte offset to a
  // source line/col via a LineIndex over the source string.

  // The source the byte offsets index into. The USE site `@count = @count + 1`
  // lives on source line index 4 (0-based: title=0, <count>=1, blank=2, fn=3,
  // @count=...=4). The declaration `<count>` is on source line index 1.
  const source = [
    "<title>Counter</title>", // line 0
    "<count> = 0",            // line 1  (declaration)
    "",                       // line 2
    "fn increment() {",       // line 3
    "  @count = @count + 1",  // line 4  (the USE site)
    "}",                      // line 5
  ].join("\n");

  const declByte = source.indexOf("<count>");          // decl, line 1
  const useWriteByte = source.indexOf("  @count") + 2;  // write @count, line 4
  const useReadByte = source.indexOf("@count + 1");     // read @count, line 4
  const incrDeclByte = source.indexOf("fn increment");

  // Declaration AST (retained name-lookup concern). Not used to drive positions.
  const nodes = [
    { kind: "state-decl", name: "count", span: { start: declByte, end: declByte + 11 } },
    { kind: "fn", name: "increment", span: { start: incrDeclByte, end: incrDeclByte + 16 } },
  ];

  function decode(mapJson) {
    const map = JSON.parse(mapJson);
    const groups = map.mappings.split(";");
    const kinds = map.x_scrml_kinds || [];
    const names = map.names || [];
    let srcLine = 0, srcCol = 0, nameIdx = 0;
    const rows = [];
    groups.forEach((group, gLine) => {
      if (!group) return;
      let genCol = 0;
      for (const seg of group.split(",")) {
        const v = decodeVlqString(seg);
        genCol += v[0] ?? 0;
        let name = null;
        if (v.length >= 4) { srcLine += v[2]; srcCol += v[3]; }
        if (v.length >= 5) { nameIdx += v[4]; name = names[nameIdx]; }
        rows.push({ generatedLine: gLine, generatedColumn: genCol, sourceLine: srcLine, sourceColumn: srcCol, name, kind: kinds[gLine] });
      }
    });
    return rows;
  }

  // A marked client-JS fixture the way the emitter builds it: a USE of `@count`.
  function markedUseSite() {
    const setMark = formatSrcmapMark({ start: useWriteByte }, "count");
    const getMark = formatSrcmapMark({ start: useReadByte }, "count");
    return [
      'function _scrml_increment_2() {',
      `  ${setMark}_scrml_reactive_set("count", ${getMark}_scrml_reactive_get("count") + 1);`,
      '}',
    ].join("\n");
  }

  it("returns the marker-stripped JS as cleanedJs", () => {
    const marked = markedUseSite();
    expect(marked.includes("#scrmlmap#")).toBe(true);
    const { cleanedJs } = buildSourceMap(marked, "app.scrml", source, nodes);
    expect(cleanedJs.includes("#scrmlmap#")).toBe(false);
    expect(cleanedJs).toBe(stripSrcmapMarks(marked));
    expect(cleanedJs).toContain('_scrml_reactive_set("count"');
  });

  it("maps a USE site to its USE source line (NOT the declaration line)", () => {
    const marked = markedUseSite();
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const rows = decode(builder.generate("app.client.js"));
    const countRows = rows.filter((r) => r.name === "count");
    expect(countRows.length).toBeGreaterThan(0);
    // B1: maps to USE line 4; B2 mapped to decl line 1.
    expect(countRows.every((r) => r.sourceLine === 4)).toBe(true);
    expect(countRows.some((r) => r.sourceLine === 1)).toBe(false);
  });

  // Honest-synthetic validation (srcmap-attr-expr-relative-span fix). Some
  // upstream parse paths record a WRONG source byte offset for a use site: an
  // if/while/interpolation re-parsed with base offset 0 lands fragment-relative
  // (byte 2/13 -> the opening comment line); some node shapes record a wrong
  // ABSOLUTE offset (-> a mid-file line). The resolver must DROP any named mark
  // whose offset resolves to a line that does not contain the identifier — a
  // faked mapping is worse than none.
  it("DROPS a named mapping whose offset resolves to a line NOT containing the identifier", () => {
    // Byte 2 of `source` is on line 0 (`<title>Counter</title>`), which does NOT
    // contain the lowercase identifier `count` — a confidently-wrong position.
    const badMark = formatSrcmapMark({ start: 2 }, "count");
    const marked = [
      "function _scrml_increment_9() {",
      `  ${badMark}_scrml_reactive_get("count");`,
      "}",
    ].join("\n");
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const rows = decode(builder.generate("app.client.js"));
    // The wrong mark contributed NO named source mapping (it was dropped).
    expect(rows.some((r) => r.name === "count")).toBe(false);
    // The generated line falls back to synthetic rather than a wrong source pos.
    const map = JSON.parse(builder.generate("app.client.js"));
    expect((map.x_scrml_kinds || []).includes("source")).toBe(false);
  });

  it("KEEPS a named mapping whose offset resolves to a line that DOES contain the identifier", () => {
    // Contrast with the drop above: a CORRECT offset (line 4 holds `@count`) maps.
    const goodMark = formatSrcmapMark({ start: useReadByte }, "count");
    const marked = [
      "function _scrml_increment_9() {",
      `  ${goodMark}_scrml_reactive_get("count");`,
      "}",
    ].join("\n");
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const rows = decode(builder.generate("app.client.js"));
    expect(rows.some((r) => r.name === "count" && r.sourceLine === 4)).toBe(true);
  });

  it("places the mapping at the GENERATED column the fragment occupies", () => {
    const marked = markedUseSite();
    const { builder, cleanedJs } = buildSourceMap(marked, "app.scrml", source, nodes);
    const rows = decode(builder.generate("app.client.js"));
    const cleanedLines = cleanedJs.split("\n");
    const setCol = cleanedLines[1].indexOf('_scrml_reactive_set');
    const getCol = cleanedLines[1].indexOf('_scrml_reactive_get');
    const cols = rows.filter((r) => r.kind === "source").map((r) => r.generatedColumn);
    expect(cols).toContain(setCol);
    expect(cols).toContain(getCol);
  });

  it("registers the author name at the use site (names field)", () => {
    const marked = markedUseSite();
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const map = JSON.parse(builder.generate("app.client.js"));
    expect(map.names).toContain("count");
  });

  it("maps the USE site to the correct source COLUMN (byte-offset bridge)", () => {
    const marked = markedUseSite();
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const rows = decode(builder.generate("app.client.js")).filter((r) => r.kind === "source");
    // write @count at column 2 on line 4 ("  @count..."), read at column 11.
    const cols = rows.map((r) => r.sourceColumn).sort((a, b) => a - b);
    expect(cols).toContain(2);
    expect(cols).toContain(11);
  });

  it("categorizes non-use lines as synthetic", () => {
    const marked = markedUseSite();
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const map = JSON.parse(builder.generate("app.client.js"));
    const kinds = map.x_scrml_kinds || [];
    expect(kinds[0]).toBe("synthetic");
    expect(kinds.includes("source")).toBe(true);
    expect(kinds.includes("synthetic")).toBe(true);
  });

  it("produces an all-synthetic map when there are NO use-site markers", () => {
    const clientJs = 'function foo() { return 1; }\nconst y = 2;';
    const { builder } = buildSourceMap(clientJs, "app.scrml", source, nodes);
    const map = JSON.parse(builder.generate("app.client.js"));
    const kinds = map.x_scrml_kinds || [];
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "synthetic")).toBe(true);
    expect(map.names).toEqual([]);
  });

  it("is honest (all-synthetic) when no markers + empty source (harness path)", () => {
    // No markers at all -> every line synthetic, sourcesContent omitted. Never a
    // fake (0,0) author map.
    const compiledJs = "let _scrml_t_count = 0;";
    const { builder } = buildSourceMap(compiledJs, "counter.scrml", "", nodes);
    const map = JSON.parse(builder.generate("counter.client.js"));
    expect((map.x_scrml_kinds || []).every((k) => k === "synthetic")).toBe(true);
    expect(map.sourcesContent).toBeUndefined();
  });

  it("does NOT embed sourcesContent by default (privacy)", () => {
    const marked = markedUseSite();
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const map = JSON.parse(builder.generate("app.client.js"));
    expect(map.sourcesContent).toBeUndefined();
  });

  it("embeds sourcesContent only when explicitly opted in", () => {
    const marked = markedUseSite();
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes, true);
    const map = JSON.parse(builder.generate("app.client.js"));
    expect(map.sourcesContent).toEqual([source]);
  });

  it("multiple use sites each map to their own source line", () => {
    const m1 = formatSrcmapMark({ start: useWriteByte }, "count"); // line 4
    const m2 = formatSrcmapMark({ start: declByte }, "count");     // line 1
    const marked = [
      `  ${m1}_scrml_reactive_set("count", 1);`,
      `  ${m2}_scrml_reactive_set("count", 2);`,
    ].join("\n");
    const { builder } = buildSourceMap(marked, "app.scrml", source, nodes);
    const rows = decode(builder.generate("app.client.js")).filter((r) => r.kind === "source");
    const lines = rows.map((r) => r.sourceLine).sort((a, b) => a - b);
    expect(lines).toContain(1);
    expect(lines).toContain(4);
  });

  it("findSrcmapMarks recovers each marker's recorded byte offset + name", () => {
    const marked = `x = ${formatSrcmapMark({ start: 42 }, "score")}_scrml_reactive_get("score");`;
    const hits = findSrcmapMarks(marked);
    expect(hits.length).toBe(1);
    expect(hits[0].sourceByteOffset).toBe(42);
    expect(hits[0].name).toBe("score");
  });

  it("formatSrcmapMark emits a marker for a valid byte offset (gate-independent)", () => {
    const mk = formatSrcmapMark({ start: 17 }, "x");
    expect(mk.includes("#scrmlmap#")).toBe(true);
    expect(mk.includes("17,x")).toBe(true);
  });

  it("formatSrcmapMark emits no marker for an absent/non-positive offset (synthetic)", () => {
    // start <= 0 is the synthesized-node sentinel (e.g. interpolation-lowered
    // {@x} reads carry start === 0). A real use-site is never at byte 0 (files
    // open with markup), so start 0 -> no marker (stays synthetic, never (0,0)).
    expect(formatSrcmapMark(null, "x")).toBe("");
    expect(formatSrcmapMark({ start: -1 }, "x")).toBe("");
    expect(formatSrcmapMark({ start: 0 }, "x")).toBe("");
    expect(formatSrcmapMark({}, "x")).toBe("");
  });

  it("srcmapMark (gated) returns the formatted marker only while enabled", () => {
    enableSrcmapProvenance();
    const whileEnabled = srcmapMark({ start: 5 }, "x");
    disableSrcmapProvenance();
    expect(whileEnabled.includes("#scrmlmap#")).toBe(true);
  });

  it("collectAuthorBindings still recovers declaration positions (name lookup)", () => {
    // Retained declaration-name concern: collectAuthorBindings maps author names
    // to their DECLARATION line/col (for name fallback, not for mapping).
    const idx = new LineIndex(source);
    const bindings = collectAuthorBindings(nodes, idx);
    expect(bindings.get("count").sourceLine).toBe(1);
    expect(bindings.get("increment").sourceLine).toBe(3);
  });
});
