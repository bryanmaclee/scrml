/**
 * Meta Eval — Compile-time evaluation of ^{} meta blocks with emit().
 *
 * This pass runs between DG (Stage 7) and CG (Stage 8). It walks the AST
 * looking for `kind: "meta"` nodes that are compile-time eligible (use
 * compile-time APIs like emit() or reflect(), and do NOT reference runtime
 * @var reactive variables). Eligible blocks are evaluated using new Function(),
 * and any emit() calls produce scrml source that is re-parsed and spliced
 * into the AST in place of the meta node.
 *
 * Integration point: called from api.js between DG and CG.
 *
 * Input:
 *   {
 *     files: TypedFileAST[],
 *     depGraph?: object,
 *     routeMap?: object,
 *   }
 *
 * Output:
 *   { files: TypedFileAST[], errors: MetaEvalError[] }
 *
 * Error codes:
 *   E-META-EVAL-001  Compile-time meta evaluation failed (runtime error)
 *   E-META-EVAL-002  Re-parsing emitted code failed
 */

// M6.1 (S122) — native-parser migration of the meta-emit re-parse path.
// `splitBlocks` + `buildAST` were the live BS+TAB pair; `nativeParseFile` is
// the C1 assembler that returns the same `{ filePath, ast: FileAST, errors }`
// shape consumed below. The emit() output is scrml source (markup +
// structural + logic), so the markup-led `nativeParseFile` is the right
// entry — `parseMarkup` alone would skip the FileAST assembly + hoist + the
// `<state>` / engine / match recognizers downstream meta-emit nodes rely on.
import { nativeParseFile } from "../native-parser/parse-file.js";
import { bodyUsesCompileTimeApis, bodyContainsNestedMeta, createReflect, buildFileTypeRegistry, collectMetaLocals, extractParamBindings } from "./meta-checker.ts";
import { exprNodeContainsReactiveRef, emitStringFromTree } from "./expression-parser.ts";
import type { Span, FileAST, ASTNode, ExprNode, MetaNode, LogicStatement } from "./types/ast.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "./types/ast.ts";
import * as vm from "node:vm";
import { checkExecutedMetaJs } from "./meta-allow-list.ts";
import { isStandardMarkupElementName } from "./html-elements.js";
import { runReservedPrefixCheck } from "./validators/reserved-prefix.ts";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** A MetaEval error produced during compile-time meta block evaluation. */
export interface MetaEvalErrorShape {
  code: string;
  message: string;
  span: Span;
  severity: "error" | "warning";
}

export class MetaEvalError implements MetaEvalErrorShape {
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
// Type aliases for meta-eval internals
// ---------------------------------------------------------------------------

/** The type registry produced by buildFileTypeRegistry — an opaque record. */
type TypeRegistry = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Check if a meta block references runtime reactive variables (@var).
//
// A meta block body that contains any state-decl node, or any bare-expr /
// initializer string referencing @someVar, is NOT compile-time eligible.
// ---------------------------------------------------------------------------

function bodyReferencesReactiveVars(body: LogicStatement[]): boolean {
  if (!Array.isArray(body)) return false;

  function walk(nodes: LogicStatement[]): boolean {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // Reactive declarations: @name = expr
      if ((node as ASTNode).kind === "state-decl") return true;

      // Phase 4d: ExprNode-first reactive ref detection, string fallback
      if ((node as ASTNode).kind === "bare-expr") {
        const en = (node as any).exprNode as ExprNode | undefined;
        if (en ? exprNodeContainsReactiveRef(en) : (node as { expr?: string }).expr && /@[A-Za-z_$]/.test((node as { expr: string }).expr)) return true;
      }
      if ((node as ASTNode).kind === "let-decl" || (node as ASTNode).kind === "const-decl") {
        const en = (node as any).initExpr as ExprNode | undefined;
        if (en ? exprNodeContainsReactiveRef(en) : (node as { init?: string }).init && /@[A-Za-z_$]/.test((node as { init: string }).init)) return true;
      }

      // S23 bug 2b: meta bodies are sometimes pre-parsed as one html-fragment
      // with raw `.content` (including `@var` reactive refs). Scan the content.
      if ((node as ASTNode).kind === "html-fragment") {
        const content = (node as { content?: unknown }).content;
        if (typeof content === "string" && /@[A-Za-z_$]/.test(content)) return true;
      }

      // Walk children (but not nested meta — they are independent)
      if ((node as ASTNode).kind !== "meta") {
        const n = node as Record<string, unknown>;
        if (Array.isArray(n.body) && walk(n.body as LogicStatement[])) return true;
        if (Array.isArray(n.children) && walk(n.children as LogicStatement[])) return true;
        if (Array.isArray(n.consequent) && walk(n.consequent as LogicStatement[])) return true;
        if (Array.isArray(n.alternate) && walk(n.alternate as LogicStatement[])) return true;
      }
    }
    return false;
  }

  return walk(body);
}

// ---------------------------------------------------------------------------
// Serialize meta block body nodes back to JavaScript source.
//
// This is a best-effort serialization of the parsed logic body. It handles
// the common node kinds: bare-expr, let-decl, const-decl, for-loop, if-stmt,
// return-stmt. Complex constructs may not round-trip perfectly, but the
// common emit() patterns work.
// ---------------------------------------------------------------------------

// Rewrite reflect(TypeName) → reflect("TypeName") in any expression string,
// but ONLY for identifiers that are NOT meta-local variables.
//
// The AST parser stores `reflect(Color)` with `Color` as an unquoted
// identifier token. The runtime createReflect() function requires a string
// argument. This rewrite corrects the call before it reaches new Function().
//
// When the argument is a meta-local variable (declared with let/const inside
// the same ^{} block), we leave it as-is — the JS variable will resolve at
// eval time and pass its string value to createReflect() at execution.
//
// Examples:
//   reflect(Color)          → reflect("Color")   (bare type name — rewrite)
//   reflect(typeName)       → reflect(typeName)   (meta-local var — no rewrite)
//   reflect("Color")        → reflect("Color")   (already quoted — no rewrite)
const REFLECT_IDENT_RE = /\breflect\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;

// Extract all inline function parameter bindings from a bare-expr string.
// This handles cases like `items.forEach(function(typeName) { reflect(typeName) })`
// where `typeName` is a parameter binding inside the expression string — not
// visible to collectMetaLocals (which only walks AST nodes, not expr strings).
// Without this, rewriteReflectCalls would incorrectly rewrite reflect(typeName)
// to reflect("typeName"). (BUG-META-4)
function extractInlineParamBindings(expr: string): Set<string> {
  const inlineLocals = new Set<string>();
  if (!expr || typeof expr !== "string") return inlineLocals;

  // Named or anonymous function parameters: function(a, b) or function name(a, b)
  const fnParamRe = /\bfunction\s*(?:[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnParamRe.exec(expr)) !== null) {
    extractParamBindings(m[1], inlineLocals);
  }

  // Arrow function — single unparenthesized parameter: `ident =>`
  // e.g. `items.forEach(typeName => { ... })` — typeName must be captured.
  const arrowSingleRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
  while ((m = arrowSingleRe.exec(expr)) !== null) {
    inlineLocals.add(m[1]);
  }

  // Arrow function with parenthesized params — depth-track to handle destructuring
  // e.g. `items.forEach(({ a, b }) => { ... })` — a, b must be captured.
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] !== "(") continue;
    let depth = 1;
    let j = i + 1;
    while (j < expr.length && depth > 0) {
      const ch = expr[j];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      j++;
    }
    if (depth !== 0) continue;
    const afterParen = expr.slice(j).match(/^\s*=>/);
    if (!afterParen) continue;
    const paramList = expr.slice(i + 1, j - 1);
    extractParamBindings(paramList, inlineLocals);
  }

  return inlineLocals;
}

function rewriteReflectCalls(expr: string, locals: Set<string> = new Set()): string {
  if (!expr || typeof expr !== "string") return expr;

  // Build effective locals: the passed-in locals PLUS any inline function/arrow
  // parameter bindings declared within this expression string. This prevents
  // reflect(typeName) from being rewritten when typeName is a callback parameter
  // like in `items.forEach(function(typeName) { reflect(typeName) })`.
  // (BUG-META-4 fix)
  const inlineParams = extractInlineParamBindings(expr);
  const effectiveLocals = inlineParams.size > 0
    ? new Set([...locals, ...inlineParams])
    : locals;

  return expr.replace(REFLECT_IDENT_RE, (match, ident) => {
    // If this identifier is a meta-local variable (or inline callback param),
    // leave it as-is so it resolves to the variable's value at eval time.
    if (effectiveLocals.has(ident)) return match;
    // Otherwise it's a bare type name — quote it for createReflect().
    return `reflect("${ident}")`;
  });
}

/**
 * Restore backtick wrapping for emit() string arguments that contain ${...}
 * interpolations or newlines. The tokenizer strips backtick delimiters from
 * template literals, converting them to double-quoted strings. This function
 * detects emit("...") calls where the argument was originally a template
 * literal and rewraps with backticks so the JS evaluates correctly.
 */
function restoreEmitBackticks(code: string): string {
  // Match emit("...") or emit('...') where the argument contains ${ or newlines
  return code.replace(
    /emit\s*\(\s*"([\s\S]*?)"\s*\)/g,
    (full, inner) => {
      if (inner.includes("${") || inner.includes("\n")) {
        return "emit(`" + inner.replace(/\\"/g, '"') + "`)";
      }
      return full;
    }
  );
}

function serializeBody(nodes: LogicStatement[], locals: Set<string> = new Set()): string {
  if (!Array.isArray(nodes)) return "";
  const parts: string[] = [];

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    parts.push(serializeNode(node as ASTNode, locals));
  }

  return parts.join("\n");
}

function serializeNode(node: ASTNode, locals: Set<string> = new Set()): string {
  const n = node as Record<string, unknown>;
  switch (node.kind) {
    case "bare-expr": {
      // Phase 4d: ExprNode-first, string fallback
      let bareStr = n.exprNode ? emitStringFromTree(n.exprNode as ExprNode) : (n.expr as string);
      // Restore backtick wrapping for emit() arguments containing ${...} interpolations.
      // The tokenizer strips backtick delimiters from template literals, converting them
      // to double-quoted strings. When the string contains ${...}, it was originally a
      // template literal and needs backtick wrapping for correct JS evaluation.
      bareStr = restoreEmitBackticks(bareStr);
      return `${rewriteReflectCalls(bareStr, locals)};`;
    }

    case "let-decl": {
      const letStr = n.initExpr ? emitStringFromTree(n.initExpr as ExprNode) : (n.init as string | null);
      return letStr != null ? `let ${n.name} = ${rewriteReflectCalls(letStr, locals)};` : `let ${n.name};`;
    }

    case "const-decl": {
      const constStr = n.initExpr ? emitStringFromTree(n.initExpr as ExprNode) : (n.init as string | null);
      return constStr != null ? `const ${n.name} = ${rewriteReflectCalls(constStr, locals)};` : `const ${n.name};`;
    }

    case "for-loop": {
      // Phase 4d: ExprNode-first, string fallback for iterable
      const iter = n.iterExpr ? emitStringFromTree(n.iterExpr as ExprNode) : ((n.iterable || n.collection || "") as string);
      const body = serializeBody((n.body || []) as LogicStatement[], locals);
      if (n.indexVariable) {
        // for (let idx = 0; ...) style — use the raw expr if available
        return `for (${n.rawInit || `let ${n.variable} = 0`}; ${n.rawTest || ""}; ${n.rawUpdate || `${n.variable}++`}) {\n${body}\n}`;
      }
      // for-of style
      return `for (const ${n.variable} of ${iter}) {\n${body}\n}`;
    }

    // BUG-META-2 fix: the logic-context for-of loop is parsed as kind "for-stmt"
    // (not "for-loop" which is the markup-template loop). Add explicit handling so
    // that `for (const x of items)` inside ^{} meta blocks is serialized correctly.
    case "for-stmt": {
      // Phase 4d: ExprNode-first, string fallback for iterable
      const iter = n.iterExpr ? emitStringFromTree(n.iterExpr as ExprNode) : ((n.iterable || n.collection || n.iter || "") as string);
      const loopBody = serializeBody((n.body || []) as LogicStatement[], locals);
      if (n.variable && iter) {
        // for-of style: for (const variable of iterable)
        return `for (const ${n.variable} of ${iter}) {\n${loopBody}\n}`;
      }
      // Fallback for traditional C-style for loops with rawInit/rawTest/rawUpdate
      if (n.rawInit !== undefined || n.rawTest !== undefined || n.rawUpdate !== undefined) {
        return `for (${n.rawInit || ""}; ${n.rawTest || ""}; ${n.rawUpdate || ""}) {\n${loopBody}\n}`;
      }
      // Last resort: try ExprNode then expr field
      if (n.exprNode) return `${emitStringFromTree(n.exprNode as ExprNode)};`;
      if (n.expr) return `${n.expr};`;
      return "";
    }

    case "if-stmt": {
      // Phase 4d: ExprNode-first for condition
      const ifCond = n.condExpr ? emitStringFromTree(n.condExpr as ExprNode) : (n.condition || n.test || "true");
      let code = `if (${ifCond}) {\n${serializeBody((n.consequent || n.body || []) as LogicStatement[], locals)}\n}`;
      if (n.alternate && (n.alternate as LogicStatement[]).length > 0) {
        code += ` else {\n${serializeBody(n.alternate as LogicStatement[], locals)}\n}`;
      }
      return code;
    }

    case "return-stmt": {
      // GITI-038 — `return function name(){…}` returns a function EXPRESSION carried
      // on `fnExprNode` (a `function-decl`). Serialize it as a named function
      // expression (else it falls through to the bare `return;` below → the returned
      // closure is DROPPED at compile-time meta-evaluation).
      const rfn = (n as Record<string, unknown>).fnExprNode as
        | { name?: string; params?: unknown[]; body?: LogicStatement[] }
        | undefined;
      if (rfn && typeof rfn === "object") {
        const params = Array.isArray(rfn.params)
          ? rfn.params
              .map((p) => (typeof p === "string" ? p.split(/[:=]/)[0].trim() : (p as { name?: string })?.name))
              .filter((x): x is string => typeof x === "string" && x.length > 0)
              .join(", ")
          : "";
        const fname = typeof rfn.name === "string" ? rfn.name : "";
        return `return function ${fname}(${params}) {\n${serializeBody((rfn.body ?? []) as LogicStatement[], locals)}\n};`;
      }
      // Phase 4d: ExprNode-first, string fallback
      const retStr = n.exprNode ? emitStringFromTree(n.exprNode as ExprNode) : (n.value ?? n.expr ?? null) as string | null;
      return retStr ? `return ${retStr};` : "return;";
    }

    case "html-fragment": {
      // html-fragment nodes contain raw text that may include emit() calls
      // (e.g. emit(`<div>...`) where the template literal has HTML content).
      // The tokenizer converts backtick template literals to double-quoted strings.
      // Restore backtick wrapping so the JS evaluates correctly.
      let fragContent = (n.content as string) ?? "";
      fragContent = restoreEmitBackticks(fragContent);
      return fragContent ? `${rewriteReflectCalls(fragContent, locals)};` : "";
    }

    default:
      // For unrecognized nodes, try ExprNode then expr field or skip
      if (n.exprNode) return `${emitStringFromTree(n.exprNode as ExprNode)};`;
      if (n.expr) return `${n.expr};`;
      return "";
  }
}

// ---------------------------------------------------------------------------
// Re-parse emitted scrml source code into AST nodes.
// ---------------------------------------------------------------------------

function reparseEmitted(emittedCode: string, errors: MetaEvalError[], raw: boolean = false): ASTNode[] {
  try {
    // When raw=true (emit.raw()), skip escape-sequence normalization and pass
    // the string to the block splitter verbatim (SPEC §22.4.1).
    // When raw=false (emit()), normalize escape sequences so the block splitter
    // receives real newlines, quotes, tabs, and backslashes.
    let normalized: string;
    if (raw) {
      normalized = emittedCode;
    } else {
      // Normalize escape sequences from emit() output:
      // - literal \n → actual newline (tokenizer preserves \n in strings)
      // - literal \" → actual " (tokenizer preserves \" in strings)
      // - literal \\ → actual \ (tokenizer preserves \\ in strings)
      normalized = emittedCode
        .replaceAll("\\\\", "\x00BACKSLASH\x00")  // protect real backslash pairs
        .replaceAll("\\n", "\n")
        .replaceAll('\\"', '"')
        .replaceAll("\\t", "\t")
        .replaceAll("\x00BACKSLASH\x00", "\\");
    }
    // M6.1 (S122) — native-parser meta-emit re-parse. `nativeParseFile`
    // returns the same `{ filePath, ast: FileAST, errors }` shape the old
    // `splitBlocks + buildAST` pair did, so this is a drop-in for the
    // synthesis path. Diagnostics from the native parser carry a `span`
    // field; live diagnostics carried `tabSpan`. The defensive accessor
    // below tries both before falling back to a synthetic span.
    // Info-level `I-NATIVE-BLOCK-*` diagnostics from the assembler are
    // non-fatal (per §34.1) and partition into the same W-/I-skip branch
    // as the legacy W- codes.
    const tabOutput = nativeParseFile("__meta_emit__", normalized);

    if (tabOutput.errors && tabOutput.errors.length > 0) {
      for (const e of tabOutput.errors) {
        // Skip warnings (W- prefixed codes) and native info-level codes
        // (I- prefixed). These are non-fatal advisory messages from the
        // parser (e.g., W-PROGRAM-001 about missing <program> root, or the
        // native I-NATIVE-BLOCK-DROPPED / I-NATIVE-BLOCK-UNMAPPED codes).
        const code = (e as { code?: string }).code || "";
        if (code.startsWith("W-") || code.startsWith("I-")) continue;

        errors.push(new MetaEvalError(
          "E-META-EVAL-002",
          `Re-parsing emitted meta code failed: ${(e as { message?: string }).message || code}`,
          (e as { tabSpan?: Span }).tabSpan
            || (e as { span?: Span }).span
            || { file: "__meta_emit__", start: 0, end: 0, line: 1, col: 1 },
        ));
      }
    }

    return (tabOutput.ast?.nodes ?? []) as ASTNode[];
  } catch (e) {
    errors.push(new MetaEvalError(
      "E-META-EVAL-002",
      `Re-parsing emitted meta code failed: ${(e as Error).message}`,
      { file: "__meta_emit__", start: 0, end: 0, line: 1, col: 1 },
    ));
    return [];
  }
}

// Extract escape-sequence normalization so it can be applied per-entry
// before concatenation (used by evaluateMetaBlock — see bug #16/#17 fix).
function normalizeEmitCode(code: string): string {
  return code
    .replaceAll("\\\\", "\x00BACKSLASH\x00")  // protect real backslash pairs
    .replaceAll("\\n", "\n")
    .replaceAll('\\"', '"')
    .replaceAll("\\t", "\t")
    .replaceAll("\x00BACKSLASH\x00", "\\");
}

// ---------------------------------------------------------------------------
// Evaluate a single compile-time meta block.
// ---------------------------------------------------------------------------

function evaluateMetaBlock(
  metaNode: MetaNode,
  typeRegistry: TypeRegistry,
  errors: MetaEvalError[],
  precedingDecls?: string,
  filePath: string = "",
): ASTNode[] | null {
  const body = metaNode.body;
  if (!Array.isArray(body) || body.length === 0) return null;

  // Collect meta-local variables declared in this block. These identifiers
  // must NOT be rewritten by rewriteReflectCalls — they are JS variables
  // that will resolve to their string values at eval time.
  const metaLocals = collectMetaLocals(body as LogicStatement[]);

  // Serialize the body to a JS string, prepending any preceding declarations
  // that are in scope (compile-time constants from sibling nodes).
  const bodyCode = (precedingDecls ? precedingDecls + "\n" : "") + serializeBody(body, metaLocals);

  const site = metaNode.span || { file: "unknown", start: 0, end: 0, line: 1, col: 1 };

  // §22.12 (S457) — the text below is the EXACT text the evaluator runs. The closed
  // allow-list is checked on THIS text (meta-allow-list.ts reader 2), not only on the
  // scrml AST the checker saw: serialization rewrites the body (the `emit("…${x}…")` ->
  // template-literal restore, reflect(T) quoting) and prepends the captured
  // declarations, and a check of anything but the executed text is a second reader.
  const wrapped = `(function (emit, reflect) {\n"use strict";\n${bodyCode}\n})`;
  const violations = checkExecutedMetaJs(wrapped, {
    captured: new Set<string>(),
    typeNames: new Set(registryTypeNames(typeRegistry)),
  });
  if (violations.length > 0) {
    // Name the source of a violation the ^{} body itself does not contain: the
    // declarations the block captures from its enclosing scope run in the same text.
    let where = "";
    if (precedingDecls) {
      const bodyOnly = `(function (emit, reflect) {\n"use strict";\n${serializeBody(body, metaLocals)}\n})`;
      const own = new Set(checkExecutedMetaJs(bodyOnly, {
        captured: new Set<string>(),
        typeNames: new Set(registryTypeNames(typeRegistry)),
      }).map((v) => v.message));
      if (violations.some((v) => !own.has(v.message))) {
        where = " (found in a declaration this compile-time ^{} block captures from its enclosing scope — " +
          "captured declarations are evaluated with the block, so they are held to the same allow-list)";
      }
    }
    for (const v of violations) errors.push(new MetaEvalError("E-META-001", v.message + where, site));
    return null;
  }

  // Execute in a fresh realm (defence in depth — the allow-list above is the authority).
  const run = runInMetaRealm(wrapped, typeRegistry);
  if (!run.ok) {
    errors.push(new MetaEvalError(
      "E-META-EVAL-001",
      `Compile-time meta evaluation failed: ${run.message}`,
      site,
    ));
    return null;
  }
  const emitted = run.emitted;

  // If nothing was emitted, remove the meta node (replace with nothing)
  if (emitted.length === 0) return [];

  // Bug fix #16/#17: concatenate all emit() outputs into a single string
  // and reparse once. Per-entry reparsing caused unclosed-tag fragments to be
  // silently dropped by splitBlocks, losing attributes and structure.
  // Each entry is normalized per its semantics (raw vs. escape-normalized)
  // before concatenation. The combined string is passed to reparseEmitted
  // with raw=true since normalization has already been applied.
  const combined = emitted
    .map(e => e.raw ? e.code : normalizeEmitCode(e.code))
    .join("");
  const nodes = reparseEmitted(combined, errors, /* raw= */ true);
  if (!checkEmittedNodes(nodes, site, filePath, errors)) return null;
  return nodes;
}

// ---------------------------------------------------------------------------
// The evaluation realm (S457, defence in depth)
// ---------------------------------------------------------------------------

function registryTypeNames(typeRegistry: TypeRegistry): string[] {
  const r = typeRegistry as unknown;
  if (r instanceof Map) return [...(r as Map<string, unknown>).keys()];
  return Object.keys(typeRegistry ?? {});
}

/**
 * The realm-side prelude. `emit` / `emit.raw` / `reflect` are defined INSIDE the realm,
 * so no compiler-process object is reachable from the body (a host function passed in
 * would hand the body the host `Function` through `.constructor`). Data crosses the
 * boundary only as strings: the reflect table goes in as JSON, the emitted list comes
 * back as JSON, serialized with the realm's `JSON.stringify` captured before the body
 * runs.
 */
const META_REALM_PRELUDE = `(function (tableJson) {
  "use strict";
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const hasOwn = Object.prototype.hasOwnProperty;
  const table = parse(tableJson);
  const out = [];
  function emit(code) { out[out.length] = { code: typeof code === "string" ? code : String(code), raw: false }; }
  emit.raw = function (html) { out[out.length] = { code: typeof html === "string" ? html : String(html), raw: true }; };
  function reflect(typeName) {
    if (!typeName || typeof typeName !== "string") {
      throw new Error("reflect() requires a type name string, got: " + typeof typeName);
    }
    if (!hasOwn.call(table, typeName)) {
      throw new Error("E-META-003: reflect() called on unknown type '" + typeName + "'. " +
        "The type must be declared before the ^{} block that calls reflect().");
    }
    return parse(table[typeName]);
  }
  return function (body) { body(emit, reflect); return stringify(out); };
})`;

type RealmResult =
  | { ok: true; emitted: Array<{ code: string; raw: boolean }> }
  | { ok: false; message: string };

/**
 * Run the checked, wrapped body in a fresh `node:vm` context whose global object has no
 * `process` / `Bun` / `require` and whose builtins are the realm's own. This is NOT the
 * security boundary (the allow-list is) — it bounds the damage of a hole in it.
 */
function runInMetaRealm(wrapped: string, typeRegistry: TypeRegistry): RealmResult {
  const reflect = createReflect(typeRegistry as unknown as Map<string, never>);
  const table: Record<string, string> = {};
  for (const name of registryTypeNames(typeRegistry)) table[name] = JSON.stringify(reflect(name));
  let json: unknown;
  try {
    const context = vm.createContext(Object.create(null));
    const makeRunner = vm.runInContext(META_REALM_PRELUDE, context) as (t: string) => (b: unknown) => unknown;
    const runner = makeRunner(JSON.stringify(table));
    const body = vm.runInContext(wrapped, context);
    json = runner(body);
  } catch (e) {
    let message = "unknown error";
    try {
      message = e !== null && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : String(e);
    } catch { /* a hostile thrown value — keep the generic message */ }
    return { ok: false, message };
  }
  if (typeof json !== "string") return { ok: false, message: "the meta body did not produce an emit list" };
  const parsed: unknown = JSON.parse(json);
  const emitted: Array<{ code: string; raw: boolean }> = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === "object" && typeof (item as { code?: unknown }).code === "string") {
        emitted.push({ code: (item as { code: string }).code, raw: (item as { raw?: unknown }).raw === true });
      }
    }
  }
  return { ok: true, emitted };
}

// ---------------------------------------------------------------------------
// The emitted-output gate (§22.4.1, S457)
// ---------------------------------------------------------------------------

/** Attribute value kinds admitted in emit() output — all plain markup attribute forms. */
const EMIT_ATTR_VALUE_KINDS = new Set(["string-literal", "variable-ref", "call-ref", "expr", "absent"]);

/**
 * `emit()` output re-enters the pipeline AFTER the type system, route inference and
 * every front-end check have run (ME is Stage 6.5), so a construct those stages own
 * would reach code generation unchecked — measured S457: an emitted `<script>`
 * reached the HTML (E-SCRIPT-001 is a block-splitter check the re-parse does not
 * apply), an emitted `server function` was lowered as a CLIENT function, and an
 * emitted `_scrml_` declaration passed §47.1.1. impl#1 therefore admits in emit()
 * output only what the post-ME stages check exactly as they check source: HTML
 * elements, text and comments, with plain attribute values. Everything else is
 * refused (fail closed). The §5.2 executable-sink rule runs over the spliced nodes
 * post-ME (api.js Stage 6.55); §47.1.1 runs on them here.
 */
function checkEmittedNodes(nodes: ASTNode[], site: Span, filePath: string, errors: MetaEvalError[]): boolean {
  let ok = true;
  const reported = new Set<string>();
  const refuse = (code: string, message: string): void => {
    ok = false;
    if (reported.has(message)) return;
    reported.add(message);
    errors.push(new MetaEvalError(code, message, site));
  };
  const visit = (list: unknown[]): void => {
    for (const n0 of list) {
      if (!n0 || typeof n0 !== "object") continue;
      const n = n0 as Record<string, unknown>;
      if (n.kind === "text" || n.kind === "comment") continue;
      if (n.kind === "markup") {
        const tag = typeof n.tag === "string" ? n.tag : "";
        if (tag.toLowerCase() === "script") {
          refuse("E-SCRIPT-001", "E-SCRIPT-001: `<script>` element in ^{} emit() output. scrml does not admit " +
            "`<script>` at all (§4.17) — emit() output is held to the same rule as source.");
          continue;
        }
        if (tag.toLowerCase() === "style") {
          refuse("E-STYLE-001", "E-STYLE-001: `<style>` element in ^{} emit() output. scrml does not admit " +
            "`<style>` (CSS lives in `#{}`, §9) — emit() output is held to the same rule as source.");
          continue;
        }
        if (!isStandardMarkupElementName(tag)) {
          refuse("E-META-EVAL-002", `E-META-EVAL-002: emit() output contains \`<${tag}>\`. impl#1 admits only ` +
            `standard markup elements (HTML / SVG / MathML / custom elements), text and comments in emit() output ` +
            `(§22.4.1): a component or a scrml structural element would reach code generation without the stages ` +
            `that expand and check it in source.`);
          continue;
        }
        for (const a of Array.isArray(n.attrs) ? n.attrs as Array<Record<string, unknown>> : []) {
          const v = a?.value as { kind?: string } | undefined;
          if (v && typeof v === "object" && !EMIT_ATTR_VALUE_KINDS.has(String(v.kind))) {
            refuse("E-META-EVAL-002", `E-META-EVAL-002: emit() output gives \`<${tag}>\` attribute ` +
              `'${String(a.name)}' a '${String(v.kind)}' value, which impl#1 does not admit in emit() output (§22.4.1).`);
          }
        }
        if (Array.isArray(n.children)) visit(n.children);
        continue;
      }
      refuse("E-META-EVAL-002", `E-META-EVAL-002: emit() output contains a '${String(n.kind)}' construct. impl#1 ` +
        `admits only HTML elements, text and comments in emit() output (§22.4.1): logic, \`?{}\`, functions and ` +
        `declarations emitted after the type system and route inference have run would reach code generation unchecked.`);
    }
  };
  visit(nodes);
  // §47.1.1 — the reserved `_scrml_` prefix, on the emitted tree (the source-tree run at
  // Stage 3 never saw it).
  for (const d of runReservedPrefixCheck({ filePath, nodes } as unknown as FileAST)) {
    ok = false;
    errors.push(new MetaEvalError(
      String(d.code),
      `${String(d.message)} (in ^{} emit() output)`,
      site,
    ));
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Walk the AST and evaluate compile-time meta blocks.
//
// When a meta block is evaluated, the resulting nodes replace it in the
// parent's body or children array.
// ---------------------------------------------------------------------------

function processNodeList(
  nodes: ASTNode[],
  typeRegistry: TypeRegistry,
  errors: MetaEvalError[],
  outerScope?: string,
  outerDeclNodes?: ASTNode[],
  filePath: string = "",
): boolean {
  if (!Array.isArray(nodes)) return false;

  let changed = false;
  let i = 0;

  // Accumulate declarations from this level to propagate to nested scopes
  const scopeParts: string[] = outerScope ? [outerScope] : [];
  // Track the actual AST nodes corresponding to scope declarations so we can
  // mark them _compileTimeOnly when a descendant meta block consumes them.
  const declNodes: ASTNode[] = outerDeclNodes ? [...outerDeclNodes] : [];

  while (i < nodes.length) {
    const node = nodes[i];
    if (!node || typeof node !== "object") {
      i++;
      continue;
    }

    // Collect compile-time-safe declarations as we walk, for scope injection
    // Phase 4d: ExprNode-first — reconstruct init from initExpr, string fallback
    if (node.kind === "const-decl" || node.kind === "let-decl") {
      const pn = node as Record<string, unknown>;
      const initStr = pn.initExpr
        ? (() => { try { return emitStringFromTree(pn.initExpr as ExprNode); } catch { return null; } })()
        : (typeof pn.init === "string" ? pn.init : null);
      if (initStr && pn.name && !/@/.test(initStr)) {
        const kw = node.kind === "const-decl" ? "const" : "let";
        scopeParts.push(`${kw} ${pn.name} = ${initStr};`);
        declNodes.push(node);
      }
    }
    if (node.kind === "logic" && Array.isArray((node as Record<string, unknown>).body)) {
      for (const stmt of (node as Record<string, unknown>).body as ASTNode[]) {
        if (!stmt || typeof stmt !== "object") continue;
        if (stmt.kind === "const-decl" || stmt.kind === "let-decl") {
          const sn = stmt as Record<string, unknown>;
          const initStr = sn.initExpr
            ? (() => { try { return emitStringFromTree(sn.initExpr as ExprNode); } catch { return null; } })()
            : (typeof sn.init === "string" ? sn.init : null);
          if (initStr && sn.name && !/@/.test(initStr)) {
            const kw = stmt.kind === "const-decl" ? "const" : "let";
            scopeParts.push(`${kw} ${sn.name} = ${initStr};`);
            declNodes.push(stmt);
          }
        }
      }
    }

    if (isMetaKind(node.kind)) {
      const body = (node as MetaNode).body;

      // Check compile-time eligibility:
      // 1. Must use compile-time APIs (emit, reflect, etc.)
      // 2. Must NOT reference reactive @vars
      const isCompileTime = bodyUsesCompileTimeApis(body || []);
      const hasReactiveVars = bodyReferencesReactiveVars(body || []);
      // S23 bug 2d: if the body contains a nested ^{} block, meta-checker has
      // already emitted E-META-009. Skip eval to avoid a confusing follow-on
      // E-META-EVAL-001 "Unexpected string literal…" crash.
      const hasNestedMeta = bodyContainsNestedMeta((body || []) as any);

      // §22.12 (S457): a body the meta-checker refused (closed allow-list, E-META-001)
      // is NEVER executed — before S457 a refused body still ran here.
      const refused = (node as Record<string, unknown>)._metaAllowListRefused === true;

      if (isCompileTime && !hasReactiveVars && !hasNestedMeta && !refused) {
        const precedingDecls = scopeParts.length > 0 ? scopeParts.join("\n") : undefined;

        const replacementNodes = evaluateMetaBlock(node as MetaNode, typeRegistry, errors, precedingDecls, filePath);

        if (replacementNodes !== null) {
          // Mark preceding declarations consumed by this meta block as compile-time-only
          // so they are stripped from client JS output.
          for (const dn of declNodes) {
            (dn as Record<string, unknown>)._compileTimeOnly = true;
          }
          // §5.2 executable-sink rule (S456) — the emitted nodes' spans point into the
          // re-parsed emit text (`__meta_emit__`); record the `^{}` block's own span so the
          // post-ME check can anchor a refusal where the author can find it.
          for (const rn of replacementNodes) {
            if (rn && typeof rn === "object" && (node as { span?: Span }).span) {
              (rn as Record<string, unknown>)._metaEmitSiteSpan = (node as { span?: Span }).span;
            }
          }
          // Splice the replacement nodes in place of the meta node
          nodes.splice(i, 1, ...replacementNodes);
          changed = true;
          // Don't increment i — we need to process the newly inserted nodes
          // (they might contain nested meta blocks, though unlikely)
          i += replacementNodes.length;
          continue;
        }
      }
      // Not compile-time eligible or evaluation failed — leave the node
    }

    // Recurse into children and body arrays, propagating accumulated scope
    const n = node as Record<string, unknown>;
    const currentScope = scopeParts.length > 0 ? scopeParts.join("\n") : undefined;
    if (Array.isArray(n.children)) {
      if (processNodeList(n.children as ASTNode[], typeRegistry, errors, currentScope, declNodes, filePath)) changed = true;
    }
    if (Array.isArray(n.body) && node.kind !== "meta") {
      if (processNodeList(n.body as ASTNode[], typeRegistry, errors, currentScope, declNodes, filePath)) changed = true;
    }

    i++;
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Input/output interfaces
// ---------------------------------------------------------------------------

/** Input to the meta-eval pass. */
export interface MetaEvalInput {
  files: FileAST[];
  depGraph?: unknown;
  routeMap?: unknown;
}

/** Output of the meta-eval pass. */
export interface MetaEvalOutput {
  files: FileAST[];
  errors: MetaEvalError[];
  depGraph?: unknown;
  routeMap?: unknown;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the meta-eval pass. Evaluates compile-time ^{} meta blocks that use
 * emit() and replaces them with the parsed output.
 */
export function runMetaEval(input: MetaEvalInput): MetaEvalOutput {
  const { files = [], depGraph, routeMap } = input;

  const allErrors: MetaEvalError[] = [];

  for (const fileAST of files) {
    // Build the type registry from this file (reuse the meta-checker helper)
    const extendedAST = fileAST as FileAST & { _metaReflectRegistry?: TypeRegistry };
    const typeRegistry: TypeRegistry = extendedAST._metaReflectRegistry || buildFileTypeRegistry(fileAST);

    // Get the AST node list
    const nodes = (fileAST.ast?.nodes ?? (fileAST as unknown as { nodes?: ASTNode[] }).nodes ?? []) as ASTNode[];

    // Process all meta blocks
    processNodeList(nodes, typeRegistry, allErrors, undefined, undefined, fileAST.filePath ?? "");
  }

  return {
    files,
    errors: allErrors,
    depGraph,
    routeMap,
  };
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  bodyReferencesReactiveVars,
  serializeBody,
  serializeNode,
  reparseEmitted,
  evaluateMetaBlock,
  processNodeList,
  runInMetaRealm,
  checkEmittedNodes,
};
