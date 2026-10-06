/**
 * Batch Planner — PIPELINE Stage 7.5
 *
 * Implements §8.9 per-handler coalescing, §8.10 N+1 loop hoisting, and
 * §8.11 mount-hydration coalescing. Runs between Stage 7 (DG) and Stage 8
 * (CG) on the finalized, lift-checked dependency graph.
 *
 * Slice 3a: Tier 1 candidate-set detection (§8.9.1). Walks each file's
 * function-decl bodies, counts SQL sites (both `kind: "sql"` AST nodes
 * and string-embedded `?{...}` inside let-decl / return / other
 * expression fields), filters out `.nobatch()` sites and sites nested
 * inside `transaction-block` children, and emits CoalescingGroups with
 * envelopeKind determined by the enclosing function's `canFail` flag.
 *
 * Side effects detected:
 *   E-BATCH-001 — server handler contains BOTH an implicit coalescing
 *                 envelope AND an explicit `transaction { }` block.
 *   W-BATCH-001 — server handler contains explicit `?{BEGIN}` alongside
 *                 would-be implicit coalescing (suppresses the envelope).
 *
 * Tier 2 loop hoisting, F9.C __mountHydrate synthesis, and CG emission
 * are future slices.
 *
 * Determinism: same input produces identical BatchPlan.
 * Idempotency: re-running on a BatchPlan-annotated input is a no-op.
 */

// ---------------------------------------------------------------------------
// Public types — mirrored from SPEC.md §8.9 / §8.10 / §8.11 and
// PIPELINE.md Stage 7.5.
// ---------------------------------------------------------------------------

export type NodeId = string | number;
export type RouteId = string;

/**
 * A group of DGNodes in a single server handler that may share a
 * prepare/lock cycle (and, in `!` handlers, a transactional envelope).
 */
export interface CoalescingGroup {
  nodes: NodeId[];
  /**
   * - "implicit-handler-tx": `!` handler → wrap in BEGIN DEFERRED..COMMIT.
   * - "prepare-lock-only": non-`!` handler → share prepare/lock only.
   */
  envelopeKind: "implicit-handler-tx" | "prepare-lock-only";
}

/**
 * A rewritten for-loop-of-.get()/.all() pattern per §8.10.
 */
export interface LoopHoist {
  loopNode: NodeId;
  queryNode: NodeId;
  keyColumn: string;
  /** Key-expression source text (to be upgraded to ExprNode in a later slice). */
  keyExpr: string;
  /** The `loopVar` name (e.g. "x" in `for (let x of xs)`). */
  loopVar: string;
  /** The field of loopVar accessed as the key (e.g. "id" in `${x.id}`). */
  keyField: string;
  /** Original SQL template body, e.g. "SELECT * FROM users WHERE id = ${x.id}". */
  sqlTemplate: string;
  /**
   * Rewritten SQL with `WHERE <keyColumn> IN (${keysVar})` in place of the
   * single equality. The `${keysVar}` slot is kept parameter-bound via
   * bun:sqlite spread args at emit time (`.all(...keys)`).
   */
  inSqlTemplate: string;
  /**
   * The alias `inSqlTemplate` projects the key column under (`HOIST_KEY_ALIAS`).
   * The pre-fetch keys its Map on it and strips it from each row.
   */
  keyAlias: string;
  terminator: "get" | "all";
  rowCacheColumns: Set<string>;
}

/**
 * Diagnostic emitted for Tier 2 near-misses (D-BATCH-001).
 */
export interface BatchDiagnostic {
  code: "D-BATCH-001";
  severity: "info";
  message: string;
  loopNode: NodeId;
  reason: string;
}

/**
 * Error emitted by the planner (§8.9.2, §8.10.6, §8.10.7, §19.10.5).
 */
export interface BatchPlannerError {
  code: "E-BATCH-001" | "E-BATCH-002" | "E-PROTECT-003" | "E-LIFT-001" | "W-BATCH-001";
  severity: "error" | "warning";
  message: string;
  span?: unknown;
}

/**
 * The first-class output of Stage 7.5.
 */
export interface BatchPlan {
  /** coalescedHandlers[routeId] = groups within that handler. */
  coalescedHandlers: Map<RouteId, CoalescingGroup[]>;
  loopHoists: LoopHoist[];
  /** Synthetic `__mountHydrate` RouteSpec id (§8.11) or null when unused. */
  mountHydrate: RouteId | null;
  /** DGNode IDs carrying the compile-time .nobatch() marker (§8.9.5). */
  nobatchSites: Set<NodeId>;
  diagnostics: BatchDiagnostic[];
}

// ---------------------------------------------------------------------------
// Input / output contracts (duck-typed at the boundary)
// ---------------------------------------------------------------------------

interface FileInput {
  filePath?: string;
  ast?: unknown;
  nodes?: unknown[];
}

interface BPInput {
  files: unknown[];
  depGraph: { nodes: Map<NodeId, unknown>; edges: unknown[] } | null | undefined;
  routeMap?: unknown;
  /** PA output, consumed by the protect-column leak check (§8.10.7). */
  protectAnalysis?: unknown;
}

interface BPOutput {
  batchPlan: BatchPlan;
  errors: BatchPlannerError[];
}

// ---------------------------------------------------------------------------
// Helpers — AST walkers
// ---------------------------------------------------------------------------

/** Best-effort extraction of the top-level AST nodes from a FileInput. */
function getFileNodes(file: unknown): unknown[] {
  if (!file || typeof file !== "object") return [];
  const f = file as FileInput & { nodes?: unknown[]; ast?: FileInput };
  if (Array.isArray(f.nodes)) return f.nodes;
  if (f.ast && typeof f.ast === "object") {
    const nested = (f.ast as { nodes?: unknown[] }).nodes;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/**
 * Recursive walker that applies `visit` to every AST node reachable from
 * the given root. Skips `span` fields and non-object values. Returns
 * nothing; mutations to `visit`'s closure are the output.
 *
 * `visit` returns:
 *   - `false` to skip descending into this node's children
 *   - anything else (undefined, true) to continue descending
 */
function walkAst(root: unknown, visit: (node: Record<string, unknown>) => boolean | void): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }
    const node = cur as Record<string, unknown>;
    const descend = visit(node) !== false;
    if (!descend) continue;
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "id") continue;
      // Skip structured ExprNode mirror fields whose string form is also
      // present on the same node (`init`/`initExpr`, `value`/`valueExpr`,
      // `expr`/`exprNode`, etc.). The SQL-in-string scanner reads the
      // string form; descending into the ExprNode would double-count.
      if (k === "exprNode" || k.endsWith("Expr")) continue;
      const v = node[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
}

/**
 * Count `?{...}` SQL occurrences in a string (string-embedded SQL,
 * outside structured SQLNodes). Supports the `?{...}` form with
 * balanced braces; tolerates `.nobatch()` by subtracting those sites.
 *
 * Returns { total, nobatchCount, beginLiteral } where:
 *   total — number of `?{` occurrences (raw site count)
 *   nobatchCount — sites followed by .nobatch()
 *   beginLiteral — true if any occurrence looks like `?{BEGIN...`
 */
function scanStringSql(s: string): { total: number; nobatch: number; beginLiteral: boolean } {
  if (!s || typeof s !== "string") return { total: 0, nobatch: 0, beginLiteral: false };
  let total = 0;
  let nobatch = 0;
  let beginLiteral = false;
  // `?{` then backtick, raw SQL body (any char except backtick — SQL can
  // legitimately contain `}` from ${…} interpolation, so we don't use
  // `[^}]` here), backtick, `}`, optional chain of `.method(args)` calls.
  // The tokenizer's re-emitter inserts whitespace around punctuation,
  // so chain matching is whitespace-tolerant.
  const re = /\?\{`([^`]*)`\}((?:\s*\.\s*\w+\s*\([^)]*\))*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    total++;
    const body = m[1] ?? "";
    const chain = m[2] ?? "";
    if (/\bBEGIN\b/i.test(body.trim())) beginLiteral = true;
    if (/\.\s*nobatch\s*\(\s*\)/.test(chain)) nobatch++;
  }
  return { total, nobatch, beginLiteral };
}

interface HandlerScan {
  /** Distinct SQL sites that would participate in a coalescing group. */
  sqlSiteIds: NodeId[];
  /** Total SQL sites observed, including those excluded for nobatch. */
  totalSqlSites: number;
  /** Sites marked .nobatch(). */
  nobatchSites: number;
  /** True if the handler body contains an explicit `transaction { }` block. */
  hasTransactionBlock: boolean;
  /** True if the handler body contains an explicit `?{BEGIN}` literal. */
  hasExplicitBegin: boolean;
}

/**
 * Walk a function-decl body and summarize its SQL usage. A site is
 * considered "coalescing-eligible" when it is NOT nested inside a
 * transaction-block child AND it is NOT flagged .nobatch().
 *
 * Because the AST interleaves structured SQLNodes (top-level `?{}`
 * statements) with string-form SQL (embedded inside let-decl init and
 * other expression fields), both are counted. Structured sites produce
 * a stable NodeId from the AST node's `id` field; string sites produce
 * synthetic IDs of the form `${funcName}#str-${n}` for reporting.
 */
function scanHandler(funcDecl: Record<string, unknown>, funcName: string): HandlerScan {
  const scan: HandlerScan = {
    sqlSiteIds: [],
    totalSqlSites: 0,
    nobatchSites: 0,
    hasTransactionBlock: false,
    hasExplicitBegin: false,
  };

  // Set of node object references for every SQL node inside a
  // transaction-block — those are excluded from the candidate set.
  const inTransaction = new WeakSet<object>();

  // First pass — mark every SQLNode that is (transitively) inside a
  // `transaction-block` child, and record transaction-block presence.
  walkAst(funcDecl.body, (node) => {
    if (node.kind === "transaction-block") {
      scan.hasTransactionBlock = true;
      walkAst(node.body, (inner) => {
        if (inner.kind === "sql") inTransaction.add(inner);
        return true;
      });
      return false; // don't re-descend; we've already marked inner SQL
    }
    return true;
  });

  // Second pass — count SQL sites (structured + string), honor .nobatch(),
  // skip transaction-nested SQL.
  let stringSiteCounter = 0;
  walkAst(funcDecl.body, (node) => {
    // Structured SQL node
    if (node.kind === "sql") {
      scan.totalSqlSites++;
      const nodeQuery = typeof node.query === "string" ? node.query : "";
      if (/\bBEGIN\b/i.test(nodeQuery.trim())) scan.hasExplicitBegin = true;
      if (inTransaction.has(node as object)) return true;
      if (node.nobatch === true) {
        scan.nobatchSites++;
        return true;
      }
      const id = typeof node.id === "number" || typeof node.id === "string"
        ? (node.id as NodeId)
        : `${funcName}#sql-${scan.sqlSiteIds.length}`;
      scan.sqlSiteIds.push(id);
      return true;
    }
    // String-embedded SQL — look at any string field that might contain `?{...}`
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "kind" || k === "id") continue;
      const v = node[k];
      if (typeof v !== "string") continue;
      if (v.indexOf("?{") < 0) continue;
      const { total, nobatch, beginLiteral } = scanStringSql(v);
      if (total === 0) continue;
      scan.totalSqlSites += total;
      if (beginLiteral) scan.hasExplicitBegin = true;
      const eligible = total - nobatch;
      scan.nobatchSites += nobatch;
      for (let i = 0; i < eligible; i++) {
        scan.sqlSiteIds.push(`${funcName}#str-${stringSiteCounter++}`);
      }
    }
    return true;
  });

  return scan;
}

// ---------------------------------------------------------------------------
// Tier 2 — §8.10 N+1 loop-hoist detection
// ---------------------------------------------------------------------------

interface LoopSqlSite {
  /** Original string form of the `?{...}.method()` site from the body. */
  raw: string;
  /** Template body (between the backticks). */
  body: string;
  /** Terminator method, e.g. "get" / "all" / "run" / "prepare". */
  terminator: string;
  /** Chain contained `.nobatch()`. */
  nobatch: boolean;
}

/** Extract `?{` SQL sites from a string; returns at most `limit` sites. */
function collectStringSqlSites(s: string, limit = 16): LoopSqlSite[] {
  if (!s || typeof s !== "string") return [];
  const out: LoopSqlSite[] = [];
  const re = /\?\{`([^`]*)`\}((?:\s*\.\s*\w+\s*\([^)]*\))*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const body = m[1] ?? "";
    const chain = m[2] ?? "";
    // Find the first non-nobatch terminator method in the chain.
    let terminator = "";
    let nobatch = false;
    const callRe = /\.\s*(\w+)\s*\(/g;
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(chain)) !== null) {
      const method = c[1];
      if (method === "nobatch") { nobatch = true; continue; }
      if (!terminator) terminator = method;
    }
    out.push({ raw: m[0], body, terminator, nobatch });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * For a given loop body, collect SQL sites (both structured SQLNodes and
 * string-embedded `?{...}`) with their terminator methods. Does not
 * descend into transaction-block children (those are out of Tier 2 scope).
 */
function collectLoopSqlSites(body: unknown): LoopSqlSite[] {
  const sites: LoopSqlSite[] = [];
  walkAst(body, (node) => {
    if (node.kind === "transaction-block") return false;
    if (node.kind === "sql") {
      const chainCalls = Array.isArray(node.chainedCalls) ? node.chainedCalls : [];
      const terminator = chainCalls.length > 0 ? String((chainCalls[0] as any).method ?? "") : "";
      sites.push({
        raw: "",
        body: typeof node.query === "string" ? node.query : "",
        terminator,
        nobatch: node.nobatch === true,
      });
      return true;
    }
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "id" || k === "kind") continue;
      if (k === "exprNode" || k.endsWith("Expr")) continue;
      const v = node[k];
      if (typeof v !== "string") continue;
      if (v.indexOf("?{") < 0) continue;
      for (const s of collectStringSqlSites(v)) sites.push(s);
    }
    return true;
  });
  return sites;
}

/** Extract `WHERE <col> = ${<loopVar>.<field>}` and check tuple-form rejection. */
function extractKeyColumn(
  sqlBody: string,
  loopVar: string,
): { keyColumn: string; keyField: string } | { reason: string } {
  const trimmed = sqlBody.trim();
  // Reject tuple WHERE (`col1 = ${x.a} AND col2 = ${x.b}`) — out of v1 scope.
  const tupleRe = new RegExp(
    `WHERE\\s+[\\w.]+\\s*=\\s*\\$\\{\\s*${loopVar}\\.\\w+\\s*\\}\\s+AND\\s+`,
    "i",
  );
  if (tupleRe.test(trimmed)) {
    return { reason: "tuple WHERE not supported in Tier 2 v1 (§8.10.4)" };
  }
  const re = new RegExp(
    `WHERE\\s+([\\w.]+)\\s*=\\s*\\$\\{\\s*${loopVar}\\.(\\w+)\\s*\\}`,
    "i",
  );
  const m = re.exec(trimmed);
  if (!m) {
    return { reason: `no \`WHERE <col> = \${${loopVar}.field}\` in query template` };
  }
  return { keyColumn: m[1], keyField: m[2] };
}

/** Push D-BATCH-001 diagnostic with a near-miss reason. */
function emitNearMiss(plan: BatchPlan, loopId: NodeId, reason: string, span?: unknown): void {
  plan.diagnostics.push({
    code: "D-BATCH-001",
    severity: "info",
    message: `Near-miss for Tier 2 loop hoisting (§8.10): ${reason}.`,
    loopNode: loopId,
    reason,
  });
  // Keep `span` out of the stable serialized form; diagnostics consumers
  // pull span directly from the plan structure if needed.
  void span;
}

/**
 * Analyze a single for-stmt against the §8.10.1 template. Populates
 * either a LoopHoist (on match) or a D-BATCH-001 diagnostic (on near
 * miss). No-op when the loop has no SQL in its body.
 */
/**
 * Extract the SELECT column list and FROM table name from a SQL template body.
 * Returns `cols: ["*"]` for wildcard SELECTs; returns an empty list when parsing
 * fails (conservative — no overlap check attempted).
 */
function parseSelectColumnsAndTable(sql: string): { cols: string[]; table: string | null } {
  const m = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  if (!m) return { cols: [], table: null };
  const colList = m[1].trim();
  const table = m[2];
  if (colList === "*") return { cols: ["*"], table };
  // Split on comma at depth 0 (skip parens). Keep it simple — v1 hoists only
  // cover simple SELECT forms per §8.10.1.
  const cols = colList
    .split(",")
    .map((c) => c.trim())
    // Strip table qualifier (e.g. "u.name" → "name") and AS alias (e.g. "x AS y" → "y").
    .map((c) => {
      const aliased = c.match(/\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
      if (aliased) return aliased[1];
      const qualified = c.match(/\.([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (qualified) return qualified[1];
      return c.replace(/[`"]/g, "");
    })
    .filter((c) => c.length > 0);
  return { cols, table };
}

/**
 * §8.10.7: verify that the hoisted SELECT's column set does not overlap with
 * any protect-annotated column on the target table. Returns the overlapping
 * columns (empty array = no overlap).
 */
function findProtectOverlap(
  cols: string[],
  table: string | null,
  protectAnalysis: unknown,
): string[] {
  if (!table || cols.length === 0 || !protectAnalysis || typeof protectAnalysis !== "object") {
    return [];
  }
  const pa = protectAnalysis as { views?: Map<unknown, { tables?: Map<string, { protectedFields?: Set<string>; fullSchema?: Array<{ name: string }> }> }> };
  if (!pa.views) return [];
  const overlap = new Set<string>();
  for (const dbView of pa.views.values()) {
    const tv = dbView?.tables?.get(table);
    if (!tv || !tv.protectedFields) continue;
    if (cols.length === 1 && cols[0] === "*") {
      // SELECT * includes every protected column.
      for (const p of tv.protectedFields) overlap.add(p);
    } else {
      for (const c of cols) {
        if (tv.protectedFields.has(c)) overlap.add(c);
      }
    }
  }
  return [...overlap].sort();
}

/** The reserved alias the §8.10 pre-fetch projects the key column under. */
export const HOIST_KEY_ALIAS = "__scrml_batch_key";

/**
 * Append `, <keyColumn> AS __scrml_batch_key` to the outer SELECT list of a
 * hoisted query. `null` when the outer list cannot be delimited with certainty —
 * a nested `SELECT`, or a `FROM` inside parentheses (`extract(year FROM d)`),
 * before the first top-level `FROM` — so the loop is not hoisted.
 */
function projectHoistKey(sql: string, keyColumn: string): string | null {
  const m = /^(\s*SELECT\s+)([\s\S]+?)(\s+FROM\s)/i.exec(sql);
  if (!m) return null;
  const list = m[2];
  if (/\bSELECT\b/i.test(list)) return null;
  let depth = 0;
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  if (depth !== 0) return null;
  const head = m[1] + list + `, ${keyColumn} AS ${HOIST_KEY_ALIAS}`;
  return head + sql.slice(m[1].length + list.length);
}

function analyzeForLoop(
  forStmt: Record<string, unknown>,
  plan: BatchPlan,
  errors: BatchPlannerError[],
  protectAnalysis: unknown,
): void {
  const loopVar = typeof forStmt.variable === "string" ? forStmt.variable : "";
  if (!loopVar) return;

  const loopId: NodeId = typeof forStmt.id === "number" || typeof forStmt.id === "string"
    ? (forStmt.id as NodeId)
    : `for#${plan.loopHoists.length + plan.diagnostics.length}`;

  const sites = collectLoopSqlSites(forStmt.body);
  if (sites.length === 0) return;

  // Condition 4: exactly one SQL site in body
  if (sites.length > 1) {
    emitNearMiss(plan, loopId, `loop body contains ${sites.length} SQL queries (expected exactly 1)`, forStmt.span);
    return;
  }
  const site = sites[0];

  // Condition 5: not marked .nobatch()
  if (site.nobatch) return; // Silent exclusion — user asked to opt out

  // Condition 3: terminator must be .get() or .all()
  if (site.terminator !== "get" && site.terminator !== "all") {
    if (site.terminator === "run") {
      emitNearMiss(plan, loopId, `loop body uses .run() — write batching is out of v1 scope (§8.10.5)`, forStmt.span);
    } else if (site.terminator === "prepare") {
      // Silent — .prepare() has no round trip to hoist.
    } else {
      emitNearMiss(plan, loopId, `loop body uses .${site.terminator || "??"}() — only .get() and .all() are hoistable in v1`, forStmt.span);
    }
    return;
  }

  // Condition 2: extract key column from WHERE <col> = ${<loopVar>.<field>}
  const keyResult = extractKeyColumn(site.body, loopVar);
  if ("reason" in keyResult) {
    emitNearMiss(plan, loopId, keyResult.reason, forStmt.span);
    return;
  }

  // Build the IN-form SQL template by substituting the single equality
  // predicate with `WHERE <keyColumn> IN (${__KEYS__})`. We use a distinct
  // placeholder token rather than a real `${}` so the SQL rewriter at CG
  // time won't try to turn it into a bound param — the emit step replaces
  // the placeholder with a spread-rendered IN-list.
  const keyEqPattern = new RegExp(
    `WHERE\\s+${keyResult.keyColumn}\\s*=\\s*\\$\\{\\s*${loopVar}\\.${keyResult.keyField}\\s*\\}`,
    "i",
  );
  const inSqlWhere = site.body.replace(
    keyEqPattern,
    `WHERE ${keyResult.keyColumn} IN (__SCRML_BATCH_IN__)`,
  );
  // §8.10.4 — the pre-fetch groups its rows by the key column, so it must SELECT
  // it — under a reserved alias, whatever the user's SELECT list says. Keying on
  // the user's own column broke whenever the list did not carry it bare:
  // `SELECT body … WHERE id = …` (no `id` in the rows), `SELECT id AS note_id …`,
  // `SELECT n.id … WHERE n.id = …` (a row has `id`, not `n.id`) — every lookup
  // missed and every row read `not` on success. The emitter strips the alias, so
  // each row is exactly the row the per-iteration query returns.
  const inSqlTemplate = projectHoistKey(inSqlWhere, keyResult.keyColumn);
  if (inSqlTemplate === null) {
    emitNearMiss(plan, loopId, `the query's SELECT list could not be extended with the key column \`${keyResult.keyColumn}\` (a subquery or a FROM inside parentheses before the outer FROM)`, forStmt.span);
    return;
  }

  // §8.10.7: populate rowCacheColumns from the SELECT column list, then
  // cross-reference against protectedFields on the target table. Overlap
  // refuses the hoist and emits E-PROTECT-003 (CG falls back to the
  // unrewritten for-loop, preserving N+1 semantics without leaking
  // protected fields through the batched prefetch).
  const { cols, table } = parseSelectColumnsAndTable(site.body);
  const rowCacheColumns = new Set<string>(cols);
  const overlap = findProtectOverlap(cols, table, protectAnalysis);
  if (overlap.length > 0) {
    errors.push({
      code: "E-PROTECT-003",
      severity: "error",
      message:
        `Tier 2 loop hoist refused for table '${table ?? "?"}': the pre-loop ` +
        `SELECT would cache protected column(s) [${overlap.join(", ")}] in ` +
        `client-reachable scope (§8.10.7). Narrow the SELECT column list or ` +
        `.nobatch() the loop body.`,
      span: forStmt.span,
    });
    return;
  }

  plan.loopHoists.push({
    loopNode: loopId,
    queryNode: `${String(loopId)}#query`,
    keyColumn: keyResult.keyColumn,
    keyExpr: `${loopVar}.${keyResult.keyField}`,
    loopVar,
    keyField: keyResult.keyField,
    sqlTemplate: site.body,
    inSqlTemplate,
    keyAlias: HOIST_KEY_ALIAS,
    terminator: site.terminator as "get" | "all",
    rowCacheColumns,
  });
}

// ---------------------------------------------------------------------------
// runBatchPlanner — entry point
// ---------------------------------------------------------------------------

/**
 * Produce a BatchPlan for the given pipeline state.
 *
 * Slice 3a: populates `coalescedHandlers` from per-file AST traversal.
 * For each server function-decl, a CoalescingGroup is emitted iff two
 * or more SQL sites are coalescing-eligible (not inside a
 * transaction-block, not marked .nobatch()). The group's envelopeKind
 * reflects the enclosing function's `canFail` flag.
 *
 * Side effects emitted:
 *   E-BATCH-001 when an implicit envelope would be synthesized but the
 *     same handler contains an explicit `transaction { }`.
 *   W-BATCH-001 when an implicit envelope would be synthesized but the
 *     handler contains an explicit `?{BEGIN}` that suppresses it.
 *
 * Postconditions:
 *   - Result is a well-formed BatchPlan with all fields present.
 *   - Deterministic across runs.
 *   - No mutation of input.
 */
export function runBatchPlanner(input: BPInput): BPOutput {
  const batchPlan: BatchPlan = {
    coalescedHandlers: new Map(),
    loopHoists: [],
    mountHydrate: null,
    nobatchSites: new Set(),
    diagnostics: [],
  };
  const errors: BatchPlannerError[] = [];

  // Seed nobatchSites from DG sql-query nodes carrying the flag
  // (forward-looking — DG does not yet propagate .nobatch() today).
  const dg = input.depGraph;
  if (dg && dg.nodes) {
    for (const [nodeId, node] of dg.nodes) {
      if (!node || typeof node !== "object") continue;
      const n = node as { kind?: string; nobatch?: boolean };
      if (n.kind === "sql-query" && n.nobatch === true) {
        batchPlan.nobatchSites.add(nodeId);
      }
    }
  }

  // Tier 2 loop-hoist detection (§8.10). Walks every for-stmt in every
  // file, regardless of enclosing handler — `?{}` is server-only by
  // route inference (§12.2 Trigger 1), so any for-stmt containing SQL
  // is inherently server-bound. Near-miss shapes emit D-BATCH-001.
  for (const file of input.files ?? []) {
    const topNodes = getFileNodes(file);
    walkAst(topNodes, (node) => {
      if (node.kind !== "for-stmt") return true;
      analyzeForLoop(node, batchPlan, errors, input.protectAnalysis);
      return true;
    });
  }

  // Candidate-set detection per file per server function-decl
  for (const file of input.files ?? []) {
    const topNodes = getFileNodes(file);

    // Collect every server function-decl (anywhere in the file tree, since
    // they can be nested inside markup/logic blocks).
    walkAst(topNodes, (node) => {
      if (node.kind !== "function-decl") return true;
      if (!node.isServer) return true;

      const funcName = typeof node.name === "string" ? node.name : "<anonymous>";
      const canFail = node.canFail === true;
      const routeId: RouteId = funcName;

      const scan = scanHandler(node, funcName);

      // Coalescing applies when 2+ eligible SQL sites exist
      if (scan.sqlSiteIds.length < 2) return true;

      // §19.10.5: explicit `?{BEGIN}` suppresses the implicit envelope (W-BATCH-001)
      if (scan.hasExplicitBegin) {
        errors.push({
          code: "W-BATCH-001",
          severity: "warning",
          message:
            `Server handler '${funcName}' contains an explicit ?{BEGIN} that suppresses ` +
            `the implicit per-handler transaction (§19.10.5). ` +
            `Use transaction { } or .nobatch() for clarity.`,
          span: node.span,
        });
        return true;
      }

      // §8.9.2: implicit envelope MUST NOT compose with explicit transaction { } (E-BATCH-001)
      const envelopeKind: "implicit-handler-tx" | "prepare-lock-only" =
        canFail ? "implicit-handler-tx" : "prepare-lock-only";

      if (canFail && scan.hasTransactionBlock) {
        errors.push({
          code: "E-BATCH-001",
          severity: "error",
          message:
            `Server handler '${funcName}' contains both an implicit per-handler ` +
            `transaction (§8.9.2) — synthesized because ${scan.sqlSiteIds.length} ` +
            `SQL queries are coalescing candidates — and an explicit ` +
            `transaction { } block. Either .nobatch() the outer queries or wrap ` +
            `the full handler body in transaction { }.`,
          span: node.span,
        });
        // Still record the group so tests can verify the candidate set;
        // CG slice will refuse to emit the envelope when errors exist.
      }

      const existing = batchPlan.coalescedHandlers.get(routeId) ?? [];
      existing.push({ nodes: [...scan.sqlSiteIds], envelopeKind });
      batchPlan.coalescedHandlers.set(routeId, existing);

      return true;
    });
  }

  // §8.10.7 post-rewrite lift-checker re-run.
  for (const e of verifyPostRewriteLift(batchPlan)) errors.push(e);

  return { batchPlan, errors };
}

/**
 * §8.10.7 post-rewrite lift re-check.
 *
 * Each Tier 2 hoist introduces a synthetic pre-loop DGNode (the batched
 * SELECT). The spec requires re-running the Phase 2 E-LIFT-001 pair check
 * over the post-rewrite DG to ensure the new sibling does not break the
 * deterministic-accumulator invariant (§10.5).
 *
 * By construction the synthetic prefetch is a pure SELECT with
 * `hasLift: false` — §8.10.1 condition 4 allows only one SQL site in the
 * loop body, and the hoisted SELECT body carries no scrml `lift` call.
 * A pair check against this node can therefore never fire a new
 * E-LIFT-001 unless the hoisted template itself contains `lift`, which
 * would violate the §8.10.1 precondition. We defensively assert that
 * invariant here and surface any violation as E-LIFT-001, matching the
 * error code Phase 2 would have raised on the post-rewrite DG.
 *
 * Exported for direct testing of the invariant.
 */
export function verifyPostRewriteLift(plan: BatchPlan): BatchPlannerError[] {
  const out: BatchPlannerError[] = [];
  for (const hoist of plan.loopHoists) {
    if (/\blift\s*\(/i.test(hoist.sqlTemplate)) {
      out.push({
        code: "E-LIFT-001",
        severity: "error",
        message:
          `E-LIFT-001 (post-rewrite, §8.10.7): hoisted SELECT at loop ` +
          `'${String(hoist.loopNode)}' contains 'lift'. The Tier 2 rewrite ` +
          `would introduce a lift-bearing sibling DGNode that parallelizes ` +
          `with existing lift-bearing nodes in the same logic block, ` +
          `violating §10.5. Refactor the loop to eliminate lift from the ` +
          `hoisted query or .nobatch() the site.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// serializeBatchPlan — stable JSON form for `--emit-batch-plan` / tests.
// ---------------------------------------------------------------------------

export function serializeBatchPlan(plan: BatchPlan): string {
  const sortedHandlers = Array.from(plan.coalescedHandlers.entries()).sort(
    ([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0),
  );
  const sortedHoists = [...plan.loopHoists]
    .map((h) => ({ ...h, rowCacheColumns: Array.from(h.rowCacheColumns).sort() }))
    .sort((a, b) => String(a.loopNode).localeCompare(String(b.loopNode)));
  const sortedDiagnostics = [...plan.diagnostics].sort((a, b) =>
    String(a.loopNode).localeCompare(String(b.loopNode)),
  );
  const obj = {
    coalescedHandlers: Object.fromEntries(sortedHandlers),
    loopHoists: sortedHoists,
    mountHydrate: plan.mountHydrate,
    nobatchSites: Array.from(plan.nobatchSites).sort(),
    diagnostics: sortedDiagnostics,
  };
  return JSON.stringify(obj, null, 2);
}
