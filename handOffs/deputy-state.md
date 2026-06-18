# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — **REBOOT-GAP MODE (F3)**. S203 PA wrapped (`69172d25 wrap(s203)`, now PUSHED) with #3 in-flight + rebooted; deputy keeps looping. First deputy instance, booted S203. On tick 7.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c`, `7,37 * * * *`. CronDelete `39fed15c` to cancel.
- **Last-absorbed delta seq:** S203 **[15]** (no new entries since the wrap; the fresh PA hasn't committed any yet).
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint`. Base = wrap HEAD `69172d25`. **Tip:** `git rev-parse deputy-maint` (tick-7 commit: recent-sessions push-flip + this).
- **Owed maintenance:** none.

## ⚠ FOR THE FRESH PA ON BOOT (reboot-gap hand-back — STILL PENDING)

1. **`git merge deputy-maint` FIRST** — the wrap was PUSHED (`origin/main == 69172d25`) but **deputy-maint was NOT merged before that push** (coherence `0 ahead-main / N ahead-deputy`). So origin/main carries a STALE digest (`stamp c718d4c2 / seq 13` from the last merge) + recent-sessions. The deputy's reboot-gap maintenance (current digest `head 69172d25 / seq 15` + recent-sessions with the `69172d25` anchor `pushed`) is on deputy-maint, unmerged. Merge it, then push the merge so origin gets the current digest. (Until then the fresh PA's step-0 digest reads STALE → distrust+fall-back fires correctly — safe, but the thin-start benefit is lost for that one boot.)
2. **#3 agent `af88c53a8985b37fb` is STILL IN-FLIGHT** (see watch list) — re-attach + monitor, or read for a `(deputy) state` entry if the deputy recorded completion during the gap. Landing #3 is the fresh PA's first task (S67 file-delta + R26 dual-verify + expected-error reclassification + e2e baseline regen + flip g-raw-interp) per [15] — NOT the deputy's.

## In-flight dispatches (F3 watch list)

- **`af88c53a8985b37fb`** — bare-control-flow-in-markup diagnostic ([13]). **Status @ tick 7:** worktree present (locked); ADVANCED to 4 WIP commits — `453ff948` start · `82e7fc0a` SPEC §34 + §17.4 note · `342640b3` within-node allowlist · `8d6c3396` reclassify 3 render-map cells S-RAW-INTERP→fails-compile — + a STAGED uncommitted new test `compiler/tests/unit/control-flow-in-markup-reject.test.js`. Progressed since tick 6 (alive, not stalled) but uncommitted staged work → **NOT complete**. No `(deputy) state` re-attach entry yet. Watching: completion ≈ all deliverables committed + tree clean + (ideally) a non-WIP/final commit; the brief mandates SPEC §34 + recovery codegen + within-node allowlist + 3-fixture reclassify + e2e baseline regen + R26 + full test + the reject test. On completion → append `[N] (deputy) state · agent af88c53a completed @ <FINAL_SHA>; files: <list>; NOT landed (PA file-delta)`.
- ~~`abcf64f7198fe9cf3`~~ — CLOSED tick 5 (stop-surfaced [11]).

## Tick log

**T1 (boot):** [1]…[5]; recent-sessions regen; init. **T2:** [6]+[7] (F1 LIVE); first digest. **T3:** [8]+[9] (source-freshness + GO-LIVE). **T4:** [10] (abcf64f7 dispatched); rebased. **T5:** [11..13] (abcf64f7 closed; board MED→12/LOW→23; af88c53a dispatched). **T6 (REBOOT-GAP):** [14]+[15] (WRAP, #3 in-flight, F3 first use + (vpa:) directive); FF'd onto wrap HEAD `69172d25`; digest→current(seq15) + recent-sessions(post-wrap one-behind). **T7 (REBOOT-GAP):** no new deltas; wrap got PUSHED → recent-sessions push-flip (`69172d25` LOCAL-ONLY→pushed); digest still current (only derived commits since); af88c53a advanced (8d6c3396 + staged reject test) still in-flight; flagged deputy-maint UNMERGED-before-push for the fresh PA.

## Currency snapshot (@ tick 7)

- **Board:** HIGH 0 · MED 12 · LOW 23 · Nominal 8.
- **maps:** watermark `60d547e1` — behind HEAD but ALL docs/tooling/test-fixture (no compiler-source), CURRENT. **WATCH:** af88c53a [13] WILL land `compiler/src` (§34 diagnostic) + SPEC.md — maps refresh becomes owed on its landing.
- **digest:** current (head `69172d25`, delta-seq 15) on deputy-maint — but UNMERGED to origin (see hand-back).
- **recent-sessions / gap-counts:** PASS (wrap anchor now `pushed`).
- **flograph:** `--mmd`/`--filter`/`--focus` added [14]; round-trip intact.

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status` for branch tip + dirty state; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` delta-log entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting** (the narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). No reliable task-notification (it went to the dead PA) → poll git-state for completion.

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (clean on the disjoint surface; a real conflict = partition breach to surface). Main may move/push mid-gap independent of deputy-maint — absorb up to the HEAD seen at tick start.

## Operational notes (for re-hydration)

- **node_modules:** fresh worktree has NONE → symlink main's in (survives FF+rebase): `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` · `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before worktree ops.
- **Untracked new file:** `git add` before commit; tracked modifications commit by plain pathspec.
- **Commit gate:** pre-commit WARNS on non-main; runs ~17k subset (~80-120s); deputy commits derived-only → always passes; never `--no-verify`. `git rebase` does NOT run the gate.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` incremental; watermark `.claude/maps/primary.map.md` (`60d547e1`).
- `docs/changelog.md` — session block. · `@generated` §0 rollup (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1; per tick when a projected source moved).
- flograph — `scripts/flograph.ts`. · block-lease registry — (not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — deputy contract. · `scrml-support/pa-scrml.md` §"S199 addendum" — PA-side contract.
- `handOffs/delta-log.md` — the live PA-state stream. · `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design.
