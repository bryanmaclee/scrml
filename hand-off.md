# scrmlTS — Session 86 (IN-FLIGHT — landmark session)

**Date:** 2026-05-12 (S86; opened afternoon of 2026-05-12 → ongoing)
**Previous:** `handOffs/hand-off-85.md` (S85 close)
**This file:** will rotate to `handOffs/hand-off-86.md` at S87 open

**Tests in flight:** **11,580 pass / 114 skip / 1 todo / 0 fail / 562 files** at HEAD `d3deed2` (full suite via `bun run test`). Cumulative S85→S86 delta: **+73 pass / +14 skip / +5 files / 0 regressions**.

**Semver state:** unchanged — v0.2.6 `efbd1e8` is still the shipped baseline. v0.3.0 tag waits for v0.3 fixture-sweep + adopter content; the Wave 2 compiler + BS-layer + Approach A spec anchor land mid-cycle.

**Cross-machine sync:** clean both repos at this snapshot. Worktrees: 4 retained for forensics (Wave 2 a + b + BS-layer + scrml-dev codegen + Approach A spec) — cleaned at wrap.

---

## S86 — what happened (so far)

### Phase 1 — Session-open ops + Approach A spec-amendment authorization scoping

Sync clean. Hand-off rotated. PA-SCRML-PRIMER + master-list §0 + last ~10 contentful user-voice entries read. Inbox empty.

User picked **v0.3 Wave 2 brief** from session-open menu. PA authored the brief at `docs/changes/v0.3-wave-2/DISPATCH-BRIEF.md` (~530 lines covering 2 parallel sub-dispatches: item (a) migrate + item (b) TAB extension, file-disjoint, worktree-isolated).

### Phase 2 — Wave 2 parallel dispatches (item a + item b)

Two background dispatches via `general-purpose` (Opus, worktree). File-disjoint.

**Item (a) `bun scrml migrate --program-shape`** landed at `885eaa9`:
- `compiler/src/commands/migrate.js` +1108 LOC (608 → ~1716).
- `classifyFile` helper extracted + unit-tested (5 buckets: entry / route / module / schema-anchor / ambiguous).
- `applyProgramShapeRewrite` per-bucket; safety harness reused (compileScrml roundtrip parse-check gate).
- `--dry-run --report` mode for structured advisory output.
- +33 tests + 5 fixtures (one per bucket).
- **Known limitation surfaced:** existing `sanityCheckParse` stages rewritten source into `/tmp` without relative-path context, so files with cross-file imports fail the safety gate even when the rewrite is semantically correct. Multi-file route files classified correctly in `--report` but NOT auto-rewritten until Wave 3 v0.3 fixture-sweep handles them with proper path context. Left as-is per brief §3.3.4 "Do not weaken this gate."

**Item (b) TAB extension** landed at `41a4706`:
- `compiler/src/ast-builder.js` extended in 4 orthogonal ways:
  1. `<page>` recognized as default-logic body container (`isPageRoot` OR-included in childContext).
  2. Top-level decl regex family extended for `function` / `fn` / `server function` / `type` / `let` / `const` + `export` prefix support.
  3. `W-PROGRAM-REDUNDANT-LOGIC` emission when `<program>` / `<page>` body wraps top-level decls in redundant `${...}` block.
  4. `<page>` per-route attr validation: `E-PAGE-INVALID-ATTR` + `E-PAGE-ROUTE-ATTR-FORBIDDEN`.
- +14 tests; **18 self-host parity tests `.skip`'d** pending self-host regen (deferred per pa.md S81 self-host-orthogonality).
- **Surprise surfaced:** BS-layer (`block-splitter.js:1161`) only recognizes V5-strict state-decl shape inside `<channel>` body — NOT `<program>` / `<page>`. Bare `<x>=0` inside `<program>`/`<page>` body STILL required `${...}` wrap despite SPEC §40.8 promising auto-lift. Spec-vs-implementation gap.

### Phase 3 — S86 user-voice ratifications (durable directives)

User surfaced two durable directives during a clarification turn:

1. **Idiomatic-examples styling rule:** *"while styles might be allowed outside `<program>`, it should be discouraged and never promoted in what should be idiomatic examples. the fact is I dont see 1 single reason to actully declare css there, css centralization always leads to untennable css."* — file-top `#{}` blocks SHALL NOT appear in kickstarter / primer worked examples / articles / fixture demos / dive worked examples. Inline `class="..."` Tailwind-style is canonical. `#{}` reserved for shapes that cannot express inline (CSS vars, keyframes, complex non-element selectors).
2. **Corpus-ouroboros warning (sharpening pa.md Rule 4):** *"agents that have no prior art on this language other than the examples of other agents (with no prior art) wrote. it becomes ouroborous if I dont constantly try to rangle the design in to conformance with my goals."* — corpus state is ARTIFACT, not EVIDENCE of design intent. SPEC + user-voice + pa.md are normative; pre-existing example/fixture content is NOT.

Memory file saved: `~/.claude/projects/-home-bryan-maclee-scrmlMaster-scrmlTS/memory/feedback_idiomatic_examples_styling.md`. Captured in user-voice S86 entry.

PA-side **DIRECTIVE-AMENDMENT-001-fixture-styling.md** authored + banner injected into Wave 2 brief while item (b) was running.

### Phase 4 — BS-layer extension (Option A — Wave 2 follow-up)

Item (b) surfaced the BS-layer gap. PA framed Option A (extend BS-layer to honor SPEC §40.8) vs Option B (amend SPEC to back down). User picked A: *"A. and we still have lots of work to do this session."*

**BS-layer extension landed at `2314c8c`:**
- `compiler/src/block-splitter.js` ~line 1161: 3 new locals (`isChannelBody` / `isProgramBody` / `isPageBody`) OR'd into existing peek guard.
- TAB-layer's `liftBareDeclarations` path was already wired by item (b); BS extension feeds directly.
- +19 tests (4 shapes × 2 contexts auto-lift; markup-opener disambiguation; regression on channel-body; SPEC §40.8 worked-example dual-form coverage).
- Durable rule recorded: when SPEC + impl diverge AND SPEC is design-intent shape, **impl catches up, NOT spec retreats**. Captured in user-voice + this hand-off.

### Phase 5 — PA-side cleanups (SPEC-INDEX + route-inference + changelog + master-list)

**SPEC-INDEX + route-inference cleanup at `4585b45`:**
- `compiler/SPEC-INDEX.md` auto-regen post-Wave-1 (58 row line-range refreshes).
- `compiler/src/route-inference.ts` `buildPageRouteTree` docstring clarified as AUTH-MIDDLEWARE path map (NOT canonical URL inference; canonical is §47.9.2 path-preserve). v0.4 follow-up to harmonize `routes/` keying with `pages/` corpus convention.

**Changelog + master-list S86 in-flight banner at `268867d`:**
- `docs/changelog.md` — full S86 entry capturing Wave 2 + BS-layer + S86 user-voice + libavif package-name correction.
- `master-list.md` — S86 IN-FLIGHT banner inserted above S85 CLOSE addendum.

### Phase 6 — scrml dev codegen divergence (Task #17 from S85)

User picked the depth-of-survey dispatch on Task #17. Agent fired background.

**Codegen fix landed at `41f7fe9`:**
- Important correction: **the "dev-vs-static divergence" framing was WRONG.** Both modes produce IDENTICAL broken output. Static-mode exits before loading; dev-mode loads via dynamic import where the JS engine surfaces SyntaxError. There is no `options.dev` branch in codegen.
- Error string was a paraphrase — S85 hand-off said `"Unexpected ."`; actual JS engine emits `"Unexpected -"` (kebab-case channel name in identifier position).
- Real bug: cross-file `<channel name="dispatch-board">` emitted as `import { dispatch-board } from "..."` — bare identifier with hyphen = invalid JS. Channels are inlined by CHX at consumer sites, NOT resolved via ES module bindings.
- Fix: new helper `filterChannelImportSpecifiers(stmt, importerPath, exportRegistry)` in `compiler/src/codegen/emit-channel.ts` (+98 LOC). Both `emit-server.ts:262` + `emit-client.ts:516` import-emit loops call the helper.
- **Bonus latent bug closed:** `{ X as Y }` was dropping `as Y` alias in emit. Test §C20.1.4 was locking in the buggy shape; corrected.
- +3 tests; 2 deferred items surfaced (trucking v0.3 channel-reversal migration → Wave 3 v0.3 territory; load-detail.client.js:285 lift-`<li>` text-template bug → separate small fix).

### Phase 7 — §40.8.1 OQ closed (Option C — "third option" methodology pattern)

User asked: *"do we have a debate planned for the spa multi-page questions? and Im not sure I ever layed eyes on results of logic by default inside `<program>` dd"*. PA confirmed Insight 29 ratified S85 (perf-feel debate done) + surfaced §40.8.1 OQ framing.

PA presented 3-option framing — Option A explicit `<program spa>`, Option B pure filesystem inference, Option C filesystem + `W-PROGRAM-SPA-INFERRED` info-level lint. User picked C: *"I like c."*

**§40.8.1 OQ CLOSED at `3f2504e`:**
- SPEC §40.8.1 status: OPEN QUESTION → RESOLVED.
- Verdict normative text: filesystem-inferred shape; NO `<program spa>` boolean attr.
- `W-PROGRAM-SPA-INFERRED` info lint fires when entry-file `<program>` + zero `<page>` siblings + no `pages/` directory at project root. Empty `pages/` dir suppresses.
- §34 +1 row.
- §40.8 §34 cross-ref updated.
- Methodology signal recorded: "third option" pattern — when binary OQ has real costs both sides, surfacing a synthesis option that captures both load-bearing benefits without their costs is often the right shape. Same pattern as Insight 22 test-bind middle path.

### Phase 8 — Perf-feel study dispatch (PA mistake caught by dispatch agent)

PA dispatched the perf-feel empirical study based on S86 hand-off carry-forward item 5 + S83 user-voice. **Dispatch agent caught a PA mistake: the study was ALREADY DONE at S84/S85 (Insight 29 ratified yesterday).** Same shape as the S82 IMPLEMENTATION-ROADMAP stale-carry-forward mistake. Agent correctly refused to write a duplicate doc.

Real state confirmed:
- S84 empirical study: `scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md` — 99-100% static-resolvable across trucking-dispatch + 02/06/08/14.
- Insight 29 ratification: `scrml-support/design-insights.md` ~line 1827.
- Approach A ratified for v0.3.0 spec-amendment target (300-640h band).
- Approach B deferred to v2. Approach D rejected.
- User's pre-empirical A+B lean: partially ratified, partially overturned (A confirmed; B flip-voted by llvm-pgo-expert).

**PA learning: extend Rule 4 (spec is normative; derived docs are NOT) to the hand-off carry-forward menu itself.** Carry-forward items are derived from past sessions; must verify against current truth (design-insights.md, master-list, etc.) before treating as live action items.

### Phase 9 — v0.3 Approach A spec-amendment authorization

User authorized "yes 1. spec-amend auth". PA scoped at `docs/changes/v0.3-approach-a-spec/SCOPING.md` with 4 PA-leans (synchronous-role-classification commit; §40.9 placement; MUST language on markup-edge emission; background general-purpose dispatch). User authorized "as scoped".

**Approach A spec anchor LANDED at `d3deed2`:**
- NEW §40.9 Closure Analysis (Minimal Playable Surface) — 12 sub-sections, ~430 LOC normative.
- NEW §40.1.1 Static role classification for closure analysis — resolves Insight 29 OQ #3 with synchronous-role-classification commit; async backend gates fall back to runtime ship-eagerly + `W-AUTH-RUNTIME-FALLBACK` info lint.
- §47.5 amendment — closure-analysis-determinism cross-reference; B-deferral language preserved.
- §52 + §41.9 cross-refs for Components 3 + 5.
- NEW PIPELINE.md Stage 7.6 Reachability Solver (spec anchor; renumbered from 7.5 because Stage 7.5 was already Batch Planner BP).
- §34 +2 rows: E-CLOSURE-001 (Error) + W-AUTH-RUNTIME-FALLBACK (Info).
- SPEC-INDEX regen post-merge.
- **Manual 3-way merge resolved** vs S86's prior §40.8.1 OQ closure (agent's branch based on `23e6265`; PA re-applied §40.8.1 RESOLVED + §34 W-PROGRAM-SPA-INFERRED on top of pulled SPEC.md surgically).

Compiler implementation of closure analysis is DEFERRED to subsequent waves (300-640h band). Zero compiler source touched in this dispatch.

### Phase 10 — WebKit unblock + Wave 3 D2 + D3 dispatched

WebKit binary downloaded + libavif16 installed (`libavif13` was wrong in S85 hand-off; corrected). **Wave 3 D1 now GREEN on all 3 browsers** — Chromium 5/5, Firefox 5/5, WebKit 5/5.

**Wave 3 D2 (4 critical-path Playwright tests) fired background:** TodoMVC + 03-contact-book + 05-multi-step-form + 14-mario. 10-16h walltime band.

**Wave 3 D3 (Phase B benchmarks refresh) fired background:** re-run benchmarks against current HEAD; update RESULTS.md + Version History; numbers-honesty audit (README line 429 + scrml.dev language). 6-12h walltime band.

### Phase 11 — Trucking-dispatch migration reconnaissance

PA ran `bun scrml migrate --program-shape --dry-run --report examples/23-trucking-dispatch/` for reconnaissance. Verdict:
- 36 files scanned.
- 4 would change auto-clean.
- 12 unchanged.
- **20 fail safety-harness** (cross-file-import limitation from item (a)).

Partial migration would leave trucking in mixed v0.2/v0.3 state — **right call: defer full migration to Wave 3 v0.3 fixture-sweep** when the safety-harness fix lands. Not part of S86 scope.

### Phase 12 — W-PROGRAM-SPA-INFERRED emission dispatch

Small compiler-impl dispatch fired background to wire the lint per §40.8.1 normative statements. Brief targets `block-splitter.js`/`symbol-table.ts` (locus hint; mechanism survey applies). Background.

---

## S86 commit ledger (chronological, 11 PA-authored commits)

| # | Commit | Description |
|---|---|---|
| 1 | `885eaa9` | Wave 2 item (a): scrml migrate --program-shape + dispatch infra (brief + amendment) |
| 2 | `41a4706` | Wave 2 item (b): TAB extension — `<page>` default-logic + decl-shape family + diagnostics |
| 3 | `4585b45` | SPEC-INDEX regen + route-inference docstring |
| 4 | `2314c8c` | BS-layer extension — bare `<x>=0` inside `<program>`/`<page>` (Option A; closes SPEC §40.8 gap) |
| 5 | `268867d` | changelog + master-list S86 banner |
| 6 | `41f7fe9` | scrml-dev codegen fix — channel-import emission (Task #17 closed; latent alias bug closed) |
| 7 | `d2469c4` | v0.3 Approach A spec-amendment SCOPING doc |
| 8 | `3f2504e` | SPEC §40.8.1 OQ CLOSED (Option C) + W-PROGRAM-SPA-INFERRED catalog row |
| 9 | `d3deed2` | SPEC §40.9 Closure Analysis + PIPELINE Stage 7.6 (Approach A spec anchor) |
| 10 | TBD | (in-flight: W-PROGRAM-SPA-INFERRED emission impl dispatch) |
| 11 | TBD | (in-flight: Wave 3 D2 — 4 Playwright tests) |
| 12 | TBD | (in-flight: Wave 3 D3 — benchmarks refresh) |

---

## State-as-of-snapshot tables

### Tests at HEAD `d3deed2` (full suite)

11,580 pass / 114 skip / 1 todo / 0 fail / 562 files. Pre-commit hook firing on every commit. Zero regressions across all 9 landings.

### Semver tag history (unchanged S86)

| Tag | Commit | Scope |
|---|---|---|
| v0.2.0 | `022ee02` | First semver baseline (S83) |
| v0.2.1 | `d72c074` | Wave 4A bundle (S83) |
| v0.2.2 | `98e872d` | Wave 4B.1 bundle (S83) |
| v0.2.3 | `d512266` | Bug 2 (S84) |
| v0.2.4 | `28cd2ac` | Wave 1 + 1.5 robust-v0.2 bundle (S84) |
| v0.2.5 | `2c687b5` | Wave 2.5 (S85) |
| v0.2.6 | `efbd1e8` | F-COMPONENT-001 family closure (S85) |
| (untagged) | `d3deed2` | v0.3 Wave 2 + BS-layer + scrml-dev fix + §40.8.1 OQ + Approach A spec anchor (S86) |

### Wave 3 status

- D1 (Playwright infra + 02-counter canary) — LANDED S85 at `f69ff6a`; now GREEN on all 3 browsers (Chromium / Firefox / WebKit)
- D2 (TodoMVC + 03-contact-book + 05-multi-step-form + 14-mario) — IN FLIGHT
- D3 (benchmarks refresh) — IN FLIGHT

### v0.3 phase tracker

- **Wave 1 — SPEC anchor + walker inversion** — LANDED S85 `2b7c4df`. §40.8 + §40.8.1 (S86 RESOLVED) + §4.15 + §38.1 + §47.9.2 + §34 +5 codes + walker.
- **Wave 2 — compiler implementation** — LANDED S86. Item (a) migrate `885eaa9` + Item (b) TAB `41a4706` + BS-layer follow-up `2314c8c`.
- **Approach A spec anchor** — LANDED S86 `d3deed2`. §40.9 closure-analysis spec + PIPELINE Stage 7.6 + §40.1.1 static role classification.
- **W-PROGRAM-SPA-INFERRED impl** — IN FLIGHT (Task #10 dispatch).
- **Wave 3 — fixture migration sweep** — DEFERRED (gated on safety-harness cross-file-import fix; reconnaissance shows 20/36 trucking files fail current safety gate).
- **Wave 4 — adopter content + tutorials** — PENDING.
- **Closure-analysis compiler implementation** — DEFERRED to subsequent waves (300-640h band per Insight 29).

### Worktree state at snapshot

| Branch | Status |
|---|---|
| worktree-agent-ad9b623edac29ed02 | Wave 2 item (a); retained for forensics |
| worktree-agent-a2cd5a49f1d5ba5e6 | Wave 2 item (b); retained |
| worktree-agent-a4386e4b62ffd138b | BS-layer; retained |
| worktree-agent-a40c38c38575e2c23 | scrml-dev codegen fix; retained |
| worktree-agent-a7caf51fc47f72889 | Approach A spec anchor; retained |
| worktree-agent-a16d6354e01f4fc61 | W-PROGRAM-SPA-INFERRED impl; IN FLIGHT |
| worktree-agent-a943a6c8d1a8af86d | Wave 3 D2; IN FLIGHT |
| worktree-agent-afa1b84a0999559d9 | Wave 3 D3; IN FLIGHT |

Cleaned at wrap per pa.md S83 retention rule.

---

## In-flight threads at this snapshot

1. **W-PROGRAM-SPA-INFERRED impl** — small compiler-impl dispatch, ~2-4h walltime.
2. **Wave 3 D2** — 4 critical-path Playwright tests, ~10-16h walltime.
3. **Wave 3 D3** — Phase B benchmarks refresh, ~6-12h walltime.

---

## Open questions to surface immediately at S87 open

1. **Wave 3 fixture-sweep for v0.3 program-shape** — gated on safety-harness cross-file-import fix. Reconnaissance done; full sweep is its own dispatch.
2. **load-detail.client.js:285 lift-`<li>` text-template inline bug** — surfaced by scrml-dev codegen fix. Separate small dispatch.
3. **Compiler implementation of closure analysis** — Approach A spec anchor LANDED; 300-640h impl band waits in queue for subsequent v0.3 waves. Probably v0.3.x sub-waves OR v0.4.0 depending on user sequencing.
4. **`<program spa>` OQ:** CLOSED at `3f2504e` (Option C — filesystem inference + W-PROGRAM-SPA-INFERRED lint). Lint impl is in-flight.
5. **Self-host regen + re-enable 18 deferred parity tests** — deferred per pa.md S81 self-host-orthogonality; post-v1.0.0.
6. **Articles publishable per S84 W2-3 triage** — user-decision-queue; not auto-publish.

---

## Things S87 PA must NOT screw up (S86 additions to the standing list)

- **DO NOT re-fire the perf-feel empirical study or the perf-feel debate.** Insight 29 ratified at S85 (`scrml-support/design-insights.md` line 1827; S84 diagnostic at `scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md`). Hand-off / master-list carry-forward items can be STALE — verify against design-insights.md + master-list §0 phase tracker before treating as live action.
- **DO NOT attempt partial trucking-dispatch v0.3 migration.** Reconnaissance shows 20/36 files fail the safety-harness gate; partial migration leaves trucking in mixed v0.2/v0.3 state. Wave 3 v0.3 fixture-sweep is the canonical sweep wave; lands when safety-harness cross-file-import fix lands.
- **DO note that `<program spa>` is CLOSED.** The OQ at SPEC §40.8.1 is RESOLVED Option C. Do not re-debate; do not pre-commit a marker; lint surfaces the inference.
- **DO note Approach A spec anchor is LIVE.** §40.9 closure analysis + §40.1.1 static role classification + PIPELINE Stage 7.6 Reachability Solver + §34 +2 codes. Compiler implementation is subsequent waves (300-640h band). When dispatching closure-analysis impl work, cite §40.9 normative statements verbatim.
- **DO apply the corpus-ouroboros warning** (S86 ratification) when reasoning about design calls. "The corpus does X" is DATA, not REASONING. Re-derive from intent (SPEC + user-voice + pa.md).
- **DO apply the idiomatic-examples styling rule** (S86 ratification) when authoring scrml in articles / dives / fixtures / kickstarter examples. Inline `class=` Tailwind-style; NO file-top `#{}`.
- **DO surface stale-carry-forward risk at session-open.** When carry-forward menu shows action items, verify each against current truth (design-insights.md / master-list / SPEC) before treating as actionable.
- **DO note Stage 7.5 vs Stage 7.6.** PIPELINE.md Stage 7.5 is Batch Planner (BP). Stage 7.6 is Reachability Solver (S86 Approach A spec anchor). Don't conflate.
- **DO note 4 retained worktrees at snapshot** (5+ if more dispatches fire). All cleaned at wrap.

### Rules permanently load-bearing (from session-open hand-off — unchanged)

- Rule 1 — no marketing/article/tweet work unless user brings it up.
- Rule 2 — scrml is not a toy/hobby language; full-production-language fidelity.
- Rule 3 — right answer beats easy answer 99.999% of the time.
- Rule 4 — spec is normative; derived planning docs are NOT. **S86 extension:** the hand-off carry-forward menu itself is derived; verify against design-insights.md / master-list before acting.

---

## Memory files updated S86

- NEW `feedback_idiomatic_examples_styling.md` — file-top `#{}` never canonical in examples; corpus is artifact NOT evidence of intent. Captured from S86 ratifications.
- NEW `MEMORY.md` index — first entry pointing to feedback_idiomatic_examples_styling.md (the dir was previously empty).

---

## Cross-machine sync state at snapshot

- **scrmlTS:** unpushed since session-open. 9 commits ahead of origin/main (Wave 2 + BS-layer + SPEC-INDEX + changelog + scrml-dev + scoping + §40.8.1 OQ + Approach A + soon W-PROGRAM-SPA-INFERRED + Wave 3 D2 + D3). Push pending at wrap.
- **scrml-support:** S86 user-voice append + 0 other writes. Push pending at wrap.
- **Worktree state:** 8 worktrees retained for forensics; cleaned at wrap.
- **Pre-commit hook:** `core.hooksPath = scripts/git-hooks` verified on main; per-worktree enabled per dispatch via brief addendum.

---

## Tags

#session-86 #in-flight #wave-2-landed #bs-layer-extension #scrml-dev-codegen-fix #§40.8.1-OQ-CLOSED #approach-a-spec-anchor-LANDED #pipeline-stage-7.6 #insight-29-spec-amendment-target #closure-analysis #w-program-spa-inferred-impl-in-flight #wave-3-d2-in-flight #wave-3-d3-in-flight #idiomatic-examples-styling-rule #corpus-ouroboros-rule-4-extension #third-option-methodology-pattern #stale-carry-forward-rule-4-extension #webkit-now-green-libavif16
