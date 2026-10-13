/**
 * markup-statement-refusal.ts — E-MARKUP-STATEMENT-NOT-RENDERED (SPEC §17.6.10.1): the
 * message, and the whole-tree check that makes the rule hold in every logic body.
 *
 * Ruling S462 Q24 "a" (user-voice-scrml.md): markup written as a statement in a logic
 * body that would not be rendered is a compile ERROR "whose message says it is not
 * rendered and names the fix (`lift <…>`, or make it the arm's single element)";
 * "nothing vanishes silently". Code name + message ruled S464 ("E-MARKUP-STATEMENT-
 * NOT-RENDERED"): "this markup is in statement position and is not rendered — write
 * `lift <p>…</p>`".
 *
 * Emitters:
 *   - the TAB (`ast-builder.js` `refuseSwallowedStatementMarkup`) — an element a
 *     statement's expression read in as code (no fragment exists for later stages);
 *   - codegen, once per run before any emission (`codegen/index.ts` → `refuseUnrendered
 *     StatementMarkup` below) — every statement-position element fragment (`_markupLead`)
 *     still in the tree after the §17.6.10 implied-lift desugar, in EVERY logic body:
 *     `${ … }`, function bodies, `<each>` rows, `<match>` arms, engine state-children and
 *     `effect=`, component bodies. Those contexts are lowered by different emitters (some
 *     re-parse the body, one rendered a bare `${ <p/> }` as a markup value), so the check
 *     is made once over the tree rather than in each emitter;
 *   - codegen's `emit-logic.ts` `html-fragment` case — the same refusal for a fragment
 *     that a later re-parse produced and logic emission reached (deduplicated by anchor).
 */

/**
 * Where the markup sits — decides which fix the message names:
 *   - "logic":    a `${ }` body or an `fn` body — `lift` it (§10.1, §48.5);
 *   - "function": a `function` declaration body — `return` it (§10.4: `lift` in a bare
 *                 `function` body is E-SYNTAX-002);
 *   - "function-value": an arrow / function-expression BLOCK body — return it from an
 *                 expression-bodied arrow or a `function` declaration (a markup `return`
 *                 from a block body does not lower yet);
 *   - "effect":   an event handler, a `when … changes` body, an engine `effect=` — code
 *                 run for its effects, which renders nothing at all.
 */
export type MarkupStatementContext = "logic" | "function" | "function-value" | "effect";

/**
 * Why a single-element branch did not render: a SIBLING branch of the same `if` / `given`
 * is not a single element, so the cascade does not convert (all-or-nothing, §17.6.10).
 *   - "sibling-lift":  a sibling branch uses `lift`;
 *   - "sibling-other": a sibling branch holds statements, or more than one element.
 */
export type MarkupStatementCause = "sibling-lift" | "sibling-other";

const HEAD = "E-MARKUP-STATEMENT-NOT-RENDERED: this markup is in statement position and is not rendered — ";
const TEXT_HINT =
  `If the element's text holds a \`<\` or a quoted closing tag, put that text in an interpolation ` +
  `(\`\${"a < b"}\`).`;

export function markupNotRenderedMessage(
  tag: string,
  context: MarkupStatementContext = "logic",
  cause?: MarkupStatementCause,
): string {
  const t = tag || "p";
  if (context === "effect") {
    return (
      HEAD +
      `an event handler, a \`when\` body or an engine \`effect=\` runs for its effects and renders nothing: ` +
      `change state here and render the markup from that state in markup ` +
      `(\`@shown = true\` here, \`<${t} if=@shown>…</${t}>\` in the page).`
    );
  }
  if (context === "function-value") {
    // S464 r3 (R2-5) — `return <p>…</p>` from an arrow / function-expression BLOCK body
    // does not lower today (it is emitted as raw markup and refused by the emitted-JS
    // parse floor — g-arrow-block-body-markup-return-codegen-invalid-s464), so the advice
    // names the two forms that compile and render (verified): an expression-bodied arrow,
    // or a `function` declaration that returns the markup.
    return (
      HEAD +
      `a function body does not render markup: return it from an expression-bodied arrow, ` +
      `\`const f = () => <${t}>…</${t}>\`, or from a \`function\` declaration, ` +
      `\`function f() { return <${t}>…</${t}> }\`, and render the call in markup, \`\${f()}\`. ` +
      TEXT_HINT
    );
  }
  if (context === "function") {
    return (
      HEAD +
      `a function body does not render markup: \`return <${t}>…</${t}>\` and render the call in markup, ` +
      `\`\${f()}\` (§10.4). ` + TEXT_HINT
    );
  }
  if (cause) {
    const why = cause === "sibling-lift"
      ? "another branch of the same `if` uses `lift`"
      : "another branch of the same `if` holds statements or more than one element";
    return (
      HEAD +
      `it is the single element of its branch, but ${why}, and a single-element branch renders ` +
      `only when EVERY branch is one (§17.6.10). Make every branch a single element, or write ` +
      `\`lift <${t}>…</${t}>\` in every branch.`
    );
  }
  return (
    HEAD +
    `write \`lift <${t}>…</${t}>\`. ` +
    `Markup written as a statement in a logic block renders only as the single element of an ` +
    `\`if\` / \`given\` branch (§17.6.10); \`lift\` is the explicit way to render from logic (§10.1). ` +
    TEXT_HINT
  );
}

/** A statement-position element's lead, as the TAB records it (`_markupLead`). */
export interface MarkupLead {
  tag: string;
  span: object;
  /** Set when the TAB already reported this element (handlers, engine `effect=`). */
  _reportedAtTab?: boolean;
}

/** One lead per native-spelling statement / `when` body, so a re-run reports it once. */
const syntheticLeads: WeakMap<object, MarkupLead> = new WeakMap();

function leadFor(holder: Record<string, unknown>, markupValue: Record<string, unknown>, span: unknown): MarkupLead {
  let lead = syntheticLeads.get(holder);
  if (!lead) {
    const node = markupValue.node as Record<string, unknown> | undefined;
    lead = { tag: String(node?.tag ?? "p"), span: ((holder._refusalSpan ?? span) as object) ?? { start: 0, end: 0 } };
    syntheticLeads.set(holder, lead);
  }
  return lead;
}

const CASCADE_KINDS = new Set(["if-stmt", "given-guard"]);

/** The arms (statement lists) of an `if` / `given` cascade, `else if` links followed. */
function cascadeArms(node: Record<string, unknown>, out: unknown[][] = []): unknown[][] {
  for (const key of ["consequent", "alternate", "body"]) {
    const arm = node[key];
    if (!Array.isArray(arm)) continue;
    if (key === "alternate" && arm.length === 1 && arm[0] && CASCADE_KINDS.has((arm[0] as Record<string, unknown>).kind as string)) {
      cascadeArms(arm[0] as Record<string, unknown>, out);
      continue;
    }
    out.push(arm);
  }
  return out;
}

/** "single" = exactly one element written bare (fragment pieces only); "lift"; "other". */
function armShape(arm: unknown[]): "single" | "lift" | "other" | "empty" {
  if (arm.length === 0) return "empty";
  let leads = 0;
  let lift = false;
  for (const p of arm as Record<string, unknown>[]) {
    if (!p) continue;
    if (p.kind === "lift-expr") lift = true;
    else if (p.kind === "html-fragment") { if (p._markupLead) leads++; }
    else if (p.kind !== "logic") return lift ? "lift" : "other";
  }
  if (lift) return "lift";
  return leads === 1 ? "single" : "other";
}

/**
 * Walk a tree and report every statement-position element that no lowering renders:
 *   - an `html-fragment` carrying `_markupLead` still in the tree after the §17.6.10
 *     desugar;
 *   - a STATEMENT whose whole expression is one markup value (`bare-expr{exprNode:{kind:
 *     "markup-value"}}`) — how a component body is re-parsed (component-expander
 *     `reparseSynthesizedFile`); a single-element branch of that spelling was already
 *     desugared to a `lift` (implied-lift-desugar shape B), so one left here is not
 *     rendered. (A markup value nested IN an expression — a ternary arm, a call argument —
 *     has a different exprNode kind and is a value, not this.)
 *   - a `when … changes { <p/> }` body (`when-effect.bodyExpr` a markup value).
 *
 * Not reported:
 *   - a fragment AFTER a `lift-expr` in the same statement list — the continuation pieces
 *     of a fragmented `lift <…>` (emit-lift `emitConsolidatedLift` reassembles them);
 *   - a lead the TAB already reported (`_reportedAtTab`);
 *   - anything under an `_`-prefixed key — compiler bookkeeping copies (e.g. the implied
 *     lift's `_preDesugarPieces`, kept for the checkers only), not program text.
 *
 * `report` receives the lead (the anchor that de-duplicates the diagnostic), the context
 * (which fix the message names) and, for a single-element branch a sibling branch kept
 * from converting, the cause.
 */
export function refuseUnrenderedStatementMarkup(
  root: unknown,
  report: (lead: MarkupLead, context: MarkupStatementContext, cause?: MarkupStatementCause) => void,
  initialContext: MarkupStatementContext = "logic",
): void {
  const seen = new Set<unknown>();
  const causes = new Map<unknown, MarkupStatementCause>();
  const emit = (lead: MarkupLead, ctx: MarkupStatementContext) => {
    if (lead._reportedAtTab) return;
    report(lead, ctx, ctx === "logic" ? causes.get(lead) : undefined);
  };
  const walk = (n: unknown, ctx: MarkupStatementContext): void => {
    if (n === null || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      let afterLift = false;
      for (const e of n) {
        const rec = e as Record<string, unknown> | null;
        if (rec && typeof rec === "object" && !Array.isArray(rec)) {
          if (rec.kind === "lift-expr") afterLift = true;
          if (rec.kind === "html-fragment" && rec._markupLead && !afterLift) emit(rec._markupLead as MarkupLead, ctx);
          if (rec.kind === "bare-expr" && !afterLift) {
            const en = rec.exprNode as Record<string, unknown> | undefined;
            if (en && en.kind === "markup-value") emit(leadFor(rec, en, rec.span), ctx);
          }
        }
        walk(e, ctx);
      }
      return;
    }
    const rec = n as Record<string, unknown>;
    let next = ctx;
    // A `fn` body is NOT a function context: `lift` is valid in it (§48.5).
    if (rec.kind === "function-decl") next = rec.fnKind === "fn" ? "logic" : "function";
    else if (rec.kind === "when-effect") {
      // S464 r3 — a `when` body is checked at the TAB from its own tokens (ast-builder
      // refuseEffectBodyMarkup), at the element's position; nothing to add here.
      next = "effect";
    }
    if (CASCADE_KINDS.has(rec.kind as string)) {
      const arms = cascadeArms(rec);
      const shapes = arms.map(armShape);
      if (shapes.includes("single") && shapes.some((s) => s === "lift" || s === "other")) {
        const cause: MarkupStatementCause = shapes.includes("lift") ? "sibling-lift" : "sibling-other";
        arms.forEach((arm, i) => {
          if (shapes[i] !== "single") return;
          for (const p of arm as Record<string, unknown>[]) if (p && p._markupLead) causes.set(p._markupLead, cause);
        });
      }
    }
    for (const k of Object.keys(rec)) {
      if (k.startsWith("_") || k === "span") continue;
      walk(rec[k], next);
    }
  };
  walk(root, initialContext);
}
