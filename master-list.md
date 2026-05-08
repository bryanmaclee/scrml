# scrmlTS — Master List

**Purpose:** Live inventory of what exists in scrmlTS, plus the **v0.2.0 migration dashboard**. Current truth only. Historical session-by-session detail lives in `docs/changelog.md`; deep-dives live in `scrml-support/docs/deep-dives/`.

**Last updated:** 2026-05-08 (S71 close — **C1 Phase 0 SURVEY landed (verdict SCOPE-AMENDMENT-SUGGESTED, 3 amendments applied) · cross-machine scrml-support reconciliation completed · S70 hand-off accuracy gap surfaced** — 3 commits this session (1 scrml-support push + 2 scrmlTS); 0 source-code change; ready for C1 implementation dispatch pending scrml-dev-pipeline agent staging)

**Tests (current — PA-verified):** **9,734 pass / 64 skip / 1 todo / 3 fail** (full suite); ~9,028 pre-commit subset (unchanged from S70). The 3 fails are pre-existing self-host parity drift (F-BUILD-002 §3, Bootstrap L3, Self-host: tokenizer parity) — per S66 user direction, self-host is post-v1.0.0, not load-bearing for v0.2.0. **CORRECTION:** S70 hand-off recorded `9,752 / 60 / 1 / 0`; that count was incorrect — the 3 self-host fails were always present at S70 close. PA verified independently at S71 open via `bun run test`. Cumulative since S66 close: 9,090 → 9,241 (S67) → 9,425 (S68) → 9,626 (S69) → **9,734 (S70 actual; S70 hand-off was inflated)**. **S71 net delta: 0 / 0 / 0 / 0** (pure docs session). Pre-commit subset stable.

**Currently shipped baseline:** **scrml v0.1.0** (16-module stdlib, 32 examples, full SQL passthrough via Bun.SQL, LSP + VSCode + neovim editor support, server-fn boundary, `<machine>` engines, `<channel>` channels, `?{}` SQL passthrough, `<schema>` blocks, `<program>` config + wrapper, ~24,739 LOC compiler / ~14,135 LOC codegen).

**In flight:** **scrml v0.2.0** breaking-change rewrite (~297-454h focused engineering — S67 ratified extensions remain on plan: DD-Harel hierarchy + Item C temporal surface migration + Item G B-shakeable timeouts + Insight 22 test-bind, ~57-94h additional). See **§0 v0.2.0 Migration Status** below for live progress dashboard. Spec target frozen post-Stage-0b (S58) as base; S67 amendments LANDED at S68 (`1de05ef`). Phase A1+ implementation: **A1a COMPLETE · A1b FUNCTIONALLY COMPLETE (all 22 steps B1-B22 SHIPPED) · A7 parser+typer COMPLETE (A5-2 + A5-3 SHIPPED) · A1c KICKED OFF (C0 SHIPPED, C1 BRIEF READY).**

**Origin sync:** S71 close — scrmlTS 2 commits ahead of origin (`8ad94e5` + `75417fa`), push pending S71 wrap. scrml-support pushed mid-session (`c275b31`, S48 user-voice rebase reconciliation). Cross-machine pickup at S72 wants scrml-dev-pipeline agent staged on machine-A first (master inbox notice sent).

---

## §0 v0.2.0 migration status — LIVE DASHBOARD

**Spec target:** ratified 2026-05-04 (S58 close); extended at S65 (L22 type-as-argument language primitive — debate-05 verdict + Path A architectural commit; not yet recorded in v0next-s56-deliberation-outcomes.md, queued with parseVariant dispatch). 22 architectural locks (L1-L22). 20 moves (M1-M20, M7+M21 dropped). SPEC.md authoritative engineering target.

**Architecture decision (S59):** PIECEMEAL migration (not greenfield rewrite). acorn STAYS — pre-processor extension absorbs new syntax. AST extension target corrected to `kind: "reactive-decl"` (not `kind: "state"`). See `docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md` §0 for full reasoning.

### §0.1 Phase progress

| Phase | Scope | Est | Status | Notes |
|---|---|---|---|---|
| Stage 0a | Impact assessment | done | ✅ | `IMPACT-ASSESSMENT.md` (446 lines) |
| Stage 0b | SPEC + PIPELINE + INDEX rewrite | 70-127h | ✅ | D1+D2 (S57) + D3+D4 (S58) all landed |
| Stage 0b+ | L21 lock E-DERIVED-VALUE-MUTATE | done | ✅ | S59 commit `1217b41` |
| **A1 — Foundational lex/parse (A1a + A1b + A1c three-phase split)** | `<NAME> = RHS` decl recognition + Shapes 1/2/3 + Variant C; resolve+type; codegen+runtime+PIPELINE prose | **A1a 35-50h + A1b 85-120h + A1c 96-136h + Stage 0c 0c.A done; rest mostly removed** | **✅ A1a COMPLETE · ✅ A1b COMPLETE (B1-B22 all shipped) · 🟡 A1c KICKED OFF S70 (C0 SHIPPED; C1 BRIEF READY); Stage 0c.A LANDED S64; 0c.B-D REMOVED (no code to delete per S64 audit); 0c.E LANDED S64; 0c.F LANDED S64** | **A1a (lex+parse) DONE at S61 close.** All 20 sub-steps landed. **A1b (resolve+type) RATIFIED S60 · IN FLIGHT.** **B1-B6 LANDED S63-S66.** **B7-B10 LANDED S67:** B7 derived-cell dep tracking + E-DERIVED-CIRCULAR-DEP via generic `detectCycle`; B8 L21 walker E-DERIVED-VALUE-MUTATE PASS 6; B9 validator-arg ExprNode + RelationalPredicateNode AST kind; B10 three phases — predicate signature catalog + SYM PASS 7 walker E-TYPE-031 + E-VALIDATOR-CIRCULAR-DEP via B7 reuse (FIRST consumer). **B11+B13+B12 LANDED S68 (Wave 3 closer):** B11 (`e4a12fd`) synth-cell registry + PASS 8; B13 (`336e66a`) E-DERIVED-WITH-VALIDATORS + Level-1 inline-override extraction + per-arg-split + PASS 9; B12 (`0671286`) per-field synth + ScopeKind `"field"` + lookupQualifiedStateCell extension. **B14-B17 LANDED S68 (Wave 4 COMPLETE):** B14 (`934100e`) engine binding + auto-declared variable + cross-file mount + MOD engine-aware exportRegistry + PASS 10.A/10.B; B15 (`40e0511`) state-child exhaustiveness + rule= typer (§51.0.F three target-only forms) + initial= validation + PASS 11 + new `engine-statechild-parser.ts`; B16 (`773c38b`) derived engines + E-DERIVED-ENGINE-* family + cycle detection via B7 reuse (SECOND consumer) + PASS 12; B17 (`0ca232e`) components-vs-engines residual fire-site (E-COMPONENT-ENGINE-SCOPE for engine-decl in component-def.defChildren) + PASS 13. **B18-B22 (Wave 5 cross-cutting) ALL LANDED S69:** B22 (`a294815`) reset(@cell) target-shape validation + multi-level compound-nav accept + new §34 row E-RESET-INVALID-TARGET + PASS 14; B19 (`7ce01e4`) channel placement + @shared modifier rejection (E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER) + PASS 15 (renumbered from 14 during file-delta merge); B18 (`87cbd36`) L19 multi-statement event-handler validation (E-MULTI-STATEMENT-HANDLER) — new helper `multi-statement-scan.ts` + two fire-sites (markup-attribute + engine state-child :-shorthand) + 55 tests; B20 (`79a1a96`) bare-variant inference §14.10 / M9 (E-VARIANT-AMBIGUOUS + E-TYPE-063) + variable-length-lookbehind regex + ast-builder shouldSkipExprParse relaxation + match-arm-block payload-binding parser (Form 1b) + typer scope-bind — PA hands-on debug recovery (49 fails → 0); B21 (`c5f9dcf`) refinement-type three-zone §53 (boundary-zone hook recording + trusted-zone scope upgrade) — depth-of-survey-discount realized (existing classifyPredicateZone covered most ratified scope). **A1b functionally COMPLETE (22/22 steps shipped).** **Stage 0c (S64 RESHAPED):** Stage 0c.A (function-overload deletion) LANDED `6507475`; 0c.B-D removed (no code); 0c.E (SPEC §17.5 amendment) LANDED `8bda55f`; 0c.F LANDED scrml-support `fec630f`. SPEC-ISSUE-010-COMPONENT closed. **A1c (codegen+runtime) RATIFIED S60** (24 steps C0-C23, 6 waves; ~96-136h focused work). **A1c KICKED OFF S70:** **C0 (foundational feature-usage analysis pass) SHIPPED `846d1ef`** — new module `compiler/src/codegen/usage-analyzer.ts` (702 LOC) + 1-line wire-in to `analyzeAll`; FeatureUsage bitmap (14 validator predicates + 8 engine/temporal flags + 11 cross-cutting flags); cross-file OR-merge via existing `analyzeAll.files[]`; ZERO new diagnostics, ZERO AST mutation, ZERO emission; +67 tests. **C1 BRIEF (shape-aware cell emitter) PRE-DRAFTED `1b9bab1` (S70) → SURVEY LANDED `8ad94e5` (S71) → AMENDMENTS APPLIED `75417fa` (S71)** — ready to dispatch implementation phase (~4-6h cycle, 7 WIPs) at S72 pending scrml-dev-pipeline agent staging on machine-A (currently missing; master inbox notice sent). C1 closes pre-existing S61 Step 11.5 deferred Shape 3 V5-strict codegen gap AND folds in Variant C compound emission (structurally unemittable today — children silently dropped) AND markup-typed-derived declaration. Phase 0 SURVEY caught 3 surprises: (1) Variant C compound gap is wider than BRIEF flagged; (2) Tier 3 has latent JS-comma-operator bug (out of C1 scope, documented for C21); (3) `runtime-template.js:181` already routes `_scrml_reactive_get` → `_scrml_derived_get` for derived names — major infra assist for markup-typed-derived consumption (zero `emit-html.ts` changes needed). Three amendments applied: (1) accept ONE new runtime helper `_scrml_default_set`; (2) A1c SCOPE C21 reduced to Tier 3 only (~2-3h vs 5-7h); (3) test invariant is "no NEW fails" not "zero fails total." Wave 1 of A1c covers C1-C4 (foundational state-decl emission, ~15-20h). Per S70 sequencing decision: A1c engine wave (C12-C15) emits unified codegen for FULL §51.0 surface (pre-S67 + S67 amendments) — A5-4 codegen likely folds into A1c rather than landing as separate phase. |
| A2 — Structural elements | `<engine>`, `<match>` block, `<channel>`, `<errors>`, `<onTransition>` | 25-40h | ⏸️ pending A1 | |
| A3 — Validators + synth surface | bareword validator scan + auto-synth + `<errors of=…/>` | 20-35h | ⏸️ pending A2 | |
| A4 — Schema + refinement + pinned | shared-core in schema; refinement-type predicates; pinned on imports | 15-25h | ⏸️ pending A3 | |
| A5 — Resolver / typer alignment | V5-strict bare-name-as-local; hoisting topo-sort; validator dep-graph | 20-30h | ⏸️ pending A4 | |
| A6 — Codegen + runtime | engine state-machine emit; validator firing; channel WS; render-by-tag | 30-50h | ⏸️ pending A5 | + PIPELINE.md prose pass |
| B1 — Examples rewrite | 32 examples + trucking-dispatch | 20-30h | ⏸️ parallel w/ A* | |
| B2 — Samples curate | 277 .scrml | 15-25h | ⏸️ parallel w/ A* | classify keep/rewrite/drop |
| B3 — Stdlib audit + γ rewrite | 16 modules; data/validate vocab unification | 10-20h | ⏸️ parallel w/ A2-A4 | |
| ~~B4 — Self-host~~ | ~~~12k LOC scrml in `../scrml/`~~ | — | **❌ DEFERRED to post-v1.0.0 (S66 user decision)** | **REMOVED from v0.2.0 plan.** Self-hosting is post-v1.0.0. The ENTIRE self-host scrml compiler (every module: bs/tab/ast/bpp/pa/ri/ts/dg/cg/module-resolver/meta-checker + others) is **human-authored scrml source** (not compiler-emitted-from-TS) — processed by scrmlTS to produce its runtime. Adoption-symbolism: humans embracing the language. TS implementation is the engineering target through v1.0.0. See user-voice S66 entries for the verbatim + clarification. |
| B5 — Editor support | LSP + VSCode + neovim grammars | 8-15h | ⏸️ parallel w/ A3-A4 | |
| C1 — Tutorial rewrite | zero-to-running on v0.2.0 | 8-15h | ⏸️ pending A2 | |
| C2 — Articles triage | 15 articles | 4-8h | 🟡 audit done | `ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md` |
| C3 — README + scrml.dev v0.2.0 | public announce | 2-4h | ⏸️ pending | drafting next |
| **L22 — Type-as-argument family (parseVariant → serialize → formFor → schemaFor → tableFor → reflective)** | new language primitive surface; closes Gap #19, eventually #20 via formFor pick=/omit=/partial= | **family ~85-145h** / parseVariant SHIPPED in ~?h actual | ✅ **parseVariant SHIPPED S65 at `f963a75`** (Phase 1+2+3 GREEN; tests 8959/44/1/0/9004; +18 / 0 regressions) | **ADDITIVE to A1+, not blocking or blocked.** parseVariant compiler work (`type-system.ts` extension + new `emit-parse-variant.ts`) is orthogonal to A1b's `@name` resolution AND A1c's per-decl-shape codegen waves. `reflect(TypeName)` in `meta-checker.ts:144-274` is a working type-as-argument primitive TODAY (in `^{}` meta blocks); parseVariant rides the same recognition pattern outside meta-blocks. Shipping order: parseVariant (S65/66 next) → serialize (~6-12mo horizon, symmetric counterpart) → **`formFor` (FLAGSHIP — scrml.dev demo: define struct → get form+validation+submit in one line)** → `schemaFor` (close §39+L4 vocabulary-unification loop) → `tableFor` (admin-UI lift) → `variantNames` + reflective metadata. Each future family member must independently pass per-shape sliver test + synonym-detection precondition + per-feature deep-dive (the discipline that bounds the family). |
| **A7 — S67 ratified engine + temporal extensions** | DD-Harel hierarchy (`<engine>` nested per OQ-Harel-8 resolution; Machine Cohesion sharpened) + history attribute (tree-shakeable synth cell) + `internal:rule` prefix + `parallel` attribute sugar + Item C temporal surface migration (`<onTimeout>` element on `<engine>`) + computed-delay relaxation + Item G B-shakeable timeouts (event-timeout watchdog + named multi-timer) | **~50-80h** | ✅ **A5-1+A5-2+A5-3 LANDED — parser+typer COMPLETE post-S70**; A5-4+A5-5+A5-6+A5-7 pending (likely fold into A1c) | **S67 RATIFIED via master-PA debate verdicts (Insight 22 + Insight 23 at `scrml-support/design-insights.md`).** Item C audit on file at `docs/audits/item-c-temporal-engine-rule-migration-rule4-audit-2026-05-07.md`. **A5-1 (SPEC §51 amendments) LANDED S68 `1de05ef`** — §51.0.K Machine Cohesion footnote (singleton invariant articulated; nested engines permitted in composite state-children); §51.0.M `<onTimeout>` element (Item C Candidate C); §51.0.N `history` attribute + `.Variant.history` structured target form (shallow-only); §51.0.O `internal:rule=` prefix; §51.0.P `parallel` attribute on file-scope `<engine>` (naming sugar); §51.0.Q hierarchy / nested engines + parent-rule cascade dispatch; §51.12.3.1 computed-delay relaxation; +2 §34 codes (E-HISTORY-NO-INNER-ENGINE, E-INTERNAL-RULE-NOT-COMPOSITE); §4.15 + §24.4 structural-elements registries updated for `<onTimeout>`. **A5-2 (parser support) LANDED S70 `bdc491c`** — extended `engine-statechild-parser.ts` + `ast-builder.js` + `symbol-table.ts` types for `<onTimeout>` + `history` + `internal:rule=` + `parallel` + nested `<engine>` + `.Variant.history` target form; `EngineRuleForm` Option A flag (`historyForm?: boolean`); +63 tests; pre-existing `findStateChildCloser` bug surfaced + fixed (nested engine block depth tracking). **A5-3 (typer + symbol-table walker) LANDED S70 `a8a6bdf`** — NEW SYM PASS 16 (`walkValidateEngineA5Extensions`); fires E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE + first compile-time E-ENGINE-INVALID-TRANSITION fire-site (`<onTimeout to=>` legality); EngineMetadata file-scope aggregation as annotated records (`{stateChildTag, ...}`); 3 deferrals on infrastructure preconditions (`<onTimeout>` placement, `<match>` arm placement, cascade-miss diagnostic); +54 tests. **history-regex bugfix LANDED S70 `8d0a6f2`** — A5-2's `/\bhistory\b(?!\s*=)/` mis-matched `history` inside `rule=.Playing.history` (SPEC §51.0.N target form), false-firing E-HISTORY-NO-INNER-ENGINE. Tightened to standalone-token form `/(?:^|\s)history(?=\s|>|\/|$)/`. Defense-in-depth same fix on `pinned`/`parallel` regexes. +3 regression tests. **Pending sub-steps:** A5-4 codegen extension (~10-15h — likely folds into A1c engine wave C12-C15); A5-5 computed-delay relaxation impl (~1.5-2.5h); A5-6 Item G B-shakeable timer extensions (~5-10h, optional follow-on); A5-7 tests + samples (~12-18h). Total post-A5-3 remaining: ~28.5-45.5h. Per S70 sequencing decision: A1c codegen will emit unified engine codegen for FULL §51.0 surface (pre-S67 + S67 amendments) in one pass. Class A throughout per master-PA cost-lens. |
| **A8 — test-bind (effects-as-data middle path, Insight 22)** | `test-bind <serverFnName> = <handler>` declaration in `~{}` blocks; compile-time conditional at §47 server-fn call site; production binary unchanged (dead-code-eliminated) | **~6-12h** | ⏸️ pending | **S67 RATIFIED via Insight 22.** Closes OQ-8 partially (server-function mockability); re-files OQ-8b for `<onTransition>` body effects beyond server-fn calls. Position B (effect-record schemas) NOT ADOPTED at this time; structurally extensible later (no flip-condition gating per S67 methodology rule). E-TEST-004 + E-FN-004 + Insight 21 unchanged. Sub-steps: (1) parser `test-bind` declaration in `~{}`; (2) typer: scope-local table; key-validation against §47 encoded names; (3) codegen: compile-time conditional dispatch at server-fn call sites in test mode (release builds dead-code-eliminate); (4) tests including fail-fast on unbound server fn in active test-bind context; (5) optional `scrml:test` API alignment. |

### §0.2 v0.2.0 architectural locks (L1-L22)

L1 markup-as-first-class-value (PILLAR — held since scrml8) · L2 Variant C compound state · L3 decl-coupled-with-render-spec · L4 partial validator vocab unification (no bilingual schema; `@shared` removed) · L5 `is some` reused · L6 match Tier 0/1/2 ladder · L7 match attrs (rules-inert + effect/onTransition engine-only) · L8 two match shapes coexist · L9 `loose` flag dropped · L10 reset() in principle (superseded by L18) · L11 auto-synth validity surface (compound + per-field, errors as enum tags) · L12 4-level error-message resolution chain · L13 `<errors of=…/>` first-class · L14 cross-field via predicate args · L15 `const <derived>` extended all-scope · L16 multi-render via existing access paths · L17 binding-by-render-spec dispatch · L18 reset(@cell) keyword + default= attribute · L19 multi-statement handlers force named function · L20 `derived=expr` engine attribute · **L21** E-DERIVED-VALUE-MUTATE (S59 — in-place mutation of `const`-derived cells forbidden + sibling rename E-REACTIVE-002 → E-DERIVED-WRITE) · **L22** type-as-argument as language primitive (S65 — debate-05 verdict + Path A architectural commit; foundation for the type-as-argument family: `parseVariant` → `serialize` → `formFor` → `schemaFor` → `tableFor` → reflective metadata; per-shape sliver test + synonym-detection precondition + per-feature deep-dive mandatory on every future addition).

### §0.3 v0.2.0 audit deliverables

- `docs/changes/v0next-audit/PARSER-AUDIT-2026-05-05.md` — 25 features classified PARSES-NOW / PARTIAL / NOT-AT-ALL / HTML-FRAGMENT (the deceptive-success pattern).
- `docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md` — full subsystem inventory, ~280-440h estimate, piecemeal recommendation.
- `docs/changes/v0next-inventory/ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md` — 15 articles classified ACCURATE / NEEDS-EDIT / RETRACT / DO-NOT-PUBLISH for v0.2.0-in-flight context.
- `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md` — S60 11-step plan (targets need correction per audit; revise pending).
- `docs/changes/phase-a1a-lex-parse/DISPATCH-A1A-BRIEF.md` — original brief rev3 (will need rewrite for foundational pass).
- `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` — prior-session phase outline (now superseded by SCOPE-MAP-2026-05-05 §0 dashboard above).

### §0.4 v0.2.0 open questions / surfaced design queries

- **`<program>` dual role** (S59) — RESOLVED: keep both inline-config-attributes use AND wrapper-of-body use AND nested-execution-context-boundary use. Spec at §40.2 + §43 unchanged.
- **`<program>` documentary attributes** (S59 NEW) — RESOLVED + LANDED `4620290`. Five attrs: `title=`, `description=`, `version=`, `author=`, `license=`. SPEC §40.7 + W-PROGRAM-TITLE-NESTED warning. Article (`tier-ladder-promotion`) updated.
- **Acorn replacement** — RESOLVED: stays. Pre-processor extension absorbs new syntax above acorn's scope. See SCOPE-MAP §A.4.
- **Self-host migration risk** — TBD at B4 entry. Fixed-point regressions are subtle.
- **`reactive-decl` rename to `state-decl`** — RESOLVED + LANDED in Step 3 (commit `8fa26e1`). ~514 changes across ~120 file updates. 0 regressions.
- **Depth-of-survey discount pattern** (S59 captured) — see `scrml-support/design-insights.md` "Depth-of-survey discount" entry. **Seven confirmed occurrences** (S51 W2, S52 DD4, S59 Step 2, S59 documentary-attrs, S64 Phase 4d, S64 B2, S65 parseVariant Path A survey). PA-SCRML-PRIMER §12 has the session-start pointer + mitigation checklist.
- **L22 family vs A1c sequencing** (S65 NEW) — parseVariant compiler work is additive, not blocking or blocked. File-disjoint from A1b/A1c. Three options: (a) parseVariant Phase 2 BEFORE A1c starts — gets type-as-argument precedent shipped early, A1c builds on it; (b) parseVariant Phase 2 AFTER A1c lands — A1c's codegen orchestrator is more stable; (c) parallel — possible since file-disjoint. **PA lean: (a)** — parseVariant unlocks `formFor` which is the scrml.dev flagship demo; getting it shipped sooner pays for itself in marketing terms. (b) is also defensible.
- **Pro-X-voice-voting-against-X methodology-grade signal** (frequency-3, S65) — debate-03 roc retracted carve-out; debate-04 crystal voted A; debate-05 simplicity-defender flipped to C-narrow. When a partisan-defender voice flips under its own methodology lens, the rejection is structurally stronger than expected agreement. Apply going forward.
- **OQ-Harel-8 — inner-engine opener inside composite state-child body** (S67) — RESOLVED. User verbatim S67: *"pick engine, that feels right"*. `<engine>` is the canonical opener everywhere; Machine Cohesion (2026-04-17) sharpened to articulate the actual singleton invariant ("one engine declaration site → one running singleton instance for that scope"; nested engines preserve singleton-ness via outer × 1 = 1 inner instance; engines forbidden inside component bodies remains; engines forbidden inside function/snippet bodies). Pillar 5 (no per-kind mini-DSLs) is the load-bearing reason; tooling-uniformity (`bun scrml migrate`/`promote` CLI stays context-blind) is the operational reinforcement. Recorded as Insight 23 grammar decision #1 in `scrml-support/design-insights.md`; user-voice S67 entry "OQ-Harel-8 resolved."
- **OQ-8 (test-mockability for engine-bearing apps)** (S67) — PARTIALLY CLOSED via Insight 22 (`test-bind` declaration in `~{}` blocks). Server-function mockability is closed. `<onTransition>` body effects beyond server-fn calls re-filed as **OQ-8b**.
- **OQ-Harel-1 through OQ-Harel-7** (S67 NEW) — open spec-authoring questions for the DD-Harel hierarchy implementation. Listed in Insight 23 body. Resolution drives sub-step ordering during A7 dispatch.
- **OQ-test-bind-concurrency / OQ-test-bind-passthrough / OQ-audit-log-compose** (S67 NEW) — open during A8 (test-bind) dispatch. Listed in Insight 22 body.
- **Machine Cohesion sharpening** (S67 NEW) — the 2026-04-17 ratification's "file-scope-only" wording is overly restrictive relative to its actual load-bearing invariant (singleton-ness). Sharpened version permits nested `<engine>` inside another engine's state-child body (still singleton; outer × 1 = 1). Recorded in user-voice S67 entry; spec amendment lands during A7 dispatch as a footnote on the §51.0.K Machine Cohesion section (parallel to S66 §6.6.10 footnote precedent).
- **Flip conditions are not a feature-adoption gating mechanism** (S67 methodology rule, user verbatim: *"flip conditions are null, not considered here for feature addoption"*). PA must restate flip-condition framing as "not adopted at this time; structurally extensible if needed later" rather than "gated on flip condition X." Applied retroactively to Insight 22 wording. Recorded in user-voice S67 entry.
- **Tooling-uniformity corollary to Pillar 5** (S67 user observation: *"adding a new word would have lost or complicated cli promotion for those"*) — when evaluating "should this thing get a new keyword vs reuse an existing one," ALWAYS check tooling-pipeline impact. CLI promotion (`bun scrml promote`), migration (`bun scrml migrate`), and IDE refactoring all benefit from minimal keyword surface. Reinforces Pillar 5 from the operational direction.
- **S67 file-delta dispatch-landing pattern** (S67 standing rule, pa.md commit `05dc631`) — supersedes worktree+cherry-pick (S43-S66) AND fast-forward-dispatch experiment (S67 first attempt). `git checkout <branch> -- <files>` from main + single PA-authored commit. Crash-recovery + review gate preserved; cherry-pick churn + branch-name fights + PA redo work eliminated. Validated B7+B8+B9 in S67. Two recoverable friction points documented: shared-doc-table conflicts when parallel; agent-side-stale-views in diff.

### §0.5 A1a 20-step status (rev 6 decomposition — ALL 20 SUB-STEPS DONE; A1a COMPLETE)

| # | Step | Status |
|---|---|---|
| 1 | Lexer: reserve `reset` | ✅ S59 `9cd7779` |
| **2** | **Foundational: `<NAME>` decl-site recognition** | ✅ S59 `d28f6f7` (depth-of-survey discount #5) |
| **3** | **AST kind rename `reactive-decl` → `state-decl`** | ✅ S59 `8fa26e1` |
| 4 | Parser: state-decl `shape` discriminant for Shapes 1 + 3 | ✅ S59 `96dbe92` (surfaced `reactive-derived-decl` divergence → ADR / Step 11.5) |
| 5 | Parser: Shape 2 `renderSpec` + bareword validators + `req` | ✅ S59 `505531f` (validator args `string[]` deferred to A1b B9) |
| 6 | Parser: `default=` + `pinned` on state-decl | ✅ S60 `2754940` |
| 7 | Parser: `pinned` on import items | ✅ S60 `556de93` |
| 8 | E-RESERVED-IDENTIFIER trigger | ✅ S59 `af4a0da` |
| 9 | Expression parser: `reset(@cell)` keyword + E-RESET-NO-ARG | ✅ S60 `fded36a` |
| 10 | Expression parser: MemberCall/MemberAssignment/UnaryDelete shape | ✅ S60 `226a2dd` (Discount #8 — zero source) |
| 11 | Variant C compound + render-by-tag + kickstarter v2 §3 smoke | ✅ S60 `bcca1e6` (escalation surfaced 11.0a/b/c) |
| 11.0a | Variant C compound recognizer | ✅ S60 `6d51d00` |
| 11.0b | Newline-as-statement-separator | ✅ S60 `a7dd96a` |
| 11.0c | Typed-decl recognizer | ✅ S60 `92af2ca` |
| **11.5** | **FOLD `reactive-derived-decl` → `state-decl{shape:"derived",isConst:true}`** | ✅ **S61 `a020ea1`** (T2 tier; +4 pass / +1 skip; byte-output preserved; 1 hidden coupling resolved at emit-logic.ts; 1 dep-graph dedup resolved with `isFoldedDerived` filter; pre-existing Shape 3 V5-strict codegen gap deferred to A1c; self-host parity test marked `test.skip` per Steps 4-7 policy — catches up at next bootstrap regen) |
| 12 | Existing-test deltas: rewrite + drop | ✅ **S61 `7be23aa`** (T2 tier; **ZERO net delta** — same baseline 8,878/44/0/8,922; 175 sample files in `samples/compilation-tests/` migrated to V5-strict canon; 2 NEW parser-gap follow-ups surfaced — see 11.0d / 11.0e below; 624 sites in broader `samples/` deliberately left in legacy form per SURVEY scope) |
| **11.0d** | **Top-level structural Shape 1 recognition** (P-FUP-1 from Step 12) | ✅ **S61 `0f92077`** (T2 tier; +9 pass / +1 todo; BS top-level scan extension via `peekTopLevelStateDeclSignal` in ast-builder.js + block-splitter.js; 3 reverted Step 12 samples restored; component-def discrimination preserved; Variant C compound at top-level deferred via §S11D.5 .todo; ORIGINAL agent + finisher both stalled with stream timeouts — PA salvaged committed work via cherry-pick of partials + finisher re-dispatch + final marker commit) |
| **11.0e** | **`<x> = not\n<y>` newline-as-separator boundary fix** (P-FUP-2 from Step 12) | ✅ **S61 `916de65`** (T2 tier; +8 tests §S11E.1-§S11E.8; 4 of 5 reverted Step 12 samples restored; UNIVERSAL fix — `"not"` added to `VALUE_KEYWORDS` Set; preserves Step 11.0b universality; 1 LOC source change + 10 LOC explanation comment; surfaced P-FUP-3 → Step 11.0f) |
| **11.0f** | **`<x> = ?{SQL}\n<y>` BLOCK_REF newline-as-separator boundary fix** (P-FUP-3 from Step 11.0e) | ✅ **S61 `fe93d40`** (T2 tier; BLOCK_REF added to `lastEndsValue` value-classifier in `collectExpr` ASI-NEWLINE branch; restored `combined-007-crud.scrml`; preserves Step 11.0b/e universality) |
| 13 | Final commit + CHANGELOG aggregate + cleanup `scripts/step12-*.mjs` helpers | ✅ **S61** (T1 tier; 5 step12 helpers deleted; A1a-COMPLETE CHANGELOG entry by PA-direct integration; final `compile(a1a-COMPLETE)` commit by PA. Original Step 13 agent stalled with stream timeout after WIP commits; PA salvaged via cherry-pick of partials + PA-direct CHANGELOG aggregate.) |

**ALL 20 sub-steps done at S61 close. A1a (lex+parse) is COMPLETE.** Each step landed via focused worktree dispatch + PA cherry-pick to main between steps.

**Side landings during A1a (parallel work):**
- Documentary `<program>` attributes (`title=`, `description=`, `version=`, `author=`, `license=`) — SPEC §40.7 + emit-html.ts head injection + tier-ladder article update. Commit `4620290`.

### §0.6 Surfaced divergences / queued follow-ups

**`reactive-derived-decl` AST kind divergence (S59 Step 4 surfaced; FOLDED S61 Step 11.5):** RESOLVED. The legacy `const @NAME = expr` parser path now produces `state-decl{shape:"derived",isConst:true,structuralForm:false}` per ADR Option A. ~20 consumer sites swept; AST kind enum cleaned. Single-walker model for L21 enforcement substrate. Spec coherence with §6.6 restored. Final commit `a020ea1` (S61). 6 self-host files still contain literal `reactive-derived-decl` references; catches up at next bootstrap regen.

**Pre-existing Shape 3 V5-strict codegen gap (S61 Step 11.5 surfaced):** Surfaced during 11.5 emit-logic.ts work. Shape 3 V5-strict `const <x> = expr` declarations emit `_scrml_reactive_set` instead of `_scrml_derived_declare`. Out-of-scope for 11.5 per BRIEF §2.2; **deferred to A1c codegen pass.** Documented in 11.5 progress.md + A1c plan §6.4.

**P-FUP-1: Top-level structural Shape 1 not implemented in BS (S61 Step 12 surfaced; FIXED S61 Step 11.0d):** RESOLVED. BS extended with `peekTopLevelStateDeclSignal()` — at true top-level, looks past `<NAME [attrs]>` to the post-`>` next non-whitespace char; if `=` (rejecting `==`/`=>`) or `:`, falls through as TEXT instead of pushing a markup context. `liftBareDeclarations` matches against `TOPLEVEL_STATE_DECL_RE` and wraps in synthetic `${...}` logic block; existing `tryParseStructuralDecl` (Steps 2/11.0a/11.0c) parses as state-decl with `structuralForm:true`. 3 reverted Step 12 samples restored. Top-level Variant C compound (`<formRes>...</>` at file-top) deferred via §S11D.5 .todo (BS peek matches `=`/`:`, not `<` for compound-opener at top-level). Final commit `0f92077` (S61).

**P-FUP-2: `<x> = not\n<y>` newline-as-separator boundary (S61 Step 12 surfaced; FIXED S61 Step 11.0e):** RESOLVED. The `not` keyword tokenized as KEYWORD but was missing from `VALUE_KEYWORDS` Set in `collectExpr`'s ASI-NEWLINE branch (ast-builder.js L1970). Step 11.0e added `"not"` to the Set — universal fix, preserves Step 11.0b's universality property. 4 of 5 reverted Step 12 samples restored to V5-strict canon. The 5th sample (combined-007-crud) blocked by NEW P-FUP-3 (BLOCK_REF same-shape bug) — see below.

**P-FUP-3: `<x> = ?{SQL}\n<y>` BLOCK_REF newline boundary (S61 Step 11.0e surfaced; FIXED S61 Step 11.0f):** RESOLVED. Same shape as P-FUP-2 but with `BLOCK_REF` (`?{SQL}`) as trailing value-producing token. Step 11.0f extended the `lastEndsValue` value-classifier in `collectExpr`'s ASI-NEWLINE branch to recognize BLOCK_REF as value-producing — narrow patch at same locus as Step 11.0e. `combined-007-crud.scrml` restored to V5-strict canon. Final commit `fe93d40` (S61).

**Curation pass S61 — `docs/changes/` 103-dir wholesale curation:** Triggered by S61 maps-refresh agent's non-compliance scan. Disposition matrix at `docs/curation/2026-05-05-changes-dir-disposition.md`. **9 batches RATIFIED + EXECUTED** (A: P-series 12, B: expr-ast-phase-4d 4, C: dispatch-app 7, D: F-series 11, E: GITI 2, F: BUG-letters 2, G: bun-sql 2, H: LSP L1-L4 5, I: fix-* 20) = **65 dirs dereffed** to `scrml-support/archive/changes/`. 1 batch remaining: J (misc, 12). `docs/changes/` count: 103 → 41.

**§S4.10 discriminant invariant test (Step 5 dependency):** RESOLVED — Step 5 (`505531f`) relaxed the assertion. Now admits `shape ∈ {"plain","derived","decl-with-spec"}`.

**Path-discipline leak (S59 close anomaly):** Step 5's agent leaked progress.md content directly to main's working tree (not just to its worktree). Recovered via `git checkout -- progress.md` then proper cherry-pick. No code damage. **Still investigating root cause.** Hypothesis: agent ran `Edit` against an absolute path that collided with main when isolated worktree's relative-path resolution slipped. Surfaced for next session: extend pa.md F4 path-discipline check to include progress.md edits; consider mandating `git status --short` in main repo BEFORE cherry-pick (to detect leaks earlier).

**Validator args representation (Step 5 deferral):** Step 5 collected validator call-form args as `string[]` (raw text). AST-CONTRACTS §1.1 final shape says `ExprNode[]`. **A1b converts string args to ExprNode[] when validator typing lands** (Step 9-ish or A2 territory). Documented at progress.md §[05:05].

**`is some` two-word predicate (Step 5 scope deferral):** `is some` tokenizes as KEYWORD `is` + IDENT `some`. Step 5's bareword scan rejects KEYWORDS (only plain IDENTs are barewords). Detailed two-word predicate parsing deferred. Surface area is small; can land in any subsequent step or as standalone.

---

**Format:** `[x][x]` = complete + verified, `[x][ ]` = exists/in progress, `[ ][ ]` = not started.

**Historical session-by-session detail:** see `docs/changelog.md`. The previous session-log paragraphs that lived in this header (S40 → S58 deltas, ~5k+ words) are now exclusively in the changelog; this header carries current-truth and active-work signals only.

---

## A. Compiler core

**Entry:** `compiler/src/cli.js` (bin: `scrml`); published binary shebang at `compiler/bin/scrml.js`.
**Tests (current — S63):** **8,933 pass / 44 skip / 1 todo / 0 fail / 8,978 across 440 files** (full suite incl. browser; B1 added 31 tests in `compiler/tests/integration/symbol-table.test.js`); pre-commit subset ~8,212 / 33 / 0. **Net Phase A1a delta:** +182 pass / +1 skip / +1 todo / +184 total vs the S58-close baseline of 8,720 / 43 / 0 / 8,763 across 432 files (across all 20 sub-step landings). **B1 delta:** +31 pass / +1 file vs A1a-close baseline.
**Test-count history (session deltas):** see `docs/changelog.md` for per-session +/- ledger across S40-S58.
**Compile time:** ~44ms TodoMVC (post-ExprNode parsing overhead)
**Self-host flag:** `--self-host` loads 11 scrml modules from `compiler/self-host/` — deferred post-S30 public pivot

### Pipeline stages (all working)

- [x][x] BS (Block Splitter): `compiler/src/block-splitter.js`
- [x][x] TAB (Tokenizer): `compiler/src/tokenizer.ts` + AST Builder: `compiler/src/ast-builder.js`
- [x][x] BPP (Body Pre-Parser): `compiler/src/codegen/compat/parser-workarounds.js`
- [x][x] PA (Protect Analyzer): `compiler/src/protect-analyzer.ts`
- [x][x] RI (Route Inference): `compiler/src/route-inference.ts`
- [x][x] TS (Type System): `compiler/src/type-system.ts`
- [x][x] DG (Dependency Graph): `compiler/src/dependency-graph.ts`
- [x][x] CG (Code Generator): `compiler/src/codegen/` (37 files, ~14,912 LOC)
- [x][x] CE (Component Expander): `compiler/src/component-expander.ts`
- [x][x] ME (Meta Eval): `compiler/src/meta-eval.ts`
- [x][x] MC (Meta Checker): `compiler/src/meta-checker.ts`
- [x][x] **SYM (Symbol Table — Stage 3.06):** `compiler/src/symbol-table.ts` — A1b Step B1, S63 `9d2fa45`. Per-scope state-cell registry; foundational for B2-B22. Fires no diagnostics. Annotations (`_record`/`_scope`) attached non-enumerable so generic structural walkers skip the back-pointer cycle.

### Other compiler src

`api.js`, `code-generator.js`, `expression-parser.ts`, `html-elements.js`, `module-resolver.js`, `runtime-template.js`, `schema-differ.js`, `serve-client.js`, `tailwind-classes.js`, `chart-utils.js`, `types/`, `index.js`

**Total compiler src:** ~24,739 LOC (codegen: ~14,135 LOC)

---

## B. CLI commands (all verified)

- [x][x] `scrml compile <file|dir>` — compile
- [x][x] `scrml init [dir]` — scaffold project
- [x][x] `scrml dev <file|dir>` — compile + watch + serve (`compiler/src/commands/dev.js`)
- [x][x] `scrml build <dir>` — production build (`compiler/src/commands/build.js`)
- [x][x] `scrml serve` — persistent compiler server (`compiler/src/commands/serve.js`)
- [x][x] `scrml compile --self-host` — use self-hosted modules

---

## C. Self-host modules (reference copies)

`compiler/self-host/` contains the 11 .scrml modules that bootstrap the compiler. The **primary** working copy lives in `~/scrmlMaster/scrml/`. The copies here are what the compiler builds against for `--self-host`.

| File | LOC | Purpose |
|---|---|---|
| bs.scrml | 894 | Block splitter |
| tab.scrml | 1,115 | Tokenizer |
| ast.scrml | 3,551 | AST builder |
| bpp.scrml | 230 | Body pre-parser |
| pa.scrml | 444 | Protect analyzer |
| ri.scrml | 984 | Route inference |
| ts.scrml | 2,570 | Type system |
| dg.scrml | 1,052 | Dependency graph |
| cg.scrml | 21 | Codegen stub |
| module-resolver.scrml | 305 | Module resolver |
| meta-checker.scrml | 882 | Meta checker |

**Total:** 12,048 LOC. L2 + L3 bootstrap complete.

---

## D. Spec + authoritative docs

- [x][x] `compiler/SPEC.md` — 20,453 lines, 65 sections (§1–§54). AUTHORITATIVE. §22.3 multi-`^{}` added S38, §12.5 server return values added S37.
- [x][x] `compiler/SPEC-INDEX.md` — quick-lookup with line ranges.
- [x][x] `compiler/PIPELINE.md` — stage contracts. RI now includes closureCaptures + capture taint propagation (S39).

**All other spec history (drafts, updates, amendments) lives in `scrml-support/archive/spec-drafts/`**.

---

## E. Examples (32 files + trucking-dispatch app)

**22/22 example files compile** as of S42 close (2026-04-26 — S42 spanned midnight). 21 top-level examples (01-21) + a multi-file example (22-multifile/ with 3 .scrml files). Examples 15-22 added in S42 to fill the 8 critical spec coverage gaps from Stage 1: 15-channel-chat (§38 real-time), 16-remote-data (§13.5 enum loading state), 17-schema-migrations (§39 declarative schema), 18-state-authority (§52 Tier 2 `server @var` — scaffold, emits W-AUTH-001 by design until detection ships), 19-lin-token (§35 linear types), 20-middleware (§40 `<program>` attrs + `handle()`), 21-navigation (§20 `navigate()` + `route`), 22-multifile/ (§21 cross-file `import`/`export` + pure-type files). **Post-A1+A2+A6 fixes (S42 close), examples 10 + 14 are now lint-clean.** Example 05 still uses `if=`/`else-if=`/`else` chain workaround — InfoStep can revert to canonical match-with-lift post-A3 fix, but PreferencesStep + ConfirmStep blocked on A7 + A8 (intake-filed, T2 same parser family). Example 18 still emits W-AUTH-001 (§52 Tier 2 scaffold; expected until C2 ships). Example 19 dropped its `const consumed = ticket` workaround post-A4 fix — now uses canonical `${ticket}` template-literal interpolation. **`examples/VERIFIED.md`** (NEW S42) tracks human-verified examples with commit-hash staleness markers. **All bugs/anomalies tracked at `docs/audits/scope-c-findings-tracker.md` (stable IDs A1-A8, B1-B3, C1-C3, D1-D10, E1-E2, F1-F4).** S42 final test suite: **7,906 pass / 40 skip / 0 fail / 378 files** at `b6eb0c3` (or close-of-session SHA).

- [x][x] 01-hello (Tailwind), 02-counter (Tailwind, reactive), 04-live-search (Tailwind, reactive)
- [x][x] 10-inline-tests (Tailwind), 14-mario-state-machine (Tailwind, fully interactive — machine, derived, match, if=)
- [x][ ] 05-multi-step-form — step components expand, onclick wiring fix landed, interactive testing incomplete
- [x][ ] 06-kanban-board — compiles, renders, call-ref handler fixed (S13), needs interactive verification
- [x][ ] 03-contact-book, 07-admin-dashboard, 08-chat — need running server
- [x][ ] 09-error-handling (Tailwind), 11-meta-programming, 12-snippets-slots, 13-worker (Tailwind) — compile clean, partial interactivity
- [x][✅] **22-multifile/** — RESOLVED post-W2 (cross-file component expansion working end-to-end via canonical-key + auto-gather + recursion fix per deep-dive `docs/deep-dives/f-component-001-architectural-2026-04-30.md`). Both `scrml compile examples/22-multifile/app.scrml` and `scrml compile examples/22-multifile/` compile clean and emit expanded `<UserBadge>` markup inline — no phantom `createElement("UserBadge")`. Three intersecting faults closed in W2 commit `6536f7a`: F1 (CE recursion gate now walks lift-target subtrees), F2 (CE consumes `importGraph` for canonical absolute-path lookups, mirroring TS-pass + LSP precedent), F3 (CLI auto-gathers transitive `.scrml` import closure pre-BS+TAB). New integration tests at `compiler/tests/integration/cross-file-components.test.js` close the M17 meta-pattern (compile real fixtures end-to-end + diff emitted JS/HTML; no synthetic-key shortcuts). **Pre-W2 "Plan B parked" disposition lifted.** See FRICTION.md §F-COMPONENT-001 RESOLVED markers.

---

## F. Samples

- [x][x] `samples/compilation-tests/` — **275 top-level `.scrml` test files** (S41 close 2026-04-25 audit: 27 clean / 24 fail / 224 warning-only). Plus ~509 fixture files in subdirs (recursive total: 784). Top-level failure mode mostly E-SCOPE-001 in gauntlet/meta samples; warning bucket contents being classified under Scope C Stage 1.4. S20 gauntlet fixtures in 7 subdirs:
  - `gauntlet-s20-channels/`, `gauntlet-s20-error-test/`, `gauntlet-s20-error-ux/`, `gauntlet-s20-meta/`, `gauntlet-s20-sql/`, `gauntlet-s20-styles/`, `gauntlet-s20-validation/` (S20/S21 regression corpus).

---

## G. Test infrastructure

- [x][x] `compiler/tests/unit/` — 175+ files (S34)
  - `gauntlet-s20/` — 5 files, 38 tests
  - `gauntlet-s22/` — 4 files, 45 tests
  - `gauntlet-s23/meta-bugs.test.js` — 9 tests
  - `gauntlet-s24/` — R14 bug tree
  - `gauntlet-s31/` — 11 tests for F5 bare-ident-referencing-reactive (`ebd4d1d`)
  - `transition-decl-block-split/ast/registry/scope/illegal/terminal/purity.test.js` — 7 files, 51 tests covering §54.3–6 state-local transitions end-to-end (S33)
  - S34 adopter-bug trees: 8 new/updated files covering all 11 S34 bugs (Bug E/A/D/B+F/C + GITI-001/002/003/004/005)
- [x][x] `compiler/tests/integration/` — 2 files
- [x][x] `compiler/tests/self-host/` — 4 files
- [x][x] `compiler/tests/conformance/s32-fn-state-machine/` — 4 files, 39 tests (9 green, 30 skipped with per-gate annotations)
- [x][x] `compiler/tests/browser/` — 11 files (happy-dom)
- [x][x] `compiler/tests/commands/` — 2 files
- **Total (S49 close 2026-04-29):** **8,094 pass, 40 skip, 0 fail** (~28,542 expects across 383 test files). The 2 pre-existing fails resolved in S49.
- **Pretest:** `scripts/compile-test-samples.sh` compiles 12 browser test samples (run via `bun run pretest`)
- **Skipped:** 30 S32 conformance tests gated on parser/narrowing capabilities; `browser-reactive-arrays.test.js` (happy-dom hangs); 8 TodoMVC happy-dom tests (harness-IIFE-scope).
- **Previously failing (2):** self-host tokenizer parity + Bootstrap L3 — resolved S38.

---

## H. Editor support

**VS Code:** `editors/vscode/`
- [x][x] `package.json` — extension manifest
- [x][x] `syntaxes/scrml.tmLanguage.json` — 438 lines TextMate grammar
- [x][x] `src/extension.ts` — LSP client
- [x][x] `language-configuration.json`
- [x][x] `out/extension.js` — built S2 (run `cd editors/vscode && bunx tsc`)

**NeoVim:** `editors/neovim/`
- [x][x] `scrml.vim`, `scrml.lua`, tree-sitter highlights query at `queries/scrml/highlights.scm`
- [x][x] **User's local kickstart nvim config** wired up S2 2026-04-10: `~/.config/nvim/lua/custom/plugins/scrml.lua` (filetype + LSP autocmd, absolute path to `lsp/server.js`), `~/.config/nvim/after/syntax/scrml.vim` (minimal highlighting), `{ import = 'custom.plugins' }` uncommented in `init.lua`. Smoke-tested headless: `ft=scrml`, `syn=scrml`, 1 LSP client attached.

**LSP:** `lsp/server.js` — 966 lines. Script: `bun run lsp/server.js --stdio`

---

## I. Stdlib (16 modules — user-facing; `compiler` is self-host)

`stdlib/` — auth (3), compiler (17), crypto (1), data (3), format (1), fs (1), http (1), path (1), process (1), router (1), store (2), test (1), time (1)

---

## J. Runtime

- [x][x] `compiler/src/runtime-template.js` — source of truth. S12: added `_scrml_lift_target` routing, `_scrml_reactive_get` → derived cache bridging, dirty propagation triggers effects for derived nodes.

---

## K. Benchmarks

`benchmarks/`
- [x][x] `RESULTS.md` — 129 lines (Puppeteer Chrome benchmarks)
- [x][x] `runtime-benchmark.js` + `runtime-results.json`
- [x][x] `bench-scrml.js`
- [x][x] `browser/` (Puppeteer)
- [x][x] `todomvc/` — scrml TodoMVC
- [x][x] `todomvc-react/`, `todomvc-svelte/`, `todomvc-vue/` — framework comparisons
- [x][x] `fullstack-scrml/`, `fullstack-react/` — full-stack comparisons

**Note:** framework comparison `node_modules/` removed for repo slimness. Run `bun install` in each to restore.

- [x][x] `sql-batching/` — Tier 1+2 microbench (S17). ~2×/3×/4× at N=10/100/1000 on WAL `bun:sqlite`.

**Results:** scrml wins 6/10 runtime ops (S39 audit). 8-13x faster partial updates/swaps. ~10x faster builds. ~4x smaller JS.

---

## L. Scripts

`scripts/` — 8 utility scripts (trimmed S2 from 24; 16 round/session/section-specific patches and broken sample-verifiers archived to `scrml-support/archive/scripts/scrmlTS-2026-04-10/`):
- `update-spec-index.sh` — regen `compiler/SPEC-INDEX.md`
- `assemble-spec.sh` — spec assembly
- `bundle-size-benchmark.js` — bundle-size measurement
- `generate-api-reference.js` — API doc generation
- `verify-js.js` — generic `node --check` wrapper
- `migrate-closers.js` — codemod with `--dry-run`
- `pull-worktree.sh` — agent worktree workflow helper
- `rebuild-bs-dist.ts` — rebuild `compiler/dist/self-host/bs.js` from `bs.scrml`

---

## M. Known bugs + issues

1. ~~Example 12 — E-COMPONENT-020 (snippet expansion for `Card`)~~ — **FIXED** (ex12-component-normalize S2 — `normalizeTokenizedRaw` missed internal bare closers `</>` + open-tag trailing whitespace; multi-line component bodies now parse correctly)
2. ~~Example 13 — E-ROUTE-001 (computed array access in worker)~~ — **FIXED** (ex13-route-warning-fix: added `severity:"warning"` to E-ROUTE-001 + suppressed inside `<program name="...">` worker bodies)
3. ~~BUG-R15-005: `\n` literal in emit() HTML~~ — **FIXED** (meta-fix-batch S2 — verified already resolved by earlier S52 `normalizeEmitCode`)
4. ~~E-META-001 false positives (destructuring, rest params, default params)~~ — **FIXED** (meta-fix-batch S2 — destructuring/rest-params verified clean; for-of fixed via `serializeNode` `for-stmt` case)
5. 2 skipped tests — both in `compiler/tests/unit/callback-props.test.js` §I (lines 436, 440). Blocked on lack of inline-source compile API (`compileScrml` takes file paths only). Unblock path: either (a) add `compileScrmlSource({source, virtualPath})` sibling, or (b) lightweight temp-file harness inside the test. Audited S2 2026-04-10 — prior "10 skipped" claim was stale.
6. ~~E-SYNTAX-043 partial (complex expressions may pass through)~~ — **NON-ISSUE** (S6 2026-04-12 audit: all realistic presence guard patterns `(user) =>`, `(user.name) =>`, `(@user) =>`, `(a, b) =>` are correctly caught. Only keywords-as-variable-names like `(fn) =>` slip through, which is not a real-world scenario. The tokenizer classifies `fn` as KEYWORD, and `isOldPresenceGuardPattern` only accepts IDENT/AT_IDENT — correct behavior since keywords aren't valid variable names.)
7. ~~WebSocket CLI bugs — 6 in dev.js/build.js blocking `<channel>` runtime~~ — **FIXED** (websocket-cli-batch S2 — was already marked fixed in §P1 DQ-11 but this entry was missed during S2 cleanup)
8. ~~Ghost error patterns — 10 remaining~~ — **MITIGATED** (ghost-lint-prepass S2 — new lint pre-pass with 10 W-LINT-* patterns catches React/Vue/Svelte ghost syntax before the main compile)
9. ~~False E-DG-002 for @vars consumed inside runtime `^{}` blocks~~ — **FIXED** (meta-fix-batch S2)
10. ~~`reflect(variableName)` inside callback params rewritten to string literal~~ — **FIXED** (meta-fix-batch S2)

**S12→S13 issues (resolved via deep-dives + debates):**

11. ~~**Lift attribute `${expr}` splitting**~~ — **FIXED S13** (`a1c4300`). call-ref handler in `emitCreateElementFromMarkup` was discarding function arguments entirely. Fixed handler + added paren-space normalization to re-parse path + exhaustiveness guard. Approach C (structured LiftExpr AST, eliminate re-parse) queued as future refactor.
12. ~~**Parser: statements after match**~~ — **FIXED S13** (`a1c4300`). Root cause was NOT brace-depth — `lastEndsValue` in ASI check was missing `}`, `true`, `false`, `null`, `undefined`, `this`. Added trailing-content guard to `parseExprToNode`. Structured match-as-expression (Fix 1b) queued.
13. ~~**Tilde-decl DG false warnings**~~ — **FIXED S13** (`a1c4300`). Added `collectAllTildeDecls`, scan if-stmt conditions in `walkBodyForReactiveRefs` and `collectReadsAndCalls`.
14. ~~**Browser test harness**~~ — **FIXED S13** (`96a46d5`). 132 of 147 failures were missing compiled samples (added pretest script) or hanging test (reactive-arrays skipped). 15 pre-existing failures remain.

**Fix details + rationale for each:** `scrml-support/docs/` (look up by bug ID or topic).

**S31–S34 fixes (adopter-facing codegen + scope):**

15. ~~**F5 — missing `@` sigil silent break in markup interpolation**~~ — **FIXED S31** (`ebd4d1d`). `${count}` when `@count` was declared compiled to empty span + bare `count;` reference with zero diagnostics. Root cause: reactive-decl double-bind (bare + sigil form) silently absorbed bare-ident references in logic. Fix: reactive-kind check in `checkLogicExprIdents` + `visitAttr` with tailored "write `@name`" message. +11 tests in `gauntlet-s31/`.
16. ~~**F6 `init` in non-empty CWD + F10 README bun-link step**~~ — **FIXED S31** (`26df45d`). `init` now exits 1 with guidance when CWD is non-empty (dotfile-only accepts bare `init`). README Quick-start shows install → `bun link` → `init my-app`. +5 tests.
17. ~~**Bug E (6nz) — `^{}` meta-block Object.freeze missing commas**~~ — **FIXED S34** (`aa92070`). `Object.freeze({ get a() {...} get b() {...} })` produced `SyntaxError: Unexpected token 'get'`. Template joined properties with `\n` only. Fix: `props.join(",\n")` in `emit-logic.ts`. Same fix applied to `emitTypeRegistryLiteral`. +3 tests.
18. ~~**Bug A (6nz) — event arg dropped in bare-call handlers**~~ — **FIXED S34** (`eb86d31`). `onkeydown=handleKey()` emitted `function(event) { handleKey(); }` — event discarded. Per tutorial §1.5, bare-call event attrs receive event as first arg. Fix in `emit-event-wiring.ts`: `argsStr.length === 0 ? "event" : argsStr`. Tutorial snippet `docs/tutorial-snippets/01e-bindings.scrml` now compiles to the behavior it advertised. +2 new tests; 9 existing assertions updated.
19. ~~**Bug D (6nz) — name-mangle bleeds onto DOM methods**~~ — **FIXED S34** (`27ed6fe`). User fn `toggle()` → `_scrml_toggle_N` textually rewrote `classList.toggle(...)` → `classList._scrml_toggle_N(...)`. Any user fn sharing a name with a DOM method (toggle, forEach, add, remove, append, replace, ...) was silently corrupted. Fix: negative lookbehind `(?<!\.)` on the post-emit mangler regex in `emit-client.ts`. +3 tests in `mangle-property-access.test.js`.
20. ~~**GITI-002 — false E-SCOPE-001 on imports in server-fn bodies**~~ — **FIXED S34** (`881b411`). Codegen emitted imports correctly; scope-resolver `case "import-decl"` returned `tAsIs()` without binding names. Fix: bind each name from `importNode.names` as `kind: "import"` into scope chain. +6 tests in `import-scope-registration.test.js`.
21. ~~**Bug B + F (6nz) — `let x = A; if (c) x = B` emits shadow or derived-declare**~~ — **FIXED S34** (`70190a7`). Shared root: `IfOpts` and for/while helpers didn't accept/thread `declaredNames`, so nested bodies got fresh empty `declaredNames` and outer `let` bindings were invisible to the inner tilde-decl reassignment branch. Fix: widen signatures of `emitIfStmt`, `emitForStmt`, `emitWhileStmt` to accept `declaredNames`; thread through all nested `emitLogicBody` calls; dispatch in `emit-logic.ts` passes `opts.declaredNames`. +10 tests in `let-reassignment-in-branch.test.js`.
22. ~~**Bug C (6nz) — multi-statement arrow bodies dropped in call args**~~ — **FIXED S34** (`127d35a`). `arr.map((n, i) => { if (...) return n*2; return n })` compiled to `arr.map()` — entire callback lost. Two paired fixes: (a) `expression-parser.ts` CallExpression case now threads `rawSource` into arg recursion; arrow case slices its own raw via ESTree `node.start/end` with shape-validation fallback; (b) `rewrite.ts` adds `skipPresenceGuard` flag + `rewriteExprArrowBody` variant, consumed by `emitEscapeHatch` for Arrow/Function EscapeHatchExprs. +8 tests in `arrow-block-body-in-call-arg.test.js`.
23. ~~**GITI-005 — `${serverFn()}` in markup drops fetch result**~~ — **FIXED S34** (`e585dba`). Expression has no `@`-refs, so reactive-display-wiring loop skipped entirely; fetch fired at module top with result dropped. Fix: `buildServerFnNames(fnNameMap)` detection via `_scrml_(fetch|cps)_` prefix; when binding expression uses a server fn, emit async IIFE `(async () => { try { el.textContent = await (expr); } catch (_e) { el.textContent = ""; } })();`. Mixed `${@var + serverFn()}` also covered. +7 tests in `server-fn-markup-interpolation.test.js`.
24. ~~**GITI-003 — server-only imports leak to .client.js**~~ — **FIXED S34** (`e5f5b22`). `import { getGreeting } from './engine/probe.js'` used only inside server-fn bodies still wrote to `.client.js`, 500'ing browser load. Fix: post-emit prune pass in `emit-client.ts` drops imports with no client-body usage. Scoped to non-special paths (`scrml:`, `vendor:`, `.client.js` always preserved). `testMode` bypass for fixture-only unit tests.
25. ~~**GITI-004 — `lift <expr>` in server fn lowers to DOM code**~~ — **FIXED S34** (`e5f5b22`). Handler body emitted `_scrml_lift(() => document.createTextNode(...))` — uses `document` and client-only helper in Bun server context. Fix: added `boundary: "server" | "client"` to `EmitLogicOpts`; `case "lift-expr"` in server boundary emits `return <expr>;`; `emit-server.ts` threads `{ boundary: "server" }` through 6 fn-body emission sites (CPS/non-CPS × CSRF/non-CSRF × body-iter/last-stmt-return). +5 tests in `server-client-boundary.test.js`.
26. ~~**GITI-001 — `<request>` empty-URL fetch + unawaited `@data = serverFn()` Promise**~~ — **FIXED S34** (`d23fd54`). Two-part fix: (a) `emit-client.ts` post-emit rewrite wraps `_scrml_reactive_set("X", <stub>(ARGS))` in `(async () => _scrml_reactive_set("X", await <stub>(ARGS)))()` using a manual paren-depth walk (not regex) so nested args work; (b) `emit-reactive-wiring.ts` `emitRequestNode` returns early when no `url=` attribute. `<request url="...">` regression-guarded. +6 tests in `request-tag-and-server-fn-reactive.test.js`.

**All 11 S34 adopter bugs verified PASS by giti** 2026-04-20 in `handOffs/incoming/read/2026-04-20-1558-giti-*.md` (formalized follow-up: **GITI-006** — markup `${@var.path}` emits module-top bare read that throws on async-initialized reactives; pre-existing emission shape, low-priority per giti).

**S37–S38 fixes:**

27. ~~**Bug 1 (string escape)**~~ — **FIXED S38** (`41aa7c0`). 8 STRING-token re-quote sites double-escaped backslashes. Fix: `reemitJsStringLiteral`. +11 tests.
28. ~~**Bug 3 (return after ternary-const dropped)**~~ — **FIXED S38** (`3778d76`). `collectExpr` angle-bracket tracker bumped unconditionally on `<` after IDENT. Fix: value-position check. +11 tests.
29. ~~**Bug 5 (for-lift wrapper accumulation)**~~ — **FIXED S38** (`b37769c`). Outer `_scrml_effect` re-created wrapper div per mutation. +6 tests.
30. ~~**GITI-010 (CSRF bootstrap unbootstrappable)**~~ — **FIXED S38** (`40e162b`). 403 response didn't Set-Cookie. Fix: Option A (mint-on-403 + client retry). +9 tests.
31. ~~**Bug 4 (derived-reactive markup wiring)**~~ — **FIXED S38** (`adbc30c`). `collectReactiveVarNames` missed `reactive-derived-decl`. +8 tests.
32. ~~**Mixed-case for-lift hoist**~~ — **FIXED S38** (`8691f75`). Hoist for-lift setup outside effect for mixed keyed-reconcile + reactive reads. +11 tests.
33. ~~**`emit.raw` classifier bug**~~ — **FIXED S38** (`cfb1a14`). `testExprNode` missed MemberExpr callee `emit.raw`. +7 tests.

**S39 fixes:**

34. ~~**Bug I (name-mangling bleed)**~~ — **FIXED S39** (`6b3e63f`). Lookbehind `(?<!\.)` missed spaced member expressions. Fix: `(?<!\.\s*)`. +7 tests.
35. ~~**Bug J (markup-interp helper hides reactive)**~~ — **FIXED S39** (boundary security merge). `extractReactiveDeps` didn't recurse into function bodies. Fix: call-graph BFS. +15 tests (in boundary-security suite).
36. ~~**NC-4 (`_ensureBoundary` fail-open)**~~ — **FIXED S39** (boundary security merge). Graduated from silent console.warn to diagnostic fail-safe with `SCRML_STRICT_BOUNDARY=1` strict mode.
37. ~~**Bug H (function-rettype match drops return)**~~ — **FIXED S39** (`39782f0`). Missing `return` before match IIFE when function has return-type annotation. Fix: `hasReturnType` flag + implicit return. +5 tests.
38. ~~**Bug K (sync-effect throw halts caller)**~~ — **FIXED S39** (`686ffcd`). `_scrml_trigger` dispatched effects without try/catch. +5 tests.
39. ~~**GITI-009 (relative-import forwarding)**~~ — **FIXED S39** (`e926983`). Server JS emitted import paths verbatim from source. Fix: `rewriteRelativeImportPaths()` post-processor. +16 tests.
40. ~~**GITI-011 (CSS at-rule handling)**~~ — **FIXED S39** (`8b80138`). `tokenizeCSS()` had no `@` handler. Fix: `CSS_AT_RULE` token type + passthrough emission. +19 tests.

**S40 fixes:**

41. ~~**fix-lift-sql-chained-call (orphan `.method()` after lift+SQL)**~~ — **FIXED S40** (`15a0698`). `lift ?{`SELECT...`}.all()` in server functions emitted `return null; /* server-lift: non-expr form */` followed by orphan `.all()` chain. Pre-existing on bare `b3c83d3`; surfaced during Bun.SQL Phase 1 verification. Fix: `consumeSqlChainedCalls` helper in `ast-builder.js` (handles both IDENT and KEYWORD method names — `get` is KEYWORD, latent bug caught mid-impl); `emit-logic.ts::case "lift-expr"` extended to handle new `kind:"sql"` variant emitting `return await _scrml_sql\`...\`;`. Examples 03/07/08 now compile cleanly. +13 tests.
42. ~~**Bun.SQL Phase 1 — `?{}` codegen migration**~~ — **LANDED S40** (`6e21f76`..`cd8dea1`). SQLite branch now emits Bun.SQL tagged-template per SPEC §44 (was: `_scrml_db.query("...").all()`; now: `await _scrml_sql\`...\``). `.prepare()` now compiles to E-SQL-006 per §44.3. `_scrml_db`→`_scrml_sql` codegen identifier rename for grep clarity. Loop hoist (§8.10) batch path uses `sql.unsafe(rawSql, keys)` (Bun.SQL SQLite branch rejects array binding). Transaction envelopes use `sql.unsafe("BEGIN DEFERRED")`. +3 tests; 7 source files + 7 test files.
43. ~~**SPEC §8/§44 reconciliation**~~ — **LANDED S40** (`74881ea`). §8 now describes source-language `?{}` method API; §44 owns the codegen target. Stripped `bun:sqlite`-specific codegen claims from §8.2/§8.4/§8.5.1, replaced with §44 cross-refs. §8.5.2 rewritten as "Removed" with bulkInsert example; §8.6 added E-SQL-006 + E-SQL-007.
44. ~~**Phase 4d Step 8 — `BareExprNode.expr` TS field deletion**~~ — **LANDED S40** (`e478c99`). Deleted `expr?: string` from `BareExprNode` in `compiler/src/types/ast.ts`. Hybrid resolution: kept `(node as any).expr` fallback reads in 7 meta-checker sites to avoid breaking 30+ tests with synthetic fixtures missing `.exprNode`. 10 source files touched.
45. ~~**Phase 4d Step 8 strict cleanup**~~ — **LANDED S40** (`c9ebc78`). Strict-deleted all 7 `(node as any).expr` fallback reads in `meta-checker.ts`. Updated 13 synthetic test fixtures across 4 test files. Surfaced + fixed 2 latent bugs the hybrid was masking: (a) `bodyUsesCompileTimeApis` `compiler.*` detection (added `exprNodeContainsIdentNamed`); (b) `exprNodeContainsCompileTimeReflect` missing `assign` kind + wrong field names (`.operand`→`.argument`, `.test`→`.condition`).
46. ~~**fix-lift-sql-chained-call-parallel-sites**~~ — **LANDED S40** (`06c27f0`). Extracted `consumeSqlChainedCalls` helper, applied at all 4 BLOCK_REF chained-call sites in `ast-builder.js`. +6 tests.
47. ~~**Bun.SQL Phase 2 — Postgres driver resolution**~~ — **LANDED S40** (`9ef0ccb`). New `compiler/src/codegen/db-driver.ts` (151 LOC) for §44.2 URI resolution. `protect-analyzer.ts` Postgres URI path. RI `Bun.SQL` patterns. Driver-agnostic emission verified via sample compile. Negative paths: `mongodb://` → E-SQL-005 with `^{}` pointer. +47 tests. Real Postgres compile-time introspection deferred (would require async PA migration) — Phase 2.5 extension point in place.
48. ~~**fix-cg-sql-ref-placeholder**~~ — **LANDED S40** (`2a05585`). `return ?{...}.method()` from server fn used to emit `return /* sql-ref:-1 */;` instead of rewritten Bun.SQL call. Mirrors lift+sql pattern: detect SQL BLOCK_REF in `return-stmt` parse, build `sqlNode` field, recurse via `case "sql"` in emit-logic. +15 tests.
49. ~~**fix-cg-cps-return-sql-ref-placeholder**~~ — **LANDED S40** (`9d65a46`). Third sql-ref placeholder context: `@var = ?{...}` reactive-decl initializer in CPS-rewritten server context. New `tryConsumeSqlInit()` helper at ast-builder.js:1964; updated emit-server.ts CPS sites + emit-logic.ts case "reactive-decl" (server-boundary gated). Caught hidden secondary regression: `route-inference.ts::hasServerOnlyResourceInInit` was reading string init form — required RI updates so server functions whose only server-trigger was `@x = ?{...}` weren't silently demoted to client-side. +16 tests.
50. ~~**fix-cg-mounthydrate-sql-ref-placeholder**~~ — **LANDED S40** (`efcfaf5`). Fourth and final sql-ref context: client-side mountHydrate path used to emit `_scrml_reactive_set("var", )` empty-arg. Approach (b): suppress the bare reactive_set on client-boundary SQL-init reactive-decls (emit explanatory comment instead). Approach (a) — wire through `__mountHydrate` route — was investigated and rejected (would require spec amendment per §8.11). +5 tests.
51. ~~**LSP L1 "see the file"**~~ — **LANDED S40** (`e1827e6`). `lsp/server.js` refactored 965→235 LOC (thin transport shell); new `lsp/handlers.js` (1,273 LOC, testable without booting transport). Capabilities: `documentSymbolProvider` (Outline panel: state blocks, components, server/client functions, machines, db blocks), enhanced hover (function signatures, reactive/tilde badges, state block field types), completion-trigger fixes. Surfaced + fixed 2 pre-existing latent LSP bugs: `extractAnalysisInfo` was checking wrong AST kind names (analysis arrays were always empty); `detectContext` brace-balance ignored bare `{` inside logic contexts. +38 tests.
52. ~~**LSP L2 "see the workspace"**~~ — **LANDED S40** (`14cc1d1`). New `lsp/workspace.js` (440 LOC) — workspace cache with `exportRegistry: Map<filePath, Map<exportName, ExportInfo>>`, `fileASTMap`, `importGraph`. MOD-only cross-file pipeline (CE deferred to L3 since L2 only needs export-decl spans, not expanded markup). Cross-file go-to-definition + cross-file diagnostics with proper spans. Verified via stdio smoke tests. +29 tests.
53. ~~**LSP L3 "scrml-unique completions"**~~ — **LANDED S40** (`24712f5`, with bundled `lsp-cleanup-retired-bpp-import` removing `runBPP` import + call). The "impossible in any other ecosystem" features: SQL column completion (driven by PA's existing `views` Map of `<db tables>` schemas), component prop completion (works cross-file via virtual component-def synthesized from `export.raw` since exported components live in `ast.exports` not `ast.components`), cross-file import-clause completion. +37 tests.
54. ~~**LSP L4 "standards polish"**~~ — **LANDED S40** (`c51ad15`). New `lsp/l4.js` (~600 LOC). `signatureHelpProvider` with trigger characters `["(", ","]` — synthesizes function shape from `export-decl.raw` for cross-file imported fns. `codeActionProvider` quick-fixes for top 5 error codes: E-IMPORT-004 (Levenshtein-rank closest exported name), E-IMPORT-005 (prefix bare specifier with `./`), E-LIN-001 (prefix var with `_`), E-PA-007 (Levenshtein-rank closest column from PA views), E-SQL-006 (drop `.prepare()`). +53 tests.

L5 (semantic tokens) explicitly DROPPED from active roadmap per 6nz consultation 2026-04-25 — their spatial annotation panels are the load-bearing surface, TextMate covers broad-strokes coloring needs.

**S50 fixes (1 track shipped to main):**

65. ~~**Phase 2g — `if=`/`else-if=`/`else` chain branches mount/unmount via per-branch B1 dispatch**~~ — **LANDED S50** (merge `b362b33`). Extends Phase 2c B1 (single-`if=`) to chain branches. Each branch compiles per its cleanliness: clean branches → `<template id="..."><inner></template><!--scrml-if-marker:...-->` (per-branch B1 emission inside a single `<div data-scrml-if-chain="N">` chain wrapper); dirty branches → `<div data-scrml-chain-branch="K" style="display:none"><inner></div>` retained as fallback. New `isCleanChainBranch()` helper at `emit-html.ts:138` strips chain attrs then defers to `isCleanIfNode` so cleanliness criteria match Phase 2c B1 verbatim. Strip-precursor (`stripChainBranchAttrs`) preserved in BOTH paths. Chain controller (`emit-event-wiring.ts`) emits `_update_chain_<chainId>()` that dispatches per `branchMode: "mount" | "display"` — clean branches go through `_scrml_create_scope` + `_scrml_mount_template` / `_scrml_unmount_scope`; dirty branches toggle `style.display`. `LogicBinding` interface in `binding-registry.ts` extended with `branchMode`, `templateId?`, `markerId?`, `branchIndex` for the controller. **Honors §17.1.1 line 7533** ("only one span exists in the DOM at any time") for clean branches. Greenlit design from deep-dive `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` — Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch. Eliminated Approach C (DOM-keep + scope-swap) on §17.1.1 amendment cost + cross-ecosystem reversal + S49 validation principle. **No new runtime helpers** (Phase 2c B1 helpers reused verbatim). **No spec amendment.** New `chain-mount-emission.test.js` with 31 tests (N1-N31) covering all 4 emission shapes (all-clean / mixed / all-dirty / multi-branch) + controller wiring + initial render + branch swap + strip-precursor + reactive flip. ~5 assertion updates in `else-if.test.js`; N31 anti-leak invariant unchanged. +1,035/-79 across 7 files. **Routed-to-Phase-2h findings (NOT 2g regressions):** (a) pre-existing chain-controller condition-emission bug for `if=@var == literal` (compiles to `_scrml_reactive_get("var")` instead of comparison; confirmed pre-existing, preserved verbatim); (b) 6/6 deep-dive §7 allow-list samples (recipe-book / blog-cms / quiz-app / kanban-r11 / api-dashboard / gauntlet-r11-task-dashboard) fail upstream BS/TAB/TS pipeline errors — pre-existing, deep-dive warned. **Phase 2h skipped per user** — originally "small T1 sweep" but became "triage 6 upstream failures first"; Phase 2g's 31 unit tests cover all observable shapes; pivot direct to 3-5k LOC dispatch app.

**S49 fixes (8 tracks shipped to main):**

64. ~~**`compiler.*` phantom (audit row 1 + 4 phantom rows total)**~~ — **CLOSED S49** (Option B, merge `4fb5cec`). Removed `compiler.*` regex + helper from `meta-checker.ts` COMPILE_TIME_API_PATTERNS; deleted `exprNodeContainsIdentNamed("compiler")` wire-up; mirror deletion in `compiler/self-host/meta-checker.scrml` AND `stdlib/compiler/meta-checker.scrml` (recon missed the second; both kept in sync); rebuilt `compiler/dist/self-host/meta-checker.js` as gitignored artifact. Added E-META-010 (reserved-namespace diagnostic — fires when `^{}` block contains any `compiler.X` reference). Backfilled E-META-009 (nested `^{}` inside compile-time meta) into §22.11 + §34 housekeeping. Added `compiler` to META_BUILTINS to suppress 4-error diagnostic cascade → 2-error. SPEC §22.4 amended; §22.8 example trimmed. Tests: 2 classification fixtures deleted, 1 misleadingly-named test renamed (body untouched), 4 new tests cover E-META-010 firing + reflect/emit/bun.eval regression-guard + E-META-009 firing. SPEC-INDEX line-drift realigned as side effect. **The 2 pre-existing test fails (Bootstrap L3 timeout + tokenizer self-host parity check) RESOLVED as side effect** — net +16 pass, -2 fail. Recon: `docs/recon/compiler-dot-api-decision-2026-04-29.md`.

63. ~~**Tailwind 3 — arbitrary values (`p-[1.5rem]`) + variant expansion (dark/print/motion-safe/motion-reduce)**~~ — **LANDED S49** (merge `b18fa8e`). New §26.4 "Arbitrary Values" with §26.4.1 validation rules + §26.4.2 cross-feature interaction. New `parseArbitraryValue`/`validateArbitraryCss`/`resolveArbitraryValue`/`wrapWithVariants`/`splitClassNameSegments`/`balancedParens`/`validateUrlBody` helpers. New `THEME_MEDIA_QUERIES` table (4 theme variants). `parseClassName` rewritten: returns `{breakpoint, theme, state, base, hasUnrecognizedPrefix}` (preserving silent-strip-bug fix from #62). New constants `ARBITRARY_PREFIX_MAP`, `ARBITRARY_OVERLOADED_PREFIXES`, `VALID_CSS_UNITS` (full v3+v4 set: px/em/rem/%/vh/vw/vmin/vmax/ch/ex/lh/rlh/pt/pc/in/cm/mm/Q/fr/s/ms/deg/rad/grad/turn/Hz/kHz/dpi/dppx/dpcm/svh/lvh/dvh/svw/lvw/dvw/cqw/cqh/cqi/cqb/cqmin/cqmax), `VALID_COLOR_FUNCTIONS` (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color/color-mix), `VALID_MATH_FUNCTIONS` (calc/min/max/clamp/var), `VALID_CSS_KEYWORDS` (auto/none/inherit/initial/unset/revert/revert-layer/currentColor/transparent). E-TAILWIND-001 minted: invalid bracket content fires compile-time error (per S49 user validation principle). Cross-feature: `md:p-[1.5rem]`, `lg:hover:bg-[#ff00ff]`, `dark:bg-[var(--theme)]` all work. `escapeCssClass` extended (escape comma/plus/asterisk/whitespace). +680 LOC source, +381 LOC tests (64 new tests in `tailwind-classes.test.js` §19/§19b/§19c/§19d). Recon: `docs/recon/tailwind-arbitrary-values-and-variants-2026-04-29.md`.

62. ~~**Phase 2c B1 — `if=` mount/unmount via template + marker (clean-subtree path)**~~ — **LANDED S49** (merges `c543859` precursor + `7ce8b55` main). Phase 2c re-enabled the deferred Phase 2b emit-html block. Clean-subtree `if=` elements compile to `<template id="...">` + `<!--scrml-if-marker:N-->` placeholder; client-JS controller calls `_scrml_create_scope` + `_scrml_mount_template` on truthy / `_scrml_unmount_scope` on falsy. SPEC §17.1 (DOM existence) + §6.7.2 (LIFO scope teardown) honored. **Precursor commit (`934f62d`):** `stripChainBranchAttrs()` helper strips `if=`/`else-if=`/`else` from chain branch elements before `emitNode` recursion, preventing B1 double-fire on chain branches (latent bug closed independently of B1; safe regardless of approach; N31 regression test added to `else-if.test.js`). **Main commit (`fcbe4e1`):** uncommented dead Phase 2b block; 24 test assertions updated across 4 files; new `if-mount-emission.test.js` with 22 tests covering N1-N9 emission shape + N12-N15 binding shape + N16-N21 controller + N22-N24 round-trip. **Phase 2c covers ONLY the narrow path** (lowercase tag, all-static descendants); cleanliness gate (`isCleanIfNode` at `emit-html.ts:77-97`) rejects events / reactive interp / lifecycle / components / bindings / transitions, all fall back to display-toggle. Phase 2 completion verification recon (`phase2-completion-status-2026-04-29.md`) finding: 2d/2e/2f are NON-tasks (closed by gate); **2g is real T2 work** (chain branches still display-toggle, §17.1 spec divergence); 2h is small T1 sweep. Implementation-strategy deep-dive at `scrml-support/docs/deep-dives/if-mount-unmount-implementation-strategy-2026-04-29.md` recommended B1 default; B4 (DOM-keep + scope-swap) eliminated on cross-ecosystem + stale-DOM event hazard + Svelte 5 PR #603 grounds; B5 (compile-time-static + hide-on-init) parked for SSR work. **Most surprising finding:** today's display-toggle has flash-of-wrong-content bug for initial-false (no inline `display:none`) — B1 IMPROVES initial-false FCP; only "regression" is initial-true blank, industry-standard prior-art cost. +26 net tests.

61. ~~**W-TAILWIND-001 warning for unsupported Tailwind syntax**~~ — **LANDED S49** (merge `c543859`) + **PA-corrective edit `2a10d04`** (detector consults `getTailwindCSS` first; updates SPEC §26.3 paragraph + §34 row). New `findUnsupportedTailwindShapes()` detector in `compiler/src/tailwind-classes.js` wired into pre-BS lint loop in `compiler/src/api.js` next to `lintGhostPatterns`. `maskInterpolations()` brace-balances over `${...}` regions to avoid ternary false-positives (real adopter scenario from `gauntlet-r10-svelte-dashboard.scrml`). Detection rule: skip names without `:`/`[`; skip names the engine handles (`getTailwindCSS !== null`); fire on remaining Tailwind-shape (unsupported variants like `dark:` (pre-Tailwind-3), `print:`, `motion-*:`, `group-*:`, custom prefixes; arbitrary values pre-Tailwind-3). **PA-corrective edit ALSO closed `parseClassName` silent-strip bug** — `weird:p-4` previously returned CSS for `.p-4` (selector mismatch with source class — silent failure violating S49 validation principle). Now `hasUnrecognizedPrefix` flag returns null. After Tailwind 3 merge, the warning narrows to: only group-*/peer-*/custom prefixes still fire; arbitrary values + dark/print/motion-* produce CSS. 47 tests in `compiler-warnings-tailwind.test.js` (was 38 + 9 net adjusted post-Tailwind-3). +44 net tests across both commits.

60. ~~**Tutorial Pass 2 — promote `if=` to Layer 1 + state-opener list + glossary fork**~~ — **LANDED S49** (merges `49b623e` Subgroup A + `a29295a` Subgroup B). 14 mechanical edits per recon `tutorial-pass2-edit-list-2026-04-29.md`. New §1.8 in tutorial.md promoting `if=` to a Layer 1 section; new `01h-if-chains.scrml` snippet (~25 LOC); §2.5 trim (the casual line-199 mention now superseded by §1.8); §1.1 updated with proper 11-element state-opener list per SPEC §4.2; glossary line 1615 fork into two entries. FLAG-01 (mount/unmount-vs-display drift) honored via observable-behavior wording; FLAG-02 (bare-attribute `else`) called out plainly; FLAG-04 (state openers tags not yet taught) marked "(SPEC-only-for-now)" / "(later pass)". 3 files +106/-16 lines. Pass 1 fixes were S48; Pass 3-5 (~30h) NOT STARTED.

59. ~~**E-META-004 numbering gap (housekeeping)**~~ — **CLOSED S49** (commit `c116331`). The §22.11 + §34 error code tables had E-META-001/002/003 then jumped to 005..010, with no row for 004. Added explicit "Reserved — do not reuse" rows in both tables. Reuse-prohibition rationale: error codes are stable identifiers in adopter bug reports, prior design notes, and search hits; reusing 004 for an unrelated future error would silently confuse anyone grepping for the old usage. Future codes SHOULD start at E-META-011.

58. ~~**Hook drift fix — `.git/hooks/pre-commit` synced to canonical `scripts/git-hooks/pre-commit`**~~ — **CLOSED S49** (PA-direct, no commit needed for hook file change). The active `.git/hooks/pre-commit` was running ALL tests including browser, blocking worktree commits with 132 ECONNREFUSED fails when `samples/compilation-tests/dist/` was empty. The in-repo canonical excludes browser tests + adds `--bail` + emits branch-warning on main. Now aligned. Note: post-commit + pre-push hooks have no in-repo equivalents (those are existing scripts that haven't been migrated to scripts/git-hooks/).

**S49 verifications (no code change):**

57. ~~**`lin` Approach B (§35.2.2 cross-`${}` block) — implementation status uncertain**~~ — **VERIFIED 2026-04-29 (S49 recon).** The S48 audit's "implementation status uncertain" was an **inventory miss**. Approach B is FULLY IMPLEMENTED AND TESTED: `type-system.ts:6230 checkLinear` runs once at file scope; `walkNode` default case (lines 6814–6823) recurses into both `body` + `children` so sibling-block decl/ref share one tracker; `emit-logic.ts:1283` hoists single `const` at program scope. **6 cross-block tests in `compiler/tests/unit/gauntlet-s25/lin-cross-block.test.js`** (S25 vintage) cover §35.2.2's normative surface (B1 cross-block decl/consume, B2 markup-interpolation consumption, intermediate-ref → E-LIN-002, scope-exit → E-LIN-001, double-consume across blocks, two parallel lin vars). Sibling tests `lin-005-shadowing.test.js` + `lin-006-deferred-ctx.test.js` complete §35.2.2 / §35.5 coverage. The audit looked only at `samples/compilation-tests/lin-*` (which has lin-001/lin-002 as doc-fixtures only) and missed the gauntlet-s25 unit-test surface. Recon: `docs/recon/lin-approach-b-verification-2026-04-29.md`. Audit row 124 + Top-5 drift item 4 + Open question 1 + fix-the-cracks item 18 all updated to reflect VERIFIED state. No code change required. Optional doc-fixture `samples/compilation-tests/lin-003-cross-block.scrml` could be added for parity (not required for verification).

**S48 fixes:**

55. ~~**if/show split — Phase 1: `show=` as visibility-toggle directive**~~ — **LANDED S48** (`9873e0e`). Pre-S48: `show=@var` was a tutorial-taught feature with NO codegen support; `show=@x` compiled as a generic HTML attribute. Post-S48: dedicated visibility-toggle directive emitting `data-scrml-bind-show` placeholder; `emit-event-wiring.ts` routes `isVisibilityToggle` through display-toggle codegen path (currently shares `isConditionalDisplay` output, will diverge in Phase 2c when `if=` flips to mount/unmount); end-to-end verified `<p show=@verbose>` → `<p data-scrml-bind-show="X">` + `el.style.display = _scrml_reactive_get("verbose") ? "" : "none"` wrapped in `_scrml_effect`. SPEC §17.2 already had correct normative text — no spec change needed. Test fixtures `samples/compilation-tests/control-show-{basic,expr}.scrml`. 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; `show=count` (no `@`) still produces literal HTML attribute (no regression). Net test delta: -11 (5 obsolete cases deleted, 5 updated).
56. ~~**Tutorial Track A (9 small fixes from freshness audit Pass 1)**~~ — **LANDED S48** (`9873e0e`, bundled with Phase 1). `@@user` ghost removal, `@server` non-feature note correction, `lin` deferral language update, snippet bugs, `onkeydown` event-arg correction, et al. From the freshness audit Pass 1 set; Track B (the if/show wording realignment) is gated on Phase 2c completing the impl flip.

---

## N. Open work (current truth, prioritized)

### P1 — Language Completeness
- [x][x] **Bun.SQL multi-driver target** (S40). SPEC §44 ratified Bun.SQL as the unified SQL codegen target. Phase 1 ✅ S40 (`6e21f76..cd8dea1`) — SQLite branch migrated to `await _scrml_sql\`...\`` tagged-template. Phase 2 (Postgres URI + introspection) in progress. Phase 3 (MySQL) deferred.
- [x][x] **§54 State-local transitions** (insight 21, S31–S33). Ratified S32 (`1d1c49d`): substates declared inside state blocks, transitions declared positively on their states (`validate() => < Validated> { body }`), `pure fn` modifier + E-STATE-COMPLETE + substate match exhaustiveness. Phase 4a–4g implementation end-to-end S33 (`36320ab..37f21f7`): block-splitter transition-decl recognition, AST node, StateType.transitions registry, `from` contextual keyword + param binding, E-STATE-TRANSITION-ILLEGAL call-site check, E-STATE-TERMINAL-MUTATION field-write check, fn-level purity in transition bodies per §33.6. Phase 4h (return-type narrowing at transition call site) still open — blocked on §54.6 code-assignment gap (NC-3).
- [x][x] **DQ-12 (Phase A)** — `is not`/`is some` on **parenthesized** compound expressions. **IMPLEMENTED S2 2026-04-10 (dq12-phase-a)** — `_rewriteParenthesizedIsOp` in `rewrite.ts`, temp-var single-evaluation per §42.2.4. Phase B (bare compound form, no parens) deferred as future work.
- [x][x] **DQ-7** — CSS `#{}` scoping strategy. **DECIDED + IMPLEMENTED S2 2026-04-10 (dq7-css-scope)** — native CSS `@scope` (Approach B). `emit-css.ts` + `emit-html.ts` + SPEC §9.1 + §25.6 rewrite landed. `data-scrml` attribute, donut scope, flat-declaration `#{}` → inline style.
- [x][x] **DQ-11** — WebSocket / server-push. Spec complete (§38). **CLI implementation complete S2 2026-04-10 (websocket-cli-batch)** — 6 bugs fixed in dev.js/build.js/emit-channel.ts, channel runtime unblocked end-to-end.
- [x][x] **Lin spec gaps — §35.2.1 working E2E as of S4.** Batch A ✅ S2; Batch B ✅ S3 (§35.2.1 lin-params parser + type-system, merge `90f1630`); Batch C Step 1 ✅ S4 (TS-G wiring fix, merge `503f5b9`); Batch C Step 2 PARKED in favor of structured expression AST migration. **§35.2.1 lin function parameters now work end-to-end for the first time** as of Phase 2 Slice 1+2 (Slice 1 merged S4 `9151f1a`, Slice 2 + ast-builder gap closures merged S4 `45208c6`). See P5 expression AST migration for ongoing work.
- [x][x] **if/show split** (S48-S50 multi-phase). Tutorial-vs-spec-vs-impl 3-way drift surfaced by `tutorial-freshness-audit-2026-04-29.md`. **Phase 1** ✅ S48 (`9873e0e`) — `show=` shipped as visibility-toggle directive (see §M #55). **Phase 2:** convert `if=` to true mount/unmount per SPEC §17.1 / §6.7.2. Sub-phases: 2a ✅ runtime helpers + `isMountToggle` flag (`90f8d16`); 2b ⚠️ emit-html early-out written + DEFERRED to 2c (`e62a11f`); 2c ✅ S49 single-if= clean-subtree mount/unmount via template+marker (merge `7ce8b55`, see §M #62); 2d/2e/2f closed by gate (verification recon `phase2-completion-status-2026-04-29.md`); **2g ✅ S50** chain branches mount/unmount via per-branch B1 dispatch (merge `b362b33`, see §M #65); 2h skipped (deep-dive §7 allow-list samples blocked on pre-existing upstream errors; Phase 2g unit tests cover observable shapes). **Phase 2 effectively closed**, modulo upstream sample-suite triage as a separate work-item. User-confirmed next step: 3-5k LOC trucking dispatch app.
- [ ][ ] **`compiler.*` decision** (S48 audit #9 finding) — `compiler.*` is a phantom: meta-checker classifies `compiler.*` references but meta-eval doesn't implement them. User code passes classification, then ReferenceErrors at evaluation. Worst-of-both-worlds. Decision still open: implement a minimal read-only API OR remove from §22.4 classification.
- [ ][ ] **`auth=` design-completeness** (S48 audit #9 finding) — `auth=` is undocumented in spec but shipped in impl; tutorial documents it. Today only `auth="required"` is recognized; `loginRedirect=` / `csrf=` / `sessionExpiry=` siblings work but are tutorial-untaught. **Deferred per user "I would really like to see the gap first"** — let the 3-5k LOC dispatch app's role-based gating needs surface real friction before deciding multi-value `auth=` vs `<program auth>` (presence-only) vs separate role attribute.
- [ ][ ] **Browser-language overclaims** (S48 audit #9 finding, deferred) — sidecar `<program lang="...">`, WASM `mode="wasm"`, supervised restarts: spec-defined, no codegen exists. Browser-language article overclaims. **Per user 2026-04-29: "no amendments to published articles for now"** — parked, not abandoned.
- [ ][ ] **Tailwind utility engine narrower than intro article advertised** (S48 audit #9 finding, deferred) — SPEC-ISSUE-012: arbitrary values, variant prefixes, custom theme not shipped. Same "no amendments for now" stance.

### P2 — DX
- [x][x] **Ghost error mitigation** — lint pre-pass landed S2 (ghost-lint-prepass, 10 W-LINT-* patterns, +71 tests). S30: ghost-lint diagnostics now visible by default (`f0e7222`). S30: +5 Vue/Svelte patterns W-LINT-011..015 (`e8ddc8d`).
- [x][x] **Adopter friction audit** — S30 (`a6ce8c6`), 13 findings. 4 critical landed same session: CSS tokenizer compound-selector fix (`2eb4513`), bin-script executable mode (`8217dd9`), ghost-lint default visibility (`f0e7222`), Vue/Svelte lint patterns (`e8ddc8d`). F5 missing-@-sigil silent break fixed S31 (`ebd4d1d`). F6 init-safety + F10 README bun-link S31 (`26df45d`). F7 audit error (false positive, no fix needed).
- [x][x] **11 adopter-blocking codegen bugs** (5 giti + 6 6nz) — all 11 fixed S34 (`aa92070..d23fd54`), verified PASS by giti. See §M items 17–26.
- [ ][ ] **GITI-006** — markup `${@var.path}` emits module-top bare read that throws on async-initialized reactives (e.g. `_scrml_reactive_get("data").value;` executes before the awaited fetch-stub set resolves). Pre-existing emission shape, formalized by giti 2026-04-20 as low-priority follow-up (workaround: `@data = { value: null }` default).
- [ ][ ] Async loading stdlib helpers (RemoteData — deferred)
- [ ][ ] Async loading sugar (Approach E — deferred)
- [x][x] **F8 + F9 scaffold polish** (scrml init `package.json` + `README.md` + inline orientation comments) — still open from S30 deferred list, carried through S31/S32/S33/S34.
- [x][x] **Fix example 12** — ex12-component-normalize S2. Examples now 14/14 clean.
- [x][x] **Library mode type declarations** — R18 #2 verified fixed S2 (was already resolved by prior work; regression tests + sample added via library-mode-types batch)

### P3 — Self-host completion (DEFERRED post-S30 public pivot)
- [ ][ ] CE + ME self-host (not yet ported) — deferred
- [ ][ ] Idiomification: ts.scrml (2,570), ast.scrml (3,539) — ~6,109 lines — deferred
- Three S29-surfaced adjacent bugs (export-decl name extraction for `export class X`; export-decl body scope check for `export function X`; destructuring `const { a, b } = ...` fragmentation) also deferred per S30 pivot decision.

### P4 — SQL Batching (spec-drafted S16 2026-04-14, awaiting user sign-off)

Compiler-level SQL batching in two tiers. Pipeline addition + §8 extensions + §19.10 amendment.

- [x][ ] **Deep-dive** — `scrml-support/docs/deep-dives/sql-batching-2026-04-14.md` (10 design forks, 3 clusters, prior-art table for DataLoader/Prisma/Drizzle/Hibernate/Ecto/EdgeDB/Hasura/ActiveRecord)
- [x][ ] **Debate** — `debate-sql-batching-2026-04-14.md` + `design-insight-sql-batching-2026-04-14.md`. Winning positions: F1.A (Stage 7.5) · F2.A (syntactic + D-BATCH-001) · F3.A (Map lookup) · F4.A (implicit per-handler tx, `!`-only) · F5.C (mode-split errors) · F6.A (Map preserves iteration order) · F7.A (read-only v1) · F8.A+C (`.nobatch()` single opt-out — pragma dropped per reviewer) · F9.C (coalesce mount reads, writes 1:1) · F10.B (re-run E-LIFT-001 post-rewrite)
- [x][ ] **Reviewer + boundary-analyst reports** — reviewer BLOCK on F4.A resolved by bounding implicit tx to `!` handlers + new §19.10.5 + E-BATCH-001 composition error. Boundary analyst confirmed no classification changes, flagged `__mountHydrate` synthetic route aggregator requirement for F9.C.
- [x][ ] **Spec draft** — `scrml-support/archive/spec-drafts/spec-draft-sql-batching-2026-04-14.md`. Contains new §8.9 (per-handler coalescing), §8.10 (N+1 loop hoist), §8.11 (mount hydration), §19.10.5 amendment, new PIPELINE Stage 7.5 Batch Planner, new errors E-BATCH-001/002 + E-PROTECT-003 + D-BATCH-001. Prerequisite: resolve `.first()` vs `.get()` naming in §8.3.
- [x][x] **User sign-off on spec draft** — S16 2026-04-14.
- [x][x] **§8.3 `.first()` / `.get()` reconciliation** — `.get()` wins. 17 occurrences replaced across SPEC. S16 2026-04-14.
- [x][x] **Spec land** — §8.9/8.10/8.11, §19.10.5, new errors E-BATCH-001/002 + E-PROTECT-003 + D-BATCH-001 + W-BATCH-001 added to `compiler/SPEC.md`. SPEC-INDEX regenerated. S16 2026-04-14. Tests clean (6153/14, no regression).
- [x][x] **PIPELINE edit** — Stage 7.5 Batch Planner with `BatchPlan` / `CoalescingGroup` / `LoopHoist` contract + determinism/idempotency/boundary invariants. S16 2026-04-14.
- [x][x] **Tier 1 impl — Slice 1 `.nobatch()` marker** (§8.9.5) — commit `77bfa7b` S16. SQLNode.nobatch flag; ast-builder strips `.nobatch()` from chainedCalls in all three code paths; rewrite.ts pre-passes the string form. 8 tests.
- [x][x] **Tier 1 impl — Slice 2 BatchPlan scaffold + Stage 7.5 wiring** — commit `ad2f59e` S16. `compiler/src/batch-planner.ts` (670 LOC); `--emit-batch-plan` CLI flag. 7 tests.
- [x][x] **Tier 1 impl — Slice 3a candidate-set detection** — commit `fc30239` S16. `analyzeForLoop` + server function-decl walker. E-BATCH-001 (composition) + W-BATCH-001 (explicit BEGIN suppression). 9 tests.
- [x][x] **Tier 1 impl — Slice 3b implicit envelope codegen** — commit `8d68dc0` S16. `BEGIN DEFERRED` / try / COMMIT / catch-ROLLBACK around `!` handler CSRF-path IIFE. `needsImplicitEnvelope(funcName)` helper. 6 tests.
- [x][x] **Tier 2 impl — Slice 4 loop-hoist detection** (§8.10.1) — commit `3a55e67` S16. D-BATCH-001 near-miss diagnostic (4 reasons). 11 tests.
- [x][x] **Tier 2 impl — Slice 5 rewrite** (§8.10.2) — commit `3238af2` S16. Pre-loop `keys.map` + placeholders + `.all(...keys)` spread + `Map<key, Row>` + per-iteration `.get(x.id) ?? null` lookup. Module-level `_hoistMap` singleton avoids opts threading across 9 emit-server call sites. 8 tests.
- [x][x] **Tier 2 impl — Slice 5b E-BATCH-002 runtime guard** — commit `a0e5b3e` S16. `keys.length > 32766` check. 2 tests.
- [x][x] **Tier 2 impl — Slice 5b remainder** — E-PROTECT-003 (SELECT column-list parser + overlap check against `protectedFields`; `SELECT *` expands to every protected column; hoist is refused on overlap) and `verifyPostRewriteLift` (defensive §8.10.7 re-check — emits E-LIFT-001 if a hoist's `sqlTemplate` contains `lift(`). `BatchPlannerError.code` widened. Commit `f951064` S17. 6 tests.
- [x][x] **F9.C mount-hydration (Slice 6)** — `__mountHydrate` synthetic route aggregator. `collectServerVarDecls` + new `callableServerVarDecls` lifted to `collect.ts`. Client emits one unified `/__mountHydrate` fetch + demux when ≥2 callable `server @var`; fallback to per-var IIFE otherwise. Server emits `_scrml_route___mountHydrate` (POST) with `Promise.all` parallel loader dispatch. Writes stay 1:1 per §8.11.3. Commit `40a76c4` S17. 13 tests across 8 groups.
- [x][x] **Tier 1 + Tier 2 microbench** — `benchmarks/sql-batching/bench.js` + `RESULTS.md`, on-disk WAL `bun:sqlite`, 50 iters after 5 warmups. Tier 1 (read-only, 4 reads): 1.05× — snapshot consistency is the main win. Tier 2 scaling: **1.91× @ N=10, 2.60× @ N=100, 3.10× @ N=500, 4.00× @ N=1000**. Commit `42988ab` S17.
- [x][x] **README promotion** — "Why scrml" updated S17 to state "the compiler eliminates N+1 automatically" with link to `benchmarks/sql-batching/RESULTS.md`.

**Deferred-complexity log (post-v1):** Tier-2 writes × `<machine>` transitions (§51); Tier-2 writes × `server @var` optimistic rollback (§52.4.2); tuple-WHERE key inference; F9 revisit inside explicit `transaction { }`; `--show-batch-plan` runtime observability.

### P5 — Architectural refactors
- [x][x] rewrite.ts visitor pattern (done S80)
- [ ][ ] TS migrations: ast-builder, block-splitter (tokenizer done)
- [ ][ ] Codegen IR (typed instruction nodes)
- [x][ ] **🏗 STRUCTURED EXPRESSION AST MIGRATION (multi-phase, in progress S4 2026-04-11)** — replace string-form expression fields (`init`, `expr`, `condition`, etc.) with structured `ExprNode` trees throughout the compiler. Root cause fix for lin enforcement, tilde precision, dep-graph edges, protect analyzer scoping, LSP identifier features, error span precision, and spec tightness. Design doc: `scrml-support/docs/deep-dives/expression-ast-phase-0-design-2026-04-11.md` (2028 lines, all 10 OQs decided).
  - **Phase 0** ✅ S4 — design ratified, OQs answered (notably: lin keyword promotion, lin-decl emission in Phase 2, idempotency invariant)
  - **Phase 1** ✅ S4 (merge `e43b7a2`) — `ExprNode` discriminated union in `types/ast.ts` (+392 LOC), `parseExprToNode`/`esTreeToExprNode`/`emitStringFromTree` in `expression-parser.ts` (+789 LOC, builds on existing Acorn parser), parallel ExprNode fields populated by `ast-builder.js`. 84 new unit tests.
  - **Phase 1.5** ✅ S4 (in `e43b7a2`) — swapped round-trip invariant from string-equality (broken: token-joined vs compact JS) to idempotency: `parse(emit(parse(x))) deep-equals parse(x)`. `deepEqualExprNode` helper added. Audit found only 3 escape hatches in 14-file corpus (3.66%, all C-style for loops in `13-worker.scrml`).
  - **Phase 2 Slice 1** ✅ S4 (merge `9151f1a`) — `lin` promoted to KEYWORDS in `tokenizer.ts`, `lin-decl` node emission added to both `ast-builder.js` parse loops, `case "lin-decl"` codegen case added to `emit-logic.ts` (was previously dropped silently). 13 new integration tests.
  - **Phase 2 Slice 2** ✅ S4 (merge `45208c6`) — `checkLinear` migrated to walk `ExprNode` trees via `forEachIdentInExprNode` (in `expression-parser.ts`) and `scanNodeExprNodesForLin` (in `type-system.ts`). **§35.2.1 lin function parameters work E2E for the first time** (the headline win for the entire migration). 9 new e2e scenarios pass (declare/consume, double-consume → E-LIN-002, never-consumed → E-LIN-001, branch asymmetry → E-LIN-003, lin-params, shadowing across function-decl scopes, lambda capture conservative). Two `ast-builder.js` `bare-expr` `exprNode:` gap closures (lines 2009 and 3962) included. Pass 2 string-scan fallback retained as a documented staging pattern until Slice 3 fixes `collectExpr` — primary path is the structured ExprNode walk; fallback is bounded with a precise removal condition.
  - **Phase 2 Slice 3** ✅ S5 — `collectExpr` newline-boundary fix. One-line deletion of redundant `lastTok !== startTok` identity guard in `ast-builder.js:875` (+ self-host twin). All six symmetric decl forms (`lin`, `let`, `const`, `const @reactive`, `tilde`, `@debounced`) now respect newline-as-statement-boundary for declaration RHS. +11 regression tests.
  - **Phase 2 Slice 4** ✅ S6 — deleted Pass 2 string-scan fallback from `scanNodeExprNodesForLin` (-240 LOC). `extractAllIdentifiersFromString`, `extractIdentifiersExcludingLambdaBodies`, the Pass 2 block, and the `consumedThisNode` dedup set all removed. ExprNode walker is now the sole lin enforcement path.
  - **Phase 2 MustUseTracker migration** ✅ S6 — `scanNodeExpressions` now walks ExprNode parallel fields via `forEachIdentInExprNode`; `tilde-decl` case walks `initExpr` directly. String fallback retained for nodes without ExprNode fields (Phase 1 gaps).
  - **Phase 2 remaining passes** ✅ S6 — all semantic passes migrated: protect-analyzer, extractReactiveDeps, dependency-graph, meta-checker, error-effect callee extraction. All have ExprNode-first paths with string fallback.
  - **Phase 3 — codegen migration** ✅ S7–S11. `rewriteExpr(string)` → `emitExpr(ExprNode)` across ~14k LOC codegen. `emit-expr.ts` (290 LOC, all 19 ExprNode kinds), 45+ `emitExpr` call sites. S11: `emitExprField` helper consolidates 27 dual-path ternaries across 6 codegen files.
  - **Phase 3.5 — escape hatch elimination** ✅ S8. Drove 19.86% → 0% via `shouldSkipExprParse()` guard.
  - **Phase 4a — ExprNode wiring + HTML fragment reclassification** ✅ S9. Wired exprNode on 12 unwired bare-expr creation sites across all 3 parse loops (+119 gaps). Added `HtmlFragmentNode` type — reclassified 137 bare-expr HTML fragments as `kind:"html-fragment"` with `content` field. Updated emit-logic, emit-lift, type-system. Coverage **86.2% → 98.8%**.
  - **Phase 4b — error-arm block handlers** ✅ S9. `_parseHandlerExpr` strips braces before parsing. 4 gaps closed. Coverage **98.8% → 99.0% (1858/1876)**.
  - **Phase 4c — C-style for-loop verification** ✅ S9. All 11 C-style for-loops confirmed to have `cStyleParts` with ExprNodes. No code changes needed.
  - **Phase 4 remaining gaps:** 18 irreducible (11 C-style iterables covered by cStyleParts, 3 `.all()` SQL chains, 4 `.Variant :>` match patterns). No further coverage improvement possible.
  - **Phase 4d — drop string fields** ✅ S40. Steps 1-7 merged S39 (ExprNode-first paths across body-pre-parser, component-expander, type-system, dependency-graph, meta-checker). Render preprocessor merged S39 (`1e304c8`) — `render name()` → `__scrml_render_name__()` placeholder unblocks structural matching. **Step 8 (`BareExprNode.expr` field deletion)** ✅ S40 (`e478c99`) — TS field deleted; consumer migration hybrid (kept `(any).expr` fallback in 7 meta-checker sites for synthetic test fixtures). Strict-deletion follow-up filed.
  - **Phase 5 — self-host parity** port `compiler/self-host/ast.scrml` (3,551 lines).
  - All other P1/P2 work continues in parallel unless it touches expression fields.

### P6 — Research (deferred to post-beta)
- Package manager alternative, scrml-native import system, sidecars, WASM, `?{}` multi-db, WASM sigils, `use foreign:`, refinement types, var reuse optimization.

---

## O. Pending cleanup (post-split)

- [x][x] **Non-compliance audit** (S2 2026-04-10) — 13 docs reviewed, 3 dereffed to `scrml-support/archive/`, 3 updated in place, 1 deleted (`shared/` fiction), 6 kept. See hand-off-2.
- [x][x] **Cold project map** (S2 2026-04-10) — re-enabled with scope discipline (`node_modules`, `dist`, framework-comparison benchmarks excluded; master-list as spine). 10 maps + INDEX + non-compliance written to `.claude/maps/`. Incremental refreshes S30, S33 (with `PHASE-4-TOUCH-POINTS.md` artifact for Phase 4), S34.
- [x][x] **Verify VS Code extension builds** (S2 2026-04-10) — added `@types/node` to devDeps, `bun install` + `bunx tsc` clean, produces `out/extension.js` (83 lines, `node --check` OK). Added `editors/vscode/{out,bun.lock}` to root `.gitignore`.
- [x][x] **Install git hooks** (S2 2026-04-10) — copied pre-commit, post-commit, pre-push from scrml8 unchanged; all targets (`compiler/src/cli.js`, `compiler/src/index.js`, `benchmarks/todomvc/app.scrml`) exist in this repo. Hooks fire on next compiler commit. **Caveat:** `.git/hooks/` is not versioned — fresh clones won't have them. Consider mirroring into `scripts/git-hooks/` with an install script.

---

## P. Cross-repo references

- **scrml-support** — deep-dives, ADRs, gauntlet reports, user-voice, design insights, historical spec drafts, friction audits
- **scrml** — primary working copy of self-host .scrml modules (idiomification happens there)
- **giti** — collaboration platform + its spec
- **6nz** — editor + z-motion spec
- **scrml8** — frozen reference archive (do not edit)
