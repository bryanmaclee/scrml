/**
 * at-refs.ts — s464-pure-fn-placement (fix round 2).
 *
 * The single reader of `@`-references in a function's code, plus the plain-pure-`fn`
 * predicate. Shared by route inference (placement, E-REACTIVE-003) and server
 * codegen (the D-5 module-binding closure), so every decision that asks "does this
 * code read reactive state?" reads it the same way, from the parsed expression tree.
 */
import type { Span, ExprNode } from "./types/ast.ts";
import { blankLiteralTextInSource, parseExprToNode, hasLostTrailingContent } from "./expression-parser.ts";

/**
 * s464-pure-fn-placement — a plain pure function: `fn` (or the deprecated
 * `pure function`) WITHOUT the `server` pin. §12.4 gives such a function "no
 * client or server classification"; it is never a route and never async
 * (§13.4, §48.3.5). `server fn` is the explicit pin and is excluded here.
 */
export function isPlainPureFn(fnNode: unknown): boolean {
  if (!fnNode || typeof fnNode !== "object") return false;
  const n = fnNode as Record<string, unknown>;
  if (n.kind !== undefined && n.kind !== "function-decl") return false;
  if (n.isServer === true) return false;
  if (n.isGenerator === true) return false;
  if (n.isAsync === true) return false;
  if (n.isHandleEscapeHatch === true) return false;
  return n.fnKind === "fn" || n.isPure === true;
}

/**
 * s464 fix round 2 — THE reader of `@`-references (cells, derived values, channel
 * cells, `@session` / `@currentUser`) in a function's code. Both decisions that
 * need it read it HERE, from the parsed expression tree, never by regex over
 * source text: the placement decision (a plain `fn` that reaches `@`-state keeps
 * its prior path, `fnReachesAtName`) and E-REACTIVE-003
 * (`detectServerFreeClientCellReads`). Before this they were two readers of one
 * text and disagreed — a `"@n"` string default counted for one and not the other.
 *
 * What counts:
 *   - an `ident` node whose name starts with `@`;
 *   - a `?{}` query's text (`${@x}` interpolations), as before;
 *   - with `opaqueCode: true`: a template literal's `${…}` interpolations and an
 *     `escape-hatch` node's code (a block-body lambda), which the expression tree
 *     keeps as raw text — read only after `blankLiteralTextInSource(…, { blankRegex:
 *     true })` has blanked every string literal, template quasi, comment AND
 *     regular-expression body (s464 fix round 4).
 * What never counts: string / template text, regex literals, comments.
 *
 * `opaqueCode` is a COVERAGE choice, not a second parser. Both callers turn it on:
 * the placement decision (over-detection is its safe direction — the `fn` keeps its
 * prior path) and E-REACTIVE-003 (owner ruling S464 "(a) Close it", SPEC §6.6.9
 * "Every read position counts"). It stays an option so a future caller has to choose.
 */
const AT_REF_RE = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
function forEachAtRefInCode(code: string, cb: (bare: string) => void): void {
  const blanked = blankLiteralTextInSource(code, { blankRegex: true });
  const re = new RegExp(AT_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked)) !== null) {
    const prev = m.index > 0 ? blanked[m.index - 1] : "";
    if (prev && /[A-Za-z0-9_$.]/.test(prev)) continue; // `a@b` / `x.@y` are not refs
    cb(m[1]);
  }
}
export function forEachAtRef(
  root: unknown,
  cb: (bare: string, span: Span | undefined) => void,
  opts: { descendNestedFns: boolean; opaqueCode: boolean },
  inheritedSpan?: Span,
): void {
  const visited = new WeakSet<object>();
  const visit = (node: any, stmtSpan: Span | undefined): void => {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) { for (const c of node) visit(c, stmtSpan); return; }
    if (node.kind === "function-decl" && !opts.descendNestedFns) return;
    const sp: Span | undefined = (node.span && typeof node.span === "object") ? node.span : stmtSpan;
    if (node.kind === "ident" && typeof node.name === "string"
        && node.name.length > 1 && node.name.charCodeAt(0) === 0x40 /* @ */) {
      cb(node.name.slice(1), sp);
    }
    if (node.kind === "sql" && typeof node.query === "string") {
      const re = new RegExp(AT_REF_RE.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(node.query)) !== null) cb(m[1], sp);
    }
    if (opts.opaqueCode && node.kind === "lit" && node.litType === "template" && node.hasInterpolation === true && typeof node.raw === "string") {
      forEachAtRefInCode(node.raw, (b) => cb(b, sp));
    }
    if (opts.opaqueCode && node.kind === "escape-hatch" && node.nativeKind !== "Literal" && typeof node.raw === "string") {
      forEachAtRefInCode(node.raw, (b) => cb(b, sp));
    }
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const val = node[key];
      if (val && typeof val === "object") visit(val, sp);
    }
  };
  visit(root, inheritedSpan);
}

/**
 * A function's parameter defaults as PARSED expressions. The parser keeps a
 * default as raw text (`defaultValue`); it is parsed here so the `@`-reader sees
 * the same tree shape as the body.
 */
const _parsedDefaultsCache = new WeakMap<object, ExprNode[]>();
const _parsedDefaultCache = new WeakMap<object, ExprNode>();
/**
 * ONE parameter's default as a PARSED expression, or `null` when it has none.
 * The same tree the `@`-reader walks is the tree codegen lowers (s466 — a
 * server function's default is emitted from this parse, so what the
 * E-REACTIVE-003 check reads and what runs on the server cannot differ).
 */
export function parsedParamDefault(p: unknown, filePath: string): ExprNode | null {
  if (!p || typeof p !== "object") return null;
  const dv = (p as { defaultValue?: unknown }).defaultValue;
  if (typeof dv !== "string" || !dv.trim()) return null;
  const hit = _parsedDefaultCache.get(p as object);
  if (hit) return hit;
  let node: ExprNode;
  try { node = parseExprToNode(dv, filePath, 0); }
  catch { node = { kind: "escape-hatch", raw: dv } as unknown as ExprNode; }
  // The parser keeps no source offset for a default, so the parse above runs at
  // offset 0 and its spans would point into the FILE's first line. Drop them: a
  // diagnostic about a default then anchors at the function (the readers fall
  // back to the function's span), never at a wrong line.
  dropSpans(node);
  _parsedDefaultCache.set(p as object, node);
  return node;
}

/**
 * s466 fix round 1 — does this parameter's default fail to be ONE expression?
 * Returns `null` when it parses whole; otherwise the text the parse could not
 * keep (the lost tail of `"a" foo` is `foo`; an unparseable default returns its
 * whole text). The parser keeps a valid PREFIX and stamps the loss
 * (`_s441Trailing`, the body-top S441 oracle); codegen must refuse rather than
 * ship the prefix (`k = "a" foo` once shipped `("a")`).
 */
export function paramDefaultParseProblem(p: unknown, filePath: string): string | null {
  const node = parsedParamDefault(p, filePath) as unknown as Record<string, unknown> | null;
  if (!node) return null;
  if (hasLostTrailingContent(node)) {
    const t = String(node._s441TrailingText ?? "").trim();
    return t.length > 0 ? t : String((p as { defaultValue?: unknown }).defaultValue ?? "");
  }
  if (node.kind === "escape-hatch" && node.nativeKind === "ParseError") {
    return String((p as { defaultValue?: unknown }).defaultValue ?? "");
  }
  return null;
}

/** s466 fix round 1 — the source span of a parameter's default (its first token), if the parser kept one. */
export function paramDefaultSpan(p: unknown): unknown {
  if (!p || typeof p !== "object") return null;
  return (p as { defaultSpan?: unknown }).defaultSpan ?? null;
}

function dropSpans(n: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (!n || typeof n !== "object" || seen.has(n as object)) return;
  seen.add(n as object);
  if (Array.isArray(n)) { for (const c of n) dropSpans(c, seen); return; }
  delete (n as { span?: unknown }).span;
  for (const v of Object.values(n as object)) dropSpans(v, seen);
}
export function parsedParamDefaults(fnNode: unknown, filePath: string): ExprNode[] {
  if (!fnNode || typeof fnNode !== "object") return [];
  const hit = _parsedDefaultsCache.get(fnNode as object);
  if (hit) return hit;
  const out: ExprNode[] = [];
  const params = (fnNode as any).params;
  for (const p of (Array.isArray(params) ? params : [])) {
    const d = parsedParamDefault(p, filePath);
    if (d) out.push(d);
  }
  _parsedDefaultsCache.set(fnNode as object, out);
  return out;
}

/**
 * s464-pure-fn-placement — does this function reference any `@`-name in its body
 * (nested functions included) or its parameter defaults? Such a `fn` keeps its
 * prior placement path, so a server body that reaches it still meets the
 * fail-closed diagnostics (E-REACTIVE-003, E-CHANNEL-SERVER-CELL-READ,
 * E-SESSION-AMBIENT-SERVER) instead of shipping a client-cell read into the
 * server bundle.
 */
export function fnReachesAtName(fnNode: unknown, filePath: string): boolean {
  let found = false;
  const hit = (): void => { found = true; };
  forEachAtRef((fnNode as any)?.body, hit, { descendNestedFns: true, opaqueCode: true });
  if (!found) forEachAtRef(parsedParamDefaults(fnNode, filePath), hit, { descendNestedFns: true, opaqueCode: true });
  return found;
}
