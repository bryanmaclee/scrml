# progress — fix/e-match-012-tnot-exhaustive

Append-only log.

## Phase 0 — reproduce (verify-before-claim)
- Confirmed on base e6a6cae4: a `T | not` value-match with a `not` arm + present-case
  arms fires BOTH E-MATCH-012 and E-TYPE-006 (should compile CLEAN).
  - `.Admin` `.Editor` `not`  → E-MATCH-012 + E-TYPE-006 (BUG)
  - canonical §18 `not` + `given u` → E-MATCH-012 + E-TYPE-006 (BUG)
  - `else` form → CLEAN (only impl#1-accepted exhaustive shape pre-fix)
  - `not`-only (missing T) → E-MATCH-012 + E-TYPE-006
  - `.Admin` + `not` (missing `.Editor`) → E-MATCH-012 + E-TYPE-006

## Root cause (confirmed ss71 trace)
- `checkUnionExhaustiveness` (type-system.ts) counted a union member covered ONLY by
  an `is-type` pattern or a wildcard. `extractArmsFromMatchNode` records a `not` arm as
  a `variant` (name `not`) and present `.Variant` arms as `variant`, and a `given u` arm
  parses to a `given-guard` node that `extractArmsFromMatchNode` IGNORED entirely.
  So for `Role | not` neither member was ever counted → E-TYPE-006 (Role) + E-MATCH-012.
- E-MATCH-012 fire site is type-system.ts:16961 (the §34 catalog line-ref `:6478` is stale).

## Fix
- `extractArmsFromMatchNode`: a `given-guard` arm now pushes a `present-binding`
  ArmPattern (covers the whole present value — the T half of `T | not`).
- `checkUnionExhaustiveness`: for a union WITH a `not` member, decompose coverage per
  member — `not` member ← `not` arm; enum member T ← `given` present-binding / `is T` /
  ALL its variants; other member ← present-binding / `is T`. Non-`not` unions keep the
  exact pre-existing is-type/wildcard semantics (localized).

## Adversarial soundness (all verified post-fix)
- not+present (`.Admin`/`.Editor`/`not`) → CLEAN
- not+given (canonical §18) → CLEAN
- else/wildcard → CLEAN (unchanged)
- not-only (missing T) → E-TYPE-006 (non-exhaustive), NO E-MATCH-012
- `.Admin`+`not` (missing `.Editor`) → E-TYPE-006 (NOT over-accepted)
- present-only (`.Admin`/`.Editor`, no not) → E-MATCH-012 only (no spurious E-TYPE-006)
- plain enum + multi-scrutinee paths untouched (separate functions)

## Backward-compat with existing synthetic unit tests
- not-keyword.test.js §23-§27 model a `not` arm as `{kind:"is-type",typeName:"not"}`
  (a synthetic shape the real pipeline never emits — extractArmsFromMatchNode emits
  `variant`(name `not`)). That mismatch is why the bug slipped: those tests were green
  while the real `variant "not"` shape was broken. Kept the code robust to BOTH: the
  absence member is covered by a `variant "not"` arm OR an `is-type "not"` pattern.
  All 139 pre-existing not-keyword tests stay green.

## Tests / docs
- conformance NEG: e-match-012-tnot-not-arm-exhaustive-neg (added) — 494/494 conformance pass
- unit tests: not-keyword.test.js — 7 new real-representation cases (§23d-§25d):
  not-arm-clean / not+given-clean / not-arm-only-still-fires / partial-variants-non-exhaustive /
  present-only-still-fires (146 pass total)
- SPEC.md:18298 §34 catalog line-ref 6478 → 16961 (doc-currency)
