/**
 * @module codegen/meta-capture-rewrite
 *
 * The emitted-text boundary for a RUNTIME `^{}` body (§22.12, S458 review round 3, HIGH-2).
 *
 * ## The rule, by construction
 *
 * The body of a runtime `^{}` effect is emitted as a plain JS function in the client
 * module. Before S458 a captured binding was referenced BARE in it, relying on the JS
 * closure over the module scope. That made the allow-list's idea of a name differ from
 * what the browser resolves: a cell `<location>` is a store key, not a JS binding, so a
 * bare `location` reached the GLOBAL; a `function window()` is emitted renamed
 * (`_scrml_window_1`) and the scope-aware rename leaves a member-access root alone, so
 * `window.eval(…)` reached the GLOBAL. A deny-list of host names cannot close that class
 * (any global not on the list reopens it), so this module closes it by construction:
 *
 *   1. Every reference in the emitted body to a CAPTURED binding (a name the one scope
 *      analysis — meta-checker `collectFileScopeNames` + `collectEnclosingNames` — says
 *      is in scope at the `^{}` site, cells excluded) is rewritten to
 *      `_scrml_cap.<name>`, where `_scrml_cap` is an INTERNAL capture object emitted at the `^{}` site (NOT
 *      `meta.bindings`, which stays the §22.5.2 plain-value snapshot).
 *      The capture object holds each binding under its AUTHOR name with a getter that
 *      reads the real binding — so `_scrml_cap.window` is the user's renamed function,
 *      never the global.
 *   2. The rewritten body is then checked by scope analysis of the EXACT text the browser
 *      runs. A free identifier may only be: a compiler name (`_scrml_*` — the reserved
 *      prefix no author can spell, §47.1.1) or one of the exact-match safe value names
 *      (`undefined`, `NaN`, `Infinity`). Anything else — a bare cell name, a host global,
 *      a write to a captured binding — is E-META-001. There is no host-name list.
 *
 * Text is edited by SPLICING located ranges (never regenerated), so comments and layout
 * of the emitted body are kept.
 */

import * as acorn from "acorn";

/** Exact-match safe free names (value literals spelled as identifiers). Not a danger list. */
const SAFE_FREE_NAMES: ReadonlySet<string> = new Set(["undefined", "NaN", "Infinity"]);

/** The capture-object variable every rewritten reference goes through. */
export const META_CAPTURE_VAR = "_scrml_cap";

class Scope {
  readonly names = new Set<string>();
  constructor(readonly parent: Scope | null) {}
  has(n: string): boolean {
    for (let s: Scope | null = this; s; s = s.parent) if (s.names.has(n)) return true;
    return false;
  }
}

type AnyNode = Record<string, any> & { type: string; start: number; end: number };

export type MetaCaptureResult =
  | { ok: true; text: string; used: Set<string> }
  | { ok: false; refused: string[]; assigned?: string[] };

function declarePattern(p: AnyNode | null, scope: Scope): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": scope.names.add(p.name); return;
    case "ObjectPattern": for (const pr of p.properties) declarePattern(pr.type === "RestElement" ? pr.argument : pr.value, scope); return;
    case "ArrayPattern": for (const el of p.elements) declarePattern(el, scope); return;
    case "RestElement": declarePattern(p.argument, scope); return;
    case "AssignmentPattern": declarePattern(p.left, scope); return;
  }
}

/** `var` and function declarations of a function body, not crossing nested functions. */
function hoistFunctionScope(body: AnyNode, scope: Scope): void {
  const visit = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (typeof n.type !== "string") return;
    if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return;
    if (n.type === "FunctionDeclaration") { if (n.id) scope.names.add(n.id.name); return; }
    if (n.type === "VariableDeclaration" && n.kind === "var") for (const d of n.declarations) declarePattern(d.id, scope);
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      visit(n[k]);
    }
  };
  visit(body);
}

/** Block-level lexical declarations (let / const / class / function) directly in `stmts`. */
function hoistBlock(stmts: AnyNode[], scope: Scope): void {
  for (const s of stmts) {
    if (!s) continue;
    if (s.type === "VariableDeclaration" && s.kind !== "var") for (const d of s.declarations) declarePattern(d.id, scope);
    else if (s.type === "FunctionDeclaration" && s.id) scope.names.add(s.id.name);
    else if (s.type === "ClassDeclaration" && s.id) scope.names.add(s.id.name);
  }
}

/**
 * Rewrite captured references in a runtime `^{}` body and verify the result.
 *
 * @param bodyText  the emitted statements of the effect body (what goes between the braces)
 * @param captured  names captured at the `^{}` site (cells already excluded)
 * @param isAsync   whether the effect function is emitted `async`
 */
export function rewriteMetaBodyCaptures(bodyText: string, captured: ReadonlySet<string>, isAsync: boolean): MetaCaptureResult {
  const prefix = `(${isAsync ? "async " : ""}function (meta) {\n`;
  const wrapped = `${prefix}${bodyText}\n})`;
  let ast: AnyNode;
  try {
    ast = acorn.parse(wrapped, { ecmaVersion: 2025, sourceType: "script" }) as unknown as AnyNode;
  } catch (e) {
    return { ok: false, refused: [`[parse: ${(e as Error).message}]`] };
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const refused = new Set<string>();
  const assigned = new Set<string>();
  const used = new Set<string>();

  const reference = (id: AnyNode, scope: Scope, write: boolean, shorthand: boolean): void => {
    const name: string = id.name;
    if (scope.has(name)) return;
    if (name.startsWith("_scrml_")) return;
    if (!write && SAFE_FREE_NAMES.has(name)) return;
    if (captured.has(name)) {
      if (write) { assigned.add(name); return; }
      used.add(name);
      const ref = `${META_CAPTURE_VAR}.${name}`;
      edits.push({ start: id.start, end: id.end, text: shorthand ? `${name}: ${ref}` : ref });
      return;
    }
    refused.add(name);
  };

  const walkPatternDefaults = (p: AnyNode | null, scope: Scope): void => {
    if (!p) return;
    switch (p.type) {
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") { walkPatternDefaults(pr.argument, scope); continue; }
          if (pr.computed) walk(pr.key, scope, null, "");
          walkPatternDefaults(pr.value, scope);
        }
        return;
      case "ArrayPattern": for (const el of p.elements) walkPatternDefaults(el, scope); return;
      case "RestElement": walkPatternDefaults(p.argument, scope); return;
      case "AssignmentPattern": walkPatternDefaults(p.left, scope); walk(p.right, scope, null, ""); return;
    }
  };

  /** A write target (assignment left side / update argument / for-in-of left). */
  const walkTarget = (t: AnyNode | null, scope: Scope): void => {
    if (!t) return;
    switch (t.type) {
      case "Identifier": reference(t, scope, true, false); return;
      case "MemberExpression": walk(t, scope, null, ""); return;
      case "ObjectPattern":
        for (const pr of t.properties) {
          if (pr.type === "RestElement") { walkTarget(pr.argument, scope); continue; }
          if (pr.computed) walk(pr.key, scope, null, "");
          walkTarget(pr.value, scope);
        }
        return;
      case "ArrayPattern": for (const el of t.elements) walkTarget(el, scope); return;
      case "RestElement": walkTarget(t.argument, scope); return;
      case "AssignmentPattern": walkTarget(t.left, scope); walk(t.right, scope, null, ""); return;
      default: walk(t, scope, null, "");
    }
  };

  const walkFunction = (f: AnyNode, scope: Scope): void => {
    const inner = new Scope(scope);
    if (f.id && f.type === "FunctionExpression") inner.names.add(f.id.name);
    for (const p of f.params) declarePattern(p, inner);
    for (const p of f.params) walkPatternDefaults(p, inner);
    if (f.body.type === "BlockStatement") {
      hoistFunctionScope(f.body, inner);
      hoistBlock(f.body.body, inner);
      for (const s of f.body.body) walk(s, inner, f.body, "body");
    } else {
      walk(f.body, inner, f, "body");
    }
  };

  function walk(n: any, scope: Scope, parent: AnyNode | null, key: string): void {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x, scope, parent, key); return; }
    if (typeof n.type !== "string") return;
    switch (n.type) {
      case "Identifier": {
        const shorthand = parent?.type === "Property" && parent.shorthand && key === "value";
        reference(n, scope, false, shorthand);
        return;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        walkFunction(n, scope);
        return;
      case "BlockStatement": {
        const inner = new Scope(scope);
        hoistBlock(n.body, inner);
        for (const s of n.body) walk(s, inner, n, "body");
        return;
      }
      case "VariableDeclaration":
        for (const d of n.declarations) {
          // Bindings are hoisted by the enclosing block / function; walk defaults + init.
          walkPatternDefaults(d.id, scope);
          if (d.init) walk(d.init, scope, d, "init");
        }
        return;
      case "ForStatement": {
        const inner = new Scope(scope);
        if (n.init && n.init.type === "VariableDeclaration") for (const d of n.init.declarations) declarePattern(d.id, inner);
        walk(n.init, inner, n, "init"); walk(n.test, inner, n, "test"); walk(n.update, inner, n, "update");
        walk(n.body, inner, n, "body");
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const inner = new Scope(scope);
        walk(n.right, scope, n, "right");
        if (n.left.type === "VariableDeclaration") {
          for (const d of n.left.declarations) { declarePattern(d.id, inner); walkPatternDefaults(d.id, inner); }
        } else walkTarget(n.left, scope);
        walk(n.body, inner, n, "body");
        return;
      }
      case "CatchClause": {
        const inner = new Scope(scope);
        declarePattern(n.param, inner);
        walk(n.body, inner, n, "body");
        return;
      }
      case "SwitchStatement": {
        walk(n.discriminant, scope, n, "discriminant");
        const inner = new Scope(scope);
        hoistBlock(n.cases.flatMap((c: AnyNode) => c.consequent), inner);
        for (const c of n.cases) { walk(c.test, inner, c, "test"); for (const s of c.consequent) walk(s, inner, c, "consequent"); }
        return;
      }
      case "AssignmentExpression":
        walkTarget(n.left, scope);
        walk(n.right, scope, n, "right");
        return;
      case "UpdateExpression":
        walkTarget(n.argument, scope);
        return;
      case "MemberExpression":
        walk(n.object, scope, n, "object");
        if (n.computed) walk(n.property, scope, n, "property");
        return;
      case "Property":
        if (n.computed) walk(n.key, scope, n, "key");
        walk(n.value, scope, n, "value");
        return;
      case "MethodDefinition":
      case "PropertyDefinition":
        if (n.computed) walk(n.key, scope, n, "key");
        walk(n.value, scope, n, "value");
        return;
      case "LabeledStatement":
        walk(n.body, scope, n, "body");
        return;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
        return;
      default:
        for (const k of Object.keys(n)) {
          if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
          walk(n[k], scope, n, k);
        }
    }
  }

  // The wrapper function: `meta` is its parameter (bound); everything else is checked.
  const fn = (ast as any).body[0].expression as AnyNode;
  walkFunction(fn, new Scope(null));

  if (refused.size > 0 || assigned.size > 0) return { ok: false, refused: [...refused], assigned: [...assigned] };

  // Splice the edits (highest offset first), then strip the wrapper back off.
  edits.sort((a, b) => b.start - a.start);
  let out = wrapped;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const text = out.slice(prefix.length, out.length - "\n})".length);
  return { ok: true, text, used };
}
