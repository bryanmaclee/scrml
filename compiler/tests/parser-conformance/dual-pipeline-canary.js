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
import {
  isStateTagBoundaryAfterLt,
} from "../../native-parser/parse-markup.js";
import { makeCursor } from "../../native-parser/cursor.js";

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
//   - the NATIVE deep tree is at least 1.5x the size of the LIVE deep tree.
//
// W8-CANARY-DEGEN-GUARD (S121): the ratio guard was lowered from 3.0x to 1.5x
// per the GAP-native-extra-block survey
// (docs/changes/m5-c2-gap-ledger/gap-neb-survey-s121-2026-05-22.md §4 Unit
// W8-CANARY-DEGEN-GUARD). The surveyed corpus shows a clean empirical gap:
// the two surviving GAP-NEB files (gauntlet-r11-zig-buildconfig.scrml at
// 1.86x and tailwind-prose-coverage.scrml at 2.50x) carry the exact
// LIVE-DEGENERATE signature (liveMarkup===0, nativeMarkup>=1) — corpus-stale
// shapes (S80 trailing-slash + §4.17 raw-content) where live silently drops
// content and native correctly preserves it. The lowest legitimate
// LIVE-DEGENERATE ratio in the current corpus is 3.36x, so the 1.5x cutoff
// absorbs both GAP-NEB files (1.86 > 1.5 AND 2.50 > 1.5) while preserving a
// generous 1.86x headroom below the lowest existing LIVE-DEGENERATE. The
// `liveMarkup === 0 ∧ nativeMarkup >= 1` shape gate remains the primary
// fingerprint; the ratio guard is defense-in-depth against a tiny
// component-only file landing here by coincidence.
// =============================================================================
export function isLiveDegenerate(liveDeep, nativeDeep) {
  const liveMarkup = liveDeep.filter((k) => k === "markup").length;
  const nativeMarkup = nativeDeep.filter((k) => k === "markup").length;
  if (liveMarkup !== 0) return false;
  if (nativeMarkup < 1) return false;
  return nativeDeep.length >= 1.5 * Math.max(liveDeep.length, 1);
}

// =============================================================================
// sourceHasPhantomStateAdmission — true iff the source contains at least one
// `<` position that LIVE's BS+TAB pipeline admits as a `< Ident>` state-opener
// (SPEC §4.3) but NATIVE's tightened predicate (`isStateTagBoundaryAfterLt`,
// P5-12b S121) rejects.
//
// Live's rule (block-splitter.js L1908): `<` + at least one whitespace + an
// ASCII letter (or `_`) — and live then opaquely consumes attributes until
// `>` / EOF, with no post-identifier validation. P5-12b TIGHTENED native: the
// first non-tag-name char after the identifier MUST be a tag-shape terminator
// (` ` / `\t` / `\n` / `\r` / `>` / `/` / `=` / EOF). A `.`, `(`, `,`, `+`,
// `-`, `*`, etc. proves this is a less-than expression (`< p.foo`, `< n+1`,
// `< fn()`) — NOT a state opener.
//
// The detector walks the source and, at every `<`, checks both rules. A
// position where live admits but native rejects is a "phantom admission
// site": live will admit a state-frame native correctly rejects, the
// downstream consequence being a phantom state-with-children that swallows
// content and shows up in the canary as a deep-axis divergence with live's
// first-divergence kind = `state`.
//
// The scan is unconditional — it does not parse string literals / comments
// / regex / etc. That is the RIGHT contract: live's broad rule is ALSO
// position-unconditional past the lexical level the BS pipeline already
// gates on (BS does not enter free text inside ${} / logic bodies the way
// the markup parser does — but a phantom `<` in a markup region is what
// matters here, and live's broad rule will fire there too). The downstream
// gate in classifyDivergence (`LIVE-PHANTOM` requires `DIFF-deep-seq` + a
// live-side `state` at the first divergence) keeps the false-positive set
// tight.
// =============================================================================
export function sourceHasPhantomStateAdmission(source) {
  if (typeof source !== "string" || source.length === 0) return false;
  const cursor = makeCursor(source);
  const len = source.length;
  for (let i = 0; i < len; i = i + 1) {
    if (source.charAt(i) !== "<") continue;
    // Live's broad admission shape: `<` + at least one whitespace + an
    // ASCII letter (start of `readIdent`). A `<` with NO whitespace is the
    // markup `<TAG>` form which both pipelines admit identically — not the
    // phantom shape.
    let j = i + 1;
    if (j >= len) continue;
    let ws = source.charAt(j);
    if (ws !== " " && ws !== "\t" && ws !== "\n" && ws !== "\r") continue;
    while (
      j < len &&
      (source.charAt(j) === " " || source.charAt(j) === "\t" ||
       source.charAt(j) === "\n" || source.charAt(j) === "\r")
    ) {
      j = j + 1;
    }
    if (j >= len) continue;
    const startChar = source.charAt(j);
    // Live's `readIdent` keys on `[A-Za-z_]`; mirror that here.
    const isIdentStart =
      (startChar >= "A" && startChar <= "Z") ||
      (startChar >= "a" && startChar <= "z") ||
      startChar === "_";
    if (isIdentStart === false) continue;
    // Live admits — now check native's strict predicate from this `<`.
    cursor.pos = i;
    if (isStateTagBoundaryAfterLt(cursor) === false) {
      return true;
    }
  }
  return false;
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

// =============================================================================
// countSourceExportLines / countSourceImportDeclLines — source-witness counters
// for the LIVE-HOIST-MISCLASSIFY class (Wave 9 Unit H). Both walk the source
// line-by-line and count lines whose TRIMMED prefix is the requested keyword
// shape — a conservative, false-positive-tight signal of how many real
// top-level `export` / `import ... from ...` statements the source contains.
//
// Conservative shape gates (false-negatives are OK, false-positives are not):
//   - the LINE'S trimmed prefix must literally start with `export ` /
//     `import ` (whitespace + keyword + at least one trailing space char);
//   - for `import ... from ...` the line must ALSO contain a `from` token
//     surrounded by whitespace (rules out the dynamic-import-call form
//     `import("path")`, which has no `from` clause);
//   - lines whose trimmed prefix begins with `//` are skipped (single-line
//     comment guard);
//   - lines whose prefix starts with `*` are skipped (block-comment-body
//     guard — covers the `/** ... */` JSDoc style without needing a stateful
//     scanner). Block-comment OPENERS (`/* export ...`) that contain the
//     keyword on the same logical line are not stripped — rare in real
//     scrml; if it ever bites, the helper can be tightened later. Same
//     spirit as `parse-markup.js`'s defensive scanners — keep it simple,
//     resist over-engineering.
//
// The helpers are exported so the unit tests can lock the line-shape
// contract directly.
// =============================================================================
function trimmedIsComment(line) {
  const t = line.trim();
  if (t.length === 0) return true;
  if (t.startsWith("//")) return true;
  if (t.startsWith("*")) return true;
  return false;
}

export function countSourceExportLines(source) {
  if (typeof source !== "string" || source.length === 0) return 0;
  let count = 0;
  for (const line of source.split("\n")) {
    if (trimmedIsComment(line)) continue;
    const t = line.trim();
    // `export ` followed by anything — `export type X`, `export async`,
    // `export function`, `export const`, `export { ... }`, `export *`.
    if (t.startsWith("export ")) count = count + 1;
  }
  return count;
}

export function countSourceImportDeclLines(source) {
  if (typeof source !== "string" || source.length === 0) return 0;
  let count = 0;
  for (const line of source.split("\n")) {
    if (trimmedIsComment(line)) continue;
    const t = line.trim();
    // The two real `import-decl` shapes:
    //   `import { a, b } from "..."`
    //   `import x from "..."`
    //   `import * as x from "..."`
    // All carry a `from` clause. The dynamic-import-call form `import("...")`
    // does NOT — it's a CALL expression, not a declaration. Excluding lines
    // without a `from` token rules out the cg.scrml phantom-import shape.
    if (t.startsWith("import ") === false) continue;
    // Match `from` as a standalone token (word-boundary). A path like
    // `./from-utils.js` would otherwise false-positive.
    if (/\bfrom\s/.test(t) === false) continue;
    count = count + 1;
  }
  return count;
}

// =============================================================================
// liveImportsHaveDynamicCallShape — for a set of "extra" import records the
// live pipeline produced that native does not, report whether ALL of them
// have the dynamic-import-call shape (no `from` clause, raw matches
// `import\s*(`). The LIVE-HOIST-MISCLASSIFY detector uses this to gate the
// import-axis branch: live's broad `import(...)` scanner is a known oracle
// defect that captures dynamic-import expressions as if they were module-
// level import-decls; the cg.scrml `^{...}` meta block is its canonical
// witness. If even one of the live "extras" is not dynamic-shaped, the
// divergence is something else and the classifier must NOT absorb it.
//
// Signature shape gates:
//   - the record's `source` is null / undefined / empty string (no `from`
//     clause was parsed); AND
//   - the record's `raw` text starts (after optional whitespace) with
//     `import` + optional whitespace + `(`.
// Both gates must fire for every record. The helper returns false on an
// empty input (no "extras" means nothing to credit).
// =============================================================================
export function liveImportsHaveDynamicCallShape(extraImports) {
  if (Array.isArray(extraImports) === false) return false;
  if (extraImports.length === 0) return false;
  for (const im of extraImports) {
    if (im === null || im === undefined) return false;
    if (im.source !== null && im.source !== undefined && im.source !== "") {
      return false;
    }
    if (typeof im.raw !== "string") return false;
    if (/^\s*import\s*\(/.test(im.raw) === false) return false;
  }
  return true;
}

// =============================================================================
// isLiveHoistMisclassify — the LIVE-HOIST-MISCLASSIFY detector. True iff the
// hoist-count divergence is FULLY explained by a known live-oracle defect
// where the source (treated as ground truth) agrees with NATIVE on every
// diverging axis. The two surveyed shapes (Wave 9 Unit H, post-S121 P5
// re-triage §2.2):
//
//   - EXPORTS-AXIS  — `stdlib/auth/jwt.scrml`. Source contains four
//     line-leading `export ` keywords (one `export type`, one `export async
//     function signJwt`, one `export async function verifyJwt`, one `export
//     function decodeJwt`); native correctly hoists 4 export records; live's
//     scanner harvests only 1 (the type-decl). Native matches the source-
//     witness count exactly.
//
//   - IMPORTS-AXIS  — `compiler/self-host/cg.scrml` (v1 tree retired S447; the
//     source is preserved inline as CG_SCRML_SOURCE in
//     parser-conformance-canary.test.js). Source contains zero
//     `import ... from ...` declarations and five `await import("...")`
//     dynamic-import-call expressions inside an `^{...}` meta block. Native
//     correctly hoists 0 imports; live's scanner phantoms the dynamic-import
//     calls as if they were import-decls, recording 5. Native matches the
//     source-witness count exactly; the five "extra" live records have the
//     dynamic-import-call shape (no `from` clause, raw matches
//     `import\s*(`).
//
// The detector composes both axes with conjunctive shape gates. It runs
// after `diffFileASTs` (which already established hoist-count divergence):
//
//   For each of the six hoist fields:
//     - if counts agree, the field is not a diverging axis;
//     - if counts disagree, the field MUST match one of the two recognised
//       LIVE-WRONG shapes (above). Even ONE diverging field that does not
//       match a recognised shape disqualifies the file — it falls through
//       to the generic `DIFF-hoist-count` class (an unexplained gap).
//
//   Both diverging-axis shapes additionally require the SOURCE-WITNESS
//   count to equal NATIVE's count. This rules out cases where neither
//   pipeline is the broken side (e.g. the since-retired v1 `compiler/self-host/bs.scrml`, where
//   native phantoms an empty type-decl mid-statement at line 241 — native
//   over-counts; source-witness count agrees with LIVE, not native; that
//   file must remain `DIFF-hoist-count` as a Wave 5 H-bs-tail investigation
//   unit, not be absorbed here).
//
// EXISTS BECAUSE OF: live's scanner-level heuristics for `export` /
// `import(...)` recognition pre-date the canonical native parser. The
// corpus-sweep PLAN (docs/changes/corpus-sweep/PLAN.md) defers live-side
// fixes until M6. WILL GO AWAY at M6 when block-splitter.js + ast-builder
// are deleted and the native parser is the sole front-end.
//
// The helper takes the LIVE + NATIVE FileASTs (not just the diff record)
// because identifying the dynamic-import-call shape requires inspection of
// the actual import records' `raw` text — which `diffFileASTs` does not
// keep. Live's "extra" imports are computed by suffix-slice on the live
// imports array (live.length > native.length ⇒ the extras are the tail —
// since native's count is the source-witness truth, ANY live import beyond
// native's count is a phantom that must have dynamic-call shape).
// =============================================================================
export function isLiveHoistMisclassify(liveAst, nativeAst, source) {
  if (liveAst === null || liveAst === undefined) return false;
  if (nativeAst === null || nativeAst === undefined) return false;
  if (typeof source !== "string" || source.length === 0) return false;

  const lh = hoistCounts(liveAst);
  const nh = hoistCounts(nativeAst);

  // For each diverging field, decide whether it matches a recognised
  // LIVE-WRONG shape. Any diverging field that does NOT match disqualifies.
  let anyDivergence = false;
  for (const f of HOIST_FIELDS) {
    if (lh[f] === nh[f]) continue;
    anyDivergence = true;

    if (f === "exports") {
      // Live UNDERCOUNTS exports the source actually contains; native's
      // count must equal the source-witness count.
      if (nh.exports <= lh.exports) return false;
      const witness = countSourceExportLines(source);
      if (nh.exports !== witness) return false;
      continue;
    }

    if (f === "imports") {
      // Live OVERCOUNTS imports because its scanner phantom-matches the
      // dynamic-import-call form. Native's count must equal the source-
      // witness count, and live's "extras" (the records beyond native's
      // count) must all have the dynamic-import-call shape.
      if (lh.imports <= nh.imports) return false;
      const witness = countSourceImportDeclLines(source);
      if (nh.imports !== witness) return false;
      // The extras: live's import records beyond native's count. Pick from
      // the tail — block-splitter's scan order is positional; in cg.scrml
      // the dynamic-import calls all live in the `^{...}` body that
      // follows the (zero) top-level import-decls.
      const liveImports = Array.isArray(liveAst.imports) ? liveAst.imports : [];
      if (liveImports.length !== lh.imports) return false;
      // Defensive: every live import beyond native's index must be dynamic-
      // call shaped. Equivalently: if native count is zero, ALL live
      // imports must be dynamic-call shaped (the cg.scrml case).
      const extras = liveImports.slice(nh.imports);
      if (liveImportsHaveDynamicCallShape(extras) === false) return false;
      continue;
    }

    // Any other diverging field (components / typeDecls / machineDecls /
    // channelDecls) — no recognised LIVE-WRONG shape today. The bs.scrml
    // `typeDecls live=0 native=1` shape is exactly this branch: a native
    // mid-statement phantom, NOT a live miss. Falling through here keeps
    // the file in the generic `DIFF-hoist-count` class as a Wave 5
    // investigation entry.
    return false;
  }

  return anyDivergence;
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
//   - "LIVE-PHANTOM"       — the LIVE pipeline ADMITTED a `< Ident>` state
//                            opener at a position the SPEC §4.3 grammar
//                            forbids (post-identifier char is not a tag-shape
//                            terminator: a `.` / `(` / `,` / `+` / `-` / `*`,
//                            i.e. the operator chars of a less-than
//                            expression). Native correctly REJECTS per
//                            P5-12b's `isStateTagBoundaryAfterLt` tighten
//                            (S121). Live's broad admit causes a phantom
//                            state-with-children that swallows content; the
//                            structural divergence surfaces as a deep-axis
//                            diff with live's first-divergence kind = `state`.
//                            The oracle is the broken side, NOT a native gap.
//                            `explained: true` — native is correct.
//
//                            EXISTS BECAUSE OF: P5-12b (S121) tightened
//                            native; the corpus-sweep PLAN (docs/changes/
//                            corpus-sweep/PLAN.md) explicitly defers
//                            live-side fixes until M6. WILL GO AWAY at M6
//                            when block-splitter.js is deleted and the
//                            native parser is the sole front-end — at that
//                            point every "live admits / native rejects" gap
//                            collapses (there is no live oracle to disagree
//                            with).
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
//   - "LIVE-HOIST-MISCLASSIFY" — the only divergence is in hoist counts
//                            (top-kind sets match, programRootEqual), and
//                            EVERY diverging hoist field matches a recognised
//                            LIVE-WRONG shape (source-witness count agrees
//                            with NATIVE, not live). Two shapes today:
//                              EXPORTS-AXIS — live undercounts (jwt.scrml:
//                              live=1, native=4, source has 4 line-leading
//                              `export ` keywords);
//                              IMPORTS-AXIS — live phantom-matches the
//                              dynamic-import-call form (cg.scrml: live=5,
//                              native=0, source has 0 real `import ... from`
//                              lines, 5 `await import(...)` calls inside
//                              `^{...}`; live's "extras" all have raw
//                              `import\s*(` shape with no `from` clause).
//                            Sibling to LIVE-DEGENERATE / LIVE-PHANTOM —
//                            credits NATIVE-CORRECTNESS when LIVE is the
//                            broken oracle. `explained: true`. EXISTS
//                            BECAUSE OF: live's scanner-level heuristics
//                            for `export` / `import(...)` recognition;
//                            corpus-sweep PLAN defers live-side fixes
//                            until M6. WILL GO AWAY at M6.
//   - "DIFF-hoist-count"   — a hoisted-collection count disagrees and the
//                            top-kind sets match, and the divergence does
//                            NOT match a recognised LIVE-WRONG shape.
//                            `explained: false`.
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

  // LIVE-PHANTOM — the top-level diff is clean and the deep axis diverges
  // SPECIFICALLY because LIVE admitted a `< Ident>` state opener at a
  // position the SPEC §4.3 grammar forbids (a less-than expression: `< p.x`
  // / `< n+1` / `< fn()`). Native correctly REJECTS per P5-12b
  // (`isStateTagBoundaryAfterLt`, S121); live's broad admit causes a
  // phantom state-with-children that swallows content.
  //
  // The TRIPLE gate keeps the false-positive set tight:
  //   (a) the file would otherwise be `DIFF-deep-seq` (top clean, deep
  //       diverges) — so a non-phantom cause already cleared `DIFF-hoist-
  //       count` / `DIFF-top-seq` / `GAP-*` first;
  //   (b) the source contains at least one phantom admission site
  //       (`sourceHasPhantomStateAdmission`);
  //   (c) live's first deep-axis divergence kind is `state` — the
  //       fingerprint of "live admitted a state native didn't".
  //
  // This class CREDITS NATIVE-CORRECTNESS when the LIVE oracle is the
  // broken pipeline. It exists because of P5-12b (S121) and the corpus-
  // sweep PLAN's M6 deferral of live-side fixes; it WILL GO AWAY at M6
  // when live is deleted.
  if (
    d.topSeqEqual && d.hoistEqual && d.programRootEqual &&
    d.deepSeqEqual === false &&
    d.deepFirstDivergence !== null && d.deepFirstDivergence !== undefined &&
    d.deepFirstDivergence.liveKind === "state" &&
    sourceHasPhantomStateAdmission(source)
  ) {
    return { class: "LIVE-PHANTOM", explained: true, detail: d };
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

  // LIVE-HOIST-MISCLASSIFY — the only divergence is in hoist counts, AND
  // every diverging field matches a recognised LIVE-WRONG shape (native's
  // count equals the source-witness ground truth). Two surveyed shapes:
  // exports-axis (jwt.scrml — live's scanner undercounts top-level `export`
  // keywords); imports-axis (cg.scrml — live's scanner phantom-matches the
  // dynamic-import-call form `import("...")` inside an `^{...}` meta
  // block). Sibling to LIVE-DEGENERATE / LIVE-PHANTOM — credits native-
  // correctness when LIVE is the broken oracle. `explained: true`.
  //
  // Checked BEFORE `DIFF-hoist-count` so its tight predicate (source-
  // witness match + per-axis shape gate) absorbs the recognised cases
  // while leaving genuinely-native-wrong hoist defects (e.g. bs.scrml's
  // phantom empty type-decl at line 241 col 17) in the unexplained
  // `DIFF-hoist-count` class for Wave 5 investigation.
  if (
    liveOnly.length === 0 && nativeOnly.length === 0 &&
    d.programRootEqual && d.hoistEqual === false &&
    isLiveHoistMisclassify(live.ast, native.ast, source)
  ) {
    return { class: "LIVE-HOIST-MISCLASSIFY", explained: true, detail: d };
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
  if (verdict.class === "LIVE-PHANTOM") {
    const fd = d.deepFirstDivergence;
    const idx = fd ? fd.index : "?";
    const nk = fd ? fd.nativeKind : "?";
    return "live admitted phantom `< Ident>` state opener (post-ident " +
      "non-terminator — SPEC §4.3 forbids); native correctly rejects per " +
      "P5-12b (S121). First deep divergence at i=" + idx +
      ": live=state native=" + nk +
      " (deep len live=" + (d.liveDeep ? d.liveDeep.length : "?") +
      " native=" + (d.nativeDeep ? d.nativeDeep.length : "?") + ")";
  }
  if (verdict.class === "LIVE-HOIST-MISCLASSIFY") {
    // Re-derive the per-axis diff from the hoist counts kept on the detail
    // record. summarizeDetail intentionally does NOT re-run the source-
    // witness counter — the verdict is the authoritative classification.
    const hf = [];
    for (const f of Object.keys(d.liveHoist || {})) {
      if (d.liveHoist[f] !== d.nativeHoist[f]) {
        hf.push(f + " live=" + d.liveHoist[f] + " native=" + d.nativeHoist[f]);
      }
    }
    return "live hoist scanner mis-classified the source — native count " +
      "matches the source-witness ground truth on every diverging axis " +
      "(corpus-sweep PLAN defers live-side fixes to M6). Diverging axes: " +
      hf.join("; ");
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
