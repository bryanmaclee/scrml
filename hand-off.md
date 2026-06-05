# scrmlTS — Session 164 (OPEN)

**Date:** 2026-06-04
**Previous:** `handOffs/hand-off-168.md` (= S163 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-169.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). Full session-start completed (pa.md full + PRIMER full + SPEC-INDEX full + master-list §0 + hand-off + user-voice S153→S163 tail + git sync + inbox + hook check).

---

## 🟢 S164 OPEN — caught up; native-parser-swap arc warm. NEXT OPENER: flip re-measure (quantify the ~790 drop post engine-substrate fix), then B2 / PowerUp enum / effect=.

### Repo state at OPEN
- **scrmlTS:** HEAD `f11db672` (S163 wrap), `origin/main` **0/0** (clean, synced). Working tree clean (only the S164 hand-off rotation staged).
- **scrml-support:** **0/0** (clean, synced).
- **Inbox:** EMPTY (`handOffs/incoming/` has no unread `.md`).
- **Hooks:** config B (local-rich — `.git/hooks/` has pre-commit + post-commit + pre-push). Leave as-is.
- **Version:** on top of **v0.7.0** (pkg.json unchanged; S163 was a parity-closer + bug-fix session, no tag).
- **Tests at last close (S163):** full `bun run test` **22,998 pass / 0 fail / 220 skip / 1 todo / 907 files**. Within-node parity 1005/0.

### Where we are — the strategic line (ratified S161 direction-a)
The **native-parser swap** is the #1 strategic line: finish the native parser → flip `--parser=scrml-native` to default → delete BS+Acorn+BPP at M6. Realistically a **v0.8 multi-session target**. Rationale is self-describing / one-front-end / fragility-class-elimination — NOT "shrink the bug backlog" (most recent bug effort is POST-parse codegen/type-system the swap reduces none of). **The Phase-A default-flip itself is a STANDING USER DECISION** (STOPped+reverted once at `404fc619`); PA dispatches PARITY-CLOSERS feeding the eventual user-authorized flip, never "the flip" itself.

**Flip-failure trajectory:** 1,150 (S161) → ~790 / 199 files (S162) → **674 (S164 re-measure, this session).** The S163 engine-substrate fix + B1 killed **~116 (−15%)**. Of 674: ~6 environmental ECONNREFUSED + 2 within-node SPAN-COORD → **~666 genuine across 181 files / ~6 families.** Honest read: real drop but NOT the hoped "steep" — most silently-miscompiling engine files compiled *clean* before, so they only failed the runtime-asserting flip-tests; the substrate fix's value is correctness, not headcount. **Remaining family signatures:** `E-CODEGEN-INVALID-JS` (18) · `E-TYPE-063` (15)+`E-VARIANT-AMBIGUOUS` (4) native bare-variant resolution · `E-TYPE-001/-020` (14/14) lifecycle/exhaustiveness · **B2 §51.0.S** `E-ENGINE-ACCEPTS-NOT-ENUM` (4)+`E-ENGINE-MSG-UNKNOWN` (3)+engine-message-dispatch conf/browser (~20) · `E-MATCH-NOT-EXHAUSTIVE` (7)+`E-MATCH-SUBSET-DEAD-ARM` (4) · F2 SQL-in-server-fn (~29 by file) · L22 promote-each/table-for/form-for (~55 by file).

### IN-FLIGHT THIS SESSION (S164)
1. **Flip re-measure — DONE** (674; method: throwaway detached worktree at `f11db672`, `api.js:630 null→"scrml-native"`, `bun install`+`pretest`+`bun test compiler/tests/`; worktree removed, main untouched, branch coherence 0/0). Log at `/tmp/flip-remeasure-s164.log`.
2. **Maps refresh — DONE** (PA-direct, surgical → watermark `f11db672`; F1 corrected to CLOSED; B2 flagged THE NEXT DISPATCH; 674 landed across primary/domain/structure).
3. **B2 — §51.0.S message-arm — DISPATCHING.** Native `synthEngineDecl` has ZERO `accepts=` handling (acceptsType undefined vs live null); `native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []`. Mirror live `parseMessageArms()` in `engine-statechild-parser.ts` (S154/S155 #14). Clears `engine-message-dispatch` conf/browser + the `E-ENGINE-ACCEPTS-*`/`E-ENGINE-MSG-*` cluster.

### REMAINING WORKLIST (after B2)
- **mario PowerUp enum-with-constructor-params truncation under native** (NEW S163) — native captures only `["Mushroom"]` (drops Flower/Feather), mis-emits `PowerUp.Flower(3)` as `"Flower"(3)`, match-arm positional-bind fails. SEPARATE from engine-substrate (a payload-bearing-enum native gap; mario residual = 133 diff-lines). Triage + scope.
- **`effect=` opener (§51.0.H Form 3 openerEffect)** — native `synthEngineDecl` has no openerEffect read. Small separate gap.
- F2 SQL `?{}`-in-server-fn (~58) · F4 formFor expansion (~32) · F5 `const @name` derived-decl (~20) · F6/F9 fn param/export-fn-body (~16) · F7 missing diagnostics (~15). F8 stdlib `await import()` = stdlib-migration task (not native).

### OPEN QUESTIONS / DESIGN CALLS
1. **Phase-A default-flip = STANDING USER DECISION** (see above). PA never dispatches "the flip."
2. **v0.7 → v0.8 placement** — the swap is a v0.8 target; the engine-substrate fix is a big chunk of the ~790; re-measure to re-baseline.
3. **M6.5 emit-logic path-(a) shims vs path-(b)** — needs ratification BEFORE that dispatch. Not on the current critical path.

### CARRY-FORWARD (F1 follow-ups + backlog)
- **B1 deferred:** malformed-reset diagnostic surfacing under native (native produces the reset-expr with the E-RESET-NO-ARG diagnostic field but doesn't run the ast-builder surfacer; no parity REGRESSION — native==default behavior).
- **§4.18 corpus migration** (bare display text → `"..."` literals, engine/match arms + `:`-shorthand) — deferred swap-prep backlog per the S163 §4.18 ruling (native enforces, live stays lenient until M6 deletes it).
- **F8 stdlib migration** (`await import()` in `^{}` → off `await`; native is the strict no-`await` enforcer per S162 ruling) — migration backlog, its own task.
- **Maps:** STALE. Refreshed to `c3303adc` mid-S163 (the S162 arc), but HEAD moved to `a41df176`+ (B1 + engine-substrate landings past the watermark). **The maps' "F1 = arm-body E-UNQUOTED-DISPLAY-TEXT" framing is INACCURATE** (true dominant cause = `machineDecls` two-instance identity defect). Refresh to HEAD + CORRECT the F1 framing before the next native-parser dispatch (maps were load-bearing every batch in S155/S163 — the legacy-BS+TAB vs native parser-path fork).
- **Per-feature engine parity** — S163 verified basic/hierarchy/onTimeout/onIdle/history/effects recover byte-identical. Derived engines + deeper sub-features still want their own positive flip-tests before claiming full parity.
- **native `.scrml` mirrors are FEATURE-stale** (S162 finding) — not just predicate-drift; whole machinery missing vs the `.js`. S115 lockstep is MOOT for native fixes until a re-sync (brief the conditional form, not a rigid mandate). Also: `is given`/`is not given` predicate-drift 22 occ/6 files (LOW).
- **Bug backlog (MED 9):** Bug 1 Tailwind · V-kill READ-side · MCP V0 deferrals · Generator policy · L19 multi-statement-handler · A5 freeze-extension · R28-1d (NOT-REPRODUCED) · C6 · Bug 14 MCP-partial.
- **LOW backlog** (incl. S162 `.scrml`-mirror feature-staleness, native is-pattern-arm, native if-as-expr; + `is given`/`is not given` predicate-drift).
- **S154 carry:** body-split/CPS debt (Ext 2/3) · per= per-instance engines (DD) · self-tree-shaking compiler build-story DD-candidate · self-demo scrml.dev F1/F2 debate · 6NZ caps stray.

## pa.md directives in force
- Rules R1–R5. `---` delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Standing-autonomy grant available on user say-so (review→land→push→R26→wrap, surface only on real failure / design ruling).
- Dispatch discipline: S88 isolation explicit · F4 startup-verify · S112 merge-startup · S99/S126 Bash-edit + no-`cd` (S100 hook active) · S136 BRIEF.md archival · S138 R26/dual-verify (PA-independent EVERY landing) · S147 branch-leak coherence (every commit, 0/N). `--no-verify` forbidden (recurring agent reflex — brief reinforces; held every time).
- **CWD discipline (S159/S90):** `cd <main>` / `pwd` checks before every worktree dispatch + main-side write post-dispatch.
- **Survey-STOP gate (S158/S163):** the user's chosen pattern; twice prevented over-commit in S163.
- **Methodology bank (S163):** native-parser-swap parity surveys MUST byte-compare native-vs-default EMIT, not check fatal-error-absence (the S139 trap at survey level).
- Canonical dev-agent `scrml-js-codegen-engineer`. Reconnaissance/triage + surveys via `general-purpose` (read-only). project-mapper (non-isolated) for maps refresh — commit with explicit `.claude/maps/` pathspec (it shares main's index; S119).

## Tags
#session-164 #open #profile-a-full-start #native-parser-swap-arc #flip-re-measure-opener #engine-substrate-fixed-S163 #v0.8-target #high-0
