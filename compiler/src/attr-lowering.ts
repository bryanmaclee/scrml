/**
 * attr-lowering.ts — the attribute-name/value predicates that DECIDE a lowering,
 * in ONE place, so that a pass which only needs to KNOW the decision cannot
 * restate it and drift.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `codegen/emit-html.ts` decides how an attribute value is lowered. Two other
 * passes need to know the ANSWER without being able to reach the decision:
 *
 *   - `expr-positions.ts` classifies every expression position as a client
 *     BINDING read or not — the §14.8 confidentiality gate depends on it;
 *   - `codegen/client-read-seed.ts` consumes that classification.
 *
 * The g-263 convergence replaced two drifting AST walkers with one shared table,
 * and then RESTATED this predicate inside that table as `/^on[a-z]/` against
 * codegen's `name.startsWith("on")`. The two disagree on `on=`, `on-tap=`,
 * `on_tap=` and `on<digit>=`, and every one of those four MEASURED as an
 * under-emit: codegen wires `"_scrml_attr_on_tap_1": HANDLER,` into the client
 * handler table while the seed, believing the position static, left `HANDLER`
 * undeclared. A restated predicate is a drifting predicate; there is nothing to
 * type-check one copy against another.
 *
 * So the rule for this file is the same rule the shared position table lives
 * under: ONE decision, imported by everyone who needs it. If codegen's lowering
 * changes, every consumer moves with it in the same commit, because there is
 * only one thing to change.
 */

/**
 * Is this attribute name in the EVENT-HANDLER family, as codegen's attribute
 * lowering defines it?
 *
 * This is `emit-html.ts`'s own test, verbatim, and it is deliberately broader
 * than "a real DOM event": codegen routes ANY attribute whose name begins `on`
 * to event wiring, so `only=` and `once=` become event bindings too. That is a
 * separate question (whether codegen SHOULD narrow this) from the question this
 * file answers (what codegen DOES), and a confidentiality gate must answer the
 * second one or it under-emits.
 *
 * NOT case-folded, because codegen's test is not: `onClick=` does NOT take the
 * event route (`"onClick".startsWith("on")` is true — it DOES; `ONCLICK=` does
 * not). Matching codegen exactly is the entire point.
 */
export function isEventAttrName(attrName: unknown): boolean {
  return typeof attrName === "string" && attrName.startsWith("on");
}

/** A value that is a single JS identifier — no dots, no indexing, no call. */
const PLAIN_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Does a BARE (unquoted, non-parenthesized, non-call) attribute value — the
 * `{kind:"variable-ref"}` shape — become a JS BINDING REFERENCE in the emitted
 * client bundle?
 *
 * ═══ THIS IS THE ONLY BARE-VALUE SHAPE THAT PRODUCES A BINDING, AND THERE IS
 *     EXACTLY ONE ROUTE TO IT ═══
 *
 * `emit-html.ts`'s bare-ref event-handler route (§5.2.2 row 5) emits the source
 * name straight into the client handler table:
 *
 *     <button onclick=bump>   ->   "_scrml_attr_onclick_1": bump,
 *
 * so `bump` must be DECLARED in that bundle. Every other bare-value lowering
 * references the source some other way and needs no declaration at all:
 *
 *   - `if=X` / `if=X.f` / `if=X[0]`, and `if=` on `<each>`/`<match>`/`<engine>`,
 *     lower through the §17.1 mount gate as a REACTIVE-CELL read —
 *     `_scrml_cs_reactive_get("X")`, a STRING key into the cell store. MEASURED:
 *     the emitted bundle names `X` nowhere as an identifier. Emitting a
 *     declaration for it ships the value to the browser and buys nothing, which
 *     is how a server-only `export const` reached a `.client.js`.
 *   - `show=@x`, `bind:value=@x`, `class:on=@x`, `disabled=@x` likewise read the
 *     cell STORE inside an `_scrml_effect`; the cell name is a key, never a
 *     binding.
 *   - `class=X`, `title=X`, `value=X`, and a DOTTED bare event value
 *     (`onclick=X.go`, which fails the identifier test below) lower to a static
 *     HTML attribute string — `onclick="X.go"` — with no client wiring at all.
 *
 * The OTHER value shapes (a parenthesized `expr`, a `call-ref`, a `${…}`-bearing
 * string) do not consult this predicate: all three are MEASURED to emit a real
 * binding reference on every attribute name tested, `class=` / `title=` /
 * `data-*=` included.
 *
 * @param attrName the owning attribute's name.
 * @param bareValue the `variable-ref`'s raw name, `@` sigil included if present.
 */
export function bareAttrValueIsClientBinding(attrName: unknown, bareValue: unknown): boolean {
  if (typeof bareValue !== "string" || !bareValue) return false;
  if (!isEventAttrName(attrName)) return false;
  // A `@`-prefixed value names a reactive CELL; the event route rejects it and it
  // falls through to the static HTML attribute.
  if (bareValue.startsWith("@")) return false;
  return PLAIN_IDENTIFIER.test(bareValue);
}
