/**
 * failable-value-calls.ts — S467 (§19.4.3 / §19.4.4, E-ERROR-002).
 *
 * "Failing to handle the result of a `!` function call in any of these ways SHALL be a compile
 * error: E-ERROR-002" (§19.4.3). The ways are: `match`, `?` (inside a `!` function), `!{}`, an
 * `<errorBoundary>` around a render-time call, and a `<request>` body's right-hand side. A call
 * whose result is USED — an initializer, a write, an argument, an operand, a `return` operand, an
 * array/object member, a template interpolation — is handled by none of them unless it is the
 * operand of one.
 *
 * ONE structural rule, not a list of positions: every `call` node in an expression tree whose callee
 * is a bare identifier is reported, EXCEPT a call that is the operand of a handling form. Inside one
 * expression tree the only handling form is the inline `match` (its subject); the statement-level
 * forms (`?`, `!{}`, a `match` statement, a `<request>` body, a whole-statement call) wrap the ROOT
 * of the tree, so the caller says whether the root is handled (`rootHandled`). Whether the callee
 * IS failable, and whether a local binding shadows it, is the caller's decision (it owns the scope
 * chain and the failable-function table); this walk reports every candidate with the names bound by
 * the lambdas between the root and the call (a lambda parameter shadows a file-level function).
 *
 * A lambda's EXPRESSION body is walked: it is the lambda's return value, and the lambda is not a
 * `!` function, so a failable call there is unhandled. A block-bodied lambda's statements are not
 * walked here — they are statements, and statements are checked where statements are visited.
 * Opaque nodes (an escape hatch other than a template literal) carry no structure to read and are
 * skipped: this check never re-scans source text (project Rule 7).
 */

import type { ExprNode, CallExpr, LambdaExpr } from "./types/ast.ts";
import { templateInterpolationNodes, guardCallArmsRaw } from "./expression-parser.ts";

export interface FailableCallCandidate {
  call: CallExpr;
  /** The callee's identifier name. */
  calleeName: string;
  /** Names bound by enclosing lambdas inside this expression (they shadow file-level functions). */
  lambdaBound: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

function lambdaParamNames(l: LambdaExpr): string[] {
  const out: string[] = [];
  for (const p of l.params ?? []) {
    if (!p) continue;
    if (Array.isArray(p.boundNames)) out.push(...p.boundNames);
    else if (typeof p.name === "string") out.push(p.name);
  }
  return out;
}

/**
 * Walk `root` and invoke `cb` for every call in a value position whose callee is a bare identifier.
 * `rootHandled` — the root node is the operand of a statement-level handling form (or is the
 * whole-statement call, which the statement check owns): when the root is a call it is not reported
 * (its arguments still are). `"guard-operand"` — the root is the operand of a statement-level
 * `!{ … }`, which handles the whole postfix chain on its left (`@m = f(x).y !{ … }` handles `f(x)`).
 */
export function forEachCallInValuePosition(
  root: ExprNode | null | undefined,
  rootHandled: boolean | "guard-operand",
  cb: (c: FailableCallCandidate) => void,
): void {
  const walk = (node: ExprNode | null | undefined, handled: boolean, bound: ReadonlySet<string>): void => {
    if (!node || typeof node !== "object") return;
    switch (node.kind) {
      case "call": {
        // An expression-position `!{ … }` (`<operand> .__scrml_guard__("!{ … }")`): the handler
        // handles its operand, which is the whole postfix chain on its left (`f(x).y !{ … }`
        // handles `f(x)`). The handler's own source is a string — its arm bodies are not read here.
        if (guardCallArmsRaw(node) !== null && node.callee.kind === "member") {
          walkHandledChain(node.callee.object, bound);
          return;
        }
        if (!handled && node.callee && node.callee.kind === "ident") {
          cb({ call: node, calleeName: node.callee.name, lambdaBound: bound });
        }
        walk(node.callee, false, bound);
        for (const a of node.args ?? []) walk(a as ExprNode, false, bound);
        return;
      }
      case "new": {
        walk(node.callee, false, bound);
        for (const a of node.args ?? []) walk(a as ExprNode, false, bound);
        return;
      }
      case "match-expr": {
        // The inline `match` handles its subject (§19.4.3 item 1). For a multi-scrutinee head
        // every scrutinee is a subject.
        const subjects = Array.isArray(node.subjects) && node.subjects.length > 0 ? node.subjects : [node.subject];
        for (const s of subjects) walk(s, true, bound);
        return;
      }
      case "lambda": {
        if (node.body && node.body.kind === "expr") {
          const names = lambdaParamNames(node);
          const inner = names.length === 0 ? bound : new Set([...bound, ...names]);
          walk(node.body.value, false, inner);
        }
        return;
      }
      case "lit": {
        if (node.litType === "template" && node.hasInterpolation !== false && typeof node.raw === "string") {
          for (const e of templateInterpolationNodes(node)) walk(e, false, bound);
        }
        return;
      }
      case "escape-hatch": {
        if (node.nativeKind === "TemplateLiteral" && typeof node.raw === "string" && node.raw.startsWith("`")) {
          for (const e of templateInterpolationNodes(node)) walk(e, false, bound);
        }
        return;
      }
      case "ident": case "sql-ref": case "input-state-ref": case "markup-value": return;
      case "array": for (const el of node.elements) walk(el as ExprNode, false, bound); return;
      case "object":
        for (const p of node.props) {
          if (p.kind === "prop") { if (typeof p.key !== "string") walk(p.key as ExprNode, false, bound); walk(p.value, false, bound); }
          else if (p.kind === "spread") walk(p.argument, false, bound);
        }
        return;
      case "map-lit": for (const e of node.entries) { walk(e.key, false, bound); walk(e.value, false, bound); } return;
      case "spread": walk(node.argument, false, bound); return;
      case "unary": walk(node.argument, false, bound); return;
      case "binary": walk(node.left, false, bound); walk(node.right, false, bound); return;
      case "assign": walk(node.target, false, bound); walk(node.value, false, bound); return;
      case "ternary": walk(node.condition, false, bound); walk(node.consequent, false, bound); walk(node.alternate, false, bound); return;
      case "member": walk(node.object, false, bound); return;
      case "index": walk(node.object, false, bound); walk(node.index, false, bound); return;
      case "cast": walk(node.expression, false, bound); return;
      case "reset-expr": walk(node.target, false, bound); return;
      default: { const _never: never = node; return; }
    }
  };
  // The operand of a `!{}` handler: every call along its postfix chain is handled; anything
  // else in it (arguments, an index, the chain's base when it is not a call) is a value position.
  const walkHandledChain = (node: ExprNode | null | undefined, bound: ReadonlySet<string>): void => {
    if (!node || typeof node !== "object") return;
    if (node.kind === "call" && guardCallArmsRaw(node) === null) {
      for (const a of node.args ?? []) walk(a as ExprNode, false, bound);
      if (node.callee && node.callee.kind === "ident") return;
      walkHandledChain(node.callee, bound);
      return;
    }
    if (node.kind === "member") { walkHandledChain(node.object, bound); return; }
    if (node.kind === "index") { walkHandledChain(node.object, bound); walk(node.index, false, bound); return; }
    walk(node, true, bound);
  };
  if (rootHandled === "guard-operand") walkHandledChain(root, EMPTY);
  else walk(root, rootHandled, EMPTY);
}
