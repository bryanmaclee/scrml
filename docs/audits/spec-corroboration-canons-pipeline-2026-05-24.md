---
status: complete
last-reviewed: 2026-05-24
session: 129
phase: 1b — canon-anchored corroboration audit + PIPELINE.md + SPEC re-pass
scope: PRIMER + kickstarter v2 + native-parser source + design-insights + user-voice (selected sessions) + PIPELINE.md; SPEC.md cross-checked at relevant sections (NOT walked sequentially — that is Phase 1a's job)
total-findings: 22 (3 cleared as false-positive / corroboration-only; 19 substantive findings)
by-category:
  CONTRADICTION: 4 (F-009, F-011, F-018, F-019)
  CANON-DRIFT: 9 (F-001, F-002, F-005, F-006, F-010, F-013, F-014, F-021, F-022)
  AMBIGUITY: 2 (F-004, F-020)
  HOLE: 2 (F-003, F-008, F-015)
  LEGACY-TEXT: subset of CANON-DRIFT (F-001, F-002, F-009, F-022 are pre-ratification text)
  EXAMPLE-DRIFT: 1 (F-014)
  cleared: 3 (F-007, F-012, F-016, F-017 — coverage-only)
by-severity:
  LOAD-BEARING: 11 (F-001, F-002, F-009, F-013, F-014, F-018, F-019, F-021, F-022 + critical-ratification family)
  MEDIUM: 5 (F-003, F-005, F-006, F-008, F-010, F-011, F-020)
  LOW: 2 (F-004, F-012)
---

# SPEC Corroboration Audit — Phase 1b (canons + PIPELINE.md + SPEC re-pass)

## Scope, method, conventions

This audit is the canon-anchored counterpart to Phase 1a's sequential SPEC.md walk. The anchors are the derived canons (PRIMER, kickstarter v2, native-parser source, design-insights, recent user-voice sessions) and PIPELINE.md. For each normative claim extracted from those anchors, SPEC.md is cross-checked at the corresponding section. Findings are recorded where the canon and SPEC do not agree, where SPEC is silent on a behavior a canon asserts, or where ambiguity surfaces.

### Taxonomy (6 categories)

- **CONTRADICTION** — two normative sources saying different things about the same surface.
- **CANON-DRIFT** (Phase-1b specific) — a derived canon (PRIMER / kickstarter / PIPELINE) makes a claim that SPEC.md does not corroborate. Subtype of CONTRADICTION; direction is constrained — SPEC is normative per Rule 4 unless a later ratification superseded SPEC text the SPEC didn't catch.
- **AMBIGUITY** — text admits multiple readings.
- **HOLE** — SPEC silent on a behavior the language must have an answer for (a canon makes a claim; SPEC has no normative statement backing it).
- **LEGACY-TEXT** — pre-ratification text never updated (subtype of CONTRADICTION; direction mechanically determined).
- **EXAMPLE-DRIFT** — a worked example doesn't match the normative statement adjacent to it.

### Per-finding fields

`id`, `title`, `category`, `severity`, `canon_source`, `spec_corroboration`, `the_conflict`, `cross_evidence`, `recommended_direction`, `notes`.

### Severity calibration

- **LOAD-BEARING** — core axis: decl forms, type-system, error-model, V5-strict, engine/match Tier ladder, no-async/await, `not` absence, no-null, markup-as-value, canon-vs-spec alignment.
- **MEDIUM** — non-core surface.
- **LOW** — pure doc drift.

### Recommended-direction policy

- Post-ratification SPEC text contradicting pre-ratification SPEC text → state direction (legacy loses).
- Derived canon contradicts SPEC AND SPEC reflects latest ratification → derived canon catches up to SPEC.
- Derived canon reflects later ratification than SPEC.md's text → SPEC catches up to ratification.
- Genuinely open → "GENUINE DESIGN QUESTION — heads-up decision."

## Summary

### Findings by canon source

| Canon source | Substantive findings | LOAD-BEARING |
|---|---|---|
| PRIMER | F-005, F-008, F-010, F-014 (4 of 19) | 2 (F-010 + F-014) |
| Kickstarter v2 | F-001, F-002, F-006, F-013, F-022 (5 of 19) | 4 (F-001, F-002, F-013, F-022) |
| Native-parser source | (corroborates F-002, F-014, F-021 — no DRIFT, only confirms canonical enforcement) | N/A |
| Design-insights | (file only has 2 entries; both align with SPEC text) | N/A |
| User-voice | F-002, F-009 surface (cross-evidence from S87/S114/S123/S129 ratifications) | covered above |
| PIPELINE.md | F-011, F-018 (PIPELINE side), F-021 (3 of 19) | 2 (F-011, F-021) |
| SPEC.md (caught en passant) | F-005, F-009, F-018, F-019 (4 of 19) | 4 (F-009, F-018, F-019 + cross-stream) |
| Multi-source (canon-vs-canon) | F-001, F-008, F-014, F-018 | several |

### Findings by SPEC section touched

| SPEC § | Findings touching | Severity span |
|---|---|---|
| §1 (Overview / Pillars) | F-010 | MEDIUM |
| §4.18 (Quoted-text model) | F-014 (PRIMER/kickstarter drift) | LOAD-BEARING |
| §6.1 / §6.10 (V5-strict + pinned) | F-009 + F-013 | LOAD-BEARING |
| §6.11 / §55.5 / §55.6 (validity surface) | F-005 + F-018 | MEDIUM / LOAD-BEARING |
| §6.13 (debounce/throttle attribute) | F-002 + F-022 | LOAD-BEARING |
| §7.5 (type-annotation grammar) | F-009 | LOAD-BEARING |
| §19.9.8 (no async/await) | F-003 | MEDIUM |
| §38 (channels) | F-001 | LOAD-BEARING |
| §39 / §40.8 (schema + program shape) | F-019 | LOAD-BEARING |
| §40.8 (default-logic body mode) | F-008 | MEDIUM |
| §51.0.C (engine auto-derive var) | F-021 | LOAD-BEARING |
| §51.0.F (engine rule= form) | F-004 | MEDIUM |
| §55.1 (universal-core predicate vocab) | F-006 | MEDIUM |
| PIPELINE Stage 7.6 (RS status) | F-011 | MEDIUM |
| PIPELINE Stage 3.05 NR (autoDeriveEngineVarName) | F-021 | LOAD-BEARING |
| PIPELINE Stage 6.7 VSS (synthesis trigger) | F-018 | LOAD-BEARING |

### Cross-section observations

**SPEC-internal contradictions (caught here, will overlap with Phase 1a):** F-005 (§6.11 stub vs §55), F-009 (§7.5 grammar vs §6.1 V-kill), F-018 (§55.5 within-section), F-019 (§39.12 E-SCHEMA-003 vs §39.2 + §40.8 examples). 4 instances. These are the highest-value findings — Phase 1a should independently surface them; corroboration is strong signal.

**Canon-vs-SPEC drift, direction "canon catches up to SPEC":** F-001 (kickstarter channels file-level), F-002 (kickstarter `@debounced(N)` retired), F-013 (kickstarter `<x> pinned` shape), F-014 (PRIMER bare-prose in code-default bodies), F-021 (PIPELINE NR suffix-strip), F-022 (kickstarter §11.4 recipe). 6 instances. Mechanical mass migration once direction is named.

**Canon-vs-SPEC drift, direction "SPEC catches up to canon":** F-005 (SPEC §6.11 stub still has singular `error`), F-009 (SPEC §7.5 grammar still has legacy decl form), F-010 (PRIMER Pillar 5b ahead of SPEC). 3 instances. Lower-volume but each is a SPEC amendment.

**HOLEs (SPEC silent on a behavior canon asserts):** F-008 (default-logic body mode not in PRIMER/kickstarter). 1 instance.

**AMBIGUITY:** F-004 (rule= form not contrasted in kickstarter). 1 instance.

**Coverage notes:**
- I did NOT exhaustively walk every native-parser .scrml file's predicates (a separate ouroboros risk; per memory `feedback_native_parser_scrml_predicate_drift` PA greps `.scrml` on landing — not Phase 1b's scope).
- I did NOT walk every example file in `examples/` directory at depth (per pa.md Rule 4 + S86 corpus-ouroboros warning; corpus is artifact, not normative).
- I did NOT cross-check every PRIMER §13.7 B-step's audit-grounded claim against the underlying audit (would require reading 14+ audit files; out of scope for inventory phase).

## Findings

### F-001 — Kickstarter v2 channels said "file-level"; SPEC §38.1 + PRIMER §9.1 say "inside `<program>`"

- **Category:** CANON-DRIFT (LEGACY-TEXT subcategory — pre-S87 text not refreshed)
- **Severity:** LOAD-BEARING
- **Canon source:**
  - Kickstarter §11.3 line 925: *"Channels are **file-level** in v0.next (NOT inside `<program>`)"*
  - Kickstarter §11.3 line 964: *"`<channel>` lives at file level, alongside `<program>`. Not inside it."*
  - Kickstarter anti-pattern table line 696 (cross-ref): channels framing as file-level.
- **SPEC corroboration:** §38.1 lines 16855-16863 — *"v0.3 Wave 1 direction REVERSAL (2026-05-12). The placement direction has been REVERSED. Under v0.3 channels live INSIDE `<program>` (entry file), not at file top level."* §38.1 normative bullet line 16942 explicitly mandates the inside-program placement. §38.5 v1→v0.next migration shows the three-stage history: v1 inside, v0.next file-level, v0.3 inside again.
- **The conflict:** Kickstarter (last-updated 2026-05-04 per its filename) describes the v0.next intermediate position (file-level). SPEC §38 was reversed S87 (2026-05-12) per Insight 30. Kickstarter is now stale by ~3 weeks and points adopters at the wrong placement.
- **Cross-evidence:**
  - PRIMER §9.1 line 419 corroborates SPEC: *"Channels live as **CHILDREN of the entry-file `<program>`**"* + cites Insight 30.
  - User-voice S87 (memory file `feedback_land_before_cleanup`) references the Insight 30 ratification by reference.
  - SPEC §34 catalog: `E-CHANNEL-OUTSIDE-PROGRAM` (line 15400) replaces retired `E-CHANNEL-INSIDE-PROGRAM` (line 15399 marked "Retired 2026-05-12").
  - PIPELINE.md — does not surface channel placement; topology-agnostic.
- **Recommended direction:** Kickstarter catches up to SPEC. The v0.3 placement (inside `<program>`) is normative; the kickstarter §11.3 recipe + anti-pattern table line + opening paragraph all need to flip. Mechanical change — replace "file-level" with "inside-program" wherever the kickstarter says it.
- **Notes:** Same shape as the "ouroboros" warning in memory (S86 corpus drift). The example file `examples/15-channel-chat.scrml` per PRIMER B19 §13.7 still uses v1 shapes — corpus is doubly stale.

---

### F-002 — Kickstarter `@debounced(N)` modifier was RETIRED at S79; SPEC §6.13 + PRIMER §4 use `debounced=DURATION`

- **Category:** CANON-DRIFT (LEGACY-TEXT — pre-S79 text not refreshed)
- **Severity:** LOAD-BEARING
- **Canon source:**
  - Kickstarter line 701 (anti-pattern table): *"Hand-rolled debounce in `effect()` → `@debounced(300) <debouncedQuery> = @query` — declaration modifier"*
  - Kickstarter line 761: *"use the language-level modifier `@debounced(N) <name> = expr`"*
  - Kickstarter §11.4 heading line 971: *"Reactive recipe — `const <name>` + `@debounced(N)` modifier"*
  - Kickstarter line 983 (worked example): `@debounced(300) <debouncedQuery> = @query`
  - Kickstarter line 1019: *"`@debounced(N) <name> = expr` — modifier on the declaration"*
- **SPEC corroboration:** §6.13 line 5287 — *"Supersedes the pre-v0.next `@debounced(N) name = expr` keyword-form modifier surface (deleted at S79; per the ratified Approach B 'no deprecation cycle since no real adopters' decision)."* §6.13.1 line 5294 shows canonical form `<searchTerm debounced=300ms> = ""`. PRIMER §4 line 96 corroborates with the attribute form + cross-refs SPEC §6.13.
- **The conflict:** The keyword-form `@debounced(N)` modifier was deleted at S79 (2026-05-10) with no deprecation cycle. The kickstarter at 5+ sites still teaches the deleted form. The new form is an attribute on the declaration: `<x debounced=300ms> = ""`. This is not a doc nuance — the keyword form is gone from the parser; any adopter following the kickstarter recipe gets a parse failure.
- **Cross-evidence:**
  - PRIMER §4 line 93-101 corroborates SPEC: *"any Shape 1 or Shape 2 cell may carry one of two reactivity attributes that wrap the cell's write path with timing semantics"* + cites §6.13.
  - PRIMER §12 line 606 mentions the AST kind `reactive-debounced-decl` retirement at S79.
  - SPEC §34 — `E-DEBOUNCED-WITH-DERIVED`, `E-REACTIVITY-ATTR-CONFLICT`, `E-DEBOUNCED-WITH-SERVER` codes target the new attribute form.
  - Native-parser: no `@debounced` keyword tokenization (would emit E-STMT-UNEXPECTED-TOKEN if attempted).
- **Recommended direction:** Kickstarter catches up to SPEC. Replace all 5+ kickstarter occurrences with the attribute form. The §11.4 heading + worked example need full rewrite.
- **Notes:** Same direction as F-001 (kickstarter caught a single intermediate ratification but missed both S79 + S87). The "currency" issue with the kickstarter is systemic at this point; multiple S70-S100+ ratifications haven't landed.

---

### F-003 — Kickstarter doesn't mention "no async/await" S114 language-wide standing rule

- **Category:** CANON-DRIFT (HOLE on the kickstarter side — SPEC has the rule; kickstarter is silent)
- **Severity:** MEDIUM (kickstarter §5 covers a close-enough framing — "auto-await rule, forbids async/await/Promise" — but the S114 framing has more weight than the kickstarter implies)
- **Canon source:** Kickstarter §5 line 480-504 covers the auto-await rule with the wording: *"explicitly forbids developers from writing `async`, `await`, `Promise`, or `Promise.all` in source."* That covers the rule but frames it as derived-from-§13 ("the compiler auto-inserts `await`...").
- **SPEC corroboration:** §19.9.8 (S114 ratification, 2026-05-21) — NEW normative section establishing the "no `async`/`await`" rule as language-wide standing, with three new error codes E-ASYNC-NOT-IN-SCRML / E-AWAIT-NOT-IN-SCRML / E-FOR-AWAIT-NOT-IN-SCRML. §48.3.5 (E-FN-005) was retroactively subordinated to §19.9.8.
- **The conflict:** Not strictly a contradiction. The kickstarter's framing matches the SPEC's outcome (don't write async/await). But the kickstarter doesn't surface the S114 standing-rule framing — *why* the rule is universal (S114 user-voice: *"I hate leaky abstractions and colored functions"*), nor does it mention the body-split/CPS as the canonical async surface. PRIMER §6.1 line 165-183 captures the S114 framing in full.
- **Cross-evidence:**
  - Native-parser fires E-ASYNC-NOT-IN-SCRML / E-AWAIT-NOT-IN-SCRML at the canonical sites (parse-stmt.js / parse-expr.js). Verified via `grep -oh '"E-[A-Z-]*"' compiler/native-parser/*.js`.
  - User-voice S114 ratification recorded in PRIMER §6.1 verbatim.
  - SPEC §19.9.9 (S114 Ext 1 M1.6) builds on §19.9.8 with multi-batch CPS as the canonical replacement.
- **Recommended direction:** Kickstarter §5 should reference the S114 standing rule + body-split/CPS as the canonical async surface (one paragraph addition). Not a flip — additive content. The §5 heading "the auto-await rule" is a reasonable LLM-onboarding framing but the underlying SPEC framing is "no async/await, full stop."
- **Notes:** This is a "kickstarter is behind on the framing weight" not "kickstarter is wrong." Lower-severity than F-001/F-002. Worth touching in the same currency-refresh pass.

---

### F-004 — Kickstarter examples use legacy machine `rule=` arrow form scattered with engine `rule=` target form

- **Category:** AMBIGUITY (kickstarter mixes shapes; could mislead an adopter into thinking arrow form is canonical for engines)
- **Severity:** MEDIUM
- **Canon source:** Kickstarter examples at §4 line 256-263 + §11.1 line 809-822: all engine state-children use the target-only `rule=` form (correct). But the kickstarter doesn't explicitly contrast or call out the deprecated legacy arrow form (`rule="event -> Variant"`).
- **SPEC corroboration:** §51.0.F is the engine `rule=` contract — three target-only forms. §51.3 (legacy `<machine>` arrow grammar) is the deprecated alternative; W-DEPRECATED-001 fires. PRIMER §7 line 319 calls out the distinction explicitly: *"The arrow form `rule='event -> Variant'` is **legacy `<machine>` syntax** (§51.3, deprecated); `<engine>` does NOT use it."*
- **The conflict:** Kickstarter is silent on the legacy form, so an adopter reading both kickstarter + sample code (legacy machine files using arrow form, e.g., earlier Mario examples) might mix shapes.
- **Cross-evidence:**
  - Native parser SYM PASS 11 fires `E-ENGINE-RULE-LEGACY-SYNTAX` on arrow form inside `<engine>` (per PRIMER §13.7 B15).
  - SPEC §51.0.F is the canonical engine rule contract.
  - PRIMER explicitly contrasts; kickstarter does not.
- **Recommended direction:** Kickstarter add a one-line note in §4.4 or §4.6 ("`rule=` on engines is target-only; arrow form is legacy `<machine>` syntax — do not use") — additive content. Direction is to align with PRIMER's explicit treatment.
- **Notes:** Reasonable to defer if the corpus is being migrated to engine form generally. Lower severity because the kickstarter examples themselves are correct; only an adopter who imports a legacy file would conflate.

---

### F-005 — SPEC §6.11 stub uses singular `error: string`; auto-synth surface emits `errors: ValidationError[]`

- **Category:** EXAMPLE-DRIFT (in SPEC) / CANON-DRIFT (PRIMER §13.7 B11 calls this out explicitly as a SPEC-prose drift)
- **Severity:** MEDIUM
- **Canon source:** PRIMER §13.7 B11 specifics (line 786): *"Type shapes per §55, NOT §6.11 stub (audit §1.2). Compound `errors` is `{fieldName: [...errorTags]}` (object map). Per-field `errors` (B12 future scope) is array of `ValidationError` enum tags (NOT singular `error: string`). §6.11 stub remains a non-blocking spec-prose drift to be resolved via a separate footnote-style spec amendment."*
- **SPEC corroboration:** §55.5 / §55.6 / §55.7 (S57+) have the new auto-synth surface as object map / enum-tag array. §6.11 (referenced in PRIMER) is older stub text with the singular-error shape.
- **The conflict:** SPEC's own §6.11 disagrees with SPEC's own §55 on the validity-surface shape. §55 is normatively canonical (S57 D2.8 newer, more thorough). §6.11 is the stub that the §55 superseded but didn't fully delete.
- **Cross-evidence:**
  - PRIMER §13.7 B11 explicit acknowledgment (load-bearing — the dev agent who landed B11 surfaced this).
  - PIPELINE.md §6.7 (VSS) — validity surface synthesis is anchored at §55.
  - Native-parser doesn't directly enforce — runtime synthesis at codegen time per CG (Stage 8).
- **Recommended direction:** SPEC catches up to itself (§6.11 stub updated to point to §55 OR is folded entirely). Direction is mechanically determined — §55 is the newer ratification.
- **Notes:** PRIMER calls this "non-blocking spec-prose drift" but it's still surfaceable in a SPEC-self-consistency audit. Phase 1a's sequential walk should catch this independently — corroboration value if it does.

---

### F-006 — PRIMER §8 calls out "S66 correction" — `email`/`url`/`numeric`/`integer`/`custom` NOT in §55.1 universal-core

- **Category:** EXAMPLE-DRIFT / LEGACY-TEXT (PRIMER notes pre-S66 drafts had drift; kickstarter §9 line 744 still has the drift)
- **Severity:** MEDIUM (LOAD-BEARING for the validator-vocabulary surface but not for the core language)
- **Canon source:**
  - PRIMER §8 line 381: *"earlier primer drafts listed `email`, `url`, `numeric`, `integer`, `custom` here. **Those are NOT universal-core predicates.** `email`/`url`/`numeric`/`integer` are stdlib `scrml:data` library predicate-builders ... `custom` is the ValidationError tag at SPEC §55.9 line 24532"*
  - Kickstarter §9 stdlib catalog line 744 still lists `email`/`numeric`/`integer`/`url`/`custom` under `scrml:data` exports as if they're universal-core predicates. Wording: *"predicate builders `required`, `email`, `minLength/maxLength/exactLength`, `pattern`, `min/max`, `numeric`, `integer`, `oneOf`, `url`, `custom`"*
- **SPEC corroboration:** §55.1 (canonical) lists 14 predicates: `req`, `is some`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`. PRIMER §8 enumerates the same 14. Audit `scrml-support/archive/audits/a1c-roadmap-rule4-audit-2026-05-07.md` §1.1 documents the correction.
- **The conflict:** Kickstarter line 744's predicate-builder list is from the stdlib catalog, so listing `email`/`numeric`/`integer`/`url`/`custom` there isn't wrong (those ARE stdlib helpers) — BUT the same list also has `required` (not the universal-core `req`) and the framing implies these are validator predicates of the same level as `length/pattern/min/max`. The §6.1 validator vocabulary table at line 518-525 lists only `req` + 13 others (correct — matches SPEC §55.1 minus `notIn`). Vocabulary list is consistent with SPEC, but the stdlib catalog's predicate-builders blur stdlib + universal-core in the reader's mind.
- **Cross-evidence:**
  - PRIMER §8 directly calls out the correction with audit reference.
  - SPEC §55.1 canonical 14-predicate list (verified PRIMER + SPEC agree).
  - Stdlib `scrml:data/index.scrml` would have the predicate-builder API — separate surface, validation by the stdlib runtime not the universal-core compiler.
- **Recommended direction:** Kickstarter §6.1 + §9 stdlib-row should be split: §6.1's validator vocabulary table (line 516-525) is correct; the §9 stdlib catalog should distinguish "stdlib predicate-builders" from "universal-core predicates" + cite SPEC §55.1 for the latter. Direction: PRIMER's correction (S66 audit-grounded) is canonical.
- **Notes:** Kickstarter §6.1 line 519 has `req` correctly. The §9 stdlib catalog wording is the slipping point.

---

### F-007 — Kickstarter §3 + §6 still uses `<*>` example markup-anywhere shorthand; not actually a scrml feature

- **Category:** EXAMPLE-DRIFT (kickstarter anti-pattern table calls out the invention but uses scrml-form list with `<engine>` etc.)
- **Severity:** LOW
- **Canon source:** Kickstarter line 685: *"`<chrome>` / `<*>` template construct inside engines | (invented) | **Snippets.** Define a snippet, call it in each state-child body."* — line correctly identifies as invented + offers scrml form. Searched: zero other `<*>` occurrences in kickstarter.
- **SPEC corroboration:** §51 + §4 — no `<*>` wildcard markup tag exists in scrml. PRIMER also makes no claim.
- **The conflict:** None. The kickstarter handles `<*>` correctly as a "do NOT write this" anti-pattern, and offers the snippet alternative. Mark this as "no finding."
- **Cross-evidence:** N/A.
- **Recommended direction:** No change. Sweep finding cleared.
- **Notes:** Initial flag was a false-positive; recording it here for the coverage assertion.

---

### F-021 — PIPELINE.md NR `deriveEngineVarName` STRIPS "Machine" suffix; SPEC §51.0.C + PRIMER B14 say literal lowercase-first (suffix kept)

- **Category:** CANON-DRIFT (PIPELINE contradicts SPEC + PRIMER)
- **Severity:** LOAD-BEARING (would cause runtime breakage when auto-name doesn't match what NR registered vs what TS/CG look up)
- **Canon source:**
  - PIPELINE.md Stage 3.05 NR line 822-826:
    ```
    deriveEngineVarName(typeName, varAttr):
      if varAttr is non-null: return varAttr
      let stripped = typeName.endsWith("Machine") ? typeName.slice(0, -7) : typeName
      return stripped[0].toLowerCase() + stripped.slice(1)
    ```
    Examples line 829-830: *"`<engine for=MarioMachine>` declares `mario` (suffix stripped)"*.
- **SPEC corroboration:**
  - §51.0.C line 23113 (canonical table): *"`MarioMachine` (legacy) | `marioMachine` (literal lowercase-first; **`Machine` suffix kept**) | Pre-engine-rename naming; new code prefers names that don't end in `Machine`"*. EXPLICIT no-strip.
  - PRIMER §13.7 B14 line 826 (canonical): *"`autoDeriveEngineVarName(typeName)` ... `URL → uRL` (literal). Audit §1.2 flagged the all-uppercase edge case as a potential spec amendment ... B14 implements the literal spec."*
- **The conflict:** PIPELINE.md teaches a different deriveEngineVarName algorithm than SPEC + PRIMER + actual codebase implementation (per PRIMER B14 cite).
- **Cross-evidence:**
  - SPEC §51.0.C: literal lowercase-first.
  - PRIMER B14: literal lowercase-first (codebase confirmed).
  - Kickstarter §4 line 270 phrasing "lowercase-first-run" is ambiguous; example `marioState` matches SPEC-literal.
  - PIPELINE.md NR: strip "Machine" suffix (contradicts SPEC).
- **Recommended direction:** PIPELINE.md catches up to SPEC. Rewrite deriveEngineVarName pseudo-code to: `return typeName[0].toLowerCase() + typeName.slice(1)` (literal). Update worked example line 829-830 from "`<engine for=MarioMachine>` declares `mario` (suffix stripped)" to "`<engine for=MarioMachine>` declares `marioMachine` (literal lowercase-first; suffix kept)".
- **Notes:** Easy to miss because the SPEC table is informational + the PIPELINE pseudocode looks authoritative. But the actual code (per PRIMER B14) follows SPEC. PIPELINE is the outlier.

---

### F-022 — Kickstarter §11.4 "Reactive recipe" tee s a stale `@debounced(N)` worked example end-to-end (companion to F-002)

- **Category:** LEGACY-TEXT (kickstarter)
- **Severity:** LOAD-BEARING (companion to F-002 — same root cause, separate example pollutes the recipe)
- **Canon source:** Kickstarter §11.4 worked example (line 975-1020) uses `@debounced(300) <debouncedQuery> = @query` heavily; the whole recipe demonstrates the retired form.
- **SPEC corroboration:** SPEC §6.13 — see F-002.
- **The conflict:** Companion to F-002; recorded separately because the §11.4 recipe is a substantial worked example, not just an isolated table row mention. Worth a separate update line in the lockdown migration plan.
- **Cross-evidence:** Per F-002.
- **Recommended direction:** Kickstarter §11.4 worked example fully rewritten with the SPEC §6.13 attribute form: `<debouncedQuery debounced=300ms> = @query`. The recipe's flow stays the same — only the syntax changes.
- **Notes:** Same finding as F-002, but worth surfacing the recipe specifically because adopters reading kickstarter §11 recipes will see the broken pattern multiple times.

---

### F-019 — SPEC §39.12 E-SCHEMA-003 ("`< schema>` block nested inside another block") contradicts §39.2 + §40.8 worked examples showing `< schema>` INSIDE `<program>`

- **Category:** CONTRADICTION (SPEC-internal)
- **Severity:** LOAD-BEARING
- **Canon source:** Kickstarter §11.6 line 1052-1075 shows `< schema>` INSIDE `<program db=>`. PRIMER §9.2 omits the surrounding context.
- **SPEC corroboration:**
  - §39.2 line 17621: *"A `< schema>` block appears at the top level of a file, **alongside (not inside) `< db>` blocks**."* — top-level-of-file framing is ambiguous (sibling of `<program>` OR inside `<program>`?).
  - §39.2 worked example line 17626-17653 shows `< schema>` INSIDE `<program>` body.
  - §40.8 + §39.12.0 line 17962-17972: v0.3 db-anchor workaround puts `< schema>` INSIDE `<program db=>`.
  - §39.12 line 17983 catalog: *"E-SCHEMA-003 | `< schema>` block nested inside another block | Error"* — INSIDE-program would fire.
- **The conflict:** SPEC §39 prose + worked examples + §39.12.0 v0.3 amendment all show `< schema>` INSIDE `<program>` as canonical, but §39.12 catalog row E-SCHEMA-003 says nesting is a hard error. The catalog row is from pre-v0.3 era (when `< schema>` was top-level sibling of `<program>`). Post v0.3 program-shape (one-program-per-application + db lives on `<program db=>`), the only sane place for `< schema>` is INSIDE `<program>`.
- **Cross-evidence:**
  - PRIMER §9.2 example doesn't show enclosing `<program>` but cross-refs §39.
  - Kickstarter §11.6 has `<program db=>` wrapping `< schema>`.
  - Sample/example code in `examples/` directory presumably matches one form or the other (not checked at depth).
- **Recommended direction:** SPEC catches up to itself + v0.3 program-shape ratification. §39.12 E-SCHEMA-003 either retired or scoped to "nested inside a NON-program block" (e.g., inside a function body, inside another schema, inside an engine). Per §39.12.0 the canonical v0.3 shape is INSIDE `<program>`; v0.4 promotes `<schema db=>` to be standalone.
- **Notes:** Phase 1a's sequential walk will catch this (single section internal). Phase 1b adds the canon corroboration (kickstarter + PRIMER both show INSIDE form).

---

### F-020 — Kickstarter §2 + §11.6 use `< db>` with `protect="password_hash"`; SPEC §40.2 deprecated `<program protect=>` in favor of attribute-on-page

- **Category:** AMBIGUITY (probably correct but cross-check needed)
- **Severity:** LOW-MEDIUM
- **Canon source:** Kickstarter §2 line 43, §11.2 line 839 use `< db src="..." protect="password_hash" tables="...">`. The `protect=` is on the `< db>` state block, not on `<program>`.
- **SPEC corroboration:** §6.12.1 + §11.3.5 + §52 — `protect=` on `< db>` is the canonical "fields server-only" mechanism. §39 schema doesn't use protect=. §40.2 doesn't refer to `protect=`.
- **The conflict:** Not a true conflict on inspection. Kickstarter correctly uses `protect=` on `< db>` per SPEC.
- **Recommended direction:** No change.
- **Notes:** Cleared on cross-check; recorded for coverage.

---

### F-018 — SPEC §55.5 has an INTERNAL contradiction on validity-surface synthesis trigger; PIPELINE + PRIMER pick opposite sides

- **Category:** CONTRADICTION (SPEC-internal) + CONTRADICTION (PIPELINE vs PRIMER)
- **Severity:** LOAD-BEARING
- **Canon source:**
  - PIPELINE.md Stage 6.7 VSS line 2011: *"the surface is created if and only if the cell carries at least one validator (no auto-synthesis on validator-free cells)."* — CONDITIONAL synthesis.
  - PRIMER §13.7 B11 line 786 (S67 audit-grounded): *"Synthesis is UNCONDITIONAL for compound parents per §55.5 predictability rule (audit §1.1) — even no-validator compounds get the surface, with trivially-valid defaults."* — UNCONDITIONAL synthesis.
- **SPEC corroboration:**
  - §55.5 line 28267-28269 (opening): *"When a compound state declaration contains ANY field with validators, the compiler auto-synthesizes a reactive validity surface..."* — implies CONDITIONAL.
  - §55.5 line 28290-28293 (later in same section): *"**No-validator compounds.** When a compound has NO validators, `isValid` is trivially `true`; `errors` is empty per-field; `touched` and `submitted` exist as conceptual empty structures. **Predictability over namespace savings**..."* — UNCONDITIONAL.
  - §55.6 line 28319-28321: *"Per L11 Edge B, a per-field surface exists EVEN when the field has no validators — `@signup.someUnvalidated.isValid` is trivially `true`; `errors` is `[]`."* — UNCONDITIONAL (matches PRIMER).
- **The conflict:** SPEC §55.5's opening sentence says "When ... contains ANY field with validators" (conditional trigger) but the same section's "No-validator compounds" paragraph + §55.6's L11 Edge B explicitly support unconditional synthesis with empty defaults. SPEC contradicts itself within § 55.5. PIPELINE Stage 6.7 transformation (per line 2011) takes the CONDITIONAL reading; PRIMER §13.7 B11 (S67-audited) takes the UNCONDITIONAL reading.
- **Cross-evidence:**
  - PRIMER §13.7 B11 cites the S67 audit (`docs/audits/a1b-b11-rule4-audit-2026-05-07.md`) that ratified the unconditional reading.
  - Codebase: PRIMER B11 description says implementation matches the unconditional reading.
  - PIPELINE.md was authored before B11 implementation, hasn't been refreshed.
  - SPEC §5.246-5258 (stub-correction note) cross-refs §55.5-§55.7 as authoritative type-shapes — implying the "predictability" reading is canonical.
- **Recommended direction:** SPEC catches up to itself + PIPELINE catches up to PRIMER/codebase. Mechanical fix:
  - SPEC §55.5 opening sentence rewritten to: *"When a compound state declaration is registered, the compiler auto-synthesizes a reactive validity surface accessible at the compound level. The surface exists for every compound regardless of whether its fields carry validators — see No-validator compounds below for the trivial-default semantics."*
  - PIPELINE Stage 6.7 line 2011: *"the surface is created for every compound cell; cells with no validators carry trivially-valid defaults per §55.5/§55.6 Edge B."*
- **Notes:** Phase 1a's SPEC-only walk WILL catch SPEC §55.5's internal contradiction (single section reading). Phase 1b adds the PIPELINE-vs-PRIMER downstream-impact framing. High corroboration value.

---

### F-013 — Kickstarter `<userId> pinned = ""` syntax wrong; SPEC §6.10 canonical is `<userId pinned> = ""` (pinned INSIDE the tag)

- **Category:** CANON-DRIFT (kickstarter)
- **Severity:** LOAD-BEARING (parser would reject the kickstarter syntax)
- **Canon source:** Kickstarter §4.7 line 405: `<userId> pinned = ""           // pinned — must appear before first use` — `pinned` is AFTER the closing `>`, between the tag and `=`.
- **SPEC corroboration:** §6.10 canonical (line 5189-5190): `<count pinned> = 0` / `<result pinned> = computeExpensiveThing()` — `pinned` is INSIDE the tag, as a bare attribute alongside other state-decl attributes.
- **The conflict:** SPEC has the bare-attribute form (inside tag); kickstarter has the post-tag modifier form. Native parser enforces the bare-attribute form per §6.10. The kickstarter form would be a parse error.
- **Cross-evidence:**
  - PRIMER §13.7 B14 line 731 uses canonical `<x pinned> = @x + 1` form (inside tag).
  - SPEC §6.13 line 5289 explicitly cites `pinned` as a bare attribute on the declaration tag.
  - Native parser `parse-stmt.js` / `parse-state-body.js` parse bare attributes inside the tag.
- **Recommended direction:** Kickstarter §4.7 catches up to SPEC. Single-line edit: `<userId> pinned = ""` → `<userId pinned> = ""`.
- **Notes:** Tight 1-character edit; high-confidence catch.

---

### F-014 — PRIMER §6.2 + §7 engine/match worked examples use bare prose in code-default bodies; S111 requires display-text literals

- **Category:** EXAMPLE-DRIFT (PRIMER) + CANON-DRIFT
- **Severity:** LOAD-BEARING (PRIMER §6.2 was ADDED S122, post-S111 quoted-text model ratification — the staleness is recent)
- **Canon source:**
  - PRIMER §6.2 worked example (line 200-220):
    ```scrml
    <Idle>
        <button onclick=load()>Load</button>
    </>
    <Loading>
        Loading...
    </>
    <Error msg>
        Error: ${msg}
    </>
    ```
    The `Loading...`, `Error: ${msg}`, etc. are bare prose runs inside match-block-form arms.
  - PRIMER §7 engine worked example (line 285-313): same shape — `Loading...` / `No rows yet.` / `Got it: ${count} rows` bare inside engine state-children.
- **SPEC corroboration:**
  - §4.18.1 line 1122: match block-form arm bodies are **code-default mode** — "A bare run is **code**... Display text in a code-default body MUST be written as a **display-text literal** (`"..."`, §4.18.3)."
  - §4.18.7 line 1141: bare prose in code-default body fires `E-UNQUOTED-DISPLAY-TEXT`.
  - §18.0.1 + §51.0 amendments cross-ref §4.18 for arm-body / state-child-body parsing.
- **The conflict:** PRIMER §6.2 was ADDED at S122 (2026-05-23) — AFTER the S111 quoted-text model ratification (2026-05-20). The S122 PRIMER amendment somehow missed the S111 display-text-literal requirement. The worked examples should be:
  ```scrml
  <Loading>
      "Loading..."
  </>
  <Error msg>
      "Error: ${msg}"
  </>
  ```
- **Cross-evidence:**
  - Kickstarter §4 line 257-260 + §4.5 line 340/346 use display-text literals correctly: `"🧍"`, `"🔥"`, `"🧍 🧍"`. Kickstarter is silent on the WHY (doesn't name §4.18) but uses the canonical form.
  - Native parser `display-text-literal.js` enforces; SPEC §34 `E-UNQUOTED-DISPLAY-TEXT` is the diagnostic.
  - SPEC §18.0.1 worked examples (latest after S111) use the quoted form.
- **Recommended direction:** PRIMER catches up to SPEC §4.18 + §18.0.1 + §51.0. §6.2 + §7 examples updated to quote display text. Mechanical migration:
  - `Loading...` → `"Loading..."`
  - `Error: ${msg}` → `"Error: ${msg}"`
  - `No rows yet.` → `"No rows yet."`
  - `Got it: ${count} rows` → `"Got it: ${count} rows"`
  - etc.
  Bodies containing only nested markup (e.g., `<Idle><button onclick=load()>Load</button></>`) are FINE — markup is code-as-value (§1.4), not display text.
- **Notes:** Phase 1a's sequential SPEC walk will catch §4.18 + the cross-refs but won't catch PRIMER's drift. Phase 1b's corroboration value is precisely cases like this — orthogonal anchor.

---

### F-015 — PRIMER §7 + kickstarter mostly silent on `default-logic` body-mode (§40.8); both implicitly use it without naming

- **Category:** HOLE (canon silence; same as F-008 but broader observation)
- **Severity:** MEDIUM
- **Canon source:** PRIMER §7 line 285-313: engine example sits inside an implicit `<program>` context but the body-mode framework isn't called out. Kickstarter §2 line 41-97 canonical-shape example uses default-logic-mode auto-lift behavior without explanation.
- **SPEC corroboration:** §40.8 (S111 R3) makes `default-logic` a normative third body-mode.
- **The conflict:** Recorded as F-008. F-015 is a redundant observation; cleared.
- **Recommended direction:** Per F-008.
- **Notes:** Cleared; counts as coverage assertion only.

---

### F-016 — Kickstarter §4 description "Engine declaration position = mount position" — SPEC §51.0.D says "decl=mount"; consistent BUT cross-file mount needs explicit clarification

- **Category:** AMBIGUITY (low) — kickstarter language is reasonable but doesn't fully cover the cross-file case as SPEC does
- **Severity:** LOW
- **Canon source:** Kickstarter §4.2 line 276-299: *"Where you declare the engine in the source IS where it renders. ... For **cross-file** engines, you import and use the engine via `<EngineName/>` use-site. That is the only situation in which the use-site tag exists."*
- **SPEC corroboration:** §51.0.D corroborates. PRIMER §7 corroborates.
- **The conflict:** Not a true conflict. Kickstarter is correct + concise. Doesn't go into PRIMER §13.7 B14's detail about `var=` resolution + auto-derive priority. Acceptable simplification for an LLM-onboarding doc.
- **Recommended direction:** No change.
- **Notes:** Cleared; counted in coverage.

---

### F-017 — PRIMER + kickstarter both teach `<engine>`/`<match>`/`<errors>`/`<onTransition>` as structural elements; SPEC §4.15 + §24.4 corroborate

- **Category:** (no finding — corroboration)
- **Severity:** N/A
- **Canon source:** PRIMER §9.6 line 479; kickstarter §11.1 + §4.4 (uses `<onTransition>`, `<errors>`, `<engine>`, `<match>`).
- **SPEC corroboration:** §4.15 + §24.4 + §51.0.M (onTimeout, S77) + §51.0.R (onIdle, S77) + §38 (channel) + §4.15 (page S85) + §40.1 (auth S91) — all canonical.
- **Notes:** Recorded for coverage assertion. No drift.

---

### F-009 — SPEC §7.5 grammar production for `state-decl` still uses legacy `@x: T = v` form; §6.1 + §34 V-kill explicitly retire it (S123)

- **Category:** CONTRADICTION (SPEC-internal) + LEGACY-TEXT
- **Severity:** LOAD-BEARING (this is the D8c surface the dispatch brief specifically called out)
- **Canon source:**
  - PRIMER §3 line 49-55: V5-strict structural form is canonical for declaration; `@x` is canonical access form, not declaration.
  - Kickstarter §3 line 137-148 echoes PRIMER.
  - Native parser source — `parse-state-body.js` + `parse-stmt.js` enforce the structural form. `E-STMT-STATE-DECL-NAME` / `E-STMT-STATE-DECL-INIT` codes target the structural form.
  - User-voice S122-S123: V-kill ratification — auto-state-cell-synth retired; bare `@name = expr` is a write, not a decl.
- **SPEC corroboration:**
  - §6.1.1 (canonical, S123) line 1958: *"A state cell SHALL be declared via the structural form. Bare `@x = expr` writes ... without a prior `<x>` declaration in scope are **`E-STATE-UNDECLARED`** (compile error)."*
  - §6.1.2 line 1971: *"`@varname = expr` is a WRITE to a pre-declared cell. ... NOT a declaration"*
  - §34 catalog line 15352 `E-STATE-UNDECLARED` corroborates V-kill.
  - §40.8 / §34 line 15353 `E-WRITE-NOT-IN-LOGIC-CONTEXT` (S123 Unit CC) corroborates.
  - **BUT** §7.5 line 5564 grammar production: *"`state-decl ::= '@' identifier [ ':' type-expr ] '=' expr`"* — explicitly defines the legacy `@x: T = v` decl form as canonical grammar.
  - §7.5 line 5595-5597 worked examples use the legacy form: `@count: number = 0`, `@items: string[] = []`, `@selected: string? = not`.
- **The conflict:** SPEC §7.5's grammar production and worked examples are pre-V5-strict (pre-S55) text that survived the V5-strict refactor and the S123 V-kill amendment. §6.1, §6.1.2, §34 + V-kill all retire the form §7.5 still teaches as canonical. This is the exact LEGACY-TEXT pattern the S129 user-voice flagged.
- **Cross-evidence:**
  - Native parser ENFORCES the V5-strict structural form (per S128 D8c triage — native rejects the `@x: T = v` form; live parser tolerates it for legacy bridge purposes).
  - PRIMER doesn't even acknowledge the `@x: T = v` form exists.
  - Kickstarter §13 line 1186 calls out the legacy: *"v1 used `@var = 0` to declare; v2 does NOT. Write `<var> = 0`."*
  - User-voice S129 (this session) explicitly identified this surface as part of the grammar-lockdown arc (D8c surface).
- **Recommended direction:** SPEC catches up to itself. §7.5 grammar production + worked examples updated to V5-strict structural form. Mechanical migration:
  - Grammar line 5564: replace with `state-decl ::= '<' identifier '>' [ ':' type-expr ] '=' expr`
  - Worked examples lines 5595-5597: rewrite as `<count>: number = 0` etc.
- **Notes:** This is the heads-up coding session candidate the dispatch brief was generated for. Phase 1a's sequential SPEC walk will catch this independently — high-corroboration finding.

---

### F-010 — PRIMER §2 Pillar 5b ("Reach discipline", S98) absent from SPEC; design-insights silent

- **Category:** CANON-DRIFT (PRIMER ahead of SPEC)
- **Severity:** MEDIUM (pedagogical / framing pillar; doesn't change syntactic surface)
- **Canon source:** PRIMER §2 line 40: *"5b. **Reach discipline (S98 ratification).** When a problem has a finite condition set with a transition contract, REACH FOR state primitives (`<engine>` / typed structs / refinement-typed cells / validators) FIRST..."*
  Citation to `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` §D1.
- **SPEC corroboration:** Searched SPEC.md for "Pillar 5b", "Reach discipline", "S98", "state-vs-logic axiom" — zero matches. SPEC §1.5 has the Tier 0/1/2 ladder + north-star framing, but no explicit pillar named "Reach discipline."
- **The conflict:** PRIMER introduces Pillar 5b as a ratified pillar (S98). SPEC has no corresponding pillar declaration. Memory file `feedback_state_vs_logic_boundary` reinforces the axiom but cites only PA + deep-dive sources.
- **Cross-evidence:**
  - User-voice S94/S95 corrected the state-vs-logic axiom (memory file).
  - Design-insights file: no entry for Reach discipline.
  - Native-parser design DD (referenced by PRIMER) is the underlying authority.
  - Kickstarter §1 line 32 uses similar framing ("which option makes the UI MORE of a fully-handled state machine?") but doesn't name Pillar 5b.
- **Recommended direction:** SPEC catches up to the S98 ratification. Add Pillar 5b to SPEC §1 (Overview) with explicit ratification context + cross-ref to the underlying deep-dive. Direction is constrained by S98 user-voice ratification — pillar IS ratified per user; SPEC just hasn't caught the text.
- **Notes:** This is "PRIMER ahead of SPEC for a ratification" — distinct shape from F-002/F-001 where canon was stale BEHIND SPEC. Both directions exist in the audit set.

---

### F-011 — PIPELINE.md internally inconsistent on Stage 7.6 RS status: "INACTIVE" markers at 4 sites; A-2.7 section says "wired"

- **Category:** CONTRADICTION (PIPELINE-internal)
- **Severity:** MEDIUM (operational, not normative-grammar; matters for dev-agent dispatches that consult PIPELINE for routing)
- **Canon source (PIPELINE itself — both directions present):**
  - PIPELINE line 180 (Stage Index table): *"Reachability Solver (SPEC ANCHOR — v0.3 §40.9; **INACTIVE**; impl deferred)"*
  - PIPELINE line 2346: *"This stage is **INACTIVE** in the current pipeline; no compiler source emits it as of S86."*
  - PIPELINE line 2348: *"**A-2.7 (S91) — outer fixed-point operator wired.** Components 1-5 wired across waves A-2.2..A-2.6 (S89-S90); A-2.7 closes the A-2 wave by wiring the outer `closure(...)` operator from SPEC §40.9.1."* — directly contradicts INACTIVE.
  - PIPELINE lines 2885-2888 (Integration Failure Mode Catalog): four rows tagged `(v0.3 §40.9, INACTIVE)`.
- **SPEC corroboration:** SPEC §40.9 is normative. PRIMER §9.7 (line 487-525) describes Approach A as CLOSED end-to-end (S88-S92). Codebase: `compiler/src/api.js:31` imports `runReachabilitySolver`; `compiler/src/api.js:1664-1705` wires Stage 7.6 into the pipeline run at api.js Stage 7.55. `compiler/src/reachability-solver.ts` exists. PRIMER + codebase confirm RS is wired + emitting.
- **The conflict:** PIPELINE.md last updated 2026-05-18 (v0.7.2) but the v0.7.2 changelog (line 9) only notes Stage 2 (BS) raw-content addendum — no Stage 7.6 status update. The "INACTIVE" markers date from v0.7.0 (2026-05-04 / Stage 0b D4) before A-2.x wave landings (S89-S92).
- **Cross-evidence:**
  - PRIMER §9.7 verbose corroboration: *"Approach A close end-to-end (S88-S92) was the v0.3.0 critical-path investment."*
  - User-voice S92 close (memory file): *"Approach A close end-to-end."*
  - api.js code is wired.
  - SPEC §40.9 + §40.9.8 + §40.9.11 are normative for what RS produces.
- **Recommended direction:** PIPELINE.md catches up to its own A-2.7 paragraph + the actual codebase. Mechanical edit:
  - Line 180 table entry: drop "INACTIVE; impl deferred"; mark as ACTIVE.
  - Line 2346 paragraph: rewrite to reflect "active per A-2.7 wave landing S91; outer fixpoint wired."
  - Lines 2885-2888 failure-mode rows: drop "(INACTIVE)" qualifier.
- **Notes:** Useful corroboration — PIPELINE has its own contradiction shape (the same doc disagrees with itself across sections). Phase 1a's SPEC-anchored walk wouldn't catch this; this is canon-anchored value.

---

### F-012 — PIPELINE.md mentions retired AST kinds in passive-voice; PRIMER §12 retirements not propagated

- **Category:** LEGACY-TEXT (PIPELINE retains references to S64-retired AST shapes)
- **Severity:** LOW
- **Canon source:** PRIMER §12 line 606: *"`reactive-derived-decl` retired (folded into `state-decl` at S60 Phase A1a Step 11.5, interface dropped at S64). **`reactive-debounced-decl` retired at S79**..."*
- **SPEC corroboration:** SPEC.md doesn't list internal AST kinds (they're implementation detail, not spec-normative). PIPELINE.md mentions some AST kinds in Stage 3 TAB section.
- **The conflict:** PIPELINE.md Stage 3 TAB ASTNode union (line 432-484) is described from a pre-S64 perspective — doesn't directly mention `reactive-derived-decl` or `reactive-debounced-decl`, but ReactiveDecl shape is described as the post-S60 superset. So actually not a hard contradiction — PIPELINE is using the modern shape correctly. (Mark as cleared.)
- **Cross-evidence:** Code in `compiler/src/types/ast.ts` is the source of truth.
- **Recommended direction:** No change. False positive on initial scan.
- **Notes:** Recorded in coverage assertion only.

---

### F-008 — SPEC §40.8 "default-logic" body-mode (S111 R3) is a THIRD body-mode; PRIMER + kickstarter silent on it

- **Category:** HOLE (in PRIMER and kickstarter); CANON-DRIFT
- **Severity:** MEDIUM (load-bearing for `<program>` and `<page>` body comprehension, but the practical "lift declarations" behavior is reasonably intuitive)
- **Canon source:**
  - PRIMER does not explicitly describe `<program>` / `<page>` body parsing as a third body-mode.
  - Kickstarter doesn't describe body modes at all.
- **SPEC corroboration:** §40.8 (S111 R3 amendment, 2026-05-20) — *"`default-logic` is a **distinct THIRD body-mode**, owned and defined by §40.8 — neither the free-text mode nor the code-default mode of §4.18."* §4.18.1 amended to remove `<program>`/`<page>` from free-text-mode listing. §3.4 + §4.15 amendments echo. SPEC §34 catalog code `E-WRITE-NOT-IN-LOGIC-CONTEXT` is the body-top-write rejection per §40.8 default-logic mode (S123 V-kill Unit CC).
- **The conflict:** SPEC has three body modes (free-text, code-default, default-logic) per S111 R3 reconciliation. PRIMER + kickstarter teach two patterns (markup-with-text vs logic-blocks) without naming the three-mode framework. The "bare top-level decls auto-lift" behavior in `<program>` bodies emerges from `default-logic` mode but isn't framed as such anywhere outside SPEC.
- **Cross-evidence:**
  - PRIMER §3.1 implicitly uses default-logic mode in worked examples (e.g., `<program> ${ <count>=0 } ...`) without naming it.
  - Kickstarter §2 canonical-shape example puts bare decls inside `${ ... }` always, sidestepping default-logic-mode auto-lift entirely.
  - PIPELINE.md TAB stage references body modes indirectly through `liftBareDeclarations` (S123 V-kill).
- **Recommended direction:** PRIMER adds a §3.2 or §3.x callout to the three-mode framework, especially the `default-logic` mode's body-top auto-lift behavior (so adopters understand why `<x>=0` works at the body-top of `<program>` without explicit `${...}`). Kickstarter could add a single bullet near §2's structure breakdown. Direction: PRIMER + kickstarter catch up to SPEC §40.8 + §4.18 + §3.4.
- **Notes:** This was the surface that S128 / D8b ratification (mentioned in the dispatch brief) is about. The body-mode framework is new and partially-canon at SPEC; canon docs haven't propagated yet.



## Coverage assertion

### Canons read in full

- **PRIMER** (`docs/PA-SCRML-PRIMER.md`, 1002 lines) — read sections §1-§13.8 in full + §13.7 B-step contracts (the dispatch-history-dense subsection) in detail. Skimmed §14-§15 (admin/operational). Verified PRIMER cites SPEC §X for every normative claim in §1-§9; B-step claims (§13.7) cite specific audits.
- **Kickstarter v2** (`docs/articles/llm-kickstarter-v2-2026-05-04.md`, 1277 lines) — read §0-§16 in full (entire doc).
- **PIPELINE.md** (`compiler/PIPELINE.md`, 2905 lines) — read §0 changelog + §1 Overview + §2 Stage Index + §3 Lock Enforcement Map + Stage 1 (PP) + Stage 2 (BS) + Stage 3 (TAB) at depth + Stage 3.05 (NR — autoDeriveEngineVarName focused) + Stage 6.5 (META) + Stage 6.7 (VSS) + Stage 7.6 (RS — INACTIVE markers + A-2.7 wired paragraph reconciliation) + Stage 8 (CG — A-4 wave additions) + Stage Dependency Summary + Integration Failure Mode Catalog. Did not read MOD / CE / UVB / PA / RI / MC / TS / DG / BP at line-by-line depth — confirmed they exist and skimmed for SPEC cross-refs.
- **Design-insights** (`~/.claude/design-insights.md`, 41 lines) — 2 entries; read in full. Both align with SPEC §4.18 (quoted-text) + §58 (build-story).
- **User-voice** (`/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrmlTS.md`, 8415 lines) — read S129 entries (lines 8400-8540) in full for the dispatch brief context. Spot-checked S86 (idiomatic-examples — 6370-6456) and S114 (host-import) and S87 (channel placement) via memory file cross-refs.
- **Native-parser source** (`compiler/native-parser/`, 79 files / 37 .js + 37 .scrml mirrors + 5 .md docs) — surveyed via grep on emitted error codes (85 distinct codes, all matching SPEC §34.1) + spot-read `parse-markup.js` for engine state-child references + `body-mode.js` for quoted-text-model wiring. Did NOT read each .js file or .scrml mirror at depth (per scope).

### SPEC.md cross-checked sections

- §4.14 (`:`-shorthand body)
- §4.15 (structural elements registry)
- §4.17 (`<pre>`/`<code>` raw-content) — corroborated
- §4.18 (quoted-text model + body-mode) — checked at depth for F-008, F-014
- §6.1 (V5-strict) — checked at depth for F-009
- §6.10 (pinned) — checked at depth for F-013
- §6.13 (debounce/throttle) — checked at depth for F-002
- §7.5 (type annotation grammar) — checked at depth for F-009 (SPEC-internal contradiction)
- §7.6 (file-level scope) — corroborated
- §13.5 (RemoteData) — corroborated
- §17.0 (Tier ladder)
- §18.0.1 (match block-form)
- §19.9.8 (no async/await)
- §21.3.1 (import:host) — checked for F-003 + S114 context
- §22.12 / §22.13 (Approach C + manifest)
- §34 (catalog) — spot-checked for F-002, F-009, F-021, F-019
- §34.1 (native-parser catalog) — corroborated 85 codes
- §38 (channels) — checked at depth for F-001
- §39 (schema) — checked at depth for F-019
- §39.12.0 (db-anchor workaround) — checked for F-019
- §40.7 (documentary attrs)
- §40.8 (v0.3 program shape) — checked at depth for F-008, F-015, F-019
- §40.8.1 (SPA inference)
- §40.9 (closure analysis, RS anchor) — checked for F-011
- §41 (use/import + L22 family)
- §41.14 / §41.15 / §41.16 (formFor / schemaFor / tableFor)
- §47.5 (FNV-1a content-addressing)
- §48.3.5 (E-FN-005)
- §51.0.B (engine state-child surface)
- §51.0.B.1 (S98 payload binding)
- §51.0.C (auto-derive var name) — checked at depth for F-021
- §55.5 / §55.6 / §55.7 (validity surface) — checked at depth for F-018
- §55.9 (ValidationError enum)
- §55.10 (4-level message resolution + messageFor)
- §57 (wire format)
- §58 (build story)

### PIPELINE.md sections walked sequentially

§1 Overview / §2 Stage Index / §3 Lock Enforcement Map (full pass — found Lock L21/L22 corroborated, no drift). Stages 1-2-3-3.05-3.1-3.2-6.5-6.7-7.6-8 (per above; remaining stages skimmed for cross-refs only).

### Cross-evidence I read

- `~/.claude/CLAUDE.md` — global rules (operational; no SPEC implications)
- `/home/bryan-maclee/.claude/projects/-home-bryan-maclee-scrmlMaster-scrmlTS/memory/MEMORY.md` — 28 memory-file references; spot-checked the load-bearing ones (null-no-exist, state-vs-logic axiom, V5-strict, channel placement).
- Codebase imports: `compiler/src/api.js:31` (verified RS wired), `compiler/native-parser/*.js` (verified parser implements canonical forms).
- `examples/` directory — surveyed via `ls compiler/native-parser/` and `ls docs/audits/`; did not read individual examples (per scope: corpus is artifact).

## Stopping note

### Meta-observations on the canon-vs-SPEC consistency state

**Pattern 1 — Recency-as-staleness.** The most striking finding is that PRIMER §6.2 (added S122, last week) ALREADY drifts from SPEC §4.18 (S111, the week prior). Even brand-new canon authoring isn't catching every recent ratification. This is a structural pattern that the lockdown methodology will need to address — a primer or kickstarter update is itself a vector for drift.

**Pattern 2 — Direction-asymmetry of canon drift.** Most canon drifts are "canon stale BEHIND SPEC ratification" (F-001, F-002, F-013, F-014, F-021, F-022). One canon drift is "canon AHEAD of SPEC ratification text" (F-010). This asymmetry suggests the user is correct that SPEC + canon must both be authoritative and in lock-step — a one-way "canon-derives-from-SPEC" model misses the cases where canon is the leading edge of a ratification.

**Pattern 3 — Native parser IS the empirical ground truth.** The native parser source enforces what's actually parseable today, and it correctly enforces the post-ratification SPEC across every spot-check I performed (F-002, F-013, F-021). When the canon drifts from SPEC, the native parser drift's-direction is "with SPEC, against the stale canon" — which is exactly why the user's lockdown plan starts with inventorying drift before doing fixes.

**Pattern 4 — PIPELINE.md is a third stakeholder.** PIPELINE.md has its own normative content (stage contracts, failure-mode catalog) that can drift from SPEC independently. F-011 (Stage 7.6 INACTIVE markers stale), F-018 (Stage 6.7 VSS synthesis trigger), F-021 (Stage 3.05 NR autoDeriveEngineVarName) are all PIPELINE-vs-SPEC drifts. The grammar-lockdown methodology should treat PIPELINE as a peer of PRIMER + kickstarter, not as a derivative.

### What I couldn't classify / bailed on

- The S94 `~`-disposition designer-card / "is `~` ratified, retired, or open?" question — out of dispatch scope but worth flagging that PRIMER §11 line 1242 says "If you find yourself writing `~name = expr` for derived reactive, stop. Use `const <name> = expr` (read at `@name`)." This implies `~` is retired in this position, but `~` does exist (SPEC §32 — pipeline accumulator). User-voice memory references designer-card framing for this — out of scope for inventory phase.

- The S124 "consumer migration by shape preservation" memory-file rule has spec-text implications I did not chase — when a canon's recipe expectations differ from the empirical migration shape, that's another drift class worth a future audit. Out of scope for this dispatch.

### Heads-up coding session recommendations

For the Phase 2 heads-up coding session(s), recommend these batches:

1. **Mass canon-currency update** (LOAD-BEARING, mechanical): F-001 + F-002 + F-013 + F-022. All kickstarter + a couple of cross-cutting fixes. Can be one dispatch with careful diff review.

2. **PRIMER recency + display-text literal update**: F-014 + F-010. Two PRIMER updates (§6.2 + §7 worked examples for F-014; §2 add Pillar 5b for F-010). Should land in one dispatch.

3. **SPEC self-consistency batch**: F-005 + F-009 + F-018 + F-019. Four SPEC-internal contradictions. Each is a small surgical edit but the BLAST RADIUS is high — needs Phase 1a's full SPEC walk to be in hand before committing.

4. **PIPELINE-vs-SPEC alignment batch**: F-011 + F-018 (PIPELINE side) + F-021. Three PIPELINE corrections. Smaller dispatch.

5. **HOLE-fill batch**: F-008 (PRIMER + kickstarter add default-logic body-mode awareness). Lower-priority, can be folded into a documentation refresh wave.

### Out-of-scope observations worth recording

- `compiler/PIPELINE.md` v0.7.2 changelog (line 9, dated 2026-05-18) does not mention any S111 / S114 / S118 amendments — PIPELINE.md is ~1 month behind SPEC's recent ratification cadence overall. Worth a broader currency-refresh of PIPELINE that goes beyond just the F-011 + F-018 + F-021 cases I caught.

- The `<page>` element family (`<auth>`, `<onTimeout>`, `<onIdle>`, etc.) registered at SPEC §4.15 + §40 are intentionally absent from kickstarter (which is LLM-onboarding-scoped) — that's an acceptable pedagogical choice, not a drift. PRIMER §9.6 line 479 covers the structural-elements registry. This is corroboration, not finding.

- Native parser .scrml mirror files for the M5/M6 parser-rewrite arc need their own audit pass eventually (per memory `feedback_native_parser_scrml_predicate_drift` S115 precedent — `is not not` shipped in some .scrml files). That's a Phase 3+ "100% example-code coverage" item; not in Phase 1b scope.

