# Known gaps — spec-vs-implementation drift

> **Honest current state.** The README describes the nominal language at the time of any version release ("does not describe what the compiler is perfectly capable of doing"). This document is the running ledger of the largest places where the compiler does NOT yet match the nominal spec. Entries are added as gaps surface (e.g., during dogfood passes, adopter bug reports, audit passes), and removed when the gap closes via a landed implementation arc.
>
> **Severity legend:** HIGH = adopter-visible breakage on a documented pillar feature or silent-wrong-output class. MED = silent acceptance + missing safety guarantees, or working-but-incomplete surface. LOW = ergonomic / cosmetic drift.
>
> **Per-gap status:** `spec'd` = SPEC normative + compiler does nothing · `partial-impl` = some sub-units shipped, others pending · `scoping` = SCOPING.md authored, OQs open · `in-impl` = implementation arc actively in flight · `deferred` = ratified to defer pending a precondition · `blocked` = waiting on something else · `nominal` = SPEC-only Nominal section (deliberately spec-ahead-of-implementation per author)
>
> Updated 2026-05-28 (S139 — **Bug 51-A + 51-B (Shape 2 + render-by-tag end-to-end) RESOLVED `5640148e`** — 2 of 3 sub-bugs closed: (A) CE drops `_scope` from new FileAST → silently skips render-by-tag for EVERY adopter use-site → fix re-attaches `_scope` via `defineProperty` post-CE; (B) Shape 2 empty-string init produces `_scrml_reactive_set("name", )` empty-arg emit → fix treats empty as missing-init sentinel → `null`. Sub-bug C (auto-lift drops markup RHS at BS-layer) still open with `${...}`-wrap workaround documented; corpus-coverage gap closed via new end-to-end test +6 tests. PRIOR S139 — **Bug 56 (CPS scheduler — TDZ + non-decl-in-Promise.all) NEW + RESOLVED `3450f984`** — TWO distinct CPS planner bugs surfaced during the dashboard restructure investigation; both produced `node --check`-clean emit but runtime-broken semantics. (A) The scheduler computed inter-statement dependency sets from ONLY module-level `awaits` edges; local-scope `reads` deps were invisible. Reproducer: `const x = serverFn(); @y = x.field;` emitted as `await Promise.all([serverFn(), _scrml_reactive_set("y", x.field)])` — `x.field` evaluated before the destructure bound `x` (TDZ at runtime). Fix: fold in body-DG edges (reads/writes/awaits/invalidates) per SPEC §19.9.9.1. (B) The scheduler shoved non-decl statements' whole emit strings (e.g. `_scrml_reactive_set("a", asyncFn())`) into Promise.all entries — the async call evaluated sync, passing a Promise to `_scrml_reactive_set` (cell ended up holding a Promise object). Fix: restrict multi-stmt Promise.all groups to let-decl / const-decl shapes only; non-decl statements always emit sequentially. The original `dashboard/app.scrml` was empirically broken at runtime today (both bugs fire on `refresh()`); the dashboard was source-refactored to use the const-decl pattern + factored a pure `statusesFrom` helper to avoid the cross-fn re-fetch race (which remains in Bug 9 L3 territory — body-DG can't see filesystem deps). 5-test regression suite + 0 fail across 15,063 pre-commit tests. PRIOR S139 — **Bug 11 (6nz-V) `class:NAME` on for-lift RESOLVED `f8a1f2ff`** — long-standing HIGH; runtime fix in `compiler/src/runtime-template.js` `_scrml_effect` + `_scrml_effect_static` un-pause tracking around inner `fn()` so per-item effects registered during `_scrml_reconcile_list` (which sets `_scrml_tracking_paused=true` to suppress Proxy `item.id` reads) properly subscribe to their own deps; CLASS-LEVEL fix — covers class:/style:/attribute-interp/textContent inside any reused list item; +252L NEW regression test (9 tests across 3 §-sections); PA-verified R26 empirical PASS on 6nz's exact reproducer (`2026-05-24-0641-bug-v-class-binding-on-for-lift-not-reactive.scrml` advances `alpha → bravo → charlie → alpha` post-fix); per S138 R26 doctrine forward direction. **HIGH count 1 → 0.** PRIOR S138 — **R24-BUG-4 `<match>` + `<each>` `</>` generic closer RESOLVED `adc0a70f`** — CLASS-LEVEL fix; block-splitter.js generic tag-stack scanner replaces same-kind depth-tracker; +479/-58L block-splitter.js + 583L NEW test file with 23 tests; PA-verified R26 dev-3-svelte clean (E-CTX-001 + E-CTX-003 ZERO); minimal match/each reproducers compile clean. SURFACED 2 NEW HIGH downstream Phase-3 codegen gaps Bug 52 (`<match on=.BareVariant>` no bare-variant lowering) + Bug 53 (`<match>` `:`-shorthand arm body emits raw markup as textContent) — both previously MASKED by BS-level closer rejection; filed as separate codegen-side dispatches. **Bug 50 NOT-REPRODUCED S138 `3a482076`** — empirical R26 reverse-direction application; symptom didn't reproduce on any of 4 R25 devs at current HEAD + bug report's described reproducer didn't match dev-1's actual source; PA misobservation at S137 (stale-dist read or attribute-name confusion). **Bug 51 NEW MED** — Shape 2 decl auto-lift in `<program>` default-logic mode drops render-spec metadata (surfaced by v0.6.2 cut README compile-gate). **v0.6.2 cut LIVE** at `1270994e` + `0a02e0d7` (tag pushed origin). **R26 doctrine extended to bidirectional** — pa.md S138 addendum updated (forward = verify before claim-CLOSED; reverse = verify before claim-OPEN/dispatching fix; ghost-bug shapes documented). Net HIGH count 3 → 4 (R24-BUG-4 RESOLVED -1; Bug 52 + 53 NEW +2 = net +1); net MED count 8 → 7 (Bug 50 NOT-REPRODUCED -1; Bug 51 NEW already counted). PRIOR S137 — **R25 MED Bug 42 RESOLVED `480aded4`** — 3 coupled root causes upstream of brief hypothesis: ast-builder `BARE_DECL_RE` missed `function*`/`fn*` + synthetic-logic-block child-population class-level gap (covers `${`/`?{`/`!{`/`#{`/`~{`/`^{` at `<program>`/`<page>`/`<channel>` direct-child position; closes a class wider than Bug 42 alone) + yield-stmt parse/emit + while/do-while boundary threading. +12 tests; PA-verified R26 empirical clean on dev-1+dev-2+dev-4 (0 E-CG-006 / 8+9+10 _scrml_sql calls / all node --check CLEAN). First MED bug subject to S138 R26 doctrine; both agent + PA ran R26 independently. Net MED count 13 → 12. PRIOR S137 — **R25 HIGH cluster CLOSED end-to-end + EMPIRICALLY VERIFIED** via R26 doctrine. **Bug 49** BS-level stmt-boundary `!{...}` content drop RESOLVED `076d53e5` (NEW dispatch closes the BS-layer gap R26 surfaced; tokenizer.ts `tryEmitSyntheticErrorEffectBlock` helper; closes both bare-call + const-binding shapes — Bug 38 RESOLVED was structurally correct at codegen scope but Bug 49 was the empirical closer; +12 tests; PA-verified empirical clean across all 4 R25 devs). **Bug 38** `!{}` arm-body codegen broader case RESOLVED `933d1ad3` (codegen scope correct); **Bug 41** `<schema>` HTML body-text leak RESOLVED `ebeba766` (R26 CLEAN dev-2); **Bug 40** `:`-shorthand inside `<each>` RESOLVED `50d38095` (R26 CLEAN; all 4 devs all factories populated 7+6+6+5); **Bug 37** `<each in=@x.filter(c=>...)>` arrow truncation RESOLVED `1ce963d0` (R26 CLEAN; node --check on all 4). Also S137: within-node allowlist rebump `050e20e8` (absorbed S136 parser-shape drift). Net HIGH count 7 → 3 (only compiler-managed-async + 6nz-V class:NAME + R24-BUG-4 `<match>` `</>` Phase 5 remain). **R26 methodology doctrine ratified S137:** unit-test regression suites that synthesize AST and run codegen MISS upstream BS-level bugs. EMPIRICAL R26 verification (re-compile real .scrml source on baseline) is MANDATORY for any HIGH bug close. Canary-metric-class lesson (S124 `feedback_canary_metric_class_lesson.md`) in compiler-fix shape: regression-tests-passing ≠ empirical-reproducer-passing. Bug 49 brief embedded the doctrine as mandatory Phase 3; agent + PA both ran the R26 verification before claiming close. CANON-CLEAR HEALTH: RED→YELLOW→GREEN over the session (all 4 R25 HIGH cluster bugs + Bug 49 empirically verified clean). Methodology lesson banked TWICE this session: brief-hypothesis-vs-grep — R25-Bug-38 hypothesis correct, R25-Bug-41 hypothesis over-broad (narrowed to 2 of 9 structural elements), R25-Bug-40 hypothesis upstream of actual root (BS, not codegen), R25-Bug-37 hypothesis downstream of actual root (ast-builder, not BS). Grep + AST-trace consistently beat brief speculation. Same-shape latent sibling-finder bug class surfaced by Bug 37 agent (D37a/b — `_findMatchOpenerEnd` x2 + `_findOpenerEnd`) filed as Bug 48 LOW. PRIOR S136 — R25-Bug-36 RESOLVED `e1269844` + Bug 39 RESOLVED-AS-SIDE-EFFECT + Bug 38 root-cause CONFIRMED-DISTINCT from Bug 36 via agent's dispatch investigation. Bug 36 was actually a `! ErrorType` bare-form (SPEC §41.14) parse-gap, NOT `?{}`-related as PA brief hypothesized — SQL correlation was incidental (all R25-affected functions just contained SQL). Brief-hypothesis-correction banked. Pending followups: SPEC §19.4.1 grammar amendment for bare-form ratification; new deferred-item triage for `?{}` non-lowering at default-logic top-level (may overlap Bug 42 OR be separate).

---

## §0 At-a-glance — open-gap inventory (counts)

| Severity | Open | Closed-this-arc | Notes |
|---|---|---|---|
| HIGH | 0 | **🎯 R28 FIX-WAVE COMPLETE S143 — 6 HIGH + the long-deferred Bug 54 ALL CLOSED + PA R26-verified: R28-1 `@.`-leak gate-fire `e6fb2f3d` · R28-2 tableFor row-access = Bug 54 un-deferred+CLOSED `0dbef110` · R28-3 `:`-shorthand-engine BS `051ce984` · R28-6 variant-progression `transition()` `0ecfab98` · R28-7 schemaFor/tableFor `T | not` nullable mapping `4144dc30` (SPEC §41.15.8a/§41.16.6a) · R28-1b block-form `<match>` per-item-in-`<each>` `1d227a74` (happy-dom verified). Canon-fix R28-C1 (`server fn`→`server function`) LANDED. HIGH back to 0. Newly surfaced (MED, needs-confirm): R28-1c (`<each>` same-key per-item-reactivity gap) + R28-1d (bare-`<program>` default-logic drops `<each>`). See §R28.** · **S140 (Bug-51-class corpus audit) — Bug 57 RESOLVED `e4859a5f` (each reconcile chunk-gate) · Bug 58 RESOLVED `29c33a6c` (formFor validity-surface routing) · Bug 59 RESOLVED `6a0c3a63` (tableFor per-row evt) · Bug 61 RESOLVED `0acb0d16` (formFor/§55 compound-rollup synth read-path → `_scrml_derived_get(dotted)`; submit-gate enables when valid — **formFor functional end-to-end**) — all PA-verified with happy-dom acceptance gates. OPEN HIGH: Bug 54 tableFor `:let` slot-drop (DEFERRED, parse-layer) — **the only open HIGH.** ~~C10~~ **RESOLVED S142** (gate-found-tail `ada56bb6`: C10a lift-attr STRING re-quote + C10b is-pred dotted-LHS ws-tolerance; PA R26-verified clean under `--validate-emit`; was the dominant "blocks gate always-on" cluster — see §GATE-FOUND). **R27 RESOLVED S141 (fix-wave `55666c5b`, PA R26-verified): C1 two-bound `length(>=N,<=M)` · C2 `->`-arm value-`match` · C5 `;`-in-string `!{}` arm + C3=Bug45 `int`→`integer` alias — 4 landed; see §R27.** See §1 + `docs/audits/bug-51-class-corpus-coverage-audit-2026-05-28.md`. [S141 currency-fix: §0 + Bug 61/58 entries flipped to RESOLVED — Bug 61 landed at the v0.6.7 cut but the close-time known-gaps update was missed.]** · **Bug 56 (CPS scheduler — TDZ on body-DG reads + non-decl-in-Promise.all) NEW + RESOLVED S139 `3450f984` (TWO scheduler bugs; both produced `node --check`-clean runtime-broken emit; (A) body-DG `reads` deps now folded into scheduler dep sets per SPEC §19.9.9.1 — prevents TDZ; (B) non-decl stmts no longer shoved into Promise.all entries — prevents Promise-as-cell-value class; +5 regression tests; dashboard source refactored to const-decl pattern + pure `statusesFrom` helper; 0 regressions across 15,063 tests)** · **Bug 11 (6nz-V) `class:NAME` on for-lift RESOLVED S139 `f8a1f2ff` (was HIGH; long-standing — filed S126; runtime fix in `_scrml_effect`/`_scrml_effect_static` un-pause tracking around inner fn() so nested effects registered during reconcile properly subscribe; CLASS-LEVEL — covers any nested `_scrml_effect` in reused list items; +252L NEW regression test 9 tests + R26 PASS on 6nz reproducer)** · E-TYPE-001 lifecycle fire (S130 Landing 1 SHIPPED) · §29 vanilla-interop framing-corrected (S132) · **E-FN-003 (RESOLVED S133 `dbef4f4d`)** · **Bug 17 E-META-001 runtime-meta (RESOLVED S134 `6c6c0073`)** · **§6.6.18 alias-escape A4 LANDED S134 `b719a3d2`** · **Bug 19 Shape 1 lifecycle tracker LANDED S134 `fd58893e` (B-prereq)** · **§6.8.3 reset × lifecycle impl LANDED S135 `2ffe4f6a` (Q6-narrow; SPEC-ahead-of-impl bullet CLOSED)** · **Structural-in-logic-body silent-swallow class CLOSED S135 `ab0d13a3` (E-STRUCTURAL-ELEMENT-MISPLACED fires for `<schema>`/`<engine>`/`<channel>`/`<page>`/`<auth>`/`<errors>`/`<onTransition>`/`<onTimeout>`/`<onIdle>` in `${...}` bodies; +19 tests)** · **Bug 28 `or`/`and` codegen lowering RESOLVED S136 `89008e97` (R24-BUG-1; 2-site fix + 42-test regression; HELD 4/4 R25)** · **Bug 29 narrow `{ return }` arm RESOLVED S136 `c7e81962` (R24-BUG-2; +18 regression tests; broader case Bug 38 RESOLVED S137 `933d1ad3`)** · **Bug 36 `! ErrorType` bare-form parse-gap RESOLVED S136 `e1269844` (was CRITICAL R25; 3-site fix ast-builder + native-parser + 12-test regression; spec §41.14 bare-form ratification)** · **Bug 39 phantom enum→textContent wiring RESOLVED-AS-SIDE-EFFECT-OF-BUG-36 S136 `e1269844` (was HIGH R25; was a symptom of Bug 36's orphan-IDENT)** · **Bug 37 `<each in=@x.filter(c=>...)>` arrow truncation RESOLVED S137 `1ce963d0` (R25; ast-builder `_findEachOpenerEnd` paren/bracket-aware; +12 tests; Shape A — accept inline arrow)** · **Bug 38 `!{}` arm body codegen broader case RESOLVED S137 `933d1ad3` (R25; emit-logic.ts `emitArmAssign` extended with multi-stmt + single-stmt-side-effect branches; +18 tests; closes R24-Bug-29-family deeper shapes; codegen scope correct; FULL EMPIRICAL CLOSE via Bug 49 fix `076d53e5`)** · **Bug 40 `:`-shorthand inside `<each>` item body RESOLVED S137 `50d38095` (R25; SPEC §4.14 BS-level compliance gap; three-file fix block-splitter + ast-builder + emit-each; `<empty :>` sub-case closed same-root; +20 tests)** · **Bug 41 `<schema>` HTML body-text leak RESOLVED S137 `ebeba766` (R25; emit-html.ts `SERVER_ONLY_STATE_TYPES` exclusion for `schema`+`seeds`; +18 tests; sibling structural-elements verified clean upstream)** · **Bug 49 BS-level stmt-boundary `!{...}` content drop RESOLVED S137 `076d53e5` (R26-surfaced; UPSTREAM of Bug 38; tokenizer.ts `tryEmitSyntheticErrorEffectBlock` helper; closes both bare-call + const-binding shapes; +12 tests + PA-verified empirical R26 clean on all 4 R25 devs)** · **R24-BUG-4 `<match>` + `<each>` `</>` generic closer RESOLVED S138 `adc0a70f` (CLASS-LEVEL — closes both <match> AND <each> in one fix; block-splitter.js generic tag-stack scanner +479/-58L; +23 tests; PA-verified R26 dev-3-svelte clean E-CTX-001/003; SURFACED 2 NEW HIGH downstream Phase-3 codegen gaps Bug 52 + 53 previously MASKED by BS-level rejection)** | **Bug 9 RESOLVED-L1+L2 S138 `a4a0f2d2` (was HIGH; direct-caller portion + CPS planner shape gate closed together; L1 alone would have regressed 5/8 gauntlet sources; paired with Bug 55 fix in same commit; L3 transitive coloring still deferred — §8 tripwire test)** · **Bug 55 RESOLVED S138 `a4a0f2d2` (was NEW HIGH same session; surfaced by Bug 9 L1 attempt; PA-direct +37L scheduling.ts isStatementShapeStmt guard forces statement-shape stmts to size-1 groups; 6 stmt kinds covered: guarded-expr / if-stmt / while-stmt / do-while-stmt / for-stmt / return-stmt)** · **Bug 52 `<match on=.BareVariant>` codegen no bare-variant lowering RESOLVED S138 `a30d86d1` (PA-direct +18L emit-match.ts resolveOnExpr + 276L NEW regression test 8 tests; PA-verified R26 dev-3-svelte: `_dispatch("High")` post-fix, zero `.Variant` patterns)** · **Bug 53 `<match>` `:`-shorthand arm body emits raw markup as textContent RESOLVED S138 `f05d04d2` (PA-direct surgical +46/-18L emit-match.ts shorthand-branch markup-start detection + 280L NEW regression test 8 tests; class-close with Bug 52 — full match codegen surface R24 exercised now closed; PA-verified R26 dev-3-svelte zero `textContent = <` patterns + node --check PASS)** · **Bug 50 `<tableFor>` synthetic onchange handler emits raw if-stmt inside object-literal property value RESOLVED S138 `c89f1176` (was MED NOT-REPRODUCED `3a482076` REVERSED `cc93c031` reclassified HIGH; PA-direct surgical +31L emit-event-wiring.ts Case B `rewriteExprArrowBody` for fallback-string path + 233L NEW regression test 7 tests; PA-verified R26 BOTH R24 dev-3-svelte AND R24 dev-1-react now `node --check` PASS with proper `evt => { ... }` arrow shape; mirrors Bug C 6nz emit-expr.ts:emitEscapeHatch precedent)** |
| MED | 13 | **R28 cluster (S143 gauntlet): R28-1c (`<each>` same-key per-item-reactivity gap — content doesn't re-render on in-place field mutation; NEW, needs-confirm) · R28-1d (bare-`<program>` default-logic drops `<ul>`/`<each>`; NEW, needs-confirm) · R28-4 `E-PA-002` advertises a `?{} CREATE TABLE` fix the scanner ignores (misleading diagnostic) · R28-8 bare-variant inference doesn't reach typed object-literal fields / `is some`-narrowed `==` RHS (design call: extend §14.10 vs canon-fix §4.8). R28-5 = C4 confirmed w/ clean reproducer (folds into existing C4). See §R28.** · ~~C11~~ **RESOLVED S142** (gate-found-tail `ada56bb6`: seeds.scrml migrated off the non-canonical `server {}` block-statement → body-content-inferred server fn per Insight 26; also cleared a symptom E-ROUTE-001 in trucking-smoke). ~~C7~~ **RESOLVED S142** (errorBoundary from-scratch build `f3e9039d` — §19.6 + C-hybrid; also closes the R24-step-3b direction-call + the errorBoundary canon drift). · **R27 NEW MED (S141): C4 lifecycle E-TYPE-001 dormant on object-literal struct construction · C6 formFor `bind:value=@synth.field` E-SCOPE-001 inside engine state-child** (C7 RESOLVED — see §R27). · **NEW S140 (Bug-51-class corpus audit — OPEN): Bug 60 render-by-tag nested-compound-field literal-tag fallthrough (MED; DEFERRED) — see §2 entry.** · Bug 15 `~snapshot` codegen leak (S131 SHIPPED) · E-SCHEMA-003 enforcement (S133 SHIPPED `afbcb47a`) · **Bug 42 `?{}` SQL in `server function*` SSE generator RESOLVED S137 `480aded4`** · **Bug 35 rewriteIsPredicates space-padded-dot AST-path completeness RESOLVED S137 `5cb993c2`** · **Bug 30 + Bug 43 linter HTML comment opacity RESOLVED S137 `5199a435`** · **Bug 44 W-LINT-007 false-positive on `fallback={<markup/>}` RESOLVED S137 `98f82970`** · **Bug 31 `if`-as-expression in `!{}` result binding RESOLVED S137 `8f4f4ce3`** · **Bug 32 `@.` in tableFor column slot RESOLVED S137 `68bfb4a4` (PA hypothesis correct; +170/-3L `rewriteAtDot*` helpers in emit-table-for.ts; +13 tests; CLASS-CLOSE — closes Bug 31 agent's deferred dev-1 line-438 finding as SAME ROOT; PA-verified R26 clean orphan `@ .` count 1→0)** · **Bug 50 `<tableFor>` synthetic onchange handler emits raw if-stmt inside object-literal NOT-REPRODUCED-THEN-RE-OPENED S138 (closure `3a482076` REVERSED — R26 cross-source sweep on dev-3-svelte R24 shows symptom DOES fire after R24-BUG-4 BS-closer unmask; reclassified HIGH; see HIGH row + Bug 50 detail entry)** · **Bug 51 FULLY RESOLVED S139 (A+B `5640148e`; C `da4ffd1a` same session) — Shape 2 + render-by-tag now works end-to-end at every declaration position (file-top, auto-lifted inside `<program>`, explicit `${...}` wrap)** | Bug 1 Tailwind residuals · V-kill READ-side fire · MCP V0 partial-impl deferrals · Generator policy · L19 multi-statement-handler · **A5 refinement-type freeze extension (DEFERRED with adoption-watch trigger, S134)** |
| LOW | 15 | **R28-2b (NEW S143): the leading-`:` on `:let` is stripped by the tokenizer (`tokenizer.ts:763`) → `:let` arrives as `let`. R28-2 worked around it (`let` alias makes `:let` FUNCTION today); verbatim end-to-end `:let` (cohesion with `bind:`/`class:`) needs a separate tokenizer dispatch. See §R28.** · **S142 NEW LOW (gate-found-tail diagnostic gaps): brace-compound `<x> = {…}` (non-canonical; structural-children is canonical per §6.3) AND bare-prose `<onTransition>` body both compile exit-0 with NO hard diagnostic (silent-swallow class — should fire E-STRUCTURAL-ELEMENT-MISPLACED / E-UNQUOTED-DISPLAY-TEXT respectively). Surfaced when the fix-wave migrated 2 non-canonical test fixtures.** · **R27 NEW LOW (S141): C8 `@map[.Variant]` subscript → silent invalid JS (missing diagnostic; the subscript form is non-canonical per §14.10 — primary cause was a BRIEF-error) · C9 E-DG-002 false-positive on state read only inside a derived `.filter()` arrow — see §R27. Bug 45 (= C3 `int`-alias) RESOLVED S141 fix-wave `55666c5b`.** · (rotate out below) · **Bug 33 W-LINT-011 :let= false positive RESOLVED S138 `5ec84589` (PA-direct surgical regex negative-lookahead + 3 regression tests; surfaced separate Bug 54 candidate — `:let=` attribute-registry wire-up)** · **Bug 24 qualified-form discrim regex tolerance RESOLVED S138 `aa0395a7` (PA-direct surgical regex extension + 4 regression tests; mirrors classifyWriteAgainstSpec parallel — read-side asymmetry closed)** · **Bug 23 W-LIFECYCLE-LEGACY-ARROW Shape 1 emission gap RESOLVED S138 `61391c75` (PA-direct surgical +27L buildCellValueLifecycleMap per-cell emission; mirrors struct-field equivalent at extractLifecycleFields)** · **Bug 25 transition() deeper-expression regex tolerance RESOLVED S138 `5160afad` (PA-direct surgical regex extension dotted-path + 3 regression tests; mirrors RESET_CALL_RE Q6-narrow pattern; array-index form deferred per filing)** | Bug 4 bare-`/` · GITI-015 · §11-folded-citation sweep · `bun scrml promote --engine` Tier-1→2 deferred · **Bug 21 Q6-narrow deep multi-level reset heuristic (S135)** · **Bug 22 Q6-narrow cross-cell `default=` classification heuristic (S135)** · **Bug 26 `${...}` inside `function` body E-SCOPE-001 (S135)** · **Bug 27 tryParseStructuralDecl extra lookahead cleanup (S135)** · **Bug 34 Shape-2 compound markup-init missing 2nd arg (NEW S136 R24)** · **Bug 45 `int` ghost type → asIs fallthrough → confusing E-SCHEMAFOR-NO-SQL-MAPPING (NEW S136 R25; 4/4 devs reached from canon)** · **Bug 46 tableFor `sortable=`/`selectable=` RESOLVED-VERIFIED S141** (R25-filed "not implemented / W-ATTR-001 forwarded as plain HTML" is STALE — both attrs now emit wiring with NO W-ATTR-001; PA compile-verified: sortable th-click + selectable checkbox wiring present, node-check clean; closed by the §41.16 tableFor impl + S140 Bug-59 per-row-checkbox fix; R27 devs used both successfully) · **Bug 48 latent paren/bracket-depth gap in sibling `<match>`/`<machine>`/`<engine>` opener finders (NEW S137; surfaced by Bug 37 fix; not adopter-fired today)** |
| Nominal (spec-ahead-of-impl) | 7 | — | Build Story §58 · `import:host` §21.3.1 · Quoted-text §4.18 compiler fire · `_{}` foreign code · WASM call-char sigils · Sidecar process decls · RemoteData enum |

---

## §R28 — gauntlet R28 cluster (S143, 2026-05-29)

**Round:** 5-persona (React/Go/Elixir/Svelte/Pascal) Content-Publishing-Platform ("Press") gauntlet. **Purpose:** first adopter stress of the S142 surfaces — errorBoundary (§19.6) + the emitted-JS parse gate (default-ON) — plus the never-tested variant-progression `transition()` path (§14.12.6.2) and the C4 object-literal probe; re-test L22 family / channels / SSE / auth / match / each / validators. **Result:** all 5 implemented 15/15 + compiled clean in-context. **Two validation wins:** errorBoundary works end-to-end (all 5; zero walls) + the parse gate caught 2 real codegen-defect classes with zero false positives. 5 PA-confirmed compiler bugs + 1 canon-fix + 1 design call + C4 re-confirmed. Overseer caught 2 dev misreports (react+svelte both misreported the transition() path). Detail: `scrml-support/docs/gauntlets/gauntlet-r28-report.md` + `gauntlet-r28/OVERSEER-REPORT.md` + `overseer-verdicts-raw.json` + the 5 dev sources/reports.

| ID | Sev | Status | Bug | Root cause / note |
|---|---|---|---|---|
| R28-7 | HIGH | ✅ **RESOLVED S143 (4144dc30 — user chose fix-now + empty-`<td>`)** | schemaFor + tableFor now MAP `T \| not` (nullable) + `T?` sugar optional struct fields | SPEC §41.15.8a (schemaFor → nullable column = base T's column WITHOUT NOT NULL/req; explicit inverse of §14.8.3; exactly-`[T,not]` qual; nullable-enum; `req`+`\|not` conflict → nullable wins) + §41.16.6a (tableFor → value-or-EMPTY-`<td>`, guarded so never literal null/undefined — consistent with S89 `""`-is-defined) + §34 carve-outs. emit-schema-for.ts `nullableUnionBase` + emit-table-for.ts cell-guard + type-system.ts `T?`-desugar. PA R26: nullable repro compiles clean, empty-guard `?? ""` present, node-check PASS. +4 net tests. Non-`\|not` unions (`string\|integer`) still correctly error. |
| **R28-7b** | LOW | OPEN | predicated-base-inside-union (`bio: string req length(<=200) \| not`) resolves to `[asIs, not]` (the union member loses raw-clause predicate-base recovery) → still fires `E-SCHEMAFOR-NO-SQL-MAPPING` | pre-existing resolver limitation surfaced by R28-7; NOT one of the canonical R28 nullable shapes (`string\|not`/`integer\|not`/`Status\|not`/`T?` all work). The predicate-base recovery doesn't reach inside a union member. Out of R28-7 scope; file for resolver follow-up. |
| R28-6 | HIGH | ✅ **RESOLVED S143 (0ecfab98)** | variant-progression `transition()` enforcement DORMANT — omitting `transition()` before post-transition field access compiled exit-0 | **CORRECTED ROOT (agent Rule-4/R26 finding): the `.get()` loose-return was a red herring** — the annotation is retained end-to-end. The real gap: `checkLifecycleBindingAccess`'s `state-decl` handler `continue`d past the RHS of a reactive assignment (`@cell = … + binding.field`), never scanning it for reads of OTHER lifecycle bindings. Fix scans the reactive-assignment RHS; symmetrically closes the same dormancy for presence-progression E-TYPE-001 RHS reads. PA R26: dormant path now fires; correct path + presence-progression clean. +6 tests. SPEC §14.12.6.2/§14.12.10. |
| R28-2 | HIGH | ✅ **RESOLVED S143 (0dbef110) — Bug 54 un-deferred + CLOSED** | tableFor `<column>` row-access broken BOTH ways: `:let={(row)=>…}` (§41.16.3) forwarded-as-HTML; `@row` (§41.16.10) → `_scrml_reactive_get("row")` | TWO root causes both closed: (1) `rewriteAtDotInExprText` now strips `@` from the exact row-binding name → loop local (emit-table-for.ts; was only handling `@.`); (2) `:let` arrow re-parsed via the §16.6 expander machinery in the type-system column walk + `let` recognized as the colon-stripped `:let` in attribute-registry.js/html-elements.js (no W-ATTR-001). Per Rule 4, §41.16.10 defers the `@row` ergonomics, NOT the silent-wrong codegen. PA R26: `:let` emits slot body; `@row` emits loop-local (0 reactive_get). +6 tests. **Deeper root deferred → R28-2b.** |
| R28-1 | HIGH | ✅ **RESOLVED S143 (e6fb2f3d) — gate-fire closed** | `@.` each-sigil leaked raw into emitted JS for `<match on=@.field>` nested in `<each … as alias>` → gate-caught `E-CODEGEN-INVALID-JS` | `collectMatchBlocks` now threads the enclosing `<each>` iter var into nested match-blocks; `resolveOnExpr`/`rewriteAtDotInOnExpr` lowers `on=@.field` → `iterVar.field` (byte-identical to `on=alias.field`, SPEC §17.7.3). PA R26: dev-2-go reverted to `on=@.status` compiles gate-clean (0 raw `dispatch(@.`, node --check PASS). +10 tests. **NOTE: closes the GATE-FIRE only; the deeper runtime gap (module-scope dispatcher → wrong per-item value, affects BOTH `@.` and `alias.field`) is → R28-1b.** |
| R28-3 | HIGH | ✅ **RESOLVED S143 (051ce984)** | `:`-shorthand engine state-child preceded by a `//` markup comment broke block-splitting → `W-PROGRAM-001` + `E-CTX-001`/`E-CTX-003` | Root: a `//` comment between the parent opener `>` and the `:`-shorthand `<engine>` made the compound-auto-lift scanner (`classifyOpenerForCompoundScan`) land on `/` instead of the first `<child>`, mis-classifying the parent as never-closing markup → closer-stack unwind. SPEC §27.1: `//` is universal trivia. New `skipTriviaForCompoundScan` (ws + `//` + `/* */`). PA R26: //-comment repro now clean; dev-4-svelte/dev-2-go zero regression; within-node canary 1005/0. +5 tests. |
| **R28-1b** | HIGH | ✅ **RESOLVED S143 (1d227a74)** | block-form `<match>` inside `<each>` was NOT rendered per-item (each factory dropped the `match-block` child + a module-scope dispatcher ref'd the item var out of scope) | Fix emits the match PER-ITEM inside the each factory: render/wire fns stay module-scope (item-agnostic, reused), each `<li>` creates its own mount + calls `dispatch(mountEl, article.status)` in factory scope (where `article` is bound), dispatch takes the mount as a param with per-mount dispose isolation (stored on the mount el — no last-write-wins across siblings); phantom module-scope trigger removed. emit-each.ts handler + emit-match.ts/emit-variant-guard.ts itemScopedDispatch. PA R26: no "unhandled match-block"; happy-dom 11/0 (2 items diff statuses → each renders its own arm). R28-1 test rewritten same commit (S113). |
| **R28-1c** | MED | OPEN — surfaced S143, NEEDS-CONFIRM | same-key in-place field mutation does NOT re-render per-item `<each>` content — keyed reconciliation reuses the `<li>` node without re-running the per-item factory; a same-key item whose field changes in-place doesn't update | GENERAL `<each>` per-item-reactivity gap (NOT match-specific — R28-1b agent empirically saw it hit `${article.title}` identically). Canonical scrml array-update is reference-replace (`@items = [...]`) which re-renders; in-place single-field mutation is the affected path. Fine-grained per-item reactive bindings = a larger feature. Independent confirm + severity before fix (R26 reverse-direction). |
| **R28-1d** | MED | OPEN — surfaced S143, NEEDS-CONFIRM | bare `<program>` default-logic form (no `${...}` wrap) drops `<ul>`/`<each>` — emits NO each-mount + NO each render fn, whereas `<program title="T">` + `${ type... }` wrap works | a `<program>` default-logic (§40.8) parse-path issue orthogonal to R28-1b; surfaced by the R28-1b agent while building the happy-dom test. Independent confirm before fix. |
| **R28-2b** | LOW | OPEN | the leading-`:` on `:let` is stripped by the tokenizer (`tokenizer.ts:763` "Unexpected char — skip"; regex `/[A-Za-z_@]/` excludes `:`) → `:let` arrives as `let` | R28-2 worked around it (accept the `let` alias) so `:let` FUNCTIONS today. A verbatim end-to-end `:let` (cohesion with `bind:`/`class:` which keep their colon mid-name) needs a tokenizer fix — broad blast radius across all leading-colon attrs; separate tokenizer dispatch. Surfaced by the R28-2 agent. |
| R28-4 | MED | OPEN | `E-PA-002` advertises a `?{} CREATE TABLE` resolution but the PA introspection scanner ignores `CREATE TABLE` in `?{}` blocks (top-level AND inside fn bodies) | Misleading diagnostic — the error's own suggested fix doesn't satisfy the check. (Companion claim — `<schema>`/`schemaFor` DDL should satisfy `<db>` introspection — is NOT a bug; SPEC is silent on a connection, the surfaces are intentionally decoupled.) elixir; overseer-confirmed. Don't soft-classify (advertises a non-working escape hatch). |
| R28-5 | MED | OPEN — **= C4** | `E-TYPE-001` dormant on object-literal struct construction (`const a: T = {…}; a.field`) | lifecycle tracked only on Shape 1 reactive cells, not local object-literal const/let bindings. **= the known C4** (object-literal lifecycle dormancy) — R28 adds a clean adopter reproducer (`/tmp/r28-pa/`, pascal's `(not to string)` field probe). Fold into C4. |
| R28-C1 | HIGH | CANON-FIX | SPEC §14.12.6.2 + PRIMER §6.5 flagship variant-progression worked example uses `server fn … -> (.A to .B) { ?{} }` → `E-FN-001` (fn is pure; `server` doesn't lift the SQL ban) | The flagship example doesn't compile verbatim; should be `server function`. 4/5 devs hit it. Compiler CORRECT; canon wrong. Fix SPEC §14.12.6.2 (line ~8118) + PRIMER §6.5. (Also §14.12.6.x examples use unimplemented `print()`.) |
| R28-8 | MED | OPEN (design call) | bare-variant inference does not propagate into typed object-literal field positions / `is some`-narrowed `==` RHS → `E-VARIANT-AMBIGUOUS` | SPEC §14.10's enumerated inference-position list excludes these; kickstarter §4.8 "other position" oversells. Overseer SPLIT (svelte: `: T` annotation propagates / NOT-REPRODUCED; elixir: doesn't propagate / COMPILER-BUG). **PA-decision:** extend §14.10's position list (→ compiler feature) OR fix the kickstarter §4.8 overclaim (→ canon-fix). Workaround `Enum.Variant` universally correct. |
| R28-C2 | MED | CANON-FIX | kickstarter drift bundle: §11.3 stale file-level `<channel>` (SPEC §38.1 v0.3 = inside-`<program>`; would fire `E-CHANNEL-OUTSIDE-PROGRAM`); §11.13 SSE recipe omits `sleep` import; `< db>`/`< schema>` leading-space (`W-WHITESPACE-001`); `print()` in SPEC §14.12.6.x examples | lints/SPEC CORRECT; kickstarter stale (2026-05-04 predates v0.3 reversals). Canon-maintenance backlog (overlaps the §R27 canon-drift note). |

**EXPECTED / no-action (overseer-classified):** bare compound expr in `if=` needs `${…}` (§5 attribute-quoting — `if=@cell` is single-ref only); `W-WHITESPACE-001` leading-space deprecation working as intended; engine inside a *redundant* `${}` correctly fires `E-STRUCTURAL-ELEMENT-MISPLACED` (only the message is misleading when the engine is a direct `<program>` child — minor).

**Validation wins (S142 work, all 5 personas, independently confirmed):** errorBoundary §19.6 (nested inner-catches-first, `fallback=`, per-variant `renders` w/ payload, C-hybrid backstop §19.6.8, E-ERROR-005 exhaustiveness) — **zero walls**. Parse gate §2.2.1 default-ON — **zero false positives** across 5 clean compiles + true-positive catches (R28-1 + R28-2). Also clean: formFor validity surface, `fail`/`!{}` + per-handler tx, engine Tier-2 + `<onTransition>`, SSE codegen, word-form `and`/`or`/`not`, channel placement enforcement.

---

## §R27 — gauntlet R27 cluster (S141, 2026-05-29)

**Round:** 5-persona (React/Go/Elixir/Svelte/Pascal) Expense-Approval Workflow gauntlet. **Purpose:** validate the S140 fix-wave against fresh adopter source + first adopter exercise of the `(A to B)` lifecycle annotation. **Result:** S140 fixes (Bug 57/58/59/61) HELD end-to-end across all 5 (overseer-confirmed). 9 candidate bugs surfaced; overseer-classified. Detail: `scrml-support/docs/gauntlets/gauntlet-r27/OVERSEER-REPORT.md` + the 5 dev friction reports + `gauntlet-r27/dev-{1..5}-*.scrml`.

| ID | Sev | Status | Bug | Root cause / note |
|---|---|---|---|---|
| C1 | HIGH | ✅ RESOLVED S141 (fix-wave 55666c5b) | two-bound `length(>=N,<=M)` in formFor/struct-field validator → `{op:">=",value:2 , <= 120}` malformed obj literal, invalid JS at exit-0 | validator-emit; canon-taught (PRIMER §8). Repro `/tmp/pa-r27-len2.scrml`. 5/5 devs. |
| C2 | HIGH | ✅ RESOLVED S141 (fix-wave 55666c5b) | `->`-arm value-return `match` → `/* match expression could not be compiled */ …;)` invalid JS at exit-0 | only `=>` works; PRIMER §6.2 documents `->`. Repro `/tmp/pa-r27-match.scrml`. 4 devs. |
| C5 | HIGH | ✅ RESOLVED S141 (fix-wave 55666c5b) | `;` inside a string in `!{}` arm → splitter breaks the string, invalid JS at exit-0 | arm-body statement-splitter not string-literal-aware. Repro `/tmp/pa-r27-semi.scrml`. dev-5. |
| C3 | (LOW→re-conf) | ✅ RESOLVED S141 (fix-wave 55666c5b) | bare `int` struct field → `asIs` → `E-SCHEMAFOR-NO-SQL-MAPPING` | **= Bug 45 (already filed S136 R25)** — R27 re-confirmed 5/5 + root-caused: `BUILTIN_TYPES` type-system.ts:~623 missing `int`→`integer` alias (mirror `bool`→`boolean`). 1-line. |
| C4 | MED | OPEN | lifecycle E-TYPE-001 **dormant on object-literal-constructed struct values** (`const u: User = {…}` — the PRIMER §6.5 verbatim shape). fn-return + `<User …>` state-instantiation DO fire. | `collectStructBindings` type-system.ts:14008 has no object-literal construction path. SPEC §14.12.1/.3 normative, NO deferral caveat → real spec-vs-impl gap (flagship). NOT in fix-wave (user scope). |
| C7 | MED | ✅ RESOLVED S142 (errorBoundary build `f3e9039d`) | errorBoundary was effectively UNIMPLEMENTED (inert marker — not just "inert anchor"). Built from-scratch to the ratified §19.6 + C-hybrid model: typed `!`-error catch → per-variant `renders` / boundary `fallback=` (priority §19.6.5) + compiler-emitted host-JS backstop for non-`!` throws (§19.6.8) + E-ERROR-005 static exhaustiveness + §19.6.4 nesting + SPEC §19.6.8 amendment. **ALSO closes the R24-step-3b errorBoundary direction-call** (ratified §19.6 + C-hybrid catch-scope, S142) **+ the errorBoundary canon-vs-impl drift** (PRIMER §6 + kickstarter `renders=.Fallback`/auto-synth/§19.11-cite → §19.6 `fallback=` + per-variant-renders form). PA dual-verify: full suite 22,153/0 gate-default-ON; happy-dom both paths (typed + backstop) + 7 conformance. |
| C6 | MED | OPEN | `bind:value=@<synth>.<field>` → E-SCOPE-001 ONLY when formFor nested in an engine state-child (works top-level; `isValid` read works both) | synth-cell scope registration doesn't propagate into engine-state-child scope. dev-4 probe. |
| C8 | LOW | OPEN | `@map[.Variant]` subscript → silent invalid JS `[.Submitted]` (no diagnostic) | **Primary cause was a BRIEF-error** (R27 feature-7 prescribed a non-canonical subscript; §14.10 → dot-access `@map.Submitted` is canonical). LOW compiler-bug = the missing diagnostic (silent invalid JS vs clean rejection). |
| C9 | LOW | OPEN | E-DG-002 false-positive: state read only inside a derived `.filter()` arrow flagged "never consumed" | runtime subscribes correctly; DG consumption-tracker under-counts arrow-body reads. |

**Strategic — emitted-JS parse gate BUILT + RATIFIED (A+D), S141** (`scrml-support/docs/deep-dives/emitted-js-parse-gate-invariant-2026-05-29.md` + `scrmlTS/docs/changes/gate-emitted-js-parse-invariant-2026-05-29/`). All 5 devs' unprompted #1 ask. Landed FLAG-GATED (`validateEmit` compile option, default OFF; in-process Acorn `E-CODEGEN-INVALID-JS` backstop over final artifacts + `E-CG-003` D-conversion of the last silent-stub match site; SPEC §2.2.1 + §34). Perf admits always-on (~24ms on the 8433-line trucking-dispatch reference, ~1-2% of compile). **First run caught 16 pre-existing invalid-JS artifacts in `examples/` (C10/C11 below) — the gate works.** Flips to always-on (+ a `--validate-emit` CLI flag) once that backlog closes. Complementary to the individual C1/C2/C5 fixes. **[S142 UPDATE: backlog CLOSED — gate FLIPPED DEFAULT-ON; the gate is now a compile-time invariant by default. See ✅ Gate status + §GATE-FOUND-RESIDUALS (all resolved) below.]**

**Canon-vs-impl drift (lints are CORRECT; canon needs migration — NOT compiler bugs):** `server function` fires W-DEPRECATED-SERVER-MODIFIER though all canon teaches it; kickstarter leading-space `< db>`/`< schema>` trips W-WHITESPACE-001; errorBoundary canon shape `renders=.Fallback` → migrate to SPEC `fallback={}`. (Canon-maintenance backlog.)

**Bug 46 — RESOLVED-VERIFIED S141** (was R25/S136 "tableFor `sortable=`/`selectable=` not implemented / W-ATTR-001"): PA compile-verified both attrs emit wiring with no W-ATTR-001; closed by the §41.16 tableFor impl + the S140 Bug-59 per-row-checkbox fix.

**GATE-FOUND (S141 discovery → S142 fix-wave) — the emitted-JS parse-gate's invalid-JS surface:**
- ~~**C10 (HIGH)**~~ **RESOLVED S142** (gate-found-tail `ada56bb6`) — compound-predicate `if=(X is some && X != "")` truncation was the dominant cluster; root-caused to TWO defects: **C10a** lift-markup attr-value STRING-token re-quote (`ast-builder.js`) + **C10b** is-predicate dotted-LHS whitespace tolerance (`codegen/rewrite.ts`). PA R26-verified clean under `--validate-emit` (trucking 0 fires; R27 dev-1/2/4/5 0 fires).
- ~~**C11 (MED)**~~ **RESOLVED S142** (gate-found-tail `ada56bb6`) — `examples/23-trucking-dispatch/seeds.scrml` migrated off the non-canonical `function f(){ server {…} }` block-statement (SPEC has no `server {` block-statement form) to a plain `export function runSeeds()` whose `?{}` body auto-escalates to a server fn via body-content inference (Insight 26). Removing the malformed stub also cleared a symptom `E-ROUTE-001` (trucking-smoke baseline 1→0).

**✅ Gate status (S142 — FLIPPED DEFAULT-ON, gate-flip-and-residuals `db88e989`):** `validateEmit` default is now **`true`** — the emitted-JS parse gate is a **compile-time invariant by default** (SPEC §2.2.1 "active by default"). `--no-validate-emit` (compile/build/dev) is the operational opt-out. PA-independent dual-verify: full `bun run test` GREEN **22,141 / 0** with default-ON; 0 E-CODEGEN-INVALID-JS; within-node parity 1005/0 (no rebump needed — the flip-wave fixes were narrow, moved LIVE toward native); R26 all adopter sources gate-clean.

**§GATE-FOUND-RESIDUALS — ALL RESOLVED S142 (gate-flip-and-residuals fix-wave):**
- ~~self-host meta-checker~~ **RESOLVED** — root was `collectExpr` breaking at a `type`-keyword-as-identifier-operand in RHS context (NOT "multi-line ternary" as hypothesized); STMT_KEYWORD boundary guard (ast-builder.js).
- ~~self-host module-resolver~~ **RESOLVED** — tokenizer `readBacktickString` now honors backslash escapes (tokenizer.ts); the `not`-in-template-string sub-issue resolved transitively.
- ~~nested `!{}` (R25-Bug-49 §5)~~ **RESOLVED** — `emitArmBody` re-parses the nested guarded-expr via BS→TAB (emit-logic.ts, option-b codegen re-parse behind a top-level-`!{` gate). NOT STOP-blocked despite the high-risk framing.
- **+2 CASCADE residuals** the closed surface exposed (the gate's abort-on-first-failure had masked them) — **both RESOLVED**: `await await import()` double-await (expression-parser.ts ImportExpression case) + non-async `^{}` meta-effect wrapper (emit-logic.ts). Caught by R26 re-verify before the flip.

Canary side-effect: cg.scrml LIVE-HOIST-MISCLASSIFY→**EXACT** (residual-1 fix eliminated the dynamic-`import()`-as-module-import phantom; LIVE imports 5→0 now matches native — a canary TIGHTENING, an early LIVE-correctness win ahead of M6).

---

## §1 HIGH — adopter-visible / silent-wrong-output

> **NEW S140 — Bug-51-class corpus-coverage audit (`docs/audits/bug-51-class-corpus-coverage-audit-2026-05-28.md`).** The audit found 5 silent-miscompiles on shipped features (clean compile + `node --check` pass, but feature wiring absent/broken at runtime), all hidden behind emit-string-only tests with no happy-dom coverage. Bugs **57 / 58 / 59** (HIGH) + **54** (HIGH) filed below; **60** (MED) in §2. Bugs 57/58/59 DISPATCHED S140; 54 + 60 DEFERRED. Each fix's acceptance gate is a happy-dom runtime test (the missing tier that let these ship). PA dual-verified 57/58/59 per pa.md S138 R26 doctrine. The S139 "engine `effect=` doesn't fire" suspicion was R26-reverse NOT-REPRODUCED (effect= works) — no bug filed; hand-off note corrected.

### Bug 61 — `@compound.isValid` (and §55 compound-level rollup synth reads) emit member-access on the compound proxy, not `_scrml_derived_get(dotted)` — `RESOLVED S140 (commit 0acb0d16); was HIGH` (PA-verified; surfaced by Bug 58)

**Symptom.** Reading a compound-level §55 synth property — `@form.isValid` / `@form.errors` / `@form.touched` / `@form.submitted` — emits `_scrml_reactive_get("form").isValid` (member access on the compound VALUE object, which holds the field values and has no `isValid` property → `undefined`) instead of `_scrml_derived_get("form.isValid")` (the dotted derived cell, which IS declared). Net adopter impact: `@form.isValid` returns `undefined`; `disabled=!@form.isValid` evaluates `!undefined` → `true` → **the submit button stays disabled even when the form is valid**. Compile clean; `node --check` passes. This is why formFor's flagship submit button is still non-functional end-to-end AFTER Bug 58 (which correctly emits + wires the surface, but the compound-level READ path is a separate defect).

**Root cause (PA-verified, baseline `29c33a6c`).** The §55 synth surface declares compound-level rollup cells with DOTTED keys (`_scrml_derived_declare("form.isValid")` — verified present, count 1 on a hand-authored compound). But a `@form.isValid` read resolves through the compound-proxy member-access path (`_scrml_reactive_get("form").isValid`) rather than the dotted-derived-cell path (`_scrml_derived_get("form.isValid")`). Per-field reads (`@form.field.errors`, 3-segment) DO emit the correct `_scrml_derived_get` form — only the 2-segment compound-rollup read is misrouted. The read-path resolver does not recognize a 2-segment `@compound.<synthProp>` as a synth-derived-cell read.

**Verified scope.** PA independently confirmed on BOTH the formFor emit (`_scrml_reactive_get("signup").isValid` at the disabled-gate) AND a hand-authored §55 compound (`disabled=!@form.isValid` → `_scrml_reactive_get("form").isValid`, while `form.isValid` IS declared as a derived cell). `isValid` verified directly; `errors`/`touched`/`submitted` at compound level very likely share the same read-path (confirm at fix time). PRE-EXISTING + GENERAL (not formFor-specific, not introduced by Bug 58); affects every §55 compound with a compound-level rollup read.

**Disposition — RESOLVED S140 (commit `0acb0d16`), landed with the v0.6.7 cut.** The `@compound.<synthProp>` rollup read-path now collapses 2-segment synth-property reads to the dotted derived cell (`_scrml_derived_get("<compound>.<prop>")`); the submit-gate enables when the form becomes valid; **formFor is functional end-to-end**. (Per the S140 chronology in hand-off-144: v1 agent crashed + over-fired; the correct fix used a threaded `collectSynthCellKeys(fileAST)` pre-pass to guard against the over-fire on plain cells with `errors`/`submitted`/`isValid`/`touched` fields.) Original fix guidance retained for forensic: the `@compound.<prop>` read-path resolver (likely in `emit-bindings.ts` / the expression read-rewrite for `@`-member access, or the synth-cell lookup) must recognize a 2-segment access whose leaf is a registered compound-level synth property (`isValid`/`errors`/`touched`/`submitted`) and emit `_scrml_derived_get("<compound>.<prop>")` — mirroring the per-field 3-segment path that already works. **Acceptance gate:** happy-dom test asserting `@form.isValid` is reactive + the submit button enables when the form becomes valid (and the formFor browser test's documented-but-not-asserted disabled-gate behavior flips to asserted). Cross-refs: SPEC §55.5 / §55.7 (synth-property read semantics); Bug 58 (emits the surface; this is the read-path sibling); the §3.2 audit finding (the "8 unbacked reads" — Bug 58 backed them; Bug 61 fixes the compound-rollup read resolution). Deferred-sibling: the generic compound-child `bind:value=@compound.field` deep-set on a derived parent (Bug 58 fixed it formFor-locally via `_flatBindKey`; a general §55 storage-model fix would close it for hand-authored compounds — track with Bug 61).

### Bug 57 — `<each>` Tier-1 iteration: `_scrml_reconcile_list` tree-shaken out of the runtime bundle — `RESOLVED S140 (commit e4859a5f)` (was HIGH; PA-verified, happy-dom gate)

**Symptom.** Any adopter file whose only iteration is the Tier-1 `<each>` form ships a runtime-DEAD list: the emitted client JS calls `_scrml_reconcile_list(...)` but the runtime bundle never defines it → `ReferenceError: _scrml_reconcile_list is not defined` on the first `_scrml_each_render_N()`. Compile exits 0; `node --check` passes on every artifact. Emit-string tests pass (they `toMatch` the call-site).

**Root cause (PA-verified, baseline `c4d5ef96`).** `compiler/src/codegen/emit-client.ts` chunk-selection walk has NO `case "each-block"`. The only `chunks.add("reconciliation")` is at **line 684**, gated inside `case "for-stmt"` (line 663). Control proof: a Tier-0 `${for…lift}` file DOES emit `function _scrml_reconcile_list`; a Tier-1 `<each>`-only file does NOT. Minimal `<each>`-only repro: `_scrml_reconcile_list` CALLED (1) / DEFINED (0).

**Fix guidance.** Add a `case "each-block"` to the `emit-client.ts` chunk-walk that `chunks.add("reconciliation")` + `chunks.add("deep_reactive")` (the latter for `_scrml_effect_static`; a `<each of=N>` with no `@`-state decl could otherwise also lose it). Or have `emitEachBodyRenderForFile` signal its required chunks. **Acceptance gate:** a happy-dom test asserting (a) the runtime bundle DEFINES `_scrml_reconcile_list`, (b) a non-empty `<each>` list mounts + reconciles on data change, (c) `<empty>` renders when empty.

**Cross-refs.** SPEC §17.7; PRIMER §6.3; sibling Tier-1 shape `<match>` §6.2. Bug-51-A class. The Landing-1 per-item attribute-interpolation caveat (S131) is a SEPARATE minor item, NOT this bug.

### Bug 58 — `formFor` validity surface never emitted (synth compound state-decl spliced into markup-children) — `RESOLVED S140 (commit 29c33a6c)` (was HIGH; PA-verified, happy-dom gate) — read-path sibling Bug 61 also RESOLVED S140 `0acb0d16`

**Symptom.** The flagship `<formFor for=Signup onsubmit=fn/>` renders its inputs + submit button (markup half wired), but validation is 100% DEAD: the struct validators (req/length/pattern) are never wired; the §55 validity surface (`signup.isValid`, `signup.<field>.errors/.touched`, `signup.submitted`) is consumed by emitted read-sites (8 reads: disabled-button gate + per-field error anchors) but NOTHING declares/backs them; `submitted=true` is never set; the onsubmit handler is invoked with NO `values` argument (SPEC §41.14.3 mandates `fn(values)`). Compile exit 0; `node --check` pass; corroborating `W-DG-002` ×3 (per-field cells orphaned). NOT a Bug-51-A total omission — it's a half-wiring.

**Root cause (PA-verified, baseline `c4d5ef96`).** `compiler/src/type-system.ts:11113` `spliceFormFor` does `arr.splice(i, 1, synth.compoundDecl, synth.formElement)` — it inserts the synthesized compound state-decl IN PLACE in the MARKUP children array (where `<formFor>` lived inside `<program>`). `emit-logic.ts` (the pass emitting `_scrml_reactive_declare`/`_scrml_derived_declare`, validator runners, and the synth surface via `emit-synth-surface.ts`) only walks state-decls inside `${…}` logic blocks. A state-decl among markup children is seen only by the HTML/binding emitter (→ correct inputs) but never reaches state-declaration / validity-surface emission. `compiler/src/codegen/emit-form-for.ts` `buildCompoundStateDecl` also never sets `_cellKind:"compound-parent"` (grep count 0).

**Fix guidance.** Route the synthesized compound state-decl to the logic/state-declaration emission pass (so `emit-synth-surface` + `emit-validators` fire); tag `_cellKind:"compound-parent"` in `buildCompoundStateDecl`; pass the collected `values` cell + set `@cell.submitted=true` before invoking onsubmit (§41.14.3). **Acceptance gate:** happy-dom test asserting the `signup` compound cell is declared, `isValid` is false until validators pass, per-field errors render on invalid input, and submit passes `values` + sets `submitted`.

**Cross-refs.** SPEC §41.14 + §55; PRIMER §8. Bug-51 sibling class: feature wiring silently dropped by AST splice into the wrong emission pipeline.

### Bug 59 — `tableFor` per-row checkbox onchange references undefined free var `evt` (Bug-50-class residual) — `RESOLVED S140 (commit 6a0c3a63)` (was HIGH; PA-verified, happy-dom gate)

**Symptom.** With `<tableFor selectable=…>`, every per-row checkbox toggle throws `ReferenceError: evt is not defined` at runtime. The emitted per-row handler is `function(event) { if (evt !== null && evt !== undefined) { … } }` — the parameter is `event` but the body references `evt`. Compile exit 0; `node --check` pass. The MASTER checkbox is correct (`evt => {…}`) — only the per-row path is broken.

**Root cause (PA-verified, baseline `c4d5ef96`).** RESIDUAL of Bug 50 (RESOLVED S138 `c89f1176`), which patched `compiler/src/codegen/emit-event-wiring.ts` ONLY (delegated Case-B path). The per-row inline path is `compiler/src/codegen/emit-lift.js:531`: `lines.push(\`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${handlerExpr}; });\`)` — `handlerExpr` already passed through `rewritePresenceGuard` (which produces the `evt`-referencing guard) but is NOT routed through `rewriteExprArrowBody`. Sibling paths at 713/731/760 rebind to `event` / call `(event)`. Bug 50's regression test only exercises the delegated map, never the per-row inline site.

**Fix guidance.** Mirror the Bug-50 fix at `emit-lift.js:531` — route synth-fallback-string arrow handlers through `rewriteExprArrowBody`, skipping `rewritePresenceGuard` (or bind `evt`). **Acceptance gate:** happy-dom test dispatching a per-row checkbox `change` event, asserting no throw + `selectedIds` mutated.

**Cross-refs.** Bug 50 (RESOLVED S138 `c89f1176`, partial — emit-event-wiring.ts only). SPEC §41.16. Distinct from Bug 46.

### Bug 54 — `tableFor` `<column … :let={…}>` slot body silently dropped at the parse layer — `NEW S140 (reserved candidate, now filed); HIGH; DEFERRED`

**Symptom.** `<column field="role" :let={(user) => <span class="badge">${user.role}</span>}/>` — the `:let={…}` slot body (custom per-cell renderer) is SILENTLY DROPPED. The column falls through to the default `createTextNode(String((row.role) ?? ""))` render — no `<span>`/badge anywhere in the emitted JS. The only signal is advisory `W-ATTR-001: Attribute let= is not recognized on <column>`. Adopter's custom cell rendering vanishes.

**Root cause (agent-evidence, not PA-re-run).** `compiler/src/type-system.ts` captures `slotBody: colNode.children` but `children` is EMPTY — the `:let={…}` brace-block-with-markup attribute is consumed/dropped at the PARSE layer before the type-system sees it. The long-deferred "Bug 54 candidate — `:let=` attribute-registry wire-up" surfaced by the Bug 33 W-LINT-011 fix (S138 `5ec84589`, referenced at known-gaps line 984/986), now filed.

**Disposition — DEFERRED (not in the S140 dispatch wave).** Parse-layer fix (deeper than the surgical codegen fixes 57/59); requires `:let=` to survive as a recognized slot-binding attribute through block-splitter/parser into the type-system `slotBody`. **Acceptance gate when dispatched:** happy-dom test asserting the custom `:let` renderer markup appears in the cell. Cross-refs: SPEC §41.16.3; §16.6; Bug 33; Bug 46.

### Bug 19 — Shape 1 plain reactive cell per-access lifecycle tracker — `RESOLVED S134 (commit fd58893e)` (was HIGH; Q6 prerequisite — now closed)

**Fix (S134 `fd58893e`):** Option α per PA lean — extended `collectStructBindings` to recognize `state-decl` AST nodes (Sub-Pass 2.a; struct-typed Shape 1 case) + authored a NEW cell-value-typed tracker reusing the existing `checkLifecycleBindingAccess` from S131 HU-2 via two additive optional params (`initialStates: Map<string, "pre"|"post">` + `bindingSourceLabel: string`) (Sub-Pass 2.b; cell-value-typed Shape 1 case). Discrimination semantics (Sub-Pass 2.d) fully reused — `given X => {}` / `if (X is not) return` / `match X` / `transition(X)` all apply uniformly. Engine-cell carve-out (Sub-Pass 2.c) preserved — both new collectors skip `engineCellNames`. Two material walker changes: synthetic `{kind:"logic"}` block recursion → block-transparent (state-decl writes visible to subsequent siblings per §6.9 hoisting); `reactive-nested-assign` write node recognized as transition write. Tests: NEW `compiler/tests/unit/lifecycle-shape1-tracker.test.js` (+621L, 25 tests). Baseline 21,676 → 21,701 (+25, 0 fail). Pre-commit gate green on all 7 agent commits + the PA-authored landing.

**Composition with §6.8.3 — Q6-narrow LANDED S135 `2ffe4f6a`.** The tracker observed writes uniformly; Q6-narrow's reset-awareness extended the walker to recognize `reset(@cell)` and `reset(@cell.field)` calls and route through `classifyWriteAgainstSpec` to revert/maintain per-access state per §6.8.3 ratified semantic. Tracker 1 (cell-value Shape 1) + Tracker 2 (struct-typed Shape 1 field lifecycle) both implemented. +25 tests in `compiler/tests/unit/lifecycle-shape1-reset.test.js`; baseline 21,701 → 21,726; zero regressions. Two new heuristic limitations filed as LOW (see §3): deep multi-level reset on nested compound uses `fieldPath[0]`; cross-cell `default=@otherCell` classification is heuristic.

**Deferred items surfaced by B-prereq (NOT regressions; orthogonal limitations):**

1. **Parser tokenizer collapses whitespace around `.` tokens in lifecycle annotations** — `(.Draft to .Published)` becomes `(.Draft to.Published)` at AST level, defeating `findTopLevelArrow`'s space-bounded `to` detection. End-to-end variant-progression on Shape 1 cells with bare-dot annotations therefore goes unrecognized from source form (direct-AST tests work fine — mirrors existing fn-return test pattern). Fix paths: tokenizer-side whitespace preservation OR relax `findTopLevelArrow` to accept one-sided whitespace boundary.
2. **Top-level `let-decl` inside `${...}` blocks doesn't fire** — existing `collectStructBindings` only matches `let-decl` at FN-BODY scope. Pre-existing gap orthogonal to B-prereq; state-decls hoist (closed S134 by this dispatch); let-decls don't.
3. **Qualified-enum form `(Article.Draft to Article.Published)`** — variant-name stripping in `parseLifecycleReturnAnnotation` only removes the leading dot, leaving `Article.Draft` in `preVariantName`. Affects both fn-return and cell-value variant trackers symmetrically.

All three filed in `docs/changes/b-prereq-shape1-lifecycle-tracker-2026-05-26/progress.md` as known follow-ups. None gates Q6-narrow.

---

### Bug 19 (ORIGINAL ENTRY — S134 surfacing, preserved for forensic) — Shape 1 plain reactive cell per-access lifecycle tracker — `NEW S134; HIGH; impl missing` (Q6 prerequisite)

**Surfaced S134 Q6 dispatch Phase-0 STOP** (`docs/changes/q6-reset-lifecycle-2026-05-26/progress.md`). SPEC §14.12.3 + §14.12.10 (bullet 1) normatively promise per-access lifecycle transition tracking on **Shape 1 plain reactive cells** (`<state>: (not to User) = not`-style decls). The impl tracker today (`compiler/src/type-system.ts` `checkLifecycleFieldAccess`) covers struct-field positions (`User.passwordHash`-style) and fn-return positions (per §14.12.6 hybrid) only — `state-decl` (Shape 1 reactive cell decl) AST nodes are NOT in the tracker's scope.

**Empirically verified by Q6 Phase-0 reproducer:**

```scrml
<state>: (not to User) = not
@state.name   // SHOULD fire E-TYPE-001 per §14.12.10 normative bullet 1; ACTUAL: no fire
```

- **Severity rationale:** HIGH. SPEC §14.12 promises a tracker that doesn't exist for one of the six normatively-supported positions. Adopters writing `<state>: (not to T) = not` get the type-resolution + carve-out (correct) but no pre-transition access enforcement (silently wrong). Exactly the spec-vs-impl drift class Rule 4 is built to catch.
- **Workaround:** wrap state in a single-field struct: `type Holder:struct = { val: (not to User) }; <state>: Holder = { val: not }`. The struct-field tracker DOES fire correctly. Verbose but functional.
- **Reproducer (1-liner):** any `<x>: (A to B) = pre-typed-value` decl followed by `@x.field` access — should fire `E-TYPE-001`, doesn't.
- **Resolution path — B-prereq dispatch (queued S134; pre-Q6-impl):**
  - **Scope:** extend `collectStructBindings` (`type-system.ts:13698`) to recognize `state-decl` AST nodes — OR — author a parallel `state-decl` lifecycle tracker pass. Must cover BOTH the struct-typed Shape 1 case (`<u>: User = ...` with lifecycle on `User.passwordHash`) AND the cell-value-typed Shape 1 case (`<state>: (not to User) = not`) — Q6 Phase-0 verified `collectStructBindings`-extension alone won't cover both.
  - **Estimate:** ~20-30h compiler-source via `scrml-js-codegen-engineer` (isolation:worktree). Unblocks Q6-narrow impl (~10-20h).
  - **Tests:** +N regression-guard covering the 1-liner reproducer + sibling cases (assigning to pre-type satisfies; assigning to post-type triggers).
- **Composition:** §6.8.3 (the symmetric-reset interaction landed S134 SPEC-only) DEPENDS on this tracker — `reset(@cell)` can't revert per-access state on a tracker that doesn't observe per-access state for Shape 1. §6.8.3 stands as the design contract; impl waits for B-prereq.
- **Cross-refs:** SPEC §14.12.3 (extension scope table — Shape 1 listed YES), §14.12.10 (normative statement promising the fire), §6.8.3 (the dependent reset semantic landed S134), Q6 Phase-0 progress.md at `docs/changes/q6-reset-lifecycle-2026-05-26/progress.md`. Authority: const-deep-freeze HU/DD/debate arc S134.

---

### Bug 17 — E-META-001 only fires in compile-time meta blocks; runtime blocks silently accept JS-host globals — `RESOLVED S134 (commit 6c6c0073)` (was HIGH)

**Surfaced S133 Step A** (commit `80b168e6`) — after closing the META_BUILTINS membership divergence, the Step A agent surfaced a second-order architectural gap. SPEC §22.12 line 14687 reads as **categorical**:

> "JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) are NOT in the META_BUILTINS set and trigger `E-META-001`."

But pre-S134 meta-checker fired E-META-001 only inside **compile-time** meta blocks (`bodyUsesCompileTimeApis === true` from `reflect` / `emit` / `emit.raw` API references). A pure **runtime** meta block — `^{ const x = bun.eval(...); /* no reflect/emit */ }` — got early-returned in `checkMetaBlock` without consulting META_BUILTINS membership. The block emitted unchanged into the generated `_scrml_meta_effect` body. At JS runtime: `bun` is not a Bun-runtime global (only `Bun` capital-B is), so the call **silently failed with ReferenceError** at runtime.

- **Fix (S134 `6c6c0073`):** Approach A — new exported `checkMetaBlockForJsHostGlobals` walker (`compiler/src/meta-checker.ts` +160L) that runs UNCONDITIONALLY on every `^{}` body (compile-time AND runtime), parallel to `checkMetaBlock`. Scans against a new `JS_HOST_FORBIDDEN` Set (9 idents: `bun` / `Bun` / `process` / `console` / `setInterval` / `setTimeout` / `clearInterval` / `clearTimeout` / `fetch`). Respects local-decl shadowing, JS keywords, META_BUILTINS membership; recurses into nested `^{}`. Per-identifier hint messages (timer idents → `meta.interval`/`meta.timeout`; `fetch` → server-fn boundary; rest → generic 'not available'). Wired in `runMetaChecker` between `checkMetaBlock` and `checkReflectCalls` — preserves S133 Step A compile-time semantics verbatim. SPEC §22.11 catalog row broadened to enumerate the three E-META-001 fire conditions (disposition I; closes S114-introduced catalog drift). Regression tests at `compiler/tests/unit/meta-checker-bug17.test.js` (NEW, 33 tests = 1 set composition + 8 idents × runtime-fire + 2 bare-expr + 4 negative controls + 4 diagnostic-message + 1 reproducer end-to-end). Tests: 21,585 → 21,618 (+33, 0 fail). Full-suite gate green.
- **Corpus migration silent under prior gate:** 25 pre-existing tests in `meta-integration.test.js` (13 sites) + `runtime-meta-integration.test.js` (19 sites) used `console.log(...)` inside runtime `^{}` bodies as a "force runtime classification + observe pipeline emission" pattern. Post-fix, these correctly fire E-META-001. Migrated cleanly to `meta.emit(...)` (canonical scrml-native surface per §22.5.1) — semantically equivalent for the codegen-shape assertions these tests carry. Same migration shape adopters with similar test/sample code would need.
- **Open follow-ups (NOT regressions; separate concerns):**
  1. `meta.runtime=false` diagnostic at `meta-checker.ts:~1622` still uses pre-S134 phrasing — broaden for §22.5/§22.11 consistency. Polish.
  2. BS-path: `${ ^{} }` inside `<program>` markup interpolation produces only a `text` node (no meta block enters the pipeline). Latent issue separate from this fix. The canonical V5-strict shape (`p "test"\n^{ ... }\n`) surfaces the meta block correctly.
  3. `compileScrml({source, filePath})` vs `({inputFiles:[filePath]})` API surface divergence — the `source` path may take a shortcut bypassing the meta-checker pipeline. Surfaced for awareness.
- **Self-host parity DEFERRED** post-v1.0 per pa.md — `stdlib/compiler/meta-checker.scrml` + `compiler/self-host/meta-checker.scrml` mirrors carry pre-S134 META_BUILTINS as DATA only (no walker structure).
- **Original brief shape (preserved for forensic):**
  - Move the META_BUILTINS check OUTSIDE the `bodyUsesCompileTimeApis` early-return in `checkMetaBlock` (`compiler/src/meta-checker.ts`) — make it fire E-META-001 for runtime meta blocks too.
    - OR: add a sub-walker that runs unconditionally on every `^{...}` body and checks against META_BUILTINS / known-runtime-meta-API set.
    - Add regression-guard tests covering all 4 removed builtins × runtime context: `process` / `fetch` / `setInterval` / `setTimeout` / `Bun` / `console` (6 cases) inside `^{ ... }` with NO `reflect`/`emit`/`emit.raw` → assert E-META-001 fires.
    - Verify existing 14,566 baseline holds + add new tests (+6-8 logical assertions).
    - Per `feedback_restate_prerequisites_not_conclusions` — restate this entry's pre-dispatch sweep findings in the brief (corpus is empirically clean; no fallout expected).
  - **(c) / (d) REJECTED in deliberation:** (c) had no use case (the `meta.*` API covers runtime needs); (d) is a half-measure that doesn't close the silent-crash class.
- **Cross-refs:** Step A commit `80b168e6` agent report `OPEN follow-ups #1`; SPEC §22.12 line 14687 (the categorical statement); §22.5 + §22.5.1 (runtime meta surface); `compiler/src/meta-checker.ts` `checkMetaBlock` + early-return condition.
- **Not blocking adopters today** — pre-S133 adopters didn't write `bun.eval(...)` (the user-facing surface retired S130); post-S133 they're more likely to hit it via reflex. Watch adopter bug reports for first sighting; treat as load-bearing trigger if it shows up.

### Bug 9 — Compiler-managed async transitive coloring (A9-class) — `RESOLVED-L1+L2 S138 (commit a4a0f2d2)` (was HIGH; L3 transitive coloring still deferred)

**Fix (S138 `a4a0f2d2`):** L1 + L2 paired close per the 3-layer framing. The deferral was correct that L1-alone is a blind-patch; the L2 fix (Bug 55 below) closes the regression class and unblocks L1 to land safely.

**L1 fix:** `compiler/src/route-inference.ts:3018+` (+26L). Populate `functionName: record.fnNode.name ?? null` in routeMap.functions entries. `scheduling.ts:hasServerCallees` reads this to build `serverFnNames`; pre-fix the field was structurally declared in the route-map type but never set, so `serverFnNames` was ALWAYS empty.

**L2 fix:** see Bug 55 entry below — CPS planner shape gate forces statement-shape stmts to size-1 groups, avoiding the Promise.all-array-element invalid-JS shape that L1 alone unmasked.

**PA dual-verify R26 empirical sweep** (8 gauntlet sources):

| Source | Pre-fix | L1-only (regressed) | Combined L1+L2 |
|---|---|---|---|
| r24/dev-1-react | PASS | FAIL | PASS |
| r24/dev-2-go | PASS | PASS | PASS |
| r24/dev-3-svelte | PASS | FAIL | PASS |
| r24/dev-4-pascal | FAIL (pre-existing) | FAIL | FAIL (pre-existing unrelated) |
| r25/dev-1-react | PASS | FAIL | PASS |
| r25/dev-2-elixir | PASS | FAIL | PASS |
| r25/dev-3-svelte | PASS | FAIL | PASS |
| r25/dev-4-pascal | PASS | PASS | PASS |

7/8 PASS post-fix (baseline-equivalent). Combined fix verified.

**Regression test:** `compiler/tests/unit/compiler-managed-async-bug-9-and-55.test.js` (NEW; +370L; 8 tests across 8 sections): direct-caller emits async function / server call awaited / server-fn shim regression / pure-client regression / syntax-check invariant / guarded-expr single-stmt group / if-stmt single-stmt group / L3 tripwire (deferred). Plus 3 existing tests updated to accept the new async-prefix emission shape (r24-bug-31 §12, error-handler-arm-body §12, error-handler-terminator-arms §10).

**Per the 3-layer framing:**
- L1 (RESOLVED) — populate route.functionName
- L2 (Bug 55 RESOLVED — same commit) — CPS planner shape gate
- **L3 (STILL DEFERRED)** — transitive async coloring across client fn graphs (`fn A() { B() }` where B is a client fn that calls a server fn — A doesn't yet get async/await). §8 of the regression test is the L3 tripwire: asserts the CURRENT not-yet-async behavior; will fail when L3 lands, signaling time to update.

**Methodology bank:** pa.md S138 R26 doctrine PAID OFF — empirical sweep at L1-only state revealed the unmasked Bug 55 regression BEFORE landing. Had I committed L1 alone without empirical step, would have shipped 5-of-8-source regression. The original Bug 9 filing's 3-layer framing was structurally correct.

- **Cross-refs:** Bug 55 (the L2 sibling-fix); SPEC §1 Overview "compiler owns wiring"; SPEC §13.2 (async model); `scheduling.ts:hasServerCallees`; pa.md S138 R26 doctrine bidirectional.

---

### Bug 55 — CPS planner emits statement-shape stmts inside `Promise.all([...])` array literal — `RESOLVED S138 (commit a4a0f2d2)` (was NEW S138 HIGH; surfaced by Bug 9 L1 attempt; paired-closed with Bug 9 L1)

**Fix (S138 `a4a0f2d2`):** PA-direct surgical fix in `compiler/src/codegen/scheduling.ts` (+37L). Added `isStatementShapeStmt` guard at the group-building step that forces statement-shape stmts to size-1 groups — out of the Promise.all parallelization batch where they'd be invalid array-literal elements.

Six stmt kinds detected as statement-shape (emit multi-statement output incompatible with array-literal position):
- `guarded-expr` — failable call + error handler emits as `let X = await ...; if(...){...}`
- `if-stmt` — `if(cond){...} else {...}`
- `while-stmt` / `do-while-stmt` — loop statements
- `for-stmt` — loop statement
- `return-stmt` — `return X;`

**Pre-fix shape (the bug):**

```js
async function _scrml_submitNewTicket_43(values) {
  const [_scrml_tmp_45, _scrml_tmp_46] = await Promise.all([
    let _scrml__scrml_result_44 = await _scrml_fetch_createTicket_37(...);
    if (...) { ... },
    _scrml_reset("newTicketForm")
  ]);
}
```

The `let` and `if` statements aren't valid array-literal elements → SyntaxError. Pre-Bug-9-L1, the wrapping function wasn't async so parallelization didn't trigger and the broken shape stayed sequential (silent). Bug 9 L1 attempt unmasked it.

**Class scope:** Bug 9 L1 + Bug 55 paired-fix recovered 5 of 8 gauntlet sources that L1-alone had regressed. See Bug 9 entry above for the empirical R26 sweep table.

**Verification:** all 8 regression tests in `compiler-managed-async-bug-9-and-55.test.js` pass; 7/8 gauntlet sources PASS `node --check` post-fix (baseline-equivalent).

- **Cross-refs:** Bug 9 L1 (the sibling-fix; paired-closed same commit); pa.md S138 R26 doctrine bidirectional (forward + reverse direction sub-rules); SPEC §13.2 + §19.9.9 multi-batch CPS.

---

### Bug 10 — §29 vanilla-interop — SPEC vs implementation drift — `Nominal / framing-corrected S132`

**Originally (S110):** SPEC §2.1 + §29 asserted in the present tense that plain `.js`/`.html`/`.css` files "are valid alongside `.scrml` files; the compiler processes `.scrml` files and integrates or passes through the rest." Verified S110 the compiler did NOT do this — a pure-vanilla file is rejected (`Cannot find file or directory`); a mixed-project build compiles the `.scrml` and silently DROPS the vanilla files (not copied to dist). The bug was the FALSE present-tense CLAIM, not a missing feature.

- **Workaround:** keep all source in `.scrml`; for vanilla CSS use `#{}` blocks; for vanilla JS use `${}` blocks or `import` from `.js` modules (which IS live + load-bearing per §21).
- **Reproducer:** any project with a `.js` or `.html` file alongside `.scrml`.
- **Status:** **Nominal / framing-corrected S132.** Ratified option (c): the §2.1 false present-tense pass-through claim is REMOVED (reframed to explicit Nominal-future + S132 amendment note), and §29 is MARKED Nominal/spec-ahead-of-implementation (KEPT in SPEC, NOT retired — reaffirms S131 Q-W3-4 defer; re-trigger ≥2 adopter friction reports). NOT "RESOLVED-by-implementation": the feature is still NOT implemented; the spec now honestly says so. Vanilla-JS interop today is via §21 import (live + distinct from §29). The spec no longer makes a false claim, so this is no longer a spec-vs-impl drift — it is correctly-framed-as-Nominal.

---

### Bug 11 — 6nz-V `class:NAME` on for-lift reused DOM nodes — `RESOLVED S139 (commit f8a1f2ff)` (was HIGH)

**Root cause:** `compiler/src/runtime-template.js` `_scrml_reconcile_list` sets the GLOBAL `_scrml_tracking_paused = true` for its entire body (originally added to suppress Proxy `item.id` reads from leaking onto the outer effect's deps). That body calls `createFn(item, i)` — the per-item factory — which typically registers a per-item `_scrml_effect(() => { ..._scrml_reactive_get("sel")... })` closure. When those effects ran their initial `fn()` during creation, `_scrml_reactive_get("sel")` called `_scrml_track(_scrml_state, "sel")` — but `_scrml_track` short-circuits if `_scrml_tracking_paused` (line 2380). So the per-item effect's `ctx.deps` stayed EMPTY, registering zero subscribers. The effect then never re-fired on `@sel` writes; the create-time class state stayed frozen forever. CLASS-LEVEL: same shape for any nested `_scrml_effect` registered during reconcile — class:NAME, style:NAME, attribute interpolation, textContent interpolation — all silently lost reactivity.

**Fix (S139 `f8a1f2ff`):** in both `_scrml_effect` and `_scrml_effect_static`, bracket the inner `fn()` call with save+null+restore of `_scrml_tracking_paused`. Each `_scrml_effect` owns its own tracking scope; outer pause should not bleed into it. `_scrml_untracked` (the user-facing pause primitive) still works — it saves+restores around its own body, and nested effects inside still register their own subscribers (the correct semantic).

- **Files touched:** `compiler/src/runtime-template.js` (~6 LOC × 2 sites = ~12 LOC). 0 other files.
- **Regression test:** `compiler/tests/unit/bug-11-class-binding-in-for-lift-reconcile.test.js` (NEW; +252L; 9 tests across 3 §-sections — §1 Bug 11 reproducer 4-step cycle; §2 class-level coverage of textContent/attribute-interpolation in factories; §3 tracking-pause-restore semantic preserved for `_scrml_untracked`).
- **R26 empirical verification:** compiled 6nz's exact reproducer (`2026-05-24-0641-bug-v-class-binding-on-for-lift-not-reactive.scrml`) on the post-fix baseline; happy-dom drive of `@sel = 0 → 1 → 2 → 0` advances highlight `alpha → bravo → charlie → alpha` (PRE-FIX: highlight stayed on alpha; POST-FIX: highlight advances). Per pa.md S138 R26 doctrine (forward direction) — empirical PASS confirmed before claim-CLOSED.
- **Reproducer:** filed by 6nz S126; `class:active=@item.selected` inside `for (let item of @items) { lift <li class:active=...>...</li> }`. Original sidecar at `handOffs/incoming/read/2026-05-24-0641-bug-v-class-binding-on-for-lift-not-reactive.scrml`.
- **Cross-refs:** 6nz inbox `2026-05-24-0641-6nz-to-scrmlTS-bugs-v-w-from-playground-nine.md` (filing) + `2026-05-24-0800-6nz-to-scrmlTS-bug-w-VERIFIED-closed-bug-v-GENUINE.md` (post-Bug-W confirmation + the precise diagnostic that identified the lift/reconcile runtime path as the load-bearing region — 6nz's hypothesis was correct).
- **Notice to 6nz:** outbound inbox message dispatched to `handOffs/incoming/` confirming RESOLVED.

---

### Bug 12 — E-FN-003 false-positive on attributed-markup-return inside `fn` — `RESOLVED S133 (commit dbef4f4d)` (was HIGH)

A `fn` that returned (or `let`-bound) markup carrying ANY attribute (`class`, `id`, `href`, …) false-fired `E-FN-003: fn body writes to '<attr>'`. The fn-purity write-check `checkOuterScopeMutation` (`compiler/src/type-system.ts` ~12780-12813) ran a text-heuristic `ASSIGN_RE` regex over the SERIALIZED statement text (`nodeText` → `emitStringFromTree`, which re-serializes returned markup including attributes); markup `name="…"` / `name={…}` was indistinguishable from an assignment LHS to that regex. Blocked the canonical "fn returns markup" idiom (PRIMER §6.4 sub-shape 4 / kickstarter §11.11).

- **Fix (S133 `dbef4f4d`):** skip the text heuristic when the statement's serialized text starts with `<` (markup-shaped — `kind:"escape-hatch"` raw markup per `shouldSkipExprParse` at `ast-builder.js:122`). The structured assignment-kind path (`type-system.ts:12785-12798`) and the `@cell`-mutation path (`13013-13064`) are untouched — real purity enforcement preserved. Approach B (predicate-based skip) chosen over Approach A (excise serialized markup substrings) because markup-in-expression-position is stored as escape-hatch raw text, not as structured `kind:"markup"` AST. Regression tests (`compiler/tests/unit/fn-constraints.test.js` §8b — 4 tests incl. negative control asserting `counter = counter + 1` alongside attributed markup STILL fires on `counter`, not `class`). Tests: 21,584 → 21,588 (+4, 0 fail).
- **Known structural gap (separate enhancement):** outer-scope writes embedded inside markup interpolations (e.g. `<a href={counter = counter + 1}>`) are not detected pre- or post-fix; the markup escape-hatch isn't structurally parsed. Pre-fix, the regex's first match captured the attribute name (false-attributing the write); post-fix, the heuristic is skipped on markup-shaped statements. The reactive `@-cell` write path at `13013-13064` similarly doesn't reach into markup interpolations. To close this, the markup escape-hatch ExprNode would need structural parsing — separate enhancement, NOT a regression from this fix.

---

### Bug 28 — `or` / `and` boolean operators not lowered to `||` / `&&` in derived-cell codegen — `RESOLVED S136 (commit 89008e97)` (was HIGH; R24)

**Fix (S136 `89008e97`):** two-site landing per agent triage finding (a76e86b1c2b94ea00). The bug surface was two-sided:
- **AST path** (`compiler/src/expression-parser.ts:preprocessForAcorn` +35L) — acorn doesn't know `or`/`and` are operators; without rewrite, the AST emission path produced no `BinaryExpr` for word-form. Added `or`→`||` / `and`→`&&` rewrite, fenced via `rewriteCodeSegments` (matches the `rewriteNotKeyword` precedent above it).
- **String-rewrite fallback path** (`compiler/src/codegen/rewrite.ts` +47L) — when `rewriteReactiveRefsAST` bails (any expression containing `is` / `match` / `?{` / `::`), the regex-based passes in codegen/rewrite.ts run. There was NO pass for `or`/`and` lowering — they leaked verbatim into emitted JS. New `rewriteBooleanKeywords()` registered as Pass 2.5 in BOTH `clientPasses` and `serverPasses` after `rewriteNotKeyword`.

Pattern: lookbehind `(?<![A-Za-z0-9_$@.])`, lookahead `(?![A-Za-z0-9_$])` — excludes identifier-substring matches (`orange`/`xor`/`vendor`/`andrew`), member-access (`obj.or`), sigil-prefixed (`@or`).

Regression test: `compiler/tests/unit/boolean-keywords-lowering.test.js` (NEW; +372L; 42 tests covering single-op, mixed-precedence, filter-callback shape from R24 reproducer, + negative controls). Reproducer verified: dev-1-react.scrml `or`/`and` raw before → 0 raw after; 27 properly lowered `||`/`&&` sites in compiled client.js.

Tests: 14,743 → 14,785 pre-commit (+42, 0 fail, 88 skip, 1 todo) · 21,762 → 21,804 full suite (+42, 0 fail, 170 skip, 1 todo).

**Spec status (R24-BUG-1 Rule-4 finding — RESOLVED in S136 SPEC amendment):** the brief asserted SPEC §45 + §7 canonicalize word-form `or`/`and`; agent's cross-check found SPEC was actually SILENT on word-form (SPEC §45 covers `==`/`!=` only; `BinaryExpr.op` AST union lists `||`/`&&` only; SPEC code blocks use `&&`/`||` exclusively; `or`/`and` appear ~1076× in SPEC but all English prose). User direction (S136 — option (i)): RATIFY word-form as canonical alongside `||`/`&&`. SPEC + PRIMER + kickstarter normative text added in the follow-up commit. Adopter signal (2/4 R24 devs reached for word-form instinctively) + zero-friction fix (matches `not` rewrite precedent) drove the ratification.

**Cross-refs:** R24-BUG-1 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md` § "Compiler bugs surfaced"; agent dispatch brief at `docs/changes/r24-bug-1-or-and-codegen-lowering-2026-05-27/BRIEF.md` (S136 DD-Rec-14 archival).

**Known limitations (accepted trade-offs):**
- `obj . or` (whitespace-separated property access) would still rewrite — same accepted trade-off as the `not` precedent (`obj . not` also breaks). Not commonly written; matches accepted precedent.
- `let and = 5` / `let or = 5` (valid JS identifier renamed to operator-keyword) would break — same accepted trade-off as the `not` precedent. Zero usages in current corpus.

These can be hardened later with extended lookbehind if adopters report; not warranted preemptively.

---

### Bug 29 — `!{}` handler `{ return }` arm codegen emits `_result = return;` (invalid JS) — `RESOLVED S136 (commit c7e81962); broader case Bug 38 RESOLVED S137 (commit 933d1ad3)` (was HIGH; R24)

**S136 partial fix (commit `c7e81962`):** terminating-statement detection added to `compiler/src/codegen/emit-logic.ts` `emitArmAssign` closure (case `"guarded-expr":`, lines 2479-2491). Two local helpers: `splitTopLevelStmts` (depth-tracked `;`-split mirroring `rewriteBlockBody`'s separator pass) + `isTerminatorStmt` (regex `/^(?:return|throw|break|continue)(?:[\s;]|$)/`). When arm body's last statement matches a terminator, emit each statement directly (no `_result = ...` wrap). Side-effect + terminator bodies (`{ @x = "y"; return }`) emit both as a sequence — reactive_set fires BEFORE return. +18 regression tests in `compiler/tests/unit/error-handler-terminator-arms.test.js`. Tests 21,762 → 21,780.

**R25 finding — BROADER CASE STILL OPEN as Bug 38:** R25 confirmed via 4/4 dev exposure + overseer verification that the `!{}` arm-body codegen failure is DEEPER than the bare-`return` shape Bug 29 narrowly addressed. Multi-line arm bodies with reactive writes and no-op-return tail STILL fail to produce arm codegen even after S136 fix. The `const r = call() !{...}` workaround pattern suppresses E-ERROR-002 but per overseer-2 + overseer-3 does NOT produce arm codegen. Single-line collapse `!{ | .X -> @y = "z" }` ALSO fails per overseer-3 fresh compile. The deeper bug appears to be parser-vs-codegen split: the `!{` token kicks the parser into "statement boundary not detected" mode regardless of arm-body shape. See Bug 38.

**Bug 29's narrow case is FIXED;** the broader R24-Bug-29-family is filed as Bug 38 for separate dispatch.

- **Reproducer (Bug 29 narrow):** `function load() { fetchItems() !{ | .Network msg -> { return } } }` — pre-S136 emitted `let _result = return;`; post-S136 `c7e81962` emits the body directly.
- **Reproducer (Bug 38 broader):** see Bug 38 entry below for R25 4/4-dev cross-confirmed scope.
- **Spec reference:** SPEC §19.4 (inline handler contract); SPEC §19.5 (call-site `!{}`).
- **Cross-refs:** R24-BUG-2 (scrml-support/docs/gauntlets/gauntlet-r24-report.md) → fix landing `c7e81962`; R25-Bug-38 (scrml-support/docs/gauntlets/gauntlet-r25-report.md § "Compiler bugs surfaced" → Bug 38) → broader case OPEN.

---

### Bug 36 — `! ErrorType` bare-form parse-gap (SPEC §41.14) caused server-fn body silent drop — `RESOLVED S136 (commit e1269844)` (was CRITICAL; R25; 3/4 devs)

**Fix (S136 `e1269844`):** three-site parser fix. Root cause was NOT `?{}` SQL as the brief hypothesized — the SQL correlation was incidental (all R25-affected functions just happened to contain SQL). Actual root: the parser only recognized `! -> ErrorType` arrow form (SPEC §19.4.1 normative grammar); the bare `! ErrorType` form (SPEC §41.14 normative examples; 4/4 R25 dev instinct from canon) was unrecognized → parser fall-through → body-collection failure → BS "statement boundary not detected" warning → silent body drop → empty server-fn handlers.

THREE-SITE FIX:
- `compiler/src/ast-builder.js` function-decl handler (~L8552, +37/-4): post-`!`, accept bare `IDENT/KEYWORD` + function-decl-head continuation (`{` body / `route` / `method` / `.idempotent` / `:` / `->` / `;` / EOF) as errorType
- `compiler/src/ast-builder.js` fn-shorthand handler (~L8775): same fix mirrored
- `compiler/native-parser/parse-stmt.js` `parseScrmlFunctionDecl` (~L1842, +24/-2): parity fix

Disambiguation guard refined from "IDENT then LBrace only" (too strict — broke `! ErrorType route="/api" {body}`) to the broader continuation-set check.

REGRESSION TEST — `compiler/tests/unit/r25-bug-36-bare-error-type.test.js` +358L (NEW; 12 tests across 8 §-sections): bare `! ErrorType` server-fn / fn-shorthand / with route= / with method= / with .idempotent / arrow-form regression-guard / mixed bare-and-arrow / disambiguation cases.

REPRODUCER VERIFICATION:
- dev-1-react server-fn handlers (createCard/moveCard/archiveCard): empty BEFORE → populated AFTER (SQL queries + if + fail + run + broadcast + return all present)
- R25 statement-boundary warnings: dev-1 7→4, dev-2 ?→3 (residual = Bug 38 distinct), dev-3 4→0 FULLY CLOSED, dev-4 ?→0 FULLY CLOSED

Tests: 14,746 pass / 9 fail (pre-fix; 9 = my new regression test's pre-fix expects) → 14,755 pass / 0 fail (post-fix). 0 regressions in broader suite.

**SIDE EFFECT — Bug 39 also RESOLVED.** The orphan `CreateError` / `MoveError` / `ArchiveError` IDENTs from the failed parse were being treated as reactive-display expressions on a `_scrml_logic_N` slot (the phantom `el.textContent = CreateError` wiring). With Bug 36 fixed, the IDENTs are properly absorbed as errorType annotations and the phantom wiring vanishes. All 4 R25 devs: 0 phantom wirings post-fix.

**SPEC self-inconsistency CLOSED S137:** §19.4.1 grammar amendment landed — `failable-fn ::= 'function' identifier '(' param-list ')' '!' (('->' error-type) | error-type)? block`. Bare form ratified as equivalent to arrow form. §19.4.4 normative statements updated to enumerate both forms. Closes the deferred follow-up surfaced by R25-Bug-36 dispatch agent's investigation (commit `e1269844`).

**PA brief hypothesis correction:** the brief named `?{}` as suspected root cause and `emit-server.ts` / `emit-logic.ts` as suspect files. Agent's grep-driven triage ("statement boundary not detected" string → expression-parser.ts:1975 emit site → debug trace through safeParseExprToNode → parseLogicBody → orphan IDENT as bare-expr) found the bug in the PARSER, not codegen. Same shape as R24-BUG-2 dispatch's correction — brief heuristics drift; grep on smoking-gun strings is the load-bearing tool. Banking.

- **Cross-refs:** Bug 36 in `scrml-support/docs/gauntlets/gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-36-server-fn-body-drop-2026-05-27/BRIEF.md`; SPEC §41.14 bare-form examples; SPEC §19.4.1 grammar (needs amendment).

---

### Bug 37 — arrow function in `<each in=...>` attribute truncates at codegen — `RESOLVED S137 (commit 1ce963d0)` (was HIGH; R25; minimally reproduced)

Inline arrow-function predicate inside an `<each>` `in=` attribute was severed at codegen. `<each in=@x.filter(c => c.foo == 1)>` emitted `_scrml_reactive_get("x").filter(c =;` — the `=>` was severed, predicate body dropped, closing paren replaced with `;`. Compile exited 0 (silent miscompile); `node --check` FAILED with `SyntaxError: Unexpected token ';'`. Minimally reproduced by overseer-4 in R25.

**Fix (S137 `1ce963d0`):** Shape A (accept inline arrow). Root cause was NOT in block-splitter (PA brief hypothesized BS-level; BS `scanAttributes` already correctly tracked paren+bracket depth — pre-S136 parenDepth + S137 Bug 40 bracketDepth). Bug was downstream in `ast-builder.js` `_findEachOpenerEnd` (line 11119), which tracked ONLY brace+quote depth (NOT paren/bracket). The `>` inside `=>` sat at depth-0 (braces); the finder returned its index; opener was sliced at `<each in=@items.filter(c =`. Fix: extend `_findEachOpenerEnd` with `parenDepth` + `bracketDepth` tracking; opener `>` returned only when ALL FOUR depth counters are zero. +19/-2L single-file change.

**Latent sibling-finder bug class** surfaced by agent (filed as Bug 48): `_findMatchOpenerEnd` x2 (lines 10953 + 11871) + `_findOpenerEnd` (line 11562, machine/engine) all have same braces+quotes-only tracking. Not currently fired by adopter patterns (canonical `<match>`/`<engine>` openers don't carry inline arrows today).

**Regression test:** `compiler/tests/unit/each-in-arrow-r25-bug-37.test.js` +392L (NEW; 12 tests across 12 sections): minimal repro · multi-line arrow body · chained .filter().map() · `<each of=N.reduce(...)>` · workaround derived-cell still works · sibling `<button onclick={...}>` braced position works · composition with Bug 40 `:`-shorthand · array-index method-chain · nested parens. Tests: subset baseline 14,871 → 14,883 (+12, 0 fail).

- **Reproducer verification:**
  - BEFORE (HEAD `50d38095`): `const _items = _scrml_reactive_get("items").filter(c =;` — `node --check`: `SyntaxError`
  - AFTER (HEAD `1ce963d0`): `const _items = _scrml_reactive_get("items").filter(c => c.foo == 1);` — `node --check`: PASS
  - W-EACH-KEY-001 lint message also flipped from embedding the truncated opener to the full opener.
- **Spec reference:** SPEC §17.7 `<each in=expr>` — attribute-position expression now parses + emits per ordinary expression rules.
- **Cross-refs:** Bug 37 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-37-each-arrow-truncation-2026-05-27/BRIEF.md`; Bug 40 `50d38095` (adjacent BS-level fix touching `scanAttributes` — DIFFERENT function); Bug 48 latent sibling-finder class.

---

### Bug 38 — `!{}` arm body codegen failure (R24 Bug 29 family, DEEPER; distinct from Bug 36) — `RESOLVED S137 (commit 933d1ad3)` (was HIGH; R25; 4/4 devs)

Bug 29's narrow `{ return }` case was RESOLVED in S136 commit `c7e81962`. Bug 36 (RESOLVED S136 `e1269844`) was investigated for shared root by the R25-Bug-36 dispatch agent and CONFIRMED DISTINCT — Bug 36 was a function-decl-head parse-gap; Bug 38 was the call-site `!{}` handler emission gap in codegen. Different code path; not closed as Bug 36 side-effect.

R25 confirmed via 4/4 dev exposure + overseer verification: multi-line arm bodies, single-line collapsed arm bodies, and the `const r = call() !{...}` "workaround" all FAILED to produce arm codegen.

**Fix (S137 `933d1ad3`):** PA brief hypothesis confirmed correct (`emit-logic.ts` case `"guarded-expr"` `emitArmAssign` closure was the load-bearing site). The R24-BUG-2 (S136 `c7e81962`) extension closed the terminator-tail narrow case but didn't generalize — `emitArmAssign`'s "multi-line vs single-line" discriminator (`trimmed.includes("\n")`) was the right CONCEPT but wrong PROXY for "statement-shape vs value-shape" arm bodies. `rewriteBlockBody` joins multi-statement reactive-write bodies with `"; "` (no newline), so `{ @x = "v"; @y = 0 }` arm bodies arrived at `emitArmAssign` as a single-line string of two `;`-separated `_scrml_reactive_set(...)` calls and fell into the wrong wrap branch.

Two new branches added to `emitArmAssign`, ordered after R24-BUG-2's terminator-tail branch:
1. `stmts.length > 1` (multi-statement body): emit each stmt as bare indented statement; no `_result =` wrap.
2. `stmts.length === 1 && isStatementShapeStmt(stmts[0])` (single-stmt side-effect call): emit bare. NEW helper `isStatementShapeStmt` detects six known statement-emitting prefixes (`_scrml_reactive_set(`, `_scrml_engine_*(`, `_scrml_navigate(`, `_scrml_register_cleanup(`, `_scrml_effect(`, `_scrml_init_set(`).

Negative-control (value-producing arm bodies like `| _ -> "fallback"` / `| _ -> computeFallback(e)`) STILL wraps via the existing final `${resultVar} = ${bare};` fallthrough — verified by existing R24-BUG-2 §8 negative-control tests.

**Regression test:** `compiler/tests/unit/error-handler-arm-body-emission.test.js` +490L (NEW; 18 tests across §1-§12). R24-BUG-2 §7 expectations INVERTED — the pre-fix §7 tests were locking the BUG SHAPE (asserting the corrupt wrap); inverted to assert ABSENCE of corrupt wrap + PRESENCE of bare statements. Strictly stronger assertions. R24-BUG-2 §1-§6 + §8-§11 unchanged + still green.

**Reproducer verification (3 shapes):**
- Multi-line `{ @x = "missing"; @y = 0 }`: BEFORE `_scrml_result_5 = _scrml_reactive_set(...); _scrml_reactive_set(...);` → AFTER two clean indented stmts, no wrap. `node --check` EXIT=0; statement-boundary warning count = 0.
- Single-line `| ::Variant -> @x = 1`: BEFORE `_scrml_result_N = _scrml_reactive_set("x", 1);` → AFTER `_scrml_reactive_set("x", 1);`.
- `let r = ... !{...}` workaround: arm body emits clean bare stmts; trailing `var r = _result_N;` still emits + `r` binds to the original call's tagged-object.

- **Spec reference:** SPEC §19.5 call-site `!{}`; PRIMER §6 canonical multi-line shape.
- **Cross-refs:** Bug 38 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-38-guarded-expr-arm-body-2026-05-27/BRIEF.md`; R24 Bug 29 narrow RESOLVED `c7e81962`; Bug 36 RESOLVED `e1269844` (distinct root, confirmed); R24-BUG-2 dispatch BRIEF.md.

---

### Bug 39 — phantom enum-object → `el.textContent` wiring (no source backing) — `RESOLVED-AS-SIDE-EFFECT-OF-BUG-36 S136 (commit e1269844)` (was HIGH; R25; 2/4 devs independent)

**RESOLVED via Bug 36 fix.** The phantom `el.textContent = CreateError; el.textContent = MoveError; el.textContent = ArchiveError;` wiring was a SIDE EFFECT of Bug 36's parse failure — when the `! ErrorType` bare form failed to parse, the IDENT (`CreateError` etc.) was orphaned and collected as a bare-expr by `parseRecursiveBody`. The bare-expr was then auto-wired as a reactive-display expression on a `_scrml_logic_N` slot. With Bug 36 fixed, the IDENTs are properly absorbed as errorType annotations and the phantom wiring vanishes by construction.

**Reproducer-verification:** all 4 R25 devs: 0 phantom `el.textContent = <EnumType>` wirings in post-fix compiled output. Confirmed via grep on /tmp/r25-bug-36-verify/*.client.js.

- **Original symptom:** emitted client.js contained `el.textContent = CreateError; el.textContent = MoveError; el.textContent = ArchiveError;` on a `_scrml_logic_N` slot. Last-write-wins → DOM showed `[object Object]`.
- **Original cross-dev evidence:** dev-1-react + dev-2-elixir, independent sources, same compiler pattern (first 3 declared error-enum types).
- **Fix path:** Bug 36 RESOLVED → orphan-IDENT-as-bare-expr no longer occurs → phantom wiring no longer emitted.
- **Cross-refs:** Bug 39 in `gauntlet-r25-report.md`; resolution commit `e1269844` (Bug 36 fix); resolution surfaced in the R25-Bug-36 dispatch agent's final report (sister-finding to Bug 36 root-cause analysis).

---

### Bug 40 — `:`-shorthand inside `<each>` item body silently emits empty fragment — `RESOLVED S137 (commit 50d38095)` (was HIGH; R25)

`<each in=@list><span : @.field><empty>...</></each>` emitted an item factory that returned an empty `documentFragment.firstChild` (always `null`). No `span` element, no text content. Confirmed for `<empty : "string literal">` (Svelte dev-3, overseer-3). Affected dev-1's "all 7 `<each>` item factory bodies empty" finding (dev-1 also used `<li class="card" : @.title>` `:`-shorthand).

**Fix (S137 `50d38095`):** ROOT CAUSE WAS UPSTREAM OF EXPECTED. PA brief hypothesized a codegen bug in `emit-each.ts`; actual bug was a SPEC §4.14 BS-level compliance gap in `block-splitter.js` `scanAttributes` — the post-attribute `:` token was not recognized, so `<li : @.name>` was treated as an unclosed `<li>` opener; E-CTX-003 fired; opener was silently dropped per the existing `_subErrors`-discard convention in ast-builder.js:11307-11312. emit-each.ts then walked empty templateChildren and emitted an empty per-item factory body — the visible codegen failure was a downstream symptom, not the cause.

Three-file fix coupled with regression tests:
- `compiler/src/block-splitter.js` +168/-2L: NEW SPEC §4.14 BS-level `:`-shorthand body recognition in `scanAttributes`. Two emit-stamps (markup-shorthand + state-shorthand) + bracketDepth tracking + predecessor whitespace requirement (so `<Tag:expr>` no-space form correctly rejects). Caller paths (markup + state) emit leaf blocks with `closerForm:"shorthand"` + `shorthandBodyRaw` carrying the body text past the `:`.
- `compiler/src/ast-builder.js` +42/-2L: markup dispatch slices `block.raw` at the introducer for `tokenizeAttributes`; captures `shorthandBodyRaw` on the AST node.
- `compiler/src/codegen/emit-each.ts` +40/-3L: `renderTemplateChildToJs` prefers AST `shorthandBodyRaw` over the (now-empty) templateChildren walk. `renderEmptyChildToJs` handles `<empty : "literal">` shorthand by wiring the body as a textNode directly (no createElement — `<empty>` is a structural sub-element).
- `compiler/tests/unit/p3-follow-no-isComponent-routing.test.js` +1/-1L: block-splitter.js code-budget rebump 23 → 26 (3 new write-side stamps; in-file comment updated).

**`<empty : "literal">` sub-case** (overseer-3's separately-filed sub-finding) was the SAME root cause and SAME fix — BS-level recognition closes it by construction. 1 dedicated test (§8); existing each-block.test.js §5 empty-state coverage continues green.

**Regression test:** `compiler/tests/unit/each-colon-shorthand-r25-bug-40.test.js` +551L (NEW; 20 tests across 14 sections): minimal repro · `:`-shorthand with attribute (dev-1 `<li class="card" : @.title>` shape) · `<each of=N>` count form · multi-element bodies · positive controls (bare-body `${...}` regression-guard, `<empty>` bare-body) · `<empty : "literal">` fix · `as name` alias compose · `key=` inference compose. Tests: subset baseline 14,851 → 14,871 (+20, 0 fail).

**Reproducer verification:**
- BEFORE (HEAD `ebeba766`): item factory `(_scrml_each_item, _scrml_each_idx) => { const _itemFrag = ...; return _itemFrag.firstChild; }` (returns null — empty fragment)
- AFTER (HEAD `50d38095`): `... const _scrml_el_1 = document.createElement("li"); _scrml_el_1.textContent = String(_scrml_each_item.name); _itemFrag.appendChild(_scrml_el_1); return _itemFrag.firstChild;`
- `node --check` on emitted JS: PARSE OK.

**Pre-existing diagnostic-class drift (deferred):** `<Tag:expr>` (no whitespace before `:`) currently fires E-CTX-003 rather than the SPEC-prescribed E-PARSE-001 (§4.14). Out-of-scope; small-future ticket if friction surfaces.

- **Spec reference:** SPEC §4.14 `:`-shorthand body grammar (BS-level recognition was the gap); SPEC §17.7 iteration; PRIMER §6.3 canonical `<each>` shapes.
- **Cross-refs:** Bug 40 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-40-each-colon-shorthand-2026-05-27/BRIEF.md`.

---

### Bug 41 — `<schema>` block content leaks into HTML body as raw visible text — `RESOLVED S137 (commit ebeba766)` (was HIGH; R25)

dev-2-elixir's HTML output contained the raw text content of the `<schema>` block (`cards { ... } activity_log { ... }`) as visible body content. Schema content belongs to the DDL / migration artifact path (schemaFor walker, migration diff); NEVER the HTML render-tree.

**Fix (S137 `ebeba766`):** Agent's grep-driven triage (S136 banked methodology) NARROWED the brief's hypothesis. Brief speculated "exclude <schema> (and probably <channel>, <auth>, etc. — full structural-element registry exclusion)"; actual fix is surgical TWO-element exclusion. Sibling structural-elements cross-verified:

| Element | Status |
|---|---|
| `<schema>` | LEAKING — FIXED this dispatch |
| `<seeds>` | same state-block path; pre-emptively excluded (defense-in-depth; no live repro) |
| `<engine>` | CLEAN — routes to engine-decl AST kind upstream |
| `<machine>` | CLEAN — normalized to engine before state-kind branch |
| `<db>` | CLEAN — body is canonically `${...}` logic context |
| `<channel>` | CLEAN — explicit tag handler at emit-html.ts:1078 |
| `<auth>` | CLEAN — sub-page role-gate; composite emission |
| `<errors>` | CLEAN — explicit tag handler at emit-html.ts:750 |
| `<onTransition>`/`<onTimeout>`/`<onIdle>` | engine state-children — not document-root structural at HTML emit time |

Brief's broader-list speculation would have been over-fix. Banked: trust grep over hypothesis (S136 lesson held).

`compiler/src/codegen/emit-html.ts` +28L: NEW constant `SERVER_ONLY_STATE_TYPES = new Set(["schema", "seeds"])` + early-return guard in `node.kind === "state"` branch reading `node.stateType`. Without the guard, the state-kind branch unconditionally walked children → text-kind branch dumped raw DDL identifiers into rendered HTML. Comment block above the constant enumerates why `<db>`/`<engine>`/`<machine>` are NOT in the set (route through other AST kinds before this branch).

**Regression test:** `compiler/tests/unit/schema-html-leak-r25-bug-41.test.js` +451L (NEW; 18 tests across §1-§8): minimal repro (DDL identifiers absent from emitted HTML) · multi-table schema · positional invariants (`<schema>` before vs after `<page>`) · multi-page exclusion · positive controls (`<page>` body text PRESENT — regression-guard against accidental over-exclusion) · sibling-element controls (`<engine>` / `<db>` still handled via their own paths) · `<seeds>` defense-in-depth.

**Reproducer verification:**
- BEFORE (HEAD `933d1ad3`): emitted HTML body contains `cards { id: integer primary key, title: text not null }` as visible prose alongside `<h1>Hello World</h1>`.
- AFTER (HEAD `ebeba766`): emitted HTML body contains ONLY `<h1>Hello World</h1>`.
- Grep on DDL identifiers (`primary key`, `text not null`, `cards {`) — ZERO matches in HTML AND zero in client.js. Schema DDL emission via schemaFor / migration path unaffected.

- **Spec reference:** SPEC §11 schema declarations; SPEC §39 schema + migrations.
- **Cross-refs:** Bug 41 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-41-schema-html-leak-2026-05-27/BRIEF.md`.

---

### R24-BUG-4 — `<match>` block-form `</>` closer rejected with E-CTX-001 — `RESOLVED S138 (commit adc0a70f)` (was HIGH; class-level fix also closes same-shape `<each>` `</>` gap)

**Fix (S138 `adc0a70f`):** CLASS-LEVEL — `compiler/src/block-splitter.js` STRUCTURAL_RAW_BODY_ELEMENTS depth-tracker replaced with generic tag-stack scanner. Per SPEC §4.4.2 — `</>` SHALL close the innermost open tag, no exceptions. Closes BOTH `<match>` AND `<each>` `</>` closer support in one fix.

New `findStructuralBodyEnd` helper (+479/-58L in block-splitter.js): skip-zone helpers (`${...}` interp / `"..."` attr strings / HTML comments / scrml comments) + generic tag-stack (push on non-self-close non-`:`-shorthand opener; pop on `</tagname>`/`</>`; outer-closer when stack empties). Same-kind nesting (HU-1 Q6 nested-iteration) preserved by construction. closerForm: "explicit" / "generic" / "inferred". E-CTX-001 message updated to name both legal closer forms.

**Regression test:** `compiler/tests/unit/structural-body-closer-r24-bug-4.test.js` (NEW; +583L; 23 tests across 8 sections): match/each `</>` close matrix (`:`-shorthand / bare-body / self-closing / mixed) + nested-same-kind + skip-zone cases (markup-interp / attr strings with `<` / HTML comments) + regression-guard (existing explicit closers + genuinely-unclosed still fires E-CTX-001).

**R26 EMPIRICAL VERIFICATION** (PA-side dual-verify + agent's report):

| Source | Pre-fix | Post-fix |
|---|---|---|
| Minimal match repro with `</>` | E-CTX-001 + E-CTX-003 cascade | COMPILE CLEAN |
| Minimal each repro with `</>` | E-CTX-003 cascade | COMPILE CLEAN + node --check exit 0 |
| dev-3-svelte R24 (original report source) | E-CTX-001 + E-CTX-003 cascade | match-block body PARSES end-to-end; closer bugs CLEARED |
| dev-1-react / dev-2-go / dev-4-pascal R24 | baseline (pre-existing other-bug state) | UNCHANGED (no regressions) |

**Class-close evidence:** the `<each>` reproducer compiles fully clean end-to-end including `node --check` — the downstream `<each>` codegen (Iteration Landing 1, S131) is solid. The `<match>` reproducer compiles clean BS-level but exposes downstream Phase 3 codegen gaps (see Bug 52 + Bug 53 below).

**SCOPE EXPANSION SURFACED BY R26 (Bug 52 + Bug 53 NEW HIGH):** R26 verification on dev-3-svelte revealed THREE pre-existing Phase 3 codegen errors previously MASKED by the BS-level closer rejection (E-ATTR-001 `renders=Fallback`, E-VARIANT-AMBIGUOUS `.All`, E-SCOPE-001 `@newTicketForm`) — these are NOT new bugs from the fix; they're old gaps now visible. Two specifically tied to the match codegen path filed as Bug 52 + Bug 53.

- **Tracker:** `docs/changes/match-block-form-scoping/SCOPING.md` Phase 5 — CLOSED. `docs/changes/r24-bug-4-match-each-generic-closer-2026-05-28/BRIEF.md` archived per pa.md S136 addendum.
- **Cross-refs:** R24-BUG-4 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`; agent dispatch ab53994a8f50e31be; PA-dual-verify R26 + class-level scope-expansion (`<each>` `</>` same fix).

---

### Bug 53 — `<match>` `:`-shorthand arm body emits raw markup as textContent (Phase 3 codegen gap) — `RESOLVED S138 (commit f05d04d2)` (was HIGH; surfaced by R24-BUG-4 R26)

**Fix (S138 commit landed alongside this known-gaps update):** PA-direct surgical fix in `compiler/src/codegen/emit-match.ts:buildMatchArms` shorthand branch (+46/-18L). Detect markup-start in trimmed bodyRaw via `/^<[A-Za-z_]/` regex. When matched, route through `nativeParseFile` (same as the bare-body branch). Non-markup shorthand (string literals, reactive cells, expressions, less-than comparisons) keeps the parseExprToNode path.

Markup-start regex disambiguates:
- `<p>...` (markup tag) → routes to markup parser
- `@count < 10 ? ...` (less-than) → stays on expr parser (`<` followed by space, not letter)

Post-fix emission for `<Idle>: <p>Idle</p>`:
```js
function _scrml_match_match_NN_render_Idle() {
  return "<p>Idle</p>";
}
...
_mount.innerHTML = _scrml_match_match_NN_render_Idle();
```

Markup correctly embeds as innerHTML render-fn output per SPEC §1.4 markup-as-value pillar.

**Regression test:** `compiler/tests/unit/match-shorthand-markup-r24-bug-53.test.js` (NEW; +280L; 8 tests across 8 sections): markup-shorthand emits render fn / emitted client.js passes new-Function syntax check / regression — string-literal shorthand / regression — reactive-cell shorthand / regression — bare-body markup / markup-shorthand with attributes / markup-shorthand with nested elements / less-than comparison NOT mistaken for markup (the disambiguation edge case).

Existing match-block-phase4-shorthand.test.js + match-block-parser-phase1 (15 tests) still pass — zero regression on the parseExprToNode path.

**R26 EMPIRICAL VERIFICATION** (PA dual-verify on dev-3-svelte R24, the original Bug 53 surface):
- Zero `textContent = <` patterns (Bug 53 symptom)
- `node --check` exit 0
- 3 remaining errors are unrelated pre-existing source-side issues (E-ATTR-001 / E-VARIANT-AMBIGUOUS / E-SCOPE-001) — adopter-side fixes per dev-3's R24 report

**Class-close — Bug 52 + Bug 53 together close the full match codegen surface R24 exercised:** `on=` value lowering (Bug 52) + arm-body markup-as-value emission (Bug 53). The 3 remaining R24-specific source-side errors are adopter-side fixes (dev-3 used patterns that don't compile cleanly per SPEC) — not compiler-side gaps.

- **Cross-refs:** R24-BUG-4 dispatch (the BS-level fix that exposed this Phase 3 gap); Bug 52 (sibling Phase 3 gap in same file `emit-match.ts`); SPEC §1.4 markup-as-value pillar; SPEC §4.18 code-default body mode; SCOPING.md Phase 3 codegen.

The `:`-shorthand arm body (`<Idle>: <p>Idle</p>`) emits `el.textContent = <p>Idle</p>;` — syntactically invalid JS. The markup-as-value content in the shorthand body isn't lowered to the emit-html equivalent.

**Surface:** match codegen / `bodyForm:"shorthand"` path in `compiler/src/codegen/emit-match.ts`.

- **Reproducer:** minimal match block with `:`-shorthand arms containing markup expressions (e.g., `<Idle>: <p>Idle</p>`). Run `bun compile <file> --output-dir /tmp/out`; `node --check /tmp/out/<file>.client.js` exits non-zero on the resulting raw-markup-in-textContent emission.
- **Current behavior:** emit-match emits arm body verbatim into a `textContent =` assignment; markup tokens (`<p>`, `</p>`) are not lowered to DOM-creation calls.
- **Expected behavior:** shorthand body with markup-as-value content emits the same shape as the bare-body equivalent — a render function that produces innerHTML or invokes `_scrml_create_element` per the existing emit-html pattern.
- **Suggested fix scope:** emit-match codegen — dispatch on body kind in the `bodyForm:"shorthand"` path; if body content is markup-as-value, route through the existing emit-html lowering pass.
- **Cross-refs:** R24-BUG-4 surface (the BS-level fix exposed this Phase 3 gap); `docs/changes/match-block-form-scoping/SCOPING.md` Phase 3 (emit-match codegen).

---

### Bug 52 — `<match for=Type on=.BareVariant>` codegen does not lower bare-variant (Phase 3 codegen gap) — `RESOLVED S138 (commit a30d86d1)` (was HIGH; surfaced by R24-BUG-4 R26)

**Fix (S138 `a30d86d1`):** PA-direct surgical fix in `compiler/src/codegen/emit-match.ts:resolveOnExpr`. Added 5th branch (+18L) detecting `^\.[A-Z][A-Za-z0-9_$]*$` shape and lowering to `JSON.stringify(variantTag)`. Mirrors the canonical bare-variant lowering at `emit-expr.ts:emitIdent` lines 291-303 (unit variants store as bare string tags at runtime — `Phase.Idle === "Idle"`).

Dispatch helper's `_tag` extraction handles the string form directly: `_tag = (typeof _v === "object" ...) ? _v.variant : _v` → for string `"High"`, `_tag = _v = "High"` matches the `_tag === "High"` dispatch branch.

**Regression test:** `compiler/tests/unit/match-bare-variant-on-r24-bug-52.test.js` (NEW; +276L; 8 tests across 8 sections): bare-variant `on=.High` lowers / emitted dispatcher passes JS syntax check / bare-variant inside `${.Med}` wrap / single-letter `on=.A` / mixed-case `on=.MyVariant` / regression `@cellRef` Shape A preserved / regression qualified `Priority.High` falls through / regression complex `${expr}` Shape B preserved.

**R26 EMPIRICAL VERIFICATION** (PA dual-verify on dev-3-svelte R24, the original report source):
- line 188: `__scrml_match_match_151_dispatch("High");` (was `_dispatch(.High)` pre-fix)
- zero `_dispatch(.[A-Z]` patterns remain (Bug 52 symptom-grep empty)
- `node --check` exit changed from JS-SyntaxError-on-`.High` to a different JS-SyntaxError on Bug 50's symptom (see Bug 50 re-opened below; Bug 52 itself is closed cleanly)

**NB on shape-degeneracy:** constant `on=.Variant` always dispatches to one branch — adopters typically wouldn't write this deliberately. dev-3-svelte's `<match for=Priority on=.High>` was likely intended to be `on=@selectedPriority` (reactive cell ref). The compiler still must produce valid output per SPEC §18.0.1.

**Methodology note:** PA-direct fit this shape well (~10 LOC surgical fix in one function; well-understood site with adjacent reference at emit-expr.ts; agent-dispatch overhead would have exceeded the fix size). All 8 regression tests + pre-commit gate green on first try.

- **Cross-refs:** R24-BUG-4 dispatch surface (Bug 52 was masked by BS-level closer rejection until R24-BUG-4 `adc0a70f` closed Phase 5); emit-expr.ts:291-303 canonical bare-variant lowering; SPEC §14.10 bare-variant inference; SPEC §18.0.3 bare-variant in match arm patterns; SCOPING.md Phase 3 codegen.

---

---

### Bug 49 — BS-level statement-boundary detection silently drops `const X = call() !{...}` arm content — `RESOLVED S137 (commit 076d53e5)` (was HIGH; R26 verification surfaced; UPSTREAM of Bug 38 codegen fix)

**Fix (S137 `076d53e5`):** ROOT CAUSE WAS DOWNSTREAM OF BRIEF HYPOTHESIS. Brief hypothesized `expression-parser.ts:2010` (the warning fire site). Actual locus: `compiler/src/tokenizer.ts` `tokenizeLogic` — two layers earlier than the codegen modules the maps route to. The expression-parser warning was the SYMPTOM; the tokenizer was where the `!{...}` content went unrecognized as an extension of the preceding statement, becoming an orphaned block that the BS-level statement-boundary scanner then dropped.

`compiler/src/tokenizer.ts` +152L: NEW helper `tryEmitSyntheticErrorEffectBlock` recognizes `!{...}` after a complete call/expression in default-logic-mode and emits a synthetic BLOCK_REF token that extends the preceding statement rather than starting a new one. Wired in at the `childByStart` check site in `tokenizeLogic`'s main loop. Composes with existing tokenizer paths for function-decl-head bare-`!` (Bug 36) and `:`-shorthand (Bug 40) — both verified unchanged.

**SCOPE EXPANSION SURFACED BY AGENT (banked):** the fix CLOSES MORE than the brief's "const-binding only" scope. Bug 38's RESOLVED status was EMPIRICALLY INCOMPLETE — its regression tests synthesized AST directly + ran codegen, BYPASSING the BS layer. The bare-call form `risky() !{...}` also failed empirically in real .scrml source files (BS dropped content before AST). Bug 49's actual surface: **"any `!{...}` inside an auto-lifted top-level function body at default-logic-mode."** The fix closes BOTH bare-call AND const-binding shapes. Bug 38 + Bug 49 together close the full call-site `!{...}` arm-body emission space; Bug 38 alone was necessary-but-not-sufficient.

**Regression test:** `compiler/tests/unit/error-handler-const-bind-r25-bug-49.test.js` +617L (NEW; 12 tests across §1-§12): minimal `const r = call() !{...}` multi-line · `let X = call() !{...}` · multi-arm + payload · single-line collapsed · nested handlers · branch-in-arm-body · bare-call regression-guard · empty arm body · positive control · trailing-usage `r` binding flow.

**R26 EMPIRICAL VERIFICATION** (PA-side at landing; the new mandatory doctrine):

| Dev | stmt-boundary source-side | node --check | handler arm-body emit |
|---|---|---|---|
| dev-1-react | 0 (was 3; 1 residual = stdlib/time/index.scrml unrelated) | CLEAN | `_scrml_handleCreate_24` emits arm bodies for DbError + Validation |
| dev-2-elixir | 0 (was 3) | CLEAN | `_scrml_dropOnDone_19` emits 4-variant arm bodies (Forbidden + InvalidTransition + NotFound + DbFailure) |
| dev-3-svelte | 0 | CLEAN | regression-guard held |
| dev-4-pascal | 0 | CLEAN | regression-guard held |

Emitted handler shape sample (dev-1 `_scrml_handleCreate_24`):
```js
function _scrml_handleCreate_24(values) {
  let _scrml__scrml_result_25 = _scrml_fetch_createCard_20(values.title, values.description, values.priority);
  if (_scrml__scrml_result_25 && _scrml__scrml_result_25.__scrml_error) {
    if (_scrml__scrml_result_25.variant === "DbError") {
      const msg = _scrml__scrml_result_25.data;
      _scrml_reactive_set("searchTerm", msg);
    }
    else if (_scrml__scrml_result_25.variant === "Validation") {
      _scrml_reactive_set("searchTerm", "validation");
    }
  }
}
```

**METHODOLOGY DOCTRINE BANKED — R26 empirical verification mandatory for compiler-source HIGH fixes:** Bug 38's "RESOLVED" status reflected the codegen-level scope it was designed to close, which is structurally correct. But its EMPIRICAL close was via Bug 49 — without Bug 49's BS-layer fix, the bare-call shape Bug 38 thought it was closing also empirically failed. Future doctrine: HIGH bug fixes that touch codegen but rely on AST construction MUST verify via R26 empirical reproducers before claiming "closed." Regression tests via direct AST synthesis are necessary but structurally insufficient. R26 is the empirical-canary; same shape as the canary-metric-class lesson (S124 `feedback_canary_metric_class_lesson.md`) in compiler-fix shape.

**Deferred follow-ups (banked):**
- Sister sigil recognition (`${`, `#{`, `^{`, `~{`, `?{`) inside re-tokenized lifted bodies — pre-emptive harden vs scope discipline; defer to next surface.
- `stdlib/time/index.scrml` stmt-boundary warning — pre-existing; surface for separate triage (not R25-class).
- `is`-lowering-not-in-arrow-body (dev-2-elixir R25 line 337) — distinct bug class; file separately if friction surfaces.

- **Cross-refs:** Bug 49 in `gauntlet-r25-report.md` (R26 verification artifacts); agent dispatch BRIEF.md + progress.md at `docs/changes/r25-bug-49-bs-const-bind-error-handler-2026-05-27/`; Bug 38 codegen fix `933d1ad3` (complement; downstream); Bug 36 `e1269844` + Bug 40 `50d38095` (adjacent BS/parser fixes verified untouched); SPEC §19.5 call-site `!{}`; PRIMER §6 `const rows = fetchItems() !{ ... }` canonical shape.

---

**Original problem text (preserved for context):**

R26 verification round (S137) re-ran all 4 R25 dev .scrml sources on the post-cluster baseline `1a06f739` to verify the Bug 38/40/41/37 closures held empirically. Bug 41 / Bug 40 / Bug 37 verified CLEAN end-to-end (Bug 41: dev-2 HTML 0 DDL identifiers; Bug 40: all 4 devs all `<each>` factories populated 7+6+6+5; Bug 37: `node --check` clean on all 4 devs). **Bug 38 partially held — codegen-reachable cases CLOSED, but a DISTINCT UPSTREAM BS-level gap surfaced that drops the `const X = call() !{...}` workaround form's arm content before AST construction.**

The Bug 38 dispatch's regression tests synthesized the AST directly + ran codegen — verifying the `emitArmAssign` extension on Reproducer 3 (`let r = ...` value-binding form). That worked at codegen level. But empirically, the BS layer (block-splitter / statement-boundary detection) does NOT correctly handle the `const X = call() !{...}` shape — it emits `[scrml] warning: statement boundary not detected — trailing content would be silently dropped` and the arm bodies never reach the AST, never reach codegen, and never get emitted. The emitted JS for `const created = createCard(...) !{ | ::DbError(msg) -> { @searchTerm = msg } | ::Validation -> { @searchTerm = "validation" } }` is just `const created = _scrml_fetch_createCard(...)`. with NO arm handlers.

R26 reproducer counts (post-cluster baseline `1a06f739`):
- dev-1-react: **3** residual `const X = call() !{...}` sites (createCard / moveCard / archiveCard handlers — all the `const X = ... !{...}` form)
- dev-2-elixir: **3** residual same shape (moveCard ×2 / archiveCard with `const r = ...` form)
- dev-3-svelte: 0 (didn't use `const X = ... !{...}` form)
- dev-4-pascal: 0 (didn't use)

Both dev-1 + dev-2 used the SAME idiomatic shape:
```scrml
function handleCreate(values) {
    const created = createCard(values.title, ..., values.priority) !{
        | ::DbError(msg) -> { @searchTerm = msg }
        | ::Validation   -> { @searchTerm = "validation" }
    }
    @cards = [...@cards, created]
}
```

The `const r = call() !{...}` shape IS shown in PRIMER §6 + kickstarter — it's not just an obscure adopter reach. dev-2-elixir noted in their R25 report (line 347): *"primer §6 shows `let result = call() !{ | ::E -> ... }` — kickstarter shows `const rows = call() !{ ... }` — both BIND the result."* Canon-confirmed shape.

**Methodology lesson banked (R26 finding):** unit-test regression suites that synthesize AST and run codegen will MISS upstream BS-level bugs. Empirical-reproducer verification (recompile real .scrml source files + check output) is necessary, not sufficient-by-unit-tests-alone. This is the canary-metric-class lesson (`feedback_canary_metric_class_lesson.md`, S124) in compiler-fix shape: regression-tests passing ≠ empirical-reproducer passing. R26 is the empirical-canary that catches what unit tests miss.

- **Reproducer (minimal):**
  ```scrml
  type ErrType:enum = { NetworkError, Validation }

  server function risky() ! ErrType {
      fail ErrType::NetworkError
  }

  function caller() {
      const r = risky() !{
          | ::NetworkError -> { @msg = "net" }
          | ::Validation   -> { @msg = "validation" }
      }
  }
  ```
  Pre-fix: BS warns `statement boundary not detected`; emitted JS has `const r = _scrml_fetch_risky_N();` with NO arm bodies.

- **Workaround:** use bare-call shape WITHOUT `const X =` binding when arm bodies don't need the result-value:
  ```scrml
  risky() !{
      | ::NetworkError -> { @msg = "net" }
      | ::Validation   -> { @msg = "validation" }
  }
  ```
  Per Bug 38 fix `933d1ad3`, this shape emits arm bodies correctly (BS recognizes the bare-call-as-statement form). The PROBLEM is specifically the `const X = ...` value-binding form.

- **Spec reference:** SPEC §19.5 call-site `!{}`; PRIMER §6 canonical multi-line + value-binding shape; kickstarter §error-handling.

- **Root cause hypothesis (verify):** the BS statement-boundary detector reads `const r = call()` as a complete statement and treats the following `!{...}` as orphaned content that gets silently dropped. The BS layer needs to recognize `const X = ANY_EXPR !{...}` as ONE statement where `!{...}` is part of the right-hand-side expression. May involve BS's `scanStatement` / `scanExpression` lookahead being unaware that `!{` extends an expression rather than terminating it.

- **Suggested fix scope:** BS-layer statement-boundary detector — make the `!{...}` token NOT terminate a `const X = ...` initializer expression. Same site has been touched by Bug 36 fix (function-decl-head bare-form) and Bug 40 fix (`:`-shorthand recognition); this is a sibling fix in the same BS region.

- **Cross-refs:** Bug 38 codegen fix RESOLVED `933d1ad3` (closes call-reachable arm-body cases); Bug 36 RESOLVED `e1269844` (sibling parser-side bare-form fix); Bug 40 RESOLVED `50d38095` (sibling BS-level §4.14 fix); R25 gauntlet report dev-2-elixir lines 343-347 ("`!{}` after assignment doesn't compile" — explicit canon-cited reach); R26 verification artifacts at `/tmp/r26-verify/` (this session).

---

## §2 MED — silent acceptance / incomplete surfaces

### Bug 60 — render-by-tag nested-compound-field use-site emits literal browser-ignored tags (input never appears) — `NEW S140; MED; DEFERRED` (Bug-51-class audit; agent-evidence)

**Symptom.** A nested compound-field render-by-tag use-site — `<signupForm><userName/></signupForm>` where `userName` is a Shape-2 field inside the `signupForm` compound — emits the tags VERBATIM as literal `<signupForm><userName /></signupForm>` (browser-ignored), with ZERO `data-scrml-render-by-tag` and NO `<input>`. The field's runtime cell IS fully wired in client.js (`_scrml_reactive_set("signupForm.userName", null)` + validators + derived isValid/errors), so the cell exists but no DOM element binds to it — the input simply never renders. Compiler emits `E-DG-002` (declared but never consumed in a render context). SPEC §6.3.5 explicitly declares this form valid. The top-level Shape-2 render-by-tag forms (v1–v6, v8: text/checkbox/select/textarea/const-prefix/multi-line-`match{}`/`${}`-wrap) all HOLD post-S139-Bug-51 — only the nested-compound-field use-site fails.

**Root cause (agent-evidence, not PA-re-run; baseline `c4d5ef96`).** `compiler/src/codegen/emit-html.ts:1325` render-by-tag expansion calls `lookupStateCell(fileScope, tag)` with the BARE leaf tag `"userName"`. `lookupStateCell` (symbol-table.ts:10218) only walks the parent-chain `s.stateCells.get(name)` — it never descends into a compound parent's `_scope`. Nested fields are resolved only by `lookupQualifiedStateCell` (symbol-table.ts:10247), which `emit-html.ts` NEVER calls for render-by-tag (grep: 0 hits); the emitter also tracks no enclosing-compound context. `decl===null` → the `if (decl && cellKind==="bindable")` guard fails → falls through to literal-tag emission at line 1375.

**Disposition — DEFERRED (not in the S140 dispatch wave).** MED (narrower trigger — nested-compound render-by-tag specifically — than the HIGH total-feature-breaks). **Fix guidance when dispatched:** `emit-html.ts` render-by-tag expansion must track enclosing-compound context and resolve nested field use-sites via `lookupQualifiedStateCell`. **Acceptance gate:** happy-dom test mounting a nested-compound-field use-site + asserting the input renders + binds; add a nested-compound-field case to the render-by-tag suite (§B6.10 only covers the compound PARENT `<formRes/>` negative case today). Cross-refs: SPEC §6.3.5; PRIMER §5; the S139 Bug 51-A/B/C cluster (top-level render-by-tag, RESOLVED).

### A5 refinement-type freeze extension — `DEFERRED with adoption-watch trigger` (S134)

The `const <state>` deep-freeze debate (S134) ratified a **sequenced** verdict: A4 (close the L21 walker alias-escape gap) lands NOW; A5 (refinement-type `object(frozen(deep))` extension that emits `Object.freeze` at the JS-host boundary) DEFERS until adopter friction confirms the boundary-zone enforcement is needed.

- **Reproducer (theoretical, not yet adopter-reported):** a scrml object handed across a JS-host boundary (`_{}` foreign code, Web Worker `postMessage`, MCP tool output) can be mutated by the receiving JS code; scrml's L21 compile-time check doesn't survive the boundary because the receiver is JS and doesn't run the scrml compiler.
- **Workaround:** adopters who need defense-in-depth at the JS-host boundary can manually `Object.freeze(...)` before passing values across; the stdlib could expose a `deepFreeze` utility if friction surfaces.
- **Watch trigger:** **≥2 adopter reports of JS-host boundary mutation post-A4** re-opens the A5 dispatch. On trigger, the design approach is the DD's A5 specification (refinement-type predicate extension; emits `Object.freeze` only at the boundary zone; reuses existing §53 three-zone enforcement).
- **What does NOT trigger A5:** internal alias-escape (closed by A4). A3 (Vue-style cell-decl modifier) is permanently rejected per the debate — zero expert votes; creates a parallel classification path beside §53 that the design rule explicitly rejects.
- **Authority:** debate insight at `~/.claude/design-insights.md` ("const <state> deep-freeze — roc-expert vs clojure-expert vs simplicity-defender vs security-expert — 2026-05-26"). HU at `docs/heads-up/const-deep-freeze-2026-05-26.md` (status: ratified). DD at `scrml-support/docs/deep-dives/const-deep-freeze-2026-05-26.md` (1296L).

---


### Bug 1 — Tailwind arbitrary-value classes — `partial-impl` (remaining: ring-offset + gradient + safelist + string-shaped)

Major families shipped S108-S109: grid / flex / aspect / transition / timing / individual transforms + shorthand + directional / outline / ring (length/color/var/keyword). The `W-TAILWIND-UNRECOGNIZED-CLASS` floor lint catches typos + unsupported arbitrary-values today.

**Still open:**
- **`ring-offset-*`** + **`bg-gradient-*` / `from-*` / `to-*` / `via-*`** — require Tailwind's preflight `*, ::before, ::after` custom-property layer (`--tw-ring-offset-shadow` / `--tw-ring-shadow` / `--tw-gradient-stops`). scrml has no preflight CSS emission infrastructure.
- **String-shaped arbitrary values** — `content-["text"]` + `font-[Inter]` need bracket-parser extension.
- **Safelist / `@apply`** — to distinguish custom user-defined classes from typos so the lint is precise on mixed Tailwind+custom-CSS codebases.

- **Workaround:** drop a `#{}` CSS shim block with the rules written by hand.
- **Status:** preflight blocker is the load-bearing piece; ring-offset + gradient unblock together when preflight infrastructure lands. Filed S108-S109; queued.

---

### Bug 12 — V-kill READ-side fire — `deferred`

S123 V-kill landed write-side enforcement (`@x = expr` at default-logic body-top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`). The READ-side fire (rejecting bare `@x` reads against undeclared cells inside `${...}` bodies) is deferred — the engine var-name canonicalization machinery is the unblocker.

- **Workaround:** declare all cells structurally with `<x> = init` before reading via `@x` in `${...}` bodies (which is the canonical V5-strict pattern anyway; the workaround IS the correct usage).
- **Status:** deferred S123; engine var-name canonicalization unblocks. Not adopter-visible if V5-strict patterns are followed; only surfaces if adopter typos `@x` against a name that doesn't have a `<x>` decl.

---

### Bug 13 — E-SCHEMA-003 enforcement — `spec'd` (no fire site)

S130 HU-2 Q7 ratified `<schema>` placement as immediate child of `<program>` (per F-019). SPEC §34 E-SCHEMA-003 catalog row updated S130. The compiler currently has NO fire site for E-SCHEMA-003 — a misplaced `<schema>` block compiles clean and emits unexpected SQL/runtime behavior instead of the loud compile error the SPEC promises.

- **Workaround:** verify `<schema>` is an immediate child of `<program>` at write-time; if you see runtime SQL anomalies in mixed-placement projects, check schema placement first.
- **Status:** flagged at S130 HU-2 Q7 as Phase 2 implementation follow-on. Filed; not yet dispatched.

---

### Bug 14 — MCP V0 partial-impl + deferred items — `partial-impl`

MCP V0 sub-units A+B+C+D shipped S125-S130. V0.E (E2E + adopter docs + fixture multi-page app) pending. V0.D (this session S130) has 3 deferred items that limit current capability:

1. **Runtime-helper registration on globalThis** — today's boot reads `globalThis._scrml_reactive_get` which is never set (runtime is module-scoped per generated `.server.js`). Tool resolvers gracefully degrade for V0 (descriptor sidecars carry topology data; runtime cell reads return undefined).
2. **`scrml dev` (in-process Bun.serve)** gets NO MCP wiring — boot lives only in build-time `_server.js`. Use `scrml build` + run the server entry to get MCP working in dev.
3. **"dev-only" semantics use RUNTIME NODE_ENV gate** (not compile-time) — no §58 Build Story hook exists yet; revisit when §58 implementation lands.

- **Workaround:** for V0.E specifically, no workaround — the adopter setup doc + E2E examples don't exist. For deferred items: use `<program mcp="always">` to override the dev-only gate; build via `scrml build` not `scrml dev`.
- **Status:** V0.E queued (~10-12h per SCOPING §3.E). Deferred items revisit at §58 land.

---

### Bug 16 — Generator policy — `open` (S114)

`yield` / `yield*` / `function*` are NOT covered by the S114 "no async/await" rule (preserved in the JS-subset bound at M4.3 per S114). Semantic policy is open: do generators belong in scrml, and if so under what discipline (compiler-managed iteration vs user-authored protocol)?

- **Workaround:** use generators if needed; they parse. Compiler doesn't generate diagnostic surface around them either way.
- **Status:** open. Filed S114; not dispatched.

---

### Bug 17 — L19 multi-statement-handler relaxation — `queued for HU`

L19 forbids multi-statement event handlers (`onclick=` must be a single expression, not a multi-statement block). The rule was ratified pre-engines; engines + body-split CPS may have changed the design constraints. Carry-forward question: should L19 relax under modern scrml composition?

- **Workaround:** wrap multi-statement handlers in a named function (`function handle() { ... }; <button onclick=handle()>`).
- **Status:** open HU follow-on; small enough to fold into iteration HU or its own sub-session.

---

### Bug 30 — Linter scans content inside `<!-- -->` HTML comment blocks — `RESOLVED S137 (commit 5199a435)` (was MED; R24; R25 confirmed via Bug 43)

Original symptom: the lint pass fired `W-LINT-001` / `W-LINT-003` / `W-LINT-004` / `W-LINT-005` / `W-LINT-007` / `W-LINT-008` / `W-LINT-011` / `W-LINT-014` / `W-LINT-016` / `W-LINT-022` on text appearing inside HTML comment blocks (`<!-- ... -->`). Surfaced by dev-2/3/4 overseers in R24 (R25 confirmed via Bug 43 cross-ref): every dev's `<!-- FRICTION REPORT -->` block (containing anti-pattern words like `===`, `<style>`, `.map()`, `{#if}` for comparison) tripped multiple lints.

**Fix (S137 `5199a435`):** PA hypothesis was CORRECT (2 of 9 dispatches this session). Two-layer fix in `compiler/src/lint-ghost-patterns.js` (+37/-8L):

1. **`buildSkipRanges()` extended** to recognize `<!-- ... -->` HTML/markup comment spans (HTML 5 non-nesting; unterminated runs to EOF). Every existing `skipIf` that already checked `commentRanges` becomes HTML-comment-aware for free.
2. **8 patterns that previously skipped ONLY on `logicRanges`** (W-LINT-003 / 004 / 005 / 006 / 008 / 012 / 014 / 015) extended to ALSO skip on `commentRanges` — SPEC §27 applies categorically across all comment shapes (`//`, `/* */`, `<!-- -->`).

Doctrine basis: SPEC §27 (comments do not carry code) + SPEC §4.7 (S87/S88 amendment authorizes BS-layer to treat `<!-- ... -->` spans as opaque raw content; the pre-BS lint pass MUST do the same).

**Regression test:** `compiler/tests/unit/lint-html-comment-region-r24-bug-30.test.js` +328L (NEW; 19 tests): minimal repro · multi-line · adjacent comments · empty `<!-- -->` · unterminated · HTML non-nesting · per-code regression for 7 R24-confirmed codes · negative control · R24 friction-report composite shape.

**PA-VERIFIED R26 EMPIRICAL** (PA-captured pre-fix baseline at `961c88c0`, post-fix verified at landing `5199a435`):

| Dev | Pre-fix | Post-fix | Delta | Outside-comment fires preserved |
|---|---|---|---|---|
| dev-1-react | 15 | 0 | -15 | (none — all 15 were in comment) |
| dev-2-go | 3 | 1 | -2 | line 305 W-LINT-011 preserved |
| dev-3-svelte | 10 | 0 | -10 | (none — all 10 were in comment) |
| dev-4-pascal | 4 | 2 | -2 | lines 265 + 268 W-LINT-011 preserved |
| **Total** | **32** | **3** | **-29** | (3 outside-comment fires preserved exactly as predicted) |

Both agent + PA ran R26 independently. PA-captured pre-fix baseline at `/tmp/r26-bug30-baseline-summary.txt` predicted per-dev deltas which matched post-fix counts exactly. Banked as a reusable PA workflow for lint-pass / scan-based fixes: capture in-condition vs out-of-condition counts pre-fix; the delta IS the empirical verification surface.

**Deferred (banked):**
- SPEC-INDEX.md row "comments → §27 (13421-13441)" appears stale per agent inspection (line range maps to §20.3 nav content). Worth a `bun run scripts/regen-spec-index.ts` in a future maintenance pass.
- Outside-comment W-LINT-011 fires that survived post-fix (dev-2 line 305, dev-4 lines 265/268) are real signal or a separate false-positive class; NOT investigated.

- **Spec reference:** SPEC §27 (comments do not carry code); SPEC §4.7 BS-layer raw-content doctrine (S87/S88 amendment).
- **Cross-refs:** R24-BUG-3 in `gauntlet-r24-report.md`; R25 Bug 43 cross-ref (duplicate); agent dispatch BRIEF.md at `docs/changes/r24-bug-30-linter-html-comment-2026-05-27/BRIEF.md`.

---

### Bug 31 — `if`-statement-as-expression in `!{}` result binding produces invalid JS — `RESOLVED S137 (commit 8f4f4ce3)` (was MED; R24-BUG-5)

Original symptom: function body containing `if (cond) return` immediately followed by `failableCall() !{...}` caused codegen to emit `let _result = if (cond) { return fn(); }` — JS SyntaxError. Narrow but adopter-encounterable on dev-1-react's `function load()` pattern.

**Fix (S137 `8f4f4ce3`):** ROOT CAUSE WAS UPSTREAM OF CODEGEN. Brief hypothesized codegen as fix locus; actual root was parser-side in `ast-builder.js`. Bare `return` greedily consumed the next-line expression as its value even when on a NEXT line; `parseRecursiveBody` then saw the trailing `!{...}` BLOCK_REF and wrapped the enclosing `if-stmt` as `guarded-expr.guardedNode`. emit-logic.ts was correctly emitting the buggy AST it received.

`compiler/src/ast-builder.js` +63L: JS Automatic Semicolon Insertion (ASI) for `return` per ECMA-262 §11.9.1 — bare `return` token followed by expression on SAME line consumes it; followed on NEXT line, `return` stands alone. Span-line guard at both return handlers (L5491 `parseOneStatement` + L9255 `parseLogicBody` main loop) via `.span?.line` with `!= null` defensive guards.

**Token-shape discovery (banked observation):** tokens in `parseLogicBody`/`parseOneStatement` carry `.span.line`, NOT a flat `.line` property. Agent's first iteration used `.line` mirroring existing break/continue label same-line checks and silently never fired. Second iteration switched to `.span?.line` and fired correctly. **The existing `.line`-using checks for label-loops at L5455/L5474/L9221/L9239 are likely DORMANT BUGS** — no test exercises labeled loops; filed deferred.

**Regression test:** `compiler/tests/unit/r24-bug-31-if-as-expression-result-binding.test.js` +547L (NEW; 12 tests): minimal repro · no-early-return regression-guard · multi-statement before failable · throw shape · multiple early-returns · early-return inside block · ternary negative-control · node --check on each emitted JS.

**Reproducer verification (PA-verified at landing):**
- PRE-FIX dev-1-react.client.js ~line 338: `let _result = if (!_scrml_reactive_get("searchTerm")) { return; }` — SyntaxError
- POST-FIX line 338: `if (!_scrml_reactive_get("searchTerm")) return; let _result = _scrml_fetch_fetchItems(...);` — clean

**R26 empirical on R24 dev-1-react:** `_result = if` count 1 → 0; node --check passes Bug 31 site. Remaining failure at line 438 is a DIFFERENT pre-existing bug (`${@.status}` orphan-sigil inside `<each>`); may overlap with Bug 32 or be separate filing.

**Deferred (banked):**
- **Dormant label-loop bug** (ast-builder.js L5455/L5474/L9221/L9239 use `.line` instead of `.span.line`; silently fails on labeled loops; no test exercises). File separately if friction.
- **Pre-existing line-438 SyntaxError** in dev-1-react.client.js (`${@.status}` in `<each>` body); separate bug class.

PA hypothesis WRONG (4 of 11 dispatches correct this session). Brief's "MODERATE confidence" + agent's empirical Phase 0 trace caught the wrong direction within ~30 min.

- **Spec reference:** SPEC §19.4 + §17; ECMA-262 §11.9.1 JS ASI for `return`.
- **Cross-refs:** R24-BUG-5 in `gauntlet-r24-report.md`; agent dispatch BRIEF.md; Bug 38 codegen `933d1ad3` + Bug 49 tokenizer `076d53e5` (sibling territory; UNCHANGED).

---

### Bug 32 — `@.` iteration sigil not lowered inside `<tableFor>` column slot body — `RESOLVED S137 (commit 68bfb4a4)` (was MED; R24-BUG-6; CLASS-CLOSE)

Original symptom: `<column field="status" :let={(row) => <span>${@.status}...}/>` inside `<tableFor for=T rows=@cell>` emitted `@ . status` unlowered into client JS — orphan `@` token → JS SyntaxError. dev-1-react column-slot at line 331 (inside `<tableFor>` starting line 311, `<column>` line 330).

**Fix (S137 `68bfb4a4`):** PA hypothesis CORRECT (5 of 12 dispatches this session). `compiler/src/codegen/emit-table-for.ts` +170/-3L: NEW `rewriteAtDot*` helpers + `buildBodyCell` call-site invocation. Site 1 (expander-time rewrite, contained to emit-table-for.ts) chosen over Site 2 (downstream emit-time) for maintainability. Mirrors `emit-each.ts` text-level regex pattern (line 259 reference); regex tolerates `@\s*\.\s*` for BS-tokenizer space-padded form (Bug 35 `matchIsPredicateSuffix` precedent). exprNode re-parsed because original `"@ . status"` escaped to parse error; rewritten `"row.status"` parses to clean `member` expression.

**CLASS-CLOSE banked — Bug 31 dispatch agent's deferred class-finding ALSO closed.** Bug 31 agent reported a pre-existing line-438 SyntaxError on dev-1-react with the SAME orphan-`@ .` pattern and classified it as "DIFFERENT bug; `<each>` body; out of scope." Bug 32 agent did empirical re-check: line 438 sits INSIDE `<tableFor>` `<column>` (lines 311+330), NOT inside `<each>`. Bug 31 agent's classification was WRONG. This fix closes BOTH the column-slot bug AND Bug 31's deferred line-438 site as a single class.

**Regression test:** `compiler/tests/unit/r24-bug-32-at-dot-tablefor-column-slot.test.js` +406L (NEW; 13 tests): minimal repro · multi-column · multi-field `@.id`/`@.name`/`@.status` · named `:let={row}` binding alongside `@.` sigil · `<each>` regression-guards (Bug 40 `:`-shorthand preserved) · nested composition · non-iteration locus error preserved · node --check on emitted JS.

**PA-VERIFIED R26 EMPIRICAL** (post-Bug-32 landing `68bfb4a4`):
- dev-1-react orphan `@ .` count: 1 → 0 (Bug 32 site + Bug 31's deferred line-438 BOTH CLEAN)
- `node --check` advances past line 438; remaining failure at line 646 is a SEPARATE latent bug class (`selectable=` `onchange` emission; filed as Bug 50 NEW)

**SPEC alignment note (banked by agent):** SPEC §41.16.10 line 20512 reserves `@row` magic variable for v1.next — DISTINCT from `@.` lowering. `@row` is implicit magic (no `:let={...}` needed); `@.` is the §17.7 iteration sigil that composes naturally with the synth for-loop. SPEC has no normative text REJECTING `@.` in tableFor column slot body; BRIEFING-ANTI-PATTERNS doc explicitly teaches `@.` as "the iteration sigil." Fix aligns with stated user intent + ratified anti-pattern guidance.

**Deferred follow-up (NEW Bug 50, banked):** dev-1-react.client.js line-646 `selectable=` `onchange` handler emits raw `if-stmt` inside object-literal (`"_scrml_attr_onchange_28": if (evt !== null && evt !== undefined) { ... }`) — separate latent class. See Bug 50 below.

- **Spec reference:** SPEC §17.7 `@.` iteration sigil; SPEC §41.16 `tableFor`; SPEC §41.16.3 column slot grammar; SPEC §41.16.10 `@row` v1.next reservation (DISTINCT from this fix).
- **Cross-refs:** R24-BUG-6 in `gauntlet-r24-report.md`; Bug 31 dispatch agent's deferred line-438 class-close note (now CLOSED).

---

### Bug 35 — `rewriteIsPredicates` in `preprocessForAcorn` fails on BS-tokenizer space-padded dots — `RESOLVED S137 (commit 5cb993c2)` (was MED; R24-BUG-1 triage finding)

Original symptom: when the BS tokenizer space-pads dot tokens (`@x is . All` vs the canonical `@x is .All`), `rewriteIsPredicates` in `compiler/src/expression-parser.ts:preprocessForAcorn` FAILED to recognize the `is`-predicate. AST-path silently dropped the predicate; codegen fell through to the string-rewrite fallback (which worked correctly via `rewriteIsOperator` at `compiler/src/codegen/rewrite.ts:561-562`).

**Fix (S137 `5cb993c2`):** matches brief hypothesis EXACTLY (1 of 8 S137 dispatches where PA hypothesis was correct). `matchIsPredicateSuffix` (lines 884-899) `+15/-6L`: both `typedVariantMatch` (Type.Variant qualified form) and `bareVariantMatch` (.Variant bare form) regexes extended with `\s*` tolerance around the `.` separator. Captured `variant` is normalized via `.replace(/\s+/g, "")` so downstream consumers see the canonical no-space spelling (".All" instead of ". All"). Mirrors the sibling string-rewrite pass.

**SALVAGE PROCESS:** dispatched agent `a9dea5879059f794d` crashed with `API Error: socket connection was closed unexpectedly` after ~4.7min. Agent never committed but had completed Phase 1 (the regex tweak) in working tree. PA captured the diff content from `git diff` output BEFORE the working tree was reset, then reapplied via Edit tool (after path-discipline hook + S94 CWD-slip correctness — the hook correctly blocked an initial Edit attempt because CWD had slipped into the crashed worktree; `cd /home/.../scrmlTS` cleared it). PA-direct wrote Phase 2 regression tests, ran them, landed. Per `feedback_agent_crash_partial_recovery.md` (S89 §13.2 banked rule).

**Regression test:** `compiler/tests/unit/rewrite-is-predicates-space-padded-r24-bug-35.test.js` +203L (NEW; 16 tests / 23 expect() calls):
- §1 bare-form predicate (no-space + space-padded + structural AST equivalence)
- §2 qualified-form predicate (4 spacings × 4 structural equivalences)
- §3 variant normalization (interior whitespace stripped on capture)
- §4 negative control — canonical `@x is not` presence-check unaffected (NOTE: removed initial draft tests asserting `@x is not .All` is a single negated variant predicate; empirical probe revealed canonical scrml parses this as `(@x is-not-absent).All` member access on the presence-check result; that's existing semantic, not Bug 35 territory)
- §5 R24-BUG-1 reproducer shape — `(c) => c.status is . Active` (the original visibility surface)
- §6 logical operators — `@x is .A and @y is . B` + or-form
- §7 negative control — trailing `is` no false-positive predicate

**Reproducer verification (direct AST probe):**
- `parseExprToNode("@x is .All", ...)` → `{binary, op:"is", right:{ident ".All"}}`
- `parseExprToNode("@x is . All", ...)` → IDENTICAL post-fix (pre-fix returned only `{ident "@x"}`)

**No R26 empirical verification mandated** — per S138 R26 doctrine scope (HIGH-severity codegen bugs); Bug 35 is MED + compiler-internal (no adopter-visible behavior change; string-rewrite fallback was emitting correct JS pre-fix). This fix recovers AST-path completeness + path-switch perf cost only.

**Adopter impact:** NONE pre-fix or post-fix (string-rewrite fallback was producing correct JS).

- **Spec reference:** SPEC §3 + §4.4 — whitespace inside `is .Variant` predicate forms now tolerated symmetrically across both pipeline paths.
- **Cross-refs:** Bug 35 in `gauntlet-r24-report.md`; R24-BUG-1 dispatch a76e86b1c2b94ea00 (where Bug 35 was originally surfaced); sibling `rewriteIsOperator` at `compiler/src/codegen/rewrite.ts:561-562` (the canonical `\s*` tolerance template).
- **Cross-refs:** surfaced by agent dispatch `a76e86b1c2b94ea00` (R24-BUG-1 landing); recorded in dispatch's final-report DEFERRED_ITEMS #2.

---

### Bug 42 — `?{}` SQL in `server function*` SSE generator body not lowered (E-CG-006 misclassified) — `RESOLVED S137 (commit 480aded4)` (was MED; R25)

Original symptom: compiler treated `server function*` (SSE generator) body as client-side context for `?{}` lowering. dev-1 + dev-2 emitted raw `? { \`SELECT...\` } . all ( )` tokens. dev-4 emitted `null` with `// E-CG-006` comment.

**Fix (S137 `480aded4`):** ROOT CAUSE WAS NOT IN CLASSIFICATION — Brief hypothesized "server-context classification — `server function*` should join `server function` in the server-context set." Empirical investigation surfaced THREE DISTINCT COUPLED root causes upstream of any classification concern (continuing the S137 brief-hypothesis-vs-grep pattern — 6 of 7 dispatches this session had hypothesis mismatch in some axis):

1. **`ast-builder.js` `BARE_DECL_RE`** required `\s` after `function`/`fn` — `function*` and `fn*` MISSED the top-level default-logic auto-lift gate. `server function* watchActivity()` at `<program>` direct-child position never reached `parseLogicBody` as a function-decl; the entire fn body was silently dropped, no server.js handler synthesized.

2. **`liftBareDeclarations` synthetic-logic-block child-population gap (CLASS-LEVEL FIX).** Synthetic `{type: "logic", raw: "${" + textRaw + "}", children: []}` blocks had empty children; BS never split `?{...}` SQL blocks out of TOP-LEVEL `<program>` body text. `tokenizeLogic` then emitted PUNCT `?` + PUNCT `{` for `?{...}` content rather than a BLOCK_REF of type "sql". `parseOneStatement` return-stmt SQL-aware handler needed a BLOCK_REF to attach structured sqlNode — without it, fell through to escape-hatch and emit dumped raw `? { ... } . all ( );` tokens. **Phase 1 buildBlock-side recovery covers any brace-delimited sigil block (`${` / `?{` / `!{` / `#{` / `~{` / `^{`) inside text auto-lifted at `<program>` / `<page>` / `<channel>` direct-child position** — closes a class wider than Bug 42 alone.

3. **`yield` had no parser handler.** `yield ?{...}` parsed as `yield;` (bare-expr) + standalone SQL statement (value discarded). Phase 2 added yield-stmt handlers in both `parseOneStatement` AND `parseLogicBody` main loop mirroring return-stmt SQL BLOCK_REF detection. `emit-logic.ts` gains `case "yield-stmt"` mirroring return-stmt sqlNode branch (server-boundary → `yield await sql\`...\``; client-boundary → defensive `yield null;` + diagnostic comment). `emit-control-flow.ts` `emitWhileStmt` + `emitDoWhileStmt` thread `opts.boundary` to body emitLogicBody + EmitExprContext.mode (SQL template `${@cell}` params now rewrite via server `_scrml_body["cell"]` rather than client `_scrml_reactive_get`). `_makeExprCtx` honors `opts.boundary` for server-mode @cell rewriting.

Three-file fix coupled with regression tests:
- `compiler/src/ast-builder.js` +192L: BARE_DECL_RE admits `function*`/`fn*`; buildBlock case "logic" synthetic-logic child recovery; yield-stmt parser handlers in parseOneStatement + parseLogicBody.
- `compiler/src/codegen/emit-logic.ts` +51L: NEW `case "yield-stmt"`; `_makeExprCtx` boundary-aware; while/do-while case sites pass `opts.boundary`.
- `compiler/src/codegen/emit-control-flow.ts` +23L: `emitWhileStmt` + `emitDoWhileStmt` accept + thread `opts.boundary`.

**Regression test:** `compiler/tests/unit/server-fn-star-sql-r25-bug-42.test.js` +313L (NEW; 12 tests / 29 expect() calls): SSE-yield · non-generator regression-guard · `${}` wrap regression-guard · bound-param · multi-yield · chain shapes · mixed-yield · bare-yield · structure sanity · PUNCT-leak guard · client-side _scrml_sql isolation · defensive client-yield-null.

**PA-VERIFIED R26 EMPIRICAL (post-Bug-42 landing 480aded4):**

| Dev | E-CG-006 | _scrml_sql calls | raw `? {` | server.js node --check |
|---|---|---|---|---|
| dev-1-react | 0 | 8 | 1 (false-positive — JS ternary inside broadcast(), NOT SQL) | CLEAN |
| dev-2-elixir | 0 | 9 | 0 | CLEAN |
| dev-4-pascal | 0 | 10 | 0 | CLEAN |

SSE handler emit sample (dev-1 `activityLog`): properly synthesized as `async function _scrml_handler_activityLog_6(_scrml_req) { ... }` with route shape, SSE endpoint structure, auth check, route export — full server-side scaffolding now present.

**Deferred follow-ups (declared by agent, banked):**
- SSE generator `@cell` server-side resolution: post-fix codegen emits `_scrml_body["cursor"]` (correct server-mode form per non-SSE precedent), BUT GET SSE handlers don't declare `_scrml_body` (only POST handlers do). Per SPEC §37.7 `@cell` inside SSE generator bodies should resolve to query params or server-local state. Separate SSE-codegen concern.
- Comprehensive bare client `function*` test coverage: SPEC §13 generator carve-out (S114) admits bare `function*` outside SSE surface. Comprehensive coverage is a separate spec exercise.

- **Spec reference:** SPEC §37 SSE / `server function*`; SPEC §13 `?{}` query expressions.
- **Cross-refs:** Bug 42 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-42-server-fn-star-sql-2026-05-27/BRIEF.md`; S138 addendum R26 doctrine first PA-side dual-verify on a MED bug.

---

### Bug 43 — Linter scans HTML comment content — `RESOLVED-AS-DUPLICATE-OF-BUG-30 S137 (commit 5199a435)` (was MED; R24; R25 confirming evidence)

R25 surfaced this independently (dev-3 / overseer-3). Already filed as Bug 30 in S136 R24 intake. **RESOLVED in same commit as Bug 30** (`5199a435`, S137) — single fix to `buildSkipRanges()` + `commentRanges` skip extension closes both. dev-3-svelte's friction-report empirically verified clean post-fix (10 → 0 false-positives, 0 outside-comment fires affected).

- **R25 confirming evidence (now CLOSED):** dev-3-svelte's friction report had 14 W-TAILWIND-UNRECOGNIZED-CLASS / W-LINT-007 / W-LINT-004 / W-LINT-014 fires all on text inside `<!-- FRICTION REPORT -->` comment block. Post-fix: 10 → 0 (PA R26 dual-verify).
- **Cross-refs:** Bug 30 (RESOLVED S137 `5199a435`); Bug 43 in `gauntlet-r25-report.md`.

---

### Bug 44 — W-LINT-007 false-positive on `fallback={<markup/>}` (SPEC §19.6 canonical errorBoundary shape) — `RESOLVED S137 (commit 98f82970)` (was MED; R25)

Original symptom: W-LINT-007 ghost-pattern lint fired on `<errorBoundary fallback={<markup/>}>` (the SPEC §19.6.2 canonical form, only-working shape per compiler-accepts) treating it as a JSX `{val}` scalar braces-in-attribute pattern. Confirmed by dev-3-svelte + dev-4-pascal + overseer-4 in R25; dev-1-react + dev-2-elixir also empirically firing per PA dual-verify.

**Fix (S137 `98f82970`):** PA hypothesis CORRECT (option (b) markup-valued exemption per PA-lean; 3 of 10 dispatches this session). Single-file fix in `compiler/src/lint-ghost-patterns.js` (+47/-3L): NEW helper `isMarkupValuedBracedAttr` peeks the first non-whitespace char after `{`; returns true if `<` followed by tag-name letter. W-LINT-007 skipIf consults the helper via newly threaded `source` (9th positional arg) + `matchEnd` (10th positional arg). Other patterns ignore the new args — backwards compatible. Composes cleanly with Bug 30's `commentRanges` skip.

**Scope decision rationale** (option-b, broader than errorBoundary-specific): per SPEC §1.4 markup-as-first-class-value pillar, markup as a braced-attribute value is the same first-class-value shape as markup in any other slot. Forward-looking — future canonical `<Comp slot={<m/>}>` shapes get the exemption without re-touching the lint. W-LINT-007's signal (catch JSX scalar braced attrs) fully preserved by 7 negative-control tests (variable / arrow / call / binary / boolean / number / unary).

**Regression test:** `compiler/tests/unit/lint-w-007-markup-valued-attr-r25-bug-44.test.js` +247L (NEW; 23 tests across 6 sections): minimal repro · nested markup · 7 negative-control scalar shapes (still fire) · component prop with markup value · multi-attr (fallback exempt, other attrs unaffected) · HTML comment regression-guard (Bug 30 path preserved).

**PA-VERIFIED R26 EMPIRICAL** (post-Bug-44 landing `98f82970`):

| Dev | Pre-fix W-LINT-007 on `fallback=` | Post-fix |
|---|---|---|
| dev-1-react | 1 | 0 |
| dev-2-elixir | 1 | 0 |
| dev-3-svelte | 0 (in `<!-- -->` block per Bug 30) | 0 |
| dev-4-pascal | 1 | 0 |
| **Total** | **3** | **0** |

3 false-positives silenced; 0 regressions. Both agent + PA ran R26 independently.

**Deferred follow-up (banked + still open):**
- **R24 step-3b errorBoundary direction call** — substantive design deliberation about which canonical form wins long-term. PRIMER §6.8 `renders=.Fallback` form errors at attribute parse; SPEC §19.6.2 `fallback={<markup/>}` form works (lint cleared by this fix); three canon layers still disagree. Bug 44 fix is SHAPE-NEUTRAL with respect to direction — applies regardless of outcome. The deliberation remains a separate item.

**Process note (declared honestly by agent):** one S126 deviation (Edit tool used for skipIf body replacement; other compiler-source edits used bash perl). Verified via `git diff` before commit. Honest declaration per S136 R24-BUG-2 anti-precedent.

- **Spec reference:** SPEC §19.6.2 (`<errorBoundary fallback={<markup/>}>` canonical); SPEC §1.4 markup-as-first-class-value pillar.
- **Cross-refs:** Bug 44 in `gauntlet-r25-report.md`; R24 step-3b deferred direction call (separate deliberation); Bug 30 `5199a435` (predecessor at same file; composes additively); agent dispatch BRIEF.md.

---

## §3 LOW — ergonomic / cosmetic

### Bug 4 — Bare `/` in markup-text body parses as element closer — `spec'd`

The `?{` half closed S108 via Approach C-narrow (markup-text-mode locus gate per SPEC §3.1 + §8.1). Bare `/` half remains open. Writing scrml-about-scrml prose where `/` appears in text (e.g., "`""` / `0` / `[]` are all defined values") can still confuse the BS-layer's `looksLikeCloser` heuristic in edge cases.

- **Workaround:** entity-encode (`&#47;`) when `/` appears at scrml-content-as-data positions in prose.
- **Status:** Q-BUG4-OPEN-5 in deep-dive `scrml-support/docs/deep-dives/bug-4-docs-mode-escape-2026-05-19.md`; broad-C extension if friction surfaces beyond the single dogfood citation.

---

### Bug 18 — GITI-015 — `queued`

LOW-severity adopter bug filed by giti per S124 carry-forward. Details in `handOffs/incoming/read/`. Queued; not currently in implementation.

---

### Bug 19 — §11-folded-citation sweep — `cosmetic`

5 dev.to articles cite SPEC `§11` for `<db>` / `protect=` / state-authority content. §11 is folded (content distributed to §6.12 + §52 per SPEC-INDEX row 44). The E-codes those articles cite are correct; only the bare section number is stale. Lowest-priority cleanup item.

- **Workaround:** none needed; the articles' E-code citations still resolve.
- **Status:** filed S115 article-truthfulness audit §3.4; safe to fold into any future article edit pass; not dispatched separately.

---

### Bug 20 — `bun scrml promote --engine` (Tier-1→2 sibling) — `deferred`

The `bun scrml promote --match` CLI shipped S66 (Tier-0→1 lift mechanical). The companion `--engine` flag (Tier-1→2 lift) is deferred — it pairs with `W-MATCH-TRANSITIONS-ACCRUING`, a sibling lint that needs its own §34 catalog + implementation groundwork. The CLI flag stays registered but prints a clear "deferred" message until that lands.

- **Workaround:** manual conversion from `<match for=Type>` block-form to `<engine for=Type initial=.Variant>` — state-children carry forward verbatim; add `initial=` + per-arm `rule=`.
- **Status:** deferred; queued post-W-MATCH-TRANSITIONS-ACCRUING.

---

### Bug 21 — Q6-narrow heuristic: deep multi-level reset on nested compound — `heuristic` (S135)

`reset(@a.b.c)` where `b` is itself a compound state with its own lifecycle-annotated fields: Q6-narrow's `applyResetToCellField` walker conservatively uses `fieldPath[0]` — the first hop after the cell root — for tracker classification. The §6.8.2 B22 ratification supports deeper compound-nav targets, but the canonical scrml idiom is one hop deep (per the §6.8.2 worked examples). Deeper nesting works at runtime via the existing `_scrml_reset` codegen; only the per-access tracker's state revert is shallow.

- **Workaround:** none needed for canonical idiom; if deeper resets are exercised, the tracker may miss a lifecycle revert on the deeper field but the runtime behavior is correct.
- **Status:** filed S135 in Q6-narrow progress.md follow-ups; extend on real adopter friction.
- **Cross-refs:** SPEC §6.8.2 (multi-level compound-nav, B22 ratification); SPEC §6.8.3 (Q6-narrow impl); `docs/changes/q6-narrow-reset-lifecycle-2026-05-26/progress.md`.

---

### Bug 22 — Q6-narrow heuristic: cross-cell `default=@otherCell` reset value classification — `heuristic` (S135)

`<state default=@otherCell>: (not to User) = not` — when `reset(@state)` evaluates `@otherCell` as the reset value, `classifyResetValueAgainstSpec` heuristically treats any non-`not` text as post-type for presence-progression. If `@otherCell` is itself in a pre-state at the reset moment, the heuristic misclassifies. The actual cross-cell type-check happens at the assignment site (`@state = @otherCell` would route through `classifyWriteAgainstSpec` properly); the heuristic only affects whether the per-access tracker reverts vs maintains state immediately after the reset.

- **Workaround:** none needed in practice; the cross-cell scenario is uncommon and the type-check at the assignment site catches real type errors.
- **Status:** filed S135 in Q6-narrow progress.md follow-ups; extend when adopters exercise cross-cell defaults under lifecycle annotations.
- **Cross-refs:** SPEC §6.8.1 (`default=` attribute); SPEC §6.8.3 (Q6-narrow impl); `docs/changes/q6-narrow-reset-lifecycle-2026-05-26/progress.md`.

---

### Bug 23 — Lifecycle source-form follow-up: W-LIFECYCLE-LEGACY-ARROW not emitted for Shape 1 cells — `RESOLVED S138 (commit 61391c75)` (was LOW heuristic; S135)

**Fix (S138 `61391c75`):** PA-direct surgical fix in `compiler/src/type-system.ts:buildCellValueLifecycleMap` (+27L incl. doc). Per-cell emission of W-LIFECYCLE-LEGACY-ARROW when `findTopLevelArrow` detects glyph = "arrow" (legacy form). Lint message mirrors struct-field equivalent — same format, same info-level severity, same SPEC §14.12.5 reference.

**Empirical verify:** `<phase>: (.Draft -> .Published) = .Draft` → W-LIFECYCLE-LEGACY-ARROW fires; `<phase>: (.Draft to .Published) = .Draft` → silent (canonical form). Existing lifecycle-shape1-tracker.test.js + type-system-lifecycle-landing-2-5.test.js (57 tests combined) still pass — zero regression.

- **Cross-refs:** SPEC §14.12.4 (`(A to B)` glyph; `->` is legacy with W-LIFECYCLE-LEGACY-ARROW); SPEC §14.12.5 (the lint definition); `docs/changes/lifecycle-source-form-followups-2026-05-26/progress.md`; mirrors struct-field emission at type-system.ts:2212-2225.

---

### Bug 24 — Lifecycle source-form follow-up: qualified-form discrim regex tolerance — `RESOLVED S138 (commit aa0395a7)` (was LOW heuristic; S135)

**Fix (S138 `aa0395a7`):** PA-direct surgical regex extension in `compiler/src/type-system.ts:isIsVariantCheckOf` (+12L incl. doc).

```
PRE:  is\s+\.\s*VariantName
POST: is\s+(?:[A-Z][A-Za-z0-9_$]*)?\s*\.\s*VariantName
```

Optional `(?:[A-Z][A-Za-z0-9_$]*)?` matches both bare-dot `is .Draft` (optional group empty) and qualified `is Article.Draft` (optional group = EnumName). Mirrors the parallel at `classifyWriteAgainstSpec` (lines 14644-14655) which already accepted either form for the WRITE-side classification — Bug 24 was the READ-side asymmetry.

**Regression tests:** +4 tests in §LL2-5_J — qualified `is Article.Draft` + transition() advances state / qualified without transition() still fires E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED / bare-dot regression preserved / mixed-form smoke test. All 32 lifecycle-landing-2-5 tests pass.

- **Cross-refs:** SPEC §14.10 (bare-variant inference); SPEC §14.12.6 (discrimination forms); `docs/changes/lifecycle-source-form-followups-2026-05-26/progress.md`.

---

### Bug 25 — Lifecycle source-form follow-up: `transition()` with deeper expressions — `RESOLVED S138 (commit 5160afad)` (was LOW heuristic; S135)

**Fix (S138 `5160afad`):** PA-direct surgical regex extension in `compiler/src/type-system.ts:TRANSITION_CALL_RE` (+15L incl. doc).

```
PRE:  /\btransition\s*\(\s*@?(IDENT)\s*\)/g
POST: /\btransition\s*\(\s*@?(IDENT)(?:\s*\.\s*IDENT)*\s*\)/g
```

Captured group still binds the ROOT identifier (which keys into the bindings map); the optional `(?:\s*\.\s*<ident>)*` trailing path is consumed but not captured. Mirrors the RESET_CALL_RE pattern (S134 Q6-narrow) which already accepted the dotted-path form.

**Regression tests:** +3 tests in §LL2-5_J — `transition(u.field)` dotted-path advances root / `transition(u)` bare form preserved / `transition(u.field.deeper)` deep dotted-path advances root. All 35 lifecycle-landing-2-5 tests pass.

**Deferred sub-case:** Array-index form `transition(items[0])` per the original bug filing is a SEPARATE shape; deferred. Adopters can factor into a local binding first: `let i = items[0]; transition(i)`.

- **Cross-refs:** SPEC §14.12.6 (transition forms); `docs/changes/lifecycle-source-form-followups-2026-05-26/progress.md`; mirrors RESET_CALL_RE pattern (S134 Q6-narrow) at type-system.ts:14589.

---

### Bug 26 — `${...}` inside `function probe() { ... }` body emits E-SCOPE-001 for `$` — `LOW` (S135)

A `${...}` block placed inside a bare `function name() { ... }` body emits an unexpected `E-SCOPE-001` diagnostic for the leading `$` character. The `${` token gets preprocessed differently inside function bodies vs at structural positions. Unrelated to the silent-swallow class that S135 structural-in-logic landing closed — surfaced as a Phase 0 probe side-finding.

- **Workaround:** don't nest `${...}` inside a bare `function` body — use `${...}` at structural positions (inside `<program>`, `<page>`, etc.), or use bare statements inside the function body (no `${...}` wrapper needed since the function body is already in code-context).
- **Status:** filed S135 in structural-in-logic progress.md; orthogonal to silent-swallow class. Extend on real adopter friction.
- **Cross-refs:** `docs/changes/structural-in-logic-body-2026-05-26/progress.md`.

---

### Bug 27 — `tryParseStructuralDecl` extra lookahead on structural-element compound forms — `cleanup` (S135)

`tryParseStructuralDecl` enters the compound-state-decl branch when it sees `<schema><users>...` (treating it as a potential compound state-decl with field `users`), then rewinds when the child `<users>` doesn't have an `=` RHS. Works correctly (the rewind handles it; the parent eventually emits `E-STRUCTURAL-ELEMENT-MISPLACED` per the S135 structural-in-logic fix) but does extra lookahead work that could be short-circuited by checking the leading-tag name against the structural-element registry FIRST.

- **Workaround:** none needed — current behavior is correct; only the lookahead cost is wasted.
- **Status:** filed S135 in structural-in-logic progress.md as a cleanup opportunity. Not a bug. Extend on parser-performance signal.
- **Cross-refs:** `docs/changes/structural-in-logic-body-2026-05-26/progress.md`.

---

### Bug 33 — W-LINT-011 false positive on `:let={}` slot-binding shape — `RESOLVED S138 (commit 5ec84589)` (was LOW; R24-BUG-7)

**Fix (S138 `5ec84589`):** PA-direct surgical 1-character regex change in `compiler/src/lint-ghost-patterns.js` Pattern 11 W-LINT-011. Pre-fix regex `\s:[a-z][a-zA-Z0-9-]*\s*=` greedily matched scrml's reserved `:let={(row) => ...}` slot-binding form. Post-fix `\s:(?!let\b)[a-z][a-zA-Z0-9-]*\s*=` uses negative-lookahead `(?!let\b)` to exclude the reserved form while keeping genuine Vue-shape `:attr=` caught. Word-boundary `\b` ensures `:letFoo=` (longer ident starting with `let`) STILL fires the lint.

**Regression tests:** +3 tests in `lint-ghost-patterns.test.js` §W-LINT-011 — `:let={(row) => ...}` does NOT fire / bare arrow body does NOT fire / `:letFoo=` still fires (word-boundary correctness). Existing 100 lint-ghost-patterns tests all pass.

**Surfaced separate gap (not closed by this fix):** W-ATTR-001 fires saying `let=` is not recognized on `<column>`. The lint recognition is now correct (no W-LINT-011 false positive) but the attribute-registry hasn't yet wired `:let=` as a recognized slot-binding attribute. That's a downstream codegen-side gap — see follow-on Bug 54 if filed.

- **Cross-refs:** R24-BUG-7 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`; SPEC §41.16.3 + §16.6 (canonical slot grammar); OQ-TF-11 MEDIUM verdict S105 (explicit `:let=` ratified).

---

### Bug 34 — Shape-2 compound markup-init emits empty 2nd arg to `_scrml_reactive_set` — `LOW` (S136 R24)

A Shape-2 compound state cell like `<form><title>= <input type="text"/></form>` (compound with markup init on a field) emits `_scrml_reactive_set("newTicketForm.title", )` — the 2nd argument is empty. Surfaced by dev-4-pascal overseer.

- **Reproducer:** in dev-4-pascal.scrml — Shape-2 compound `<newTicketForm>` with markup-init fields.
- **Spec reference:** SPEC §6.2 Shape 2 (decl-coupled-with-render-spec) — the init value should be the bind-source for the input.
- **Current behavior:** Shape-2 compound init handler doesn't pass the render-spec init value through.
- **Expected behavior:** the markup init value is the bind-source; emit `_scrml_reactive_set("newTicketForm.title", "")` (or the appropriate init).
- **Suggested fix scope:** codegen — Shape-2 compound init handler.
- **Cross-refs:** R24-BUG-8 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 45 — `int` ghost type silently resolves to `asIs` (causes downstream `E-SCHEMAFOR-NO-SQL-MAPPING`) — `LOW` (S136 R25; 4/4 devs)

`int` is used in struct field type position by kickstarter §6.1 examples (`age: int(>=18)`), PRIMER §6.5 example (`id: int`), AND the R25 BRIEF. ALL 4 R25 devs reached for `int`. Compiler's `BUILTIN_TYPES` only has `integer` and `number` — `int` falls through to `asIs` (any-type) silently, then `schemaFor(StructType)` breaks with a confusing downstream `E-SCHEMAFOR-NO-SQL-MAPPING: ... declared type (asIs) has no v1.0 SQL mapping`. The actual root cause ("unknown type name `int`") is not surfaced at the struct-field-type declaration site.

The canon is wrong about `int`, OR the compiler should alias it to `integer`. Adopter signal is strong: 4/4 devs reached for it from canon-derived expectation.

- **Reproducer:** `type Foo:struct = { id: int, count: int }` + `schemaFor(Foo)` → confusing E-SCHEMAFOR-NO-SQL-MAPPING.
- **Spec reference:** SPEC §14 type-system primitives + §39 schema DDL mapping.
- **Suggested fix scope (two options):**
  - **(a)** Register `int` as alias for `integer` in `BUILTIN_TYPES` — matches canon's adopter-facing usage; minimal change.
  - **(b)** Emit `E-UNKNOWN-TYPE-NAME` at struct-field-type position (fail fast) AND fix kickstarter + PRIMER + BRIEF to use `integer` consistently — pin canon, reject ambiguous shorthand.
  - **PA-lean:** (a) — canon already uses `int`, adopter signal is 4/4 reach; aligning compiler to canon is the right answer per Rule 3.
- **Cross-refs:** Bug 45 in `gauntlet-r25-report.md`.

---

### Bug 46 — `tableFor` attributes `sortable=` / `selectable=` not implemented (W-ATTR-001 forwarded as plain HTML) — `LOW` (S136 R25; 4/4 devs)

The R25 BRIEF feature 8 references `<tableFor for=Card rows=@cards pick=[...] sortable= selectable=@selectedIds/>`. The `sortable=` and `selectable=` attributes fire `W-ATTR-001` ("not recognized on `<tableFor>`, forwarded as plain HTML attribute") — no semantic effect. The BRIEF specifies these attributes per SPEC §41.16 (tableFor spec), but the compiler hasn't shipped the wiring.

- **Reproducer:** any `<tableFor for=T rows=@cells sortable=true selectable=@selected/>` — W-ATTR-001 ×2.
- **Spec reference:** SPEC §41.16 (tableFor — sortable + selectable attribute surface).
- **Suggested fix scope (two options):**
  - **(a)** Ship the attributes (Landing N) — implement sort header rendering + selectable checkbox column + auto-synth `@<varName>.sortedBy` / `@<varName>.selected` cells.
  - **(b)** Remove from BRIEF/SPEC examples until implemented.
  - **PA-lean:** (a) — these are SPEC-specified flagship features for the L22 family; not shipping them is a real gap. ~v1.0 priority.
- **Cross-refs:** Bug 46 in `gauntlet-r25-report.md`; SPEC §41.16.7 (sort), §41.16.8 (selection).

---

### Bug 51 — Shape 2 + render-by-tag empirically broken end-to-end at codegen — `RESOLVED S139` (was MED — all 3 sub-bugs closed)

**S139 investigation surfaced a wider scope than the original entry described.** Shape 2 `<userName req length(>=2)> = <input/>` + render-by-tag use-site `<userName/>` was empirically broken in THREE distinct ways, none of which had adopter-test coverage (no Shape 2 sample in `samples/` or `examples/`; existing unit/integration tests only checked AST shape, not the emitted JS / HTML):

**Bug 51-A — CE drops `_scope` from new FileAST (silent codegen miss). RESOLVED S139 `5640148e`.**
`component-expander.ts:runCEFile` constructs `const updatedAst = {...ast, ...}`. `{...ast}` only copies ENUMERABLE properties. SYM attaches `_scope` non-enumerably to the FileAST (`symbol-table.ts:9521`). Post-CE the new AST has no `_scope`. emit-html.ts reads `fileAST?._scope` (emit-html.ts:576) → null → the render-by-tag expansion at emit-html.ts:1300 is short-circuited by `&& fileScope`. EVERY adopter file with a Shape 2 use-site silently emitted the literal tag in HTML instead of expanding to its bound `<input>`. Fix: `runCEFile` re-attaches `_scope` via `defineProperty` on the new AST; emit-html.ts:576 also extended to `fileAST?._scope ?? fileAST?.ast?._scope ?? null` (shape-agnostic — codegen sometimes gets the FileAST directly, sometimes gets the `{filePath, ast, errors}` wrapper).

**Bug 51-B — Shape 2 empty-string init produces empty-arg `_scrml_reactive_set` emit. RESOLVED S139 `5640148e`.**
`ast-builder.js:4169` sets `init: ""` (raw empty string) for Shape 2 markup-RHS decls. emit-logic.ts:1971 does `const initStr = node.init ?? "null"`. `??` doesn't fire on empty string. initStr stays `""`. The downstream emit produces `_scrml_reactive_set("userName", )` with an empty argument (legal JS per ES2017 trailing-comma; runtime sets cell to `undefined`). Fix: emit-logic.ts treats `initStr === "" && !initExpr` as missing-init sentinel → falls back to `"null"` (the canonical scrml absence per §42.5).

**Bug 51-C — Auto-lift at top of `<program>` body drops the markup RHS. RESOLVED S139 `da4ffd1a`.**
At top-level of `<program>` body, BS split the Shape 2 decl into a text block (LHS only — `<userName req length(>=2)> = `) AND a sibling markup block (the `<input/>` RHS). The auto-lift captured only the LHS — the parser produced a Shape 1 plain cell with no renderSpec, and the use-site fired `E-CELL-NO-RENDER-SPEC` at SYM. Fix: new BS scanner `scanShape12DeclEnd()` (`block-splitter.js`) scans the WHOLE Shape 2 decl span (LHS opener + `=`/`:` + markup RHS) and emits the entire span as a single text block, mirroring the compound-state-decl path (`scanCompoundBlockEnd`). For Shape 1 expression-RHS and Shape 3 multi-line `match {…}` derived, the scanner returns -1 and the existing per-char text accumulation handles them (regression-guarded — pre-flip-to-FIX, a wrong scanner draft truncated multi-line expression-RHS at end-of-line, breaking match-arm-rhs-bare-variant-unmask test §2.1). The pre-existing text accumulation (e.g. `const ` prefix before `<NAME>`) is preserved by anchoring the gobbled block at `textStart` when set, so `const <derived> = expr` Shape 3 forms keep their `const` prefix in the same text block (required by ast-builder.js's TOPLEVEL_STATE_DECL_RE lift regex).

- **Reproducer (now working with workaround):**
  ```scrml
  <program>${ <userName req length(>=2)> = <input type="text"/> }<userName/></program>
  ```
- **Post-S139 emit:** HTML expands `<userName/>` to `<input type="text" required="" minlength="2" data-scrml-render-by-tag="...">`. client.js emits `_scrml_reactive_set("userName", null)` (valid arg) + bind:value/input event wiring + reactive effect for the input.
- **Adopter test surface added S139:** `compiler/tests/unit/bug-51-shape-2-render-by-tag-end-to-end.test.js` (+233L; 6 tests across 3 sections — Bug 51-A canonical + multi-use; Bug 51-B valid-arg emit + emit shape; Bug 51-C workaround-passes + open-gap-still-fires-regression-guard). Closes the corpus-coverage gap that silently masked all three sub-bugs.
- **Cross-refs:** README.md block #2 (the v0.6.2 cut surface that revealed Bug 51); kickstarter §3.1 Shape 2 canonical form; SPEC §6.4 render-by-tag; SPEC §40.8 default-logic-mode; SPEC §42.5 scrml absence → JS null. Bug 56 (S139 — CPS scheduler bugs) shared the same pattern of `node --check`-clean emit producing runtime-broken semantics.

A Shape 2 cell decl placed at top-level inside `<program>` body (`<newTask req length(>=1)> = <input/>`) is auto-lifted per SPEC §40.8 default-logic mode (and per the W-PROGRAM-REDUNDANT-LOGIC lint message which explicitly promises the auto-lift). But the lifted form is classified as Shape 1 (plain cell) — render-spec metadata is dropped between the auto-lift and the symbol-table cell-classifier. `<newTask/>` render-by-tag at a downstream use-site then fires `E-CELL-NO-RENDER-SPEC` claiming the cell has no render-spec.

Wrapping the SAME Shape 2 decl explicitly in `${...}` compiles cleanly — the use-site `<newTask/>` resolves correctly via render-by-tag. So this is a default-logic-auto-lift gap, NOT a Shape 2 classifier gap.

- **Reproducer (minimal):**
  ```scrml
  <program>
  <userName req length(>=2)> = <input type="text"/>
  <form>
      <userName/>
  </form>
  </>
  ```
- **Current behavior:** `E-CELL-NO-RENDER-SPEC: <userName/> used as render-by-tag in markup, but the cell has no render-spec (Shape 1 plain cell).` + `W-PROGRAM-REDUNDANT-LOGIC` lint claiming the bare decl auto-lifts (contradictory signals).
- **Expected behavior:** the Shape 2 decl auto-lifts AND retains render-spec metadata; `<userName/>` use-site dispatches via render-by-tag identically to the explicit-`${...}`-wrap form.
- **Empirical workaround:** wrap the Shape 2 decl in an explicit `${...}` block inside `<program>` body. The W-PROGRAM-REDUNDANT-LOGIC lint will fire as informational only; compile succeeds.
- **Suggested fix scope:** investigate where in the BS → ast-builder → symbol-table chain the auto-lift step strips the cell's `_cellKind = "shape-2"` metadata + bound render-spec node. Likely in default-logic body-mode handling for `<program>` body (post-S111 §4.18 quoted-text + §40.8 default-logic). Unit test §B6.2 in `render-by-tag.test.js` passes because its source uses `${...}`-wrap — empirical bare-decl path bypasses that test (canary-class lesson + S138 R26 doctrine — synthesized/wrapped AST passes; real-source auto-lift path fails).
- **Cross-refs:** README.md block #2 (the v0.6.2 cut surface that revealed the bug); kickstarter §3.1 Shape 2 canonical form (`<userName req length(>=2)> = <input type="text"/>`); SPEC §40.8 default-logic-mode body parsing; SPEC §6.4 render-by-tag; `compiler/tests/unit/render-by-tag.test.js` §B6.2 (the unit test that bypasses the bug via `${...}` source pattern).

---

### Bug 50 — `<tableFor>` synthetic `onchange` handler emits raw `if-stmt` inside object-literal property value — `RESOLVED S138 (commit c89f1176)` (was MED; NOT-REPRODUCED S138 closure REVERSED at cc93c031; HIGH re-classification; RESOLVED PA-direct surgical)

**Fix (S138 `c89f1176`):** PA-direct surgical fix in `compiler/src/codegen/emit-event-wiring.ts` Case B (arrow function detected via `isArrowFunction`). When `binding.handlerExprNode` is absent (the synth-fallback-string path — used by emit-table-for's `selectable=@cell` master-checkbox + per-row onchange synth), route through `rewriteExprArrowBody` directly (which skips Pass 1 `rewritePresenceGuard`) instead of `emitExprField` (which falls through to `rewriteExprWithDerived` → Pass 1 → `( ident ) => { body }` matched as `given x => body` presence-guard → `if (x !== null && x !== undefined) { body }`).

Mirrors the established precedent at `emit-expr.ts:emitEscapeHatch` lines 1356-1382 (Bug C 6nz 2026-04-20) which documents the exact same gotcha for ArrowFunctionExpression escape-hatches.

**Regression test:** `compiler/tests/unit/onchange-arrow-fallback-r24-bug-50.test.js` (NEW; +233L; 7 tests): fallback-string arrow round-trips / reactive refs rewrite / emitted map passes new-Function check / regression — non-arrow plain-expr still wraps function(event) / regression — call-ref shape still works / regression — `is .Variant` inside arrow body still lowers / master-checkbox synth shape exactly.

**R26 EMPIRICAL VERIFICATION** (PA dual-verify, both R24 sources):

| Source | Pre-fix `node --check` | Post-fix `node --check` | Onchange emit shape |
|---|---|---|---|
| dev-3-svelte R24 (re-verify source) | FAIL (SyntaxError 'if' at line 512) | PASS | `"_scrml_attr_onchange_28": evt => { ... }` |
| dev-1-react R24 (bug entry's named source — confirmed R24 not R25) | FAIL (SyntaxError 'if' at line 646) | PASS | `"_scrml_attr_onchange_28": evt => { ... }` |

R24-only — dev-1/2/3/4 of R25 all use `selectable="true"` string form (Bug 46 — `selectable=` forwarded as plain HTML, no synth onchange); R24 sources use `selectable=@cell` reactive-ref form which triggers the synth onchange path.

**Methodology cross-references** (bidirectional R26 doctrine in action):
- Bug 50's "dev-1-react" attribution was correct — for R24, not R25. My S138 NOT-REPRODUCED closure at `3a482076` swept R25 instead of R24. Reverse-direction CROSS-SOURCE-SWEEP sub-rule (banked at scrml-support `4ad336e` + pa.md `dbb47c3`) would have caught the mistake. The Bug 50 redux IS the empirical-canary applied to PA classification quality.
- Bug 50 was UNMASKED by R24-BUG-4 BS-closer fix `adc0a70f` (landed earlier same session). dev-3-svelte didn't compile through to codegen pre-R24-BUG-4. Reverse-direction SIBLING-FIX-UNMASK sub-rule (also banked in `dbb47c3`) would have surfaced this — re-verify NOT-REPRODUCED claims AFTER session-recent reachability-changing fixes land, not before.

**Surface trace** (for future similar bugs):
- `compiler/src/codegen/emit-table-for.ts:buildMasterCheckboxCell` lines 751-758 — builds the synth onchange raw string `(evt) => { ... }`
- `compiler/src/codegen/emit-event-wiring.ts` Case B — fallback-string path THIS fix
- `compiler/src/codegen/rewrite.ts:rewritePresenceGuard` lines 582+ — the (over-eager) sweetener that misfires in event-handler value position
- `compiler/src/codegen/emit-expr.ts:emitEscapeHatch` lines 1356-1382 — the Bug C 6nz precedent for the same gotcha

- **Cross-refs:** R24-BUG-4 `adc0a70f` (the BS-closer fix that unmasked Bug 50); Bug 52 R26 dual-verify run (where I caught the symptom re-firing on dev-3-svelte); pa.md S138 R26 doctrine bidirectional (forward Bug 49 / reverse Bug 50 redux); pa.md `dbb47c3` cross-source-sweep + sibling-fix-unmask sub-rules; `feedback_r26_empirical_verification.md` PA-memory.

**S138 RE-OPEN.** Initial S138 closure at `3a482076` was wrong: I swept R25 devs (the bug entry's named source `dev-1-react.client.js`) and saw zero occurrences. Re-verification on dev-3-svelte R24 source (during PA R26 dual-verify of Bug 52) shows the symptom DOES reproduce. The Bug 50 report's described reproducer (`selectable=@selectedIds` reactive ref + `onchange={evt => ...}`) actually matches dev-3-svelte R24 line 239 (`<tableFor ... selectable=@selectedIds>`) — NOT dev-1-react R25 (which uses string `selectable="true"`).

**Methodology lesson banked** (extends pa.md S138 R26 bidirectional doctrine, reverse direction sub-rule): R26 reverse-direction verification MUST sweep CROSS-SOURCE, not just the bug's named-source. The bug entry's source attribution may be wrong, OR the symptom may have moved between sources, OR a sibling fix may unmask it on a different source. The R24-BUG-4 BS-closer fix at `adc0a70f` is exactly this — closing the BS gate unmasked Bug 50 on dev-3-svelte (which now compiles through to codegen where Bug 50 fires).

**Empirical reproducer (re-verified S138 at HEAD `a30d86d1`):**

```bash
bun compiler/bin/scrml.js compile \
  /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r24/dev-3-svelte.scrml \
  --output-dir /tmp/r26-bug-50-redux
node --check /tmp/r26-bug-50-redux/dev-3-svelte.client.js
# /tmp/r26-bug-50-redux/dev-3-svelte.client.js:512
#     "_scrml_attr_onchange_28": if (evt !== null && evt !== undefined) {
#                                ^^
# SyntaxError: Unexpected token 'if'
```

The emitted shape at line 511-518:

```js
const _scrml_change_handlers = {
  "_scrml_attr_onchange_28": if (evt !== null && evt !== undefined) {
    if (_scrml_reactive_get("selectedIds").length === _scrml_reactive_get("visibleTickets").length) {
      _scrml_reactive_set("selectedIds", []);
    } else {
      _scrml_reactive_set("selectedIds", _scrml_reactive_get("visibleTickets").map(r => r.id));
    }
  },
};
```

Object-literal property value is a raw `if`-stmt. JS doesn't allow statements in expression position; the handler body should be wrapped as a function expression (`function(evt) { ... }` or `(evt) => { ... }`).

**Source loci** in dev-3-svelte:

- Line 237-243: `<tableFor for=Ticket rows=@visibleTickets selectable=@selectedIds pick=[...]>`
- Line 246+: implicit synth onchange tied to selectable=

The `selectable=@selectedIds` (reactive-ref form) triggers a synth onchange handler that the codegen emits with the raw `if` shape rather than wrapping as a function.

**Surface:** likely an event-handler emission path that fires for tableFor's synth onchange but bypasses the function-wrapping step. Site candidates: `compiler/src/codegen/emit-table-for.ts` (the tableFor expander emitting selectable= wiring) OR `compiler/src/codegen/emit-event-wiring.ts` (the generic onchange/event-handler emitter — looking for the object-literal accumulation that misses the wrapping for synth handlers).

**Cross-refs:** R24-BUG-4 dispatch (closing the BS gate unmasked this on dev-3-svelte); Bug 52 R26 dual-verify run (where I caught the symptom re-firing); my S138 NOT-REPRODUCED closure at `3a482076` (now superseded). pa.md S138 R26 doctrine (reverse direction sub-rule about cross-source sweep — added below in the doctrine bank).

---

---

### Bug 48 — Latent paren/bracket-depth gap in sibling `<match>` / `<machine>` / `<engine>` opener finders — `LOW; latent` (S137 — surfaced by Bug 37 agent investigation)

Same-shape bug class surfaced by the R25-Bug-37 dispatch agent (`1ce963d0`). Bug 37 fixed `_findEachOpenerEnd` in `compiler/src/ast-builder.js` by adding `parenDepth` + `bracketDepth` tracking alongside the existing braces+quotes tracking. THREE sibling finders in the same file have the same braces+quotes-only shape and would fail the same way under an inline-arrow-in-attribute-value adopter pattern:

- `_findMatchOpenerEnd` instance 1 (line 10953, `<match>` block-form opener)
- `_findMatchOpenerEnd` instance 2 (line 11871, `<match>` other dispatch)
- `_findOpenerEnd` (line 11562, `<machine>` / `<engine>` openers)

**Not currently fired by adopter patterns.** Canonical `<match for=Type on=expr>` and `<engine for=Type initial=.Variant>` openers don't typically carry paren-wrapped inline arrows in their attribute values (the canonical shapes route arrows through brace-bodies — `derived=match @x { .V1 => .V2 }` keeps arrows INSIDE braces, depth > 0 via existing brace tracking, so braces-only suffices). Latent class, not adopter-visible today.

- **Reproducer (hypothetical):** `<match for=Filter on=@items.filter(c => c.foo == 1)>` OR `<engine for=Phase initial=.Loading data=@items.filter(c => ...)>` — would trigger the same truncation as Bug 37 if exercised.
- **Workaround:** hoist the inline-arrow expression to a derived cell first (same as Bug 37 workaround) — but the canonical scrml shapes don't require this for these structural openers.
- **Suggested fix scope:** mechanical — extend each of the three sibling finders with the same `parenDepth`+`bracketDepth` tracking pattern Bug 37 applied to `_findEachOpenerEnd`. ~30L total across three sites + a few regression tests.
- **Trigger to elevate:** ≥1 adopter friction report exercising inline-arrow attribute values on `<match>` / `<machine>` / `<engine>` openers OR any audit that demonstrates the shape is canonical (would re-elevate to MED).
- **Cross-refs:** Bug 37 RESOLVED S137 `1ce963d0`; agent dispatch BRIEF.md + progress.md at `docs/changes/r25-bug-37-each-arrow-truncation-2026-05-27/`.

---

## §4 Nominal — SPEC sections deliberately spec-ahead-of-implementation

These are SPEC-only surfaces — designed, normatively documented, NOT yet implemented in the compiler. The author has explicitly ratified them as "spec-ahead-of-implementation" (Nominal sections). Adopters should treat as roadmap, not present capability.

### Nominal-1 — Build Story §58 — `nominal`

S118 landed SPEC §58 "Build Story" as a Nominal section. Compilation as a pure function `compile(source, buildStory) → artifact`; content-addressed Merkle closure (Approach B); `[story]` manifest table; per-`<program>` `story=` attribute; `build-story.lock` sidecar; cryptographic SHA-256 closure hash. **No compiler implementation exists.** Includes a §58.12 determinism-gap analysis flagging the `*`-marked claims.

- **Status:** Nominal. Implementation arc estimated ~90-200h (per S124 build-story-research-roughing); M6-gated (M6 cutover precedes substantive build-story work).

### Nominal-2 — `import:host` §21.3.1 — `nominal`

S114 ratified `import:host` declaration form as the manifest-gated self-host bootstrap bridge (Approach C carve-out). **Zero references in `compiler/native-parser/` or `compiler/src/`** per S129 D8b finding — the syntax is SPEC-only.

- **Status:** Nominal. Implementation arc is part of the self-host bootstrap migration (post-v1.0 — see master-list).

### Nominal-3 — Quoted-text model §4.18 compiler fire — `nominal`

SPEC §4.18 landed Wave 1 S111 — the code-default body mode + `"..."` display-text literal + `E-UNQUOTED-DISPLAY-TEXT` error code. The compiler fire is spec-ahead-of-implementation; Waves 2+ ship with the native parser (v0.4.x → v0.5).

- **Status:** Nominal until native parser default-flip + quoted-text BS-retrofit / native-implementation lands. The examples in dev.to articles + samples that show bare display prose inside engine/match arm bodies are NOT wrong against today's compiler.

### Nominal-4 — `_{}` foreign code — `nominal`

§23 — embed non-JS code inline with level-marked braces (`_{}`/`_={...}=`). Enables inline Rust, Python, SQL extensions. Specced, not yet implemented.

### Nominal-5 — WASM call-char sigils — `nominal`

§23.3 — single-character sigils (`r{}`, `c{}`, `z{}`) for invoking compiled WASM functions from Rust, C, Zig. Specced, not yet implemented.

### Nominal-6 — Sidecar process declarations — `nominal`

§23.4 — `use foreign:name { fn }` for declaring server-side sidecar processes (HTTP/socket services). Specced, not yet implemented.

### Nominal-7 — `RemoteData` enum — `nominal`

§13.5 — built-in `Loading / Loaded(T) / Failed(Error)` enum for modeling async fetch state. Pattern-matchable with exhaustive checking. Specced, not yet implemented.

---

## §5 Lifecycle annotation surface — DOC arc closed; IMPL has a remaining gap (S134 finding)

S130 lifecycle DD + HU-1 ratified `(A to B)` extension scope to non-engine cells (Approach C); 4 landings shipped, ONE prerequisite-impl gap surfaced S134:

| Landing | Scope | Status |
|---|---|---|
| 1 | E-TYPE-001 fire (per-access transition-state tracking for **struct fields**) | **SHIPPED S130** (`1feaedc9`) — see §7 rotation |
| 2 | Approach C SPEC extension to fn params + fn return + schema fields + channel cells + Shape 1 + `->` → `to` glyph migration + new §14.12 subsection + `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` engine-cell rejection | **SPEC SHIPPED S130** (§14.12 normative; engine-cell carve-out + `W-LIFECYCLE-LEGACY-ARROW` + §34 catalog rows). ⚠️ **Shape 1 per-access tracker NOT implemented** — surfaced S134 Q6 Phase-0 STOP; filed as Bug 19 in §1 HIGH. |
| 2.5 | S131 HU-2 fn-return hybrid mechanism (presence-progression discrimination-IS-transition + variant-progression explicit `transition()`); SPEC §14.12.6 + §14.12.6.1–6.4; `E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED` | **SHIPPED S131** |
| 3 | PRIMER + kickstarter flagship section (per F-023) — `(A to B)` canon-corroboration | **SHIPPED S134** — PRIMER §6.5 + kickstarter §3.2 + §7 anti-pattern table rows (1 engine-cell, 1 legacy-glyph, 1 over-applied-`transition()`) |
| 4 (S134 const-deep-freeze Q6 ratification) | SPEC §6.8.3 — `reset(@cell)` × lifecycle interaction (symmetric reset reverts per-access transition state per pre-type membership) + §14.12.10 cross-ref bullet | **SPEC SHIPPED S134** · **Impl SHIPPED S135 `2ffe4f6a`** via Q6-narrow (see below). |
| **B-prereq (S134)** | Shape 1 per-access lifecycle tracker — covers `state-decl` AST nodes (both struct-typed Shape 1 with lifecycle in struct-field, and cell-value-typed Shape 1 with lifecycle in cell type) | **SHIPPED S134** (`fd58893e`) — Option α architecture; `collectStructBindings` extension + NEW cell-value-typed tracker via reused `checkLifecycleBindingAccess` with additive params. +25 tests. Closes Bug 19 HIGH. Unblocks Q6-narrow. |
| **Q6-narrow (S135)** | `reset(@cell)` × lifecycle interaction impl — type-system tracker observes reset-path writes + routes through `classifyWriteAgainstSpec` to revert per-access state per §6.8.3 SPEC. Tracker 1 (cell-value Shape 1) + Tracker 2 (struct-typed Shape 1 field lifecycle) | **SHIPPED S135** (`2ffe4f6a`) — Option α additive: `RESET_CALL_RE` regex + new Pass in `processStatementText` mirroring transition handling; +355/-10 type-system.ts; NEW `lifecycle-shape1-reset.test.js` 25 tests. Baseline 21,701 → 21,726; zero regressions. Closes §6.8.3 SPEC-ahead-of-impl bullet. Two heuristic limitations filed as LOW. |
| **Source-form follow-ups (S135)** | `findTopLevelArrow` whitespace tolerance + `parseLifecycleReturnAnnotation` qualified-enum stripping + diagnostic preLabel + `TRANSITION_CALL_RE` `@` prefix tolerance — closes the source-form gap for Shape 1 variant-progression lifecycle annotations (`(.Draft to .Published)` + `(Article.Draft to Article.Published)` forms both work end-to-end from source now) | **SHIPPED S135** (`a7167b6b` + `fefecb1b` + `a5feca4b` + `1f6cc614`) — three surgical fixes + 17 new source-form tests in `compiler/tests/unit/lifecycle-shape1-source-form.test.js`. Baseline 21,726 → 21,743; zero regressions. Three new heuristic limitations filed as LOW (Bug 23/24/25). |

Authority: lifecycle DD at `scrml-support/docs/deep-dives/lifecycle-annotation-extension-and-flagship-scope-2026-05-25.md`; HU-1 at `docs/heads-up/lifecycle-annotation-extension-2026-05-25.md`; const-deep-freeze HU at `docs/heads-up/const-deep-freeze-2026-05-26.md` (Q6 ratification + Bug 19 surfacing); SPEC §14.12 + §6.8.3 normative spec.

---

## §6 Adopter bugs queued (filed but not yet fixed)

- **6nz-V** — `class:NAME` on for-lift reused DOM nodes — see Bug 11. **RESOLVED S139** (runtime fix in `_scrml_effect` tracking-pause-restore).
- **6nz-U** — filed S126; queued. (Details in `handOffs/incoming/read/`.)
- **6nz-L / 6nz-T** — filed S126; M6-deferred. (Details in `handOffs/incoming/read/`.)
- **GITI-015** — filed S124; LOW. (See Bug 18.)

---

## §7 Closed in S110-S131 (rotation; will rotate out next refresh)

**S131:**
- **Bug 15 (MED) — `~snapshot` raw-sigil codegen leak** — SHIPPED per HU-5 Q-W35-1 (a) ratification. Two-part defensive codegen fix: (1) `emit-logic.ts:bare-expr` skips the spurious orphan `~` bare-expr the live parser peels off `~snapshot = {...}` leads; (2) `emit-expr.ts:emitIdent` adds a defensive marker `null /* ~ orphaned — codegen-fallback */` for any nested-expression orphan that bypasses the bare-expr branch. Regression test `compiler/tests/integration/tilde-snapshot-codegen-fix.test.js` (3 tests, all pass). SPEC §32 unchanged per pa.md Rule 4 — `~snapshot` is NOT a new language form; the native parser already handles the unified `~ IDENT = expr` lead, mirroring that in the live parser surfaceable as a separate follow-up. Closes the S125 Wave 14 DD-surfaced silent-correctness class for the tilde-decl reactive-deps path.

**S130:**
- **Bug 8 (HIGH) — E-TYPE-001 lifecycle access-before-transition fire** — Landing 1 SHIPPED (`1feaedc9`). Per-access transition-state tracking implemented in `compiler/src/type-system.ts` (+666 LOC + design pick β symbol-table side-table mirroring `checkFunctionBodyStateCompleteness` precedent). +33 new tests (27 unit / 6 integration) / +50 expect() calls. Closes the ~6+ week SPEC §14.3 line 7106 spec-vs-impl gap that the mutability-contracts article publish-twin's status banner had been acknowledging. Diagnostic message names binding + field name + struct type + pre-state type + post-state type + resolution path + SPEC anchor. Landing 2 (extension to non-engine cell positions + `->` → `to` glyph migration + engine-cell rejection diagnostic) queued.
- **Phase 2 Cluster A — V-kill SPEC sweep** — A1-A6 all 6 amendments landed (`b0244869`). Grammar production relocated to §6.1.5; §52.4.1 grammar folds in; ~90 worked-example sites migrated SPEC-wide. Closes F-001 / F-008 / F-009 / F-016 (1a/1b LB).
- **Phase 2 Cluster B-code — Approach C source-cascade** — 9 of 10 sites cleaned (`35262911`). Site 1 (`rewriteBunEval` function retirement) DEFERRED pending three prerequisite sub-tasks (META_BUILTINS purge → 5 meta-eval call drops → Pass 4 drop + test retire). Agent's Phase-0 root-cause confirmation caught the brief's "zero callers" assumption was wrong (7 active callers); banked-rule earning its keep. Closes F-002 / F-003 / F-009 (1a) / F-010 (compiler half).
- **F-021 PIPELINE `deriveEngineVarName`** — PIPELINE doc-only fix per HU-2 Q6 ratification. Compiler already aligned with SPEC §51.0.C.
- **F-019 `<schema>` placement** — SPEC §39 prose rewrite per HU-2 Q7 ratification (no longer documents "alongside not inside"; immediate child of `<program>`). E-SCHEMA-003 catalog row updated. (Compiler-side enforcement still open — see Bug 13.)
- **F-018 §55.5 validity surface predictability** — SPEC + PIPELINE prose alignment per HU-2 Q8. Compiler already implements unconditional synthesis.
- **F-003 Approach C SPEC subsumption** — §22.4 + §30 + §7.2 + §22.12 + §34 amendments per HU-2 Q4 ratification. `bun.eval()` retires as user-facing surface. (Compiler-source cleanup of 8 sites in flight S130 Cluster B-code dispatch.)
- **MCP V0.D** — `<program mcp>` attribute wiring + auto-install per SCOPING §3.D. (V0.E still pending — see Bug 14.)
- **Lifecycle annotation HU-1** — 7 ratifications closed; Phase 2 amendment scope crystallized (3 landings).

**S129:**
- **HU-2 batch (6 questions + lifecycle thread)** — F-001 / F-008 / F-009 / F-016 V-kill cluster ratifications; F-023 + F-024 lifecycle annotation flagship + `(A to B)` syntax.
- **D8a-i function `-> ReturnType` annotation** — native parser fix; 4 corpus files closed; +21 tests.

**S128:**
- **D3 `:>`-arm separator** — native parseMatchArm now accepts `:>` per live-parity.
- **D6 string-literal import specifier** — `import { "kebab" as alias }` per SPEC §38.12.5.
- **D7 `given` presence-guard** — `given ident => { body }` per §42.2.3.

**S126:**
- **Bug W (CRITICAL)** — precedence-aware `emitBinary`; `(2+3)*4` no longer silently drops grouping parens.
- **GITI-017 (CRITICAL silent-corruption class)** — `not` keyword no longer corrupts regex literals; lowering pass now skips regex bodies + comments + string interiors.
- **6nz-P** — runtime chunker tree-shake gap; declarative `CHUNK_DEPENDENCIES` table with `scope → [timers, animation]` edge.
- **GITI-019** — lift-loop coalesce parens before `?? ""`.
- **GITI-018** — multi-`scrml:` library-mode imports now all rewrite.
- **6nz-S** — `return not` statement-glue at both lowering sites.

**S123:**
- **Bug Q (V-kill / Unit CC)** — silent runtime → loud compile error. Bare `@x = expr` at default-logic body-top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`.

**S110-S122:**
- Native parser arc M1-M3 + MK1-MK3 (compiler-internal; opaque to adopters except as parse-completeness wins)
- v0.4.0 / v0.5.0 / v0.6.0 release cuts (S114/S115/S118)
- L22 family — formFor (S102-103) + schemaFor (S104) + tableFor (S105)
- Match block-form Phase 3+4+5 codegen
- Tailwind arbitrary-value families (grid / flex / aspect / transition / transforms / outline / ring length/color/var/keyword) — Bug 1 partial-impl per §2

---

## §8 Where this list comes from

- **Dogfood bug reports** filed when the user/PA hits friction on real adopter-shaped work — see `handOffs/incoming/read/` for archived reports.
- **Spec-vs-impl audit passes** when sweeping a SPEC section (e.g., the S107 §18.0 surface audit that discovered the match block-form gap; the S129 grammar-consolidation Phase 1a/1b/1c audits).
- **Adopter bug reports** (6nz + giti to date; queued in `handOffs/incoming/read/`).
- **PA self-discovery** during implementation work when a planned fix surfaces a deeper gap (e.g., the W-MATCH-RULE-INERT lint attempt surfacing the broader §18.0.1 unparsed state; S130 lifecycle DD surfacing the E-TYPE-001 unimplemented fire).
- **Deep-dive critical findings** (e.g., S130 lifecycle DD's `type-system.ts:1444` per-access transition-state gap).

## §9 Where to discuss / report

- **New gaps in adopter code:** file a GitHub Issue at https://github.com/bryanmaclee/scrmlTS
- **Cross-reference with phase status:** [`master-list.md`](../master-list.md) §0 LIVE DASHBOARD
- **Per-gap implementation arcs:** [`docs/changes/`](./changes/) — each gap with an active impl arc has a SCOPING.md + progress.md there
- **Per-session landings:** [`docs/changelog.md`](./changelog.md)
- **Audit + deep-dive doc inventory:** [`docs/audits/`](./audits/) + `scrml-support/docs/deep-dives/`
