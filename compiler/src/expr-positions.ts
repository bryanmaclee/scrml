/**
 * expr-positions.ts — THE single table of WHERE user expression source lives on
 * a scrml AST node.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two passes need the same answer to the same question — "which fields of this
 * node carry expression source a reader could reference?" — and for a long time
 * each carried its OWN hand-rolled answer:
 *
 *   - `dependency-graph.ts` (`creditFromAttrValue` + `sweepNodeForAtRefs`) walks
 *     them to credit `@cell` READERS (E-DG-002 accounting + markup-read edges).
 *   - `codegen/client-read-seed.ts` walks them to collect the plain identifiers
 *     CLIENT-emitted code references (the #263/#358 cross-file export-const
 *     reachability seed).
 *
 * Both walk the same `any`-typed AST, so nothing type-checks the two field lists
 * against each other, and they DRIFTED — in both directions. Three adversarial
 * review rounds on `g-263-direct-cross-file-const-import-not-emitted-client` each
 * surfaced MORE positions the seed missed; the missing set grew rather than shrank.
 * That is the converge-not-enumerate signal, and this file is the convergence:
 * ONE table, two consumers. A position added here is seen by both, permanently.
 *
 * WHAT A CONSUMER MUST IMPLEMENT
 * ------------------------------
 * `forEachExprPosition(node, supports, cb)` enumerates the positions of ONE node.
 * `supports` is the set of `ExprPositionKind`s the consumer can read; the
 * enumerator uses it to resolve ALTERNATE groups (see below). Recursion into
 * child nodes stays with each consumer, because they prune differently: the
 * client seed MUST NOT descend into a server-boundary `fn` body or an
 * `isServerOnlyNode` statement (§14.8), while the dependency graph credits reads
 * everywhere.
 *
 * ALTERNATE GROUPS. Some positions carry the same source in more than one
 * representation — an attribute expression is available as a pre-extracted
 * `@cell` name list (`refs`), as a parsed `exprNode`, and as raw `raw` text.
 * A consumer must take exactly ONE, or it double-counts. Alternates are listed in
 * PREFERENCE order and the enumerator hands the consumer the first alternate whose
 * kind is in `supports`, so each consumer gets its own best representation from a
 * single shared declaration.
 *
 * §14.8 DISCIPLINE FOR A CONFIDENTIALITY CONSUMER. The raw kinds
 * (`expr-source` / `block-source`) are SOURCE TEXT. A consumer collecting plain
 * identifiers MUST parse them and walk real ident nodes — a bare identifier regex
 * over raw text reads inside string literals and comments, which is precisely the
 * string-blind leak the #263 AST-precise gate replaced. `template-text` MUST be
 * scanned with `forEachTemplateInterpolation` (escape-aware): an ESCAPED
 * `\${SECRET}` is literal text codegen never wires, and a consumer that believes
 * it IS wired pulls a server-only value into a `.client.js`.
 */

import type { Span } from "./types/ast.ts";

/**
 * How the `value` of an `ExprPosition` must be read.
 *
 *  - `expr-node`      a parsed ExprNode — walk it (`forEachIdentInExprNode`).
 *  - `expr-source`    raw source of ONE scrml expression — parse it, then walk.
 *  - `block-source`   raw source that may hold several statements and/or markup
 *                     (an `<each>` body, `<match>` arms, an engine state-child
 *                     body). Parse iteratively; a parse failure is a fail-closed
 *                     stop, never a regex fallback for an identifier consumer.
 *  - `template-text`  attribute text carrying `${…}` interpolations — scan with
 *                     the escape-aware `forEachTemplateInterpolation`.
 *  - `literal-text`   attribute text with NO code in it. Only a `@`-sigil
 *                     consumer has anything to find here; an identifier consumer
 *                     MUST ignore it.
 *  - `cell-name`      a single reactive-cell name, ALWAYS without the `@` sigil
 *                     and emitted only where the source really names a cell — so
 *                     no consumer has to re-derive "is this a cell?".
 *  - `cell-name-list` an array of reactive-cell names (a pre-extracted `refs`).
 *  - `callee-name`    a call-ref callee, possibly dotted (`utils.handleClick`).
 *                     The BASE segment is a real binding read; the tail segments
 *                     are property names and are never bindings.
 */
export type ExprPositionKind =
  | "expr-node"
  | "expr-source"
  | "block-source"
  | "template-text"
  | "literal-text"
  | "cell-name"
  | "cell-name-list"
  | "callee-name";

/** One position on one AST node. */
export interface ExprPosition {
  kind: ExprPositionKind;
  /** ExprNode for `expr-node`; `string` for the text kinds; `string[]` for
   *  `cell-name-list`. */
  value: unknown;
  /** Stable label naming the field this came from, e.g. `"attr.value.exprNode"`,
   *  `"each.inExprRaw"`, `"engine.stateChild.onTransition.ifExprRaw"`. Consumers
   *  MUST NOT branch on it to decide WHETHER to read a position (that is what
   *  `kind` + `supports` are for); it exists for diagnostics and for policy that
   *  is genuinely positional. */
  origin: string;
  /** The most precise span available for this position, or `null`. */
  span: Span | null;
  /** TRUE when a read found here is a RENDER-context read — i.e. the compiler
   *  wires it into rendered output, so the dependency graph should emit a
   *  markup-read edge for it. FALSE for positions that are credited for
   *  reader-accounting only. */
  render: boolean;
}

type Rec = Record<string, unknown>;

/** ExprNode-valued fields that carry USER identifier references, in one place.
 *  Union of the two consumers' historical lists: `dependency-graph.ts` had
 *  `exprNode/initExpr/condExpr/valueExpr/iterExpr/headerExpr`, the client-read
 *  walker additionally had `testExpr/defaultExpr/subjectExpr/targetExpr/returnExpr`.
 *  The drift ran in BOTH directions; the union is the convergence. */
export const EXPR_NODE_FIELDS: readonly string[] = [
  "exprNode", "initExpr", "condExpr", "valueExpr", "iterExpr", "headerExpr",
  "testExpr", "defaultExpr", "subjectExpr", "targetExpr", "returnExpr",
];

/** Raw single-expression opener fields on the scrml STRUCTURAL elements.
 *  `<each>`/`<engine>`/`<match>` carry no `attrs` array — the block splitter
 *  raw-captures them and the AST builder rebuilds each opener from named
 *  regexes — so these never reach the attribute route. `ifRaw` is deliberately
 *  ABSENT: the `if=` render gate is enumerated from the PARSED `ifCond`, which
 *  is what gives it exactly the markup path's treatment (a raw scan would also
 *  read inside string literals). */
const STRUCTURAL_RAW_EXPR_FIELDS: readonly string[] = [
  "inExprRaw", "ofExprRaw", "keyExprRaw", "onExprRaw", "defaultExprRaw",
];

function isExprNode(v: unknown): boolean {
  return !!v && typeof v === "object" && typeof (v as Rec).kind === "string";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function spanOf(v: unknown): Span | null {
  if (v && typeof v === "object") {
    const s = (v as Rec).span;
    if (s && typeof s === "object") return s as Span;
  }
  return null;
}

/**
 * Enumerate every position on ONE node, resolving alternate groups against
 * `supports`. Does NOT recurse into child nodes — recursion (and its pruning)
 * belongs to the consumer.
 */
export function forEachExprPosition(
  node: unknown,
  supports: ReadonlySet<ExprPositionKind>,
  cb: (position: ExprPosition) => void,
): void {
  if (!node || typeof node !== "object") return;
  const n = node as Rec;
  const nodeSpan = spanOf(n);

  const emit = (
    kind: ExprPositionKind, value: unknown, origin: string,
    span: Span | null, render: boolean,
  ): void => {
    if (!supports.has(kind)) return;
    cb({ kind, value, origin, span, render });
  };

  /** Emit the FIRST alternate whose kind the consumer supports. */
  const emitGroup = (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    span: Span | null, render: boolean,
  ): void => {
    for (const alt of alternates) {
      if (!supports.has(alt.kind)) continue;
      cb({ kind: alt.kind, value: alt.value, origin: alt.origin, span, render });
      return;
    }
  };

  // NOTE — the node's OWN ExprNode-valued fields are NOT enumerated here. They
  // are the exported `EXPR_NODE_FIELDS` list, which each consumer iterates with
  // its own per-field traversal (the dependency graph descends lambda bodies for
  // reader-credit; the client-read collector builds an identifier bag). Sharing
  // the LIST is what closes that half of the drift — it was 6 fields on one side
  // and 11 on the other — while leaving each traversal where it belongs.

  // ---- 1. Attribute values. ----------------------------------------------
  // `attrs` is NOT markup-only: `state` (`<card name=…>`) and
  // `state-constructor-def` carry one too, and an identifier consumer must see
  // those — a `${CONST}` in a typed-state default is a real client read.
  //
  // But `render` IS markup-only, and the distinction is load-bearing. `render`
  // means "the compiler wires this into RENDERED output", which is what makes the
  // dependency graph mint a markup-read node anchored at the position's span. A
  // state DECLARATION is not a render site; anchoring a markup-read there would
  // put a node into a graph other passes consume (closure analysis,
  // `resolveSourceRenderNodeId`) at a span that does not mean what the node's kind
  // says it means. The pre-convergence dependency graph reached `attrs` only from
  // inside its `node.kind === "markup"` branch, and this keeps that topology
  // exactly while still letting the seed read the value.
  if (Array.isArray(n.attrs)) {
    const attrRender = n.kind === "markup";
    for (const attr of n.attrs as unknown[]) {
      if (!attr || typeof attr !== "object") continue;
      const a = attr as Rec;
      // A few AST shapes hang the ExprNode directly on the attr rather than on
      // `attr.value`; cheap to cover and it costs nothing when absent.
      for (const f of EXPR_NODE_FIELDS) {
        if (isExprNode(a[f])) emit("expr-node", a[f], `attr.${f}`, spanOf(a) ?? nodeSpan, attrRender);
      }
      forEachAttrValuePosition(a.value, "attr.value", spanOf(a) ?? nodeSpan, attrRender, supports, cb);
    }
  }

  // ---- 2. The structural `if=` render gate (§17.1.2). ---------------------
  // `<engine>` / `<match>` / `<each>` have no `attrs` array; their `if=`
  // predicate is captured onto the node as `ifCond`, an attr-value-shaped
  // object. It takes the SAME route an attribute value takes — one `if=`
  // lowering deserves one enumeration.
  // The anchor is the NODE span, not `ifCond.span`: the structural caller
  // synthesizes an attr with no span of its own, so this position has always
  // anchored at the node, and a dependency-graph node id is derived from that
  // span.
  // `render` is unconditionally TRUE here even though the owning node is never
  // `markup`: the `if=` gate governs whether the structural element RENDERS, and
  // the pre-convergence dependency graph credited it — with edges — from outside
  // its markup branch for exactly that reason.
  if (n.ifCond && typeof n.ifCond === "object") {
    forEachAttrValuePosition(n.ifCond, "ifCond", nodeSpan, true, supports, cb);
  }

  // ---- 3. Structural opener raw expressions. ------------------------------
  for (const f of STRUCTURAL_RAW_EXPR_FIELDS) {
    if (nonEmptyString(n[f])) emit("expr-source", n[f], f, nodeSpan, true);
  }

  // ---- 4. Raw BODY text of the raw-captured structural elements. ----------
  // `<each>`'s per-item template and `<match>`'s arms are captured as raw text
  // in addition to (partially) walkable children. The raw capture is the ONLY
  // representation for shapes the child rebuild does not reach.
  if (n.kind === "each-block" && nonEmptyString(n.bodyRaw)) {
    emit("block-source", n.bodyRaw, "each.bodyRaw", nodeSpan, true);
  }
  if (n.kind === "match-block" && nonEmptyString(n.armsRaw)) {
    emit("block-source", n.armsRaw, "match.armsRaw", nodeSpan, true);
  }

  // ---- 5. `<engine>` internals. ------------------------------------------
  if (n.kind === "engine-decl") forEachEnginePosition(n, nodeSpan, supports, emit, emitGroup);

  // ---- 6. A multi-statement `on mount` / `on dismount` effect. ------------
  // `mountBodyExprNode` returns undefined for a >1-statement body, so such a
  // node carries NO usable `exprNode` — only the raw `expr` string.
  if (n.kind === "bare-expr" && n._onMountEffect === true &&
      !isExprNode(n.exprNode) && nonEmptyString(n.expr)) {
    emit("block-source", n.expr, "onMount.expr", nodeSpan, false);
  }
}

/**
 * Enumerate the positions of an ATTRIBUTE VALUE object (the payload of
 * `attr.value`, and of the structural `ifCond`). The shapes are the ones
 * `ast-builder.js` `parseAttributes` produces.
 */
function forEachAttrValuePosition(
  attrVal: unknown,
  originBase: string,
  span: Span | null,
  /** Whether reads here are RENDER-context reads — see the call sites. */
  renderBase: boolean,
  supports: ReadonlySet<ExprPositionKind>,
  cb: (position: ExprPosition) => void,
): void {
  const emit = (
    kind: ExprPositionKind, value: unknown, origin: string, render: boolean,
  ): void => {
    if (!supports.has(kind)) return;
    cb({ kind, value, origin, span, render });
  };
  const emitGroup = (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    render: boolean,
  ): void => {
    for (const alt of alternates) {
      if (!supports.has(alt.kind)) continue;
      cb({ kind: alt.kind, value: alt.value, origin: alt.origin, span, render });
      return;
    }
  };

  // A bare unquoted attribute value arrives as a plain string. It is literal
  // text — only a `@`-sigil consumer has anything to find in it.
  if (typeof attrVal === "string") {
    if (attrVal.length > 0) emit("literal-text", attrVal, `${originBase}(text)`, false);
    return;
  }
  if (!attrVal || typeof attrVal !== "object") return;
  const v = attrVal as Rec;

  // `title="box ${@theme}"` — `{kind:"string-literal", value}`. The `${}`
  // interiors are the code; the rest is literal text.
  if (v.kind === "string-literal" && nonEmptyString(v.value) && v.value.includes("${")) {
    emit("template-text", v.value, `${originBase}.template`, false);
  }

  // `attr=@x` / `bind:value=@x` / `attr=someName` — `{kind:"variable-ref", name,
  // exprNode}`. A `@`-sigil consumer wants the cell NAME; an identifier consumer
  // wants the parsed node (which is where a non-`@` binding read lives).
  //
  // NOT gated on `kind !== "call-ref"`: a call-ref's `name` can itself be an
  // `@`-path (`onclick=@src.advance(.B)`), and that has always been a cell read.
  if (nonEmptyString(v.name)) {
    const alternates: Array<{ kind: ExprPositionKind; value: unknown; origin: string }> = [];
    // `cell-name` values are always emitted WITHOUT the `@` sigil, and only when
    // the name really is a cell reference — so a consumer never has to re-derive
    // "is this a cell?" from the string.
    if (v.name.startsWith("@") && v.name.length > 1) {
      alternates.push({ kind: "cell-name", value: v.name.slice(1), origin: `${originBase}.name` });
    }
    if (isExprNode(v.exprNode)) {
      alternates.push({ kind: "expr-node", value: v.exprNode, origin: `${originBase}.exprNode` });
    }
    // Last resort when the parse produced nothing: the raw identifier text.
    alternates.push({ kind: "expr-source", value: v.name, origin: `${originBase}.name(raw)` });
    emitGroup(alternates, renderBase);
  }

  // `if=(@a && @b)` — `{kind:"expr", raw, refs, exprNode}`. `refs` is the AST
  // builder's pre-extracted `@cell` list; `exprNode` is the parse; `raw` is the
  // last-resort text. These are ALTERNATES — taking more than one double-counts.
  {
    const alternates: Array<{ kind: ExprPositionKind; value: unknown; origin: string }> = [];
    if (Array.isArray(v.refs)) {
      alternates.push({ kind: "cell-name-list", value: v.refs, origin: `${originBase}.refs` });
    }
    if (isExprNode(v.exprNode) && v.kind !== "variable-ref") {
      alternates.push({ kind: "expr-node", value: v.exprNode, origin: `${originBase}.exprNode` });
    }
    if (nonEmptyString(v.raw)) {
      alternates.push({ kind: "expr-source", value: v.raw, origin: `${originBase}.raw` });
    }
    if (alternates.length > 0) emitGroup(alternates, renderBase);
  }

  // `onclick=fn(@var, CONST)` — `{kind:"call-ref", name, args, argExprNodes?}`.
  if (v.kind === "call-ref") {
    // The CALLEE. `utils.handleClick` names ONE binding (`utils`) plus property
    // names; `handleClick` names one binding. Both consumers need the callee,
    // for different reasons — the dependency graph credits the called function's
    // transitive reactive reads, the client seed marks the base binding — so it
    // is one position with one kind and two readings.
    if (nonEmptyString(v.name)) {
      emit("callee-name", v.name, `${originBase}.callee`, false);
    }
    // The ARGUMENTS. `argExprNodes` and the raw `args` strings are NOT
    // alternates: `argExprNodes` is `undefined` for the WHOLE call as soon as
    // any single argument fails to parse to a node (an empty argument does it),
    // and then the raw strings are the only representation there is. Emitting
    // both is safe — every consumer here is idempotent on a set.
    if (Array.isArray(v.argExprNodes)) {
      for (const en of v.argExprNodes as unknown[]) {
        if (isExprNode(en)) emit("expr-node", en, `${originBase}.argExprNodes[]`, renderBase);
      }
    }
    if (Array.isArray(v.args)) {
      for (const arg of v.args as unknown[]) {
        if (nonEmptyString(arg)) emit("expr-source", arg, `${originBase}.args[]`, renderBase);
      }
    }
  }
}

/**
 * `<engine>` internals. An engine body is RAW TEXT in the AST; the walkable
 * shape lives on `_record.engineMeta` (populated by the symbol table's
 * state-child parse), which is an OBJECT — invisible to any child recursion that
 * only descends ARRAY-valued fields. That is exactly how an engine state-child
 * body stayed invisible to the client-read walker while the dependency graph
 * scanned it.
 */
function forEachEnginePosition(
  n: Rec,
  nodeSpan: Span | null,
  supports: ReadonlySet<ExprPositionKind>,
  emit: (kind: ExprPositionKind, value: unknown, origin: string, span: Span | null, render: boolean) => void,
  emitGroup: (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    span: Span | null, render: boolean,
  ) => void,
): void {
  // §51.0.J `derived=` — the modern EXPRESSION form. `derivedExprNode` is a
  // parsed ExprNode that is NOT one of `EXPR_NODE_FIELDS` (the field is named
  // `derivedExprNode`, not `derivedExpr`), which is how a const read only in a
  // derived projection reached the client bundle undeclared.
  {
    const alternates: Array<{ kind: ExprPositionKind; value: unknown; origin: string }> = [];
    if (isExprNode(n.derivedExprNode)) {
      alternates.push({ kind: "expr-node", value: n.derivedExprNode, origin: "engine.derivedExprNode" });
    }
    if (nonEmptyString(n.derivedExprText)) {
      alternates.push({ kind: "expr-source", value: n.derivedExprText, origin: "engine.derivedExprText" });
    }
    if (alternates.length > 0) emitGroup(alternates, nodeSpan, true);
  }
  // §51.0.J `derived=match @src { … }` — the arm bodies, raw.
  if (nonEmptyString(n.inlineMatchBody)) {
    emit("block-source", n.inlineMatchBody, "engine.inlineMatchBody", nodeSpan, true);
  }

  const record = n._record as Rec | undefined;
  const meta = record?.engineMeta as Rec | undefined;

  // §51.0.E `initial=@cell` and §52 `server=@source` hydration reads.
  if (nonEmptyString(meta?.initialCell)) {
    emit("cell-name", meta!.initialCell, "engine.initialCell", nodeSpan, true);
  }
  if (nonEmptyString(meta?.serverSource)) {
    // The ROOT segment of a dotted source path is the subscribed cell
    // (`@driver.current_status` → `driver`).
    const root = (meta!.serverSource as string).split(".")[0];
    if (root) emit("cell-name", root, "engine.serverSource", nodeSpan, true);
  }

  const stateChildren = meta?.stateChildren;
  if (Array.isArray(stateChildren) && stateChildren.length > 0) {
    for (const scRaw of stateChildren as unknown[]) {
      if (!scRaw || typeof scRaw !== "object") continue;
      const sc = scRaw as Rec;
      if (nonEmptyString(sc.bodyRaw)) {
        emit("block-source", sc.bodyRaw, "engine.stateChild.bodyRaw", nodeSpan, true);
      }
      if (Array.isArray(sc.onTransitionElements)) {
        for (const otRaw of sc.onTransitionElements as unknown[]) {
          if (!otRaw || typeof otRaw !== "object") continue;
          const ot = otRaw as Rec;
          if (nonEmptyString(ot.bodyRaw)) {
            emit("block-source", ot.bodyRaw, "engine.stateChild.onTransition.bodyRaw", nodeSpan, true);
          }
          // §51.0.H `<onTransition if=expr>` — the transition GUARD. Captured
          // verbatim (it may carry surrounding parens or a `${…}` wrapper).
          if (nonEmptyString(ot.ifExprRaw)) {
            emit("expr-source", unwrapGuardRaw(ot.ifExprRaw), "engine.stateChild.onTransition.ifExprRaw", nodeSpan, true);
          }
        }
      }
      // §51.12.3.1 `<onTimeout after=${expr}unit>` — the computed form.
      if (Array.isArray(sc.onTimeoutElements)) {
        for (const otoRaw of sc.onTimeoutElements as unknown[]) {
          if (!otoRaw || typeof otoRaw !== "object") continue;
          const after = (otoRaw as Rec).after;
          if (nonEmptyString(after)) {
            emit("template-text", after, "engine.stateChild.onTimeout.after", nodeSpan, true);
          }
        }
      }
    }
  } else if (nonEmptyString(n.rulesRaw)) {
    // FALLBACK ONLY. `stateChildren` is the parsed form of `rulesRaw`; scanning
    // both would double-visit every state-child body. When the symbol-table
    // parse has not run (or produced nothing), the raw body is the only source
    // there is.
    emit("block-source", n.rulesRaw, "engine.rulesRaw", nodeSpan, true);
  }

  // §51.0.R `<onIdle after=${expr}unit>` — the engine-wide watchdog.
  const idle = meta?.idleWatchdog as Rec | null | undefined;
  if (idle && nonEmptyString(idle.after)) {
    emit("template-text", idle.after, "engine.idleWatchdog.after", nodeSpan, true);
  }
}

/**
 * `<onTransition if=…>` is captured VERBATIM by the state-child parser, so the
 * value may still be wrapped in `${…}` (logic-context form) or in quotes. Strip
 * exactly those wrappers so the result is a parseable expression; parentheses are
 * left alone (they parse fine).
 *
 * A wrapper is stripped ONLY when the opening delimiter's own match is the LAST
 * character. Checking "starts with X and ends with Y" is not the same test, and
 * the difference is not academic — two adjacent wrappers look exactly like one:
 *
 *     if=${@a} && ${@b}      "starts ${ / ends }"    -> `@a} && ${@b`
 *     if='a' == 'b'          "starts ' / ends '"     -> `a' == 'b`
 *
 * Either mangling makes the guard unparseable, so the identifier consumer drops
 * every read in it (a silent fail-closed under-emit) and the `@`-sigil consumer
 * regex-scans corrupted text. Returning the string UNSTRIPPED is strictly better:
 * the outer form still parses, or fails honestly.
 */
function unwrapGuardRaw(raw: string): string {
  let s = raw.trim();
  // `${…}` — strip only if the brace opened at index 1 is closed at the very end.
  if (s.startsWith("${") && s.endsWith("}")) {
    let depth = 1;
    let i = 2;
    for (; i < s.length && depth > 0; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
    }
    if (depth === 0 && i === s.length) s = s.slice(2, -1).trim();
  }
  // Quotes — strip only if the delimiter does not recur, unescaped, inside.
  const q = s[0];
  if ((q === '"' || q === "'") && s.length >= 2 && s.endsWith(q)) {
    let interiorHasDelim = false;
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === "\\") { i++; continue; }
      if (s[i] === q) { interiorHasDelim = true; break; }
    }
    if (!interiorHasDelim) s = s.slice(1, -1).trim();
  }
  return s;
}
