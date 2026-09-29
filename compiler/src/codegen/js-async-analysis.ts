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

/** Every name a binding pattern introduces. */
function patternNames(p: N, out: string[]): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.push(p.name); return;
    case "ObjectPattern":
      for (const prop of p.properties) patternNames(prop.type === "RestElement" ? prop.argument : prop.value, out);
      return;
    case "ArrayPattern": for (const e of p.elements) patternNames(e, out); return;
    case "RestElement": patternNames(p.argument, out); return;
    case "AssignmentPattern": patternNames(p.left, out); return;
    default: return;
  }
}

/** `var` names hoisted to a function scope (not crossing nested functions). */
function hoistedVars(node: N, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const c of node) hoistedVars(c, out); return; }
  if (isFn(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression") return;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const d of node.declarations) patternNames(d.id, out);
  }
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const v = node[key];
    if (v && typeof v === "object") hoistedVars(v, out);
  }
}

/** Lexical declarations made directly by a statement list (block-scoped). */
function declareBlock(stmts: N[], scope: Scope): void {
  for (const st of stmts) {
    if (!st) continue;
    if (st.type === "FunctionDeclaration" && st.id) scope.decls.set(st.id.name, st);
    else if (st.type === "ClassDeclaration" && st.id) scope.decls.set(st.id.name, OTHER);
    else if (st.type === "VariableDeclaration" && st.kind !== "var") {
      // s441 round 3 — a simple `const x = …` binds to its own id node (a distinct
      // binding identity, so aliases of the event parameter can be followed);
      // pattern-bound names stay the anonymous OTHER.
      for (const d of st.declarations) {
        if (d.id && d.id.type === "Identifier") { scope.decls.set(d.id.name, d.id); continue; }
        const names: string[] = [];
        patternNames(d.id, names);
        for (const nm of names) scope.decls.set(nm, OTHER);
      }
    }
  }
}

interface Resolution {
  /** Identifier REFERENCE node → its binding (`undefined` → free in the fragment). */
  refs: Map<N, Binding | undefined>;
  /** Every FunctionDeclaration in the fragment. */
  fnDecls: N[];
}

/**
 * Resolve every identifier REFERENCE in `root` lexically. Declaration ids,
 * non-computed member properties / object keys and labels are not references.
 */
function resolveScopes(root: N, rootScope: Scope): Resolution {
  const refs = new Map<N, Binding | undefined>();
  const fnDecls: N[] = [];

  const visitPattern = (p: N, scope: Scope): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": return;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") { visitPattern(prop.argument, scope); continue; }
          if (prop.computed) visit(prop.key, scope);
          visitPattern(prop.value, scope);
        }
        return;
      case "ArrayPattern": for (const e of p.elements) visitPattern(e, scope); return;
      case "RestElement": visitPattern(p.argument, scope); return;
      case "AssignmentPattern": visitPattern(p.left, scope); visit(p.right, scope); return;
      default: visit(p, scope); // a member-expression assignment target
    }
  };

  const visitFunction = (fn: N, scope: Scope): void => {
    const fs = newScope(scope);
    if (fn.type === "FunctionExpression" && fn.id) fs.decls.set(fn.id.name, OTHER);
    const names: string[] = [];
    for (const p of fn.params) patternNames(p, names);
    if (fn.body && fn.body.type === "BlockStatement") hoistedVars(fn.body.body, names);
    for (const nm of names) fs.decls.set(nm, OTHER);
    // s441 round 3 — a simple identifier parameter binds to its own node (the
    // handler's event parameter is matched by BINDING, not by name).
    for (const p of fn.params) if (p && p.type === "Identifier") fs.decls.set(p.name, p);
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
        const names: string[] = [];
        hoistedVars(node.body, names);
        for (const nm of names) scope.decls.set(nm, OTHER);
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
        const names: string[] = [];
        patternNames(node.param, names);
        for (const nm of names) cs.decls.set(nm, OTHER);
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
        visitPattern(node.left, scope);
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
  return { refs, fnDecls };
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
  const { refs, fnDecls } = resolveScopes(program, rootScope);

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
  let firstOwnAwait = Infinity;
  const noteAwait = (pos?: number): void => {
    if (curFn !== null && curFn === opts.root) {
      rootAsync = true;
      if (typeof pos === "number" && pos < firstOwnAwait) firstOwnAwait = pos;
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
    noteAwait(node.start);
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
    if (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await === true)) noteAwait(node.start);
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
              noteAwait(node.start);
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

  // Event control after the first own-level await (handlers only). The event is
  // matched by BINDING (the handler's parameter, and `const ev = event` aliases of
  // it), so an inner `(event) => …` parameter or a block-local `const event` is
  // not it. A nested function that calls event control on it and is INVOKED after
  // the first await is flagged too (fail closed; not traced further).
  const eventControlAfterAwait: Array<{ method: string }> = [];
  const eventParamNode = opts.root && opts.root.params && opts.root.params[0] &&
    opts.root.params[0].type === "Identifier" ? opts.root.params[0] : null;
  if (opts.root && eventParamNode && firstOwnAwait !== Infinity) {
    const CONTROL = new Set(["preventDefault", "stopPropagation", "stopImmediatePropagation"]);
    const eventBindings = new Set<N>([eventParamNode]);
    const isEventRef = (id: N): boolean => !!id && id.type === "Identifier" && eventBindings.has(refs.get(id));
    const eachNode = (n: N, fnVisit: (x: N) => void): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) eachNode(c, fnVisit); return; }
      fnVisit(n);
      for (const key of Object.keys(n)) {
        if (key === "type" || key === "start" || key === "end") continue;
        const v = n[key];
        if (v && typeof v === "object") eachNode(v, fnVisit);
      }
    };
    // Aliases: `const ev = event` (and aliases of aliases).
    let grew = true;
    while (grew) {
      grew = false;
      eachNode(opts.root.body, (n) => {
        if (n.type === "VariableDeclarator" && n.id && n.id.type === "Identifier" && isEventRef(n.init) &&
            !eventBindings.has(n.id)) { eventBindings.add(n.id); grew = true; }
      });
    }
    const controlMethodOf = (n: N): string | null => {
      if (n.type !== "CallExpression" || !n.callee || n.callee.type !== "MemberExpression") return null;
      if (!isEventRef(n.callee.object)) return null;
      const m = memberName(n.callee);
      return m !== null && CONTROL.has(m) ? m : null;
    };
    // Nested functions that perform event control, by their binding.
    const controlFns = new Map<N, string>();
    eachNode(opts.root.body, (n) => {
      if (!isFn(n)) return;
      let method: string | null = null;
      eachNode(n.body, (x) => { if (method === null) method = controlMethodOf(x); });
      if (method === null) return;
      if (n.type === "FunctionDeclaration") controlFns.set(n, method);
    });
    eachNode(opts.root.body, (n) => {
      if (n.type === "VariableDeclarator" && n.id && n.id.type === "Identifier" && n.init && isFn(n.init)) {
        let method: string | null = null;
        eachNode(n.init.body, (x) => { if (method === null) method = controlMethodOf(x); });
        if (method !== null) controlFns.set(n.id, method);
      }
    });
    const walk = (n: N): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (n !== opts.root && isFn(n)) return;
      if (n.start > firstOwnAwait) {
        const m = controlMethodOf(n);
        if (m !== null) eventControlAfterAwait.push({ method: m });
        else if (n.type === "CallExpression" && n.callee && n.callee.type === "Identifier") {
          const via = controlFns.get(refs.get(n.callee));
          if (via) eventControlAfterAwait.push({ method: via });
        }
      }
      for (const key of Object.keys(n)) {
        if (key === "type" || key === "start" || key === "end") continue;
        const v = n[key];
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(opts.root.body);
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
