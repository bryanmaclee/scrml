/**
 * Route Inferrer — Stage 5 of the scrml compiler pipeline (RI).
 *
 * Input:  { files: FileAST[], protectAnalysis: ProtectAnalysis }
 * Output: { routeMap: RouteMap, errors: RIError[] }
 *
 * RouteMap = {
 *   functions: Map<FunctionNodeId, FunctionRoute>,
 * }
 *
 * FunctionRoute = {
 *   functionNodeId: FunctionNodeId,
 *   boundary: 'client' | 'server' | 'middleware',  // middleware = handle() escape hatch (§ 39.3)
 *   escalationReasons: EscalationReason[],  // empty if client
 *   generatedRouteName: string | null,       // null for client functions
 *   serverEntrySpan: Span | null,
 *   cpsSplit: CPSSplit | null,               // non-null when CPS transformation applies
 * }
 *
 * CPSSplit = {
 *   serverBatches: CPSBatch[],     // server batches in source order (Ext 1 M1.1 — single batch)
 *   clientStmtIndices: number[],   // indices into the function body that run on client
 *   returnVarName: string | null,  // the name of the variable that receives the server result
 *   // derived getter: serverStmtIndices — flattens every batch's indices (back-compat)
 * }
 *
 * EscalationReason =
 *   | { kind: 'protected-field-access', field: string, stateBlockId: string }
 *   | { kind: 'server-only-resource',   resourceType: string, span: Span }
 *   | { kind: 'explicit-annotation',    span: Span }
 *   | { kind: 'channel-broadcast',      detail: string, span: Span }   // §12.2 Trigger 7 (D2)
 *   | { kind: 'middleware-handle',      span: Span }                   // §12.2 Trigger 8 (D2)
 *
 * FunctionNodeId = "{filePath}::{span.start}"
 *
 * Error codes produced:
 *   E-RI-002  server-escalated function assigns to @reactive variable (AT_IDENT in assignment)
 *             A function is server-escalated when it has direct triggers (own ?{} SQL, own
 *             access to a protect= field or server-only resource, or `server` annotation) OR
 *             when it captures a server-tainted function WITHOUT calling it (Step 5b — captures
 *             that propagate by referencing, not by calling). Calling a server function does
 *             NOT escalate the caller (§12 escalation rules) — the call site lowers to a fetch
 *             stub at codegen, so a client function may freely call a server function and assign
 *             reactive state on its result (this is the canonical Promise-chain pattern; see
 *             tests §10 "function calling server fn with reactive in nested if-stmt").
 *             E-RI-002 only fires when (a) the function IS server-escalated by the rules above,
 *             AND (b) the function body contains a `@`-assignment (anywhere, including inside
 *             if/while/for bodies — see findReactiveAssignment), AND (c) CPS cannot split the
 *             body (analyzeCPSEligibility returns null or non-eligible). CPS-eligible patterns
 *             include `@x = ?{...}.method()` and `@x = serverFn()` at top level.
 *   E-ROUTE-001  warning — unresolvable callee (variable-stored function ref, computed member)
 *
 * What RI does NOT do:
 *   - No code generation.
 *   - No type resolution.
 *   - No full alias tracking (DC-011 accepted limitation — direct patterns only).
 *   - No SQL query execution or validation.
 *   - No dependency graph construction.
 *
 * Performance budget: <= 15 ms for the full project.
 */

import type {
  Span,
  FileAST,
  ASTNode,
  LogicStatement,
  FunctionDeclNode,
  StateNode,
  LogicNode,
  ImportDeclNode,
} from "./types/ast.ts";

import type { ProtectAnalysis } from "./protect-analyzer.ts";
import { exprNodeCollectCallees, emitStringFromTree, forEachIdentInExprNode } from "./expression-parser.ts";
import type { ExprNode } from "./types/ast.ts";
// Type-only import — `monotonicity-analyzer.ts` imports `CPSSplit` from this
// module, so a value import would form a runtime cycle. `import type` is
// erased at compile time and is cycle-safe.
import type { MonotonicityVerdict } from "./monotonicity-analyzer.ts";
import { collectChannelFunctionMap, collectChannelCellMap, collectChannelAttrHandlerNames } from "./codegen/emit-channel.ts";
// Ext 1 M1.2 + M1.3 — statement-grain body-DG + multi-batch CPS planner.
import { buildBodyDG } from "./body-dg-builder.ts";
import { planMultiBatchCPS } from "./cps-batch-planner.ts";
import { isToolProgram, findToolMainFn } from "./tool-program.ts";
import { filePrintBuiltinsShadowed } from "./codegen/log-loc.ts";
// §12.4 client-pin shadow (S263 review) — reuse the tested destructuring
// name-extractor rather than re-hand-rolling it. Cycle-safe: type-system's
// direct deps do not import route-inference.
import { isDestructurePattern, iterDestructuredNames } from "./type-system.ts";

// ---------------------------------------------------------------------------
// RI-internal types
// ---------------------------------------------------------------------------

/** A reason why a function was escalated to run on the server. */
export type EscalationReason =
  | { kind: "protected-field-access"; field: string; stateBlockId: string }
  | { kind: "server-only-resource"; resourceType: string; span: Span }
  | { kind: "explicit-annotation"; span: Span }
  // §12.2 Trigger 7 (D2, server-keyword-eliminate): a standalone function
  // declared inside a <channel> lexical scope that WRITES a channel-declared
  // cell or calls broadcast()/disconnect(). `detail` names the write target /
  // call for diagnostics.
  | { kind: "channel-broadcast"; detail: string; span: Span }
  // §12.2 Trigger 8 (D2): the reserved-name handle(request, resolve) middleware
  // escape hatch, recognized by name+signature (§39.3.2), keyword-independent.
  | { kind: "middleware-handle"; span: Span }
  // Bug 2b (channel-codegen-fixes-2026-06-12): the function is the handler for
  // an `onserver:*` channel ATTRIBUTE (`onserver:message=handleMessage(msg)`
  // etc.). Per §38.6.1 / §38.7 it runs server-side, invoked from the WS
  // `_scrml_ws_handlers` message/lifecycle path — NOT an HTTP RPC route. This
  // reason FORCE-escalates the handler to the server boundary (it is server
  // regardless of body content) and the route record's `isChannelWsHandler`
  // flag suppresses the dead HTTP route + client fetch stub.
  | { kind: "channel-ws-handler"; span: Span };

/**
 * One server batch in a CPS split plan (Ext 1, M1.1).
 *
 * The A9 min-viable body-split (Ext 4 + Ext 5) produces exactly ONE batch per
 * CPS-eligible function. Ext 1 (multi-batch CPS) lifts this to N batches — a
 * body crossing the server seam multiple times. Each batch is independently
 * `!`-typed (Ext 4 composition) and independently idempotency-keyed (Ext 5
 * composition lifted to per-batch).
 *
 * At M1.1 every `CPSSplit` is constructed with exactly one batch (single-batch
 * default — no behavior change). The multi-batch planner (M1.3) is the sub-step
 * that populates `serverBatches` with more than one entry.
 */
export interface CPSBatch {
  /** Indices into the function body that run on the server for this batch. */
  indices: number[];
  /**
   * Per-batch static monotonicity verdict (SPEC §19.9.6, A9 Ext 5).
   * Populated by Stage 5.5 (monotonicity-analyzer.ts). `undefined` until
   * Stage 5.5 has run; at M1.1 the per-batch classifier lift is M1.4 — until
   * then this stays `undefined` and the function-level `CPSSplit.monotonicity`
   * is the consulted surface.
   */
  monotonicity?: MonotonicityVerdict;
  /**
   * Per-batch idempotency tag (Ext 5 composition lifted to per-batch via
   * M1.4). Empty string until the per-batch idempotency-key lift populates it.
   * `""` is a defined value (an empty tag), not absence — see SPEC §42.
   */
  idempotencyTag: string;
}

/**
 * CPS transformation split plan.
 * When applicable, the compiler splits the function at the server/client boundary.
 *
 * Ext 1, M1.1: the flat `serverStmtIndices: number[]` is lifted to
 * `serverBatches: CPSBatch[]`. `serverStmtIndices` is preserved as a derived
 * getter (flattens every batch's `indices`, sorted ascending) so existing
 * callers — emit-functions.ts, emit-server.ts, monotonicity-analyzer.ts — keep
 * working unchanged. At M1.1 `serverBatches` always holds exactly one batch.
 */
export class CPSSplit {
  /**
   * Server batches in source order (Ext 1). At M1.1 this is always a
   * single-element array; the multi-batch planner (M1.3) is what produces
   * more than one entry.
   */
  serverBatches: CPSBatch[];

  /** Indices into the function body that run on the client. */
  clientStmtIndices: number[];

  /** The reactive variable name that receives the server result, or null. */
  returnVarName: string | null;

  /**
   * Ext 1 M1.5: the full statement schedule (every body index, server +
   * client) in the topological order the multi-batch planner (M1.3) chose.
   * Empty until M1.3's planner has run. Codegen's client-wrapper emit
   * (emit-functions.ts) sequences client statements between batch awaits
   * using this order — for a single-batch split it equals source order, so
   * the back-compat single-batch emit path stays observationally identical.
   */
  topoOrder: number[];

  /**
   * Function-level static monotonicity verdict (SPEC §19.9.6, A9 Ext 5).
   * Populated by Stage 5.5 (monotonicity-analyzer.ts) AFTER RI has built the
   * cpsSplit. Undefined when Stage 5.5 has not run, OR when the function is a
   * channel server-fn (channel-skip per §19.9.6 note).
   *
   * Ext 1 M1.4 lifts monotonicity classification to per-batch
   * (`CPSBatch.monotonicity`); this function-level field is retained for
   * back-compat with current consumers until that lift lands.
   *
   * Consumed by: emit-functions.ts (client wrapper — emit Idempotency-Key
   * header iff "non-monotone"), emit-server.ts (server stub — emit dedup
   * middleware iff "non-monotone"), type-system.ts (fire
   * E-CPS-NONIDEM-NO-STORAGE iff "non-monotone" + resolved backend is
   * "none").
   */
  monotonicity?: MonotonicityVerdict;

  /**
   * Construct a CPS split plan.
   *
   * @param serverBatches      server batches in source order. At M1.1 callers
   *                           pass a single-element array.
   * @param clientStmtIndices  indices into the body that run on the client.
   * @param returnVarName      reactive var that receives the server result.
   */
  constructor(
    serverBatches: CPSBatch[],
    clientStmtIndices: number[],
    returnVarName: string | null,
  ) {
    this.serverBatches = serverBatches;
    this.clientStmtIndices = clientStmtIndices;
    this.returnVarName = returnVarName;
    // M1.5: default to empty; M1.3's planner overwrites with the real
    // schedule when it runs. A single-batch split with an empty `topoOrder`
    // falls back to source order at the emit site — no behavior change.
    this.topoOrder = [];
  }

  /**
   * Build a single-batch CPS split from a flat server-stmt index array — the
   * Ext 4/Ext 5 (A9 min-viable) shape. This is the default construction path
   * at M1.1; M1.3's planner constructs multi-batch plans directly.
   */
  static singleBatch(
    serverStmtIndices: number[],
    clientStmtIndices: number[],
    returnVarName: string | null,
  ): CPSSplit {
    return new CPSSplit(
      [{ indices: serverStmtIndices, idempotencyTag: "" }],
      clientStmtIndices,
      returnVarName,
    );
  }

  /**
   * Derived back-compat view: every server batch's indices flattened into one
   * ascending-sorted array. Equals the pre-Ext-1 `serverStmtIndices` field for
   * a single-batch split, so existing callers need no change.
   */
  get serverStmtIndices(): number[] {
    const all: number[] = [];
    for (const batch of this.serverBatches) {
      for (const idx of batch.indices) all.push(idx);
    }
    return all.sort((a, b) => a - b);
  }
}

/** A resolved route entry for a single function. */
export interface FunctionRoute {
  functionNodeId: string;
  /** The declared function name (or null for anonymous). Read by codegen +
   * scheduling.ts::hasServerCallees. */
  functionName?: string | null;
  boundary: "client" | "server" | "middleware";
  escalationReasons: EscalationReason[];
  generatedRouteName: string | null;
  explicitRoute: string | null;
  explicitMethod: string | null;
  isSSE: boolean;
  serverEntrySpan: Span | null;
  cpsSplit: CPSSplit | null;
  /**
   * Bug 2b (channel-codegen-fixes-2026-06-12): true for a server-boundary
   * function that is the handler for an `onserver:*` channel ATTRIBUTE
   * (`onserver:message=handleMessage(msg)` etc.). Such a function is invoked
   * from the WS `_scrml_ws_handlers` message/lifecycle path (§38.6.1 / §38.7),
   * NOT from an HTTP RPC route — so codegen emits it as a plain callable server
   * function and SUPPRESSES the (dead) HTTP route + client fetch stub the
   * standard server-fn path would otherwise generate.
   */
  isChannelWsHandler?: boolean;
}

/** A page route entry derived from file-based routing. */
export interface PageRoute {
  filePath: string;
  urlPattern: string;
  params: string[];
  layoutFilePath: string | null;
  isCatchAll: boolean;
}

/** Auth middleware configuration derived from <program auth="required"> or auto-escalation. */
export interface AuthMiddleware {
  filePath: string;
  auth: string;
  loginRedirect: string;
  csrf: string;
  sessionExpiry: string;
  autoEscalated?: boolean;
}

/** The complete route map produced by RI. */
export interface RouteMap {
  functions: Map<string, FunctionRoute>;
  pages: Map<string, PageRoute>;
  authMiddleware: Map<string, AuthMiddleware>;
  /**
   * §61 `<endpoint>` private-arm reachability
   * (endpoint-private-arm-reachability-2026-06-25). The fnNodeIds of LOCAL,
   * non-exported pure `fn`s that an `<endpoint>` arm body (§61.2 — the canonical
   * `<FleetStatus : fleetStatus()>` form) reaches directly or transitively. The
   * endpoint handler runs server-side (§61.6), so codegen MUST RETAIN these in
   * the `.server.js` (emit-server emits each as a plain `function`) or the
   * handler's call references an undefined symbol. Empty when no file declares an
   * `<endpoint>` (gated — non-endpoint apps are byte-identical).
   */
  endpointServerHelperIds?: Set<string>;
  /**
   * The subset of `endpointServerHelperIds` that is NOT also client-reachable
   * (no markup / client-fn reference) — a server-ONLY endpoint helper.
   * emit-functions SKIPS the client body for these so a private endpoint helper
   * never leaks into `.client.js` (§61.6 client-codegen skip). A helper ALSO
   * used client-side stays in `endpointServerHelperIds` (emitted server-side for
   * the handler) but NOT here (still emitted client-side for the markup use).
   */
  endpointClientSkipIds?: Set<string>;
}

/** Per-function analysis record (used during transitive escalation). */
interface AnalysisRecord {
  fnNodeId: string;
  filePath: string;
  fnNode: FunctionDeclNode;
  isPure: false;
  directTriggers: EscalationReason[];
  callees: string[];
  warnings: RouteWarning[];
  /** Names captured from outer scope (closure variables). */
  closureCaptures: Set<string>;
  /**
   * §12.4 E-ROUTE-002 — the client-pin signal: a direct browser/DOM-only global
   * access in this function's own body (`document.title`, `window.location`,
   * `localStorage.getItem`, …). Non-null pins the function to the client (it
   * cannot execute server-side). Used to (a) veto server escalation of this fn
   * via caller-context / capture taint, and (b) fire E-ROUTE-002 when a
   * server-classified fn's call graph reaches it. `resource` is the
   * `<root>.<member>` string for the diagnostic; `span` locates the access.
   */
  clientPin: { resource: string; span: Span | undefined } | null;
}

/** An entry in the global function index. */
interface FunctionIndexEntry {
  fnNodeId: string;
  filePath: string;
  fnNode: FunctionDeclNode;
}

/** Result of walkBodyForTriggers. */
interface WalkResult {
  triggers: EscalationReason[];
  callees: string[];
  warnings: RouteWarning[];
}

/** Internal warning record for E-ROUTE-001. */
interface RouteWarning {
  code: string;
  message: string;
  span: Span;
  severity?: "error" | "warning";
}

/** CPS eligibility analysis result. */
interface CPSResult {
  eligible: boolean;
  serverStmtIndices: number[];
  clientStmtIndices: number[];
  returnVarName: string | null;
  /**
   * Ext 1 M1.3: the two tier sub-sets the multi-batch planner needs to build a
   * `BodyTierClassification` for the body-DG. `pureServerIndices` are
   * server-tier statements that are NOT reactive-server; `reactiveServerIndices`
   * are `state-decl`s whose server-call init crosses the seam. Their union
   * (sorted) equals `serverStmtIndices` — the field is retained for back-compat.
   */
  pureServerIndices: number[];
  reactiveServerIndices: number[];
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class RIError {
  code: string;
  message: string;
  span: Span;
  severity?: "error" | "warning";
  filePath?: string;

  constructor(code: string, message: string, span: Span) {
    this.code = code;
    this.message = message;
    this.span = span;
  }
}

// ---------------------------------------------------------------------------
// Server-only resource detection (Trigger 1)
//
// Detects Bun-specific APIs, file-system access, and SQL contexts.
// All ?{} SQL blocks auto-escalate to server per §12.2 Trigger 1.
// ---------------------------------------------------------------------------

/** A pattern that signals server-only resource access in a bare-expr string. */
interface ServerOnlyPattern {
  pattern: RegExp;
  resourceType: string;
}

/**
 * Patterns that indicate server-only resource access.
 * Applied to bare-expr node `expr` strings.
 *
 * NOTE — the `Bun.*` / `process.*` namespace-member signal set is NOT in this
 * string-scanned table. A raw-source regex over `emitStringFromTree(exprNode)`
 * false-matches `Bun.serve(` inside a STRING LITERAL / COMMENT (`@msg =
 * "docs mention Bun.serve(x)"` — emitStringFromTree renders the literal's quoted
 * content, and the regex matches inside it), spuriously escalating a pure-client
 * function (then cascading to E-CPS-NONIDEM-NO-STORAGE). Those signals are now
 * detected at the AST level (`exprNodeCallsServerOnlyResource`, mirroring the
 * §20.7 `exprNodeCallsPrintBuiltin` print detector) — a genuine `Bun.serve`
 * MemberExpr, never a string's contents. The former regexes are retained in
 * `SERVER_ONLY_NAMESPACE_FALLBACK_PATTERNS` below and applied ONLY on the rare
 * `exprNode`-absent runtime-string fallback path (fail-closed, no leak).
 * (g-route-inference-signals-string-blind, S252.)
 */
const SERVER_ONLY_PATTERNS: ServerOnlyPattern[] = [
  // SQL context sigil (?{}) — all database access is server-side (§12.2 Trigger 1)
  { pattern: /\?\{/, resourceType: "sql-query" },
  { pattern: /\bnew\s+Database\s*\(/, resourceType: "bun:sqlite Database" },
  // §44 Bun.SQL constructor — driver-agnostic SQL client. Server-only because
  // any DB connection is a server-side resource (escalation trigger §12.2). The
  // bare-ident `new SQL(...)` form stays string-scanned; the `new Bun.SQL(...)`
  // form is a Bun.* member (AST-detected, see SERVER_ONLY_NAMESPACE_MEMBERS).
  { pattern: /\bnew\s+SQL\s*\(/, resourceType: "Bun.SQL" },
  // Node.js fs module calls
  { pattern: /\bfs\.readFile\s*\(/, resourceType: "fs.readFile" },
  { pattern: /\bfs\.writeFile\s*\(/, resourceType: "fs.writeFile" },
  { pattern: /\bfs\.readFileSync\s*\(/, resourceType: "fs.readFileSync" },
  { pattern: /\bfs\.writeFileSync\s*\(/, resourceType: "fs.writeFileSync" },
  { pattern: /\bfs\.unlink\s*\(/, resourceType: "fs.unlink" },
  { pattern: /\bfs\.mkdir\s*\(/, resourceType: "fs.mkdir" },
  { pattern: /\bfs\.rmdir\s*\(/, resourceType: "fs.rmdir" },
  { pattern: /\bfs\.stat\s*\(/, resourceType: "fs.stat" },
  { pattern: /\bfs\.existsSync\s*\(/, resourceType: "fs.existsSync" },
  { pattern: /\breadFileSync\s*\(/, resourceType: "readFileSync" },
  { pattern: /\bwriteFileSync\s*\(/, resourceType: "writeFileSync" },
  // §20.7 print()/println() are NOT in this string-scanned table — a raw-source
  // regex false-matches `print(` inside a STRING LITERAL / COMMENT (`@msg =
  // "call print(x)"`), spuriously escalating a pure-client function. They are
  // detected at the AST level instead (`exprNodeCallsPrintBuiltin`, the
  // bare-expr branch of walkBodyForTriggers) — a genuine builtin CallExpr,
  // never a string's contents — which also honors the §20.7.5 shadow (a user
  // `function print` is not the builtin, so it does not escalate).
  // env() built-in is server-only unless prefixed with `public`
  { pattern: /(?<!public )\benv\s*\(/, resourceType: "env()" },
  // The §20.5 SERVER-only `session` object (available only in server-escalated
  // functions) is the BARE name `session`. The negative lookbehind `(?<!@)`
  // excludes the CLIENT `@session` window-scoped auth projection (emit-client.ts
  // `var session = window._scrml_session_projection ?? ...`, hydrated via
  // `fetch('/_scrml/session')`): the two are semantically distinct (the client
  // projection is fed across the HTTP boundary and carries no server-only data),
  // so a `@session` read MUST NOT auto-escalate its enclosing function to the
  // server (which would mis-read `_scrml_body["session"]`). Mirrors the
  // `(?<!public )` lookbehind on the `env()` pattern above.
  // (g-markup-session-read-undeclared, S228 ruling.)
  { pattern: /(?<!@)\bsession\b/, resourceType: "session" },
  // NOTE: `@currentUser` (§20.5 / §52, S233 — the compiler-provided ambient
  // identity cell) deliberately has NO escalation trigger here, mirroring the
  // client `@session` projection precedent above. The canonical Fork-3 read is
  // INSIDE a `?{}` (already server-escalated by the `?\{` trigger) or inside an
  // already-server-authority cell decl, so no separate trigger is needed — and a
  // blanket `/@currentUser\b/` would collide with a USER-declared `<currentUser>`
  // reactive cell (the ambient is active only when no such cell exists; see
  // `_currentUserAmbientActive`), wrongly server-escalating a client function.
];

// ---------------------------------------------------------------------------
// §12.2 Trigger 1 — server-only NAMESPACE-MEMBER signals, AST-level (S252).
//
// g-route-inference-signals-string-blind: the `Bun.*` / `process.*` server-only
// signal set moved OFF the raw-source regex table (SERVER_ONLY_PATTERNS) and onto
// the parsed ExprNode, mirroring the §20.7 `exprNodeCallsPrintBuiltin` print
// detector. A member access on the `Bun` / `process` GLOBAL (a genuine
// `{kind:"member", object:{kind:"ident", name:"Bun"}, property:"serve"}` node) is
// a real host-resource use; the same text inside a STRING LITERAL / COMMENT is a
// `lit` node's contents (or elided at parse), never a member node — so a client
// fn merely MENTIONING `"…Bun.serve(x)…"` no longer spuriously server-escalates.
// The AST path also side-steps the regex-vs-division undecidability that sank the
// S244 raw-text literal-scanner (there is no `/`-scan on the ExprNode path), and
// is precise about the receiver by construction: `foo.Bun.serve()` (Bun as a
// PROPERTY of a USER object, not the global) does NOT match (its object is a
// member, not ident "Bun") — the shadow-blindness edge the old regex
// `\bBun\.serve\(` over-fired on. The receiver root is resolved by
// `resolveServerOnlyNamespaceRoot`, which ALSO accepts the canonical explicit
// global form `globalThis.Bun` / `window.process` (S252 S239-review follow-up —
// closes the HIGH leak where `globalThis.Bun.serve({port})` silently shipped to
// the client because the `serve` receiver's object was a member, not the bare
// ident). A `globalThis`/`window`/`self`/`global` prefix is unwrapped; any OTHER
// receiver root (a user local `foo`) is not — so the FP fix is preserved.
// ---------------------------------------------------------------------------

/**
 * The `Bun` / `process` global members whose access is a server-only signal.
 * `Bun.Server` / `Bun.SQL` are the member callees of `new Bun.Server(...)` /
 * `new Bun.SQL(...)`; matched as members (the `new` node's callee), so no
 * `new`-specific branch is needed. The bare-ident `new SQL(...)` /
 * `new Database(...)` forms are NOT namespace members — they remain string-scanned.
 */
const SERVER_ONLY_NAMESPACE_MEMBERS: Record<string, Set<string>> = {
  Bun: new Set(["file", "write", "spawn", "serve", "env", "cron", "Server", "SQL"]),
  process: new Set(["env", "cwd", "argv", "platform", "exit", "uptime", "memoryUsage"]),
};

/** The server-only namespace GLOBAL roots (`Bun` / `process`), from the map keys. */
const SERVER_ONLY_NAMESPACE_ROOTS = new Set<string>(
  Object.keys(SERVER_ONLY_NAMESPACE_MEMBERS),
);

/**
 * The global-object aliases through which the Bun/JS globals are canonically
 * reached explicitly. `globalThis.Bun` / `window.process` denote the SAME global
 * as the bare `Bun` / `process` ident and MUST escalate identically.
 */
const GLOBAL_OBJECT_ALIASES = new Set<string>([
  "globalThis", "window", "self", "global",
]);

/**
 * Raw-source fallback for the AST-migrated `Bun.*` / `process.*` signals, applied
 * ONLY when a node carries no parsed `exprNode` (the rare runtime string-fallback
 * path). Kept fail-closed so an `exprNode`-less bare-expr / decl / return still
 * escalates on a real `Bun.serve(` / `process.env` — the string-literal FP is
 * acceptable ONLY here because it never leaks (over-fire, not under-fire). These
 * mirror the exact regexes formerly inlined in SERVER_ONLY_PATTERNS.
 */
const SERVER_ONLY_NAMESPACE_FALLBACK_PATTERNS: ServerOnlyPattern[] = [
  { pattern: /\bBun\.file\s*\(/, resourceType: "Bun.file" },
  { pattern: /\bBun\.write\s*\(/, resourceType: "Bun.write" },
  { pattern: /\bBun\.spawn\s*\(/, resourceType: "Bun.spawn" },
  { pattern: /\bBun\.serve\s*\(/, resourceType: "Bun.serve" },
  { pattern: /\bBun\.env\b/, resourceType: "Bun.env" },
  { pattern: /\bBun\.cron\b/, resourceType: "Bun.cron" },
  { pattern: /\bnew\s+Bun\.Server\b/, resourceType: "Bun.Server" },
  { pattern: /\bnew\s+Bun\.SQL\s*\(/, resourceType: "Bun.SQL" },
  { pattern: /\bprocess\.env\b/, resourceType: "process.env" },
  { pattern: /\bprocess\.cwd\s*\(/, resourceType: "process.cwd" },
  { pattern: /\bprocess\.argv\b/, resourceType: "process.argv" },
  { pattern: /\bprocess\.platform\b/, resourceType: "process.platform" },
  { pattern: /\bprocess\.exit\s*\(/, resourceType: "process.exit" },
  { pattern: /\bprocess\.uptime\s*\(/, resourceType: "process.uptime" },
  { pattern: /\bprocess\.memoryUsage\s*\(/, resourceType: "process.memoryUsage" },
];

/**
 * scrml module names whose exports are server-only.
 * Functions imported from these modules cannot run on the client.
 *
 * Used in CPS analysis and server-trigger detection to recognize calls
 * like hash(password) (from scrml:crypto) as server-side operations
 * even though they are not user-defined functions in the AST.
 */
export const SERVER_ONLY_SCRML_MODULES = new Set<string>([
  "scrml:crypto",
  "scrml:auth",
  "scrml:data",
  "scrml:http",
  // Insight 26 Batch 1 — D1 completion (2026-05-08).
  // Each verified server-only by header of stdlib/<name>/index.scrml.
  "scrml:redis",   // wraps Bun.redis (Bun ≥1.3); network-bound server-only
  "scrml:fs",      // node:fs / Bun.file APIs; not available in browser
  "scrml:process", // Node/Bun process APIs; not available in browser
  "scrml:cron",    // wraps Bun.cron (Bun ≥1.3.12); in-process scheduler
  "scrml:oauth",   // OAuth client; network calls + token storage
]);

/**
 * True when `source` is a server-only `scrml:*` module import — matching the
 * bare module (`scrml:auth`) OR any of its submodules (`scrml:auth/jwt`). A
 * submodule of a server-only module is itself server-only.
 *
 * Used by the STDLIB-EXPORT-SEED fail-closed backstop (api.js): an unresolvable
 * re-export in a server-only stdlib module MUST default to async (so emit-server
 * awaits it) rather than fail-open to sync — an un-awaited Promise from a
 * server-only auth/crypto call is the JWT/password auth-bypass class (issue #26).
 */
export function isServerOnlyScrmlModuleSource(source: string): boolean {
  if (SERVER_ONLY_SCRML_MODULES.has(source)) return true;
  for (const m of SERVER_ONLY_SCRML_MODULES) {
    if (source.startsWith(m + "/")) return true;
  }
  return false;
}

/**
 * Check a bare-expr string for server-only resource access patterns.
 * Returns the first matching resourceType, or null if none match.
 */
function detectServerOnlyResource(expr: string): string | null {
  for (const { pattern, resourceType } of SERVER_ONLY_PATTERNS) {
    if (pattern.test(expr)) return resourceType;
  }
  return null;
}

/**
 * Raw-source fallback scan for the AST-migrated `Bun.*` / `process.*` namespace
 * signals. Used ONLY when a node carries no parsed `exprNode` (see
 * SERVER_ONLY_NAMESPACE_FALLBACK_PATTERNS). Fail-closed backstop; the AST path
 * (`exprNodeCallsServerOnlyResource`) is primary and string-literal-FP-free.
 */
function detectServerOnlyNamespaceString(expr: string): string | null {
  for (const { pattern, resourceType } of SERVER_ONLY_NAMESPACE_FALLBACK_PATTERNS) {
    if (pattern.test(expr)) return resourceType;
  }
  return null;
}

/**
 * Resolve the server-only namespace GLOBAL (`Bun` / `process`) a receiver node
 * denotes, or null. Accepts BOTH:
 *   - the bare global ident: `{kind:"ident", name:"Bun"|"process"}`; and
 *   - a global-object-rooted access: `globalThis.Bun` / `window.process` /
 *     `self.Bun` / `global.process` — a `{kind:"member", object:{kind:"ident",
 *     name:<globalObjectAlias>}, property:"Bun"|"process"}` node.
 * A `globalThis.`/`window.` prefix is the canonical EXPLICIT way to reach the
 * JS/Bun globals, so it denotes the SAME global as the bare ident. A receiver
 * rooted at any OTHER ident (a USER local `foo` in `foo.process.env`) is NOT a
 * match — preserving the string-literal FP fix. (S252 S239-review follow-up:
 * closes the HIGH leak where `globalThis.Bun.serve({port})` silently shipped to
 * the client because the `serve` receiver's `object` was a member, not an ident.)
 */
function resolveServerOnlyNamespaceRoot(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  // Bare global ident: `Bun` / `process`.
  if (
    n.kind === "ident" &&
    typeof n.name === "string" &&
    SERVER_ONLY_NAMESPACE_ROOTS.has(n.name)
  ) {
    return n.name;
  }
  // Global-object-rooted: `globalThis.Bun` / `window.process`.
  if (
    n.kind === "member" &&
    typeof n.property === "string" &&
    SERVER_ONLY_NAMESPACE_ROOTS.has(n.property)
  ) {
    const root = n.object as Record<string, unknown> | undefined;
    if (
      root && typeof root === "object" &&
      root.kind === "ident" &&
      typeof root.name === "string" &&
      GLOBAL_OBJECT_ALIASES.has(root.name)
    ) {
      return n.property;
    }
  }
  return null;
}

/**
 * §12.2 Trigger 1 — AST-level detection of a server-only `Bun.*` / `process.*`
 * namespace-member access anywhere in an expression tree. STRING/COMMENT-SAFE by
 * construction (the S252 fix for g-route-inference-signals-string-blind): a
 * genuine member node's `property` is in the server-only member set AND its
 * `object` resolves (via `resolveServerOnlyNamespaceRoot`) to the `Bun`/`process`
 * global — either the bare ident OR a `globalThis.`/`window.`-rooted access. The
 * contents of a `"…Bun.serve…"` string literal is a `lit` node, never a member
 * node, so it does not match; a USER object (`foo.Bun.serve()`) does not match
 * either (its receiver root is a user local, not a global). Returns the matched
 * resource (`"Bun.serve"`, `"process.env"`, …) or null. Mirrors
 * `exprNodeCallsPrintBuiltin`.
 */
function exprNodeCallsServerOnlyResource(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n.kind === "member" && typeof n.property === "string") {
    const nsRoot = resolveServerOnlyNamespaceRoot(n.object);
    if (nsRoot !== null) {
      const members = SERVER_ONLY_NAMESPACE_MEMBERS[nsRoot];
      if (members && members.has(n.property)) {
        return `${nsRoot}.${n.property}`;
      }
    }
  }
  for (const k in n) {
    if (k === "span") continue;
    const v = n[k];
    if (Array.isArray(v)) {
      for (const c of v) {
        const hit = exprNodeCallsServerOnlyResource(c);
        if (hit) return hit;
      }
    } else if (v && typeof v === "object") {
      const hit = exprNodeCallsServerOnlyResource(v);
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// §12.4 E-ROUTE-002 — CLIENT-ONLY (client-pinned) classification.
//
// The MIRROR of the §12.2 server-escalation triggers. A function that directly
// accesses a browser/DOM-only global is PINNED to the client: route analysis
// determines it "execute[s] exclusively on the client" (§12.4). Such a function
// SHALL NOT be pulled server-side (a server context has no `document`/`window`),
// and a server-classified function whose static call graph reaches it — direct
// or transitive — is a compile error (E-ROUTE-002).
//
// CONSERVATIVE BY CONSTRUCTION (a false positive breaks a valid program, which
// is worse than the hole this closes — see the brief's R26 gate):
//   - Fires ONLY on a member access `<root>.<member>` whose receiver ROOT is one
//     of the UNAMBIGUOUS DOM globals below, AND that root is NOT shadowed by an
//     in-scope local / param / import (scope-aware — see `shadowedRoots`).
//   - Resolved on the PARSED ExprNode (string/comment-safe — the contents of a
//     "…document.title…" string literal is a `lit` node, never a `member` node),
//     mirroring `exprNodeCallsServerOnlyResource`. There is NO raw-string
//     fallback: unlike the server direction (where an over-fire only escalates
//     placement and never leaks), an over-fire here is a spurious HARD ERROR, so
//     an `exprNode`-less node is treated as NO client access (fail-open reject).
//   - Does NOT fire on arbitrary-receiver method names (`el.addEventListener`,
//     where `el` is a param, could be any EventTarget / plain data object).
//   - `window.process` / `window.Bun` are EXCLUDED — those are the server-global
//     aliases already recognized as SERVER signals (Trigger 1); the same member
//     access must not also read as a client signal.
// ---------------------------------------------------------------------------

/**
 * DOM-only GLOBAL identifiers whose member access pins the enclosing function to
 * the client. DELIBERATELY MINIMAL — `document` and `window` ONLY. These two are
 * the DOM roots with NO server-side referent under ANY host: Bun does not (and by
 * design will not) provide a `document` or a top-level browser `window`.
 *
 * Everything wider was DROPPED after the S263 adversarial review verified false
 * positives on this Bun: `typeof navigator === "object"` (Bun PROVIDES it — a
 * server fn using `navigator.userAgent` is valid), and `localStorage` /
 * `sessionStorage` are Web-API globals Bun MAY add in a future version. A
 * false-positive HARD ERROR on valid server code is worse than the narrow miss
 * of an author who reaches those globals in genuinely client-only code, so the
 * set stays minimal on purpose. Widen it only for a global proven browser-only
 * on every supported host.
 */
const CLIENT_ONLY_GLOBAL_ROOTS = new Set<string>([
  "document",
  "window",
]);

/**
 * §12.4 — resolve whether an ExprNode `member` node is a DOM-only global access.
 * Returns the `<root>.<property>` resource string (e.g. "document.title",
 * "window.location") or null.
 *
 * Matches ONLY `{kind:"member", property, object:{kind:"ident", name:<root>}}`
 * whose `object` is a BARE ident in CLIENT_ONLY_GLOBAL_ROOTS AND whose name is
 * NOT in `shadowedRoots` — a local / param / import binding of that name (e.g.
 * `formatDoc(document) { return document.title }`, where `document` is a domain
 * object, not the DOM global). For `window`, a `window.process` / `window.Bun`
 * member is EXCLUDED (server-global alias — a SERVER signal). A member on a user
 * local (`foo.document`) is NOT a match (its object is a member/non-global
 * ident). String/comment-safe by construction: a member node is a real access,
 * never a string literal's text.
 */
function clientOnlyGlobalAccessOfNode(
  node: unknown,
  shadowedRoots: Set<string>,
): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n.kind !== "member" || typeof n.property !== "string") return null;
  const obj = n.object as Record<string, unknown> | undefined;
  if (
    !obj || typeof obj !== "object" ||
    obj.kind !== "ident" || typeof obj.name !== "string" ||
    !CLIENT_ONLY_GLOBAL_ROOTS.has(obj.name) ||
    // Scope shadow: the root ident names an in-scope binding, not the DOM global.
    shadowedRoots.has(obj.name)
  ) {
    return null;
  }
  // `window.process` / `window.Bun` denote the SERVER globals (Trigger 1) — not
  // a client signal. Every other `window.<member>` is a browser access.
  if (obj.name === "window" && SERVER_ONLY_NAMESPACE_ROOTS.has(n.property)) {
    return null;
  }
  return `${obj.name}.${n.property}`;
}

/**
 * §12.2 Trigger 1 — unified server-only-resource detection for a statement's
 * expression surface. The SINGLE entry point every trigger scanner routes
 * through so the AST-migrated `Bun.*` / `process.*` namespace set is detected
 * string/comment-safe (via the parsed `exprNode`) at EVERY site, not just the
 * bare-expr one. Order:
 *   1. the reduced string patterns (fs.*, `?{`, env(), session, `new SQL/Database`)
 *      — these have no clean AST form here and keep their prior string behaviour;
 *   2. the namespace set (`Bun.*` / `process.*`) via the AST when `exprNode` is
 *      present (the FP fix), or via the fail-closed string fallback when it is
 *      absent (rare runtime-string path; over-fires but never leaks).
 * Returns the matched resourceType, or null.
 */
function detectServerOnlyResourceForNode(
  exprNode: unknown,
  exprString: string,
): string | null {
  const strHit = detectServerOnlyResource(exprString);
  if (strHit !== null) return strHit;
  return exprNode
    ? exprNodeCallsServerOnlyResource(exprNode)
    : detectServerOnlyNamespaceString(exprString);
}

/**
 * §20.7 — AST-level detection of a genuine `print()` / `println()` builtin
 * CallExpr anywhere in an expression tree. This is the STRING/COMMENT-SAFE
 * replacement for a raw-source regex: a call node's callee is a real
 * `{kind:"ident", name:"print"|"println"}`, never the contents of a string
 * literal (a `lit` node) or a comment — so `@msg = "call print(x)"` never
 * matches. A member call (`obj.print(...)`, callee.kind==="member") is
 * excluded, and a name the file SHADOWS via `function print` / `println`
 * (§20.7.5) is skipped (it resolves to the user fn, not the host-stdout
 * builtin, so it must not force server placement). Returns the matched builtin
 * name (`"print"` / `"println"`) or null.
 */
function exprNodeCallsPrintBuiltin(
  node: unknown,
  shadowed: Set<string>,
): "print" | "println" | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const callee = n.callee as Record<string, unknown> | undefined;
  if (
    n.kind === "call" &&
    callee && typeof callee === "object" &&
    callee.kind === "ident" &&
    (callee.name === "print" || callee.name === "println") &&
    !shadowed.has(callee.name as string)
  ) {
    return callee.name as "print" | "println";
  }
  for (const k in n) {
    if (k === "span") continue;
    const v = n[k];
    if (Array.isArray(v)) {
      for (const c of v) {
        const hit = exprNodeCallsPrintBuiltin(c, shadowed);
        if (hit) return hit;
      }
    } else if (v && typeof v === "object") {
      const hit = exprNodeCallsPrintBuiltin(v, shadowed);
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Protected field detection (Trigger 2)
// ---------------------------------------------------------------------------

/**
 * Build a regex that matches `.fieldName` as a member access in an expression.
 *
 * Per DC-011: this is a conservative structural check. False negatives are
 * possible for aliased accesses. False positives are possible for field names
 * that appear as property names on non-db objects.
 */
function memberAccessRegex(fieldName: string): RegExp {
  return new RegExp(`\\.${escapeRegex(fieldName)}\\b`);
}

/**
 * Build a regex that matches `{ fieldName }` or `{ fieldName,` or `, fieldName }` etc.
 * in a destructuring pattern.
 */
function destructuringRegex(fieldName: string): RegExp {
  return new RegExp(`(?:^|[{,\\s])\\s*${escapeRegex(fieldName)}\\s*(?:[,}:])`);
}

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check a bare-expr string for direct member access of a protected field.
 */
function bareExprAccessesField(expr: string, fieldName: string): boolean {
  return memberAccessRegex(fieldName).test(expr);
}

/**
 * Check a let-decl or const-decl node for direct destructuring of a protected field.
 */
function declDestructuresField(init: string, fieldName: string): boolean {
  return destructuringRegex(fieldName).test(init);
}

// ---------------------------------------------------------------------------
// Call site extraction
// ---------------------------------------------------------------------------

/**
 * Pattern to match direct function calls: `identifierName(`
 * Does NOT match: `obj.method(` or `fn[x](`.
 */
const DIRECT_CALL_REGEX = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

/**
 * Pattern to detect computed member access.
 * `identifier[` — a computed property access.
 */
const COMPUTED_MEMBER_REGEX = /\b[A-Za-z_$][A-Za-z0-9_$]*\s*\[/;

/**
 * Extract direct callee names from a bare-expr string.
 * Returns an array of name strings (may contain duplicates).
 */
function extractCalleesFromExpr(expr: string): string[] {
  const names: string[] = [];
  const re = new RegExp(DIRECT_CALL_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Phase 4d: ExprNode-first callee extraction with string fallback. */
function extractCalleesFromNode(node: any, stringField: "expr" | "init"): string[] {
  const exprNodeField = stringField === "expr" ? "exprNode" : "initExpr";
  const en = node[exprNodeField] as ExprNode | undefined;
  if (en) return exprNodeCollectCallees(en);
  const str = node[stringField] ?? "";
  return str ? extractCalleesFromExpr(str) : [];
}

// ---------------------------------------------------------------------------
// AST walker utilities
// ---------------------------------------------------------------------------

/**
 * Collect all StateBlock nodes with stateType === 'db' from a FileAST's node tree.
 */
function collectDbBlocks(nodes: ASTNode[]): StateNode[] {
  const result: StateNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "state" && (node as StateNode).stateType === "db") {
      result.push(node as StateNode);
    }
    if ("children" in node && Array.isArray(node.children) && node.children.length > 0) {
      result.push(...collectDbBlocks(node.children as ASTNode[]));
    }
  }
  return result;
}

/**
 * Collect all function/fn nodes from a LogicStatement[] body tree.
 * Recurses into nested function bodies.
 */
function collectFunctionNodes(body: LogicStatement[]): FunctionDeclNode[] {
  const result: FunctionDeclNode[] = [];
  for (const node of body) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "function-decl") {
      result.push(node as FunctionDeclNode);
      if (Array.isArray((node as FunctionDeclNode).body)) {
        result.push(...collectFunctionNodes((node as FunctionDeclNode).body));
      }
    }
  }
  return result;
}

/**
 * Collect all top-level function nodes from a FileAST.
 * Searches inside LogicBlock nodes at the top level, then recurses.
 */
export function collectFileFunctions(fileAST: FileAST): FunctionDeclNode[] {
  const nodes: ASTNode[] = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []);
  const result: FunctionDeclNode[] = [];

  function visitNodes(astNodes: ASTNode[]): void {
    for (const node of astNodes) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic") {
        const logicNode = node as LogicNode;
        if (Array.isArray(logicNode.body)) {
          result.push(...collectFunctionNodes(logicNode.body));
        }
      }
      if (node.kind === "function-decl") {
        result.push(node as FunctionDeclNode);
        const fnNode = node as FunctionDeclNode;
        if (Array.isArray(fnNode.body)) {
          result.push(...collectFunctionNodes(fnNode.body));
        }
      }
      // Recurse into markup/state/meta children
      if ("children" in node && Array.isArray((node as any).children)) {
        visitNodes((node as any).children);
      }
    }
  }

  visitNodes(nodes);
  return result;
}

/**
 * Collect the span.start values of all function nodes that live inside a
 * nested <program name="..."> worker body.
 *
 * Worker programs are markup nodes with tag === "program" AND a non-empty
 * `name` attribute. The root <program> has no name attribute.
 *
 * Functions inside worker bodies cannot access protected fields or shared
 * reactive state — no DB access, no server escalation triggers are meaningful
 * there. E-ROUTE-001 is suppressed for these functions.
 */
function collectWorkerBodyFunctionIds(fileAST: FileAST): Set<number> {
  const nodes: ASTNode[] = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []);
  const result = new Set<number>();

  function visitNodes(astNodes: ASTNode[], insideWorker: boolean): void {
    for (const node of astNodes) {
      if (!node || typeof node !== "object") continue;

      // Detect a named <program name="..."> markup node — this is a worker body.
      let enteringWorker = insideWorker;
      if (node.kind === "markup" && (node as any).tag === "program") {
        const attrs: any[] = (node as any).attrs ?? [];
        const hasName = attrs.some(
          (a: any) => a && (a.name === "name" || a.key === "name") && (a.value || a.val),
        );
        if (hasName) {
          enteringWorker = true;
        }
      }

      // Collect all functions inside worker bodies.
      if (enteringWorker && node.kind === "logic") {
        const logicNode = node as LogicNode;
        if (Array.isArray(logicNode.body)) {
          for (const fn of collectFunctionNodes(logicNode.body)) {
            result.add(fn.span.start);
          }
        }
      }

      // Recurse into children.
      if ("children" in node && Array.isArray((node as any).children)) {
        visitNodes((node as any).children, enteringWorker);
      }
    }
  }

  visitNodes(nodes, false);
  return result;
}

// ---------------------------------------------------------------------------
// A2-FOLLOWUP (S99) — server-block stub rewriter
// ---------------------------------------------------------------------------

/**
 * A2-FOLLOWUP (S99 — A2-anomaly-2-surfaced): rewrite malformed
 * `server { ... }` block stubs inside function bodies.
 *
 * Background. The seeds-style idiom `export function foo() { server { ... } }`
 * (see examples/23-trucking-dispatch/seeds.scrml `runSeeds`) wraps a function
 * body in a `server { ... }` block to express developer intent that the body
 * is server-side. The language has no first-class `server-block` AST node;
 * `parseLogicBody` sees the bare keyword `server` (KEYWORD), falls through to
 * `collectExpr`, and the entire `server { ... }` text is captured as a single
 * `bare-expr` whose `exprNode` is `{kind:"ident", name:"server"}` and whose
 * `expr` field is the literal string `"server { ...body... }"` (with any
 * embedded `?{}` BLOCK_REFs rendered as `__scrml_sql_placeholder__`).
 *
 * Pre-A2 this gap was hidden — `export function` synth stubs carried an empty
 * `body: []`, so the bare-expr was never built. Post-A2 (commit c4fc98a),
 * `parseLogicBody` re-parses params + body on export synth stubs and the
 * bare-expr surfaces in the AST. Two downstream consequences:
 *
 *   1. TS's bare-expr scope walker (type-system.ts §2a, line ~4873) sees
 *      `exprNode.kind === "ident"` with `name === "server"` and fires
 *      E-SCOPE-001 (`Undeclared identifier `server``).
 *   2. RI's `walkBodyForTriggers` (line ~616) takes `emitStringFromTree(exprNode)`
 *      when `exprNode` is present — which returns just `"server"`, losing the
 *      entire wrapped body and missing the `?{}` SQL operations that would
 *      otherwise fire Trigger 1 (server-only-resource).
 *
 * Per SPEC §12.2, the compiler infers route placement from body content:
 * `?{}` is Trigger 1, server-only imports are Trigger 3, etc. The
 * `server { ... }` wrapper is developer-facing intent — semantically a
 * transparent wrapper that says "everything inside is server-side." Treating
 * it as a no-op wrapper is consistent with §12.2's "infer from body content"
 * rule.
 *
 * This pre-pass walks every function-decl body and detects the malformed
 * stub. The fix is minimal: clear the misleading `exprNode` (so TS's
 * E-SCOPE-001 walker skips the bare-expr — see type-system.ts line ~4873:
 * `if (beExprNode) { checkLogicExprIdents(...) }`). The raw `expr` string
 * is preserved verbatim. Downstream:
 *
 *   - TS: skips the scope check (no E-SCOPE-001 on `server`).
 *   - RI's walkBodyForTriggers: with `exprNode` cleared, line 616 falls
 *     through to `(node.expr ?? "")` — the raw text containing the embedded
 *     `?{}` patterns. SERVER_ONLY_PATTERNS[0] (`/\?\{/`) matches, pushing a
 *     `server-only-resource` Trigger 1 escalation. The enclosing function
 *     classifies as server-bound.
 *
 * Per pa.md Rule 3 + Rule 4 (SPEC normative): the rewriter is a uniform
 * "function body contains server block → function is server-bound" mechanism
 * via SPEC §12.2 Trigger 1, not a carve-out for `export function`. Bare
 * `function foo() { server { ... } }` and exported variants both flow
 * through the same code path because both produce the same malformed
 * bare-expr shape (the AST is identical post-A2 — see test fixture A2 in
 * unit tests).
 *
 * Out of scope per dispatch brief: introducing a new `server-block`
 * structured AST node (would require parseLogicBody changes — A2 surface).
 * The transparent-wrapper approach is structurally complete for the
 * route-inference goal: the function escalates via Trigger 1 because of the
 * `?{}` patterns inside, which is the spec-canonical mechanism.
 *
 * Mutates the AST in place. Idempotent: running twice is safe because the
 * second run finds `exprNode === null` and the guard `!exprNode` skips.
 */
function rewriteServerBlockStubs(files: FileAST[]): void {
  for (const fileAST of files) {
    const fnNodes = collectFileFunctions(fileAST);
    for (const fnNode of fnNodes) {
      const body = Array.isArray(fnNode.body) ? fnNode.body : [];
      visitForServerBlockStubs(body);
    }
  }
}

/**
 * Walk a LogicStatement[] body (recursively through control-flow blocks)
 * and rewrite any malformed `server { ... }` bare-expr stub.
 *
 * Does NOT descend into nested function-decl bodies — they are visited
 * independently by the outer per-function loop in {@link rewriteServerBlockStubs}.
 * This mirrors the convention used by {@link walkBodyForTriggers} (line ~862)
 * and {@link findReactiveAssignment} (line ~937).
 */
function visitForServerBlockStubs(body: any[]): void {
  for (const node of body) {
    rewriteIfServerBlockStub(node);
    if (!node || typeof node !== "object") continue;
    // Do not descend into nested function-decl bodies — those are walked
    // by the outer per-function loop with their own server-block detection.
    if (node.kind === "function-decl") continue;
    // Recurse into array-valued children (if-stmt.consequent, for-stmt.body,
    // while-stmt.body, try-stmt arms, etc.) so a `server { ... }` block
    // wrapped inside a control-flow block also gets rewritten.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        visitForServerBlockStubs(val);
      }
    }
  }
}

/**
 * Test whether a node is a malformed `server { ... }` block stub and, if so,
 * rewrite it in place. The detection criterion is conservative:
 *
 *   - kind === "bare-expr"
 *   - exprNode === {kind: "ident", name: "server"} (the parser's surface form)
 *   - raw `expr` starts with `server` followed by whitespace then `{`
 *     (the textual server-block opener)
 *
 * The rewrite mutates `exprNode` to `null` and marks `__serverBlockStub = true`.
 * The raw `expr` text is preserved so RI's `walkBodyForTriggers` can still
 * scan it for embedded `?{}` patterns (Trigger 1 escalation).
 */
function rewriteIfServerBlockStub(node: any): void {
  if (!node || typeof node !== "object") return;
  if (node.kind !== "bare-expr") return;
  const exprNode = node.exprNode;
  if (!exprNode || typeof exprNode !== "object") return;
  if (exprNode.kind !== "ident" || exprNode.name !== "server") return;
  const exprText = typeof node.expr === "string" ? node.expr : "";
  // Pattern: `server` keyword followed by optional whitespace + `{`. The
  // tokenized reconstruction inserts a space (`server {\n...`), but the
  // regex tolerates either form.
  if (!/^server\s*\{/.test(exprText)) return;
  // Mark and clear. With exprNode === null, TS's bare-expr scope walker
  // (type-system.ts §2a line ~4873) skips the identifier check entirely.
  // RI's walkBodyForTriggers falls through to `node.expr` (string), where
  // SERVER_ONLY_PATTERNS detects the embedded `?{}` and pushes a Trigger 1.
  node.__serverBlockStub = true;
  node.exprNode = null;
}

// ---------------------------------------------------------------------------
// FunctionNodeId
// ---------------------------------------------------------------------------

/**
 * Construct a FunctionNodeId from a filePath and a function node.
 */
function makeFunctionNodeId(filePath: string, fnNode: FunctionDeclNode): string {
  return `${filePath}::${fnNode.span.start}`;
}

// ---------------------------------------------------------------------------
// Route name generation
// ---------------------------------------------------------------------------

let _routeCounter = 0;

/**
 * Generate a deterministic compiler-internal route name.
 * Uses a counter + function name for human readability in error messages,
 * but this name is NOT user-visible.
 */
export function generateRouteName(functionName: string): string {
  _routeCounter++;
  const safe = (functionName || "anon").replace(/[^A-Za-z0-9_]/g, "_");
  return `__ri_route_${safe}_${_routeCounter}`;
}

// ---------------------------------------------------------------------------
// Trigger detection — body walker
// ---------------------------------------------------------------------------

/**
 * Walk a LogicStatement[] body and collect escalation triggers.
 *
 * Returns:
 *   triggers  — EscalationReason[] from direct body analysis (NOT transitive)
 *   callees   — string[] of directly-called function names (for transitive escalation)
 *   warnings  — RouteWarning[] for unresolvable callees (E-ROUTE-001)
 *
 * @param isWorkerBody — when true, E-ROUTE-001 is suppressed. Worker program bodies
 *   (<program name="...">) are isolated execution contexts with no access to protected
 *   fields or shared reactive state. Computed member access there is safe and expected
 *   (e.g., array indexing in sieve algorithms). Emitting E-ROUTE-001 inside workers
 *   would be noise with no actionable signal.
 */
export function walkBodyForTriggers(
  body: LogicStatement[],
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  filePath: string,
  isWorkerBody: boolean = false,
  /**
   * Insight 26 Batch 1 D2c (2026-05-08): names imported from server-only
   * runtime sources (`bun`, `bun:*`, `node:*`, server-only `scrml:*`).
   * When a bare-expr references such a name as a member-access subject
   * (e.g. `redis.get(key)` where `redis` is imported from "bun"), it
   * triggers server escalation.
   *
   * Defaults to empty set for back-compat with self-host RI and any
   * external callers.
   */
  importedServerNamespaces: Set<string> = new Set(),
  /**
   * §20.7.5 — the subset of `["print","println"]` the file SHADOWS via a
   * top-level `function print` / `println`. A shadowed name resolves to the
   * user function, NOT the host-stdout builtin, so it does NOT server-escalate.
   * Defaults to empty (no shadow) for back-compat with self-host RI / external
   * callers.
   */
  printBuiltinsShadowed: Set<string> = new Set(),
): WalkResult {
  const triggers: EscalationReason[] = [];
  const callees: string[] = [];
  const warnings: RouteWarning[] = [];

  /**
   * g-route-001 (sPA ss1 item 1): function-body-LOCAL array bindings whose
   * initializer is a copy-on-write array construction (e.g. `.slice()`, array
   * literal, `.map(...)`) AND references NO protected field. A computed-member
   * write on such a binding (`result[idx] = ...`) can NEVER reach a protected
   * record, so E-ROUTE-001 is suppressed for it.
   *
   * Populated in the let/const/tilde-decl branch (visited before nested
   * bare-exprs, since the decl is a top-level body statement and the write is
   * nested inside for/if). The set is function-body-scoped: a fresh walker
   * runs per function, so cross-function leakage is impossible.
   */
  const localArrayBindings = new Set<string>();

  /**
   * g-route-001: a binding initializer is array-COW (yields a fresh local
   * array with no protected provenance) when it matches one of these shapes.
   * Conservative: anything not matched here is NOT treated as a safe local,
   * so E-ROUTE-001 keeps firing (no false suppression).
   *
   *   - `.slice(`              — the flux `nonce.slice()` case
   *   - leading `[`            — array literal / spread (`[...xs]`, `[]`)
   *   - `.map(` `.filter(` `.concat(` `.flat(` `.flatMap(` — array-returning chains
   *   - `Array.from(` `Array(` `new Array(`
   *   - `Object.keys(` `Object.values(` `Object.entries(` — array-returning
   */
  function isArrayCowInit(init: string): boolean {
    const s = init.trim();
    if (s.startsWith("[")) return true;
    return (
      /\.slice\s*\(/.test(s) ||
      /\.map\s*\(/.test(s) ||
      /\.filter\s*\(/.test(s) ||
      /\.concat\s*\(/.test(s) ||
      /\.flat\s*\(/.test(s) ||
      /\.flatMap\s*\(/.test(s) ||
      /\bArray\s*\.\s*from\s*\(/.test(s) ||
      /\bnew\s+Array\s*\(/.test(s) ||
      /\bArray\s*\(/.test(s) ||
      /\bObject\s*\.\s*(keys|values|entries)\s*\(/.test(s)
    );
  }

  /**
   * g-route-001: does `init` reference any protected field, such that the
   * resulting array could carry protected provenance? Matches both
   * `record.field` member access (via bareExprAccessesField) AND a bare
   * leading `field` identifier at a member-receiver position
   * (`field.slice()`), so `let r = protectedField.slice()` is NOT suppressed.
   */
  function initReferencesProtectedField(init: string): boolean {
    for (const fieldName of protectedFields) {
      if (bareExprAccessesField(init, fieldName)) return true;
      // bare leading receiver: `field.` / `field[` / `field )`...
      if (new RegExp(`\\b${escapeRegex(fieldName)}\\b`).test(init)) return true;
    }
    return false;
  }

  /**
   * g-route-001: extract every computed-member receiver name from an
   * expression — the identifier immediately before each `[`. Returns the list
   * (may have duplicates; callers only care about membership).
   *   `result[idx] = result[idx] + 1` → ["result", "result"]
   *   `row[fieldKey]`                  → ["row"]
   */
  function computedMemberReceivers(expr: string): string[] {
    const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\[/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) out.push(m[1]);
    return out;
  }

  /**
   * D2c helper: scan an expression string for member-access references to
   * any name imported from a server-only runtime source. Returns the first
   * matching name, or null.
   *
   * Matches `\bNAME\.` (member access) — does NOT match `NAME(...)` direct
   * calls, which are already handled by `extractCalleesFromExpr` +
   * `importedServerFnNames` at the CPS layer.
   */
  function detectImportedServerNamespaceRef(expr: string): string | null {
    if (importedServerNamespaces.size === 0) return null;
    for (const name of importedServerNamespaces) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
      if (re.test(expr)) return name;
    }
    return null;
  }

  function visitNode(node: LogicStatement | ASTNode): void {
    if (!node || typeof node !== "object") return;

    // Trigger 1: ?{} SQL context — all database access is server-side by default.
    if (node.kind === "sql") {
      triggers.push({
        kind: "server-only-resource",
        resourceType: "sql-query",
        span: node.span,
      });
      return;
    }

    // dpa-003 (S216) Trigger 1: an inline `_={ … }=` foreign-code block drives
    // the host (process spawn / file IO) and is server-only — same color rule
    // as `?{}` (dpa-004 C2, mirrors E-SQL-004). Escalate the enclosing fn so
    // the opaque slice is emitted server-side and never reaches client output.
    if (node.kind === "foreign") {
      triggers.push({
        kind: "server-only-resource",
        resourceType: "foreign-inline",
        span: node.span,
      });
      return;
    }

    if (node.kind === "bare-expr") {
      // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
      const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");

      // Trigger 1: server-only resource access. Bun.*/process.* are detected on
      // the parsed exprNode (string/comment-safe, S252); the rest via string.
      const resourceType = detectServerOnlyResourceForNode((node as any).exprNode, expr);
      if (resourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType,
          span: node.span,
        });
      }

      // §20.7 Trigger 1 (host stdout) — AST-level, NOT string-scanned. A genuine
      // `print()` / `println()` builtin CallExpr writes host process.stdout (a
      // §12.2 Trigger-3 server-only resource), so a web-`<program>` fn calling
      // it is server-placed. Detected on the parsed `exprNode` (never a string
      // literal's contents / a comment — the fix for the raw-source false-match),
      // honoring the file's print/println shadow set (§20.7.5). Coverage matches
      // the former regex: print/println are statement-position (§20.7.1), so they
      // surface as a bare-expr, the only place detectServerOnlyResource ran.
      const printExprNode = (node as any).exprNode;
      if (printExprNode) {
        const printBuiltin = exprNodeCallsPrintBuiltin(printExprNode, printBuiltinsShadowed);
        if (printBuiltin !== null) {
          triggers.push({
            kind: "server-only-resource",
            resourceType: `${printBuiltin}() (host stdout)`,
            span: node.span,
          });
        }
      }

      // D2c (Insight 26): server-only namespace import member access.
      const nsRef = detectImportedServerNamespaceRef(expr);
      if (nsRef !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRef}`,
          span: node.span,
        });
      }

      // Trigger 2: protected field access via direct member expression.
      for (const fieldName of protectedFields) {
        if (bareExprAccessesField(expr, fieldName)) {
          triggers.push({
            kind: "protected-field-access",
            field: fieldName,
            stateBlockId: stateBlockIdByField.get(fieldName) ?? "",
          });
        }
      }

      // Callee extraction for transitive escalation.
      callees.push(...extractCalleesFromNode(node, "expr"));

      // E-ROUTE-001: computed member access warning.
      // Suppressed inside worker bodies — workers have no protected fields or shared
      // reactive state, so computed array indexing (e.g., flags[i]) is safe and expected.
      //
      // g-route-001 (sPA ss1 item 1): also suppressed when EVERY computed-member
      // receiver in the expr is a known function-body-local array binding (COW
      // init, no protected provenance) — such a receiver can never reach a
      // protected field. Fire only if at least one receiver is NOT a known-safe
      // local (i.e. a param/unknown receiver like `row[fieldKey]` that COULD be
      // a protected record).
      if (!isWorkerBody && COMPUTED_MEMBER_REGEX.test(expr)) {
        const receivers = computedMemberReceivers(expr);
        const hasUnsafeReceiver =
          receivers.length === 0 ||
          receivers.some((r) => !localArrayBindings.has(r));
        if (hasUnsafeReceiver) {
          warnings.push({
            code: "E-ROUTE-001",
            message:
              `E-ROUTE-001: Computed member access detected in expression \`${expr.slice(0, 80)}\`. ` +
              `The compiler cannot statically determine the accessed property name. ` +
              `If this accesses a protected field via a computed key, it will not be detected by route inference. ` +
              `Use a direct property access (e.g., \`row.fieldName\`) to ensure correct route placement.`,
            span: node.span,
            severity: "warning",
          });
        }
      }

      return; // Don't recurse into bare-expr text.
    }

    if (
      node.kind === "let-decl" ||
      node.kind === "const-decl" ||
      node.kind === "tilde-decl"
    ) {
      // Phase 4d: ExprNode-first, string fallback
      const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : ((node as any).init ?? "");

      // Trigger 2: protected field access via direct destructuring.
      for (const fieldName of protectedFields) {
        if (declDestructuresField(init, fieldName)) {
          triggers.push({
            kind: "protected-field-access",
            field: fieldName,
            stateBlockId: stateBlockIdByField.get(fieldName) ?? "",
          });
        }
      }

      // v0.2.4 bug-1-anomaly-2: when the AST builder attached a structured
      // sqlNode (because the initializer was `?{...}.method()` — see
      // ast-builder tryConsumeSqlInit, now wired into let/const-decl paths),
      // `init` is "" and `initExpr` is undefined. The SQL site is no longer
      // visible to detectServerOnlyResource(string), so we must trigger
      // escalation explicitly here. Mirrors the state-decl path below
      // (line ~731). Without this, server-inferred functions whose ONLY
      // trigger was `const x = ?{...}.get()` lose their route classification
      // (e.g. postNote() in examples/17-schema-migrations.scrml regressed
      // pre-this-line: W-DEAD-FUNCTION + E-CG-006 leak as the body was
      // emitted to the client unchanged).
      if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "sql-query",
          span: node.span,
        });
      }

      // dpa-003 (S216): a `const/let x = _={ … }=` foreign-init escalates the
      // enclosing fn to server (the attached `foreignNode` is invisible to the
      // string-scanning detectServerOnlyResource — mirror the sqlNode trigger).
      if ((node as any).foreignNode && (node as any).foreignNode.kind === "foreign") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "foreign-inline",
          span: node.span,
        });
      }

      // Trigger 1: server-only resource in the init expression (e.g. ?{} SQL sigil, Bun.file(), etc.)
      const resourceType = detectServerOnlyResourceForNode((node as any).initExpr, init);
      if (resourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType,
          span: node.span,
        });
      }

      // D2c (Insight 26): server-only namespace import member access in init.
      const nsRefInit = detectImportedServerNamespaceRef(init);
      if (nsRefInit !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRefInit}`,
          span: node.span,
        });
      }

      // Callee extraction from the init expression.
      callees.push(...extractCalleesFromNode(node, "init"));

      // g-route-001 (sPA ss1 item 1): record function-body-local array bindings
      // whose init is COW (yields a fresh local array) AND references no
      // protected field. A computed-member write on such a binding later in the
      // body can never reach a protected record, so E-ROUTE-001 is suppressed
      // for it. Only the simple named-decl case is recorded; destructuring /
      // unnamed decls are skipped (conservative — they keep warning).
      const declName = (node as any).name;
      if (
        typeof declName === "string" &&
        declName.length > 0 &&
        isArrayCowInit(init) &&
        !initReferencesProtectedField(init)
      ) {
        localArrayBindings.add(declName);
      }

      return;
    }

    if (node.kind === "state-decl") {
      // @name = expr — state-decl IS an assignment to an @-prefixed identifier.
      // Also scan the init for server-only resources and callees.
      // Phase 4d: ExprNode-first, string fallback
      const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : ((node as any).init ?? "");

      // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the AST
      // builder attached a structured sqlNode (because the initializer was
      // `?{...}.method()` — see ast-builder tryConsumeSqlInit), `init` is
      // "" and `initExpr` is undefined. The SQL site is no longer visible
      // to detectServerOnlyResource(string), so we must trigger escalation
      // explicitly here. Mirrors the trigger-1 path for direct `sql` nodes
      // at the top of visitNode (line ~537). Without this, server-only
      // functions whose ONLY trigger was `@x = ?{...}` lose their route
      // (e.g. refreshList() in combined-007-crud.scrml regressed pre-fix to
      // having no emitted route).
      if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "sql-query",
          span: node.span,
        });
      }

      // Trigger 1: server-only resource in the init expression (e.g. ?{} SQL sigil).
      // Matches the same check applied to let-decl/const-decl/tilde-decl above.
      const reactDeclResourceType = detectServerOnlyResourceForNode((node as any).initExpr, init);
      if (reactDeclResourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: reactDeclResourceType,
          span: node.span,
        });
      }

      // D2c (Insight 26): server-only namespace import member access in init.
      const nsRefStateInit = detectImportedServerNamespaceRef(init);
      if (nsRefStateInit !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRefStateInit}`,
          span: node.span,
        });
      }

      callees.push(...extractCalleesFromNode(node, "init"));
      return;
    }

    // S93 cg-006 fix (Layer 1): return-stmt / throw-stmt with a structured
    // `sqlNode` field (produced by ast-builder.js:4755-4773 for `return ?{...}.method()`).
    // Pre-fix, visitNode had no explicit handler for return-stmt/throw-stmt — the
    // generic array-recursion fallback at the bottom of this function does NOT
    // see `sqlNode` (it is a plain object, not an array). Result: a function whose
    // ONLY server-only resource is in a `return ?{...}` expression never got a
    // server-trigger pushed, so RI classified the function as client-boundary and
    // the SQL body landed in `.client.js` (caught post-emission by E-CG-006).
    //
    // Mirrors the let-decl / const-decl / tilde-decl / state-decl handlers above
    // which already check `(node as any).sqlNode?.kind === "sql"`.
    //
    // Reproducer: examples/23-trucking-dispatch/app.scrml `getCurrentUser`
    // (file-scope `<db>` body fn with body `return ?{`SELECT ...`}.get()`).
    if (node.kind === "return-stmt" || node.kind === "throw-stmt") {
      if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "sql-query",
          span: node.span,
        });
      }
      // dpa-003 (S216): `return _={ … }=` foreign-init escalates to server.
      if ((node as any).foreignNode && (node as any).foreignNode.kind === "foreign") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "foreign-inline",
          span: node.span,
        });
      }
      // Also walk the expr / exprNode string surface for any SQL / Bun / env()
      // patterns that DO live in the string (vs the sqlNode attachment). The
      // ast-builder only attaches `sqlNode` for the special `return ?{...}` /
      // `throw ?{...}` shape; other server-only patterns inside complex return
      // expressions (e.g. `return foo(?{...}.get())`) still go through `expr`.
      const expr = (node as any).exprNode
        ? emitStringFromTree((node as any).exprNode)
        : ((node as any).expr ?? "");
      const resourceType = detectServerOnlyResourceForNode((node as any).exprNode, expr);
      if (resourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType,
          span: node.span,
        });
      }
      const nsRefRet = detectImportedServerNamespaceRef(expr);
      if (nsRefRet !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRefRet}`,
          span: node.span,
        });
      }
      // Protected field access inside a return expression (mirrors bare-expr handler).
      for (const fieldName of protectedFields) {
        if (bareExprAccessesField(expr, fieldName)) {
          triggers.push({
            kind: "protected-field-access",
            field: fieldName,
            stateBlockId: stateBlockIdByField.get(fieldName) ?? "",
          });
        }
      }
      // Callees inside the return expression.
      callees.push(...extractCalleesFromNode(node, "expr"));
      return;
    }

    // S93 cg-006 fix (Layer 1, continued): lift-expr inside a function body —
    // `lift ?{...}.method()` shape stores SQL under `expr: { kind: "sql", node: <sqlNode> }`
    // (ast-builder.js similar to return-stmt path). Walk lift's sql-bearing child.
    if (node.kind === "lift-expr") {
      const liftE = (node as any).expr;
      if (liftE && liftE.kind === "sql") {
        triggers.push({
          kind: "server-only-resource",
          resourceType: "sql-query",
          span: node.span,
        });
      }
      // Fall through to the generic recursion below so any nested logic
      // (e.g. lift markup with bare-expr children) still gets walked.
    }

    // Nested function-decl.
    //
    // g-sql-in-nested-function-client-leak (S225): a nested function that uses
    // a server-only resource (a `?{}` SQL block, an inline `_={ … }=` foreign
    // block, a server-only import-namespace member access, or a protected-field
    // read) must escalate its ENCLOSING function to server. Codegen emits a
    // nested `function-decl` INLINE inside its parent's body — collect.ts
    // `collectFunctions` does NOT recurse into nested bodies, so a nested
    // declaration never becomes its own server route. The ONLY way to keep a
    // nested `?{}` off the client (no `_scrml_sql` leak, no E-CG-006, no silent
    // `return null` SQL stub) is to server-place the parent; once the parent is
    // server-bound the nested body is emitted server-side intact.
    //
    // The recursive `walkBodyForTriggers` re-runs the SAME server-trigger
    // detection over the nested body (and, transitively, fn-in-fn-in-fn — its
    // own function-decl case recurses again), so the OUTERMOST enclosing
    // function that lexically contains a server-only resource escalates. We
    // merge ONLY the server-escalation triggers (`server-only-resource` /
    // `protected-field-access`) — the nested fn's callees and E-ROUTE-001
    // warnings belong to its OWN analysis entry (every nested fn is collected
    // by `collectFileFunctions`), so re-collecting them here would double-count.
    //
    // S215 partition: a nested function that touches NO server-only resource
    // yields NO trigger, so a genuinely-client nested helper never drags its
    // parent server-side (the partition holds).
    if (node.kind === "function-decl") {
      const nestedBody = Array.isArray((node as any).body) ? (node as any).body : [];
      if (nestedBody.length > 0) {
        const nested = walkBodyForTriggers(
          nestedBody,
          protectedFields,
          stateBlockIdByField,
          filePath,
          isWorkerBody,
          importedServerNamespaces,
          printBuiltinsShadowed,
        );
        for (const t of nested.triggers) {
          if (t.kind === "server-only-resource" || t.kind === "protected-field-access") {
            triggers.push(t);
          }
        }
      }
      return;
    }

    // S93 fix — guarded-expr wraps the previous statement node with the `!{}`
    // error-effect handler (ast-builder.js:6019). For `let X = fn() !{ ... }`,
    // the AST shape is guarded-expr{guardedNode: let-decl{name, initExpr},
    // arms: [...]}. The wrapped let-decl + its initExpr (containing the
    // `fn()` call) is a SINGLE-OBJECT field — the generic-fallback recursion
    // below only walks ARRAY fields and misses it. Without explicit handling,
    // the call inside `fn() !{...}` is invisible to the call-graph walker
    // and the callee (e.g. `validate` in examples/09-error-handling.scrml's
    // handleSubmit) is wrongly classified as dead (W-DEAD-FUNCTION false
    // positive).
    if (node.kind === "guarded-expr") {
      const wrapped = (node as any).guardedNode;
      if (wrapped && typeof wrapped === "object") visitNode(wrapped);
      const arms = (node as any).arms;
      if (Array.isArray(arms)) {
        for (const arm of arms) {
          const armBody = arm?.body;
          if (Array.isArray(armBody)) {
            for (const stmt of armBody) visitNode(stmt);
          }
        }
      }
      return;
    }

    // S121 Wave 10 Unit P fix — collect callees from object-valued ExprNode
    // fields that the array-only generic-fallback below would silently skip.
    //
    // Statement kinds that fall through to the generic recursion (if-stmt,
    // while-stmt, for-stmt, match-stmt, switch-stmt, match-arm-inline,
    // reactive-nested-assign, etc.) carry their primary expression payload
    // in a SINGLE-OBJECT ExprNode field — `condExpr` / `iterExpr` /
    // `headerExpr` / `resultExpr` / `valueExpr`. The array-fields-only
    // recursion at the bottom of this function never visits these, so a
    // call inside `if (helper(x))` or `while (helper())` was invisible to
    // the call-graph walker. Result: helper appeared dead and
    // W-DEAD-FUNCTION false-fired even though the source called it.
    //
    // The fix mirrors the existing string-field handling (let-decl /
    // const-decl init, bare-expr expr) — extract callees from the ExprNode
    // tree via exprNodeCollectCallees and push to the callees array.
    //
    // S122 Wave 12 Unit Y — sister fix: TRIGGER DETECTION on the same
    // EXPR_NODE fields. Pre-Y, a function whose only server signal was
    // `while (?{`SELECT ...`}.get())` (SQL inside a while condExpr) or
    // `if (row.passwordHash)` (protected field inside an if condExpr) would
    // mis-classify as client because the string-based Trigger 1/2 detectors
    // only ran against bare-expr/let-decl/state-decl/return-stmt's STRING
    // field surface. For each ExprNode field we now also emit the
    // canonical string via emitStringFromTree and apply the same three
    // detectors (server-only-resource, imported-server-namespace,
    // protected-field-access) used by the bare-expr branch above.
    //
    // Mirrors the sister-walker markupReferencedNames EXPR_NODE_FIELDS scan
    // at L2649-2654 (closed S95 Bug 7 / Bug 4 markup-context callsites);
    // mirrors the per-kind guarded-expr fix at L1143-1156 (S93 d437589a,
    // closed the failable-call-in-let-init class).
    const EXPR_NODE_TRIGGER_FIELDS = [
      "condExpr",    // if-stmt, if-expr, while-stmt
      "iterExpr",    // for-stmt, for-expr
      "headerExpr",  // switch-stmt, match-stmt, match-expr
      "resultExpr",  // match-arm-inline
      "valueExpr",   // reactive-nested-assign
    ] as const;
    /**
     * Run callee + trigger detection against a single ExprNode-bearing field.
     * Factored so the cStyleParts triple uses the identical scan.
     */
    function scanExprNodeField(v: any): void {
      if (!v || typeof v !== "object" || typeof v.kind !== "string") return;
      // Callees (Wave 10 Unit P).
      callees.push(...exprNodeCollectCallees(v));
      // Triggers (Wave 12 Unit Y) — same three string-based detectors used
      // by the bare-expr branch (L885-914). emitStringFromTree round-trips
      // the ExprNode to its canonical string surface so the regex-based
      // detectors see the same text they would on a string-field initializer.
      let exprStr: string;
      try { exprStr = emitStringFromTree(v); } catch { return; }
      // Trigger 1: server-only resource access. `v` IS the ExprNode, so the
      // Bun.*/process.* namespace set is detected string/comment-safe (S252).
      const resourceType = detectServerOnlyResourceForNode(v, exprStr);
      if (resourceType !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType,
          span: node.span,
        });
      }
      // D2c (Insight 26): server-only namespace import member access.
      const nsRef = detectImportedServerNamespaceRef(exprStr);
      if (nsRef !== null) {
        triggers.push({
          kind: "server-only-resource",
          resourceType: `imported-server-namespace:${nsRef}`,
          span: node.span,
        });
      }
      // Trigger 2: protected field access via direct member expression.
      for (const fieldName of protectedFields) {
        if (bareExprAccessesField(exprStr, fieldName)) {
          triggers.push({
            kind: "protected-field-access",
            field: fieldName,
            stateBlockId: stateBlockIdByField.get(fieldName) ?? "",
          });
        }
      }
    }
    for (const field of EXPR_NODE_TRIGGER_FIELDS) {
      scanExprNodeField((node as any)[field]);
    }
    // for-stmt C-style header: cStyleParts = { initExpr, condExpr, updateExpr } —
    // a nested object holding three ExprNodes. Scan each in turn.
    const cParts = (node as any).cStyleParts;
    if (cParts && typeof cParts === "object") {
      for (const k of ["initExpr", "condExpr", "updateExpr"] as const) {
        scanExprNodeField(cParts[k]);
      }
    }

    // For all other node kinds, recursively visit array fields.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          visitNode(child);
        }
      }
    }
  }

  for (const node of body) {
    visitNode(node);
  }

  return { triggers, callees, warnings };
}

/**
 * Check whether a function body directly contains an assignment to an @-prefixed
 * identifier (state-decl nodes) or an AT_IDENT in assignment position in a bare-expr.
 *
 * Per §12.7: "RI walks the parsed function body for assignment expressions where the
 * left-hand side is an AT_IDENT token in assignment position."
 */
function findReactiveAssignment(body: LogicStatement[]): LogicStatement | null {
  function visitNode(node: LogicStatement): LogicStatement | null {
    if (!node || typeof node !== "object") return null;

    // state-decl is the canonical AT_IDENT assignment form.
    if (node.kind === "state-decl") {
      return node;
    }

    // Also check bare-expr for @name = pattern.
    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    if (node.kind === "bare-expr") {
      const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");
      if (/\B@[A-Za-z_$][A-Za-z0-9_$]*\s*=[^=]/.test(expr)) {
        return node;
      }
      return null;
    }

    // Do not recurse into nested function bodies.
    if (node.kind === "function-decl") {
      return null;
    }

    // Recurse into array children.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          const found = visitNode(child);
          if (found !== null) return found;
        }
      }
    }

    return null;
  }

  for (const node of body) {
    const found = visitNode(node);
    if (found !== null) return found;
  }

  return null;
}

/**
 * Extract the @-cell name from a LogicStatement returned by
 * {@link findReactiveAssignment}. Returns `null` if the LHS is not a
 * canonical `@<ident> = <expr>` shape (compound assignment `+=`, dotted
 * member targets, etc.).
 *
 * Used by the channel-scoped server-fn E-RI-002 skip path (Bug 5 / §38.4):
 * the skip applies only to writes whose LHS is exactly one of the channel-
 * owned cells declared in the function's channel body.
 */
function extractReactiveAssignmentCellName(node: LogicStatement): string | null {
  if (!node || typeof node !== "object") return null;

  // state-decl: LHS name lives on the node directly.
  if (node.kind === "state-decl") {
    const name = (node as any).name;
    return typeof name === "string" && name.length > 0 ? name : null;
  }

  // bare-expr: prefer the structured exprNode (assign with @ident target,
  // op === "=") and fall back to a string-shape match for the legacy /
  // string-only path.
  if (node.kind === "bare-expr") {
    const exprNode = (node as any).exprNode;
    if (exprNode && exprNode.kind === "assign" && exprNode.op === "=" && exprNode.target) {
      const target = exprNode.target;
      if (target.kind === "ident" && typeof target.name === "string" && target.name.startsWith("@")) {
        return target.name.slice(1);
      }
    }
    const expr: string = exprNode ? emitStringFromTree(exprNode) : ((node as any).expr ?? "");
    // Match `@name =` (but not `@name ==`, `@name +=`, etc.) at any position.
    const m = expr.match(/\B@([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)(?![+\-*/%&|^])/);
    return m ? m[1] : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// §12.2 Trigger 7b (server-keyword-eliminate D2; AMENDED change-id
// `channel-cell-write-client-side-A-2026-06-12`, RULING A) — broadcast() /
// disconnect() escalation.
// ---------------------------------------------------------------------------

/**
 * Scan a standalone-function body for the §12.2 Trigger-7b escalation signal and
 * return the `channel-broadcast` reason found. The function is presumed to
 * already be lexically inside a `<channel>` body (the caller gates on
 * `perFileChannelFnMap`). The ONE escalating signal is:
 *
 *   - a call to `broadcast(...)` or `disconnect()` anywhere in the body (§38.6
 *     server hub ops — server-placement signals).
 *
 * RULING A amendment (S189, change-id `channel-cell-write-client-side-A`):
 *   A source-level WRITE to a channel-declared cell is NO LONGER an escalation
 *   signal. Under the v0.3 client-held channel model (§38.4 — there is NO
 *   server-authoritative cell store), a channel-cell write is a CLIENT-side
 *   sync-emitting operation: the client mutates the cell locally and the
 *   `syncShared` reactive effect distributes the write via the `__sync` wire
 *   path (§38.7, emit-channel.ts). This is exactly what `onclient:*` handlers
 *   that write a channel cell already do (§38.10). Dropping the former
 *   sub-clause (a) makes a pure cell-write publisher stay client-side, so the
 *   former server-side `_scrml_body["<cell>"]`-undefined read crash is gone.
 *   Only `broadcast()`/`disconnect()` (server hub ops) remain placement signals.
 *
 * Over-fire discipline (LOAD-BEARING):
 *   - READS of a channel cell do NOT escalate; WRITES no longer escalate either.
 *     Only the two broadcast/disconnect built-in calls escalate here.
 *   - Does NOT descend into nested `function-decl` bodies — each declaration is
 *     analyzed for its own direct triggers (mirrors `walkBodyForTriggers`).
 *   - Returns AT MOST ONE reason; a single reason keeps the diagnostic surface
 *     clean.
 *
 * The detection is deliberately syntactic (string + structured exprNode) to
 * match the rest of RI's direct-trigger machinery.
 */
function detectChannelBroadcastReason(
  body: LogicStatement[],
): EscalationReason | null {
  if (!Array.isArray(body) || body.length === 0) return null;

  let found: EscalationReason | null = null;

  function exprTextOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.exprNode) return emitStringFromTree(node.exprNode);
    if (node.valueExpr) return emitStringFromTree(node.valueExpr);
    if (typeof node.expr === "string") return node.expr;
    return "";
  }

  function visit(node: any): void {
    if (found !== null) return;
    if (!node || typeof node !== "object") return;

    // broadcast(...) / disconnect() call — match a call expression at the
    // start of a callee token. `\b` boundaries prevent matching a member
    // suffix like `obj.broadcast(` only when it is a method call; the §38.6
    // built-ins are bare calls, so we require a non-member boundary.
    if (node.kind === "bare-expr" || node.kind === "return-stmt" || node.kind === "state-decl"
        || node.kind === "let-decl" || node.kind === "const-decl" || node.kind === "tilde-decl") {
      const txt = exprTextOf(node);
      if (/(^|[^.\w$])(broadcast|disconnect)\s*\(/.test(txt)) {
        const which = /(^|[^.\w$])broadcast\s*\(/.test(txt) ? "broadcast()" : "disconnect()";
        found = {
          kind: "channel-broadcast",
          detail: `${which} call`,
          span: (node as any).span,
        };
        return;
      }
    }

    // Do NOT recurse into nested function-decl bodies — each is analyzed for
    // its own direct triggers.
    if (node.kind === "function-decl") return;

    // Recurse into array-valued children (if/for/while bodies, etc.).
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id" || key === "exprNode" || key === "valueExpr") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          visit(child);
          if (found !== null) return;
        }
      }
    }
  }

  for (const stmt of body) {
    visit(stmt);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §38.4 / §38.6.1 — server-context channel-cell READ detection
// (change-id `channel-cell-write-client-side-A-2026-06-12`, RULING A, Part 2).
// ---------------------------------------------------------------------------

/**
 * Scan a SERVER-context channel function's body for a READ of a channel-declared
 * cell. Returns the first offending cell name + span, or `null` when the body
 * reads no channel cell.
 *
 * RULING A (S189): channel cells are CLIENT-HELD (§38.4 — no server-authoritative
 * cell store). A function the compiler has placed on the SERVER (escalated via
 * `broadcast()`/`disconnect()`, an `onserver:*` handler per §38.6.1, or any other
 * §12.2 trigger such as a `?{}` SQL block) therefore has NO server-side value for
 * a channel cell — a read lowers to `_scrml_body["<cell>"]` (HTTP body) or the
 * empty `{}` fallback (WS handler), both of which are `undefined` at runtime, so
 * `[...@cell, x]` crashes silently. This is `E-CHANNEL-SERVER-CELL-READ` (§34).
 *
 * Detection (deliberately structural, mirroring the rest of RI):
 *   - Walk every ExprNode-bearing field of each body statement
 *     (`initExpr` / `exprNode` / `valueExpr`) via `forEachIdentInExprNode`, which
 *     visits IdentExpr nodes (including the `@`-prefixed reactive reads) and does
 *     NOT scan inside string-literal content (avoids the F-RI-001 string class).
 *   - An `@<name>` IdentExpr whose bare name (`<name>` without the `@`) is a
 *     channel-declared cell is a channel-cell READ.
 *   - The LHS write-target name of a `state-decl` reactive assignment is NOT a
 *     read (it is the assignment target). A `@<cell>` on the RHS of that same
 *     assignment IS a read (e.g. `@updates = [...@updates, x]` reads `@updates`).
 *   - Does NOT descend into nested `function-decl` bodies (own scope, own
 *     analysis), mirroring `detectChannelBroadcastReason`.
 */
function detectServerContextChannelCellRead(
  body: LogicStatement[],
  channelCells: Set<string>,
): { cell: string; span: Span | undefined } | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  if (channelCells.size === 0) return null;

  let found: { cell: string; span: Span | undefined } | null = null;

  function scanExprForCellRead(exprNode: any, span: Span | undefined): void {
    if (found !== null || !exprNode) return;
    forEachIdentInExprNode(exprNode, (ident: any) => {
      if (found !== null) return;
      const nm: string = ident?.name ?? "";
      if (nm.length > 1 && nm[0] === "@") {
        const bare = nm.slice(1);
        if (channelCells.has(bare)) {
          found = { cell: bare, span };
        }
      }
    });
  }

  function visit(node: any): void {
    if (found !== null) return;
    if (!node || typeof node !== "object") return;

    // Walk the value-expression fields for `@<channelCell>` reads. The LHS
    // write-target of a state-decl is `node.name` (no `@`), which these expr
    // fields never contain — so a RHS read of the same cell is still caught.
    const sp: Span | undefined = (node as any).span;
    scanExprForCellRead((node as any).initExpr, sp);
    scanExprForCellRead((node as any).exprNode, sp);
    scanExprForCellRead((node as any).valueExpr, sp);
    if (found !== null) return;

    // Do NOT recurse into nested function-decl bodies — own scope.
    if (node.kind === "function-decl") return;

    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id" || key === "initExpr"
          || key === "exprNode" || key === "valueExpr") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          visit(child);
          if (found !== null) return;
        }
      }
    }
  }

  for (const stmt of body) {
    visit(stmt);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §6.6.9 / §12 (RULING A) — E-REACTIVE-003: free client-cell read in a
// server-escalated function. The read-side sibling of E-RI-002 (server fn
// *assigns* @reactive). A `@<cell>` read of a client-held reactive cell lowers,
// server-side (emit-expr.ts), to `_scrml_body["<cell>"]`; the client fetch stub
// sends only declared params, so the value is NOT transported and resolves to
// `undefined` at request time. Force the author to pass it explicitly (arguments
// ARE marshalled) or declare a §52 `<... server>` authority cell.
// ---------------------------------------------------------------------------

/**
 * Collect the file's CLIENT-HELD reactive cell names (every `state-decl`), each
 * mapped to whether it is a `const <name>` derived (for message wording).
 *
 * INCLUDES §52 `<... server>` authority cells (`isServer === true`). Ruling THE
 * SPLIT correction: a `<... server>` cell is CLIENT-HELD (compiler-hydrated on
 * mount, §52.4.2; the persist is the developer's own `?{}` fn, §52.6.2) — there
 * is NO server-side cell store, so a server-side read lowers to
 * `_scrml_body["<cell>"]` and resolves to `undefined` exactly like any other
 * client cell. It therefore errors in a wholly-server fn and marshals in a CPS
 * fn, identically to a plain client cell. (The earlier "§52 is server-resolved"
 * premise was empirically false.) Ambient identity (`@session`/`@currentUser`)
 * is a compiler-provided singleton, not a `state-decl`, so it is absent here.
 */
function collectClientReactiveCells(nodes: any[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const visit = (list: any[]): void => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "state-decl" && typeof node.name === "string") {
        out.set(node.name, node.shape === "derived");
      }
      if (node.kind === "logic" && Array.isArray(node.body)) visit(node.body);
      if (Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(nodes);
  return out;
}

/**
 * Scan a SERVER-escalated function body for FREE CLIENT-CELL reads — a
 * `@<name>` read whose bare name is in `clientCells` and NOT in `exclude`
 * (channel cells own E-CHANNEL-SERVER-CELL-READ, fired separately). Returns an
 * ORDERED, de-duplicated list of `{ cell, span, derived }`.
 *
 * Reads are gathered from TWO surfaces (SQL-aware, verified against real parser
 * output): every ExprNode `{ kind:"ident", name:"@<name>" }` reachable by
 * full-node recursion (covers `let x = @c + 1`, `if (@c > 3)`, `log(@c)`,
 * `return @c`, nested `binary`/`call`/`args`), AND `sql` node `query` RAW text —
 * a `?{...}` template stores its interpolations as query TEXT, not ExprNodes (the
 * ident-walker leaf-stops at `sql-ref`), so the SQL body is scanned by an
 * `@name` regex. Does NOT descend into nested `function-decl` bodies (own scope).
 * The LHS write-target of a `state-decl` is `node.name` (no `@`), so it is never
 * a read (that write is E-RI-002's concern).
 */
function detectServerFreeClientCellReads(
  body: any[],
  clientCells: Map<string, boolean>,
  exclude: Set<string>,
): Array<{ cell: string; span: Span | undefined; derived: boolean }> {
  const out: Array<{ cell: string; span: Span | undefined; derived: boolean }> = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();
  if (!Array.isArray(body) || clientCells.size === 0) return out;

  const record = (bare: string, span: Span | undefined): void => {
    if (seen.has(bare) || !clientCells.has(bare) || exclude.has(bare)) return;
    seen.add(bare);
    out.push({ cell: bare, span, derived: clientCells.get(bare) === true });
  };

  const scanSql = (text: string, span: Span | undefined): void => {
    const re = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) record(m[1], span);
  };

  const visit = (node: any, stmtSpan: Span | undefined): void => {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (node.kind === "function-decl") return;
    const sp: Span | undefined = (node.span && typeof node.span === "object") ? node.span : stmtSpan;
    if (node.kind === "ident" && typeof node.name === "string"
        && node.name.length > 1 && node.name.charCodeAt(0) === 0x40 /* @ */) {
      record(node.name.slice(1), sp);
    }
    if (node.kind === "sql" && typeof node.query === "string") scanSql(node.query, sp);
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) { for (const c of val) visit(c, sp); }
      else if (val && typeof val === "object") visit(val, sp);
    }
  };

  for (const stmt of body) visit(stmt, (stmt && typeof stmt === "object") ? (stmt as any).span : undefined);
  return out;
}

// ---------------------------------------------------------------------------
// §12.4 E-ROUTE-002 — client-pin body scan.
// ---------------------------------------------------------------------------

/**
 * Scan a function body for a DOM-only GLOBAL access (§12.4 client-pin). One hit
 * is sufficient to pin the function to the client, so the FIRST is returned:
 * `{ resource, span }` (e.g. `{ resource: "document.title", span }`) or null.
 *
 * Recurses the parsed-ExprNode surface of every statement (via full-node
 * recursion, like `detectServerFreeClientCellReads`), STOPPING at EVERY
 * function-boundary node — a nested `function-decl` AND a `lambda`
 * (arrow / `fn` / inline `function` expression). A DOM access inside a callback
 * (`register(() => { document.title = x })`) belongs to the CALLBACK's own
 * placement, not the enclosing function, so it must not be misattributed here
 * (S263 review #3). The ONE exception is an EXPR-body IIFE — a lambda invoked in
 * place, `(() => document.title = x)()` — which DOES run where the enclosing fn
 * runs, so it is scanned into (with the IIFE's params extending the shadow;
 * S263 review #5). Detection is delegated to `clientOnlyGlobalAccessOfNode`,
 * which matches ONLY a genuine `member` node rooted at an UN-shadowed DOM global
 * — string/comment-safe, scope-aware, no raw-text fallback.
 *
 * `shadowedRoots` is the set of client-global root names bound by an in-scope
 * local / param / import (see `computeFileClientPins`); a `member` rooted at a
 * shadowed name is a domain object, not the DOM global, and does not pin.
 */
function detectClientOnlyGlobalAccess(
  body: LogicStatement[],
  shadowedRoots: Set<string>,
): { resource: string; span: Span | undefined } | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const visited = new WeakSet<object>();
  let found: { resource: string; span: Span | undefined } | null = null;

  // `shadow` is threaded so an IIFE's own params can extend it for the in-place
  // scan (S263 review #5) — a `(({window}) => window.title)(x)` must not fire.
  const visit = (node: any, shadow: Set<string>, stmtSpan: Span | undefined): void => {
    if (found !== null) return;
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    const sp: Span | undefined =
      node.span && typeof node.span === "object" ? node.span : stmtSpan;

    // IIFE (S263 review #5): an EXPR-body arrow lambda invoked IN PLACE —
    // `(() => document.title = x)()` — runs where the enclosing fn runs, so its
    // DOM access DOES pin the enclosing fn. Scan into the invoked lambda's expr
    // body with the shadow extended by the lambda's own params; then fall
    // through to scan the call's ARGS (which stop at their own lambdas — a
    // passed callback is a separate placement). A NON-invoked lambda still stops
    // below. (Block-body IIFEs are a documented residual — §12.4; the block-body
    // arrow form is rejected as E-FN-ARROW-BODY, and `fn()`/`function()` IIFEs
    // do not leak.)
    if (
      node.kind === "call" &&
      node.callee && typeof node.callee === "object" &&
      node.callee.kind === "lambda" &&
      node.callee.body && node.callee.body.kind === "expr"
    ) {
      const iifeShadow = new Set(shadow);
      addParamRoots(iifeShadow, node.callee.params);
      visit(node.callee.body.value, iifeShadow, sp);
      if (found !== null) return;
      // Scan the call's args (and any other fields) with the ORIGINAL shadow,
      // but skip the callee (already handled; the generic loop would stop at it).
      for (const key of Object.keys(node)) {
        if (key === "span" || key === "callee") continue;
        const val = node[key];
        if (Array.isArray(val)) {
          for (const c of val) { visit(c, shadow, sp); if (found !== null) return; }
        } else if (val && typeof val === "object") {
          visit(val, shadow, sp);
          if (found !== null) return;
        }
      }
      return;
    }

    // Do NOT descend into a nested function boundary — own scope. A nested
    // `function-decl` is analyzed as its own route node; a `lambda` callback's
    // placement is its own (its DOM access is not the enclosing fn's).
    if (node.kind === "function-decl" || node.kind === "lambda") return;

    const hit = clientOnlyGlobalAccessOfNode(node, shadow);
    if (hit !== null) {
      found = { resource: hit, span: sp };
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const c of val) {
          visit(c, shadow, sp);
          if (found !== null) return;
        }
      } else if (val && typeof val === "object") {
        visit(val, shadow, sp);
        if (found !== null) return;
      }
    }
  };

  for (const stmt of body) {
    visit(stmt, shadowedRoots, stmt && typeof stmt === "object" ? (stmt as any).span : undefined);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §12.4 E-ROUTE-002 — scope-aware client-pin computation (S263 review #2/#3).
//
// Client-pin detection is SCOPE-AWARE so a local / param / import named
// `document` or `window` (a domain object) is not mistaken for the DOM global.
// `computeFileClientPins` threads the lexical shadow set through every
// function-decl boundary — file seed (imports + top-level bindings) → each fn's
// own params + body locals → nested fns inherit the enclosing shadow — and
// records each fn's clientPin under its `makeFunctionNodeId`, matching the
// analysisMap keys Step 3 builds.
// ---------------------------------------------------------------------------

/**
 * Extract the leading binding identifier from a raw param / decl string and, if
 * it names a client-global root, add it to `set`. Handles `name`, `name: T`,
 * `name = default`, `lin name`, `...rest` — the leading ident is the binding.
 */
function addBindingRootIfClientGlobal(set: Set<string>, raw: unknown): void {
  if (typeof raw !== "string") return;
  const m = raw.match(/[A-Za-z_$][A-Za-z0-9_$]*/);
  if (m && CLIENT_ONLY_GLOBAL_ROOTS.has(m[0])) set.add(m[0]);
}

/** Add every client-global root bound by a value that may be a bare name OR a
 *  DestructurePattern (S263 review #1/#2). Reuses the tested `iterDestructuredNames`
 *  extractor so array / object / nested / rest bindings are all covered. */
function addBindingRootsMaybeDestructured(set: Set<string>, nameField: unknown): void {
  if (isDestructurePattern(nameField)) {
    for (const n of iterDestructuredNames(nameField)) {
      if (CLIENT_ONLY_GLOBAL_ROOTS.has(n)) set.add(n);
    }
  } else {
    addBindingRootIfClientGlobal(set, nameField); // bare / typed / defaulted / rest string
  }
}

/**
 * Add every client-global root bound by a function/lambda param list (S263
 * review #1). Params arrive as raw strings (`"document"`, `"document: T"`,
 * `"document = d"`, `"...document"` — all caught by the leading-ident extractor)
 * OR as objects whose `.name` is a string or a DestructurePattern (`{ document }`
 * / `[document]` — expanded via `iterDestructuredNames`).
 */
function addParamRoots(set: Set<string>, params: unknown): void {
  if (!Array.isArray(params)) return;
  for (const p of params) {
    if (typeof p === "string") addBindingRootIfClientGlobal(set, p);
    else if (p && typeof p === "object") addBindingRootsMaybeDestructured(set, (p as any).name);
  }
}

/**
 * Collect client-global roots bound by LOCAL declarations directly inside a
 * function body, NOT crossing a nested function boundary (those locals belong to
 * inner scopes). A local binding of a client-global name shadows the DOM global
 * for the whole enclosing fn (conservative — favors NOT firing a hard error).
 *
 * S263 review #2: reuses the tested `collectLocalNames` for every BARE binding
 * form it already handles (let/const/tilde/lin, state-decl, nested-fn NAME,
 * for-stmt vars, `catch` binding) — so those forms cannot be missed — and layers
 * a destructure-pattern pass on top (`collectLocalNames` records a destructured
 * decl's `.name` as the pattern OBJECT, so its bound names are expanded here via
 * `iterDestructuredNames`). A DestructurePattern only ever appears in a binding
 * position, so scanning every field for one is safe.
 */
function addBodyLocalRoots(set: Set<string>, body: unknown): void {
  // (a) bare-name locals via the existing tested collector.
  if (Array.isArray(body)) {
    for (const nm of collectLocalNames(body as LogicStatement[])) {
      if (CLIENT_ONLY_GLOBAL_ROOTS.has(nm)) set.add(nm);
    }
  }
  // (b) destructured bindings (decl / catch / for-var name fields carrying a
  // DestructurePattern) — expand, stopping at inner function/lambda scopes.
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) visit(c); return; }
    if (node.kind === "function-decl" || node.kind === "lambda") return; // inner scope
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const v = node[key];
      if (isDestructurePattern(v)) {
        for (const n of iterDestructuredNames(v)) {
          if (CLIENT_ONLY_GLOBAL_ROOTS.has(n)) set.add(n);
        }
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  };
  visit(body);
}

/**
 * File-scope seed: client-global roots bound at FILE scope — imports + top-level
 * declarations (const/let/tilde/function/component names) — visible to every
 * function. Does NOT descend into a function-decl BODY (those are inner scopes),
 * but DOES record a top-level `function document(){…}` name binding.
 */
function collectFileLevelBindingRoots(nodes: unknown): Set<string> {
  const set = new Set<string>();
  const visit = (node: any): void => {
    if (set.size === CLIENT_ONLY_GLOBAL_ROOTS.size) return;
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) visit(c); return; }
    const k = node.kind;
    if (k === "import-decl") {
      if (Array.isArray(node.names)) for (const nm of node.names) addBindingRootIfClientGlobal(set, nm);
      if (typeof node.name === "string") addBindingRootIfClientGlobal(set, node.name);
    }
    if (k === "let-decl" || k === "const-decl" || k === "tilde-decl"
        || k === "state-decl" || k === "component-def" || k === "function-decl") {
      // `.name` is a bare string OR a DestructurePattern (top-level destructured
      // decl) — both handled (S263 review #2).
      addBindingRootsMaybeDestructured(set, node.name);
    }
    // Do NOT descend into a function-decl body (inner scope) — but keep its name.
    if (k === "function-decl") return;
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const v = node[key];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(nodes);
  return set;
}

/**
 * Compute the clientPin for EVERY function-decl in a file, scope-aware. Returns
 * a Map<fnNodeId, {resource, span}> keyed by `makeFunctionNodeId` (matching the
 * analysisMap keys). Threads the lexical shadow set through function boundaries:
 * a fn's shadow = enclosing shadow ∪ its own params ∪ its own body locals, and
 * nested fn-decls inherit it — so a nested fn correctly sees an ancestor's
 * `document` param as a shadow.
 */
function computeFileClientPins(
  fileAST: FileAST,
  filePath: string,
): Map<string, { resource: string; span: Span | undefined }> {
  const out = new Map<string, { resource: string; span: Span | undefined }>();
  const nodes: any =
    (fileAST as any).nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []) ?? [];
  const fileSeed = collectFileLevelBindingRoots(nodes);

  const walk = (node: any, shadow: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c, shadow); return; }
    if (node.kind === "function-decl") {
      const inner = new Set(shadow);
      addParamRoots(inner, node.params);
      const body = Array.isArray(node.body) ? node.body : [];
      addBodyLocalRoots(inner, body);
      const pin = detectClientOnlyGlobalAccess(body, inner);
      if (pin) out.set(makeFunctionNodeId(filePath, node), pin);
      // Recurse into the body so nested function-decls inherit `inner`.
      walk(node.body, inner);
      return;
    }
    if (node.kind === "lambda") {
      // A lambda is its own scope; its params shadow within it. Recurse so any
      // nested function-decl inside the lambda inherits the lambda's params.
      const inner = new Set(shadow);
      addParamRoots(inner, node.params);
      walk(node.body, inner);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const v = node[key];
      if (v && typeof v === "object") walk(v, shadow);
    }
  };
  walk(nodes, fileSeed);
  return out;
}

/**
 * §12.4 E-ROUTE-005 — a short human phrase for the FIRST (most concrete) server
 * trigger among a function's direct escalation reasons, for the unplaceable
 * both-sides diagnostic. Prefers a body/resource reason over the bare `server`
 * keyword.
 */
function describeServerTrigger(reasons: EscalationReason[]): string {
  const ordered = [...reasons].sort(
    (a, b) =>
      (a.kind === "explicit-annotation" ? 1 : 0) -
      (b.kind === "explicit-annotation" ? 1 : 0),
  );
  const first = ordered[0];
  if (!first) return "a server-only resource";
  switch (first.kind) {
    case "server-only-resource":
      return first.resourceType === "sql-query"
        ? "a `?{}` SQL query"
        : `the server-only resource \`${first.resourceType}\``;
    case "protected-field-access":
      return `the protected field \`${first.field}\``;
    case "explicit-annotation":
      return "the `server` keyword";
    case "channel-broadcast":
      return `a channel \`broadcast()\`/\`disconnect()\` (${first.detail})`;
    case "middleware-handle":
      return "the reserved middleware name `handle()`";
    case "channel-ws-handler":
      return "an `onserver:` channel handler";
    default:
      return "a server-only resource";
  }
}

// ---------------------------------------------------------------------------
// CPS transformation analysis
// ---------------------------------------------------------------------------

/**
 * Determine whether a function body is eligible for CPS transformation and,
 * if so, compute the split plan.
 *
 * CPS is eligible when:
 *   - There is at least one server-trigger statement
 *   - There is at least one reactive statement
 *   - No single statement is BOTH a server trigger AND a reactive assignment
 */
export function analyzeCPSEligibility(
  body: LogicStatement[],
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  analysisMap: Map<string, AnalysisRecord>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
  /**
   * Insight 26 Batch 1 D2c (2026-05-08): names imported from server-only
   * runtime sources for the file containing this body. Defaults to empty
   * for back-compat with self-host RI and external callers.
   */
  importedServerNamespaces: Set<string> = new Set(),
): CPSResult | null {
  if (!body || body.length === 0) return null;

  const serverIndices: number[] = [];
  const reactiveIndices: number[] = [];
  const reactiveServerIndices: number[] = []; // state-decls whose init calls a server fn
  const mixedIndices: number[] = []; // bare-expr statements that are BOTH server + reactive

  for (let i = 0; i < body.length; i++) {
    const node = body[i];
    if (!node || typeof node !== "object") continue;

    const isReactive = isReactiveStatement(node);
    const isServer = isServerTriggerStatement(
      node,
      protectedFields,
      stateBlockIdByField,
      functionIndex,
      analysisMap,
      resolvedServerFnIds,
      importedServerFnNames,
      importedServerNamespaces,
    );

    // Special case: state-decl with server function call OR server-only
    // resource in init — CPS-eligible.
    const isReactiveServer =
      isReactive &&
      node.kind === "state-decl" &&
      (hasServerCallInInit(node, functionIndex, resolvedServerFnIds, importedServerFnNames) ||
        hasServerOnlyResourceInInit(node, importedServerNamespaces));

    if (isReactiveServer) {
      reactiveServerIndices.push(i);
    } else if (isReactive && isServer) {
      // bare-expr with both @var= and server resource — truly unsplittable
      mixedIndices.push(i);
    } else if (isReactive) {
      reactiveIndices.push(i);
    } else if (isServer) {
      serverIndices.push(i);
    }
    // Statements that are neither are client-side by default
  }

  // CPS is applicable when:
  // 1. There are NO mixed (unsplittable) statements
  // 2. There is at least one reactive statement (pure reactive or reactive-server)
  // 3. There is at least one server-side element (server statement or reactive-server)
  const hasReactive = reactiveIndices.length > 0 || reactiveServerIndices.length > 0;
  const hasServer = serverIndices.length > 0 || reactiveServerIndices.length > 0;

  if (!hasReactive || !hasServer) return null;
  if (mixedIndices.length > 0) return null;

  // Compute the split.
  const allServerIndices = [...serverIndices, ...reactiveServerIndices].sort((a, b) => a - b);
  const clientStmtIndices: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (!serverIndices.includes(i)) {
      clientStmtIndices.push(i);
    }
    // Note: reactiveServerIndices are in BOTH lists.
  }

  // Detect returnVarName from reactive-server statements.
  let returnVarName: string | null = null;
  for (const ri of reactiveServerIndices) {
    const node = body[ri];
    if (node.kind === "state-decl" && (node as any).name) {
      returnVarName = (node as any).name;
      break;
    }
  }

  return {
    eligible: true,
    serverStmtIndices: allServerIndices,
    clientStmtIndices,
    returnVarName,
    // Ext 1 M1.3: tier sub-sets for the multi-batch planner's body-DG.
    pureServerIndices: [...serverIndices].sort((a, b) => a - b),
    reactiveServerIndices: [...reactiveServerIndices].sort((a, b) => a - b),
  };
}

/**
 * Check if a state-decl node's init expression calls a server-escalated function.
 */
function hasServerCallInInit(
  node: LogicStatement,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
): boolean {
  const callees = extractCalleesFromNode(node, "init");
  for (const calleeName of callees) {
    const calleeEntries = functionIndex.get(calleeName);
    if (calleeEntries) {
      for (const { fnNodeId: calleeId } of calleeEntries) {
        if (resolvedServerFnIds.has(calleeId)) return true;
      }
    }
    if (importedServerFnNames.has(calleeName)) return true;
  }
  return false;
}

/**
 * Check if a state-decl node's init expression contains a server-only
 * resource: SQL sigil (?{`), Bun.* APIs, process.env, env(), etc.
 *
 * Per Insight 26 Batch 1 D2c (2026-05-08), also recognizes member-access
 * references to names imported from server-only runtime sources (e.g.
 * `redis.get(key)` where `redis` is imported from "bun").
 */
function hasServerOnlyResourceInInit(
  node: LogicStatement,
  importedServerNamespaces: Set<string> = new Set(),
): boolean {
  // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the AST
  // builder attached a structured sqlNode (because the initializer was
  // `?{...}.method()`), `init` is "" and `initExpr` is undefined. The
  // structured form is the canonical way to detect SQL-init from now on;
  // the legacy string match remains for back-compat / defense-in-depth.
  // Without this, `refreshList()` in combined-007-crud.scrml regressed to
  // E-RI-002 because CPS split was no longer detected for `@users = ?{...}`.
  if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") return true;

  // Phase 4d: ExprNode-first, string fallback
  const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : (typeof (node as any).init === "string" ? (node as any).init : "");
  if (!init) return false;

  // Check for SQL sigil (?{`)
  if (/\?\{`/.test(init)) return true;

  // Check for other server-only resource patterns (Bun.*/process.* via the
  // parsed initExpr — string/comment-safe, S252 — plus the string patterns).
  if (detectServerOnlyResourceForNode((node as any).initExpr, init) !== null) return true;

  // Insight 26 D2c — server-only namespace member access (e.g. `redis.get(key)`).
  if (importedServerNamespaces.size > 0) {
    for (const name of importedServerNamespaces) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
      if (re.test(init)) return true;
    }
  }

  return false;
}

/**
 * Check if a single statement node is a reactive assignment.
 */
function isReactiveStatement(node: LogicStatement): boolean {
  if (node.kind === "state-decl") return true;
  if (node.kind === "bare-expr") {
    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");
    if (/\B@[A-Za-z_$][A-Za-z0-9_$]*\s*=[^=]/.test(expr)) return true;
  }
  return false;
}

/**
 * inline-sql-in-branch-cps (2026-06-01): the statement KINDS whose nested
 * bodies must be scanned for a server-only trigger. An inline `?{}` SQL (or
 * any other server-only resource) buried inside a conditional branch / match
 * arm / loop body is a server-call boundary exactly as a top-level `?{}` is
 * (SPEC §12.2 Trigger 1/3; §19.9.9.1 tier table — `server` = "own `?{}` SQL
 * ... or other server-only resource"). The function-level escalation walker
 * `walkBodyForTriggers` already recurses into these bodies (its generic
 * array-recursion fallback), which is why a nested `?{}` escalates the WHOLE
 * function. The CPS body-split classifier (`analyzeCPSEligibility` →
 * `isServerTriggerStatement`) did NOT mirror that recursion, so the
 * control-flow statement was mis-tiered as client and emitted into the client
 * wrapper raw (E-CG-006 / E-CODEGEN-INVALID-LOGIC) or the whole function escalated
 * and a following `@cell` write tripped E-RI-002. This set + the recursive
 * helper below close that asymmetry so the control-flow statement is classified
 * server-tier and routed through the same CPS split a server-fn call in that
 * position already gets.
 */
const CONTROL_FLOW_TRIGGER_KINDS = new Set([
  "if-stmt",
  "if-expr",
  "for-stmt",
  "for-expr",
  "while-stmt",
  "switch-stmt",
  "match-stmt",
  "match-expr",
  "try-stmt",
]);

/**
 * Recursively scan a control-flow statement's NESTED statements for a
 * server-only trigger (an inline `?{}` SQL, a `?{...}.method()` sqlNode
 * attachment, a server-only resource string, a protected-field access, or a
 * call to a server-escalated / server-imported function).
 *
 * The recursion discipline mirrors `walkBodyForTriggers` (route-inference.ts):
 *   - DOES descend into nested control-flow bodies (an `if` inside a `match`
 *     arm, a `?{}` two branches deep, etc.).
 *   - Does NOT descend into nested `function-decl` bodies — those are separate
 *     analysis entries with their own classification.
 *
 * Returns `true` on the FIRST nested server trigger found.
 */
function controlFlowContainsServerTrigger(
  node: LogicStatement | ASTNode,
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  analysisMap: Map<string, AnalysisRecord>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
  importedServerNamespaces: Set<string>,
): boolean {
  if (!node || typeof node !== "object") return false;
  const kind = (node as any).kind;

  // Do not cross into nested function bodies — separate analysis entries.
  if (kind === "function-decl") return false;

  // Helper: server-only-resource / namespace / protected-field / server-fn-call
  // detection on a raw expression string (mirrors walkBodyForTriggers). The
  // optional `exprNode` lets the Bun.*/process.* namespace set be detected on
  // the AST (string/comment-safe, S252) rather than the string surface.
  const stringHasServerTrigger = (expr: string, exprNode?: unknown): boolean => {
    if (!expr) return false;
    if (detectServerOnlyResourceForNode(exprNode, expr) !== null) return true;
    if (importedServerNamespaces.size > 0) {
      for (const name of importedServerNamespaces) {
        const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
        if (re.test(expr)) return true;
      }
    }
    for (const fieldName of protectedFields) {
      if (bareExprAccessesField(expr, fieldName)) return true;
    }
    return false;
  };
  const calleeHasServerTrigger = (
    n: any,
    field: "expr" | "init",
  ): boolean => {
    for (const calleeName of extractCalleesFromNode(n, field)) {
      const calleeEntries = functionIndex.get(calleeName);
      if (calleeEntries) {
        for (const { fnNodeId } of calleeEntries) {
          if (resolvedServerFnIds.has(fnNodeId)) return true;
        }
      }
      if (importedServerFnNames.has(calleeName)) return true;
    }
    return false;
  };

  // A structured `?{}` SQL node anywhere in the nested body is a server trigger.
  if (kind === "sql") return true;

  // The `?{...}.method()` attachment form (let/const/state/return/lift carry a
  // structured `sqlNode` while the string surface is the placeholder sentinel).
  if ((node as any).sqlNode && (node as any).sqlNode.kind === "sql") return true;

  // dpa-003 (S216) — an inline `_={ … }=` foreign-code block is server-only
  // (it drives the host: spawns processes, reads files). Same color rule that
  // restricts `?{}` (dpa-004 C2, mirrors E-SQL-004). A foreign node anywhere in
  // the nested body — or attached via `foreignNode` on a decl/return — escalates
  // the enclosing fn to server so the opaque slice never reaches client output.
  if (kind === "foreign") return true;
  if ((node as any).foreignNode && (node as any).foreignNode.kind === "foreign") return true;

  if (kind === "bare-expr") {
    // Use the RAW `.expr` string — for a match-arm bare-expr the structured
    // `exprNode` is only the arm pattern literal (e.g. `"add"`); the inline
    // `?{}` lives in the raw arm text under `.expr`.
    const expr =
      typeof (node as any).expr === "string" && /\?\{/.test((node as any).expr)
        ? (node as any).expr
        : ((node as any).exprNode
            ? emitStringFromTree((node as any).exprNode)
            : ((node as any).expr ?? ""));
    if (stringHasServerTrigger(expr, (node as any).exprNode)) return true;
    if (calleeHasServerTrigger(node, "expr")) return true;
  }

  if (kind === "let-decl" || kind === "const-decl" || kind === "tilde-decl" || kind === "state-decl") {
    const init = (node as any).initExpr
      ? emitStringFromTree((node as any).initExpr)
      : (typeof (node as any).init === "string" ? (node as any).init : "");
    if (stringHasServerTrigger(init, (node as any).initExpr)) return true;
    for (const fieldName of protectedFields) {
      if (declDestructuresField(init, fieldName)) return true;
    }
    if (calleeHasServerTrigger(node, "init")) return true;
  }

  if (kind === "return-stmt" || kind === "throw-stmt" || kind === "propagate-expr") {
    const expr = (node as any).exprNode
      ? emitStringFromTree((node as any).exprNode)
      : (typeof (node as any).expr === "string" ? (node as any).expr : "");
    if (stringHasServerTrigger(expr, (node as any).exprNode)) return true;
    if (calleeHasServerTrigger(node, "expr")) return true;
  }

  // Recurse into every array-valued child field (consequent / alternate /
  // body / arms / catch / finally bodies, etc.). guarded-expr carries its
  // wrapped node + arm bodies as object/array fields handled here.
  if (kind === "guarded-expr") {
    const wrapped = (node as any).guardedNode;
    if (wrapped && typeof wrapped === "object") {
      if (controlFlowContainsServerTrigger(wrapped, protectedFields, stateBlockIdByField, functionIndex, analysisMap, resolvedServerFnIds, importedServerFnNames, importedServerNamespaces)) return true;
    }
  }
  for (const key of Object.keys(node as any)) {
    if (key === "span" || key === "id") continue;
    const val = (node as any)[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === "object" && typeof (child as any).kind === "string") {
          if (controlFlowContainsServerTrigger(child, protectedFields, stateBlockIdByField, functionIndex, analysisMap, resolvedServerFnIds, importedServerFnNames, importedServerNamespaces)) return true;
        }
      }
    } else if (val && typeof val === "object" && typeof (val as any).kind === "string") {
      // Object-valued child node (e.g. try-stmt's catchNode/finallyNode wrap
      // a `body` array under a plain object; their bodies are reached via the
      // array recursion when we descend into the wrapper object's fields).
      if (controlFlowContainsServerTrigger(val, protectedFields, stateBlockIdByField, functionIndex, analysisMap, resolvedServerFnIds, importedServerFnNames, importedServerNamespaces)) return true;
    } else if (val && typeof val === "object" && Array.isArray((val as any).body)) {
      // try-stmt catchNode / finallyNode: `{ header, body }` plain objects with
      // no `kind` discriminant. Walk their `body` array.
      for (const child of (val as any).body) {
        if (child && typeof child === "object" && typeof (child as any).kind === "string") {
          if (controlFlowContainsServerTrigger(child, protectedFields, stateBlockIdByField, functionIndex, analysisMap, resolvedServerFnIds, importedServerFnNames, importedServerNamespaces)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if a single statement node contains a server-only trigger.
 */
function isServerTriggerStatement(
  node: LogicStatement,
  protectedFields: Set<string>,
  stateBlockIdByField: Map<string, string>,
  functionIndex: Map<string, FunctionIndexEntry[]>,
  analysisMap: Map<string, AnalysisRecord>,
  resolvedServerFnIds: Set<string>,
  importedServerFnNames: Set<string>,
  /** Insight 26 D2c (2026-05-08): per-file imported server namespaces. */
  importedServerNamespaces: Set<string> = new Set(),
): boolean {
  if (!node || typeof node !== "object") return false;

  // Insight 26 D2c helper — match `\bNAME\.` (member access).
  const matchesNamespaceRef = (expr: string): boolean => {
    if (importedServerNamespaces.size === 0) return false;
    for (const name of importedServerNamespaces) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\.[A-Za-z_$]`);
      if (re.test(expr)) return true;
    }
    return false;
  };

  // SQL blocks are always server-side
  if (node.kind === "sql") return true;

  // dpa-003 (S216) — inline foreign-code `_={ … }=` is always server-side.
  if (node.kind === "foreign") return true;
  if ((node as any).foreignNode && (node as any).foreignNode.kind === "foreign") return true;

  if (node.kind === "bare-expr") {
    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    const expr = (node as any).exprNode ? emitStringFromTree((node as any).exprNode) : ((node as any).expr ?? "");

    // Server-only resource access (Bun.*/process.* via the parsed exprNode — S252).
    if (detectServerOnlyResourceForNode((node as any).exprNode, expr) !== null) return true;

    // D2c (Insight 26): server-only namespace member access
    if (matchesNamespaceRef(expr)) return true;

    // Protected field access
    for (const fieldName of protectedFields) {
      if (bareExprAccessesField(expr, fieldName)) return true;
    }

    // Calls to server-escalated functions or scrml: stdlib imports
    for (const calleeName of extractCalleesFromNode(node, "expr")) {
      const calleeEntries = functionIndex.get(calleeName);
      if (calleeEntries) {
        for (const { fnNodeId: calleeId } of calleeEntries) {
          if (resolvedServerFnIds.has(calleeId)) return true;
        }
      }
      if (importedServerFnNames.has(calleeName)) return true;
    }
  }

  if (node.kind === "let-decl" || node.kind === "const-decl") {
    // Phase 4d: ExprNode-first, string fallback
    const init = (node as any).initExpr ? emitStringFromTree((node as any).initExpr) : ((node as any).init ?? "");

    // Protected field via destructuring
    for (const fieldName of protectedFields) {
      if (declDestructuresField(init, fieldName)) return true;
    }

    // Server-only resource in init (Bun.*/process.* via the parsed initExpr — S252).
    if (detectServerOnlyResourceForNode((node as any).initExpr, init) !== null) return true;

    // D2c (Insight 26): server-only namespace member access in init
    if (matchesNamespaceRef(init)) return true;

    // Calls to server-escalated functions or scrml: stdlib imports in init
    const callees = extractCalleesFromNode(node, "init");
    for (const calleeName of callees) {
      const calleeEntries = functionIndex.get(calleeName);
      if (calleeEntries) {
        for (const { fnNodeId: calleeId } of calleeEntries) {
          if (resolvedServerFnIds.has(calleeId)) return true;
        }
      }
      if (importedServerFnNames.has(calleeName)) return true;
    }
  }

  // NOTE: state-decl nodes are NOT checked for server triggers here.
  // A state-decl like `@data = serverCall()` is CPS-eligible.
  // The only truly ineligible case is when a bare-expr contains BOTH
  // a reactive @-assignment AND server access in the same expression string.

  // inline-sql-in-branch-cps (2026-06-01): a control-flow statement (if / match
  // / for / while / switch / try) whose NESTED body contains an inline `?{}`
  // SQL (or any other server-only resource) is itself a server-call boundary —
  // the same boundary a top-level `?{}` statement is. Without this the CPS
  // body-split classifier mis-tiered such a control-flow statement as client,
  // emitting the nested `?{}` into the client wrapper raw (E-CG-006 /
  // E-CODEGEN-INVALID-LOGIC) or letting whole-function escalation strand a
  // following `@cell` write under E-RI-002. Classifying it server-tier routes
  // the whole statement through the existing CPS split (server stub emits the
  // control-flow + nested SQL; the surrounding `@`-writes stay client as the
  // continuation) — the identical path a server-fn call in an arm already uses.
  // SPEC §12.2 Trigger 1/3; §19.9.9.1 tier table; the `control-anchors` edge
  // (§19.9.9.1) already fences a control-flow statement as a server batch.
  if (CONTROL_FLOW_TRIGGER_KINDS.has(node.kind)) {
    if (
      controlFlowContainsServerTrigger(
        node,
        protectedFields,
        stateBlockIdByField,
        functionIndex,
        analysisMap,
        resolvedServerFnIds,
        importedServerFnNames,
        importedServerNamespaces,
      )
    ) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Global function registry
// ---------------------------------------------------------------------------

/**
 * Build a global index of all function nodes across all files.
 * Key: function name → array of { fnNodeId, filePath, fnNode }
 */
export function buildFunctionIndex(files: FileAST[]): Map<string, FunctionIndexEntry[]> {
  const index = new Map<string, FunctionIndexEntry[]>();

  for (const fileAST of files) {
    const filePath = fileAST.filePath;
    const fnNodes = collectFileFunctions(fileAST);
    for (const fnNode of fnNodes) {
      const name = fnNode.name;
      if (!name) continue;
      const fnNodeId = makeFunctionNodeId(filePath, fnNode);
      if (!index.has(name)) index.set(name, []);
      index.get(name)!.push({ fnNodeId, filePath, fnNode });
    }
  }

  return index;
}

/**
 * Insight 26 Batch 1 — D2c (2026-05-08).
 * Bun runtime sources whose imports are all server-only. `bun` itself
 * surfaces network/process/file APIs (Bun.file, Bun.serve, redis, etc.) that
 * have no browser equivalent. `bun:*` subpath imports (bun:sqlite, bun:test,
 * bun:ffi, etc.) are also server-only — bun:test is dev-time only and is
 * never bundled into client output.
 */
function isServerOnlyImportSource(source: string): boolean {
  if (SERVER_ONLY_SCRML_MODULES.has(source)) return true;
  if (source === "bun") return true;
  if (source.startsWith("bun:")) return true;
  // node:* subpaths are Node-stdlib namespaces; never browser-available.
  if (source.startsWith("node:")) return true;
  return false;
}

/**
 * Build a set of function names imported from server-only scrml: modules.
 *
 * When a file imports { hash } from 'scrml:crypto', hash is server-only
 * even though it has no AST node in the user's code.
 *
 * Per Insight 26 Batch 1 D2c (2026-05-08), also recognizes Bun and Node
 * runtime sources (`bun`, `bun:*`, `node:*`) so that `import { redis } from "bun"`
 * (the pattern used by stdlib/redis/index.scrml) treats the imported names
 * as server-only.
 */
function buildImportedServerFnNames(files: FileAST[]): Set<string> {
  const names = new Set<string>();
  for (const fileAST of files) {
    const imports: ImportDeclNode[] =
      fileAST.imports ?? ((fileAST as any).ast ? (fileAST as any).ast.imports : []) ?? [];
    for (const node of imports) {
      if (node && node.kind === "import-decl" && node.source) {
        const source = node.source.replace(/^['"]|['"]$/g, "");
        if (isServerOnlyImportSource(source)) {
          for (const name of node.names ?? []) {
            names.add(name);
          }
        }
      }
    }
  }
  return names;
}

/**
 * Insight 26 Batch 1 D2c (2026-05-08).
 * Build a per-file map of names imported from server-only sources,
 * used by walkBodyForTriggers to detect member-access references like
 * `redis.get(key)` where `redis` is imported from "bun".
 *
 * Distinct from `buildImportedServerFnNames` (which collects all such names
 * across all files into a single flat set used at the CPS layer for
 * direct-call escalation): this map is per-file because imports are
 * file-scoped, and a member-access reference like `redis.get(key)` only
 * means "server-only" when `redis` was imported from a server-only source
 * IN THE SAME FILE.
 */
function buildPerFileImportedServerNamespaces(files: FileAST[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const fileAST of files) {
    const imports: ImportDeclNode[] =
      fileAST.imports ?? ((fileAST as any).ast ? (fileAST as any).ast.imports : []) ?? [];
    const names = new Set<string>();
    for (const node of imports) {
      if (node && node.kind === "import-decl" && node.source) {
        const source = node.source.replace(/^['"]|['"]$/g, "");
        if (isServerOnlyImportSource(source)) {
          for (const name of node.names ?? []) {
            names.add(name);
          }
        }
      }
    }
    result.set(fileAST.filePath, names);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Closure capture analysis
// ---------------------------------------------------------------------------

/**
 * Collect all names locally declared inside a function body.
 * Includes: let/const/tilde/lin/reactive declarations, nested function names,
 * for-loop iterator variables, try-catch binding names.
 * Does NOT include params (handled separately).
 */
function collectLocalNames(body: LogicStatement[]): Set<string> {
  const names = new Set<string>();

  function visitStmt(node: LogicStatement): void {
    if (!node || typeof node !== "object") return;

    switch (node.kind) {
      case "let-decl":
      case "const-decl":
      case "tilde-decl":
      case "lin-decl":
        if ((node as any).name) names.add((node as any).name);
        break;
      case "state-decl":
        // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
        // S79 — `reactive-debounced-decl` retired (§6.13 reactivity attribute).
        if ((node as any).name) names.add((node as any).name);
        break;
      case "function-decl":
        // Nested function is a local name but do NOT recurse into its body
        // for local name collection — its body has its own scope.
        if ((node as any).name) names.add((node as any).name);
        return; // do not recurse
      case "for-stmt":
        if ((node as any).iteratorVar) names.add((node as any).iteratorVar);
        if ((node as any).indexVar) names.add((node as any).indexVar);
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        return;
      case "try-stmt":
        if ((node as any).catchNode && (node as any).catchNode.binding) {
          names.add((node as any).catchNode.binding);
        }
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        if ((node as any).catchNode && Array.isArray((node as any).catchNode.body)) {
          for (const child of (node as any).catchNode.body) visitStmt(child);
        }
        if (Array.isArray((node as any).finallyBody)) {
          for (const child of (node as any).finallyBody) visitStmt(child);
        }
        return;
      case "if-stmt":
        if (Array.isArray((node as any).consequent)) {
          for (const child of (node as any).consequent) visitStmt(child);
        }
        if (Array.isArray((node as any).alternate)) {
          for (const child of (node as any).alternate) visitStmt(child);
        }
        return;
      case "while-stmt":
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        return;
      case "match-stmt":
        if (Array.isArray((node as any).body)) {
          for (const child of (node as any).body) visitStmt(child);
        }
        return;
    }

    // Generic recursion for other node kinds with array children
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && child.kind) {
            visitStmt(child);
          }
        }
      }
    }
  }

  for (const stmt of body) {
    visitStmt(stmt);
  }
  return names;
}

/**
 * Collect all identifier names referenced (read or called) in a function body.
 *
 * Implementation: structurally walks every ExprNode-bearing field via
 * `forEachIdentInExprNode`, which:
 *   - Visits only `IdentExpr` nodes (does NOT scan inside `LitExpr` string
 *     content, which is what the prior regex-on-flat-string implementation did
 *     and which caused the F-RI-001 deeper bug — a string literal containing
 *     a token text matching a peer server-fn name was falsely capture-tainting
 *     the function via the cross-file `fnNameToNodeIds` map).
 *   - Skips `MemberExpr.property` (a member-access name is a static string,
 *     not a free-variable reference).
 *   - Does not descend into `LambdaExpr` bodies (new lin scope; identifiers
 *     inside the lambda are not free variables of the outer fn).
 *   - Walks template-literal `${...}` interpolations (real identifier reads).
 *
 * Does NOT recurse into nested function-decl bodies — those have their own scope.
 *
 * Filtering: reactive (`@`) and tilde (`~`) identifiers are excluded — they
 * are not free function-name references and the closure-capture-taint loop
 * looks for fn-name collisions only.
 *
 * JS keywords/builtins are also filtered (preserves prior behavior).
 */
function collectReferencedNames(body: LogicStatement[]): Set<string> {
  const names = new Set<string>();

  function addIdent(name: string): void {
    if (!name) return;
    // Skip reactive (`@x`) and tilde (`~`) refs — not free fn-name references.
    if (name[0] === "@" || name === "~") return;
    if (JS_KEYWORDS.has(name)) return;
    names.add(name);
  }

  function walkExpr(node: ExprNode | undefined | null): void {
    if (!node) return;
    forEachIdentInExprNode(node, (ident) => addIdent(ident.name));
  }

  /**
   * Legacy string-mode fallback: used ONLY when the AST node lacks a structured
   * ExprNode field (the production ast-builder always populates ExprNode; this
   * fallback exists to keep hand-built test fixtures and any legacy callers
   * working). The string-mode path can have the F-RI-001-deeper string-literal
   * pollution issue, but production paths flow through `walkExpr` first.
   */
  const STR_IDENT_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  function extractIdentsFromString(str: string): void {
    if (!str) return;
    const re = new RegExp(STR_IDENT_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(str)) !== null) {
      addIdent(m[1]);
    }
  }
  function walkExprOrString(node: ExprNode | undefined | null, str: string | undefined): void {
    if (node) {
      walkExpr(node);
      return;
    }
    if (typeof str === "string" && str.length > 0) {
      extractIdentsFromString(str);
    }
  }

  function visitStmt(node: LogicStatement): void {
    if (!node || typeof node !== "object") return;
    const n = node as any;

    // Do NOT recurse into nested function bodies — they have their own scope.
    if (n.kind === "function-decl" || n.kind === "component-def") return;

    switch (n.kind) {
      // ---- Statements that carry an ExprNode in `exprNode` ----
      case "bare-expr":
        walkExprOrString(n.exprNode, n.expr);
        return;
      case "return-stmt":
      case "throw-stmt":
        walkExprOrString(n.exprNode, n.expr);
        return;

      // ---- Decls that carry an init in `initExpr` (or `init` legacy string) ----
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
      case "let-decl":
      case "const-decl":
      case "tilde-decl":
      case "lin-decl":
      case "state-decl":
        // S79 — `reactive-debounced-decl` retired (§6.13 reactivity attribute).
        walkExprOrString(n.initExpr, n.init);
        return;

      // ---- Reactive setters with structured exprs ----
      case "reactive-nested-assign": {
        walkExprOrString(n.valueExpr, n.value);
        // cycles-prereq (S168): a bracket-index COMPUTED path segment carries
        // an index ExprNode (`@arr[serverFn()] = x`) — walk it so a route/
        // server reference inside the index is not invisible to the walker.
        const rnaPath = n.path;
        if (Array.isArray(rnaPath)) {
          for (const seg of rnaPath) {
            if (seg && typeof seg === "object") {
              walkExprOrString(seg.index, seg.raw);
            }
          }
        }
        return;
      }
      case "reactive-array-mutation":
      case "reactive-explicit-set":
        // Args remain raw strings on these escape-hatch nodes; nothing to
        // walk structurally. Pre-fix code also only matched whatever the
        // identifier-regex picked up here, so we deliberately skip them
        // (consistent with the structural-walk principle: no string scan).
        return;

      // ---- Control flow ----
      case "if-stmt":
      case "if-expr":
      case "while-stmt":
        walkExprOrString(n.condExpr, n.condition);
        if (Array.isArray(n.consequent)) for (const c of n.consequent) visitStmt(c);
        if (Array.isArray(n.alternate))   for (const c of n.alternate)   visitStmt(c);
        if (Array.isArray(n.body))        for (const c of n.body)        visitStmt(c);
        return;

      case "for-stmt":
      case "for-expr":
        walkExprOrString(n.iterExpr, n.iterable ?? n.iter);
        if (n.cStyleParts) {
          walkExpr(n.cStyleParts.initExpr);
          walkExpr(n.cStyleParts.condExpr);
          walkExpr(n.cStyleParts.updateExpr);
        }
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "match-stmt":
      case "match-expr":
        walkExprOrString(n.headerExpr, n.header);
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "switch-stmt":
        walkExprOrString(n.headerExpr, n.header);
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "try-stmt":
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        if (n.catchNode && Array.isArray(n.catchNode.body)) {
          for (const c of n.catchNode.body) visitStmt(c);
        }
        if (n.finallyNode && Array.isArray(n.finallyNode.body)) {
          for (const c of n.finallyNode.body) visitStmt(c);
        }
        if (Array.isArray(n.finallyBody)) {
          for (const c of n.finallyBody) visitStmt(c);
        }
        return;

      case "match-arm-inline":
        // Match arms may carry a result expression; walk if present.
        if (n.resultExpr) walkExpr(n.resultExpr);
        if (Array.isArray(n.body)) for (const c of n.body) visitStmt(c);
        return;

      case "lift-expr":
      case "fail-expr":
      case "propagate-expr":
      case "guarded-expr":
      case "html-fragment":
        // These are markup/control-flow boundary nodes that don't carry free
        // identifier references for RI capture-taint purposes. Pre-fix
        // behavior happened to scan their string fields; structurally they
        // contain no captures-relevant ExprNode references at this RI layer.
        return;
    }

    // ---- Generic fallback: recurse into any LogicStatement[] children ----
    // For statement kinds we haven't enumerated above (e.g. future additions),
    // walk array fields for nested LogicStatement[] bodies. Do NOT walk
    // ExprNode-bearing scalar fields here — that would re-introduce silent
    // misses. Add the kind to the switch above when a new field is needed.
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "id" || key === "name") continue;
      const val = n[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && child.kind) {
            visitStmt(child);
          }
        }
      }
    }
  }

  for (const stmt of body) {
    visitStmt(stmt);
  }
  return names;
}

/** JS keywords and built-ins to exclude from identifier collection. */
const JS_KEYWORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "async",
  "true", "false", "null", "undefined", "NaN", "Infinity",
  "console", "Math", "JSON", "Object", "Array", "String", "Number",
  "Boolean", "Date", "RegExp", "Error", "Map", "Set", "Promise",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "setTimeout", "setInterval", "clearTimeout",
  "clearInterval", "document", "window", "navigator", "fetch",
  "not", "is", "some", "match", "fail",
]);

/**
 * Build the closure captures set for a function.
 * Captures = referenced names - local names - params - JS keywords.
 *
 * @param fnNode — the function declaration node
 * @returns Set of captured variable names
 */
function buildClosureCapturesForFunction(fnNode: FunctionDeclNode): Set<string> {
  const body = Array.isArray(fnNode.body) ? fnNode.body : [];
  const params = new Set(fnNode.params ?? []);
  const localNames = collectLocalNames(body);
  const referencedNames = collectReferencedNames(body);

  const captures = new Set<string>();
  for (const name of referencedNames) {
    if (!params.has(name) && !localNames.has(name)) {
      captures.add(name);
    }
  }
  return captures;
}

/**
 * Resolve a file's EXPLICIT `auth=` declaration for the protect= auto-escalation
 * precedence check in Step 8b.
 *
 * The adopter can declare auth at two sites, and they reach this stage by two
 * different paths:
 *
 *   - `<program auth=...>` — captured into `fileAST.authConfig` by the
 *     `computeProgramConfig` pre-codegen pass. Step 8a already registers the
 *     `auth="required"` case as middleware; the `"optional"` / `"none"` cases
 *     are NOT, so they would otherwise be wrongly auto-escalated in 8b.
 *   - `<page auth=...>` — read directly from the markup node here. `<page auth=>`
 *     is page-level and is NOT captured by `authConfig` at all (that pass only
 *     inspects `<program>`), so without this walk an explicit `<page>` auth mode
 *     is invisible to Step 8b.
 *
 * Program-level wins when both are present (it is the file-wide config). Returns
 * `null` when no `auth=` is declared anywhere in the file. `<page>` carries no
 * `sessionExpiry=` attribute (per the attribute registry), so that slot is
 * always `null` for the page-level branch.
 */
function getExplicitAuthDeclaration(fileAST: FileAST): {
  auth: string;
  loginRedirect: string | null;
  csrf: string | null;
  sessionExpiry: string | null;
} | null {
  // 1. Program-level: <program auth=...> via computeProgramConfig. CE wraps the
  //    FileAST in `.ast`; bare-FileAST inputs (unit tests) keep authConfig at
  //    the top level. Try both, matching the idiom used in Step 8a.
  const authConfig =
    fileAST.authConfig ?? ((fileAST as any).ast ? (fileAST as any).ast.authConfig : null);
  if (authConfig && authConfig.auth) {
    return {
      auth: authConfig.auth,
      loginRedirect: authConfig.loginRedirect ?? null,
      csrf: authConfig.csrf ?? null,
      sessionExpiry: authConfig.sessionExpiry ?? null,
    };
  }

  // 2. Page-level: first <page auth=...> markup node anywhere in the tree.
  const nodes: any[] =
    (fileAST as any).nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []) ?? [];

  const readStringAttr = (attrs: any[] | undefined, name: string): string | null => {
    if (!Array.isArray(attrs)) return null;
    const a = attrs.find((x: any) => x && x.name === name);
    if (!a || !a.value || a.value.kind !== "string-literal") return null;
    return a.value.value ?? null;
  };

  let found: {
    auth: string;
    loginRedirect: string | null;
    csrf: string | null;
    sessionExpiry: string | null;
  } | null = null;

  const walk = (ns: any[] | undefined): void => {
    if (found || !Array.isArray(ns)) return;
    for (const node of ns) {
      if (found) return;
      if (!node || node.kind !== "markup") continue;
      if (node.tag === "page") {
        const authVal = readStringAttr(node.attrs, "auth");
        if (authVal) {
          found = {
            auth: authVal,
            loginRedirect: readStringAttr(node.attrs, "loginRedirect"),
            csrf: readStringAttr(node.attrs, "csrf"),
            sessionExpiry: null, // <page> carries no sessionExpiry= attribute.
          };
          return;
        }
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return found;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Input to the RI stage. */
export interface RIInput {
  files: FileAST[];
  protectAnalysis: ProtectAnalysis;
}

/** Output of the RI stage. */
export interface RIOutput {
  routeMap: RouteMap;
  errors: (RIError | { code: string; message: string; severity: string; filePath: string })[];
}

/**
 * Run the Route Inferrer (RI, Stage 5).
 */
export function runRI(input: RIInput): RIOutput {
  const { files, protectAnalysis } = input;

  // Reset the route counter for deterministic output within a single runRI call.
  _routeCounter = 0;

  const functions = new Map<string, FunctionRoute>();
  const errors: (RIError | { code: string; message: string; severity: string; filePath: string })[] = [];

  // ------------------------------------------------------------------
  // Step 1: Build a global set of all protected field names across all
  // db state blocks, and a mapping from field name → StateBlockId.
  // ------------------------------------------------------------------

  const allProtectedFields = new Set<string>();
  const stateBlockIdByField = new Map<string, string>();

  if (protectAnalysis && protectAnalysis.views) {
    for (const [stateBlockId, dbTypeViews] of protectAnalysis.views) {
      if (dbTypeViews.tables) {
        for (const [, tableTypeView] of dbTypeViews.tables) {
          if (tableTypeView.protectedFields) {
            for (const fieldName of tableTypeView.protectedFields) {
              allProtectedFields.add(fieldName);
              stateBlockIdByField.set(fieldName, stateBlockId);
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Build a global function index for transitive escalation.
  // ------------------------------------------------------------------
  const functionIndex = buildFunctionIndex(files);

  // ------------------------------------------------------------------
  // Step 2b: Build a set of function names imported from server-only
  // scrml: modules.
  // ------------------------------------------------------------------
  const importedServerFnNames = buildImportedServerFnNames(files);

  // ------------------------------------------------------------------
  // Step 2c: Insight 26 Batch 1 (2026-05-08) — per-file map of names
  // imported from server-only sources, used by walkBodyForTriggers to
  // detect member-access references like `redis.get(key)`.
  // ------------------------------------------------------------------
  const perFileImportedServerNamespaces = buildPerFileImportedServerNamespaces(files);

  // ------------------------------------------------------------------
  // Step 2d: Bug-5 follow-on to C18 (§38.4) — per-file channel-cell
  // ownership maps. Used in Step 6 (E-RI-002 fire arm) to skip the
  // diagnostic on channel-owned server functions writing to channel-
  // owned cells. Per SPEC §38.4 line 15998, every write to a channel-
  // declared cell SHALL emit a `__sync` wire frame; codegen lowers
  // these writes to `broadcast({__type:"__sync",...})` so the
  // `_scrml_reactive_set` reference that previously made the server
  // module crash at request time is no longer emitted on this path.
  // ------------------------------------------------------------------
  /** filePath → (functionName → channelName) */
  const perFileChannelFnMap = new Map<string, Map<string, string>>();
  /** filePath → (channelName → Set<cellName>) */
  const perFileChannelCellMap = new Map<string, Map<string, Set<string>>>();
  // Bug 2b (channel-codegen-fixes-2026-06-12): per-file function-name sets for
  // channel ATTRIBUTE handlers, partitioned by side. `onclient` names stay
  // CLIENT (§38.10 — never escalate); `onserver` names are server but invoked
  // via the WS handler path, so their HTTP route + client fetch stub are
  // suppressed (codegen emits them as plain callable server functions).
  /** filePath → Set<onclient-handler-name> */
  const perFileOnclientHandlerNames = new Map<string, Set<string>>();
  /** filePath → Set<onserver-handler-name> */
  const perFileOnserverHandlerNames = new Map<string, Set<string>>();
  /** filePath → (client reactive cell name → isDerived) — §6.6.9 E-REACTIVE-003
   *  read-detection input; excludes §52 `<... server>` cells (server-resolved). */
  const perFileClientReactiveCells = new Map<string, Map<string, boolean>>();
  for (const fileAST of files) {
    const nodes: any[] = (fileAST as any).nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []);
    if (!Array.isArray(nodes)) continue;
    perFileChannelFnMap.set(fileAST.filePath, collectChannelFunctionMap(nodes));
    perFileChannelCellMap.set(fileAST.filePath, collectChannelCellMap(nodes));
    const _attrHandlers = collectChannelAttrHandlerNames(nodes);
    perFileOnclientHandlerNames.set(fileAST.filePath, _attrHandlers.onclient);
    perFileOnserverHandlerNames.set(fileAST.filePath, _attrHandlers.onserver);
    perFileClientReactiveCells.set(fileAST.filePath, collectClientReactiveCells(nodes));
  }

  // ------------------------------------------------------------------
  // Step 2.5: A2-FOLLOWUP (S99) — rewrite malformed `server { ... }`
  // bare-expr stubs inside function bodies so Trigger 1 (?{} SQL) fires
  // via the raw expr text, and so TS's E-SCOPE-001 scope walker skips
  // the misleading `server` ident. See {@link rewriteServerBlockStubs}
  // for the full design rationale.
  // ------------------------------------------------------------------
  rewriteServerBlockStubs(files);

  // ------------------------------------------------------------------
  // Step 3: First pass — collect all function nodes and compute DIRECT
  // escalation (no transitive resolution yet).
  // ------------------------------------------------------------------

  const analysisMap = new Map<string, AnalysisRecord>();

  for (const fileAST of files) {
    const filePath = fileAST.filePath;
    const fnNodes = collectFileFunctions(fileAST);

    // §12.4 E-ROUTE-002 — scope-aware client-pin map for this file (S263 review
    // #2/#3): fnNodeId → the fn's DOM-global access (or absent). Computed once
    // per file with lexical-shadow threading; looked up per fn below.
    const fileClientPins = computeFileClientPins(fileAST, filePath);

    // Collect the span.start values of functions inside worker bodies
    // (<program name="...">) so we can suppress E-ROUTE-001 for them.
    const workerBodyFnIds = collectWorkerBodyFunctionIds(fileAST);

    // Per-file imported server namespaces (Insight 26 D2c).
    const fileImportedNamespaces = perFileImportedServerNamespaces.get(filePath) ?? new Set<string>();

    // §20.7.5 — per-file print/println shadow set (a top-level `function print`
    // wins over the builtin, so its calls must NOT server-escalate).
    const filePrintShadowed = new Set(filePrintBuiltinsShadowed(fileAST));

    for (const fnNode of fnNodes) {
      const fnNodeId = makeFunctionNodeId(filePath, fnNode);

      // Trigger 4: explicit server annotation.
      const explicitTriggers: EscalationReason[] = [];
      if (fnNode.isServer === true) {
        explicitTriggers.push({
          kind: "explicit-annotation",
          span: fnNode.span,
        });
      }

      // Scan the function body for direct triggers and callees.
      // E-ROUTE-001 is suppressed for functions inside worker bodies.
      const body = Array.isArray(fnNode.body) ? fnNode.body : [];
      const isWorkerBody = workerBodyFnIds.has(fnNode.span.start);
      const { triggers: bodyTriggers, callees, warnings } = walkBodyForTriggers(
        body,
        allProtectedFields,
        stateBlockIdByField,
        filePath,
        isWorkerBody,
        fileImportedNamespaces,
        filePrintShadowed,
      );

      // -------------------------------------------------------------
      // Trigger 7 (D2): channel-cell-write / broadcast() / disconnect()
      // escalation. A standalone `function` DECLARATION lexically inside a
      // <channel> body escalates server when its body calls broadcast()/
      // disconnect() (§38.6 server hub ops). RULING A (S189, change-id
      // `channel-cell-write-client-side-A-2026-06-12`): a channel-CELL WRITE no
      // longer escalates — under the v0.3 client-held model (§38.4) it is a
      // client-side sync-emitting operation distributed by the `syncShared`
      // effect (§38.7), exactly like an onclient:* cell write (§38.10). The
      // channel ownership maps (Step 2d) gate this so onclient:/onserver:
      // ATTRIBUTE handlers, `fn`, and functions outside any channel scope are
      // never reached: `collectChannelFunctionMap` only registers standalone
      // function-decl names inside a <channel> body.
      // -------------------------------------------------------------
      const channelTriggers: EscalationReason[] = [];
      {
        const _fnName = (fnNode as any).name;
        const _ownerChannel = typeof _fnName === "string"
          ? perFileChannelFnMap.get(filePath)?.get(_fnName)
          : undefined;
        // Bug 2b (channel-codegen-fixes-2026-06-12): an `onclient:*` handler
        // function is CLIENT-ONLY per §38.10 — the compiler SHALL NOT emit any
        // server-side code for it. §38.10 is explicit + normative and WINS over
        // §12.2 Trigger 7b: an onclient handler stays client even if its body
        // contains a broadcast()/disconnect() token, so it always calls locally
        // from `ws.onopen`/`onclose`/`onerror`, never through a server round-trip
        // fetch stub. (Under RULING A a cell write never escalated either, but
        // this skip keeps the §38.10 client-only invariant explicit + intact.)
        const _isOnclientHandler =
          typeof _fnName === "string" &&
          (perFileOnclientHandlerNames.get(filePath)?.has(_fnName) ?? false);
        if (_ownerChannel != null && !_isOnclientHandler) {
          const _reason = detectChannelBroadcastReason(body);
          if (_reason !== null) channelTriggers.push(_reason);
        }
        // Bug 2b: an `onserver:*` handler is server-side by §38.6.1 regardless
        // of whether its body writes a channel cell. Force-escalate it so it is
        // ALWAYS server-boundary; codegen then emits it as a plain callable
        // server function (no HTTP route, no client fetch stub) via the
        // `isChannelWsHandler` flag set in Step 6.
        const _isOnserverHandler =
          typeof _fnName === "string" &&
          (perFileOnserverHandlerNames.get(filePath)?.has(_fnName) ?? false);
        if (_isOnserverHandler) {
          channelTriggers.push({ kind: "channel-ws-handler", span: fnNode.span });
        }
      }

      // -------------------------------------------------------------
      // Trigger 8 (D2): the reserved-name handle(request, resolve)
      // middleware escape hatch. Recognized by name+signature at TAB
      // (`isHandleEscapeHatch`, keyword-independent per §39.3.2). Adding the
      // `middleware-handle` reason makes the escalation explicit so the
      // deprecation lint (W-DEPRECATED-SERVER-MODIFIER) fires on a keyword-
      // bearing `server function handle(...)`. The boundary itself is still
      // assigned `"middleware"` downstream (Step 6) by the same flag.
      // -------------------------------------------------------------
      const handleTriggers: EscalationReason[] = [];
      if ((fnNode as any).isHandleEscapeHatch === true) {
        handleTriggers.push({ kind: "middleware-handle", span: fnNode.span });
      }

      const directTriggers: EscalationReason[] = [
        ...explicitTriggers,
        ...bodyTriggers,
        ...channelTriggers,
        ...handleTriggers,
      ];

      // Build closure captures for this function.
      const closureCaptures = buildClosureCapturesForFunction(fnNode);

      // §12.4 E-ROUTE-002 — client-pin: does this fn's own body directly touch a
      // DOM-only global (`document`/`window`)? Scope-aware, ExprNode-only, stops
      // at nested function boundaries (see computeFileClientPins). Computed for
      // ALL functions including GENERATORS (S263 review #5): a CLIENT generator
      // touching the DOM must stay pinned; a SERVER/SSE generator is filtered out
      // downstream by the direct-server guard on clientPinnedFnIds (and, if it
      // ALSO has a server trigger, surfaces as the unplaceable E-ROUTE-005).
      const clientPin = fileClientPins.get(fnNodeId) ?? null;

      analysisMap.set(fnNodeId, {
        fnNodeId,
        filePath,
        fnNode,
        isPure: false,
        directTriggers,
        callees,
        warnings,
        closureCaptures,
        clientPin,
      });
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Direct-only escalation — no transitive callee inheritance.
  // A function is server-escalated only by its own direct triggers:
  //   - explicit `server` annotation
  //   - ?{} SQL block in the function body
  //   - access to protect= fields
  //   - access to session object
  //   - access to server-only resources (Bun.file, Bun.env, fs.*, etc.)
  // Calling a server function is NOT a trigger. The caller stays client-side
  // and uses a fetch stub at codegen time (§12 escalation rules, RI spec header).
  // ------------------------------------------------------------------

  /**
   * Resolve escalation reasons for a function node ID.
   * Returns ONLY the function's own direct triggers — does not recurse into callees.
   * A function that calls server functions stays client-side and uses fetch stubs.
   * It can freely mutate reactive state (§12 escalation rules + the F-RI-001
   * canonical Promise-chain pattern). Capture-based taint is layered on top by
   * Step 5b, not here.
   */
  function resolveEscalation(fnNodeId: string): EscalationReason[] {
    const record = analysisMap.get(fnNodeId);
    if (!record) return []; // External function — non-escalating.
    return [...record.directTriggers];
  }

  // ------------------------------------------------------------------
  // Step 5: Pre-resolve all directly server-escalated function IDs.
  // resolvedServerFnIds contains ONLY directly-escalated functions.
  // This set is used by CPS analysis to identify server calls within
  // client function bodies, enabling the server/client boundary split.
  // ------------------------------------------------------------------

  const escalationResults = new Map<string, { allReasons: EscalationReason[]; deduped: EscalationReason[] }>();
  const resolvedServerFnIds = new Set<string>();

  for (const [fnNodeId] of analysisMap) {
    const allReasons = resolveEscalation(fnNodeId);
    const deduped = deduplicateReasons(allReasons);
    escalationResults.set(fnNodeId, { allReasons, deduped });
    if (allReasons.length > 0) {
      resolvedServerFnIds.add(fnNodeId);
    }
  }

  // ------------------------------------------------------------------
  // §12.4 E-ROUTE-002 / E-ROUTE-005 — CLIENT-PINNED set + the unplaceable
  // both-sides reject (S263 review #6).
  //
  // A function that directly touches a DOM-only global (record.clientPin) splits
  // into two cases on whether it ALSO has a direct SERVER trigger (Step 5):
  //
  //   - NO direct server trigger → CLIENT-PINNED. Route analysis places it
  //     exclusively on the client. It is VETOED from the server-promotion
  //     fixpoints below (5b capture-taint, 5c caller-context) — pulling it
  //     server-side is exactly the soundness hole (its DOM code would land in the
  //     server bundle). It stays `boundary: "client"`; the reject pass (post-5c)
  //     fires E-ROUTE-002 for any server-classified caller reaching it.
  //
  //   - HAS a direct server trigger (`?{}` SQL, protected field, server-only
  //     resource, `server` keyword, …) AND touches the DOM → UNPLACEABLE. It
  //     cannot run on the server (no `document`/`window`) NOR on the client (the
  //     server-only resource has no client referent). This is DISTINCT from
  //     E-ROUTE-002 (a server fn CALLING a client-only fn) — it is a SINGLE
  //     self-contradictory function — so it gets its own code, E-ROUTE-005, with
  //     an accurate message, rather than silently shipping its DOM to the server.
  //     (Pre-S263-review this case was silently excluded and left server-placed.)
  // ------------------------------------------------------------------
  const clientPinnedFnIds = new Set<string>();
  for (const [fnNodeId, record] of analysisMap) {
    if (record.clientPin === null) continue;
    if (!resolvedServerFnIds.has(fnNodeId)) {
      clientPinnedFnIds.add(fnNodeId);
      continue;
    }
    // Both a direct server trigger AND a DOM access → unplaceable (E-ROUTE-005).
    const _fnName = record.fnNode.name ?? "<anonymous>";
    const _serverReason = describeServerTrigger(record.directTriggers);
    const _clientRes = record.clientPin.resource;
    const e005 = new RIError(
      "E-ROUTE-005",
      `E-ROUTE-005: Function \`${_fnName}\` accesses BOTH a server-only resource ` +
      `(${_serverReason}) AND a client-only global (\`${_clientRes}\`); it cannot be ` +
      `placed on either side. A server context has no \`document\`/\`window\`, and a ` +
      `client context cannot reach the server-only resource — so route analysis (§12) ` +
      `has no valid placement for this function. Split it: keep the server-only work ` +
      `(the \`?{}\` query / resource access) in a server function, move the DOM access ` +
      `into a separate client function, and have the client function call the server ` +
      `one (client → server is the allowed direction; §12.3). See §12.4.`,
      record.clientPin.span ?? record.fnNode.span,
    );
    e005.severity = "error";
    errors.push(e005);
  }

  // ------------------------------------------------------------------
  // Step 5b: Capture-based taint propagation via fixed-point iteration.
  //
  // If function A captures variable V, and V is the name of a function
  // that is server-tainted, then A is also server-tainted. This handles
  // closures that close over server-side functions or data.
  //
  // Unlike callee-based escalation (which uses fetch stubs), capture-based
  // taint means the function CLOSES OVER server state/behavior — it cannot
  // be split at the boundary.
  //
  // The lattice is: pure < client < server. Join = max.
  // Fixed-point iteration terminates because:
  //   1. The lattice is finite (3 levels)
  //   2. Each iteration can only promote a function UP the lattice
  //   3. Once server, a function stays server
  //   4. MAX_ITER guard prevents runaway in pathological cases
  // ------------------------------------------------------------------

  // Build name → fnNodeId mapping for capture lookup
  const fnNameToNodeIds = new Map<string, string[]>();
  for (const [fnNodeId, record] of analysisMap) {
    const name = record.fnNode.name;
    if (!name) continue;
    if (!fnNameToNodeIds.has(name)) fnNameToNodeIds.set(name, []);
    fnNameToNodeIds.get(name)!.push(fnNodeId);
  }

  // Also collect all reactive variable names declared at file scope —
  // if a function captures a server @var, it needs server context.
  // (Currently server @var produces server-tainted state-decl nodes,
  // which are not function nodes. For now, capture of @var names does
  // not propagate taint — the @var is accessed via _scrml_reactive_get
  // which is a runtime call, not a compile-time boundary concern.
  // This comment documents the design boundary.)

  const MAX_CAPTURE_TAINT_ITER = analysisMap.size + 1;
  let captureTaintChanged = true;
  let captureTaintIter = 0;

  while (captureTaintChanged && captureTaintIter < MAX_CAPTURE_TAINT_ITER) {
    captureTaintChanged = false;
    captureTaintIter++;

    for (const [fnNodeId, record] of analysisMap) {
      // Already server-tainted — nothing to propagate
      if (resolvedServerFnIds.has(fnNodeId)) continue;

      // §12.4 E-ROUTE-002 — a client-pinned function (direct DOM access) is NEVER
      // promoted server-side. Capturing a server-tainted symbol does not move a
      // fn that touches `document`/`window` off the client; the conflict is
      // surfaced as E-ROUTE-002 at the offending call site, not by silently
      // shipping its DOM code to the server.
      if (clientPinnedFnIds.has(fnNodeId)) continue;

      // Exclude callees from capture taint — calling a server function uses
      // a fetch stub (stays client). Only non-called captures trigger taint.
      const calleesSet = new Set(record.callees);

      // Check if any captured name is a server-tainted function
      for (const capturedName of record.closureCaptures) {
        // Skip names that are called (use fetch stubs) — only pure captures taint.
        if (calleesSet.has(capturedName)) continue;
        const capturedFnIds = fnNameToNodeIds.get(capturedName);
        if (!capturedFnIds) continue;

        for (const capturedFnId of capturedFnIds) {
          if (resolvedServerFnIds.has(capturedFnId)) {
            // This function captures a server-tainted function — propagate taint
            const capturedRecord = analysisMap.get(capturedFnId);
            const captureTaintReason: EscalationReason = {
              kind: "server-only-resource",
              resourceType: `closure-capture:${capturedName}`,
              span: record.fnNode.span,
            };

            // Update the analysis records
            record.directTriggers.push(captureTaintReason);
            resolvedServerFnIds.add(fnNodeId);

            // Update escalationResults
            const existing = escalationResults.get(fnNodeId);
            if (existing) {
              existing.allReasons.push(captureTaintReason);
              existing.deduped = deduplicateReasons(existing.allReasons);
            } else {
              escalationResults.set(fnNodeId, {
                allReasons: [captureTaintReason],
                deduped: [captureTaintReason],
              });
            }

            captureTaintChanged = true;
            break; // One taint reason is sufficient — move to next function
          }
        }
        if (resolvedServerFnIds.has(fnNodeId)) break;
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 5c: Caller-context propagation (Insight 26 Batch 1, 2026-05-08).
  //
  // Forward fixed-point: a function with NO direct triggers and NO
  // capture taint, called ONLY from server-classified callers (and never
  // from any client-classified function), escalates to server.
  //
  // This is the load-bearing precondition that makes Position B safe
  // (server keyword deprecation): functions that exist only to be called
  // from server contexts get correctly classified server even without
  // explicit annotation or body triggers.
  //
  // Rules:
  //   - Function with at least one client caller stays AMBIENT (client-
  //     classified for now; codegen handles the cross-boundary call via
  //     fetch stub at call site, current behavior preserved).
  //   - Function with no callers at all stays unchanged (Step 6's D4
  //     dead-code-warn handles those separately).
  //   - Function called ONLY by server-classified functions promotes to
  //     server.
  //   - Cycles where neither cycle member has direct triggers and the
  //     cycle has no external server callers: stay client (the lattice
  //     join is monotonic; without a "seed" server caller, propagation
  //     never starts).
  //
  // The algorithm is monotonic (only ever PROMOTES client→server, never
  // demotes), so the lattice fixed-point terminates in at most
  // analysisMap.size iterations.
  // ------------------------------------------------------------------

  // Build inverse caller map: calleeFnNodeId → Set<callerFnNodeId>.
  // Resolves callees by name via fnNameToNodeIds (already built for 5b).
  const inverseCallerMap = new Map<string, Set<string>>();
  for (const [callerFnNodeId, callerRecord] of analysisMap) {
    for (const calleeName of callerRecord.callees) {
      const calleeFnIds = fnNameToNodeIds.get(calleeName);
      if (!calleeFnIds) continue;
      for (const calleeFnId of calleeFnIds) {
        if (!inverseCallerMap.has(calleeFnId)) inverseCallerMap.set(calleeFnId, new Set());
        inverseCallerMap.get(calleeFnId)!.add(callerFnNodeId);
      }
    }
  }

  const MAX_CALLER_CTX_ITER = analysisMap.size + 1;
  let callerCtxChanged = true;
  let callerCtxIter = 0;

  while (callerCtxChanged && callerCtxIter < MAX_CALLER_CTX_ITER) {
    callerCtxChanged = false;
    callerCtxIter++;

    for (const [fnNodeId, record] of analysisMap) {
      // Already server-classified — no propagation needed.
      if (resolvedServerFnIds.has(fnNodeId)) continue;

      // §12.4 E-ROUTE-002 — a client-pinned function (direct DOM access) is NEVER
      // promoted server-side by caller-context inheritance. THIS is the soundness
      // fix: previously a DOM helper called only from a server fn escalated here
      // (Trigger 5) and its `document.*` code was emitted into the server bundle.
      // It now stays client; the offending server caller fires E-ROUTE-002 below.
      if (clientPinnedFnIds.has(fnNodeId)) continue;

      // §39.3: handle() escape hatch is middleware, not server. Skip.
      if ((record.fnNode as any).isHandleEscapeHatch === true) continue;

      const callers = inverseCallerMap.get(fnNodeId);
      if (!callers || callers.size === 0) continue;

      // Classify callers. Skip self-references (cycles) — a function calling
      // itself doesn't add information for propagation.
      let serverCallerCount = 0;
      let clientCallerCount = 0;
      for (const callerId of callers) {
        if (callerId === fnNodeId) continue; // self-reference
        if (resolvedServerFnIds.has(callerId)) {
          serverCallerCount++;
        } else {
          clientCallerCount++;
        }
      }

      // No non-self callers → cycle-only or self-only → skip.
      if (serverCallerCount === 0 && clientCallerCount === 0) continue;

      // ANY client caller → stay AMBIENT (current behavior preserved).
      if (clientCallerCount > 0) continue;

      // ALL non-self callers are server-classified → promote.
      const propagatedReason: EscalationReason = {
        kind: "server-only-resource",
        resourceType: "caller-context-propagation",
        span: record.fnNode.span,
      };

      record.directTriggers.push(propagatedReason);
      resolvedServerFnIds.add(fnNodeId);

      const existing = escalationResults.get(fnNodeId);
      if (existing) {
        existing.allReasons.push(propagatedReason);
        existing.deduped = deduplicateReasons(existing.allReasons);
      } else {
        escalationResults.set(fnNodeId, {
          allReasons: [propagatedReason],
          deduped: [propagatedReason],
        });
      }

      callerCtxChanged = true;
    }
  }

  // ------------------------------------------------------------------
  // Step 5c-bis: §12.4 E-ROUTE-002 — server→client-only call-graph reject.
  //
  // With every server classification settled (Steps 5 / 5b / 5c) and the
  // client-pinned set fixed, walk each server-classified function's STATIC CALL
  // GRAPH. If it reaches a client-pinned function — directly or transitively —
  // that is the §12.4 violation: a server-executing function cannot call a
  // function route analysis places exclusively on the client (a server context
  // has no `document`/`window`). Emit E-ROUTE-002 naming (a) the server fn,
  // (b) the client-only callee, (c) the call chain (§12.4).
  //
  // Reporting (S263 review #7): dedup per (SERVER-ROOT fn, client callee) — each
  // BFS is one server root and reports each client-pinned callee it reaches ONCE
  // (shortest chain). Two distinct server fns leaking to the SAME client fn each
  // get their own E-ROUTE-002 (no cross-root global dedup that would hide one).
  //
  // Callee resolution (S263 review #3/#4): route-inference has NO precise
  // import-aware callee resolver — `fnNameToNodeIds` is name-keyed and GLOBAL
  // across files (as are the 5b/5c escalation passes). For a HARD ERROR we
  // resolve a call ONLY to SAME-FILE function-decls (a bare call binds to the
  // same-file declaration with certainty). We DELIBERATELY do NOT fall back to
  // the global set: a coincidental same-name client-pinned fn in ANOTHER file is
  // NOT the target of this call, and firing on it rejects valid code (#3). If a
  // same-file name is itself ambiguous (a client-pinned candidate alongside a
  // non-pinned one — e.g. a nested + top-level same-name), we do NOT fire and
  // traverse the non-pinned candidates. We fire ONLY when the call UNAMBIGUOUSLY
  // resolves, same-file, to client-pinned function(s).
  //
  // RESIDUAL (S263 review #4, DOCUMENTED — see §12.4): a genuine CROSS-FILE
  // server -> client-only leak whose callee is reached by a name with no
  // same-file binding is NOT caught. Catching it would require firing on a
  // globally-ambiguous cross-file name, which reintroduces #3's false positive —
  // and no-false-positives is the priority. This narrow miss awaits a precise
  // import-aware resolver; a V1 limitation.
  // ------------------------------------------------------------------
  if (clientPinnedFnIds.size > 0) {
    for (const [serverFnId, serverRecord] of analysisMap) {
      if (!resolvedServerFnIds.has(serverFnId)) continue;
      // handle() middleware is server-executing but is its own boundary; it
      // still cannot call client-only code, so it participates as a server root.
      const serverName = serverRecord.fnNode.name ?? "<anonymous>";

      // BFS over the callee graph, tracking the name-path for the chain message.
      const visited = new Set<string>([serverFnId]);
      const reported = new Set<string>(); // client-pinned ids reported in THIS bfs
      const queue: Array<{ id: string; path: string[] }> = [
        { id: serverFnId, path: [serverName] },
      ];
      while (queue.length > 0) {
        const { id, path } = queue.shift()!;
        const rec = analysisMap.get(id);
        if (!rec) continue;
        const callerFile = rec.filePath;
        for (const calleeName of rec.callees) {
          const globalIds = fnNameToNodeIds.get(calleeName);
          if (!globalIds || globalIds.length === 0) continue;
          // SAME-FILE resolution ONLY — no global cross-file fallback (#3). A
          // call with no same-file binding is import/undefined; treat as
          // uncertain and skip (the #4 documented residual).
          const resolved = globalIds.filter(
            (cid) => analysisMap.get(cid)?.filePath === callerFile,
          );
          if (resolved.length === 0) continue;
          const chain = [...path, calleeName];

          // UNAMBIGUOUS client-pinned target: every resolved candidate is
          // client-pinned. (A single same-file resolution is the common case.)
          const allPinned =
            resolved.length > 0 &&
            resolved.every((cid) => clientPinnedFnIds.has(cid));

          if (allPinned) {
            const target = resolved.find((cid) => !reported.has(cid));
            for (const cid of resolved) visited.add(cid); // client leaves
            if (target === undefined) continue; // already reported in this bfs
            reported.add(target);
            const pin = analysisMap.get(target)?.clientPin;
            const accessDesc = pin
              ? `it accesses the client-only global \`${pin.resource}\``
              : "it is client-only";
            const chainStr = chain.join(" -> ");
            const ro02 = new RIError(
              "E-ROUTE-002",
              `E-ROUTE-002: Server-escalated function \`${serverName}\` calls the ` +
              `client-only function \`${calleeName}\` (${accessDesc}), which route ` +
              `analysis places exclusively on the client. A server function runs in ` +
              `the Bun process, where the client-only referent does not exist, so this ` +
              `call cannot execute server-side. Call chain: ${chainStr}. ` +
              `Fix by one of: extract the shared logic into a pure \`fn\` (§33) with no ` +
              `client or server classification and call that from both sides; duplicate ` +
              `the needed logic inside \`${serverName}\`; or re-evaluate whether ` +
              `\`${calleeName}\` is genuinely client-only (§12.4).`,
              serverRecord.fnNode.span,
            );
            ro02.severity = "error";
            errors.push(ro02);
            continue;
          }

          // Not unambiguous: traverse the NON-pinned candidates for transitivity
          // (a client-pinned candidate is a client leaf; on ambiguity we do NOT
          // fire — see the resolution note above).
          for (const calleeId of resolved) {
            if (clientPinnedFnIds.has(calleeId)) continue;
            if (visited.has(calleeId)) continue;
            visited.add(calleeId);
            queue.push({ id: calleeId, path: chain });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 5d: Insight 26 Batch 1 D4+D5 (2026-05-08) — emit deprecation +
  // dead-function diagnostics.
  //
  // D4: W-DEAD-FUNCTION fires for a function with NO callers (anywhere
  //     in the project) AND NOT exported AND NOT explicitly server-
  //     annotated AND whose name does not appear as an identifier in any
  //     markup attribute value or any bare-expr text outside its own body.
  //
  // D5: W-DEPRECATED-SERVER-MODIFIER fires for a function with `isServer`
  //     === true AND at least one OTHER (non-explicit-annotation)
  //     escalation reason. The keyword is redundant in this case;
  //     the function would still be classified server even without it.
  // ------------------------------------------------------------------

  // Build the set of exported function names (per file) — exporting a
  // function makes it potentially-callable from outside the project, so
  // it is never "dead" by RI's body-callee analysis alone.
  // CE wraps FileAST in `.ast`; unit tests pass bare FileAST. Try both.
  // §64 — a `kind="tool"` program's `main` is the entry point invoked by the
  // codegen-emitted harness (`main(process.argv.slice(2))`), not by any in-source
  // caller — so RI's caller analysis sees it as "dead." Collect each tool file's
  // `main` node so D4 never false-fires W-DEAD-FUNCTION on it. (Helper fns called
  // by main already have callers via inverseCallerMap, so only `main` needs this.)
  const toolMainFnNodes = new Set<unknown>();
  for (const fileAST of files) {
    if (isToolProgram(fileAST)) {
      const m = findToolMainFn(fileAST);
      if (m) toolMainFnNodes.add(m);
    }
  }

  const exportedFnNames = new Set<string>();
  for (const fileAST of files) {
    const exps = (fileAST.exports ?? ((fileAST as any).ast ? (fileAST as any).ast.exports : [])) as
      Array<{ exportedName: string | null }>;
    for (const exp of exps ?? []) {
      if (exp && exp.exportedName) exportedFnNames.add(exp.exportedName);
    }
  }

  // Build the set of identifier-like tokens that appear ANYWHERE in the
  // project's markup attribute values, raw markup text, or bare-expr text
  // OUTSIDE the body of the function being analyzed. This is used as a
  // conservative "may be referenced from markup" check.
  //
  // RI does NOT walk markup ASTs in detail (the body-callee pass only
  // looks at function bodies). Without this heuristic, a function called
  // only from `<button onclick={fn}>` would falsely fire W-DEAD-FUNCTION.
  // The cost of this heuristic is at most O(total-source-text length).
  const markupReferencedNames = new Set<string>();
  const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  function collectIdentsFromText(text: string): void {
    if (!text) return;
    let m: RegExpExecArray | null;
    while ((m = IDENT_RE.exec(text)) !== null) {
      markupReferencedNames.add(m[0]);
    }
  }
  // Walker collects identifier names ONLY from MARKUP-context text:
  //   - markup attribute values (e.g. onclick="handleClick()")
  //   - markup attribute exprNodes (newer canonical form)
  //   - bare-expr nodes nested inside markup AS markup interpolations
  //   - text nodes (raw markup text)
  //
  // Identifiers found inside FUNCTION BODIES are NOT collected — those
  // are tracked by the body-callee analysis (record.callees), which feeds
  // the inverseCallerMap. Including them here would falsely mask dead
  // self-recursive functions (a function calling only itself is still
  // dead).
  //
  // The walker is intentionally over-inclusive of EXTERNAL references:
  // false positives in markupReferencedNames simply suppress the
  // (advisory) W-DEAD-FUNCTION, which is the safe direction.
  function walkMarkupContext(node: any): void {
    if (!node || typeof node !== "object") return;

    // STOP at function-decl: do NOT collect identifiers from inside any
    // function body. Body-callee analysis handles those references.
    if (node.kind === "function-decl") return;

    if (node.kind === "markup" && Array.isArray(node.attrs)) {
      for (const a of node.attrs) {
        if (!a) continue;
        // Legacy / direct-string attribute values.
        if (typeof a.value === "string") collectIdentsFromText(a.value);
        if (a.exprNode) collectIdentsFromText(emitStringFromTree(a.exprNode));
        if (typeof a.raw === "string") collectIdentsFromText(a.raw);
        // Structured AttrValue forms (canonical AST shape).
        const av = a.value;
        if (av && typeof av === "object") {
          // call-ref: e.g. `onclick=handleClick(arg)` — collect callee name + arg idents.
          if (av.kind === "call-ref") {
            if (av.name) markupReferencedNames.add(av.name);
            if (Array.isArray(av.args)) {
              for (const arg of av.args) {
                if (typeof arg === "string") collectIdentsFromText(arg);
              }
            }
            if (Array.isArray(av.argExprNodes)) {
              for (const en of av.argExprNodes) {
                if (en) collectIdentsFromText(emitStringFromTree(en));
              }
            }
          }
          // variable-ref: e.g. `class=someVar` — collect the reference.
          if (av.kind === "variable-ref" && av.name) {
            markupReferencedNames.add(av.name);
            if (av.exprNode) collectIdentsFromText(emitStringFromTree(av.exprNode));
          }
          // expr: e.g. `class={cond ? 'a' : 'b'}` — collect from raw / exprNode.
          if (av.kind === "expr") {
            if (typeof av.raw === "string") collectIdentsFromText(av.raw);
            if (av.exprNode) collectIdentsFromText(emitStringFromTree(av.exprNode));
            if (Array.isArray(av.refs)) for (const r of av.refs) markupReferencedNames.add(r);
          }
          // string-literal: e.g. `class="foo"` — usually not a fn ref, but
          // be conservative and collect identifiers anyway.
          if (av.kind === "string-literal" && typeof av.value === "string") {
            collectIdentsFromText(av.value);
          }
        }
      }
    }
    // Bare-expr text inside markup interpolations (`${fn()}` in markup).
    // Note: we walk ALL bare-expr at logic-block top level too, but
    // function-decl returns above, so these are limited to non-function
    // contexts (markup interpolations + top-level logic statements).
    if (node.kind === "bare-expr") {
      const txt = node.exprNode ? emitStringFromTree(node.exprNode) : (node.expr ?? "");
      collectIdentsFromText(txt);
    }
    if (node.kind === "text" && typeof node.text === "string") {
      collectIdentsFromText(node.text);
    }

    // S93 fix — test-block (`~{ test "name" { body } }`) bodies are stored
    // as raw STRINGS in testGroup.tests[*].body (parseTestBody collects raw
    // statement text rather than parsing to AST). The generic-recursion
    // below only walks Array + object-with-kind values, so the body strings
    // are invisible to the markup-reference walker and any function called
    // ONLY from tests (e.g. setStep in examples/10-inline-tests.scrml) is
    // wrongly classified as dead.
    if (node.kind === "test" && node.testGroup) {
      const tg = node.testGroup as any;
      // testGroup.tests[*].body is string[]; testGroup.before/after are too.
      const collect = (s: unknown) => { if (typeof s === "string") collectIdentsFromText(s); };
      if (Array.isArray(tg.tests)) {
        for (const t of tg.tests) {
          if (Array.isArray(t?.body)) for (const stmt of t.body) collect(stmt);
        }
      }
      if (Array.isArray(tg.before)) for (const stmt of tg.before) collect(stmt);
      if (Array.isArray(tg.after)) for (const stmt of tg.after) collect(stmt);
    }

    // S93 fix — when-handler bodies (`when message(data) { body }`,
    // `when worker-msg from <#w>(data) { ... }`, generic `when X { body }`)
    // carry body as raw string in `bodyRaw` (alongside a parsed `bodyExpr`
    // ExprNode). Generic recursion would walk bodyExpr (it's an object-with-
    // kind) but identifiers inside ExprNode trees aren't collected by
    // walkMarkupContext (which looks at specific fields, not nested ExprNode
    // kinds). The bodyRaw string is also outside EXPR_STRING_FIELDS. Result:
    // functions called ONLY from `when` handlers (e.g. sieve in
    // examples/13-worker.scrml) are wrongly classified as dead.
    //
    // Three when-handler kinds in the AST builder:
    //   - "when-effect" (when message from _scrml_worker_NAME — generic)
    //   - "when-message" (when message(data) — bare worker event)
    //   - "when-worker-<eventType>" (when E from <#w>(data) — typed event)
    if (
      typeof node.kind === "string" &&
      (node.kind === "when-effect" ||
        node.kind === "when-message" ||
        node.kind.startsWith("when-worker-")) &&
      typeof node.bodyRaw === "string"
    ) {
      collectIdentsFromText(node.bodyRaw);
    }
    // S96 Bug 7 fix — component-def bodies are stored as raw text strings
    // (per primer §13.7 B17 specifics: "component-def stores body as
    // `raw: string`, not walkable AST"). Functions called from event-handler
    // attributes inside component bodies (e.g., `ondragstart=startDrag(...)`
    // inside `const TaskCard = <li ...>`) are invisible to the generic
    // recursion below because it only descends into Array + object-with-kind
    // fields. Mirror the when-handler `bodyRaw` pattern above.
    if (node.kind === "component-def" && typeof node.raw === "string") {
      collectIdentsFromText(node.raw);
    }
    // Bug 4 / S87 Trio A: nodes nested INSIDE markup-context logic blocks
    // (if-stmt / while-stmt / for-stmt / return-stmt / let-decl / etc.) carry
    // their expression payloads in STRING fields (`condition`, `header`,
    // `expr`, `value`, `init`, `test`). The recursion at the bottom of this
    // walker only descends into Array values and child object-with-kind
    // values, so string-typed expression fields are silently skipped.
    //
    // Example false-fire shape (TodoMVC fixture, footer markup-level logic):
    //   `${ if (completedCount() > 0) { lift <button .../> } }`
    // The if-stmt node carries `condition: "( completedCount ( ) > 0 )"`.
    // Without the scan below, `completedCount` is never added to
    // markupReferencedNames, and W-DEAD-FUNCTION false-fires.
    //
    // Mirrors the DG `sweepNodeForAtRefs` string-fallback at
    // dependency-graph.ts:1785 (`exprFields = ["expr", "init", "condition",
    // "value", "test", "header", "iterable"]`). Same union of field names.
    //
    // ExprNode-shaped sister fields (`condExpr`, `valueExpr`, `exprNode`)
    // are walked by the kind-recursion below; this block adds the string
    // fallback only.
    {
      const EXPR_STRING_FIELDS = [
        "expr", "init", "condition", "value", "test", "header", "iterable",
      ] as const;
      for (const field of EXPR_STRING_FIELDS) {
        const v = node[field];
        if (typeof v === "string") collectIdentsFromText(v);
      }
      // ExprNode sister fields — emitStringFromTree + collectIdentsFromText
      // catches identifiers regardless of whether the AST builder produced
      // a string or an ExprNode for the same logical expression.
      const EXPR_NODE_FIELDS = [
        "condExpr", "valueExpr", "exprNode", "testExpr", "headerExpr",
      ] as const;
      for (const field of EXPR_NODE_FIELDS) {
        const v = node[field];
        if (v && typeof v === "object" && (v.type || v.kind)) {
          try { collectIdentsFromText(emitStringFromTree(v)); } catch { /* ignore */ }
        }
      }
    }
    // Recurse into children/body/etc.
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const child of val) walkMarkupContext(child);
      } else if (val && typeof val === "object" && val.kind) {
        walkMarkupContext(val);
      }
    }
  }
  for (const fileAST of files) {
    // CE wraps the FileAST in `.ast`; bare-FileAST inputs (unit tests) keep
    // .nodes at the top level. Try both, same idiom as buildImportedServerFnNames.
    const nodes = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []) ?? [];
    for (const top of nodes) walkMarkupContext(top);
  }

  // ------------------------------------------------------------------
  // §61 <endpoint> private-arm reachability seed
  // (endpoint-private-arm-reachability-2026-06-25).
  //
  // An `<endpoint>` arm body — the §61.2 canonical form `<FleetStatus :
  // fleetStatus()>` — calls a LOCAL pure `fn`. The endpoint handler runs
  // server-side (§61.6), so that fn is SERVER-reachable. But the W-DEAD /
  // tree-shake analysis here only sees markup refs + fn-body callers, and an
  // endpoint arm body is neither — so a fn referenced ONLY from an arm (a)
  // false-fires W-DEAD-FUNCTION below and (b) is never emitted into the
  // `.server.js` the handler calls it from → runtime ReferenceError. Collect the
  // arm-body callee idents to (1) suppress W-DEAD for the DIRECT roots (D4
  // below), and (2) drive the post-Step-6 server-retain / client-skip closure
  // (the RouteMap endpoint sets).
  //
  // GATED on `<endpoint>` presence — `endpointDeclsByFile` stays empty when no
  // file declares one, so every endpoint set below stays empty and the W-DEAD /
  // placement behavior is byte-identical for a non-endpoint app.
  // ------------------------------------------------------------------
  const endpointArmReferencedNames = new Set<string>();
  const endpointDeclsByFile = new Map<string, Record<string, unknown>[]>();
  {
    const EP_IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    const collectEndpointDeclsDeep = (node: unknown, out: Record<string, unknown>[]): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { for (const c of node) collectEndpointDeclsDeep(c, out); return; }
      const n = node as Record<string, unknown>;
      if (n.kind === "endpoint-decl") out.push(n);
      if (Array.isArray(n.children)) collectEndpointDeclsDeep(n.children, out);
      if (Array.isArray(n.body)) collectEndpointDeclsDeep(n.body, out);
      if (Array.isArray(n.bodyChildren)) collectEndpointDeclsDeep(n.bodyChildren, out);
      if (Array.isArray(n.branches)) collectEndpointDeclsDeep(n.branches, out);
    };
    for (const fileAST of files) {
      const nodes = fileAST.nodes ?? ((fileAST as any).ast ? (fileAST as any).ast.nodes : []) ?? [];
      const decls: Record<string, unknown>[] = [];
      collectEndpointDeclsDeep(nodes, decls);
      if (decls.length === 0) continue;
      endpointDeclsByFile.set(fileAST.filePath, decls);
      for (const ep of decls) {
        const arms = (ep as Record<string, unknown>).arms;
        for (const arm of (Array.isArray(arms) ? arms : [])) {
          const bodyRaw = (arm as Record<string, unknown>)?.bodyRaw;
          if (typeof bodyRaw !== "string") continue;
          EP_IDENT_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = EP_IDENT_RE.exec(bodyRaw)) !== null) endpointArmReferencedNames.add(m[0]);
        }
      }
    }
  }

  // (S93's `hasLiftInFunctionBody` lift-suppression helper was removed in S180
  // D3.1 — see the D5 fire-path comment below. `lift` is now valid in an
  // inferred-server plain `function` body, so a lift-bearing escalating
  // `server function` IS a redundant-keyword site and SHOULD fire the lint.)

  // Now emit D4 (W-DEAD-FUNCTION) + D5 (W-DEPRECATED-SERVER-MODIFIER).
  for (const [fnNodeId, record] of analysisMap) {
    const fnName = record.fnNode.name;
    if (!fnName) continue;

    // §39.3: handle() escape hatch is middleware — never dead-warn (it is an
    // entry point, not a normal user function). It MAY still deprecation-warn:
    // D2 (§39.3.2 amendment) makes a keyword-bearing `server function handle()`
    // fire W-DEPRECATED-SERVER-MODIFIER, since the reserved name now supplies
    // the escalation reason (`middleware-handle`) on its own.
    const isHandleHatch = (record.fnNode as any).isHandleEscapeHatch === true;

    // -- D4: W-DEAD-FUNCTION --------------------------------------------
    const callers = inverseCallerMap.get(fnNodeId);
    const hasCallers = callers !== undefined && callers.size > 0 &&
      // Only count non-self callers; a function calling only itself is
      // still effectively dead.
      Array.from(callers).some(c => c !== fnNodeId);
    const isExported = exportedFnNames.has(fnName);
    const isExplicitServer = record.fnNode.isServer === true;
    const isMarkupReferenced = markupReferencedNames.has(fnName);

    // §61 <endpoint> private-arm reachability: a fn referenced from an
    // `<endpoint>` arm body (§61.2) is SERVER-reachable (the handler runs
    // server-side, §61.6) — not dead. Suppress the W-DEAD-FUNCTION false-fire.
    const isEndpointReferenced = endpointArmReferencedNames.has(fnName);

    // Functions that are also generators (SSE) are explicitly intended as
    // entry points; never dead-warn.
    const isGenerator = (record.fnNode as any).isGenerator === true;

    // §64 — the tool `main` entry is invoked by the emitted harness, not an
    // in-source caller; never dead-warn it.
    const isToolMainEntry = toolMainFnNodes.has(record.fnNode);

    if (!isHandleHatch && !hasCallers && !isExported && !isExplicitServer && !isMarkupReferenced && !isEndpointReferenced && !isGenerator && !isToolMainEntry) {
      const warn = new RIError(
        "W-DEAD-FUNCTION",
        `W-DEAD-FUNCTION: Function \`${fnName}\` has no callers, is not exported, ` +
        `is not server-annotated, and is not referenced from markup. ` +
        `It will be tree-shaken from the output. Remove the declaration if intended dead, ` +
        `or wire it up to a caller. ` +
        `(Note: RI does not yet track all markup reference patterns; ` +
        `if this is a false positive, export the function or add an explicit caller.)`,
        record.fnNode.span,
      );
      warn.severity = "warning";
      errors.push(warn);
    }

    // -- D5: W-DEPRECATED-SERVER-MODIFIER -------------------------------
    //
    // The `server` modifier is redundant exactly when removing it leaves a
    // function that STILL escalates to server on its own — i.e. when the
    // function has at least one NON-explicit-annotation escalation reason
    // (the `triggerDesc !== null` guard below). The keyword adds nothing in
    // that case, so the lint fires and Migration 4 (commands/migrate.js) can
    // safely strip it.
    //
    // S180 D3.1 — removed the S93 `!hasLiftInFunctionBody` suppression.
    // S93 skipped any `lift`-bearing body on the premise that dropping
    // `server` would trip E-SYNTAX-002 (`lift` illegal in a plain `function`).
    // S180 D1 (§10.4, type-system.ts:14497) made `lift`-as-return VALID in an
    // INFERRED-server plain `function` (the boundary is inferred from the body,
    // not the keyword). So a `lift ?{...}.all()` body supplies a
    // `server-only-resource` escalation reason (see the lift-expr handler
    // above) and stays inferred-server after the keyword is dropped — the
    // keyword IS redundant and the lint SHOULD fire. The `triggerDesc !== null`
    // guard still protects a `lift`-PURE function (a `lift` body with NO
    // sql/protected/channel/handle reason and no server callers): its
    // `otherReasons` is empty → triggerDesc stays null → no fire.
    if (isExplicitServer) {
      const escalation = escalationResults.get(fnNodeId);
      const otherReasons = (escalation?.deduped ?? []).filter(
        r => r.kind !== "explicit-annotation",
      );

      // Body-trigger evidence (T1/T2/T3 + capture-taint).
      let triggerDesc: string | null = null;
      if (otherReasons.length > 0) {
        const first = otherReasons[0];
        if (first.kind === "server-only-resource") {
          triggerDesc = `server-only resource (${first.resourceType})`;
        } else if (first.kind === "protected-field-access") {
          triggerDesc = `protected field access (${first.field})`;
        } else if (first.kind === "channel-broadcast") {
          // §12.2 Trigger 7b (broadcast()/disconnect() only — RULING A).
          triggerDesc = `channel broadcast/disconnect (${first.detail})`;
        } else if (first.kind === "middleware-handle") {
          // §12.2 Trigger 8 (D2): the reserved name handle() is the escalation.
          triggerDesc = "the reserved middleware name handle()";
        } else {
          triggerDesc = first.kind;
        }
      } else if (callers && callers.size > 0) {
        // Caller-context-propagation evidence: D3 didn't run for this
        // function (already server via Trigger 4), but if it WOULD have
        // promoted under D3 (all non-self callers are server), the
        // keyword is redundant.
        let serverCallerCount = 0;
        let clientCallerCount = 0;
        for (const callerId of callers) {
          if (callerId === fnNodeId) continue;
          if (resolvedServerFnIds.has(callerId)) {
            serverCallerCount++;
          } else {
            clientCallerCount++;
          }
        }
        if (serverCallerCount > 0 && clientCallerCount === 0) {
          triggerDesc = "caller-context-propagation";
        }
      }

      if (triggerDesc !== null) {
        // The keyword is redundant — the function would escalate anyway.
        const warn = new RIError(
          "W-DEPRECATED-SERVER-MODIFIER",
          `W-DEPRECATED-SERVER-MODIFIER: 'server' modifier on \`${fnName}\` is redundant ` +
          `— function body already escalates to server via ${triggerDesc}. ` +
          `The 'server' keyword is deprecated; remove from new code. ` +
          `(Per Insight 26, 2026-05-08: body-content inference + caller-context propagation ` +
          `now classify server functions structurally.)`,
          record.fnNode.span,
        );
        warn.severity = "warning";
        errors.push(warn);
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 6: Finalize RouteMap entries, apply CPS analysis, collect errors.
  // ------------------------------------------------------------------

  for (const [fnNodeId, record] of analysisMap) {
    // Accumulate E-ROUTE-001 warnings (with severity propagated).
    for (const w of record.warnings) {
      const riErr = new RIError(w.code, w.message, w.span);
      if (w.severity) riErr.severity = w.severity;
      errors.push(riErr);
    }

    // §39.3: handle() escape hatch — treat as middleware boundary.
    // §12.2 Trigger 8 (D2): surface the deduped escalation reasons (always
    // includes `middleware-handle`, plus `explicit-annotation` when the
    // deprecated `server` keyword is present) so the route map reflects WHY
    // the function is server-side. The boundary stays "middleware" — handle()
    // is server-executing but is woven into the pipeline, not a route.
    if ((record.fnNode as any).isHandleEscapeHatch === true) {
      const _handleEsc = escalationResults.get(fnNodeId);
      functions.set(fnNodeId, {
        functionNodeId: fnNodeId,
        boundary: "middleware",
        escalationReasons: _handleEsc?.deduped ?? [{ kind: "middleware-handle", span: record.fnNode.span }],
        generatedRouteName: null,
        explicitRoute: null,
        explicitMethod: null,
        isSSE: false,
        serverEntrySpan: null,
        cpsSplit: null,
      });
      continue;
    }

    const { allReasons, deduped } = escalationResults.get(fnNodeId)!;

    const isServer = allReasons.length > 0;
    const boundary: "client" | "server" = isServer ? "server" : "client";

    let cpsSplit: CPSSplit | null = null;

    if (isServer) {
      const body = Array.isArray(record.fnNode.body) ? record.fnNode.body : [];

      // §38.4 / §38.6.1 (RULING A, change-id
      // `channel-cell-write-client-side-A-2026-06-12`, Part 2):
      // a SERVER-context channel function SHALL NOT READ a channel-declared
      // cell. Channel cells are client-held — there is no server-side value, so
      // a read lowers to `_scrml_body["<cell>"]` (HTTP body) or the empty `{}`
      // WS-handler fallback, both `undefined` at runtime → `[...@cell, x]`
      // crashes silently. We are here only when the function is server-placed:
      // escalated via broadcast()/disconnect() (Trigger 7b), recognized as an
      // `onserver:*` handler (`channel-ws-handler`), or escalated by any other
      // §12.2 trigger (e.g. a `?{}` SQL block). Fire E-CHANNEL-SERVER-CELL-READ.
      // A CLIENT-side function reading a channel cell never reaches this arm
      // (it is not server-escalated), so the client read is unaffected.
      {
        const _fnName = record.fnNode.name ?? "";
        const _ownerChannel = _fnName
          ? perFileChannelFnMap.get(record.filePath)?.get(_fnName)
          : undefined;
        if (_ownerChannel != null) {
          const _channelCells =
            perFileChannelCellMap.get(record.filePath)?.get(_ownerChannel) ?? null;
          if (_channelCells != null && _channelCells.size > 0) {
            const _read = detectServerContextChannelCellRead(body, _channelCells);
            if (_read !== null) {
              errors.push(new RIError(
                "E-CHANNEL-SERVER-CELL-READ",
                `E-CHANNEL-SERVER-CELL-READ: Server-side channel function \`${_fnName}\` ` +
                `reads the client-held channel cell \`@${_read.cell}\`. Channel cells are ` +
                `client-held (§38.4) — they have no server-side value, so this read is ` +
                `\`undefined\` at request time. Operate on the message payload / the function's ` +
                `arguments instead, and broadcast a value derived from them (§38.6.1). ` +
                `(A channel-cell WRITE runs on the client and syncs automatically — RULING A, §38.4.)`,
                _read.span ?? record.fnNode.span,
              ));
            }
          }
        }
      }

      // §36: SSE generator functions — skip E-RI-002 and CPS analysis.
      if ((record.fnNode as any).isGenerator === true) {
        // Generator functions skip CPS and E-RI-002. cpsSplit remains null.
      } else {
        const reactiveAssignment = findReactiveAssignment(body);

        if (reactiveAssignment !== null) {
          const cpsResult = analyzeCPSEligibility(
            body,
            allProtectedFields,
            stateBlockIdByField,
            functionIndex,
            analysisMap,
            resolvedServerFnIds,
            importedServerFnNames,
            // Insight 26 D2c: per-file server-only imported namespaces.
            perFileImportedServerNamespaces.get(record.filePath) ?? new Set<string>(),
          );

          if (cpsResult && cpsResult.eligible) {
            // Ext 1 M1.1: single-batch construction is the back-compat
            // baseline.
            cpsSplit = CPSSplit.singleBatch(
              cpsResult.serverStmtIndices,
              cpsResult.clientStmtIndices,
              cpsResult.returnVarName,
            );

            // Ext 1 M1.3: run the multi-batch planner over the body-DG. The
            // planner topologically schedules the statement-grain DG (M1.2),
            // coalesces contiguous server runs into batches, and either
            // (a) produces a multi-batch plan we install into `serverBatches`,
            // or (b) statically rejects an irreducible cross-batch dependency
            // / a `<machine>` advance crossing a batch boundary.
            const _bodyDG = buildBodyDG(body, {
              server: cpsResult.pureServerIndices,
              reactive: cpsResult.reactiveServerIndices,
            });
            const _plan = planMultiBatchCPS(_bodyDG, body);
            if (_plan.status === "reject") {
              // E-CPS-MULTIBATCH-REORDER / E-CPS-MULTIBATCH-MACHINE-CROSSING.
              // §34 catalog registration of these codes lands at M1.6; the
              // planner produces the diagnostic shape + offending statements
              // here so the reject path is wired end-to-end.
              cpsSplit = null;
              errors.push(new RIError(
                _plan.code,
                `${_plan.code}: ${_plan.message}`,
                record.fnNode.span,
              ));
            } else if (_plan.batches.length > 0) {
              // Install the planned batches. A single-batch plan is identical
              // to the M1.1 baseline; a multi-batch plan is the Ext 1 shape.
              cpsSplit.serverBatches = _plan.batches;
              // M1.5: store the planner's topological schedule so codegen's
              // client-wrapper emit can sequence client statements between
              // the per-batch awaits.
              cpsSplit.topoOrder = _plan.topoOrder;
            }
          } else {
            // Bug-5 follow-on to C18 (§38.4, S83 Wave 4A): channel-scoped
            // server functions writing to a channel-owned cell are spec-
            // permitted — SPEC §38.4 line 15998 mandates that the compiler
            // SHALL emit `{__type:"__sync",__key,__val}` wire frames on
            // every write to a channel-declared cell. Codegen (emit-logic
            // bare-expr server arm) now lowers `@cell = expr` for the
            // canonical channel-cell case to a `broadcast(...)` call (which
            // is auto-injected by `emit-server.ts:emitBroadcastInjection`
            // for channel-owned server functions). The previous E-RI-002
            // suppression was held back because the server module would
            // reference the client-only `_scrml_reactive_set` helper and
            // crash at request time; the broadcast-wire emit removes that
            // reference and aligns with the §38.4 canonical pattern.
            //
            // The skip is narrow: it applies only when (a) the function is
            // declared inside a `<channel>` body AND (b) the LHS cell of
            // the reactive assignment is one of the V5-strict state cells
            // declared in that channel's body. Writes to non-channel cells
            // (e.g. `<program>`-scoped cells) from a channel server-fn
            // still fire E-RI-002 — those writes have no broadcast path.
            // Writes from non-channel server functions are unaffected.
            const _ownerChannel = perFileChannelFnMap.get(record.filePath)?.get(record.fnNode.name ?? "");
            const _assignedCellName = extractReactiveAssignmentCellName(reactiveAssignment);
            const _channelCells = _ownerChannel
              ? perFileChannelCellMap.get(record.filePath)?.get(_ownerChannel)
              : null;
            const _isChannelCellWrite =
              _ownerChannel != null &&
              _assignedCellName != null &&
              _channelCells != null &&
              _channelCells.has(_assignedCellName);
            if (_isChannelCellWrite) {
              // Spec-permitted broadcast write — no diagnostic, no CPS.
              // cpsSplit remains null; the server-fn body is emitted whole
              // and the channel-cell assignment lowers to the broadcast
              // wire (see emit-logic.ts case "bare-expr" server arm).
            } else {
              // Name the offending cell when the LHS is a canonical `@<ident> =`
              // write; compound (`+=`) / dotted member targets yield null, in
              // which case we fall back to the generic phrasing.
              const _cellPhrase = _assignedCellName != null
                ? `the reactive cell \`@${_assignedCellName}\``
                : "a `@` reactive variable";
              errors.push(new RIError(
                "E-RI-002",
                `E-RI-002: Server-escalated function \`${record.fnNode.name ?? "<anonymous>"}\` ` +
                `assigns to ${_cellPhrase}. Reactive state is client-side; a server ` +
                `function has no client-reactive referent and cannot write it directly (§12.2). ` +
                `For server-authoritative engine state, name a server-owned source cell the engine ` +
                `hydrates from: \`<engine for=T server=@source ...>\` (§51.0.E — hydrates guard-free ` +
                `on every change; client moves stay \`rule=\`-guarded). For a synced cell without ` +
                `transition guards, write a \`<channel>\` cell (§38.4 — a server write lowers to a ` +
                `broadcast) and derive a \`<match for=T on=@cell>\`. See §51.0.E + §38.4.`,
                (reactiveAssignment as any).span ?? record.fnNode.span,
              ));
            }
          }
        }
      }

      // §6.6.9 / §12 (RULING A) — E-REACTIVE-003: a WHOLLY server-escalated
      // function reading a FREE CLIENT CELL (raw `@var` OR `const` derived)
      // resolves to `undefined` server-side. The server-mode rewrite (emit-expr.ts)
      // lowers `@cell` to `_scrml_body["cell"]`, but a non-CPS server fn's client
      // fetch stub sends only declared params — the cell value is NOT transported.
      // Read-side sibling of E-RI-002.
      //
      // GATED on `cpsSplit === null`: a CPS-split fn (it has a reactive
      // assignment, so its `@cell` reads sit in the server BATCH) already marshals
      // those reads via the CPS client wrapper (§19.9.9) — they are NOT undefined,
      // so this error must NOT fire for it. Only the wholly-server fn (no split)
      // leaves the reads unmarshalled.
      //
      // `collectClientReactiveCells` INCLUDES §52 `<... server>` cells (they are
      // client-held, §52.4.2 — a wholly-server read of one is undefined too) and
      // EXCLUDES ambient identity (`@session`/`@currentUser`, not `state-decl`s);
      // channel cells are excluded so the §38.4 E-CHANNEL-SERVER-CELL-READ above
      // owns them (no double-diagnostic). Declared params are read BARE (never
      // `@`-prefixed), so passing the value as an argument is the clean escape hatch.
      if (cpsSplit === null) {
        const _clientCells = perFileClientReactiveCells.get(record.filePath);
        if (_clientCells && _clientCells.size > 0) {
          const _chanExclude = new Set<string>();
          const _chMap = perFileChannelCellMap.get(record.filePath);
          if (_chMap) for (const _cells of _chMap.values()) for (const _c of _cells) _chanExclude.add(_c);
          const _freeReads = detectServerFreeClientCellReads(body, _clientCells, _chanExclude);
          for (const _r of _freeReads) {
            const _kind = _r.derived ? "derived value" : "reactive variable";
            const _fn = record.fnNode.name ?? "<anonymous>";
            errors.push(new RIError(
              "E-REACTIVE-003",
              `E-REACTIVE-003: Server-escalated function \`${_fn}\` reads the client-side ${_kind} ` +
              `\`@${_r.cell}\`. A client cell lives in the browser; a wholly server-escalated function ` +
              `(§12) runs in the Bun process and receives only its declared arguments — this read lowers ` +
              `to \`_scrml_body["${_r.cell}"]\`, which the client stub never sends, so it resolves to ` +
              `\`undefined\` at request time (the value is not transported). Fix: pass it explicitly — ` +
              `\`${_fn === "<anonymous>" ? "fn" : _fn}(@${_r.cell})\` with a matching parameter (arguments ` +
              `ARE marshalled into the request body), or restructure so the server computes the value ` +
              `itself (e.g. read the source inside the \`?{}\` query). See SPEC §6.6.9.`,
              _r.span ?? record.fnNode.span,
            ));
          }
        }
      }
    }

    // Build the FunctionRoute entry.
    // Bug 2b (channel-codegen-fixes-2026-06-12): an `onserver:*` handler is
    // server-side but invoked from the WS `_scrml_ws_handlers` path, NOT an
    // HTTP RPC route. Suppress its generated route (→ no client fetch stub via
    // emit-functions, no HTTP route handler via emit-server) and flag it so
    // emit-server emits it as a plain callable server function instead.
    const _isChannelWsHandler = deduped.some(r => r.kind === "channel-ws-handler");
    const hasExplicitRoute = !!(record.fnNode as any).route;
    // The generated route NAME is the JS binding identifier under which the
    // route record is exported (`export const <generatedRouteName> = { path, ... }`).
    // It MUST always be a valid JS identifier. An author-declared `route="/path"`
    // is the request PATH, carried separately in `explicitRoute` (emit-server
    // honors it for the `path:` field). Conflating the two — using the author
    // path AS the binding name — emits invalid JS (`export const /fsp/deltas`).
    // So always synthesize a `__ri_route_*` identifier here; the author path
    // never becomes the binding name. (escalation-2, S216 — the §12.3 carve-out:
    // an author `route=` on a `server function*` SSE / `handle()` is honored as
    // a stable foreign-facing contract URL in application mode, mounted at the
    // author path while still exported under a compiler-internal JS binding.)
    const generatedRouteName = (isServer && !_isChannelWsHandler)
      ? generateRouteName(record.fnNode.name ?? "anon")
      : null;

    const serverEntrySpan = isServer ? record.fnNode.span : null;

    // §36: generator server functions are SSE endpoints (GET, text/event-stream)
    const isSSE = isServer && (record.fnNode as any).isGenerator === true;

    functions.set(fnNodeId, {
      functionNodeId: fnNodeId,
      // S138 Bug 9 L1 — populate the `functionName` field that
      // `scheduling.ts::hasServerCallees` reads to build `serverFnNames`.
      // Pre-fix this field was structurally declared in the route-map
      // type but never set, so `serverFnNames` was ALWAYS empty and
      // transitive client-callers were never auto-async-and-awaited.
      // Per pillar SPEC §1 + §13.2 "compiler owns async wiring."
      //
      // S138 R26 EMPIRICAL ARC — Bug 9 L1 alone unmasked Bug 55
      // (CPS planner guarded-expr-in-Promise.all shape gap): once L1
      // makes a wrapper async, the CPS planner triggers parallelization,
      // and any `let X = call() !{handler}` (failable-with-handler) in
      // the body emits as multi-statement output inside the Promise.all
      // array literal — JS SyntaxError. Pre-L1, the wrapper wasn't
      // async, so parallelization didn't trigger and the broken shape
      // stayed sequential (silent).
      //
      // Bug 55 fix landed THIS COMMIT (scheduling.ts:isGuardedExprStmt
      // guard) — guarded-expr stmts now stay in size-1 groups (single-
      // stmt emission path; multi-statement output OK at function body
      // top-level). L1 + Bug 55 together SAFE on the R24/R25 empirical
      // sweep: all PASSING sources stay PASSING; Bug 9 direct-caller
      // case (canonical) now correctly emits async/await.
      //
      // L3 (transitive async coloring across client fn graphs) remains
      // a separate follow-on — Bug 9 entry tracks the partial-close.
      functionName: record.fnNode.name ?? null,
      boundary,
      escalationReasons: deduped,
      generatedRouteName,
      explicitRoute: hasExplicitRoute ? (record.fnNode as any).route : null,
      explicitMethod: isSSE ? "GET" : ((record.fnNode as any).method ?? null),
      isSSE,
      serverEntrySpan,
      cpsSplit,
      isChannelWsHandler: _isChannelWsHandler,
    });
  }

  // ------------------------------------------------------------------
  // Step 7: Build page route tree from file paths (file-based routing).
  // ------------------------------------------------------------------

  const pages = buildPageRouteTree(files);

  // ------------------------------------------------------------------
  // Step 8: Collect auth middleware from <program auth="required"> across
  // all files.
  // ------------------------------------------------------------------

  const authMiddleware = new Map<string, AuthMiddleware>();

  // 8a: Explicit auth= from <program auth="required">
  for (const fileAST of files) {
    const authConfig = fileAST.authConfig ?? ((fileAST as any).ast ? (fileAST as any).ast.authConfig : null);
    if (!authConfig || authConfig.auth !== "required") continue;

    authMiddleware.set(fileAST.filePath, {
      filePath: fileAST.filePath,
      auth: authConfig.auth,
      loginRedirect: authConfig.loginRedirect ?? "/login",
      csrf: authConfig.csrf ?? "off",
      sessionExpiry: authConfig.sessionExpiry ?? "1h",
    });
  }

  // 8b: Auto-escalate auth for files with protect= fields
  if (protectAnalysis && protectAnalysis.views) {
    const filesWithProtectedFields = new Set<string>();
    for (const [stateBlockId] of protectAnalysis.views) {
      const filePath = stateBlockId.split("::")[0];
      const dbTypeViews = protectAnalysis.views.get(stateBlockId);
      if (dbTypeViews && dbTypeViews.tables) {
        for (const [, tableTypeView] of dbTypeViews.tables) {
          if (tableTypeView.protectedFields && tableTypeView.protectedFields.size > 0) {
            filesWithProtectedFields.add(filePath);
            break;
          }
        }
      }
    }

    // Map each file's EXPLICIT auth= declaration (program- OR page-level) for
    // the precedence check below. <program auth="required"> is already in
    // authMiddleware via Step 8a; this captures the cases 8a does not register:
    // program "optional"/"none" AND every <page auth=> (page-level auth is not
    // carried on authConfig at all). See getExplicitAuthDeclaration.
    const explicitAuthByFile = new Map<string, ReturnType<typeof getExplicitAuthDeclaration>>();
    for (const fileAST of files) {
      const decl = getExplicitAuthDeclaration(fileAST);
      if (decl) explicitAuthByFile.set(fileAST.filePath, decl);
    }

    for (const filePath of filesWithProtectedFields) {
      // <program auth="required"> registered in 8a — explicit, takes precedence.
      if (authMiddleware.has(filePath)) continue;

      // ss19 #6/#7 (the login-wall bug): a file may carry an EXPLICIT auth=
      // declaration that 8a does not register — `<program auth="optional"|"none">`
      // or any `<page auth=>`. Auto-escalating those to auth="required" wrongly
      // overrode the adopter's choice and force-installed `_scrml_auth_check` on
      // (e.g.) a login page's own RPC, which then 302'd to /login — making the
      // page permanently unauthenticatable. Consult the explicit declaration and
      // honour it; the W-AUTH-001 "no explicit auth=" warning is truthful ONLY
      // when no declaration exists.
      const explicit = explicitAuthByFile.get(filePath) ?? null;

      if (explicit && (explicit.auth === "optional" || explicit.auth === "none")) {
        // Explicit non-required mode. Do NOT escalate to auth="required" and do
        // NOT fire W-AUTH-001 — the page keeps its declared mode. protect= still
        // strips the column from client serialization via the protect-analyzer
        // (independent of authMiddleware), so the sensitive field never reaches
        // the client regardless of the auth mode.
        continue;
      }

      if (explicit && explicit.auth === "required") {
        // Explicit page-level auth="required" (program-level "required" already
        // returned above via the 8a .has() guard). Register the gate from the
        // page's own settings so the protected page stays gated, but do NOT fire
        // W-AUTH-001 — the auth= IS explicit. csrf defaults to "auto" (sensitive
        // protect= fields present) and sessionExpiry to "1h" (<page> carries no
        // sessionExpiry= attribute).
        authMiddleware.set(filePath, {
          filePath,
          auth: "required",
          loginRedirect: explicit.loginRedirect ?? "/login",
          csrf: explicit.csrf ?? "auto",
          sessionExpiry: explicit.sessionExpiry ?? "1h",
        });
        continue;
      }

      // No explicit auth= anywhere — auto-escalate + warn (correct; preserved).
      authMiddleware.set(filePath, {
        filePath,
        auth: "required",
        loginRedirect: "/login",
        csrf: "auto",
        sessionExpiry: "1h",
        autoEscalated: true,
      });
      errors.push({
        code: "W-AUTH-001",
        message:
          `W-AUTH-001: File has protect= fields but no explicit auth= attribute. ` +
          `Auth middleware auto-injected (auth="required", csrf="auto"). ` +
          `Add <program auth="required"> to control auth settings explicitly.`,
        severity: "warning",
        filePath,
      });
    }
  }

  // ------------------------------------------------------------------
  // §61 <endpoint> private-arm reachability — server-retain / client-skip sets
  // (endpoint-private-arm-reachability-2026-06-25). Computed AFTER Step 6 so the
  // per-fn `functions` boundary classification is final.
  //
  // For each file declaring an `<endpoint>`: the arm-body callees resolving to a
  // LOCAL, NON-exported, client-boundary pure `fn` are SERVER-reachability
  // ROOTS. Their transitive pure-fn closure must be RETAINED server-side
  // (`endpointServerHelperIds`). The subset NOT also reachable from a CLIENT root
  // (markup ref / exported fn) is server-ONLY and is SKIPPED from the client
  // bundle (`endpointClientSkipIds`, §61.6). A helper used by BOTH an endpoint
  // AND client markup is retained server-side AND kept client-side.
  // ------------------------------------------------------------------
  const endpointServerHelperIds = new Set<string>();
  const endpointClientSkipIds = new Set<string>();
  if (endpointDeclsByFile.size > 0) {
    const EP_IDENT_RE2 = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    for (const [epFilePath, decls] of endpointDeclsByFile) {
      // Local fn name → fnNodeId(s) for THIS file.
      const localFnIdsByName = new Map<string, string[]>();
      for (const [fnNodeId, rec] of analysisMap) {
        if (rec.filePath !== epFilePath) continue;
        const nm = rec.fnNode.name;
        if (!nm) continue;
        if (!localFnIdsByName.has(nm)) localFnIdsByName.set(nm, []);
        localFnIdsByName.get(nm)!.push(fnNodeId);
      }
      // Eligible to be emitted as a private server-side helper: a local,
      // non-exported, client-boundary, non-generator pure fn. An exported fn is
      // emitted by the value-export path; a server/middleware fn has its own
      // route/peer emit; a generator is an SSE entry point.
      const isEligibleHelper = (id: string): boolean => {
        const rec = analysisMap.get(id);
        if (!rec || rec.filePath !== epFilePath) return false;
        const nm = rec.fnNode.name;
        if (!nm || exportedFnNames.has(nm)) return false;
        if ((rec.fnNode as Record<string, unknown>).isGenerator === true) return false;
        const route = functions.get(id);
        if (route && route.boundary !== "client") return false;
        return true;
      };
      // BFS over local-fn callees from a seed set.
      const closeOver = (seedIds: Iterable<string>): Set<string> => {
        const seen = new Set<string>();
        const stack: string[] = [...seedIds];
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          const rec = analysisMap.get(id);
          if (!rec) continue;
          for (const calleeName of rec.callees) {
            const ids = localFnIdsByName.get(calleeName);
            if (!ids) continue;
            for (const cid of ids) if (!seen.has(cid)) stack.push(cid);
          }
        }
        return seen;
      };
      // Endpoint roots: arm-body callee idents ∩ local fn names.
      const endpointRootIds = new Set<string>();
      for (const ep of decls) {
        const arms = (ep as Record<string, unknown>).arms;
        for (const arm of (Array.isArray(arms) ? arms : [])) {
          const bodyRaw = (arm as Record<string, unknown>)?.bodyRaw;
          if (typeof bodyRaw !== "string") continue;
          EP_IDENT_RE2.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = EP_IDENT_RE2.exec(bodyRaw)) !== null) {
            const ids = localFnIdsByName.get(m[0]);
            if (ids) for (const id of ids) endpointRootIds.add(id);
          }
        }
      }
      const endpointReachable = closeOver(endpointRootIds);
      // Client roots: local fns referenced from markup / top-level logic
      // (markupReferencedNames) OR exported (client-emittable). Their pure-fn
      // closure is client-reachable.
      const clientRootIds = new Set<string>();
      for (const [nm, ids] of localFnIdsByName) {
        if (markupReferencedNames.has(nm) || exportedFnNames.has(nm)) {
          for (const id of ids) clientRootIds.add(id);
        }
      }
      const clientReachable = closeOver(clientRootIds);
      for (const id of endpointReachable) {
        if (!isEligibleHelper(id)) continue;
        endpointServerHelperIds.add(id);
        if (!clientReachable.has(id)) endpointClientSkipIds.add(id);
      }
    }
  }

  return {
    routeMap: { functions, pages, authMiddleware, endpointServerHelperIds, endpointClientSkipIds },
    errors,
  };
}

// ---------------------------------------------------------------------------
// File-based page routing
// ---------------------------------------------------------------------------

/**
 * Recognized route-directory prefixes, in lookup order.
 *
 * `pages/` is the v0.3 canonical convention per SPEC §47.9.2 (line 19314 —
 * "adopters arrange .scrml files under a `pages/` (or equivalent) directory")
 * and §40.8.1 (an empty `pages/` directory at project root suppresses
 * W-PROGRAM-SPA-INFERRED). `routes/` is the legacy/pre-v0.3 convention; it is
 * grandfathered for backward compatibility but is no longer the canonical
 * adopter signal. SPEC §47.9.2 line 19316 explicitly tracked harmonization of
 * the two as a compiler-internal cleanup target — D-RI-PAGES closes that loop.
 *
 * Lookup order matters when a file path contains BOTH segments (uncommon but
 * possible — e.g. `proj/pages/routes/foo.scrml`): the FIRST match wins. The
 * order here prefers `routes/` over `pages/` so existing routes-based projects
 * with `routes/_anything_/...` continue to resolve via the legacy keying with
 * no surprise URL shifts. Greenfield projects use `pages/` and never hit this
 * tiebreaker.
 */
const ROUTE_PREFIXES: readonly string[] = ["/routes/", "/pages/"];

/**
 * Find the first matching route-directory prefix in a file path.
 *
 * Returns the matched prefix string and the index where it appears, or `null`
 * if the file is not under any recognized route directory (i.e. a single-page
 * application file at the project root). The matched prefix is returned so
 * callers can compute `routesIdx + prefix.length` without re-hardcoding either
 * prefix literal.
 */
function findRoutePrefix(filePath: string): { idx: number; prefix: string } | null {
  for (const prefix of ROUTE_PREFIXES) {
    const idx = filePath.indexOf(prefix);
    if (idx !== -1) return { idx, prefix };
  }
  return null;
}

/**
 * Build a page route tree from file paths — AUTH-MIDDLEWARE PATH MAP.
 *
 * IMPORTANT: This function is NOT the canonical URL-inference site.
 * Canonical URL inference uses §47.9.2 path-preserve emission (dirname + basename
 * minus .scrml → route URL); see `compiler/src/codegen/emit-route.ts` and SPEC
 * §47.9.2 / §40.8. This function exists specifically to build the per-page
 * auth-middleware map (which routes require `auth=`, layout inheritance, etc.).
 *
 * Recognized route-directory prefixes (per `ROUTE_PREFIXES`):
 *   - `pages/` — v0.3 canonical convention (SPEC §47.9.2 / §40.8.1).
 *   - `routes/` — legacy/pre-v0.3 convention; grandfathered for backward
 *     compatibility but not the canonical adopter signal. The v0.3 `<page>`
 *     element (SPEC §4.15 + §40.8) does NOT carry a `route=` attribute;
 *     route URL comes from filesystem path inference exclusively (§47.9.2),
 *     not from this function.
 *
 * Convention (auth-middleware tree only):
 *   - Files under any recognized prefix directory are page routes.
 *   - `index.scrml` maps to the directory's path (e.g., pages/index.scrml → /).
 *   - `[param].scrml` maps to a dynamic segment (e.g., pages/users/[id].scrml → /users/:id).
 *   - `_layout.scrml` provides a shared layout wrapper for sibling routes.
 *   - `[...slug].scrml` is a catch-all route.
 *   - Files NOT under a recognized prefix directory are treated as single-page
 *     apps (route = /).
 *
 * D-RI-PAGES (2026-05-15): closes the v0.4 follow-up that previously gated this
 * function on `routes/` only. Both prefixes are now recognized; the
 * auth-redirect cross-ref (auth-graph.ts crossRefRedirects) can resolve
 * loginRedirect targets to pages under `pages/...`, closing the Batch A.1 loop
 * on `scrml generate auth` scaffold output.
 */
export function buildPageRouteTree(files: FileAST[]): Map<string, PageRoute> {
  const pages = new Map<string, PageRoute>();

  for (const fileAST of files) {
    const filePath = fileAST.filePath;

    // Normalize OS path separators (Windows `\\` → `/`) for separator-agnostic
    // route inference (GH#16). The ORIGINAL `filePath` stays the `pages` map key
    // and the stored `.filePath` field — downstream consumers key by the
    // un-normalized `fileAST.filePath` / entry-point id (codegen/index.ts
    // `pagesByFile.get(filePart)`), so the key MUST match that separator form.
    // Only the prefix-detection + segment arithmetic below operates on the
    // normalized copy. On POSIX `replace` is a no-op (no backslashes) — the
    // forward-slash corpus is byte-identical.
    const normalizedPath = filePath.replace(/\\/g, "/");

    const match = findRoutePrefix(normalizedPath);
    if (match == null) {
      // Not under a recognized route directory — single-page app, mount at /
      pages.set(filePath, {
        filePath,
        urlPattern: "/",
        params: [],
        layoutFilePath: null,
        isCatchAll: false,
      });
      continue;
    }

    const { idx: routesIdx, prefix } = match;

    // Extract the relative path after the matched prefix (normalized copy —
    // `routesIdx` is valid for both since the replace is length-preserving).
    const relativePath = normalizedPath.slice(routesIdx + prefix.length);

    // Skip _layout.scrml files — they are layout wrappers, not pages
    const fileName = relativePath.split("/").pop();
    if (fileName === "_layout.scrml") continue;

    // Convert file path to URL pattern
    const { urlPattern, params, isCatchAll } = filePathToUrlPattern(relativePath);

    // Look for a _layout.scrml in the same directory or ancestor directories
    const layoutFilePath = findLayoutFile(normalizedPath, routesIdx, prefix);

    pages.set(filePath, {
      filePath,
      urlPattern,
      params,
      layoutFilePath,
      isCatchAll,
    });
  }

  return pages;
}

/**
 * Convert a relative file path (under a recognized route-directory prefix —
 * `pages/` or `routes/`) to a URL pattern.
 *
 * Examples:
 *   "index.scrml"              → { urlPattern: "/", params: [], isCatchAll: false }
 *   "about.scrml"              → { urlPattern: "/about", params: [], isCatchAll: false }
 *   "users/[id].scrml"         → { urlPattern: "/users/:id", params: ["id"], isCatchAll: false }
 *   "users/index.scrml"        → { urlPattern: "/users", params: [], isCatchAll: false }
 *   "posts/[...slug].scrml"    → { urlPattern: "/posts/*slug", params: ["slug"], isCatchAll: true }
 *   "auth/login.scrml"         → { urlPattern: "/auth/login", params: [], isCatchAll: false }
 */
function filePathToUrlPattern(relativePath: string): { urlPattern: string; params: string[]; isCatchAll: boolean } {
  // Remove .scrml extension
  const withoutExt = relativePath.replace(/\.scrml$/, "");

  // Split into segments
  const segments = withoutExt.split("/").filter(Boolean);

  const params: string[] = [];
  let isCatchAll = false;
  const urlSegments: string[] = [];

  for (const seg of segments) {
    // index at the end means the directory path itself
    if (seg === "index" && segments.indexOf(seg) === segments.length - 1) {
      continue;
    }

    // Catch-all: [...param]
    const catchAllMatch = seg.match(/^\[\.\.\.(\w+)\]$/);
    if (catchAllMatch) {
      params.push(catchAllMatch[1]);
      urlSegments.push(`*${catchAllMatch[1]}`);
      isCatchAll = true;
      continue;
    }

    // Dynamic segment: [param]
    const paramMatch = seg.match(/^\[(\w+)\]$/);
    if (paramMatch) {
      params.push(paramMatch[1]);
      urlSegments.push(`:${paramMatch[1]}`);
      continue;
    }

    // Static segment
    urlSegments.push(seg);
  }

  const urlPattern = "/" + urlSegments.join("/");

  return { urlPattern, params, isCatchAll };
}

/**
 * Find the nearest _layout.scrml file for a given page file.
 *
 * Searches the same directory and ancestor directories up to the route-directory
 * root (the directory matched by `findRoutePrefix` — `pages/` or `routes/`).
 * The matched prefix is passed in so that boundary arithmetic works correctly
 * for either convention.
 */
function findLayoutFile(filePath: string, routesIdx: number, prefix: string): string | null {
  const routesRoot = filePath.slice(0, routesIdx + prefix.length);
  let dir = filePath.slice(0, filePath.lastIndexOf("/"));

  while (dir.length >= routesRoot.length - 1) {
    const layoutPath = dir + "/_layout.scrml";
    // We cannot check the filesystem here (RI is a pure analysis pass).
    // Instead, we record the expected layout path.
    if (dir + "/" !== routesRoot || dir === routesRoot.slice(0, -1)) {
      return layoutPath;
    }
    // Move to parent directory
    const parentDir = dir.slice(0, dir.lastIndexOf("/"));
    if (parentDir === dir) break;
    dir = parentDir;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Deduplicate EscalationReason[] by kind + distinguishing field.
 * Preserves first occurrence of each unique reason.
 */
function deduplicateReasons(reasons: EscalationReason[]): EscalationReason[] {
  const seen = new Set<string>();
  const result: EscalationReason[] = [];
  for (const r of reasons) {
    let key: string;
    if (r.kind === "protected-field-access") {
      key = `pfa:${r.field}:${r.stateBlockId}`;
    } else if (r.kind === "server-only-resource") {
      key = `sor:${r.resourceType}`;
    } else if (r.kind === "explicit-annotation") {
      key = "ea";
    } else if (r.kind === "channel-broadcast") {
      // §12.2 Trigger 7 (D2) — one channel-broadcast reason per function is
      // sufficient; collapse regardless of which write/call supplied it.
      key = "cbr";
    } else if (r.kind === "middleware-handle") {
      key = "mwh";
    } else if (r.kind === "channel-ws-handler") {
      // Bug 2b — one channel-ws-handler reason per function is sufficient.
      key = "cwh";
    } else {
      key = JSON.stringify(r);
    }
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

