/**
 * value-function-stored.ts — §14.3 / §15.11.5.1 / §59.3 `E-VALUE-FUNCTION-STORED`
 * (S462 ruling "a", "no value holds a function"; S464 "(a) Migrate the tests" /
 * "Yes, maps too" / "(a) Close it").
 *
 * The §14.3 S174 principle "a function is not value data … it SHALL NOT be STORED" extends
 * from struct fields + state cells to EVERY value. A function still flows PASSED (arguments,
 * callbacks, fn props/attributes = wiring) and CALLED (handlers), and a local binding may NAME
 * one (`const g = twice`); it is never put INTO a value. The stored positions judged here:
 *
 *   - a field / element / entry of an object, array or map literal (directly, through a spread,
 *     a computed key, a method, a getter);
 *   - a state cell's initializer or assigned value (`<f> = g`, `@f = g`);
 *   - an assignment INTO a value — `@o.k = g`, `@o["k"] = g`, `@fs[0] = g`, `o.f = g`,
 *     `u.toJSON = () => …` — unless the target is rooted in a host binding;
 *   - a method call on a scrml value that is not one of the closed set of built-in methods that
 *     only CALL their function argument (`map`, `filter`, `then`, …): `.push(g)`, `.concat(g)`,
 *     `.with(i, g)`, `.insert(k, g)`, `.add(g)` …; on a receiver of unknown provenance (a
 *     parameter, a call result) only the known storing methods are judged;
 *   - an enum payload (`Op.Apply(g)`);
 *   - an object/array literal handed to a host-JS call whose RESULT is kept as a scrml value
 *     (`const o = Object.freeze({ f: g })`) — S464 "(a) Close it". A host call in statement
 *     position (`console.log({ f })`, `el.addEventListener("x", f, { once: true })`) is the host
 *     boundary and is not judged.
 *
 * Function-ness is read from the TREE (pa.md Rule 7), never from source text. An expression MAY
 * hold a function when it is a lambda / `fn` / `function` expression; a name bound to a function
 * declaration, an imported scrml function, or a binding ANY of whose writes (initializer,
 * destructuring default, reassignment, parameter default, a call-site argument, a function-typed
 * annotation) may hold one; a call of a file function that may return one (its own function, or
 * one of its parameters — judged per call site); `.bind(…)` of one; or a ternary / `||` / `??` /
 * `&&` / `as` / assignment whose operand may. Facts about bindings and functions are solved to a
 * fixpoint over the whole file before anything is reported, so a later write or a later call
 * site is seen. Fail closed: a binding that MAY hold a function is treated as holding one.
 *
 * Block-bodied arrows / `function` expressions reach the type stage as escape hatches; their
 * bodies are read through the one shared reader (`escape-hatch-body.ts`), so the statements inside
 * are judged like any other. An object literal holding a `fn(…) { … }` value is unreadable to
 * acorn (a ParseError escape hatch); this pass reads what codegen emits for it (the
 * `rewriteFnKeyword` lowering, re-parsed) — the `checkRegisterMessagesCalls` precedent.
 *
 * Location: each stored function is reported at ITS OWN position when the file source is
 * available and the expression node's span verifiably points at it, else at the nearest
 * enclosing statement / markup node (expression spans can be expression-relative). The message
 * names the path inside the value (`deep.f`, `[0]`).
 */
import { boundNamesOf } from "./binding-names.ts";
import { parseExprToNode } from "./expression-parser.ts";
import { rewriteFnKeyword } from "./codegen/rewrite.ts";
import { escapeHatchBodyStatements } from "./escape-hatch-body.ts";

export interface ValueFnSpan {
  file: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

export interface ValueFnStoredDiag {
  code: "E-VALUE-FUNCTION-STORED";
  message: string;
  span: ValueFnSpan;
}

type Rec = Record<string, unknown>;

/**
 * What a name is bound to, as far as this check needs to know.
 *   fn    — a function definition (function-decl, `const g = (…) => …`, an alias of one, an
 *           imported scrml function)
 *   known — a scrml VALUE of known provenance (a literal initializer): its methods are built-ins
 *   value — a scrml binding of unknown provenance (a call result, a scrml import, a pattern)
 *   param — a parameter / loop / match / catch binder
 *   host  — a host-JS binding (import:host / .js import, or a local holding a host object)
 */
type BindingKind = "fn" | "known" | "value" | "param" | "host";

interface FnInfo {
  /** Parameter bindings by position (a pattern parameter binds several names). */
  params: Binding[][];
  /** The function may return a function of its own making. */
  returnsFn: boolean;
  /** Positions of parameters the function may return (judged per call site). */
  returnsParams: Set<number>;
}

interface Binding {
  name: string;
  kind: BindingKind;
  mayFn: boolean;
  fn?: FnInfo;
}

interface Ctx {
  /** Descending the literal containers of a literal handed to a host call whose result is NOT kept. */
  hostArg: boolean;
  /** The value is discarded (statement position / an event handler / a host chain off one). */
  discard: boolean;
  /** Path inside the enclosing literal (`deep.f`, `[0]`). */
  path: string;
  /** The literal is an argument of a host call whose result IS kept (S464 "(a) Close it"). */
  keptHost: boolean;
}

const EXPR_KINDS = new Set<string>([
  "ident", "lit", "array", "object", "spread", "unary", "binary", "assign", "ternary", "member",
  "index", "call", "new", "lambda", "cast", "match-expr", "map-lit", "sql-ref", "input-state-ref",
  "escape-hatch", "markup-value", "reset-expr", "prop", "shorthand", "template",
]);

/** Array methods that put their arguments INTO the receiver (a store) — the reactive statement form. */
const STORING_ARRAY_METHODS = new Set<string>(["push", "unshift", "splice", "fill"]);

/**
 * Methods known to put an argument into their receiver or their result. Judged on a receiver of
 * UNKNOWN provenance (a parameter, a call result, a scrml import), where the receiver might be a
 * host object whose methods scrml does not know.
 */
const STORING_METHODS = new Set<string>([
  ...STORING_ARRAY_METHODS, "insert", "add", "concat", "with", "set", "toSpliced", "append", "prepend",
]);

/**
 * The CLOSED set of built-in methods that take a function only to CALL it (it ends up in neither
 * the receiver nor the result). On a receiver KNOWN to be a scrml value (an `@` cell, a literal, a
 * binding initialised with a literal) every other method that receives a function is refused —
 * an allow-list, so a storing method the list does not name cannot slip through.
 */
const CALLING_METHODS = new Set<string>([
  "map", "filter", "forEach", "some", "every", "find", "findIndex", "findLast", "findLastIndex",
  "reduce", "reduceRight", "flatMap", "sort", "toSorted", "then", "catch", "finally", "replace",
  "replaceAll",
  // §59.7 / §59.8 map surface: `.update(k, f)` calls its updater; `.sortedBy(f)` its key function.
  "update", "sortedBy",
]);

/** Statement-list keys: an array under one of these is a block (a lexical scope). */
const BLOCK_KEYS = new Set<string>(["body", "consequent", "alternate", "stmts", "children", "elseBody", "finallyBody", "catchBody"]);

const LITERAL_KINDS = new Set<string>(["object", "array", "map-lit"]);

function isScrmlSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  return source.startsWith("scrml:") || /\.scrml$/.test(source);
}

/** A function-TYPE annotation (`() -> void`, `(x: int) => string`, `fn()`) — not a lifecycle `(A -> B)`. */
function isFunctionTypeAnnotation(t: unknown): boolean {
  if (typeof t !== "string") return false;
  const s = t.trim();
  if (/^fn\s*\(/.test(s)) return true;
  return /\)\s*(->|=>)\s*[^)\s][^)]*$/.test(s);
}

export function checkValueFunctionStored(
  nodes: unknown[],
  filePath: string,
  importedFnNames: Iterable<string> = [],
  sourceText?: string,
): ValueFnStoredDiag[] {
  const diags: ValueFnStoredDiag[] = [];
  const reportedKeys = new Set<string>();
  const defaultSpan: ValueFnSpan = { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  const src = typeof sourceText === "string" ? sourceText : null;
  const importedFns = [...importedFnNames];

  // ---- stable facts (identity survives the fixpoint passes) ----
  const bindingsByOwner = new WeakMap<object, Map<string, Binding>>();
  const fnInfos = new WeakMap<object, FnInfo>();
  const lowered = new WeakMap<object, unknown>();
  const hatchBodies = new WeakMap<object, unknown[] | null>();
  const parsedDefaults = new WeakMap<object, unknown>();
  const moduleOwner = {};
  let changed = false;
  let reporting = false;

  function bindingFor(owner: object, name: string, kind: BindingKind): Binding {
    let m = bindingsByOwner.get(owner);
    if (!m) { m = new Map(); bindingsByOwner.set(owner, m); }
    let b = m.get(name);
    if (!b) { b = { name, kind, mayFn: kind === "fn" }; m.set(name, b); }
    return b;
  }
  function setMayFn(b: Binding | null | undefined): void {
    if (b && !b.mayFn) { b.mayFn = true; changed = true; }
  }
  function fnInfoFor(node: object): FnInfo {
    let fi = fnInfos.get(node);
    if (!fi) { fi = { params: [], returnsFn: false, returnsParams: new Set() }; fnInfos.set(node, fi); }
    return fi;
  }

  // ---- scope ----
  let frames: Map<string, Binding>[] = [];
  /** >0 while walking a re-parsed escape-hatch body: its statement spans are body-relative. */
  let inHatch = 0;
  /** The expression root being walked: its normalised text, its span start, its source line. */
  let curRoot: { text: string; start: number; line: number } | null = null;
  function withRoot(text: unknown, rootNode: unknown, line: unknown, fn: () => void): void {
    const r = rootNode as Rec | undefined;
    const st = (r?.span as { start?: number } | undefined)?.start;
    const saved = curRoot;
    curRoot = (typeof text === "string" && typeof st === "number" && typeof line === "number" && inHatch === 0)
      ? { text: text.replace(/^\s+/, ""), start: st, line } : null;
    try { fn(); } finally { curRoot = saved; }
  }
  const lookup = (name: string): Binding | null => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const b = frames[i].get(name);
      if (b) return b;
    }
    return null;
  };
  const declare = (b: Binding): void => { frames[frames.length - 1].set(b.name, b); };
  const pushFrame = (): void => { frames.push(new Map()); };
  const popFrame = (): void => { if (frames.length > 1) frames.pop(); };

  // ---- enum type names (an enum constructor's payload is a stored value) ----
  const enumNames = new Set<string>();
  const collectEnums = (v: unknown, depth = 0): void => {
    if (!v || typeof v !== "object" || depth > 200) return;
    if (Array.isArray(v)) { for (const c of v) collectEnums(c, depth + 1); return; }
    const r = v as Rec;
    if (r.kind === "type-decl" && r.typeKind === "enum" && typeof r.name === "string") enumNames.add(r.name);
    if (r.kind === "import-decl" && isScrmlSource(r.source)) {
      for (const n of importNames(r)) if (/^[A-Z]/.test(n)) enumNames.add(n);
    }
    for (const k in r) {
      if (k === "span" || k === "parent") continue;
      const c = r[k];
      if (c && typeof c === "object" && !EXPR_KINDS.has(String((c as Rec).kind ?? ""))) collectEnums(c, depth + 1);
    }
  };
  function importNames(node: Rec): string[] {
    const specs = node.specifiers as Rec[] | undefined;
    return Array.isArray(specs) && specs.length > 0
      ? specs.map((s) => String(s.local ?? s.imported ?? "")).filter(Boolean)
      : ((node.names as string[] | undefined) ?? []);
  }
  collectEnums(nodes);

  // ---- function-ness, read from the tree ----
  function loweredOf(x: Rec): Rec | null {
    if (x.nativeKind !== "ParseError" || typeof x.raw !== "string") return null;
    if (lowered.has(x)) return lowered.get(x) as Rec | null;
    let out: Rec | null = null;
    const raw = x.raw as string;
    const low = rewriteFnKeyword(raw);
    if (low !== raw) {
      try {
        const re = parseExprToNode(low, filePath, 0) as unknown as Rec;
        if (re && re.kind !== "escape-hatch") out = re;
      } catch { out = null; }
    }
    lowered.set(x, out);
    return out;
  }

  function isFnExpr(x: Rec): boolean {
    if (x.kind === "lambda") return true;
    if (x.kind === "escape-hatch") {
      const nk = String(x.nativeKind ?? "");
      return nk === "ArrowFunctionExpression" || nk === "FunctionExpression";
    }
    return false;
  }

  /** May this expression evaluate to a function? (fail closed on bindings) */
  function mayFn(e: unknown): boolean {
    if (!e || typeof e !== "object") return false;
    const x = e as Rec;
    switch (x.kind) {
      case "lambda": return true;
      case "escape-hatch": {
        if (isFnExpr(x)) return true;
        const lo = loweredOf(x);
        return lo ? mayFn(lo) : false;
      }
      case "ident": {
        const name = x.name;
        if (typeof name !== "string" || name.startsWith("@") || name.startsWith(".")) return false;
        return lookup(name)?.mayFn ?? false;
      }
      case "ternary": return mayFn(x.consequent) || mayFn(x.alternate);
      case "binary":
        return (x.op === "||" || x.op === "??" || x.op === "&&") ? (mayFn(x.left) || mayFn(x.right)) : false;
      case "cast": return mayFn(x.expression);
      case "assign": return mayFn(x.value);
      case "call": return callMayFn(x);
      default: return false;
    }
  }

  function calleeFn(callee: unknown): FnInfo | null {
    const c = callee as Rec | undefined;
    if (!c || c.kind !== "ident" || typeof c.name !== "string") return null;
    return lookup(c.name)?.fn ?? null;
  }

  function callMayFn(x: Rec): boolean {
    const callee = x.callee as Rec | undefined;
    const args = (x.args as unknown[] | undefined) ?? [];
    if (callee?.kind === "member" && callee.property === "bind" && mayFn(callee.object)) return true;
    const fi = calleeFn(callee);
    if (!fi) return false;
    if (fi.returnsFn) return true;
    for (const i of fi.returnsParams) if (mayFn(args[i])) return true;
    return false;
  }

  /** What a RETURN expression of function `F` may yield: its own function, or which parameters. */
  function retSources(e: unknown, F: FnInfo, paramIndex: Map<Binding, number>, out: { own: boolean; params: Set<number> }): void {
    if (!e || typeof e !== "object") return;
    const x = e as Rec;
    switch (x.kind) {
      case "ident": {
        const b = typeof x.name === "string" ? lookup(x.name) : null;
        if (b && paramIndex.has(b)) { out.params.add(paramIndex.get(b)!); return; }
        if (mayFn(x)) out.own = true;
        return;
      }
      case "ternary": retSources(x.consequent, F, paramIndex, out); retSources(x.alternate, F, paramIndex, out); return;
      case "binary":
        if (x.op === "||" || x.op === "??" || x.op === "&&") { retSources(x.left, F, paramIndex, out); retSources(x.right, F, paramIndex, out); }
        return;
      case "cast": retSources(x.expression, F, paramIndex, out); return;
      case "call": {
        const fi = calleeFn(x.callee);
        const args = (x.args as unknown[] | undefined) ?? [];
        if (fi) {
          if (fi.returnsFn) out.own = true;
          for (const i of fi.returnsParams) retSources(args[i], F, paramIndex, out);
          return;
        }
        if (mayFn(x)) out.own = true;
        return;
      }
      default:
        if (mayFn(x)) out.own = true;
    }
  }

  function describe(e: unknown): string {
    const x = (e ?? {}) as Rec;
    switch (x.kind) {
      case "lambda":
        return x.fnStyle === "fn" ? "a `fn` expression" : x.fnStyle === "function" ? "a `function` expression" : "an arrow function";
      case "escape-hatch": {
        const nk = String(x.nativeKind ?? "");
        if (nk === "ArrowFunctionExpression") return "an arrow function";
        if (nk === "FunctionExpression") return "a `function` expression";
        const lo = loweredOf(x);
        return lo ? describe(lo) : "a function value";
      }
      case "ident": {
        const name = String(x.name ?? "");
        const b = lookup(name);
        return b && b.kind === "fn" && b.fn ? `the function \`${name}\`` : `\`${name}\`, which may hold a function`;
      }
      case "call": {
        const c = x.callee as Rec | undefined;
        const cn = c?.kind === "ident" ? String(c.name) : c?.kind === "member" ? `….${String(c.property)}` : "…";
        return `the result of \`${cn}(…)\`, which may be a function`;
      }
      case "ternary": return mayFn(x.consequent) ? describe(x.consequent) : describe(x.alternate);
      case "binary": return mayFn(x.right) ? describe(x.right) : describe(x.left);
      case "cast": return describe(x.expression);
      case "assign": return describe(x.value);
      default: return "a function value";
    }
  }

  // ---- binding provenance ----
  function rootOf(e: unknown): Rec | null {
    let cur = e as Rec | undefined;
    for (let guard = 0; cur && guard < 64; guard++) {
      switch (cur.kind) {
        case "member": case "index": cur = cur.object as Rec; continue;
        case "call": case "new": cur = cur.callee as Rec; continue;
        case "unary": cur = cur.argument as Rec ?? cur.operand as Rec; continue;
        default: return cur;
      }
    }
    return null;
  }
  /** host | global | known | value | param | fn | other — the provenance of a chain's root. */
  function rootKind(e: unknown): BindingKind | "global" | "other" {
    const r = rootOf(e);
    if (!r) return "other";
    if (LITERAL_KINDS.has(String(r.kind)) || r.kind === "lit" || r.kind === "template") return "known";
    if (r.kind !== "ident" || typeof r.name !== "string") return "other";
    if (r.name.startsWith("@")) return "known";
    if (r.name === "this") return "value";
    const b = lookup(r.name);
    return b ? b.kind : "global";
  }
  function isHostCallee(callee: unknown): boolean {
    const k = rootKind(callee);
    return k === "host" || k === "global";
  }
  function initKind(init: unknown): BindingKind {
    if (!init || typeof init !== "object") return "value";
    const x = init as Rec;
    if (isFnExpr(x)) return "fn";
    if (LITERAL_KINDS.has(String(x.kind)) || x.kind === "lit" || x.kind === "template") return "known";
    if (x.kind === "unary") return initKind(x.argument ?? x.operand);
    if (x.kind === "ident" && typeof x.name === "string") {
      if (x.name.startsWith("@")) return "known";
      const b = lookup(x.name);
      if (b) return b.kind === "fn" ? "fn" : b.kind;
      return "host";
    }
    if (x.kind === "call" || x.kind === "new") return isHostCallee(x.callee) ? "host" : "value";
    if (x.kind === "member" || x.kind === "index") {
      const rk = rootKind(x);
      return rk === "host" || rk === "global" ? "host" : "value";
    }
    return "value";
  }

  // ---- reporting ----
  /**
   * An ExprNode's span is an offset into the expression's own (token-normalised) text, which keeps
   * the source's line breaks. So the value's LINE is the root's line plus the line breaks before
   * it in that text, and its COLUMN is found by locating the same token, the same number of times
   * over, on that source line. Anything that does not line up falls back to the enclosing node.
   */
  function locate(node: unknown, at: ValueFnSpan): ValueFnSpan {
    const x = node as Rec | undefined;
    const sp = x?.span as { start?: number } | undefined;
    const root = curRoot;
    if (!src || !root || inHatch > 0 || !sp || typeof sp.start !== "number") return at;
    const off = sp.start - root.start;
    if (off < 0 || off > root.text.length) return at;
    const before = root.text.slice(0, off);
    const dl = before.split("\n").length - 1;
    const line = root.line + dl;
    const lines = src.split("\n");
    const srcLine = lines[line - 1];
    if (srcLine === undefined) return at;
    const rest = root.text.slice(off);
    const tok = (x!.kind === "ident" || x!.kind === "shorthand") ? String(x!.name) : (rest.match(/^\s*([A-Za-z_$][\w$]*|\S)/)?.[1] ?? "");
    if (!tok) return at;
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(/^[A-Za-z_$]/.test(tok) ? `(?<![\\w$])${esc}(?![\\w$])` : esc, "g");
    const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
    const k = (lineBefore.match(re) ?? []).length;
    // On the root's first line, search only from where the root's text begins.
    let from = 0;
    if (dl === 0) {
      const first = root.text.match(/^\s*([A-Za-z_$@][\w$]*|\S)/)?.[1];
      if (first) { const i = srcLine.indexOf(first); if (i >= 0) from = i; }
    }
    const hits = [...srcLine.slice(from).matchAll(re)];
    const hit = hits[k];
    if (!hit || hit.index === undefined) return at;
    let startOff = 0;
    for (let i = 0; i < line - 1; i++) startOff += lines[i].length + 1;
    const col = from + hit.index + 1;
    return { file: at.file ?? filePath, start: startOff + col - 1, end: startOff + col - 1 + tok.length, line, col };
  }
  function report(what: string, valueNode: unknown, fnDesc: string, at: ValueFnSpan, hint: string | null): void {
    if (!reporting) return;
    const where = locate(valueNode, at);
    const key = `${where.file}:${where.start}:${where.end}:${what}:${hint ?? ""}:${fnDesc}`;
    if (reportedKeys.has(key)) return;
    reportedKeys.add(key);
    const h = hint ? ` (${hint})` : "";
    diags.push({
      code: "E-VALUE-FUNCTION-STORED",
      message:
        `E-VALUE-FUNCTION-STORED: ${what} stores ${fnDesc}${h}. A function is not value data — it has no ` +
        `structural equality, is not serializable and cannot be a map key — so no value holds one: not an ` +
        `object, array or map literal, not a spread into one, not a state cell, not a field or element written ` +
        `into a value, not an enum payload (§14.3, §15.11.5.1, §59.3). Pass it instead: hand it directly to ` +
        `the call that uses it as its own argument (a callback), wire it as a component prop or event handler, ` +
        `or call it where the work happens; to choose between behaviours, store an enum tag and \`match\` on it.`,
      span: where,
    });
  }
  const join = (path: string, seg: string): string => (seg.startsWith("[") ? `${path}${seg}` : path ? `${path}.${seg}` : seg);
  function fieldHint(path: string, ctx: Ctx, extra?: string): string | null {
    const parts: string[] = [];
    if (path) parts.push(path.startsWith("[") ? `at \`${path}\`` : `in field \`${path}\``);
    if (extra) parts.push(extra);
    if (ctx.keptHost) parts.push("the host call's result is kept as a value, so the host boundary does not apply");
    return parts.length ? parts.join("; ") : null;
  }

  // ---- functions (decl, lambda, escape-hatch): parameters, body, returns ----
  function paramDefault(p: Rec): unknown {
    const dv = p.defaultValue;
    if (!dv) return null;
    if (typeof dv === "object") return dv;
    if (typeof dv === "string") {
      if (parsedDefaults.has(p)) return parsedDefaults.get(p);
      let n: unknown = null;
      try { n = parseExprToNode(dv, filePath, 0); } catch { n = null; }
      parsedDefaults.set(p, n);
      return n;
    }
    return null;
  }

  function enterFunction(node: Rec, params: unknown[], at: ValueFnSpan): { fi: FnInfo; paramIndex: Map<Binding, number> } {
    const fi = fnInfoFor(node);
    const paramIndex = new Map<Binding, number>();
    params.forEach((p, i) => {
      const pr = (p && typeof p === "object" ? p : {}) as Rec;
      const dv = typeof p === "object" ? paramDefault(pr) : null;
      if (dv) walkExpr(dv, at, freshCtx());
      const names = boundNamesOf(p);
      const list: Binding[] = [];
      for (const n of names) {
        const b = bindingFor(node, `${i}:${n}`, "param");
        b.name = n;
        if (isFunctionTypeAnnotation(pr.typeAnnotation)) setMayFn(b);
        if (dv && mayFn(dv)) setMayFn(b);
        declare(b);
        list.push(b);
        paramIndex.set(b, i);
      }
      fi.params[i] = list;
    });
    return { fi, paramIndex };
  }

  function noteReturn(e: unknown, fi: FnInfo, paramIndex: Map<Binding, number>): void {
    const out = { own: false, params: new Set<number>() };
    retSources(e, fi, paramIndex, out);
    if (out.own && !fi.returnsFn) { fi.returnsFn = true; changed = true; }
    for (const i of out.params) if (!fi.returnsParams.has(i)) { fi.returnsParams.add(i); changed = true; }
  }

  const retCtx: { fi: FnInfo; paramIndex: Map<Binding, number> }[] = [];

  function walkFunction(node: Rec, params: unknown[], body: { expr?: unknown; stmts?: unknown[] }, at: ValueFnSpan): FnInfo {
    pushFrame();
    const r = enterFunction(node, params, at);
    retCtx.push(r);
    if (body.expr !== undefined) {
      noteReturn(body.expr, r.fi, r.paramIndex);
      walkExpr(body.expr, at, freshCtx());
    } else if (body.stmts) {
      walkStmts(body.stmts, at);
    }
    retCtx.pop();
    popFrame();
    return r.fi;
  }

  function hatchBody(x: Rec): unknown[] | null {
    if (hatchBodies.has(x)) return hatchBodies.get(x) ?? null;
    const stmts = escapeHatchBodyStatements(x, filePath);
    hatchBodies.set(x, stmts);
    return stmts;
  }

  /** Walk a function-valued expression's body; returns its FnInfo (null when not a function). */
  function walkFnExpr(x: Rec, at: ValueFnSpan): FnInfo | null {
    if (x.kind === "lambda") {
      const body = x.body as Rec | undefined;
      const params = (x.params as unknown[] | undefined) ?? [];
      if (body?.kind === "expr") return walkFunction(x, params, { expr: body.value }, at);
      if (body?.kind === "block") return walkFunction(x, params, { stmts: (body.stmts as unknown[]) ?? [] }, at);
      return walkFunction(x, params, {}, at);
    }
    if (x.kind === "escape-hatch" && isFnExpr(x)) {
      const params = Array.isArray(x.params) ? (x.params as unknown[]) : [];
      const stmts = hatchBody(x);
      inHatch++;
      try { return walkFunction(x, params, { stmts: stmts ?? [] }, at); } finally { inHatch--; }
    }
    return null;
  }

  // ---- expression walk ----
  const freshCtx = (over: Partial<Ctx> = {}): Ctx => ({ hostArg: false, discard: false, path: "", keptHost: false, ...over });
  let seen = new WeakSet<object>();

  function walkExpr(e: unknown, at: ValueFnSpan, ctx: Ctx): void {
    if (!e || typeof e !== "object") return;
    if (Array.isArray(e)) { for (const c of e) walkExpr(c, at, freshCtx()); return; }
    if (seen.has(e as object)) return;
    seen.add(e as object);
    const x = e as Rec;
    const inLit = (over: Partial<Ctx>): Ctx => freshCtx({ hostArg: ctx.hostArg, keptHost: ctx.keptHost, ...over });
    switch (x.kind) {
      case "object": {
        for (const p of (x.props as Rec[] | undefined) ?? []) {
          if (!p || typeof p !== "object") continue;
          if (p.kind === "prop") {
            const keyName = typeof p.key === "string" ? p.key : "[computed]";
            const path = join(ctx.path, keyName);
            if (!ctx.hostArg && mayFn(p.value)) report("This object literal", p.value, describe(p.value), at, fieldHint(path, ctx));
            if (p.computed && p.key && typeof p.key === "object") walkExpr(p.key, at, freshCtx());
            walkExpr(p.value, at, inLit({ path }));
          } else if (p.kind === "shorthand") {
            const name = String(p.name ?? "");
            const path = join(ctx.path, name);
            const b = lookup(name);
            if (!ctx.hostArg && b?.mayFn) report("This object literal", p, describe({ kind: "ident", name }), at, fieldHint(path, ctx));
          } else if (p.kind === "spread") {
            if (!ctx.hostArg && mayFn(p.argument)) report("This object literal", p.argument, describe(p.argument), at, fieldHint(ctx.path, ctx, "through a spread"));
            walkExpr(p.argument, at, inLit({ path: ctx.path }));
          }
        }
        return;
      }
      case "array": {
        let i = 0;
        for (const el of (x.elements as Rec[] | undefined) ?? []) {
          if (el && typeof el === "object") {
            const spread = el.kind === "spread";
            const target = spread ? el.argument : el;
            const path = join(ctx.path, `[${i}]`);
            if (!ctx.hostArg && mayFn(target)) {
              report("This array literal", target, describe(target), at, fieldHint(spread ? ctx.path : path, ctx, spread ? "through a spread" : undefined));
            }
            walkExpr(target, at, inLit({ path }));
          }
          i++;
        }
        return;
      }
      case "map-lit": {
        for (const ent of (x.entries as Rec[] | undefined) ?? []) {
          if (!ent) continue;
          const k = ent.key as Rec | undefined;
          const seg = k && k.kind === "lit" ? `[${String(k.raw ?? k.value)}]` : "[…]";
          const path = join(ctx.path, seg);
          if (!ctx.hostArg && mayFn(ent.value)) report("This map literal", ent.value, describe(ent.value), at, fieldHint(path, ctx));
          walkExpr(ent.key, at, freshCtx());
          walkExpr(ent.value, at, inLit({ path }));
        }
        return;
      }
      case "spread":
        walkExpr(x.argument, at, ctx);
        return;
      case "assign": {
        const t = x.target as Rec | undefined;
        const v = x.value;
        if (t?.kind === "ident" && typeof t.name === "string") {
          if (t.name.startsWith("@")) {
            if (mayFn(v)) report(`The state cell \`${t.name}\``, v, describe(v), at, null);
          } else if (mayFn(v)) {
            setMayFn(lookup(t.name));
          }
        } else if (t && (t.kind === "member" || t.kind === "index")) {
          const rk = rootKind(t);
          if (rk !== "host" && rk !== "global" && mayFn(v)) {
            const root = rootOf(t);
            const rn = root?.kind === "ident" ? String(root.name) : "this value";
            const what = rn.startsWith("@") ? `The state cell \`${rn}\`` : `The value \`${rn}\``;
            report(what, v, describe(v), at, "through a field / element write");
          }
          walkExpr(t, at, freshCtx());
        }
        walkExpr(v, at, freshCtx());
        return;
      }
      case "call": case "new": {
        const callee = x.callee as Rec | undefined;
        const args = (x.args as unknown[] | undefined) ?? [];
        const host = isHostCallee(callee);
        // Enum payload — `Op.Apply(g)`.
        if (x.kind === "call" && callee?.kind === "member" && (callee.object as Rec | undefined)?.kind === "ident") {
          const en = String((callee.object as Rec).name);
          if (enumNames.has(en) && !lookup(en)) {
            for (const a of args) if (mayFn(a)) report(`The enum value \`${en}.${String(callee.property)}\``, a, describe(a), at, "as its payload");
          }
        }
        // A method that may put its argument into a scrml value.
        if (x.kind === "call" && callee?.kind === "member" && typeof callee.property === "string") {
          const prop = callee.property;
          const rk = rootKind(callee.object);
          const judge = rk === "known" ? !CALLING_METHODS.has(prop)
            : (rk === "value" || rk === "param" || rk === "fn") ? STORING_METHODS.has(prop)
            : false;
          if (judge) {
            const root = rootOf(callee.object);
            const rn = root?.kind === "ident" ? String(root.name) : null;
            const what = rn ? (rn.startsWith("@") ? `The state cell \`${rn}\`` : `The value \`${rn}\``) : "This value";
            const from = prop === "splice" || prop === "toSpliced" ? 2 : prop === "with" || prop === "set" || prop === "insert" ? 1 : 0;
            args.forEach((a, ai) => {
              if (ai >= from && mayFn(a)) report(what, a, describe(a), at, `through \`.${prop}(…)\``);
            });
          }
        }
        // Call-site propagation into a file function's parameters.
        const fi = calleeFn(callee);
        if (fi) {
          args.forEach((a, ai) => {
            if (mayFn(a)) for (const b of fi.params[ai] ?? []) setMayFn(b);
          });
        }
        const discardChain = host && ctx.discard;
        walkExpr(callee, at, freshCtx({ discard: discardChain }));
        for (const a of args) {
          if (!a || typeof a !== "object") continue;
          const lit = LITERAL_KINDS.has(String((a as Rec).kind));
          if (host && lit) {
            walkExpr(a, at, freshCtx({ hostArg: discardChain, keptHost: !discardChain, discard: discardChain }));
          } else {
            walkExpr(a, at, freshCtx({ discard: discardChain }));
          }
        }
        return;
      }
      case "member": case "index":
        walkExpr(x.object, at, freshCtx({ discard: ctx.discard }));
        if (x.kind === "index") walkExpr(x.index, at, freshCtx());
        return;
      case "lambda":
        walkFnExpr(x, at);
        return;
      case "escape-hatch": {
        if (isFnExpr(x)) { walkFnExpr(x, at); return; }
        const lo = loweredOf(x);
        if (lo) walkExpr(lo, at, ctx);
        return;
      }
      default:
        for (const k in x) {
          if (k === "span") continue;
          const v = x[k];
          if (v && typeof v === "object") walkAny(v, at);
        }
    }
  }

  // ---- statement / tree walk ----
  function spanOf(node: Rec, fallback: ValueFnSpan): ValueFnSpan {
    const sp = node.span as ValueFnSpan | undefined;
    const kind = typeof node.kind === "string" ? node.kind : "";
    if (inHatch === 0 && !EXPR_KINDS.has(kind) && sp && typeof sp.start === "number" && typeof sp.line === "number") {
      return { file: sp.file ?? fallback.file, start: sp.start, end: sp.end, line: sp.line, col: sp.col };
    }
    return fallback;
  }

  function hoist(stmts: unknown[]): void {
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      const r = s as Rec;
      if (r.kind === "function-decl" && typeof r.name === "string") {
        const b = bindingFor(r, r.name, "fn");
        b.fn = fnInfoFor(r);
        declare(b);
      }
      if (r.kind === "export-decl" && r.declaration && typeof r.declaration === "object") hoist([r.declaration]);
    }
  }

  function walkStmts(stmts: unknown[], at: ValueFnSpan): void {
    pushFrame();
    hoist(stmts);
    for (const s of stmts) walkAny(s, at);
    popFrame();
  }

  /** Bind the names a declaration introduces; `init` decides function-ness / provenance. */
  function bindDecl(node: Rec, declKind: string, init: unknown, at: ValueFnSpan): void {
    const nm = node.name;
    if (typeof nm === "string") {
      // A tilde-decl naming a binding already in scope is a REASSIGNMENT (`g = twice`).
      if (declKind === "tilde-decl") {
        const existing = lookup(nm);
        if (existing && existing.kind !== "fn") { if (mayFn(init)) setMayFn(existing); return; }
      }
      const kind = initKind(init);
      const b = bindingFor(node, nm, kind);
      if (mayFn(init)) setMayFn(b);
      if (init && typeof init === "object") {
        const ix = init as Rec;
        if (isFnExpr(ix)) b.fn = fnInfoFor(ix);
        else if (ix.kind === "ident" && typeof ix.name === "string") { const t = lookup(ix.name); if (t?.fn) b.fn = t.fn; }
      }
      declare(b);
      return;
    }
    // A destructuring pattern: each name may take a default.
    const pat = nm as Rec | undefined;
    if (pat && (pat.kind === "destructure-object" || pat.kind === "destructure-array")) {
      const items = ((pat.properties ?? pat.elements) as Rec[] | undefined) ?? [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const dv = it.defaultExpr;
        if (dv) walkExpr(dv, at, freshCtx());
        for (const n of boundNamesOf(it.bindName ?? it.name ?? it)) {
          const b = bindingFor(it, n, "value");
          if (dv && mayFn(dv)) setMayFn(b);
          declare(b);
        }
      }
      return;
    }
    for (const n of boundNamesOf(nm)) declare(bindingFor(node, n, initKind(init)));
  }

  function walkAny(v: unknown, at: ValueFnSpan): void {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const c of v) walkAny(c, at); return; }
    const node = v as Rec;
    const kind = typeof node.kind === "string" ? node.kind : "";
    if (kind && EXPR_KINDS.has(kind)) { walkExpr(node, at, freshCtx()); return; }
    if (seen.has(node)) return;
    seen.add(node);
    const here = spanOf(node, at);

    switch (kind) {
      case "import-decl": {
        const host = !isScrmlSource(node.source);
        for (const n of importNames(node)) {
          const existing = frames[0].get(n);
          if (existing && existing.kind === "fn" && !host) continue; // an imported scrml function
          frames[0].set(n, bindingFor(moduleOwner, `import:${n}`, host ? "host" : "value"));
          frames[0].get(n)!.name = n;
        }
        return;
      }
      case "function-decl": {
        if (typeof node.name === "string") {
          const b = bindingFor(node, node.name, "fn");
          b.fn = fnInfoFor(node);
          declare(b);
        }
        walkFunction(node, (node.params as unknown[] | undefined) ?? [], { stmts: Array.isArray(node.body) ? (node.body as unknown[]) : [] }, here);
        return;
      }
      case "let-decl": case "const-decl": case "tilde-decl": case "lin-decl": {
        const init = node.initExpr;
        if (init) withRoot(node.init, init, here.line, () => walkExpr(init, here, freshCtx()));
        bindDecl(node, kind, init, here);
        return;
      }
      case "return-stmt": {
        const e = node.exprNode;
        const rc = retCtx[retCtx.length - 1];
        if (e && rc) noteReturn(e, rc.fi, rc.paramIndex);
        if (e) withRoot(node.expr, e, here.line, () => walkExpr(e, here, freshCtx()));
        return;
      }
      case "bare-expr": {
        if (node.exprNode) withRoot(node.expr, node.exprNode, here.line, () => walkExpr(node.exprNode, here, freshCtx({ discard: true })));
        return;
      }
      case "state-decl": {
        withRoot(node.init, node.initExpr, here.line, () => {
          if (mayFn(node.initExpr)) report(`The state cell \`@${String(node.name ?? "")}\``, node.initExpr, describe(node.initExpr), here, null);
          if (node.initExpr) walkExpr(node.initExpr, here, freshCtx());
        });
        break;
      }
      case "reactive-assign": {
        if (mayFn(node.valueExpr)) report(`The state cell \`@${String(node.target ?? "")}\``, node.valueExpr, describe(node.valueExpr), here, null);
        break;
      }
      case "reactive-nested-assign": {
        const path = Array.isArray(node.path) ? (node.path as unknown[]).join(".") : "";
        if (mayFn(node.valueExpr)) report(`The state cell \`@${String(node.target ?? "")}\``, node.valueExpr, describe(node.valueExpr), here, path ? `in field \`${path}\`` : null);
        break;
      }
      case "reactive-array-mutation": {
        if (typeof node.method === "string" && STORING_METHODS.has(node.method)) {
          for (const a of (node.argExprs as unknown[] | undefined) ?? []) {
            if (mayFn(a)) report(`The state cell \`@${String(node.target ?? "")}\``, a, describe(a), here, `through \`.${node.method}(…)\``);
          }
        }
        break;
      }
      case "for-stmt": {
        pushFrame();
        for (const n of boundNamesOf(node.variable)) declare(bindingFor(node, n, "param"));
        for (const k in node) {
          if (k === "span" || k === "variable") continue;
          const c = node[k];
          if (c && typeof c === "object") walkAny(c, here);
        }
        popFrame();
        return;
      }
      case "match-arm-block": {
        pushFrame();
        const names = new Set<string>();
        for (const n of (node.payloadBindings as unknown[] | undefined) ?? []) if (typeof n === "string") names.add(n);
        if (typeof node.binding === "string") names.add(node.binding);
        for (const n of names) for (const bn of boundNamesOf(n)) declare(bindingFor(node, bn, "param"));
        walkAny(node.body, here);
        popFrame();
        return;
      }
      case "try-stmt": {
        if (Array.isArray(node.body)) walkStmts(node.body as unknown[], here);
        const cn = node.catchNode as Rec | undefined;
        if (cn) {
          pushFrame();
          const header = typeof cn.header === "string" ? cn.header.trim().replace(/^\(/, "").replace(/\)$/, "").trim() : "";
          if (header) for (const n of boundNamesOf(header)) declare(bindingFor(cn, n, "param"));
          if (Array.isArray(cn.body)) walkStmts(cn.body as unknown[], here);
          popFrame();
        }
        for (const k of ["finallyNode", "finallyBody", "finalizer"]) if (node[k]) walkAny(node[k], here);
        return;
      }
      case "each-block": {
        pushFrame();
        const names: string[] = [];
        if (typeof node.asName === "string") names.push(node.asName);
        if (Array.isArray(node.asNames)) for (const n of node.asNames as unknown[]) if (typeof n === "string") names.push(n);
        for (const n of names) for (const bn of boundNamesOf(n)) declare(bindingFor(node, bn, "param"));
        for (const k in node) {
          if (k === "span") continue;
          const c = node[k];
          if (c && typeof c === "object") walkAny(c, here);
        }
        popFrame();
        return;
      }
      case "markup": {
        for (const a of (node.attrs as Rec[] | undefined) ?? []) {
          const val = a?.value as Rec | undefined;
          if (val && val.exprNode) {
            const name = typeof a.name === "string" ? a.name : "";
            const asp = spanOf(a, here);
            withRoot(val.raw, val.exprNode, asp.line, () => walkExpr(val.exprNode, asp, freshCtx({ discard: /^on/i.test(name) })));
          }
        }
        break;
      }
      default:
        break;
    }

    for (const k in node) {
      if (k === "span") continue;
      if (kind === "markup" && k === "attrs") continue;
      const c = node[k];
      if (!c || typeof c !== "object") continue;
      if (Array.isArray(c) && BLOCK_KEYS.has(k)) walkStmts(c, here);
      else walkAny(c, here);
    }
  }

  // ---- one pass over the file ----
  const topLevel = (list: unknown[]): void => {
    for (const n of list) {
      if (!n || typeof n !== "object") continue;
      const r = n as Rec;
      if (r.kind === "function-decl" && typeof r.name === "string") {
        const b = bindingFor(r, r.name, "fn");
        b.fn = fnInfoFor(r);
        frames[0].set(r.name, b);
        continue;
      }
      if ((r.kind === "const-decl" || r.kind === "let-decl") && typeof r.name === "string") {
        // A file-level declaration is visible file-wide (markup, other logic blocks, state cells).
        const ik = r.initExpr as Rec | undefined;
        const b = bindingFor(r, r.name, initKind(ik));
        if (ik && isFnExpr(ik)) b.fn = fnInfoFor(ik);
        frames[0].set(r.name, b);
        continue;
      }
      if (r.kind === "export-decl" && r.declaration && typeof r.declaration === "object") topLevel([r.declaration]);
      if (r.kind === "logic" && Array.isArray(r.body)) topLevel(r.body as unknown[]);
      if (r.kind === "markup" && Array.isArray(r.children)) topLevel(r.children as unknown[]);
    }
  };

  function runPass(): void {
    seen = new WeakSet<object>();
    frames = [new Map()];
    retCtx.length = 0;
    inHatch = 0;
    for (const n of importedFns) {
      const b = bindingFor(moduleOwner, `importedFn:${n}`, "fn");
      b.name = n;
      frames[0].set(n, b);
    }
    topLevel(nodes);
    for (const n of nodes) walkAny(n, defaultSpan);
  }

  // Solve binding / function facts to a fixpoint, then report once.
  for (let pass = 0; pass < 16; pass++) {
    changed = false;
    runPass();
    if (!changed) break;
  }
  reporting = true;
  runPass();
  return diags;
}
