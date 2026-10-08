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
