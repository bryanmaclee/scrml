// encode.js — impl#1's AST → the shims' schema-free `IVal` tree (ingest.scrml). Shared by the CG
// substitute (substitute.js) and the CSS substitute (css-substitute.js), each over its own compiled
// bundle's `ingest` module `I`.
//
// Every own key of every object, by name, with NO knowledge of any node kind (only `span` — a source
// position — is left out). Every interpretation happens in the scrml shims.

export function makeEncoder(I) {
  function encode(v, path = new Set()) {
    if (v === null || v === undefined) return I.ivNull();
    if (typeof v === "string") return I.ivStr(v);
    if (typeof v === "number") return I.ivNum(v);
    if (typeof v === "boolean") return I.ivBool(v);
    if (Array.isArray(v)) {
      if (path.has(v)) return I.ivStr("<cycle>");
      path.add(v);
      const out = I.ivList(v.map((x) => encode(x, path)));
      path.delete(v);
      return out;
    }
    if (typeof v === "object") {
      // A Map / Set / class instance is not plain AST data: it CARRIES (a non-empty string), so a
      // mapped node holding one is reported as an unmapped key, never silently dropped.
      if (v instanceof Map || v instanceof Set) return I.ivStr(`<${v.constructor.name}>`);
      if (path.has(v)) return I.ivStr("<cycle>");
      path.add(v);
      const entries = [];
      for (const k of Object.keys(v)) {
        if (k === "span") continue;
        entries.push(I.ivEntry(k, encode(v[k], path)));
      }
      path.delete(v);
      return I.ivNode(I.mkNode(entries));
    }
    return I.ivStr(`<${typeof v}>`);
  }
  function encodeNode(obj) {
    const v = encode(obj);
    return v && v.variant === "VNode" ? v.data.obj : I.mkNode([]);
  }
  return { encode, encodeNode };
}
