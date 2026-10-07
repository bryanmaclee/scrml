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
  interpolatedAttrSinkMessage,
  ATTR_INTERP_EXECUTABLE_CODE,
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
function walkEveryMarkupNode(root: unknown, visit: (node: MarkupNode) => void): void {
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur as object)) continue;
    seen.add(cur as object);
    if (Array.isArray(cur)) {
      for (const c of cur) if (c && typeof c === "object") stack.push(c);
      continue;
    }
    const rec = cur as Record<string, unknown>;
    if (rec.kind === "markup" && typeof rec.tag === "string" && Array.isArray(rec.attrs)) {
      visit(cur as unknown as MarkupNode);
    }
    for (const key of Object.keys(rec)) {
      if (key === "span") continue;
      const v = rec[key];
      if (v && typeof v === "object") stack.push(v);
    }
  }
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
  opts: { where?: string; spanOverride?: Span; skipSpanFile?: (file: string) => boolean } = {},
): AttrInterpError[] {
  const errors: AttrInterpError[] = [];
  const reported = new Set<string>();
  walkEveryMarkupNode(root, (node) => {
    for (const attr of node.attrs ?? []) {
      if (!attr || typeof attr.name !== "string") continue;
      const v = attr.value as { kind?: string; value?: unknown } | undefined;
      if (!v || v.kind !== "string-literal" || typeof v.value !== "string") continue;
      const sink = classifyInterpolatedAttrSink(attr.name, v.value);
      if (!sink) continue;
      const own: Span = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      if (opts.skipSpanFile && typeof own.file === "string" && opts.skipSpanFile(own.file)) continue;
      // One diagnostic per source attribute (a node reached through two fields, e.g. an each
      // body's `bodyChildren` and `templateChildren`, is one attribute).
      const key = `${own.file ?? filePath}:${own.start}:${own.end}:${attr.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      errors.push({
        code: ATTR_INTERP_EXECUTABLE_CODE,
        message: interpolatedAttrSinkMessage(sink, attr.name, node.tag ?? "", opts.where ?? ""),
        span: opts.spanOverride ?? own,
        severity: "error",
      });
    }
  });
  return errors;
}

/**
 * A span whose `file` is `<path>#<Component>` belongs to a component body re-parsed by the
 * component expander, which already reported its attributes (see `collectExecutableSinkErrors`).
 */
function spanFileIsReparsedComponentBody(file: string): boolean {
  return /#[A-Za-z_$][A-Za-z0-9_$]*$/.test(file);
}

function validateExecutableSinks(
  ast: FileAST,
  filePath: string,
  errors: AttrInterpError[],
): void {
  errors.push(...collectExecutableSinkErrors(ast.nodes, filePath, { skipSpanFile: spanFileIsReparsedComponentBody }));
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

export function runAttributeInterpolation(input: {
  files: Array<{ filePath: string; ast: FileAST | null | undefined }>;
}): { errors: AttrInterpError[] } {
  const all: AttrInterpError[] = [];
  for (const f of input.files) {
    all.push(...runAttributeInterpolationFile(f));
  }
  return { errors: all };
}
