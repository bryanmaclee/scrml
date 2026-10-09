/**
 * implied-lift-desugar.ts — §17.6.10 / §10.1: the IMPLIED `lift` of a
 * single-MARKUP-expression control-flow arm.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CLOSES
 * ---------------------------------------------------------------------------
 * `${ if (@on) { <p>Yes</p> } else { <p>No</p> } }` rendered NOTHING — exit 0,
 * zero diagnostics (`g-if-arm-bare-markup-branch-silently-dropped`, HIGH,
 * adopter-reported). The two controls that bound the defect:
 *
 *   ${ if (@on) { "Yes" }          else { "No" } }          -> renders (value-form)
 *   ${ if (@on) { lift <p>Yes</p> } else { lift <p>No</p> } } -> renders (lift group)
 *   ${ if (@on) { <p>Yes</p> }     else { <p>No</p> } }     -> SILENTLY DROPPED
 *
 * SPEC is normative FOR the third row, so admitting it is conformance
 * restoration and not a language widening:
 *
 *   §10.1 limb 2 (SPEC.md ~7153, S391 amendment, `provenance:
 *   ruling:user-voice-scrml.md S371 "value-form b"`) — *"an arm body that is
 *   exactly one expression carries an implied `lift` of that expression"*.
 *
 *   §17.6.10 (SPEC.md ~12448) — *"A branch body that is exactly one expression
 *   SHALL be equivalent to `{ lift <expression> }`."*
 *
 *   §1.4 / §6097 (the L1 pillar) — *"markup elements may sit anywhere
 *   expressions sit"*, so a markup element IS such an expression.
 *
 * ---------------------------------------------------------------------------
 * WHY A DESUGAR AND NOT A CLASSIFIER WIDENING
 * ---------------------------------------------------------------------------
 * The obvious-looking fix — admit `html-fragment` into
 * `emit-html.ts:isValueFormIfStmt` / `isSoleBareExprBranch` — is the WRONG
 * target, and the sibling `match` limb is the measured proof. The value-form
 * route lowers an arm to a CONDITIONAL EXPRESSION over the arm's raw text
 * (§17.6.8 latitude), and a markup arm's raw text is not JavaScript: a
 * value-form `match` with markup arms emits `return <p>Yes < / p >;` — invalid
 * JS — which is exactly why that limb carries the separate
 * `E-MATCH-ARM-MARKUP-IN-VALUE` steer instead. Widening the `if` classifier
 * the same way would reproduce that failure one construct over.
 *
 * The SPEC sentence names the correct lowering itself: the arm *carries an
 * implied `lift`*. So this pass makes the implied `lift` EXPLICIT in the tree,
 * and the already-correct `lift` pipeline — the render-slot allocation
 * (`emit-html.ts:stmtContainsLiftExpr`), the reactive lift group
 * (`emit-reactive-wiring.ts:stmtContainsLift`) and the branch lowering
 * (`emit-lift.js:emitIfStmtWithContainer`) — handles it with NO codegen change
 * at all. The emitted artifact for the sugar is therefore the emitted artifact
 * for the explicit `lift`, which is the equivalence §17.6.10 asserts.
 *
 * Root cause, for the record: a bare-markup arm parses to
 * `{kind:"html-fragment", content:"<p>Yes < / p >"}` — neither `bare-expr` (so
 * the value-form classifier declines) nor `lift-expr` (so no lift group is
 * formed) — and then reaches `emit-logic.ts`'s `case "html-fragment": return ""`.
 * That `return ""` is the silent drop; it is correct for logic context and is
 * NOT the locus.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SEAM (and what it costs)
 * ---------------------------------------------------------------------------
 * The natural home is the TAB (`ast-builder.js`) — the sugar is a parse-level
 * equivalence, and there the markup is still in hand instead of having to be
 * recovered. This pass runs at the head of CE (Stage 3.2) instead, because CE
 * is the EARLIEST pipeline stage that receives both the AST and the file's
 * source text (`_sourceText`; PRECG/NR/TC/SYM are handed only
 * `{filePath, ast}`), and the source text is required: the `html-fragment`
 * node's own `content` is the tokenizer-rejoined form (`"<p>Yes < / p >"`),
 * which does not re-parse and has already lost interior whitespace.
 * Running at CE's head still precedes component expansion, VP-2, TS, DG and
 * CG, so a desugared `<Foo/>` arm is expanded like any other component
 * reference. The one measured cost is that SYM (Stage 3.06) runs BEFORE CE and
 * therefore never sees the recovered markup; that is the same position an
 * explicit `lift` arm is in for every SYM-derived field CE-or-later recomputes.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE TEST — §17.6.10's grammar, per invariant 83
 * ---------------------------------------------------------------------------
 * `value-form-if ::= 'if' condition '{' expression '}' …` — the arm is EXACTLY
 * ONE expression, so the test is `body.length !== 1 -> decline`, local and
 * deliberate, NOT §18.5's positional "last expression" tail rule. Invariant 83:
 * routing the sugar arm through a tail rule would silently admit shapes the
 * grammar does not define. An arm holding two elements, or markup plus a
 * statement, is therefore NOT desugared here — it is not a value-form.
 *
 * Every conversion is additionally gated on RECOVERING THE EXACT SOURCE: the
 * span slice must be whitespace-insensitively identical to the fragment's own
 * content, and must re-parse to exactly one markup node with no errors.
 * Anything else declines and leaves the tree untouched (HEAD behaviour). A
 * decline is silent by construction — this pass raises no diagnostics.
 */

/**
 * BS / TAB are reached the way every other `.ts` file in the pipeline reaches
 * them — a lazy `require` with an explicit type — rather than a top-level ESM
 * `import`. Both modules are plain `.js` with no declarations, so an `import`
 * raises TS7016 at the import site (there is no `as` to annotate it away), which
 * would put two NEW names into the types-gate baseline for no benefit.
 * `codegen/emit-engine.ts` and `codegen/emit-match.ts` already do exactly this.
 * Cached, so the resolve cost is paid once per process, not once per arm.
 */
type BsFn = (filePath: string, source: string) => unknown;
type TabFn = (bsOutput: unknown) => { ast?: { nodes?: unknown[] }; errors?: unknown[] };
let _bs: BsFn | null = null;
let _tab: TabFn | null = null;
function parsers(): { splitBlocks: BsFn; buildAST: TabFn } {
  if (!_bs) _bs = (require("./block-splitter.js") as { splitBlocks: BsFn }).splitBlocks;
  if (!_tab) _tab = (require("./ast-builder.js") as { buildAST: TabFn }).buildAST;
  return { splitBlocks: _bs, buildAST: _tab };
}

/** Container keys walked when looking for desugarable arms. */
const CONTAINER_KEYS = [
  "nodes",
  "children",
  "body",
  "consequent",
  "alternate",
  "bodyChildren",
  "armBodyChildren",
];

/** Whitespace-insensitive comparison key — the tokenizer rejoin inserts spaces. */
function despace(s: string): string {
  return s.replace(/\s+/g, "");
}

/** Highest `id` anywhere in the tree, so re-parsed nodes get non-colliding ids. */
function maxNodeId(root: unknown): number {
  let max = 0;
  const seen = new Set<unknown>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const e of n) walk(e);
      return;
    }
    const rec = n as Record<string, unknown>;
    if (typeof rec.id === "number" && rec.id > max) max = rec.id;
    for (const k of Object.keys(rec)) walk(rec[k]);
  };
  walk(root);
  return max;
}

/** Re-number every `id` in a freshly re-parsed subtree, in place. */
function renumber(node: unknown, counter: { next: number }): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const e of node) renumber(e, counter);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.id === "number") rec.id = ++counter.next;
  for (const k of Object.keys(rec)) renumber(rec[k], counter);
}

/**
 * Recover the markup AST for one arm from the original source, or return null
 * (decline — caller leaves the tree exactly as it was).
 *
 * `start`/`end` are the arm's full source extent. Note this is deliberately a
 * SOURCE-level shape test, not a node-count one: an arm holding ONE markup
 * element that contains an interpolation (`{ <p>n=${@n}</p> }`) is split by the
 * block-splitter into `[html-fragment, logic, html-fragment]`, three nodes for
 * one expression. Counting nodes declined it and left that branch silently
 * empty while its sibling rendered — measured, and the single most common
 * adopter spelling. What §17.6.10 counts is expressions, so what we re-parse
 * is the arm's source extent, and "exactly one" is tested on the result.
 */
function recoverMarkupNode(
  start: number,
  end: number,
  leadContent: string,
  sourceText: string,
  filePath: string,
): Record<string, unknown> | null {
  if (!(start >= 0 && end > start && end <= sourceText.length)) return null;

  const slice = sourceText.slice(start, end).trim();
  if (!slice.startsWith("<")) return null;

  // The span must actually point at THIS arm. A fragment that reached us
  // through a re-parsed sub-AST (match-arm / each-body re-slices; `buildAST`
  // takes no base offset) carries a span relative to that slice, so the file
  // offsets would name unrelated bytes. Anchoring the slice against the arm's
  // own leading rejoined content, whitespace-insensitively, is the check that
  // catches it.
  if (!leadContent) return null;
  if (!despace(slice).startsWith(despace(leadContent))) return null;

  let parsed: { ast?: { nodes?: unknown[] }; errors?: unknown[] };
  try {
    const { splitBlocks, buildAST } = parsers();
    parsed = buildAST(splitBlocks(filePath, `<program>\n${slice}\n</program>\n`)) as typeof parsed;
  } catch {
    return null;
  }
  // Any hard error in the re-parse means we did not recover the author's
  // markup; decline rather than emit something they did not write.
  for (const e of parsed.errors ?? []) {
    const sev = (e as { severity?: string })?.severity ?? "error";
    if (sev === "error") return null;
  }
  const prog = (parsed.ast?.nodes ?? []).find(
    (n) => (n as Record<string, unknown>)?.kind === "markup" &&
      (n as Record<string, unknown>)?.tag === "program",
  ) as Record<string, unknown> | undefined;
  const kids = (prog?.children as unknown[] | undefined) ?? [];
  const significant = kids.filter((k) => {
    const rec = k as Record<string, unknown>;
    if (!rec) return false;
    if (rec.kind === "comment") return false;
    if (rec.kind === "text" && typeof rec.value === "string" && rec.value.trim() === "") return false;
    return true;
  }) as Record<string, unknown>[];

  // §17.6.10: EXACTLY ONE expression. Two elements, or an element plus stray
  // text, is not a value-form arm and is not desugared.
  if (significant.length !== 1) return null;
  if (significant[0].kind !== "markup") return null;
  return significant[0];
}

/** A planned rewrite of one arm — applied only if the WHOLE cascade plans cleanly. */
interface ArmPlan {
  arm: unknown[];
  markupNode: Record<string, unknown>;
  span: unknown;
  /**
   * s461 — keep the arm's pre-desugar pieces for the checkers (see applyPlans and
   * `keepPiecesForArmsBaseNeverPlanned`): true for every arm the pre-s461 planner
   * (no `given` cascade node) would NOT have desugared.
   */
  keepPieces?: boolean;
}

/** Nodes an arm may hold and still be "exactly one markup expression" in source. */
function isArmPiece(n: Record<string, unknown>): boolean {
  // `html-fragment` = the markup text runs; `logic` = a `${…}` interpolation
  // INSIDE that markup, which the block-splitter hoists to a sibling BLOCK_REF
  // node. Anything else (a declaration, a bare call, a nested statement) means
  // the arm is not one expression and §17.6.10 does not reach it.
  return n.kind === "html-fragment" || n.kind === "logic";
}

function spanOf(n: Record<string, unknown>): { start: number; end: number } | null {
  const s = n.span as { start?: unknown; end?: unknown } | undefined;
  if (typeof s?.start !== "number" || typeof s?.end !== "number") return null;
  return { start: s.start, end: s.end };
}

/**
 * True when the arm is exactly one NON-markup value expression — a string
 * literal, a call, an identifier. Such an arm is a value-form arm the existing
 * value-form route already lowers correctly (a conditional expression fed to
 * `_scrml_render_value`).
 *
 * It matters because a cascade MIXING one markup arm with one of these cannot be
 * lowered by lifting only the markup arm: the two arms would then be lowered by
 * two different mechanisms for one conditional. The coherent lowering for a
 * mixed cascade is the value-form route with the markup arm lowered as a markup
 * VALUE (the `let aDiv = <div>…` path — `_scrml_render_value` already accepts a
 * DOM node), which is separate, open work (GITI-032 markup-value lowering). So
 * the pass declines the mixed shape rather than half-lowering it.
 */
function isNonMarkupValueArm(arm: unknown): boolean {
  if (!Array.isArray(arm) || arm.length !== 1) return false;
  const only = arm[0] as Record<string, unknown> | null;
  if (!only || only.kind !== "bare-expr") return false;
  const exprNode = only.exprNode as Record<string, unknown> | undefined;
  const k = exprNode?.kind;
  return k !== "markup" && k !== "markup-value";
}

/**
 * Classify one arm.
 *   - `null`          — not a markup arm at all (a string/expression arm, a
 *                       nested `if`, a statement body). Nothing to do, and NOT
 *                       a reason to abandon the cascade.
 *   - `{plan}`        — a markup arm we can convert exactly.
 *   - `"declined"`    — a markup arm we could NOT convert exactly. The caller
 *                       abandons the WHOLE cascade on this, so that a shape
 *                       outside §17.6.10's grammar keeps its pre-existing
 *                       behaviour uniformly instead of half-rendering.
 */
function planArm(
  arm: unknown,
  sourceText: string,
  filePath: string,
): ArmPlan | "declined" | null {
  if (!Array.isArray(arm) || arm.length === 0) return null;
  const pieces = arm as Record<string, unknown>[];
  const lead = pieces[0];
  if (!lead) return null;

  // ── Shape B: the NATIVE parser's spelling of the same arm ────────────────
  // `compiler/native-parser` parses a bare-markup arm into
  // `bare-expr{exprNode:{kind:"markup-value", node}}` — it keeps the markup
  // tree, where the live `ast-builder` flattens it to a raw `html-fragment`.
  // (That divergence is itself worth knowing: the two pipelines do not agree
  // on this shape.) Nothing has to be recovered from source here — the markup
  // node is already in hand — so this path works at seams that hold no source
  // text, which is how a `<match for=…>` arm body re-parsed at emit time from
  // `entry.bodyRaw` is reached.
  if (pieces.length === 1 && lead.kind === "bare-expr") {
    const exprNode = lead.exprNode as Record<string, unknown> | undefined;
    if (exprNode && exprNode.kind === "markup-value" && exprNode.node &&
        typeof exprNode.node === "object") {
      return { arm: pieces, markupNode: exprNode.node as Record<string, unknown>, span: lead.span };
    }
    return null;
  }

  // ── Shape A: the live parser's spelling — a raw `html-fragment` run ──────
  if (lead.kind !== "html-fragment") return null;
  const leadContent = typeof lead.content === "string" ? lead.content : "";
  if (!leadContent.trimStart().startsWith("<")) return null;

  // From here on this IS a markup arm: either we convert it exactly or the
  // cascade is left alone.
  if (!pieces.every((p) => p && isArmPiece(p))) return "declined";
  const first = spanOf(lead);
  const last = spanOf(pieces[pieces.length - 1]);
  if (!first || !last) return "declined";
  const markupNode = recoverMarkupNode(first.start, last.end, leadContent, sourceText, filePath);
  if (!markupNode) return "declined";
  return { arm: pieces, markupNode, span: lead.span };
}

/**
 * s461 — the control-flow nodes whose arms this pass plans: an `if-stmt`
 * (`consequent` / `alternate`) and a §42.2.3 `given` presence guard (`body`).
 *
 * A `given` guard IS an `if` once lowered — §42.5: `given x :> body` →
 * `if (x !== null && x !== undefined) { body }` — so its body is a branch body
 * in exactly §17.6.10's sense, and a body that is exactly one markup expression
 * carries the same implied `lift`. §42.3.5's own worked example is that shape:
 * `${ given @user :> { <p>${@user.name}</p> } }`. Before s461 the guard body
 * reached `emit-logic.ts`'s `case "html-fragment": return ""` and rendered
 * nothing whether the cell was present or not (`g-top-level-given-emits-bare-
 * name-s459`, markup limb). The guard has a single arm, so when it is `not` the
 * interpolation renders nothing — the same as an `if` with no `else`.
 *
 * `planIfCascade` already walks the `body` key, so the guard needs no planner of
 * its own; only the "is this a cascade node" tests had to learn the kind.
 */
function isCascadeNode(n: Record<string, unknown>): boolean {
  return n.kind === "if-stmt" || n.kind === "given-guard";
}

/**
 * s461 — the PRE-s461 cascade test (`if-stmt` only). Used for one purpose: to
 * re-run the planner as it stood before `given` became a cascade node, so the
 * caller knows exactly which arms the pre-s461 pass would have desugared. See
 * `keepPiecesForArmsBaseNeverPlanned`.
 */
function isIfCascadeNodeOnly(n: Record<string, unknown>): boolean {
  return n.kind === "if-stmt";
}

/** Does this cascade reach a `given` guard anywhere through its arms? */
function cascadeReachesGiven(n: Record<string, unknown>): boolean {
  if (n.kind === "given-guard") return true;
  for (const key of ["consequent", "alternate", "body"]) {
    const arm = n[key];
    if (!Array.isArray(arm)) continue;
    for (const child of arm) {
      const rec = child as Record<string, unknown> | null;
      if (rec && isCascadeNode(rec) && cascadeReachesGiven(rec)) return true;
    }
  }
  return false;
}

/**
 * s461 — THE ONE MECHANISM that keeps the checkers' coverage unchanged.
 *
 * The type system's `lift-expr` arm and the §42 presence reader do not descend
 * into a lift's markup (a pre-existing hole that every `if`-arm implied lift has
 * always lived in). Before s461 a cascade that involved a `given` guard was never
 * desugared at all — a `given` root was not a cascade node, and an `if` cascade
 * with a `given` holding markup in an arm DECLINED whole (armHoldsMarkup) — so the
 * checkers judged every arm of it as raw `html-fragment` / `logic` pieces. Now
 * those cascades plan, at any nesting depth (given→if, given→if→if, if→given,
 * given→given, and the SIBLING arms of an `if` whose other arm holds a `given`).
 *
 * Rather than guess which of those arms are "below a given", the planner is re-run
 * exactly as it stood before s461 (`isIfCascadeNodeOnly`). Every arm the old
 * planner would have desugared gets no pieces (the checkers' view of it is
 * unchanged — the existing hole). Every arm it would NOT have desugared keeps its
 * pieces, which the checkers judge exactly as before. Coverage is therefore
 * identical to the pre-s461 pass by construction, not by enumeration of shapes.
 * A cascade that reaches no `given` plans identically under both predicates and
 * is skipped (no re-run, no pieces).
 */
function keepPiecesForArmsBaseNeverPlanned(
  root: Record<string, unknown>,
  plans: ArmPlan[],
  sourceText: string,
  filePath: string,
): void {
  if (!cascadeReachesGiven(root)) return;
  const basePlanned = new Set<unknown>();
  if (isIfCascadeNodeOnly(root)) {
    const basePlans: ArmPlan[] = [];
    if (planIfCascade(root, sourceText, filePath, basePlans, { yes: false }, isIfCascadeNodeOnly)) {
      for (const bp of basePlans) basePlanned.add(bp.arm);
    }
  }
  for (const p of plans) {
    if (!basePlanned.has(p.arm)) p.keepPieces = true;
  }
}

/**
 * Collect the rewrite plan for a whole if-cascade — `else if` links and `if`s
 * NESTED inside an arm included (a nested `if` arm is not itself one
 * expression, so the outer arm is classified `null` while the inner arms plan;
 * `stmtContainsLift` then finds the lift through the cascade and the whole
 * interpolation renders).
 *
 * Returns null when any markup arm anywhere in the cascade declined.
 */
function planIfCascade(
  ifNode: Record<string, unknown>,
  sourceText: string,
  filePath: string,
  out: ArmPlan[],
  seenNonMarkupValueArm: { yes: boolean } = { yes: false },
  isCascade: (n: Record<string, unknown>) => boolean = isCascadeNode,
): boolean {
  for (const key of ["consequent", "alternate", "body"]) {
    const arm = ifNode[key];
    if (!Array.isArray(arm)) continue;
    if (isNonMarkupValueArm(arm)) {
      // A cascade may not mix a markup arm with a plain value arm — see
      // isNonMarkupValueArm.
      if (out.length > 0) return false;
      seenNonMarkupValueArm.yes = true;
      continue;
    }
    const plan = planArm(arm, sourceText, filePath);
    if (plan === "declined") return false;
    if (plan) {
      if (seenNonMarkupValueArm.yes) return false;
      out.push(plan);
      continue;
    }
    for (const child of arm) {
      const rec = child as Record<string, unknown> | null;
      if (rec && isCascade(rec)) {
        if (!planIfCascade(rec, sourceText, filePath, out, seenNonMarkupValueArm, isCascade)) return false;
      }
    }
    // ⛑ THE ALL-OR-NOTHING INVARIANT HAS TO BE CHECKED HERE, NOT IN `planArm`.
    //
    // `planArm` classifies by `pieces[0]`, so an arm whose markup is not the
    // FIRST piece — `else { @k = 1  <p>B</p> }`, `else { log(x)  <p>B</p> }`,
    // ordinary adopter code — came back `null`, which this loop read as "no
    // markup here, no reason to abandon the cascade". The OTHER arms then
    // converted and this one stayed dropped: a HALF-RENDER, measured in both arm
    // positions and in a three-arm cascade's middle arm, at exit 0 with no
    // diagnostic. That is precisely the failure this module's header calls
    // "a worse failure than the uniform drop it replaces, because the working
    // half argues the construct is supported" — the invariant was stated and
    // then not enforced for this shape.
    //
    // So `null` is reserved for an arm containing NO markup at all. An arm that
    // holds markup somewhere but could not be planned as exactly one markup
    // expression declines the WHOLE cascade, reverting it to pre-existing
    // behaviour. The nested-`if` recursion above still runs first, so the
    // genuine container case (an arm that IS a nested `if`) keeps working.
    if (armHoldsMarkup(arm, sourceText, isCascade)) return false;
  }
  return true;
}

/**
 * A markup opener/closer in EXACT source text. `<` must be followed immediately
 * by a name character, so a less-than comparison (`a < b`) cannot match.
 */
const MARKUP_OPENER_SRC = /<\/?[A-Za-z][A-Za-z0-9:-]*[\s/>]/;
/**
 * The same, in TOKENIZER-REJOINED text, where the tokenizer has inserted spaces
 * (`"1 < p > MARKA < / p >"`). Necessarily looser, so `a < b > c` matches too —
 * a false positive here only makes the pass DECLINE, which reverts the cascade
 * to pre-existing behaviour. Over-declining is the safe direction; the whole
 * point of this predicate is that under-declining half-renders.
 */
const MARKUP_OPENER_REJOINED = /<\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*\s*[\s/>]/;

/**
 * True when the arm holds markup ANYWHERE — the test that separates "no markup
 * here, skip this arm" from "markup we could not lower, so the cascade must not
 * half-convert".
 *
 * ⛑ WHY THIS IS A TEXT TEST AND NOT A NODE-KIND TEST. The obvious form — "is any
 * piece an `html-fragment` starting with `<`" — does NOT catch the shape that
 * exposed the bug. `{ @k = 1  <p>A</p> }` parses to a SINGLE `state-decl` whose
 * `init` string is `"1 < p > MARKA < / p >"`: the markup is SWALLOWED into the
 * preceding statement's raw text and there is no fragment node at all
 * (AST-dumped, not inferred — that swallowing is a separate pre-existing parse
 * defect, and this predicate must be correct in spite of it rather than assume
 * it away). So the question is asked of TEXT, at two levels:
 *   1. the arm's exact SOURCE EXTENT, with the tight regex — authoritative;
 *   2. every string field of every piece, with the rejoined regex — the fallback
 *      when a piece carries no usable span.
 * Either one firing declines. Both are conservative-safe.
 */
function armHoldsMarkup(
  arm: unknown[],
  sourceText: string,
  isCascade: (n: Record<string, unknown>) => boolean = isCascadeNode,
): boolean {
  for (const piece of arm as Record<string, unknown>[]) {
    if (!piece) continue;
    // ⛑ SCAN PER PIECE, AND SKIP `if-stmt` PIECES. A nested `if` is the genuine
    // container case: `planIfCascade` has already recursed into it and planned
    // ITS arms, so the markup inside it is accounted for. Scanning the arm's
    // WHOLE extent instead declined every `else if` cascade and every nested-`if`
    // arm — the outer arm's extent spans the inner arms' markup — which broke two
    // shapes the fix had already covered. Measured, both directions.
    if (isCascade(piece)) continue;
    if (piece.kind === "bare-expr") {
      const k = (piece.exprNode as Record<string, unknown> | undefined)?.kind;
      if (k === "markup" || k === "markup-value") return true;
    }
    // (1) this piece's exact source extent — authoritative.
    const s = spanOf(piece);
    if (sourceText.length > 0 && s && s.end > s.start && s.end <= sourceText.length) {
      if (MARKUP_OPENER_SRC.test(sourceText.slice(s.start, s.end))) return true;
    }
    // (2) this piece's own text, for a span that is absent or slice-relative.
    for (const key of ["content", "init", "expr", "raw", "text", "value"]) {
      const v = piece[key];
      if (typeof v === "string" && MARKUP_OPENER_REJOINED.test(v)) return true;
    }
  }
  return false;
}

/**
 * s461 — the pre-desugar pieces a `given`-body implied lift carries for the
 * checkers (see applyPlans), or null for any other node.
 */
export function impliedLiftCheckPieces(node: unknown): unknown[] | null {
  const r = node as Record<string, unknown> | null | undefined;
  if (!r || r.kind !== "lift-expr" || r._impliedLift !== true) return null;
  const w = r._preDesugarPieces as { nodes?: unknown } | undefined;
  return w && Array.isArray(w.nodes) ? w.nodes : null;
}

/** Apply a planned cascade rewrite: each arm becomes a single `lift-expr`. */
function applyPlans(plans: ArmPlan[], counter: { next: number }): void {
  for (const p of plans) {
    renumber(p.markupNode, counter);
    // s461 — an arm the pre-s461 pass would not have desugared keeps its
    // pre-desugar pieces (the `html-fragment` / `logic` run the parser produced)
    // beside the lift, for the CHECKERS only (`keepPiecesForArmsBaseNeverPlanned`).
    // The type system's `lift-expr` arm and the §42 presence reader do not descend
    // into a lift's markup, so without the pieces every read in such an arm —
    // `${@typo}` (E-STATE-UNDECLARED), `${nosuch}` (E-SCOPE-001), an unguarded
    // `${@o.opt.x}` (E-TYPE-046) — would stop being judged the moment it started
    // rendering: a newly-ACCEPTING change the s461 lowering fix must not make. Both
    // consumers judge the pieces exactly as before (`impliedLiftCheckPieces`). An
    // OBJECT wrapper, not an array, so the generic array-key walkers do not see the
    // reads twice. An arm the old pass already desugared gets none: its markup is
    // unchecked today by that same hole (pre-existing; widening it is
    // newly-REJECTING — reported).
    const pieces = p.keepPieces ? p.arm.slice() : null;
    p.arm.length = 0;
    p.arm.push({
      id: ++counter.next,
      kind: "lift-expr",
      expr: { kind: "markup", node: p.markupNode },
      span: p.span,
      // Provenance marker: this `lift` was written by §17.6.10's sugar, not by
      // the author. Consumers that want to distinguish them (diagnostic wording,
      // E-LIFT-002 multiplicity messaging) have the bit; nothing reads it yet.
      _impliedLift: true,
      ...(pieces ? { _preDesugarPieces: { nodes: pieces } } : {}),
    });
  }
}

/**
 * Entry point. Mutates `ast` in place; returns the number of arms desugared.
 *
 * Scope: an `if-stmt` at the TOP LEVEL of a `logic` node's body (`${ … }`) —
 * the render position §17.6.10 governs — and any `if-stmt` nested inside such a
 * cascade's arms. Deliberately NOT applied inside a `function-decl` body: a
 * `lift` there is not an accumulation into a markup parent, so synthesising one
 * would change what the code means rather than restore what it says.
 */
export function desugarImpliedLiftMarkupArms(
  ast: unknown,
  sourceText: string,
  filePath: string,
): number {
  if (!ast || typeof ast !== "object") return 0;
  const src = typeof sourceText === "string" ? sourceText : "";
  // Cheap pre-filter: no `if` in the source, nothing to do. Only usable when a
  // source was supplied — shape B (the native parser's `markup-value` arm)
  // needs none, so a caller that has no source still gets that path.
  if (src.length > 0 && !/\b(?:if|given)\b/.test(src)) return 0;

  const counter = { next: maxNodeId(ast) };
  let rewritten = 0;
  const seen = new Set<unknown>();

  const walk = (node: unknown, inFunction: boolean): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const e of node) walk(e, inFunction);
      return;
    }
    const rec = node as Record<string, unknown>;
    const nowInFunction = inFunction || rec.kind === "function-decl";

    if (!nowInFunction && rec.kind === "logic" && Array.isArray(rec.body)) {
      for (const stmt of rec.body) {
        const s = stmt as Record<string, unknown> | null;
        if (s && isCascadeNode(s)) {
          const plans: ArmPlan[] = [];
          // ALL-OR-NOTHING per cascade. A cascade with one convertible arm and
          // one arm outside §17.6.10's grammar would otherwise render half of
          // itself and silently drop the rest — a worse failure than the
          // uniform drop it replaces, because the working half argues the
          // construct is supported.
          if (planIfCascade(s, src, filePath, plans) && plans.length > 0) {
            keepPiecesForArmsBaseNeverPlanned(s, plans, src, filePath);
            applyPlans(plans, counter);
            rewritten += plans.length;
          }
        }
      }
    }

    for (const key of CONTAINER_KEYS) {
      if (key in rec) walk(rec[key], nowInFunction);
    }
  };

  walk(ast, false);
  return rewritten;
}
