/**
 * @module codegen/js-async-analysis
 *
 * s441-async-escape-f4-f5 (SECURITY) — scope-aware async analysis of JavaScript
 * TEXT: a raw fragment the compiler emits verbatim, or an already-emitted body
 * (an inline event handler, an `on mount` block) that never went through the
 * structured function-body pipeline.
 *
 * ── WHY TEXT, AND WHY A PARSER ──────────────────────────────────────────────────
 * Three kinds of code reach the output with no scrml statement tree behind them:
 *
 *   1. a block-body callback / template literal / parameter default inside a
 *      function (`h => { return m(h) }` parses as an `escape-hatch` carrying raw
 *      text, emitted verbatim);
 *   2. an inline event-handler value (`onclick=${ if (isOk(1)) {…} }`), lowered
 *      through the string rewriter into `function(event) { … }`;
 *   3. an `on mount { … }` body — one raw `bare-expr` string (§6.7.1a).
 *
 * The scrml tree does not know what is inside them, so the question "which calls
 * here return a Promise, and where does each Promise go?" has to be asked of the
 * JavaScript. It is asked of acorn's tree, never of the characters: the previous
 * answers (`extractCalleeNames` over the raw text, a per-FILE name map) fired on
 * `"m(" + x`, on `o.m(x)`, on template TEXT, and on a different function's own
 * sync `m` (g-sync-callback-rawtext-scan-false-positives), and could not see a
 * Promise reach a sync consumer through a condition at all
 * (g-server-call-in-inline-handler-condition-unawaited: `if (isOk(1))` tested a
 * Promise — always truthy — so the branch ran for every input).
 *
 * ── WHAT IT COMPUTES ────────────────────────────────────────────────────────────
 * Lexical scopes (function / block / catch / loop, `var` hoisting, block-scoped
 * `function` declarations), then, for every identifier REFERENCE that resolves to
 * an async-colored function (a server fn, a Promise-returning stdlib export, a
 * transitively-async client fn, or a function declared in the fragment that calls
 * one):
 *
 *   - a CALL in an await-legal position     → `await` it (transform mode);
 *   - a CALL where `await` is impossible     → a fail-closed finding (the caller
 *     reports E-SERVER-FN-IN-SYNC-CALLBACK / E-ASYNC-STDLIB-IN-SYNC-CALLBACK);
 *   - the callback of a clean-family collection method (`.some`, `.filter`, …)
 *     → lifted to the sequential `_scrml_<m>Async` combinator (transform mode —
 *     the same lowering emit-expr applies to structured code);
 *   - the function passed as a VALUE anywhere else → an escape finding (S440 F4:
 *     E-ASYNC-FN-ESCAPES-AS-VALUE).
 *
 * In TRANSFORM mode a function declared in the fragment that reaches an async call
 * is emitted `async` (a fixpoint — `a → b → server fn` colors both), and the root
 * function (the handler / the mount block) becomes async when its body awaits.
 * In DIAGNOSE mode (verbatim raw fragments) nothing can be rewritten, so every
 * async call is a finding.
 *
 * On a parse failure every entry point returns `null`; callers keep their previous
 * behavior (a name-based scan that fails CLOSED), never a guess.
 */

import { parse as acornParse } from "acorn";
import { ASYNC_COMBINATOR_METHODS, KNOWN_DISCARD_HOF, SYNC_CALLBACK_CONSUMER_METHODS } from "./async-combinators.ts";
import type { AsyncRoot } from "./local-async-fns.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** How a name that is free in the fragment is async (or `null`: it is not). */
export interface ResolvedAsync {
  root: AsyncRoot;
  /**
   * True when the name resolves to a function declared INSIDE the enclosing scrml
   * function (a nested helper) or inside the fragment itself; false for a
   * file-scope / imported name. Consumers that already await outer names by other
   * means (a server template interpolation) filter on it.
   */
  local: boolean;
}

export type FreeAsyncResolver = ((name: string) => ResolvedAsync | null) & {
  /**
   * s441 fix round — is a name that is free in the fragment nevertheless BOUND by
   * the program (a file-scope fn / decl / import, or a binding of the scrml scope
   * the fragment sits in)? Only an unbound scheduler name is the global one.
   */
  isBound?: (name: string) => boolean;
};

/** An async call the compiler cannot await where it sits. */
export interface JsAsyncCall extends ResolvedAsync {
  /** The callee name, or `<method>(…) async-callback combinator` for a lifted call that is itself un-awaitable. */
  name: string;
}

/** An async-colored function used as a VALUE (S440 F4). */
export interface JsAsyncEscape extends ResolvedAsync {
  name: string;
  /** A short phrase naming the value position, for the diagnostic. */
  position: string;
}

export interface JsAsyncUses {
  calls: JsAsyncCall[];
  escapes: JsAsyncEscape[];
  /**
   * s441 fix round — `.then` / `.catch` / `.finally` read off a call the compiler
   * awaits: `(await f()).then(…)` calls `.then` on the RESOLVED value (a TypeError
   * for any non-thenable). Reported as E-ASYNC-CALL-PROMISE-METHOD.
   */
  promiseMethods?: Array<{ name: string; method: string }>;
  /**
   * s441 fix round — `event.preventDefault()` / `stopPropagation()` /
   * `stopImmediatePropagation()` placed after the handler's first `await`: by then
   * the browser has already run the default action / propagated the event.
   * Reported as E-EVENT-CONTROL-AFTER-AWAIT.
   */
  eventControlAfterAwait?: Array<{ method: string }>;
  /**
   * s441 fix round — the handler text could not be analysed (it does not parse)
   * and mentions these async-colored names: fail CLOSED
   * (E-ASYNC-HANDLER-UNANALYZABLE) rather than ship it unawaited.
   */
  unanalyzable?: Array<{ name: string }>;
}

export interface ColoredBody extends JsAsyncUses {
  /** The rewritten text (same shape as the input — statements, or one function expression). */
  code: string;
  /** True when the root (handler / mount block) must run async — its body awaits. */
  rootAsync: boolean;
}

// ---------------------------------------------------------------------------
// Scope model
// ---------------------------------------------------------------------------

/** A binding that is not a function declaration of the fragment. */
const OTHER: unique symbol = Symbol("other-binding");
type Binding = N | typeof OTHER;

interface Scope {
  parent: Scope | null;
  decls: Map<string, Binding>;
}

function newScope(parent: Scope | null): Scope {
  return { parent, decls: new Map() };
}

function lookup(name: string, scope: Scope | null): Binding | undefined {
  for (let s = scope; s; s = s.parent) {
    const b = s.decls.get(name);
    if (b !== undefined) return b;
  }
  return undefined;
}

const isFn = (n: N): boolean =>
  !!n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");

/** Every Identifier node a binding pattern declares (s441 round 4 — binding identity). */
function patternIdents(p: N, out: N[]): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.push(p); return;
    case "ObjectPattern":
      for (const prop of p.properties) patternIdents(prop.type === "RestElement" ? prop.argument : prop.value, out);
      return;
    case "ArrayPattern": for (const e of p.elements) patternIdents(e, out); return;
    case "RestElement": patternIdents(p.argument, out); return;
    case "AssignmentPattern": patternIdents(p.left, out); return;
    default: return;
  }
}

/** Bind every name a pattern declares to its own Identifier node. */
function declarePattern(p: N, scope: Scope): void {
  const ids: N[] = [];
  patternIdents(p, ids);
  for (const id of ids) scope.decls.set(id.name, id);
}

/** `var` declarator patterns hoisted to a function scope (not crossing nested functions). */
function hoistedVarPatterns(node: N, out: N[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const c of node) hoistedVarPatterns(c, out); return; }
  if (isFn(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression") return;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const d of node.declarations) out.push(d.id);
  }
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const v = node[key];
    if (v && typeof v === "object") hoistedVarPatterns(v, out);
  }
}

/** Lexical declarations made directly by a statement list (block-scoped). */
function declareBlock(stmts: N[], scope: Scope): void {
  for (const st of stmts) {
    if (!st) continue;
    if (st.type === "FunctionDeclaration" && st.id) scope.decls.set(st.id.name, st);
    else if (st.type === "ClassDeclaration" && st.id) scope.decls.set(st.id.name, OTHER);
    else if (st.type === "VariableDeclaration" && st.kind !== "var") {
      // s441 rounds 3-4 — every declared name binds to its own Identifier node (a
      // distinct binding identity: the event taint and the scheduler scope check
      // follow bindings, never names).
      for (const d of st.declarations) declarePattern(d.id, scope);
    }
  }
}

interface Resolution {
  /** Identifier REFERENCE node → its binding (`undefined` → free in the fragment). */
  refs: Map<N, Binding | undefined>;
  /** An Identifier ASSIGNMENT target (`x = …`, `x += …`, `[x] = …`) → the binding it writes. */
  assignTargets: Map<N, Binding | undefined>;
  /** Every FunctionDeclaration in the fragment. */
  fnDecls: N[];
}

/**
 * Resolve every identifier REFERENCE in `root` lexically. Declaration ids,
 * non-computed member properties / object keys and labels are not references.
 */
function resolveScopes(root: N, rootScope: Scope): Resolution {
  const refs = new Map<N, Binding | undefined>();
  const assignTargets = new Map<N, Binding | undefined>();
  const fnDecls: N[] = [];

  const visitPattern = (p: N, scope: Scope, isAssign = false): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier":
        if (isAssign) assignTargets.set(p, lookup(p.name, scope));
        return;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") { visitPattern(prop.argument, scope, isAssign); continue; }
          if (prop.computed) visit(prop.key, scope);
          visitPattern(prop.value, scope, isAssign);
        }
        return;
      case "ArrayPattern": for (const e of p.elements) visitPattern(e, scope, isAssign); return;
      case "RestElement": visitPattern(p.argument, scope, isAssign); return;
      case "AssignmentPattern": visitPattern(p.left, scope, isAssign); visit(p.right, scope); return;
      default: visit(p, scope); // a member-expression assignment target
    }
  };

  const visitFunction = (fn: N, scope: Scope): void => {
    const fs = newScope(scope);
    if (fn.type === "FunctionExpression" && fn.id) fs.decls.set(fn.id.name, OTHER);
    // s441 rounds 3-4 — parameters and hoisted `var`s bind to their own Identifier
    // nodes (the handler's event parameter is matched by BINDING, not by name).
    const vars: N[] = [];
    if (fn.body && fn.body.type === "BlockStatement") hoistedVarPatterns(fn.body.body, vars);
    for (const v of vars) declarePattern(v, fs);
    for (const p of fn.params) declarePattern(p, fs);
    // `arguments` is implicitly bound in a non-arrow function.
    if (fn.type !== "ArrowFunctionExpression") fs.decls.set("arguments", OTHER);
    for (const p of fn.params) visitPattern(p, fs);
    if (fn.body && fn.body.type === "BlockStatement") {
      const bs = newScope(fs);
      declareBlock(fn.body.body, bs);
      for (const st of fn.body.body) visit(st, bs);
    } else {
      visit(fn.body, fs);
    }
  };

  const visit = (node: N, scope: Scope): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) visit(c, scope); return; }
    switch (node.type) {
      case "Identifier":
        refs.set(node, lookup(node.name, scope));
        return;
      case "Program": {
        const vars: N[] = [];
        hoistedVarPatterns(node.body, vars);
        for (const v of vars) declarePattern(v, scope);
        declareBlock(node.body, scope);
        for (const st of node.body) visit(st, scope);
        return;
      }
      case "FunctionDeclaration":
        fnDecls.push(node);
        visitFunction(node, scope);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunction(node, scope);
        return;
      case "ClassDeclaration":
      case "ClassExpression": {
        const cs = newScope(scope);
        if (node.id) cs.decls.set(node.id.name, OTHER);
        visit(node.superClass, cs);
        visit(node.body, cs);
        return;
      }
      case "BlockStatement":
      case "StaticBlock": {
        const bs = newScope(scope);
        declareBlock(node.body, bs);
        for (const st of node.body) visit(st, bs);
        return;
      }
      case "ForStatement": {
        const ls = newScope(scope);
        if (node.init && node.init.type === "VariableDeclaration" && node.init.kind !== "var") declareBlock([node.init], ls);
        visit(node.init, ls); visit(node.test, ls); visit(node.update, ls); visit(node.body, ls);
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const ls = newScope(scope);
        if (node.left && node.left.type === "VariableDeclaration" && node.left.kind !== "var") declareBlock([node.left], ls);
        visit(node.left, ls); visit(node.right, ls); visit(node.body, ls);
        return;
      }
      case "CatchClause": {
        const cs = newScope(scope);
        declarePattern(node.param, cs);
        visitPattern(node.param, cs);
        visit(node.body, cs);
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope);
        const ss = newScope(scope);
        const all: N[] = [];
        for (const c of node.cases) all.push(...c.consequent);
        declareBlock(all, ss);
        for (const c of node.cases) { visit(c.test, ss); for (const st of c.consequent) visit(st, ss); }
        return;
      }
      case "VariableDeclarator":
        visitPattern(node.id, scope);
        visit(node.init, scope);
        return;
      case "AssignmentExpression":
        visitPattern(node.left, scope, true);
        visit(node.right, scope);
        return;
      case "MemberExpression":
        visit(node.object, scope);
        if (node.computed) visit(node.property, scope);
        return;
      case "Property":
      case "PropertyDefinition":
      case "MethodDefinition":
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope);
        return;
      case "LabeledStatement":
        visit(node.body, scope);
        return;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
        return;
      default:
        for (const key of Object.keys(node)) {
          if (key === "type" || key === "start" || key === "end") continue;
          const v = node[key];
          if (v && typeof v === "object") visit(v, scope);
        }
    }
  };

  visit(root, rootScope);
  return { refs, assignTargets, fnDecls };
}

// ---------------------------------------------------------------------------
// Shape predicates
// ---------------------------------------------------------------------------

/** `recv.<method>(…)` with a static, non-optional member callee → the method name. */
function staticMethodOf(call: N): string | null {
  const c = call.callee;
  if (!c || c.type !== "MemberExpression" || c.computed || c.optional || call.optional) return null;
  return c.property && c.property.type === "Identifier" ? c.property.name : null;
}

const REACTIVE_ARG1_WRAPPERS = new Set(["_scrml_reactive_set", "_scrml_cs_reactive_set"]);

/** A tight tail binds tighter than `await` — the awaited call must be parenthesized. */
function needsWrap(node: N, parent: N): boolean {
  if (!parent) return false;
  return (
    (parent.type === "MemberExpression" && parent.object === node) ||
    (parent.type === "CallExpression" && parent.callee === node) ||
    (parent.type === "NewExpression" && parent.callee === node) ||
    (parent.type === "TaggedTemplateExpression" && parent.tag === node)
  );
}

/** The static name a member expression reads (`o.x` or `o["x"]`), or null. */
function memberName(m: N): string | null {
  if (!m || m.type !== "MemberExpression") return null;
  if (!m.computed) return m.property && m.property.type === "Identifier" ? m.property.name : null;
  return m.property && m.property.type === "Literal" && typeof m.property.value === "string" ? m.property.value : null;
}

/** A short phrase naming where a function VALUE went, for the F4 diagnostic. */
function escapePosition(node: N, parent: N, calleeText: string | null): string {
  if (!parent) return "used as a value";
  switch (parent.type) {
    case "VariableDeclarator": return "aliased by a variable declaration";
    case "AssignmentExpression": return "assigned to a variable or property";
    case "ArrayExpression": return "stored in an array";
    case "Property": return "stored in an object";
    case "NewExpression":
      if (parent.callee === node) return "constructed with `new`";
      return calleeText ? `passed as an argument to \`${calleeText}\`` : "passed as an argument";
    case "CallExpression":
      return calleeText ? `passed as an argument to \`${calleeText}\`` : "passed as an argument";
    case "ReturnStatement": return "returned as a value";
    case "ArrowFunctionExpression": return "returned as a value";
    case "MemberExpression": return "used as an object (a member read or `.call`/`.bind`)";
    case "SpreadElement": return "spread as a value";
    case "ConditionalExpression":
    case "LogicalExpression":
    case "BinaryExpression":
    case "UnaryExpression":
      return "used as an operand";
    case "TemplateLiteral": return "interpolated into a template";
    default: return "used as a value";
  }
}

function calleeTextOf(src: string, call: N): string | null {
  const c = call.callee;
  if (!c) return null;
  const t = src.slice(c.start, c.end);
  return t.length > 0 && t.length <= 60 ? t : null;
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

interface Edit { pos: number; end: number; text: string; kind: "replace" | "close" | "open"; depth: number }

interface AnalyzeOpts {
  /** Rewrite (await / lift / color) — false for verbatim raw fragments. */
  transform: boolean;
  /** The function whose asyncness the caller controls (handler / mount block), or null. */
  root: N | null;
  /** The handler's event parameter name — enables the event-control check (handlers only). */
  eventParam?: string | null;
  /** Leave a SERVER fn call that is the direct value of `_scrml_(cs_)reactive_set` alone (emit-client's IIFE lift owns it). */
  reactiveArg1Skip: boolean;
}

function analyze(src: string, program: N, P: number, bodyEnd: number, resolveFree: FreeAsyncResolver, opts: AnalyzeOpts): ColoredBody {
  const rootScope = newScope(null);
  const { refs, assignTargets, fnDecls } = resolveScopes(program, rootScope);

  // What does an identifier REFERENCE resolve to, async-wise? `asyncDecl` is filled
  // by the fixpoint (transform mode only — a verbatim fragment's declarations stay
  // sync, so a call to one is a plain call and the async call INSIDE it is the finding).
  const asyncDecl = new Map<N, AsyncRoot>();
  const asyncOf = (ident: N): ResolvedAsync | null => {
    if (!refs.has(ident)) return null;
    const b = refs.get(ident);
    if (b === OTHER) return null;
    if (b !== undefined) {
      const r = asyncDecl.get(b);
      return r ? { root: r, local: true } : null;
    }
    return resolveFree(ident.name);
  };

  // ── Fixpoint (transform mode) — which fragment functions must be async? ──────
  const colorable: N[] = opts.transform ? [...fnDecls, ...(opts.root ? [opts.root] : [])] : [];
  if (colorable.length > 0) {
    type Trigger = { root: AsyncRoot } | { dep: N };
    const triggers = new Map<N, Trigger[]>();
    for (const f of colorable) {
      const list: Trigger[] = [];
      const consider = (ident: N): void => {
        if (!refs.has(ident)) return;
        const b = refs.get(ident);
        if (b === OTHER) return;
        if (b !== undefined) { list.push({ dep: b }); return; }
        const r = resolveFree(ident.name);
        if (r) list.push({ root: r.root });
      };
      const walk = (n: N): void => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { for (const c of n) walk(c); return; }
        if (n !== f && n.type === "FunctionDeclaration") return; // its own body, its own entry
        if (n.type === "CallExpression") {
          if (n.callee && n.callee.type === "Identifier") consider(n.callee);
          // A function passed by reference to a collection method is invoked by it:
          // awaited through the lifted combinator, or failed closed.
          const m = staticMethodOf(n);
          if (m && (ASYNC_COMBINATOR_METHODS.has(m) || SYNC_CALLBACK_CONSUMER_METHODS.has(m))) {
            for (const a of n.arguments) if (a && a.type === "Identifier") consider(a);
          }
        }
        for (const key of Object.keys(n)) {
          if (key === "type" || key === "start" || key === "end") continue;
          const v = n[key];
          if (v && typeof v === "object") walk(v);
        }
      };
      walk(f.body);
      triggers.set(f, list);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of colorable) {
        if (asyncDecl.has(f)) continue;
        for (const t of triggers.get(f)!) {
          const r = "root" in t ? t.root : asyncDecl.get(t.dep);
          if (r) { asyncDecl.set(f, r); changed = true; break; }
        }
      }
    }
  }

  // Does a callback expression (a lambda passed to a combinator / discard HOF)
  // reach an async call in its own body (crossing further callbacks, not
  // further function declarations)?
  const reachesAsync = (fnNode: N): boolean => {
    let found = false;
    const walk = (n: N): void => {
      if (found || !n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (n.type === "FunctionDeclaration") return;
      if (n.type === "CallExpression") {
        if (n.callee && n.callee.type === "Identifier" && asyncOf(n.callee)) { found = true; return; }
        const m = staticMethodOf(n);
        if (m && ASYNC_COMBINATOR_METHODS.has(m)) {
          for (const a of n.arguments) if (a && a.type === "Identifier" && asyncOf(a)) { found = true; return; }
        }
      }
      for (const key of Object.keys(n)) {
        if (key === "type" || key === "start" || key === "end") continue;
        const v = n[key];
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(fnNode.body);
    return found;
  };

  const edits: Edit[] = [];
  const calls: JsAsyncCall[] = [];
  const escapes: JsAsyncEscape[] = [];
  const consumed = new Set<N>(); // identifiers already accounted for (callee / sanctioned argument)
  const madeAsync = new Set<N>(); // callbacks re-emitted async
  // The root (handler / mount block) runs async only when its OWN body awaits —
  // a body whose one server call is owned elsewhere (the reactive-set lift) keeps
  // its synchronous shape byte-for-byte.
  let rootAsync = false;
  let curFn: N = null;
  // The source position of the root's first own-level await (inserted or already
  // present) — for the event-control check.
  // `firstOwnAwait` / `firstOwnAwaitEnd`: the earliest own-level await and the
  // end of what it awaits — code at or after `firstOwnAwaitEnd` runs after the
  // handler has yielded to the event loop.
  let firstOwnAwait = Infinity;
  let firstOwnAwaitEnd = Infinity;
  const noteAwait = (pos?: number, end?: number): void => {
    if (curFn !== null && curFn === opts.root) {
      rootAsync = true;
      if (typeof pos === "number" && pos < firstOwnAwait) {
        firstOwnAwait = pos;
        firstOwnAwaitEnd = typeof end === "number" ? end : pos;
      }
    }
  };
  const promiseMethods: Array<{ name: string; method: string }> = [];
  const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
  const checkPromiseMethod = (node: N, parent: N, name: string): void => {
    if (parent && parent.type === "MemberExpression" && parent.object === node) {
      const pm = memberName(parent);
      if (pm !== null && PROMISE_METHODS.has(pm)) promiseMethods.push({ name, method: pm });
    }
  };

  const at = (pos: number): number => pos - P;
  const addAwait = (node: N, parent: N, depth: number): void => {
    noteAwait(node.start, node.end);
    if (needsWrap(node, parent)) {
      edits.push({ pos: at(node.start), end: at(node.start), text: "(await ", kind: "open", depth });
      edits.push({ pos: at(node.end), end: at(node.end), text: ")", kind: "close", depth });
    } else {
      edits.push({ pos: at(node.start), end: at(node.start), text: "await ", kind: "open", depth });
    }
  };
  const makeAsync = (fnNode: N, depth: number): void => {
    if (fnNode.async || fnNode.start < P) return;
    edits.push({ pos: at(fnNode.start), end: at(fnNode.start), text: "async ", kind: "open", depth });
  };

  const visit = (node: N, parent: N, awaitLegal: boolean, depth: number): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) visit(c, parent, awaitLegal, depth); return; }

    if (isFn(node)) {
      let isAsync = node.async === true || madeAsync.has(node);
      if (!isAsync && opts.transform && asyncDecl.has(node)) {
        isAsync = true;
        if (node !== opts.root) makeAsync(node, depth);
      }
      const prevFn = curFn;
      curFn = node;
      for (const p of node.params) visit(p, node, false, depth + 1);
      visit(node.body, node, isAsync, depth + 1);
      curFn = prevFn;
      return;
    }
    if (node.type === "AwaitExpression") noteAwait(node.start, node.end);
    else if (node.type === "ForOfStatement" && node.await === true) noteAwait(node.start, node.right ? node.right.end : node.start);
    // Class field initializers and static blocks are sync contexts.
    if (node.type === "PropertyDefinition") {
      if (node.computed) visit(node.key, node, awaitLegal, depth + 1);
      visit(node.value, node, false, depth + 1);
      return;
    }
    if (node.type === "StaticBlock") { visit(node.body, node, false, depth + 1); return; }

    if (node.type === "CallExpression") {
      const method = staticMethodOf(node);
      const args: N[] = node.arguments;

      // (a) clean-family combinator with an async callback → `_scrml_<m>Async`.
      if (method && ASYNC_COMBINATOR_METHODS.has(method) && args.length >= 1) {
        const cb = args[0];
        const cbAsync = cb && (
          (cb.type === "Identifier" && !!asyncOf(cb)) ||
          ((cb.type === "ArrowFunctionExpression" || cb.type === "FunctionExpression") && !cb.async && reachesAsync(cb))
        );
        if (cbAsync) {
          if (cb.type === "Identifier") consumed.add(cb);
          if (opts.transform) {
            const recv = node.callee.object;
            const prefix = `_scrml_${method}Async(`;
            if (awaitLegal) {
              noteAwait(node.start, node.end);
              checkPromiseMethod(node, parent, `${method}(…)`);
              const wrap = needsWrap(node, parent);
              edits.push({ pos: at(node.start), end: at(node.start), text: (wrap ? "(await " : "await ") + prefix, kind: "open", depth });
              if (wrap) edits.push({ pos: at(node.end), end: at(node.end), text: ")", kind: "close", depth });
            } else {
              edits.push({ pos: at(node.start), end: at(node.start), text: prefix, kind: "open", depth });
              const r = cb.type === "Identifier" ? asyncOf(cb)! : null;
              calls.push({ name: `${method}(…) async-callback combinator`, root: r ? r.root : { kind: "stdlib", via: method }, local: false });
            }
            edits.push({ pos: at(recv.end), end: at(cb.start), text: ", ", kind: "replace", depth });
            if (cb.type !== "Identifier") madeAsync.add(cb);
            if (cb.type !== "Identifier") makeAsync(cb, depth);
            visit(recv, node.callee, awaitLegal, depth + 1);
            visit(cb, node, awaitLegal, depth + 1);
            for (let i = 1; i < args.length; i++) visit(args[i], node, awaitLegal, depth + 1);
            return;
          }
          // Verbatim fragment: the native method runs the async fn synchronously.
          if (cb.type === "Identifier") calls.push({ name: cb.name, ...asyncOf(cb)! });
        }
      }

      // (b) a global fire-and-forget scheduler DISCARDS its callback's return.
      if (node.callee && node.callee.type === "Identifier" && KNOWN_DISCARD_HOF.has(node.callee.name) &&
          refs.has(node.callee) && refs.get(node.callee) === undefined &&
          !(resolveFree.isBound && resolveFree.isBound(node.callee.name))) {
        for (const a of args) {
          if (a && a.type === "Identifier" && asyncOf(a)) consumed.add(a);
          else if (opts.transform && a && (a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") &&
                   !a.async && reachesAsync(a)) {
            madeAsync.add(a);
            makeAsync(a, depth);
          }
        }
      }

      // (c) a sync consumer with no async combinator (`.sort(inner)`): fail closed.
      if (method && SYNC_CALLBACK_CONSUMER_METHODS.has(method)) {
        for (const a of args) {
          if (a && a.type === "Identifier") {
            const r = asyncOf(a);
            if (r) { consumed.add(a); calls.push({ name: a.name, ...r }); }
          }
        }
      }

      // (d) a call to an async function.
      if (node.callee && node.callee.type === "Identifier") {
        consumed.add(node.callee);
        const r = asyncOf(node.callee);
        if (r) {
          const arg1Skip = opts.reactiveArg1Skip && r.root.kind === "server" && !r.local &&
            parent && parent.type === "CallExpression" && parent.callee && parent.callee.type === "Identifier" &&
            REACTIVE_ARG1_WRAPPERS.has(parent.callee.name) && parent.arguments[1] === node;
          const alreadyAwaited = !!parent && parent.type === "AwaitExpression";
          if (!arg1Skip && !alreadyAwaited) {
            if (opts.transform && awaitLegal) {
              addAwait(node, parent, depth);
              checkPromiseMethod(node, parent, node.callee.name);
            }
            else calls.push({ name: node.callee.name, ...r });
          }
        }
      }
      visit(node.callee, node, awaitLegal, depth + 1);
      for (const a of args) visit(a, node, awaitLegal, depth + 1);
      return;
    }

    if (node.type === "Identifier") {
      if (consumed.has(node)) return;
      const r = asyncOf(node);
      if (!r) return;
      // An assignment TARGET is not a use of the value.
      if (parent && parent.type === "AssignmentExpression" && parent.left === node) return;
      if (parent && parent.type === "UpdateExpression") return;
      // `typeof m` inspects the value without calling it.
      if (parent && parent.type === "UnaryExpression" && parent.operator === "typeof") return;
      const calleeText = parent && (parent.type === "CallExpression" || parent.type === "NewExpression")
        ? calleeTextOf(src, parent) : null;
      escapes.push({ name: node.name, ...r, position: escapePosition(node, parent, calleeText) });
      return;
    }

    // Non-reference identifier positions.
    if (node.type === "MemberExpression") {
      visit(node.object, node, awaitLegal, depth + 1);
      if (node.computed) visit(node.property, node, awaitLegal, depth + 1);
      return;
    }
    if (node.type === "Property" || node.type === "MethodDefinition") {
      if (node.computed) visit(node.key, node, awaitLegal, depth + 1);
      visit(node.value, node, awaitLegal, depth + 1);
      return;
    }
    if (node.type === "VariableDeclarator") {
      visitPatternDefaults(node.id, node, awaitLegal, depth + 1);
      visit(node.init, node, awaitLegal, depth + 1);
      return;
    }
    if (node.type === "LabeledStatement") { visit(node.body, node, awaitLegal, depth + 1); return; }
    if (node.type === "BreakStatement" || node.type === "ContinueStatement" || node.type === "MetaProperty") return;
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      visit(node.superClass, node, awaitLegal, depth + 1);
      visit(node.body, node, awaitLegal, depth + 1);
      return;
    }
    if (node.type === "CatchClause") {
      visitPatternDefaults(node.param, node, awaitLegal, depth + 1);
      visit(node.body, node, awaitLegal, depth + 1);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = node[key];
      if (v && typeof v === "object") visit(v, node, awaitLegal, depth + 1);
    }
  };

  // A binding pattern's identifiers are declarations; only its defaults and
  // computed keys are evaluated.
  const visitPatternDefaults = (p: N, parent: N, awaitLegal: boolean, depth: number): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": return;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") { visitPatternDefaults(prop.argument, prop, awaitLegal, depth + 1); continue; }
          if (prop.computed) visit(prop.key, prop, awaitLegal, depth + 1);
          visitPatternDefaults(prop.value, prop, awaitLegal, depth + 1);
        }
        return;
      case "ArrayPattern": for (const e of p.elements) visitPatternDefaults(e, p, awaitLegal, depth + 1); return;
      case "RestElement": visitPatternDefaults(p.argument, p, awaitLegal, depth + 1); return;
      case "AssignmentPattern":
        visitPatternDefaults(p.left, p, awaitLegal, depth + 1);
        visit(p.right, p, awaitLegal, depth + 1);
        return;
      default: visit(p, parent, awaitLegal, depth);
    }
  };

  visit(program, null, false, 0);

  // Event control after the first own-level await (handlers only) — s441 round 4:
  // the event binding is POISONED after the handler yields, rather than a list of
  // call shapes being matched. After the first own-level await, any use of the
  // event parameter — or of anything derived from it (an alias in any binding
  // form, a container holding it, a destructured control method, a closure that
  // misuses it) — other than a plain read of a NON-control property
  // (`ev.target`, `ev.key`) is an error. Bindings are followed by identity (the
  // scope resolver), so an inner `(event) => …` parameter or a block-local
  // `const event` is a different binding and never fires.
  const eventControlAfterAwait: Array<{ method: string }> = [];
  const eventParamNode = opts.root && opts.root.params && opts.root.params[0] &&
    opts.root.params[0].type === "Identifier" ? opts.root.params[0] : null;
  if (opts.root && eventParamNode && firstOwnAwaitEnd !== Infinity) {
    const CONTROL = new Set(["preventDefault", "stopPropagation", "stopImmediatePropagation", "returnValue", "cancelBubble"]);
    type Taint = "event" | "alias" | "container" | "closure";
    const taint = new Map<N, Taint>([[eventParamNode, "event"]]);
    // Parent links over the whole handler (nested functions included).
    const parentOf = new Map<N, N>();
    const idents: N[] = [];
    const link = (n: N, parent: N): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) link(c, parent); return; }
      if (typeof n.type !== "string") return;
      if (parent) parentOf.set(n, parent);
      if (n.type === "Identifier") idents.push(n);
      for (const key of Object.keys(n)) {
        if (key === "type" || key === "start" || key === "end") continue;
        const v = n[key];
        if (v && typeof v === "object") link(v, n);
      }
    };
    link(opts.root.body, opts.root);
    const bindingOf = (id: N): N | undefined => {
      const b = refs.has(id) ? refs.get(id) : assignTargets.get(id);
      return b === OTHER ? undefined : (b as N | undefined);
    };
    const taintOf = (id: N): Taint | undefined => {
      if (!refs.has(id)) return undefined;
      const b = bindingOf(id);
      return b ? taint.get(b) : undefined;
    };
    // A reference to the event / an alias of it that is a plain read of a
    // non-control property: `ev.target` (also as the object of a further chain),
    // not written, not deleted.
    const isPlainNonControlRead = (id: N): boolean => {
      const m = parentOf.get(id);
      if (!m || m.type !== "MemberExpression" || m.object !== id) return false;
      const name = memberName(m);
      if (name === null || CONTROL.has(name)) return false;
      const mp = parentOf.get(m);
      if (mp && mp.type === "AssignmentExpression" && mp.left === m) return false;
      if (mp && mp.type === "UpdateExpression") return false;
      if (mp && mp.type === "UnaryExpression" && mp.operator === "delete") return false;
      return true;
    };
    // Is this reference a MISUSE (anything but a plain non-control read of the
    // event / an alias)? Position is not considered here.
    const isMisuse = (id: N): boolean => {
      const t = taintOf(id);
      if (!t) return false;
      if (t === "container" || t === "closure") return true;
      return !isPlainNonControlRead(id);
    };
    const containsMisuse = (n: N): boolean => {
      let found = false;
      const walk = (x: N): void => {
        if (found || !x || typeof x !== "object") return;
        if (Array.isArray(x)) { for (const c of x) walk(c); return; }
        if (x.type === "Identifier" && isMisuse(x)) { found = true; return; }
        for (const key of Object.keys(x)) {
          if (key === "type" || key === "start" || key === "end") continue;
          const v = x[key];
          if (v && typeof v === "object") walk(v);
        }
      };
      walk(n);
      return found;
    };
    const unparen = (e: N): N => (e && e.type === "ParenthesizedExpression" ? unparen(e.expression) : e);
    const isAliasSource = (e: N): boolean => {
      const x = unparen(e);
      if (!x || x.type !== "Identifier") return false;
      const t = taintOf(x);
      return t === "event" || t === "alias";
    };
    const mark = (b: N | undefined, t: Taint): boolean => {
      if (!b || taint.has(b)) return false;
      taint.set(b, t);
      return true;
    };
    // Bind the names of a pattern that RECEIVES `src` (a declaration or an
    // assignment): an alias when `src` is the event itself and the pattern is a
    // plain name; a destructure of the event binds each non-control field's value
    // clean and taints everything else; any other misusing source taints all.
    const receive = (pattern: N, src: N, isAssign: boolean): boolean => {
      let changed = false;
      const bind = (id: N): N | undefined => (isAssign ? assignTargets.get(id) as N | undefined : id);
      if (!pattern) return false;
      if (pattern.type === "Identifier") {
        if (src && isAliasSource(src)) return mark(bind(pattern), "alias");
        if (src && (isFn(unparen(src)) ? containsMisuse(unparen(src).body) : containsMisuse(src))) {
          return mark(bind(pattern), isFn(unparen(src)) ? "closure" : "container");
        }
        return false;
      }
      if (pattern.type === "ObjectPattern" && src && isAliasSource(src)) {
        for (const prop of pattern.properties) {
          const safe = prop.type === "Property" && !prop.computed && prop.key &&
            ((prop.key.type === "Identifier" && !CONTROL.has(prop.key.name)) ||
             (prop.key.type === "Literal" && typeof prop.key.value === "string" && !CONTROL.has(prop.key.value))) &&
            prop.value && (prop.value.type === "Identifier" || prop.value.type === "AssignmentPattern");
          if (safe) continue;
          const ids: N[] = [];
          patternIdents(prop.type === "RestElement" ? prop.argument : prop.value, ids);
          for (const id of ids) changed = mark(bind(id), "container") || changed;
        }
        return changed;
      }
      if (src && (isAliasSource(src) || containsMisuse(src))) {
        const ids: N[] = [];
        patternIdents(pattern, ids);
        for (const id of ids) changed = mark(bind(id), "container") || changed;
      }
      return changed;
    };
    let grew = true;
    while (grew) {
      grew = false;
      const scan = (n: N): void => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { for (const c of n) scan(c); return; }
        if (n.type === "VariableDeclarator" && n.init) grew = receive(n.id, n.init, false) || grew;
        else if (n.type === "AssignmentExpression" && n.operator === "=") grew = receive(n.left, n.right, true) || grew;
        else if (n.type === "FunctionDeclaration" && containsMisuse(n.body)) grew = mark(n, "closure") || grew;
        for (const key of Object.keys(n)) {
          if (key === "type" || key === "start" || key === "end") continue;
          const v = n[key];
          if (v && typeof v === "object") scan(v);
        }
      };
      scan(opts.root.body);
    }
    // After the first own-level await: every misusing reference is an error.
    for (const id of idents) {
      if (id.start < firstOwnAwaitEnd || !isMisuse(id)) continue;
      const m = parentOf.get(id);
      const name = m && m.type === "MemberExpression" && m.object === id ? memberName(m) : null;
      eventControlAfterAwait.push({ method: name !== null && CONTROL.has(name) ? name : `${id.name} (derived from the event)` });
    }
  }
  return {
    code: applyEdits(src.slice(P, bodyEnd), edits), rootAsync, calls: dedupeCalls(calls), escapes: dedupeEscapes(escapes),
    ...(promiseMethods.length ? { promiseMethods } : {}),
    ...(eventControlAfterAwait.length ? { eventControlAfterAwait } : {}),
  };
}

function dedupeCalls(list: JsAsyncCall[]): JsAsyncCall[] {
  const seen = new Set<string>();
  return list.filter((c) => { const k = c.name; if (seen.has(k)) return false; seen.add(k); return true; });
}
function dedupeEscapes(list: JsAsyncEscape[]): JsAsyncEscape[] {
  const seen = new Set<string>();
  return list.filter((c) => { const k = `${c.name}|${c.position}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Apply edits right-to-left. At one position: a replacement first (it covers text
 * that starts there), then closing parens, then opens — deeper opens first, so the
 * OUTER construct's text ends up leftmost (`await (await a())(b)`).
 */
function applyEdits(text: string, edits: Edit[]): string {
  if (edits.length === 0) return text;
  const rank = (e: Edit): number => (e.kind === "replace" ? 0 : e.kind === "close" ? 1 : 2);
  const sorted = [...edits].sort((a, b) =>
    (b.pos - a.pos) || (rank(a) - rank(b)) || (a.kind === "open" ? b.depth - a.depth : 0));
  let out = text;
  for (const e of sorted) {
    if (e.pos < 0 || e.end > out.length) continue;
    out = out.slice(0, e.pos) + e.text + out.slice(e.end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function tryParse(src: string): N | null {
  try {
    return acornParse(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch {
    return null;
  }
}

/**
 * DIAGNOSE a raw fragment emitted verbatim (a block-body callback, a template
 * literal, a parameter default). Nothing in it can be awaited or lifted, so every
 * async call is reported, and every async function used as a value is an escape.
 * Names are resolved lexically INSIDE the fragment first (a local `m` shadows);
 * a name free in the fragment goes to `resolveFree`. `null` when it does not parse.
 */
export function analyzeRawJsFragment(raw: string, resolveFree: FreeAsyncResolver): JsAsyncUses | null {
  if (typeof raw !== "string" || raw.trim() === "") return { calls: [], escapes: [] };
  const trimmed = raw.trim();
  // Try as an expression first (callbacks, template literals, defaults), then as
  // statements (a raw statement-level escape hatch).
  const attempts: Array<[string, string]> = [["(", "\n)"], ["", ""]];
  if (trimmed.startsWith("`") === false && /\$\{/.test(trimmed) && !/[;{}]/.test(trimmed.replace(/\$\{[^}]*\}/g, ""))) {
    attempts.push(["`", "`"]);
  }
  for (const [pre, post] of attempts) {
    const src = pre + trimmed + post;
    const program = tryParse(src);
    if (!program) continue;
    const r = analyze(src, program, pre.length, src.length - post.length, resolveFree, { transform: false, root: null, reactiveArg1Skip: false });
    return { calls: r.calls, escapes: r.escapes };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scheduler exemption — is the global scheduler provably the one called?
// ---------------------------------------------------------------------------

/**
 * s441 round 4 (review round 3, findings 1-2) — the fire-and-forget exemption
 * (`setTimeout(fn)` discards fn's return) is sound only for the GLOBAL scheduler.
 * Returns the scheduler names that are NOT provably global in this file, decided
 * on the TREE (the round-2/3 text scans were bypassed by a string holding `//` or
 * `/*` that hid a destructure):
 *
 *   - a scheduler name in any BINDING or KEY position anywhere in the file — a
 *     declaration (any pattern form), a parameter, a function / class / method
 *     name, a catch parameter, an import alias, an object-literal key — withdraws
 *     it (a whole-file over-approximation of scope: fail closed);
 *   - a WRITE to it — `setTimeout = …`, `globalThis.setTimeout = …`,
 *     `window.setTimeout = …`, `x["setTimeout"] = …`, `++`/`delete` — withdraws it;
 *   - a string literal naming it, in a file that also calls a reflective writer
 *     (`Object.defineProperty`/`defineProperties`/`assign`/`setPrototypeOf`,
 *     `Reflect.set`/`defineProperty`), withdraws it.
 *
 * Code the tree holds as TEXT (escape-hatch bodies, handler values, template
 * literals, parameter defaults, `on mount` bodies) is parsed with acorn and held
 * to the same rules (its references resolved by the same scope resolver); text
 * that mentions a scheduler name and does not parse withdraws it. Prose (markup
 * text, comments) and ordinary string values do not count — a scheduler name in
 * a string is not a binding.
 */
export function schedulerNamesNotProvablyGlobal(fileAST: unknown): Set<string> {
  const out = new Set<string>();
  if (!fileAST || typeof fileAST !== "object") return out;
  const NAMES = KNOWN_DISCARD_HOF as ReadonlySet<string>;
  const literalNames = new Set<string>();
  let reflective = false;
  const REFLECTIVE = new Set(["defineProperty", "defineProperties", "assign", "setPrototypeOf", "set"]);
  const SKIP_KEYS = new Set(["_sourceText", "sourceText", "filePath", "file", "span"]);
  const PROSE_KINDS = new Set(["text", "comment"]);
  const leadingIdent = (s: string): string | null => {
    const m = s.trim().replace(/^\.\.\./, "").match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    return m ? m[0] : null;
  };
  const mentions = (s: string): string[] => {
    const hits: string[] = [];
    for (const nm of NAMES) if (s.includes(nm) && new RegExp(`(^|[^A-Za-z0-9_$])${nm}(?![A-Za-z0-9_$])`).test(s)) hits.push(nm);
    return hits;
  };

  // --- acorn side ---------------------------------------------------------
  const scanText = (text: string): void => {
    const hits = mentions(text);
    const wantsReflective = /\b(defineProperty|defineProperties|assign|setPrototypeOf|Reflect)\b/.test(text);
    if (hits.length === 0 && !wantsReflective) return;
    let program: N | null = null;
    for (const [pre, post] of [["", ""], ["(", "\n)"], ["(async function() {\n", "\n})"], ["`", "`"]] as const) {
      program = tryParse(pre + text + post);
      if (program) break;
    }
    if (!program) { for (const nm of hits) out.add(nm); return; }
    const { refs, assignTargets } = resolveScopes(program, newScope(null));
    const walk = (n: N, parent: N, grand: N): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) walk(c, parent, grand); return; }
      if (typeof n.type !== "string") return;
      if (n.type === "CallExpression" && n.callee && n.callee.type === "MemberExpression") {
        const m = memberName(n.callee);
        if (m !== null && REFLECTIVE.has(m)) reflective = true;
      }
      const isWriteTarget = (x: N, px: N): boolean =>
        !!px && ((px.type === "AssignmentExpression" && px.left === x) ||
          (px.type === "UpdateExpression") ||
          (px.type === "UnaryExpression" && px.operator === "delete"));
      if (n.type === "Identifier" && NAMES.has(n.name)) {
        if (assignTargets.has(n)) out.add(n.name);
        else if (refs.has(n)) { if (parent && parent.type === "UpdateExpression") out.add(n.name); }
        else if (parent && parent.type === "MemberExpression" && parent.property === n && !parent.computed) {
          if (isWriteTarget(parent, grand)) out.add(n.name);
        } else out.add(n.name); // a declaration, parameter, key, method name, label, …
      }
      if (n.type === "Literal" && typeof n.value === "string" && NAMES.has(n.value)) {
        literalNames.add(n.value);
        if (parent && parent.type === "MemberExpression" && parent.property === n && isWriteTarget(parent, grand)) out.add(n.value);
      }
      for (const key of Object.keys(n)) {
        if (key === "type" || key === "start" || key === "end") continue;
        const v = n[key];
        if (v && typeof v === "object") walk(v, n, parent);
      }
    };
    walk(program, null, null);
  };

  // --- structured AST side -------------------------------------------------
  const seen = new WeakSet<object>();
  const visit = (n: unknown, parent: Record<string, unknown> | null, parentKey: string | null): void => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) {
      for (const c of n) {
        if (typeof c === "string") {
          const li = leadingIdent(c);
          if (li !== null && NAMES.has(li)) out.add(li); // a parameter / name list entry
          else if (mentions(c).length) scanText(c);
        } else visit(c, parent, parentKey);
      }
      return;
    }
    const node = n as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : "";
    const isWriteTarget = (): boolean => {
      if (!parent) return false;
      if (parent.kind === "assign" && parentKey === "target") return true;
      if (parent.kind === "unary" && (parent.op === "++" || parent.op === "--" || parent.op === "delete")) return true;
      return false;
    };
    if (kind === "call") {
      const c = node.callee as Record<string, unknown> | undefined;
      if (c && c.kind === "member" && typeof c.property === "string" && REFLECTIVE.has(c.property)) reflective = true;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const v = node[key];
      if (typeof v === "string") {
        if (NAMES.has(v)) {
          if (kind === "ident" && key === "name") { if (isWriteTarget()) out.add(v); }
          else if (kind === "call" && key === "name") { /* a call — allowed */ }
          else if (kind === "member" && key === "property") { if (isWriteTarget()) out.add(v); }
          else if (kind === "lit" && (key === "value" || key === "raw")) literalNames.add(v);
          else if (PROSE_KINDS.has(kind)) { /* prose */ }
          else out.add(v); // a binding / key / name position
          continue;
        }
        const li = leadingIdent(v);
        if (li !== null && NAMES.has(li) && (key === "name" || key === "bindName" || key === "rest" || key === "local" || key === "alias")) {
          out.add(li); // `setTimeout:Type` / pattern binding
          continue;
        }
        if (PROSE_KINDS.has(kind)) continue;
        if (kind === "lit" && node.litType !== "template") continue; // a string value
        if (mentions(v).length || /\b(defineProperty|defineProperties|setPrototypeOf|Reflect)\b/.test(v)) scanText(v);
      } else if (v && typeof v === "object") {
        visit(v, node, key);
      }
    }
  };
  visit(fileAST, null, null);
  if (reflective) for (const nm of literalNames) out.add(nm);
  return out;
}

// ---------------------------------------------------------------------------
// Own-level `await` — does a body await at ITS OWN function level?
// ---------------------------------------------------------------------------

/**
 * s441 — does `fnText` (one function expression) contain an `await` that belongs
 * to that function itself, not to a function nested inside it? `null` when the
 * text does not parse (callers keep their text scan — fail-safe).
 *
 * Several emitters decide "must this wrapper be `async`?" by scanning the emitted
 * text for the token `await`. Since s441 an event handler inside such a body —
 * a `lift` handler in a `match` arm IIFE, a handler in a nested helper — may itself
 * be `async function(event) { await … }`. That `await` belongs to the HANDLER; a
 * token scan counted it for the enclosing wrapper and stranded an outer `await`
 * in a synchronous effect (invalid JS).
 */
export function fnTextHasOwnAwait(fnText: string): boolean | null {
  // A function expression, or an IIFE `(function() { … })()` given whole.
  const program = tryParse("(" + fnText + "\n)") ?? tryParse(fnText);
  if (!program || program.body.length !== 1) return null;
  const root = program.body[0]?.expression;
  const fn = root && (root.type === "CallExpression" ? root.callee : root);
  if (!fn || !isFn(fn)) return null;
  let found = false;
  const walk = (n: N): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if (n !== fn && isFn(n)) return;
    if (n.type === "AwaitExpression" || (n.type === "ForOfStatement" && n.await === true)) { found = true; return; }
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = n[key];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(fn.params);
  walk(fn.body);
  return found;
}

/** `fnTextHasOwnAwait` for a function BODY given as statement text. */
export function bodyTextHasOwnAwait(bodyText: string): boolean | null {
  return fnTextHasOwnAwait("async function() {\n" + bodyText + "\n}");
}

// ---------------------------------------------------------------------------
// The active client emission (handler emitters with no ctx in reach)
// ---------------------------------------------------------------------------

/**
 * s441 — the client emission in progress: how to resolve a free name, and where
 * to report. Set by emit-client for the duration of one file's client emission
 * (codegen is synchronous — the same module-level pattern the each / lift
 * emitters already use for their per-file state), so the row / lift handler
 * emitters, which build `function(event) { … }` text deep in call chains that
 * carry no compile context, color their handlers against the SAME facts the
 * top-level event wiring uses.
 */
export interface ActiveClientAsync {
  resolveFree: FreeAsyncResolver;
  report: (uses: JsAsyncUses, span: unknown) => void;
}

let _activeClientAsync: ActiveClientAsync | null = null;

/** Install (or clear, with null) the active client emission; returns the previous one. */
export function setActiveClientAsync(next: ActiveClientAsync | null): ActiveClientAsync | null {
  const prev = _activeClientAsync;
  _activeClientAsync = next;
  return prev;
}

/**
 * Apply §13.2 to one emitted event-handler function expression under the active
 * client emission (see `colorAsyncFunctionExpr`); unchanged when no emission is
 * active or the text is not a single function expression that parses.
 */
export function colorActiveHandler(fnText: string, span?: unknown): string {
  const active = _activeClientAsync;
  if (!active || !fnText) return fnText;
  const colored = colorAsyncFunctionExpr(fnText, active.resolveFree);
  if (!colored) {
    const u = unanalyzableHandlerUses(fnText, active.resolveFree);
    if (u) active.report(u, span);
    return fnText;
  }
  active.report(colored, span);
  return colored.code;
}

/**
 * s441 fix round — a handler whose text does not parse cannot be analysed, so its
 * server calls cannot be awaited. If it mentions any async-colored name, report it
 * (fail CLOSED); otherwise nothing async is at stake and the text stands. The scan
 * is deliberately coarse (every identifier-shaped token, strings included): a
 * false positive is a loud error on text that is already malformed.
 */
export function unanalyzableHandlerUses(fnText: string, resolveFree: FreeAsyncResolver): JsAsyncUses | null {
  // Text that parses (a bare reference, a non-function expression) is not this
  // case — only text the analysis could not read at all.
  if (tryParse("(" + fnText + "\n)") || tryParse(fnText)) return null;
  const names = new Set<string>();
  for (const m of fnText.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) names.add(m[0]);
  const hits: Array<{ name: string }> = [];
  for (const nm of names) if (resolveFree(nm)) hits.push({ name: nm });
  return hits.length ? { calls: [], escapes: [], unanalyzable: hits } : null;
}

export interface ColorOpts {
  /** See AnalyzeOpts.reactiveArg1Skip. Default true. */
  reactiveArg1Skip?: boolean;
}

/**
 * TRANSFORM an emitted STATEMENT body that will run in a compiler-controlled scope
 * (an `on mount` block). Returns the rewritten statements and whether the scope
 * must be async; `null` when the body does not parse.
 */
export function colorAsyncStatements(code: string, resolveFree: FreeAsyncResolver, opts: ColorOpts = {}): ColoredBody | null {
  const PREFIX = "(() => {\n";
  const SUFFIX = "\n})";
  const src = PREFIX + code + SUFFIX;
  const program = tryParse(src);
  if (!program) return null;
  const root = program.body[0]?.expression;
  if (!root || root.type !== "ArrowFunctionExpression") return null;
  return analyze(src, program, PREFIX.length, src.length - SUFFIX.length, resolveFree, { transform: true, root, reactiveArg1Skip: opts.reactiveArg1Skip !== false });
}

/**
 * TRANSFORM one emitted FUNCTION EXPRESSION (an event handler value such as
 * `function(event) { … }` or `(e) => …`). When its body awaits, the function is
 * re-emitted `async`. Returns `null` when the text is not a single function
 * expression that parses.
 */
export function colorAsyncFunctionExpr(code: string, resolveFree: FreeAsyncResolver, opts: ColorOpts = {}): ColoredBody | null {
  const PREFIX = "(";
  const SUFFIX = "\n)";
  const src = PREFIX + code + SUFFIX;
  const program = tryParse(src);
  if (!program || program.body.length !== 1) return null;
  const root = program.body[0]?.expression;
  if (!root || (root.type !== "FunctionExpression" && root.type !== "ArrowFunctionExpression")) return null;
  if (root.start !== PREFIX.length) return null;
  const eventParam = root.params && root.params[0] && root.params[0].type === "Identifier" ? root.params[0].name : null;
  let r = analyze(src, program, PREFIX.length, src.length - SUFFIX.length, resolveFree, { transform: true, root, eventParam, reactiveArg1Skip: opts.reactiveArg1Skip !== false });
  if (r.rootAsync && !root.async) r = { ...r, code: "async " + r.code };
  return r;
}
