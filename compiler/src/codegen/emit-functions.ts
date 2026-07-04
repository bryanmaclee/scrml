import { genVar } from "./var-counter.ts";
import { routePath, paramName, paramSignature } from "./utils.ts";
import { emitLogicNode, emitLogicBody, emitFnShortcutBody } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import { isServerOnlyNode, collectFunctions } from "./collect.ts";
import { hasServerCallees, scheduleStatements, buildCalleeImportMap } from "./scheduling.js";
import { buildMachineBindingsMap } from "./emit-reactive-wiring.js";
// A1c C16 — §53.9.1/§53.4.3 client-side function-param boundary check (Locus 3).
import { parsePredicateAnnotation, emitRuntimeCheck } from "./emit-predicates.ts";
import { returnTypeAllowsAbsence } from "./wire-format.ts";
import type { CompileContext } from "./context.ts";

/**
 * A1c C16 — Helper: emit per-param boundary checks for a client-side function.
 *
 * For each parameter whose typeAnnotation parses as a refinement-type predicate
 * (§53.2), emit a runtime check at function entry. Mirrors the server-side
 * §53.9.4 `emitServerParamCheck` path, but produces a client-side `throw`
 * (E-CONTRACT-001-RT) instead of a 400 Response.
 *
 * Per §53.4.3 condition 1: function param is a boundary zone whenever the
 * caller's constraint does not imply the callee's. The simplest correct
 * strategy (correctness floor) is "always check on entry"; §53.4.2/§53.9.2
 * caller-site elision is an OPTIMIZATION not implemented in v0.2.0 (deferred
 * with the rest of static-zone elision optimization to v0.3.0+).
 *
 * Returns an array of indented JS lines.
 */
function emitClientParamChecks(
  params: Param[],
  paramNames: string[],
  fnName: string,
  indent: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const annot = (typeof p === "object" && p !== null) ? ((p as any).typeAnnotation as string | undefined) : undefined;
    if (!annot) continue;
    const parsed = parsePredicateAnnotation(annot);
    if (!parsed) continue;
    // Use emitRuntimeCheck — same shape as boundary-zone let/state checks.
    // Pass paramName as both valueExpr and varName so the error message
    // identifies the parameter cleanly.
    const checkLines = emitRuntimeCheck(
      parsed.predicate,
      paramNames[i],
      paramNames[i],
      parsed.label,
      `fn ${fnName}, parameter '${paramNames[i]}'`,
    );
    for (const l of checkLines) out.push(`${indent}${l}`);
  }
  return out;
}

/**
 * GITI-026 — static collector for §37.4.2 named-event names yielded by a
 * `server function*` generator. Walks the function node looking for
 * `yield <objectLiteral>` where the object literal has a `props` entry with
 * key `"event"` and a STRING-LITERAL value. Returns the de-duplicated set of
 * such literal event names.
 *
 * The client SSE stub registers an `addEventListener("<name>", …)` for each
 * collected name so that named SSE frames (which the browser does NOT deliver
 * to `onmessage`) still reach the bound reactive cell. Dynamic / non-literal
 * event names cannot be statically determined and are not wired — that is the
 * documented facet limitation (the bare-yield `onmessage` path is unaffected).
 */
function collectSSEEventNames(fnNode: ASTNode): string[] {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Record<string, unknown>;
    const kind = (n.kind ?? n.type) as string | undefined;
    if (kind === "yield-stmt" || kind === "yield") {
      const exprNode = n.exprNode as Record<string, unknown> | undefined;
      if (exprNode && (exprNode.kind === "object") && Array.isArray(exprNode.props)) {
        for (const prop of exprNode.props as Array<Record<string, unknown>>) {
          if (prop && prop.kind === "prop" && prop.key === "event" && prop.computed !== true) {
            const val = prop.value as Record<string, unknown> | undefined;
            if (val && val.kind === "lit" && val.litType === "string" && typeof val.value === "string") {
              names.add(val.value as string);
            }
          }
        }
      }
    }
    for (const key in n) {
      const v = n[key];
      if (Array.isArray(v)) for (const c of v) visit(c);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(fnNode);
  return [...names];
}

/** A loosely-typed AST node from the pipeline. */
type ASTNode = Record<string, unknown>;

/** A route map entry for a function. */
interface RouteEntry {
  boundary: string;
  generatedRouteName?: string;
  explicitRoute?: string;
  explicitMethod?: string;
  isSSE?: boolean;
  cpsSplit?: CpsSplit;
  functionName?: string;
}

/** A single CPS server batch (Ext 1 — multi-batch CPS). */
interface CpsBatch {
  indices: number[];
  /** Per-batch monotonicity verdict (Ext 1 M1.4); populated by Stage 5.5. */
  monotonicity?: "monotone" | "non-monotone" | "machine-intrinsic";
}

/** CPS split descriptor from RI stage. */
interface CpsSplit {
  serverStmtIndices: number[];
  returnVarName?: string;
  clientStmtIndices?: number[];
  /**
   * Function-level monotonicity verdict — the back-compat aggregate
   * (Ext 1 M1.4 conservative max). Retained for consumers that want one
   * answer per function.
   */
  monotonicity?: "monotone" | "non-monotone" | "machine-intrinsic";
  /** Server batches in source order (Ext 1). Each carries its own verdict. */
  serverBatches?: CpsBatch[];
  /**
   * Ext 1 M1.5: the full statement schedule (server + client body indices) in
   * the topological order the multi-batch planner (M1.3) chose. Used by the
   * multi-batch client wrapper to sequence client statements between the
   * per-batch awaits. Empty / absent for a single-batch split — the wrapper
   * falls back to source order.
   */
  topoOrder?: number[];
}

/** A param node (either a string or a structured param). */
type Param = string | { name?: string; [key: string]: unknown };

/**
 * Ext 1 M1.4 — per-batch idempotency-key gating (client wrapper side).
 *
 * Returns true iff the CPS client wrapper for this function must emit a
 * per-invocation `Idempotency-Key` (SPEC §19.9.6). Mirror of emit-server.ts's
 * `cpsNeedsIdempotencyDedup` — the verdict is per-batch, but the wrapper still
 * issues one fetch, so it needs the key iff ANY batch is non-monotone.
 *
 * Falls back to the function-level verdict when batches carry no per-batch
 * verdict (Stage 5.5 not run) — defensive; in the normal pipeline
 * analyzeMonotonicity always populates `batch.monotonicity`.
 */
function cpsNeedsIdempotencyKey(cpsSplit: CpsSplit | undefined): boolean {
  if (!cpsSplit) return false;
  const batches = cpsSplit.serverBatches;
  if (batches && batches.length > 0) {
    if (batches.some((b) => b.monotonicity === "non-monotone")) return true;
    if (batches.every((b) => b.monotonicity !== undefined)) return false;
  }
  return cpsSplit.monotonicity === "non-monotone";
}

/** A per-batch fetch-emission plan entry (Ext 1 M1.5 — client side). */
interface ClientBatch {
  /** 0-based batch ordinal; -1 for the single-handler (non-multi-batch) case. */
  batchIndex: number;
  /** Server-statement body indices THIS batch runs (sorted ascending). */
  indices: number[];
  /** Per-batch monotonicity verdict (M1.4); drives the Idempotency-Key gate. */
  monotonicity: string | undefined;
  /** The scrml cell name this batch produces (the value it forwards), or null. */
  returnCell: string | null;
  /** Prior-batch return cell names forwarded into this batch's fetch body. */
  fwdResultNames: string[];
}

/**
 * Ext 1 M1.5 — build the per-batch client fetch plan for a CPS route.
 *
 * For a single-batch CPS route this returns one `ClientBatch` whose `indices`
 * is the flat `serverStmtIndices` and `batchIndex` is -1 (the single-handler
 * back-compat shape). For a multi-batch route it returns one entry per batch,
 * each carrying its own monotonicity verdict, the cross-batch param-forwarding
 * set, and the cell it produces.
 *
 * The return-cell of each batch is the scrml `state-decl` name of its LAST
 * server statement — the last batch produces the function's final
 * `returnVarName`; earlier batches produce their own last `state-decl`.
 */
function buildClientBatchPlan(
  cpsSplit: CpsSplit,
  body: ASTNode[],
): ClientBatch[] {
  const batches = cpsSplit.serverBatches;
  if (!batches || batches.length <= 1) {
    return [{
      batchIndex: -1,
      indices: cpsSplit.serverStmtIndices,
      monotonicity: (batches && batches.length === 1 ? batches[0].monotonicity : undefined)
        ?? cpsSplit.monotonicity,
      returnCell: cpsSplit.returnVarName ?? null,
      fwdResultNames: [],
    }];
  }
  const plan: ClientBatch[] = [];
  const fwdSoFar: string[] = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const b = batches[bi];
    const indices = Array.isArray(b.indices)
      ? [...b.indices].sort((a, c) => a - c)
      : [];
    const isLast = bi === batches.length - 1;
    let returnCell: string | null = null;
    if (isLast) {
      returnCell = cpsSplit.returnVarName ?? null;
    } else if (indices.length > 0) {
      const last = body[indices[indices.length - 1]] as ASTNode | undefined;
      if (last && last.kind === "state-decl" && typeof last.name === "string") {
        returnCell = last.name;
      }
    }
    plan.push({
      batchIndex: bi,
      indices,
      monotonicity: b.monotonicity,
      returnCell,
      fwdResultNames: [...fwdSoFar],
    });
    if (returnCell && !fwdSoFar.includes(returnCell)) fwdSoFar.push(returnCell);
  }
  return plan;
}

/**
 * Ext 1 M1.5 — emit the body of a multi-batch CPS client wrapper.
 *
 * Walks the planner's topological schedule (M1.3 `topoOrder`; source order is
 * the fallback when the schedule is absent). For each statement:
 *   - the FIRST server statement of a batch triggers that batch's `await`
 *     block — an own-scope try/catch issuing the fetch stub, checking the
 *     server-serialized `__scrml_error` envelope, and on a thrown failure
 *     returning a tagged `__scrml_error` envelope that names the batch index;
 *   - subsequent server statements of an already-issued batch are skipped
 *     (folded into that batch's single request);
 *   - client statements are emitted directly, interleaved between the awaits.
 *
 * Each batch's result is bound to `_scrml_batch_<i>_result`; if the batch
 * produces a scrml `state-decl` cell that cell is `_scrml_reactive_set` and
 * also bound as a `const` so later batches / client statements (and the
 * cross-batch parameter forwarding) can reference it by name.
 *
 * Per-batch atomicity (S1) and independent failure handling (S4) hold: each
 * `await` is one HTTP request → one §8.9 transactional envelope; an earlier
 * batch's commit stands when a later batch's try/catch fires (§19.6.7).
 */
function emitMultiBatchWrapper(opts: {
  lines: string[];
  name: string;
  body: ASTNode[];
  cpsSplit: CpsSplit;
  batchPlan: ClientBatch[];
  batchStubs: string[];
  fnParamNames: string[];
  cpsOptsBase: Record<string, unknown>;
  errors: CGError[];
  filePath: string;
}): void {
  const { lines, name, body, cpsSplit, batchPlan, batchStubs, fnParamNames, cpsOptsBase, errors, filePath } = opts;

  // The traversal order: the planner's topological schedule when present,
  // else source order. A single-batch split's schedule equals source order,
  // so this fallback is observationally safe.
  const schedule: number[] = (Array.isArray(cpsSplit.topoOrder) && cpsSplit.topoOrder.length > 0)
    ? cpsSplit.topoOrder
    : body.map((_, i) => i);

  // Map each server-statement index → its batch ordinal, and identify each
  // batch's FIRST server index (the index whose visit triggers the await).
  const batchOfIndex = new Map<number, number>();
  const firstIndexOfBatch = new Map<number, number>();
  batchPlan.forEach((b) => {
    if (b.indices.length > 0) firstIndexOfBatch.set(b.batchIndex, b.indices[0]);
    for (const idx of b.indices) batchOfIndex.set(idx, b.batchIndex);
  });

  const emittedBatch = new Set<number>();
  // Cell names already bound as a `const`/`let` in the wrapper scope — guards
  // against a JS redeclaration when two batches produce the same cell.
  const boundCells = new Set<string>();

  // A9-Ext-4 D1: an outer try/catch wraps the whole wrapper body so an
  // interleaved CLIENT statement that throws still surfaces as a tagged
  // `__scrml_error` envelope — failure-mode preservation (S4) parity with the
  // single-batch wrapper. The per-batch try/catch blocks below `return` early
  // with a batch-indexed envelope; this outer catch is the catch-all for
  // everything between the awaits.
  lines.push(`  try {`);

  for (const stmtIndex of schedule) {
    const stmt = body[stmtIndex];
    if (!stmt) continue;

    const owningBatch = batchOfIndex.get(stmtIndex);
    if (owningBatch !== undefined) {
      // A server statement. Only the batch's FIRST server index emits the
      // await block; the rest are folded into that one request.
      if (firstIndexOfBatch.get(owningBatch) !== stmtIndex) continue;
      if (emittedBatch.has(owningBatch)) continue;
      emittedBatch.add(owningBatch);

      const plan = batchPlan[owningBatch];
      const stub = batchStubs[owningBatch];
      const resultVar = `_scrml_batch_${owningBatch}_result`;
      // Call args: original fn params, then each prior batch's return cell
      // (cross-batch parameter forwarding — M1.3). The prior cells are bound
      // as `const`s after their batch's await, below.
      const callArgs = [...fnParamNames, ...plan.fwdResultNames].join(", ");

      lines.push(`    // Ext 1 M1.5: CPS batch ${owningBatch}`);
      lines.push(`    let ${resultVar};`);
      lines.push(`    try {`);
      lines.push(`      ${resultVar} = await ${stub}(${callArgs});`);
      // A9-Ext-4 D1: a server-serialized error envelope propagates as-is so
      // the caller's `?` / `!{}` / `<errorBoundary>` observes one shape.
      lines.push(`      if (${resultVar} && typeof ${resultVar} === 'object' && ${resultVar}.__scrml_error) {`);
      lines.push(`        return ${resultVar};`);
      lines.push(`      }`);
      lines.push(`    } catch (_scrml_cps_err) {`);
      lines.push(`      if (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error) {`);
      lines.push(`        return _scrml_cps_err;`);
      lines.push(`      }`);
      lines.push(`      return {`);
      lines.push(`        __scrml_error: true,`);
      lines.push(`        type: "CpsError",`);
      lines.push(`        variant: "NetworkError",`);
      lines.push(`        data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)}, batch: ${owningBatch} },`);
      lines.push(`      };`);
      lines.push(`    }`);
      // If the batch produces a scrml cell, publish it reactively and bind it
      // by name so later batches / client statements can read it. The local
      // binding uses `let` and is DECLARED once per cell name; a later batch
      // writing the same cell reassigns the existing binding (the planner
      // proved the cross-batch write admissible — M1.3 param-forwarding).
      if (plan.returnCell) {
        lines.push(`    _scrml_reactive_set(${JSON.stringify(plan.returnCell)}, ${resultVar});`);
        if (!boundCells.has(plan.returnCell)) {
          lines.push(`    let ${plan.returnCell} = ${resultVar};`);
          boundCells.add(plan.returnCell);
        } else {
          lines.push(`    ${plan.returnCell} = ${resultVar};`);
        }
      }
      continue;
    }

    // A client statement — emit it directly, interleaved between the awaits.
    // Security guard: server-only nodes must not appear in a client wrapper.
    if (isServerOnlyNode(stmt)) {
      errors.push(new CGError(
        "E-CG-006",
        `E-CG-006: ${stmt.kind} node found in CPS client wrapper for \`${name}\`. ` +
        `This code uses server-only features (${stmt.kind}) but is marked to run in the browser. ` +
        `Move it to a server-side function or remove the client boundary.`,
        (stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Parameters<typeof CGError>[2],
      ));
      continue;
    }
    // The reactive assignment that receives a batch result is already emitted
    // as part of that batch's await block (the `returnCell` publish above) —
    // skip a duplicate emission here.
    if (
      stmt.kind === "state-decl" &&
      typeof stmt.name === "string" &&
      batchPlan.some((b) => b.returnCell === stmt.name)
    ) {
      continue;
    }
    const code = emitLogicNode(stmt, cpsOptsBase);
    if (code) {
      for (const line of code.split("\n")) lines.push(`    ${line}`);
    }
  }

  // A9-Ext-4 D1: outer catch — an interleaved client statement that throws
  // surfaces as a tagged scrml-error envelope (NetworkError variant), matching
  // the single-batch wrapper's failure-mode shape. A `__scrml_error`-shaped
  // throw passes through unchanged to preserve the original variant identity.
  lines.push(`  } catch (_scrml_cps_err) {`);
  lines.push(`    if (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error) {`);
  lines.push(`      return _scrml_cps_err;`);
  lines.push(`    }`);
  lines.push(`    return {`);
  lines.push(`      __scrml_error: true,`);
  lines.push(`      type: "CpsError",`);
  lines.push(`      variant: "NetworkError",`);
  lines.push(`      data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} },`);
  lines.push(`    };`);
  lines.push(`  }`);
}

/**
 * Emit fetch stubs, CPS wrappers, and client-boundary function bodies.
 *
 * Returns both the emitted JS lines and the fnNameMap so event wiring
 * can resolve original function names to generated names without scanning
 * the emitted lines.
 *
 * Security invariant: SQL nodes, transaction blocks, and server-context meta nodes
 * MUST NOT appear in client-boundary function bodies. If found, emit E-CG-006.
 */
export function emitFunctions(ctx: CompileContext): { lines: string[]; fnNameMap: Map<string, string> } {
  const { filePath, routeMap, depGraph, errors, csrfEnabled } = ctx;
  // S89 §13.2 Sub-Phase B Step 3 — pre-compute per-file `callee → sourceModule`
  // resolver map ONCE for the file. The auto-await classifier consults this
  // map per call site to decide whether the callee is a stdlib `Promise<T>`-
  // returning export (per §13.2.1 Q1 BROAD ratification). Empty when the file
  // has no imports — classifier short-circuits cheaply.
  //
  // Note: `ctx.fileAST` is the TABResult wrapper; the actual FileAST (with
  // hoisted `imports` array) lives at `ctx.fileAST.ast`. Fall back to the
  // wrapper itself for test harnesses that pass the FileAST directly.
  const _fileAstForImports = ((ctx.fileAST as any)?.ast?.imports) ? (ctx.fileAST as any).ast : ctx.fileAST;
  const _calleeMap = buildCalleeImportMap(_fileAstForImports);
  const _exportRegistry = ctx.exportRegistry ?? null;
  const fnNodes: ASTNode[] = (ctx.analysis?.fnNodes ?? collectFunctions(ctx.fileAST)) as ASTNode[];
  const machineBindings = buildMachineBindingsMap(ctx.fileAST);
  // C13 (§51.0.F + §51.0.G): mirror machineBindings wiring for new <engine>
  // form. Function bodies that write to engine variables or call .advance()
  // need both maps threaded through the same emit path.
  const { buildEngineBindingsMap, collectEngineVarNames, collectEnginesWithHooks, collectEnginesWithOnTimeout, collectEnginesWithIdleWatchdog, collectEnginesWithInternalRules, collectEnginesWithHistory, collectEnginesWithMessageArms, collectEngineMessageVariants } = require("./emit-engine.ts");
  const engineBindings = buildEngineBindingsMap(ctx.fileAST);
  const engineVarNames: Set<string> = collectEngineVarNames(ctx.fileAST);
  // §59 (D4): value-native MAP variable names in scope. Threaded through the
  // function-body emit path so `@m[k]` reads / `@m.<method>(…)` / `@m.size`
  // inside function bodies lower to the `_scrml_map_*` runtime. Sibling to
  // engineVarNames.
  const { collectMapVarNames, collectOrderedMapVarNames, collectSetVarNames, collectLocalMapSetNames, buildFnReturnMapKinds } = require("./reactive-deps.ts");
  const mapVarNames: Set<string> = collectMapVarNames(ctx.fileAST);
  // §59.8 (S169): the `@ordered`-typed subset, so a reassignment `@m = [...]`
  // inside a function body lowers the literal ordered. Sibling to mapVarNames.
  const orderedMapVarNames: Set<string> = collectOrderedMapVarNames(ctx.fileAST);
  // §59.12 (D4): the value-native SET cell names (strict subset of mapVarNames),
  // so the set-native vocabulary inside a function body lowers via emit-expr's
  // set interception. Sibling to mapVarNames.
  const setVarNames: Set<string> = collectSetVarNames(ctx.fileAST);
  // §59 (ss52): NON-REACTIVE LOCAL map/set lowering. The reactive collectors
  // above gather only `@`-prefixed module-level cells; a pure-fn local map
  // (`let m = [:]`) carries no `@` and is fn/block-scoped, so it lowered RAW
  // (`m.insert is not a function` at runtime — the (c) bug). The per-function
  // `localMapVarNames`/`localSetVarNames`/`localOrderedMapVarNames` (computed
  // per-fn from its body+params via collectLocalMapSetNames below) thread the
  // BARE local names into each fn-body emit ctx; emit-expr's dispatch sites
  // lower them via the bare-receiver `_scrml_map_*` form, leaving the reactive
  // `@`-path byte-identical. `fnReturnMapKinds` lets `let r = makeMap()`
  // classify `r` from makeMap's RETURN annotation (the "returned from a fn" case).
  const fnReturnMapKinds: Map<string, "map" | "set"> = buildFnReturnMapKinds(ctx.fileAST);
  // B17.4 (§51.0.H): the subset of engines that have at least one effect=/
  // <onTransition> arm. Threaded through scheduling/CPS opts to enable hook-
  // firing wraps on `.advance()` calls inside function bodies.
  const enginesWithHooks: Set<string> = collectEnginesWithHooks(ctx.fileAST);
  // A5-4 (§51.0.M): the subset of engines that have at least one <onTimeout>
  // element. Threaded alongside enginesWithHooks so .advance() and direct-
  // write call sites inside function bodies get the timer-table arg.
  const enginesWithOnTimeout: Set<string> = collectEnginesWithOnTimeout(ctx.fileAST);
  // A5-6 (§51.0.R, S77): the subset of engines that declare <onIdle>. Threaded
  // alongside enginesWithOnTimeout so .advance() and direct-write call sites
  // inside function bodies get the watchdog-config arg.
  const enginesWithIdleWatchdog: Set<string> = collectEnginesWithIdleWatchdog(ctx.fileAST);
  // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix): the subset of engines that have at
  // least one state-child carrying `internal:rule=`. Threaded so .advance()
  // and direct-write call sites inside function bodies get the internal
  // transition table identifier as the trailing arg.
  const enginesWithInternalRules: Set<string> = collectEnginesWithInternalRules(ctx.fileAST);
  // A5-7 Wave 2.3 (§51.0.N, Bug #3): the subset of engines that have at least
  // one composite state-child carrying `history` (with a discoverable inner-
  // engine var). Threaded so .advance() and direct-write call sites inside
  // function bodies get the history-map identifier as the trailing arg.
  const enginesWithHistory: Set<string> = collectEnginesWithHistory(ctx.fileAST);
  // §51.0.S (S155 batch 3) — message-plane routing inputs for `.advance`
  // calls inside function bodies.
  const enginesWithMessageArms: Set<string> = collectEnginesWithMessageArms(ctx.fileAST);
  const engineMessageVariants: Map<string, Set<string>> = collectEngineMessageVariants(ctx.fileAST);
  const lines: string[] = [];

  // Map from original function name → generated var name.
  // Built here and returned to avoid scanning emitted lines later.
  const fnNameMap = new Map<string, string>();

  // Map from original function name → generated fetch stub var name.
  // Used by CPS wrapper generation.
  const serverFnStubs = new Map<string, string>();
  // Ext 1 M1.5: function name → per-batch fetch-stub names, in batch order.
  // A non-CPS / single-batch route maps to a one-element array; a multi-batch
  // route maps to N stub names. Step 2's CPS wrapper consumes this to issue
  // one `await` per batch in topological order.
  const serverFnBatchStubs = new Map<string, string[]>();

  // -------------------------------------------------------------------------
  // Step 1: Generate fetch/EventSource stubs for server-boundary functions
  //
  // §36: SSE generator functions (route.isSSE) emit EventSource stubs.
  //       Standard server functions emit fetch() stubs.
  // -------------------------------------------------------------------------
  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${(fnNode.span as ASTNode)?.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (!route || route.boundary !== "server") continue;

    // Bug 2b (channel-codegen-fixes-2026-06-12): onserver:* channel attribute
    // handlers are server-boundary but invoked from the WS message/lifecycle
    // path (§38.6.1 / §38.7), NOT an HTTP RPC route — so they get NO client
    // fetch stub. (Their route was suppressed in RI, so the generatedRouteName
    // guard below would catch them anyway; this is the explicit, self-
    // documenting form.)
    if ((route as { isChannelWsHandler?: boolean }).isChannelWsHandler === true) continue;

    if (!route.generatedRouteName) continue; // error already recorded in server gen

    const name = (fnNode.name as string) ?? "anon";
    const routeName = route.generatedRouteName;
    // Use explicit route path if specified, otherwise use generated path
    const path = route.explicitRoute ? route.explicitRoute : routePath(routeName);

    // -----------------------------------------------------------------------
    // §36: SSE EventSource stub for server function* generators
    // -----------------------------------------------------------------------
    if (route.isSSE) {
      const sseStubName = genVar(`sse_${name}`);
      serverFnStubs.set(name, sseStubName);
      fnNameMap.set(name, sseStubName);

      // GITI-025 (giti inbound 2026-05-30) — client half. The SSE stub used to
      // hard-wire its signature to `(_scrml_onMessage, _scrml_onEvent)` and open
      // a query-less EventSource, so a call like `countdown(5)` dropped its arg
      // into the onMessage slot and the server never received `from`. Compute
      // the function's declared param names (same :Type-stripping as the non-SSE
      // path's `paramName()`), make them the LEADING stub parameters, and encode
      // them into the EventSource URL query string. The query KEY names are the
      // param names verbatim so they line up with the server handler's
      // `route.query[<name>]` reads (emit-server.ts SSE branch).
      const sseParams = (fnNode.params as Param[]) ?? [];
      const sseParamNames = sseParams.map((p: Param, i: number) => paramName(p, i));

      // GITI-026 (giti inbound 2026-05-30) — named-event facet. A generator
      // yielding the §37.4.2 `{ event, data }` named form emits `event:<name>`
      // SSE frames, which a browser delivers ONLY to
      // `addEventListener("<name>", …)` — never to `onmessage`. Statically
      // collect the literal event names yielded in this generator's body so we
      // can register a listener for each. (Dynamic / non-literal event names are
      // not statically determinable; those frames are not wired — reported as a
      // known facet limitation.)
      const sseEventNames = collectSSEEventNames(fnNode);

      // §37.10: callback FIRST in the user-visible contract, but the GITI-026
      // call-site rewrite (emit-client.ts) appends the per-event callback AFTER
      // the user's positional args. Keep params leading, callback trailing.
      const sseSig = [...sseParamNames, "_scrml_onMessage"].join(", ");
      lines.push(`function ${sseStubName}(${sseSig}) {`);
      if (sseParamNames.length > 0) {
        // Build the query string from the bound params. Skip `undefined` args so
        // an unsupplied optional param doesn't serialize as the string
        // "undefined" on the server side.
        lines.push(`  const _scrml_qs = new URLSearchParams();`);
        for (const _pn of sseParamNames) {
          // Skip absent args (paired null/undefined check — the lint-exempt form
        // per §42.5/§42.8) so an unsupplied optional param isn't serialized as
        // the string "undefined"/"null" on the wire.
        lines.push(`  if (${_pn} !== null && ${_pn} !== undefined) _scrml_qs.set(${JSON.stringify(_pn)}, String(${_pn}));`);
        }
        lines.push(`  const _scrml_q = _scrml_qs.toString();`);
        lines.push(`  const _scrml_es = new EventSource(${JSON.stringify(path)} + (_scrml_q ? '?' + _scrml_q : ''));`);
      } else {
        lines.push(`  const _scrml_es = new EventSource(${JSON.stringify(path)});`);
      }
      lines.push(`  _scrml_es.onmessage = function(_scrml_e) {`);
      lines.push(`    try {`);
      lines.push(`      const _scrml_data = JSON.parse(_scrml_e.data);`);
      lines.push(`      if (typeof _scrml_onMessage === 'function') _scrml_onMessage(_scrml_data);`);
      lines.push(`    } catch (_scrml_err) { /* malformed SSE data */ }`);
      lines.push(`  };`);
      // GITI-026: named-event listeners (§37.4.2). Each statically-known event
      // name gets its own addEventListener routing parsed `data` to the same
      // callback as bare yields, so a reactive cell bound to the stream updates
      // for both unnamed and named frames.
      for (const _evName of sseEventNames) {
        lines.push(`  _scrml_es.addEventListener(${JSON.stringify(_evName)}, function(_scrml_e) {`);
        lines.push(`    try {`);
        lines.push(`      const _scrml_data = JSON.parse(_scrml_e.data);`);
        lines.push(`      if (typeof _scrml_onMessage === 'function') _scrml_onMessage(_scrml_data);`);
        lines.push(`    } catch (_scrml_err) { /* malformed SSE data */ }`);
        lines.push(`  });`);
      }
      lines.push(`  _scrml_es.onerror = function() { /* EventSource auto-reconnects */ };`);
      lines.push(`  // Auto-cleanup: close EventSource when scope is destroyed (§36.5)`);
      lines.push(`  if (typeof _scrml_cleanup_register === 'function') {`);
      lines.push(`    _scrml_cleanup_register(() => _scrml_es.close());`);
      lines.push(`  }`);
      lines.push(`  return _scrml_es;`);
      lines.push(`}`);
      lines.push('');
      continue; // Skip standard fetch() stub for this function
    }

    const httpMethod = route.explicitMethod ?? "POST";
    const params = (fnNode.params as Param[]) ?? [];
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario").
    // A5-FUP: paramName() resolves DestructurePattern names to _scrml_arg_N
    // placeholders so the fetch stub forwards positional args correctly even
    // when the original source used destructured params.
    const fnParamNames = params.map((p: Param, i: number) => paramName(p, i));

    // ----------------------------------------------------------------------
    // Ext 1 M1.5 — multi-stub emit (client fetch side).
    //
    // A non-CPS route, and a single-batch CPS route, emit exactly ONE fetch
    // stub — the pre-Ext-1 shape. A multi-batch CPS route emits N fetch stubs,
    // one per batch, each targeting `<path>__batch_<i>`:
    //   - the idempotency key is gated on THIS batch's own monotonicity
    //     verdict (M1.4) — only non-monotone batches' stubs carry the key,
    //   - batch i's stub body forwards the original function params PLUS each
    //     prior batch's return cell (cross-batch parameter forwarding, M1.3).
    const _cps: CpsSplit | undefined = route.cpsSplit;
    const _fnBody = (fnNode.body as ASTNode[]) ?? [];
    const _stubBatches: ClientBatch[] = _cps
      ? buildClientBatchPlan(_cps, _fnBody)
      : [{ batchIndex: -1, indices: [], monotonicity: undefined, returnCell: null, fwdResultNames: [] }];
    const _isMultiStub = _stubBatches.length > 1;
    // Per-batch stub names — Step 2's wrapper calls these in topological order.
    const _batchStubNames: string[] = [];

    for (const _sb of _stubBatches) {
    // Batch-i's param list: original fn params, then prior batch return cells.
    const paramNames = [...fnParamNames, ..._sb.fwdResultNames];
    // The route path this stub fetches. Single-stub → the route's own path;
    // multi-batch → the per-batch path emitted by emit-server.ts.
    const batchPath = _isMultiStub ? `${path}__batch_${_sb.batchIndex}` : path;

    const stubName = _isMultiStub
      ? genVar(`fetch_${name}_batch_${_sb.batchIndex}`)
      : genVar(`fetch_${name}`);
    _batchStubNames.push(stubName);
    if (!_isMultiStub) {
      serverFnStubs.set(name, stubName);
      // Map original name → fetch stub as the default rewrite target.
      // If this function also has a CPS split, Step 2 will override this
      // with the CPS wrapper name (which is the correct call target).
      fnNameMap.set(name, stubName);
    }

    lines.push(`async function ${stubName}(${paramNames.join(", ")}) {`);
    const usesCsrfRetry = csrfEnabled && httpMethod !== "GET" && httpMethod !== "HEAD";
    // A9 Ext 5 (§19.9.6): non-monotone CPS batches receive a per-invocation
    // UUIDv4 idempotency key transmitted via the `Idempotency-Key` header
    // (IETF-draft standard). Server stub (emit-server.ts) consults the
    // configured store before executing the batch, returning the stored
    // result on key-hit. Monotone / machine-intrinsic batches and non-CPS
    // server functions skip key emission.
    //
    // Ext 1 M1.5: gated on THIS batch's own monotonicity verdict. In a
    // multi-batch route only non-monotone batches' stubs carry the key; for
    // the single-stub case `_sb.monotonicity` is the M1.4 conservative-max
    // aggregate, identical to the prior function-level gate
    // (`cpsNeedsIdempotencyKey`).
    const emitIdempotencyKey = _isMultiStub
      ? _sb.monotonicity === "non-monotone"
      : cpsNeedsIdempotencyKey(route.cpsSplit);
    if (emitIdempotencyKey) {
      lines.push(`  // A9 Ext 5: idempotency key (non-monotone CPS batch)`);
      lines.push(`  const _scrml_idempotency_key = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + '-' + Date.now();`);
    }
    if (usesCsrfRetry) {
      // GITI-010: route through _scrml_fetch_with_csrf_retry so a cookie-less
      // first POST receives a Set-Cookie 403, then automatically retries with
      // the freshly-planted token.
      lines.push(`  const _scrml_body = JSON.stringify({`);
      for (const p of paramNames) {
        lines.push(`    ${JSON.stringify(p)}: ${p},`);
      }
      lines.push(`  });`);
      if (emitIdempotencyKey) {
        // _scrml_fetch_with_csrf_retry's signature is (path, method, body);
        // it does not currently accept extra headers. Fall back to direct
        // fetch with manual CSRF retry inlined when the idempotency key is
        // required, so the header rides along with the body. Mirrors the
        // !usesCsrfRetry branch with manual CSRF retry semantics.
        lines.push(`  // A9 Ext 5: bypass _scrml_fetch_with_csrf_retry to add Idempotency-Key header`);
        // Issue #2 (parent scrmlTS): read the token from the cookie via
        // `_scrml_get_csrf_token()` (which bootstraps one when absent) — the SAME
        // source the non-idempotency retry helper uses. The previous
        // `meta[name="csrf-token"]` read targeted a tag emit-html.ts never emits,
        // so the write path always sent an empty token and BOTH the initial fetch
        // and the retry 403'd.
        //
        // g-auth-csrf-token-never-surfaced (S238): the auth path now reads the
        // SAME cookie source. On the auth path the server is authoritative — its
        // 403 Set-Cookie plants the §40.2 session synchronizer token
        // (emit-server.ts), so the retry below re-reads the cookie and echoes the
        // matching token. The former `ctx.authMiddleware` branch read a
        // never-emitted `meta[name="csrf-token"]` tag and always 403'd twice.
        const _csrfTokenExpr = `_scrml_get_csrf_token()`;
        lines.push(`  const _scrml_csrf_token = ${_csrfTokenExpr};`);
        lines.push(`  const _scrml_resp_initial = await fetch(${JSON.stringify(batchPath)}, {`);
        lines.push(`    method: ${JSON.stringify(httpMethod)},`);
        lines.push(`    headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_csrf_token, "Idempotency-Key": _scrml_idempotency_key },`);
        lines.push(`    body: _scrml_body,`);
        lines.push(`  });`);
        lines.push(`  let _scrml_resp;`);
        lines.push(`  if (_scrml_resp_initial.status === 403) {`);
        lines.push(`    // CSRF token may have been minted on the 403; retry with the freshly-planted token.`);
        lines.push(`    const _scrml_csrf_retry_token = ${_csrfTokenExpr};`);
        lines.push(`    _scrml_resp = await fetch(${JSON.stringify(batchPath)}, {`);
        lines.push(`      method: ${JSON.stringify(httpMethod)},`);
        lines.push(`      headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_csrf_retry_token, "Idempotency-Key": _scrml_idempotency_key },`);
        lines.push(`      body: _scrml_body,`);
        lines.push(`    });`);
        lines.push(`  } else {`);
        lines.push(`    _scrml_resp = _scrml_resp_initial;`);
        lines.push(`  }`);
      } else {
        lines.push(`  const _scrml_resp = await _scrml_fetch_with_csrf_retry(${JSON.stringify(batchPath)}, ${JSON.stringify(httpMethod)}, _scrml_body);`);
      }
    } else {
      lines.push(`  const _scrml_resp = await fetch(${JSON.stringify(batchPath)}, {`);
      lines.push(`    method: ${JSON.stringify(httpMethod)},`);
      if (emitIdempotencyKey) {
        lines.push(`    headers: { "Content-Type": "application/json", "Idempotency-Key": _scrml_idempotency_key },`);
      } else {
        lines.push(`    headers: { "Content-Type": "application/json" },`);
      }
      lines.push(`    body: JSON.stringify({`);
      for (const p of paramNames) {
        lines.push(`      ${JSON.stringify(p)}: ${p},`);
      }
      lines.push(`    }),`);
      lines.push(`  });`);
    }
    // M-7C-D-12 Track 2 (§57 Wire Format) — dual-decoder consumption.
    //
    // When the server fn's declared return type is `T | not` (absence is a
    // legitimate variant), wrap the parsed JSON through `_scrml_wire_decode`
    // so BOTH the canonical envelope `{ __scrml_absent: true }` AND raw JSON
    // `null` (legacy / pre-v0.3 / foreign-client) normalize to scrml `not`
    // (JS `null` per §42.5 / §42.8). For pure-`T` returns, the raw `.json()`
    // result is returned unchanged — a `null` arriving on a pure-`T` channel
    // is a wire-format bug, NOT scrml-absence, and should NOT be silently
    // converted.
    //
    // The `_scrml_wire_decode` helper lives in the 'core' chunk of
    // `compiler/src/runtime-template.js` — always present in compiled client
    // output, no per-file injection needed.
    const _retAnnot = (fnNode as { returnTypeAnnotation?: string }).returnTypeAnnotation;
    // M1.5: the `T | not` wire-decode wrap applies to the FUNCTION'S return
    // type — only the LAST batch's stub produces that value. Intermediate
    // batch stubs return their own cell value (a forwarded intermediate),
    // which is not the declared return type — they take the raw `.json()`.
    const _isLastStub = !_isMultiStub || _sb.batchIndex === _stubBatches.length - 1;
    if (_isLastStub && returnTypeAllowsAbsence(_retAnnot)) {
      lines.push(`  const _scrml_body_json = _scrml_wire_decode(await _scrml_resp.json());`);
    } else {
      lines.push(`  const _scrml_body_json = await _scrml_resp.json();`);
    }
    // §6.7.7 / §19.9.2 (Peter #20) — a non-2xx response that is NOT a typed scrml
    // error envelope is a transport / host / upstream failure. Surface it as a
    // rejection so a `<request>` settles to `.error` (not the success cell) and a
    // reactive-assign's `.catch` routes it to the error surface, instead of the
    // pre-fix behavior where a 500 body was returned and silently treated as
    // success data. A `{ __scrml_error, ... }` envelope (a scrml `!`/`fail`, HTTP
    // 500 per §19.9.2) is a RETURNED value the match / `?` / `!{}` / errorBoundary
    // dispatch consumes via `.__scrml_error` — it is NEVER thrown here.
    lines.push(`  if (!_scrml_resp.ok && !(_scrml_body_json !== null && typeof _scrml_body_json === "object" && _scrml_body_json.__scrml_error === true)) {`);
    lines.push(`    throw new Error("HTTP " + _scrml_resp.status);`);
    lines.push(`  }`);
    lines.push(`  return _scrml_body_json;`);
    lines.push(`}`);
    lines.push("");
    } // end per-batch fetch-stub loop (Ext 1 M1.5)

    // M1.5: register the per-batch stub names so Step 2's CPS wrapper can call
    // them in topological order. For the single-stub case this holds one name.
    serverFnBatchStubs.set(name, _batchStubNames);
  }

  // -------------------------------------------------------------------------
  // Step 2: Generate CPS client wrappers for server functions with cpsSplit
  // -------------------------------------------------------------------------
  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${(fnNode.span as ASTNode)?.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (!route || route.boundary !== "server" || !route.cpsSplit) continue;

    const name = (fnNode.name as string) ?? "anon";
    const stubName = serverFnStubs.get(name);
    const cpsSplit = route.cpsSplit;
    const body = (fnNode.body as ASTNode[]) ?? [];
    const params = (fnNode.params as Param[]) ?? [];
    // §59 (ss52): per-fn NON-REACTIVE LOCAL map/set names for THIS function.
    const { localMapVarNames: _cpsLocalMap, localSetVarNames: _cpsLocalSet, localOrderedMapVarNames: _cpsLocalOrdered } = collectLocalMapSetNames(fnNode, fnReturnMapKinds);
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario").
    // A5-FUP: paramName() resolves DestructurePattern → _scrml_arg_N placeholders.
    const paramNames = params.map((p: Param, i: number) => paramName(p, i));

    // The CPS wrapper is always async (it calls the server stub).
    const wrapperName = genVar(`cps_${name}`);
    // Map original name → CPS wrapper so event wiring and post-process regex
    // rewrite bare call sites (e.g. onclick=login() → _scrml_cps_login_X()).
    fnNameMap.set(name, wrapperName);
    lines.push(`async function ${wrapperName}(${paramNames.join(", ")}) {`);

    // ----------------------------------------------------------------------
    // Ext 1 M1.5 — multi-batch client wrapper.
    //
    // A single-batch CPS route keeps the pre-Ext-1 wrapper shape verbatim
    // (one outer try/catch, one `await`). A multi-batch route emits N awaits
    // — one per batch — in the planner's topological order (M1.3), with the
    // client statements interleaved between them. Each await sits inside its
    // OWN try/catch producing a tagged `__scrml_error` envelope that names the
    // failing batch index; an earlier batch's commit stands even if a later
    // batch fails (predecessor Q3 / §19.6.7).
    const _wrapBatchPlan = buildClientBatchPlan(cpsSplit, body);
    const _batchStubs = serverFnBatchStubs.get(name) ?? (stubName ? [stubName] : []);
    if (_wrapBatchPlan.length > 1 && _batchStubs.length === _wrapBatchPlan.length) {
      emitMultiBatchWrapper({
        lines,
        name,
        body,
        cpsSplit,
        batchPlan: _wrapBatchPlan,
        batchStubs: _batchStubs,
        fnParamNames: paramNames,
        cpsOptsBase: {
          declaredNames: new Set<string>(),
          insideFunctionBody: true,
          ...(machineBindings ? { machineBindings } : {}),
          ...(engineBindings ? { engineBindings } : {}),
          ...(mapVarNames.size > 0 ? { mapVarNames } : {}),
          ...(setVarNames.size > 0 ? { setVarNames } : {}),
          ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}),
          ...(_cpsLocalMap.size > 0 ? { localMapVarNames: _cpsLocalMap } : {}),
          ...(_cpsLocalSet.size > 0 ? { localSetVarNames: _cpsLocalSet } : {}),
          ...(_cpsLocalOrdered.size > 0 ? { localOrderedMapVarNames: _cpsLocalOrdered } : {}),
          ...(engineVarNames.size > 0 ? { engineVarNames } : {}),
          ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
          ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
          ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
          ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
          ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}),
          ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}),
          ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}),
        },
        errors,
        filePath,
      });
      lines.push(`}`);
      lines.push("");
      continue; // multi-batch wrapper fully emitted — skip the single-batch path
    }

    // A9-Ext-4 D1 (2026-05-08): always-`!`-wrap CPS stubs.
    // Wrap the entire CPS body in try/catch so failures route through scrml's
    // §19 structural error system instead of silently throwing JS exceptions.
    // - On caught error: return a tagged scrml-error variant
    //   ({ __scrml_error: true, type: "CpsError", variant: "NetworkError"|"ServerError", data: {...} }).
    // - On server-side serialized error shape (server CPS handler returned a
    //   tagged scrml-error JSON payload — see emit-server.ts D1 site): pass
    //   through as-is so caller's `?` propagation / `!{}` handler / `<errorBoundary>`
    //   markup wrapper observes the same shape regardless of failure mode.
    // - Existing behavior preserved when no failure occurs.
    // Per integration design dive Q4 (2026-05-08): this is deprecation cycle
    // stage 1 (warn-only at compile time via W-CPS-NEEDS-FAILABLE).
    lines.push(`  try {`);

    // Emit statements in original order, replacing server-trigger statements
    // with a call to the server stub.
    let serverCallEmitted = false;
    // C5: CPS wrapper bodies are function bodies — `state-decl` nodes here
    // are reassignments (the cell's true declaration site lives at module
    // top-level). Suppress _scrml_init_set emission so the reset-to-init
    // thunk preserves the canonical declaration-time init expression.
    const cpsOpts: any = {
      declaredNames: new Set<string>(),
      insideFunctionBody: true,
      ...(machineBindings ? { machineBindings } : {}),
      ...(engineBindings ? { engineBindings } : {}),
      ...(mapVarNames.size > 0 ? { mapVarNames } : {}),
      ...(setVarNames.size > 0 ? { setVarNames } : {}),
      ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}),
      ...(_cpsLocalMap.size > 0 ? { localMapVarNames: _cpsLocalMap } : {}),
      ...(_cpsLocalSet.size > 0 ? { localSetVarNames: _cpsLocalSet } : {}),
      ...(_cpsLocalOrdered.size > 0 ? { localOrderedMapVarNames: _cpsLocalOrdered } : {}),
      ...(engineVarNames.size > 0 ? { engineVarNames } : {}),
      ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
      ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
      ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
      ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
      ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}),
      ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}),
      ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}),
    };
    for (let i = 0; i < body.length; i++) {
      const stmt = body[i];
      if (!stmt) continue;

      if (cpsSplit.serverStmtIndices.includes(i)) {
        // This is a server statement — replace with a call to the server stub.
        if (!serverCallEmitted && stubName) {
          if (cpsSplit.returnVarName) {
            // The reactive assignment that receives the server result will reference
            // this variable. Emit: const _result = await serverStub(args);
            lines.push(`    const _scrml_server_result = await ${stubName}(${paramNames.join(", ")});`);
            // A9-Ext-4 D1: detect server-serialized error shape (per §19.9.1)
            // and propagate as-is. The server endpoint (emit-server.ts D1 site)
            // wraps thrown exceptions in this tagged shape with status 500.
            lines.push(`    if (_scrml_server_result && typeof _scrml_server_result === 'object' && _scrml_server_result.__scrml_error) {`);
            lines.push(`      return _scrml_server_result;`);
            lines.push(`    }`);
          } else {
            lines.push(`    await ${stubName}(${paramNames.join(", ")});`);
          }
          serverCallEmitted = true;
        }
        // BUG-R14-007 fix: if this server statement is a state-decl whose init
        // was extracted to the server, emit the reactive_set on the client using
        // the server result. This handles `@entries = ?{SELECT...}` where the SQL
        // runs on the server and the result is passed back via the fetch response.
        if (cpsSplit.returnVarName && (stmt as ASTNode).kind === "state-decl" && (stmt as ASTNode).name === cpsSplit.returnVarName) {
          lines.push(`    _scrml_reactive_set(${JSON.stringify((stmt as ASTNode).name)}, _scrml_server_result);`);
        }
        // Skip additional server statements — they are batched into one server call.
      } else {
        // Client statement — emit it directly.
        // Security guard: server-only nodes must not appear in client CPS wrapper.
        if (isServerOnlyNode(stmt)) {
          errors.push(new CGError(
            "E-CG-006",
            `E-CG-006: ${(stmt as ASTNode).kind} node found in CPS client wrapper for \`${name}\`. ` +
            `This code uses server-only features (${(stmt as ASTNode).kind}) but is marked to run in the browser. ` +
            `Move it to a server-side function or remove the client boundary.`,
            ((stmt as ASTNode).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Parameters<typeof CGError>[2],
          ));
          continue;
        }
        // If this is the reactive assignment that receives the server result,
        // rewrite it to use the server result variable.
        if (cpsSplit.returnVarName && (stmt as ASTNode).kind === "state-decl" && (stmt as ASTNode).name === cpsSplit.returnVarName) {
          lines.push(`    _scrml_reactive_set(${JSON.stringify((stmt as ASTNode).name)}, _scrml_server_result);`);
        } else {
          const code = emitLogicNode(stmt, cpsOpts);
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`    ${line}`);
            }
          }
        }
      }
    }

    // A9-Ext-4 D1 catch arm: surface fetch / network failures as a tagged
    // scrml-error variant (NetworkError variant of CpsError synthetic enum).
    // Existing scrml `?` propagation, `!{}` handler, and `<errorBoundary>`
    // markup all observe the same `{ __scrml_error: true, ... }` shape.
    // If a `__scrml_error`-shaped value is thrown directly (rare but valid),
    // pass it through unchanged so the original variant identity is preserved.
    lines.push(`  } catch (_scrml_cps_err) {`);
    lines.push(`    if (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error) {`);
    lines.push(`      return _scrml_cps_err;`);
    lines.push(`    }`);
    lines.push(`    return {`);
    lines.push(`      __scrml_error: true,`);
    lines.push(`      type: "CpsError",`);
    lines.push(`      variant: "NetworkError",`);
    lines.push(`      data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} },`);
    lines.push(`    };`);
    lines.push(`  }`);

    lines.push(`}`);
    lines.push("");
  }

  // -------------------------------------------------------------------------
  // Step 3: Generate client-side function bodies for client-boundary functions
  // -------------------------------------------------------------------------
  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${(fnNode.span as ASTNode)?.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (route && route.boundary === "server") continue; // handled by server JS + fetch stub
    if (fnNode.isHandleEscapeHatch) continue; // handle() is server-only middleware — no client body
    // §61 <endpoint> private-arm reachability (§61.6 client-codegen SKIP): a
    // LOCAL pure `fn` referenced ONLY from an `<endpoint>` arm body is a server-
    // ONLY private handler helper — retained server-side (emit-server) and NOT
    // bundled into `.client.js`. (A helper ALSO used client-side is not in this
    // set, so it still emits here.)
    if ((routeMap as { endpointClientSkipIds?: Set<string> }).endpointClientSkipIds?.has(fnNodeId)) continue;

    const name = (fnNode.name as string) ?? "anon";
    const params = (fnNode.params as Param[]) ?? [];
    // §59 (ss52): per-fn NON-REACTIVE LOCAL map/set names for THIS function.
    const { localMapVarNames: _localMap, localSetVarNames: _localSet, localOrderedMapVarNames: _localOrdered } = collectLocalMapSetNames(fnNode, fnReturnMapKinds);
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario").
    // A5-FUP: paramName() resolves DestructurePattern → _scrml_arg_N placeholders.
    const paramNames = params.map((p: Param, i: number) => paramName(p, i));
    // §7.3.2: function-decl signatures carry `name = defaultValue` when defaults are present.
    // A5-FUP: paramSignature also handles DestructurePattern names (emits valid JS
    // destructuring bindings via emit-destructure-pattern.ts).
    const paramSigs = params.map((p: Param, i: number) => paramSignature(p, i));

    // Check if this function has any server-call callees that need async.
    // S89 §13.2 Sub-Phase B Step 3 — also classifies stdlib Promise<T>
    // callees as async-boundary so the function emits `async function` prefix
    // when it contains a `safeCallAsync(...)` (or similar) initializer.
    const hasServerCalls = hasServerCallees(fnNode, routeMap, filePath, _calleeMap, _exportRegistry);
    const asyncPrefix = hasServerCalls ? "async " : "";

    const generatedName = genVar(name);
    fnNameMap.set(name, generatedName);

    // bug-16 (S178): preserve the generator star for a non-SSE `function*` in a
    // `${ }` logic block. Mirrors the emit-library.ts:428 `generatorStar` pattern.
    // §13.6 — `function*`/`yield` are admissible in any function position. Without
    // this branch the star was dropped, landing `yield` inside a plain function =
    // invalid JS (E-CODEGEN-INVALID-LOGIC "keyword 'yield' is reserved"). Computed
    // independently of asyncPrefix; a generator does not take the server-call CPS
    // path, so the two should not co-occur, but the fix is defensive either way.
    const generatorStar = (fnNode as { isGenerator?: boolean }).isGenerator ? "*" : "";
    lines.push(`${asyncPrefix}function${generatorStar} ${generatedName}(${paramSigs.join(", ")}) {`);

    // A1c C16 — §53.9.1 client-side param boundary checks (Locus 3).
    // Mirrors emit-server.ts §53.9.4 wiring, but throws E-CONTRACT-001-RT
    // (client-side execution halts) instead of returning a 400 Response.
    const _paramCheckLines = emitClientParamChecks(params, paramNames, name, "  ");
    for (const _l of _paramCheckLines) lines.push(_l);

    const body = (fnNode.body as ASTNode[]) ?? [];
    // §48: `fn` shorthand uses tail-expression implicit return. Bypass scheduleStatements
    // (which has no notion of implicit return); `fn` bodies can't contain server calls
    // (E-FN-005 prohibits async/await), so the Promise.all scheduler is never needed here.
    // Bug H fix: also route `function` declarations with return-type annotations through
    // emitFnShortcutBody so match/switch tail expressions get implicit return.
    const fnKind = (fnNode as { fnKind?: string }).fnKind;
    const hasRetType = (fnNode as { hasReturnType?: boolean }).hasReturnType;
    // A1c C16 — thread the function's returnTypeAnnotation so return-stmt
    // can fire §53.9.3 boundary checks for refinement-typed returns.
    const _returnTypeAnnotation = (fnNode as { returnTypeAnnotation?: string }).returnTypeAnnotation;
    if (fnKind === "fn" || hasRetType) {
      // C5: function-shortcut bodies are function bodies — `state-decl` nodes
      // within are reassignments, not declaration sites. Suppress
      // _scrml_init_set sidecar emission via insideFunctionBody:true.
      const fnOpts = {
        boundary: "client" as const,
        declaredNames: new Set<string>(),
        insideFunctionBody: true,
        ...(machineBindings ? { machineBindings } : {}),
        ...(engineBindings ? { engineBindings } : {}),
        ...(mapVarNames.size > 0 ? { mapVarNames } : {}),
        ...(setVarNames.size > 0 ? { setVarNames } : {}),
        ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}),
        ...(_localMap.size > 0 ? { localMapVarNames: _localMap } : {}),
        ...(_localSet.size > 0 ? { localSetVarNames: _localSet } : {}),
        ...(_localOrdered.size > 0 ? { localOrderedMapVarNames: _localOrdered } : {}),
        ...(engineVarNames.size > 0 ? { engineVarNames } : {}),
      ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
        ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
        ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
        ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
        ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}),
        ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}),
        ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}),
        ...(_returnTypeAnnotation ? { returnTypeAnnotation: _returnTypeAnnotation, enclosingFnName: name } : {}),
      };
      const shortcutLines = emitFnShortcutBody(body, fnOpts, fnKind, hasRetType);
      for (const code of shortcutLines) {
        for (const line of code.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      // S144 Cluster D (Bug AA) — W-MATCH-VALUE-UNUSED.
      // This else-branch is the PLAIN-`function` path: fnKind !== "fn" AND no
      // return-type annotation (the `fn`/return-typed path is handled above via
      // emitFnShortcutBody). A plain `function` has NO implicit return (§48.11 /
      // §7.3); scheduleStatements emits each statement with no implicit return.
      // When the LAST statement is a value-producing `match` written WITHOUT a
      // `return`, codegen lowers it to `(function(){...returns...})()` and then
      // throws the IIFE value away — the function silently falls through to
      // `undefined` with no diagnostic. That fall-through is spec-correct, but
      // the discarded value is almost always a mistake. Surface it as a warning.
      //
      // Guardrails (must NOT warn):
      //   - `return match` -> last stmt is `return-stmt`, not `match-stmt`.
      //   - `fn` / return-typed `function` -> never reach this else-branch.
      //   - side-effect-only match (all arms are `match-arm-block` statement
      //     blocks) -> not value-producing; no value is discarded.
      //   - a match that is not the last statement -> only the tail is checked.
      const _lastStmt = body.length > 0 ? body[body.length - 1] : null;
      if (_lastStmt && (_lastStmt as ASTNode).kind === "match-stmt") {
        const _matchArms = ((_lastStmt as { body?: ASTNode[] }).body ?? []) as ASTNode[];
        // Value-producing iff at least one arm is an inline arm carrying a
        // non-empty value `result`. Block-bodied arms produce no value.
        const _producesValue = _matchArms.some(a =>
          a && (a as ASTNode).kind === "match-arm-inline" &&
          typeof (a as { result?: unknown }).result === "string" &&
          ((a as { result?: string }).result as string).trim().length > 0,
        );
        if (_producesValue) {
          const _warnSpan = ((fnNode.span as ASTNode) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Parameters<typeof CGError>[2];
          errors.push(new CGError(
            "W-MATCH-VALUE-UNUSED",
            `W-MATCH-VALUE-UNUSED: the last statement of plain \`function ${name}\` is a \`match\` ` +
            `that produces a value, but the value is not returned and is discarded — a plain ` +
            `\`function\` has no implicit return (§48.11), so the function falls through to ` +
            `\`undefined\`. Add \`return\` before the \`match\`, or declare \`fn ${name}\` / a ` +
            `return-typed \`function\` (both carry tail-expression implicit return).`,
            _warnSpan,
            "warning",
          ));
        }
      }
      // S89 §13.2 Sub-Phase B Step 3 — thread calleeMap + exportRegistry so
      // the auto-await classifier inside scheduleStatements covers stdlib
      // Promise<T> callees alongside server functions.
      const scheduled = scheduleStatements(body, fnNode, routeMap, depGraph, filePath, errors, machineBindings, engineBindings, engineVarNames, enginesWithHooks, _returnTypeAnnotation, name, enginesWithOnTimeout, enginesWithIdleWatchdog, enginesWithInternalRules, enginesWithHistory, enginesWithMessageArms, engineMessageVariants, _calleeMap, _exportRegistry, mapVarNames, orderedMapVarNames, setVarNames, _localMap, _localSet, _localOrdered);
      for (const line of scheduled) {
        lines.push(`  ${line}`);
      }
    }

    lines.push(`}`);
    lines.push("");
  }

  return { lines, fnNameMap };
}
