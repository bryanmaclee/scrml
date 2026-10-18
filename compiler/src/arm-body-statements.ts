/**
 * arm-body-statements.ts — the ONE reader of a match / `!{}` / engine-message
 * arm body that is carried as TEXT (S462, review rounds 1–2).
 *
 * Several arm forms reach the stages after the parser with their body as a raw
 * string rather than as statement nodes: an alternation arm (`.A | .B :> …`), a
 * literal arm (`1 :> …`), a §18.19 product arm, a `!{}` handler arm, an engine
 * message arm. Every question asked about such a body — "does it leave?", "does
 * it `return` outside a function?", "does it `break` outside a loop?" — is
 * answered here by PARSING the body with the compiler's own statement parser and
 * walking the resulting nodes, never by scanning the text (a leave word inside a
 * string literal, or a `{` belonging to an object literal, is not structure).
 *
 *   armBodyStatementsFromText(text) → statement nodes, or null
 *     - a §18.2 leave statement (`return [expr]`, `fail <variant>`,
 *       `break [Label]`, `continue [Label]`) → [its node] (`parseLeaveArmBody`);
 *     - a `{ … }` block → its statements (`parseStatementText`);
 *     - anything else (a single expression) → null: an expression contains no
 *       statement, so it cannot leave and cannot `return` / `break`.
 *
 *   leaveInStatements(stmts) → "return" | "fail" | "?" | "break" | "continue" | null
 *     the first exit that leaves the statement list itself: a `return` / `fail` /
 *     `?`, or a `break` / `continue` whose target is not a loop inside the list
 *     (an unlabelled one inside a loop is that loop's; a labelled one leaves
 *     unless the label names a loop inside the list). Function, lambda and `fn`
 *     bodies are their own scope and are not entered.
 */


/**
 * THE reading of a block arm body that is an OBJECT LITERAL (`.A :> { g: check }`,
 * `1 :> { x: 1, y: 2 }`, `else :> {}`). The decision is the PARSER's, made from the
 * arm's tokens (ast-builder.js `armBraceBodyObjectShape` / `parseArmBraceBody`): an
 * object arm's body is ONE `bare-expr` marked `objectLiteralArm`, whose exprNode is the
 * object. This function only reads that mark — it never rebuilds or re-parses text (S469
 * r2: the r1 version rebuilt `{ <expr> }` from the statement text, which had lost a `;`,
 * so the BLOCK `1 :> { ok; }` read as the object `{ ok: ok }` — truthy — and a wrong
 * password got in). Used by the type checker (`objectLiteralArmBodyNode`, the
 * W-MATCH-ARM-SHORTHAND-OBJECT lint) and codegen (`emitObjectLiteralArm`), so every
 * stage agrees with the parser (§13.2 / §13.9.6: an async function stored in the object
 * is E-ASYNC-FN-ESCAPES-AS-VALUE).
 *
 * Returns `{ text, node, singleShorthand }` or null for a genuine block.
 */
export function objectLiteralArmValue(body: unknown): { text: string; node: any; singleShorthand: string | null } | null {
  if (!Array.isArray(body)) return null;
  if (body.length === 0) {
    // `else :> {}` — an empty OBJECT, not a void block (structural: no statement at all).
    return { text: "{}", node: { kind: "object", props: [] }, singleShorthand: null };
  }
  if (body.length !== 1) return null;
  const only = body[0] as { kind?: string; expr?: unknown; exprNode?: any; objectLiteralArm?: boolean; singleShorthand?: string } | undefined;
  if (!only || only.kind !== "bare-expr" || only.objectLiteralArm !== true) return null;
  if (!only.exprNode || only.exprNode.kind !== "object" || typeof only.expr !== "string") return null;
  return { text: only.expr, node: only.exprNode, singleShorthand: typeof only.singleShorthand === "string" ? only.singleShorthand : null };
}

/**
 * §18.5 (#1450 F6) — the ONE place that decides what a brace arm body that is the
 * single shorthand property `{ name }` (no `;`) is. Today (S468 ruling item 5, under
 * re-confirmation): the object `{ name: name }`, with the info lint
 * W-MATCH-ARM-SHORTHAND-OBJECT. To make it a compile ERROR instead, set this to
 * "error": the type checker's lint site (type-system.ts `singleShorthandArmDiagnostic`)
 * then reports the same site at severity "error", so the program does not build.
 */
export const SINGLE_SHORTHAND_ARM_BODY: "object" | "error" = "object";

const FN_KINDS = new Set(["function-decl", "fn-decl", "fn", "function", "closure", "lambda"]);
const LOOP_KINDS = new Set(["for-stmt", "while-stmt", "do-while-stmt", "for-loop", "while-loop"]);

export function armBodyStatementsFromText(text: string): any[] | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseLeaveArmBody } = require("./ast-builder.js") as {
    parseLeaveArmBody: (t: string, f: string, o: number) => { node?: any; error?: string } | null;
  };
  const leave = parseLeaveArmBody(t, "<arm>", 0);
  if (leave && leave.node) return [leave.node];
  if (t.startsWith("{") && t.endsWith("}")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseStatementText } = require("./validators/defer-structure.ts") as {
      parseStatementText: (t: string, f?: string) => { ok: boolean; stmts?: any[] };
    };
    const parsed = parseStatementText(t, "<arm>");
    return parsed.ok && Array.isArray(parsed.stmts) ? parsed.stmts : null;
  }
  return null;
}

/**
 * S465 r2 — the codegen reading of a `{ … }` arm block: `armBodyStatementsFromText`
 * with the refusal reason, and STRICT (an expression the parser could read only
 * by dropping trailing content refuses the body — `parseStatementTextDetailed`).
 * A leave statement reads as `[its node]`; a non-block text is not a block (null).
 */
export function armBlockStatementsDetailed(text: string):
  | { ok: true; stmts: any[] }
  | { ok: false; refusal: { code: string | null; message: string; text: string } }
  | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseLeaveArmBody } = require("./ast-builder.js") as {
    parseLeaveArmBody: (t: string, f: string, o: number) => { node?: any; error?: string } | null;
  };
  const leave = parseLeaveArmBody(t, "<arm>", 0);
  if (leave && leave.node) return { ok: true, stmts: [leave.node] };
  if (!(t.startsWith("{") && t.endsWith("}"))) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseStatementTextDetailed } = require("./validators/defer-structure.ts") as {
    parseStatementTextDetailed: (t: string, f?: string, o?: { lostTrailing?: boolean }) =>
      { ok: true; stmts: any[] } | { ok: false; refusal: { code: string | null; message: string; text: string } };
  };
  return parseStatementTextDetailed(t, "<arm>");
}

export function leaveKindOf(n: any): string | null {
  switch (n?.kind) {
    case "return-stmt": return "return";
    case "fail-expr": return "fail";
    case "propagate-expr": return "?";
    case "break-stmt": return "break";
    case "continue-stmt": return "continue";
    default: return null;
  }
}

export function leaveInStatements(stmts: unknown): string | null {
  let found: string | null = null;
  const seen = new Set<unknown>();
  const walk = (n: any, loopDepth: number, labels: Set<string>): void => {
    if (found || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c, loopDepth, labels); return; }
    const k = n.kind;
    if (typeof k === "string" && FN_KINDS.has(k)) return;
    if (k === "return-stmt" || k === "fail-expr" || k === "propagate-expr") { found = leaveKindOf(n); return; }
    if (k === "break-stmt" || k === "continue-stmt") {
      const label = typeof n.label === "string" && n.label.length > 0 ? n.label : null;
      const targetInside = label ? labels.has(label) : loopDepth > 0;
      if (!targetInside) found = leaveKindOf(n);
      return;
    }
    let depth = loopDepth;
    let inner = labels;
    if (typeof k === "string" && LOOP_KINDS.has(k)) {
      depth = loopDepth + 1;
      if (typeof n.label === "string" && n.label.length > 0) { inner = new Set(labels); inner.add(n.label); }
    }
    for (const [key, v] of Object.entries(n)) if (key !== "span" && v && typeof v === "object") walk(v, depth, inner);
  };
  walk(stmts, 0, new Set());
  return found;
}

/**
 * The statement nodes an arm body holds, whatever form the arm takes: a
 * structured block (`body`), a bare leave (`leaveStmt`), or text (`result` /
 * `handler` / the raw arm text of a `bare-expr` arm). null when the body is a
 * single expression.
 */
export function armStatements(arm: any): any[] | null {
  if (!arm || typeof arm !== "object") return null;
  if (arm.kind === "match-arm-block" || arm.kind === "given-guard") return Array.isArray(arm.body) ? arm.body : null;
  if (arm.leaveStmt) return [arm.leaveStmt];
  if (arm.kind === "match-arm-inline" && typeof arm.result === "string") return armBodyStatementsFromText(arm.result);
  if (arm.kind === "bare-expr" && typeof arm.expr === "string") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { splitMultiArmString, parseMatchArm } = require("./codegen/emit-control-flow.ts") as {
      splitMultiArmString: (s: string) => string[];
      parseMatchArm: (s: string) => { result: string } | null;
    };
    const out: any[] = [];
    for (const a of splitMultiArmString(arm.expr.trim())) {
      const parsed = parseMatchArm(a);
      const st = parsed ? armBodyStatementsFromText(parsed.result) : null;
      if (st) out.push(...st);
    }
    return out.length ? out : null;
  }
  if (Array.isArray(arm.body)) return arm.body; // a structured `!{}` arm
  if (typeof arm.handler === "string") return armBodyStatementsFromText(arm.handler);
  return null;
}

/**
 * The exits of a statement list that leave it entirely, each once, in order:
 * a `return` / `fail` (a function exit — nested function, lambda and `fn` bodies
 * are their own scope and are not entered) and a `break` / `continue` whose
 * target is not a loop inside the list (labels tracked). The same boundary rules
 * as the loop-control check (`checkLoopControl`) and `leaveInStatements`.
 */
export function exitsOfStatements(stmts: unknown): Array<{ kind: "return" | "fail" | "break" | "continue"; node: any }> {
  const out: Array<{ kind: "return" | "fail" | "break" | "continue"; node: any }> = [];
  const seen = new Set<unknown>();
  const walk = (n: any, loopDepth: number, labels: Set<string>): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c, loopDepth, labels); return; }
    const k = n.kind;
    if (typeof k === "string" && FN_KINDS.has(k)) return;
    if (k === "return-stmt") { out.push({ kind: "return", node: n }); return; }
    if (k === "fail-expr") { out.push({ kind: "fail", node: n }); return; }
    if (k === "break-stmt" || k === "continue-stmt") {
      const label = typeof n.label === "string" && n.label.length > 0 ? n.label : null;
      const targetInside = label ? labels.has(label) : loopDepth > 0;
      if (!targetInside) out.push({ kind: k === "break-stmt" ? "break" : "continue", node: n });
      return;
    }
    let depth = loopDepth;
    let inner = labels;
    if (typeof k === "string" && LOOP_KINDS.has(k)) {
      depth = loopDepth + 1;
      if (typeof n.label === "string" && n.label.length > 0) { inner = new Set(labels); inner.add(n.label); }
    }
    for (const [key, v] of Object.entries(n)) if (key !== "span" && v && typeof v === "object") walk(v, depth, inner);
  };
  walk(stmts, 0, new Set());
  return out;
}
