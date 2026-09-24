/**
 * Structural helpers for the `defer` checker (validators/lint-defer.ts) —
 * SPEC §19.16, S430. (Round 4: the lowering no longer needs any analysis —
 * the per-block defer stack moves nothing — so the hoisting helpers that lived
 * here were deleted.)
 *
 * S430 round 3 (contract Rule 7 — "don't ask the text what the tree already
 * knows"): nothing here scans source TEXT for keywords or names. Where a body
 * reaches us as text, it is PARSED into a statement tree by the compiler's own
 * front-end and walked as a tree; where it cannot be parsed or understood, the
 * caller is told so ("unknown") and fails closed.
 *
 * @module defer-structure
 */
// The front-end and codegen's arm parser are loaded LAZILY (the emit-logic.ts
// `_emitNestedGuardedArmBody` precedent): a static import of emit-control-flow
// from a validator closes an import cycle through the codegen modules.
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
export type TextBody = { text: string | null; label: string };

export function textBodiesOf(n: Node): TextBody[] {
  const out: TextBody[] = [];
  if (n.kind === "guarded-expr" && Array.isArray(n.arms)) {
    for (const a of n.arms as Node[]) {
      if (a && typeof a.handler === "string" && (a.handler as string).trim() !== "") {
        out.push({ text: a.handler as string, label: "a `!{}` handler arm" });
      }
    }
  }
  if ((n.kind === "match-expr" || n.kind === "match-stmt") && Array.isArray(n.body)) {
    for (const arm of n.body as Node[]) {
      if (!arm || typeof arm !== "object") continue;
      if (arm.kind === "bare-expr" && typeof arm.expr === "string") {
        const parsed = parseMatchArm((arm.expr as string).trim()) as { result: string } | null;
        out.push({ text: parsed ? parsed.result : null, label: "a `match` arm" });
      } else if (arm.kind === "match-arm-inline" && typeof arm.result === "string") {
        out.push({ text: arm.result as string, label: "a `match` arm" });
      }
    }
  }
  if (Array.isArray(n.rawArms)) {
    for (const raw of n.rawArms as unknown[]) {
      if (typeof raw !== "string") continue;
      const parsed = parseMatchArm(raw.trim()) as { result: string } | null;
      out.push({ text: parsed ? parsed.result : null, label: "a `match` arm" });
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
