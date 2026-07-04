# scrml — Session 237 (OPEN)

**Date:** 2026-07-04. **Profile:** A — FULL (booted `/boot`). Session in progress — this hand-off fills as work lands; it becomes the S237 CLOSE at wrap. Prior close: `handOffs/hand-off-238.md` (S236). Mechanical stream → `handOffs/delta-log.md` [324→]. Narrative → `docs/changelog.md`.

## 🚀 NEXT-START — the path to V1 (carried from S236 freeze-readiness)
The flagship pillars are DONE (conformance 72→220, 25 categories). V1-freeze is within reach — a handful of focused arcs, NOT open-ended. Map: `scrml-support/docs/deep-dives/v1-freeze-readiness-2026-07-03.md`. Priority path:
1. **Fix the ~8 freeze-BLOCKER correctness bugs** (covered-but-broken surfaces). Lead with **`g-not-cell-render-null-throw`** (MED, FOUNDATIONAL — `${@cell.field}` on a `not` cell THROWS; V5-strict violation, the sharpest). Then `g-is-literal-rhs-if-condition-drop` · `g-enum-toenum-not-lowered-server-side` (r28-c2) · the CSRF/auth pair (`g-auth-csrf-token-never-surfaced` + `g-csrf-retry-helper-def-gated`) · the typer soundness pair (`g-typer-bare-variant-non-return-ambiguous`, `g-typer-hostmethod-return-asis-and-anon-struct-poison`) · `g-fail-variant-payload-arity` (needs the **E-ERROR-010 mint** — probe fail-only-vs-general first). ← highest-value; dispatch-able in a wave like S236's Bucket-1+2.
2. **Author the sPA-able coverage TAIL:** api §60 · @apply/CSS §26 · meta `^{}` §22 · **SQL §8 / schema §39 RUNTIME (unblocked by the ratified `serverDb`)**. Mechanical, sPA-able.
3. **Track-B phases 5/6/8** (SSE/nav/WS drivers) → then channels §38 / SSE §37 / nav §20 coverage. Each = driver build + a per-phase contract ratification (advance-time/serverDb pattern).
4. **D1/D2/D4 LABELING** — VERIFY state: chunks.json `language` field wired? spec partition done? deprecation conformance cases (zero built). Gates the freeze independent of coverage.
5. **The freeze decision.**

**Also queued/owed:** flogence **S217 lift-driver joint DD** in flight (delta [681] — flogence drives currency-passed modules → candidate `pa-base.md` §-additions for bryan to ratify; see `flogence/docs/deep-dives/s217-lift-driver-2026-07-03.md` + inbox reads) · **reset-reserved impl fix** (ruled ENFORCE, needs a dispatch — `g-reset-reserved-identifier-unenforced`) · **maps refresh** (watermark 8+ commits behind — run `project-mapper` incremental; deferred S235/S236) · **MEMORY.md over-limit trim** (25.9KB / 24.4KB).

## 🚦 STATE @ S237 boot
- **git:** scrml HEAD `57de558a` (S236 WRAP), **origin SYNCED 0/0**, working tree CLEAN. Commit gate installed (Config B — `.git/hooks/` pre-commit+post-commit+pre-push). conformance **220/220**.
- **Board (from S236 close + freeze-readiness):** HIGH **0** · MED **14** · LOW **13** open · Nominal set. Named blockers = the ~8 freeze-blocker set above (all MED).
- **Worktrees:** CLEAN (only main checkout, per S236 close). No deputy (retired S219).
- **Inbox:** `handOffs/incoming/` empty at boot (only `dist/` + `read/`). flogence exchange from S236 archived to `read/`; the S217 lift-driver joint DD is the live cross-PA thread.
- **Boot:** Profile A full reads done (pa-scrml.md IN FULL · PRIMER pending on-demand · SPEC-INDEX section-table on-demand · master-list §0 · user-voice tail S230-236 · flogence programmatic digest). Old `handOffs/digest.md` is STALE (S218) — superseded by the flogence digest per S219.

## 🧵 In-flight threads
- (none active at boot — S236 wrapped clean. Next work = the freeze-blocker wave, pending user direction.)

## 🧾 Owed at wrap
- Maps refresh (project-mapper incremental — watermark behind by the S235+S236 landing set).
- MEMORY.md trim (over the 24.4KB limit).
- reset-reserved impl fix (ENFORCE) · E-ERROR-010 mint (fail-variant-arity).

## pa.md directives in force
R1–R5 · Profile A · commit `timeout:600000` · **S236: `git show --stat` verify non-empty after file-delta commits + stage+commit in ONE bash** · S226 landing-concurrency (disjoint-verify / 3-way-merge-shared) · S219 PRIMARY-GOAL/orchestrate + memory-gated-commit · S215 adversarial-verify + 10× sample · S138 R26 (both directions) · S147 coherence · S88/S90/S99/S126 path-discipline · S227 dock-as-navigation.

## Tags
#session-237 #open #boot-profile-a #path-to-v1 #freeze-blocker-wave-queued #flogence-lift-driver-dd-live
