# scrmlTS — Session 161 (CLOSE)

**Date:** 2026-06-04
**Previous:** `handOffs/hand-off-165.md` (= S160 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-166.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; no signal → default A). Full session-start completed.

---

## 🏁 S161 CLOSE — R28-8 fixed + landed · native-parser swap (direction-a) ratified, reconciled, re-measured · #2f teed up as next-session opener

Two arcs. **(1)** R28-8 (S151-ratified extend-§14.10) fixed end-to-end and landed. **(2)** Strategic pivot: user ratified **direction (a)** — drive the native-parser toward the actual swap (flip `--parser=scrml-native` to default → delete BS+Acorn at M6). PA reconciled the 47-session-stale M-state (Rule 4) + re-measured the flip-failure count. **The whole climb reduces to one dominant unit: #2f each/match structural-promotion (~70% of failures).** That is the next-session opener.

### Sync / repo state at CLOSE
- **scrmlTS:** clean except the wrap commit, HEAD `9d2556a6` pre-wrap → **6 PA commits this session, PUSHED this wrap** (`ef5713df` maps · `5007639d` R28-8 brief · `0dd18219` R28-8 brief-fix · `e3680a0d` R28-8 FIX · `9d2556a6` re-measure brief · + the wrap commit). origin 0/0 after push.
- **scrml-support:** S161 user-voice append (strategy reframe + (a) ratification) — committed + pushed this wrap. (Was 0/0 at open.)
- **Tests at close:** full `bun test compiler/tests/` **0 fail / 220 skip / 1 todo across 902 files** (23,142 tests ran; pass ≈22,921, +11 from R28-8's new test file). Gate held. R28-8 landing ran the pre-commit subset gate clean (15,802 worktree). NB the 2 pre-existing full-suite-only parity-timing flakes (07-admin-dashboard, 27-type-derived-table) are S159-noted, unrelated.
- **Hooks:** config B. S100 path-discipline hook held (no main-side PA-write rejections; CWD-drift guard `cd <main>` used before every main-side write post-dispatch — S159 lesson held).
- **Inbox:** EMPTY at open + close. **Worktrees:** main only (3 dispatch worktrees this session all cleaned at their resolutions).
- **Version:** on top of **v0.7.0** (pkg.json unchanged; no tag — bug fix + reconnaissance, not a release cut).
- **Maps:** refreshed THIS session to HEAD `9f01f6cd` (commit `ef5713df`; +Bare-variant-inference-helpers table +R28-8 task-route). Now **2 commits stale** (R28-8 fix `e3680a0d` touched type-system.ts + re-measure-brief). **Refresh before the #2f dispatch** (which touches `compiler/native-parser/`).

### known-gaps §0 state at CLOSE
- **HIGH 0. MED 9** (R28-8 RESOLVED → 10→9). **LOW 16** (unchanged). HIGH-0 holds since S139.

---

## DONE this session (S161)

1. **R28-8 — bare-variant inference into validated struct fields (§14.10) — FIXED + LANDED `e3680a0d`.**
   - S151-ratified extend-§14.10. A bare variant in a typed object-literal field (`const draft: Article = { category: .News }`) fired `E-VARIANT-AMBIGUOUS` when the struct field carried a trailing validator (`category: Category req`) — the struct-body resolver lowers `Category req` to `asIs` (the validator defeats the registry lookup), starving `inferBareVariantsWithStructNav` of enum context.
   - **S138 reverse-direction discipline caught a near-miss:** PA's first synthetic probes (plain enum fields) all PASSED → would have wrongly closed it NOT-REPRODUCED. Testing the REAL elixir shape (req-validated fields) reproduced it. The S143 known-gaps framing OVER-stated the gap: the plain object-literal-field case already worked since S84 `6af9fbaf`, and `is some`-narrowed `==` already works (the §14.10 comparison pre-pass) — only validated enum fields were live.
   - **Fix (approach B, localized — per the dispatch Phase-0 STOP-gate; a root fix at parseStructBody regresses the 41 `structType.fields` consumers incl. formFor/schemaFor/tableFor):** an optional `AsIsType.bareVariantBase` sidecar recovered in `parseStructBody` (`annotateBareVariantBaseFromRawClause`, reusing `_schemaForRecoverEnumSubset`; enum + enum-subset + `Category req | not` nullable-union forms; primitives leave it absent), read ONLY by `inferBareVariantsWithStructNav` (`refineFieldTypeForBareVariant`). asIs kind unchanged → all consumers byte-identical. +11 tests. PA-independent R26: faithful elixir CLEAN, typo→E-TYPE-063, enum-subset resolves, control clean. No SPEC amendment (§14.10 catch-all already authorizes; kickstarter §4.8 "other position" now correct). known-gaps R28-8 OPEN→RESOLVED, §0 MED 10→9.

2. **Native-parser swap — direction (a) RATIFIED + reconciled + re-measured (reconnaissance phase of the multi-session arc).**
   - **(a) ratified:** drive the native parser to the actual swap (M5-flip → M6 delete-BS+Acorn). See user-voice S161 for the strategy reframe.
   - **Reconciled the parked M-state** (read-only agent; Rule 4 — the roadmap §5 tracker was S114-stale): the FULL parser (M1-M4 JS + MK1-MK4 markup+seam) is BUILT (S99-S114); a substantial native→live FileAST bridge exists (`parse-file.js`, `translate-stmt.js` 20/20 StmtKinds, `translateExpr` wiring, `engine-statechild-walker.ts`); both pipelines parse the whole corpus with **0 parse-failures**. The MD.1-MD.5 labels NEVER executed — work went under M6.5.b/M6.6.b/M6.7-Dx; last real climb unit was **M6.7-D8a-i (S129)**; parked at S136.
   - **Re-measured the flip** (throwaway-worktree harness; reproduced the cutover-plan Phase-A flip `api.js:630 parser=null→"scrml-native"`): **1,150 fails-under-flip / 256 files (control = 0 fail → 100% flip-attributable).** New authoritative baseline; the prior 429 (S129) is NOT reproducible (no committed harness) → retire it. (Up from 429: ~33% corpus growth + methodology diff.)
   - **#2f each/match/colon-shorthand structural-promotion = ~70% (804 of 1,150).** Same class that broke Mario at the reverted M6.7 STOP. Native parser emits `<each>`/`<match>` verbatim as HTML (no render-fn/mount-slot/factory); `:`-shorthand bodies dropped. **Closing #2f kills ~700-800 of 1,150.** Nothing else close (next bucket 8%).
   - **SPAN-COORD design call RESOLVED by the data:** 38K within-node span-drift fires cost ~0 test failures (1 file asserts on spans) → **tolerate span drift, defer normalization**; it's invisible to the flip-test gate.

---

## 🎯 NEXT-SESSION OPENER — #2f each/match structural-promotion (the dominant swap-gate unit)

**This is THE unit. Closing it kills ~70% of the flip failures.** It is cutover Unit **M6.6** + the within-node KIND-NAME class (3,362 fires). It is the HEAVIEST gate in the arc (structural-promotion in the native parser + the translate→live-FileAST bridge for each/match nodes).

**The bug (confirmed root cause):** the native parser treats `<each>`/`<match>` as plain custom HTML elements — it emits them VERBATIM into static HTML and emits NO render-fn / mount-slot / per-item factory into client.js. The `:`-shorthand body (`<li : @.name>`) is dropped entirely. It must PROMOTE them to control-flow structural nodes so the native output produces the same each/match FileAST node KIND the live pipeline does (which downstream codegen — `emit-each.ts` / `emit-match.ts` — consumes).

**Start here:**
- **Fix locus (parser side):** `compiler/native-parser/parse-file.js` + the markup-parse path + TagKind classification (it must classify `<each>`/`<match>` as structural, not generic custom-element). Then the translate→live bridge (`translate-stmt.js` / `engine-statechild-walker.ts` siblings) must synthesize the each/match FileAST node.
- **Failing fixtures (minimal repros):** `compiler/tests/unit/each-block.test.js` (24 fails — canonical `<each in=@cell>` / `as`-name; cleanest), `compiler/tests/unit/each-colon-shorthand-r25-bug-40.test.js` (`<li : @.name>` dropped), `compiler/tests/unit/promote-each.test.js` (25), `compiler/tests/unit/engine-body-render.test.js` (20).
- **Authority:** `scrml-support/docs/deep-dives/m6-joint-retirement-cutover-plan-2026-05-23.md` (Unit M6.6 + the Phase-A/B swap-gate, ~line 113). The roadmap `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md` (§5 tracker is S114-stale — do NOT trust it; the reconciliation above + the cutover-plan are current truth). The within-node parity test `compiler/tests/parser-conformance-within-node.test.js` + allowlist (100,636 baseline) is the AST-diff axis; the flip-test re-measure (1,150) is the behavioral axis — use BOTH.
- **Dispatch shape:** likely a Phase-0 SURVEY-STOP-gate first (how native handles each/match now + the structural-promotion approach + whether the bridge is a mechanical extension or needs a design call), then the fix. Re-measure the flip-failure count AFTER landing to confirm the ~700-800 reduction (the within-node KIND-NAME drop + the flip-failure delta are the success metrics). It's Profile-B-able (spec + fixtures + locus are the brief substrate).
- **Maps:** refresh first (2 commits stale; #2f touches `compiler/native-parser/` which the maps cover thinly — verify the structure map's native-parser section).

---

## OPEN QUESTIONS / DESIGN CALLS (surface as the climb resumes)

1. **The Phase-A default-flip is a STANDING USER DECISION.** Even with a green gate, flipping native-to-default is the user's call (it's been STOPped + reverted once at `404fc619`). PA does NOT flip without explicit authorization. Fix units are dispatched as PARITY-CLOSERS feeding the eventual user-authorized flip — never as "the flip" itself.
2. **v0.7 → v0.8 placement** — the swap missed the v0.7 cut (we're AT v0.7.0) and was dormant 25 sessions. Realistically a **v0.8** target. Confirm with user (low-stakes; the natural read).
3. **M6.5 emit-logic path-(a) shims vs path-(b) consume-native-Stmt** — needs ratification BEFORE that dispatch (per the cutover-plan). Not on the #2f critical path; surfaces when the structural-codegen bridge is dispatched.
4. **SPAN-COORD tolerance — RESOLVED S161** (tolerate; ~0 test cost). Recorded; no further user input needed unless a future gate definition re-raises it.
5. **(carried) R28-8 cosmetic + the 2 S160 LOW (Bug 74/75)** — see CARRY-FORWARD.

## CARRY-FORWARD (backlog)
- **Bug backlog (MED 9):** Bug 1 Tailwind residuals · V-kill READ-side · MCP V0 deferrals · Generator policy (design-call) · L19 multi-statement-handler (design-call) · A5 freeze-extension (adoption-watch) · R28-1d (NOT-REPRODUCED S147) · C6 (likely stale-resolved) · Bug 14 MCP-partial. (R28-8 removed.)
- **LOW 16:** incl. the 2 S160 (b)-surfaced (Bug 74 `/>`+`:`-shorthand E-DG-002-not-E-CLOSER-001; Bug 75 after-`>` engine E2E) + R28-2b leading-`:` tokenizer + the S142 gate-found diagnostic gaps.
- **#2f is the strategic line now** (above). After #2f: the next flip-failure bucket re-slice (re-measure post-#2f), then D8a function param/return-type cluster, then `^{}` host-fence (D8b), then the Phase-A flip authorization.
- **S154 carry:** body-split/CPS debt (Ext 2/3) · #5 lint FPs · #6 atom-emitter follow-up · #7 MCP flip · per= per-instance engines (needs DD) · self-tree-shaking compiler build-story DD-candidate (S155 parked) · self-demo scrml.dev F1/F2 debate (S148; website now in sibling repo scrml-site) · 6NZ caps stray.
- **scrml-site notice:** R28-8 is accepts-more (no codegen-shape change) → no notice needed. (scrml-site `bun link`s scrmlTS, gets the fix automatically.)

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Working-style: largest ratified target, autonomous, park-on-input, surface only on real failure / needed design ruling.
- Dispatch discipline ALL held this session: S88 explicit isolation · F4 startup-verify · **S112 merge-startup** (load-bearing this session — agent #1 stalled because its worktree branched from session-start `9f01f6cd` and lacked the refreshed maps; the `git merge --ff-only main` startup step fixed it; ALL subsequent dispatches used it) · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md archival (all 3 dispatches) · S138 R26/dual-verify (R28-8 PA-independent) · S147 branch-leak coherence (every landing). `--no-verify` forbidden.
- **S138 reverse-direction R26 — exercised twice this session:** (a) R28-8 near-miss (synthetic-pass ≠ real-pass; the req-validated shape reproduced where plain fields didn't); (b) the M-state reconciliation (Rule 4 — verified the stale tracker against git log before acting).
- **PROCESS NOTE (Rule 5):** R28-8 dispatch agent #2 self-flagged using `--no-verify` on TWO docs-only WIP commits (survey + progress.md); the substantive fix+test commits ran the full gate + the PA landing commit re-ran it. No code bypassed the gate. Logged.
- Canonical dev-agent `scrml-js-codegen-engineer`. Reconnaissance via `general-purpose` (read-only). Reviewer-gate: named `scrml-language-design-reviewer` NOT loadable (carry).

## Process notes (S161) — LESSONS
- **S112 worktree-staleness bit hard:** the first R28-8 dispatch watchdog-stalled in maps-reading because its worktree branched from session-start `9f01f6cd` (not live HEAD) → had stale maps + no change-id dir, and it burned its window working around the discrepancy. Fix = the `git merge --ff-only main` startup step (now in every dispatch brief). Zero work lost (stalled at the doorstep). **Bake the merge-startup step into the dispatch-brief template permanently.**
- **Rule 4 vindicated twice:** the master-list §0.6 native-parser summary AND the roadmap §5 tracker were BOTH badly stale (S112/S114). I nearly proposed "dispatch M2.4" off the stale summary — the native parser is actually at the M6.7 swap-attempt stage, 47 sessions later. ALWAYS reconcile a parked arc against git log before acting.
- **The re-measure is the right reconnaissance pattern for a parked impl arc:** a throwaway-worktree behavioral measurement (1,150) + a read-only doc reconciliation converted "parked, distance unknown" into "one dominant unit at 70%, exact locus." Cheap, decisive, no risk to main.

## Tags
#session-161 #CLOSE #profile-a-full-start #r28-8-resolved #high-0 #native-parser-swap #direction-a #2f-each-match-structural-promotion #flip-remeasure-1150 #v0.7.0 #pushed
