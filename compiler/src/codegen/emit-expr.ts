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

    // §42 presence/absence checks
    case "is-not":
      return `(${left} === null || ${left} === undefined)`;
    case "is-some":
      return `(${left} !== null && ${left} !== undefined)`;
    case "is-not-not":
      return `(${left} !== null && ${left} !== undefined)`;

    // §43 enum membership: x is .Variant → x === "Variant"
    case "is": {
      // The right operand is an enum variant (.Active, Enum.Variant, null, undefined).
      // Dot-prefixed variants emit as string literals to match rewriteIsOperator behavior.
      let rhs = right;
      if (node.right.kind === "ident" && node.right.name.startsWith(".")) {
        rhs = `"${node.right.name.slice(1)}"`;
      } else if (node.right.kind === "member") {
        // Enum.Variant → "Variant"
        rhs = `"${node.right.property}"`;
      }
      return `(${left} === ${rhs})`;
    }

    default:
      return `${left} ${node.op} ${right}`;
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
      const targetExpr = emitExpr(node.args[0], ctx);
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
      return emitEngineAdvanceCall(bareName, targetExpr, hasHooks, hasOnTimeout, hasIdle, hasInternal);
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
 */
function arrowBodyNeedsParens(value: ExprNode): boolean {
  return value.kind === "object";
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
  // TODO(Phase 3 Slice 4): structured match-expr emission
  // For now, reconstruct the string and fall back to rewriteExpr
  const subject = emitExpr(node.subject, ctx);
  const arms = node.rawArms.join(" ");
  const reconstructed = `match ${subject} { ${arms} }`;
  return ctx.mode === "server"
    ? rewriteServerExpr(reconstructed, ctx.dbVar)
    : rewriteExpr(reconstructed, ctx.errors);
}

function emitSqlRef(node: SqlRefExpr, _ctx: EmitExprContext): string {
  // TODO(Phase 3 Slice 4): structured SQL ref emission
  // SqlRefExpr carries a nodeId referencing the SQLNode — codegen resolves this
  // at the file level. For now, return a placeholder that the outer emitter
  // can fill in (SQL blocks are handled at the statement level, not expression level).
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
  const isArrowOrFn =
    node.estreeType === "ArrowFunctionExpression" ||
    node.estreeType === "FunctionExpression";
  if (ctx.mode === "server") {
    return isArrowOrFn
      ? rewriteServerExprArrowBody(node.raw, ctx.dbVar)
      : rewriteServerExpr(node.raw, ctx.dbVar);
  }
  return isArrowOrFn
    ? rewriteExprArrowBody(node.raw, ctx.errors)
    : rewriteExpr(node.raw, ctx.errors);
}
