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
 * (`expr-source` / `statement-source` / `markup-source`) are SOURCE TEXT. A consumer collecting plain
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
 *  - `expr-node`         a parsed ExprNode — walk it (`forEachIdentInExprNode`).
 *  - `expr-source`       raw source of ONE scrml expression — parse it, then walk.
 *  - `statement-source`  raw source that IS client-executed STATEMENTS (an
 *                        `on mount` body, an engine `:`-shorthand state-child
 *                        body). Parse iteratively; a parse failure is a
 *                        fail-closed stop, never a regex fallback.
 *  - `markup-source`     raw source of a RENDERED BODY — literal text with
 *                        `${…}` interpolations in it (an `<each>` body,
 *                        `<match>` arms, a bare-body engine state-child). The
 *                        ONLY code in it is the `${…}` interiors; the rest is
 *                        prose the compiler emits as a text node. An identifier
 *                        consumer MUST read the interiors and nothing else.
 *  - `template-text`     attribute text carrying `${…}` interpolations — scan
 *                        with the escape-aware `forEachTemplateInterpolation`.
 *  - `literal-text`      attribute text with NO code in it. Only a `@`-sigil
 *                        consumer has anything to find here; an identifier
 *                        consumer MUST ignore it.
 *  - `cell-name`         a single reactive-cell name, ALWAYS without the `@`
 *                        sigil and emitted only where the source really names a
 *                        cell — so no consumer has to re-derive "is this a cell?".
 *  - `cell-name-list`    an array of reactive-cell names (a pre-extracted `refs`).
 *  - `callee-name`       a call-ref callee, possibly dotted (`utils.handleClick`).
 *                        The BASE segment is a real binding read; the tail
 *                        segments are property names and are never bindings.
 *
 * `statement-source` and `markup-source` were ONE kind (`block-source`) and a
 * regex — `/^\s*</` — guessed which was which. `<each in=@rows as r>SECRET
 * items</each>` does not start with `<`, so rendered PROSE went to the expression
 * parser and its words became client "reads": a §14.8 leak, and wrapping the same
 * body in `<p>` made it disappear. The AST already knows the answer
 * (`isColonShorthand` on a state-child entry; the field's own identity everywhere
 * else), so the classification is DECLARED at the position site instead of
 * re-derived from the text downstream.
 */
export type ExprPositionKind =
  | "expr-node"
  | "expr-source"
  | "statement-source"
  | "markup-source"
  | "template-text"
  | "literal-text"
  | "cell-name"
  | "cell-name-list"
  | "callee-name";

/**
 * Does the compiler emit CLIENT-EXECUTED code for this position?
 *
 * ═══ THE TWO CONSUMERS ASK DIFFERENT QUESTIONS. THIS FIELD IS THE DIFFERENCE. ═══
 *
 * `dependency-graph.ts` asks **"where does user expression SOURCE appear?"**, so
 * it wants every position regardless of wiring: a `@cell` named in prose that the
 * compiler renders as text is still a consumption for E-DG-002 accounting.
 *
 * `codegen/client-read-seed.ts` asks **"which identifiers does CLIENT-EXECUTED
 * code reference?"**, because its answer decides whether a value is copied into a
 * `.client.js`. Those questions have different answers, and every gap between
 * them was a §14.8 leak: prose that looks like code, an attribute that lowers to
 * a static HTML string, a name that is merely shadowed. Three leaks across two
 * review rounds, all the same mistake at different sites.
 *
 * ═══ AND THE FAILURE DIRECTIONS ARE NOT SYMMETRIC ═══
 *
 * Over-emitting silently ships a secret to a browser. Under-emitting throws a
 * loud `ReferenceError` the adopter can see and report. So `"unknown"` is NOT
 * consumed by the confidentiality gate — a position whose wiring cannot be
 * determined fails CLOSED.
 *
 *  - `"client"`  the compiler emits client-executed code referencing this
 *                position's source, under the extraction its `kind` prescribes.
 *  - `"static"`  the compiler lowers this position to static output (SSR text or
 *                an HTML attribute string). No client-executed code references it.
 *  - `"unknown"` undetermined. Treated as NOT wired by any consumer that cares.
 *
 * Every `"client"` classification below is MEASURED against emitted output, not
 * inferred — see the table above `bareAttrValueIsWired`.
 */
export type WiredClass = "client" | "static" | "unknown";

/** One position on one AST node. */
export interface ExprPosition {
  kind: ExprPositionKind;
  /** ExprNode for `expr-node`; `string` for the text kinds; `string[]` for
   *  `cell-name-list`. */
  value: unknown;
  /** Stable label naming the field this came from, e.g. `"attr.value.exprNode"`,
   *  `"each.inExprRaw"`, `"engine.stateChild.onTransition.ifExprRaw"`. Consumers
   *  MUST NOT branch on it to decide WHETHER to read a position (that is what
   *  `kind` + `supports` + `wired` are for); it exists for diagnostics and for
   *  policy that is genuinely positional. */
  origin: string;
  /** The most precise span available for this position, or `null`. */
  span: Span | null;
  /** TRUE when a read found here is a RENDER-context read — i.e. the compiler
   *  wires it into rendered output, so the dependency graph should emit a
   *  markup-read edge for it. FALSE for positions that are credited for
   *  reader-accounting only. */
  render: boolean;
  /** Whether the compiler emits CLIENT-EXECUTED code for this position. See
   *  `WiredClass` — this is the field a confidentiality consumer gates on, and
   *  `"unknown"` means NOT wired. */
  wired: WiredClass;
}

type Rec = Record<string, unknown>;

/**
 * ExprNode-valued fields that carry USER identifier references, in one place.
 *
 * VERIFIED AGAINST THE AST, not carried. The retired client-read walker's list
 * also contained `testExpr`, `subjectExpr`, `targetExpr` and `returnExpr`; a
 * census of `compiler/src/types/ast.ts` declarations and `ast-builder.js`
 * construction sites finds **zero of each** — the only matches anywhere in
 * `compiler/src` are same-named LOCALS in `emit-expr` / `emit-server` /
 * `emit-reactive-wiring` and a local function in `meta-checker`. They were
 * phantoms, and a phantom is worse in this file than anywhere else: two passes
 * are told to trust it as the single source of truth, so overstated coverage
 * reads exactly like real coverage.
 *
 * Net of the census, the shared list is the dependency graph's historical six
 * plus `defaultExpr` (3 type declarations / 9 construction sites — genuinely
 * real, and genuinely missing from that side).
 */
export const EXPR_NODE_FIELDS: readonly string[] = [
  "exprNode", "initExpr", "condExpr", "valueExpr", "iterExpr", "headerExpr",
  "defaultExpr",
];

/**
 * Raw single-expression opener fields on the scrml STRUCTURAL elements.
 * `<each>`/`<engine>`/`<match>` carry no `attrs` array — the block splitter
 * raw-captures them and the AST builder rebuilds each opener from named regexes
 * — so these never reach the attribute route.
 *
 * `ifRaw` is deliberately ABSENT: the `if=` render gate is enumerated from the
 * PARSED `ifCond`, which is what gives it exactly the markup path's treatment (a
 * raw scan would also read inside string literals).
 *
 * `defaultExprRaw` is also absent, and was a phantom for the same reason as the
 * fields above: it exists only on `ast-builder.js`'s internal `scan` object, and
 * the NODE carries the parsed `defaultExpr` instead.
 */
const STRUCTURAL_RAW_EXPR_FIELDS: readonly string[] = [
  "inExprRaw", "ofExprRaw", "keyExprRaw", "onExprRaw",
];

/**
 * MEASURED: for a BARE (unquoted, non-parenthesized) attribute value — the
 * `variable-ref` shape — does the compiler wire a client reference, or lower it
 * to a static HTML attribute string?
 *
 * Method: compile `<tag ATTR=MARKCONST>` where `MARKCONST` is a client-read
 * export const, compile the same file WITHOUT that element, and diff the count of
 * `MARKCONST` occurrences in the emitted client bundle. A positive delta is a
 * wired reference; zero, with the name appearing in the emitted HTML instead, is
 * static text.
 *
 *     WIRED   if=  ·  onclick=  oninput=  onsubmit=  onchange=  onkeydown=
 *             onmouseover=   (every `on…` handler tested)
 *     STATIC  class=  id=  title=  style=  data-*=  aria-*=  src=  href=
 *             role=  name=  show=  key=  disabled=  checked=  readonly=
 *             value=  placeholder=  hidden=
 *
 * `bind:*=` and `class:*=` reject a bare non-cell value upstream
 * (`E-ATTR-010` / `E-ATTR-013`), so they cannot reach this predicate with one;
 * they are deliberately NOT listed as wired, because the fail-closed direction
 * for an unmeasured name is "not wired".
 *
 * The OTHER value shapes need no name test — all three are wired on every
 * attribute name tested, including plain `class=` / `title=` / `data-x=`:
 * a `call-ref` (`title=X.go()`), a parenthesized `expr` (`title=(X)`), and a
 * `${…}`-bearing quoted string (`title="v-${X}"`).
 */
function bareAttrValueIsWired(attrName: unknown): boolean {
  if (typeof attrName !== "string" || !attrName) return false;
  const n = attrName.toLowerCase();
  return n === "if" || /^on[a-z]/.test(n);
}

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
    span: Span | null, render: boolean, wired: WiredClass,
  ): void => {
    if (!supports.has(kind)) return;
    cb({ kind, value, origin, span, render, wired });
  };

  /** Emit the FIRST alternate whose kind the consumer supports. */
  const emitGroup = (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    span: Span | null, render: boolean, wired: WiredClass,
  ): void => {
    for (const alt of alternates) {
      if (!supports.has(alt.kind)) continue;
      cb({ kind: alt.kind, value: alt.value, origin: alt.origin, span, render, wired });
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
      const wiredBare: WiredClass = bareAttrValueIsWired(a.name) ? "client" : "static";
      for (const f of EXPR_NODE_FIELDS) {
        if (isExprNode(a[f])) emit("expr-node", a[f], `attr.${f}`, spanOf(a) ?? nodeSpan, attrRender, wiredBare);
      }
      forEachAttrValuePosition(a.value, "attr.value", spanOf(a) ?? nodeSpan, attrRender, wiredBare, supports, cb);
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
    // The gate's attribute name IS `if`, which the measured table says wires a
    // bare value — so a bare `if=CONST` on a structural element is wired too.
    forEachAttrValuePosition(n.ifCond, "ifCond", nodeSpan, true, "client", supports, cb);
  }

  // ---- 3. Structural opener raw expressions. ------------------------------
  for (const f of STRUCTURAL_RAW_EXPR_FIELDS) {
    // MEASURED: `<each in=…>` lowers to `const _items = <inExprRaw>` in the
    // client bundle; the key/count/subject openers likewise.
    if (nonEmptyString(n[f])) emit("expr-source", n[f], f, nodeSpan, true, "client");
  }

  // ---- 4. Raw BODY text of the raw-captured structural elements. ----------
  // `<each>`'s per-item template and `<match>`'s arms are captured as raw text
  // in addition to (partially) walkable children. The raw capture is the ONLY
  // representation for shapes the child rebuild does not reach.
  if (n.kind === "each-block" && nonEmptyString(n.bodyRaw)) {
    emit("markup-source", n.bodyRaw, "each.bodyRaw", nodeSpan, true, "client");
  }
  if (n.kind === "match-block" && nonEmptyString(n.armsRaw)) {
    emit("markup-source", n.armsRaw, "match.armsRaw", nodeSpan, true, "client");
  }

  // ---- 5. `<engine>` internals. ------------------------------------------
  if (n.kind === "engine-decl") forEachEnginePosition(n, nodeSpan, supports, emit, emitGroup);

  // ---- 6. A multi-statement `on mount` / `on dismount` effect. ------------
  // `mountBodyExprNode` returns undefined for a >1-statement body, so such a
  // node carries NO usable `exprNode` — only the raw `expr` string.
  if (n.kind === "bare-expr" && n._onMountEffect === true &&
      !isExprNode(n.exprNode) && nonEmptyString(n.expr)) {
    emit("statement-source", n.expr, "onMount.expr", nodeSpan, false, "client");
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
  /** How a BARE (unquoted, non-parenthesized) value on THIS attribute is
   *  lowered — the only shape whose wiring depends on the attribute NAME.
   *  See `bareAttrValueIsWired` for the measured table. */
  bareWired: WiredClass,
  supports: ReadonlySet<ExprPositionKind>,
  cb: (position: ExprPosition) => void,
): void {
  const emit = (
    kind: ExprPositionKind, value: unknown, origin: string, render: boolean, wired: WiredClass,
  ): void => {
    if (!supports.has(kind)) return;
    cb({ kind, value, origin, span, render, wired });
  };
  const emitGroup = (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    render: boolean, wired: WiredClass,
  ): void => {
    for (const alt of alternates) {
      if (!supports.has(alt.kind)) continue;
      cb({ kind: alt.kind, value: alt.value, origin: alt.origin, span, render, wired });
      return;
    }
  };

  // A bare unquoted attribute value arrives as a plain string. It is literal
  // text — only a `@`-sigil consumer has anything to find in it.
  if (typeof attrVal === "string") {
    if (attrVal.length > 0) emit("literal-text", attrVal, `${originBase}(text)`, false, "static");
    return;
  }
  if (!attrVal || typeof attrVal !== "object") return;
  const v = attrVal as Rec;

  // `title="box ${@theme}"` — `{kind:"string-literal", value}`. The `${}`
  // interiors are the code; the rest is literal text. MEASURED wired on every
  // attribute name tested, `class`/`data-*`/`aria-*`/`src`/`style` included: the
  // compiler lowers it to a `setAttribute` effect.
  if (v.kind === "string-literal" && nonEmptyString(v.value) && v.value.includes("${")) {
    emit("template-text", v.value, `${originBase}.template`, false, "client");
  }

  // `attr=@x` / `bind:value=@x` / `attr=someName` — `{kind:"variable-ref", name,
  // exprNode}`. A `@`-sigil consumer wants the cell NAME; an identifier consumer
  // wants the parsed node (which is where a non-`@` binding read lives).
  //
  // THIS IS THE SHAPE WHOSE WIRING DEPENDS ON THE ATTRIBUTE NAME, and getting
  // that wrong shipped a secret: `<p class=SECRET>hello</p>` lowers to the static
  // HTML string `class="SECRET"` with no client wiring at all, yet the value was
  // copied into the client bundle where the declaration was the ONLY line
  // mentioning it. `bareWired` carries the measured answer.
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
    // A call-ref reaching here is the `@`-path form; a call-ref is wired on EVERY
    // attribute name (measured), so it does not take the bare-value classification.
    emitGroup(alternates, renderBase, v.kind === "call-ref" ? "client" : bareWired);
  }

  // `if=(@a && @b)` — `{kind:"expr", raw, refs, exprNode}`. `refs` is the AST
  // builder's pre-extracted `@cell` list; `exprNode` is the parse; `raw` is the
  // last-resort text. These are ALTERNATES — taking more than one double-counts.
  //
  // MEASURED wired on every attribute name tested, `title=(X)` / `class=(X)` /
  // `data-x=(X)` included: the parenthesized form is an EXPRESSION attribute and
  // the compiler emits an effect for it regardless of the attribute's name.
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
    if (alternates.length > 0) emitGroup(alternates, renderBase, "client");
  }

  // `onclick=fn(@var, CONST)` — `{kind:"call-ref", name, args, argExprNodes?}`.
  // MEASURED wired on every attribute name tested, `title=X.go()` /
  // `class=X.go()` / `data-x=X.go()` included.
  if (v.kind === "call-ref") {
    // The CALLEE. `utils.handleClick` names ONE binding (`utils`) plus property
    // names; `handleClick` names one binding. Both consumers need the callee,
    // for different reasons — the dependency graph credits the called function's
    // transitive reactive reads, the client seed marks the base binding — so it
    // is one position with one kind and two readings.
    if (nonEmptyString(v.name)) {
      emit("callee-name", v.name, `${originBase}.callee`, false, "client");
    }
    // The ARGUMENTS. `argExprNodes` and the raw `args` strings are NOT
    // alternates: `argExprNodes` is `undefined` for the WHOLE call as soon as
    // any single argument fails to parse to a node (an empty argument does it),
    // and then the raw strings are the only representation there is. Emitting
    // both is safe — every consumer here is idempotent on a set.
    if (Array.isArray(v.argExprNodes)) {
      for (const en of v.argExprNodes as unknown[]) {
        if (isExprNode(en)) emit("expr-node", en, `${originBase}.argExprNodes[]`, renderBase, "client");
      }
    }
    if (Array.isArray(v.args)) {
      for (const arg of v.args as unknown[]) {
        if (nonEmptyString(arg)) emit("expr-source", arg, `${originBase}.args[]`, renderBase, "client");
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
  emit: (kind: ExprPositionKind, value: unknown, origin: string, span: Span | null, render: boolean, wired: WiredClass) => void,
  emitGroup: (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    span: Span | null, render: boolean, wired: WiredClass,
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
    // MEASURED: `derived=(X == 1 ? .A : .B)` lowers to
    // `const __scrml_derived_v = ((X === 1 ? "A" : "B"));` in the client bundle.
    if (alternates.length > 0) emitGroup(alternates, nodeSpan, true, "client");
  }
  // §51.0.J `derived=match @src { … }` — the arm bodies. A projection body, not
  // statements: its arm targets are VARIANTS, and the only code in it would be a
  // `${…}` interior.
  if (nonEmptyString(n.inlineMatchBody)) {
    emit("markup-source", n.inlineMatchBody, "engine.inlineMatchBody", nodeSpan, true, "client");
  }

  const record = n._record as Rec | undefined;
  const meta = record?.engineMeta as Rec | undefined;

  // §51.0.E `initial=@cell` and §52 `server=@source` hydration reads.
  if (nonEmptyString(meta?.initialCell)) {
    emit("cell-name", meta!.initialCell, "engine.initialCell", nodeSpan, true, "client");
  }
  if (nonEmptyString(meta?.serverSource)) {
    // The ROOT segment of a dotted source path is the subscribed cell
    // (`@driver.current_status` → `driver`).
    const root = (meta!.serverSource as string).split(".")[0];
    if (root) emit("cell-name", root, "engine.serverSource", nodeSpan, true, "client");
  }

  const stateChildren = meta?.stateChildren;
  if (Array.isArray(stateChildren) && stateChildren.length > 0) {
    for (const scRaw of stateChildren as unknown[]) {
      if (!scRaw || typeof scRaw !== "object") continue;
      const sc = scRaw as Rec;
      // A state-child body is EITHER `:`-shorthand (client-executed statements)
      // OR a bare body (a rendered markup body whose only code is its `${…}`
      // interiors). The parser already recorded which, so this is DECLARED from
      // the AST rather than guessed from the text — the guess is what turned
      // `<Title rule=.Playing>SECRET screen</>` into a client "read" of SECRET.
      if (nonEmptyString(sc.bodyRaw)) {
        emit(
          sc.isColonShorthand === true ? "statement-source" : "markup-source",
          sc.bodyRaw, "engine.stateChild.bodyRaw", nodeSpan, true, "client",
        );
      }
      if (Array.isArray(sc.onTransitionElements)) {
        for (const otRaw of sc.onTransitionElements as unknown[]) {
          if (!otRaw || typeof otRaw !== "object") continue;
          const ot = otRaw as Rec;
          if (nonEmptyString(ot.bodyRaw)) {
            emit(
              ot.isColonShorthand === true ? "statement-source" : "markup-source",
              ot.bodyRaw, "engine.stateChild.onTransition.bodyRaw", nodeSpan, true, "client",
            );
          }
          // §51.0.H `<onTransition if=expr>` — the transition GUARD. Captured
          // verbatim (it may carry surrounding parens or a `${…}` wrapper).
          if (nonEmptyString(ot.ifExprRaw)) {
            // MEASURED: the guard lowers to `if (X === 1) { … }` in the client
            // engine substrate.
            emit("expr-source", unwrapGuardRaw(ot.ifExprRaw), "engine.stateChild.onTransition.ifExprRaw", nodeSpan, true, "client");
          }
        }
      }
      // §51.12.3.1 `<onTimeout after=${expr}unit>` — the computed form.
      if (Array.isArray(sc.onTimeoutElements)) {
        for (const otoRaw of sc.onTimeoutElements as unknown[]) {
          if (!otoRaw || typeof otoRaw !== "object") continue;
          const after = (otoRaw as Rec).after;
          if (nonEmptyString(after)) {
            emit("template-text", after, "engine.stateChild.onTimeout.after", nodeSpan, true, "client");
          }
        }
      }
    }
  } else if (nonEmptyString(n.rulesRaw)) {
    // FALLBACK ONLY. `stateChildren` is the parsed form of `rulesRaw`; scanning
    // both would double-visit every state-child body. When the symbol-table
    // parse has not run (or produced nothing), the raw body is the only source
    // there is.
    emit("markup-source", n.rulesRaw, "engine.rulesRaw", nodeSpan, true, "client");
  }

  // §51.0.R `<onIdle after=${expr}unit>` — the engine-wide watchdog.
  const idle = meta?.idleWatchdog as Rec | null | undefined;
  if (idle && nonEmptyString(idle.after)) {
    emit("template-text", idle.after, "engine.idleWatchdog.after", nodeSpan, true, "client");
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
