# Language-Version Scheme (D1) + Deprecation Lifecycle (D4) — RULING (S234, 2026-07-01)

**Status:** RATIFIED (user S234 — "your lean. go", after the load-bearing axis [Fork 1: removing-major vs permanent-soft] was named explicitly and delegated to the PA lean).
**Builds on:** the V1 authority `scrml-support/docs/deep-dives/language-compiler-split-2026-06-29.md` (§3 D1/D4 LEANs; §2 the conformance-bug-not-breaking-change thesis; §4 discipline-forward + fail-closed-Nominal invariant) + the D3 conformance corpus (built, 69 cases, gated).
**Research:** two S233 deep-dives, both `scrml-support/docs/deep-dives/`: `language-version-semver-scheme-2026-06-30.md` (D1) + `deprecation-lifecycle-2026-06-30.md` (D4). Both decisive-with-residual-forks; this RULING takes every fork's recommended pole.
**Scope of the split this closes:** the *contract-half* of the language/compiler split — the version surface + the deprecation machinery that make "a breaking change is a deliberate language-version event, not a compiler-cutover accident" operationally real. Concurrent-with-V1, cheap. (D2 mechanical spec-partition + D5 native gate remain separate.)

---

## ⚑ AMENDED 2026-08-19 (S353, dpa-034) — the POPULATION PREMISE is STRUCK from D1 and D4

> **Provenance:** `ruling:user-voice-scrml.md S353` — bryan, *"your rec on all three"*, ratifying verbatim: *"**Strike the population premise from D1 AND D4.** It is the reasoning ruled INADMISSIBLE at S346 (corpus-zero / ecosystem-size is blast-radius evidence only)."*
> **supersedes:** the four population-premise clauses of this RULING, quoted verbatim in the table below. Deliberation: `scrml-support/docs/deep-dives/d1-no-editions-round2-panel-gap-closed-dpa-034-2026-08-19.md` (5/5 poles) + its round-1 parent + `language-editions-dpa-034-2026-08-19.md`.
> **Direction-of-change: `inert`.** Every ratified CONCLUSION in this document is UNCHANGED. What is struck is reasoning, not rulings — nothing here re-opens Fork 1, the tier anchors, the 1.0-final gate, or any residual fork.

**The rule being applied.** A count of how many people write scrml measures **blast radius** — who is affected by a change. It is never evidence about whether a capability *should exist*. Deciding a language question on it is the reverse ouroboros the S346 ruling named, and it is inadmissible regardless of which way it points.

**Struck as the wrong KIND of reason, NOT as a false one.** The population premise was independently measured **TRUE** at S350 (`gh issue list --state all` → three authors all time; the author of adopter issue #471 is one of the two non-owners). Striking it for staleness would rule on a false fact. It is struck because a true statement about reach cannot answer a question about design.

| # | where | struck verbatim | replaced by |
|---|---|---|---|
| 1 | **D1 item 4** ("No editions") | *"YAGNI for two friends;"* … *"Rust's edition-coexistence price buys 'never split a global ecosystem' — not worth it here."* | Three population-INDEPENDENT reasons, now normative in **SPEC §62.8**: no registry / no independently-versioned units (§41.4) · conformance is ONE predicate over a BUILT, gated corpus (§62.2) · N rule-sets = N languages the compiler, checker, formatter and **LSP** carry forever. See the D1 item-4 rewrite below. |
| 2 | **D1 Fork C** (unpinned-source default) | *"(Go-style, zero ceremony for two friends)"* | *"(Go-style, zero ceremony)"* — the ruling (C1) is unchanged; only the population clause is removed. |
| 3 | **D4 item 3** (timing rule) | *"(PEP-387's "≥2 releases" shrunk to scrml-scale)"* | *"(PEP-387's "≥2 releases", shortened — scrml's release cadence is version-EVENT-driven, not calendar-driven, so the in-window guarantee is carried by the corpus-clean clock in the same item rather than by a release count)"* — the ≥1-released-MINOR rule itself is unchanged. |
| 4 | **§0** (Fork 1 rationale, source 2) | *"+ the D4-LEAN "light windows — two friends, no multi-year ceremony""* | Dropped. Source 2 stands on the user's own directly-quoted voice — *"I don't want to do any more work on migration efforts"* — which is operator intent, not a population count. Sources 1 and 3 are untouched. |

**⚑ TWO FURTHER PREMISES ARE ALSO DEAD — do NOT reinstate either as the replacement.** After the population premise was first challenged, two substitutes were offered and both were refuted by live expert poles:

- **`-std=` / `go 1.x` as a "genuine middle"** — REFUTED (round 1). Go 1.22's loop-variable change is gated **per package** off the module's `go` line; `cmd/compile` carries BOTH semantics and selects between them in one build, one binary. That is what an edition IS. C++ `-std=` likewise — *"a labeling move, not a design move."*
- **"no separate compilation"** — REFUTED (round 2, by BOTH late voices independently). GHC runs a per-file rule-set boundary *inside* whole-closure-from-source compilation, with no registry and no separate compilation. The absence of separate compilation explains why per-unit knobs would be **cheap to build**; it does no work toward showing they are **unnecessary**. The surviving load-bearing fact is **no registry / no independently-versioned units** (`compiler/SPEC.md:23341`, §41.4).

**Two round-2 findings recorded here so they are not mis-cited later** (both re-verified by execution at this landing):

- The *"tripwire already tripped"* claim is **REFUTED**. §62.6 is a subset/ceiling gate, not a divergent rule-set — and it is **100% unbuilt**: `E-LANGUAGE-VERSION-TOO-NEW` has **zero** fire sites (the string exists only in SPEC + hand-off prose), and `scrml.toml` is parsed nowhere — it appears in the compiler solely as a project-root marker filename (`compiler/src/codegen/chunk-namespace.ts:96`), with no TOML parser invoked anywhere in `compiler/src`. D1 item 5's behaviours below are therefore still **entirely spec-ahead**.
- The chunk-retention instrument is **INERT** for decoupling deprecation from deletion. `chunks.json` has **zero read sites in `compiler/src/`** — it is write-only there (`compiler/src/api.js:3363-3369`); the one reader in the tree is the shipped MCP topology stdlib at runtime (`compiler/runtime/stdlib/mcp.js:147`), not a compile input. So retaining a chunk retains compiled **output**, never the ability to compile the **form**.

**⚑ STANDING TRIPWIRE, carried forward:** *the moment `[language] version=` (D1 item 5 / §62.6) is read by the compiler to select between two behaviours for the same syntax — not merely as a manifest field — it HAS become an edition mechanism regardless of its name.*

**NOT decided here, and deliberately left open:** whether scrml should ever exercise **true removal at a MAJOR**. That is a separate question, opened at S353 as its own deliberation. *"No editions"* and *"true removal at a MAJOR"* are logically independent claims. **D4 item 3 and SPEC §63.3 are untouched by this amendment** — nothing above narrows, pre-empts, or ratifies them.

---

## 0. THE LOAD-BEARING AXIS — Fork 1 (D4): permanent-soft freeze

**RATIFIED: (b) permanent-soft.** scrml-language-1.0 ships with the full deprecation stage-machine present but **ZERO scheduled removals** — every existing deprecation is SOFT-DEPRECATED/unscheduled. The removal half of the machine is *latent, documented machinery*; the first real removal waits for a concrete pain signal that may be years out or never. A removing-major (language-2.0 that actually deletes forms) is NOT pre-scheduled.

**Why this is the ruling, not a silent PA call:** it converges three independent sources — (1) both dives lean (b); (2) the user's own prior voice ("I don't want to do any more work on migration efforts"); (3) the user explicitly named this axis and said "your lean." It is the user's stated intent operationalized, not a fresh axiom minted by the PA. *(S353: the D4-LEAN's population clause struck from source 2 — see the amendment banner. Source 2 stands on directly-quoted operator intent; sources 1 and 3 are untouched and the ruling is unchanged.)*

**Consequence (the discipline-forward payoff):** language-1.0 is **frozen with no pending breaking changes** — because *nothing is scheduled to break*. This satisfies the §4 discipline-forward invariant ("never knowingly ship V1 with a pending breaking change") by construction. Reversible: if a concrete removal signal ever arrives, a Stage-2 schedule can be minted then via a deliberate version-event (the machine supports it; it just isn't armed at 1.0).

---

## D1 — the LANGUAGE-version (semver) scheme (RATIFIED)

1. **Two independent version axes.** `scrml-language` `MAJOR.MINOR.PATCH` (the CONTRACT) ⟂ `scrmlc` `package.json` semver (the IMPLEMENTATION, `0.7.1`, bump-on-tag unchanged). They move independently — a compiler *patch* can add a language *minor*; a compiler `2.0` (native cutover) can still implement `language-1.0` unchanged. (Go's `go`+`toolchain` two-axis manifest.)

2. **Tiers anchored to the conformance corpus** (the corpus IS the versioned contract — the operational definition of "the language" = the set of `(source → required-codes + required-runtime-effect)` tuples the corpus pins):
   - **MAJOR** = a breaking conformance change: a `deprecated`-form promoted to *rejected*; a runtime-effect redefinition; a sanctioned-form removal; a `future`-form brought in shape-incompatible with a prior accepted form.
   - **MINOR** = additive/backward-compatible: a new sanctioned form; a widened legacy tolerance (new `deprecated`-tier case, accept+W-lint); a `future` fail-closed diagnostic made more honest.
   - **PATCH** = clarification, zero behaviour change: coverage-hole closure of already-normative behaviour; case metadata fix (`expect` unchanged); robustness normalization. (Most 69→N corpus growth during V1 hardening is PATCH.)
   - Each `expected.json`-touching commit declares its bump tier; the corpus is the ledger.

3. **Compilers declare via `chunks.json`** — add a **`language`** field beside the existing `compiler` field. `compiler` = which impl produced this build (`scrml-0.7.1`); `language` = which frozen contract it conforms to (`"1.0-rc"` today). Single-sourced from the build's resolved language version; informational/provenance, **NOT a content-address hash input** (same posture as `compiler` per §47.5 / §40.9.8). Two impls at different `compiler` strings carrying the same `language` = the multi-impl invariant made observable.

4. **No editions in the 1.0 surface as built** (D1 LEAN; **REASON AMENDED S353 — see the amendment banner above; the conclusion is unchanged**). The deprecation cycle (D4) handles transitions with ONE rule-set per language version and no coexistence machinery. Takes the *axis-separation* (load-bearing) + the *deprecation cycle* (Go-style), declines editions. **The three grounds, all independent of how many people write scrml** (normative text: SPEC §62.8):
   - **No unit boundary where two independently-versioned, already-committed rule-sets could meet.** §41.4 is normative that npm-style bare specifiers are `E-IMPORT-005` and *"scrml has no npm integration"* — no registry, no name-to-version resolution, therefore no independently-versioned unit. Every unit reaching a build is source, re-parsed under the consumer's single live pin inside the §21.7 whole-program closure; the sealed artifact an edition's guarantee exists to protect is never produced. Survives scrml later gaining separate or incremental compilation.
   - **Conformance is ONE predicate.** The corpus (§62.2) is BUILT and pre-commit-gated and operationally IS the spec. Editions make conformance a *function of the pin*, and the §62.5 1.0-final gate stops naming one measurable thing.
   - **N rule-sets is N languages, carried forever by the whole toolchain** — compiler, checker, formatter, and most acutely the **LSP**, which must resolve the active rule-set per unit before it can be correct about anything. Haskell's measured cost of granular language variation landed on satellite tooling and pedagogy, not the core type-checker; scrml ships an LSP and a live cockpit.
   - **Recorded reopening condition:** *is this a front-end-only delta?* Rust retrofitted editions in 2018 onto a 2015 1.0 because everything edition-sensitive resolves before HIR and the borrow checker was never allowed to fork. The one-way-door claim is true for DEEP changes and is not a door at all for shallow ones.
   - **The honest cost, not smoothed over:** `vendor:` is BUILT, so third-party scrml *source* enters projects today with no version segment in the path — *"someone else wrote this and you now own the migration at a MAJOR"* is a real adopter cost. It is not a case for an interop guarantee.

5. **Adopters pin via `scrml.toml [language] version`** — sibling of the existing `[story]` (§58.4) + `[capabilities]` (§22.13) tables, read pre-parse. Behaviour:
   - **Newer-compiler-than-source:** compile under the PINNED rules; gate newer-only forms with an honest "this form requires language-1.1; this source targets 1.0" diagnostic (Go's rule verbatim). Because no editions, "compile under older rules" is simple: don't offer newer forms, keep accepting the `deprecated`-tier forms 1.0 accepted.
   - **Older-compiler-than-source:** **fail-closed** — "this source targets language-1.1; this compiler implements 1.0; upgrade the compiler" (C++ `-std=c++20` on a C++17 compiler → hard error). Never best-effort.

6. **`lang:` partition vocabulary** = `1.0` | `deprecated` | `future`, with these conformance semantics (D1 defines; D2 applies per-section; the corpus applies per-case):
   - `1.0` — in the frozen surface; a conformant impl implements it + passes its case(s).
   - `deprecated` — accepted-in-1.0-but-discouraged; a conformant impl **accepts** it AND fires the sanctioned `W-`lint (the W-code is a conformance-REQUIRED code). This legacy-tolerance is exactly what makes the native cutover non-breaking.
   - `future` — NOT in 1.0; a conformant impl **fail-closes** with an honest "not in language-1.0; tracked for vNext" diagnostic — never a silent miscompile / misleading code. (The known-gaps Nominal list IS the `future` set.)

7. **The 1.0-final gate** (Fork D — RATIFIED as the 3-part gate): (1) the conformance corpus IS the agreed 1.0 surface (every in-surface form has a case; D2 partition complete); (2) impl#1 (the TS compiler) passes **100%** of the 1.0 corpus; (3) **zero** pending breaking changes against the 1.0 surface (every discipline-forward item's *source-level discipline* has landed; mechanisms may defer as `future`/MINOR). **impl#2/native passing is NOT a 1.0 gate** — single-impl-conformance is enough to FREEZE the language while the 2nd impl catches up (this is the whole "V1 = the language, compilers get there when they get there" reframe; C++17/test262 model). Until all three hold: `1.0-rc.N`. **Today's state: `scrmlc 0.7.1` implements `language-1.0-rc`.**

### D1 residual forks — resolved
- **FORK A** (per-case schema): **A1** — split `expected.json`'s overloaded `"language-version"` into `suite-version: "1.0.0"` + `tier: in | deprecated | future`. Clean for D2; a `deprecated`-tier form is *part of* the 1.0 suite, so the two axes must not be conflated.
- **FORK B** (mis-authored-case bump boundary): **B1** — PATCH if the fix restores already-normative spec AND no shipped compiler relied on the wrong assertion; MAJOR only if the wrong assertion was adopter-observable in a released compiler.
- **FORK C** (unpinned-source default): **C1** — default to the compiler's highest fully-conformant language version (Go-style, zero ceremony); `[language] version` is the opt-in reproducibility pin, not mandatory. *(S353: the population clause struck — see the amendment banner. The ruling is unchanged.)*
- **FORK D** (1.0-final gate): the 3-part gate above, single-impl-conformance sufficient to freeze.
- **FORK E** (pre-release suffix): **E1** — mirror the compiler: `1.0-rc.N` then `1.0` (reuse the `-alpha.N`/`-beta.N`/stable muscle memory).
- **FORK F** (2-part vs 3-part semver): **F1** — three-part `MAJOR.MINOR.PATCH`; the PATCH tier is real (coverage-hole closures during hardening). Migrate the corpus `"1.0"` → `"1.0.0"`.

---

## D4 — the deprecation lifecycle (RATIFIED)

1. **Four-stage machine:** SANCTIONED (0) → SOFT-DEPRECATED (1) → SCHEDULED (2) → REMOVED (3), with PEP-387's soft-vs-scheduled as the Stage-1/Stage-2 seam. Stage 1 = the window (most of the corpus lives here forever under the Fork-1 ruling); Stage 2 = a deliberate version-event schedule pinned to a named MAJOR; Stage 3 = the reserved-E fires, form rejected, at the major event.

2. **The well-formedness invariant (the anti-pattern killer).** A deprecation is well-formed only if, at Stage-1 landing, it **co-lands** {a `W-`lint that parses-IDENTICALLY (same AST/JS/runtime)} + {a reserved `E-`code NAMED in §34} + {a `--fix` rule OR a designer-card waiver}. **It MUST NOT name a removal version at Stage-1 landing.** Scheduling (Stage 2) is a separate, later, deliberate version-event act. → This makes "planned for v0.3.0 / in P3" *structurally impossible* — the removal-version string is simply not allowed at Stage 1.

3. **Timing rule** (tied to D1 version-events): deprecate in any MINOR (additive — only adds a non-fatal W-lint); remove ONLY at a MAJOR (the sole place forms leave the language); ≥1 released MINOR in-window before a MAJOR may remove (PEP-387's "≥2 releases", shortened — scrml's release cadence is version-EVENT-driven rather than calendar-driven, so the in-window guarantee is carried by the corpus-clean clock below rather than by a release count); the clock is **version-events + corpus-clean, NOT a calendar**; a Stage-2 schedule is reversible-to-Stage-1 until the event fires. *(S353: the population clause struck — see the amendment banner. The ≥1-released-MINOR rule is unchanged, and whether true removal is ever exercised is the separately-opened question.)*

4. **`--fix` gate** (Fork 5 of the dive's §5): `--fix` is a **SHOULD** at deprecation, a **HARD GATE (verified-LANDED, not spec'd)** at scheduling/removal. A reserved-E MUST NOT be scheduled/fired for a form with no verified-landed codemod (removing a codemod-less form = hand-migration on every adopter site = exactly the friction the split dissolves). Only escape: an explicit **designer-card** waiver (rare/zero-corpus/trivial-hand-migration), recorded as a version-event decision. Live consequence: `g-server-keyword-drift` + `W-STATE-BLOCK-BARE-WRITE-DECL` are correctly BLOCKED from scheduling (no landed `--fix`).

5. **Conformance-versioning:** during the window both forms are in-contract with the W-code REQUIRED; the canonical + deprecated forms must produce IDENTICAL runtime (that identity IS the conformance assertion for a parses-identically deprecation). At removal the contract versions — the corpus row flips `{W} → {E}, rejected`; the reserved-E ENTERS the contract at the version event. Reserved-Es pre-allocated at Stage 1 ⇒ the language-(N+1) conformance delta is a known named set the day the deprecation lands. A native parser being *stricter* than 1.0 (rejecting a `deprecated` form) is a **conformance BUG in impl#2**, not a breaking change — this is the machinery that reclassifies "native enforces canonical" from a breaking event into an impl bug.

6. **`lang:` transition semantics** (D2 dependency): D4 owns `deprecated → removed`; D2 owns the labels; D1 (the version event) is the clock. `removed` prose is RETAINED for migration/historical reference, tagged with the removing version. Re-purpose side-branch: `deprecated → future` when a syntax is reclaimed for a new meaning rather than deleted. `future` and `deprecated` are the two non-1.0 ends of one axis (arriving vs leaving).

7. **Corpus disposition at 1.0 freeze** (executes the Fork-1 permanent-soft ruling):
   - **Unschedule the 3 floating-scheduled forms** — `W-DEPRECATED-001` (`<machine>`→`<engine>`, §51.3.2), `W-WHITESPACE-001` (§15.15.5), `W-CPS-NEEDS-FAILABLE` (§19.9.5) → reclassify SOFT-DEPRECATED/unscheduled; **strike "in P3" / "v0.3.0" from their prose** (dead pre-1.0 compiler labels, never legitimate schedules). Reserved-Es remain named, unfired.
   - **`g-server-keyword-drift` + `W-STATE-BLOCK-BARE-WRITE-DECL`:** SOFT, gate-blocked (no landed `--fix`).
   - **The arrow/placement/const-@ family** (`W-LIFECYCLE-LEGACY-ARROW`, `W-MATCH-ARROW-LEGACY`, `W-GIVEN-ARROW-LEGACY`, `W-COLON-SHORTHAND-LEGACY-PLACEMENT`, `W-CONST-AT-DEPRECATED`, `W-PURE-DEPRECATED`): SOFT; eligible to schedule iff their spec'd `--fix` is verified-landed AND corpus-clean — at a first MAJOR, *if ever* (per Fork 1, not pre-scheduled).
   - **`W-ABSENCE-IN-SCRML-SOURCE`:** OUT of the lifecycle taxonomy — a permanent regression-guard (the null-does-not-exist axiom), not a from→to deprecation.
   - **`W-EACH-PROMOTABLE` / `I-MATCH-PROMOTABLE`:** OUT — a distinct **permanent-coexistence promotion-nudge** class (Tier-0 valid forever; the nudge is forever-informational). Per Fork 6(a), **strike the contradictory "sunset path info→warning→error→parser-strip" sentence from §17.4** (it contradicts the same section's "additive, not deprecating / no hard v1.0 deadline").

### D4 residual forks — resolved
- **Fork 1** (removing-major vs permanent-soft): **(b) permanent-soft** — §0 above, the load-bearing axis.
- **Fork 2** (`migrate --fix` verb overload): rename the codemod surface to **`scrml fix`** (clean, prior-art-aligned: `cargo fix`, `go fix`); `scrml migrate` stays the DB-schema SQL-application verb (§39.8). Frees the collision. *(A codemod-surface rename is itself a deprecation — `migrate --fix` → `scrml fix` rides the SOFT machine.)*
- **Fork 3** (severity escalation within window): **(a) severity tracks stage** — info at SOFT, may escalate to warn at SCHEDULED (louder as removal nears). Gives a principled reason for the corpus's currently-ad-hoc info/warn mix. (Moot in practice under Fork 1 until anything schedules, but the principle is set.)
- **Fork 4** (reserved-E allocation timing): **co-land at Stage 1** — forward-stable §34 catalog + known conformance delta; accept the catalog carries reserved-but-maybe-never-fired Es (the D3 wants the name early).
- **Fork 5** (`lang:` granularity): **sub-section form-level tagging** (most deprecations are a clause inside a `lang: 1.0` section; §18.2 is `lang: 1.0` for `:>` while the `=>`/`->` alias sub-clause is `lang: deprecated`). D4 requires D2 to support sub-form tagging.
- **Fork 6** (promotion-nudge class): **(a) permanent-coexistence** — OUT of D4; strike the §17.4 "sunset path" sentence (§7 disposition above).
- **Fork 7** (corpus-clean scope): the **canonical corpus** (`examples/` + the conformance suite) is the removal gate; dog-food apps (flux, trucking) are adopters who run `scrml fix` themselves.

---

## What lands where — the SPEC surface (execution map)

All SPEC-text is **Nominal / spec-ahead** at this landing per the established pattern (capability-vocab §23.5, protect-floor §14.8.9 both landed spec-ahead-then-built); the codegen/config wiring is the follow-on wave. Per Rule 4, §34 codes NAMED-here land WITH the impl wave.

**D1 (version scheme):**
- A new normative **Language Versioning** section (a §-number to be chosen at authoring — likely a new top-level after §59, or a §-under an existing versioning locus): the two-axis contract⟂impl model, the corpus-anchored MAJOR/MINOR/PATCH tiers, the freeze discipline + 1.0-rc state, the `lang:` vocabulary + conformance semantics.
- **§47.5 amendment** — the `chunks.json` `language` field beside `compiler` (spec text; the codegen emit in `route-splitter.ts` `serializeChunksManifest` is the follow-on).
- **`scrml.toml [language] version`** — a table-registration amendment as a sibling of §58.4 `[story]` / §22.13 `[capabilities]` (the pre-parse read is the follow-on).
- Corpus schema (Fork A/F): `expected.json` gains `suite-version: "1.0.0"` + `tier:`; migrate the 69 cases' `"1.0"` → `"1.0.0"` (a conformance-infra follow-on, not SPEC-text).

**D4 (deprecation lifecycle):**
- A new normative **Deprecation Lifecycle** section: the 4-stage machine, the well-formedness invariant, the timing rule, the `--fix` gate, the conformance-versioning contract, the `lang:` transitions.
- **Disposition prose edits** (cheap, pure-text, do-now-eligible): strike "in P3" from §51.3.2 (`W-DEPRECATED-001`), "in P3" from §15.15.5 (`W-WHITESPACE-001`), "v0.3.0" from §19.9.5 (`W-CPS-NEEDS-FAILABLE`); strike the "sunset path" sentence from §17.4 (Fork 6).
- The `scrml fix` rename (Fork 2) is its own SOFT deprecation of `migrate --fix` — SPEC §39.8 note + a reserved code.

**Codegen/config follow-on (post-SPEC, separate dispatch/authorization):** the `language` field emit; the `[language]` pre-parse read + newer/older-compiler gates; the corpus `expected.json` schema split.

---

## Tags
#session-234 #ruling #D1-language-version #D4-deprecation-lifecycle #language-compiler-split #permanent-soft-freeze #no-editions #conformance-anchored-semver #chunks-json-language-field #scrml-toml-language-pin #well-formedness-invariant #fix-gate #v1-contract-half
