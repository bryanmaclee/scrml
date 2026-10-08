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
import * as acorn from "acorn";
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
 * Wall-clock bound on one compile-time `^{}` evaluation (S458). The body runs as a
 * STRICT-mode function and Bun's engine (JavaScriptCore) implements proper tail calls in
 * strict mode, so `const f = () => f(); f()` is an endless loop rather than a stack
 * overflow — without a bound it hung the compiler (as any `while (true) {}` always did).
 * An impl#1 limit, not a language rule: a body that exceeds it is E-META-EVAL-001.
 */
const META_EVAL_TIME_LIMIT_MS = 5000;

/**
 * Run the checked, wrapped body in a fresh `node:vm` context whose global object has no
 * `process` / `Bun` / `require` and whose builtins are the realm's own. This is NOT the
 * security boundary (the allow-list is) — it bounds the damage of a hole in it.
 *
 * The body is evaluated exactly as checked (`vm.runInContext(wrapped)` yields the function),
 * then INVOKED inside the realm by a second `runInContext` so the vm `timeout` bounds the
 * run: a timeout applies only to code started by `runInContext`, not to a realm function
 * the host calls directly. The two handles sit on the realm's global only for that call.
 */
function runInMetaRealm(
  wrapped: string,
  typeRegistry: TypeRegistry,
  timeLimitMs: number = META_EVAL_TIME_LIMIT_MS,
): RealmResult {
  const reflect = createReflect(typeRegistry as unknown as Map<string, never>);
  const table: Record<string, string> = {};
  for (const name of registryTypeNames(typeRegistry)) table[name] = JSON.stringify(reflect(name));
  let json: unknown;
  try {
    // `microtaskMode: "afterEvaluate"` (S458 review F1b): a microtask the body queues
    // runs INSIDE the bounded `runInContext` call, not on the compiler's own loop after
    // it returns — measured in Bun: without it, `Promise.resolve().then(() => { while
    // (true) {} })` returned from a 500 ms-bounded call and then hung the process; with
    // it, the same call throws ERR_SCRIPT_EXECUTION_TIMEOUT at 500 ms. (The allow-list
    // already keeps `Promise` and every async form out of reach; this is the belt.)
    const context = vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate" });
    const makeRunner = vm.runInContext(META_REALM_PRELUDE, context) as (t: string) => (b: unknown) => unknown;
    const runner = makeRunner(JSON.stringify(table));
    const body = vm.runInContext(wrapped, context);
    const realmGlobal = context as Record<string, unknown>;
    realmGlobal.scrmlMetaRunner = runner;
    realmGlobal.scrmlMetaBody = body;
    try {
      json = vm.runInContext("scrmlMetaRunner(scrmlMetaBody)", context, { timeout: timeLimitMs });
    } finally {
      delete realmGlobal.scrmlMetaRunner;
      delete realmGlobal.scrmlMetaBody;
    }
  } catch (e) {
    if (e !== null && typeof e === "object" && (e as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      return {
        ok: false,
        message: `the ^{} body did not finish within ${timeLimitMs} ms (the compile-time evaluation limit) — ` +
          "a loop or recursion that never ends? (a strict-mode tail call does not overflow the stack; it loops)",
      };
    }
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

/**
 * Attribute value kinds admitted in emit() output: PLAIN values only (§22.4.1 impl#1
 * status — "with plain attribute values"). A literal string, or no value. A
 * `variable-ref` (`onclick=save`), `call-ref` (`onclick=save()`) or `expr`
 * (`title=${…}`) value is LOGIC — it would reach code generation without scope
 * resolution, the type system or route inference (S458 review F3: `onclick=${
 * nosuchFunction(@count) }` compiled clean where source gives E-SCOPE-001, and
 * `title=${ window.PWNED = 1 }` passed). A literal that carries a `${` interpolation
 * is logic too.
 */
const EMIT_ATTR_VALUE_KINDS = new Set(["string-literal", "absent"]);

/**
 * SPEC §22.4.1 (ruling S458 "your recs on all four", item 3): the `data-scrml-` attribute
 * namespace is compiler-owned — the runtime's own markers (`data-scrml-meta`,
 * `data-scrml-outlet`, `data-scrml-each-mount`, `data-scrml-gated`, …) live there — so an
 * attribute in emit() output whose name begins with it is refused. A PREFIX rule, never a
 * list of marker names. The name is read the way the HTML tokenizer reads the attribute name
 * the compiler writes out for it: ASCII upper-case letters folded to lower case (and nothing
 * else — the tokenizer does not decode character references in an attribute name). The
 * runtime `meta.emit` gate applies the same prefix to the names its parse produced
 * (runtime-meta-emit-gate.js `_SCRML_META_EMIT_RESERVED_ATTR_PREFIX`).
 */
const COMPILER_OWNED_ATTR_PREFIX = "data-scrml-";
function isCompilerOwnedAttrName(name: string): boolean {
  return name.replace(/[A-Z]/g, (c) => c.toLowerCase()).startsWith(COMPILER_OWNED_ATTR_PREFIX);
}

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
          if (isCompilerOwnedAttrName(String(a?.name ?? ""))) {
            refuse("E-META-EVAL-002", `E-META-EVAL-002: emit() output gives \`<${tag}>\` the attribute ` +
              `'${String(a.name)}'. The \`data-scrml-\` attribute namespace is reserved for the compiler's own ` +
              `runtime markers (\`data-scrml-meta\`, \`data-scrml-outlet\`, …), like the \`_scrml_\` name prefix, so ` +
              `emit() output may not carry it (§22.4.1) — use another \`data-\` name.`);
            continue;
          }
          const v = a?.value as { kind?: string } | undefined;
          const interpolated = v && typeof v === "object" && v.kind === "string-literal"
            && typeof (v as { value?: unknown }).value === "string" && ((v as { value: string }).value).includes("${");
          if (v && typeof v === "object" && (!EMIT_ATTR_VALUE_KINDS.has(String(v.kind)) || interpolated)) {
            const what = interpolated
              ? "a quoted value carrying `${`"
              : String(v.kind) === "variable-ref"
                ? "an unquoted value — quote the attribute value"
                : "an expression value (a `${}`, a call or a reference)";
            refuse("E-META-EVAL-002", `E-META-EVAL-002: emit() output gives \`<${tag}>\` attribute ` +
              `'${String(a.name)}' ${what} (\`${String(a.name)}="…"\`); impl#1 admits only plain ` +
              `attribute values — a literal string or no value — in emit() output (§22.4.1).`);
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

/**
 * An enclosing declaration a compile-time `^{}` body may capture (§22.3): its name, the
 * JS text it is evaluated as, its AST node (marked `_compileTimeOnly` when consumed) and
 * the identifiers its initializer reads.
 */
interface ScopeDecl {
  name: string;
  code: string;
  node: ASTNode;
  refs: Set<string>;
}

/**
 * The identifiers a JS text READS — every Identifier except a non-computed member
 * property or object-literal key. An over-approximation (a name the text binds locally
 * is listed too); it only ever selects an extra declaration, which is then held to the
 * allow-list like the body. Unparseable text falls back to every identifier-shaped word.
 */
function identifierReads(text: string): Set<string> {
  const out = new Set<string>();
  let ast: any = null;
  try { ast = acorn.parse(text, { ecmaVersion: 2025, sourceType: "script", allowReturnOutsideFunction: true }); }
  catch {
    try { ast = acorn.parseExpressionAt(text, 0, { ecmaVersion: 2025, sourceType: "script" }); } catch { ast = null; }
  }
  if (!ast) {
    for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) out.add(m[0]);
    return out;
  }
  const visit = (n: any, parent: any, key: string): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x, parent, key); return; }
    if (typeof n.type !== "string") return;
    if (n.type === "Identifier") {
      const isMemberProp = parent?.type === "MemberExpression" && key === "property" && !parent.computed;
      const isKey = parent?.type === "Property" && key === "key" && !parent.computed && !parent.shorthand;
      if (!isMemberProp && !isKey) out.add(n.name);
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      visit(n[k], n, k);
    }
  };
  visit(ast, null, "");
  return out;
}

/**
 * The enclosing declarations a body actually captures (S458 review F4; §22.12 "the
 * enclosing declarations it captures"): those the body reads, plus — transitively —
 * those THEIR initializers read. Before S458 every earlier non-`@` const/let of every
 * enclosing scope was prepended, used or not, so an unrelated `const n = double(4)` or
 * `const m = Math.max(1, 2)` refused (or broke) a body that never mentions it — and was
 * then stripped from the client as "compile-time only". When a name is declared more
 * than once, the latest declaration (the one in scope at the `^{}` site) is the one taken.
 */
function selectCapturedDecls(scope: ScopeDecl[], bodyReads: Set<string>, bodyDeclared: ReadonlySet<string>): ScopeDecl[] {
  const latest = new Map<string, number>();
  scope.forEach((d, idx) => latest.set(d.name, idx));
  const chosen = new Set<number>();
  // A name the body DECLARES itself (top level) shadows the enclosing one, so that
  // enclosing decl must not be prepended — prepending it emitted a duplicate
  // `const max` beside the body's own `const max` → parse error (S458 review round 3,
  // LOW). The shadowed name is not a capture.
  const pending = [...bodyReads].filter((n) => !bodyDeclared.has(n));
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (bodyDeclared.has(name)) continue;
    const idx = latest.get(name);
    if (idx === undefined || chosen.has(idx)) continue;
    chosen.add(idx);
    for (const r of scope[idx].refs) pending.push(r);
  }
  return scope.filter((_, idx) => chosen.has(idx));
}

/** Names a serialized body declares at its OWN top level (let / const / function). */
function topLevelDeclaredNames(bodyText: string): Set<string> {
  const out = new Set<string>();
  let ast: any = null;
  try { ast = acorn.parse(bodyText, { ecmaVersion: 2025, sourceType: "script", allowReturnOutsideFunction: true }); } catch { return out; }
  for (const s of ast.body ?? []) {
    if (s.type === "VariableDeclaration") for (const d of s.declarations) collectAcornPatternNames(d.id, out);
    else if (s.type === "FunctionDeclaration" && s.id) out.add(s.id.name);
  }
  return out;
}

function collectAcornPatternNames(p: any, out: Set<string>): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.add(p.name); return;
    case "ObjectPattern": for (const pr of p.properties) collectAcornPatternNames(pr.type === "RestElement" ? pr.argument : pr.value, out); return;
    case "ArrayPattern": for (const el of p.elements) collectAcornPatternNames(el, out); return;
    case "RestElement": collectAcornPatternNames(p.argument, out); return;
    case "AssignmentPattern": collectAcornPatternNames(p.left, out); return;
  }
}

function scopeDeclOf(node: ASTNode): ScopeDecl | null {
  if (node.kind !== "const-decl" && node.kind !== "let-decl") return null;
  const pn = node as Record<string, unknown>;
  const initStr = pn.initExpr
    ? (() => { try { return emitStringFromTree(pn.initExpr as ExprNode); } catch { return null; } })()
    : (typeof pn.init === "string" ? pn.init : null);
  if (!initStr || typeof pn.name !== "string" || !pn.name || /@/.test(initStr)) return null;
  const kw = node.kind === "const-decl" ? "const" : "let";
  return { name: pn.name, code: `${kw} ${pn.name} = ${initStr};`, node, refs: identifierReads(`(${initStr})`) };
}

/**
 * Identifier names read by NON-meta code across a file's node tree — the text of every
 * node that is not (and is not inside) a `^{}` body. Used to decide whether a captured
 * declaration may be stripped from the client as compile-time-only.
 */
function collectNonMetaReads(nodes: ASTNode[]): Set<string> {
  const out = new Set<string>();
  const addText = (t: unknown) => { if (typeof t === "string" && t.trim()) for (const n of identifierReads(t)) out.add(n); };
  const addTree = (e: unknown) => { if (e && typeof e === "object") { try { addText(emitStringFromTree(e as ExprNode)); } catch { /* ignore */ } } };
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const el of n) visit(el); return; }
    const node = n as Record<string, unknown>;
    if (typeof node.kind === "string" && isMetaKind(node.kind)) {
      // A COMPILE-TIME meta body is evaluated away — its reads are not client reads. A
      // RUNTIME meta body stays in the client and reads its captures through the emitted
      // closure, so those reads DO keep a declaration alive (round 3 LOW).
      if (bodyUsesCompileTimeApis((node.body as unknown[]) ?? [])) return;
      // A RUNTIME meta node's `meta.bindings` object (§22.5.2) names EVERY binding in scope
      // at its site (`name: name`), read or not — each such declaration must stay in the
      // client (S458 final F3: a `const` captured by a sibling compile-time `^{}` was
      // stripped while the runtime block's bindings object still referenced it).
      const scope = node.capturedScope;
      if (Array.isArray(scope)) {
        for (const e of scope) if (e && typeof (e as { name?: unknown }).name === "string") out.add((e as { name: string }).name);
      }
    }
    for (const k of ["init", "expr", "raw", "condition", "content", "iterable"]) addText(node[k]);
    for (const k of ["initExpr", "exprNode", "condExpr", "iterExpr", "matchExpr", "headerExpr"]) addTree(node[k]);
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "tabSpan" || key === "loc") continue;
      const v = node[key];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(nodes);
  return out;
}

/** A node an emit leaves behind that renders nothing: whitespace-only text or a comment. */
function isBlankNode(n: ASTNode): boolean {
  if (!n || typeof n !== "object") return true;
  const r = n as Record<string, unknown>;
  if (r.kind === "comment") return true;
  if (r.kind !== "text") return false;
  const v = r.value ?? r.text ?? r.content;
  return typeof v !== "string" || v.trim() === "";
}

function processNodeList(
  nodes: ASTNode[],
  typeRegistry: TypeRegistry,
  errors: MetaEvalError[],
  outerScope?: ScopeDecl[],
  filePath: string = "",
  nonMetaReads?: ReadonlySet<string>,
  markupPosition: boolean = true,
): boolean {
  if (!Array.isArray(nodes)) return false;

  let changed = false;
  let i = 0;

  // Accumulate declarations from this level to propagate to nested scopes.
  const scopeDecls: ScopeDecl[] = outerScope ? [...outerScope] : [];

  while (i < nodes.length) {
    const node = nodes[i];
    if (!node || typeof node !== "object") {
      i++;
      continue;
    }

    // Collect compile-time-safe declarations as we walk, for scope injection
    // Phase 4d: ExprNode-first — reconstruct init from initExpr, string fallback
    {
      const d = scopeDeclOf(node);
      if (d) scopeDecls.push(d);
    }
    if (node.kind === "logic" && Array.isArray((node as Record<string, unknown>).body)) {
      for (const stmt of (node as Record<string, unknown>).body as ASTNode[]) {
        if (!stmt || typeof stmt !== "object") continue;
        const d = scopeDeclOf(stmt);
        if (d) scopeDecls.push(d);
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
        const bodyText = serializeBody((body || []) as LogicStatement[], collectMetaLocals((body || []) as LogicStatement[]));
        const bodyDeclared = topLevelDeclaredNames(bodyText);
        const captured = selectCapturedDecls(scopeDecls, identifierReads(`(function () {\n${bodyText}\n})`), bodyDeclared);
        const precedingDecls = captured.length > 0 ? captured.map((d) => d.code).join("\n") : undefined;

        const replacementNodes = evaluateMetaBlock(node as MetaNode, typeRegistry, errors, precedingDecls, filePath);

        // §22.4 "inline the result": the result of `emit()` is MARKUP, so it is inlined
        // only where markup sits — the file's top level or a markup element's children.
        // A compile-time `^{}` inside a `${}` logic body — a statement list, an `if` /
        // `else` branch, a loop, a match arm, a function — has no markup position to
        // receive it: the branch exists only at run time, and markup spliced into a
        // statement list was dropped by codegen with no diagnostic (S458 final F3). The
        // SPEC defines no splice there, so it is refused, never silently dropped. A body
        // that emits nothing (e.g. only `reflect()` into a local) is unaffected.
        if (replacementNodes !== null && !markupPosition && replacementNodes.some((rn) => !isBlankNode(rn))) {
          errors.push(new MetaEvalError(
            "E-META-EVAL-002",
            `This compile-time ^{} emits markup from inside a \${} logic block ` +
            `(a statement list, an if/else branch, a loop, a match arm or a function body). ` +
            `Compile-time emit() output is inlined where markup sits, and a logic body has no markup ` +
            `position to receive it — a branch that exists only at run time cannot be filled at compile ` +
            `time. Move the ^{} into the markup (e.g. inside the element the branch renders), or, if the ` +
            `output depends on a run-time condition, use a runtime ^{} with meta.emit() (§22.4, §22.5.1).`,
            (node as { span?: Span }).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span,
          ));
          i++;
          continue;
        }

        if (replacementNodes !== null) {
          // Mark the declarations this meta block consumed as compile-time-only so they
          // are stripped from client JS output — but ONLY those NO non-meta code reads
          // (S458 review round 3, LOW: a decl read by both a compile-time `^{}` and the
          // client must stay in the client, else the client reference throws).
          for (const d of captured) {
            if (!nonMetaReads || !nonMetaReads.has(d.name)) {
              (d.node as Record<string, unknown>)._compileTimeOnly = true;
            }
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

    // Recurse into EVERY child container array, propagating accumulated scope (round 3,
    // HIGH-1 total descent): a compile-time `^{}` sitting directly in an `if` / `else`
    // branch, a match arm, or a loop body of a kind other than `body` was never
    // evaluated or spliced here, so it reached codegen and was emitted as a runtime
    // effect (`emit is not defined`). Splicing happens inside whichever array holds the
    // meta node, so recursing into every array-valued child reaches it. A meta node's
    // own `body` is NOT descended (its statements are the body being evaluated).
    const n = node as Record<string, unknown>;
    if (!isMetaKind(node.kind)) {
      for (const key of Object.keys(n)) {
        if (key === "span" || key === "tabSpan" || key === "loc") continue;
        const v = n[key];
        // Markup position (F3): below markup — an element's children, an `<each>` row, … —
        // until a `${}` logic node is entered; from there on every array is a statement
        // list (a body, a branch, a loop / function body) until a markup element again.
        const childMarkupPosition = node.kind === "logic" ? false : (markupPosition || node.kind === "markup");
        if (Array.isArray(v) && v.some((el) => el && typeof el === "object" && typeof (el as ASTNode).kind === "string")) {
          if (processNodeList(v as ASTNode[], typeRegistry, errors, scopeDecls, filePath, nonMetaReads, childMarkupPosition)) changed = true;
        } else if (v && typeof v === "object" && typeof (v as ASTNode).kind === "string") {
          // A single child node held directly (e.g. a ternary branch) — wrap so a meta
          // there is still reached. (It cannot be spliced in place, but a meta is only
          // spliced from an array; a lone meta is never a markup position.)
          if (processNodeList([v as ASTNode], typeRegistry, errors, scopeDecls, filePath, nonMetaReads, false)) changed = true;
        }
      }
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

    // Names read by NON-meta code (S458 review round 3, LOW): a captured declaration is
    // stripped from the client as compile-time-only ONLY when nothing outside a meta
    // block reads it. A decl read by both a compile-time `^{}` and client code must stay
    // in the client, or the client reference is a `ReferenceError`.
    const nonMetaReads = collectNonMetaReads(nodes);

    // Process all meta blocks
    processNodeList(nodes, typeRegistry, allErrors, undefined, fileAST.filePath ?? "", nonMetaReads);
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
  META_EVAL_TIME_LIMIT_MS,
  checkEmittedNodes,
};
