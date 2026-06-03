# scrmlTS — Session 156 (CLOSE)

**Date:** 2026-06-02
**Previous:** `handOffs/hand-off-160.md` (= S155 CLOSE — full S155 detail lives there).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-161.md` at next OPEN.

---

## 🏁 S156 CLOSE — Profile B RATIFIED + Bug 62 RESOLVED + (d)-A enum-subset IMPLEMENTED end-to-end

Full execution session under step-by-step user direction (opened Profile A FULL). Three arcs all closed.

### Sync / repo state at CLOSE
- **scrmlTS:** clean, `origin/main` **0/0** (PUSHED this wrap). 7 commits this session: `f409f48c`
  (pa.md pointer) · `43cf9f40` (Bug 62) · `bfc50545`/`7a3c018f`/`0097d5b0`/`71be8f5f` ((d)-A b1-4) +
  this wrap commit. (First two pushed mid-session; the 4 (d)-A bundled + pushed at wrap.)
- **scrml-support:** clean, `origin/main` **0/0**. `b7a3063` (Profile-B ratification: `pa-core-scrmlTS.md`
  NEW + `pa-scrmlTS.md` Session-profiles section + user-voice S156) — pushed mid-session.
- **Tests at close:** full `bun test compiler/tests` **22,753 pass / 0 fail / 220 skip / 1 todo / 884 files**
  (S155 baseline 22,672; +81 = Bug62 +13 / b1 +20 / b2 +14 / b3 +18 / b4 +16; 0 regression).
- **known-gaps §0:** HIGH **1→0** (Bug 62). MED **14→17** (filed Bug 65/67/68; Bug 66 RESOLVED; Bug 69 NON-GAP).
- **Version:** on top of v0.7.0 (pkg.json unchanged; no tag — feature impl).
- **Worktrees:** all 5 S156 dispatch worktrees cleaned at wrap. Main only.
- **SPEC.md:** +3 worked-example `->` corrections (§53.15.1/§18.8.1/§53.15.4 — align to §7.3 grammar).

### What landed (detail in the DONE blocks below)
1. **Profile B (thin/execution session-start) RATIFIED** + `pa-core.md` written. User picks profile at
   open; default A. `pa-core` : `pa-scrmlTS.md` :: SPEC-INDEX : SPEC.
2. **Bug 62 (HIGH) RESOLVED** — Tier-1 `<each>` engine-`.advance` handler; dual-R26-verified.
3. **(d)-A enum-subset refinement IMPLEMENTED end-to-end (4 batches)** — type / match (both loci) /
   schema / construction / fn-boundary / member-access. Bug 66 RESOLVED. Two NON-GAPS verified-not-fixed
   (fn-return `(a)` canonical-`->`-already-enforces; Bug 69 tableFor display-subset-irrelevant-for-v1.0).

### Carry-forward to S157 (next priorities)
- **Bug backlog (all MED, none blocking):** Bug 63 (markup-attr `.advance` not type-checked — sibling
  of the resolved Bug 62 surface) · Bug 65 (Tier-0 `${for…lift}` engine-`.advance` silent miscompile —
  Bug 62 fix is the template) · Bug 67 (match-in-fn-body not parsed — general parser gap) · Bug 68
  (positional-payload enum schemaFor classify miss).
- **PARKED — Profile-A design session** for the S154 (a)/(b)/(c) rulings still needing spec+codegen +
  their unresolved sub-Qs (see PARKED below). (a) is ready (no open sub-Qs); (b)/(c) have sub-Qs needing
  live deliberation.
- **Bug 69 re-trigger:** at v1.next when a variant-set-consuming tableFor feature (filtering) lands.
- **DD candidate (S155, parked):** self-tree-shaking compiler build-story (§58+§47+self-host).
- **Maps STALE** — baseline `c665714c`; S155+S156 touched ast-builder/type-system/symbol-table/emit-*
  heavily. Refresh before the next compiler-source dispatch (offer at S157 open).

---

## S156 OPEN — caught up

Opened **Profile A (FULL)** per user "read pa.md and start full session." Read in full: pa.md
(scrml-support/pa-scrmlTS.md, ~1083L) + PRIMER (1428L) + SPEC-INDEX (385L) + master-list §0
(S155 CLOSE) + hand-off (S155 CLOSE) + user-voice S150–S155 + git hygiene + hooks + inbox.
**Profile B remains ratify-PENDING** (S155 recommendation); this session opened full because the
user said "full session."

### Sync / repo state at OPEN
- **scrmlTS:** clean, `origin/main` **0/0**. HEAD `118db71d` (S155 wrap commit).
- **scrml-support:** clean, `origin/main` **0/0** (fetched at open).
- **Hooks:** config B (pre-commit + post-commit + pre-push in `.git/hooks`). Untouched.
- **Inbox:** EMPTY (`handOffs/incoming/*.md` — no unread). Last processed: scrml-site liftlist
  fyi (→ Bug 64, in `incoming/read/`).
- **Worktrees:** main only (all 3 S155 #14 worktrees cleaned at S155 wrap).
- **Tests at last close (S155):** full `bun run test` **22,672 pass / 0 fail / 220 skip / 1 todo / 878 files**.
- **Version:** on top of v0.7.0 (pkg.json unchanged; no S155 tag).

### Maps currency (S82 protocol)
- `.claude/maps/primary.map.md` baseline commit `c665714c` (S154 maps refresh era).
- **STALE for 4 commits since:** `096951c4` (scandir `api.js`) + the three #14 batches
  `6667b664`/`c6f323f0`/`a9ce4c3a` (touched ast-builder.js, engine-statechild-parser.ts,
  symbol-table.ts, type-system.ts, emit-* codegen, runtime).
- **Action:** offer incremental `project-mapper` refresh BEFORE the next compiler-source dispatch
  (Bug 62 each-render-ctx fix touches codegen — maps would be load-bearing). Surfaced to user.

---

## DONE this session (S156)

### Profile B (thin/execution session-start) RATIFIED + `pa-core.md` written ✅
User directive: "ratify profile B and write pa-core.md." Four artifacts landed (PA-direct), two
discrete commits, **PUSH PENDING** (no push said):
- **scrml-support `b7a3063`:** NEW `pa-core-scrmlTS.md` (~140L thin read — 5 Rules + dispatch
  checklist + 8-step wrap + full-wrap/88% floor + sync/push + Profile-B operating rules incl.
  scope_blindness guardrail + 4 S155 findings) + `pa-scrmlTS.md` NEW "Session profiles A/B" section
  (+ detailed checklist annotated as Profile A) + `user-voice-scrmlTS.md` S156 verbatim entry.
- **scrmlTS `f409f48c`:** `pa.md` pointer now describes both profiles (A → full `pa-scrmlTS.md`;
  B → `pa-core-scrmlTS.md`); pre-commit hook passed clean.
- **Ratified definitions:** Profile A (FULL, default) reads everything (~25%); Profile B
  (THIN/EXECUTION) reads `pa-core-scrmlTS.md` + hand-off + NAMED landed-spec sections + maps +
  sync/inbox (~5-8%). User picks at session open; PA recommends but doesn't auto-switch; default A
  on no signal. `pa-core` : `pa-scrmlTS.md` :: `SPEC-INDEX.md` : `SPEC.md`.
- **PUSH PENDING** — both repos 0/1 ahead (coherence clean, S147 verified). Surface at wrap or on
  push auth. Cross-machine note: other machine won't have Profile B until pushed.

### Bug 62 (HIGH, each-render engine-ctx) RESOLVED + PA dual-R26-verified ✅
User directive: "bug 62." Reproduced empirically → fixed via `scrml-js-codegen-engineer`
(isolation:worktree, bg) → S67 file-delta landed → **scrmlTS `43cf9f40`** (PUSH PENDING).
- **Fix:** `emit-each.ts` builds the file engine codegen ctx once (collect* from emit-engine.ts)
  + threads it through the each render-factory event-wiring; per-item handler iter-scope-prelowers
  (`rewriteIterScopeOnly`) then routes engine refs through the canonical machinery — `.advance(.X)`
  → emitExprField C13 arm → `_scrml_engine_advance`(state)/`_scrml_engine_dispatch_message`(message);
  `@engine=.X` → `rewriteBlockBody` → `_scrml_engine_direct_set`. Tree-shaken; non-engine handlers
  untouched. +13 tests (8 unit + 5 happy-dom). Full suite **22,672 → 22,685 / 0 fail**.
- **PA independent R26 (S138):** state repro → `_scrml_engine_advance(...)`; message repro
  (`accepts=`/`(state×msg)` arms, `.advance(.Go(col))` in `<each as col>`) →
  `_scrml_engine_dispatch_message(...)` as-name payload threaded; both `node --check` OK;
  triage-board no-regress. All GREEN.
- **Review PASS:** S147 coherence (branch-tip==FINAL_SHA `c3bd22c8`; main 0/2 ahead = the 2 PA
  commits, no leak); scope clean (only emit-each.ts + 2 NEW test files + docs).
- **NEW Bug 65 (MED) filed** — Tier-0 `${for…lift}` (`emit-lift.js:529`) has the IDENTICAL gap
  with a WORSE symptom (`node --check`-clean but silent runtime TypeError on click). Bug 62 fix is
  the template; deferred per smaller-batches. known-gaps §0 HIGH 1→0, MED +1.
- **Worktree `agent-adfbd1f27c0ac7c1b` RETAINED until wrap** (S67 forensic).

### (d)-A batch 1 (enum-subset type-system foundation) LANDED + PA-verified ✅
User directive: "start (d)-A." Dispatched `scrml-js-codegen-engineer` (isolation:worktree, bg) →
S67 file-delta landed → **scrmlTS `bfc50545`** (PUSH PENDING). agent FINAL_SHA `4dd83a98`.
- **Deliverable:** recognizes `oneOf([.V])`/`notIn([.V])` subset refinements over an enum base;
  **materializes `PredicatedType.subsetVariants`** (notIn complemented to positive set) — the
  load-bearing output batches 2/3 read. §53.4 three-zone (static E-CONTRACT-001 / boundary
  E-CONTRACT-001-RT runtime `[...].includes(v)` / trusted no-check); §53.5.1 widen-free/narrow-checked;
  range-form → E-CONTRACT-002 reject. +20 tests. Full suite 22,685 → **22,705 / 0 fail**.
- **PA independent verify:** probes — valid `.Admin` clean; `.Viewer` → E-CONTRACT-001 (names excluded
  variant + subset); range → E-CONTRACT-002; full suite 22,705/0 re-run from worktree. All GREEN.
- **Review PASS:** S147 coherence (tip==FINAL_SHA `4dd83a98`; main 0/0 pre-landing); scope clean
  (type-system.ts + emit-predicates.ts + 2 tests + primer +1 + progress).
- **PROCESS NOTE (flagged):** agent used `--no-verify` on ONE intermediate WIP commit (self-reported).
  ZERO effect on main — PA file-delta pulls content at FINAL_SHA + the PA landing commit re-gates via
  pre-commit. Logged for the record.
- **NEW Bug 66 (MED) filed** — bare-variant enforcement doesn't reach the struct-CONSTRUCTOR form
  `Type{…}` (§53.15.2's CANONICAL example) + multi-token fn-return annotation (PRE-EXISTING B20-family
  parser gap; cell + object-literal forms DO enforce). **DECISION PENDING:** fold "close (a)/(b)" into
  (d)-A arc (enforce at canonical call site) vs separate B20-extension follow-up.
- **Worktree `agent-a220cb30f482dbca6` RETAINED until wrap** (S67 forensic).

### (d)-A batch 2 (match exhaustiveness, both loci) LANDED + PA-verified ✅
Dispatched `scrml-js-codegen-engineer` (isolation:worktree, bg) → S67 file-delta landed →
**scrmlTS `7a3c018f`** (PUSH PENDING; bundle at wrap). agent FINAL_SHA `babb865c`.
- **Deliverable:** exhaustiveness narrows to batch-1's `subsetVariants` at BOTH loci — JS-style
  §18.8.1 (`checkEnumExhaustiveness`) + block-form §18.0.1 (`symbol-table.ts` validateMatchBlock).
  NEW shared recognizer `enum-subset-refinement.ts` (both loci agree on §53.15.1). SF-1:
  `E-MATCH-SUBSET-DEAD-ARM` (NEW fire, distinct from E-TYPE-023) + vacuous-else `W-MATCH-001`.
  full-enum matches UNCHANGED. Codegen unchanged (compile-time only). +14 tests. Full suite
  22,705 → **22,719 / 0 fail**. **Pre-commit gate clean on EVERY commit (no `--no-verify`** — the
  sharpened brief line fixed batch-1's slip).
- **PA independent verify (both loci):** subset exhaustive-no-else clean; dead `.Viewer` →
  E-MATCH-SUBSET-DEAD-ARM (names excluded variant + subset); vacuous else → W-MATCH-001; block-form
  parity (`<Viewer>` dead-arm §18.0.1); full-enum missing → E-TYPE-020 (no-regress); suite 22,719/0.
- **Review PASS:** S147 coherence (tip==FINAL_SHA `babb865c`; main 0/1 pre-landing); scope clean.
- **2 pre-existing gaps surfaced:** **Bug 67 (MED, FILED)** — `match` in a `fn` body (`return match`)
  / fn-param not parsed → exhaustiveness never fires there (FULL enums too; canonical `${…}`-block
  match works). **(2) member-access `on=@p.role`** block-form falls through to full-enum (subset
  reach is declared-cell-only) — NOTED, batch-4 candidate (the §53.15.1 `Post.role` struct-field shape).
- **Worktree `agent-acbc755a5a409363d` RETAINED until wrap** (S67 forensic).

### (d)-A batch 3 (schemaFor subset CHECK + validator confirm) LANDED + PA-verified ✅
Dispatched `scrml-js-codegen-engineer` (isolation:worktree, bg) → S67 file-delta landed →
**scrmlTS `0097d5b0`** (PUSH PENDING; bundle at wrap). agent FINAL_SHA `8f799c78`.
- **Deliverable:** subset-refined enum field → `CHECK (col IN (subset))` not all base variants
  (§41.15.6 — fixed a SILENT VIOLATION: subset+`req` was dropping to asIs + re-resolving to ALL
  variants). 3 threading shapes fixed (`_schemaForRecoverEnumSubset`). Nullable subset (§41.15.8a).
  **Deliverable 3 (validator .OneOfFailed) = CONFIRM, no wire** — state-cell validator already
  carries the subset; refinement-type uses §53.4 three-zone, NOT the validity surface (§55 notes
  L30150-54). +18 tests. Full suite 22,719 → **22,737 / 0 fail**. Gate (full+browser) clean every commit.
- **PA independent verify:** batch-3 test asserts `CHECK IN ('Admin','Editor')` (subset, NOT all 3)
  + notIn complement; full suite 0 fail re-run. (schemaFor DDL feeds <schema>/migration infra, not a
  static compile artifact — verified via test's schema-body extraction, not compile-grep.)
- **Review PASS:** S147 coherence (tip==FINAL_SHA `8f799c78`; main 0/2 pre-landing); scope clean.
- **2 pre-existing gaps surfaced + FILED:** **Bug 68 (MED)** positional-payload enum `Ok(int)` misses
  E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1 at schemaFor classify (named-payload works; pre-existing);
  **Bug 69 (LOW-MED)** tableFor §41.16.6 same asIs-strip → subset reach unclosed for UI columns
  (clean parallel to the batch-3 fix; batch-4-fold candidate). known-gaps §0 MED 17→19.
- **Worktree `agent-acc0601ac596490f0` RETAINED until wrap** (S67 forensic).

### (d)-A batch 4 (enforcement reach — Bug 66 RESOLVED) LANDED + PA-verified ✅
Dispatched `scrml-js-codegen-engineer` (isolation:worktree, bg) → S67 file-delta landed →
**scrmlTS `71be8f5f`** (PUSH PENDING; bundle at wrap). agent FINAL_SHA `c7a03e64`.
- **Deliverable:** (b) struct-CONSTRUCTOR form `Type{…}` now enforces — §53.15.2's CANONICAL
  `const bad = Post { role: .Viewer }` fires E-CONTRACT-001 (was silent; closes B20 deferred position;
  acorn-drops-brace-body root cause → `inferBareVariantsForStructConstructor` recovers from raw init).
  (c) member-access `<match on=@p.role>` resolves p's struct-field subset → narrows + dead-arm fires.
  (a) fn-return = **NON-GAP** (Rule-4: §7.3:5761 `->` is sole return syntax; canonical `-> Role oneOf([…])`
  already enforces via batch 1; batch-1 "gap" was bare-space non-canonical). +16 tests. Full suite
  22,737 → **22,753 / 0 fail**. Gate green every commit.
- **SPEC fix (Rule-4, agent-flagged):** §53.15.1/§18.8.1/§53.15.4 worked examples elided the `->` arrow;
  corrected (`fn label(p) -> string`, `fn assignRole() -> Role oneOf([…])`) to match §7.3 grammar.
- **PA independent verify:** (b) `.Viewer` → E-CONTRACT-001 (names variant+subset); `.Admin` clean;
  (a) `-> Role oneOf([…])` + `return .Viewer` → E-CONTRACT-001; full suite 22,753/0 re-run. All GREEN.
- **Review PASS:** S147 coherence (tip==FINAL_SHA `c7a03e64`; main 0/3 pre-landing); scope clean.
- **Bug 66 RESOLVED** (the real gap was (b); (a) non-gap). known-gaps §0 MED 19→18.
- **Worktree `agent-acae2b23fdcd807ce` RETAINED until wrap** (S67 forensic).

**(d)-A CODE ARC (batches 1-4) COMPLETE** — enum-subset enforced end-to-end: type / match (both loci) /
schema / construction / fn-boundary / member-access. **Batch 5 (Bug 69 tableFor reach) = next, then wrap.**

---

## NEXT ARC (carried from S155 CLOSE) — implementation, multi-batch, smaller-batches rule

1. ~~Bug 62 (HIGH) each-render-ctx engine-threading fix~~ — ✅ **RESOLVED S156 `43cf9f40`** (see DONE
   above; PA dual-R26-verified; Tier-0 sibling → Bug 65 MED, deferred).
2. **(d)-A enum-subset refinement implementation** (spec landed normative S154; 3 batches):
   - **batch 1 — type-system foundation:** ✅ **LANDED S156 `4dd83a98`** (subsetVariants materialized,
     three-zone, widen/narrow, range-reject; +20 tests). PUSH PENDING.
   - **batch 2 — match exhaustiveness:** ✅ **LANDED S156 `babb865c`** (both loci §18.8.1/§18.0.1 narrow
     to subsetVariants; E-MATCH-SUBSET-DEAD-ARM + vacuous-else W-MATCH-001; shared recognizer; +14 tests).
   - **batch 3 — schemaFor + validator:** ✅ **LANDED S156 `0097d5b0`** (§41.15.6 subset
     CHECK + §41.15.8a nullable; validator confirm-no-wire; +18 tests; fixed a silent §41.15.6 violation).
   - **batch 4 — Bug 66 + member-access** ✅ **LANDED S156 `71be8f5f`** (Bug 66 RESOLVED;
     constructor-form fires E-CONTRACT-001; member-access narrows; fn-return non-gap; SPEC `->` fixed; +16 tests).
     constructor-form `Type{…}` + fn-return-annotation bare-variant enforcement (Bug 66) + block-form
     `<match … on=@p.role>` member-access subset reach (the §53.15.1 `Post.role` struct-field shape;
     batch-2-surfaced). Closes (d)-A enforcement at the canonical struct-field call site.
   - **batch 5 — Bug 69 tableFor subset reach** (user S156: "fold Bug 69 in too"): `_processTableForNode`
     (type-system.ts ~13263) asIs-strip → recover the subset PredicatedType before classify (SAME shape
     as the batch-3 schemaFor fix). **Sequenced AFTER batch 4 lands — NOT parallel** (both touch
     type-system.ts → file-delta conflict). Small focused closer; the arc's final step.
3. **#14 markup-attr type-check (Bug 63, MED).** markup-attr `.advance(.X)` not bare-variant-
   type-checked (pre-existing general markup-attr gap; runtime works, static typo-check absent).
   Two-plane resolution wired the logic-block/fn-body path only.
4. **+ conformance tests** per new normative statement.

---

## OPEN QUESTIONS TO SURFACE IMMEDIATELY (S156 OPEN)

1. **Profile B ratification (S155 recommendation, PENDING).** Profile B (thin-start) held through
   the S155 #14 arc. Recommendation: RATIFY + write `pa-core.md` (~100L: 5 Rules + dispatch
   checklist + wrap def + sync/push discipline) + amend pa.md with the Profile A/B split.
   Decision is the user's.
2. **What's the S156 work order?** Candidate next arc is Bug 62 → (d)-A → Bug 63 (execution,
   Profile-B-eligible). OR pivot to the PARKED Profile-A design work (the (a)/(b)/(c) S154 design
   rulings, which have unresolved sub-Qs needing live deliberation — see PARKED below).
3. **#14 DD candidate "dependency code issue" confirm (S155 carry).** PA asked whether the user's
   "the whole dependancy code issue" = the `bun link` full-toolchain-as-dependency friction
   (scandir being a symptom). User had not yet answered at S155 close.

---

## PARKED (Profile-A design session needed — unresolved sub-Qs need live deliberation)
- **(a) `:`-shorthand renders on non-void HTML elements; void elements reject.** RATIFIED S154.
  Needs spec amendment (§4.14 line 997 per-element rule + new void-reject §34 code) + codegen
  dispatch (mirror the `<each>` per-item path + void guard). No open sub-Qs — ready to spec+impl.
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
  Deep-dive shaped, Profile-A. Confirm-pending: see Open Q #3.

## OTHER CARRY-FORWARD (from S154 — see hand-off-159.md for full)
- **#2f native-parser each/match structural promotion** — HARD M5-swap precondition.
- Body-split/CPS debt (Ext 2/3 absent). #4 atom-emitter follow-up. #5 lint FPs. #6 cross-file
  client imports (DD landed). #7 MCP flip. #8 §14.10 bare-variant impl (ratified S151). #10
  print() canon. #11 srcmap col-precise. #12/#13 LOW. #15 `:`-shorthand BS fragility.
- **per= (per-instance engines):** NOT landed; placeholder name only; needs its own DD.
- **6NZ caps stray** still at `scrmlMaster/6NZ/` (non-git; S140 said migrate). Minor.
- **scrml-site landing-notice for scandir (`096951c4`):** HELD — scrml-site not on this machine;
  user carries the notice to the scrml-site PA on the other machine.

## known-gaps §0 state (live, post-Bug-62 + (d)-A batch 1-4)
- HIGH **0** (Bug 62 RESOLVED S156). MED **18** (Bug 63 markup-attr type-check + Bug 64 scrml-site
  liftlist + Bug 65 Tier-0 `${for…lift}` engine-`.advance` + Bug 67 match-in-fn-body not parsed + Bug 68
  positional-payload enum schemaFor classify miss + Bug 69 tableFor subset reach (= batch 5, next) + prior 12).
  **Bug 66 RESOLVED batch 4 (19→18).**

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter (S152). Working-style S147 (largest ratified target,
  autonomous, park-on-input). `full wrap` / 88% floor (S139).
- Dispatch discipline: S88 explicit isolation · F4 startup-verify · S99/S126 Bash-edit +
  no-`cd`-into-main · S136 BRIEF.md archival · S138 R26 (HIGH codegen) · S147 branch-leak
  coherence · S90 CWD gate · S82 maps-block. `--no-verify` forbidden (commit + push) w/o auth.
- Canonical dev-agent `scrml-js-codegen-engineer` (S154 drift resolved; loads on this machine).

## Tags
#session-156 #OPEN #profile-a-full-start #14-complete #next-arc-bug62-dA-bug63 #profile-b-ratify-pending
