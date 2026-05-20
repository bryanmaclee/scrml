# scrmlTS — Session 110 (CLOSE)

**Date:** 2026-05-20
**Previous:** `handOffs/hand-off-112.md` (S109 CLOSE — rotated at S110 OPEN)
**Machine:** single-machine (S100 directive holds)
**HEAD at S110 OPEN:** `928f90a` (S109 wrap)
**HEAD at S110 CLOSE (pre-wrap):** `928f90a` — **no `compiler/src/` commits this session**
**HEAD at S110 CLOSE (post-wrap):** `<wrap-sha>` (the S110 wrap commit — docs only)
**Origin sync at CLOSE:** scrmlTS pushed through the wrap commit; scrml-support pushed through `7af0e55`.

---

## S110 net outcome — an investigation-opening session (zero compiler code)

S110 was not a compiler-fix session. No file under `compiler/src/` changed; no tests
changed; the test baseline is identical to S109 (full **16,213 / 0 fail**; pre-commit
subset **13,362 / 0 fail**). The session did three things:

1. **Verified Bug 4 is fixed** + committed its deep-dive. The S108 `?{` C-narrow fix was
   confirmed live (block-splitter.js locus gate + 8/8 dedicated tests + real compiles —
   balanced `?{ }` and bare `/` in prose both compile clean; the SQL-EOF-cascade is
   gone). Incidental finding: an *unbalanced* `?{` still cascades — but a plain unbalanced
   `{` does the same, so it is the general orphan-brace diagnostic, NOT a Bug 4
   regression. The Bug 4 deep-dive (`bug-4-docs-mode-escape-2026-05-19.md`, 530L) had
   been untracked in scrml-support since S108 — committed S110 (`e03d55a`).

2. **Opened the quoted-text model investigation** — a major language-design
   investigation (THREAD 1 below). DD-1 + DD-2 deep-dives complete; 4 debate experts
   staged; Phase 3 (debates) framed and ready for next session.

3. **Surfaced the §29 vanilla-interop spec↔impl divergence** (THREAD 2 below) — open,
   undecided.

---

## THREAD 1 (primary in-flight) — the quoted-text model investigation

**What it is.** A fundamental language-design proposal: display text becomes an explicit
string literal. `<state>"and"</>` displays the string `and`; bare `<state>and</>` is
code (a keyword/identifier). This inverts the markup-body default — bodies become code,
display text the quoted exception — making the text/code boundary *declared* instead of
heuristically inferred. Origin: the user's S110 observation that the recurring
block-splitter bug grind (Bug 2, Bug 4, …) is one root disease — the BS layer guessing
text-vs-code.

**Home + tracker:** `docs/changes/quoted-text-model/INVESTIGATION-PLAN.md` — the
authoritative program tracker. **Read it first next session.** It carries the 5-phase
program, the locked decisions, and the open-questions register (Q-QT-1..7 + Q-DD1-A..E +
Q-DD2-A/B/C).

**Locked decisions (S110, both via AskUserQuestion):**
- **Scope:** DD-1/DD-2 test BOTH (a) all-bodies and (b) code-bearing-only; the debate picks.
- **Version:** decided after DD-3 — no version pre-committed.

**Phase status:**
- **Phase 1 — DD-1 (friction + prior art): COMPLETE.** `scrml-support/docs/deep-dives/quoted-text-model-friction-and-prior-art-2026-05-20.md` (816L). Bottom line: the problem clears the bar for a fundamental change — structural (12 BS heuristic mechanisms = the block-splitter's architecture), recurring (8 misclassification bugs, 1 open), measured adopter-side (~3,849 entity-escapes / 83% of files), already named as internal tech debt (`engine-statechild-parser.ts`'s header documents its own retirement condition). Friction lean: scope **(b)**.
- **Phase 2 — DD-2 (design space): COMPLETE.** `scrml-support/docs/deep-dives/quoted-text-model-design-space-2026-05-20.md` (1458L). 6 design questions → 16 named options. KEY FINDING: the 6 questions collapse — Q-QT-2/4/5 pair *deterministically* with the scope choice, so the debate is essentially **one master fork** (scope a vs b) + **interpolation** (Q-QT-1) + a short quote-char slice (Q-QT-3). REFRAME: scope **(b)** is the genuinely-novel design (no within-language code/text-default split has prior art); scope **(a)** has whole-language precedent (Elm, F# Feliz). Debate axis: measured-friction (favors b) vs coherence-and-precedent (favors a).
- **Phase 3 — debate cluster: FRAMED, runs NEXT SESSION.** Debate question + roster locked in INVESTIGATION-PLAN.md Phase 3. Q-QT-3 needs an in-debate ruling (Option B — both `'`+`"` — reintroduces the Bug-2 unpaired-quote surface).
- **Phase 4 — DD-3 (depth-of-fix): pending, after the debate.**
- **Phase 5 — synthesis + go/no-go: pending.** The go/no-go is genuinely OPEN — the user framed this as a try-it investigation, not a committed ship.

**Debate experts staged (THE S111 GOTCHA).** `.claude/agents/elm-expert.md`,
`jsx-expert.md`, `clojure-expert.md` — PA-authored S110 (no `~/.claude/agentStore/`
exists; `agent-forge` fails on write — agents authored directly). `simplicity-defender`
already exists globally. **`.claude/agents/` is GITIGNORED** — the 3 new agents are
local-only on this machine, NOT in git. They persist on disk and load as `subagent_type`s
at next session start (that is the whole point — Phase 3 runs with real experts, not
synthesized). **S111 MUST verify `.claude/agents/` still contains elm/jsx/clojure-expert
before dispatching the debate.** If wiped, re-author from the format of
`~/.claude/agents/simplicity-defender.md`.

**S111 next action on this thread:** run the Phase 3 debate. The 3 new experts load at
S111 session start. Dispatch per the INVESTIGATION-PLAN.md Phase 3 framing (`/debate` or
debate-curator with elm-expert / jsx-expert / simplicity-defender / clojure-expert), then
`debate-judge`, then DD-3.

---

## THREAD 2 (open, undecided) — §29 vanilla-interop spec↔impl divergence

S110 surfaced: SPEC §2.1 + §29 normatively say plain `.js`/`.html`/`.css` files "are
valid alongside `.scrml` files; the compiler processes `.scrml` files and integrates or
passes through the rest." VERIFIED the compiler does NOT do this — a pure-vanilla file
is rejected (`Cannot find file or directory`); a mixed-project build compiles the
`.scrml` and silently DROPS the vanilla files (not copied to dist). Zero implementation
(no "vanilla" code path in `compiler/src/`), zero tests, zero samples; §29 is 6 spec
lines.

**Open decision (user has NOT ruled):** retire §2.1's "passes through the rest" clause +
§29 (spec catches down to Pillar 4 "one file type" — what scrml actually is), OR
implement it (make the spec true; restore the incremental-adoption ramp). Distinct from
§21 vanilla-`.js`-import (importing a `.js` from scrml source), which is live +
load-bearing. Surfaced to the user S110; the conversation pivoted to the quoted-text
thread before a decision. Also logged in master-list §0.6.

---

## State-as-of-CLOSE

| Item | Status |
|---|---|
| Compiler source changes S110 | NONE — investigation-opening session |
| Tests | unchanged from S109 — full **16,213 / 0 fail**; pre-commit subset **13,362 / 0 fail** |
| Worktrees | main only |
| scrmlTS origin sync | pushed through the S110 wrap commit |
| scrml-support origin sync | pushed through `7af0e55` (`e03d55a` Bug 4 DD + `7af0e55` DD-1 + DD-2 + S110 user-voice) |
| Inbox `handOffs/incoming/` | empty |
| Hook gate | Configuration B (pre-commit + post-commit + pre-push) |
| pkg.json version | 0.3.3 (unchanged) |
| Maps watermark | still 18+ commits behind (unchanged S110 — no maps refresh, no dev-agent dispatch). Refresh before any S111 dev-agent dispatch. |
| `.claude/agents/` | gitignored; holds elm-expert / jsx-expert / clojure-expert (S110, local-only) |

## Open questions to surface at S111 OPEN

1. **Quoted-text Phase 3 debate is ready to run** — the 3 new experts load at session start. Top S111 action.
2. **§29 vanilla-interop divergence** — retire vs implement — undecided; needs a user call.
3. **Bare-variant inference nested-positions fix** — still SCOPED + ready from S109 (`docs/changes/bare-variant-inference-nested/SCOPING.md`, ~3-4h PA-direct) — untouched S110.

## Carry-forwards for S111 (S109 list — untouched S110, which was investigation-only)

- **Bare-variant inference nested-positions fix** — SCOPED-ready, ~3-4h.
- **PRIMER match-block section** — match block-form is functional; PRIMER has no dedicated walkthrough.
- **Bug 1 ring-offset + gradient** — blocked on preflight CSS emission infrastructure; needs scoping.
- **tableFor v1.next** — 5 items remain.
- **formFor v1.next B2-B4** — registerRenderer / `@label` annotation / auto-recurse nested struct.
- **variantNames** — next L22 family member; full 4-gate walk first.
- **Native parser M2 expression parser** — ~2-4 sessions.
- **Self-host bootstrap broken-import** — S102 carry; unaddressed S103-S110.
- **Maps refresh** — required before any dev-agent dispatch S111.

## Things S111 PA must NOT screw up

- **Verify `.claude/agents/` still has elm/jsx/clojure-expert before the debate** — gitignored, local-only; if missing, re-author. This is the load-bearing S111 gotcha.
- **Maps still 18+ behind** — refresh before any dev-agent dispatch.
- (S109 carry — still valid:) match-block `collectMatchBlocks` dual-shape (`fileAST.ast?.nodes`) must be preserved if emit-match.ts walkers are touched · `compileScrml` takes a SINGLE options object (`compileScrml(stringPath)` is a silent no-op) · browser tests read pre-compiled `samples/compilation-tests/dist/` — re-run `bun run pretest` after sample codegen changes · `extractEnumVariants` operates on tokenizer-JOINED `raw` · hook gate is Config B, `--no-verify` needs explicit authorization.

## Session-start checklist for S111 PA

1. Read `pa.md` pointer → `../scrml-support/pa-scrmlTS.md` IN FULL
2. Read `docs/PA-SCRML-PRIMER.md` IN FULL
3. Read `compiler/SPEC-INDEX.md` IN FULL — no NEW spec sections S110; §2.1 + §29 (vanilla-interop, THREAD 2) and §3-§4 (block grammar / context model — quoted-text relevant) are the S110-relevant anchors
4. Read `master-list.md` §0 LIVE DASHBOARD IN FULL — note the S110 CLOSE addendum at top + the §0.6 §29 entry
5. Read this `hand-off.md` (S110 CLOSE) — rotate to `handOffs/hand-off-113.md` at S111 OPEN
6. Read last ~10 contentful user-voice entries — S110 added a Session 110 block (quoted-text proposal + §29 reflection)
7. Sync hygiene: `git fetch origin && git rev-list --left-right --count origin/main...HEAD` should be 0/0
8. Inbox check — `handOffs/incoming/*.md` empty
9. Verify worktrees — `git worktree list` shows main only
10. **Verify `.claude/agents/` holds elm-expert / jsx-expert / clojure-expert** (the quoted-text debate roster — gitignored, local-only)
11. Read `docs/changes/quoted-text-model/INVESTIGATION-PLAN.md` IN FULL — the quoted-text program tracker
12. Surface the 3 open questions above (Phase 3 debate ready; §29 undecided; bare-variant fix ready)
13. Report: caught up + next priority (next priority = run the quoted-text Phase 3 debate)

## S110 commit ledger

| # | Commit | Repo | What |
|---|---|---|---|
| 1 | `e03d55a` | scrml-support | Bug 4 docs-mode-escape deep-dive (authored S108, committed S110) |
| 2 | `7af0e55` | scrml-support | quoted-text DD-1 + DD-2 deep-dives + S110 user-voice |
| 3 | `<wrap-sha>` | scrmlTS | S110 wrap — hand-off + INVESTIGATION-PLAN + handOffs rotation + master-list + changelog |

(`.claude/agents/` elm/jsx/clojure-expert are gitignored — not in any commit; local-only on this machine.)

## Tags

#session-110 #CLOSE #investigation-opening #quoted-text-model #DD-1 #DD-2 #debate-staged-next-session #zero-compiler-code #bug-4-verified #§29-vanilla-interop-open
