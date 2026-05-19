---
title: schemaFor — SCOPING + L22 family-discipline gate-walk
date: 2026-05-19
session: S103
authority: SPEC §53.14.3 (`schemaFor(StructType)` planned; sliver-test PASSES) + §53.14.4 (family discipline) + §39 (schema + migrations) + L4 (partial validator vocabulary unification — no bilingual schema) + family-precedent doc `scrml-support/docs/type-as-argument-family-2026-05-06.md`
family_position: THIRD active L22 member (after parseVariant S65 + formFor S102-S103; serialize STASHED S103 `13e7919`)
status: 5/5 OQs RATIFIED S103 — deep-dive AUTHORIZED (Q-SCH-OPEN-1 YES); SPEC+impl-without-deep-dive REJECTED (Q-SCH-OPEN-2 NO); surface form (markup-element vs function) MUST BE DEBATED in deep-dive — PA-lean DROPPED per S103 user-direction correction (Q-SCH-OPEN-3); FK derivation OUT-OF-SCOPE for v1.0 (Q-SCH-OPEN-4 NO); schemaFor advances OVER formFor marketing-shaped follow-ons per pa.md Rule 1 (Q-SCH-OPEN-5)
---

# schemaFor — SCOPING

## What this doc is for

L22 family-roadmap next active member after Path B pivot from serialize (S103 `13e7919`). This SCOPING walks the four §53.14.4 gates honestly + structures the deep-dive briefing for gate 4.

**Pre-flight snapshot:**

- Gate 1 (per-shape sliver test) — **STRONG PASS** expected: no existing surface generates SQL DDL from a struct type definition.
- Gate 2 (synonym-detection precondition) — **STRONG PASS** expected: manual `<schema>` block authoring is the alternative; that's per-app authoring, not language-level type-driven generation. NO synonym from existing primitives.
- Gate 3 (asymmetric forfeit-cost) — **STRONG**: without schemaFor, struct type + `<schema>` SQL DDL drift apart. Closes the §39+L4 vocabulary-unification loop ("define type once → schema, form, validator, parser all derive") that has been waiting since L4 landed (S58).
- Gate 4 (per-feature deep-dive) — **RECOMMENDED FIRE**: 6-10 design OQs structurally similar to formFor's 10 OQs at parallel scale.

Closes a multi-quarter-old loop: L4 vocabulary unification (`req`/`length`/`pattern`/`min`/`max`/etc. shared across state-validator + refinement-type + schema-column loci) means scrml has the SAME predicate vocabulary in three places. Authoring it once in the struct type definition + having schemaFor derive the SQL DDL is the natural completion of the loop.

---

## Pre-dispatch corpus-ouroboros check (S101 standing rule)

Per S101 rule — before authoring SCOPING, verify no shipped surface already covers schemaFor:

```
git log --grep=schemaFor 2026-05-01..HEAD
git grep -l "schemaFor\b" -- '*.scrml' '*.ts' '*.js' '!docs/' '!*.test.*'
```

Confirmed: zero shipped schemaFor surface. The `<schema>` block-form (§39) is hand-authored DDL today. The struct type definitions (§14.3) exist independently. The two surfaces share predicate vocabulary (per L4) but no derivation path connects them.

---

## §1. Authority chain

1. **SPEC §53.14.3** — family roster (current row: "planned | PASSES — emits `<schema>` SQL DDL from struct field predicates. Closes the §39 + L4 vocabulary-unification loop")
2. **SPEC §53.14.4** — family discipline (4 gates per addition)
3. **SPEC §39** — schema + migrations + the SQL-mirror canonical surface
4. **L4** — partial validator vocabulary unification (S57 lock); the precondition that makes schemaFor STRUCTURALLY POSSIBLE
5. **Family-precedent doc** at `scrml-support/docs/type-as-argument-family-2026-05-06.md`
6. **formFor SCOPING precedent** at `docs/changes/formFor-scoping/SCOPING.md` (gate-walk shape + deep-dive structure)

---

## §2. Gate 1 — Per-shape sliver test

**Question:** is schemaFor a sliver of something already expressible, or does it carve a distinct shape?

**Current alternatives that achieve "derive SQL DDL from a struct type":**

| Surface | Coverage of "schemaFor(StructType)" | Gap |
|---|---|---|
| Hand-authored `<schema>` block (§39) | 100% on emitted DDL | Requires duplicating struct field shape + predicate vocabulary in two places (struct + schema); drift risk |
| `^{ const schema = reflect(StructType); ... }` meta block | Theoretical — `reflect` exposes type metadata; user could format it as DDL | Per-app meta authoring; no language-level guarantee; no standard SQL-mapping table |
| Generic ORM (e.g., Drizzle/Prisma model annotation) | Not available — scrml has no ORM | n/a |

**The 100% gap:** scrml literally has NO surface that derives SQL DDL from a struct type. The L4 vocabulary unification (`req` / `length` / `pattern` / etc. work in state-validator + refinement-type + schema-column) makes the derivation STRUCTURALLY POSSIBLE — the same predicates on a struct field can mechanically lower to `CHECK` constraints (per §39.5.8 lowering rules) — but no primitive performs that lowering today.

**Sliver-test verdict:** **STRONG PASS.** schemaFor carves a distinct shape (type-driven DDL derivation) that no existing primitive covers. This is the L22 family's clearest case after formFor (which generates markup) — schemaFor generates SQL.

---

## §3. Gate 2 — Synonym-detection precondition

**Claim:** schemaFor is NOT a synonym for any existing surface.

**Cross-check against canonical synonyms (the rejected precedent triplet per §53.14.4):**

| Synonym precedent | Was it a synonym? | Why | Does schemaFor look like this? |
|---|---|---|---|
| `parseShape(json, StructType)` | YES — synonym for §53.4 SPARK boundary refinement | Predicates + boundary-typed assignment already cover struct boundary parsing | **NO** — schemaFor emits DDL, not refined values |
| `parallel` attribute on `<engine>` | YES — synonym for nested engines + derived engines + `<onTransition>` | Per-kind mini-DSL eliminated by Pillar 5 | **NO** — schemaFor is not a per-kind variant of an existing primitive |
| `zod-schema-as-validator` | YES — synonym for `custom(fn)` slot in stdlib/data/validate.scrml | Existing escape-hatch already covers the shape | **NO** — schemaFor is not a validator |
| `wireEncode(v)` (serialize stash precedent) | likely YES vs serialize — stdlib helper would cover wire-format-encoding without type-as-argument | scrml's `_scrml_wire_encode` already exists | **NO** — schemaFor has no stdlib-helper analog; SQL DDL generation from struct shape requires type-driven compile-time work |

schemaFor is structurally orthogonal to all four precedents. SQL DDL generation from a struct type is uniquely served by L22 type-as-argument: the type IS the source of truth for column shapes + nullability + predicates; runtime value can't tell you what the table schema should be.

**Verdict — Gate 2 STRONG PASS.** No synonym exists.

---

## §4. Gate 3 — Asymmetric forfeit-cost decomposition

**Cost of NOT shipping schemaFor:**
- Adopters maintain struct field shape + `<schema>` DDL in lockstep manually
- Predicate vocabulary lives in TWO places per type (struct + schema) — drift risk per refactor
- L4 vocabulary-unification loop stays open structurally (the alignment exists in spec; no automation)
- Migration story stays manual: struct change → adopter writes `<schema>` change → schema-differ.js detects DDL drift → migration emitted. With schemaFor, the second step is automated.
- §53.14.3 family-roster row stays "planned" indefinitely

**Cost of shipping schemaFor:**
- ~12-18h dispatch (architecture: type-system pass + emit-schema-for.ts + 4-8 error codes + tests + integration with §39 schema-differ.js)
- L22 family-cost amortization (paid once across all family members)
- v0.4+ horizon work
- Adds another type-as-argument special form (more compiler surface)
- Integration with schema-differ.js — must produce DDL shape compatible with the existing diff algorithm

**Verdict — Gate 3 STRONG.** Forfeit-cost of NOT shipping is structural (vocabulary-unification loop stays open + drift risk persists). Forfeit-cost of shipping is bounded engineering cost paid once. The L4 lock structurally REQUIRES this surface to be language-level — letting adopters write a per-app `^{ const ddl = ... }` would create N-way drift.

---

## §5. Gate 4 — Per-feature deep-dive (RECOMMENDED FIRE)

Per the §53.14.4 methodology rule, Gate 4 fires when:
- Gates 1+2+3 PASS but design surface has substantive open questions, OR
- Convener has substantive doubts, OR
- OQ count exceeds ~5 with MEDIUM-or-lower confidence

Gates 1+2+3 are STRONG PASS, but the design surface has ~6-10 OQs at MEDIUM to MED-HIGH confidence. Deep-dive RECOMMENDED but tighter scope than formFor (which had 10 OQs + structural genuine-design surface questions like slot-style vs function-attr customization).

**Anticipated deep-dive questions (OQs):**

1. **OQ-SCH-1** — Surface form. Markup-element `<schemaFor for=Users/>` (mirrors formFor) vs function call `schemaFor(Users)` returning a string vs block-attribute `<schema source=Users/>`? Tension: schemaFor's output is a DDL string, not markup. Markup-element form feels forced; function form feels more honest.
2. **OQ-SCH-2** — Output shape. Full `<schema>` block (with table name from struct name) vs just the table-definition body (caller wraps in `<schema>`)? Affects ergonomics + multi-table composition.
3. **OQ-SCH-3** — Multi-table composition. `<schema>${schemaFor(Users)} ${schemaFor(Posts)}</>` for two tables in one schema vs a `schemaFor([Users, Posts])` array form?
4. **OQ-SCH-4** — Foreign key derivation. If struct `Post` has `author: User`, does schemaFor emit `author_id INTEGER REFERENCES users(id)` automatically? Tension: requires inferring the FK column-naming convention.
5. **OQ-SCH-5** — Refinement-type predicates → SQL CHECK. L4 + §39.5.8 lowering rules say `req → NOT NULL`, `length(>=N) → CHECK`, etc. Automatic per the spec, OR opt-in per field? PA leans automatic (the whole point of the loop closure).
6. **OQ-SCH-6** — schema-differ.js integration. schemaFor's output feeds schema-differ.js for migration emission. Already works since output is DDL string. Confirmation gate, not new design.
7. **OQ-SCH-7** — Nested struct types. `Post { author: User }` — does schemaFor recurse into User to derive author table? Probably NO per v1.0 (mirror formFor OQ-FF-11 deferral); explicit per-struct schemaFor calls needed.
8. **OQ-SCH-8** — Column name override. Field `email` becomes column `email`. Override mechanism? `@column("user_email")` type-field annotation (reserved for v1.next, mirrors formFor `@label("...")` OQ-FF-7 reservation)?
9. **OQ-SCH-9** — Failure mode. Struct field type that doesn't have SQL mapping (e.g., a function type, a Promise type) — fail at compile time (E-SCHEMAFOR-NO-SQL-MAPPING)? Mirror formFor's E-FORMFOR-* shape.
10. **OQ-SCH-10** — Relationship to existing `<schema>` block-form. schemaFor doesn't REPLACE block-form — both coexist. But does schemaFor's output need to be CONSISTENT with what the block-form parser would accept? (Probably yes for round-trip with schema-differ.)

**~10 OQs** at mostly MED-HIGH confidence per the methodology rule. Deep-dive justified but several may close in deep-dive without debate (per S102 OQ-FF-7 precedent: HIGH/MED-HIGH closes in deep-dive directly).

---

## §6. SPEC delta surface (anticipated post-deep-dive)

| Section | Delta | Cost |
|---|---|---|
| §53.14.3 | Update family-roster row for schemaFor — sliver-test PASSES → SHIPPED | trivial (1 row) |
| §53.14.5 | Extend type-as-argument primitive recognition list — name `schemaFor` | trivial (1 line) |
| §41.15 | NEW subsection for schemaFor API — mirror §41.14 formFor shape; ~80-120 lines | medium |
| §39.5 | Cross-ref to schemaFor as the automated path for `<schema>` derivation; integration with §39.5.8 lowering | small (~5-10 lines) |
| §34 | +4-8 `E-SCHEMAFOR-*` error codes per the design surface (mirror E-FORMFOR-* shape) | small per code |
| §53.14.4 | Possibly amend gate examples with schemaFor's vocabulary-unification-loop-closure shape | optional |

---

## §7. Implementation path (anticipated post-deep-dive, post-SPEC-amend)

Mirror parseVariant + formFor architecture:

1. **Type-system pass** — detect `<schemaFor for=Users/>` (or `schemaFor(Users)` function form per OQ-SCH-1 resolution); resolve type identifier; gate per Gate 9 failure modes.
2. **Codegen pass** — NEW `emit-schema-for.ts`. Walk struct field declarations → produce DDL string. Lower L4 predicate vocabulary per §39.5.8.
3. **Runtime** — no runtime hooks needed (DDL is compile-time string). Possible: stdlib export for `schemaFor` as MOD-stage stub (mirror parseVariant + formFor patterns) per OQ-SCH-1 resolution.
4. **Tests** — unit (per-struct DDL shape verification) + integration (compile-and-execute against schema-differ.js for migration emission round-trip).
5. **Stdlib re-export** — `import { schemaFor } from 'scrml:data'` (mirror formFor S103 `b80ce2a` precedent) — may bundle into the same dispatch as the codegen work.

**Cost-class:** ~12-18h dispatch (mirrors parseVariant Phase 2; formFor impl ran ~25h with the markup synthesis overhead; schemaFor is simpler — string output, no markup synthesis).

---

## §8. Risks + mitigations

- **Risk:** schemaFor's output drifts from what schema-differ.js's parser expects. Mitigation: round-trip test (schemaFor output → schema-differ.js parser → recover original) baked into integration tests.
- **Risk:** OQ-SCH-4 (foreign key derivation) opens a per-app convention that doesn't generalize. Mitigation: v1.0 ship WITHOUT auto-FK derivation; defer to v1.next or require explicit `@references(Table.id)` type-field annotation.
- **Risk:** OQ-SCH-7 (nested struct recursion) — adopter expects `Post { author: User }` to auto-emit both tables. Mitigation: explicit error message naming the workaround (per-struct schemaFor calls); mirror formFor's E-FORMFOR-NESTED-STRUCT-NO-SLOT precedent.
- **Risk:** byte-identity invariant (S102 PGO discipline) — this dispatch ADDS new emit-schema-for.ts output for files using schemaFor; intended bundle-shape change. Document explicitly.
- **Risk:** SCOPING text vs implementation drift (per Phase 3 select-row's "class:editing" vs "if=" mismatch precedent) — verify SCOPING examples match actual emit shape during deep-dive.

---

## §9. Open questions — RATIFIED S103 (5/5 per PA-lean)

User ratified all 5 OQs per the recorded PA-leans (S103, 2026-05-19). Each OQ closed below.

1. **Q-SCH-OPEN-1 — Authorize deep-dive?** **RATIFIED: YES.** ~3-5h structured research dispatch via scrml-deep-dive agent. Output target: `scrml-support/docs/deep-dives/schemaFor-design-2026-05-19.md`. Resolves the ~10 OQs (OQ-SCH-1..10) listed in §5 above.
2. **Q-SCH-OPEN-2 — Skip deep-dive + go directly to SPEC + impl?** **RATIFIED: NO.** OQ surface is non-trivial; precedent (formFor S102 deep-dive surfaced design concerns the SCOPING alone missed) supports the methodology.
3. **Q-SCH-OPEN-3 — Surface form (markup-element vs function form)?** **RATIFIED: BOTH FORMS DEBATED (S103 user-direction correction).** PA-lean toward function-form `schemaFor(Users)` does NOT carry into deep-dive as the working assumption — the surface form is open. Deep-dive MUST stage a debate between Form A (markup-element `<schemaFor for=Users/>` mirroring formFor's chosen shape per OQ-FF-1 verdict) and Form B (function call `schemaFor(Users)` returning DDL string). Form C (block-attribute `<schema source=Users/>`) may surface as a third alternative — include if a structural argument supports it. The debate verdict closes Q-SCH-OPEN-3; PA-direct ratification is REJECTED here per user direction (precedent: OQ-FF-1 slot-style debate verdict 51.5/60 wins by argument-quality, not by PA-lean carry-forward).
4. **Q-SCH-OPEN-4 — FK derivation in v1.0?** **RATIFIED: NO.** Explicit-over-implicit; mirror formFor's nested-struct-no-auto-recurse precedent (OQ-FF-11 deferral). v1.next can add `@references(Table.id)` type-field annotation when adopter friction signals.
5. **Q-SCH-OPEN-5 — Sequencing vs formFor follow-ons?** **RATIFIED: schemaFor advances over formFor marketing-shaped follow-ons per pa.md Rule 1** (no marketing/article/tweet work unless explicitly raised). The substantive bar is "compiler working as planned"; formFor's stdlib + impl already shipped — sample-app / scrml.dev refresh / README compile-gate are Rule-1 deferred. Conformance corpus expansion + `disabled=!@cell` reactive-attr fix remain possible parallel work but NOT a blocker for schemaFor.

**Operational consequence:** deep-dive dispatch fires next; output lands at the named scrml-support path; resolves the 10 OQ-SCH-* design surface questions; gates the SPEC + impl phase that follows.

---

## §10. Sequencing within the L22 family roadmap

```
parseVariant ✓ (S65)
formFor      ✓ (S102-S103, shipped end-to-end incl. stdlib re-export)
serialize    ✗ STASHED S103 (Gate 2 synonym risk; revival-triggered)
schemaFor    ← THIS SCOPING (Path B selection)
tableFor     planned (after schemaFor; mirrors formFor markup-generation shape)
variantNames / reflective metadata    planned (smallest remaining)
```

**Estimated remaining family-roadmap cost** post-schemaFor (if all members ship):
- schemaFor: 12-18h dispatch (this SCOPING)
- tableFor: 15-25h (heavier — markup synthesis + sort/select state surface)
- variantNames + reflective: 4-8h (small primitive)
- = ~31-51h aggregate to family-complete (assuming serialize stays stashed)

---

## §11. Family-precedent doc update — ANTICIPATED, NOT DONE

After deep-dive + SPEC + impl land for schemaFor, append to `scrml-support/docs/type-as-argument-family-2026-05-06.md`:
- schemaFor row in the family-precedent table — sliver/synonym/forfeit-cost outcomes
- Gate-walk record: vocabulary-unification-loop-closure as the load-bearing forfeit-cost framing
- Discipline-working note: serialize stashed at the same session as schemaFor advanced (different gate-walk outcomes prove the discipline filters)

---

## §12. Tags

#l22-family #schemaFor #gate-walk #path-b-pivot #vocabulary-unification-loop #§39 #§53.14 #L4 #s103 #post-formFor #deep-dive-recommended
