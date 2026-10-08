/**
 * emit-predicates.ts — §53 Inline Type Predicate Codegen Utilities
 *
 * This module provides shared utilities for emitting §53 predicate enforcement:
 *
 *   1. emitRuntimeCheck(predicate, varName, label) — emit a runtime boundary check
 *      (E-CONTRACT-001-RT). Called from emit-logic.ts for let-decl / state-decl nodes
 *      that the TS stage classified as boundary zone.
 *
 *   2. emitServerParamCheck(paramName, predicate, label) — emit a server-side boundary
 *      check for a function parameter (§53.9.4). Called from emit-server.ts.
 *
 *   3. deriveHtmlAttrs(predicate, baseType) — derive HTML validation attributes from a
 *      predicate expression (§53.7). Used by emit-html.ts when rendering bind:value.
 *
 *   4. predicateToJsExpr(predicate, valueExpr) — serialize a PredicateExpr AST node into
 *      a boolean JS expression. Used by emitRuntimeCheck and emitServerParamCheck.
 *
 * The PredicateExpr type mirrors the one in type-system.ts. We operate on the opaque
 * `node.predicateCheck.predicate` objects already present in the TypedFileAST.
 */

import { URL_GUARD_RUNTIME_SOURCE } from "../runtime-template.js";

// ---------------------------------------------------------------------------
// PredicateExpr mirror (matches type-system.ts — no import to avoid coupling)
// ---------------------------------------------------------------------------

interface PredicateExpr {
  kind: "comparison" | "property" | "named-shape" | "and" | "or" | "not" | "error" | "variant-set";
  op?: string;
  value?: number | string;
  prop?: string;
  name?: string;
  left?: PredicateExpr;
  right?: PredicateExpr;
  operand?: PredicateExpr;
  message?: string;
  hasExternalRef?: boolean;
  // §53.15 enum-subset refinement — variant-set membership over an enum base.
  // `variants` is the RESOLVED IN-SET variant names (notIn already complemented
  // at type-resolution time). Enum variants lower to plain strings at runtime,
  // so the boundary membership check is a string `.includes`.
  variantMode?: "oneOf" | "notIn";
  variants?: string[];
}

// ---------------------------------------------------------------------------
// Named shape → JS runtime validation predicate (§53.6)
//
// Named shapes cannot be statically proven for non-literal string values.
// The compiler emits a runtime expression that validates the string.
// ---------------------------------------------------------------------------

/** The runtime judge of the `url` named shape (runtime-url-guard.js). Emitted text gates its inlining. */
export const URL_SHAPE_FN = "_scrml_url_shape_ok";

/**
 * The server copy of the `url` shape judge: the whole of runtime-url-guard.js (the reader, the
 * safe-scheme set and `_scrml_url_shape_ok`), for a server bundle / library module / tool / worker whose body
 * calls `_scrml_url_shape_ok(` (a `string(url)` server-function parameter or a boundary-zone decl).
 * The same source the client 'urlguard' chunk inlines. A bundle that already carries it (the SSR
 * first-paint URL guard copy) must not inline it twice — see `needsUrlShapeHelper`.
 */
export const SERVER_URL_SHAPE_HELPER: string = [
  "",
  "// --- §53.6.1 `url` named shape + §5.2 URL scheme reader (inlined copy; source: runtime-url-guard.js) ---",
  URL_GUARD_RUNTIME_SOURCE,
].join("\n");

/** Does `emitted` call the `url` shape judge without already defining it? */
export function needsUrlShapeHelper(emitted: string): boolean {
  return emitted.includes(`${URL_SHAPE_FN}(`) && !emitted.includes(`function ${URL_SHAPE_FN}(`);
}

const NAMED_SHAPE_RUNTIME: Record<string, string> = {
  email: `(typeof __V__ === "string" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(__V__))`,
  // §53.6.1 / S457 "6a" — `_scrml_url_shape_ok` is defined ONCE, in compiler/src/runtime-url-guard.js
  // (the §5.2 scheme reader's file): an absolute URL whose scheme is in the §5.2 safe set. The client
  // runtime carries it in the 'urlguard' chunk (emit-client.ts post-emit gate on this call); a server
  // bundle that calls it inlines the same source (emit-server.ts). The type checker's static zone
  // calls the same function, so the two zones cannot disagree.
  url: `${URL_SHAPE_FN}(__V__)`,
  uuid: `(typeof __V__ === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(__V__))`,
  phone: `(typeof __V__ === "string" && /^[+]?[0-9\\s\\-().]{7,15}$/.test(__V__))`,
  date: `(typeof __V__ === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(__V__))`,
  time: `(typeof __V__ === "string" && /^\\d{2}:\\d{2}(:\\d{2})?$/.test(__V__))`,
  color: `(typeof __V__ === "string" && /^#[0-9A-Fa-f]{6}$|^[a-z]+$/.test(__V__))`,
};

// ---------------------------------------------------------------------------
// Named shape → HTML attributes (§53.7.1, §53.6.1 table)
// ---------------------------------------------------------------------------

const NAMED_SHAPE_HTML: Record<string, Record<string, string>> = {
  email: { type: "email" },
  url:   { type: "url" },
  uuid:  { pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" },
  phone: { type: "tel" },
  date:  { type: "date" },
  time:  { type: "time" },
  color: { type: "color" },
};

// ---------------------------------------------------------------------------
// predicateToJsExpr
//
// Serialize a PredicateExpr to a JS boolean expression.
// `valueExpr` is the JS expression for the incoming value (e.g. "amount", "_scrml_v").
//
// Returns a JS expression string that evaluates to `true` when the predicate
// is satisfied, `false` when violated.
// ---------------------------------------------------------------------------

export function predicateToJsExpr(pred: PredicateExpr, valueExpr: string): string {
  if (!pred || !pred.kind) return "true";

  switch (pred.kind) {
    case "comparison": {
      const op = pred.op ?? ">";
      const val = pred.value ?? 0;
      // comparison predicate: just `value op N`
      return `(${valueExpr} ${op} ${val})`;
    }

    case "property": {
      // property predicate: `.length > N` etc.
      const prop = pred.prop ?? "length";
      const op = pred.op ?? ">";
      const val = pred.value ?? 0;
      return `(${valueExpr}.${prop} ${op} ${val})`;
    }

    case "named-shape": {
      const shapeName = pred.name ?? "";
      const template = NAMED_SHAPE_RUNTIME[shapeName];
      if (template) {
        return template.replaceAll("__V__", valueExpr);
      }
      // Unknown shape — TS would have caught this as E-CONTRACT-002.
      // Emit a pass-through (defensive).
      return "true";
    }

    case "and": {
      const l = predicateToJsExpr(pred.left!, valueExpr);
      const r = predicateToJsExpr(pred.right!, valueExpr);
      return `(${l} && ${r})`;
    }

    case "or": {
      const l = predicateToJsExpr(pred.left!, valueExpr);
      const r = predicateToJsExpr(pred.right!, valueExpr);
      return `(${l} || ${r})`;
    }

    case "not": {
      const inner = predicateToJsExpr(pred.operand!, valueExpr);
      return `(!(${inner}))`;
    }

    case "variant-set": {
      // §53.15.2 boundary check — enum-subset membership. Enum variants lower
      // to plain strings at runtime (see the `Role_toEnum` table emitted in
      // emit-enums), so the check is a string-array `.includes`. `variants` is
      // the resolved IN-SET (notIn was complemented at type-resolution time),
      // so the test is uniformly positive regardless of surface form.
      const set = Array.isArray(pred.variants) ? pred.variants : [];
      const literal = JSON.stringify(set);
      return `(${literal}.includes(${valueExpr}))`;
    }

    case "error":
    default:
      // Malformed predicate — TS would have reported this.
      return "true";
  }
}

// ---------------------------------------------------------------------------
// predicateToDisplayString
//
// Produce a human-readable description of the predicate for error messages.
// ---------------------------------------------------------------------------

function predicateToDisplayString(pred: PredicateExpr): string {
  if (!pred || !pred.kind) return "(unknown)";

  switch (pred.kind) {
    case "comparison":
      return `${pred.op}${pred.value}`;
    case "property":
      return `.${pred.prop} ${pred.op} ${pred.value}`;
    case "named-shape":
      return pred.name ?? "(unknown-shape)";
    case "and": {
      const l = predicateToDisplayString(pred.left!);
      const r = predicateToDisplayString(pred.right!);
      return `${l} && ${r}`;
    }
    case "or": {
      const l = predicateToDisplayString(pred.left!);
      const r = predicateToDisplayString(pred.right!);
      return `${l} || ${r}`;
    }
    case "not":
      return `!(${predicateToDisplayString(pred.operand!)})`;
    case "variant-set": {
      const set = Array.isArray(pred.variants) ? pred.variants : [];
      // §53.15 — display as the canonical positive subset form.
      return `oneOf([${set.map(v => "." + v).join(", ")}])`;
    }
    default:
      return "(error)";
  }
}

// ---------------------------------------------------------------------------
// emitRuntimeCheck
//
// Emit a §53.4.5 runtime boundary check for a variable assignment.
//
// Produces a JS `if (!(predicate)) throw ...` guard that should be emitted
// BEFORE the assignment statement so that the variable retains its prior value
// on violation (§53.3.3).
//
// @param predicate  — the PredicateExpr from node.predicateCheck.predicate
// @param valueExpr  — the JS expression for the incoming value (e.g. "rawAmount")
// @param varName    — the scrml variable name (for error message)
// @param label      — optional named constraint label (e.g. "invoice_amount")
// @param location   — optional source location string for the error message
// @returns          — an array of JS lines to emit before the assignment
// ---------------------------------------------------------------------------

export function emitRuntimeCheck(
  predicate: PredicateExpr,
  valueExpr: string,
  varName: string,
  label: string | null = null,
  location = "",
): string[] {
  const checkExpr = predicateToJsExpr(predicate, valueExpr);
  const displayPred = predicateToDisplayString(predicate);
  const labelPart = label ? ` [${label}]` : "";
  const locationPart = location ? ` (${location})` : "";

  const lines: string[] = [];
  lines.push(`// §53.4.5 E-CONTRACT-001-RT boundary check for '${varName}'${labelPart}`);
  lines.push(`if (!(${checkExpr})) {`);
  lines.push(`  throw new Error(`);
  lines.push(`    "E-CONTRACT-001-RT: Value constraint violated at runtime.\\n" +`);
  lines.push(`    "  Variable: " + ${JSON.stringify(varName + labelPart)} + "\\n" +`);
  lines.push(`    "  Constraint: (" + ${JSON.stringify(displayPred)} + ")\\n" +`);
  lines.push(`    "  Value: " + String(${valueExpr}) + "\\n" +`);
  lines.push(`    "  Location: " + ${JSON.stringify(locationPart || varName)}`);
  lines.push(`  );`);
  lines.push(`}`);

  return lines;
}

// ---------------------------------------------------------------------------
// emitServerParamCheck
//
// Emit §53.9.4 server-side boundary checks for a server function parameter.
//
// Called from emit-server.ts after params are extracted from _scrml_body.
// Produces `if (!(predicate(param))) throw ...` guards at function entry.
//
// @param paramName  — the JS parameter name (already extracted from body)
// @param predicate  — the PredicateExpr from the param annotation
// @param label      — optional named constraint label
// @param fnName     — the scrml function name (for error message)
// @param indent     — leading whitespace (e.g. "  " or "    ")
// @returns          — an array of JS lines
// ---------------------------------------------------------------------------

export function emitServerParamCheck(
  paramName: string,
  predicate: PredicateExpr,
  label: string | null,
  fnName: string,
  indent = "  ",
): string[] {
  const checkExpr = predicateToJsExpr(predicate, paramName);
  const displayPred = predicateToDisplayString(predicate);
  const labelPart = label ? ` [${label}]` : "";

  const lines: string[] = [];
  lines.push(`${indent}// §53.9.4 E-CONTRACT-001-RT server-side boundary check: '${paramName}'${labelPart}`);
  lines.push(`${indent}if (!(${checkExpr})) {`);
  lines.push(`${indent}  return new Response(JSON.stringify({`);
  lines.push(`${indent}    error: "E-CONTRACT-001-RT: Value constraint violated at runtime.",`);
  lines.push(`${indent}    constraint: ${JSON.stringify(`(${displayPred})`)},`);
  lines.push(`${indent}    parameter: ${JSON.stringify(paramName + labelPart)},`);
  lines.push(`${indent}    function: ${JSON.stringify(fnName)},`);
  lines.push(`${indent}    value: String(${paramName}),`);
  lines.push(`${indent}  }), { status: 400, headers: { "Content-Type": "application/json" } });`);
  lines.push(`${indent}}`);

  return lines;
}

// ---------------------------------------------------------------------------
// deriveHtmlAttrs
//
// Derive HTML input validation attributes from a predicate and base type.
// Used by emit-html.ts (or emit-bindings.ts) when emitting bind:value on inputs.
//
// §53.7.1 mapping:
//   Numeric >N  → min="N+1" (integer step) or min="N+ε"
//   Numeric >=N → min="N"
//   Numeric <N  → max="N-1" (integer step)
//   Numeric <=N → max="N"
//   String .length >N  → minlength="N+1"
//   String .length >=N → minlength="N"
//   String .length <N  → maxlength="N-1"
//   String .length <=N → maxlength="N"
//   named-shape email  → type="email" (etc. from NAMED_SHAPE_HTML)
//
// @param predicate  — the PredicateExpr
// @param baseType   — "number" | "string" | "integer" | "boolean"
// @returns          — a Record<string, string> of HTML attributes to inject
// ---------------------------------------------------------------------------

export function deriveHtmlAttrs(
  predicate: PredicateExpr,
  baseType: string,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (baseType === "number" || baseType === "integer") {
    // For number inputs, always set type="number" (baseline).
    attrs["type"] = "number";
  }
  collectHtmlAttrs(predicate, baseType, attrs);
  return attrs;
}

function collectHtmlAttrs(
  pred: PredicateExpr,
  baseType: string,
  attrs: Record<string, string>,
): void {
  if (!pred || !pred.kind) return;

  switch (pred.kind) {
    case "comparison": {
      if (baseType === "number" || baseType === "integer") {
        const n = Number(pred.value ?? 0);
        const isInt = baseType === "integer";
        switch (pred.op) {
          case ">":
            // >N → min = N+1 for integers, N+ε (smallest step = 1 for html) for floats
            attrs["min"] = String(isInt ? n + 1 : n + 1);
            break;
          case ">=":
            attrs["min"] = String(n);
            break;
          case "<":
            attrs["max"] = String(isInt ? n - 1 : n - 1);
            break;
          case "<=":
            attrs["max"] = String(n);
            break;
          default:
            break;
        }
      }
      break;
    }

    case "property": {
      const prop = pred.prop ?? "";
      if (prop === "length" && baseType === "string") {
        const n = Number(pred.value ?? 0);
        switch (pred.op) {
          case ">":
            attrs["minlength"] = String(n + 1);
            break;
          case ">=":
            attrs["minlength"] = String(n);
            break;
          case "<":
            attrs["maxlength"] = String(n - 1);
            break;
          case "<=":
            attrs["maxlength"] = String(n);
            break;
          default:
            break;
        }
        // Presence requirement: if minlength >= 1, also emit required
        if (pred.op === ">" && Number(pred.value ?? 0) >= 0) {
          attrs["required"] = "";
        } else if (pred.op === ">=" && Number(pred.value ?? 0) >= 1) {
          attrs["required"] = "";
        }
      }
      break;
    }

    case "named-shape": {
      const shapeName = pred.name ?? "";
      const shapeAttrs = NAMED_SHAPE_HTML[shapeName];
      if (shapeAttrs) {
        for (const [k, v] of Object.entries(shapeAttrs)) {
          attrs[k] = v;
        }
      }
      break;
    }

    case "and": {
      collectHtmlAttrs(pred.left!, baseType, attrs);
      collectHtmlAttrs(pred.right!, baseType, attrs);
      break;
    }

    case "or": {
      // For OR: we can only emit attributes that apply to both branches.
      // The conservative approach: emit nothing for OR (don't over-constrain the browser).
      // Both branches are still runtime-validated.
      break;
    }

    case "not":
      // Negated predicates cannot map to simple HTML min/max. Skip.
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// parsePredicateAnnotation
//
// Parse a scrml type annotation string and extract the predicate if it is a
// predicated type (§53.2). Used by emit-server.ts to detect predicated params
// without importing type-system.ts.
//
// @param annotation — e.g. "number(>0 && <10000)" or "number(>0 && <10000) [label]"
// @returns { predicate, baseType, label } if predicated, null otherwise.
// ---------------------------------------------------------------------------

export function parsePredicateAnnotation(annotation: string): {
  predicate: PredicateExpr;
  baseType: string;
  label: string | null;
} | null {
  if (!annotation || typeof annotation !== "string") return null;

  const trimmed = annotation.trim();

  // Match: baseType "(" predicateStr ")" [ "[" label "]" ]
  const m = trimmed.match(/^(number|string|integer|boolean)\s*\((.+)\)\s*(?:\[([A-Za-z_][A-Za-z0-9_]*)\])?$/s);
  if (!m) return null;

  const baseType = m[1];
  const predicateStr = m[2].trim();
  const label = m[3] ?? null;

  const predicate = parsePredicateExprInternal(predicateStr);
  if (!predicate || predicate.kind === "error") return null;

  return { predicate, baseType, label };
}

// ---------------------------------------------------------------------------
// Minimal predicate expression parser (mirrors type-system.ts parsePredicateExpr)
//
// Supports: comparison (>N, >=N, <N, <=N), property (.length > N),
// named-shape (email, url...), and/or/not composition.
// Does NOT validate external references (TS already rejected those).
// ---------------------------------------------------------------------------

function parsePredicateExprInternal(raw: string): PredicateExpr {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "error", message: "empty" };

  // Try to split on && / || at the top level (not inside parens)
  let depth = 0;
  let andIdx = -1;
  let orIdx = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "(" || ch === "[") { depth++; continue; }
    if (ch === ")" || ch === "]") { depth--; continue; }
    if (depth === 0) {
      if (trimmed[i] === "&" && trimmed[i + 1] === "&") { andIdx = i; break; }
      if (trimmed[i] === "|" && trimmed[i + 1] === "|") { orIdx = i; break; }
    }
  }

  if (andIdx !== -1) {
    const left = parsePredicateExprInternal(trimmed.slice(0, andIdx));
    const right = parsePredicateExprInternal(trimmed.slice(andIdx + 2));
    return { kind: "and", left, right };
  }

  if (orIdx !== -1) {
    const left = parsePredicateExprInternal(trimmed.slice(0, orIdx));
    const right = parsePredicateExprInternal(trimmed.slice(orIdx + 2));
    return { kind: "or", left, right };
  }

  // Parenthesized group
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return parsePredicateExprInternal(trimmed.slice(1, -1));
  }

  // Not
  if (trimmed.startsWith("!")) {
    const operand = parsePredicateExprInternal(trimmed.slice(1));
    return { kind: "not", operand };
  }

  // Property predicate: .prop op value  (e.g. ".length > 7")
  const propM = trimmed.match(/^\.([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(\.\d+)?)$/);
  if (propM) {
    return {
      kind: "property",
      prop: propM[1],
      op: propM[2],
      value: Number(propM[3]),
    };
  }

  // Comparison predicate: op value  (e.g. ">0", "<=100", ">=0")
  const cmpM = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+(\.\d+)?)$/);
  if (cmpM) {
    return {
      kind: "comparison",
      op: cmpM[1],
      value: Number(cmpM[2]),
    };
  }

  // Named shape: bare identifier (email, url, uuid, phone, date, time, color)
  if (/^[a-z][A-Za-z0-9_]*$/.test(trimmed)) {
    return { kind: "named-shape", name: trimmed };
  }

  return { kind: "error", message: `cannot parse: ${trimmed}` };
}
