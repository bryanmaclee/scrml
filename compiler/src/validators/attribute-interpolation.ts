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
import { tokenizeLogic } from "../tokenizer.ts";
import {
  classifyInterpolatedAttrSink,
  executableDataWriteSink,
  interpolatedAttrSinkMessage,
  ATTR_INTERP_EXECUTABLE_CODE,
  ATTR_QUOTED_HANDLER_CODE,
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
  /**
   * S464 — every enclosing component's DEFINITION span, by name (`_componentDefSpan`). Text an
   * author wrote inside a definition body carries a span file `<path>#<Name>`; this finds the
   * definition to anchor at.
   */
  defSpans: Record<string, Span>;
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
    { cur: root, ctx: { anchor: null, component: null, defSpans: {} } },
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
      if (!spanFileIsSynthesized(site.file)) ctx = { anchor: site, component: parentCtx.component, defSpans: parentCtx.defSpans };
    }
    if (typeof rec._expandedFrom === "string") {
      // An expanded component root (component-expander stamps `_expansionSiteSpan` = the call
      // site). Nested expansions sit inside a re-parsed body, so the OUTERMOST real call site
      // is what the author can find; keep it once set.
      const site = rec._expansionSiteSpan as Span | undefined;
      const anchor = ctx.anchor ??
        (site && !spanFileIsSynthesized(site.file) ? site : null);
      const defSpan = rec._componentDefSpan as Span | undefined;
      const defSpans = defSpan && typeof defSpan === "object"
        ? { ...ctx.defSpans, [rec._expandedFrom as string]: defSpan }
        : ctx.defSpans;
      ctx = { anchor, component: rec._expandedFrom as string, defSpans };
    }
    if (rec.kind === "markup" && typeof rec.tag === "string" && Array.isArray(rec.attrs)) {
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
      if (v.kind === "string-literal" && typeof v.value === "string" &&
          isQuotedStaticHandler(attr.name, v.value) && dataValueReachesElementAttr(node, attr.name)) {
        // S464 — a quoted event attribute with no `${…}` (`onclick="alert(1)"`): text the browser
        // would run as raw JavaScript. A component call's prop (`<Btn onclick="…"/>`, a DECLARED
        // prop) is not an element attribute; an undeclared one that falls through onto the
        // expanded root is (`dataValueReachesElementAttr`).
        quotedHandler = true;
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
      if (!sink && !quotedHandler) continue;
      if (opts.markReported) (attr as { _execSinkReportedAtDef?: boolean })._execSinkReportedAtDef = true;
      const own: Span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      // An attribute inside an EXPANDED component instance: the value judged here is the one
      // that will be emitted (the caller's prop text substituted in). Its own span is relative
      // to the component body, so the diagnostic is anchored at the outermost call site.
      const inExpansion = spanFileIsSynthesized(own.file) && ctx.anchor !== null;
      // S464 — a quoted static handler has no caller-substituted part: its text is exactly what
      // the author wrote where `own` points. When that is a component DEFINITION body
      // (`<path>#<Name>` — e.g. `<Inner onclick="…"/>` inside `Outer`, falling through onto
      // Inner's root), it is reported once, at that definition, however many instances.
      const ownDef = quotedHandler && typeof own.file === "string"
        ? /#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(own.file) : null;
      const defAnchor = ownDef && ctx.defSpans[ownDef[1]] ? ctx.defSpans[ownDef[1]] : null;
      const span = opts.spanOverride ?? defAnchor ?? (inExpansion ? (ctx.anchor as Span) : own);
      const where = opts.where ??
        (defAnchor ? `in component \`${ownDef![1]}\``
          : !inExpansion ? ""
          : ctx.component && quotedHandler ? `in component \`${ctx.component}\` as used here`
          : ctx.component ? `in component \`${ctx.component}\` as used here (the caller's prop value is substituted into it)`
          : own.file === "__meta_emit__" ? "emitted by the `^{ emit(…) }` block here"
          : "");
      // One diagnostic per emitted attribute: a node reached through two fields (an each
      // body's `bodyChildren` and `templateChildren`) is one attribute; two instances of a
      // component are two.
      const key = defAnchor
        ? `def|${own.file}:${own.start}:${own.end}:${attr.name}`
        : `${span.file ?? filePath}:${span.start}:${span.end}|${own.file ?? filePath}:${own.start}:${own.end}:${attr.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const err: AttrInterpError = {
        code: quotedHandler ? ATTR_QUOTED_HANDLER_CODE : ATTR_INTERP_EXECUTABLE_CODE,
        message: quotedHandler
          ? quotedHandlerMessage(attr.name, node.tag ?? "", where)
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
 * The quoted static event-handler attributes written in markup inside `raw` — the text of an
 * `escape-hatch` expression (markup the expression parser could not read: a snippet lambda
 * `row={ (it) => <span onclick="…">…</span> }`, a markup value in a callback). Decided from the
 * TOKENS, as the builder's `<script>` check over escape hatches is (`refuseEscapeHatchMarkup`): an
 * element opener is a `<` PUNCT immediately followed by a name token, so `"<b onclick=…>"` inside
 * a string literal (one STRING token) is never an opener. Within an opener (up to its `>` at brace
 * depth 0), an attribute is a run of adjacent name / `:` / `-` tokens, then `=`, then a STRING.
 * The judgment is `isQuotedStaticHandler` — the one predicate.
 */
function quotedHandlersInMarkupText(raw: string): Array<{ name: string; offset: number }> {
  const hits: Array<{ name: string; offset: number }> = [];
  let toks: Array<{ kind: string; text: string; span?: { start: number; end: number } }> = [];
  try { toks = tokenizeLogic(raw, 0, 1, 1, []) as typeof toks; } catch { return hits; }
  const isName = (t: { kind: string } | undefined) => !!t && (t.kind === "IDENT" || t.kind === "KEYWORD");
  const adj = (a: { span?: { end: number } } | undefined, b: { span?: { start: number } } | undefined) =>
    !!a && !!b && !!a.span && !!b.span && a.span.end === b.span.start;
  for (let k = 0; k + 1 < toks.length; k++) {
    if (toks[k].kind !== "PUNCT" || toks[k].text !== "<" || !isName(toks[k + 1]) || !adj(toks[k], toks[k + 1])) continue;
    let j = k + 2;
    let depth = 0;
    while (j < toks.length) {
      const t = toks[j];
      if (t.kind === "EOF") break;
      if (t.kind === "PUNCT" && (t.text === "{" || t.text === "(" || t.text === "[")) { depth++; j++; continue; }
      if (t.kind === "PUNCT" && (t.text === "}" || t.text === ")" || t.text === "]")) { depth--; j++; continue; }
      if (depth === 0 && t.kind === "PUNCT" && (t.text === ">" || t.text === "<")) break;
      if (depth === 0 && isName(t)) {
        // The attribute name: a run of adjacent name / `:` / `-` tokens (`on:click`, `data-x`).
        let name = t.text;
        let m = j + 1;
        while (m < toks.length && adj(toks[m - 1], toks[m]) &&
               (isName(toks[m]) || (toks[m].kind === "PUNCT" && toks[m].text === ":") ||
                ((toks[m].kind === "PUNCT" || toks[m].kind === "OPERATOR") && toks[m].text === "-"))) {
          name += toks[m].text;
          m++;
        }
        if (m + 1 < toks.length && toks[m].text === "=" && toks[m + 1].kind === "STRING" &&
            isQuotedStaticHandler(name, toks[m + 1].text)) {
          hits.push({ name, offset: t.span ? t.span.start : 0 });
        }
        j = m;
        continue;
      }
      j++;
    }
  }
  return hits;
}

/**
 * S464 — every quoted static handler written in markup that an escape-hatch expression holds,
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
    for (const h of quotedHandlersInMarkupText(String((eh as { raw?: unknown }).raw ?? ""))) {
      let at: Span = anchor ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      // A component call's prop attribute reaches here as an expansion COPY whose offsets are the
      // source file's but whose line / col are not (they read 1:1); re-derive them from the offset.
      if (typeof source === "string" && (at.file === undefined || at.file === filePath) && at.start > 0) {
        const before = source.slice(0, at.start);
        const nl = before.lastIndexOf("\n");
        at = { ...at, line: before.split("\n").length, col: at.start - nl };
      }
      const key = `${at.file ?? filePath}:${at.start}:${at.end}:${h.offset}:${h.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      errors.push({
        code: ATTR_QUOTED_HANDLER_CODE,
        message: quotedHandlerMessage(h.name, "", "in markup held by an expression"),
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
