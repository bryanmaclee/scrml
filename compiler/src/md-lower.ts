/**
 * md-lower.ts — SPEC §67 phase 2: a STATIC `<md>` body lowered to elements at build time.
 *
 * change-id: s462-md-phase2.
 *
 * The block splitter captured the body as one text run with its `${…}` slots TAKEN, not parsed
 * (`block.mdBody`, §67.2). This module:
 *
 *   1. replaces each slot by one U+FFFC (the reader's atom, §67.4) and applies the §67.2 dedent
 *      with the reader's own `dedent` — the slot text never counts as body lines;
 *   2. reads the result with the ONE md reader, `scrml:md`'s `parseSlots` (ruling S462 F4 — the
 *      GENERATED shim `compiler/runtime/stdlib/md.js`; there is no TypeScript md reader);
 *   3. maps every `W-MD-*` the reader returns (an offset into the dedented text) back to the
 *      `.scrml` source position and reports it as a Warning (§67.11; static bodies only — S462
 *      Q22 "c is good": a static body is STRICT, a second spelling is text plus its lint);
 *   4. lowers the tree to the §67.6 CLOSED element set as ordinary markup AST nodes, so every
 *      emitter (static HTML, `<each>` rows, `<match>` arms, `if=`, components, SSR rows) renders
 *      it with the machinery it already has:
 *        - text reaches the page only as text nodes: a lowered text node's `value` is the
 *          HTML-ENCODED text (`&` `<` `>` `"` and `$` encoded — an HTML-string sink writes it as
 *          is and can never build an element or re-read a `${`), and `_mdText` is the plain text
 *          a DOM sink writes with `createTextNode` (MD-SAFE, §67.6);
 *        - attribute values are the fixed §67.6 attributes, as string literals (escaped by the
 *          emitter) or, for a data-led value, an expression attribute (the §5.2 rule 3 guard);
 *   5. parses each slot's expression only AFTER the reader placed it (§67.2, MED-2): a slot the
 *      reader put in code was restored to its exact source text by the reader and is never
 *      parsed or scope-checked; every other slot becomes an ordinary `${…}` logic node (inline
 *      text — reactive, text-only, §67.4) or part of an expression attribute value.
 *
 * Errors raised here: E-MD-INTERP-UNCLOSED, E-MD-INDENT-MIXED, E-MD-URL-SCHEME, E-MD-OF-BODY,
 * E-MD-OF-NOMINAL (phase 3 not built), W-ATTR-001 (an attribute §67.2 does not admit) and the
 * reader's W-MD-* codes. E-MD-IN-PHRASING is the parent's check (`mdInPhrasingParent`).
 */

import { parseSlots, dedent, headingSlugs, MdBlock, MdInline } from "./md-reader.js";
import { _scrml_url_value_admitted, _scrml_read_url_scheme, _scrml_url_scheme_admitted } from "./runtime-url-guard.js";

/** The object replacement character: one reader atom per slot (§67.4). */
const SLOT_CHAR = "￼";

/** A BS slot record (block-splitter.js scanMdSlots). Absolute offsets. */
interface BsSlot { start: number; end: number; closed: boolean }

/** The md body the block splitter recorded on the `<md>` block. */
interface MdBody { start: number; end: number; line: number; col: number; slots: BsSlot[] }

/** A source span as the AST carries it. */
interface Span { file?: string; start: number; end: number; line: number; col: number }

/** What the lowering needs from ast-builder.js (passed in — no import cycle). */
export interface MdLowerCtx {
  filePath: string;
  counter: { next: number };
  errors: any[];
  /** Build a TABError (code, message, span) — the caller marks warnings. */
  makeError: (code: string, message: string, span: Span) => any;
  /**
   * Build the AST node for a TEXT slot: the slot's exact source `${…}` read as an ordinary
   * markup-body interpolation (a `logic` node), its spans at the slot's real file position.
   */
  buildSlotNode: (source: string, absStart: number, line: number, col: number) => any | null;
  /** Parse an expression (attribute value) at a file offset. */
  parseExpr: (text: string, absStart: number) => any;
}

// ---------------------------------------------------------------------------
// Re-parse routing
// ---------------------------------------------------------------------------

/**
 * Does `source` hold an `<md>` element opener? The frozen native parser (compiler/native-parser)
 * has no `<md>` production, so every re-parse site that would hand a source to it — component
 * bodies (component-expander.ts), `<match>` arm bodies (emit-match.ts) and engine state-child
 * bodies (emit-engine.ts) — routes a source that holds an `<md>` through the live block splitter
 * + ast-builder instead, the one place `<md>` is read and lowered. A false positive (`<md` in a
 * string or a comment) only takes the slower, correct path.
 */
export function sourceHasMdElement(source: unknown): boolean {
  return typeof source === "string" && /<m[dD](?=[\s>\/])/.test(source);
}

// ---------------------------------------------------------------------------
// E-MD-IN-LOGIC-NOMINAL — an `<md>` the lowering never saw
// ---------------------------------------------------------------------------

/**
 * Every `<md>` written in a markup body is lowered to its host `div` while the AST is built, so a
 * markup node still TAGGED `md` after the build was built somewhere else: `lift` markup or a markup
 * value in an expression, both parsed from logic tokens, which lose the lines markdown is made of.
 * Such an element would render its markdown source as text inside an unknown `<md>` element, at
 * exit 0. It is refused by name instead (fail closed), once per element, with the positions where
 * a static `<md>` works. Walks every object reachable from `root`, as the §4.17 element refusal
 * does (element-refusal.ts), so a markup value nested in any expression is seen.
 */
export function refuseUnreadMdElements(root: unknown, filePath: string, errors: any[], makeError: MdLowerCtx["makeError"]): void {
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n as object)) continue;
    seen.add(n as object);
    if (Array.isArray(n)) { for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]); continue; }
    const obj = n as { [k: string]: any };
    if (obj.kind === "markup" && typeof obj.tag === "string" && /^m[dD]$/.test(obj.tag)) {
      if (obj._mdRefused === true) continue; // already reported by a nested build (a `<match>` arm)
      obj._mdRefused = true;
      const sp = (obj.refusalSpan ?? obj.span) as Span | undefined;
      const msg =
        "E-MD-IN-LOGIC-NOMINAL: this `<md>` is inside `lift` markup or a markup value in an expression, " +
        "where impl#1 does not read markdown yet (SPEC §67.2 — the markup there is parsed from logic tokens, " +
        "which lose the lines markdown is made of). A static `<md>` works in a markup body: a page or element " +
        "body, a component body, an `<each>` row, a `<match>` arm, an `if=` element. Move the `<md>` there " +
        "(an `<each>` replaces a `for … lift` loop; an `if=` / `else` pair replaces a `? :` markup value).";
      const err = makeError("E-MD-IN-LOGIC-NOMINAL", msg, sp && typeof sp.start === "number"
        ? { file: sp.file ?? filePath, start: sp.start, end: sp.end, line: sp.line, col: sp.col }
        : { file: filePath, start: 0, end: 0, line: 1, col: 1 });
      err.baseMessage = msg;
      errors.push(err);
      // the element renders nothing (the error is fatal; no markdown source reaches a page)
      obj.children = [];
      continue;
    }
    for (const k of Object.keys(obj)) {
      if (k === "span" || k === "parent") continue;
      const v = obj[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
}

// ---------------------------------------------------------------------------
// E-MD-IN-PHRASING (§67.2) — an element whose content model is phrasing content.
// ---------------------------------------------------------------------------

/**
 * The HTML elements whose content is phrasing content (plus `a`, whose transparent model is
 * phrasing wherever an `<md>` could sit next to text, the brief's "including `a`"). Block output
 * inside one of these is re-parented by the browser's HTML parser, so the emitted tree would not
 * be the tree scrml built.
 */
export const MD_PHRASING_PARENTS: ReadonlySet<string> = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "span", "a", "em", "strong", "small", "s",
  "cite", "q", "dfn", "abbr", "ruby", "rt", "rp", "data", "time", "code", "var", "samp", "kbd",
  "sub", "sup", "i", "b", "u", "mark", "bdi", "bdo", "button", "label", "output", "legend",
  "summary", "option", "textarea", "title", "del", "ins", "font", "big", "tt", "nobr",
]);

/** Is `tag` (an HTML element, lowercase-first) a phrasing-content parent? */
export function isMdPhrasingParent(tag: unknown): boolean {
  if (typeof tag !== "string" || tag.length === 0 || /^[A-Z]/.test(tag)) return false;
  return MD_PHRASING_PARENTS.has(tag.toLowerCase());
}

/**
 * E-MD-IN-PHRASING — push one error for every lowered `<md>` host directly inside `parentTag`
 * when `parentTag` is phrasing content.
 */
export function checkMdInPhrasing(parentTag: unknown, children: any[], ctx: Pick<MdLowerCtx, "errors" | "makeError">): void {
  if (!isMdPhrasingParent(parentTag)) return;
  for (const c of children) {
    if (c && c.kind === "markup" && c._mdHost === true) {
      const msg =
        `E-MD-IN-PHRASING: \`<md>\` cannot sit inside \`<${String(parentTag)}>\`. ` +
        `An \`<md>\` builds block content (paragraphs, headings, lists) and \`<${String(parentTag)}>\` holds ` +
        `only phrasing content — the browser would move the blocks out, so the page would not be the tree ` +
        `scrml built. Put the \`<md>\` in a block container (\`<div>\`, \`<section>\`, \`<article>\`, \`<li>\`) ` +
        `instead, or write the inline formatting as elements (\`<strong>\`, \`<em>\`) (SPEC §67.2).`;
      const err = ctx.makeError("E-MD-IN-PHRASING", msg, c.span);
      err.baseMessage = msg;
      ctx.errors.push(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Text encoding (MD-SAFE)
// ---------------------------------------------------------------------------

/**
 * The HTML a md text run is written as: every character that HTML could read as markup is
 * encoded — `&`, `<`, `>`, `"` — and so is `$`, so no emitter that scans text for a `${`
 * interpolation can ever find one in md text (md text is never an interpolation, §67.4).
 */
export function encodeMdText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\$/g, "&#36;");
}

/** A JS/scrml string literal for `text` whose `$` can never start an interpolation. */
function exprStringLiteral(text: string): string {
  return JSON.stringify(text).replace(/\$/g, "\\u0024");
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/** Map an absolute file offset inside the `<md>` block to {line, col}. */
function makePosAt(block: any): (abs: number) => { line: number; col: number } {
  const raw: string = typeof block.raw === "string" ? block.raw : "";
  const anchor = block.span?.start ?? 0;
  const line0 = block.span?.line ?? 1;
  const col0 = block.span?.col ?? 1;
  // newline offsets inside raw, for a binary search
  const nls: number[] = [];
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) nls.push(i);
  return (abs: number) => {
    const local = Math.max(0, Math.min(raw.length, abs - anchor));
    let lo = 0;
    let hi = nls.length; // count of newlines before `local`
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nls[mid] < local) lo = mid + 1; else hi = mid;
    }
    if (lo === 0) return { line: line0, col: col0 + local };
    return { line: line0 + lo, col: local - nls[lo - 1] };
  };
}

// ---------------------------------------------------------------------------
// The lowering
// ---------------------------------------------------------------------------

/** The attributes a static `<md>` admits on its host (§67.2). */
const MD_HOST_ATTRS = new Set(["class", "id", "style"]);
/**
 * Structural attributes that do not put anything into the host element: §17's render gates.
 * They apply to the `<md>` as to any element (PA reading, s462-md-phase2 — §67.2 is silent;
 * dropping `if=` with a warning would show content the author gated).
 */
const MD_STRUCTURAL_ATTRS = new Set(["if", "else-if", "else", "show"]);

/**
 * Lower an `<md>` markup block (`block.name` is `md`, not a component). `attrs` are the opener's
 * parsed attributes; `span` the block's file span. Returns the host `div` markup node.
 */
export function lowerMdBlock(block: any, attrs: any[], span: Span, ctx: MdLowerCtx): any {
  const { counter, errors } = ctx;
  const posAt = makePosAt(block);
  const spanAt = (abs: number, len = 1): Span => ({ file: span.file ?? ctx.filePath, start: abs, end: abs + len, ...posAt(abs) });
  const pushErr = (code: string, msg: string, sp: Span, warning = false) => {
    const err = ctx.makeError(code, msg, sp);
    err.baseMessage = msg;
    if (warning) err.severity = "warning";
    errors.push(err);
  };

  // --- host attributes (§67.2) ---------------------------------------------------------------
  const hostAttrs: any[] = [];
  let ofAttr: any = null;
  for (const a of attrs) {
    if (!a || typeof a.name !== "string") continue;
    const n = a.name;
    if (MD_HOST_ATTRS.has(n) || MD_STRUCTURAL_ATTRS.has(n)) { hostAttrs.push(a); continue; }
    if (n === "of") { ofAttr = a; continue; }
    pushErr(
      "W-ATTR-001",
      `W-ATTR-001: \`<md>\` does not accept the attribute \`${n}\`; it is dropped. A static \`<md>\` takes ` +
      `\`class=\`, \`id=\` and \`style=\`, which go to its host element and never into the markdown (SPEC §67.2).`,
      (a.span as Span) ?? span,
      true,
    );
  }

  const host = (children: any[]): any => ({
    id: ++counter.next,
    kind: "markup",
    tag: "div",
    attrs: hostAttrs,
    children,
    selfClosing: false,
    closerForm: "explicit",
    shorthandBodyRaw: null,
    openerHadSpaceAfterLt: false,
    span,
    _mdHost: true,
  });

  const body: MdBody | undefined = block.mdBody;
  const hasBody = !!body && body.end > body.start && /\S/.test(sliceAbs(block, body.start, body.end));

  // --- `<md of=…/>` (§67.7 — phase 3) ---------------------------------------------------------
  if (ofAttr) {
    if (hasBody) {
      pushErr(
        "E-MD-OF-BODY",
        "E-MD-OF-BODY: an `<md of=…>` has a body. `of=` reads the markdown from its value, so the element " +
        "takes no body: write `<md of=expr/>`, or drop `of=` and write the markdown as the body (SPEC §67.7).",
        (ofAttr.span as Span) ?? span,
      );
    } else {
      pushErr(
        "E-MD-OF-NOMINAL",
        "E-MD-OF-NOMINAL: `<md of=expr/>` (markdown from data, SPEC §67.7) is specified but not implemented " +
        "in this compiler yet (Nominal / spec-ahead — build phase 3). A static `<md>` body works today: " +
        "write the markdown between `<md>` and `</md>`, with `${…}` for text values.",
        (ofAttr.span as Span) ?? span,
      );
    }
    return host([]);
  }
  if (!body) return host([]);

  // --- 1. slots -> U+FFFC, with an offset map back to the file --------------------------------
  // s1: the body with each CLOSED slot as one U+FFFC; map1[k] = file offset of s1[k].
  let s1 = "";
  const map1: number[] = [];
  const slotAt = new Map<number, number>(); // s1 offset of a U+FFFC -> slot index
  const slots: Array<{ start: number; end: number; source: string }> = [];
  let p = body.start;
  for (const sl of body.slots ?? []) {
    for (; p < sl.start; p++) { s1 += sourceCharAt(block, p); map1.push(p); }
    if (!sl.closed) {
      pushErr(
        "E-MD-INTERP-UNCLOSED",
        "E-MD-INTERP-UNCLOSED: this `${` in an `<md>` body has no closing `}` before `</md>`. Inside `<md>`, " +
        "`${…}` inserts a value as text, so it must close. To SHOW a `${` that does not close (shell or " +
        "template code), put the text in a `<pre>` (raw content, SPEC §4.17), which shows what you type " +
        "(SPEC §67.2).",
        spanAt(sl.start, 2),
      );
      break; // the unclosed `${…` stays literal text (recovery; the error is fatal)
    }
    slotAt.set(s1.length, slots.length);
    slots.push({ start: sl.start, end: sl.end, source: sliceAbs(block, sl.start, sl.end) });
    s1 += SLOT_CHAR;
    map1.push(sl.start);
    p = sl.end;
  }
  for (; p < body.end; p++) { s1 += sourceCharAt(block, p); map1.push(p); }

  // --- 2. dedent (§67.2) — the reader's rule --------------------------------------------------
  const dd = dedent(s1) as { text: string; indent: number; dropFirst: boolean; mixed: boolean };
  if (dd.mixed) {
    pushErr(
      "E-MD-INDENT-MIXED",
      "E-MD-INDENT-MIXED: the lines of this `<md>` body are indented with different characters (a tab on " +
      "one line, spaces on another), so the indentation to remove is ambiguous. Indent every line of the " +
      "body with the same characters (SPEC §67.2).",
      spanAt(body.start, 0),
    );
  }
  const { map: map2, ok: mapOk } = dedentMap(s1, map1, dd);
  const fileOffsetOf = (k: number): number => {
    if (!mapOk) return body.start;
    if (k < map2.length) return map2[k];
    return map2.length > 0 ? map2[map2.length - 1] + 1 : body.start;
  };

  // the slots as the reader sees them: the U+FFFC offsets in the dedented text
  const readerSlots: Array<{ offset: number; source: string }> = [];
  const readerIndexToSlot: number[] = [];
  if (mapOk) {
    // a U+FFFC in the dedented text is a slot when its source offset is a slot's `${`
    const slotByFileStart = new Map<number, number>();
    slots.forEach((s, i) => slotByFileStart.set(s.start, i));
    for (let k = 0; k < dd.text.length; k++) {
      if (dd.text[k] !== SLOT_CHAR) continue;
      const si = slotByFileStart.get(map2[k]);
      if (si === undefined) continue; // an author-typed U+FFFC — ordinary text
      readerIndexToSlot.push(si);
      readerSlots.push({ offset: k, source: slots[si].source });
    }
  }

  // --- 3. read --------------------------------------------------------------------------------
  const doc = parseSlots(dd.text, readerSlots) as { blocks: any[]; diags: Array<{ code: string; message: string; offset: number }> };
  for (const d of doc.diags ?? []) {
    const abs = fileOffsetOf(d.offset);
    pushErr(d.code, `${d.code}: ${d.message} (SPEC §67.3)`, spanAt(abs), true);
  }

  // --- 4/5. lower ----------------------------------------------------------------------------
  const mk = (tag: string, attrsList: any[], children: any[], selfClosing = false): any => ({
    id: ++counter.next,
    kind: "markup",
    tag,
    attrs: attrsList,
    children,
    selfClosing,
    closerForm: selfClosing ? "self-closing" : "explicit",
    shorthandBodyRaw: null,
    openerHadSpaceAfterLt: false,
    span,
    _md: true,
  });
  const text = (t: string): any => ({ id: ++counter.next, kind: "text", value: encodeMdText(t), span, _mdText: t });
  const strAttr = (name: string, value: string): any => {
    // A literal value holding `${` (code restored inside an image's alt text) would be read as an
    // attribute template by the emitters; write it as a string-literal EXPRESSION instead.
    if (value.includes("${")) {
      const raw = exprStringLiteral(value);
      return { name, value: { kind: "expr", raw, refs: [], exprNode: ctx.parseExpr(raw, span.start), span }, span, _md: true };
    }
    return { name, value: { kind: "string-literal", value, span }, span, _md: true };
  };

  const slotOf = (readerIndex: number): { start: number; end: number; source: string } | null => {
    const si = readerIndexToSlot[readerIndex];
    return si === undefined ? null : slots[si];
  };

  // An MdSeg[] (attribute value) -> an attribute, or null when the value is empty and optional.
  const segAttr = (name: string, segs: any[], urlAttr: boolean, ownerTag: string): any => {
    const lits: string[] = [];
    let dataLed = false;
    for (const s of segs) {
      if (s.variant === "Slot") { dataLed = true; break; }
      lits.push(s.data.text);
    }
    if (!dataLed) {
      const value = lits.join("");
      if (urlAttr && !_scrml_url_value_admitted(name, value)) {
        urlSchemeError(name, value, ownerTag, false);
      }
      return strAttr(name, value);
    }
    // data-led (§67.4): the literal prefix before the first slot may already commit to a scheme
    if (urlAttr) {
      const first = segs[0];
      const prefix = first && first.variant === "Lit" ? String(first.data.text) : "";
      const r = _scrml_read_url_scheme(prefix, false) as { kind: string; scheme?: string; rest?: string };
      if (r.kind === "scheme" && !_scrml_url_scheme_admitted(name, r.scheme ?? "", r.rest ?? "")) {
        // `data:` on an image source whose media type the data still supplies — judged at run time
        const pendingDataType = r.scheme === "data" && name === "src" && !/[;,]/.test(r.rest ?? "");
        if (!pendingDataType) urlSchemeError(name, prefix, ownerTag, true);
      }
    }
    // `[lit, (slot), lit].join("")`: one evaluation per slot; a `not` value joins as "" (§7.4.2).
    const parts: string[] = [];
    const refs: string[] = [];
    // the same value as segments, for an emitter that builds it piecewise (SSR rows)
    const mdSegs: Array<{ lit: string } | { slot: string }> = [];
    let anchor = -1;
    let lead = 1; // the `[` before the first part
    for (const s of segs) {
      if (s.variant === "Lit") {
        const lit = exprStringLiteral(String(s.data.text));
        if (anchor < 0) lead += lit.length + 2;
        parts.push(lit);
        mdSegs.push({ lit: String(s.data.text) });
        continue;
      }
      const sl = slotOf(s.data.index);
      if (!sl) continue;
      const inner = sl.source.slice(2, -1);
      if (anchor < 0) anchor = sl.start + 2 - (lead + 1); // align the first slot's text with its file offset
      parts.push("(" + inner + ")");
      mdSegs.push({ slot: inner });
      for (const m of inner.matchAll(/@([A-Za-z_$][A-Za-z0-9_$]*)/g)) if (!refs.includes(m[1])) refs.push(m[1]);
    }
    const raw = "[" + parts.join(", ") + "].join(\"\")";
    const exprNode = ctx.parseExpr(raw, anchor >= 0 ? anchor : span.start);
    return { name, value: { kind: "expr", raw, refs, exprNode, span, mdSegs }, span, _md: true, _mdDataLed: true };
  };

  const urlSchemeError = (name: string, value: string, ownerTag: string, prefixOnly: boolean): void => {
    const shown = value.length > 60 ? value.slice(0, 57) + "..." : value;
    pushErr(
      "E-MD-URL-SCHEME",
      `E-MD-URL-SCHEME: the ${ownerTag === "img" ? "image source" : "link destination"} \`${shown}\`` +
      `${prefixOnly ? " (the text before its `${…}`)" : ""} in this \`<md>\` body uses a URL scheme scrml does not ` +
      `admit. A link may be relative or use http, https, ftp, mailto, tel or sms; an image may also be a ` +
      `raster \`data:image/…\` URL. Nothing in an \`<md>\` body can run, so \`javascript:\` and other ` +
      `unadmitted schemes are refused (SPEC §67.6, §5.2).`,
      span,
    );
  };

  const lowerInlines = (xs: any[]): any[] => {
    const out: any[] = [];
    for (const x of xs ?? []) {
      const v = typeof x === "string" ? x : x?.variant;
      switch (v) {
        case "Text": out.push(text(String(x.data.text))); break;
        case "SoftBreak": out.push(text("\n")); break;
        case "HardBreak": out.push(mk("br", [], [], true)); out.push(text("\n")); break;
        case "Code": out.push(mk("code", [], [text(String(x.data.text))])); break;
        case "Em": out.push(mk("em", [], lowerInlines(x.data.children))); break;
        case "Strong": out.push(mk("strong", [], lowerInlines(x.data.children))); break;
        case "Del": out.push(mk("del", [], lowerInlines(x.data.children))); break;
        case "Slot": {
          const sl = slotOf(x.data.index);
          if (!sl) break;
          const pos = posAt(sl.start);
          const node = ctx.buildSlotNode(sl.source, sl.start, pos.line, pos.col);
          if (node) { node._mdSlot = true; out.push(node); }
          break;
        }
        case "Link": {
          const as: any[] = [segAttr("href", x.data.dest, true, "a")];
          if ((x.data.title ?? []).length > 0) as.push(segAttr("title", x.data.title, false, "a"));
          out.push(mk("a", as, lowerInlines(x.data.children)));
          break;
        }
        case "Image": {
          const as: any[] = [segAttr("src", x.data.src, true, "img"), segAttr("alt", x.data.alt ?? [], false, "img")];
          if ((x.data.title ?? []).length > 0) as.push(segAttr("title", x.data.title, false, "img"));
          out.push(mk("img", as, [], true));
          break;
        }
        default:
          // The tree is closed (§67.5); an unknown kind is a reader/compiler mismatch. Fail closed:
          // nothing is rendered for it.
          break;
      }
    }
    // Adjacent text runs (a soft break between two words, say) are ONE text node, as the HTML
    // parser would make them — so a DOM-built row and a parsed page have the same tree.
    const merged: any[] = [];
    for (const n of out) {
      const prev = merged[merged.length - 1];
      if (prev && prev.kind === "text" && typeof prev._mdText === "string" && n.kind === "text" && typeof n._mdText === "string") {
        prev._mdText += n._mdText;
        prev.value = encodeMdText(prev._mdText);
        continue;
      }
      merged.push(n);
    }
    return merged;
  };

  const ALIGN: Record<string, string> = { Left: "text-align:left", Center: "text-align:center", Right: "text-align:right" };
  const lowerRow = (row: any, cellTag: string, align: any[]): any => {
    const cells = (row?.cells ?? []).map((c: any, i: number) => {
      const a = align[i];
      const av = typeof a === "string" ? a : a?.variant;
      const style = av && ALIGN[av] ? [strAttr("style", ALIGN[av])] : [];
      return mk(cellTag, style, lowerInlines(c.children));
    });
    return mk("tr", [], cells);
  };

  const withBreaks = (nodes: any[]): any[] => {
    const out: any[] = [];
    for (const n of nodes) { out.push(text("\n")); out.push(n); }
    if (nodes.length > 0) out.push(text("\n"));
    return out;
  };

  const lowerBlocks = (bs: any[]): any[] => bs.map(lowerBlock).filter(Boolean);
  function lowerBlock(b: any): any {
    const v = typeof b === "string" ? b : b?.variant;
    switch (v) {
      case "Paragraph": return mk("p", [], lowerInlines(b.data.children));
      case "Heading": {
        const level = Math.min(6, Math.max(1, Number(b.data.level) || 1));
        const h = mk("h" + level, [strAttr("id", "section")], lowerInlines(b.data.children));
        h._mdHeading = true;
        // the heading's own slug, before any dedupe — `headingSlugs` over this heading alone
        h._mdSlugBase = String((headingSlugs({ blocks: [b], diags: [] }, []) as string[])[0] ?? "section");
        return h;
      }
      case "CodeBlock": {
        const lang = String(b.data.lang ?? "");
        const codeAttrs = /^[A-Za-z0-9_+-]+$/.test(lang) ? [strAttr("class", "language-" + lang)] : [];
        return mk("pre", [], [mk("code", codeAttrs, [text(String(b.data.text))])]);
      }
      case "Quote": return mk("blockquote", [], withBreaks(lowerBlocks(b.data.children)));
      case "Rule": return mk("hr", [], [], true);
      case "List": {
        const ordered = b.data.ordered === true;
        const start = Number(b.data.start);
        const listAttrs = ordered && Number.isInteger(start) && start !== 1 ? [strAttr("start", String(start))] : [];
        const tight = b.data.tight === true;
        const items = (b.data.items ?? []).map((it: any) => {
          const kids = it.children ?? [];
          if (!tight) return mk("li", [], withBreaks(lowerBlocks(kids)));
          // tight: an item's paragraphs are written without `p` (CommonMark 5.3)
          const out: any[] = [];
          kids.forEach((k: any, i: number) => {
            const kv = typeof k === "string" ? k : k?.variant;
            if (i > 0) out.push(text("\n"));
            if (kv === "Paragraph") out.push(...lowerInlines(k.data.children));
            else { const n = lowerBlock(k); if (n) out.push(n); }
          });
          if (kids.length > 1) out.push(text("\n"));
          return mk("li", [], out);
        });
        return mk(ordered ? "ol" : "ul", listAttrs, withBreaks(items));
      }
      case "Table": {
        const align = b.data.align ?? [];
        const head = mk("thead", [], [lowerRow(b.data.head, "th", align)]);
        const rows = (b.data.rows ?? []).map((r: any) => lowerRow(r, "td", align));
        return mk("table", [], rows.length > 0 ? [head, mk("tbody", [], rows)] : [head]);
      }
      default:
        return null;
    }
  }

  const blocks = lowerBlocks(doc.blocks ?? []);
  const hostNode = host(withBreaks(blocks));
  // Heading ids (§67.6): the file-wide pass (`assignMdHeadingIds`) re-derives them against every
  // author `id=` on the page; this local assignment is the answer when no such pass runs.
  const hs = collectHeadings(hostNode);
  applyIds(hs, dedupeSlugs(hs.map((h) => h._mdSlugBase), []));
  return hostNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sliceAbs(block: any, start: number, end: number): string {
  const raw: string = typeof block.raw === "string" ? block.raw : "";
  const anchor = block.span?.start ?? 0;
  return raw.slice(start - anchor, end - anchor);
}

function sourceCharAt(block: any, abs: number): string {
  const raw: string = typeof block.raw === "string" ? block.raw : "";
  return raw[abs - (block.span?.start ?? 0)] ?? "";
}

/**
 * The dedented text's offsets mapped back to file offsets, by replaying the reader's dedent
 * line rule with its own outputs (`dropFirst`, `indent`): drop the blank opener line, drop a
 * blank closer line, keep a content first line whole, empty a blank line, strip `indent`
 * characters from every other line. `ok` is false when the replay does not reproduce the
 * reader's text exactly (then positions fall back to the body start).
 */
function dedentMap(s1: string, map1: number[], dd: { text: string; indent: number; dropFirst: boolean }): { map: number[]; ok: boolean } {
  const lines: Array<{ text: string; at: number }> = [];
  let start = 0;
  for (let i = 0; i <= s1.length; i++) {
    if (i === s1.length || s1[i] === "\n") { lines.push({ text: s1.slice(start, i), at: start }); start = i + 1; }
  }
  const blank = (t: string) => /^[ \t]*$/.test(t);
  let out = "";
  const map: number[] = [];
  if (lines.length === 1) {
    for (let k = 0; k < s1.length; k++) map.push(map1[k]);
    return { map, ok: s1 === dd.text };
  }
  let first = 0;
  let last = lines.length - 1;
  const emitted: Array<{ text: string; at: number; strip: number }> = [];
  if (dd.dropFirst) first = 1;
  else emitted.push({ ...lines[0], strip: 0 });
  if (blank(lines[last].text)) last -= 1;
  for (let li = 1; li <= last; li++) {
    const l = lines[li];
    emitted.push({ ...l, strip: blank(l.text) ? l.text.length : dd.indent });
  }
  void first;
  emitted.forEach((l, idx) => {
    if (idx > 0) { out += "\n"; map.push(map1[l.at - 1] ?? map1[l.at] ?? 0); }
    for (let k = l.strip; k < l.text.length; k++) { out += l.text[k]; map.push(map1[l.at + k]); }
  });
  return { map, ok: out === dd.text };
}

/** The lowered heading nodes under `root`, in document order. */
function collectHeadings(root: any): any[] {
  const out: any[] = [];
  const visit = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n.kind === "markup" && n._mdHeading === true) out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}

/**
 * The deduped ids for headings whose own slugs are `bases`, none of them in `taken` — computed by
 * the reader's `headingSlugs` (the ONE implementation of the §67.6 rule) over headings whose text
 * is the slug itself (a slug is a fixed point of the slug rule).
 */
function dedupeSlugs(bases: string[], taken: string[]): string[] {
  const doc = { blocks: bases.map((b) => MdBlock.Heading(1, [MdInline.Text(b)])), diags: [] };
  return headingSlugs(doc, taken) as string[];
}

/** Write `ids` onto `headings` (both in document order). */
function applyIds(headings: any[], ids: string[]): void {
  headings.forEach((n, k) => {
    const id = ids[k];
    if (typeof id !== "string") return;
    // A NEW attribute object: component instances may share the template's attribute objects,
    // and each instance's heading gets its own id.
    n.attrs = (n.attrs ?? []).map((x: any) =>
      x && x.name === "id" && x.value && x.value.kind === "string-literal"
        ? { ...x, value: { ...x.value, value: id } }
        : x);
  });
}

/**
 * §67.6 heading ids, page-wide: every heading of every static `<md>` in the file gets a slug that
 * no author `id=` in the file and no earlier heading already uses (`-1`, `-2`, … in document
 * order). Runs over the file's AST after it is built, and again after component expansion.
 */
export function assignMdHeadingIds(root: unknown): void {
  const authorIds: string[] = [];
  const headings: any[] = [];
  const seen = new Set<object>();
  const visit = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (n.kind === "markup") {
      if (n._mdHeading === true) {
        headings.push(n);
      } else {
        for (const a of n.attrs ?? []) {
          if (a && a.name === "id" && a.value && a.value.kind === "string-literal" && typeof a.value.value === "string") {
            authorIds.push(a.value.value);
          }
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(root);
  if (headings.length === 0) return;
  applyIds(headings, dedupeSlugs(headings.map((h) => String(h._mdSlugBase ?? "section")), authorIds));
}
