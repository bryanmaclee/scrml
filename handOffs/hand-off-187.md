# scrmlTS — Session 182 (CLOSE)

**Date:** 2026-06-11
**Previous:** `handOffs/hand-off-186.md` (= S181 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-187.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session" → default A). Full session-start chain incl. the MANDATORY full PRIMER read (all 1464 lines).
**Directive:** *"run the maps refresh, then base-extraction build"* → REFRAMED mid-session → then dog-fooding + an engine fix.

## 🟢 S182 CLOSE — pa-base v1 distillation draft · maps refresh · engine `effect=` fix (dog-food-found) · formFor footgun filed

### State as of close
- **HEAD:** `aba5392f` + the S182 wrap commit on top. scrmlTS local main is **AHEAD of origin** by (engine fix `aba5392f` + maps `0a11f908`... no — `0a11f908` was PUSHED; so ahead by `aba5392f` + the wrap commit). **PUSH:** the user authorized "push and wrap" — step 7 pushes `aba5392f` + the wrap commit. (If you read this and origin ≠ HEAD, the push didn't complete — verify + push.) scrml-support `6601c05` (pa-base v1) already PUSHED.
- **Tests:** full suite **23,837 / 0 fail / 221 skip / 1 todo** (S181 23,830 +7 engine-effect). Pre-commit subset live via `bun scripts/state.ts`.
- **known-gaps:** **HIGH 0 · MED 6 · LOW 12** (+1 this session: `g-formfor-unimported-silent` filed). `bun scripts/state.ts` for live counts.
- **Version:** v0.7.0, no cut. **stdlib:** 18 modules.
- **Maps:** watermark `5a51c1ca` (the 6c refresh `0a11f908`). **~2 behind HEAD:** (a) the engine-effect fix `aba5392f` — the NEW `E-ENGINE-EFFECT-NOT-INTERPOLATED` code + the symmetric dup-gate + the parser `effectMalformed` flags are **UNMAPPED** (error.map/structure.map); (b) the wrap commit (docs-only). **6c DEFERRED this session** (honest note — a 2nd project-mapper run for a 1-commit diagnostic delta is disproportionate after the same-session refresh `0a11f908`). **Next session: light incremental project-mapper refresh early** (reconcile the engine-effect code into error.map). `state.ts --check` WARNs the maps-behind, does not gate.
- **Inbox:** empty. **Hooks:** config B (pre-commit + post-commit + pre-push). **Worktrees:** ONLY main (engine-effect worktree cleaned 6b).

### The S182 landings
1. **`6601c05` (scrml-support) — `pa-base.md` v1** — the first-draft project-agnostic PA-base distilled from `pa-scrmlTS.md` (S181 base-extraction DD, **REFRAMED** S182 per user). The 11-section agnostic skeleton + 29 typed `{{slots}}`; 1:1 coverage check vs the OG (caught + restored 3 dropped directives). **scrmlTS PA left as the untouched OG** (the comparison baseline; the overlay-refactor was reverted). Pushed.
2. **`0a11f908` — maps 6c refresh** (b81fe03f→5a51c1ca; the 2 S181 fixes). Pushed.
3. **`aba5392f` — engine `effect=` diagnostics** (dog-food-found, ruled B/ERROR). NEW `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error) at BOTH `effect=` loci (opener S148 Form 3 + state-child Form 1 — a bare/non-`${}` value was silently tree-shaken; now a hard error). + dedup the `E-ENGINE-VAR-DUPLICATE`/`E-ENGINE-003` double-fire (symmetric gate on `legacyMachineKeyword`). Zero codegen change. +7 tests. SPEC §34 + §51.0.B/§51.0.H clauses. PA empirical dual-verify (S138). `docs/changes/engine-effect-diagnostics-2026-06-11/`.
4. **Dog-food (3 rounds):** S180 inferred-server VALIDATED · L22 `formFor` flagship VALIDATED · typed-SQL-row `W-SQL-ROW-UNTYPED` was a REPRO ARTIFACT (verify-before-claim prevented a false reopen). **Filed `g-formfor-unimported-silent` (LOW).**

## Open questions to surface immediately (next session)
1. **Maps ~2 behind** — light incremental project-mapper refresh EARLY (reconcile `E-ENGINE-EFFECT-NOT-INTERPOLATED` into error.map + the engine-effect parser changes into structure.map). watermark `5a51c1ca` → HEAD.
2. **`g-formfor-unimported-silent` (LOW, NEW)** — `<formFor>` (likely `<schemaFor>`/`<tableFor>` too) without `import { formFor } from 'scrml:data'` silently forwards as a literal tag, no diagnostic — same silent-drop-of-a-known-construct class as the engine `effect=` fix. **Candidate follow-on dispatch** (a W-/E- when an L22 markup element appears unexpanded/unimported); the engine-effect fix is the pattern. Empirical repro in the S182 session (`/tmp/s182-dogfood/formfor3.scrml` — gone; re-derive: canonical formFor minus the import).
3. **base-extraction replication (master-PA territory)** — `pa-base v1` exists (`6601c05`); the next replication step is vendoring it into giti/6nz + authoring each project's overlay (cross-repo → master PA, NOT this PA). A master-inbox notice was sent at S182 wrap. The DD's "refactor scrmlTS's own contract into base+overlay" step is SHELVED (user wants the OG intact for comparison).
4. **bug-75** — deferred, banked repro (after-`>` engine `:`-shorthand E2E fails at the block-splitter; BS `:`-shorthand-tokenization gap PRIMER §13.7-B18; LOW + deprecated-form-only; canonical inside-opener works E2E).
5. **VERIFIED.md** — S180's 13 changed examples remain the open re-verification (USER action; S182 didn't touch examples).

## CARRY-FORWARD QUEUE (cross-check live `@gap` + git log per verify-before-claim)
- **MED (6):** `r28-c2` (kickstarter currency) · `a5` (refinement-freeze) · `bug-1` (Tailwind preflight-blocked) · `bug-12-vkill` (engine-canon-blocked) · `bug-14` (MCP V0.D, §58-blocked) · `bug-17-l19` (L19 relax — HU DESIGN Q).
- **LOW (12):** `g-component-001-coverage` · `g-sql-row-protect-leak` · `g-sse-server-keyword` (KEEP-deferred) · `g-formfor-unimported-silent` (NEW S182) · `bug-18` · `bug-19-cite` (Rule-1 skip) · `bug-20` (blocked) · `bug-21`/`bug-22` (deferred) · `bug-75` (deferred) · `r28-2b` (broad blast) · `s169-ordered-unordered-build` (Nominal).
- **Untested dog-food surface:** scalar stdlib (`scrml:math`/`scrml:time.now()`/`scrml:random`, S176) — not yet dog-fooded.
- **Native-parser swap** — cutover deferred (~v0.8); ~508 flip-failures, needs FRESH re-triage. (Engine-effect fix added LIVE-only opener flags correctly stripped in within-node parity; native parser still has NO opener `effect=` read — standing swap gap, unchanged.)

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b/6c/6d).
- Dispatch: S88 isolation:worktree · F4 startup-verify · S90 CWD · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md archival (done for the engine-effect dispatch) · S138 R26/empirical (PA dual-verified the engine fix) · S147 branch-leak coherence (clean each landing) · S164 bg-commit-race · S180 waiting-time 3-tier (Tier-1 maint + Tier-3 dog-food held all session).
- **S182 process notes:** the engine fix was the full dog-food→scope→rule→dispatch→land→verify→cleanup loop in one session. The SQL-row + formFor dog-food rounds reinforced **verify-before-claim** (BOTH initially looked like residuals/bugs; isolation proved SQL-row = my repro [no reopen], formFor = a real footgun [filed]). The `-- pathspec` BEFORE `-m` git-commit gotcha (messages parsed as pathspecs) — use `git commit -F <file> -- <pathspec>` for multi-paragraph + `${}`/backtick messages.
- Memory: `feedback_verify_before_claim` (3 dog-food rounds) · `feedback_waiting_time_work_pattern` · `feedback_limit_primitives_not_godify` (engine-effect ruled B/limit) · `feedback_dont_soft_classify_bugs` (silent-drop = bug).

## Tags
#session-182 #profile-a-full-start #pa-base-v1-distillation-draft #base-extraction-reframed #maps-refreshed #engine-effect-not-interpolated-fixed #dup-double-fire-dedup #formfor-footgun-filed #dog-food-3-rounds #maps-2-behind-deferred #pushed
