# scrmlTS — Session 157 (OPEN)

**Date:** 2026-06-02
**Previous:** `handOffs/hand-off-161.md` (= S156 CLOSE — full S156 detail lives there).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-162.md` at next OPEN.

---

## S157 OPEN — caught up

Opened **Profile A (FULL)** per user "read pa.md and start session" (no profile signal → default A).
Read in full: pa.md (`scrml-support/pa-scrmlTS.md`, 1150L) + PRIMER (1430L) + SPEC-INDEX (385L) +
master-list §0 (S156 CLOSE dashboard) + hand-off (S156 CLOSE) + user-voice S154–S156 + git sync +
hooks + inbox.

### Sync / repo state at OPEN
- **scrmlTS:** clean, `origin/main` **0/0**. HEAD `57edc794` (S156 wrap commit).
- **scrml-support:** clean, `origin/main` **0/0** (fetched at open).
- **Hooks:** config B (pre-commit + post-commit + pre-push in `.git/hooks`). Untouched.
- **Inbox:** EMPTY (`handOffs/incoming/*.md` — no unread).
- **Worktrees:** main only (all 5 S156 dispatch worktrees cleaned at S156 wrap).
- **Tests at last close (S156):** full `bun test compiler/tests` **22,753 pass / 0 fail / 220 skip /
  1 todo / 884 files**.
- **Version:** on top of v0.7.0 (pkg.json unchanged; no S156 tag — feature impl).

### Maps currency (S82 protocol) — STALE
- `.claude/maps/primary.map.md` baseline commit `c665714c` (S154 maps refresh era).
- **STALE** — S155 (#14 batches) + S156 (Bug 62 emit-each + (d)-A 4 batches) touched ast-builder.js,
  type-system.ts, symbol-table.ts, emit-each.ts, emit-predicates.ts, engine codegen heavily.
- **Action:** offer incremental `project-mapper` refresh BEFORE the next compiler-source dispatch
  (Bug 65 / Bug 63 / batch-5 all touch codegen+type-system — maps would be load-bearing). Surface to
  user at session open.

---

## OPEN QUESTIONS TO SURFACE IMMEDIATELY (S157 OPEN)

1. **What's the S157 work order?** Candidates (all execution, Profile-B-eligible once specced):
   - **Bug 65 (MED)** — Tier-0 `${for…lift}` engine-`.advance` silent miscompile (`emit-lift.js:529`);
     Bug 62 fix is the template; WORSE symptom (`node --check`-clean but runtime TypeError on click).
   - **Bug 63 (MED)** — markup-attr `.advance(.X)` not bare-variant-type-checked (sibling of resolved
     Bug 62; runtime works, static typo-check absent).
   - **Bug 67 (MED)** — `match` in a `fn` body (`return match` / fn-param) not parsed → exhaustiveness
     never fires there (general parser gap; canonical `${…}`-block match works).
   - **Bug 68 (MED)** — positional-payload enum `Ok(int)` misses E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1
     at schemaFor classify (named-payload works; pre-existing).
   - **(d)-A batch 5 (Bug 69, LOW-MED)** — tableFor §41.16.6 subset reach (`_processTableForNode`
     type-system.ts ~13263, asIs-strip → recover subset before classify; SAME shape as batch-3
     schemaFor fix). User S156: "fold Bug 69 in too." The (d)-A arc's final closer. NOTE: hand-off-161
     S156 CLOSE also classified Bug 69 as a NON-GAP (display-subset-irrelevant for v1.0) — RECONCILE:
     the user said fold it in (carry-forward §35) but the wrap-close DONE block called it NON-GAP.
     Confirm with user whether batch 5 still runs.
   - **OR pivot to the PARKED Profile-A design work** (the (a)/(b)/(c) S154 rulings — see PARKED below;
     (a) is ready, (b)/(c) have unresolved sub-Qs needing live deliberation).
2. **#14 DD candidate "dependency code issue" confirm (S155 carry, still unanswered).** PA asked whether
   the user's "the whole dependancy code issue" = the `bun link` full-toolchain-as-dependency friction
   (scandir being a symptom). User had not answered at S155/S156 close.

---

## PARKED (Profile-A design session needed — unresolved sub-Qs need live deliberation)
- **(a) `:`-shorthand renders on non-void HTML elements; void elements reject.** RATIFIED S154.
  Needs spec amendment (§4.14 line 997 per-element rule + new void-reject §34 code) + codegen
  dispatch (mirror the `<each>` per-item path + void guard). **No open sub-Qs — ready to spec+impl.**
- **(b) `:` inside-opener canonical everywhere; §51.0.I reconciles to it.** RATIFIED S154.
  **2 unruled micro-grammar sub-Qs (NEED RULING before spec work):** (1) no-space-after-`:`
  (`:@thing` — current grammar requires whitespace after `:`); (2) self-close `/>` + `:`-shorthand
  vs E-CLOSER-001 (`<span :@thing />`).
- **(c) no-RHS typed-decl → canonical empty (int→0, string→"", bool→false, []→[], {}→{}) else
  `not`.** RATIFIED S154; supersedes E-DECL-NEEDS-INITIALIZER. **3 impl sub-Qs:** (1) exact table
  (enum→`not`); (2) `not`-init lifecycle interaction (§42/§14.12 — `<x>: User` no-RHS becomes
  effectively `(not to User)`); (3) E-DECL-NEEDS-INITIALIZER fate (retire vs narrow).
- **DD candidate (user-floated S155, parked):** "self-tree-shaking compiler as a build-story
  minimal-closure (post-self-host)." Intersects §58 + §47 + self-host roadmap + distribution.
  Deep-dive shaped, Profile-A. Confirm-pending: see Open Q #2.

## OTHER CARRY-FORWARD (from S154 — see hand-off-159.md for full)
- **#2f native-parser each/match structural promotion** — HARD M5-swap precondition.
- Body-split/CPS debt (Ext 2/3 absent). #4 atom-emitter follow-up. #5 lint FPs. #6 cross-file
  client imports (DD landed). #7 MCP flip. #8 §14.10 bare-variant impl (ratified S151). #10
  print() canon. #11 srcmap col-precise. #12/#13 LOW. #15 `:`-shorthand BS fragility.
- **per= (per-instance engines):** NOT landed; placeholder name only; needs its own DD.
- **6NZ caps stray** still at `scrmlMaster/6NZ/` (non-git; S140 said migrate). Minor.
- **scrml-site landing-notices:** scrml-site not on this machine; codegen-output-shape-change notices
  ride to the scrml-site PA on the other machine. Bug 64 (scrml-site liftlist) is scrml-site's.

## known-gaps §0 state (live, as of S156 CLOSE)
- HIGH **0** (Bug 62 RESOLVED S156). MED **~17** (Bug 63 markup-attr type-check + Bug 64 scrml-site
  liftlist + Bug 65 Tier-0 `${for…lift}` engine-`.advance` + Bug 67 match-in-fn-body + Bug 68
  positional-payload enum schemaFor classify + Bug 69 tableFor subset reach [NON-GAP-or-batch-5,
  reconcile] + prior 12). Bug 66 RESOLVED batch 4.

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter (S152). Working-style S147 (largest ratified target,
  autonomous, park-on-input). `full wrap` / 88% floor (S139). **Profile A/B (S156 ratified)** — user
  picks at open, default A; this session is A.
- Dispatch discipline: S88 explicit isolation · F4 startup-verify · S99/S126 Bash-edit +
  no-`cd`-into-main · S136 BRIEF.md archival · S138 R26 (HIGH codegen) · S147 branch-leak
  coherence · S90 CWD gate · S82 maps-block. `--no-verify` forbidden (commit + push) w/o auth.
- Canonical dev-agent `scrml-js-codegen-engineer` (loads on this machine).

## Tags
#session-157 #OPEN #profile-a-full-start #next-arc-bug65-bug63-batch5-or-parked-design
