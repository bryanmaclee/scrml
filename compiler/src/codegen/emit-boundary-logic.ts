// emit-boundary-logic.ts
// ---------------------------------------------------------------------------
// §19.6.6 (S468) — the RENDER-time logic statements inside an `<errorBoundary>`
// run inside the boundary's catch.
//
// "`<errorBoundary>` SHALL catch error variants produced by any `!` function
// call made while RENDERING its direct or nested markup content" (§19.6.6). A
// `!` call RETURNS its error; the type system marks every render-time call the
// boundary handles and codegen lowers it to `_scrml_error_boundary_check(call)`,
// which raises the error so the rest of the render stops (runtime-template.js).
//
// An interpolation `${…}` is caught by its own render function
// (emit-event-wiring.ts). A STATEMENT in the boundary's content
// (`${ const ok = check(p) }`) is module-init code (emit-reactive-wiring.ts),
// outside every render function, so the statements of such a `${}` block are
// emitted inside `_scrml_error_boundary_run(id, body, display)` — one run per
// enclosing boundary, the innermost inside, so the innermost catches first
// (§19.6.4) and a failure it cannot display propagates outward (§19.6.8 B3).
//
// The body becomes a function, so the block's top-level declarations — which
// SPEC §7.6 puts in file scope, and which the page's later interpolations read
// — are hoisted out of it: `const ok = e` becomes `let ok;` before the run and
// `ok = e` inside it. Function declarations move out whole (they hoist anyway).
// The rewrite reads the emitted JS with acorn (the tree, not the text — Rule 7).
// ---------------------------------------------------------------------------

import * as acorn from "acorn";
import { PH_EB_CHECK } from "../placeholder-nonce.ts";

/** One enclosing boundary's display data (emit-html.ts `ActiveBoundary`). */
export interface BoundaryCatchInfo {
  boundaryId: string;
  /** JS string expression of the `fallback=` HTML (reads `_scrml_eb_result && _scrml_eb_result.data`). */
  fallbackExpr: string;
  hasFallback: boolean;
  /** variant name -> JS string expression of its `renders` HTML (reads `_scrml_eb_result.data`). */
  variantRenders: Record<string, string>;
}

/**
 * `function (_scrml_eb_result) { … }` — the HTML boundary `b` shows for a
 * caught failure: a typed error (the envelope) shows its variant's `renders`
 * markup first, then the boundary's `fallback=` (§19.6.5); a host throw
 * (`_scrml_eb_result` null) shows the `fallback=` (§19.6.8 B2). `null` means
 * the boundary cannot display it (§19.6.8 B3 — propagate).
 */
export function boundaryDisplayFn(b: BoundaryCatchInfo, indent: string): string {
  const lines: string[] = [];
  lines.push(`function (_scrml_eb_result) {`);
  const variants = Object.keys(b.variantRenders ?? {});
  if (variants.length > 0) {
    lines.push(`${indent}  if (_scrml_eb_result) {`);
    lines.push(`${indent}    switch (_scrml_eb_result.variant) {`);
    for (const v of variants) {
      lines.push(`${indent}      case ${JSON.stringify(v)}: return (${b.variantRenders[v]});`);
    }
    lines.push(`${indent}    }`);
    lines.push(`${indent}  }`);
  }
  lines.push(b.hasFallback
    ? `${indent}  return (${b.fallbackExpr}); // boundary fallback (§19.6.5)`
    : `${indent}  return null; // no fallback — propagate (§19.6.8 B3)`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function parse(js: string): any | null {
  try {
    return acorn.parse(js, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true });
  } catch {
    return null;
  }
}

function patternNames(p: any, out: string[]): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.push(p.name); return;
    case "ObjectPattern": for (const pr of p.properties) patternNames(pr.type === "RestElement" ? pr.argument : pr.value, out); return;
    case "ArrayPattern": for (const el of p.elements) patternNames(el, out); return;
    case "RestElement": patternNames(p.argument, out); return;
    case "AssignmentPattern": patternNames(p.left, out); return;
  }
}

/**
 * Wrap module-init JS `code` (one boundary `${}` block's emitted statements) in
 * the catch of every boundary in `chain` (outermost first). Returns null when
 * the code does not parse (it always does — it is the compiler's own output —
 * and the caller then refuses the lowering rather than ship it uncaught).
 */
export function wrapBoundaryRenderLogic(code: string, chain: BoundaryCatchInfo[]): string | null {
  if (chain.length === 0) return code;
  const ast = parse(code);
  if (!ast) return null;
  const letNames: string[] = [];
  const varNames: string[] = [];
  const hoisted: string[] = [];
  const body: string[] = [];
  const src = (n: any): string => code.slice(n.start, n.end);
  for (const st of ast.body) {
    if (st.type === "FunctionDeclaration") { hoisted.push(src(st)); continue; }
    if (st.type === "ClassDeclaration" && st.id) {
      letNames.push(st.id.name);
      body.push(`${st.id.name} = ${src(st)};`);
      continue;
    }
    if (st.type === "VariableDeclaration") {
      const names = st.kind === "var" ? varNames : letNames;
      for (const d of st.declarations) {
        patternNames(d.id, names);
        if (!d.init) continue;
        body.push(d.id.type === "Identifier"
          ? `${d.id.name} = ${src(d.init)};`
          : `(${src(d.id)} = ${src(d.init)});`);
      }
      continue;
    }
    body.push(src(st));
  }
  const out: string[] = [];
  out.push(`// §19.6.6 — render-time logic inside <errorBoundary>: a \`!\` call that fails here is caught by the boundary.`);
  if (letNames.length > 0) out.push(`let ${letNames.join(", ")};`);
  if (varNames.length > 0) out.push(`var ${varNames.join(", ")};`);
  out.push(...hoisted);
  // Innermost run inside: build from the inside out. The body is NOT re-indented:
  // a multi-line template literal in it would change value.
  let inner = body.join("\n");
  for (let i = chain.length - 1; i >= 0; i--) {
    const b = chain[i];
    inner =
      `_scrml_error_boundary_run(${JSON.stringify(b.boundaryId)}, function () {\n` +
      `${inner}\n` +
      `}, ${boundaryDisplayFn(b, "")});`;
  }
  out.push(inner);
  return out.join("\n");
}

/** Does the expression tree hold a boundary-check placeholder call (type-system.ts `applyBoundaryCatchWraps`)? */
export function exprContainsBoundaryCheck(node: unknown): boolean {
  const name = PH_EB_CHECK();
  const seen = new Set<object>();
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const x = stack.pop();
    if (!x || typeof x !== "object" || seen.has(x as object)) continue;
    seen.add(x as object);
    const n = x as { kind?: unknown; callee?: { kind?: unknown; name?: unknown } };
    if (n.kind === "call" && n.callee && n.callee.kind === "ident" && n.callee.name === name) return true;
    for (const k of Object.keys(x as object)) if (k !== "span") stack.push((x as Record<string, unknown>)[k]);
  }
  return false;
}
