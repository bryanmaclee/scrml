/**
 * module-scope-refs.ts — S465 r6. Which of a set of top-level names does an emitted JS
 * module actually REFERENCE at module scope? Scope-aware over acorn's tree: a use counts
 * only when it resolves to the module-level binding (not shadowed by a parameter, an
 * inner declaration or a catch parameter), and a property name, a declaration's own id
 * or a label is not a use. (A token scan is not enough: an inlined stdlib helper's
 * `(w) => …` parameter named like a user binding read as a use.)
 */
import { parse as acornParse } from "acorn";

type EsNode = { type: string; [k: string]: unknown };

/** The names an ESTree binding pattern declares. */
function patternNames(p: EsNode | null | undefined, out: Set<string>): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.add(String(p.name)); return;
    case "ObjectPattern":
      for (const q of (p.properties as EsNode[])) patternNames((q.type === "RestElement" ? q.argument : q.value) as EsNode, out);
      return;
    case "ArrayPattern": for (const q of (p.elements as Array<EsNode | null>)) patternNames(q, out); return;
    case "RestElement": patternNames(p.argument as EsNode, out); return;
    case "AssignmentPattern": patternNames(p.left as EsNode, out); return;
  }
}

/** Names declared directly in a statement list (`var` hoisting approximated per block — conservative). */
function declaredIn(stmts: EsNode[]): Set<string> {
  const out = new Set<string>();
  for (const s of stmts) {
    if (!s) continue;
    if (s.type === "VariableDeclaration") for (const d of (s.declarations as EsNode[])) patternNames(d.id as EsNode, out);
    else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.add(String((s.id as EsNode).name));
    else if (s.type === "ImportDeclaration") for (const sp of (s.specifiers as EsNode[])) out.add(String((sp.local as EsNode).name));
    else if ((s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") && s.declaration) {
      for (const n of declaredIn([s.declaration as EsNode])) out.add(n);
    }
  }
  return out;
}

/**
 * The names of `names` that `code` references at module scope, or null when the code does
 * not parse (the caller fails closed).
 */
export function moduleScopeReferences(
  code: string,
  names: Set<string>,
  // Declarations whose INITIALIZER is not walked (`const b = (p) => a(p)` with `b` in
  // the set: a use of `a` inside `b` counts only through a use of `b`).
  skipInitsOf: Set<string> = new Set(),
): Set<string> | null {
  let ast: EsNode;
  try {
    ast = acornParse(code, { ecmaVersion: "latest", sourceType: "module" }) as unknown as EsNode;
  } catch {
    try {
      ast = acornParse(code, { ecmaVersion: "latest", sourceType: "script" }) as unknown as EsNode;
    } catch {
      return null;
    }
  }
  const found = new Set<string>();
  // The binding of interest is the OUTERMOST declaration of the name in the scope chain
  // (the module scope, or the bundle's wrapping IIFE): a use resolves to it only when no
  // inner scope in the chain declares the name too.
  const shadowed = (scopes: Array<Set<string>>, n: string): boolean => {
    let count = 0;
    for (const s of scopes) if (s.has(n)) count++;
    return count !== 1;
  };
  const walk = (node: unknown, scopes: Array<Set<string>>, parent: EsNode | null, key: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c, scopes, parent, key); return; }
    const n = node as EsNode;
    if (typeof n.type !== "string") return;
    if (n.type === "Identifier") {
      const nm = String(n.name);
      if (!names.has(nm)) return;
      if (parent) {
        if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return;
        if ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") &&
          key === "key" && !parent.computed && !(parent.type === "Property" && parent.shorthand)) return;
        if (parent.type === "VariableDeclarator" && key === "id") return;
        if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ClassDeclaration") && key === "id") return;
        if (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") return;
        if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") return;
      }
      if (!shadowed(scopes, nm)) found.add(nm);
      return;
    }
    if (n.type === "VariableDeclarator" && (n.id as EsNode | undefined)?.type === "Identifier" &&
      skipInitsOf.has(String((n.id as EsNode).name))) return;
    let inner = scopes;
    if (n.type === "Program") inner = [declaredIn(n.body as EsNode[])];
    else if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      const s = new Set<string>();
      for (const p of (n.params as EsNode[])) patternNames(p, s);
      if (n.type === "FunctionExpression" && n.id) s.add(String((n.id as EsNode).name));
      const body = n.body as EsNode;
      if (body && body.type === "BlockStatement") for (const x of declaredIn(body.body as EsNode[])) s.add(x);
      inner = [...scopes, s];
    } else if (n.type === "BlockStatement" || n.type === "StaticBlock") {
      inner = [...scopes, declaredIn(n.body as EsNode[])];
    } else if (n.type === "CatchClause") {
      const s = new Set<string>();
      patternNames(n.param as EsNode, s);
      inner = [...scopes, s];
    } else if (n.type === "ForStatement" || n.type === "ForInStatement" || n.type === "ForOfStatement") {
      const s = new Set<string>();
      const init = (n.init ?? n.left) as EsNode | undefined;
      if (init && init.type === "VariableDeclaration") for (const d of (init.declarations as EsNode[])) patternNames(d.id as EsNode, s);
      inner = [...scopes, s];
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      walk(n[k], inner, n, k);
    }
  };
  walk(ast, [], null, "");
  return found;
}
