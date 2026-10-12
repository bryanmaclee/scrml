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
import { isEventHandlerAttrName } from "../multi-statement-scan.ts";
import { isWholeBraceBlock, closingBraceIndex } from "../brace-pair.ts";
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
 * Why a text-carried body was refused (`parseStatementTextDetailed`):
 *   - `code` / `message`: the FIRST fatal diagnostic the front-end raised for the
 *     body — the code the same statement gets at function top level (`switch` →
 *     E-SWITCH-FORBIDDEN, `try` → E-TRY-NOT-IN-SCRML, `throw` →
 *     E-THROW-NOT-IN-SCRML, `for … in` → E-CTRL-011, `let a = 1, b = 2` / `var a` →
 *     E-STMT-MISSING-SEMICOLON, …);
 *   - `code: null`: the front-end raised nothing, but a statement it built holds
 *     text it could not read (a parse-error escape hatch), or an expression it
 *     read only by DROPPING trailing content (`blk: { … }` read as `blk`). `text`
 *     is that content.
 */
export type BodyRefusal = { code: string | null; message: string; text: string };
export type DetailedParsedBody =
  | { ok: true; stmts: unknown[] }
  | { ok: false; refusal: BodyRefusal };

/**
 * Parse a text-carried statement body (a `!{}` handler arm, a value-form
 * `match` arm body) into a statement tree with the same block-splitter +
 * ast-builder front-end codegen uses to re-parse nested arm bodies
 * (`_emitNestedGuardedArmBody`, emit-logic.ts). The body is wrapped in a probe
 * FUNCTION so `return` is grammatical. `{ ok: false }` when the body does not
 * parse cleanly or contains a statement the front-end could not structure
 * (an escape-hatch parse error) — callers fail closed on that.
 *
 * S465 r2 — this IS the function-top-level statement parser (the body is parsed
 * as a function body), so it accepts what a function body accepts. Two statement
 * forms the front-end carries with a parse-error hatch by design are accepted
 * when their content is itself readable:
 *   - a C-style `for` whose init is a declaration (`for (let i = 0; …)`): the
 *     front-end keeps `cStyleParts.initExpr` as the hatch `let i = 0` (a
 *     declaration is not an expression) — see `cStyleInitDeclaration`;
 *   - a bare `{ … }` block statement (SPEC §7.2.2 "Terms"): carried as a
 *     `bare-expr` whose text is the whole block — read by this same function.
 */
export function parseStatementText(text: string, filePath = "defer-probe.scrml"): ParsedBody {
  const r = parseStatementTextDetailed(text, filePath, { lostTrailing: false });
  return r.ok ? r : { ok: false };
}

/**
 * `parseStatementText` with the refusal reason. `opts.lostTrailing` (default
 * true) also refuses a body holding an expression the parser read only by
 * dropping trailing content — the codegen arm reader asks for this; the
 * validators, which need only the tree's shape, keep the lenient reading.
 */
export function parseStatementTextDetailed(
  text: string,
  filePath = "defer-probe.scrml",
  opts: { lostTrailing?: boolean } = {},
): DetailedParsedBody {
  const checkTrailing = opts.lostTrailing !== false;
  let body = text.trim();
  const refuse = (code: string | null, message: string, t: string): DetailedParsedBody =>
    ({ ok: false, refusal: { code, message, text: t } });
  const unparsed = "the body did not parse as a statement list";
  // A handler / arm BLOCK body `{ … }` — codegen treats the braces as the
  // block delimiters (not an object literal); strip exactly that outer pair.
  // S465 r3 — only when a depth scan PROVES the first `{` closes at the last `}`:
  // `{ A }⏎{ B }` is two blocks, and stripping its ends handed the probe
  // ` A }⏎{ B ` — which closed the probe function after A and dropped B.
  if (body.startsWith("{") && body.endsWith("}")) {
    if (!isWholeBraceBlock(body)) return refuse(null, unparsed, body.trim());
    body = body.slice(1, -1);
  }
  const source = "${\nfunction " + PROBE_FN + "() {\n" + body + "\n}\n}";
  try {
    const bs = splitBlocks(filePath + "#defer-probe", source) as { errors?: Array<{ code?: string; message?: string }> };
    if (Array.isArray(bs.errors) && bs.errors.length > 0) {
      const e = bs.errors[0] ?? {};
      return refuse(typeof e.code === "string" ? e.code : null, String(e.message ?? unparsed), body.trim());
    }
    const built = buildAST(bs) as { ast?: unknown; errors?: Array<{ severity?: string; code?: string; message?: string }> };
    const fatal = (built.errors ?? []).filter((e) => !e || e.severity !== "warning");
    if (fatal.length > 0) {
      const e = fatal[0] ?? {};
      return refuse(typeof e.code === "string" ? e.code : null, String(e.message ?? unparsed), body.trim());
    }
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
    // S465 r3 — the probe source is ONE logic block holding ONE node, the probe
    // function. Anything else (a body that closed the probe early, leaving a
    // sibling statement after it) means the body was not read as written:
    // refuse rather than return the probe's partial body.
    const probeFn = soleProbeFunction(built.ast);
    if (probeFn === null) return refuse(null, unparsed, body.trim());
    find(probeFn);
    if (!found) return refuse(null, unparsed, body.trim());
    const bad = unreadableContentIn(found, filePath, checkTrailing);
    if (bad !== null) return refuse(null, unparsed, bad);
    return { ok: true, stmts: found };
  } catch {
    return refuse(null, unparsed, body.trim());
  }
}

/**
 * S465 r3 — the probe function node when the probe source built to exactly one
 * top-level `logic` node whose body is exactly that function; otherwise null.
 */
function soleProbeFunction(ast: unknown): Node | null {
  const a = ast as { nodes?: unknown } | null;
  const nodes = (a && Array.isArray(a.nodes)) ? a.nodes as unknown[] : Array.isArray(ast) ? ast as unknown[] : null;
  if (!nodes) return null;
  const real = nodes.filter((n) => !isBlankText(n));
  if (real.length !== 1) return null;
  const logic = real[0] as Node;
  if (!logic || logic.kind !== "logic" || !Array.isArray(logic.body)) return null;
  const inner = (logic.body as unknown[]).filter((n) => !isBlankText(n));
  if (inner.length !== 1) return null;
  const fn = inner[0] as Node;
  if (!fn || fn.kind !== "function-decl" || fn.name !== PROBE_FN || !Array.isArray(fn.body)) return null;
  return fn;
}

function isBlankText(n: unknown): boolean {
  if (!n || typeof n !== "object") return false;
  const nn = n as Node;
  if (nn.kind === "comment") return true;
  return nn.kind === "text" && typeof nn.value === "string" && !(nn.value as string).trim();
}

/**
 * The first content of a parsed statement tree the front-end could not read
 * (`BodyRefusal`, `code: null`), or null. The two by-design hatches
 * `parseStatementText` documents are accepted when their content reads.
 */
function unreadableContentIn(stmts: unknown, filePath: string, checkTrailing: boolean): string | null {
  let bad: string | null = null;
  const seen = new WeakSet<object>();
  const scan = (n: unknown): void => {
    if (bad !== null || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) scan(c); return; }
    const nn = n as Node;
    if (nn.kind === "escape-hatch" && nn.nativeKind === "ParseError") { bad = String(nn.raw ?? ""); return; }
    if (checkTrailing && exprParser().hasLostTrailingContent(nn)) {
      const r = nn as Record<string, unknown>;
      bad = String(r._s441TrailingText ?? "").trim() || String(r.raw ?? r.name ?? "");
      return;
    }
    if (nn.kind === "for-stmt" && nn.cStyleParts && typeof nn.cStyleParts === "object") {
      const cs = nn.cStyleParts as Record<string, unknown>;
      // The by-design init hatch is accepted when it is a readable declaration.
      if (cStyleInitDeclaration(cs.initExpr) === null) scan(cs.initExpr);
      scan(cs.condExpr);
      scan(cs.updateExpr);
      for (const k of Object.keys(nn)) if (k !== "span" && k !== "cStyleParts") scan(nn[k]);
      return;
    }
    const block = bareBlockText(nn);
    const blocks = block !== null ? [block] : bareBlockSequenceTexts(nn);
    if (blocks !== null) {
      // The by-design bare-block hatch (one block, or S465 r4 several on one line):
      // each body is read by this same parser.
      for (const b of blocks) {
        const inner = parseStatementTextDetailed(b, filePath, { lostTrailing: checkTrailing });
        if (!inner.ok) { bad = inner.refusal.text || b; return; }
      }
      return;
    }
    for (const k of Object.keys(nn)) if (k !== "span") scan(nn[k]);
  };
  scan(stmts);
  return bad;
}

/* eslint-disable @typescript-eslint/no-require-imports */
function exprParser(): {
  parseExprToNode: (t: string, f: string, o: number) => Node;
  hasLostTrailingContent: (n: unknown) => boolean;
  captureTrailingContentWarnings: <T>(fn: () => T) => { result: T };
} {
  return require("../expression-parser.ts");
}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * A bare `{ … }` block statement as the live front-end carries it: a `bare-expr`
 * whose text is the whole block and whose expression view is a parse-error hatch
 * (it is not an object literal). Returns the block text, or null.
 */
export function bareBlockText(n: unknown): string | null {
  if (!n || typeof n !== "object") return null;
  const nn = n as Node;
  if (nn.kind !== "bare-expr" || typeof nn.expr !== "string") return null;
  const t = (nn.expr as string).trim();
  // S465 r3 — a bare-expr `{ A } { B }` is NOT one block (see isWholeBraceBlock).
  if (!isWholeBraceBlock(t)) return null;
  const en = nn.exprNode as Node | undefined;
  if (!en || en.kind !== "escape-hatch" || en.nativeKind !== "ParseError") return null;
  return t;
}

/**
 * S465 r4 — a bare-expr whose text is TWO OR MORE whole `{ … }` blocks on one
 * line (`{ A } { B }`, SPEC §7.2.2 "Terms" — each is its own bare block statement):
 * the block texts in order, or null. The builder keeps the line as one bare-expr
 * (a ParseError escape hatch); the server reads each block on its own.
 */
export function bareBlockSequenceTexts(n: unknown): string[] | null {
  if (!n || typeof n !== "object") return null;
  const nn = n as Node;
  if (nn.kind !== "bare-expr" || typeof nn.expr !== "string") return null;
  const en = nn.exprNode as Node | undefined;
  if (!en || en.kind !== "escape-hatch" || en.nativeKind !== "ParseError") return null;
  const t = (nn.expr as string).trim();
  const blocks: string[] = [];
  let i = 0;
  while (i < t.length) {
    while (i < t.length && /[\s;]/.test(t[i])) i++;
    if (i >= t.length) break;
    if (t[i] !== "{") return null;
    const close = closingBraceIndex(t, i);
    if (close < 0) return null;
    blocks.push(t.slice(i, close + 1));
    i = close + 1;
  }
  return blocks.length >= 2 ? blocks : null;
}

/** Split `text` at its top-level commas (outside brackets, strings and templates). */
function splitTopLevelCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\"" || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

/**
 * A C-style `for` init carried as the front-end's parse-error hatch whose text is
 * a declaration — `let i = 0`, `const n = xs.length`, `let i = 0, j = 1` — read
 * as `{ keyword, declarators }`: one `name = value` assignment ExprNode per
 * declarator. null when the init is not such a hatch, or a declarator does not
 * read cleanly as `IDENT = <expression>`.
 */
export function cStyleInitDeclaration(initExpr: unknown): { keyword: string; declarators: Node[] } | null {
  if (!initExpr || typeof initExpr !== "object") return null;
  const ie = initExpr as Node;
  if (ie.kind !== "escape-hatch" || ie.nativeKind !== "ParseError" || typeof ie.raw !== "string") return null;
  const m = /^\s*(let|const|var)\s+([\s\S]+)$/.exec(ie.raw as string);
  if (!m) return null;
  const ep = exprParser();
  const declarators: Node[] = [];
  for (const part of splitTopLevelCommas(m[2])) {
    const t = part.trim();
    if (!t) return null;
    const { result } = ep.captureTrailingContentWarnings(() => {
      try { return ep.parseExprToNode(t, "<for-init>", 0); } catch { return null; }
    });
    const d = result as Node | null;
    if (!d || d.kind !== "assign" || d.op !== "=" || !d.target || (d.target as Node).kind !== "ident") return null;
    if (ep.hasLostTrailingContent(d) || unreadableContentIn(d, "<for-init>", true) !== null) return null;
    declarators.push(d);
  }
  return declarators.length > 0 ? { keyword: m[1], declarators } : null;
}

/**
 * The text-carried bodies of one node, each as `{ text, label }`:
 *   - `!{}` handler arms (`arms[].handler` of a `guarded-expr` or a statement `!{ … }` `error-effect`);
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
  if ((n.kind === "guarded-expr" || n.kind === "error-effect") && Array.isArray(n.arms)) {
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
      } else if (arm.kind === "match-arm-inline" && typeof arm.result === "string" && !arm.leaveStmt) {
        // (An arm whose body is a §18.2 leave statement carries it as the node
        // `leaveStmt`, which the structural walk reaches; reading its text too
        // would report the same exit twice.)
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
 * Text the lexer / parser cannot process answers `null` (TextProbe): callers
 * fail closed on it (S432 review A-3).
 */
export function textContainsNativeKind(text: string, asExpression: boolean, kinds: readonly string[]): TextProbe {
  const inner = asExpression ? "let __scrml_probe_value__ = " + text : text;
  const body = probeParse("function* __scrml_probe__() {\n" + inner + "\n}");
  if (body === null) return null;
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
  walk(body);
  return found;
}

/**
 * The answer of a text probe: `true` (found), `false` (parsed, not found) or
 * `null` — the text could not be analysed (the lexer / parser threw). S432
 * review A-3: callers FAIL CLOSED on `null` (test `!== false`), reporting that
 * the body could not be verified, never treating it as "no defer here".
 */
export type TextProbe = boolean | null;

/**
 * Test seam (S432 review A-3): run `body` with the probe parser replaced, so a
 * test can make it throw without mocking the parser module process-wide.
 */
let probeParserOverride: ((src: string) => { body: unknown[] }) | null = null;
export function withProbeParserForTest<T>(parser: (src: string) => { body: unknown[] }, body: () => T): T {
  const prev = probeParserOverride;
  probeParserOverride = parser;
  try { return body(); } finally { probeParserOverride = prev; }
}

/** Parse probe source with the native statement parser; `null` when it throws. */
function probeParse(src: string): unknown[] | null {
  if (probeParserOverride) {
    try {
      const t = probeParserOverride(src);
      return Array.isArray(t?.body) ? t.body : null;
    } catch {
      return null;
    }
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { lex } = require("../../native-parser/lex.js") as { lex: (s: string) => unknown[] };
  const { parseProgram } = require("../../native-parser/parse-stmt.js") as {
    parseProgram: (t: unknown[], s: string) => { body: unknown[]; errors: unknown[] };
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  try {
    const tree = parseProgram(lex(src), src);
    return Array.isArray(tree?.body) ? tree.body : null;
  } catch {
    return null;
  }
}

/** Find a `Defer` node whose function-nesting depth satisfies `atDepth` (depth 1 = the probe generator). */
function findDeferAtDepth(body: unknown[], atDepth: (d: number) => boolean): boolean {
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown, depth: number): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c, depth); return; }
    const k = (n as Node).kind;
    if (k === "Defer" && atDepth(depth)) { found = true; return; }
    const d = k === "Arrow" || k === "Function" || k === "FunctionDecl" ? depth + 1 : depth;
    for (const key of Object.keys(n as object)) if (key !== "span") walk((n as Node)[key], d);
  };
  walk(body, 0);
  return found;
}

/**
 * Does expression TEXT contain a `defer` statement INSIDE a function / arrow
 * body (parsed with the native parser; see textContainsNativeKind)? Used for a
 * lambda escape-hatch: a `defer` that is NOT inside a function body in that
 * text (e.g. the escape-hatch of a bare `{ … }` block) is some other site's
 * concern, not a lambda's (S430 round 6, D).
 */
export function textLambdaContainsDefer(text: string): TextProbe {
  if (!text.includes("defer")) return false;
  const body = probeParse("function* __scrml_probe__() {\nlet __scrml_probe_value__ = " + text + "\n}");
  return body === null ? null : findDeferAtDepth(body, (d) => d > 1);
}

/** Does TEXT contain a `defer` statement (parsed; see textContainsNativeKind)? */
export function textContainsDeferStatement(text: string, asExpression: boolean): TextProbe {
  return text.includes("defer") ? textContainsNativeKind(text, asExpression, ["Defer"]) : false;
}

/**
 * Does statement TEXT contain a `defer` statement that is NOT inside a function
 * / arrow body nested in that text (parsed with the native statement parser)?
 * The complement of `textLambdaContainsDefer` for a statement body.
 */
export function textContainsDirectDeferStatement(text: string): TextProbe {
  if (!text.includes("defer")) return false;
  const body = probeParse("function* __scrml_probe__() {\n" + text + "\n}");
  return body === null ? null : findDeferAtDepth(body, (d) => d === 1);
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
 *   (`~{ test … }` bodies are NOT listed — see the note in the function, S446 F1)
 *   - `markup`                 an `on*=${ … }` event-handler attribute value — a
 *                              statement body (emit-event-wiring Case C), lowered
 *                              as text including any function / arrow in it
 *                              (anyDepth; the attribute's own value node is then
 *                              not re-walked under the lambda rule).
 *   - `onchange-decl`          a `<channel>` `<onchange>` arm body          .arms[].bodyRaw
 *   - `component-def.raw` (and an `export const Name = <…>` export-decl's
 *     markup) is markup text, re-parsed and walked by the checker itself
 *     (lint-defer.ts) rather than listed here — its bodies are markup.
 * A non-handler attribute value is an EXPRESSION position, where `defer` is an
 * ordinary identifier (§19.16.1) — not listed. Match / `!{}` arm bodies and bare
 * blocks carried as text are `textBodiesOf` (above); `on mount { }` is the
 * `_onMountEffect` bare-expr; lambda bodies are the escape-hatch / `lambda` check.
 */
export type LoweredTextBody = { text: string; label: string; anyDepth: boolean; owner?: unknown };

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
  // `~{ test … }` bodies (and `before` / `after`) are deliberately NOT probed
  // (S446 review F1): the front-end strips comment openers from
  // `testGroup.tests[].body`, so a comment mentioning `defer` read as a
  // statement and was falsely rejected. Test bodies never reach production
  // output; the comment-stripping defect is filed in known-gaps.
  // A `<channel>` `<onchange>` arm body (§52 — shorthand `<V(row) : stmt>` or a
  // block body): codegen splices the text into the change dispatcher as
  // statements (S446 — a `defer` there reached the client JS verbatim).
  if (k === "onchange-decl" && Array.isArray(n.arms)) {
    for (const a of n.arms as Node[]) {
      if (a && typeof a.bodyRaw === "string" && (a.bodyRaw as string).trim() !== "") {
        out.push({ text: a.bodyRaw as string, label: "a `<channel>` `<onchange>` arm body", anyDepth: true });
      }
    }
  }
  if (k === "markup" && Array.isArray(n.attrs)) {
    for (const a of n.attrs as Node[]) {
      // The repo's event-handler attribute predicate (multi-statement-scan.ts,
      // shared with the ast-builder / type-system handler rules). NB: codegen
      // wires EVERY `on`-prefixed `${ }` attribute as an event binding and
      // lowers its text as statements (emit-html.ts `name.startsWith("on")` ->
      // addEventBinding -> emit-event-wiring rewriteBlockBody), so `one=${ … }`
      // is lowered exactly like `onclick=${ … }`; the predicate matches that.
      if (!a || typeof a.name !== "string" || !isEventHandlerAttrName(a.name as string)) continue;
      const v = a.value as Node | undefined;
      if (v && v.kind === "expr" && typeof v.raw === "string") {
        out.push({ text: v.raw as string, label: `an event-handler attribute (\`${a.name}=\${ … }\`)`, anyDepth: true, owner: v });
      }
    }
  }
  return out;
}
