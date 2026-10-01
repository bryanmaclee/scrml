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
import { ABSENT_KEY, CodecDefect, decode, decodeText, encode, encodeText, isAbsenceEnvelope } from "./runtime/codec.js";

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
      if (d.k === "enum") return d.tags[Math.floor(r() * d.tags.length)];
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
      return d.k === "enum" || d.fields.every((f) => noRawNullAtMaybe(tb, f.ty, w[f.name]));
    }
    default: return true;
  }
}

describe("front end → Core types used here", () => {
  test("types.scrml lowers with no diagnostics", () => {
    expect(fe.diags).toEqual([]);
    expect(core.types.map((t) => t.data.sym.hint)).toEqual(["Pt", "Color", "Box", "Node", "Shape", "Holder"]);
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
        '{ k: "enum", name: "Color", tags: ["Red", "Green", "Blue"] }], root: { k: "ref", def: 0 } }',
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

  test("REFUSED: a payload-carrying enum variant (SPEC fixes no payload wire shape)", () => {
    const d = descriptor(mods, core, named("Holder"));
    expect(d.table).toBeNull();
    expect(d.why).toEqual([
      "enum Shape variant Circle carries a payload: SPEC §12.5.1 fixes only the variant-name-string wire form; a payload wire shape is not ruled",
    ]);
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
      if (d.k === "enum") return v;
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
