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

## HU-2 (continued) — Q4 closure: E-EVAL-001 retires

### Question + user direction

Q4 (from HU-2 batch surface): E-EVAL-001 residual disposition under F-003 (a). PA's initial recommendation in the HU-2 batch was (a) keep-as-compiler-internal — based on speculation that E-EVAL-001 "covers" compiler-internal `bun.eval()` failures per §30.1.

**User (verbatim):**
> *"lets look at 4"*
> *"do the grep"*

### Grep-verified facts (Phase-0-equivalent verification)

PA grep'd `compiler/src/` for E-EVAL-001 fire sites:

- **Exactly ONE fire site:** `compiler/src/codegen/rewrite.ts:510-512`
- **Fire condition:** wraps user-written `${ bun.eval(...) }` throws per §30.2 recognition
- **Compiler-internal `bun.eval()` use (§30.1 — constant evaluation, type helpers, SQLite at compile time):** propagates as JS-exception through stage-boundary handlers; NOT via E-EVAL-001. E-EVAL-001 was never a compiler-internal code.

**Post-F-003 (a) — which retires §30.2 entirely — E-EVAL-001 has zero remaining fire paths.** The rewrite.ts:510-512 block becomes dead code.

**PA's initial (a) recommendation was wrong** — based on speculation, not grep. Banked methodology rule: [[feedback_grep_fire_sites_before_claiming_coverage]] (NEW from this exchange).

### Q4 RATIFICATION — disposition (b): retire E-EVAL-001 entirely

**Decision:**
- §34 line 15218: drop the E-EVAL-001 catalog row
- `compiler/src/codegen/rewrite.ts:510-512`: drop the `recordError(... "E-EVAL-001" ...)` block (dead code post-F-003 (a))
- Any test files asserting on E-EVAL-001 fire: drop or migrate
- No replacement error code; compiler-internal `bun.eval()` failures continue propagating via existing JS-exception → stage-boundary handler machinery (no dedicated code needed)

### §34 sibling-cascade audit (concurrent verification per Q4 grep)

User asked for cascade check before closing Q4: are there OTHER §34 codes that die when F-003 (a) lands?

**Answer: only E-EVAL-001 dies.** PA grep'd §34 for §30-referencing rows + bun.eval-mentioning rows + §22.4 + dead-fire-site candidates:

- **E-META-EVAL-001 (§22.4)** — NOT dead. Fires at `compiler/src/meta-eval.ts:447` when `^{}` body evaluation throws. Approach C keeps `^{}` body parsing scrml-native + 3 compile-time primitives (reflect / emit / emit.raw); those CAN throw, this code stays alive.
- **E-META-EVAL-002 (§22.4)** — NOT dead. Same locus; fires when `emit`/`emit.raw` produces code that re-parses unsuccessfully. Stays alive.
- **E-EVAL-001 (§30.2)** — DEAD per above.

No hidden siblings. The §34 cascade is exactly one row.

### F-003 (a) source-cascade scope (NEW surfaced during Q4 grep — for Phase 2 amendment work)

Beyond the §34 catalog row, F-003 (a) requires compiler-source cleanup at 8 sites. Mechanical sed-style; surfacing scope here so Phase 2 amendment work captures it cleanly:

| File:Line | Change |
|---|---|
| `compiler/src/codegen/rewrite.ts:488-512` | Retire the entire `Evaluate bun.eval("...") calls at compile time` function (DEAD post-F-003 (a)) |
| `compiler/src/meta-checker.ts:15` | Doc-comment: drop `bun.eval` from `(reflect, bun.eval, emit) execute at compile time` |
| `compiler/src/meta-checker.ts:179` | Remove the `\bbun\s*\.\s*eval\s*\(` regex from the compile-time-API recognizer |
| `compiler/src/meta-checker.ts:1622` | Error message: drop `bun.eval` from `compile-time APIs (reflect, emit, bun.eval)` list |
| `compiler/src/meta-checker.ts:1656` | Same family error message |
| `compiler/src/codegen/constant-folder.ts:13` | Doc-comment phrasing update |
| `compiler/src/codegen/collect.ts:446` | Drop bun.eval from compile-time-only escapes list |
| `compiler/src/tokenizer.ts:719` | Update comment reference |
| `compiler/src/codegen/emit-html.ts:1693` | Remove `!inlined.includes("bun.eval")` filter (the filter has nothing to filter once bun.eval recognition retires) |
| `compiler/src/codegen/emit-html.ts:1707, 1712` | Comment block update |

### Findings closed by Q4

- **Q4 / F-003-cascade E-EVAL-001** — RATIFIED (b) retire. §34 row drops; rewrite.ts:510-512 fire site retires; no replacement code.

### Banked methodology from Q4

- **[[feedback_grep_fire_sites_before_claiming_coverage]]** — when PA's option-list claims "X covers Y" or "X fires on Z," PA MUST grep actual fire sites first. Don't speculate about coverage from spec text or memory. 5-minute grep cost; days-of-rework cost when an option-list ratifies a wrong reading. Sibling to [[feedback_bidirectional_hole_detection]] from same session — both are "verify before reasoning about behavior" rules.

---

### Open from HU-2 lifecycle thread (carry to HU-3)

- **state-dynamics-design DD extension question** (DD at `scrml-support/docs/deep-dives/state-dynamics-design-2026-04-08.md` — `status: active` since 2026-04-08). The DD asks "should `(A to B)` lifecycle annotations extend beyond struct fields to enum-state-cells, or do engines/Tier-2 subsume that use case?" Lifecycle annotation is foundational; the extension question is "did we accidentally narrow scrml's type-system in ratification?" PA recommends: read the DD in full + the debate sibling DD before HU-3 ratifies.

## HU-2 (continued) — Q5 closure: V-kill cluster ratified

### Question + user direction

Q5 (V-kill cluster final ratification — 4 LOAD-BEARING findings on one cluster close). PA presented three sub-decisions for the cluster: Q5.0 cluster direction, Q5.A §7.5 production location, Q5.B §52.4.1 server-authority form.

**User direction (verbatim):**
> *"yes, b, explain this. I keep thinking that we have gotten rid of that ugly word"*
> *"b. I am really trying to build a language that is cohesive and instinctive once it falls under your fingers."*

### Q5.0 RATIFIED — V-kill cluster direction (yes)

V-kill canon wins. Amend §7.5 + §52.4.1 + ~30 worked examples per S123 V-kill ratification. Mechanical per Rule 4 (pre-V-kill text never refreshed; V-kill is post-ratification canon).

### Q5.A RATIFIED — (b) move §7.5 production to §6.1

The `state-decl` production moves out of §7.5 ("Type Annotation Grammar") into §6.1 alongside the V-kill normative statements. §7.5 retains only type-expr / param-decl / return-type productions (the ones that actually belong in "Type Annotation Grammar"). §6.1's V-kill cluster gains the production as its formal grammar carrier.

### Q5.B RATIFIED — (b) `<cards server>: T = []` bare-attribute form

`server` becomes a **bare flag attribute inside the decl tag**, parallel to `<userId pinned>` (per F-013 closure direction) and consistent with V5-strict Shape 2 validator-on-decl pattern (`<userName req length(>=2)> = <input/>`). The prefix-modifier shape (`server <cards>`) was rejected because it broke the V5-strict "modifiers go inside the tag" pattern — non-cohesive seam.

**User-voice anchor (verbatim):** *"I am really trying to build a language that is cohesive and instinctive once it falls under your fingers."* Banked as methodology rule [[feedback_cohesion_and_falls_under_fingers]] — design-evaluation lens for all future HU decisions: weight cohesion (fits existing patterns) + falls-under-fingers (muscle-memory-friendly) heavily; lowest-touch option is NOT automatically the right answer.

PA's initial Q5.B lean was (a) prefix — based on lowest-touch-from-existing-SPEC-text reasoning. Wrong by the cohesion criterion. Revised lean to (b) bare-attribute when user surfaced the cohesion concern; user ratified (b) with the design-intent quote.

### Sibling clarification banked (the "ugly word" reaction)

User's reaction *"I keep thinking that we have gotten rid of that ugly word"* surfaced a real partial-memory state. Clarified for the record:

- **`server function` modifier (function-modifier form)** — RETIRED per Insight 26 (2026-05-08, S72 body-split / auto-`!`-wrap CPS ratification). Plain `function foo() {...}` with compiler-managed body-split handles client/server split transparently; explicit `server function` declaration became redundant. This is the `server` the user remembers retiring.
- **`server` modifier on state cells (cell-authority form)** — CANONICAL per SPEC §52.4. Declares cell authority (compiler synthesizes fetch-on-mount, optimistic update on writes, rollback on server-error). Not on the deprecation track. Survives this Q5.B as a bare attribute inside the V-kill structural tag.

Same word, two distinct semantics, only the function-modifier got retired. Worth recording so future user-confusion doesn't recur.

### Concrete amendments — direction + target explicit (post-Q5 ratification)

**Amendment A1 — §7.5 line 5564 grammar production:**
RETIRES from §7.5 (per Q5.A b). Production relocates to §6.1.

**Amendment A2 — §6.1 V-kill section gains the grammar production (new location per Q5.A b):**

```ebnf
state-decl   ::= '<' identifier ws (decl-attr ws)* '>' [ws ':' ws type-expr] ws '=' ws expr
decl-attr    ::= 'pinned' | 'server' | validator-attr     // bare flag attrs inside the tag
                                                          // (per Q5.B b — `server` joins the modifier family)
validator-attr ::= /* per §55.1 universal-core predicate vocabulary */
```

(Refinement: the exact grammar-production wording is heads-up Phase 2 amendment work; the SHAPE is locked here. Specifically: `server` joins `pinned` and validator-attrs as a bare flag attribute legal inside the V-kill structural tag.)

**Amendment A3 — §7.5 worked examples lines 5594-5597:**

```scrml
// BEFORE
@count: number = 0
@items: string[] = []
@selected: string? = not

// AFTER
<count>: number = 0
<items>: string[] = []
<selected>: string? = not
```

**Amendment A4 — §52.4.1 line 26367 grammar production:**
RETIRES. The production folds into §6.1 (per A2). §52.4.1 retains the semantic description of the `server` attribute (fetch-on-mount, optimistic update, rollback, SSR pre-render); no longer needs its own grammar production.

**Amendment A5 — §52 worked examples:**

```scrml
// BEFORE
server @cards = []
server @currentUser = not

// AFTER
<cards server> = []
<currentUser server> = not
```

(Type annotation form composes: `<cards server>: Card[] = []`.)

**Amendment A6 — SPEC-wide ~30 worked example mechanical sweep** (per F-008 audit enumeration):
Sweep rule:
- `^@x = v` at line-start with NO preceding `<x>` decl in same example → convert to `<x> = v`
- `^@x = v` at line-start WITH preceding `<x>` decl → keep (it's a write)
- `^@x = v` inside function body → keep (it's a write)
- `^server @x = v` at line-start → convert to `<x server> = v` (per Q5.B b)

Audit site enumeration in `docs/audits/spec-consolidation-inventory-2026-05-24.md` F-008.

### Findings closed by Q5

- **F-001 (1a, LB)** — RATIFIED. §7.5 grammar production amended + relocated to §6.1.
- **F-009 (1b, LB)** — RATIFIED. Same surface as F-001; corroboration close.
- **F-008 (1a, LB)** — RATIFIED. ~30-site mechanical sweep authorized.
- **F-016 (1a, LB)** — RATIFIED. §52.4.1 grammar retires; semantic prose preserved; worked examples migrate to bare-attribute form.

### Carry-forward sub-questions for HU-3 (composition with other modifiers — surfaced by Q5.B b ratification)

Now that `server` is a bare flag attribute alongside `pinned` + validators, composition questions surface:

- **Q5.B.1 — server + pinned composition.** `<cards server pinned> = []` — does the pinned semantics apply to the placeholder OR the fetched value? Edge case worth heads-up resolution before adopter samples exercise it.
- **Q5.B.2 — server + validators composition.** `<cards server req length(>=1)> = []` — at which point does the validator run? Options:
  - (a) On client-side optimistic update only (server is trusted)
  - (b) On server-fetch + on client-side write (defense-in-depth)
  - (c) On client-side write + AFTER server fetch confirms (both points)
  Audit / DD likely needed before HU-3 ratifies.
- **Q5.B.3 — Tier 1 `< Type authority="server" table="...">` vs Tier 2 `<x server>` relationship.** Per §52 the two tiers have distinct semantics (type-level vs instance-level). Q5.B (b) ratification doesn't change Tier 1; Tier 1 remains `<TypeName authority="server" ...>`. But the keyword overlap (`server` in two distinct positions) carries a documentation burden — heads-up may want to clarify the Tier-1 vs Tier-2 distinction in PRIMER + kickstarter post-F-023/044 catch-up.

### Banked methodology from Q5

- **[[feedback_cohesion_and_falls_under_fingers]]** — design-evaluation lens. Weight cohesion (fits existing patterns) + falls-under-fingers (muscle-memory-friendly) heavily; lowest-touch option is NOT automatically the right answer. PA must surface non-cohesive options as such and offer the cohesive alternative explicitly, even if PA initially leaned the lowest-touch direction.

---

## HU-3 — 2026-05-25 — Q5.B sub-questions ratified (server-modifier composition)

S131 lockdown wave 1. Per the user direction *"lets lockdown open qs"*, surfaced the 3 Q5.B sub-questions carried over from HU-2 Q5 close. All 3 ratified in one round.

### Q5.B.1 RATIFICATION — (a) `pinned` applies to PLACEHOLDER

**User direction:** `a` (PA-recommended).

**Decision:** In `<cards server pinned>: T = []`, the `pinned` semantic applies to the **PLACEHOLDER**. The empty-array placeholder `[]` is pinned (cannot be reset to placeholder via `reset(@cards)`); the fetched server value is normal-reactive thereafter.

**Cohesion rationale:** preserves the §6.10 `pinned` semantic verbatim ("hoisting-exempt, init-once at file-scope"). `server` is the dynamic surface; `pinned` is the static surface; the two compose without semantic overload. The runtime-write-freezing reading (option b) would have required redefining `pinned` to include semantics it doesn't carry today.

**Operational interpretation:** "skip the placeholder reset — only the real data matters." Common case for caches / hydration-on-mount patterns where the empty placeholder is a startup artifact, not adopter-meaningful state.

**Phase 2 amendment scope (Landing TBD):** §6.10 + §52.4 (or wherever server-cell composition is documented) clarify the composition rule. Worked example showing pinned-on-server-cell behavior at mount + post-fetch + post-`reset()`.

### Q5.B.2 RATIFICATION — (b) validator runs at placeholder mount + at fetch arrival

**User direction:** `b` (PA-recommended).

**Decision:** In `<cards server req length(>=1)>: T = []`, the validator chain runs at BOTH placeholder mount AND at fetch arrival.

**Behavior:**
- **At mount:** placeholder `[]` runs validators → `req` passes (empty array is some), `length(>=1)` fails → `@cards.isValid = false`, `@cards.errors = [...]`
- **At fetch arrival:** server data runs validators → if passes, `@cards.isValid = true`
- **Subsequent writes:** re-validate per existing §55 rules

**Cohesion rationale:** preserves SPEC §55 invariant — validators surface state from the cell value regardless of provenance. The "placeholder is invalid until fetch" surface IS useful UI signal (`@cards.isValid` drives spinner / "loading" state without an extra `<loading>` cell). Option (a) "fetch-only" would hide the load-bearing "data not yet present" signal; option (c) "every read" over-runs (validators in render loops).

**Operational interpretation:** the validator chain is a STATE OBSERVATION, not a GATE on fetch. Adopters who want the placeholder treated as "valid by construction" use `<cards server pinned req length(>=1)>: T = []` per Q5.B.1 (pinned-on-placeholder) — but the validator still runs; pinned just prevents the placeholder from being re-installed via reset.

**Phase 2 amendment scope (Landing TBD):** §55 server-cell composition addendum. Worked example showing isValid/errors transitions across mount + fetch + write cycles.

### Q5.B.3 RATIFICATION — (b) Tier 1 vs Tier 2 distinct teaching surfaces

**User direction:** `b` (PA-recommended).

**Decision:** PRIMER + kickstarter teach the two tiers as distinct canonical surfaces with a clean "which one do I reach for?" rule:

- **Tier 2 (`<x server>`)** = canonical for **per-cell server authority**. One cell, one server contract. Common case.
- **Tier 1 (`<TypeName authority="server" table="...">`)** = canonical for **type-shared cross-file server contracts**. One type, all cells of this type share the contract. Cross-file declared.

**Distinguishing rule:** "do I want this server-authority on one cell, or across all cells of this type?" One-cell → Tier 2 bare-attribute. Cross-cell-shared → Tier 1 type-level declaration.

**Cohesion rationale:** gives adopters an unambiguous reach-for rule rather than an unscaffolded choice between two surfaces. Option (a) "Tier 1 as advanced" would have buried Tier 1 unnecessarily (it's not advanced, it's just SCOPE-DIFFERENT); option (c) "both equally first-class" leaves the choice unscaffolded.

**Phase 2 amendment scope (Landing TBD, folds into PRIMER + kickstarter flagship sections per F-023/F-044/F-052):** PRIMER §X (TBD section number) lays out Tier 1 vs Tier 2 with the reach-for rule + one example per tier; kickstarter §11.2 auth recipe (or a new section) carries the same rule + cross-ref. Coupled with F-052 (§52 state-authority partial coverage) — fold together.

### HU-3 SESSION CLOSE — Q5.B cluster fully closed

All 3 sub-questions ratified. Q5.B cluster (HU-2 + HU-3) now CLOSED end-to-end.

| Q | Topic | Ratified |
|---|---|---|
| Q5.B (HU-2) | Server-modifier form | (b) `<cards server>: T = []` bare-attribute |
| Q5.B.1 (HU-3) | server + pinned composition | (a) `pinned` applies to placeholder |
| Q5.B.2 (HU-3) | server + validators firing point | (b) validator runs at placeholder mount + at fetch arrival |
| Q5.B.3 (HU-3) | Tier 1 vs Tier 2 documentation framing | (b) distinct canonical surfaces with reach-for rule |

### Banked methodology from HU-3

No new methodology rule. Re-validation:
- [[feedback_cohesion_and_falls_under_fingers]] — all 3 ratifications used the cohesion lens directly; PA leans matched the user-ratified directions
- [[feedback_no_greek_chars_in_options]] — ASCII a/b/c throughout
- [[feedback_show_code_to_reason_about]] — worked-code shapes surfaced at each Q

### Carry-forward (post-HU-3)

The Phase 2 amendment work for HU-3 ratifications folds into:
- §6.10 `pinned` composition with server modifier (Q5.B.1)
- §55 server-cell validator firing rule (Q5.B.2)
- §52 + F-052 Tier 1 vs Tier 2 teaching surface (Q5.B.3)
- PRIMER + kickstarter post-F-023/F-044/F-052 flagship-section authoring will follow Q5.B.3 framing

---

## HU-4 — 2026-05-25 — Wave 3 standalone surfaces ratified (4 in one batch)

S131 lockdown wave 3. 4 tractable standalone Qs ratified in one round.

### Q-W3-1 RATIFICATION — (a) keep `if=` only; no `<if>` markup element

**User direction:** `a` (PA-recommended).

**Decision:** No `<if>` markup element. The kickstarter v2 "no `<for>` or `<if>` markup tags" claim — already broken on the `<for>` half by iteration HU-1 — survives intact on the `<if>` half. `if=` attribute remains the only conditional surface.

**Asymmetry rationale (the key signal):** Gauntlet R10 documented 9-10/13 dev agents writing tripled markup because they didn't reach for `for/of` — empirical friction that drove `<each>` ratification. **No equivalent friction signal exists for `if=`** — it reads naturally as an HTML attribute extension, adopter discoverability is fine. Per pa.md Rule 3 (right answer = don't double surface without friction signal), keeping `if=` only is the right answer; symmetry-with-`<each>` was the easy answer (and the wrong one).

**Carry-forward implication for kickstarter Q8 (iteration HU-1):** the kickstarter rewrite amends ONLY the iteration half of the "no markup tags" rule. The conditional half stays — kickstarter prose updates to "no `<for>` markup tag (use `<each>`); no `<if>` markup tag (use `if=` attribute)."

### Q-W3-2 RATIFICATION — (b) `$(param){...}` fn shorthand needs DD first

**User direction:** `b` (PA-recommended).

**Decision:** The S129 user spit-ball `$(param){...}` shorthand has real motivation (the "logic contexts getting thinner" trajectory) but its design surface has too many open axes for one-round HU ratification:

- Which contexts admit `$(param){...}` — event-handler position only, OR every `${}` position?
- How does the param resolve — implicit-from-context (event → `event`; lift-body → iteration value), OR explicit named?
- Zero-arg form `$(){...}` — does it degenerate to `${...}`-immediate-invocation, or distinct semantic?
- Composition with `lift` / async stubs / `:`-shorthand body — how do these compose?

**Disposition:** **DD required before HU.** PA dispatches a deep-dive surveying:
- The prior-art space (Vue `(e) => {}`, React event-handler arrow forms, Svelte `on:click={handler}`, Marko `on-click(handler)`)
- The contexts-admit matrix (event-handler / lift-body / `${}` / `:`-shorthand body)
- The implicit-vs-explicit param resolution trade
- Composition with existing logic-context forms
- The relationship to L19 multi-statement-handler relaxation (likely coupled — both target logic-context-thinness)

DD output feeds future HU. Queue with `~snapshot` + state-dynamics-design DD as part of the lockdown research-needed group.

### Q-W3-3 RATIFICATION — (a) keep generators as full language vocabulary

**User direction:** `a` (PA-recommended).

**Decision:** `function*` / `yield` / `yield*` are FULL language vocabulary in scrml. Use cases beyond §37 SSE (`server function*`) are admissible. The S114 "no async/await" rule does NOT extend to generators.

**Cohesion rationale — why generators escape the colored-functions ban:**
- async/await is VIRAL: a function that awaits MUST be async; callers MUST await; the coloring propagates up the call stack indefinitely
- generators are LOCAL: a function that yields is a generator (marked `*`), but callers consume via plain iteration (`for...of`, `Array.from`, manual `.next()`) — no propagation
- The leaky-abstraction concern that killed async/await doesn't apply equally; generator-ness terminates at the function boundary

§37 SSE (`server function*`) is the existing load-bearing surface; restricting generators to SSE-only would have forced SSE to a different mechanism with no cohesion gain.

**Phase 2 amendment scope (Landing TBD):** SPEC documentation of generator policy (likely a §48.x or §13.x normative subsection). No compiler-source change — generators are already in the JS subset bound at M4.3.

### Q-W3-4 RATIFICATION — (c) §29 Vanilla File Interop defer indefinitely

**User direction:** `c` (PA-recommended).

**Decision:** SPEC §29 stays as Nominal/INTENTIONAL-SILENCE pending adopter friction signal. NOT implemented as first-class build-pipeline feature; NOT retired from SPEC.

**Rationale:**
- No documented adopter friction signal — adopters today route vanilla-JS via `_{}` foreign code blocks or `use foreign:` sidecars
- Implementing first-class is hours of work for unclear demand
- Retiring the SPEC section would signal "scrml doesn't want vanilla interop" — wrong framing
- "Nominal/spec-ahead-of-implementation" is the right disposition until empirical signal surfaces

**Re-trigger condition:** ≥2 adopter friction reports requesting first-class vanilla interop re-opens the disposition.

### HU-4 SESSION CLOSE — Wave 3 batch closed

| Q | Topic | Ratified |
|---|---|---|
| Q-W3-1 | `<if>` markup element | (a) keep `if=` only; no `<if>`; kickstarter conditional half stays |
| Q-W3-2 | `$(param){...}` fn shorthand | (b) needs DD before HU |
| Q-W3-3 | Generator policy | (a) full language vocabulary; cohesion via "generators are local, not viral" |
| Q-W3-4 | §29 Vanilla File Interop | (c) defer indefinitely until adopter friction signal |

### Carry-forward (post-HU-4)

- **`$(param){...}` DD authoring** — queues with `~snapshot` + state-dynamics-design DD as Wave 3.5 research-needed group. L19 multi-statement-handler relaxation likely couples into this DD.
- **kickstarter Q8 conditional-half prose** — folds the "no `<if>` markup tag (use `if=` attribute)" rule into the Q8 iteration rewrite at Iteration Landing 4
- **§29 + §48.x/§13.x generator-policy SPEC documentation** — small Phase 2 SPEC amendment dispatch (folds with Wave 5 cluster batches)

---

## HU-5 — 2026-05-25 — Wave 3.5 research-resolved standalones ratified (3 in one batch)

S131 lockdown wave 3.5. After PA research surfaced concrete findings on `~snapshot` + state-dynamics-design DD + L19 coupling, 3 Qs ratified.

### Q-W35-1 RATIFICATION — (a) `~snapshot` codegen bug fix only; not a new language form

**User direction:** `a` (PA-recommended).

**Decision:** `~snapshot` is NOT a new canonical sigil/state-decl-prefix form. The bug surfaced S125 Wave 14 DD (`~snapshot = {...}` tilde-decl with reactive deps emits raw `~` sigil leaked into `let _scrml_tilde_3 = ~;`) is a CODEGEN BUG, not a design vacancy. Fix is small-scope.

**Rationale:**
- SPEC §32 defines `~` as pipeline accumulator + lin variable + context boundary; canonical surface is `~name = pipeline` tilde-decl (B3 landed)
- `~snapshot <x>` raw-sigil-as-state-decl-prefix has NEVER been in SPEC (per `m65-path-b-adapter-scoping/progress.md:114` confirmation)
- No documented adopter demand for a new sigil form
- The "design-pending" framing in known-gaps Bug 15 was misframing — the design has been clear since SPEC §32, only the bug is unresolved

**Phase 2 amendment scope (Landing — small dispatch):** fix the codegen leak in tilde-decl reactive-deps case. Test surface: regression-guard reproducer. No SPEC amendment needed. Known-gaps Bug 15 framing updated from "design-pending" to "codegen bug — fix scheduled."

### Q-W35-2 RATIFICATION — (a) state-dynamics-design DD mark `status: superseded` with closure addendum

**User direction:** `a` (PA-recommended).

**Decision:** The state-dynamics-design DD (`scrml-support/docs/deep-dives/state-dynamics-design-2026-04-08.md`, 544L, `status: active`) is in fact CLOSED end-to-end — all 6 open Qs have been answered by subsequent ratifications between S57 and S130. Mark `status: superseded` with `superseded-by:` references + one-line closure addendum per Q.

**The 6 closures:**
| DD Open Q | Answered by |
|---|---|
| Transition enforcement opt-in or opt-out | Tier ladder (Tier 0 lints, Tier 2 engines) |
| Guarded transitions × server functions | §51.0.F rule= + §52 |
| Runtime denial behavior | §51.0.G `.advance()` loud |
| Transition × `(A -> B)` lifecycle annotation | S130 Lifecycle HU-1 Q1=c (distinct mechanisms) |
| Transition effects writing reactive vars | §51.0.F effect= + `<onTransition>` |
| Compilation target | §51.x engines codegen |

**Rationale — corpus-ouroboros closure:** the DD survived `status: active` because the same-landing discipline (pa.md S115 doc-currency convention) was missed at each closing ratification. This is a textbook instance of the [[feedback_stated_intent_vs_corpus_migration]] pattern. Closure brings the DD into compliance with the current-truth-only scope principle.

**Phase 2 amendment scope (Landing — bookkeeping dispatch):** PA writes a closure addendum (6 one-liners pointing at the closing surfaces) + updates the DD frontmatter to `status: superseded` + `superseded-by: [§51.0, §52, S130 Lifecycle HU-1]` + `last-reviewed: 2026-05-25`. Small.

### Q-W35-3 RATIFICATION — (a) L19 multi-statement-handler relaxation folds into `$(param){...}` DD

**User direction:** `a` (PA-recommended).

**Decision:** L19 relaxation question does NOT get a standalone HU ratification at this lockdown. Folds into the future `$(param){...}` DD per the coupling identified — both target logic-context-thinness for event handlers; both share the design surface of "how multi-statement bodies compose with attribute-position handler invocation."

**Coupling justified:** the DD has to consider how the new shorthand composes with existing bare-form rules anyway (Q-W3-2 ratification text); ratifying L19 in isolation would force revisit when the DD lands. Per [[feedback_cohesion_and_falls_under_fingers]] the cohesive design surface is "logic-context-thinness for event handlers" — L19 + `$(param){...}` are two sides of the same coin.

**Phase 2 amendment scope:** L19 status quo preserved (E-MULTI-STATEMENT-HANDLER continues to fire). When `$(param){...}` DD lands → HU surfaces both questions together → ratification covers both at once.

### HU-5 SESSION CLOSE — Wave 3.5 closed

| Q | Topic | Ratified |
|---|---|---|
| Q-W35-1 | `~snapshot` disposition | (a) codegen bug fix only; not a new language form |
| Q-W35-2 | state-dynamics-design DD other open Qs | (a) mark `status: superseded` + closure addendum (DD effectively closed by subsequent work) |
| Q-W35-3 | L19 multi-statement-handler relaxation | (a) fold into `$(param){...}` DD per coupling |

### Carry-forward (post-HU-5)

- `~snapshot` codegen bug fix (small dispatch; regression-guard test)
- state-dynamics-design DD closure addendum (bookkeeping dispatch)
- `$(param){...}` + L19 DD authoring (bundled — Wave 3.5 research-needed group reduces to: 1 DD covering both)

---

## HU-6 — 2026-05-25 — Wave 5 Phase 1c cluster batches ratified (8 clusters in one batch)

S131 lockdown wave 5 — Phase 1c cluster lockdown. All 8 clusters (H/I/J/K/L/M/N/O) ratified to audit-recommended direction in one batch.

**User direction:** `a a a a a a a a` — all 8 = (a) audit-recommended direction.

### Decisions per cluster

| Cluster | Ratified direction | Authoring scope (downstream Landing) |
|---|---|---|
| **H** — flagship reveal: `^{}` + type-as-arg family + refinement zones | (a) Single integrated flagship section in both PRIMER + kickstarter | Substantial new section; closes F-035 + F-044 + F-053 |
| **I** — self-host idiom cluster: `lift` + `~` + while/break/continue + assign-as-expr | (a) Single integrated section in both canons titled "self-host idiom cluster" or similar | Substantial new integrated section; closes F-028 + F-038 + F-050 + F-051 |
| **J** — error-handling depth | (a) Canon catches up to SPEC §19 advanced surfaces; PRIMER §6 + kickstarter §6 extend | Medium; closes F-032 (errorBoundary + per-handler-tx + CPS multi-batch) |
| **K** — advanced engines extension | (a) Kickstarter §4 extension (PRIMER §7.1 already covers); cross-ref + worked `<onTimeout>` + history example | Small; mechanical catch-up |
| **L** — worker/sidecar/SSE | (a) Unified compute-isolation recipe section in both canons | Substantial; closes F-042 + F-046 + F-048 (~500 SPEC lines combined silence — largest concentrated gap in audit) |
| **M** — module/type-system extensions | (a) Mechanical batch catch-up | Medium; closes F-034 (Form 1/2 + pure-type files) + F-049 (`fn` distinction kickstarter) + F-039 (`pure` flagship) + F-054 (nested substates) |
| **N** — minor surface gaps | (a) Footnote-level batch catch-up | Small; closes F-027/F-031/F-033/F-037/F-045/F-052/F-055 (7 footnote-level additions across both canons) |
| **O** — borderline INTENTIONAL-SILENCE | (a) Defer both — `status: deferred` until empirical adopter signal | F-036 (foreign code `_{}`) + F-041 (input states `<keyboard>`/`<mouse>`/`<gamepad>`); no canon authoring needed |

### Authoring-scope implication

7 Phase 1c canon-authoring Landings unlocked (H/I/J/K/L/M/N — Cluster O defers); plus the Phase 2 SPEC amendments from HU-3 (server-cell composition) + HU-4 (generator policy) + Wave 3.5 small dispatches (~snapshot codegen fix + DD closure addendum + Iteration Landing 2 SPEC + Lifecycle Landing 2.5 fn-return).

### HU-6 SESSION CLOSE — Wave 5 closed

All 8 Phase 1c cluster batches ratified. Cluster O defers; H-N enter Phase 2 authoring queue.

### Banked methodology from HU-6

No new methodology rule. Re-validation:
- [[feedback_designer_card_and_retirement_framing]] — designer-card axis surfaced on every cluster; user invoked none (audit calibration validated)
- [[feedback_no_greek_chars_in_options]] — ASCII a/b/c throughout
- [[feedback_cookbook_vs_empirical]] — audit's per-cluster recommendations were sound (user ratified all 8 unmodified)

---

## S131 LOCKDOWN COMPLETE — SESSION SUMMARY

**6 HU sessions ratified between user direction "lets lockdown open qs" and this close:**

| HU | Wave | Scope | Ratifications |
|---|---|---|---|
| HU-3 | 1 | Q5.B sub-questions (server-modifier composition) | 3 sub-Qs ratified — Q5.B.1=a / Q5.B.2=b / Q5.B.3=b |
| HU-2 (lifecycle doc) | 2 | Lifecycle fn-return transition-marker mechanism | hybrid (e) for presence-progression + (a) for variant-progression |
| HU-4 | 3 | 4 standalone surfaces | `<if>` markup element=a (keep `if=` only) / `$(param){...}` shorthand=b (DD first) / Generator policy=a (full vocabulary) / §29 vanilla-interop=c (defer) |
| HU-5 | 3.5 | 3 research-resolved standalones | `~snapshot`=a (codegen bug only) / state-dynamics-design DD=a (mark superseded) / L19=a (fold into `$(param){...}` DD) |
| HU-6 | 5 | Phase 1c cluster batches H-O | All 8 ratified to audit-recommended direction |

Wave 4 (L19 standalone HU) eliminated by Q-W35-3 fold.

### Post-lockdown unlock state

**SPEC is now an un-equivocal source of truth across all surfaces previously open** (per S129 user-voice grammar-consolidation plan):
- No carry-forward open language-shape decisions remain at the SPEC/ratification level
- Two DD-shaped items queued (`$(param){...}`/L19 + future audits as adopter signals surface)
- One bookkeeping closure pending (state-dynamics-design DD superseded mark)
- One bug-fix pending (`~snapshot` codegen leak)

**Phase 2 amendment + canon authoring queue unlocked** (all ready to dispatch, file-disjointness allows parallel):

| Tier | Items | Sizing |
|---|---|---|
| Small SPEC | Q5.B.1/2/3 server-cell composition (§6.10/§55/§52) · generator policy §48.x or §13.x · Lifecycle 2.5 fn-return §14.12.6 · `~snapshot` codegen bug · state-dynamics-design DD closure addendum · Iteration Landing 2 SPEC §17.X NEW | small each; ~1-2h per |
| Medium canon | Cluster K kickstarter §4 advanced engines · Cluster J errorBoundary+CPS · Cluster N 7 footnotes · Cluster M module/type-system extensions | ~3-8h per |
| Substantial canon | Cluster H flagship reveal (^{}+type-as-arg+refinement) · Cluster I self-host idiom cluster · Cluster L worker/sidecar/SSE unified · Lifecycle Landing 3 (PRIMER+kickstarter F-023) · Iteration Landings 3/4/5 (CLI/canon/corpus migration) | ~10-40h per |

**Phase 3 + Phase 4 still gated** but no longer blocked-on-ratification:
- Phase 3 (100% example coverage corroborates SPEC) — sequences after Phase 2 amendment authoring stabilizes
- Phase 4 (M6.7 D-class resume + v0.7 cut) — sequences after Phase 3 example coverage

## HU-2 (continued) — Q6 closure: PIPELINE.md `deriveEngineVarName` catches up to SPEC

### Question + user direction

Q6 (PIPELINE.md `deriveEngineVarName` "Machine" suffix-strip drift from SPEC §51.0.C). PA presented as mechanical confirmation; direction determined by Rule 4 (SPEC + PRIMER are the canon).

**User direction (verbatim):** *"Q6 go"*

### Authority triangulation (PA Phase-0 verification)

PA grep'd ALL four authorities before locking — per banked rule [[feedback_grep_fire_sites_before_claiming_coverage]]:

| Authority | Says | Status |
|---|---|---|
| SPEC §51.0.C table | `MarioMachine` → `marioMachine` (literal lowercase-first; **suffix kept**) | post-S123 canon |
| PRIMER B14 | corroborates SPEC | aligned |
| **Compiler code `symbol-table.ts:4234`** | `return typeName[0]!.toLowerCase() + typeName.slice(1);` | **literal lowercase-first, no strip** |
| PIPELINE.md line 822-830 + line 34 | strips `Machine` suffix | THE ONLY OUTLIER |

**3 of 4 authorities agree (SPEC + PRIMER + compiler code).** PIPELINE.md drift caught. This is a **doc-only fix; zero compiler-code risk** — the compiler already does the SPEC-canonical thing.

This triangulation also validates the [[feedback_grep_fire_sites_before_claiming_coverage]] rule a second time this session: without the grep, PA would have framed Q6 as "PIPELINE catches up to SPEC" but missed that the compiler-code authority was already on SPEC's side.

### Q6 RATIFICATION — PIPELINE.md catches up to SPEC + compiler

**Decision:** PIPELINE.md amends in two sites.

**Amendment Q6-1 — PIPELINE.md line 822-826 algorithm:**

```
// BEFORE
deriveEngineVarName(typeName: string, varAttr: string | null) -> string:
  if varAttr is non-null:
    return varAttr   # explicit override
  let stripped = typeName.endsWith("Machine") ? typeName.slice(0, -7) : typeName
  return stripped[0].toLowerCase() + stripped.slice(1)

// AFTER (catches up to SPEC §51.0.C + compiler `symbol-table.ts:4234`)
deriveEngineVarName(typeName: string, varAttr: string | null) -> string:
  if varAttr is non-null:
    return varAttr   # explicit override
  return typeName[0].toLowerCase() + typeName.slice(1)   # literal lowercase-first; legacy `Machine` suffix KEPT per §51.0.C
```

**Amendment Q6-2 — PIPELINE.md line 34 descriptive prose:**

```
// BEFORE
**Stage 3.05 NR:** auto-declared engine variable resolution; auto-derived variable name (lowercase first run, strip trailing "Machine"); ...

// AFTER
**Stage 3.05 NR:** auto-declared engine variable resolution; auto-derived variable name (lowercase first run; legacy `Machine` suffix kept per §51.0.C); ...
```

**Amendment Q6-3 — PIPELINE.md line 829-830 example update:**

```
// BEFORE
Examples: `<engine for=PhaseState>` declares `phaseState`; `<engine for=MarioMachine>`
          declares `mario` (suffix stripped); `<engine for=AppMachine var=app>` declares `app`.

// AFTER
Examples: `<engine for=PhaseState>` declares `phaseState`; `<engine for=MarioMachine>`
          declares `marioMachine` (legacy suffix KEPT per §51.0.C — new code prefers names
          that don't end in `Machine`); `<engine for=AppMachine var=app>` declares `app`.
```

### Findings closed by Q6

- **F-021 (1b, LB)** — RATIFIED. PIPELINE.md drift from SPEC + compiler. Doc-only fix; zero compiler-code change.

### Banked methodology from Q6

No NEW methodology rule from Q6. Q6 re-validates [[feedback_grep_fire_sites_before_claiming_coverage]] — the grep across compiler-source surfaced that the compiler ALREADY matches SPEC. Direction-confirmation becomes "PIPELINE-doc catches up to SPEC + compiler-code" rather than the weaker "PIPELINE catches up to SPEC" PA initially framed.

This is now a banked META-observation: PA's option-list framings should triangulate across SPEC + PRIMER + kickstarter + compiler code + native-parser source. When PA only triangulates 2-3 of those, an authority that already agrees with the canon can be missed — making the closure look like more migration than it actually is.

## HU-2 (continued) — Q7 closure: §39.12 schema placement after v0.3

### Question + user direction

Q7 (F-019, 1b, LB): SPEC-internal contradiction on `<schema>` placement. §39.2 prose + §39.3 normative said "alongside, not inside" `<program>`; §39.2 worked example + §40.8 v0.3 ratification say INSIDE. Three positions in the same SPEC.

**User direction (verbatim):** *"a"*

### Authority triangulation (PA Phase-0 verification)

Per [[feedback_grep_fire_sites_before_claiming_coverage]] — grep'd compiler-source for E-SCHEMA-003 fire site. **No fire site found.** F-019 is purely SPEC-text contradiction, NOT code-vs-spec; compiler doesn't currently enforce nesting either way. Q7 is doc-only either direction — no compiler-code risk.

Authority counts:
- §39.2 prose + §39.3 normative — say OUTSIDE (pre-v0.3 text never refreshed)
- §39.2 worked example + §40.8 v0.3 ratification + §39.2-line-17661 implicit-coupling — say INSIDE
- Compiler code — silent (no enforcement)

4 authorities favor INSIDE; 2 (same prose passage in two forms) favor OUTSIDE.

### Q7 RATIFICATION — (a) `<schema>` inside `<program>` as immediate child

**Decision:** `<schema>` lives as an immediate child of `<program>` (post-v0.3 canon). §39 prose rewrites to match the worked example + v0.3 ratification.

**Concrete amendments:**

**Amendment Q7-1 — SPEC §39.2 line 17621 prose:**

```
// BEFORE
A `< schema>` block appears at the top level of a file, alongside (not inside)
`< db>` blocks. It does not require the `src=` or `tables=` attributes of `< db>`
because the database path is read from `<program db="...">`.

// AFTER
A `<schema>` block appears as an immediate child of the `<program>` root, alongside
(not nested inside) `<db>` / `<page>` / other program children. It does not require
the `src=` or `tables=` attributes of `<db>` because the database path is read from
the enclosing `<program db="...">`.
```

**Amendment Q7-2 — SPEC §39.3 normative line 17663:**

```
// BEFORE
A `< schema>` block SHALL appear at file top-level only. A `< schema>` block
nested inside any other block SHALL be a compile error (E-SCHEMA-003).

// AFTER
A `<schema>` block SHALL appear as an immediate child of the `<program>` root.
A `<schema>` block nested inside any other block (logic context, component body,
`<page>`, `<db>`, etc.) SHALL be a compile error (E-SCHEMA-003).
```

**Amendment Q7-3 — §34 E-SCHEMA-003 catalog row (line 15621):**

```
// BEFORE
| E-SCHEMA-003 | §39.12 | A `< schema>` block is nested inside another block
(logic context, component body, etc.). Schemas are file-level declarations only. | Error |

// AFTER
| E-SCHEMA-003 | §39.12 | A `<schema>` block is nested inside any block other than the
`<program>` root (logic context, component body, `<page>`, `<db>`, etc.). Schemas are
immediate children of `<program>` only. | Error |
```

**Amendment Q7-4 — §39.2 worked example:** UNCHANGED. The example at lines 17626-17652 already shows the (a) form. No migration needed for the canonical example.

**Amendment Q7-5 — (deferred to Phase 2 implementation work, not Phase 2 doc amendment):** The compiler currently does NOT enforce E-SCHEMA-003. Per Rule 4 (SPEC normative; compiler implements), the catalog row mandates an enforcement code path. If post-amendment audit confirms E-SCHEMA-003 has no fire site, a compiler-source patch is needed to add the check. **Out of HU-2 scope; flagged as Phase 2 implementation follow-on.**

### Cohesion validation (per [[feedback_cohesion_and_falls_under_fingers]])

Per the design-evaluation lens ratified at Q5.B:
- (a) puts `<schema>` where the database it describes belongs — inside the program that uses it. Cohesive with `<page>`, `<db>`, server functions, `<channel>`, etc., which all live inside `<program>` per v0.3.
- (b) would make `<schema>` a structural orphan at file root, requiring a v0.3 exception clause. Non-cohesive.

(a) is the design-cohesion answer; (b) was the lowest-touch-from-stale-prose answer (and would have CAUSED more rewrites, not fewer). Per the banked rule: lowest-touch is NOT automatically the right answer; cohesion + falls-under-fingers wins.

### Findings closed by Q7

- **F-019 (1b, LB)** — RATIFIED. SPEC §39 prose rewrites to match worked example + v0.3 ratification; E-SCHEMA-003 catalog row updates.

### Carry-forward from Q7 (Phase 2 implementation follow-on)

- **E-SCHEMA-003 enforcement.** Compiler currently silent; Phase 2 implementation adds the nesting check. Out of HU-2 ratification scope but flagged so it doesn't drop on the floor.

## HU-2 (continued) — Q8 closure: §55.5 predictability wins

### Question + user direction

Q8 (F-018, 1b, LB): SPEC §55.5 has two readings co-existing — first sentence reads conditionally ("ANY field with validators → synth"); the no-validator clause reads unconditionally ("predictability over namespace savings"). PIPELINE Stage 6.7 invariants only describe the validator-bearing case explicitly.

**User direction (verbatim):** *"a it is"* — predictability wins.

### Authority triangulation (PA Phase-0 verification)

Per [[feedback_grep_fire_sites_before_claiming_coverage]] — grep'd compiler-source for synth-cell behavior on no-validator compounds:

| Authority | Says |
|---|---|
| SPEC §55.5 first sentence | gating reading (validator-bearing → synth) |
| **SPEC §55.5 no-validator clause** | **predictability reading (always synth, trivially true if no validators)** |
| PIPELINE Stage 6.7 invariants | only documents validator-bearing case (incomplete; doesn't contradict predictability, just silent) |
| **COMPILER CODE `symbol-table.ts:3356`** | VERBATIM: *"Synthesis is UNCONDITIONAL for compound parents — even no-validator compounds"* |
| `emit-synth-surface.ts:44` | "Per-field trivial defaults (errors=[], isValid=true) for no-validator fields" |
| `emit-client.ts:619-620` | "even compounds with no validator-bearing fields get the surface with trivially-true isValid + empty errors" |
| `symbol-table.ts:3583` | "Predictability over selectivity (audit §1.1...)" |

The compiler ALREADY implements the predictability behavior. SPEC §55.5 no-validator clause is the load-bearing canon. PIPELINE Stage 6.7 invariants are INCOMPLETE (only document the validator-bearing case) but don't contradict — same drift pattern as Q6 / Q7.

### Q8 RATIFICATION — (a) predictability wins

**Decision:** SPEC §55.5 predictability rule is canonical. PIPELINE Stage 6.7 invariants extend to explicitly document the no-validator-compound case. Zero compiler-code change (compiler already does this).

**Concrete amendments:**

**Amendment Q8-1 — SPEC §55.5 first-sentence prose** (clarification, not semantic change):

```
// BEFORE
When a compound state declaration contains ANY field with validators, the
compiler auto-synthesizes a reactive validity surface accessible at the
compound level.

// AFTER
The compiler auto-synthesizes a reactive validity surface accessible at the
compound level for EVERY compound state declaration. When the compound
contains validator-bearing fields, the surface tracks their results; when
it carries no validators, the surface is trivially-true / empty (predictability
over namespace savings — see no-validator-compounds clause below).
```

**Amendment Q8-2 — PIPELINE Stage 6.7 invariants (line 1981-1990 area):** EXTEND to cover no-validator case explicitly.

```
// ADDITION TO INVARIANTS
- For every compound state-cell carrying ANY validator-bearing field: a
  SynthCellEntry is created with level: 'compound', parentCompoundId: null,
  and per-field SynthCellEntry records for ALL fields (including no-validator
  fields — trivial defaults isValid: true / errors: []).
- For every compound state-cell with NO validator-bearing fields: a
  SynthCellEntry is ALSO created with level: 'compound' and trivially-true
  isValid / empty errors. (Predictability per SPEC §55.5; matches
  compiler/src/symbol-table.ts:3356 "Synthesis is UNCONDITIONAL for compound
  parents.")
```

**Amendment Q8-3 — Compiler code:** UNCHANGED. The compiler already implements the predictability rule per the grep evidence.

### Findings closed by Q8

- **F-018 (1b, LB)** — RATIFIED. SPEC §55.5 first-sentence prose clarified; PIPELINE Stage 6.7 invariants extended; zero compiler-code change.

### Banked methodology from Q8

No NEW methodology rule. Q8 re-validates [[feedback_grep_fire_sites_before_claiming_coverage]] for the THIRD time this session (after Q6 + Q7) — the compiler code keeps being the authority that already-aligns with SPEC's canonical reading; PIPELINE prose drifts.

**Pattern recognition (worth banking as observation):** In HU-2, four consecutive load-bearing findings (Q5 V-kill cluster's compiler-already-aligned + Q6 deriveEngineVarName + Q7 E-SCHEMA-003 / no fire + Q8 §55.5) ALL turned out to be PIPELINE / SPEC prose drift from already-correct compiler behavior. The compiler is more spec-canonical than the documentation around it. Phase 2 amendment work is predominantly doc-text editing, NOT code-change work. This empirical observation should shape Phase 2 sequencing — doc amendments are cheap; code-changes (when actually needed) are dispatch-shaped.

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
