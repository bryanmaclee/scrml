# scrml — Session 221 (CLOSE)

**Date:** 2026-06-25→26. **Profile:** A — FULL. A large execution + strategic session: an sPA-orchestra throughput run (6 re-integrations + Enhanced-A + idle + flogence triage) that turned into the **revival, de-risking, and first real-app landing of the "feel of performance" splitter arc**, then a **parser/compiler-re-imagining strategic conversation** → a scoped de-risk + W3 minted.

> **Mechanical stream → `handOffs/delta-log.md` [89]–[108].** Board/counts: `bun scripts/state.ts`. This carries the IRREDUCIBLE (narrative · open threads · recovered anomalies).

## 🚨 NEXT-START
Boot Profile A (the strategic threads need the expert context). Run `bun ../flogence/scripts/digest.ts scrml --fresh` (step 0) for the recent stream; read THIS for the plan. Board @ close: **HIGH 0 · MED 17 · LOW 14 · v0.7.0 · suite 25392/0/214.** Coherence pushed at wrap. **NO deputy** (S219). 24 worktrees pruned — only main.

## ⏸️ OPEN — S222 (priority order)
1. **🎯 THE STRATEGIC THREAD — parser / compiler-re-imagining fork.** The de-risk is SCOPED (`docs/changes/compiler-reimagining-derisk-2026-06-26/SCOPE.md`): run a `scrml-deep-dive` on the **lexer-as-scrml-`<engine>`** slice (design-not-build; 3-criteria rubric cleaner/showcase/feasible + gap-log) → user RULES Road A (finish JS native parser — tech-debt only) / Road B (re-imagine compiler e2e in scrml — flagship + architectural reset) / shelve. User-voice S221: "native parser is about as native as crocodile dundee is to new york… if we aren't going to use it to show off scrml, then why do it." Both roads are rewrite-traps; B bigger; de-risk-first is the agreed move. The "humans-build-V1" rule disposition rides on it (parity-port vs human-authorship — clarify which it protects).
2. **W3 (ss30) — fireable now** (`read spa.md ss30`). The A-4 codegen splitter (consume W2's now-populated ChunkPlans → real tiered chunks). **SURVEY-FIRST + park-design-forks** — expect mostly-survey + a fork-list (W1/W2 taught us estimates are stale). The last big splitter wave before W4 (runtime loader) + W5 (TTI demo). Component-3 (server-fn N≥1 interaction projection) is the other unbuilt RS piece (serverFnNodeIds=0 today — correct, later wave).
3. **The feel-of-performance arc state** (`docs/changes/feel-of-performance-approach-a-impl-2026-06-26/SCOPE.md`): W1 ✅ (S88) · W2 ✅ (S221, trucking 21 non-empty closures) · W3 = ss30 · W4 runtime loader · W5 tests/demo. **Banked W3.5 coupling:** block-lease conflict-query = `closure∩closure` falls out of the splitter near-free (flogence's block-lease inference → compiler-native).
4. **bug-1 @apply** — user leans `@apply` (banked S221, the bug-1 gap). Needs its own scoping pass before build (the @apply parse site + utility-resolution reuse + §26.7 var()-family composition). Not blocking (§28 lint=off escape covers adopters).
5. **Fireable lists:** ss24 (endpoint/dpa-013), ss26 (SSR survey) — both share emit-server/type-system surface, HOLD while W3/splitter runs. **ss28 (native-parser) — HOLD pending the parser fork (#1).** ss30 (W3).
6. **The rotting backlog** (per the primary-goal directive): 17 MED · 14 LOW + the Nominal features. dpa follow-ons banked.

## 🎯 Design narrative (IRREDUCIBLE)
- **Feel-of-performance was never stalled — it was ratified + half-built + dormant.** Insight 29 (5-voice debate, S84-era) ratified Approach A; the S84 study found 99-100% static resolvability; the RS solver + AuthGraph got BUILT (S86-S91). This session: re-verified OQ#1 on REAL adopters (giti 100/flogence 99.7/6nz 95.6 — the 6nz dynamic-key idiom is splitter-benign, cell-granularity; killed the "forbid dynamic-key" mitigation; confidence MEDIUM→HIGH). W1 was already built (S88). W2 landed (entry-points + Component-1 `<db>`-descent). **The splitter now produces real closures on a real app for the first time.**
- **The §40.9.2 ruling (mine, against the spec):** a `<db src>` is a connection-scope wrapper, not a rendered component → Component 1 descends it to the render surface; empty closures for db-backed pages was a bug. SPEC §40.9.2 4th normative bullet landed.
- **The parser/re-imagining fork (the strategic prize):** Road A (JS native parser) showcases nothing — tech-debt paydown, wasted if Road B. Road B (compiler e2e in scrml) = the flagship + an architectural reset from scrml's model (engines/reactive-graph/co-location) vs the inherited TS-imperative structure. De-risk before committing (the OQ#1 move): design one slice, evaluate, then rule.

## 🛟 Recovered anomalies (reasoning)
- **Survey-first dispatch paid off twice** (W1 already-built → avoided a wasted rebuild; W2 bigger-than-estimated → surfaced the §40.9.2 ruling + 2 wrong brief-premises the agent corrected, Rule 4). PIPELINE estimates are stale — code over derived-doc.
- **3 collision-reconciliations** (ss22+ss25 competing `ast-builder` rewrites of the SAME inline-struct bug; ss23/ss29 SPEC.md 3-way) — `git merge --squash` 3-way preserved landed work (ss27 prune-stage, ss21 unary-`**`, ss23 §23.2.4a, ss29 §26) that blind file-delta WOULD have clobbered. The recurring lesson; verify-git-state-not-ping-narrative (S138) caught ss23's wrong "untouched" claim.
- **flogence Finding-A (CPS deferral, reported HIGH) NOT-REPRODUCED** — resolved by ss22's per-statement auto-await, landed THIS session; the report predated our own fix (S138 reverse-direction).
- **SPEC.md L14099 mojibake is PRE-EXISTING** (auth section, not any S221 landing) — separate cleanup; every SPEC-touch this session mojibake-guarded.

## Board @ close
**HIGH 0 · MED 17 · LOW 14 · v0.7.0.** Suite **25392/0/214**. Pushed clean at the mid-session push (`1ad1f847`); the wrap commits + the W2 landing push at wrap-end. flogence S14/S15 replies SENT. giti enum-toEnum flag owed (deferred). Maps: project-mapper owed (19 behind — run next session or at this wrap-end).

## pa.md directives in force
R1–R5 · `---` · Profile A · **S219 PRIMARY-GOAL** (orchestrate-don't-grind / default-GO / blocking-Q-only) · S219 flogence digest-boot · S88/S99/S126 path-discipline · S136 BRIEF · S138 R26 (+ reverse) · S147 coherence (S205 merge-before-push RETIRED) · S215 adversarial-verify · S217 per-user (bryan) · wrap 8-step. New this session: the §40.9.2 ruling; the de-risk-before-strategic-commit pattern (OQ#1 → feel-of-perf → now the compiler fork).

## Tags
#session-221 #close #feel-of-performance-revived #w2-landed-splitter-real-app #§40.9.2-ruling #parser-reimagining-fork #de-risk-scoped #w3-minted #6-spa-reintegrations #enhanced-a #apply-lean
