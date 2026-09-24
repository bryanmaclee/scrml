// =============================================================================
// forbidden-js-native.ts — E-CLASS-NOT-IN-SCRML / E-DYNAMIC-IMPORT-NOT-IN-SCRML
// decided on the NATIVE parser's tree, in BOTH pipelines (SPEC §7.2.1 / §21.3.2,
// S430 rulings P1 + P4).
//
// WHY THE NATIVE TREE
//   "The word is not at fault" (bryan, S430 P1): only a class DECLARATION /
//   EXPRESSION and a dynamic `import(...)` fire — never the word in markup
//   prose, a string, a comment, CSS, SQL or a quoted attribute value. Deciding
//   that needs a tree that knows where logic ends and markup begins, at every
//   depth (markup-as-value inside logic inside markup, template interpolations,
//   block-bodied arrows). The native parser builds exactly that tree and fires
//   the two codes from its own productions (parse-stmt.js parseClassDecl,
//   parse-expr.js parsePostfix), at the keyword. The default (block-splitter +
//   acorn) front-end does not have that tree — it re-joins tokens into text and
//   hands fragments to acorn — and three review rounds of reconstructing the
//   knowledge there kept finding holes (S430 PA decision). So the default
//   pipeline runs the native parser over each file FOR THIS DIAGNOSTIC FAMILY
//   ONLY and takes the codes + spans from it. Native diagnostics of every OTHER
//   code are discarded here (the native parser has known false positives in
//   other codes; they must not leak).
//
// WHAT THIS MODULE ADDS ON TOP OF THE NATIVE PARSE
//   1. Attribute expressions. The native markup layer keeps an attribute
//      value's expression as raw text (api.js populates `exprNode` on the
//      native path with the acorn parser). Here each non-logic attribute
//      expression is parsed with the NATIVE statement parser (parseProgram —
//      which also re-enters block bodies) and its family diagnostics are
//      shifted into file coordinates. An attribute inside a logic body (lift /
//      markup-as-value) was parsed by the native parser itself and is skipped.
//      A QUOTED attribute value is data (§5), never parsed here.
//   2. The foreign-code veto (default pipeline only). The native parser has no
//      production for inline `_={ … }=` foreign code inside a function body and
//      tokenizes its interior; a family diagnostic whose position lies inside a
//      foreign region the DEFAULT parser recognised is dropped (§23.2.3 — foreign
//      code is opaque).
//   3. The fallback (default pipeline only). Where the native parse cannot
//      speak for a region — the native parse threw, or a default-parser
//      statement holds a construct acorn found and no native family diagnostic
//      lands inside that statement — the construct is reported at the
//      STATEMENT's start. It is never silently passed. `fallbackUsed` reports it
//      (the corpus measurement expects zero).
// =============================================================================

import { nativeParseFile } from "../../native-parser/parse-file.js";
import { lex } from "../../native-parser/lex.js";
import { parseProgram } from "../../native-parser/parse-stmt.js";
import { CLASS_NOT_IN_SCRML_MESSAGE, DYNAMIC_IMPORT_NOT_IN_SCRML_MESSAGE } from "../../native-parser/parse-expr.js";

export const FORBIDDEN_JS_CODES = new Set(["E-CLASS-NOT-IN-SCRML", "E-DYNAMIC-IMPORT-NOT-IN-SCRML"]);

type Span = { file?: string; start: number; end: number; line: number; col: number };
type Diag = { code: string; message: string; span: Span; severity: "error" };

const MESSAGES: Record<string, string> = {
  "E-CLASS-NOT-IN-SCRML": CLASS_NOT_IN_SCRML_MESSAGE,
  "E-DYNAMIC-IMPORT-NOT-IN-SCRML": DYNAMIC_IMPORT_NOT_IN_SCRML_MESSAGE,
};

function lineColAt(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) { line++; col = 1; } else col++;
  }
  return { line, col };
}

function toDiag(e: any, filePath: string): Diag | null {
  if (!e || !FORBIDDEN_JS_CODES.has(e.code) || !e.span || typeof e.span.start !== "number") return null;
  return {
    code: e.code,
    message: e.message,
    span: { file: filePath, start: e.span.start, end: e.span.end ?? e.span.start, line: e.span.line ?? 1, col: e.span.col ?? 1 },
    severity: "error",
  };
}

// The expression text of a native attribute value, or null (a quoted value is
// data, not source).
function attrExprText(val: any): string | null {
  if (!val || typeof val !== "object") return null;
  if (val.kind === "expr" && typeof val.raw === "string") return val.raw;
  if (val.kind === "call-ref" && typeof val.name === "string") {
    const args = Array.isArray(val.args) ? val.args.join(", ") : "";
    return `${val.name}(${args})`;
  }
  return null;
}

/**
 * Family diagnostics for the attribute expressions of a native FileAST that
 * sit OUTSIDE any logic body (see module doc, item 1).
 */
export function nativeForbiddenJsAttrDiagnostics(ast: any, source: string, filePath: string): Diag[] {
  const out: Diag[] = [];
  if (!ast || typeof source !== "string") return out;
  if (!/\b(?:class|import)\b/.test(source)) return out;
  const seen = new Set<any>();
  const stack: Array<{ v: any; inLogic: boolean }> = [];
  for (const root of [ast.nodes]) if (Array.isArray(root)) for (const n of root) stack.push({ v: n, inLogic: false });
  while (stack.length > 0) {
    const { v: cur, inLogic } = stack.pop()!;
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) { for (const el of cur) stack.push({ v: el, inLogic }); continue; }
    if (!inLogic) {
      const vals: any[] = [];
      if (Array.isArray(cur.attrs)) for (const a of cur.attrs) if (a && a.value) vals.push(a.value);
      if (cur.ifCond && typeof cur.ifCond === "object") vals.push(cur.ifCond);
      for (const val of vals) {
        const text = attrExprText(val);
        if (!text || !/\b(?:class|import)\b/.test(text)) continue;
        const span = val.span;
        const start = span && typeof span.start === "number" ? span.start : 0;
        const end = span && typeof span.end === "number" ? span.end : start + text.length;
        const at = source.slice(start, end).indexOf(text);
        if (at < 0) continue; // the text is not the source (a rebuilt call-ref) — cannot place
        const base = start + at;
        let res: any;
        try { res = parseProgram(lex(text), text); } catch { continue; }
        for (const e of res.errors || []) {
          if (!e || !FORBIDDEN_JS_CODES.has(e.code) || !e.span) continue;
          const abs = base + e.span.start;
          const { line, col } = lineColAt(source, abs);
          out.push({ code: e.code, message: e.message, span: { file: filePath, start: abs, end: base + (e.span.end ?? e.span.start), line, col }, severity: "error" });
        }
      }
    }
    const childInLogic = inLogic || cur.kind === "logic" || cur.kind === "meta";
    for (const k of Object.keys(cur)) {
      if (k === "_nativeEngineBlock" || k === "_source" || k === "span") continue;
      const v = cur[k];
      if (v && typeof v === "object") stack.push({ v, inLogic: childInLogic });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Default pipeline
// ---------------------------------------------------------------------------

// Kinds whose subtree is not logic of the enclosing statement.
const UNIT_STOP = new Set(["markup", "markup-value", "html-fragment", "text", "logic", "meta", "foreign", "Foreign", "sql", "sql-block", "css", "style"]);

/** Constructs acorn itself found under a node (escape-hatch kinds only). */
function acornConstructs(node: any, acc: Record<string, number>, seen: WeakSet<object>): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { for (const c of node) acornConstructs(c, acc, seen); return; }
  if (UNIT_STOP.has(node.kind)) return;
  if (node.kind === "escape-hatch") {
    if (node.nativeKind === "ClassExpression" || node.nativeKind === "ClassDeclaration") acc["E-CLASS-NOT-IN-SCRML"]++;
    else if (node.nativeKind === "ImportExpression") acc["E-DYNAMIC-IMPORT-NOT-IN-SCRML"]++;
    return;
  }
  for (const k of Object.keys(node)) {
    if (k === "span" || k === "parent") continue;
    acornConstructs(node[k], acc, seen);
  }
}

/**
 * The units the fallback reasons about: every statement of every logic/meta
 * body, and every attribute value outside logic, each with its file span.
 */
function collectUnits(ast: any): Array<{ node: any; span: Span }> {
  const units: Array<{ node: any; span: Span }> = [];
  const seen = new WeakSet<object>();
  const visit = (n: any, inLogic: boolean) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) visit(c, inLogic); return; }
    // A markup value's markup is re-tokenized and re-parsed by the default
    // parser from a text copy, so its nodes carry copy-local spans, not file
    // positions — no unit inside it can be placed. (The native tree covers it.)
    if (n.kind === "markup-value") return;
    if ((n.kind === "logic" || n.kind === "meta") && Array.isArray(n.body)) {
      for (const st of n.body) if (st && st.span && typeof st.span.start === "number") units.push({ node: st, span: st.span });
    }
    if (!inLogic && Array.isArray(n.attrs)) {
      for (const a of n.attrs) {
        const v = a && a.value;
        if (v && v.span && typeof v.span.start === "number" && (v.exprNode || v.argExprNodes)) units.push({ node: v, span: v.span });
      }
    }
    const childInLogic = inLogic || n.kind === "logic" || n.kind === "meta";
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      visit(n[k], childInLogic);
    }
  };
  visit(ast?.nodes, false);
  return units;
}

/** Spans of the foreign-code regions the default parser recognised. */
function foreignSpans(ast: any): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const seen = new WeakSet<object>();
  const visit = (n: any) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if ((n.kind === "foreign" || n.kind === "Foreign") && n.span && typeof n.span.start === "number") {
      out.push([n.span.start, typeof n.span.end === "number" ? n.span.end : n.span.start]);
    }
    for (const k of Object.keys(n)) if (k !== "span" && k !== "parent") visit(n[k]);
  };
  visit(ast?.nodes);
  return out;
}

export interface ForbiddenJsDefaultResult {
  diagnostics: Diag[];
  /** Units reported by the fallback (native could not speak for them). */
  fallbackUsed: number;
  /** True when the native parse of the file threw. */
  nativeFailed: boolean;
}

/**
 * The default pipeline's E-CLASS-NOT-IN-SCRML / E-DYNAMIC-IMPORT-NOT-IN-SCRML:
 * native-tree diagnostics for `source`, the default FileAST `defaultAst` used
 * only for the foreign-code veto and the fallback (module doc).
 */
export function forbiddenJsDiagnosticsForDefault(filePath: string, source: string, defaultAst: any): ForbiddenJsDefaultResult {
  const result: ForbiddenJsDefaultResult = { diagnostics: [], fallbackUsed: 0, nativeFailed: false };
  if (typeof source !== "string" || !/\b(?:class|import)\b/.test(source)) return result;

  let diags: Diag[] = [];
  try {
    const r: any = nativeParseFile(filePath, source);
    for (const e of r?.errors || []) { const d = toDiag(e, filePath); if (d) diags.push(d); }
    diags = diags.concat(nativeForbiddenJsAttrDiagnostics(r?.ast, source, filePath));
  } catch {
    result.nativeFailed = true;
  }

  // Foreign-code veto.
  const foreign = foreignSpans(defaultAst);
  diags = diags.filter((d) => !foreign.some(([a, b]) => d.span.start >= a && d.span.start < b));

  // Exact duplicates (same code + start) are one report.
  const seenKey = new Set<string>();
  diags = diags.filter((d) => { const k = d.code + "@" + d.span.start; if (seenKey.has(k)) return false; seenKey.add(k); return true; });

  // Fallback: a default statement holding an acorn-found construct with no
  // native diagnostic of that code inside it.
  for (const u of collectUnits(defaultAst)) {
    const acc: Record<string, number> = { "E-CLASS-NOT-IN-SCRML": 0, "E-DYNAMIC-IMPORT-NOT-IN-SCRML": 0 };
    acornConstructs(u.node, acc, new WeakSet());
    for (const code of Object.keys(acc)) {
      if (acc[code] === 0) continue;
      const s = u.span.start;
      const e = typeof u.span.end === "number" ? u.span.end : s;
      if (diags.some((d) => d.code === code && d.span.start >= s && d.span.start <= e)) continue;
      if (foreign.some(([a, b]) => s >= a && s < b)) continue;
      result.fallbackUsed++;
      diags.push({
        code,
        message: MESSAGES[code],
        span: { file: filePath, start: s, end: e, line: u.span.line ?? 1, col: u.span.col ?? 1 },
        severity: "error",
      });
    }
  }
  diags.sort((a, b) => a.span.start - b.span.start);
  result.diagnostics = diags;
  return result;
}
