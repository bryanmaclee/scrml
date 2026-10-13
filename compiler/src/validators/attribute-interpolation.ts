/**
 * VP-3 — Attribute Interpolation Validation
 *
 * Walks the AST and emits an error when `${...}` interpolation appears in
 * an attribute value where the attribute is NOT flagged
 * `supportsInterpolation: true` in the per-element registry.
 *
 * Closes F-CHANNEL-001 (`<channel name="driver-${id}">` silently inert).
 * The literal `${id}` survives codegen as a static substring of the
 * channel WebSocket URL, so every "per-id" channel collapses to a single
 * broadcast topic. VP-3 turns this silent failure into a compile-time
 * error.
 *
 * Emits: E-CHANNEL-007 (currently the only emit point — future scrml
 * elements with non-interpolating attrs will reuse this pass and may
 * surface different codes via a per-element override.)
 *
 * Detection rule: AttrValue is `kind: "string-literal"` AND its `value`
 * string contains `${` (the literal interpolation marker survives TAB
 * for unsupported attributes).
 *
 * Second rule (S456, SPEC §5.2 executable-sink rule): `${...}` in a QUOTED attribute whose text the
 * browser EXECUTES — an event-handler attribute (`on…`, any case), `srcdoc`, or a
 * URL-valued attribute whose literal text begins with a non-safe scheme
 * (`javascript:` …) — is E-ATTR-INTERP-EXECUTABLE, on EVERY markup element
 * (not registry-gated). The decision is `attr-injection-sink.ts`'s
 * `classifyInterpolatedAttrSink` (the one reader, shared with the `<each>` row
 * lowering). The walk for it is `walkEveryMarkupNode`, which reaches markup in
 * every AST field (each / engine / match bodies, markup values inside
 * expressions, component definitions) — `walkFileAst` covers a fixed field list
 * and does not descend `bodyChildren`.
 *
 * Cross-reference:
 *   - SPEC §38 (channels) — `name=` is literal; no interpolation supported.
 *   - F-CHANNEL-001 — closed silent-failure window after this pass lands.
 *   - SPEC §5.2 executable-sink rule — executable-sink interpolation (S456).
 */

import type { Span, FileAST, MarkupNode } from "../types/ast.ts";
import { getElementAttrSchema } from "../attribute-registry.js";
import { walkFileAst } from "./ast-walk.ts";
import {
  classifyInterpolatedAttrSink,
  executableDataWriteSink,
  interpolatedAttrSinkMessage,
  ATTR_INTERP_EXECUTABLE_CODE,
  ATTR_QUOTED_HANDLER_CODE,
  ATTR_STATIC_EXECUTABLE_CODE,
  classifyStaticExecutableAttr,
  staticExecutableMessage,
  type StaticExecutableSink,
  isQuotedStaticHandler,
  quotedHandlerMessage,
  attrSinkKey,
} from "../attr-injection-sink.ts";

// ---------------------------------------------------------------------------
// Diagnostic shape
// ---------------------------------------------------------------------------

export interface AttrInterpError {
  code: string;
  message: string;
  span: Span;
  severity: "error";
}

// ---------------------------------------------------------------------------
// Per-element error code mapping
// ---------------------------------------------------------------------------

const ELEMENT_ERROR_CODE = new Map<string, string>([
  ["channel", "E-CHANNEL-007"],
]);

function errorCodeFor(tag: string): string {
  return ELEMENT_ERROR_CODE.get(tag.toLowerCase()) ?? "E-ATTR-001";
}

// ---------------------------------------------------------------------------
// Detection: literal containing `${`
// ---------------------------------------------------------------------------

function attrValueHasInterpolation(value: unknown): { match: boolean; raw?: string } {
  if (!value || typeof value !== "object") return { match: false };
  const v = value as { kind?: string; value?: unknown };
  if (v.kind !== "string-literal") return { match: false };
  if (typeof v.value !== "string") return { match: false };
  return { match: v.value.includes("${"), raw: v.value };
}

// ---------------------------------------------------------------------------
// Per-markup-node validation
// ---------------------------------------------------------------------------

function validateMarkup(
  node: MarkupNode,
  filePath: string,
  errors: AttrInterpError[]
): void {
  const tag = node.tag ?? "";
  if (!tag) return;
  const schema = getElementAttrSchema(tag);
  if (!schema) return;

  for (const attr of node.attrs ?? []) {
    if (!attr || !attr.name) continue;
    const spec = schema.allowedAttrs.get(attr.name);
    if (!spec) continue; // unknown attr — VP-1's territory.
    if (spec.supportsInterpolation === true) continue;

    const detection = attrValueHasInterpolation(attr.value);
    if (!detection.match) continue;

    const span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    errors.push({
      code: errorCodeFor(tag),
      message:
        `${errorCodeFor(tag)}: Attribute \`${attr.name}=\` on \`<${tag}>\` does not support \`\${...}\` ` +
        `interpolation. The expression is currently emitted as a literal substring of the attribute ` +
        `value (\`${detection.raw}\`), which silently breaks any per-instance scoping the adopter ` +
        `intended. ` +
        (tag.toLowerCase() === "channel"
          ? `For per-id channel scoping, use a static name + payload-side filtering: ` +
            `\`<channel name="driver-events">\` and filter messages on \`payload.targetId\`. ` +
            `(See F-CHANNEL-001 in examples/23-trucking-dispatch/FRICTION.md.)`
          : `Use a static literal for this attribute.`),
      span,
      severity: "error",
    });
  }
}

// ---------------------------------------------------------------------------
// Executable-sink interpolation (S456, §5.2 executable-sink rule) — every markup element
// ---------------------------------------------------------------------------

/**
 * Visit every `kind:"markup"` node reachable from `root` through ANY field — fail closed on
 * coverage: a container field that holds markup is walked without an edit here. Cycles
 * (parent links, shared sub-trees) are cut by identity.
 */
/** Where an expanded component instance sits in the SOURCE the author wrote. */
interface ExpansionContext {
  /** The outermost call site whose span is in a real file (not a re-parsed component body). */
  anchor: Span | null;
  /** The nearest enclosing component's name (`_expandedFrom`). */
  component: string | null;
}

/**
 * A span whose `file` is `<path>#<Component>` belongs to a component body re-parsed by the
 * component expander: its offsets are relative to the body text, not the source file.
 */
function spanFileIsReparsedComponentBody(file: unknown): boolean {
  return typeof file === "string" && /#[A-Za-z_$][A-Za-z0-9_$]*$/.test(file);
}

/**
 * Spans whose offsets are NOT the source file's: a re-parsed component body (`path#Name`) or
 * markup re-parsed from a `^{ emit(…) }` (`__meta_emit__`).
 */
function spanFileIsSynthesized(file: unknown): boolean {
  return spanFileIsReparsedComponentBody(file) || file === "__meta_emit__";
}

function walkEveryMarkupNode(
  root: unknown,
  visit: (node: MarkupNode, ctx: ExpansionContext) => void,
): void {
  const seen = new Set<object>();
  const stack: Array<{ cur: unknown; ctx: ExpansionContext }> = [
    { cur: root, ctx: { anchor: null, component: null } },
  ];
  while (stack.length > 0) {
    const { cur, ctx: parentCtx } = stack.pop()!;
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur as object)) continue;
    seen.add(cur as object);
    if (Array.isArray(cur)) {
      for (const c of cur) if (c && typeof c === "object") stack.push({ cur: c, ctx: parentCtx });
      continue;
    }
    const rec = cur as Record<string, unknown>;
    let ctx = parentCtx;
    if (rec._metaEmitSiteSpan && typeof rec._metaEmitSiteSpan === "object" && parentCtx.anchor === null) {
      // A node spliced in by `^{ emit(…) }` (meta-eval stamps the `^{}` block's span).
      const site = rec._metaEmitSiteSpan as Span;
      if (!spanFileIsSynthesized(site.file)) ctx = { anchor: site, component: parentCtx.component };
    }
    if (typeof rec._expandedFrom === "string") {
      // An expanded component root (component-expander stamps `_expansionSiteSpan` = the call
      // site). Nested expansions sit inside a re-parsed body, so the OUTERMOST real call site
      // is what the author can find; keep it once set.
      const site = rec._expansionSiteSpan as Span | undefined;
      const anchor = ctx.anchor ??
        (site && !spanFileIsSynthesized(site.file) ? site : null);
      ctx = { anchor, component: rec._expandedFrom as string };
    }
    if (rec.kind === "markup" && typeof rec.tag === "string" && Array.isArray(rec.attrs)) {
      // S464 round 5 — each markup child learns its parent's tag (an SVG animation inside `<image>`
      // animates an image load). The stamp is on the AST node, so codegen reads the same value.
      if (Array.isArray(rec.children)) {
        for (const c of rec.children as Array<Record<string, unknown>>) {
          if (c && typeof c === "object" && c.kind === "markup") c._parentTag = rec.tag;
        }
      }
      visit(cur as unknown as MarkupNode, ctx);
    }
    for (const key of Object.keys(rec)) {
      if (key === "span") continue;
      const v = rec[key];
      if (v && typeof v === "object") stack.push({ cur: v, ctx });
    }
  }
}

/**
 * Is `name` on `node` an attribute of a rendered ELEMENT (so a data value reaches the DOM)? A
 * component call (`<Frame srcdoc=@x/>`, uppercase tag) passes a prop, and a DECLARED prop merged
 * onto an expanded component root (`_componentPropNames`) is consumed by the component — neither is
 * an element attribute (§5.2 rule 3's element scope). What the expanded body writes onto an element
 * is judged where it is written.
 */
function dataValueReachesElementAttr(node: MarkupNode, name: string): boolean {
  const tag = String(node.tag ?? "");
  if (/^[A-Z]/.test(tag)) return false;
  const declared = (node as { _componentPropNames?: unknown })._componentPropNames;
  if (Array.isArray(declared) && declared.includes(name)) return false;
  return true;
}

/**
 * §5.2 executable-sink rule — every quoted attribute under `root` whose `${…}` lands in an executable sink.
 * `where` qualifies the message (e.g. "in component `Card`"); `spanOverride`, when given,
 * anchors every diagnostic there (a component body is re-parsed from text whose offsets are
 * not the source file's, so the component-expander anchors at the definition).
 *
 * Called by VP-3 (post-CE, every markup position of the file) and by the component expander
 * for each component DEFINITION body (`parseComponentDef`) — a component body is raw text
 * until CE parses it, and CE substitutes a prop into a quoted attribute textually, so the
 * `${label}` the author wrote is gone by VP-3. Both callers use `classifyInterpolatedAttrSink`.
 */
export function collectExecutableSinkErrors(
  root: unknown,
  filePath: string,
  opts: { where?: string; spanOverride?: Span; markReported?: boolean } = {},
): AttrInterpError[] {
  const errors: AttrInterpError[] = [];
  const reported = new Set<string>();
  walkEveryMarkupNode(root, (node, ctx) => {
    for (const attr of node.attrs ?? []) {
      if (!attr || typeof attr.name !== "string") continue;
      const v = attr.value as { kind?: string; value?: unknown } | undefined;
      if (!v) continue;
      // Already reported at the component DEFINITION (the def check stamps the attribute it
      // refused; prop substitution copies the attribute with `{...attr}`, so the stamp travels
      // with every expanded copy whose definition text was itself a sink).
      if ((attr as { _execSinkReportedAtDef?: boolean })._execSinkReportedAtDef === true) continue;
      let sink: ReturnType<typeof classifyInterpolatedAttrSink> = null;
      let form: "quoted" | "data" = "quoted";
      let quotedHandler = false;
      let staticSink: StaticExecutableSink | null = null;
      if (v.kind === "string-literal" && typeof v.value === "string" &&
          isQuotedStaticHandler(attr.name, v.value) && dataValueReachesElementAttr(node, attr.name)) {
        // S464 — a quoted event attribute with no `${…}` (`onclick="alert(1)"`): text the browser
        // would run as raw JavaScript. A component call's prop (`<Btn onclick="…"/>`, a DECLARED
        // prop) is not an element attribute; an undeclared one that falls through onto the
        // expanded root is (`dataValueReachesElementAttr`).
        quotedHandler = true;
      } else if (v.kind === "string-literal" && typeof v.value === "string" &&
                 dataValueReachesElementAttr(node, attr.name) &&
                 // An `<md>`-built `a href` / `img src` is judged by §67.6 (E-MD-URL-SCHEME) with the
                 // same scheme test — one report per destination.
                 (attr as { _md?: boolean })._md !== true &&
                 (staticSink = classifyStaticExecutableAttr(attr.name, v.value,
                   { tag: node.tag, attrs: node.attrs, parentTag: (node as { _parentTag?: string })._parentTag ?? null })) !== null) {
        // S464 "(a) Refuse both" — a STATIC `srcdoc`, or a static URL attribute whose scheme rule 2's
        // safe set does not admit (`href="javascript:…"`): text the browser runs, unchecked.
      } else if (v.kind === "string-literal" && typeof v.value === "string") {
        // The element is passed so an SVG animation value (`<set attributeName="href" to="…">`) is
        // judged as the URL it writes (S457).
        sink = classifyInterpolatedAttrSink(attr.name, v.value, { tag: node.tag, attrs: node.attrs });
      } else if (v.kind !== "absent" && dataValueReachesElementAttr(node, attr.name)) {
        // S457 — a `srcdoc` whose value is data in any unquoted form (`srcdoc=${…}`, `=@cell`,
        // `=fn()`, a row's `=it.html`, a prop reaching it). Event-handler names are not judged
        // here: their unquoted forms are the sanctioned listener forms, and an emitter that would
        // write one as text refuses at the write (`executableDataWriteSink`).
        const s = executableDataWriteSink(attr.name);
        if (s && s.kind === "srcdoc") { sink = s; form = "data"; }
      }
      if (!sink && !quotedHandler && !staticSink) continue;
      // A value written verbatim by the author (no caller substitution): anchored where it is written.
      const staticText = quotedHandler || staticSink !== null;
      if (opts.markReported) (attr as { _execSinkReportedAtDef?: boolean })._execSinkReportedAtDef = true;
      const own: Span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      // An attribute inside an EXPANDED component instance: the value judged here is the one
      // that will be emitted (the caller's prop text substituted in). Its own span is relative
      // to the component body, so the diagnostic is anchored at the outermost call site.
      const inExpansion = spanFileIsSynthesized(own.file) && ctx.anchor !== null;
      // S464 — a static value (a quoted handler, a static executable value) has no caller-substituted
      // part: its text is exactly what the author wrote. When that text sits in a component
      // DEFINITION body, the component expander stamped the attribute with its own SOURCE position
      // (`_srcSpan`, mapped from the re-parsed body — the stamp travels with every expanded copy):
      // it is reported once, there, however many instances (e.g. `<Inner onclick="…"/>` inside
      // `Outer`, falling through onto Inner's root).
      const srcSpan = staticText ? ((attr as { _srcSpan?: Span })._srcSpan ?? null) : null;
      const ownDef = srcSpan && typeof own.file === "string"
        ? /#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(own.file) : null;
      const span = srcSpan ?? opts.spanOverride ?? (inExpansion ? (ctx.anchor as Span) : own);
      const where = (srcSpan && ownDef ? `in component \`${ownDef[1]}\`` : null) ?? opts.where ??
        (srcSpan ? ""
          : !inExpansion ? ""
          : ctx.component && staticText ? `in component \`${ctx.component}\` as used here`
          : ctx.component ? `in component \`${ctx.component}\` as used here (the caller's prop value is substituted into it)`
          : own.file === "__meta_emit__" ? "emitted by the `^{ emit(…) }` block here"
          : "");
      // One diagnostic per emitted attribute: a node reached through two fields (an each
      // body's `bodyChildren` and `templateChildren`) is one attribute; two instances of a
      // component are two.
      const key = srcSpan
        ? `src|${srcSpan.file ?? filePath}:${srcSpan.start}:${srcSpan.end}:${attr.name}`
        : `${span.file ?? filePath}:${span.start}:${span.end}|${own.file ?? filePath}:${own.start}:${own.end}:${attr.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const err: AttrInterpError = {
        code: quotedHandler ? ATTR_QUOTED_HANDLER_CODE
          : staticSink ? ATTR_STATIC_EXECUTABLE_CODE : ATTR_INTERP_EXECUTABLE_CODE,
        message: quotedHandler
          ? quotedHandlerMessage(attr.name, node.tag ?? "", where)
          : staticSink ? staticExecutableMessage(staticSink, attr.name, node.tag ?? "", where)
          : interpolatedAttrSinkMessage(sink!, attr.name, node.tag ?? "", where, form),
        span,
        severity: "error",
      };
      // The attribute's identity for cross-stage dedupe (api.js): the `<each>` row backstop
      // reports the same attribute at its own span.
      (err as { attrSinkKey?: string }).attrSinkKey = attrSinkKey(own, attr.name, filePath);
      (err as { attrSinkName?: string }).attrSinkName = attr.name.toLowerCase();
      errors.push(err);
    }
  });
  return errors;
}


// ---------------------------------------------------------------------------
// S464 — quoted handlers in markup held by an UNPARSED expression
// ---------------------------------------------------------------------------

/**
 * The executable-sink attributes written in markup inside `raw` — the text of an `escape-hatch`
 * expression (markup the expression parser could not read: a snippet lambda
 * `row={ (it) => <span onclick="…">…</span> }`, a markup value in a callback).
 *
 * `raw` is read as the two languages it holds (S464 round 2, review N2 — a JS tokenizer read markup
 * TEXT such as `don't` as an unterminated string and swallowed the next element):
 *   - CODE: JS string / template literals and comments are skipped (`"<b onclick=…>"` in a string is
 *     never an element); an element opener is `<` immediately followed by a letter;
 *   - an OPENER: attributes are read up to its `>` / `/>` — a quoted value (`"…"`, `'…'`), a braced
 *     value (`{…}` / `${…}`, skipped balanced), or none;
 *   - TEXT (between an opener's `>` and its closer): any character is text — an apostrophe, a quote,
 *     a backtick or `//` is display text — except `<` + letter (a child element), `</` (a closer),
 *     and `{` / `${` (an interpolation, read as CODE until its matching `}`).
 * Each opener's attributes are judged with the element's tag and attribute list, by the shared
 * readers: `isQuotedStaticHandler` (E-ATTR-QUOTED-HANDLER), `classifyStaticExecutableAttr`
 * (E-ATTR-STATIC-EXECUTABLE) and `classifyInterpolatedAttrSink` (E-ATTR-INTERP-EXECUTABLE).
 */
type MarkupTextSinkHit = {
  code: string;
  name: string;
  tag: string;
  offset: number;
  message: string;
};

const VOID_TAGS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Round 6 (review NEW-1) — a `<` + letter right after an OPERAND (an identifier, a number, a literal,
 * `)`, `]`) is AMBIGUOUS: `f(x) <g ? "a" : "b"` is a comparison, `if (c) <b …>` is markup, and either
 * misreading changes how the strings after it pair up — so committing to one reading can hide a real
 * sink. The text is therefore scanned under several readings and the sink hits are UNIONED: every
 * ambiguous `<` read as markup, every one read as a comparison, and — for each ambiguous position —
 * each of those with that one position flipped. After an operator, or after a markup-introducing
 * keyword (`lift`, `return`, …), `<` + letter is always markup (no ambiguity).
 */
function markupTextSinks(raw: string): MarkupTextSinkHit[] {
  const seen = new Set<string>();
  const out: MarkupTextSinkHit[] = [];
  const add = (hs: MarkupTextSinkHit[]) => {
    for (const h of hs) {
      const key = `${h.offset}|${h.name}|${h.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
  };
  const ambig = new Set<number>();
  add(markupTextSinksOnce(raw, () => true, ambig));
  add(markupTextSinksOnce(raw, () => false, ambig));
  // One flip per ambiguous position, against each uniform reading (bounded: the positions found by the
  // two uniform runs, capped so a pathological text cannot blow up the compile).
  const positions = [...ambig].slice(0, 64);
  for (const pos of positions) {
    add(markupTextSinksOnce(raw, (at) => at !== pos, new Set()));
    add(markupTextSinksOnce(raw, (at) => at === pos, new Set()));
  }
  return out;
}

function markupTextSinksOnce(raw: string, asMarkup: (pos: number) => boolean, ambig: Set<number>): MarkupTextSinkHit[] {
  const hits: MarkupTextSinkHit[] = [];
  const n = raw.length;
  const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
  const isNameCh = (c: string | undefined) => !!c && /[A-Za-z0-9_:\-.$@]/.test(c);
  // Skip a JS string literal starting at i (quote q); returns the index after it.
  const skipString = (i: number, q: string): number => {
    let k = i + 1;
    while (k < n && raw[k] !== q) {
      if (raw[k] === "\\") k++;
      else if (q === "`" && raw[k] === "$" && raw[k + 1] === "{") { k = skipCode(k + 2, "}") - 1; }
      k++;
    }
    return k + 1;
  };
  // Read CODE from i until the closing char `close` at depth 0 (or end of text); returns the index
  // after the closer. Markup met in code is read as markup.
  // A `/` in code begins a REGEX literal (not a division) when what precedes it cannot end an
  // operand: the start of the code, an operator / punctuator other than `)` `]`, or a keyword that
  // takes an expression (`return`, `typeof`, …). Round 3 (review NEW-1): without this, `/"/g` read
  // its `"` as a string opener and swallowed the markup after it, and `/<i onclick="z">/g` was read
  // as an element.
  const REGEX_AFTER_WORDS: ReadonlySet<string> = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else",
    "yield", "await", "is", "not", "and", "or",
  ]);
  // Keywords after which `<` + letter is markup (they read as operands for the `/` rule).
  const MARKUP_AFTER_WORDS: ReadonlySet<string> = new Set(["lift", "return", "yield", "await", "else", "do"]);
  const skipRegex = (i: number): number => {
    let k = i + 1;
    let inClass = false;
    while (k < n && raw[k] !== "\n") {
      const c = raw[k];
      if (c === "\\") { k += 2; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) { k++; break; }
      k++;
    }
    while (k < n && /[a-z]/i.test(raw[k])) k++; // flags
    return k;
  };
  function skipCode(i: number, close: string | null): number {
    let k = i;
    let depth = 0;
    // What the last significant token was: "operand" (an identifier, number, `)`, `]`, a literal) —
    // after which `/` divides — or "operator" (anything else, and the start) — after which `/`
    // opens a regex.
    let prev: "operand" | "operator" = "operator";
    // `<` + letter is markup after an operator or a markup-introducing keyword (`lift`, `return`, …,
    // which read as operands for the `/` rule); after any other operand it is AMBIGUOUS and decided
    // by `asMarkup` (the caller unions the readings — see `markupTextSinks`).
    let afterMarkupWord = false;
    while (k < n) {
      const c = raw[k];
      if (/\s/.test(c)) { k++; continue; }
      if (c === '"' || c === "'" || c === "`") { k = skipString(k, c); prev = "operand"; continue; }
      if (c === "/" && raw[k + 1] === "/") { while (k < n && raw[k] !== "\n") k++; continue; }
      if (c === "/" && raw[k + 1] === "*") { const e = raw.indexOf("*/", k + 2); k = e < 0 ? n : e + 2; continue; }
      if (c === "/" && prev === "operator") { k = skipRegex(k); prev = "operand"; continue; }
      if (c === "<" && isLetter(raw[k + 1])) {
        let markup = prev === "operator" || afterMarkupWord;
        if (!markup) { ambig.add(k); markup = asMarkup(k); }
        if (markup) { k = readElement(k); prev = "operand"; afterMarkupWord = false; continue; }
      }
      if (/[A-Za-z0-9_$@]/.test(c)) {
        const at = k;
        while (k < n && /[A-Za-z0-9_$@.]/.test(raw[k])) k++;
        const word = raw.slice(at, k);
        prev = REGEX_AFTER_WORDS.has(word) ? "operator" : "operand";
        afterMarkupWord = MARKUP_AFTER_WORDS.has(word);
        continue;
      }
      if (c === "{" || c === "(" || c === "[") { depth++; k++; prev = "operator"; afterMarkupWord = false; continue; }
      if ((c === "}" || c === ")" || c === "]")) {
        if (depth === 0 && close !== null && c === close) return k + 1;
        depth--; k++;
        prev = c === "}" ? "operator" : "operand";
        afterMarkupWord = false;
        continue;
      }
      // Round 5 (review F1b): a POSTFIX `++` / `--` / `!` (non-null) after an operand leaves an operand
      // — `x.n++ / 2` divides, it does not open a regex.
      if (prev === "operand" && (c === "+" || c === "-") && raw[k + 1] === c) { k += 2; afterMarkupWord = false; continue; }
      if (prev === "operand" && c === "!" && raw[k + 1] !== "=") { k++; afterMarkupWord = false; continue; }
      prev = "operator";
      afterMarkupWord = false;
      k++;
    }
    return n;
  }
  // Read one element starting at its `<`; returns the index after its closer (or after `/>`).
  function readElement(i: number, parentTag: string | null = null): number {
    let k = i + 1;
    const tagStart = k;
    while (k < n && isNameCh(raw[k])) k++;
    const tag = raw.slice(tagStart, k);
    const attrs: Array<{ name: string; value: { kind: string; value?: string }; offset: number; quoted: boolean }> = [];
    let selfClosed = false;
    // The opener.
    while (k < n) {
      const c = raw[k];
      if (c === ">") { k++; break; }
      if (c === "/" && raw[k + 1] === ">") { k += 2; selfClosed = true; break; }
      if (isNameCh(c) && c !== "$") {
        const at = k;
        while (k < n && isNameCh(raw[k])) k++;
        const name = raw.slice(at, k);
        let p = k;
        while (p < n && /\s/.test(raw[p])) p++;
        if (raw[p] !== "=") { attrs.push({ name, value: { kind: "absent" }, offset: at, quoted: false }); continue; }
        p++;
        while (p < n && /\s/.test(raw[p])) p++;
        const q = raw[p];
        if (q === '"' || q === "'" || q === "`") {
          // Any quote character delimits a literal value here (fail closed: a backtick-quoted value
          // is judged as a quoted string).
          let e = p + 1;
          while (e < n && raw[e] !== q) {
            if (raw[e] === "$" && raw[e + 1] === "{") { e = skipCode(e + 2, "}"); continue; }
            e++;
          }
          attrs.push({ name, value: { kind: "string-literal", value: raw.slice(p + 1, e) }, offset: at, quoted: true });
          k = e + 1;
        } else if (q === "{" || (q === "$" && raw[p + 1] === "{")) {
          k = skipCode(q === "$" ? p + 2 : p + 1, "}");
          attrs.push({ name, value: { kind: "expr" }, offset: at, quoted: false });
        } else {
          let e = p;
          let depth = 0;
          while (e < n) {
            const ch = raw[e];
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") depth--;
            else if (depth <= 0 && (/\s/.test(ch) || ch === ">" || (ch === "/" && raw[e + 1] === ">"))) break;
            e++;
          }
          attrs.push({ name, value: { kind: "expr" }, offset: at, quoted: false });
          k = e;
        }
        continue;
      }
      if (c === "{" || (c === "$" && raw[k + 1] === "{")) { k = skipCode(c === "$" ? k + 2 : k + 1, "}"); continue; }
      k++;
    }
    // Judge the opener's quoted attributes with the element's tag and attribute list.
    for (const a of attrs) {
      if (!a.quoted || typeof a.value.value !== "string") continue;
      const v = a.value.value;
      if (isQuotedStaticHandler(a.name, v)) {
        hits.push({ code: ATTR_QUOTED_HANDLER_CODE, name: a.name, tag, offset: a.offset,
          message: quotedHandlerMessage(a.name, tag, "in markup held by an expression") });
        continue;
      }
      const st = classifyStaticExecutableAttr(a.name, v, { tag, attrs, parentTag });
      if (st) {
        hits.push({ code: ATTR_STATIC_EXECUTABLE_CODE, name: a.name, tag, offset: a.offset,
          message: staticExecutableMessage(st, a.name, tag, "in markup held by an expression") });
        continue;
      }
      const it = classifyInterpolatedAttrSink(a.name, v, { tag, attrs });
      if (it) {
        hits.push({ code: ATTR_INTERP_EXECUTABLE_CODE, name: a.name, tag, offset: a.offset,
          message: interpolatedAttrSinkMessage(it, a.name, tag, "in markup held by an expression") });
      }
    }
    if (selfClosed || VOID_TAGS.has(tag.toLowerCase())) return k;
    // TEXT, up to the matching closer.
    let depth = 1;
    while (k < n && depth > 0) {
      const c = raw[k];
      if (c === "<" && raw[k + 1] === "/") {
        const e = raw.indexOf(">", k);
        k = e < 0 ? n : e + 1;
        depth--;
        continue;
      }
      if (c === "<" && isLetter(raw[k + 1])) { k = readElement(k, tag); continue; }
      if (c === "{" || (c === "$" && raw[k + 1] === "{")) { k = skipCode(c === "$" ? k + 2 : k + 1, "}"); continue; }
      k++;
    }
    return k;
  }
  skipCode(0, null);
  return hits;
}

/**
 * S464 — every executable-sink attribute (a quoted handler, a static executable value, an interpolated
 * sink) written in markup that an escape-hatch expression holds,
 * anywhere under `root` (fail closed: judged whether or not codegen lowers that markup today —
 * a snippet lambda's markup is dropped by impl#1 at present). Reported at the nearest enclosing
 * node with a real source span (an escape hatch has no source position of its own).
 */
function collectEscapeHatchQuotedHandlerErrors(root: unknown, filePath: string, source?: string): AttrInterpError[] {
  // An escape hatch can be reached through several fields (a component call's prop is copied into
  // the expansion); keep, per escape hatch, the TIGHTEST real-source span seen above it.
  const best = new Map<object, Span | null>();
  const seen = new Set<object>();
  const stack: Array<[unknown, Span | null]> = [[root, null]];
  const width = (s: Span | null) => (s ? (s.end ?? 0) - (s.start ?? 0) : Infinity);
  while (stack.length > 0) {
    const [n, anchor0] = stack.pop()!;
    if (!n || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      if (seen.has(n)) continue;
      seen.add(n);
      for (const c of n) stack.push([c, anchor0]);
      continue;
    }
    const rec = n as Record<string, unknown>;
    let anchor = anchor0;
    const sp = rec.span as Span | undefined;
    if (sp && typeof sp.start === "number" && typeof sp.end === "number" && sp.end > sp.start &&
        !spanFileIsSynthesized(sp.file)) anchor = sp;
    if (rec.kind === "escape-hatch" && typeof rec.raw === "string" && rec.raw.includes("<")) {
      const prev = best.get(n as object);
      if (prev === undefined || width(anchor) < width(prev)) best.set(n as object, anchor);
      continue;
    }
    if (seen.has(n as object)) continue;
    seen.add(n as object);
    for (const k of Object.keys(rec)) {
      if (k === "span" || k === "parent") continue;
      const v = rec[k];
      if (v && typeof v === "object") stack.push([v, anchor]);
    }
  }
  const errors: AttrInterpError[] = [];
  const reported = new Set<string>();
  for (const [eh, anchor] of best) {
    for (const h of markupTextSinks(String((eh as { raw?: unknown }).raw ?? ""))) {
      let at: Span = anchor ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      // A component call's prop attribute reaches here as an expansion COPY whose offsets are the
      // source file's but whose line / col are not (they read 1:1); re-derive them from the offset.
      if (typeof source === "string" && (at.file === undefined || at.file === filePath) && at.start > 0) {
        const before = source.slice(0, at.start);
        const nl = before.lastIndexOf("\n");
        at = { ...at, line: before.split("\n").length, col: at.start - nl };
      }
      const key = `${at.file ?? filePath}:${at.start}:${at.end}:${h.offset}:${h.name}:${h.code}`;
      if (reported.has(key)) continue;
      reported.add(key);
      errors.push({
        code: h.code,
        message: h.message,
        span: at,
        severity: "error",
      });
    }
  }
  return errors;
}

function validateExecutableSinks(
  ast: FileAST,
  filePath: string,
  errors: AttrInterpError[],
  source?: string,
): void {
  errors.push(...collectExecutableSinkErrors(ast.nodes, filePath));
  errors.push(...collectEscapeHatchQuotedHandlerErrors(ast.nodes, filePath, source));
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function runAttributeInterpolationFile(file: {
  filePath: string;
  ast: FileAST | null | undefined;
  _sourceText?: string;
}): AttrInterpError[] {
  const errors: AttrInterpError[] = [];
  const ast = file.ast;
  if (!ast) return errors;

  walkFileAst(ast, (node) => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string };
    if (n.kind !== "markup") return;
    validateMarkup(node as MarkupNode, file.filePath, errors);
  });
  validateExecutableSinks(ast, file.filePath, errors, file._sourceText);

  return errors;
}

/**
 * §5.2 executable-sink rule over the POST-META AST (S456 review F2). `^{ emit("<button
 * onclick=\"…${@x}…\">") }` splices markup in at ME, after VP-3 ran; this re-runs the same
 * check over the AST codegen will consume. An attribute VP-3 already refused is reported once
 * (api.js dedupe on `attrSinkKey` + span).
 */
export function runExecutableSinkCheck(input: {
  files: Array<{ filePath: string; ast: FileAST | null | undefined }>;
}): { errors: AttrInterpError[] } {
  const all: AttrInterpError[] = [];
  for (const f of input.files) {
    if (!f || !f.ast) continue;
    all.push(...collectExecutableSinkErrors(f.ast.nodes, f.filePath));
  }
  return { errors: all };
}

export function runAttributeInterpolation(input: {
  files: Array<{ filePath: string; ast: FileAST | null | undefined; _sourceText?: string }>;
}): { errors: AttrInterpError[] } {
  const all: AttrInterpError[] = [];
  for (const f of input.files) {
    all.push(...runAttributeInterpolationFile(f));
  }
  return { errors: all };
}
