/**
 * fn-valued-bindings.ts — S465 r6 (g-top-level-async-closure-called-later-accept-all).
 *
 * A top-level binding whose value is a function — `const inner = (p, h) => verifyPassword(p, h)`,
 * `const g = function (a) { … }`, `let f = (x) => { … }`, `export const e = (p) => …` — IS a
 * function in every respect the async coloring cares about (SPEC §13.2: "An async-colored
 * function is one the compiler emits `async`: a server function, a Promise-returning
 * standard-library function, or any function that (transitively) calls one"). Before r6 the
 * coloring (`computeAsyncFnNames`) saw `function` declarations only, so such a binding was
 * emitted sync, its caller did not await it, and `if (!check(pass, hash))` tested a Promise —
 * a wrong password was accepted, in-file and across an import (`check` in a lib calling the
 * lambda `inner`).
 *
 * This module turns each such binding into a PSEUDO function declaration (`{ kind:
 * "function-decl", name, body }`) the coloring fixpoint reads alongside the real ones, so the
 * colour flows through the binding exactly as through a declaration. The body is the TREE:
 * an expression-bodied lambda's expression node; a block-bodied one (an escape hatch in the
 * expression parser) is read by the function-body statement parser. A body the parser
 * cannot read is `readable: false` — the coloring then cannot see its calls, and the emitter
 * lowering it from text refuses any call in it (server-text-guard.ts: fail closed).
 */
import { armBlockStatementsDetailed } from "../arm-body-statements.ts";
import { parseExprToNode } from "../expression-parser.ts";
import { isWholeBraceBlock } from "../brace-pair.ts";
import { isGlobalSchedulerCallee } from "./async-combinators.ts";
export interface FnValuedBinding {
  name: string;
  /** `const` / `let` / `var` — the binding keyword. */
  keyword: string;
  /** True for an `export const …` (an export-decl; its init is the builder-parsed `valueInitExpr`). */
  exported: boolean;
  /**
   * True when the init IS a function literal (`(p) => …`, `function (…) { … }`, an `async`
   * arrow, a parenthesised one — parens and casts are gone in the parsed tree): the binding
   * is a function, emitted as one. False when the init only MAY evaluate to a function (a
   * ternary or `||` / `&&` / `??` arm, an alias, a reassigned `let`).
   */
  literal: boolean;
  /** The pseudo function declaration the coloring fixpoint reads. */
  pseudoFn: { kind: "function-decl"; name: string; body: unknown[]; isAsync?: boolean; _fnValuedBinding: true };
  /** False when a block body could not be read (its calls are invisible to the coloring). */
  readable: boolean;
  /**
   * The function values the binding hands out by a route OTHER than being one itself —
   * an anonymous function selected by an expression, a function a function value returns,
   * an alias of a named function, a function assigned to a `let` later. Each is a name in
   * the coloring (an anonymous one is a pseudo function in `anonPseudoFns`, named with a
   * `#` no identifier can carry). §13.2: an async-colored function SHALL NOT be aliased,
   * stored or returned — `escapingAsyncValuesOf` refuses each one that comes out async.
   */
  escapes: Array<{ name: string; what: string }>;
  /** The anonymous function values of `escapes`, as pseudo functions for the fixpoint. */
  anonPseudoFns: Array<{ kind: "function-decl"; name: string; body: unknown[]; isAsync?: boolean; _fnValuedBinding: true }>;
  /** The binding's declaration node (diagnostic span). */
  node: AnyNode;
}

type AnyNode = { kind?: string; [k: string]: unknown };
type PseudoFn = FnValuedBinding["pseudoFn"];

function isFnValueExpr(e: AnyNode | null | undefined): boolean {
  if (!e || typeof e !== "object") return false;
  if (e.kind === "lambda" || e.kind === "Arrow" || e.kind === "Function") return true;
  return e.kind === "escape-hatch" &&
    (e.nativeKind === "ArrowFunctionExpression" || e.nativeKind === "FunctionExpression");
}

/** A function literal written `async` (a tree lambda's flag, or acorn's on an escape hatch). */
function isDeclaredAsync(e: AnyNode): boolean {
  return e.isAsync === true;
}

/**
 * The pseudo body of a function value expression: its tree, or null when unreadable.
 * S466 r7 (MED-D) — a block-bodied value's body is the one acorn delimited
 * (`EscapeHatchExpr.bodyRaw`), read by the function-body statement parser; it is never
 * found by splitting the text (the r6 split took the first `=>` and counted parens
 * inside strings: `(a, s = "=>") => { … }` was unreadable).
 */
function fnValueBody(e: AnyNode): unknown[] | null {
  if (e.kind === "function-decl") return Array.isArray(e.body) ? e.body as unknown[] : null;
  if (e.kind !== "escape-hatch") return [e];
  const body = typeof e.bodyRaw === "string" ? e.bodyRaw : null;
  if (body === null || !isWholeBraceBlock(body)) return null;
  if (!body.slice(1, -1).trim()) return [];
  const r = armBlockStatementsDetailed(body);
  return r && r.ok ? r.stmts : null;
}

type Leaf = { kind: "fn"; node: AnyNode } | { kind: "ident"; name: string } | { kind: "other" };

/**
 * S467 r9 (HIGH-1) — the VALUES an expression can evaluate to, read off the parsed tree:
 * each arm of a ternary, each operand of `||` / `&&` / `??` (any of them can be the
 * result), else the expression itself. Parentheses and `as` casts leave no node. A
 * leaf is a function literal, an identifier (the binding then aliases whatever that name
 * holds), or anything else (a call result, a member read, a literal…) — which no scrml
 * code can make an async function: every place a scrml function value could leave its
 * declaration as a value is refused at that place (§13.2), so only a literal or a name
 * can carry one here.
 */
function valueLeaves(e: AnyNode | null | undefined, out: Leaf[] = []): Leaf[] {
  if (!e || typeof e !== "object") return out;
  if (e.kind === "ternary") {
    valueLeaves(e.consequent as AnyNode, out);
    valueLeaves(e.alternate as AnyNode, out);
    return out;
  }
  if (e.kind === "binary" && (e.op === "||" || e.op === "&&" || e.op === "??")) {
    valueLeaves(e.left as AnyNode, out);
    valueLeaves(e.right as AnyNode, out);
    return out;
  }
  if (e.kind === "assign" && (e.op === "=" || e.op === "||=" || e.op === "&&=" || e.op === "??=")) {
    return valueLeaves(e.value as AnyNode, out);
  }
  if (isFnValueExpr(e) || e.kind === "function-decl") out.push({ kind: "fn", node: e });
  else if (e.kind === "ident" && typeof e.name === "string") out.push({ kind: "ident", name: e.name });
  else out.push({ kind: "other" });
  return out;
}

/**
 * The values a function value RETURNS: an expression body's value leaves, or the
 * leaves of every `return` in a block body (a returned `function (…) { … }` is the
 * statement's `fnExprNode`). Nested function values are their own scope — their returns
 * are theirs. An unreadable body returns null (its returns cannot be seen).
 */
function returnedLeaves(fn: AnyNode): Leaf[] | null {
  if (fn.kind === "lambda") {
    const b = fn.body as AnyNode | undefined;
    if (b && b.kind === "expr") return valueLeaves(b.value as AnyNode);
  }
  const body = fnValueBody(fn);
  if (body === null) return null;
  if (fn.kind === "lambda") {
    // A block-bodied tree lambda: its statements are `body.stmts` / `body.body`.
    const b = fn.body as AnyNode | undefined;
    const stmts = (b && (Array.isArray(b.stmts) ? b.stmts : Array.isArray(b.body) ? b.body : null)) as unknown[] | null;
    if (stmts === null) return [];
    return returnsIn(stmts);
  }
  return returnsIn(body);
}

function returnsIn(stmts: unknown): Leaf[] {
  const out: Leaf[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const node = n as AnyNode;
    if (node.kind === "function-decl" || isFnValueExpr(node)) return; // a nested function's returns are its own
    if (node.kind === "return-stmt") {
      if (node.fnExprNode && typeof node.fnExprNode === "object") out.push({ kind: "fn", node: node.fnExprNode as AnyNode });
      else valueLeaves(node.exprNode as AnyNode | undefined, out);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "span") continue;
      walk(node[k]);
    }
  };
  walk(stmts);
  return out;
}

/** Every `NAME = …` (and `||=` / `&&=` / `??=`) value written to one of `names` beneath `tree`. */
function assignedValuesOf(tree: unknown, names: ReadonlySet<string>): Map<string, AnyNode[]> {
  const out = new Map<string, AnyNode[]>();
  if (names.size === 0) return out;
  const seen = new Set<unknown>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const node = n as AnyNode;
    if (node.kind === "assign" && (node.op === "=" || node.op === "||=" || node.op === "&&=" || node.op === "??=")) {
      const t = node.target as AnyNode | undefined;
      if (t && t.kind === "ident" && typeof t.name === "string" && names.has(t.name)) {
        if (!out.has(t.name)) out.set(t.name, []);
        out.get(t.name)!.push(node.value as AnyNode);
      }
    }
    for (const k of Object.keys(node)) {
      if (k === "span") continue;
      walk(node[k]);
    }
  };
  walk(tree);
  return out;
}

const callOf = (name: string): AnyNode => ({ kind: "call", callee: { kind: "ident", name }, args: [] });

/**
 * The file-scope bindings among `topStmts` (a file's logic-block bodies) whose value is,
 * or may be, a function — classified from the PARSED init, never from its text.
 *
 * S467 r9 (HIGH-1) — before r9 only an init that IS a function literal was seen, and the
 * builder only parsed the inits of some export shapes, so `export const inner = ((p, h) =>
 * …)`, `= async (p, h) => …`, `= c ? (…) => … : …`, `= vp` (an async import) and `= (p) =>
 * (h) => …` were never coloured async: callers tested a Promise. Now every init is read:
 *   - a function literal (any spelling — the parse leaves no parens) is the binding's
 *     function: its body colours it, and so does a written `async`;
 *   - otherwise each value the init can evaluate to (`valueLeaves`) — and, for a `let`,
 *     each value assigned to it later — that is a function literal or a name is an
 *     ESCAPE: the binding's pseudo body calls it, so the binding is async when any of them
 *     is (fail closed: every call to the binding is awaited), and an async one is
 *     refused (`escapingAsyncValuesOf`);
 *   - a function literal's RETURNED function values are escapes too (a curried arrow).
 * A binding whose init has no function or name among its values (`const n = 1`,
 * `const r = load()`) is not a function value and is not listed.
 */
export function fnValuedBindingsOf(topStmts: unknown[]): FnValuedBinding[] {
  const out: FnValuedBinding[] = [];
  const stmts = (Array.isArray(topStmts) ? topStmts : []) as AnyNode[];
  type Decl = { name: string; keyword: string; init: AnyNode | null; exported: boolean; node: AnyNode };
  const decls: Decl[] = [];
  for (const s of stmts) {
    if (!s || typeof s !== "object") continue;
    // Every binding form: `const` / `let`, a `lin` binding, and a bare `name = …`
    // (a tilde declaration — a second one of a name already declared is a WRITE to it).
    if ((s.kind === "const-decl" || s.kind === "let-decl" || s.kind === "tilde-decl" || s.kind === "lin-decl") &&
      typeof s.name === "string") {
      let init = (s.initExpr as AnyNode | undefined) ?? null;
      if (!init && typeof s.init === "string") {
        try { init = parseExprToNode(s.init, "<fn-value>", 0) as unknown as AnyNode | null; } catch { init = null; }
      }
      const keyword = s.kind === "let-decl" ? "let" : s.kind === "tilde-decl" ? "~" : s.kind === "lin-decl" ? "lin" : "const";
      decls.push({ name: s.name, keyword, init, exported: false, node: s });
    } else if (s.kind === "export-decl" && (s.exportKind === "const" || s.exportKind === "let" || s.exportKind === "var") &&
      typeof s.exportedName === "string" && !s.reExportSource) {
      // S466 r8 (HIGH-2, Rule 7) — the init is the node the AST builder parsed
      // (`valueInitExpr`, annotated or not; S467 r9 — every plain-named value export
      // carries one), never a regex over `raw`.
      decls.push({ name: s.exportedName, keyword: String(s.exportKind), init: (s.valueInitExpr as AnyNode | undefined) ?? null,
        exported: true, node: s });
    }
  }
  // A mutable binding's later writes are values it can hold too: an assignment anywhere in
  // the file's logic, and a later declaration of the same name.
  const mutable = new Set(decls.filter((d) => d.keyword !== "const" && d.keyword !== "lin").map((d) => d.name));
  const assigned = assignedValuesOf(stmts, mutable);
  const primary = new Map<string, Decl>();
  for (const d of decls) {
    if (!primary.has(d.name)) { primary.set(d.name, d); continue; }
    if (!assigned.has(d.name)) assigned.set(d.name, []);
    if (d.init) assigned.get(d.name)!.push(d.init);
  }

  for (const d of primary.values()) {
    const { name, init } = d;
    let anon = 0;
    const anonPseudoFns: PseudoFn[] = [];
    const escapes: FnValuedBinding["escapes"] = [];
    const body: unknown[] = [];
    let readable = true;
    const escapeLeaf = (leaf: Leaf, what: string): void => {
      if (leaf.kind === "ident") {
        if (leaf.name === name) return;
        escapes.push({ name: leaf.name, what });
        body.push(callOf(leaf.name));
      } else if (leaf.kind === "fn") {
        const pname = `#${name}:${anon++}`;
        const fbody = fnValueBody(leaf.node);
        // An escaping function whose body cannot be read cannot be shown sync: it is
        // treated as async (fail closed) — `isAsync` seeds it in the fixpoint.
        const pf: PseudoFn = { kind: "function-decl", name: pname, body: fbody ?? [], _fnValuedBinding: true,
          ...((fbody === null || isDeclaredAsync(leaf.node)) ? { isAsync: true } : {}) };
        anonPseudoFns.push(pf);
        escapes.push({ name: pname, what });
        body.push(callOf(pname));
        // A function returned by that function escapes with it.
        for (const r of returnedLeaves(leaf.node) ?? []) escapeLeaf(r, "returned by a function value");
      }
    };
    const literal = !!init && isFnValueExpr(init);
    let declaredAsync = false;
    if (literal) {
      const fbody = fnValueBody(init as AnyNode);
      readable = fbody !== null;
      for (const c of fbody ?? []) body.push(c);
      declaredAsync = isDeclaredAsync(init as AnyNode);
      for (const r of returnedLeaves(init as AnyNode) ?? []) escapeLeaf(r, "returned by a function value");
    } else {
      for (const leaf of valueLeaves(init)) escapeLeaf(leaf, "selected by an expression");
    }
    for (const v of assigned.get(name) ?? []) for (const leaf of valueLeaves(v)) escapeLeaf(leaf, "assigned to it later");
    if (!literal && escapes.length === 0) continue;
    out.push({
      name,
      keyword: d.keyword,
      exported: d.exported,
      literal,
      pseudoFn: { kind: "function-decl", name, body, _fnValuedBinding: true, ...(declaredAsync ? { isAsync: true } : {}) },
      readable,
      escapes,
      anonPseudoFns,
      node: d.node,
    });
  }
  return out;
}

/** Every pseudo function the coloring fixpoint reads for these bindings (each binding + its anonymous escapes). */
export function bindingPseudoFnsOf(bindings: FnValuedBinding[]): PseudoFn[] {
  const out: PseudoFn[] = [];
  for (const b of bindings) { out.push(b.pseudoFn); for (const a of b.anonPseudoFns) out.push(a); }
  return out;
}

/** True for a pseudo name of an anonymous function value (never an identifier). */
export function isAnonFnValueName(name: string): boolean {
  return name.startsWith("#");
}

/**
 * S467 r9 — SPEC §13.2: "An async-colored function SHALL NOT be used as a value … aliasing
 * it, storing it …, returning it … SHALL be a compile error (`E-ASYNC-FN-ESCAPES-AS-VALUE`)."
 * The escapes of every file-scope binding (`fnValuedBindingsOf`) that come out async in the
 * file's set — one per binding (its first async escape).
 */
export function escapingAsyncValuesOf(bindings: FnValuedBinding[], isAsync: (name: string) => boolean):
  Array<{ binding: FnValuedBinding; name: string; what: string }> {
  const out: Array<{ binding: FnValuedBinding; name: string; what: string }> = [];
  for (const b of bindings) {
    const e = b.escapes.find((x) => isAsync(x.name));
    if (e) out.push({ binding: b, name: e.name, what: e.what });
  }
  return out;
}


/**
 * S465 r6 — the names in `tree` (an expression node, a statement list, or a function
 * value's body) that are used as a VALUE while `isAsync(name)` holds: SPEC §13.2 "An
 * async-colored function SHALL NOT be used as a value … aliasing it, storing it in an
 * array or object, returning it … SHALL be a compile error (`E-ASYNC-FN-ESCAPES-AS-VALUE`)".
 * Not a value use: the callee of a call (`w(…)` — awaited where the position allows, else
 * the sync-callback error), the first argument of an awaited collection method
 * (`xs.some(w)`), an argument of a global scheduler, and `typeof w`. The walk descends
 * nested function values (a lambda returning `w` returns it).
 */
export function asyncValueUsesIn(tree: unknown, isAsync: (name: string) => boolean, combinators: ReadonlySet<string>): Array<{ name: string; span: unknown }> {
  const out: Array<{ name: string; span: unknown }> = [];
  const seen = new Set<unknown>();
  const walk = (n: unknown, skipIdent: boolean): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c, false); return; }
    const node = n as AnyNode;
    if (node.kind === "ident" && typeof node.name === "string") {
      if (!skipIdent && isAsync(node.name)) out.push({ name: node.name, span: node.span });
      return;
    }
    if (node.kind === "unary" && node.op === "typeof") return;
    if (node.kind === "call") {
      const callee = node.callee as AnyNode | undefined;
      walk(callee, callee?.kind === "ident");
      const args = (Array.isArray(node.args) ? node.args : []) as AnyNode[];
      const method = callee?.kind === "member" && typeof callee.property === "string" ? callee.property : null;
      const isCombinator = method !== null && combinators.has(method);
      const isScheduler = callee?.kind === "ident" && isGlobalSchedulerCallee(String(callee.name));
      args.forEach((a, i) => walk(a, (isCombinator && i === 0) || isScheduler));
      return;
    }
    if (node.kind === "escape-hatch" &&
      (node.nativeKind === "ArrowFunctionExpression" || node.nativeKind === "FunctionExpression")) {
      walk(fnValueBody(node) ?? [], false);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "callee") continue;
      walk(node[k], false);
    }
  };
  walk(tree, false);
  return out;
}

/**
 * S465 r6 — a copy of a function-valued binding's declaration whose value is marked
 * async: a tree lambda gets `isAsync` (emitLambda emits `async (…) => …` and an
 * awaitable body); a block-bodied escape hatch gets `_asyncFnValue` (emitEscapeHatch
 * lowers its body from the tree in an async function). S466 r7 — shared by the server
 * D-5 closure and the client's top-level emission (MED-C).
 */
export function asyncFnValueDecl(decl: any): any {
  const init = decl?.initExpr;
  if (!init || typeof init !== "object") return decl;
  if (init.kind === "lambda") return { ...decl, initExpr: { ...init, isAsync: true } };
  if (init.kind === "escape-hatch") return { ...decl, initExpr: { ...init, _asyncFnValue: true } };
  return decl;
}
