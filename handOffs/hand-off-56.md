# scrmlTS — Session 55 (CLOSED — PIVOTAL session, massive wrap, deliberation arc complete)

**Date opened:** 2026-05-04 (recovery from S54 interrupt; S54 had been doing v0.next deliberation pipeline)
**Date closed:** 2026-05-04 (same calendar day; long single-session direct-deliberation)
**Previous:** `handOffs/hand-off-55.md` (S53 close — fat wrap, +85 tests across 11 dispatches, engine rename arc complete)
**Pre-save target:** `handOffs/hand-off-56.md` (this file, written at S55 close as forensic preservation; identical to `hand-off.md` at this commit)

**Baseline entering S55:** scrmlTS at `f18f4ac` (S53 close wrap, pushed). 8,576 pass / 40 skip / 0 fail / 426 files. scrml-support clean+pushed. Inbox empty. S54 had done massive design work (DD5-DD10 + DD5 debate) committed to scrml-support but interrupted before continuing; user-voice + working-tree had S54-leftover untracked files.

**State at S55 close:** scrmlTS at `26a3cc4` (S54 hand-off rotation commit, pushed) + this wrap commit. **Test counts UNCHANGED from S53 close: 8,576 pass / 40 skip / 0 fail / 426 files.** Zero compiler/code changes this session — all work was deliberation + design-doc writes in scrml-support. **Net delta from S53 close: 0 tests, 0 compiler changes, but the language design FOR THE NEXT N MONTHS OF IMPLEMENTATION is now locked.**

---

## 0. The big shape of S55 — THE PIVOTAL SESSION

S55 is the session in which the v0.next deliberation arc CLOSED. It also is the session where the user clarified that no production adopters exist, which collapsed the migration / coexistence / v0.compat design surface entirely. The combination makes S55 the inflection point between the deliberation phase (S52-S55) and the implementation phase (S56+).

User verbatim (S55 wrap directive):
> Ok. but this session is PIVOTAL. we have been doing fat wraps, this one should be massive. please lets have a seamless transition.

The session opened by recovering from an S54 interrupt, then pivoted from the dive/debate cadence to direct PA-user deliberation on the open-questions list surfaced by the v0.next-Mario design artifact. Across one sustained discussion thread, **21 architectural moves were locked**, the **north star ("UI as a fully-handled state machine") was articulated**, and the **migration burden was dissolved** by user clarification that all current scrml is throwaway experimental code.

### Three things that happened in S55 that change everything

1. **Direct deliberation supersedes dive/debate** for the open-q list. The dive-judging pipeline was the right tool for the architectural pivot (S52). For the follow-on detail work, direct PA-user discussion was faster and produced equally durable decisions.

2. **The north star** — UI as a fully-handled state machine — is now explicit. All v0.next moves serve this single target: the structural shape of the UI tree IS the structural shape of the application's state. This unifies what previously read as N separate moves into one coherent design.

3. **The migration question disappears.** No production adopters means no compat mode, no `scrml migrate` v0.next tooling, no two-phase rollout. v0.next IS scrml. Implementation phase is "fix the compiler + docs to be the language we just designed," not "migrate the world to a new version."

---

## 1. The 21 architectural moves (full catalog)

This catalog is the load-bearing artifact of S55 plus carry-forward from S54. Cross-reference: synthesis (`scrml-support/docs/deep-dives/state-as-primitive-redesign-synthesis-2026-05-03.md`) for S54 conversation context; outcomes ledger (`scrml-support/docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md`) for the formal decisions. Detail in user-voice-scrmlTS.md S55 entry.

| # | Move | Status | Origin | Notes |
|---|---|---|---|---|
| 1 | Concession C9 (`@`-prefix as JS-framework-concession) | **RESCINDED (S55)** | DD1/synthesis §4.1 | `@` is canonical, NOT concession. Framework precedent was correct. |
| 2 | State as collection of reactive variables | DECIDED (S54) | synthesis §4.2 | Single-value = degenerate; compound = multi-cell |
| 3 | Three-form access `<>` / `@` / bare | **REVISED → two-form (V5-strict, S55)** | synthesis §4.3 → S55 V5-strict | `<v>` structural, `@v` canonical expression access; bare = local only |
| 4 | Engine state-children + structural transitions | DECIDED (S54), refined (S55) | synthesis §4.4 + S55 P2.2 | State-child WITH body = sugar over `if=(@engineVar == .ThisVariant)` plus rule= contract; bare = transition-only |
| 5 | Engine declaration-position = mount position | DECIDED (S54) | synthesis §4.5 | Same-file decl IS mount; cross-file uses `<EngineName/>` |
| 6 | Engine auto-declares its variable | DECIDED (S54) | synthesis §4.6 | Auto-declared per Move 16 rule |
| 7 | Multi-close shorthand `<///>` | **DROPPED (S55)** → editor | synthesis §4.7 → S55 P2.4 | 6nz handles via auto-expansion; message dropped 2026-05-04 |
| 8 | Logic-markup interleaving | DECIDED (S54) | synthesis §4.8 | Functions colocate with their button callers; the "scrml way" |
| 9 | Bare-variant in inferable position | DECIDED (S55, no debate) | S55 P1.1 | TS-shape enum-literal-inference; `marioState = .Small` works |
| 10 | Positional binding requires predefined-shape type | DECIDED (S55) | S55 P1.2-tuple | `<state a b c> = (1,2,3)` only when type is fixed (enum/match/engine) |
| 11 | Hoisting model: scoped hoist + lint + `pinned` opt-out | DECIDED (S55) | S55 P1.3 | Position D + TDZ-1 + `pinned` keyword for per-decl opt-out (upgrades lint to error) |
| 12 | Engine validates direct writes via `rule=` contract | DECIDED (S55) | S55 P2.1 (A2) | `@marioState = .Big` silent-validated; throws on invalid; compile-time check inside state-child bodies |
| 13 | `.advance(.X)` explicit-throws variant | DECIDED (S55) | S55 P2.1 (A1) | Loud-explicit; for "this MUST work" assertions |
| 14 | `effect=` attribute + `<onTransition>` element | DECIDED (S55) | S55 P2.1 follow | `effect=` simple/single-target only; `<onTransition to/from once if=...>` for complex; on-leave default; lifecycle elements skipped |
| 15 | `:`-shorthand for single-expression body | DECIDED (S55) | S55 P2.2-shorthand | Active when no `</>` closer present; bare body otherwise; mandatory whitespace around `:` |
| 16 | Auto-derived var name from `for=` type | DECIDED (S55) | S55 P3.1 | Lowercase-first-run of `for=` type; `var=` attribute for override / disambiguation |
| 17 | `initial=` attribute required on non-derived engines | DECIDED (S55) | S55 P3.2 | Lint warns if omitted (defaults to first state-child); forbidden on derived engines |
| 18 | Engine use-site for cross-file mount only | DECIDED (S55) | S55 P3.4 | Same-file decl IS mount; multi-instance marinates |
| 19 | Channel shape under v0.next | DECIDED (S55) | S55 P4.1 | File-level (NOT inside `<program>`); drops `@shared` modifier; auto-declares variable; V5-strict body |
| 20 | Components stay distinct from engines (Position 1) | DECIDED (S55) | S55 P4.3 | Components are multi-instance vehicle; engines/channels/schemas are singleton-by-design; multi-instance thread RESOLVED here |
| 21 | Two-phase migration with v0.compat coexistence | **DROPPED (S55)** | S55 P4.4 → S55 final | No production adopters → no migration story; v0.next IS scrml |

**Plus the north star** (proposed §1.4 of the synthesis): the UI of an application SHOULD be a fully-handled state machine. With the process clause: apps don't START there; they EVOLVE toward it.

**Plus DD5 framing correction:** Approach A's outcome stands (preserve `@`); the "as sugar" framing was wrong. `@` is canonical, not sugar.

**Plus C9 rescinded** (above).

---

## 2. The north star — load-bearing identity claim

User verbatim (S55, the breakthrough moment after P2.3):
> opt-out is right. I had a moment reading this that I ACTUALLY started to see my languge taking shape. and yes. my thought is that the ui of an application SHOULD be a fully handled state machine ( engine in scrml case ) . but development is a process

### Two co-load-bearing claims

1. **The north star:** UI as a fully-handled state machine (engine, in scrml's vocabulary). Not aspiration — design intent. **The structural shape of the UI tree IS the structural shape of the application's state.**

2. **The process clause:** apps don't START at the north star; they EVOLVE toward it. Booleans-as-lifecycle in early sketch code are not violations; they're in-progress pins. Compiler nudges (lint), kickstarter teaches the destination, language doesn't ENFORCE the shape — because forcing it would punish the prototyping phase.

### Why the north star unifies all moves

Every v0.next move serves the single target:
- M4 (state-children + structural transitions) → transitions become structural
- M5 (engines inside `<program>`) → lifecycle becomes structural
- M6 (engine auto-declares variable) → engine OWNS its state
- M12 (engine validates direct writes) → `rule=` becomes contract
- M14 (effect= + `<onTransition>`) → transition handlers become structural
- M15 (`:`-shorthand) → makes state-child markup tight enough to not punish
- Lifecycle-as-engine pattern (`W-LIFECYCLE-CANDIDATE` lint, opt-out) → booleans-that-gate-many-things become enum-engines
- V5-strict (`@` canonical) → every state touch is visually marked

Connection to the S54 "exhaustively provable" goal: boolean-as-app-lifecycle DEFEATS exhaustiveness (booleans aren't enumerable; prover can't verify "every branch covered"). Enum-engines DO let the prover say "every variant has a render branch; every transition is rule-checked; no orphaned states." Lifecycle-as-engine is **load-bearing for the exhaustiveness claim**, not just style.

### Tagline implication (still open thread)

Current S54 htmx-mirror tagline doesn't quite capture the UI-IS-the-engine claim. PA-drafted unverified candidates for future deliberation:
- "In scrml, your UI tree is the state machine."
- "Render is structure; state is structure; transitions are structure. One tree."
- "Your UI is your state machine, exhaustively."

Not user-ratified. Tagline thread is queued post-implementation-roadmap.

---

## 3. THE PIVOTAL CORRECTION — no migration

User verbatim (S55):
> oh wow, I thought I had picked up on some things. there is NO ONE writing anything but purely experamental scrml, 100% throw-away code, we dont need to worry about any of that. we just need to fix the compiler, kickstarter, turorial, docs, etc.

### What this collapsed

- **Move 21 (two-phase migration with v0.compat coexistence) — DROPPED.**
- **No `scrml migrate v0next` tooling needed.**
- **No file pragma for v0.compat mode (`#pragma v0next` etc.) — DROPPED.**
- **No kickstarter v1/v2 split — current v1 deprecated outright; new kickstarter for actual scrml.**
- **Self-host migration becomes "rewrite bootstrap" not "migrate."**
- **Examples / samples / trucking-dispatch get rewritten alongside compiler implementation, not migrated.**
- **The "v0.next" naming itself is suspect.** Likely drop the qualifier; what we've designed IS scrml.

### What remains the same

- **All 20 architectural moves stand** (only Move 21 dropped; Move 7 was already dropped earlier in S55).
- **`pinned` keyword (Move 11), initial= lint (Move 17), W-LIFECYCLE-CANDIDATE lint (P2.3)** — these stay because their value is "support different stages of development" (prototype vs maturing), which applies even without external adopters; the user themselves works in both modes.
- **The "process clause" in the north star** still applies — never about external users; about the design-arc of any individual scrml app.

### The implementation work surface (named by user, expanded by PA)

| Surface | Action | Approximate scope |
|---|---|---|
| Compiler (`compiler/src/`) | Implement Moves 1-20 via `scrml-dev-pipeline` tiered dispatches | Multi-month; largest piece |
| SPEC.md (~18,753 lines) | Rewrite affected sections (state declarations, engines, channels, attribute-registry, error codes); preserve unchanged | Substantial |
| PIPELINE.md (1,569 lines) | Update affected stage contracts | Moderate |
| Kickstarter (`docs/articles/llm-kickstarter-v1-2026-04-25.md`) | Rewrite as kickstarter for actual scrml; v1 deprecated | Single-doc rewrite |
| Tutorial (`docs/tutorial.md` + snippets) | Rewrite; partial overlap with already-queued Pass 3-5 work | Substantial |
| Examples (`examples/01..23`) | Rewrite all 21 example apps + trucking-dispatch (~8,200 LOC) | Per-example small but high count |
| Samples (`samples/compilation-tests/`, 275 files) | Rewrite or curate; many simplify under v0.next; some become obsolete | High count, mostly mechanical |
| Self-host bootstrap (`../scrml/`, ~12,048 LOC) | Rewrite under post-S55 rules | Real project; blocks self-hosting target |
| Stdlib (13 modules) | Review under V5-strict + new shapes | Likely small changes |
| LSP server + VSCode + Neovim | Update tokenization, completion, error mapping | Moderate |
| Existing articles (5 unpublished + published) | Triage: deprecate, rewrite, or "describes pre-S55" header | Per-article judgment |

This is months of work. The S54 "no holds barred" framing enables it. **NOT carried into S56** — must be re-confirmed at scope-of-implementation phase boundary.

---

## 4. Files written this session (forensic inventory)

### scrmlTS (this repo)

| File | Action | SHA |
|---|---|---|
| `hand-off.md` | Rotation S53 close → S54 fresh | `26a3cc4` (committed earlier in S55, pushed) |
| `hand-off.md` | This S55 close fat wrap | (this commit, pending push) |
| `handOffs/hand-off-56.md` | NEW — pre-save of S55 close (this file) | (this commit, pending push) |
| `master-list.md` | Update S55 close inventory | (this commit, pending push) |
| `docs/changelog.md` | New S55 close entry at top of "Recently Landed" | (this commit, pending push) |

### scrml-support (cross-repo write target)

| File | Action |
|---|---|
| `user-voice-scrmlTS.md` | Major append — Session 55 entry with ~14 verbatim quotes + interpretations (~+450 lines from S55 discussions) |
| `docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md` | NEW — clean decisions ledger for all 21 moves + north star + open queue |
| `docs/deep-dives/v0next-mario-design-2026-05-04.scrml` | Header annotation added marking 11 specific superseded constructs (V5-strict, Move 7 dropped, etc.) |
| `docs/deep-dives/phase-2-dispatch-briefs-2026-05-03.md` | UNTRACKED leftover from S54 — preserve as historical artifact (commit at this wrap) |
| `docs/deep-dives/progress-dd5-state-primitive-2026-05-03.md` | UNTRACKED leftover from S54 — preserve as historical artifact |
| `docs/deep-dives/progress-dd6-engine-state-children-2026-05-03.md` | UNTRACKED leftover from S54 — preserve as historical artifact |
| `docs/deep-dives/progress-dd7-engine-declaration-position-2026-05-03.md` | UNTRACKED leftover from S54 — preserve as historical artifact |

### 6nz (cross-repo message — outbox write)

| File | Action |
|---|---|
| `6NZ/handOffs/incoming/2026-05-04-0958-scrmlTS-to-6nz-multi-close-editor-option.md` | NEW — message dropped requesting editor-side `<//>` auto-expansion since Move 7 dropped from language. 6nz is not a git repo; file delivery confirmed at the path. |

### Notable untouched (intentionally)

- No compiler source changes (`compiler/src/` untouched).
- No SPEC changes (`compiler/SPEC.md` untouched). All design decisions are captured in scrml-support; spec rewrites happen in the implementation phase.
- No PIPELINE changes.
- No example changes.
- No test additions / removals.

---

## 5. Push state at S55 close

| Repo | HEAD before this wrap | Wrap commit pending? | Push pending? |
|---|---|---|---|
| scrmlTS | `26a3cc4` (S54 hand-off rotation, pushed) | YES — this wrap commit | YES |
| scrml-support | `35fb1d6` (DD5 debate, pushed earlier in S55) | YES — multi-file commit (user-voice + outcomes-doc + Mario header + 4 S54-leftover progress files) | YES |
| 6nz | not a git repo | N/A | N/A — file dropped, no commit needed |

**Push authorization for scrmlTS + scrml-support: PENDING USER GREENLIGHT.** The user said "seamless transition" but did not explicitly authorize push. Surfacing as open question (§7).

---

## 6. State as of close (verified)

- **Tests:** 8,576 pass / 40 skip / 0 fail / 426 files. **UNCHANGED from S53 close.** Zero compiler/code changes this session. (Pre-commit hook will re-verify on the wrap commit.)
- **Working tree (scrmlTS):** clean before this wrap; will have hand-off + master-list + changelog modifications staged at wrap commit
- **Working tree (scrml-support):** has uncommitted user-voice update + new outcomes-doc + Mario-design-file + 4 S54-leftover progress files (will be committed at wrap)
- **Inbox (`handOffs/incoming/`):** empty
- **Engine rename arc:** 99% complete carryover from S53 — `ast.machineDecls` file-level container array still uses old name. **DEFERRED** — will be folded into v0.next implementation since the AST shape rewrite there will touch this anyway.
- **3 small S54 disposition findings carryover:** scrml migrate / SPEC §39.8 collision, SPEC-INDEX.md `E-MACHINE-DIVERGENCE` typo, ast.machineDecls. **All 3 DEFERRED** — folded into v0.next implementation phase, since the implementation will rewrite or replace the affected surfaces anyway.

---

## 7. Open questions to surface immediately at S56 open

1. **Push authorization for scrmlTS + scrml-support wrap commits.** "Seamless transition" implies push, but explicit auth needed. **Question for user at S56 open:** push the S55 wrap commits in both repos?

2. **Implementation phase kickoff: which surface first?** The user named compiler+kickstarter+tutorial+docs but didn't sequence them. The natural sequencing question:
   - Compiler-first (build the v0.next compiler before any docs) — long lead time, no user-visible progress until landing
   - Docs-first (kickstarter + tutorial under post-S55 rules) — adopters see what scrml IS even before compiler implements it
   - Parallel (compiler dispatches + kickstarter rewrite simultaneously) — tractable if dispatched well
   
   Recommend: parallel, with compiler led by tier-by-tier dispatches via scrml-dev-pipeline, and kickstarter+tutorial+spec rewrites done as PA-direct or scribe-shaped tasks.

3. **Implementation roadmap design itself is its own session.** Should S56 be the roadmap-design session, OR should there be a "fresh context" break first? PA's read: a fresh session with clean context is the right move; the deliberation context might bias the implementation thinking.

4. **The "v0.next" naming.** Drop the qualifier, or keep as design-phase codename until compiler ships it? Bikeshed-ish but worth asking.

5. **"No holds barred" S54 authorization.** Was scoped to S55 (deliberation phase) by hand-off-55. **DOES NOT carry into S56 unless re-confirmed.** Implementation-phase authorization is its own scope; user must re-confirm.

---

## 8. ⚠️ Things this PA needs to NOT screw up at S56 open

1. **Read user-voice S55 entry FIRST at session-start checklist step 3.** It contains the ~14 verbatim quotes that drove the 21-move catalog. The hand-off summarizes; user-voice has the ground truth.

2. **The migration story is GONE.** Don't propose `scrml migrate` v0.next tooling. Don't propose v0.compat mode. Don't propose file pragmas for legacy preservation. The user's "throw-away code" statement is load-bearing — there is nothing to migrate.

3. **The 21-move catalog is the implementation surface.** Don't re-litigate decisions. If a move feels wrong during implementation, surface it explicitly; don't quietly drift away from it.

4. **Authorization scopes are SESSION-BOUNDED.** S54 "no holds barred" expired at S54 close. S55 "PIVOTAL wrap" authorization is for THIS WRAP only. S56 implementation work needs its own authorization scope from the user.

5. **The north star is the design key.** When in doubt during implementation ("should this engine attribute behave X way or Y way?"), ask "which one makes the UI MORE of a fully-handled state machine?" That's the tiebreaker.

6. **`pinned`, lint rules (initial=, lifecycle-as-engine), the process clause** — these stay despite no external adopters. They serve the user's own development arc.

7. **Components stay distinct from engines (Move 20).** Don't try to unify them under M2 spirit. Position 1 is locked. Multi-instance is for components; engines/channels/schemas are singleton.

8. **`@` is canonical, NOT sugar (V5-strict).** Bare names in expressions are LOCALS only. The Mario design file (in scrml-support) uses bare names everywhere — that file is now PRE-V5-STRICT and has a header annotation marking it as superseded. Don't use it as a reference for v0.next syntax; use the outcomes-ledger doc.

9. **DD5 debate framing correction.** Approach A won (keep `@`) — that stands. The "as sugar" framing was wrong; replace with "as canonical reactive-cell-touch marker." The synthesis needs an amendment if/when implementation needs to re-read it.

10. **The "v0.next" / "scrml" naming question is open.** Don't make a unilateral call; ask user.

11. **Three small S54 carryover findings (scrml migrate collision, SPEC-INDEX typo, ast.machineDecls)** — folded into implementation phase. Don't fix them as one-off T1s; they get done as part of the broader rewrite.

12. **Pre-S52 carryover findings (F-COMPONENT-003, F-PARSER-ASI sweep, W5a/b, W7, W8, W9-11)** — most of these are pre-v0.next compiler concerns. Some may be obsoleted by v0.next implementation; some may still apply. Triage at implementation-phase planning, not before.

13. **Worktree cleanup carries forward** — at least 11 S53 worktrees + dozens prior. Cheap session-warmup if S56 wants it.

14. **Master inbox stale messages** — bookkeeping for master PA, not blocking.

15. **Tutorial Pass 3-5 + 5 unpublished article drafts** — substantially OVERTAKEN by v0.next implementation phase. Tutorial Pass 3-5 should be FOLDED INTO the v0.next tutorial rewrite (not a separate effort). Article drafts should be re-evaluated under post-S55 rules — most likely re-frame or deprecate.

---

## 9. Cross-references

- **Synthesis (S54 conversation capture):** `scrml-support/docs/deep-dives/state-as-primitive-redesign-synthesis-2026-05-03.md` (1,064 lines)
- **S55 outcomes ledger (decisions):** `scrml-support/docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md` (NEW)
- **Mario design artifact (S55 early-session, NOW SUPERSEDED in parts):** `scrml-support/docs/deep-dives/v0next-mario-design-2026-05-04.scrml` (header notes mark 11 superseded constructs)
- **DD5 debate (still relevant; framing needs amendment):** `scrml-support/docs/debates/debate-01-dd5-at-var-survival-2026-05-03.md`
- **DD5-DD10 dive files (S54):** in `scrml-support/docs/deep-dives/dd5-..dd10-...-2026-05-03.md`
- **6nz outbox (Move 7 → editor):** `6NZ/handOffs/incoming/2026-05-04-0958-scrmlTS-to-6nz-multi-close-editor-option.md`
- **User-voice S55 entry (ground truth verbatims):** `scrml-support/user-voice-scrmlTS.md` Session 55 — 2026-05-04
- **Previous hand-off (S53 close):** `handOffs/hand-off-55.md`

---

## 10. Tags

#session-55 #closed #pivotal #fat-wrap #v0next-deliberation-arc-complete #21-moves-locked #north-star-articulated #migration-burden-dissolved #implementation-phase-next

---

## 11. The seamless-transition guarantee

The next session's PA, on opening, should:
1. Read this hand-off (covers everything material)
2. Read user-voice-scrmlTS.md S55 entry (ground truth verbatims)
3. Optionally skim `scrml-support/docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md` for the formal decisions ledger
4. Have the full picture without needing to re-derive any decision

If the next PA finds themselves searching for "what does this mean" or "why was this decided," THIS HAND-OFF FAILED ITS PURPOSE. Surface that gap to the user immediately so we know what to fold into the next iteration.
