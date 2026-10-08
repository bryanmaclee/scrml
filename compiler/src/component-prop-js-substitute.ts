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
import { boundNamesOf } from "./binding-names.ts";
import { parseScrmlTextToEstree } from "./expression-parser.ts";

type ES = { type: string; start: number; end: number; [k: string]: unknown };

export interface JsPropSubstitutionHooks {
  /** The replacement source text for a prop reference, or null when `name` is not a prop. */
  replacementFor(name: string): string | null;
  /** Called for every WRITE to a prop (not shadowed). */
  onWrite(name: string): void;
  /**
   * S459 round 6 (F4) — called for every CALL whose callee is a prop (not shadowed);
   * `guarded` is true when the call sits under a test of that prop (`if (p) …`,
   * `p && p()`, `p ? p() : …`). §15.11.4: an unguarded call to a potentially-absent
   * function-typed prop is E-TYPE-031.
   */
  onCall?(name: string, guarded: boolean): void;
}

/**
 * S459 round 6 (F4) — the marker a GUARD occupies in a shadow set: `PROP_GUARD_PREFIX + name`
 * means "this region runs only when `name` tested truthy". It cannot collide with a binding
 * (no identifier starts with NUL), so it rides the same scope sets both substituters already
 * thread, and a guard ends exactly where its region's scope ends.
 */
export const PROP_GUARD_PREFIX = "\u0000guard:";

/** Every Identifier name in an ESTree subtree (a guard test's names). */
function esIdentNames(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const x of node) esIdentNames(x, out); return out; }
  const r = node as ES;
  if (r.type === "Identifier" && typeof r.name === "string") out.push(r.name as string);
  for (const k of Object.keys(r)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const v = r[k];
    if (v && typeof v === "object") esIdentNames(v, out);
  }
  return out;
}
function guardedScope(shadow: Set<string>, test: unknown): Set<string> {
  const g = new Set(shadow);
  for (const n of esIdentNames(test)) g.add(PROP_GUARD_PREFIX + n);
  return g;
}

const PARSE_OPTS = {
  ecmaVersion: 2025,
  sourceType: "module",
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
} as const;

/** Every name a binding pattern declares — the shared answer (binding-names.ts). */
function patternNames(p: ES | null | undefined, out: string[] = []): string[] {
  out.push(...boundNamesOf(p));
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
  // S458 (fourth round, F1) — ONE parser for scrml expression text. The text is parsed
  // with the expression parser's own front (`parseScrmlTextToEstree`: the `is some` /
  // `is not` / `not` / `::` / `.Variant` preprocessing, then acorn + the `@` / `::`
  // plugins), so `label is some` in a block arrow parses exactly as it does anywhere else.
  // That preprocessing MOVES text, so node offsets do not address `src`. Instead every
  // candidate identifier TOKEN of `src` (a name token spelled like a prop, not a member
  // tail) is first renamed to a unique tag (`name__scrmlpropN__`); the tree is analysed
  // with the tags read back as their names, and each decision is applied to the token in
  // the ORIGINAL text. A candidate that does not survive into the tree (the front dropped
  // or duplicated it in a way this cannot follow) makes the whole text unsubstitutable —
  // never a guess.
  const candidates: Array<{ start: number; end: number; name: string }> = [];
  try {
    let prevDot = false;
    for (const tok of ScrmlParser.tokenizer(src, PARSE_OPTS) as Iterable<{ type: { label: string }; value: unknown; start: number; end: number }>) {
      if (tok.type.label === "name" && typeof tok.value === "string" && !prevDot
          && hooks.replacementFor(tok.value) !== null && src.slice(tok.start, tok.end) === tok.value) {
        candidates.push({ start: tok.start, end: tok.end, name: tok.value });
      }
      prevDot = tok.type.label === "." || tok.type.label === "?.";
    }
  } catch {
    candidates.length = 0;
    // The plain tokenizer cannot read scrml-only lexemes; fall back to a word scan that
    // skips string / comment content only through the parse below (a tag inside a string
    // never becomes an Identifier, so it is never "seen" and the text is refused).
    for (const m of src.matchAll(/(?<![.\w$@])[A-Za-z_$][\w$]*/g)) {
      if (hooks.replacementFor(m[0]) !== null) candidates.push({ start: m.index!, end: m.index! + m[0].length, name: m[0] });
    }
  }
  if (candidates.length === 0) {
    // Nothing to substitute — the text is returned verbatim if it parses at all.
    return parseScrmlTextToEstree(src, asProgram) ? src : null;
  }
  const TAG = /^([A-Za-z_$][\w$]*?)__scrmlprop(\d+)__$/;
  let tagged = "";
  let last = 0;
  candidates.forEach((c, i) => { tagged += src.slice(last, c.start) + `${c.name}__scrmlprop${i}__`; last = c.end; });
  tagged += src.slice(last);
  const ast = parseScrmlTextToEstree(tagged, asProgram) as unknown as ES | null;
  if (!ast) return null;
  // Read every tag back as its name; remember which candidate each Identifier is.
  const seen = new Set<number>();
  const untag = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const x of node) untag(x); return; }
    const r = node as ES;
    if (r.type === "Identifier" && typeof r.name === "string") {
      const m = TAG.exec(r.name as string);
      if (m) { r.name = m[1]; r.__cand = Number(m[2]); seen.add(Number(m[2])); }
    }
    for (const k of Object.keys(r)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = r[k];
      if (v && typeof v === "object") untag(v);
    }
  };
  untag(ast);
  if (seen.size !== candidates.length) return null;

  const edits: Array<{ start: number; end: number; text: string }> = [];
  // An edit addresses the candidate TOKEN in `src` (via the Identifier's tag).
  const at = (id: ES): { start: number; end: number } => {
    const c = candidates[id.__cand as number];
    return { start: c.start, end: c.end };
  };
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
        if (isProp(name, shadow) && t.__cand !== undefined) { hooks.onWrite(name); edits.push({ ...at(t), text: hooks.replacementFor(name) as string }); }
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
        if (isProp(name, shadow) && node.__cand !== undefined) edits.push({ ...at(node), text: hooks.replacementFor(name) as string });
        return;
      }
      case "Literal": case "TemplateElement": case "ThisExpression": case "Super": case "EmptyStatement":
      case "DebuggerStatement": case "PrivateIdentifier":
        return;
      // A statement list is walked IN ORDER with ONE scope set that its declarations grow
      // (binding-names.ts rule 1: a declaration shadows from its point of declaration
      // onward — the same rule the structured walker applies). A declaration statement
      // adds its names to the `shadow` set it is visited with.
      case "Program": case "BlockStatement": case "StaticBlock": {
        const inner = new Set(shadow);
        for (const s of (node.body as ES[]) ?? []) visit(s, node, "body", inner);
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant as ES, node, "discriminant", shadow);
        const inner = new Set(shadow);
        for (const c of (node.cases as ES[]) ?? []) { visit(c.test as ES, c, "test", inner); for (const s of (c.consequent as ES[]) ?? []) visit(s, c, "consequent", inner); }
        return;
      }
      case "FunctionDeclaration":
        // The function's own name shadows from its header on — its body included.
        if (node.id) shadow.add((node.id as ES).name as string);
        visitFunction(node, shadow);
        return;
      case "FunctionExpression": case "ArrowFunctionExpression":
        visitFunction(node, shadow);
        return;
      case "ClassDeclaration": case "ClassExpression": {
        if (node.type === "ClassDeclaration" && node.id) shadow.add((node.id as ES).name as string);
        const inner = new Set(shadow);
        if (node.id) inner.add((node.id as ES).name as string);
        if (node.superClass) visit(node.superClass as ES, node, "superClass", shadow);
        visit(node.body as ES, node, "body", inner);
        return;
      }
      case "VariableDeclaration":
        // Each declarator's initializer is read BEFORE its own names shadow (`let n = n + 1`
        // reads the prop); then its names shadow everything after it in this scope.
        for (const d of (node.declarations as ES[]) ?? []) {
          visit(d.init as ES, d, "init", shadow);
          visitPattern(d.id as ES, shadow);
          for (const n of patternNames(d.id as ES)) shadow.add(n);
        }
        return;
      case "ForStatement": case "ForInStatement": case "ForOfStatement": {
        const inner = new Set(shadow);
        const head = (node.type === "ForStatement" ? node.init : node.left) as ES | null;
        if (head && head.type === "VariableDeclaration") for (const d of (head.declarations as ES[]) ?? []) for (const n of patternNames(d.id as ES)) inner.add(n);
        if (node.type === "ForStatement") {
          // `for (let n = n0; …)`: each initializer reads the ENCLOSING binding (rule 1).
          if (head && head.type === "VariableDeclaration") {
            const pre = new Set(shadow);
            for (const d of (head.declarations as ES[]) ?? []) {
              visit(d.init as ES, d, "init", pre);
              visitPattern(d.id as ES, inner);
              for (const n of patternNames(d.id as ES)) pre.add(n);
            }
          } else visit(node.init as ES, node, "init", inner);
          visit(node.test as ES, node, "test", inner);
          visit(node.update as ES, node, "update", inner);
        } else {
          // A KEYWORDLESS binder (`for (n of xs)`, `for ([k, v] of xs)`) declares a `const`
          // (§50.8.5) and shadows like `for (const n of xs)`; only a member head
          // (`for (o.k of xs)`) is an assignment target.
          if (head && head.type === "MemberExpression") visitAssignTarget(head, inner);
          else if (head && head.type !== "VariableDeclaration") {
            for (const n of patternNames(head)) inner.add(n);
            visitPattern(head, inner);
          } else if (head) {
            for (const d of (head.declarations as ES[]) ?? []) visitPattern(d.id as ES, inner);
          }
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
      case "CallExpression": {
        const callee = node.callee as ES;
        if (hooks.onCall && callee && callee.type === "Identifier" && isProp(callee.name as string, shadow)) {
          hooks.onCall(callee.name as string, shadow.has(PROP_GUARD_PREFIX + (callee.name as string)));
        }
        visitChildren(node, shadow);
        return;
      }
      case "IfStatement":
        visit(node.test as ES, node, "test", shadow);
        visit(node.consequent as ES, node, "consequent", guardedScope(shadow, node.test));
        visit(node.alternate as ES, node, "alternate", shadow);
        return;
      case "ConditionalExpression":
        visit(node.test as ES, node, "test", shadow);
        visit(node.consequent as ES, node, "consequent", guardedScope(shadow, node.test));
        visit(node.alternate as ES, node, "alternate", shadow);
        return;
      case "LogicalExpression":
        visit(node.left as ES, node, "left", shadow);
        visit(node.right as ES, node, "right", node.operator === "&&" ? guardedScope(shadow, node.left) : shadow);
        return;
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
          if (isProp(name, shadow) && (node.value as ES).__cand !== undefined) edits.push({ ...at(node.value as ES), text: `${name}: ${hooks.replacementFor(name)}` });
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
  let out = src;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue; // overlapping (should not happen) — keep the outer edit
    // The left operand of a §42 `is` predicate is located TEXTUALLY by the predicate
    // lowering downstream (an identifier / member chain / a parenthesized group), so a
    // value that is not a plain name chain lands there grouped: `label is some` with
    // `label="L"` → `("L") is some`.
    let text = e.text;
    if (/^\s*is\b/.test(src.slice(e.end)) && !/^@?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(text)
        && !(text.startsWith("(") && text.endsWith(")"))) {
      text = `(${text})`;
    }
    out = out.slice(0, e.start) + text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

/**
 * The names a `for` HEADER declares (`(let n = 0; n < 3; n++)` → `n`,
 * `(const [k, v] of xs)` → `k`, `v`, the keywordless `(n of xs)` → `n`, §50.8.5), read
 * from its parsed tree. Empty when the header declares nothing or does not parse.
 */
export function bindingNamesOfForHeader(header: string): string[] {
  try {
    const ast = ScrmlParser.parse(`for ${header.trim()} ;`, PARSE_OPTS) as unknown as ES;
    const stmt = ((ast.body as ES[]) ?? [])[0];
    if (!stmt) return [];
    const head = (stmt.type === "ForStatement" ? stmt.init : stmt.left) as ES | null;
    if (!head) return [];
    if (head.type === "VariableDeclaration") {
      const out: string[] = [];
      for (const d of (head.declarations as ES[]) ?? []) patternNames(d.id as ES, out);
      return out;
    }
    if (stmt.type !== "ForStatement" && head.type !== "MemberExpression") return patternNames(head);
    return [];
  } catch {
    return [];
  }
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
