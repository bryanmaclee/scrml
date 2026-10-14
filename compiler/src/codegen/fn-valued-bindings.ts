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
  /** The pseudo function declaration the coloring fixpoint reads. */
  pseudoFn: { kind: "function-decl"; name: string; body: unknown[]; _fnValuedBinding: true };
  /** False when a block body could not be read (its calls are invisible to the coloring). */
  readable: boolean;
}

type AnyNode = { kind?: string; [k: string]: unknown };

function isFnValueExpr(e: AnyNode | null | undefined): boolean {
  if (!e || typeof e !== "object") return false;
  if (e.kind === "lambda" || e.kind === "Arrow" || e.kind === "Function") return true;
  return e.kind === "escape-hatch" &&
    (e.nativeKind === "ArrowFunctionExpression" || e.nativeKind === "FunctionExpression");
}

/**
 * The pseudo body of a function value expression: its tree, or null when unreadable.
 * S466 r7 (MED-D) — a block-bodied value's body is the one acorn delimited
 * (`EscapeHatchExpr.bodyRaw`), read by the function-body statement parser; it is never
 * found by splitting the text (the r6 split took the first `=>` and counted parens
 * inside strings: `(a, s = "=>") => { … }` was unreadable).
 */
function fnValueBody(e: AnyNode): unknown[] | null {
  if (e.kind !== "escape-hatch") return [e];
  const body = typeof e.bodyRaw === "string" ? e.bodyRaw : null;
  if (body === null || !isWholeBraceBlock(body)) return null;
  if (!body.slice(1, -1).trim()) return [];
  const r = armBlockStatementsDetailed(body);
  return r && r.ok ? r.stmts : null;
}

/** The function-valued top-level bindings among `topStmts` (a file's logic-block bodies). */
export function fnValuedBindingsOf(topStmts: unknown[]): FnValuedBinding[] {
  const out: FnValuedBinding[] = [];
  for (const s of (Array.isArray(topStmts) ? topStmts : []) as AnyNode[]) {
    if (!s || typeof s !== "object") continue;
    let name: string | null = null;
    let keyword = "const";
    let init: AnyNode | null = null;
    let exported = false;
    if ((s.kind === "const-decl" || s.kind === "let-decl") && typeof s.name === "string") {
      name = s.name;
      keyword = s.kind === "let-decl" ? "let" : "const";
      init = (s.initExpr as AnyNode | undefined) ?? null;
      if (!init && typeof s.init === "string") {
        try { init = parseExprToNode(s.init, "<fn-value>", 0) as unknown as AnyNode | null; } catch { init = null; }
      }
    } else if (s.kind === "export-decl" && (s.exportKind === "const" || s.exportKind === "let" || s.exportKind === "var") &&
      typeof s.exportedName === "string" && !s.reExportSource) {
      // S466 r8 (HIGH-2, Rule 7) — the init is the node the AST builder parsed
      // (`valueInitExpr`, annotated or not), never a regex over `raw`: the r6 regex
      // could not read past a `: (p: string) => boolean` annotation, so an annotated
      // exported function value was never coloured async.
      init = (s.valueInitExpr as AnyNode | undefined) ?? null;
      if (!init) continue;
      name = s.exportedName;
      keyword = String(s.exportKind);
      exported = true;
    }
    if (!name || !isFnValueExpr(init)) continue;
    const body = fnValueBody(init as AnyNode);
    out.push({
      name,
      keyword,
      exported,
      pseudoFn: { kind: "function-decl", name, body: body ?? [], _fnValuedBinding: true },
      readable: body !== null,
    });
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
