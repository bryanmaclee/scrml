/**
 * meta-allow-list.ts — the CLOSED allow-list for `^{}` meta bodies (SPEC §22.12, S457).
 *
 * §22.12 (S114 Approach C): "The general-developer `^{}` body parser SHALL accept only
 * scrml-native + this enumerated primitive set". The S134 enforcement was a DENY list of
 * names (`bun`, `process`, `setInterval`, …) — it failed open: anything not on the list
 * reached the compiler's host realm (`"".constructor.constructor("return process")()`,
 * `emit.constructor`, `globalThis`, `Reflect`, …). This module replaces it with an
 * allow-list over the PARSED body.
 *
 * A meta body may reference only:
 *   (a) scrml constructs — `@cell` reads, declared type names, the absence value `not`;
 *   (b) its own local bindings (lexically scoped, not a flat name bag);
 *   (c) the bindings captured from the enclosing scope (§22.3);
 *   (d) the closed primitive set — compile-time `emit` / `emit.raw` / `reflect` (§22.4)
 *       and the runtime `meta` object's 12 members (§22.5.1).
 *   No JS value builtin (`Object`, `JSON`, `Math`, `String`, …) is on the list.
 *
 * Any other free identifier is E-META-001. Independently of names, these are refused on
 * ANY value (primitives included — `emit.constructor` reaches the host `Function`):
 *   - member access to `constructor` / `__proto__` / `prototype` / `__defineGetter__` /
 *     `__defineSetter__` / `__lookupGetter__` / `__lookupSetter__` (dotted, bracketed with
 *     a literal key, or destructured);
 *   - a computed member key that is not a literal (`x[k]` — `k` could hold "constructor");
 *   - `this`, `import(…)`, `import.meta`, `new.target`, `super`, classes, `with`, tagged
 *     templates, getters / setters in object literals;
 *   - a primitive's member outside its closed list (`emit.call`, `meta.unknown`);
 *   - an assignment / update / `delete` whose target is rooted at a primitive.
 *
 * Two readers, one rule. `checkMetaBodyNodes` walks the scrml AST of a `^{}` body (both
 * compile-time and runtime classifications; meta-checker.ts, Stage 6.5 MC).
 * `checkExecutedMetaJs` walks the EXACT JavaScript text meta-eval is about to run
 * (Stage 6.5 ME) — the body after serialization plus the captured declarations it
 * prepends — so a serializer transform (e.g. the `emit("…${x}…")` -> template rewrite)
 * cannot execute something the AST reader did not see.
 */

import * as acorn from "acorn";
import type { ExprNode, Span } from "./types/ast.ts";
import { tokenizeTemplateInterpolations, parseExprToNode } from "./expression-parser.ts";

// ---------------------------------------------------------------------------
// The closed sets
// ---------------------------------------------------------------------------

/** Member names refused on ANY value inside a `^{}` body (prototype / constructor reach). */
export const META_REFUSED_MEMBERS: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

/** §22.5.1 — the 12 runtime `meta` members. */
export const META_RUNTIME_MEMBERS: ReadonlySet<string> = new Set([
  "get", "set", "subscribe", "emit", "cleanup", "scopeId", "bindings", "types",
  "interval", "timeout", "clearInterval", "clearTimeout",
]);

/**
 * The primitive set (§22.4 / §22.5.1). `null` member list = members unrestricted beyond
 * META_REFUSED_MEMBERS (the primitive's value is the compiler's own object; reaching a
 * member of it is fine, reaching its constructor is not).
 */
const PRIMITIVE_MEMBERS: ReadonlyMap<string, ReadonlySet<string> | null> = new Map<string, ReadonlySet<string> | null>([
  ["emit", new Set(["raw"])],
  ["reflect", new Set<string>()],
  ["meta", META_RUNTIME_MEMBERS],
  // §22.4 — the reserved `compiler.*` namespace. E-META-010 is its diagnostic of record;
  // it is admitted here only so the allow-list does not pile a second error on top
  // (`null` = its member names are E-META-010's to judge; refused members still refused).
  ["compiler", null],
]);

/*
 * No JS value builtin is on the allow-list (S457). `Object`, `Array`, `JSON`, `Math`,
 * `String`, `Number`, `Date`, `Map`, `Set`, `parseInt`, `NaN`, `undefined`, … are JS-host
 * ambient globals, not scrml (§41.5: "There is no ambient `Math` global in scrml") — the
 * S457 measurement found no corpus `^{}` body that compiled clean and needed one. Methods
 * on VALUES (`s.toUpperCase()`, `xs.map(f)`, `xs.at(i)`, `info.fields.length`) are not
 * free identifiers and stay available, subject to the refused-member rule.
 */

/** The allowed-set sentence every refusal message carries. */
export const META_ALLOWED_SET_TEXT =
  "A ^{} body may reference only scrml constructs, its own local bindings, the bindings " +
  "captured from the enclosing scope (§22.3), and the closed primitive set: emit / emit.raw / " +
  "reflect (§22.4) and meta.get / meta.set / meta.subscribe / meta.emit / meta.cleanup / " +
  "meta.scopeId / meta.bindings / meta.types / meta.interval / meta.timeout / " +
  "meta.clearInterval / meta.clearTimeout (§22.5.1) (§22.12 Approach C, closed allow-list).";

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export interface MetaAllowListViolation {
  /** The offending identifier / member / construct, as written. */
  name: string;
  /** Full E-META-001 message. */
  message: string;
  /** Best span available (may be undefined — caller falls back to the block span). */
  span?: Span;
}

function hintFor(name: string): string {
  switch (name) {
    case "setInterval": case "setTimeout": case "clearInterval": case "clearTimeout":
      return " Hint: use meta.interval / meta.timeout / meta.clearInterval / meta.clearTimeout (§22.5.1).";
    case "fetch":
      return " Hint: move network calls behind a server-fn boundary.";
    default:
      if (META_HOST_GLOBAL_NAMES.has(name)) {
        return ` Hint: '${name}' is a host global and is never reachable from a ^{} body; ` +
          "if you declared a cell or function with this name, rename it — the emitted reference " +
          "cannot be told apart from the global (§22.12, S458).";
      }
      return "";
  }
}

function freeIdentMessage(name: string): string {
  return `E-META-001: '${name}' is not available inside ^{} meta blocks — it is not a scrml ` +
    `construct, a local or captured binding, or a meta primitive. ${META_ALLOWED_SET_TEXT}${hintFor(name)}`;
}

function refusedMemberMessage(name: string): string {
  return `E-META-001: member '${name}' is refused inside ^{} meta blocks on every value — it reaches ` +
    `a constructor or prototype chain. ${META_ALLOWED_SET_TEXT}`;
}

const COMPUTED_KEY_WHAT =
  "a computed member access with a non-literal key (`x[k]` — `k` could name a constructor or " +
  "prototype; read an element with `x.at(i)`, iterate with `for … of`, or look a key up in a " +
  "Map with `.get(k)`)";

function constructMessage(what: string): string {
  return `E-META-001: ${what} is not admitted inside ^{} meta blocks. ${META_ALLOWED_SET_TEXT}`;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

class Scope {
  readonly names = new Set<string>();
  constructor(readonly parent: Scope | null) {}
  has(name: string): boolean {
    for (let s: Scope | null = this; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  }
  child(): Scope { return new Scope(this); }
}

/** What a free (non-local) name resolves to. */
type Resolution =
  | { kind: "local" }
  | { kind: "primitive"; members: ReadonlySet<string> | null }
  | { kind: "plain" }
  | { kind: "refused" };

/**
 * Host-global names a `^{}` body may NOT reference as a bare identifier even when the
 * file declares a binding of that name (S458 review round 3, HIGH-2). The emitted body
 * is a plain function in the client/module scope; a bare reference to a name like
 * `window` or `location` resolves to the BROWSER GLOBAL, and the compiler cannot
 * reliably rewrite it to the author's binding (the scope-aware function rename leaves a
 * member-access root alone — `window.eval(…)` — precisely so it does not rename a
 * compiler reference to a real host global). A cell named `location` reached `location`
 * the global; a `function window()` reached `window` the global. So, inside a `^{}`
 * body, a name that is a host global is admitted ONLY as a body-LOCAL (a real lexical
 * binding the emitted function itself declares, which shadows the global) or, for a
 * cell, as `@name` / `meta.get`. A captured / file-scope binding of that name is refused.
 */
export const META_HOST_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "window", "document", "globalThis", "self", "top", "parent", "frames", "opener",
  "location", "navigator", "history", "screen", "localStorage", "sessionStorage",
  "indexedDB", "caches", "crypto", "performance", "console", "fetch", "XMLHttpRequest",
  "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts", "postMessage",
  "eval", "Function", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "setImmediate", "queueMicrotask", "requestAnimationFrame", "requestIdleCallback",
  "process", "Bun", "Deno", "require", "module", "exports", "__dirname", "__filename",
  "global", "alert", "confirm", "prompt", "open",
]);

/** Context shared by both readers. */
export interface MetaAllowListContext {
  /** Names bound in the enclosing scope (§22.3) — captured / injected bindings. */
  captured: ReadonlySet<string>;
  /** Declared type names (reflect(T) / T.Variant references). */
  typeNames: ReadonlySet<string>;
  /** Reactive cell names (§22.5.2) — reachable as `@name` / `meta.get`, never bare. */
  cells?: ReadonlySet<string>;
}

function resolve(name: string, scope: Scope, ctx: MetaAllowListContext): Resolution {
  if (scope.has(name)) return { kind: "local" };               // (b) a real body-local shadows a global
  if (name.startsWith("@")) return { kind: "local" };          // (a) @cell read
  // (HIGH-2) A host-global name reaches the global in the emitted body — a captured or
  // file-scope binding of that name cannot be told apart from it. Refused (a body-local
  // of that name was already admitted above; `@name` too).
  if (META_HOST_GLOBAL_NAMES.has(name)) return { kind: "refused" };
  // (§22.5.2) A reactive cell is a store key, not a JS binding — bare it resolves to a
  // free global, not the cell. Admitted only as `@name` (above) or via `meta.get`.
  if (ctx.cells && ctx.cells.has(name)) return { kind: "refused" };
  if (ctx.captured.has(name)) return { kind: "local" };        // (c)
  // (a) A declared TYPE name is NOT a value here (S458 review F1). Neither the
  // compile-time realm nor the client bundle reliably binds a value under a type's
  // name (the realm binds none; the client emits a `const` only for some enums), so a
  // type name in value position fell through to the host global of the same name:
  // `type Function:enum = {A}` + `Function("…")()` ran. A type name is admitted only
  // as the argument of `reflect(T)` (quoted to a string before evaluation — see the
  // call case in each reader); in any other position it is refused like any free name.
  if (name === "not") return { kind: "plain" };                // (a) §42 absence
  if (PRIMITIVE_MEMBERS.has(name)) return { kind: "primitive", members: PRIMITIVE_MEMBERS.get(name) ?? null }; // (d)
  return { kind: "refused" };
}

// ---------------------------------------------------------------------------
// Reader 1 — the scrml AST of a `^{}` body
// ---------------------------------------------------------------------------

type AnyNode = Record<string, any>;

/**
 * Check a `^{}` body (its scrml statement list) against the closed allow-list.
 * Returns every violation found (deduplicated by name).
 */
export function checkMetaBodyNodes(
  body: unknown[],
  ctx: MetaAllowListContext,
  fallbackSpan?: Span,
): MetaAllowListViolation[] {
  const out: MetaAllowListViolation[] = [];
  const seen = new Set<string>();
  const report = (name: string, message: string, span?: Span) => {
    const key = `${name}\u0000${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, message, span: span ?? fallbackSpan });
  };
  const root = new Scope(null);
  walkStmtList(body, root, ctx, report, fallbackSpan);
  return out;
}

type Report = (name: string, message: string, span?: Span) => void;

/** Binding names a scrml param string / pattern string introduces (`x`, `{a, b}`, `...r`). */
function bindingNamesFromPatternText(text: string): string[] {
  const names: string[] = [];
  try {
    const ast: any = acorn.parse(`(${text}) => 0`, { ecmaVersion: 2025, sourceType: "script" });
    const fn = ast.body?.[0]?.expression;
    for (const p of fn?.params ?? []) collectPatternNames(p, names);
  } catch {
    const m = /^\s*(?:\.\.\.)?([A-Za-z_$][A-Za-z0-9_$]*)/.exec(text);
    if (m) names.push(m[1]);
  }
  return names;
}

/** Binding names of a structured destructure pattern (`DestructurePattern`, A5). */
function patternBindNames(p: AnyNode | undefined, out: string[]): void {
  if (!p || typeof p !== "object") return;
  if (p.kind === "destructure-object") {
    for (const pr of p.properties ?? []) {
      if (pr?.kind === "name" && typeof pr.bindName === "string") out.push(pr.bindName);
      else if (pr?.kind === "nested") patternBindNames(pr.pattern, out);
    }
  } else if (p.kind === "destructure-array") {
    for (const el of p.elements ?? []) {
      if (el?.kind === "name" && typeof el.name === "string") out.push(el.name);
      else if (el?.kind === "nested") patternBindNames(el.pattern, out);
    }
  }
  if (typeof p.rest === "string" && p.rest) out.push(p.rest);
}

/**
 * Check a structured destructure pattern: a field name is a member READ of the
 * destructured value, so it is held to the member rules (`const { constructor: C } = x`
 * is `x.constructor`). Default values are walked as expressions.
 */
function checkPattern(p: AnyNode | undefined, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  if (!p || typeof p !== "object") return;
  const dflt = (d: AnyNode) => {
    if (d.defaultExpr) walkExpr(d.defaultExpr, scope, ctx, report, span);
    else if (typeof d.default === "string" && d.default.trim()) walkRawText(d.default, "expr", scope, ctx, report, span);
  };
  if (p.kind === "destructure-object") {
    for (const pr of p.properties ?? []) {
      if (!pr) continue;
      const field = String(pr.fieldName ?? "").replace(/^(["'])(.*)\1$/, "$2");
      if (META_REFUSED_MEMBERS.has(field)) report(field, refusedMemberMessage(field), span);
      else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$|^[0-9]+$/.test(field)) {
        report("[computed key]", constructMessage(COMPUTED_KEY_WHAT), span);
      }
      dflt(pr);
      if (pr.kind === "nested") checkPattern(pr.pattern, scope, ctx, report, span);
    }
  } else if (p.kind === "destructure-array") {
    for (const el of p.elements ?? []) {
      if (!el) continue;
      dflt(el);
      if (el.kind === "nested") checkPattern(el.pattern, scope, ctx, report, span);
    }
  }
}

function declaredNameOf(stmt: AnyNode): string[] {
  if (typeof stmt.name === "string" && stmt.name) return [stmt.name];
  if (stmt.name && typeof stmt.name === "object") {
    const out: string[] = [];
    patternBindNames(stmt.name, out);
    return out;
  }
  // Destructured declaration: the init carries `{ a, b } = expr`.
  const init = typeof stmt.init === "string" ? stmt.init : "";
  const eq = init.indexOf("=");
  if (eq > 0) {
    const pat = init.slice(0, eq).trim();
    if (pat.startsWith("{") || pat.startsWith("[")) return bindingNamesFromPatternText(pat);
  }
  return [];
}

function hoistStmtList(stmts: unknown[], scope: Scope): void {
  for (const s of stmts) {
    if (!s || typeof s !== "object") continue;
    const n = s as AnyNode;
    if (n.kind === "let-decl" || n.kind === "const-decl" || n.kind === "lin-decl") {
      for (const nm of declaredNameOf(n)) scope.names.add(nm);
    } else if (n.kind === "function-decl" && typeof n.name === "string" && n.name) {
      scope.names.add(n.name);
    }
  }
}

function walkStmtList(stmts: unknown, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  if (!Array.isArray(stmts)) return;
  hoistStmtList(stmts, scope);
  for (const s of stmts) {
    if (!s || typeof s !== "object") continue;
    walkStmt(s as AnyNode, scope, ctx, report, ((s as AnyNode).span as Span) ?? span);
  }
}

/** Walk a raw JS-ish text fragment the AST carries unparsed (escape hatches, fragments). */
function walkRawText(raw: string, mode: "expr" | "stmts", scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  let ast: any = null;
  try {
    ast = mode === "expr"
      ? acorn.parseExpressionAt(raw, 0, { ecmaVersion: 2025, sourceType: "script" })
      : acorn.parse(raw, { ecmaVersion: 2025, sourceType: "script", allowReturnOutsideFunction: true });
    if (mode === "expr" && raw.slice(ast.end).trim() !== "") ast = null;
  } catch { ast = null; }
  if (!ast) {
    // Unparseable — fail closed. Name the first identifier (outside string / template
    // text) that would be refused, if any; otherwise refuse the construct itself.
    const code = raw
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
      .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')
      .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''");
    const re = /(?<![.\w$@])([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (JS_RESERVED_WORDS.has(m[1])) continue;
      if (resolve(m[1], scope, ctx).kind === "refused") {
        report(m[1], freeIdentMessage(m[1]), span);
        return;
      }
    }
    const member = /(?:\.|\[\s*["'`])\s*(constructor|__proto__|prototype|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)\b/.exec(raw);
    if (member) { report(member[1], refusedMemberMessage(member[1]), span); return; }
    const kw = /(?<![.\w$])(this|import|super)\b/.exec(code);
    if (kw) { report(kw[1], constructMessage(`\`${kw[1]}\``), span); return; }
    // A nested `^{}` the pre-parser left in a raw fragment is E-META-009's to report
    // (compile-time nesting); meta-eval never executes a body that contains one.
    if (/\^\s*\{/.test(code)) return;
    report(raw.slice(0, 40), constructMessage(`the expression \`${raw.trim().slice(0, 60)}\` (not parseable as a scrml expression)`), span);
    return;
  }
  const es = new EsChecker(ctx, (name, message) => report(name, message, span));
  if (mode === "expr") es.expr(ast, scope);
  else es.body(ast.body, scope);
}

const JS_RESERVED_WORDS = new Set([
  "let", "const", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "break", "continue", "new", "delete", "typeof", "instanceof", "void", "in", "of",
  "true", "false", "null", "fn", "is", "some", "default",
]);

function walkStmt(n: AnyNode, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  const X = (e: unknown) => walkExpr(e, scope, ctx, report, span);
  switch (n.kind) {
    case "bare-expr":
    case "return-stmt": {
      if (n.exprNode) X(n.exprNode);
      else if (typeof n.expr === "string" && n.expr.trim()) walkRawText(n.expr, "expr", scope, ctx, report, span);
      if (n.fnExprNode) walkFunctionDecl(n.fnExprNode, scope, ctx, report, span);
      return;
    }
    case "let-decl":
    case "const-decl":
    case "lin-decl":
    case "state-decl": {
      if (n.name && typeof n.name === "object") checkPattern(n.name, scope, ctx, report, span);
      if (n.initExpr) X(n.initExpr);
      else if (n.matchExpr) X(n.matchExpr);
      else if (n.sqlNode) { /* `?{}` — SQL, not JS; E-META-007 governs it at runtime */ }
      else if (typeof n.init === "string" && n.init.trim()) {
        const init = n.init;
        const eq = init.indexOf("=");
        const pat = eq > 0 ? init.slice(0, eq).trim() : "";
        if (pat.startsWith("{") || pat.startsWith("[")) {
          walkRawText(`(${init})`, "expr", scope, ctx, report, span);
        } else {
          walkRawText(init, "expr", scope, ctx, report, span);
        }
      }
      return;
    }
    case "if-stmt": {
      if (n.condExpr) X(n.condExpr);
      else if (typeof n.condition === "string") walkRawText(n.condition, "expr", scope, ctx, report, span);
      walkStmtList(n.consequent ?? n.body, scope.child(), ctx, report, span);
      walkStmtList(n.alternate, scope.child(), ctx, report, span);
      return;
    }
    case "while-stmt": {
      if (n.condExpr) X(n.condExpr);
      else if (typeof n.condition === "string") walkRawText(n.condition, "expr", scope, ctx, report, span);
      walkStmtList(n.body, scope.child(), ctx, report, span);
      return;
    }
    case "for-stmt":
    case "for-loop": {
      if (n.iterExpr) X(n.iterExpr);
      else if (typeof n.iterable === "string" && n.iterable.trim()) walkRawText(n.iterable, "expr", scope, ctx, report, span);
      const inner = scope.child();
      if (typeof n.variable === "string" && n.variable) {
        for (const nm of bindingNamesFromPatternText(n.variable)) inner.names.add(nm);
      } else if (n.variable && typeof n.variable === "object") {
        const names: string[] = [];
        patternBindNames(n.variable, names);
        for (const nm of names) inner.names.add(nm);
        checkPattern(n.variable, scope, ctx, report, span);
      }
      if (typeof n.indexVariable === "string" && n.indexVariable) inner.names.add(n.indexVariable);
      for (const k of ["rawInit", "rawTest", "rawUpdate"]) {
        if (typeof n[k] === "string" && n[k].trim()) {
          if (k === "rawInit") walkRawText(n[k], "stmts", inner, ctx, report, span);
          else walkRawText(n[k], "expr", inner, ctx, report, span);
        }
      }
      if (typeof n.rawInit === "string") {
        const m = /^\s*(?:let|const|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(n.rawInit);
        if (m) inner.names.add(m[1]);
      }
      walkStmtList(n.body, inner, ctx, report, span);
      return;
    }
    case "function-decl": {
      walkFunctionDecl(n, scope, ctx, report, span);
      return;
    }
    case "match-stmt": {
      if (n.headerExpr) X(n.headerExpr);
      for (const arm of Array.isArray(n.body) ? n.body : []) {
        if (!arm || typeof arm !== "object") continue;
        walkMatchArm(arm as AnyNode, scope, ctx, report, span);
      }
      return;
    }
    case "match-arm-inline":
    case "match-arm-block":
      walkMatchArm(n, scope, ctx, report, span);
      return;
    case "html-fragment": {
      // A body the pre-parser kept as raw text. meta-eval serializes it verbatim into the
      // executed JS, so it is checked as JS here (fail closed when it does not parse).
      if (typeof n.content === "string" && n.content.trim()) walkRawText(n.content, "stmts", scope, ctx, report, span);
      return;
    }
    case "meta":
    case "Meta":
      // Nested `^{}` — sees the outer body's locals (E-META-009 governs compile-time nesting).
      walkStmtList(n.body, scope.child(), ctx, report, span);
      return;
    case "lift-expr":
    case "sql":
    case "comment":
    case "break-stmt":
    case "continue-stmt":
      // lift: E-META-006 is its diagnostic of record. sql: SQL text, not JS (E-META-007).
      return;
    default: {
      // A statement kind this reader does not know — fail closed.
      report(String(n.kind), constructMessage(`the statement form '${String(n.kind)}'`), span);
      return;
    }
  }
}

function walkFunctionDecl(fn: AnyNode, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  const inner = scope.child();
  if (typeof fn.name === "string" && fn.name) inner.names.add(fn.name);
  const params: string[] = [];
  for (const p of Array.isArray(fn.params) ? fn.params : []) {
    if (typeof p === "string") params.push(p);
    else if (p && typeof p === "object" && typeof (p as AnyNode).name === "string") params.push((p as AnyNode).name);
  }
  if (params.length > 0) {
    // Parse the parameter list as JS so default values are checked and patterns bound.
    const text = params.map((p) => p.replace(/^\s*lin\s+/, "").replace(/:\s*[^=,]+(?==|$)/, "")).join(", ");
    try {
      const ast: any = acorn.parse(`(function (${text}) {})`, { ecmaVersion: 2025, sourceType: "script" });
      const f = ast.body[0].expression;
      const es = new EsChecker(ctx, (name, message) => report(name, message, span));
      for (const p of f.params) es.bindPattern(p, inner, scope);
    } catch {
      for (const p of params) for (const nm of bindingNamesFromPatternText(p)) inner.names.add(nm);
    }
  }
  walkStmtList(fn.body, inner, ctx, report, span);
}

function walkMatchArm(arm: AnyNode, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  const inner = scope.child();
  // Names a pattern binds (`.Variant(a, b)`, `.Variant(x) =>`) are arm-local.
  const test = typeof arm.test === "string" ? arm.test : (typeof arm.pattern === "string" ? arm.pattern : "");
  const paren = /\(([^)]*)\)/.exec(test);
  if (paren) for (const id of paren[1].split(",")) {
    const m = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(id.trim());
    if (m) inner.names.add(m[1]);
  }
  if (arm.resultExpr) walkExpr(arm.resultExpr, inner, ctx, report, span);
  else if (typeof arm.result === "string" && arm.result.trim()) walkRawText(arm.result, "expr", inner, ctx, report, span);
  if (Array.isArray(arm.body)) walkStmtList(arm.body, inner, ctx, report, span);
}

/** The root identifier of a member/index chain, or null. */
function rootIdentOf(e: AnyNode): string | null {
  let cur: AnyNode | undefined = e;
  while (cur && (cur.kind === "member" || cur.kind === "index")) cur = cur.object;
  return cur && cur.kind === "ident" ? String(cur.name) : null;
}

function literalKeyOf(e: AnyNode): string | null {
  if (!e) return null;
  if (e.kind === "lit" && (e.litType === "string" || e.litType === "number")) return String(e.value);
  if (e.kind === "lit" && e.litType === "template" && typeof e.raw === "string" && !e.raw.includes("${")) {
    return e.raw.replace(/^`|`$/g, "");
  }
  return null;
}

function walkExpr(e0: unknown, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  if (!e0 || typeof e0 !== "object") return;
  const e = e0 as AnyNode;
  const X = (x: unknown) => walkExpr(x, scope, ctx, report, span);
  switch (e.kind) {
    case "ident": {
      const r = resolve(String(e.name), scope, ctx);
      if (r.kind === "refused") report(String(e.name), freeIdentMessage(String(e.name)), span);
      return;
    }
    case "lit": {
      if (e.litType === "template" && typeof e.raw === "string" && e.raw.includes("${")) {
        for (const seg of tokenizeTemplateInterpolations(e.raw)) {
          if (seg.kind !== "expr") continue;
          const text = seg.text.trim();
          if (!text) continue;
          let node: ExprNode | null = null;
          try { node = parseExprToNode(text, "", 0); } catch { node = null; }
          if (node) X(node);
          else walkRawText(text, "expr", scope, ctx, report, span);
        }
      }
      return;
    }
    case "sql-ref":
    case "input-state-ref":
      return;
    case "escape-hatch": {
      if (typeof e.raw === "string" && e.raw.trim()) walkRawText(e.raw, "expr", scope, ctx, report, span);
      return;
    }
    case "array":
      for (const el of e.elements ?? []) X(el);
      return;
    case "object":
      for (const p of e.props ?? []) {
        if (!p) continue;
        if (p.kind === "prop") {
          if (typeof p.key === "string") {
            if (p.key === "__proto__") report("__proto__", refusedMemberMessage("__proto__"), span);
          } else {
            const k = literalKeyOf(p.key);
            if (k === null) report("[computed key]", constructMessage("a computed object key that is not a literal"), span);
            else if (META_REFUSED_MEMBERS.has(k)) report(k, refusedMemberMessage(k), span);
          }
          X(p.value);
        } else if (p.kind === "shorthand") {
          X({ kind: "ident", name: p.name });
        } else if (p.kind === "spread") {
          X(p.argument);
        }
      }
      return;
    case "spread":
    case "unary":
      if (e.kind === "unary" && (e.op === "delete" || e.op === "++" || e.op === "--")) checkWriteTarget(e.argument, scope, ctx, report, span);
      X(e.argument);
      return;
    case "binary":
      X(e.left); X(e.right);
      return;
    case "assign":
      checkWriteTarget(e.target, scope, ctx, report, span);
      X(e.target); X(e.value);
      return;
    case "ternary":
      X(e.condition); X(e.consequent); X(e.alternate);
      return;
    case "member": {
      const prop = String(e.property);
      if (META_REFUSED_MEMBERS.has(prop)) { report(prop, refusedMemberMessage(prop), span); X(e.object); return; }
      if (e.object?.kind === "ident") {
        const r = resolve(String(e.object.name), scope, ctx);
        if (r.kind === "primitive") {
          const members = r.members;
          if (members && !members.has(prop)) {
            report(`${e.object.name}.${prop}`, constructMessage(`'${e.object.name}.${prop}' (not in the closed member list of '${e.object.name}')`), span);
          }
          return;
        }
      }
      X(e.object);
      return;
    }
    case "index": {
      const k = literalKeyOf(e.index);
      if (k === null) {
        report("[computed member]", constructMessage(COMPUTED_KEY_WHAT), span);
        X(e.index);
      } else if (META_REFUSED_MEMBERS.has(k)) {
        report(k, refusedMemberMessage(k), span);
      }
      if (e.object?.kind === "ident") {
        const r = resolve(String(e.object.name), scope, ctx);
        if (r.kind === "primitive") {
          report(`${e.object.name}[…]`, constructMessage(`a computed member access on '${e.object.name}'`), span);
          return;
        }
      }
      X(e.object);
      return;
    }
    case "call":
    case "new": {
      const callee = e.callee as AnyNode | undefined;
      if (callee?.kind === "ident") {
        const r = resolve(String(callee.name), scope, ctx);
        X(callee);
        // §22.4.2 rule 1 — `reflect(TypeName)`: a bare PascalCase argument is a TYPE NAME
        // (quoted to a string before evaluation), not a value read. An unknown one is
        // E-META-003's to report.
        if (r.kind === "primitive" && callee.name === "reflect" && e.kind === "call"
            && (e.args ?? []).length === 1 && e.args[0]?.kind === "ident"
            && /^[A-Z][A-Za-z0-9_$]*$/.test(String(e.args[0].name))
            && resolve(String(e.args[0].name), scope, ctx).kind === "refused") {
          return;
        }
      } else X(callee);
      for (const a of e.args ?? []) X(a);
      return;
    }
    case "lambda": {
      const inner = scope.child();
      for (const p of e.params ?? []) {
        // A destructured parameter reaches this tree as `__destructured__` (or an
        // empty name under a default) — its pattern is not represented, so its keys
        // cannot be checked. Fail closed.
        if (!p || typeof p.name !== "string" || p.name === "" || p.name === "__destructured__") {
          report("[destructured parameter]", constructMessage(
            "a destructured function parameter (destructure inside the body instead: " +
            "`item => { const { a, b } = item … }`)"), span);
          // The block is refused; its body's names are unbound here, so walking it
          // would only add misleading follow-on errors.
          return;
        }
        if (p?.defaultValue) X(p.defaultValue);
        if (typeof p?.name === "string") for (const nm of bindingNamesFromPatternText(p.name)) inner.names.add(nm);
      }
      const b = e.body;
      if (b?.kind === "expr") walkExpr(b.value, inner, ctx, report, span);
      else if (b?.kind === "block") walkStmtList(b.stmts, inner, ctx, report, span);
      return;
    }
    case "cast":
      X(e.expression);
      return;
    case "match-expr": {
      X(e.subject);
      for (const s of e.subjects ?? []) X(s);
      for (const arm of e.rawArms ?? []) {
        if (typeof arm !== "string") continue;
        // `<pattern> => <result>` — check the result text with the pattern's names bound.
        const arrow = arm.indexOf("=>");
        if (arrow < 0) continue;
        walkMatchArm({ test: arm.slice(0, arrow), result: arm.slice(arrow + 2) }, scope, ctx, report, span);
      }
      return;
    }
    case "reset-expr":
      X(e.target);
      return;
    case "map-lit":
      for (const en of e.entries ?? []) { X(en.key); X(en.value); }
      return;
    case "markup-value":
      // A markup VALUE (`const el = <div …/>`) lowers to a DOM-building expression whose
      // attribute expressions this reader does not walk — fail closed. (`lift <x/>` is a
      // `lift-expr` statement and E-META-006's to report.)
      report("[markup value]", constructMessage("a markup value (build markup with emit() / meta.emit())"), span);
      return;
    default:
      report(String(e.kind), constructMessage(`the expression form '${String(e.kind)}'`), span);
      return;
  }
}

function checkWriteTarget(t: AnyNode | undefined, scope: Scope, ctx: MetaAllowListContext, report: Report, span?: Span): void {
  if (!t || (t.kind !== "member" && t.kind !== "index")) return;
  const root = rootIdentOf(t);
  if (!root) return;
  const r = resolve(root, scope, ctx);
  if (r.kind === "primitive" || r.kind === "plain") {
    report(root, constructMessage(`writing to a member of '${root}'`), span);
  }
}

// ---------------------------------------------------------------------------
// Reader 2 — ESTree (raw JS text: escape hatches, fragments, and the EXACT text
// meta-eval executes)
// ---------------------------------------------------------------------------

type EsReport = (name: string, message: string) => void;

function collectPatternNames(p: any, out: string[]): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.push(p.name); return;
    case "ObjectPattern": for (const pr of p.properties) collectPatternNames(pr.type === "RestElement" ? pr.argument : pr.value, out); return;
    case "ArrayPattern": for (const el of p.elements) collectPatternNames(el, out); return;
    case "RestElement": collectPatternNames(p.argument, out); return;
    case "AssignmentPattern": collectPatternNames(p.left, out); return;
    default: return;
  }
}

class EsChecker {
  constructor(private ctx: MetaAllowListContext, private report: EsReport) {}

  private refuse(what: string): void { this.report(what, constructMessage(what)); }

  /** Hoist the declarations of a statement list into `scope` (let/const/function + var). */
  private hoist(stmts: any[], scope: Scope): void {
    for (const s of stmts) {
      if (!s) continue;
      if (s.type === "VariableDeclaration") for (const d of s.declarations) {
        const names: string[] = []; collectPatternNames(d.id, names); for (const n of names) scope.names.add(n);
      } else if (s.type === "FunctionDeclaration" && s.id) scope.names.add(s.id.name);
    }
    // `var` anywhere in this list's nested blocks (not nested functions) hoists here too.
    const visitVar = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return;
      if (n.type === "VariableDeclaration" && n.kind === "var") for (const d of n.declarations) {
        const names: string[] = []; collectPatternNames(d.id, names); for (const nm of names) scope.names.add(nm);
      }
      for (const k of Object.keys(n)) {
        if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visitVar); else if (v && typeof v === "object" && typeof v.type === "string") visitVar(v);
      }
    };
    for (const s of stmts) if (s && s.type !== "VariableDeclaration") visitVar(s);
  }

  body(stmts: any[], scope: Scope): void {
    this.hoist(stmts, scope);
    for (const s of stmts) this.stmt(s, scope);
  }

  /** Bind a parameter / declarator pattern into `inner`; defaults + computed keys checked in `outer`. */
  bindPattern(p: any, inner: Scope, outer: Scope): void {
    if (!p) return;
    switch (p.type) {
      case "Identifier": inner.names.add(p.name); return;
      case "AssignmentPattern": this.expr(p.right, outer); this.bindPattern(p.left, inner, outer); return;
      case "RestElement": this.bindPattern(p.argument, inner, outer); return;
      case "ArrayPattern": for (const el of p.elements) this.bindPattern(el, inner, outer); return;
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") { this.bindPattern(pr.argument, inner, outer); continue; }
          this.checkKey(pr.key, pr.computed, outer);
          this.bindPattern(pr.value, inner, outer);
        }
        return;
      default: this.refuse(`the binding pattern '${p.type}'`); return;
    }
  }

  /** A property key (member, object literal, destructuring): literal-only, never a refused name. */
  private checkKey(key: any, computed: boolean, scope: Scope): void {
    let name: string | null = null;
    if (!computed && key?.type === "Identifier") name = key.name;
    else if (key?.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) name = String(key.value);
    else if (computed && key?.type === "TemplateLiteral" && key.expressions.length === 0) name = key.quasis.map((q: any) => q.value.cooked).join("");
    if (name === null) {
      this.report("[computed key]", constructMessage(COMPUTED_KEY_WHAT));
      if (computed) this.expr(key, scope);
      return;
    }
    if (META_REFUSED_MEMBERS.has(name)) this.report(name, refusedMemberMessage(name));
  }

  private memberName(m: any): string | null {
    if (!m.computed && m.property?.type === "Identifier") return m.property.name;
    if (m.property?.type === "Literal") return String(m.property.value);
    return null;
  }

  stmt(s: any, scope: Scope): void {
    if (!s) return;
    switch (s.type) {
      case "ExpressionStatement": this.expr(s.expression, scope); return;
      case "VariableDeclaration":
        for (const d of s.declarations) {
          if (d.init) this.expr(d.init, scope);
          this.bindPattern(d.id, scope, scope);
        }
        return;
      case "FunctionDeclaration": this.fn(s, scope); return;
      case "ReturnStatement": if (s.argument) this.expr(s.argument, scope); return;
      case "IfStatement":
        this.expr(s.test, scope);
        this.stmt(s.consequent, scope.child());
        if (s.alternate) this.stmt(s.alternate, scope.child());
        return;
      case "BlockStatement": this.body(s.body, scope.child()); return;
      case "ForStatement": {
        const inner = scope.child();
        if (s.init) { if (s.init.type === "VariableDeclaration") this.stmt(s.init, inner); else this.expr(s.init, inner); }
        if (s.test) this.expr(s.test, inner);
        if (s.update) this.expr(s.update, inner);
        this.stmt(s.body, inner.child());
        return;
      }
      case "ForOfStatement":
      case "ForInStatement": {
        const inner = scope.child();
        this.expr(s.right, scope);
        if (s.left.type === "VariableDeclaration") for (const d of s.left.declarations) this.bindPattern(d.id, inner, scope);
        else this.writeTarget(s.left, scope);
        this.stmt(s.body, inner.child());
        return;
      }
      case "WhileStatement": this.expr(s.test, scope); this.stmt(s.body, scope.child()); return;
      case "DoWhileStatement": this.stmt(s.body, scope.child()); this.expr(s.test, scope); return;
      case "SwitchStatement": {
        this.expr(s.discriminant, scope);
        const inner = scope.child();
        this.hoist(s.cases.flatMap((c: any) => c.consequent), inner);
        for (const c of s.cases) { if (c.test) this.expr(c.test, inner); for (const st of c.consequent) this.stmt(st, inner); }
        return;
      }
      case "BreakStatement":
      case "ContinueStatement":
        if (s.label) this.refuse("a labelled jump");
        return;
      case "EmptyStatement": return;
      default: this.refuse(`the statement form '${s.type}'`); return;
    }
  }

  private fn(f: any, scope: Scope): void {
    if (f.async || f.generator) this.refuse(f.async ? "an async function" : "a generator function");
    const inner = scope.child();
    if (f.id && f.type === "FunctionExpression") inner.names.add(f.id.name);
    for (const p of f.params) this.bindPattern(p, inner, inner);
    if (f.body.type === "BlockStatement") this.body(f.body.body, inner);
    else this.expr(f.body, inner);
  }

  private writeTarget(t: any, scope: Scope): void {
    let cur = t;
    while (cur && (cur.type === "MemberExpression")) cur = cur.object;
    if (cur && cur.type === "Identifier" && cur !== t) {
      const r = resolve(cur.name, scope, this.ctx);
      if (r.kind === "primitive" || r.kind === "plain") this.refuse(`writing to a member of '${cur.name}'`);
    }
    if (t.type === "Identifier") {
      const r = resolve(t.name, scope, this.ctx);
      if (r.kind !== "local") this.report(t.name, freeIdentMessage(t.name));
      return;
    }
    if (t.type === "ObjectPattern" || t.type === "ArrayPattern") { this.bindPatternAsTarget(t, scope); return; }
    this.expr(t, scope);
  }

  private bindPatternAsTarget(p: any, scope: Scope): void {
    if (!p) return;
    switch (p.type) {
      case "Identifier": case "MemberExpression": this.writeTarget(p, scope); return;
      case "AssignmentPattern": this.expr(p.right, scope); this.bindPatternAsTarget(p.left, scope); return;
      case "RestElement": this.bindPatternAsTarget(p.argument, scope); return;
      case "ArrayPattern": for (const el of p.elements) this.bindPatternAsTarget(el, scope); return;
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") { this.bindPatternAsTarget(pr.argument, scope); continue; }
          this.checkKey(pr.key, pr.computed, scope);
          this.bindPatternAsTarget(pr.value, scope);
        }
        return;
      default: this.refuse(`the assignment target '${p.type}'`); return;
    }
  }

  expr(e: any, scope: Scope): void {
    if (!e) return;
    switch (e.type) {
      case "Identifier": {
        const r = resolve(e.name, scope, this.ctx);
        if (r.kind === "refused") this.report(e.name, freeIdentMessage(e.name));
        return;
      }
      case "Literal": return;
      case "TemplateLiteral": for (const x of e.expressions) this.expr(x, scope); return;
      case "ArrayExpression": for (const el of e.elements) this.expr(el, scope); return;
      case "ObjectExpression":
        for (const p of e.properties) {
          if (p.type === "SpreadElement") { this.expr(p.argument, scope); continue; }
          if (p.kind !== "init" || p.method) { this.refuse(p.kind !== "init" ? "an object-literal getter / setter" : "an object-literal method"); }
          if (!p.computed && !p.shorthand && ((p.key.type === "Identifier" && p.key.name === "__proto__") || (p.key.type === "Literal" && p.key.value === "__proto__"))) {
            this.report("__proto__", refusedMemberMessage("__proto__"));
          } else if (p.computed) this.checkKey(p.key, true, scope);
          if (p.method || p.kind !== "init") { if (p.value?.type === "FunctionExpression") this.fn(p.value, scope); }
          else this.expr(p.value, scope);
        }
        return;
      case "SpreadElement": this.expr(e.argument, scope); return;
      case "UnaryExpression":
        if (e.operator === "delete") this.writeTarget(e.argument, scope);
        else this.expr(e.argument, scope);
        return;
      case "UpdateExpression": this.writeTarget(e.argument, scope); return;
      case "BinaryExpression":
      case "LogicalExpression": this.expr(e.left, scope); this.expr(e.right, scope); return;
      case "AssignmentExpression":
        if (e.left.type === "ObjectPattern" || e.left.type === "ArrayPattern") this.bindPatternAsTarget(e.left, scope);
        else this.writeTarget(e.left, scope);
        this.expr(e.right, scope);
        return;
      case "ConditionalExpression": this.expr(e.test, scope); this.expr(e.consequent, scope); this.expr(e.alternate, scope); return;
      case "SequenceExpression": for (const x of e.expressions) this.expr(x, scope); return;
      case "ChainExpression": this.expr(e.expression, scope); return;
      case "ParenthesizedExpression": this.expr(e.expression, scope); return;
      case "MemberExpression": {
        if (e.object.type === "Super") { this.refuse("`super`"); return; }
        const name = this.memberName(e);
        if (name === null) {
          this.checkKey(e.property, true, scope);
        } else if (META_REFUSED_MEMBERS.has(name)) {
          this.report(name, refusedMemberMessage(name));
        }
        if (e.object.type === "Identifier") {
          const r = resolve(e.object.name, scope, this.ctx);
          if (r.kind === "primitive") {
            const members = r.members;
            if (members && (name === null || !members.has(name))) {
              this.refuse(`'${e.object.name}.${name ?? "[…]"}' (not in the closed member list of '${e.object.name}')`);
            }
            return;
          }
        }
        this.expr(e.object, scope);
        return;
      }
      case "CallExpression":
      case "NewExpression": {
        if (e.callee.type === "Super") { this.refuse("`super`"); return; }
        this.expr(e.callee, scope);
        for (const a of e.arguments) this.expr(a, scope);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression": this.fn(e, scope); return;
      case "ThisExpression": this.refuse("`this`"); return;
      case "ImportExpression": this.refuse("`import(…)`"); return;
      case "MetaProperty": this.refuse(`\`${e.meta?.name}.${e.property?.name}\``); return;
      case "TaggedTemplateExpression": this.refuse("a tagged template"); return;
      case "ClassExpression": this.refuse("a class"); return;
      case "AwaitExpression": this.refuse("`await`"); return;
      case "YieldExpression": this.refuse("`yield`"); return;
      default: this.refuse(`the expression form '${e.type}'`); return;
    }
  }
}

/**
 * Reader 2 entry for meta-eval: check the EXACT JavaScript text that will be executed.
 * `wrapped` must be `(function (emit, reflect) {…})` — the shape meta-eval builds; any
 * other top-level shape (a body that broke out of the wrapper) is itself a refusal.
 */
export function checkExecutedMetaJs(wrapped: string, ctx: MetaAllowListContext): MetaAllowListViolation[] {
  const out: MetaAllowListViolation[] = [];
  const seen = new Set<string>();
  const report: EsReport = (name, message) => {
    const key = `${name}\u0000${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, message });
  };
  let ast: any;
  try {
    ast = acorn.parse(wrapped, { ecmaVersion: 2025, sourceType: "script" });
  } catch (e) {
    report("[parse]", constructMessage(`a body that does not parse as JavaScript after serialization (${(e as Error).message})`));
    return out;
  }
  const fn = ast.body.length === 1 && ast.body[0].type === "ExpressionStatement" ? ast.body[0].expression : null;
  const ok = fn && fn.type === "FunctionExpression" && !fn.id && !fn.async && !fn.generator
    && fn.params.length === 2 && fn.params[0].type === "Identifier" && fn.params[0].name === "emit"
    && fn.params[1].type === "Identifier" && fn.params[1].name === "reflect";
  if (!ok) {
    report("[shape]", constructMessage("a body that escapes its evaluation wrapper"));
    return out;
  }
  // emit / reflect are the wrapper's parameters, but they ARE the primitives: resolve them
  // through the primitive table (closed member lists), not as ordinary locals.
  new EsChecker(ctx, report).body(fn.body.body, new Scope(null));
  return out;
}
