// =============================================================================
// self-host-v2 / slice-codec / runtime / codec.js — the §57 wire codec,
// RUNTIME half (arc unit Uc).
//
// Encodes and decodes VALUES against a wire descriptor: the JS literal that
// codec.scrml (`wireTableJs`) resolves from a Core type at compile time:
//
//   table = { defs: [def…], root: ty }
//   def   = { k: "struct", name, fields: [{ name, ty }] } | { k: "enum", name, tags: [string] }
//   ty    = { k: "int" | "num" | "str" | "bool" } | { k: "maybe", inner: ty }
//         | { k: "seq", elem: ty, bound: { k: "free" | "fixed" } | { k: "bounded", min, max } }
//         | { k: "ref", def: index into defs }
//
// Runtime values are the bootstrap's (print.scrml): Int/Num = number, Str =
// string, Bool = boolean, a struct = a plain object keyed by declared field
// names, a payload-free enum value = its tag string, a sequence = an array, and
// `not` = `null` (§42.8; `undefined` is treated as `not`, §42.9).
//
// SPEC — what this file implements (quoted in docs/changes/s446-bootstrap-uc-codec/progress.md):
//   §57.2  envelope `{"__scrml_absent": true}` — "exactly one own property named
//          `__scrml_absent` whose value is the boolean `true`".
//   §57.3  the encoder emits the envelope for absence in a `T | not` position,
//          the plain value otherwise (no wrapping of presence).
//          The encoder is STRICT by default: it encodes only values that inhabit
//          the type, so `encode` ok ⇒ `decode` of its output ok and equal. A
//          null/undefined at a NON-`T | not` position, a sequence hole, or a
//          length outside a `Bounded` range is a "value" failure.
//          §57.3's server-function-RETURN sentence — "For declared return types
//          that are NOT `T | not` … the encoder continues to use raw JSON `null`
//          for any JS-host `null` that may slip through" — is the explicit
//          opt-in `{ hostNullPassthrough: true }` (for U1's return position
//          only): a null/undefined at a non-`T | not` position then encodes as
//          raw `null`, which the decoder (correctly) refuses.
//   §57.4  dual-decoder: a `T | not` position accepts the envelope AND raw `null`;
//          "Any envelope shape other than the two admitted forms … SHALL be
//          treated as a malformed payload"; "SHALL NOT silently coerce".
//   §57.5  canonical-only decoding (raw `null` malformed) — selectable with
//          `{ canonicalOnly: true }`; the default is the v0.x dual-decoder.
//   §12.5.1 a (payload-free) enum value is its variant name string.
//   §6.14.2 r3 decode against the current type AND its contract; never coerced —
//          a failure is a VALUE the caller maps to "take the default" (U5) or to
//          its deserialization-error path (U1, §57.4).
//
// Results never throw on ANY input value: `{ ok: true, value }` / `{ ok: true, wire }`
// or `{ ok: false, error: { kind, path, reason } }`, `kind` one of:
//   "malformed" — decode: the JSON does not have the type's shape (§57.4)
//   "contract"  — decode: the shape fits but a type contract fails (a §66.12 length bound)
//   "parse"     — `decodeText` only: the text is not JSON
//   "value"     — encode: the runtime value does not inhabit the type
// A throw while reading the input (a getter, a Proxy trap, a cycle or hostile
// nesting overflowing the stack) becomes a failure of the operation's kind.
// The ONE thing that throws is a `CodecDefect`: a broken DESCRIPTOR, which is a
// compiler bug, not bad input.
// =============================================================================

export const ABSENT_KEY = "__scrml_absent";

/** A malformed descriptor (a compiler defect) — the only throw out of this module. */
export class CodecDefect extends Error {}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// A JSON-shaped object: not an array, and a plain prototype (Object.prototype,
// or null) — a Date, Map, class instance, … is not a struct value.
const isPlainObject = (x) => {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

/** §57.2: an object with exactly one own property, `__scrml_absent`, whose value is `true`. */
export function isAbsenceEnvelope(x) {
  if (!isPlainObject(x)) return false;
  const keys = Object.keys(x);
  return keys.length === 1 && keys[0] === ABSENT_KEY && x[ABSENT_KEY] === true;
}

/** A fresh envelope (never shared, so a caller mutating one cannot poison the next). */
function envelope() {
  return { [ABSENT_KEY]: true };
}

function fail(kind, path, reason) {
  return { ok: false, error: { kind, path, reason } };
}

/** Define an own data property (a field named `__proto__` must not set the prototype). */
function setField(o, name, v) {
  Object.defineProperty(o, name, { value: v, enumerable: true, writable: true, configurable: true });
}

function defOf(table, ty) {
  const d = table.defs[ty.def];
  if (d === undefined) throw new CodecDefect(`codec: descriptor ref ${ty.def} names no def`);
  return d;
}

function describe(table, ty) {
  switch (ty.k) {
    case "int": return "int";
    case "num": return "number";
    case "str": return "string";
    case "bool": return "boolean";
    case "maybe": return describe(table, ty.inner) + " | not";
    case "seq": return describe(table, ty.elem) + "[]";
    case "ref": return defOf(table, ty).name;
    default: throw new CodecDefect(`codec: unknown descriptor kind ${JSON.stringify(ty.k)}`);
  }
}

// -----------------------------------------------------------------------------
// Encode — value → JSON-safe value.
// -----------------------------------------------------------------------------

function enc(table, ty, v, path, opts) {
  if (ty.k === "maybe") {
    // §57.3: absence in a `T | not` position is the canonical envelope.
    if (v === null || v === undefined) return { ok: true, wire: envelope() };
    return enc(table, ty.inner, v, path, opts);
  }
  if (v === null || v === undefined) {
    // §57.3 bullet 5 (server-fn return only, opt-in): a slipped JS-host null stays raw `null`.
    if (opts.hostNullPassthrough) return { ok: true, wire: null };
    return fail("value", path, `${show(v)} where ${describe(table, ty)} (no absence) is expected`);
  }
  switch (ty.k) {
    case "int":
      if (typeof v === "number" && Number.isInteger(v)) return { ok: true, wire: v };
      return fail("value", path, `expected an int, got ${show(v)}`);
    case "num":
      if (typeof v !== "number") return fail("value", path, `expected a number, got ${show(v)}`);
      // JSON has no NaN/Infinity (JSON.stringify would write `null`, i.e. absence on decode).
      if (!Number.isFinite(v)) return fail("value", path, `${v} has no JSON form`);
      return { ok: true, wire: v };
    case "str":
      if (typeof v === "string") return { ok: true, wire: v };
      return fail("value", path, `expected a string, got ${show(v)}`);
    case "bool":
      if (typeof v === "boolean") return { ok: true, wire: v };
      return fail("value", path, `expected a boolean, got ${show(v)}`);
    case "seq": {
      if (!Array.isArray(v)) return fail("value", path, `expected a sequence, got ${show(v)}`);
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const r = enc(table, ty.elem, v[i], `${path}[${i}]`, opts);
        if (!r.ok) return r;
        out.push(r.wire);
      }
      // §66.12: a value outside its `Bounded` range does not inhabit the type.
      if (ty.bound.k === "bounded" && (out.length < ty.bound.min || out.length > ty.bound.max)) {
        return fail("value", path, `length ${out.length} is outside ${ty.bound.min}..${ty.bound.max}`);
      }
      return { ok: true, wire: out };
    }
    case "ref": {
      const d = defOf(table, ty);
      if (d.k === "enum") {
        // §12.5.1: an enum value serializes as its variant name string.
        if (typeof v === "string" && d.tags.includes(v)) return { ok: true, wire: v };
        return fail("value", path, `expected a ${d.name} variant, got ${show(v)}`);
      }
      if (!isPlainObject(v)) return fail("value", path, `expected a ${d.name}, got ${show(v)}`);
      const out = {};
      for (const f of d.fields) {
        if (!hasOwn(v, f.name)) return fail("value", path, `${d.name} value has no field ${f.name}`);
        const r = enc(table, f.ty, v[f.name], `${path}.${f.name}`, opts);
        if (!r.ok) return r;
        setField(out, f.name, r.wire);
      }
      return { ok: true, wire: out };
    }
    default:
      throw new CodecDefect(`codec: unknown descriptor kind ${JSON.stringify(ty.k)}`);
  }
}

/**
 * Encode a runtime value against `table` → `{ ok, wire }` (a JSON-safe value) or a failure.
 * `opts.hostNullPassthrough` (default false): §57.3's server-fn-return raw-null rule.
 */
export function encode(table, value, opts) {
  const o = { hostNullPassthrough: (opts ?? {}).hostNullPassthrough === true };
  return guarded("value", () => enc(table, table.root, value, "$", o));
}

/** Encode to JSON text → `{ ok, text }` or a failure. */
export function encodeText(table, value, opts) {
  const r = encode(table, value, opts);
  if (!r.ok) return r;
  return { ok: true, text: JSON.stringify(r.wire) };
}

// -----------------------------------------------------------------------------
// Decode — JSON value → runtime value (type-directed, fail-closed, no coercion).
// -----------------------------------------------------------------------------

function dec(table, ty, w, path, opts) {
  if (ty.k === "maybe") {
    if (isAbsenceEnvelope(w)) return { ok: true, value: null };
    if (w === null) {
      // §57.4 dual-decoder (v0.x) admits raw null; §57.5 canonical-only refuses it.
      if (opts.canonicalOnly) return fail("malformed", path, "raw null is not the canonical absence envelope (§57.5)");
      return { ok: true, value: null };
    }
    // §57.4: no other object shape may stand for absence — an object that
    // carries the envelope key but is not exactly the envelope is malformed.
    if (isPlainObject(w) && hasOwn(w, ABSENT_KEY)) {
      return fail("malformed", path, `an object carrying ${ABSENT_KEY} that is not exactly the §57.2 envelope`);
    }
    return dec(table, ty.inner, w, path, opts);
  }
  if (w === null) return fail("malformed", path, `null where ${describe(table, ty)} (no absence) is expected`);
  if (isAbsenceEnvelope(w)) return fail("malformed", path, `the absence envelope where ${describe(table, ty)} (no absence) is expected`);
  switch (ty.k) {
    case "int":
      if (typeof w === "number" && Number.isInteger(w)) return { ok: true, value: w };
      return fail("malformed", path, `expected an int, got ${show(w)}`);
    case "num":
      if (typeof w === "number" && Number.isFinite(w)) return { ok: true, value: w };
      return fail("malformed", path, `expected a number, got ${show(w)}`);
    case "str":
      if (typeof w === "string") return { ok: true, value: w };
      return fail("malformed", path, `expected a string, got ${show(w)}`);
    case "bool":
      if (typeof w === "boolean") return { ok: true, value: w };
      return fail("malformed", path, `expected a boolean, got ${show(w)}`);
    case "seq": {
      if (!Array.isArray(w)) return fail("malformed", path, `expected a sequence, got ${show(w)}`);
      const out = [];
      for (let i = 0; i < w.length; i++) {
        const r = dec(table, ty.elem, w[i], `${path}[${i}]`, opts);
        if (!r.ok) return r;
        out.push(r.value);
      }
      // §66.12 length axis: only `bounded` constrains a value (§6.14.2 r3 "sequence bounds").
      if (ty.bound.k === "bounded" && (out.length < ty.bound.min || out.length > ty.bound.max)) {
        return fail("contract", path, `length ${out.length} is outside ${ty.bound.min}..${ty.bound.max}`);
      }
      return { ok: true, value: out };
    }
    case "ref": {
      const d = defOf(table, ty);
      if (d.k === "enum") {
        if (typeof w === "string" && d.tags.includes(w)) return { ok: true, value: w };
        return fail("malformed", path, `expected a ${d.name} variant name, got ${show(w)}`);
      }
      if (!isPlainObject(w)) return fail("malformed", path, `expected a ${d.name} object, got ${show(w)}`);
      const declared = new Set(d.fields.map((f) => f.name));
      for (const k of Object.keys(w)) {
        // A key the type does not declare is refused, not dropped (no coercion).
        if (!declared.has(k)) return fail("malformed", `${path}.${k}`, `${d.name} has no field ${k}`);
      }
      const out = {};
      for (const f of d.fields) {
        // A missing field is malformed even for a `T | not` field: §57.4 admits
        // only the envelope and raw null as absence, not omission.
        if (!hasOwn(w, f.name)) return fail("malformed", `${path}.${f.name}`, `missing field ${f.name} of ${d.name}`);
        const r = dec(table, f.ty, w[f.name], `${path}.${f.name}`, opts);
        if (!r.ok) return r;
        setField(out, f.name, r.value);
      }
      return { ok: true, value: out };
    }
    default:
      throw new CodecDefect(`codec: unknown descriptor kind ${JSON.stringify(ty.k)}`);
  }
}

/**
 * Decode a parsed JSON value against `table` → `{ ok, value }` or a failure.
 * `opts.canonicalOnly` (default false): refuse raw `null` as absence (§57.5).
 */
export function decode(table, wire, opts) {
  const o = { canonicalOnly: (opts ?? {}).canonicalOnly === true };
  return guarded("malformed", () => dec(table, table.root, wire, "$", o));
}

/** Decode JSON text → `{ ok, value }` or a failure (`kind: "parse"` for non-JSON text). */
export function decodeText(table, text, opts) {
  if (typeof text !== "string") return fail("parse", "$", `expected JSON text, got ${text === null ? "null" : typeof text}`);
  let wire;
  try {
    wire = JSON.parse(text);
  } catch (e) {
    return fail("parse", "$", `not JSON: ${message(e)}`);
  }
  return decode(table, wire, opts);
}

// Reading the input may throw: a recursive type admits unboundedly deep input
// (or, on encode, a cyclic value) that exhausts the stack, and a getter or a
// Proxy trap may throw. Each is a failure of the operation's `kind`, not a
// crash. A `CodecDefect` (a broken descriptor) is a compiler bug and propagates.
function guarded(kind, run) {
  try {
    return run();
  } catch (e) {
    // `instanceof` on a thrown Proxy runs its traps, so classify defensively.
    let defect = false;
    let overflow = false;
    try {
      defect = e instanceof CodecDefect;
      overflow = e instanceof RangeError;
    } catch {
      // a hostile thrown value: neither
    }
    if (defect) throw e;
    if (overflow) return fail(kind, "$", "nesting too deep (or a cyclic value)");
    return fail(kind, "$", `reading the input threw: ${message(e)}`);
  }
}

// An error's message, without trusting the thrown thing (it may be any value).
function message(e) {
  try {
    return String(e instanceof Error ? e.message : e);
  } catch {
    return "an unprintable error";
  }
}

function show(x) {
  if (x === undefined) return "undefined";
  if (typeof x === "string") return JSON.stringify(x.length > 40 ? x.slice(0, 40) + "…" : x);
  if (Array.isArray(x)) return "an array";
  if (x === null) return "null";
  if (typeof x === "object") return "an object";
  return String(x);
}
