import { classifyFileShape } from "./library-shape.js";

/**
 * compute-pgo-flags — downstream pre-codegen passes: the 4 PGO has* flags, and
 * the §21.5 / §38.12.6 / §40.8 file-shape classification (`computeFileShape`).
 *
 * Relocated S115 (DD #27 / F5 / Pivot 2) out of `ast-builder.js`'s TAB-time
 * FileAST assembly into a pipeline-agnostic post-AST / pre-codegen pass. The
 * native parser (v0.6) feeds this its own top-level node stream with no
 * further change — the pass is a PURE function of `nodes`.
 *
 * It computes the 4 codegen-optimizer presence booleans:
 *   - `hasResetExpr`        — any `reset-expr` node anywhere in the AST.
 *   - `hasEqualityExpr`     — any binary `==`/`!=` node anywhere in the AST.
 *   - `hasChunkedMarkupTag` — any markup node with a chunk-activating tag.
 *   - `hasForStmt`          — any `for-stmt` node anywhere in the AST.
 *
 * These gate runtime-chunk emission in `codegen/emit-client.ts:detectRuntimeChunks`.
 *
 * `hasProgramRoot` is NOT computed here — it is the raw structural observation
 * each parser makes at assembly time and stays there. What IS computed here is
 * `fileShape`, the classification BUILT on it (see `computeFileShape` below).
 * ⛑ This paragraph previously read *"`hasProgramRoot` … drives
 * `isPureModuleFile` / `isNonEntryPageFile` and stays there"* — both of those
 * predicates are gone, replaced by `library-shape.js:classifyFileShape`.
 *
 * Walk shape, sentinels, early-exit and conservatism semantics are transplanted
 * VERBATIM from the original `detectResetExprPresence` /
 * `detectEqualityExprPresence` / `detectMarkupForStmtChunkPresence` functions —
 * zero behavioral change.
 */

/**
 * PGO P3.B follow-up (Option 2, S102) — detect whether the assembled AST
 * contains at least one `reset-expr` node anywhere in its ExprNode subtrees.
 * Result is consumed by `detectRuntimeChunks` in `codegen/emit-client.ts`,
 * which previously ran a per-node ExprNode probe descent looking for
 * `reset-expr` presence — the largest residual sub-component of
 * detect-runtime-chunks cost after P3.B.
 *
 * **Walk shape:** single-pass DFS. Iterates every node's enumerable keys
 * (excluding `span` / `id` / `_scope` metadata), descends into array elements
 * and into nested objects that carry a `kind` string. The cheap
 * `kind === "reset-expr"` test fires the sentinel on first match.
 *
 * **Conservatism:** false-negatives MUST NOT happen — a missed `reset-expr`
 * would cause `detectRuntimeChunks` to omit the `reset` chunk and break
 * runtime. False-positives are harmless. The walker descends into every object
 * child including ExprNode fields, so any reset-expr reachable is detected.
 */
const RESET_EXPR_SENTINEL = Symbol("RESET_EXPR_PRESENT");
function detectResetExprPresence(nodes: any[]): boolean {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  // Throw-sentinel short-circuit: JS engines handle a single thrown
  // primitive cheaply, and this lets us bail the entire DFS the moment
  // the first reset-expr is found. The catch outside the loop re-asserts
  // boolean true. Any non-sentinel error rethrows.
  function visit(node: any): void {
    if (!node || typeof node !== "object") return;
    if (node.kind === "reset-expr") {
      throw RESET_EXPR_SENTINEL;
    }
    for (const key in node) {
      // Skip span / id / pure-metadata fields. `kind` is a string and
      // skipped naturally by the object-check below.
      if (key === "span" || key === "id" || key === "_scope") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (item && typeof item === "object") visit(item);
        }
      } else if (val && typeof val === "object" && typeof val.kind === "string") {
        visit(val);
      }
    }
  }
  try {
    for (const n of nodes) visit(n);
  } catch (e) {
    if (e === RESET_EXPR_SENTINEL) return true;
    throw e;
  }
  return false;
}

/**
 * PGO Phase 3 follow-up C1 (S106) — sibling pattern to detectResetExprPresence.
 * Detects whether the assembled AST contains at least one binary `==` or `!=`
 * expression anywhere in its ExprNode subtrees.
 *
 * Result is consumed by `detectRuntimeChunks` in `codegen/emit-client.ts`,
 * which gates the `equality` runtime chunk.
 *
 * **Conservatism:** false-negatives MUST NOT happen — a missed `==` would
 * cause `detectRuntimeChunks` to omit the `equality` chunk and break
 * `_scrml_structural_eq` references in emitted client JS. False-positives are
 * harmless.
 */
const EQUALITY_EXPR_SENTINEL = Symbol("EQUALITY_EXPR_PRESENT");
function detectEqualityExprPresence(nodes: any[]): boolean {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  function visit(node: any): void {
    if (!node || typeof node !== "object") return;
    if (node.kind === "binary" && (node.op === "==" || node.op === "!=")) {
      throw EQUALITY_EXPR_SENTINEL;
    }
    for (const key in node) {
      if (key === "span" || key === "id" || key === "_scope") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (item && typeof item === "object") visit(item);
        }
      } else if (val && typeof val === "object" && typeof val.kind === "string") {
        visit(val);
      }
    }
  }
  try {
    for (const n of nodes) visit(n);
  } catch (e) {
    if (e === EQUALITY_EXPR_SENTINEL) return true;
    throw e;
  }
  return false;
}

/**
 * PGO Phase 3 follow-up C2 (S108) — fused presence walker for the markup +
 * for-stmt chunk gates inside `detectRuntimeChunks` in `codegen/emit-client.ts`.
 *
 * Returns `{ hasChunkedMarkupTag, hasForStmt }`:
 *   - `hasChunkedMarkupTag` is true iff the file has at least one markup node
 *     with tag in {timer, poll, timeout, keyboard, mouse, gamepad}. These tags
 *     are the ONLY markup tags that activate runtime chunks (timers / input)
 *     inside `detectFromNode`'s `case "markup"`. `<channel>` is NOT in the set
 *     — channel uses inline WebSocket code with no runtime-chunk activation.
 *   - `hasForStmt` is true iff the file has at least one for-stmt node anywhere.
 *     CONSERVATIVE — the walker does not test iter-reactivity here (that check
 *     requires the function-body registry which is only available at codegen
 *     time). A for-stmt with a non-reactive iter still sets the flag;
 *     `detectRuntimeChunks` then performs the per-node iter-reactivity check.
 *     When this flag is `false`, the file is guaranteed to contain NO for-stmt.
 *
 * **Conservatism:** false-negatives MUST NOT happen. False-positives are
 * harmless (just the in-walk probe doing its existing work).
 */
const MARKUP_FOR_STMT_SENTINEL = Symbol("MARKUP_FOR_STMT_BOTH_PRESENT");
const CHUNKED_MARKUP_TAGS = new Set([
  "timer", "poll", "timeout",         // → chunks.add("timers") + chunks.add("deep_reactive")
  "keyboard", "mouse", "gamepad",     // → chunks.add("input")
  "request",                          // → chunks.add("deep_reactive") (request-state-render-bridge)
]);
function detectMarkupForStmtChunkPresence(
  nodes: any[],
): { hasChunkedMarkupTag: boolean; hasForStmt: boolean } {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { hasChunkedMarkupTag: false, hasForStmt: false };
  }
  let hasChunkedMarkupTag = false;
  let hasForStmt = false;
  function visit(node: any): void {
    if (!node || typeof node !== "object") return;
    const kind = node.kind;
    if (!hasChunkedMarkupTag && kind === "markup" && typeof node.tag === "string" && CHUNKED_MARKUP_TAGS.has(node.tag)) {
      hasChunkedMarkupTag = true;
    } else if (!hasForStmt && kind === "for-stmt") {
      hasForStmt = true;
    }
    // Both flags set — bail the entire DFS via sentinel.
    if (hasChunkedMarkupTag && hasForStmt) {
      throw MARKUP_FOR_STMT_SENTINEL;
    }
    for (const key in node) {
      if (key === "span" || key === "id" || key === "_scope") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (item && typeof item === "object") visit(item);
        }
      } else if (val && typeof val === "object" && typeof val.kind === "string") {
        visit(val);
      }
    }
  }
  try {
    for (const n of nodes) visit(n);
  } catch (e) {
    if (e === MARKUP_FOR_STMT_SENTINEL) {
      return { hasChunkedMarkupTag: true, hasForStmt: true };
    }
    throw e;
  }
  return { hasChunkedMarkupTag, hasForStmt };
}

export interface PGOFlags {
  hasResetExpr: boolean;
  hasEqualityExpr: boolean;
  hasChunkedMarkupTag: boolean;
  hasForStmt: boolean;
}

/**
 * Compute the 4 PGO has* flags from a top-level AST node stream.
 *
 * PURE — `nodes` in, derived object out; mutates nothing. The caller (the
 * pre-codegen seam in `api.js`) assigns the result onto the FileAST so the
 * existing `fileAST.has*` consumer reads are unchanged.
 *
 * @param nodes Top-level AST nodes (live `buildAST` output or native-parser).
 */
export function computePGOFlags(nodes: any[]): PGOFlags {
  const hasResetExpr = detectResetExprPresence(nodes);
  const hasEqualityExpr = detectEqualityExprPresence(nodes);
  const { hasChunkedMarkupTag, hasForStmt } = detectMarkupForStmtChunkPresence(nodes);
  return { hasResetExpr, hasEqualityExpr, hasChunkedMarkupTag, hasForStmt };
}

// ---------------------------------------------------------------------------
// File-shape classification — the same relocation shape, for the same reason.
// ---------------------------------------------------------------------------

/**
 * Stamp the §21.5 / §38.12.6 / §40.8 FILE SHAPE onto a FileAST.
 *
 * PURE-of-its-inputs, mutating only the FileAST slot — same contract as
 * `computePGOFlags` above, and it lives here for the same S115 reason: a derived
 * FileAST field that BOTH pipelines must carry belongs at the pipeline-agnostic
 * PRECG seam, not in either parser's assembly. The M5 native parser gets
 * `fileShape` with no mirrored predicate to maintain and no divergence to
 * allowlist.
 *
 * ⚑ The TAB (`ast-builder.js`) independently CALLS `classifyFileShape` to decide
 * `W-PROGRAM-001`, because that is a TAB-time diagnostic. It does not stamp.
 * Both call sites use this one classifier over the same top-level `nodes` — the
 * PRECG seam runs before CE, the first pass that can mutate them — so the
 * warning and the FIRST stamp cannot disagree.
 *
 * ⚑ That is a statement about THIS seam only. CE rebuilds the FileAST with new
 * `nodes`, and CHX inlining turns a channel-alias reference into a `<channel>`
 * markup node — a shape-class change (measured: `bare-markup` -> `pure-channel`
 * on a top-level channel-alias mount). `component-expander.ts` RE-STAMPS the
 * field there so post-CE consumers do not read this pre-CE answer.
 *
 * ⚑ `fileShape` is NOT "is this file the application entry". Per SPEC §40.8 the
 * entry is *"the file resolved by the build root"*, a BUILD fact. See the
 * `library-shape.js` module header.
 *
 * @param fileAST A FileAST from either pipeline; `nodes` + `hasProgramRoot` are read.
 */
export function computeFileShape(fileAST: any): void {
  if (!fileAST || typeof fileAST !== "object") return;
  fileAST.fileShape = classifyFileShape(
    fileAST.nodes ?? [],
    fileAST.hasProgramRoot === true,
  );
}
