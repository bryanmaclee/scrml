/**
 * @module codegen/fn-name-rename
 *
 * The client `post-fn-name-mangle` pass, made SCOPE-AWARE.
 *
 * ## What the pass is for
 *
 * A user function `function bump()` is emitted under its §47 encoded name
 * (`function _scrml_bump_4()`), while most emitters write the AUTHOR name at the
 * call sites they produce (`bump()`), relying on one pass over the assembled
 * client body to rewrite those call sites to the encoded name.
 *
 * ## Why the regex pass was wrong (g-user-function-named-id-breaks-click-dispatch-s457)
 *
 * That pass was a scope-blind regex over the whole buffer. The buffer is not only
 * user code: the compiler's own boot / dispatch / wiring code lives in it, and
 * that code declares locals with ordinary names. With a user `function id(x)`, the
 * click dispatcher's own local
 *
 *     const id = t.getAttribute("data-scrml-bind-onclick");
 *     if (id && _scrml_click[id]) { _scrml_click[id](event); return; }
 *
 * became `_scrml_click[_scrml_id_3]` — every click handler on the page dead, at
 * exit 0. The corpus sweep in docs/changes/s457-runtime-local-rename-and-handler-
 * truncation/ found the same exposure for well over a hundred compiler-emitted
 * local names (`el`, `event`, `root`, `t`, `i`, `item`, `key`, `d`, `e`, `value`,
 * `body`, `path`, `match`, ...) and for the user's own locals and parameters
 * (`(total) => total * 2` beside a server `function total` —
 * g-lambda-param-renamed-to-fetch-stub-when-a-server-fn-shares-its-name; a
 * destructured `const { get } = src` — g-mangler-scope-blind-shorthand-key-rename).
 *
 * ## The rule this pass implements
 *
 * Only a reference that means the USER'S FUNCTION is renamed. The user's function
 * is a top-level binding whose declaration is already emitted under the encoded
 * name, so a reference to it is exactly a reference that NO enclosing scope binds:
 * an identifier in reference position, named in `fnNameMap`, that resolves to no
 * declaration in its scope chain. A name bound by an enclosing scope — a compiler
 * local, a user's own local or parameter, a destructured binding — is that
 * binding, and is left alone, along with every use that resolves to it.
 *
 * The SYNTACTIC positions the regex renamed are kept exactly (an identifier
 * followed by `(`, `;`, `,`, `}`, `]`, `)`, a line break, a comment, a literal,
 * or the end of the text); this pass only removes the scope-bound ones from that
 * set. So it never renames anything the regex did not, and the change of
 * direction is one way: a locally-bound name stops being renamed.
 *
 * ## Why Acorn
 *
 * A regex cannot see scopes. The pass PARSES the body and rewrites by SPLICING
 * located ranges — never by regenerating source, which would reflow the whole
 * file and drop the comments that keep generated JS readable (the precedent is
 * codegen/cell-accessor-rename.ts). A body that does not parse returns `null`;
 * the caller then keeps the regex pass, so an already-invalid buffer compiles
 * exactly as it did before.
 *
 * ## Not covered here (named so nobody assumes it)
 *
 * A compiler-emitted reference to a HOST GLOBAL (`document`, `fetch`, `String`,
 * `setTimeout`, ...) is free, exactly like a reference to the user's function, so
 * a user function named after a host global the emitted code uses still captures
 * that use. Scope cannot separate the two; that needs the compiler's global
 * references spelled in a form no user binding can reach. It is filed separately.
 */

import * as acorn from "acorn";
import { rewriteCodeSegments } from "./code-segments.ts";

type AnyNode = Record<string, any> & { type: string; start: number; end: number };

interface Scope {
  parent: Scope | null;
  names: Set<string>;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Rename every free reference to a user function in `code`, in the positions
 * the legacy regex renamed. Returns `null` when `code` does not parse.
 */
export function renameUserFnRefsScoped(
  code: string,
  fnNameMap: ReadonlyMap<string, string>,
): string | null {
  if (!code || fnNameMap.size === 0) return code;
  // Cheap exit: no mapped name occurs anywhere in the text.
  let any = false;
  for (const n of fnNameMap.keys()) {
    if (code.includes(n)) { any = true; break; }
  }
  if (!any) return code;

  const ast = parse(code) ?? parse(neutralizeAwait(code));
  if (ast === null) return null;

  const edits: Edit[] = [];

  const declare = (scope: Scope, name: string) => { scope.names.add(name); };
  const isBound = (scope: Scope, name: string): boolean => {
    for (let s: Scope | null = scope; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  };

  /** The text after a reference ends in a position the legacy regex renamed. */
  const inRenamedPosition = (end: number): boolean => {
    let i = end;
    let sawNewline = false;
    while (i < code.length) {
      const c = code[i];
      if (c === "\n") { sawNewline = true; i++; continue; }
      if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " ") { i++; continue; }
      break;
    }
    if (sawNewline) return true;
    if (i >= code.length) return true;
    const c = code[i];
    if (c === "(" || c === ";" || c === "," || c === "}" || c === "]" || c === ")") return true;
    // The regex ran on code segments only: a comment or a string / template
    // literal starting here ended the segment, which its `$` alternative matched.
    if (c === "/" && (code[i + 1] === "/" || code[i + 1] === "*")) return true;
    if (c === '"' || c === "'" || c === "`") return true;
    return false;
  };

  /** Rename one reference when it is free and named in the map. */
  const ref = (id: AnyNode, scope: Scope) => {
    const name = id.name as string;
    const mangled = fnNameMap.get(name);
    if (mangled === undefined) return;
    if (isBound(scope, name)) return;
    // s457 3a (S458 review (c)) — a free reference to the user's function is
    // renamed in EVERY position (a member root `event.x`, a bare value
    // `cb = event`), not only the call-like positions the legacy regex knew:
    // with the handler wrapper no longer binding `event`, `event.preventDefault()`
    // beside a user `function event` is that function, and left as written it
    // was a dangling `event` after the rename. EXCEPT a host-global name
    // (`document`, `Math`, `console`, …): compiler-emitted code references those
    // as free member roots, and a user function that shadows one keeps the
    // legacy positions until host-global references are spelled through an
    // alias (g-user-fn-named-host-global-hijacks-compiler-refs-s457).
    if (!inRenamedPosition(id.end) && isHostGlobalName(name)) return;
    edits.push({ start: id.start, end: id.end, text: mangled });
  };

  // ---------------------------------------------------------------------------
  // Declaration collection
  // ---------------------------------------------------------------------------

  /** Every identifier a binding pattern declares. */
  const patternNames = (p: AnyNode | null, out: string[]) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": out.push(p.name); return;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") patternNames(prop.argument, out);
          else patternNames(prop.value, out);
        }
        return;
      case "ArrayPattern": for (const el of p.elements) patternNames(el, out); return;
      case "RestElement": patternNames(p.argument, out); return;
      case "AssignmentPattern": patternNames(p.left, out); return;
      default: return;
    }
  };

  /**
   * `var` declarations and function declarations anywhere in a function body,
   * not crossing into nested functions (hoisting; a function declaration inside
   * a block also binds the function scope in sloppy code, ECMA-262 B.3.3).
   */
  const hoisted = (node: AnyNode | null, out: string[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) hoisted(n, out); return; }
    switch (node.type) {
      case "FunctionDeclaration":
        if (node.id) out.push(node.id.name);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ClassDeclaration":
      case "ClassExpression":
        return;
      case "VariableDeclaration":
        if (node.kind === "var") for (const d of node.declarations) patternNames(d.id, out);
        for (const d of node.declarations) hoisted(d.init, out);
        return;
    }
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = node[k];
      if (v && typeof v === "object") hoisted(v, out);
    }
  };

  /** let / const / class / function declared directly in a statement list. */
  const lexical = (stmts: AnyNode[], scope: Scope) => {
    for (const s of stmts) {
      if (!s) continue;
      let decl = s;
      if ((s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") && s.declaration) decl = s.declaration;
      if (decl.type === "VariableDeclaration" && decl.kind !== "var") {
        const out: string[] = [];
        for (const d of decl.declarations) patternNames(d.id, out);
        for (const n of out) declare(scope, n);
      } else if ((decl.type === "ClassDeclaration" || decl.type === "FunctionDeclaration") && decl.id) {
        declare(scope, decl.id.name);
      } else if (decl.type === "ImportDeclaration") {
        for (const sp of decl.specifiers) declare(scope, sp.local.name);
      }
    }
  };

  const newScope = (parent: Scope | null): Scope => ({ parent, names: new Set() });

  // ---------------------------------------------------------------------------
  // Walk
  // ---------------------------------------------------------------------------

  /** A pattern in a BINDING position: its identifiers are declarations. */
  const bindingPattern = (p: AnyNode | null, scope: Scope) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": return;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") { bindingPattern(prop.argument, scope); continue; }
          if (prop.computed) expr(prop.key, scope);
          bindingPattern(prop.value, scope);
        }
        return;
      case "ArrayPattern": for (const el of p.elements) bindingPattern(el, scope); return;
      case "RestElement": bindingPattern(p.argument, scope); return;
      case "AssignmentPattern": bindingPattern(p.left, scope); expr(p.right, scope); return;
      default: expr(p, scope); return;
    }
  };

  /** A pattern in an ASSIGNMENT position: its identifiers are references. */
  const assignPattern = (p: AnyNode | null, scope: Scope) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": ref(p, scope); return;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") { assignPattern(prop.argument, scope); continue; }
          if (prop.computed) expr(prop.key, scope);
          if (prop.shorthand && prop.value.type === "Identifier") { shorthand(prop, prop.value, scope); continue; }
          if (prop.shorthand && prop.value.type === "AssignmentPattern" && prop.value.left.type === "Identifier") {
            shorthand(prop, prop.value.left, scope);
            expr(prop.value.right, scope);
            continue;
          }
          assignPattern(prop.value, scope);
        }
        return;
      case "ArrayPattern": for (const el of p.elements) assignPattern(el, scope); return;
      case "RestElement": assignPattern(p.argument, scope); return;
      case "AssignmentPattern": assignPattern(p.left, scope); expr(p.right, scope); return;
      default: expr(p, scope); return;
    }
  };

  /**
   * A shorthand property `{ name }` whose value is a renamed reference is
   * EXPANDED to `{ name: encoded }`: the key stays the public property name and
   * the value resolves to the function (g-mangler-scope-blind-shorthand-key-rename).
   * `{ __proto__ }` expands to the COMPUTED form `["__proto__"]: encoded`: the
   * shorthand creates an own property, and so does a computed key, while the
   * plain `__proto__: x` form would set the prototype instead (ECMA-262 B.3.1).
   * In an assignment pattern the computed key reads the same property.
   */
  const shorthand = (prop: AnyNode, id: AnyNode, scope: Scope) => {
    const name = id.name as string;
    const mangled = fnNameMap.get(name);
    if (mangled === undefined) return;
    if (isBound(scope, name)) return;
    const key = name === "__proto__" ? `["__proto__"]` : name;
    edits.push({ start: id.start, end: id.end, text: `${key}: ${mangled}` });
  };

  const fn = (node: AnyNode, outer: Scope) => {
    const scope = newScope(outer);
    // A named function expression binds its own name inside itself.
    if (node.type === "FunctionExpression" && node.id) declare(scope, node.id.name);
    const pnames: string[] = [];
    for (const p of node.params) patternNames(p, pnames);
    for (const n of pnames) declare(scope, n);
    if (node.type !== "ArrowFunctionExpression") declare(scope, "arguments");
    if (node.body.type === "BlockStatement") {
      const hs: string[] = [];
      hoisted(node.body.body, hs);
      for (const n of hs) declare(scope, n);
      lexical(node.body.body, scope);
    }
    for (const p of node.params) bindingPattern(p, scope);
    if (node.body.type === "BlockStatement") stmts(node.body.body, scope);
    else expr(node.body, scope);
  };

  const cls = (node: AnyNode, scope: Scope) => {
    let inner = scope;
    if (node.type === "ClassExpression" && node.id) { inner = newScope(scope); declare(inner, node.id.name); }
    if (node.superClass) expr(node.superClass, inner);
    for (const m of node.body.body) {
      if (m.type === "StaticBlock") { block(m.body, inner); continue; }
      if (m.computed) expr(m.key, inner);
      if (m.value) expr(m.value, inner);
    }
  };

  const block = (body: AnyNode[], outer: Scope) => {
    const scope = newScope(outer);
    lexical(body, scope);
    stmts(body, scope);
  };

  const stmts = (list: AnyNode[], scope: Scope) => { for (const s of list) stmt(s, scope); };

  const stmt = (node: AnyNode | null, scope: Scope): void => {
    if (!node) return;
    switch (node.type) {
      case "BlockStatement": block(node.body, scope); return;
      case "StaticBlock": block(node.body, scope); return;
      case "FunctionDeclaration": fn(node, scope); return;
      case "ClassDeclaration": cls(node, scope); return;
      case "VariableDeclaration":
        for (const d of node.declarations) { bindingPattern(d.id, scope); expr(d.init, scope); }
        return;
      case "ForStatement": {
        const inner = newScope(scope);
        if (node.init && node.init.type === "VariableDeclaration") {
          if (node.init.kind !== "var") { const out: string[] = []; for (const d of node.init.declarations) patternNames(d.id, out); for (const n of out) declare(inner, n); }
          stmt(node.init, inner);
        } else expr(node.init, inner);
        expr(node.test, inner);
        expr(node.update, inner);
        stmt(node.body, inner);
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const inner = newScope(scope);
        if (node.left.type === "VariableDeclaration") {
          if (node.left.kind !== "var") { const out: string[] = []; for (const d of node.left.declarations) patternNames(d.id, out); for (const n of out) declare(inner, n); }
          for (const d of node.left.declarations) bindingPattern(d.id, inner);
        } else assignPattern(node.left, inner);
        expr(node.right, inner);
        stmt(node.body, inner);
        return;
      }
      case "SwitchStatement": {
        expr(node.discriminant, scope);
        const inner = newScope(scope);
        const all: AnyNode[] = [];
        for (const c of node.cases) all.push(...c.consequent);
        lexical(all, inner);
        for (const c of node.cases) { expr(c.test, inner); stmts(c.consequent, inner); }
        return;
      }
      case "TryStatement":
        stmt(node.block, scope);
        if (node.handler) {
          const inner = newScope(scope);
          const out: string[] = [];
          patternNames(node.handler.param, out);
          for (const n of out) declare(inner, n);
          bindingPattern(node.handler.param, inner);
          stmt(node.handler.body, inner);
        }
        stmt(node.finalizer, scope);
        return;
      case "LabeledStatement": stmt(node.body, scope); return;
      case "BreakStatement":
      case "ContinueStatement":
      case "EmptyStatement":
      case "DebuggerStatement":
        return;
      case "ImportDeclaration": return;
      case "ExportNamedDeclaration":
        if (node.declaration) { stmt(node.declaration, scope); return; }
        if (!node.source) {
          for (const sp of node.specifiers) {
            const local = sp.local;
            if (local.type !== "Identifier") continue;
            const mangled = fnNameMap.get(local.name);
            if (mangled === undefined || isBound(scope, local.name)) continue;
            const exportedName = sp.exported.type === "Identifier" ? sp.exported.name : null;
            if (sp.exported.start === local.start && exportedName !== null) {
              edits.push({ start: local.start, end: local.end, text: `${mangled} as ${exportedName}` });
            } else {
              edits.push({ start: local.start, end: local.end, text: mangled });
            }
          }
        }
        return;
      case "ExportDefaultDeclaration":
        if (node.declaration.type === "FunctionDeclaration") fn(node.declaration, scope);
        else if (node.declaration.type === "ClassDeclaration") cls(node.declaration, scope);
        else expr(node.declaration, scope);
        return;
      case "ExportAllDeclaration": return;
      default:
        // ExpressionStatement, If, While, DoWhile, Return, Throw, With: walk the
        // children generically — a sub-statement goes back through stmt, a
        // sub-expression through expr.
        for (const k of Object.keys(node)) {
          if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
          const v = node[k];
          if (!v || typeof v !== "object") continue;
          if (Array.isArray(v)) { for (const c of v) child(c, scope); continue; }
          child(v, scope);
        }
        return;
    }
  };

  const STATEMENT_TYPES = /Statement$|Declaration$|^StaticBlock$/;
  const child = (v: AnyNode, scope: Scope) => {
    if (!v || typeof v.type !== "string") return;
    if (STATEMENT_TYPES.test(v.type)) stmt(v, scope);
    else expr(v, scope);
  };

  const expr = (node: AnyNode | null, scope: Scope): void => {
    if (!node || typeof node !== "object" || typeof node.type !== "string") return;
    switch (node.type) {
      case "Identifier": ref(node, scope); return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        fn(node, scope); return;
      case "ClassExpression": cls(node, scope); return;
      case "MemberExpression":
        expr(node.object, scope);
        if (node.computed) expr(node.property, scope);
        return;
      case "MetaProperty": return;
      case "ObjectExpression":
        for (const prop of node.properties) {
          if (prop.type === "SpreadElement") { expr(prop.argument, scope); continue; }
          if (prop.computed) expr(prop.key, scope);
          if (prop.shorthand && prop.value.type === "Identifier") { shorthand(prop, prop.value, scope); continue; }
          expr(prop.value, scope);
        }
        return;
      case "AssignmentExpression":
        assignPattern(node.left, scope);
        expr(node.right, scope);
        return;
      case "Property":
        if (node.computed) expr(node.key, scope);
        expr(node.value, scope);
        return;
      case "ObjectPattern":
      case "ArrayPattern":
        assignPattern(node, scope); return;
      default:
        for (const k of Object.keys(node)) {
          if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
          const v = node[k];
          if (!v || typeof v !== "object") continue;
          if (Array.isArray(v)) { for (const c of v) child(c, scope); continue; }
          child(v, scope);
        }
        return;
    }
  };

  // Program scope.
  const top = newScope(null);
  const hs: string[] = [];
  hoisted(ast.body, hs);
  for (const n of hs) declare(top, n);
  lexical(ast.body, top);
  stmts(ast.body, top);

  if (edits.length === 0) return code;
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  let last = Infinity;
  for (const e of edits) {
    if (e.end > last) continue; // never splice overlapping ranges
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }
  return out;
}

/**
 * A host-environment global the emitted code may reference as a free name —
 * a FIXED list committed in source: the ECMAScript standard built-ins and the
 * web-platform globals. Never probed from the compiler's own process
 * (`name in globalThis`): that made the output depend on the host running
 * the compiler (Bun vs Node; a test process with happy-dom globals registered
 * saw `open` / `event` as globals and emitted different code — S458 review).
 * A compile is a pure function of its inputs.
 *
 * The list MUST hold every host global the compiler itself emits into client
 * text as a free name outside a call position (the rename runs on the client
 * buffer only; the runtime is spliced in after it) — e.g. `NodeFilter.SHOW_COMMENT`
 * (emit-each), `document.…`, `window.…`, `globalThis.…`. Otherwise a user
 * function of that name would capture the compiler's reference. Server / tool
 * globals (`process`, `Bun`, `Buffer`) are not here: the client buffer the
 * rename sees never references them, so a user function named `process` is
 * renamed in every position like any other user binding. Names that are window
 * properties but ordinary words (`open`, `close`, `name`, `event`, `status`) are
 * deliberately absent for the same reason — they are the user's names.
 * `tests/unit/fn-name-rename-determinism.test.js` pins the host independence.
 */
const ECMASCRIPT_GLOBALS = [
  "globalThis", "Infinity", "NaN", "undefined", "eval", "isFinite", "isNaN", "parseFloat", "parseInt",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "unescape",
  "Object", "Function", "Boolean", "Symbol", "Error", "AggregateError", "EvalError", "RangeError",
  "ReferenceError", "SyntaxError", "TypeError", "URIError", "Number", "BigInt", "Math", "Date",
  "String", "RegExp", "Array", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "JSON", "Promise", "Proxy", "Reflect",
  "Intl", "Iterator",
];
const WEB_GLOBALS = [
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "performance", "screen", "customElements", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "matchMedia", "getComputedStyle", "alert", "confirm",
  "prompt", "console", "crypto", "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "queueMicrotask", "structuredClone", "atob", "btoa", "URL", "URLSearchParams", "Headers", "Request",
  "Response", "FormData", "Blob", "File", "AbortController", "AbortSignal", "TextEncoder", "TextDecoder",
  "HTMLElement", "Element", "Node", "NodeFilter", "Event", "CustomEvent", "PopStateEvent", "EventTarget",
  "MutationObserver", "IntersectionObserver", "ResizeObserver", "DOMParser", "FileReader", "Image",
  "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "BroadcastChannel", "MessageChannel", "indexedDB",
  "caches", "self", "parent", "top", "frames",
];
const HOST_GLOBAL_NAMES: ReadonlySet<string> = new Set([...ECMASCRIPT_GLOBALS, ...WEB_GLOBALS]);
function isHostGlobalName(name: string): boolean {
  return HOST_GLOBAL_NAMES.has(name);
}

/**
 * A body can hold `await` inside a function that a LATER pass makes `async`
 * (post-server-fn-iife-wrap), so it does not parse yet. For scope analysis the
 * operator is irrelevant: `await` (5 chars) becomes `void ` (5 chars, the same
 * unary precedence) in code positions only, so every offset is unchanged.
 * `for await (` is left alone (it has no `void` counterpart).
 */
function neutralizeAwait(js: string): string {
  if (!js.includes("await")) return js;
  return rewriteCodeSegments(js, (seg) =>
    seg.replace(/(?<![A-Za-z0-9_$.])await(?![A-Za-z0-9_$])/g, (m, off: number, whole: string) =>
      /\bfor\s*$/.test(whole.slice(0, off)) ? m : "void "),
  );
}

function parse(js: string): AnyNode | null {
  for (const sourceType of ["script", "module"] as const) {
    try {
      return acorn.parse(js, {
        ecmaVersion: "latest",
        sourceType,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowHashBang: true,
      }) as unknown as AnyNode;
    } catch {
      // try the other grammar
    }
  }
  return null;
}
