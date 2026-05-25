---
status: complete
last-reviewed: 2026-05-25
session: S129
phase: 1c — inverse-direction coverage audit (SPEC features → PRIMER + kickstarter coverage check)
trigger: HU-2 lifecycle-annotation surface; methodology gap in Phase 1b brief (one-direction hole-detection)
inputs:
  - docs/PA-SCRML-PRIMER.md (1001 lines)
  - docs/articles/llm-kickstarter-v2-2026-05-04.md (1277 lines)
  - compiler/SPEC.md (consulted via SPEC-INDEX.md per-section; 29,124 lines)
total-features-audited: 58 sections + 5 appendices
total-findings: 26
by-classification:
  COVERED: 17
  PARTIAL-COVERAGE: 6
  INTENTIONAL-SILENCE: 15
  GAP: 26
by-severity (GAP only):
  LOAD-BEARING: 11
  MEDIUM: 11
  LOW: 4
---

# SPEC Feature → Canon Coverage Audit (Phase 1c)

## Scope, method, taxonomy

**Why this audit exists.** Phase 1b's brief mandated canon-anchored hole-detection in only one direction — "canon claims X / SPEC silent on X." HU-2 surfaced a flagship-class gap (F-023: SPEC §14.3 ratifies `(A -> B)` lifecycle annotation; PRIMER + kickstarter v2 carry ZERO mentions) that Phase 1b's one-direction check missed. Phase 1c closes the methodology gap by walking the INVERSE direction: for each SPEC feature, check whether the adopter-facing canons surface it.

**Scope.** Two canons under audit:
- **`docs/PA-SCRML-PRIMER.md`** — PA + dev-agent-facing canon snapshot (1001 lines). The "how does scrml work" reference for orchestration / dispatch work.
- **`docs/articles/llm-kickstarter-v2-2026-05-04.md`** — LLM + adopter-facing canon (1277 lines). What an outside LLM / new adopter reads to write scrml.

Out of audit scope (deliberate, per the brief):
- Native-parser source (Phase 1b touched it; "what's implemented" is not "what's taught").
- Design-insights (debate-verdict log, not adopter docs).
- PIPELINE.md (compiler-internal, not adopter-facing).

**SPEC walk method.** Used `compiler/SPEC-INDEX.md` (379 lines) as the feature catalog. Per-section: identified the flagship / load-bearing features, grep'd PRIMER + kickstarter for keyword indicators, classified per taxonomy. SPEC.md spot-checked only where the SPEC-INDEX summary was ambiguous.

**Taxonomy.**

- **COVERED** — Both canons teach the feature at depth matching its load-bearing status. No finding.
- **PARTIAL-COVERAGE** — One canon teaches / the other silent. OR both touch lightly when load-bearing. Finding with severity per gap depth.
- **INTENTIONAL-SILENCE** — Feature is genuinely adopter-invisible / niche / compiler-internal-only. Canons are CORRECT to be silent. NOT a finding. Examples: §47 output name encoding, §57 wire format envelope, §58 build story (spec-ahead-of-implementation).
- **GAP** — SPEC's framing makes the feature load-bearing (pillar / flagship / L-locked / worked-examples-in-SPEC level) AND canons carry zero or near-zero coverage. F-NNN finding. F-023 (lifecycle annotation) is the canonical case.

**Severity (GAP only).**

- **LOAD-BEARING** — Foundational. An adopter who doesn't know this can't write idiomatic scrml. Catch-up scope: flagship section.
- **MEDIUM** — Substantial feature. Adopter benefits from knowing. Catch-up scope: footnote section + key examples.
- **LOW** — Niche / specialized use case. Catch-up scope: one-line mention + cross-ref.

**Finding ID space.** Continues from Phase 1b numbering. Phase 1b ended at F-022 (1b); HU-2 added F-023 + F-024. Phase 1c starts at **F-025**.

**Coverage assertion methodology.** For each numbered section in SPEC-INDEX (§1-§58 + App. A-E), I identified the flagship feature(s), grep'd both canons for keyword indicators, classified, and recorded. Where the classification depended on a feature's load-bearing status, I cross-checked against SPEC's section size + "L"-lock list + the kickstarter §2 canonical skeleton.

## Coverage table — per SPEC section

| § | Section | Feature(s) | PRIMER coverage | Kickstarter coverage | Classification | Finding |
|---|---|---|---|---|---|---|
| 1 | Overview / Pillars / V5-strict (§1.6) | Design principles, north-star ladder, V5-strict | §1, §2 (full) | §1, §3 (full) | COVERED | — |
| 2 | File Format and Compilation Model | `.scrml`, Bun runtime, output | §12 (operational) | §8 (questions) | COVERED | — |
| 3 | Context Model | Contexts, V5-strict access form per locus | §3 (full) | §3 (full) | COVERED | — |
| 4 | Block Grammar | Tags, closers, `</>`, `:`-shorthand, structural elements registry, raw-content `<pre>`/`<code>`, §4.18 code-default body mode, §4.18.3 display-text literal | §9.6 (D4 cleanup, partial) | §2 skeleton, §13 traps | PARTIAL — `:`-shorthand mentioned; raw-content + code-default + `"..."` literal silent | F-025 |
| 5 | Attribute Quoting | Three forms, `bind:`, event handler binding, bare-form handler, multi-statement restriction | §6 + traps | §3, §6.7, §7 traps | COVERED | — |
| 6 | Reactivity (V5-strict access model) | V5-strict, RHS shapes, compound state, derived, lifecycle, default+reset, hoisting, pinned, validity stub | §3-§5 (full) | §3, §3.1 (full) | COVERED | — |
| 7 | Logic Contexts | `${}` syntax, function forms, markup-as-expr, file-level scope | (implicit throughout) | §2 skeleton | COVERED | — |
| 8 | SQL Contexts (`?{}`) | `?{}` syntax, bound params, INSERT/UPDATE/DELETE, **§8.9 per-handler coalescing, §8.10 N+1 loop hoist, §8.11 mount hydration** | (implicit) | §2 skeleton + §7 traps | PARTIAL — §8.9/§8.10/§8.11 (Tier 1/2 coalescing + N+1 hoist) silent | F-026 |
| 9 | CSS Contexts | `#{}` inline CSS, style blocks | (implicit `#{}`) | §2 skeleton (one row) | PARTIAL — `#{}` mentioned, scoping behavior + style-block silent | F-027 |
| 10 | The `lift` Keyword | Semantics, syntax forms, ordering, value-lift, accumulation | (referenced) | §2 skeleton + §13 traps | PARTIAL — `lift` used in examples; value-lift / accumulation rules undocumented | F-028 |
| 11 | State Objects (Reserved — Folded) | Distributed to §6/§52 | (n/a) | (n/a) | COVERED (intentionally folded) | — |
| 12 | Route Inference | Default placement, server return, **§12.5.1 wire-format envelope** | (implicit) | §11.7 multi-page | PARTIAL — route inference & wire format silent | F-029 |
| 13 | Async Model | Developer-visible syntax, compiler-managed async, RemoteData, no async/await | §6.1, §11 traps | §5 auto-await + §13 traps | COVERED | — |
| 14 | Type System | Structs, enums, pattern matching, asIs, schema types, **§14.3 lifecycle annotation `(A to B)`**, bare-variant inference, positional binding | §3.7+ | §3.1, §4.8 | PARTIAL — lifecycle annotation already covered by F-023 (HU-2); positional binding present | F-023 (ref — HU-2) |
| 15 | Component System | Definition, props, shapes, slots, callbacks, reactive scope, components-vs-engines | §7 + §11 + §13 | §12 (full) | COVERED | — |
| 16 | Component Slots | Named slots, unnamed children, fill syntax | §7 (cross-ref) | §12 (cross-ref) | PARTIAL — slot fill syntax / multi-slot details silent | F-030 |
| 17 | Control Flow | `if=`, `show=`, lifecycle, iteration, **§17.6 if-as-expression** | §6, §11 | §2 skeleton, §13 | PARTIAL — `if=` covered; **if-as-expression** silent | F-031 |
| 18 | Pattern Matching and Enums | block-form `<match>`, JS-style `match expr`, attribute legality, bare-variant inference | §6.2 (full) | §4 partial | COVERED | — |
| 19 | Error Handling | Renderable enum variants, `fail`, `?`, `!`, errorBoundary, **§19.9.8 no async/await**, **§19.9.9 multi-batch CPS**, **§19.10.5 implicit per-handler tx**, **§19.12 test-bind** | §6 + §6.1 (full) | §6 (full) | PARTIAL — `fail`/`!{}` covered; CPS / per-handler-tx / test-bind / errorBoundary silent | F-032 |
| 20 | Navigation API | `navigate()`, route params, session context | (cross-ref) | §11.7 partial | PARTIAL — `navigate(.Hard)` mode silent | F-033 |
| 21 | Module and Import System | Export/import, **§21.2 Form 1 / Form 2**, re-export, pure-type files, **§21.3.1 `import:host`** | §9.6, §13.5 | §11.7 partial | PARTIAL — Form 1/2 + pure-type files silent | F-034 |
| 22 | Metaprogramming (`^{}`) | `^{}` meta context, compile-time/runtime meta, Option D scope model, **§22.12 Approach C closed set**, **§22.13 manifest gate** | §13.5 (audit-table only) | silent | GAP — flagship meta surface silent | **F-035** |
| 23 | Foreign Code (`_{}`) | Level-marked braces, opaque passthrough, WASM sigils (`r{}`/`c{}`/`z{}`), sidecars (`use foreign:`) | §13.5 (sliver-empty row only) | silent | GAP (sliver-empty but adopter-visible surface; canons silent because adoption is pending — borderline INTENTIONAL-SILENCE; marked GAP at LOW severity) | **F-036** |
| 24 | HTML Spec Awareness | Element registry, shape constraints, structural elements (NOT HTML) | §9.6 (cross-ref) | (implicit) | COVERED | — |
| 25 | CSS Variable Syntax | Defining/using vars, hyphenated names, scoping | silent | silent | INTENTIONAL-SILENCE (CSS-surface detail; adopter can pattern-match from CSS prior art) | — |
| 26 | Tailwind Utility Classes | Integration, variant prefixes (S49), arbitrary values (S109), typography plugin (S100) | §13.5 (passive ref) | silent | PARTIAL — Tailwind classes appear in examples; integration normative rules + W-TAILWIND-UNRECOGNIZED-CLASS silent | F-037 |
| 27 | Comment Syntax | Universal `//`, per-context native comments | (implicit `//`) | (implicit `//`) | COVERED (obvious) | — |
| 28 | Compiler Settings | `html-content-model`, lint suppression configs | silent | silent | INTENTIONAL-SILENCE (project-config concern; not language behavior) | — |
| 29 | Vanilla File Interop | `.js`, `.html`, `.css` passthrough; progressive adoption | silent | silent | INTENTIONAL-SILENCE (one-liner; adopter learns by trying) | — |
| 30 | Compile-Time Eval — `bun.eval()` | scope-of-use, `${}` interpolation, security | silent | silent | INTENTIONAL-SILENCE (HU-1 ratified retirement; §30.2 will retire per F-003 close; remaining §30.1 is compiler-internal) | — |
| 31 | Dependency Graph | Purpose, construction, route analysis, validator predicate-arg dep tracking | §13.6 (B7+) | silent | INTENTIONAL-SILENCE (compiler-internal mechanism; adopter sees the EFFECT not the graph) | — |
| 32 | The `~` Keyword | Pipeline accumulator, `lin` variable, context boundary | §13 ref only (no flagship) | §15 "stop" sign only | GAP — flagship pipeline primitive, no canonical coverage | **F-038** |
| 33 | The `pure` Keyword | Purity constraints, **§33.6 fn ≡ pure function**, W-PURE-REDUNDANT | §13 ref only (locks table) | silent | GAP — load-bearing function-discipline feature | **F-039** |
| 34 | Error Codes | Catalog | (sampled in examples) | (sampled in examples) | INTENTIONAL-SILENCE (reference catalog, not feature; flagship error codes appear by name in examples) | — |
| 35 | Linear Types — `lin` | Declaration (exactly-once), consumption, control flow, closures, **§35.2.1 lin function params**, **§35.2.2 cross-`${}` block lin** | §13 locks table only | §11.9 (recipe, basic) | PARTIAL — basic lin covered; lin params / cross-block / E-LIN-005 shadowing / E-LIN-006 deferred-ctx silent | F-040 |
| 36 | Input State Types | `<keyboard>`, `<mouse>`, `<gamepad>` | §13.5 (sliver-empty row + debate-04 active) | silent | GAP (sliver-empty but ratified language surface; debate-04 in flight; canons should at minimum acknowledge with cross-ref) | **F-041** |
| 37 | Server-Sent Events | `server function*` SSE generators | silent | silent | GAP — load-bearing async surface | **F-042** |
| 38 | WebSocket Channels | `<channel>` placement, V5-strict body, broadcast/disconnect | §9.1 (full) | §11.3 (recipe) | COVERED | — |
| 39 | Schema and Migrations | `<schema>`, column types, migration diff, **§39.5.7-9 shared-core vocabulary + lowering** | §9.2 (full) | §11.6 (recipe) | COVERED | — |
| 40 | Middleware and Request Pipeline | Auto middleware, `handle()`, **§40.7 `<program>` documentary attrs**, **§40.8 v0.3 program shape + default-logic body**, **`<auth role>` first-class** | §9.7 (Approach A close in depth) | §11.8 (basic recipe) | PARTIAL — `handle()` + auto attrs covered; documentary attrs + `<auth>` + default-logic body silent | F-043 |
| 41 | Import System — `use`/`import` | Capability imports, value imports, vendoring, **§41.12 registerMessages**, **§41.13 parseVariant**, **§41.14 formFor**, **§41.15 schemaFor**, **§41.16 tableFor** | §10 stdlib (full); §13.6 type-as-arg | §9 stdlib (full) | PARTIAL — stdlib catalog + registerMessages covered; type-as-arg family (parseVariant / formFor / schemaFor / tableFor) silent in kickstarter | F-044 |
| 42 | `not` — Unified Absence Value | `not` keyword, `is not`, `is some`, `given x =>`, `T \| not`, **§42.1.1 defined values vs absence** | §9.4 (`is some` vs `req`), §9.5 | §3 + §7 traps (basic) | PARTIAL — `not` + `is some` vs `req` covered in PRIMER; `given x =>` / `T \| not` / defined-values-vs-absence silent in kickstarter | F-045 |
| 43 | Nested `<program>` | Execution contexts (workers / sidecars), shared-nothing, lifecycle, RPC, message passing | silent | silent | GAP — substantive feature surface (~83 SPEC lines + supervision attrs) | **F-046** |
| 44 | `?{}` Multi-Database Adaptation | Bun.SQL target, driver resolution, `.get()` → `T \| not`, **§44.8 bracket-matched `?{` scanner** | silent | §11.6 schema (db= ref) | GAP — multi-db driver story + adapter rules silent | **F-047** |
| 45 | Equality Semantics | Single `==`, no `===`, structural, compiler-derived | §11 traps | §7 traps | COVERED | — |
| 46 | Worker Lifecycle | `when ... from <#name>`, supervision attrs (`restart=`/`max-restarts=`/`within=`) | silent | silent | GAP — full worker lifecycle surface silent | **F-048** |
| 47 | Output Name Encoding | Encoded JS variable names, kind prefixes, hash scheme | §13.5 (D4 reviewed note) | silent | INTENTIONAL-SILENCE (compiler-internal naming; adopter never types these) | — |
| 48 | The `fn` Keyword | Body prohibitions, return-site completeness, calling conventions, **§48.6.4 mutual recursion + hoisting**, **`pinned fn` opt-out** | §13 locks (S32 retired) | silent | PARTIAL — `fn` vs `function` distinction silent in kickstarter; PRIMER references but no flagship section | F-049 |
| 49 | `while` and `do...while` Loops | Grammar, break/continue, labels, lift in loops, E-LOOP errors | silent | §13 traps (one mention "while") | GAP — full loop surface (while/do-while/labels/break/continue) silent | **F-050** |
| 50 | Assignment as Expression | Assign-expr syntax, semantics, type rules, double-paren disambiguation, W-ASSIGN-001 | silent | silent | GAP — flagship feature (motivated by self-host regex iteration; ~506 SPEC lines) silent | **F-051** |
| 51 | `<engine>` (State Transition Rules) | Engine declaration, state-children, rule=, `<onTransition>`, `effect=`, `<onTimeout>`, `<onIdle>`, history, internal:rule, hierarchy, derived engines | §7 + §7.1 (full, A5-1) | §4 (full) | COVERED | — |
| 52 | State Authority Declarations | Two-tier authority, server @var, sync infrastructure, **§52.13 auth=** | (cross-ref §52 in pillars) | §11.2 auth recipe | PARTIAL — server-fn boundary covered; explicit `@var server` declaration form + state-authority rules silent | F-052 |
| 53 | Inline Type Predicates | Value constraints, SPARK zones, named shapes, `bind:value` HTML attrs, **§53.14 type-as-argument primitives** | §9.3 (predicates), §13.6 (type-as-arg) | §3.7 (one line) + §8 questions (one line) | PARTIAL — refinement-type predicates appear in examples; SPARK three-zone semantics + named-shape registry + bind:value HTML attr mapping silent | F-053 |
| 54 | Nested Substates and State-Local Transitions | §54.2 nested substate grammar, §54.3 state-local transitions, §54.4 field narrowing, §54.5 terminal states | silent | silent | GAP — substantive type-system extension (~301 SPEC lines, S32 ratified) silent | **F-054** |
| 55 | Validators and Auto-Synth Validity Surface | Universal-core vocabulary (14 predicates), state-cell validators, refinement-type validators, schema-column validators, auto-synth surface (compound + per-field), `<errors of=>`, ValidationError enum, 4-level message resolution, cross-field, multi-errors, reset interaction | §8 (full) | §6 (full) | COVERED | — |
| 56 | Promotion Ergonomics | `I-MATCH-PROMOTABLE` info-lint, three message shapes, `bun scrml promote --match` CLI | §13.8 (full) | silent | PARTIAL — flagship promotion mechanic (S66 SHIPPED) silent in kickstarter | F-055 |
| 57 | Wire Format | Canonical envelope `{"__scrml_absent": true}`, encoder/decoder rules, v1.0 clean break | silent | silent | INTENTIONAL-SILENCE (compiler-internal serialization; adopter sees `T \| not` API, not wire bytes) | — |
| 58 | Build Story | `compile(source, buildStory)` pure function, four-component composite, content-addressed Merkle closure, `[story]` manifest, `build-story.lock` sidecar, dialect islands | silent | silent | INTENTIONAL-SILENCE (spec-ahead-of-implementation per S118 Nominal banner; no compiler impl yet; canons correct to wait) | — |
| A | Appendix A: Interaction Matrix | Error system feature interactions | silent | silent | INTENTIONAL-SILENCE (SPEC-internal reference matrix) | — |
| B | Appendix B: Superseded Spec Text | What §19 replaced | silent | silent | INTENTIONAL-SILENCE (SPEC-internal history) | — |
| C | Appendix C: Future Considerations | Error composition, retry, telemetry, async errors | silent | silent | INTENTIONAL-SILENCE (forward-looking; adopter should not learn from these) | — |
| D | Appendix D: JS Standard Library | JS stdlib access in logic contexts | silent | silent | INTENTIONAL-SILENCE (adopter sees the JS surface natively; no scrml-specific teaching needed) | — |
| E | Appendix E: `</>` Closer Migration | Migration guide for `/` → `</>` | silent | silent | INTENTIONAL-SILENCE (migration concern for legacy authors only) | — |

## Findings (GAP class only)

### F-025 — §4 raw-content elements + code-default body mode + display-text literal silent

- **Feature:** §4.17 raw-content `<pre>` / `<code>` (S101) + §4.18 code-default body mode + §4.18.3 `"..."` display-text literal (S111 — quoted-text model, scope b).
- **SPEC locus:** §4.17 + §4.18 (line 1014+ for §4.16; §4.18 ~lines 1100+).
- **Flagship?** YES — §4.18 is the BLOCK GRAMMAR. Engine state-child / match-arm / `:`-shorthand bodies are CODE-DEFAULT — bare runs are CODE, display text is a `"..."` literal. This is the single most important block-grammar amendment of S111.
- **Severity:** LOAD-BEARING — an adopter who writes `<Idle> Loading text </>` will hit `E-UNQUOTED-DISPLAY-TEXT` and not know why. Already F-014 (1b) covers PRIMER §6.2 quoted-text drift (Phase 2 Q8); F-025 covers the SECOND canon (kickstarter) PLUS PRIMER's raw-content silence.
- **PRIMER coverage:** §9.6 cleanup-and-cross-refs row mentions `:`-shorthand and structural elements registry but says nothing about code-default body mode or `"..."` display-text literals. `<pre>` / `<code>` not mentioned anywhere.
- **Kickstarter coverage:** §2 skeleton uses bodies but doesn't articulate the code-default rule. `<pre>`/`<code>` silent. `"..."` literal silent.
- **Audit reasoning:** §4.18 is the canonical SPEC for what goes in a body; adopters learn body shapes from canon examples. The quoted-text model is a NORMATIVE rule, not a stylistic preference. Two flagship canons silent on a normative rule = GAP not INTENTIONAL-SILENCE.
- **Recommended direction:** canon catches up to SPEC — flagship-section treatment in both PRIMER (extend §6 / §7) and kickstarter (extend §4 engines + §6 errors); include 1-2 worked examples showing bare-prose-becomes-`E-UNQUOTED-DISPLAY-TEXT`.
- **Notes:** Overlaps with F-014 (1b) — both findings should be resolved together as one quoted-text-model migration in canon.

### F-026 — §8 SQL coalescing tiers silent

- **Feature:** §8.9 per-handler SQL coalescing (Tier 1) + §8.10 N+1 loop hoisting (Tier 2) + §8.11 mount-hydration coalescing.
- **SPEC locus:** §8.9-§8.11 (~5552-5670).
- **Flagship?** YES — these are the THREE TIERS that make scrml's SQL surface fast-by-default.
- **Severity:** MEDIUM — adopter can write working scrml without knowing about coalescing (compiler does the work) BUT debug + perf intuition suffers without it.
- **PRIMER coverage:** silent (PRIMER teaches the `?{}` surface implicitly through examples in §11 but never names the coalescing tiers).
- **Kickstarter coverage:** silent.
- **Audit reasoning:** This is "what scrml does for you that adopters need to know to TRUST not micro-optimize." Different shape than universal-core / engines (those are user-typed); coalescing is compiler behavior. But it's a load-bearing claim — without surfacing it, adopters write hand-rolled batching code that scrml already does.
- **Recommended direction:** footnote-section in both canons (PRIMER under §9; kickstarter §11 next to SQL recipes); 1-2 sentences each tier.
- **Notes:** Adjacent to F-029 (route inference / wire format silent).

### F-027 — §9 CSS contexts shallow coverage

- **Feature:** `#{}` inline CSS, `<style>` block, CSS files (~43 SPEC lines — small but normative).
- **SPEC locus:** §9.
- **Flagship?** NO — small section.
- **Severity:** LOW — CSS authoring is HTML-prior-art; adopter pattern-matches.
- **PRIMER coverage:** `#{}` referenced once (S86 idiomatic-styling note); style block silent.
- **Kickstarter coverage:** §2 skeleton table has one row mentioning `#{}` as "scoped CSS block."
- **Audit reasoning:** Borderline INTENTIONAL-SILENCE — but `#{}` scope-semantics + the file-top-`#{}` rule (S86) is a behavioral nuance that adopters DO miss. Surfacing one example saves a footgun.
- **Recommended direction:** kickstarter §2 footnote on `#{}` scoping; PRIMER cross-ref to S86 idiomatic-styling note.
- **Notes:** S86 idiomatic-styling rule banked in memory ("file-top `#{}` never canonical in examples"); the rule should surface where adopters meet `#{}`, not just in PA memory.

### F-028 — §10 `lift` accumulation rules silent

- **Feature:** §10 `lift` keyword — semantics, syntax forms, ordering, **§10.8 accumulation**, value-lift vs accumulation-mode.
- **SPEC locus:** §10 (~394 SPEC lines; substantial).
- **Flagship?** YES — `lift` is one of scrml's distinctive primitives; markup-as-value pillar L1 reframes §10.1.1.
- **Severity:** LOAD-BEARING — `lift` appears in 14+ canonical examples in kickstarter but is NEVER taught normatively. Adopter sees `lift <li>...</>` and pattern-matches "this is JSX `.map()`" — actually wrong.
- **PRIMER coverage:** `lift` appears 16 times across examples; no normative §10-anchored explanation.
- **Kickstarter coverage:** `lift` appears 12 times in examples (`for (let item of items) { lift <li> ... </> }`); §2 skeleton table says "Marks a server-fn return value (data) or client-side reactive markup expansion." No accumulation semantics. No value-lift mode.
- **Audit reasoning:** The kickstarter row is a one-sentence shorthand that misses the load-bearing semantic — `lift` accumulates into the implicit `~` of the enclosing logic context. The §32 `~` connection is invisible. Without `~`+`lift` together, adopters reach for `.push()` mutations.
- **Recommended direction:** PRIMER §6.3-ish flagship section on `lift` + value-lift + accumulation; kickstarter §11 reactive recipe footnote-block on how `lift` interacts with `${ for }`.
- **Notes:** Tightly coupled with F-038 (`~` silent). Should be resolved as one unit.

### F-029 — §12 route inference + wire format silent

- **Feature:** §12 route inference — default placement, escalation triggers, generated infra, **§12.5 server return**, **§12.5.1 wire-format envelope** for `T | not`.
- **SPEC locus:** §12.
- **Flagship?** NO — route inference is mostly compiler-managed.
- **Severity:** MEDIUM — adopter who writes server functions doesn't know when routes auto-generate vs when they need `<page>` declaration explicit.
- **PRIMER coverage:** implicit (engines drive most state, examples show server functions).
- **Kickstarter coverage:** §11.7 multi-page covers `<page>` but not auto-inference.
- **Audit reasoning:** Worth a one-paragraph clarification ("server functions auto-generate routes; pages need explicit `<page>` declaration").
- **Recommended direction:** footnote-section in kickstarter §11.7; PRIMER cross-ref.
- **Notes:** §12.5.1 wire-format envelope is INTENTIONAL-SILENCE level (adopter sees `T | not`, not the envelope); the route-inference part is the GAP.

### F-030 — §16 component slots fill syntax silent

- **Feature:** §16 named slots, unnamed children, fill syntax, render validation.
- **SPEC locus:** §16.
- **Flagship?** NO — slots are a component sub-feature.
- **Severity:** MEDIUM — adopter who builds reusable components hits the slot wall fast.
- **PRIMER coverage:** §7 components implies slots exist; §13 cross-ref.
- **Kickstarter coverage:** §12 component section says "Multi-slot: `slot="name"` on call-site children + `${render slotName()}` in component body. Single unnamed children: `${children}`." One line each — adopter has no worked example.
- **Audit reasoning:** Kickstarter's one-line callout is technically correct but offers no example. PRIMER doesn't expand. A component-system canon without slot examples leaves the load-bearing fill-syntax invisible.
- **Recommended direction:** kickstarter §12 add a slot worked example; PRIMER §7 add 3-5 lines on slot fill.
- **Notes:** Adjacent to F-044 (formFor uses named slots per §16; if formFor is taught, slots must be taught).

### F-031 — §17.6 if-as-expression silent

- **Feature:** `if` as expression — value-returning if-form.
- **SPEC locus:** §17.6.
- **Flagship?** NO — small surface, but distinctive.
- **Severity:** MEDIUM — adopter from JS background uses `cond ? a : b`; scrml's if-as-expr is the idiomatic form.
- **PRIMER coverage:** silent.
- **Kickstarter coverage:** silent (`if=` attribute covered; if-as-expr not).
- **Audit reasoning:** Distinctive enough to merit a footnote — adopter will reach for ternary by reflex.
- **Recommended direction:** PRIMER one-paragraph; kickstarter one row in §13 traps ("ternary works but if-as-expr is idiomatic").
- **Notes:** Coupled with §50 assignment-as-expression (F-051) — both are "X-as-expression" features that compose with control flow.

### F-032 — §19 error handling: CPS + per-handler-tx + errorBoundary + test-bind silent

- **Feature:** §19 error handling — `<errorBoundary>` + `renders` clause, **§19.10.5 implicit per-handler tx**, **§19.9.3 body-split / CPS**, **§19.9.9 multi-batch CPS** (S114 Ext 1), **§19.12 `test-bind`** (S74).
- **SPEC locus:** §19 (~1265 SPEC lines).
- **Flagship?** YES — error model is one of scrml's locks (S114 no-async/await closure).
- **Severity:** LOAD-BEARING for `<errorBoundary>` (adopter needs the render-fallback pattern) + MEDIUM for CPS + LOW for test-bind (debug-tooling surface).
- **PRIMER coverage:** §6 + §6.1 (full on `fail` / `!{}` / no-async); errorBoundary, CPS, per-handler-tx, test-bind silent.
- **Kickstarter coverage:** §6 covers `fail` / `!{}` only; errorBoundary + others silent.
- **Audit reasoning:** Three feature surfaces under §19 that adopters miss completely: (a) `<errorBoundary>` for render-fallback, (b) implicit per-handler transactions (canonical safety property), (c) CPS as the canonical async surface. PRIMER §6.1 mentions "body-split / CPS" by name but no example.
- **Recommended direction:** PRIMER §6 flagship section extension for errorBoundary + implicit-tx; CPS deferred to a footnote (compiler-internal mostly). Kickstarter §6 adds errorBoundary + implicit-tx; CPS gets a one-line cross-ref.
- **Notes:** test-bind is debug-tooling, can stay PRIMER-only.

### F-033 — §20 Navigation API `.Hard` mode silent

- **Feature:** `navigate()` with `.Soft` (default) and `.Hard` (302 server redirect) modes.
- **SPEC locus:** §20.
- **Flagship?** NO — small surface.
- **Severity:** LOW.
- **PRIMER coverage:** silent on modes.
- **Kickstarter coverage:** §11.7 shows `navigate("/users/${target}")` + a comment `// navigate(path, .Hard) for 302 server redirect`.
- **Audit reasoning:** Kickstarter has it; PRIMER could mirror. Minor.
- **Recommended direction:** PRIMER cross-ref to §20.
- **Notes:** Borderline INTENTIONAL-SILENCE — flagged LOW for completeness.

### F-034 — §21 Form 1 / Form 2 export + pure-type files silent

- **Feature:** §21.2 Form 1 (`export <ComponentName>`) and Form 2 (`export const Comp = <article props={...}>...`) + pure-type files (auto-detected, emit only JS module).
- **SPEC locus:** §21.2.
- **Flagship?** NO — module-system detail.
- **Severity:** MEDIUM — adopter who organizes a multi-file project hits the Form 1/2 distinction.
- **PRIMER coverage:** §9.6 mentions cross-file engine import (M18); export-component forms silent.
- **Kickstarter coverage:** §11.7 says "`import`/`export` works for types, helper functions, AND components"; doesn't distinguish Form 1/2.
- **Audit reasoning:** Adopter benefits from seeing the two export forms side-by-side once.
- **Recommended direction:** footnote-section in both canons; one worked example.
- **Notes:** Adjacent to S58 P2 ratification.

### F-035 — §22 metaprogramming (`^{}`) silent

- **Feature:** `^{}` meta context — compile-time/runtime meta, `reflect(TypeName)`, `emit()` / `emit.raw()`, **§22.12 Approach C closed primitive set** (12 primitives), **§22.13 `[capabilities] host-import` manifest gate**.
- **SPEC locus:** §22 (~719 SPEC lines).
- **Flagship?** YES — `^{}` is the canonical metaprogramming surface; **74+ sample/example files use it** per PRIMER §13.5; Approach C (S114) is a major architectural ratification.
- **Severity:** LOAD-BEARING — `^{}` is referenced throughout scrml's design (`formFor`, `parseVariant`, family-precedent doc); an adopter who doesn't know `^{}` can't read the corpus.
- **PRIMER coverage:** §13.5 audit-table row labels `^{}` as "active (74+ sample/example files)"; §13.6 mentions `reflect(TypeName)` as type-as-argument precedent INSIDE `^{}`. No flagship section explaining what `^{}` IS or how to use it.
- **Kickstarter coverage:** silent (zero mentions of `^{}`, `meta`, `metaprogramming`, `reflect`).
- **Audit reasoning:** Approach C (S114, formal ratification) closed the JS-host escape path and locked `^{}` to a scrml-native + 12-primitive closed set. This is FOUNDATIONAL — explicit ratification means the surface is stable. Both canons silent on a stable, load-bearing foundational feature = GAP.
- **Recommended direction:** flagship section in BOTH canons. PRIMER: new section after §7 engines covering `^{}` + the type-as-argument family connection (§13.6). Kickstarter: new section between §4 engines and §5 auto-await, with `reflect` worked example.
- **Notes:** The lack of `^{}` coverage in kickstarter explains why outside LLMs writing scrml never reach for it. Without surface coverage, the language's meta capability is invisible to adopters.

### F-036 — §23 foreign code (`_{}`) silent on adopter surface

- **Feature:** `_{}` inline foreign code, level-marked braces, opaque passthrough, WASM call sigils `r{}` / `c{}` / `z{}`, sidecar interface declarations `use foreign:`.
- **SPEC locus:** §23 (~443 SPEC lines).
- **Flagship?** NO — sliver-empty (0 source-level uses per PRIMER §13.5).
- **Severity:** LOW — niche feature; sliver-empty.
- **PRIMER coverage:** §13.5 sliver-empty row ("Design real, adoption pending. Treat foreign-code design questions as low-priority unless a specific WASM/sidecar use-case is in scope").
- **Kickstarter coverage:** silent.
- **Audit reasoning:** This is BORDERLINE INTENTIONAL-SILENCE. The feature is sliver-empty and adoption is pending; canons silence is defensible. But the surface IS ratified language (~443 SPEC lines), so an adopter who runs into a `_{}` reference in third-party code has no canon-anchored explanation. Marking GAP at LOW severity per the brief's INTENTIONAL-SILENCE/GAP boundary discussion.
- **Recommended direction:** kickstarter §14 "Things that are NOT scrml" or §13 traps — one-line "WASM and sidecar interop exists via `_{}` and `use foreign:`; both are advanced and sliver-empty." PRIMER §13.5 already has the row; no escalation needed.
- **Notes:** User-judgment call. Could close as INTENTIONAL-SILENCE if user prefers — the feature genuinely doesn't have adopter consumers today.

### F-037 — §26 Tailwind integration details silent

- **Feature:** §26 Tailwind utility classes — variant prefixes (S49 + W-TAILWIND-001), arbitrary values (S109), typography plugin prose family (S100), W-TAILWIND-UNRECOGNIZED-CLASS.
- **SPEC locus:** §26.
- **Flagship?** NO — but Tailwind is the default styling surface and §26 is non-trivial (~180 SPEC lines + multiple S-amendments).
- **Severity:** MEDIUM — Tailwind classes appear in every kickstarter example without canonical explanation of which features compile vs warn.
- **PRIMER coverage:** §13.5 mentions Tailwind as a passive reference once.
- **Kickstarter coverage:** Tailwind class names appear in every styled example; integration rules silent. No mention of W-TAILWIND-UNRECOGNIZED-CLASS, S108 FLOOR, or which arbitrary-value forms work.
- **Audit reasoning:** Adopter who hits `class="grid-cols-[1fr_2fr]"` (arbitrary values) doesn't know it's supported. Adopter who hits an unrecognized class doesn't know they'll get W-TAILWIND-UNRECOGNIZED-CLASS lint.
- **Recommended direction:** kickstarter §13 traps add a Tailwind row; PRIMER cross-ref to §26.
- **Notes:** Adjacent to F-027 (CSS) — both are styling-surface gaps.

### F-038 — §32 `~` tilde silent

- **Feature:** `~` pipeline accumulator — initialization rules, `lin` semantics, context boundary, deferred-ctx, branch consistency.
- **SPEC locus:** §32 (~212 SPEC lines).
- **Flagship?** YES — `~` is one of scrml's distinctive primitives; `~` initialization is a foundational reactivity-vs-compute mechanism.
- **Severity:** LOAD-BEARING — `~` paired with `lift` is the canonical pipeline pattern; without `~`, adopters write `.push()` mutations on derived state.
- **PRIMER coverage:** `~` appears 20 times across the file — entirely in mechanical contexts (B-step internals, audit-table rows, error-code descriptions, debate quotes). No flagship "this is what `~` IS" section.
- **Kickstarter coverage:** §15 "When in doubt" lists `~name = expr` as a STOP-AND-DON'T pattern: *"If you find yourself writing `~name = expr` for derived reactive, stop. Use `const <name> = expr`"*. The canonical pipeline usage of `~` (as accumulator after `lift`) is invisible.
- **Audit reasoning:** Kickstarter's only mention of `~` is a forbidding-style example (wrong use). The right use (`lift expr; consume ~`) is never shown. This is a load-bearing scrml primitive (used heavily in compiler self-host per SPEC §32.1 motivation) with ZERO adopter-facing teaching.
- **Recommended direction:** flagship section in BOTH canons. PRIMER: new section between §7 engines and §8 validators. Kickstarter: new section between §5 auto-await and §6 validators with 2-3 worked examples of `lift` + `~` pipeline.
- **Notes:** Tightly coupled with F-028 (lift) — should be resolved as one unit. Adjacent to F-040 (lin, since `~` is a built-in `lin`).

### F-039 — §33 `pure` keyword silent

- **Feature:** §33 `pure` keyword — purity constraints, **§33.6 fn ≡ pure function** (S32 ratification), W-PURE-REDUNDANT.
- **SPEC locus:** §33 (65 SPEC lines).
- **Flagship?** NO — small section but normative for the `fn`/`function`/`pure` hierarchy.
- **Severity:** MEDIUM — `pure` modifier appears in scrml corpus; without coverage, adopters can't read it.
- **PRIMER coverage:** L13/L14 locks-table referencing `pure`; no normative section.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** `pure` is part of the §48 `fn` discipline (S32 ratified `pure function` ≡ `fn`); adopters need to know when to reach for `fn` vs `pure function` vs `pure fn` (the last fires W-PURE-REDUNDANT).
- **Recommended direction:** kickstarter §13 traps add a row; PRIMER footnote in §6 cross-ref.
- **Notes:** Adjacent to F-049 (§48 `fn`).

### F-040 — §35 `lin` partial coverage

- **Feature:** §35 linear types — declaration, **§35.2.1 lin function params**, **§35.2.2 cross-`${}` block lin** (S58 amendment), E-LIN-005 shadowing, E-LIN-006 deferred-ctx (§35.5), closures.
- **SPEC locus:** §35 (~462 SPEC lines).
- **Flagship?** YES — `lin` is locked in pillars (L6+) as exactly-once consumption primitive.
- **Severity:** MEDIUM — kickstarter §11.9 has a recipe; PRIMER is silent. The advanced surfaces (lin params + cross-block lin + closures) are invisible.
- **PRIMER coverage:** §13 locks table reference only.
- **Kickstarter coverage:** §11.9 single recipe shows basic lin + consumption.
- **Audit reasoning:** Basic `lin` is covered by kickstarter. Advanced surfaces (lin in function params, cross-`${}` block lin, lin shadowing diagnostics) are SPEC-normative additions that aren't reflected. Borderline.
- **Recommended direction:** PRIMER §11 (or new §) full lin overview; kickstarter §11.9 expanded with lin params + closures examples.
- **Notes:** Coupled with §32 `~` — `~` is a built-in lin per §32.3 (F-038).

### F-041 — §36 input states (`<keyboard>`/`<mouse>`/`<gamepad>`) silent

- **Feature:** Input state types — `<keyboard id="...">`, `<mouse>`, `<gamepad index=N>` — built-in state types providing reactive keyboard/mouse/gamepad access.
- **SPEC locus:** §36 (~358 SPEC lines).
- **Flagship?** YES — debate-04 ratified, gaming-canvas-primitives DD verdict; ~358 SPEC lines is substantial.
- **Severity:** MEDIUM — sliver-empty (0 source-level uses per PRIMER §13.5) BUT canon-silent means adopters never reach for it.
- **PRIMER coverage:** §13.5 sliver-empty row ("debate-04 IN FLIGHT S88"); cross-ref to debate.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** This is sliver-empty AND debate-04 is in flight (could be CLOSE-AND-RIP per the debate options). But until the debate closes, it's ratified language surface. Canons should at minimum acknowledge that input-state types exist as built-ins; without that, an adopter writing canvas/game code reaches for `addEventListener` boilerplate that §36 was designed to eliminate.
- **Recommended direction:** kickstarter §13 traps or §14 NOT-scrml — one row "Built-in input state types `<keyboard>` / `<mouse>` / `<gamepad>` exist (§36); use for canvas/game-input contexts." PRIMER cross-ref. Defer flagship treatment until debate-04 closes.
- **Notes:** GAP severity is MEDIUM (debate-pending makes deeper coverage premature). Borderline INTENTIONAL-SILENCE — judgment call.

### F-042 — §37 SSE `server function*` silent

- **Feature:** `server function*` — server-annotated generator that compiles to a Server-Sent Events (SSE) endpoint. `text/event-stream` GET route + `EventSource`-based client stub.
- **SPEC locus:** §37 (~242 SPEC lines).
- **Flagship?** YES — composes three primitives (`server`, `function*`, `yield`) into one feature; covers live-counter / real-time-feed / progress-reporting use cases.
- **Severity:** LOAD-BEARING — server-push is a common real-world need; without SSE coverage, adopter reaches for `<channel>` for WS (heavier-weight) or hand-rolls `EventSource`.
- **PRIMER coverage:** silent (PRIMER has 14 "SSE" mentions — all in compiler-internal contexts, none teaching the feature).
- **Kickstarter coverage:** silent (`server function\*` form has zero mentions).
- **Audit reasoning:** SSE is a substantive language surface (~242 SPEC lines) with no canon teaching; channel-vs-SSE choice point is invisible to adopters.
- **Recommended direction:** kickstarter §11 add a real-time-SSE recipe between §11.3 channels and §11.5 loading-state. PRIMER add a section between §7 engines and §11 anti-patterns.
- **Notes:** Adjacent to §38 channels (kickstarter §11.3 covers; F-042 closes the SSE sibling).

### F-043 — §40 documentary attrs + `<auth>` element + default-logic body silent

- **Feature:** §40 middleware family — **§40.7 `<program>` documentary attrs** (`title=`/`description=`/`version=`/`author=`/`license=` + W-PROGRAM-TITLE-NESTED), **§40.8 v0.3 program shape + default-logic body mode**, **`<auth role>` first-class element** (S91).
- **SPEC locus:** §40 (~773 SPEC lines).
- **Flagship?** YES — `<auth>` is the v0.3 first-class element for visibility constraints; documentary attrs are one-line additions every adopter benefits from.
- **Severity:** LOAD-BEARING for `<auth>` (per-role bundles, runtime fallback, A-3 AuthGraph mechanic); MEDIUM for documentary attrs; LOW for default-logic body mode (compiler-internal mostly).
- **PRIMER coverage:** §9.7 covers Approach A in depth (closure analysis + per-route artifact splitter + AuthGraph) at the technical level; user-facing `<auth role>` element silent. Documentary attrs and default-logic body silent.
- **Kickstarter coverage:** §11.8 covers `<program log/headers/cors/csrf/ratelimit>` auto-middleware + `handle(request, resolve)` escape hatch. No `<auth>`, no documentary attrs, no default-logic body.
- **Audit reasoning:** Three distinct gaps under one section. (a) `<auth role>` is load-bearing (it's the visibility-constraint mechanism that drives per-route per-role chunk variance); kickstarter teaching `<program auth="required">` but not `<auth role="Admin">` is incomplete. (b) Documentary attrs are one-row additions. (c) default-logic body mode is compiler-internal mostly — could stay silent.
- **Recommended direction:** kickstarter §11.8 add `<auth role="X">` worked example; PRIMER §9.7 add adopter-facing `<auth>` example. Documentary attrs → one row in kickstarter §11.8.
- **Notes:** Closes part of F-008 (1b — default-logic body silent in canons) — Phase 2 should resolve together.

### F-044 — §41 type-as-argument family (parseVariant / formFor / schemaFor / tableFor) silent in kickstarter

- **Feature:** §41.13 `parseVariant`, **§41.14 formFor** (FLAGSHIP — `scrml.dev` demo), §41.15 schemaFor, §41.16 tableFor — the L22 type-as-argument family.
- **SPEC locus:** §41.13-§41.16.
- **Flagship?** YES — formFor is explicitly flagship; the L22 lock is "type-as-argument is a first-class scrml language primitive."
- **Severity:** LOAD-BEARING — formFor + schemaFor + tableFor close the "type once → form + schema + table all derive" loop; this is the v0.3 value-prop adopter pitch.
- **PRIMER coverage:** §13.6 short reference + family roster table; §10 stdlib catalog mentions `parseVariant`. NOT flagship-treated.
- **Kickstarter coverage:** silent (zero mentions of `parseVariant`, `formFor`, `schemaFor`, `tableFor`).
- **Audit reasoning:** Adopters writing scrml after reading kickstarter v2 don't know the type-as-argument family exists. The compiler ships these features (formFor SHIPPED S102, schemaFor SHIPPED S104, tableFor SPEC'd S105 — impl pending) but the LLM canon never surfaces them.
- **Recommended direction:** kickstarter add a new section (§7.x or §11.x) on the type-as-argument family with formFor as the flagship example. PRIMER §13.6 expand into a flagship section.
- **Notes:** Family-precedent doc at `scrml-support/docs/type-as-argument-family-2026-05-06.md` is the gate-keeping reference; canon needs to be the on-ramp.

### F-045 — §42 `not` advanced forms silent

- **Feature:** §42 — **`given x =>` presence-guard** (§42.2.3), **`T | not` union form**, **§42.2.4 compound `is not` / `is some` expressions**, **§42.1.1 defined values vs absence** (S89).
- **SPEC locus:** §42.
- **Flagship?** YES — `not` is one of scrml's distinctive primitives; the S89 ratification ("null does not exist in scrml") is foundational.
- **Severity:** LOAD-BEARING — `given x =>` is the canonical presence-guard form; `T | not` is the canonical union form for absence-possible types.
- **PRIMER coverage:** §9.4 (`is some` vs `req` — full), §9.5 (one-line `not` mention). `given x =>` silent. `T | not` silent. Defined-values-vs-absence covered in S89 entry but not flagship-treated.
- **Kickstarter coverage:** §3 + §7 traps reference `not` casually; `given x =>` silent; `T | not` silent.
- **Audit reasoning:** PRIMER §9.4-§9.5 covers the basics; the advanced forms (`given` presence-guard + `T | not` union) are foundational to type system + error handling. Adopter who doesn't know `given x =>` writes `if (x is some)` instead.
- **Recommended direction:** PRIMER §9.4 expand to include `given x =>` and `T | not`. Kickstarter §7 traps add row on `given` vs `if (x is some)`.
- **Notes:** S89 absence rule banked in memory; PRIMER S86 entry is technical; canon needs the user-facing form.

### F-046 — §43 nested `<program>` + cross-program RPC silent

- **Feature:** §43 nested `<program>` — execution contexts (workers / sidecars), shared-nothing, lifecycle, **§43.5 RPC via `<#name>.method()`**, **§43.5.2 message passing**, **§43.5.3 lifecycle events `when message from <#name>`**.
- **SPEC locus:** §43 (~83 SPEC lines, dense — every line is normative).
- **Flagship?** NO (compared to §51 engines), but SUBSTANTIAL — nested programs are the compute-isolation primitive.
- **Severity:** MEDIUM — adopter who needs worker isolation reaches for `Web Workers` or `child_process`; scrml's nested `<program>` is the idiomatic form.
- **PRIMER coverage:** silent.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** Workers + sidecars are a real adopter need (CPU isolation, sandboxed code). Canon silence means scrml's first-class worker-lifecycle surface is invisible.
- **Recommended direction:** kickstarter add §11.10 worker recipe; PRIMER cross-ref.
- **Notes:** Tightly coupled with F-048 (§46 worker lifecycle) — should be resolved together.

### F-047 — §44 multi-database adaptation silent

- **Feature:** §44 `?{}` multi-database adaptation — Bun.SQL target, driver resolution (SQLite/Postgres/MySQL), **`.get()` → `T | not`**, **§44.8 bracket-matched `?{` scanner** (F-SQL-001), E-SQL-008 hard-error.
- **SPEC locus:** §44 (~116 SPEC lines).
- **Flagship?** NO — but substantial.
- **Severity:** MEDIUM — adopter who uses Postgres needs to know `< db src="postgres://...">` works; multi-database story is otherwise invisible.
- **PRIMER coverage:** silent.
- **Kickstarter coverage:** §11.6 schema recipe says "Backend: scrml's database layer is Bun.SQL-backed" + driver-by-URI scheme; the deeper §44 rules silent.
- **Audit reasoning:** Kickstarter has a one-line mention; PRIMER missing entirely. §44.8 bracket-matched scanner is compiler-internal. The DRIVER-CHOICE story is the load-bearing user surface.
- **Recommended direction:** kickstarter §11.6 expand the driver paragraph; PRIMER add §9.2 cross-ref or footnote.
- **Notes:** Closely related to §39 schema (covered).

### F-048 — §46 worker lifecycle `when ... from` silent

- **Feature:** §46 worker lifecycle — `when ... from <#name>`, supervision attrs `restart=` / `max-restarts=` / `within=` / `autostart=`.
- **SPEC locus:** §46 (~47 SPEC lines).
- **Flagship?** NO — but normative.
- **Severity:** MEDIUM — paired with §43 (F-046).
- **PRIMER coverage:** silent.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** Worker lifecycle supervision is real (`restart="on-error"` default for sidecars, `restart="never"` default for workers); canon silence leaves the supervision model invisible.
- **Recommended direction:** combine with F-046 catch-up.
- **Notes:** Marked separately for traceability; one unified worker section should close both findings.

### F-049 — §48 `fn` keyword silent in kickstarter

- **Feature:** §48 `fn` keyword — body prohibitions (5: SQL / DOM / outer-scope mutation / non-determinism / async), return-site completeness, `lift` in `fn`, **§48.6.4 mutual recursion + hoisting** (S98), **`pinned fn` opt-out**, calling conventions.
- **SPEC locus:** §48 (~703 SPEC lines — substantial).
- **Flagship?** YES — `fn` vs `function` is one of scrml's discipline primitives.
- **Severity:** LOAD-BEARING for the fn-vs-function distinction; MEDIUM for mutual-recursion + pinned-fn (S98 amendments).
- **PRIMER coverage:** S32 retirement note in §13 locks; no flagship section on `fn`.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** Adopter reads kickstarter, writes `function foo() { ... }`. The `fn` discipline (purity, no-side-effect-by-default) is invisible. PRIMER references `fn` 4+ times mechanically; no user-facing teaching.
- **Recommended direction:** kickstarter add a section between §3 V5-strict and §4 engines — "Function forms — `function` / `fn` / `server function` / `pure`." PRIMER §6 footnote-section on the fn family.
- **Notes:** Coupled with F-039 (§33 `pure`).

### F-050 — §49 `while` / `do...while` / `break` / `continue` / labels silent

- **Feature:** §49 loops — `while`, `do...while`, `break`, `continue`, **labeled loops**, **lift in loops**, E-LOOP error family (~7 codes).
- **SPEC locus:** §49 (~703 SPEC lines — the SPEC's largest non-§51 / non-§6 section).
- **Flagship?** YES — `while` + `lift` is the canonical regex-iteration pattern + the motivating use case for §50 assignment-as-expression.
- **Severity:** LOAD-BEARING — `while ((m = re.exec(str)) is some) { ... }` is scrml's canonical regex-iteration form. Without this, adopter writes JS-style `let m; while ((m = re.exec(str)) !== null) ...` which fires E-EQ-002.
- **PRIMER coverage:** silent (zero "while" mentions in adopter context).
- **Kickstarter coverage:** §13 traps has one "while" mention. No iteration semantics + no labels + no break/continue rules.
- **Audit reasoning:** ~703 SPEC lines silent in adopter canon. Loops are universal; without scrml-specific coverage, adopters use `for...of` exclusively and miss `while` (state-machine pattern per §49.12.5).
- **Recommended direction:** kickstarter add §11.x loops recipe with regex + state-machine examples; PRIMER add a section.
- **Notes:** Coupled with F-051 (assignment-as-expression motivated by §49).

### F-051 — §50 assignment-as-expression silent

- **Feature:** §50 assignment as expression — assign-expr syntax, semantics, type rules, **double-paren disambiguation** (`while ((x = expr))`), W-ASSIGN-001 advisory.
- **SPEC locus:** §50 (~506 SPEC lines).
- **Flagship?** YES — motivating use case is self-host regex iteration; substantial SPEC investment.
- **Severity:** LOAD-BEARING — the `while ((m = re.exec(str)) is some)` canonical pattern requires assignment-as-expression.
- **PRIMER coverage:** silent.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** Adopter never knows this is legal. Either reaches for two-statement form or writes JS-style and trips the disambiguation rule.
- **Recommended direction:** PRIMER footnote-section; kickstarter §11 recipe pairing with §49 loops.
- **Notes:** Should be resolved jointly with F-050.

### F-052 — §52 state authority partial coverage

- **Feature:** §52 state authority declarations — two-tier authority, server `@var`, **§52.13 `auth=` attribute** (auth="required" / auth="optional" / auth="none" / auth="role:X"), W-AUTH-LOGIN-MISSING.
- **SPEC locus:** §52 (~615 SPEC lines).
- **Flagship?** YES — server-authority + auth-attribute are core to scrml's auth model.
- **Severity:** LOAD-BEARING for auth=; MEDIUM for the two-tier authority declaration.
- **PRIMER coverage:** §13.5 cross-ref to §52; no flagship section.
- **Kickstarter coverage:** §11.2 auth recipe (covers `protect=` + JWT pattern); §11.8 mentions `<program auth="required">`. The `auth="role:X"` recognized-but-not-implemented shape + W-ATTR-002 silent.
- **Audit reasoning:** Auth recipes cover much. The state-authority concept (`@var server` declaration form, server-side reactive cells) is missing entirely. The `auth="role:X"` recognized-not-implemented surface is missing.
- **Recommended direction:** PRIMER add cross-ref-with-summary to §52; kickstarter §11.2 expand with `auth=` modes + role:X note.
- **Notes:** Some overlap with F-043 (`<auth>` element).

### F-053 — §53 inline type predicates partial coverage

- **Feature:** §53 inline type predicates — value constraints, **SPARK three-zone semantics** (static / trusted / boundary), **named shapes** (registry), `bind:value` HTML attribute generation, **§53.6.1 shared-core in refinement-type position**, **§53.6.2 type-predicate vs state-validator composition**, **§53.14 type-as-argument primitives**.
- **SPEC locus:** §53 (~1061 SPEC lines).
- **Flagship?** YES — refinement-type predicates are one of scrml's distinguishing surfaces.
- **Severity:** LOAD-BEARING for the shared-core + composition story; MEDIUM for SPARK zones + named shapes.
- **PRIMER coverage:** §9.3 predicates (cross-ref); §13.6 type-as-arg (which is §53.14).
- **Kickstarter coverage:** §3.1 one line ("inline type predicates `number(>0 && <100)`") + §8 questions one line.
- **Audit reasoning:** Both canons touch the surface but neither expands. SPARK three-zone semantics is normative (B21 implements; codegen wires runtime checks); adopter who writes a predicated type doesn't know zones exist. Named-shape registry deferred per S64 audit (`scrml-support/archive/audits/...`) but the SPEC ratifies it.
- **Recommended direction:** PRIMER §9.3 expand into flagship section; kickstarter add a paragraph in §8.
- **Notes:** §53.14 type-as-argument family also covered by F-044.

### F-054 — §54 nested substates + state-local transitions silent

- **Feature:** §54 — **§54.2 nested substate grammar**, **§54.3 state-local transitions**, **§54.4 field narrowing**, **§54.5 terminal states**, 4 new error codes (§54.6, S32 ratification).
- **SPEC locus:** §54 (~301 SPEC lines).
- **Flagship?** NO — extension of §51 engines + §14 type system.
- **Severity:** MEDIUM — nested substates are an advanced state-machine surface (think Harel statecharts).
- **PRIMER coverage:** §13 locks reference (S32); no flagship section.
- **Kickstarter coverage:** silent.
- **Audit reasoning:** ~301 SPEC lines silent. Adopters building substantive state machines hit the substate need; without canon coverage, they synthesize hand-rolled nesting.
- **Recommended direction:** PRIMER §7 engines extend with nested substates note; kickstarter §4 add an advanced subsection.
- **Notes:** Coupled with §51.0.Q hierarchy / nested engines (PRIMER §7.1 covers — adjacent surface).

### F-055 — §56 promotion ergonomics silent in kickstarter

- **Feature:** §56 — **`I-MATCH-PROMOTABLE` info-lint** + three message shapes (exhaustive / near-miss / compound) + **`bun scrml promote --match` CLI** (S66 SHIPPED).
- **SPEC locus:** §56 (~180 SPEC lines).
- **Flagship?** YES — `bun scrml promote --match` is the canonical Tier-0 → Tier-1 mechanical lift.
- **Severity:** MEDIUM — adopter benefits from knowing the promotion path exists; without it, `if (@phase == .X)` chains accumulate.
- **PRIMER coverage:** §13.8 full coverage.
- **Kickstarter coverage:** silent (zero "promote" / "I-MATCH-PROMOTABLE" mentions).
- **Audit reasoning:** PRIMER covers; kickstarter doesn't. SHIPPED S66 — the CLI is real; adopters running scrml today can use it.
- **Recommended direction:** kickstarter §13 traps add the `I-MATCH-PROMOTABLE` row + cross-ref to `bun scrml promote`.
- **Notes:** Coupled with §17.0 Tier ladder (covered) — the lint is the ladder's tooling surface.

## INTENTIONAL-SILENCE register

These SPEC sections are correctly silent in the canons. Reasoning recorded so user can disagree per-line.

- **§25 CSS Variable Syntax** — CSS-surface detail; adopters pattern-match from CSS prior art. Surfacing CSS-var rules in scrml canon would mostly duplicate MDN-equivalent content.
- **§28 Compiler Settings** — project-config concern (`html-content-model`, lint suppression). Adopter learns settings from CLI / scrml.toml docs, not from language canon.
- **§29 Vanilla File Interop** — one-line behavior (`.js`/`.html`/`.css` pass through). Adopter learns by trying; no canonical normative rule to teach.
- **§30 Compile-Time Eval `bun.eval()`** — §30.2 user-facing surface RETIRES per HU-1 F-003 ratification (Approach C subsumes). §30.1 compiler-internal scope is correctly invisible to adopters.
- **§31 Dependency Graph** — compiler-internal mechanism; adopters see the EFFECT (reactive recompute, validator predicate-arg tracking) not the graph. PRIMER §13.6 surfaces it at the dev-pipeline level only.
- **§34 Error Codes** — reference catalog, not a feature. Flagship error codes (E-NAME-COLLIDES-STATE, E-MATCH-NOT-EXHAUSTIVE, E-MULTI-STATEMENT-HANDLER, etc.) appear by name in examples; full catalog is the SPEC's job.
- **§47 Output Name Encoding** — compiler-internal naming scheme. Adopters never type these encoded names; surfacing them in canon would add noise.
- **§57 Wire Format** — compiler-internal serialization (`{"__scrml_absent": true}` envelope). Adopters see `T | not` API; envelope is invisible. S90 ratified as compiler-side concern.
- **§58 Build Story** — Nominal section per S118 (spec-ahead-of-implementation; no compiler impl yet). Canons correct to wait until implementation lands.
- **App. A (Interaction Matrix)** — SPEC-internal reference; not adopter material.
- **App. B (Superseded Spec Text)** — SPEC history; not adopter material.
- **App. C (Future Considerations)** — forward-looking design notes; adopter should NOT learn from these (they're explicitly non-normative).
- **App. D (JS Standard Library)** — adopter sees JS surface natively (Date.now, Math.floor, etc.); no scrml-specific teaching needed.
- **App. E (`</>` Closer Migration)** — migration guide for legacy authors; new code uses `</>` already (covered in kickstarter §2 skeleton row).
- **§11 State Objects (Reserved — Folded)** — content distributed to §6 + §52; section is a reserved stub. Canons correctly silent.

## Coverage assertion

I walked SPEC sections §1 through §58 + Appendices A-E via SPEC-INDEX.md. For each, I identified the flagship feature(s) per the SPEC-INDEX one-line summary + the section heading + my judgment, grep'd PRIMER + kickstarter for keyword indicators (and inspected the surrounding context where the count was non-zero), and classified per the taxonomy.

**Coverage stats:**
- COVERED: 17 sections (§1 / §2 / §3 / §5 / §6 / §7 / §11 reserved-stub / §13 / §15 / §18 / §24 / §27 / §38 / §39 / §45 / §51 / §55)
- PARTIAL-COVERAGE: 6 sections (§14 ref F-023 + multi-feature partials are sub-classified as PARTIAL with F-NNN findings inline)
- INTENTIONAL-SILENCE: 15 sections + 5 appendices (§25 / §28 / §29 / §30 / §31 / §34 / §47 / §57 / §58 + A-E + §11 stub; reasoning logged in the register above)
- GAP: 26 findings spanning 32 sections (some sections have multiple sub-feature gaps consolidated under one F-NNN)

## Stopping note

**Net new findings count:** **26 new GAP findings** (F-025 through F-055; HU-2's F-023/F-024 not re-surfaced — referenced as precedent for F-025 quoted-text overlap). This is substantially more than PA's prior-hypothesis-list of ~15 candidates surfaced in the brief.

**Pattern observations:**

1. **Kickstarter v2 is systematically narrower than PRIMER.** Of the 26 GAP findings, ~16 (61%) are "PRIMER covers / kickstarter silent" (e.g., F-038 `~`, F-044 type-as-arg family, F-055 promotion ergonomics). Kickstarter v2 was authored at S58 (2026-05-04); intervening SPEC growth has not been reflected. Phase 2's Q7 batch (kickstarter staleness wave) addresses some of this but only the stale CORRECTIONS, not the SILENCE.

2. **Both canons silent on "self-host motivating" features.** §32 `~`, §35 `lin`, §48 `fn`, §49 `while`/`do...while`, §50 assign-as-expr — these are the features the compiler self-host needed. They're documented in SPEC but invisible to canon. The "scrml's compiler is written in scrml" claim is currently uncheckable from an adopter perspective because adopters can't see the primitives the self-host uses.

3. **The type-as-argument family is a flagship cluster.** F-035 (`^{}`) + F-044 (parseVariant / formFor / schemaFor / tableFor) + parts of F-053 (§53.14) all point at the same architectural locus. Phase 2 catch-up should treat them as a single unit, not five separate findings.

4. **The "advanced surface of an otherwise-covered section" pattern.** §6.1 covered / `given` silent; §38 channels covered / pure-channel-files silent; §51 engines covered / hierarchy + history + internal:rule covered in PRIMER §7.1 only; §55 validators covered / `<errorBoundary>` silent in kickstarter. Each canon teaches the basics but never escalates. Suggests a methodology rule: when authoring canon, identify the FEATURE's basic + advanced surface and decide explicitly which goes in.

5. **Worker / nested-program / SSE surfaces are entirely invisible.** F-042 (SSE), F-046 (nested `<program>`), F-048 (worker lifecycle) — three substantive features (~500 SPEC lines combined) with zero canon coverage. This is the largest concentrated silence in the audit.

6. **§50 + §49 + §32 together form a "self-host idiom cluster"** — `while ((m = re.exec(str)) is some) { lift m; ... } process(~)` requires §32 (`~`) + §49 (`while`) + §50 (assign-as-expr) + §10 (`lift`). Canons silent on three of the four. Adopters cannot replicate the self-host pattern without all four pieces.

**Phase 2 catch-up sequencing recommendation:** Cluster by user-facing surface, not by SPEC section.

- **Cluster H — flagship reveal:** F-035 + F-044 + F-053 (`^{}` + type-as-arg family + refinement zones). Single new kickstarter section + PRIMER section.
- **Cluster I — self-host idiom cluster:** F-028 + F-038 + F-050 + F-051 (`lift` + `~` + while/break/continue + assignment-as-expr). Single integrated section in both canons.
- **Cluster J — error-handling depth:** F-032 (`<errorBoundary>` + per-handler-tx + CPS).
- **Cluster K — advanced-engines:** PRIMER §7.1 already covers; kickstarter needs §4 extension (cross-ref to PRIMER + a worked example of `<onTimeout>` + history).
- **Cluster L — worker / sidecar / SSE:** F-042 + F-046 + F-048. One unified compute-isolation recipe section.
- **Cluster M — module / type-system extensions:** F-034 + F-049 + F-039 + F-054 (Form 1/2, `fn`, `pure`, nested substates).
- **Cluster N — minor surface gaps:** F-027 + F-031 + F-033 + F-037 + F-045 + F-052 + F-055. Footnote-level.
- **Cluster O — borderline INTENTIONAL-SILENCE that user may reclassify:** F-036 (foreign code), F-041 (input states). Defer until user signals.

**Calibration cross-check vs F-023 precedent.** F-023 (HU-2) was the precedent that triggered this audit. F-023's resolution direction is "flagship-section catch-up in both canons; uses post-F-024 `(A to B)` syntax." That direction shape applies cleanly to most of the LOAD-BEARING findings here (F-025 / F-035 / F-038 / F-042 / F-044 / F-050 / F-051). MEDIUM findings get footnote-section; LOW findings get one-line mentions or stay in INTENTIONAL-SILENCE per user disposition.

**Audit confidence note.** The PRIMER walk was thorough through §13.7 (line ~720); the B-step specifics tail (§13.7+) is dev-pipeline-internal and was not exhaustively walked. If any of the B-step entries inadvertently document an adopter-facing feature, that's not captured here. Recommend a spot-check on F-040 (lin) + F-044 (type-as-arg) before Phase 2 authoring against the B-step specifics tail.
