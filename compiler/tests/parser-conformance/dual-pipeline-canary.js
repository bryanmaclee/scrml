// dual-pipeline-canary.js — M5-swap C2 (v0.7) dual-pipeline canary.
//
// The PROOF INSTRUMENT for C1's `nativeParseFile` assembler fidelity. For a
// scrml source file it runs BOTH parse pipelines:
//
//   LIVE   — `splitBlocks(filePath, source)` (BS) -> `buildAST(...)` (TAB).
//            The canonical pipeline every adopter compile uses today.
//   NATIVE — `nativeParseFile(filePath, source)`. The C1 assembler routed
//            behind `--parser=scrml-native`.
//
// Both pipelines return the SAME `{ filePath, ast: FileAST, errors }` shape,
// so the canary can structurally diff the two FileASTs along TWO axes:
//   - the TOP-LEVEL node-KIND sequence (`topKindSequence`, no recursion) — the
//     axis the divergence taxonomy (`DIFF-top-seq`, `GAP-state-block`, ...) is
//     built on. A top-level diff keeps its existing class.
//   - the RECURSIVE node-KIND sequence (`nodeKindSequence`, walks each node's
//     `children`) — the DEEP axis. It catches files whose top-level kind
//     sequence is identical in both pipelines but which diverge in a nested
//     position (e.g. a `<state>` buried inside a top-level `<program>` markup
//     — the common app shape). Such files would be top-level-`EXACT` and the
//     deep axis is the only thing that surfaces them.
//   - the six hoisted-collection COUNTS (imports / exports / components /
//     typeDecls / machineDecls / channelDecls);
//   - `hasProgramRoot`;
//   - the diagnostic (error) streams — count + code multiset.
//
// True `EXACT` requires BOTH the top-level AND the recursive sequence to
// match. A file whose top level is clean but whose recursive sequence differs
// is `DIFF-deep-seq` — its own gap-ledger class.
//
// THE CLASSIFICATION CONTRACT. C1 landed with three KNOWN, documented
// deferrals that WILL surface as canary diffs — these are EXPECTED, not bugs
// (see parse-file.js header):
//   D1 — `DisplayTextLiteral` is mapped to a `text` node (the §4.18.6 escape
//        pass is deferred). NOTE: because the native assembler maps a
//        `DisplayTextLiteral` block to ASTNode kind `text` — and the live
//        pipeline's `Text` block also yields ASTNode kind `text` — a nested
//        display-text literal produces NO node-kind diff on EITHER axis. D1
//        is invisible to a kind walk; it needs no `DEFERRAL-*` class. (If a
//        future change made the two pipelines land on different kinds for a
//        display-text literal, that tranche would be a `DEFERRAL-*` class
//        per the test-block precedent — but today they agree on `text`.)
//   D2 — `Test` / `ForeignCode` blocks are dropped with an
//        `I-NATIVE-BLOCK-DROPPED` info diagnostic (the live pipeline strips
//        Test pre-codegen; ForeignCode has no live ASTNode).
//   D3 — `synthLogicNode` leaves the per-node `logic.{imports,exports,
//        typeDecls,components}` arrays empty (the file-level `collectHoisted`
//        is the authoritative source). These are array CONTENTS, not nodes —
//        a node-kind walk does not see them; D3 is invisible to BOTH axes.
//
// `classifyDivergence` partitions every divergent file into:
//   - `EXACT`              — the two FileASTs match structurally on BOTH the
//        top-level and the recursive node-kind axes.
//   - `DEFERRAL-test-block`— the only diff is the live pipeline having a
//        top-level `test` node native dropped (D2). ACCEPTABLE.
//   - `DIFF-deep-seq`      — the top-level diff is clean (today's `EXACT`
//        criteria) but the RECURSIVE node-kind sequence differs: a divergence
//        nested below the top level. `explained: false` — a gap-ledger entry.
//   - one of several `GAP-*` / `DIFF-*` classes — an UNEXPLAINED native-vs-
//        live divergence: a real fidelity gap. The conformance gate
//        (parser-conformance-corpus.test.js) `.skip`s these with the class
//        name as the documented reason; the C2 gap ledger catalogs them.
//
// Pure module — no test framework imports; consumed by the conformance test
// and by ad-hoc ledger scripts.

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

// =============================================================================
// runLivePipeline / runNativePipeline — drive one pipeline, return the
// `{ filePath, ast, errors }` result or a `{ crashed: true, error }` marker.
// A crash is itself a canary finding (the live pipeline is not expected to
// crash; the native parser's no-throw discipline means a native crash is a
// hard regression).
// =============================================================================
export function runLivePipeline(filePath, source) {
  try {
    const bs = splitBlocks(filePath, source);
    const tab = buildAST(bs, null);
    return { crashed: false, ast: tab.ast, errors: tab.errors || [] };
  } catch (e) {
    return { crashed: true, error: e && e.message ? e.message : String(e) };
  }
}

export function runNativePipeline(filePath, source) {
  try {
    const r = nativeParseFile(filePath, source);
    return { crashed: false, ast: r.ast, errors: r.errors || [] };
  } catch (e) {
    return { crashed: true, error: e && e.message ? e.message : String(e) };
  }
}

// =============================================================================
// nodeKindSequence — the recursive node-KIND walk. Top-level nodes plus, for
// every node carrying a `children` array, its children (recursively). The
// pre-order kind sequence is the DEEP structural signature the canary diffs —
// it catches divergences nested below a top-level node (e.g. a `<state>`
// inside a top-level `<program>` markup) that `topKindSequence` cannot see.
// =============================================================================
export function nodeKindSequence(nodes) {
  const out = [];
  function walk(n) {
    if (n === undefined || n === null) return;
    out.push(n.kind);
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  }
  for (const n of nodes || []) walk(n);
  return out;
}

// firstSeqDivergence — the index + the two kinds at the first position where
// two kind sequences differ, or `null` when they are equal. Used to give the
// gap ledger a concrete "diverges at i=N: live=X native=Y" detail rather than
// dumping two long sequences.
function firstSeqDivergence(liveSeq, nativeSeq) {
  const n = Math.max(liveSeq.length, nativeSeq.length);
  for (let i = 0; i < n; i = i + 1) {
    const lk = i < liveSeq.length ? liveSeq[i] : "(end)";
    const nk = i < nativeSeq.length ? nativeSeq[i] : "(end)";
    if (lk !== nk) {
      return { index: i, liveKind: lk, nativeKind: nk };
    }
  }
  return null;
}

// topKindSequence — the top-level node-kind sequence only (no recursion).
export function topKindSequence(nodes) {
  return (nodes || []).map((n) => (n !== undefined && n !== null ? n.kind : null));
}

// =============================================================================
// isLiveDegenerate — the oracle is not infallible. On some files the LIVE
// block-splitter silently drops all markup content and produces a degenerate
// FileAST: a comment+text(+empty-logic)-only tree with ZERO `markup` nodes,
// while the native parser produces the correct, substantial markup tree.
// Such a file is NOT a native gap — the live oracle is the broken side.
//
// The detector is structural and ratio-gated, so it cannot mistake a small
// legitimate non-`<program>` file (whose two pipelines agree at comparable
// size) for a degenerate-live one:
//   - the LIVE deep tree carries ZERO `markup` nodes, AND
//   - the NATIVE deep tree carries at least one `markup` node, AND
//   - the NATIVE deep tree is at least 3x the size of the LIVE deep tree.
// The 3x ratio is what excludes a genuine small component-only file (where
// native and live land within ~2x of each other) from the degenerate class.
// =============================================================================
export function isLiveDegenerate(liveDeep, nativeDeep) {
  const liveMarkup = liveDeep.filter((k) => k === "markup").length;
  const nativeMarkup = nativeDeep.filter((k) => k === "markup").length;
  if (liveMarkup !== 0) return false;
  if (nativeMarkup < 1) return false;
  return nativeDeep.length >= 3 * Math.max(liveDeep.length, 1);
}

// =============================================================================
// deepDiffIsOnlyDroppedTests — true iff the ONLY difference between the two
// recursive node-kind sequences is `test` nodes the native parser dropped per
// the D2 deferral (`Test` blocks are dropped with an `I-NATIVE-BLOCK-DROPPED`
// info — the live pipeline strips Test pre-codegen). The top-level
// `DEFERRAL-test-block` class only sees a TOP-LEVEL dropped `test`; a `test`
// block in NESTED position (inside a markup body) is invisible to the
// top-kind set and would otherwise land in `DIFF-deep-seq`. This helper lets
// the canary recognise the nested case as the SAME deliberate D2 deferral:
// the live deep sequence, with every `test` entry removed, must equal the
// native deep sequence exactly.
// =============================================================================
export function deepDiffIsOnlyDroppedTests(liveDeep, nativeDeep) {
  const liveWithoutTests = liveDeep.filter((k) => k !== "test");
  if (liveWithoutTests.length !== nativeDeep.length) return false;
  // native must itself carry no `test` node (D2 drops them all), and the live
  // sequence sans `test` must match native position-for-position.
  if (nativeDeep.some((k) => k === "test")) return false;
  return liveWithoutTests.every((k, i) => k === nativeDeep[i]);
}

// hoistCounts — the six hoisted-collection lengths, as a plain record.
const HOIST_FIELDS = [
  "imports", "exports", "components",
  "typeDecls", "machineDecls", "channelDecls",
];
export function hoistCounts(ast) {
  const out = {};
  for (const f of HOIST_FIELDS) {
    out[f] = Array.isArray(ast[f]) ? ast[f].length : 0;
  }
  return out;
}

// errorCodeMultiset — the diagnostic-code multiset for an errors[] stream.
export function errorCodeMultiset(errors) {
  const out = {};
  for (const e of errors || []) {
    const code = e && e.code ? e.code : "(no-code)";
    out[code] = (out[code] || 0) + 1;
  }
  return out;
}

// =============================================================================
// diffFileASTs — the structural diff. Returns a record:
//   { topSeqEqual, deepSeqEqual, hoistEqual, programRootEqual,
//     liveTop, nativeTop, liveOnlyKinds, nativeOnlyKinds,
//     liveDeep, nativeDeep, deepFirstDivergence,
//     liveHoist, nativeHoist, liveHasProgramRoot, nativeHasProgramRoot }
// `liveOnlyKinds` / `nativeOnlyKinds` are the top-kind SET differences — the
// kinds one pipeline produced at top level that the other did not.
// `liveDeep` / `nativeDeep` are the RECURSIVE pre-order kind sequences;
// `deepSeqEqual` is true iff they match; `deepFirstDivergence` (or `null`)
// pinpoints the first differing position.
// =============================================================================
export function diffFileASTs(liveAst, nativeAst) {
  const liveTop = topKindSequence(liveAst.nodes);
  const nativeTop = topKindSequence(nativeAst.nodes);
  const topSeqEqual =
    liveTop.length === nativeTop.length &&
    liveTop.every((k, i) => k === nativeTop[i]);

  const liveSet = new Set(liveTop);
  const nativeSet = new Set(nativeTop);
  const liveOnlyKinds = [...liveSet].filter((k) => nativeSet.has(k) === false);
  const nativeOnlyKinds = [...nativeSet].filter((k) => liveSet.has(k) === false);

  // The DEEP axis — the recursive pre-order node-kind sequence over each
  // node's `children`. `topSeqEqual` only sees the top-level row; a divergence
  // nested inside (the common `<state>`-inside-`<program>` shape) is caught
  // only here.
  const liveDeep = nodeKindSequence(liveAst.nodes);
  const nativeDeep = nodeKindSequence(nativeAst.nodes);
  const deepSeqEqual =
    liveDeep.length === nativeDeep.length &&
    liveDeep.every((k, i) => k === nativeDeep[i]);
  const deepFirstDivergence = deepSeqEqual
    ? null
    : firstSeqDivergence(liveDeep, nativeDeep);

  const liveHoist = hoistCounts(liveAst);
  const nativeHoist = hoistCounts(nativeAst);
  const hoistEqual = HOIST_FIELDS.every((f) => liveHoist[f] === nativeHoist[f]);

  const liveHasProgramRoot = liveAst.hasProgramRoot === true;
  const nativeHasProgramRoot = nativeAst.hasProgramRoot === true;
  const programRootEqual = liveHasProgramRoot === nativeHasProgramRoot;

  return {
    topSeqEqual, deepSeqEqual, hoistEqual, programRootEqual,
    liveTop, nativeTop, liveOnlyKinds, nativeOnlyKinds,
    liveDeep, nativeDeep, deepFirstDivergence,
    liveHoist, nativeHoist, liveHasProgramRoot, nativeHasProgramRoot,
  };
}

// =============================================================================
// classifyDivergence — the canary's verdict for one corpus file. Drives both
// pipelines, structurally diffs, and returns:
//   { class, explained, detail }
// where `class` is one of:
//   - "EXACT"              — structural match on BOTH the top-level and the
//                            recursive node-kind axes. `explained: true`.
//   - "DIFF-deep-seq"      — the top-level diff is clean (today's `EXACT`
//                            criteria: `topSeqEqual && hoistEqual &&
//                            programRootEqual`) BUT the recursive node-kind
//                            sequence differs — a divergence nested below the
//                            top level (typically a `<state>` inside a
//                            top-level `<program>` markup). `explained: false`
//                            — a gap-ledger entry. A file with a TOP-LEVEL
//                            cause keeps its top-level class (the top-level
//                            cause is reported first); `DIFF-deep-seq` is
//                            ONLY for files the top-level diff cleared.
//   - "LIVE-CRASH"         — the live pipeline crashed. Surfaced; not C2's
//                            remit. `explained: false`.
//   - "NATIVE-CRASH"       — the native parser crashed (no-throw violation —
//                            a hard regression). `explained: false`.
//   - "DEFERRAL-test-block"— the ONLY diff is the live pipeline carrying a
//                            `test` node native dropped per the D2 deferral.
//                            Covers BOTH a top-level dropped `test` (top-kind
//                            set diff) AND a NESTED dropped `test` (the deep
//                            sequence differs only by removed `test` nodes —
//                            the same deliberate D2 choice in nested
//                            position). `explained: true` — acceptable.
//   - "LIVE-DEGENERATE"    — the LIVE pipeline produced a degenerate
//                            comment+text-only FileAST (zero `markup` nodes)
//                            while the native parser produced the correct,
//                            substantial markup tree. The oracle is the
//                            broken side (a live `block-splitter.js`
//                            content-drop defect), NOT a native gap.
//                            `explained: true` — native is correct.
//   - "GAP-state-block"    — the live pipeline produced a `state` /
//                            `state-constructor-def` node native rendered as
//                            `markup` (the native parser has no `State`
//                            BlockKind). `explained: false` — a real gap.
//   - "GAP-native-extra-block" — native produced a top-level `sql` /
//                            `error-effect` / `markup` block the live
//                            pipeline did not. `explained: false`.
//   - "DIFF-engine-in-nodes"   — the live pipeline emits `engine-decl` in
//                            `ast.nodes`; native emits it only into
//                            `machineDecls`. `explained: false` — a real
//                            divergence (a placement difference).
//   - "GAP-program-root"   — `hasProgramRoot` disagrees and nothing else.
//                            `explained: false`.
//   - "DIFF-hoist-count"   — a hoisted-collection count disagrees and the
//                            top-kind sets match. `explained: false`.
//   - "DIFF-top-seq"       — the top-kind SETS match but the SEQUENCE (order
//                            or count) differs — a block-segmentation
//                            divergence. `explained: false`.
//   - "GAP-mixed"          — multiple divergence axes at once.
//                            `explained: false`.
// `explained: true` ⇒ the file is conformance-strict-eligible (it matches the
// live pipeline modulo a documented C1 deferral). `explained: false` ⇒ the
// file is a gap-ledger entry and is `.skip`-ed by the strict gate.
// =============================================================================
export function classifyDivergence(filePath, source) {
  const live = runLivePipeline(filePath, source);
  const native = runNativePipeline(filePath, source);

  if (live.crashed) {
    return { class: "LIVE-CRASH", explained: false, detail: live.error };
  }
  if (native.crashed) {
    return { class: "NATIVE-CRASH", explained: false, detail: native.error };
  }

  const d = diffFileASTs(live.ast, native.ast);

  // LIVE-DEGENERATE — the oracle is the broken side. The live block-splitter
  // silently dropped all markup content and produced a comment+text-only
  // FileAST (zero `markup` nodes) while the native parser produced the
  // correct, substantial markup tree. NOT a native gap — `explained: true`.
  // Checked BEFORE the EXACT / GAP branches: such a file would otherwise be
  // mis-blamed on native as `GAP-native-extra-block` / `GAP-mixed`.
  if (isLiveDegenerate(d.liveDeep, d.nativeDeep)) {
    return { class: "LIVE-DEGENERATE", explained: true, detail: d };
  }

  // True EXACT — the two FileASTs match on BOTH axes: the top-level kind
  // sequence + hoist counts + `hasProgramRoot`, AND the recursive node-kind
  // sequence. A file passing the top-level check but failing the deep check
  // is NOT EXACT (it falls through to the DIFF-deep-seq branch below).
  if (d.topSeqEqual && d.hoistEqual && d.programRootEqual && d.deepSeqEqual) {
    return { class: "EXACT", explained: true, detail: d };
  }

  // DEFERRAL D2 (nested) — the top-level diff is clean and the ONLY deep-axis
  // divergence is `test` nodes native dropped per the D2 deferral. The
  // top-level `DEFERRAL-test-block` branch below only sees a TOP-LEVEL
  // dropped `test`; a `test` block NESTED inside a markup body is invisible
  // to the top-kind set and would otherwise be mis-classed `DIFF-deep-seq`.
  // Dropping a nested `test` is the SAME deliberate, documented D2 choice as
  // dropping a top-level one — `explained: true`.
  if (
    d.topSeqEqual && d.hoistEqual && d.programRootEqual &&
    d.deepSeqEqual === false &&
    deepDiffIsOnlyDroppedTests(d.liveDeep, d.nativeDeep)
  ) {
    return { class: "DEFERRAL-test-block", explained: true, detail: d };
  }

  // DIFF-deep-seq — the top-level diff is clean (today's `EXACT` criteria)
  // but the recursive node-kind sequence differs. This is the deep-axis
  // tranche: a divergence nested below the top level that `topKindSequence`
  // cannot see. A file with a TOP-LEVEL cause does NOT land here — it falls
  // through to the top-level branches below and keeps its top-level class.
  if (
    d.topSeqEqual && d.hoistEqual && d.programRootEqual &&
    d.deepSeqEqual === false
  ) {
    return { class: "DIFF-deep-seq", explained: false, detail: d };
  }

  const liveOnly = d.liveOnlyKinds;
  const nativeOnly = d.nativeOnlyKinds;

  // DEFERRAL D2 — the only top-kind diff is a `test` node native dropped.
  if (
    liveOnly.length === 1 && liveOnly[0] === "test" &&
    nativeOnly.length === 0 && d.hoistEqual && d.programRootEqual
  ) {
    return { class: "DEFERRAL-test-block", explained: true, detail: d };
  }

  // GAP — the native parser has no `State` BlockKind; `<state>` / `<db>`
  // declarative blocks become `markup` nodes.
  if (liveOnly.includes("state") || liveOnly.includes("state-constructor-def")) {
    return { class: "GAP-state-block", explained: false, detail: d };
  }

  // DIFF — `engine-decl` placement: live emits it in `nodes`, native only in
  // `machineDecls`.
  if (
    liveOnly.length === 1 && liveOnly[0] === "engine-decl" &&
    nativeOnly.length === 0
  ) {
    return { class: "DIFF-engine-in-nodes", explained: false, detail: d };
  }

  // hasProgramRoot disagrees and nothing else.
  if (
    liveOnly.length === 0 && nativeOnly.length === 0 &&
    d.programRootEqual === false && d.hoistEqual
  ) {
    return { class: "GAP-program-root", explained: false, detail: d };
  }

  // a hoisted-collection count disagrees, top-kind sets match.
  if (
    liveOnly.length === 0 && nativeOnly.length === 0 &&
    d.programRootEqual && d.hoistEqual === false
  ) {
    return { class: "DIFF-hoist-count", explained: false, detail: d };
  }

  // top-kind SETS match but the SEQUENCE differs — a segmentation divergence.
  if (
    liveOnly.length === 0 && nativeOnly.length === 0 &&
    d.programRootEqual && d.hoistEqual && d.topSeqEqual === false
  ) {
    return { class: "DIFF-top-seq", explained: false, detail: d };
  }

  // native produced an extra top-level block kind.
  if (
    liveOnly.length === 0 &&
    (nativeOnly.includes("sql") || nativeOnly.includes("error-effect") ||
     nativeOnly.includes("markup"))
  ) {
    return { class: "GAP-native-extra-block", explained: false, detail: d };
  }

  return { class: "GAP-mixed", explained: false, detail: d };
}

// =============================================================================
// summarizeDetail — a compact one-line human string for a divergence detail,
// for the gap-ledger output + the conformance `.skip` reason.
// =============================================================================
export function summarizeDetail(verdict) {
  if (verdict.class === "LIVE-CRASH" || verdict.class === "NATIVE-CRASH") {
    return verdict.detail;
  }
  const d = verdict.detail;
  if (verdict.class === "LIVE-DEGENERATE") {
    return "live AST is degenerate (zero markup nodes) — live block-splitter " +
      "dropped all markup; native is correct (deep len live=" +
      (d.liveDeep ? d.liveDeep.length : "?") +
      " native=" + (d.nativeDeep ? d.nativeDeep.length : "?") + ")";
  }
  const parts = [];
  if (d.liveOnlyKinds && d.liveOnlyKinds.length > 0) {
    parts.push("live-only-kinds=[" + d.liveOnlyKinds.join(",") + "]");
  }
  if (d.nativeOnlyKinds && d.nativeOnlyKinds.length > 0) {
    parts.push("native-only-kinds=[" + d.nativeOnlyKinds.join(",") + "]");
  }
  if (d.programRootEqual === false) {
    parts.push("hasProgramRoot live=" + d.liveHasProgramRoot +
      " native=" + d.nativeHasProgramRoot);
  }
  if (d.hoistEqual === false) {
    const hf = [];
    for (const f of Object.keys(d.liveHoist)) {
      if (d.liveHoist[f] !== d.nativeHoist[f]) {
        hf.push(f + " live=" + d.liveHoist[f] + " native=" + d.nativeHoist[f]);
      }
    }
    parts.push("hoist[" + hf.join("; ") + "]");
  }
  if (d.topSeqEqual === false && parts.length === 0) {
    parts.push("top-seq differs (same kind set): live=[" +
      d.liveTop.join(",") + "] native=[" + d.nativeTop.join(",") + "]");
  }
  // The DEEP axis — surfaced when the top-level diff is clean. `DIFF-deep-seq`
  // is exactly this case; the first-divergence index pinpoints the nested
  // node where the two recursive sequences part.
  if (
    parts.length === 0 && d.deepSeqEqual === false &&
    d.deepFirstDivergence !== undefined && d.deepFirstDivergence !== null
  ) {
    const fd = d.deepFirstDivergence;
    parts.push("deep-seq diverges at i=" + fd.index +
      ": live=" + fd.liveKind + " native=" + fd.nativeKind +
      " (deep len live=" + (d.liveDeep ? d.liveDeep.length : "?") +
      " native=" + (d.nativeDeep ? d.nativeDeep.length : "?") + ")");
  }
  return parts.join(" | ") || "structural divergence";
}
