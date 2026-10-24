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

/**
 * An `<engine>` anywhere under a branch of a §17.1.1 `if=` / `else-if=` / `else` chain
 * (gap g-engine-in-if-else-chain-branch-renders-nothing-s469). A chain branch is a
 * SINGLETON position — the language allows an engine there (§17.1.1 places no limit on a
 * branch's content; §51.0.D: declaration is mount) — but impl#1's chain renderer
 * (emit-html.ts, the `if-chain` branch `<template>`s) has no engine lowering: the engine
 * compiled at exit 0 and rendered nothing in ANY branch. A lone `if=` (not a chain) renders
 * an engine and is not affected. Refused as an unsupported emission (E-CG-003, fail closed),
 * not as a language rule; rendering it is owed to the bootstrap.
 */
export function engineInIfChainMessage(governedType: unknown, branchForm: string): string {
  const type = typeof governedType === "string" && governedType.length > 0 ? governedType : "Type";
  return (
    `E-CG-003: \`<engine for=${type} ...>\` inside the \`${branchForm}\` branch of an ` +
    `\`if=\` / \`else-if=\` / \`else\` chain cannot be emitted by impl#1 — its chain renderer has ` +
    `no engine lowering, so the engine would render nothing. The language allows an engine ` +
    `here (§17.1.1, §51.0.D); impl#1 refuses it rather than dropping it. Workaround: declare ` +
    `the engine outside the chain and gate its contents — e.g. \`<engine if=COND for=${type} ...>\` ` +
    `beside the chain, or replace the chain with separate \`if=\` elements whose conditions ` +
    `exclude each other (an engine under a lone \`if=\` renders).`
  );
}

/** Marker set on an `engine-decl` refused by the if-chain check (reported once). */
export const ENGINE_IN_IF_CHAIN_REFUSED = "_engineInIfChainRefused";

/**
 * Every `engine-decl` under `root` that the if-chain check owns, outermost first. Total
 * descent over object-valued keys (not a list of container keys — an if-chain keeps its
 * branches under `branches[].element` / `elseBranch`, which a key list misses). It does NOT
 * descend into:
 *   - an `engine-decl` (an engine nested in a refused engine is reported once, the outer);
 *   - an `each-block` — its row and `<empty>` positions carry their own refusals
 *     (E-COMPONENT-ENGINE-SCOPE / E-CG-003, `engineInEachRowMessage` / `engineInEachEmptyMessage`);
 *   - a `match-block` — an engine in a `<match>` arm is its own drop
 *     (g-engine-in-match-arm-emits-nothing-s469), independent of the chain.
 * Engines already refused by the row rule (`ENGINE_IN_ROW_REFUSED`) are skipped.
 */
export function collectEnginesUnderIfChainBranch(root: unknown): any[] {
  const out: any[] = [];
  const seen = new WeakSet<object>();
  const visit = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (n.kind === "engine-decl") {
      if (n[ENGINE_IN_ROW_REFUSED] !== true) out.push(n);
      return;
    }
    if (n.kind === "each-block" || n.kind === "match-block") return;
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent" || k === ENGINE_HOST_SPAN) continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(root);
  return out;
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
