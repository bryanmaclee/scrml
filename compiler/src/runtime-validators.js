/**
 * Phase A1c Step C6 — Validator predicate runtime catalog.
 *
 * The runtime mirror of the compile-time catalog at
 * `compiler/src/validator-catalog.ts` (B10, S67). 14 universal-core predicates
 * per SPEC §55.1 (L4) — same names, same `errorTag`, same arg-kind discrimination.
 * The compile-time catalog tells the compiler what's legal; this module provides
 * the JS functions that fire each predicate against runtime values.
 *
 *   Compile-time catalog → runtime catalog: 1:1 mapping.
 *   Compile-time `errorTag` field → fail return `tag` field.
 *
 * Cross-references:
 *   - SPEC §55.1 — universal-core vocabulary table (14 predicates)
 *   - SPEC §55.9 — `ValidationError` enum (per-predicate error tag)
 *   - SPEC §55.12 — short-circuit + composition (C7's territory; not C6's)
 *   - SPEC §42.2.5 — `is some` vs `req` distinct semantics
 *   - PA-SCRML-PRIMER §8 — auto-synth + 14-predicate confirmation
 *   - compiler/src/validator-catalog.ts — compile-time single source of truth
 *
 * NOT in this catalog (per primer §8 + S66 audit + brief Rule 4 correction):
 *   - `email`, `url`, `numeric`, `integer` — stdlib `scrml:data` predicate-builders
 *   - `custom` — `ValidationError` enum tag at SPEC §55.9, NOT a predicate
 *
 * # Fire-function contract
 *
 * Every fire function takes the cell value as its first argument plus a small
 * number of predicate-specific positional args. They return `null` on PASS and
 * a structured ValidationError-shaped object on FAIL:
 *
 *     { tag: <PredicateErrorTag>, ...payload }
 *
 * The `tag` field matches the corresponding `errorTag` in the compile-time
 * catalog (e.g., `"Required"`, `"LengthFailed"`). Payload fields per SPEC §55.9:
 *
 *     Required          → no payload
 *     NotSome           → no payload
 *     LengthFailed      → { predicate: <RelationalPredicateValue> }
 *     PatternMismatch   → { re: <regex|string> }
 *     MinFailed         → { threshold: <number> }
 *     MaxFailed         → { threshold: <number> }
 *     GtFailed          → { expected: <value> }
 *     LtFailed          → { expected: <value> }
 *     GteFailed         → { expected: <value> }
 *     LteFailed         → { expected: <value> }
 *     EqFailed          → { expected: <value> }
 *     NeqFailed         → { forbidden: <value> }
 *     OneOfFailed       → { set: <array> }
 *     NotInFailed       → { set: <array> }
 *
 * # Cross-field args (L14)
 *
 * For `gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn` with cross-field arg
 * references (e.g., `eq(@signup.password)`), C7 emits the comparison value as
 * a thunk: `() => _scrml_reactive_get("signup_password")`. This catalog
 * unwraps the thunk at fire time so the predicate sees the latest reactive
 * value. Literals and array-of-values pass through unchanged.
 *
 * # `is some` vs `req` (§42.2.5)
 *
 *   value          | req           | is some
 *   ---------------+---------------+--------
 *   null           | fail Required | fail NotSome
 *   undefined      | fail Required | fail NotSome
 *   ""             | fail Required | pass     ← key distinction
 *   []             | fail Required | pass
 *   0 / false      | pass          | pass
 *   any other      | pass          | pass
 *
 * # Short-circuit semantics (§55.12) — NOT C6's territory
 *
 * "When `req` (or `is some`) FAILS on an empty / null cell, the remaining
 *  validators are SKIPPED."
 *
 * That orchestration is C7's job (the per-cell validator runner). This catalog
 * answers each predicate question in isolation; it does NOT consult sibling
 * validators or know about declaration order.
 *
 * # Hookpoints for C7
 *
 * C7 will:
 *   1. Look up the fire function: `VALIDATOR_RUNTIME[predicateName]` or `fireValidator(name, ...)`.
 *   2. Evaluate predicate args (resolving cross-field thunks, literal values, array literals).
 *   3. Call `fire(cellValue, ...args)`.
 *   4. If non-null, append the returned object to the cell's `errors[]` array.
 *   5. Apply §55.12 short-circuit: if `req`/`is some` failed and the cell value
 *      was empty/null, stop walking the remaining validators.
 *   6. Apply Level-1 inline-message override extraction (B13's `inlineOverride`)
 *      at MESSAGE rendering time (C10) — NOT here. This catalog produces the
 *      ENUM TAG; the message resolution is downstream.
 *
 * The compile-time catalog's `cellTypeRequirement` ("orderable" / "string" /
 * "number" / etc.) is enforced at TYPE-CHECK time by the B10 walker. By the
 * time these fire functions run, the compiler has already rejected illegal
 * pairings (e.g., `pattern(re)` on a number cell). The runtime functions
 * therefore TRUST the inputs to be type-compatible.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Unwrap a possibly-thunked cross-field arg. C7 emits thunks for `@cell` refs
 * so the comparison reads the latest reactive value at fire time. Literals and
 * arrays of literals pass through unchanged.
 */
function _unwrapArg(arg) {
  return typeof arg === "function" ? arg() : arg;
}

/**
 * Unwrap an array of args, where each element MAY be a thunk or a literal.
 * Used by `oneOf` / `notIn` whose inner element might be a `@cell` reference.
 */
function _unwrapArray(arr) {
  if (!Array.isArray(arr)) return arr;
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = _unwrapArg(arr[i]);
  }
  return out;
}

/**
 * Run a relational predicate `{op, value}` against an actual numeric value
 * (typically a `.length`). Returns `true` if the relation holds, `false`
 * otherwise. The relational-predicate AST kind (B9) is the unique-form arg
 * of `length(...)`.
 *
 * Supported ops: `>=`, `<=`, `<`, `>`, `=`, `!=` (per SPEC §55.1 + B9 audit
 * §1.2).
 *
 * @param {number} actual
 * @param {{op: string, value: number}} relPred
 * @returns {boolean}
 */
export function runRelationalPredicate(actual, relPred) {
  const target = _unwrapArg(relPred.value);
  switch (relPred.op) {
    case ">=":
      return actual >= target;
    case "<=":
      return actual <= target;
    case "<":
      return actual < target;
    case ">":
      return actual > target;
    case "=":
      return actual === target;
    case "!=":
      return actual !== target;
    default:
      // Unknown op shape — fail closed. Compiler should have rejected this.
      return false;
  }
}

/**
 * Strict-equality test that mirrors scrml `==` semantics for non-compound types.
 * For arrays / objects / structs, full structural equality goes through the
 * runtime's `_scrml_structural_eq` helper; for the C6 catalog we use
 * SameValueZero (Array.includes-style) as the floor — C7 may opt-in to deep
 * equality at the call site if/when needed.
 */
function _equals(a, b) {
  if (a === b) return true;
  // Treat NaN as equal to itself (SameValueZero) for predictable predicate behaviour.
  if (typeof a === "number" && typeof b === "number" && a !== a && b !== b) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The 14 fire functions
//
// Order mirrors UNIVERSAL_CORE_PREDICATES in compiler/src/validator-catalog.ts.
// Each function returns `null` on pass or `{tag, ...payload}` on fail.
// ---------------------------------------------------------------------------

/**
 * `req` — non-empty value (`""` fails; null/undefined fail; `[]` fails).
 * SPEC §55.1 + §42.2.5 + §42.2.2a.
 */
export function fireReq(value) {
  if (value === null || value === undefined) return { tag: "Required" };
  if (value === "") return { tag: "Required" };
  if (Array.isArray(value) && value.length === 0) return { tag: "Required" };
  return null;
}

/**
 * `is some` — value EXISTS (null/undefined fail). `""` IS some.
 * SPEC §55.1 + §42.2.5.
 */
export function fireIsSome(value) {
  if (value === null || value === undefined) return { tag: "NotSome" };
  return null;
}

/**
 * `length(<rel-pred>)` — string/array length matches the inner relational
 * predicate. SPEC §55.1.
 */
export function fireLength(value, relPred) {
  if (value === null || value === undefined) {
    // Treat null/undefined length as 0 — same as empty. Failures here are
    // typically suppressed by §55.12 short-circuit when req/is some fail.
    return runRelationalPredicate(0, relPred)
      ? null
      : { tag: "LengthFailed", predicate: relPred };
  }
  const len = typeof value === "string" || Array.isArray(value) ? value.length : 0;
  return runRelationalPredicate(len, relPred)
    ? null
    : { tag: "LengthFailed", predicate: relPred };
}

/**
 * `pattern(re)` — string matches the regex. SPEC §55.1.
 *
 * Accepts either a `RegExp` instance OR a raw `/.../[flags]` string (B10
 * Phase 1 emits regex args as escape-hatch raw strings — the codegen pipeline
 * may produce either shape today).
 */
export function firePattern(value, re) {
  if (value === null || value === undefined) {
    return { tag: "PatternMismatch", re };
  }
  if (typeof value !== "string") {
    // Type-check should have rejected this; defensive fail-closed.
    return { tag: "PatternMismatch", re };
  }
  let regex = re;
  if (!(regex instanceof RegExp)) {
    regex = _coerceRegex(re);
    if (regex === null) {
      return { tag: "PatternMismatch", re };
    }
  }
  return regex.test(value) ? null : { tag: "PatternMismatch", re };
}

/**
 * Coerce a raw regex string (`/^foo$/i`) to a RegExp. Returns `null` on
 * unparseable input. Compiler should normally hand RegExp instances; this is
 * a fallback for the B10 Phase 1 raw-text path.
 */
function _coerceRegex(raw) {
  if (typeof raw !== "string") return null;
  const m = /^\/(.*)\/([gimsuy]*)$/.exec(raw);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

/**
 * `min(n)` — numeric minimum. SPEC §55.1.
 */
export function fireMin(value, threshold) {
  const t = _unwrapArg(threshold);
  if (typeof value !== "number") return { tag: "MinFailed", threshold: t };
  return value >= t ? null : { tag: "MinFailed", threshold: t };
}

/**
 * `max(n)` — numeric maximum. SPEC §55.1.
 */
export function fireMax(value, threshold) {
  const t = _unwrapArg(threshold);
  if (typeof value !== "number") return { tag: "MaxFailed", threshold: t };
  return value <= t ? null : { tag: "MaxFailed", threshold: t };
}

/**
 * `gt(expr)` — strict greater-than. Cross-field via predicate args.
 * SPEC §55.1.
 */
export function fireGt(value, expected) {
  const e = _unwrapArg(expected);
  return value > e ? null : { tag: "GtFailed", expected: e };
}

/** `lt(expr)` — strict less-than. SPEC §55.1. */
export function fireLt(value, expected) {
  const e = _unwrapArg(expected);
  return value < e ? null : { tag: "LtFailed", expected: e };
}

/** `gte(expr)` — greater-than-or-equal. SPEC §55.1. */
export function fireGte(value, expected) {
  const e = _unwrapArg(expected);
  return value >= e ? null : { tag: "GteFailed", expected: e };
}

/** `lte(expr)` — less-than-or-equal. SPEC §55.1. */
export function fireLte(value, expected) {
  const e = _unwrapArg(expected);
  return value <= e ? null : { tag: "LteFailed", expected: e };
}

/**
 * `eq(expr)` — equality (cross-field via predicate args). SPEC §55.1.
 *
 * Uses SameValueZero equality for primitives. C7 may pre-deep-compare for
 * compound values via the runtime's `_scrml_structural_eq`.
 */
export function fireEq(value, expected) {
  const e = _unwrapArg(expected);
  return _equals(value, e) ? null : { tag: "EqFailed", expected: e };
}

/** `neq(expr)` — inequality. SPEC §55.1. */
export function fireNeq(value, forbidden) {
  const f = _unwrapArg(forbidden);
  return _equals(value, f) ? { tag: "NeqFailed", forbidden: f } : null;
}

/**
 * `oneOf([...])` — set membership. SPEC §55.1.
 *
 * Each array element may itself be a thunk (cross-field). Unwrap before
 * comparing.
 */
export function fireOneOf(value, set) {
  const arr = _unwrapArray(_unwrapArg(set));
  if (!Array.isArray(arr)) return { tag: "OneOfFailed", set: arr };
  for (let i = 0; i < arr.length; i++) {
    if (_equals(value, arr[i])) return null;
  }
  return { tag: "OneOfFailed", set: arr };
}

/** `notIn([...])` — set non-membership. SPEC §55.1. */
export function fireNotIn(value, set) {
  const arr = _unwrapArray(_unwrapArg(set));
  if (!Array.isArray(arr)) return null; // empty/missing set ⇒ vacuously not-in
  for (let i = 0; i < arr.length; i++) {
    if (_equals(value, arr[i])) return { tag: "NotInFailed", set: arr };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Catalog: name → fire function
//
// Order matches UNIVERSAL_CORE_PREDICATES (validator-catalog.ts) verbatim.
// ---------------------------------------------------------------------------

/**
 * The 14 universal-core predicate runtime fire functions, keyed by the
 * source-level predicate name (matching the compile-time catalog).
 *
 * Multi-word names ("is some") match verbatim.
 */
export const VALIDATOR_RUNTIME = Object.freeze({
  req: fireReq,
  "is some": fireIsSome,
  length: fireLength,
  pattern: firePattern,
  min: fireMin,
  max: fireMax,
  gt: fireGt,
  lt: fireLt,
  gte: fireGte,
  lte: fireLte,
  eq: fireEq,
  neq: fireNeq,
  oneOf: fireOneOf,
  notIn: fireNotIn,
});

/**
 * The ordered list of universal-core predicate names. Mirrors the compile-time
 * catalog's source order.
 */
export const VALIDATOR_RUNTIME_NAMES = Object.freeze([
  "req",
  "is some",
  "length",
  "pattern",
  "min",
  "max",
  "gt",
  "lt",
  "gte",
  "lte",
  "eq",
  "neq",
  "oneOf",
  "notIn",
]);

/**
 * Look up + invoke a fire function by name. Returns the fire result
 * (`null` pass / `{tag,...}` fail) OR `undefined` if the predicate name
 * is not a universal-core predicate (e.g., a stdlib library predicate
 * like `email` — those have a separate runtime path).
 *
 * @param {string} name — source-level predicate name (e.g. "req", "is some")
 * @param {*} value — the cell value
 * @param {...*} args — predicate-specific positional args (already evaluated by C7)
 * @returns {null | object | undefined}
 */
export function fireValidator(name, value, ...args) {
  const fn = VALIDATOR_RUNTIME[name];
  if (fn === undefined) return undefined;
  return fn(value, ...args);
}

/**
 * Returns true if the given name is a universal-core predicate with a runtime
 * fire function. Convenience for C7's predicate dispatch.
 */
export function hasValidator(name) {
  return Object.prototype.hasOwnProperty.call(VALIDATOR_RUNTIME, name);
}

/**
 * Returns the count of universal-core fire functions. Used by tests to
 * verify catalog symmetry with the compile-time side. SHOULD be 14.
 */
export function validatorRuntimeCount() {
  return VALIDATOR_RUNTIME_NAMES.length;
}
