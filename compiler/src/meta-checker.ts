import { extractIdentifiersFromAST, forEachIdentInExprNode, exprNodeContainsCall, exprNodeContainsMemberAccess, emitStringFromTree } from "./expression-parser.ts";
import type { Span, FileAST, ASTNode, ExprNode, CallExpr, IdentExpr } from "./types/ast.ts";
// F8 / v0.6 — dual-mode meta-block kind test (accepts the live `"meta"`
// and the scrml-native `"Meta"` spelling — the M5-swap reconciliation).
import { isMetaKind } from "./types/ast.ts";

/**
 * Meta Checker — Phase separation and reflect() API for ^{} meta contexts.
 *
 * This module provides two capabilities:
 *
 *   1. **Phase separation check (E-META-001)**
 *      Detects when runtime-scoped variables are referenced inside ^{} meta
 *      contexts that are compile-time-only. Meta contexts that use compile-time
 *      APIs (reflect, bun.eval, emit) execute at compile time and
 *      cannot access runtime values. This check runs after the type system has
 *      built the scope chain, so we know which variables exist and where they
 *      were declared.
 *
 *      Runtime meta blocks — those that do NOT use compile-time APIs and DO
 *      reference runtime values — are classified as runtime meta and are NOT
 *      subject to E-META-001. Their bodies are emitted as JavaScript at runtime
 *      (SPEC §22.5).
 *
 *   2. **reflect() API**
 *      Provides a compile-time introspection function available inside ^{}
 *      meta blocks. `reflect(TypeName)` returns structural information about
 *      user-declared types (enums and structs).
 *
 * Integration point: runs after TS (Stage 6) and before DG (Stage 7).
 * It is called from the pipeline orchestrator (src/index.js).
 *
 * Input:
 *   {
 *     files: TypedFileAST[],       — from TS output
 *     typeRegistry?: Map<string, ResolvedType>,  — optional, built internally if not provided
 *   }
 *
 * Output:
 *   { files: TypedFileAST[], errors: MetaError[] }
 *
 * Error codes:
 *   E-META-001  Runtime variable referenced inside compile-time ^{} meta context;
 *               also fires when meta.runtime is false and a runtime ^{} block is present (§22.7)
 *   E-META-003  reflect() called on unknown type
 *   E-META-005  Phase separation: ^{} block mixes compile-time and runtime references (§22.8)
 *   E-META-006  lift() call inside ^{} block (§22.9)
 *   E-META-007  ?{} SQL context inside runtime ^{} block (§22.9)
 *   E-META-009  Nested ^{} inside a compile-time ^{} block (S23 / §22.11)
 *   E-META-010  Reference to the reserved `compiler.*` namespace (S48 / §22.4)
 *
 * Performance budget: <= 5 ms per file.
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Shape of a MetaError object. */
export interface MetaErrorShape {
  code: string;
  message: string;
  span: Span;
  severity: "error" | "warning";
}

export class MetaError implements MetaErrorShape {
  code: string;
  message: string;
  span: Span;
  severity: "error" | "warning";

  constructor(
    code: string,
    message: string,
    span: Span,
    severity: "error" | "warning" = "error",
  ) {
    this.code = code;
    this.message = message;
    this.span = span;
    this.severity = severity;
  }
}

// ---------------------------------------------------------------------------
// Scope annotation types (for 4-argument _scrml_meta_effect)
// ---------------------------------------------------------------------------

/**
 * An entry in the captured scope for a runtime ^{} meta block.
 * Used to generate the capturedBindings argument to _scrml_meta_effect.
 */
export interface ScopeVarEntry {
  name: string;
  kind: "reactive" | "let" | "const" | "lin" | "function";
}

/**
 * A serialized type entry for the runtime type registry.
 * Used to generate the typeRegistry argument to _scrml_meta_effect.
 */
export interface TypeRegistryEntry {
  name: string;
  kind: string;
  [key: string]: unknown;
}


// ---------------------------------------------------------------------------
// Compile-time builtins
//
// These identifiers are always available in ^{} meta contexts and should NOT
// trigger E-META-001. They represent compile-time APIs, not runtime values.
// ---------------------------------------------------------------------------

export const META_BUILTINS = new Set([
  // Bun/Node compile-time APIs
  "bun",
  "process",
  "Bun",
  "console",
  // JS globals
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Math",
  "JSON",
  "Date",
  "RegExp",
  "Error",
  "Map",
  "Set",
  "Promise",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "undefined",
  "null",
  "true",
  "false",
  "NaN",
  "Infinity",
  // scrml meta API
  "reflect",
  "emit",
  // S48: `compiler` is registered here so E-META-001/E-META-005 don't pile on
  // top of E-META-010 when a user references the reserved `compiler.*`
  // namespace. The diagnostic of record is E-META-010 ("reserved for future
  // use"); META_BUILTINS membership is purely to suppress the redundant
  // "runtime variable" classification.
  "compiler",
]);

// ---------------------------------------------------------------------------
// Compile-time-only API patterns
//
// If a meta block body contains any of these patterns, the block is classified
// as compile-time meta and E-META-001 applies. If NONE of these patterns are
// present, the block is classified as runtime meta and runtime variable
// references are allowed (SPEC §22.5).
//
// Patterns are matched against the raw expression strings in the block body.
// ---------------------------------------------------------------------------

/** Patterns that mark a meta block as compile-time-only.
 *
 * IMPORTANT: These patterns must NOT match runtime meta API calls.
 * - `reflect(...)` is compile-time, but `meta.types.reflect(...)` is runtime (§22.8).
 * - `emit(...)` is compile-time, but `meta.emit(...)` is runtime (§22.8).
 * We use negative lookbehind `(?<!\.)` to exclude method calls (preceded by `.`).
 */
export const COMPILE_TIME_API_PATTERNS: RegExp[] = [
  /(?<!\.\s{0,10})\breflect\s*\(/,          // reflect(TypeName) — NOT meta.types.reflect()
  /(?<!\.\s{0,10})\bemit(?:\.raw)?\s*\(/,    // emit(...) or emit.raw(...) — NOT meta.emit()
  /\bbun\s*\.\s*eval\s*\(/,    // bun.eval(...)
];

// ---------------------------------------------------------------------------
// Internal types for AST node duck typing
// ---------------------------------------------------------------------------

/** A scrml logic statement node (duck-typed).
 *
 * Phase 4d Step 8 strict (S40 follow-up): the legacy `expr?: string` field has
 * been removed from this local interface. BareExprNode in the canonical AST
 * (compiler/src/types/ast.ts) carries `exprNode?: ExprNode` only; this local
 * interface tracks that contract. The runtime `.expr` value still exists on
 * synthetic test nodes and is read via `(node as any).exprNode` only when an
 * ExprNode is present — string fallbacks have been removed from all 7 sites
 * in this module.
 */
interface LogicNode {
  kind: string;
  init?: string;
  name?: string;
  variable?: string;
  indexVariable?: string;
  body?: LogicNode[];
  children?: LogicNode[];
  consequent?: LogicNode[];
  alternate?: LogicNode[];
  span?: Span;
  params?: unknown[];
  [key: string]: unknown;
}

/** A resolved type from the type registry. */
interface ResolvedType {
  kind: string;
  name?: string;
  variants?: Array<string | { name: string }>;
  fields?: Map<string, ResolvedType> | Record<string, ResolvedType>;
  params?: Array<string | { name?: string; type?: string }>;
  returnType?: string;
  attributes?: Array<{ name: string; type?: string }>;
  props?: Array<{ name: string; type?: string; optional?: boolean; bindable?: boolean }>;
  [key: string]: unknown;
}

/** A FileAST with optional meta-checker extensions. */
interface MetaFileAST {
  filePath?: string;
  nodes?: LogicNode[];
  ast?: { nodes?: LogicNode[] };
  typeDecls?: Array<{
    name?: string;
    typeKind?: string;
    raw?: string;
  }>;
  nodeTypes?: Map<unknown, ResolvedType>;
  components?: Array<{
    name?: string;
    propsDecl?: unknown[];
  }>;
  scopeChain?: unknown;
  _metaReflectRegistry?: Map<string, ResolvedType>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Determine whether a meta block body contains compile-time-only API calls.
// ---------------------------------------------------------------------------

/**
 * Determine whether a meta block body contains compile-time-only API calls.
 *
 * Walks all expression strings in the body (bare-expr, let/const initializers)
 * and tests them against COMPILE_TIME_API_PATTERNS.
 */
/**
 * Check whether a reflect() call's first argument is a compile-time type name
 * (PascalCase literal or string literal), as opposed to a runtime variable
 * reference (camelCase, @var, _prefixed). Per §22.4.2, reflect(@var) and
 * reflect(variable) take the runtime path and should NOT classify the block
 * as compile-time.
 */
function reflectCallIsCompileTime(callNode: CallExpr): boolean {
  if (!callNode.args || callNode.args.length === 0) return true; // bare reflect() — treat as compile-time
  const firstArg = callNode.args[0] as ExprNode;
  if (!firstArg) return true;

  // String literal: reflect("User") — compile-time
  if (firstArg.kind === "lit") return true;

  // Identifier: check if it looks like a type name (PascalCase) vs variable (camelCase/@var)
  if (firstArg.kind === "ident") {
    const name = (firstArg as IdentExpr).name;
    return !isVariableIdent(name);
  }

  // Any other expression (property access, ternary, etc.) → runtime path
  return false;
}

/**
 * Check whether an ExprNode tree contains a compile-time reflect() call.
 * Returns true only if reflect() is called with a compile-time-style argument
 * (PascalCase type name or string literal). reflect(@var) returns false.
 */
function exprNodeContainsCompileTimeReflect(node: ExprNode | undefined): boolean {
  if (!node || typeof node !== "object") return false;

  // Check if THIS node is a compile-time reflect() call
  if (node.kind === "call") {
    const callNode = node as CallExpr;
    if (callNode.callee.kind === "ident" && (callNode.callee as IdentExpr).name === "reflect") {
      if (reflectCallIsCompileTime(callNode)) return true;
    }
  }

  // Recurse into all sub-expressions. Phase 4d Step 8 strict (S40 follow-up):
  // generic child-walk so we don't miss kinds like "assign" (no case in original),
  // and use correct field names (.argument not .operand, .condition not .test).
  // Mirrors exprNodeContainsEmitRawCall's defensive walking style.
  const n = node as any;
  for (const key of ["callee", "object", "argument", "left", "right",
                     "target", "value", "condition", "consequent", "alternate",
                     "subject", "expression", "index", "operand", "test"]) {
    if (n[key] && typeof n[key] === "object" && exprNodeContainsCompileTimeReflect(n[key])) return true;
  }
  for (const key of ["elements", "args", "parts", "props"]) {
    if (Array.isArray(n[key])) {
      for (const el of n[key]) {
        if (el && typeof el === "object" && exprNodeContainsCompileTimeReflect(el)) return true;
        if (el && (el.value || el.key)) {
          if (el.value && exprNodeContainsCompileTimeReflect(el.value)) return true;
          if (el.key && typeof el.key !== "string" && exprNodeContainsCompileTimeReflect(el.key)) return true;
        }
      }
    }
  }
  return false;
}

/** Regex to check if a bare reflect() call (not meta.types.reflect()) has a compile-time argument (PascalCase or string literal). */
const REFLECT_COMPILE_TIME_RE = /(?<!\.\s{0,10})\breflect\s*\(\s*(?:"[^"]*"|'[^']*'|[A-Z][A-Za-z0-9_$]*)\s*\)/;

/**
 * Walk an ExprNode tree and return true if it contains a call to `emit.raw(...)`
 * — a CallExpr whose callee is a MemberExpr with object=ident("emit") and
 * property="raw". Needed as a sibling to `exprNodeContainsCall(exprNode, "emit")`
 * (which only matches bare `emit(...)` where callee is an IdentExpr). Per
 * SPEC §22.4, `emit.raw(...)` is a compile-time API trigger and the classifier
 * must recognize it.
 *
 * The string-fallback regex `/\bemit(?:\.raw)?\s*\(/` already catches this
 * case, but the ExprNode path runs first and short-circuits — without this
 * helper, `^{ emit.raw("...") }` silently classifies as runtime meta and the
 * generated JS calls `emit.raw` as if it were a runtime global (crash).
 */
function exprNodeContainsEmitRawCall(node: ExprNode | undefined): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as any;
  if (n.kind === "call") {
    const callee = n.callee;
    if (callee &&
        callee.kind === "member" &&
        callee.object &&
        callee.object.kind === "ident" &&
        callee.object.name === "emit" &&
        callee.property === "raw") {
      return true;
    }
    if (exprNodeContainsEmitRawCall(callee)) return true;
    if (Array.isArray(n.args)) {
      for (const arg of n.args) {
        if (exprNodeContainsEmitRawCall(arg)) return true;
      }
    }
    return false;
  }
  // Walk common child fields generically; mirrors the shape used by sibling
  // helpers in expression-parser.ts but without per-kind type switches.
  for (const key of ["callee", "object", "argument", "left", "right", "target", "value",
                     "condition", "consequent", "alternate", "subject", "expression", "index"]) {
    if (n[key] && exprNodeContainsEmitRawCall(n[key])) return true;
  }
  for (const key of ["elements", "props", "args"]) {
    if (Array.isArray(n[key])) {
      for (const el of n[key]) {
        if (el && typeof el === "object" && exprNodeContainsEmitRawCall(el)) return true;
        // Object-property shape: { kind:"prop", key, value } — recurse into both.
        if (el && (el.value || el.key)) {
          if (el.value && exprNodeContainsEmitRawCall(el.value)) return true;
          if (typeof el.key !== "string" && exprNodeContainsEmitRawCall(el.key)) return true;
        }
      }
    }
  }
  return false;
}

export function bodyUsesCompileTimeApis(body: LogicNode[]): boolean {
  if (!Array.isArray(body)) return false;

  function testExprNode(exprNode: ExprNode | undefined): boolean {
    if (!exprNode) return false;
    return exprNodeContainsCompileTimeReflect(exprNode)
      || exprNodeContainsCall(exprNode, "emit")
      || exprNodeContainsEmitRawCall(exprNode)
      || exprNodeContainsMemberAccess(exprNode, ["bun", "eval"]);
  }

  function testExpr(expr: string | undefined): boolean {
    if (!expr || typeof expr !== "string") return false;
    // Check non-reflect patterns first
    if (COMPILE_TIME_API_PATTERNS.slice(1).some(pattern => pattern.test(expr))) return true;
    // For reflect, check that the argument is compile-time (PascalCase/string literal)
    if (REFLECT_COMPILE_TIME_RE.test(expr)) return true;
    return false;
  }

  function walk(nodes: LogicNode[]): boolean {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // Phase 4d Step 8 strict: bare-expr ExprNode-only — string fallback removed (S40 strict cleanup).
      if (node.kind === "bare-expr") {
        if ((node as any).exprNode && testExprNode((node as any).exprNode)) return true;
      }
      if (node.kind === "let-decl" || node.kind === "const-decl") {
        if ((node as any).initExpr && testExprNode((node as any).initExpr)) return true;
        else if (testExpr(node.init)) return true;
      }
      // html-fragment nodes may contain emit() calls (e.g. emit(`<div>...`))
      // when the template literal has HTML content that triggers fragment classification.
      if (node.kind === "html-fragment" && testExpr((node as any).content)) return true;

      // Walk children (but not nested meta — they are classified independently)
      if (node.kind !== "meta") {
        if (Array.isArray(node.body) && walk(node.body)) return true;
        if (Array.isArray(node.children) && walk(node.children)) return true;
        if (Array.isArray(node.consequent) && walk(node.consequent)) return true;
        if (Array.isArray(node.alternate) && walk(node.alternate)) return true;
      }
    }
    return false;
  }

  return walk(body);
}

// ---------------------------------------------------------------------------
// §22.9: lift() and ?{} SQL detection in meta blocks
// ---------------------------------------------------------------------------

/** Pattern that matches a `lift(` call. */
const LIFT_CALL_RE = /\blift\s*\(/;

/** Pattern that matches a `?{` SQL context opener. */
const SQL_CONTEXT_RE = /\?\s*\{/;

/**
 * Check whether any expression in a meta block body contains a lift() call.
 * Returns the first node that contains lift(), or null.
 */
/**
 * Check whether a meta body contains a nested ^{} meta block — either as a
 * structured meta node (rare, when the inner body was pre-parsed) or as raw
 * `^{` syntax inside html-fragment content (common, since meta bodies are
 * typically passed through as a single html-fragment at this stage).
 */
export function bodyContainsNestedMeta(body: LogicNode[]): boolean {
  if (!Array.isArray(body)) return false;

  function walk(nodes: LogicNode[]): boolean {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (isMetaKind(node.kind)) return true;
      if (node.kind === "html-fragment") {
        const content = (node as { content?: unknown }).content;
        if (typeof content === "string" && /\^\s*\{/.test(content)) return true;
      }
      const n = node as Record<string, unknown>;
      if (Array.isArray(n.body) && walk(n.body as LogicNode[])) return true;
      if (Array.isArray(n.children) && walk(n.children as LogicNode[])) return true;
      if (Array.isArray(n.consequent) && walk(n.consequent as LogicNode[])) return true;
      if (Array.isArray(n.alternate) && walk(n.alternate as LogicNode[])) return true;
    }
    return false;
  }

  return walk(body);
}

/**
 * Return true if any ExprNode in the body references the `compiler` namespace
 * via member access (e.g. `compiler.X`, `compiler.options.Y`). Used to fire
 * E-META-010 — the `compiler.*` namespace is reserved for future use and
 * MUST NOT be referenced in any ^{} block in this revision.
 *
 * Matches a MemberExpr whose object is an IdentExpr named "compiler", at any
 * depth in the expression tree. This catches `compiler.X`, `compiler.X.Y`,
 * `compiler.X(...)`, etc. (S48 — close `compiler.*` phantom per recon
 * docs/recon/compiler-dot-api-decision-2026-04-29.md.)
 */
export function bodyReferencesCompilerNamespace(body: LogicNode[]): boolean {
  if (!Array.isArray(body)) return false;

  function exprHasCompilerMember(node: any): boolean {
    if (!node || typeof node !== "object") return false;
    switch (node.kind) {
      case "member": {
        const obj = node.object;
        if (obj && obj.kind === "ident" && obj.name === "compiler") return true;
        return exprHasCompilerMember(node.object);
      }
      case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch": return false;
      case "array": return (node.elements || []).some((el: any) => exprHasCompilerMember(el));
      case "object": return (node.props || []).some((p: any) =>
        (p.kind === "prop" && ((typeof p.key !== "string" && exprHasCompilerMember(p.key)) || exprHasCompilerMember(p.value))) ||
        (p.kind === "spread" && exprHasCompilerMember(p.argument))
      );
      case "spread": return exprHasCompilerMember(node.argument);
      case "unary": return exprHasCompilerMember(node.argument);
      case "binary": return exprHasCompilerMember(node.left) || exprHasCompilerMember(node.right);
      case "assign": return exprHasCompilerMember(node.target) || exprHasCompilerMember(node.value);
      case "ternary": return exprHasCompilerMember(node.condition) || exprHasCompilerMember(node.consequent) || exprHasCompilerMember(node.alternate);
      case "index": return exprHasCompilerMember(node.object) || exprHasCompilerMember(node.index);
      case "call":
      case "new": {
        if (exprHasCompilerMember(node.callee)) return true;
        return (node.args || []).some((a: any) => exprHasCompilerMember(a));
      }
      case "cast": return exprHasCompilerMember(node.expression);
      case "match-expr": return exprHasCompilerMember(node.subject);
      case "reset-expr": return exprHasCompilerMember(node.target);
      case "lambda": return false;
      default: return false;
    }
  }

  function walk(nodes: LogicNode[]): boolean {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "bare-expr") {
        if ((node as any).exprNode && exprHasCompilerMember((node as any).exprNode)) return true;
        // String fallback (synthetic test fixtures or AST shapes without ExprNode).
        if ((node as any).expr && typeof (node as any).expr === "string" &&
            /\bcompiler\s*\./.test((node as any).expr)) return true;
      }
      if (node.kind === "let-decl" || node.kind === "const-decl") {
        if ((node as any).initExpr && exprHasCompilerMember((node as any).initExpr)) return true;
        // String fallback for declarations whose init is a string only.
        if (typeof node.init === "string" && /\bcompiler\s*\./.test(node.init)) return true;
      }
      // Walk nested structures (but stop at nested meta — they have their own check)
      if (node.kind !== "meta") {
        const n = node as Record<string, unknown>;
        if (Array.isArray(n.body) && walk(n.body as LogicNode[])) return true;
        if (Array.isArray(n.children) && walk(n.children as LogicNode[])) return true;
        if (Array.isArray(n.consequent) && walk(n.consequent as LogicNode[])) return true;
        if (Array.isArray(n.alternate) && walk(n.alternate as LogicNode[])) return true;
      }
    }
    return false;
  }

  return walk(body);
}

export function bodyContainsLift(body: LogicNode[]): LogicNode | null {
  if (!Array.isArray(body)) return null;

  function walk(nodes: LogicNode[]): LogicNode | null {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // AST-level lift detection: the ast-builder produces "lift-expr" nodes
      // for both `lift <tag>` (markup lift) and `lift expr` (value lift).
      if (node.kind === "lift-expr") return node;

      // Phase 4d Step 8 strict: bare-expr ExprNode-only lift detection — string fallback removed (S40 strict cleanup).
      if (node.kind === "bare-expr") {
        if ((node as any).exprNode && exprNodeContainsCall((node as any).exprNode, "lift")) return node;
      }
      if (node.kind === "let-decl" || node.kind === "const-decl") {
        if ((node as any).initExpr && exprNodeContainsCall((node as any).initExpr, "lift")) return node;
        else if (node.init && LIFT_CALL_RE.test(node.init)) return node;
      }

      // Walk children (but not nested meta blocks)
      if (node.kind !== "meta") {
        const found =
          (Array.isArray(node.body) && walk(node.body)) ||
          (Array.isArray(node.children) && walk(node.children)) ||
          (Array.isArray(node.consequent) && walk(node.consequent)) ||
          (Array.isArray(node.alternate) && walk(node.alternate));
        if (found) return found;
      }
    }
    return null;
  }

  return walk(body);
}

/**
 * Check whether any expression in a meta block body contains a ?{} SQL context.
 * Returns the first node that contains ?{}, or null.
 */
export function bodyContainsSqlContext(body: LogicNode[]): LogicNode | null {
  if (!Array.isArray(body)) return null;

  function walk(nodes: LogicNode[]): LogicNode | null {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // Check for sql-context nodes in the AST
      if (node.kind === "sql" || node.kind === "sql-context") return node;

      // Phase 4d Step 8 strict: bare-expr ExprNode-only SQL detection — string fallback removed (S40 strict cleanup).
      if (node.kind === "bare-expr") {
        if ((node as any).exprNode) { const s = emitStringFromTree((node as any).exprNode); if (SQL_CONTEXT_RE.test(s)) return node; }
      }
      if (node.kind === "let-decl" || node.kind === "const-decl") {
        // v0.2.4 bug-1-anomaly-2: when the ast-builder attaches a structured
        // sqlNode (because the init was `?{...}.method()`), the SQL site no
        // longer appears in `initExpr`/`init`. Detect via the structured field
        // first to keep E-META-007 firing for `let x = ?{...}` inside runtime ^{}.
        if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") return node;
        if ((node as any).initExpr) { const s = emitStringFromTree((node as any).initExpr); if (SQL_CONTEXT_RE.test(s)) return node; }
        else if (node.init && SQL_CONTEXT_RE.test(node.init)) return node;
      }

      // Walk children (but not nested meta blocks)
      if (node.kind !== "meta") {
        const found =
          (Array.isArray(node.body) && walk(node.body)) ||
          (Array.isArray(node.children) && walk(node.children)) ||
          (Array.isArray(node.consequent) && walk(node.consequent)) ||
          (Array.isArray(node.alternate) && walk(node.alternate));
        if (found) return found;
      }
    }
    return null;
  }

  return walk(body);
}

/**
 * §22.8: Check whether a meta block body contains BOTH compile-time API patterns
 * AND runtime-only variable references. This constitutes a phase separation violation.
 */
/**
 * Collect all PascalCase identifiers that appear as direct arguments to
 * reflect() calls in the body. These are type name references (even if the
 * type doesn't exist), not runtime variables.
 */
function collectReflectArgIdents(body: LogicNode[]): Set<string> {
  const reflectArgs = new Set<string>();
  const reflectArgRe = /\breflect\s*\(\s*([A-Z][A-Za-z0-9_$]*)\s*\)/g;

  function walkForReflectArgs(nodes: LogicNode[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (isMetaKind(node.kind)) continue;

      const exprs: string[] = [];
      if (node.kind === "bare-expr") {
        // Phase 4d Step 8 strict: bare-expr ExprNode-only — string fallback removed (S40 strict cleanup).
        if ((node as any).exprNode) {
          const s = emitStringFromTree((node as any).exprNode);
          if (s) exprs.push(s);
        }
      }
      if (node.kind === "let-decl" || node.kind === "const-decl") {
        const s = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : node.init;
        if (s) exprs.push(s);
      }
      for (const expr of exprs) {
        let m: RegExpExecArray | null;
        const re = new RegExp(reflectArgRe.source, "g");
        while ((m = re.exec(expr)) !== null) {
          reflectArgs.add(m[1]);
        }
      }

      if (Array.isArray(node.body)) walkForReflectArgs(node.body);
      if (Array.isArray(node.children)) walkForReflectArgs(node.children);
      if (Array.isArray(node.consequent)) walkForReflectArgs(node.consequent);
      if (Array.isArray(node.alternate)) walkForReflectArgs(node.alternate);
    }
  }

  walkForReflectArgs(body);
  return reflectArgs;
}

export function bodyMixesPhases(
  body: LogicNode[],
  typeRegistry: Map<string, ResolvedType>,
  outerCompileTimeConsts: Set<string> = new Set(),
): boolean {
  if (!Array.isArray(body) || body.length === 0) return false;

  const hasCompileTimeApis = bodyUsesCompileTimeApis(body);
  if (!hasCompileTimeApis) return false;

  // Collect meta-local declarations
  const metaLocals = collectMetaLocals(body);

  // Collect identifiers used as reflect() arguments — they're type references,
  // not runtime variables, even if the type doesn't exist in the registry.
  const reflectArgIdents = collectReflectArgIdents(body);

  // Check if any expression references a runtime-only value
  function isRuntimeIdent(id: string): boolean {
    if (JS_KEYWORDS.has(id)) return false;
    if (META_BUILTINS.has(id)) return false;
    if (metaLocals.has(id)) return false;
    if (typeRegistry && typeRegistry.has(id)) return false;
    if (outerCompileTimeConsts.has(id)) return false;
    if (reflectArgIdents.has(id)) return false;
    return true;
  }

  function hasRuntimeRef(nodes: LogicNode[]): boolean {
    if (!Array.isArray(nodes)) return false;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (isMetaKind(node.kind)) continue;

      // S23 bug 2b: state-decl nodes inside a meta body represent `@var =
      // value` runtime writes (see BUG-META-6 comment in dependency-graph.ts).
      // sql nodes and similar runtime-only constructs are unambiguously runtime.
      // These were previously invisible to the phase-mixing check because the
      // switch below only handled bare-expr / let-decl / const-decl, so a
      // compile-time block with `@counter += 1` would fall through to
      // meta-eval and crash with "Invalid character: '@'" instead of firing
      // E-META-005 at checker time.
      if (node.kind === "state-decl" || node.kind === "sql") return true;

      // S23 bug 2b: meta bodies are sometimes pre-parsed as a single
      // html-fragment node with .content holding the raw source (including
      // pattern like `@counter += 1`). The structured identifier scan below
      // never sees the `@counter` ref because html-fragment has no
      // exprNode / expr / init. Scan the raw content for `@varName` — a
      // single reactive ref in a compile-time meta is a phase violation.
      if (node.kind === "html-fragment" && typeof (node as any).content === "string") {
        if (/@[A-Za-z_$][A-Za-z0-9_$]*/.test((node as any).content)) return true;
      }

      // Phase 4d: ExprNode-first identifier extraction, string fallback
      const exprNodeField = node.kind === "bare-expr" ? (node as any).exprNode
        : (node.kind === "let-decl" || node.kind === "const-decl") ? (node as any).initExpr
        : null;

      if (exprNodeField) {
        let foundRuntime = false;
        forEachIdentInExprNode(exprNodeField, (ident) => {
          if (isRuntimeIdent(ident.name)) foundRuntime = true;
        });
        if (foundRuntime) return true;
      } else {
        // Phase 4d Step 8 strict: bare-expr.expr fallback removed — only let/const-decl init string fallback remains
        // (init is a typed string field on let/const-decl AST types, kept for AST shapes that don't populate initExpr).
        const exprs: string[] = [];
        if ((node.kind === "let-decl" || node.kind === "const-decl") && node.init) exprs.push(node.init);

        for (const expr of exprs) {
          let ids: string[];
          try {
            ids = extractIdentifiersFromAST(expr);
          } catch {
            ids = extractIdentifiers(expr);
          }
          for (const id of ids) {
            if (isRuntimeIdent(id)) return true;
          }
        }
      }

      if (Array.isArray(node.body) && hasRuntimeRef(node.body)) return true;
      if (Array.isArray(node.children) && hasRuntimeRef(node.children)) return true;
      if (Array.isArray(node.consequent) && hasRuntimeRef(node.consequent)) return true;
      if (Array.isArray(node.alternate) && hasRuntimeRef(node.alternate)) return true;
    }
    return false;
  }

  return hasRuntimeRef(body);
}

// ---------------------------------------------------------------------------
// Phase separation check
// ---------------------------------------------------------------------------

/**
 * Collect all variable names declared inside a meta block's body.
 */
export function collectMetaLocals(body: LogicNode[]): Set<string> {
  const locals = new Set<string>();

  function walk(nodes: LogicNode[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // let/const/var declarations
      if (node.kind === "let-decl" || node.kind === "const-decl") {
        if (node.name) {
          locals.add(node.name);
        } else if (node.init || (node as any).initExpr) {
          // Destructured declaration: name is empty, init contains `{ a, b } = expr`
          const initStr = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : (node.init ?? "");
          for (const local of extractDestructuredLocals(initStr)) {
            locals.add(local);
          }
        }
      }

      // Function declarations inside meta
      if (node.kind === "function-decl") {
        if (node.name) locals.add(node.name);
        // Also collect parameter bindings (destructured, rest, default) so that
        // references to params inside the function body are not flagged as
        // runtime variable references (E-META-001 false positive).
        if (Array.isArray(node.params)) {
          for (const param of node.params) {
            if (typeof param === "string" && param) {
              extractParamBindings(param, locals);
            }
          }
        }
      }

      // For-loop iteration variables (for-loop is the HTML-template loop kind;
      // for-stmt is the logic-body loop kind, including JS-style for-of)
      if (node.kind === "for-loop" || node.kind === "for-stmt") {
        if (node.variable) locals.add(node.variable);
        if (node.indexVariable) locals.add(node.indexVariable);
      }

      // Walk children
      if (Array.isArray(node.body)) walk(node.body);
      if (Array.isArray(node.children)) walk(node.children);
      if (Array.isArray(node.consequent)) walk(node.consequent);
      if (Array.isArray(node.alternate)) walk(node.alternate);
      // Do NOT walk into nested ^{} blocks — they have their own scope
    }
  }

  walk(body);
  return locals;
}

/**
 * Extract binding names from a function/arrow parameter list string.
 *
 * Distinguishes binding positions from default-value expressions:
 *   - `x` → binding
 *   - `x = defaultVal` → `x` is binding, `defaultVal` is NOT
 *   - `...rest` → `rest` is binding
 *   - `{ a, b }` → `a`, `b` are bindings
 *   - `[x, y]` → `x`, `y` are bindings
 *
 * Only identifiers in binding position are added to the `out` set.
 */
export function extractParamBindings(paramList: string, out: Set<string>): void {
  // Strip unbalanced leading parens — happens when the regex captures from an
  // outer paren context, e.g. `((acc, item) => ...)` yields `(acc, item`.
  let cleaned = paramList;
  let opens = 0;
  let closes = 0;
  for (const ch of cleaned) {
    if (ch === "(") opens++;
    else if (ch === ")") closes++;
  }
  // Strip excess leading '(' or trailing ')' that aren't balanced
  while (opens > closes && cleaned.startsWith("(")) {
    cleaned = cleaned.slice(1);
    opens--;
  }
  while (closes > opens && cleaned.endsWith(")")) {
    cleaned = cleaned.slice(0, -1);
    closes--;
  }

  // Split on commas at the top level (not inside braces/brackets).
  // Simple approach: iterate chars and split at depth-0 commas.
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of cleaned) {
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());

  for (const param of params) {
    if (!param) continue;

    // Rest parameter: `...ident` or `...{ a }` or `...[a]`
    const restMatch = param.match(/^\.\.\.(.+)$/s);
    const binding = restMatch ? restMatch[1].trim() : param;

    // Strip default value — take only the part before top-level `=`
    // (not `==` or `===`). Find first `=` at depth 0 not followed by `=`.
    let bindingPart = binding;
    let d = 0;
    for (let i = 0; i < binding.length; i++) {
      const c = binding[i];
      if (c === "{" || c === "[" || c === "(") d++;
      else if (c === "}" || c === "]" || c === ")") d--;
      if (c === "=" && d === 0 && binding[i + 1] !== "=") {
        bindingPart = binding.slice(0, i).trim();
        break;
      }
    }

    // Destructured object: `{ a, b, c: alias }`
    if (bindingPart.startsWith("{") && bindingPart.endsWith("}")) {
      const inner = bindingPart.slice(1, -1);
      // Recursively extract bindings from the inner pattern
      extractParamBindings(inner, out);
      continue;
    }

    // Destructured array: `[a, b]`
    if (bindingPart.startsWith("[") && bindingPart.endsWith("]")) {
      const inner = bindingPart.slice(1, -1);
      extractParamBindings(inner, out);
      continue;
    }

    // Object destructuring rename: `key: alias` — `alias` is the binding, not `key`
    const renameMatch = bindingPart.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*(.+)$/s);
    if (renameMatch) {
      // The value part could be a nested pattern or a simple ident
      const valuePart = renameMatch[1].trim();
      extractParamBindings(valuePart, out);
      continue;
    }

    // Simple identifier
    const identMatch = bindingPart.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    if (identMatch) {
      out.add(identMatch[0]);
    }
  }
}

/**
 * Extract binding names from a destructuring pattern in a let/const declaration.
 *
 * Given the `init` string from a declaration where `name` is empty (the AST
 * builder didn't capture a name because the declaration uses destructuring),
 * the init looks like `{ a, b } = expr` or `[x, y] = arr`. This function
 * extracts the bound variable names (`a`, `b` or `x`, `y`).
 */
export function extractDestructuredLocals(init: string): string[] {
  if (!init || typeof init !== "string") return [];

  // Find the top-level `=` that separates the pattern from the initializer.
  // Must be at depth 0 and not `==` or `===`.
  let depth = 0;
  let eqIdx = -1;
  for (let i = 0; i < init.length; i++) {
    const c = init[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    if (c === "=" && depth === 0 && init[i + 1] !== "=") {
      eqIdx = i;
      break;
    }
  }

  if (eqIdx < 0) return [];

  const pattern = init.slice(0, eqIdx).trim();
  if ((!pattern.startsWith("{") || !pattern.endsWith("}")) &&
      (!pattern.startsWith("[") || !pattern.endsWith("]"))) {
    return [];
  }

  const locals: string[] = [];
  const out = new Set<string>();
  extractParamBindings(pattern.slice(1, -1), out);
  for (const name of out) locals.push(name);
  return locals;
}

/**
 * Extract identifier references from a bare expression string.
 *
 * This is a conservative regex-based approach. It finds identifiers that
 * look like variable references (not property accesses after `.`, not
 * string contents, not numeric literals, not object literal keys, not
 * inline-declared names like callback parameters or for-of iterator vars).
 */
export function extractIdentifiers(expr: string): string[] {
  if (!expr || typeof expr !== "string") return [];

  // Step 1: Remove string literals and comments, then strip object literal keys.
  const cleaned = expr
    .replace(/`[^`]*`/g, "")           // template literals (simple)
    .replace(/"[^"]*"/g, "")           // double-quoted strings
    .replace(/'[^']*'/g, "")           // single-quoted strings
    .replace(/\/\/[^\n]*/g, "")        // line comments
    .replace(/\/\*[\s\S]*?\*\//g, "")  // block comments
    .replace(/(?<=[{,]\s*)[A-Za-z_$][A-Za-z0-9_$]*\s*(?=:)/g, "");

  // Step 2: Collect inline-declared names
  const inlineLocals = new Set<string>();

  // for-of / for-in iterator variables
  const forOfRe = /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+(?:of|in)\b/g;
  let m: RegExpExecArray | null;
  while ((m = forOfRe.exec(cleaned)) !== null) {
    inlineLocals.add(m[1]);
  }

  // Named or anonymous function parameters
  const fnParamRe = /\bfunction\s*(?:[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/g;
  while ((m = fnParamRe.exec(cleaned)) !== null) {
    extractParamBindings(m[1], inlineLocals);
  }

  // Arrow function — single unparenthesized parameter
  const arrowSingleRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
  while ((m = arrowSingleRe.exec(cleaned)) !== null) {
    inlineLocals.add(m[1]);
  }

  // Arrow function — parenthesized parameter list (depth-tracking to handle destructuring)
  // Instead of regex, scan for `(` ... `) =>` tracking brace/bracket/paren depth
  // so that destructuring like `({ title, priority }) => ...` is captured fully.
  // NOTE: Run on raw `expr`, not `cleaned`, because the object-key stripping regex
  // removes destructuring keys (e.g. `user` from `{ user: { name } }`), which breaks
  // extractParamBindings.
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] !== "(") continue;
    // Track depth to find the matching closing paren
    let depth = 1;
    let j = i + 1;
    while (j < expr.length && depth > 0) {
      const ch = expr[j];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      j++;
    }
    if (depth !== 0) continue;
    // j is now one past the matching `)`. Check if `=>` follows (with optional whitespace).
    const afterParen = expr.slice(j).match(/^\s*=>/);
    if (!afterParen) continue;
    // Extract the parameter text between the outer parens
    const paramList = expr.slice(i + 1, j - 1);
    extractParamBindings(paramList, inlineLocals);
  }

  // Step 3: Extract all identifiers not preceded by `.`, filtering out inline locals.
  const ids: string[] = [];
  const re = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = re.exec(cleaned)) !== null) {
    if (!inlineLocals.has(m[1])) {
      ids.push(m[1]);
    }
  }
  return ids;
}

// JS keywords that should never be flagged as runtime variable references
export const JS_KEYWORDS = new Set([
  "let", "const", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "throw", "try", "catch",
  "finally", "new", "delete", "typeof", "instanceof", "void", "in", "of",
  "class", "extends", "super", "import", "export", "default", "yield",
  "async", "await", "this", "arguments",
]);

/**
 * Check a single meta block for phase separation violations.
 */
export function checkMetaBlock(
  metaNode: LogicNode,
  scopeChain: unknown,
  typeRegistry: Map<string, ResolvedType>,
  filePath: string,
  errors: MetaError[],
  outerCompileTimeConsts: Set<string> = new Set(),
): void {
  const body = metaNode.body;
  if (!Array.isArray(body) || body.length === 0) return;

  const isCompileTime = bodyUsesCompileTimeApis(body);
  if (!isCompileTime) {
    return;
  }

  const metaLocalsRaw = collectMetaLocals(body);
  // Merge program-scope compile-time consts into the allowed set so that outer
  // `const` declarations (e.g. `const palette = [...]`) are not flagged E-META-001.
  // Also merge reflect() argument identifiers — they're type name references
  // (even if the type doesn't exist), not runtime variables.
  const reflectArgIdents = collectReflectArgIdents(body);
  const metaLocals = new Set([...metaLocalsRaw, ...outerCompileTimeConsts, ...reflectArgIdents]);

  function walkForRuntimeRefs(nodes: LogicNode[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      if (isMetaKind(node.kind)) {
        checkNestedMetaBlock(node, metaLocals, scopeChain, typeRegistry, filePath, errors);
        continue;
      }

      if (node.kind === "bare-expr" || node.kind === "let-decl" || node.kind === "const-decl") {
        checkNodeForRuntimeVars(node, metaLocals, typeRegistry, metaNode.span, filePath, errors);
      }

      if (Array.isArray(node.body)) walkForRuntimeRefs(node.body);
      if (Array.isArray(node.children)) walkForRuntimeRefs(node.children);
      if (Array.isArray(node.consequent)) walkForRuntimeRefs(node.consequent);
      if (Array.isArray(node.alternate)) walkForRuntimeRefs(node.alternate);
    }
  }

  walkForRuntimeRefs(body);
}

/**
 * Check a nested meta block. Inner ^{} can access outer ^{} locals.
 * Only runs for compile-time meta blocks.
 */
function checkNestedMetaBlock(
  metaNode: LogicNode,
  outerLocals: Set<string>,
  scopeChain: unknown,
  typeRegistry: Map<string, ResolvedType>,
  filePath: string,
  errors: MetaError[],
): void {
  const body = metaNode.body;
  if (!Array.isArray(body) || body.length === 0) return;

  const isCompileTime = bodyUsesCompileTimeApis(body);
  if (!isCompileTime) {
    return;
  }

  const innerLocals = collectMetaLocals(body);
  const combinedLocals = new Set([...outerLocals, ...innerLocals]);

  function walkForRuntimeRefs(nodes: LogicNode[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      if (isMetaKind(node.kind)) {
        checkNestedMetaBlock(node, combinedLocals, scopeChain, typeRegistry, filePath, errors);
        continue;
      }

      if (node.kind === "bare-expr" || node.kind === "let-decl" || node.kind === "const-decl") {
        checkNodeForRuntimeVars(node, combinedLocals, typeRegistry, metaNode.span, filePath, errors);
      }

      if (Array.isArray(node.body)) walkForRuntimeRefs(node.body);
      if (Array.isArray(node.children)) walkForRuntimeRefs(node.children);
      if (Array.isArray(node.consequent)) walkForRuntimeRefs(node.consequent);
      if (Array.isArray(node.alternate)) walkForRuntimeRefs(node.alternate);
    }
  }

  walkForRuntimeRefs(body);
}

/**
 * Check an expression string for references to runtime variables.
 */
/**
 * Check a node's expression fields for runtime variable references.
 * Prefers ExprNode walk; falls back to string-based extraction.
 */
function checkNodeForRuntimeVars(
  node: LogicNode,
  metaLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  parentSpan: Span | undefined,
  filePath: string,
  errors: MetaError[],
): void {
  const nodeAny = node as Record<string, unknown>;
  const span = (node.span || parentSpan) as Span | undefined;

  // Try ExprNode fields first.
  const exprNodeFields: unknown[] = [
    nodeAny.exprNode, nodeAny.initExpr, nodeAny.condExpr,
    nodeAny.valueExpr, nodeAny.iterExpr, nodeAny.headerExpr,
  ];
  let foundExprNode = false;
  for (const field of exprNodeFields) {
    if (!field || typeof field !== "object" || !(field as { kind?: string }).kind) continue;
    foundExprNode = true;
    forEachIdentInExprNode(field as ExprNode, (ident) => {
      checkSingleIdentForRuntime(ident.name, metaLocals, typeRegistry, span, filePath, errors);
    });
  }

  // Fall back to string fields if no ExprNode was found.
  // Phase 4d Step 8 strict: bare-expr.expr fallback removed — only let/const-decl init string fallback remains.
  if (!foundExprNode) {
    const expr = (node.kind === "let-decl" || node.kind === "const-decl") ? node.init : undefined;
    if (expr) {
      checkExprForRuntimeVars(expr, metaLocals, typeRegistry, span, filePath, errors);
    }
  }
}

/** Check a single identifier name against runtime-variable rules. */
function checkSingleIdentForRuntime(
  id: string,
  metaLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  span: Span | undefined,
  filePath: string,
  errors: MetaError[],
): void {
  if (JS_KEYWORDS.has(id)) return;
  if (META_BUILTINS.has(id)) return;
  if (metaLocals.has(id)) return;
  if (typeRegistry && typeRegistry.has(id)) return;
  if (id.startsWith("@")) return; // reactive vars are runtime, but handled separately

  const errorSpan = span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span;
  errors.push(new MetaError(
    "E-META-001",
    `E-META-001: Runtime variable '${id}' cannot be used inside meta context ^{}. ` +
    `Meta contexts execute at compile time and cannot access runtime values. ` +
    `Hint: Read all values at compile time, or move this logic outside ^{}.`,
    errorSpan,
  ));
}

export function checkExprForRuntimeVars(
  expr: string,
  metaLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  span: Span | undefined,
  filePath: string,
  errors: MetaError[],
): void {
  // Phase 1 restructure: use acorn-based identifier extraction instead of regex.
  // Falls back to regex extractIdentifiers only when acorn throws (hard parse failure).
  // Do NOT fallback when acorn returns [] — that means the expression has no identifiers
  // outside of string/template literals (e.g. emit("...")) which is correct and safe.
  let ids: string[];
  try {
    ids = extractIdentifiersFromAST(expr);
  } catch {
    ids = extractIdentifiers(expr);
  }

  for (const id of ids) {
    // Skip JS keywords
    if (JS_KEYWORDS.has(id)) continue;

    // Skip meta builtins (bun, process, reflect, etc.)
    if (META_BUILTINS.has(id)) continue;

    // Skip variables declared inside the meta block
    if (metaLocals.has(id)) continue;

    // Skip type names — types are compile-time constructs
    if (typeRegistry && typeRegistry.has(id)) continue;

    // This identifier is NOT declared inside the meta block, NOT a builtin,
    // and NOT a type name. It's likely a runtime variable reference.
    // Emit E-META-001.
    const errorSpan = span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span;
    errors.push(new MetaError(
      "E-META-001",
      `E-META-001: Runtime variable '${id}' cannot be used inside meta context ^{}. ` +
      `Meta contexts execute at compile time and cannot access runtime values. ` +
      `Hint: Read all values at compile time, or move this logic outside ^{}.`,
      errorSpan,
    ));
  }
}


// ---------------------------------------------------------------------------
// reflect() API
// ---------------------------------------------------------------------------

/**
 * Create a reflect() function bound to a specific type registry.
 */
export function createReflect(typeRegistry: Map<string, ResolvedType>): (typeName: string) => object {
  return function reflect(typeName: string): object {
    if (!typeName || typeof typeName !== "string") {
      throw new Error(`reflect() requires a type name string, got: ${typeof typeName}`);
    }

    const type = typeRegistry.get(typeName);
    if (!type) {
      throw new Error(`E-META-003: reflect() called on unknown type '${typeName}'. ` +
        `The type must be declared before the ^{} block that calls reflect().`);
    }

    switch (type.kind) {
      case "enum": {
        const variants = Array.isArray(type.variants)
          ? type.variants.map(v => typeof v === "string" ? v : (v as { name: string }).name)
          : [];
        return {
          kind: "enum",
          name: typeName,
          variants,
        };
      }

      case "struct": {
        const fields: Array<{ name: string; type: string }> = [];
        if (type.fields instanceof Map) {
          for (const [fieldName, fieldType] of type.fields) {
            fields.push({
              name: fieldName,
              type: typeToString(fieldType),
            });
          }
        } else if (type.fields && typeof type.fields === "object") {
          for (const [fieldName, fieldType] of Object.entries(type.fields as Record<string, ResolvedType>)) {
            fields.push({
              name: fieldName,
              type: typeToString(fieldType),
            });
          }
        }
        return {
          kind: "struct",
          name: typeName,
          fields,
        };
      }

      case "function": {
        const params = ((type.params as Array<string | { name?: string; type?: string }>) || []).map(p => {
          if (typeof p === "string") {
            const colonIdx = p.indexOf(":");
            if (colonIdx >= 0) {
              return { name: p.slice(0, colonIdx).trim(), type: p.slice(colonIdx + 1).trim() };
            }
            return { name: p.trim(), type: "unknown" };
          }
          return { name: (p as { name?: string }).name || "?", type: (p as { type?: string }).type || "unknown" };
        });
        return {
          kind: "function",
          name: typeName,
          params,
          returnType: type.returnType || "unknown",
        };
      }

      case "state": {
        const attributes = ((type.attributes as Array<{ name: string; type?: string }>) || []).map(a => ({
          name: a.name,
          type: a.type || "unknown",
        }));
        return {
          kind: "state",
          name: typeName,
          attributes,
        };
      }

      case "component": {
        const props = ((type.props as Array<{ name: string; type?: string; optional?: boolean; bindable?: boolean }>) || []).map(p => ({
          name: p.name,
          type: p.type || "unknown",
          optional: p.optional ?? false,
          bindable: p.bindable ?? false,
        }));
        return {
          kind: "component",
          name: typeName,
          props,
        };
      }

      default:
        return {
          kind: type.kind || "unknown",
          name: typeName,
        };
    }
  };
}

/**
 * Convert a ResolvedType to a human-readable type string.
 */
export function typeToString(type: ResolvedType | null | undefined): string {
  if (!type || typeof type !== "object") return "unknown";

  switch (type.kind) {
    case "primitive":
      return type.name || "unknown";
    case "struct":
      return type.name || "struct";
    case "enum":
      return type.name || "enum";
    case "array": {
      const element = (type as { element?: ResolvedType }).element;
      return `${typeToString(element)}[]`;
    }
    case "union": {
      const members = (type as { members?: ResolvedType[] }).members || [];
      return members.map(m => typeToString(m)).join(" | ");
    }
    case "asIs":
      return "asIs";
    case "unknown":
      return "unknown";
    default:
      return type.kind || "unknown";
  }
}


// ---------------------------------------------------------------------------
// AST walking helpers
// ---------------------------------------------------------------------------

/**
 * Walk an AST node tree and find all meta blocks.
 */
function findMetaBlocks(nodes: LogicNode[], visitor: (node: LogicNode) => void): void {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    if (isMetaKind(node.kind)) {
      visitor(node);
    }

    // Recurse into children
    if (Array.isArray(node.children)) findMetaBlocks(node.children, visitor);
    if (Array.isArray(node.body)) findMetaBlocks(node.body, visitor);
  }
}


// ---------------------------------------------------------------------------
// Reflect validation in meta blocks
// ---------------------------------------------------------------------------

/**
 * Check meta blocks for reflect() calls on unknown types.
 *
 * metaLocals — the set of variable names declared inside the meta block body.
 * When provided, reflect(ident) calls where ident is in metaLocals are skipped
 * during validation: the identifier is a meta-local variable that will resolve
 * to a string at eval time, so it is not a direct type name reference.
 */
export function checkReflectCalls(
  body: LogicNode[],
  typeRegistry: Map<string, ResolvedType>,
  filePath: string,
  metaSpan: Span | undefined,
  errors: MetaError[],
  metaLocals: Set<string> = new Set(),
): void {
  if (!Array.isArray(body)) return;

  // If no metaLocals were passed, collect them from this body (top-level call).
  const locals = metaLocals.size > 0 ? metaLocals : collectMetaLocals(body);

  for (const node of body) {
    if (!node || typeof node !== "object") continue;

    // Phase 4d Step 8 strict: bare-expr ExprNode-only reflect checking — string fallback removed (S40 strict cleanup).
    if (node.kind === "bare-expr") {
      if ((node as any).exprNode) {
        const exprStr = emitStringFromTree((node as any).exprNode);
        if (exprStr) checkExprForReflect(exprStr, typeRegistry, node.span || metaSpan, filePath, errors, locals);
      }
    }

    if (node.kind === "let-decl" || node.kind === "const-decl") {
      const initStr = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : node.init;
      if (initStr) checkExprForReflect(initStr, typeRegistry, node.span || metaSpan, filePath, errors, locals);
    }

    if (isMetaKind(node.kind)) {
      // Nested ^{} — new scope, do not pass outer locals.
      checkReflectCalls(node.body || [], typeRegistry, filePath, node.span || metaSpan, errors);
    }
    // Recurse into sub-arrays within the same scope, threading locals through.
    if (Array.isArray(node.body) && node.kind !== "meta") checkReflectCalls(node.body, typeRegistry, filePath, metaSpan, errors, locals);
    if (Array.isArray(node.children)) checkReflectCalls(node.children, typeRegistry, filePath, metaSpan, errors, locals);
    if (Array.isArray(node.consequent)) checkReflectCalls(node.consequent, typeRegistry, filePath, metaSpan, errors, locals);
    if (Array.isArray(node.alternate)) checkReflectCalls(node.alternate, typeRegistry, filePath, metaSpan, errors, locals);
  }
}

/**
 * Check a single expression string for reflect(TypeName) calls and validate
 * that the type exists.
 *
 * When an identifier is found in metaLocals, it is a meta-local variable
 * (declared with let/const inside the same ^{} block). Such identifiers are
 * NOT validated as type names — they will resolve to their string values at
 * eval time and the actual type lookup happens at compile-time execution.
 */
/**
 * Determine whether an identifier looks like a variable reference rather than
 * a PascalCase type name. Variables use camelCase (first char lowercase) or
 * start with `@` (reactive variables). These are resolved at runtime via
 * `meta.types.reflect(variable)` and should NOT trigger E-META-003.
 */
export function isVariableIdent(ident: string): boolean {
  if (!ident) return false;
  // @var reactive variable references
  if (ident.startsWith("@")) return true;
  // Underscore or dollar prefixed — these are variables, not type names
  if (ident.startsWith("_") || ident.startsWith("$")) return true;
  // camelCase: first character is a lowercase letter (a-z)
  const first = ident.charAt(0);
  return first >= "a" && first <= "z";
}

function checkExprForReflect(
  expr: string,
  typeRegistry: Map<string, ResolvedType>,
  span: Span | undefined,
  filePath: string,
  errors: MetaError[],
  metaLocals: Set<string> = new Set(),
): void {
  if (!expr || typeof expr !== "string") return;

  const re = /\breflect\s*\(\s*([A-Za-z_$@][A-Za-z0-9_$]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const ident = m[1];
    // Skip meta-local variables — they resolve at eval time, not type registry.
    if (metaLocals.has(ident)) continue;
    // Skip variable-style identifiers (camelCase, @var) — these are runtime
    // reflect() calls that resolve via meta.types.reflect(variable) at runtime.
    // §22.4/§22.5: hybrid resolution strategy 2.
    if (isVariableIdent(ident)) continue;
    if (!typeRegistry.has(ident)) {
      errors.push(new MetaError(
        "E-META-003",
        `E-META-003: reflect() called on unknown type '${ident}'. ` +
        `The type must be declared before the ^{} block that calls reflect().`,
        span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Options for the meta checker pass. */
export interface MetaCheckerOptions {
  /** When false, runtime ^{} blocks are forbidden (§22.7). Default: true. */
  metaRuntime?: boolean;
}

/** Input to the meta checker pass. */
export interface MetaCheckerInput {
  files: MetaFileAST[];
  options?: MetaCheckerOptions;
}

/** Output of the meta checker pass. */
export interface MetaCheckerOutput {
  files: MetaFileAST[];
  errors: MetaError[];
}

/**
 * Run the meta checker pass.
 */
export function runMetaChecker(input: MetaCheckerInput): MetaCheckerOutput {
  const { files = [], options } = input;
  const metaRuntime = options?.metaRuntime ?? true;

  const allErrors: MetaError[] = [];

  for (const fileAST of files) {
    const filePath = fileAST.filePath || "unknown";

    const typeRegistry = buildFileTypeRegistry(fileAST);

    const runtimeVars = collectRuntimeVars(fileAST);

    // Collect top-level `const` declarations as compile-time-safe outer references.
    // In scrml, `const` at program scope is assigned once and cannot be reactive
    // (reactive variables use `state-decl` AST kind). They are safe to reference
    // inside compile-time ^{} blocks — the compiler has their value at compile time.
    const outerCompileTimeConsts = new Set<string>(
      [...runtimeVars.entries()]
        .filter(([, kind]) => kind === "const")
        .map(([name]) => name),
    );

    const nodes: LogicNode[] = fileAST.ast?.nodes ?? fileAST.nodes ?? [];
    findMetaBlocks(nodes, (metaNode) => {
      const body = metaNode.body || [];
      const isCompileTime = bodyUsesCompileTimeApis(body);

      checkMetaBlock(metaNode, fileAST.scopeChain, typeRegistry, filePath, allErrors, outerCompileTimeConsts);

      checkReflectCalls(body, typeRegistry, filePath, metaNode.span, allErrors);

      // §22.7: Runtime meta guard — if meta.runtime is false, runtime blocks are forbidden.
      if (!isCompileTime && body.length > 0 && !metaRuntime) {
        allErrors.push(new MetaError(
          "E-META-001",
          `E-META-001: Runtime ^{} block is not allowed when meta.runtime is false. ` +
          `Either remove the runtime meta block or set meta.runtime = true.`,
          metaNode.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }

      // §22.8: Phase separation — block must not mix compile-time and runtime references.
      if (bodyMixesPhases(body, typeRegistry, outerCompileTimeConsts)) {
        allErrors.push(new MetaError(
          "E-META-005",
          `E-META-005: Phase separation violation — this ^{} block references both ` +
          `compile-time APIs (reflect, emit, bun.eval) and runtime-only values. ` +
          `Split into separate compile-time and runtime ^{} blocks.`,
          metaNode.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }

      // S23 bug 2d: nested ^{} inside a compile-time meta — the outer meta's
      // eval pass feeds the inner ^{...} to new Function() as a string arg,
      // which crashes the parser ("Unexpected string literal... Expected a
      // parameter pattern or a ')'"). Real nested-meta support is a larger
      // feature; for this revision, surface a clean E-META-009 at checker
      // time instead of letting it crash at meta-eval.
      if (isCompileTime && bodyContainsNestedMeta(body)) {
        allErrors.push(new MetaError(
          "E-META-009",
          `E-META-009: Nested ^{} inside a compile-time meta block is not supported ` +
          `in this revision. The outer meta-eval pass cannot recursively evaluate the ` +
          `inner ^{} before serialization. Either flatten the logic into a single ` +
          `compile-time block, or split into sibling ^{} blocks.`,
          metaNode.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }

      // S48: §22.4 — the `compiler.*` namespace is reserved for future use.
      // Any reference (e.g. `compiler.version`, `compiler.options.X`,
      // `compiler.registerMacro(...)`) is not implemented in this revision and
      // would error at meta-eval as a generic ReferenceError. Surface a clean
      // E-META-010 at checker time instead. See recon
      // docs/recon/compiler-dot-api-decision-2026-04-29.md.
      if (bodyReferencesCompilerNamespace(body)) {
        allErrors.push(new MetaError(
          "E-META-010",
          `E-META-010: The \`compiler.*\` namespace is reserved for future use ` +
          `and is not implemented in this revision. Remove the reference, or use ` +
          `a different compile-time mechanism (reflect, emit, bun.eval).`,
          metaNode.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }

      // §22.9: lift() is forbidden in any ^{} block.
      const liftNode = bodyContainsLift(body);
      if (liftNode) {
        allErrors.push(new MetaError(
          "E-META-006",
          `E-META-006: lift() cannot be used inside a ^{} meta block. ` +
          `lift is a markup-context operation; meta is not markup context.`,
          liftNode.span || metaNode.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }

      // §22.9: ?{} SQL context is forbidden in runtime ^{} blocks.
      if (!isCompileTime) {
        const sqlNode = bodyContainsSqlContext(body);
        if (sqlNode) {
          allErrors.push(new MetaError(
            "E-META-007",
            `E-META-007: ?{} SQL context cannot be used inside a runtime ^{} meta block. ` +
            `SQL contexts in meta are only valid in compile-time ^{} blocks.`,
            sqlNode.span || metaNode.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
          ));
        }
      }

      // §22.5: Annotate runtime meta nodes with scope and type registry for CG stage.
      // Runtime meta blocks are those that do NOT use compile-time API patterns.
      if (!isCompileTime) {
        metaNode.capturedScope = buildCapturedScope(runtimeVars);
        metaNode.typeRegistrySnapshot = serializeTypeRegistry(typeRegistry);
      }
    });

    // §22.4.2: E-META-008 — reflect() calls outside any ^{} meta block.
    checkReflectOutsideMeta(nodes, filePath, allErrors);

    fileAST._metaReflectRegistry = typeRegistry;
  }

  return {
    files,
    errors: allErrors,
  };
}

// ---------------------------------------------------------------------------
// §22.4.2: E-META-008 — reflect() outside ^{} meta blocks
// ---------------------------------------------------------------------------

/**
 * Walk the AST and fire E-META-008 for reflect() calls that appear outside
 * any ^{} meta block. Uses ExprNode-first detection to avoid false positives
 * from reflect() inside string literals, regex patterns, or function definitions.
 */
function checkReflectOutsideMeta(
  nodes: LogicNode[],
  filePath: string,
  errors: MetaError[],
): void {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    // Skip meta blocks — reflect inside ^{} is valid
    if (isMetaKind(node.kind)) continue;

    // Skip function declarations — defining a function named "reflect" is fine
    if (node.kind === "function-decl") {
      // Still recurse into the body to check for reflect() calls inside non-meta functions
      if (Array.isArray(node.body)) checkReflectOutsideMeta(node.body, filePath, errors);
      continue;
    }

    // Check expressions for reflect() calls via ExprNode (precise, no false positives)
    if (node.kind === "bare-expr" && (node as any).exprNode) {
      if (exprNodeContainsCall((node as any).exprNode, "reflect")) {
        errors.push(new MetaError(
          "E-META-008",
          `E-META-008: reflect() is only valid inside a ^{} meta block. ` +
          `Wrap the reflect() call in a ^{} block.`,
          node.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }
    }

    if ((node.kind === "let-decl" || node.kind === "const-decl") && (node as any).initExpr) {
      if (exprNodeContainsCall((node as any).initExpr, "reflect")) {
        errors.push(new MetaError(
          "E-META-008",
          `E-META-008: reflect() is only valid inside a ^{} meta block. ` +
          `Wrap the reflect() call in a ^{} block.`,
          node.span || { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
        ));
      }
    }

    // Recurse into non-meta children
    if (Array.isArray(node.body)) checkReflectOutsideMeta(node.body, filePath, errors);
    if (Array.isArray(node.children)) checkReflectOutsideMeta(node.children, filePath, errors);
    if (Array.isArray(node.consequent)) checkReflectOutsideMeta(node.consequent, filePath, errors);
    if (Array.isArray(node.alternate)) checkReflectOutsideMeta(node.alternate, filePath, errors);
  }
}


// ---------------------------------------------------------------------------
// Helpers for building the type registry from a FileAST
// ---------------------------------------------------------------------------

/**
 * Build a type registry from a FileAST's typeDecls.
 */
export function buildFileTypeRegistry(fileAST: MetaFileAST): Map<string, ResolvedType> {
  const registry = new Map<string, ResolvedType>();

  // Seed with built-in type names
  // S89 user ruling: scrml has no `null` type. The legacy `"null"` seed here
  // predated the canonical `not` sentinel — removed because scrml source can
  // no longer reference a type named `null` (E-SYNTAX-042 fires on `null` as
  // a token per §42).
  for (const name of ["number", "string", "boolean", "bool", "asIs"]) {
    registry.set(name, { kind: "primitive", name });
  }

  // Collect from typeDecls
  const typeDecls = fileAST.typeDecls ?? (fileAST.ast as { typeDecls?: MetaFileAST["typeDecls"] } | undefined)?.typeDecls ?? [];
  for (const decl of typeDecls) {
    if (!decl.name) continue;

    if (decl.typeKind === "enum") {
      const variants = parseEnumVariantsFromRaw(decl.raw || "");
      registry.set(decl.name, { kind: "enum", name: decl.name, variants });
    } else if (decl.typeKind === "struct") {
      const fields = parseStructFieldsFromRaw(decl.raw || "");
      registry.set(decl.name, { kind: "struct", name: decl.name, fields });
    } else {
      registry.set(decl.name, { kind: "unknown", name: decl.name });
    }
  }

  // Also look in nodeTypes if available (from TS pass)
  if (fileAST.nodeTypes) {
    for (const [, resolvedType] of fileAST.nodeTypes) {
      if (resolvedType && resolvedType.kind === "enum" && resolvedType.name) {
        if (!registry.has(resolvedType.name)) {
          registry.set(resolvedType.name, resolvedType);
        }
      }
      if (resolvedType && resolvedType.kind === "struct" && resolvedType.name) {
        if (!registry.has(resolvedType.name)) {
          registry.set(resolvedType.name, resolvedType);
        }
      }
    }
  }

  // Walk AST logic bodies to find top-level function-decl nodes.
  const astNodes: LogicNode[] = (fileAST.nodes ?? (fileAST.ast as { nodes?: LogicNode[] } | undefined)?.nodes) ?? [];
  for (const node of astNodes) {
    if (node && node.kind === "logic" && Array.isArray(node.body)) {
      for (const stmt of node.body) {
        if (stmt && stmt.kind === "function-decl" && stmt.name && !registry.has(stmt.name)) {
          registry.set(stmt.name, {
            kind: "function",
            name: stmt.name,
            params: (stmt.params as unknown[]) || [],
            returnType: "unknown",
          });
        }
      }
    }
  }

  // Walk for state-constructor-def nodes
  for (const node of astNodes) {
    const stateNode = node as LogicNode & { stateType?: string; typedAttrs?: Array<{ name?: string; type?: string }> };
    if (stateNode && stateNode.kind === "state-constructor-def" && stateNode.stateType && !registry.has(stateNode.stateType)) {
      const attributes = (stateNode.typedAttrs || []).map(a => ({
        name: a.name || "",
        type: a.type || "unknown",
      }));
      registry.set(stateNode.stateType, {
        kind: "state",
        name: stateNode.stateType,
        attributes,
      });
    }
  }

  // Collect component-def nodes
  const componentDefs = fileAST.components ?? (fileAST.ast as { components?: MetaFileAST["components"] } | undefined)?.components ?? [];
  for (const def of componentDefs) {
    if (!def || !def.name || registry.has(def.name)) continue;
    const props = Array.isArray(def.propsDecl) ? def.propsDecl : [];
    registry.set(def.name, {
      kind: "component",
      name: def.name,
      props: props as ResolvedType["props"],
    });
  }

  return registry;
}

/**
 * Parse enum variant names from a raw type body string.
 */
export function parseEnumVariantsFromRaw(raw: string): Array<{ name: string }> {
  const variants: Array<{ name: string }> = [];
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return variants;

  // S84 v0.2.4 #4.5: split on `|` AND `,` AND `\n` so the four declared
  // variant-list shapes parse uniformly (brace+comma, brace+newline,
  // brace+pipe, bare+pipe). Mirrors parseEnumBody in type-system.ts.
  const parts = body.split(/[|,\n]/);
  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    // Bar-form: strip a single leading `.` from each variant (`.Pending` → `Pending`).
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();

    const parenIdx = trimmed.indexOf("(");
    const name = parenIdx >= 0 ? trimmed.slice(0, parenIdx).trim() : trimmed;
    if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      variants.push({ name });
    }
  }

  return variants;
}

/**
 * Parse struct field names/types from a raw type body string.
 */
export function parseStructFieldsFromRaw(raw: string): Map<string, ResolvedType> {
  const fields = new Map<string, ResolvedType>();
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return fields;

  const parts = body.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;

    const fieldName = trimmed.slice(0, colonIdx).trim();
    const typeExpr = trimmed.slice(colonIdx + 1).trim();
    if (fieldName && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldName)) {
      fields.set(fieldName, { kind: "primitive", name: typeExpr });
    }
  }

  return fields;
}


// ---------------------------------------------------------------------------
// Runtime variable collection
// ---------------------------------------------------------------------------

/**
 * Collect all runtime-scoped variable names from a FileAST.
 */
export function collectRuntimeVars(fileAST: MetaFileAST): Map<string, "reactive" | "let" | "const" | "lin" | "function"> {
  const vars = new Map<string, "reactive" | "let" | "const" | "lin" | "function">();
  const nodes: LogicNode[] = fileAST.ast?.nodes ?? fileAST.nodes ?? [];

  function walk(nodeList: LogicNode[], inMeta: boolean): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;

      if (isMetaKind(node.kind)) continue;

      if (!inMeta) {
        if (node.kind === "let-decl") {
          if (node.name) vars.set(node.name, "let");
        }
        if (node.kind === "const-decl") {
          if (node.name) vars.set(node.name, "const");
        }
        // §22.5.3: lin variables are captured in meta.bindings (consumed once)
        if (node.kind === "lin-decl") {
          if (node.name) vars.set(node.name, "lin");
        }
        if (node.kind === "state-decl" && node.name) {
          vars.set(node.name, "reactive");
          vars.set(`@${node.name}`, "reactive");
        }
        if ((node.kind === "function-decl") && node.name) {
          vars.set(node.name, "function");
        }
        // Bug O fix (2026-04-26): for-loop iteration variables are loop-local,
        // not module-scope. Adding them to runtimeVars caused the ^{} env-
        // capture to emit names like `it: it` in the module-scope
        // Object.freeze({...}), producing "ReferenceError: it is not defined"
        // at module load when a for-of in markup coexisted with a meta-effect.
        // Same root-cause shape as the function-decl Bug 6 fix below: a scope-
        // introducing construct's locals must not appear in the module-scope
        // capture. Loop variables and any decls inside the loop body are
        // handled by the body-skip below.
      }

      // Bug 6 fix (2026-04-22): function-decl body is function-local scope, not
      // module scope. Descending into it caused the ^{} env-capture to emit
      // function-local names (host, nl, doc, etc.) in the module-scope
      // Object.freeze({...}), producing ReferenceError on mount. Skip the body.
      // `fn` shorthand uses the same `function-decl` kind so this covers both.
      if (node.kind === "function-decl") continue;

      // Bug O fix (2026-04-26): same rationale for for-loops. The loop body
      // introduces the iteration variable plus any let/const/lin declared
      // inside; none of those are module-scope. Skip the body to keep loop-
      // local names out of the meta-effect's frozen capture object.
      // `for-loop` is the markup-template iteration kind; `for-stmt` is the
      // logic-body iteration kind (including JS-style for-of/for-in/C-style).
      if (node.kind === "for-loop" || node.kind === "for-stmt") continue;

      if (Array.isArray(node.children)) walk(node.children, inMeta);
      if (Array.isArray(node.body)) walk(node.body, inMeta);
    }
  }

  walk(nodes, false);
  return vars;
}


// ---------------------------------------------------------------------------
// Scope annotation helpers (for 4-argument _scrml_meta_effect)
// ---------------------------------------------------------------------------

/**
 * Build a ScopeVarEntry[] from the runtime vars map.
 * Used to annotate runtime meta nodes with the scope context for codegen.
 *
 * @vars produce reactive entries; let/const/lin/function produce direct-reference entries.
 */
export function buildCapturedScope(vars: Map<string, "reactive" | "let" | "const" | "lin" | "function">): ScopeVarEntry[] {
  const entries: ScopeVarEntry[] = [];
  for (const [name, kind] of vars) {
    // Skip @name entries — the base name already captures the reactive binding.
    // We only want one entry per reactive var: the base name with kind "reactive".
    if (name.startsWith("@")) continue;
    entries.push({ name, kind });
  }
  return entries;
}

/**
 * Serialize the type registry into a TypeRegistryEntry[] for runtime use.
 * Only includes user-declared types (enums, structs, etc.) — not built-in primitives.
 *
 * The serialized entries are consumed by emitTypeRegistryLiteral in emit-logic.ts.
 */
export function serializeTypeRegistry(typeRegistry: Map<string, ResolvedType>): TypeRegistryEntry[] {
  // Built-in primitive type names — excluded from the runtime type registry.
  // S89 user ruling: scrml has no `null` type (see buildFileTypeRegistry note).
  const BUILTINS = new Set(["number", "string", "boolean", "bool", "asIs"]);
  const entries: TypeRegistryEntry[] = [];

  for (const [typeName, type] of typeRegistry) {
    if (BUILTINS.has(typeName)) continue;
    if (!type || typeof type !== "object") continue;

    switch (type.kind) {
      case "enum": {
        const variants = Array.isArray(type.variants)
          ? type.variants.map(v => ({ name: typeof v === "string" ? v : (v as { name: string }).name }))
          : [];
        entries.push({ name: typeName, kind: "enum", variants });
        break;
      }

      case "struct": {
        const fields: Array<{ name: string; type: string }> = [];
        if (type.fields instanceof Map) {
          for (const [fieldName, fieldType] of type.fields) {
            fields.push({ name: fieldName, type: typeToString(fieldType) });
          }
        } else if (type.fields && typeof type.fields === "object") {
          for (const [fieldName, fieldType] of Object.entries(type.fields as Record<string, ResolvedType>)) {
            fields.push({ name: fieldName, type: typeToString(fieldType) });
          }
        }
        entries.push({ name: typeName, kind: "struct", fields });
        break;
      }

      case "function": {
        // Skip function types in the runtime type registry (not useful for meta.types.reflect)
        break;
      }

      case "state": {
        const attributes = ((type.attributes as Array<{ name: string; type?: string }>) || []).map(a => ({
          name: a.name,
          type: a.type || "unknown",
        }));
        entries.push({ name: typeName, kind: "state", attributes });
        break;
      }

      case "component": {
        const props = ((type.props as Array<{ name: string; type?: string; optional?: boolean }>) || []).map(p => ({
          name: p.name,
          type: p.type || "unknown",
          optional: p.optional ?? false,
        }));
        entries.push({ name: typeName, kind: "component", props });
        break;
      }

      default:
        entries.push({ name: typeName, kind: type.kind || "unknown" });
        break;
    }
  }

  return entries;
}
