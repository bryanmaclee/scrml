/**
 * @module codegen/build-source-map
 *
 * Builds a real Source Map v3 for a compiled JS artifact (client or server)
 * from EMITTER-RECORDED USE-SITE source spans (B1).
 *
 * ---------------------------------------------------------------------------
 * B1 use-site resolution (source-map-use-site-spans-b1-2026-05-31)
 * ---------------------------------------------------------------------------
 * The PRIOR build (B2) derived provenance by re-scanning the final JS PER LINE
 * and mapping each line to the first author-name it mentioned — which resolved
 * every USE of a cell to its DECLARATION site (e.g. an `onclick` handler body
 * that writes `@count` mapped to the `<count>` declaration, not to the handler
 * line the code came from). That is the deep-dive's eliminated "post-hoc
 * re-derivation" approach: confidently wrong.
 *
 * B1 records the REAL source byte offset at the point each use-site fragment is
 * EMITTED. Because the emitters compose output as TEMPLATE-LITERAL STRINGS (no
 * generated offset exists until the whole file is assembled), the source byte
 * offset rides INSIDE the emitted string via a zero-content block-comment
 * sentinel placed immediately before the fragment (see srcmap-provenance.ts).
 *
 * This module is the POST-ASSEMBLY converter:
 *   1. Strip every sentinel -> the CLEAN, deployable JS (what callers ship).
 *   2. For each sentinel, compute the GENERATED line/col of the fragment it
 *      annotates from its position in the CLEANED output (a LineIndex over the
 *      clean JS), convert the recorded source BYTE OFFSET to a source line/col
 *      via a LineIndex over the SOURCE, and register the author name in `names`
 *      — so a use-site read/write resolves the encoded output identifier back to
 *      the author name AT THE USE.
 *   3. Generated lines with no sentinel carry no author origin and are
 *      categorized SYNTHETIC (preamble / wiring / boilerplate) — never a fake
 *      (0,0) author position.
 *
 * `collectAuthorBindings` (the declaration AST walk) is RETAINED only as a
 * legitimate declaration-name concern (an encoded-identifier -> author-name
 * lookup). It no longer DRIVES mapping positions — use-site byte offsets do.
 *
 * SPEC §47 prose promises this debugging path; PIPELINE.md §Stage 8 owns it.
 */

import { SourceMapBuilder, LineIndex } from "./source-map.ts";
import { findSrcmapMarks, stripSrcmapMarks } from "./srcmap-provenance.ts";

// ---------------------------------------------------------------------------
// Author-name table (declaration walk — retained for name-fallback only)
// ---------------------------------------------------------------------------

/** A named author construct, with the source position of its declaration. */
export interface AuthorBinding {
  name: string;
  /** 0-indexed source line of the declaration. */
  sourceLine: number;
  /** 0-indexed source column of the declaration. */
  sourceColumn: number;
}

/** AST node shape (loose — codegen reads untyped AST). */
interface LooseNode {
  kind?: string;
  name?: string;
  identifier?: string;
  varName?: string;
  cellName?: string;
  span?: [number, number] | { start?: number; end?: number } | null;
  children?: unknown;
  body?: unknown;
}

/** Node kinds that introduce a named author binding worth recording. */
const NAMED_DECL_KINDS = new Set<string>([
  "state-decl",
  "fn",
  "function",
  "component",
  "engine",
  "machine",
  "type-decl",
  "enum-decl",
  "struct-decl",
]);

/** Extract a span's START byte offset, tolerating both span shapes. */
function spanStart(span: LooseNode["span"]): number | null {
  if (Array.isArray(span)) return typeof span[0] === "number" ? span[0] : null;
  if (span && typeof span === "object" && typeof span.start === "number") return span.start;
  return null;
}

/** Read the author name off a node, tolerating field-name variation. */
function nodeName(node: LooseNode): string | null {
  const n = node.name ?? node.identifier ?? node.varName ?? node.cellName;
  return typeof n === "string" && n.length > 0 ? n : null;
}

/**
 * Walk the file AST and collect every named declaration's source position.
 * Returns a Map<authorName, AuthorBinding>. First declaration wins on duplicate
 * names. RETAINED as a declaration-name concern (the `names` field is a name
 * lookup, not a position source). Not used to DRIVE mapping positions in B1.
 */
export function collectAuthorBindings(nodes: unknown, lineIndex: LineIndex): Map<string, AuthorBinding> {
  const bindings = new Map<string, AuthorBinding>();

  function walk(list: unknown): void {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const node = raw as LooseNode;
      if (!node || typeof node !== "object") continue;

      if (typeof node.kind === "string" && NAMED_DECL_KINDS.has(node.kind)) {
        const name = nodeName(node);
        const start = spanStart(node.span);
        if (name && start !== null && !bindings.has(name)) {
          const { line, column } = lineIndex.locate(start);
          bindings.set(name, { name, sourceLine: line, sourceColumn: column });
        }
      }

      // Recurse — named declarations can nest (component / engine bodies).
      if (Array.isArray(node.children)) walk(node.children);
      if (Array.isArray(node.body)) walk(node.body);
    }
  }

  walk(nodes);
  return bindings;
}

// ---------------------------------------------------------------------------
// Public entry: convert use-site markers -> populated builder + cleaned JS
// ---------------------------------------------------------------------------

/** Result of building a source map: the builder + the marker-stripped JS. */
export interface BuildSourceMapResult {
  builder: SourceMapBuilder;
  /** The final, deployable JS with every use-site sentinel removed. */
  cleanedJs: string;
}

/**
 * Build a populated SourceMapBuilder for a compiled JS artifact from B1
 * use-site markers, AND return the marker-stripped (clean) JS the caller ships.
 *
 * @param markedJs       — the assembled JS, still carrying use-site sentinels
 *                         (in sourceMap mode; with no sentinels — e.g. a file
 *                         with no reactive use-sites — the map is honestly
 *                         all-synthetic rather than a fake 0:0).
 * @param sourceBasename — basename of the .scrml source (e.g. "app.scrml")
 * @param sourceContent  — the exact source string the byte offsets index into.
 *                         Used to convert each recorded use-site byte offset to a
 *                         source line/col (the authoritative bridge). NOT embedded
 *                         unless `embedSourceContent` is set (privacy default OFF).
 * @param astNodes       — the file's top-level AST node array (declaration names)
 * @param embedSourceContent — embed sourceContent into the map (default OFF;
 *                         server-fn bodies / secrets must not leak into a
 *                         deployable `.client.js.map`).
 */
export function buildSourceMap(
  markedJs: string,
  sourceBasename: string,
  sourceContent: string,
  astNodes: unknown,
  embedSourceContent = false
): BuildSourceMapResult {
  // 1. The deployable artifact is the marker-stripped JS. Every generated
  //    position below is computed against THIS string (the bytes that ship).
  const cleanedJs = stripSrcmapMarks(markedJs);
  const outputIndex = new LineIndex(cleanedJs);
  // The authoritative source byte-offset -> line/col bridge (the encoder's own).
  const sourceIndex = new LineIndex(sourceContent);
  // Source lines, for the honest-synthetic validation in the mapping loop below.
  const sourceLines = sourceContent.split("\n");

  // 2. Locate every use-site marker in the ORIGINAL (marker-bearing) JS, in
  //    source order. Each marker annotates the fragment immediately after it.
  const hits = findSrcmapMarks(markedJs);

  const builder = new SourceMapBuilder(
    sourceBasename,
    embedSourceContent && sourceContent.length > 0 ? sourceContent : null
  );

  // `collectAuthorBindings` retained for the declaration-name concern (a future
  // name fallback for declaration-only outputs); it is intentionally NOT used to
  // drive mapping positions in B1. Reference it so the export stays exercised.
  void collectAuthorBindings;

  // Track which generated (cleaned) lines received at least one use-site mapping
  // so the remaining lines are categorized synthetic.
  const mappedLines = new Set<number>();

  // As markers are stripped, every byte AFTER a marker shifts LEFT by the
  // cumulative length of all preceding markers (plus the current one). So the
  // CLEANED offset of the fragment that followed marker `hit` is:
  //   hit.index - (sum of raw lengths of markers strictly before it) - hit.raw.length
  let removedSoFar = 0;
  for (const hit of hits) {
    const fragmentCleanedOffset = hit.index - removedSoFar;
    removedSoFar += hit.raw.length;

    const gen = outputIndex.locate(fragmentCleanedOffset);
    // Convert the recorded source byte offset to a 0-based source line/col via
    // the authoritative LineIndex over the source (Source Map v3 is 0-based and
    // LineIndex.locate returns 0-based line/column).
    const srcPos = sourceIndex.locate(hit.sourceByteOffset);
    const name = hit.name.length > 0 ? hit.name : undefined;

    // Honest-synthetic validation. A use-site mark's recorded source byte offset
    // must resolve to a line that ACTUALLY CONTAINS the bound identifier. Some
    // upstream parse paths emit a wrong byte offset for the use site: an
    // `if`/`while` condition or `${...}` interpolation re-parsed with base offset
    // 0 records a FRAGMENT-RELATIVE offset (the read lands at byte 2 / 13 → the
    // file's opening comment line), and certain node shapes (object-literal props,
    // worker/channel `if=` reads, reactive assigns) record a wrong ABSOLUTE offset
    // (→ a mid-file line that doesn't hold the name). A mapping that points at a
    // line NOT mentioning the identifier is a confidently-wrong author position —
    // a LIE, and a faked mapping is worse than none. Drop it: skip the named
    // mapping (and leave gen.line for the synthetic fallback below) rather than
    // ship the wrong position. Line-granularity check by design — a right-line /
    // wrong-column mark is kept (devtools still jumps to the correct line); only
    // wrong-LINE marks are dropped. INTERIM: the complete fix threads the real
    // absolute base offset through the offset-0 parse sites so these reads gain
    // CORRECT provenance (queued as the srcmap-offset-threading arc; see hand-off
    // + known-gaps). Until then this guarantees the map never lies about the line.
    if (name !== undefined) {
      const srcLine = sourceLines[srcPos.line];
      if (srcLine === undefined || !srcLine.includes(name)) {
        continue;
      }
    }

    builder.addSourceMapping(gen.line, gen.column, srcPos.line, srcPos.column, name);
    mappedLines.add(gen.line);
  }

  // 3. Categorize every remaining generated line as synthetic (no use-site
  //    origin: preamble / wiring / boilerplate). Recording them explicitly keeps
  //    the x_scrml_kinds sidecar dense and the contract honest line-by-line.
  const lineCount = cleanedJs.split("\n").length;
  for (let i = 0; i < lineCount; i++) {
    if (!mappedLines.has(i)) builder.addSyntheticLine(i);
  }

  return { builder, cleanedJs };
}
