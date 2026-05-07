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

type RelOp = (typeof REL_OPS_BY_LENGTH)[number];

/**
 * Parse a single raw-text validator argument into a structured node.
 *
 * Dispatches on `predicateName` to select between relational-predicate parsing
 * (for `length(...)`) and standard expression parsing (everything else). Never
 * throws; on parse failure the standard expression parser returns an
 * escape-hatch ExprNode and the relational-form failure path returns an
 * escape-hatch ExprNode (so B10 can surface a structured error if it cares).
 *
 * @param predicateName  The validator name (e.g. `"length"`, `"eq"`, `"min"`).
 * @param rawArg         The raw arg-text (joined with single spaces by Step 5).
 * @param argSpan        Source span of the arg region (Step 5 emits one).
 * @param filePath       File path for error reporting.
 * @param argOffset      Byte offset of the arg within the source file.
 *
 * @returns A `ValidatorArg` (ExprNode or RelationalPredicateNode).
 */
export function parseValidatorArg(
  predicateName: string,
  rawArg: string,
  argSpan: Span,
  filePath: string,
  argOffset: number,
): ValidatorArg {
  const trimmed = (rawArg ?? "").trim();
  const span = spanOfArg(argSpan, filePath);

  // Empty arg-text — should not occur (Step 5 stores `args:[]` for zero-arg
  // call form); but defensive: emit an escape-hatch ExprNode.
  if (trimmed.length === 0) {
    return makeEscapeHatch(span, "EmptyValidatorArg", "");
  }

  if (RELATIONAL_PREDICATE_HOSTS.has(predicateName)) {
    return parseRelationalPredicate(trimmed, span, filePath, argOffset);
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
function makeEscapeHatch(span: ExprSpan, estreeType: string, raw: string): ExprNode {
  return {
    kind: "escape-hatch",
    span,
    estreeType,
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
    // Convert each raw-text element into a parsed ValidatorArg. Step 5's
    // current behaviour produces a single-element array; this loop is
    // forward-compatible with future per-arg-split parsers.
    const parsed: ValidatorArg[] = [];
    for (const raw of v.args as unknown as string[]) {
      const argOffset = v.span?.start ?? 0;
      parsed.push(parseValidatorArg(v.name, raw, v.span, filePath, argOffset));
    }
    v.args = parsed;
  }
  return validators;
}
