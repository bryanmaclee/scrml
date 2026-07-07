/**
 * @module block-analysis
 *
 * D2 — the block-analysis sidecar BUILDER + serializer.
 *
 * Projects every named block in a `.scrml` file (function / component / engine /
 * type / channel) into a deterministic, pretty-printed JSON artifact —
 * `<base>.block-analysis.json` (written by D3's `--emit-block-analysis` flag) —
 * that flogence's block-lease / dock tooling consumes INSTEAD of running a
 * second (regex) parser over the source (the drift-avoidance architecture,
 * SCOPE §0). Each block carries its EXACT source span (from the AST `span`
 * field) and, for blocks with a structured logic body, its SHALLOW dotted-path
 * read/write footprint (computed by D1's `footprintForBlock`).
 *
 * This is PURE data exposure — no new analysis beyond the footprint D1 already
 * built, no SPEC change, no runtime behavior change, no body-DG touch. The
 * artifact dissolves dock's next-def-boundary heuristic (true AST spans) and
 * gives the lease the dotted-grain footprint the body-DG's root-cell `reads`/
 * `writes` are deliberately too coarse for (SCOPE §1 Fact 1/2).
 *
 * What we project, per block in the file:
 *   {
 *     "id": "<relpath>::<name>",      // the lease anchor (dock's existing key)
 *     "kind": "function",             // function|component|engine|type|channel
 *     "name": "sendMessage",
 *     "span": { "start": 5412, "end": 5901, "line": 154, "endLine": 171 },
 *     "reads":  ["currentDriver", "messageForm.draft"],   // SORTED dotted, no @
 *     "writes": ["errorMessage", "messageForm.draft"],
 *     "footprintDepth": "shallow"     // honesty marker (transitive = later slice)
 *   }
 *
 * Additionally, per `type` block (fn/component/engine/channel are UNCHANGED):
 *   "typeShape": "enum",              // struct | enum | error | refinement
 *   "members": [                      // struct fields / enum variants, source order
 *     { "name": "Sha", "memberKind": "variant", "typeText": "(hash:string)",
 *       "span": { "start": 812, "end": 828 },
 *       "args": [ { "name": "hash", "typeText": "string",
 *                   "span": { "start": 816, "end": 827 } } ] }
 *   ]
 * And per block of EVERY kind:
 *   "bodySpan": { "start": 780, "end": 831 }   // tight body-close (see below)
 *
 * ALL member/arg spans + `bodySpan` are ABSOLUTE byte offsets into the RAW
 * source — the SAME basis as `span.start`/`.end` — so a consumer slices one
 * member out with `source.slice(m.span.start, m.span.end)` directly (a struct
 * field's span covers `name: type`; a variant's covers `Name(args)`). `bodySpan`
 * ends at the entity's body-close (`}`), NOT in the trailing trivia `span.end`
 * includes (which, for a `type` decl, runs into the following token — the
 * splice-welds-`}appState>` workaround the consumers carried). `typeShape` /
 * `members` are `type`-only; every existing field is byte-unchanged on every
 * block kind (purely additive). Member NAMES + KINDS are drift-guarded against
 * the compiler's canonical `parseStructBody` / `parseEnumBody`.
 *
 * `line`/`endLine` are the load-bearing diff-scope fields — raw `git diff` line
 * ranges map onto source lines, so the consumer compares against `span.line`
 * (which TAB maps back to the original source), NOT byte offsets (SCOPE §3).
 * type / channel blocks carry empty footprints (honest-empty: they declare no
 * reactive reads/writes). v1 footprint depth is uniformly `"shallow"`.
 *
 * Determinism (mirrors `engine-graph.ts` + the reachability serializer):
 *   - Blocks emitted in SOURCE ORDER (`span.start` ascending).
 *   - `reads` / `writes` SORTED + de-duplicated (D1 returns them sorted).
 *   - Stable object key order via fixed literal-key construction.
 *   - `JSON.stringify(_, null, 2) + "\n"`.
 * Two compiles of the same source produce byte-identical output.
 *
 * Node discovery REUSES the canonical FileAST collections + codegen collectors
 * (`collectC12EngineDecls` / `collectC14DerivedEngineDecls`) so this sidecar
 * sees EXACTLY the blocks the rest of the pipeline does — no separate walk to
 * drift out of sync.
 *
 * Cross-references:
 *   - docs/changes/block-analysis-emit-2026-06-18/SCOPE-AND-DECOMPOSITION.md
 *   - compiler/src/block-analysis-footprint.ts — `footprintForBlock` (D1).
 *   - compiler/src/engine-graph.ts — the sidecar pattern this mirrors.
 *   - compiler/src/types/ast.ts — FunctionDeclNode / ComponentDefNode /
 *     EngineDeclNode / TypeDeclNode / ChannelDeclNode / FileAST / Span.
 */

import { footprintForBlock } from "./block-analysis-footprint.ts";
import {
  collectC12EngineDecls,
  collectC14DerivedEngineDecls,
} from "./codegen/emit-engine.ts";

// ---------------------------------------------------------------------------
// Local shape mirrors (the fields we read off the FileAST / block nodes).
// Mirrored — not imported — to keep this module's type-import surface lean,
// matching the precedent in engine-graph.ts. Loose `unknown`-keyed records
// because the collectors hand back lightly-typed nodes.
// ---------------------------------------------------------------------------

/** A loosely-typed AST node. */
type AnyNode = Record<string, unknown>;

/** The byte/line span every AST node carries (`ast.ts` `Span`). */
interface SpanShape {
  start?: number;
  end?: number;
  line?: number;
  /** Origin file of the spanned node — set by the parser; differs from the
   *  file under analysis for import-inlined nodes (the D6 phantom discriminator). */
  file?: string;
}

// ---------------------------------------------------------------------------
// Emitted-JSON projection shapes (the public artifact contract).
// ---------------------------------------------------------------------------

/** The lease kind of a block. */
export type BlockKind = "function" | "component" | "engine" | "type" | "channel";

/** A block's source span: byte offsets + 1-based first/last line. */
export interface BlockSpan {
  /** Byte offset of the first character. */
  start: number;
  /** Byte offset one past the last character. */
  end: number;
  /** 1-based line of the block opener (the diff-scope anchor). */
  line: number;
  /** 1-based line of the block's last character. */
  endLine: number;
}

/** A byte-offset span `[start, end)` into the RAW source — the SAME coordinate
 *  basis as `BlockSpan.start`/`.end`. A consumer slices it directly:
 *  `source.slice(span.start, span.end)`. */
export interface ByteSpan {
  /** Byte offset of the first character. */
  start: number;
  /** Byte offset one past the last character. */
  end: number;
}

/** The structural shape of a `type` block. `"error"` (§19.3) is field-bearing
 *  like a struct — the type-system parses its body with `parseStructBody`, so it
 *  carries `field` members. `"refinement"` is the catch-all for any type the
 *  type-system resolves to NO fields (aliases, unions, predicated refinements,
 *  and `tuple`, which resolves to `tAsIs`) — those carry `members: []`. */
export type TypeShape = "struct" | "enum" | "error" | "refinement";

/** Whether a `type` member is a struct field or an enum variant. */
export type MemberKind = "field" | "variant";

/** One constructor argument of an enum variant. Named args carry their declared
 *  name; positional args get the compiler's stable `_0` / `_1` / … key — the
 *  SAME synthetic key `parseEnumBody` assigns (§18.7 positional bindings). */
export interface MemberArg {
  /** Declared arg name, or the positional `_<i>` key. */
  name: string;
  /** Verbatim source surface of the arg's type. */
  typeText: string;
  /** Absolute `[start, end)` covering this arg (name + type when named, or the
   *  bare type when positional). */
  span: ByteSpan;
}

/** One member of a `type` block — a struct field or an enum variant. Emitted in
 *  SOURCE ORDER. */
export interface TypeMember {
  /** Field name (struct) or variant name (enum). */
  name: string;
  memberKind: MemberKind;
  /** struct field → the verbatim source surface of the field's TYPE (the text
   *  after the `:`). enum variant → the verbatim payload signature `(...)`, or
   *  `""` for a unit variant. Load-bearing: lifts merge-collision detection from
   *  name-only to name+type (identical member on both sides = auto-resolvable). */
  typeText: string;
  /** Absolute `[start, end)` covering the FULL member (field name → type, or
   *  variant name → arg-tuple close), EXCLUDING any bar-form `.` prefix and any
   *  trailing `renders` clause. splice-one-member is a pure
   *  `source.slice(span.start, span.end)`. */
  span: ByteSpan;
  /** Enum variants ONLY: the constructor arg-tuple, in source order (empty for a
   *  unit variant). Absent on struct fields. */
  args?: MemberArg[];
}

/** One block in the file's block-analysis projection. */
export interface BlockAnalysisBlock {
  /** `<relpath>::<name>` — the lease anchor (dock's existing key). */
  id: string;
  kind: BlockKind;
  name: string;
  span: BlockSpan;
  /** SHALLOW dotted-path reads (sorted, de-duplicated, no `@`). */
  reads: string[];
  /** SHALLOW dotted-path writes (sorted, de-duplicated, no `@`). */
  writes: string[];
  /** Honesty marker — v1 is uniformly `"shallow"` (no call-graph). */
  footprintDepth: "shallow";
  /** Tight span bounded at the entity's body-close (the `}` / last content
   *  char), absolute offsets — UNLIKE `span.end`, which may run past the close
   *  into trailing trivia (or, for a `type` decl, into the FOLLOWING token). A
   *  consumer splices `[bodySpan.start, bodySpan.end)` without a re-derivation.
   *  Precise (brace-bounded) for `type` blocks; trailing-trivia-trimmed for the
   *  other kinds. Present on EVERY block kind (additive). */
  bodySpan: ByteSpan;
  /** `type` blocks ONLY — the structural shape. Absent on other kinds. */
  typeShape?: TypeShape;
  /** `type` blocks ONLY — struct fields / enum variants in SOURCE ORDER (an
   *  honest-empty `[]` for a refinement / body-less type, or when no source is
   *  threaded). Absent on other kinds. */
  members?: TypeMember[];
}

/** Top-level artifact shape. Honest-empty `{ version, file, blocks: [] }` for a
 *  file with no named blocks (NOT an error). */
export interface BlockAnalysis {
  version: 1;
  file: string;
  blocks: BlockAnalysisBlock[];
}

// ---------------------------------------------------------------------------
// FileAST normalization + relative-path resolution
// ---------------------------------------------------------------------------

/**
 * Normalize the orchestrator's per-file object to the underlying FileAST. The
 * orchestrator may hand us the AST directly (`{ nodes, components, ... }`) or
 * wrapped (`{ ast: {...} }`) — mirror the collectors' dual-shape tolerance.
 */
function unwrapFileAST(file: unknown): AnyNode | undefined {
  if (!file || typeof file !== "object") return undefined;
  const obj = file as AnyNode;
  const inner = obj.ast;
  if (inner && typeof inner === "object") return inner as AnyNode;
  return obj;
}

/**
 * Recover the per-file SOURCE TEXT the orchestrator threads on its wrapped
 * per-file object. The api.js CE loop re-attaches the RAW file source (the same
 * text the Block Splitter + TAB built the AST spans against — `readFileSync` of
 * the `.scrml` file, see api.js `sourceByFile`) as `_sourceText` on the OUTER
 * `{ filePath, ast, _sourceText }` object, NOT on the inner `ast`. The earlier
 * `source` / `preprocessedSource` fallbacks remain for any caller that hands the
 * AST directly with those fields set; `_sourceText` is the live-pipeline field.
 *
 * CRITICAL — span coordinate basis: AST `span.start` / `span.end` / `span.line`
 * all index into this RAW source (BS/TAB never rewrites byte positions), so
 * `endLine` derived from a slice of `_sourceText` lands on the correct RAW line.
 * Passing a preprocessed (`${...}`-expanded) text here would be off-by-lines.
 */
function sourceFromFile(file: unknown): string | undefined {
  if (!file || typeof file !== "object") return undefined;
  const obj = file as AnyNode;
  if (typeof obj._sourceText === "string") return obj._sourceText;
  if (typeof obj.source === "string") return obj.source as string;
  if (typeof obj.preprocessedSource === "string") return obj.preprocessedSource as string;
  return undefined;
}

/**
 * The repo-relative path used in the block `id` and the artifact `file` field.
 *
 * `id` is dock's existing `<relpath>::<name>` key, so zero consumer churn. We
 * derive the relative path by stripping everything up to and including the
 * first `examples/`, `compiler/`, `stdlib/`, `samples/`, `scripts/`, `src/`, or
 * `tests/` segment when present (the project-root anchors), else fall back to
 * the absolute path verbatim (the consumer keys on whatever the compiler
 * emits — determinism, not a specific root, is the contract). Always uses `/`.
 */
function relativeFilePath(filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) return "";
  const normalized = filePath.replace(/\\/g, "/");
  // Anchor on the first project-root directory segment we recognize so the
  // `id` is stable across machines (absolute prefixes differ; the in-repo
  // path does not). Order longest-first is irrelevant — first match wins on
  // position, and these are disjoint roots.
  const ANCHORS = ["examples/", "compiler/", "stdlib/", "samples/", "scripts/", "src/", "tests/"];
  let best = -1;
  for (const anchor of ANCHORS) {
    const idx = normalized.indexOf(anchor);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best === -1 ? normalized : normalized.slice(best);
}

// ---------------------------------------------------------------------------
// Span projection
// ---------------------------------------------------------------------------

const NEWLINE = /\n/g;

/**
 * Project a node's `span` into the artifact's `{ start, end, line, endLine }`.
 *
 * `start` / `end` are byte offsets; `line` is the 1-based opener line the AST
 * already carries. `endLine` is NOT a field the AST tracks, so we derive it:
 * `line` plus the count of newlines BEFORE the block's LAST content character.
 *
 * The last content character sits at byte `end - 1` (`end` is one-past-the-last).
 * We count newlines in the slice `[start, end - 1)` — i.e. up to but EXCLUDING
 * that last character — so the result is the 1-based line of `source[end - 1]`.
 * Excluding `end - 1` is load-bearing: an AST `span.end` may include a trailing
 * newline AFTER the block's closing `}` (observed on top-level function decls).
 * Counting `[start, end)` would count that trailing newline and over-report
 * `endLine` by one line. `[start, end - 1)` lands on the closing-brace line in
 * BOTH forms (trailing-newline present or absent) — verified on the bigFn repro.
 *
 * The full source text is threaded in so the slice is exact; when absent (a unit
 * test feeding synthetic nodes with no `source`), `endLine` falls back to `line`
 * — an honest single-line approximation that never claims a span it can't
 * substantiate.
 */
function projectSpan(span: SpanShape | undefined, source: string | undefined): BlockSpan {
  const start = typeof span?.start === "number" ? span.start : 0;
  const end = typeof span?.end === "number" ? span.end : start;
  const line = typeof span?.line === "number" ? span.line : 1;

  let endLine = line;
  if (typeof source === "string" && end > start && end <= source.length) {
    // Slice up to the LAST content character (byte `end - 1`), excluding it, so
    // a trailing newline inside the span never inflates the line count.
    const slice = source.slice(start, end - 1);
    const matches = slice.match(NEWLINE);
    endLine = line + (matches ? matches.length : 0);
  }

  return { start, end, line, endLine };
}

// ---------------------------------------------------------------------------
// Type member projection (struct fields + enum variants)
//
// OFFSET BASIS: every member `span`, arg `span`, and the block `bodySpan` is
// ABSOLUTE byte offsets into the RAW source — the SAME basis as the block
// `span.start`/`.end`. A consumer slices them directly (`source.slice(a, b)`),
// so splice-one-member is a pure slice.
//
// GRAMMAR OF RECORD: the member NAMES + KINDS this produces are drift-guarded
// (block-analysis-type-members.test.js) to equal the compiler's canonical
// `parseStructBody` / `parseEnumBody` output. We parse the VERBATIM source, NOT
// the node's `raw` — the AST builder rebuilds `raw` from tokens with normalized
// whitespace, stripped comments, and re-quoted strings, so `raw` offsets do NOT
// map back to the source. Comments are masked (blanked to spaces, offsets
// preserved) before structural scanning so a `:` / `(` / delimiter inside a
// trailing `// …` comment never mis-splits a member.
// ---------------------------------------------------------------------------

/** Derive the `typeShape` from the type-decl's `typeKind` modifier. Everything
 *  that is not `struct` / `enum` is the `refinement` catch-all (alias, union,
 *  predicated refinement, tuple) — those carry no members. */
function deriveTypeShape(typeKind: string): TypeShape {
  if (typeKind === "struct") return "struct";
  if (typeKind === "enum") return "enum";
  // §19.3 — a user-defined error type is field-bearing (the type-system parses
  // its body with parseStructBody), so it gets struct-shaped `field` members.
  // `tuple` + aliases resolve to no fields (tAsIs) → the refinement catch-all.
  if (typeKind === "error") return "error";
  return "refinement";
}

/**
 * Return a same-length copy of `s` with every COMMENT character replaced by a
 * space (offsets preserved 1:1) — so top-level structure scanning is not fooled
 * by a `:` / `,` / `(` sitting in a comment the canonical `parseStructBody` /
 * `parseEnumBody` never sees (the AST builder strips comments from `raw`).
 * String literals are left verbatim — a `//` inside a string is NOT a comment —
 * and NEWLINES are preserved (they are member delimiters).
 */
function maskComments(s: string): string {
  const out = s.split("");
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    // String literal — skip to the matching delimiter (honor `\` escape).
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (s[i] === "\\") { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // Line comment — blank through end of line (keep the newline: it delimits).
    if (ch === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    // Block comment — blank through the closing `*/` (newlines stay newlines).
    if (ch === "/" && s[i + 1] === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < n) {
        if (s[i] === "*" && s[i + 1] === "/") { out[i] = " "; out[i + 1] = " "; i += 2; break; }
        if (s[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Skip a string literal in `masked` starting at the opening delimiter `i`;
 *  returns the index just past the closing delimiter. */
function skipMaskedString(masked: string, i: number, hi: number): number {
  const quote = masked[i];
  i++;
  while (i < hi) {
    if (masked[i] === "\\") { i += 2; continue; }
    if (masked[i] === quote) { i++; break; }
    i++;
  }
  return i;
}

/**
 * Split `masked[lo, hi)` on any char in `delims` at bracket-depth 0 and OUTSIDE
 * string literals, returning each part's `[start, end)` (indices into `masked`,
 * which shares coordinates with the source). Mirrors `type-system.splitTopLevel`
 * (bracket-depth aware) but tracks strings and yields spans, not strings.
 */
function splitTopLevelSpans(
  masked: string,
  lo: number,
  hi: number,
  delims: Set<string>,
): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let partStart = lo;
  let i = lo;
  while (i < hi) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, hi); continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; i++; continue; }
    if (depth === 0 && delims.has(ch)) {
      parts.push({ start: partStart, end: i });
      partStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  if (partStart < hi) parts.push({ start: partStart, end: hi });
  return parts;
}

/**
 * Locate the type body's outer `{ … }` in a PRE-MASKED decl buffer (comments
 * already blanked). Returns the opening `{` + its matching `}`, buffer-relative
 * (add the buffer's base offset for absolute positions). Returns undefined for a
 * brace-less type (a refinement, alias, `type X: struct` with no body, or the
 * bar-form enum).
 */
function findBracesInMasked(masked: string): { open: number; close: number } | undefined {
  const len = masked.length;
  // First `{` (a type-decl header carries no brace) is the body opener.
  let open = -1;
  for (let i = 0; i < len; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, len) - 1; continue; }
    if (ch === "{") { open = i; break; }
  }
  if (open === -1) return undefined;
  let depth = 0;
  for (let i = open; i < len; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, len) - 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return { open, close: i }; }
  }
  return undefined;
}

/**
 * Bound a BRACE-LESS type body in a PRE-MASKED decl buffer — the §14.4 bar-form
 * enum (`type X:enum = .A | .B`) AND a refinement / alias RHS (`type A = string
 * | number`). The AST builder discards the tight expression span (only the
 * OVERSHOOTING decl span + the normalized `raw` survive), so we recover the body
 * extent from the buffer: `end` = the first top-level `}` (the enclosing `${}`
 * close) or a newline NOT continued by a leading `|` (trailing-trimmed).
 * `memberStart` (buffer-relative) is where a bar-form enum's variant list begins
 * — just past the top-level `=` — or -1 when there is no `=`.
 *
 * Bounding `end` here is what keeps a refinement's `bodySpan` from welding the
 * FOLLOWING decl (`span.end` runs into the next token). Returns undefined for an
 * empty body. All offsets are buffer-relative.
 */
function findBraceLessBody(masked: string): { memberStart: number; end: number } | undefined {
  const len = masked.length;
  let depth = 0;
  let eq = -1;
  let end = len;
  let i = 0;
  while (i < len) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, len); continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]") { depth--; i++; continue; }
    if (ch === "}") { if (depth === 0) { end = i; break; } depth--; i++; continue; }
    if (depth === 0 && ch === "=" && eq === -1) { eq = i; i++; continue; }
    if (depth === 0 && ch === "\n") {
      let j = i + 1;
      while (j < len && /[ \t\r]/.test(masked[j])) j++;
      if (masked[j] !== "|") { end = i; break; } // a leading `|` continues the list
    }
    i++;
  }
  while (end > 0 && /\s/.test(masked[end - 1])) end--;
  if (end <= 0) return undefined;
  let memberStart = -1;
  if (eq !== -1) {
    memberStart = eq + 1;
    while (memberStart < end && /\s/.test(masked[memberStart])) memberStart++;
    if (memberStart >= end) memberStart = -1;
  }
  return { memberStart, end };
}


/** Match the paren opened at `openIdx` in `masked` within `[.., hi)`; returns
 *  the index of the closing `)`, or -1 when unbalanced. */
function matchParen(masked: string, openIdx: number, hi: number): number {
  let depth = 0;
  for (let i = openIdx; i < hi; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, hi) - 1; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Index of the FIRST `:` at paren/brace/bracket depth 0 (outside strings) in
 *  `masked[lo, hi)`, or -1. A `:` nested inside a type — `fn(e:Event)`, `{x:int}`
 *  — is NOT a name/type separator, so a depth-0 scan is load-bearing for
 *  positional-vs-named arg classification (§18.7). */
function firstTopLevelColon(masked: string, lo: number, hi: number): number {
  let depth = 0;
  for (let i = lo; i < hi; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, hi) - 1; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (depth === 0 && ch === ":") return i;
  }
  return -1;
}

/** Is `masked[i]` a word-start of the keyword `word` at depth 0 (boundary before,
 *  and — for `renders`/`transitions` — the required follower)? Generic helper. */
function isKeywordAt(masked: string, i: number, word: string): boolean {
  if (!masked.startsWith(word, i)) return false;
  const before = i === 0 ? "" : masked[i - 1];
  return i === 0 || !/[A-Za-z0-9_$]/.test(before);
}

/** §51.2 — index at which the trailing `transitions { … }` block begins (so it
 *  is never mis-read as a variant), or `masked.length` when absent. Mirrors the
 *  canonical `parseEnumBody` transitions scan. */
function findTransitionsCut(masked: string): number {
  const n = masked.length;
  let depth = 0;
  let i = 0;
  while (i < n) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, n); continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; i++; continue; }
    if (depth === 0 && isKeywordAt(masked, i, "transitions")) {
      let j = i + "transitions".length;
      while (j < n && /\s/.test(masked[j])) j++;
      if (masked[j] === "{") return i;
    }
    i++;
  }
  return n;
}

/** Index of a top-level `renders` keyword within `masked[ps, pe)` (a rendering
 *  annotation on an enum variant, not part of its type identity), or -1. */
function findRendersCut(masked: string, ps: number, pe: number): number {
  let depth = 0;
  for (let i = ps; i < pe; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipMaskedString(masked, i, pe) - 1; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (depth === 0 && isKeywordAt(masked, i, "renders")) {
      const after = i + "renders".length < pe ? masked[i + "renders".length] : " ";
      const before = i > ps ? masked[i - 1] : " ";
      if (/\s/.test(before) && /\s/.test(after)) return i;
    }
  }
  return -1;
}

/** Trim leading/trailing whitespace off `[ps, pe)` using `masked` (so a trailing
 *  comment — already blanked to spaces — is trimmed away). Returns the tightened
 *  `[start, end)` (start >= end signals an empty part). */
function trimSpan(masked: string, ps: number, pe: number): { start: number; end: number } {
  let s = ps;
  let e = pe;
  while (s < e && /\s/.test(masked[s])) s++;
  while (e > s && /\s/.test(masked[e - 1])) e--;
  return { start: s, end: e };
}

/**
 * Parse a struct body's fields from the VERBATIM source over the member-list
 * region `[innerStart, innerEnd)` (inside the braces). Mirrors `parseStructBody`
 * recognition (`name: typeExpr`, split on top-level `,` / newline; the same
 * field-name regex) but tracks absolute offsets + keeps `typeText` verbatim.
 */
function parseStructMembers(source: string, maskedDecl: string, declBase: number, innerStart: number, innerEnd: number): TypeMember[] {
  const base = innerStart;
  const inner = source.slice(base, innerEnd);
  const masked = maskedDecl.slice(innerStart - declBase, innerEnd - declBase);
  const parts = splitTopLevelSpans(masked, 0, masked.length, new Set([",", "\n"]));
  const members: TypeMember[] = [];
  for (const part of parts) {
    const { start: ps, end: pe } = trimSpan(masked, part.start, part.end);
    if (ps >= pe) continue;
    const colonIdx = firstTopLevelColon(masked, ps, pe);
    if (colonIdx === -1) continue;
    // Field name (trim any whitespace between name and the colon).
    let nameEnd = colonIdx;
    while (nameEnd > ps && /\s/.test(masked[nameEnd - 1])) nameEnd--;
    const name = inner.slice(ps, nameEnd);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    // Field type (verbatim, leading whitespace after the colon skipped).
    let typeStart = colonIdx + 1;
    while (typeStart < pe && /\s/.test(masked[typeStart])) typeStart++;
    const typeText = inner.slice(typeStart, pe);
    members.push({
      name,
      memberKind: "field",
      typeText,
      span: { start: base + ps, end: base + pe },
    });
  }
  return members;
}

/**
 * Parse an enum variant's constructor arg-tuple from `masked[lo, hi)` (the
 * interior of the payload parens). Named args → declared name + verbatim type;
 * positional args → the `_<i>` synthetic key `parseEnumBody` assigns, keyed on
 * the arg's tuple INDEX (an empty part from a trailing comma consumes an index).
 */
function parseVariantArgs(
  inner: string,
  masked: string,
  base: number,
  lo: number,
  hi: number,
): MemberArg[] {
  const argParts = splitTopLevelSpans(masked, lo, hi, new Set([","]));
  const args: MemberArg[] = [];
  for (let i = 0; i < argParts.length; i++) {
    const { start: ps, end: pe } = trimSpan(masked, argParts[i].start, argParts[i].end);
    if (ps >= pe) continue; // empty (e.g. trailing comma) — index consumed, no arg
    // Depth-aware: only a `:` at bracket depth 0 separates a named arg's
    // `name: type`. A `:` nested in the type (`fn(e:Event)`, `{x:int}`) means the
    // arg is POSITIONAL and the whole slice is its typeText. (Canonical
    // parseEnumBody uses a non-depth-aware indexOf here and mis-keys such args —
    // a deliberate, more-correct divergence; the drift-guard corpus excludes it.)
    const colonIdx = firstTopLevelColon(masked, ps, pe);
    if (colonIdx === -1) {
      // Positional — synthesize `_<i>` (the parseEnumBody convention).
      args.push({ name: `_${i}`, typeText: inner.slice(ps, pe), span: { start: base + ps, end: base + pe } });
      continue;
    }
    let nameEnd = colonIdx;
    while (nameEnd > ps && /\s/.test(masked[nameEnd - 1])) nameEnd--;
    const argName = inner.slice(ps, nameEnd);
    let typeStart = colonIdx + 1;
    while (typeStart < pe && /\s/.test(masked[typeStart])) typeStart++;
    args.push({
      name: argName,
      typeText: inner.slice(typeStart, pe),
      span: { start: base + ps, end: base + pe },
    });
  }
  return args;
}

/**
 * Parse an enum body's variants from the VERBATIM source over the member-list
 * region `[innerStart, innerEnd)` (inside the braces, or the bar-form variant
 * list of a brace-less enum). Mirrors `parseEnumBody` variant
 * recognition (split on top-level newline / `,` / `|`; strip bar-form `.` and a
 * trailing `renders` clause; cut the `transitions {}` block; the same
 * uppercase-initial variant-name regex) but tracks absolute offsets + verbatim
 * payload signature, and resolves each variant's constructor args.
 */
function parseEnumMembers(source: string, maskedDecl: string, declBase: number, innerStart: number, innerEnd: number): TypeMember[] {
  const base = innerStart;
  const inner = source.slice(base, innerEnd);
  const masked = maskedDecl.slice(innerStart - declBase, innerEnd - declBase);
  const variantsEnd = findTransitionsCut(masked);
  const parts = splitTopLevelSpans(masked, 0, variantsEnd, new Set(["\n", ",", "|"]));
  const members: TypeMember[] = [];
  for (const part of parts) {
    const trimmed = trimSpan(masked, part.start, part.end);
    if (trimmed.start >= trimmed.end) continue;
    const ps = trimmed.start;
    // Cut a trailing `renders …` clause off the structural view.
    const rIdx = findRendersCut(masked, ps, trimmed.end);
    let core = rIdx === -1 ? trimmed.end : rIdx;
    while (core > ps && /\s/.test(masked[core - 1])) core--;
    if (ps >= core) continue;
    // Variant name — skip a bar-form leading `.`.
    let a = ps;
    if (masked[a] === ".") { a++; while (a < core && /\s/.test(masked[a])) a++; }
    let nameEnd = a;
    while (nameEnd < core && /[A-Za-z0-9_]/.test(masked[nameEnd])) nameEnd++;
    const name = inner.slice(a, nameEnd);
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
    const parenIdx = masked.indexOf("(", nameEnd);
    if (parenIdx === -1 || parenIdx >= core) {
      // Unit variant.
      members.push({ name, memberKind: "variant", typeText: "", span: { start: base + a, end: base + nameEnd }, args: [] });
      continue;
    }
    const closeParen = matchParen(masked, parenIdx, core);
    if (closeParen === -1) {
      // Unbalanced payload — degrade to a unit-shaped member (never throw).
      members.push({ name, memberKind: "variant", typeText: "", span: { start: base + a, end: base + nameEnd }, args: [] });
      continue;
    }
    const args = parseVariantArgs(inner, masked, base, parenIdx + 1, closeParen);
    const typeText = inner.slice(parenIdx, closeParen + 1); // verbatim "(...)"
    members.push({ name, memberKind: "variant", typeText, span: { start: base + a, end: base + closeParen + 1 }, args });
  }
  return members;
}

// ---------------------------------------------------------------------------
// Channel name extraction (mirrors emit-channel.ts attr read)
// ---------------------------------------------------------------------------

/**
 * The channel's logical name, read off its `name=` attribute. Channel decls are
 * `MarkupNode`s (`tag: "channel"`) carrying an `attrs` array (or legacy
 * `attributes`) of `{ name, value }`; mirror `emit-channel.ts readChannelMeta`
 * so we agree with the canonical consumer (string-literal value, else a bare
 * `@var` ref with the `@` stripped). Falls back to `"channel"` (the same
 * default emit-channel uses) when the name attr is absent.
 */
function channelName(node: AnyNode): string {
  const attrs = (Array.isArray(node.attrs) ? node.attrs : node.attributes) as AnyNode[] | undefined;
  if (!Array.isArray(attrs)) return "channel";
  for (const attr of attrs) {
    if (attr && typeof attr === "object" && attr.name === "name") {
      const value = attr.value as AnyNode | string | undefined;
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        if (value.kind === "string-literal" && typeof value.value === "string") return value.value;
        if (value.kind === "variable-ref" && typeof value.name === "string") {
          return value.name.replace(/^@/, "");
        }
      }
      return "channel";
    }
  }
  return "channel";
}

// ---------------------------------------------------------------------------
// Per-block projection
// ---------------------------------------------------------------------------

/**
 * The `varName` identity of an engine block — the §51.0.C auto-declared
 * variable on `_record.engineMeta` (SCOPE §1 Fact 1). Falls back to the legacy
 * `engineName` field, then the empty string (a malformed engine the collectors
 * would not have returned).
 */
function engineVarName(node: AnyNode): string {
  const record = node._record as { engineMeta?: { varName?: unknown } } | undefined;
  const varName = record?.engineMeta?.varName;
  if (typeof varName === "string" && varName.length > 0) return varName;
  if (typeof node.engineName === "string") return node.engineName;
  return "";
}

/**
 * Build one block projection. `kind` + `name` are caller-resolved (each
 * collection knows its own kind + name field). The footprint comes from D1's
 * `footprintForBlock` for fn/component/engine blocks (only fns carry a
 * structured logic body, so component/engine yield honest-empty today —
 * SCOPE §3) and is empty for type/channel blocks (they declare no reactive
 * reads/writes).
 */
function projectBlock(
  node: AnyNode,
  kind: BlockKind,
  name: string,
  relPath: string,
  source: string | undefined,
  fileAST: AnyNode | undefined,
): BlockAnalysisBlock {
  const span = projectSpan(node.span as SpanShape | undefined, source);

  let reads: string[] = [];
  let writes: string[] = [];
  if (kind === "function" || kind === "component" || kind === "engine") {
    const footprint = footprintForBlock(node, fileAST);
    reads = footprint.reads;
    writes = footprint.writes;
  }

  const id = `${relPath}::${name}`;
  const typeShape: TypeShape | undefined = kind === "type"
    ? deriveTypeShape(typeof node.typeKind === "string" ? node.typeKind : "")
    : undefined;

  // bodySpan — a tight `[start, end)` bounded at the entity's body-close, so a
  // consumer can splice `[start, end)` without welding trailing trivia (the
  // `span.end` overshoot). For `type` blocks the close is the body `}` (or, for
  // a brace-less bar-form enum / refinement, the end of the RHS) — a type decl's
  // `span.end` runs PAST it into the following token (the systemic
  // g-decl-span-overshoot remainder). For the other kinds we trim trailing
  // whitespace/newline off `span.end`. Never claims more than `span`.
  let bodyEnd = span.end;
  let members: TypeMember[] = [];
  if (typeof source === "string") {
    let closeEnd: number | undefined;
    if (kind === "type") {
      // Mask comments over THIS decl's span ONCE, then thread the buffer to the
      // brace/region scans + the member parse (no per-call re-mask).
      const declBase = span.start;
      const maskedDecl = maskComments(source.slice(declBase, Math.min(span.end, source.length)));
      let region: { start: number; end: number } | undefined; // ABSOLUTE inner region
      const braces = findBracesInMasked(maskedDecl);
      if (braces) {
        region = { start: declBase + braces.open + 1, end: declBase + braces.close };
        closeEnd = declBase + braces.close + 1;
      } else {
        // Brace-less body: a bar-form enum variant list OR a refinement / alias
        // RHS. Bounding bodyEnd here is what stops a refinement's bodySpan from
        // welding the FOLLOWING decl.
        const body = findBraceLessBody(maskedDecl);
        if (body) {
          closeEnd = declBase + body.end;
          if (typeShape === "enum" && body.memberStart !== -1) {
            region = { start: declBase + body.memberStart, end: declBase + body.end };
          }
        }
      }
      if (region) {
        // struct + error (§19.3) are field-bearing (the type-system parses both
        // with parseStructBody); enum yields variants; refinement / tuple resolve
        // to no fields (tAsIs) → empty members.
        if (typeShape === "struct" || typeShape === "error") {
          members = parseStructMembers(source, maskedDecl, declBase, region.start, region.end);
        } else if (typeShape === "enum") {
          members = parseEnumMembers(source, maskedDecl, declBase, region.start, region.end);
        }
      }
    }
    if (closeEnd !== undefined) {
      bodyEnd = closeEnd;
    } else {
      // Trailing-trivia trim (non-type block, or a body-less type with no `=`).
      let e = Math.min(span.end, source.length);
      while (e > span.start && /\s/.test(source[e - 1])) e--;
      bodyEnd = e;
    }
  }
  const bodySpan: ByteSpan = { start: span.start, end: bodyEnd };

  if (kind === "type") {
    return {
      id,
      kind,
      name,
      typeShape: typeShape as TypeShape,
      span,
      bodySpan,
      members,
      reads,
      writes,
      footprintDepth: "shallow",
    };
  }

  return {
    id,
    kind,
    name,
    span,
    bodySpan,
    reads,
    writes,
    footprintDepth: "shallow",
  };
}

// ---------------------------------------------------------------------------
// Block discovery (reuse the FileAST collections + codegen collectors)
// ---------------------------------------------------------------------------

/**
 * Walk the node tree collecting every top-level `function-decl` (a named block).
 *
 * Functions do NOT sit directly on `FileAST.nodes` — even a module-level `fn`
 * is wrapped in a `logic` node (its decls in `logic.body`), and a page-embedded
 * `${…}` block is a `logic` node nested under `<page>` markup `children`. So we
 * descend `markup.children` + `logic.body` (the structural wrappers) to reach
 * the function-decls, mirroring the D1 footprint test's `functionDecls` walker
 * + engine-graph's markup-children collector.
 *
 * We do NOT descend into a function-decl's OWN body: a function nested inside
 * another function's body is reached transitively (BREAK-2 territory) and would
 * collide on the `<relpath>::<name>` anchor; dock keys on top-level defs.
 */
function collectFunctionDecls(
  nodes: unknown,
  out: { node: AnyNode; kind: BlockKind; name: string }[],
  ownerFile: string,
): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as AnyNode;
    if (n.kind === "function-decl") {
      const name = typeof n.name === "string" ? n.name : "";
      // Skip function-decls INLINED from an imported module. A channel import
      // (`import { "x" as y } from "./channel.scrml"`) pulls the channel's fns
      // into the importing page's AST so the page can CALL them — those nodes
      // carry their ORIGIN file in `span.file`. They are not declared in THIS
      // file; counting one yields a phantom block whose span indexes the wrong
      // source and OVERLAPS a real local block (D6 — the block-lease two-holders
      // failure). Keep only locally-declared fns: span.file matches the owner,
      // or is absent (a hand-built / spanless node stays in — prior behavior).
      const declFile = (n.span as SpanShape | undefined)?.file;
      const isLocal =
        !ownerFile ||
        typeof declFile !== "string" ||
        declFile.length === 0 ||
        relativeFilePath(declFile) === ownerFile;
      if (name && isLocal) out.push({ node: n, kind: "function", name });
      // Do NOT descend into the fn's own body (top-level defs only).
      continue;
    }
    // Descend the structural wrappers that hold function-decls: `logic` nodes
    // carry them in `body`; markup containers in `children`.
    if (Array.isArray(n.children)) collectFunctionDecls(n.children, out, ownerFile);
    if (Array.isArray(n.body)) collectFunctionDecls(n.body, out, ownerFile);
  }
}

/**
 * Collect every named block in a FileAST as an unsorted `(node, kind, name)`
 * list. Functions are discovered by walking the node tree (`logic.body` /
 * markup `children`); components / types / channels via their dedicated
 * `FileAST` collections; engines via the canonical codegen collectors (C12
 * non-derived + C14 derived) so engine discovery matches emission exactly.
 * Identity fields per SCOPE §1 Fact 1.
 */
function collectBlocks(fileAST: AnyNode): { node: AnyNode; kind: BlockKind; name: string }[] {
  const out: { node: AnyNode; kind: BlockKind; name: string }[] = [];

  // The file under analysis — used to reject import-inlined function-decls
  // (channel-import pulls a channel's fns into the page AST carrying the
  // channel's `span.file`, not this file's — D6 phantom-block guard).
  const ownerFile = relativeFilePath(
    typeof fileAST.filePath === "string" ? fileAST.filePath : "",
  );

  // Functions — walk the node tree (they live in `logic.body`, nested under
  // markup `children` when page-embedded — never directly on `FileAST.nodes`).
  collectFunctionDecls(fileAST.nodes, out, ownerFile);

  // Components — `FileAST.components` (component-def, `.name`).
  const components = Array.isArray(fileAST.components) ? (fileAST.components as AnyNode[]) : [];
  for (const node of components) {
    if (node && typeof node === "object") {
      const name = typeof node.name === "string" ? node.name : "";
      if (name) out.push({ node, kind: "component", name });
    }
  }

  // Engines — canonical collectors (C12 non-derived + C14 derived). Identity is
  // `_record.engineMeta.varName` (§51.0.C). Reuse, don't re-walk.
  const c12 = collectC12EngineDecls(fileAST) as unknown as AnyNode[];
  for (const node of c12) {
    const name = engineVarName(node);
    if (name) out.push({ node, kind: "engine", name });
  }
  const c14 = collectC14DerivedEngineDecls(fileAST) as unknown as AnyNode[];
  for (const node of c14) {
    const name = engineVarName(node);
    if (name) out.push({ node, kind: "engine", name });
  }

  // Types — `FileAST.typeDecls` (type-decl, `.name`).
  const typeDecls = Array.isArray(fileAST.typeDecls) ? (fileAST.typeDecls as AnyNode[]) : [];
  for (const node of typeDecls) {
    if (node && typeof node === "object") {
      const name = typeof node.name === "string" ? node.name : "";
      if (name) out.push({ node, kind: "type", name });
    }
  }

  // Channels — `FileAST.channelDecls` (markup `tag:"channel"`, name in attrs).
  const channelDecls = Array.isArray(fileAST.channelDecls) ? (fileAST.channelDecls as AnyNode[]) : [];
  for (const node of channelDecls) {
    if (node && typeof node === "object") {
      out.push({ node, kind: "channel", name: channelName(node) });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the in-memory block analysis for ONE file AST. Blocks are emitted in
 * SOURCE ORDER (`span.start` ascending) — a stable, deterministic order across
 * the heterogeneous collections we gather them from. A file with no named
 * blocks yields an honest-empty `blocks: []`.
 *
 * @param file   The orchestrator's per-file object. The live pipeline hands a
 *               WRAPPED `{ filePath, ast, _sourceText }` (the RAW file source on
 *               the OUTER object as `_sourceText`); a caller may also hand the
 *               AST directly with `.source` / `.preprocessedSource` set.
 * @param source Optional source text. When provided it wins; otherwise the
 *               RAW `_sourceText` on the outer object (then `.source` /
 *               `.preprocessedSource`) is used. `endLine` is derived exactly
 *               from the span slice when ANY source resolves, else falls back to
 *               the opener `line`. Pass the SAME source the spans index into
 *               (RAW, not `${...}`-expanded — see `sourceFromFile`).
 */
export function buildBlockAnalysisForFile(file: unknown, source?: string): BlockAnalysis {
  const fileAST = unwrapFileAST(file);
  if (!fileAST) return { version: 1, file: "", blocks: [] };

  const filePath = typeof fileAST.filePath === "string" ? fileAST.filePath : "";
  const relPath = relativeFilePath(filePath);

  // Resolve the source the span byte-offsets index into. An explicit `source`
  // arg wins; otherwise recover the RAW `_sourceText` the orchestrator threads
  // on the OUTER wrapped object (the inner `ast` carries no source field — that
  // is why the metaFiles-stage call previously collapsed `endLine` to `line`).
  const effectiveSource =
    typeof source === "string" ? source : sourceFromFile(file);

  const collected = collectBlocks(fileAST);
  const blocks = collected.map(({ node, kind, name }) =>
    projectBlock(node, kind, name, relPath, effectiveSource, fileAST),
  );

  // Source order: the load-bearing determinism axis. Byte offset `span.start`
  // ascending; tie-break on `id` so two blocks at the same offset (a malformed
  // edge case) still sort stably.
  blocks.sort((a, b) => {
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { version: 1, file: relPath, blocks };
}

/**
 * Build the block analysis for a SET of file ASTs (the orchestrator's per-file
 * `metaFiles`). Returns one `BlockAnalysis` per file, in file order. The emit
 * layer (D3) writes one sidecar per source file, so the per-file shape is what
 * the write-loop consumes.
 *
 * Each `file` is the WRAPPED `{ filePath, ast, _sourceText }` object the live
 * pipeline carries; `buildBlockAnalysisForFile` recovers the RAW `_sourceText`
 * off it (`sourceFromFile`) for exact `endLine` derivation. No explicit `source`
 * arg is threaded here — the source rides on the object itself.
 */
export function buildBlockAnalysis(files: unknown): BlockAnalysis[] {
  const list = Array.isArray(files) ? files : files != null ? [files] : [];
  return list.map((file) => buildBlockAnalysisForFile(file));
}

/**
 * Serialize a `BlockAnalysis` to a deterministic, pretty-printed JSON string
 * (2-space indent, trailing newline). The analysis is already built with stable
 * ordering; the fixed key-insertion order of the projection objects makes
 * `JSON.stringify` output byte-stable across compiles.
 *
 * An empty file serializes to `{\n  "version": 1,\n  "file": "",\n  "blocks": []\n}\n`.
 */
export function serializeBlockAnalysis(analysis: BlockAnalysis): string {
  return JSON.stringify(analysis, null, 2) + "\n";
}

/**
 * Convenience: build + serialize the block analysis for a SINGLE file. The emit
 * layer (D3) calls this once per source file to produce its `.block-analysis.json`
 * sidecar, mirroring `buildEngineGraphJson`'s lazy result-fn wiring in api.js.
 */
export function buildBlockAnalysisJson(file: unknown, source?: string): string {
  return serializeBlockAnalysis(buildBlockAnalysisForFile(file, source));
}
