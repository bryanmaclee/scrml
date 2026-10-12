/**
 * value-function-stored.ts — §14.3 / §15.11.5 `E-VALUE-FUNCTION-STORED` (S462 ruling "a",
 * "no value holds a function").
 *
 * The §14.3 S174 principle "a function is not value data … it SHALL NOT be STORED" extends
 * from struct fields + state cells to EVERY value: an object / array / map literal (or a spread
 * into one) that stores a function value is refused, and so is a state cell that holds one
 * (`<f> = twice`, `@f = twice`, `@o.k = twice`, `@xs.push(twice)`). Functions still flow PASSED
 * (arguments, callbacks, fn props/attributes = wiring) and CALLED (handlers); never stored.
 *
 * Host boundary (S462 "go on the package" (3)): an object/array literal written DIRECTLY as an
 * argument to a host-JS call (a callee that is not a scrml binding — a JS global, an
 * `import:host` / `.js` import, a method on a host object) is at the boundary and allowed; scrml
 * does not dictate a foreign API's shape. The same literal stored in a scrml cell/variable first
 * is refused.
 *
 * Function-ness is read from the TREE (pa.md Rule 7), never from source text:
 *   - a `lambda` ExprNode (arrow / `fn` / `function` expression), or an `escape-hatch` whose
 *     native kind is an arrow / function expression;
 *   - an identifier bound, in the lexical scope the walk tracks, to a `function-decl`, to a
 *     `const`/`let` whose initializer is one of the above, or to an imported scrml function
 *     (`importedFnDecls`);
 *   - a ternary / `||` / `??` / `&&` / `as` whose operand is one of the above.
 * Anything else (a call result, a member read, a parameter) is not judged here.
 *
 * An object literal holding a `fn(…) { … }` value is unreadable to acorn and reaches the type
 * stage as a ParseError `escape-hatch`; codegen lowers it with `rewriteFnKeyword` and emits the
 * result, so — the precedent `checkRegisterMessagesCalls` set — this pass reads what codegen will
 * emit (the same lowering, then the same expression parser) and checks THAT tree.
 *
 * An ExprNode's span is relative to its own expression text, so a diagnostic is reported at the
 * nearest enclosing AST node outside the expression tree (the statement / markup node), whose
 * span is in file coordinates.
 */
import { boundNamesOf } from "./binding-names.ts";
import { parseExprToNode } from "./expression-parser.ts";
import { rewriteFnKeyword } from "./codegen/rewrite.ts";

export interface ValueFnSpan {
  file: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

export interface ValueFnStoredDiag {
  code: "E-VALUE-FUNCTION-STORED";
  message: string;
  span: ValueFnSpan;
}

/** What a name is bound to, as far as this check needs to know. */
type BindingKind =
  | "fn"     // a scrml function (function-decl, const/let = lambda, imported scrml function)
  | "value"  // a scrml value / parameter / scrml import whose kind is unknown
  | "host";  // a host-JS binding (import:host / .js import, or a local holding a host object)

type Rec = Record<string, unknown>;

const EXPR_KINDS = new Set<string>([
  "ident", "lit", "array", "object", "spread", "unary", "binary", "assign", "ternary", "member",
  "index", "call", "new", "lambda", "cast", "match-expr", "map-lit", "sql-ref", "input-state-ref",
  "escape-hatch", "markup-value", "reset-expr", "prop", "shorthand",
]);

/** Array methods that put their arguments INTO the receiver (a store). */
const STORING_ARRAY_METHODS = new Set<string>(["push", "unshift", "splice", "fill"]);

/**
 * Methods that put their arguments into a scrml value receiver, judged on any call whose receiver
 * is rooted in a scrml binding: the array storing methods, the §59.7 map write `.insert(k, v)`,
 * and the §59.12 set write `.add(k)`.
 */
const STORING_VALUE_METHODS = new Set<string>([...STORING_ARRAY_METHODS, "insert", "add"]);

/** Statement-list keys: an array under one of these is a block (a lexical scope). */
const BLOCK_KEYS = new Set<string>(["body", "consequent", "alternate", "stmts", "children", "elseBody", "finallyBody", "catchBody"]);

function isScrmlSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  return source.startsWith("scrml:") || /\.scrml$/.test(source);
}

export function checkValueFunctionStored(
  nodes: unknown[],
  filePath: string,
  importedFnNames: Iterable<string> = [],
): ValueFnStoredDiag[] {
  const diags: ValueFnStoredDiag[] = [];
  const reported = new Set<string>();
  const seen = new WeakSet<object>();
  const defaultSpan: ValueFnSpan = { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  // ---- scope ----
  const frames: Map<string, BindingKind>[] = [new Map()];
  const lookup = (name: string): BindingKind | null => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const k = frames[i].get(name);
      if (k) return k;
    }
    return null;
  };
  const bind = (name: string, kind: BindingKind): void => { frames[frames.length - 1].set(name, kind); };
  const pushFrame = (): void => { frames.push(new Map()); };
  const popFrame = (): void => { if (frames.length > 1) frames.pop(); };

  for (const n of importedFnNames) frames[0].set(n, "fn");

  // ---- function-ness, read from the tree ----
  function fnDescription(e: unknown): string | null {
    if (!e || typeof e !== "object") return null;
    const x = e as Rec;
    switch (x.kind) {
      case "lambda":
        return x.fnStyle === "fn" ? "a `fn` expression"
          : x.fnStyle === "function" ? "a `function` expression"
          : "an arrow function";
      case "escape-hatch": {
        const nk = String(x.nativeKind ?? "");
        if (nk === "ArrowFunctionExpression") return "an arrow function";
        if (nk === "FunctionExpression") return "a `function` expression";
        return null;
      }
      case "ident": {
        const name = x.name;
        if (typeof name !== "string" || name.startsWith("@") || name.startsWith(".")) return null;
        return lookup(name) === "fn" ? `the function \`${name}\`` : null;
      }
      case "ternary":
        return fnDescription(x.consequent) ?? fnDescription(x.alternate);
      case "binary":
        if (x.op === "||" || x.op === "??" || x.op === "&&") return fnDescription(x.right) ?? fnDescription(x.left);
        return null;
      case "cast":
        return fnDescription(x.expression);
      default:
        return null;
    }
  }

  /** The kind of the binding at the root of a receiver / callee chain (`a.b.c(…)` → `a`). */
  function rootKind(e: unknown): BindingKind | "global" | "other" {
    let cur = e as Rec | undefined;
    for (let guard = 0; cur && guard < 64; guard++) {
      switch (cur.kind) {
        case "member": case "index": cur = cur.object as Rec; continue;
        case "call": case "new": cur = cur.callee as Rec; continue;
        case "ident": {
          const name = cur.name;
          if (typeof name !== "string") return "other";
          if (name.startsWith("@")) return "value";
          return lookup(name) ?? "global";
        }
        default: return "other";
      }
    }
    return "other";
  }

  /** "The state cell `@m`" / "The value `xs`" — the receiver of a storing method call. */
  function describeReceiver(e: unknown): string {
    let cur = e as Rec | undefined;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur.kind === "member" || cur.kind === "index") { cur = cur.object as Rec; continue; }
      break;
    }
    const name = cur && cur.kind === "ident" && typeof cur.name === "string" ? cur.name : null;
    if (!name) return "This value";
    return name.startsWith("@") ? `The state cell \`${name}\`` : `The value \`${name}\``;
  }

  /**
   * Is this callee a host-JS function? A scrml binding (function, value, scrml import) is not;
   * a JS global, an `import:host` / `.js` binding, or a method reached from one is. Anything the
   * walk cannot classify is treated as scrml (fail closed: the literal is judged).
   */
  function isHostCallee(callee: unknown): boolean {
    const k = rootKind(callee);
    return k === "host" || k === "global";
  }

  function report(what: string, fn: string, at: ValueFnSpan, fieldHint: string | null): void {
    const key = `${at.file}:${at.start}:${at.end}:${what}:${fn}:${fieldHint ?? ""}`;
    if (reported.has(key)) return;
    reported.add(key);
    const where = fieldHint ? ` (${fieldHint})` : "";
    diags.push({
      code: "E-VALUE-FUNCTION-STORED",
      message:
        `E-VALUE-FUNCTION-STORED: ${what} stores ${fn}${where}. A function is not value data — it has no ` +
        `structural equality, is not serializable and cannot be a map key — so no value holds one: not an ` +
        `object, array or map literal, not a spread into one, not a state cell (§14.3, §15.11.5). Pass it ` +
        `instead: hand ${fn} directly to the call that uses it as its own argument (a callback), wire it as ` +
        `a component prop or event handler, or call it where the work happens; to choose between behaviours, ` +
        `store an enum tag and \`match\` on it.`,
      span: at,
    });
  }

  // ---- expression walk ----
  // `hostArg` is true only while descending through the literal containers of a literal written
  // directly as a host-JS call argument; any other node kind resets it.
  function walkExpr(e: unknown, at: ValueFnSpan, hostArg: boolean): void {
    if (!e || typeof e !== "object") return;
    if (Array.isArray(e)) { for (const c of e) walkExpr(c, at, hostArg); return; }
    if (seen.has(e as object)) return;
    seen.add(e as object);
    const x = e as Rec;
    switch (x.kind) {
      case "object": {
        for (const p of (x.props as Rec[] | undefined) ?? []) {
          if (!p || typeof p !== "object") continue;
          if (p.kind === "prop") {
            const keyName = typeof p.key === "string" ? p.key : null;
            const d = hostArg ? null : fnDescription(p.value);
            if (d) report("This object literal", d, at, keyName ? `in field \`${keyName}\`` : null);
            if (p.computed && p.key && typeof p.key === "object") walkExpr(p.key, at, false);
            walkExpr(p.value, at, hostArg);
          } else if (p.kind === "shorthand") {
            const name = p.name;
            if (!hostArg && typeof name === "string" && lookup(name) === "fn") {
              report("This object literal", `the function \`${name}\``, at, `in field \`${name}\``);
            }
          } else if (p.kind === "spread") {
            const d = hostArg ? null : fnDescription(p.argument);
            if (d) report("This object literal", d, at, "through a spread");
            walkExpr(p.argument, at, hostArg);
          }
        }
        return;
      }
      case "array": {
        let i = 0;
        for (const el of (x.elements as Rec[] | undefined) ?? []) {
          if (el && typeof el === "object") {
            const target = el.kind === "spread" ? el.argument : el;
            const d = hostArg ? null : fnDescription(target);
            if (d) report("This array literal", d, at, el.kind === "spread" ? "through a spread" : `at index ${i}`);
            walkExpr(target, at, hostArg);
          }
          i++;
        }
        return;
      }
      case "map-lit": {
        for (const ent of (x.entries as Rec[] | undefined) ?? []) {
          if (!ent) continue;
          const d = hostArg ? null : fnDescription(ent.value);
          if (d) report("This map literal", d, at, null);
          walkExpr(ent.key, at, false);
          walkExpr(ent.value, at, hostArg);
        }
        return;
      }
      case "spread":
        walkExpr(x.argument, at, hostArg);
        return;
      case "call": case "new": {
        walkExpr(x.callee, at, false);
        const host = isHostCallee(x.callee);
        // A storing method on a scrml value — `xs.push(f)`, `m.insert(k, f)`, `s.add(f)`, and the
        // same on an `@` cell inside an expression (`@m = @m.insert(k, f)`) — puts the argument
        // INTO the receiver: the array / map / set then holds a function (§59 map entries are
        // values too — S464 "Yes, maps too"). A receiver rooted in a host binding is not judged.
        const callee = x.callee as Rec | undefined;
        if (x.kind === "call" && callee && callee.kind === "member" && typeof callee.property === "string" &&
            STORING_VALUE_METHODS.has(callee.property)) {
          const rk = rootKind(callee.object);
          if (rk === "value") {
            const recv = describeReceiver(callee.object);
            const args = (x.args as unknown[] | undefined) ?? [];
            const from = callee.property === "splice" ? 2 : 0;
            for (let ai = from; ai < args.length; ai++) {
              const d = fnDescription(args[ai]);
              if (d) report(recv, d, at, `through \`.${callee.property}(…)\``);
            }
          }
        }
        for (const a of (x.args as Rec[] | undefined) ?? []) {
          if (!a || typeof a !== "object") continue;
          const lit = a.kind === "object" || a.kind === "array" || a.kind === "map-lit";
          walkExpr(a, at, host && lit);
        }
        return;
      }
      case "lambda": {
        pushFrame();
        for (const p of (x.params as unknown[] | undefined) ?? []) {
          for (const n of boundNamesOf(p)) bind(n, "value");
          const dv = (p as Rec | null)?.defaultValue;
          if (dv) walkExpr(dv, at, false);
        }
        const body = x.body as Rec | undefined;
        if (body?.kind === "expr") walkExpr(body.value, at, false);
        else if (body?.kind === "block") walkStmts(body.stmts as unknown[], at);
        popFrame();
        return;
      }
      case "escape-hatch": {
        // See the module header: read what codegen will emit for an unreadable `fn` literal.
        if (x.nativeKind === "ParseError" && typeof x.raw === "string") {
          const raw = x.raw as string;
          const lowered = rewriteFnKeyword(raw);
          if (lowered !== raw) {
            let reparsed: unknown = null;
            try { reparsed = parseExprToNode(lowered, at.file ?? filePath, 0); } catch { reparsed = null; }
            if (reparsed && (reparsed as Rec).kind !== "escape-hatch") walkExpr(reparsed, at, hostArg);
          }
        }
        return;
      }
      default:
        for (const k in x) {
          if (k === "span") continue;
          const v = x[k];
          if (v && typeof v === "object") walkAny(v, at);
        }
    }
  }

  // ---- statement / tree walk ----
  function spanOf(node: Rec, fallback: ValueFnSpan): ValueFnSpan {
    const sp = node.span as ValueFnSpan | undefined;
    const kind = typeof node.kind === "string" ? node.kind : "";
    if (kind && !EXPR_KINDS.has(kind) && sp && typeof sp.start === "number" && typeof sp.line === "number") {
      return { file: sp.file ?? fallback.file, start: sp.start, end: sp.end, line: sp.line, col: sp.col };
    }
    return fallback;
  }

  function hoist(stmts: unknown[]): void {
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      const r = s as Rec;
      if (r.kind === "function-decl" && typeof r.name === "string") bind(r.name, "fn");
      if (r.kind === "export-decl" && r.declaration && typeof r.declaration === "object") hoist([r.declaration]);
    }
  }

  function initKind(declKind: string, init: unknown): BindingKind {
    if (!init || typeof init !== "object") return "value";
    if ((declKind === "const-decl" || declKind === "let-decl") && fnDescription(init) &&
        ((init as Rec).kind === "lambda" || (init as Rec).kind === "escape-hatch")) {
      return "fn";
    }
    const k = (init as Rec).kind;
    if ((k === "call" || k === "new") && isHostCallee((init as Rec).callee)) return "host";
    if (k === "member" || k === "index") {
      const rk = rootKind(init);
      if (rk === "host" || rk === "global") return "host";
    }
    return "value";
  }

  function walkStmts(stmts: unknown[], at: ValueFnSpan): void {
    pushFrame();
    hoist(stmts);
    for (const s of stmts) walkAny(s, at);
    popFrame();
  }

  function walkAny(v: unknown, at: ValueFnSpan): void {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const c of v) walkAny(c, at); return; }
    const node = v as Rec;
    const kind = typeof node.kind === "string" ? node.kind : "";
    if (kind && EXPR_KINDS.has(kind)) { walkExpr(node, at, false); return; }
    if (seen.has(node)) return;
    seen.add(node);
    const here = spanOf(node, at);

    switch (kind) {
      case "import-decl": {
        const host = !isScrmlSource(node.source);
        const specs = node.specifiers as Rec[] | undefined;
        const names: string[] = Array.isArray(specs) && specs.length > 0
          ? specs.map((s) => String(s.local ?? s.imported ?? ""))
          : ((node.names as string[] | undefined) ?? []);
        for (const n of names) {
          if (!n) continue;
          if (lookup(n) === "fn" && !host) continue; // an imported scrml function (importedFnDecls)
          frames[0].set(n, host ? "host" : "value");
        }
        return;
      }
      case "function-decl": {
        if (typeof node.name === "string") bind(node.name, "fn");
        pushFrame();
        for (const p of (node.params as unknown[] | undefined) ?? []) {
          for (const n of boundNamesOf(p)) bind(n, "value");
        }
        for (const k in node) {
          if (k === "span" || k === "params" || k === "body") continue;
          const c = node[k];
          if (c && typeof c === "object") walkAny(c, here);
        }
        if (Array.isArray(node.body)) walkStmts(node.body as unknown[], here);
        popFrame();
        return;
      }
      case "let-decl": case "const-decl": case "tilde-decl": case "lin-decl": {
        for (const k in node) {
          if (k === "span" || k === "name") continue;
          const c = node[k];
          if (c && typeof c === "object") walkAny(c, here);
        }
        const bk = initKind(kind, node.initExpr);
        for (const n of boundNamesOf(node.name)) bind(n, bk);
        return;
      }
      case "state-decl": {
        const d = fnDescription(node.initExpr);
        if (d) report(`The state cell \`@${String(node.name ?? "")}\``, d, here, null);
        break;
      }
      case "reactive-assign": {
        const d = fnDescription(node.valueExpr);
        if (d) report(`The state cell \`@${String(node.target ?? "")}\``, d, here, null);
        break;
      }
      case "reactive-nested-assign": {
        const d = fnDescription(node.valueExpr);
        const path = Array.isArray(node.path) ? (node.path as unknown[]).join(".") : "";
        if (d) report(`The state cell \`@${String(node.target ?? "")}\``, d, here, path ? `in field \`${path}\`` : null);
        break;
      }
      case "reactive-array-mutation": {
        if (typeof node.method === "string" && STORING_ARRAY_METHODS.has(node.method)) {
          for (const a of (node.argExprs as unknown[] | undefined) ?? []) {
            const d = fnDescription(a);
            if (d) report(`The state cell \`@${String(node.target ?? "")}\``, d, here, `through \`.${node.method}(…)\``);
          }
        }
        break;
      }
      case "for-stmt": {
        pushFrame();
        for (const n of boundNamesOf(node.variable)) bind(n, "value");
        for (const k in node) {
          if (k === "span" || k === "variable") continue;
          const c = node[k];
          if (c && typeof c === "object") walkAny(c, here);
        }
        popFrame();
        return;
      }
      default:
        break;
    }

    for (const k in node) {
      if (k === "span") continue;
      const c = node[k];
      if (!c || typeof c !== "object") continue;
      if (Array.isArray(c) && BLOCK_KEYS.has(k)) walkStmts(c, here);
      else walkAny(c, here);
    }
  }

  // Top level: every file-level function (in any top-level logic block) and every file-level
  // `const f = (…) => …` is visible file-wide (markup attributes and other blocks read them).
  const topLevel = (list: unknown[]): void => {
    for (const n of list) {
      if (!n || typeof n !== "object") continue;
      const r = n as Rec;
      if (r.kind === "function-decl") { if (typeof r.name === "string") frames[0].set(r.name, "fn"); continue; }
      if (r.kind === "const-decl" || r.kind === "let-decl") {
        const ik = r.initExpr as Rec | undefined;
        if (ik && (ik.kind === "lambda" || (ik.kind === "escape-hatch" && fnDescription(ik)))) {
          for (const nm of boundNamesOf(r.name)) frames[0].set(nm, "fn");
        }
        continue;
      }
      if (r.kind === "logic" && Array.isArray(r.body)) topLevel(r.body as unknown[]);
      if (r.kind === "markup" && Array.isArray(r.children)) topLevel(r.children as unknown[]);
    }
  };
  topLevel(nodes);

  for (const n of nodes) walkAny(n, defaultSpan);
  return diags;
}
