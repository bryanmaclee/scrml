# scrmlTS — Session 170 (CLOSE)

**Date:** 2026-06-06
**Previous:** `handOffs/hand-off-174.md` (= S169 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-175.md` at next OPEN.
**Profile:** opened **A (FULL)** ("pa.md"; default A — no profile signal given).
**AUTONOMOUS LAND+PUSH GRANT (S164/S169-style), session-scoped — granted S170.** For both in-flight arcs (Bug B + set-algebra) and any follow-on this session: review (S67 file-delta) → land → push (pre-commit + pre-push gates ARE the independent re-verify) → S147 branch-leak coherence + S138 independent R26/verify → reconcile docs. **Surface ONLY on real failure or at a milestone/checkpoint.** Grant does NOT carry to next session.

## 🏁 S170 CLOSE — Bug B (HIGH) closed · `set` ratified-deferred + helpers shipped · native-parser swap-grind 605→~508 (Wave 1+2) · `wrap and push`

**Date:** 2026-06-07. **Next-session pickup:** rotate THIS file → `handOffs/hand-off-175.md`.

Full Profile-A session-start. Directions: **"start the set deep-dive, and bug B"** → **"continue with native parser work. autonomous workflow"** (+ `/effort` ultracode) → **"wrap and push."** Everything pushed under the autonomous land+push grant. **HEAD `cc69c62d`** (63106225 → `72aa6836` Bug B → `df08f282` set-algebra → `5a346faa` native-wave-1 → `cc69c62d` native-wave-2 → wrap commit). origin in sync (coherence 0/0 at each landing). **Worktrees: main only** (all dispatch + re-measure worktrees cleaned). **known-gaps: HIGH 0 · MED 9 · LOW 18.** **Tests: full suite 23,405 / 0 fail** (Bug B +9, set-algebra +16, native-wave-1 +24, native-wave-2 +5). v0.7.0, no cut.

**Native-parser swap (strategic #1):** re-triaged to **605 native-only flip-failures** (default BS+Acorn fully green 0-fail; native opt-in `--parser=scrml-native`), 6 fan-out surveys, **Wave 1 → 525, Wave 2 → ~508**, ZERO true regressions. Native parity-closers SHADOW-ONLY (default output byte-unchanged → no tag, no cross-repo notice). **Wave-3 candidates** (next session): D-class-residual 17, SCOPE roots 23, exprText qualified-enum whitespace-strip (W sub-gap), code-position match-block-promotion for render arms, engine-write-guard routing for match-as-statement over an engine cell, FIX-4 export-`<cell>` (needs a SPEC ruling), engine bare-display-text (§4.18 corpus-migration per S163, DESIGN-gated). NEW native tokenizer bug to file: single-word bare-display-text silent-drop (Wave-2 agent surfaced).

**Cross-repo:** scrml-support committed + pushed at wrap (user-voice S170 + the set deep-dive doc). **scrml-support sync 0/0.** Inbox empty; no outbound notices due. **Maps:** refreshed for the S170 landings (project-mapper → watermark advanced to `cc69c62d`).

### STREAM 1 — `set` deep-dive: DONE + RATIFIED + helper-impl dispatched
- Deep-dive COMPLETE: `../scrml-support/docs/deep-dives/set-warrant-and-shape-2026-06-06.md` (flipped to `status: current` + RATIFIED banner). Verdict: THIN convenience; zero adopter demand (0× `new Set`/`.has`/`unique`/set-algebra across 948 files); familiarity-bias CONFIRMED.
- **RATIFIED S170 (user AskUserQuestion):** "Defer type, ship helpers." NO `set` type (B2 `set[K]`-over-map on the SHELF as reversible upgrade); ship value-correct `union`/`intersection`/`difference` (+`member`) in `scrml:data`; fix `unique` struct-unsafety (`data.js:118` `[...new Set]` = JS-ref dedup, latent bug); document `[K:bool]`-map + array set-idioms in PRIMER §10. Recorded: user-voice S170.
- **STREAM 1b — set-algebra helpers: ✅ LANDED + PUSHED `df08f282`** (agent a061adc58f45dfb9a, branch tip 98a14ade → S67 file-delta, 7 files disjoint from the Bug B sibling). `scrml:data` gains value-correct `union`/`intersection`/`difference` (+`member`); `unique` no-key struct-unsafety FIXED; `.scrml`↔`.js` lockstep; SPEC §59.12 reconciled; PRIMER §10 catalog + Set-idioms block. +16 unit tests; full suite **23346 pass / 0 fail**. PA-independent-verified (16/16). pre-commit + pre-push GREEN; coherence 0/0; worktree cleaned.
  - **Value-canonical codec REPLICATED** (`_data_value_canonical` in `compiler/runtime/stdlib/data.js`), not reused — because data.js bundles standalone (server module) where the runtime-template global `_scrml_value_canonical` is absent. Agent cross-checked byte-identical over 21 cases. **LOW follow-up (DRY risk):** two copies of the §59.5 codec now exist; if §47.1.4 changes, BOTH must update. Not a correctness bug today; a shared-module consolidation is the eventual cleanup (blocked by stdlib bundling constraints). Logged here; file in known-gaps at next touch.
  - `unique` struct-unsafety (the deep-dive side-bug) closed WITHIN this arc — no separate known-gaps entry needed.

### STREAM 2 — Bug B fix: ✅ LANDED + PUSHED `72aa6836` (HIGH 1→0)
- `scrml-js-codegen-engineer` (worktree, agent a5b98933a2d8305d3, branch tip fd21d7e1) → S67 file-delta landed by PA at **`72aa6836`**, pre-commit + pre-push gates GREEN, **pushed** (origin 63106225→72aa6836), S147 coherence 0/0, worktree + branch cleaned.
- Fix shape (A): `reactive-deps.ts:stampCompoundDeepSetTargets` (+201L, once-per-file at runCG) stamps `_deepSetLeafKey`/`_deepSetResidualPath`; `emit-logic.ts` retargets the structural-compound deep-set to the backing leaf (`a.ref`); FLAT cells unchanged. +9 tests (5 unit + 4 happy-dom). Tests 16140→16145, 0 fail.
- **PA-independent-R26-verified** (emits `_scrml_reactive_set("a.ref",…)`, node --check clean; flat/nested/computed all correct).
- **Rule-4 finding (verified legit + landed):** 2 prior tests LOCKED the mistarget as expected output (cow-bracket-write-emit S168 ×2 + deepset-write-loss-position S167) — corrected to the SPEC §6.3.2 leaf shape (the S167 one moved to a flat-cell fixture to isolate its statement-survival intent). Pre-commit caught them; PA reviewed the diffs as SPEC-faithful before landing.
- **known-gaps RECONCILED** in the same commit: §0 HIGH 1→0; the stale Bug-A attribution corrected (Bug A multi-statement RESOLVED S167 `75431e9e` + Bug B structural-compound RESOLVED S170 close the S166 HIGH); Bug B §1 RESOLVED entry added.
- Deferred (not introduced here): deep-nesting through an inner-map value cell `@outer[k1][k2]` = the same S168 E-MAP-BRACKET-WRITE-note case.

### SYNC / REPO STATE AT OPEN
- **scrmlTS:** HEAD = `63106225` (S169 maps-refresh wrap). origin/main 0/0 (in sync). Tree clean.
- **scrml-support:** origin/main 0/0 (in sync). Tree clean.
- **Hooks:** Config B (pre-commit + post-commit + pre-push all present). **Inbox:** empty.
- **Maps:** current for source — watermark `40679720` (last source landing); HEAD's 2 extra commits are S169 wrap docs (maps refresh + master-list/changelog/§59 currency). No refresh needed at open.
- **Worktrees:** main ONLY (S169 cleaned all 7 dispatch worktrees).
- **Version:** v0.7.0. **Tests (S169 close):** 23,330 pass / 0 fail / 220 skip / 1 todo (~928 files); within-node 1006/0.

### STATE INHERITED FROM S169 CLOSE
- **Value-native map (§59) BUILT END-TO-END** — phase c COMPLETE (D0–D4 + D2b native parity + D2c destructure sugar + currency). All pushed. §59 flipped Nominal→Implemented.
- **known-gaps:** HIGH **1** (Bug B — structural-compound deep-set mistarget, codegen, `emit-logic.ts:3003`, OPEN) · MED **9** · LOW **18**.

### OPEN / CANDIDATE NEXT WORK (from S169 hand-off §"OPEN / NEXT")
1. **D5 = separate next arc (the S169-deferred map follow-on):**
   - **(a) `set` — UNRATIFIED design.** §59.12 deferred it; S166 flagged "thinner warrant — maybe not needed" (array + `scrml:data` helpers may cover; the user's "baby with the bathwater" doubt). Wants a **deep-dive/debate** on warrant + shape (first-class `set` vs derived-from-map vs `scrml:data` array helpers vs drop). Honors `feedback_no_batch_ratify_foundational_axioms` (one-axis-at-a-time, capability-map before ratify).
   - **(b) self-host migration** — ~130 `new Map`/`new Set` → value-native map; P3 bridge; NOT a v1 blocker.
2. **Bug B (HIGH)** — structural-compound deep-set targets the derived composite not the leaf cell → clobbered. Queued, unchanged. `emit-logic.ts:3003`.
3. **Carry-forward gaps (all LOW/deferred):** inline-handler `onclick=${@m=@m.insert()}` RHS not lowered (fix = thread `mapVarNames` into `rewrite.ts`); `@ordered`-literal-init unordered (documented v1 limit); native bracket-write→COW promotion; native `[string:int]` type-annotation whitespace normalization; **§6.2 Shape-4 canonical-empty-for-map UNVERIFIED** (does no-RHS `<m>: [K:V]` resolve to `[:]`? — adopters write `= [:]` for now).
4. **Native-parser swap arc** (strategic #1 line per S161) — the MD-ladder → M5-flip → M6-retirement. Last flip re-measure (S162): ~790 failures across ~6 parser-families. Standing USER decision; realistically a v0.8 multi-session target.

### STREAM 3 — native-parser swap: re-triage DONE + fix Wave 1 in flight (autonomous workflow)
- User direction: **"continue with native parser work. autonomous workflow."** + **`/effort` → ultracode** (workflow-default + adversarial verify, this session). Strategic #1 line (S161 direction-a).
- **RE-TRIAGE WORKFLOW `wf_fcf9da39-782` COMPLETE** (`.wf-native-retriage.js`): measure (throwaway-worktree flip, full per-file crash-isolated suite) + fan-out 6 root-cause surveys. **Result: 605 native-only flip-failures on HEAD df08f282 (default BS+Acorn = 0 fail / 23338 pass — all 605 native-attributable; down ~23% from S162's ~790). SPAN-COORD ≈ 0 (1/605) — residual is real semantic, no tolerance policy needed.** Full survey detail in the workflow output; buckets (failCount): MISSING-FIELD emit-shape 261 · engine-statechild 116 · D-class-parse-gap 64 · SCOPE-falsepos 60 · TYPE-MATCH 56 · FIELD-SHAPE-other 21 · legacy-stage-probe(test-only) 14 · each-match-promotion 11 (down from dominating!) · map-§59 1. Surveys CORRECTED several measure hypotheses (the "import-from high-yield" was a phantom; real D-lever = `@`-declarator binding).
- **Reality that de-risks:** native is OPT-IN; native-parser source edits CANNOT regress the green default pipeline (pre-push gate protects it). Parallel native fixing is safe.
- **FIX WAVE 1 — ✅ LANDED + PUSHED `5a346faa`** (combined commit, all 3 groups; pre-commit + pre-push full-suite+gauntlet GREEN; coherence 0/0; 3 worktrees cleaned):
  - **P** (parse-stmt.js, branch 07991f4f): `on mount`/`on dismount` (~52+cascade) + `const @name` derived-state-decl (~40; brief's parseBindingIdent approach was WRONG → agent rerouted to parseConstAtStateDecl, byte-identical). **FIX 3 arrow-shorthand = CORRECT STOP** (invalid scrml; live REJECTS it; survey was empirically wrong). **FIX 4 export `<cell>` = DEFERRED** (needs SPEC ruling; live silently drops it).
  - **T** (translate-stmt.js, branch 15b13766): deepset/array-mutation node-synth (emits live node kinds → routes through Bug-B-fixed emit-logic, byte-identical) + destructured-param structuring + typeAnnotation 1-liner. +24 tests.
  - **W** (src/native-walker/exprtext-backfill-walker.ts + api.js, branch a7494b56): exprNode→text backfill walker. INERTNESS VERIFIED (295/297 byte-identical emit; the 2 deltas = a net-positive latent-`const token;`-miscompile fix).
  - **within-node allowlist surgically rebaselined for combined P+T** (34 over-budget files → current; PARSE-FAILURE:0/NESTED-SHAPE:0; benign parity-churn; W is within-node-inert — test doesn't run the api.js walker). Done PA-direct via a throwaway regen mirroring the test pipeline.
- **RE-MEASURE DONE** (`wf_0b5e015b-ee2`): **605 → 525 native-only flip-fails (−80), ZERO true regressions** (no new codes/shapes; PARSE-FAILURE:0/NESTED-SHAPE:0; no native crash). Targeted buckets shrank as designed: D-class 64→17 (−47, on-mount/dismount + const-@ closed), SCOPE 60→23 (−37), TYPE-MATCH 56→41 (−15, W walker activated lifecycle/enum under native). The +35 MISSING-FIELD (261→296) + +4 legacy-probe are classifier catch-all DRIFT not regressions (proven: the E-CTX-001 files predate Wave 1, `git show 5a346faa` shows none touched). Autonomous loop (re-triage→fix→land→re-measure) validated end-to-end.
- **W residual sub-gap (banked, LOW):** the exprText backfill stamps qualified-enum as `.Article . Draft` (spaced) where the type-system regex expects `.Draft` — a whitespace-strip gap in emitStringFromTree's native stamp; TYPE-MATCH residual. Follow-up.
- **FIX WAVE 2 — IN FLIGHT** (`adfbdbc41fd7881dd`, `native-blockstub-verbatim-body-2026-06-07`, parse-expr.js + translate-expr.js; BRIEF.md archived): the **Mario fix** — native `reconstructArmBody` returns literal `"{}"` dropping match-arm block-body statements (the dominant ~1463-file form; Mario click fires but doesn't transition). One foundation (parseBlockStub stamps `verbatim` source slice) + 2 consumers (reconstructArmBody + translateLambdaBody for callback bodies). RISKIEST fix (each/match-adjacent M6.7-STOP class) → isolated single dispatch + statement-survival flip canary + R26 (MUSHROOM Small→Big) + surgical within-node reconcile. Targets the E-CODEGEN-INVALID-JS arm-body-drop subset of engine-statechild(107)+match. **OUT of scope:** engine bare display-text (E-UNQUOTED = §4.18 corpus-migration S163; single-word silent-drop = separate tokenizer bug to file).
- **On Wave-2 completion:** land (file-delta + within-node re-verify + pre-push) + re-measure. **PA NOTE: assess context before the Wave-2 landing — if tight, land + wrap; this session has landed Bug B + set-arc + native-wave-1 (4 pushes). Wave 3 candidates = the residual D-class parse-gaps (17), the remaining SCOPE roots (23), the W whitespace-strip sub-gap, FIX-4 export-`<cell>` SPEC ruling.**
- **WAVE 2 (deferred, isolated):** the Mario fix — match-arm BLOCK-BODY recover (native `reconstructArmBody` returns literal `"{}"` → drops arm statements; ~70 fails, most user-visible) + lambda block-body (1B). BOTH need BlockStub verbatim-source (couples parse-expr + translate-expr → conflicts with Wave-1 Group P) AND are each/match-adjacent (higher risk) → isolated dispatch AFTER Wave-1 re-measure, with careful verify. NOT-A-BUG/deferred: E-UNQUOTED §4.18 corpus-migration (S163 ruling) · SPA/E-DG-002 lint-lift (M6 post-parse-bypass design) · legacy-stage-probe (test-only) · struct-constructor grammar CASE-3 (separate feature dispatch).
- Phase-A default-flip itself stays a standing USER decision (realistically v0.8 multi-session).

### pa.md directives in force
- Rules R1–R5. `---` delimiter. Profile A/B. `full wrap`/88% floor. wrap 6c maps refresh.
- Dispatch: S88 isolation · F4 startup-verify · S112 merge-startup · S99/S126 Bash-edit+no-`cd` (S100 hook) · S136 BRIEF.md · S138 R26/independent-verify · S147 branch-leak coherence · S164 bg-commit-race · S169 NUL-byte-check on new test files.
- `feedback_no_batch_ratify_foundational_axioms` (the `set` fork honors this).

## Tags
#session-170 #profile-a-full-start #open #awaiting-direction
