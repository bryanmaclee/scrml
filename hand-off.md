# scrml — Session 272 (Peter, adopter lane) — WRAP

**Date:** 2026-07-19. Adopter-lane session on **AdiPDesk** (Peter's Windows desktop), solo after S271-bryan wrapped mid-session. Cleared the outage-stranded S270 continuity, landed a compiler warning for an aM table-rendering bug through the full S239 gate, and ran a second aM finding to ground (does not reproduce). NO feature work; the real table-each fix is deferred to the aM go-live scan.

## ⚠️ READ FIRST — state as of close
- **scrml main = `7928421e`** (#115 W-EACH-TABLE-FOSTER on top of bryan's S271 #114). `gate` GREEN, coherence 0/0. scrml-support 0/0. (This wrap PR merges on top.)
- **Delta-log `[642]`–`[646]`** carries the full S272 mechanical record; changelog S272 block + master-list §0 S272 line landed. Cheap delta-absorb for the next boot.
- **Solo now** — S271-bryan wrapped (#113 GITI-039 + #114 continuity/tenant-floor). No live sibling; no deputy.

## 🎬 WHAT LANDED
1. **#112 (`204b1897`)** — S270-peter continuity merged (was outage-stranded merge-pending; outage cleared).
2. **#115 (`7928421e`)** — **`W-EACH-TABLE-FOSTER`** info-lint for aM finding ①: a top-level `<each>` inside a table section emits a `<div>` mount the HTML parser foster-parents out of the table → silent 0 rows. Interim lint (`lint-w-each-table-foster.js` + api.js Stage 6.4f) makes it loud + points at the `<div>`-layout workaround. Gap `g-each-mount-div-foster-parented-in-table` (HIGH) + BRIEF `docs/changes/each-table-foster/`. 12/12 tests; R26-confirmed on merged main. **S239 finder caught a real `<if>`-wrapper coverage hole + 2 doc over-claims → fixed.**

## 🔬 aM finding ② — REDUCED, **NOT REPRODUCED** (no code, no gap)
Nested negated `if=!@showReset` "not hiding": ran the full matrix EXECUTED on main + aM's pin `9c950dfe` — 6-way permutation + faithful `<program>` + flat `<page>` + **aM's ACTUAL login.scrml (reverted to if=, real app.db) driven by the real "Forgot password?" button in REAL CHROME** (Peter's `offsetParent` console probe). **All hide correctly.** Root: the compiler auto-switches `if=` to a `display:none` toggle when the if-body has element-scoped wiring (`<form>`/`bind:value`); that toggle subscribes + hides (negation tracked, first-sibling wired). **Measurement lesson (→memory):** `textContent` counts `display:none` as present → false positive; `offsetParent`/computed-display is the correct measure (aM's). No gap filed (phantom-gap avoidance). aM notified.

## 🚦 OPEN THREADS / NEXT
- **aM go-live comprehensive scan (Peter-paced, deferred).** Peter: "I'll get back to you when we're ready for it" — aM + Peter have more to do first. THEN: the **real table-each foster fix** (a foster-safe anchor-node / table-context mount model — A/B fork in `docs/changes/each-table-foster/BRIEF.md`; a shared-each-runtime change → run the fork past the ladder before building) + drop the `W-EACH-TABLE-FOSTER` warning when the mount is table-safe + re-test. Also fold the **select/optgroup sibling gap** (an `<each>`→`<div>` mount is parser-dropped in "in select" mode → also silent 0 rows; noted in the known-gap) into that mount-model rework.
- **aM reciprocal note** — `assetManagement/docs/INBOX-from-scrml-pa-2026-07-19-table-each-and-if-hide.md` (UNCOMMITTED in aM's tree; covers both findings, ② updated with the non-repro). Peter to pull it in on the aM side.
- **Not my lane (bryan's):** the tenant-floor V1 build arc (RULED all forks S271 — SPEC amendment → V1-minimal redact-floor impl); #27 navigate; the freeze campaign.

## 🔬 ANOMALIES / WHAT TO WATCH
- **flogence digest CRASHES at boot** — `bun --cwd=../flogence run digest scrml --fresh` → `SQLiteError: no such table: project_vcs`. The `.pa-base/profile` line-62 "✅ VERIFIED WORKING (S265)" note is now STALE. Non-blocking (delta-log tail is the fallback rehydrate), but the profile note should be corrected if it persists next boot.
- **Pre-existing suite flakes on this Windows machine** (6–7, count varies between runs): `self-host`/`self-compilation` parity, `engine-a7` computed-delay timing, `session-b4b5` auth. Proven independent of S272's changes (identical on clean base). The cloud `gate` (Linux) is the merge authority and is green on these. No local git hook installed here, so they don't block commits.

## pa.md directives in force
PR-flow (branch→PR→cloud `gate`→merge on explicit authz; `gate`+`windows` gate) · **S239 mandatory adversarial pass on EVERY compiler-source land** — it caught the `<if>`-wrapper hole this session · **EXECUTE-don't-grep for client-runtime verify — AND measure the right thing** (visibility, not textContent) · adopter bugs = Peter's lane (`gh issue list` + aM inbox), security/foundational → bryan · premise-verify FIX dispatches (both aM findings premise-verified: ① real, ② not-reproduced) · R26 empirical · file-delta re-checks main under concurrent PA activity.

## Tags
#session-272 #peter-adopter-lane #112-merged #115-each-table-foster-warn #foster-parenting #if-hide-NOT-REPRODUCED #measure-visibility-not-textcontent #digest-crash #solo-after-s271
