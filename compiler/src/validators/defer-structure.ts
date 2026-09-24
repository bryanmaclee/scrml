/**
 * Structural helpers shared by the `defer` checker (validators/lint-defer.ts)
 * and the `defer` lowering (codegen/lower-defer.ts) — SPEC §19.16, S430.
 *
 * S430 round 3 (contract Rule 7 — "don't ask the text what the tree already
 * knows"): nothing here scans source TEXT for keywords or names. Where a body
 * reaches us as text, it is PARSED into a statement tree by the compiler's own
 * front-end and walked as a tree; where it cannot be parsed or understood, the
 * caller is told so ("unknown") and fails closed.
 *
 * @module defer-structure
 */
// The front-end, codegen's arm parser and the type system's destructure
// iterator are loaded LAZILY (the emit-logic.ts `_emitNestedGuardedArmBody`
// precedent): this module is imported by codegen/lower-defer.ts, and a static
// import of emit-control-flow / type-system from here closes an import cycle
// through the codegen modules.
/* eslint-disable @typescript-eslint/no-require-imports */
function splitBlocks(filePath: string, source: string): unknown {
  return (require("../block-splitter.js") as { splitBlocks: (f: string, s: string) => unknown }).splitBlocks(filePath, source);
}
function buildAST(bs: unknown): unknown {
  return (require("../ast-builder.js") as { buildAST: (b: unknown) => unknown }).buildAST(bs);
}
function parseMatchArm(text: string): unknown {
  return (require("../codegen/emit-control-flow.ts") as { parseMatchArm: (t: string) => unknown }).parseMatchArm(text);
}
function iterDestructuredNames(p: unknown): Iterable<string> {
  return (require("../type-system.ts") as { iterDestructuredNames: (p: unknown) => Iterable<string> }).iterDestructuredNames(p);
}
/* eslint-enable @typescript-eslint/no-require-imports */

type Node = Record<string, unknown> & { kind?: string };

// ---------------------------------------------------------------------------
// Text-carried statement bodies -> statement trees
// ---------------------------------------------------------------------------

const PROBE_FN = "__scrml_defer_probe__";

export type ParsedBody = { ok: true; stmts: unknown[] } | { ok: false };

/**
 * Parse a text-carried statement body (a `!{}` handler arm, a value-form
 * `match` arm body) into a statement tree with the same block-splitter +
 * ast-builder front-end codegen uses to re-parse nested arm bodies
 * (`_emitNestedGuardedArmBody`, emit-logic.ts). The body is wrapped in a probe
 * FUNCTION so `return` is grammatical. `{ ok: false }` when the body does not
 * parse cleanly or contains a statement the front-end could not structure
 * (an escape-hatch parse error) — callers fail closed on that.
 */
export function parseStatementText(text: string, filePath = "defer-probe.scrml"): ParsedBody {
  let body = text.trim();
  // A handler / arm BLOCK body `{ … }` — codegen treats the braces as the
  // block delimiters (not an object literal); strip exactly that outer pair.
  if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1);
  const source = "${\nfunction " + PROBE_FN + "() {\n" + body + "\n}\n}";
  try {
    const bs = splitBlocks(filePath + "#defer-probe", source) as { errors?: unknown[] };
    if (Array.isArray(bs.errors) && bs.errors.length > 0) return { ok: false };
    const built = buildAST(bs) as { ast?: unknown; errors?: Array<{ severity?: string }> };
    const fatal = (built.errors ?? []).filter((e) => !e || e.severity !== "warning");
    if (fatal.length > 0) return { ok: false };
    let found: unknown[] | null = null;
    const seen = new WeakSet<object>();
    const find = (n: unknown): void => {
      if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
      seen.add(n as object);
      if (Array.isArray(n)) { for (const c of n) find(c); return; }
      const nn = n as Node;
      if (nn.kind === "function-decl" && nn.name === PROBE_FN && Array.isArray(nn.body)) {
        found = nn.body as unknown[];
        return;
      }
      for (const k of Object.keys(nn)) if (k !== "span") find(nn[k]);
    };
    find(built.ast);
    if (!found) return { ok: false };
    let hatch = false;
    const seen2 = new WeakSet<object>();
    const scan = (n: unknown): void => {
      if (hatch || !n || typeof n !== "object" || seen2.has(n as object)) return;
      seen2.add(n as object);
      if (Array.isArray(n)) { for (const c of n) scan(c); return; }
      const nn = n as Node;
      if (nn.kind === "escape-hatch" && nn.nativeKind === "ParseError") { hatch = true; return; }
      for (const k of Object.keys(nn)) if (k !== "span") scan(nn[k]);
    };
    scan(found);
    if (hatch) return { ok: false };
    return { ok: true, stmts: found };
  } catch {
    return { ok: false };
  }
}

/**
 * The text-carried bodies of one node, each as `{ text, label }`:
 *   - `!{}` handler arms (`arms[].handler`);
 *   - a live `match-expr` / `match-stmt`: its `bare-expr` arms (split by
 *     codegen's own `parseMatchArm`) and `match-arm-inline.result`;
 *   - a native `match-expr`: `rawArms[]` (split by `parseMatchArm`).
 * An arm codegen's parser cannot split is returned with `text: null`.
 */
export type TextBody = { text: string | null; label: string; binds: string[] };

/** Names an arm binding introduces (`::V(a)`, `::V(a, b)`, a list, or none). */
function armBindNames(b: unknown): string[] {
  if (Array.isArray(b)) return b.flatMap(armBindNames);
  if (typeof b === "string") {
    return b.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x) && x !== "_");
  }
  if (b && typeof b === "object") return bindingNames(b);
  return [];
}

export function textBodiesOf(n: Node): TextBody[] {
  const out: TextBody[] = [];
  if (n.kind === "guarded-expr" && Array.isArray(n.arms)) {
    for (const a of n.arms as Node[]) {
      if (a && typeof a.handler === "string" && (a.handler as string).trim() !== "") {
        out.push({ text: a.handler as string, label: "a `!{}` handler arm", binds: armBindNames(a.binding) });
      }
    }
  }
  if ((n.kind === "match-expr" || n.kind === "match-stmt") && Array.isArray(n.body)) {
    for (const arm of n.body as Node[]) {
      if (!arm || typeof arm !== "object") continue;
      if (arm.kind === "bare-expr" && typeof arm.expr === "string") {
        const parsed = parseMatchArm((arm.expr as string).trim()) as { result: string; binding?: unknown } | null;
        out.push({ text: parsed ? parsed.result : null, label: "a `match` arm", binds: parsed ? armBindNames(parsed.binding) : [] });
      } else if (arm.kind === "match-arm-inline" && typeof arm.result === "string") {
        out.push({ text: arm.result as string, label: "a `match` arm", binds: armBindNames(arm.binding) });
      }
    }
  }
  if (Array.isArray(n.rawArms)) {
    for (const raw of n.rawArms as unknown[]) {
      if (typeof raw !== "string") continue;
      const parsed = parseMatchArm(raw.trim()) as { result: string; binding?: unknown } | null;
      out.push({ text: parsed ? parsed.result : null, label: "a `match` arm", binds: parsed ? armBindNames(parsed.binding) : [] });
    }
  }
  return out;
}

/**
 * Does host-expression / statement TEXT contain a `defer` STATEMENT? Answered
 * by PARSING it with the native statement parser (which lexes strings, regex
 * and template literals properly and recognizes `defer` exactly as §19.16.1
 * defines it), then looking for a `Defer` node in the tree — never by matching
 * the word. `asExpression` wraps the text as an initializer (a lambda /
 * function-expression escape-hatch); otherwise it is parsed as statements (an
 * `on mount { }` body). Unparseable text answers `false`: it is not evidence
 * of a `defer`, and such text fails codegen's own emitted-JS gate regardless.
 */
export function textContainsDeferStatement(text: string, asExpression: boolean): boolean {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { lex } = require("../../native-parser/lex.js") as { lex: (s: string) => unknown[] };
  const { parseProgram } = require("../../native-parser/parse-stmt.js") as {
    parseProgram: (t: unknown[], s: string) => { body: unknown[]; errors: unknown[] };
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const src = asExpression ? "let __scrml_defer_probe__ = " + text : text;
  let tree: { body: unknown[]; errors: unknown[] };
  try {
    tree = parseProgram(lex(src), src);
  } catch {
    return false;
  }
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if ((n as Node).kind === "Defer") { found = true; return; }
    for (const k of Object.keys(n as object)) if (k !== "span") walk((n as Node)[k]);
  };
  walk(tree.body);
  return found;
}

// ---------------------------------------------------------------------------
// Declared names and scope-aware free references
// ---------------------------------------------------------------------------

/** Names a binding target declares: a plain name, or every name in a destructure pattern. */
export function bindingNames(target: unknown): string[] {
  if (typeof target === "string") return target.length > 0 ? [target] : [];
  if (target && typeof target === "object") {
    const k = (target as Node).kind;
    if (k === "destructure-array" || k === "destructure-object") {
      return [...iterDestructuredNames(target)];
    }
    const nm = (target as Node).name;
    if (typeof nm === "string") return nm.length > 0 ? [nm] : [];
    if (nm && typeof nm === "object") return bindingNames(nm);
  }
  return [];
}

const LOCAL_DECL_KINDS = new Set(["let-decl", "const-decl", "lin-decl", "tilde-decl"]);

/** The local names a statement LIST declares at its own level (block scope). */
export function listDeclaredNames(list: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const s of list) {
    const sn = s as Node;
    if (!sn || typeof sn !== "object") continue;
    if (typeof sn.kind === "string" && LOCAL_DECL_KINDS.has(sn.kind)) {
      for (const n of bindingNames(sn.name)) out.add(n);
    } else if (sn.kind === "function-decl" && typeof sn.name === "string") {
      out.add(sn.name);
    }
  }
  return out;
}

/**
 * Statement code fields that carry source TEXT and the structured field that
 * mirrors each. A non-empty text field whose mirror is absent is code this walk
 * cannot see -> the result is "unknown".
 */
const TEXT_MIRRORS: Array<[string, string[]]> = [
  ["expr", ["exprNode"]],
  ["init", ["initExpr", "sqlNode", "matchExpr", "ifExpr", "forExpr", "foreignNode", "fnExprNode"]],
  ["condition", ["condExpr"]],
  ["iterable", ["iterExpr", "cStyleParts"]],
  ["header", ["headerExpr"]],
];

const UNDERSTOOD_STMT_KINDS = new Set([
  "let-decl", "const-decl", "lin-decl", "tilde-decl", "state-decl",
  "bare-expr", "return-stmt", "if-stmt", "if-expr", "for-stmt", "for-expr",
  "while-stmt", "do-while-stmt", "break-stmt", "continue-stmt",
  "function-decl", "guarded-expr", "propagate-expr", "fail-expr",
  "defer-stmt", "try-stmt", "match-stmt", "match-expr", "match-arm-block",
  "given-guard", "lift-expr", "comment",
]);

/**
 * Free identifier references of a function (its parameters and every name it
 * declares — at any block depth, block-scoped — are bound; property names,
 * object keys and string contents are not references because they are not
 * `ident` nodes). Returns `null` ("unknown") when some part of the body is code
 * this walk cannot see structurally: an escape-hatch / raw-text expression, a
 * statement kind it does not model, a text field without its structured
 * mirror, or a text-carried arm body that does not parse. Callers MUST treat
 * `null` as "may reference anything".
 */
export function functionFreeRefs(fn: Node): Set<string> | null {
  const free = new Set<string>();
  let unknown = false;
  const seen = new WeakSet<object>();

  const walkExpr = (e: unknown, bound: Set<string>): void => {
    if (unknown || !e || typeof e !== "object") return;
    if (Array.isArray(e)) { for (const c of e) walkExpr(c, bound); return; }
    if (seen.has(e as object)) return;
    seen.add(e as object);
    const n = e as Node;
    const k = n.kind;
    if (k === "ident") {
      if (typeof n.name === "string" && !bound.has(n.name)) free.add(n.name);
      return;
    }
    if (k === "escape-hatch" || (typeof n.raw === "string" && k !== "lit")) { unknown = true; return; }
    if (k === "lambda") {
      const inner = new Set(bound);
      for (const p of (Array.isArray(n.params) ? n.params : []) as unknown[]) for (const nm of bindingNames(p)) inner.add(nm);
      const body = n.body as Node | undefined;
      if (body && body.kind === "block" && Array.isArray(body.stmts)) walkList(body.stmts as unknown[], inner);
      else if (body && body.kind === "expr") walkExpr(body.value, inner);
      else if (body) unknown = true;
      return;
    }
    // A statement-shaped node reached from an expression slot (e.g. a
    // function expression's `fnExprNode`).
    if (typeof k === "string" && UNDERSTOOD_STMT_KINDS.has(k) && k !== "lift-expr") { walkStmt(n, bound); return; }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") walkExpr(v, bound);
    }
  };

  const walkFn = (f: Node, bound: Set<string>): void => {
    const inner = new Set(bound);
    if (typeof f.name === "string") inner.add(f.name);
    for (const p of (Array.isArray(f.params) ? f.params : []) as unknown[]) {
      for (const nm of bindingNames(p)) inner.add(nm);
      if (p && typeof p === "object" && (p as Node).defaultExpr) walkExpr((p as Node).defaultExpr, bound);
    }
    walkList(Array.isArray(f.body) ? (f.body as unknown[]) : [], inner);
  };

  const walkList = (list: unknown[], bound: Set<string>): void => {
    const inner = new Set(bound);
    for (const nm of listDeclaredNames(list)) inner.add(nm);
    for (const s of list) walkStmt(s as Node, inner);
  };

  const walkStmt = (s: Node, bound: Set<string>): void => {
    if (unknown || !s || typeof s !== "object") return;
    if (seen.has(s)) return;
    seen.add(s);
    const k = s.kind;
    if (typeof k !== "string" || !UNDERSTOOD_STMT_KINDS.has(k)) { unknown = true; return; }
    if (k === "function-decl") { walkFn(s, bound); return; }
    // Text fields must have their structured mirror.
    for (const [textKey, mirrors] of TEXT_MIRRORS) {
      const t = s[textKey];
      if (typeof t === "string" && t.trim() !== "" && !mirrors.some((m) => s[m] != null)) {
        unknown = true;
        return;
      }
    }
    // Text-carried arm bodies: parse and walk as trees.
    for (const tb of textBodiesOf(s)) {
      if (tb.text === null) { unknown = true; return; }
      const parsed = parseStatementText(tb.text);
      if (!parsed.ok) { unknown = true; return; }
      const armBound = new Set(bound);
      for (const nm of tb.binds) armBound.add(nm);
      walkList(parsed.stmts, armBound);
    }
    if (k === "for-stmt" || k === "for-expr") {
      const inner = new Set(bound);
      for (const nm of bindingNames(s.variable)) inner.add(nm);
      if (s.iterExpr) walkExpr(s.iterExpr, bound);
      if (s.cStyleParts) walkExpr(s.cStyleParts, inner);
      walkList(Array.isArray(s.body) ? (s.body as unknown[]) : [], inner);
      return;
    }
    if (k === "given-guard") {
      // `given x => { … }` narrows existing names; it binds nothing new.
      for (const v of (Array.isArray(s.variables) ? s.variables : []) as unknown[]) {
        if (typeof v === "string" && !bound.has(v)) free.add(v);
      }
      walkList(Array.isArray(s.body) ? (s.body as unknown[]) : [], bound);
      return;
    }
    for (const key of Object.keys(s)) {
      if (key === "span") continue;
      const v = s[key];
      if (!v || typeof v !== "object") continue;
      if (Array.isArray(v)) {
        if (v.some((c) => c && typeof c === "object" && typeof (c as Node).kind === "string" && UNDERSTOOD_STMT_KINDS.has((c as Node).kind as string))) {
          // A statement list (a body / branch). A match body's bare-expr arm
          // carries only its PATTERN structurally (its body is walked above
          // via textBodiesOf), so walking it here sees just the pattern.
          walkList(v, bound);
        } else if (key === "arms" && k === "guarded-expr") {
          // handler arms: text bodies already walked; bindings are arm-local
          // names, not references.
        } else if (key === "rawArms") {
          // walked via textBodiesOf
        } else {
          walkExpr(v, bound);
        }
      } else if (typeof (v as Node).kind === "string" && UNDERSTOOD_STMT_KINDS.has((v as Node).kind as string)) {
        walkStmt(v as Node, bound);
      } else if (key === "finallyNode" || key === "catchNode") {
        walkList(Array.isArray((v as Node).body) ? ((v as Node).body as unknown[]) : [], bound);
      } else {
        walkExpr(v, bound);
      }
    }
  };

  walkFn(fn, new Set());
  return unknown ? null : free;
}
