# scrml — Session 238 (OPEN)

**Date:** 2026-07-04. **Profile:** A — FULL (booted `/boot`). Prior close: `handOffs/hand-off-239.md` (S237). Boot reads: pa-scrml.md IN FULL · pa-profile-bryan · hand-off S237 · user-voice tail S236-237 · delta-log [347]-[350] · flogence digest (state confirms hand-off). PRIMER + SPEC-INDEX deferred to on-demand (S237 precedent — read the named sections when the first spec-implicating arc starts). No work landed yet.

## 🚦 STATE @ S238 boot
- **git:** scrml HEAD `66a3afb1` (S237 WRAP bookkeeping recover), **origin SYNCED 0/0**, working tree CLEAN. Commit gate = Config B (`.git/hooks/` pre/post-commit + pre-push).
- **Board:** HIGH **0** · MED **15** · LOW **14** open · Nominal **7**. conformance/tests **19140 pass / 65 skip / 0 fail** (pre-commit subset). Version **0.7.1**.
- **Worktrees:** CLEAN (main only). No deputy (ELIMINATED S219 — programmatic flogence digest is the boot state-absorb).
- **Inbox:** empty (`handOffs/incoming/` = dist/ + read/ only).
- **⚠️ MAPS: 57 commits behind** (watermark `2fb2bf1f`, HEAD `66a3afb1`) — CRITICALLY OVERDUE, 5-session deferral (S234→S238). **Run `project-mapper` FIRST before any map-reliant dispatch.**

## 🚀 NEXT-START — priorities carried from S237 (full detail: `handOffs/hand-off-239.md`)
1. **Standalone-tool target — SCOPE + build** (RATIFIED S237). Two surfaces: `<program kind="tool">` (entry-point tools → plain runnable module, no html/client/CSRF/HTTP; composes with `lang=`→`_{}` + `db=`→`?{}` via W5b) + library-with-`lang=` (closes E-FOREIGN-003). Entry convention `fn main(args:string[]):number` → `main(process.argv.slice(2))` then `process.exit(<return>)` ONLY when main RETURNS (blocking main stays up). Grounding: §43 execution-context kinds + §23.5 `capabilities=`. flogence = consumer/R26 — ping before build for the MCP-stdio-blocking-main emit review. → write SCOPE, dispatch.
2. **emit-library type-strip (`g-library-mode-no-typed-payload-match`)** — STRATEGIC Road-B blocker + flogence's next 100%-scrml domino. Route library-mode emit through the real emit-logic/emit-expr path (not the regex shim) so typed fns / `match` / payload-variants lower. flogence's typed harness needs it.
3. **Freeze-blockers 3-8** (the wave continues, all MED): enum-toEnum (`g-enum-toenum-not-lowered-server-side`) · CSRF/auth pair (`g-auth-csrf-token-never-surfaced` + `g-csrf-retry-helper-def-gated`) · typer-soundness pair (`g-typer-bare-variant-non-return-ambiguous`, `g-typer-hostmethod-return-asis-and-anon-struct-poison`) · `g-fail-variant-payload-arity` (needs **E-ERROR-010 mint** — probe fail-only-vs-general first).

## 🚀 Path-to-V1 (carried S236 freeze-readiness)
Flagship pillars DONE (conformance 72→229, 25 categories). V1-freeze within reach — bounded, not open-ended. Map: `scrml-support/docs/deep-dives/v1-freeze-readiness-2026-07-03.md`. Path: (1) fix ~6 remaining freeze-blocker correctness bugs [wave, above] · (2) author sPA-able coverage TAIL (api §60 · @apply/CSS §26 · meta `^{}` §22 · SQL §8/schema §39 RUNTIME) · (3) Track-B phases 5/6/8 (SSE/nav/WS drivers) · (4) D1/D2/D4 LABELING (VERIFY state) · (5) the freeze decision.

## 🧵 Owed / queued
- **Owed to flogence:** standalone-tool SCOPE review (ping before build) + the type-strip fix ping.
- **reset-reserved impl fix** (ruled ENFORCE, `g-reset-reserved-identifier-unenforced`) — needs a dispatch.
- **E-ERROR-010 mint** (fail-variant-arity, part of freeze-blocker 8).
- **Deferred gaps (S237, MED/LOW open):** `g-request-data-is-some-misroute` · `g-terse-closer-reparse-narrow` · `g-nested-match-in-arm-body` · 2 g-etype046 residuals · W5b E-SQL-009-narrow residual.
- **MEMORY.md** — at 24.39KB / 24.4KB limit (trimmed S237; near-cap).

## pa.md directives in force
R1–R5 · Profile A · commit `timeout:600000` · S236 `git show --stat` verify non-empty after file-delta + stage+commit in ONE bash · S226 landing-concurrency (disjoint-verify / 3-way-merge-shared) · S227 dock investigation-as-query · S219 PRIMARY-GOAL orchestrate-don't-grind + default-GO + DEPUTY-ELIMINATED (flogence digest boot) · S215 adversarial-verify + 10× sample · S138 R26 (both directions) · S147 coherence · S88/S90/S99/S126 path-discipline.

## Tags
#session-238 #open #boot-profile-a #path-to-v1 #standalone-tool-scope-queued #freeze-blocker-wave #maps-overdue
