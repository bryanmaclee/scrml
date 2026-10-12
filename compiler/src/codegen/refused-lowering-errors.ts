/**
 * The run-wide sink for a codegen site that REFUSES to lower a construct.
 *
 * THE RULE (SPEC §2.2.1): "A codegen path that cannot lower a construct SHALL emit a hard
 * diagnostic […] rather than a silent stub", and (S451) a compile reporting an Error SHALL NOT
 * produce a runnable artifact. A site that declines emits a syntactically valid placeholder
 * (`null /* E-… *\/`) so the artifact still parses — the placeholder is only safe because the
 * diagnostic beside it fails the compile.
 *
 * WHY NOT `opts.errors` OR A PER-EMITTER NARROW SINK
 * ==================================================
 * Those depend on the emitter that built the current `opts` having threaded the channel. The
 * control-flow emitters (an `if` / loop / match body) build a fresh opts object field by field,
 * so a channel the function-level emitter threaded was silently dropped one block deeper:
 * measured at 0aef3270d, an unbuildable `_{}` slice (E-FOREIGN-007), a crossing-shadow
 * (E-FOREIGN-006) and a `.prepare()` (E-SQL-006) inside an `if` of a `kind="tool"` main all
 * compiled exit 0 with only the placeholder in the artifact. E-SESSION-VALUE's own sink was
 * drained only by the server emitter, so the same refusal in a tool file was lost.
 * (docs/changes/s456-foreign-slice-regex-apostrophe.)
 *
 * This sink is module-level — every emission path reaches it, whatever opts it was handed — and
 * `runCG` resets it once per run and drains it beside the `~` / expression-guard sinks
 * (emit-expr.ts), which already had this shape for the same reason.
 *
 * ONE DIAGNOSTIC PER CONSTRUCT. A node can be lowered more than once in a run (a function body
 * emitted as its route handler AND as its in-process peer callable, a Pattern-C cell seeded on
 * two routes, a first attempt discarded and re-emitted). A second refusal of the same code is
 * dropped when it names the same `anchor` (the refused AST node) OR the same real source span
 * (file + start + end — a re-lowering may work on a copy of the node). A span-less refusal
 * (start = end = 0, a synthesized node) is de-duplicated by its anchor only, so two distinct
 * span-less constructs are never collapsed. A discarded attempt does not lose its refusal: the
 * construct is unlowerable whichever attempt reached it.
 */

import { CGError } from "./errors.ts";
import { refusedElementCode, refusedElementMessage, scanRawContentForRefusedTags } from "../element-refusal.ts";
import {
  isQuotedStaticHandler, quotedHandlerMessage, ATTR_QUOTED_HANDLER_CODE, attrSinkKey,
  ATTR_STATIC_EXECUTABLE_CODE, classifyStaticExecutableAttr, staticExecutableMessage,
} from "../attr-injection-sink.ts";

let _errors: CGError[] = [];
let _seenByAnchor: WeakMap<object, Set<string>> = new WeakMap();
let _seenBySpan: Set<string> = new Set();

function spanKey(err: CGError): string | null {
  const sp = err.span as { file?: unknown; start?: unknown; end?: unknown } | null;
  if (!sp || typeof sp !== "object") return null;
  const start = typeof sp.start === "number" ? sp.start : 0;
  const end = typeof sp.end === "number" ? sp.end : 0;
  if (start === 0 && end === 0) return null;
  return `${err.code}@${typeof sp.file === "string" ? sp.file : ""}:${start}:${end}`;
}

/** Record a refusal. `anchor` is the refused AST node (see ONE DIAGNOSTIC PER CONSTRUCT). */
export function recordRefusedLowering(err: CGError, anchor?: object | null): void {
  let codes: Set<string> | undefined;
  if (anchor && typeof anchor === "object") {
    codes = _seenByAnchor.get(anchor);
    if (!codes) { codes = new Set(); _seenByAnchor.set(anchor, codes); }
    if (codes.has(err.code)) return;
  }
  const key = spanKey(err);
  if (key !== null && _seenBySpan.has(key)) return;
  if (codes) codes.add(err.code);
  if (key !== null) _seenBySpan.add(key);
  _errors.push(err);
}

/** Reset for a new run (called once at the top of `runCG`). */
export function resetRefusedLowerings(): void {
  _errors = [];
  _seenByAnchor = new WeakMap();
  _seenBySpan = new Set();
}

/** Drain + clear the accumulated refusals. The de-duplication memory survives until reset. */
export function drainRefusedLowerings(): CGError[] {
  const out = _errors;
  _errors = [];
  return out;
}

/**
 * §4.17 (S462) — the codegen backstop for `<script>` / `<style>`. scrml does not admit those
 * elements at any position; the block splitter, the AST builder's structural check over every
 * element node and component expansion refuse them before codegen. Every site that turns an
 * element into output (a `createElement` call, an HTML open tag, an SSR row template) still asks
 * here first: a refused element is never emitted — the caller emits an inert placeholder — and the
 * refusal is recorded, so an element that reached codegen by a path no earlier check covered fails
 * the compile instead of running. (api.js drops this report when an earlier stage already refused
 * the same code in the same file: the compile fails either way.)
 *
 * Returns true when the tag is refused (the caller MUST NOT emit the element).
 */
export function refuseElementLowering(tag: unknown, anchor?: { span?: unknown } | null): boolean {
  const code = refusedElementCode(tag);
  if (code === null) return false;
  const span = (anchor && typeof anchor === "object" && anchor.span && typeof anchor.span === "object")
    ? anchor.span as object
    : { start: 0, end: 0, line: 1, col: 1 };
  recordRefusedLowering(
    new CGError(code, `${code}: ${refusedElementMessage(code, String(tag), "codegen backstop: this element reached emission")}`, span, "error"),
    anchor ?? null,
  );
  return true;
}

/**
 * §4.17 (S462) — the codegen backstop for a raw-content body. A `<pre>` / `<code>`
 * body is written verbatim into HTML the browser parses; a `<script` / `<style` start
 * tag anywhere in it (scanRawContentForRefusedTags — fail-closed) builds a live
 * element. Returns true (and records the refusal) when `node` is such a raw-content
 * element: the caller MUST NOT emit it.
 */
export function refuseRawContentLowering(node: { tag?: unknown; children?: unknown; span?: unknown } | null): boolean {
  if (!node || typeof node.tag !== "string" || !/^(pre|code)$/i.test(node.tag) || !Array.isArray(node.children)) return false;
  let refused = false;
  for (const c of node.children as Array<Record<string, unknown>>) {
    if (!c || c.kind !== "text") continue;
    const body = typeof c.value === "string" ? c.value : typeof c.text === "string" ? c.text : typeof c.raw === "string" ? c.raw : "";
    for (const hit of scanRawContentForRefusedTags(body)) {
      refused = true;
      const span = (c.span && typeof c.span === "object") ? c.span as object
        : (node.span && typeof node.span === "object") ? node.span as object
        : { start: 0, end: 0, line: 1, col: 1 };
      recordRefusedLowering(
        new CGError(hit.code, `${hit.code}: ${refusedElementMessage(hit.code, hit.tag, `inside <${node.tag}> raw content (codegen backstop)`)}`, span, "error"),
        c,
      );
    }
  }
  return refused;
}

/**
 * §5.2 (S464) — the codegen backstop for a QUOTED event-handler attribute with no `${…}`
 * (`onclick="pwn()"`). VP-3, the post-ME re-run and component expansion refuse it
 * (E-ATTR-QUOTED-HANDLER) for every markup node they reach; a codegen path that lowers markup
 * from a COPY (a `<match>` arm body re-parsed in codegen, with the `<each>` rows inside it) is
 * never seen by them. So every codegen site that WRITES a user attribute's quoted value into
 * output — an HTML attribute, a `setAttribute`, an SSR row template — asks here first, with the
 * one predicate (`isQuotedStaticHandler`, rule 1's name test). The emit path fails closed
 * whichever validator saw the node.
 *
 * Returns true when the attribute is refused: the caller MUST NOT write it. The refusal is
 * recorded once per attribute (`recordRefusedLowering`); api.js drops it when an earlier stage
 * already refused the same attribute in the same file. `tag` only names the element in the
 * message: at codegen the attribute IS being written onto an element, whatever its tag's case (an
 * unexpanded `<Btn onclick="…">` is still built as an element whose handler the browser runs), so
 * no tag is exempt here — fail closed.
 */
/**
 * §5.2 (S464) — the ONE codegen backstop every attribute writer asks before writing a user
 * attribute's STATIC (quoted / literal) value: a quoted event handler (E-ATTR-QUOTED-HANDLER,
 * `refuseQuotedHandlerWrite`) and, per S464 "(a) Refuse both", a static `srcdoc` or a static URL whose
 * scheme rule 2 does not admit (E-ATTR-STATIC-EXECUTABLE, `classifyStaticExecutableAttr` — the runtime
 * guard's judgment on the literal). `attrs` is the element's attribute list (an SVG animation value is
 * judged against its `attributeName`). An `<md>`-built attribute (`_md`) is §67.6's (E-MD-URL-SCHEME).
 * Returns true when refused: the caller MUST NOT write the attribute.
 */
export function refuseStaticAttrWrite(
  name: unknown,
  value: unknown,
  anchor: { span?: unknown; _md?: unknown } | null | undefined,
  tag?: unknown,
  attrs?: ReadonlyArray<unknown> | null,
): boolean {
  if (refuseQuotedHandlerWrite(name, value, anchor, tag)) return true;
  if (typeof name !== "string" || typeof value !== "string") return false;
  if (anchor && typeof anchor === "object" && anchor._md === true) return false;
  const sink = classifyStaticExecutableAttr(name, value, { tag: typeof tag === "string" ? tag : null, attrs: attrs ?? null });
  if (sink === null) return false;
  const span = (anchor && typeof anchor === "object" && anchor.span && typeof anchor.span === "object")
    ? anchor.span as { file?: unknown; start?: unknown; end?: unknown }
    : { start: 0, end: 0, line: 1, col: 1 };
  const err = new CGError(
    ATTR_STATIC_EXECUTABLE_CODE,
    staticExecutableMessage(sink, name, typeof tag === "string" ? tag : ""),
    span,
    "error",
  );
  (err as { attrSinkKey?: string }).attrSinkKey = attrSinkKey(span, name);
  (err as { attrSinkName?: string }).attrSinkName = name.toLowerCase();
  recordRefusedLowering(err, anchor && typeof anchor === "object" ? anchor as object : null);
  return true;
}

export function refuseQuotedHandlerWrite(
  name: unknown,
  value: unknown,
  anchor: { span?: unknown } | null | undefined,
  tag?: unknown,
): boolean {
  if (typeof name !== "string" || typeof value !== "string") return false;
  if (!isQuotedStaticHandler(name, value)) return false;
  const span = (anchor && typeof anchor === "object" && anchor.span && typeof anchor.span === "object")
    ? anchor.span as { file?: unknown; start?: unknown; end?: unknown }
    : { start: 0, end: 0, line: 1, col: 1 };
  const err = new CGError(
    ATTR_QUOTED_HANDLER_CODE,
    quotedHandlerMessage(name, typeof tag === "string" ? tag : ""),
    span,
    "error",
  );
  (err as { attrSinkKey?: string }).attrSinkKey = attrSinkKey(span, name);
  (err as { attrSinkName?: string }).attrSinkName = name.toLowerCase();
  recordRefusedLowering(err, anchor && typeof anchor === "object" ? anchor as object : null);
  return true;
}
