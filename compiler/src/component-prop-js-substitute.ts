/**
 * component-prop-js-substitute.ts — component prop substitution inside source text the
 * expression tree does NOT structure (S458 D1, third review round).
 *
 * WHY THIS EXISTS. The expression parser structures expressions into ExprNode trees, and
 * `component-expander.ts` substitutes props on those trees (`substitutePropsInExprNode`).
 * A few forms stay TEXT on the tree: a block-bodied arrow / function expression
 * (`x => { … }`, an escape hatch whose `raw` codegen emits verbatim — no codegen path
 * emits a block-bodied lambda from statements), and the bodies of `when …` handlers /
 * `!{}` arms (emitted from their `bodyRaw` / `handler` strings). Rewriting prop names in
 * that text with a scanner was not scope- or syntax-aware: it rewrote object keys
 * (`{ label: 2 }`), regex and comment content, locals that shadow the prop, and nested
 * parameters (destructured ones included).
 *
 * WHAT THIS DOES INSTEAD. The text is PARSED (the same acorn parser + `@` / `::` plugins
 * the expression parser uses), a scope model is built over the ESTree, and only the
 * Identifier nodes that are REFERENCES resolving to the prop are replaced — at their exact
 * node offsets. A declaration (`let` / `const` / `var` / `function` / `class`, a parameter
 * — destructured or defaulted —, a `for (let n …)` / `for (const n of …)` binder, a
 * `catch` parameter) shadows the prop in its scope; an object-literal KEY, a member name
 * (`o.label`), a label, string / template / regex / comment content are never references.
 * A shorthand property `{ label }` is a READ: it becomes `{ label: <value> }` (key kept).
 * A write to the prop (assignment target, `++` / `--`, a destructuring-assignment target)
 * is reported through `onWrite`.
 *
 * If the text does not parse, NOTHING is rewritten; the caller decides (it refuses when a
 * prop is referenced — see `propNamesReferencedInUnparsedText`).
 */
import { ScrmlParser } from "./scrml-acorn.ts";

type ES = { type: string; start: number; end: number; [k: string]: unknown };

export interface JsPropSubstitutionHooks {
  /** The replacement source text for a prop reference, or null when `name` is not a prop. */
  replacementFor(name: string): string | null;
  /** Called for every WRITE to a prop (not shadowed). */
  onWrite(name: string): void;
}

const PARSE_OPTS = {
  ecmaVersion: 2025,
  sourceType: "module",
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
} as const;

/** Every name a binding pattern declares (`a`, `{ a, b: c }`, `[d, ...e]`, `f = 1`). */
function patternNames(p: ES | null | undefined, out: string[] = []): string[] {
  if (!p) return out;
  switch (p.type) {
    case "Identifier": out.push(p.name as string); break;
    case "ObjectPattern":
      for (const prop of (p.properties as ES[]) ?? []) {
        if (prop.type === "RestElement") patternNames(prop.argument as ES, out);
        else patternNames(prop.value as ES, out);
      }
      break;
    case "ArrayPattern": for (const el of (p.elements as ES[]) ?? []) patternNames(el, out); break;
    case "RestElement": patternNames(p.argument as ES, out); break;
    case "AssignmentPattern": patternNames(p.left as ES, out); break;
  }
  return out;
}

/** Names declared DIRECTLY in a statement list (block scope; `var` / `function` included). */
function declaredIn(stmts: ES[]): string[] {
  const out: string[] = [];
  for (const s of stmts ?? []) {
    if (!s) continue;
    if (s.type === "VariableDeclaration") {
      for (const d of (s.declarations as ES[]) ?? []) patternNames(d.id as ES, out);
    } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) {
      out.push((s.id as ES).name as string);
    } else if (s.type === "ExportNamedDeclaration" && s.declaration) {
      out.push(...declaredIn([s.declaration as ES]));
    }
  }
  return out;
}

/** `var` declarations anywhere in a function body (hoisted to the function scope). */
function hoistedVars(node: ES | null | undefined, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") return out;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const d of (node.declarations as ES[]) ?? []) patternNames(d.id as ES, out);
  }
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const x of v) { if (x && typeof x === "object") hoistedVars(x as ES, out); }
    else if (v && typeof v === "object" && typeof (v as ES).type === "string") hoistedVars(v as ES, out);
  }
  return out;
}

/**
 * Substitute prop references in `src`. `asProgram` parses a statement list (a handler
 * body); otherwise `src` is ONE expression. Returns null when `src` does not parse.
 */
export function substitutePropsInJsSource(
  src: string,
  asProgram: boolean,
  shadowed: Set<string>,
  hooks: JsPropSubstitutionHooks,
): string | null {
  let ast: ES;
  // The expression form is parsed UNWRAPPED: acorn's `parseExpressionAt("(e)")` returns
  // the inner node, whose `end` stops before the closing paren.
  const text = src;
  try {
    if (asProgram) {
      ast = ScrmlParser.parse(text, PARSE_OPTS) as unknown as ES;
    } else {
      ast = ScrmlParser.parseExpressionAt(text, 0, PARSE_OPTS) as unknown as ES;
      if (text.slice(ast.end).trim() !== "") return null; // trailing content: not one expression
    }
  } catch {
    return null;
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const isProp = (name: string, shadow: Set<string>) => !shadow.has(name) && hooks.replacementFor(name) !== null;

  const visitPattern = (p: ES | null | undefined, shadow: Set<string>): void => {
    // A binding pattern: its identifiers are declarations; only defaults and computed keys are expressions.
    if (!p) return;
    switch (p.type) {
      case "ObjectPattern":
        for (const prop of (p.properties as ES[]) ?? []) {
          if (prop.type === "RestElement") { visitPattern(prop.argument as ES, shadow); continue; }
          if (prop.computed) visit(prop.key as ES, prop, "key", shadow);
          visitPattern(prop.value as ES, shadow);
        }
        break;
      case "ArrayPattern": for (const el of (p.elements as ES[]) ?? []) visitPattern(el, shadow); break;
      case "RestElement": visitPattern(p.argument as ES, shadow); break;
      case "AssignmentPattern": visitPattern(p.left as ES, shadow); visit(p.right as ES, p, "right", shadow); break;
    }
  };

  const visitAssignTarget = (t: ES | null | undefined, shadow: Set<string>): void => {
    // An assignment TARGET (`x = …`, `[x, y] = …`, `({ x } = …)`): its identifiers are WRITES.
    if (!t) return;
    switch (t.type) {
      case "Identifier": {
        const name = t.name as string;
        if (isProp(name, shadow)) { hooks.onWrite(name); edits.push({ start: t.start, end: t.end, text: hooks.replacementFor(name) as string }); }
        break;
      }
      case "ObjectPattern":
        for (const prop of (t.properties as ES[]) ?? []) {
          if (prop.type === "RestElement") { visitAssignTarget(prop.argument as ES, shadow); continue; }
          if (prop.computed) visit(prop.key as ES, prop, "key", shadow);
          visitAssignTarget(prop.value as ES, shadow);
        }
        break;
      case "ArrayPattern": for (const el of (t.elements as ES[]) ?? []) visitAssignTarget(el, shadow); break;
      case "RestElement": visitAssignTarget(t.argument as ES, shadow); break;
      case "AssignmentPattern": visitAssignTarget(t.left as ES, shadow); visit(t.right as ES, t, "right", shadow); break;
      default: visit(t, null, "", shadow); // a member target: `o.label = …` reads `o`
    }
  };

  const visitFunction = (fn: ES, shadow: Set<string>): void => {
    const inner = new Set(shadow);
    for (const p of (fn.params as ES[]) ?? []) for (const n of patternNames(p)) inner.add(n);
    if (fn.type === "FunctionExpression" && fn.id) inner.add((fn.id as ES).name as string);
    const body = fn.body as ES;
    if (body && body.type === "BlockStatement") for (const n of hoistedVars(body)) inner.add(n);
    for (const p of (fn.params as ES[]) ?? []) visitPattern(p, inner);
    visit(body, fn, "body", inner);
  };

  const visitChildren = (node: ES, shadow: Set<string>): void => {
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x === "object" && typeof (x as ES).type === "string") visit(x as ES, node, k, shadow); }
      else if (v && typeof v === "object" && typeof (v as ES).type === "string") visit(v as ES, node, k, shadow);
    }
  };

  function visit(node: ES | null | undefined, parent: ES | null, key: string, shadow: Set<string>): void {
    if (!node) return;
    switch (node.type) {
      case "Identifier": {
        const name = node.name as string;
        if (parent) {
          if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return;
          if ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && key === "key" && !parent.computed) return;
          if ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") && key === "label") return;
          if (parent.type === "MetaProperty") return;
        }
        if (isProp(name, shadow)) edits.push({ start: node.start, end: node.end, text: hooks.replacementFor(name) as string });
        return;
      }
      case "Literal": case "TemplateElement": case "ThisExpression": case "Super": case "EmptyStatement":
      case "DebuggerStatement": case "PrivateIdentifier":
        return;
      case "Program": case "BlockStatement": case "StaticBlock": {
        const inner = new Set(shadow);
        for (const n of declaredIn(node.body as ES[])) inner.add(n);
        for (const s of (node.body as ES[]) ?? []) visit(s, node, "body", inner);
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant as ES, node, "discriminant", shadow);
        const inner = new Set(shadow);
        for (const c of (node.cases as ES[]) ?? []) for (const n of declaredIn(c.consequent as ES[])) inner.add(n);
        for (const c of (node.cases as ES[]) ?? []) { visit(c.test as ES, c, "test", inner); for (const s of (c.consequent as ES[]) ?? []) visit(s, c, "consequent", inner); }
        return;
      }
      case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression":
        visitFunction(node, shadow);
        return;
      case "ClassDeclaration": case "ClassExpression": {
        const inner = new Set(shadow);
        if (node.id) inner.add((node.id as ES).name as string);
        if (node.superClass) visit(node.superClass as ES, node, "superClass", shadow);
        visit(node.body as ES, node, "body", inner);
        return;
      }
      case "VariableDeclaration":
        for (const d of (node.declarations as ES[]) ?? []) { visitPattern(d.id as ES, shadow); visit(d.init as ES, d, "init", shadow); }
        return;
      case "ForStatement": case "ForInStatement": case "ForOfStatement": {
        const inner = new Set(shadow);
        const head = (node.type === "ForStatement" ? node.init : node.left) as ES | null;
        if (head && head.type === "VariableDeclaration") for (const d of (head.declarations as ES[]) ?? []) for (const n of patternNames(d.id as ES)) inner.add(n);
        if (node.type === "ForStatement") {
          visit(node.init as ES, node, "init", inner);
          visit(node.test as ES, node, "test", inner);
          visit(node.update as ES, node, "update", inner);
        } else {
          if (head && head.type !== "VariableDeclaration") visitAssignTarget(head, inner);
          else visit(head, node, "left", inner);
          visit(node.right as ES, node, "right", shadow);
        }
        visit(node.body as ES, node, "body", inner);
        return;
      }
      case "CatchClause": {
        const inner = new Set(shadow);
        for (const n of patternNames(node.param as ES)) inner.add(n);
        visitPattern(node.param as ES, inner);
        visit(node.body as ES, node, "body", inner);
        return;
      }
      case "AssignmentExpression":
        visitAssignTarget(node.left as ES, shadow);
        visit(node.right as ES, node, "right", shadow);
        return;
      case "UpdateExpression": {
        const arg = node.argument as ES;
        if (arg && arg.type === "Identifier") { visitAssignTarget(arg, shadow); return; }
        visit(arg, node, "argument", shadow);
        return;
      }
      case "Property": {
        // A shorthand property in an object LITERAL is a read: `{ label }` → `{ label: <value> }`.
        if (parent && parent.type === "ObjectExpression" && node.shorthand && (node.value as ES)?.type === "Identifier") {
          const name = (node.value as ES).name as string;
          if (isProp(name, shadow)) edits.push({ start: node.start, end: node.end, text: `${name}: ${hooks.replacementFor(name)}` });
          return;
        }
        if (node.computed) visit(node.key as ES, node, "key", shadow);
        visit(node.value as ES, node, "value", shadow);
        return;
      }
      default:
        visitChildren(node, shadow);
    }
  }

  visit(ast, null, "", new Set(shadowed));
  if (edits.length === 0) return src;
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue; // overlapping (should not happen) — keep the outer edit
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

/**
 * The names a `for` HEADER declares (`(let n = 0; n < 3; n++)` → `n`,
 * `(const [k, v] of xs)` → `k`, `v`), read from its parsed tree. Empty when the header
 * declares nothing or does not parse.
 */
export function bindingNamesOfForHeader(header: string): string[] {
  try {
    const ast = ScrmlParser.parse(`for ${header.trim()} ;`, PARSE_OPTS) as unknown as ES;
    const stmt = ((ast.body as ES[]) ?? [])[0];
    if (!stmt) return [];
    const head = (stmt.type === "ForStatement" ? stmt.init : stmt.left) as ES | null;
    if (!head || head.type !== "VariableDeclaration") return [];
    const out: string[] = [];
    for (const d of (head.declarations as ES[]) ?? []) patternNames(d.id as ES, out);
    return out;
  } catch {
    return [];
  }
}

/** The names one parameter's source text binds (`label`, `{ label, id }`, `[a, ...b]`, `x = 1`). */
export function bindingNamesOfParamText(param: string): string[] {
  try {
    const ast = ScrmlParser.parseExpressionAt(`(${param}) => 0`, 0, PARSE_OPTS) as unknown as ES;
    const out: string[] = [];
    for (const p of (ast.params as ES[]) ?? []) patternNames(p, out);
    return out;
  } catch {
    const m = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(param);
    return m ? [m[1]] : [];
  }
}

/** The names a binding PATTERN declares, from ESTree (shared with the expression parser's lambdas). */
export function bindingNamesOfPattern(p: unknown): string[] {
  return patternNames(p as ES);
}

/**
 * For text that does NOT parse: which prop names it references, read from the acorn TOKEN
 * stream (so string / template / regex / comment content and `.name` member tails are not
 * references). Used only to decide whether to REFUSE — never to rewrite. A text the
 * tokenizer cannot read is answered conservatively from its word tokens.
 */
export function propNamesReferencedInUnparsedText(src: string, isProp: (name: string) => boolean): string[] {
  const found = new Set<string>();
  try {
    let prevDot = false;
    for (const tok of ScrmlParser.tokenizer(src, PARSE_OPTS) as Iterable<{ type: { label: string }; value: unknown }>) {
      if (tok.type.label === "name" && typeof tok.value === "string" && !prevDot && isProp(tok.value)) found.add(tok.value);
      prevDot = tok.type.label === "." || tok.type.label === "?.";
    }
  } catch {
    for (const m of src.matchAll(/(?<![.\w$@])[A-Za-z_$][\w$]*/g)) if (isProp(m[0])) found.add(m[0]);
  }
  return [...found];
}
