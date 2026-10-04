/* SPDX-License-Identifier: MIT
 *
 * S452 — engine `(state × message)` message arms WITHOUT a leading `|`
 * (`g-impl1-engine-message-arm-pipeless-as-text-s452`).
 *
 * SPEC §51.0.S.2.3 (as amended by #1273): "A message arm IS a §18.2
 * `match-arm` … with no leading `|`." "The message arms are the leading items
 * of the state-child body (before any render content), one per line."
 * §19.4.5: a `|`-led message arm "SHALL be the same arm as the arm without the
 * `|` — the same AST, emitted code and run-time behaviour".
 *
 * Before the fix, `parseMessageArms` recognised arms only in a leading run of
 * `|`-led lines, so the canonical pipe-less form compiled at exit 0 with the
 * arms rendered as literal text and the dispatch table dropped.
 *
 * The pipe-less arm head is EXACTLY `.V` | `::V` | `T.V` | `T::V`, optionally
 * `( … )`, then the arm arrow on the same line; or `_` / `else` then the arrow.
 * It is only looked for at the START of a line (or of the body) — a body that
 * ends in `S.Empty` / `E::X` / `obj.f` is never split into a fake next arm.
 */

import { describe, expect, test } from "bun:test";
import { parseMessageArms, parseEngineStateChildren } from "../../src/engine-statechild-parser.ts";

/** Strip the source spans (they differ by the deleted `|` bytes) for AST equality. */
function armsShape(body) {
  return parseMessageArms(body).arms.map(({ spanStart, spanEnd, ...rest }) => rest);
}
/** Delete the legacy lead `| ` at the start of each line. */
function unpipe(body) {
  return body.replace(/^([ \t]*)\| ?/gm, "$1");
}

const PIPED_BODIES = [
  "\n    | .Start(id) :> .Dragging(id)\n    | _          :> @dragPhase\n  ",
  "\n    | .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }\n    | .End       :> .Idle\n    | _          :> @dragPhase\n  ",
  "| .End :> .Idle",
  "| DragMsg.Drop(col) :> .Idle",
  "\n| .Start(id) => .Dragging(id)\n| .End -> .Idle\n",
  "\n    | .Tick :> { @score = @score + 1; .Playing }\n    | _    :> @phase\n    <span>Score: ${@score}</span>\n  ",
  "\n  | .Clear :> Phase.Empty\n  | _ :> @phase\n  <p>after</p>\n",
  "\n  | .Fill(n) :> { @log = @log + 1; Phase.Full(n) }\n  | .Clear :> Phase.Empty\n  | .Ping :> @phase\n",
];

describe("S452 pipe-less message arms ≡ piped (same AST, renderBodyStart at the same content)", () => {
  for (const piped of PIPED_BODIES) {
    test(JSON.stringify(piped.trim().slice(0, 60)), () => {
      const bare = unpipe(piped);
      expect(bare).not.toBe(piped);
      expect(armsShape(bare)).toEqual(armsShape(piped));
      expect(armsShape(bare).length).toBeGreaterThan(0);
      // The render body (what survives the strip) is byte-identical.
      const p = parseMessageArms(piped);
      const b = parseMessageArms(bare);
      expect(bare.slice(b.renderBodyStart)).toBe(piped.slice(p.renderBodyStart));
    });
  }
});

describe("S452 pipe-less head forms", () => {
  test(".V(binding) / .V / _ — the §51.0.S.6 worked-example shape", () => {
    const { arms } = parseMessageArms(
      "\n    .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }\n    .End       :> .Idle\n    _          :> @dragPhase\n  ",
    );
    expect(arms.map((a) => a.variantName)).toEqual(["Drop", "End", "_"]);
    expect(arms[0].payloadBindings).toEqual([{ kind: "positional", name: "col" }]);
    expect(arms[0].isBlockBody).toBe(true);
    expect(arms[0].bodyRaw).toBe("{ @tasks = taskMovedTo(@tasks, id, col); .Idle }");
    expect(arms[1].bodyRaw).toBe(".Idle");
    expect(arms[2].isWildcard).toBe(true);
    expect(arms[2].bodyRaw).toBe("@dragPhase");
  });

  test("::V and T::V (the §18.2 `::` alias) and T.V resolve to the leaf variant", () => {
    const { arms } = parseMessageArms("::Start(id) :> .Dragging(id)\nDragMsg::Drop(col) :> .Idle\nDragMsg.End :> .Idle\n");
    expect(arms.map((a) => a.variantName)).toEqual(["Start", "Drop", "End"]);
    expect(arms[0].payloadBindings).toEqual([{ kind: "positional", name: "id" }]);
    expect(arms[1].payloadBindings).toEqual([{ kind: "positional", name: "col" }]);
  });

  test("`else` is the catch-all, the same entry as `_`", () => {
    const viaElse = parseMessageArms(".Start :> .Dragging\nelse :> @p\n").arms;
    const viaUnderscore = parseMessageArms(".Start :> .Dragging\n_ :> @p\n").arms;
    expect(viaElse.map(({ spanStart, spanEnd, ...r }) => r))
      .toEqual(viaUnderscore.map(({ spanStart, spanEnd, ...r }) => r));
    expect(viaElse[1].isWildcard).toBe(true);
  });

  test("deprecated arrows =>/-> after a pipe-less head", () => {
    expect(parseMessageArms(".Start(id) => .Dragging(id)").arms[0].armArrow).toBe("=>");
    expect(parseMessageArms(".Start(id) -> .Dragging(id)").arms[0].armArrow).toBe("->");
  });

  test("mixed piped and pipe-less arms form ONE leading run", () => {
    const body = "\n  | .A :> .X\n  .B(n) :> .Y(n)\n  | .C :> .X\n  _ :> @p\n  <p>render</p>\n";
    const r = parseMessageArms(body);
    expect(r.arms.map((a) => a.variantName)).toEqual(["A", "B", "C", "_"]);
    expect(body.slice(r.renderBodyStart)).toBe("<p>render</p>\n");
  });
});

describe("S452 the mis-split class — an arm body never yields a fake next arm", () => {
  test("bodies ending in a qualified variant (S.Empty / E::X) followed by `_ :>` / `.V :>`", () => {
    const body = "\n  .Clear :> Phase.Empty\n  _ :> @phase\n";
    expect(armsShape(body).map((a) => [a.variantName, a.bodyRaw])).toEqual([
      ["Clear", "Phase.Empty"],
      ["_", "@phase"],
    ]);
    const body2 = "\n  .Clear :> Phase::Empty\n  .Fill(n) :> .Full(n)\n";
    expect(armsShape(body2).map((a) => [a.variantName, a.bodyRaw])).toEqual([
      ["Clear", "Phase::Empty"],
      ["Fill", ".Full(n)"],
    ]);
  });

  test("a body ending in member access (obj.f) followed by an arm", () => {
    const body = "\n  .Read :> cfg.next\n  .End :> .Idle\n";
    expect(armsShape(body).map((a) => [a.variantName, a.bodyRaw])).toEqual([
      ["Read", "cfg.next"],
      ["End", ".Idle"],
    ]);
  });

  test("arm-shaped text LATER ON THE SAME LINE stays in the body (one arm per line)", () => {
    const { arms } = parseMessageArms(".A :> pick(x).Empty .B :> y\n_ :> @p\n");
    expect(arms.map((a) => [a.variantName, a.bodyRaw])).toEqual([
      ["A", "pick(x).Empty .B :> y"],
      ["_", "@p"],
    ]);
  });
});

describe("S452 non-heads stay render content (no arms, renderBodyStart unchanged)", () => {
  const NOT_ARMS = [
    "    <p>just render</p>  ",
    "\n  Drag a card here\n",
    "\n  Note.Remember: this is prose\n",
    "\n  .V m :> body\n",          // paren-free binder: `!{}`-only, never a message-arm form (§19.4.5)
    "\n  _ err :> body\n",         // whole-error binder: not a message-arm form
    "\n  .Start\n",                // a head with no arrow
    "\n  x :> y\n",                // a bare name is not a pattern
    "\n  a.b.c :> y\n",            // a path, not T.V
    "\n  .5 items left\n",
    "\n  ${@count} items\n",
  ];
  for (const body of NOT_ARMS) {
    test(JSON.stringify(body.trim()), () => {
      const r = parseMessageArms(body);
      expect(r.arms).toHaveLength(0);
      expect(r.renderBodyStart).toBe(0);
    });
  }

  test("render content after pipe-less arms is the render body", () => {
    const body = "\n    .Tick :> { @score = @score + 1; .Playing }\n    _    :> @phase\n    <span>Score: ${@score}</span>\n  ";
    const r = parseMessageArms(body);
    expect(r.arms.map((a) => a.variantName)).toEqual(["Tick", "_"]);
    expect(body.slice(r.renderBodyStart)).toBe("<span>Score: ${@score}</span>\n  ");
  });

  test("the first non-arm item ends the run — a later arm-shaped line is not an arm", () => {
    const body = "\n  .A :> .X\n  <p>render</p>\n  .B :> .Y\n";
    const r = parseMessageArms(body);
    expect(r.arms.map((a) => a.variantName)).toEqual(["A"]);
    expect(body.slice(r.renderBodyStart)).toBe("<p>render</p>\n  .B :> .Y\n");
  });
});

describe("S452 through parseEngineStateChildren (the live consumer)", () => {
  test("pipe-less arms attach to the right state-children, payload state-child included", () => {
    const rules = "\n  <Idle rule=.Dragging>\n    .Start(id) :> .Dragging(id)\n    _ :> @dragPhase\n  </>\n" +
      "  <Dragging(id) rule=.Idle>\n    .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }\n    .End :> .Idle\n    <p>dragging ${id}</p>\n  </>\n";
    const scs = parseEngineStateChildren(rules);
    expect(scs.map((s) => s.tag)).toEqual(["Idle", "Dragging"]);
    expect(scs[0].messageArms.map((a) => a.variantName)).toEqual(["Start", "_"]);
    expect(scs[1].messageArms.map((a) => a.variantName)).toEqual(["Drop", "End"]);
    expect(scs[1].messageArms[0].payloadBindings).toEqual([{ kind: "positional", name: "col" }]);
  });

  test("a body opening with `::V(x) :>` is a message arm, NOT the legacy after-`>` `:`-shorthand", () => {
    const rules = "\n  <Idle rule=.Dragging>\n    ::Start(id) :> .Dragging(id)\n    else :> @dragPhase\n  </>\n";
    const [idle] = parseEngineStateChildren(rules);
    expect(idle.isColonShorthand).toBe(false);
    expect(idle.legacyColonPlacement).toBe(false);
    expect(idle.messageArms.map((a) => [a.variantName, a.isWildcard])).toEqual([["Start", false], ["_", true]]);
  });

  test("the legacy after-`>` `: expr` shorthand is unchanged", () => {
    const [idle] = parseEngineStateChildren("\n  <Idle rule=.Dragging> : \"idle\"\n  <Dragging rule=.Idle></>\n");
    expect(idle.isColonShorthand).toBe(true);
    expect(idle.legacyColonPlacement).toBe(true);
    expect(idle.messageArms).toEqual([]);
  });
});
