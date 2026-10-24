/**
 * engine-in-each-row — the one diagnostic text for an `<engine>` declared inside an
 * `<each>` row template (§51.0.K, S439 ruling #10; gap g-engine-inside-each-row-renders-nothing).
 *
 * Two sites report it, with the SAME code and text:
 *   - symbol-table.ts PASS 13.B (`walkRejectEnginesInEachRows`) — every row the TAB parse
 *     materialised (the common case; reported with the engine's source span);
 *   - codegen emit-each.ts `renderTemplateChildToJs` — the backstop for a row template the
 *     TAB never parsed (an `<each>` inside a `<match>` arm is parsed only by codegen
 *     `buildMatchArms`). SYM marks every engine it refused with `ENGINE_IN_ROW_REFUSED` so
 *     the backstop does not report it a second time.
 */

export const ENGINE_IN_ROW_CODE = "E-COMPONENT-ENGINE-SCOPE";

/** Marker SYM sets on an `engine-decl` it refused (codegen skips re-reporting it). */
export const ENGINE_IN_ROW_REFUSED = "_engineInEachRowRefused";

/**
 * Marker codegen sets on the `engine-decl` nodes of its OWN arm-body parse (emit-match
 * `buildMatchArms`): those spans are local to the arm body, so a refusal is located at
 * the enclosing `<match>` (this field holds that match's file span).
 */
export const ENGINE_HOST_SPAN = "_engineHostSpan";

export function stampEngineHostSpan(nodes: unknown, hostSpan: unknown): void {
  if (!hostSpan || typeof hostSpan !== "object") return;
  const seen = new WeakSet<object>();
  const visit = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (n.kind === "engine-decl" && n[ENGINE_HOST_SPAN] === undefined) n[ENGINE_HOST_SPAN] = hostSpan;
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent" || k === ENGINE_HOST_SPAN) continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(nodes);
}

/**
 * An `<engine>` in the `<empty>` fallback of an `<each>` that is NOT in a row. That is not a
 * multi-instance position (the fallback renders once, while the list is empty), so the
 * §51.0.K row rule does not reach it — but impl#1's list renderer has no engine lowering and
 * dropped it at exit 0. Refused as an unsupported emission (E-CG-003, fail closed), not as a
 * language rule; whether it should render is an open question (s469-engine-in-row).
 */
export function engineInEachEmptyMessage(governedType: unknown): string {
  const type = typeof governedType === "string" && governedType.length > 0 ? governedType : "Type";
  return (
    `E-CG-003: \`<engine for=${type} ...>\` inside the \`<empty>\` fallback of an \`<each>\` cannot ` +
    `be emitted — the list renderer has no engine lowering, so it would render nothing. It is ` +
    `refused rather than dropped. Declare the engine outside the \`<each>\` and read its cell ` +
    `in the fallback.`
  );
}

export function engineInEachRowMessage(governedType: unknown): string {
  const type = typeof governedType === "string" && governedType.length > 0 ? governedType : "Type";
  return (
    `${ENGINE_IN_ROW_CODE}: \`<engine for=${type} ...>\` is declared inside an \`<each>\` row. ` +
    `A row is a multi-instance context — one row per item — and an engine is a singleton, ` +
    `so an engine cannot be declared in a row. ` +
    `Per-row state is spelled as an ordinary declaration, which gets a keyed instance per ` +
    `row (§66.7.3). For one state machine shared by every row, declare the engine outside ` +
    `the \`<each>\` and read its cell in the row. ` +
    `(SPEC §51.0.K + §34.)`
  );
}
