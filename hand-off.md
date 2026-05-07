# scrmlTS — Session 65 (CLOSE — predicate-Zod deep-dive · debate-05 5/5 C-narrow · npm-myth amend · parseVariant SCOPE)

**Date opened:** 2026-05-06
**Date closed:** 2026-05-06 (same calendar day; medium-length session ~80% deliberation, 20% docs)
**Previous:** `handOffs/hand-off-64.md` (S64 close — substantial work landed across 3 debates + Stage 0c.A + B2 + Phase 4d)
**This file:** rotates to `handOffs/hand-off-65.md` at S66 open

**Tests at close:** **8,941 / 44 / 1 / 0 / 8,986 / 440** (unchanged from S64 — S65 was deliberation + docs only).

---

## TL;DR — what landed in S65

| Thread | Outcome | Path |
|---|---|---|
| Predicate-Zod-replacement deep-dive | ✅ LANDED | `scrml-support/docs/deep-dives/predicate-system-zod-replacement-2026-05-06.md` (608 lines) |
| Debate-05 brief + 5 expert positions + transcript + judgment | ✅ LANDED | `scrml-support/docs/debates/debate-05-*-2026-05-06.md` |
| Design insight #4 appended | ✅ LANDED | `scrml-support/design-insights.md` (line 1387+) |
| npm-myth article amended | ✅ LANDED | `docs/articles/npm-myth-devto-2026-04-28.md` lines 44-48 |
| X-snippet drafted (3 variants) | ✅ DRAFT — awaits Bryan | `docs/articles/x-snippet-zod-calibration-2026-05-06.md` |
| parseVariant implementation SCOPE | ✅ LANDED — awaits dispatch authorization | `docs/changes/parsevariant-impl/SCOPE.md` |
| master-list.md + changelog updates | ✅ LANDED | both |

**Final commit count:** scrmlTS 2 commits; scrml-support 4 commits; total 6 commits across 2 repos. **Pushes pending.**

---

## BIG DECISION RATIFIED THIS SESSION

### Boundary-parsing primitive — debate-05 verdict (5/5 unanimous C-narrow)

Convener: **Bryan strongly leaned yes** (anti-sycophancy stance — fired debate to test the lean). Verdict: **lean validated but narrowed** from full Approach A to C-narrow.

**Ship `parseVariant(json, EnumType)`. Close `parseShape` as intentional absent.**

Constraints (load-bearing — judge-ratified):
1. Second arg MUST be scrml-native `enum` type descriptor (not struct, not arbitrary type literal)
2. Discriminator key = enum's own variant names; no custom field name; no name-mapping table
3. Returns typed enum value or fails with `::ParseError msg`
4. Companion design statement closing `parseShape` ships with the addition

**Why not `parseShape`?** It's a synonym for §53 SPARK boundary-zone refinement on assignment. The synonym-detection test (debate-04 methodology) demoted it. Adding it would be stdlib bloat with no distinct semantic shape.

**Why `parseVariant`?** It's the type-establishment step for sum types — constructor selection from a discriminator field is what predicate systems can't perform. SPARK is the predicate-enforcement step that fires AFTER type-establishment. They're sequentially ordered, not substitutable. The DON'T-SHIP forfeit is paid on every tRPC integration in user code, forever.

### Pro-X-voice-voting-against-X at frequency-3 (methodology-grade signal)

| Debate | Expert | Default | Vote | Mechanism |
|---|---|---|---|---|
| debate-03 | roc-expert | retain component-overload carve-out | retracted | structural-element reframe |
| debate-04 | crystal-multi-dispatch | sanction switch as Tier 0+ | voted A (hard-error) | synonym-not-sliver |
| **debate-05** | **simplicity-defender** | **refuse stdlib expansion (B)** | **C-narrow** | **synonym test on `parseVariant`** |

Frequency-3 confirms: when a partisan-defender voice flips under its own methodology lens, the rejection is structurally stronger than expected agreement.

---

## DESIGN-INSIGHT contributions this session

### Insight #4 (debate-05): "Type-establishment vs predicate-enforcement are sequentially ordered, not substitutable"

When a language has a type-enforcement mechanism that operates on already-typed values (scrml's §53 SPARK three-zone enforcement), a natural assumption is that "parse unknown external data into a typed value" is covered by that mechanism. **It is not — these are sequentially ordered operations.** The type-establishment step (constructor selection from a discriminator) must happen *before* predicate enforcement can fire. A stdlib designed to replace an external parsing library must decompose into both steps. A language designer who provides only the second forces every developer to hand-roll the first forever.

The further refinement: the decomposition is type-specific. **For sum types** (enums, discriminated unions), the type-establishment step requires constructor selection — a closed, compiler-derivable operation that predicate systems cannot perform. **For product types** (structs), the type-establishment step collapses into "assign the fields," which a sound boundary-enforcement system already does. The stdlib primitive is justified for the sum-type case and is a synonym (bloat risk) for the product-type case.

The sliver test for any boundary-parsing primitive: **does this type's type-establishment step require operations that the language's predicate-enforcement mechanism cannot perform?** For sum types in a nominally-typed language: reliably yes. For product types under sound boundary enforcement: reliably no.

---

## A+ verdict execution carry-forward (from S64 — STILL pending)

These three items from debate-04 verdict have NOT yet been implemented (carried from S64 hand-off):

1. **`did-you-mean: match` quickfix on E-SWITCH-FORBIDDEN** — ~1-2h
2. **W-LIFECYCLE-CANDIDATE tightening** on `if=` over enum-tag-shaped string-literal RHS — ~1h
3. **Document JS-style `match expr {}` form as canonical value-return rung** in primer §1 + tier-ladder-promotion article — small

Combined: ~3-5h dispatch. Could fold into B3 or parseVariant work.

---

## Open questions to surface immediately at S66 open

1. **parseVariant implementation path selection.** SCOPE doc analyzes Path A (compile-time-special-form, 20-30h), Path B (schema-as-value, 8-12h), Path C (hybrid-desugar, 10-15h; **PA lean**). Bryan's call before dispatch fires. The "type-as-argument" precedent decision is load-bearing.

2. **Dispatch sequencing — three options:**
   - (a) Fire parseVariant immediately (Path C, ~10-15h focused)
   - (b) Fire B3 (`@name` resolution) first per S64 plan; parseVariant after
   - (c) Stack both — parseVariant in background, B3 in foreground (no file overlap; should be safe)

3. **X-snippet selection.** 3 variants drafted at `docs/articles/x-snippet-zod-calibration-2026-05-06.md`. PA lean: variant 3 (long-form ~180 words) for credibility. Bryan picks or skips entirely.

4. **Companion follow-up dev.to article?** Variant 3 of X snippet narrates the debate-and-revise process. Optional follow-up article (`scrml-debate-amends-zod-claim-devto-2026-05-06.md`) could expand it. PA's view: skip — the npm-myth amendment + X post is sufficient. Avoid article-tail bloat.

5. **B3 dispatch readiness** — UNCHANGED from S64. `@name` resolution remains queued; no file conflicts with parseVariant work. 4-6h focused estimate (likely smaller).

6. **A+ verdict execution items** — UNCHANGED from S64 carry-forward. Could fold into next dispatch.

7. **Predicate-gaps inventory P-promotion** — under the Zod lens (deep-dive), 4 gaps promote to P1: `#17 transform/preprocess`, `#9 reqIf`, `#12 async predicates`, `#8 predicate aliases`. 3 new gaps surfaced (#18 named-shape breadth, #19 boundary-parsing — closing via parseVariant, #20 validator-set transform operators). Inventory revisit when A1c surfaces real-app friction OR adopter reports `reqIf` blocker.

8. **Carry-forward S62/S63/S64 unresolved set:**
   - Article truthfulness audit dispositions (15 articles, S59 carry-forward)
   - scrml.dev v0.2.0 announce refresh
   - 6 KEEP-RECENT-LANDED dirs deref (now eligible after large S64+S65)
   - Maps refresh root cause investigation (S61 issue still open)
   - Tier-ladder em-dashes decision

---

## Things S66 PA needs to NOT screw up

Standing list 1-47 from S64 hand-off carries forward verbatim. New S65 additions:

48. **`parseVariant` is the verdict-locked answer for sum-type boundary parsing.** Don't let any agent re-frame it as `parseShape`-equivalent or extend its scope to structs. The synonym test demoted `parseShape` for a reason; that decision is locked.

49. **`parseShape` is CLOSED as intentional absent** — by debate-05 verdict + judge ratification. Struct boundary parsing is a server function or §53 boundary-zone refinement on assignment. Don't accept "but `parseShape` would be ergonomic" as a re-open argument. The companion design statement must ship with the parseVariant implementation.

50. **Type-establishment-vs-predicate-enforcement is sequentially ordered.** SPARK boundary-zone refinement fires AFTER the value has a type. `parseVariant` is the operation that gives the value a type. Anyone proposing "just use refinement at the call site" for unknown JSON is missing the sequencing.

51. **String-discriminator trap mitigation = enum-only second-arg constraint at the type system.** Not a documentation concern; a compiler-enforced rule. `parseVariant(json, MyStruct)` must produce a clear "must be enum" compile error.

52. **Pro-X-voice-voting-against-X is methodology-grade signal at frequency-3.** Apply going forward: when a partisan-defender flips under its own methodology, weight the flip heavily.

53. **Article amendment posture is calibrated, not retracted.** Form-validation claim ("Zod can't fail your build. This can.") is unmodified — it survives every test. The boundary-parsing claim was overreach in absolute form ("None of it. Ever.") and is now narrowed. Don't let any agent further-soften the form-DX claim.

54. **The deep-dive's 17-gap predicate inventory was re-prioritized under the Zod lens.** P1 promotions: #8 (aliases), #9 (reqIf), #12 (async), #17 (transform/preprocess). Demoted to elimination: #1 (between), #2 (nonempty) — synonyms. Don't re-introduce demoted items under different names without sliver-test verification.

---

## State as of S65 close (verified at wrap)

| Field | Value |
|---|---|
| scrmlTS HEAD (post-wrap) | `3bef6e6` (S65 outflows commit) — push pending |
| scrmlTS origin sync | 2 commits ahead of origin/main (push pending) |
| scrml-support HEAD (post-wrap) | `c9c2182` (debate-05 judgment + insight) — push pending |
| scrml-support origin sync | 4 commits ahead of origin/main (push pending) |
| Tests | **8,941 / 44 / 1 / 0 / 8,986 / 440** (full suite) |
| Working tree (both repos) | clean (after master-list + changelog + hand-off rewrite committed) |
| Inbox | empty |
| Active agents (post-S65) | 45 (unchanged from S64) |
| Permissions whitelist | unchanged |
| Depth-of-survey-discount counter | 6 (unchanged — no new audit-vs-survey events this session) |
| Design insights count (since 2026-03-22) | 30+ entries; 1 new in S65 (#4 boundary-parsing) |

### File-modification inventory (S65 — for cherry-pick / forensic review)

**scrmlTS commits (2 from session-open `0dee2f7`):**
1. `3bef6e6` — docs(s65): debate-05 outflows — npm-myth amend + X snippet + parseVariant scope
2. (session-close commit) — master-list + changelog + hand-off updates

**scrml-support commits (4 from session-open `9123af6`):**
1. `d05c79a` — debate-05 brief
2. `b2de9f6` — 5 expert positions
3. `d008caf` — debate-05 transcript assembled
4. `c9c2182` — debate-05 JUDGED + design insight #4

**Articles touched:**
- `docs/articles/npm-myth-devto-2026-04-28.md` — lines 44-48 amended (`published: true`; PUBLISHED article — public correction effective with this commit; X amendment pending Bryan's selection)
- `docs/articles/x-snippet-zod-calibration-2026-05-06.md` — NEW (`published: false`; draft for Bryan)

**Globals:** none (no agent forges this session).

---

## Cross-references

- **S64 close ledger (this rotation):** `handOffs/hand-off-64.md`
- **S65 working ledger (this file becomes):** `handOffs/hand-off-65.md` at S66 open
- **PA scrml expert primer (READ FIRST every session):** `docs/PA-SCRML-PRIMER.md` (last updated S64)
- **PA directives:** `pa.md`
- **Master-list dashboard (live progress):** `master-list.md` §0
- **parseVariant SCOPE document:** `docs/changes/parsevariant-impl/SCOPE.md`
- **X-snippet draft:** `docs/articles/x-snippet-zod-calibration-2026-05-06.md`
- **Debate-05 transcript:** `../scrml-support/docs/debates/debate-05-boundary-parsing-primitive-2026-05-06.md`
- **Debate-05 judgment:** `../scrml-support/docs/debates/debate-05-judgment-2026-05-06.md`
- **Debate-05 brief:** `../scrml-support/docs/debates/debate-05-boundary-parsing-primitive-2026-05-06-BRIEF.md`
- **5 position files:** `../scrml-support/docs/debates/debate-05-position-*-2026-05-06.md`
- **Predicate-Zod deep-dive:** `../scrml-support/docs/deep-dives/predicate-system-zod-replacement-2026-05-06.md`
- **Predicate-gaps inventory (re-prioritized):** `../scrml-support/docs/predicate-gaps-inventory-2026-05-06.md`
- **Design insights:** `../scrml-support/design-insights.md`

---

## Tags

#session-65 #close #predicate-zod-deep-dive #debate-05-judged #c-narrow-verdict #parsevariant-scope-landed #parseshape-closed #npm-myth-amended #x-snippet-drafted #design-insight-4 #pro-x-voting-against-x-frequency-3 #anti-sycophancy-convener #methodology-stack-triangulation #L22-pending
