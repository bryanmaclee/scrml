# scrml — Recent Fixes & Work In Flight

A rolling log of what just landed and what's actively underway in the compiler. For the full spec and pipeline docs see `compiler/SPEC.md` and `compiler/PIPELINE.md`.

Current baseline (2026-05-08 S71 close — PA-VERIFIED): **9,734 pass / 64 skip / 1 todo / 3 fail** (full suite); ~9,028 pre-commit subset. The 3 fails are pre-existing self-host parity drift (F-BUILD-002 §3, Bootstrap L3, Self-host: tokenizer parity) per S66 self-host-deferred direction; pre-commit hook excludes them. **CORRECTION:** S70 hand-off recorded `9,752 / 60 / 1 / 0` — that was incorrect; the 3 self-host fails were always present at S70 close. **C1 Phase 0 SURVEY LANDED · cross-machine scrml-support reconciliation completed.** S71 was a docs-only session (3 commits — 2 scrmlTS + 1 scrml-support push); next phase is C1 implementation dispatch pending scrml-dev-pipeline agent staging on machine-A.

### 2026-05-08 (S71 — C1 Phase 0 SURVEY · cross-machine reconciliation · S70 accuracy gap)

Docs-only session, three commit threads. (1) Cross-machine staleness on scrml-support resolved (clone was 55 behind / 1 ahead origin since S48; load-bearing user-voice content rebased + chronologically re-inserted + pushed). (2) C1 Phase 0 SURVEY dispatched via general-purpose fallback (scrml-dev-pipeline agent file is missing on this machine; cross-machine staging gap, master inbox notice sent), landed via S67 file-delta protocol with verdict SCOPE-AMENDMENT-SUGGESTED. Three amendments PA-accepted + applied to BRIEF + A1c SCOPE. (3) S70 hand-off accuracy gap surfaced — full-suite fails were 3 (self-host parity drift), not 0; PA-verified independently.

- **scrml-support reconciliation** at `c275b31` (pushed mid-session). Local-only commit `6e25882` (S48 user-voice append, 82 lines including verbatim quotes for `first-principles, full-stack`, `Reception-fabrication`, `3-5k LOC line where languages start to show cracks`, `do it fat im switching machines`) was load-bearing recovery content — origin/main's `## Session 48 — 2026-04-29 [BACKFILL FLAG]` placeholder explicitly noted the verbatim quotes as missing. Resolution: pre-staged 4 backups in `/tmp/s71-scrml-support-recon/`, captured reflog HEAD anchor, `git pull --rebase origin main` triggered conflict on `user-voice-scrmlTS.md`, resolved via Python in-place merge (removed BACKFILL FLAG placeholder, inserted local block at S47/S49 chronological boundary, normalized header `## S48 —` → `## Session 48 —`, dropped leading `---` separator). Verified: zero conflict markers, 5,665 lines, 41 session headers, all 3 grep-anchored S48 phrases present at line 3775+.
- **C1 Phase 0 SURVEY LANDED** at `8ad94e5`. General-purpose dispatch (Tools: *), model `opus`, `isolation: "worktree"`. Self-contained brief with startup verification + 10 SURVEY deliverables + STOP-after-Phase-0 mandate. Worktree branch `worktree-agent-ac5b6dcfb8d28d416` retained for forensic. SURVEY (376 lines) confirmed BRIEF mostly correct with three amendments + caught 4 surprises: (1) Variant C compound parents structurally unemittable today (children silently dropped at codegen — wider gap than BRIEF flagged); (2) Tier 3 has latent JS-comma-operator codegen bug (`(a,b,c)` evaluating to `c`) — out of C1 scope, documented for C21; (3) `runtime-template.js:181` already routes `_scrml_reactive_get` → `_scrml_derived_get` for derived names (major infra assist for markup-typed derived consumption — zero `emit-html.ts` changes needed); (4) 3 pre-existing self-host fails detected on main HEAD. Cost estimate 4-6h holds via 7-WIP decomposition.
- **C1 Phase 0 SURVEY amendments APPLIED** at `75417fa`. (1) BRIEF §4.3 — accept ONE new runtime helper (`_scrml_default_set`) for `default=` storage per §6.8.1; compound-parent proxy reuses `_scrml_derived_declare` (Option A-prime) to avoid a second helper. (2) BRIEF §6.3 — test invariant is "no NEW fails," not "zero fails total" (baseline 9,734 / 64 / 1 / 3, NOT 9,752 / 60 / 1 / 0). (3) A1c SCOPE §4.5 — C1 row expanded to fold in Variant C compound + markup-typed-derived emission (was originally in C21); C21 row reduced to Tier 3 positional sugar only (~2-3h vs 5-7h); §4.7 emitted-locks row updated to §14.11 (M10).
- **scrml-dev-pipeline agent staging blocker surfaced.** This machine (machine-A) does NOT have `scrml-dev-pipeline.md` anywhere — uses a per-stage specialist pattern (`scrml-js-codegen-engineer` + ~30 siblings) instead. Implementation phase wants the pipeline persona's T1/T2/T3 tier classification. Master PA inbox notice at `/home/bryan/scrmlMaster/handOffs/incoming/2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` requests staging into `/home/bryan/scrmlMaster/scrmlTS/.claude/agents/`. User session restart required after staging.
- **S70 hand-off accuracy gap.** S70 PA recorded `9,752 / 60 / 1 / 0 (full)`; PA-verified at S71 open via `bun run test` shows actual `9,734 / 64 / 1 / 3`. The 3 fails are self-host parity drift (acknowledged not load-bearing per S66). Discrepancy: -18 pass / +4 skip / +3 fail. Pre-commit hook excludes self-host integration tests so commits aren't blocked. Recorded as standing-list item 133 — next-session PA should run `bun run test` at S-open to confirm baseline, NOT trust prior hand-off counts uncritically.
- **Tests:** S70 close 9,734 / 64 / 1 / 3 (actual; was reported as 9,752 / 60 / 1 / 0) → S71 close 9,734 / 64 / 1 / 3. **0 delta** (pure docs session).

**Standing patterns surfaced this session:**
- **Cross-machine drift can be content (S48 voice) AND tooling (scrml-dev-pipeline agent).** Future cross-machine pickups should sync-check BOTH at S-open. Master inbox dropbox is the right channel for tooling drift.
- **`bun run test` at S-open is mandatory.** Don't trust prior hand-off test counts — verify independently. The "verify compilation of every dev file" project-memory directive applies to PA self-verification too, not just dev agents.
- **S67 file-delta dispatch landing pattern works for general-purpose too.** Same flow — review diff, `git checkout <agent-branch> -- <files>`, single PA-authored commit. Worktree branch retained for forensic. Validated S71 on C1 SURVEY landing.
- **Phase 0 SURVEY catching SCOPE-AMENDMENT is the success case, not a problem.** SURVEY's job is to catch BRIEF / SCOPE drift before implementation. C1's three amendments saved the implementation phase from confusion (would have wasted ~30-60min discovering "ZERO new helpers" was unachievable, ~30min discovering test baseline was wrong, etc.).

### 2026-05-08 (S70 — A7 parser+typer COMPLETE · A1c kicked off · history-regex bugfix · 0 regressions)

A1c codegen+runtime phase officially started this session. A7 parser+typer (A5-2 + A5-3) both shipped. Plus the foundational A1c usage-analyzer (C0) shipped. PA-direct investigation of a C0 SHIP-report surprise revealed a real A5-2 regex bug; fix landed.

- **A5-2 SHIPPED** at `bdc491c` — parser support for §51.0.M-Q (S67 ratified extensions). Extended `engine-statechild-parser.ts` + `ast-builder.js` + `symbol-table.ts` types for `<onTimeout>` element + `history` bare attribute + `internal:rule=` prefix + `parallel` bare attribute + nested `<engine>` recognition + `.Variant.history` structured target form. `EngineRuleForm` Option A flag (`historyForm?: boolean` on single, `historyForms?: boolean[]` on multi). `.Variant.history` zero-source-change in expression-parser confirmed (B20 regex naturally produces `MemberExpr(IdentExpr ".Playing", "history")`). Pre-existing `findStateChildCloser` bug surfaced + fixed (nested engine block depth tracking via separate `scDepth` stack). Phase 0 SURVEY's PROCEED-AS-BRIEFED held; depth-of-survey-discount frequency-7 confirmed. +63 tests / 0 regressions.
- **A5-3 SHIPPED** at `a8a6bdf` — typer + symbol-table walker for §51.0.M-Q. NEW SYM PASS 16 (`walkValidateEngineA5Extensions`) consuming A5-2's AST shapes. Fires E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE + first compile-time E-ENGINE-INVALID-TRANSITION fire-site (`<onTimeout to=>` legality per §51.0.M line 20567 — statically privileged). `EngineMetadata` aggregation as annotated records (`{stateChildTag, ...}`) for codegen clarity. Aggregation entries reuse SAME EngineRuleForm/OnTimeoutEntry objects from `stateChildren` (no deep-copy) — codegen consumers can rely on object identity. **3 deferrals on infrastructure preconditions** (acknowledged + spec-faithful): `<onTimeout>` outside engine state-child placement (markup walker not present); `<onTimeout>` inside `<match>` block-form arm (block-form match parser not present); cascade-miss diagnostic message extension (direct-write compile-time fire-site doesn't exist). Inner-engine structural recursion DEFERRED to A1c. Sub-step 6 EMPIRICAL FINDING: parser pre-rejects `engine-decl` inside function bodies (zero walker code needed for §A5-3.9 cohesion). +54 tests / 0 regressions.
- **A1c C0 SHIPPED** at `846d1ef` — foundational feature-usage analysis pass. NEW module `compiler/src/codegen/usage-analyzer.ts` (702 LOC) + 1-line wire-in to `analyzeAll`. `FeatureUsage` bitmap with 14 validator predicates (imported from `validator-catalog.ts` constants — avoids drift) + 8 engine/temporal flags (engines/derivedEngines/engineHistory/Parallel/InternalRules/OnTimeout/Nested + onTransitionHooks) + 11 cross-cutting flags (channels/refinementTypes (boundary-only)/refinementTypesAny/validitySurface/renderSpec/markupTypedDerived/reset/defaultExpr/variantCCompound/bareVariantInference/programDocAttrs/typeAsArgument-stub). Cross-file traversal via existing `analyzeAll.files[]` (no import-graph code in C0). Soundness > completeness > minimal-output-size via structural-AST-kind triggers. ZERO new diagnostics, ZERO AST mutation, ZERO emission. Output-byte-shape stability by construction. +67 tests (target was +45 to +55; drove higher for soundness coverage of AST-only triggers + cross-file merge + kitchen-sink probe).
- **history-regex bugfix LANDED** at `8d0a6f2` — A5-2's `/\bhistory\b(?!\s*=)/` regex mis-matched `history` inside `rule=.Playing.history` (SPEC §51.0.N target form) because `.` is treated as word boundary by `\b`. Mis-classified `<Paused rule=.Playing.history>` as carrying `history` bareword → false-fired E-HISTORY-NO-INNER-ENGINE. Bug found via PA-direct kitchen-sink probe (canonical SPEC §51.0.N composite example as trigger). Tightened to standalone-token form `/(?:^|\s)history(?=\s|>|\/|$)/`. Defense-in-depth same fix on `pinned`/`parallel` regexes in ast-builder.js. +3 regression tests anchoring SPEC §51.0.N example. **Investigation chain documented** in hand-off-70 — C0 SHIP report's "B14 PASS 10.A coverage gap" framing was imprecise; B14 PASS 10.A is FINE; the agent's defensive substring scan in C0 happened to mask an UNRELATED real bug in A5-2's regex. C0 substring scan stays as legitimate defense-in-depth.
- **A1c C1 BRIEF PRE-DRAFTED** at `1b9bab1` — shape-aware cell emitter. Decoupled from C0 in scope. Closes pre-existing S61 Step 11.5 deferred Shape 3 V5-strict codegen gap. Phase 0 SURVEY mandate baked in. Ready to dispatch S71.
- **PA-side dispatch error recovered (S70 mid-session):** PA misdispatched a fresh `general-purpose` Agent without `isolation: "worktree"` after A5-2 SURVEY when intending to continue the existing agent. Caught immediately via TaskStop (before any source change leaked into main). Recovery: file-delta'd SURVEY from existing agent worktree + re-dispatched implementation with proper worktree isolation. Lesson logged in hand-off: harness can silently shift PA's CWD into a worktree after `git checkout` operations against worktree branches; `SendMessage` not always in deferred-tool list — re-dispatching with self-contained brief is the canonical fallback.
- **Tests:** S69 close 9,626 / 60 / 1 / 0 → S70 close 9,752 / 60 / 1 / 0. **+126 pass / 0 skip / 0 fail / 0 regressions.**

**Standing patterns surfaced this session:**
- **Depth-of-survey-discount frequency-8** confirmed (validated A5-2 + A5-3 + A1c C0 surveys all PROCEED-AS-BRIEFED with minor scope augmentations).
- **EngineMetadata aggregation as annotated records** is the canonical post-A5-3 shape — `Array<{stateChildTag, rule}>` / `Array<{stateChildTag, entry}>`. Codegen consumers (A5-4 / A1c engine wave) can rely on object identity (no deep-copy from stateChildren).
- **First compile-time E-ENGINE-INVALID-TRANSITION fire-site** (`<onTimeout to=>` legality) lands as A5-3 fire-site #3. Pattern reusable for future direct-write compile-time fire-sites when state-child body parser lands.
- **history/parallel/pinned bareword regexes** must use standalone-token form `/(?:^|\s)<token>(?=\s|>|\/|$)/` to avoid mis-matching inside structured-target forms like `.Variant.history`. Use this pattern for ANY future bareword detection.
- **Worktree CWD silent shift** — git operations against worktree branches can shift PA's CWD into the worktree. Verify `pwd` after `git checkout <branch> -- <files>` operations.

### 2026-05-08 (S69 — A1b CLOSER · Wave 5 COMPLETE · 22/22 steps shipped · 0 regressions)

A1b (resolve+type) is now FUNCTIONALLY COMPLETE. All 22 steps shipped across S63-S69. This session closed the cross-cutting Wave 5 bundle (B18 + B19 + B20 + B21 + B22). 9 commits. 2 PA-debug recoveries on background-dispatch API errors (B18 first try + B20 first try); B20 PA hands-on completion reduced 49 fails → 0 by surfacing pre-existing latent issues (match-arm payload binding never bound in typer scope; isArrayLikeArg shape recognition).

- **A1b B22 SHIPPED** at `a294815` — Wave 5 small-bundle (1/3). Closes A1a Step 9 deferral. Three valid `reset()` target shapes per §6.8.2: bare cell, whole compound, single-level compound nav. Multi-level compound nav (`reset(@a.b.c.d)`) ACCEPTED per Phase 0 deliberation (§6.3.5 V5-strict recursive composition; rejecting would create anti-symmetry with READ access). Spec amendment landed in same commit (§6.8.2 multi-level clarification + §6.3.5 cross-ref). NEW SYM PASS 14 (`walkValidateResetTargets`). NEW §34 row E-RESET-INVALID-TARGET. +25 tests.
- **A1b B19 SHIPPED** at `7ce01e4` — Wave 5 small-bundle (2/3). Closes D3 (S58) validation-gate deferral. Two sub-walks per SPEC §38.1 / §38.4 / §34: walkChannelPlacement fires E-CHANNEL-INSIDE-PROGRAM on `<channel>` with markupDepth >= 1; walkSharedModifier fires E-CHANNEL-SHARED-MODIFIER on any state-decl with `isShared:true`. Renumbered from B19's PASS 14 → PASS 15 during S69 file-delta merge (B22 took PASS 14 in parallel small-bundle). 6 test-fixture migrations (mechanical: v1 `@shared <x>:T=init` → v0.next V5-strict `<x>:T=init`; nested `<program><channel>` → top-level `<channel>` sibling). Both error codes already exist in §34 (lines 14251-14252) — no new catalog rows. +13 tests net (+14 unit -1 channel-inside-div removed). Surgical extraction landing pattern (S68 procedure validated again — branch was pre-B22 base; PA spliced B19 walker block atop B22's + renumbered).
- **A1b B18 SHIPPED** at `87cbd36` — Wave 5 small-bundle (3/3). L19 multi-statement event-handler validation (E-MULTI-STATEMENT-HANDLER) per SPEC §5.2.3 + §4.14. NEW helper module `multi-statement-scan.ts` exporting `scanForTopLevelSemicolon` (tracks paren/brace/bracket depth, single/double/backtick string state with escape, line/block comments, `${...}` template-literal interpolation depth). Two fire-sites: (1) ast-builder.js markup branch fires at TAB time on event-handler attribute multi-statement; (2) SYM PASS 11 (validateEngineStateChildrenAndRules, now exported) extended for engine state-child `:`-shorthand multi-statement. Brief's "OUT OF SCOPE" carve-out for `onserver:` / `onclient:` reversed during implementation per spec generality. **First dispatch hit API error mid-implementation** — PA salvaged Phase 0 SURVEY (saved as SURVEY-failed-dispatch-1.md) + re-dispatched cleanly. +55 tests / 0 regressions.
- **A1b B20 SHIPPED** at `79a1a96` — Wave 5 closer (1/2). Bare-variant inference §14.10 / M9 (E-VARIANT-AMBIGUOUS + E-TYPE-063). Helper `inferBareVariantsInExpr` walks bare-variant `IdentExpr` (S66-parser-fix shape) and resolves against LHS-derived contextType. Wired into state-decl + let/const-decl cases (positions 1 + 1b). Five supporting fixes: (a) variable-length lookbehind in `preprocessForAcorn` regex correctly excludes `MarioState . Fire`-style spaced member access; (b) `ast-builder.js shouldSkipExprParse` relaxed to NOT skip `.Variant`; (c) NEW match-arm-block Form 1b parser for `.VariantName(binding,...) => { block }` capturing `payloadBindings: string[]`; (d) typer match-arm-block walker binds payloadBindings into arm scope before walking body (closes pre-existing latent E-SCOPE-001 bug surfaced by parser fix); (e) `isArrayLikeArg` recognizes new `kind:"array"` shape. **PA-debug arc:** first dispatch hit API error mid-implementation; agent's `\s*` widening was too broad (49 test regressions). PA hands-on debug + finish reduced 49 → 0 fails. DEFERRED: positions 2/3/4/5/6 + compound-nav (require infra beyond B20). +81 tests net.
- **A1b B21 SHIPPED** at `c5f9dcf` — Wave 5 closer (2/2) + **A1b CLOSER**. Refinement-type three-zone §53 (boundary-zone hook recording + trusted-zone scope upgrade). **Depth-of-survey-discount HEAVILY realized:** Phase 0 confirmed existing `classifyPredicateZone` infrastructure (type-system.ts:1629) covered most ratified scope. Two surgical changes: (1) three-zone annotation completeness — `predicateCheck` records `{predicate, zone, sourceKind}` for ALL three zones (was: boundary-only); (2) scope-aware SourceInfo upgrade — new `upgradeSourceInfoForPredicatedIdent` makes T-PRED-4 trusted-zone elision reachable from real AST code. DEFERRED to A1c: locus-extension class (fn param/return, bare-expr reassignment, reactive-nested-assign) + HTML attr generation + trusted-zone elision optimization. DEFERRED to v0.3.0 / open SPEC-ISSUE: full SPARK three-zone, named-shape registry, constraint arithmetic, type-aliases for predicates, boolean predicates, L4 predicate vocabulary unification §55 ↔ §53. +27 tests / 0 regressions.
- **PA-debug recovery patterns surfaced (S69):** (a) Crashes mid-dispatch with API errors are recoverable — agent's incremental commits (per pa.md crash-recovery rule) preserve work; PA salvages Phase 0 SURVEY into archive name and re-dispatches with continuation context. (b) For complex regression chains (B20's 49 fails), PA hands-on debug is more efficient than re-dispatch retries — the agent had already done the right Phase 0 work; PA tightens the agent's too-broad regex changes. (c) "Right answer beats easy answer" Rule 3 application: when B20 had 1 LSP test failure remaining, Bryan chose "fix the LSP path first" over land-with-known-issue or skip-the-test — exposed the latent match-arm payload-binding bug + closed it correctly.
- **Tests:** S68 close 9,425 / 49 / 1 / 0 → S69 close 9,626 / 60 / 1 / 0. **+201 pass / +11 skip / 0 fail / 0 regressions.**

**Standing patterns surfaced this session:**
- **Worktree-as-scratch / file-delta** (S67 lock) continues to work cleanly when worktrees are based on current main. Stale-base worktrees still need surgical extraction (S68 procedure) but parallel-fired worktrees are predominantly clean.
- **Background-dispatch API errors** are a real failure mode — 2 instances this session out of 6 dispatches. Mitigated by (1) incremental WIP commits per crash-recovery rule, (2) salvaging Phase 0 surveys from failed worktrees as `SURVEY-failed-dispatch-N.md`, (3) re-dispatch with continuation context + brief amendments. PA hands-on completion is also viable when partial work has bugs that re-dispatch can't predictably resolve.
- **Depth-of-survey-discount continues to apply** — B21 was the most striking S69 example (existing classifyPredicateZone infra covered ratified scope; surgical 81-line type-system.ts diff + 27 tests vs 4-6h SCOPE estimate). Phase-0-survey-first pattern continues to deliver.

### 2026-05-08 (S68 — A5-1 spec amendments + A1b Wave 3 closer + A1b Wave 4 COMPLETE)

Substantial multi-arc session: spec amendments + 7 dispatches + 4 brief pre-drafts. **Two arcs:** (1) A5-1 spec amendments LANDED — §51.0 series gains M/N/O/P/Q for the S67 v0.2.0 scope expansion (DD-Harel hierarchy + Item C `<onTimeout>` + computed-delay relaxation + Machine Cohesion footnote + 2 new error codes); (2) A1b Wave 3 closer (B11+B12+B13) shipped, then Wave 4 (B14+B15+B16+B17) shipped. Bryan resolved 3 deliberation points during A5-1 (history target syntax = `.Variant.history` structured form; cascade placement = §51.0.Q bundled; `<onTimeout to=>` legality = strict-with-rule=*-escape).

- **A5-1 SPEC AMENDMENTS LANDED** at `1de05ef` — pure SPEC.md/SPEC-INDEX.md/PA-SCRML-PRIMER.md (no compiler code). §51.0.K Machine Cohesion footnote (singleton invariant articulated; nested engines permitted in composite state-children); §51.0.M `<onTimeout after=DURATION to=.Variant/>` element (Item C Candidate C; rides §51.12 runtime); §51.0.N `history` attribute on composite state-children + `.Variant.history` structured target form (shallow-only); §51.0.O `internal:rule=` prefix (preserves inner-engine lifecycle); §51.0.P `parallel` attribute on file-scope `<engine>` (naming sugar over §51.4); §51.0.Q hierarchy / nested engines + parent-rule cascade dispatch (Q.1 declarations + Q.2 cascade + Q.3 cascade-miss diagnostic + Q.4 interaction matrix); §51.12 cross-ref pointer to §51.0.M; §51.12.3.1 computed-delay relaxation (`${expr}<unit>`; both engine and machine forms); +2 §34 codes E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE; §4.15 + §24.4 structural-elements registries updated for `<onTimeout>`; SPEC-INDEX.md row + Quick Lookup +12 entries; primer §7.1 new sub-section. 0 test impact (markdown-only).
- **A1b B11 SHIPPED** at `e4a12fd` — synth-cell registry born via SYM PASS 8 (`walkRegisterSynthSurface`). Compound-rollup unconditional per §55.5 predictability rule. E-SYNTHESIZED-WRITE compound-scope dispatch joined to B8's PASS 6 walker. NO new DG edges (Phase 0 — B10 Phase 3 already wired cross-field validator-reads). +27 tests; depth-of-survey-discount #8.
- **B12 + B13 BRIEFS pre-drafted** at `15188ab` — committed mid-session so the dispatched agents could pull from main's git database.
- **A1b B13 SHIPPED** at `336e66a` — E-DERIVED-WITH-VALIDATORS rejection per §55.14 + Level-1 inline-override extraction (`ValidatorEntry.inlineOverride`) per §55.10. New SYM PASS 9. Per-arg-split landed in `ast-builder.js` + `validator-arg-parser.ts`; B10's previously-skipped tests activated. New §34 row E-VALIDATOR-INLINE-DYNAMIC + §55.14 footnote `[^55-14-parse-time]`. +22 pass / -2 skip.
- **A1b B12 SHIPPED** at `0671286` — per-field synth surface extends B11's registry. New `ScopeKind: "field"`; `parentField` discriminant. `lookupQualifiedStateCell` relaxed (drives B22 + IDE autocomplete). PASS 6 checks relaxed (compound-parent → 4 props; compound-child → 3 props excludes `submitted`). New `getPerFieldSynthRecords()` API. +31 tests.
- **WAVE 4 CLOSER BRIEFS pre-drafted** at `1023744` + `556f540` (B15 + B16 + B17 + HEAD-ref updates).
- **A1b B14 SHIPPED** at `934100e` — Wave 4 FOUNDATION. Engine cells join StateCellRecord family with `_cellKind: "engine"` + `engineMeta` (camelCase) per audit Option C. New `EngineMetadata` shape with BASIC + FUTURE A7 fields (forward-compat). PASS 10.A `walkRegisterEngines` + PASS 10.B `walkValidateCrossFileEngineMounts`. `autoDeriveEngineVarName(typeName)` per §51.0.C. MOD's `buildExportRegistry` extended for engine annotations. New §34 row E-ENGINE-MOUNT-NOT-ENGINE. E-COMPONENT-ENGINE-SCOPE engine-decl-inside-component fire DEFERRED to B17. +36 tests.
- **A1b B15 SHIPPED** at `40e0511` — engine state-child exhaustiveness + rule= typer + initial= validation. New SYM PASS 11. Validates `rule=` per §51.0.F three target-only forms. +5 new §34 catalog rows: W-ENGINE-INITIAL-MISSING, E-ENGINE-INITIAL-INVALID-VARIANT, E-ENGINE-STATE-CHILD-MISSING, E-ENGINE-STATE-CHILD-INVALID-VARIANT, E-ENGINE-RULE-INVALID-VARIANT, E-ENGINE-RULE-LEGACY-SYNTAX. New `engine-statechild-parser.ts` (385 lines, 6 EngineRuleForm shapes). +43 tests.
- **A1b B16 SHIPPED** at `773c38b` — derived engines (L20). SECOND consumer of B7's `detectCycle` reusability promise. New `engine-derived-reads` edge kind + `buildEngineDerivedAdj` filter. PASS 12 with two sub-walks gated on `derivedExpr.kind !== "legacy-source-var"` (avoids double-fire with §51.9 LEGACY E-ENGINE-017). Fires E-DERIVED-ENGINE-NO-INITIAL / -NO-RULES / -NO-WRITE / -CIRCULAR. +16 tests.
- **A1b B17 SHIPPED** at `0ca232e` — Wave 4 closer. Per Phase 0, only 1 of 8 audit brief items actionable today; remaining 7 gated on parser preconditions. New PASS 13 (`walkRejectEnginesInComponentDefChildren`) — fires E-COMPONENT-ENGINE-SCOPE on engine-decl in `component-def.defChildren`. Defensive scaffolding (engines never reach defChildren via parser today). +9 active +8 skip tests.
- **File-delta merge friction (S68 surfaced):** B16 + B17 worktrees branched from pre-B15 base; agent-side-stale-views in their full diffs. PA filtered via diff-vs-base + surgical extraction (head/tail splice for symbol-table.ts walker blocks; renumbered B16 PASS 11 → 12 and B17 PASS 11 → 13). Three-way merge attempted on B16 (5 conflicts); abandoned for surgical-extraction approach. Procedure validated for future parallel-from-stale-base dispatches.
- **Path-discipline incidents (resolved):** B14 and B17 both initially edited main repo paths instead of worktree. Agents detected via `git status` / `runSYM` side-effect probes; recovered via copy-then-restore. Pa.md F4 worked as designed.
- **Tests:** S67 close 9,241 / 54 / 1 / 0 → S68 close 9,425 / 49 / 1 / 0. +184 pass / +5 skip / 0 fail / 0 regressions.

**Standing patterns surfaced this session:**
- **Surgical extraction beats 3-way merge** when pre-base agent worktrees produce stale-view-heavy diffs. Procedure: diff-vs-base for clean view + extract specific blocks via shell pipeline (head/insert/tail) + renumber PASSes via sed.
- **Brief HEAD-ref updates** are a separate small commit before parallel-dispatch firing. Avoids brief content drift between dispatch ordering.
- **Forward-compat metadata fields** declared in B14's `EngineMetadata` (parentEngine, innerEngines, historyAttr, internalRules, parallelAttr, onTimeoutElements) without populating — A5-2/A5-3 dispatches consume the shape later.

### 2026-05-07 (S67 — file-delta landing methodology · B7+B8+B9+B10 ship · Wave-3-4-5 audits · S67 v0.2.0 scope expansion)

Substantial session with two arcs interleaved. **Arc 1 (engineering):** worked through A1b Wave 3 — B7 (derived-cell dep-tracking + E-DERIVED-CIRCULAR-DEP), B8 (L21 walker E-DERIVED-VALUE-MUTATE), B9 (validator-arg ExprNode conversion), B10 (three phases — predicate signature catalog + SYM PASS 7 type-checker walker + E-VALIDATOR-CIRCULAR-DEP via B7's generic `detectCycle` reuse). All landed via the new file-delta dispatch-landing pattern after Bryan flagged cherry-pick churn as the blocker on the original methodology. Plus full Rule-4 audit roster for Wave 4 (B14-B17 engine wave) + Wave 5 (B18-B22 cross-cutting bundled). **Arc 2 (design):** master-PA capability-gap audit + two synthesis-mode debate dispatches landed (DD-Harel hierarchy + effects-as-data middle path); user ratified scope expansion + resolved OQ-Harel-8 with `<engine>` everywhere; Machine Cohesion sharpened to articulate the actual singleton invariant; flip-conditions-null methodology rule recorded; tooling-uniformity corollary to Pillar 5 captured.

- **A1b B7 SHIPPED** at `7760fe4` — derived-cell dep tracking + E-DERIVED-CIRCULAR-DEP via Stage 7 generic `detectCycle` (renamed from `detectAwaitsCycle`) + `buildDerivedReadsAdj` filter + pure-`fn` filter via `fnPurityMap` + self-reference handling via `selfReferencingDerivedNodes: Set<NodeId>` + fail-fast on cycle per SPEC §6.6.10 line 2710. Survey-discount: ~75min actual vs 5-7h estimate. +22 tests.
- **A1b B8 SHIPPED** at `cbc0f59` — PASS 6 walker fires E-DERIVED-VALUE-MUTATE on three AST shape paths. Mutating-method + compound-assign catalog at new `derived-mutation-ops.ts` (frozen sets). E-SYNTHESIZED-WRITE deferred to B11 per audit §1.3 wave-ordering. +39 pass / +8 skip with rationale.
- **File-delta dispatch-landing pattern** locked at `05dc631` — supersedes worktree+cherry-pick (S43-S66) AND brief fast-forward-dispatch experiment (S67 first attempt). Per S67 user verbatim: *"branching dosnt work, agents ignore the directive and commit to main creating a mess every time. worktrees means the pa has to redo everything."* Pattern: `git checkout <branch> -- <files>` from main + single PA-authored commit. ~2min landing time vs cherry-pick's ~10-15min.
- **Wave 3 audits** at `ac93b3a` (B11+B12) + `0cc5632` (B9+B10 + §6.11 footnote) + `acd20b6` (B13). Each surfaces SCOPE drifts + spec-faithful corrections.
- **A1b B9 SHIPPED** at `70d7c5d` — validator-arg ExprNode conversion. New `RelationalPredicateNode` AST kind + `validator-arg-parser.ts` (NEW 268 LOC). Step 5 STRING-token quote-strip bug surfaced + fixed inline. Survey-discount: ~1h 10min actual vs 4-6h estimate. +36 tests.
- **A1b B10 (three-phase) SHIPPED** at `737835d` (catalog) + `f4fa2fe` (walker) + `539541f` (cycle detection):
  - Phase 1: `compiler/src/validator-catalog.ts` — 14 universal-core predicates per §55.1; reusable across L4 three loci. 26 tests. Catalog correction at S67: `req`/`is some` arity extended from `0` to `"0+inline"` per §55.10 inline-override syntax.
  - Phase 2: SYM PASS 7 walker — fires E-TYPE-031 family on arity / per-arg-shape mismatches. AST-shape recognition: `{kind:"lit", litType:"string"}` for strings, escape-hatch shapes for regex + bare-variant arrays. +20 pass / +2 skip (per-arg-split deferral).
  - Phase 3: dependency-graph extension — new `validator-reads` edge kind + `buildValidatorArgsAdj` filter consumed by B7's generic `detectCycle`. FIRST consumer of B7 reusability promise. +8 tests.
- **Wave 4 (engine) audits** at `a555e33` (B14) + `c89085d` (B15+B16+B17). B14 substantive: registration architecture (PA recommends `_cellKind: "engine"` + `_engineMeta` annotation hybrid). B15 surfaced §51.0.F-vs-primer-§7 syntax drift (corrected at `53825da`). B16 SECOND consumer of B7 reusability (E-DERIVED-ENGINE-CIRCULAR). B17 substantive expansion: validates BOTH `effect=` AND `<onTransition>` placement.
- **Wave 5 (cross-cutting) bundled audit** at `7a34226` — B18-B22 in one doc. B21 substantial existing-infra finding: `parsePredicateExpr` + `classifyPredicateZone` already in `type-system.ts:718,1629` (depth-of-survey-discount likely).
- **Primer §7 corrected** at `53825da` — canonical §51.0.F three target-only `rule=` forms; transitions via direct write `@phase = .X` or `.advance(.X)`; legacy `<machine>` arrow form explicitly called out.
- **§6.11 spec-prose footnote** at `0cc5632` — type-shape correction per §55.5-§55.7 canonical (parallel to S59/§6.6.8 + S66/§6.6.10 footnote precedents).
- **Master-PA inbox processed (2 messages):** capability-gap audit findings (1327) + debates-complete-with-OQ-Harel-8-blocker (1347). Three deep-dive audits identified real gaps (engine hierarchy, state-timeouts, effects-as-data); two debate-curator dispatches landed verdicts. Insights 22 + 23 appended to `scrml-support/design-insights.md` at `20ff7f6` (master can't write to scrml-support; user said "in our court now").
- **OQ-Harel-8 resolved** — user verbatim S67: *"pick engine, that feels right"*. Machine Cohesion (2026-04-17) sharpened to articulate actual singleton invariant. Pillar 5 (no per-kind mini-DSLs) load-bearing; tooling-uniformity (CLI promotion + migration stay context-blind) operational reinforcement.
- **Item C audit** at `docs/audits/item-c-temporal-engine-rule-migration-rule4-audit-2026-05-07.md` — temporal-rule surface migration `<machine>` → `<engine>`. Three candidate syntaxes analyzed; `<onTimeout>` structural element recommended (Pillar-5-compliant + symmetric with `<onTransition>`).
- **S67 v0.2.0 scope expansion** authorized by user verbatim: *"we shoud start planning out and adding these features to all the roadmap documents and such"*. Master-list §0 updated with Phase A7 (~50-80h) + Phase A8 (~6-12h). IMPLEMENTATION-ROADMAP.md extended with §2.5 + §2.6. New `docs/changes/v0next-inventory/SCOPE-SUPPLEMENT-2026-05-07.md`.
- **Tests:** S66 close 9,090 / 44 / 1 / 0 → S67 close 9,241 / 54 / 1 / 0. +151 pass / +10 skip / 0 fail / 0 regressions.

**Standing patterns surfaced this session:**

- **File-delta dispatch-landing pattern** (S67 ratified at pa.md commit `05dc631`) — supersedes cherry-pick AND fast-forward attempts.
- **Flip conditions are not a feature-adoption gating mechanism** (S67 methodology rule).
- **Tooling-uniformity corollary to Pillar 5** (S67 user observation).
- **B7 reusability promise validated** — first consumer (B10) confirms; B16 will be second.

### 2026-05-07 (S66 — A1b B4+B6 ship · narrowing reversal · pa.md Rules 1-4 · self-host deferred · Tier B full matrix)

Substantive methodology + impl session. 38 commits. The S65 narrowing-error precedent (dropping `==` from spec because corpus showed zero occurrences) was reversed early in S66 — Bryan flagged the structural mistake; PA executed the principled fix (preprocessor enables `.Variant` as primary expression in any operator context), reverted 4 commits, re-shipped Tier B on the full predicate matrix. The reversal arc became the founding precedent for pa.md Rule 4 (spec is normative; derived planning docs are NOT). A second precedent followed almost immediately when a B4 dispatch agent caught PA's "cycle detection" framing in the brief contradicting every spec quote about pinned-cell forward-reference rules — same shape of error.

- **A1b B4 SHIPPED** at `0ff3817` (cherry-pick of 5 worktree commits) — import binding registration + E-STATE-PINNED-FORWARD-REF source-position rule + E-IMPORT-PINNED-INVALID best-effort fire (Option A: `function`/`fn`/`type`/`channel` definitively-wrong kinds; const/let deferred to B14 with explicit known-limit comment for engine-aware export-registry annotation). +32 tests. Predecessor agent's Phase 0 STOP report caught PA's cycle-detection brief error pre-implementation.
- **A1b B6 SHIPPED** at `d1b7f1e` (3 cherry-pick commits) — render-by-tag classifier (PASS 5 in `symbol-table.ts`). Fires E-CELL-NO-RENDER-SPEC + E-CELL-RENDER-SPEC-NOT-BINDABLE per Phase 0 dispositions. +19 tests. PascalCase `<MyComp/>` deferred to B14/M18/M20 (component-prop catalog territory).
- **S66 narrowing reversal** — 4 reverts restoring SPEC §56 + SCOPE.md + docs to pre-narrowing state. **Parser fix at `cb167b1`**: bare-dot variants parseable as primary expressions everywhere via `preprocessForAcorn` rule mirroring `is .Variant`. Lint + CLI extended to recognize both `op: "is"` and `op: "=="` over leading-dot ident RHS as variant-tag checks.
- **Promotion ergonomics Tier B SHIPPED** on full predicate matrix — `bun scrml promote --match` AST→AST span-rewrite + I-MATCH-PROMOTABLE lint with three message shapes. `--engine` flag stays in CLI but prints "deferred to Tier C" + exits 2.
- **Tier C SCOPE** at `289b4a3` — `docs/changes/promotion-ergonomics/TIER-C-SCOPE.md`. ~9.5-18h single-session shippable.
- **pa.md "Design discipline" section** at `c744b19` (Rules 1-3) + `6768132` (Rule 4) — load-bearing for every PA session until v0.2.0 ships. Two precedent-error narratives recorded inline.
- **Self-host bootstrap DEFERRED** at `b9ed76f` + clarification at `7a213b9` — entire self-host scrml compiler human-authored (not just bootstrap); processed through scrmlTS. v0.2.0 estimate reduces from 280-440h to 240-360h.
- **A1c roadmap Rule-4 audit** at `f9ab867` — 1 substantive drift (validator catalog `email/url/numeric/integer/custom` claimed as universal-core but NOT in SPEC §55.1; same drift in primer §8 — corrected at `eba2df0`). 1 minor incompleteness (schema lowering table). Per-step Rule-4 survey gates table at audit §3 (24 entries).
- **A1b B7 + B8 Rule-4 audits** at `ac23dde` + `5f1b925` — pre-dispatch. B7 finding: SCOPE underspecifies — transitive function-call dependencies required by SPEC §31.5. + spec naming drift §6.6.10 still uses `E-REACTIVE-005` — fixed via rename footnote at `9064767`. B8 finding: wave-ordering caveat — SCOPE puts B8 (Wave 1) firing E-SYNTHESIZED-WRITE which depends on B11 (Wave 3).
- **Maps cold-start refresh** at `7df773f` — first real refresh since S40. LOC drift visible: ast-builder.js +2,156, expression-parser.ts +687, SPEC.md 20,442→24,911 lines, tests 370→447 files.
- **Master-driven docs site refresh** — change-1 (extract styles) at `afaa6b6`, change-2 (Bun build script + templates) at `26ebfc9`. PA validation + commit; did NOT proactively run `bun run docs:build` per Rule 1.
- **Spec rename footnote** §6.6.10: `E-REACTIVE-005` → `E-DERIVED-CIRCULAR-DEP` at `9064767`. Sibling pattern to §6.6.8 S59 footnote.

**Standing patterns surfaced this session:**

- **Spec-vs-derived-doc drift is the single biggest source of session-rework cost.** S66 narrowing reversal cost ~10 commits to restore baseline. Rule 4 + pre-emptive Rule-4 audits (~30min/audit) caught at least 2 more drift cases pre-dispatch.
- **Killed-agent-reuse pattern.** When PA accidentally TaskStops a mid-flight agent, its survey commit is salvageable via cherry-pick. Re-dispatch with Phase 0 baked-in skips re-survey.
- **CWD-slips-into-worktree-dir hazard.** PA running `git -C <worktree>` commands can leave CWD set there; subsequent `git cherry-pick` lands on worktree branch instead of main.
- **Workflow concern surfaced (Bryan, mid-session):** cherry-pick overhead + perceived "double-dipping" between agent and PA. Hand-off §"Bryan's workflow concern" lists 4 candidate evolutions for S67 deliberation.

### 2026-05-06 (S65 — parseVariant SHIPS · A1b foundation B3+B5 · 5-dispatch parallel wave converges)

Substantial session: started as deliberation (Zod deep-dive + debate-05 + parseVariant SCOPE+SURVEY) and accelerated into the largest parallel compiler-work wave in scrmlTS history — 5 concurrent background dispatches converging cleanly on main with 0 regressions. parseVariant ships as the first L22 family member. A1b's foundational PASS-3 (B3) + PASS-4 (B5) annotation contracts now expose `_resolvedStateCell` + `_cellKind` for downstream consumers. Debate-04 carry-forward fully closed. Promotion ergonomics Tier A creates the CLI surface + ratifies SPEC §56; Tier B is concrete-substrate-defined and can fire next session.

- **parseVariant SHIPS at `f963a75`** — L22 family member #1 fully realized. SPEC §41.13 + §53.14 + §34 (4 codes) + family-precedent doc (scrml-support `5efdd05`) + primer §13.6/§13.7 + kickstarter §3a. 18 new tests (8 unit + 10 integration); ParseError-as-builtin-tEnum fix unblocks cross-file resolution. `parseShape` closed as intentional absent (synonym with §53 boundary refinement).
- **A1b B3 — `@name` resolution at `2433dc7`** (depth-of-survey discount #8) — ~2h actual vs 4-6h estimate. PASS 3 in `compiler/src/symbol-table.ts` walks every `@`-prefixed `IdentExpr`, annotates `_resolvedStateCell` (StateCellRecord | null | undefined). `getResolvedStateCell(ident)` read API exported. +11 tests; 0 regressions. Powers B5/B7/B10/B22 + promotion ergonomics + A1c C0.
- **A1b B5 — cell classifier at `b24aaad`** (depth-of-survey discount #9) — ~1.5h actual vs 3-5h estimate. PASS 4 in symbol-table.ts classifies every state-decl as `"plain" | "bindable" | "markup-typed" | "compound-parent"`. `getCellKind(decl)` + `isCellBindable(decl)` exported. +11 tests. Bindable tag set (`input`/`textarea`/`select`) sourced from `codegen/emit-html.ts` for canon alignment. Powers B6 + B7.
- **A+ verdict #1+#2 at `b661c0b`** — debate-04 carry-forward execution. Pattern 16 in lint-ghost-patterns.js: did-you-mean: match enrichment on E-SWITCH-FORBIDDEN + W-LIFECYCLE-CANDIDATE tightening (predicate `^[A-Z][A-Za-z0-9]*$` for enum-tag-shaped string-literal RHS). +15 unit tests. Carry-cost paid: rewrote 2 internal `switch (type.kind)` blocks in `stdlib/compiler/meta-checker.scrml` to if-else chains (the language now dogfoods its own anti-pattern lint). Quickfix infrastructure deferred to future LSP/code-action dispatch (enriched-message-text used today).
- **ast-builder grammar fixes at `b661c0b` + `50b6af3`** — three small grammar findings landed (commit attribution wrong due to S65 concurrency hazard; work itself is verbatim correct):
  - F1: `export function NAME() {}` now synthesizes a sibling `function-decl` with `exported: true, fromExport: true` (codegen skips fromExport=true to avoid double-emission)
  - F2: `export * from './path'` parses as `re-export-all`
  - F3: `export { A as B } from './path'` (and local rename) parses with `renames: [{exported, local}]`
  - +18 unit tests. Module-resolver propagates new graph entries; api.js seeder follow-up (chase `localName` + `re-export-all`) queued.
- **api.js cross-file stdlib enum re-export gap at `8479e6d`** — Phase 2 Risk #1 follow-up. `importedTypesByFile` seeder rewrite at lines 790-895 + auto-gather pre-pass regex extension at lines 448-505 (`/(?:import|export) ... from/`). Future stdlib enum additions (e.g., `serialize`'s `SerializeError`) work without builtin-status grants. +5 tests. Adjacent finding documented: only the seeder fix wasn't sufficient; the auto-gather had to compile re-export targets too.
- **Promotion ergonomics Tier A at `bc42547`** — CLI stub (`compiler/src/commands/promote.js`) + SPEC §56 (full normative spec for `bun scrml promote --match`/`--engine`) + §34 catalog row + primer §11/§13.8 + kickstarter §6 + new section in tier-ladder-promotion article. Tier B (lint detection + AST→AST transformation, ~25-41h scope-revised UPWARD) properly scoped for follow-up dispatch. **Honest scope-revision-up, not the discount pattern** — `bun scrml migrate` is regex-based not AST-aware; the CLI scaffolding carries forward but the transformation logic is novel work. Span-based AST→AST rewrite path recommended in SURVEY.md.
- **Predicate-gaps deep-dive SCOPE prep at `c8104fa` (scrml-support)** — frontload SCOPE doc for the 4 P1-promoted gaps (#8 aliases, #9 reqIf, #12 async, #17 transform). ~1,762 words. `#9 reqIf` corroborated as most-urgent. Trigger conditions explicit (A1c real-app friction OR adopter blocker OR SPEC-ISSUE-§53.13.1-4 touch). Deep-dive itself fires later when corpus signal warrants.
- **Companion follow-up dev.to article + X-snippet** drafted/ratified earlier in S65 — `published: false` awaiting Bryan post.

**Standing patterns surfaced this session:**

- **Depth-of-survey-discount counter is now 9.** B3 (#8) and B5 (#9) both confirmed. The pattern continues to fire reliably for "new infrastructure needed" claims when existing AST machinery covers more than the audit assumes. Mitigation checklist in primer §12 stands.
- **Concurrency hazard: 5 parallel compiler dispatches without worktree isolation cause cross-agent staging clobbers.** Two independent observations this session: A+ #1+#2 dispatch detected destructive `git reset HEAD` twice from other agents; ast-builder dispatch's commits got captured under A+ and promotion-ergonomics commits (work landed verbatim, attribution wrong). **Future PA recommendation: serialize edits to compiler/src/ast-builder.js + compiler/src/lint-ghost-patterns.js across dispatches, OR use worktree isolation when more than one dispatch needs them.** S65 hand-off entry surfaces this.
- **Pre-commit hook + concurrent dispatches is a real concurrency hazard.** Pre-commit tests the whole tree, not staged files; one in-flight dispatch's failing test blocks all other dispatches' commits until cleanup. Effectively serializes the commit phase even when work phases run parallel. Worth a primer §12 amendment.
- **Honest scope-revision-up is also a discount-pattern signal** — promotion ergonomics Tier B revised UP to 25-41h (not down). The depth-of-survey methodology catches both directions: when existing infrastructure carries more than expected (down) AND when assumed-similar infrastructure is actually different (up). Both are valuable findings; both are surfaced by survey.



### 2026-05-06 (S65 — predicate-Zod deep-dive + debate-05 + npm-myth amend + parseVariant scope)

A predicate-system-vs-Zod deep-dive followed by a 5-expert adversarial debate on whether scrml should ship a boundary-parsing primitive (`parseVariant`/`parseShape`) in `scrml:data`. Bryan: "I strongly lean yes, and this is the time to do it" — anti-sycophancy convener stance, fired the debate to test the lean. The 5/5 unanimous panel verdict NARROWED Bryan's lean: ship `parseVariant` only; close `parseShape` as intentional absent — the synonym-detection test (debate-04 methodology) demoted `parseShape` because §53 SPARK boundary-zone refinement on assignment to typed parameters already does what `parseShape` would do. The simplicity-defender (B-default) flipped to C-narrow under the synonym test — third consecutive debate (debate-03 roc, debate-04 crystal, debate-05 simplicity-defender) where an expert positioned to argue X voted against X after honest construction. Frequency-of-three confirms pro-X-voice-voting-against-X as methodology-grade signal.

- **Predicate-system-Zod-replacement deep-dive (`scrml-support/docs/deep-dives/predicate-system-zod-replacement-2026-05-06.md`, 608 lines)** — tested the npm-myth article's "Zod can't fail your build. This can." + "None of it belongs in a scrml app. Ever." claim. Verdict: **claim STANDS WITH CALIBRATION REQUIRED** — not retraction. Form-validation layer is genuinely stronger than Zod+rhf (auto-synth `@form.isValid` + `@form.errors` + cross-field via predicate args is what Zod needs rhf for). Boundary-parsing has 3 real gaps: (a) named-shape registry breadth (scrml ships ~7, Zod ships ~25), (b) discriminated-union parsing of unknown JSON (tRPC use case, no first-class scrml answer at deep-dive time), (c) `.partial()`/`.pick()` for create-vs-edit forms. 12-case hand-rolling inventory. 17-gap predicate-vocabulary inventory re-prioritized under Zod lens; 4 promotions to P1 (`#17 transform/preprocess`, `#9 reqIf`, `#12 async predicates`, `#8 predicate aliases`); 2 demotions/eliminations (`#1 between`, `#2 nonempty` — synonyms); 3 new gaps surfaced (#18 named-shape breadth, #19 boundary-parsing primitive, #20 validator-set transform operators). Recommended highest-leverage follow-up debate: Gap #19 disposition.
- **Debate-05 brief (`scrml-support/docs/debates/debate-05-boundary-parsing-primitive-2026-05-06-BRIEF.md`)** — 5-expert panel: simplicity-defender (B-default), roc-expert (Decode-ability precedent), crystal-multi-dispatch-expert (`from_json` precedent + sound-type-system lens), scrml-dev-typescript (tRPC use-case voice), scrml-dev-react (server-boundary use-case voice). Methodology stack: per-shape sliver + synonym-detection + predicate-survival + asymmetric-forfeit-cost + string-discriminator trap. PA orchestrated panel directly via parallel Agent dispatches per S64 hand-off note 46.
- **5 expert positions** at `scrml-support/docs/debates/debate-05-position-*-2026-05-06.md`. All 5 converge on hybrid-A-C / C-narrow: ship `parseVariant`, close `parseShape`. Crystal high score (51.5/60) for the 12-year `JSON::Serializable` precedent + cleanest formal three-column synonym proof. Simplicity-defender's B-to-C-narrow flip is "qualitatively stronger than debate-03/04 flips because it was on the foundational add-anything question" (judge).
- **Debate-05 transcript + judgment + design insight (`scrml-support` + `scrml-support/design-insights.md`)** — judge ratifies 5/5 panel verdict. Design insight #4 captured: type-establishment step (constructor selection from discriminator, e.g. `parseVariant`) and predicate-enforcement step (SPARK boundary refinement) are sequentially ordered, not substitutable; sum-type case justifies the primitive, product-type case is a synonym. Pro-X-voice-voting-against-X confirmed at frequency-3 as methodology-grade signal.
- **npm-myth article amended (`docs/articles/npm-myth-devto-2026-04-28.md` lines 44-48)** — lifted form-DX claim out of obscurity (`<signup>` + auto-synth `@signup.isValid` + cross-field via `eq(@field)` predicate args = "Zod needs react-hook-form to do what scrml does in one declaration"). Added `parseVariant` as the discriminated-union answer. Closed `parseShape` as intentional. "None of it. Ever." softened to calibrated form: "for forms, Zod doesn't belong; for boundary-parsing, scrml has its own answer." Form-validation claim survives unmodified.
- **X-snippet drafted (`docs/articles/x-snippet-zod-calibration-2026-05-06.md`)** — 3 variants (60-word standalone, quote-reply pattern, 180-word follow-up post). PA lean: variant 3 (long-form) — demonstrates the debate-and-revise process, anti-sycophancy convener stance made visible. Awaits Bryan's selection.
- **parseVariant implementation SCOPE (`docs/changes/parsevariant-impl/SCOPE.md`)** — verdict-locked design with constraints (scrml-native enum required; variant-name as fixed discriminator; `::ParseError` failure type; companion design statement closing `parseShape`). Three implementation paths analyzed: Path A (compile-time special form, ~20-30h), Path B (schema-as-value substrate, ~8-12h), Path C (hybrid-desugar, ~10-15h, PA lean). Decomposition into 11 steps (lock L22 record, SPEC §10.4 + §53.x + §34, compiler change, stdlib runtime, tests, primer + kickstarter + inventory updates). Awaits Bryan's path-selection authorization before dispatch fires.

**Standing patterns surfaced this session:**
- **Strong-lean-still-fires-debate.** Bryan: "we should do the debate, but I strongly lean yes, and this is the time to do it." When the convener leans strongly, fire the debate ANYWAY — it tests whether the lean survives methodology-stack scrutiny. Result: lean validated but narrowed (A → hybrid-A-C). Anti-sycophancy convener stance + methodology stack = honest scrutiny that produces better designs than going straight to dispatch.
- **Read-only agent positions need PA-side persistence.** simplicity-defender, roc-expert, crystal-multi-dispatch-expert all dispatched with Read-only tools per their agent definitions. PA persisted their position content from task-notification output. scrml-dev-typescript and scrml-dev-react had Write and self-persisted. Worth tracking: agent-tool-set audit may improve dispatch ergonomics later.
- **Design-insights.md write-truncation hazard mitigated** (S64 note 47). Judge agent correctly flagged its lack of Edit access for the large file and requested PA action with exact text. PA used Edit to append cleanly. The hazard documentation worked.
- **Pro-X-voice-voting-against-X confirmed at frequency-3.** Debate-03 roc, debate-04 crystal, debate-05 simplicity-defender. Methodology-grade settled signal: when a partisan-defender voice flips under their own methodology lens, the rejection is structurally stronger than expected agreement.



### 2026-05-06 (S64 — Stage 0c.A + B2 + Phase 4d + 3 debates + audit + 11 primer amendments)

The session landed an unusual amount of work spanning compiler-source dispatches, multi-debate adversarial design, and substantial doc/spec/primer amendments. Sequencing: morning forgotten-surface audit → SPEC §17.5 unbundle → primer top-3 + remaining-8 amendments → Stage 0c.A function-overload deletion (debate-02-authorized) → Phase 4d completion sweep → Phase A1b Step B2 (E-NAME-COLLIDES-STATE) → debate-03 (component-overload SPEC direction; CLOSED WITHOUT RESOLUTION verdict) → SPEC §17.5 close amendment → article surgical edits → A1c plan §0c.E sharpening → tier-ladder rungs+stability deep-dive (Bryan reframed broad: "I guess I'm thinking about adding rungs and stability to the tier ladder") → debate-04 (Bryan's anti-sycophancy: "I'm not entirely convinced" of deep-dive's Approach C lean) → unanimous Approach A+ verdict → SPEC §34 catalog 4 entries → 0c.F audit-doc updates → predicate-gaps inventory captured (Bryan's correction: "none of this discounts predicate expansion"). Net: 13 commits scrmlTS + 4 commits scrml-support; both repos pushed at close.

- **Stage 0c.A function-overload deletion (`9d4c68f` → `6507475`)** — authorized by debate-02 verdict (4-deprecate-hard / 1-soft / 0-retain). Code surface deleted: `compiler/src/codegen/emit-overloads.ts` (60 LOC, removed entirely), `buildOverloadRegistry` in `type-system.ts:7193-7245`, `tagFunctionsWithStateType` in `ast-builder.js:1346-1372`, `FunctionDeclNode.stateTypeScope` field in `types/ast.ts:663`, 5 unit tests in `type-system.test.js:2349-2450`, `codegen/README.md` row, plus surrounding plumbing. 1 file deleted + 8 edited. Tests dropped exactly -5 (the asserting unit tests); zero regressions. Pre-commit clean every commit. Audit-line drift: zero. workspace-l2.test.js correctly identified as TS-overload mention not scrml-overload — left untouched. Original worktree-isolation dispatch halted on harness routing bug; re-dispatched as `general-purpose` no-isolation with frequent commits — clean.
- **Phase 4d completion sweep (`578f6f5` → `efd87d1`)** — drop @deprecated Phase 4d string fields from ast.ts + drop retired reactive-* AST kind interfaces. Audit estimated ~32 deprecated markers + 5 retired AST kinds. Survey corrected: only **19 deprecated markers** existed (partial sweep had landed earlier in S40), and only **1 of 5 reactive-* kinds was truly retired** (`ReactiveDerivedDeclNode`); the other 4 (`reactive-debounced-decl`, `reactive-array-mutation`, `reactive-explicit-set`, `reactive-nested-assign`) are still actively constructed by the parser. Audit had over-extrapolated from a JSDoc tag that only existed on one kind. Agent corrected scope without confirmation per depth-of-survey-discount methodology. Walker arms not pruned (already done in S60). PA-SCRML-PRIMER §12 retired-AST-kinds paragraph rewritten with survey-corrected reality.
- **Phase A1b Step B2 (E-NAME-COLLIDES-STATE) (`527461d` → `0dee2f7`)** — first lock-firing step in A1b; consumes B1's `lookupStateCell` API. Two-pass design within `compiler/src/symbol-table.ts`: PASS 1 (`walk` — unchanged from B1) registers state-decls; PASS 2 (`walkLocalDeclsForCollisions` — NEW) traverses the same AST tree but only fires on let/const/tilde/lin decls, using the `_scope` annotations PASS 1 attached. Avoids forward-reference issues since state-decls hoist per SPEC §6 — visible at any local-decl in same/enclosing scope regardless of source order. **Surface much smaller than 4-6h estimate** — depth-of-survey discount #6 (~30 min implementation). No new error-code registry needed (B1 already had `SYMDiagnostic` infrastructure). 4 unrelated channel tests needed fixing — they used `messages = [...messages, ...]` inside server functions, which parses as `tilde-decl` and now correctly fires E-NAME-COLLIDES-STATE; replaced with neutral `return author` bodies (those tests probe WS routing, not function body semantics). +13 integration tests at `compiler/tests/integration/symbol-table.test.js`; zero regressions. **§S11D.5 .todo NOT promoted** — root cause is parser-level (BS produces 0 blocks for top-level Variant C compound); B1's absorption note correctly anticipated this; awaits parser dispatch (Step 11.0g or similar).
- **Forgotten-surface audit (`07b4898`)** — 5-bucket forensic audit of compiler at `docs/audits/compiler-forgotten-surface-2026-05-06.md`. Triggered by S63 finding that PA had to investigate to discover function-overload existed at all. Buckets: vestigial features, fragile string-typed surfaces, spec-vs-code drift, cross-pass invariants, things-the-primer-doesn't-know. Top P0 finding (fixed same-commit): SPEC §17.5 wording overran debate-02 verdict — declared BOTH function-overload AND component-overload retired, but debate-02 explicitly carved out component for separate examination. P1 findings: Phase 4d completion sweep (largest cleanup-debt cluster), Stage 0c.A function-overload deletion (clean surface map), 11 primer-amendment proposals. Audit's recommendation 5 (try/throw/switch hard-error diagnostic) escalated to debate-04 territory.
- **Primer top-3 amendments (`07b4898`) + remaining 8 (`c8c8bb9`)** — applied all 11 audit-derived amendments to PA-SCRML-PRIMER.md. Top-3: pipeline bookends (`lint-ghost-patterns` pre-pass + `gauntlet-phase[1|3]` post-TAB walkers — both invisible at primer level previously), retired-but-walker-handled AST kinds list. Remaining 8: legacy `<machine>` deprecation + `bun scrml migrate` CLI, schema-differ.js diff-algorithm location, SPEC.md ~410k token Read-budget reality, attribute-registry update requirement for new structural elements, `setBPPOverrides` self-host shim, open SPEC-ISSUE registry (discoverable via grep), §13.5 NEW spec-real-estate-vs-adoption table covering ^{} active vs _{} sliver-empty vs §36 input-state-types sliver-empty vs §17.5 function-overload retired vs component-overload doc-only vs <transaction> stub vs <machine> deprecated.
- **SPEC §17.5 amendments (`07b4898` for unbundle; `8bda55f` for close)** — first amendment (foundation): unbundled function-overload (RETIRED for v0.2.0) from component-overload (UNDETERMINED, pinned for queued debate-03), recorded the audit finding that component-overloading was DOC-ONLY in SPEC; second amendment (post-debate-03): component-overload now CLOSED WITHOUT RESOLUTION; SPEC-ISSUE-010-COMPONENT closes; §18.0.1 explicitly authorizes structurally-different markup trees in match arm bodies as the canonical replacement.
- **Article surgical edits (`8bda55f`)** — `docs/articles/why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md` amended in 4 surgical edits to reflect debate-03 verdict + S64 audit finding. Component-half framing changed from "deprecated" to "DOC-ONLY in SPEC, never implemented." Bryan's voice preserved throughout. Title kept as authored. Article still `published: false`; gate is now LIFTED (debate-03 + debate-04 ratified the claims). Companion `tier-ladder-promotion-devto-2026-05-04.md` UNCHANGED — awaits A+ verdict execution (document JS-style `match expr {}` as canonical value-return rung).
- **Debate-02 transcript + insight (scrml-support `03cfb57`)** — full 6-expert panel + judge: state-type-discriminated function overloading deletion. Verdict: deprecate-hard for function half; SEPARATE DEBATE for §17.5 component half (convergent dissent from roc + crystal). Design insight: **the sliver test is per-shape, not per-feature** — function dispatch (logic-shaped, reducible to match) and component dispatch (markup-shaped, JSX-call-site-asymmetric) are different questions even when implementation lumps them. Judge final scorecard: rust-edition 54.0 / haskell 53.0 / roc 50.5 / gingerbill 49.5 / simplicity 47.5 / crystal 45.5.
- **Debate-03 transcript + insight (scrml-support `761531d`)** — full 6-expert panel + judge: §17.5 component-overload SPEC direction. Verdict: 4 CLOSE + 2 DEFER + 0 DESIGN. **Roc-expert (debate-02 carve-out author) EXPLICITLY RETRACTED the carve-out**, calling it "a category error transposed across languages" — the JSX-call-site asymmetry that grounded the carve-out doesn't transfer to scrml because `<match for=Type>` is a structural element (markup-typed pattern matching), not a function-call site. Empirical gate (does match block-form arm-body carry full structurally-different markup trees?) resolved CLOSE: SPEC §18.0.1 explicitly authorizes it. Design insight: **structural-element-as-markup-value reframe** — when a language elevates a control-flow construct from a statement to a structural element of the same kind as its existing first-class values, asymmetries that exist in source languages with statement-vs-expression dichotomies do NOT transfer; future scrml language-design decisions importing JS-shape slivers must verify the asymmetry's predicate survives scrml's reframe. Plus: asymmetric-forfeit-cost decomposition; convergent-dissent-INVERSION as cross-debate signal. Judge scorecard: roc 55.5 (highest, for retracting own carve-out — intellectual-honesty bonus) / haskell 52.5 / roc 50.5 / gingerbill 49.5 / simplicity 47.5 / crystal 45.5.
- **0c.F audit-doc updates (scrml-support `fec630f`)** — language-status-audit-2026-04-29.md + tutorial-freshness-audit-2026-04-29.md closure notes refreshed to reflect S64 actuals (function-overload code DELETED at Stage 0c.A; component-overload was DOC-ONLY, SPEC track CLOSED via debate-03; supersedes S63 deprecation framing).
- **Tier-ladder rungs+stability deep-dive (scrml-support `9123af6`)** — Bryan: "I guess I'm thinking about adding rungs and stability to the tier ladder." 5-phase deep-dive at `docs/deep-dives/tier-ladder-rungs-stability-2026-05-06.md`. Corpus signal: 0 of 174 if-using files use `<match for=Type>` block-form OR `effect=` (the proposed Rung 1.5 base); only 2 use `<engine for=Type>`. Recommended Approach C (sanction switch as Tier 0+ on-ramp). Bryan's response: "I'm not entirely convinced." Fired debate-04 for adversarial scrutiny.
- **Debate-04 transcript + insight (scrml-support `9123af6`)** — 3-expert panel + judge: switch as sanctioned Tier 0+ surface. **3-of-3 unanimous Approach A** — the deep-dive's recommendation rejected. Crystal-multi-dispatch (pro-sanction by design — VOTED AGAINST TYPE): synonym-not-sliver — switch and JS-style `match expr {}` are isomorphic; 58 corpus files use the JS-style match form already. Gingerbill: **string-switch trap** — the 174 if-files are over STRINGS, not enums; sanctioning switch entrenches string-discriminator anti-pattern by giving it a comfortable home that BYPASSES the promotion lint. Simplicity-defender: applied debate-02 per-shape sliver + debate-03 predicate-survival + debate-03 asymmetric-forfeit-cost; all three triangulated to A. **Verdict: Approach A+** (audit recommendation 5 honored as written + three constructive execution improvements: did-you-mean: match quickfix on E-SWITCH-FORBIDDEN, W-LIFECYCLE-CANDIDATE tightening on `if=` over string-literal RHS values matching enum-tag lexical shape, document JS-style `match expr {}` form as canonical value-return rung in primer + tier-ladder-promotion article). Three durable design-insights: synonym-not-sliver refinement of per-shape sliver test; string-switch trap as design-failure class; pro-X-voice-voting-against-X cross-debate pattern (Roc retracted in debate-03; Crystal voted A in debate-04; frequency-of-two qualifies as methodology-grade signal).
- **Predicate-gaps inventory (scrml-support `9123af6`)** — Bryan correction mid-debate: "none of this discounts predicate expansion." Tier-ladder/switch verdict doesn't argue against any predicate-vocabulary gap; that thread is orthogonal. Captured 17 gaps in three buckets (small ergonomic / mid-impact missing / structural design-question) at `docs/predicate-gaps-inventory-2026-05-06.md`. NOT deep-dived — option (1) of three options Bryan was offered. Revisit when A1c surfaces real-app friction OR when SPEC-ISSUE-§53.13.1-4 gets touched OR when a real adopter reports `reqIf` as a blocker.
- **SPEC §34 catalog 4 missing error codes (`112358d`)** — audit found 4 codes emitted in src but absent from §34: E-CTRL-011 (for-in not supported, ast-builder.js:4087-4093, 6517-6519), E-META-EVAL-001 (compile-time meta runtime error, meta-eval.ts:447), E-META-EVAL-002 (meta re-parse failed, meta-eval.ts:375, 385), E-SYNTAX-050 (bare `/` no longer a valid closer, block-splitter.js:1276). Pure spec-only-fix; no compiler changes.
- **`jsx-dispatch-expert` forge** — agent file written at `~/.claude/agents/jsx-dispatch-expert.md` (~870 lines, color magenta, model opus, tools [Read]). NOT git-tracked. Forged to fill a panel-composition slot for the original retain-vs-delete framing of debate-03; the debate's eventual narrow-spec-direction frame didn't require this slot, but the agent is now staged for any future markup-ergonomics-voice need. Forge agent halted on Write-permission denial; re-fired with text-return shape; PA wrote file with corrections (model: sonnet → opus per pa.md "All agents run on Opus" rule; HTML-escape unescape).
- **3 design-insight entries appended** to `scrml-support/design-insights.md`. Methodology stack now: per-shape sliver test (debate-02) → predicate-survival check (debate-03) → asymmetric-forfeit-cost (debate-03) → synonym-detection precondition (debate-04). Three orthogonal axes; convergence across them is structurally stronger than unanimous voting on a single axis. Plus the cross-debate pattern: pro-X-voice-voting-against-X as the highest-virtue partisan-honest move.

**Standing patterns surfaced this session:**
- **Anti-sycophancy in convener-skepticism territory.** Bryan's "I'm not entirely convinced" → fired debate-04 → unanimous rejection of deep-dive's lean. The pattern: when the deep-dive recommends an approach the convener doesn't trust, fire adversarial debate; trust the methodology stack to test the recommendation. Worked.
- **Depth-of-survey-discount counter is now 6.** Pattern continues to fire reliably; PA can trust survey-first methodology heavily for any audit that estimates "new infrastructure needed."
- **Worktree-isolation harness routing bug.** Pipeline dispatched with `isolation: "worktree"` may route to scrml-support worktree instead of scrmlTS. Workaround: re-dispatch as `general-purpose` no-isolation with frequent commits + progress.md. Clean across Stage 0c.A + Phase 4d + B2.
- **Brief-locus correction authorization.** When survey reveals audit's named touchpoint or surface assumption is off, agent corrects scope without re-confirmation. Phase 4d's 5→1 reactive-* AST kinds correction is the canonical example this session.
- **Methodology-stack triangulation.** Three orthogonal tests (per-shape sliver + predicate-survival + asymmetric-forfeit-cost) applied to the same option produce structurally stronger verdict than unanimous voting on one axis. Ratified across debate-02/03/04.



### 2026-05-06 (S63 — Stage 0c INSERTED: overload-deprecation housekeeping queued before A1c-C0)

Mid-session sidequest crystallized into a deprecation milestone. After B1 landed, the user opened a small "how does function overloading work in scrml today" question. The conversation walked the shipped state-type-overload mechanism (`emit-overloads.ts`), surfaced a JS-shaped-scrml reflex (PA's first example used a function returning a stringly-typed sum-type with hidden side effects + manual control flow — the procedural-spaghetti shape that scrml's enum/match/engine were designed to make impossible), and re-expressed the same scenario in scrml-native form (engine + derived state). User authorized: (a) verbatim capture of the conversation, (b) an article on the JS-shaped-scrml reflex, and (c) a radical-doubt deep-dive on whether the state-type-overload mechanism should be deprecated.

- **Function-overloading sidequest — verbatim capture (`scrml-support/docs/function-overloading-sliver-2026-05-06.md`)** — full conversation transcript preserved per user mandate ("I want to capture this whole last section VERBATIM"). Sets the precedent that design conversations crystallizing a stance get full-fidelity capture, not just summary.
- **Article landed (`scrmlTS/docs/articles/why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md`, `published: false`)** — ~1500 prose words. Bryan-narrated companion-pair with the existing `tier-ladder-promotion-devto-2026-05-04.md`. Frame: announcement-shaped, slightly facetious open ("Two features are leaving the language in v0.2.0. They worked. Nobody used them."), with the technical why and the lesson the language is keeping. Path C reframe from an earlier `scrml-voice-author`-drafted piece in claude's narrator voice (`js-shaped-scrml-is-the-failure-mode-2026-05-06.md`); the earlier draft was deleted, source-conversation preserved at `scrml-support/docs/function-overloading-sliver-2026-05-06.md`. Tier-ladder companion-edited: byline normalized to `by Bryan MacLee`, opening references the deprecation companion, closing trailer points forward + adds `Drafted with Claude` line. User controls publishing timing.
- **Radical-doubt deep-dive landed (`scrml-support/docs/deep-dives/state-type-overload-deprecation-2026-05-06.md`)** — `scrml-deep-dive` agent dispatch, 5-phase output (~57KB). Frame: take the case for KEEPING the mechanism seriously; find evidence contradicting the in-session "sliver is empty" conclusion. Findings: source-level usage = 0 (zero matches in samples / examples / stdlib / benchmarks / self-host), test coverage = 5 unit tests all programmatic via synthesized AST nodes (zero source-level integration tests), spec authority = 0 normative sections, tutorial coverage = 0, articles = 0, expert tally = 0/6 KEEP / 5 Hard / 1 Soft-preferred-Hard-acceptable. Component overloading (§17.5 / SPEC-ISSUE-010) collapses under the same scrutiny — three test cases all reduce to either two-different-components, single-component-with-match-body, or `match for=state` over an enum. Recommendation: Deprecate-Hard, integrated as Stage 0c housekeeping milestone before A1c-C0. **Caveat:** the deep-dive agent didn't have Agent/Task tool access to dispatch live experts; the §E expert positions are reasoned from each agent's documented philosophy. User authorized proceeding on the source-level zero data without live ratification (Path 1).
- **Stage 0c INSERTED (planning amendment, S63 PA-direct edits)** — `docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md §4.-1` adds 6 sub-steps (Stage 0c.A-F) totaling ~3-5h focused work: delete `emit-overloads.ts` + `emit-client.ts` call site + `analyze.ts` threading; delete `buildOverloadRegistry` + caller in `type-system.ts`; delete `tagFunctionsWithStateType` + `FunctionDeclNode.stateTypeScope` field; delete 5 programmatic unit tests in `type-system.test.js:2349-2450` (test count delta -5); rewrite SPEC §17.5 (DONE this session); update audit doc cross-references (DONE this session). Runs after A1b-COMPLETE, before A1c-C0.
- **SPEC §17.5 rewritten** — "Component Overloading" replaced with "Discrimination on type or value — use `match` or `engine`" + a deprecation status block. SPEC-ISSUE-010 closed without resolution. The replacement primitives (already in the language) are documented inline: `match for=…` for prop-type/value discrimination; `<engine>` with typed transition arms for stateful dispatch; `const <name> = …` derived cells for per-actor-type derived facts.
- **Audit cross-references updated** — `scrml-support/docs/deep-dives/language-status-audit-2026-04-29.md` row 144 + line 26 + line 288 + SPEC-ISSUE-010 row marked DEPRECATED-FOR-V0.2.0 with cross-reference to the deep-dive. `scrml-support/docs/deep-dives/tutorial-freshness-audit-2026-04-29.md` Top-5 item 2 + Pass-3 item 13 + recommended-slot table row marked RETIRED-S63 with cross-reference to the article.
- **codegen README** — `compiler/src/codegen/README.md` row for `emit-overloads.ts` annotated with deprecation note + Stage 0c cross-reference; file itself stays in tree until Stage 0c.A executes.
- **Article reframe — Path C (Bryan-narrated, slightly facetious announcement)** — the initial `scrml-voice-author` draft was claude-narrated with a "JS-shaped scrml is the failure mode" thesis. Bryan reframed to a Bryan-narrated announcement piece ("Why scrml has to deprecate function and component overloading"). Same teaching content; different speaker, different opening posture. Old draft deleted; verbatim conversation preserved at `scrml-support/docs/function-overloading-sliver-2026-05-06.md`. Companion-paired with the existing `tier-ladder-promotion-devto-2026-05-04.md` (byline normalized, opening hook + closing trailer added so the pair reads as one story: ladder is canonical path; overload mechanism was a parallel path that didn't earn its keep).
- **scrml is not a JS-superset language — concession ratified, folded into the article** — Bryan verbatim S63: *"It is true that is where it started. but for a long time I tried to keep the easy dev conversion path, despite KNOWING for some time. This is a language. It is its own, and should stand as such."* The deprecation article carries this as a parallel concession in its closing — recasts the small overload-deletion argument as part of a larger language-positioning shift. v0.2.0 stops the JS-superset pretense. Implications for future articles, scrml.dev copy, and the v0.2.0 announce captured in hand-off.
- **`scrml-voice-author` agent default-output dir shifted** — `~/.claude/agents/scrml-voice-author.md` Step 4 + reference table updated: drafts now write to `scrmlTS/docs/articles/<slug>-devto-<date>.md` (the canonical public series location). Coexists with published pieces in the same dir; `published: false` frontmatter is the publication gate, not the file location. Earlier convention (`scrml-support/voice/article-drafts/`) retired.
- **`debate-curator` + `scrml-deep-dive` defaults shifted to synthesis-from-store** — observation: both agents were synthesizing expert positions from documented philosophy ~half the time anyway, even when nominally invoking live experts. The S63 deep-dive surfaced its own caveat: Agent/Task tool wasn't available, so it reasoned from docs rather than dispatching live. New default at `~/.claude/agents/debate-curator.md` Phase 5 + `~/.claude/agents/scrml-deep-dive.md` Source C: read agent description + first 1-2 substantive sections from `~/.claude/agents-store/{name}-expert.md`, synthesize, label output **"synthesized from agent description"**. Live dispatch reserved for explicit-escalation-flag (rare; reserved for genuinely close calls or surface-area-exceeds-description). Plus `scrml-deep-dive`'s NAVIGATION + Source A paths refreshed (was stale-pointing at frozen `~/projects/scrml8/`; now points at current `~/scrmlMaster/` ecosystem). Global agent files NOT git-tracked; edits saved to disk.
- **Queued live-dispatch debate (`scrml-support/docs/debates/QUEUED-state-type-overload-deletion-2026-05-06.md`)** — Bryan flagged that the article asserts breadth-of-investigation that the synthesis-only deep-dive can't fully back. Responsible move: actually run the live debate before the article publishes or before Stage 0c executes. Queued artifact is a self-contained brief: 6-expert panel (5 already in `~/.claude/agents/`; 1 forged this session), explicit live-dispatch escalation flag, anti-sycophancy guard built in (judge told the convener has a prior conclusion; debate's job is to find the strongest case AGAINST it). Outcome → action gating table maps confirm-deprecate-hard, soft-deprecate finding, or any credible retention-case to revisions of article + Stage 0c + planning amendments. **Pre-debate work done this session:** forged `crystal-multi-dispatch-expert` (~/.claude/agents/crystal-multi-dispatch-expert.md, 865 lines) as the panel's pro-retain steel-man voice. Agent-registry rebuilt (44 active agents now). Panel is fully ready for S64+ to fire.
- **Sliver test methodology named** — Bryan-coined this session: *if I can't easily invent a case where the feature does something existing primitives can't, the feature is empty enough to act on.* Used as the lens that produced the deprecation conclusion. Carries forward as a reusable methodology for future feature audits.

**No compiler source touched in S63 after B1; the post-B1 batch is pure planning + spec + articles + global-agent infrastructure changes.** Tests baseline unchanged: 8,933 / 44 / 1 / 0 / 8,978 / 440. Stage 0c.A-D will execute the actual code/test deletions when scheduled (gated on the queued live debate).

**Standing patterns surfaced this session:**
- "Deep-dive returning mid-session is a hard-block on wrap until integrated." User authorized + executed in-session, not deferred.
- "Verbatim capture for stance-crystallizing conversations." Established at `scrml-support/docs/function-overloading-sliver-2026-05-06.md` as the precedent.
- "Anti-sycophancy posture as a durable PA default." When user brings up a feature with a stated suspicion, default behavior is "show the work, not the conclusion." Radical-doubt deep-dive frame is the formal-process version of this.
- "Concur-before-publish gate for prose edits." User-facing artifacts can be course-corrected freely as long as the user concurs before publish.

### 2026-05-06 (S63 — A1b Step B1 LANDED: symbol-table extension)

S62 dispatched B1 in a worktree and landed three WIP commits (scaffolding → survey → module: types + Scope + walker, ~500 LOC) before being interrupted. S63 PA salvaged directly: confirmed pipeline wiring + tests + two follow-up fixes, then committed and cherry-picked all 4 commits onto main.

- **B1 — symbol-table extension (`9d2fa45`)** — Stage 3.06 SYM module at `compiler/src/symbol-table.ts` inserted between NR (3.05) and CE (3.2) in `compiler/src/api.js`. Public API: `runSYM`, `runSYMBatch`, `lookupStateCell`, `lookupQualifiedStateCell`, `getScopeForNode`. Walks every `state-decl` (both structural and legacy `@`-form) and registers it in the appropriate scope (`file` / `function` / `compound`; `engine` and `component` ScopeKinds reserved for B14+/B17+). Variant C compounds register parent in enclosing scope + recurse children into a fresh compound sub-scope with qualified-path keys (`signup.name`, `outer.inner.leaf`). Records carry pre-classified booleans (`isCompoundParent`, `isCompoundChild`, `hasValidators`, `hasDefaultExpr`, `hasTypeAnnotation`, `isPinned`, `isConst`, `structuralForm`) for cheap downstream lookup. Test file `compiler/tests/integration/symbol-table.test.js` — 31 tests covering §B1.1-§B1.15 invariants + general-invariant suite (no errors at B1, FileAST `_scope` back-pointer, stats correctness, qualified-path edge cases). +31 pass / +1 file (8,902/44/1/8,947/439 → 8,933/44/1/8,978/440). Zero regressions.

  **§S11D.5 absorption confirmed.** Top-level Variant C compound (deferred from S61 Step 11.0d) is correctly handled by B1's compound-aware `state-decl.children` walk — no separate Step 11.0g needed.

  **Two salvage-time fixes documented in `docs/changes/phase-a1b-step-b1-symbol-table-extension/progress.md` § "Salvage notes":**

  1. **Walker cycle-guard.** Initial walker recursed through `children`/`body`/`consequent`/`alternate`/`arms[].body` without a visited-set guard (NR's walker doesn't have one because `block`/`parent` back-refs aren't an issue at NR's nodeset). Test helper `findKind` already used a WeakSet — discrepancy. Threaded `visited: WeakSet<object>` through `walk` + `registerStateDecl`. Cheap; matches test-helper convention.
  2. **Annotations made non-enumerable.** Initial implementation set `_record` / `_scope` via direct property assignment. Downstream stages (BP / CG) hung in an infinite loop on the cycle `state-decl._record → record.scope → scope.stateCells.get(name) → record` (verified by hang on `samples/compilation-tests/combined-001-counter.scrml`). Switched to `Object.defineProperty(node, "_record"|"_scope", { value, enumerable: false, configurable: true, writable: true })` so generic structural walkers using `Object.keys` / `for...in` skip the back-pointers. `getScopeForNode` and direct property reads still work. **Load-bearing for B2-B22:** consumers must read these annotations via the public API or direct property access — never via enumeration.

  **Survey-first decision (committed in `d6a8fc9` before any source edits):** SYM lands as a NEW Stage 3.06 module (peer to NR), not as an NR-extension. Rationale captured in worktree's `progress.md` Q6: NR's responsibility is tag-bearing-node classification (`resolvedKind` / `resolvedCategory`); state-cell scope construction is a separate concern; folding into NR would muddle separation-of-concerns and create budget creep against NR's <5ms/file bound. B2-B22 consume SYM as a peer stage cleanly.

  Commits cherry-picked to main: `61afdec` (scaffolding) → `d6a8fc9` (survey + insertion-point) → `df870f4` (module) → `9d2fa45` (wiring + tests + cycle-guard fixes).

### 2026-05-05 (S61 close — Phase A1a (lex+parse) COMPLETE)

Phase A1a — the foundational lex+parse layer of the v0.next migration — is COMPLETE. 20 sub-steps landed across S59 + S60 + S61. The compiler's parser now recognizes the full V5-strict structural decl-form `<x> = init` (Shapes 1+2+3, Variant C compound, typed-decl) at every position the SPEC sanctions: inside `${...}` logic blocks AND at file top-level. The legacy `@x = init` expression-form decl is mirror-supported via Step 4's discriminant; its pre-v0.next AST kind divergence (`reactive-derived-decl`) is folded into unified `state-decl{shape:"derived",isConst:true,structuralForm:false}` per Step 11.5. Sample-suite migration to V5-strict canon completed across 175 files in `samples/compilation-tests/` (Step 12) + sample restorations from each P-FUP step.

**Cumulative A1a step ledger (chronological landing order):**

| # | Step | SHA | Era | Tier | Δ tests | Key insight |
|---|---|---|---|---|---|---|
| 1 | Lexer: reserve `reset` | `9cd7779` | S59 | T1 | +6 | Tokenizer KEYWORD addition |
| 2 | Foundational `<NAME>` decl-site recognition | `d28f6f7` | S59 | T2 | +15 | Depth-of-survey discount #5 — 21min vs 10-15h estimate; block-splitter already preserved raw `<` |
| 3 | AST kind rename `reactive-decl` → `state-decl` | `8fa26e1` | S59 | T2 | 0 | ~514 changes / ~120 files / 0 regressions |
| 4 | Parser: state-decl `shape` discriminant | `96dbe92` | S59 | T2 | +12 | Surfaced `reactive-derived-decl` divergence → ADR + Step 11.5 |
| 5 | Parser: Shape 2 `renderSpec` + bareword validators + `req` | `505531f` | S59 | T2 | +15 | Validator args as `string[]` deferred to A1b B9; brief-locus correction |
| 6 | Parser: `default=` + `pinned` on state-decl | `2754940` | S60 | T2 | +10 | KEYWORD-vs-IDENT survey insight |
| 7 | Parser: `pinned` on import items | `556de93` | S60 | T2 | +10 | Regex-driven parser insight; 3 disambiguation edge cases |
| 8 | E-RESERVED-IDENTIFIER trigger | `af4a0da` | S59 | T1 | +4 | reset-keyword shadow check |
| 9 | Expression parser: `reset(@cell)` keyword + E-RESET-NO-ARG | `fded36a` | S60 | T2 | +8 | Full tree walker `forEachResetExprInExprNode`; conservative codegen pass-through |
| 10 | Expression parser: MemberCall/MemberAssignment/UnaryDelete | `226a2dd` | S60 | T1 | +10 | **Discount #8 — ZERO source changes**; AST kinds already correct |
| 11 | Variant C compound + render-by-tag + kickstarter v2 §3 smoke | `bcca1e6` | S60 | T2 | +23 | **Discovered-blocker escalation** — work expanded; surfaced 11.0a/b/c |
| 11.0a | Variant C compound recognizer | `6d51d00` | S60 | T2 | +8 | ~127 LOC `tryParseStructuralDecl` extension; 2 anti-test memorials flipped |
| 11.0b | Newline-as-statement-separator | `a7dd96a` | S60 | T2 | +11 | ~30 LOC `collectExpr` ASI-NEWLINE branch — universal-fix substrate for 11.0e + 11.0f |
| 11.0c | Typed-decl recognizer | `92af2ca` | S60 | T2 | +10 | ~48 LOC via 100% reuse of `collectTypeAnnotation()` — high-reuse pattern |
| 11.5 | FOLD `reactive-derived-decl` → `state-decl{shape:"derived",isConst:true}` | `a020ea1` | S61 | T2 | +4 / +1 skip | ADR Option A; 1 hidden coupling resolved at emit-logic.ts; pre-existing Shape 3 V5-strict codegen gap deferred to A1c |
| 12 | Existing-test deltas | `7be23aa` | S61 | T2 | 0 net | 175 files migrated to V5-strict; 624 sites in broader `samples/` deferred per SURVEY scope; **2 P-FUPs surfaced** |
| 11.0e | `<x> = not\n<y>` newline boundary fix (P-FUP-2) | `916de65` | S61 | T2 | +8 | Universal — `"not"` added to `VALUE_KEYWORDS` Set; 4 of 5 reverted Step 12 samples restored; **1 P-FUP surfaced** (P-FUP-3) |
| 11.0f | `<x> = ?{SQL}\n<y>` BLOCK_REF newline boundary fix (P-FUP-3) | `fe93d40` | S61 | T2 | +7 | Universal — BLOCK_REF added to `lastEndsValue` predicate; combined-007-crud restored; coverage now exhaustive (no P-FUP-4 surfaced) |
| 11.0d | Top-level structural Shape 1 recognition (P-FUP-1) | `0f92077` | S61 | T2 | +9 / +1 todo | BS top-level scan extension via `peekTopLevelStateDeclSignal`; 3 reverted Step 12 samples restored; component-def discrimination preserved; Variant C compound at top-level deferred (§S11D.5 .todo) |
| 13 | Final commit + CHANGELOG aggregate + cleanup | this commit | S61 | T1 | 0 | 5 ephemeral `scripts/step12-*.mjs` helpers removed; master-list A1 row to DONE |

**Net Phase A1a delta:** 8,720 / 43 / 0 / 8,763 (S58 close) → **8,902 / 44 / 1 todo / 0 / 8,947** (A1a-COMPLETE). +182 pass / +1 skip / +1 todo / +184 total tests across 7 new test files. Zero regressions throughout.

**AST contract changes (load-bearing for A1b):**
- `state-decl` carries new fields: `shape: "plain" | "decl-with-spec" | "derived"`, `structuralForm: boolean`, `isConst: boolean`, `renderSpec: RenderSpecNode | null`, `validators: ValidatorEntry[]`, `defaultExpr: ExprNode | null`, `pinned: boolean`, `children: ReactiveDeclNode[]`, `typeAnnotation: string`.
- New AST kinds: `render-spec` (Step 5), `reset-expr` (Step 9).
- Renamed: `reactive-decl` → `state-decl` (Step 3); `machine-decl` → `engine-decl` (S53); `reactive-derived-decl` retired and folded into `state-decl{shape:"derived",isConst:true}` (Step 11.5).
- Import items: `pinned` modifier (Step 7).
- Expression mutation shapes (`MemberCall`/`MemberAssignment`/`UnaryDelete`): unchanged AST kinds (Step 10 verified zero-source); B8 walker must handle dual-path discrimination (specialized kinds `reactive-array-mutation` / `reactive-nested-assign` AND `bare-expr.exprNode` structural walk).
- `@`-prefix discrimination: `ident.name` preserves `@` prefix verbatim — pure string-shape inspection.

**Out-of-scope deferrals for A1b (resolve+type, 22 steps RATIFIED S60):**
- V5-strict bare-name resolver enforcement (E-NAME-COLLIDES-STATE firing).
- Derived-cell wiring (dependency graph + topo sort).
- L21 (`E-DERIVED-VALUE-MUTATE`) firing.
- Validator typer (string args → `ExprNode[]` per AST contract §1.1; from Step 5 deferral).
- `pinned` forward-reference check.
- Bare-variant inference (M9; from Step 11.0c).

**Out-of-scope deferrals for A1c (codegen+runtime, 24 steps RATIFIED S60):**
- Codegen for Shape 2 `renderSpec` markup-RHS dispatch.
- `reset(@cell)` lowering past the conservative pass-through (Step 9).
- `default=` integration with reset semantics.
- Component-def lowering for engine state-children.
- **Pre-existing Shape 3 V5-strict codegen gap** (surfaced S61 Step 11.5; documented in A1c plan §6.4) — `const <x> = expr` emits `_scrml_reactive_set` not `_scrml_derived_declare`.

**Other deferrals beyond A1b/A1c:**
- Top-level Variant C compound (§S11D.5 .todo from Step 11.0d) — BS peek currently matches `=`/`:`, not `<` for compound-opener at top-level. Likely Step 11.0g or A1b territory if A1b's resolver normalizes.
- Self-host parity — current Step 4-7 deferred-policy holds. 6+ self-host files still reference `reactive-derived-decl` literal; catches up at next bootstrap regen (post-A1c).

**Methodology callouts captured this phase:**
- **Depth-of-survey discount — now 9× confirmed.** Pattern: when an audit names a multi-h "new infrastructure" fix, implementation-time survey routinely reveals 2-5× shorter due to existing infra coverage. Three notable shape variants surfaced in A1a:
  - **Zero-source variant** (Step 10 — Discount #8).
  - **Discovered-blocker escalation** (Step 11 — work expanded, not shrank; surfaced 11.0a/b/c).
  - **High-reuse pattern** (Step 11.0c — ~48 LOC via existing `collectTypeAnnotation()` reuse; Step 11.5 1 hidden coupling caught + resolved).
- **Step 11 escalation closure pattern.** When a smoke step surfaces deferred parser gaps as a discovered-blocker, queue follow-on sub-steps (11.0a/b/c, then 11.0d/e/f when more surface), close all before the wrap. Pattern proven across 6 escalation steps.
- **Per-step branch + cherry-pick + push.** Each step a focused worktree dispatch; PA cherry-picks onto main; main always green. Held throughout 20 sub-steps.
- **Cross-machine sync hygiene + path-discipline.** Multiple F4 leaks caught + recovered (S58, S59, S61 — 11.0f had 2 self-corrected near-misses, 11.0d had 1 PA-recovered leak). Pattern is structural; PreToolUse hook fix deferred.
- **Stream-timeout salvage.** Two S61-close agents (11.0d original + 11.0d-finisher) stalled with stream watchdog timeouts. Both had committed clean partial work; PA salvaged via cherry-pick of partials + finisher re-dispatch + final-commit-by-PA. Demonstrated agent-failure recovery flow.
- **Universal-fix substrate** (Step 11.0b's `collectExpr` ASI-NEWLINE branch) reused by Steps 11.0e + 11.0f — both narrow patches at the same locus extending the value-classifier. Substrate design held.

**S61 also landed (alongside Phase A1a closure):**
- **SPEC head broken-path amendment-ref cleanup** (`0a48700`) — 4 dead path refs → 1 archive pointer. Per pa.md "current truth only" scope principle.
- **Curation pass — 10 of 10 batches executed.** 76 directories dereffed from `scrmlTS/docs/changes/` to `scrml-support/archive/changes/`. Disposition matrix at `scrmlTS/docs/curation/2026-05-05-changes-dir-disposition.md`. Batches: A (P-series 12), B (expr-ast-phase-4d 4), C (dispatch-app 7), D (F-series 11), E (GITI 2), F (BUG-letters 2), G (bun-sql 2), H (LSP L1-L4 5), I (fix-* 20), J (misc 11). `docs/changes/` count: 103 → 30. Cross-refs fixed: 11 (FRICTION.md, README.md ×2, changelog ×3, scope-c-findings-tracker ×2, 2 test files, 2 src files).
- **Maps refresh attempted** but agent's Write tool returned permission-denied (system-level directive). Findings returned as text — 8 non-compliance categories surfaced; items #1 (SPEC head) + #2 (curation) actioned this session. Maps files themselves remain stale (last touched 2026-04-24); root-cause investigation deferred.

### 2026-05-05 (S61 — A1a Step 11.5 + Step 12 landed + 2 new P-FUPs + curation pass started)

S61 was the largest-throughput session yet — 4 compiler-touching landings (SPEC head cleanup, Step 11.5 FOLD, Step 12 sample migration, plus 2 new P-FUP BRIEFs queued), 2 cross-repo curation batches (19 dirs dereffed), and 2 Step 12 question ratifications. Phase A1a advanced from 14/17 (S60 close) to **16/19** (Steps 1-12 + 11.0a/b/c + 11.5 done; 11.0d + 11.0e + 13 remaining). Tests went from 8,874 / 43 / 0 (S60 close) to **8,878 / 44 / 0** (S61 wrap; +4 pass / +1 skip / +5 total — the +1 skip is the deferred self-host parity test from 11.5).

- **SPEC.md head broken-path cleanup** (`0a48700`). Lines 3-6 of SPEC.md head referenced 4 paths that no longer exist on disk (`docs/spec-issues/SPEC-AMENDMENTS-2026-04-{02,05,06}.md` + `docs/changes/spec-s37-amendments/spec-amendments.md` — confirmed MISSING). Their content was integrated into the SPEC body long ago and the source amendment docs archived to `scrml-support/archive/spec-issues/`. Replaced the 4 broken-ref lines with a single archive-pointer annotation. Lines 7+ (self-descriptive in-place amendment notes without external paths) preserved. Surfaced by S61 maps-refresh agent's non-compliance scan. Per pa.md "current truth only" scope principle.

- **Step 11.5 — FOLD `reactive-derived-decl` into `state-decl`** (`a020ea1`, T2 tier, 6-commit chain on `phase-a1a-step-11-5-fold-derived` worktree, cherry-picked clean onto main). The legacy expression-form `const @doubled = @count * 2` (inside `${...}` blocks) previously produced AST node `kind: "reactive-derived-decl"`. Per ADR Option A FOLD ratified S60, this kind is retired: parser path rewired to produce `state-decl` with `shape: "derived"`, `isConst: true`, `structuralForm: false`, `initExpr` populated. ~10 src files + LSP handler + 7 test files swept; kind-enum entry removed from `compiler/src/types/ast.ts`. **Survey findings:** 32 references in src across 10 files (matched BRIEF estimate exactly); 4 parser construction lines at 2 sites in ast-builder.js. **Hidden coupling caught + resolved:** `emit-logic.ts` had different runtime helper (`_scrml_derived_declare/subscribe` vs `_scrml_reactive_set`) for derived-vs-plain — resolved by gating derived emitter on the precise `shape === "derived" && isConst === true && structuralForm === false` triple. **Dep-graph dedup issue caught by tests:** both `collectAllReactiveDecls` and `collectAllReactiveDerivedDecls` would have picked up folded-derived nodes — resolved by adding `isFoldedDerived` exclusion filter. **Pre-existing Shape 3 V5-strict codegen gap surfaced + deferred to A1c:** Shape 3 V5-strict `const <x> = expr` emits `_scrml_reactive_set` not `_scrml_derived_declare` (latent from Step 4); out-of-scope per BRIEF §2.2. **Byte-output preserved** for legacy `const @x = expr` form (verified via probe compile). Self-host parity test marked `test.skip` per Steps 4-7 policy (6 self-host files still reference the old kind; catches up at next bootstrap regen — accounts for the +1 skip). +4 pass / +1 skip / +5 net.

- **Step 12 SURVEY pre-staged + Q1 + Q2 ratified** (`docs/changes/phase-a1a-step-12-existing-test-deltas/SURVEY.md`). PA-side static-pass survey of legacy patterns Step 12 needs to address. Findings: zero remaining references to `reactive-decl` / `machine-decl` (old names), zero `loose` flag references, zero legacy no-arg `reset()` source-level usages requiring drop. Step 11.5 owned the 11 `reactive-derived-decl` test references (now all updated). Two open questions resolved by user this session:
  - **Q1 RATIFIED — transition-decl tests OUT-OF-SCOPE.** 5 unit test files (`transition-decl-{ast,block-split,scope,purity,registry}.test.js`) probe the v0.legacy `<machine>` machine-syntax. Their retirement is governed by `<machine>` keyword deprecation policy (W-DEPRECATED-001 today P1 → E-DEPRECATED-001 in P3) + migration via `scrml-migrate` — NOT by Step 12. Step 12's scope is V5-strict canon migration for state-cell decls (`<x>` vs `@x` decl-form). transition-decl is a separate feature category whose retirement is owned by P3 (deprecation) + A2 (engine implementation phase).
  - **Q2 RATIFIED — Option A REWRITE legacy `@x = init` decl form.** SPEC §6.1.2 reserves `@varname` for reads/writes/compound-assigns only; first-appearance/decl-form `@x = init` is canon-violating. Step 4's mirror is a transitional accommodation, not endorsement. Deprecation phase is unscheduled and "later" is indefinite. Mass-rewrite to V5-strict `<x> = init` during Step 12. Affects ~85 candidate sample files; Step 12 dispatch dynamically classifies first-appearance vs post-decl-write per-file. modern-003-full-app reclassified from "DEFER" to "REWRITE" (its `< userBadge ...>` line is component-def, NOT transition-decl — separate concern).

- **AST-CONTRACTS-AND-DECOMPOSITION.md updated** — Step 11.5 ✅ S61, Step 12 ✅ S61, 11.0d + 11.0e queued. Total remaining: ~4.5-9.5h across Steps 11.0d, 11.0e, 13.

- **Step 12 — existing-test deltas** (`7be23aa`, T2 tier, 9-commit chain on `phase-a1a-step-12-existing-test-deltas` worktree). Migrated 175 sample files / 330 sites in `samples/compilation-tests/` from legacy `@x = init` decl form to V5-strict `<x> = init` (Q2 RATIFIED Option A). Per-file dynamic classification distinguished first-appearance/decl from post-decl-write — only first-appearance positions migrated; post-decl writes (`@x = newVal`) preserved per SPEC §6.1.2. Also: 2 cosmetic test-description string updates in `lsp/analysis.test.js` + `gauntlet-s24/scope-001-logic-expr.test.js`. Helper scripts at `scripts/step12-*.mjs` (5 files: classify, batch-classify, rewrite, compile-snapshot, validate-batch) — to be cleaned up at Step 13. **ZERO net delta** — 8,878/44/0/8,922 unchanged. **2 NEW PARSER-GAP FOLLOW-UPS surfaced:**
  - **P-FUP-1 — top-level Shape 1 NOT implemented in BS.** SPEC §6.2 documents `<count> = 0` at file top-level as canonical, but BS treats `<count>` at line-start as HTML markup tag opener → falls through with E-CTX-003. The 3 dispatch-named samples (`test-002-with-logic`, `test-009-test-reactive`, `modern-003-full-app`) reverted to legacy `@x = init`. Step 11 smoke covered top-level via kickstarter v2 §3 corpus but didn't hit bare top-level outside `${...}`. Real parser gap. **Queued as Step 11.0d** (BRIEF at `docs/changes/phase-a1a-step-11-0d-toplevel-shape-1/BRIEF.md`; ~3-6h; matches Step 2's foundational decl-recognition pattern but at top-level).
  - **P-FUP-2 — `<x> = not\n<y>` newline boundary bug.** The `not` keyword (M11 modifier) followed by newline causes parser to lose subsequent state-decl siblings in V5-strict structural form. Pre-V5-strict `@x = not\n@y` doesn't trigger. 5 files reverted (`combined-007-crud`, `gauntlet-r10-go-contacts`, `gauntlet-r10-odin-filebrowser`, `gauntlet-r10-rails-blog`, `integration-001-stripe-mini`). Detected via `scripts/step12-validate-batch.mjs` decl-count regression. **Queued as Step 11.0e** (BRIEF at `docs/changes/phase-a1a-step-11-0e-not-newline-boundary/BRIEF.md`; ~1-3h; narrow patch, likely Step 11.0b ASI-NEWLINE branch interaction).
- 624 sites in 858 files in broader `samples/` (outside `samples/compilation-tests/`) deliberately left in legacy form per SURVEY scope. Future migration after P-FUP-2 lands.

- **Step 11.0e — `<x> = not\n<y>` newline boundary fix** (`916de65`, T2 tier, 4-commit chain on `phase-a1a-step-11-0e-not-newline-boundary` worktree). Surfaced as P-FUP-2 by Step 12. **Universal fix** — added `"not"` to `VALUE_KEYWORDS` Set in `collectExpr`'s ASI-NEWLINE branch (`compiler/src/ast-builder.js` L1970). Preserves Step 11.0b's universal-fix property; no `not`-specific branch added. 1 LOC code change + 10 LOC explanation comment. **+8 tests** (§S11E.1-§S11E.8 covering all interactions including legacy regression test §S11E.7). **4 of 5 reverted Step 12 samples restored** to V5-strict canon with decl-count parity verified (`gauntlet-r10-go-contacts`, `gauntlet-r10-odin-filebrowser`, `gauntlet-r10-rails-blog`, `integration-001-stripe-mini`). **The 5th sample (`combined-007-crud`) blocked by NEW finding P-FUP-3** — same-shape bug but with BLOCK_REF (`?{SQL}`) trailing token instead of `not` keyword. Agent correctly scope-limited 11.0e to keyword case; surfaced P-FUP-3 in progress.md. Tests: 8,878 → **8,886 (+8)**. Other M11-family modifiers (`pinned`, `req`) verified safe — they tokenize as IDENT, not KEYWORD.

- **Step 11.0f BRIEF queued** — fixes P-FUP-3 (`<x> = ?{SQL}\n<y>` BLOCK_REF boundary). Likely 1-LOC value-classifier extension at the same locus as 11.0e; estimate 1-3h. BRIEF at `docs/changes/phase-a1a-step-11-0f-blockref-newline-boundary/BRIEF.md`. Restores `combined-007-crud.scrml`.

- **Curation pass — 9 of 10 batches landed** — `docs/changes/` 103-dir wholesale review per pa.md "current truth only" scope principle. Disposition matrix at `docs/curation/2026-05-05-changes-dir-disposition.md`.
  - **Batch A (P-series, 12 dirs)** RATIFIED + EXECUTED (`f4c0081` / `df2f3d2`). p1, p1.e, p2, p2-wrapper, p3.a, p3.a-follow, p3.b, p3-error-rename, p3-follow, p3-rename, p3-spec-paperwork, p4-scrml-migrate. 1 cross-ref fix in `examples/23-trucking-dispatch/FRICTION.md`.
  - **Batch C (dispatch-app M-series, 7 dirs)** RATIFIED + EXECUTED (`729e57c` / `9943174`). dispatch-app + m1..m6. 2 cross-refs in `examples/23-trucking-dispatch/README.md`.
  - **Batch B (expr-ast-phase-4d, 4 dirs)** RATIFIED + EXECUTED (`03e4bb7` / `d5b0e8d`). expr-ast-phase-4d, expr-ast-phase-4d-step-8, expr-ast-phase-4d-step-8-strict, expr-ast-self-host-bs-bug-l-parity. No cross-refs.
  - **Batch F (BUG-letters, 2 dirs)** RATIFIED + EXECUTED (`6e6db27` / `b605a96`). bug-h-rettype-fix, boundary-security-fix. No cross-refs.
  - **Batch D (F-series, 11 dirs)** RATIFIED + EXECUTED (`c7075aa` / `4221fb0`). All f-* feature/fix dirs. 1 cross-ref in `docs/changelog.md` (f-component-001 diagnosis pointer).
  - **Batch I (fix-*, 20 dirs)** RATIFIED + EXECUTED (`5a27670` / `36f9961`). All fix-* hotfix dirs. **6 cross-refs fixed** (changelog ×2, scope-c-findings-tracker ×2, 2 test files referencing fix-* intakes, 2 src files referencing fix-* intakes); 1 dangling pre-existing ref to non-existent fix-bs-machine-closer left as-is.
  - **Batches E + G combined (GITI bugs + bun-sql phases, 4 dirs)** RATIFIED + EXECUTED (`db4a5a6` / `c84544e`). giti-009-import-fix, giti-011-css-at-rules-fix, bun-sql-phase-1, bun-sql-phase-2. No cross-refs.
  - **Batch H (LSP L1-L4, 5 dirs)** RATIFIED + EXECUTED (`122c790` / `880bc76`). lsp-cleanup-retired-bpp-import, lsp-l1-see-the-file, lsp-l2-see-the-workspace, lsp-l3-scrml-unique-completions, lsp-l4-standards-polish. 2 cross-refs pre-fixed in J-pile dirs (`pa-shadow-db-from-any-context/intake.md` + `ast-lift-exported-components-into-components/intake.md`) so refs travel correctly when J moves later.
  - **65 dirs dereffed total.** 1 batch remaining: J (misc, 12 dirs — heterogeneous).
  - **`docs/changes/` count: 103 → 41.**

- **Maps refresh attempted** — S61 maps-refresh agent ran cold scan but Write tool returned permission-denied (system-level directive). Agent returned thorough findings as text including 8 categories of non-compliance items. Item #1 (SPEC head cleanup) actioned. Item #2 (`docs/changes/` curation) **mostly closed** — 9 of 10 batches done. The maps files themselves remain stale (last touched 2026-04-24); root-cause investigation deferred to next session.

**Methodology notes S61:**
- **Per-step branch + cherry-pick + push** pattern continues to work. Step 11.5 was T2-tier; 6-commit chain (1 survey + 4 WIP + 1 final) cherry-picked clean onto main with one transient -1 test mid-chain that recovered to +5 by chain end.
- **Pre-stage survey work** (Step 12 SURVEY) productive in parallel with in-flight dispatch (Step 11.5). PA-side static-pass produced concrete dispositions ready for user ratification. Saves Step 12 dispatch from re-discovering scope.
- **Hidden-coupling discovery during fold** (Step 11.5 emit-logic.ts) validates the BRIEF §6 risk-surface flagging: "consumer might be doing something subtly different." The fold is mechanical until it isn't.

### 2026-05-05 (S60 — A1a 8 steps + A1b/A1c scope-out + RATIFICATION + ADR ratification)

S60 opened on a clean baseline (8,784) post-S59 close with Phase A1a 7/13 done. Eight dispatch cycles + extensive planning produced: 8 A1a step landings (Steps 6, 7, 9, 10, 11, 11.0a, 11.0b, 11.0c — net **+90 tests / +4 test files**), full scope-out documents for A1b (22 steps, 85-120h, FULLY RATIFIED) and A1c (24 steps post-Q3-ratification, 96-136h, FULLY RATIFIED), ADR ratification for `reactive-derived-decl` divergence (Option A FOLD, sequenced AFTER Step 11 BEFORE Step 12, inserted as Step 11.5), Step 11 escalation fully closed (all 3 deferred parser gaps 11.0a/b/c landed), and decomposition refresh (A1a now 17 steps including 11.0a/b/c + 11.5).

**A1a sub-step landings S60 (cumulative 12/17 done):**
- **Step 6 — `default=` + `pinned` on state-decl** (`2754940`). Single-helper extension to `tryParseStructuralDecl` attr scan. Survey insight: `default` is KEYWORD (not IDENT) so needed NEW branch in scanner; `pinned` is contextual IDENT — needed guard BEFORE Step 5's generic validator branch (else captured as validator). 10 test cases (range 6-10), in new §S6 block. Self-host parity not needed. +10 tests; 0 regressions.
- **Step 7 — `pinned` on import items** (`556de93`). Single-file extension to import-decl parser. **Key survey finding:** import parser is REGEX-driven (not token-walker like state-decl), required different extension shape — `_splitPinned` pre-strip helper. Disambiguation handled all 3 edge cases: `import { pinned }` (name not modifier), `import { foo as pinned }` (alias-to-pinned), `import { foo as pinned pinned }` (alias + modifier). 10 test cases; 0 regressions.
- **Step 9 — `reset(@cell)` keyword + E-RESET-NO-ARG** (`fded36a`). 6 commits; 8 tests. Touchpoint: `expression-parser.ts:1057` `CallExpression` case in `esTreeToExprNode` (post-acorn). KEYWORD-vs-IDENT distinction was moot — scrml's KEYWORD set is consulted only by block-level tokenizer; acorn treats `reset` as plain identifier. SPEC §34 already had `E-RESET-NO-ARG` (line 14199); reused for both zero-arg AND multi-arg/spread cases with arity-specific message variants. Files touched broader than BRIEF named: `types/ast.ts`, `expression-parser.ts`, `ast-builder.js` (surfacing), `codegen/emit-expr.ts` (conservative pass-through preserving JS bit-for-bit), `component-expander.ts`, `meta-checker.ts`. Surfacing extended from "root-only check" to **full tree walk** via new `forEachResetExprInExprNode` helper.
- **Step 10 — Mutation shape verification** (`226a2dd`). **Depth-of-survey discount #8** — ZERO source changes. Survey confirmed all three target shapes already correctly produced: `kind:"call"` with `callee.kind:"member"|"index"` for MemberCall; `kind:"assign"` with `target.kind:"member"|"index"` and **`op`** field (16 operators) for MemberAssignment; `kind:"unary"` with `op:"delete"` for UnaryDelete. **Key A1b finding:** discrimination via `ident.name.startsWith("@")` — pure string-shape inspection. **Two-layer lowering** in `ast-builder.js`: specialized kinds (`reactive-array-mutation`, `reactive-nested-assign`) AND `bare-expr.exprNode` structural walk. **B8 walker MUST handle BOTH paths.** +10 tests.
- **Step 11 — Variant C compound + render-by-tag + kickstarter v2 §3 smoke** (`bcca1e6`). **Discovered-blocker escalation, NOT Discount #9.** Survey surfaced 3 deferred parser gaps (Step 2 progress lines 93-98 explicitly DEFERRED Variant C compound recognizer to "Step 11"). Render-by-tag ✅ (parses to `kind:"markup", tag:"userName"`). 16 positive cases passed; 7 anti-test memorials with `TODO[step-11.0a/b/c]` markers added. Kickstarter file located at `docs/articles/llm-kickstarter-v2-2026-05-04.md` with §3 spanning lines 132-249. +23 tests.
- **Step 11.0a — Variant C compound recognizer** (`6d51d00`). 3 commits; +127 LOC source + 14 LOC types. BRIEF touchpoint correction (L3528-3580 was wrong; actual L2912 + L3070 + L1784) — agent corrected per authorization. Both `</>` and `</NAME>` closers accepted (A1b enforces name-match). 2 `TODO[step-11.0a]` memorials flipped. +8 tests.
- **Step 11.0b — Newline-as-statement-separator** (`a7dd96a`). 4 commits; ~30 LOC source. **BRIEF touchpoint correction:** locus is `collectExpr` L1985-2030 ASI-NEWLINE branch, NOT `parseLogicBody`. Step 11.0a's `compoundBody` flag was inside-compound-only; this one is top-level newline-gated. **Free side-benefit:** fix lives in `collectExpr` (not body parser) so it fires universally for ALL ASI gaps (let-decl + state-decl, bare-expr + state-decl, etc.). Multi-line legitimate expressions (`@a +\n@b`) preserved (§S11B.5); markup-RHS angleDepth preserved (§S11B.4 + .10). 1 `TODO[step-11.0b]` memorial flipped. +11 tests.
- **Step 11.0c — Typed-decl recognizer** (`92af2ca`). 4 commits; ~48 LOC source. **High-reuse pattern:** existing `collectTypeAnnotation()` at ast-builder.js:2671 (used at 11+ call sites) was 100% reusable; absorbs refinement-type forms (`string(pattern(/.../))`) via existing paren-depth tracking — zero new logic for refinement-shape collection. Tier 3 positional sugar `("alice", 30, true)` → acorn `SequenceExpression` (ExprNode-acceptable; A1b interprets per §14.11). Bare-variant inference `.Idle` → escape-hatch ExprNode with raw `.Idle` (A1b's M9 resolver handles). 2 `TODO[step-11.0c]` anti-test memorials flipped (4 mentions total resolved; zero `TODO[step-11.0c]` remain in `kickstarter-v2-smoke.test.js`). +10 tests.

**Step 11 escalation FULLY CLOSED at S60.** All 3 deferred parser gaps surfaced by Step 11's smoke verification (Variant C compound, newline-separator, typed-decl) now landed. The 7 anti-test memorials introduced by Step 11 are all flipped to positive: 2 (11.0a) + 1 (11.0b) + 4 mentions resolved (11.0c). `kickstarter-v2-smoke.test.js` no longer carries TODO markers from the Step 11 sweep.

**Planning durables landed S60:**
- **A1b SCOPE-AND-DECOMPOSITION** RATIFIED 2026-05-05 (`docs/changes/phase-a1b-resolve-type/SCOPE-AND-DECOMPOSITION.md`). 22 steps B1-B22 in 5 waves. All 7 open Qs ratified per PA recommendations (user verbatim "ratify all"). Sequence locked: 11.5 → 12 → 13 → A1b. Selective parallel Wave 5 cap 2-3 agents. New `validators.ts` file (final call deferred to B9 survey). Refinement-zone subset for A1b (trusted-zone deferred to A1c C16 OR v0.3.0). Self-host parity deferred to post-A1c. Branch convention `phase-a1b-step-bN-<slug>`.
- **A1c SCOPE-AND-DECOMPOSITION** RATIFIED 2026-05-05 (`docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md`). All 8 open Qs ratified (user verbatim "Q3. C is what i want, the rest are ratified"). **Runtime library Option C compile-time elision selected** — adds NEW foundational step **C0** (feature-usage analyzer at start of A1c) producing a per-app feature-usage bitmap that powers per-step emission. **Total now 24 steps (C0-C23), 96-136h.** Soundness > completeness > minimal-output trade-off ratified. Refinement-zone subset for C16 (trusted-zone deferred to v0.3.0). Postgres+SQLite+MySQL drivers only. ≤5% output regression budget on critical paths (surface-not-block).
- **ADR — `reactive-derived-decl` divergence** RATIFIED 2026-05-05 (S60). User verbatim: "ratify the ADR — Option A". Inserted as Step 11.5 in A1a decomposition.

**Methodology updates S60:**
- Path-discipline near-miss caught + recovered: PA Bash CWD drifted to worktree during a cherry-pick attempt; produced phantom add/add conflict on progress.md; aborted; redid with explicit `git -C <abs-path>` flag. Lesson: cross-tree git ops use `-C` form.
- Depth-of-survey discount #8 confirmed (Step 10).
- Step 11 surfaced new pattern: smoke-verification can produce **discovered-blocker escalation** rather than Discount — the audit-vs-actual gap may flow IN BOTH DIRECTIONS (sometimes work shrinks via discount, sometimes work expands via deferred-from-prior-step revelation).

### 2026-05-05 (S59 — heavy-execution: 7/13 of Phase A1a + program-attrs + L21 + 3 audits + dashboard rewrite)

S59 opened on the outstanding L21 deliberation (E-DERIVED-VALUE-MUTATE) and ended having landed roughly half of Phase A1a's parser-shape work plus a comprehensive scope-of-work realignment after a parser audit revealed the original A1 sizing was based on incomplete picture (~3x understatement). User-driven realignment: "we are in the middle of a MAJOR breaking language change... we need a way of knowing where we are at in the progress." Master-list rewritten as v0.2.0 progress dashboard; README + scrml.dev announce drafted; comprehensive subsystem inventory (~280-440h estimate); article truthfulness audit (15 articles classified). Phase A1a then dispatched per-step with 6 actual landings: Steps 1, 2, 3, 4, 5, 8 + program documentary attrs feature.

**A1a sub-step landings (7 / 13 done at S59 close):**
- **Step 1 — `reset` keyword reserved** (`9cd7779`). Single tokenizer change + 6 unit tests.
- **Step 2 — foundational `<NAME>` decl-site recognition** (`d28f6f7`). Depth-of-survey discount confirmed: agent surveyed and found block-splitter ALREADY preserves raw `<` content correctly via §4.6 PA-001; body-pre-parser inherits via parseLogicBody. Intervention is one helper (`tryParseStructuralDecl`) + 4 call sites in ast-builder.js's statement dispatcher. ~21 minutes wall time vs the audit's 10-15h estimate. +15 tests.
- **Step 3 — AST kind rename `reactive-decl` → `state-decl`** (`8fa26e1`). Mass mechanical sweep: 234 source string-literal renames across 67 files + 254 bare-text comment renames across 51 files + ~20 doc renames. ~514 changes / ~120 file updates. 0 regressions. Permanent fix: `bpp.test.js` cross-cut isolation bug closed (`findMainProjectRoot` now prefers local worktree). Surfaced action item: `.claude/maps/primary.map.md` had 1 ref unrenamed (Edit permission-denied during dispatch); fixed locally during S59 cleanup `94f903a`.
- **Step 4 — shape discriminant on state-decl** (`96dbe92`). 17 construction sites updated (+ self-host parity at `compiler/self-host/ast.scrml`). Sets `shape: "plain"|"derived"`, `structuralForm: true|false`, `isConst: true|false` per AST-CONTRACTS §1.1 discriminant rules. **Surfaced AST-kind divergence:** legacy `const @NAME = expr` produces `kind: "reactive-derived-decl"` (separate kind, NOT touched by Step 3's rename). ~20 consumer sites; folding into `state-decl` queued as future small standalone step (~3-5h). +12 tests; 0 regressions.
- **Step 5 — Shape 2 renderSpec + bareword validators** (`505531f`). Single-helper extension to `tryParseStructuralDecl` for markup-RHS detection + bareword/call-form attribute scan. Wraps RHS markup in `kind: "render-spec"` sub-node; collects validators into `validators[]` field. **Brief-locus correction:** W-ATTR-001 only fires on `kind: "markup"` not `state-decl`, so Layer C of brief (validator-name registration in attribute-registry) was unwarranted. Validator args collected as `string[]` for now; A1b converts to ExprNode[] when typing lands. `is some` (two-word predicate) deferred. §S4.10 invariant test relaxed to admit `"decl-with-spec"`. +15 tests; 0 regressions.
- **Step 8 — E-RESERVED-IDENTIFIER trigger + init.js template fix** (`af4a0da`). Parser detects `function reset()` / `fn reset {...}` as reserved-identifier shadow. init.js starter template renamed `function reset()` → `function clearCount()`; 6 sample sites also renamed. +4 tests; 0 regressions. Scoped to `reset` specifically per dispatch design choice (option a).

**Side feature landings:**
- **L21 lock — `E-DERIVED-VALUE-MUTATE` FORBIDDEN** (`1217b41`, `8e5e459`, `9772c0f`). SPEC.md §6.6.18 NEW (~100 lines): in-place mutation of a `const`-derived cell is forbidden. Covers array mutating methods on derived arrays, property assignment / compound-assignment / `delete` on derived objects, and in-compound derived sub-cells. **Sibling rename §6.6.8** `E-REACTIVE-002` → `E-DERIVED-WRITE` to align with §34 + the `E-DERIVED-*` family.
- **`<program>` documentary attributes** (`4620290`). Five new optional attrs on `<program>`: `title=` (→ `<title>`), `description=` (→ `<meta name="description">`), `version=`, `author=`, `license=`. SPEC §40.7 NEW. W-PROGRAM-TITLE-NESTED warning. emit-html.ts head injection. tier-ladder-promotion article uses new attrs in first code block. Scope creep finding: needed registration in `attribute-registry.js` + `html-elements.js` to avoid spurious W-ATTR-001 (not in original brief). +12 tests; 0 regressions.

**Audit + planning deliverables:**
- **Parser audit** at `docs/changes/v0next-audit/PARSER-AUDIT-2026-05-05.md` (`1eab7a2`). 25 features classified PARSES-NOW / PARTIAL / NOT-AT-ALL / HTML-FRAGMENT (the deceptive-success pattern: 17 of 25 v0.next forms compile-clean while parsing as html-fragment). Foundational gap audit; informed re-decomposition.
- **Comprehensive scope-of-work inventory** at `docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md` (`802375e`). Subsystem-by-subsystem inventory: compiler / runtime / stdlib / tests / self-host / examples / samples / editors / docs. ~280-440h estimate for full v0.2.0 migration (~3x prior assumption). Recommendation: PIECEMEAL not greenfield. Acorn STAYS — pre-processor extension absorbs new syntax above acorn's level. Phase shape revised: A1 35-55h foundational lex/parse → A2 25-40h structural elements → A3 20-35h validators → A4 15-25h schema/refinement → A5 20-30h resolver/typer → A6 30-50h codegen.
- **Article truthfulness audit** at `docs/changes/v0next-inventory/ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md` (`d1618ed`). 15 articles classified ACCURATE / NEEDS-EDIT / RETRACT / DO-NOT-PUBLISH for v0.2.0-in-flight context. Most concerning: `tier-ladder-promotion` (DO-NOT-PUBLISH until A2 ships engines) + `realtime-and-workers` / `mutability-contracts` / `server-boundary-disappears` (NEEDS-EDIT — split works-today vs v0.2.0+ examples).
- **AST contracts + 13-step decomposition rev 2** at `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md` (`be964b7`). Audit-corrected: target node `state-decl` (not `kind: "state"`); foundational pass added as Step 2; Steps 4-7 reorganized to extend renamed `state-decl`; deceptive-success-pattern anti-test mandate in §7.

**Public-facing + dashboard:**
- **Master-list rewrite as v0.2.0 progress dashboard** (`a6504da`, `f1a6da5`). Bloated session-log header (~5k+ words S40-S58 deltas) replaced with concise current-state + new §0 v0.2.0 Migration Status as live dashboard. §0.1 phase progress table; §0.2 L1-L21 locks at-a-glance; §0.3 audit deliverables index; §0.4 open design questions; §0.5 13-step status; §0.6 surfaced divergences (`reactive-derived-decl` divergence + `is some` deferral + path-discipline leak).
- **README v0.2.0 banner + stats refresh** (`88535f9`). Banner near top calling out v0.1.0 shipped baseline + v0.2.0 in-flight breaking change. Stats updated: 32 examples (was 14), 16 stdlib modules (was 13), 8,700+ tests (was 5,500+).
- **scrml.dev announce draft** at `docs/website/v0.2.0-announce-2026-05-05.md` (`88535f9`). ~250 lines. TL;DR + What's-shipped + What's-coming + What-this-means-for-articles + Why-now + Timeline. Voice-fidelity-scrubbed. User-controlled publishing decision.

**Methodology meta-insight captured:**
- **Depth-of-survey discount design-insight** at `scrml-support/design-insights.md` (`5c005a0`, `f7b935a`). Pattern: when an audit estimates >5h for a "new-infrastructure" fix, mandate implementation-time survey-first phase before accepting the estimate. Cost shrinks 2-5x because existing infrastructure routinely covers gaps; actual fix is localized extension, not new infrastructure. **Four confirmed occurrences:** S51 W2 (LSP already shipped canonical-key), S52 DD4 (SPEC §54.2-§54.3 already had extension-point pattern), S59 Step 2 (block-splitter already preserves raw `<`), S59 documentary-attrs (brief-locus error: emit-html.ts vs codegen/index.ts:530-555). PA-SCRML-PRIMER §12 has session-start-discoverable summary + mitigation checklist.

**Other small landings:**
- pa.md F4 step 5 added (`bun run pretest` mandate at fresh worktree startup; recurring infra finding from rev-1 dispatch's ~130 ECONNREFUSED experience).
- `<program>` dual role design question RESOLVED — keep all three (config attrs + body wrapper + nested execution context). No spec changes needed.
- Acorn replacement question RESOLVED — stays. Pre-processor extension absorbs new syntax above acorn's level.
- `reactive-decl` rename to `state-decl` ratified + landed (Step 3).

**Anomalies:**
- **Rev-1 audit agent stalled** at watchdog timeout — recovery: PA-direct probe.
- **Rev-1 + Rev-2 Step-2 dispatches halted at startup verification** — surfaced (a) `bun run pretest` requirement (rev-1 fix in commit `25f4397`) and (b) flake-handling protocol for ≤3-fail-then-clean-rerun (rev-3 fix in commit `3c9748e`). Both became permanent additions to brief template + pa.md.
- **S60 (rev-3) dispatch decomposition vs implementation tension** — agent invoked PHASE 0.5 doctrine and produced decomposition + AST contracts doc instead of monolithic implementation. PA accepted the decomposition; per-step model adopted; led to the depth-of-survey discount finding.
- **Step 5 path-discipline leak (S59 close)** — agent leaked progress.md content directly to main's working tree (not just to its worktree). Recovered cleanly via `git checkout -- progress.md` then proper cherry-pick. No code damage. Investigation queued for next session — extend pa.md F4 path-discipline check to detect leaks earlier.



Previous baseline (2026-05-04 after S58 close): **8,720 pass / 43 skip / 0 fail / 432 files** (pre-commit hook excluding browser; full suite 8,763 / 43 / 0). **Stage 0b COMPLETE** — D3 + D4 landed, scrml:oauth shipped, const-form sweep complete, F4 path-discipline addendum live. 47 commits past S57 close, all pushed. Phase A1+ implementation phase opens at S59.

### 2026-05-05 (S59 — small-deliberation lock L21 + sibling-error rename)

S59 opened with one outstanding deliberation from the S56 outcomes ledger (queued open-Q on `E-DERIVED-VALUE-MUTATE`). Lock ratified by user; SPEC + cross-cutting docs updated in a single targeted edit. Phase A1+ entry planning to follow.

- **Lock L21 — `E-DERIVED-VALUE-MUTATE` FORBIDDEN.** SPEC.md §6.6.18 NEW (~100 lines): in-place mutation of a `const`-derived cell is forbidden. Covers (a) array mutating methods on a derived array (`.push`, `.pop`, `.shift`, `.unshift`, `.splice`, `.reverse`, `.sort`, `.fill`, `.copyWithin`); (b) property assignment / compound-assignment / `delete` on a derived object; (c) in-compound derived sub-cells (`@form.derivedField.push(x)`). Distinguished from sibling errors E-DERIVED-WRITE (reassignment), E-SYNTHESIZED-WRITE (validity surface), E-DERIVED-WITH-VALIDATORS. §34 entry added with rich error-message guidance ("mutate the upstream cell instead — `@items = [...@items, x]`").
- **Sibling rename §6.6.8.** `E-REACTIVE-002` → `E-DERIVED-WRITE` to align with §34 (already on the new name), §6.2 cross-refs, and the `E-DERIVED-*` family naming. Inline rename note left in §6.6.8.
- **§6.5.1 note added.** Mutating-method rewrite applies to mutable reactive cells; on derived cells, see §6.6.18 / E-DERIVED-VALUE-MUTATE.
- **Cross-cutting doc updates.** `IMPLEMENTATION-ROADMAP.md` open-Q + risk row + Phase A2 Q resolved with commit cross-ref. `DISPATCH-2-BRIEF-engines-match-validators.md` §3.6 + §7 entries marked LOCKED. `PA-SCRML-PRIMER.md` §13 locks table extended L21; §11 anti-patterns table got the corresponding row. Single SPEC commit `1217b41`.

Previous baseline (2026-05-04 after S57 close): **8,658 tests passing / 47 skipped / 0 failing / 430 files** (pre-commit hook excluding browser; full suite 8,705/47/0). **+807 pre-commit pass / +129 full pass vs S56 close.** S57 was a heavy-execution session — Stage 0b D1 + D2 SPEC rewrites complete, three stdlib tiers shipped, tier-ladder article drafted + voice-scrubbed, PA scrml expert primer created with pa.md mandating its session-start read, Bun audit complete (already on Bun.SQL; pin ≥1.3.13), agent-file fixed, kickstarter reconciliations + canonical-pattern fold. Stage 0b half done — D3 + D4 pre-written, dispatch-ready S58.

### 2026-05-04 (S57 — heavy-execution: D1+D2 SPEC + stdlib tiers 1-3 + article + primer + agent-file fix)

S57 landed Stage 0b's first two of four dispatches plus extensive stdlib gap-fill plus a primer that should prevent the next PA from re-deriving scrml fundamentals at runtime. 16 commits to scrmlTS main; 1 to scrml-support. Pushed both repos.

- **Dispatch 1 (foundation)**: §1.4 markup-as-first-class-value pillar, §1.5 north star + Tier 0/1/2 ladder, §1.6 V5-strict access; §3.4 V5-strict-per-context table; §6 major rewrite (V5-strict, three RHS shapes, Variant C compound state, render-by-tag, in-compound `const <x>` derived, default=/reset, hoisting, pinned, validity surface stub, §11 fold); §11 deleted/stubbed; §34 +9 error codes; SPEC-INDEX regenerated. Two attempts (D1 partial + D1.5 finish) — landed via `8ac5f3e` + `37f46ca`. **+0 tests; spec text only.**
- **Dispatch 2 (engines/match/validators)**: §17 Tier 0 framing; §18 Tier 1 match (block-form + JS-style + W-MATCH-RULE-INERT); §51 major rewrite (12 subsections); §54 substates composition note; §55 NEW validators + auto-synthesized validity surface (15 subsections); §34 +17 error codes; SPEC-INDEX regenerated with ~40 new Quick Lookup entries. Five attempts (D2 Sonnet → D2.5/D2.6/D2.7 Opus → D2.8 general-purpose) — landed via `af86fc2` + `5f59594`. The D2 saga revealed: agent-file edits cache at session start; SPEC.md size wall makes Read+Write infeasible; Edit's diff-form scales fine; general-purpose dispatch is a valid fallback when pipeline-persona tools haven't propagated.
- **Stdlib Tier 1**: `scrml:redis` (18 exports — Bun.redis wrapper) + `scrml:cron` (3 exports — Bun.cron wrapper). `aae1200`. **+10 tests** (shape-only; live integration gated on REDIS_TEST_URL).
- **Stdlib Tier 2**: `scrml:time` +6 timezone/ISO functions; `scrml:format` +4 Intl extensions (compactNumber, formatList, formatRange, formatNumberAdvanced). `9d038d0`. **+29 tests.**
- **Stdlib Tier 3**: `scrml:http` +5 middleware (withAuth, withDefaults, retry, multipart, uploadFile); `scrml:regex` NEW (14 vetted patterns + 7 helpers). `f700116`. **+43 tests.**
- **OAuth dispatch brief pre-written** at `docs/changes/stdlib-oauth/DISPATCH-BRIEF-scrml-oauth.md` (332 lines). Standalone — no SPEC.md changes. Estimated 12-18h. `0ef332d`.
- **Tier-ladder article drafted** at `docs/articles/tier-ladder-promotion-devto-2026-05-04.md` (293 lines after voice-scrub revision). Bullet-proof framing, three side-by-side Tier 0/1/2 code blocks, errors-as-states beat, anti-overclaim closing. Voice scrubbed: never claim React shipping experience (only personal-project experimentation); never claim XState experience (never used). Code examples use scrml's `fail`/`!{}` model — try/catch is NOT in scrml's vocabulary. `9e728f3`, `ec2784c`.
- **Implementation roadmap** at `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md`. Phase A1-A4 sequential compiler tracks + B1-B5 parallel + C1-C2 docs. Storage-model lock (Phase A1 = source-canonical), data/validate γ rewrite + vocab-alignment task, distribution lock, tagline refresh thread, §8.5 post-v0.2.0 Bun candidates table, SPEC.md per-section split logged as v0.3.0+ candidate (S57 D2.6 finding). `1bd6a7d`, `2532cd6`.
- **Bun audit findings**: SQL ✅ already on Bun.SQL (sqlite/postgres ready, mysql Phase 3); channels = single-instance Bun WS pub/sub (no Redis fan-out — fine for v0.2.0 single-instance, ceiling for multi-replica); routing = custom layer on top of Bun.serve() fetch handler. package.json engines.bun ≥1.3.13.
- **Kickstarter v2 reconciliations**: §9 catalog scrml:http row corrected (REST helpers, not "fetch wrapper"); per-row underclaim fixed across data/crypto/time/format/router; "kills npm reach" tightened to "~80% of typical-app npm needs"; catalog snapshot stamp added; §11.6 schema recipe DB-backend note added; §11.5 canonical async-lifecycle pattern promoted (per-screen `<Name>Phase` enum, no stdlib generic — scrml doesn't need generics; per-domain naming beats generic placeholders); new scrml:redis + scrml:cron + scrml:regex rows added; scrml:time + scrml:format rows extended.
- **PA scrml expert primer NEW** at `docs/PA-SCRML-PRIMER.md` (~300 lines). Distilled scrml canon for PA session-start: V5-strict + three RHS shapes + Variant C compound state + error model (`fail`/`!{}`) + engine recipe + Tier 0/1/2 ladder + validators + 15-module stdlib catalog + frequent anti-patterns + operational rules + L1-L20 lock reference. Per S57 user verbatim: *"PA needs to be the second formost expert on scrml, after me, of course"*. Pa.md mandates read at session-start step 2.
- **scrml-dev-pipeline agent file fixed** at `~/.claude/agents/scrml-dev-pipeline.md`: `model: sonnet → opus` (silent default-down bug); `tools` += `Edit, Grep` (D2.5/D2.7 halted because Edit was missing). Effective NEXT PA session start.
- **scrml-support cross-repo writes**: user-voice-scrmlTS.md S57 entries (release version v0.2.0; storage model A1 = source-canonical; stdlib audit dispositions ratified — γ rewrite, distribution, ~80% honesty; Bun audit ratifications; load-bearing-decision-now methodology directive). `48170b1`.

Previous baseline (2026-05-04 after S55 close): **8,576 tests passing / 40 skipped / 0 failing** (~29,789 expects across 426 files) — **UNCHANGED from S53 close**. Zero compiler/code changes — S55 was a pure deliberation session that closed the v0.next architectural design arc.

Previous baseline (2026-05-03 after S53 close): **8,576 tests passing / 40 skipped / 0 failing** (~29,789 expects across 426 files). Eleven dispatches landed in S53 (4 architectural fixes + 4 mechanical paperwork + DOC-E-RENAME + P4 CLI + AST-SHAPE-RENAME); **+85 tests vs S52 close, 0 regressions across all 11 dispatches**. F-ENGINE-001 RESOLVED + F-CHANNEL-003 FULLY RESOLVED + NR AUTHORITATIVE + state-type-routing.ts disposed + engine rename arc COMPLETE (keyword + TAB type-decl synthesis + internal vars + SPEC worked examples + error codes + user-facing docs + AST shape) + `scrml migrate` CLI shipped (Migrations 1+2). 44 commits past S52 close, all pushed. S51 was the systemic silent-failure sweep session: 12 dispatches (2 deep-dives + 10 fix dispatches) shipped in a single day, closing 9 P0s + many P1/P2s. Net +184 tests, 0 regressions across all dispatch waves. The validation principle (S49) is now mechanically realized for M1/M3/M4/M5/M6/M11 mechanisms; UVB (Unified Validation Bundle) closed 4 silent-failure mechanisms in one focused dispatch.

**Backfill note:** S40, S41, S42 entries are missing from this log — captured in hand-offs + git log. S43 + S44 + S45 + S46 + S47 + S48 + S49 entries below; full backfill is open content todo.

---

## Recently Landed

### 2026-05-04 (S58 CLOSED — Stage 0b COMPLETE: D3 + D4 + scrml:oauth + const-form sweep + F4 addendum)

S58 closed Stage 0b. The v0.next spec engineering target is finalized; Phase A1+ implementation phase opens at S59. 47 commits past S57 close, all pushed.

- **Stage 0b D3 (channels + schema + predicates + `not` keyword)**. SPEC.md +688 lines / SPEC-INDEX.md +45 lines. Branch `changes/v0next-spec-impact-d3`, integrated as `4131891..b55834a` (7 commits incl. final summary). §38 file-level channels + V5-strict body + drop `@shared` (M19); §39 additive shared-core validator vocabulary + SQL DDL lowering rules (L4); §53 refinement-type cross-ref to shared-core (L4); §42.2.5 `is some` vs `req` clarification (L5); §34 +2 codes (E-CHANNEL-INSIDE-PROGRAM, E-CHANNEL-SHARED-MODIFIER), E-CHANNEL-002 retired. **+0 tests; spec text only.** ~14 min wall-time.
- **Stage 0b D4 (cleanup + PIPELINE.md + SPEC-INDEX final regen)**. SPEC.md +688 lines / PIPELINE.md +439 lines (1,941 → 2,380; 22.6% rewrite, addendum-style — prose pass deferred to follow-up §8.6 #2) / SPEC-INDEX.md +50 lines structural regen. Branch `changes/v0next-spec-impact-d4`, integrated as `4131891..cded613` (23 commits incl. final summary). 13 Tier 8 small-edit sections threaded with locks/moves; 4 Tier 10 reviews (§28 +4 lint suppression configs); §34 +7 codes (E-CLOSER-001, E-NAME-COLLIDES-RESERVED, E-STRUCTURAL-ELEMENT-MISPLACED, E-MULTI-STATEMENT-HANDLER, E-IMPORT-PINNED-INVALID, E-DERIVED-CIRCULAR-DEP, E-USE-INVALID-CTX); PIPELINE.md per-stage v0.next addenda (TAB / NR / MOD / UVB / TS / DG / CG) + 11-entry Integration Failure Mode Catalog; SPEC-INDEX final regen with 22 D4 Quick Lookup entries. **+0 tests; spec text only.** ~35 min wall-time.
- **scrml:oauth (16th stdlib module)**. OAuth 2.0 + PKCE (RFC 7636) client. Branch `changes/stdlib-oauth`, integrated as `eaa7cd2..15dd6ff` (5 commits, ordering quirk: PKCE landed last in timeline due to off-by-one in initial cherry-pick range; correctness intact). 6 .scrml modules: `index`, `pkce`, `google`, `github`, `microsoft`, `discord`. Core API: `startFlow`, `exchangeCode`, `refreshToken`, `getUserInfo`, `revoke`. PKCE: `generateVerifier`, `deriveChallenge`. Storage: `memoryAdapter()` dev-only; caller injects production. Typed errors (`OAuthStateMismatch`, `OAuthVerifierMissing`, `OAuthTokenError`, `OAuthUserInfoError`, `OAuthRevocationError`) caught by `err.name`. Kickstarter v2 §9 catalog row + new §11.2.1 OAuth recipe. **+58 tests** (38 core + 20 presets). JWKS sig + OIDC discovery (RFC 8414) deferred to v0.3.0+ (logged roadmap §8.5).
- **§6 + cross-section `const @x` → `const <x>` sweep**. Two-phase. Phase 1: §6 worktree dispatch (`c729a0f..c905b2b`, 6 commits, 62 edits) inside §6 only. Phase 2: 14 additional edits across §11, §12, §22/§23 (g{}/r{} foreign-code derived examples), §34 (E-DERIVED-WRITE prose, E-REACTIVE-002/003 + W-DERIVED-001 prose), §52 (state-authority examples + form refs), L19 status header. SPEC.md now has **zero** `const @x` declaration-form instances. PIPELINE.md, kickstarter v2, primer all spot-checked clean. Roadmap §8.6 #1 marked DONE.
- **pa.md F4 path-discipline addendum**. Surfaced during s34-s52-cleanup dispatch: a sub-dispatched agent's relative path `compiler/SPEC.md` was resolved against the harness's `Additional working directories` list (which includes the main repo), causing 5 silent writes to land in main's working tree instead of the worktree. Agent halted on noticing. The 5 edits were inspected and confirmed correct, accepted into the cluster commit. Addendum to pa.md F4 now mandates ABSOLUTE `$WORKTREE_ROOT/...` paths for Write/Edit; relative paths forbidden because of this leak vector. Also documents `bun install` as startup-step #4 — recurring infra finding (worktrees don't inherit node_modules; pre-commit fails without it; hit by every D2.8/D3/oauth/D4/§6-sweep dispatch this session).
- **PA-SCRML-PRIMER.md updated for D3 + D4**. §0 stamp → S58 close; §9 rewritten "pending → LANDED" with §9.1-§9.6 covering channels, schema additive, predicates cross-ref, `is some` vs `req`, and D4 small-edit threading; §10 stdlib count 15 → 16 with scrml:oauth row + deferrals; §11 anti-patterns +3 rows (multi-statement handler, import-pinned-invalid, component-engine-scope); §12 SPEC.md size 23,100 → 24,382 lines + PIPELINE.md size note + sweep-DONE marker + recurring-bun-install note.
- **Article (`tier-ladder-promotion`) rules-inert framing added**. User flagged that the article never made explicit that `rule="..."` attributes are *allowed but inert* inside `<match>`. Inline paragraph at end of Tier 1 section + ladder diagram annotations: "rule= allowed but inert" at Tier 1, "rule= now load-bearing" at Tier 2. Match is render-time projection, not state machine.
- **Permissions whitelist** added to `.claude/settings.local.json` `permissions.additionalDirectories` for both `scrmlTS/` and `scrml-support/` paths. Stops session-start prompts for cross-repo Read access. Effective next session start.
- **Bun upgraded** locally (mid-session, user-driven). Fresh worktrees from now on inherit the upgrade automatically.

Stage 0b totals: **+1,376 SPEC lines / +439 PIPELINE lines / +95 SPEC-INDEX lines / +9 §34 codes / +58 oauth tests** across 4 dispatches + 2 cleanup sweeps + 16th stdlib module. Test posture stable at 7,991-8,720 pass / 0 fail (pre-commit excludes browser; full 8,763) — count varies with module additions but 0 fails maintained.

### 2026-05-04 (S56 CLOSED — implementation-prep session, 4 dispatchable briefs landed, kickstarter v2 fully L1-L20 compliant; 0 tests, 0 compiler changes, but the implementation phase is now dispatchable)

S56 transitioned the v0.next arc from deliberation (closed at S55) to implementation-prep. Two arcs ran sequentially:

**Arc 1 — Continuation deliberation (locks L11-L20).** PA drafted kickstarter v2 then surfaced 4 open clusters from §4 still-open list. User authorized push-on. Direct PA-user discussion mode produced 9 additional locks closing all four clusters (L11-L19) plus L20 addressing the S55-carryover `derived=` attribute grammar. Total S56 locks: L1-L20.

**Arc 2 — Implementation-prep machinery.** Comprehensive Stage 0a SPEC + PIPELINE impact assessment (446 lines) maps every lock + active S55 move to specific SPEC sections with disposition + dependency-respecting rewrite order. ALL FOUR Stage 0b dispatch briefs pre-written: Dispatch 1 Foundation (502 lines, 14-27hr), Dispatch 2 Engines+Match+Validators (801 lines, 29-50hr — heaviest), Dispatch 3 Channels+Schema+Predicates (367 lines, 9-17hr), Dispatch 4 Cleanup+PIPELINE+SPEC-INDEX (381 lines, 18-33hr). Total Stage 0b: 70-127 hours distributed across 4 bounded dispatches with crash-recovery discipline (commit-each-meaningful-change + progress.md + worktree-isolation).

Locks landed:
- **L1 markup-as-first-class-value (PILLAR — held since scrml8 era)** — markup elements may sit anywhere expressions sit; the markup/value distinction collapses across the language. Surfaced via PA edge-case pushback; user immediately flagged as durable claim from pre-user-voice scrml8 era.
- **L2 Variant C compound state with canonical access** — `<formRes>` structural-children, `@formRes.name` canonical access. Same V5-strict asymmetry as Tier 1, one level deeper.
- **L3 decl-coupled-with-render-spec** — `<name req> = <input/>` declares cell + render-spec + validity contract together; `<name/>` in markup invokes the spec.
- **L4 partial validator unification** — shared core (`req`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`) across loci; schema KEEPS SQL-mirror canonical (`not null`, `unique`, `references`); shared core is additive.
- **L5 `is some` clarification** — coexists with `req` because they enforce different things: `is some` = exists at all; `req` = non-empty / meaningful (`""` is some but not req).
- **L6 match Tier 0/1/2 ladder** — Tier 0 `if=` chains; Tier 1 `<match for=Type>` block-form (structural exhaustiveness, no transitions); Tier 2 `<engine for=Type initial=...>` (full deal). Promotion mechanical/additive.
- **L7 match attributes** — rules legal but inert in `<match>` (lint W-MATCH-RULE-INERT); `effect=`/`<onTransition>` engine-only (E-MATCH-EFFECT-FORBIDDEN).
- **L8 two match shapes** — block-form for markup-emit, JS-style for value-return; same exhaustiveness check, different output category.
- **L9 `loose` flag dropped** — rules-in-match obviates; the `<match>` → `<engine>` swap IS the tightening event.
- **L11 auto-derived validity surface (ε)** — both compound-level (`@x.isValid`, `@x.errors`, `@x.touched`, `@x.submitted`) and per-field (`@x.field.isValid`, etc.) auto-synthesized for compounds with validators. Errors as `ValidationError` enum tags (NOT strings). All read-only.
- **L12 4d four-level error-message resolution** — inline override / project-registered (scrml:data registerMessages) / scrml:data English defaults / `match` escape hatch. `messageFor(errorTag)` walks levels 1-3.
- **L13 `<errors of=expr/>` first-class element** — composable per-field or compound rollup. `of=` always required; `all` attribute toggles full-list rendering; body override permitted.
- **L14 cross-field validation** — no separate vocabulary; falls out of universal-core predicates with cross-cell expression args (`<confirm req eq(@signup.password)>`). Reactive recomputation via L11; circular deps caught at compile time.
- **L15 `const <derived> = expr` (extended ALL-SCOPE)** — derived-cell decl is structural at every scope (not just in-compound). v1's `const @x` form superseded as pre-V5-strict.
- **L16 multi-render via existing paths** — no override syntax; `${@x}` interpolation, component props, or secondary `const <derived>` markup cell.
- **L17 binding-by-render-spec dispatch** — compiler chooses bind:value / bind:checked / bind:files / etc. by render-spec shape; writable cells require bindable render-specs (E-CELL-RENDER-SPEC-NOT-BINDABLE).
- **L18 `reset(@cell)` keyword + `default=` attribute (γ semantics)** — language keyword (not stdlib); mutates in place; `default=` evaluates at reset time, else re-evaluate init expression. Reserved identifier.
- **L19 multi-statement event handlers** — illegal inline; named function required for anything beyond bare-call / bare-assignment / bare-single-expression.
- **L20 `derived=expr` engine attribute** — accepts any reactive expression of the engine's type (typically JS-style `match` block). Derived engines reject `rule=`, `initial=`, direct writes; `<onTransition>`/`effect=` fire on derived state changes; chained derivation legal with cycle detection.

Plus:
- **const-immutability semantics formalized** post-L15 alignment pass: reference-immutable YES (`@x = newval` is `E-DERIVED-WRITE`); value-immutable depends on RHS deps. Truly-frozen non-reactive constants drop the `<>` entirely (plain `const x = ...`). Open Q queued: `E-DERIVED-VALUE-MUTATE` on `@filteredItems.push(x)` (PA leans forbidden, not currently locked).
- **PA.MD context-budget directive (PERMANENT)** — Opus 4.7 1M-context model; do NOT suggest wrap above ~50% remaining without real reason; default threshold ~15-20% remaining; wrap costs ~5-7% context; user-supplied budget signals authoritative. Captured at S56 user observation that PA was carrying earlier-Claude-era 200k-context heuristics.

9 commits scrmlTS + 3 commits scrml-support, all pushed. Implementation phase dispatchable; S57's first move is "launch Dispatch 1 or do further planning" — user's call.

### 2026-05-04 (S55 CLOSED — **PIVOTAL session, massive wrap, deliberation arc complete**; 0 tests, 0 compiler changes, but the v0.next language design is locked)

S55 opened by recovering from an S54 interrupt (the v0.next deliberation pipeline had completed Phase 0 synthesis + Phase 1+2 dives DD5-DD10 + Phase 3 DD5 debate, then crashed). User authorized a mode shift away from the dive/debate cadence in favor of direct PA-user discussion of the open-questions list surfaced by the v0.next-Mario design artifact. The session ran one sustained discussion thread; **21 architectural moves were locked**, the **north star ("UI as a fully-handled state machine") was articulated**, and at session end the **migration design surface dissolved entirely** when the user clarified there are no production scrml adopters (all current code is throwaway experimental).

**Architectural moves catalog at S55 close (21 total):** Moves 1-6 + 8 from S54 synthesis; Moves 9-20 added/refined in S55. Move 7 (multi-close `<///>`) DROPPED — handled by 6nz editor auto-expansion (cross-repo message dropped). Move 21 (two-phase migration) DROPPED — no users to migrate.

**Decisions locked S55 (verbatim user inputs preserved in `scrml-support/user-voice-scrmlTS.md` Session 55):**

- **Move 9 (no debate):** bare-variant `marioState = .Small` parses as qualified when LHS/parameter type known. TS-shape inference.
- **Move 10:** positional binding `<state a b c> = (1,2,3)` legal only when state's shape is fixed by predefined enum/match/engine type. Compiler-gated.
- **V5-strict (Move 3 revised):** `@` is canonical, NOT sugar. Bare names in expressions are LOCALS only. Two-form access (`<v>` structural + `@v` canonical). C9 rescinded — `@` is not JS-framework concession; framework precedent was correct.
- **Move 11:** scoped hoisting (Position D) + lint warning on out-of-order use + `pinned` per-declaration opt-out keyword (upgrades lint to error). TDZ-1 model — no user-visible TDZ window.
- **Move 7 DROPPED:** multi-close shorthand → 6nz editor auto-expansion. General principle: ergonomic shortcuts that fail readability test belong in editor, not grammar.
- **Move 12:** engine validates direct writes via `rule=` contract. `@marioState = .Big` silent-validated; throws on invalid; compile-time check inside state-child bodies.
- **Move 13:** `.advance(.X)` explicit-throws variant for assert-must-work transitions. `.tryAdvance` (silent no-op) explicitly rejected — silent failures hide bugs.
- **Move 14:** `effect=` attribute (single-target one-shot) + `<onTransition to/from once if=...>` structural element (multi-target / attribute-bearing). On-leave default semantics. Lifecycle elements `<onEnter>`/`<onLeave>` skipped — covered by `<onTransition from/to>`.
- **State-children-as-sugar refinement:** `<Small rule=...>{body}</>` is sugar over `if=(@engineVar == .ThisVariant)` + rule= contract. Bodies optional. Mixed engines (some bodied, some bare) legal.
- **Snippets handle shared chrome** — no `<chrome>` template, no `<*>` matcher. Existing language mechanism suffices.
- **Move 15:** `:`-shorthand for single-expression body when no `</>` closer present. `<tag attrs> : expr`. Bare body otherwise (canonical HTML semantics preserved). Mandatory whitespace around `:`.
- **`W-LIFECYCLE-CANDIDATE` lint (opt-out):** boolean state in 3+ structural `if=` sites flags as enum-engine-promotion candidate. Lifecycle-as-engine is the design pattern. Connection to "exhaustively provable" goal — booleans defeat the prover; enum-engines enable it.
- **Move 16:** auto-derived var name = lowercase-first-run of `for=` type. `var=` attribute for override / disambiguation.
- **Move 17:** `initial=` attribute required on non-derived engines (lint warns if omitted, defaults to first state-child). Forbidden on derived engines.
- **Move 18:** engine `<EngineName/>` use-site lives only for cross-file mount; same-file decl-IS-mount; multi-instance marinates.
- **Move 19:** channel shape under v0.next: file-level (NOT inside `<program>`); drops `@shared` modifier; auto-declares variable per Move 16; V5-strict body.
- **Schemas unchanged** — principled exception survives.
- **Move 20:** components stay distinct from engines (Position 1 from multi-instance thread). Components are multi-instance vehicle; engines/channels/schemas are singleton-by-design. Heuristic: app-lifecycle/singleton → engine; widget/reusable/per-instance → component.
- **Move 21 DROPPED at session end** — no migration story; v0.next IS scrml.

**The north star (proposed §1.4 of synthesis, captured S55):**
> the UI of an application SHOULD be a fully handled state machine (engine in scrml case). but development is a process

The structural shape of the UI tree IS the structural shape of the application's state. With the process clause: apps don't START at the north star; they EVOLVE toward it. Compiler nudges (lint), kickstarter teaches the destination, language doesn't ENFORCE the shape. Connection to S54's "exhaustively provable" goal: enum-engines enable structural exhaustiveness checking; booleans-as-lifecycle defeat it.

**THE PIVOTAL CORRECTION — no migration:**
> there is NO ONE writing anything but purely experamental scrml, 100% throw-away code, we dont need to worry about any of that. we just need to fix the compiler, kickstarter, turorial, docs, etc.

This collapsed Move 21, dropped the v0.compat coexistence design, and reframed implementation as "fix scrml to be what it should be" rather than "migrate the world to a new version." Implementation work surface named: compiler + SPEC + PIPELINE + kickstarter + tutorial + examples + samples + self-host + stdlib + LSP/editors + articles. Multi-month effort. Implementation phase opens at S56.

**Files written this session:**

scrml-support:
- `user-voice-scrmlTS.md` — Session 55 entry appended (~14 verbatim quotes + interpretations; ~+450 lines)
- `docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md` — NEW clean decisions ledger
- `docs/deep-dives/v0next-mario-design-2026-05-04.scrml` — header annotation marking 11 superseded constructs (V5-strict, Move 7 dropped, etc.)
- `docs/deep-dives/phase-2-dispatch-briefs-2026-05-03.md` + 3 `progress-dd5/dd6/dd7-...-2026-05-03.md` — S54 leftover untracked artifacts, committed at this wrap as historical preservation

scrmlTS (this wrap commit):
- `hand-off.md` — S55 close fat hand-off (289 lines)
- `handOffs/hand-off-56.md` — pre-save mirror of hand-off.md (forensic preservation)
- `master-list.md` — S55 close inventory update
- `docs/changelog.md` — this entry

6nz (cross-repo outbox):
- `6NZ/handOffs/incoming/2026-05-04-0958-scrmlTS-to-6nz-multi-close-editor-option.md` — request for editor-side `<//>` auto-expansion since Move 7 dropped from language

**Open queue at S55 close (substantially shrunk):**
- Tagline refresh — design polish, not blocking
- Components props/slots/lifecycle internals — sub-thread under Move 20, design AS implementation proceeds
- Mario design file regen under post-S55 rules — useful canonical reference, not blocking
- Self-host migration plan — operational, not design

**Carry-forward findings (deferred into implementation phase):** ast.machineDecls file-level container rename + 3 small S54 dispositions (scrml migrate / SPEC §39.8 collision, SPEC-INDEX.md `E-MACHINE-DIVERGENCE` typo) + pre-S52 findings (F-COMPONENT-003, F-PARSER-ASI sweep, W5a/b, W7, W8, W9-11). Most folded into v0.next implementation; some may be obsoleted; triage at implementation-phase planning.

**Push state:** scrmlTS at this wrap commit pending push; scrml-support at user-voice + outcomes-doc + Mario annotation + S54 leftovers commit pending push. Push authorization pending user greenlight at S56 open.

**Authorization scopes:** "no holds barred" S54 framing was scoped to S55 (deliberation) by hand-off-55 — DOES NOT carry into S56. "PIVOTAL wrap" authorization is for THIS WRAP only. S56 implementation work needs its own authorization scope.

### 2026-05-03 (S53 CLOSED — fixit session, fat wrap, push complete; engine rename arc complete + 4 architectural fixes; 11 dispatches landed, +85 tests, 0 regressions)

S53 opened on the same calendar day as S52 close (2026-05-02). User direction: *"P3 recos good, go"* + *"this is fixit session. we go go go."* + *"keep going on what ever you have answers for or seems obvious."* — high-velocity per-action greenlights, P3 dive recommendations ratified across the board.

**S53 ratifications (per OQ-P3-1..8):** UCD over SP for category dispatch (51/60 vs 46/60); separate dispatches with P3.B first; per-category NR routing for P3.A/B + P3-FOLLOW for the 75-ref migration; W6 worktree DISCARDED entirely (mechanism preserved verbatim in P3 dive §3.1); PURE-CHANNEL-FILE auto-recognized (analogous to §21.5); E-CHANNEL-008 hard error on cross-file `name=` collision; `channels/` at app-root convention; ship P3.A with SQL-via-page-ancestor pattern documented (W5-FOLLOW continues independently).

**Track A — W6 worktree discard.** Branch `changes/w6` deleted (was at `b05812c`); worktree `agent-a566c25e34a40eb59` removed. P3 dive §3.1 preserves the W6 mechanism verbatim for re-implementation. Zero information loss.

**Track B — P3.B (T2-medium primary + T1-small continuation, +21 tests, merge `b794f64`).** TAB synthesizes `type-decl` AST node when parsing `export type X:kind = {...}` (in addition to existing `export-decl`); cross-file `<engine for=ImportedType>` resolves through the import graph. Closes F-ENGINE-001 architecturally. **Primary agent crashed mid-flight on ECONNRESET after 41 min / 110 tool uses** with 7 WIP commits (pre-snapshot + diagnosis + core TAB fix +90 LOC + 4 test tranches +804 LOC) — architectural fix and tests landed and proven (8,512 pass / 0 fail). **T1-small continuation dispatch** (worktree-isolation OFF; operated in existing P3.B worktree) finished SPEC §51.3.2 message correction + §51.16 NEW (cross-file engine subsection) + §21.2 normative + PIPELINE Stage 3 amendment + adopter integration (`pages/driver/hos.scrml` workaround removed; imports `DriverStatus` from `../../schema.scrml`; ~6 LOC eliminated; FRICTION marks F-ENGINE-001 RESOLVED). 4 pre-existing F-NULL-001 errors on `null` literals in hos.scrml verified out-of-scope (compile pre-change baseline shows same errors). 11-commit FF-merge clean.

**Track C — P3.A (T2-large, +27 tests, merge `00c533a`).** Channel cross-file inline-expansion via CHX (CE phase 2 under UCD). Closes F-CHANNEL-003 architecturally. ~700 LOC compiler refactor: `compiler/src/types/ast.ts` (+45, ChannelDeclNode + FileAST.channelDecls + ExportDeclNode.kind="channel") + `ast-builder.js` (+200, top-level `export <channel>` recognition + ChannelDeclNode synthesis + `_p3aIsExport` propagation + quoted-name import handling) + `module-resolver.js` (+30, channel exports registered with `category` field) + `component-expander.ts` (+270, UCD refactor with Phase 1 component + Phase 2 channel expansion + cross-file inline algorithm) + `state-type-routing.ts` NEW (+119, transitional category routing table per OQ-P3-2 b) + `codegen/emit-channel.ts` (+15, defensive `_p3aIsExport` filter) + `gauntlet-phase1-checks.js` (+12, E-IMPORT-001 suppression extended to channel exports). ~970 LOC tests across 8 new files: TAB recognition (6) + MOD registry (3) + CHX same-file pass-through (5) + CHX cross-file inline (5) + multi-page broadcast (3) + PURE-CHANNEL-FILE (2) + E-CHANNEL-008 collision (2) + diagnosis closure (1) + self-host parity ignore filter for `channelDecls`+`specifiers`. SPEC §21.2 + §38.12 NEW (~150 LOC) + §15.15.6 (~10 LOC) + PIPELINE.md Stage 3.2 Phase 2 (~80 LOC). FRICTION marks F-CHANNEL-003 ARCHITECTURALLY RESOLVED. New error codes: E-CHANNEL-008 (cross-file name= collision) + E-CHANNEL-EXPORT-001 (channel exports without string-literal name=). **3 surprising findings agent flagged:** quoted import-name handling (kebab-case channel names like `"dispatch-board"`) added as discrete fix; gauntlet Phase 1 fix (E-IMPORT-001 suppression mirroring P2 component pattern); P3 dive §6.2 worked-example has subtle scoping bug (`topic=@dispatcherId` referring to consumer-scope var doesn't naturally inline; agent used canonical self-contained pattern from `examples/15-channel-chat.scrml` instead) — flagged as P3.A-FOLLOW design consideration. 15-commit FF-merge clean.

**Track D — P3.A-FOLLOW (T1-small, +8 tests, merge `32a330b`).** Dispatch-app channel sweep. **4 channels of 4 migrated, none skipped:** `dispatch-board` (5 pages, ~60 LOC), `customer-events` (5 pages, ~70 LOC), `load-events` (3 pages, ~45 LOC), `driver-events` (2 pages, ~30 LOC). 4 PURE-CHANNEL-FILE exports created under `examples/23-trucking-dispatch/channels/`. 12 consumer pages updated. ~205 LOC inline boilerplate eliminated. FRICTION marks F-CHANNEL-003 → FULLY RESOLVED with migration table + LOC delta + zero-skip rationale. None of the channels had consumer-scope-bound `topic=@var` references (the dispatch app uses default `topic=name` semantics throughout, so the SPEC §38.12 worked-example scoping caveat doesn't apply). 6-commit FF-merge clean.

**Track E — P3-FOLLOW (T2-medium, +4 tests, merge `ab589b3` post-rebase).** Global migration of `isComponent` routing reads to NR-authoritative `resolvedKind` / `resolvedCategory`. **25 routing reads migrated** (the dive's ~75 estimate was misleading — actual: 103 in compiler/src/ + 154 in compiler/tests/, but read-site count is ~25; the rest are write-side stamps + intra-stage syntactic predicates + doc comments, all bounded by the new allowlist test). `compiler/src/state-type-routing.ts` **DELETED** (transitional file disposed; zero in-tree consumers). SPEC §15.15.6 rewritten ("Shadow Mode (P1 Only)" → "NameRes Authority (Post-P3-FOLLOW)") + PIPELINE Stage 3.05 status flipped to "AUTHORITATIVE". Files modified: `component-expander.ts` (added `isUserComponentMarkup` helper, 7 routing-read sites flipped) + `module-resolver.js` (vocabulary aligned: `category: "user-component"` from `"component"`) + `name-resolver.ts` (importedRegistry derivation prefers `info.category`; walker traverses `lift-expr.expr.node`) + `type-system.ts` (§35 attr validation gate flipped) + `validators/post-ce-invariant.ts` (VP-2 gate flipped to `resolvedKind` + uppercase-first-char heuristic) + `types/ast.ts` (deprecation note on `isComponent`; new fields declared) + `lsp/handlers.js` + `lsp/workspace.js` (cross-file completion classification). New allowlist test `p3-follow-no-isComponent-routing.test.js` (4 tests). 9-commit FF-merge clean (post-rebase onto post-P3.A-FOLLOW main).

**5 surprising findings flagged by P3-FOLLOW agent:**
1. **Vocabulary divergence between NR and module-resolver** — NR used `resolvedCategory: "user-component"`, MR used `category: "component"`. P3.A never aligned them. P3-FOLLOW unifies — single canonical name. One P3.A test (`p3a-mod-channel-registry.test.js`) updated.
2. **NR walker did not traverse lift-expr expressions.** VP-2's `walkFileAst` did. Without NR also walking, residual `<UserBadge>` inside `lift <li><UserBadge/></li>` had no NR stamps. NR walker now mirrors VP-2's lift-expr handling.
3. **VP-2 semantic widening.** NR resolves unknown identifier as `resolvedKind: "unknown"` (NOT `"user-component"`). Literal swap would have lost F-COMPONENT-001 silent-failure case. Gate widens to: `resolvedKind === "user-component" OR (resolvedKind === "unknown" AND uppercase-first-char tag)` — mirrors BS's `isComponentName` predicate without reading `isComponent`.
4. **NR-prefer-with-fallback pattern.** Many CE/VP-2 unit tests bypass NR. Pure NR-only routing read would have broken 105+ tests. Implemented: `resolvedKind === "user-component" OR (resolvedKind === undefined AND isComponent === true)`. NR wins when present (authoritative); legacy fallback for unit-test paths.
5. **Dive's ~75-reference estimate was low.** Actual: 103 in compiler/src/ + 154 in compiler/tests/. Most of the gap was BS/ast-builder write-side stamps and parseAttributes parameters that don't need migration. Read-site count (the actual migration scope) is closer to ~25.

**Track F — three mechanical paperwork dispatches (T1-small × 3, dispatched in parallel; all merged with PA-side rebase + conflict resolution).**

- **P3-SPEC-PAPERWORK** (`7c0468e`, 6 commits, FF). SPEC.md worked-example sweep `<machine>` → `<engine>`. **19 replacements, 67 kept** (deprecation references, normative concept text, error-message templates, grammar rules, section headings, attribute-registry cross-reference list). Plan revision during execution: line 20623 (§52.13.3 closed-attribute-set list) reversed REPLACE→KEEP because cross-references `compiler/src/attribute-registry.js`'s internal `"machine"` key. Migration plan documents per-occurrence rationale.
- **P3-RENAME** (`7a575c0`, 6 commits, FF after rebase). Internal compiler `machineName→engineName` identifier rename across 8 files (`ast-builder.js`, `type-system.ts`, codegen × 6). **58 internal renames, 11 references preserved** (1 AST field name `machineName` on AST node + 2 reads + 8 user-visible-text placeholders in JSDoc/error messages). Inventory delta vs dive's ~350 estimate: real read-site count is 68 in 9 files; renamed 58 of those. Future "AST shape rename" dispatch will handle `kind: "machine-decl"` literal + AST field name.
- **P3-ERROR-RENAME** (`b302ede`, 3 commits, FF after rebase + 3-file conflict resolution). Error code rename E-MACHINE-* → E-ENGINE-* across **20 codes / 367 occurrences across 34 files** (compiler/src 5 files / SPEC.md / tests 26 files / examples 2). Surprising finding: naive `s/E-MACHINE-/E-ENGINE-/g` is unsafe — `E-STATE-MACHINE-DIVERGENCE` contains `E-MACHINE-` as substring; agent adopted negative-lookbehind regex `(?<![A-Za-z0-9])E-MACHINE-`. PA-side conflict resolution at merge: 3 files (`ast-builder.js`, `codegen/emit-machines.ts`, `type-system.ts`) had P3-RENAME's `engineName` and P3-ERROR-RENAME's `E-ENGINE-*` changing adjacent lines; resolved by `git checkout --ours` (taking main's post-P3-RENAME state with `engineName` + old `E-MACHINE-*`) + Python re-application of `E-MACHINE-*` → `E-ENGINE-*` substitution (4 + 12 + 75 = 91 replacements). Combined result is the union: `engineName + E-ENGINE-*`. Rebase completed, FF-merged.

**Engine rename status (post P3.B + P1 + P3-RENAME + P3-SPEC-PAPERWORK + P3-ERROR-RENAME):** the rename arc is functionally complete except for: AST `kind: "machine-decl"` literal rename, AST field name `machineName` rename on AST nodes (deferred to future "AST shape rename" dispatch — affects 20+ test references), user-facing docs flagged by P3-ERROR-RENAME (docs/tutorial.md 3 refs, docs/articles/mutability-contracts-devto-2026-04-29.md, docs/tutorial-snippets/02l-derived-machine.scrml, compiler/SPEC-INDEX.md `E-MACHINE-DIVERGENCE` shorthand).

**Test count timeline this session:** S52 close 8,491 → P3.B merge 8,512 (+21) → P3.A merge 8,539 (+27) → P3.A-FOLLOW merge 8,547 (+8) → P3-FOLLOW merge 8,551 (+4) → P3-SPEC-PAPERWORK merge 8,551 (0 — paperwork) → P3-RENAME merge 8,551 (0 — paperwork) → **P3-ERROR-RENAME merge 8,551 (0 — paperwork)**. **Net S53: +60 tests, 0 regressions across 7 dispatches.** Pre-push validation green at every push.

### 2026-05-02 (S52 CLOSED — fat wrap, push complete; architectural pivot; state-as-primary unification ratified; 4 deep-dives + debate + 5 fix dispatches + 1 P3 design dive; +111 tests, 0 regressions)

S52 ran 2026-04-30 → 2026-05-02 (long session crossed midnight twice, machine-A) following S51 close (8,380p baseline). **The architectural-pivot session.** Triggered by a single user observation that scrml has been silently capitulating to JSX conventions for years; resulted in ratification of state-as-primary unification (Approach A, 93/110 vs B 71.5/110 in 6-expert debate), engine rename (machine→engine) folded into P1, whitespace warn-then-error decided, body grammar uniform-with-extension-points decided.

The catalyst was the W6 dispatch (carry-over from S51 plan): it shipped a §21.2 SHALL NOT against `export <markup>` to close F-CHANNEL-003 silently, and the user identified that within hours as "basically unacceptable" — locks in the wrap-in-const concession. That single rejection triggered the architectural pivot.

**Track A — W6 dispatch (PARKED, NOT MERGED).** F-MACHINE-001 fully RESOLVED (TAB synthesizes sibling type-decl for `export type X:kind = {...}`; cross-file `<machine for=ImportedType>` works; SPEC §51.3.2.5 + §41.2). F-CHANNEL-003 PARTIAL — agent unilaterally shipped the §21.2 SHALL NOT against `export <markup>` (E-EXPORT-001) instead of the diagnosis's recommended inline-expansion. User identified the SHALL NOT as wrong direction (locks in wrap-in-const concession permanently). W6 worktree at `changes/w6` 10 commits never merged. F-MACHINE-001 fix in W6 is salvageable but redundant once P3 lands cross-file resolution architecturally.

**Track B — Three parallel deep-dives (DD1+DD2+DD3).** User direction: *"deep dive. start multiple if its worth it"*. PA dispatched 3 parallel scrml-deep-dive agents.
- **DD1 — State-as-Primary Architectural Unification** (master conceptual, T3) at `scrml-support/docs/deep-dives/state-as-primary-unification-2026-04-30.md` (~1170 lines). Recommends Approach A. Scores A 51/60 vs W6-shipped C 28/60 on 12-dimension matrix. Catalogs 8 historical concessions Approach A removes (PascalCase, wrap-in-const, whitespace-after-`<`, separate state/markup categories, dual naming patterns, §21.2 SHALL NOT, §38.4.1 channel carveout, F-AUTH-002 modifier prefix asymmetry). Convergent dev-agent signal: 3 friction reports independently reach for Approach A-shaped fixes. 7 OQs with defaults proposed.
- **DD2 — Parser Disambiguation Feasibility** (T2-large) at `parser-disambiguation-feasibility-2026-04-30.md` (~700 lines). Verdict **FEASIBLE-WITH-COST**. T2-large × 3 phases (~2-3 weeks). Built on existing W2 canonical-key infrastructure already in LSP. Eliminates Approach B (name-table-at-parse breaks per-file parallelism, lexer-hack risk).
- **DD3 — Prior Art Survey** (T2-large) — **FAILED at 600s agent stall**. PA decided to skip re-launch (DD1 §7 had 14-system catalog autonomously). Progress file remains as untracked artifact.
- Both DD1 and DD2 agents delivered as inline messages instead of writing to disk; PA had to manually persist them. Pattern noted for future deep-dive briefs.

**Track C — DD4 (state-type body grammar).** User-floated questions about `<machine>` body restriction and engine rename led to pre-decided direction: bodies should be uniform with extension points. PA dispatched DD4 with that as input.
- **DD4 — State-Type Body Grammar Uniform-with-Extensions** (T2-large) at `state-type-body-grammar-uniform-extensions-2026-04-30.md` (1187 lines). Confirmed reusability hypothesis (uniform bodies INCREASE reusability). **Killer finding:** SPEC §54.2-§54.3 (Nested Substate Declarations + State-Local Transition Declarations) ALREADY ships the extension-point pattern for type-with-body. DD4 GENERALIZES existing scrml shape, not invents.
- Recommended phasing: T1+T2 (~10-13 days dispatch). `<schema>` stays compile-time-only (principled exception). `<formResult>` default-rendering deferred to T3.
- DD4 wrote to disk correctly (the agent followed the explicit "WRITE this to disk" brief).

**Track D — Debate (Approach A vs B, "for shits and giggles").** User authorized debate even though technical case for A was already strong. debate-curator dispatched with full pipeline. 6 panelists: A camp (scrml-dev-elixir + scrml-dev-htmx + racket-hash-lang-expert) vs B camp (scrml-dev-react + scrml-dev-typescript + scrml-dev-vue). **Verdict: Approach A wins 93/110 vs Approach B's 71.5/110** on extended 11-dimension rubric. Largest spreads favoring A: Paradigm fit (+7), Idiomaticity to user vision (+5.5), Cross-file architectural cleanup (+5), Spec coherence (+4.5). Tie-breaker: convergent dev-agent signal. Honest minority position from B camp on per-category type distinctness — informs implementation: A's `StateTypeDeclNode` must carry strong `category` discriminator (DD4's `StateTypeRegistration` already does this). Insight appended to `~/.claude/design-insights.md`.

**Track E — User ratification.** *"ratify yes. engine yes . other qs default. go"* — Approach A locked, engine rename folded into P1 (overrode DD4's defer recommendation), all 7 OQs at defaults.

**Track F — P1 dispatch (T2-large, +8 tests, merge `0334942`).** Lowest-risk first commit per DD1 §9.1. SPEC §4.3 + §15.6 + §15.8 + §15.12 case-rule softening (SHALL → MAY); SPEC §15.15 NEW unified state-type registry section; 3 new warning codes catalogued (W-CASE-001/W-WHITESPACE-001/W-DEPRECATED-001); TAB recognizes both `<engine>` and `<machine>` keywords; W-DEPRECATED-001 runtime emission on `<machine>` (8 tests); 2 examples migrated to `<engine>` (mario, dispatch app hos.scrml); SPEC §51.3.2 engine canonical; PIPELINE Stage 3.05 NameRes design contract documented. **PARTIAL but adequate** — implementation of NR + warning emissions + uniform opener deferred to P1.E (depends on uniform opener landing first to avoid W-WHITESPACE-001 noisiness flood).

**Track G — P1.E dispatch (T2-medium, +56 tests, merge `1a89e84`).** Builds on P1. **NameRes Stage 3.05** at `compiler/src/name-resolver.ts` (~410 LOC, bigger than 150 estimate; shadow mode — advisory). Wired post-MOD. Walks tag-bearing nodes; stamps `resolvedKind` + `resolvedCategory`. Downstream stages (CE, MOD, TS, codegen) STILL route on `isComponent`; the 63 isComponent references DO NOT migrate yet (deferred). **Uniform opener:** both `<id>` and `< id>` produce equivalent AST for db, schema, engine, machine, channel, timer, poll, request, errorBoundary. **W-CASE-001 + W-WHITESPACE-001 runtime emission live** (NR-driven). Samples migrated to `<engine>` (machine-basic, machine-002-traffic-light, rust-dev-debate-dashboard). Dedicated W-DEPRECATED-001 regression tests replaced sample-based coverage. SPEC §15.15 + §34 + PIPELINE Stage 3.05 flipped from "documented" to "implemented (shadow mode)". Performance within 10% (14.45-15.91s vs 14.51 baseline). Wart: agent renamed gauntlet stage labels in api.js (3.05/3.06 → 3.005/3.006) to avoid clash with NR. New finding: 60 new W-WHITESPACE-001 warnings firing on `samples/compilation-tests/` (pre-existing samples use `< db>` style; deprecation warning doing its job; not a bug).

**Track H — P2 dispatch (T2-medium-to-large, +18 tests, on `changes/p2`).** The user-visible win: `export <ComponentName attrs>{body}</>` direct grammar at top level. SPEC §21.2 amendment with both forms documented (Form 1 canonical + Form 2 legacy `export const Name = <markup>` as transitional sugar per OQ-DD1-3). TAB recognizes `export <Identifier ...>` at top level. MOD's exportRegistry shape-equivalent for both forms. Cross-file imports work for both. Both forms coexist. **Wrapper semantic gap surfaced:** agent shipped Form 1 by desugaring to `export const UserBadge = <UserBadge attrs>{body}</>` — body wrapped in `<UserBadge>` custom-element shell at render time. NOT byte-equivalent to Form 2. Agent documented as "deferred refinement"; PA surfaced; user chose option (a) — block merge until wrapper fixed.

**Track I — P2 wrapper fix dispatch (T1-medium, +17 tests, merge `966a493` via `changes/p2-wrapper`).** Builds on P2. TAB desugaring rewritten — body's root element absorbs outer attrs (typed-prop declarations + non-typed attrs). E-EXPORT-002 fires on empty/multi-rooted body. E-EXPORT-003 fires on outer/inner attr name conflict. SPEC §21.2 caveat dropped — byte-equivalence is now normative. SPEC §21.6 — new error codes catalogued. 14 unit tests (AST equivalence) + 3 integration tests (HTML byte-equivalence) verify Form 1 + Form 2 are equivalent. **New finding (pre-existing, not P2-introduced) — F-COMPONENT-004:** `substituteProps` in CE walks markup text + attr values but NOT into logic-block bodies (ExprNodes inside `${...}` blocks within component bodies); affects both Form 1 and Form 2 equally.

**Track J — F-COMPONENT-004 fix (IN FLIGHT at this changelog entry).** First dispatch HALTED at startup verification — harness gave the worktree a stale base (S51 close `3338377` instead of current main `966a493`). Agent correctly halted per startup-verification protocol; clean exit. Re-dispatched with explicit stale-base recovery prelude (`git reset --hard main` + symlink check + pretest regen). Scope: extend `substituteProps` to walk into logic-block bodies (ExprNodes); shadowing-aware (lambda parameters, local declarations, template literals, nested logic blocks); new helper `substitutePropsInExprNode(node, propMap, shadowedSet)`; Form 1 + Form 2 parity test updated from "same errors" → "same success".

**Status of original 6 S50 P0s (carry-forward):** unchanged from S51 close — F-AUTH-001 silent-window UVB-closed (ergonomic W7 deferred), F-AUTH-002 Layer 1 only (W5a + W5b deferred), F-COMPONENT-001 W1+W2 + F4 caveat (F-COMPONENT-003 nested-PascalCase open), F-RI-001 fully resolved W4, F-CHANNEL-001 W1, F-COMPILE-001 W0a; F-COMPILE-002 + F-BUILD-002 + F-SQL-001 closed S51.

**8 historical concessions catalogued (DD1 §3) for Approach A removal across P1-P4 phases:** PascalCase as discriminator (C1 — first concession identified) / wrap-in-const for components (C2) / whitespace-after-`<` discriminator (C3) / separate state-type categories (C4) / dual naming patterns (C5) / §21.2 SHALL NOT W6 amendment (C6 — never merged) / §38.4.1 channel per-page carveout (C7 — never merged) / `export pure/server function` modifier prefix asymmetry (C8).

**1 newly-surfaced finding open at S52 close:** F-COMPONENT-004 (substituteProps doesn't walk logic-block bodies — IN FLIGHT, expected to land soon).

**Carry-forward queue from S51:** F-COMPONENT-003 (nested-PascalCase Phase-1 limitation), F-COMPILE-003 (pure-helper export emission), W5a (pure-fn library auto-emit), W5b (cross-file `?{}` resolution), F-PARSER-ASI batch (30 trailing warnings), W7-W12 dispatches.

**Multi-session phase plan ahead (per DD1 §9.1 + DD4):** P3 (T3, ~10-15 days — cross-file `<channel>`/`<engine>` inline-expansion; closes F-CHANNEL-003 + F-MACHINE-001 architecturally; supersedes W6's tactical fixes); P4 (T1-small — `scrml-migrate` CLI); internal compiler rename `machineName→engineName` (~350 refs T2-small mechanical); SPEC §51 keyword sweep (T1-small paperwork); E-MACHINE-* → E-ENGINE-* rename (T1-small paperwork); NameRes promotion to authoritative routing (63 isComponent → kind switches; T2-medium, likely part of P3).

**Test count timeline this session:** S51 close 8,380 → P1 merge 8,388 (+8) → P1.E merge 8,484 pre-pretest / 8,444 post-pretest (+96 / +56 effective) → P2 worktree 8,462 (+18) → P2-wrapper merge 8,479 (+17) → P2-wrapper post-pretest 8,519 / 410 files (current). **Net delta from S51 close: +139 pass, 0 skip change, 0 fail change, +10 files. Zero regressions across all 5 fix-dispatch waves.**

**Authorization scope (closing note):** S52's per-action greenlights ("go", "fine to merge", "ratify yes", "2 fix go", "park w6", "go your reco") were per-action throughout. Does NOT carry into S53. Per pa.md "Authorization stands for the scope specified, not beyond." Re-confirm before any merge / push / cross-repo write / dispatch.

**Track K-M close additions (post-mid-flight):** F-COMPONENT-004 fix landed (substituteProps walks logic-block bodies; shadowing-aware; SPEC §15.10.1; FRICTION RESOLVED; +12 tests; merge `e95aa87`). Bookkeeping commit `6e2aa4c` mid-flight. Both repos pushed (scrmlTS `3338377..6e2aa4c` 32 commits; scrml-support `2687e48..f016dad` 1 commit). P3 design dive completed and on disk at `scrml-support/docs/deep-dives/p3-cross-file-inline-expansion-2026-05-02.md` (1029 lines). P3 recommendations: channel via CHX/UCD; engine via Tier 1 TAB type-decl synthesis (W6 Option A pattern preserved); UCD over SP (51/60 vs 46/60); per-category NR promotion; 75 isComponent migration to P3-FOLLOW; W6 worktree disposition = discard entirely. P3.B first (T2-medium), P3.A second (T2-large), P3-FOLLOW third (T2-medium). **Push state at S52 close:** scrmlTS pushed clean to origin (33 commits past S51 close including final wrap commit); scrml-support pushed clean (P3 dive + progress committed in this wrap). **Push complete via "do it fat" wrap directive.**

### 2026-04-30 (S51 close — fat wrap; systemic silent-failure sweep, 12 dispatches, +184 tests, 0 regressions)

S51 ran 2026-04-30 (single long day, machine-A) following S50 close (8,196p baseline). User directive: *"anywhere, we're fixing everything"* + *"lets deep dive with everrything first"*. The session opened with a structured 5-phase deep-dive at `scrml-support/docs/deep-dives/systemic-silent-failure-sweep-2026-04-30.md` (1,026 lines) cataloging 35 items across 16 mechanisms and recommending the **Unified Validation Bundle (UVB)** as the critical path. Twelve dispatches followed in sequence + parallel.

**Track A — parent silent-failure deep-dive (research, 1,026 lines).** Cataloged every open architectural defect from S50 + 5+ pre-existing carry-forwards. Identified 16 failure mechanisms (6 P0-bearing). Discovered M17: test-scaffolding-masks-production (F-COMPONENT-001 + F-RI-001 both have unit tests that pass while production is broken — synthetic key fixtures + isolated narrow shapes mask real cross-file bugs). Recommended UVB unified bundle (4 validation passes shipped in one focused T2 dispatch) as critical path. 12 OQs surfaced; user accepted defaults. Prior art: Cargo / MSBuild / Astro / Bazel / Salsa / Roc / Lean / Rust / Elm — all have fail-loud invariants for the same defect classes.

**Track B — W0a F-COMPILE-001 fix (T2, +17 tests, merge `268f190`).** `scrml compile <dir>` was flattening output by basename: 32 source → 17 HTML / 47 distinct (15 collisions) for the dispatch app pre-fix. Two-part fix: Option A (preserve source dir structure in dist/ — `pages/customer/home.scrml` → `dist/pages/customer/home.html`) + Option B (E-CG-015 hard-error on basename collision pre-write). SPEC §47.9 (output path encoding) added. Dispatch app now produces 32 → 74 distinct outputs with 0 collisions. Discovered F-BUILD-002 candidate (`_scrml_session_destroy` duplicate import) and E-CG-002 spec/impl drift (E-CG-002 was already taken by `emit-server.ts:76`; SPEC corrected; W0a used E-CG-015 next-available).

**Track C — W0b OQ-2 dev-server bootstrap (T2, +9 tests, merge `70eb995`; CRASHED + RESUMED).** Codegen emitted literal `import { ... } from "scrml:auth"`; Bun cannot resolve `scrml:*` scheme. Fix: hand-written ES module shims for auth/crypto/store at `compiler/runtime/stdlib/<name>.js`; `bundleStdlibForRun()` copies them to `<outputDir>/_scrml/<name>.js`; `rewriteStdlibImports()` rewrites emitted `from "scrml:NAME"` to relative path computed from each file's `targetDir` (so nested-output files emit `../../_scrml/...`). First dispatch crashed at tool_use 184 with API ConnectionRefused. Resumed via fresh dispatch on existing worktree; rebased against post-W0a main with manual conflict resolution in api.js (preserved W0a's `pathFor()`/`writeOutput()`/`writtenPaths` AND W0b's stdlib bundling). Why hand-written shims: stdlib `.scrml` sources contain `server {}` blocks the standard pipeline doesn't lower at TS time today (separate M16 gap). Discovered F-COMPILE-002 candidate (`.scrml` extension imports not rewritten) + SQL Class B parse failures (13 of 17 dev-server failures emit `sql-ref:-1`).

**Track D — W1 UVB unified validation bundle (T2, +44 tests, merge `1f640d5`).** 4 validation passes: VP-1 per-element attribute allowlist with W-ATTR-001 (unrecognized name) + W-ATTR-002 (unrecognized value-shape); VP-2 post-CE invariant E-COMPONENT-035 on residual `isComponent: true`; VP-3 attribute-interpolation E-CHANNEL-007 on `${...}` in `<channel name=>`/`<channel topic=>`; VP-4 subsumed by W0a's E-CG-015. New `compiler/src/attribute-registry.js` (per-element attribute schema for scrml-special elements). New `compiler/src/validators/` directory (4 files + AST walker). SPEC §15.14 + §38.11 + §52.13 amendments. PIPELINE Stage 3.3 added. Smoke-test confirmed: `examples/22-multifile/` now FAILS LOUDLY with E-COMPONENT-035 instead of silently emitting `document.createElement("UserBadge")`. Dispatch app's `pages/dispatch/board.scrml` errors with 3× E-COMPONENT-035.

**Track E — W2 architectural deep-dive child (research, 1,093 lines).** Killer finding: the LSP at `lsp/workspace.js` already ships canonical-key + auto-gather. CE is the outlier among 4 cross-file consumers (TS-pass, module-resolver, LSP all use absolute-path keying correctly; only CE reads `imp.source` raw). Trade-off matrix decisive: Approach B (unified canonical-key + recursion + auto-gather) leads by 11 over A, 13 over D, 17 over C. **No debate needed** per deep-dive §15. Compresses parent's T3 estimate to T2-large.

**Track F — W2 architectural fix (T2-large, +10 tests, merge `1f4430d`).** Approach B + B2-b sub-decision (CE consumes `importGraph` directly; mirrors TS-pass pattern at `api.js:626-660`). F1 (CE recursion fix in `hasAnyComponentRefsInLogic`) + F2 (canonical-key via importGraph + lookupKey helper) + F3 (CLI auto-gather transitive `.scrml` import closure with `--no-gather` opt-out + sane-limit guard E-IMPORT-007). Bonus discovery NOT in deep-dive's catalog: TAB classifies `${ export const X = <markup/> }` as `export-decl` (not `component-def`), so cross-file `ast.components` was empty for export-const components; CE now also scans `ast.exports` and synthesizes a component-def. New integration tests `compiler/tests/integration/cross-file-components.test.js` close M17 scaffolding-mask gap. SPEC §15.14.4/§15.14.5/§21.6/§21.7 + PIPELINE Stage 3.2 amendments. G1-G4 PASSED (22-multifile compiles clean + emits expanded markup + integration tests pass). G5 partial — F4 nested-PascalCase Phase-1 limitation surfaced (`parseComponentBody` produces 0 blocks for `<LoadCard>` containing `<LoadStatusBadge>`; same-file fails identically; pre-existing not W2-caused; filed F-COMPONENT-003 candidate). `examples/22-multifile/` master-list row flipped `[x][❌]` → `[x][✅]`. Kickstarter v1 multi-file section dropped KNOWN-BROKEN flag.

**Track G — W3 F-NULL-001 + F-NULL-002 paired fix (T2, +15 tests, merge `37c9f8d`).** Diagnostic finding: F-NULL-001's "machine-context-dependent" trigger was incidental at post-W1 baseline. Real root cause: GCP3 walker's `walkAst` inspected `condExpr/initExpr/exprNode/argsExpr` but never visited `markup.attrs[*].value.exprNode` (server-fn bodies routed through `if-stmt.condExpr` visited; markup-attr expressions at `attrs[*].value.exprNode` unreached). Plus separate diagnostic-quality bug: `spanFromEstree` hard-coded `line:1, col:1`. SPEC §42.7 amendment (uniform rejection across all source positions). **`--no-verify` violation by commit `7d2c4e7`** (TDD red intermediate; bypassed pre-commit hook for failing-tests-then-fix cycle; next commit `09cca5e` was clean). Per pa.md this requires explicit user authorization; flagged for next-session attention.

**Track H — W3.1 + W3.2 paired follow-on null sweeps (T2, +39 tests, merge `e69ecac`).** W3.1 bare-null literals: detector only caught `==`/`!=` operands; missed bare `null`/`undefined` in declaration init / return / object property / array element / ternary branch / default param. Fix: `forEachLitNull` walker visits every exprNode subtree + emits E-SYNTAX-042 on lit-null. Suppression for `is-not`/`is-some`/`is-not-not` synthetic operands. W3.2 string-template attribute interpolation: `<div class="${@x == null ? a : b}">` silently passed because `${...}` was preserved as raw text inside `kind:"string-literal"`. Fix shape (b) tactical: `extractTemplateInterpSegments` scans for `${...}` with brace-depth tracking; each segment re-parsed via existing `parseExprToNode`; resulting exprNode fed back through `inspectExprNode`. SPEC §42.7 enumerated 3 rejection categories + suppression rule. Cascade fixture updates: TodoMVC `app.scrml` (3 sites) + `fn-expr-member-assign.test.js` (3 fixtures) — both used `null` as semantically-equivalent placeholders for `not`; updated to spec-compliant `not` in same commit as detector.

**Track I — F-COMPILE-002 + F-BUILD-002 paired (T2, +15 tests, merge `9ac3731`).** F-COMPILE-002 two-layer bug: (1) `emit-server.ts:111-122` emitted `stmt.source` verbatim (no `.scrml` rewrite); (2) post-emit `rewriteRelativeImportPaths` would mis-relocate `.server.js`/`.client.js` back into source tree. Fix: extension rewrite in emit-server + rewriter skip for compiled-output extensions. F-BUILD-002 single-source bug: `emit-server.ts:166` emits `_scrml_session_destroy` from EVERY auth-middleware server.js; `generateServerEntry` imported each module's exports under name → N copies → SyntaxError. Fix shape: option (d) skip-duplicate (first-importer-wins). SPEC §47.10 + §47.11 + §47.12 amendments. Discovered F-COMPILE-003 candidate (pure-helper `.scrml` files compile to near-empty `.client.js` and no `.server.js`).

**Track J — F-SQL-001 `?{}` parser (T2, +17 tests, merge `5c35618`).** Diagnostic finding: regex `/\?\{[^}]*\}/g` in `compiler/src/expression-parser.ts:137,169` cannot handle `?{...${expr}...}` — non-greedy `[^}]*` stops at first `}`, which in real SQL templates is the closing brace of `${}` interpolation. Acorn then sees truncated input. The dispatch's reference to `sql-ref:-1` was a slight mis-statement; real bug was regex truncation. Fix shape (C) both ergonomic + hard-error: `replaceSqlBlockPlaceholder()` context-mode-stack scanner with frames `js{depth}` / `template` / `single` / `double`; `?{` enters JS-context, `` ` `` enters template, `${` inside template enters nested JS, pops correctly; quoted strings respected. When scanner reaches end-of-input with outer JS-frame still open, `ParseResult.sqlDiagnostic` carries E-SQL-008. SPEC §44.8 + E-SQL-008 amendments. Trailing-content warnings dispatch app: 146 → 30 (eliminated 116; 30 remaining are pre-existing non-SQL ASI cases — F-PARSER-ASI-* / F-PARSER-MARKUP-FRAG-* candidates).

**Track K — W4 F-RI-001 deeper (T2-large, +6 tests, merge `474cce0`).** Most surprising finding of the session: `route-inference.ts` `collectReferencedNames` extracted identifier names via regex applied to **flat-stringified ExprNodes**. The regex matched identifier-shaped tokens **inside string-literal contents**. The capture-taint loop then resolved those bogus names against the global cross-file `fnNameToNodeIds` map. In the dispatch app, `transition()`'s `"/login?reason=unauthorized"` string literal collided with `app.scrml`'s `server function login`, false-tainting `transition`, firing E-RI-002 — but only in directory (multi-file) compile mode, which is why S50's narrow regression tests (single-server-fn shapes) didn't catch it. Fix: replace regex with structural ExprNode walk via existing `forEachIdentInExprNode` (visits only `IdentExpr` nodes, skips `LitExpr` content, skips `MemberExpr.property`, skips `LambdaExpr` bodies). M2 workaround reverted across **10 dispatch-app pages**: dispatch/load-detail, dispatch/billing, customer/load-detail, customer/quote, customer/invoices, driver/load-detail, driver/home, driver/hos, driver/messages, driver/profile. SPEC §12.4 per-fn invariant amendment. **F-RI-001 went PARTIAL → FULLY RESOLVED.** No E-RI-002 fired anywhere on dispatch app post-fix.

**Track L — W5 F-AUTH-002 PARTIAL (T2, +13 tests, merge `56b80ad`).** 3-layer diagnosis: (Layer 1) `ast-builder.js` EXPORT branch's regex was blind to `pure`/`server` modifier tokens; `collectExpr` stopped at `function` STMT_KEYWORD after consuming `server`; left `exportedName=null` and broke cross-file imports of `export server function NAME` with E-IMPORT-004. (Layer 2) Pure-fn files in browser mode produce empty `.client.js` regardless of exports — SPEC §21.5's "auto-detect" promise is unimplemented. (Layer 3) Cross-file `?{}` resolution against importing `<program db=>` has no spec contract. **Layer 1 only fixed.** Modifier parsing fix + SPEC §21.5.1 + §44.7.1 + E-SQL-009 contract direction. **Layers 2 + 3 deferred as W5a (pure-fn library auto-emit) + W5b (cross-file `?{}` resolve)**; W5a is prerequisite for W5b. Architectural cross-file emission gap is broader than F-AUTH-002 (also affects non-SQL pure-fn exports).

**Bookkeeping:** mid-session commit `8dddd27` added 5 newly-surfaced findings to dispatch-app FRICTION.md (F-COMPILE-002, F-BUILD-002, F-SQL-001, F-NULL-003, F-NULL-004) before their respective fix dispatches.

**Status of original 6 S50 P0s:** 5 closed (F-AUTH-001/W1, F-COMPONENT-001/W1+W2, F-CHANNEL-001/W1, F-COMPILE-001/W0a, F-RI-001/W4 fully resolved); 1 partial (F-AUTH-002/W5 Layer 1; W5a + W5b queued). **3 newly-surfaced P0s all closed** (F-COMPILE-002, F-BUILD-002, F-SQL-001).

**5 newly-surfaced findings still open at S51 close:** F-COMPONENT-003 candidate (nested-PascalCase Phase-1 limitation in `parseComponentBody`); F-COMPILE-003 candidate (pure-helper export emission); W5a (pure-fn library auto-emit) + W5b (cross-file `?{}` resolve); F-PARSER-ASI / F-PARSER-MARKUP-FRAG batch (30 trailing warnings post-F-SQL-001).

**Authorization scope (closing note):** S51's "go"/"green"/"a"/"b"/"c"/"greenlight fat wrap" pattern was per-action throughout. Does NOT carry into S52. Per pa.md "Authorization stands for the scope specified, not beyond." Re-confirm before any merge / push / cross-repo write / dispatch.

**Push state:** scrmlTS 67 commits ahead of origin pre-wrap; wrap commits add 3-4 more. scrml-support 4 untracked deep-dive files + needs user-voice S51 append. **Push authorized via "greenlight fat wrap" directive at session close.**

### 2026-04-30 (S50 close — fat wrap; 4 tracks + 6-milestone dispatch app + 26+ findings)

S50 ran 2026-04-29 → 2026-04-30 (crossed midnight during dispatch app M2). Four major tracks shipped:

**Track A — Phase 2g.** Chain branches `if=`/`else-if=`/`else` mount/unmount via per-branch B1 dispatch + single chain wrapper `<div data-scrml-if-chain="N">` + per-branch mixed-cleanliness handling. Greenlit from structured 5-phase deep-dive at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` (753 lines) — surfaced 2 findings the dispatch missed (§17.1.1 line 7533 normative-by-implication; mixed-cleanliness chains the DOMINANT pattern, 5/10 audited samples). User accepted all 4 OQ suggestions on first read. T2 pipeline dispatch with worktree-isolation; first dispatch timed out at 43min/68 tool calls, resumed via fresh dispatch on the existing worktree (SendMessage tool not available in this env), completed cleanly in 10min. Merged via `b362b33`. +31 tests in new `chain-mount-emission.test.js`. No new runtime helpers (Phase 2c B1 reused verbatim). No spec amendment.

**Track B — F-RI-001 triage.** PARTIAL resolution. Triage agent found F-RI-001 was filed against an OLDER RI mental model (commit `7462ae0` S39 boundary-security had already removed callee-based escalation). Doc-comment fix in `route-inference.ts:34-47 + 1387-1394` to remove misleading "purely-transitively-escalated function is suppressed" wording. **7 regression tests** in new `route-inference-f-ri-001.test.js` (§A 3 narrow-canonical / §B 2 server-bound-still-fires / §C 2 CPS-applicable still splits). PA attempted to revert M2's workaround in `pages/dispatch/load-detail.scrml` post-merge — discovered `transition` STILL fires E-RI-002 in real-app file context when `saveAssignment` coexists. Workaround restored. **Two adjacent findings split:** F-RI-001-FOLLOW (P1, `obj.error is not` fails E-SCOPE-001 — `is not` doesn't support member-access targets); F-CPS-001 (P1, architectural — `analyzeCPSEligibility` doesn't recurse into nested control-flow while `findReactiveAssignment` does). F-RI-001 downgraded from STALE to PARTIAL.

**Track C — F-COMPONENT-001 architectural diagnosis.** Triage dispatch refused conservative fix; surfaced as architectural BLOCKED. **Cross-file component expansion does not work end-to-end** on current scrmlTS — three intersecting faults: (F1) `hasAnyComponentRefsInLogic` doesn't recurse into nested markup (wrapped patterns silently skip CE); (F2) `runCEFile` looks up `exportRegistry.get(imp.source)` by raw path string but production registries are keyed by absolute filesystem path; (F3) CLI reads `inputFiles` only, never auto-gathers files reachable through imports. **Independent confirmation:** compiled `examples/22-multifile/`, dist/app.client.js line 12 contains `document.createElement("UserBadge")` — phantom custom element. The canonical multi-file scrml example renders blank. Existing `cross-file-components.test.js` masks the bug via test-only key synthesis that bypasses production paths. **Plan B parked** per user direction: examples/22-multifile flipped to `[x][❌]` in master-list §E; kickstarter v1 multi-file section now flags cross-file components KNOWN-BROKEN; recommends import-types+helpers+inline-markup pattern; deep-dive scheduled post-S50. Diagnosis writeup at `scrml-support/archive/changes/f-component-001/diagnosis.md` (322 lines; moved from `docs/changes/f-component-001/` in S61 curation Batch D).

**Track D — Trucking dispatch app.** 6-milestone language stress test at `examples/23-trucking-dispatch/`. Domain matches user's actual operation (NE Utah, oil and gas, owner-operator). User locked: all-three slices integrated (load tendering + driver log + customer billing), 3 personas (dispatcher / driver / customer), real-time channels, 5,000+ LOC ceiling, **Option A `auth="role:X"` syntax** (deliberately surface the silent-inert friction; server-side fallback layered), customer self-register open. 6 sequential dispatches via Agent (general-purpose, opus, worktree-isolated):

- **M1** schema + auth scaffold (1,587 LOC, 5 commits) — 9 tables, login/register flow, NE Utah seed data (Basin Energy / Uintah Field / Vernal Operations etc.). 7 friction findings.
- **M2** dispatcher slice (2,199 LOC, 10 commits) — 6 pages + 8 components dir (latter unused after F-COMPONENT-001). 4 friction findings including the original (since-found-stale) F-RI-001 framing + F-COMPONENT-001 first surface.
- **M3** driver slice + HOS state machine (2,259 LOC, 7 commits) — 6 pages + `<machine name=HOSMachine for=DriverStatus>` with 8 transitions (off_duty ↔ on_duty ↔ driving + sleeper_berth cycle). 3 friction findings (F-MACHINE-001 / F-NULL-001 / F-PAREN-001).
- **M4** customer slice (1,799 LOC, 5 commits) — 6 pages + rate-quote → tendered-load flow. 2 friction findings (F-NULL-002 / F-CONSUME-001).
- **M5** real-time channels (587 LOC net, 5 commits) — 4 channels (`dispatch-board`, `driver-events`, `load-events`, `customer-events`) wired across 12 pages. 6 friction findings (F-CHANNEL-001 P0 + 5 others).
- **M6** lin tokens + README + final summary (343 LOC net, 6 commits) — acceptance + BOL + payment lin tokens with two-layer enforcement (compile-time `lin` parameter + DB UPDATE-with-NULL durable single-use guard). 2 friction findings (F-LIN-001 / F-DG-002-PREFIX).

**26+ FRICTION findings logged** at `examples/23-trucking-dispatch/FRICTION.md` — the load-bearing artifact of the entire exercise. Severity breakdown: 6 P0 / 10 P1 / 5 P2 / 1 P2 observation / 5 reconfirmations / 1 partial-resolution.

**Two user-prompted findings (high-value extras the dispatch app didn't surface autonomously):**

- **F-IDIOMATIC-001 (P2 observation)** — User asked "has any code used 'is not' 'is some'?" — grep showed **zero usage as operators across 8,200 LOC** of natural scrml writing by 4 distinct general-purpose agents. Adopters reach for `!x` truthiness, `== null`, `==` instead. SPEC §42.2 + kickstarter v1 §3 document `is not`/`is some` as canonical, but it's not landing in practice. Three plausible chilling effects: familiarity bias / F-RI-001-FOLLOW chilling effect / F-NULL-001+002 chilling effect.

- **F-COMPILE-001 (P0)** — User asked "are we actually compiling all code?" — audit revealed `scrml compile <dir>` flattens output by basename. **32 source .scrml → 17 HTML + 28 client.js + 17 server.js in dist/ = 15 silent overwrites.** Customer's `home.scrml` + `profile.scrml` + 2/3 of `load-detail.scrml` were silently overwritten by driver versions. Verified via grep on emitted JS (`driver-events` channel ref in `home.server.js` proves driver/home won; `cdl_number` SQL in `profile.server.js` proves driver/profile won). The "compile clean" verdict from M3-M5 dispatches was misleading — agents didn't audit input-count vs output-count. **The dispatch app cannot run as advertised** — adopters logging in as customer would see driver UI and bounce off role-checks.

**The systemic silent-failure meta-finding:** scrml repeatedly accepts inputs that produce silently-wrong outputs. At least 5 distinct mechanisms violate the S49 validation principle:
1. F-AUTH-001 — `auth="role:X"` silently inert
2. F-CHANNEL-001 — `<channel name="dynamic-${id}">` mangles to literal underscore
3. F-COMPONENT-001 — phantom `document.createElement("Component")` emission
4. F-COMPILE-001 — basename collision silent overwrite
5. F-RI-001 partial — file-context-dependent escalation

Belongs in a unified post-S50 deep-dive sweep, NOT 5 independent triages.

**Other sundries:**
- Authorization scope discipline maintained per pa.md — every action explicitly authorized; "go" cadence per-action, never session-scoped.
- Worktree-creation off stale main was recurring — every `isolation: "worktree"` dispatch needed an explicit rebase prelude in the brief. Cause: harness uses origin/main as branch base. Workaround stable across all dispatches this session.
- Cross-machine sync hygiene clean entering S50 (both repos 0/0 origin); push at S50 close pushes 57+ commits to origin.

### 2026-04-29 (S50 mid-session — Phase 2g: chain branches mount/unmount via per-branch B1 dispatch)

Continued from S49 close (`a70c6aa`). Two-step session: structured deep-dive at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` (753 lines) → T2 pipeline implementation. Greenlit design: **Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch.**

**Tests at Phase 2g merge:** 8,125 pass / 40 skip / 0 fail / 384 files. Net delta vs S49 close: **+31 tests, +89 expects, +1 file. No regressions.**

- **Phase 2g — chain branches mount/unmount** (merge `b362b33`). Extends Phase 2c B1 (single-`if=`) to chain branches. Each `if=`/`else-if=`/`else` branch now compiles per its cleanliness: clean branches → `<template id="..."><inner></template><!--scrml-if-marker:...-->` (per-branch B1 emission inside a single `<div data-scrml-if-chain="N">` chain wrapper); dirty branches → `<div data-scrml-chain-branch="K" style="display:none"><inner></div>` retained as fallback. New `isCleanChainBranch()` helper strips chain attrs then defers to `isCleanIfNode` so cleanliness criteria match Phase 2c B1 verbatim. Strip-precursor (`stripChainBranchAttrs`) preserved in BOTH paths. Chain controller (`emit-event-wiring.ts`) emits `_update_chain_<chainId>()` that dispatches per `branchMode: "mount" | "display"` — clean branches go through `_scrml_create_scope` + `_scrml_mount_template` / `_scrml_unmount_scope`; dirty branches toggle `style.display`. `LogicBinding` interface in `binding-registry.ts` extended with `branchMode`, `templateId?`, `markerId?`, `branchIndex` for the controller. **Honors §17.1.1 line 7533** ("only one span exists in DOM at any time") for clean branches; dirty branches retain pre-Phase-2g behavior (display-toggle inside chain wrapper). **No new runtime helpers** — Phase 2c B1 helpers reused verbatim. **No spec amendment.** New `chain-mount-emission.test.js` with 31 tests (N1-N31) covering all 4 emission shapes (all-clean / mixed / all-dirty / multi-branch) + controller wiring + initial render + branch swap + strip-precursor + reactive flip. ~5 assertion updates in `else-if.test.js` for new chain-clean shape; N31 anti-leak invariant unchanged. +1,035 / -79 across 7 files.

- **Phase 2g deep-dive** at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md`. 753 lines, 5-phase structure. Surfaced two findings the dispatch missed: (1) §17.1.1 line 7533 is normative-by-implication ("Only one span exists in the DOM at any time") and applies to chains too — today's wrapper-+-display-toggle violates this verbatim; (2) mixed-cleanliness chains are the DOMINANT pattern (5/10 audited samples), not a corner case. These findings drove the per-branch dispatch decision over whole-chain fallback. Eliminated Approach C (DOM-keep + scope-swap) on §17.1.1 amendment cost + cross-ecosystem reversal + S49 validation principle. Deep-dive carried 7 OQs, 4 of which were greenlit-block; user accepted all 4 suggestions on first read, no debate needed.

- **Routed-to-Phase-2h findings** (NOT 2g regressions, surfaced during 2g implementation): (a) **Pre-existing chain-controller condition-emission bug** for expression conditions like `if=@step == 1` — compiles to `_scrml_reactive_get("step")` instead of `(_scrml_reactive_get("step") == 1)`. Confirmed pre-existing on main (`a70c6aa`), preserved verbatim by Phase 2g. Likely TAB-stage `branch.condition.raw` not populated for `@var == literal`. (b) **6/6 deep-dive §7 allow-list samples** (recipe-book, blog-cms, quiz-app, kanban-r11, api-dashboard, gauntlet-r11-task-dashboard) fail upstream BS/TAB/TS pipeline errors — pre-existing, deep-dive §7/§8 warned. (c) 3/4 chain compilation-test fixtures pass; 4th (099) is expected E-CTRL-001 chain-break test.

- **Phase 2h scope reality check.** Originally framed as "small T1 sample-suite verification sweep." With 6/6 allow-list samples blocked on upstream errors, Phase 2h is no longer small — it's "triage 6 upstream failures + then verify chain semantics." Phase 2g is well-tested at the unit level (31 new tests covering all observable shapes); Phase 2h's value is reduced; user opted to skip 2h and pivot to the 3-5k LOC trucking dispatch app instead. Upstream sample failures remain open as a separate (lower-priority) work-item.

### 2026-04-29 (S49 — multi-track parallel fix-the-cracks; 8 tracks shipped; 4 of 5 audit items closed; all phantoms cleared)

Cross-machine pickup on machine-A continuing from S48's machine-B work. User mode: "go go go" — broad autonomy directive across all dispatched fix work. Validation principle stated mid-session and applied to all current/future feature design: *"if the compiler is happy, the program should be good."* No silent failures at compiler/runtime boundary. PA recommendations of "pass-through; runtime will reject" treated as anti-patterns going forward.

**Tests at S49 close:** 8,094 pass / 40 skip / 0 fail / 383 files. Net delta vs S48 close: **+153 pass, -2 fail (pre-existing fails resolved as side effect of compiler.* meta-checker work)**.

- **compiler.* phantom closed (Option B)** (merge `4fb5cec`). The S48 audit's #1 phantom: `compiler.*` was classified by meta-checker but never implemented by meta-eval — user code passed classification then ReferenceError'd at eval. Recon found user-code surface was the empty set (zero samples, zero examples, zero tests). Option B locked over A (implement) and C (partial impl) on asymmetric-regret + simplicity-defender grounds. Removed regex from `COMPILE_TIME_API_PATTERNS`; deleted `exprNodeContainsIdentNamed("compiler")` wire-up; mirror deletion in `compiler/self-host/meta-checker.scrml` AND `stdlib/compiler/meta-checker.scrml` (2-copy self-host surfaced during impl); added E-META-010 (reserved-namespace diagnostic); backfilled E-META-009 (nested ^{} inside compile-time meta) into §22.11 + §34. SPEC §22.4 amended; §22.8 example trimmed. **All 4 audit phantoms closed by this single mechanism** (rows 2/3/4 were "subset of phantom" — same issue; verified via separate recon). +3 net tests; -2 pre-existing fails resolved as side effect.

- **W-TAILWIND-001 warning + PA-corrective edit** (merges `c543859` + commit `2a10d04`). New `findUnsupportedTailwindShapes()` detector wired into pre-BS lint loop. `maskInterpolations()` brace-balances over `${...}` regions to avoid ternary false-positives (caught real adopter scenario in gauntlet-r10-svelte-dashboard sample). Initial detection had a contradiction in PA's brief (always-fire on shape vs skip-on-engine-match) — agent flagged + resolved shape-based; PA-corrective edit then aligned impl with intended rule. **Bonus fix:** `parseClassName` silent-strip bug closed — `weird:p-4` previously returned CSS for `.p-4` (selector mismatch with source class — silent failure violating S49 validation principle). +44 net tests across both commits.

- **Phase 2c B1 — if= mount/unmount via template + marker** (merges `c543859`-precursor + `7ce8b55`-main). After a structured 5-phase deep-dive at `scrml-support/docs/deep-dives/if-mount-unmount-implementation-strategy-2026-04-29.md` locked B1 over B4 (DOM-keep + scope-swap; eliminated on cross-ecosystem + stale-DOM event hazard + Svelte 5 PR #603 separating-unmount-from-destroy grounds) and B5 (compile-time-static + hide-on-init; parked for SSR work). Re-enabled the deferred Phase 2b emit-html block; clean-subtree if= elements compile to `<template id="...">` + `<!--scrml-if-marker:N-->` + client-JS controller calling `_scrml_create_scope` + `_scrml_mount_template`/`_scrml_unmount_scope`. SPEC §17.1 (DOM existence) + §6.7.2 (LIFO scope teardown) honored. **Precursor commit closed a latent if-chain bug** — `stripChainBranchAttrs()` strips `if=`/`else-if=`/`else` from chain branch elements before recursive emit, preventing B1 double-fire on chain branches. **Most surprising finding the recon missed:** today's display-toggle has flash-of-wrong-content bug for initial-false (no inline `display:none`) — B1 IMPROVES initial-false FCP; only "regression" is initial-true blank, industry-standard prior-art cost. **Phase 2c covers ONLY narrow path** (lowercase tag, all-static descendants); cleanliness gate rejects events/reactive-interp/lifecycle/components/bindings/transitions which fall back to display-toggle. Phase 2 verification recon found 2d/2e/2f are NON-tasks (closed by gate); 2g is real T2 work (chain branches still display-toggle, §17.1 spec divergence); 2h is small T1 sweep. +26 net tests in new `if-mount-emission.test.js`.

- **Tailwind 3 — arbitrary values + variant expansion** (merge `b18fa8e`). New §26.4 "Arbitrary Values" with §26.4.1 validation rules + §26.4.2 cross-feature interaction; new `parseArbitraryValue`/`validateArbitraryCss`/`resolveArbitraryValue`/`wrapWithVariants`/`balancedParens`/`validateUrlBody` helpers. **E-TAILWIND-001 minted** — invalid bracket content fires compile-time error (per S49 user validation principle). Validation surface: hex digit lengths, full v3+v4 unit set (32 units), color function whitelist (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color/color-mix), math function whitelist (calc/min/max/clamp/var), url() body parsing, var() identifier validation, balanced-parens. Plus 4 new theme variants (dark/print/motion-safe/motion-reduce). `parseClassName` rewritten to `{breakpoint, theme, state, base, hasUnrecognizedPrefix}` (preserving silent-strip-bug fix from W-TAILWIND-001 corrective). Cross-feature: `md:p-[1.5rem]`, `lg:hover:bg-[#ff00ff]`, `dark:bg-[var(--theme)]` all work. 64 new tests in §19/§19b/§19c/§19d. Closes audit drift item #3 (intro article SPEC-ISSUE-012 caveat) by shipping the implementation rather than amending the article. +71 net tests.

- **Tutorial Pass 2** (merges `49b623e` Subgroup A + `a29295a` Subgroup B). 14 mechanical edits per recon: new §1.8 promoting `if=` to Layer 1; new `01h-if-chains.scrml` snippet (~25 LOC); §2.5 trim; §1.1 11-element state-opener list per SPEC §4.2; glossary line 1615 fork. Observable-behavior wording for the if= mount/unmount-vs-display drift; bare-attribute `else` callout. 3 files +106/-16. Pass 3-5 (~30h) NOT STARTED.

- **lin Approach B verified — FALSE ALARM** (doc-only). Audit's "implementation status uncertain" was an inventory miss: `compiler/tests/unit/gauntlet-s25/lin-cross-block.test.js` already had 6 cross-block tests covering §35.2.2's normative surface. Audit row 124 amended 🟡 → ✅. No code change required.

- **E-META-004 numbering gap closed** (commit `c116331`). Added explicit "Reserved — do not reuse" rows to §22.11 + §34. Future codes SHOULD start at E-META-011.

- **Hook drift fix** — `.git/hooks/pre-commit` synced to in-repo canonical `scripts/git-hooks/pre-commit` (excludes browser, adds `--bail`, branch-warning). Worktree commit failures during S49 surfaced this.

- **9 recons + 1 structured deep-dive** produced. compiler.* decision recon, Phase 2c test-impact recon, Tutorial Pass 2 edit list, Phase 2c implementation-strategy deep-dive (5-phase, persisted to scrml-support), lin Approach B verification, audit phantoms (3 settled into 1 issue), Tailwind 3 scoping, Phase 2 completion status (2d-2h verification), audit ❌ rows verification (7 TRUE / 1 false-alarm row 139 / 3 settled). All in `docs/recon/` or `scrml-support/docs/deep-dives/`.

- **Audit "fix-the-cracks" 4 of 5 closed.** Item 1 (show= tutorial fix) — closed by Phase 1 in S48. Item 2 (browser-language article amendment) — DEFERRED per user "no amendments for now." Item 3 (intro article Tailwind caveat) — closed by Tailwind 3 implementation. Item 4 (compiler.* decision) — closed by Option B. Item 5 (component overloading tutorial) — DEFERRED until SPEC-ISSUE-010 closes the syntax (impl is 60-LOC scaffold, no tests, no samples).

- **Audit distribution shift** (post-amendments): 53 ✅ → **57** (+4: lin B, show=, Tailwind arbitrary, Tailwind variants); 22 🟡 → **21** (lin B promoted); 10 ❌ → **7** (-3: 2 Tailwind false alarms + custom-theme remains as v2 deferral); 4 👻 → **0** (all closed by compiler.* Option B).

- **Validation principle captured to user-voice S49 as load-bearing.** Verbatim user directive: *"the only change to everything is that im pretty sure I want comp-side validation of anything valid including css. everything else is, if the compiler is happy, the program should be good."* Cascading effects mapped across Tailwind 3 (compile-time CSS validation), Phase 2c B1 (already aligned — deterministic emission), W-TAILWIND-001 (manifestation of principle), compiler.* (explained why Option B was right). Future feature design must validate compiler-accepted inputs at compile time — no silent failures at compiler/runtime boundary.

- **24 commits on scrmlTS, 3 on scrml-support, all pushed to origin at session close.**

### 2026-04-29 (S48 — articles batch + 3 audits + Phase 1 if/show + Phase 2 foundation; cross-machine wrap)

Two-mode session that pivoted mid-stream. **First half** continued S47's voice-author work (article batch). **Pivot** triggered by user direction — *"I think we need to do a serious investigation on this language. what done, what it needs, what is prommised but not delivered"* + a request for a 3-5k LOC trucking dispatch example app to surface real friction. **Second half** turned audit findings into fix-the-cracks compiler work. Wrap was mid-Phase-2-prep due to machine switch; user *"do it fat, im switching machines, and I hate it when we're mid-progress and the next pa start screwing everything up."* All commits pushed to origin before machine switch; receiving machine pulled cleanly the following day.

**Tests at S48 close:** 7,941 pass / 40 skip / 2 fail / 381 files. Net delta vs S47: -11 tests (5 obsolete `show=` cases deleted that locked in pre-Phase-1 semantics; 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; behavior coverage net-increased despite the count drop). The 2 fails are pre-existing.

- **Articles batch — 3 published to dev.to** (Bryan MacLee 2026-04-28, commit `45913e5`): `What npm package do you actually need in scrml?`, `What scrml's LSP can do that no other LSP can, and why giti follows from the same principle`, `The server boundary disappears`. Closes the dead Further-reading links from the previously-shipped browser-language overview piece. Cross-links between the three patched in `cf81908` after publish (user must trigger dev.to re-sync OR re-paste content for the live versions to pick up the patched URLs).

- **Articles batch — 5 deep-dive drafts staged but UNPUBLISHED** (commit `a1b9bc4`). Series unpacking the shipped browser-language overview: `components-are-states`, `orm-trap`, `mutability-contracts`, `css-without-build-step`, `realtime-and-workers`. All in `docs/articles/*-devto-2026-04-29.md` + private drafts in `scrml-support/voice/articles/`. Slate item #7 (Why scrml *Feels* Faster) deferred until smart-app-splitting deep-dive's Approach A ratifies. **User-locked: "no amendments to published articles for now"** — the intro article's "Built-in Tailwind engine" overclaim and the browser-language piece's sidecar/WASM/supervisor overclaim stay live (parked, not abandoned).

- **Voice constraint added — never fabricate audience reception.** Article voice was corrected mid-session: "the end of the npm article calls scrml 'opinionated'... I really tried avoiding the rails model" → swapped to "first-principles, full-stack language." Reception-fabrication patterns ("people tell me", "I keep hearing", "most often dismissed") were also corrected. Future article work must NEVER fabricate audience reception — user has not yet had public reception. Strawman framing fine; reception-claiming is a do-not-claim violation.

- **Audit #9 — language-status audit** (`scrml-support/docs/deep-dives/language-status-audit-2026-04-29.md`). 89 features audited across 10 categories: 53 ✅ shipped / 22 🟡 partial / 10 ❌ spec-only / 4 👻 phantom. Top-5 most consequential drifts surfaced: (1) `compiler.*` is a phantom (meta-checker classifies, meta-eval doesn't implement — worst-of-both-worlds); (2) nested `<program>` sidecar (`lang=`), WASM (`mode="wasm"`), supervised restarts spec-defined with no codegen; (3) Tailwind utility engine narrower than intro article advertised (SPEC-ISSUE-012); (4) `lin` Approach B normative in §35.2.2 with type-system plumbing but no test fixture exercising cross-block discontinuous case; (5) `show=` directive taught in tutorial, not in spec, not handled by compiler — corrected by Phase 1 this session.

- **Audit #13 — scrml8 archaeology map** (`scrml-support/docs/deep-dives/scrml8-archaeology-map-2026-04-29.md`). Relevance map of `/home/bryan/projects/scrml8` (predecessor implementation). 290+ entries surveyed. **Critical finding:** all 79 scrml8 deep-dives have filename twins in scrml-support but the scrml-support copies are AMENDED — scrml8 holds the as-originally-debated pre-edit snapshot. **Single biggest non-forwarded artifact:** `/home/bryan/projects/scrml8/docs/giti-spec-v1.md` (1,386 lines) — already cited from current materials but never lifted forward in full (this is what the lsp+giti article had to source-cite "internally" for the 6 git-pain percentages). Bio extension target: 9 user-voice-bearing deep-dives in scrml8 — estimated 15-30 net-new verbatim quotes for bio §3a (npm-evil), §3c (colocation), §3d (mutability-contracts etymology), §3i (meta system). NOT YET CRAWLED.

- **Audit #8 — tutorial freshness audit** (`scrml-support/docs/deep-dives/tutorial-freshness-audit-2026-04-29.md`). 47 sections walked, 33 snippets walked. Distribution: 4 clean / 18 drift / 4 broken / 3 ghost / 11 gap / 4 superseded / 3 stale-deferral. **Crucial spec-vs-impl finding:** `if=` / `show=` is a THREE-WAY drift — tutorial said Vue-style split (mount/unmount vs visibility-toggle), spec §17.1 said `if=` removes-from-DOM, implementation did display-toggle for `if=` and inert-attribute for `show=`. Tutorial, spec, and implementation were mutually contradictory. Phase 1 resolved the `show=` half; Phase 2 in flight resolves the `if=` half.

- **Tutorial Track A (9 small fixes from freshness-audit Pass 1) shipped** (commit `9873e0e`, bundled with Phase 1). `@@user` ghost removal, `@server` non-feature note correction, `lin` deferral language update, snippet bugs, `onkeydown` event-arg correction, et al. Track B (the if/show wording realignment) is gated on Phase 2c completing the impl flip. Tutorial Pass 2-5 (ordering rewrites + missing sections + polish) NOT STARTED — ~30h estimated, deferred.

- **Phase 1 of if/show split shipped** (commit `9873e0e`). `show=` is now a real visibility-toggle directive — pre-S48 it was tutorial-taught with NO codegen support and `show=@x` compiled as a generic HTML attribute. Codegen path: `data-scrml-bind-show` placeholder + `el.style.display` toggle wrapped in `_scrml_effect`; SPEC §17.2 already had correct normative text — no spec change needed. End-to-end verified `<p show=@verbose>` → `<p data-scrml-bind-show="X">` + `el.style.display = _scrml_reactive_get("verbose") ? "" : "none"`. Test fixtures `samples/compilation-tests/control-show-{basic,expr}.scrml`. 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; `show=count` (no `@`) still produces literal HTML attribute (no regression).

- **Phase 2 foundation shipped** (commit `90f8d16`). Runtime helpers added to `compiler/src/runtime-template.js`: `_scrml_create_scope` (fresh scopeId per mount cycle, counter-based), `_scrml_find_if_marker` (TreeWalker over comment nodes), `_scrml_mount_template` (clones `<template>` content, inserts before marker), `_scrml_unmount_scope` (LIFO destroy honoring SPEC §6.7.2 four-step). LogicBinding interface extended with `isMountToggle?: boolean`, `templateId?: string`, `markerId?: string` (parallel to existing `isConditionalDisplay`, `isVisibilityToggle`). Runtime already had scope teardown infrastructure used by `<timer>`, `<poll>`, `<keyboard>` — Phase 2a just adds the mount-side helpers and the if=-specific marker scan.

- **Phase 2b emit-html integration WRITTEN + DEFERRED to Phase 2c** (commit `e62a11f`). The codegen logic exists in `emit-html.ts` but is COMMENTED OUT. Activating it simultaneously fails ~22 existing tests across `if-expression.test.js`/`allow-atvar-attrs.test.js`/`code-generator.test.js` that lock in the OLD `data-scrml-bind-if` + `el.style.display` shape. Group the test churn into a single disciplined Phase 2c commit. Verified emission shape (hand-compiled, before deferral): `<template id="...">` + `<!--scrml-if-marker:...-->` HTML; client controller wraps mount/unmount in `_scrml_effect`. To re-enable: uncomment block at marked location in `emit-html.ts`, update failing assertions, validate.

- **Trap surfaced for Phase 2c — JSDoc backticks in template-literal runtime.** `compiler/src/runtime-template.js` is a single giant template literal (`export const SCRML_RUNTIME = \`...\`;`). Backticks inside JSDoc must be escaped (`\\\`text\\\``) or the template literal closes early and the rest of the runtime parses as JS. Same trap for `<!--` strings — bun treats them as JS legacy HTML comments. Existing escapes at line 623 are the reference pattern.

- **`auth=` design-completeness deferred** per user *"I would really like to see the gap first"*. Today only `auth="required"` is recognized; `loginRedirect=` / `csrf=` / `sessionExpiry=` siblings work but are tutorial-untaught. Decision deferred until the 3-5k LOC dispatch app's role-based gating needs surface real friction.

- **User direction summary (the through-line):** Articles batch → "I want to blast some articles, Im talking a grip of them" → 5 deep-dive drafts. Pivot → "I think we need to do a serious investigation on this language" + "build a 3-5k LOC trucking dispatch example app" → audits dispatched. Pivot 2 → "lets fix, we need to make sure we fix things right" → Tutorial Track A + Phase 1. Mid Phase 2 confirmation → "we may not [need mount/unmount production-grade]. but these features exist for a reason... so if thats the case then A: scrml is not a production level language B: im missing something scrml already does to nullify the issue. so which?" → confirmed Phase 2 is the right work; foundation shipped. Through-line: adopter-friction is the priority; production-grade language is the goal; gap-driven design (auth=, mount/unmount details) over abstract redesign; honesty over over-claim in articles, spec, tutorial.

- **Cross-machine wrap.** All 8 scrmlTS commits + 2 scrml-support commits pushed to origin before machine switch. Receiving machine pulled cleanly the following day; both repos clean / 0-ahead / 0-behind. master-list and changelog (this entry) updated post-switch on the receiving machine.

### 2026-04-28 (S47 — cross-machine pickup + voice-author bio v0 → v1 + sibling-sweep + carry resolution)

Cross-machine pickup session. S46 ran on the OTHER machine as a scrml-voice-author session; S47 picked up here with a 26-commit pull on scrml-support to integrate machine-B's deliverables. No compiler changes; tests held at S46/S45 baseline.

- **Bio v0 signed off** — user *"sign off start the next bio-crawl"* cleared the bio gating clause and authorized Tier 2-3 incremental crawl in one phrase. Bio status flipped from `DRAFT — v0 initial seed` → `v1 — Tier 1 baseline SIGNED OFF`. Article mode unblocked.
- **Tier 2-3 bio increment** (`scrml-voice-author` background dispatch) — 339 → 392 lines (+53). 6 net-new verbatim quotes: 2 in §3a (NPM/Odin from `transformation-registry-design`, originally pre-archive `user-voice.md:1739/1747`), 4 in §3j (workflow-style from `hand-off-47`). 1 v0 gap closure (R13 "see how it feels" was in Tier 1 all along; v0 missed it). Zero contradictions; zero position shifts. §10 (provenance) + §11 (sibling-repo coverage gap) added. Two scrml-support commits: `1ead983` + `782551b`.
- **Sibling-repo sweep CLOSED EMPIRICALLY** — second `scrml-voice-author` dispatch with PA-enumerated file paths reached `scrml/` (3/3 read, 0 net-new — pure PA-admin) but Read-blocked at sub-agent permission level for `giti/` + `6nz/` (Bash universally denied). PA closed the gap directly via `grep -c` from PA shell across all 20 sibling-repo hand-offs: giti/ → 0 file matches → 0 quotes; 6nz/ → 1 match (`hand-off-4.md:52`) → 1 quote (`> strip shift from roll`, captured in §3h). All sibling-repo coverage gaps closed. §11 rewritten from "STILL BLOCKED" to "CLOSED EMPIRICALLY". **PA-direct empirical-closure recipe** documented as durable methodology for future sandbox-restricted scopes.
- **`design-insights-tmp-G.md` carry-over from S45 §1.9 RESOLVED via lift-then-delete** — PA-direct read showed canonical `design-insights.md` §"scrml G" preserved the headline insight (B-as-category-error, A-now-C-later, tar test, oss-transcripts, §47 stay artifact-scoped) but lossy-compressed the §"Debate-worthy follow-ups" section. 5 specific gates (3 measurement: gauntlet hot-loop wall-clock, parsing-fraction breakdown, parallel-parsing-first; 2 policy: LSP regime shift, SPEC §47 lift separability) lifted into `scrml-support/docs/debate-wave-2026-04-26-actionables.md` §"G-debate storage-model migration gates" with attribution. Temp file deleted. Zero actionable loss.
- **Cross-machine rotation gap convention** — first occurrence on record. When one machine runs a session-N that's sibling-repo-only (e.g. machine-B S46 was scrml-voice-author work, only one scrmlTS commit `b1f6a00`), the OTHER machine's `handOffs/` slot N stays empty when picking up. Sequential numbering preserved by rotating S(N-1)-close to slot (N+1). Slot 46 is permanently empty on this clone.

### 2026-04-27 (post-S45 — article-author agent shipped + first article landed in `docs/articles/`)

Side session post-S45 close. No compiler changes. Tests held at S45 baseline (7,952 / 40 / 0 / 381). New article landed at `docs/articles/why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` — dev.to-ready format (`published: false`, will flip when user uploads). Authored by the new `scrml-voice-author` agent (commissioned scrmlTS S38, built today). Agent file at `~/.claude/agents/scrml-voice-author.md` is outside this repo. Working drafts + bio + tweet drafts live in `scrml-support/voice/` (private). User direction 2026-04-27 whitelisted `scrmlTS/docs/articles/` as the agent's only writable path on the public side; everything else (compiler source, spec, root) remains hard-prohibited for the agent.

### 2026-04-27 (S45 — 4-debate wave: Bug B / G / A / C; 4 design insights; tracking doc; scrml-support push cleared)

Design-only session. User direction at session open: "defer push go to debate waves." Four
sequential debates fired with full expert rosters (5 + 5 + 5 + 4 = 19 expert dispatches);
4 design insights recorded to `scrml-support/design-insights.md` (lines 498/533/560/669).
A condensed tracking doc — `scrml-support/docs/debate-wave-2026-04-26-actionables.md` —
distills the 5 v1 commitments + 1 open user-decision + explicit non-goals from the wave.
scrml-support pushed at `d177afe` (20 files / 8,299 insertions), clearing the 2-session
push hold from S43+S44.

**No compiler changes. No test changes.** Tests at S45 close: 7952 pass / 40 skip / 0 fail
across 381 files (unchanged from S44 close).

- **Bug B debate (tier ladder).** Roster: haskell-language-pragma + rust-edition +
  lean-tactic-mode + racket-hash-lang + simplicity-defender. Final: simplicity-defender
  50.5/60 > rust-edition 49 > racket-hash-lang 45 > haskell-language-pragma 43 >
  lean-tactic-mode 41. Decision for v1: no-knob, ship `scrml fmt --upgrade-syntax` first;
  reach for `#lang` only when Superposition lands as a non-default dialect.

- **G debate (file storage model).** Roster: salsa (C-hybrid) + unison (B-pure) +
  simplicity-defender (A-pure) + nix + bazel as CAS witnesses. Final: A 52 > C 48.5 >
  B 32.5. Decision: stay on A (source-canonical); B falsified empirically by Unison's own
  `oss-transcripts` (LLM/AI-agent friction); C-with-Salsa deferred until measurement
  justifies. The G-judge stream timed out on first attempt; recovered with a condensed
  retry.

- **A debate (recoverability + comp-time-shape capture).** Roster: unison (B-pure CA-AST) +
  nix (C-layered Merkle DAG) + lean-lake (R3 hybrid `.olean`) + bazel (C-action-graph +
  toolchain transitions) + security (provenance/DDC/SLSA). Final: lean-lake 49 > unison-B
  46.5 > security-hybrid 44.5 > nix-C 43 > bazel-C 41.5. The B-vs-C dispute resolves via
  hybrid: AST-as-identity (B's win) orthogonal to hermetic-build-with-signed-provenance
  (C's win). v1 capture format = `.scrml-shape/objects/<hash>` + `manifest.toml` carrying
  `(root, compiler, target)` — designed now to carry SLSA L3 attestation later. **Open
  user-side question flagged by lean-lake-expert:** "Is R4 a real workflow or a wish?"
  Mathlib's 1.5M LOC ships entirely on R1+R3, never R4; Bazel says R4 operational at
  Google/Meta scale.

- **C debate (bridges architecture).** Roster: roc + gingerbill + security + unison.
  Final: roc 47 > gingerbill 46.5 > security 44 > unison 42.5. The 4 positions converge
  to a single composite: distribution + identity + execution + trust are 4 orthogonal
  layers. v1: BLAKE3 hash-of-tarball + URL+hash transport (no registry) + §41.6 vendored
  floor + `scrml vendor add` does NOT execute bridge code + comp-time bridge code in
  kernel-enforced capability sandbox.

- **The single highest-leverage commitment surfaced across all 4 debates:** specify the
  comp-time capability boundary in SPEC BEFORE any `^{}` / bridge / build-time feature
  ships. Cargo `build.rs` RFC#475 is stuck 7 years because they tried to retrofit. scrml
  has the structural advantage of writing the boundary now. **The window closes once the
  first popular bridge ships needing $HOME or network at compile time.**

- **scrml-support push** at `d177afe` (origin/main). 20 files / 8,299 insertions: 4 new
  design-insight entries + tracking doc + 8 deep-dives + 8 progress files +
  joint-coupling synthesis + user-voice-scrmlTS.md. Stray draft `design-insights-tmp-G.md`
  (from G-judge timeout retry) left unstaged.

- **Forged-agent harness load:** S44's YAML format fix took effect on session restart.
  All 17 forged experts + scrml-voice-author + simplicity-defender visible at S45 open.
  19 expert dispatches across the wave executed cleanly.

### 2026-04-26 (S44 — compiler-bug throughput: 3 fixes shipped + 12 debate experts forged + systemic YAML loader bug diagnosed/fixed)

High-throughput session immediately following S43. Three compiler bugs cleared from the
inbox/carry queue, all shipped to main and pushed (`8d1e07f..150c553`). Twelve debate
experts forged across three waves. Diagnosed and fixed a systemic YAML format defect in
all 18 forged-agent files (gap-0 between `</example>` and `model:` was breaking the
harness loader; fix takes effect on next session start). Superposition formalization debate
held per user direction; pillar commitment standing.

- **Bug M — `obj.field = function() {...}` mis-emits.** `08ca2f8`. Property/member
  assignment of a function expression was emitting as two statements with empty RHS,
  producing `SyntaxError: Unexpected token ';'` on JS load. Two-file fix:
  `compiler/src/ast-builder.js` `collectExpr` (keep function-expression as part of
  AssignmentExpression RHS rather than detaching as sibling stmt) +
  `compiler/src/expression-parser.ts` `AssignmentExpression` branch (thread `rawSource`
  through so function-expression child receives source context). Filed by 6nz from
  playground-six WebSocket setup. **+18 regression tests.** Anomaly noted: the same
  rawSource-threading gap exists in 5 other expression-parser branches (BinaryExpr,
  NewExpr, ArrayExpr, ObjectExpr, ConditionalExpr); function-expression children of those
  nodes will fall back to `raw=""` until that sweep lands. Probably masked in practice by
  scrml's arrow-callback convention.

- **Bug O — for-of loop variable leaks into `^{}` meta-effect frozen-scope.** `50b431e`.
  Markup-embedded `for (it of @list) { lift <li>${it}</li> }` was leaking `it` into the
  surrounding meta-effect's frozen-scope object as `it: it`, producing
  `ReferenceError: it is not defined` at module load. Single-file fix in
  `compiler/src/meta-checker.ts` `collectRuntimeVars` — skip for-loop bodies during
  module-scope walk (parallel to existing function-decl skip from Bug 6). Filed by 6nz
  from playground-six diagnostics list. **+13 regression tests** (6 unit + 7 integration).
  **Bonus discovery:** the duplicate `_scrml_meta_effect` emission in O's repro is a
  SEPARATE BS-stage bug — HTML `<!-- ... -->` comments aren't opaque to the block splitter,
  so `^{}` text inside a comment parses as a real meta block. After O's fix the phantom
  emission has clean capture (no crash); severity dropped to "phantom side-effect on
  module load." Filed as standalone intake at `scrml-support/archive/changes/fix-bs-html-comment-opacity/intake.md` (moved from `docs/changes/` in S61 curation Batch I).

- **A7 + A8 — HTML void elements leak `angleDepth` in component-def body.** `150c553`.
  Resolves both Scope C tracker findings A7 and A8 with a single fix. The original A7
  hypothesis pointed at `${@reactive}` BLOCK_REF interpolations; trace proved the
  BLOCK_REF was a red herring — the actual trigger was HTML void elements (`<input>`,
  `<br>`, `<hr>`, `<img>`, etc.) leaking `angleDepth` in `collectExpr` because the
  element-nesting tracker (added in A3 `bcd4557`) treated `<void>` opens without ever
  seeing closing tags. Depth counter went up, never came down, swallowing later
  component-def declarations into the first def's body. A8 was a side-effect of the same
  root cause: PreferencesStep's failure was the void
  `<input bind:value=@newsletter>`, not the `<select><option>` shape. Fix in
  `compiler/src/ast-builder.js`: added `HTML_VOID_ELEMENTS` const list (the standard 14)
  and updated `collectExpr` / `collectLiftExpr` / `parseLiftTag` to NOT increment
  `angleDepth` for void elements. **+15 regression tests.** `examples/05-multi-step-form`
  now compiles clean — all three components register. **A8 closure note** filed at
  `scrml-support/archive/changes/fix-component-def-select-option-children/closure-note.md` (moved from `docs/changes/` in S61 curation Batch I). **New finding
  A9 surfaced:** components inside if-chain branches are not expanded by component-expander;
  distinct downstream concern, tracker entry filed (intake pending next session).

- **Bug N — closure pending 6nz confirmation.** Two `@x = ...` reactive writes inside an
  inline function expression were producing missing-paren-on-set + assignment-to-get
  emit on `c51ad15`. On current main `82e5b0d`+ the codegen now emits cleanly with
  `node --check` passing. Likely fixed incidentally by `ed9766d`
  (arrow-object-literal-paren-loss) or `2a5f4a0` (BS string-aware brace counter). 6nz
  follow-up dropped at `2026-04-26-1530-scrmlTS-to-6nz-bugs-mo-shipped.md` requesting
  re-verification on a `82e5b0d`+ 6nz clone before closing.

- **12 debate experts forged in 3 waves (`~/.claude/agents/`):**
  - **Wave 2 (Bug B's tier-ladder set, 4 experts):** `racket-hash-lang-expert` (file-pragma
    via DSL), `haskell-language-pragma-expert` (file-pragma + project-default-baseline),
    `rust-edition-expert` (project/lockfile + migration), `lean-tactic-mode-expert`
    (block-tier extensibility).
  - **Wave 3 (Superposition set, 4 experts — all forged before Superposition was held):**
    `modal-logic-expert` (formal substrate), `quantum-PL-expert` (E hardline,
    type-primitive), `haskell-laziness-expert` (B-leaning hybrid), `erlang-hot-reload-expert`
    (runtime/distributed perspective).
  - **Wave 4 (G + C debate completers + cross-debate voice, 4 experts):**
    `salsa-incremental-compilation-expert` (G C-hybrid), `simplicity-defender`
    (cross-debate conservative voice; synthesizes Hickey + gingerBill + Armstrong + Wirth),
    `roc-expert` (C platform abstraction + URL distribution),
    `gingerbill-expert` (C distributed-hash-refs / no central registry).

- **Systemic YAML loader-bug diagnosis + fix.** All 18 forged-agent files (S43's 5 +
  scrml-voice-author + S44's 12) had `</example>` immediately followed by `model: ...`
  with no blank-line separator. The harness's YAML loader treated this as a malformed
  block scalar and silently dropped the agents — every dispatch attempt returned
  `Agent type 'X' not found`. Diagnosed by comparing agent-forge output to working agents
  (gauntlet-overseer, scrml-deep-dive). Fixed all 18 files via awk script (insert blank
  line before `^model: `). Latency: harness loaded the agent list at S44 start; fix takes
  effect on next session. **Backlog:** update agent-forge template to emit a blank line
  before `model:` so future forges aren't broken.

- **Color collisions caught + fixed:** rust-edition-expert + lean-tactic-mode-expert
  both forged with `purple` (fixed lean-tactic-mode → `teal`); modal-logic-expert +
  quantum-PL-expert both with `pink` (fixed quantum-PL → `coral`). Pre-existing yellow
  collision between security-expert + unison-expert (S43 carryover) NOT fixed this
  session.

- **Superposition formalization debate HELD.** Per user direction mid-session ("we can
  hold superposition off in the plan"), the B-vs-E formalization decision is deferred;
  the Superposition pillar commitment from S43 standing. 4-debate queue remaining for
  next session: B → G → A → C (in dependency order).

- **scrml-support push STILL HELD** — 18 untracked files (8 deep-dives + 8 progress
  files + joint synthesis + user-voice-scrmlTS.md) sustained from S43 close through
  S44 close. **Now 2 sessions held**, flagged as the immediate next-session decision
  per the cross-machine sync hygiene rule.

- **Cross-repo:** dropped 2 messages into 6nz inbox: `2026-04-26-1430-...mno-triage.md`
  (initial triage) and `2026-04-26-1530-...mo-shipped.md` (post-fix follow-up with commit
  SHAs + workaround revert points + bonus-bug intake notice + Bug N re-verification
  request).

- **Anomaly inventory at S44 close:** A9 candidate (if-chain branch expansion gap),
  rawSource-threading gap in 5 expression-parser branches, BS-html-comment opacity (intake
  filed), agent-forge template needs update, fresh-worktree dist regen requirement,
  voice-author bio bake blocked through S44 (resolves on next session start).

- **Tests:** 7906 → 7952 / 40 / 0 / 381 files. **+46 net tests across 3 fixes, 0
  regressions.** Per fix: M +18, O +13, A7+A8 +15.

### 2026-04-26 (S43 — living-compiler investigation arc: 8 deep-dives + 5 expert agents + voice-author + permission fix + cross-machine sync hygiene)

Design-heavy session. NO compiler changes. The work product is the largest single-session
deep-dive yield in project history plus the agent infrastructure to run debates from it.

- **8 deep-dives all landed**, output to `scrml-support/docs/deep-dives/*-2026-04-26.md`.
  The "living compiler" thread fired full-bore per the user's "keep pulling on every thread,
  dd and debate wherever the trail leads" methodology directive. Two dives stalled silently
  on Phase 4 single-shot writes; both recovered (C re-dispatched from progress file; H
  re-dispatched with strict per-section enforcement; Superposition recovered via PA-write
  hybrid pattern after a 3rd stall). Dive titles:
  - **A** — Recoverability + compile-time-shape capture (1,068 lines). User disambiguation:
    R4 with R1+R4 combo target. Approach A (Lockfile) eliminated by user choice; debate is
    B (Content-Addressed AST) vs C (Pipeline-Stage Merkle Tree).
  - **B** — Mid-compile config swap via `<compiler config=...>` blocks (876 lines). Of 14
    industry languages, only 3 have working block-scope mode swap. Recommendation: defer
    block-tier; floor on lockfile + per-`<program>` attr.
  - **C** — Bridge architecture (re-dispatched). 5 spec rules drafted (§X.1-§X.5):
    bridges are content units, hashes are identity, names are convenience, no global
    registry as authority, post-Stage-7 phasing constraint, deterministic at compile time.
    Approach D (Curated Registry) eliminated.
  - **E** — Meta-system capability frontier `^{}` (638 lines). Three critical findings:
    `compiler.*` is a phantom (named in SPEC, not implemented); determinism is unenforced
    (the largest spec-vs-checks gap); phasing inversion confirms `^{}` operates Stage 7-8
    only — independent agreement with B's same finding.
  - **F** — Per-dev keyword alias layer. Big surprise: scrml's SPEC already has the
    canonical+alias precedent in §14.5 (`./::`), §18.2 (`=>/->`), §18.6 (`else/_`),
    §48.11 (`fn`/`pure function`) — all with the normative line *"the compiler preference
    setting controls which form the formatter normalizes to."* The user's idea generalizes
    that single-global mechanism to per-dev. Phase 5 explicitly recommends NO debate.
  - **G** — File storage source-vs-AST-canonical. After user disambiguation #4 ("AI agents
    can figure it out. they will NOT be limiting factors of this language"), Approach B
    (Unison-flavor full AST) was re-included after initial elimination. Final framing:
    A (source-canonical + lockfile + editor-alias) vs B (Unison-flavor) vs C-hybrid
    (source-canonical + AST-cache).
  - **H** — Smart app splitting / "feel of performance" (588 lines). Centerpiece:
    `playable_surface(entry_point, N)` formalized as a closure over initially-rendered
    + reactive-dep + server-fn-reachable + auth-gated + vendor-units. Honest assessment:
    structural advantage real but narrower than framing suggests; contingent on three
    implementation gaps (reactive-graph static-resolvability, server-fn interaction-graph
    modeling, §40 auth depth).
  - **Superposition** (788 lines) — committed as an explicit language pillar after user
    disambiguation #5. 8 strong-fit constructs catalogued (auto-await, RemoteData, sum
    types, Optional, `?{}` SQL, `<request>`, `^{}` meta classification, multi-version
    coexistence). 3 NOT-fits (reactive `@vars`, lin, machines) demoted via radical-doubt
    discipline. Debate framing: B (Dedicated SPEC section) vs E (Composite: B + selective
    sigil/type-primitive).

- **Joint A+B coupling synthesis written by PA** (~150 lines) — pre-debate anchor on the
  4 coupling points (shape-capture granularity, cache-key derivation, replay correctness,
  diagnostic provenance). Collapses 6 pre-debate disambiguations to 3 real debate questions.

- **5 foundational tech-experts forged** at `~/.claude/agents/`: nix-expert, unison-expert,
  bazel-expert, lean-lake-expert, security-expert. Cover A + C + G + Superposition + parts
  of B/E debates. Specialized experts for B (racket-#lang, haskell-pragma, rust-edition,
  lean-tactic) and Superposition (modal-logic, quantum-PL, haskell-laziness, erlang-hot-reload)
  remain to forge in next wave.

- **Custom `scrml-voice-author` agent** (298 lines) at `~/.claude/agents/` — bio curator +
  article-drafter that crawls user-voice + hand-offs + deep-dives for verbatim quotes,
  maintains a structured bio at `scrml-support/voice/user-bio.md`, and drafts articles
  citing only attested positions (never fabricates expertise the bio doesn't attest).
  First article queued: *"Why programming for the browser needs a different kind of
  language"* — to draft after bio is baked.

- **Settings.json permission fix** at `~/.claude/settings.json` — added `permissions.allow`
  for `Write/Edit/Read` on `~/.claude/agents/*` paths. First wave of forges hit Write-denied;
  permission fix unblocked the workflow; remaining forges landed clean.

- **scrmlTS pa.md updates:** Added "Cross-machine sync hygiene" section (session-start
  fetch + ahead/behind, session-end push verify, machine-switch protocol, recovery
  procedure). Updated "wrap" step 3 to point at this in-repo `docs/changelog.md` (was
  briefly pointing at a now-retracted `scrml-support/CHANGELOG-scrmlTS.md`).

- **Strategic vector confirmed** across 6 independent investigations: content-over-name,
  source-canonical (now conditional after AI-friction disambiguation), deterministic-at-
  compile-time, distributed-not-centralized, phasing-constraint-respected, superposition-
  as-foundational. 6 dives converging on compatible constraints = highest-confidence
  signal radical-doubt has produced.

- **Five durable methodology directives surfaced** (captured in user-voice): radical
  doubt is a SAFETY mechanism not skepticism; track 1 (preference) bias conservative,
  track 2 (power) bias extension; AI-agent friction is NOT a language-design constraint;
  "make no mistakes" for irreversible operations; cross-machine sync hygiene codified.

- **scrml-support staleness reconciliation arc.** Discovered local clone 12 commits behind
  origin (S40-S42 cross-repo writes built on stale baseline). Forensic audit + checksums +
  /tmp backups + reflog anchor → `git reset --hard origin/main` → keepers preserved →
  master-PA inbox message dropped. Demonstrated the "make no mistakes" principle in
  practice. user-voice-archive.md (2,837 lines) brought into local tree.

- **Tests unchanged from S42 baseline:** 7,906 pass / 40 skip / 0 fail / 378 files.
  No compiler changes this session — confirmed by `bun test` at S43-close.

- **Commits this session:** 2 on scrmlTS (`82e5b0d` cross-machine sync work + S43 close
  hand-off/master-list/changelog). scrml-support push HELD — 18 untracked design files
  remain uncommitted in scrml-support pending push authorization.

---

### 2026-04-24 (S39 — boundary security + 6 bug fixes + ExprNode Phase 4d + multi-DB scoping)

Largest single-session output in project history. Boundary security deep-dive
+ 3-expert debate produced a compiler-enforced closure-capture taint model.
All 6 inbox bug reports (4 from 6nz, 2 from giti) fixed and verified. ExprNode
Phase 4d advanced through structured inline match arms + render preprocessor.
Multi-DB SQL driver support scoped via deep-dive. Suite 7,463 → 7,562
(+99 net tests), zero regressions.

- **Boundary security — closure-capture taint propagation.**
  Deep-dive identified 5 root causes: transitive escalation deliberately
  disabled in RI (correct for calls, wrong for captures), `extractReactiveDeps`
  string-only scan (Bug J), global regex name-mangling (Bug I), fail-open
  `_ensureBoundary` (NC-4), SPEC §15.11.6 violation (prop-passing not detected).
  3-expert debate: Type Tags (42/60), Crossing Points (48/60), Extended
  Interprocedural Taint (54/60 — winner). Implementation: `closureCaptures`
  map + fixed-point taint propagation in `route-inference.ts`, call-graph BFS
  for transitive reactive deps in `reactive-deps.ts`, `_ensureBoundary`
  graduated to diagnostic fail-safe with `SCRML_STRICT_BOUNDARY=1` strict mode.
  +15 tests in `boundary-security.test.js`.

- **Bug I (codegen) — name-mangling bleed through spaced member expressions.**
  Lookbehind `(?<!\.)` missed emitter's spaced `.` output (`n . lines`).
  Fix: variable-length `(?<!\.\s*)`. +7 tests.

- **Bug H (codegen) — function return-type match drops return.**
  Missing `return` before match-expression IIFEs when `function` (not `fn`)
  has `-> T` or `: T` return-type annotation. Fix: `hasReturnType` flag on
  function-decl AST nodes; `emitFnShortcutBody` applies implicit return when
  set. +5 tests.

- **Bug K (runtime) — sync-effect throw halts caller.**
  `_scrml_trigger()` dispatched effects without try/catch. A throwing derived
  expression propagated through `_scrml_reactive_set` → user function, halting
  subsequent reactive writes. Fix: try/catch per effect, consistent with
  existing subscriber pattern. +5 tests.

- **GITI-009 (codegen) — relative-import forwarding against source path.**
  Server JS emitted import paths verbatim from source `.scrml`; wrong when
  output directory differs. Fix: `rewriteRelativeImportPaths()` post-processor
  in `api.js` resolves against source dir then computes relative from output dir.
  +16 tests.

- **GITI-011 (tokenizer+codegen) — CSS at-rule handling.**
  `tokenizeCSS()` had no `@` handler. `@import`, `@media`, `@keyframes` etc.
  mangled into property declarations (`media: ;`). Fix: new `CSS_AT_RULE` token
  type with depth-tracked brace matching for block at-rules, semicolon-terminated
  for statement at-rules. AST builder stores verbatim text; `emit-css.ts`
  passthrough. +19 tests.

- **ExprNode Phase 4d — structured inline match arms.**
  Inline match arms (`. Variant => result`) now produce structured
  `match-arm-inline` AST nodes instead of raw `bare-expr` strings. Codegen
  uses pre-parsed fields (test, binding, result, resultExpr) instead of
  regex-parsing `.expr` at emit time. Also fixed two token-kind bugs in S27
  arm-boundary detection (`=>` is OPERATOR not PUNCT, `::` is OPERATOR not
  PUNCT). +19 tests.

- **ExprNode Phase 4d — render preprocessor.**
  `render name()` → `__scrml_render_name__()` in `preprocessForAcorn`,
  following the same pattern as 6 existing preprocessor rules. Produces
  proper `CallExpr` ExprNode instead of escape-hatch. Enables CE to switch
  from string regex to ExprNode structural matching, unblocking
  `bare-expr.expr` field deletion.

- **ExprNode Phase 4d — steps 1-7 merged.** ExprNode-first paths across
  `body-pre-parser.ts`, `component-expander.ts`, `type-system.ts`,
  `dependency-graph.ts`, `meta-checker.ts`. `bpp.test.js` GIT_DIR leak fix.

- **Multi-DB SQL deep-dive.** Bun.SQL template literals (SPEC §44 mandate).
  4-phase plan: (1) SQLite→Bun.SQL, (2) Postgres, (3) MySQL, (4) edge DBs.
  Per-stage change assessment with file:line references. Phase 1 code
  complete in concept; merge deferred to S40 due to branch divergence.

- **README:** giti added to Related Projects, broken 6nz relative links
  fixed to absolute GitHub URLs.

- **Maps refreshed:** 11 maps + non-compliance report regenerated.

- **master-list.md refreshed** to S39 (was ~15 sessions stale).

### 2026-04-22 (S38 — adopter-bug wave + CSRF bootstrap + SPEC §22.3 multi-`^{}`)

Eight commits, all pushed to origin/main. Four adopter bugs from the 6nz
2026-04-21 batch shipped (Bugs 1, 3, 4, 5), GITI-010 CSRF bootstrap blocker
resolved, Bug-5 mixed-case follow-on hoist, SPEC §22.3 terminal bullet
ratifying multi-top-level `^{}` source-order semantics (5-expert debate,
minimum-delta won), and a classifier bug surfaced during multi-`^{}`
testing fixed the same day. Suite 7,383 → 7,463 (+80 net tests), zero
regressions throughout.

- **Bug 1 (ast-builder) — string literal escapes double-escaped in emit.**
  8 identical `STRING`-token re-quote sites in `ast-builder.js` used
  `.replace(/\\/g, "\\\\").replace(/"/g, '\\"')` on the tokenizer's raw
  inner text. Tokenizer stores source-as-written (`"a\n b"` → 4 chars:
  `a`, `\`, `n`, `b`); the `.replace` doubled every backslash → `"a\\nb"`
  in emitted JS → parses as literal backslash+n, not LF. Every escape
  sequence affected; leaked into bug-2 and bug-6 reproducers too. Fix:
  new `reemitJsStringLiteral(rawInner)` helper interprets standard
  escapes (`\n \t \r \\ \" \' \0 \b \f \v \xHH \uHHHH \u{HHHHHH}`) then
  `JSON.stringify`s — canonical double-quoted JS literal. 11 unit tests.
  Commit `41aa7c0`.
- **Bug 3 (ast-builder) — `return X + y` dropped after `const y = A ? B : C`.**
  Root cause: `collectExpr`'s angle-bracket tracker bumped `angleDepth`
  unconditionally when `<` was followed by IDENT. In `base < limit`,
  no matching `>` appeared — `angleDepth` stayed at 1, disabling the
  `STMT_KEYWORDS` boundary check. Greedy collect ate `return base + min`
  into the expression; meriyah rejected the mashed string; downstream
  silently dropped the tail. Fix: before bumping `angleDepth`, check
  whether the previous consumed token is a clearly value-producing token
  (IDENT, AT_IDENT, NUMBER, STRING, `)`, `]`). If so, `<` is a less-than
  comparison. 11 unit tests. Commit `3778d76`.
- **Bug 5 (codegen) — pure keyed-reconcile skips outer `_scrml_effect`.**
  `emit-reactive-wiring.ts` unconditionally wrapped any reactive-deps
  lift group in `_scrml_effect`. Reactive for-lift emits already contain
  `_scrml_effect_static(renderFn)` which handles re-reconciliation on
  `@items` mutation in-place. The outer effect re-created the list
  wrapper div per mutation — 6nz observed `3 → 8 → 15` `<li>` children
  on sequential clicks. Fix: detect pure-keyed-reconcile (combinedCode
  has `_scrml_reconcile_list(` AND no other `_scrml_reactive_get(`
  outside reconcile calls, via balanced-paren `stripReconcileCalls`
  helper) and skip the outer wrap. 6 unit tests. Narrow-scope caveat:
  mixed-case (keyed reconcile + other reactive reads) still had a
  pre-existing wrapper-re-creation issue — shipped as separate follow-on
  `8691f75` the same session. Commit `b37769c`.
- **GITI-010 (codegen) — CSRF bootstrap mint-on-403 + client single-retry.**
  Baseline CSRF 403 response emitted no `Set-Cookie`, so cookie-less
  first POST returned 403 forever. User ratified Option A after A/B/C
  trade-off analysis. Three-sided fix: (1) server baseline path — 403
  now includes `Set-Cookie: scrml_csrf=${token}; Path=/; SameSite=Strict`;
  (2) middleware CSRF paths — split missing-vs-mismatched cookie (missing
  gets mint+retry, mismatched gets terminal 403); (3) client — new shared
  `_scrml_fetch_with_csrf_retry(path, method, body)` helper that retries
  exactly once on 403 re-reading `document.cookie`. Helper emission gated
  behind `hasMutatingCsrfServerFn` so SSE-only files don't emit dead
  code. Auth-middleware CSRF path deferred to its own fix. 9 unit tests.
  Commit `40e162b`.
- **Bug 4 (codegen) — named derived reactive refs get DOM wiring.**
  Two-layered root cause: (1) `collectReactiveVarNames` in `reactive-deps.ts`
  collected `reactive-decl` and `tilde-decl` but not `reactive-derived-decl`
  — `${@isInsert}` had `reactiveRefs` computed as empty, emit-event-wiring
  saw `varRefs.length === 0`, skipped the wiring block entirely (silent
  render bug). (2) Once wiring emission was restored, the rewrite emitted
  `_scrml_reactive_get("isInsert")` instead of `_scrml_derived_get(...)`
  because `emitExprField` calls in emit-event-wiring didn't pass
  `ctx.derivedNames`. Fix: (a) add `reactive-derived-decl` to the name
  collector; (b) populate `ctx.derivedNames` via `collectDerivedVarNames`
  at both CompileContext construction sites; (c) thread `derivedNames`
  through the markup-interpolation `emitExprField` calls. 8 unit tests.
  Commit `adbc30c`.
- **Mixed-case for-lift wrapper hoist (follow-on to Bug 5).** Logic blocks
  combining keyed for-lift with other reactive content stacked two bugs:
  (a) wrapper re-created per outer-effect fire; (b) conditional lift
  accumulated without `innerHTML=""` (skipped to preserve wrapper). Fix:
  detect mixed case and hoist for-lift setup OUTSIDE the outer effect
  via `hoistForLiftSetup(combinedCode)` — regex + balanced-brace
  extraction of wrapper decl, `createFn`, `renderFn`, first `renderFn()`
  call, `_scrml_effect_static(renderFn)`. Effect body retains
  `_scrml_lift(wrapper)` which re-mounts the same node (appendChild
  MOVES, wrapper's reconciled children persist). With wrapper hoisted,
  `innerHTML=""` restored at effect top — safe. Fixes both (a) and (b)
  in one pass. 11 unit tests. Commit `8691f75`.
- **SPEC §22.3 — multi-top-level `^{}` source-order normative rule.**
  Ratified by 5-expert debate (elm-architecture 34, template-haskell 45,
  zig-comptime 46, racket-phases 44, scrml-radical-doubt **53/60 — winner**).
  Minimum-delta wins: codify existing compiler behavior, **do NOT**
  introduce `^init{}`/`^mount{}`/`^teardown{}` keywords. One bullet
  appended to §22.3 Normative statements (top-level = file scope; each
  block classified independently per §22.4/§22.5; source order within
  phase; DOMContentLoaded-already-fired clause; mixed compile-time+runtime
  permitted). scrml-language-design-reviewer 2-pass review: pass 1 REVISE
  (4 issues) → pass 2 CLEAN. Two debate-curator hallucinated citations
  caught + stripped before merge (nonexistent "insight 40" and "file-
  scoped compile-time accumulator"). 6 unit tests + 1 sample. Commit
  `6609fb6`.
- **`emit.raw(...)` classifier compile-time detection (surfaced same day).**
  `^{ emit.raw("<p>...") }` was classifying as runtime meta — emitting
  `_scrml_meta_effect(...)` with body `emit.raw(...)` that would CRASH
  at runtime (per §22.5.1, `emit.raw` has no runtime counterpart). Root
  cause: `testExprNode` in `meta-checker.ts` used `exprNodeContainsCall(exprNode, "emit")`
  which only matches bare `emit(...)`; for `emit.raw(...)` the callee
  is a MemberExpr, not an IdentExpr. String-fallback regex DID catch
  it, but ExprNode path runs first and short-circuits. Fix: new
  `exprNodeContainsEmitRawCall` helper walks for CallExpr with
  MemberExpr callee matching `emit.raw`. Wired into `testExprNode`.
  7 unit tests. Commit `cfb1a14`.

Process highlights:
- Verify-before-fix applied throughout — every bug had a confirmed repro
  before any source edit.
- Write-test-always applied throughout — each fix shipped with tests.
- SPEC edit gated by 2-pass scrml-language-design-reviewer discipline
  (1 REVISE → 1 CLEAN).
- Radical-doubt debate-curator flow executed on the multi-`^{}` question.
- Two debate-agent hallucinations (invented insight + invented compiler
  concept) caught during the pre-merge review and stripped.

### 2026-04-19 → 2026-04-21 catch-up (S29–S37, consolidated)

Nine sessions' worth of commits that were never individually logged. Organized by arc rather than session-by-session for readability.

**S29 — ast-builder component-def gate (2026-04-19).** `const X = <markup>`
without explicit RHS markup was parsing as a runtime const-decl but
being treated downstream as a component. Fix at `b189051` adds markup-
RHS requirement for uppercase-name const decls. Wrap at `4823519`.

**S30 — adopter friction audit, 4 fixes (2026-04-19/20).** Four
adopter-facing polish items landed:
- `8217dd9` — `package.json` bin points to `compiler/bin/scrml.js` (executable entry fixed for users installing via npm link).
- `2eb4513` — CSS tokenizer no longer collapses element-leading compound selectors to declarations.
- `f0e7222` — CLI surfaces ghost-pattern lint diagnostics by default (W-LINT-011..015).
- `e8ddc8d` — W-LINT coverage extended to Vue and Svelte ghost patterns.
Wrap at `a6ce8c6`.

**S31 — adopter polish + fate-of-fn debate verdict (2026-04-20).**
Two adopter fixes (`ebd4d1d` F5 — bare ident referencing reactive
without `@` is now E-SCOPE-001; `26df45d` F6 init-safety + F10 README
bun link step) plus a multi-expert inline debate on whether `fn` should
be retired, merged with `pure function`, or elevated into a state-
typestate contract. Insight 21 ratified (commit `1d1c49d`): fate-of-fn
verdict leans toward `pure fn` as redundant-but-permitted, deferred the
state/machine-completeness strengthening to S32's phased implementation.
Wrap at `696b787`.

**S32 — state/machine cluster, Phases 1–3 (2026-04-20/21).** Fate-of-fn
verdict translated to incremental compiler work:
- Phase 1a/1b: E-FN-006 renamed E-STATE-COMPLETE; widened to `function`
  bodies (§54.6.1 universal scope).
- Phase 2: `pure fn` parser support + W-PURE-REDUNDANT warning.
- Phase 3a–3e: substate blocks tagged with `isSubstate` + `parentState`;
  registered with parent's `substates` set; substate match exhaustiveness
  wired; `resolveTypeExpr` falls back to `stateTypeRegistry`;
  `< Substate>` recognized as match arm pattern. Substate match is now
  end-to-end live.
- 31 normative statements from Insight 21 registered as skipped gating
  conformance tests (commit `328b6ab`) — to be un-skipped as phases
  land.
Wrap at `593f52f`.

**S33 — state Phase 4a–4g + adopter bug salvo (2026-04-21).** Phase 4
of the state cluster plus 9 adopter bugs shipped:
- Phase 4a/b: block-splitter recognizes transition-decl body + AST
  transition-decl node.
- Phase 4c: `StateType.transitions` registry hook.
- Phase 4d: `from` contextual keyword + params binding in transition
  bodies.
- Phase 4e: E-STATE-TRANSITION-ILLEGAL at call site.
- Phase 4f: E-STATE-TERMINAL-MUTATION on field writes to terminal
  substates.
- Phase 4g: fn-level purity enforcement in transition bodies (§33.6).
- 9 adopter bugs: Object.freeze comma emission (E); `event` threading
  in bare-call handlers (A); scope-aware mangling to skip property
  access (D); GITI-002 imported names in scope; declaredNames threading
  through control-flow (B + F); block-body arrows in call-arg position
  (C); GITI-005 `${serverFn()}` markup interpolation wiring; GITI-003 +
  GITI-004 server/client boundary import pruning + server-context lift;
  GITI-001 await server-fn reactive-set + skip empty-url `<request>`.
- S32 conformance tests un-skipped for the 9 Phase-4 statements now
  covered (`36eadb9`).
Wrap at `eab5251`.

**S34 — map refresh + 2 GITI lift/css adopter fixes (2026-04-21).**
Narrow session:
- `3f79d71` — GITI-008: coalesce consecutive text tokens in lift markup.
- `b8f3b51` — GITI-007: descendant combinator selector recognition.
- Project-map + master-list refresh. Wrap at `d6e8288`.

**S35 — codegen refactor C-arc (2026-04-21).** Nine-step codegen cleanup
migrating call sites from legacy `rewriteExpr` to the
`emitExprField`-with-`derivedNames` pattern. Steps 1–9 commits
`3f8d88c`, `099a30a`, `36b02ec`, `03aad3d`, `6cdcc7f`, `3c2e848`,
`03a0c56`, `9501371`, `54bcab7`. Also `fd51d70` required boundary on
`EmitLogicOpts` (B2 refactor gate — boundary is no longer optional);
`8c64a98` added per-file WinterCG fetch handler + aggregate routes.

**S36 — context-carry snapshot (2026-04-21).** No commits shipped;
interrupted mid-arc. Content rolled into S37.

**S37 — fn/pure unification + Bug G + Bug 6 + adopter external-JS doc
(2026-04-21 → 2026-04-22).** Major arcs:
- `83e6896` — Bug G parser: `fn` shorthand accepts `-> ReturnType` annotation.
- `d40afbe` — Bug G codegen: `fn` shorthand implicit-return for tail
  expressions (match, switch, bare-expr).
- `6d9b62a` — §33.3 / §48 spec consolidation: unify `fn` ≡ pure function,
  retire E-RI-001, absorb non-determinism + async into §33.3. Three
  `scrml-language-design-reviewer` passes surfaced 6 cross-section
  contradictions the first-pass eyeball missed.
- `ccae1f6` — E-RI-001 code cleanup across PIPELINE.md, route-inference.ts,
  lsp/server.js, stale test headers.
- `c7198b6` — Phase 0 item 2: adopter-facing `docs/external-js.md`
  translation table (zod→§53 is the anchor; lodash/date-fns/cm6 etc.).
- `f6fb0cc` — Bug 6: `^{}` meta-checker no longer collects function-local
  decls as module-scope (over-capture fix).
- 2 ratified debates: B1+B3 refactor DEFER (insight 23 staged) and
  NPM compat-tier Phase-0-first verdict (insight 24 staged). Radical-
  doubt explicitly overturned user bias on the compat-tier question —
  user: "Accept verdict, I'm thrilled to be wrong here."
- 6-bug triage of 6nz batch: 1, 4 confirmed HIGH; 3, 5 confirmed; 2
  dismissed (downstream effect of bug 4); 6 fixed same session.
- Wrap + pa.md rule updates at `9540518`.

### 2026-04-19 (S28 — validation elision arc + 5 adjacent fixes)

The S27-queued static-elision deep-dive shipped end-to-end across four
codegen slices plus a §51.5.2 spec amendment. Five additional gaps closed
on the warm context: §51.13 phase 7 (guarded projections), §51.14
E-REPLAY-003 (cross-machine replay), two long-standing parser bugs,
test-helper centralization, and §19 error-arm scope-push (S25-queued).
Suite 7,126 → 7,183 pass (+57 new tests). Dual-mode parity verified
(default vs. `SCRML_NO_ELIDE=1`).

- **§51.5 validation elision (4 slices + spec).** `classifyTransition` +
  `emitElidedTransition` in `emit-machines.ts` drop variant extraction,
  matched-key resolution, and the rejection throw for transitions the
  compiler can prove legal at compile time. Side-effect work — §51.11
  audit push, §51.12 timer arm/clear, §51.3.2 effect block, §51.5.2(5)
  state commit — is preserved on every elided site (spec normative).
  Coverage: Cat 2.a/2.b literal unit-variant against unguarded wildcard
  rule with no specific shadow; Cat 2.d payload constructors via
  balanced-paren scanner; Cat 2.f trivially-illegal target → compile-
  time **E-MACHINE-001** (closes §51.5.1's symmetric obligation). Slice
  4 adds `setNoElide()` / `SCRML_NO_ELIDE=1` env var for CI dual-mode
  parity. §51.5.1 illegal detection runs BEFORE the no-elide gate
  (normative obligation, not optimization). Spec §51.5.2 normative
  bullets rewritten to clarify "runtime guard" = validation work
  specifically. Commits `01f5847` `cb25aaa` `59b35a1`. Backed by
  `scrml-support/docs/deep-dives/machine-guard-static-elision-2026-04-19.md`.
- **§51.13 phase 7 — guarded projection-machine property tests.** Mirrors
  phase 2's parametrization model. Inlined projection harness takes a
  `guardResults` map keyed on rule label; generator walks each source
  variant's rules in declaration order emitting one test per guarded
  rule (truthy case) plus a terminal test (unguarded fallback or
  `undefined` when all-guarded). Same labeled-guards constraint carries
  over from phase 2. Commit `2f3f95e`.
- **§51.14 E-REPLAY-003 — cross-machine replay rejection.** §51.14.6
  non-goal lifted. Reverse map `auditTarget → machineName` via existing
  `machineRegistry` lets the compile-time validator detect when `@log`
  is the audit target of machine A and `@target` is governed by
  machine B. Synthetic-log replays (logs not declared as any machine's
  audit target) still permitted — user-managed. No audit-entry-shape
  change required. Commit `6c1dfe7`.
- **§51.3 multi-statement effect bodies.** `parseMachineRules` previously
  split rule lines on `raw.split(/[\n;]/)`, which fragmented effect
  bodies containing `;` like `.A => .B { @x = 1; @y = 2 }` into three
  broken lines (silent — first rule had unterminated brace, second was
  dropped). Replaced with depth-tracking `splitRuleLines` that respects
  `{}` / `()` / `[]` depth, strings (single/double/backtick), and
  comments (line/block). Surfaced in S27 wrap. Commit `17b8972`.
- **§14.4 single-line payload enums.** `parseEnumBody` split the variants
  section on `\n` only, so a declaration like
  `{ Pending, Success(value: number), Failed(error: string) }` collapsed
  into one "line" that the payload branch silently rejected, registering
  zero variants. Downstream symptom: any `< machine for=Result>` reference
  fired E-MACHINE-004 "Valid variants: ." (empty list). Fixed by splitting
  on `["\n", ","]` at top level — `splitTopLevel` already tracks `()`
  depth so payload field commas stay with their variant. Backfilled the
  slice-2 runtime-E2E tests deferred earlier in the session. Commit `fdb43f0`.
- **§19 error-arm handler scope-push (S25 queue).** Pre-S28 the
  `guarded-expr` case in `type-system.ts` did exhaustiveness analysis on
  `!{}` arms but never walked arm.handlerExpr through the scope checker —
  undeclared idents in handlers compiled cleanly, and the caught-error
  binding (`::X(e) -> use(e)`) was invisible. Symmetric with propagate-
  expr's binding push: enter a child scope per arm, bind `arm.binding`,
  walk the handler, pop. Commit `a15cdb6`.
- **Test-helper centralization + bare-keyword gotcha.** New
  `compiler/tests/helpers/extract-user-fns.js` replaces 8 duplicated
  `knownInternal` regexes across S27/S28 test files. Bare-word entries
  (`effect`, `lift`, `replay`, `subscribe`, etc.) gain `(?!_\d)` negative
  lookahead so a user fn named `effect` (which mangles to `_scrml_effect_5`)
  no longer gets filtered as the internal `_scrml_effect` helper. Doc
  comment in `var-counter.ts` documents the `_scrml_<safe>_<N>` mangle
  convention. Commit `5c61438`.
- **Regression tests (+64).** New `compiler/tests/unit/gauntlet-s28/`
  with 6 files: elision slice-1 (22 tests), slices 2-4 (17 tests),
  multi-stmt effect body (6), payload-enum comma-split (5), projection-
  guard phase-7 (8), error-arm scope (6). Plus 8 S27 test files refactored
  to use the shared helper, 3 S25 temporal tests retargeted (assignments
  to undeclared targets are now compile-errors), 1 S26 phase-6 test
  retargeted (unlabeled vs labeled-guarded projection), 1 S27 cross-
  machine replay test flipped to assert E-REPLAY-003.

### 2026-04-19 (S27 — §2b G free audit/replay shipped + 4 silent runtime fixes)

Single-arc session: §2b G (the audit/replay deep-dive item) shipped end-
to-end across two slices, but the real story was the four pre-existing
silent-runtime bugs that surfaced during testing. S26's auto-property-
test harness synthesized its own `{variant, data}` objects which
ironically masked the fact that the real transition guard was broken
for unit-variant enums. Suite 7,069 → 7,126 pass (+57 new tests).

- **§51.11.4 audit entry shape extension.** Audit entries gain `rule` +
  `label` fields alongside `from` / `to` / `at`. `rule` is the canonical
  wildcard-fallback-resolved table key (`"A:B"` exact, `"*:B"` wildcard
  target, etc.); `label` is the identifier from a `[label]` clause on the
  matched rule. `emitTransitionTable` bakes labels into table entries
  (`{ guard: true, label: "foo" }`); `emitTransitionGuard` computes
  `__matchedKey` alongside `__rule` via a parallel ternary fallback chain.
  Commit `224847d`.
- **§51.11 audit completeness — timer transitions + freeze.**
  `_scrml_machine_arm_timer` signature extended with a `meta` payload
  carrying `auditTarget` + `rulesJson`. Timer expiry now both pushes the
  audit entry AND re-arms downstream temporal rules so chained temporals
  (A after 1s => B, B after 1s => C) cascade automatically. Every audit
  entry is `Object.freeze`'d on both push paths (transition guard and
  timer expiry) per §51.11.4. Commit `267ed61`.
- **§51.14 replay primitive — `replay(@target, @log[, index])`.** New
  spec section (~210 lines). Function-call syntax (no new keyword);
  target is name-string via @-ref, log is reactive_get, index is any
  integer expression. Runtime helper `_scrml_replay(name, log, endIdx?)`
  bypasses transition guard, audit push, and clears pending temporal
  timers; fires subscribers + derived propagation + effects normally.
  Compile-time recognition in `emit-expr.ts` structured-call path +
  fallback `rewriteReplayCalls` pass for non-structured contexts.
  Commit `00ba7d3`.
- **§51.14 replay compile-time validation (G2 slice 2).** **E-REPLAY-001**
  (target must be machine-bound reactive) and **E-REPLAY-002** (log must
  be declared reactive) via duck-typed recursive AST walker that visits
  every `CallExpr` whose callee is `ident "replay"`. Two sub-messages
  for E-REPLAY-001 distinguish "declared but not machine-governed" from
  "undeclared in scope". Commit `2453062`.
- **§51.5 unit-variant transitions crash at runtime — fix.** Pre-S27
  `__prev.variant` extraction fell back to `"*"` for bare-string unit
  variant values, producing key `"*:*"` that missed every declared rule
  and threw E-MACHINE-001-RT. Every machine-governed unit-variant enum
  was unusable in practice. Hidden by shape tests + the S26 property-
  test harness that synthesized its own variant objects. Three real
  end-to-end tests now compile + execute the guard via SCRML_RUNTIME in
  a `Function()` sandbox. Commit `eff8188`.
- **§51.5 guarded wildcard rules fire guard + effect — fix.** `* => .X
  given (…)` was treated as unguarded at runtime because the guard /
  effect comparisons keyed on `__key` (literal `prev:next`) instead of
  the `__matchedKey` the runtime actually resolved to. One-line fix in
  each branch. Commit `abfe637`.
- **§51.5 effect-body @-refs compile through `rewriteExpr` — fix.** Effect
  bodies like `{ @trace = @trace.concat(["x"]) }` emitted literal `@`
  tokens (invalid JS) because emit-machines inserted `rule.effectBody`
  raw. Wrapped in `rewriteExpr` so effect bodies behave like any other
  bare statement. Commit `73225f7`.
- **§18 match-arm expression-only form on a single line — fix.**
  `match x { .A => 1 .B => 2 }` triggered E-TYPE-020 because
  `splitMatchArms` only split on newlines, hiding B and later arms from
  the exhaustiveness checker. Replaced with a char-level scanner that
  tracks brace/paren/bracket depth, strings, and comments, recognizing
  arm-header starts inline. Defensive `collectExpr` tightening in
  `ast-builder.js` as a second layer. Commit `5d0bdc6`.
- **Runtime-test convention established.** Several S27 tests execute
  compiled output via `SCRML_RUNTIME` in a `Function()` sandbox to catch
  silent-runtime bugs. Pattern: regex-extract user fn names from compiled
  JS, closure-capture them into a `userFns` object. New compiler features
  that claim runtime behavior should use this pattern rather than shape-
  only assertions — every pre-existing bug closed in S27 went undetected
  for months under shape-only testing.

### 2026-04-18 (S26 — §2b F: auto-generated machine property tests, phases 1-6)

§51.13 `--emit-machine-tests` shipped end-to-end across six phases in a
single session. Slogan: **machine = enforced spec**. The declared
transition table IS the oracle; generated tests confirm the compiled
machine refuses everything the table doesn't allow. Suite 7,006 → 7,069
pass (+63 new tests).

- **§51.13 phase 1 — exclusivity (property a).** Generator emits a bun:test
  suite per `< machine>` declaration: for every reachable variant V and
  every variant W in the governed enum, declared `(V → W)` pairs SHALL
  succeed and undeclared pairs SHALL throw E-MACHINE-001-RT. New
  `compiler/src/codegen/emit-machine-property-tests.ts` (425 LOC) +
  CLI flag `--emit-machine-tests` writes `<base>.machine.test.js`
  alongside the user-test `<base>.test.js`. Inlined `tryTransition`
  harness uses `globalThis._scrml_reactive_store` so tests don't bleed
  into the real reactive runtime. Commit `24089c5`.
- **Machine guard rewriteExpr fix.** `< machine>` rule guards captured raw
  scrml text but emitted unmodified, so guards referencing `@reactive`
  refs emitted invalid JS (raw `@name` token). Now run through `rewriteExpr`
  before emission. Same root cause that S27 found in effect bodies.
  Commit `b84dadf`.
- **Parser fix — typed `const @name:` decls preserve initializer.** Pre-
  S26 `const @gate: boolean = true` lost its `= true` initializer because
  the typed-const parser branched into a path that didn't capture the
  RHS. Surfaced while writing phase-1 tests that needed reactive-bound
  gate vars. Commit `19e8b29`.
- **§51.13 phase 2 — guard coverage (property c).** Each LABELED `given`
  guard SHALL receive one passing test (truthy → succeeds) and one
  failing test (falsy → E-MACHINE-001-RT). Tests parametrize the guard
  result rather than evaluating the real expression — harness takes a
  `guardResults: Map<ruleKey, boolean>` and dispatches on it. Real-
  expression evaluation deferred to a future phase that needs input
  synthesis. Unlabeled guards skip the enclosing machine entirely so
  every guard in a generated suite has a human-readable identifier.
  Commit `81d6d5c`.
- **§51.13 phase 3 — payload-bound rule support.** §51.3.2 binding-group
  rules now in scope. The harness is binding-transparent — it never
  invokes the real machine IIFE, so declared destructuring is never
  executed in generated tests. Filter relaxed accordingly. Commit `4bd9ca6`.
- **§51.13 phase 4 — wildcard rule support.** `*` as the from-variant
  matches any already-reachable variant; `*` as the to-variant expands
  the reachable set to every variant declared on the governed enum.
  Pair resolution follows the four-step fallback chain used by
  `emitTransitionGuard`: exact → `*:To` → `From:*` → `*:*`. Harness
  tracks the matched table key so `guardResults` keys on the matched
  (possibly-wildcard) rule rather than the concrete input pair. Commit
  `3156b5d`.
- **§51.13 phase 5 — temporal rule support.** §51.12 temporal rules
  contribute exclusivity + guard-coverage tests just like non-temporal
  rules — the `(.From, .To)` pair is a declared transition regardless of
  how it fires. Test titles get an `(after Nms)` annotation so temporal
  rules are visible in the suite. EXPLICITLY OUT OF SCOPE: timer lifecycle
  itself (arm/clear/reset on variant entry/exit/reentry). Verifying that
  needs a live runtime with fake-timer control; the self-contained
  harness doesn't invoke runtime code. Generated file emits a header
  comment surfacing this scope boundary so users cover timer lifecycle
  with hand-written integration tests. Commit `eecaa89`.
- **§51.13 phase 6 — projection machine support.** §51.9 derived
  machines emit through a distinct path. No transition table; reading
  `@projected` delegates through `_scrml_project_<Name>(source)`. The
  property under test is **(d) Projection correctness** — for every
  source variant V, the projection function returns the target variant
  declared by the first matching rule. Generated suite inlines a minimal
  copy of the projection function (mirroring `emitProjectionFunction`)
  and emits one test per source variant. Phase 6 covered unguarded
  projections only; guarded projections deferred to phase 7 (shipped
  S28). Commit `0af336e`.

### 2026-04-18 (S25 — §2h lin redesign cleanup + §51.12 temporals + §51.11 audit clause)

Two arcs in one session: closing the lin redesign work (Approach B —
restricted intermediate visibility) and shipping §51.12 temporal
transitions (`.From after Ns => .To`). Plus the §51.11 `audit @log`
clause that S27 would later build replay on top of. Suite 6,949 →
7,006 pass (+57 new tests).

- **§35.5 E-LIN-005 — reject let/const/lin shadowing an enclosing lin.**
  Per Approach B, intermediate visibility means a lin in an outer scope
  is visible (and consumable) by inner scopes, but cannot be SHADOWED
  by an inner declaration of the same name. New error fires for `let x`,
  `const x`, and `lin x` declarations that would shadow an enclosing
  `lin x`. Commit `6f5b90c`.
- **§35.5 push scope for while-stmt so E-LIN-005 fires in while bodies.**
  Companion fix — without scope-push, while-body declarations weren't
  checked against the enclosing lin. Commit `b6c4f5d`.
- **§51 emit effect blocks for rules without a `given` guard — fix.**
  Pre-S25 the effect-block emission filter ran over `guardRules`, which
  silently dropped effect-only rules (no guard). Now uses `effectRules`.
  Commit `3556b22`.
- **§35.1 / §35.2 wording — Approach-B restricted intermediate visibility.**
  Spec text aligned with the implemented semantics: lin variables are
  visible across all sibling and child scopes within the same `${}`
  block, but shadowing is rejected. Companion §35.2.2 ratifies cross-
  `${}` block lin via the same model. Commits `0e52306` `83101c7`.
- **§2a scope push for match-arm-block + if-stmt branches.** Match arms
  and if branches each get a fresh child scope so declarations inside
  one branch don't leak into siblings. E-SCOPE-001 now fires correctly
  for refs inside an arm body that don't resolve up the chain. Commits
  `5ab63ac` `4b1e8b2`.
- **§35.5 E-LIN-006 — reject lin consumption inside `<request>` /
  `<poll>` body.** Async lifecycle elements re-execute their body on
  every refresh cycle, which would consume the lin multiple times.
  Compile-time check + diagnostic naming the lin and the lifecycle
  element. Commit `e171e33`.
- **`docs/lin.md` how-to guide.** User-facing walkthrough of the lin
  keyword: declaration, consumption, scope visibility, shadowing rules,
  E-LIN-005/006 examples. Commit `3b8f2db`.
- **§51.3.2 machine opener migration — sentence form → attribute form.**
  `< machine OrderFlow for OrderStatus { ... } /` (sentence form)
  migrated to `< machine name=OrderFlow for=OrderStatus> ... </>`
  (attribute form). The attribute form aligns with how every other
  custom-element opener parses. The old sentence form stays parseable
  for back-compat but the canonical form is now the attribute one.
  Touched all examples, docs, and the spec. Commit `347ac02`.
- **§51.12 temporal machine transitions — `.From after Ns => .To`.** New
  rule grammar: `after Ns` (or `0.5s`, `500ms`, `3m`, `1h`) between
  `.From` and `=>`. Wildcard `from` rejected at parse time
  (E-MACHINE-021); concrete from-variant only. Each temporal rule arms
  a timer when the machine enters its from-variant; on expiry the
  timer commits the transition and re-arms downstream temporals.
  `_scrml_machine_arm_timer` / `_scrml_machine_clear_timer` runtime
  helpers. Cross-cutting interaction with §51.11 audit (S27 closed
  the audit-completeness gap for timer-fired transitions). Commit
  `7305ac1`.
- **§51.11 audit @varName clause.** New machine-body clause `audit @log`
  declares a reactive array as the destination for transition entries.
  Each successful transition appends `{from, to, at}` (extended to
  `{from, to, at, rule, label}` in S27). Foundation for S27's `replay`
  primitive. Commit `c5e41b3`.
- **Parser fix — statement boundary on `@name:`.** S22 had a known
  pre-existing BPP bug where two consecutive `@foo: SomeMachine = ...`
  reactive-decls on adjacent lines silently dropped the second one. S25
  fixed it: the boundary detector now recognizes `@<ident>:` as a
  statement start. Commit `e37a6fd`.

### 2026-04-18 (S24 — §2a E-SCOPE-001 coverage sweep + §2b/c/d/e/f/g fixes)

§2a scope-checker rolled out across the full statement / expression
surface in nine slices. Plus a clutch of small §2b–§2g fixes from a
gauntlet pass. Suite 6,889 → 6,949 pass (+60 new tests).

- **§2a E-SCOPE-001 sweep — nine slices.** Pre-S24 `E-SCOPE-001`
  (undeclared identifier in logic expression) only fired in a few
  expression contexts. S24 extended coverage to: let/const initializers
  (`9e06884`), reactive-decl initializers (`234f116`), loop-scope
  plumbing + if/return/match-subject/propagate (`e1e21a5`), lin / tilde
  / reactive-derived decls (`ec26c63`), structured assignment RHS
  (`740de7d`), throw / fail / debounced / value-lift (`a758fe1`), and
  bare-expr statements + two supporting fixes (`bb01644`). Each slice
  shares the same pattern: walk the expression's ExprNode (or string
  fallback) through `checkLogicExprIdents` against the current scope
  chain, raising E-SCOPE-001 with a context-specific suggestion.
- **§2b/d phase separation + nested `^{}` at checker-time.** Two meta-
  context fixes: (b) the phase-separation check (compile-time `^{}` vs
  runtime `^{}` content) now runs at meta-checker time instead of eval-
  time, catching the error before it'd crash the eval; (d) nested `^{}`
  in compile-time meta no longer crashes — it's flagged as a clear
  E-META error. Commit `9f2a247`.
- **§2c match subject narrowing for local let/const + function params.**
  Match expression subject narrowing previously only worked for top-
  level reactives. Extended to let/const-bound locals and function
  parameters via the same scope-chain lookup. Commit `c1d71dd`.
- **§2c/§2a meta DG fixes.** Dependency graph credits `meta.get` /
  `meta.bindings` reads as @var consumers (so the dep-graph properly
  tracks reactive dependencies through compile-time meta plumbing); lin
  consumption is now counted at `^{}` capture time rather than later.
  Commit `8711056`.
- **§2d DG credits @var refs in compound `if=(...)` attributes.** Custom-
  element `if=(@a + @b > 5)` previously credited only the leftmost @ref
  (S22 regression). Now every @ref in the parenthesized expression is
  added to the dep-graph so changes propagate correctly. Commit `e377223`.
- **§2e DG credits @var refs inside runtime `^{}` meta html-fragment
  content.** When meta html-fragment content references reactives
  (`^{ <p>${@count}</p> }`), every @ref is added to the dep-graph.
  Commit `ccfc0c0`.
- **§2f trim whitespace after variant-ref prefix in in-enum transitions.**
  `transitions { . Pending => .Processing }` (space after the dot)
  previously fired E-MACHINE-004 against a variant called `" Pending"`.
  Variant-ref normalization now trims whitespace between the prefix and
  variant name. Commit `4f72a45`.
- **§2g extension-less relative imports.** `import { x } from "./foo"`
  now resolves to `./foo.scrml` if the bare path doesn't exist. Aligns
  with TS / JS convention while keeping the explicit `.scrml` form valid.
  Commit `9da03a7`.
- **§4.11.4 / §51.3.2 spec ratification — machine cohesion.** After
  debate the team kept `given` (vs. moving guards to a separate `where`
  clause) and queued the machine-opener migration to attribute form for
  S25. Commit `d2bee47`.

### 2026-04-17 (S23 — meta-checker debt cleanup + DOM read-wiring + tutorial revamp)

Tighter session focused on closing meta-checker debt items, adding the
last piece of §51.9 derived machines (DOM read-wiring), and a tutorial
content sweep. Suite 6,875 → 6,889 pass (+14 new tests).

- **§51.9 DOM read-wiring for projected vars (`${@ui}`).** S22 slice 2
  shipped projection runtime but reading `@ui` in markup left the
  display element unwired because the dep-graph didn't know `@ui` was
  reactive. S23 synthesizes a reactive-decl-like AST node for the
  projected var during annotation so the dep-graph treats it as a
  consumer of the source @order. Reading `${@ui}` now updates correctly
  on @order writes. Closes the S22 known-blocker. Commit `5b5d636`.
- **Meta-checker fixes (4 items).** Phase separation runs at checker time
  (was eval time); nested `^{}` doesn't crash; DG credits `meta.get` /
  `meta.bindings` reads as @var consumers; lin captured by `^{}` is
  counted as consumed. Companion to S24's broader §2a coverage sweep.
  Commits `9f2a247` `8711056`.
- **Examples + tutorial refresh.** `examples/14-mario-state-machine.scrml`
  rewritten to showcase S22 §1a payload variants + §51.9 derived
  machines (the deferred S22 example update). All non-gauntlet sample
  files brought up to current idiomatic scrml. Tutorial §2.3/§2.4 updated
  to canonical syntax + new §2.10 state machines section. Commits
  `7045adf` `2ba4ccd` `e0455b6`.
- **MIT license + GitHub Pages landing.** scrmlTS went public under MIT.
  GitHub Pages landing page at `docs/landing/index.html` + SEO checklist
  in `docs/SEO-LAUNCH.md`. Custom domain CNAME set/unset cycle as the
  domain config landed. user-voice relocated out of the public repo to
  `scrml-support/user-voice-scrmlTS.md` (verbatim history split:
  pre-public archived, post-public continues in scrml-support per the
  per-repo PA scope rules). Commits `427b9ec` `46f007a` `99d9286`
  `5811ed2` `0801d98` `3e8f545`.

---

### 2026-04-17 (S22 — §51.9 slice 2: derived machines runtime + write rejection)

- **Projection function codegen.** `emit-machines.ts` now exports `emitProjectionFunction(machine)` producing `function _scrml_project_<M>(src) { ... }` that walks the projection rules top-to-bottom, dispatches on `src.variant ?? src`, and emits the destination variant as a plain string. Guarded rules emit `if (tag === X && (guard)) return Y;` so `given` clauses run at read time. Rules after an unguarded match are unreachable per §51.9.3 (unguarded terminates the alternation group).
- **Derived reactive registration.** `emitDerivedDeclaration(machine)` emits `_scrml_derived_fns["ui"] = () => _scrml_project_UI(_scrml_reactive_get("order"));` + dirty flag + downstream subscription. Reuses the existing §6.6 infrastructure: `_scrml_reactive_get("ui")` already delegates to `_scrml_derived_get` when the name is in `_scrml_derived_fns`, and writes to `@order` propagate a dirty flag via `_scrml_propagate_dirty` so DOM bindings on `@ui` re-read the projection.
- **emit-reactive-wiring.ts** routes derived machines past the transition-table emit (they have no runtime transitions to enforce) and into the new projection + declaration path. Transition tables are only emitted for non-derived machines.
- **E-MACHINE-017 write rejection** (type-system.ts `rejectWritesToDerivedVars`). Walks the AST once after `validateDerivedMachines`, flagging two kinds of writes: (a) a `reactive-decl` whose name is a projected var (someone wrote `@ui: UI = X`) and (b) a `bare-expr` starting with `@ui = X` or any compound assignment (`@ui += X`). Messages name both the source var and the machine so the user knows where to assign instead.
- **SPEC §51.9** flipped from `(parser + validator landed S22, runtime codegen pending)` to `(landed S22)`, with implementation notes on the runtime wiring added.
- **Regression tests (+10)**. Slice 2 additions to `compiler/tests/unit/gauntlet-s22/derived-machines.test.js`: projection-function shape + runtime round-trip (guarded + unguarded dispatch), derived-declaration shape + dirty-propagation end-to-end, E-MACHINE-017 on reactive-decl + `=` + `+=` + non-projected-vars-untouched, full-file compile + shadow-boolean-collapse example.
- **Known blockers (tracked for follow-up):**
  - Pre-existing BPP statement-boundary bug: two consecutive `@foo: SomeMachine = ...` reactive-decls on adjacent lines can silently drop the second one. Not new in this slice — exposed while writing the end-to-end write-rejection test. The test now sidesteps by splitting the two decls into separate `${}` blocks; a proper fix belongs in the body-pre-parser.
  - Reading `@ui` in markup (`${@ui}`) inserts a `<span data-scrml-logic>` placeholder but the reactive display wiring is not yet emitted because the dep-graph doesn't know `@ui` is reactive. Fix: synthesize a reactive-decl-like AST node for the projected var during annotation so the dep-graph treats it as a consumer of `@order`. Deferred to a follow-up slice.

### 2026-04-17 (S22 — §51.9 slice 1: derived/projection machines — parser + validator)

- **§51.9 derived machine syntax parsed.** `< machine UI for UIMode derived from @order>` — the `derived from @SourceVar` clause is now recognized by the ast-builder, captured into the machine-decl node's new `sourceVar` field, and registered as a derived machine in the type system with `{ isDerived: true, sourceVar, projectedVarName }`. The projected variable name is the machine name with its leading uppercase run lowercased (`UI` → `ui`, `OrderStatus` → `orderStatus`, `HTTPStatus` → `httpStatus`).
- **E-MACHINE-018 exhaustiveness** validated after type annotation finishes: for every derived machine, the compiler looks up the source reactive's governed enum and confirms every variant has at least one unguarded projection rule covering it. Missing variants produce one error each, naming the variant and the source enum.
- **Source-var resolution.** `E-MACHINE-004` fires when `derived from @order` names a reactive that doesn't exist or isn't machine-bound, and a second form of `E-MACHINE-004` rejects transitive projections (source is itself a derived machine — deferred to §51.9.7 future work).
- **Projection RHS still validated** against the projection enum (`E-MACHINE-004` on unknown projection variants); LHS (source variants) intentionally skipped in `parseMachineRules` since the source enum isn't known at that point.
- **SPEC §51.9.6** naming rule tightened: "named by the machine's governed TypeName" → "named by the machine name with its leading uppercase run lowercased" (matches the worked example `< machine UI ... > → @ui`).
- **Deferred to slice 2** (this commit NOT runtime-ready):
  - Runtime codegen — projection function (`_scrml_project_<M>`), `_scrml_derived_declare` wiring, dep-graph edges from derived vars to source. Reading `@ui` at runtime today will see `undefined` from the reactive store; compile-time exhaustiveness catches the design error but doesn't yet produce running code.
  - **E-MACHINE-017** on writes to the projected var — user code that writes `@ui = X` is not yet rejected. Will land with codegen.
  - Projection `given` guards at read time (rules table still records the guard expression, codegen for evaluating it at read time lives in slice 2).
- **Regression tests (+9).** `compiler/tests/unit/gauntlet-s22/derived-machines.test.js`: registration of derived machines with correct projected var naming, LHS-not-validated-as-projection-enum, RHS validated, E-MACHINE-018 on missing variants, exhaustive passes, source-var-not-bound, transitive-projection rejected, guarded-without-unguarded-sibling.

### 2026-04-17 (S22 — §1b payload binding in machine rules)

- **§51.3.2 payload bindings in machine transition rules.** The `variant-ref` grammar now accepts an optional `(binding-list)` on either side of `=>`. On the `From` side, bindings expose the pre-transition variant's payload fields as locals inside the rule's `given` guard and effect block; on the `To` side, they expose the incoming variant's payload. Positional bindings (`.Charging(n)`) resolve to declared field order at parse time; named bindings (`.Reloading(reason: r)`) name the field directly; `_` discards drop a positional slot. The resolved bindings emit as `var <local> = __prev.data.<field>;` (from) or `var <local> = __next.data.<field>;` (to) inside the keyed `if (__key === "From:To") { ... }` block — rule-local scope, no leakage to sibling rules. Parser in `type-system.ts:parseMachineRules` + helper `resolveRuleBindings`; emitter in `emit-machines.ts:emitTransitionGuard` with new `buildBindingPreludeStmts` helper exported for tests.
- **E-MACHINE-015** fires on three cases: binding against a unit variant, a named binding of a non-existent field, and more positional bindings than declared fields. Message names the variant and lists the declared fields.
- **E-MACHINE-016** fires when `|` alternation alternatives disagree on binding shape (either all alternatives bind the same names, or none bind). Detection uses a sort-stable signature of each alternative's binding group.
- **`expandAlternation` rewritten** to respect paren-balanced variant refs: the `|` splitter now tracks paren depth so `.Charging(n)` is not split at internal binding parens, and the suffix-detector (identifies where the `given`/`[`/`{` suffix starts on the RHS) scans at depth 0 rather than using a naive regex — otherwise `given (n > 0)` could be cut off mid-expression by a binding-list that happens to contain `(`.
- **Rule regex tightened.** The old `(\w+|\*)?` variant-name capture backtracked correctly for the original grammar but produced wrong captures once optional binding-groups were added (`given` would be greedily captured as a variant name). Narrowed to `([A-Z][A-Za-z0-9_]*|\*)?` — variants are PascalCase per §14.4, keywords are lowercase.
- **Regression tests (+15).** `compiler/tests/unit/gauntlet-s22/machine-payload-binding.test.js`: positional, named, `_` discard, E-MACHINE-015 (unit variant / unknown field / overflow), E-MACHINE-016 (mismatched alternation / some-bind-some-don't), wildcard `* => *` passes through unaffected, `buildBindingPreludeStmts` standalone helper, and the emitter asserts that bindings land inside the keyed block (not outside).
- **Deferred:** rewriting `examples/14-mario-state-machine.scrml` to demonstrate a payload variant. Mario's current machine-guard runtime wiring has a pre-existing gap (assignments inside function bodies don't go through `emitTransitionGuard`), and changing `MarioState` from unit-only to a payload variant would break its equality checks (`@marioState == MarioState.Small`) and string interpolations. Tracked for a later slice that fixes the wiring gap first.

### 2026-04-17 (S22 — §1a enum payload variants: construction + match destructuring)

- **Enum payload variant construction (prereq for §51.3.2 payload binding in machine rules).** Before S22, `Shape.Circle(10)` threw `TypeError: Shape.Circle is not a function` because `emitEnumVariantObjects` only emitted string entries for unit variants and short-circuited entirely when an enum had zero unit variants. Now `emit-client.ts:emitEnumVariantObjects` iterates every variant and emits a constructor function for each payload variant: `Shape.Circle(10) === { variant: "Circle", data: { r: 10 } }`. Unit variants still emit as strings (`Shape.Square === "Square"`). The tagged-object shape aligns with §19.3.2 `fail` (minus the `__scrml_error` sentinel) so one runtime dispatches both error and regular variants by inspecting `.variant`. The inline `EnumType.Variant(args) → { variant, value: (args) }` rewrite in `rewrite.ts:rewriteEnumVariantAccess` was removed — the constructor function is now the single source of truth, and the old shape (`value` vs the correct `data`) couldn't carry multi-field / named-field payloads anyway. SPEC §51.3.2 prereq text flipped from "blocked" to "landed S22". Commit `2fbc332`.
- **Match destructures tagged-object payload variants.** Before S22, `.Circle(r) => r * r` parsed the binding but the emitter dropped it; `r` was referenced undeclared in the generated JS. Multi-arg `.Rect(w, h)` wasn't parsed at all. Now `parseMatchArm` captures the raw paren contents; a new `parseBindingList` splits on commas and recognizes positional (`r`), named (`reason: r`), and `_` discard forms. `emitMatchExpr` + `emitMatchExprDecl` emit `const __tag = (v && typeof v === "object") ? v.variant : v;` when at least one arm needs tagged dispatch (unit-only and scalar matches stay on the plain `tmpVar === "X"` path). Variant arms with bindings emit `const loc = tmp.data.<field>;` — positional bindings resolve via a per-file variant-fields registry (`buildVariantFieldsRegistry(fileAST)` populates it at the top of `generateClientJs`, clears after), named bindings use the field name directly. Collisions / unknown variants produce a diagnostic comment instead of a runtime `ReferenceError`. A `splitMultiArmString` bug was also fixed — the §42 presence-arm detector was splitting `.Circle(r) =>` at the `(` because it didn't notice the paren belonged to a variant binding. Commit `d8ebfb3`.
- **Regression tests (13 new, 2 updated).** New `compiler/tests/unit/gauntlet-s22/payload-variants.test.js` (6 tests: all-payload, mixed unit/payload, single- and multi-field round-trip, `.variants` ordering, §19.3.2 `fail` alignment). New `compiler/tests/unit/gauntlet-s22/payload-variants-match.test.js` (7 tests that compile + execute the emitted client JS: positional, multi-field, named, mixed unit/payload, `_` discard, scalar, unit-only). `emit-match.test.js:45` flipped from "binding ignored" to registry-aware positional and named destructuring. Existing `enum-variants.test.js` §6–§13b and `codegen-struct-rewrite.test.js` "enum variant in chain" updated to the constructor-function model (calls are preserved by rewrite, shape is asserted via `emitEnumVariantObjects` eval).
- **Known limitation, deferred.** Short-form `.Circle(10)` in a typed-annotation context `let s:Shape = .Circle(10)` still lowers to `"Circle"(10)` by the standalone-dot pass (a type-inference concern, not codegen). Fully qualified `Shape.Circle(10)` works. Live repro remaining at `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-payload-positional-031.scrml` — match destructures correctly now, only the construction line is still broken.

### 2026-04-17 (S21 — §19 codegen, §21 imports, §51 alternation, README/tutorial polish)

- **§51 `|` alternation in machine transition rules.** Grammar extended: `machine-rule ::= variant-ref-list '=>' variant-ref-list guard? effect?`, where `variant-ref-list ::= variant-ref ('|' variant-ref)*`. Both sides of `=>` may list variants; the rule desugars to the cross-product of single-pair rules before the type checker (`expandAlternation` at `type-system.ts:1902`). Any guard or effect block attaches to every expansion. Duplicate `(from, to)` pairs — within a line or across lines — emit new **E-MACHINE-014**. Mario example collapses from 8 lines to 3. Commit `eef7b5e`.
- **§19 error handling codegen rewrite.** `fail E.V(x)` now parses and emits a tagged return object inside nested bodies (if/for/function); `?` propagation works in nested bodies; `!{}` inline catch checks `result.__scrml_error` and matches on `.variant` rather than using try/catch (per §19.3.2 "fail does not throw"). E-ERROR-001 (fail in non-failable function) now fires — was unreachable before because `fail` never parsed inside function bodies. Parser also accepts canonical `.` separator alongside `::` alias. `ast-builder.js` parseFailStmt + parseOneStatement dispatch; `emit-logic.ts` guarded-expr rewrite. Commit `37049be`.
- **E-IMPORT-006 on missing relative imports.** Module resolver previously resolved the absolute path but never checked `existsSync`, so `import { x } from "./missing.scrml"` compiled clean. `buildImportGraph` now flags E-IMPORT-006 when the target is not a `.js` specifier, not in the compile set, and absent on disk; synthetic test-path importers are skipped so self-host / resolver unit tests stay green. Commit `86b5553`.
- **README "Why scrml" rewrites.** "State is first-class" redefined from "@var reactivity" to "state is named, typed, instantiable" per the S10/S11 memory. "Mutability contracts" rescoped from a machine-only paragraph to an opt-in three-layer story: value predicates (§53) + presence lifecycle (`not`/`is some`/`lin`) + machine transitions. Features-section bullet that still held the `server @var`/`protect` grab-bag renamed to "Server/client state." Commits `d802707` and the preceding §51 commit.
- **Tutorial v2 promoted.** `docs/tutorial.md` now contains the former v2 content (v1 deleted). Snippets renamed `docs/tutorialV2-snippets/` → `docs/tutorial-snippets/`. Commit `41e4401`.
- **Regression tests (3 new files, 22 tests).** `compiler/tests/unit/gauntlet-s20/error-handling-codegen.test.js` (11), `.../import-resolution.test.js` (3), `.../machine-or-alternation.test.js` (8). Updated `emit-logic-s19-error-handling.test.js` (14 tests) to the new return-value model.

### 2026-04-16 (S20 — gauntlet phases 5-12)

Executed gauntlet phases 5-12 against SPEC.md: meta, SQL, error/test, styles, validation/encoding, channels, integration apps, error UX. Fixed 5 compiler bugs, documented 11 more for batch treatment.

- **Bugs fixed (5).** `reflect(@var)` misclassified (now runtime per §22.4.2); E-META-008 now fires for `reflect()` outside `^{}`; E-META-006 now catches `lift <tag>` inside `^{}`; no spurious E-META-001/005 alongside E-META-003 on unknown types in `reflect()`; E-FN-003 now catches `@var = …` / `@var += …` inside `fn` bodies.
- **Bugs documented for future batch.** `fail` compiles to bare `fail;` (fixed in S21); E-ERROR-001 not enforced (fixed in S21); `?` emits as literal `?;` (fixed in S21); `!{}` try/catch vs `fail` return mismatch (fixed in S21); `lin + ^{}` capture not counted as consumption; phase separation detected at eval-time; DG false-positive for `@var` via `meta.get()`/`meta.bindings`; nested `^{}` in compile-time meta crashes eval; E-SCOPE-001 doesn't fire for undeclared variables in logic blocks; **E-IMPORT-006** for missing modules (fixed in S21).
- **Test artifacts.** 80 fixture files under `samples/compilation-tests/gauntlet-s20-{channels,error-test,error-ux,meta,sql,styles,validation}/` and 16 regression tests under `compiler/tests/unit/gauntlet-s20/`. End-of-S20 baseline: 6,802 pass / 10 skip / 2 fail.

### 2026-04-14–15 (S19 — gauntlet phases 1-4)

Language gauntlet across declarations, control-flow, operators, and markup. Multiple bug fixes + fixture additions across commits `8e95226` (error-system §19 compliance), `dd25311` (reject JS-reflex keywords), `cf426a1` (animationFrame + `ref=`), `36a99bd` (loops/labels/assignment-in-condition), `a9ab734` (`_` wildcard alias + E-LOOP-003 disable), `cee9fc1` (markup fixture corpus). Full Phase 2 triage documented under `docs/changes/gauntlet-s19/` (pending archival to scrml-support/archive).

### 2026-04-14 (S18 — public-launch pivot)

- **README SQL-batching expansion.** Five new Server/Client bullets (Tier 2 N+1 rewrite, Tier 1 envelope, mount coalescing, `.nobatch()` opt-out, batch diagnostics) plus a sharper "Why scrml" paragraph (adds `D-BATCH-001` near-miss + `.nobatch()` escape hatch) plus `?{}` row in the Language Contexts table noting auto-batching. Commit `d20ffa4`.
- **Lift Approach C Phase 2c-lite — drop dead BS+TAB re-parse block.** The inline re-parse fork inside `emitLiftExpr` (~50 LOC) that normalized tokenizer-spaced markup and rebuilt a MarkupNode via `splitBlocks` + `buildAST` was confirmed dead by S14 instrumentation (0 hits across 14 examples + 275 samples + compilation-tests). Deleted. Commit `f5d78df`. Full Phase 2 deferred (helpers still reached via `emitConsolidatedLift` for fragmented bodies).
- **Bug fix: `export type X:enum = {...}` misparsed.** `ast-builder.js` `collectExpr` treated `:` + IDENT + `=` as a new assignment-statement boundary, breaking the decl because `enum`/`struct` tokenize as IDENT (not KEYWORD). The leftover `enum = {...}` was reparsed as a standalone let-decl, firing `E-MU-001` on `enum`. Fix: added `:` to the lastPart skip-list alongside `.` and `=`. Commit `b123ed1`. **Affects any user writing an exported named-kind type — high public impact.**
- **Bug fix: reactive-for `innerHTML = ""` destroys keyed reconcile wrapper.** `emit-reactive-wiring.ts` unconditionally emitted the clear inside `_scrml_effect`, so every re-run destroyed the `_scrml_reconcile_list(` wrapper before the diff could run. Fix: skip the clear when `combinedCode` contains `_scrml_reconcile_list(` (mirrors the existing single-if branch guard). Commit `b123ed1`.
- **Test fixture: `if-as-expr` write-only-let.** Not a compiler bug — MustUse correctly flagged `let x = 0; if (true) { x = 1 }` (no read of `x`). Test intent was if-stmt codegen, not MustUse semantics — fixture updated to `log(x)` after the if-stmt. Commit `b123ed1`.
- **8 TodoMVC happy-dom tests skipped with notes.** The harness wraps the runtime in an IIFE, scoping `let _scrml_lift_target = null;` to that IIFE; client-JS IIFE can't see it, throws `ReferenceError: _scrml_lift_target is not defined`. Real browsers share global lexical env between classic `<script>` tags — works there. Puppeteer e2e (`examples/test-examples.js`) covers 14/14 examples. Tests marked `test.skip` with top-of-file annotation documenting root cause and unskip condition. Commit `b123ed1`.
- **S19 gauntlet plan queued.** Full 12-phase language gauntlet plan (decls, control-flow, operators, markup, meta, SQL, error/test, styles, validation/encoding, channels, integration apps, error UX) left at `handOffs/incoming/2026-04-14-2330-scrmlTS-to-next-pa-language-gauntlet-plan.md`. 31 agents identified from `~/.claude/agentStore/` with wave-staging recommendation.

### 2026-04-14 (S17)

- **SQL batching Slice 6 — §8.11 mount-hydration coalescing.** When ≥2 `server @var` declarations on a page have callable initializers (loader functions), the compiler emits one synthetic `POST /__mountHydrate` route whose handler runs every loader via `Promise.all` and returns a keyed JSON object. The client replaces per-var `(async () => { ... })()` IIFEs with one unified fetch that demuxes results via `_scrml_reactive_set`. Non-callable placeholders (literal inits, `W-AUTH-001`) are excluded; writes stay 1:1 per §8.11.3. Route export follows the existing `_scrml_route_*` convention. Tier 1 coalescing (§8.9) applies automatically inside the synthetic handler because loaders are sibling DGNodes.
- **SQL batching Slice 5b remainder — §8.10.7 guards.** `E-PROTECT-003` fires when a Tier 2 hoist's `SELECT` column list overlaps any `protect`-annotated column on the target table — the hoist is refused and CG falls back to the unrewritten for-loop. `SELECT *` expands to every protected column on the table. New exported `verifyPostRewriteLift` runs after Stage 7.5 and emits `E-LIFT-001` if any hoist's `sqlTemplate` contains a `lift(` call (defensive — §8.10.1 construction makes this unreachable today, but the pass is the spec's required re-check gate).
- **SQL batching microbenchmark.** New `benchmarks/sql-batching/bench.js` measures the exact JS shapes the compiler emits before/after the batching passes on on-disk WAL `bun:sqlite` (synchronous=NORMAL). Results in `benchmarks/sql-batching/RESULTS.md`. Headline: Tier 2 loop-hoist speedup is **1.91× at N=10, 2.60× at N=100, 3.10× at N=500, 4.00× at N=1000**. Tier 1 shows ~5% on read-only handlers — the envelope's real value is snapshot consistency and contention amplification under concurrent writers.
- **README promotion.** "Why scrml" now states "the compiler eliminates N+1 automatically" with a link to the measured results.

### 2026-04-14 (S16)

- **SQL batching Tier 1 + Tier 2 end-to-end** — spec §8.9 / §8.10 / §8.11 + PIPELINE Stage 7.5 + CG emission all landed (11 commits on `main`).
  - **Tier 1 per-handler coalescing (§8.9)**: independent `?{}` queries in a single `!` server handler execute under an implicit `BEGIN DEFERRED..COMMIT` envelope with catch-`ROLLBACK`. One prepare/lock cycle instead of N. `.nobatch()` chain method opts out of any site. `E-BATCH-001` fires on composition with explicit `transaction { }`; `W-BATCH-001` warns when `?{BEGIN}` literals suppress the envelope.
  - **Tier 2 N+1 loop hoisting (§8.10)**: `for (let x of xs) { let row = ?{... WHERE col = ${x.field}}.get() }` rewrites to one `WHERE IN (...)` pre-fetch + `Map<key, Row>` + per-iteration `.get(x.id) ?? null`. `.all()` groups into `Map<key, Row[]>`. Positional `?N` placeholders preserve parameter safety. `D-BATCH-001` informational diagnostic on near-miss shapes (`.run()`, tuple WHERE, multiple SQL sites, no match). `E-BATCH-002` runtime guard on `SQLITE_MAX_VARIABLE_NUMBER` overflow.
  - **CLI**: `scrml compile --emit-batch-plan` prints the Stage 7.5 BatchPlan as JSON.
- **`.first()` → `.get()` reconciliation (§8.3)** — 17 occurrences renamed in SPEC. `.get()` matches bun:sqlite convention; `.first()` dropped.
- **README refinements** — new "Free HTML Validation" subsection explains predicate → HTML attr derivation; "Variable Renaming" rewritten with real §47 encoding (`_s7km3f2x00`) + tree-shakeable decode table story.

### 2026-04-14 (S14)

- **Match-as-expression (§18.3)** — `const x = match expr { .A => v else => d }` now works end-to-end. Follows the same pattern as `if`/`for` as expressions.
- **`:>` match arm arrow** — codegen support complete. Both `=>` and `:>` are canonical; `->` retained as a legacy alias. `:>` avoids overloading JS arrow-function syntax and reads as "narrows to."
- **`</>` closer propagation** — the 2026-04-09 spec amendment (bare `/` → `</>`) was incompletely applied; the AST builder still accepted bare `/` as a tag closer. Now uniformly enforced across parser, codegen, and all 11 affected sample files.
- **Lift Approach C Phase 1** — `parseLiftTag` produces structured markup AST nodes directly during parsing. Previously 0% of real inline lift markup went through the structured path; now it's 100%. The fragile markup re-parse path is dead in production (retained only for legacy test fixtures pending Phase 3).
- **Phase 4d (ExprNode-first migration)** — all compiler consumers now read structured `ExprNode` fields first, with string-expression fields deprecated across 20+ AST interfaces. Expression handling is now AST-driven end-to-end.

---

## In Flight

- **Phase 3 — Legacy test fixture migration.** ~21 fixtures still use the old `{kind: "expr", expr: "..."}` shape. Rewriting them unlocks deletion of ~250–300 LOC of dead string-parsing fallback code in `emit-lift.js`.
- **Lin Approach B (discontinuous scoping).** Design complete, spec amendments drafted. Multi-session work to land an enriched `lin` model beyond Rust-style exact-once consumption.
- **SPEC sync.** Formalizing the `:>` match arm, match-as-expression, and Lift Approach C changes in `compiler/SPEC.md`.

---

## Queued

- **Phase 2 reactive effects** — two-level effect separation for `if`/`lift`. Design settled; will land when a concrete example drives the need.
- **SQL batching (compiler-level).** Two wins on the table:
  - *Per-request coalescing* — independent `?{}` queries in one server function get emitted together, one prepare/lock cycle instead of N.
  - *N+1 loop hoisting* — detect `for (let x of xs) { ?{...WHERE id=${x.id}}.get() }` and rewrite to a single `WHERE id IN (...)` fetched once before the loop. This is only tractable because the compiler owns both the query context and the loop context.
  - Cross-call DataLoader-style batching is parked until beta.
- **Remaining 14 test failures** — triaged, pre-existing, none block beta.
