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
      if (v.kind === "string-literal" && typeof v.value === "string") {
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
      if (!sink) continue;
      if (opts.markReported) (attr as { _execSinkReportedAtDef?: boolean })._execSinkReportedAtDef = true;
      const own: Span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      // An attribute inside an EXPANDED component instance: the value judged here is the one
      // that will be emitted (the caller's prop text substituted in). Its own span is relative
      // to the component body, so the diagnostic is anchored at the outermost call site.
      const inExpansion = spanFileIsSynthesized(own.file) && ctx.anchor !== null;
      const span = opts.spanOverride ?? (inExpansion ? (ctx.anchor as Span) : own);
      const where = opts.where ??
        (!inExpansion ? ""
          : ctx.component ? `in component \`${ctx.component}\` as used here (the caller's prop value is substituted into it)`
          : own.file === "__meta_emit__" ? "emitted by the `^{ emit(…) }` block here"
          : "");
      // One diagnostic per emitted attribute: a node reached through two fields (an each
      // body's `bodyChildren` and `templateChildren`) is one attribute; two instances of a
      // component are two.
      const key = `${span.file ?? filePath}:${span.start}:${span.end}|${own.file ?? filePath}:${own.start}:${own.end}:${attr.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const err: AttrInterpError = {
        code: ATTR_INTERP_EXECUTABLE_CODE,
        message: interpolatedAttrSinkMessage(sink, attr.name, node.tag ?? "", where, form),
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


function validateExecutableSinks(
  ast: FileAST,
  filePath: string,
  errors: AttrInterpError[],
): void {
  errors.push(...collectExecutableSinkErrors(ast.nodes, filePath));
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function runAttributeInterpolationFile(file: {
  filePath: string;
  ast: FileAST | null | undefined;
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
  validateExecutableSinks(ast, file.filePath, errors);

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
  files: Array<{ filePath: string; ast: FileAST | null | undefined }>;
}): { errors: AttrInterpError[] } {
  const all: AttrInterpError[] = [];
  for (const f of input.files) {
    all.push(...runAttributeInterpolationFile(f));
  }
  return { errors: all };
}
