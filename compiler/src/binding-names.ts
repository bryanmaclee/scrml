/**
 * binding-names.ts — the ONE answer to "which names does this binding position bind?"
 * (S458 D1, fourth round).
 *
 * Component prop substitution (§15.10.1) walks two kinds of tree: scrml's structured
 * logic AST (`substitutePropsInLogicStmt` in component-expander.ts — `let-decl.name`,
 * `function-decl.params`, `for-stmt.variable`, lambda params) and the parsed JS tree of
 * text the expression parser leaves as an escape hatch (`component-prop-js-substitute.ts`).
 * Both ask the same question at every binding position, and both answer it HERE, so
 * they cannot disagree about whether `let { n } = …`, `function f([a, { n }])` or
 * `for (const [k, n] of …)` binds `n`.
 *
 * Accepted shapes (any of them, nested in any combination):
 *   - a plain identifier string (`"n"`)
 *   - parameter / pattern SOURCE TEXT (`"{ n, m: k = 1 }"`, `"[a, ...rest]"`, `"n: number = 2"`)
 *   - a scrml `DestructurePattern` (`destructure-array` / `destructure-object`, types/ast.ts)
 *   - an ESTree pattern (`Identifier`, `ObjectPattern`, `ArrayPattern`, `RestElement`,
 *     `AssignmentPattern`)
 *   - a parameter ENTRY (`{ name, typeAnnotation?, defaultValue? }` from the AST builder /
 *     native re-parse, or an expression-parser `LambdaParam` with `boundNames`)
 *   - an array of any of the above (a parameter list)
 *
 * THE SCOPE RULES both substituters apply with these names (§15.10.1 "Shadowing"):
 *   1. A declaration (`let` / `const` / `tilde` / `lin` / `@` / `function` / `class`, any
 *      pattern) shadows a same-named prop FROM ITS POINT OF DECLARATION ONWARD in its scope
 *      ("A local … declaration with the same name appears earlier in the same lexical
 *      scope. From the point of declaration onward in the same scope, the local binding
 *      shadows the prop."). A `let`/`const` initializer is read BEFORE its own names
 *      shadow; a function's / class's own name shadows from its header (its body included).
 *   2. Parameters (any pattern) shadow in the function body and in the parameter defaults.
 *   3. A loop binder — `for (const x of …)`, `for (let [k, v] of …)`, `for (let i = 0; …)`
 *      and the KEYWORDLESS binder `for (x of …)` (a `const`, §50.8.5) — shadows in the loop
 *      header (not the iterable) and the body; a `catch` / `match`-arm / `when` / propagate /
 *      `<each as x>` binder shadows in its own body.
 *   4. A destructuring default is an expression, read in the enclosing scope.
 */
import { ScrmlParser } from "./scrml-acorn.ts";

type Rec = Record<string, unknown>;

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

const PARSE_OPTS = {
  ecmaVersion: 2025,
  sourceType: "module",
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
} as const;

/** Strip a scrml type annotation from one parameter's text (`n: number = 2` → `n = 2`). */
function stripParamType(text: string): string {
  return text.replace(/^(\s*(?:\.\.\.)?\s*[A-Za-z_$][\w$]*)\s*:\s*[^=]*?(=|$)/, "$1 $2");
}

function namesOfText(text: string, out: string[]): void {
  const t = text.trim().replace(/^lin\s+/, "");
  if (t === "") return;
  if (IDENT_RE.test(t)) { out.push(t); return; }
  try {
    const ast = ScrmlParser.parseExpressionAt(`(${stripParamType(t)}) => 0`, 0, PARSE_OPTS) as unknown as Rec;
    for (const p of (ast.params as Rec[]) ?? []) collect(p, out);
  } catch {
    const m = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(t);
    if (m) out.push(m[1]);
  }
}

function collect(b: unknown, out: string[]): void {
  if (b === null || b === undefined) return;
  if (typeof b === "string") { namesOfText(b, out); return; }
  if (Array.isArray(b)) { for (const x of b) collect(x, out); return; }
  if (typeof b !== "object") return;
  const r = b as Rec;
  // ESTree patterns
  switch (r.type) {
    case "Identifier": out.push(r.name as string); return;
    case "ObjectPattern":
      for (const p of (r.properties as Rec[]) ?? []) collect(p.type === "RestElement" ? p.argument : p.value, out);
      return;
    case "ArrayPattern": for (const el of (r.elements as unknown[]) ?? []) collect(el, out); return;
    case "RestElement": collect(r.argument, out); return;
    case "AssignmentPattern": collect(r.left, out); return;
  }
  // scrml DestructurePattern (types/ast.ts)
  if (r.kind === "destructure-array") {
    for (const el of (r.elements as Rec[]) ?? []) {
      if (!el) continue;
      if (el.kind === "name") collect(el.name, out);
      else if (el.kind === "nested") collect(el.pattern, out);
    }
    if (typeof r.rest === "string") out.push(r.rest);
    return;
  }
  if (r.kind === "destructure-object") {
    for (const p of (r.properties as Rec[]) ?? []) {
      if (!p) continue;
      if (p.kind === "name") collect(p.bindName, out);
      else if (p.kind === "nested") collect(p.pattern, out);
    }
    if (typeof r.rest === "string") out.push(r.rest);
    return;
  }
  // A parameter entry (`{ name, … }`) / expression-parser LambdaParam (`boundNames`).
  if (Array.isArray(r.boundNames)) { for (const n of r.boundNames as string[]) out.push(n); return; }
  if ("name" in r) {
    const name = r.name;
    if (typeof name === "string") {
      if (name === "__destructured__") return;
      // An entry's `name` is a NAME (its type lives in `typeAnnotation`), never pattern text.
      const t = name.trim().replace(/^(?:lin\s+|\.\.\.)/, "");
      if (IDENT_RE.test(t)) out.push(t);
      else namesOfText(t, out);
      return;
    }
    collect(name, out);
  }
}

/** Every name a binding position binds (see the module header for the accepted shapes). */
export function boundNamesOf(binding: unknown): string[] {
  const out: string[] = [];
  collect(binding, out);
  return out;
}

/** Add every name `binding` binds to `scope` (the shadow set) — rule 1/2/3 in the header. */
export function declareIn(scope: Set<string>, binding: unknown): void {
  for (const n of boundNamesOf(binding)) scope.add(n);
}
