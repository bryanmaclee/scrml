// =============================================================================
// engine-statechild-walker.ts — M6.6.b.2
//
// Walk a native `<engine for=...>` Markup block's child stream and produce the
// live `EngineStateChildEntry[]` shape that symbol-table.ts PASS 11 consumes.
//
// This module is the M6.6.b.2 migration target: it replaces the
// `parseEngineStateChildren(rulesRaw)` text-rescanner with a structured walk
// over the native block tree the parser already produced. The legacy
// `engine-statechild-parser.ts` module survives as a fallback for synthetic
// ASTs (test harnesses that build an `engine-decl` without going through the
// native pipeline) and so that the pure `parseRuleAttrValue` helper can be
// imported intact — that helper is the canonical `rule=` value parser and is
// reused here verbatim.
//
// SHAPE CONTRACT — see compiler/native-parser/M6.6-CONTRACT-DERIVATION.md
//   for the per-field recipe; this module is the cookbook materialized.
//
// SCOPE — preserve the live `EngineStateChildEntry` shape EXACTLY (including
//   `null`-vs-empty-string, leading-dot stripping, `:`-shorthand discrimination,
//   `rawOffset` semantics). The dual-pipeline parity tests at
//   `compiler/tests/unit/m66-b2-engine-statechild-walker.test.js` enforce
//   structural equality with the legacy parser for every shape category.
//
// NON-SCOPE — this module does NOT swap the legacy parser out. b.2 introduces
//   the walker + the discriminated branch at the call site; b.3/b.4/b.5/b.6
//   are deletion-only follow-ons that retire the unused legacy paths.
// =============================================================================

import { parseRuleAttrValue } from "../engine-statechild-parser.ts";
import { isEngineBlock } from "../../native-parser/collect-hoisted.js";
import type {
  EngineStateChildEntry,
  EngineRuleForm,
  OnTimeoutEntry,
  OnTransitionEntry,
  NestedEngineEntry,
  PayloadBinding,
  OnIdleEntry,
} from "../symbol-table.ts";

// ------ Native shape (informal) ---------------------------------------------
// Mirrors the contract in M6.6-CONTRACT-DERIVATION.md §Shared block payload
// and §Shared AttrNode shape. Typed `any` here intentionally — the native
// parser is JS-source and the types live as JSDoc comments; the cookbook
// + the parser-conformance tests are the structural contract.

type Span = { start: number; end: number; line?: number; col?: number };
type AttrValue =
  | { kind: "absent" }
  | { kind: "string-literal"; value: string; sourceText?: string }
  | { kind: "variable-ref"; name: string; sourceText?: string }
  | { kind: "dotted-ident"; text: string; sourceText?: string }
  | { kind: "wildcard"; text: string; sourceText?: string }
  | { kind: "expr"; raw: string; refs?: unknown; sourceText?: string }
  | { kind: "call-ref"; name: string; args: unknown; sourceText?: string }
  | { kind: "props-block"; propsDecl: string; sourceText?: string };
type AttrNode = { name: string; value: AttrValue; span?: Span };
type Block = {
  kind: string;
  name?: string;
  span?: Span;
  children?: Block[];
  closerForm?: string | null;
  tagKind?: string;
  tagClass?: string;
  attrs?: AttrNode[];
  colonShorthandBody?: string | null;
};

// =============================================================================
// Shared helpers (cookbook §Shared helpers)
// =============================================================================

// readAttrName — return the named attribute's value as an identifier-ish
// string, or null when the attribute is absent / has no usable string value.
function readAttrName(attrs: AttrNode[], attrName: string): string | null {
  for (const attr of attrs) {
    if (!attr || attr.name !== attrName) continue;
    const value = attr.value;
    if (!value) return null;
    if (value.kind === "variable-ref") return value.name;
    if (value.kind === "string-literal") return value.value;
    return null;
  }
  return null;
}

// hasBareAttr — true iff the named attribute is present with an `absent`
// value (a bareword modifier, e.g. `<X foo>` for `foo`).
function hasBareAttr(attrs: AttrNode[], attrName: string): boolean {
  for (const attr of attrs) {
    if (!attr || attr.name !== attrName) continue;
    if (attr.value && attr.value.kind === "absent") return true;
  }
  return false;
}

// readExprValue — unwrapped expression text of an `expr`-kind attribute
// (`${...}` wrappers stripped at the tokenizer; value carries the inner
// expression text in `raw`).
function readExprValue(attrs: AttrNode[], attrName: string): string | null {
  for (const attr of attrs) {
    if (!attr || attr.name !== attrName) continue;
    if (attr.value && attr.value.kind === "expr") return attr.value.raw;
  }
  return null;
}

// readRuleAttrInput — verbatim raw input that `parseRuleAttrValue` expects.
// Routes the five legal `rule=` source forms (dotted-ident `.X`, wildcard `*`,
// paren-form `(.A | .B)`, quoted `".X"`, bare `X`) to the correct accessor.
function readRuleAttrInput(attrs: AttrNode[], attrName: string): string | null {
  for (const attr of attrs) {
    if (!attr || attr.name !== attrName) continue;
    const value = attr.value;
    if (!value) return null;
    if (value.kind === "dotted-ident") return value.text;
    if (value.kind === "wildcard") return value.text;
    if (value.kind === "expr") return value.raw;
    if (value.kind === "string-literal") return value.value;
    if (value.kind === "variable-ref") return value.name;
    return null;
  }
  return null;
}

// readIfExprRaw — legacy `ifExprRaw` parity recovery. The pre-b.1.5 legacy
// parser preserved the verbatim source slice (quotes for `if="..."`, wrapper
// for `if=${...}`). Use `sourceText` when present; fall back to the
// per-kind unwrapped value.
//
// IMPORTANT: the legacy `parseOpenerAttributes` walker captures the value
// VERBATIM (with surrounding quotes / `${...}` / parens intact) then trims
// — it does NOT strip quotes or unwrap. So legacy's `ifExprRaw` for
// `if="@a == b"` is `"\"@a == b\""` and for `if=${@a == b}` is `"${@a == b}"`.
// The `sourceText` from the native tokenizer is the verbatim slice INCLUDING
// the wrapper — matching the legacy shape exactly.
function readIfExprRaw(attrs: AttrNode[], attrName: string): string | null {
  for (const attr of attrs) {
    if (!attr || attr.name !== attrName) continue;
    const value = attr.value;
    if (!value) return null;
    if (typeof (value as { sourceText?: string }).sourceText === "string") {
      return (value as { sourceText: string }).sourceText;
    }
    if (value.kind === "expr") return value.raw;
    if (value.kind === "variable-ref") return value.name;
    if (value.kind === "string-literal") return value.value;
    return null;
  }
  return null;
}

// filterChildrenByName — return the subset of children matching a name.
function filterChildrenByName(children: Block[] | undefined, name: string): Block[] {
  if (!Array.isArray(children)) return [];
  const out: Block[] = [];
  for (const c of children) {
    if (c && c.kind === "Markup" && c.name === name) out.push(c);
  }
  return out;
}

// sliceFromSource — verbatim source recovery for `rawText`, body slices, etc.
function sliceFromSource(span: Span | undefined, source: string): string {
  if (!span || typeof source !== "string") return "";
  return source.slice(span.start, span.end);
}

// sliceBodyFromChildren — the `collectRulesRaw` pattern. Slice from the first
// child's span.start to the last child's span.end. Used to recover a parent
// block's body region as the verbatim source between opener `>` and closer `<`.
function sliceBodyFromChildren(parent: Block, source: string): string {
  const children = parent.children;
  if (!Array.isArray(children) || children.length === 0) return "";
  if (typeof source !== "string") return "";
  let lo = -1, hi = -1;
  for (const c of children) {
    const s = c.span;
    if (!s) continue;
    if (lo < 0 || s.start < lo) lo = s.start;
    if (hi < 0 || s.end > hi) hi = s.end;
  }
  if (lo < 0 || hi < 0 || lo > hi || hi > source.length) return "";
  return source.slice(lo, hi);
}

// stripLeadingDot — remove a single leading `.` from a variant ref
// (`.X` -> `X`). Mirrors the live engine-statechild-parser helper.
function stripLeadingDot(text: string): string {
  if (typeof text !== "string") return "";
  if (text.length > 0 && text.charAt(0) === ".") return text.slice(1);
  return text;
}

// isSelfCloseShape — derived from `tagClass`. The native opener tokenizer
// sets `tagClass = "SelfClose"` for `<X/>`-shape openers.
function isSelfCloseShape(child: Block): boolean {
  return child.tagClass === "SelfClose";
}

// computeBodyStart — for `rawOffset` arithmetic on body-children
// (onTimeoutElements, onTransitionElements, innerEngines). The body starts at
// the first child's span.start; for `:`-shorthand / self-close, the body has
// no children and these arrays are empty, so the value is unused.
function computeBodyStart(child: Block): number {
  const children = child.children;
  if (!Array.isArray(children) || children.length === 0) {
    return (child.span && child.span.start) || 0;
  }
  let lo = -1;
  for (const c of children) {
    if (c && c.span && (lo < 0 || c.span.start < lo)) lo = c.span.start;
  }
  return lo < 0 ? ((child.span && child.span.start) || 0) : lo;
}

// computeRulesRawStart — for the top-level `rawOffset` on EngineStateChildEntry.
// The legacy parser reports `rawOffset` relative to `rulesRaw`, which is the
// trimmed source slice from the engine body's first-child span.start to its
// last-child span.end. We replicate that base offset here.
//
// IMPORTANT: legacy `collectRulesRaw` TRIMS the slice. The leading-whitespace
// trim shifts the offset basis; the legacy parser then re-scans the trimmed
// string for `<` openers. We compute `rulesRawStart` as the first non-
// whitespace position WITHIN the first-child-span..last-child-span window.
function computeRulesRawStart(engineBlock: Block, source: string): number {
  const children = engineBlock.children;
  if (!Array.isArray(children) || children.length === 0) return 0;
  if (typeof source !== "string") return 0;
  let lo = -1, hi = -1;
  for (const c of children) {
    if (c && c.span) {
      if (lo < 0 || c.span.start < lo) lo = c.span.start;
      if (hi < 0 || c.span.end > hi) hi = c.span.end;
    }
  }
  if (lo < 0 || hi < 0) return 0;
  // Honor the trim: advance lo past leading whitespace.
  while (lo < hi && lo < source.length) {
    const ch = source.charCodeAt(lo);
    // ASCII whitespace: space, tab, LF, CR, FF, VT.
    if (ch === 0x20 || ch === 0x09 || ch === 0x0A || ch === 0x0D || ch === 0x0C || ch === 0x0B) {
      lo++;
    } else break;
  }
  return lo;
}

// =============================================================================
// Reserved attribute names for payload-binding walks (cookbook §payloadBindings)
// =============================================================================
const RESERVED_PAYLOAD_ATTRS = new Set(["rule", "effect", "history", "internal:rule"]);

// =============================================================================
// Field recipes — read a single state-child block + produce its
// EngineStateChildEntry fields. The recipes follow the cookbook's
// declaration-order ordering for traceability.
// =============================================================================

// readRule — produce an EngineRuleForm from the named `rule=` (or
// `internal:rule=`) attribute on the opener. Routes the five legal source
// forms via `readRuleAttrInput` then delegates to the pure
// `parseRuleAttrValue` helper.
function readRule(attrs: AttrNode[], attrName: string): EngineRuleForm {
  const raw = readRuleAttrInput(attrs, attrName);
  if (raw === null) return { kind: "absent" };
  return parseRuleAttrValue(raw);
}

// readBodyRaw — the verbatim body text for a state-child entry. Three opener
// forms:
//   - `:`-shorthand     -> `child.colonShorthandBody` directly (b.1 IMPL).
//   - self-close `<X/>` -> empty string.
//   - bare-body         -> derived from the block's span: slice from past the
//     opener's `>` to the closer's `<`. The native parser does NOT walk
//     state-child bodies into child blocks for TEXT content (only structural
//     children like <onTimeout/>, <onTransition>, nested <engine> show up
//     in `children[]`). The legacy parser returns the VERBATIM body —
//     including leading / trailing / inter-child text. The structural-child
//     slice (`sliceBodyFromChildren`) loses that text, so we slice from
//     the span directly: locate the first `>` after the tag name
//     (respecting `${...}` / quotes / parens so attribute values can't
//     false-trigger as opener termination) and the last `</` before
//     span end.
function readBodyRaw(child: Block, source: string): string {
  if (child.colonShorthandBody !== null && child.colonShorthandBody !== undefined) {
    return child.colonShorthandBody;
  }
  if (isSelfCloseShape(child)) return "";
  return sliceBodyFromSpan(child, source);
}

// sliceBodyFromSpan — recover the verbatim body between opener-`>` and
// closer-`<` from the block's span. Used when the native parser holds the
// body as raw text in-span (state-children + their inner <onTransition>
// bodies, which are also opener-only at the native markup-tree level).
//
// Walks the opener attributes respecting brace / paren / quote depth so a
// `>` inside a value (`attr=${a>b ? 1 : 2}`) isn't picked as the opener
// terminator. Then back-scans from span end for the `</` of the closer.
function sliceBodyFromSpan(child: Block, source: string): string {
  if (!child.span || typeof source !== "string") return "";
  const start = child.span.start;
  const end = child.span.end;
  if (start < 0 || end > source.length || start >= end) return "";
  if (source[start] !== "<") return "";
  // Locate the opener's `>`, respecting bracket / quote depth on the
  // attribute region.
  let i = start + 1;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;
  while (i < end) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\" && i + 1 < end) { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === "$" && source[i + 1] === "{") { braceDepth++; i += 2; continue; }
    if (ch === "{") { braceDepth++; i++; continue; }
    if (ch === "}") { if (braceDepth > 0) braceDepth--; i++; continue; }
    if (ch === "(") { parenDepth++; i++; continue; }
    if (ch === ")") { if (parenDepth > 0) parenDepth--; i++; continue; }
    if (ch === "[") { bracketDepth++; i++; continue; }
    if (ch === "]") { if (bracketDepth > 0) bracketDepth--; i++; continue; }
    if (ch === ">" && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      break;
    }
    i++;
  }
  if (i >= end) return "";
  const openerEnd = i; // index of `>`
  // Back-scan for the closer `</`. Closer forms accepted: `</>`,
  // `</TagName>`, `</tagname>`. Find the last `</` in the span window.
  let closerStart = -1;
  for (let j = end - 1; j > openerEnd + 1; j--) {
    if (source[j] === "<" && source[j + 1] === "/") {
      closerStart = j;
      break;
    }
  }
  if (closerStart < 0) {
    // No closer in span — fall back to opener-end..span-end.
    return source.slice(openerEnd + 1, end);
  }
  return source.slice(openerEnd + 1, closerStart);
}

// readPayloadBindings — walk the opener attributes, skip reserved names, and
// produce a PayloadBinding[] per cookbook §payloadBindings. Two source forms
// per attribute value kind:
//   - { kind: "absent" } (bareword)        -> { kind: "positional", name }
//   - { kind: "variable-ref" } (named)     -> { kind: "named", field, name }
//
// (`<Done(rows)>` parenthesized form is a documented divergence — see
// cookbook OQ #2. Both forms produce the same PayloadBinding shape; the
// SOURCE FORM distinction is lost but the recovered shape is consistent
// with bare-form.)
function readPayloadBindings(attrs: AttrNode[]): PayloadBinding[] {
  const out: PayloadBinding[] = [];
  for (const attr of attrs) {
    if (!attr || RESERVED_PAYLOAD_ATTRS.has(attr.name)) continue;
    const value = attr.value;
    if (!value) continue;
    if (value.kind === "absent") {
      out.push({ kind: "positional", name: attr.name });
    } else if (value.kind === "variable-ref") {
      out.push({ kind: "named", field: attr.name, name: value.name });
    }
  }
  return out;
}

// readOnTimeoutEntry — produce an OnTimeoutEntry from a `<onTimeout/>` block.
// The `after` field admits both expr (`after=${...}<unit>`) and literal
// (`after=500ms`) forms. The `to` field strips a leading dot from the variant
// reference. The optional `name` field is captured when present (S79
// addressable-timer feature).
function readOnTimeoutEntry(timeoutBlock: Block, bodyStart: number): OnTimeoutEntry {
  const attrs = timeoutBlock.attrs ?? [];
  // `after=` admits expr (`${expr}<unit>`), string-literal (`"500ms"`),
  // variable-ref (`500ms` — bare token form). Read the unwrapped value
  // verbatim; the typer normalises duration units.
  const after =
    readExprValue(attrs, "after") ??
    readAttrName(attrs, "after") ??
    readRuleAttrInput(attrs, "after") ??
    "";
  // `to=` admits dotted-ident (`.Active`), string-literal (`"Active"`), or
  // variable-ref (`Active`). Strip leading dot for the variant name.
  const toRaw =
    readRuleAttrInput(attrs, "to") ??
    readAttrName(attrs, "to") ??
    "";
  const to = stripLeadingDot(toRaw);
  // `name=` is an identifier (variable-ref) or quoted string-literal.
  const name = readAttrName(attrs, "name") ?? undefined;
  const rawOffset = (timeoutBlock.span ? timeoutBlock.span.start : 0) - bodyStart;
  const entry: OnTimeoutEntry = { after, to, rawOffset };
  if (name !== undefined) entry.name = name;
  return entry;
}

// readOnTransitionEntry — produce an OnTransitionEntry from a `<onTransition>`
// block. 7 fields per the cookbook's `onTransitionElements` recipe. Note
// `ifExprRaw` uses `readIfExprRaw` for legacy verbatim-source parity (preserves
// surrounding quotes / `${}` / `()` wrappers).
function readOnTransitionEntry(transBlock: Block, source: string, bodyStart: number): OnTransitionEntry {
  const attrs = transBlock.attrs ?? [];
  const toRawDotted = readRuleAttrInput(attrs, "to");
  const fromRawDotted = readRuleAttrInput(attrs, "from");
  const to = toRawDotted !== null ? stripLeadingDot(toRawDotted) : null;
  const from = fromRawDotted !== null ? stripLeadingDot(fromRawDotted) : null;
  const once = hasBareAttr(attrs, "once");
  const ifExprRaw = readIfExprRaw(attrs, "if");
  const isColonShorthand =
    transBlock.colonShorthandBody !== null && transBlock.colonShorthandBody !== undefined;
  const bodyRaw = isColonShorthand
    ? (transBlock.colonShorthandBody as string)
    : isSelfCloseShape(transBlock)
      ? ""
      : sliceBodyFromSpan(transBlock, source);
  const rawOffset = (transBlock.span ? transBlock.span.start : 0) - bodyStart;
  return { to, from, once, ifExprRaw, bodyRaw, isColonShorthand, rawOffset };
}

// readNestedEngineEntry — produce a NestedEngineEntry from a nested
// `<engine>` block. The legacy parser captured ONLY non-self-closing nested
// engines; we mirror that (callers filter via `isEngineBlock` + self-close
// rejection before invoking this).
function readNestedEngineEntry(engineBlock: Block, source: string, bodyStart: number): NestedEngineEntry {
  const rawText = sliceFromSource(engineBlock.span, source);
  const rawOffset = (engineBlock.span ? engineBlock.span.start : 0) - bodyStart;
  return { rawText, rawOffset };
}

// =============================================================================
// Top-level entry — walkOneStateChild
//
// Build the 12-field EngineStateChildEntry from a single state-child block
// plus the file source. Used per child in the main walker loop.
// =============================================================================
function walkOneStateChild(
  child: Block,
  source: string,
  rulesRawStart: number,
): EngineStateChildEntry {
  const attrs = child.attrs ?? [];
  const isColonShorthand =
    child.colonShorthandBody !== null && child.colonShorthandBody !== undefined;
  const isSelfClose = isSelfCloseShape(child);
  const bodyStart = computeBodyStart(child);

  // `:`-shorthand and self-close bodies have no children; the arrays are empty.
  // Otherwise filter the block-children for the named structural elements.
  const onTimeoutElements: OnTimeoutEntry[] =
    isColonShorthand || isSelfClose
      ? []
      : filterChildrenByName(child.children, "onTimeout")
          .map((b) => readOnTimeoutEntry(b, bodyStart));

  const onTransitionElements: OnTransitionEntry[] =
    isColonShorthand || isSelfClose
      ? []
      : filterChildrenByName(child.children, "onTransition")
          .map((b) => readOnTransitionEntry(b, source, bodyStart));

  // Nested-engine collection — use `isEngineBlock` (handles both `<engine>`
  // and legacy `<machine>`). Self-closing engines are NOT a legal nested
  // engine form (engines must contain state-children) — legacy parser
  // skipped them and we mirror.
  const innerEngines: NestedEngineEntry[] =
    isColonShorthand || isSelfClose
      ? []
      : (child.children ?? [])
          .filter((b) => isEngineBlock(b))
          .filter((b) => !isSelfCloseShape(b))
          .map((b) => readNestedEngineEntry(b, source, bodyStart));

  const rawOffset = (child.span ? child.span.start : 0) - rulesRawStart;

  return {
    tag: child.name ?? "",
    rule: readRule(attrs, "rule"),
    bodyRaw: readBodyRaw(child, source),
    isColonShorthand,
    rawOffset,
    historyAttr: hasBareAttr(attrs, "history"),
    internalRule: readRule(attrs, "internal:rule"),
    onTimeoutElements,
    innerEngines,
    effectRaw: readExprValue(attrs, "effect"),
    onTransitionElements,
    payloadBindings: readPayloadBindings(attrs),
  };
}

// =============================================================================
// walkEngineStateChildren — public entry. Walk the engine block's direct
// children, dispatching state-child openers (Markup blocks whose name starts
// with an uppercase letter) into the per-child shape walker. Non-state-child
// children (Text noise, `<onIdle>`, nested non-state markup) are ignored at
// this level; the legacy parser's outer regex also skipped them.
//
// EXPORT — this is the symbol-table.ts:5014 swap target.
// =============================================================================
export function walkEngineStateChildren(
  engineBlock: Block | undefined | null,
  source: string,
): EngineStateChildEntry[] {
  if (!engineBlock || !Array.isArray(engineBlock.children)) return [];
  if (typeof source !== "string") source = "";
  const rulesRawStart = computeRulesRawStart(engineBlock, source);
  const out: EngineStateChildEntry[] = [];
  for (const child of engineBlock.children) {
    if (!child || child.kind !== "Markup") continue;
    const name = child.name;
    if (typeof name !== "string" || name.length === 0) continue;
    // State-child openers are PascalCase (first char uppercase). Reserved
    // structural tags (`engine`, `machine`, `onIdle`, `onTimeout`,
    // `onTransition`) start lowercase or are otherwise filtered by name —
    // mirroring the legacy parser's `< + uppercase` opener gate.
    const first = name.charCodeAt(0);
    if (first < 65 || first > 90) continue;
    out.push(walkOneStateChild(child, source, rulesRawStart));
  }
  return out;
}

// =============================================================================
// M6.6.b.3 — walkIsLegacyArrowRulesBody
//
// Replace the legacy `isLegacyArrowRulesBody(rulesRaw)` text regex
// (`engine-statechild-parser.ts:343-352`). The legacy heuristic: body
// contains `=>` but no `<UpperCase` opener.
//
// Native equivalent: with the engine block in hand, check whether the
// block has ANY Markup child whose name is PascalCase (a state-child
// opener). If none AND the body text contains `=>`, classify as legacy
// arrow-rule.
//
// For the body-text `=>` check we need the source slice; we use the same
// `computeRulesRawStart`-style slice (post-trim body window). This
// preserves the legacy regex's input domain — only the body region
// between first-child and last-child spans is considered.
//
// EXPORT — symbol-table.ts:5154 swap target.
// =============================================================================
export function walkIsLegacyArrowRulesBody(
  engineBlock: Block | undefined | null,
  source: string,
): boolean {
  if (!engineBlock || !Array.isArray(engineBlock.children)) return false;
  // Any PascalCase Markup child means this is the new `<engine>` form;
  // legacy arrow grammar is `event -> Variant`, which produces NO
  // PascalCase state-child openers at the engine body.
  for (const child of engineBlock.children) {
    if (!child || child.kind !== "Markup") continue;
    const name = child.name;
    if (typeof name !== "string" || name.length === 0) continue;
    const first = name.charCodeAt(0);
    if (first >= 65 && first <= 90) return false;
  }
  // No state-child opener. Now check whether the body text contains `=>`.
  // Body text = the slice from first-child-span.start to last-child-span.end,
  // OR the engine block's own span if there are no children at all (rare
  // edge case — empty engine body returns false either way).
  const bodyText = sliceBodyFromChildren(engineBlock, source);
  if (bodyText.length === 0) return false;
  return bodyText.indexOf("=>") >= 0;
}

// =============================================================================
// M6.6.b.3 — walkOnIdleEntries
//
// Replace the legacy `scanForOnIdleEntries(rulesRaw)` regex scanner
// (`engine-statechild-parser.ts:598-648`). The legacy scanner walks the
// engine's `rulesRaw` for `<onIdle ... />` self-closing elements and
// extracts `after=` + `to=` attributes; the result is later cross-
// referenced against state-child boundaries for E-IDLE-MISPLACED.
//
// Native equivalent: `<onIdle>` lives in `engineBlock.children[]` directly
// (cookbook §Open Questions OQ #4 — confirmed at M6.6 contract derivation).
// We filter by name and produce one entry per child, reading `after=` /
// `to=` via the standard cookbook accessors.
//
// SHAPE PARITY
//   - `after`: legacy accepts `Nms`/`Ns` (bare token), `"500ms"` (quoted),
//     and `${expr}<unit>` (computed). Native gives us `expr.raw` for `${}`,
//     `string-literal` for quoted, `variable-ref` for bare-token. The
//     legacy regex strips surrounding quotes but otherwise returns the
//     verbatim text — we mirror via `readExprValue → readAttrName →
//     readRuleAttrInput` chain (same order as `readOnTimeoutEntry`).
//   - `to`: legacy strips leading dot. We do the same via `stripLeadingDot`.
//   - `rawOffset`: legacy reports the offset of the `<` of `<onIdle>`
//     within `rulesRaw`. Native reports the offset of the block's
//     `span.start` (also pointing at the `<`). The basis differs (legacy:
//     trimmed `rulesRaw`; native: absolute file offset relative to
//     `computeRulesRawStart`). We compute relative to `rulesRawStart`
//     for legacy parity.
//
// SCOPE — legacy scanned for `<onIdle\b...\/>` (self-closing form). The
// native parser parses `<onIdle/>` as a self-close Markup block — already
// the only legal shape per SPEC §51.0.R. We DO accept any `<onIdle>` Markup
// regardless of `tagClass` since the malformed-shape case is the typer's
// concern, not the walker's; but in practice all valid `<onIdle>` are
// `SelfClose`.
//
// EXPORT — symbol-table.ts:5049 swap target.
// =============================================================================
export function walkOnIdleEntries(
  engineBlock: Block | undefined | null,
  source: string,
): OnIdleEntry[] {
  if (!engineBlock || !Array.isArray(engineBlock.children)) return [];
  if (typeof source !== "string") source = "";
  const rulesRawStart = computeRulesRawStart(engineBlock, source);
  const out: OnIdleEntry[] = [];
  const idleBlocks = filterChildrenByName(engineBlock.children, "onIdle");
  for (const block of idleBlocks) {
    const attrs = block.attrs ?? [];
    // `after=` — admits expr (`${expr}<unit>`), string-literal (`"500ms"`),
    // variable-ref / bare token (`500ms`). Same chain as `readOnTimeoutEntry`.
    const after =
      readExprValue(attrs, "after") ??
      readAttrName(attrs, "after") ??
      readRuleAttrInput(attrs, "after") ??
      "";
    // `to=` — admits dotted-ident (`.Variant`), string-literal (`"Variant"`),
    // variable-ref (`Variant`). Strip leading dot for the variant name.
    const toRaw =
      readRuleAttrInput(attrs, "to") ??
      readAttrName(attrs, "to") ??
      "";
    const to = stripLeadingDot(toRaw);
    const rawOffset = (block.span ? block.span.start : 0) - rulesRawStart;
    out.push({ after, to, rawOffset });
  }
  return out;
}
