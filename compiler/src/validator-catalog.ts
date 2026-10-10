/**
 * Phase A1b Step B10 — Validator predicate signature catalog.
 *
 * The single source of truth for the 14 universal-core validator predicates
 * per SPEC §55.1. Reusable across three loci (L4):
 *
 *   1. State-cell validators (§55.2) — Shape-2 decls with bare-attr predicates.
 *      Primary B10 consumer.
 *
 *   2. Refinement-type expressions (§55.3, §53) — `string(pattern(/.../))`,
 *      `number(min(0) && max(100))`. Same predicate names; same arg-type
 *      signatures. Different firing semantics (compile-time + runtime
 *      boundary). Future B21 consumer.
 *
 *   3. Schema columns (§55.4, §39) — `email: text req length(>=2)`. Same
 *      predicate names; same arg-type signatures. Different firing semantics
 *      (lowering to SQL DDL). The schema-differ module today operates on raw
 *      SQL types + NOT NULL/DEFAULT constraints; future unification with this
 *      catalog would let shared-core predicates lower through a single path.
 *
 * Cross-references:
 *   - SPEC §55.1 — universal-core vocabulary table (14 predicates)
 *   - SPEC §55.9 — `ValidationError` enum (per-predicate error tag)
 *   - SPEC §55.11 — cross-field validation via predicate args (§31.4 deps)
 *   - SPEC §34 — error catalog (E-TYPE-031 family for arg-type mismatch,
 *                E-VALIDATOR-CIRCULAR-DEP for cross-field cycles)
 *   - docs/audits/a1b-b10-rule4-audit-2026-05-07.md — pre-dispatch audit
 *   - docs/PA-SCRML-PRIMER.md §8 — primer correction (14 predicates, NOT 18)
 *
 * NOT in this catalog (per primer §8 + S66 audit):
 *   - `email`, `url`, `numeric`, `integer` — stdlib `scrml:data` predicate-
 *     builders (separate surface; library-level, not language-core)
 *   - `custom` — `ValidationError` enum tag at SPEC §55.9 line 24534, NOT a
 *     predicate
 *
 * Phase 1 (B10 step 1) lands the catalog as a standalone module. The walker
 * that consumes B9's parsed validator-arg ExprNodes joins in Phase 2.
 */

/**
 * What a predicate's argument is shaped like in source.
 *
 * `null` (for arity-0 bareword predicates `req`, `is given`) — no args at all.
 * Otherwise an array describing each positional argument.
 */
export type PredicateArgKind =
  /** A relational predicate `>=N`, `<=N`, `<N`, `>N`, `=N`, `!=N`. The B9
   *  parser produces a `RelationalPredicateNode` AST kind for this. Used by
   *  `length(>=2)` form. */
  | { kind: "relational-predicate" }
  /** A numeric literal or numeric-typed expression. Used by `min(n)`, `max(n)`. */
  | { kind: "numeric" }
  /** A regex literal. Used by `pattern(re)`. */
  | { kind: "regex" }
  /** An expression of the same type as the cell value, comparable via `<`, `>`.
   *  Used by `gt(expr)`, `lt(expr)`, `gte(expr)`, `lte(expr)`. */
  | { kind: "comparable-with-cell" }
  /** An expression of the same type as the cell value, comparable via `==`, `!=`.
   *  Strictly weaker than `comparable-with-cell` (booleans, structs, arrays
   *  qualify here but not for ordering). Used by `eq(expr)`, `neq(expr)`. */
  | { kind: "any-equatable-with-cell" }
  /** An array literal (or array-typed expression) whose element type matches
   *  the cell value type. Used by `oneOf([...])`, `notIn([...])`. */
  | { kind: "array-of-cell-type" }
  /** An optional trailing string-literal arg used as a Level-1 inline error
   *  message override per §55.10. Static-string only (L12 Edge F). When
   *  present, this is always the LAST positional arg. B13 extracts it. */
  | { kind: "inline-message-override" };

/**
 * What kinds of cell values a predicate may apply to.
 *
 * The compiler enforces predicate-vs-cell-type compatibility at validator
 * type-checking time per SPEC §55.1 line 24295 ("applying `pattern(re)` to a
 * `number` cell is a compile-time type error (E-TYPE-031 family)").
 *
 * `"any"` means the predicate applies to any cell type (e.g., `req`).
 */
export type CellTypeRequirement =
  | "any"
  /** String OR array (length is defined for both). For `length(...)`. */
  | "string-or-array"
  /** String only. For `pattern(re)`. */
  | "string"
  /** Numeric only. For `min(n)`, `max(n)`. */
  | "number"
  /** Orderable: number, string, or Date. For `gt`/`lt`/`gte`/`lte`. */
  | "orderable"
  /** Equatable: any type that supports `==` (per §6.1 V5-strict equality
   *  semantics). For `eq`/`neq`/`oneOf`/`notIn`. Practically all scrml types
   *  qualify; provided as a separate slot for catalog clarity. */
  | "equatable";

/**
 * A single predicate's signature — what the compiler enforces at validator
 * type-checking time.
 */
export interface PredicateSignature {
  /** Source-level name, exactly as it appears in `<name predicate(args)>`. */
  name: string;
  /** Documented arity:
   *
   *  - `0` — strictly bareword (no parens at all). Currently unused — every
   *    universal-core predicate accepts the optional trailing inline-override
   *    per §55.10, so this slot exists only for future predicates that should
   *    forbid inline overrides.
   *  - `"0+inline"` — bareword OR one optional trailing inline-message-override
   *    (string literal). Used by `req` and `is given`. The §55.10 worked
   *    example `<name req("Please enter your name")>` is the canonical form
   *    for this arity.
   *  - `1` — strictly one required arg, no inline override. Currently unused.
   *  - `"1+inline"` — one required arg plus an optional trailing
   *    inline-message-override. Used by all the call-form predicates. */
  arity: 0 | "0+inline" | 1 | "1+inline";
  /** Per-positional arg-kind list. `null` for arity-0 bareword predicates.
   *  When `arity === "1+inline"`, the trailing inline-override slot is
   *  expressed as the last entry (`{ kind: "inline-message-override" }`).
   *  When the trailing inline-override is absent in source, the validator
   *  has only the leading required arg. */
  args: PredicateArgKind[] | null;
  /** What cell-value types this predicate applies to. Mismatch fires
   *  E-TYPE-031 family per §55.1 line 24295. */
  cellTypeRequirement: CellTypeRequirement;
  /** The `ValidationError` enum tag emitted on this predicate's failure
   *  (per SPEC §55.9). Codegen consumes this so failures show structured
   *  tags rather than ad-hoc strings. */
  errorTag: string;
  /** Source-of-truth note pointing at the spec section that defines this
   *  predicate's semantics. Helps audits and IDE tooltips. */
  specRef: string;
}

/**
 * The 14 universal-core predicates per SPEC §55.1.
 *
 * Order matches the §55.1 table. New predicates added to §55.1 should be
 * added here in the same source-order; auto-generated docs lean on this.
 */
export const UNIVERSAL_CORE_PREDICATES: readonly PredicateSignature[] = [
  {
    name: "req",
    arity: "0+inline",
    args: [{ kind: "inline-message-override" }],
    cellTypeRequirement: "any",
    errorTag: "Required",
    specRef: "§55.1 — non-empty value (`\"\"` fails; null/undefined fail). Inline override per §55.10.",
  },
  {
    name: "is given",
    arity: "0+inline",
    args: [{ kind: "inline-message-override" }],
    cellTypeRequirement: "any",
    errorTag: "NotSome",
    specRef: "§55.1, §42.2.5 — value EXISTS (`not` fails). `\"\"` IS given. Inline override per §55.10. `is some` is its soft-deprecated spelling (S462, W-IS-SOME-DEPRECATED).",
  },
  {
    name: "length",
    arity: "1+inline",
    args: [{ kind: "relational-predicate" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "string-or-array",
    errorTag: "LengthFailed",
    specRef: "§55.1 — string/array length matches the inner predicate",
  },
  {
    name: "pattern",
    arity: "1+inline",
    args: [{ kind: "regex" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "string",
    errorTag: "PatternMismatch",
    specRef: "§55.1 — string matches the regex",
  },
  {
    name: "min",
    arity: "1+inline",
    args: [{ kind: "numeric" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "number",
    errorTag: "MinFailed",
    specRef: "§55.1 — numeric minimum",
  },
  {
    name: "max",
    arity: "1+inline",
    args: [{ kind: "numeric" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "number",
    errorTag: "MaxFailed",
    specRef: "§55.1 — numeric maximum",
  },
  {
    name: "gt",
    arity: "1+inline",
    args: [{ kind: "comparable-with-cell" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "orderable",
    errorTag: "GtFailed",
    specRef: "§55.1 — strict greater-than (cross-field via predicate args)",
  },
  {
    name: "lt",
    arity: "1+inline",
    args: [{ kind: "comparable-with-cell" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "orderable",
    errorTag: "LtFailed",
    specRef: "§55.1 — strict less-than",
  },
  {
    name: "gte",
    arity: "1+inline",
    args: [{ kind: "comparable-with-cell" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "orderable",
    errorTag: "GteFailed",
    specRef: "§55.1 — greater-than-or-equal",
  },
  {
    name: "lte",
    arity: "1+inline",
    args: [{ kind: "comparable-with-cell" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "orderable",
    errorTag: "LteFailed",
    specRef: "§55.1 — less-than-or-equal",
  },
  {
    name: "eq",
    arity: "1+inline",
    args: [{ kind: "any-equatable-with-cell" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "equatable",
    errorTag: "EqFailed",
    specRef: "§55.1 — equality (cross-field via predicate args)",
  },
  {
    name: "neq",
    arity: "1+inline",
    args: [{ kind: "any-equatable-with-cell" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "equatable",
    errorTag: "NeqFailed",
    specRef: "§55.1 — inequality",
  },
  {
    name: "oneOf",
    arity: "1+inline",
    args: [{ kind: "array-of-cell-type" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "equatable",
    errorTag: "OneOfFailed",
    specRef: "§55.1 — set membership",
  },
  {
    name: "notIn",
    arity: "1+inline",
    args: [{ kind: "array-of-cell-type" }, { kind: "inline-message-override" }],
    cellTypeRequirement: "equatable",
    errorTag: "NotInFailed",
    specRef: "§55.1 — set non-membership",
  },
];

/** Frozen index from predicate name → signature, for O(1) lookup. */
const PREDICATE_BY_NAME: ReadonlyMap<string, PredicateSignature> = new Map(
  UNIVERSAL_CORE_PREDICATES.map((p) => [p.name, p]),
);

/**
 * Soft-deprecated spellings (SPEC §63 Stage 1) → the canonical predicate name.
 * `is some` retired to `is given` (ruling:user-voice-scrml.md S462 "a, validator
 * too, go"); it still resolves to the same predicate during the window.
 */
const DEPRECATED_PREDICATE_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ["is some", "is given"],
]);

/** The canonical predicate name for a source spelling (identity for a canonical one). */
export function canonicalPredicateName(name: string): string {
  return DEPRECATED_PREDICATE_SPELLINGS.get(name) ?? name;
}

/**
 * Look up a universal-core predicate signature by its source-level name.
 *
 * Returns `undefined` if the name does NOT match a universal-core predicate.
 * Library-surface predicates (`email`, `url`, `numeric`, `integer` from
 * `scrml:data`) are NOT in this catalog; their signatures are registered
 * elsewhere (stdlib registration path, future).
 *
 * Multi-word names (like `"is given"`) match verbatim; a soft-deprecated
 * spelling (`"is some"`) resolves to its canonical predicate.
 */
export function lookupPredicate(name: string): PredicateSignature | undefined {
  return PREDICATE_BY_NAME.get(canonicalPredicateName(name));
}

/**
 * Returns true if the given source-level name is a universal-core predicate.
 * Convenience wrapper around `lookupPredicate`.
 */
export function isUniversalCorePredicate(name: string): boolean {
  return PREDICATE_BY_NAME.has(canonicalPredicateName(name));
}

/**
 * Returns the count of universal-core predicates. Used by audits and
 * verification tests to ensure the catalog hasn't drifted from §55.1.
 *
 * As of S67 (post-§55.1 vocabulary correction): 14.
 */
export function universalCorePredicateCount(): number {
  return UNIVERSAL_CORE_PREDICATES.length;
}
