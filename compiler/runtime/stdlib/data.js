// scrml:data — runtime shim
//
// Hand-written ES module that mirrors the semantics declared in
// stdlib/data/{transform,validate,parse,messages}.scrml. Used by the
// compiler's stdlib bundler (compiler/src/api.js — bundleStdlibForRun)
// for the server emission path, AND inlined into the shared scrml-
// runtime.js client emission path via the `_scrml_stdlib.data` registry
// chunk (compiler/src/runtime-template.js).
//
// This shim replaces the would-be compiled output of stdlib/data/*.scrml
// because those source files use scrml-native vocabulary (`is some`,
// `is not`, `not` literal) which the standard compile pipeline does not
// lower into the same JS shape these utility functions need today.
// Mirrors the convention established by stdlib/auth.js + crypto.js +
// host.js + store.js.
//
// Surface (must match stdlib/data re-exports):
//
//   from transform.scrml:
//     pick, omit, mapKeys, mapValues, groupBy, indexBy, sortBy, unique,
//     union, intersection, difference, member,
//     flatten, flattenDeep, chunk, toSnakeCase, toCamelCase,
//     camelizeKeys, snakifyKeys, deepMerge, clamp, paginate
//
//   from validate.scrml:
//     validate, isValid, firstError, required, email, minLength,
//     maxLength, exactLength, pattern, min, max, numeric, integer,
//     matches, oneOf, url, custom, emailField, passwordField,
//     passwordConfirmField
//
//   from parse.scrml:
//     parseVariant (defensive fallback; compile-time monomorphized by CG)
//
//   from messages.scrml:
//     registerMessages, messageFor (thin wrappers; delegate to runtime
//     helpers _scrml_messages_register / _scrml_message_for)
//
//   from form-for.scrml:
//     formFor (defensive fallback; compile-time rewritten by TS stage),
//     registerLabels (thin wrapper; delegates to runtime helper
//     _scrml_labels_register)

// data.js's arithmetic routes through scrml:math — the single sanctioned
// touch of the host arithmetic surface (closes the stdlib-ouroboros). The
// `min`/`max` arithmetic are ALIASED (mathMin/mathMax) because data.js also
// exports its OWN `min`/`max` validator factories (validate.scrml) — distinct
// functions that must not be shadowed.
import { min as mathMin, max as mathMax, ceil } from "./math.js";

// ---------------------------------------------------------------------------
// transform.scrml — data transformation utilities (pure, browser-safe)
// ---------------------------------------------------------------------------

export function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function omit(obj, keys) {
  const keySet = new Set(keys);
  const result = {};
  for (const key of Object.keys(obj)) {
    if (!keySet.has(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function mapKeys(obj, keyMap) {
  const result = {};
  for (const key of Object.keys(obj)) {
    const newKey = keyMap[key] || key;
    result[newKey] = obj[key];
  }
  return result;
}

export function mapValues(obj, fn) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = fn(value, key);
  }
  return result;
}

export function groupBy(array, keyOrFn) {
  const fn = typeof keyOrFn === "function" ? keyOrFn : (item) => item[keyOrFn];
  const result = {};
  for (const item of array) {
    const key = String(fn(item));
    result[key] = result[key] || [];
    result[key].push(item);
  }
  return result;
}

export function indexBy(array, keyOrFn) {
  const fn = typeof keyOrFn === "function" ? keyOrFn : (item) => item[keyOrFn];
  const result = new Map();
  for (const item of array) {
    result.set(fn(item), item);
  }
  return result;
}

export function sortBy(array, keyOrFn, direction) {
  const fn = typeof keyOrFn === "function" ? keyOrFn : (item) => item[keyOrFn];
  const dir = direction === "desc" ? -1 : 1;
  return [...array].sort((a, b) => {
    const va = fn(a);
    const vb = fn(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

// _data_value_canonical(v) — value-canonical string codec (§59.5 / §47.1.4).
//
// Serializes a runtime value deterministically so that two §45-structurally-equal
// values produce BYTE-IDENTICAL strings. This is what makes the set-algebra
// helpers (union/intersection/difference/member) and `unique`'s no-key path
// agree with scrml's `==` and the §59 value-native map's key identity for STRUCT
// (and enum / nested) elements — JS `Set`/`Array.includes` key by reference, so
// two value-equal structs would otherwise be treated as distinct.
//
// REPLICATED (not imported) from the runtime template's `_scrml_value_canonical`
// (compiler/src/runtime-template.js, §59.5). The two MUST stay byte-identical so
// these helpers agree with the map key. Reuse was not possible: data.js is
// bundled BOTH as a standalone server module (where the runtime global is absent)
// AND inside an IIFE in the client runtime — a correctness invariant cannot ride
// a maybe-present global, so the algorithm is transcribed locally here.
//
// Acyclic precondition (S168 cycles-prereq, scrml 8d9db4e1): value cycles are
// forbidden in scrml source by construction, so this walk needs NO cycle-guard
// and always terminates.
//
// Format (every variable-length piece is length-prefixed so concatenation is
// unambiguous):
//   not / null / undefined  ->  "0:"
//   boolean                 ->  "b1" | "b0"
//   number                  ->  "n" + canonical-number   (-0 normalized to 0)
//   string                  ->  "s" + length + ":" + raw
//   array                   ->  "a" + count + "[" canon(e0) canon(e1)... "]"
//   map (nested value)      ->  "M{" entries ORDERED by canonical key string "}"
//   enum                    ->  "E" + tagLen + ":" + tag + "(" payload... ")"
//   struct                  ->  "S{" fields ALPHA-SORTED by name "}"
function _data_value_canonical(v) {
  if (v === null || v === undefined) return "0:";
  const t = typeof v;
  if (t === "boolean") return v ? "b1" : "b0";
  if (t === "number") {
    const n = v === 0 ? 0 : v; // collapse -0 to +0 (-0 === 0)
    return "n" + String(n);
  }
  if (t === "string") {
    return "s" + v.length + ":" + v;
  }
  if (Array.isArray(v)) {
    let out = "a" + v.length + "[";
    for (let i = 0; i < v.length; i++) out += _data_value_canonical(v[i]);
    return out + "]";
  }
  // Nested value-native map (§59.4 — a map may be a VALUE; only KEY types are
  // constrained). Canonicalize entries ordered by canonical key string.
  if (v && v.__scrml_map === true) {
    const mkeys = Object.keys(v.entries).sort();
    let mout = "M{";
    for (let mi = 0; mi < mkeys.length; mi++) {
      const ck = mkeys[mi];
      mout += ck.length + ":" + ck + _data_value_canonical(v.entries[ck].v);
    }
    return mout + "}";
  }
  // Enum: _tag + alpha-sorted payload fields.
  if (v && v._tag !== undefined) {
    const tag = String(v._tag);
    let eout = "E" + tag.length + ":" + tag + "(";
    const eKeys = Object.keys(v).filter((k) => k !== "_tag").sort();
    for (let ei = 0; ei < eKeys.length; ei++) {
      const ek = eKeys[ei];
      eout += ek.length + ":" + ek + _data_value_canonical(v[ek]);
    }
    return eout + ")";
  }
  // Struct: fields ALPHA-SORTED by name.
  const sKeys = Object.keys(v).sort();
  let sout = "S{";
  for (let si = 0; si < sKeys.length; si++) {
    const sk = sKeys[si];
    sout += sk.length + ":" + sk + _data_value_canonical(v[sk]);
  }
  return sout + "}";
}

export function unique(array, keyOrFn) {
  // No-key path: dedup by the value-canonical key (§59.5), NOT JS `Set` reference
  // identity — so value-equal structs collapse to one element, matching scrml `==`.
  if (!keyOrFn) {
    const seen = new Set();
    const result = [];
    for (const item of array) {
      const key = _data_value_canonical(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  }
  // Keyed path: dedup by the projected key, also via the value-canonical codec so
  // a non-primitive projection (e.g. a struct-valued field) stays value-correct.
  const fn = typeof keyOrFn === "function" ? keyOrFn : (item) => item[keyOrFn];
  const seen = new Set();
  const result = [];
  for (const item of array) {
    const key = _data_value_canonical(fn(item));
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Set-algebra helpers (S170 — "defer the set type, ship the helpers").
//
// union / intersection / difference operate on plain arrays and return plain
// arrays of value-DISTINCT elements, comparing via the §59.5 value-canonical
// codec so they are value-correct for struct / enum / nested elements (where
// `Array.includes` and JS `Set` are reference-keyed and would be wrong). No
// mutation; reassignment-canonical (`@x = union(@a, @b)`), consistent with how
// reactive arrays update. Each takes an optional `keyOrFn` that mirrors the
// `unique(array, keyOrFn)` family: a field name (string) or a projection fn;
// the default keys by the full value-canonical string.
//
// `member(arr, x)` is the value-correct membership test (`.includes` stays
// primitive-only — value-broken for structs). Returns a bool.
// ---------------------------------------------------------------------------

function _data_key_fn(keyOrFn) {
  if (!keyOrFn) return _data_value_canonical;
  if (typeof keyOrFn === "function") {
    return (item) => _data_value_canonical(keyOrFn(item));
  }
  return (item) => _data_value_canonical(item[keyOrFn]);
}

export function union(a, b, keyOrFn) {
  const key = _data_key_fn(keyOrFn);
  const seen = new Set();
  const result = [];
  for (const item of a) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  for (const item of b) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
}

export function intersection(a, b, keyOrFn) {
  const key = _data_key_fn(keyOrFn);
  const inB = new Set();
  for (const item of b) inB.add(key(item));
  const seen = new Set();
  const result = [];
  for (const item of a) {
    const k = key(item);
    if (inB.has(k) && !seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
}

export function difference(a, b, keyOrFn) {
  const key = _data_key_fn(keyOrFn);
  const inB = new Set();
  for (const item of b) inB.add(key(item));
  const seen = new Set();
  const result = [];
  for (const item of a) {
    const k = key(item);
    if (!inB.has(k) && !seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
}

export function member(arr, x, keyOrFn) {
  const key = _data_key_fn(keyOrFn);
  const target = key(x);
  for (const item of arr) {
    if (key(item) === target) return true;
  }
  return false;
}

export function flatten(array) {
  return array.flat();
}

export function flattenDeep(array) {
  return array.flat(Infinity);
}

export function chunk(array, size) {
  if (size < 1) return [];
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

export function toCamelCase(str) {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function camelizeKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(camelizeKeys);
  }
  if (obj !== null && obj !== undefined && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[toCamelCase(key)] = camelizeKeys(value);
    }
    return result;
  }
  return obj;
}

export function snakifyKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(snakifyKeys);
  }
  if (obj !== null && obj !== undefined && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[toSnakeCase(key)] = snakifyKeys(value);
    }
    return result;
  }
  return obj;
}

export function deepMerge(target, source) {
  if (typeof target !== "object" || typeof source !== "object") return source;
  if (Array.isArray(source)) return source;
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value === "object" && value !== null && !Array.isArray(value) &&
      typeof result[key] === "object" && result[key] !== null
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function clamp(value, minimum, maximum) {
  return mathMin(mathMax(value, minimum), maximum);
}

export function paginate(array, page, pageSize) {
  const total = array.length;
  const totalPages = ceil(total / pageSize);
  const currentPage = clamp(page, 1, totalPages || 1);
  const start = (currentPage - 1) * pageSize;
  const items = array.slice(start, start + pageSize);
  return {
    items,
    page: currentPage,
    pageSize,
    total,
    totalPages,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1,
  };
}

// ---------------------------------------------------------------------------
// validate.scrml — validation rule builders + schema validator
// ---------------------------------------------------------------------------

export function validate(data, schema) {
  const errors = {};
  for (const field of Object.keys(schema)) {
    const value = data[field];
    const rules = schema[field];
    for (const rule of rules) {
      const result = rule.check(value, data);
      if (!result.valid) {
        errors[field] = errors[field] || [];
        errors[field].push(result.message);
      }
    }
  }
  return errors;
}

export function isValid(result) {
  return Object.keys(result).length === 0;
}

export function firstError(result, field) {
  const errs = result[field];
  // `not` in scrml lowers to `null` per emit-expr.ts. Mirror that here.
  return errs && errs.length > 0 ? errs[0] : null;
}

function makeRule(check) {
  return { check };
}

export function required(message) {
  return makeRule((value) => {
    const valid = value !== null && value !== undefined && value !== "";
    return { valid, message: message || "This field is required" };
  });
}

export function email(message) {
  return makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
    return { valid, message: message || "Enter a valid email address" };
  });
}

export function minLength(minVal, message) {
  return makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    const valid = String(value).length >= minVal;
    return { valid, message: message || `Must be at least ${minVal} characters` };
  });
}

export function maxLength(maxVal, message) {
  return makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    const valid = String(value).length <= maxVal;
    return { valid, message: message || `Must be at most ${maxVal} characters` };
  });
}

export function exactLength(len, message) {
  return makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    const valid = String(value).length === len;
    return { valid, message: message || `Must be exactly ${len} characters` };
  });
}

export function pattern(regex, message) {
  return makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    const valid = regex.test(String(value));
    return { valid, message: message || "Invalid format" };
  });
}

export function min(minimum, message) {
  return makeRule((value) => {
    const num = Number(value);
    const valid = !isNaN(num) && num >= minimum;
    return { valid, message: message || `Must be at least ${minimum}` };
  });
}

export function max(maximum, message) {
  return makeRule((value) => {
    const num = Number(value);
    const valid = !isNaN(num) && num <= maximum;
    return { valid, message: message || `Must be at most ${maximum}` };
  });
}

export function numeric(message) {
  return makeRule((value) => {
    if (value === "" || value === null || value === undefined) return { valid: true, message: "" };
    const valid = !isNaN(Number(value)) && value !== "";
    return { valid, message: message || "Must be a number" };
  });
}

export function integer(message) {
  return makeRule((value) => {
    if (value === "" || value === null || value === undefined) return { valid: true, message: "" };
    const valid = Number.isInteger(Number(value));
    return { valid, message: message || "Must be a whole number" };
  });
}

export function matches(fieldName, message) {
  return makeRule((value, data) => {
    const valid = value === data[fieldName];
    return { valid, message: message || `Must match ${fieldName}` };
  });
}

export function oneOf(allowedValues, message) {
  return makeRule((value) => {
    const valid = allowedValues.includes(value);
    return { valid, message: message || `Must be one of: ${allowedValues.join(", ")}` };
  });
}

export function url(message) {
  return makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    try {
      new URL(String(value));
      return { valid: true, message: "" };
    } catch {
      return { valid: false, message: message || "Enter a valid URL" };
    }
  });
}

export function custom(fn) {
  return makeRule((value, data) => {
    const result = fn(value, data);
    if (result === true) return { valid: true, message: "" };
    return { valid: false, message: typeof result === "string" ? result : "Invalid value" };
  });
}

export function emailField() {
  return [required(), email()];
}

export function passwordField(minLen) {
  return [required(), minLength(minLen || 8)];
}

export function passwordConfirmField(fieldName) {
  return [required(), matches(fieldName || "password", "Passwords must match")];
}

// ---------------------------------------------------------------------------
// parse.scrml — parseVariant defensive fallback
//
// The compiler monomorphizes parseVariant at each call site (Path A — see
// SPEC §41.13 + L22). This export exists so name resolution (MOD) succeeds.
// If a call site reaches this body it means the codegen monomorphization
// failed to fire — surface as a clear runtime error rather than silent
// undefined behaviour.
// ---------------------------------------------------------------------------

export function parseVariant(_json, _T) {
  // Defensive fallback only — see header comment.
  throw new Error(
    "scrml:data parseVariant: internal — call site was not monomorphized at compile time."
  );
}

// ParseError shape used by the monomorphized call sites. Exposed for
// type imports + handler matching.
export const ParseError = Object.freeze({
  MissingDiscriminator: "MissingDiscriminator",
  UnknownVariant: "UnknownVariant",
  InvalidPayload: "InvalidPayload",
  Malformed: "Malformed",
});

// ---------------------------------------------------------------------------
// messages.scrml — thin wrappers around runtime helpers
//
// The runtime template defines _scrml_messages_register and
// _scrml_message_for in the `messages` chunk. The data shim's wrappers
// are functionally identical to the source-level scrml exports.
// ---------------------------------------------------------------------------

export function registerMessages(map) {
  // The runtime helper is a runtime global declared by the `messages`
  // chunk in compiler/src/runtime-template.js. Server side, the helper
  // is available because emit-server inlines the runtime for any file
  // touching validators. Client side, the shim is reached via the
  // `_scrml_stdlib.data` registry which runs AFTER the runtime is set up.
  if (typeof _scrml_messages_register === "function") {
    _scrml_messages_register(map);
  }
}

export function messageFor(error, fieldName, cellName) {
  if (typeof _scrml_message_for === "function") {
    return _scrml_message_for(error, fieldName, cellName);
  }
  // Fallback when the messages chunk was tree-shaken — return a stub.
  return String(error?.tag || error || "");
}

// ---------------------------------------------------------------------------
// form-for.scrml — formFor stub + registerLabels wrapper
//
// formFor: canonical usage is the markup element form <formFor for=Struct/>;
// the compiler's type-system stage rewrites every element before any code
// emission. If a call site reaches this body it means the rewrite failed —
// surface as a clear runtime error rather than silent undefined behaviour.
//
// registerLabels: thin wrapper around the _scrml_labels_register helper in
// the runtime template's 'messages' chunk (co-located — see runtime-
// template.js §41.14.7 block). Mirrors registerMessages — no-op when the
// helper is absent (tree-shaken away).
// ---------------------------------------------------------------------------

export function formFor(_StructType, _options) {
  // Defensive fallback only — see header comment.
  throw new Error(
    "scrml:data formFor: internal — call site was not rewritten at compile time. " +
    "The canonical usage is the markup element form <formFor for=Struct .../>; " +
    "the bare-call form is reserved for v1.next per SPEC §41.14."
  );
}

export function registerLabels(map) {
  // The runtime helper is defined by the 'messages' chunk in runtime-template.js
  // (co-located with the messages registry — see §41.14.7 block). Server side,
  // the helper is available because emit-server inlines the runtime for any
  // file touching validators OR formFor. Client side, this shim is reached via
  // the `_scrml_stdlib.data` registry which runs AFTER the runtime is set up.
  // No-op when the helper is tree-shaken away (consistent with registerMessages).
  if (typeof _scrml_labels_register === "function") {
    _scrml_labels_register(map);
  }
}

// ---------------------------------------------------------------------------
// schema-for.scrml — schemaFor defensive fallback
//
// Canonical usage is the function-call form interpolated inside a `<schema>`
// block: `<schema>${ schemaFor(StructType) }</>`. The compiler's type-system
// stage rewrites every such call into the equivalent shared-core table-
// declaration fragment BEFORE any code emission. If a call site reaches this
// body it means the rewrite failed — surface as a clear runtime error rather
// than silent undefined behaviour.
//
// Calls OUTSIDE a `<schema>` block are rejected at compile time with
// E-SCHEMAFOR-INVALID-CALL-CONTEXT — they never reach this fallback.
// ---------------------------------------------------------------------------

export function schemaFor(_StructType, _options) {
  // Defensive fallback only — see header comment.
  throw new Error(
    "scrml:data schemaFor: internal — call site was not rewritten at compile time. " +
    "The canonical usage is `<schema>${ schemaFor(StructType) }</>`; the call " +
    "site must appear inside a <schema> block via ${...} interpolation per " +
    "SPEC §41.15."
  );
}
