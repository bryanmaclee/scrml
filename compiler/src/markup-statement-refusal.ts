/**
 * markup-statement-refusal.ts — the ONE message for E-MARKUP-STATEMENT-NOT-RENDERED.
 *
 * Ruling S462 Q24 "a" (user-voice-scrml.md): markup written as a statement in a logic
 * body that would not be rendered is a compile ERROR "whose message says it is not
 * rendered and names the fix (`lift <…>`, or make it the arm's single element)";
 * "nothing vanishes silently". Code name + message ruled S464 ("E-MARKUP-STATEMENT-
 * NOT-RENDERED"): "this markup is in statement position and is not rendered — write
 * `lift <p>…</p>`".
 *
 * Two emitters share it, so the wording cannot drift between them:
 *   - the TAB (`ast-builder.js` `refuseSwallowedStatementMarkup`) — an element on a later
 *     line that a statement's expression read into itself as code;
 *   - codegen (`codegen/emit-logic.ts`, the `html-fragment` case) — a statement-position
 *     element that reached logic emission because no lowering rendered it.
 */
export function markupNotRenderedMessage(tag: string): string {
  const t = tag || "p";
  return (
    `E-MARKUP-STATEMENT-NOT-RENDERED: this markup is in statement position and is not rendered — ` +
    `write \`lift <${t}>…</${t}>\`. ` +
    `Markup written as a statement in a logic block renders only as the single element of an ` +
    `\`if\` / \`given\` branch (§17.6.10); \`lift\` is the explicit way to render from logic (§10.1). ` +
    `If the element's text holds a \`<\` or a quoted closing tag, put that text in an interpolation ` +
    `(\`\${"a < b"}\`). In a \`function\` body, \`return\` the markup instead (§10.4).`
  );
}
