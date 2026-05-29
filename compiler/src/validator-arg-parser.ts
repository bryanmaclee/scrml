/**
 * Validator-arg parser — Phase A1b Step B9.
 *
 * Sub-grammar parser for the `args` field on `ValidatorEntry` records produced
 * by Step 5 (`compiler/src/ast-builder.js:scanStructuralDeclLookahead`). Step 5
 * stores call-form args as a single-element array of joined raw text:
 *
 *   `<userName req length(>=2)>`            → args: [">= 2"]
 *   `<email pattern(/^[^@]+@[^@]+$/)>`      → args: ["/^[^@]+@[^@]+$/"]
 *   `<role oneOf([.Admin, .Editor])>`       → args: ["[ .Admin , .Editor ]"]
 *   `<confirm eq(@signup.password)>`        → args: ["@signup.password"]
 *   `<age min(18)>`                         → args: ["18"]
 *
 * B9 transforms each raw-text arg into a structured node:
 *   - For `length(...)`: a `RelationalPredicateNode` carrying op + threshold expr.
 *   - For everything else: an `ExprNode` parsed via the standard expression parser.
 *
 * Per audit §1.2 (Option A, recommended): RelationalPredicateNode is a
 * sibling AST kind — NOT in the ExprNode discriminated union — so the
 * existing ExprNode walkers (lin tracking, dep-graph, etc.) don't see a
 * surprise new variant they aren't prepared for. The dep-graph walker
 * `forEachIdentInExprNode` IS extended (see expression-parser.ts) to
 * recognise relational-predicate nodes inside walks initiated on validator
 * args, traversing `value` so cross-field reactive-cell tracking
 * (§55.11 worked example: `<confirm eq(@signup.password)>`) works
 * transitively.
 *
 * Per audit §1.5 (preserve null vs []): args:null and args:[] arrive
 * untouched — only non-empty raw-text arrays are transformed.
 *
 * @module validator-arg-parser
 */

import type { ExprNode, ExprSpan, IdentExpr, RelationalPredicateNode, ValidatorArg, ValidatorEntry, Span } from "./types/ast.ts";
import { forEachIdentInExprNode, parseExprToNode } from "./expression-parser.ts";

/**
 * Predicate names that take a relational-predicate argument (per §55.1).
 *
 * Currently only `length` is observed in the spec worked examples. If §55 is
 * ever extended to admit relational predicates on additional predicates, add
 * the names here. (`min`/`max`/`gt`/`lt`/etc. take expression args, NOT
 * relational-predicate args — `<age min(18)>` is min-against-literal-18,
 * not min-against-relational-predicate.)
 */
const RELATIONAL_PREDICATE_HOSTS = new Set<string>(["length"]);

/**
 * The closed set of relational operators recognised in
 * `length(<rel-op> <expr>)`. Order matters: 2-char ops MUST be tried before
 * 1-char ops to avoid `>=` being parsed as `>`. Per audit §1.2.
 */
const REL_OPS_BY_LENGTH = [
  // 2-char ops first
  ">=", "<=", "!=",
  // 1-char ops
  ">", "<", "=",
] as const;

/**
 * True when `text` (after trim) begins with a relational operator from
 * REL_OPS_BY_LENGTH. Used (C1, R27) to disambiguate a trailing `length(...)`
 * slot: a relational-op-leading slot is a SECOND bound (`length(>=N, <=M)`);
 * anything else is the §55.10 inline message override (a string literal).
 */
function startsWithRelationalOp(text: string): boolean {
  const t = text.trimStart();
  return REL_OPS_BY_LENGTH.some((op) => t.startsWith(op));
}

type RelOp = (typeof REL_OPS_BY_LENGTH)[number];

/**
 * Parse a single raw-text validator argument into a structured node.
 *
 * Dispatches on `predicateName` + `slotIndex` to select between
 * relational-predicate parsing (for the FIRST arg of `length(...)`) and
 * standard expression parsing (everything else, including subsequent
 * inline-override slots on `length(...)`).
 *
 * Never throws; on parse failure the standard expression parser returns an
 * escape-hatch ExprNode and the relational-form failure path returns an
 * escape-hatch ExprNode (so B10/B13 can surface a structured error if they
 * care).
 *
 * Phase A1b Step B13 — `slotIndex` parameter added so multi-arg call-form
 * validators (`length(>=2, "too short")` per §55.10 inline-override) parse
 * each slot under its correct sub-grammar. Pre-B13 a single joined arg was
 * always passed as slot 0 — B13 splits on top-level commas in the
 * ast-builder collector and dispatches per-slot here.
 *
 * @param predicateName  The validator name (e.g. `"length"`, `"eq"`, `"min"`).
 * @param rawArg         The raw arg-text (joined with single spaces by Step 5).
 * @param argSpan        Source span of the arg region (Step 5 emits one).
 * @param filePath       File path for error reporting.
 * @param argOffset      Byte offset of the arg within the source file.
 * @param slotIndex      Zero-based positional index of this arg in the
 *                       call-form arg list. Defaults to 0 for back-compat
 *                       with pre-B13 single-arg callers.
 *
 * @returns A `ValidatorArg` (ExprNode or RelationalPredicateNode).
 */
export function parseValidatorArg(
  predicateName: string,
  rawArg: string,
  argSpan: Span,
  filePath: string,
  argOffset: number,
  slotIndex: number = 0,
): ValidatorArg {
  const trimmed = (rawArg ?? "").trim();
  const span = spanOfArg(argSpan, filePath);

  // Empty arg-text — should not occur (Step 5 stores `args:[]` for zero-arg
  // call form); but defensive: emit an escape-hatch ExprNode.
  if (trimmed.length === 0) {
    return makeEscapeHatch(span, "EmptyValidatorArg", "");
  }

  // Relational form on `length(...)`. The LEADING slot is always relational
  // (`length(>=2)`). Trailing slots disambiguate by shape (C1, R27):
  //   - a slot that STARTS WITH A RELATIONAL OPERATOR is a SECOND bound —
  //     the canonical two-bound range form `length(>=N, <=M)` (SPEC §55.1
  //     worked example line 20219; §55.4 schema worked example). Both bounds
  //     are AND-composed (emit-validators fires one `length` block per bound).
  //   - any other trailing slot is the Level-1 inline message override
  //     (`length(>=2, "Name must be at least 2 chars")`, SPEC §55.10) — a
  //     static string literal, parsed as a standard expression.
  // The disambiguation is unambiguous: inline-override messages are always
  // quoted string literals, never relational expressions.
  if (RELATIONAL_PREDICATE_HOSTS.has(predicateName)) {
    if (slotIndex === 0 || startsWithRelationalOp(trimmed)) {
      return parseRelationalPredicate(trimmed, span, filePath, argOffset);
    }
  }

  // Standard expression form. Delegates to the existing expression-parser.
  // Bare-dot variants `.Variant` (S66 fix) and @-prefix idents (`@signup.x`)
  // are already supported. Regex literals `/.../` fall to escape-hatch with
  // raw text preserved; B10 handles regex specially via the raw text.
  return parseExprToNode(trimmed, filePath, argOffset);
}

/**
 * Parse the `<rel-op> <expr>` form (for `length(>=2)`-style args).
 *
 * Strategy:
 *   1. Try each operator in REL_OPS_BY_LENGTH (2-char first to avoid `>=` →
 *      `>`).
 *   2. If the trimmed text starts with the op, peel it off, parse the
 *      remainder as a standard expression, and wrap in a
 *      RelationalPredicateNode.
 *   3. If no op matches, emit a structured escape-hatch ExprNode (B10 will
 *      surface a typed error). Per audit guidance — never throw.
 */
function parseRelationalPredicate(
  trimmed: string,
  span: ExprSpan,
  filePath: string,
  argOffset: number,
): ValidatorArg {
  for (const op of REL_OPS_BY_LENGTH) {
    if (trimmed.startsWith(op)) {
      const rest = trimmed.slice(op.length).trim();
      if (rest.length === 0) {
        // Operator with no RHS — surface as escape-hatch.
        return makeEscapeHatch(span, "RelationalPredicateNoRhs", trimmed);
      }
      // Parse the threshold expression. The offset is approximate — the
      // arg text was joined-with-spaces from token texts by Step 5, so
      // exact byte-offsets within rawArg may differ from source. We
      // compute a best-effort offset (argOffset + leading-op-skip).
      const restOffset = argOffset + op.length + (trimmed.length - trimmed.trimStart().length);
      const valueExpr = parseExprToNode(rest, filePath, restOffset);
      return {
        kind: "relational-predicate",
        span,
        op: op as RelOp,
        value: valueExpr,
      } satisfies RelationalPredicateNode;
    }
  }
  // No relational operator matched. Per audit §1.2, the spec's
  // `length(predicate)` worked examples are all relational. If a non-rel
  // arg appears (e.g. `length(req)`), we surface escape-hatch — B10 owns
  // the typed error.
  return makeEscapeHatch(span, "RelationalPredicateNoOp", trimmed);
}

/**
 * Translate the Step-5 Span into the ExprSpan shape used throughout the
 * expression-parser. They are structurally identical — this just re-types.
 * If `span` is missing/malformed, falls back to a minimal ExprSpan keyed off
 * `filePath`.
 */
function spanOfArg(span: Span | undefined, filePath: string): ExprSpan {
  if (span && typeof span.start === "number" && typeof span.end === "number") {
    return {
      file: span.file ?? filePath,
      start: span.start,
      end: span.end,
      line: span.line ?? 1,
      col: span.col ?? 1,
    };
  }
  return { file: filePath, start: 0, end: 0, line: 1, col: 1 };
}

/**
 * Build an EscapeHatch ExprNode for malformed validator-arg cases. Keeps the
 * raw text accessible to B10 / future error-reporting passes.
 */
function makeEscapeHatch(span: ExprSpan, nativeKind: string, raw: string): ExprNode {
  return {
    kind: "escape-hatch",
    span,
    nativeKind,
    raw,
  } as ExprNode;
}

/**
 * Walk a single ValidatorArg and invoke `callback` for every IdentExpr found.
 *
 * Dispatches on the arg's `kind`:
 *   - `relational-predicate` → recurse into `value` via forEachIdentInExprNode.
 *   - everything else (standard ExprNode kinds) → forEachIdentInExprNode.
 *
 * This is the integration seam for B7's dep-graph: callers walking
 * `validators[].args` get the same identifier-stream they get from any
 * other ExprNode-bearing field, without the dep-graph code needing to
 * know about the validator-args asymmetry.
 */
export function forEachIdentInValidatorArg(
  arg: ValidatorArg,
  callback: (ident: IdentExpr) => void,
): void {
  if (!arg) return;
  if ((arg as RelationalPredicateNode).kind === "relational-predicate") {
    const rp = arg as RelationalPredicateNode;
    forEachIdentInExprNode(rp.value, callback);
    return;
  }
  forEachIdentInExprNode(arg as ExprNode, callback);
}

/**
 * Walk every ValidatorArg in a validators list, invoking `callback` for each
 * IdentExpr. Bareword (`args:null`) and zero-arg (`args:[]`) entries are
 * skipped automatically.
 *
 * This is the convenience entry-point B10 (validator type-checking) and any
 * future dep-graph integration call to collect cross-field references like
 * `eq(@signup.password)` and `gte(@startDate.plus(1, "day"))`. Per
 * §55.11 worked example: cross-field reactive recompute follows from
 * walking these identifiers.
 */
export function forEachIdentInValidators(
  validators: ValidatorEntry[] | null | undefined,
  callback: (ident: IdentExpr) => void,
): void {
  if (!Array.isArray(validators)) return;
  for (const v of validators) {
    if (!Array.isArray(v.args) || v.args.length === 0) continue;
    for (const arg of v.args) {
      forEachIdentInValidatorArg(arg, callback);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase A1c Step C9 — qualified cell-reference extractor
// ---------------------------------------------------------------------------

/**
 * Walk an ExprNode tree and invoke `callback` for every `@`-rooted reactive
 * cell reference, yielding the FULLY QUALIFIED path (e.g., `"signup.password"`).
 *
 * Why this exists (Phase A1c Step C9, SPEC §55.11 cross-field validation):
 *
 * The standard `forEachIdentInExprNode` walker treats `MemberExpr` by walking
 * the `object` only. So `@signup.password` (which the real parser produces as
 * `MemberExpr(IdentExpr("@signup"), "password")`) yields the BASE ident
 * `@signup` — losing the `.password` qualifier. That is correct for general
 * reactive-dep tracking (`obj.foo + bar` should track `obj`, not `obj.foo`),
 * but for `@-prefixed` cell references the fully qualified path IS the
 * reactive cell name (compound child cells are stored under the qualified
 * key `"signup.password"` in `_scrml_state` — see emit-logic.ts compound
 * emission).
 *
 * This walker recognizes both forms:
 *   - `IdentExpr("@X")` standalone               → callback("X")
 *   - `MemberExpr(IdentExpr("@X"), "Y")` chain    → callback("X.Y")
 *   - `MemberExpr(MemberExpr(...@X.Y), "Z")` chain → callback("X.Y.Z")
 *
 * Other ExprNode shapes are walked normally and yield qualified paths for
 * any `@-rooted` chains they contain. Examples:
 *   - `gte(@startDate)` → "startDate"
 *   - `eq(@signup.password)` → "signup.password"
 *   - `lt(@maxAge - 1)` (binary) → "maxAge"
 *   - `oneOf([@form.allowed, @form.altAllowed])` (array) → "form.allowed", "form.altAllowed"
 *   - `gte(@form.startDate.plus(1, "day"))` (call on member chain): the
 *     chain's CALL is NOT a cell ref — the receiver chain `@form.startDate`
 *     IS. Yields "form.startDate" only (the property `.plus(...)` is a
 *     METHOD call, not a cell-name suffix).
 *
 * Detection rule for the chain: walk down `member.object` repeatedly until
 * either (a) we land on an `@`-prefixed `IdentExpr` — then the full
 * @-stem-plus-collected-properties is the qualified path, OR (b) we land on
 * something else (literal, call, etc.) — the chain is not @-rooted, so the
 * normal walker behavior applies (descend into pieces).
 *
 * Special distinction for member-as-call-callee: a `CallExpr` with a member
 * chain callee like `@form.startDate.plus(1, "day")` is NOT a cell-reference —
 * the LAST property (`.plus`) is the method name, NOT a cell-name suffix.
 * To distinguish, we only collapse the chain into a qualified path when the
 * MemberExpr is NOT being used as a CallExpr callee (the callsite ensures
 * this by descending into call.callee separately and stopping the chain at
 * the next-to-last segment).
 *
 * The callsite is responsible for picking which version of the dep it wants:
 *   - emit-validators.ts uses `forEachQualifiedCellRefInValidatorArg` for
 *     `_scrml_derived_subscribe` keys (precision: subscribe to the exact cell).
 *   - The thunk-emission path uses the qualified-path read directly via
 *     `_scrml_reactive_get("X.Y")`.
 *
 * This helper is INDEPENDENT of `forEachIdentInExprNode`: it does its own
 * AST walk, recognizing the chain pattern and falling back to the same kind-
 * dispatch for everything else. This keeps `forEachIdentInExprNode`'s
 * semantics stable (general-purpose walks expect base-ident-only behavior).
 *
 * @param node      The ExprNode (or RelationalPredicateNode) to walk.
 * @param callback  Invoked once per @-rooted cell ref with the qualified path.
 */
export function forEachQualifiedCellRefInExprNode(
  node: unknown,
  callback: (qualifiedPath: string) => void,
): void {
  walkForQualifiedCellRefs(node, callback);
}

/**
 * Internal recursive walker for `forEachQualifiedCellRefInExprNode`. Handles
 * the "is this the @-rooted chain?" check and descent into sub-expressions.
 */
function walkForQualifiedCellRefs(
  node: unknown,
  callback: (qualifiedPath: string) => void,
): void {
  if (!node || typeof node !== "object") return;
  const n = node as { kind?: string };

  // RelationalPredicateNode — recurse into `value`.
  if (n.kind === "relational-predicate") {
    walkForQualifiedCellRefs((node as RelationalPredicateNode).value, callback);
    return;
  }

  // The @-rooted-chain detector: try to lift this node as a qualified path.
  // If the node itself IS a member-chain rooted at an @-ident OR a bare
  // @-ident, emit the path and stop (no further descent needed for this
  // sub-tree — the chain is the entire cell ref).
  const lifted = liftAtRootedChain(node);
  if (lifted !== null) {
    callback(lifted);
    return;
  }

  // Not a cell-reference chain — descend into structural sub-nodes by kind.
  switch (n.kind) {
    case "ident":
    case "lit":
    case "sql-ref":
    case "input-state-ref":
    case "escape-hatch":
      // Leaves (no sub-expressions to walk) — including idents not @-prefixed
      // (those don't represent cell refs). Note: an @-prefixed standalone
      // ident WOULD have been caught by `liftAtRootedChain`, so reaching here
      // for `kind === "ident"` means non-@ ident; nothing to do.
      return;

    case "array": {
      const a = node as { elements: unknown[] };
      for (const el of a.elements) walkForQualifiedCellRefs(el, callback);
      return;
    }

    case "object": {
      const o = node as { props: Array<{ kind: string; key?: unknown; value?: unknown; argument?: unknown; name?: string; span?: unknown }> };
      for (const prop of o.props) {
        if (prop.kind === "prop") {
          if (typeof prop.key !== "string") walkForQualifiedCellRefs(prop.key, callback);
          walkForQualifiedCellRefs(prop.value, callback);
        } else if (prop.kind === "shorthand") {
          // shorthand: `{ x }` — `x` is a binding reference. If `x` starts
          // with `@`, treat as a top-level cell ref (same as the @-ident
          // fast-path).
          if (typeof prop.name === "string" && prop.name.startsWith("@")) {
            callback(prop.name.slice(1));
          }
        } else if (prop.kind === "spread") {
          walkForQualifiedCellRefs(prop.argument, callback);
        }
      }
      return;
    }

    case "spread":
    case "unary":
      walkForQualifiedCellRefs((node as { argument: unknown }).argument, callback);
      return;

    case "binary":
    case "assign": {
      const b = node as { left?: unknown; right?: unknown; target?: unknown; value?: unknown };
      walkForQualifiedCellRefs(b.left ?? b.target, callback);
      walkForQualifiedCellRefs(b.right ?? b.value, callback);
      return;
    }

    case "ternary": {
      const t = node as { condition: unknown; consequent: unknown; alternate: unknown };
      walkForQualifiedCellRefs(t.condition, callback);
      walkForQualifiedCellRefs(t.consequent, callback);
      walkForQualifiedCellRefs(t.alternate, callback);
      return;
    }

    case "member": {
      // Member chain that is NOT @-rooted (or `liftAtRootedChain` would have
      // caught it). Walk the object only — same semantics as
      // `forEachIdentInExprNode`'s member case.
      walkForQualifiedCellRefs((node as { object: unknown }).object, callback);
      return;
    }

    case "index": {
      // `obj[idx]` — walk both. Computed keys may contain @-rooted refs.
      const i = node as { object: unknown; index: unknown };
      walkForQualifiedCellRefs(i.object, callback);
      walkForQualifiedCellRefs(i.index, callback);
      return;
    }

    case "call":
    case "new": {
      // For a call/new whose CALLEE is `@cell.method(...)`, the receiver
      // chain `@cell` (or `@compound.field`) IS a cell-ref but the trailing
      // `.method` segment is NOT. We extract the receiver chain (= the
      // callee's `object` if member, the callee itself if ident), then walk
      // args separately. Example: `@form.startDate.plus(1, "day")` — callee
      // is `MemberExpr(MemberExpr(@form, startDate), plus)`. Lift the
      // receiver chain `@form.startDate` (exclude the trailing `.plus`).
      const c = node as { callee: unknown; args: unknown[] };
      const calleeReceiver = stripTrailingMethodOff(c.callee);
      walkForQualifiedCellRefs(calleeReceiver, callback);
      for (const arg of c.args ?? []) walkForQualifiedCellRefs(arg, callback);
      return;
    }
  }
}

/**
 * If `node` is `IdentExpr("@X")` OR `MemberExpr` whose chain bottoms out at
 * an `@`-prefixed `IdentExpr`, return the fully qualified path string
 * (e.g., `"signup.password"`). Otherwise return null.
 *
 * Examples:
 *   - `IdentExpr("@startDate")` → `"startDate"`
 *   - `MemberExpr(IdentExpr("@signup"), "password")` → `"signup.password"`
 *   - `MemberExpr(MemberExpr(IdentExpr("@a"), "b"), "c")` → `"a.b.c"`
 *   - `IdentExpr("foo")` (no @ prefix) → null
 *   - `MemberExpr(LitExpr, "x")` (non-ident root) → null
 *   - `MemberExpr(IdentExpr("@a"), index-expr)` (computed) — N/A; this is
 *     `IndexExpr` not `MemberExpr`, returns null.
 */
function liftAtRootedChain(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const kind = (node as { kind?: string }).kind;

  if (kind === "ident") {
    const name = (node as { name?: unknown }).name;
    if (typeof name === "string" && name.startsWith("@")) {
      return name.slice(1);
    }
    return null;
  }

  if (kind === "member") {
    // Walk down the member chain collecting property names. The chain is
    // valid iff it bottoms out at an @-prefixed IdentExpr.
    const segments: string[] = [];
    let cursor: unknown = node;
    while (cursor && typeof cursor === "object" && (cursor as { kind?: string }).kind === "member") {
      const m = cursor as { object: unknown; property: unknown };
      if (typeof m.property !== "string") return null; // computed/non-static property — not a cell-ref
      segments.unshift(m.property);
      cursor = m.object;
    }
    // cursor should now be the leftmost non-member node — ideally an @-ident.
    if (
      cursor && typeof cursor === "object"
      && (cursor as { kind?: string }).kind === "ident"
    ) {
      const name = (cursor as { name?: unknown }).name;
      if (typeof name === "string" && name.startsWith("@")) {
        return [name.slice(1), ...segments].join(".");
      }
    }
    return null;
  }

  return null;
}

/**
 * For a CallExpr or NewExpr callee that is a member chain, return the
 * RECEIVER (i.e., the callee's `.object`) — that's the cell-ref half. The
 * trailing property (the method name) is NOT part of the cell-ref path.
 *
 * For an ident or non-member callee, return as-is — `liftAtRootedChain`
 * will yield null on a plain (non-@) ident, which is correct (function
 * calls aren't cell refs).
 *
 * Examples:
 *   - `@startDate.plus(1, "day")` callee is `MemberExpr(@startDate, "plus")`.
 *     Receiver is `IdentExpr("@startDate")` → liftable to `"startDate"`.
 *   - `@form.startDate.plus(1)` callee is `MemberExpr(MemberExpr(@form, startDate), plus)`.
 *     Receiver is `MemberExpr(@form, startDate)` → liftable to `"form.startDate"`.
 *   - `someFn(...)` callee is `IdentExpr("someFn")`. Receiver = same → not liftable.
 */
function stripTrailingMethodOff(callee: unknown): unknown {
  if (!callee || typeof callee !== "object") return callee;
  if ((callee as { kind?: string }).kind === "member") {
    return (callee as { object: unknown }).object;
  }
  return callee;
}

/**
 * Walk a single ValidatorArg and invoke `callback` for every @-rooted cell
 * reference, yielding the qualified path. Mirror of `forEachIdentInValidatorArg`
 * but at qualified-cell-ref granularity.
 *
 * Per Phase A1c Step C9 (cross-field deps refinement): callers that need to
 * subscribe to the EXACT cross-field cell (rather than the compound parent)
 * use this walker. Returns paths like `"signup.password"` instead of
 * `"signup"` (which is what `forEachIdentInValidatorArg` would yield via
 * the standard `forEachIdentInExprNode` member-base-only behavior).
 */
export function forEachQualifiedCellRefInValidatorArg(
  arg: ValidatorArg,
  callback: (qualifiedPath: string) => void,
): void {
  if (!arg) return;
  forEachQualifiedCellRefInExprNode(arg, callback);
}

/**
 * Walk every ValidatorArg in a validators list, invoking `callback` for each
 * qualified cell-ref. Bareword (`args:null`) and zero-arg (`args:[]`) entries
 * are skipped automatically. Mirror of `forEachIdentInValidators` at
 * qualified-cell-ref granularity (Phase A1c Step C9).
 */
export function forEachQualifiedCellRefInValidators(
  validators: ValidatorEntry[] | null | undefined,
  callback: (qualifiedPath: string) => void,
): void {
  if (!Array.isArray(validators)) return;
  for (const v of validators) {
    if (!Array.isArray(v.args) || v.args.length === 0) continue;
    for (const arg of v.args) {
      forEachQualifiedCellRefInValidatorArg(arg, callback);
    }
  }
}

/**
 * In-place transform helper: walk a `validators` list and replace each
 * non-empty `args` string-array with its parsed-structured-form. Bareword
 * (`args:null`) and zero-arg (`args:[]`) entries pass through untouched.
 *
 * Idempotent: if `args` is already structured (objects with `kind` field),
 * leaves it alone. Lets B9 wire be called repeatedly without double-parsing
 * during partial-build flows.
 *
 * @param validators  The ValidatorEntry array on a state-decl node. Mutated
 *                    in place. Returns the same reference for chaining.
 * @param filePath    File path for error reporting / span construction.
 */
export function decorateValidatorsWithExprNodes(
  validators: ValidatorEntry[] | null | undefined,
  filePath: string,
): ValidatorEntry[] | null | undefined {
  if (!Array.isArray(validators)) return validators;
  for (const v of validators) {
    if (v.args === null || v.args === undefined) continue;
    if (v.args.length === 0) continue;
    // Idempotency: skip if already structured.
    const first = v.args[0] as unknown;
    if (first && typeof first === "object" && (first as { kind?: string }).kind) continue;
    // Convert each raw-text element into a parsed ValidatorArg.
    //
    // Pre-B13: Step 5 produced single-element joined-raw arrays, so slotIndex
    // was always 0. Post-B13: ast-builder splits on top-level commas, so this
    // loop iterates one raw-text element per source-level arg slot.
    // `slotIndex` is forwarded so the relational-predicate sub-grammar fires
    // ONLY on slot 0 of `length(...)` — trailing inline-overrides
    // (per §55.10) parse as standard expressions.
    const parsed: ValidatorArg[] = [];
    const rawArgs = v.args as unknown as string[];
    for (let slotIndex = 0; slotIndex < rawArgs.length; slotIndex++) {
      const raw = rawArgs[slotIndex]!;
      const argOffset = v.span?.start ?? 0;
      parsed.push(
        parseValidatorArg(v.name, raw, v.span, filePath, argOffset, slotIndex),
      );
    }
    v.args = parsed;
  }
  return validators;
}
