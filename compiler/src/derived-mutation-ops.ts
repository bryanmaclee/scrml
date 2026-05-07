/**
 * Derived-cell mutation operator catalog — used by SYM PASS 6 (B8) to fire
 * `E-DERIVED-VALUE-MUTATE` per SPEC §6.6.18.
 *
 * Two readonly sets:
 *
 *   - `ARRAY_MUTATING_METHODS` — the 9 method names per SPEC §6.5.1 that
 *     mutate array values in place (`push`, `pop`, `shift`, `unshift`,
 *     `splice`, `reverse`, `sort`, `fill`, `copyWithin`). These are the
 *     methods §6.6.18 case-1 forbids on derived cells.
 *
 *   - `COMPOUND_ASSIGNMENT_OPS` — the 14 compound-assignment operators per
 *     SPEC §6.6.18 normative statements. Plain `=` is treated separately
 *     because the spec wording calls it out as a distinct form ("property
 *     assignment of the form `@derivedName.path = expr`"). All compound
 *     forms + plain `=` SHALL fire E-DERIVED-VALUE-MUTATE on a derived
 *     receiver.
 *
 * Kept in a standalone module so future consumers (E-DERIVED-WRITE
 * implementation, the codegen rewriter that lowers reactive-array-mutation,
 * IDE autocomplete suppressors) stay in sync if §6.5.1 grows.
 *
 * Spec authority:
 *   §6.5.1 — Array mutating methods on mutable reactive cells.
 *   §6.6.18 — E-DERIVED-VALUE-MUTATE rule.
 *   §34 — E-DERIVED-VALUE-MUTATE catalog row.
 */

/**
 * Array methods that mutate the receiver in place. Per SPEC §6.5.1 + §6.6.18.
 * Frozen so accidental mutation by callers throws at runtime.
 */
export const ARRAY_MUTATING_METHODS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "reverse",
    "sort",
    "fill",
    "copyWithin",
  ]),
) as ReadonlySet<string>;

/**
 * Compound-assignment operators per SPEC §6.6.18 normative statements (line
 * ~3075 area). Plain `=` is excluded here — callers test it separately.
 */
export const COMPOUND_ASSIGNMENT_OPS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    "&=",
    "|=",
    "^=",
    "<<=",
    ">>=",
    ">>>=",
    "??=",
    "||=",
    "&&=",
  ]),
) as ReadonlySet<string>;

/**
 * All assignment operators that constitute a write to a derived-cell property
 * for E-DERIVED-VALUE-MUTATE purposes — plain `=` plus all 14 compound forms.
 * Does NOT include logical-vs-arith distinction because §6.6.18 treats them
 * uniformly (any write is forbidden).
 */
export function isDerivedMutatingAssignOp(op: string): boolean {
  return op === "=" || COMPOUND_ASSIGNMENT_OPS.has(op);
}

/** Convenience predicate: is `name` an array-mutating method? */
export function isArrayMutatingMethod(name: string): boolean {
  return ARRAY_MUTATING_METHODS.has(name);
}
