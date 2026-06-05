// =============================================================================
// attrvalue-exprnode-walker.ts — native attr-value `exprNode` population
//
// THE GAP this closes
//   The native parser (compiler/native-parser/tag-frame.js) builds markup
//   attribute values as `{kind:"expr"|"variable-ref", raw, refs, sourceText,
//   span}` but NEVER sets `exprNode`. The LIVE pipeline (ast-builder.js
//   parseAttributes @1834/1857/1878/2217) sets
//     `exprNode: safeParseExprToNodeGlobal(raw, filePath, valSpan.start, errors)`
//   on every `expr` / `variable-ref` attr value. Codegen `emit-html.ts` reads
//   `val.exprNode` for event handlers (1735), `if=`/`show=` (1718/1756), body
//   (1015), and the field flows on to emit-event-wiring / emit-control-flow /
//   emit-match / emit-bindings / emit-form-for / emit-table-for /
//   emit-variant-guard. Absent on native -> codegen string-fallback -> e.g. an
//   `onclick=@x.advance(.Drop("done"))` handler emits raw `@x.advance(...)` (the
//   `.advance` lowering never fires) -> E-CODEGEN-INVALID-JS ("Unexpected
//   character '@'"). Cross-cutting (~162 corpus files).
//
// WHY HERE (placement, not in tag-frame.js)
//   `safeParseExprToNodeGlobal` is the LIVE acorn-backed expression parser
//   (ast-builder.js -> expression-parser.ts `parseExprToNode`). The native
//   parser (compiler/native-parser/*) imports ONLY from native-parser
//   primitives — pulling the live parser INTO it would invert the self-host
//   layering (native is a `.js` bootstrap mirror of `.scrml`; it must not depend
//   on compiler/src/ live pipeline). So this population runs on the compiler/src/
//   side, in the SAME native->live bridge home as engine-statechild-walker.ts,
//   over the assembled native FileAST. api.js invokes it on the native path
//   right after `nativeParseFile` returns (the live path already populates
//   exprNode inline, so this is native-ONLY — the default is untouched).
//
// SHAPE CONTRACT — byte-parity with live
//   Native carries the SAME `(raw, span.start)` pairing live does at every attr-
//   value site (verified against tokenizer.ts: for `${...}` both put span.start
//   at `$` with raw = inner text; for `(...)`/`[...]`/`!...` both keep the
//   wrapper in raw with span.start at the wrapper char; for bare-form handlers
//   both trim trailing ws; for variable-ref both put span.start at the ident).
//   So `safeParseExprToNodeGlobal(val.raw, filePath, val.span.start, errors)`
//   here produces the IDENTICAL ExprNode live produces — same offset -> same
//   internal spans -> within-node parity.
//
// SCOPE (mirror live exactly)
//   exprNode SET on: kind "expr" (raw = expr text) + kind "variable-ref"
//     (name = ident; raw passed = name). Matches ast-builder.js
//     1834/2217 (variable-ref) + 1857/1878 (expr).
//   argExprNodes SET on: kind "call-ref" — the parsed ExprNode for EACH arg
//     string. Matches ast-builder.js 1831-1832: live maps every arg through
//     safeParseExprToNodeGlobal(arg, filePath, valSpan.start, errors), then sets
//     `argExprNodes` ONLY when every arg parsed (filter(Boolean).length ===
//     argList.length), else `undefined`. The handler family that hits this is the
//     dominant R26 cross-cutter — `onclick=@x.advance(.Drop("done"))` parses as a
//     call-ref (name `@x.advance`, args `[".Drop(\"done\")"]`) on BOTH pipelines;
//     codegen lowers `.Drop(...)` from `argExprNodes` and strips/lowers the `@x`
//     callee from `name`. Absent argExprNodes -> raw `@` -> E-CODEGEN-INVALID-JS.
//   NEITHER field set on: string-literal, props-block, absent, dotted-ident,
//     wildcard (the last two are native-specific value kinds with no live
//     equivalent). Live sets neither field on these.
//   Idempotent: an attr value that already has the relevant field is left
//     untouched (so a re-walk, or a value the bridge already populated, is a
//     no-op).
// =============================================================================

import { safeParseExprToNodeGlobal } from "../ast-builder.js";

// The two attr-value kinds that carry an expression and therefore an exprNode,
// mirroring the live `parseAttributes` per-kind branches.
const EXPRNODE_VALUE_KINDS = new Set(["expr", "variable-ref"]);

// readExprText — return the raw expression text the live parser was handed for
// a given attr value, or null when the value is not an expression-bearing kind.
//   - "expr"          -> `val.raw`   (already the unwrapped/wrapper-kept expr
//                                      text the tokenizer captured)
//   - "variable-ref"  -> `val.name`  (live passes the bare ident as `raw`)
function readExprText(val: any): string | null {
  if (val === null || val === undefined || typeof val !== "object") return null;
  if (val.kind === "expr") {
    return typeof val.raw === "string" ? val.raw : null;
  }
  if (val.kind === "variable-ref") {
    return typeof val.name === "string" ? val.name : null;
  }
  return null;
}

// valStartOffset — the value's source start offset (== live's `valSpan.start`),
// or 0 when the value carries no span. Live passes this SAME offset for every
// parse at a given attr-value site (it does not compute a per-arg offset), so
// reusing it here is byte-parity.
function valStartOffset(val: any): number {
  if (val !== null && val !== undefined && typeof val === "object"
      && val.span !== null && val.span !== undefined && typeof val.span === "object") {
    return val.span.start ?? 0;
  }
  return 0;
}

// populateAttrValueExprNode — stamp the live parsed-expression field(s) on ONE
// attr value when it is an expression-bearing kind that lacks them. Mutates the
// value in place (the value objects are freshly assembled by the native synth*
// builders; the engine walker reads `sourceText` off the SAME shared value
// objects, but exprNode / argExprNodes are purely additive and never read by
// that walker, so an in-place add is safe).
function populateAttrValueExprNode(val: any, filePath: string, errors: any[]): void {
  if (val === null || val === undefined || typeof val !== "object") return;

  // (1) call-ref -> argExprNodes (ast-builder.js 1831-1832). The handler family
  //     `onclick=@x.method(.A("b"))` parses as call-ref on both pipelines.
  if (val.kind === "call-ref") {
    // Idempotent — leave an already-populated argExprNodes untouched.
    if (Object.prototype.hasOwnProperty.call(val, "argExprNodes")) return;
    const argList = Array.isArray(val.args) ? val.args : [];
    const offset = valStartOffset(val);
    const parsed = argList
      .map((a: any) => safeParseExprToNodeGlobal(a, filePath, offset, errors))
      .filter(Boolean);
    // Live sets argExprNodes ONLY when every arg parsed (no drops); else undefined.
    val.argExprNodes = parsed.length === argList.length ? parsed : undefined;
    return;
  }

  // (2) expr / variable-ref -> exprNode (ast-builder.js 1834/1857/1878/2217).
  if (EXPRNODE_VALUE_KINDS.has(val.kind) === false) return;
  // Idempotent — never re-parse a value that already carries an exprNode.
  if (Object.prototype.hasOwnProperty.call(val, "exprNode")) return;
  const text = readExprText(val);
  if (text === null) return;
  // Live parity: ast-builder.js calls safeParseExprToNodeGlobal(raw, filePath,
  // valSpan.start, errors). `errors` lets the parser surface E-SQL-008 /
  // E-RESET-NO-ARG the SAME way live does at the attr-value site.
  val.exprNode = safeParseExprToNodeGlobal(text, filePath, valStartOffset(val), errors);
}

// populateNativeAttrValueExprNodes — walk an assembled native FileAST and stamp
// `exprNode` on every expression-bearing markup attr value that lacks one.
//
// The walk mirrors `normalizeNativeFileAST` (parse-file.js) discipline: an
// iterative stack walk over the FileAST node collections + every nested
// object/array, with a `seen` set guarding shared references (engine bodies
// reach the same value objects via `machineDecls[].bodyChildren`). Any node may
// carry an `attrs` array; each attr's `value` is a candidate. Descending the
// whole tree (rather than gating on a `kind` allowlist) is robust to the full
// set of markup-family node kinds AND to attr values that live inside lift /
// match / for-expr markup-as-value subtrees.
//
// `errors` (when provided) receives any E-SQL-008 / E-RESET-NO-ARG diagnostics
// the expression parser surfaces — exactly as the live path collects them into
// the TAB `errors` array.
export function populateNativeAttrValueExprNodes(
  ast: any,
  filePath: string,
  errors?: any[],
): any {
  if (ast === null || ast === undefined || typeof ast !== "object") return ast;
  const fp = typeof filePath === "string" ? filePath : "";
  const errs = Array.isArray(errors) ? errors : [];

  const roots = [
    ast.nodes,
    ast.imports,
    ast.exports,
    ast.components,
    ast.typeDecls,
    ast.machineDecls,
    ast.channelDecls,
  ];

  const stack: any[] = [];
  for (const root of roots) {
    if (Array.isArray(root)) {
      for (const item of root) stack.push(item);
    }
  }

  const seen = new Set<any>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || cur === undefined || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      for (const item of cur) {
        if (item !== null && typeof item === "object") stack.push(item);
      }
      continue;
    }

    // An object node — if it carries an `attrs` array, stamp exprNode on each
    // expression-bearing attr value.
    const attrs = cur.attrs;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        if (attr !== null && attr !== undefined && typeof attr === "object") {
          populateAttrValueExprNode(attr.value, fp, errs);
        }
      }
    }

    // Descend every object/array field so nested children / body / lift-expr
    // markup subtrees are reached. The raw native-block escape hatches are NOT
    // descended (their PascalCase-`kind` blocks are the engine walker's source;
    // their attr values are reached via the translated FileAST nodes instead,
    // and a double-stamp would be a no-op anyway via the idempotence guard, but
    // pruning them keeps the walk aligned with normalizeNativeFileAST).
    for (const k of Object.keys(cur)) {
      if (k === "_nativeEngineBlock" || k === "_source") continue;
      const v = cur[k];
      if (v !== null && typeof v === "object") stack.push(v);
    }
  }

  return ast;
}
