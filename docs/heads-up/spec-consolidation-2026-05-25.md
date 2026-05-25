---
status: in-progress
started: 2026-05-25
session: S129
phase: 2 — heads-up resolutions per finding
inputs:
  - docs/audits/spec-consolidation-inventory-2026-05-24.md (Phase 1a — SPEC.md sequential walk)
  - docs/audits/spec-corroboration-canons-pipeline-2026-05-24.md (Phase 1b — canon-anchored corroboration)
findings-total: 39 (17 from 1a + 22 from 1b; some overlap)
findings-closed: 1 (F-003)
findings-implicit-confirmed: 2 (V-kill decl form direction via Q1; ^{}-as-meta direction via Q2)
---

# SPEC Consolidation — Heads-Up Resolutions (Phase 2)

This is the running log of per-finding resolution decisions for the SPEC consolidation effort. Each HU-N sub-session resolves one or more findings from the Phase 1a + Phase 1b audits. When a finding is closed here, Phase 3 (example coverage / SPEC amendment / canon migration) executes against the direction recorded.

**Conventions:**
- HU-N = heads-up sub-session N. Sequentially numbered.
- Each HU section records: questions discussed, decisions ratified (verbatim user direction where applicable), findings closed / advanced, carry-forward open items, and next-HU candidate questions.
- Option labels: ASCII letters `(a)` / `(b)` / `(c)` or short words — NEVER Greek (per [[feedback_no_greek_chars_in_options]] — user can't type them on their keyboard).
- Final resolution direction is reproduced here verbatim so Phase 3 work has a single source of truth. The audit docs are the EVIDENCE chain; this doc is the DECISIONS chain.

---

## HU-1 — 2026-05-25 — Mental-model anchors + F-003 ratification

### Questions discussed

**Q1 (user):** *"is `: string? ` syntactic suguar for `: not -> string` ?"*

**Q2 (user):** *"`^{}` Im not sure if I have gone back and forth on this or if I was along for the ride (my fault). the way I see it (now at least) is that the up arrow is like saying 'go over his head'. does that make sense?"*

### Q1 resolution — `string?` is sugar for `string | not` (union, not arrow)

**SPEC §7.5 line 5573 is authoritative:** *"`T?` sugar. Postfix `?` is syntactic sugar for `T | not`. The compiler desugars before type checking."*

In code:
```scrml
<selected>: string? = not
// desugars to
<selected>: string | not = not
```

The `not -> string` phrasing in Q1 was an informal sketch; `->` in scrml is the function return-type arrow (`function f() -> string { ... }`), not a union connector. PA confirmed the union reading; user's mental model is anchored.

**Implicit ratification carried by Q1:** the migration target for the V-kill cluster (F-001 / F-008 / F-009 / F-016) uses `<x>: string? = not` syntax — user did not contest the migration shape, only the desugaring semantics. The V-kill direction (amend §7.5 grammar production + ~30 worked examples + §52.4.1 sibling to V5-strict structural form) is implicit-confirmed for HU-2 finalization but not yet executed.

### Q2 resolution — `^{}` mental model anchored to S114 Approach C

**The user's mental model:** *"the up arrow is like saying 'go over his head'"*. PA confirmed this matches Approach C (S114) when read as **"go over the runtime's head"** — `^{}` is the compile-time context. Code inside runs DURING COMPILATION, not at app-runtime. The compiler reads it, evaluates it, and inlines the result.

**NOT "over the language's head"** — Approach C explicitly closed the JS-host escape path (pre-S114 proposals that permitted `await import(...)`, `bun.eval()`, host ambient globals). Per SPEC §22.12: *"The general-developer `^{}` body parser SHALL accept only scrml-native + this enumerated primitive set; JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) are NOT in the META_BUILTINS set and trigger E-META-001."*

What's IN (S114 closed set):
```scrml
^{
    const fields = reflect(User).fields           // compile-time introspection
    emit(`<input name="${field.name}"/>`)         // compile-time markup gen
    const userType = reflect(User)                // scrml-native + 3 compile-time primitives
}
```

What's OUT:
```scrml
^{
    const config = await import("./config.js")    // E-AWAIT-NOT-IN-SCRML
    const year = bun.eval("Date.now()")           // E-META-001
    const data = await fetch(url)                 // E-META-001
}
```

### F-003 RATIFICATION — disposition (a) "subsume" — Approach C subsumes §30.2

**User ratification (verbatim, HU-1):** *"a"* (with note: user keyboard can't type Greek characters; PA banked the rule [[feedback_no_greek_chars_in_options]] going forward).

**Decision:** Approach C extends transitively to `${}` markup interpolation. `bun.eval()` retires as a user-facing surface entirely. The "over the runtime's head" reading from Q2 applied uniformly: `bun.eval()` is JS-host runtime escape, not compile-time meta — doesn't belong in EITHER `^{}` body OR `${}` interpolation.

**Concrete mechanical migrations this ratification triggers:**

1. **SPEC §22.4 line 13217 amendment.** The four-item list of "compile-time meta API patterns":
   - REMOVE `bun.eval(...)` calls
   - Final three-item list: `reflect` / `emit` / `emit.raw`
2. **SPEC §30 retirement.** §30.1 (compiler-internal scope) MAY be preserved as a note that `bun.eval()` is an internal compiler implementation surface; §30.2 (`bun.eval()` inside `${}` markup interpolations) is RETIRED — the entire subsection deletes. §30.3 (security) deletes (no longer a user-facing surface to secure).
3. **SPEC §7.2 ${} extension list.** Remove the `bun.eval()` enumeration entry (the broken cross-ref to §29 also drops with it; F-009 closes mechanically).
4. **SPEC §22.12 amendment.** Add an explicit clause confirming Approach C extends to `${}` interpolation — eliminate any future ambiguity. Suggested clause: *"Approach C extends transitively to `${}` markup interpolation. JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) and arbitrary JS-host-eval surfaces (`bun.eval`, etc.) are NOT permitted in `${}` either; the meta surface for `${}` is the same enumerated primitive set as `^{}`."*
5. **E-EVAL-001 error code.** Currently fires when `bun.eval()` throws at compile time. Under (a), `bun.eval()` itself fires `E-META-001` at user-write-site. E-EVAL-001 may persist as compiler-internal-only (no user-facing fire path) OR retire. **Open sub-question for HU-2:** what's E-EVAL-001's residual disposition?
6. **Compiler-managed alternative for the "year" example.** §30.2's worked example `<footer>© ${ bun.eval("new Date().getFullYear()") }</footer>` needs a non-`bun.eval` canonical form. Options for the new canonical form (open for HU-2):
   - (a) `${ meta.compileTimeYear() }` — new compile-time meta primitive (extends META_BUILTINS to 13; minor)
   - (b) A stdlib helper `import { currentYear } from "scrml:time"; ... ${ currentYear() }` — runtime, not compile-time (the year renders fresh per page load)
   - (c) Hardcoded literal — the user types the year. Lowest-tech.
7. **Cascade closures (mechanical, not separately discussed):**
   - F-002 (1a) — §22.4 list shrinks per migration #1
   - F-010 (1a) — §7.2 list shrinks per migration #3

### Findings closed by HU-1

- **F-003 (1a, LOAD-BEARING, GENUINE DESIGN QUESTION)** — RATIFIED (a) subsume. Approach C extends to `${}`. `bun.eval()` user surface retires.
- **F-002 (1a, LOAD-BEARING)** — mechanical cascade — §22.4 list amendment per F-003 disposition.
- **F-010 (1a, MEDIUM)** — mechanical cascade — §7.2 list amendment per F-003 disposition.
- **F-009 (1a, LOW)** — mechanical cascade — §7.2 broken cross-ref §29→§30 fixes via §7.2 list amendment (the `bun.eval()` entry that carried the broken cross-ref is removed).

### Findings advanced (implicit-confirmed, awaiting HU-2 mechanical finalization)

- **F-001 (1a, LB) / F-009 (1b, LB)** — V-kill direction at SPEC §7.5 implicit-confirmed via Q1 (user accepted `<x>: string? = not` as canonical V-kill decl shape). HU-2 to formally ratify.
- **F-016 (1a, LB)** — V-kill direction at SPEC §52.4.1 server-authority sibling. Implicit-confirmed via Q1 + the cluster-A direction. HU-2 to formally ratify.
- **F-008 (1a, LB)** — V-kill ~30 worked example migration. Implicit-confirmed via Q1. HU-2 to formally ratify.

### Carry-forward open items from HU-1

- **§30.2's "year" example replacement form.** Sub-question 6 above. HU-2.
- **E-EVAL-001 residual.** Sub-question 5 above. HU-2.

### Banked methodology from HU-1

- **[[feedback_no_greek_chars_in_options]]** — PA SHALL NOT use Greek characters in option labels; user can't type them on their keyboard. Use ASCII `a` / `b` / `c` or short words.

---

## HU-2 — 2026-05-25 — Lifecycle annotation discovered + syntax disambiguated

### Context

During HU-2 (incremental), user clarified that their earlier `not -> string` sketch (which PA initially read in HU-1 as an informal union) was invoking the existing **`(A -> B)` lifecycle annotation** at SPEC §14.3 line 7107. User couldn't recall the exact syntax (forgot parens). PA grep'd the archive and surfaced:

- SPEC §14.3 line 7099 + 7107 — current SPEC ratifies `(A -> B)` lifecycle annotation; post-S89 already uses `not` (`passwordHash: (not -> string)`); E-TYPE-001 fires on access-before-transition.
- 3 deep-dives from 2026-04-08 (state-dynamics-design / debate-state-dynamics / contracts-mutable-data).
- Article draft `scrml-support/voice/articles/mutability-contracts-draft-2026-04-29.md` — frames lifecycle annotation as flagship feature in 11 places.
- state-dynamics-design DD `status: active` since 2026-04-08 — open extension question.

Two audit holes surfaced:
- **F-023 (NEW from HU-2)** — PRIMER + kickstarter v2 carry ZERO mentions of lifecycle annotation despite SPEC §14.3 ratifying it.
- **F-024 (NEW from HU-2)** — Syntax-overload of `->` token: serves both static return-type annotation (`function f() -> string`) AND temporal lifecycle annotation (`(not -> string)`). Semantically disjoint uses; same glyph.

### User-voice anchor (verbatim)

> *"yes a. this was part of the basis. when I first envistioned the scrml type-system, this was my first real novel (at least to me (truck driver(no knowledge of specific prior art))) idea for scrmls type system"*

Lifecycle annotation is FOUNDATIONAL to scrml's type-system identity; predates V5-strict, V-kill, engines-as-Tier-2. Catch-up scope for F-023 is FLAGSHIP-section, not footnote.

> *"I dont care so much about what syntax we use, I dont want to crowd -> if it is fundamentally something else."*

Syntax-overload concern legitimate. Return-type and lifecycle are static-vs-temporal — fundamentally different concepts. `->` keeps return-type (Rust/OCaml/Haskell/Python prior-art alignment); lifecycle gets a temporally-flavored token.

### F-024 ratification — `to` (CONTEXTUAL keyword) for lifecycle annotation

**User-voice trail (verbatim, HU-2 sub-thread):**

> *"confirm then is unused, lock it"*

[PA grep'd `then` — unused as scrml keyword. Initial lock landed.]

> *"is "to" a kw?"*

[PA grep'd `to` — NOT a scrml keyword at lex level; heavy use as `<onTransition to=>` / `<onTimeout to=>` / `<onIdle to=>` ATTRIBUTE name (semantic-consistent with lifecycle "transition to" reading); one existing sample uses `to` as parameter name: `samples/gauntlet-r14/rust-state-machine.scrml:26` — `function isValid(from, to) { ... }`.]

> *"swap to to, but here's the thing If this compiler can infer everything that it does there should be no issue with to usage later ( or very minimal, and mitigabel )"*

**FINAL LOCK: lifecycle annotation syntax is `(A to B)` with CONTEXTUAL-KEYWORD semantics for `to`.**

`to` is recognized as `KwTo` only in the lifecycle-annotation type-expression context (`( A to B )` inside a type position — primarily struct-field type annotations per current SPEC §14.3, and any future contexts the heads-up extends lifecycle annotations to per the state-dynamics-design DD carry-forward). In every other context — function-parameter lists, local-variable declarations, expression position, property access — `to` parses as an ordinary identifier.

**No existing sample needs migration.** The `samples/gauntlet-r14/rust-state-machine.scrml` `function isValid(from, to) { ... }` parameter-name use stays valid: `to` in a function-parameter list is NOT in lifecycle-annotation type-expr position, so contextual recognition doesn't fire.

**Precedent for contextual-keyword semantics:** scrml ALREADY does this with `from` — `from` is a keyword in `import { x } from "..."` position and an identifier elsewhere. The composed-engines architecture (S98 + S111 charter B) treats lexer-mode and grammar-context as first-class design tools; adding `to` as a contextual keyword extends an established pattern without new mechanism.

**User's mitigation framing (verbatim above):** the compiler's contextual-inference IS the mitigation. Future adopter use of `to` as identifier (variable / param / property) is unaffected outside lifecycle-annotation type-expr position. Edge cases (an adopter writes a lifecycle-annotation-shaped expression containing a `to` identifier inside the type — improbable shape) can be diagnosed via a `W-IDENT-CONTEXTUAL-KEYWORD` info-lint when the parser observes ambiguity — informational, not error.

**Reserving discipline:** `to` is contextually-reserved at the scrml-source level FOR THE LIFECYCLE-ANNOTATION TYPE-EXPR CONTEXT ONLY. Future SPEC amendments SHALL NOT introduce additional context-positions that recognize `to` as a keyword without explicit heads-up ratification — the contextual-keyword surface stays narrow.

### Migration scope (concrete; mechanical)

**SPEC.md sites (Phase 2 amendment):**
- §14.3 line 7099 — `passwordHash: (not -> string),` → `passwordHash: (not to string),`
- §14.3 line 7107 — normative statement `(A -> B) — lifecycle annotation` → `(A to B) — lifecycle annotation`. Update the prose accordingly.
- Any other `(A -> B)` in SPEC body referencing lifecycle — PA to grep + sweep during the Phase-2 SPEC amendment work.

**Mutability-contracts article draft (status: draft, not shipped; revise before publication):**
- Line 125, 250, 252, 338, 361 — all `(A -> B)` / `(null -> ...)` / `(null -> T)` / `null -> number` references migrate to the `to` form.
- Note: line 338 still references `null -> string` (pre-S89). Two migrations in one sweep: `null` → `not` AND `->` → `to`.

**PRIMER + kickstarter (F-023 catch-up):** new flagship sections use `(A to B)` from authoring outset.

**Phase 3 example coverage:** new sample / example files demonstrating lifecycle annotation use the `(A to B)` form from authoring outset. Existing samples that use `to` as a non-lifecycle identifier (e.g., `function isValid(from, to)`) stay as-is — contextual-keyword semantics handle the distinction.

**Native-parser implementation note (post-Phase-2):** when the lifecycle-annotation type-expr production is wired into the native parser, `to` recognition is gated on the parser's "in lifecycle-annotation type-expr" context-state; outside that context the lexer emits `Ident` for the `to` text. Same architectural pattern as the existing `from`-in-import handling. Bridge surface for the `->` legacy form remains available during the migration window (output the same lifecycle-annotation AST whether the source reads `(A -> B)` or `(A to B)`) until SPEC §14.3 amendment + corpus migration lands.

### Findings closed by HU-2 partial-batch (lifecycle thread)

- **F-024 (HU-2 NEW)** — RATIFIED. Lifecycle-annotation syntax disambiguates from return-type. Locked: `(A to B)`. `->` remains return-type-only.
- **F-023 (HU-2 NEW, was Q9 from HU-1 close)** — RATIFIED direction (a): PRIMER + kickstarter catch up to SPEC on lifecycle annotation. Flagship-section scope, not footnote. Uses post-F-024 syntax `(A to B)`.

### Open from HU-2 lifecycle thread (carry to HU-3)

- **state-dynamics-design DD extension question** (DD at `scrml-support/docs/deep-dives/state-dynamics-design-2026-04-08.md` — `status: active` since 2026-04-08). The DD asks "should `(A to B)` lifecycle annotations extend beyond struct fields to enum-state-cells, or do engines/Tier-2 subsume that use case?" Lifecycle annotation is foundational; the extension question is "did we accidentally narrow scrml's type-system in ratification?" PA recommends: read the DD in full + the debate sibling DD before HU-3 ratifies.

### Banked S129 methodology rule (NEW from this exchange)

**Bidirectional hole-detection in canon-anchored audits.** Phase 1b's hole-detection only fired on "canon claims X / SPEC silent on X" — it missed the inverse "SPEC ratifies X / canon silent on X." Both directions are signal. Future audit dispatches must include both checks. F-023 was the precedent that surfaced this: SPEC §14.3 ratifies lifecycle annotation as a load-bearing feature; PRIMER + kickstarter never mention it; Phase 1b's audit missed the gap entirely. (Memory to be banked separately if not already covered by [[feedback_triage_genuine_needs_spec_crosscheck]] — that's a sibling but distinct rule.)

---

## HU-3 candidate queue — next questions to surface

Ordered by directional-cleanliness (mechanical-confirmations first; SPEC-internal contradictions needing user-eyeballs second; genuine design questions third). PA will present these in the next chat exchange — not yet asked.

### Q3 (mechanical confirmation) — V-kill cluster direction final ratification

Closes F-001 (1a) + F-009 (1b) + F-008 (1a) + F-016 (1a). The direction is implicit-confirmed via HU-1 Q1 but not formally ratified. One "go" closes the whole V-kill cluster (cluster A in the heads-up agenda). Migration scope: SPEC §7.5 grammar production rewrite + §52.4.1 server-authority sibling rewrite + ~30 worked example mechanical migration across §4.12 / §5 / §6.5 / §6.6 / §6.7 / §13.5 / §15.10 / §22.5 / §40.7 / §51.x / §52 / §55 / §56.

### Q4 (mechanical confirmation) — PIPELINE.md `deriveEngineVarName` "Machine" suffix-strip

Closes F-021 (1b, LB). SPEC §51.0.C explicit table says `MarioMachine` → `marioMachine` (literal lowercase-first, suffix KEPT). PIPELINE.md line 822-830 algorithm strips the suffix (`MarioMachine` → `mario`). PRIMER B14 corroborates SPEC. Direction: PIPELINE catches up to SPEC. Confirm.

### Q5 (needs user eyeballs — SPEC-internal contradiction) — F-019 schema placement after v0.3

SPEC §39.2/§39.3 prose says "alongside, not inside" `<program>`. The §39.2 worked example shows `<schema>` INSIDE `<program db="...">`. §40.8 v0.3 ratification says "one-program-per-application; everything inside `<program>`." Three different positions in the same SPEC.

Question: post-v0.3, what does "top-level" mean for `<schema>` placement?
  - (a) Inside `<program>` as a direct child (matches §39.2 example + v0.3 ratification; §39.2/§39.3 prose updates to match)
  - (b) Outside `<program>` at file root (matches §39.2/§39.3 prose; §39.2 example updates + v0.3 needs a `<schema>` exception)

PA's read: (a) is consistent with v0.3 one-program-per-application; the prose drifted, not the example. But the audit takes no side until heads-up explicitly decides.

### Q6 (needs user eyeballs — SPEC-internal contradiction) — F-018 §55.5 validity surface synthesis trigger

PA hasn't surfaced the contradicting text yet; will read SPEC §55.5 + PIPELINE Stage 6.7 + PRIMER §8 before HU-2 starts and present the two contradicting positions in the next chat exchange.

### Q7 (mechanical confirmation, batched) — Kickstarter v2 staleness wave

5 LOAD-BEARING + 2 MED kickstarter drifts (1b F-001, F-002, F-013, F-022, F-020, F-003, F-007). All "kickstarter catches up to SPEC" mechanical. Batch one "go" closes them all. Migrations: channels file-level → channels inside `<program>` · `@debounced(N)` → `debounced=DURATION` attribute · `<x> pinned` → `<x pinned>` · `< db>` `protect=` → updated form · add "no async/await" standing rule · drop the `<*>` example shorthand · scattered rule= arrow form vs target form cleanup.

### Q8 (needs user direction) — PRIMER §6.2 quoted-text drift (F-014, LB)

Migration target is mechanically clear (bare prose → `"..."` display-text literal per S111). Already shown in HU-1 worst-offender 5 with the post-migration form. Confirm migration direction; no design ambiguity.

### Out-of-near-queue (revisit after the LB batch)

- F-004 (§3.1 Contexts table HOLE — missing `^{}` / `_{}` / `!{}`)
- F-011 (§4.15 structural-elements registry HOLE — consolidation question)
- F-005 / F-006 / F-007 / F-014 / F-015 / F-017 (Phase-1a structural cleanup batch — TOC + headings + renumber leftovers)
- Cluster C (validity surface, §55.5 + §6.11) — after Q6
- Cluster F (engine surface) — after Q4 lands
- PRIMER Pillar 5b (F-010, 1b) — SPEC catches up to canon; needs heads-up direction

---

## Index — finding closure status

| Finding | Source | Severity | HU status | Resolution direction |
|---|---|---|---|---|
| F-001 (1a) | §7.5 V-kill grammar | LB | implicit-confirmed; HU-2 finalize | amend to V5-strict structural form |
| F-002 (1a) | §22.4 `bun.eval()` list | LB | **closed HU-1 cascade** | remove `bun.eval()` from list |
| F-003 (1a) | §30.2 Approach C subsumption | LB GDQ | **closed HU-1 ratified (a)** | subsume — `bun.eval()` retires |
| F-004 (1a) | §3.1 contexts table HOLE | MED | queued | TBD |
| F-005 (1a) | TOC stops at §54 | LOW | queued (cleanup batch) | extend TOC |
| F-006 (1a) | §49 H1 heading | LOW | queued (cleanup batch) | normalize to H2 |
| F-007 (1a) | §53 H2 subsections | LOW | queued (cleanup batch) | normalize to H3 |
| F-008 (1a) | SPEC-wide ~30 examples | LB | implicit-confirmed; HU-2 finalize | mechanical sweep to V5-strict |
| F-009 (1a) | §7.2 cross-ref §29→§30 broken | LOW | **closed HU-1 cascade** | cross-ref fixes via §7.2 list edit |
| F-010 (1a) | §7.2 lists `bun.eval()` | MED | **closed HU-1 cascade** | remove `bun.eval()` from list |
| F-011 (1a) | §4.15 structural registry HOLE | MED | queued | consolidate §4.15 + §15.X |
| F-012 (1a) | SPEC-INDEX stale channel | MED | queued | update SPEC-INDEX |
| F-014 (1a) | §40 H4 §39.x leftover | LOW | queued (cleanup batch) | renumber |
| F-015 (1a) | §39 H4 §38.x leftover | LOW | queued (cleanup batch) | renumber |
| F-016 (1a) | §52.4.1 V-kill server-auth | LB | implicit-confirmed; HU-2 finalize | parallel to F-001 |
| F-017 (1a) | §52 `< TypeName>` space-form | LOW | queued (cleanup batch) | strip whitespace |
| F-001 (1b) | Kickstarter channels file-level | LB | queued (Q7 batch) | catch up to v0.3 (inside `<program>`) |
| F-002 (1b) | Kickstarter `@debounced(N)` retired | LB | queued (Q7 batch) | catch up to `debounced=DURATION` |
| F-003 (1b) | Kickstarter no-async/await missing | MED | queued (Q7 batch) | add standing rule |
| F-004 (1b) | Kickstarter rule= arrow vs target | MED | queued (Q7 batch) | cleanup |
| F-005 (1b) | §6.11 stub singular `error` | MED | queued | catch up to §55 `errors[]` |
| F-006 (1b) | PRIMER §8 S66 correction | MED | queued | confirm/refresh |
| F-007 (1b) | Kickstarter `<*>` shorthand | LOW | queued (Q7 batch) | drop entry |
| F-008 (1b) | default-logic body-mode silent | MED | queued | add to PRIMER+kickstarter |
| F-009 (1b) | §7.5 V-kill grammar (overlap 1a F-001) | LB | implicit-confirmed; HU-2 finalize | per F-001 |
| F-010 (1b) | PRIMER Pillar 5b ahead of SPEC | MED | queued | SPEC catches up to PRIMER |
| F-011 (1b) | PIPELINE Stage 7.6 RS status | MED | queued | reconcile internally |
| F-012 (1b) | PIPELINE retired AST kinds | LOW | queued | passive→retired |
| F-013 (1b) | Kickstarter `<x> pinned` wrong | LB | queued (Q7 batch) | catch up — `<x pinned>` |
| F-014 (1b) | PRIMER §6.2 quoted-text drift | LB | queued (Q8) | migrate bare prose → `"..."` literal |
| F-015 (1b) | default-logic body-mode silent in canons | (subset of 1b F-008) | queued | per F-008 |
| F-016 (1b) | engine decl=mount cross-file note | LOW | queued | minor clarification |
| F-017 (1b) | structural elements corroborated | (cleared) | n/a | n/a |
| F-018 (1b) | §55.5 validity synthesis trigger | LB | queued (Q6) | needs heads-up — text-eyeballs |
| F-019 (1b) | §39.12 schema placement | LB | queued (Q5) | needs heads-up — text-eyeballs |
| F-020 (1b) | Kickstarter `< db>` `protect=` | MED | queued (Q7 batch) | catch up |
| F-021 (1b) | PIPELINE deriveEngineVarName | LB | queued (Q4) | PIPELINE catches up to SPEC |
| F-022 (1b) | Kickstarter §11.4 stale recipe | LB | queued (Q7 batch) | catch up |
