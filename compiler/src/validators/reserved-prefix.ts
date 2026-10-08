/**
 * Reserved `_scrml_` and `__scrml_` identifier prefixes — SPEC §47.1.1, S439
 * ruling #7 + S440 ruling #9 (`_scrml_`), S457 ruling "a for __scrml_".
 *
 *   E-NAME-COLLIDES-RESERVED-PREFIX (Error)
 *
 * A user-authored scrml program SHALL NOT declare a binding whose name begins
 * with `_scrml_` or `__scrml_`, and SHALL NOT reference such a name: `_scrml_`
 * names the compiler's own emitted identifiers and the runtime's
 * (`_scrml_reactive_set`, `_scrml_sql`, `_scrml_session_destroy`, ...);
 * `__scrml_` names the compiler's internal placeholders and locals.
 * Standard-library source (the `stdlib/` tree this compiler ships with) is
 * exempt BY PATH.
 *
 * THE COMPILER'S OWN PLACEHOLDERS (S457). The expression parser writes its
 * placeholders into the tree this check walks (inside escape-hatch raw text,
 * as the `!{}` handler marker call, as a masked `.Variant`). Every one carries
 * the per-process unguessable nonce of placeholder-nonce.ts and is exempt by
 * that nonce (`isCompilerPlaceholderName`) — nothing an author can spell. An
 * author-typed `__scrml_match__` is flagged here, and in any position this walk
 * does not inspect it is still inert: every recogniser matches only the nonce'd
 * form, so it is lowered by nothing and the §2.2.1 emit gate refuses it.
 *
 * WHY IT IS A SECURITY RULE. Every `?{}` safety floor — the §14.8.10 tenant
 * filter, the §14.8.9 protect tagging, the transaction gate — is armed at the
 * `?{}` LOWERING. The driver handle those lowerings call (`_scrml_sql`) is an
 * ordinary identifier in the emitted server module, so before this check an
 * author's `return _scrml_sql.unsafe("SELECT body FROM notes")` compiled clean
 * and called the raw driver with no floor at all.
 *
 * WHERE IT RUNS. Post-TAB, per file, on the AUTHOR's tree (api.js, beside the
 * §19.9.8 async/await reject and the redeclare check). Running here — and not
 * inside the AST builder — matters: the compiler re-runs `buildAST` on text it
 * SYNTHESIZES (component bodies, engine arms, match arms, the implied-lift
 * desugar) and that text legitimately carries `_scrml_` names. Only the
 * pipeline's own TAB call sees author source exactly once, before any stage
 * has lowered anything.
 *
 * HOW IT DECIDES (Rule 7 — the parsed tree, never a regex over source text):
 *   1. Parsed nodes. Every `ident` ExprNode (bare and `@`-sigil reads), every
 *      dot-member property name, and every name-bearing field of a declaration
 *      node (let/const/lin/tilde, state cells, function/fn names, parameters,
 *      lambda parameters, destructuring binders, loop variables, `<each as>`,
 *      arm payload binders, import/export names, component / engine / type
 *      names, markup tag references, labels, call-ref handler names).
 *   2. Raw-captured regions. Several constructs survive TAB only as raw text —
 *      component bodies, `<engine>` rules and message arms, `<match>` arm
 *      openers, `<each>` openers, endpoint / onchange arms, type bodies,
 *      parameter defaults, test assertions, unparseable expressions
 *      (escape-hatch), template-literal and SQL `${}` interpolations. Each is
 *      handed to the SAME sub-parser the compiler later uses for it
 *      (`parseComponentBody`, `parseEngineStateChildren`, `parseMatchArms`,
 *      `buildAST`), and logic-grammar fragments are lexed with the scrml logic
 *      tokenizer — whose STRING / COMMENT tokens are not identifiers, so a
 *      `"_scrml_x"` string or a `// _scrml_x` comment never fires.
 *
 * WHAT IS NOT INSPECTED (limits — stated, not hidden):
 *   - `_{}` foreign code is OPAQUE (§23.2.3): the compiler never tokenizes its
 *     interior, so neither does this check. Its `in: { … }` crossing HEADER is
 *     scrml-side grammar and IS checked (§23.2.4a).
 *   - String literals are values, not names: `obj["_scrml_x"]` is not a
 *     reference under this rule.
 *   - Object-literal KEYS are not checked. A key declares a property of a value
 *     (no binding, no scope), and the tree cannot tell `{ _scrml_k: 1 }` from
 *     `{ "_scrml_k": 1 }` — flagging one and not the other is not decidable on
 *     the parsed tree.
 *   - Type-annotation expressions (`let x: T`) are not lexed: types are erased
 *     and never become emitted identifiers; a `_scrml_` TYPE NAME is refused at
 *     its declaration.
 *   - Markup text, CSS, SQL text, comments, attribute NAMES and the literal text
 *     of a quoted attribute value are not names (a quoted value's `${}`
 *     interpolations ARE checked).
 *
 * @module validators/reserved-prefix
 */
import type { FileAST, Span } from "../types/ast.ts";
import { tokenizeLogic } from "../tokenizer.ts";
import { tokenizeTemplateInterpolations } from "../expression-parser.ts";
import { parseEngineStateChildren } from "../engine-statechild-parser.ts";
import { parseMatchArms } from "../match-statechild-parser.ts";
import { parseComponentBody } from "../component-expander.ts";
import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { isStdlibSourceFile } from "../module-resolver.js";
import { isCompilerPlaceholderName } from "../placeholder-nonce.ts";

/**
 * The shared substring of both reserved prefixes (`__scrml_` contains it) —
 * the cheap pre-filter before any lexing.
 */
export const RESERVED_NAME_PREFIX = "_scrml_";

/** The reserved identifier prefixes (§47.1.1); the longer is tested first. */
export const RESERVED_NAME_PREFIXES = ["__scrml_", "_scrml_"] as const;

/** The reserved prefix `name` begins with, or null. */
export function reservedPrefixOf(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const bare = name.startsWith("@") ? name.slice(1) : name;
  for (const p of RESERVED_NAME_PREFIXES) if (bare.startsWith(p)) return p;
  return null;
}

export const RESERVED_PREFIX_CODE = "E-NAME-COLLIDES-RESERVED-PREFIX";

export interface ReservedPrefixDiagnostic {
  code: typeof RESERVED_PREFIX_CODE;
  message: string;
  span: Span;
  severity: "error";
}

/**
 * True iff `name` (an identifier, optionally `@`-sigilled) begins with
 * `_scrml_` or `__scrml_` — and is not one of THIS compilation's own
 * placeholders (which carry the unguessable nonce, placeholder-nonce.ts).
 */
export function isReservedPrefixName(name: unknown): boolean {
  return reservedPrefixOf(name) !== null && !isCompilerPlaceholderName(name);
}

/**
 * Is `filePath` exempt (a scrml standard-library source file)? Delegates to the
 * module resolver's canonical, symlink- and separator-robust predicate.
 */
export function isReservedPrefixExemptPath(filePath: string | null | undefined): boolean {
  return isStdlibSourceFile(filePath ?? "");
}

/**
 * The diagnostic message. Names the identifier, says what the prefix is
 * reserved for, and how to fix it.
 */
export function reservedPrefixMessage(name: string): string {
  const bare = name.startsWith("@") ? name.slice(1) : name;
  const prefix = reservedPrefixOf(bare) ?? RESERVED_NAME_PREFIX;
  // Rule 7: inspects the identifier being reported (message wording), not source text.
  const rest = bare.slice(prefix.length).replace(/_+$/, "");
  const suggestion = rest.length > 0 && /^[A-Za-z$]/.test(rest) ? rest : `my${rest || "Name"}`;
  return (
    `${RESERVED_PREFIX_CODE}: \`${bare}\` begins with \`${prefix}\`, a prefix ` +
    `reserved for the compiler's and the runtime's own names (SPEC §47.1.1). A scrml program ` +
    `may neither declare nor reference a name with this prefix — a reference would reach a ` +
    `compiler-internal binding (for example the raw database handle) around the checks the ` +
    `compiler applies. Rename it (for example \`${suggestion}\`).`
  );
}

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

/**
 * Name-bearing string fields on a KIND-BEARING node. Each holds one identifier
 * (or a dotted `@cell.method` path, or an array of identifiers).
 */
const NAME_KEYS = new Set<string>([
  "name", "bindName", "rest", "variable", "asName", "asNames",
  "exportedName", "varName", "engineName", "varNameOverride", "names",
  "local", "imported", "exported", "sourceVar", "initialCell",
  "label", "variables", "governedType", "forType", "acceptsType",
  "stateType", "parentState", "enumType", "variant", "variantName",
  "initialVariant", "fieldName",
]);

/**
 * Plain (kind-less) sub-objects that carry a binding `name` — keyed by the
 * array they live in. (Attribute objects also have a `name`, but an attribute
 * NAME is not a scrml name, so `attrs` is deliberately absent.)
 */
const NAMED_CONTAINERS = new Set<string>([
  "params", "specifiers", "renames", "typedAttrs", "propsDecl", "endpoints",
  "payloadBindings",
]);
const CONTAINER_NAME_KEYS = ["name", "local", "imported", "exported", "field"] as const;

/** Raw-text fields that hold LOGIC-grammar scrml (no parsed twin exists). */
const RAW_LOGIC_KEYS = new Set<string>([
  "inExprRaw", "ofExprRaw", "keyExprRaw", "onExprRaw", "openerEffect",
  "serverSource", "inlineMatchBody", "shorthandBodyRaw", "payloadBindingsRaw",
  "effectRaw", "ifExprRaw", "lhs", "rhs",
]);

/**
 * Raw-text fields that have a parsed ExprNode TWIN. The raw is lexed only when
 * the twin is absent (a parse that fell back to text) — otherwise the twin is
 * walked and the raw would only duplicate it.
 */
const RAW_TWIN: Record<string, string[]> = {
  expr: ["exprNode"],
  init: ["initExpr", "matchExpr"],
  condition: ["condExpr"],
  iterable: ["iterExpr"],
  header: ["headerExpr"],
  value: ["valueExpr"],
  result: ["resultExpr"],
  handler: ["handlerExpr"],
  callback: ["callbackExpr"],
  ifRaw: ["ifCond"],
  derivedExprText: ["derivedExprNode"],
  defaultValue: [],
  binding: [],
  test: [],
};

/** Node kinds whose subtree is never inspected. */
const OPAQUE_KINDS = new Set<string>(["comment", "text"]);

/** Node kinds whose string fields are not scrml names (CSS). */
const CSS_KINDS = new Set<string>(["css-inline", "style", "theme-decl"]);

/**
 * ExprNode kinds. An expression's own span is offset-accurate but its `line` /
 * `col` are expression-relative, so a report inside an expression uses the
 * enclosing statement / declaration span (which carries the real line).
 */
const EXPR_KINDS = new Set<string>([
  "ident", "lit", "array", "object", "spread", "unary", "binary", "assign",
  "ternary", "member", "index", "call", "new", "lambda", "cast", "match-expr",
  "map-lit", "sql-ref", "input-state-ref", "escape-hatch", "markup-value",
  "reset-expr", "prop", "shorthand",
]);

// Rule 7: tests the shape of a NAME FIELD the tree already isolated (is it one
// identifier / dotted path, or a binder list to lex?) — not source text.
const IDENT_SHAPE = /^@?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

const MAX_REPARSE_DEPTH = 8;

/**
 * Names the AST BUILDER itself writes into the author tree. TAB desugars the
 * §36 / §6.7.7 `<#name>` reference syntax by TEXT replacement before it
 * tokenizes (`ast-builder.js` `preprocessWorkerAndStateRefs`, `tokenizer.ts`
 * ATTR_CALL / ATTR_IDENT): `<#w>.send(...)` becomes `_scrml_worker_w.send(...)`
 * and `<#feed>` becomes `_scrml_input_feed_`. Those references are the
 * compiler's, not the author's, and are exempt — in REFERENCE position only (the
 * desugar never synthesizes a declaration). The shapes are exact: the
 * `_scrml_input_` form always ends in the desugar's `_`, so it can never spell a
 * runtime helper (`_scrml_input_state_registry`, `_scrml_input_mouse_create`).
 * Limit: an author who literally types the desugared spelling of a `<#name>`
 * reference is indistinguishable after TAB and is not flagged — that reaches
 * exactly the object `<#name>` reaches, nothing more.
 * (Rule 7: these regexes test a NAME the tree already isolated, not source text.)
 */
const TAB_DESUGARED_WORKER_REF = /^_scrml_worker_[A-Za-z_$][\w$]*$/;
const TAB_DESUGARED_INPUT_REF = /^_scrml_input_[A-Za-z_$][\w$]*_$/;

export function isTabDesugaredReference(name: string): boolean {
  const bare = name.startsWith("@") ? name.slice(1) : name;
  return TAB_DESUGARED_WORKER_REF.test(bare) || TAB_DESUGARED_INPUT_REF.test(bare);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

class Collector {
  readonly diagnostics: ReservedPrefixDiagnostic[] = [];
  private readonly seen = new Set<string>();
  /**
   * While walking a RE-PARSED fragment (whose spans are fragment-relative), every
   * report is pinned to the owning node's span in the real file.
   */
  pin: Span | undefined = undefined;
  constructor(readonly filePath: string) {}

  report(name: string, span: Span | undefined): void {
    const bare = name.startsWith("@") ? name.slice(1) : name;
    const use = this.pin ?? span;
    const sp: Span = use && typeof use.start === "number"
      ? use
      : { file: this.filePath, start: 0, end: 0, line: 1, col: 1 };
    const key = `${sp.file ?? this.filePath}|${sp.line}|${bare}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.diagnostics.push({
      code: RESERVED_PREFIX_CODE,
      message: reservedPrefixMessage(bare),
      span: sp,
      severity: "error",
    });
  }

  /** A name field — a single identifier or a dotted path (`@cell.advance`). */
  checkName(value: unknown, span: Span | undefined, isReference = false): void {
    if (typeof value !== "string" || !value) return;
    if (!value.includes(RESERVED_NAME_PREFIX)) return;
    if (isReference && isTabDesugaredReference(value.split(".")[0]!)) return;
    if (!IDENT_SHAPE.test(value)) {
      // Not a bare name (e.g. `"msg, name"` binder lists) — lex it.
      this.scanLogicText(value, span);
      return;
    }
    for (const seg of value.split(".")) {
      if (isReservedPrefixName(seg)) this.report(seg, span);
    }
  }

  /**
   * Lex a logic-grammar fragment with the scrml logic tokenizer and report
   * every identifier token with the prefix. STRING and COMMENT tokens are not
   * identifiers; a template literal's `${}` interpolations are lexed in turn.
   */
  scanLogicText(text: unknown, span: Span | undefined, depth = 0): void {
    if (typeof text !== "string" || !text.includes(RESERVED_NAME_PREFIX)) return;
    if (depth > MAX_REPARSE_DEPTH) return;
    let tokens: Array<{ kind: string; text: string; isTemplate?: boolean }>;
    try {
      tokens = tokenizeLogic(text, 0, 1, 1, []) as typeof tokens;
    } catch {
      return;
    }
    for (const tok of tokens) {
      if (tok.kind === "IDENT" || tok.kind === "AT_IDENT" || tok.kind === "KEYWORD") {
        if (isReservedPrefixName(tok.text)) this.report(tok.text, span);
      } else if (tok.kind === "STRING" && tok.isTemplate) {
        this.scanTemplate(tok.text, span, depth + 1);
      }
    }
  }

  /** The `${}` interpolations of a template literal (or SQL body). */
  scanTemplate(raw: unknown, span: Span | undefined, depth = 0): void {
    if (typeof raw !== "string" || !raw.includes("${") || !raw.includes(RESERVED_NAME_PREFIX)) return;
    for (const seg of tokenizeTemplateInterpolations(raw)) {
      if (seg.kind === "expr") this.scanLogicText(seg.text, span, depth + 1);
    }
  }
}

function spanOf(n: Record<string, unknown> | null | undefined, fallback: Span | undefined): Span | undefined {
  const s = n && (n.span as Span | undefined);
  return s && typeof s.start === "number" ? s : fallback;
}

function walk(
  node: unknown,
  c: Collector,
  seen: WeakSet<object>,
  container: string,
  inherited: Span | undefined,
  depth: number,
): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  if (Array.isArray(node)) {
    for (const child of node) {
      if (typeof child === "string") {
        if (NAME_KEYS.has(container)) c.checkName(child, inherited);
        else if (container === "args") c.scanLogicText(child, inherited);
        continue;
      }
      walk(child, c, seen, container, inherited, depth);
    }
    return;
  }

  const n = node as Record<string, unknown>;
  const kind = typeof n.kind === "string" ? n.kind : null;
  const here = kind !== null && EXPR_KINDS.has(kind) && inherited ? inherited : spanOf(n, inherited);

  if (kind) {
    if (OPAQUE_KINDS.has(kind)) return;

    if (n._handlerParamPrelude === true) {
      // s457 3a — the AST builder's `const <param> = _scrml_event` prelude for an
      // arrow-valued handler (`${(e) => …}`, ast-builder
      // parseArrowHandlerStatements): its INIT is the compiler's own listener
      // parameter, not author text. The declared binder IS the author's
      // parameter and is checked like any other.
      walk({ ...n, init: undefined, initExpr: undefined, _handlerParamPrelude: undefined }, c, seen, container, inherited, depth);
      return;
    }

    if (kind === "foreign" || kind === "Foreign") {
      // §23.2.3 — the foreign BODY is opaque and is not inspected. The `in: { … }`
      // crossing HEADER is scrml-side grammar (§23.2.4a): its names are scrml
      // bindings handed into the slice — the designated crossing point — so a
      // `_scrml_` name there would carry a compiler binding across. The AST
      // builder already parsed the header into `crossings`.
      for (const name of Array.isArray(n.crossings) ? n.crossings : []) c.checkName(name, here, true);
      return;
    }
    if (kind === "string-literal") {
      // A QUOTED attribute value. Its literal text is not a name, but codegen
      // evaluates a `${}` interpolation inside it (`style="color: ${x}"`), so the
      // interpolations are lexed — via the compiler's own interpolation splitter.
      c.scanTemplate(n.value, here, depth);
      return;
    }

    if (kind === "ident") {
      if (isReservedPrefixName(n.name) && !isTabDesugaredReference(n.name as string)) {
        c.report(n.name as string, here);
      }
      return;
    }
    if (kind === "lit") {
      if (n.litType === "template" || (typeof n.raw === "string" && (n.raw as string).startsWith("`"))) {
        c.scanTemplate(n.raw, here, depth);
      }
      return;
    }
    if (kind === "escape-hatch") {
      // Unparsed code that codegen will emit as text — lex it.
      c.scanLogicText(n.raw, here, depth);
      return;
    }
    if (kind === "sql") {
      // SQL text is not scrml; its `${}` interpolations are.
      c.scanTemplate(n.query, here, depth);
    }
    if (kind === "member") {
      if (typeof n.property === "string" && isReservedPrefixName(n.property)) c.report(n.property, here);
    }
    if (kind === "markup" && typeof n.tag === "string" && isReservedPrefixName(n.tag)) {
      c.report(n.tag, here);
    }
    if (kind === "component-def" && typeof n.raw === "string") {
      reparseMarkupBody(n.raw, String(n.name ?? "Component"), c, here, depth);
    }
    if (kind === "html-fragment" && typeof n.content === "string") {
      reparseMarkupBody(n.content, "html-fragment", c, here, depth);
    }
    if (kind === "type-decl" && typeof n.raw === "string") {
      // Struct field names, enum variant names and payload field names.
      c.scanLogicText(n.raw, here, depth);
    }
    if (kind === "match-block" && typeof n.armsRaw === "string") {
      scanMatchArms(n.armsRaw, c, here, depth);
    }
    if (kind === "engine-decl" && typeof n.rulesRaw === "string") {
      scanEngineRules(n.rulesRaw, c, here, depth);
    }
    if (kind === "bare-expr" && !n.exprNode && typeof n.expr === "string") {
      c.scanLogicText(n.expr, here, depth);
    }
    if (kind === "expr" && !n.exprNode && typeof n.raw === "string") {
      // An attribute `${…}` value with no parsed twin — the native-parser shape a
      // re-parsed COMPONENT body produces (`{kind:"expr", raw}`). Lex the raw.
      c.scanLogicText(n.raw, here, depth);
    }
  }

  const isCss = kind !== null && CSS_KINDS.has(kind);
  const namedContainer = kind === null && NAMED_CONTAINERS.has(container);

  for (const key of Object.keys(n)) {
    if (key === "span" || key === "kind" || key === "parent" || key.startsWith("_")) continue;
    const v = n[key];
    if (typeof v === "string") {
      if (!v.includes(RESERVED_NAME_PREFIX) || isCss) continue;
      if (kind !== null && NAME_KEYS.has(key)) {
        // `call-ref` / `variable-ref` names are REFERENCES (an attribute's
        // `onclick=fn()` / `if=name`) — the only name fields the `<#name>`
        // desugar writes into.
        c.checkName(v, here, key === "name" && (kind === "call-ref" || kind === "variable-ref"));
        continue;
      }
      if (namedContainer && (CONTAINER_NAME_KEYS as readonly string[]).includes(key)) { c.checkName(v, here); continue; }
      if (RAW_LOGIC_KEYS.has(key)) { c.scanLogicText(v, here, depth); continue; }
      if (key === "bodyRaw" && (container === "arms")) { c.scanLogicText(v, here, depth); continue; }
      if (key === "body" && container === "tests") { c.scanLogicText(v, here, depth); continue; }
      if (key === "raw" && container === "asserts") { c.scanLogicText(v, here, depth); continue; }
      const twins = RAW_TWIN[key];
      if (twins && !twins.some((t) => n[t] && typeof n[t] === "object")) {
        c.scanLogicText(v, here, depth);
      }
      continue;
    }
    if (v && typeof v === "object") {
      if (Array.isArray(v) && key === "args" && n.argExprNodes) {
        walk(n.argExprNodes, c, seen, "argExprNodes", here, depth);
        continue;
      }
      if (Array.isArray(v) && key === "body" && container === "tests") {
        // `~{}` test bodies are a list of raw statement strings.
        for (const line of v) c.scanLogicText(line, here, depth);
        continue;
      }
      walk(v, c, seen, key, here, depth);
    }
  }
}

/** A raw markup body (component definition, html fragment) — the CE parse. */
function reparseMarkupBody(raw: string, label: string, c: Collector, span: Span | undefined, depth: number): void {
  if (!raw.includes(RESERVED_NAME_PREFIX) || depth >= MAX_REPARSE_DEPTH) return;
  let nodes: unknown[] = [];
  try {
    nodes = parseComponentBody(raw, label, c.filePath).nodes as unknown[];
  } catch {
    nodes = [];
  }
  if (nodes.length === 0) {
    // The body did not re-parse as markup: lex it so nothing is skipped silently.
    c.scanLogicText(raw, span, depth + 1);
    return;
  }
  // Spans inside the re-parse are relative to the fragment — report at the
  // definition's own span.
  walkDetached(nodes, c, span, depth + 1);
}

/** Walk a re-parsed subtree, pinning every report to the owning node's span. */
function walkDetached(nodes: unknown, c: Collector, span: Span | undefined, depth: number): void {
  const outer = c.pin;
  if (!outer) c.pin = span;
  try {
    walk(nodes, c, new WeakSet(), "nodes", span, depth);
  } finally {
    c.pin = outer;
  }
}

/** `<match>` arm openers: payload binders, `rule=`/attr values, `:` shorthand bodies. */
function scanMatchArms(armsRaw: string, c: Collector, span: Span | undefined, depth: number): void {
  if (!armsRaw.includes(RESERVED_NAME_PREFIX)) return;
  let arms: ReturnType<typeof parseMatchArms>["arms"] = [];
  try { arms = parseMatchArms(armsRaw).arms; } catch { arms = []; }
  for (const arm of arms) {
    c.checkName(arm.variantName, span);
    c.scanLogicText(arm.payloadBindingsRaw, span, depth);
    for (const a of arm.attrs ?? []) c.scanLogicText(a.valueRaw, span, depth);
    // bare-body arms are already parsed into `armBodyChildren` (walked); the
    // `:` shorthand body is a single expression that survives only as text.
    if (arm.bodyForm === "shorthand") c.scanLogicText(arm.bodyRaw, span, depth);
  }
}

/**
 * `<engine>` rules: the render bodies are parsed into `bodyChildren` (walked);
 * the state-child openers, `:` shorthand bodies, `effect=`, message arms,
 * `<onTransition>` bodies and nested engines survive only as text.
 */
function scanEngineRules(rulesRaw: string, c: Collector, span: Span | undefined, depth: number): void {
  if (!rulesRaw.includes(RESERVED_NAME_PREFIX) || depth >= MAX_REPARSE_DEPTH) return;
  let entries: ReturnType<typeof parseEngineStateChildren> = [];
  try { entries = parseEngineStateChildren(rulesRaw); } catch { entries = []; }
  for (const e of entries as unknown as Array<Record<string, any>>) {
    c.checkName(e.tag, span);
    for (const b of e.payloadBindings ?? []) { c.checkName(b?.name, span); c.checkName(b?.field, span); }
    if (e.isColonShorthand) c.scanLogicText(e.bodyRaw, span, depth);
    c.scanLogicText(e.effectRaw, span, depth);
    for (const arm of e.messageArms ?? []) {
      c.checkName(arm.variantName, span);
      c.scanLogicText(arm.payloadBindingsRaw, span, depth);
      c.scanLogicText(arm.bodyRaw, span, depth);
    }
    for (const t of e.onTransitionElements ?? []) {
      c.scanLogicText(t.ifExprRaw, span, depth);
      c.scanLogicText(t.bodyRaw, span, depth);
    }
    for (const t of e.onTimeoutElements ?? []) c.scanLogicText(t.after, span, depth);
    for (const inner of e.innerEngines ?? []) {
      if (typeof inner?.rawText !== "string" || !inner.rawText.includes(RESERVED_NAME_PREFIX)) continue;
      let innerNodes: unknown[] = [];
      try {
        innerNodes = (buildAST(splitBlocks(c.filePath, inner.rawText)) as { ast?: { nodes?: unknown[] } }).ast?.nodes ?? [];
      } catch { innerNodes = []; }
      if (innerNodes.length === 0) c.scanLogicText(inner.rawText, span, depth + 1);
      else walkDetached(innerNodes, c, span, depth + 1);
    }
  }
}

/**
 * Run the §47.1.1 reserved-prefix check over one file's author AST.
 * Returns `[]` for a scrml standard-library source file (exempt by path).
 */
export function runReservedPrefixCheck(ast: FileAST | null | undefined): ReservedPrefixDiagnostic[] {
  if (!ast) return [];
  const filePath = ast.filePath ?? "";
  if (isReservedPrefixExemptPath(filePath)) return [];
  const c = new Collector(filePath);
  const seen = new WeakSet<object>();
  walk(ast.nodes ?? [], c, seen, "nodes", undefined, 0);
  // Hoisted imports/exports are the same node objects as in `nodes` (the
  // `seen` guard makes a second visit free) — walked so a hoist-only shape
  // is still covered.
  walk((ast as unknown as Record<string, unknown>).imports ?? [], c, seen, "imports", undefined, 0);
  walk((ast as unknown as Record<string, unknown>).exports ?? [], c, seen, "exports", undefined, 0);
  return c.diagnostics;
}
