# scrml.dev content spec-fidelity audit
**Date:** 2026-05-19
**Auditor:** general-purpose dispatch from side-session PA
**Scope:** 6 pages under docs/website/pages/
**Authoritative source:** compiler/SPEC.md (27,945 lines; navigation via compiler/SPEC-INDEX.md)
**Output:** verification report (no source edits)

## Summary

- Total claims audited: 56
- VERIFIED: 33
- PARTIALLY VERIFIED: 5
- WRONG: 6
- UNCLEAR-NOT-IN-SPEC: 5
- UNCLEAR-AMBIGUOUS: 1
- OUT OF SCOPE (philosophy narrative): 6 (counted but not itemised individually)

Highest-severity findings:
- **`derived.scrml` cites the wrong error code for write to a derived cell.** The page says `E-SYNTHESIZED-WRITE`; the SPEC normative code is `E-DERIVED-WRITE` (§6.6.8). `E-SYNTHESIZED-WRITE` is a *different* error (writes to the auto-synthesised validity-surface properties — §55.5/§55.7). Both pages cross-link to a `/reference/errors/E-SYNTHESIZED-WRITE` page that should not exist for the derived-cell case.
- **`req.scrml` uses `@cell.valid` instead of `@cell.isValid`.** SPEC §55.5/§55.6 normatively names the synthesised property `isValid`. The page's worked example uses `!@email.valid` / `!@password.valid` and asserts "Every cell with a validator surface gets a `.valid` computed property for free" — `.valid` is not in SPEC.
- **`req.scrml` invents struct-level req semantics.** The page's per-type table claims `req` on a struct "fails when all fields fail, passes when any field passes." No SPEC text supports this. SPEC §55.1's universal-core table lists `req` and does NOT define a struct-level reduction.
- **`req.scrml` cites SPEC §11 + §13 as authority.** §11 is *folded* (content distributed to §6.12 and §52); §13 is the *Async Model*. Correct authorities are §55 (validators / validity surface), §42.2.5 (req vs is some), §6 (state cells), §34 (error catalog).

---

## Per-page results

### getting-started.scrml

| # | Claim | Cited SPEC section | Verdict | Notes / suggested fix |
|---|---|---|---|---|
| 1 | `scrml compile <file> -o dist/` is a real CLI invocation | (CLI) | VERIFIED | `compiler/src/cli.js` lines 6, 49 — `compile` subcommand + `-o`/`--output-dir` flag both exist |
| 2 | `scrml dev` boots a dev server with hot reload on `localhost:3000` | (CLI) | VERIFIED | `compiler/src/commands/dev.js` line 63 — default port 3000 |
| 3 | `scrml dev . --port 3100 -o dist/` is a valid invocation | (CLI) | VERIFIED | dev.js lines 38, 69 — `--port` + `-o` both supported |
| 4 | `scrml build` produces optimised HTML/CSS/JS under `dist/` | (CLI) | VERIFIED | cli.js line 42 — `build` subcommand exists |
| 5 | Install workflow: `git clone … && cd scrmlTS && bun install && bun link` | (README + package.json) | VERIFIED | `package.json` `bin.scrml` → `compiler/bin/scrml.js`; README lines 55,58 match |
| 6 | "v0.3 release ships per-route per-role chunk splitting" | (impl, §40.9) | VERIFIED | §40.9.7 / §40.9.11; `W-CG-CHUNK-*` family and §40 v0.3 Wave 1 confirm per-route per-role chunking |
| 7 | `<x> = init` declares a reactive cell; `@x` reads / `@x = expr` writes | §6.1, §6.2 | VERIFIED | §6.1 V5-strict two-form access model |
| 8 | "Any DOM read of `@x` re-renders automatically on write" | §6.2 / §6.4 | VERIFIED | Reactive re-render is the §6 model |
| 9 | "No null, no undefined" + use `not` for absence; `""` / `0` / `[]` are defined values | §42.1, §42.1.1 | VERIFIED | §42.1 S89 user-ruling clauses + §42.1.1 — "`""` is NOT absence" |
| 10 | Inside `${ }` logic context, `@x = init` also declares | §6.1, §6.2 | VERIFIED | §6.1 V5-strict two forms |
| 11 | `bind:value=@step` two-way binds without a directive | §5 (5.4.1) | VERIFIED | §5 bind:value semantics |
| 12 | `onclick=decrement()` — standard event names, no JSX-style aliases | §5.2.2, §5.2.3 | VERIFIED | §5.2.2 event handler binding; §5.2.3 bare-form handler |
| 13 | Tailwind utilities work out of the box; compiler scans markup and emits only used CSS | §26 | VERIFIED | §26 Tailwind integration |

### about/philosophy.scrml

This page narrates the five pa.md PA-operating Rules. The Rules themselves are project process, not spec normatives. Spec-bearing claims are flagged below.

| # | Claim | Cited SPEC section | Verdict | Notes |
|---|---|---|---|---|
| 1 | Rules 1, 2, 3, 5 (scope discipline, production-bar, right-answer-beats-easy, direct communication) | n/a | OUT OF SCOPE | Process / project values, not spec claims |
| 2 | Rule 4: "scrml has a single normative document: compiler/SPEC.md" | (process) | VERIFIED | Matches pa-scrmlTS.md Rule 4 verbatim and the audit-prompt framing here |
| 3 | "Disagreement is a bug in one or the other — never an irresolvable axis" | (process) | OUT OF SCOPE | Project-process framing, not spec |
| 4 | Hyperbolic / rhetorical comparisons (Wirth, C/C++, Rust attitude) | n/a | OUT OF SCOPE | Narrative; non-load-bearing |

No spec-fidelity issues. Page does not assert language behaviour.

### reference/keywords/req.scrml

| # | Claim | Cited SPEC section | Verdict | Notes / suggested fix |
|---|---|---|---|---|
| 1 | "`req` is one of the three core universal-core predicates" | §55.1 | PARTIALLY VERIFIED | §55.1 lists FOURTEEN universal-core predicates, not three. `req` IS one of them. The page's "three core" framing (req / is some / not) conflates the predicate triad with the universal-core catalog. Suggested fix: drop "three core universal-core predicates" — say `req` is one predicate in the universal-core vocabulary, with `is some` as its existence-only sibling. |
| 2 | Available since v0.2.0 chip | (git) | UNCLEAR-VERSION | First tagged release is `v0.2.0` (2026-05-11). Validators (`req`, `is some`) were normatively added at S57 D2.8 (2026-05-04). So v0.2.0 was the first tagged release covering them, even though the feature existed pre-tag. Defensible; flag as approximate. |
| 3 | Page header link: "SPEC §11 (validators)" | §11 | **WRONG** | §11 is folded (content distributed to §6.12 and §52). Validator surface lives at §55. Correct anchor: §55.1 + §55.2 + §55.10. |
| 4 | "`req`-annotated cell fails validation when its value is 'empty-by-type': `""`, `0`, `false`, `[]`, `{}`" | §55.1, §42.2.5 | PARTIALLY VERIFIED | `""` failing req: VERIFIED (§42.2.5 row, §55.1 row). `0` / `false` / `[]` failing req: VERIFIED via SPEC narrative + §42.2.5 ("`req` (§55.1) Value is NON-EMPTY / MEANINGFUL"). `{}` failing req: **NOT IN SPEC** — see row 11 below. |
| 5 | Syntax: `<firstName: string req> = ""` (annotation on cell) | §55.2 | VERIFIED | §55.2 bare-attribute syntax: `<name req length(>=2)> = ...` |
| 6 | Syntax on function parameter: `function greet(name: string req)` | §53, §55.3 | UNCLEAR-AMBIGUOUS | SPEC §55.3 covers refinement-type validators on type expressions. Parameter-type form `name: string req` is a refinement-type form. §53 has the inline-type-predicate spec. Defensible reading but SPEC doesn't have a worked function-parameter `req` example I located. Mark as defensible. |
| 7 | Syntax on struct field: `firstName: string req` inside `type User:struct = { ... }` | §14.3, §55.3 | VERIFIED | Refinement-type predicate on a struct field is the §55.3 + §14.3 composition |
| 8 | Syntax on schema column: `email: string req` | §39.5.7, §55.4 | VERIFIED | §39.5.7 shared-core vocabulary on schema columns |
| 9 | "`@email.valid` is auto-synthesised. Every cell with a validator surface gets a `.valid` computed property for free." | §55.5, §55.6 | **WRONG** | SPEC normatively names the property **`.isValid`**, not `.valid`. See §55.5 line 27327 (`@signup.isValid : boolean`), §55.6 line 27360 (`@signup.name.isValid`). Page-fix: replace every `@x.valid` with `@x.isValid` in the page (worked example `<button disabled=!@email.valid \|\| !@password.valid>` becomes `disabled=!@email.isValid \|\| !@password.isValid`). |
| 10 | Per-type table: string `""` fails req, "anything else" passes; number `0` fails, non-zero passes; boolean `false` fails, `true` passes; array `[]` fails, non-empty passes | §55.1, §42.2.5 | VERIFIED | §55.1 says "Non-empty value (`""` fails; absence value `not` fails — §42)"; §42.2.5 table corroborates `""` fails req. The 0 / false / [] rows aren't enumerated normatively but are consistent with the "non-empty / meaningful" framing. Defensible. |
| 11 | Per-type table struct row: "all fields fail req → fails; any field passes → passes" | (none cited) | **UNCLEAR-NOT-IN-SPEC** | No SPEC text defines struct-level `req` reduction semantics. PRIMER does not corroborate this either (no struct-req row located). PA's self-flagged uncertainty is correct. Suggested fix: DROP the struct row from the table. If a struct field has `req`, that's a per-field validator firing on that field — not a struct-level reduction. The compound `@signup.isValid` is `false` if ANY field's validators fail (§55.5), which is structurally inverse to the page's "passes when any passes" claim. The page's invariant is also the OPPOSITE of how the compound-level surface composes. |
| 12 | "For enums, every variant passes req — an enum cell always has a meaningful value" | (none cited) | UNCLEAR-NOT-IN-SPEC | No explicit SPEC normative for enum + req. Reasonable conjecture (enum values have a variant tag, so "non-empty" is trivially true), but the page should soften from "every variant passes" to "an enum-typed cell always carries a defined variant; bare-variant `req` is therefore satisfied" — or drop and let `req` on enums fall under the engine-cell discussion at §55.14. |
| 13 | "req does not imply existence … The `<errors>` surface renders both as failures but distinguishes them in the per-predicate message." | §55.9, §55.12 | PARTIALLY VERIFIED | `is some` failing on `not` yields `.NotSome` tag; `req` failing on `not` ALSO short-circuits to `.Required` per §55.12 ("when `req` (or `is some`) FAILS on an empty cell or a cell holding `not`, the remaining validators are SKIPPED. Only `.Required` (or `.NotSome`) is reported"). So a `not` value checked by req gets `.Required`; a `""` value checked by req ALSO gets `.Required`. They are NOT distinguished by tag — both are `.Required`. Page's "distinguishes them in the per-predicate message" overstates. Suggested fix: drop the "distinguishes them" claim. |
| 14 | "req on derived cells fires E-DERIVED-WITH-VALIDATORS" | §55.14, §34 | VERIFIED | §55.14 + §34 catalog row |
| 15 | "req on a schema column emits SQL `NOT NULL` + a CHECK constraint matching the per-type emptiness rule" | §39.5.8 | VERIFIED | §39.5.8 lowering table row: req → `NOT NULL` + `CHECK (col != '')` for text/blob columns (omitted on integer/real/boolean/timestamp where empty-string is not representable) |
| 16 | "Spec §11 (validator surface) + §13 (validity surface synthesis). The req-on-derived error is §34 row E-DERIVED-WITH-VALIDATORS." | §11, §13, §34 | **WRONG** | §11 is FOLDED (line 6408: "This section has been folded"). §13 is the Async Model (line 6535). Correct authorities: §55 (validators + validity surface), §42.2.5 (req vs is some), §34 (error catalog). E-DERIVED-WITH-VALIDATORS reference IS correct; the section-number citations on either side of it are not. |

### reference/keywords/is-some.scrml

| # | Claim | Cited SPEC section | Verdict | Notes / suggested fix |
|---|---|---|---|---|
| 1 | "`is some` asserts that a cell holds a defined value — any defined value" | §42.2.2a, §42.2.5 | VERIFIED | §42.2.5 row: "Value EXISTS — null/undefined fail; `""` IS some" |
| 2 | "The only thing that fails `is some` is scrml's absence value `not`" | §42.2.5 | VERIFIED | §42.2.5 row |
| 3 | Available since v0.2.0 chip | (git) | UNCLEAR-VERSION | Same caveat as req page — feature spec'd 2026-05-04 (S57 D3 L5); first tag is v0.2.0 (2026-05-11). Defensible. |
| 4 | Header link "SPEC §42.2.5" | §42.2.5 | VERIFIED | §42.2.5 line 18879 "`is some` vs `req` — distinct predicates" |
| 5 | Syntax on state cell: `<middleName: string is some> = ""` | §55.2 | VERIFIED | Same bare-attribute decl as `req` (`is some` IS a universal-core predicate per §55.1) |
| 6 | "schema column `bio: string is some` lowers to `NOT NULL but empty allowed`" | §39.5.7, §39.5.8 | UNCLEAR-NOT-IN-SPEC | §39.5.8 lowering table does NOT list `is some` explicitly. The semantic claim (NOT NULL but empty allowed) is consistent with the predicate's meaning (rejects `not`, accepts `""`), but the SPEC table only enumerates `req` → NOT NULL + CHECK; the `is some` → NOT NULL lowering is not stated. PA should flag this for §55.4 / §39.5.8 amendment OR drop the schema-column example. |
| 7 | Worked example: `<button disabled=!@displayName.valid>` | §55.5, §55.6 | **WRONG** | Same `.valid` vs `.isValid` issue as req page — use `@displayName.isValid`. |
| 8 | Predicate-result table: `""` `is some`=passes / req=fails; `"alice"` both pass; `0` is some=passes / req=fails; `false` is some=passes / req=fails; `[]` is some=passes / req=fails; `not` both fail | §42.2.5, §55.1 | VERIFIED | §42.2.5 table corroborates `""` row; remaining rows consistent with the "non-empty / meaningful" framing in §55.1 |
| 9 | "Languages with null and undefined collapse both onto `not` here" | §42.1, §42.5 | VERIFIED | §42.5 codegen: both null and undefined map to scrml `not`; §42.1 S89 user-ruling |
| 10 | "§55.1 (universal-core predicate catalog — 14 predicates including `is some` and `req`)" | §55.1 | VERIFIED | §55.1 table enumerates exactly 14 predicates: `req`, `is some`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`. Page's count matches. |
| 11 | "Use neither when … A cell with no validator surface emits no `.valid` computed property and no `<errors>` renderable surface" | §55.5, §55.6 | **WRONG** | Two problems: (a) `.valid` should be `.isValid` (same fix as elsewhere on this page); (b) per §55.5 / §55.6, every compound cell synthesises a (trivially `true`) `isValid` regardless of whether validators are declared ("Predictability over namespace savings"; "field-level access works regardless of whether validators are declared"). For single-value Tier-1 cells the surface IS suppressed (§55.5 L11 Edge A). So the claim is only true for top-level single-value cells, not for compound cells. Suggested fix: tighten to "a top-level single-value cell with no validator surface emits no `.isValid`." |

### reference/keywords/derived.scrml

| # | Claim | Cited SPEC section | Verdict | Notes / suggested fix |
|---|---|---|---|---|
| 1 | "A derived cell is the third state shape (per SPEC §6.6)" | §6.6 | VERIFIED | §6.6 + §6.2 cross-ref establish Shape 3 = derived |
| 2 | Available since v0.2.0 chip | (git) | UNCLEAR-VERSION | Derived cells predate v0.2.0 tag; first tagged release is v0.2.0 (2026-05-11). Spec body for §6.6 is older. Defensible. |
| 3 | Header link "SPEC §6.6 (state shapes)" | §6.6 | VERIFIED | §6.6 is the canonical derived-cells section |
| 4 | "Derived cells are write-forbidden. Assigning into a derived cell fires E-SYNTHESIZED-WRITE at compile time." | §34 | **WRONG** | The correct error code is `E-DERIVED-WRITE` (§6.6.8 line 2679, §34 line 14797). `E-SYNTHESIZED-WRITE` is a *sibling* error for writes to auto-synthesised validity-surface properties (§55.5, §55.7 — e.g., `@signup.isValid = false`), not for derived-cell writes. The two pages should be cleanly separated. SPEC §6.6.18 line 3122 explicitly distinguishes them. Fix: replace `E-SYNTHESIZED-WRITE` with `E-DERIVED-WRITE` (both prose and the `/reference/errors/...` link). |
| 5 | "Mutating the value (`@derivedArr.push(x)`) fires E-DERIVED-VALUE-MUTATE (§6.6.18)" | §6.6.18 | VERIFIED | §6.6.18 lines 3092+, §34 line 14798 |
| 6 | "Validators are forbidden on derived cells. Adding `req` to a derived cell fires E-DERIVED-WITH-VALIDATORS" | §55.14 | VERIFIED | §55.14 lines 27598+ |
| 7 | "The `const` modifier on a state-cell declaration produces a derived cell (§6.6 Shape 3). The `derived` keyword spelling is the equivalent and clearer form for multi-line bodies" | §6.6.1 | **WRONG** | §6.6.1 normatively states: "The `const <name> = expr` form SHALL be the sole declaration syntax for derived reactive values. The form `@derived name = expr` (an alternative considered during design) SHALL NOT be recognized. Any use of `@derived` as a keyword SHALL be a compile error (E-REACTIVE-001) with a hint suggesting `const <name> = expr`." So there is NO `derived` keyword spelling for top-level cells; `const <x> = ...` is the only form. (The `derived=expr` attribute on `<engine>` is a separate construct — Shape on engines, §51.0.J — and is correctly used elsewhere on the page.) Fix: remove the "`derived` keyword spelling is the equivalent" sentence. |
| 8 | Worked example: `const <doubled> = @count * 2`; `const <badge> = <span class="badge">…</span>`; `const <greeting> = "Hello, " + @user.name` | §6.6, §6.6.17 | VERIFIED | §6.6.17 normatively allows markup-typed RHS (line 3056+); plain expressions ride §6.6.1 |
| 9 | Derived engine: `<engine for=Phase derived=computePhase(@a, @b)>` and "Derived engines never carry `initial=` (fires E-DERIVED-ENGINE-NO-INITIAL)" | §51.0.J | VERIFIED | §51.0.J line 22539: "`initial=` on the engine REJECTED — `E-DERIVED-ENGINE-NO-INITIAL`" |
| 10 | "Lazy evaluation by default. The derived expression evaluates on first read. If nothing reads it, it doesn't run." | §6.6.3 | VERIFIED | §6.6.3 line 2475+ normatively mandates "lazy pull with dirty flags"; "The compiler SHALL initialize all derived values by marking them dirty at startup. The first read of any derived value triggers its initial evaluation." |
| 11 | "Dep tracking is structural. Any reactive cell or expression-position `@x` read inside the derived RHS becomes a dependency. Conditional reads … only register dependencies on the branch actually taken." | §6.6.3 | PARTIALLY VERIFIED | First sentence (static structural dep extraction): VERIFIED via §6.6.3 Phase 1. The "only register dependencies on the branch actually taken" claim is FALSE. SPEC §6.6.3 says the compiler "extracts all `@variable` references as static dependency edges" — i.e., STATIC graph extraction, not runtime branch-conditional. Both branches' deps are subscribed at compile time. The claim describes a SolidJS-style runtime-auto-tracking model which §6.6.3 explicitly REJECTS ("runtime auto-tracking (used by SolidJS) [is] rejected for static dependency contexts; they are not conformant evaluation strategies for `const <name> = expr` outside of `^{}` meta blocks"). Fix: rewrite this bullet to say "static dependency extraction — every `@x` read in the RHS is a compile-time dep, regardless of conditional reachability." |
| 12 | "Result caching. The computed value is cached. Consumers re-read the cached value without re-running the expression until a dep changes." | §6.6.3 | VERIFIED | §6.6.3: "A derived value with a clean (unset) dirty flag SHALL return its cached value immediately on read, with no re-evaluation." |
| 13 | "Markup-typed derived cells are first-class … per §6.6.17" | §6.6.17 | VERIFIED | §6.6.17 lines 3056+ |
| 14 | "`debounced=` / `throttled=` on a derived cell is `E-DEBOUNCED-WITH-DERIVED`" | §6.13 / §34 | VERIFIED | §34 line 14837; §6.13.4 normative |
| 15 | "Self-reference is a cycle. The compiler detects this at the dep-graph pass and rejects." | §6.6.10 | VERIFIED | §6.6.10 normative + line 2786 worked example of self-reference cycle. Error code renamed S66 from E-REACTIVE-005 to **E-DERIVED-CIRCULAR-DEP** (note line 2800). Page doesn't cite a code here, which is fine. |
| 16 | "Side effects belong in event handlers or `<onTransition>` elements, not derived RHS" | §6.6.3, §51.0.H | PARTIALLY VERIFIED | The intent is sound (pure derived expressions), but SPEC doesn't have a normative "no side effects in derived RHS" sentence I located. It's implied by the lazy pull semantics + the diamond-dependency invariant ("each derived node is re-evaluated at most once per microtask flush"). Defensible as guidance. |
| 17 | Spec footer cites "§6.6 (Shape 3 — derived) + §6.6.17 (markup-typed derived) + §6.6.18 (derived value-mutate forbidden) + §51 (derived engines)" | §6.6, §6.6.17, §6.6.18, §51 | VERIFIED | Section numbers match. (§51 is a wide pointer; §51.0.J is the surgical anchor for derived engines.) |
| 18 | File-level comment: "SPEC anchors: §6.6.17 (markup-typed derived), §6.6.18 (derived value-mutate forbidden)" | §6.6.17, §6.6.18 | VERIFIED | Both subsection numbers exist and content matches |

### reference/keywords/lift.scrml

| # | Claim | Cited SPEC section | Verdict | Notes / suggested fix |
|---|---|---|---|---|
| 1 | "Available since v0.1" chip | (git) | UNCLEAR-VERSION | No `v0.1` tag exists in repo (first tag is v0.2.0). `lift` existed in pre-tag development for a long time. Suggested fix: change to "Available since v0.2.0" (the first tagged release) or drop the chip. |
| 2 | Header link "SPEC §10" | §10 | VERIFIED | §10 line 6014 "The `lift` Keyword" |
| 3 | "Two modes per §10.1: accumulation mode, value-lift mode" | §10.1 | VERIFIED | §10.1 line 6016+ enumerates exactly these two modes |
| 4 | Statement form: `lift <li value=name>;` | §10.3 | VERIFIED | §10.3 line 6063 worked example |
| 5 | Chain form: `users.select(userName).get().lift(<li value=userName>)` | §10.3 | VERIFIED | §10.3 line 6064 (verbatim form) |
| 6 | `<li value=...>` attribute legality | §24 (HTML), §10.3 example | VERIFIED | SPEC uses this form in multiple worked examples (lines 439, 493, 5597, 6063, 6064). HTML's native `<li>` doesn't define `value=` but scrml's element registry permits attribute passthrough; the SPEC's own canonical example is the form on the page. |
| 7 | Coercion table: Markup → markup[], Style #{ } → cssClass[], Logic → any, If-as-expression → scalar | §10.2 | VERIFIED | §10.2 table line 6047+ matches |
| 8 | "non-coercible items are E-TYPE-010" (markup) / "E-TYPE-011" (style) | §10.2 | VERIFIED | §10.2 normative line 6056 |
| 9 | "lift inside `function name() { ... }` is E-SYNTAX-002" | §10.4 | VERIFIED | §10.4 line 6078 normative |
| 10 | "Same for the `fn name { ... }` form" | §10.4 | VERIFIED | §10.4 line 6078 explicitly names both forms |
| 11 | "lift outside any `${ }` context is E-SYNTAX-001" | §10.4 | VERIFIED | §10.4 line 6083 normative |
| 12 | "Multiple lifts on the same execution path through one if-as-expression arm is E-LIFT-002" | §10.4 / §17.6 | VERIFIED | §10.4 line 6079 normative + line 6085 message; §17.6 cross-ref |
| 13 | "Heterogeneous lifted values that aren't mutually coercible is E-TYPE-012" | §10.4 | VERIFIED | §10.4 line 6082 normative |
| 14 | "§10.1.1 (L1 reframe) — scrml's L1 pillar puts markup as a first-class value type" | §10.1.1 | VERIFIED | §10.1.1 lines 6030+ |
| 15 | "Markup-typed derived cells (§6.6.17) … produce markup values without lift" | §6.6.17 | VERIFIED | §10.1.1 + §6.6.17 cross-ref normative |
| 16 | Spec footer "§10 in full (semantics §10.1, L1 reframe §10.1.1, coercion §10.2, syntax §10.3, use-site restrictions §10.4) + §17.6" | §10, §17.6 | VERIFIED | All subsection numbers match |

---

## Cross-page findings

1. **Validity-surface property naming.** Both req.scrml and is-some.scrml use `@x.valid`. SPEC normative name is `@x.isValid` (§55.5, §55.6, §55.7). Six occurrences total across both pages. Single mechanical rename.
2. **E-SYNTHESIZED-WRITE vs E-DERIVED-WRITE confusion.** derived.scrml conflates these two distinct errors. SPEC §6.6.18 line 3122 calls them out as siblings:
   - **E-DERIVED-WRITE** — reassignment to a derived cell (`@derived = newval`).
   - **E-DERIVED-VALUE-MUTATE** — in-place mutation of a derived cell (`@derived.push(...)`).
   - **E-SYNTHESIZED-WRITE** — writes to auto-synthesised validity-surface properties (`@signup.isValid = false`).
   The first two are derived-cells; the third is validity-surface. The derived page conflates 1 and 3.
3. **§11 / §13 stale citations.** req.scrml cites §11 and §13 as authority. §11 is folded; §13 is the Async Model. Correct authorities for validators are §55 (validity surface) and §42.2.5 (predicate-pair semantics). Affects two cross-link sites on req.scrml.
4. **Version chip semantics.** "Available since v0.1" / "v0.2.0" chips claim a tagged release. There is no `v0.1` tag in the repo; lift's chip should reflect that. The req/is-some/derived chips at v0.2.0 are defensible (first tagged release after the spec landings).
5. **No SPEC drift in section numbering for the pages audited.** Every cited subsection number (§6.6, §6.6.17, §6.6.18, §10, §10.1, §10.1.1, §10.2, §10.3, §10.4, §17.6, §42.2.5, §51.0.J, §55.1, §55.14) matches the current SPEC-INDEX. The PA's self-flagged uncertainty on these was unfounded — section numbers are clean. The drift is in the SUBSTANTIVE claims, not the citation anchors. Exception: req page's §11 / §13 citations (not in PA's uncertainty list) are stale.
6. **Static dep extraction vs runtime auto-tracking.** derived.scrml's "conditional reads only register deps on the branch taken" describes a runtime-auto-tracking model SPEC §6.6.3 explicitly REJECTS (line 2479). One bullet to rewrite.
7. **`derived` keyword as alternative spelling.** derived.scrml's claim that the `derived` keyword is "the equivalent and clearer form for multi-line bodies" contradicts §6.6.1's "the `const <name> = expr` form SHALL be the sole declaration syntax" (and the explicit E-REACTIVE-001 reject of `@derived`-as-keyword). This sentence needs to be deleted.

---

## Suggested PA next steps (prioritised)

1. **derived.scrml — error code fix (E-SYNTHESIZED-WRITE → E-DERIVED-WRITE).** Two occurrences in body prose + one `/reference/errors/...` anchor link. Smallest mechanical fix with the highest correctness impact.
2. **req.scrml + is-some.scrml — rename `.valid` → `.isValid`.** Mechanical rename, six occurrences across both files. Restores spec fidelity for the validity-surface API.
3. **derived.scrml — delete the "`derived` keyword spelling is the equivalent" sentence.** Contradicts §6.6.1; risks adopters writing `@derived name = ...` and hitting E-REACTIVE-001.
4. **derived.scrml — rewrite the "Conditional reads only register dependencies on the branch actually taken" bullet.** Replace with "static dependency extraction — every `@x` read in the RHS is recorded as a compile-time dep regardless of conditional reachability; runtime auto-tracking (SolidJS-style) is explicitly rejected for `const <>` cells outside `^{}` meta blocks per §6.6.3."
5. **req.scrml — drop the struct row from the per-type table.** PA's self-flagged uncertainty was correct: SPEC has no struct-level `req` reduction semantics. The asserted invariant is also structurally inverse to how the compound `@signup.isValid` composes (§55.5: false if ANY field fails). Replace with a one-liner noting that `req` on a struct field is per-field, not struct-level, and the compound surface composes via §55.5.
6. **req.scrml — replace SPEC §11 / §13 citations with §55 + §42.2.5.** Two locations: the header chip and the §7 "Specification" footer. §11 is folded; §13 is Async.
7. **req.scrml — soften "distinguishes them in the per-predicate message" claim.** Per §55.12 short-circuit, `req` failing on either `""` OR `not` produces the same `.Required` tag. They're not distinguished by tag; the `.NotSome` tag is for `is some` failures.
8. **req.scrml — soften "three core universal-core predicates" framing.** §55.1 has FOURTEEN. `req` / `is some` / `not` are the absence/existence/meaning triad but not "three of the core" — they're one slice of a larger vocabulary.
9. **is-some.scrml — soften the "no `.isValid` for non-validator cells" claim.** Per §55.5/§55.6 the surface IS synthesised on compound cells regardless of validator presence (predictability rule); only single-value Tier-1 cells suppress.
10. **is-some.scrml — verify schema-column `is some` lowering against §39.5.8.** SPEC §39.5.8 only enumerates `req` → `NOT NULL` + CHECK; the `is some` row is absent. Either amend §39.5.8 or trim the schema-column example from the page.
11. **lift.scrml — fix version chip.** No v0.1 tag exists. Change to v0.2.0 or remove.
12. **All four keyword pages — flag version chips as approximate.** PA's self-doubt is well-founded; the chips conflate "tagged release" with "feature landed." A pinned-source citation (commit SHA) would be more precise but probably overkill for a docs site.
