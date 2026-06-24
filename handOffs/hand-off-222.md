# scrml — Session 217 (CLOSE)

**Date:** 2026-06-23. **Profile:** A — FULL. **Boot:** digest `current`. A **large execution + infrastructure session:** escalation-2 (which surfaced a latent shipped bug), a 4-bug client-render cluster from 2 adopters fixed in one parallel wave, the Ryan PR adversarial re-verify, and the multi-user PA MVP.

> **Thinned (S205).** Board/counts → `bun scripts/state.ts` + `handOffs/digest.md`. Fine-grained stream → `handOffs/delta-log.md` [41]–[53]. This carries the IRREDUCIBLE + open threads.

## Board @ close
**HIGH 0 · MED 13 · LOW 13 · Nom 8.** v0.7.0. Combined full suite **25007 pass / 0 fail / 213 skip** (1063 files). **5 commits pushed this wrap** (escalation-2 + GITI-031 + GITI-030 + on-mount + the wrap bookkeeping); scrml-support pushed separately (IP MVP `fd62911`).

## ✅ DONE
1. **escalation-#2 SSE author-route + LATENT INVALID-JS BUG (`f5f15009`).** Author `route=` on a `server function*` (SSE) honored in app mode + §12.3/§12.6/§37.3 carve-out. Phase-0 found the real gap: `generatedRouteName`=author-path → `export const /oauth/callback` → ESM SyntaxError for ANY author-route server fn (oauth/SSE/handle), unexercised by corpus. One-site fix. delta-log [42][45].
2. **giti render cluster (GITI-029/030/031) + g-onmount — 4 silent miscompiles, 3 parallel dispatches.** GITI-031 match-subpath (`078c2f58`); GITI-030 §4.17 raw-content (`7bf92bf1`, brief misdiagnosed→Rule-4 caught); GITI-029 parser + g-onmount §6.7.1 (on-mount commit). flogence each-stale = NOT-REPRODUCED (guard-canary). delta-log [47][51][52]. Only on-mount touched within-node allowlist (3-way reconcile trivial).
3. **Ryan PR #1 re-verify → HOLD / #2 GOOD.** delta-log [41]. Round-2 guidance `scrmlMaster/to-ryan-pr1-round2-guidance.md` (user reviews/sends).
4. **Multi-user PA MVP (IP=private/2A) — increments 1+2.** per-user profile split + identity wiring (pa-profile-bryan/ryan + pa-scrml.md) + agents-distribution (18 agents → scrml-support/agents/ + README; the HARD gap closed). DD `multi-user-pa-system-2026-06-23.md`. delta-log [43][49][50]. PUSHED to scrml-support.

## ⏸️ OPEN — S218 (priority order)
0. **Outbox replies OWED (write at S218 open or now):** (a) **giti** — GITI-029/030/031 RESOLVED + the GITI-030 §4.17 adopter-note (`<code>`/`<pre>` `${...}` doesn't interpolate by spec — use a non-raw element); (b) **flogence** — g-onmount-async FIXED + each-item-hidden-stale NOT-REPRODUCED (need their LIVE repro / stale-dist check). *(If not sent at wrap, these are the first S218 action.)*
1. **Ryan PR#1 round-2 + #2 — LANDED + PUSHED (post-wrap, S217).** Round-2 closed all round-1 findings (A/B regressions + D4 lambda-blind), F1/F3 held, fresh-adversarial clean, suite 25022/0. #1 `--no-ff` merge `b2bf9959` (authorship preserved); #2 CSRF cherry-picked `939d673e`+`d706f111` (his branch was on a STALE S214 base → cherry-pick the diff, NOT merge, to avoid reverting S216/S217). First external-contributor landing. delta-log [54]. **NOTHING owed** — both adopted.
2. **escalation-2 typer-scope follow-on** — `g-sse-route-object-typer-scope` (route.lastEventId/route.query in SSE body → E-SCOPE-001; blocks the resumable-SSE FSP cursor). MED, dispatchable.
3. **dpa-003 `_{}` inline-codegen BUILD** + §23.2.4 amendment (downstream of dpa-004; §23.2.4 forbids logic-ctx `_{}` → reconcile with §13180).
4. **Half-2 convergence** — `<each>` bind: + `buildHandlerExpr` dedup (Family-A; fixes g-expr-event-handler-dead-in-each MED). SCOPING `docs/changes/family-a-converge-half1-...`.
5. **3 un-triaged intakes CARRIED (in inbox — triage at S218 open):** (a) 6nz `idiomatic-rewrite-findings`; (b) 6nz `each-empty-fallback-leak` BUG; (c) **giti `conditional-markup-in-match-arm`** (NEW — likely render-adjacent to the just-closed GITI-029/030/031 cluster; triage FIRST). The giti/6nz reply+intake cadence is hot — these arrived during S217.
6. **Multi-user PA MVP — remaining refinements:** user-voice-scrml→-bryan rename; methodology-memory-lift residual; full pa-scrml→pa-base+overlay migration; path-param to `$SCRML_HOME`. **User's step: add Ryan as a scrml-support collaborator (GitHub).**
7. **Carried:** g-enum-toenum-not-lowered-server-side (MED) · giti three-codegen library-mode cluster · pa-base v2 Part-C · A4/stdlib Phase-3.

## Anomalies / lessons
- **GITI-030 brief misdiagnosis** — my triage (+ giti's framing) called it a key-field bug; the agent's Rule-4 cross-check found it's §4.17 raw-content (`<code>`). The agent REJECTED the brief's §4.17-violating ask + fixed the real defect. Brief-framing can be wrong; Rule-4 is the guard.
- **flogence each-stale NOT-REPRODUCED** — R26-reverse discipline held: the agent did NOT fabricate a fix for a non-reproducing bug; shipped a guard canary + STOP. Likely already closed by S158 Bug64. Need flogence's live repro.
- **escalation-2: empirical Phase-0 beats the brief's premise** — the build was scoped as a "narrow carve-out"; Phase-0 found a latent invalid-JS bug instead. Empirical-first dispatch framing paid off.
- **3-parallel-dispatch within-node reconciliation was trivial** — only on-mount touched the allowlist (each/match: codegen-internal). The combined full-suite (25007/0) confirmed the re-baseline holds across all 4 landings.
- **Deputy maps 22-behind** — the S217 code landings (emit-each/emit-html/emit-variant-guard/emit-match/route-inference/ast-builder/within-node-classifier) need a maps refresh; OWED to the deputy's post-wrap backstop (deputy-maint merged this wrap carried only the S216 batch).

## pa.md directives in force
R1–R5 · `---` · Profile A · digest-first · S88/S99/S126 · S136 BRIEF · S138 R26 (fwd+reverse) · S147 coherence · S199/S205 deputy + merge-before-push · S119 explicit-pathspec · S215 adversarial-verify + random-sample-10× · **S217 NEW: per-user profile resolution (multi-user PA)** · wrap 8-step.

## Tags
#session-217 #close #escalation2-latent-invalidjs-bug #giti-render-cluster-029-030-031 #g-onmount-fixed #ryan-pr-hold #multi-user-pa-mvp #pushed
