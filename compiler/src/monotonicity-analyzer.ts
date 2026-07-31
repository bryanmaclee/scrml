/**
 * Monotonicity Analyzer — Stage 5.5 (A9 Ext 5).
 *
 * Implements SPEC §19.9.6 static monotonicity classification + idempotency-key
 * replay safety (S5 of the body-split soundness predicate set).
 *
 * Classifies each CPS-eligible function's server-stmt batch as
 * `"monotone"`, `"non-monotone"`, or `"machine-intrinsic"`. Operates per
 * `RouteMap.functions[fnId].cpsSplit.serverStmtIndices`. Verdict is attached
 * to `cpsSplit.monotonicity`; downstream codegen consults it to decide
 * whether to emit the `Idempotency-Key` envelope (client wrapper) and the
 * dedup middleware (server stub).
 *
 * Conservative classification (per SPEC §19.9.6 paragraph 1): in cases of
 * static ambiguity, the verdict SHALL be `"non-monotone"`. False positives
 * (extra keys emitted) are the safe direction; false negatives (key elided
 * when needed) would violate S5.
 *
 * Cross-references:
 *   - SPEC §19.9.6 — primary normative spec (rules a-f).
 *   - SPEC §19.9.7 — `.idempotent()` modifier override (developer assertion).
 *   - SPEC §51.0.G — `<machine>` `.advance()` intrinsic-monotone leg.
 *   - PIPELINE.md Stage 5.5 — input/output contract.
 *   - compiler/src/route-inference.ts — CPSSplit shape this analyzer extends.
 *   - compiler/src/idempotency-store-resolver.ts — backend resolution helper.
 */

import type { CPSSplit, FunctionRoute, RouteMap } from "./route-inference.ts";
import { exprNodeContainsCall } from "./expression-parser.ts";

// ---------------------------------------------------------------------------
// Pure-fn lookup surface (D3, S81)
// ---------------------------------------------------------------------------

/**
 * Minimal shape needed for fn-purity lookup. Mirrors `FunctionIndexEntry` from
 * `route-inference.ts` but typed structurally here so the analyzer doesn't
 * pull in RI's full module. Caller builds via `buildFunctionIndex(files)` in
 * route-inference.ts and passes the Map to `analyzeMonotonicity`.
 */
export interface FunctionPurityLookup {
  /** Function name → array of declaration entries (multi-file resolution). */
  get(name: string): Array<{ fnNode: { fnKind?: string } }> | undefined;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A monotonicity verdict for a single CPS-eligible server-stmt batch.
 *
 * - `"monotone"` — every statement falls in the §19.9.6 (a)-(e) whitelist:
 *   read-only SELECT, INSERT-without-readback, monotone UPDATE
 *   (assignment-only-of-literals), DELETE, or pure-fn call.
 * - `"non-monotone"` — at least one statement falls outside (a)-(f), OR is
 *   conservatively unrecognized (the safe default).
 * - `"machine-intrinsic"` — the entire batch is bounded by a single
 *   `<machine>` `.advance(.X)` call whose §51 allowed-from-states guard
 *   makes the transition idempotent under repeated application.
 */
export type MonotonicityVerdict =
  | "monotone"
  | "non-monotone"
  | "machine-intrinsic";

/**
 * Diagnostic emitted by the analyzer (info-level only; static-rejection
 * diagnostics are emitted by TS Stage 6 because they need resolved
 * `<program>` ancestry context).
 */
export interface MonotonicityDiagnostic {
  /** §34 catalog code: D-CPS-MONOTONE / D-CPS-MACHINE-INTRINSIC-MONOTONE / D-CPS-IDEMPOTENT-OVERRIDE. */
  code: string;
  message: string;
  /** Function-node id whose batch produced the diagnostic. */
  functionNodeId: string;
  /**
   * Ext 1 M1.4 — index of the CPS batch (into `CPSSplit.serverBatches`) that
   * produced this diagnostic. Per-batch diagnostics (D-CPS-MONOTONE,
   * D-CPS-MACHINE-INTRINSIC-MONOTONE) carry the batch index so a multi-batch
   * function can surface one diagnostic per batch. Function-wide diagnostics
   * (D-CPS-IDEMPOTENT-OVERRIDE — the `.idempotent()` modifier dominates every
   * batch) omit it.
   */
  batchIndex?: number;
}

/** Output of `analyzeMonotonicity`. */
export interface MonotonicityAnalysis {
  /**
   * Per-function monotonicity verdict (only entries for functions with
   * non-null cpsSplit).
   *
   * Back-compat aggregate (Ext 1 M1.4): retained as the function-level
   * surface for consumers that still want one answer per function — api.js
   * Stage 5.5 diagnostics + the verbose tally, type-system.ts
   * E-CPS-NONIDEM-NO-STORAGE. Aggregation is a conservative max over the
   * per-batch verdicts: non-monotone dominates (see
   * `classifyFunctionMonotonicity`).
   */
  verdicts: Map<string /* functionNodeId */, MonotonicityVerdict>;
  /**
   * Per-batch monotonicity verdicts (Ext 1 — multi-batch CPS shape). One
   * verdict per `CPSSplit.serverBatches` entry, in source order.
   *
   * THE LOAD-BEARING SURFACE as of M1.4: each batch is classified
   * independently by `classifyBatchMonotonicity`, so a monotone batch in a
   * function with a non-monotone sibling no longer pays the idempotency-key
   * tax. The same verdict is also written onto each `CPSBatch.monotonicity`
   * for direct Stage 8 codegen consumption.
   */
  batchVerdicts: Map<string /* functionNodeId */, MonotonicityVerdict[]>;
  /** Info-level diagnostics; `--verbose`-only for D-CPS-MONOTONE. */
  diagnostics: MonotonicityDiagnostic[];
}

// ---------------------------------------------------------------------------
// Statement-shape predicates (§19.9.6 (a)-(f))
// ---------------------------------------------------------------------------

/**
 * Loose AST node alias for the statement walker. We only read a small set of
 * structural fields; everything else is opaque.
 */
type ASTNode = Record<string, unknown>;

/** SQL command verbs we recognize at the start of a `?{}` query string. */
const SQL_READ_ONLY_VERBS = new Set(["select", "with"]);

/** Mutating SQL verbs we have specific monotone-or-not analysis for. */
const SQL_MUTATING_VERBS = new Set(["insert", "update", "delete", "replace"]);

/**
 * Tokenize a SQL query string's leading verb. Lowercased; whitespace-/comment-
 * stripped. Returns null when the query is empty or unparseable.
 */
function leadingSqlVerb(query: string): string | null {
  if (typeof query !== "string") return null;
  // Strip leading whitespace + line/block comments.
  let s = query.replace(/^\s+/, "");
  while (true) {
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1).replace(/^\s+/, "");
      continue;
    }
    if (s.startsWith("/*")) {
      const close = s.indexOf("*/");
      s = close === -1 ? "" : s.slice(close + 2).replace(/^\s+/, "");
      continue;
    }
    break;
  }
  const m = s.match(/^([a-z_]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Heuristic non-determinism detector. Scans a SQL query string for known
 * non-deterministic functions whose presence makes a batch non-monotone.
 *
 * Conservative: any match → non-deterministic. False-positive matches inside
 * string literals (e.g., `'NOW()'` literal) are tolerated — they bias toward
 * non-monotone, the safe direction.
 */
function sqlMentionsNonDeterminism(query: string): boolean {
  if (typeof query !== "string") return false;
  // Case-insensitive scan for canonical non-deterministic functions.
  const re = /\b(now|current_timestamp|current_date|current_time|random|gen_random_uuid|uuid_generate_v4|sysdate|getdate|nextval|currval|lastval|lastval_seq)\s*\(/i;
  return re.test(query);
}

/**
 * UPDATE-statement monotonicity detector. A `SET col = expr` clause is
 * monotone iff `expr` does NOT reference the column being assigned (or any
 * other column from the same row in a self-referencing way).
 *
 * Heuristic: parse the SET clause, extract column-name = expression pairs,
 * and check whether each expression mentions the column on the left.
 *
 * Conservative: ambiguous parses (subqueries, complex expressions) return
 * `false` (non-monotone).
 */
function updateIsMonotone(query: string): boolean {
  if (typeof query !== "string") return false;
  // Locate the SET clause.
  const setMatch = query.match(/\bset\b\s+(.*?)(?:\bwhere\b|\breturning\b|\bfrom\b|;|$)/is);
  if (!setMatch) return false;
  const setClause = setMatch[1];

  // Split into top-level comma-delimited assignments.
  // Naive split — does NOT handle nested parens. Conservative: complex
  // multi-paren clauses fall through to non-monotone.
  if (setClause.includes("(")) {
    // Bail on subqueries / function calls — too ambiguous to classify
    // safely. Caller defaults to non-monotone.
    return false;
  }
  const parts = setClause.split(/\s*,\s*/);
  for (const part of parts) {
    const m = part.match(/^\s*([a-z_][\w]*)\s*=\s*(.+?)\s*$/i);
    if (!m) return false; // unparseable
    const col = m[1].toLowerCase();
    const expr = m[2];
    // Self-reference: `col = col + 1`, `col = col`, etc.
    const refRe = new RegExp(`\\b${col}\\b`, "i");
    if (refRe.test(expr)) return false;
    // RHS-of-other-column-from-same-row: e.g., `a = b + 1` where b is also
    // a column in the same row. Conservative: we can't always know without
    // schema; treat any bareword RHS that isn't a literal/parameter as
    // potentially non-monotone. Heuristic: if RHS contains an unquoted
    // identifier that isn't a SQL keyword or numeric/string literal, treat
    // as non-monotone.
    const exprNorm = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, "\"\"");
    // Pull out bareword identifiers (not preceded by $ for parameter, not
    // a number).
    const idents = exprNorm.match(/\b[a-z_][\w]*\b/gi) ?? [];
    const KEYWORDS = new Set(["null", "true", "false", "and", "or", "not", "is", "in", "like", "between", "case", "when", "then", "else", "end"]);
    for (const id of idents) {
      if (KEYWORDS.has(id.toLowerCase())) continue;
      // An identifier that survives normalization is likely a column ref;
      // treat as potentially-self-referencing → non-monotone.
      return false;
    }
  }
  return true;
}

/**
 * INSERT-statement monotonicity detector. INSERT is monotone iff:
 *   - There is no `RETURNING` clause that reads back an auto-increment col.
 *   - The VALUES expressions don't mention non-deterministic functions.
 *
 * Conservative: when in doubt, return false.
 */
function insertIsMonotone(query: string): boolean {
  if (typeof query !== "string") return false;
  // RETURNING clause — likely reads back auto-increment id; treat as non-monotone.
  if (/\breturning\b/i.test(query)) return false;
  // Non-determinism scan.
  if (sqlMentionsNonDeterminism(query)) return false;
  // ON CONFLICT DO UPDATE — semantics depend on the update expression. The
  // conservative classifier flags this; .idempotent() is the developer's
  // escape hatch.
  if (/\bon\s+conflict\b/i.test(query)) return false;
  return true;
}

/**
 * DELETE-statement monotonicity detector. DELETE is monotone iff it has no
 * non-deterministic predicates.
 */
function deleteIsMonotone(query: string): boolean {
  if (typeof query !== "string") return false;
  if (sqlMentionsNonDeterminism(query)) return false;
  return true;
}

/**
 * SELECT-statement monotonicity detector. SELECT is read-only — always
 * monotone (unless it triggers side effects via, e.g., `SELECT pg_sleep(...)`,
 * which we conservatively flag via non-determinism scan).
 */
function selectIsMonotone(query: string): boolean {
  if (typeof query !== "string") return false;
  if (sqlMentionsNonDeterminism(query)) return false;
  return true;
}

/**
 * Classify a single SQL block. Returns `"monotone"` or `"non-monotone"`.
 * No `"machine-intrinsic"` here — that's a function-decl-level concept.
 */
function classifySqlNode(sqlNode: ASTNode): MonotonicityVerdict {
  const query = sqlNode.query as string | undefined;
  if (!query) return "non-monotone";
  const verb = leadingSqlVerb(query);
  if (verb === null) return "non-monotone";
  if (SQL_READ_ONLY_VERBS.has(verb)) {
    return selectIsMonotone(query) ? "monotone" : "non-monotone";
  }
  if (verb === "insert") return insertIsMonotone(query) ? "monotone" : "non-monotone";
  if (verb === "update") return updateIsMonotone(query) ? "monotone" : "non-monotone";
  if (verb === "delete") return deleteIsMonotone(query) ? "monotone" : "non-monotone";
  // Other verbs (TRUNCATE, MERGE, REPLACE, CREATE, etc.) — conservative.
  return "non-monotone";
}

/**
 * Walk an arbitrary AST sub-tree looking for the first SQL node, if any.
 * Used to find the SQL inside a state-decl init or a bare-expr.
 */
function findSqlNode(node: unknown): ASTNode | null {
  if (!node || typeof node !== "object") return null;
  const n = node as ASTNode;
  if (n.kind === "sql") return n;
  // The ast-builder attaches `sqlNode` as a sibling field on state-decls
  // whose init is an SQL expression.
  if (n.sqlNode && typeof n.sqlNode === "object") return n.sqlNode as ASTNode;
  // Search well-known descendant fields.
  for (const key of ["init", "exprNode", "value", "expression"] as const) {
    const child = n[key];
    if (child && typeof child === "object") {
      const found = findSqlNode(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Detect a bare `<machine>` `.advance(...)` call shape in a statement node.
 * Returns true iff the statement is JUST an `.advance` call (no other
 * effects in the same statement).
 *
 * Heuristic: the statement is a `bare-expr` whose `exprNode` is a `call`
 * whose callee is a `member` whose property name is `advance`. Conservative:
 * any deviation → false (caller continues other classification).
 */
function isMachineAdvanceCall(stmt: ASTNode): boolean {
  if (!stmt || typeof stmt !== "object") return false;
  if (stmt.kind !== "bare-expr") return false;
  const exprNode = stmt.exprNode as ASTNode | undefined;
  if (!exprNode || exprNode.kind !== "call") return false;
  const callee = exprNode.callee as ASTNode | undefined;
  if (!callee || callee.kind !== "member") return false;
  const prop = callee.property as ASTNode | undefined;
  if (!prop) return false;
  const propName = (prop.name as string | undefined) ?? (prop as ASTNode).text as string | undefined;
  return propName === "advance";
}

// ---------------------------------------------------------------------------
// Per-batch + per-function classification
// ---------------------------------------------------------------------------

/**
 * Classify a SINGLE CPS server batch (Ext 1 M1.4 — per-batch lift).
 *
 * This is the per-batch core of the classifier. Where the pre-M1.4 shape
 * classified an entire function's flattened server-stmt set as one verdict,
 * Ext 1 multi-batch CPS gives each batch its own independent verdict — a
 * monotone batch in an otherwise-non-monotone function no longer pays the
 * idempotency-key tax (SPEC §19.9.6; soundness DD §B.4 — finer-grain, S5
 * STRENGTHENED).
 *
 * Algorithm (per SPEC §19.9.6) — applied to ONE batch's `indices`:
 *   1. If the function-decl carries `.idempotent()` modifier (§19.9.7),
 *      verdict = "monotone" (developer assertion override — function-wide,
 *      so it dominates every batch).
 *   2. If the entire batch is bounded by a single `<machine>` `.advance(.X)`
 *      call → verdict = "machine-intrinsic".
 *   3. Walk every server-stmt index in this batch; classify each per (a)-(e):
 *        - SELECT-only / read-only → monotone
 *        - INSERT without auto-readback / non-deterministic RHS → monotone
 *        - UPDATE assignment-only-of-literals → monotone
 *        - DELETE without non-deterministic predicates → monotone
 *        - pure-fn call (S81 D3) — bare-expr whose callee resolves to fn-kind
 *      Any non-monotone → batch verdict = "non-monotone".
 *   4. All-monotone → verdict = "monotone".
 *
 * @param fnNode          the enclosing function-decl AST node (read for the
 *                        `idempotentModifier` flag + `body[]`).
 * @param batchIndices    the body indices belonging to THIS batch
 *                        (`CPSBatch.indices`), in any order.
 * @param functionIndex   pure-fn lookup map (S81 D3); may be null.
 */
function classifyBatchMonotonicity(
  fnNode: ASTNode,
  batchIndices: number[],
  functionIndex: FunctionPurityLookup | null,
): MonotonicityVerdict {
  // Step 1: .idempotent() override (function-wide — every batch monotone).
  if (fnNode.idempotentModifier === true) {
    return "monotone";
  }

  const body = (fnNode.body as ASTNode[] | undefined) ?? [];
  const serverStmts = batchIndices
    .map((i) => body[i])
    .filter((s) => s !== undefined && s !== null);

  if (serverStmts.length === 0) {
    // No server statements in this batch? Treat as monotone (vacuous; no
    // replay risk).
    return "monotone";
  }

  // Step 2: machine-intrinsic? Single-statement batch that is just .advance().
  if (serverStmts.length === 1 && isMachineAdvanceCall(serverStmts[0])) {
    return "machine-intrinsic";
  }

  // Step 3: classify each statement.
  for (const stmt of serverStmts) {
    const verdict = classifyStatement(stmt, functionIndex);
    if (verdict !== "monotone") {
      return "non-monotone";
    }
  }

  // Step 4: all monotone.
  return "monotone";
}

/**
 * Classify a CPS-eligible function as a whole — the function-level wrapper
 * retained for back-compat (Ext 1 M1.4).
 *
 * Aggregates the per-batch verdicts (`classifyBatchMonotonicity`) into one
 * function-level verdict for consumers that still want a single answer
 * (api.js Stage 5.5 tally, type-system.ts E-CPS-NONIDEM-NO-STORAGE, the
 * `classifyFunctionMonotonicityForTest` export). Aggregation rule — the
 * function pays the idempotency-key tax iff ANY batch needs it:
 *   - any batch "non-monotone" → function "non-monotone".
 *   - else any batch "machine-intrinsic" → function "machine-intrinsic"
 *     (the §51 intrinsic-monotone leg; still key-free).
 *   - else → "monotone".
 * This conservative max preserves the pre-M1.4 single-stub gating: while the
 * function still emits one CPS stub (M1.5 splits it into N stubs), that stub
 * serves every batch's work and must carry the key if any batch is unsafe.
 */
function classifyFunctionMonotonicity(
  fnNode: ASTNode,
  cpsSplit: CPSSplit,
  functionIndex: FunctionPurityLookup | null,
): MonotonicityVerdict {
  // .idempotent() override short-circuits — every batch monotone.
  if (fnNode.idempotentModifier === true) {
    return "monotone";
  }

  const batches = cpsSplit.serverBatches;
  if (batches.length === 0) {
    // No batches → no server work → vacuously monotone.
    return "monotone";
  }

  let sawMachineIntrinsic = false;
  for (const batch of batches) {
    const verdict = classifyBatchMonotonicity(fnNode, batch.indices, functionIndex);
    if (verdict === "non-monotone") {
      // Non-monotone dominates — the function pays the key tax.
      return "non-monotone";
    }
    if (verdict === "machine-intrinsic") {
      sawMachineIntrinsic = true;
    }
  }

  return sawMachineIntrinsic ? "machine-intrinsic" : "monotone";
}

/**
 * S81 D3 (2026-05-11) — pure-fn-call detection (SPEC §19.9.6 rule e).
 *
 * Returns true when `stmt` is a `bare-expr` whose `exprNode` is a `call`
 * where:
 *   - the callee is a bare `IdentExpr` (no member-access — conservative;
 *     method-purity tracking is not available today).
 *   - all `FunctionIndexEntry`s for the callee's name have `fnKind === "fn"`
 *     (per §48: `fn` body is statically pure — no SQL, no broadcast, no
 *     non-fn calls, no async). If ANY entry is `function`-kind, the call may
 *     resolve to a non-pure variant at runtime; classify conservatively.
 *   - no argument expression contains any nested `call` (a nested call could
 *     resolve to a non-pure callee — recursive analysis is a future
 *     refinement). Args that are literals / `@cell` reads / bare idents /
 *     binary / unary / ternary / array / object are accepted.
 *
 * When the lookup map is unavailable (null), returns false (conservative;
 * preserves the pre-D3 behavior for test paths that don't supply the index).
 */
function isPureFnCallStatement(
  stmt: ASTNode,
  functionIndex: FunctionPurityLookup | null,
): boolean {
  if (!functionIndex) return false;
  if (!stmt || typeof stmt !== "object") return false;
  if (stmt.kind !== "bare-expr") return false;
  const exprNode = stmt.exprNode as ASTNode | undefined;
  if (!exprNode || exprNode.kind !== "call") return false;
  const callee = exprNode.callee as ASTNode | undefined;
  if (!callee || callee.kind !== "ident") return false;
  const calleeName = callee.name as string | undefined;
  if (typeof calleeName !== "string" || calleeName.length === 0) return false;
  const entries = functionIndex.get(calleeName);
  if (!entries || entries.length === 0) return false;
  // Every matching entry must be fn-kind (per §48).
  for (const entry of entries) {
    if (entry.fnNode.fnKind !== "fn") return false;
  }
  // Args must contain no nested calls AND no SQL sub-trees.
  //   - `exprNodeContainsCall` rejects nested calls (could resolve to
  //     non-pure callees — recursive analysis is a future refinement).
  //   - `findSqlNode` walks well-known descendant fields looking for SQL
  //     AST nodes. A bare-expr like `pureFn(?{INSERT ... RETURNING id})`
  //     must NOT be classified monotone — the SQL arg is the replay hazard,
  //     not the pureFn call wrapper. `findSqlNode` only descends through
  //     init/exprNode/value/expression by default; call args don't match
  //     those keys, so we call it explicitly on each arg here.
  const args = (exprNode.args as unknown[] | undefined) ?? [];
  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;
    if (exprNodeContainsCall(arg as never)) return false;
    if (findSqlNode(arg)) return false;
  }
  return true;
}

/**
 * Classify a single server-side statement. Returns "monotone" or
 * "non-monotone" (machine-intrinsic is function-batch-scoped, not per-stmt).
 */
function classifyStatement(
  stmt: ASTNode,
  functionIndex: FunctionPurityLookup | null,
): MonotonicityVerdict {
  if (!stmt || typeof stmt !== "object") return "non-monotone";

  // SQL node directly OR wrapped in state-decl init / bare-expr.
  // SQL classification takes precedence — a bare-expr that wraps `pureFn(?{...})`
  // is caught by findSqlNode descending into the call's args.
  const sqlNode = findSqlNode(stmt);
  if (sqlNode) {
    return classifySqlNode(sqlNode);
  }

  // S81 D3 — pure-fn call (rule e per SPEC §19.9.6).
  if (isPureFnCallStatement(stmt, functionIndex)) {
    return "monotone";
  }

  // CONSERVATIVE: any unrecognized statement shape → non-monotone.
  return "non-monotone";
}

// ---------------------------------------------------------------------------
// Public entry point — analyzeMonotonicity (Stage 5.5)
// ---------------------------------------------------------------------------

/**
 * Run Stage 5.5 monotonicity classification over an entire RouteMap.
 *
 * Side-effect: mutates `route.cpsSplit.monotonicity` in-place on every
 * `FunctionRoute` whose `cpsSplit` is non-null. (`cpsSplit` is the natural
 * attachment surface; Stage 8 codegen reads it directly.)
 *
 * Pure with respect to the AST + function nodes — no AST mutation. The only
 * mutation is to `cpsSplit.monotonicity` (a previously-undefined field).
 *
 * @param routeMap   the RouteMap from Stage 5 RI.
 * @param fnNodes    map from functionNodeId to the function-decl AST node.
 *                   The classifier reads `body[]`, `idempotentModifier`,
 *                   and field-presence checks. Channel-tagged routes (per
 *                   `route.kind === "channel"` if present, OR via caller
 *                   filtering) should NOT appear in fnNodes — see SPEC
 *                   §19.9.6 channel-skip note.
 */
export function analyzeMonotonicity(
  routeMap: RouteMap,
  fnNodes: Map<string, ASTNode>,
  functionIndex: FunctionPurityLookup | null = null,
): MonotonicityAnalysis {
  const verdicts = new Map<string, MonotonicityVerdict>();
  const batchVerdicts = new Map<string, MonotonicityVerdict[]>();
  const diagnostics: MonotonicityDiagnostic[] = [];

  for (const [fnNodeId, route] of routeMap.functions) {
    if (!route.cpsSplit) continue;
    const fnNode = fnNodes.get(fnNodeId);
    if (!fnNode) continue;

    // Channel server-fns are out of scope (SPEC §19.9.6 channel-skip).
    // Detection heuristic: function-decl carrying a `channelOwner` annotation
    // (set elsewhere) OR functionRoute marked as channel. For v0.2.0
    // Ext 5 baseline, callers filter channel routes BEFORE calling
    // analyzeMonotonicity; the classifier itself does no channel detection.
    // Future: add an explicit `route.kind === "channel"` check when that
    // field exists on FunctionRoute.

    // Ext 1 M1.4: classify EACH batch independently. The per-batch verdict
    // array is the load-bearing surface — downstream codegen gates the
    // idempotency-key envelope per batch (a monotone batch in a function with
    // a non-monotone sibling no longer pays the key tax).
    const batches = route.cpsSplit.serverBatches;
    const isIdempotentOverride = fnNode.idempotentModifier === true;
    const perBatchVerdicts: MonotonicityVerdict[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const verdict = classifyBatchMonotonicity(fnNode, batch.indices, functionIndex);
      perBatchVerdicts.push(verdict);

      // Populate the per-batch verdict on the CPSBatch itself — the planner
      // (M1.3) emits `monotonicity` unset; M1.4 fills it here so Stage 8
      // codegen can consult `batch.monotonicity` directly.
      batch.monotonicity = verdict;

      // Emit per-batch info-level diagnostics. D-CPS-MONOTONE is verbose-only
      // (caller filters); we always emit so the consumer can decide.
      if (verdict === "machine-intrinsic") {
        diagnostics.push({
          code: "D-CPS-MACHINE-INTRINSIC-MONOTONE",
          message: "CPS batch bounded by an `<engine>` `.advance(.X)` transition; intrinsic-monotone by §51 allowed-from-states guard.",
          functionNodeId: fnNodeId,
          batchIndex,
        });
      } else if (verdict === "monotone" && !isIdempotentOverride) {
        // `.idempotent()` override fires ONE function-wide diagnostic below
        // instead of per-batch D-CPS-MONOTONE — the modifier dominates every
        // batch, so a per-batch diagnostic would be noise.
        diagnostics.push({
          code: "D-CPS-MONOTONE",
          message: "CPS batch is monotone-by-classification; idempotency-key envelope elided.",
          functionNodeId: fnNodeId,
          batchIndex,
        });
      }
      // Non-monotone batches don't fire info diagnostics; they may trigger
      // E-CPS-NONIDEM-NO-STORAGE downstream (TS Stage 6) when the resolved
      // backend is "none".
    }

    batchVerdicts.set(fnNodeId, perBatchVerdicts);

    // Function-level verdict — the back-compat aggregate (conservative max:
    // non-monotone dominates). Retained for api.js Stage 5.5 tally +
    // type-system.ts E-CPS-NONIDEM-NO-STORAGE.
    const verdict = classifyFunctionMonotonicity(fnNode, route.cpsSplit, functionIndex);
    verdicts.set(fnNodeId, verdict);

    // Attach the function-level verdict to cpsSplit for downstream codegen
    // consumption (back-compat — emit-server.ts / emit-functions.ts read it
    // until M1.5's multi-stub emit consults `batch.monotonicity` per stub).
    (route.cpsSplit as CPSSplit & { monotonicity?: MonotonicityVerdict }).monotonicity = verdict;

    // `.idempotent()` override → one function-wide D-CPS-IDEMPOTENT-OVERRIDE.
    // The override is an information diagnostic the developer reads to confirm
    // what classifier verdict they're overriding.
    if (isIdempotentOverride) {
      diagnostics.push({
        code: "D-CPS-IDEMPOTENT-OVERRIDE",
        message: "`.idempotent()` modifier is in effect at this function declaration; idempotency-key envelope is elided regardless of classifier verdict.",
        functionNodeId: fnNodeId,
      });
    }
  }

  return { verdicts, batchVerdicts, diagnostics };
}

/**
 * Convenience: classify a single function in isolation. Used by tests and by
 * downstream passes that need the verdict without running the full Stage 5.5
 * over the whole RouteMap.
 */
export function classifyFunctionMonotonicityForTest(
  fnNode: ASTNode,
  cpsSplit: CPSSplit,
  functionIndex: FunctionPurityLookup | null = null,
): MonotonicityVerdict {
  return classifyFunctionMonotonicity(fnNode, cpsSplit, functionIndex);
}

/**
 * Convenience: classify a SINGLE CPS batch in isolation (Ext 1 M1.4). Used by
 * the per-batch test corpus to verify the finer-grain classifier directly
 * without building a full RouteMap.
 *
 * @param fnNode        the enclosing function-decl AST node.
 * @param batchIndices  body indices belonging to the batch (`CPSBatch.indices`).
 * @param functionIndex pure-fn lookup map (S81 D3); may be null.
 */
export function classifyBatchMonotonicityForTest(
  fnNode: ASTNode,
  batchIndices: number[],
  functionIndex: FunctionPurityLookup | null = null,
): MonotonicityVerdict {
  return classifyBatchMonotonicity(fnNode, batchIndices, functionIndex);
}
