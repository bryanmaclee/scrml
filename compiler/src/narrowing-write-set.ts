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
 * loops, definitions that run nothing — `endsWithin`). This module answers, for ONE
 * node, WHAT it writes (`endsAt`):
 *   - a direct write of the place: `@x = …` (a `state-decl` in a body), `x = …` / `x += …`
 *     (`assign`), `reset(@x)`;
 *   - a call of a function declared in this file: that function's WRITE SET — what its
 *     body writes, closed over the functions it calls (a least fixpoint);
 *   - a call of a built-in the compiler knows runs no scrml code of its own (a `Math.` /
 *     `JSON.` / `console.` namespace call, a built-in method such as `.map` / `.push` /
 *     `.trim`, a global such as `String(…)` / `parseInt(…)` / `setTimeout(…)`): what the
 *     function values handed to it write — a lambda's body, a named function's write set;
 *     a value whose write set is unknown in a callback position is unknown;
 *   - ANY OTHER CALL — through a parameter or local holding a function (`cb()`), a cell
 *     (`@f()`), an imported name, a call result, a method the compiler does not know, an
 *     escape-hatch expression — has a write set that cannot be determined: it ends EVERY
 *     narrowing in force (`"all"`). Fail closed.
 *
 * A write UNDER the place (`@x.f = …`, `@xs.push(…)`) changes the value, not whether it is
 * present; it ends nothing. A call cannot write a LOCAL (closure capture aside: a local
 * written by a nested function is reached only by calling that function, and such a
 * call through a value is already `"all"`).
 */

import { endsWithin, unionEnds, type NarrowEnds } from "./presence-narrowing.ts";

type Rec = Record<string, unknown>;

/** Globals whose CALL runs no scrml code except the function values passed to it. */
const BUILTIN_NAMESPACES = new Set([
  "Math", "JSON", "console", "Object", "Array", "Number", "String", "Boolean", "Date",
  "Promise", "Intl", "Symbol", "BigInt", "URL", "URLSearchParams", "crypto", "performance",
]);

/** Global functions: no scrml code of their own. */
const BUILTIN_FUNCTIONS = new Set([
  "String", "Number", "Boolean", "BigInt", "Symbol", "parseInt", "parseFloat", "isNaN",
  "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  "structuredClone", "clearTimeout", "clearInterval", "cancelAnimationFrame",
]);

/**
 * Globals that SCHEDULE a function to run later. The callback cannot run before the
 * current synchronous code finishes, so it writes nothing "from this point" here.
 */
const SCHEDULING_FUNCTIONS = new Set(["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);

/**
 * Built-in methods of the JavaScript value types scrml values lower to (array, string,
 * number, map, set, date, promise). A method call with one of these names runs no scrml
 * code except the function values passed to it.
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
  // Map / Set
  "get", "set", "has", "delete", "clear", "add",
  // Date
  "getTime", "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes",
  "getSeconds", "getMilliseconds", "getTimezoneOffset", "getUTCFullYear", "getUTCMonth",
  "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds",
  "toISOString", "toDateString", "toTimeString", "toLocaleDateString", "toLocaleTimeString",
  "toJSON",
  // Promise
  "then", "catch", "finally",
]);

/** Built-in constructors (`new C(…)`): no scrml code except the function values passed. */
const BUILTIN_CONSTRUCTORS = new Set([
  "Date", "Map", "Set", "WeakMap", "WeakSet", "Array", "Error", "RegExp", "URL",
  "URLSearchParams", "Promise", "Intl", "Uint8Array", "Int32Array", "Float64Array",
]);

/**
 * Methods / globals that CALL a function argument (a callback position). A value there
 * whose write set is unknown makes the call's write set unknown.
 */
const CALLBACK_METHODS = new Set([
  "every", "filter", "find", "findIndex", "findLast", "findLastIndex", "flatMap", "forEach",
  "map", "reduce", "reduceRight", "some", "sort", "toSorted", "replace", "replaceAll",
  "then", "catch", "finally", "from",
]);

export interface WriteSetOptions {
  /** The tracked narrowed place an expression denotes (a key), or null. */
  receiverKey(node: unknown): string | null;
}


/** One file's write-set context. */
interface Ctx {
  wopts: WriteSetOptions;
  /** Each function of the file, by name: its bodies (same-name functions joined). */
  fnBodies: Map<string, unknown[]>;
  /** Each function's write set (the fixpoint's current answer). */
  writeSets: Map<string, NarrowEnds>;
  /** The `endsWithin` options in force (a fresh object per fixpoint pass = fresh memo). */
  opts: { endsAt: (n: Rec) => string[] | "all" | null };
}

/**
 * Build the `endsAt` answer for one file: the write sets of the file's functions are
 * computed first (least fixpoint, `"all"` absorbing), then `endsAt` reads them.
 */
export function buildNarrowingEndsAt(topNodes: unknown[], wopts: WriteSetOptions): (node: Rec) => string[] | "all" | null {
  // Every function declared in the file, by name (same-name functions in different
  // scopes are joined — an over-approximation, so it only ends MORE narrowings).
  const fnBodies = new Map<string, unknown[]>();
  const collect = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) collect(x); return; }
    const r = n as Rec;
    if (r.kind === "function-decl" && typeof r.name === "string") {
      const list = fnBodies.get(r.name) ?? [];
      list.push(r.body);
      fnBodies.set(r.name, list);
    }
    for (const k of Object.keys(r)) {
      if (k === "span") continue;
      const v = r[k];
      if (v && typeof v === "object") collect(v);
    }
  };
  collect(topNodes);

  const ownEnds = (n: Rec): string[] | "all" | null => ownWrite(n, ctx);
  const ctx: Ctx = { wopts, fnBodies, writeSets: new Map(), opts: { endsAt: ownEnds } };
  for (const name of fnBodies.keys()) ctx.writeSets.set(name, new Set<string>());

  // Least fixpoint: each pass recomputes every function's write set from the sets so
  // far; sets only grow and `"all"` absorbs, so it terminates. A pass count past any
  // call-chain length cannot happen; if it did, every set becomes `"all"` (fail closed).
  let changed = true;
  let pass = 0;
  while (changed) {
    if (pass++ > fnBodies.size + 2) {
      for (const name of fnBodies.keys()) ctx.writeSets.set(name, "all");
      break;
    }
    changed = false;
    ctx.opts = { endsAt: ownEnds };
    for (const [name, bodies] of fnBodies) {
      let acc: NarrowEnds = new Set<string>();
      for (const b of bodies) acc = unionEnds(acc, endsWithin(b, ctx.opts));
      if (!sameEnds(acc, ctx.writeSets.get(name)!)) { ctx.writeSets.set(name, acc); changed = true; }
    }
  }
  ctx.opts = { endsAt: ownEnds };
  return ownEnds;
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

/** The node's OWN write (its operands are reached by `endsWithin`). */
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
      const callee = n.callee as Rec | undefined;
      const name = callee && callee.kind === "ident" ? callee.name as string : null;
      if (name && BUILTIN_CONSTRUCTORS.has(name)) return toAnswer(argValueWrites(n.args, true, ctx));
      return "all";
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
  let callee = n.callee as Rec | undefined;
  while (callee && callee.kind === "paren" && callee.expr) callee = callee.expr as Rec;
  if (!callee) return "all";
  if (callee.kind === "ident" && typeof callee.name === "string") {
    const name = callee.name;
    if (name.startsWith("@")) return "all";                       // a cell holding a function
    const ws = ctx.writeSets.get(name);
    if (ws) return ws;                                             // a function of this file
    if (SCHEDULING_FUNCTIONS.has(name)) return new Set();          // runs later, not here
    if (BUILTIN_FUNCTIONS.has(name)) return argValueWrites(n.args, false, ctx);
    return "all";                                                  // parameter / local / import / unknown
  }
  if (callee.kind === "member" && typeof callee.property === "string") {
    const obj = callee.object as Rec | undefined;
    const isNamespace = !!obj && obj.kind === "ident" && typeof obj.name === "string" && BUILTIN_NAMESPACES.has(obj.name);
    if (isNamespace || BUILTIN_METHODS.has(callee.property)) {
      return argValueWrites(n.args, CALLBACK_METHODS.has(callee.property), ctx);
    }
    return "all";
  }
  return "all";                                                    // a call result, an IIFE, an index, …
}

/**
 * What the function values passed to a built-in may write when it calls them: a
 * lambda's body, a named function's write set. In a CALLBACK position (`callbackPos`) a
 * value whose write set is unknown (a parameter, a local, a cell, an escape-hatch arrow,
 * a call result) makes the whole call unknown.
 */
function argValueWrites(args: unknown, callbackPos: boolean, ctx: Ctx): NarrowEnds {
  if (!Array.isArray(args)) return new Set();
  let acc: NarrowEnds = new Set();
  for (const a of args) {
    let r = a as Rec | undefined;
    while (r && r.kind === "paren" && r.expr) r = r.expr as Rec;
    if (!r) continue;
    if (r.kind === "lambda") {
      const body = r.body as Rec | undefined;
      const inner = body?.kind === "block" ? body.stmts : body?.kind === "expr" ? body.value : body;
      acc = unionEnds(acc, endsWithin(inner, ctx.opts));
    } else if (r.kind === "ident" && typeof r.name === "string" && ctx.writeSets.has(r.name)) {
      acc = unionEnds(acc, ctx.writeSets.get(r.name)!);
    } else if (callbackPos && (r.kind === "ident" || r.kind === "member" || r.kind === "index" || r.kind === "escape-hatch" || r.kind === "call")) {
      return "all";
    }
    if (acc === "all") return acc;
  }
  return acc;
}
