# scrmlTS — Session 162 (OPEN)

**Date:** 2026-06-04
**Previous:** `handOffs/hand-off-166.md` (= S161 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-167.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; no signal → default A). Full session-start completed (pa.md + PRIMER + SPEC-INDEX + master-list §0 + hand-off + user-voice tail S155-S161 + git sync + inbox).

---

## STATE AT OPEN

- **Sync:** scrmlTS **0/0**, scrml-support **0/0** (both clean at open; nothing to reconcile).
- **Inbox:** EMPTY.
- **Worktrees:** main only.
- **HEAD:** `83bd8968` (S161 CLOSE wrap commit). On top of **v0.7.0** (pkg.json unchanged).
- **Hooks:** config B (pre-commit + post-commit + pre-push all installed). `--no-verify` forbidden without explicit auth.
- **Tests (S161 close baseline):** `bun test compiler/tests/` 0 fail / 220 skip / 1 todo across 902 files (~22,921 pass). 2 pre-existing full-suite-only parity-timing flakes (07-admin-dashboard, 27-type-derived-table) are S159-noted, unrelated — green in isolation.
- **known-gaps §0:** HIGH **0** (holds since S139) · MED **9** · LOW **16**.
- **Maps:** reflect HEAD `9f01f6cd` (commit `ef5713df`). Now **2 commits stale** (R28-8 fix `e3680a0d` touched type-system.ts + the re-measure brief). **REFRESH before the #2f dispatch** (which touches `compiler/native-parser/` — verify the structure map's native-parser section).

---

## 🎯 NEXT-SESSION OPENER — #2f each/match structural-promotion (the dominant swap-gate unit)

**THE strategic line is the native-parser swap (direction-a, ratified S161): drive native parser to swap-ready → flip `--parser=scrml-native` to default → delete BS+Acorn+BPP at M6.** #2f is the dominant gating sub-unit.

**Why #2f is the unit:** S161 re-measured the flip-failure count via a throwaway-worktree harness — **1,150 fails-under-flip / 256 files** (control = 0 → 100% flip-attributable). **#2f each/match/colon-shorthand structural-promotion = ~70% (804 of 1,150).** Closing #2f kills ~700-800 of 1,150. Next bucket is 8% — nothing else close.

**The bug (confirmed root cause S161):** the native parser treats `<each>`/`<match>` as plain custom HTML elements — emits them VERBATIM into static HTML, emits NO render-fn / mount-slot / per-item factory into client.js. The `:`-shorthand body (`<li : @.name>`) is dropped entirely. It must PROMOTE them to control-flow structural nodes so native output produces the same each/match FileAST node KIND the live pipeline does (which downstream codegen — `emit-each.ts` / `emit-match.ts` — consumes).

**Start here:**
- **Fix locus (parser side):** `compiler/native-parser/parse-file.js` + the markup-parse path + TagKind classification (classify `<each>`/`<match>` as structural, not generic custom-element). Then the translate→live bridge (`translate-stmt.js` / `engine-statechild-walker.ts` siblings) must synthesize the each/match FileAST node.
- **Failing fixtures (minimal repros):** `compiler/tests/unit/each-block.test.js` (24 fails — canonical `<each in=@cell>` / `as`-name; cleanest), `compiler/tests/unit/each-colon-shorthand-r25-bug-40.test.js` (`<li : @.name>` dropped), `compiler/tests/unit/promote-each.test.js` (25), `compiler/tests/unit/engine-body-render.test.js` (20).
- **Authority:** `scrml-support/docs/deep-dives/m6-joint-retirement-cutover-plan-2026-05-23.md` (Unit M6.6 + the Phase-A/B swap-gate, ~line 113). The roadmap `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md` (§5 tracker is **S114-stale — do NOT trust it**; the S161 reconciliation + the cutover-plan are current truth). Two parity axes: within-node parity test `compiler/tests/parser-conformance-within-node.test.js` + allowlist (100,636 baseline = AST-diff axis); flip-test re-measure (1,150 = behavioral axis). Use BOTH.
- **SPEC sections (current-truth nav):** §17.7 each (SPEC 9698-10831) · §18.0.1 match block-form (10832-12256) · §51 engines (24061-27917) · §40.8 default-logic body mode · §4.18 code-default bodies.
- **Dispatch shape:** likely a **Phase-0 SURVEY-STOP gate** first (how native handles each/match now + the structural-promotion approach + whether the bridge is mechanical extension or needs a design call), then the fix. Re-measure the flip-failure count AFTER landing to confirm the ~700-800 reduction (within-node KIND-NAME drop + flip-failure delta = success metrics). Profile-B-able (spec + fixtures + locus are the brief substrate) once the survey closes the design questions.
- **Maps:** refresh first (2 commits stale).

---

## OPEN QUESTIONS / DESIGN CALLS (surface as the climb resumes)

1. **The Phase-A default-flip is a STANDING USER DECISION.** Even with a green gate, flipping native-to-default is the user's call (STOPped + reverted once at `404fc619`). PA does NOT flip without explicit authorization. Fix units are dispatched as PARITY-CLOSERS feeding the eventual user-authorized flip — never as "the flip" itself.
2. **v0.7 → v0.8 placement** — the swap missed the v0.7 cut (we're AT v0.7.0), dormant 25 sessions. Realistically a **v0.8** target. Confirm with user (low-stakes; the natural read).
3. **M6.5 emit-logic path-(a) shims vs path-(b) consume-native-Stmt** — needs ratification BEFORE that dispatch (per the cutover-plan). Not on the #2f critical path; surfaces when the structural-codegen bridge is dispatched.
4. **SPAN-COORD tolerance — RESOLVED S161** (tolerate; ~0 test cost; invisible to the flip-test gate). No further user input unless a future gate definition re-raises it.
5. **Session-start docs commit** — this hand-off rotation + (pending) maps refresh are uncommitted working-tree changes. Authorize a session-start docs commit when ready (S160 precedent: `130ee93b` "session-start docs + maps").

## CARRY-FORWARD (backlog)
- **Bug backlog (MED 9):** Bug 1 Tailwind residuals · V-kill READ-side · MCP V0 deferrals · Generator policy (design-call) · L19 multi-statement-handler (design-call) · A5 freeze-extension (adoption-watch) · R28-1d (NOT-REPRODUCED S147) · C6 (likely stale-resolved) · Bug 14 MCP-partial.
- **LOW 16:** incl. the 2 S160 (b)-surfaced (Bug 74 `/>`+`:`-shorthand E-DG-002-not-E-CLOSER-001; Bug 75 after-`>` engine E2E) + R28-2b leading-`:` tokenizer + the S142 gate-found diagnostic gaps.
- **#2f is the strategic line now** (above). After #2f: next flip-failure bucket re-slice (re-measure post-#2f), then D8a function param/return-type cluster, then `^{}` host-fence (D8b), then the Phase-A flip authorization.
- **S154 carry:** body-split/CPS debt (Ext 2/3) · #5 lint FPs · #6 atom-emitter follow-up · #7 MCP flip · per= per-instance engines (needs DD) · self-tree-shaking compiler build-story DD-candidate (S155 parked) · self-demo scrml.dev F1/F2 debate (S148; website now in sibling repo scrml-site) · 6NZ caps stray.
- **PRIMER:** §13.7 dA-b1 row note "STALE (enum-subset batches 2/3 landed S156)" — fold-in pending. Fold S160 (b)/(c) into PRIMER. (Carried from S160; not blocking.)

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Working-style: largest ratified target, autonomous, park-on-input, surface only on real failure / needed design ruling.
- Dispatch discipline: S88 explicit isolation · F4 startup-verify · **S112 merge-startup** (`git merge --ff-only main` startup step — load-bearing every recent session; bake into every dispatch brief) · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md archival · S138 R26/dual-verify (bidirectional) · S147 branch-leak coherence (every landing). `--no-verify` forbidden.
- Canonical dev-agent `scrml-js-codegen-engineer`. Reconnaissance via `general-purpose` (read-only). Reviewer-gate: named `scrml-language-design-reviewer` NOT loadable this machine (carry — use general-purpose-Opus w/ rigorous reviewer brief).
- **CWD discipline (S159 `feedback_cwd_reset_post_dispatch`):** PA shell CWD can drift INTO a dispatched worktree post-Agent-call → S100 hook then rejects legit main-side PA writes; `cd <main>` before every main-side write post-dispatch.

## Tags
#session-162 #OPEN #profile-a-full-start #high-0 #native-parser-swap #direction-a #2f-each-match-structural-promotion #flip-1150 #v0.7.0
