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
  kind: "comparison" | "property" | "named-shape" | "and" | "or" | "not" | "error" | "variant-set"
    | "on-length" | "pattern" | "value-set" | "req";
  // S458 — §55.1 shared-core kinds: `pattern` (value = regex source, flags),
  // `value-set` (variantMode oneOf/notIn over literal `values`), `on-length`
  // (`operand` judged on `.length`), `req` (non-empty).
  flags?: string;
  values?: Array<number | string>;
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

// S458 F1 — the judge FAILS CLOSED. A predicate it cannot judge (an `error`
// node, an unregistered shape, an unknown kind) yields `false` — the value is
// refused — never `true`. The type-system stage refuses every such annotation at
// its declaration (E-CONTRACT-002 / -003, `checkRefinementJudgeable`), so a
// clean compile never reaches these arms; they exist so that a path which
// somehow does cannot ship a check that admits everything.
const FAIL_CLOSED = "false /* §53 S458: unjudgeable predicate — refused */";

/** A predicate operand as a JS literal: numbers as-is, strings quoted. */
function jsLiteral(v: number | string): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

// ---------------------------------------------------------------------------
// The ONE judge (S458) — base type first, then containers, then the predicate.
//
// `predicateToJsExpr` alone judges a value already known to be of the base type;
// over HTTP / postMessage / argv / a decoded payload it is not. `number(>0)`
// used to admit "5" and [5] (`"5" > 0`, `[5] > 0`), `integer(>0)` admitted 0.5,
// `string(.length >= 1)` admitted ["a","b"] and {length: 5}, and a property
// predicate on null / a missing field THREW (a server 500). The judge tests the
// base type first, which also guards the property access.
// ---------------------------------------------------------------------------

/** What the judge needs: the refinement, plus any containers around it. */
export interface JudgeShape {
  baseType?: string;
  wrap?: Array<"array" | "nullable">;
}

/** JS boolean: is `v` a value of `baseType`? `null` = no base guard (enum subset). */
function baseTypeGuard(baseType: string | undefined, v: string): string | null {
  switch (baseType) {
    case "number": return `typeof ${v} === "number" && !Number.isNaN(${v})`;
    case "integer": return `Number.isInteger(${v})`;
    case "string": return `typeof ${v} === "string"`;
    case "boolean": return `typeof ${v} === "boolean"`;
    default: return null;
  }
}

/**
 * The full judge for `valueExpr` against `predicate` under `shape`: containers
 * (an array is judged element-wise, `not` inhabits a nullable), then the base
 * type, then the predicate. `valueExpr` must be a side-effect-free reference
 * (a parameter or temp name) — it is read more than once.
 */
export function judgeExpr(predicate: PredicateExpr, valueExpr: string, shape: JudgeShape = {}): string {
  const wrap = shape.wrap ?? [];
  const inner = (v: string, at: number): string => {
    if (at < wrap.length) {
      if (wrap[at] === "nullable") return `(${v} === null || ${v} === undefined || ${inner(v, at + 1)})`;
      const el = `_scrml_el${at}`;
      return `(Array.isArray(${v}) && ${v}.every((${el}) => ${inner(el, at + 1)}))`;
    }
    const guard = baseTypeGuard(shape.baseType, v);
    const pred = predicateToJsExpr(predicate, v);
    return guard ? `(${guard} && ${pred})` : pred;
  };
  return inner(valueExpr, 0);
}

/**
 * A failure report's rendering of the offending value that cannot throw
 * (`String(v)` throws for `{ toString: 1 }`, which turned a refused server
 * parameter into a 500) and does not echo a structured attacker value.
 */
function safeValueText(v: string): string {
  return `(typeof ${v} === "string" || typeof ${v} === "number" || typeof ${v} === "boolean" ? String(${v}) : typeof ${v})`;
}

export function predicateToJsExpr(pred: PredicateExpr, valueExpr: string): string {
  if (!pred || !pred.kind) return FAIL_CLOSED;

  switch (pred.kind) {
    case "comparison": {
      const op = pred.op ?? ">";
      // comparison predicate: just `value op N`. S458 — a string operand
      // (`eq("x")`) is emitted as a quoted JS string literal, never as bare text.
      return `(${valueExpr} ${op} ${jsLiteral(pred.value ?? 0)})`;
    }

    case "property": {
      // property predicate: `.length > N`, `.kind == "a"` etc. S458 — a string
      // value is quoted (it used to be emitted bare: `.kind == "foo"` became
      // `(v.kind == foo)`, a ReferenceError on every call).
      const prop = pred.prop ?? "length";
      const op = pred.op ?? ">";
      return `(${valueExpr}.${prop} ${op} ${jsLiteral(pred.value ?? 0)})`;
    }

    case "on-length":
      // §55.1 `length(pred)` — the inner predicate judged on `.length`.
      return pred.operand ? predicateToJsExpr(pred.operand, `${valueExpr}.length`) : FAIL_CLOSED;

    case "pattern": {
      // §55.1 `pattern(/re/flags)` — a regex literal; its source was read and
      // validated by the type stage (it is a well-formed RegExp body).
      const src = String(pred.value ?? "");
      if (/[\n\r]/.test(src)) return FAIL_CLOSED;
      return `(/${src}/${pred.flags ?? ""}.test(${valueExpr}))`;
    }

    case "value-set": {
      // §55.1 `oneOf([…])` / `notIn([…])` over literal values.
      const inSet = `${JSON.stringify(pred.values ?? [])}.includes(${valueExpr})`;
      return pred.variantMode === "notIn" ? `(!${inSet})` : `(${inSet})`;
    }

    case "req":
      // §55.1 `req` — non-empty (`""` fails; absence is refused by the base guard).
      return `(${valueExpr} !== "")`;

    case "named-shape": {
      const shapeName = pred.name ?? "";
      const template = NAMED_SHAPE_RUNTIME[shapeName];
      if (template) {
        return template.replaceAll("__V__", valueExpr);
      }
      // Unknown shape — TS refuses it as E-CONTRACT-002 at the declaration.
      return FAIL_CLOSED;
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
      // S458 — a PAYLOAD variant lowers to `{ variant, data }` (emit-enums), not
      // a bare string, and §53.15.5 admits payload variants in a subset: the
      // membership is read off the TAG. (`.includes(obj)` refused every payload
      // variant, in-subset or not.)
      const set = Array.isArray(pred.variants) ? pred.variants : [];
      const literal = JSON.stringify(set);
      return `(${literal}.includes(typeof ${valueExpr} === "object" && ${valueExpr} !== null ? ${valueExpr}.variant : ${valueExpr}))`;
    }

    case "error":
    default:
      // Malformed predicate — TS refuses it as E-CONTRACT-002 at the declaration.
      return FAIL_CLOSED;
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
      return `${pred.op}${jsLiteral(pred.value ?? 0)}`;
    case "property":
      return `.${pred.prop} ${pred.op} ${jsLiteral(pred.value ?? 0)}`;
    case "on-length":
      return `length(${pred.operand ? predicateToDisplayString(pred.operand) : "?"})`;
    case "pattern":
      return `pattern(/${pred.value ?? ""}/${pred.flags ?? ""})`;
    case "value-set":
      return `${pred.variantMode ?? "oneOf"}(${JSON.stringify(pred.values ?? [])})`;
    case "req":
      return "req";
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
  shape: JudgeShape = {},
): string[] {
  // S458 — the one judge: base type, containers, predicate.
  const checkExpr = judgeExpr(predicate, valueExpr, shape);
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
  lines.push(`    "  Value: " + ${safeValueText(valueExpr)} + "\\n" +`);
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
  shape: JudgeShape = {},
): string[] {
  // S458 — the one judge: base type, containers, predicate. A value of the
  // wrong base type (or a missing field) is a clean 400, not a thrown 500.
  const checkExpr = judgeExpr(predicate, paramName, shape);
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
  lines.push(`${indent}    value: ${safeValueText(paramName)},`);
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
// Refinement — the ONE reader's output, as codegen sees it (S458)
//
// The type-system stage resolves every refinement annotation (one reader:
// type-system.ts `resolveTypeExpr`) and stamps the result as plain data:
//   - a function parameter:   `param.refinement`
//   - a function:             `fnNode.returnRefinement`
//   - a let/const/state decl: `node.predicateCheck` ({ predicate, baseType, label, zone })
// Codegen never re-parses an annotation string. (Before S458 a regex "mirror"
// parser here re-read parameter / return / bind:value annotations and dropped
// every form it did not know — enum-subset parameters were never checked, and
// an unreadable predicate silently produced no check.)
// ---------------------------------------------------------------------------

export interface Refinement {
  baseType: string;
  predicate: PredicateExpr;
  label: string | null;
  /** Containers around the refined value, outermost first (`T[]`, `T | not`). */
  wrap?: Array<"array" | "nullable">;
}

/** The refinement carried by a TS stamp (param / fn return / decl), or null. */
export function refinementOf(stamp: unknown): Refinement | null {
  if (!stamp || typeof stamp !== "object") return null;
  const r = stamp as { predicate?: unknown; baseType?: unknown; label?: unknown; wrap?: unknown };
  if (!r.predicate || typeof r.predicate !== "object") return null;
  const wrap = Array.isArray(r.wrap)
    ? (r.wrap as unknown[]).filter((w): w is "array" | "nullable" => w === "array" || w === "nullable")
    : [];
  return {
    baseType: typeof r.baseType === "string" ? r.baseType : "",
    predicate: r.predicate as PredicateExpr,
    label: typeof r.label === "string" ? r.label : null,
    ...(wrap.length ? { wrap } : {}),
  };
}
