# Phase A1c Step C6 — Validator runtime catalog: survey findings

**Date:** 2026-05-08
**Status:** PROCEED-AS-BRIEFED with locus-correction.

## 1. Scope confirmation (Rule 4)

**14 universal-core predicates per SPEC §55.1 + `compiler/src/validator-catalog.ts`** —
verified verbatim against SPEC.md text and compile-time catalog:

```
req · is some · length · pattern · min · max ·
gt · lt · gte · lte · eq · neq · oneOf · notIn
```

NOT in catalog (SCOPE doc drift; brief Rule 4 correction holds):
- `email` / `url` / `numeric` / `integer` — stdlib `scrml:data` predicate-builders
- `custom` — ValidationError TAG (§55.9), not a predicate

## 2. File-locus

**Runtime peer location.** `compiler/runtime/stdlib/*.js` is for stdlib MODULE shims
(auth.js, crypto.js, store.js — `import { ... } from "scrml:auth"`). The validator
catalog is **internal compiler runtime**, not a stdlib module — no `import` surface.

**Decision:** put the runtime catalog at `compiler/src/runtime-validators.js` —
sibling of `compiler/src/runtime-template.js`. Rationale:

1. `runtime-template.js` is the precedent for "runtime JS as ES-module string export"
   in this codebase. C6's catalog is the same pattern at smaller scale.
2. Keeping the catalog under `compiler/src/` (TypeScript-friendly + Node-resolvable
   in the test suite via the same path conventions as `validator-catalog.ts`).
3. Avoids polluting `compiler/runtime/stdlib/` (which is a copy-into-output-dir target —
   the validator catalog is NOT something to copy out as a file; it's part of the
   single emitted runtime).
4. The brief authorizes this correction: "agent may correct to a different runtime
   path during survey if cleaner."

**Module shape.** Two artifacts, one file:

(a) **Plain JS export** — `export const VALIDATOR_RUNTIME = { req(...){...}, ... }`
    Direct in-process use by tests + by the per-cell runner once C7 lands (testable
    without going through the codegen string-emission path).

(b) **String constant** — `export const SCRML_VALIDATOR_RUNTIME = "..."` — the runtime
    code as a literal string for emission alongside `SCRML_RUNTIME`. Mirrors the
    `runtime-template.js` pattern. C7 wires this into emission later.

**Net new file:** `compiler/src/runtime-validators.js` (NEW)
**Net touched file:** `compiler/src/runtime-template.js` — **NO CHANGES this step**
(C7 territory; explicitly avoid C5 collision).

## 3. Mirror-1:1-with-compile-time confirmation

| Compile-time catalog (`validator-catalog.ts`) | Runtime catalog (`runtime-validators.js`) |
|---|---|
| `name: "req"` | key `"req"` |
| `arity: "0+inline"` | function takes `(value, ..._args)` (inline-override is C7 territory) |
| `errorTag: "Required"` | failure returns `{ tag: "Required" }` |
| `args: [{kind:"relational-predicate"},...]` | function expects RelationalPredicateValue at that arg index |
| (… same for all 14) | (1:1) |

The runtime entries are in the **same order** as the compile-time entries (per brief).

## 4. Relational-predicate runtime evaluator

`length(>=N)` arrives at the runtime as a structured RelationalPredicateNode:
```js
{ op: ">=" | "<=" | "<" | ">" | "=" | "!=", value: ExprNode }
```

C6 needs a `runRelationalPredicate(actualLength, relPred)` function that:
- evaluates `relPred.value` (assumed already-evaluated by C7 — passed as a JS literal/number)
- applies `relPred.op` against `actualLength`

Concretely the runtime sees: `{ op: ">=", value: 2 }` (C7 will have already evaluated
the inner expression to a number). Same shape, narrower types — no `ExprNode` at runtime.

## 5. Cross-field arg evaluator

For `eq(@signup.password)`, C7 emits the comparison value as a **thunk** that reads
the cell at fire time:
```js
() => _scrml_reactive_get("signup_password")
```

C6's `eq` fire function MUST accept either a literal value OR a thunk and unwrap the
latter (`typeof arg === "function" ? arg() : arg`). The compile-time catalog encodes
this via `cellTypeRequirement: "equatable"` and `args: [{kind:"any-equatable-with-cell"}]`.
C7 is responsible for emitting the right shape; C6 is responsible for reading both.

For `oneOf([.Admin, .Editor])`, the array MAY contain thunks (cross-field) or literals.
We unwrap each element: `set.map((e) => typeof e === "function" ? e() : e)`.

## 6. `is some` vs `req`

Per §42.2.5 + primer §9.4 — distinct, both shipped:

| value | `req` | `is some` |
|---|---|---|
| `null` | fail (`Required`) | fail (`NotSome`) |
| `undefined` | fail (`Required`) | fail (`NotSome`) |
| `""` (empty string) | fail (`Required`) | **pass** |
| `[]` (empty array) | fail (`Required`) | **pass** |
| `0` (zero) | **pass** | **pass** |
| `false` | **pass** | **pass** |
| any value | pass | pass |

Note: `req`'s spec at §55.1 says `""` fails; `[]` is a pragmatic extension following the
same "non-empty" semantic since `req` operates on string-or-array contexts too. We follow
the compile-time catalog: `req` has `cellTypeRequirement: "any"`, so we treat empty array
and empty object as "non-meaningful" if applicable — for arrays specifically (since
`[].length === 0`), this is the natural read. Booleans and numbers pass `req` as long as
they're not null/undefined; `0` and `false` are meaningful values.

## 7. ValidationError shape (for return values)

C6's fire functions return either `null` (pass) or a `{ tag, ...payload }` object
matching SPEC §55.9:

| Predicate | Pass | Fail return |
|---|---|---|
| `req` | null | `{tag:"Required"}` |
| `is some` | null | `{tag:"NotSome"}` |
| `length` | null | `{tag:"LengthFailed", predicate: relPred}` |
| `pattern` | null | `{tag:"PatternMismatch", re: regex}` |
| `min` | null | `{tag:"MinFailed", threshold: n}` |
| `max` | null | `{tag:"MaxFailed", threshold: n}` |
| `gt` | null | `{tag:"GtFailed", expected: v}` |
| `lt` | null | `{tag:"LtFailed", expected: v}` |
| `gte` | null | `{tag:"GteFailed", expected: v}` |
| `lte` | null | `{tag:"LteFailed", expected: v}` |
| `eq` | null | `{tag:"EqFailed", expected: v}` |
| `neq` | null | `{tag:"NeqFailed", forbidden: v}` |
| `oneOf` | null | `{tag:"OneOfFailed", set: [...]}` |
| `notIn` | null | `{tag:"NotInFailed", set: [...]}` |

C7 interleaves these with declaration order, optionally short-circuits on `req`/`is some`
failure (§55.12), and accumulates into `errors[]`.

## 8. Estimated test delta

- `compiler/tests/unit/c6-validator-runtime-catalog.test.js` (NEW)
  - 14 predicate test groups (one `describe` each)
  - ~3-5 assertions per predicate (pass case, primary fail case, edge cases)
  - Plus catalog-shape tests (count is 14, names match, errorTag mirrors compile-time)
  - Plus thunk-unwrap test (eq with `() => 5` arg)
  - Plus relational-predicate eval test (each of 6 ops)
- **Estimated: ~50-70 expects added.** No existing tests touched.

## 9. Hookpoint contract for C7

**C7 will call into C6 via:**

```js
import { fireValidator } from "./runtime-validators.js";
// or
import { VALIDATOR_RUNTIME } from "./runtime-validators.js";
const fire = VALIDATOR_RUNTIME[predicateName];
const error = fire(cellValue, ...evaluatedArgs);
if (error !== null) errors.push(error);
```

**Short-circuit on `req`/`is some` failure** is C7's responsibility (§55.12 — "the
remaining validators are SKIPPED"). C6's fire functions are pure pass/fail; they don't
know about sibling validators.

**Inline message override** (Level 1 of 4-level chain) — extracted at B13 to
`ValidatorEntry.inlineOverride`. C7 reads it from the AST/symbol-table; C6 doesn't
see inline overrides at fire time — they're message-time concerns (C10).

## 10. Files-touched-vs-brief diff

Brief says:
- `runtime/validators.js` (NEW) → corrected to `compiler/src/runtime-validators.js`
- "Possibly `compiler/src/codegen/runtime-template.js` | wire the catalog into the runtime emission" → **DEFERRED to C7** (avoids C5 collision; brief authorizes this)
- `compiler/tests/unit/c6-validator-runtime-catalog.test.js` (NEW) → as-briefed
- `docs/changes/.../{progress,SURVEY}.md` → as-briefed

## Verdict

**PROCEED.** Survey complete in ~25 min. No scope drift; locus correction documented above.
