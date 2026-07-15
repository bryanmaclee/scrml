# sPA ss62 — conformance authoring: value-native maps §59 + refinement types §53 (the value data-model)

**Launch:** `read spa.md ss62` · **Branch:** `spa/ss62` · **Worktree:** `../scrml-spa-ss62`

**Fill:** conformance-authoring toward the freeze bar (S235), Tier-2. Two shipped value-model surfaces are UNCOVERED (zero cases): **value-native maps §59** (`[K:V]` / `set[K]`, value-canonical keying, `==` order-independence — 7 `E-MAP-*` codes) and **refinement types §53** (predicate-carrying type annotations, compile+boundary enforcement; incl. enum-subset §53.15). Both are core to scrml's "value not object" data-model axiom. NEW S235 · **fireable now** (data-only; disjoint).

**Method + harness ceiling + escalate discipline:** see `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (same). Both surfaces are harness-clean (value ops + compile-time checks; no timers/DB/WS).

## Shared ingestion
The value data-model: §59 (value-native maps — `[K:V]` literal / `[:]` empty / `.insert`/`.has`/`.size`/`.elements()`; value-canonical key §59.5; order-independent `==` §45.7; `set[K]` §59.12; the 7 `E-MAP-*` codes) · §53 (refinement types — predicate on a type annotation; compile-time + runtime-boundary; `E-REFINEMENT-*`; enum-subset §53.15 → E-MATCH-SUBSET-DEAD-ARM). Mirror `conformance/cases/reactive/` + `derived/` for the value-state shape.

## Core files
`conformance/README.md` · `conformance/cases/reactive/` + `conformance/cases/derived/` (existing) · `conformance/run.ts` · `compiler/SPEC.md` §59 + §53 + §45 (normative)

## Items (least-ingestion-first)
1. **maps §59 core ops** (RT) `[status=pending]` — `<m>: [string:int] = [:]`; `.insert(k,v)` / `@m[k]` read / `.has(k)` / `.size`; iterate `.elements()` in an `<each>`. RT: assert state + DOM after inserts/reads.
2. **maps value-canonical keying §59.5 + `==` §45.7** (RT+codes) `[status=pending]` — struct/enum keys keyed by value (not reference) → agree with `==`; order-independent map `==`; `E-MAP-KEY-NOT-COMPARABLE` / `E-MAP-KEY-IS-MAP` (codes).
3. **maps diagnostics §59** (codes) `[status=pending]` — `E-MAP-BRACKET-WRITE` (`@m[k]=v` forbidden) · `E-MAP-LITERAL-MALFORMED` · the `W-MAP-*` info lints (iteration-order / duplicate-literal-key).
4. **refinement types §53** (RT+codes) `[status=pending]` — `<email>: string(pattern(/…/))`; a conforming value inhabits the type, a non-conforming one is rejected at the compile+boundary (stronger than a state validator). RT: boundary-check fires; codes: the `E-REFINEMENT-*` family.
5. **enum-subset refinement §53.15** (codes) `[status=pending]` — a subset-typed cell + a `match` over it: the exhaustiveness NARROWS to the subset; an arm for an excluded variant → `E-MATCH-SUBSET-DEAD-ARM`.

**DoD:** maps §59 + refinement §53 reach conformance coverage; all green; divergences escalated.

## Progress
`spa-lists/ss62.progress.md`. Land per-item on `spa/ss62`; ping PA inbox. Do NOT push. PA re-integrates + run.ts green. ESCALATE impl#1-vs-SPEC divergences.

## Wave-2 — tier-1 code-exhaustive completion (S256 audit)
Items 1-5 above are LANDED — do NOT touch them. This section adds the freeze-blocking **`==`
strict-semantics** codes (§45) the S256 tier split places in tier-1 ("`==` strict-semantics" soundness
family — the silent-wrong class where a wrong comparison compiles). Same method + core files as above
(§45 read in full per code). Grep each code live in `compiler/src` for its exact trigger. Harness-clean.
> No additional refinement/map tier-1 codes: the §59 map + §53 refinement families are tier-2 (covered by
> items 1-5). This Wave-2 is the equality set only.

6. **E-EQ-001** (codes) `[status=pending]` — `cannot compare X and Y` with `==` — incomparable types (`gauntlet-phase3-eq-checks.js:613`). Pos (`==` across incomparable types → E-EQ-001) + neg (comparable same-type `==` → silent).
7. **E-EQ-002** (codes) `[status=pending]` — an `==` misuse detected in the AST builder (`ast-builder.js:4701`). Grep the exact trigger; pos + neg.
8. **E-EQ-003** (codes) `[status=pending]` — a map-key type not comparable for `==` (`type-system.ts:2599`, "map key type ..."). Pos + neg.
9. **E-EQ-004** (codes) `[status=pending]` — an `==` misuse sibling in the AST builder (`ast-builder.js:4685`). Grep the exact trigger; pos + neg.
10. **W-EQ-PAYLOAD-VARIANT** (codes/severity) `[status=pending]` — the always-false `==` on a payload-carrying variant, a warning-level lint (`type-system.ts:14610`). Pos (`==` on a payload variant → warning) + neg + a `severity:"warning"` assertion.

**Wave-2 DoD:** all 5 equality codes pinned (codes + severity); every case GREEN on run.ts; divergences ESCALATED.
