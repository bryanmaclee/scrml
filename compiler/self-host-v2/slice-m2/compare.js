// compare.js — structural equality of two CoreProgram values MODULO Sym-id
// renumbering (slice-m1/progress.md D11): both sides are walked in the same
// order; every Sym `{ id, hint }` must have the same hint, and ids must map
// one-to-one by first occurrence (a Sym that is shared on one side must be
// shared the same way on the other). Returns `null` when equal, else the FIRST
// differing path and both values there.
//
// A test instrument, not compiler code: it reads the plain-object shape impl#1
// emits for scrml values (`{ variant, data }` payload variants, strings for
// nullary variants, `null` for `not`).

function isSym(x) {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const ks = Object.keys(x);
  return ks.length === 2 && "id" in x && "hint" in x && typeof x.id === "number" && typeof x.hint === "string";
}

function show(x) {
  const s = JSON.stringify(x);
  return s === undefined ? String(x) : s.length > 300 ? s.slice(0, 300) + "…" : s;
}

export function compareCore(a, b) {
  const ab = new Map(); // id in a → id in b
  const ba = new Map();
  const diff = (path, why, x, y) => ({ path: path || "(root)", why, a: show(x), b: show(y) });

  function walk(x, y, path) {
    if (isSym(x) || isSym(y)) {
      if (!isSym(x) || !isSym(y)) return diff(path, "a Sym on one side only", x, y);
      if (x.hint !== y.hint) return diff(path, "Sym hints differ", x, y);
      const mx = ab.get(x.id);
      const my = ba.get(y.id);
      if (mx === undefined && my === undefined) {
        ab.set(x.id, y.id);
        ba.set(y.id, x.id);
        return null;
      }
      if (mx !== y.id || my !== x.id) return diff(path, `Sym ids are not a bijection (a#${x.id}→b#${mx}, b#${y.id}→a#${my})`, x, y);
      return null;
    }
    if (x === y) return null;
    if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return diff(path, "values differ", x, y);
    if (Array.isArray(x) !== Array.isArray(y)) return diff(path, "array vs object", x, y);
    if (Array.isArray(x)) {
      if (x.length !== y.length) return diff(path, `lengths differ (${x.length} vs ${y.length})`, x, y);
      for (let i = 0; i < x.length; i++) {
        const d = walk(x[i], y[i], `${path}[${i}]`);
        if (d) return d;
      }
      return null;
    }
    const kx = Object.keys(x).sort();
    const ky = Object.keys(y).sort();
    if (kx.join(",") !== ky.join(",")) return diff(path, `keys differ (${kx} vs ${ky})`, x, y);
    // payload variants: compare the tag first so the report names the variant
    if ("variant" in x && x.variant !== y.variant) return diff(`${path}.variant`, "variants differ", x.variant, y.variant);
    for (const k of kx) {
      const d = walk(x[k], y[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
    return null;
  }

  return walk(a, b, "");
}

/** Count Core nodes (objects that are enum payload variants or known structs) — a size measure. */
export function coreSize(x) {
  let n = 0;
  (function go(v) {
    if (v === null || typeof v !== "object") return;
    if (isSym(v)) return;
    n++;
    for (const k of Object.keys(v)) go(v[k]);
  })(x);
  return n;
}
