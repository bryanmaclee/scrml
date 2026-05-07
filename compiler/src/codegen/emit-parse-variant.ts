/**
 * @module codegen/emit-parse-variant
 *
 * §41.13 — parseVariant call-site monomorphization.
 *
 * For each call `parseVariant(json, EnumType)` annotated by the type-system
 * pass with `parseVariantEnum: EnumType`, emit a per-call-site IIFE that:
 *
 *   1. JSON-parses-or-passes-through the input  (`typeof _raw === "string" ? JSON.parse(_raw) : _raw`)
 *   2. Validates the value is an object with a `tag` string field
 *   3. Switches on `_v.tag`:
 *      - For each variant in EnumType.variants[]: emit a `case "VariantName":`
 *        arm that validates the payload (per-field type-check) and returns
 *        the variant value — bare string for unit variants, `{variant, data}`
 *        for payload variants (matches emitEnumVariantObjects shape).
 *      - default: returns a fail with ::ParseError::UnknownVariant(tag)
 *   4. On any failure path, returns a fail object — the call is marked
 *      failable returning ParseError by the TS pass, so the existing
 *      failable-call codegen ( !{} handler in emit-logic.ts:1004 ) picks
 *      it up via the `__scrml_error` sentinel.
 *
 * Server-vs-client codegen split: the emitted code is a synchronous
 * function-shaped IIFE — no SQL, no awaits, no server-only constructs. It
 * is safe to embed in either context.
 *
 * Risk #3 (survey): EnumType is read directly off the call-node annotation;
 * we do NOT extend serializeTypeEntry — this keeps the codegen clean and
 * avoids disturbing existing meta consumers.
 */

import { emitExpr, type EmitExprContext } from "./emit-expr.ts";
import type { CallExpr, ExprNode } from "../types/ast.ts";

// Mirror of the EnumType shape from type-system.ts. We accept a structural
// form to avoid a cross-module type dependency.
interface VariantPayload {
  // Map<string, ResolvedType> — keys are field names in declaration order;
  // values describe the field's type. We use `kind` for type-guard emission
  // and `name` for primitive types ("string", "number", "boolean", "integer").
  [Symbol.iterator]?: any;
}

interface VariantDef {
  name: string;
  payload: Map<string, any> | null;
  renders?: any;
}

export interface ParseVariantEnumLike {
  kind: "enum";
  name: string;
  variants: VariantDef[];
}

// ---------------------------------------------------------------------------
// Per-field type-guard emission
// ---------------------------------------------------------------------------

/**
 * Emit a runtime type-guard expression for a payload-field type. Returns a
 * JavaScript expression that evaluates to `true` if `varName` matches the
 * field type, `false` otherwise.
 *
 * Conservative — supports the primitive types that scrml's variant payloads
 * commonly use (string, number, integer, boolean). For complex types
 * (nested enums, structs, arrays) we accept any non-null value: the user
 * is responsible for calling parseVariant again at the inner level (per the
 * SCOPE doc's "no auto-recursion" rule).
 */
function emitTypeGuard(varName: string, fieldType: any): string {
  if (!fieldType || typeof fieldType !== "object") return `true`;
  const kind = fieldType.kind;
  if (kind === "primitive") {
    const name = fieldType.name as string | undefined;
    if (name === "string") return `typeof ${varName} === "string"`;
    if (name === "number") return `typeof ${varName} === "number" && !Number.isNaN(${varName})`;
    if (name === "integer") return `typeof ${varName} === "number" && Number.isInteger(${varName})`;
    if (name === "boolean") return `typeof ${varName} === "boolean"`;
    if (name === "int") return `typeof ${varName} === "number" && Number.isInteger(${varName})`;
  }
  if (kind === "predicated") {
    // Predicated types are runtime-refined elsewhere (§53 SPARK boundaries);
    // for parseVariant we check the base type only — predicate enforcement
    // happens at assignment to a typed cell (which is the boundary the spec
    // dictates as the predicate-enforcement point).
    const base = fieldType.baseType as string | undefined;
    if (base === "string") return `typeof ${varName} === "string"`;
    if (base === "number") return `typeof ${varName} === "number" && !Number.isNaN(${varName})`;
    if (base === "integer") return `typeof ${varName} === "number" && Number.isInteger(${varName})`;
    if (base === "boolean") return `typeof ${varName} === "boolean"`;
  }
  // Complex type: accept any non-null/non-undefined value. The user must
  // hand-roll deeper validation (e.g. another parseVariant call).
  return `${varName} != null`;
}

/**
 * Emit a fail-shape literal for a ParseError variant. The shape mirrors
 * emit-logic.ts:912's fail-expr emission and is dispatched by the existing
 * `!{}` handler (emit-logic.ts:1033).
 *
 *   MissingDiscriminator        -> { ..., variant: "MissingDiscriminator", data: {} }
 *   UnknownVariant(tagExpr)     -> { ..., variant: "UnknownVariant", data: { tag: tagExpr } }
 *   InvalidPayload(f, r)        -> { ..., variant: "InvalidPayload", data: { field: f, reason: r } }
 *   Malformed(reasonExpr)       -> { ..., variant: "Malformed", data: { reason: reasonExpr } }
 */
function emitParseErrorFail(variant: string, dataLiteral: string): string {
  return `{ __scrml_error: true, type: "ParseError", variant: ${JSON.stringify(variant)}, data: ${dataLiteral} }`;
}

// ---------------------------------------------------------------------------
// Per-variant case-arm emission
// ---------------------------------------------------------------------------

function emitVariantArm(variant: VariantDef): string[] {
  const lines: string[] = [];
  const tag = JSON.stringify(variant.name);
  lines.push(`    case ${tag}: {`);

  if (!variant.payload || variant.payload.size === 0) {
    // Unit variant: scrml runtime shape is the bare string variant name
    // (per emitEnumVariantObjects @ emit-client.ts:1100).
    lines.push(`      return ${tag};`);
    lines.push(`    }`);
    return lines;
  }

  // Payload variant: validate each field, then construct the runtime shape.
  const fieldEntries: Array<[string, any]> = [];
  for (const [fieldName, fieldType] of variant.payload) {
    fieldEntries.push([fieldName, fieldType]);
  }

  // Per-field validation: read from _v[fieldName], type-check, fail on mismatch.
  // Use _v.field for direct lookup (the wire JSON is expected to mirror the
  // declared payload field names).
  for (const [fieldName, fieldType] of fieldEntries) {
    const access = `_v[${JSON.stringify(fieldName)}]`;
    const guard = emitTypeGuard(access, fieldType);
    const fail = emitParseErrorFail(
      "InvalidPayload",
      `{ field: ${JSON.stringify(fieldName)}, reason: ${JSON.stringify(`expected payload field '${fieldName}' to type-match variant '${variant.name}'`)} }`,
    );
    lines.push(`      if (!(${guard})) return ${fail};`);
  }

  // Successful construction — emit the {variant, data} shape per
  // emitEnumVariantObjects @ emit-client.ts:1104.
  const dataPairs = fieldEntries.map(([n]) => `${JSON.stringify(n)}: _v[${JSON.stringify(n)}]`).join(", ");
  lines.push(`      return { variant: ${tag}, data: { ${dataPairs} } };`);
  lines.push(`    }`);
  return lines;
}

// ---------------------------------------------------------------------------
// Per-call-site IIFE emission
// ---------------------------------------------------------------------------

/**
 * Emit the per-call-site IIFE for a parseVariant call. Caller is responsible
 * for ensuring `node.parseVariantEnum` is set (annotation by the TS pass).
 */
export function emitParseVariantCall(node: CallExpr, ctx: EmitExprContext): string {
  const enumType = (node as unknown as { parseVariantEnum?: ParseVariantEnumLike }).parseVariantEnum;
  if (!enumType || enumType.kind !== "enum") {
    // Defensive — should not happen if the dispatch in emitCall is correct.
    // Fall through to the standard call emission shape so we don't crash codegen.
    const callee = emitExpr(node.callee, ctx);
    const args = node.args.map(a => emitExpr(a as ExprNode, ctx)).join(", ");
    return `${callee}(${args})`;
  }

  // arg[0] — the JSON / value source. Emit via standard expression pipeline so
  // @reactive references and other rewrites are honored.
  if (node.args.length < 1) {
    // Arity error caught upstream; emit a malformed-input fail so the
    // failable handler fires.
    return `(${emitParseErrorFail("Malformed", `{ reason: "internal: parseVariant called with no arguments" }`)})`;
  }
  const rawExpr = emitExpr(node.args[0] as ExprNode, ctx);

  // Build the IIFE.
  const lines: string[] = [];
  lines.push(`((_raw) => {`);
  lines.push(`  let _v;`);
  // 1. JSON-parse if string, else pass through.
  lines.push(`  if (typeof _raw === "string") {`);
  lines.push(`    try { _v = JSON.parse(_raw); }`);
  lines.push(`    catch (e) { return ${emitParseErrorFail("Malformed", `{ reason: String(e && e.message || e) }`)}; }`);
  lines.push(`  } else {`);
  lines.push(`    _v = _raw;`);
  lines.push(`  }`);
  // 2. Validate object-with-tag.
  lines.push(`  if (_v == null || typeof _v !== "object") {`);
  lines.push(`    return ${emitParseErrorFail("Malformed", `{ reason: "expected object or JSON-encoded object at parseVariant boundary" }`)};`);
  lines.push(`  }`);
  lines.push(`  if (typeof _v.tag !== "string") {`);
  lines.push(`    return ${emitParseErrorFail("MissingDiscriminator", `{}`)};`);
  lines.push(`  }`);
  // 3. Switch on tag.
  lines.push(`  switch (_v.tag) {`);
  for (const variant of enumType.variants) {
    const armLines = emitVariantArm(variant);
    for (const l of armLines) lines.push(l);
  }
  lines.push(`    default: return ${emitParseErrorFail("UnknownVariant", `{ tag: _v.tag }`)};`);
  lines.push(`  }`);
  lines.push(`})(${rawExpr})`);

  return lines.join("\n");
}

/**
 * Test predicate — true if the call-node has been annotated by the TS pass
 * as a parseVariant call-site. Used by emit-expr.ts:emitCall dispatch.
 */
export function isParseVariantCall(node: CallExpr): boolean {
  return !!(node as unknown as { parseVariantEnum?: ParseVariantEnumLike }).parseVariantEnum;
}
