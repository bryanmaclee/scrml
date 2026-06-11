// =============================================================================
// within-node-classifier.ts — M6.5.b.0
//
// Production-hardened within-node parity classifier for the M6.5 path-b
// adapter scoping. Walks two FileASTs in parallel (live BS+buildAST vs
// nativeParseFile) and classifies every position-aligned divergence per the
// SCOPING.md 7-class taxonomy:
//
//   KIND-NAME      — same logical position, different `.kind` string
//                    (e.g. `bare-expr` vs `sql`)
//   FIELD-SHAPE    — same kind + field name, different value
//                    (e.g. `closerForm: "inferred"` vs `"Inferred"`)
//   MISSING-FIELD  — field present on LIVE, absent on NATIVE
//   EXTRA-FIELD    — field present on NATIVE, absent on LIVE
//   COUNT-LENGTH   — array on both sides with different length
//                    (e.g. `typeDecls.length` 2 vs 0)
//   SPAN-COORD     — same logical structure, different `span.line/col/start/end`
//   NESTED-SHAPE   — same kind, one wraps in extra envelope
//                    (currently captured indirectly via MISSING/EXTRA-FIELD;
//                    reserved for future explicit detection)
//
// Plus a pseudo-class for pipeline failures:
//
//   PARSE-FAILURE  — at least one pipeline returned a malformed AST (null /
//                    undefined / `__crash` marker). No per-node diff is run;
//                    the FILE is recorded as a parse-failure and skipped.
//
// SISTER METRIC. This classifier is the within-node depth metric. The existing
// `compiler/tests/parser-conformance/dual-pipeline-canary.js` is the
// pipeline-shape (top-level + recursive kind sequence + hoist-count)
// surface metric. The two test suites consume the SAME corpus enumerator;
// `parser-conformance-corpus.test.js` and `parser-conformance-within-node
// .test.js` cover the orthogonal axes.
//
// API:
//   classifyDivergences(liveAST, nativeAST)
//       → { classCounts: Record<DivergenceClass, number>,
//           samples: Array<{ class, path, live, native, liveSummary,
//                            nativeSummary }> }
//
// PERFORMANCE. The walk is O(N) where N is total node count, iterative
// (stack-based) to avoid stack overflow on deep ASTs. Aim: <1ms per file on
// average. The full ~1000-file corpus completes in a few seconds.
//
// ALLOWLIST. Per-fixture residuals are subtracted by the test harness via
// `subtractAllowlist(classCounts, allowlistEntry)`. Allowlist baseline at
// `compiler/tests/parser-conformance-within-node-allowlist.json`.
//
// Originally adapted from the SCOPING agent's diagnostic at
// docs/changes/m65-path-b-adapter-scoping/tools/m65-ast-diff.js.
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 7 within-node divergence classes per SCOPING.md §1. */
export type DivergenceClass =
  | "KIND-NAME"
  | "FIELD-SHAPE"
  | "MISSING-FIELD"
  | "EXTRA-FIELD"
  | "COUNT-LENGTH"
  | "SPAN-COORD"
  | "NESTED-SHAPE"
  | "PARSE-FAILURE";

export type DivergenceClassCounts = Record<DivergenceClass, number>;

/** A single divergence finding. */
export interface DivergenceSample {
  class: DivergenceClass;
  path: string;
  live: string;
  native: string;
  liveSummary?: string;
  nativeSummary?: string;
}

/** Output of `classifyDivergences`. */
export interface ClassificationResult {
  classCounts: DivergenceClassCounts;
  samples: DivergenceSample[];
  /** True when one pipeline returned a malformed AST and the per-node walk
   *  was skipped. The single PARSE-FAILURE class-count entry is set. */
  parseFailed: boolean;
}

/** Per-fixture allowlist entry: pre-approved per-class residual count. */
export type AllowlistEntry = Partial<DivergenceClassCounts>;

/** Full allowlist file shape: filePath → AllowlistEntry. */
export type Allowlist = Record<string, AllowlistEntry>;

// ---------------------------------------------------------------------------
// Stripped fields — counter-derived / volatile / pipeline-only metadata that
// would drown the structural diff in renumbering noise.
// ---------------------------------------------------------------------------

const STRIP_KEYS: ReadonlySet<string> = new Set([
  "id",                       // node id counter — pipeline-specific renumbering
  "spans",                    // FileAST-root spans map — not per-node
  "_sourceText",              // raw source slice — pipeline-specific
  "_source",                  // legacy alias
  "_nativeEngineBlock",       // M6.6.b.2 walker escape hatch (native-only)
  "bodyStart",                // native LogicEscape/Meta bodyText host-start —
                              // a native-parser-internal raw-slice coordinate
                              // helper (parse-markup.js) the LIVE block tree
                              // has no analogue for. A retained channelDecls
                              // raw LogicEscape child surfaces it into the
                              // FileAST; it is pipeline-internal metadata, NOT
                              // a semantic divergence (native-cross-file-export
                              // ROOT-2).
  "armBodyChildren",          // g-formfor-in-match-arm (S177) — LIVE-only
                              // walkable per-arm body AST that ast-builder
                              // builds from a `match-block`'s `armsRaw` so the
                              // markup-expansion passes (CE / formFor / tableFor
                              // walkers) can reach a use-site inside a match arm.
                              // The native parser handles arm bodies via its own
                              // route (no `armsRaw` re-parse enrichment); this is
                              // a live-pipeline-internal expansion-support field
                              // with no native analogue, NOT a semantic
                              // divergence — both routes render identically.
  "_matchArmBodyForm",        // companion tag on each armBodyChildren wrapper
                              // (self-closing / shorthand / bare-body) — same
                              // live-only expansion-support metadata class.
  "openerEffectMalformed",    // S182 (Fix 1) — LIVE-only diagnostic-support flag
                              // on an engine-decl: `effect=` present on the
                              // opener but NOT in the required `${...}` logic-
                              // block form. Drives E-ENGINE-EFFECT-NOT-
                              // INTERPOLATED. The native parser has no opener
                              // `effect=` read at all (the open `effect=` opener
                              // native gap), so it never carries this flag; a
                              // live-pipeline-internal diagnostic field, NOT a
                              // semantic divergence.
  "openerEffectBadSlice",     // companion raw-text slice for the above message —
                              // same live-only diagnostic-support metadata class.
]);

// ---------------------------------------------------------------------------
// Type-of helpers
// ---------------------------------------------------------------------------

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Summary — compact one-line render of a value for diagnostic display.
// ---------------------------------------------------------------------------

function summary(v: unknown, depth: number = 2): string {
  if (v === null || v === undefined) return JSON.stringify(v);
  if (typeof v === "string") {
    return v.length > 50 ? JSON.stringify(v.slice(0, 50)) + "..." : JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (depth <= 0) return "[array len=" + v.length + "]";
    const kinds = v.slice(0, 3).map((x) => {
      if (isObj(x) && typeof x.kind === "string") return x.kind;
      return typeOf(x);
    });
    return "[array len=" + v.length + " kinds=" + JSON.stringify(kinds) + "]";
  }
  if (isObj(v)) {
    if (depth <= 0) return "{" + Object.keys(v).slice(0, 5).join(",") + "}";
    const keys = Object.keys(v).slice(0, 8);
    const inner = keys.map((k) => {
      const val = v[k];
      if (k === "kind") return "kind:" + JSON.stringify(val);
      if (typeof val === "string") {
        return k + ":" + (val.length > 24 ? '"' + val.slice(0, 24) + '..."' : JSON.stringify(val));
      }
      if (typeof val === "number" || typeof val === "boolean" || val === null) {
        return k + ":" + String(val);
      }
      if (Array.isArray(val)) return k + ":[" + val.length + "]";
      if (isObj(val)) return k + ":{" + Object.keys(val).slice(0, 3).join(",") + "}";
      return k + ":?";
    });
    return "{" + inner.join(",") + "}";
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// AST validity check — detect crash markers / null / undefined / non-object.
// The walker requires both sides to be non-null objects with the FileAST
// shape (`nodes`, `imports`, etc.); anything else is a PARSE-FAILURE.
// ---------------------------------------------------------------------------

function isMalformedAST(ast: unknown): boolean {
  if (ast === null || ast === undefined) return true;
  if (typeof ast !== "object") return true;
  if (Array.isArray(ast)) return true;
  // The diagnostic walker (m65-ast-diff.js) marks crashed parses with
  // { __crash: true }; preserve that convention.
  if ((ast as Record<string, unknown>).__crash === true) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Empty class-counts constant
// ---------------------------------------------------------------------------

function emptyClassCounts(): DivergenceClassCounts {
  return {
    "KIND-NAME": 0,
    "FIELD-SHAPE": 0,
    "MISSING-FIELD": 0,
    "EXTRA-FIELD": 0,
    "COUNT-LENGTH": 0,
    "SPAN-COORD": 0,
    "NESTED-SHAPE": 0,
    "PARSE-FAILURE": 0,
  };
}

// ---------------------------------------------------------------------------
// Iterative walker — replaces the recursive walker in m65-ast-diff.js with a
// stack-based walk. Avoids stack overflow on deep ASTs (the engine fixture
// already nests ~12 levels; quiz-app / dashboard go deeper). Each stack
// frame is `{ path, live, native }` — the value pair to diff at that path.
// ---------------------------------------------------------------------------

interface WalkFrame {
  path: string;
  live: unknown;
  native: unknown;
}

function walk(rootLive: unknown, rootNative: unknown): {
  classCounts: DivergenceClassCounts;
  samples: DivergenceSample[];
} {
  const classCounts = emptyClassCounts();
  const samples: DivergenceSample[] = [];
  const stack: WalkFrame[] = [{ path: "ast", live: rootLive, native: rootNative }];

  function record(
    klass: DivergenceClass,
    path: string,
    live: string,
    native: string,
    extra?: { liveSummary?: string; nativeSummary?: string },
  ): void {
    classCounts[klass] = classCounts[klass] + 1;
    samples.push({
      class: klass,
      path,
      live,
      native,
      liveSummary: extra?.liveSummary,
      nativeSummary: extra?.nativeSummary,
    });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { path, live, native } = frame;

    // Both absent — nothing to compare.
    if (live === undefined && native === undefined) continue;

    const lt = typeOf(live);
    const nt = typeOf(native);

    // Different top-level types — FIELD-SHAPE (no recursion into either side).
    if (lt !== nt) {
      record("FIELD-SHAPE", path, lt, nt, {
        liveSummary: summary(live),
        nativeSummary: summary(native),
      });
      continue;
    }

    // Arrays — positional compare + length tracking.
    if (lt === "array") {
      const liveArr = live as unknown[];
      const nativeArr = native as unknown[];
      if (liveArr.length !== nativeArr.length) {
        record(
          "COUNT-LENGTH",
          path,
          "len=" + liveArr.length,
          "len=" + nativeArr.length,
          { liveSummary: summary(liveArr, 1), nativeSummary: summary(nativeArr, 1) },
        );
      }
      const minLen = Math.min(liveArr.length, nativeArr.length);
      // Push in reverse so the first element is popped first (preserves
      // path-order traversal for sample readability).
      for (let i = minLen - 1; i >= 0; i--) {
        stack.push({ path: path + "[" + i + "]", live: liveArr[i], native: nativeArr[i] });
      }
      // Surface extras as MISSING / EXTRA per direction.
      for (let i = minLen; i < liveArr.length; i++) {
        record("MISSING-FIELD", path + "[" + i + "]", summary(liveArr[i]), "<absent>");
      }
      for (let i = minLen; i < nativeArr.length; i++) {
        record("EXTRA-FIELD", path + "[" + i + "]", "<absent>", summary(nativeArr[i]));
      }
      continue;
    }

    // Objects — KIND-NAME + per-key compare.
    if (lt === "object") {
      const liveObj = live as Record<string, unknown>;
      const nativeObj = native as Record<string, unknown>;

      // KIND-NAME divergence — same node position, different `.kind`.
      if (liveObj.kind !== nativeObj.kind) {
        record("KIND-NAME", path + ".kind", JSON.stringify(liveObj.kind), JSON.stringify(nativeObj.kind), {
          liveSummary: summary(liveObj, 1),
          nativeSummary: summary(nativeObj, 1),
        });
        // Still recurse into other fields — the kind mismatch does NOT halt
        // the walk (a stale path may still produce useful sibling findings).
      }

      const liveKeys: string[] = [];
      const nativeKeys = new Set<string>();
      for (const k of Object.keys(liveObj)) {
        if (!STRIP_KEYS.has(k)) liveKeys.push(k);
      }
      for (const k of Object.keys(nativeObj)) {
        if (!STRIP_KEYS.has(k)) nativeKeys.add(k);
      }
      const liveKeySet = new Set(liveKeys);

      for (const k of liveKeys) {
        if (!nativeKeys.has(k)) {
          record("MISSING-FIELD", path + "." + k, summary(liveObj[k]), "<absent>");
        } else {
          // Span gets special treatment — line/col differences are SPAN-COORD
          // (often not load-bearing); structural differences are SPAN-COORD
          // too but with a different shape signature.
          if (k === "span") {
            const ls = liveObj[k];
            const ns = nativeObj[k];
            if (isObj(ls) && isObj(ns)) {
              const lKeys = Object.keys(ls).sort().join(",");
              const nKeys = Object.keys(ns).sort().join(",");
              if (lKeys !== nKeys) {
                record("SPAN-COORD", path + ".span", lKeys, nKeys);
              } else if (
                ls.line !== ns.line ||
                ls.column !== ns.column ||
                ls.col !== ns.col ||
                ls.start !== ns.start ||
                ls.end !== ns.end
              ) {
                record("SPAN-COORD", path + ".span", JSON.stringify(ls), JSON.stringify(ns));
              }
            } else {
              stack.push({ path: path + "." + k, live: ls, native: ns });
            }
          } else {
            stack.push({ path: path + "." + k, live: liveObj[k], native: nativeObj[k] });
          }
        }
      }
      for (const k of nativeKeys) {
        if (!liveKeySet.has(k)) {
          record("EXTRA-FIELD", path + "." + k, "<absent>", summary(nativeObj[k]));
        }
      }
      continue;
    }

    // Primitive — direct compare.
    if (live !== native) {
      record("FIELD-SHAPE", path, JSON.stringify(live), JSON.stringify(native));
    }
  }

  return { classCounts, samples };
}

// ---------------------------------------------------------------------------
// classifyDivergences — the public API.
//
// Diff the two FileASTs and return per-class counts + samples. When either
// AST is malformed (one pipeline failed to parse), records a single
// PARSE-FAILURE pseudo-class entry and returns immediately with no per-node
// walk performed (the user code should treat parse-failure as a separate
// signal — the existing pipeline-shape canary catches crash divergences).
// ---------------------------------------------------------------------------

export function classifyDivergences(
  liveAST: unknown,
  nativeAST: unknown,
): ClassificationResult {
  if (isMalformedAST(liveAST) || isMalformedAST(nativeAST)) {
    const classCounts = emptyClassCounts();
    classCounts["PARSE-FAILURE"] = 1;
    return {
      classCounts,
      samples: [
        {
          class: "PARSE-FAILURE",
          path: "ast",
          live: isMalformedAST(liveAST) ? "<malformed>" : "<ok>",
          native: isMalformedAST(nativeAST) ? "<malformed>" : "<ok>",
        },
      ],
      parseFailed: true,
    };
  }

  const { classCounts, samples } = walk(liveAST, nativeAST);
  return { classCounts, samples, parseFailed: false };
}

// ---------------------------------------------------------------------------
// subtractAllowlist — subtract a per-fixture allowlist entry from the raw
// class counts. Returns the residual (post-allowlist) counts. Floor at 0 so
// an allowlist entry larger than the actual count does NOT go negative —
// the residual surface is "this class IMPROVED" and we want it visible as
// "0 over threshold" rather than a confusing negative.
//
// Note: shrinkage (allowlist > current) is itself a signal — a FIX-NATIVE
// landing has CLOSED divergences that were previously baseline. The test
// harness can detect that via the raw `classCounts` vs the allowlist; this
// helper just produces the gate-check residual.
// ---------------------------------------------------------------------------

export function subtractAllowlist(
  classCounts: DivergenceClassCounts,
  allowlistEntry: AllowlistEntry | undefined,
): DivergenceClassCounts {
  const residual = emptyClassCounts();
  for (const klass of Object.keys(classCounts) as DivergenceClass[]) {
    const raw = classCounts[klass];
    const allow = allowlistEntry?.[klass] ?? 0;
    const r = raw - allow;
    residual[klass] = r > 0 ? r : 0;
  }
  return residual;
}

// ---------------------------------------------------------------------------
// sumClassCounts — aggregate counts across multiple files. Used by the
// corpus-level report.
// ---------------------------------------------------------------------------

export function sumClassCounts(
  totals: DivergenceClassCounts,
  add: DivergenceClassCounts,
): DivergenceClassCounts {
  const out = emptyClassCounts();
  for (const klass of Object.keys(out) as DivergenceClass[]) {
    out[klass] = totals[klass] + add[klass];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Re-export the constant constructor for test harnesses.
// ---------------------------------------------------------------------------

export { emptyClassCounts };
