/**
 * S468 fix round 1 (F4) — `_scrml_structural_eq` compares only scrml VALUES
 * structurally; any other object compares by identity.
 *
 * SPEC §45.2 lists what `==` compares structurally — primitives, structs,
 * enums, maps — and says of the rest: "**`asIs` values**: `==` generates `===`
 * in JS output". A struct, an enum value, and a §59 map are plain records at
 * runtime (prototype null or a realm's Object.prototype). Before this fix the
 * helper read ANY object by its own enumerable keys, so two distinct same-tag
 * DOM elements (no own keys) — or two Events, or two instances of a host class
 * with equal fields — were "equal". Newly reachable from inline handlers by the
 * S468 string-path lowering (`e.target == backdrop`), and already wrong in
 * typed fn bodies.
 *
 * Both copies are checked: the client runtime function and the server inline
 * slice (SERVER_STRUCTURAL_EQ_SOURCE).
 */
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { runInNewContext } from "vm";
import { SCRML_RUNTIME, SERVER_STRUCTURAL_EQ_SOURCE } from "../../src/runtime-template.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

function sliceClientEq() {
  const s = SCRML_RUNTIME.indexOf("function _scrml_structural_eq(");
  const e = SCRML_RUNTIME.indexOf("// __SCRML_STRUCTURAL_EQ_END__");
  return new Function(SCRML_RUNTIME.slice(s, e) + "\nreturn _scrml_structural_eq;")();
}
const clientEq = sliceClientEq();
const serverEq = new Function("_scrml_g", SERVER_STRUCTURAL_EQ_SOURCE + "\nreturn _scrml_structural_eq;")(globalThis);

let registered = false;
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) { GlobalRegistrator.register(); registered = true; }
});
afterAll(async () => { if (registered) await GlobalRegistrator.unregister(); });

class Widget { constructor() { this.a = 1; } }

function cases() {
  const d1 = globalThis.document.createElement("div");
  const d2 = globalThis.document.createElement("div");
  return [
    // Not scrml values: identity.
    ["two distinct same-tag DOM elements", d1, d2, false],
    ["the same DOM element", d1, d1, true],
    ["two Events of the same type", new globalThis.Event("x"), new globalThis.Event("x"), false],
    ["two host-class instances with equal fields", new Widget(), new Widget(), false],
    ["a host-class instance vs an equal plain record", new Widget(), { a: 1 }, false],
    ["two distinct functions with the same text", () => 1, () => 1, false],
    ["struct fields holding different DOM elements", { el: d1 }, { el: d2 }, false],
    ["struct fields holding the same DOM element", { el: d1 }, { el: d1 }, true],
    // scrml values: unchanged, structural.
    ["equal structs", { x: 1, y: { z: 2 } }, { x: 1, y: { z: 2 } }, true],
    ["unequal structs", { x: 1 }, { x: 2 }, false],
    ["null-prototype record vs plain record", Object.assign(Object.create(null), { x: 1 }), { x: 1 }, true],
    ["a record from another realm", runInNewContext("({ a: { b: 1 } })"), { a: { b: 1 } }, true],
    ["equal payload enum values", { variant: "Dot", data: { p: { x: 1 } } }, { variant: "Dot", data: { p: { x: 1 } } }, true],
    ["equal arrays of records", [1, { a: 2 }], [1, { a: 2 }], true],
    ["equal Dates (value class)", new Date(5), new Date(5), true],
    ["equal host Maps", new Map([[1, { a: 1 }]]), new Map([[1, { a: 1 }]]), true],
    ["equal host Sets", new Set([1]), new Set([1]), true],
    ["equal errors (§19 error values)", new TypeError("m"), new TypeError("m"), true],
  ];
}

describe("S468 F4 — the structural-equality helper falls back to identity for non-values", () => {
  test("client runtime copy", () => {
    for (const [label, a, b, want] of cases()) expect([label, clientEq(a, b)]).toEqual([label, want]);
  });
  test("server inline copy", () => {
    for (const [label, a, b, want] of cases()) expect([label, serverEq(a, b)]).toEqual([label, want]);
  });
});
