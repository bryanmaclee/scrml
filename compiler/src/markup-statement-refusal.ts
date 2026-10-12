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

/** Where the markup sits: a `${ }` logic body, or a `function` / `fn` body. */
export type MarkupStatementContext = "logic" | "function";

export function markupNotRenderedMessage(tag: string, context: MarkupStatementContext = "logic"): string {
  const t = tag || "p";
  if (context === "function") {
    // §10.4: `lift` in a bare `function` body is E-SYNTAX-002, so the ruled `lift` fix is
    // wrong here; the function's way to produce markup is to return it.
    return (
      `E-MARKUP-STATEMENT-NOT-RENDERED: this markup is in statement position and is not rendered — ` +
      `a function body does not render markup: \`return <${t}>…</${t}>\` and render the call in markup, ` +
      `\`\${f()}\` (§10.4). ` +
      `If the element's text holds a \`<\` or a quoted closing tag, put that text in an interpolation ` +
      `(\`\${"a < b"}\`).`
    );
  }
  return (
    `E-MARKUP-STATEMENT-NOT-RENDERED: this markup is in statement position and is not rendered — ` +
    `write \`lift <${t}>…</${t}>\`. ` +
    `Markup written as a statement in a logic block renders only as the single element of an ` +
    `\`if\` / \`given\` branch (§17.6.10); \`lift\` is the explicit way to render from logic (§10.1). ` +
    `If the element's text holds a \`<\` or a quoted closing tag, put that text in an interpolation ` +
    `(\`\${"a < b"}\`).`
  );
}

/** A statement-position element's lead, as the TAB records it (`_markupLead`). */
export interface MarkupLead {
  tag: string;
  span: object;
}

/**
 * Walk a file's tree and report every statement-position element fragment (an
 * `html-fragment` carrying `_markupLead`) that is still there after the §17.6.10
 * desugar — i.e. one that no lowering renders. `report` receives the lead (the anchor
 * that de-duplicates the diagnostic), and whether it sits in a function body.
 *
 * Not reported:
 *   - a fragment AFTER a `lift-expr` in the same statement list — the continuation
 *     pieces of a fragmented `lift <…>` (emit-lift `emitConsolidatedLift` reassembles
 *     them; they are rendered, by the `lift`);
 *   - anything under an `_`-prefixed key — compiler bookkeeping copies (e.g. the
 *     implied lift's `_preDesugarPieces`, kept for the checkers only), not program text.
 */
/** One lead per native-spelling statement, so a re-run reports it once (the anchor). */
const bareMarkupLeads: WeakMap<object, MarkupLead> = new WeakMap();

export function refuseUnrenderedStatementMarkup(
  root: unknown,
  report: (lead: MarkupLead, context: MarkupStatementContext) => void,
): void {
  const seen = new Set<unknown>();
  const walk = (n: unknown, inFunction: boolean): void => {
    if (n === null || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      let afterLift = false;
      for (const e of n) {
        const rec = e as Record<string, unknown> | null;
        if (rec && typeof rec === "object" && !Array.isArray(rec)) {
          if (rec.kind === "lift-expr") afterLift = true;
          if (rec.kind === "html-fragment" && rec._markupLead && !afterLift) {
            report(rec._markupLead as MarkupLead, inFunction ? "function" : "logic");
          }
          // The same statement in the native parser's spelling — a component body is
          // re-parsed that way (component-expander `reparseSynthesizedFile`): a STATEMENT
          // whose whole expression is one markup value (`bare-expr{exprNode:{kind:
          // "markup-value"}}`). A single-element branch of that spelling was already
          // desugared to a `lift` (implied-lift-desugar shape B), so one left here is
          // not rendered. (A markup value nested IN an expression — a ternary arm, a
          // call argument — has a different exprNode kind and is a value, not this.)
          if (rec.kind === "bare-expr" && !afterLift) {
            const en = rec.exprNode as Record<string, unknown> | undefined;
            if (en && en.kind === "markup-value") {
              let lead = bareMarkupLeads.get(rec);
              if (!lead) {
                const node = en.node as Record<string, unknown> | undefined;
                lead = { tag: String(node?.tag ?? "p"), span: (rec.span as object) ?? { start: 0, end: 0 } };
                bareMarkupLeads.set(rec, lead);
              }
              report(lead, inFunction ? "function" : "logic");
            }
          }
        }
        walk(e, inFunction);
      }
      return;
    }
    const rec = n as Record<string, unknown>;
    // A `fn` body is NOT a function context here: `lift` is valid in it (§48.5).
    const nowInFunction = rec.kind === "function-decl" ? rec.fnKind !== "fn" : inFunction;
    for (const k of Object.keys(rec)) {
      if (k.startsWith("_") || k === "span") continue;
      walk(rec[k], nowInFunction);
    }
  };
  walk(root, false);
}
