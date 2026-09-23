/**
 * s427-lift-body-lowering (round 2, H1) — a keywordless write to a `const` on the
 * lift paths must stay LOUD.
 *
 * s427 gave the lift-group paths (Step 4b's per-group set, every lift loop / lift
 * branch / lifted-markup logic block) a declared-name set where base b497b892 had
 * NONE. That is what turns a keywordless `n = n + 1` after `let n` into the
 * assignment it is. But the set only records THAT a name is declared, not HOW: a
 * keywordless `x = 2` after `const x = 1` became `x = 2;` as well — exit 0, then
 * `TypeError: Attempted to assign to readonly property` at boot — where base
 * emitted a second `const x` in the same scope and failed the COMPILE
 * (E-CODEGEN-INVALID-LOGIC, "Identifier 'x' has already been declared").
 * SPEC §50.8.5 makes that write E-ASSIGN-004, which the TYPE SYSTEM reports at
 * statement position (#996) — this module does not report it. Its job is the
 * LOWERING: a keywordless write to a `const` on these paths is emitted so it fails
 * at least as loudly as base even where the type system does not see it (a write
 * in a `${}` logic block inside lifted markup, for one), and is never a silent
 * shadow:
 *
 *   - the `const` was declared in the SAME JS scope as the write → base's emission,
 *     a second `const x = …` — the compile fails exactly as it did on base;
 *   - the `const` lives in an ENCLOSING scope → the assignment `x = …;`, which
 *     throws `TypeError` when it runs. Base's emission there was `const x = …` in
 *     the inner block: a valid SHADOW that silently ignored the write (or a TDZ
 *     ReferenceError when the right side read `x`). Re-emitting base's shadow is
 *     not an option: combined with the other s427 fixes it turned a program that
 *     died at boot on base into one that rendered, with the write silently lost.
 *
 * Bookkeeping, carried through the sets' many block copies:
 *   - LIFT_SCOPE (in-band): the set, or an ancestor it was copied from, is one s427
 *     introduced. Only such sets consult the rest. A function body starts a
 *     non-lift set again (base always gave a function body a set, and its writes
 *     keep their prior lowering byte-for-byte).
 *   - OWN (a WeakMap, keyed by the set OBJECT): the `const`s declared by the scope
 *     this very set represents. A block copy is a new object, so an enclosing
 *     scope's `const` is never "own" in a nested block. Step 4b seeds a group's set
 *     from the chunk-scope names of earlier groups; those share the chunk scope,
 *     so it carries their OWN entries across (see `seedOwnConsts`).
 * The in-band marker is safe: a declared-name set is only ever `.has(identifier)`-
 * queried, and a NUL-prefixed string is never an identifier.
 * `lin` bindings never enter a declared-name set (the `lin-decl` arm does not add
 * them), so a keywordless write to a `lin` name keeps base's emission unchanged.
 */

const LIFT_SCOPE_MARK = "\u0000s427:lift-scope";
const OWN_CONSTS = new WeakMap<Set<string>, Set<string>>();

/** A fresh lift-scope COPY of `names` (empty when absent). Never mutates `names`. */
export function liftScopeDeclaredNames(names: Set<string> | null | undefined): Set<string> {
  const out = new Set<string>(names ?? []);
  out.add(LIFT_SCOPE_MARK);
  return out;
}

/** Drop the lift-scope marker from a set a function body owns (a new function
 *  scope: base gave it a set of its own, so its writes keep their prior lowering). */
export function clearLiftScope(names: Set<string> | null | undefined): void {
  if (names) names.delete(LIFT_SCOPE_MARK);
}

/** Record that `names`' scope declares `name` as a `const`. */
export function markDeclaredImmutable(names: Set<string> | null | undefined, name: unknown): void {
  if (!names || typeof name !== "string" || !name) return;
  let own = OWN_CONSTS.get(names);
  if (!own) { own = new Set(); OWN_CONSTS.set(names, own); }
  own.add(name);
  SEEDED_CONSTS.get(names)?.delete(name); // declared by this scope itself now
}

/** Record that `names`' scope (re)declares `name` mutable — a `let`, or a parameter. */
export function markDeclaredMutable(names: Set<string> | null | undefined, name: unknown): void {
  if (!names || typeof name !== "string" || !name) return;
  OWN_CONSTS.get(names)?.delete(name);
  SEEDED_CONSTS.get(names)?.delete(name);
}

/**
 * Step 4b: `to` is seeded from `from`, the chunk-scope names of earlier groups.
 * With `seeded`, the carried `const`s are remembered as SEEDED: they share `to`'s
 * scope only if the group's code lands at chunk scope, which is known only after
 * the group is emitted — a group whose code runs inside an outer `_scrml_effect`
 * re-emits the statements that relied on one (see `withSeededConstsOff`).
 */
export function seedOwnConsts(from: Set<string>, to: Set<string>, seeded = false): void {
  const own = OWN_CONSTS.get(from);
  if (!own || own.size === 0) return;
  let dst = OWN_CONSTS.get(to);
  if (!dst) { dst = new Set(); OWN_CONSTS.set(to, dst); }
  for (const n of own) dst.add(n);
  if (seeded) SEEDED_CONSTS.set(to, new Set(own));
}

const SEEDED_CONSTS = new WeakMap<Set<string>, Set<string>>();
let _seededConstFallbacks = 0;

/** A monotonic count of keywordless writes lowered as base's duplicate `const`
 *  because of a SEEDED `const` (compare before / after one statement's emission). */
export function seededConstFallbackCount(): number {
  return _seededConstFallbacks;
}

/** Run `fn` with `names`' seeded `const`s treated as belonging to an ENCLOSING
 *  scope (the group's code did not land at chunk scope). */
export function withSeededConstsOff<T>(names: Set<string>, fn: () => T): T {
  const seeded = SEEDED_CONSTS.get(names);
  const own = OWN_CONSTS.get(names);
  if (!seeded || !own) return fn();
  const removed = [...seeded].filter((n) => own.has(n));
  for (const n of removed) own.delete(n);
  try {
    return fn();
  } finally {
    for (const n of removed) own.add(n);
  }
}

/**
 * Whether a keywordless `name = …` (a `tilde-decl`) is lowered as an ASSIGNMENT to an
 * existing binding. False when the name is undeclared (a fresh declaration), and —
 * on a lift-scope set only — when it is a `const` declared by this same scope
 * (base's duplicate `const`, a compile error; see above).
 */
export function tildeDeclIsRebind(names: ReadonlySet<string> | null | undefined, name: unknown): boolean {
  if (!names || typeof name !== "string" || !names.has(name)) return false;
  if (names.has(LIFT_SCOPE_MARK) && OWN_CONSTS.get(names as Set<string>)?.has(name)) {
    if (SEEDED_CONSTS.get(names as Set<string>)?.has(name)) _seededConstFallbacks++;
    return false;
  }
  return true;
}
