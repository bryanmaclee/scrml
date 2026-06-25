/**
 * @module codegen/emit-expr
 *
 * Phase 3 — ExprNode → JavaScript emitter.
 *
 * Replaces the multi-pass string rewriting pipeline (rewrite.ts) with a single
 * recursive tree-walk that emits JS directly from the structured ExprNode AST.
 *
 * Every ExprNode kind maps to one emit case. The emitter is context-aware:
 * client mode emits _scrml_reactive_get(), server mode emits _scrml_body[""].
 *
 * Escape-hatch nodes fall back to rewriteExpr() so the string pipeline stays
 * alive until all escape hatches are eliminated (Phase 3.5).
 */

import type {
  ExprNode,
  IdentExpr,
  LitExpr,
  ArrayExpr,
  ObjectExpr,
  ObjectProp,
  SpreadExpr,
  UnaryExpr,
  BinaryExpr,
  AssignExpr,
  TernaryExpr,
  MemberExpr,
  IndexExpr,
  CallExpr,
  NewExpr,
  LambdaExpr,
  LambdaParam,
  CastExpr,
  MatchExpr,
  SqlRefExpr,
  InputStateRefExpr,
  EscapeHatchExpr,
  MapLitExpr,
  MarkupValueExpr,
} from "../types/ast.ts";
import { rewriteExpr, rewriteServerExpr, rewriteExprArrowBody, rewriteServerExprArrowBody, rewriteExprWithDerived } from "./rewrite.js";
import { emitParseVariantCall, isParseVariantCall } from "./emit-parse-variant.ts";
import { emitMatchExpr as emitStructuredMatchExpr } from "./emit-control-flow.ts";
import { SYNTH_PROPERTY_NAMES } from "../symbol-table.ts";
import { srcmapMark } from "./srcmap-provenance.ts";
import { resolveLogLoc } from "./log-loc.ts";
// markup-value-in-expression-2026-06-17 (a)+(b) — DOM-node lowering for
// markup-as-value in expression position (shared with form (c) `return <markup>`).
import { emitMarkupValueExpr } from "./emit-lift.js";

// ---------------------------------------------------------------------------
// §20.6 (F4=A) — production strip toggle for the log() builtin.
//
// A compile-WIDE constant (not per-file / per-context), so it rides a
// module-level flag set once-per-compile by runCG (mirrors the
// `provenanceEnabled` gate in srcmap-provenance.ts). When true, a `log(...)`
// call lowers to ZERO bytes (the dev-only convenience is stripped from
// release artefacts). Default false (development — log() is active).
// ---------------------------------------------------------------------------
let _logProductionStrip = false;

/** Set the compile-wide production strip flag for the log() builtin (runCG). */
export function setLogProductionStrip(on: boolean): void {
  _logProductionStrip = !!on;
}

// §20.6 (shadowing, Open-Q3) — PER-FILE flag: does the current file declare
// a `function log` / `fn log`? Such a declaration shadows the builtin across
// the whole file (file-scope functions are in scope everywhere). Set per-file
// by runCG (via fileDeclaresLog). A LOCAL `let log` / param is handled
// scope-precisely via EmitExprContext.declaredNames; this covers the
// file-level function-decl that declaredNames does not carry.
let _logShadowedInFile = false;

/** Set the per-file log() shadowing flag (a file-level `function log`). */
export function setLogShadowedInFile(on: boolean): void {
  _logShadowedInFile = !!on;
}

// ss16 C3 (mirror §20.6 log-shadowing) — PER-FILE flag: does the current file
// declare a `function render` / `fn render`? Such a declaration shadows the
// `render()` client component-render builtin across the whole file. Without
// this, the builtin hijack at the call site (`render(...)` → `_scrml_render`)
// short-circuits the §47 user-fn name-encoding + fnNameMap post-pass, so the
// user's `function render` def (emitted `_scrml_render_1`) and its call site
// (`_scrml_render`, defined nowhere) MISMATCH → ReferenceError. Set per-file
// by runCG (via fileDeclaresRender). A LOCAL `let render` / param is handled
// scope-precisely via EmitExprContext.declaredNames; this covers the
// file-level function-decl that declaredNames does not carry.
let _renderShadowedInFile = false;

/** Set the per-file render() shadowing flag (a file-level `function render`). */
export function setRenderShadowedInFile(on: boolean): void {
  _renderShadowedInFile = !!on;
}


// ---------------------------------------------------------------------------
// EmitExprContext — threaded through every emit call
// ---------------------------------------------------------------------------

export interface EmitExprContext {
  /** Client mode emits reactive_get; server mode emits _scrml_body["..."]. */
  mode: "client" | "server";
  /** Derived reactive names — emits _scrml_derived_get instead of _scrml_reactive_get. */
  derivedNames?: Set<string> | null;
  /**
   * Bug 61 (§55.5 / §55.6 / §55.7) — the set of DOTTED synth-cell keys declared
   * by emit-synth-surface.ts for this file's compound parents (e.g.
   * `"form.isValid"`, `"form.name.touched"`, `"form.submitted"`). Populated by
   * `collectSynthCellKeys(fileAST)`. When `emitMember` sees a member chain
   * `@<compound>[.<field>].<synthProp>` whose dotted key IS in this set, it
   * collapses to `_scrml_reactive_get(<dotted>)` (the universal accessor) rather
   * than emitting member access on the compound's VALUE object. The membership
   * test is the precise over-fire guard: a plain cell whose value carries a
   * field named like a synth prop (`<config> = { errors: [] }` → `@config.errors`)
   * is NOT in the set, so it falls through to ordinary member access.
   */
  synthCellKeys?: Set<string> | null;
  /** Tilde pipeline accumulator variable name (§32). */
  tildeVar?: string | null;
  /** Database variable for server SQL emission. */
  dbVar?: string;
  /** Error accumulator for diagnostics. */
  errors?: any[];
  /**
   * C13 (§51.0.G) — engine variable names in the file's scope. When set and
   * the call shape is `@<name>.advance(<arg>)` with `<name>` in this set,
   * `emitCall` dispatches to the C13 runtime hook (`_scrml_engine_advance`)
   * instead of emitting a property-access call (which would fail because the
   * cell value is a bare variant string with no `.advance` method).
   */
  engineVarNames?: Set<string> | null;
  /**
   * B17.4 (§51.0.H) — engine variable names in the file's scope that have at
   * least one `effect=` or `<onTransition>` arm. When the engine var is in
   * this set, `emitEngineAdvanceCall` wraps the helper call with hook-firing
   * (capture pre-write variant + fire `__scrml_engine_<varName>_fire_hooks`
   * after the helper). Tree-shaken: when an engine has no hooks, the wrap is
   * elided and no hook-firing function reference is emitted (the function
   * doesn't exist for hookless engines).
   */
  enginesWithHooks?: Set<string> | null;
  /**
   * A5-4 (§51.0.M) — engine variable names in the file's scope that have at
   * least one `<onTimeout>` element. When the engine var is in this set,
   * `emitEngineAdvanceCall` passes the per-engine timer-config table
   * identifier as the 4th argument to `_scrml_engine_advance` so the runtime
   * clears outgoing timers + arms incoming ones around the cell write. Tree-
   * shaken: engines without `<onTimeout>` omit the arg (runtime treats
   * undefined as null and short-circuits).
   */
  enginesWithOnTimeout?: Set<string> | null;
  /**
   * A5-6 (§51.0.R, S77) — engine variable names in the file's scope that
   * declare `<onIdle>`. When the engine var is in this set,
   * `emitEngineAdvanceCall` passes the per-engine watchdog config identifier
   * as the 5th argument to `_scrml_engine_advance` so the runtime resets the
   * watchdog after every successful commit. Tree-shaken: engines without
   * `<onIdle>` omit the arg.
   */
  enginesWithIdleWatchdog?: Set<string> | null;
  /**
   * A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — engine variable names in the file's
   * scope that have at least one state-child carrying `internal:rule=`. When
   * the engine var is in this set, `emitEngineAdvanceCall` passes the per-
   * engine internal transition table identifier as the trailing (6th)
   * argument to `_scrml_engine_advance` so the runtime checks the internal
   * write-path first. Tree-shaken: engines without any `internal:rule=` omit
   * the arg (runtime treats undefined as null and falls through to the
   * canonical external path).
   */
  enginesWithInternalRules?: Set<string> | null;
  /**
   * A5-7 Wave 2.3 (§51.0.N, Bug #3) — engine variable names in the file's
   * scope that have at least one state-child carrying `history` (with a
   * discoverable inner-engine var per `findInnerEngineForStateChild`). When
   * the engine var is in this set, `emitEngineAdvanceCall` passes the per-
   * engine history-map identifier as the trailing (7th) argument to
   * `_scrml_engine_advance` so the runtime captures the inner-engine variant
   * into the synth history cell on external outer-exit. Tree-shaken: engines
   * without any composite `history` state-child omit the arg (runtime treats
   * undefined as null and skips the history capture path).
   */
  enginesWithHistory?: Set<string> | null;
  /**
   * §51.0.S (S155 batch 3 — #14 event-payload-transition) — engine variable
   * names in the file's scope that declare at least one `(state × message)`
   * arm. When the engine var is in this set AND the `.advance(.X)` argument's
   * variant is a member of `engineMessageVariants.get(varName)`, `emitCall`
   * routes the call to the MESSAGE plane (`_scrml_engine_dispatch_message`)
   * instead of the STATE plane (`_scrml_engine_advance`). §51.0.G.1 /
   * §51.0.S.2.5. Tree-shaken: engines without message arms omit this and the
   * `.advance` router always takes the state plane (pre-S154 behavior).
   */
  enginesWithMessageArms?: Set<string> | null;
  /**
   * §51.0.S (S155 batch 3) — map of engine var name → resolved `accepts=`
   * message-variant name set. Used to STAMP the `.advance(.X)` plane at
   * codegen: a literal bare-variant `.X` whose name is in this set is the
   * message plane. The plane is statically known post-batch-2 (the typer
   * resolved `accepts=` and the arms), so codegen decides it without any
   * runtime membership check.
   */
  engineMessageVariants?: Map<string, Set<string>> | null;
  /**
   * §51.0.F (Option A comprehensive engine-routing) — engine variable
   * binding-info map keyed by engine variable name (e.g. `"marioState"`).
   * When set and the assignment LHS matches a key, `emitAssign` dispatches
   * the write through the canonical write-guard helper
   * (`emit-engine.ts:emitEngineWriteGuard`) instead of bare
   * `_scrml_reactive_set`. Mirrors the engineBindings field in EmitLogicOpts.
   *
   * The dispatch wraps the multi-line guard in an IIFE so the value of the
   * assignment expression is preserved (matching `_scrml_reactive_set`'s
   * native return-value semantics). This brings ALL expression contexts —
   * lambda bodies / ternary RHS / function-call args / compound expressions /
   * nested assigns — into structural parity for engine-write routing
   * (rule= enforcement / <onTransition> hooks / timer arm-clear / history
   * capture / Option-d self-write semantics per §51.0.F.1).
   *
   * Sibling to `engineVarNames` — engineVarNames covers `.advance(.X)` calls,
   * engineBindings covers `@<name> = <expr>` direct writes.
   */
  engineBindings?: Map<string, import("./emit-engine.ts").EngineBindingInfo> | null;
  /**
   * §59 (D4) — value-native MAP variable names in the file's scope (bare, no
   * `@`). Populated by `collectMapVarNames(fileAST)` (reactive-deps.ts) and
   * threaded alongside `engineVarNames`. Sibling to `engineVarNames`:
   *
   *   - `emitIndex` lowers `@m[k]` (root in this set) → `_scrml_map_get(m, k)`
   *     returning `V | not` (JS null on miss) — §59.6.
   *   - `emitCall` intercepts `@m.<method>(…)` (`m` in this set) → the matching
   *     `_scrml_map_<method>(m, …args)` pure helper — §59.7/§59.8.
   *   - `emitMember` lowers `@m.size` → `_scrml_map_size(m)` — §59.6.
   *
   * Codegen re-parses expressions and has NO resolved type at the emit site
   * (SURVEY-SYNTHESIS D4 Q2), so the map-vs-array discrimination keys on this
   * collected name-set rather than a resolved type — exactly as the `.advance`
   * interception keys on `engineVarNames`. NULL or empty → no map interception
   * (the expression falls through to ordinary array/index/member/call emission).
   */
  mapVarNames?: Set<string> | null;
  /**
   * §59.8 (S169) — file-level set of cell names whose `state-decl` type
   * annotation is an `@ordered` value-native map (`[KeyT: ValT]@ordered`).
   * Mirrors `mapVarNames` (bare names, no `@`). The ordered-ness of a map
   * VALUE is a property of the TARGET CELL's type, NOT of the literal, so a
   * map-lit RHS assigned to one of these cells must lower to
   * `_scrml_map_from_entries([...], true)`. Populated by
   * `collectOrderedMapVarNames(fileAST)`. Used by `emitAssign` to set
   * `emitMapLitOrdered` on the RHS of a reassignment `@m = [...]` whose target
   * cell is ordered. NULL or empty → no cell is ordered (all map literals lower
   * unordered, the §59 default).
   */
  orderedMapVarNames?: Set<string> | null;
  /**
   * §59.8 (S169) — TRANSIENT per-emission flag. When true, the NEXT
   * `emitMapLit` lowers its literal as `_scrml_map_from_entries([...], true)`
   * (insertion-order iteration). Set by `emitAssign` (reassignment to an
   * ordered cell) and by `emit-logic.ts` (the decl-init RHS of an `@ordered`
   * decl). `emitMapLit` recurses into entry keys/values with this flag CLEARED
   * so NESTED map-VALUE literals stay unordered (per-value `@ordered` is a
   * separate known v1 gap — codegen has no per-value annotation).
   */
  emitMapLitOrdered?: boolean;
  /**
   * §20.6 (shadowing, Open-Q3) — names declared in the current scope
   * (function params, let/const locals, function-decls). When the set
   * contains "log", a user-declared `log` is in scope and WINS over the
   * location-transparent builtin: `emitCall` emits an ordinary call and
   * fires the info-level W-LOG-SHADOWED lint instead of the `_scrml_log`
   * lowering. Forwarded from `EmitLogicOpts.declaredNames` via `_makeExprCtx`.
   */
  declaredNames?: Set<string> | null;
  /**
   * §20.6 — the enclosing STATEMENT's source span, forwarded from
   * `EmitLogicOpts.currentStmtSpan`. The log() lowering reads it for the
   * author `file:line` because a re-parsed `log(...)` call node carries a
   * not-set span (`start === 0`) while the statement node keeps the real
   * byte offset. Preferred over `node.span` only when the latter is not set.
   */
  stmtSpan?: { file?: string; start?: number; line?: number } | null;
  /**
   * §6.7.7 / §60.4 — file-level set of `<request>` `id` values. A `<#id>` markup
   * ref whose id is in this set is a REQUEST-STATE ref (its `.loading`/`.data`/
   * `.error`/`.stale` live on the `_scrml_deep_reactive`-wrapped `_scrml_request_<id>`
   * object, which IS reactive — §6.7.7), NOT a §36 input-state ref (which lowers
   * to the render-once non-reactive `_scrml_input_state_registry`, §36.6). Both
   * `<#id>` lowering seams (`emitInputStateRef` and the `emitIdent` bare-recovery)
   * route a request id to `_scrml_request_<id>` so the read targets the live
   * request state. Populated by `collectRequestIds(fileAST)`. NULL/empty → no
   * `<request>` in scope (all `<#id>` refs lower to the §36 input-state registry).
   */
  requestIds?: Set<string> | null;
  /**
   * Issue #1 (parent scrmlTS) — names of SIBLING server functions that are
   * callable in-process within a server-mode body. When `mode === "server"`
   * and a plain-ident call targets a name in this set (and it is not shadowed
   * by a local in `declaredNames`), `emitCall` lowers the call to
   * `await <name>(...)` so it resolves to the peer callable emitted by
   * `emit-server.ts` (`async function <name>(<params>) { ... }`) and the
   * peer's async result is awaited. NULL/empty → no server-fn composition in
   * scope (calls lower to a bare invocation, the pre-fix behavior). Threaded
   * from `EmitLogicOpts.serverFnNames` via `_makeExprCtx`. The CLIENT calls a
   * server fn through the emit-functions.ts fetch stub instead, so this never
   * fires for `mode === "client"`.
   */
  serverFnNames?: Set<string> | null;
  /**
   * Issue #1 (parent scrmlTS) — is the CURRENT position one where `await <peer>()`
   * is syntactically valid? `true`/undefined at the top of a server-fn handler
   * body or an async lambda body; `false` inside a synchronous callback body or
   * ANY parameter default (`await` is illegal in a default even in an async fn).
   * `emitLambda` sets it for the body/param contexts it builds; `emitCall` emits
   * `await <peer>()` when awaitable and a bare `<peer>()` (recorded for diagnosis)
   * when not.
   */
  peerAwaitable?: boolean;
  /**
   * Issue #1 — accumulator for sibling server-fn ("peer") calls emitted BARE
   * because the position was not awaitable (`peerAwaitable === false`). A bare
   * peer call returns an unawaited Promise, so emit-server reads this list AFTER
   * body emission and raises `E-SERVER-FN-IN-SYNC-CALLBACK` for each — making the
   * lowering decision (here) the single source of truth for the diagnostic.
   * Threaded from `EmitLogicOpts.syncPeerCalls` via `_makeExprCtx`.
   */
  syncPeerCalls?: Array<{ name: string; span: unknown }> | null;
}

// ---------------------------------------------------------------------------
// §59 (D4) — map method surface → runtime helper name table.
//
// The camelCase scrml surface method maps to the snake_case `_scrml_map_*`
// runtime helper (runtime-template.js). Read/getOr/has + write/insert/remove/
// update/insertAll + iteration keys/values/entries/sorted/sortedBy. The first
// helper arg is always the map receiver; surface args follow. `.size` is a
// MEMBER access (not a call) and is handled in `emitMember`, not here. `.get`
// is the method form of the bracket-read (`@m.get(k)` ≡ `@m[k]`).
// ---------------------------------------------------------------------------
const MAP_METHOD_HELPERS: Record<string, string> = {
  get: "_scrml_map_get",
  has: "_scrml_map_has",
  getOr: "_scrml_map_get_or",
  insert: "_scrml_map_insert",
  remove: "_scrml_map_remove",
  update: "_scrml_map_update",
  insertAll: "_scrml_map_insert_all",
  keys: "_scrml_map_keys",
  values: "_scrml_map_values",
  entries: "_scrml_map_entries",
  sorted: "_scrml_map_sorted",
  sortedBy: "_scrml_map_sorted_by",
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * §51.0.S (S155 batch 3) — Extract the PascalCase variant NAME from an
 * `.advance(arg)` argument node, for the codegen plane stamp (§51.0.G.1).
 *
 * Accepted shapes (the only shapes the plane stamp acts on — literal bare-
 * variant per §51.0.G.1 step 1):
 *   - `.Drop`            → bare-dot ident       → "Drop"
 *   - `.Drop(col)`       → CallExpr on bare-dot → "Drop"
 *   - `DragMsg.Drop`     → qualified member     → "Drop"
 *   - `DragMsg.Drop(c)`  → CallExpr on member   → "Drop"
 *
 * Returns the variant name, or `null` for any other shape (a variable / call /
 * computed expression) — those are §51.0.G.1 step 3 (static-type resolution,
 * which the typer handled) and are NOT plane-stamped at the literal level here.
 */
function extractAdvanceBareVariantName(arg: any): string | null {
  if (!arg || typeof arg !== "object") return null;
  let node: any = arg;
  // Unwrap a constructor call `.Variant(args)` / `Enum.Variant(args)`.
  if (node.kind === "call" && node.callee && typeof node.callee === "object") {
    node = node.callee;
  }
  // Bare-dot ident `.Variant` — the §14.10 / §18.0.3 inference shape.
  if (node.kind === "ident" && typeof node.name === "string" && node.name.startsWith(".")) {
    const name = node.name.slice(1).trim();
    return /^[A-Z][A-Za-z0-9_]*$/.test(name) ? name : null;
  }
  // Qualified member `Enum.Variant` — the property is the variant name.
  if (node.kind === "member" && typeof node.property === "string") {
    const name = node.property.trim();
    return /^[A-Z][A-Za-z0-9_]*$/.test(name) ? name : null;
  }
  return null;
}

/**
 * Emit a JavaScript expression string from an ExprNode tree.
 */
export function emitExpr(node: ExprNode, ctx: EmitExprContext): string {
  switch (node.kind) {
    case "ident":       return emitIdent(node, ctx);
    case "lit":         return emitLit(node);
    case "array":       return emitArray(node, ctx);
    case "object":      return emitObject(node, ctx);
    case "spread":      return emitSpread(node, ctx);
    case "unary":       return emitUnary(node, ctx);
    case "binary":      return emitBinary(node, ctx);
    case "assign":      return emitAssign(node, ctx);
    case "ternary":     return emitTernary(node, ctx);
    case "member":      return emitMember(node, ctx);
    case "index":       return emitIndex(node, ctx);
    case "call":        return emitCall(node, ctx);
    case "new":         return emitNew(node, ctx);
    case "lambda":      return emitLambda(node, ctx);
    case "cast":        return emitCast(node, ctx);
    case "match-expr":  return emitMatchExpr(node, ctx);
    case "sql-ref":     return emitSqlRef(node, ctx);
    case "input-state-ref": return emitInputStateRef(node, ctx);
    case "escape-hatch": return emitEscapeHatch(node, ctx);
    case "map-lit":     return emitMapLit(node, ctx);
    case "markup-value": {
      // markup-value-in-expression-2026-06-17 (a)+(b) — markup-as-first-class-value
      // (Pillar 1, SPEC §1.4 / §7.4) in expression position (a ternary arm:
      // `${ @n > 0 ? <span>pos</span> : <span>neg</span> }`, PRIMER §6.4(2); or a
      // derived-cell ternary `const <badge> = @n > 0 ? <span>pos</span> : ...`,
      // PRIMER §6.6.17). The ast-builder's `parseExprWithMarkupValues` recovered
      // the markup arm to a real element node (`node.node`). Lower it via the
      // markup→DOM-node IIFE (the SAME primitive form (c)'s `return <markup>`
      // uses) so the arm evaluates to a real DOM node, not a dropped/raw `<span>`.
      return emitMarkupValueExpr((node as MarkupValueExpr).node);
    }
    case "reset-expr": {
      // §6.8.2 — A1c Step C5 — lower reset(<target>) to the runtime helper.
      //
      // Target shapes (B22 already validated; non-canonical shapes fired
      // E-RESET-INVALID-TARGET upstream):
      //   - reset(@cell)              → ident, name === "@cell"
      //   - reset(@compound)          → ident, name === "@compound" (helper detects compound by absence-of-thunk)
      //   - reset(@compound.field)    → member chain rooted at @-IdentExpr (multi-level OK per §6.3.5)
      //
      // The emitted call uses the SAME storage key the cell registered with:
      //   - top-level cell: bare cell name
      //   - compound child: dotted qualified path (parent.child[.subfield...])
      //
      // The runtime helper `_scrml_reset(name)` handles the three shapes
      // uniformly via the registries `_scrml_default_fns` / `_scrml_init_fns`
      // (and falls back to a prefix-match compound walk when neither has a
      // direct entry — that's the reset(@compound) case). See
      // runtime-template.js for full helper semantics.
      //
      // Defensive fallback for unexpected shapes: emit a comment marker.
      // B22 should have rejected them, but defensive code keeps codegen
      // crash-free if a malformed AST sneaks through.
      const target = node.target;
      if (target.kind === "ident") {
        const name = target.name;
        if (typeof name === "string" && name.startsWith("@")) {
          const bare = name.slice(1);
          return `_scrml_reset(${JSON.stringify(bare)})`;
        }
        // Non-`@` IdentExpr: B22 should have rejected. Fall through to marker.
      } else if (target.kind === "member") {
        // Walk the MemberExpr chain to a dotted-string path. Root must be
        // an `@`-prefixed IdentExpr (B22 enforced shape).
        const path: string[] = [];
        let cursor: ExprNode = target;
        let valid = true;
        while (cursor.kind === "member") {
          const m = cursor as MemberExpr;
          if (typeof m.property !== "string") { valid = false; break; }
          path.unshift(m.property);
          cursor = m.object;
        }
        if (valid && cursor.kind === "ident") {
          const rootName = (cursor as IdentExpr).name;
          if (typeof rootName === "string" && rootName.startsWith("@")) {
            const fullPath = [rootName.slice(1), ...path].join(".");
            return `_scrml_reset(${JSON.stringify(fullPath)})`;
          }
        }
        // Non-canonical member chain: B22 should have rejected. Fall through.
      }
      // Defensive marker for unrecognized target shapes. Keeps emitted JS
      // syntactically valid as an expression-statement comment-prefixed call.
      return `/* C5: unexpected reset target shape; B22 should have rejected */ undefined`;
    }
    default: {
      // Exhaustiveness guard — if a new kind is added and not handled,
      // TypeScript will flag this at compile time.
      const _exhaustive: never = node;
      return (_exhaustive as EscapeHatchExpr).raw ?? "";
    }
  }
}

/**
 * Phase 4d Slice 4a: consolidated dual-path emitter.
 *
 * If exprNode is present, emits via emitExpr (the structured tree-walk path).
 * If exprNode is missing (legacy AST or unparseable expression), falls back to
 * the string rewrite pipeline. The fallback is expected to be dead code for
 * well-formed scrml — Slice 4b will remove it entirely.
 *
 * Client-mode fallback routes through rewriteExprWithDerived so ctx.derivedNames
 * is honored on the fallback path (@derived → _scrml_derived_get vs @reactive →
 * _scrml_reactive_get). When derivedNames is null/empty, rewriteExprWithDerived
 * delegates to rewriteExpr — char-identical to the previous behavior.
 */
export function emitExprField(exprNode: ExprNode | null | undefined, fallbackStr: string, ctx: EmitExprContext): string {
  if (exprNode) return emitExpr(exprNode, ctx);
  if (ctx.mode === "server") return rewriteServerExpr(fallbackStr);
  return rewriteExprWithDerived(fallbackStr, ctx.derivedNames ?? null);
}

// ---------------------------------------------------------------------------
// Leaf nodes
// ---------------------------------------------------------------------------

function emitIdent(node: IdentExpr, ctx: EmitExprContext): string {
  const name = node.name;

  // Reactive reference: @varName
  if (name.startsWith("@")) {
    const bare = name.slice(1);
    // B1 use-site provenance marker (no-op unless sourceMap mode).
    const _m = srcmapMark(node.span, bare);
    if (ctx.mode === "server") {
      return `${_m}_scrml_body["${bare}"]`;
    }
    // Client mode — check derived vs reactive
    if (ctx.derivedNames && ctx.derivedNames.has(bare)) {
      return `${_m}_scrml_derived_get("${bare}")`;
    }
    return `${_m}_scrml_reactive_get("${bare}")`;
  }

  // Tilde accumulator: ~
  if (name === "~" && ctx.tildeVar) {
    return ctx.tildeVar;
  }

  // §32 — orphan `~` defensive fallback. If `name === "~"` reaches emitIdent
  // with `ctx.tildeVar === null`, the type-system's TildeTracker should have
  // fired E-TILDE-001 (referenced but not initialized). In practice E-TILDE-001
  // is not yet wired for every AST shape (see compiler/tests/integration/
  // tilde-carry-forward.test.js:193 — "no-init ~ consumption" pre-existing gap),
  // so without this fallback the literal `~` token would leak into generated JS
  // (invalid — unary bitwise-NOT on nothing). Emit a clear marker so the cause
  // is visible at inspection. Per HU-5 Q-W35-1 (a) ratification (`~snapshot`
  // codegen bug fix, 2026-05-25): defense-in-depth landing companion to the
  // emit-logic.ts:bare-expr orphan skip.
  if (name === "~") {
    return `null /* ~ orphaned \u2014 codegen-fallback */`;
  }

  // §14.10 / §18.0.3 bare-variant inference codegen (C22, M9):
  // `.Variant` (leading dot, uppercase second char) lowers to its string tag,
  // matching the runtime convention used by enum objects (emitEnumVariantObjects),
  // match-arm conditions (emit-control-flow.ts:armCondition), and the `is .Variant`
  // operator (emitBinary case "is"). B20 (A1b) gates this at the typer with
  // E-VARIANT-AMBIGUOUS / E-TYPE-063 so by the time codegen sees a bare-variant
  // IdentExpr it has been validated to belong to a known enum at the position.
  // The variant name alone is sufficient — the runtime stores unit variants as
  // their bare string tag (`Phase.Idle === "Idle"`), so no enum-namespace lookup
  // is needed at codegen.
  if (name.length >= 2 && name.charCodeAt(0) === 46 /* . */ && name.charCodeAt(1) >= 65 && name.charCodeAt(1) <= 90 /* A-Z */) {
    return JSON.stringify(name.slice(1));
  }

  // §36 input-state ref recovered from the already-lowered bare form.
  //
  // ast-builder.js `preprocessWorkerAndStateRefs()` (TAB) lowers a standalone
  // `<#id>` in a markup-interpolation / logic-block body to the bare identifier
  // `_scrml_input_<id>_` (single leading + trailing underscore). The expression
  // parser then sees a plain Identifier (not the `__scrml_input_<id>__`
  // double-underscore placeholder it knows how to fold into an
  // `input-state-ref` ExprNode), so it produces an IdentExpr whose name is the
  // dead bare form. That name was never bound — it compiled to a hard
  // `ReferenceError: _scrml_input_<id>_ is not defined`, leaving the entire
  // §36 input-state read surface (mouse/keyboard/gamepad) 100% runtime-dead
  // (6nz Bug AC, S144).
  //
  // Recover it here to the SAME runtime lookup that `emitInputStateRef` (the
  // structured `input-state-ref` node) and `rewriteInputStateRefs` (the string
  // pipeline) emit — so the read name agrees with the registration name
  // (`_scrml_input_state_registry.set("<id>", state)` inside
  // `_scrml_input_*_create`). Runtime helpers share the `_scrml_input_` prefix
  // but NEVER end in `_` (`_scrml_input_mouse_create`,
  // `_scrml_input_state_registry`, …); the trailing-`_` anchor in the pattern
  // matches only user id-refs.
  if (name.length > 13 && name.startsWith("_scrml_input_") && name.endsWith("_")) {
    const m = name.match(/^_scrml_input_([A-Za-z_$][A-Za-z0-9_$]*)_$/);
    if (m) {
      // §6.7.7 — a request id routes to the reactive `_scrml_request_<id>`
      // object (same routing as the structured `emitInputStateRef` seam).
      if (ctx.requestIds && ctx.requestIds.has(m[1])) {
        return `_scrml_request_${m[1]}`;
      }
      return `_scrml_input_state_registry.get(${JSON.stringify(m[1])})`;
    }
  }

  // Plain identifier — pass through
  return name;
}

function emitLit(node: LitExpr): string {
  // The `not` keyword (§42 absence value) compiles to null
  if (node.litType === "not") {
    return "null";
  }
  // Use raw source text to preserve exact formatting (string quotes, number format, etc.)
  return node.raw;
}

// ---------------------------------------------------------------------------
// Compound primary nodes
// ---------------------------------------------------------------------------

function emitArray(node: ArrayExpr, ctx: EmitExprContext): string {
  const elems = node.elements.map(el => emitExpr(el, ctx));
  return `[${elems.join(", ")}]`;
}

function emitObject(node: ObjectExpr, ctx: EmitExprContext): string {
  const props = node.props.map(p => emitProp(p, ctx));
  return `{${props.join(", ")}}`;
}

function emitProp(prop: ObjectProp, ctx: EmitExprContext): string {
  switch (prop.kind) {
    case "prop": {
      const key = prop.computed
        ? `[${typeof prop.key === "string" ? JSON.stringify(prop.key) : emitExpr(prop.key, ctx)}]`
        : typeof prop.key === "string" ? prop.key : emitExpr(prop.key, ctx);
      const val = emitExpr(prop.value, ctx);
      return `${key}: ${val}`;
    }
    case "shorthand":
      return prop.name;
    case "spread":
      return `...${emitExpr(prop.argument, ctx)}`;
  }
}

function emitSpread(node: SpreadExpr, ctx: EmitExprContext): string {
  return `...${emitExpr(node.argument, ctx)}`;
}

/**
 * §59.3 (D4) — Lower a `map-lit` ExprNode to the runtime constructor.
 *
 *   [:]                → _scrml_map_from_entries([], false)            (empty map)
 *   ["a": 1, "b": 2]   → _scrml_map_from_entries([["a", 1], ["b", 2]], false)
 *
 * The runtime `_scrml_map_from_entries(pairs, ordered)` (runtime-template.js)
 * takes an array of `[key, value]` 2-element arrays + an `ordered` flag, and
 * applies last-wins on duplicate keys (§59.3) via `_scrml_value_canonical`
 * key-canonicalization. This REPLACES `emitStringFromTree`'s source-text
 * round-trip (`[k: v]`, which is NOT valid JS) at the JS-emit site.
 *
 * `ordered` is `false` here: `@ordered` is a TYPE affix on the cell, not on the
 * literal, and codegen has no annotation context at the literal site. A fresh
 * literal builds an unordered map; the cell's order semantics on subsequent
 * reassignment ride the clone's `ordered` flag (an `@ordered` cell initialized
 * with a literal is a documented v1 gap — see progress-d4.md).
 *
 * v1 struct/enum-key scope-cut (§59.3 M-cut): the runtime hashes ANY §45-
 * comparable key (`_scrml_value_canonical` walks structs/enums), so a struct-key
 * literal lowers correctly here. The `W-MAP-STRUCT-KEY-LITERAL` Info notice
 * (fired at parse by D2a) names the `.insert` form as the recommended v1 shape,
 * but we EMIT the literal rather than fail it — the notice is advisory, the
 * runtime handles it, and failing valid hashable keys would be a regression.
 */
function emitMapLit(node: MapLitExpr, ctx: EmitExprContext): string {
  // §59.8 (S169) — the OUTERMOST literal rides the target cell's ordered-ness,
  // threaded via the transient `emitMapLitOrdered` flag. The flag is consumed
  // here and CLEARED for the recursion into entry keys/values so a NESTED
  // map-VALUE literal (`["outer": ["a": 1]]`) stays unordered — per-value
  // `@ordered` is a separate known v1 gap (codegen has no per-value annotation).
  const ordered = ctx.emitMapLitOrdered === true;
  if (node.entries.length === 0) {
    return `_scrml_map_from_entries([], ${ordered})`;
  }
  const inner: EmitExprContext = { ...ctx, emitMapLitOrdered: false };
  const pairs = node.entries
    .map(e => `[${emitExpr(e.key, inner)}, ${emitExpr(e.value, inner)}]`)
    .join(", ");
  return `_scrml_map_from_entries([${pairs}], ${ordered})`;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function emitUnary(node: UnaryExpr, ctx: EmitExprContext): string {
  // W14-BB: postfix `@x++` / `@x--` on a reactive var must lower to the
  // canonical setter form (SPEC §6.1.2 + §5.2.3 line 1385). The naive
  // emission `_scrml_reactive_get("x")++` is invalid JS — `++` cannot be
  // applied to the return value of a call expression. Mirrors the compound-
  // assign branch in emitAssign (lines 736-741) and `rewriteReactiveAssign`'s
  // string-pipeline lowering (rewrite.ts:1855).
  //
  // SCOPE LIMITATION (matches rewrite.ts:1813-1821): the lowering returns
  // the NEW value, not the postfix-old value. For statement-position uses
  // (the only form scrml SPEC enumerates for `@x++`) the difference is
  // invisible. Value-position postfix on `@x` is vanishingly rare and the
  // precise fix would require an IIFE wrapper. Filed inline for revisit.
  if (!node.prefix && (node.op === "++" || node.op === "--")) {
    const target = node.argument;
    if (target.kind === "ident" && typeof target.name === "string" && target.name.startsWith("@")) {
      const bare = target.name.slice(1);
      // B1 use-site provenance marker (no-op unless sourceMap mode).
      const _m = srcmapMark(node.span, bare);
      if (ctx.mode === "server") {
        // Server boundary: @x is `_scrml_body["x"]` (a plain assignment lvalue).
        // Postfix on a member expression IS valid JS, so emit as-is.
        return `${_m}_scrml_body["${bare}"]${node.op}`;
      }
      const sign = node.op === "++" ? "+" : "-";
      const getter = ctx.derivedNames?.has(bare)
        ? `_scrml_derived_get("${bare}")`
        : `_scrml_reactive_get("${bare}")`;
      return `${_m}_scrml_reactive_set("${bare}", ${getter} ${sign} 1)`;
    }
  }
  const arg = emitExpr(node.argument, ctx);
  if (node.prefix) {
    // typeof, void, delete, await need a space before the operand
    const needsSpace = node.op === "typeof" || node.op === "void" ||
                       node.op === "delete" || node.op === "await";
    return needsSpace ? `${node.op} ${arg}` : `${node.op}${arg}`;
  }
  // Postfix: x++, x--
  return `${arg}${node.op}`;
}

/**
 * GITI-012 / fix-server-eq-helper-import:
 *
 * Returns true when an ExprNode is statically known to evaluate to a JS
 * primitive (number, string, boolean, null, undefined). When BOTH operands of
 * a `==`/`!=` are statically primitive, SPEC §45.4 authorizes lowering to
 * `===`/`!==` instead of `_scrml_structural_eq(...)`. This:
 *   - avoids a function-call helper at runtime for the common case (cheaper),
 *   - removes the dependency on `_scrml_structural_eq` being available in the
 *     emit context (the bug: the helper lives in the client runtime; .server.js
 *     never imports or inlines it, so any `==` on primitives in a `server fn`
 *     body crashed with `ReferenceError`).
 *
 * Detection is intentionally conservative — only return true when the value
 * MUST be a primitive at runtime regardless of the operand's static type. When
 * unsure, return false and let the call fall back to the structural helper
 * (the helper itself is correct for primitives — it's just unavailable on the
 * server). The complementary fix in emit-server.ts inlines the helper when
 * any non-shortcut `==`/`!=` survives into server code.
 */
function isStaticallyPrimitive(node: ExprNode): boolean {
  switch (node.kind) {
    case "lit":
      // All LitExpr litTypes are primitive: number, string, template, bool,
      // null, undefined, and `not` (which lowers to null).
      return true;

    case "unary": {
      // Numeric/boolean unary operators always produce primitives.
      // - `!x`, `-x`, `+x`, `~x`, `typeof x`, `void x` → primitive
      // - `delete x` → boolean (primitive)
      // - `await x` → unknown; do NOT shortcut
      // - `++` / `--` → number (primitive), but only valid on lvalue refs
      const u = node as UnaryExpr;
      if (u.op === "await") return false;
      return true;
    }

    case "binary": {
      // Arithmetic, comparison, and logical-with-primitive operands all
      // produce primitives.
      const b = node as BinaryExpr;
      switch (b.op) {
        case "+": case "-": case "*": case "/": case "%": case "**":
        case "<": case "<=": case ">": case ">=":
        case "==": case "!=":
        case "&": case "|": case "^": case "<<": case ">>": case ">>>":
        case "in": case "instanceof":
        case "is": case "is-not": case "is-some": case "is-not-not":
          return true;
        case "&&": case "||": case "??":
          // Short-circuit ops return one of their operands — primitive only
          // if both sides are statically primitive.
          return isStaticallyPrimitive(b.left) && isStaticallyPrimitive(b.right);
        default:
          return false;
      }
    }

    case "ternary": {
      // `cond ? a : b` is primitive iff both branches are primitive.
      return isStaticallyPrimitive(node.consequent) && isStaticallyPrimitive(node.alternate);
    }

    case "member": {
      // Conservative whitelist of well-known primitive-returning property
      // accesses. Don't try to be clever — only catch the obvious cases.
      // (`arr.length`, `str.length` is the case in the GITI-012 reproducer.)
      const m = node as MemberExpr;
      switch (m.property) {
        case "length":           // string.length, array.length, function.length
        case "size":              // Map.size, Set.size — number
        case "byteLength":        // ArrayBuffer.byteLength — number
        case "name":              // function.name — string
          return true;
        default:
          return false;
      }
    }

    // Everything else (ident, array, object, call, lambda, cast, match-expr,
    // sql-ref, input-state-ref, escape-hatch, new, index, spread, assign):
    // either may carry a struct/enum/object value, or we have no static info.
    // Fall through to the structural helper.
    default:
      return false;
  }
}

/**
 * Determine whether the LHS of an `is some` / `is not` / `is not not` predicate
 * needs an extra paren wrap on emission. The emit form for these predicates is
 * `(<lhs> !== null && <lhs> !== undefined)` (or the `=== null || === undefined`
 * absence form). Any LHS whose emitted JS contains binary / ternary / unary
 * operators at the top level would be mis-associated by the `&&` / `||`
 * between the two halves of the absence check, so wrap defensively.
 *
 * Bare idents (`x`, `obj.foo.bar`, `_scrml_reactive_get(...)`), index access
 * (`arr[i]`), call expressions (`f(...)`), and member access through call/
 * index tails do NOT need wrapping — their emitted forms bind tightly enough
 * that `<lhs> !== null` already parses as `(<lhs>) !== null` in JS.
 *
 * Only top-level binary / ternary / assignment / unary nodes require wrapping
 * — for those the emit either lacks outer parens or has operators that bind
 * looser than `!==`.
 */
function needsIsLhsParenWrap(left: ExprNode): boolean {
  switch (left.kind) {
    case "binary":
      // Binary operators all bind looser than `!==` / `===` in JS, so a binary
      // LHS would re-associate without explicit wrapping. (Exception: nested
      // `is-some` / `is-not` BinaryExprs already emit their own outer parens
      // from this very function, so they're already self-bracketed — but we
      // still wrap defensively for readability.)
      return true;
    case "ternary":
    case "assign":
    case "unary":
      // These bind looser than (or interact poorly with) `!==`.
      return true;
    default:
      // ident / lit / array / object / member / index / call / new / lambda /
      // cast / match-expr / sql-ref / input-state-ref / escape-hatch / spread:
      // their emitted forms are already self-contained primaries.
      return false;
  }
}

/**
 * Phase B-2 — Single-evaluation predicate (SPEC §42.2.4 line 18436).
 *
 * For `<lhs> is some` / `is not` / `is not not`, the SPEC mandates the LHS be
 * evaluated EXACTLY ONCE. The simple emit `<lhs> !== null && <lhs> !== undefined`
 * inlines the LHS twice — fine when `<lhs>` is a bare-ident or literal (re-
 * reading is observably free), but incorrect when `<lhs>` has side effects
 * (calls, member access through getters, index access through Proxy traps,
 * binary/ternary/assignment with embedded sub-effects, etc.).
 *
 * Returns true when the LHS is safe to inline twice without observable
 * difference from a single evaluation. The trivial set is intentionally
 * narrow: ONLY bare identifiers and literals. Everything else — including
 * member access (could be a getter) and index access (could be a Proxy trap)
 * — is wrapped in an IIFE for single-evaluation safety. This matches the
 * SPEC's strict "Any side effects of `expr` occur exactly once" requirement.
 *
 * @see emitBinary case "is-some" / "is-not" / "is-not-not" for the IIFE wrap.
 */
function isTrivialIsLhs(left: ExprNode): boolean {
  switch (left.kind) {
    case "ident":
      // Bare names. Re-reading a binding has no observable side effect in JS
      // (except via Proxy/with — which scrml doesn't use). Note: reactive
      // sigils like `@cell` parse as IdentExpr with name="@cell" and lower
      // to a `_scrml_reactive_get(...)` call at emit time — at the AST level
      // they ARE ident-kind, but their emitted form is a CALL with potential
      // side effects (subscription touch). However, _scrml_reactive_get is
      // pure-read by contract (no side effects beyond dependency tracking,
      // which is idempotent), so we still treat `@cell` as trivial. This
      // matches the historical inline emission and keeps output compact for
      // the overwhelmingly common reactive-read shape.
      return true;
    case "lit":
      // Literals are constants; re-reading is a no-op.
      return true;
    default:
      // Everything else (member, index, call, binary, ternary, unary,
      // assign, lambda, new, cast, match-expr, sql-ref, input-state-ref,
      // escape-hatch, array, object, spread) is NON-TRIVIAL and SHALL be
      // wrapped in an IIFE for single-evaluation safety per SPEC §42.2.4.
      return false;
  }
}

// Phase B-2 IIFE local-name convention.
// ---------------------------------------------------------------------------
// `__scrml_is_v` is the local introduced inside the IIFE that wraps a non-
// trivial `is-some` / `is-not` / `is-not-not` LHS. Conventions:
//   * `__scrml_*` prefix — matches the project-wide convention for compiler-
//     generated locals; collides with no documented user-facing symbol
//     (SPEC: identifiers starting with `__scrml_` are reserved).
//   * Stable name (NOT counter-suffixed) — keeps chunk-content-addressed
//     hashes identical for the same source across builds (SPEC §47.5 +
//     §40.9.8 determinism normative).
//   * Local IIFE scope — each `is-some` callsite emits its own `((v) => ...)`,
//     so the same name reused across callsites does NOT collide.
//   * Length is intentionally short to keep output compact while preserving
//     the `__scrml_` prefix collision-shield.
const IS_OP_IIFE_LOCAL = "__scrml_is_v";

// ---------------------------------------------------------------------------
// g-paren-binary-group-dropped-before-method (ss3, S210) — receiver-paren guard.
//
// Member access (`.`), computed index (`[…]`), call (`(…)`) and `new` all bind
// TIGHTER than every JS operator. A receiver/callee whose top-level form is a
// looser-binding operator (binary, ternary, assignment, unary, arrow) MUST be
// re-wrapped in grouping parens on emission — Acorn discards the source's
// ParenthesizedExpression node (no `preserveParens`), so `(a + b).m()` parsed to
// `MemberExpr{ object: Binary(a + b) }` and the un-guarded printer re-serialized
// it as `a + b.m()` — the method binds to `b` alone, a SILENT precedence
// miscompile (green compile, `node --check` clean). Killed a flogence TF-IDF
// router. This is the receiver-position sibling of Bug W (binary-OPERAND paren
// insertion in emitBinary) and S205 g-emit-string-tree-paren-drop (the
// emitStringFromTree twin). Idents, literals, array/object literals and
// member/call/index/new chains are PRIMARIES (bind tighter-or-equal) and never
// need wrapping; is-op binaries already emit self-bracketed forms so the extra
// wrap is harmless-redundant, never wrong.
function receiverNeedsParens(node: ExprNode): boolean {
  switch (node.kind) {
    case "binary":   // a + b, a && b, a is some — looser than member access
    case "ternary":  // c ? a : b
    case "assign":   // x = y
    case "unary":    // -x, !x, typeof x, await x, x++  (`-x.foo` === `-(x.foo)`)
    case "lambda":   // (x) => y / fn — `(() => f).call()`
      return true;
    default:
      // ident · lit · array · object · member · index · call · new · cast ·
      // match-expr · sql-ref · input-state-ref · escape-hatch · map-lit ·
      // markup-value · reset-expr · spread — primaries or self-bracketed.
      return false;
  }
}

/**
 * Issue #1 (b2bf9959 follow-on, ss19 #8) — does this call node lower to an
 * `await <peer>(...)` form? True iff emitCall's server-fn -> sibling-server-fn
 * peer-call branch (below) fires AND the position is awaitable (`peerAwaitable
 * !== false`). A `peerAwaitable === false` (sync-callback / param-default)
 * position emits a BARE call (a primary), so it is NOT an await form. Used both
 * by emitCall (the lowering decision) and emitReceiver (to wrap the await form
 * in grouping parens when the call is a receiver — without the wrap,
 * `await peer().found` mis-parses as `await (peer().found)`, awaiting the wrong
 * thing → silent-wrong, the receiver-position sibling of the bare-call bug).
 */
function isAwaitedPeerCall(node: ExprNode, ctx: EmitExprContext): boolean {
  if (node.kind !== "call") return false;
  const call = node as CallExpr;
  return (
    ctx.mode === "server" &&
    !call.optional &&
    call.callee.kind === "ident" &&
    typeof (call.callee as { name?: unknown }).name === "string" &&
    ctx.serverFnNames != null &&
    ctx.serverFnNames.has((call.callee as { name: string }).name) &&
    !(ctx.declaredNames != null && ctx.declaredNames.has((call.callee as { name: string }).name)) &&
    ctx.peerAwaitable !== false
  );
}

function emitReceiver(node: ExprNode, ctx: EmitExprContext): string {
  const s = emitExpr(node, ctx);
  // An awaited peer call (`await peer(...)`) is an await-expression (unary
  // precedence) — looser than member/index/call/new — so as a receiver it MUST
  // be wrapped: `(await peer(...)).field`. receiverNeedsParens treats a plain
  // call as a primary (correct pre-await), so this case needs its own guard.
  if (isAwaitedPeerCall(node, ctx)) return `(${s})`;
  return receiverNeedsParens(node) ? `(${s})` : s;
}

// ---------------------------------------------------------------------------
// Bug W — precedence-aware paren insertion for the flat binary printer.
//
// Acorn parses `(2 + 3) * 4` into the structurally-correct tree
// `Binary(*, Binary(+, 2, 3), 4)` but does NOT retain ParenthesizedExpression
// nodes (no `preserveParens`). The `default` branch of `emitBinary` historically
// concatenated `left op right` with no precedence guard, so the correct tree
// printed as the precedence-WRONG flat JS `2 + 3 * 4` (14, not 20) — a silent
// correctness bug with no diagnostic.
//
// The fix re-inserts parens around a child operand when the child binds looser
// than (or, for associativity reasons, equal-and-wrong-side relative to) the
// parent operator — exactly the parens Acorn discarded.
//
// JS multiplicative/additive/etc. precedence tiers (higher binds tighter),
// mirroring the MDN operator-precedence table. Only the ops that reach the
// `default` (flat) branch of emitBinary are consulted as PARENT ops; but the
// table covers every BinaryExpr op so child lookups never miss.
// ---------------------------------------------------------------------------
const BINARY_PRECEDENCE: Record<BinaryExpr["op"], number> = {
  "**": 14,
  "*": 13, "/": 13, "%": 13,
  "+": 12, "-": 12,
  "<<": 11, ">>": 11, ">>>": 11,
  "<": 10, "<=": 10, ">": 10, ">=": 10, "in": 10, "instanceof": 10,
  // §45 equality lowers to a self-bracketed form / helper call, so it never
  // reaches the flat branch — but JS `==`/`!=`/`===`/`!==` sit at tier 9.
  "==": 9, "!=": 9,
  "&": 8,
  "^": 7,
  "|": 6,
  "&&": 5,
  "||": 4, "??": 4,
  // §42/§43 presence + enum-membership ops emit their own outer parens / IIFE,
  // so they are self-bracketed as children and never need a precedence wrap.
  // Assign them the lowest tier defensively (they are never used as a PARENT op
  // in the flat branch).
  "is": 3, "is-not": 3, "is-some": 3, "is-not-not": 3,
};

// `**` is the only right-associative binary operator in JS.
const RIGHT_ASSOCIATIVE: ReadonlySet<BinaryExpr["op"]> = new Set(["**"]);

/**
 * A binary CHILD operand emits its own outer brackets when its operator is one
 * of the special-cased forms in emitBinary (equality → `(a === b)` /
 * `_scrml_structural_eq(...)`; `is`/`is-*` → `(...)` / IIFE call). Those are
 * already self-contained primaries on the emitted side, so wrapping them again
 * would produce redundant `((...))`. Only the `default`/flat-emit ops lack
 * their own brackets and may therefore need a precedence wrap.
 */
function binaryOpEmitsFlat(op: BinaryExpr["op"]): boolean {
  switch (op) {
    case "==": case "!=":
    case "is": case "is-not": case "is-some": case "is-not-not":
      return false;
    default:
      return true;
  }
}

/**
 * Decide whether a binary operand (`child`) needs wrapping in parens given the
 * parent flat operator (`parentOp`) and whether the child is the RIGHT operand.
 *
 * Rules:
 *   - Non-binary LOOSE forms (a conditional `?:`, an assignment, an arrow/lambda)
 *     bind looser than EVERY binary operator and are emitted flat (never
 *     self-bracketed), so as a binary operand they always need wrapping — the
 *     g-paren-ternary-operand-paren-dropped class (see the kind switch below).
 *   - Otherwise only binary children whose own operator emits flat can
 *     mis-associate; all other children (literals, idents, calls, self-bracketed
 *     equality/is forms, etc.) already emit as self-contained primaries.
 *   - Wrap when the child binds strictly looser than the parent: prec(child) < prec(parent).
 *   - At equal precedence, left-associative parents keep their natural grouping
 *     on the LEFT but must re-paren a same-precedence RIGHT child (e.g.
 *     `a - (b - c)` ≠ `a - b - c`). Right-associative parents (`**`) mirror it:
 *     re-paren a same-precedence LEFT child (`(2 ** 3) ** 2` ≠ `2 ** 3 ** 2`).
 *   - ES2020: `??` may not be combined with a top-level `||`/`&&` operand, and
 *     vice-versa, without explicit parens. Always wrap that mix regardless of
 *     the numeric comparison.
 */
function binaryOperandNeedsParens(
  child: ExprNode,
  parentOp: BinaryExpr["op"],
  isRightChild: boolean,
): boolean {
  // g-paren-ternary-operand-paren-dropped (S220) — a conditional (`?:`),
  // assignment, or arrow/lambda child binds LOOSER than every binary operator
  // and is emitted as a flat (never self-bracketed) form, so as a binary operand
  // it MUST be re-wrapped. Without the wrap, `(@a > 0 ? "x" : "") + @b`
  // re-serialized as `@a > 0 ? "x" : "" + @b` — the `+ @b` was silently
  // swallowed into the ternary's else-branch (a SILENT precedence miscompile:
  // green compile, `node --check` clean, wrong runtime value). The
  // binary-OPERAND-position sibling of receiverNeedsParens (S210) and
  // emitStringFromTree's exprPrec wrap (S205); both already treat these three
  // kinds as loose. (`unary` is NOT here: a prefix unary binds TIGHTER than the
  // flat binary ops, so `@a + -@b` needs no wrap; the lone `-x ** 2` edge is a
  // separate, LOUD E-CODEGEN-INVALID-JS, not a silent drop.)
  switch (child.kind) {
    case "ternary":
    case "assign":
    case "lambda":
      return true;
  }

  if (child.kind !== "binary") return false;
  const childOp = (child as BinaryExpr).op;

  // Self-bracketed child forms (equality / is-*) never need a precedence wrap.
  if (!binaryOpEmitsFlat(childOp)) return false;

  // ES2020 nullish-coalescing mixing guard (same class as GITI-019, different
  // site). `a ?? b || c`, `a || b ?? c`, `a ?? b && c`, `a && b ?? c` are all
  // SyntaxErrors in JS without parens — force the wrap.
  const parentIsCoalesce = parentOp === "??";
  const childIsLogicalOr = childOp === "||" || childOp === "&&";
  const parentIsLogicalOr = parentOp === "||" || parentOp === "&&";
  const childIsCoalesce = childOp === "??";
  if ((parentIsCoalesce && childIsLogicalOr) || (parentIsLogicalOr && childIsCoalesce)) {
    return true;
  }

  const childPrec = BINARY_PRECEDENCE[childOp];
  const parentPrec = BINARY_PRECEDENCE[parentOp];

  if (childPrec < parentPrec) return true;
  if (childPrec > parentPrec) return false;

  // Equal precedence — associativity decides.
  if (RIGHT_ASSOCIATIVE.has(parentOp)) {
    // Right-associative: natural grouping is on the right, so a same-precedence
    // LEFT child needs explicit parens.
    return !isRightChild;
  }
  // Left-associative: natural grouping is on the left, so a same-precedence
  // RIGHT child needs explicit parens.
  return isRightChild;
}

function emitBinary(node: BinaryExpr, ctx: EmitExprContext): string {
  const left = emitExpr(node.left, ctx);
  const right = emitExpr(node.right, ctx);

  switch (node.op) {
    // §45 structural equality — compiles to deep comparison helper.
    // Per §45.4: "a == b (primitives) → a === b in JavaScript". When both
    // operands are statically known primitives, lower to ===/!==. This (a)
    // skips a helper-function call at runtime and (b) avoids referencing
    // `_scrml_structural_eq` in contexts where the helper isn't available
    // (notably .server.js — see GITI-012 / fix-server-eq-helper-import).
    case "==":
      if (isStaticallyPrimitive(node.left) && isStaticallyPrimitive(node.right)) {
        return `(${left} === ${right})`;
      }
      return `_scrml_structural_eq(${left}, ${right})`;
    case "!=":
      if (isStaticallyPrimitive(node.left) && isStaticallyPrimitive(node.right)) {
        return `(${left} !== ${right})`;
      }
      return `!_scrml_structural_eq(${left}, ${right})`;

    // §42 presence/absence checks.
    //
    // The LHS may be any expression (per §42.2.4 — including binary, call,
    // index, member chains). For a trivial LHS — bare ident or literal —
    // re-reading has no observable side effect and the simple inline form
    // `(x !== null && x !== undefined)` is correct, compact, and readable.
    //
    // For a NON-TRIVIAL LHS — anything that can side-effect on evaluation
    // (calls, member access through getters, index access through Proxy
    // traps, binary/ternary/assign sub-expressions, etc.) — SPEC §42.2.4
    // line 18436 mandates exactly-once evaluation. Phase B-2 (2026-05-17)
    // closes this by wrapping non-trivial LHS in a single-eval IIFE:
    //
    //     ((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(<lhs>)
    //
    // The IIFE form evaluates `<lhs>` exactly once, binds the result, and
    // performs both null and undefined checks against the bound value. This
    // satisfies SPEC §42.2.4: "The compiler SHALL evaluate `expr` exactly
    // once. Any side effects of `expr` occur exactly once."
    //
    // The IIFE arg position naturally parenthesizes its argument (function
    // call arg-list is its own paren scope), so for non-trivial LHS the
    // `needsIsLhsParenWrap` defensive wrap becomes redundant — the IIFE
    // arg list already provides the bracketing. Trivial LHS keeps the
    // historical inline form + paren-wrap helper for binary/ternary/etc.
    // shapes that need it (these can't be reached when LHS is "ident" or
    // "lit", but the branch is retained for completeness / defense).
    //
    // The legacy STRING pipeline (rewrite.ts _rewriteParenthesizedIsOp)
    // handled single-evaluation via a temp-var assignment for the parenth-
    // esized form. That path remains intact for the older code paths still
    // routing through string rewrites; this AST emit path now matches the
    // single-eval guarantee for the same shapes.
    case "is-not": {
      if (isTrivialIsLhs(node.left)) {
        const lhs = needsIsLhsParenWrap(node.left) ? `(${left})` : left;
        return `(${lhs} === null || ${lhs} === undefined)`;
      }
      // Non-trivial LHS: single-eval IIFE wrap (SPEC §42.2.4 Phase B-2).
      return `((${IS_OP_IIFE_LOCAL}) => ${IS_OP_IIFE_LOCAL} === null || ${IS_OP_IIFE_LOCAL} === undefined)(${left})`;
    }
    case "is-some": {
      if (isTrivialIsLhs(node.left)) {
        const lhs = needsIsLhsParenWrap(node.left) ? `(${left})` : left;
        return `(${lhs} !== null && ${lhs} !== undefined)`;
      }
      // Non-trivial LHS: single-eval IIFE wrap (SPEC §42.2.4 Phase B-2).
      return `((${IS_OP_IIFE_LOCAL}) => ${IS_OP_IIFE_LOCAL} !== null && ${IS_OP_IIFE_LOCAL} !== undefined)(${left})`;
    }
    case "is-not-not": {
      if (isTrivialIsLhs(node.left)) {
        const lhs = needsIsLhsParenWrap(node.left) ? `(${left})` : left;
        return `(${lhs} !== null && ${lhs} !== undefined)`;
      }
      // Non-trivial LHS: single-eval IIFE wrap (SPEC §42.2.4 Phase B-2).
      return `((${IS_OP_IIFE_LOCAL}) => ${IS_OP_IIFE_LOCAL} !== null && ${IS_OP_IIFE_LOCAL} !== undefined)(${left})`;
    }

    // §43 enum membership: x is .Variant → x === "Variant" (unit variant) OR
    // x.variant === "Variant" (payload-bearing variant — cell value is a
    // tagged-object `{ variant, data }` per SPEC §51.3.2).
    //
    // S95 Bug 2 — left-side normalization to tag space. Without this, a
    // payload-bearing engine cell whose value is `{ variant: "Dragging", data }`
    // would fail `cell === "Dragging"` and `is .Dragging` would always be
    // false. Use an inline conditional that handles both shapes:
    //   `(typeof __v === "object" && __v !== null && typeof __v.variant === "string"
    //     ? __v.variant : __v) === "Variant"`
    // The IIFE binds `__v` once so a side-effecting `left` (e.g. `_scrml_reactive_get`)
    // is evaluated exactly once.
    case "is": {
      // The right operand is an enum variant (.Active, Enum.Variant, null, undefined).
      let rhs = right;
      if (node.right.kind === "ident" && node.right.name.startsWith(".")) {
        rhs = `"${node.right.name.slice(1)}"`;
      } else if (node.right.kind === "member") {
        // Enum.Variant → "Variant"
        rhs = `"${node.right.property}"`;
      } else {
        // Right side is not an enum variant (e.g. `is null` / `is undefined`)
        // — preserve legacy `===` shape without tag normalization, since
        // `null`/`undefined` are never variant-shaped.
        return `(${left} === ${rhs})`;
      }
      // Tag-normalize the left side. The inline `(typeof v === "object" ...)`
      // pattern matches `_scrml_engine_variant_tag` from the runtime template
      // but is inlined here so server boundary + escape-hatch contexts
      // don't depend on the runtime helper being in scope.
      return `(function(__v){return (typeof __v === "object" && __v !== null && typeof __v.variant === "string" ? __v.variant : __v) === ${rhs};})(${left})`;
    }

    default: {
      // Bug W — precedence-aware paren insertion. Acorn discarded the source
      // grouping parens; re-insert them around any child operand that would
      // otherwise mis-associate under JS operator precedence / associativity.
      // (`==`/`!=`/`is*` never reach here — they return self-bracketed forms
      // above — so this branch only handles the flat-emit operators.)
      const lhs = binaryOperandNeedsParens(node.left, node.op, false) ? `(${left})` : left;
      const rhs = binaryOperandNeedsParens(node.right, node.op, true) ? `(${right})` : right;
      return `${lhs} ${node.op} ${rhs}`;
    }
  }
}

function emitAssign(node: AssignExpr, ctx: EmitExprContext): string {
  const target = node.target;
  // §59.8 (S169) — a reassignment `@m = [...]` to an `@ordered` map cell must
  // lower its RHS map-literal ordered. The ordered-ness rides the TARGET cell's
  // type (in `orderedMapVarNames`), not the literal. Set the transient flag on
  // the RHS-emission ctx for the plain `=` reactive-ident case only; compound
  // ops (`+=` etc.) never carry a bare map literal RHS, and the server/
  // fallthrough lvalue paths are unaffected. (Precedent: emit-event-wiring.ts
  // keys its reassignment branch on `mapVarNames.has(target.name.slice(1))`.)
  const targetIsOrderedMap =
    node.op === "=" &&
    target.kind === "ident" &&
    typeof target.name === "string" &&
    target.name.startsWith("@") &&
    ctx.orderedMapVarNames != null &&
    ctx.orderedMapVarNames.has(target.name.slice(1));
  const valueCtx: EmitExprContext = targetIsOrderedMap
    ? { ...ctx, emitMapLitOrdered: true }
    : ctx;
  const value = emitExpr(node.value, valueCtx);

  // Reactive assignment: @var = expr → _scrml_reactive_set("var", expr)
  if (target.kind === "ident" && target.name.startsWith("@")) {
    const bare = target.name.slice(1);
    if (ctx.mode === "server") {
      return `${srcmapMark(node.span, bare)}_scrml_body["${bare}"] ${node.op} ${value}`;
    }
    // §51.0.F (Option A comprehensive engine-routing) — when the LHS is an
    // engine-bound `@<name>` AND we're at expression position, dispatch
    // through the canonical write-guard helper instead of bare
    // `_scrml_reactive_set`. Covers ALL expression contexts uniformly:
    // lambda bodies / ternary RHS / function-call args / compound exprs /
    // nested assigns. Sibling to `_emitReactiveSet` in emit-logic.ts (which
    // handles the statement-level path).
    //
    // Self-write semantics (§51.0.F.1 Option-d): the runtime helper returns
    // false on `current === target` and treats it as an idempotent no-op
    // (no rule= violation). Compile-time `W-ENGINE-SELF-WRITE-DETECTED`
    // surfaces the situation as an info-level lint upstream.
    //
    // Bug 1.7 simplification: NOT applied here. The match-arm-inline path
    // currently emits via `emitExprField(null, arm.result, ctx)` which falls
    // through to the string-rewrite pipeline (no ExprNode), so it never
    // reaches this emitAssign. Bug 1.7's helper sits at that string-rewrite
    // layer and stays in place.
    const engineBinding = (node.op === "=" && ctx.engineBindings)
      ? ctx.engineBindings.get(bare) ?? null
      : null;
    if (engineBinding) {
      // Detect the structured `.Variant.history` restore-form on the RHS so
      // the runtime helper arms the pending-history-restore flag (§51.0.Q.1).
      // Mirrors emit-logic.ts:detectHistoryForm + emit-control-flow.ts's
      // detectHistoryFormFromString — accept either ExprNode shape (member
      // chain ending in `.history`) or fall back to a string suffix check.
      let valueExprForGuard = value;
      let isHistoryRestore = false;
      const rhs: any = node.value;
      if (
        rhs && typeof rhs === "object" &&
        rhs.kind === "member" && rhs.property === "history" &&
        rhs.object && typeof rhs.object === "object"
      ) {
        const inner = rhs.object;
        if (
          (inner.kind === "ident" && typeof inner.name === "string" && inner.name.startsWith(".")) ||
          inner.kind === "member"
        ) {
          valueExprForGuard = emitExpr(inner, ctx);
          isHistoryRestore = true;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitEngineWriteGuard } = require("./emit-engine.ts") as {
        emitEngineWriteGuard: (
          binding: import("./emit-engine.ts").EngineBindingInfo,
          newValueExpr: string,
          isHistoryRestore?: boolean,
        ) => string[];
      };
      // Bind the value to a temp BEFORE the guard so the guard's embedded
      // value-expression (which appears multiple times in the with-hooks form
      // wrapped in a `__scrml_engine_from`/`__scrml_engine_external` block) is
      // evaluated exactly once. The IIFE returns the temp so the assignment
      // expression carries the new value into surrounding compound contexts
      // (matches `_scrml_reactive_set`'s own `return value;` semantics).
      const guardLines = emitEngineWriteGuard(engineBinding, "__scrml_engine_v", isHistoryRestore);
      const indented = guardLines.map(l => `  ${l}`).join("\n");
      return `(function(){\n  const __scrml_engine_v = ${valueExprForGuard};\n${indented}\n  return __scrml_engine_v;\n})()`;
    }
    if (node.op === "=") {
      return `${srcmapMark(node.span, bare)}_scrml_reactive_set("${bare}", ${value})`;
    }
    // Compound assignment: @x += 1 → _scrml_reactive_set("x", _scrml_reactive_get("x") + 1)
    const baseOp = node.op.slice(0, -1); // "+=" → "+"
    const getter = ctx.derivedNames?.has(bare)
      ? `_scrml_derived_get("${bare}")`
      : `_scrml_reactive_get("${bare}")`;
    return `${srcmapMark(node.span, bare)}_scrml_reactive_set("${bare}", ${getter} ${baseOp} ${value})`;
  }

  const lhs = emitExpr(target, ctx);
  return `${lhs} ${node.op} ${value}`;
}

function emitTernary(node: TernaryExpr, ctx: EmitExprContext): string {
  const cond = emitExpr(node.condition, ctx);
  const cons = emitExpr(node.consequent, ctx);
  const alt = emitExpr(node.alternate, ctx);
  return `${cond} ? ${cons} : ${alt}`;
}

// ---------------------------------------------------------------------------
// Access and call
// ---------------------------------------------------------------------------

function emitMember(node: MemberExpr, ctx: EmitExprContext): string {
  // Bug 61 (§55.5 / §55.6 / §55.7) — auto-synthesized validity-surface read.
  //
  // A member chain rooted at `@<compound>` whose LEAF property is a synthesized
  // validity-surface property (isValid / errors / touched / submitted) AND whose
  // dotted runtime key IS a REGISTERED synth cell must resolve to that cell — a
  // dotted-key read — NOT member access on the compound's VALUE object.
  //
  //   @form.isValid        → _scrml_reactive_get("form.isValid")
  //   @form.name.isValid   → _scrml_reactive_get("form.name.isValid")
  //   @form.submitted      → _scrml_reactive_get("form.submitted")
  //
  // emit-synth-surface.ts declares those cells under dotted keys
  // (`_scrml_derived_declare("form.isValid", ...)` for the derived rollups;
  // `_scrml_reactive_set("form.submitted", false)` for the reactive ones). The
  // pre-Bug-61 emit produced `_scrml_reactive_get("form").isValid` — member
  // access on the compound VALUE (which carries `{name, email, ...}` and has NO
  // `isValid` key → `undefined` → `disabled=!@form.isValid` stuck `true`).
  //
  // `_scrml_reactive_get(dotted)` is the universal accessor: it auto-delegates
  // to `_scrml_derived_get` when a derived fn is registered for the key
  // (isValid/errors/touched compound-level + isValid/errors per-field) AND reads
  // `_scrml_state` directly for the reactive cells (submitted compound-level +
  // touched per-field). A blanket route to `_scrml_derived_get` would return
  // `undefined` for the reactive synth cells (NOT in the derived cache).
  //
  // OVER-FIRE GUARD (`ctx.synthCellKeys?.has(dotted)`): the membership test is
  // load-bearing. A naive leaf-name-only guard over-fires on a PLAIN cell whose
  // value carries a field named like a synth prop — e.g.
  // `<config> = { errors: ["x"] }` then `@config.errors` would wrongly route to
  // `_scrml_reactive_get("config.errors")` (an unregistered key → undefined at
  // runtime → REGRESSION). Only keys present in `synthCellKeys` (i.e. cells
  // emit-synth-surface actually declared) route; everything else falls through
  // to member access on the value object (correct — `@config.errors` reads the
  // plain field; `@form.name` reads the compound proxy's `name` field).
  if (
    ctx.mode === "client" &&
    !node.optional &&
    SYNTH_PROPERTY_NAMES.has(node.property as any)
  ) {
    const dotted = synthDottedKey(node);
    if (dotted !== null && ctx.synthCellKeys?.has(dotted)) {
      return `_scrml_reactive_get(${JSON.stringify(dotted)})`;
    }
  }

  // §59.6 (D4) — map `.size` MEMBER lowering. `@m.size` (m a known map) → the
  // entry count via `_scrml_map_size(m)`. The map count member is `.size`
  // (divergent from the array `.length` member — §59.6, intentional). This is a
  // MEMBER access, not a call, so it lives here rather than in `emitCall`. Only
  // the exact `.size` property on a direct `@m` map root is intercepted; any
  // other property on a map cell, or `.size` on a non-map cell, falls through.
  if (
    ctx.mode === "client" &&
    !node.optional &&
    node.property === "size" &&
    ctx.mapVarNames && ctx.mapVarNames.size > 0 &&
    node.object.kind === "ident" &&
    typeof (node.object as IdentExpr).name === "string" &&
    (node.object as IdentExpr).name.startsWith("@") &&
    ctx.mapVarNames.has((node.object as IdentExpr).name.slice(1))
  ) {
    return `_scrml_map_size(${emitExpr(node.object, ctx)})`;
  }

  const obj = emitReceiver(node.object, ctx);
  const dot = node.optional ? "?." : ".";
  return `${obj}${dot}${node.property}`;
}

/**
 * Bug 61 helper — walk a `@<compound>[.field].<synthProp>` member chain to its
 * dotted runtime key. Returns the dotted string (without the `@`) when the chain
 * is a non-optional path of static property segments rooted at an `@`-prefixed
 * ident; returns null for any other shape (computed/optional segments, non-`@`
 * root, etc.) so the caller falls through to standard member access.
 *
 * Pure AST walk — no symbol-table annotations, no getResolvedStateCell (both
 * empirically dead at codegen, which re-parses exprs from raw strings). The
 * caller's `ctx.synthCellKeys?.has(dotted)` test supplies the registration
 * check; this helper only constructs the candidate key.
 *
 * `node` is the OUTER MemberExpr whose `.property` is already known to be a
 * synth-property name; this walks its `.object` down to the `@`-root.
 */
function synthDottedKey(node: MemberExpr): string | null {
  const segments: string[] = [node.property];
  let cursor: ExprNode = node.object;
  while (cursor.kind === "member") {
    const m = cursor as MemberExpr;
    if (m.optional) return null;
    segments.unshift(m.property);
    cursor = m.object;
  }
  if (cursor.kind !== "ident") return null;
  const rootName = (cursor as IdentExpr).name;
  if (typeof rootName !== "string" || !rootName.startsWith("@")) return null;
  return [rootName.slice(1), ...segments].join(".");
}

/**
 * §59.6 (D4) — Resolve the bare ROOT cell name of an index chain, returning it
 * only if it is a known value-native map (in `ctx.mapVarNames`). Walks through
 * nested `index` objects so a nested-map chain `@outer["a"]["b"]` reports the
 * outermost root `outer`. Returns null for any non-map root or a non-`@`-rooted
 * chain. The `@`-prefix gate matches the reactive-cell sigil; non-`@` array
 * locals are never map cells.
 */
function mapIndexRootName(node: IndexExpr, ctx: EmitExprContext): string | null {
  if (!ctx.mapVarNames || ctx.mapVarNames.size === 0) return null;
  let cursor: ExprNode = node;
  // Descend through nested index objects to the chain root.
  while (cursor.kind === "index") {
    cursor = (cursor as IndexExpr).object;
  }
  if (cursor.kind !== "ident") return null;
  const rootName = (cursor as IdentExpr).name;
  if (typeof rootName !== "string" || !rootName.startsWith("@")) return null;
  const bare = rootName.slice(1);
  return ctx.mapVarNames.has(bare) ? bare : null;
}

function emitIndex(node: IndexExpr, ctx: EmitExprContext): string {
  // §59.6 — map bracket-READ. When the chain ROOT is a known map cell, lower
  // `@m[k]` to `_scrml_map_get(m, k)` (returns `V | not` — JS null on a key-miss,
  // composing with `given` / `is some`). For a NESTED chain `@outer["a"]["b"]`
  // (the SURVEY-SYNTHESIS D4 Q1 case), the inner map-ness is a VALUE type
  // invisible to the name-set, so we lower the WHOLE chain as nested map-gets:
  // `_scrml_map_get(_scrml_map_get(outer, "a"), "b")`. The runtime
  // `_scrml_map_get` degrades GRACEFULLY on a non-map receiver (returns null,
  // runtime-template.js line 3981) — a mis-assumed nested read does not throw,
  // it yields `not`, the safe map-read semantics. `emitExpr(node.object)`
  // recurses: an inner `index` whose root is the same map cell re-enters this
  // branch and emits its own `_scrml_map_get`, so a chain of N brackets nests N
  // map-gets without special-casing depth.
  if (ctx.mode === "client" && mapIndexRootName(node, ctx) !== null) {
    const receiver = emitExpr(node.object, ctx);
    const key = emitExpr(node.index, ctx);
    return `_scrml_map_get(${receiver}, ${key})`;
  }

  const obj = emitReceiver(node.object, ctx);
  const idx = emitExpr(node.index, ctx);
  const bracket = node.optional ? "?.[" : "[";
  return `${obj}${bracket}${idx}]`;
}

function emitCall(node: CallExpr, ctx: EmitExprContext): string {
  // §14.12.6.3 (S131 — HU-2 hybrid) — `transition(<ident>)` is a compile-time-
  // only marker for lifecycle progression. The type-system walker consumes it
  // symbolically (per checkLifecycleBindingAccess); codegen emits ZERO runtime
  // code. Shape match: CallExpr { callee: IdentExpr("transition"), args: [IdentExpr] }
  // — single bare-identifier argument. Complex argument shapes
  // (`transition(foo.bar)`, `transition(foo())`) are not recognised here and
  // fall through to the standard call-emission path; they would surface as
  // runtime-undefined `transition is not defined` calls in adopter code, which
  // is the correct error surface (the type-system surface forbids these shapes,
  // and the runtime-undefined error is the loudest possible signal).
  if (
    node.callee.kind === "ident" &&
    (node.callee as IdentExpr).name === "transition" &&
    node.args.length === 1 &&
    node.args[0] && node.args[0].kind === "ident"
  ) {
    return "";
  }

  // §41.13 parseVariant — call-site annotated by TS pass with parseVariantEnum.
  // Dispatch to the monomorphized parser emitter (emit-parse-variant.ts).
  if (isParseVariantCall(node)) {
    return emitParseVariantCall(node, ctx);
  }

  // §59.7/§59.8 (D4) — map METHOD interception. `@m.<method>(…args)` where `m`
  // is a known value-native map (ctx.mapVarNames) lowers to the matching
  // `_scrml_map_<method>(m, …args)` PURE runtime helper (the write methods
  // return a NEW map; `@m = @m.insert(k, v)` rides the existing reactive-
  // reassignment path — `emitAssign` → `_scrml_reactive_set` — so NO new
  // reactivity is introduced). Mirrors the `.advance` interception below:
  // fires BEFORE the standard MemberExpr path, because the cell value is the
  // plain `{ __scrml_map, … }` object with no `.insert` method on it.
  //
  // The camelCase SURFACE method maps to the snake_case helper name
  // (`.getOr` → `_scrml_map_get_or`, `.insertAll` → `_scrml_map_insert_all`,
  // `.sortedBy` → `_scrml_map_sorted_by`).
  if (
    ctx.mode === "client" &&
    ctx.mapVarNames && ctx.mapVarNames.size > 0 &&
    node.callee.kind === "member" &&
    !node.callee.optional &&
    typeof node.callee.property === "string" &&
    node.callee.object.kind === "ident" &&
    typeof (node.callee.object as IdentExpr).name === "string" &&
    (node.callee.object as IdentExpr).name.startsWith("@")
  ) {
    const bareName = (node.callee.object as IdentExpr).name.slice(1);
    if (ctx.mapVarNames.has(bareName)) {
      const helper = MAP_METHOD_HELPERS[node.callee.property as string];
      if (helper) {
        const receiver = emitExpr(node.callee.object, ctx);
        const args = node.args.map(a => emitExpr(a as ExprNode, ctx));
        return `${helper}(${[receiver, ...args].join(", ")})`;
      }
      // A `@m.<unknown>(...)` call on a map cell whose method is not in the
      // surface table falls through to the standard member-call path (e.g. an
      // array method chained off `.entries()` would already have been emitted
      // by the recursive `.entries()` lowering; a genuinely-unknown method
      // surfaces as a runtime-undefined error, the loudest signal).
    }
  }

  // C13 §51.0.G — `.advance(.X)` interception for engine variables.
  //
  // Detect the AST shape:
  //   CallExpr {
  //     callee: MemberExpr { object: IdentExpr("@<varName>"), property: "advance" },
  //     args: [ <targetExpr> ]
  //   }
  // where `<varName>` is a known engine variable (per
  // ctx.engineVarNames, populated from collectEngineVarNames in
  // emit-reactive-wiring). Emit a runtime-helper call that reads the cell,
  // validates against the from-state's rule= entry in the compile-time-baked
  // table, and either commits or throws E-ENGINE-INVALID-TRANSITION.
  //
  // CRITICAL: this dispatch fires BEFORE the standard MemberExpr path —
  // emitting `_scrml_reactive_get("marioState").advance(...)` would fail at
  // runtime because the cell value is a bare variant string with no method.
  if (
    ctx.mode === "client" &&
    ctx.engineVarNames && ctx.engineVarNames.size > 0 &&
    node.callee.kind === "member" &&
    !node.callee.optional &&
    node.callee.property === "advance" &&
    node.callee.object.kind === "ident" &&
    typeof (node.callee.object as IdentExpr).name === "string" &&
    (node.callee.object as IdentExpr).name.startsWith("@") &&
    node.args.length === 1
  ) {
    const bareName = (node.callee.object as IdentExpr).name.slice(1);
    if (ctx.engineVarNames.has(bareName)) {
      const { emitEngineAdvanceCall } = require("./emit-engine.ts");
      // Bug #2 follow-up (s83-a7-bug-6) — detect the `.X.history` structured
      // restore-form on the argument. Mirrors emit-logic.ts:detectHistoryForm
      // applied to the advance call site. Shape: MemberExpr with property
      // "history" and an inner variant-bearing object (bare-dot ident OR
      // member-on-member). When detected, strip the `.history` suffix from
      // the target expression and pass isHistoryRestore=true.
      let arg0: any = node.args[0];
      let isHistoryRestore = false;
      if (
        arg0 && typeof arg0 === "object" &&
        arg0.kind === "member" && arg0.property === "history" &&
        arg0.object && typeof arg0.object === "object"
      ) {
        const inner = arg0.object;
        // Accept bare-dot ident `.Variant` or qualified `Type.Variant` /
        // `Outer.Type.Variant` chains. Reject calls / brackets / non-variant.
        if (
          (inner.kind === "ident" && typeof inner.name === "string" && inner.name.startsWith(".")) ||
          inner.kind === "member"
        ) {
          arg0 = inner;
          isHistoryRestore = true;
        }
      }
      const targetExpr = emitExpr(arg0, ctx);
      // §51.0.S (S155 batch 3) — PLANE STAMP (§51.0.G.1 / §51.0.S.2.5). When the
      // engine declares message arms AND the `.advance` argument is a literal
      // bare-variant whose name is in the engine's resolved `accepts=` message-
      // variant set, this is a MESSAGE-plane dispatch — route to
      // `_scrml_engine_dispatch_message` (runs the (state × message) arm,
      // resolves the target, transitions). Otherwise (state-plane variant, or
      // engine has no message arms) take the existing STATE-plane advance.
      //
      // The plane is decided STATICALLY at codegen: the typer (batch 2) already
      // resolved `accepts=` + verified the variant against exactly one plane
      // (§51.0.G.1 — ambiguous / unknown cases are compile errors there), so a
      // bare-variant arg that lands in the message-variant set is unambiguously
      // the message plane. No runtime membership check is emitted.
      const hasMessageArms = ctx.enginesWithMessageArms
        ? ctx.enginesWithMessageArms.has(bareName)
        : false;
      if (hasMessageArms) {
        const msgVariantSet = ctx.engineMessageVariants
          ? ctx.engineMessageVariants.get(bareName)
          : undefined;
        const argVariantName = extractAdvanceBareVariantName(node.args[0]);
        if (
          !isHistoryRestore &&
          argVariantName !== null &&
          msgVariantSet &&
          msgVariantSet.has(argVariantName)
        ) {
          const { emitEngineMessageDispatchCall } = require("./emit-engine.ts");
          return emitEngineMessageDispatchCall(
            bareName,
            targetExpr,
            ctx.enginesWithHooks ? ctx.enginesWithHooks.has(bareName) : false,
            ctx.enginesWithOnTimeout ? ctx.enginesWithOnTimeout.has(bareName) : false,
            ctx.enginesWithIdleWatchdog ? ctx.enginesWithIdleWatchdog.has(bareName) : false,
            ctx.enginesWithInternalRules ? ctx.enginesWithInternalRules.has(bareName) : false,
            ctx.enginesWithHistory ? ctx.enginesWithHistory.has(bareName) : false,
          );
        }
      }
      // B17.4 — pass hasHooks so the wrap (capture pre-write + fire-hooks-post)
      // is emitted only when this engine has at least one effect=/<onTransition>
      // arm. Tree-shake: hookless engines emit the bare runtime helper call.
      const hasHooks = ctx.enginesWithHooks ? ctx.enginesWithHooks.has(bareName) : false;
      // A5-4 (§51.0.M) — pass hasOnTimeoutElements so the helper threads the
      // per-engine timers-table identifier through. Engines without any
      // <onTimeout> emit the 3-arg form (no timer arg).
      const hasOnTimeout = ctx.enginesWithOnTimeout ? ctx.enginesWithOnTimeout.has(bareName) : false;
      // A5-6 (§51.0.R, S77) — pass hasIdle so the helper threads the per-
      // engine watchdog config identifier as the 5th arg. Tree-shake when
      // engine has no <onIdle>.
      const hasIdle = ctx.enginesWithIdleWatchdog ? ctx.enginesWithIdleWatchdog.has(bareName) : false;
      // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — pass hasInternal so the helper
      // threads the per-engine internal transition table identifier as the
      // trailing (6th) arg. Tree-shake when engine has no `internal:rule=`.
      const hasInternal = ctx.enginesWithInternalRules ? ctx.enginesWithInternalRules.has(bareName) : false;
      // A5-7 Wave 2.3 (§51.0.N, Bug #3) — pass hasHistory so the helper
      // threads the per-engine history-map identifier as the trailing (7th)
      // arg. Tree-shake when engine has no composite `history` state-child.
      const hasHistory = ctx.enginesWithHistory ? ctx.enginesWithHistory.has(bareName) : false;
      return emitEngineAdvanceCall(bareName, targetExpr, hasHooks, hasOnTimeout, hasIdle, hasInternal, hasHistory, isHistoryRestore);
    }
  }

  // Bug 2 (S95) — `.Variant(args)` bare-dot payload-variant constructor.
  //
  // Without this dispatch, `emitIdent` lowers a bare-dot uppercase ident
  // (`.Variant`) to its string tag (`"Variant"`), and the surrounding CallExpr
  // emits `"Variant"(args)` — calling a string as a function (runtime TypeError).
  // Bare-dot ident is the §14.10 / §18.0.3 inference shape; when it appears as
  // a CallExpr callee, it can only be a payload-bearing constructor (unit
  // variants never carry parens).
  //
  // Canonical shape per SPEC §51.3.2 (Implementation notes, landed S22):
  //   `Shape.Circle(10)` → `{ variant: "Circle", data: { r: 10 } }`
  // The runtime cell value for payload-bearing variants IS this tagged-object
  // shape (matches §19.3.2 `fail` minus the `__scrml_error` sentinel; one
  // runtime dispatches both error and regular variants by `.variant`).
  //
  // Codegen lowers `.Circle(10)` to the inline tagged-object literal directly
  // (rather than indirecting through the enum's constructor function) so:
  //   1. No dependency on the EnumName-frozen-object being in scope at the
  //      call site (escape-hatch contexts, server boundary, IIFE chains).
  //   2. Self-contained — the constructor's emit is purely the field-name
  //      registry lookup populated at file-init by buildVariantFieldsRegistry.
  //   3. Mirrors the existing rewrite-path policy for bare-dot unit variants:
  //      collapse to the canonical runtime literal at emit time.
  //
  // Field-name resolution uses the module-level variant-fields registry
  // (emit-control-flow.ts:getVariantFieldSchema). When the variant has a
  // declared field list, the emit pairs each positional argument with the
  // declared field name. When the variant is unknown or in the collision
  // set (same name across two enums in one file), we fall through to the
  // generic emission path — qualified `Enum.Variant(args)` will dispatch
  // via the standard MemberExpr emit, which works correctly because the
  // frozen enum object's `Variant` property IS a constructor function.
  //
  // The qualified `Enum.Variant(args)` shape continues to work via the
  // standard MemberExpr → CallExpr emission — `Enum.Variant` resolves to the
  // frozen enum's constructor function (per `emit-client.ts:emitEnumVariantObjects`),
  // and `(args)` invokes it. No change needed for the qualified form.
  if (
    node.callee.kind === "ident" &&
    typeof (node.callee as IdentExpr).name === "string"
  ) {
    const ident = node.callee as IdentExpr;
    const name = ident.name;
    if (
      name.length >= 2 &&
      name.charCodeAt(0) === 46 /* . */ &&
      name.charCodeAt(1) >= 65 && name.charCodeAt(1) <= 90 /* A-Z */
    ) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getVariantFieldSchema } = require("./emit-control-flow.ts") as {
        getVariantFieldSchema: (variantName: string) => string[] | null;
      };
      const variantName = name.slice(1);
      const fieldNames = getVariantFieldSchema(variantName);
      if (fieldNames !== null) {
        // Emit `{ variant: "X", data: { field0: arg0, field1: arg1, ... } }`.
        // Truncate to min(args.length, fieldNames.length) so an over-long
        // call (extra args ignored) or under-long call (missing args lower
        // to `undefined`, which is later normalized at the wire layer per
        // §57) both produce valid JS. The type-checker's earlier passes
        // catch arity mismatches as E-TYPE-* — by codegen, the call is
        // arity-aligned in well-typed programs.
        // S142 gate-tail (parity with rewrite.ts:_rewritePayloadVariantConstructorCalls):
        // named-field construction `.X(field: value)` (§18.7 named form). When
        // an emitted arg is already in `name: value` form, the field name is on
        // the arg — emit it verbatim instead of re-prefixing with the positional
        // fieldNames[i] (which produced the malformed `field: field: value`).
        const NAMED_ARG_RE = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:(?!:)\s*([\s\S]+)$/;
        const argExprs = node.args.map(a => emitExpr(a, ctx));
        const pairCount = Math.min(argExprs.length, fieldNames.length);
        const pairs: string[] = [];
        for (let i = 0; i < argExprs.length; i++) {
          const named = argExprs[i].match(NAMED_ARG_RE);
          if (named) {
            pairs.push(`${named[1]}: ${named[2].trim()}`);
          } else if (i < pairCount) {
            pairs.push(`${fieldNames[i]}: ${argExprs[i]}`);
          }
        }
        const dataLiteral = pairs.length === 0 ? "{}" : `{ ${pairs.join(", ")} }`;
        return `{ variant: ${JSON.stringify(variantName)}, data: ${dataLiteral} }`;
      }
      // Unknown variant or collision — fall through to the generic emit. The
      // generic path emits `"Variant"(args)` for bare-dot which is broken JS,
      // but the typer should have rejected an unknown-variant call upstream
      // (E-VARIANT-AMBIGUOUS / E-TYPE-063 at B20); reaching this fall-through
      // implies an upstream gap, not a codegen contract.
    }
  }

  // §51.14 replay(@target, @log[, index]) → _scrml_replay("target", _scrml_reactive_get("log"), index?)
  // The target's @-ref becomes a name string literal (not its value) so the
  // runtime helper knows which reactive-store slot to write. Matched before
  // the generic emitExpr pass on children so @target stays literal.
  if (node.callee.kind === "ident" && node.callee.name === "replay" && node.args.length >= 2) {
    const targetArg = node.args[0];
    const logArg = node.args[1];
    if (
      targetArg.kind === "ident" && typeof (targetArg as { name: string }).name === "string"
      && (targetArg as { name: string }).name.startsWith("@")
      && logArg.kind === "ident" && typeof (logArg as { name: string }).name === "string"
      && (logArg as { name: string }).name.startsWith("@")
    ) {
      const targetName = (targetArg as { name: string }).name.slice(1);
      const logExpr = emitExpr(logArg, ctx);  // normal @-ref emission
      const indexPart = node.args.length >= 3
        ? `, ${emitExpr(node.args[2], ctx)}`
        : "";
      return `_scrml_replay(${JSON.stringify(targetName)}, ${logExpr}${indexPart})`;
    }
    // Malformed replay call (args not both @-refs) — fall through to the
    // generic emit path. Slice 2 validation will surface this as a compile
    // error.
  }

  const callee = emitReceiver(node.callee, ctx);
  const args = node.args.map(a => emitExpr(a, ctx)).join(", ");

  // Issue #1 (parent scrmlTS) — server-fn → sibling server-fn in-process call.
  // The per-fn route handler (`_scrml_handler_*`) is a Request->Response wrapper,
  // NOT a plain callable, so a body-level `nextOrder()` reference had no binding
  // ("nextOrder is not defined" at runtime). emit-server.ts emits a plain
  // `async function <name>(<params>) { ... }` peer callable for each composed
  // server fn and registers the name in `ctx.serverFnNames`; here we resolve the
  // call to that peer and `await` it (the peer is async — without the await the
  // body leaks an unawaited Promise into downstream SQL/params). This is placed
  // BEFORE the navigate/render/log builtin lowerings so a server fn that shadows
  // a builtin name dispatches to the user's peer, not the builtin. Only fires in
  // server-mode emission; a local of the same name shadows the peer.
  if (
    ctx.mode === "server" &&
    !node.optional &&
    node.callee.kind === "ident" &&
    typeof node.callee.name === "string" &&
    ctx.serverFnNames != null &&
    ctx.serverFnNames.has(node.callee.name) &&
    !(ctx.declaredNames != null && ctx.declaredNames.has(node.callee.name))
  ) {
    // The peer is async, so it must be `await`ed — but ONLY where `await` is
    // valid. `ctx.peerAwaitable === false` marks a non-awaitable position (a
    // synchronous callback body, or ANY parameter default — `await` is illegal
    // in a default even in an async function). There we emit a bare call and
    // RECORD the site: a bare server-fn call returns an unawaited Promise, which
    // is a bug, so emit-server raises E-SERVER-FN-IN-SYNC-CALLBACK from this
    // record. This single `peerAwaitable` decision is the source of truth for
    // BOTH the lowering and the diagnostic (no second classifier to drift).
    // (`isAwaitedPeerCall` mirrors this exact condition + `peerAwaitable !==
    // false` so emitReceiver can wrap an await form used as a receiver.)
    if (ctx.peerAwaitable === false) {
      if (ctx.syncPeerCalls) ctx.syncPeerCalls.push({ name: node.callee.name, span: node.span });
      return `${callee}(${args})`;
    }
    return `await ${callee}(${args})`;
  }

  // navigate() → client-side routing
  if (node.callee.kind === "ident" && node.callee.name === "navigate") {
    return `_scrml_navigate(${args})`;
  }

  // render() → client-side component render.
  // ss16 C3 (mirror §20.6 log-shadowing): a user-declared `render` in scope
  // WINS — the builtin steps aside and the call is emitted via the generic
  // call path so the §47 user-fn name-encoding + fnNameMap post-pass rewrites
  // it (`render` → `_scrml_render_1`), matching the user's `function render`
  // def. Without this, the hijack emits `_scrml_render` directly, which the
  // post-pass's word-boundary regex `\b(render)\b` CANNOT match (no boundary
  // before `render` after the `_`) → call never repaired → def/call mismatch
  // → ReferenceError. The info-level W-RENDER-SHADOWED diagnostic is fired at
  // the shadowing declaration by the type pass (`checkRenderShadowing`).
  if (node.callee.kind === "ident" && node.callee.name === "render") {
    const userDeclaredRender = _renderShadowedInFile || !!(ctx.declaredNames && ctx.declaredNames.has("render"));
    if (!userDeclaredRender) {
      return `_scrml_render(${args})`;
    }
    // Fall through to the generic call path below (callee === "render", which
    // the fnNameMap post-pass rewrites to the user fn's encoded name).
  }

  // §20.6 — log() location-transparent logging builtin.
  //
  // Lowers `log(...args)` to `_scrml_log(side, loc, ...args)` where:
  //   - `side` ("server"|"client") is the COMPILER-CERTAIN side of this call
  //     site, taken from `ctx.mode` (the emit context already carries the
  //     server/client classification — server-batch bodies emit with
  //     mode:"server", client wrappers/handlers with mode:"client", so the
  //     tag is per-statement-accurate including inside CPS-split functions).
  //   - `loc` ("basename:line") is resolved at COMPILE time from the call
  //     node's byte offset (`node.span.start`) against the file source
  //     (log-loc.ts) — the node's own `span.line` is NOT reliable (re-parse
  //     stamps line:1), the byte offset is.
  // Shadowing (Open-Q3): a user-declared `log` in scope WINS — emit an
  // ordinary call + fire info-level W-LOG-SHADOWED; the builtin steps aside.
  // Production (F4=A): when the compile-wide strip flag is set, lower to a
  // harmless no-op expression so the release bundle carries NO `_scrml_log`
  // reference and no argument-evaluation residue (mirrors test-bind 0-byte).
  if (node.callee.kind === "ident" && node.callee.name === "log") {
    const userDeclaredLog = _logShadowedInFile || !!(ctx.declaredNames && ctx.declaredNames.has("log"));
    if (userDeclaredLog) {
      // A user binding named `log` shadows the builtin — emit a plain call to
      // it (the builtin steps aside). The info-level W-LOG-SHADOWED diagnostic
      // is fired at the SHADOWING DECLARATION by the type pass
      // (`checkLogShadowing` in type-system.ts), which has the wired diagnostic
      // stream — codegen's EmitExprContext.errors is not reliably populated, so
      // the lint lives there, not here. This branch only suppresses the builtin
      // lowering so the user's `log` is called verbatim.
      const call0 = node.optional ? "?.(" : "(";
      return `${callee}${call0}${args})`;
    }
    if (_logProductionStrip) {
      // Strip to 0 bytes of log infrastructure: a no-op expression that is
      // valid in statement AND expression position and drops the args (no
      // arg side-effects leak; no `_scrml_log` reference).
      return "(void 0)";
    }
    const side = ctx.mode === "server" ? "server" : "client";
    // The call node's own span loses its byte offset through the codegen
    // re-parse (start === 0 = not-set); the enclosing statement span
    // (ctx.stmtSpan) keeps the real offset, so prefer it for file:line.
    const nodeStartSet = node.span && typeof node.span.start === "number" && node.span.start > 0;
    const locSpan = nodeStartSet ? node.span : (ctx.stmtSpan ?? node.span);
    const loc = resolveLogLoc(locSpan);
    const tagArgs = `${JSON.stringify(side)}, ${JSON.stringify(loc)}`;
    return args.length > 0
      ? `_scrml_log(${tagArgs}, ${args})`
      : `_scrml_log(${tagArgs})`;
  }

  const call = node.optional ? "?.(" : "(";
  return `${callee}${call}${args})`;
}

function emitNew(node: NewExpr, ctx: EmitExprContext): string {
  const callee = emitReceiver(node.callee, ctx);
  const args = node.args.map(a => emitExpr(a, ctx)).join(", ");
  return `new ${callee}(${args})`;
}

// ---------------------------------------------------------------------------
// Lambda / inline function
// ---------------------------------------------------------------------------

/**
 * GITI-013 (2026-04-25): when an arrow function's expression body is an object
 * literal, the wrapping parens are load-bearing. Without them, JS parses the
 * `=> {...}` form as a block statement (with `key:` looking like a label),
 * not an expression returning an object — `bun --check` then fails with
 * `Expected ";" but found ":"`.
 *
 * Only the structured-tree arrow-expression-body path is affected:
 *   `(f) => ${emitExpr(body)}` where `body.kind === "object"`.
 *
 * Other potentially-leading-`{` forms are NOT reachable here:
 *   - BlockStatement bodies are routed through EscapeHatchExpr (Bug C, 127d35a),
 *     never enter this code path (body.kind === "expr" is the gate).
 *   - SequenceExpression / SpreadElement at top level go through escape-hatch
 *     (see expression-parser.ts lines 1031-1039).
 *   - The `function` style emits `function(){ return X; }` — `return {...}`
 *     is a return statement, not a block-statement collision.
 *
 * The check uses node.body.value.kind directly (cleaner intent than scanning
 * the emitted string). A defensive emitted-string check would also catch the
 * case but couples the fix to a textual property of emitObject.
 *
 * GITI-014 (2026-05-23): exported so the same predicate can guard
 * emit-logic.ts's hand-written `() => <body>` thunks (`_scrml_init_set`,
 * `_scrml_default_set`, `_scrml_derived_declare`). Those sites assemble
 * arrows via string concatenation rather than going through `emitLambda`,
 * so they need an explicit wrap call. See `arrowBodyStringNeedsParens`
 * for the fallback used when only the emitted string is available.
 */
export function arrowBodyNeedsParens(value: ExprNode): boolean {
  return value.kind === "object";
}

/**
 * GITI-014 (2026-05-23): string-form companion to `arrowBodyNeedsParens`
 * for emit sites where only the already-emitted JS body is available
 * (e.g. `emitExprField` fallback paths in emit-logic.ts that rewrite
 * a raw source string when `initExpr` is absent).
 *
 * Returns `true` iff the first significant character of `body` is `{`
 * — the only token that can mis-parse as a block statement in an
 * arrow expression position. Already-paren-wrapped bodies (leading `(`)
 * return `false`, so callers can safely wrap unconditionally without
 * fearing double-wrap.
 */
export function arrowBodyStringNeedsParens(body: string): boolean {
  // Defensive: a non-string body (some emit paths can hand `undefined` when an
  // upstream emit returned nothing) needs no wrap — and must not throw.
  if (typeof body !== "string") return false;
  // Skip leading whitespace; bail on empty.
  let i = 0;
  while (i < body.length && (body[i] === " " || body[i] === "\t" || body[i] === "\n" || body[i] === "\r")) i++;
  return i < body.length && body[i] === "{";
}

function emitLambda(node: LambdaExpr, ctx: EmitExprContext): string {
  const asyncPrefix = node.isAsync ? "async " : "";

  // Issue #1 (parent scrmlTS) — position-accurate lowering of sibling server-fn
  // ("peer") calls inside a lambda. A peer is async, so `await <peer>()` is only
  // valid in an awaitable position; elsewhere `emitCall` emits a bare call and
  // records it for the E-SERVER-FN-IN-SYNC-CALLBACK diagnostic. Two things are
  // set on the child contexts:
  //   - `declaredNames` gains this lambda's own param names, so a param that
  //     shadows a peer name is treated as a local (a bare call to the PARAM),
  //     not lowered to `await`.
  //   - `peerAwaitable`: the BODY of an async lambda is awaitable (it's its own
  //     async function); a SYNC lambda body is not. A PARAMETER DEFAULT is never
  //     awaitable — `await` is illegal in a default even in an async function —
  //     so param defaults always emit a bare call.
  const _childDeclared = new Set<string>(ctx.declaredNames ?? []);
  for (const p of node.params) {
    const nm = (p as { name?: string }).name;
    if (typeof nm === "string" && nm) _childDeclared.add(nm);
  }
  const paramCtx: EmitExprContext = { ...ctx, declaredNames: _childDeclared, peerAwaitable: false };
  const bodyCtx: EmitExprContext = { ...ctx, declaredNames: _childDeclared, peerAwaitable: node.isAsync };

  const params = node.params.map(p => emitLambdaParam(p, paramCtx)).join(", ");

  if (node.fnStyle === "function") {
    // function(x) { ... }
    if (node.body.kind === "expr") {
      return `${asyncPrefix}function(${params}) { return ${emitExpr(node.body.value, bodyCtx)}; }`;
    }
    // Block body — stmts are LogicStatement[], not ExprNode, so we can't emit them here.
    // This path should only be hit once logic-statement emission is integrated (Slice 5).
    // For now, fall through to escape hatch if we have raw text.
    return `${asyncPrefix}function(${params}) { /* block body */ }`;
  }

  // Arrow or fn style
  if (node.body.kind === "expr") {
    const body = emitExpr(node.body.value, bodyCtx);
    const wrapped = arrowBodyNeedsParens(node.body.value) ? `(${body})` : body;
    return `${asyncPrefix}(${params}) => ${wrapped}`;
  }
  // Block body arrow — same limitation as above
  return `${asyncPrefix}(${params}) => { /* block body */ }`;
}

function emitLambdaParam(param: LambdaParam, ctx: EmitExprContext): string {
  let result = param.isRest ? `...${param.name}` : param.name;
  if (param.defaultValue) {
    result += ` = ${emitExpr(param.defaultValue, ctx)}`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

function emitCast(node: CastExpr, ctx: EmitExprContext): string {
  // Type casts are erased at runtime — emit just the expression
  return emitExpr(node.expression, ctx);
}

// ---------------------------------------------------------------------------
// Domain-specific nodes (Slice 4 targets — stubbed with fallback for now)
// ---------------------------------------------------------------------------

function emitMatchExpr(node: MatchExpr, ctx: EmitExprContext): string {
  // Bug 1 (S95) — route the expression-position MatchExpr through the
  // structured emitter in emit-control-flow.ts. The structured emitter
  // handles payload-binding lowering (`.Variant(d) => d == x` destructures
  // `d` from `_scrml_match_N.data.<field>`) and the modern `_ =>` /
  // `else =>` wildcard arms. Previously this shim reconstructed the match
  // as a string and ran rewriteExpr / rewriteServerExpr, neither of which
  // emits payload bindings and both of which leak unrecognised wildcards
  // (`_ =>`) verbatim into the output, producing SyntaxError JS.
  //
  // The structured emitter expects `node.header` (string) /
  // `node.headerExpr` (ExprNode) / `node.body` (array of arm nodes). We
  // synthesize that shape from MatchExpr's `subject` / `rawArms`. Each
  // raw arm string is wrapped as a `bare-expr` child — the structured
  // emitter's body loop calls `parseMatchArm` on each `child.expr`,
  // re-splitting with `splitMultiArmString` first so multiple arms that
  // landed in a single rawArms element (because the upstream
  // expression-parser's splitMatchArms missed an `_` boundary) still
  // parse cleanly.
  //
  // Server boundary: the structured emitter always emits in client mode
  // (its internal `_matchCtx` is `{ mode: "client" }`). For server-bound
  // expressions we fall through to the legacy server-string pipeline so
  // `@var` references rewrite to `_scrml_body["..."]` rather than the
  // client-side `_scrml_reactive_get(...)`. The structured emitter's
  // payload-binding lowering is client-shape; server-position match
  // expressions are uncommon (they appear only in server-handler bodies
  // referencing request-body shapes) and continue using the existing
  // rewrite pipeline.
  if (ctx.mode === "server") {
    const subject = emitExpr(node.subject, ctx);
    const arms = node.rawArms.join(" ");
    const reconstructed = `match ${subject} { ${arms} }`;
    return rewriteServerExpr(reconstructed, ctx.dbVar);
  }

  // The structured emitter uses `emitExprField(headerExpr, header, _matchCtx)`
  // to lower the subject. When `headerExpr` is non-null it goes through
  // emitExpr (the ExprNode walk); when null it falls back to
  // rewriteExprWithDerived on the `header` string. We have a structured
  // ExprNode here (`node.subject`), so pass it as `headerExpr` and let the
  // structured emitter do its normal lowering — preserving `@var` →
  // `_scrml_reactive_get("var")` (or `_scrml_derived_get` for derived
  // names threaded via the inner context).
  const bridgedNode = {
    kind: "match-expr",
    header: "",
    headerExpr: node.subject,
    body: node.rawArms.map((arm) => ({ kind: "bare-expr", expr: arm })),
  };
  // Forward the error channel so the structured emitter's D hard-error
  // (E-CG-003 on a zero-lowerable-arm match — gate-emitted-js-parse-invariant-
  // 2026-05-29) reaches CG diagnostics even from this expression-position
  // bridge. Without this, an unlowerable match in expression position would
  // emit the valid-JS placeholder silently and rely on the A parse gate alone.
  return emitStructuredMatchExpr(bridgedNode, { errors: ctx.errors });
}

function emitSqlRef(node: SqlRefExpr, _ctx: EmitExprContext): string {
  // TODO(Phase 3 Slice 4): structured SQL ref emission
  // SqlRefExpr carries a nodeId referencing the SQLNode — codegen resolves this
  // at the file level. For now, return a placeholder that the outer emitter
  // can fill in (SQL blocks are handled at the statement level, not expression level).
  //
  // v0.2.4 bug-1-anomaly-2 defense-in-depth: when `nodeId === -1` (the parser
  // sentinel set at expression-parser.ts:889 for `__scrml_sql_placeholder__`
  // identifiers), emit a JS-valid `null` with a diagnostic comment instead of
  // the broken `(slash-star) sql-ref:-1 (star-slash)` shape. The broken comment
  // shape silently parsed (a Block-comment followed by `.get()` is legal JS),
  // producing wrong runtime semantics with no parse failure. The upstream fix
  // (ast-builder.js sqlNode hook in let-decl/const-decl) prevents this path
  // for the known repro (examples/17-schema-migrations.scrml, S84 Wave 1 #2);
  // this guard catches future regressions and surfaces them as runtime
  // TypeErrors instead of opaque comments.
  if (node.nodeId < 0) {
    return `null /* sql-ref unresolved: nodeId=${node.nodeId} — upstream parser/AST bug, please report */`;
  }
  return `/* sql-ref:${node.nodeId} */`;
}

function emitInputStateRef(node: InputStateRefExpr, ctx: EmitExprContext): string {
  // §6.7.7 / §60.4 — a `<#id>` whose id names a `<request>` is a REQUEST-STATE
  // ref: its state lives on the reactive `_scrml_request_<id>` object, NOT the
  // §36 input-state registry (which the request never populates). Reading the
  // registry returns `undefined` → a `.loading`/`.data` access throws. Route to
  // the request state object. Non-request ids keep the §36 registry lowering
  // (render-once non-reactive by design, §36.6).
  if (ctx.requestIds && ctx.requestIds.has(node.name)) {
    return `_scrml_request_${node.name}`;
  }
  return `_scrml_input_state_registry.get("${node.name}")`;
}

// ---------------------------------------------------------------------------
// Escape hatch — falls back to string rewrite pipeline
// ---------------------------------------------------------------------------

function emitEscapeHatch(node: EscapeHatchExpr, ctx: EmitExprContext): string {
  // The string pipeline handles whatever the structured parser couldn't parse.
  // This path disappears when all escape hatches are eliminated (Phase 3.5).
  //
  // Bug C (6nz 2026-04-20): for ArrowFunctionExpression / FunctionExpression
  // escape-hatches the raw text is a callback VALUE at an expression position.
  // The default pipeline's Pass 1 (rewritePresenceGuard) would match
  // `(x) => { body }` and rewrite it into an if-statement, corrupting the
  // arrow. Use the arrow-body variant that skips that pass.
  // Dual-mode: the live (Acorn) pipeline produces escape-hatch nodes whose
  // `nativeKind` carries the ESTree node-type string; the native parser
  // (v0.6) produces first-class ExprNode kinds (`"Arrow"` / `"Function"`).
  // Both arms recognized so codegen works regardless of front-end.
  const isArrowOrFn =
    (node as any).kind === "Arrow" ||
    (node as any).kind === "Function" ||
    node.nativeKind === "ArrowFunctionExpression" ||
    node.nativeKind === "FunctionExpression";
  if (ctx.mode === "server") {
    return isArrowOrFn
      ? rewriteServerExprArrowBody(node.raw, ctx.dbVar)
      : rewriteServerExpr(node.raw, ctx.dbVar);
  }
  return isArrowOrFn
    ? rewriteExprArrowBody(node.raw, ctx.errors)
    : rewriteExpr(node.raw, ctx.errors);
}
