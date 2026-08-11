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
 * ═══ WHAT THIS TABLE DOES **NOT** CONVERGE, AND SAYING SO IS THE POINT ═══
 *
 * It shares WHICH FIELDS, not WHICH NODES. Recursion into child nodes stays with
 * each consumer (see below), and the two consumers still descend DIFFERENTLY:
 * `client-read-seed.ts` descends only ARRAY-valued fields, while
 * `dependency-graph.ts` carries an explicit OBJECT descent for `lift-expr` —
 * whose `.expr` is a `LiftTarget` union, not an array.
 *
 * So a node this table describes perfectly is still invisible if no consumer
 * walks to it. MEASURED, on this ref AND on `main` — three cross-file shapes,
 * each a live browser `ReferenceError` at exit 0 with no diagnostic:
 *
 *     ${ lift <span>${NEEDED}</span> }        ${ lift NEEDED }
 *     ${ lift <span title=NEEDED.go()>x</span> }
 *
 * Tracked as `g-263-lift-body-invisible-to-the-client-read-seed-node-traversal`
 * in `docs/known-gaps.md`. Do not read the drift as fully closed: the FIELD half
 * is closed and gated (`EXPR_NODE_FIELDS` §8), the NODE half is not.
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
import { bareAttrValueIsClientBinding } from "./attr-lowering.ts";

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
 * Does CLIENT-EXECUTED code reference this position's source as a JS BINDING —
 * a free identifier the emitted bundle must DECLARE, or the browser throws
 * `ReferenceError`?
 *
 * ═══ ONE QUESTION. THE FIELD USED TO ASK TWO, AND THAT IS WHAT LEAKED. ═══
 *
 * `dependency-graph.ts` asks **"where does user expression SOURCE appear?"**, so
 * it wants every position regardless of lowering: a `@cell` named in prose that
 * the compiler renders as text is still a consumption for E-DG-002 accounting.
 * It reads this field ZERO times.
 *
 * `codegen/client-read-seed.ts` asks **"which identifiers must this bundle
 * DECLARE?"**, because its answer decides whether a value is copied into a
 * `.client.js`. This field is that answer, and it is the ONLY consumer.
 *
 * The predecessor of this field was called `wired` and asked "does the compiler
 * emit client-executed code for this position?". That is a DIFFERENT question
 * and it has a different answer on real shapes, which is exactly how a
 * server-only `export const` reached a browser:
 *
 *     <p if=ARGON2_PEPPER>gated</p>
 *
 * emits client-executed code — `if (_scrml_cs_reactive_get("ARGON2_PEPPER"))` —
 * so the old question said "wired", and the seed copied the const's VALUE into
 * `models.client.js`. But that reference is a STRING KEY into the reactive cell
 * store. The emitted bundle names `ARGON2_PEPPER` nowhere as an identifier, so
 * the declaration resolves nothing and is pure leak. `show=@x`,
 * `bind:value=@x`, `class:on=@x` and `disabled=@x` are the same shape pointed
 * the other way: they DO emit client-executed code (inside an `_scrml_effect`),
 * and they reference the cell by key, never as a binding.
 *
 * So: cell-store reads and static HTML attribute strings are BOTH `"not-binding"`
 * — not because they are the same lowering, but because they give the same
 * answer to the one question this field asks. A consumer that needs "is this
 * lowered to static output" is asking something this field does not answer and
 * must not pretend to; add a second, separately-MEASURED field for it.
 *
 * ═══ THE FAILURE DIRECTIONS ARE NOT SYMMETRIC, SO THERE IS NO THIRD VALUE ═══
 *
 * Over-emitting silently ships a secret to a browser. Under-emitting throws a
 * loud `ReferenceError` the adopter can see and report. The predecessor type had
 * a third value, `"unknown"`, whose docblock argued at length that an
 * undetermined position fails CLOSED — and NOTHING EVER EMITTED IT. Every
 * unmeasured position was forced to the leak direction instead. A two-valued
 * type cannot carry that fiction: an undetermined position is not representable,
 * so a new position cannot ship unmeasured. `"not-binding"` IS the fail-closed
 * value, and it is a real one.
 *
 * Every `"binding"` classification below is MEASURED against emitted output, not
 * inferred.
 */
export type ClientBindingClass = "binding" | "not-binding";

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
  /** Whether client-executed code names this position's source as a JS BINDING
   *  the emitted bundle must declare. See `ClientBindingClass` — this is the
   *  field the §14.8 confidentiality consumer gates on, and it answers exactly
   *  that one question. */
  clientBinding: ClientBindingClass;
}

type Rec = Record<string, unknown>;

/**
 * Every SINGLE-VALUED `ExprNode` field an AST node can carry, in one place.
 *
 * ═══ THE LIST IS GATED IN BOTH DIRECTIONS, AND ONE DIRECTION IS NOT ENOUGH ═══
 *
 * `compiler/tests/unit/expr-positions-shared-table.test.js` §8 enumerates every
 * `X: ExprNode` declaration in `compiler/src/types/ast.ts` and requires each to
 * be either IN this list or on an EXCLUSION list carrying a reason. That gate is
 * the reason this list can be trusted, and it exists because the one-directional
 * version of it could not catch either real failure:
 *
 *   - the list once carried FOUR PHANTOMS (`testExpr`, `subjectExpr`,
 *     `targetExpr`, `returnExpr`) — zero declarations, zero construction sites.
 *     A phantom is worse here than anywhere else: two passes are told to trust
 *     this as the single source of truth, so overstated coverage reads exactly
 *     like real coverage.
 *   - and it MISSED `resultExpr`, which is declared at `types/ast.ts:1150` with
 *     six construction sites, and whose absence was a LIVE cross-file
 *     `ReferenceError` at exit 0 with no diagnostic:
 *
 *         ${ match @phase { .Idle :> @a = NEEDED, .Ready :> @a = "r" } }
 *         -> index.client.js:  _scrml_cs_reactive_set("a", NEEDED)
 *         -> NEEDED declared nowhere.  FIXED by listing the field.
 *
 *     `route-inference.ts`'s own copy of this list already had it, so the table
 *     built to end list-drift disagreed with a fourth copy still in the tree.
 *
 *     THE DISCRIMINATOR IS FORM **AND** POSITION — BOTH HALVES — and each of the
 *     two previous attempts to write it down stated one half and was wrong. A
 *     `match-arm-inline` node (the carrier of `resultExpr`) is built only where
 *     the match is in STATEMENT form AND sits in a body `parseLogicBody` parses:
 *     logic top level, a `function` body, or an `fn` body. MEASURED, by AST dump:
 *
 *       match STATEMENT @ logic top level / `function` / `fn`  2 arm nodes
 *       the SAME statement @ `on mount { … }`                  0 — `match-expr`
 *                                                                  with `rawArms`
 *       the SAME statement @ `when @v changes { … }`           0 — same
 *       the SAME statement @ MULTI-statement `on mount`        0 — no match node
 *                                                                  at all
 *       match EXPRESSION, ANY position                         0
 *
 *     Everywhere the count is 0 the arms survive as a RAW STRING — either inside
 *     `{kind:"match-expr", rawArms:[…]}` or swallowed whole into a raw body
 *     string — which no field-list entry can reach and no ExprNode walker can
 *     see. Still open, filed as
 *     `g-263-match-expr-rawarms-is-an-unparsed-string-inside-an-exprnode`.
 *     The table above is asserted by `expr-positions-shared-table.test.js` §9,
 *     so the next person to restate this gets told rather than believed.
 *
 * A test that asserts "these 7 are present and these 4 historical phantoms are
 * absent" passes with three BRAND-NEW phantoms added. Only enumerating the AST
 * closes it.
 *
 * SINGLE-VALUED is a contract, not an accident: both consumers read `node[f]`
 * and hand it straight to an ExprNode walker, so an `ExprNode[]` field cannot
 * live here. The two that exist (`argExprNodes`, `scrutineeExprs`) are on the
 * gate's exclusion list with their reasons.
 *
 * ═══ A LIST ENTRY IS NOT COVERAGE, AND THIS LIST SAYS SO ═══
 *
 * Membership is silent about whether a field does anything. FOUR of the five
 * entries the gate surfaced have ZERO occurrences across all 1904 corpus
 * sources, so the wide emit-differential is silent on them too, and the gate's
 * own list-membership assertion is silent by construction. Every entry below
 * therefore names its node kind AND its behavioural case, and each of those
 * cases FAILS when its field is removed from this list. That is the only
 * evidence that means anything.
 *
 * TWO OF THESE FIELDS ARE PARTIALLY SWALLOWED, and the entry says which half.
 * A BLOCK-bodied callback is not mapped to an ExprNode at all — the interior
 * survives as opaque source on an escape hatch — so the field fires and the walk
 * finds nothing. Same root cause as the `match-expr.rawArms` gap and as the
 * `import.meta` fence's block-body hole.
 */
export const EXPR_NODE_FIELDS: readonly string[] = [
  "exprNode", "initExpr", "condExpr", "valueExpr", "iterExpr", "headerExpr",
  "defaultExpr",
  // `match-arm-inline` (`types/ast.ts:1150`, 6 sites). STATEMENT-form `match`
  // only — a match EXPRESSION builds no arm nodes at all.
  // conf-CG-263 §1 `match-arm-inline result`.
  "resultExpr",
  // `when-effect` (`:1380`) AND `when-message` (`:1394`) — TWO node kinds, TWO
  // emit targets. The worker half is PRUNED by node kind in `client-read-seed.ts`;
  // a field list cannot tell them apart and listing this leaked a worker-only
  // const into a `.client.js`. conf-CG-263 §1b, both directions.
  "bodyExpr",
  // `cleanup(() => …)` (`:1366`), LOGIC-TOP-LEVEL form — inside a `function` or
  // `on mount` body the call is an ordinary `bare-expr`. PARTIAL: an
  // expression-bodied callback resolves, a BLOCK-bodied one is swallowed by the
  // escape hatch. conf-CG-263 §1b, both halves pinned.
  "callbackExpr",
  // `upload(file, url)` (`:1403`, `:1407`), same logic-top-level rule. Two
  // entries on one node, so each argument position gets its own case.
  // conf-CG-263 §1b.
  "fileExpr", "urlExpr",
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
 * `variable-ref` shape — does the emitted client bundle name the source as a JS
 * BINDING?
 *
 * ═══ THE DECISION IS NOT RESTATED HERE. IT IS IMPORTED. ═══
 *
 * `bareAttrValueIsClientBinding` is `emit-html.ts`'s OWN route guard, shared
 * (`./attr-lowering.ts`), so the two cannot disagree. They did: this file
 * carried `/^on[a-z]/` against codegen's `name.startsWith("on")`, and the four
 * names in the gap — `on=`, `on-tap=`, `on_tap=`, `on<digit>=` — every one
 * MEASURED as an under-emit. An arc that replaced two drifting walkers with one
 * table had introduced a new drifting predicate inside it.
 *
 * The answer depends on the VALUE SHAPE as well as the attribute name, which is
 * the other thing the old name-only predicate got wrong. Within `if=` alone:
 *
 *     if=(X)   if=X()          BINDING      `if ((X))` / `if ((X()))`
 *     if=X     if=X.f  if=X[0] NOT-BINDING  `_scrml_cs_reactive_get("X")`
 *
 * The three NON-bare shapes need no test at all — a `call-ref` (`title=X.go()`),
 * a parenthesized `expr` (`title=(X)`) and a `${…}`-bearing quoted string
 * (`title="v-${X}"`) are each MEASURED to emit a real binding reference on every
 * attribute name tested, `class=` / `title=` / `data-x=` / `<textarea>`
 * included.
 */
function bareAttrValueBinding(attrName: unknown, bareValue: unknown): ClientBindingClass {
  return bareAttrValueIsClientBinding(attrName, bareValue) ? "binding" : "not-binding";
}

function isExprNode(v: unknown): boolean {
  return !!v && typeof v === "object" && typeof (v as Rec).kind === "string";
}

/**
 * A REACTIVE-CELL NAME IS NEVER A JS BINDING. Enforced here rather than trusted
 * at ~25 emit sites.
 *
 * `cell-name` and `cell-name-list` carry cell names, and a cell is addressed in
 * emitted client code by STRING KEY (`_scrml_cs_reactive_get("hits")`) — there is
 * no `hits` identifier in the bundle to declare, on any lowering, ever. That is a
 * property of the KIND, so it is decided from the kind, once, and an emit site
 * that passes the wrong class for one of these two kinds cannot produce a wrong
 * position.
 *
 * It also makes the alternate groups safe: the `@`-variable-ref group hands the
 * `@`-sigil consumer a `cell-name` and the identifier consumer a parsed
 * `expr-node` off the SAME source, and those two alternates must not carry the
 * same answer to a question only one of them is about.
 */
function bindingFor(kind: ExprPositionKind, declared: ClientBindingClass): ClientBindingClass {
  if (kind === "cell-name" || kind === "cell-name-list") return "not-binding";
  return declared;
}

/**
 * Does this alternate carry nothing at all? An empty `refs` array and an empty
 * string are not representations of the source — they are the ABSENCE of one, and
 * an absent alternate must not consume the group's single slot.
 */
function isEmptyPositionValue(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.length === 0;
  return false;
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
    span: Span | null, render: boolean, clientBinding: ClientBindingClass,
  ): void => {
    if (!supports.has(kind)) return;
    cb({ kind, value, origin, span, render, clientBinding: bindingFor(kind, clientBinding) });
  };

  /**
   * Emit the first alternate that the consumer supports AND that actually
   * CARRIES something.
   *
   * "Carries something" is not decoration. `refs` is the first alternate of the
   * expression group and four lift-path producers in `ast-builder.js` hardcode
   * `refs: []`, so a supported-but-empty `cell-name-list` used to win over a real
   * parsed `exprNode` sitting right behind it and the consumer got NOTHING. A
   * PREFERENCE order between representations of the same source only means
   * anything among representations that exist.
   */
  const emitGroup = (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    span: Span | null, render: boolean, clientBinding: ClientBindingClass,
  ): void => {
    for (const alt of alternates) {
      if (!supports.has(alt.kind)) continue;
      if (isEmptyPositionValue(alt.value)) continue;
      cb({
        kind: alt.kind, value: alt.value, origin: alt.origin, span, render,
        clientBinding: bindingFor(alt.kind, clientBinding),
      });
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
      // DEFENSIVE, and currently UNREACHED: an ExprNode hung directly on the attr
      // object rather than on `attr.value`. Every attr producer in the tree builds
      // `{name, value, span}` (`ast-builder.js:3087/3100/3384/3388/5442/5445`) and
      // `native-parser/tag-frame.js` carries no `exprNode` at all, so this loop
      // fires nowhere today. It is kept because it costs nothing when absent — and
      // labelled UNREACHED because an unlabelled defensive branch in the file two
      // passes trust as the single source of truth reads exactly like coverage.
      // A parsed ExprNode is the expression shape, which is a binding position on
      // every attribute name (measured).
      for (const f of EXPR_NODE_FIELDS) {
        if (isExprNode(a[f])) emit("expr-node", a[f], `attr.${f}`, spanOf(a) ?? nodeSpan, attrRender, "binding");
      }
      forEachAttrValuePosition(a.value, "attr.value", spanOf(a) ?? nodeSpan, attrRender, a.name, supports, cb);
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
    // The gate's attribute name IS `if`, and passing it rather than a
    // pre-computed class is what keeps this identical to the markup `if=`: the
    // structural `<each … if=X>` and the markup `<p if=X>` lower through the
    // SAME §17.1 mount gate to the SAME `_scrml_cs_reactive_get("X")`, so they
    // must classify the same way, and now they cannot do otherwise.
    forEachAttrValuePosition(n.ifCond, "ifCond", nodeSpan, true, "if", supports, cb);
  }

  // ---- 3. Structural opener raw expressions. ------------------------------
  for (const f of STRUCTURAL_RAW_EXPR_FIELDS) {
    // MEASURED: `<each in=…>` lowers to `const _items = <inExprRaw>` in the
    // client bundle; the key/count/subject openers likewise.
    if (nonEmptyString(n[f])) emit("expr-source", n[f], f, nodeSpan, true, "binding");
  }

  // ---- 4. Raw BODY text of the raw-captured structural elements. ----------
  // `<each>`'s per-item template and `<match>`'s arms are captured as raw text
  // in addition to (partially) walkable children. The raw capture is the ONLY
  // representation for shapes the child rebuild does not reach.
  if (n.kind === "each-block" && nonEmptyString(n.bodyRaw)) {
    emit("markup-source", n.bodyRaw, "each.bodyRaw", nodeSpan, true, "binding");
  }
  if (n.kind === "match-block" && nonEmptyString(n.armsRaw)) {
    emit("markup-source", n.armsRaw, "match.armsRaw", nodeSpan, true, "binding");
  }

  // ---- 5. `<engine>` internals. ------------------------------------------
  if (n.kind === "engine-decl") forEachEnginePosition(n, nodeSpan, supports, emit, emitGroup);

  // ---- 6. A multi-statement `on mount` / `on dismount` effect. ------------
  // `mountBodyExprNode` returns undefined for a >1-statement body, so such a
  // node carries NO usable `exprNode` — only the raw `expr` string.
  if (n.kind === "bare-expr" && n._onMountEffect === true &&
      !isExprNode(n.exprNode) && nonEmptyString(n.expr)) {
    emit("statement-source", n.expr, "onMount.expr", nodeSpan, false, "binding");
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
  /** The OWNING ATTRIBUTE'S NAME — not a pre-computed classification.
   *
   *  The bare `variable-ref` shape is the one whose lowering depends on the
   *  attribute name AND on the value, and only this function has the value. A
   *  caller that pre-computed the class from the name alone could not tell
   *  `onclick=go` (a binding) from `onclick=go.now` (a static HTML attribute),
   *  and did not. */
  attrName: unknown,
  supports: ReadonlySet<ExprPositionKind>,
  cb: (position: ExprPosition) => void,
): void {
  const emit = (
    kind: ExprPositionKind, value: unknown, origin: string, render: boolean,
    clientBinding: ClientBindingClass,
  ): void => {
    if (!supports.has(kind)) return;
    cb({ kind, value, origin, span, render, clientBinding: bindingFor(kind, clientBinding) });
  };
  /** See the sibling in `forEachExprPosition` — empty alternates are skipped. */
  const emitGroup = (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    render: boolean, clientBinding: ClientBindingClass,
  ): void => {
    for (const alt of alternates) {
      if (!supports.has(alt.kind)) continue;
      if (isEmptyPositionValue(alt.value)) continue;
      cb({
        kind: alt.kind, value: alt.value, origin: alt.origin, span, render,
        clientBinding: bindingFor(alt.kind, clientBinding),
      });
      return;
    }
  };

  // A bare unquoted attribute value arrives as a plain string. It is literal
  // text — only a `@`-sigil consumer has anything to find in it.
  if (typeof attrVal === "string") {
    if (attrVal.length > 0) emit("literal-text", attrVal, `${originBase}(text)`, false, "not-binding");
    return;
  }
  if (!attrVal || typeof attrVal !== "object") return;
  const v = attrVal as Rec;

  // `title="box ${@theme}"` — `{kind:"string-literal", value}`. The `${}`
  // interiors are the code; the rest is literal text. MEASURED a binding on every
  // attribute name tested, `class`/`data-*`/`aria-*`/`src`/`style` included: the
  // compiler lowers it to `el.setAttribute("title", \`v-${X}\`)`, in which `X` is
  // a real identifier the bundle must declare.
  if (v.kind === "string-literal" && nonEmptyString(v.value) && v.value.includes("${")) {
    emit("template-text", v.value, `${originBase}.template`, false, "binding");
  }

  // `attr=@x` / `bind:value=@x` / `attr=someName` — `{kind:"variable-ref", name,
  // exprNode}`. A `@`-sigil consumer wants the cell NAME; an identifier consumer
  // wants the parsed node (which is where a non-`@` binding read lives).
  //
  // THIS IS THE SHAPE WHOSE LOWERING DEPENDS ON THE ATTRIBUTE NAME **AND** ON THE
  // VALUE, and getting either half wrong shipped a secret. `<p class=SECRET>`
  // lowers to the static HTML string `class="SECRET"` with no client wiring at
  // all; `<p if=SECRET>` lowers to `_scrml_cs_reactive_get("SECRET")`, a string
  // key. Neither names `SECRET` as an identifier, yet in both the value was
  // copied into the client bundle where the declaration was the ONLY line
  // mentioning it. `bareAttrValueBinding` carries the measured answer and takes
  // both inputs.
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
    // A call-ref is a CALL, not a bare value: measured to emit a real binding
    // reference on every attribute name (`class=X.go()` → `function(event){
    // X.go(); }`), so it does not take the bare-value classification.
    emitGroup(
      alternates, renderBase,
      v.kind === "call-ref" ? "binding" : bareAttrValueBinding(attrName, v.name),
    );
  }

  // `if=(@a && @b)` — `{kind:"expr", raw, refs, exprNode}`. `refs` is the AST
  // builder's pre-extracted `@cell` list; `exprNode` is the parse; `raw` is the
  // last-resort text. These are ALTERNATES — taking more than one double-counts.
  //
  // MEASURED a binding on every attribute name tested, `title=(X)` / `class=(X)` /
  // `data-x=(X)` / `<textarea title=(X)>` included: the parenthesized form is an
  // EXPRESSION attribute and the compiler emits an effect for it regardless of
  // the attribute's name.
  //
  // THE `variable-ref` GUARD IS ON THE GROUP, NOT ON ONE ALTERNATE. It used to
  // sit on the `exprNode` alternate alone, so a `variable-ref` value carrying a
  // `raw` (or a `refs`) matched BOTH groups — one source, two positions, with
  // CONTRADICTING `clientBinding` (the bare-value answer from the group above,
  // `"binding"` from this one). No producer builds that shape today
  // (`ast-builder.js:2919/3372/5720`, `native-parser/tag-frame.js:1445`), but
  // `native-walker/attrvalue-exprnode-walker.ts` asserts in its own docblock that
  // it exists, and a per-alternate guard is one new alternate away from the same
  // bug. The group is the EXPRESSION shape's; a `variable-ref` is not it.
  if (v.kind !== "variable-ref") {
    const alternates: Array<{ kind: ExprPositionKind; value: unknown; origin: string }> = [];
    if (Array.isArray(v.refs)) {
      alternates.push({ kind: "cell-name-list", value: v.refs, origin: `${originBase}.refs` });
    }
    if (isExprNode(v.exprNode)) {
      alternates.push({ kind: "expr-node", value: v.exprNode, origin: `${originBase}.exprNode` });
    }
    if (nonEmptyString(v.raw)) {
      alternates.push({ kind: "expr-source", value: v.raw, origin: `${originBase}.raw` });
    }
    if (alternates.length > 0) emitGroup(alternates, renderBase, "binding");
  }

  // `onclick=fn(@var, CONST)` — `{kind:"call-ref", name, args, argExprNodes?}`.
  // MEASURED a binding on every attribute name tested, `title=X.go()` /
  // `class=X.go()` / `data-x=X.go()` included.
  if (v.kind === "call-ref") {
    // The CALLEE. `utils.handleClick` names ONE binding (`utils`) plus property
    // names; `handleClick` names one binding. Both consumers need the callee,
    // for different reasons — the dependency graph credits the called function's
    // transitive reactive reads, the client seed marks the base binding — so it
    // is one position with one kind and two readings.
    if (nonEmptyString(v.name)) {
      emit("callee-name", v.name, `${originBase}.callee`, false, "binding");
    }
    // The ARGUMENTS. `argExprNodes` and the raw `args` strings are NOT
    // alternates: `argExprNodes` is `undefined` for the WHOLE call as soon as
    // any single argument fails to parse to a node (an empty argument does it),
    // and then the raw strings are the only representation there is. Emitting
    // both is safe — every consumer here is idempotent on a set.
    if (Array.isArray(v.argExprNodes)) {
      for (const en of v.argExprNodes as unknown[]) {
        if (isExprNode(en)) emit("expr-node", en, `${originBase}.argExprNodes[]`, renderBase, "binding");
      }
    }
    if (Array.isArray(v.args)) {
      for (const arg of v.args as unknown[]) {
        if (nonEmptyString(arg)) emit("expr-source", arg, `${originBase}.args[]`, renderBase, "binding");
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
  emit: (
    kind: ExprPositionKind, value: unknown, origin: string, span: Span | null,
    render: boolean, clientBinding: ClientBindingClass,
  ) => void,
  emitGroup: (
    alternates: ReadonlyArray<{ kind: ExprPositionKind; value: unknown; origin: string }>,
    span: Span | null, render: boolean, clientBinding: ClientBindingClass,
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
    if (alternates.length > 0) emitGroup(alternates, nodeSpan, true, "binding");
  }
  // §51.0.J `derived=match @src { … }` — the arm bodies. A projection body, not
  // statements: its arm targets are VARIANTS, and the only code in it would be a
  // `${…}` interior.
  if (nonEmptyString(n.inlineMatchBody)) {
    emit("markup-source", n.inlineMatchBody, "engine.inlineMatchBody", nodeSpan, true, "binding");
  }

  const record = n._record as Rec | undefined;
  const meta = record?.engineMeta as Rec | undefined;

  // §51.0.E `initial=@cell` and §52 `server=@source` hydration reads.
  if (nonEmptyString(meta?.initialCell)) {
    emit("cell-name", meta!.initialCell, "engine.initialCell", nodeSpan, true, "binding");
  }
  if (nonEmptyString(meta?.serverSource)) {
    // The ROOT segment of a dotted source path is the subscribed cell
    // (`@driver.current_status` → `driver`).
    const root = (meta!.serverSource as string).split(".")[0];
    if (root) emit("cell-name", root, "engine.serverSource", nodeSpan, true, "binding");
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
          sc.bodyRaw, "engine.stateChild.bodyRaw", nodeSpan, true, "binding",
        );
      }
      if (Array.isArray(sc.onTransitionElements)) {
        for (const otRaw of sc.onTransitionElements as unknown[]) {
          if (!otRaw || typeof otRaw !== "object") continue;
          const ot = otRaw as Rec;
          if (nonEmptyString(ot.bodyRaw)) {
            emit(
              ot.isColonShorthand === true ? "statement-source" : "markup-source",
              ot.bodyRaw, "engine.stateChild.onTransition.bodyRaw", nodeSpan, true, "binding",
            );
          }
          // §51.0.H `<onTransition if=expr>` — the transition GUARD. Captured
          // verbatim (it may carry surrounding parens or a `${…}` wrapper).
          if (nonEmptyString(ot.ifExprRaw)) {
            // MEASURED: the guard lowers to `if (X === 1) { … }` in the client
            // engine substrate.
            emit("expr-source", unwrapGuardRaw(ot.ifExprRaw), "engine.stateChild.onTransition.ifExprRaw", nodeSpan, true, "binding");
          }
        }
      }
      // §51.12.3.1 `<onTimeout after=${expr}unit>` — the computed form.
      if (Array.isArray(sc.onTimeoutElements)) {
        for (const otoRaw of sc.onTimeoutElements as unknown[]) {
          if (!otoRaw || typeof otoRaw !== "object") continue;
          const after = (otoRaw as Rec).after;
          if (nonEmptyString(after)) {
            emit("template-text", after, "engine.stateChild.onTimeout.after", nodeSpan, true, "binding");
          }
        }
      }
    }
  } else if (nonEmptyString(n.rulesRaw)) {
    // FALLBACK ONLY. `stateChildren` is the parsed form of `rulesRaw`; scanning
    // both would double-visit every state-child body. When the symbol-table
    // parse has not run (or produced nothing), the raw body is the only source
    // there is.
    emit("markup-source", n.rulesRaw, "engine.rulesRaw", nodeSpan, true, "binding");
  }

  // §51.0.R `<onIdle after=${expr}unit>` — the engine-wide watchdog.
  const idle = meta?.idleWatchdog as Rec | null | undefined;
  if (idle && nonEmptyString(idle.after)) {
    emit("template-text", idle.after, "engine.idleWatchdog.after", nodeSpan, true, "binding");
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
