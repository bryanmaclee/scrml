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
} from "../types/ast.ts";
import { rewriteExpr, rewriteServerExpr, rewriteExprArrowBody, rewriteServerExprArrowBody, rewriteExprWithDerived } from "./rewrite.js";
import { emitParseVariantCall, isParseVariantCall } from "./emit-parse-variant.ts";
import { emitMatchExpr as emitStructuredMatchExpr } from "./emit-control-flow.ts";

// ---------------------------------------------------------------------------
// EmitExprContext — threaded through every emit call
// ---------------------------------------------------------------------------

export interface EmitExprContext {
  /** Client mode emits reactive_get; server mode emits _scrml_body["..."]. */
  mode: "client" | "server";
  /** Derived reactive names — emits _scrml_derived_get instead of _scrml_reactive_get. */
  derivedNames?: Set<string> | null;
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
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
    case "input-state-ref": return emitInputStateRef(node);
    case "escape-hatch": return emitEscapeHatch(node, ctx);
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
    if (ctx.mode === "server") {
      return `_scrml_body["${bare}"]`;
    }
    // Client mode — check derived vs reactive
    if (ctx.derivedNames && ctx.derivedNames.has(bare)) {
      return `_scrml_derived_get("${bare}")`;
    }
    return `_scrml_reactive_get("${bare}")`;
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
      if (ctx.mode === "server") {
        // Server boundary: @x is `_scrml_body["x"]` (a plain assignment lvalue).
        // Postfix on a member expression IS valid JS, so emit as-is.
        return `_scrml_body["${bare}"]${node.op}`;
      }
      const sign = node.op === "++" ? "+" : "-";
      const getter = ctx.derivedNames?.has(bare)
        ? `_scrml_derived_get("${bare}")`
        : `_scrml_reactive_get("${bare}")`;
      return `_scrml_reactive_set("${bare}", ${getter} ${sign} 1)`;
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
 *   - Only binary children whose own operator emits flat can mis-associate; all
 *     other children (literals, idents, calls, self-bracketed equality/is forms,
 *     etc.) already emit as self-contained primaries.
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
  const value = emitExpr(node.value, ctx);

  // Reactive assignment: @var = expr → _scrml_reactive_set("var", expr)
  if (target.kind === "ident" && target.name.startsWith("@")) {
    const bare = target.name.slice(1);
    if (ctx.mode === "server") {
      return `_scrml_body["${bare}"] ${node.op} ${value}`;
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
      return `_scrml_reactive_set("${bare}", ${value})`;
    }
    // Compound assignment: @x += 1 → _scrml_reactive_set("x", _scrml_reactive_get("x") + 1)
    const baseOp = node.op.slice(0, -1); // "+=" → "+"
    const getter = ctx.derivedNames?.has(bare)
      ? `_scrml_derived_get("${bare}")`
      : `_scrml_reactive_get("${bare}")`;
    return `_scrml_reactive_set("${bare}", ${getter} ${baseOp} ${value})`;
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
  const obj = emitExpr(node.object, ctx);
  const dot = node.optional ? "?." : ".";
  return `${obj}${dot}${node.property}`;
}

function emitIndex(node: IndexExpr, ctx: EmitExprContext): string {
  const obj = emitExpr(node.object, ctx);
  const idx = emitExpr(node.index, ctx);
  const bracket = node.optional ? "?.[" : "[";
  return `${obj}${bracket}${idx}]`;
}

function emitCall(node: CallExpr, ctx: EmitExprContext): string {
  // §41.13 parseVariant — call-site annotated by TS pass with parseVariantEnum.
  // Dispatch to the monomorphized parser emitter (emit-parse-variant.ts).
  if (isParseVariantCall(node)) {
    return emitParseVariantCall(node, ctx);
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
        const argExprs = node.args.map(a => emitExpr(a, ctx));
        const pairCount = Math.min(argExprs.length, fieldNames.length);
        const pairs: string[] = [];
        for (let i = 0; i < pairCount; i++) {
          pairs.push(`${fieldNames[i]}: ${argExprs[i]}`);
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

  const callee = emitExpr(node.callee, ctx);
  const args = node.args.map(a => emitExpr(a, ctx)).join(", ");

  // navigate() → client-side routing
  if (node.callee.kind === "ident" && node.callee.name === "navigate") {
    return `_scrml_navigate(${args})`;
  }

  // render() → client-side component render
  if (node.callee.kind === "ident" && node.callee.name === "render") {
    return `_scrml_render(${args})`;
  }

  const call = node.optional ? "?.(" : "(";
  return `${callee}${call}${args})`;
}

function emitNew(node: NewExpr, ctx: EmitExprContext): string {
  const callee = emitExpr(node.callee, ctx);
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
  // Skip leading whitespace; bail on empty.
  let i = 0;
  while (i < body.length && (body[i] === " " || body[i] === "\t" || body[i] === "\n" || body[i] === "\r")) i++;
  return i < body.length && body[i] === "{";
}

function emitLambda(node: LambdaExpr, ctx: EmitExprContext): string {
  const params = node.params.map(p => emitLambdaParam(p, ctx)).join(", ");
  const asyncPrefix = node.isAsync ? "async " : "";

  if (node.fnStyle === "function") {
    // function(x) { ... }
    if (node.body.kind === "expr") {
      return `${asyncPrefix}function(${params}) { return ${emitExpr(node.body.value, ctx)}; }`;
    }
    // Block body — stmts are LogicStatement[], not ExprNode, so we can't emit them here.
    // This path should only be hit once logic-statement emission is integrated (Slice 5).
    // For now, fall through to escape hatch if we have raw text.
    return `${asyncPrefix}function(${params}) { /* block body */ }`;
  }

  // Arrow or fn style
  if (node.body.kind === "expr") {
    const body = emitExpr(node.body.value, ctx);
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
  return emitStructuredMatchExpr(bridgedNode);
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

function emitInputStateRef(node: InputStateRefExpr): string {
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
