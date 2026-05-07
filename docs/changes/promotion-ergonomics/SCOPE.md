---
title: Promotion ergonomics — I-MATCH-PROMOTABLE lint + bun scrml promote CLI
date: 2026-05-06
session: S65 (Tier A) + S66 (Tier B re-scoped)
authority: Bryan design conversation S65 (post-Phase-2 parseVariant ship); pattern derived from existing `bun scrml migrate` precedent + W-LIFECYCLE-CANDIDATE / W-MATCH-TRANSITIONS-ACCRUING lints
status: Tier A SHIPPED S65; Tier B SHIPPED S66 (re-scoped Path A — `is`-only); Tier C (`--engine` + W-MATCH-TRANSITIONS-ACCRUING) DEFERRED
estimate: ~13-22h for `--match` alone; ~18-30h with `--engine` (Tier 1→2 sibling); re-scoped Tier B 16-26h
---

# §0. RE-SCOPED S66 (Path A authority)

**Authority:** Bryan-authorized S66 architectural decision after the Phase 0 STOP report at
[`SURVEY-PHASE-B.md`](./SURVEY-PHASE-B.md). Phase 0 surfaced three material findings (A, B, D)
that warranted re-scope before implementation.

**Tier B narrows to:**

1. **Predicate matrix — `is`-only.** The lint and `bun scrml promote --match` operate on
   exactly two parseable forms:
   - `if (@cell.is(.X))` — method-call form
   - `if (@cell is .X)` — operator form
   - `if (@cell is .X msg)` — operator form with single-field bind (verified parseable;
     test reference `compiler/tests/unit/if-is-variant.test.js`)

   The `==`-with-dot-prefix-variant forms (`@cell == .X`, `@cell == .X(payload)`,
   `@cell == .X msg`) named in §B below remain part of the design lock for documentation
   but are NOT shipped in S66. Reason: `preprocessForAcorn`
   (`compiler/src/expression-parser.ts:686+`) only registers placeholders for `is .Variant`,
   not for `== .Variant`. The `==` form does not parse today — implementing the rewrite
   would ship dead-code paths. Adding `==` is a future preprocessor extension, not a Tier B
   work item. SPEC §56 has been amended to drop the `==` rows from §56.2 and §56.5.2.

2. **`--engine` mode DEFERRED to Tier C.** The `--engine` CLI flag stays registered
   (running it prints "implementation pending") but the `<match>` → `<engine>` span rewrite
   does not ship in S66. Reason: `--engine` pairs with `W-MATCH-TRANSITIONS-ACCRUING`,
   which has no §34 catalog row, no §28 suppression config row, and no source impl. Tier C
   is the right home for that work. SPEC §56.6 lists the four Tier C work items concretely.

3. **`I-MATCH-PROMOTABLE` §34 catalog row catch-up included.** Per Phase 0 Finding D, the
   §34 row was missed in S65 Tier A. Tier B Phase 0a lands it as a small spec amendment.

**Re-scoped estimate: 16-26h.** Down from the full SCOPE 25-41h. Single-session shippable.

The original SCOPE design (below) remains the canonical record of intent. Sections marked
with the predicate matrix or `--engine` belong to Tier C now; the Tier B ship is `--match` +
the lint over the two `is` forms.

---

# Promotion ergonomics — design + dispatch readiness

## The framing question (Bryan's, S65)

> can the compiler auto-promote well formed if-else trees? if so can the compiler hint at what is missing to enable auto-promotion?

Refined after PA proposed lint-only:

> I was more meaning info when promoteable and a cli command to do the mechanical promotion. this is dev manual, but avoids potential typos, etc.

## Why this design earns its complexity

scrml's tier ladder (primer §1) is "promotion is mechanical and additive" — but only if the dev knows what's promotable AND avoids transformation typos. This dispatch makes both concrete:

1. **Lint surfaces the opportunity** at compile time (info-level, not warning — code compiles fine).
2. **CLI executes the mechanical lift** when the dev chooses (eliminates typo class).
3. **Dev keeps control** — no silent rewrite. The CLI is invoked, not implicit.

Pattern precedent: `bun scrml migrate` already exists for `<machine>` → `<engine>` rewrites (per primer §7). Same trust model. Same infrastructure (BPP / source-rewrite tooling). New verb because semantics differ — migrate is for deprecated→current; promote is for tier-up of code that's already valid.

## The two pieces

### Piece A — `I-MATCH-PROMOTABLE` lint (compiler-side)

**Severity:** info, not warning. The code compiles fine; this surfaces opportunity, doesn't nudge.

**Fires when:**
- if-else / `if=` chain discriminates on a state cell typed as enum (or derived expression resolving to enum-typed value)
- All branches are exhaustive against the enum's variant set
- Conditions are clean variant predicates: `@cell == .X`, `@cell.is(.X)`, `@cell.kind == .X`

**Three message shapes:**

1. **Exhaustive (clean promotion):**
   ```
   I-MATCH-PROMOTABLE at app.scrml:42 — this if-else exhaustively covers Phase
   (.Idle, .Loading, .Error, .Success). Run `bun scrml promote --match
   app.scrml:42` to convert.
   ```

2. **Near-miss (the load-bearing one — concrete actionable):**
   ```
   I-MATCH-PROMOTABLE at app.scrml:42 — this if-else covers Phase partially
   (.Idle, .Loading, .Error). Missing .Success. Add the missing arm, then
   run `bun scrml promote --match app.scrml:42` to convert. Once promoted,
   the compiler will catch any future variant-add at the <match> site
   automatically.
   ```

3. **Wrong-discriminator** (folds into existing `W-LIFECYCLE-CANDIDATE`):
   ```
   W-LIFECYCLE-CANDIDATE at app.scrml:42 — this if-else discriminates on
   @kind: string. The string values lexically resemble enum tags. Lift @kind
   to an enum type first, then I-MATCH-PROMOTABLE will fire to suggest the
   match-promotion.
   ```

**Compound-condition handling** (`if (@phase == .X || @phase == .Y) { body }`):
- Surfaces a separate info: "branches with grouped conditions need manual restructuring; consider splitting `<X>` and `<Y>` arms with shared body or using a guard pattern."
- Does NOT auto-promote (leaves to dev judgment whether to duplicate the body or use a guard).

### Piece B — `bun scrml promote` CLI subcommand

**Why a new subcommand vs extending `migrate`:**
- `migrate` = deprecated→current (one-way; old syntax going away; e.g., `<machine>` → `<engine>`)
- `promote` = tier-1 form is fine; here's the tier-2 lift; old form remains valid forever

Different semantics warrant different verbs. gingerBill move: keep them separate.

**Shape:**

```
bun scrml promote --match <file>[:line]    # if-else → <match>
bun scrml promote --engine <file>[:line]   # <match> → <engine>  (Tier 1→2; chains with W-MATCH-TRANSITIONS-ACCRUING)
bun scrml promote --dry-run --match <file> # preview diff; don't write
bun scrml promote --match <file>           # all promotable sites in file
bun scrml promote --match <dir>            # all .scrml files under dir (recursive)
```

**Transformation logic for `--match`:**

Input (canonical example):
```scrml
if (@phase == .Idle) {
    <button onclick=load()>Load</button>
} else if (@phase == .Loading) {
    <spinner/>
} else if (@phase == .Error msg) {
    <p>Error: ${msg}</p>
} else if (@phase == .Success(count)) {
    <p>Got ${count} rows</p>
}
```

Output:
```scrml
<match for=Phase on=@phase>
    <Idle>
        <button onclick=load()>Load</button>
    </>
    <Loading>
        <spinner/>
    </>
    <Error msg>
        <p>Error: ${msg}</p>
    </>
    <Success count>
        <p>Got ${count} rows</p>
    </>
</>
```

Per-branch rewrite rules:
- `if (@cell == .X)` → `<X>{body}</>`
- `if (@cell == .X(payload))` → `<X payload>{body}</>` (variant payload destructuring)
- `if (@cell == .X msg)` (single-field bind syntax) → `<X msg>{body}</>`
- `if (@cell.is(.X))` → same as `==`
- Trailing `else { ... }` (without condition) and exhaustive coverage → drop the bare-else (its body becomes unreachable since all variants are covered above); if non-exhaustive, lint fires near-miss instead

**Preserves:**
- Branch body content verbatim (statements, markup, comments)
- Comments OUTSIDE the chain
- Indentation style (2-space vs 4-space, tabs, etc.)
- Variant payload bindings + their use sites within the body

**Skips (non-promotable; reports each):**
- Compound conditions (`||`, `&&`)
- Conditions with computed expressions (`@phase == computeX()`)
- Mixed-discriminator chains (some branches on `@phase`, some on something else)
- Side-effect guards (`if (sideEffect() && @phase == .X)`)

**Idempotent:** re-running on already-promoted code is a no-op.

**Dry-run output:** unified diff format printed to stdout; no file change.

**Exit codes:**
- 0: promoted N sites cleanly
- 0: no promotable sites found (informational, not failure)
- 1: file not parseable
- 2: ambiguous site that needs human disambiguation (with diagnostic)

### Piece C — `bun scrml promote --engine` (Tier 1→2 sibling)

Companion subcommand. Pairs with `W-MATCH-TRANSITIONS-ACCRUING` lint (which already exists). Same shape, different transformation:
- Input: `<match for=Phase on=@phase> ... </>` with rule attributes accumulating on arms
- Output: `<engine for=Phase initial=.Variant> ... </>` with rules carried forward, transitions made active

This is its own ~5-8h add. Bundle with `--match` for "promotion ergonomics" as a single dispatch, OR ship `--match` first and `--engine` second.

PA lean: bundle. Same dispatch, two flag handlers. Saves repeated context-load.

## Dependencies + ordering

**Required before this dispatch fires:**

1. **A1b B3 (`@name` resolution)** — currently next-up in A1b queue. Without it, the lint can't reliably associate state cells with their declared types at expression sites. **Hard dependency.**

2. **A+ verdict execution items** (carry-forward from S64; ~3-5h):
   - did-you-mean: match quickfix on E-SWITCH-FORBIDDEN
   - W-LIFECYCLE-CANDIDATE tightening on `if=` over enum-tag-shaped string-literal RHS
   - Document JS-style `match expr {}` form as canonical value-return rung in primer + tier-ladder-promotion article
   
   **Soft dependency** — can be folded INTO this dispatch as part of "promotion ergonomics" (same territory, same lint family). Recommend folding.

3. **parseVariant Phase 2 ship** — DONE S65 (`f963a75`). Not blocking.

**Not blocked by:**
- A1c (codegen+runtime) — orthogonal
- A2-A6 — orthogonal

## Estimate

| Piece | Estimate | Dependencies |
|---|---|---|
| `I-MATCH-PROMOTABLE` lint detection | ~3-5h | B3 |
| Concrete near-miss + variant computation | ~1-2h | reuses checkEnumExhaustiveness |
| Compound-condition info message | ~1h | mechanical |
| `bun scrml promote --match` CLI subcommand | ~5-8h | rides BPP/migrate infrastructure |
| Tests (lint coverage + CLI golden-file rewrite) | ~3-5h | standard |
| Spec/primer/kickstarter docs | ~1-2h | mechanical |
| **Subtotal `--match` alone** | **~14-23h** | — |
| `--engine` (Tier 1→2) sibling | ~5-8h | W-MATCH-TRANSITIONS-ACCRUING already exists |
| Folded A+ verdict items | ~3-5h | folds in cleanly |
| **Total bundled "promotion ergonomics"** | **~22-36h** | — |

Depth-of-survey discount may apply — `bun scrml migrate` infrastructure may carry significant fraction of the CLI scaffold for free.

## Risks

1. **Formatting preservation is real engineering.** AST→AST rewrites with original-formatting preservation is non-trivial. The migrate command already solves this for `<machine>` → `<engine>` (a simpler case — direct token swap). promote --match emits structurally different markup; needs more care.

2. **Variant payload binding syntax variations.** scrml has multiple binding shapes (`if (@phase == .Error msg)`, `if (@phase.is(.Error)) { const msg = @phase.payload; ... }`, etc.). The CLI must handle the canonical forms cleanly; flag unusual forms as skipped.

3. **Idempotency edge cases.** If a file has SOME promoted matches and SOME not, re-running must skip the promoted ones cleanly. Test coverage matters.

4. **Compound-condition false-positive risk.** `if (@phase == .Loading)` followed by `else if (something_else)` is NOT promotable, but the lint must not fire on this as a "near miss" — it should detect "mixed discriminator" and fire compound-condition info, not near-miss.

5. **Lint message overload.** If a file has 30 promotable sites, surfacing 30 info messages is noise. Consider `I-MATCH-PROMOTABLE` defaults to file-level summary ("12 promotable sites in this file; run `bun scrml promote --match <file>` to see them") with `--verbose` mode for per-site detail.

## Marketing leverage

This is a **scrml-flavored differentiation play**. React/Vue/Svelte have nothing like compiler-suggested-and-CLI-executed tier promotion. Adoption-post material:

- "scrml's compiler tells you when your code is ready to lift" (the lint)
- "your CLI does the lift" (the command)
- "no silent rewrite, no typos, no wasted afternoon manually transforming a 30-arm if-else into match" (the value)

`formFor` is the marketing flagship for L22 family; **promotion ergonomics is the marketing flagship for the tier-ladder system itself**. Pairs with the tier-ladder-promotion article (`docs/articles/tier-ladder-promotion-devto-2026-05-04.md`) which has been waiting for "what's the canonical Tier 1 value-return form?" execution-item-#3 to land — promote --match would close that loop concretely.

## Dispatch readiness checklist

When firing:
- ✅ B3 landed (verify before dispatch)
- ✅ Bundle A+ verdict items (#1 + #2 + #3 from S64 carry-forward)
- ✅ Path: general-purpose no-isolation per S64 hand-off note 43
- ✅ Brief includes kickstarter + anti-patterns brief
- ✅ Strong incremental commit instructions
- ✅ Survey-first phase recommended (~1-2h) — `bun scrml migrate` infrastructure may carry significant scaffold

## Tags

#promotion-ergonomics #i-match-promotable #bun-scrml-promote #cli #tier-ladder #a-plus-verdict-fold-in #depends-b3 #marketing-flagship #scope-stashed
