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
import { boundNamesOf } from "./binding-names.ts";

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Value shapes — what the compiler knows about a value, for F3 / F4.
// ---------------------------------------------------------------------------

/** What is known about a value. */
export interface ValueShape {
  /** A built-in method called on it runs no scrml code of its own (string, number, array, Date). */
  builtinMethods: boolean;
  /** It is not, and contains no, function (safe to hand to a built-in as data). */
  functionFree: boolean;
  /** It is provably never `not` (S462 Q10: a write of it re-narrows). */
  present: boolean;
  /** A field's shape, or null if unknown. */
  field(name: string): ValueShape | null;
  /** An element's shape (an array), or null if unknown. */
  element(): ValueShape | null;
}

export const UNKNOWN_SHAPE: ValueShape = { builtinMethods: false, functionFree: false, present: false, field: () => null, element: () => null };
export const FUNCTION_SHAPE: ValueShape = UNKNOWN_SHAPE;
export const PRIM_SHAPE: ValueShape = { builtinMethods: true, functionFree: true, present: true, field: () => PRIM_SHAPE, element: () => PRIM_SHAPE };
/** The value `not`. */
const NOT_SHAPE: ValueShape = { builtinMethods: false, functionFree: true, present: false, field: () => null, element: () => null };
/** A `Date` (`new Date(…)`): built-in methods, no function inside. */
const DATE_SHAPE: ValueShape = { builtinMethods: true, functionFree: true, present: true, field: () => null, element: () => null };

export function arrayShape(element: ValueShape): ValueShape {
  return {
    builtinMethods: true,
    functionFree: element.functionFree,
    present: true,
    field: (name) => (name === "length" ? PRIM_SHAPE : null),
    element: () => element,
  };
}

/** A value with known fields (a struct / object literal): no built-in methods. */
export function recordShape(functionFree: boolean, field: (name: string) => ValueShape | null, present = true): ValueShape {
  return { builtinMethods: false, functionFree, present, field, element: () => null };
}

/** The same shape, but possibly `not` (`T | not`). */
export function maybeAbsent(s: ValueShape): ValueShape {
  return s.present ? { ...s, present: false } : s;
}

function joinShapes(a: ValueShape, b: ValueShape): ValueShape {
  if (a === b) return a;
  return {
    builtinMethods: a.builtinMethods && b.builtinMethods,
    functionFree: a.functionFree && b.functionFree,
    present: a.present && b.present,
    field: () => null,
    element: () => null,
  };
}

const PRIM_TYPE_NAMES = new Set(["string", "int", "number", "float", "bool", "boolean", "bigint"]);

/** The syntactic reading of a type annotation, used when the consumer gives no type reader. */
function syntacticShape(annotation: string): ValueShape {
  const raw = annotation.replace(/\s+/g, "");
  const t = raw.replace(/^not\|/, "").replace(/\|not$/, "").replace(/\?$/, "");
  const absent = t !== raw;
  let s: ValueShape = UNKNOWN_SHAPE;
  if (PRIM_TYPE_NAMES.has(t)) s = PRIM_SHAPE;
  else if (t.endsWith("[]")) s = arrayShape(syntacticShape(t.slice(0, -2)));
  return absent ? maybeAbsent(s) : s;
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
  // Date
  "getTime", "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes",
  "getSeconds", "getMilliseconds", "getTimezoneOffset", "getUTCFullYear", "getUTCMonth",
  "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds",
  "toISOString", "toDateString", "toTimeString", "toLocaleDateString", "toLocaleTimeString",
  "toUTCString", "toJSON",
  // Promise
  "then", "catch", "finally",
]);

/**
 * S462 Q12 / N2a — array methods that CALL their function argument synchronously and do
 * not retain it. On a receiver KNOWN to be an array, a lambda passed to one keeps the
 * narrowing of its position, and its parameters get the element's shape.
 */
const SYNC_CALLBACK_METHODS = new Set([
  "map", "filter", "forEach", "find", "findIndex", "findLast", "findLastIndex", "some",
  "every", "reduce", "reduceRight", "flatMap", "sort", "toSorted",
]);

/** Built-in methods whose result is a primitive (string / number / boolean). */
const PRIM_RESULT_METHODS = new Set([
  "at", "charAt", "charCodeAt", "codePointAt", "endsWith", "every", "findIndex", "findLastIndex",
  "includes", "indexOf", "join", "lastIndexOf", "localeCompare", "normalize", "padEnd",
  "padStart", "repeat", "replace", "replaceAll", "search", "some", "startsWith", "substring",
  "substr", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase", "trim",
  "trimEnd", "trimStart", "toFixed", "toPrecision", "toExponential", "toString",
  "toLocaleString",
  "getTime", "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes",
  "getSeconds", "getMilliseconds", "getTimezoneOffset", "getUTCFullYear", "getUTCMonth",
  "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds",
  "toISOString", "toDateString", "toTimeString", "toLocaleDateString", "toLocaleTimeString",
  "toUTCString", "toJSON",
]);
/** Built-in array methods whose result is an array of the receiver's elements. */
const SAME_ARRAY_METHODS = new Set(["filter", "slice", "concat", "reverse", "sort", "toReversed", "toSorted", "toSpliced"]);

/** `new Date(…)` — its result is a known built-in receiver (N2b). */
const DATE_CTOR = new Set(["Date"]);

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
  | { kind: "value"; shape: () => ValueShape; src?: unknown }
  | { kind: "global" };

const GLOBAL: Res = { kind: "global" };
const UNKNOWN_VALUE: Res = { kind: "value", shape: () => UNKNOWN_SHAPE };

class Scope {
  readonly names = new Map<string, Res>();
  /** A scope whose bindings could not be read (an escape-hatch arrow's parameters). */
  opaque = false;
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): Res | null {
    for (let s: Scope | null = this; s; s = s.parent) {
      const r = s.names.get(name);
      if (r) return r;
      if (s.opaque) return UNKNOWN_VALUE;   // it may be one of the unread parameters
    }
    return null;
  }
  /** Declare `name`; a second, different declaration in the same scope is ambiguous. */
  declare(name: string, res: Res): void {
    const prior = this.names.get(name);
    const same = prior && ((prior.kind === "fn" && res.kind === "fn" && prior.decl === res.decl)
      || (prior.kind === "value" && res.kind === "value" && prior.src !== undefined && prior.src === res.src));
    if (prior && !same) {
      this.names.set(name, UNKNOWN_VALUE);
      return;
    }
    this.names.set(name, res);
  }
}

/** The names an import binds locally. */
function importNames(imp: unknown): string[] {
  const r = imp as Rec | undefined;
  if (!r || typeof r !== "object") return [];
  const out: string[] = [];
  if (Array.isArray(r.names)) for (const n of r.names) if (typeof n === "string") out.push(n);
  if (Array.isArray(r.specifiers)) for (const sp of r.specifiers as Rec[]) if (typeof sp?.local === "string") out.push(sp.local as string);
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
  /**
   * The statements of a block-bodied arrow the parser kept as an escape hatch — the SAME
   * expansion (the same objects) the narrowing walk reads, so names inside resolve.
   */
  expandOpaque?(node: Rec): unknown[] | null;
}

/** The per-file answers the §42.3.5 reader asks for (presence-narrowing.ts options). */
export interface NarrowingWriteSet {
  /** What evaluating one node writes (its own effect). */
  endsAt(node: Rec): string[] | "all" | null;
  /** S462 Q10 — the receivers a statement re-narrows (a write of a provably present value). */
  narrowsAt(stmt: Rec): string[];
  /** S462 Q12 — is argument `index` of `call` a lambda a known built-in calls synchronously? */
  syncCallbackArg(call: Rec, index: number): boolean;
  /** A sentence naming the node and why it ends a narrowing (for the diagnostic). */
  describeEnd(node: Rec, key: string): string;
}

interface Ctx {
  wopts: WriteSetOptions;
  /** Each identifier node → what it resolves to. */
  resolution: WeakMap<object, Res>;
  /** Each file-level cell → its shape. */
  cellShapes: Map<string, () => ValueShape>;
  /** Each function declaration → its write set (the fixpoint's current answer). */
  writeSets: Map<Rec, NarrowEnds>;
  /** Function declarations whose call SUSPENDS (a compiler-inserted await) — S462 Q11. */
  suspends: Set<Rec>;
  /** The `endsWithin` options in force (a fresh object per fixpoint pass = fresh memo). */
  opts: { endsAt: (n: Rec) => string[] | "all" | null };
  /** Parsed type annotations. */
  annShape(ann: string): ValueShape;
}

/** The parameter list of an arrow / function kept as escape-hatch text, or null. */
function escapeParams(raw: string): string | null {
  const t = raw.trim().replace(/^async\s+/, "");
  const fn = /^function\s*\*?\s*[A-Za-z_$]?[\w$]*\s*\(([\s\S]*?)\)\s*\{/.exec(t);
  if (fn) return fn[1];
  const paren = /^\(([\s\S]*?)\)\s*=>/.exec(t);
  if (paren) return paren[1];
  const single = /^([A-Za-z_$][\w$]*)\s*=>/.exec(t);
  if (single) return single[1];
  return null;
}

/**
 * Build the per-file answers: resolve every name through scope, compute the write sets
 * of the file's functions (least fixpoint, `"all"` absorbing), then answer.
 */
export function buildNarrowingEndsAt(topNodes: unknown[], wopts: WriteSetOptions): NarrowingWriteSet {
  const ownEnds = (n: Rec): string[] | "all" | null => ownWrite(n, ctx);
  const ctx: Ctx = {
    wopts, resolution: new WeakMap(), cellShapes: new Map(), writeSets: new Map(), suspends: new Set(),
    opts: { endsAt: ownEnds },
    annShape: (ann: string): ValueShape => {
      try { return wopts.typeShape?.(ann) ?? syntacticShape(ann); } catch { return syntacticShape(ann); }
    },
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
        const names = boundNamesOf(r.name);
        const single = typeof r.name === "string";
        const ann = typeof r.typeAnnotation === "string" ? r.typeAnnotation : null;
        for (const nm of names) {
          scope.declare(nm, single
            ? { kind: "value", src: r, shape: lazyShape(() => (ann ? ctx.annShape(ann) : shapeOfExpr(r.initExpr, ctx))) }
            : { kind: "value", src: r, shape: () => UNKNOWN_SHAPE });
        }
      } else if (r.kind === "import-decl") {
        for (const nm of importNames(r)) scope.declare(nm, { kind: "value", src: r, shape: () => UNKNOWN_SHAPE });
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
      const shape = lazyShape(() => (ann ? ctx.annShape(ann) : shapeOfExpr(r.initExpr, ctx)));
      ctx.cellShapes.set(r.name, ctx.cellShapes.has(r.name) ? () => UNKNOWN_SHAPE : shape);
    }
    if (!inFn && Array.isArray(r.imports)) {
      for (const imp of r.imports) for (const nm of importNames(imp)) root.declare(nm, { kind: "value", src: imp, shape: () => UNKNOWN_SHAPE });
    }
    const enters = r.kind === "function-decl" || r.kind === "lambda";
    for (const k of Object.keys(r)) {
      if (k === "span") continue;
      const v = r[k];
      if (v && typeof v === "object") collectFile(v, inFn || enters);
    }
  };
  collectFile(topNodes, false);

  // --- resolve every identifier --------------------------------------------------------
  /** N2a — the parameter shapes a known array method gives its callback. */
  const paramHints = new WeakMap<object, ValueShape[]>();
  const declareParams = (params: unknown, scope: Scope, hints: ValueShape[] | undefined): void => {
    if (!Array.isArray(params)) return;
    params.forEach((p, i) => {
      const pr = p as Rec | undefined;
      if (!pr) return;
      const ann = typeof pr.typeAnnotation === "string" ? pr.typeAnnotation : null;
      const names = boundNamesOf(pr);
      const hint = hints?.[i];
      for (const nm of names) {
        if (ann && names.length === 1) scope.declare(nm, { kind: "value", src: pr, shape: lazyShape(() => ctx.annShape(ann)) });
        else if (hint && names.length === 1 && typeof pr.name === "string") scope.declare(nm, { kind: "value", src: pr, shape: () => hint });
        else scope.declare(nm, { kind: "value", src: pr, shape: () => UNKNOWN_SHAPE });
      }
    });
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
    if (r.kind === "call" && Array.isArray(r.args)) {
      // N2a — a known array method's callback parameters get the element's shape.
      walk(r.callee, scope);
      const callee = unparen(r.callee);
      if (callee && callee.kind === "member" && typeof callee.property === "string" && SYNC_CALLBACK_METHODS.has(callee.property)) {
        const method = callee.property;
        const recvExpr = callee.object;
        const el = lazyShape(() => {
          const recv = shapeOfExpr(recvExpr, ctx);
          return recv.builtinMethods ? recv.element() ?? UNKNOWN_SHAPE : UNKNOWN_SHAPE;
        });
        const lazyEl: ValueShape = {
          get builtinMethods() { return el().builtinMethods; },
          get functionFree() { return el().functionFree; },
          get present() { return el().present; },
          field: (k) => el().field(k),
          element: () => el().element(),
        };
        const hints = method === "reduce" || method === "reduceRight"
          ? [UNKNOWN_SHAPE, lazyEl, PRIM_SHAPE]
          : method === "sort" || method === "toSorted" ? [lazyEl, lazyEl] : [lazyEl, PRIM_SHAPE];
        for (const a of r.args as unknown[]) if (a && typeof a === "object" && (a as Rec).kind === "lambda") paramHints.set(a as object, hints);
      }
      for (const a of r.args as unknown[]) walk(a, scope);
      for (const k of Object.keys(r)) {
        if (k === "span" || k === "callee" || k === "args") continue;
        const v = r[k];
        if (v && typeof v === "object") walk(v, scope);
      }
      return;
    }
    if (r.kind === "function-decl" || r.kind === "lambda") {
      const fs = new Scope(scope);
      declareParams(r.params, fs, paramHints.get(r));
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
    if (r.kind === "escape-hatch" && wopts.expandOpaque) {
      // A block-bodied arrow kept as text: resolve the statements the walk will read. Its
      // parameters shadow; if they cannot be read, every name inside is unknown.
      const stmts = wopts.expandOpaque(r);
      if (stmts) {
        const fs = new Scope(scope);
        const params = typeof r.raw === "string" ? escapeParams(r.raw) : null;
        if (params === null) fs.opaque = true;
        else for (const nm of boundNamesOf(params)) fs.declare(nm, { kind: "value", src: r, shape: () => UNKNOWN_SHAPE });
        walk(stmts, fs);
      }
      return;
    }
    if (r.kind === "for-stmt" || r.kind === "for-expr") {
      walk(r.iterExpr, scope);
      const fs = new Scope(scope);
      const iter = r.iterExpr;
      for (const nm of boundNamesOf(r.variable)) {
        fs.declare(nm, typeof r.variable === "string"
          ? { kind: "value", src: r, shape: lazyShape(() => shapeOfExpr(iter, ctx).element() ?? UNKNOWN_SHAPE) }
          : { kind: "value", src: r, shape: () => UNKNOWN_SHAPE });
      }
      walk(r.cStyleParts, fs);
      walk(r.body, fs);
      return;
    }
    if (typeof r.header === "string" && Array.isArray(r.body) && typeof r.kind !== "string") {
      // a `catch (e) { … }` node: its header binds names
      const cs = new Scope(scope);
      for (const nm of r.header.match(/[A-Za-z_$][\w$]*/g) ?? []) cs.declare(nm, { kind: "value", src: r, shape: () => UNKNOWN_SHAPE });
      walk(r.body, cs);
      return;
    }
    let inner = scope;
    if (Array.isArray(r.payloadBindings) && r.payloadBindings.length > 0) {
      inner = new Scope(scope);
      for (const nm of boundNamesOf(r.payloadBindings)) inner.declare(nm, { kind: "value", src: r, shape: () => UNKNOWN_SHAPE });
    }
    for (const k of Object.keys(r)) {
      if (k === "span") continue;
      const v = r[k];
      if (v && typeof v === "object") walk(v, inner);
    }
  };
  walk(topNodes, root);

  // --- S462 Q11: which functions SUSPEND when called (a compiler-inserted await) -------
  // A server function, an `async` one, or one whose body (not a nested function or
  // lambda) awaits, yields, or calls a suspending function. Least fixpoint.
  const bodySuspends = (n: unknown): boolean => {
    if (!n || typeof n !== "object") return false;
    if (Array.isArray(n)) return n.some(bodySuspends);
    const r = n as Rec;
    if (r.kind === "function-decl" || r.kind === "lambda" || r.kind === "escape-hatch") return false;
    if (isSuspensionNode(r, ctx)) return true;
    for (const k of Object.keys(r)) {
      if (k === "span") continue;
      const v = r[k];
      if (v && typeof v === "object" && bodySuspends(v)) return true;
    }
    return false;
  };
  for (const d of fnDecls) if (d.isServer === true || d.isAsync === true) ctx.suspends.add(d);
  for (let grew = true; grew;) {
    grew = false;
    for (const d of fnDecls) {
      if (!ctx.suspends.has(d) && bodySuspends(d.body)) { ctx.suspends.add(d); grew = true; }
    }
  }

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

  return {
    endsAt: ownEnds,
    narrowsAt: (stmt) => narrowsAgain(stmt, ctx),
    syncCallbackArg: (call, index) => {
      const callee = unparen(call.callee);
      const arg = (call.args as unknown[] | undefined)?.[index] as Rec | undefined;
      if (!arg || arg.kind !== "lambda") return false;
      if (!callee || callee.kind !== "member" || typeof callee.property !== "string") return false;
      if (!SYNC_CALLBACK_METHODS.has(callee.property)) return false;
      return shapeOfExpr(callee.object, ctx).builtinMethods;
    },
    describeEnd: (node, key) => describeEnd(node, key, ctx),
  };
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
      return r.litType === "not" ? NOT_SHAPE : PRIM_SHAPE;
    case "new":
      return globalNamed(unparen(r.callee), DATE_CTOR, ctx) ? DATE_SHAPE : UNKNOWN_SHAPE;
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
        if (globalNamed(callee, BUILTIN_FUNCTIONS, ctx)) return PRIM_SHAPE;
        // N2c — a function of the file with a DECLARED return type.
        const res = ctx.resolution.get(callee);
        if (res && res.kind === "fn" && typeof res.decl.returnTypeAnnotation === "string" && res.decl.returnTypeAnnotation.trim() !== "") {
          return ctx.annShape(res.decl.returnTypeAnnotation);
        }
        return UNKNOWN_SHAPE;
      }
      if (callee.kind === "member" && typeof callee.property === "string") {
        const obj = unparen(callee.object);
        const ns = globalNamed(obj, BUILTIN_NAMESPACES, ctx);
        if (ns === "Math" || ns === "Number") return PRIM_SHAPE;
        if (ns === "Date" && callee.property === "now") return PRIM_SHAPE;
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
    case "unary":
      // S462 Q11 — an explicit `await` is a suspension point.
      return n.op === "await" ? "all" : null;
    case "yield-stmt":
      return "all";
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
    if (res && res.kind === "fn") {
      // S462 Q11 — a call the compiler awaits is a suspension point: another handler
      // may write any cell meanwhile.
      if (ctx.suspends.has(res.decl)) return "all";
      return ctx.writeSets.get(res.decl) ?? "all";
    }
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


// ---------------------------------------------------------------------------
// S462 Q11 / Q10 / the diagnostic.
// ---------------------------------------------------------------------------

/** Is this node itself a suspension point (an `await`, a `yield`, a call the compiler awaits)? */
function isSuspensionNode(r: Rec, ctx: Ctx): boolean {
  if (r.kind === "unary" && r.op === "await") return true;
  if (r.kind === "yield-stmt") return true;
  if (r.kind === "call") {
    const callee = unparen(r.callee);
    if (callee && callee.kind === "ident") {
      const res = ctx.resolution.get(callee);
      if (res && res.kind === "fn" && ctx.suspends.has(res.decl)) return true;
    }
  }
  return false;
}

/**
 * S462 Q10 ("a") — "a write whose value is provably present (a struct/object literal, a
 * value of a non-optional type) narrows the place again from that point." A statement
 * that is a plain `=` write of the place with such a value.
 */
function narrowsAgain(stmt: Rec, ctx: Ctx): string[] {
  const key = (place: unknown): string | null => ctx.wopts.receiverKey(place);
  let place: unknown = null;
  let value: unknown = null;
  if (stmt.kind === "state-decl" && typeof stmt.name === "string" && stmt._isReactiveAssign === true) {
    place = { kind: "ident", name: "@" + stmt.name };
    value = stmt.initExpr;
  } else if (stmt.kind === "reactive-assign" && typeof stmt.target === "string") {
    place = { kind: "ident", name: "@" + stmt.target };
    value = stmt.valueExpr;
  } else if (stmt.kind === "bare-expr") {
    const e = unparen(stmt.exprNode);
    if (e && e.kind === "assign" && e.op === "=") { place = e.target; value = e.value; }
  }
  if (!place || !value) return [];
  const k = key(place);
  if (!k) return [];
  return shapeOfExpr(value, ctx).present ? [k] : [];
}

/** A short source-like label for a node (`w.trim()`, `clear()`, `@user = …`). */
function labelOf(n: unknown, depth = 0): string {
  const r = unparen(n);
  if (!r || depth > 6) return "…";
  switch (r.kind) {
    case "ident": return String(r.name);
    case "member": return `${labelOf(r.object, depth + 1)}${r.optional === true ? "?." : "."}${String(r.property)}`;
    case "index": return `${labelOf(r.object, depth + 1)}[…]`;
    case "call": return `${labelOf(r.callee, depth + 1)}(${Array.isArray(r.args) && r.args.length > 0 ? "…" : ""})`;
    case "new": return `new ${labelOf(r.callee, depth + 1)}(…)`;
    case "unary": return r.op === "await" ? `await ${labelOf(r.argument, depth + 1)}` : "…";
    case "yield-stmt": return "yield";
    case "state-decl": return `@${String(r.name)} = …`;
    case "reactive-assign": return `@${String(r.target)} = …`;
    case "assign": return `${labelOf(r.target, depth + 1)} ${String(r.op ?? "=")} …`;
    case "reset-expr": return `reset(${labelOf(r.target, depth + 1)})`;
    case "escape-hatch": return typeof r.raw === "string" && r.raw.length <= 40 ? r.raw : "an expression kept as text";
    default: return "…";
  }
}

/** Why this node ends the narrowing of `key` — named, with the actual reason. */
function describeEnd(n: Rec, key: string, ctx: Ctx): string {
  const at = "`" + labelOf(n) + "`";
  const cell = "`@" + key + "`";
  switch (n.kind) {
    case "state-decl":
    case "reactive-assign":
    case "assign":
    case "reset-expr":
      return `${at} writes ${cell}`;
    case "unary":
      return `${at} is a suspension point — while it waits, another handler may write ${cell}`;
    case "yield-stmt":
      return `\`yield\` is a suspension point — while it waits, another handler may write ${cell}`;
    case "new":
      return `${at} constructs with a constructor the compiler does not know, so its writes cannot be determined`;
    case "escape-hatch":
      return `${at} is an expression the compiler cannot read, so its writes cannot be determined`;
    case "reactive-array-mutation":
    case "call": {
      if (n.kind === "reactive-array-mutation") return `\`@${String(n.target)}.${String(n.method)}(…)\` is handed a function it may call, whose writes cannot be determined`;
      const callee = unparen(n.callee);
      if (callee && callee.kind === "ident" && typeof callee.name === "string") {
        if (callee.name.startsWith("@")) return `${at} calls a function held in a cell — its writes cannot be determined`;
        const res = ctx.resolution.get(callee);
        if (res && res.kind === "fn") {
          if (ctx.suspends.has(res.decl)) {
            const what = res.decl.isServer === true
              ? "is a server call (the compiler awaits it)"
              : "suspends (it awaits — a server call or an `await` inside it — so the compiler awaits the call)";
            return `${at} ${what} — a suspension point: while it waits, another handler may write ${cell}`;
          }
          const ws = ctx.writeSets.get(res.decl);
          return ws === "all"
            ? `${at} makes a call whose writes cannot be determined`
            : `${at} writes ${cell}`;
        }
        if (res && res.kind === "value") return `${at} calls a function VALUE (a parameter or a local) — its writes cannot be determined`;
        if (BUILTIN_FUNCTIONS.has(callee.name)) return `${at} is handed a value that may be a function it calls`;
        return `${at} calls an imported or unknown function — its writes cannot be determined`;
      }
      if (callee && callee.kind === "member" && typeof callee.property === "string") {
        const obj = unparen(callee.object);
        const builtin = globalNamed(obj, BUILTIN_NAMESPACES, ctx) !== null
          || (BUILTIN_METHODS.has(callee.property) && shapeOfExpr(obj, ctx).builtinMethods);
        if (builtin) return `${at} is handed a value that may be a function it calls (a lambda, a function, or a value of unknown type)`;
        return `${at} — the receiver's type is not known to be a built-in value, so \`.${callee.property}\` may be any function, whose writes cannot be determined`;
      }
      return `${at} calls the result of an expression — its writes cannot be determined`;
    }
    default:
      return `${at} ends it`;
  }
}
