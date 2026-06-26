# scrml — Session 222 (OPEN)

**Date:** 2026-06-26. **Profile:** A — FULL. Booted via `/boot` (flobase `.pa-base/profile` absent → fell back to the legacy `pa.md` → `pa-scrml.md` path, correct; this repo predates the flobase migration). Boot reads: pa-scrml.md IN FULL · SPEC-INDEX header (section table grep-on-demand) · master-list §0 · hand-off (S221 CLOSE) · delta-log tail [89]-[108] + flogence digest · user-voice S216-S221. PRIMER deferred (S221 precedent). Git 0/0 clean. Board @ open: **HIGH 0 · MED 17 · LOW 14 · Nom 7 · v0.7.0 · suite 17979/0/68 (pre-commit subset).**

> Mechanical stream → `handOffs/delta-log.md` (continue at [109]). Board: `bun scripts/state.ts`. Recent state: `bun ../flogence/scripts/digest.ts scrml --fresh`.

## 🚨 NEXT-START / IN-FLIGHT AT OPEN
- **ss30 (W3) RE-INTEGRATED its result during boot** (inbox: `2026-06-26-from-spa-ss30-...-REINTEGRATION.md`). Clean additive characterization test (`spa/ss30` tip `2768d1ea` = `f1607b97` + 1 commit, 186 ins/0 del, no source touched, FF-able). **HEADLINE (Rule 4):** W3-codegen was ALREADY BUILT (A-4.1..A-4.7, S91) — third stale estimate. The genuine remaining feel-of-performance work is **W4 (runtime loader)**. **Pending PA action:** land the test (needs commit auth) + apply the SCOPE.md row-30 currency fix + route the 5 parked forks to the user.

## ⏸️ OPEN — S222 (priority order, carried from S221 close)
1. **🎯 STRATEGIC THREAD — parser / compiler-re-imagining fork.** De-risk SCOPED (`docs/changes/compiler-reimagining-derisk-2026-06-26/SCOPE.md`): run a `scrml-deep-dive` on the **lexer-as-scrml-`<engine>`** slice (design-not-build; rubric cleaner/showcase/feasible + gap-log) → user RULES Road A (finish JS native parser — tech-debt only) / Road B (re-imagine compiler e2e in scrml) / shelve. User-voice S221: "native parser is about as native as crocodile dundee is to new york… if we aren't going to use it to show off scrml, then why do it." The "humans-build-V1" rule disposition rides on it (parity-port vs human-authorship).
2. **W4 (feel-of-performance runtime loader)** — the real next wave now W3-codegen is verified built. The chunks are mount-marker descriptors nothing loads yet; the payoff is unrealized until W4 loads the initial chunk instead of the monolith. + the 5 ss30 parked forks (W3↔W4 payload boundary · role projection · empty-tier manifest 404-risk · Component-3 N≥1 · SCOPE currency).
3. **bug-1 @apply** — user leans `@apply` (S221). Needs its own scoping pass (parse site + utility-resolution reuse + §26.7 var()-family composition). Not blocking (§28 lint=off escape covers adopters).
4. **Fireable lists:** ss24 (endpoint/dpa-013), ss26 (SSR survey) — share emit-server/type-system surface. **ss28 (native-parser) HOLD pending the parser fork (#1).**
5. **The rotting backlog** (S219 primary-goal): 17 MED · 14 LOW + the Nominal features.

## 🔭 Latent / awareness
- Pre-existing `(fail) If-Else (control-002)` in `scripts/compile-test-samples.sh` sample-compile step (flagged by ss30; NOT theirs — additive test commit; gate passed). Investigate when convenient.
- `pa-profile-bryan.md` absent (S217 said created) — non-blocking; register fully in pa-scrml.md Rule 5.
- Dirty working tree at boot: `spa-lists/` bookkeeping (ss22/ss23/ss29 list checkboxes + 2 progress logs) — leftover from S221 sPA re-integrations, docs-only, underlying gaps already landed. Commit at next opportunity.
- Maps 20 commits behind HEAD; digest STALE (old `state.ts --digest` path; S219 uses flogence digest now). project-mapper owed at wrap.

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · **S219 PRIMARY-GOAL** (orchestrate-don't-grind / default-GO / blocking-Q-only) · S219 flogence digest-boot · **S219 deputy ELIMINATED** (no deputy-maint; maintenance reverts to PA-at-wrap; S205 merge-before-push RETIRED → push = plain S147 coherence) · S88/S99/S126 path-discipline · S136 BRIEF archival · S138 R26 (+ reverse) · S147 coherence · S215 adversarial-verify + random-sample audit · S217 per-user (bryan) · wrap 8-step.

## Tags
#session-222 #open #boot #parser-reimagining-fork-pending #w3-already-built #w4-is-the-real-work #ss30-reintegrated-at-boot
