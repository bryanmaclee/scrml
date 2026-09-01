/**
 * g-if-chain-ordered-map-exemption-blind.test.js
 *
 * SITE 6 of the §17.1.1 if-chain descent class — the LATENT one, and the only
 * member whose symptom is a FALSE POSITIVE rather than a lost diagnostic.
 *
 * `collectOrderedMapNames` (lint-w-map-iteration-order.js) builds the §59.8
 * `@ordered` EXEMPTION set. It carried the same blind spot as its sibling
 * `walkEachBlocks`, so an `@ordered` map declared inside an `if=`/`else` branch
 * was absent from the exemption set and would have been warned about despite
 * having explicitly opted INTO insertion-order iteration.
 *
 * WHY IT WAS INVISIBLE, AND WHY THAT MATTERS. `runWMapIterationOrder` returns
 * early on `!mapNames.has(name)`, and `mapNames` comes from
 * `collectMapVarNames` (codegen/reactive-deps.ts) — which has the IDENTICAL
 * blind spot. A branch-declared map therefore never reaches the `orderedNames`
 * consult at all. **Site 6 was masked by a THIRD instance of the same class.**
 *
 * MEASURED, not reasoned. Arming that mask (teaching `collectMapVarNames` to
 * descend an if-chain, temporarily, in a scratch build) produced:
 *
 *   | shape                            | before site-6 fix | after |
 *   |----------------------------------|-------------------|-------|
 *   | `@ordered` map, lone `if=`       | 0 (correct)       |   0   |
 *   | `@ordered` map, `if=`/`else`     | 1 FALSE POSITIVE  |   0   |
 *   | plain map, lone `if=`            | 1 (correct)       |   1   |
 *   | plain map, `if=`/`else`          | 1 (correct)       |   1   |
 *
 * So closing the CODEGEN collector on its own would have ARMED a cry-wolf here.
 * Both halves of a masked pair get closed together or neither does. The codegen
 * half changes EMIT and owes its own migration, so it is filed separately; this
 * half is inert today and lands now so it cannot be forgotten when the other
 * one moves.
 *
 * ⛑ THE MASK HAS SINCE BEEN REMOVED, IN THE SAME BRANCH, AND THIS FILE RECORDS
 * BOTH STATES ON PURPOSE. When this test was written the `if=`/`else` shape was
 * UNOBSERVABLE end-to-end, so the end-to-end block pinned the MASK as current
 * behaviour and said out loud that its rows would flip when the codegen
 * collector was closed. That collector is now closed in `codegen/reactive-deps.ts`
 * (13 walks) and the rows flipped exactly as predicted — the plain row 0 -> 1,
 * the `@ordered` row held at 0.
 *
 * The prediction paying out IS the evidence. Reverting the
 * `collectOrderedMapNames` hunk with the collector closed yields 1 FALSE
 * POSITIVE on the `@ordered` row — measured on the real code path, not on the
 * scratch mask-arm that first suggested it. The direct block below stays
 * regardless: it bites at 1 fail / 2 pass with the exemption fix reverted, and
 * it does not depend on which other walks happen to be open.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { runWMapIterationOrder } from "../../src/lint-w-map-iteration-order.js";

const D = "$" + "{";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ifchain-ordered-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source, "utf8");
    const r = compileScrml({ inputFiles: [file], write: false });
    return [
      ...(r.errors ?? []),
      ...(r.warnings ?? []),
      ...(r.lintDiagnostics ?? []),
    ].filter((d) => (d.code || "") === "W-MAP-ITERATION-ORDER");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A `{kind:"if-chain"}` node the way `collapseIfChains` builds it: branch
// bodies under `branches[].element` (RECORDS, no `kind` of their own) and
// `elseBranch`. Nothing else in the AST reaches them.
function ifChainWrapping(...children) {
  return {
    kind: "if-chain",
    branches: [
      {
        condition: { kind: "variable-ref", name: "@open" },
        element: { kind: "markup", tag: "div", children },
      },
    ],
    elseBranch: {
      kind: "markup",
      tag: "div",
      children: [{ kind: "text", value: "closed" }],
    },
  };
}

const EACH_OVER_MAP = {
  kind: "each-block",
  iterShape: "in",
  inExprRaw: "@fareByLane.entries()",
  span: { line: 5, col: 3 },
  templateChildren: [],
};

const mapDecl = (anno) => ({
  kind: "state-decl",
  name: "fareByLane",
  typeAnnotation: anno,
});

describe("g-if-chain-ordered-map-exemption-blind", () => {
  describe("the fix — collectOrderedMapNames reaches into a branch", () => {
    // These call the lint directly, bypassing the `collectMapVarNames` mask by
    // declaring the map at top level (so it IS in `mapNames`) while putting the
    // `@ordered` decl AND the `<each>` inside the chain. That isolates the
    // exemption walk, which is the thing this site owns.
    test("an @ordered map declared inside a branch keeps its §59.8 exemption", () => {
      const file = {
        filePath: "/x.scrml",
        ast: {
          nodes: [
            // Top-level decl WITHOUT the affix: puts the name in `mapNames`
            // without pre-supplying the exemption.
            mapDecl("[string: number]"),
            ifChainWrapping(mapDecl("[string: number]@ordered"), EACH_OVER_MAP),
          ],
        },
      };
      expect(runWMapIterationOrder([file]).length).toBe(0);
    });

    test("CRY-WOLF GUARD: a NON-@ordered map in the same shape still fires", () => {
      // The fix must not silence the real diagnostic — it only widens the
      // EXEMPTION set, and an exemption that exempts everything is useless.
      const file = {
        filePath: "/x.scrml",
        ast: {
          nodes: [
            mapDecl("[string: number]"),
            ifChainWrapping(mapDecl("[string: number]"), EACH_OVER_MAP),
          ],
        },
      };
      expect(runWMapIterationOrder([file]).length).toBe(1);
    });

    test("PARITY: the lone-if= oracle (plain markup, never collapsed) agrees", () => {
      const inPlainMarkup = (decl) => ({
        filePath: "/x.scrml",
        ast: {
          nodes: [
            mapDecl("[string: number]"),
            { kind: "markup", tag: "div", children: [decl, EACH_OVER_MAP] },
          ],
        },
      });
      expect(runWMapIterationOrder([inPlainMarkup(mapDecl("[string: number]@ordered"))]).length).toBe(0);
      expect(runWMapIterationOrder([inPlainMarkup(mapDecl("[string: number]"))]).length).toBe(1);
    });
  });

  describe("the MASK IS GONE — end-to-end, and this block is the proof", () => {
    // ⚠ THIS BLOCK USED TO PIN THE MASK AND NO LONGER DOES, and the transition
    // is the point. It previously asserted ZERO on both `if=`/`else` rows,
    // because `collectMapVarNames` (codegen/reactive-deps.ts) was blind in the
    // same way and a branch-declared map never reached the `orderedNames`
    // consult. Its own comment said those rows would FLIP to 1 the moment that
    // collector was closed, and told whoever closed it to update both together.
    //
    // The collector is now closed. The plain row DID flip 0 -> 1 — which is
    // what proves the mask is really gone rather than merely quiet — and the
    // `@ordered` row stayed at 0 ONLY because the exemption walk below it was
    // fixed first. Reverting the `collectOrderedMapNames` hunk with the
    // collector closed produces 1 FALSE POSITIVE on that row; measured, not
    // reasoned. That is the masked-pair rule paying out exactly once.
    const src = (anno, elseArm) => `<program>
<open>: boolean = true
<div class="wrap" if=@open>${D} <m>: ${anno} = [:] }
  <ul>
    <each in=@m.entries() key=@.key>
      <li>${D}@.key}</li>
    </each>
  </ul>
</div>
${elseArm}</program>
`;
    const ELSE_ARM = `<div class="wrap2" else><p>closed</p></div>\n`;

    test("a map declared inside an if=/ELSE branch now behaves like the oracle", () => {
      // Lone `if=` is NEVER collapsed, so its body stays plain markup and was
      // always reachable through `children`. It is the parity oracle.
      expect(compileSource(src("[string: number]", "")).length).toBe(1);
      expect(compileSource(src("[string: number]@ordered", "")).length).toBe(0);
      // The collapsed chain now MATCHES it on both rows: the plain map is
      // warned about (0 -> 1, the mask lifting) and the `@ordered` map is
      // exempt (0, and now earned by the exemption walk rather than accidental).
      expect(compileSource(src("[string: number]", ELSE_ARM)).length).toBe(1);
      expect(compileSource(src("[string: number]@ordered", ELSE_ARM)).length).toBe(0);
    });

    test("CONTROL: a TOP-LEVEL map is visible, so the lint itself works", () => {
      const topLevel = (anno, elseArm) => `<program>
<open>: boolean = true
<m>: ${anno} = [:]
<div class="wrap" if=@open>
  <ul>
    <each in=@m.entries() key=@.key>
      <li>${D}@.key}</li>
    </each>
  </ul>
</div>
${elseArm}</program>
`;
      // Both shapes fire — the `walkEachBlocks` half of this file is fixed.
      expect(compileSource(topLevel("[string: number]", "")).length).toBe(1);
      expect(compileSource(topLevel("[string: number]", ELSE_ARM)).length).toBe(1);
      // And the top-level `@ordered` exemption still holds in both.
      expect(compileSource(topLevel("[string: number]@ordered", "")).length).toBe(0);
      expect(compileSource(topLevel("[string: number]@ordered", ELSE_ARM)).length).toBe(0);
    });
  });
});
