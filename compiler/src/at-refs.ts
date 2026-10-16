/**
 * at-refs.ts — s464-pure-fn-placement (fix round 2).
 *
 * The single reader of `@`-references in a function's code, plus the plain-pure-`fn`
 * predicate. Shared by route inference (placement, E-REACTIVE-003) and server
 * codegen (the D-5 module-binding closure), so every decision that asks "does this
 * code read reactive state?" reads it the same way, from the parsed expression tree.
 */
import type { Span, ExprNode } from "./types/ast.ts";
import { blankLiteralTextInSource, parseExprToNode, hasLostTrailingContent, tokenizeTemplateInterpolations } from "./expression-parser.ts";
import { parseExpressionAt as acornParseExpressionAt } from "acorn";

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
/**
 * A function's parameter defaults as the trees every CHECK reads (the `@`-read
 * checks, placement, the call graph): the ANALYSED form (`analyzedParamDefault`),
 * so a `match` arm or a template interpolation is seen like any other code. A
 * default the analysis refuses contributes its plain parse (the refusal fails the
 * build where the default is lowered).
 */
export function parsedParamDefaults(fnNode: unknown, filePath: string): ExprNode[] {
  if (!fnNode || typeof fnNode !== "object") return [];
  const hit = _parsedDefaultsCache.get(fnNode as object);
  if (hit) return hit;
  const out: ExprNode[] = [];
  const params = (fnNode as any).params;
  for (const p of (Array.isArray(params) ? params : [])) {
    const a = analyzedParamDefault(p, filePath);
    if (a && "tree" in a) out.push(a.tree);
    else {
      const d = parsedParamDefault(p, filePath);
      if (d) out.push(d);
    }
  }
  _parsedDefaultsCache.set(fnNode as object, out);
  return out;
}

// ---------------------------------------------------------------------------
// s466 fix round 3 — the ANALYSED default: a CLOSED set of expression kinds.
// ---------------------------------------------------------------------------

/**
 * The expression kinds a parameter default may contain, each understood fully
 * by every default check (the identity read, the `@`-read, the await check). The
 * set is CLOSED: a kind not listed here, or a node that still holds source text
 * the parser did not structure, makes the default UNSUPPORTED — refused, never
 * passed through unchecked. (Three review rounds found a raw-text node — an
 * escape-hatch, then the match arms — that every check walked past.)
 *
 *   ident · lit (a template's `${…}` slots are parsed into expressions) · array ·
 *   object (prop / shorthand / spread) · spread · unary (not `++` / `--` / `delete`) · binary ·
 *   ternary · member · index · call · new · cast · reset-expr · map-lit ·
 *   input-state-ref · sql-ref (a leaf — the await check refuses it by name) ·
 *   lambda with an EXPRESSION body · match-expr with one subject, whose arms are
 *   parsed (each arm becomes an expression-bodied lambda binding its pattern
 *   names).
 *
 * Not in the set (refused): an escape-hatch (a block-bodied function, text the
 * parser could not structure), a lambda with a block body, a markup value, a
 * multi-subject or `given`-led match, a block-bodied or unparseable match arm.
 */
export const DEFAULT_EXPR_KINDS: ReadonlySet<string> = new Set([
  "ident", "lit", "array", "object", "spread", "unary", "binary", "ternary",
  "member", "index", "call", "new", "cast", "reset-expr", "map-lit", "input-state-ref",
  "sql-ref", "lambda", "match-expr",
]);

class UnsupportedDefault extends Error {
  constructor(readonly what: string) { super(what); }
}

function parseFragment(text: string, filePath: string): ExprNode {
  let node: ExprNode;
  try { node = parseExprToNode(text, filePath, 0); }
  catch { throw new UnsupportedDefault(`\`${text.trim().slice(0, 40)}\`, which does not parse`); }
  if (hasLostTrailingContent(node)) throw new UnsupportedDefault(`\`${text.trim().slice(0, 40)}\`, which is not one expression`);
  return node;
}

/** The names a match arm's pattern binds (`.Some(x)`, `.Rect(w, h)`, `.P(radius: r)`). */
function armBindingNames(binding: string | null): string[] {
  if (!binding) return [];
  const out: string[] = [];
  for (const part of binding.split(",")) {
    const t = part.includes(":") ? part.slice(part.indexOf(":") + 1) : part;
    const m = t.trim().match(/^[A-Za-z_$][\w$]*$/);
    if (m && m[0] !== "_") out.push(m[0]);
  }
  return out;
}

function normalizeDefault(node: unknown, filePath: string): ExprNode {
  if (!node || typeof node !== "object") throw new UnsupportedDefault("an empty expression");
  const n = node as Record<string, unknown>;
  const kind = String(n.kind);
  if (!DEFAULT_EXPR_KINDS.has(kind)) {
    if (kind === "escape-hatch") {
      const nk = String(n.nativeKind ?? "");
      // A regular-expression literal is kept as text but holds no code: it reads
      // nothing and calls nothing. Accepted only when the text IS exactly one
      // regex literal (acorn says so); anything else stays refused.
      if (nk === "Literal" && typeof n.raw === "string") {
        try {
          const lit = acornParseExpressionAt(n.raw, 0, { ecmaVersion: "latest" }) as { type?: string; regex?: unknown; end?: number };
          if (lit.type === "Literal" && lit.regex && lit.end === n.raw.length) {
            return { kind: "lit", litType: "string", raw: n.raw, value: "" } as unknown as ExprNode;
          }
        } catch { /* not a regex literal — refused below */ }
      }
      throw new UnsupportedDefault(nk === "ArrowFunctionExpression" || nk === "FunctionExpression"
        ? "a function with a block body"
        : `\`${String(n.raw ?? "").trim().slice(0, 40)}\`, which the compiler keeps as unparsed text`);
    }
    if (kind === "markup-value") throw new UnsupportedDefault("markup");
    if (kind === "assign") throw new UnsupportedDefault("an assignment — a default computes a value and writes nothing");
    throw new UnsupportedDefault(`a \`${kind}\` expression`);
  }
  const N = (x: unknown): ExprNode => normalizeDefault(x, filePath);
  switch (kind) {
    case "ident": case "input-state-ref": case "sql-ref":
      return { ...n } as unknown as ExprNode; // a copy: the analysed tree never aliases the lowered one
    case "lit": {
      if (n.litType !== "template") return { ...n } as unknown as ExprNode;
      const raw = String(n.raw ?? "");
      const segs = tokenizeTemplateInterpolations(raw);
      const parts = segs.filter((s) => s.kind === "expr").map((s) => N(parseFragment(s.text, filePath)));
      return (parts.length === 0 ? { ...n } : { kind: "array", elements: parts }) as ExprNode;
    }
    case "array":
      return { ...n, elements: ((n.elements as unknown[]) ?? []).map(N) } as unknown as ExprNode;
    case "object":
      return {
        ...n,
        props: ((n.props as Array<Record<string, unknown>>) ?? []).map((pr) => {
          if (pr.kind === "shorthand") return { kind: "prop", key: pr.name, value: { kind: "ident", name: pr.name }, computed: false };
          if (pr.kind === "spread") return { ...pr, argument: N(pr.argument) };
          if (pr.kind === "prop") return { ...pr, key: typeof pr.key === "string" ? pr.key : N(pr.key), value: N(pr.value) };
          throw new UnsupportedDefault(`an object entry of kind \`${String(pr.kind)}\``);
        }),
      } as unknown as ExprNode;
    case "unary":
      // s466 fix round 4 — a default does not WRITE. `k = m++` (like `k = (m = "z")`,
      // refused as an `assign`, which is outside the set) wrote to a parameter the
      // route handler binds with `const`: the server module failed to LOAD, so
      // every route in it was down.
      if (n.op === "++" || n.op === "--" || n.op === "delete") {
        throw new UnsupportedDefault(`an update (\`${String(n.op)}\`) — a default computes a value and writes nothing`);
      }
      return { ...n, argument: N(n.argument) } as unknown as ExprNode;
    case "spread": return { ...n, argument: N(n.argument) } as unknown as ExprNode;
    case "cast": return { ...n, expression: N(n.expression) } as unknown as ExprNode;
    case "reset-expr": return { ...n, target: N(n.target) } as unknown as ExprNode;
    case "binary": return { ...n, left: N(n.left), right: N(n.right) } as unknown as ExprNode;
    case "ternary": return { ...n, condition: N(n.condition), consequent: N(n.consequent), alternate: N(n.alternate) } as unknown as ExprNode;
    case "member": return { ...n, object: N(n.object) } as unknown as ExprNode;
    case "index": return { ...n, object: N(n.object), index: N(n.index) } as unknown as ExprNode;
    case "call": case "new": return { ...n, callee: N(n.callee), args: ((n.args as unknown[]) ?? []).map(N) } as unknown as ExprNode;
    case "map-lit":
      return { ...n, entries: ((n.entries as Array<Record<string, unknown>>) ?? []).map((e) => ({ ...e, key: N(e.key), value: N(e.value) })) } as unknown as ExprNode;
    case "lambda": {
      const body = n.body as { kind?: string; value?: unknown } | undefined;
      if (!body || body.kind !== "expr") throw new UnsupportedDefault("a function with a block body");
      const params = ((n.params as Array<Record<string, unknown>>) ?? []).map((lp) =>
        lp.defaultValue ? { ...lp, defaultValue: N(lp.defaultValue) } : lp);
      return { ...n, params, body: { kind: "expr", value: N(body.value) } } as unknown as ExprNode;
    }
    case "match-expr": {
      const subjects = n.subjects as unknown[] | undefined;
      if (Array.isArray(subjects) && subjects.length >= 2) throw new UnsupportedDefault("a match on several subjects");
      if (n.structured) throw new UnsupportedDefault("a match with a `given` arm");
      // The same arm reader the match lowering uses (emit-control-flow.ts).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cf = require("./codegen/emit-control-flow.ts") as {
        parseMatchArm: (s: string) => { kind: string; binding: string | null; result: string; structuredBody?: unknown } | null;
        splitMultiArmString: (s: string) => string[];
      };
      const arms: ExprNode[] = [];
      for (const rawArm of ((n.rawArms as string[]) ?? [])) {
        for (const piece of cf.splitMultiArmString(String(rawArm))) {
          const text = piece.trim();
          if (!text) continue;
          const arm = cf.parseMatchArm(text);
          if (!arm) throw new UnsupportedDefault(`the match arm \`${text.slice(0, 40)}\`, which does not parse`);
          if (arm.kind === "given") throw new UnsupportedDefault("a match with a `given` arm");
          if (arm.structuredBody || arm.result.trim().startsWith("{")) throw new UnsupportedDefault("a match arm with a block body");
          arms.push({
            kind: "lambda",
            params: armBindingNames(arm.binding).map((name) => ({ name })),
            body: { kind: "expr", value: N(parseFragment(arm.result, filePath)) },
            isAsync: false,
            fnStyle: "arrow",
          } as unknown as ExprNode);
        }
      }
      if (arms.length === 0) throw new UnsupportedDefault("a match with no arm");
      return { kind: "array", elements: [N(n.subject), ...arms] } as unknown as ExprNode;
    }
  }
  throw new UnsupportedDefault(`a \`${kind}\` expression`);
}

function stampSpans(n: unknown, span: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (!n || typeof n !== "object" || seen.has(n as object)) return;
  seen.add(n as object);
  if (Array.isArray(n)) { for (const c of n) stampSpans(c, span, seen); return; }
  const r = n as Record<string, unknown>;
  if (typeof r.kind === "string") {
    if (span) r.span = span;
    else delete r.span;
  }
  for (const [k, v] of Object.entries(r)) if (k !== "span") stampSpans(v, span, seen);
}

const _analyzedDefaultCache = new WeakMap<object, { tree: ExprNode } | { unsupported: string }>();

/**
 * s466 fix round 3 — ONE parameter's default as the tree every default check
 * walks, or the reason it cannot be checked (`unsupported`). `null` when the
 * parameter has no default. See DEFAULT_EXPR_KINDS.
 */
export function analyzedParamDefault(p: unknown, filePath: string): { tree: ExprNode } | { unsupported: string } | null {
  const node = parsedParamDefault(p, filePath);
  if (!node) return null;
  const hit = _analyzedDefaultCache.get(p as object);
  if (hit) return hit;
  let out: { tree: ExprNode } | { unsupported: string };
  try {
    const tree = normalizeDefault(node, filePath);
    // Every node of the analysed tree carries the DEFAULT's source position (its
    // own parses ran at offset 0, so their spans point into the file's first
    // line): a diagnostic about anything in the default lands on the default.
    stampSpans(tree, paramDefaultSpan(p));
    out = { tree };
  }
  catch (e) {
    if (!(e instanceof UnsupportedDefault)) throw e;
    out = { unsupported: e.what };
  }
  _analyzedDefaultCache.set(p as object, out);
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
/**
 * s466 fix round 5 — the callees a parameter default's E-PARAM-DEFAULT-AWAIT
 * defers to the callee's own diagnostic (one root cause): a WHOLLY-server
 * function (no CPS split — a CPS function's `@` reads are marshalled and not
 * refused) whose body or defaults read an `@` name that a server body cannot
 * read — a client cell (E-REACTIVE-003), a channel cell, `@session`
 * (E-SESSION-AMBIENT-SERVER). `@currentUser` is left out: the server resolves
 * it, so such a function is not refused and the await must be reported.
 */
export function fnReadsServerRefusedAtName(fnNode: unknown, filePath: string): boolean {
  let found = false;
  const hit = (bare: string): void => { if (bare !== "currentUser") found = true; };
  forEachAtRef((fnNode as any)?.body, hit, { descendNestedFns: true, opaqueCode: true });
  if (!found) forEachAtRef(parsedParamDefaults(fnNode, filePath), hit, { descendNestedFns: true, opaqueCode: true });
  return found;
}

export function fnReachesAtName(fnNode: unknown, filePath: string): boolean {
  let found = false;
  const hit = (): void => { found = true; };
  forEachAtRef((fnNode as any)?.body, hit, { descendNestedFns: true, opaqueCode: true });
  if (!found) forEachAtRef(parsedParamDefaults(fnNode, filePath), hit, { descendNestedFns: true, opaqueCode: true });
  return found;
}
