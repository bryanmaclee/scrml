// Regression guard for the engine state-child grammar SSOT
// (compiler/src/engine-statechild-grammar.ts), extracted by ss2 item 3 as the
// single source of truth for two sets previously duplicated across the
// type-system and codegen layers.
//
// These assertions pin the EXACT membership of both exported sets. The
// extraction was a zero-behavior-change dedup: any future edit to membership
// MUST update this guard deliberately (and audit every consumer), because both
// the type-system (markup/scope resolution) and codegen (HTML emission +
// payload-binding extraction) depend on these sets agreeing byte-for-byte.

import { describe, test, expect } from "bun:test";
import {
  ENGINE_STATE_CHILD_RESERVED_ATTRS,
  STATE_CHILD_STRUCTURAL_TAGS,
} from "../../src/engine-statechild-grammar.ts";

const sortedMembers = (set) => [...set].sort();

describe("engine-statechild-grammar SSOT (ss2 item 3)", () => {
  test("ENGINE_STATE_CHILD_RESERVED_ATTRS has exactly the §51.0.B reserved attrs", () => {
    // rule / history / internal:rule / effect — §51.0.B / §51.0.B.1
    expect(sortedMembers(ENGINE_STATE_CHILD_RESERVED_ATTRS)).toEqual([
      "effect",
      "history",
      "internal:rule",
      "rule",
    ]);
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.size).toBe(4);
  });

  test("ENGINE_STATE_CHILD_RESERVED_ATTRS membership probes", () => {
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.has("rule")).toBe(true);
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.has("history")).toBe(true);
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.has("internal:rule")).toBe(true);
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.has("effect")).toBe(true);
    // A payload-binding bareword (e.g. `<Error msg>`) is NOT reserved.
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.has("msg")).toBe(false);
    // `internal` without the `:rule` suffix is NOT a member.
    expect(ENGINE_STATE_CHILD_RESERVED_ATTRS.has("internal")).toBe(false);
  });

  test("STATE_CHILD_STRUCTURAL_TAGS has exactly the §51.0 structural element tags", () => {
    // onTimeout / onTransition / onIdle / engine / machine — §51.0(.M)
    expect(sortedMembers(STATE_CHILD_STRUCTURAL_TAGS)).toEqual([
      "engine",
      "machine",
      "onIdle",
      "onTimeout",
      "onTransition",
    ]);
    expect(STATE_CHILD_STRUCTURAL_TAGS.size).toBe(5);
  });

  test("STATE_CHILD_STRUCTURAL_TAGS membership probes", () => {
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("onTimeout")).toBe(true);
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("onTransition")).toBe(true);
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("onIdle")).toBe(true);
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("engine")).toBe(true);
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("machine")).toBe(true);
    // Renderable markup (e.g. a state-child arm tag `<Idle>`) is NOT structural.
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("Idle")).toBe(false);
    expect(STATE_CHILD_STRUCTURAL_TAGS.has("div")).toBe(false);
  });

  test("the two sets are disjoint", () => {
    for (const attr of ENGINE_STATE_CHILD_RESERVED_ATTRS) {
      expect(STATE_CHILD_STRUCTURAL_TAGS.has(attr)).toBe(false);
    }
  });
});
