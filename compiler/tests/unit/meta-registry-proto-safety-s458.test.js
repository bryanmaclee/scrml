/**
 * meta-registry-proto-safety-s458.test.js — S458 review F-A.
 *
 * A runtime `^{}` body runs in the page realm, the same realm the author's `${}` logic
 * runs in — the allow-list is a language-shape guarantee, NOT a sandbox. But a runtime
 * registry keyed by an AUTHOR-controlled string must not hand back a host object off its
 * prototype: `_scrml_state` was a plain `{}`, so `meta.get("constructor")` returned the
 * page's `Object` (a route to `Function` → arbitrary code, compiles clean), and a cell
 * named `constructor` broke subscription (`_scrml_subscribers["constructor"]` was the
 * prototype's method, not an array). Every such registry now has a null prototype, so a
 * lookup is own-only. These tests execute the shipped runtime text.
 */

import { describe, test, expect } from "bun:test";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

function makeRuntime() {
  const code = `
${SCRML_RUNTIME}
return {
  _scrml_state, _scrml_subscribers, _scrml_reactive_get, _scrml_reactive_set,
  _scrml_reactive_subscribe, _scrml_meta_effect, _scrml_destroy_scope,
};`;
  // eslint-disable-next-line no-new-func
  return new Function(code)();
}

const PROTO_NAMES = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype"];

describe("S458 F-A — meta.get does not read the prototype", () => {
  for (const name of PROTO_NAMES) {
    test(`meta.get("${name}") is undefined, not a host object`, () => {
      const rt = makeRuntime();
      let got = "unset";
      rt._scrml_meta_effect("s", (meta) => { got = meta.get(name); });
      expect(got).toBeUndefined();
    });
  }

  test("meta.get returns a cell's real value once set, for a prototype-collision name", () => {
    const rt = makeRuntime();
    rt._scrml_reactive_set("constructor", 42);
    let got = null;
    rt._scrml_meta_effect("s", (meta) => { got = meta.get("constructor"); });
    expect(got).toBe(42);
  });
});

describe("S458 F-A — a cell named like a prototype member subscribes without throwing", () => {
  for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
    test(`subscribing to <${name}> works and fires on change`, () => {
      const rt = makeRuntime();
      const seen = [];
      const unsub = rt._scrml_reactive_subscribe(name, (v) => seen.push(v));
      expect(typeof unsub).toBe("function");
      rt._scrml_reactive_set(name, 1);
      expect(seen).toEqual([1]);
    });
  }
});

describe("S458 F-A — meta.types.reflect does not read the prototype", () => {
  for (const name of ["constructor", "__proto__", "toString"]) {
    test(`reflect("${name}") returns null, not a host object`, () => {
      const rt = makeRuntime();
      let got = "unset";
      // The typeRegistry argument is a plain object literal in emitted output; reflect
      // must read it own-property only.
      rt._scrml_meta_effect("s", (meta) => { got = meta.types.reflect(name); }, null, { Color: { kind: "enum", variants: ["Red"] } });
      expect(got).toBeNull();
    });
  }

  test("reflect returns a real own entry", () => {
    const rt = makeRuntime();
    let got = null;
    rt._scrml_meta_effect("s", (meta) => { got = meta.types.reflect("Color"); }, null, { Color: { kind: "enum", variants: ["Red"] } });
    expect(got).toEqual({ kind: "enum", variants: ["Red"] });
  });
});

describe("S458 F-A — the author cannot walk to Function through meta.get", () => {
  test("meta.get(\"constructor\") yields nothing to walk from", () => {
    const rt = makeRuntime();
    const steps = [];
    rt._scrml_meta_effect("s", (meta) => {
      const O = meta.get("constructor");
      steps.push(O);
      // The exploit shape: O would be Object; here it is undefined, so the walk dies.
      steps.push(O === undefined);
    });
    expect(steps[0]).toBeUndefined();
    expect(steps[1]).toBe(true);
  });
});
