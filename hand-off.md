# scrmlTS — Session 163 (OPEN)

**Date:** 2026-06-04
**Previous:** `handOffs/hand-off-167.md` (= S162 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-168.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). Full session-start completed (pa.md + pa-scrmlTS.md full + PRIMER full + SPEC-INDEX + master-list §0 + hand-off-167 + user-voice S155-S162 + git sync + inbox).

---

## SESSION-START STATE (caught up)

- **Sync:** scrmlTS **0/0**, clean. scrml-support **0/0**, clean. Inbox EMPTY. Worktrees: main only. Hooks: config B (pre-commit + post-commit + pre-push installed).
- **HEAD:** `72c30b60` (S162 wrap). **Version:** on top of **v0.7.0** (no tag pending).
- **Tests at last close (S162):** full `bun test compiler/tests/` **22,986 pass / 0 fail / 220 skip / 1 todo / 906 files**. HIGH 0 · MED 9 · LOW 16(+3 new S162).
- **Maps:** STALE — reflect `9f01f6cd`; HEAD is 7 commits ahead incl. native-parser changes. **REFRESH before the F1 dispatch** (F1 locus `parse-state-body.js` + markup-classification needs fresh coverage; native-parser is thinly mapped).

## NEXT PRIORITY — F1 (engine arm-body parse, the ~168 gate, L-sized)

The native-parser-swap strategic line (direction-(a), ratified S161). The swap-grind triage (S162) reframed the remaining ~790 flip-fails as **~6 parser FAMILIES, not 199 file-fixes**. **F1 is the dominant family (~168 fails).**

- **Locus:** `compiler/native-parser/parse-state-body.js` + the markup-classification path.
- **Bug:** native fires spurious `E-UNQUOTED-DISPLAY-TEXT` on `<engine>` state-child arm bodies + DROPS the whole engine (+ each-inside-arm content). THE GATE for §51.0.S/G.1, C1, bug62, engine-a7, engine-gated-each, Option A, MCP, mario.
- **Shape:** almost certainly a **Phase-0 SURVEY-STOP dispatch** (most complex native surface: state-children + arm bodies + nested each/match + §4.18 code-default body mode).
- **Sequence:** Refresh maps first → survey-stop dispatch → fix → **re-measure the flip AFTER F1** (count should drop steeply, validating the F2-F9 estimates). Then F2 (SQL `?{}` in server-fn, ~58) / F4 (formFor, ~32) / F5 (`const @name`, ~20) / F6+F9 / F7 (diagnostics).
- **F8** (stdlib `await import()`, 13) = the **stdlib migration** per the S162 user ruling (its own backlog task, NOT a native-parser relax — native stays the strict no-`await` enforcer, incl. compile-time `^{}`).

### The swap-grind family table (from S162 triage, agent `a754f880bccfc1a97`)

| Family | ~fails | Root cause | Locus | Size |
|---|---|---|---|---|
| **F1 engine arm-body parse** | **~168** | spurious `E-UNQUOTED-DISPLAY-TEXT` on `<engine>` arms + DROPS whole engine (+each-in-arm) | `parse-state-body.js`+markup-classification | L |
| F3 match/if-as-expr | ~44 | **DONE S162** (`2af1e3dd` same-line match arms); if-as-expr residual | `parse-expr.js` `isAtArmBoundary` | M (partial) |
| F2 SQL `?{}` in server-fn | ~58 | native drops SQL body in top-level server fns | `parse-sql-body.js` | M |
| F4 formFor expansion | ~32 | `<formFor>` parses but field-markup expansion dropped | native parse→bridge→form pass | M |
| F5 `const @name` derived-decl | ~20 | native rejects `@`-prefixed decl (→Bug 4 mis-emit) | `parse-stmt.js` | S-M |
| F6/F9 fn param / export-fn-body | ~16 | `lin`/destructured params; export-fn body stripped | `parse-stmt.js`/`parse-expr.js` | S-M |
| F7 missing diagnostics | ~15 | native swallows `E-STRUCTURAL-ELEMENT-MISPLACED` etc. | body-parser gates | S |
| F8 stdlib `await import()` | 13 | native rejects `await` (canonically correct) | stdlib migration (NOT native) | S/**ruled** |

The "KNOWN-RESOLVED" buckets (Bug 71/58/4) fail because native never produces the AST those parser-agnostic fixes consume (upstream PARSE gap) → roll up into F1/F3/F4/F5.

### Flip re-measure mechanism (for after-F1)
`compiler/src/api.js:630` `parser = null` → `parser = "scrml-native"` in a throwaway `git worktree`, then `bun install && bun run pretest && bun test compiler/tests/`. Control (default parser) = 0 fail; the flip-fails are 100% flip-attributable. (S161's harness wasn't committed; this is the reproducible recipe.) NB the native-parser-swap parity tests are LIVE-default → flip-gated, so the ~790 are measured separately, NOT in the default `bun test` count.

---

## OPEN QUESTIONS / DESIGN CALLS
1. **Phase-A default-flip is a STANDING USER DECISION** (STOPped+reverted once at `404fc619`). PA dispatches PARITY-CLOSERS feeding the eventual user-authorized flip — never "the flip" itself.
2. **v0.7 → v0.8 placement** — the swap is realistically a v0.8 target (long-tail grind, not a few levers). Confirm with user when relevant.
3. **M6.5 emit-logic path-(a) shims vs path-(b)** — needs ratification BEFORE that dispatch (cutover-plan). Not on the current critical path.

## CARRY-FORWARD (backlog)
- **NEW LOW to file:** systemic `is given` / `is not given` `.scrml`-mirror predicate drift — 22 occ / 6 files. S115-class (mirrors not compiled/run → zero runtime impact today; matters at self-host). NOT a mechanical `is given`→`is some` sweep — they mirror JS boolean/`typeof` checks; needs a canonical-form decision. **NB native-parser `.scrml` mirrors are FEATURE-stale (S162), not just predicate-drift** — whole machinery missing vs the `.js`; S115 lockstep moot for native fixes until a re-sync; brief the conditional form, not a rigid mandate.
- **Bug backlog (MED 9):** Bug 1 Tailwind · V-kill READ-side · MCP V0 deferrals · Generator policy (design-call) · L19 multi-statement-handler (design-call) · A5 freeze-extension · R28-1d (NOT-REPRODUCED S147) · C6 (likely stale-resolved) · Bug 14 MCP-partial.
- **LOW 16 (+3 S162):** `.scrml`-mirror feature-staleness · native is-pattern-arm gap (`is .Ok => 1` both same-line+newline) · native if-as-expr gap. (SPEC §4.15/§24.4 registry-gap LOW CLOSED S162 via `e5b673dc`.)
- **Swap line:** the grind (triage-ranked real-gap buckets, F1 first) → eventually D8a fn param/return cluster + `^{}` host-fence (D8b) + the Phase-A flip authorization. The within-node parity test + the flip-test re-measure are the two parity axes.
- **S154 carry:** body-split/CPS debt (Ext 2/3) · per= per-instance engines (DD) · self-tree-shaking compiler build-story DD-candidate (S155 parked) · self-demo scrml.dev F1/F2 debate (website now in sibling scrml-site) · 6NZ caps stray.

## pa.md directives in force
- Rules R1–R5. `---` delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Largest-ratified-target / autonomous / park-on-input / surface-on-real-failure-or-design-ruling.
- Dispatch discipline (every fix dispatch): S88 isolation · F4 startup-verify · S112 merge-startup · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md · S138 R26/dual-verify (PA-independent every landing) · S147 branch-leak coherence (every commit) · S115 `.scrml` grep (conditional for native — feature-stale). `--no-verify` forbidden.
- **CWD discipline (S159/S100):** `cd <main>` / `pwd` checks before main-side writes post-dispatch; S100 path-discipline hook is active (rejects sub-agent main leaks → agent switches to Bash-edit per S126).
- Canonical dev-agent `scrml-js-codegen-engineer`. Reconnaissance/triage via `general-purpose` (read-only). Reviewer-gate `scrml-language-design-reviewer` for design ratifications (not loadable some sessions → general-purpose-Opus w/ rigorous reviewer brief).

## SESSION-START HOUSEKEEPING (this OPEN)
- Hand-off rotated `hand-off.md` → `handOffs/hand-off-167.md`; fresh hand-off created. **UNCOMMITTED in working tree** — session-start commit pending user authorization (no commit made without it per code-editing rules).

## Tags
#session-163 #OPEN #profile-a-full-start #native-parser-swap #F1-engine-arm-body-next #168-gate #swap-grind #6-families-not-199 #high-0 #maps-stale-refresh-before-F1
