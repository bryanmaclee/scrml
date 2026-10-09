/**
 * narrowing-write-set.ts — what a node WRITES, for the §42.3.5 "a write ends the
 * narrowing" rule (S462), over the narrowed places a consumer tracks.
 *
 * Governing text — SPEC §42.3.5 (ruling:user-voice-scrml.md S462 "b"):
 *   "A write to the narrowed place — direct, in a nested block, or by a call that writes
 *    it or whose write set cannot be determined — ends the narrowing from that point; a
 *    later member access through it is E-TYPE-046."
 *
 * presence-narrowing.ts owns WHEN a write happens (evaluation order, nested blocks,
 * loops, alternatives, definitions that run nothing — `endsWithin`). This module answers,
 * for ONE node, WHAT it writes (`endsAt`). FAIL CLOSED: a call whose write set is not
 * DETERMINED ends every narrowing in force (`"all"`).
 *
 *   - A direct write of the place: `@x = …` (a `state-decl` in a body), `x = …` / `x += …`
 *     (`assign`), `reset(@x)`.
 *   - A call whose callee name RESOLVES, through the lexical scopes of the file, to a
 *     function declaration: that declaration's WRITE SET — a MAY-write set (every path,
 *     a returning branch included — `mayWriteWithin`), closed over the functions it calls
 *     (a least fixpoint). A parameter, a local, a closure variable or an import named
 *     like a function does NOT borrow that function's write set: it is a value, and a
 *     call through a value is undetermined (fix round 1, F2).
 *   - A built-in call: a global function / namespace (`String(…)`, `Math.max(…)`) not
 *     shadowed by any binding, or a built-in METHOD whose RECEIVER is known to be a
 *     built-in value (a string, a number, an array, …: a literal, or a cell / local /
 *     parameter / field whose declared type is one — fix round 1, F3). Its write set is
 *     what its ARGUMENTS may run: every argument that is or may be a function — a lambda,
 *     a function reference, a value whose type is unknown or may hold a function, an
 *     object / array literal holding one — is assumed CALLED (fix round 1, F4). Only the
 *     scheduling globals (`setTimeout`, …) are exempt: their callback runs later.
 *   - ANY OTHER CALL — through a value, a cell, an import, a call result, a method of a
 *     receiver whose type is not a known built-in, an escape-hatch expression — is
 *     undetermined: `"all"`.
 *
 * A write UNDER the place (`@x.f = …`, `@xs.push(…)`) changes the value, not whether it is
 * present; it ends nothing.
 *
 * Residual (named, not closed here): an implicit coercion call — `"" + v` / a template
 * over a value whose `toString` field is a function — is not treated as a call.
 */

import { mayWriteWithin, unionEnds, type NarrowEnds } from "./presence-narrowing.ts";

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Value shapes — what the compiler knows about a value, for F3 / F4.
// ---------------------------------------------------------------------------

/** What is known about a value. */
export interface ValueShape {
  /** A built-in method called on it runs no scrml code of its own (string, number, array). */
  builtinMethods: boolean;
  /** It is not, and contains no, function (safe to hand to a built-in as data). */
  functionFree: boolean;
  /** A field's shape, or null if unknown. */
  field(name: string): ValueShape | null;
  /** An element's shape (an array), or null if unknown. */
  element(): ValueShape | null;
}

export const UNKNOWN_SHAPE: ValueShape = { builtinMethods: false, functionFree: false, field: () => null, element: () => null };
export const FUNCTION_SHAPE: ValueShape = UNKNOWN_SHAPE;
export const PRIM_SHAPE: ValueShape = { builtinMethods: true, functionFree: true, field: () => PRIM_SHAPE, element: () => PRIM_SHAPE };

export function arrayShape(element: ValueShape): ValueShape {
  return {
    builtinMethods: true,
    functionFree: element.functionFree,
    field: (name) => (name === "length" ? PRIM_SHAPE : null),
    element: () => element,
  };
}

/** A value with known fields (a struct / object literal): no built-in methods. */
export function recordShape(functionFree: boolean, field: (name: string) => ValueShape | null): ValueShape {
  return { builtinMethods: false, functionFree, field, element: () => null };
}

function joinShapes(a: ValueShape, b: ValueShape): ValueShape {
  if (a === b) return a;
  return {
    builtinMethods: a.builtinMethods && b.builtinMethods,
    functionFree: a.functionFree && b.functionFree,
    field: () => null,
    element: () => null,
  };
}

const PRIM_TYPE_NAMES = new Set(["string", "int", "number", "float", "bool", "boolean", "bigint"]);

/** The syntactic reading of a type annotation, used when the consumer gives no type reader. */
function syntacticShape(annotation: string): ValueShape {
  let t = annotation.replace(/\s+/g, "");
  t = t.replace(/^not\|/, "").replace(/\|not$/, "").replace(/\?$/, "");
  if (PRIM_TYPE_NAMES.has(t)) return PRIM_SHAPE;
  if (t.endsWith("[]")) return arrayShape(syntacticShape(t.slice(0, -2)));
  return UNKNOWN_SHAPE;
}

// ---------------------------------------------------------------------------
// The name lists — each EXEMPTS known-safe names only (fail closed).
// ---------------------------------------------------------------------------

/** Global namespaces whose methods run no scrml code except through their arguments. */
const BUILTIN_NAMESPACES = new Set([
  "Math", "JSON", "console", "Object", "Array", "Number", "String", "Boolean", "Date",
  "Promise", "Intl", "Symbol", "BigInt", "URL", "URLSearchParams", "crypto", "performance",
]);

/** Global functions that run no scrml code except through their arguments. */
const BUILTIN_FUNCTIONS = new Set([
  "String", "Number", "Boolean", "BigInt", "Symbol", "parseInt", "parseFloat", "isNaN",
  "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  "structuredClone", "clearTimeout", "clearInterval", "cancelAnimationFrame",
]);

/**
 * Globals that SCHEDULE a function to run later — the only callees whose function
 * arguments are known NOT to run synchronously. The callback cannot run before the
 * current synchronous code finishes, so it writes nothing "from this point" here.
 * (A narrowing read INSIDE such a callback is g-narrowing-crosses-deferred-closure-s462.)
 */
const SCHEDULING_FUNCTIONS = new Set(["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);

/**
 * Methods of the built-in value types (string, number, array, Date, Promise). Trusted
 * ONLY on a receiver whose shape says `builtinMethods` (F3).
 */
const BUILTIN_METHODS = new Set([
  // Array
  "at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find", "findIndex",
  "findLast", "findLastIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join",
  "keys", "lastIndexOf", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift",
  "slice", "some", "sort", "splice", "toReversed", "toSorted", "toSpliced", "unshift",
  "values", "with",
  // String
  "charAt", "charCodeAt", "codePointAt", "endsWith", "localeCompare", "match", "matchAll",
  "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll", "search", "split",
  "startsWith", "substring", "substr", "toLowerCase", "toUpperCase", "toLocaleLowerCase",
  "toLocaleUpperCase", "trim", "trimEnd", "trimStart",
  // Number / common
  "toFixed", "toPrecision", "toExponential", "toString", "toLocaleString", "valueOf",
  // Promise
  "then", "catch", "finally",
]);

/** Built-in methods whose result is a primitive (string / number / boolean). */
const PRIM_RESULT_METHODS = new Set([
  "at", "charAt", "charCodeAt", "codePointAt", "endsWith", "every", "findIndex", "findLastIndex",
  "includes", "indexOf", "join", "lastIndexOf", "localeCompare", "normalize", "padEnd",
  "padStart", "repeat", "replace", "replaceAll", "search", "some", "startsWith", "substring",
  "substr", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase", "trim",
  "trimEnd", "trimStart", "toFixed", "toPrecision", "toExponential", "toString",
  "toLocaleString",
]);
/** Built-in array methods whose result is an array of the receiver's elements. */
const SAME_ARRAY_METHODS = new Set(["filter", "slice", "concat", "reverse", "sort", "toReversed", "toSorted", "toSpliced"]);

/** Built-in constructors (`new C(…)`): no scrml code except through their arguments. */
const BUILTIN_CONSTRUCTORS = new Set([
  "Date", "Map", "Set", "WeakMap", "WeakSet", "Array", "Error", "RegExp", "URL",
  "URLSearchParams", "Promise", "Uint8Array", "Int32Array", "Float64Array",
]);

// ---------------------------------------------------------------------------
// Scope resolution (F2).
// ---------------------------------------------------------------------------

type Res =
  | { kind: "fn"; decl: Rec }
  | { kind: "value"; shape: () => ValueShape }
  | { kind: "global" };

const GLOBAL: Res = { kind: "global" };
const UNKNOWN_VALUE: Res = { kind: "value", shape: () => UNKNOWN_SHAPE };

class Scope {
  readonly names = new Map<string, Res>();
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): Res | null {
    for (let s: Scope | null = this; s; s = s.parent) {
      const r = s.names.get(name);
      if (r) return r;
    }
    return null;
  }
  /** Declare `name`; a second, different declaration in the same scope is ambiguous. */
  declare(name: string, res: Res): void {
    const prior = this.names.get(name);
    if (prior && !(prior.kind === "fn" && res.kind === "fn" && prior.decl === res.decl)) {
      this.names.set(name, UNKNOWN_VALUE);
      return;
    }
    this.names.set(name, res);
  }
}

/** Every bound name in a destructuring pattern (or a plain name). */
function patternNames(p: unknown, out: string[] = []): string[] {
  if (typeof p === "string") { if (/^[A-Za-z_$][\w$]*$/.test(p)) out.push(p); return out; }
  if (!p || typeof p !== "object") return out;
  if (Array.isArray(p)) { for (const x of p) patternNames(x, out); return out; }
  const r = p as Rec;
  for (const k of Object.keys(r)) {
    if (k === "span" || k === "kind" || k === "defaultExpr" || k === "default") continue;
    const v = r[k];
    if (typeof v === "string" && (k === "name" || k === "local" || k === "alias" || k === "binding")) patternNames(v, out);
    else if (v && typeof v === "object") patternNames(v, out);
  }
  return out;
}

const VALUE_DECL_KINDS = new Set(["const-decl", "let-decl", "lin-decl", "tilde-decl"]);

// ---------------------------------------------------------------------------
// The per-file context.
// ---------------------------------------------------------------------------

export interface WriteSetOptions {
  /** The tracked narrowed place an expression denotes (a key), or null. */
  receiverKey(node: unknown): string | null;
  /** The shape of a written type (`string`, `User | not`, `int[]`, …), or null if unknown. */
  typeShape?(annotation: string): ValueShape | null;
}

interface Ctx {
  wopts: WriteSetOptions;
  /** Each identifier node → what it resolves to. */
  resolution: WeakMap<object, Res>;
  /** Each file-level cell → its shape. */
  cellShapes: Map<string, () => ValueShape>;
  /** Each function declaration → its write set (the fixpoint's current answer). */
  writeSets: Map<Rec, NarrowEnds>;
  /** The `endsWithin` options in force (a fresh object per fixpoint pass = fresh memo). */
  opts: { endsAt: (n: Rec) => string[] | "all" | null };
}

/**
 * Build the `endsAt` answer for one file: resolve every name through scope, compute the
 * write sets of the file's functions (least fixpoint, `"all"` absorbing), then answer.
 */
export function buildNarrowingEndsAt(topNodes: unknown[], wopts: WriteSetOptions): (node: Rec) => string[] | "all" | null {
  const ownEnds = (n: Rec): string[] | "all" | null => ownWrite(n, ctx);
  const ctx: Ctx = { wopts, resolution: new WeakMap(), cellShapes: new Map(), writeSets: new Map(), opts: { endsAt: ownEnds } };
  const annShape = (ann: string): ValueShape => {
    try { return wopts.typeShape?.(ann) ?? syntacticShape(ann); } catch { return syntacticShape(ann); }
  };

  // --- cells (file-level `state-decl`s) and the file scope ---------------------------
  const root = new Scope(null);
  const fnDecls: Rec[] = [];
  const declareList = (list: unknown[], scope: Scope): void => {
    for (const el of list) {
      const r = el as Rec | undefined;
      if (!r || typeof r !== "object") continue;
      if (r.kind === "function-decl" && typeof r.name === "string") scope.declare(r.name, { kind: "fn", decl: r });
      else if (typeof r.kind === "string" && VALUE_DECL_KINDS.has(r.kind)) {
        const names = patternNames(r.name);
        const single = typeof r.name === "string";
        const ann = typeof r.typeAnnotation === "string" ? r.typeAnnotation : null;
        for (const nm of names) {
          scope.declare(nm, single
            ? { kind: "value", shape: lazyShape(() => (ann ? annShape(ann) : shapeOfExpr(r.initExpr, ctx))) }
            : UNKNOWN_VALUE);
        }
      } else if (r.kind === "import-decl") {
        for (const nm of patternNames(r)) scope.declare(nm, UNKNOWN_VALUE);
      }
    }
  };
  // The file scope: every declaration reachable without entering a function or lambda
  // (top-level logic blocks are one namespace; a handler in markup sees them).
  const collectFile = (n: unknown, inFn: boolean): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      if (!inFn) declareList(n, root);
      for (const x of n) collectFile(x, inFn);
      return;
    }
    const r = n as Rec;
    if (r.kind === "function-decl") fnDecls.push(r);
    if (!inFn && r.kind === "state-decl" && typeof r.name === "string" && r._isReactiveAssign !== true) {
      const ann = typeof r.typeAnnotation === "string" ? r.typeAnnotation : null;
      const shape = lazyShape(() => (ann ? annShape(ann) : shapeOfExpr(r.initExpr, ctx)));
      ctx.cellShapes.set(r.name, ctx.cellShapes.has(r.name) ? () => UNKNOWN_SHAPE : shape);
    }
    if (!inFn && Array.isArray(r.imports)) for (const imp of r.imports) for (const nm of patternNames(imp)) root.declare(nm, UNKNOWN_VALUE);
    const enters = r.kind === "function-decl" || r.kind === "lambda";
    for (const k of Object.keys(r)) {
      if (k === "span") continue;
      const v = r[k];
      if (v && typeof v === "object") collectFile(v, inFn || enters);
    }
  };
  collectFile(topNodes, false);

  // --- resolve every identifier --------------------------------------------------------
  const declareParams = (params: unknown, scope: Scope): void => {
    if (!Array.isArray(params)) return;
    for (const p of params) {
      const pr = p as Rec | undefined;
      if (!pr) continue;
      const ann = typeof pr.typeAnnotation === "string" ? pr.typeAnnotation : null;
      const names = Array.isArray(pr.boundNames) ? (pr.boundNames as string[]) : patternNames(pr.name);
      for (const nm of names) {
        scope.declare(nm, ann && names.length === 1 ? { kind: "value", shape: lazyShape(() => annShape(ann)) } : UNKNOWN_VALUE);
      }
    }
  };
  const walk = (n: unknown, scope: Scope): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      const s = new Scope(scope);
      declareList(n, s);
      for (const x of n) walk(x, s);
      return;
    }
    const r = n as Rec;
    if (r.kind === "ident" && typeof r.name === "string") {
      if (!r.name.startsWith("@")) ctx.resolution.set(r, scope.lookup(r.name) ?? GLOBAL);
      return;
    }
    if (r.kind === "function-decl" || r.kind === "lambda") {
      const fs = new Scope(scope);
      declareParams(r.params, fs);
      for (const p of (r.params as Rec[] | undefined) ?? []) walk((p as Rec)?.defaultValue, scope);
      const body = r.body as Rec | unknown[] | undefined;
      if (Array.isArray(body)) walk(body, fs);
      else if (body && typeof body === "object") {
        const b = body as Rec;
        if (b.kind === "block") walk(b.stmts, fs);
        else if (b.kind === "expr") walk(b.value, fs);
        else walk(b, fs);
      }
      return;
    }
    if (r.kind === "for-stmt" || r.kind === "for-expr") {
      walk(r.iterExpr, scope);
      const fs = new Scope(scope);
      const iter = r.iterExpr;
      for (const nm of patternNames(r.variable)) {
        fs.declare(nm, typeof r.variable === "string"
          ? { kind: "value", shape: lazyShape(() => shapeOfExpr(iter, ctx).element() ?? UNKNOWN_SHAPE) }
          : UNKNOWN_VALUE);
      }
      walk(r.cStyleParts, fs);
      walk(r.body, fs);
      return;
    }
    if (typeof r.header === "string" && Array.isArray(r.body) && typeof r.kind !== "string") {
      // a `catch (e) { … }` node: its header binds names
      const cs = new Scope(scope);
      for (const nm of r.header.match(/[A-Za-z_$][\w$]*/g) ?? []) cs.declare(nm, UNKNOWN_VALUE);
      walk(r.body, cs);
      return;
    }
    let inner = scope;
    if (Array.isArray(r.payloadBindings) && r.payloadBindings.length > 0) {
      inner = new Scope(scope);
      for (const nm of patternNames(r.payloadBindings)) inner.declare(nm, UNKNOWN_VALUE);
    }
    for (const k of Object.keys(r)) {
      if (k === "span") continue;
      const v = r[k];
      if (v && typeof v === "object") walk(v, inner);
    }
  };
  walk(topNodes, root);

  // --- write sets: least fixpoint over the function declarations ----------------------
  for (const d of fnDecls) ctx.writeSets.set(d, new Set<string>());
  let changed = true;
  let pass = 0;
  while (changed) {
    if (pass++ > fnDecls.length + 2) {
      // A pass count past any call-chain length cannot happen; if it did, fail closed.
      for (const d of fnDecls) ctx.writeSets.set(d, "all");
      break;
    }
    changed = false;
    ctx.opts = { endsAt: ownEnds };
    for (const d of fnDecls) {
      const ws = mayWriteWithin(d.body, ctx.opts);
      if (!sameEnds(ws, ctx.writeSets.get(d)!)) { ctx.writeSets.set(d, ws); changed = true; }
    }
  }
  ctx.opts = { endsAt: ownEnds };
  return ownEnds;
}

/** A memoised, cycle-safe lazy shape. */
function lazyShape(f: () => ValueShape): () => ValueShape {
  let state: 0 | 1 | 2 = 0;
  let value: ValueShape = UNKNOWN_SHAPE;
  return () => {
    if (state === 2) return value;
    if (state === 1) return UNKNOWN_SHAPE;   // a cycle — unknown
    state = 1;
    value = f();
    state = 2;
    return value;
  };
}

function sameEnds(a: NarrowEnds, b: NarrowEnds): boolean {
  if (a === "all" || b === "all") return a === b;
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

function toAnswer(e: NarrowEnds): string[] | "all" | null {
  if (e === "all") return "all";
  return e.size === 0 ? null : [...e];
}

function unparen(x: unknown): Rec | undefined {
  let r = x as Rec | undefined;
  while (r && r.kind === "paren" && r.expr) r = r.expr as Rec;
  return r;
}

/** Is `node` a global (unshadowed) identifier named one of `names`? */
function globalNamed(node: Rec | undefined, names: Set<string>, ctx: Ctx): string | null {
  if (!node || node.kind !== "ident" || typeof node.name !== "string") return null;
  if (!names.has(node.name)) return null;
  return ctx.resolution.get(node) === GLOBAL ? node.name : null;
}

// ---------------------------------------------------------------------------
// Shapes of expressions.
// ---------------------------------------------------------------------------

function shapeOfExpr(e: unknown, ctx: Ctx): ValueShape {
  const r = unparen(e);
  if (!r || typeof r !== "object") return UNKNOWN_SHAPE;
  switch (r.kind) {
    case "lit":
      return PRIM_SHAPE;
    case "array": {
      const els = (r.elements as unknown[] | undefined) ?? [];
      if (els.length === 0) return arrayShape(UNKNOWN_SHAPE);
      let el = shapeOfExpr(els[0], ctx);
      for (const x of els.slice(1)) el = joinShapes(el, shapeOfExpr(x, ctx));
      return arrayShape(el);
    }
    case "object": {
      const props = (r.props as Rec[] | undefined) ?? [];
      const byKey = new Map<string, ValueShape>();
      let free = true;
      for (const p of props) {
        const s = shapeOfExpr(p?.value, ctx);
        if (!s.functionFree || p?.kind !== "prop" || p?.computed === true) free = false;
        if (typeof p?.key === "string") byKey.set(p.key, s);
      }
      return recordShape(free, (k) => byKey.get(k) ?? null);
    }
    case "ident": {
      const name = r.name as string;
      if (typeof name !== "string") return UNKNOWN_SHAPE;
      if (name.startsWith("@")) return ctx.cellShapes.get(name.slice(1))?.() ?? UNKNOWN_SHAPE;
      const res = ctx.resolution.get(r);
      if (!res || res.kind !== "value") return UNKNOWN_SHAPE;
      return res.shape();
    }
    case "member": {
      const obj = shapeOfExpr(r.object, ctx);
      return typeof r.property === "string" ? obj.field(r.property) ?? UNKNOWN_SHAPE : UNKNOWN_SHAPE;
    }
    case "index":
      return shapeOfExpr(r.object, ctx).element() ?? UNKNOWN_SHAPE;
    case "binary":
      if (r.op === "&&" || r.op === "||" || r.op === "??") return joinShapes(shapeOfExpr(r.left, ctx), shapeOfExpr(r.right, ctx));
      return PRIM_SHAPE;
    case "unary":
      return PRIM_SHAPE;
    case "ternary":
    case "conditional":
      return joinShapes(shapeOfExpr(r.consequent, ctx), shapeOfExpr(r.alternate, ctx));
    case "call": {
      const callee = unparen(r.callee);
      if (!callee) return UNKNOWN_SHAPE;
      if (callee.kind === "ident") {
        return globalNamed(callee, BUILTIN_FUNCTIONS, ctx) ? PRIM_SHAPE : UNKNOWN_SHAPE;
      }
      if (callee.kind === "member" && typeof callee.property === "string") {
        const obj = unparen(callee.object);
        const ns = globalNamed(obj, BUILTIN_NAMESPACES, ctx);
        if (ns === "Math" || ns === "Number") return PRIM_SHAPE;
        if (ns === "JSON" && callee.property === "stringify") return PRIM_SHAPE;
        if (ns) return UNKNOWN_SHAPE;
        const recv = shapeOfExpr(obj, ctx);
        if (!recv.builtinMethods || !BUILTIN_METHODS.has(callee.property)) return UNKNOWN_SHAPE;
        if (PRIM_RESULT_METHODS.has(callee.property)) return PRIM_SHAPE;
        if (callee.property === "split") return arrayShape(PRIM_SHAPE);
        if (SAME_ARRAY_METHODS.has(callee.property)) return arrayShape(recv.element() ?? UNKNOWN_SHAPE);
        return UNKNOWN_SHAPE;
      }
      return UNKNOWN_SHAPE;
    }
    default:
      return UNKNOWN_SHAPE;
  }
}

// ---------------------------------------------------------------------------
// What one node writes.
// ---------------------------------------------------------------------------

function ownWrite(n: Rec, ctx: Ctx): string[] | "all" | null {
  const key = (node: unknown): string[] | null => {
    const k = ctx.wopts.receiverKey(node);
    return k ? [k] : null;
  };
  switch (n.kind) {
    case "state-decl":
      // `@x = …` in a body (a declaration in a nested scope rebinds the place too).
      return typeof n.name === "string" ? key({ kind: "ident", name: "@" + n.name }) : null;
    case "reactive-assign":
      return typeof n.target === "string" ? key({ kind: "ident", name: "@" + n.target }) : null;
    case "assign":
    case "reset-expr":
      return key(n.target);
    case "call":
      return toAnswer(callWrites(n, ctx));
    case "new": {
      const callee = unparen(n.callee);
      if (globalNamed(callee, BUILTIN_CONSTRUCTORS, ctx)) return toAnswer(argWrites(n.args, ctx));
      return "all";
    }
    case "reactive-array-mutation": {
      // `@xs.push(…)` / `@xs.sort(cmp)`: a write UNDER the cell (ends nothing) — but a
      // function argument may be called (a comparator); F4 applies.
      const a = n.argsExpr;
      return toAnswer(argWrites(Array.isArray(a) ? a : a ? [a] : [], ctx));
    }
    case "escape-hatch": {
      // An expression the parser kept as text. A function expression only DEFINES (its
      // body runs when called). Anything else that could call or assign is unknown.
      const kind = n.nativeKind as string | undefined;
      if (kind === "ArrowFunctionExpression" || kind === "FunctionExpression") return null;
      const raw = typeof n.raw === "string" ? n.raw : "";
      return /\(|[^=!<>]=(?!=)|\+\+|--/.test(raw) ? "all" : null;
    }
    default:
      return null;
  }
}

/** The write set of one call. */
function callWrites(n: Rec, ctx: Ctx): NarrowEnds {
  const callee = unparen(n.callee);
  if (!callee) return "all";
  if (callee.kind === "ident" && typeof callee.name === "string") {
    if (callee.name.startsWith("@")) return "all";              // a cell holding a function
    const res = ctx.resolution.get(callee);
    if (res && res.kind === "fn") return ctx.writeSets.get(res.decl) ?? "all";
    if (res !== GLOBAL) return "all";                              // a parameter / local / import / unresolved
    if (SCHEDULING_FUNCTIONS.has(callee.name)) return new Set();   // runs later, not here
    if (BUILTIN_FUNCTIONS.has(callee.name)) return argWrites(n.args, ctx);
    return "all";                                                  // an unknown global
  }
  if (callee.kind === "member" && typeof callee.property === "string") {
    const obj = unparen(callee.object);
    if (globalNamed(obj, BUILTIN_NAMESPACES, ctx)) return argWrites(n.args, ctx);
    if (BUILTIN_METHODS.has(callee.property) && shapeOfExpr(obj, ctx).builtinMethods) return argWrites(n.args, ctx);
    return "all";                                                  // a method of an unknown receiver
  }
  return "all";                                                    // a call result, an IIFE, an index, …
}

/**
 * F4 — what a built-in may run through its arguments: every argument that is or may be a
 * function is assumed CALLED. A lambda contributes its body's may-write set; a function
 * reference its write set; an object / array literal what its members contribute; a
 * value whose shape is known function-free nothing; anything else is undetermined.
 */
function argWrites(args: unknown, ctx: Ctx): NarrowEnds {
  if (!Array.isArray(args)) return new Set();
  let acc: NarrowEnds = new Set();
  for (const a of args) {
    acc = unionEnds(acc, argEnds(a, ctx));
    if (acc === "all") return acc;
  }
  return acc;
}

function argEnds(a: unknown, ctx: Ctx): NarrowEnds {
  const r = unparen(a);
  if (!r || typeof r !== "object") return new Set();
  switch (r.kind) {
    case "spread":
      return argEnds(r.argument, ctx);
    case "lambda": {
      const body = r.body as Rec | undefined;
      const inner = body?.kind === "block" ? body.stmts : body?.kind === "expr" ? body.value : body;
      return mayWriteWithin(inner, ctx.opts);
    }
    case "escape-hatch":
      return "all";
    case "ident": {
      const name = r.name as string;
      if (typeof name === "string" && !name.startsWith("@")) {
        const res = ctx.resolution.get(r);
        if (res && res.kind === "fn") return ctx.writeSets.get(res.decl) ?? "all";
      }
      return shapeOfExpr(r, ctx).functionFree ? new Set() : "all";
    }
    case "object": {
      let acc: NarrowEnds = new Set();
      for (const p of (r.props as Rec[] | undefined) ?? []) {
        if (p?.kind !== "prop") return "all";
        acc = unionEnds(acc, argEnds(p.value, ctx));
        if (p.computed === true) acc = unionEnds(acc, argEnds(p.key, ctx));
        if (acc === "all") return acc;
      }
      return acc;
    }
    case "array": {
      let acc: NarrowEnds = new Set();
      for (const el of (r.elements as unknown[] | undefined) ?? []) {
        acc = unionEnds(acc, argEnds(el, ctx));
        if (acc === "all") return acc;
      }
      return acc;
    }
    case "lit":
      return new Set();
    default:
      return shapeOfExpr(r, ctx).functionFree ? new Set() : "all";
  }
}

