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
 *
 * S467 round 10 — dpa-023 F4 (§13.9.6): a waiting function may be bound ONLY by a `function`
 * declaration; every binding that holds one is refused (`waitingBindingsOf`, bottom of this
 * file). The pseudo-function colouring above therefore never reaches a SHIPPED artifact in the
 * async case: whenever it makes a binding async, the compile fails. It is KEPT (not removed)
 * because the emitters that read it — emit-functions (client sets), emit-server (D-5 closure,
 * ss1), emit-reactive-wiring, emit-client, scheduling — still run on a failing compile and
 * removing every reader widens this round's diff across six emitters for no shipped effect.
 * Round 9's escape judge (`escapingAsyncValuesOf`) is removed: the F4 judge supersedes it.
 */
import { armBlockStatementsDetailed } from "../arm-body-statements.ts";
import { parseExprToNode, parseExpression } from "../expression-parser.ts";
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

// ---------------------------------------------------------------------------
// S467 round 10 — dpa-023 F4 (§13.9.6): a waiting function is bound only by a
// `function` declaration.
// ---------------------------------------------------------------------------

/** A binding (or a write to one) whose value is, or may be, an async-colored function. */
export interface WaitingBinding {
  /** The binding's name as written (a destructuring pattern is shown as `{…}` / `[…]`). */
  name: string;
  /** The declaration / write node (diagnostic span). */
  node: AnyNode;
  /** `declared` — the initializer; `written` — a later write (`name = …`). */
  how: "declared" | "written";
  /**
   * True when only the FAIL-CLOSED text fallback refused it: the value holds text the compiler
   * did not parse into a tree (an escape hatch, a `match` arm) that mentions an async name.
   * The refusal stands; it is reported as a backstop (`cascadeOnly`) so a precise diagnostic
   * for the same unreadable text is not displaced by it.
   */
  textOnly: boolean;
}

const DECL_KINDS_F4 = new Set(["const-decl", "let-decl", "tilde-decl", "lin-decl"]);
const WRITE_OPS_F4 = new Set(["=", "||=", "&&=", "??="]);
/** Keys whose string value is never a reference (tags, names, operators, file paths). */
const NON_REF_STRING_KEYS = new Set([
  "kind", "id", "op", "litType", "fnStyle", "nativeKind", "exportKind", "exportedName", "filePath",
  "typeAnnotation", "name", "property", "fnKind", "boundary", "keyword",
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `text` mention one of `names` as an identifier (not as a `.member`)? */
function textMentions(text: string, names: readonly string[]): boolean {
  for (const n of names) {
    if (!n || n.startsWith("#")) continue;
    if (new RegExp(`(?<![\\w$.])${escapeRe(n)}(?![\\w$])`).test(text)) return true;
  }
  return false;
}

/**
 * The fail-closed TEXT rule, for an initializer the compiler did not parse into a tree: the
 * text may hold a waiting function when it writes a function value (`=>` / `function`) and
 * names an async function anywhere, or names one other than as the callee of a call
 * (`vp.bind(…)`, `(0, vp)`, `[vp]`, a tag). `name(…)` / `name?.(…)` alone is a call: its
 * result, which §13.2 keeps from being a waiting function.
 */
function textMayHoldWaitingFn(text: string, names: readonly string[]): boolean {
  if (!textMentions(text, names)) return false;
  if (/=>|\bfunction\b/.test(text)) return true;
  for (const n of names) {
    if (!n || n.startsWith("#")) continue;
    const re = new RegExp(`(?<![\\w$.])${escapeRe(n)}(?![\\w$])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!/^\s*(?:\?\.\s*)?\(/.test(text.slice(m.index + n.length))) return true;
    }
  }
  return false;
}

function isFnLiteralNode(e: AnyNode): boolean {
  return isFnValueExpr(e) || e.kind === "function-decl";
}

/**
 * Does the subtree reference an async-colored name in ANY position — a call, a value, a
 * name inside a nested function value? Fail closed: text the compiler did not parse into
 * a tree (an escape hatch, a `match` arm, a statement kept as text) counts when it
 * mentions an async name. The one subtree not counted is a function value handed straight
 * to a global fire-and-forget scheduler (§13.2: the scheduler discards its return, so it
 * does not make the enclosing function wait).
 */
function refsAsync(tree: unknown, isAsync: (n: string) => boolean, asyncNames: readonly string[]): boolean {
  const seen = new Set<unknown>();
  let hit = false;
  const visible = (names: readonly string[], shadow: ReadonlySet<string>): readonly string[] =>
    shadow.size === 0 ? names : names.filter((x) => !shadow.has(x));
  const walk = (n: unknown, key: string | null, owner: AnyNode | null, shadow: ReadonlySet<string>): void => {
    if (hit || n === null || n === undefined) return;
    if (typeof n === "string") {
      // Text kept beside its parsed form (`expr` + `exprNode`, `init` + `initExpr`, …) is read
      // from the tree; text with no tree is scanned (fail closed).
      if (key === null || NON_REF_STRING_KEYS.has(key)) return;
      if (owner && (owner[`${key}Node`] || owner[`${key}Expr`] || (key === "condition" && owner.condExpr))) return;
      if (textMentions(n, visible(asyncNames, shadow))) hit = true;
      return;
    }
    if (typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c, key, owner, shadow); return; }
    const node = n as AnyNode;
    if (node.kind === "lit") return; // a string literal is text, not a reference
    if ((node.kind === "ident" || node.kind === "shorthand") && typeof node.name === "string") {
      if (!shadow.has(node.name) && isAsync(node.name)) hit = true;
      return;
    }
    if (node.kind === "unary" && node.op === "typeof") return;
    // A function's parameters shadow an outer name of the same spelling in its whole body
    // (`const v = (w, p) => w(p)` beside an async `w` calls the parameter).
    let inner = shadow;
    if (isFnLiteralNode(node)) {
      const own = paramNamesOf(node.params);
      if (own.length) inner = new Set([...shadow, ...own]);
    }
    if (node.kind === "call") {
      const callee = node.callee as AnyNode | undefined;
      const sched = callee?.kind === "ident" && !shadow.has(String(callee.name)) && isGlobalSchedulerCallee(String(callee.name));
      walk(callee, "callee", node, inner);
      for (const a of (Array.isArray(node.args) ? node.args : []) as AnyNode[]) {
        if (sched && a && typeof a === "object" && isFnLiteralNode(a)) continue;
        walk(a, "args", node, inner);
      }
      return;
    }
    if (node.kind === "escape-hatch" && (node.nativeKind === "ArrowFunctionExpression" || node.nativeKind === "FunctionExpression")) {
      const body = fnValueBody(node);
      if (body === null) {
        if (typeof node.raw === "string" && textMentions(node.raw, visible(asyncNames, inner))) hit = true;
        return;
      }
      walk(body, null, node, inner);
      walk(node.params, null, node, inner);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "span") continue;
      walk(node[k], k, node, inner);
    }
  };
  walk(tree, null, null, new Set());
  return hit;
}

/** The names a parameter list binds (`a`, `a = 1`, `...rest`, a destructured parameter's names). */
function paramNamesOf(params: unknown): string[] {
  const out: string[] = [];
  for (const p of (Array.isArray(params) ? params : [])) {
    const raw = typeof p === "string" ? p : (p && typeof p === "object" ? (p as AnyNode).name : undefined);
    if (p && typeof p === "object" && Array.isArray((p as AnyNode).boundNames)) {
      for (const b of (p as AnyNode).boundNames as unknown[]) if (typeof b === "string") out.push(b);
    }
    if (typeof raw !== "string") continue;
    const m = raw.trim().replace(/^\.\.\./, "").match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (m && m[0] !== "__destructured__") out.push(m[0]);
  }
  return out;
}

/**
 * May the value of `expr` be — or hold — an async-colored function? (§13.9.6.) Read off the
 * parsed tree, failing closed:
 *   - a function value (lambda, function expression) anywhere in it whose body references an
 *     async-colored name (`refsAsync`) — a waiting function, whatever route takes it to the
 *     binding: the init itself, a ternary / `||` arm, an IIFE's callee, a returned function,
 *     an object property, a call argument;
 *   - an async-colored name used as anything but the callee of a direct call — an alias, a
 *     member read (`vp.bind(null)`), an element, a sequence operand;
 *   - text the compiler did not parse into a tree (an escape hatch, a `match` arm) that
 *     mentions one.
 * NOT a waiting value: a direct call `f(…)` — an async-colored function's RESULT; §13.2 refuses
 * every route by which a function body could hand back a waiting function —, a function value
 * passed as the first argument of an awaited collection method (`xs.some((h) =>
 * verifyPassword(p, h))` is data; the callback's own body is still searched for a function it
 * hands back), an argument of a global scheduler, `typeof f`, and a synchronous function value.
 */
export function mayHoldWaitingFn(
  expr: unknown,
  isAsync: (n: string) => boolean,
  asyncNames: readonly string[],
  combinators: ReadonlySet<string>,
): boolean {
  const seen = new Set<unknown>();
  let hit = false;
  const walk = (n: unknown): void => {
    if (hit || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const node = n as AnyNode;
    if (node.kind === "lit") return;
    if ((node.kind === "ident" || node.kind === "shorthand") && typeof node.name === "string") {
      if (isAsync(node.name)) hit = true;
      return;
    }
    if (node.kind === "unary" && node.op === "typeof") return;
    if (isFnLiteralNode(node)) {
      if (refsAsync(node, isAsync, asyncNames)) hit = true;
      return;
    }
    if (node.kind === "escape-hatch" && typeof node.raw === "string") {
      // A JS form the scrml tree does not model (a tagged template, a sequence, a
      // destructuring assignment…): judged on the JS parse of its text by the same rules;
      // text that does not parse as one JS expression fails closed on any mention.
      const est = parseExpression(node.raw, { tolerant: true }) as { ast: unknown; error: unknown; trailingContent?: string };
      if (est.ast && !est.error && !est.trailingContent) {
        if (estreeMayHoldWaitingFn(est.ast, isAsync, asyncNames, combinators)) hit = true;
      } else if (textMayHoldWaitingFn(node.raw, asyncNames)) hit = true;
      return;
    }
    if (node.kind === "match-expr") {
      // The arms are kept as text: each arm's RESULT (after its `=>` / `:>`) is judged by the
      // text rule (fail closed).
      for (const arm of (Array.isArray(node.rawArms) ? node.rawArms : []) as unknown[]) {
        if (typeof arm !== "string") continue;
        const m = /=>|:>/.exec(arm);
        if (textMayHoldWaitingFn(m ? arm.slice(m.index + 2) : arm, asyncNames)) { hit = true; return; }
      }
      walk(node.subjects ?? node.subject);
      return;
    }
    if (node.kind === "call") {
      const callee = node.callee as AnyNode | undefined;
      const args = (Array.isArray(node.args) ? node.args : []) as AnyNode[];
      const method = callee?.kind === "member" && typeof callee.property === "string" ? callee.property : null;
      const isCombinator = method !== null && combinators.has(method);
      const sched = callee?.kind === "ident" && isGlobalSchedulerCallee(String(callee.name));
      // A direct call's callee name is a call, not a value; any other callee (a member, a
      // function value — an IIFE —, a call result) is walked as a value.
      if (callee && callee.kind !== "ident") walk(callee);
      if (sched) return; // its arguments are discarded (§13.2)
      args.forEach((a, i) => {
        if (!a || typeof a !== "object") return;
        if (isCombinator && i === 0) {
          // Awaited in place: the callback is consumed, not held. What it RETURNS may still
          // be a function value — its body is searched for one (and for value uses).
          if (isFnLiteralNode(a)) { walkFnBody(a); return; }
          if (a.kind === "ident") return;
        }
        walk(a);
      });
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "span") continue;
      walk(node[k]);
    }
  };
  const walkFnBody = (fn: AnyNode): void => {
    if (fn.kind === "lambda") { walk((fn.body as AnyNode | undefined) ?? null); return; }
    const body = fnValueBody(fn);
    if (body === null) {
      if (typeof fn.raw === "string" && textMentions(fn.raw, asyncNames)) hit = true;
      return;
    }
    walk(body);
  };
  walk(expr);
  return hit;
}

type ESN = { type?: string; [k: string]: unknown };
const ES_FN_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration", "ClassExpression", "ClassDeclaration"]);

/** `refsAsync` over an ESTree subtree: any reference to an async name (a scheduler's function argument excepted). */
function estreeRefsAsync(tree: unknown, isAsync: (n: string) => boolean): boolean {
  let hit = false;
  const walk = (n: unknown, parent: ESN | null, key: string | null, shadow: ReadonlySet<string>): void => {
    if (hit || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) walk(c, parent, key, shadow); return; }
    const node = n as ESN;
    if (node.type === "Identifier" && typeof node.name === "string") {
      const nonRef = parent && ((parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
        (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand) ||
        (parent.type === "MethodDefinition" && key === "key" && !parent.computed));
      if (!nonRef && !shadow.has(node.name) && isAsync(node.name)) hit = true;
      return;
    }
    if (node.type === "UnaryExpression" && node.operator === "typeof") return;
    let inner = shadow;
    if (ES_FN_TYPES.has(String(node.type)) && Array.isArray(node.params)) {
      const own: string[] = [];
      for (const p of node.params as unknown[]) estreePatternNames(p, own);
      if (own.length) inner = new Set([...shadow, ...own]);
    }
    if (node.type === "CallExpression") {
      const callee = node.callee as ESN | undefined;
      const sched = callee?.type === "Identifier" && !shadow.has(String(callee.name)) && isGlobalSchedulerCallee(String(callee.name));
      walk(callee, node, "callee", inner);
      for (const a of (node.arguments as ESN[] | undefined) ?? []) {
        if (sched && a && ES_FN_TYPES.has(String(a.type))) continue;
        walk(a, node, "arguments", inner);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" || k === "range") continue;
      walk(node[k], node, k, inner);
    }
  };
  walk(tree, null, null, new Set());
  return hit;
}

/** The names an ESTree binding pattern binds. */
function estreePatternNames(p: unknown, out: string[]): void {
  if (!p || typeof p !== "object") return;
  const n = p as ESN;
  if (n.type === "Identifier" && typeof n.name === "string") out.push(n.name);
  else if (n.type === "AssignmentPattern") estreePatternNames(n.left, out);
  else if (n.type === "RestElement") estreePatternNames(n.argument, out);
  else if (n.type === "ArrayPattern") for (const e of (n.elements as unknown[] | undefined) ?? []) estreePatternNames(e, out);
  else if (n.type === "ObjectPattern") {
    for (const pr of (n.properties as ESN[] | undefined) ?? []) {
      if (pr && pr.type === "RestElement") estreePatternNames(pr.argument, out);
      else if (pr) estreePatternNames(pr.value, out);
    }
  }
}

/** `mayHoldWaitingFn` over an ESTree expression (an escape hatch's parsed text). */
function estreeMayHoldWaitingFn(
  tree: unknown,
  isAsync: (n: string) => boolean,
  asyncNames: readonly string[],
  combinators: ReadonlySet<string>,
): boolean {
  void asyncNames;
  let hit = false;
  const walk = (n: unknown, parent: ESN | null, key: string | null): void => {
    if (hit || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) walk(c, parent, key); return; }
    const node = n as ESN;
    if (node.type === "Identifier" && typeof node.name === "string") {
      const nonRef = parent && ((parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
        (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand));
      if (!nonRef && isAsync(node.name)) hit = true;
      return;
    }
    if (node.type === "UnaryExpression" && node.operator === "typeof") return;
    if (ES_FN_TYPES.has(String(node.type))) {
      if (estreeRefsAsync(node, isAsync)) hit = true;
      return;
    }
    if (node.type === "Property" && node.shorthand) { walk(node.value, node, "value"); return; }
    if (node.type === "CallExpression" || node.type === "TaggedTemplateExpression") {
      const callee = (node.type === "CallExpression" ? node.callee : node.tag) as ESN | undefined;
      // A direct call's callee name is a call, not a value (a tag is called too).
      if (callee && callee.type !== "Identifier") walk(callee, node, "callee");
      if (node.type === "TaggedTemplateExpression") { walk(node.quasi, node, "quasi"); return; }
      if (callee?.type === "Identifier" && isGlobalSchedulerCallee(String(callee.name))) return;
      const method = callee?.type === "MemberExpression" && !callee.computed && (callee.property as ESN | undefined)?.type === "Identifier"
        ? String((callee.property as ESN).name) : null;
      const isCombinator = method !== null && combinators.has(method);
      ((node.arguments as ESN[] | undefined) ?? []).forEach((a, i) => {
        if (!a || typeof a !== "object") return;
        if (isCombinator && i === 0) {
          if (a.type === "Identifier") return;
          if (a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") {
            walk(a.body, a, "body"); // consumed in place; search what it hands back
            return;
          }
        }
        walk(a, node, "arguments");
      });
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" || k === "range") continue;
      walk(node[k], node, k);
    }
  };
  walk(tree, null, null);
  return hit;
}

/** The names a destructuring pattern (`const [a, b] = …`, `for (const { a: r } of …)`) binds. */
function patternNames(p: unknown): string[] {
  const out: string[] = [];
  const visit = (q: unknown): void => {
    if (!q || typeof q !== "object") return;
    const n = q as AnyNode;
    if (typeof n.rest === "string" && n.rest) out.push(n.rest.replace(/^\.\.\./, ""));
    const items = (n.kind === "destructure-array" ? n.elements : n.kind === "destructure-object" ? n.properties : null) as AnyNode[] | null;
    for (const it of items ?? []) {
      if (!it || typeof it !== "object") continue;
      if (it.kind === "name") {
        const b = typeof it.bindName === "string" ? it.bindName : it.name;
        if (typeof b === "string" && b) out.push(b);
      } else if (it.kind === "nested") visit(it.pattern);
    }
  };
  visit(p);
  return out;
}

/**
 * Node kinds that bind no name for their children: the F4 judge's shadow set passes through
 * them unchanged (`waitingBindingsOf` / `childShadow`). Any kind not listed is treated as one
 * that may re-bind a name, and its children see no shadow (fail closed).
 */
const SHADOW_TRANSPARENT_KINDS = new Set([
  // statements
  "if-stmt", "if-expr", "if-chain", "while-stmt", "do-while-stmt", "return-stmt", "throw-stmt",
  "bare-expr", "const-decl", "let-decl", "lin-decl", "tilde-decl", "lift-expr", "fail-expr",
  "propagate-expr", "break-stmt", "continue-stmt", "defer-stmt", "yield-stmt", "export-decl",
  "reactive-assign", "reactive-nested-assign", "reactive-explicit-set", "reactive-array-mutation",
  // expressions (a lambda's `expr` / `block` body record included)
  "expr", "block", "ident", "lit", "array", "object", "prop", "shorthand", "spread", "unary",
  "binary", "assign", "ternary", "member", "index", "call", "new", "cast", "map-lit", "template",
  "quasi", "tpl", "is-not", "is-not-not", "is-some", "is-variant", "reset-expr", "sql-ref",
  "input-state-ref", "escape-hatch",
]);

function bindingNameOf(n: AnyNode): string {
  const nm = n.kind === "export-decl" ? n.exportedName : n.name;
  if (typeof nm === "string" && nm) return nm;
  if (nm && typeof nm === "object") return (nm as AnyNode).kind === "destructure-array" ? "[…]" : "{…}";
  return "(binding)";
}

/**
 * §13.9.6 — every binding in a file's logic (file scope, value-only library modules, nested
 * function bodies and blocks: every `const` / `let` / `lin` / tilde declaration and every
 * `export const` / `let` / `var`) and every later write (`name = …`, `||=` / `&&=` / `??=`, a
 * block-nested tilde re-declaration, a member store `o.k = …`) whose value is or may be an
 * async-colored function (`mayHoldWaitingFn`). Each is E-ASYNC-FN-ESCAPES-AS-VALUE.
 * `isAsync` / `asyncNames` are the file's one async set (file-async-fns.ts).
 */
export function waitingBindingsOf(
  topStmts: unknown[],
  isAsync: (n: string) => boolean,
  asyncNames: readonly string[],
  combinators: ReadonlySet<string>,
): WaitingBinding[] {
  const out: WaitingBinding[] = [];
  if (asyncNames.length === 0) return out;
  const reported = new Set<string>();
  const seen = new Set<unknown>();
  // `shadow`: the names the binding's lexical scope chain binds to something OTHER than the
  // file-scope async function of that spelling — a parameter of an enclosing function, or a
  // const / let / lin of an enclosing block whose own value is not waiting (`blockShadows`).
  // A reference to one of them resolves to that binding, not to the async function.
  const visibleNames = (shadow: ReadonlySet<string>): readonly string[] =>
    shadow.size === 0 ? asyncNames : asyncNames.filter((x) => !shadow.has(x));
  const judgeIn = (value: unknown, text: unknown, shadow: ReadonlySet<string>, names: readonly string[]): boolean => {
    const isAsyncHere = shadow.size === 0 ? isAsync : (n: string): boolean => !shadow.has(n) && isAsync(n);
    if (value && typeof value === "object") return mayHoldWaitingFn(value, isAsyncHere, names, combinators);
    if (typeof text === "string" && text.trim()) {
      // No parsed initializer: parse it; else fail closed on any mention.
      let parsed: unknown = null;
      try { parsed = parseExprToNode(text, "<f4>", 0); } catch { parsed = null; }
      return parsed ? mayHoldWaitingFn(parsed, isAsyncHere, names, combinators) : textMayHoldWaitingFn(text, names);
    }
    return false;
  };
  const check = (value: unknown, text: unknown, node: AnyNode, name: string, how: WaitingBinding["how"], shadow: ReadonlySet<string>): void => {
    const span = node.span as { start?: number } | undefined;
    const key = `${name}@${span?.start ?? "?"}`;
    if (reported.has(key)) return;
    // `names` = [] turns every text fallback off: the tree-only verdict.
    if (!judgeIn(value, text, shadow, visibleNames(shadow))) return;
    reported.add(key);
    out.push({ name, node, how, textOnly: !judgeIn(value, text, shadow, []) });
  };
  /**
   * The shadow set of a NESTED statement list (a function body, a block) for its whole extent.
   * A name is ADDED for each `const` / `let` / `lin` declared directly in it under a plain
   * identifier whose own value, judged in the enclosing scope, is not waiting. A name is
   * REMOVED — the list re-binds it to something that may wait, so a reference to it is read
   * as the async function again (fail closed) — for each `function` declaration in it (hoisted
   * over the whole list; a nested helper is in the async set by name), each `const` / `let` /
   * `lin` whose own value may be waiting (that declaration is the one refused), and each name
   * a destructuring declaration in it binds. Never shadowing: a tilde declaration (block-nested,
   * it is a write to the outer name), and every file-scope binding.
   */
  const blockShadows = (stmts: unknown[], shadow: ReadonlySet<string>): ReadonlySet<string> => {
    let inner: Set<string> | null = null;
    const drop = (name: string): void => {
      if ((inner ?? shadow).has(name)) (inner ??= new Set(shadow)).delete(name);
    };
    for (const c of stmts) {
      const d = c as AnyNode | null;
      if (!d || typeof d !== "object") continue;
      if (d.kind === "function-decl" && typeof d.name === "string") drop(d.name);
      else if ((d.kind === "const-decl" || d.kind === "let-decl" || d.kind === "lin-decl") && d.name && typeof d.name === "object") {
        for (const b of patternNames(d.name)) drop(b);
      }
    }
    const base: ReadonlySet<string> = inner ?? shadow;
    for (const c of stmts) {
      const d = c as AnyNode | null;
      if (!d || typeof d !== "object") continue;
      if (d.kind !== "const-decl" && d.kind !== "let-decl" && d.kind !== "lin-decl") continue;
      if (typeof d.name !== "string" || !d.name || !isAsync(d.name)) continue;
      if (judgeIn(d.initExpr, d.init, base, visibleNames(base))) drop(d.name);
      else if (!(inner ?? shadow).has(d.name)) (inner ??= new Set(shadow)).add(d.name);
    }
    return inner ?? shadow;
  };
  /**
   * The shadow set a node's CHILDREN see. Only a node kind that binds no name for its
   * children passes the set through unchanged; a function literal adds its parameters and
   * drops its own name (a named function expression's name is bound inside it); a `for`
   * loop drops the names its header binds; every other kind — a `match` arm's payload, a
   * `!{}` arm's error binding, a `catch` header, a `given` guard, markup, anything not listed —
   * may re-bind a name, so its children see no shadow at all (fail closed: every async
   * spelling is read as the async function there).
   */
  const childShadow = (node: AnyNode, shadow: ReadonlySet<string>): ReadonlySet<string> => {
    if (isFnLiteralNode(node)) {
      const self = node.kind === "escape-hatch" && typeof node.fnName === "string" ? node.fnName : null;
      const own = paramNamesOf(node.params);
      if (self === null || !shadow.has(self) || own.includes(self)) {
        const add = own.filter((x) => !shadow.has(x));
        return add.length ? new Set([...shadow, ...add]) : shadow;
      }
      const s = new Set(shadow);
      s.delete(self);
      for (const x of own) s.add(x);
      return s;
    }
    if (shadow.size === 0) return shadow;
    if (typeof node.kind !== "string") return shadow; // a structural record of its owner
    if (node.kind === "for-stmt" || node.kind === "for-expr") {
      if (node.variable == null) return new Set(); // C-style header: bindings held as text
      const bound = typeof node.variable === "string" ? [node.variable] : patternNames(node.variable);
      if (!bound.some((b) => shadow.has(b))) return shadow;
      const s = new Set(shadow);
      for (const b of bound) s.delete(b);
      return s;
    }
    return SHADOW_TRANSPARENT_KINDS.has(node.kind) ? shadow : new Set();
  };
  const walk = (n: unknown, nested: boolean, shadow: ReadonlySet<string>): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      const here = nested ? blockShadows(n, shadow) : shadow;
      n.forEach((c, i) => {
        // An export whose initializer the builder split off into the NEXT statement
        // (`export const x = match … { … }` — the export keeps `=` with nothing after it):
        // the value is that statement, judged by any mention (fail closed).
        const e = c as AnyNode | null;
        if (e && typeof e === "object" && e.kind === "export-decl" && !e.valueInitExpr && typeof e.raw === "string" &&
          /=\s*$/.test(e.raw) && i + 1 < n.length && refsAsync(n[i + 1], isAsync, asyncNames)) {
          const key = `${bindingNameOf(e)}@${(e.span as { start?: number } | undefined)?.start ?? "?"}`;
          if (!reported.has(key)) {
            reported.add(key);
            out.push({ name: bindingNameOf(e), node: e, how: "declared", textOnly: !refsAsync(n[i + 1], isAsync, []) });
          }
        }
        walk(c, nested, here);
      });
      return;
    }
    const node = n as AnyNode;
    if (typeof node.kind === "string" && DECL_KINDS_F4.has(node.kind)) {
      // A block-nested tilde declaration of an outer name is a WRITE to it.
      check(node.initExpr, node.init, node, bindingNameOf(node), node.kind === "tilde-decl" && nested ? "written" : "declared", shadow);
    } else if (node.kind === "export-decl" && (node.exportKind === "const" || node.exportKind === "let" || node.exportKind === "var") &&
      !node.reExportSource) {
      const raw = typeof node.raw === "string" ? node.raw : "";
      const eq = raw.indexOf("=");
      check(node.valueInitExpr, node.valueInitExpr ? null : (eq >= 0 ? raw.slice(eq + 1) : null), node, bindingNameOf(node), "declared", shadow);
    } else if (node.kind === "assign" && WRITE_OPS_F4.has(String(node.op))) {
      const t = node.target as AnyNode | undefined;
      const name = t && t.kind === "ident" && typeof t.name === "string" ? t.name
        : t && t.kind === "member" && typeof t.property === "string" ? `….${t.property}` : "(target)";
      check(node.value, null, node, name, "written", shadow);
    }
    // A function's parameters shadow an outer name of the same spelling in its whole body
    // (`function eqx(check, b) { const g = check … }` aliases the parameter); a node that may
    // re-bind a name hands its children a smaller set (`childShadow`).
    const inner = childShadow(node, shadow);
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "valueInitExpr") continue;
      const c = node[k];
      if (c && typeof c === "object") walk(c, true, inner);
    }
  };
  walk(Array.isArray(topStmts) ? topStmts : [], false, new Set());
  return out;
}
