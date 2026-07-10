# progress — refinement static-eval (§53.4.2 rule 2) — S136

## Status: implementation complete; gate verification in progress

## Empirical reproduction (before fix)
Confirmed the divergence via `compileScrml`:
- `number(>0 && <10000) = -50`     → E-CONTRACT-001 at compile (baseline works)
- `string(email) = "not-an-email"` → NO compile error (the gap)
- `string(url) = "..."` violating  → NO compile error (the gap)
- `string(.length > 3) = ""`       → E-CONTRACT-001 already fires (property path works)
- `number(>0) = 0`                 → E-CONTRACT-001 already fires (no zero-exemption)

So the ONLY gap is the named-shape case: numeric + `.length`-property literals were
statically checked, named-shapes deferred. No empty-string / zero exemption exists —
`string(.length>3) = ""` and `number(>0) = 0` already fire, so making named-shapes
fire on non-conforming literals (incl. `""`) is consistent, not a new class.

## Fix (fire site + extension)
- Fire site: `evaluatePredicateOnLiteral` (compiler/src/type-system.ts), line ~1508.
  Previously `if (pred.kind === "named-shape") return null; // not statically evaluated`.
- Extended: a named-shape against a string LITERAL now runs the shape's decidable
  structural predicate (T-PRED-1). Added `SHAPE_STATIC_PREDICATES` (email/url/uuid/
  phone/date/time/color) mirroring the RUNTIME predicates in
  codegen/emit-predicates.ts `NAMED_SHAPE_RUNTIME` (invariant documented both places).
  Non-string value / unregistered shape / `@`-ref stays deferred (returns null).
- The static-eval flows through `checkPredicateLiteral` (assignment-site path) and
  `runRefinementNoRhsDefaultCheck` (§6.2 Shape 4). A no-RHS `string(email)` cell's
  canonical-empty `""` now fires E-REFINEMENT-NO-DEFAULT exactly as no-RHS
  `number(>0)` does — the same consistency, one level up. Stale comments updated.

## SCOPE CALL — regex `string.pattern(/re/)` is OUT (surfaced to PA)
The brief asked to also static-eval the regex `pattern(/re/)` form. EMPIRICAL finding
that contradicts the brief's premise: `string.pattern(/re/)` (the §53.6.1/§55
dot-chained shared-validator-core) resolves to `asIs` — it is NOT a PredicatedType,
there is no `pattern` PredicateExpr kind, and it emits NO refinement enforcement at
all today (not static, not the runtime E-CONTRACT-001-RT the brief claimed "DOES
fire"). Making it static-evaluable requires FIRST lifting the whole dot-chained
validator-core (`req`/`length`/`pattern`/`min`/`max`/…) into a first-class refinement
type + emitting new runtime boundary checks corpus-wide — a broad change that
introduces NEW runtime enforcement, not "extend the static-eval path." Also §53.4.2
rule 2 (the normative static-provability rule) names ONLY named shapes; it is silent
on regex. Per the brief's own STOP-if-broad caution + Rule 4, I implemented the
named-shape half (SPEC-anchored) and left the regex to PA.

## Reconciliation of pre-existing corpus (flipped-red check)
- `samples/.../predicate-email-001.scrml` (`<email>: string(email) = ""`) and
  `predicate-url-001.scrml` (`<website>: string(url) = ""`): the `= ""` init was only
  "clean" because of the divergence. Reconciled to CONFORMING inits
  (`"user@example.com"` / `"https://example.com"`), parallel to the already-correct
  `predicate-number-range-001.scrml` which uses `= 25` (not `= 0`). Both now compile
  clean; they still demonstrate the same §53.7.1 bind:value HTML-attr wiring.
- Locked unit tests `predicate-types.test.js` §18 + §25 asserted the divergent `null`;
  flipped to the SPEC-conforming static-eval (conforming→true/clean, violating→
  false+E-CONTRACT-001, non-string→null). All predicate/refinement unit files green.
- `c16-refinement-runtime.test.js` uses `string(email) = ""` but only asserts HTML
  output (not error-freeness) → still passes; left as-is (robust).

## Conformance cases authored (conformance/cases/refinement/)
- `string-shape-literal-violation-pos` — violating `string(email) = "not-an-email"`
  fires E-CONTRACT-001 at compile (the newly-static case; sibling of numeric
  `literal-violation-pos`). GAP-2 compile half.
- `string-shape-inhabit-rt` — conforming `@email` through a `string(email)` fn
  boundary inhabits + renders (sibling of numeric `inhabit-rt`). GAP-2 runtime half.

## Design item surfaced (NOTE for PA)
The empty-form-field idiom: SPEC §53.7.1 itself shows `<email>: string(email) = ""`
as a form example, but under the (now-consistent) static-eval `""` is a violation.
How does one declare an empty form-bound refinement cell (e.g. `string(email) | not`)?
Genuine design question the fix exposes — NOT resolved here.
