/**
 * @module codegen/constant-folder
 *
 * Pure partial-evaluation primitive for scrml expression nodes.
 *
 * S89 wave A-2.2.b — authored to underwrite Component 1
 * (`initially_rendered_components(E)`) of the Stage 7.6 Reachability
 * Solver per SPEC §40.9.2:
 *
 *   "The compile-time evaluator the analysis uses is the same recursive
 *    constant-folding pass that §22 (^{}) consumes for compile-time
 *    meta-blocks. It is NOT a general partial evaluator; it is bounded by
 *    the determinism constraints of §22 (no Date.now(), no bun.eval() of
 *    non-deterministic shape, no I/O)."
 *
 * Post-S130 note (HU-2 Q4 / F-003): `bun.eval()` retires as a USER-FACING
 * surface entirely (the prior §30.2 `${ bun.eval(...) }` interpolation form
 * is RETIRED per Approach C extension; see SPEC §22.12 + §30.1 retirement
 * note). The determinism reference above remains valid because `bun.eval()`
 * persists as a compiler-INTERNAL mechanism only (§30.1). The compile-time
 * evaluator still constrains its admissible compiler-internal surface to
 * deterministic expression shapes.
 *
 * **OQ-A2-D disposition (S89, option (a)):** extract a constant-folding
 * primitive that Component 1 + future passes (UVB attribute-allowlist
 * narrowing, the §22 evaluator, the §17.5 if= classifier) can all consume.
 *
 * **META integration status:** META's existing `meta-eval.ts` evaluator
 * is text-based (`new Function()` over a serialized JS string), NOT a
 * structural-fold over `ExprNode`. The two are semantically equivalent
 * for the pure-constant subset (no reactive `@var`, no server-fn, no
 * `Date.now()`, no I/O); converting META to consume this primitive is a
 * downstream refactor that requires META to walk `ExprNode` structurally
 * instead of serializing to JS source. That refactor is **deferred**;
 * this wave establishes the primitive Component 1 needs.
 *
 * ## Signature
 *
 *   partiallyEvaluateExpr(ast: ExprNode, env: ConstFoldEnv): ConstResult
 *
 * Where:
 *   - `ConstResult` ::= `{ kind: "constant", value: PrimitiveValue }`
 *                    | `{ kind: "runtime" }`
 *   - `ConstFoldEnv` carries the const-bound identifier table (compile-
 *     time-known `const` decls + literal `let` initializers) plus the
 *     determinism policy.
 *
 * The primitive is **conservative**: when in doubt, return
 * `{ kind: "runtime" }`. Component 1 admits worst-case-union on runtime
 * (per §40.9.2), so a false-runtime classification over-includes but
 * never under-includes.
 *
 * ## Determinism constraints (§22 / §40.9.2)
 *
 *   - No reactive cells (`@var`) — these are runtime by definition.
 *   - No server-fn calls (`^server fetchUser()`) — runtime by definition.
 *   - No `Date.now()`, `Math.random()`, `Bun.*`, `process.*`, no I/O.
 *   - No identifiers outside the const-bound set in `env`.
 *
 * Identifier resolution: only identifiers explicitly registered in
 * `env.constBindings` are admissible. Any other identifier (including
 * built-in JS globals like `JSON`, `Object`) returns `runtime`.
 *
 * ## What this primitive handles
 *
 *   - Literals: number / string / template / bool / null / undefined / not.
 *   - Unary: `!`, `-`, `+`, `~`, prefix only. (Postfix `++` / `--` mutates,
 *     therefore non-constant.)
 *   - Binary: arithmetic, comparison, logical, `??`, `is`/`is-not`/
 *     `is-some`/`is-not-not` (scrml absence semantics per §42).
 *   - Ternary: `cond ? a : b` — short-circuits on constant `cond`.
 *   - Array / object literals: lifted to constant when every element /
 *     property value is constant.
 *   - Member access: `obj.prop` on a constant object → constant property
 *     value (when present); otherwise `undefined` (matches JS semantics).
 *   - Optional chaining: `obj?.prop` / `obj?.[idx]` — short-circuits on
 *     null/undefined receiver to `undefined`.
 *   - Index access: `arr[idx]` on constant receiver + constant numeric
 *     index → the element. Out-of-bounds → `undefined` (JS semantics).
 *
 * ## What this primitive REFUSES (returns runtime)
 *
 *   - Reactive identifiers (`@var`, `~var`).
 *   - Call expressions (any kind — would require a function table).
 *   - Assignment / compound-assignment (mutation).
 *   - Cast / match / SQL-ref / input-state-ref / lambda / new / spread /
 *     escape-hatch — all out-of-subset.
 *   - Identifiers not in `env.constBindings`.
 *
 * Cross-references:
 *   - SPEC.md §40.9.2 — Component 1's normative dependency on this pass.
 *   - SPEC.md §22 — Meta blocks; the determinism policy the primitive
 *     mirrors.
 *   - SPEC.md §42 — `not` / `is not` / `is some` absence semantics.
 *   - SPEC.md §45 — `==` / `!=` structural equality on primitives.
 *   - docs/changes/a2-reachability-solver-scoping/SCOPING.md §OQ-A2-D —
 *     disposition rationale.
 */

import type { ExprNode } from "../types/ast.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The closed set of values the primitive can produce.
 *
 * Compound shapes (array / object) are admissible; the receiver of a
 * member access or index access may itself be a constant array / object.
 * The primitive does not recurse into nested ExprNodes after the top-
 * level evaluation completes; intermediate values are plain JS values.
 */
export type ConstValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ConstValue[]
  | { [key: string]: ConstValue };

/**
 * Result of one `partiallyEvaluateExpr` invocation.
 *
 * - `constant` — the expression collapsed to a single JS value statically.
 * - `runtime`  — the expression depends on runtime state (reactive cell,
 *                server-fn call, unknown identifier, mutating op, etc.).
 *
 * Callers SHALL NOT depend on the `value` of a runtime result; the
 * union discriminator is the only authoritative signal.
 */
export type ConstResult =
  | { kind: "constant"; value: ConstValue }
  | { kind: "runtime" };

/**
 * The const-binding table passed to the primitive.
 *
 * `constBindings` is a string-keyed map of identifier name to value.
 * The identifier name is the source-text form (no `@`, no `~`).
 *
 * Component 1 populates this from the file's top-level `const`-decl
 * nodes whose initializers are themselves constant (a one-step fixed
 * point — Component 1 does NOT recursively fold the const file scope
 * at this wave; that is a §22 concern).
 *
 * The `allowNot` flag controls whether the scrml `not` keyword folds
 * to `null` (the §42 absence value). Default true.
 */
export interface ConstFoldEnv {
  constBindings: Map<string, ConstValue>;
  /** Default true. Controls §42 `not` / `is not` evaluation. */
  allowNot?: boolean;
}

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

const RUNTIME: ConstResult = { kind: "runtime" };

function constant(value: ConstValue): ConstResult {
  return { kind: "constant", value };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Partially evaluate an `ExprNode` under a const-binding environment.
 *
 * Returns `{ kind: "constant", value }` when the expression collapses to
 * a single static JS value; returns `{ kind: "runtime" }` otherwise.
 *
 * **Pure:** does not mutate `ast` or `env`. Never throws — any internal
 * exception is caught and returned as `runtime` (defensive).
 *
 * **Conservative:** prefers `runtime` over a speculative `constant`. The
 * §40.9.2 worst-case-union admission absorbs the over-inclusion.
 */
export function partiallyEvaluateExpr(
  ast: ExprNode,
  env: ConstFoldEnv,
): ConstResult {
  try {
    return foldExpr(ast, env);
  } catch {
    return RUNTIME;
  }
}

// ---------------------------------------------------------------------------
// Recursive folder
// ---------------------------------------------------------------------------

function foldExpr(node: ExprNode, env: ConstFoldEnv): ConstResult {
  switch (node.kind) {
    // ---------------------------------------------------------------- literal
    case "lit": {
      switch (node.litType) {
        case "template":
          // S441 round 4 (#4) — an INTERPOLATED template literal's `value` is
          // not its value (the expression layer leaves it "" — the `${…}`
          // parts are not folded), so folding it rendered `const msg =
          // \`total is ${n + 1} units\`` + `${msg}` as an EMPTY string with no
          // runtime binding. Only a plain (no-`${}`) template is a constant.
          if ((node as { hasInterpolation?: boolean }).hasInterpolation === true) return RUNTIME;
          return constant(node.value as ConstValue);
        case "number":
        case "string":
        case "bool":
          // `value` is already the parsed primitive.
          return constant(node.value as ConstValue);
        case "null":
          return constant(null);
        case "undefined":
          return constant(undefined);
        case "not":
          // §42 — `not` is the absence value, compiles to null.
          if (env.allowNot === false) return RUNTIME;
          return constant(null);
        default:
          return RUNTIME;
      }
    }

    // -------------------------------------------------------------- identifier
    case "ident": {
      // Reactive (`@x`) and linear (`~x`) refs are runtime by definition.
      if (node.name.startsWith("@") || node.name === "~") return RUNTIME;
      if (env.constBindings.has(node.name)) {
        return constant(env.constBindings.get(node.name)!);
      }
      return RUNTIME;
    }

    // ----------------------------------------------------------- array literal
    case "array": {
      const out: ConstValue[] = [];
      for (const el of node.elements) {
        // Spread is rejected — would require iterable-spreading a constant array.
        if (el.kind === "spread") return RUNTIME;
        const r = foldExpr(el, env);
        if (r.kind === "runtime") return RUNTIME;
        out.push(r.value);
      }
      return constant(out);
    }

    // ---------------------------------------------------------- object literal
    case "object": {
      const out: { [k: string]: ConstValue } = {};
      for (const prop of node.props) {
        if (prop.kind === "spread") return RUNTIME;
        if (prop.kind === "shorthand") {
          if (!env.constBindings.has(prop.name)) return RUNTIME;
          out[prop.name] = env.constBindings.get(prop.name)!;
          continue;
        }
        // prop.kind === "prop"
        let keyName: string;
        if (typeof prop.key === "string") {
          keyName = prop.key;
        } else {
          // Computed key — must itself fold to a string / number.
          if (prop.computed) {
            const kr = foldExpr(prop.key, env);
            if (kr.kind === "runtime") return RUNTIME;
            if (typeof kr.value !== "string" && typeof kr.value !== "number") {
              return RUNTIME;
            }
            keyName = String(kr.value);
          } else {
            return RUNTIME;
          }
        }
        const vr = foldExpr(prop.value, env);
        if (vr.kind === "runtime") return RUNTIME;
        out[keyName] = vr.value;
      }
      return constant(out);
    }

    // ----------------------------------------------------------------- unary
    case "unary": {
      if (!node.prefix) return RUNTIME; // postfix ++/-- mutates.
      // Forbidden ops at compile-time per §22.
      if (
        node.op === "typeof" ||
        node.op === "void" ||
        node.op === "delete" ||
        node.op === "await" ||
        node.op === "++" ||
        node.op === "--"
      ) {
        return RUNTIME;
      }
      const arg = foldExpr(node.argument, env);
      if (arg.kind === "runtime") return RUNTIME;
      switch (node.op) {
        case "!":
          return constant(!arg.value);
        case "-":
          if (typeof arg.value !== "number") return RUNTIME;
          return constant(-arg.value);
        case "+":
          if (typeof arg.value !== "number") return RUNTIME;
          return constant(+arg.value);
        case "~":
          if (typeof arg.value !== "number") return RUNTIME;
          return constant(~arg.value);
        default:
          return RUNTIME;
      }
    }

    // ---------------------------------------------------------------- binary
    case "binary": {
      // Short-circuiting must precede left-then-right evaluation.
      if (node.op === "&&") {
        const left = foldExpr(node.left, env);
        if (left.kind === "runtime") return RUNTIME;
        if (!left.value) return constant(left.value);
        return foldExpr(node.right, env);
      }
      if (node.op === "||") {
        const left = foldExpr(node.left, env);
        if (left.kind === "runtime") return RUNTIME;
        if (left.value) return constant(left.value);
        return foldExpr(node.right, env);
      }
      if (node.op === "??") {
        const left = foldExpr(node.left, env);
        if (left.kind === "runtime") return RUNTIME;
        if (left.value !== null && left.value !== undefined) {
          return constant(left.value);
        }
        return foldExpr(node.right, env);
      }

      // §42 absence operators — right side is a pattern.
      if (node.op === "is-not" || node.op === "is-some" || node.op === "is-not-not") {
        const left = foldExpr(node.left, env);
        if (left.kind === "runtime") return RUNTIME;
        const isAbsent = left.value === null || left.value === undefined;
        if (node.op === "is-not") return constant(isAbsent);
        // both `is-some` and `is-not-not` are presence checks.
        return constant(!isAbsent);
      }

      if (node.op === "is") {
        // `x is .Variant` — enum membership. Without a typed enum table
        // the primitive cannot resolve `.Variant`; runtime.
        return RUNTIME;
      }

      if (node.op === "in" || node.op === "instanceof") {
        // `instanceof` needs a class table; `in` needs prop-existence
        // semantics that are JS-engine-specific. Out of subset.
        return RUNTIME;
      }

      const left = foldExpr(node.left, env);
      if (left.kind === "runtime") return RUNTIME;
      const right = foldExpr(node.right, env);
      if (right.kind === "runtime") return RUNTIME;

      switch (node.op) {
        case "+": {
          // Number + number OR string + string (no mixed coercion at compile time).
          if (typeof left.value === "number" && typeof right.value === "number") {
            return constant(left.value + right.value);
          }
          if (typeof left.value === "string" && typeof right.value === "string") {
            return constant(left.value + right.value);
          }
          return RUNTIME;
        }
        case "-":
        case "*":
        case "/":
        case "%":
        case "**": {
          if (typeof left.value !== "number" || typeof right.value !== "number") {
            return RUNTIME;
          }
          switch (node.op) {
            case "-": return constant(left.value - right.value);
            case "*": return constant(left.value * right.value);
            case "/": return constant(left.value / right.value);
            case "%": return constant(left.value % right.value);
            case "**": return constant(left.value ** right.value);
          }
          return RUNTIME;
        }
        case "==":
        case "!=": {
          // §45 — scrml `==` is structural equality on primitives. For
          // primitives this matches `===` in JS. For object/array
          // operands we refuse to fold (would need structural compare).
          if (isPrimitive(left.value) && isPrimitive(right.value)) {
            const eq = left.value === right.value;
            return constant(node.op === "==" ? eq : !eq);
          }
          return RUNTIME;
        }
        case "<":
        case "<=":
        case ">":
        case ">=": {
          if (
            (typeof left.value !== "number" || typeof right.value !== "number") &&
            (typeof left.value !== "string" || typeof right.value !== "string")
          ) {
            return RUNTIME;
          }
          switch (node.op) {
            case "<": return constant((left.value as number) < (right.value as number));
            case "<=": return constant((left.value as number) <= (right.value as number));
            case ">": return constant((left.value as number) > (right.value as number));
            case ">=": return constant((left.value as number) >= (right.value as number));
          }
          return RUNTIME;
        }
        case "&":
        case "|":
        case "^":
        case "<<":
        case ">>":
        case ">>>": {
          if (typeof left.value !== "number" || typeof right.value !== "number") {
            return RUNTIME;
          }
          switch (node.op) {
            case "&": return constant(left.value & right.value);
            case "|": return constant(left.value | right.value);
            case "^": return constant(left.value ^ right.value);
            case "<<": return constant(left.value << right.value);
            case ">>": return constant(left.value >> right.value);
            case ">>>": return constant(left.value >>> right.value);
          }
          return RUNTIME;
        }
        default:
          return RUNTIME;
      }
    }

    // --------------------------------------------------------------- ternary
    case "ternary": {
      const cond = foldExpr(node.condition, env);
      if (cond.kind === "runtime") return RUNTIME;
      return foldExpr(cond.value ? node.consequent : node.alternate, env);
    }

    // ---------------------------------------------------------------- member
    case "member": {
      const obj = foldExpr(node.object, env);
      if (obj.kind === "runtime") return RUNTIME;
      if (node.optional && (obj.value === null || obj.value === undefined)) {
        return constant(undefined);
      }
      if (obj.value === null || obj.value === undefined) {
        // Non-optional access on absent receiver — JS throws; refuse to
        // fold deterministically.
        return RUNTIME;
      }
      if (typeof obj.value !== "object") return RUNTIME;
      const rec = obj.value as Record<string, ConstValue>;
      // Bracketed `in`-check guards against prototype walks.
      if (Object.prototype.hasOwnProperty.call(rec, node.property)) {
        return constant(rec[node.property]);
      }
      return constant(undefined);
    }

    // ----------------------------------------------------------------- index
    case "index": {
      const obj = foldExpr(node.object, env);
      if (obj.kind === "runtime") return RUNTIME;
      const idx = foldExpr(node.index, env);
      if (idx.kind === "runtime") return RUNTIME;
      if (node.optional && (obj.value === null || obj.value === undefined)) {
        return constant(undefined);
      }
      if (obj.value === null || obj.value === undefined) return RUNTIME;
      if (Array.isArray(obj.value)) {
        if (typeof idx.value !== "number") return RUNTIME;
        if (!Number.isInteger(idx.value) || idx.value < 0) {
          return constant(undefined);
        }
        if (idx.value >= obj.value.length) return constant(undefined);
        return constant(obj.value[idx.value]);
      }
      if (typeof obj.value === "object") {
        if (typeof idx.value !== "string" && typeof idx.value !== "number") {
          return RUNTIME;
        }
        const key = String(idx.value);
        const rec = obj.value as Record<string, ConstValue>;
        if (Object.prototype.hasOwnProperty.call(rec, key)) {
          return constant(rec[key]);
        }
        return constant(undefined);
      }
      if (typeof obj.value === "string") {
        if (typeof idx.value !== "number") return RUNTIME;
        if (!Number.isInteger(idx.value) || idx.value < 0) {
          return constant(undefined);
        }
        const ch = obj.value[idx.value];
        return constant(ch === undefined ? undefined : ch);
      }
      return RUNTIME;
    }

    // ----------------------------------------------------- explicit runtime
    // Call / new / assign / cast / match / sql-ref / input-state-ref /
    // lambda / spread / escape-hatch — all out-of-subset.
    case "call":
    case "new":
    case "assign":
    case "cast":
    case "match":
    case "sql-ref":
    case "input-state-ref":
    case "escape-hatch":
    case "lambda":
    case "spread":
      return RUNTIME;

    default:
      return RUNTIME;
  }
}

function isPrimitive(v: ConstValue): boolean {
  return (
    v === null ||
    v === undefined ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}
