# scrml — Session 229 (CLOSE)

**Date:** 2026-06-28. **Profile:** A — FULL (booted via `/boot A`). An **execution + direction** session: landed 2 builds, restructured the public docs, scoped + parked the SSR arc, reframed v0.8, **cut v0.7.1** (the first semver cut in ~29 days), and set up the protect-leak security debate for the dPA. Mechanical stream → `handOffs/delta-log.md` [201]–[209].

## 🚨 NEXT-START
Boot Profile A. Board @ close: **HIGH 0 · MED 6 · LOW 9 · Nom 7 · v0.7.1.** Suite green (full `bun run test` 25734/0/211, 1122 files). **PUSHED + TAGGED v0.7.1** (the wrap commit + tag). Maps: incremental refresh dispatched (wrap 6c) — lands in a follow-up commit (a few S229 codegen/typer files).

**Two live threads waiting on the user:**
1. **`dpa-017` is BANKED for the dPA drain** — the `g-sql-row-protect-leak` security-contract debate (A static-prove-and-error vs B structural-redaction-floor). 3 experts PRE-STAGED in `flogence/.claude/agents/` (live at dPA boot). **To run:** open an instance rooted in `/home/bryan-maclee/scrmlMaster/flogence` → `read dpa.md and boot` → it drains the queue → artifact + design-insight CANDIDATE → PA+user ratify the SPEC §14.8.7 amendment + build decomp.
2. **v0.8 framing decision (open).** The native-parser-swap peg is STALE (Road-B froze the native parser S222). The SSR survey (S229) established that **`g-tier1-ssr-prerender` is a sub-arc of the server-render-time / dynamic-deployment-target arc** (§58 Nominal · §40.9.5 · GITI-027B Option-D) — a plausible v0.8 milestone. Decide what v0.8 *is*; the 3 SSR rulings (deployment-target model · Option-A-DOM-prerender-vs-B-state-inline · auth/protect-during-SSR) are its step-0.

## 🎯 Design narrative (IRREDUCIBLE)
**1. The SSR survey — depth-of-survey in the CONSERVATIVE direction.** Unlike g-component-body (S228, where the "substantial subsystem" estimate was REFUTED), the `g-tier1-ssr-prerender` survey VERIFIED it: request-time server-side HTML composition genuinely does NOT exist (static-compile + CSR + JSON-routes-only; no DOM-adoption hydration). The full §52.8 target IS the ratified-but-unbuilt server-render-time/dynamic-deployment arc. **The survey STOPPED a premature build** + caught the gap's own `route-splitter.ts:1167` SSR-cite as wrong (it's chunk-JS bundling). SCOPE: `docs/changes/g-tier1-ssr-prerender-2026-06-28/SCOPE.md`. Parked as a ruling-gated arc (NOT a blocker — client-load works, W-AUTH-002 tracks).

**2. The v0.7.1 cut — the month-of-untagged-fixes capstone.** The user noticed PA had been cut-obsessed (v0.2→v0.7 = ~40 tags in 19 days) then silent for ~29 days while 922 commits landed. Diagnosis: the cut-generator was the rapid migration + gauntlet bug-clusters (each closed cluster → a patch); since v0.7.0 (S159) the work shifted to design/meta/spec-ahead, which produces no natural cut moments, and the discipline lapsed (even the changelog cut-blocks stopped at v0.6.6). **v0.7.1 cut this session** bundles those fixes so adopters pin to current. The v0.8 *milestone* needs a fresh target (see NEXT-START #2).

**3. The protect-leak debate (dpa-017) — the security contract is genuinely forked.** `protect=` enforces at the schema layer but the server-fn RETURN boundary is unguarded (`return ?{SELECT * FROM users}.get()` ships `passwordHash`). §14.8.7 deferred it. The fork: (A) static-prove-and-error (provenance/effect-typed rows; type error on a protected-bearing return; fail-closed) vs (B) structural-redaction-floor (serializer strips by construction; sound-by-construction + a static lint). Soundness is non-negotiable (a name-only check is unsound — the AS-alias). PA lean: B-floor + A-as-DX-layer, but it's a real fork worth the debate. Banked w/ complete framing + 3 staged experts.

## 🛟 Recovered anomalies / lessons
- **S88 isolation slip (my error, caught clean).** First `g-reactive-map-set-control-flow` dispatch OMITTED `isolation:"worktree"` → the agent's F4 startup-verification REFUSED to work in main (zero work, zero leak) → re-dispatched correctly. The F4 gate is exactly why it's there.
- **Verify-before-dispatch caught a mis-association.** "line up r28-c2" → r28-c2 turned out to be a DOCS gap (my board-survey script grabbed the wrong `###` header); the `Enum.toEnum` codegen item it described was ALREADY RESOLVED (ss22). Almost dispatched a build for a closed gap. (S138 reverse-direction discipline.) The board-survey grep needs token-anchoring, not header-anchoring (currency-pass class).
- **commit-timeout-but-landed ×3** (S227 pattern — the hook's full-suite runs hotter than 5min under load; verified HEAD each time before assuming failure). Foreground commits with the new tests + parallel load now reliably exceed the 5min Bash ceiling but LAND.
- **Markup-session: the brief premise was WRONG, the agent corrected it.** No markup-vs-logic asymmetry (fired in both); codegen was ALSO broken (not just the diagnostic). The agent wired a real read + a deliberate route-inference regression-guard + verified security-clean. 2 deferred follow-ons filed (no-auth @session diagnostic + missing GET /_scrml/session route).

## Board @ close
**HIGH 0 · MED 6 · LOW 9 · Nom 7 · v0.7.1.** Landings: `2e681e16` (dispose) · `9c23724e` (ratify-tier2 bookkeeping) · `ffc6fbec` (g-reactive-map-set-control-flow) · `b37327aa` (README/NERDME restructure, PUSHED) · `0df45d2e` (g-markup-session-read) · wrap+v0.7.1. Resolved: g-reactive-map-set-method-in-control-flow (MED) · g-markup-session-read (LOW). 0 worktrees. Delta-log [201]-[209].

## §push / cross-repo
**PUSHED + TAGGED v0.7.1.** flogence: the **tier-2 render schema RATIFIED** message sent (`2026-06-28-1127-...-RATIFIED.md`) + 3 dPA experts staged in `flogence/.claude/agents/` (gitignored machine-local roster). dpa-017 banked in `handOffs/dpa-queue.md`.

## Open follow-ons (filed, non-blocking)
- `g-markup-session-read` deferreds: a no-auth-`@session` diagnostic + the missing GET `/_scrml/session` route (`session.current` hydrates null today).
- `import-resolution.test.js` hygiene bug: the test transiently deletes its own committed fixtures mid-run (= the boot-time "6 deleted fixtures" source; disposed `2e681e16`). Clean ~LOW follow-on to make it use a temp dir.
- README anchor `#metaprogramming-` — eyeball on the rendered GitHub page.

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · S228 flobase-routing · S219 PRIMARY-GOAL + flogence digest-boot · S227 dock · S226 landing-concurrency + inversion-op · S215 adversarial-verify · S138 R26 + reverse-direction · S147 coherence · S94 bump-on-tag (v0.7.1 cut this session) · S136 BRIEF archival · S88/S99/S126 path-discipline · gate-cleanup-on-landing-success · wrap 8-step.

## Tags
#session-229 #close #board-HIGH-0 #v0.7.1-cut #ssr-arc-scoped-parked #v0.8-reframe-server-render-arc #dpa-017-protect-leak-debate-staged #2-builds-landed #readme-nerdme-restructure #tier2-render-ratified #verify-before-dispatch-catch #s88-isolation-slip-caught
