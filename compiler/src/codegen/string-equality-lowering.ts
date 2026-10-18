// string-equality-lowering.ts
// ---------------------------------------------------------------------------
// §45 structural `==` / `!=` for the STRING rewrite pipeline (client Pass 18).
//
// SPEC §45.1: "`==` is scrml's sole equality operator. It performs structural
// value comparison." §45.4: primitives -> `===`; structs -> a deep structural
// comparison call; enums -> tag + payload comparison; `!=` -> the negation.
//
// The structured emitter (emit-expr.ts `emitBinary`) already lowers `==` to
// `_scrml_structural_eq(l, r)` unless BOTH operands are statically primitive.
// The string pipeline (rewrite.ts `clientPasses`) is the fallback every raw-text
// site takes — inline event handlers whose body is an assignment / postfix /
// lambda, `fn() {}` handler shorthand, `<each>` row handlers, variant-guard arms,
// match-arm block bodies, engine rule text, when-handler bodies, escape hatches.
// Its last pass used to regex-replace every `==` with `===`: reference equality,
// so two equal structs / maps / payload enums compared FALSE (gap
// g-structural-eq-emitted-as-strict-eq-outside-typed-fn-bodies-s464).
//
// This module lowers the operator by PARSING the (by Pass 18 already JS-shaped)
// text with acorn and rewriting each `==` / `!=` BinaryExpression node in place —
// the same decision `emitBinary` makes, read off the tree, never off the text
// (Rule 7: the string pipeline holds no ExprNode, so acorn's tree is the only
// tree available here; the parse is the justification for living in rewrite.ts).
//
// Text that does not parse as a JS expression, a statement list, or a function
// body is left to the legacy `===` regex — `lowerEqualityLegacy` — so no input
// that compiled before stops compiling. The corpus count of that fallback is
// measured in docs/changes/s468-structural-eq-everywhere/progress.md.
// ---------------------------------------------------------------------------

// @ts-ignore — acorn ships its own types
import {
  parse as acornParse,
  parseExpressionAt as acornParseExpressionAt,
  tokenizer as acornTokenizer,
  tokTypes,
} from "acorn";

type AnyNode = { type: string; start: number; end: number; [k: string]: any };

const ACORN_OPTS = {
  ecmaVersion: "latest" as const,
  sourceType: "module" as const,
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowImportExportEverywhere: true,
};

/** Properties whose read is a primitive whatever the receiver (mirrors emit-expr `isStaticallyPrimitive`). */
const PRIMITIVE_MEMBER_PROPS = new Set(["length", "size", "byteLength", "name"]);

/**
 * TRUE when an ESTree expression MUST evaluate to a JS primitive. The ESTree
 * twin of emit-expr.ts `isStaticallyPrimitive` — the same conservative rule, so
 * the string path and the structured path make the same `===` vs structural
 * decision for the same operands. Unsure -> false -> the structural helper
 * (which is also correct for primitives).
 */
export function isStaticallyPrimitiveEstree(node: AnyNode | null | undefined): boolean {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      // A regex literal is an object; every other literal is a primitive.
      return !node.regex;
    case "TemplateLiteral":
      return true;
    case "UnaryExpression":
      // `!x` `-x` `+x` `~x` `typeof x` `void x` `delete x` — all primitive.
      return true;
    case "UpdateExpression":
      return true;
    case "BinaryExpression":
      // Every JS binary operator (arithmetic, comparison, equality, bitwise,
      // `in`, `instanceof`) produces a primitive.
      return true;
    case "LogicalExpression":
      return isStaticallyPrimitiveEstree(node.left) && isStaticallyPrimitiveEstree(node.right);
    case "ConditionalExpression":
      return isStaticallyPrimitiveEstree(node.consequent) && isStaticallyPrimitiveEstree(node.alternate);
    case "MemberExpression":
      return !node.computed && node.property?.type === "Identifier" && PRIMITIVE_MEMBER_PROPS.has(node.property.name);
    case "CallExpression": {
      // The equality helper itself returns a boolean (a nested `==` already lowered).
      const c = node.callee;
      return !!c && c.type === "Identifier" && c.name === "_scrml_structural_eq";
    }
    default:
      return false;
  }
}

/** The pre-S468 behaviour: `==` -> `===`, `!=` -> `!==`, string-literal aware. Fallback only. */
export function lowerEqualityLegacy(expr: string): string {
  const result: string[] = [];
  let inString: string | null = null;
  let i = 0;
  let segStart = 0;
  const seg = (s: string) => s.replace(/([^!=])={2}(?!=)/g, "$1===").replace(/!={1}(?!=)/g, "!==");
  while (i < expr.length) {
    const ch = expr[i];
    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === "`") {
        result.push(seg(expr.slice(segStart, i)));
        inString = ch;
        segStart = i;
      }
    } else if (ch === "\\") {
      i++;
    } else if (ch === inString) {
      inString = null;
      i++;
      result.push(expr.slice(segStart, i));
      segStart = i;
      continue;
    }
    i++;
  }
  result.push(seg(expr.slice(segStart)));
  return result.join("");
}

/**
 * Parse `text` as a single expression (whole text consumed), else as a module
 * body (statements, top-level return/await allowed). Returns the root and the
 * offset that maps root positions back into `text`, or null.
 */
function parseWhole(text: string): { root: AnyNode; offset: number; src: string } | null {
  try {
    const node = acornParseExpressionAt(text, 0, ACORN_OPTS) as unknown as AnyNode;
    if (text.slice(node.end).trim() === "") return { root: node, offset: 0, src: text };
  } catch { /* not a lone expression — try a statement list */ }
  try {
    return { root: acornParse(text, ACORN_OPTS) as unknown as AnyNode, offset: 0, src: text };
  } catch { /* not a statement list */ }
  // A bare object-literal-shaped / block-shaped fragment that neither reading
  // accepts. Nothing further is attempted: the caller falls back.
  return null;
}

/** Collect every `==` / `!=` BinaryExpression in the tree. */
function collectEqNodes(root: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  const visit = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (typeof n.type !== "string") return;
    if (n.type === "BinaryExpression" && (n.operator === "==" || n.operator === "!=")) out.push(n);
    for (const key of Object.keys(n)) {
      if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
      const v = n[key];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(root);
  return out;
}

/** Fallback counter (read by tests / measurement). */
let _legacyFallbacks = 0;
export function equalityLegacyFallbackCount(): number { return _legacyFallbacks; }

/**
 * Lower every scrml `==` / `!=` in `expr` per §45.4. Both operands statically
 * primitive -> `l === r` / `l !== r`; otherwise `_scrml_structural_eq(l, r)`
 * / `!_scrml_structural_eq(l, r)`. Text outside the operator nodes is copied
 * byte-for-byte. Text that does not parse: `onUnparsed: "legacy"` (default, the
 * string pipeline's pre-S468 behaviour) -> the `===` regex; `"keep"` -> unchanged
 * (the `<each>` per-item text path, which never ran an equality pass).
 * `SCRML_EQ_FALLBACK_LOG=1` logs each unparsed input to stderr (measurement aid).
 */
export function lowerEqualityOps(expr: string, opts: { onUnparsed?: "legacy" | "keep" } = {}): string {
  if (!expr || typeof expr !== "string") return expr;
  // Cheap pre-filter, not the decision: no `==` / `!=` that is not part of
  // `===` / `!==` / `<=` / `>=` means nothing to lower (and nothing to parse).
  if (!/(?:^|[^=!<>])[=!]=(?!=)/.test(expr)) return expr;
  const parsed = parseWhole(expr);
  if (parsed === null) {
    _legacyFallbacks++;
    if (process.env.SCRML_EQ_FALLBACK_LOG) process.stderr.write(`[eq-fallback] ${JSON.stringify(expr.slice(0, 200))}\n`);
    return opts.onUnparsed === "keep" ? expr : lowerEqualityLegacy(expr);
  }
  const { root, src } = parsed;
  const eqNodes = collectEqNodes(root).sort((a, b) => a.start - b.start || b.end - a.end);
  // Already-strict text (`===` / `!==` only) parses to no scrml-equality node.
  if (eqNodes.length === 0) return expr;

  // Render the source span [from, to) with every OUTERMOST eq node inside it replaced.
  const renderSpan = (from: number, to: number): string => {
    let out = "";
    let cursor = from;
    for (const n of eqNodes) {
      if (n.start < cursor || n.end > to) continue; // outside, or nested in one already rendered
      out += src.slice(cursor, n.start) + renderEq(n);
      cursor = n.end;
    }
    return out + src.slice(cursor, to);
  };
  const renderEq = (n: AnyNode): string => {
    const { leftEnd, rightStart } = splitAtOperator(src, n);
    const left = renderSpan(n.start, leftEnd);
    const right = renderSpan(rightStart, n.end);
    const neg = n.operator === "!=";
    if (isStaticallyPrimitiveEstree(n.left) && isStaticallyPrimitiveEstree(n.right)) {
      // A node-for-node operator swap: `===` / `!==` have exactly the
      // precedence and associativity of `==` / `!=`, so the text around the
      // node parses the same. No wrapping parens — a NEW leading `(` would
      // let ASI join this text to the previous line (`f()⏎(a === b)` is a
      // call of f()'s result).
      return `${left} ${neg ? "!==" : "==="} ${right}`;
    }
    // A call (or `!` + call) binds tighter than `==` in every position `==`
    // could occupy, and starts with an identifier / `!` — neither continues
    // the previous line under ASI.
    return `${neg ? "!" : ""}_scrml_structural_eq(${left}, ${right})`;
  };
  try {
    return renderSpan(0, src.length);
  } catch {
    // splitAtOperator found no operator token where the tree put one — an
    // internal inconsistency. Same disposition as unparsed text.
    _legacyFallbacks++;
    return opts.onUnparsed === "keep" ? expr : lowerEqualityLegacy(expr);
  }
}

/**
 * Locate the operator TOKEN of an `==` / `!=` node and return where the left
 * operand's text ends and the right operand's text begins (absolute offsets).
 * The gap between the operand nodes holds only grouping parens, whitespace,
 * COMMENTS, and the operator — and a comment may itself contain `==` / `!=`
 * (`a /* is it != ? *\/ != b`), so the gap is TOKENIZED (acorn skips comments)
 * rather than searched as text. The left text ends at the last token before
 * the operator (a closing paren of the left operand, else the operand itself);
 * the right text starts at the first token after it. Comments in the gap are
 * dropped (a `//` comment kept at the end of the left text would swallow the
 * `, right)` that follows it).
 */
function splitAtOperator(src: string, n: AnyNode): { leftEnd: number; rightStart: number } {
  const gapStart: number = n.left.end;
  const gap = src.slice(gapStart, n.right.start);
  const toks: AnyNode[] = [];
  for (const t of acornTokenizer(gap, ACORN_OPTS) as Iterable<AnyNode>) toks.push(t);
  const opIdx = toks.findIndex((t) => t.type === tokTypes.equality && t.value === n.operator);
  if (opIdx < 0) throw new Error(`string-equality-lowering: no \`${n.operator}\` token between the operands`);
  return {
    leftEnd: opIdx > 0 ? gapStart + toks[opIdx - 1].end : gapStart,
    rightStart: opIdx + 1 < toks.length ? gapStart + toks[opIdx + 1].start : n.right.start,
  };
}
