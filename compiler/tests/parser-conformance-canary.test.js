// parser-conformance-canary.test.js — M5 gap-ledger: dual-pipeline canary
// recursive-axis unit coverage.
//
// The dual-pipeline canary (compiler/tests/parser-conformance/
// dual-pipeline-canary.js) diffs the native-vs-live FileAST along TWO axes:
//   - the TOP-LEVEL node-kind sequence (`topKindSequence`); and
//   - the RECURSIVE node-kind sequence (`nodeKindSequence`) — the DEEP axis
//     that catches divergences nested below a top-level node.
//
// `parser-conformance-corpus.test.js` exercises the canary against the real
// ~1000-file corpus; this file is the FOCUSED unit coverage for the deep
// axis. It feeds `diffFileASTs` synthetic live/native FileAST pairs (the diff
// is pure data — it never re-runs a parse pipeline) and asserts the verdict:
//   - a top-level-equal but deep-divergent pair classifies `DIFF-deep-seq`;
//   - a fully deep-equal pair classifies `EXACT`;
//   - a top-level-divergent pair keeps its top-level class (the deep axis
//     does not re-bucket a file that already has a top-level cause).

import { describe, test, expect } from "bun:test";

import {
  nodeKindSequence,
  topKindSequence,
  diffFileASTs,
} from "./parser-conformance/dual-pipeline-canary.js";

// fakeFileAST — a minimal FileAST-shaped record for the diff. `diffFileASTs`
// reads `.nodes`, the six hoist arrays, and `.hasProgramRoot` — nothing else.
function fakeFileAST(nodes) {
  return {
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    machineDecls: [],
    channelDecls: [],
    hasProgramRoot: true,
  };
}

// node — a tiny ASTNode-shaped record: a `kind` and optional `children`.
function node(kind, children) {
  return Array.isArray(children) ? { kind, children } : { kind };
}

describe("dual-pipeline-canary — nodeKindSequence (the recursive walk)", () => {
  test("walks children pre-order, recursively", () => {
    const tree = [
      node("markup", [
        node("text"),
        node("state", [node("text")]),
      ]),
      node("comment"),
    ];
    expect(nodeKindSequence(tree)).toEqual([
      "markup", "text", "state", "text", "comment",
    ]);
  });

  test("topKindSequence sees only the top row — the deep state is hidden", () => {
    const tree = [node("markup", [node("state")])];
    expect(topKindSequence(tree)).toEqual(["markup"]);
    expect(nodeKindSequence(tree)).toEqual(["markup", "state"]);
  });

  test("tolerates null / undefined / missing children", () => {
    expect(nodeKindSequence([null, undefined, node("text")])).toEqual(["text"]);
    expect(nodeKindSequence(undefined)).toEqual([]);
  });
});

describe("dual-pipeline-canary — diffFileASTs deep axis", () => {
  test("top-level-equal, deep-equal → both axes equal", () => {
    const live = fakeFileAST([node("markup", [node("state", [node("text")])])]);
    const native = fakeFileAST([node("markup", [node("state", [node("text")])])]);
    const d = diffFileASTs(live, native);
    expect(d.topSeqEqual).toBe(true);
    expect(d.deepSeqEqual).toBe(true);
    expect(d.deepFirstDivergence).toBe(null);
  });

  test("top-level-equal but deep-divergent → topSeqEqual true, deepSeqEqual false", () => {
    // both pipelines yield a single top-level `markup` — the top-level diff is
    // clean — but the live pipeline nests a `state` where native nests a
    // `markup`. Only the deep axis sees it.
    const live = fakeFileAST([node("markup", [node("state")])]);
    const native = fakeFileAST([node("markup", [node("markup")])]);
    const d = diffFileASTs(live, native);
    expect(d.topSeqEqual).toBe(true);
    expect(d.deepSeqEqual).toBe(false);
    expect(d.deepFirstDivergence).toEqual({
      index: 1, liveKind: "state", nativeKind: "markup",
    });
  });

  test("deepFirstDivergence reports an (end) sentinel on a length mismatch", () => {
    const live = fakeFileAST([node("markup", [node("text"), node("text")])]);
    const native = fakeFileAST([node("markup", [node("text")])]);
    const d = diffFileASTs(live, native);
    expect(d.topSeqEqual).toBe(true);
    expect(d.deepSeqEqual).toBe(false);
    expect(d.deepFirstDivergence).toEqual({
      index: 2, liveKind: "text", nativeKind: "(end)",
    });
  });
});

describe("dual-pipeline-canary — classifyDivergence-equivalent verdict logic", () => {
  // classifyDivergence drives both real pipelines from source; the verdict
  // logic itself is the boolean cascade over a diffFileASTs record. These
  // tests reproduce that cascade against synthetic diffs to lock the new
  // DIFF-deep-seq branch + the tightened EXACT criteria.

  // verdictFromDiff — the EXACT / DIFF-deep-seq decision for a clean-top diff,
  // mirroring the first two branches of classifyDivergence.
  function verdictFromDiff(d) {
    if (d.topSeqEqual && d.hoistEqual && d.programRootEqual && d.deepSeqEqual) {
      return "EXACT";
    }
    if (d.topSeqEqual && d.hoistEqual && d.programRootEqual &&
        d.deepSeqEqual === false) {
      return "DIFF-deep-seq";
    }
    return "(top-level class)";
  }

  test("a fully-matching pair classifies EXACT", () => {
    const ast = [node("markup", [node("text"), node("state", [node("text")])])];
    const d = diffFileASTs(fakeFileAST(ast), fakeFileAST(ast));
    expect(verdictFromDiff(d)).toBe("EXACT");
  });

  test("a top-level-equal, deep-divergent pair classifies DIFF-deep-seq", () => {
    const live = fakeFileAST([node("markup", [node("state")])]);
    const native = fakeFileAST([node("markup", [node("markup")])]);
    const d = diffFileASTs(live, native);
    expect(verdictFromDiff(d)).toBe("DIFF-deep-seq");
  });

  test("a top-level-divergent pair is NOT EXACT and NOT DIFF-deep-seq — it keeps a top-level class", () => {
    const live = fakeFileAST([node("state"), node("markup")]);
    const native = fakeFileAST([node("markup"), node("markup")]);
    const d = diffFileASTs(live, native);
    // top sequences differ → topSeqEqual false → falls through to the
    // top-level taxonomy, never reaching the deep-axis branches.
    expect(d.topSeqEqual).toBe(false);
    expect(verdictFromDiff(d)).toBe("(top-level class)");
  });
});
