// codec.test.js — the §57 wire codec (arc unit Uc): descriptors built by the
// bootstrap's compile-time half (codec.scrml, compiled by impl#1) from REAL
// Core types (the bootstrap front end lowers slice-codec/src/types.scrml), and
// values encoded / decoded by the runtime half (runtime/codec.js).
//
// SPEC: §57.2-§57.5, §12.5.1, §42.3.1, §42.8-§42.9, §6.14.2 r3, §66.12.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCodec, descriptor } from "./harness.js";
import { frontEnd } from "../slice-m2/lowered.js";
import { ABSENT_KEY, CodecDefect, decode, decodeError, decodeText, encode, encodeText, isAbsenceEnvelope } from "./runtime/codec.js";

const { mods } = loadCodec();
const SRC = readFileSync(join(import.meta.dir, "src", "types.scrml"), "utf8");
const fe = frontEnd(mods, [{ path: "types.scrml", src: SRC }]);
const core = fe.core;

// Core `Type` values as impl#1 represents the bootstrap's enums at run time
// (a unit variant is its name; a payload variant is { variant, data }).
const T = {
  Int: "Int",
  Num: "Num",
  Str: "Str",
  Bool: "Bool",
  Named: (sym) => ({ variant: "Named", data: { sym } }),
  Maybe: (inner) => ({ variant: "Maybe", data: { inner } }),
  Seq: (elem, length = "Free") => ({ variant: "Seq", data: { elem, grants: { length, at: [], shrink: [], positionsWritable: false } } }),
  Bounded: (min, max) => ({ variant: "Bounded", data: { min, max } }),
};

function typeSym(name) {
  for (const t of core.types) if (t.data.sym.hint === name) return t.data.sym;
  throw new Error("no type " + name);
}
const named = (name) => T.Named(typeSym(name));

function table(ty) {
  const d = descriptor(mods, core, ty);
  if (d.table === null) throw new Error("refused: " + d.why.join("; "));
  return d.table;
}

/** encode → JSON text → decode, the full wire trip. */
function trip(tb, v, opts) {
  const e = encodeText(tb, v);
  expect(e.ok).toBe(true);
  const d = decodeText(tb, e.text, opts);
  return { text: e.text, d };
}

// A small deterministic PRNG (mulberry32) — property tests must replay.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRS = ["", "a", "not", "null", "__scrml_absent", '{"__scrml_absent":true}', "quote\"back\\slash", "ünïcødé ✓", "line\nbreak"];

/** A random runtime value of descriptor type `ty` (`not` with p = 0.35 at every `maybe`). */
function gen(tb, ty, r, depth) {
  switch (ty.k) {
    case "int": return Math.floor(r() * 2e6) - 1e6;
    case "num": return r() < 0.2 ? 0 : (r() - 0.5) * 1e6;
    case "str": return STRS[Math.floor(r() * STRS.length)];
    case "bool": return r() < 0.5;
    case "maybe": return r() < 0.35 || depth > 4 ? null : gen(tb, ty.inner, r, depth + 1);
    case "seq": {
      let lo = 0, hi = depth > 4 ? 0 : 3;
      if (ty.bound.k === "bounded") { lo = ty.bound.min; hi = ty.bound.max; }
      const n = lo + Math.floor(r() * (hi - lo + 1));
      return Array.from({ length: n }, () => gen(tb, ty.elem, r, depth + 1));
    }
    case "ref": {
      const d = tb.defs[ty.def];
      if (d.k === "enum") {
        // §57.8 / Ue DESIGN §5: a unit variant is its name; a payload variant
        // is { variant, data: [v0, …] } (positional, declared order). Deep in
        // a recursive draw, prefer a unit variant when there is one.
        const units = d.variants.filter((x) => x.fields.length === 0);
        const pool = depth > 4 && units.length > 0 ? units : d.variants;
        const v = pool[Math.floor(r() * pool.length)];
        if (v.fields.length === 0) return v.name;
        return { variant: v.name, data: v.fields.map((f) => gen(tb, f.ty, r, depth + 1)) };
      }
      const o = {};
      for (const f of d.fields) o[f.name] = gen(tb, f.ty, r, depth + 1);
      return o;
    }
  }
  throw new Error("gen: " + ty.k);
}

/** Every `maybe` position of `w` (by the descriptor) holds the canonical envelope or a present value — never raw null. */
function noRawNullAtMaybe(tb, ty, w) {
  switch (ty.k) {
    case "maybe": return w !== null && (isAbsenceEnvelope(w) || noRawNullAtMaybe(tb, ty.inner, w));
    case "seq": return w.every((x) => noRawNullAtMaybe(tb, ty.elem, x));
    case "ref": {
      const d = tb.defs[ty.def];
      if (d.k === "enum") {
        if (typeof w === "string") return true;
        const v = d.variants.find((x) => x.name === w.variant);
        return v.fields.every((f) => noRawNullAtMaybe(tb, f.ty, w.data[f.name]));
      }
      return d.fields.every((f) => noRawNullAtMaybe(tb, f.ty, w[f.name]));
    }
    default: return true;
  }
}

describe("front end → Core types used here", () => {
  test("types.scrml lowers with no diagnostics", () => {
    expect(fe.diags).toEqual([]);
    expect(core.types.map((t) => t.data.sym.hint)).toEqual(["Pt", "Color", "Box", "Node", "Shape", "Holder", "Res"]);
  });
});

describe("descriptor (codec.scrml wireBuild → wireTableJs)", () => {
  test("scalars", () => {
    for (const [ty, k] of [[T.Int, "int"], [T.Num, "num"], [T.Str, "str"], [T.Bool, "bool"]]) {
      expect(table(ty)).toEqual({ defs: [], root: { k } });
    }
  });

  test("a struct from source: declared field names, declared order, Maybe / Seq / enum refs", () => {
    const d = descriptor(mods, core, named("Box"));
    expect(d.why).toEqual([]);
    expect(d.text).toBe(
      '{ defs: [{ k: "struct", name: "Box", fields: [{ name: "p", ty: { k: "maybe", inner: { k: "ref", def: 1 } } }, ' +
        '{ name: "ps", ty: { k: "seq", elem: { k: "ref", def: 1 }, bound: { k: "fixed" } } }, ' +
        '{ name: "color", ty: { k: "ref", def: 2 } }, { name: "note", ty: { k: "maybe", inner: { k: "str" } } }] }, ' +
        '{ k: "struct", name: "Pt", fields: [{ name: "x", ty: { k: "int" } }, { name: "y", ty: { k: "num" } }, ' +
        '{ name: "label", ty: { k: "str" } }, { name: "on", ty: { k: "bool" } }] }, ' +
        '{ k: "enum", name: "Color", variants: [{ name: "Red", fields: [] }, { name: "Green", fields: [] }, { name: "Blue", fields: [] }] }], ' +
        'root: { k: "ref", def: 0 } }',
    );
  });

  test("a recursive struct closes on ONE def slot", () => {
    const tb = table(named("Node"));
    expect(tb.defs.length).toBe(1);
    expect(tb.defs[0].fields.map((f) => f.ty)).toEqual([
      { k: "int" },
      { k: "seq", elem: { k: "ref", def: 0 }, bound: { k: "fixed" } },
      { k: "maybe", inner: { k: "ref", def: 0 } },
    ]);
  });

  test("§42.3.1: Maybe(Maybe(T)) normalizes to one maybe", () => {
    expect(table(T.Maybe(T.Maybe(T.Maybe(T.Int))))).toEqual({ defs: [], root: { k: "maybe", inner: { k: "int" } } });
  });

  test("§66.12 length axis rides on the seq", () => {
    expect(table(T.Seq(T.Int, T.Bounded(1, 3))).root.bound).toEqual({ k: "bounded", min: 1, max: 3 });
    expect(table(T.Seq(T.Int, "Free")).root.bound).toEqual({ k: "free" });
  });

  test("s454 (§57.8): a payload-carrying enum variant is DESCRIBED — declared field names, declared order", () => {
    const d = descriptor(mods, core, named("Holder"));
    expect(d.why).toEqual([]);
    expect(d.text).toBe(
      '{ defs: [{ k: "struct", name: "Holder", fields: [{ name: "s", ty: { k: "ref", def: 1 } }] }, ' +
        '{ k: "enum", name: "Shape", variants: [{ name: "Circle", fields: [{ name: "r", ty: { k: "num" } }] }, ' +
        '{ name: "Square", fields: [] }] }], root: { k: "ref", def: 0 } }',
    );
  });

  test("REFUSED: a struct field named __scrml_absent (a present value would BE the envelope)", () => {
    const s = mods.core.mkSym(900, "Bad");
    const f = mods.core.mkSym(901, ABSENT_KEY);
    const p = { ...core, types: [...core.types, { variant: "StructDef", data: { sym: s, fields: [{ sym: f, ty: T.Bool, grants: { replace: false, edits: [] } }] } }] };
    const b = mods.codec.wireBuild(p, T.Maybe(T.Named(s)));
    expect(b.table).toBeNull();
    expect(b.why[0]).toContain("has a field named __scrml_absent");
  });

  test("REFUSED: Named naming no type definition", () => {
    const b = mods.codec.wireBuild(core, T.Named(mods.core.mkSym(777, "ghost")));
    expect(b.table).toBeNull();
    expect(b.why[0]).toContain("Named(ghost#777) names no type definition");
  });
});

describe("encode (§57.3)", () => {
  test("absence at a T | not root is the canonical envelope, exactly", () => {
    const tb = table(T.Maybe(T.Int));
    expect(encodeText(tb, null)).toEqual({ ok: true, text: '{"__scrml_absent":true}' });
    expect(encodeText(tb, undefined)).toEqual({ ok: true, text: '{"__scrml_absent":true}' }); // §42.9
  });

  test("presence is NOT wrapped: a T | not whose value is 42 is 42", () => {
    expect(encodeText(table(T.Maybe(T.Int)), 42)).toEqual({ ok: true, text: "42" });
    expect(encodeText(table(T.Maybe(T.Str)), "")).toEqual({ ok: true, text: '""' }); // §42.1.1: "" is not absence
  });

  test("STRICT by default: null / undefined at a NON-T | not position is a value failure", () => {
    expect(encode(table(T.Int), null).error).toEqual({ kind: "value", path: "$", reason: "null where int (no absence) is expected" });
    expect(encode(table(T.Int), undefined).error.kind).toBe("value");
    expect(encode(table(T.Seq(T.Int)), [1, , 3]).error).toEqual({ kind: "value", path: "$[1]", reason: "undefined where int (no absence) is expected" });
    expect(encode(table(named("Pt")), { x: 1, y: undefined, label: "a", on: true }).error.path).toBe("$.y");
  });

  test("STRICT by default: a sequence outside its Bounded range is a value failure", () => {
    const tb = table(T.Seq(T.Int, T.Bounded(1, 2)));
    expect(encode(tb, []).error).toEqual({ kind: "value", path: "$", reason: "length 0 is outside 1..2" });
    expect(encode(tb, [1, 2, 3]).error.kind).toBe("value");
    expect(encodeText(tb, [1])).toEqual({ ok: true, text: "[1]" });
  });

  test("opt-in hostNullPassthrough: §57.3's server-fn-return raw null for a slipped JS-host null", () => {
    const o = { hostNullPassthrough: true };
    expect(encodeText(table(T.Int), null, o)).toEqual({ ok: true, text: "null" });
    expect(encodeText(table(T.Int), undefined, o)).toEqual({ ok: true, text: "null" });
    expect(encodeText(table(T.Seq(T.Int)), [1, null], o)).toEqual({ ok: true, text: "[1,null]" });
    // absence in a T | not position is still the envelope, never raw null
    expect(encodeText(table(T.Maybe(T.Int)), null, o)).toEqual({ ok: true, text: '{"__scrml_absent":true}' });
    // the decoder refuses what the passthrough let out (null where no absence is admitted)
    expect(decodeText(table(T.Int), encodeText(table(T.Int), null, o).text).error.kind).toBe("malformed");
    // it does not relax anything else
    expect(encode(table(T.Int), "1", o).error.kind).toBe("value");
  });

  test("an enum value is its variant name string (§12.5.1)", () => {
    expect(encodeText(table(named("Color")), "Green")).toEqual({ ok: true, text: '"Green"' });
  });

  test("not at every nesting level: root, struct field, sequence element, recursive field", () => {
    const tb = table(named("Box"));
    const box = { p: null, ps: [{ x: 1, y: 2.5, label: "a", on: true }], color: "Red", note: null };
    expect(encodeText(tb, box).text).toBe(
      '{"p":{"__scrml_absent":true},"ps":[{"x":1,"y":2.5,"label":"a","on":true}],"color":"Red","note":{"__scrml_absent":true}}',
    );
    const seq = table(T.Seq(T.Maybe(named("Pt"))));
    expect(encodeText(seq, [null, { x: 0, y: 0, label: "", on: false }, null]).text).toBe(
      '[{"__scrml_absent":true},{"x":0,"y":0,"label":"","on":false},{"__scrml_absent":true}]',
    );
    const node = table(named("Node"));
    expect(encodeText(node, { v: 1, kids: [{ v: 2, kids: [], next: null }], next: { v: 3, kids: [], next: null } }).text).toBe(
      '{"v":1,"kids":[{"v":2,"kids":[],"next":{"__scrml_absent":true}}],"next":{"v":3,"kids":[],"next":{"__scrml_absent":true}}}',
    );
  });

  test("value failures are results, not throws", () => {
    expect(encode(table(T.Num), NaN).error.kind).toBe("value");
    expect(encode(table(T.Num), Infinity).error.reason).toContain("no JSON form");
    expect(encode(table(T.Int), 1.5).error).toEqual({ kind: "value", path: "$", reason: "expected an int, got 1.5" });
    expect(encode(table(named("Color")), "Purple").error.kind).toBe("value");
    expect(encode(table(named("Pt")), { x: 1, y: 2, label: "a" }).error.reason).toBe("Pt value has no field on");
    expect(encode(table(T.Seq(T.Int)), [1, "2"]).error.path).toBe("$[1]");
  });
});

describe("decode (§57.4 dual-decoder, fail-closed)", () => {
  test("a T | not position accepts the envelope AND raw null, both → not", () => {
    const tb = table(T.Maybe(named("Pt")));
    expect(decodeText(tb, '{"__scrml_absent":true}')).toEqual({ ok: true, value: null });
    expect(decodeText(tb, "null")).toEqual({ ok: true, value: null });
  });

  test("§57.5 canonical-only mode refuses raw null, still accepts the envelope", () => {
    const tb = table(T.Maybe(T.Int));
    expect(decodeText(tb, "null", { canonicalOnly: true }).error.kind).toBe("malformed");
    expect(decodeText(tb, '{"__scrml_absent":true}', { canonicalOnly: true })).toEqual({ ok: true, value: null });
  });

  test("no other object shape stands for absence", () => {
    const tb = table(T.Maybe(T.Int));
    for (const bad of ['{"__scrml_absent":false}', '{"__scrml_absent":1}', '{"__scrml_absent":true,"x":1}', "{}", '{"__scrml_absent":"true"}']) {
      const r = decodeText(tb, bad);
      expect(r.ok).toBe(false);
      expect(r.error.kind).toBe("malformed");
    }
  });

  test("absence where the type admits none is malformed (envelope or null)", () => {
    expect(decodeText(table(T.Int), "null").error.reason).toBe("null where int (no absence) is expected");
    expect(decodeText(table(named("Pt")), '{"__scrml_absent":true}').error.kind).toBe("malformed");
    expect(decodeText(table(T.Seq(T.Str)), '["a",null]').error.path).toBe("$[1]");
  });

  test("wrong type at each kind — never coerced", () => {
    const cases = [
      [T.Int, '"1"'], [T.Int, "1.5"], [T.Int, "true"],
      [T.Num, '"1"'], [T.Num, "[]"],
      [T.Str, "1"], [T.Str, "{}"],
      [T.Bool, "0"], [T.Bool, '"true"'],
      [T.Seq(T.Int), '{"0":1}'], [T.Seq(T.Int), '"abc"'],
      [named("Color"), '"Purple"'], [named("Color"), "0"], [named("Color"), '"red"'],
      [named("Pt"), "[]"], [named("Pt"), '"Pt"'],
    ];
    for (const [ty, text] of cases) {
      const r = decodeText(table(ty), text);
      expect(r.ok).toBe(false);
      expect(r.error.kind).toBe("malformed");
    }
  });

  test("missing field is malformed — even a T | not field (omission is not an admitted absence form)", () => {
    const tb = table(named("Box"));
    const r = decodeText(tb, '{"ps":[],"color":"Red","note":null}');
    expect(r.error).toEqual({ kind: "malformed", path: "$.p", reason: "missing field p of Box" });
  });

  test("extra field is malformed — refused, not dropped", () => {
    const tb = table(named("Pt"));
    const r = decodeText(tb, '{"x":1,"y":2,"label":"a","on":true,"z":9}');
    expect(r.error).toEqual({ kind: "malformed", path: "$.z", reason: "Pt has no field z" });
    expect(decodeText(tb, '{"x":1,"y":2,"label":"a","on":true,"__proto__":{"x":5}}').error.path).toBe("$.__proto__");
  });

  test("§66.12 bounded length is a CONTRACT failure (shape fits)", () => {
    const tb = table(T.Seq(T.Int, T.Bounded(1, 2)));
    expect(decodeText(tb, "[]").error).toEqual({ kind: "contract", path: "$", reason: "length 0 is outside 1..2" });
    expect(decodeText(tb, "[1,2,3]").error.kind).toBe("contract");
    expect(decodeText(tb, "[1,2]")).toEqual({ ok: true, value: [1, 2] });
  });

  test("non-JSON text is a parse failure; hostile nesting is malformed, not a crash", () => {
    expect(decodeText(table(T.Int), "{oops").error.kind).toBe("parse");
    expect(decodeText(table(T.Int), 5).error.kind).toBe("parse");
    const tb = table(named("Node"));
    let w = { v: 0, kids: [], next: { [ABSENT_KEY]: true } };
    for (let i = 0; i < 200000; i++) w = { v: i, kids: [], next: w };
    const r = decode(tb, w);
    expect(r.ok).toBe(false);
    expect(r.error).toEqual({ kind: "malformed", path: "$", reason: "nesting too deep (or a cyclic value)" });
  });

  test("U5 shape: a failure is a value the caller maps to the default (§6.14.2 r3)", () => {
    const tb = table(named("Box"));
    const dflt = { p: null, ps: [], color: "Red", note: null };
    const restore = (text) => {
      const r = decodeText(tb, text);
      return r.ok ? r.value : dflt;
    };
    expect(restore(null)).toBe(dflt); // key absent (storage.getItem → null)
    expect(restore("{bad")).toBe(dflt);
    expect(restore('{"p":null,"ps":[],"color":"Mauve","note":null}')).toBe(dflt);
    expect(restore('{"p":null,"ps":[],"color":"Blue","note":"hi"}')).toEqual({ p: null, ps: [], color: "Blue", note: "hi" });
  });
});

describe("round trip — property style over every supported type", () => {
  const TYPES = {
    int: () => T.Int,
    num: () => T.Num,
    str: () => T.Str,
    bool: () => T.Bool,
    "int | not": () => T.Maybe(T.Int),
    "Color (enum)": () => named("Color"),
    "Color | not": () => T.Maybe(named("Color")),
    "Pt (struct)": () => named("Pt"),
    "Box (nested struct, Maybe fields)": () => named("Box"),
    "Node (recursive)": () => named("Node"),
    "Node | not": () => T.Maybe(named("Node")),
    "Seq[Maybe[Pt]]": () => T.Seq(T.Maybe(named("Pt"))),
    "Seq[Maybe[Box]] | not": () => T.Maybe(T.Seq(T.Maybe(named("Box")))),
    "Seq[Seq[Maybe[str]]]": () => T.Seq(T.Seq(T.Maybe(T.Str))),
    "Seq[int] bounded 2..4": () => T.Seq(T.Int, T.Bounded(2, 4)),
    "Maybe[Maybe[Box]]": () => T.Maybe(T.Maybe(named("Box"))),
    // s454 — §57.8 payload enums, nested every way the codec supports
    "Shape (payload enum)": () => named("Shape"),
    "Holder (struct holding a payload enum)": () => named("Holder"),
    "Res (payload: int, T | not, struct, Seq[enum], nested enum | not, unit enum)": () => named("Res"),
    "Res | not": () => T.Maybe(named("Res")),
    "Seq[Maybe[Res]]": () => T.Seq(T.Maybe(named("Res"))),
  };
  for (const [name, mk] of Object.entries(TYPES)) {
    test(name, () => {
      const tb = table(mk());
      const r = rng(0x5eed ^ name.length * 7919);
      for (let i = 0; i < 150; i++) {
        const v = gen(tb, tb.root, r, 0);
        const e = encode(tb, v);
        expect(e.ok).toBe(true);
        // the encoder emits the canonical envelope exclusively (§57.4 bullet 3)
        expect(noRawNullAtMaybe(tb, tb.root, e.wire)).toBe(true);
        const { d } = trip(tb, v);
        expect(d).toEqual({ ok: true, value: v });
        // and the encoding is v1.0-safe: canonical-only decodes it too
        expect(trip(tb, v, { canonicalOnly: true }).d).toEqual({ ok: true, value: v });
      }
    });
  }
});

// ---- review fix round (s446-uc r1): L1-L4 -------------------------------------

const JUNK = [null, undefined, "x", 1.5, NaN, true, [], {}, new Date(0), new Map(), Object.create(null)];

/** A random near-miss of `v`: at each node, with p = 0.08, swap in junk / punch a hole / grow a sequence. */
function mutate(tb, ty, v, r) {
  if (r() < 0.08) return JUNK[Math.floor(r() * JUNK.length)];
  if (v === null || v === undefined || typeof v !== "object") return v;
  switch (ty.k) {
    case "maybe": return mutate(tb, ty.inner, v, r);
    case "seq": {
      const out = v.map((x) => mutate(tb, ty.elem, x, r));
      if (r() < 0.05 && out.length > 0) delete out[Math.floor(r() * out.length)];
      if (r() < 0.05) out.push(out[0]);
      return out;
    }
    case "ref": {
      const d = tb.defs[ty.def];
      if (d.k === "enum") {
        if (typeof v === "string" || !Array.isArray(v.data)) return v;
        const p = d.variants.find((x) => x.name === v.variant);
        if (p === undefined) return v;
        const data = v.data.map((x, i) => mutate(tb, p.fields[i].ty, x, r));
        if (r() < 0.05) data.push(0); // wrong arity
        return { variant: v.variant, data };
      }
      const o = {};
      for (const f of d.fields) if (r() >= 0.03) o[f.name] = mutate(tb, f.ty, v[f.name], r);
      return o;
    }
    default: return v;
  }
}

/** §42.9: `undefined` (incl. a hole) at a `T | not` position IS `not` — what a round trip yields. */
function normalize(x) {
  if (x === undefined) return null;
  if (Array.isArray(x)) return Array.from(x, normalize);
  if (x !== null && typeof x === "object") {
    const o = {};
    for (const k of Object.keys(x)) o[k] = normalize(x[k]);
    return o;
  }
  return x;
}

describe("L1 — strict encode: ok ⇒ its own decoder accepts the output and round-trips", () => {
  const TYPES = {
    "Box": () => named("Box"),
    "Node | not": () => T.Maybe(named("Node")),
    "Seq[Maybe[Pt]]": () => T.Seq(T.Maybe(named("Pt"))),
    "Seq[int] bounded 1..3": () => T.Seq(T.Int, T.Bounded(1, 3)),
    "Seq[Seq[Maybe[Color]]]": () => T.Seq(T.Seq(T.Maybe(named("Color")))),
    "int": () => T.Int,
    "Seq[Res] (s454)": () => T.Seq(named("Res")),
  };
  for (const [name, mk] of Object.entries(TYPES)) {
    test(name, () => {
      const tb = table(mk());
      const r = rng(0xbadc0de ^ name.length * 31);
      let accepted = 0, refused = 0;
      for (let i = 0; i < 400; i++) {
        const v = mutate(tb, tb.root, gen(tb, tb.root, r, 0), r);
        const e = encodeText(tb, v);
        if (!e.ok) {
          expect(e.error.kind).toBe("value");
          refused++;
          continue;
        }
        accepted++;
        expect(decodeText(tb, e.text)).toEqual({ ok: true, value: normalize(v) });
        expect(decodeText(tb, e.text, { canonicalOnly: true }).ok).toBe(true);
      }
      // the mutator really produced both outcomes
      expect(accepted).toBeGreaterThan(0);
      if (name !== "int") expect(refused).toBeGreaterThan(0);
    });
  }
});

describe("L2 — never throws on input: null opts, throwing getters, Proxy traps, hostile throws", () => {
  test("opts = null on every entry point", () => {
    expect(encode(table(T.Int), 1, null)).toEqual({ ok: true, wire: 1 });
    expect(encodeText(table(T.Int), 1, null)).toEqual({ ok: true, text: "1" });
    expect(decode(table(T.Int), 1, null)).toEqual({ ok: true, value: 1 });
    expect(decodeText(table(T.Int), "1", null)).toEqual({ ok: true, value: 1 });
  });

  test("a throwing getter is an encode value failure", () => {
    const v = { x: 1, y: 2, label: "a", get on() { throw new Error("boom"); } };
    expect(encode(table(named("Pt")), v).error).toEqual({ kind: "value", path: "$", reason: "reading the input threw: boom" });
  });

  test("a Proxy whose trap throws is a failure in both directions", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); }, getPrototypeOf() { return Object.prototype; } });
    expect(decode(table(named("Pt")), hostile).error).toEqual({ kind: "malformed", path: "$", reason: "reading the input threw: trap" });
    const protoTrap = new Proxy({}, { getPrototypeOf() { throw new Error("proto"); } });
    expect(encode(table(named("Pt")), protoTrap).error.kind).toBe("value");
  });

  test("a thrown non-Error (even a hostile Proxy) is still a failure value", () => {
    const thrown = new Proxy({}, { getPrototypeOf() { throw new Error("x"); }, get() { throw new Error("y"); } });
    const v = { x: 1, y: 2, label: "a", get on() { throw thrown; } };
    const r = encode(table(named("Pt")), v);
    expect(r.ok).toBe(false);
    expect(r.error.kind).toBe("value");
  });

  test("a broken DESCRIPTOR is a compiler defect and still throws (CodecDefect)", () => {
    expect(() => encode({ defs: [], root: { k: "ref", def: 3 } }, {})).toThrow(CodecDefect);
    expect(() => decode({ defs: [], root: { k: "huh" } }, 1)).toThrow(CodecDefect);
  });
});

describe("L3 — a struct value is a PLAIN object (prototype Object.prototype or null)", () => {
  class PtLike { constructor() { this.x = 1; this.y = 2; this.label = "a"; this.on = true; } }
  const E = () => {
    const s = mods.core.mkSym(950, "Empty");
    return { p: { ...core, types: [...core.types, { variant: "StructDef", data: { sym: s, fields: [] } }] }, ty: T.Named(s) };
  };
  test("encode refuses Date / Map / class instance", () => {
    const { p, ty } = E();
    const tb = new Function("return (" + mods.codec.wireTableText(mods.codec.wireBuild(p, ty).table) + ");")();
    expect(encode(tb, new Date(0)).error.kind).toBe("value");
    expect(encode(tb, new Map()).error.kind).toBe("value");
    expect(encode(table(named("Pt")), new PtLike()).error.kind).toBe("value");
  });
  test("decode refuses Date / Map / class instance (a pre-parsed wire value)", () => {
    const { p, ty } = E();
    const tb = new Function("return (" + mods.codec.wireTableText(mods.codec.wireBuild(p, ty).table) + ");")();
    expect(decode(tb, new Date(0)).error.kind).toBe("malformed");
    expect(decode(tb, new Map()).error.kind).toBe("malformed");
    expect(decode(table(named("Pt")), new PtLike()).error.kind).toBe("malformed");
  });
  test("a null-prototype object is plain", () => {
    const o = Object.assign(Object.create(null), { x: 1, y: 2, label: "a", on: true });
    expect(encodeText(table(named("Pt")), o)).toEqual({ ok: true, text: '{"x":1,"y":2,"label":"a","on":true}' });
    expect(decode(table(named("Pt")), o).ok).toBe(true);
  });
});

describe("L4 — encode failures are kind 'value', including overflow", () => {
  test("a cyclic value", () => {
    const n = { v: 1, kids: [], next: null };
    n.next = n;
    expect(encode(table(named("Node")), n).error).toEqual({ kind: "value", path: "$", reason: "nesting too deep (or a cyclic value)" });
  });
});

// ---- follow-up (s446-uc r2 N1-N3) ---------------------------------------------

describe("N1 — option flags are OWN properties only (prototype pollution cannot flip a default)", () => {
  afterEach(() => {
    delete Object.prototype.hostNullPassthrough;
    delete Object.prototype.canonicalOnly;
  });

  test("a polluted Object.prototype.hostNullPassthrough does not open the strict encoder", () => {
    Object.prototype.hostNullPassthrough = true;
    expect(encodeText({ defs: [], root: { k: "int" } }, null).error.kind).toBe("value");
    expect(encodeText(table(T.Int), null, {}).error.kind).toBe("value");
  });

  test("a polluted Object.prototype.canonicalOnly does not change the decoder", () => {
    Object.prototype.canonicalOnly = true;
    expect(decodeText(table(T.Maybe(T.Int)), "null")).toEqual({ ok: true, value: null });
    expect(decodeText(table(T.Maybe(T.Int)), "null", {})).toEqual({ ok: true, value: null });
  });

  test("inherited flags on a user opts object are ignored; own flags still work", () => {
    const inherited = Object.create({ hostNullPassthrough: true, canonicalOnly: true });
    expect(encode(table(T.Int), null, inherited).error.kind).toBe("value");
    expect(decodeText(table(T.Maybe(T.Int)), "null", inherited).ok).toBe(true);
    expect(encodeText(table(T.Int), null, { hostNullPassthrough: true })).toEqual({ ok: true, text: "null" });
    expect(decodeText(table(T.Maybe(T.Int)), "null", { canonicalOnly: true }).ok).toBe(false);
  });
});

describe("N2 — a throwing opts object is a failure, not a throw", () => {
  test("a getter on opts", () => {
    const bad = { get hostNullPassthrough() { throw new Error("g"); }, get canonicalOnly() { throw new Error("g"); } };
    expect(encode(table(T.Int), 1, bad).error).toEqual({ kind: "value", path: "$", reason: "reading the input threw: g" });
    expect(encodeText(table(T.Int), 1, bad).ok).toBe(false);
    expect(decode(table(T.Int), 1, bad).error.kind).toBe("malformed");
    expect(decodeText(table(T.Int), "1", bad).error.kind).toBe("malformed");
  });

  test("a revoked Proxy as opts", () => {
    const r = Proxy.revocable({}, {});
    r.revoke();
    expect(encode(table(T.Int), 1, r.proxy).ok).toBe(false);
    expect(decodeText(table(T.Int), "1", r.proxy).ok).toBe(false);
  });
});

describe("N3 — encode refuses an undeclared own key (symmetric with decode)", () => {
  test("extra key on a struct value", () => {
    const v = { x: 1, y: 2, label: "a", on: true, extra: 2 };
    expect(encode(table(named("Pt")), v).error).toEqual({ kind: "value", path: "$.extra", reason: "Pt has no field extra" });
    expect(decode(table(named("Pt")), v).error).toEqual({ kind: "malformed", path: "$.extra", reason: "Pt has no field extra" });
  });
  test("nested: an extra key inside a sequence element", () => {
    const v = [{ x: 1, y: 2, label: "a", on: true, z: 0 }];
    expect(encode(table(T.Seq(T.Maybe(named("Pt")))), v).error.path).toBe("$[0].z");
  });
  test("a non-enumerable own property is not a key (Object.keys / JSON agree)", () => {
    const v = { x: 1, y: 2, label: "a", on: true };
    Object.defineProperty(v, "hidden", { value: 1, enumerable: false });
    expect(encodeText(table(named("Pt")), v)).toEqual({ ok: true, text: '{"x":1,"y":2,"label":"a","on":true}' });
  });
});

describe("header exception — number -0 (SPEC Q6, unruled, not normalised)", () => {
  test("-0 encodes as 0 and decodes as 0", () => {
    expect(encodeText(table(T.Num), -0)).toEqual({ ok: true, text: "0" });
    expect(Object.is(decodeText(table(T.Num), "0").value, 0)).toBe(true);
  });
});

// ---- s454: §57.8 payload enums (S451 R8) ---------------------------------------
// "An enum value whose variant carries NO payload SHALL be encoded as the variant
// name, a JSON string" · "An enum value whose variant carries a payload SHALL be
// encoded as a JSON object with exactly two own properties: "variant" … and
// "data", a JSON object whose keys are the variant's DECLARED field names".
// Runtime value (Ue DESIGN §5): unit = its name; payload = { variant, data: [positional] }.

const S = { strict: { canonicalOnly: true } };
const circle = (r) => ({ variant: "Circle", data: [r] });
const pt0 = { x: 1, y: 2.5, label: "a", on: true };

describe("§57.8 — encode", () => {
  test("a payload variant is {variant, data} keyed by DECLARED field name; a unit variant is its name", () => {
    expect(encodeText(table(named("Shape")), circle(2))).toEqual({ ok: true, text: '{"variant":"Circle","data":{"r":2}}' });
    expect(encodeText(table(named("Shape")), "Square")).toEqual({ ok: true, text: '"Square"' });
    expect(encodeText(table(named("Holder")), { s: circle(0.5) })).toEqual({ ok: true, text: '{"s":{"variant":"Circle","data":{"r":0.5}}}' });
  });

  test("payload fields are encoded by §57's rules: T | not envelope, struct, sequence of enums, nested enum, unit enum", () => {
    const tb = table(named("Res"));
    expect(encodeText(tb, { variant: "Conflict", data: [3, null] }).text).toBe('{"variant":"Conflict","data":{"current":3,"note":{"__scrml_absent":true}}}');
    expect(encodeText(tb, { variant: "Conflict", data: [3, "hi"] }).text).toBe('{"variant":"Conflict","data":{"current":3,"note":"hi"}}');
    expect(encodeText(tb, { variant: "Moved", data: [pt0, [circle(1), "Square"]] }).text).toBe(
      '{"variant":"Moved","data":{"to":{"x":1,"y":2.5,"label":"a","on":true},"via":[{"variant":"Circle","data":{"r":1}},"Square"]}}',
    );
    expect(encodeText(tb, { variant: "Wrapped", data: [circle(4), "Blue"] }).text).toBe('{"variant":"Wrapped","data":{"inner":{"variant":"Circle","data":{"r":4}},"tint":"Blue"}}');
    expect(encodeText(tb, { variant: "Wrapped", data: [null, "Red"] }).text).toBe('{"variant":"Wrapped","data":{"inner":{"__scrml_absent":true},"tint":"Red"}}');
    expect(encodeText(tb, "Done").text).toBe('"Done"');
  });

  test("value failures: wrong arity, unit-as-object, payload-as-name, unknown variant, extra key, data not an array, ill-typed field", () => {
    const tb = table(named("Res"));
    const err = (v) => encode(tb, v).error;
    expect(err({ variant: "Conflict", data: [3] })).toEqual({ kind: "value", path: "$.data", reason: "Res.Conflict has 2 field(s), the payload holds 1" });
    expect(err({ variant: "Conflict", data: [3, null, 9] }).path).toBe("$.data");
    expect(err({ variant: "Done", data: [] })).toEqual({ kind: "value", path: "$", reason: 'Res.Done carries no payload; its value is the name "Done"' });
    expect(err("Conflict")).toEqual({ kind: "value", path: "$", reason: "Res.Conflict carries a payload; a bare name is not a value of it" });
    expect(err("Nope").reason).toBe('Res has no variant "Nope"');
    expect(err({ variant: "Nope", data: [] }).path).toBe("$.variant");
    expect(err({ variant: "Conflict", data: [3, null], tag: 1 }).path).toBe("$.tag");
    expect(err({ variant: "Conflict", data: { current: 3, note: null } }).path).toBe("$.data");
    expect(err({ variant: "Conflict", data: ["3", null] })).toEqual({ kind: "value", path: "$.data.current", reason: 'expected an int, got "3"' });
    expect(err({ variant: "Moved", data: [{ ...pt0, x: 1.5 }, []] }).path).toBe("$.data.to.x");
    expect(err({ variant: "Wrapped", data: [{ variant: "Circle", data: ["r"] }, "Red"] }).path).toBe("$.data.inner.data.r");
    expect(err(7).kind).toBe("value");
    expect(err(null).reason).toBe("null where Res (no absence) is expected");
  });
});

describe("§57.8 — decode (both modes) and STRICT decode (canonicalOnly)", () => {
  test("round trips: every variant shape, both modes", () => {
    const tb = table(named("Res"));
    for (const v of [
      "Done",
      { variant: "Conflict", data: [-4, null] },
      { variant: "Conflict", data: [0, ""] },
      { variant: "Moved", data: [pt0, []] },
      { variant: "Moved", data: [pt0, ["Square", circle(9)]] },
      { variant: "Wrapped", data: [null, "Green"] },
      { variant: "Wrapped", data: [circle(-1), "Green"] },
    ]) {
      expect(trip(tb, v).d).toEqual({ ok: true, value: v });
      expect(trip(tb, v, S.strict).d).toEqual({ ok: true, value: v });
    }
  });

  test("the decoded payload is POSITIONAL in descriptor field order, whatever the wire key order", () => {
    const tb = table(named("Res"));
    expect(decodeText(tb, '{"data":{"note":"n","current":1},"variant":"Conflict"}', S.strict)).toEqual({ ok: true, value: { variant: "Conflict", data: [1, "n"] } });
  });

  // [wire text, expected { kind, path, reason } — reasons pinned where they carry the rule]
  const REJECTS = [
    ["unknown variant", '{"variant":"Nope","data":{}}', { kind: "malformed", path: "$.variant", reason: 'Res has no variant "Nope"' }],
    ["unknown unit name", '"Nope"', { kind: "malformed", path: "$", reason: 'Res has no variant "Nope"' }],
    ["missing field", '{"variant":"Conflict","data":{"note":"x"}}', { kind: "malformed", path: "$.data.current", reason: "missing field current of Res.Conflict" }],
    ["missing T | not field (omission is not absence)", '{"variant":"Conflict","data":{"current":1}}', { kind: "malformed", path: "$.data.note", reason: "missing field note of Res.Conflict" }],
    ["extra field", '{"variant":"Conflict","data":{"current":1,"note":"x","zzz":0}}', { kind: "malformed", path: "$.data.zzz", reason: "Res.Conflict has no field zzz" }],
    ["__proto__ field", '{"variant":"Conflict","data":{"current":1,"note":"x","__proto__":{}}}', { kind: "malformed", path: "$.data.__proto__", reason: "Res.Conflict has no field __proto__" }],
    ["wrong field type", '{"variant":"Conflict","data":{"current":"1","note":"x"}}', { kind: "malformed", path: "$.data.current", reason: 'expected an int, got "1"' }],
    ["data on a unit variant", '{"variant":"Done","data":{}}', { kind: "malformed", path: "$", reason: 'Res.Done carries no payload; its wire form is the string "Done" (§57.8)' }],
    ["unit variant as {variant} with no data", '{"variant":"Done"}', { kind: "malformed", path: "$", reason: 'Res.Done carries no payload; its wire form is the string "Done" (§57.8)' }],
    ["payload variant as a bare name", '"Conflict"', { kind: "malformed", path: "$", reason: 'Res.Conflict carries a payload; its wire form is {"variant", "data"}, not a bare name (§57.8)' }],
    ["missing data", '{"variant":"Conflict"}', { kind: "malformed", path: "$.data", reason: "missing the payload of Res.Conflict" }],
    ["missing variant", '{"data":{"current":1,"note":"x"}}', { kind: "malformed", path: "$.variant", reason: "missing the variant name of a Res value" }],
    ["data as an array (the RUNTIME shape is not the wire shape)", '{"variant":"Conflict","data":[1,"x"]}', { kind: "malformed", path: "$.data", reason: "expected the payload object of Res.Conflict, got an array" }],
    ["data null", '{"variant":"Conflict","data":null}', { kind: "malformed", path: "$.data", reason: "expected the payload object of Res.Conflict, got null" }],
    ["variant not a string", '{"variant":1,"data":{}}', { kind: "malformed", path: "$.variant", reason: "expected a Res variant name, got 1" }],
    ["a third top-level key", '{"variant":"Conflict","data":{"current":1,"note":"x"},"type":"Res"}', { kind: "malformed", path: "$.type", reason: 'a Res value has no key type (§57.8: exactly "variant" and "data")' }],
    ["an error envelope where a value is expected", '{"__scrml_error":true,"type":"Res","variant":"Done","data":{}}', { kind: "malformed", path: "$.__scrml_error" }],
    ["a number", "3", { kind: "malformed", path: "$" }],
    ["an array", "[]", { kind: "malformed", path: "$" }],
    ["absence where Res admits none", '{"__scrml_absent":true}', { kind: "malformed", path: "$" }],
    ["nested: struct field inside a payload", '{"variant":"Moved","data":{"to":{"x":1,"y":2,"label":"a","on":"yes"},"via":[]}}', { kind: "malformed", path: "$.data.to.on" }],
    ["nested: enum inside a sequence inside a payload", '{"variant":"Moved","data":{"to":{"x":1,"y":2,"label":"a","on":true},"via":["Square",{"variant":"Circle","data":{}}]}}', { kind: "malformed", path: "$.data.via[1].data.r", reason: "missing field r of Shape.Circle" }],
    ["nested: enum | not inside a payload", '{"variant":"Wrapped","data":{"inner":{"variant":"Circle","data":{"r":"big"}},"tint":"Red"}}', { kind: "malformed", path: "$.data.inner.data.r" }],
    ["nested: unit enum field", '{"variant":"Wrapped","data":{"inner":"Square","tint":"Mauve"}}', { kind: "malformed", path: "$.data.tint", reason: 'Color has no variant "Mauve"' }],
    ["nested: malformed absence envelope in a T | not field", '{"variant":"Conflict","data":{"current":1,"note":{"__scrml_absent":true,"x":1}}}', { kind: "malformed", path: "$.data.note" }],
  ];
  for (const [name, text, want] of REJECTS) {
    test(`strict reject: ${name}`, () => {
      for (const opts of [S.strict, undefined]) {
        const r = decodeText(table(named("Res")), text, opts);
        expect(r.ok).toBe(false);
        expect(r.error).toEqual(want.reason === undefined ? { ...want, reason: r.error.reason } : want);
      }
    });
  }

  test("paths are precise through containers: Seq[Maybe[Res]] and a struct holding an enum", () => {
    const r = decodeText(table(T.Seq(T.Maybe(named("Res")))), '["Done",{"__scrml_absent":true},{"variant":"Conflict","data":{"current":1.5,"note":"x"}}]', S.strict);
    expect(r.error).toEqual({ kind: "malformed", path: "$[2].data.current", reason: "expected an int, got 1.5" });
    expect(decodeText(table(named("Holder")), '{"s":{"variant":"Square","data":{}}}', S.strict).error.path).toBe("$.s");
  });

  test("a raw null in a payload's T | not field: STRICT refuses it; the dual default (persist=, O-061-12) admits it", () => {
    const tb = table(named("Res"));
    const text = '{"variant":"Conflict","data":{"current":1,"note":null}}';
    expect(decodeText(tb, text, S.strict).error).toEqual({ kind: "malformed", path: "$.data.note", reason: "raw null is not the canonical absence envelope (§57.5)" });
    expect(decodeText(tb, text)).toEqual({ ok: true, value: { variant: "Conflict", data: [1, null] } });
    // a raw null for a WHOLE optional enum position, likewise
    expect(decodeText(table(T.Maybe(named("Res"))), "null", S.strict).ok).toBe(false);
    expect(decodeText(table(T.Maybe(named("Res"))), "null")).toEqual({ ok: true, value: null });
  });

  test("a failure never echoes a whole foreign value — strings are cut at 40 chars, objects named by kind", () => {
    const long = "V".repeat(5000);
    const r = decodeText(table(named("Res")), JSON.stringify({ variant: long, data: { secret: "s".repeat(5000) } }), S.strict);
    expect(r.error.path).toBe("$.variant");
    expect(r.error.reason.length).toBeLessThan(100);
    expect(r.error.reason).not.toContain("secret");
    const r2 = decodeText(table(named("Res")), JSON.stringify({ variant: "Conflict", data: { current: { deep: "s".repeat(5000) }, note: "x" } }), S.strict);
    expect(r2.error).toEqual({ kind: "malformed", path: "$.data.current", reason: "expected an int, got an object" });
  });

  test("a variant name that is an Object.prototype member names nothing", () => {
    for (const n of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      expect(decodeText(table(named("Res")), JSON.stringify(n), S.strict).error.reason).toBe(`Res has no variant ${JSON.stringify(n)}`);
      expect(decode(table(named("Res")), { variant: n, data: {} }, S.strict).error.path).toBe("$.variant");
    }
  });

  test("hostile input stays a failure value: a getter on data, deep nesting through payloads", () => {
    const w = { variant: "Conflict", data: { current: 1, get note() { throw new Error("boom"); } } };
    expect(decode(table(named("Res")), w, S.strict).error).toEqual({ kind: "malformed", path: "$", reason: "reading the input threw: boom" });
    // Res is not recursive; a self-reaching enum def:
    const e = mods.core.mkSym(960, "Chain");
    const v = mods.core.mkSym(961, "Link");
    const f = mods.core.mkSym(962, "inner");
    const u = mods.core.mkSym(963, "End");
    const p = { ...core, types: [...core.types, { variant: "EnumDef", data: { sym: e, variants: [{ sym: v, fields: [{ sym: f, ty: T.Maybe(T.Named(e)), grants: { replace: false, edits: [] } }] }, { sym: u, fields: [] }] } }] };
    const tb = new Function("return (" + mods.codec.wireTableText(mods.codec.wireBuild(p, T.Named(e)).table) + ");")();
    let chain = "End";
    for (let i = 0; i < 100000; i++) chain = { variant: "Link", data: { inner: chain } };
    expect(decode(tb, chain, S.strict).error).toEqual({ kind: "malformed", path: "$", reason: "nesting too deep (or a cyclic value)" });
    let small = "End";
    for (let i = 0; i < 3; i++) small = { variant: "Link", data: { inner: small } };
    expect(decode(tb, small, S.strict)).toEqual({ ok: true, value: { variant: "Link", data: [{ variant: "Link", data: [{ variant: "Link", data: ["End"] }] }] } });
    expect(decode(tb, { variant: "Link", data: { inner: { __scrml_absent: true } } }, S.strict)).toEqual({ ok: true, value: { variant: "Link", data: [null] } });
  });

  test("a payload field named __scrml_absent is described and round-trips (the data object is never a T | not position)", () => {
    const e = mods.core.mkSym(970, "Odd");
    const v = mods.core.mkSym(971, "Has");
    const f = mods.core.mkSym(972, ABSENT_KEY);
    const p = { ...core, types: [...core.types, { variant: "EnumDef", data: { sym: e, variants: [{ sym: v, fields: [{ sym: f, ty: T.Bool, grants: { replace: false, edits: [] } }] }] } }] };
    const b = mods.codec.wireBuild(p, T.Maybe(T.Named(e)));
    expect(b.why).toEqual([]);
    const tb = new Function("return (" + mods.codec.wireTableText(b.table) + ");")();
    const val = { variant: "Has", data: [true] };
    const enc1 = encodeText(tb, val);
    expect(enc1.text).toBe('{"variant":"Has","data":{"__scrml_absent":true}}');
    expect(decodeText(tb, enc1.text, S.strict)).toEqual({ ok: true, value: val });
    expect(decodeText(tb, '{"__scrml_absent":true}', S.strict)).toEqual({ ok: true, value: null });
  });
});

describe("§57.8 — decodeError: the `fail` envelope (\"__scrml_error\": true, \"type\", \"variant\", \"data\")", () => {
  // "The `fail` error envelope (§19.9.1) SHALL carry the same `variant` and `data`, plus
  // "__scrml_error": true and "type" (the enum's name). For an error variant with no fields,
  // `data` is `{}`. One decoder therefore reads a variant's payload the same way whether it
  // arrived as a value or as an error."
  const env = (variant, data, extra = {}) => ({ __scrml_error: true, type: "Res", variant, data, ...extra });

  test("a payload variant → the same runtime value a decoded VALUE has; a unit variant (data {}) → its name", () => {
    const tb = table(named("Res"));
    expect(decodeError(tb, env("Conflict", { current: 7, note: { __scrml_absent: true } }), S.strict)).toEqual({ ok: true, value: { variant: "Conflict", data: [7, null] } });
    expect(decodeError(tb, env("Done", {}), S.strict)).toEqual({ ok: true, value: "Done" });
    // the envelope's variant/data ARE the value encoding's: encode a value, wrap it, decode it as an error
    const v = { variant: "Moved", data: [pt0, [circle(2)]] };
    const w = encode(tb, v).wire;
    expect(decodeError(tb, { __scrml_error: true, type: "Res", ...w }, S.strict)).toEqual({ ok: true, value: v });
  });

  const BAD = [
    ["another type (impl#1's CpsError)", env("ServerError", { message: "x", fn: "f" }, { type: "CpsError" }), "$.type", 'error type "CpsError" is not the declared "Res"'],
    ["unknown variant", env("Boom", {}), "$.variant", 'Res has no variant "Boom"'],
    ["missing __scrml_error", { type: "Res", variant: "Done", data: {} }, "$.__scrml_error", "not an error envelope: __scrml_error is not true"],
    ["__scrml_error not true", env("Done", {}, { __scrml_error: "true" }), "$.__scrml_error", "not an error envelope: __scrml_error is not true"],
    ["missing type", { __scrml_error: true, variant: "Done", data: {} }, "$.type", 'missing the error type (expected "Res")'],
    ["missing data on a unit variant", { __scrml_error: true, type: "Res", variant: "Done" }, "$.data", "missing the payload of Res.Done ({} for a variant with no fields)"],
    ["non-empty data on a unit variant", env("Done", { x: 1 }), "$.data.x", "Res.Done has no field x"],
    ["bad data field", env("Conflict", { current: "7", note: "n" }), "$.data.current", 'expected an int, got "7"'],
    ["missing data field", env("Conflict", { current: 7 }), "$.data.note", "missing field note of Res.Conflict"],
    ["an extra key (e.g. a message)", env("Done", {}, { message: "x" }), "$.message", "an error envelope has no key message (§57.8: __scrml_error, type, variant, data)"],
    ["not an object", "Done", "$", 'expected a __scrml_error envelope object, got "Done"'],
    ["raw null in a T | not field (strict)", env("Conflict", { current: 1, note: null }), "$.data.note", "raw null is not the canonical absence envelope (§57.5)"],
  ];
  for (const [name, w, path, reason] of BAD) {
    test(`reject: ${name}`, () => {
      expect(decodeError(table(named("Res")), w, S.strict)).toEqual({ ok: false, error: { kind: "malformed", path, reason } });
    });
  }

  test("the descriptor must be an enum: anything else is a compiler defect (CodecDefect)", () => {
    expect(() => decodeError(table(named("Pt")), env("Done", {}))).toThrow(CodecDefect);
    expect(() => decodeError(table(T.Int), env("Done", {}))).toThrow(CodecDefect);
  });
});
