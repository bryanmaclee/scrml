/**
 * Value-Native Map HAMT — DIFFERENTIAL test (§59, ss38 / FBIP increment 1)
 *
 * The soundness gate for the COW -> HAMT representation swap. We run the REAL
 * shipped HAMT runtime (assembled `core` + `equality` + `map` chunks) and an
 * inline REFERENCE re-implementation of the PRIOR clone-on-write (COW) behavior
 * in LOCKSTEP over randomized + adversarial operation sequences, asserting the
 * HAMT result is OBSERVABLY IDENTICAL to the prior COW behavior at every step.
 * Any divergence is a BUG (the FBIP "structural sharing == in-place mutation
 * semantics" pattern, in miniature).
 *
 * Both maps key on the SAME _scrml_value_canonical walker (unchanged by ss38),
 * so the reference exercises only the CONTAINER logic (clone-the-entries-object
 * + the explicit `order` sidecar) that the HAMT replaces.
 *
 * Surface compared: insert / remove / update / insert_all / get / has / get_or /
 * size / keys / values / entries / sorted / == / encode->decode, over: nested-map
 * keys+values, struct keys (field-order variants), enum keys, stored-`not`
 * values, ordered + unordered, empty [:], last-wins dup keys, -0/+0, large N.
 */

import { describe, test, expect } from "bun:test";
import { assembleRuntime } from "../../src/codegen/runtime-chunks.ts";

// --- the REAL shipped runtime (HAMT) ---
function buildMapRuntime() {
  const asm = assembleRuntime(new Set(["core", "equality", "map"]));
  const factory = new Function(
    asm +
      "\nreturn {" +
      "canon: _scrml_value_canonical," +
      "fromEntries: _scrml_map_from_entries," +
      "get: _scrml_map_get, has: _scrml_map_has, getOr: _scrml_map_get_or," +
      "insert: _scrml_map_insert, remove: _scrml_map_remove, update: _scrml_map_update," +
      "insertAll: _scrml_map_insert_all, size: _scrml_map_size," +
      "keys: _scrml_map_keys, values: _scrml_map_values, entries: _scrml_map_entries," +
      "sorted: _scrml_map_sorted, encode: _scrml_map_encode, decode: _scrml_map_decode," +
      "eq: _scrml_structural_eq" +
      "};"
  );
  return factory();
}
const rt = buildMapRuntime();
const canon = rt.canon;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------------------
// REFERENCE: the PRIOR clone-on-write implementation, transcribed verbatim.
// Representation: { __scrml_map, entries: { ck: {k,v} }, ordered, order? }.
// ---------------------------------------------------------------------------
function refEmpty(ordered) {
  const m = { __scrml_map: true, entries: {}, ordered: ordered === true };
  if (m.ordered) m.order = [];
  return m;
}
function refClone(m) {
  const entries = {};
  for (const k of Object.keys(m.entries)) entries[k] = m.entries[k];
  const out = { __scrml_map: true, entries, ordered: m.ordered === true };
  if (out.ordered) out.order = m.order ? m.order.slice() : [];
  return out;
}
function refSet(m, k, v) {
  const ck = canon(k);
  const isNew = !hasOwn(m.entries, ck);
  m.entries[ck] = { k, v };
  if (m.ordered && isNew) m.order.push(ck);
}
function refFromEntries(pairs, ordered) {
  const m = refEmpty(ordered);
  if (pairs) for (const p of pairs) refSet(m, p[0], p[1]);
  return m;
}
function refGet(m, k) { const e = m.entries[canon(k)]; return e === undefined ? null : e.v; }
function refHas(m, k) { return hasOwn(m.entries, canon(k)); }
function refGetOr(m, k, d) { const e = m.entries[canon(k)]; return e === undefined ? d : e.v; }
function refInsert(m, k, v) { const o = refClone(m); refSet(o, k, v); return o; }
function refRemove(m, k) {
  const ck = canon(k);
  if (!hasOwn(m.entries, ck)) return refClone(m);
  const o = refClone(m);
  delete o.entries[ck];
  if (o.ordered) { const i = o.order.indexOf(ck); if (i !== -1) o.order.splice(i, 1); }
  return o;
}
function refUpdate(m, k, fn) {
  const ck = canon(k);
  const e = m.entries[ck];
  const cur = e === undefined ? null : e.v;
  const o = refClone(m);
  refSet(o, k, fn(cur));
  return o;
}
function refInsertAll(m, other) {
  const o = refClone(m);
  if (other && other.__scrml_map === true) {
    for (const ck of refKeyOrder(other)) { const en = other.entries[ck]; refSet(o, en.k, en.v); }
  }
  return o;
}
function refSize(m) { return Object.keys(m.entries).length; }
function refKeyOrder(m) {
  if (m.ordered && m.order) {
    const live = [];
    for (const ck of m.order) if (hasOwn(m.entries, ck)) live.push(ck);
    return live;
  }
  return Object.keys(m.entries);
}
function refKeys(m) { return refKeyOrder(m).map((ck) => m.entries[ck].k); }
function refValues(m) { return refKeyOrder(m).map((ck) => m.entries[ck].v); }
function refEntries(m) { return refKeyOrder(m).map((ck) => ({ key: m.entries[ck].k, value: m.entries[ck].v })); }
function refSorted(m) { return Object.keys(m.entries).sort().map((ck) => ({ key: m.entries[ck].k, value: m.entries[ck].v })); }
function refEncode(m) {
  const keys = Object.keys(m.entries).sort();
  const entries = [];
  for (const ck of keys) { const e = m.entries[ck]; entries.push([e.k, e.v == null ? { __scrml_absent: true } : e.v]); }
  return { __scrml_map_enc: true, ordered: m.ordered === true, entries };
}

// ---------------------------------------------------------------------------
// Observable comparison: assert the HAMT map is identical to the COW reference.
// Order-SENSITIVE for keys/values/entries (both realize insertion order);
// key/value identity compared via the canonical string (collision-free, §59.5).
// ---------------------------------------------------------------------------
function canonSeq(arr) { return arr.map(canon); }
function entrySeq(arr) { return arr.map((e) => canon(e.key) + "=>" + canon(e.value)); }

function assertObservablyIdentical(real, ref, probeKeys, label) {
  expect(rt.size(real), label + " size").toBe(refSize(ref));
  for (const k of probeKeys) {
    expect(canon(rt.get(real, k)), label + " get " + canon(k)).toBe(canon(refGet(ref, k)));
    expect(rt.has(real, k), label + " has " + canon(k)).toBe(refHas(ref, k)); // disambiguates stored-not
    expect(canon(rt.getOr(real, k, "DFLT")), label + " getOr " + canon(k)).toBe(canon(refGetOr(ref, k, "DFLT")));
  }
  expect(canonSeq(rt.keys(real)), label + " keys order").toEqual(canonSeq(refKeys(ref)));
  expect(canonSeq(rt.values(real)), label + " values order").toEqual(canonSeq(refValues(ref)));
  expect(entrySeq(rt.entries(real)), label + " entries order").toEqual(entrySeq(refEntries(ref)));
  expect(entrySeq(rt.sorted(real)), label + " sorted").toEqual(entrySeq(refSorted(ref)));
  // == is order-independent value equality; real == ref must hold (real reads
  // .entries via its memoized getter, ref via its plain data property).
  expect(rt.eq(real, ref), label + " real==ref").toBe(true);
  // §59.10 codec: bit-stable encode + lossless decode round-trip.
  expect(JSON.stringify(rt.encode(real)), label + " encode bytes").toBe(JSON.stringify(refEncode(ref)));
  const back = rt.decode(JSON.parse(JSON.stringify(rt.encode(real))));
  expect(rt.eq(back, real), label + " decode round-trip").toBe(true);
  // §57 RAW JSON round-trip (no codec) — the map is a plain JSON value.
  const rawBack = JSON.parse(JSON.stringify(real));
  expect(rt.size(rawBack), label + " raw-json size").toBe(rt.size(real));
}

// ---------------------------------------------------------------------------
// Adversarial value pools
// ---------------------------------------------------------------------------
const KEY_POOL = [
  "", "a", "DAL-001", "0:", "n5", "b:1,c",
  0, -0, 1, 2, 3, 1.5, 100, -7,
  true, false,
  { x: 1, y: 2 }, { y: 2, x: 1 }, { lane: "DAL", carrier: "ACME" },
  { _tag: "Red" }, { _tag: "Point", x: 1, y: 2 }, { _tag: "Point", y: 2, x: 1 },
  rt.fromEntries([["inner", 1]], false),
  rt.fromEntries([["inner", 1], ["k2", 2]], false),
];
// Values additionally include null (a STORED `not`) and arrays / nested maps.
const VAL_POOL = [
  null, 0, -0, 1, 42, "v", "", true, false,
  { a: 1 }, { _tag: "Some", value: 9 },
  [1, 2, 3], rt.fromEntries([["nv", 7]], false),
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------------------
describe("§59 HAMT differential vs prior COW behavior (ss38)", () => {
  test("focused adversarial scenarios (identical to COW)", () => {
    const probes = KEY_POOL;
    for (const ordered of [false, true]) {
      const tag = ordered ? "ordered" : "unordered";
      // empty [:]
      assertObservablyIdentical(rt.fromEntries([], ordered), refEmpty(ordered), probes, tag + " empty");

      // last-wins dup keys + field-order-variant struct keys collapse
      const pairs = [
        [{ x: 1, y: 2 }, "first"], [{ y: 2, x: 1 }, "second-wins"],
        ["dup", 1], ["dup", 2],
        [0, "zero"], [-0, "neg-zero-same-key"],
        [{ _tag: "Point", x: 1, y: 2 }, "pt"], [{ _tag: "Point", y: 2, x: 1 }, "pt-wins"],
      ];
      assertObservablyIdentical(rt.fromEntries(pairs, ordered), refFromEntries(pairs, ordered), probes, tag + " dup/field-order");

      // nested-map key + nested-map value + stored-not
      let real = rt.fromEntries([], ordered), ref = refFromEntries([], ordered);
      const nk = rt.fromEntries([["a", 1]], false);
      real = rt.insert(real, nk, rt.fromEntries([["v", 1]], false)); ref = refInsert(ref, nk, rt.fromEntries([["v", 1]], false));
      real = rt.insert(real, "stored-not", null); ref = refInsert(ref, "stored-not", null);
      assertObservablyIdentical(real, ref, [...probes, nk, "stored-not"], tag + " nested+not");
      // stored-not is PRESENT (has) yet reads null (get) — both agree
      expect(rt.has(real, "stored-not")).toBe(true);
      expect(rt.get(real, "stored-not")).toBe(null);

      // remove-then-reinsert moves to END (seq vs delete+readd order parity)
      let r2 = rt.fromEntries([["a", 1], ["b", 2], ["c", 3]], ordered);
      let f2 = refFromEntries([["a", 1], ["b", 2], ["c", 3]], ordered);
      r2 = rt.remove(r2, "a"); f2 = refRemove(f2, "a");
      r2 = rt.insert(r2, "a", 9); f2 = refInsert(f2, "a", 9);
      assertObservablyIdentical(r2, f2, probes, tag + " remove-reinsert");
      expect(canonSeq(rt.keys(r2))).toEqual(canonSeq(["b", "c", "a"]));
    }
  });

  for (const ordered of [false, true]) {
    test("randomized lockstep — " + (ordered ? "ordered" : "unordered"), () => {
      const rng = mulberry32(ordered ? 0xC0FFEE : 0xBADF00D);
      let real = rt.fromEntries([], ordered);
      let ref = refFromEntries([], ordered);
      const numFn = (cur) => (cur === null ? 1 : typeof cur === "number" ? cur + 1 : "upd");
      for (let step = 0; step < 400; step++) {
        const op = Math.floor(rng() * 4);
        const k = pick(rng, KEY_POOL);
        if (op === 0) {
          const v = pick(rng, VAL_POOL);
          real = rt.insert(real, k, v); ref = refInsert(ref, k, v);
        } else if (op === 1) {
          real = rt.remove(real, k); ref = refRemove(ref, k);
        } else if (op === 2) {
          real = rt.update(real, k, numFn); ref = refUpdate(ref, k, numFn);
        } else {
          // insert_all with a small random other map (same ordered-ness mix)
          const otherOrdered = rng() < 0.5;
          const op1 = [pick(rng, KEY_POOL), pick(rng, VAL_POOL)];
          const op2 = [pick(rng, KEY_POOL), pick(rng, VAL_POOL)];
          const realOther = rt.fromEntries([op1, op2], otherOrdered);
          const refOther = refFromEntries([op1, op2], otherOrdered);
          real = rt.insertAll(real, realOther); ref = refInsertAll(ref, refOther);
        }
        if (step % 17 === 0) assertObservablyIdentical(real, ref, KEY_POOL, "step " + step);
      }
      assertObservablyIdentical(real, ref, KEY_POOL, "final");
    });
  }

  test("large-N S94 insert loop — correct + sub-quadratic", () => {
    const N1 = 800, N2 = 4 * N1; // 800 vs 3200
    function run(n) {
      const t0 = performance.now();
      let m = rt.fromEntries([], false);
      for (let i = 0; i < n; i++) m = rt.insert(m, "key-" + i, i);
      const t = performance.now() - t0;
      // correctness at scale
      expect(rt.size(m)).toBe(n);
      expect(rt.get(m, "key-0")).toBe(0);
      expect(rt.get(m, "key-" + (n - 1))).toBe(n - 1);
      expect(rt.get(m, "absent")).toBe(null);
      return t;
    }
    run(64); // warm up the JIT
    const t1 = run(N1);
    const t2 = run(N2);
    // Quadratic (the old COW) would be ~16x for 4x N. HAMT is ~O(n log n) ≈ 5x.
    // Generous bound (timing is noisy) — anything well under quadratic passes.
    if (t1 > 1) {
      expect(t2 / t1).toBeLessThan(12);
    }
  });
});
