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
  // A bare `{ … }` block statement: the live front-end carries it as a
  // `bare-expr` whose text is the whole block (S430 round 5).
  if (n.kind === "bare-expr" && typeof n.expr === "string" && (n.expr as string).trim().startsWith("{") &&
      !n._onMountEffect) {
    out.push({ text: n.expr as string, label: "a bare `{ }` block" });
  }
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
 * Does host-expression / statement TEXT contain a node of one of `kinds` in
 * the NATIVE parser's tree (`Defer`, `Yield`, …)? Answered by PARSING the text
 * with the native statement parser (which lexes strings, regex and template
 * literals properly and recognizes `defer` exactly as §19.16.1 defines it) —
 * never by matching the word. The text is parsed inside a probe GENERATOR
 * function so `yield` is grammatical; `asExpression` parses it as an
 * initializer (a lambda / function-expression / expression escape-hatch),
 * otherwise as statements (an `on mount { }` body, a bare block, an arm body).
 * Unparseable text answers `false`: it is not evidence of the construct, and
 * such text fails codegen's own emitted-JS gate regardless.
 */
export function textContainsNativeKind(text: string, asExpression: boolean, kinds: readonly string[]): boolean {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { lex } = require("../../native-parser/lex.js") as { lex: (s: string) => unknown[] };
  const { parseProgram } = require("../../native-parser/parse-stmt.js") as {
    parseProgram: (t: unknown[], s: string) => { body: unknown[]; errors: unknown[] };
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const inner = asExpression ? "let __scrml_probe_value__ = " + text : text;
  const src = "function* __scrml_probe__() {\n" + inner + "\n}";
  let tree: { body: unknown[]; errors: unknown[] };
  try {
    tree = parseProgram(lex(src), src);
  } catch {
    return false;
  }
  const want = new Set(kinds);
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if (want.has((n as Node).kind as string)) { found = true; return; }
    for (const k of Object.keys(n as object)) if (k !== "span") walk((n as Node)[k]);
  };
  walk(tree.body);
  return found;
}

/**
 * Does expression TEXT contain a `defer` statement INSIDE a function / arrow
 * body (parsed with the native parser; see textContainsNativeKind)? Used for a
 * lambda escape-hatch: a `defer` that is NOT inside a function body in that
 * text (e.g. the escape-hatch of a bare `{ … }` block) is some other site's
 * concern, not a lambda's (S430 round 6, D).
 */
export function textLambdaContainsDefer(text: string): boolean {
  if (!text.includes("defer")) return false;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { lex } = require("../../native-parser/lex.js") as { lex: (s: string) => unknown[] };
  const { parseProgram } = require("../../native-parser/parse-stmt.js") as {
    parseProgram: (t: unknown[], s: string) => { body: unknown[]; errors: unknown[] };
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const src = "function* __scrml_probe__() {\nlet __scrml_probe_value__ = " + text + "\n}";
  let tree: { body: unknown[] };
  try {
    tree = parseProgram(lex(src), src);
  } catch {
    return false;
  }
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown, depth: number): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c, depth); return; }
    const k = (n as Node).kind;
    if (k === "Defer" && depth > 1) { found = true; return; } // depth 1 = the probe generator itself
    const d = k === "Arrow" || k === "Function" || k === "FunctionDecl" ? depth + 1 : depth;
    for (const key of Object.keys(n as object)) if (key !== "span") walk((n as Node)[key], d);
  };
  walk(tree.body, 0);
  return found;
}

/** Does TEXT contain a `defer` statement (parsed; see textContainsNativeKind)? */
export function textContainsDeferStatement(text: string, asExpression: boolean): boolean {
  return text.includes("defer") && textContainsNativeKind(text, asExpression, ["Defer"]);
}

/**
 * Does statement TEXT contain a `defer` statement that is NOT inside a function
 * / arrow body nested in that text (parsed with the native statement parser)?
 * The complement of `textLambdaContainsDefer` for a statement body: a `defer`
 * inside a nested lambda in the text is the lambda check's concern (it has its
 * own escape-hatch / `lambda` node), so it is not reported twice.
 */
export function textContainsDirectDeferStatement(text: string): boolean {
  if (!text.includes("defer")) return false;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { lex } = require("../../native-parser/lex.js") as { lex: (s: string) => unknown[] };
  const { parseProgram } = require("../../native-parser/parse-stmt.js") as {
    parseProgram: (t: unknown[], s: string) => { body: unknown[]; errors: unknown[] };
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const src = "function* __scrml_probe__() {\n" + text + "\n}";
  let tree: { body: unknown[] };
  try {
    tree = parseProgram(lex(src), src);
  } catch {
    return false;
  }
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown, depth: number): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c, depth); return; }
    const k = (n as Node).kind;
    if (k === "Defer" && depth === 1) { found = true; return; } // depth 1 = the probe generator's own body
    const d = k === "Arrow" || k === "Function" || k === "FunctionDecl" ? depth + 1 : depth;
    for (const key of Object.keys(n as object)) if (key !== "span") walk((n as Node)[key], d);
  };
  walk(tree.body, 0);
  return found;
}

/**
 * §19.16.3 rule 4 (S432, A1) — the statement bodies a node carries as TEXT that
 * codegen LOWERS AS TEXT (`rewriteBlockBody` / the worker / test emitters)
 * whatever the enclosing context. None of them is a function-declaration body,
 * so a `defer` in any of them is E-DEFER-OUTSIDE-FUNCTION — and because the
 * body is lowered as text, a `defer` inside a function DECLARED in that body
 * cannot be lowered either (`anyDepth`).
 *
 * Enumerated by AST node KIND (every text-lowered statement body of the
 * live-shaped AST that is not already reached structurally), not by scanning
 * source:
 *   - `when-effect`            (`when @x changes { … }`)                     .bodyRaw
 *   - `when-message`           (worker self-handler `when message(d) { … }`) .bodyRaw
 *   - `when-worker-message` / `when-worker-error`
 *                              (`when message from <#w> (d) { … }`)          .bodyRaw
 *   - `test`                   (`~{ test "…" { … } }` bodies, before/after)  .testGroup
 *   - `markup`                 an `on*=${ … }` event-handler attribute value — a
 *                              statement body (emit-event-wiring Case C). Only a
 *                              DIRECT `defer` is reported here; one inside an
 *                              arrow / function expression in the value is the
 *                              lambda check's (anyDepth: false).
 * A non-handler attribute value is an EXPRESSION position, where `defer` is an
 * ordinary identifier (§19.16.1) — not listed. Match / `!{}` arm bodies and bare
 * blocks carried as text are `textBodiesOf` (above); `on mount { }` is the
 * `_onMountEffect` bare-expr; lambda bodies are the escape-hatch / `lambda` check.
 */
export type LoweredTextBody = { text: string; label: string; anyDepth: boolean };

const WHEN_TEXT_KINDS = new Set(["when-effect", "when-message", "when-worker-message", "when-worker-error"]);

export function isWhenTextKind(kind: unknown): boolean {
  return typeof kind === "string" && WHEN_TEXT_KINDS.has(kind);
}

export function textLoweredBodiesOf(n: Node): LoweredTextBody[] {
  const out: LoweredTextBody[] = [];
  const k = n.kind;
  if (isWhenTextKind(k) && typeof n.bodyRaw === "string") {
    const label = k === "when-effect" ? "a `when … changes { }` body" : "a `when message { }` handler body";
    out.push({ text: n.bodyRaw as string, label, anyDepth: true });
  }
  if (k === "test" && n.testGroup && typeof n.testGroup === "object") {
    const g = n.testGroup as { tests?: Array<{ body?: unknown }>; before?: unknown; after?: unknown };
    const lines = (v: unknown): string | null =>
      Array.isArray(v) ? v.filter((s) => typeof s === "string").join("\n") : (typeof v === "string" ? v : null);
    for (const t of Array.isArray(g.tests) ? g.tests : []) {
      const body = t ? lines(t.body) : null;
      if (body) out.push({ text: body, label: "a `test` body", anyDepth: true });
    }
    for (const v of [g.before, g.after]) {
      const body = lines(v);
      if (body) out.push({ text: body, label: "a test `before` / `after` body", anyDepth: true });
    }
  }
  if (k === "markup" && Array.isArray(n.attrs)) {
    for (const a of n.attrs as Node[]) {
      if (!a || typeof a.name !== "string" || !/^on[a-z]/i.test(a.name as string)) continue;
      const v = a.value as Node | undefined;
      if (v && v.kind === "expr" && typeof v.raw === "string") {
        out.push({ text: v.raw as string, label: `an event-handler attribute (\`${a.name}=\${ … }\`)`, anyDepth: false });
      }
    }
  }
  return out;
}
