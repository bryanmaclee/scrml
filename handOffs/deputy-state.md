# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — steady-state (S204 pushed; deputy-maint CAUGHT UP — origin current, coherence 0/0). First deputy instance, booted S203. On tick 14.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c`, `7,37 * * * *`. CronDelete `39fed15c` to cancel.
- **Last-absorbed delta seq:** S204 **[8]** (no new entries since the wrap).
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint`. Descends main `0bc9fe0e` (== main; all prior deputy work merged + pushed). **Tip:** `git rev-parse deputy-maint` (tick-14: this deputy-state note).
- **Owed maintenance:** none on deputy-maint. (The strand below is PA-side — deputy can't fix it.)

## ⚠⚠ RECURRING PATTERN (now 2×) — PA pushes before merging deputy-maint → deputy work strands on origin

**S204 instance RESOLVED (tick 14):** the PA did the catch-up `git merge deputy-maint` + push per the tick-13 recommendation → origin now carries the current maps (`cc765a5a`) + digest + recent-sessions; coherence `0/0`. The hard-pre-push-merge-gate recommendation below still stands as the durable fix (it prevented nothing this time — it was a manual catch-up).

**It happened again.** Tick 12 flagged "merge deputy-maint before pushing S204." The PA **pushed S204 anyway** (`e723de04` on origin) **without merging deputy-maint** → **origin's maps are STALE (`60d547e1`)** while the current maps (`cc765a5a`, the #3 source change) + the re-regen'd digest/recent-sessions sit STRANDED on deputy-maint. Coherence `0 2`, clean FF — they land whenever the PA next merges deputy-maint (a follow-up `git merge deputy-maint && git push`, or the next session's boot-merge).

**The pattern (2 occurrences):**
1. **S203 digest-miss** — wrap pushed pre-merge → fresh PA's step-0 digest read STALE, fell back (F1 realized 0 — confirmed by the [6] dilation measurement).
2. **S204 maps-miss** — wrap pushed pre-merge → origin ships stale maps; deputy's first real maps refresh doesn't reach origin.

**Root + fix (PA-side, route to PA — deputy can't push/merge main):** the deputy's value only reaches origin if the PA merges deputy-maint BEFORE pushing. Recommend the PA-side contract / wrap step make **`git merge deputy-maint`** a HARD pre-push gate (the S147 coherence check after a push should also assert deputy-maint is merged, i.e. `git rev-list --count deputy-maint ^main == 0`, else the wrap shipped without the deputy's maintenance). Until then the deputy's F1/F2 dilation keeps realizing ~0 at origin even though it's correct on deputy-maint.

## Maps mechanism — RESOLVED (S204, user ruling)

User: *"refresh the maps, this does not require my consent."* Function-2 maintenance, not a design call. **Standard mechanism:** dispatch `project-mapper` (Agent tool, NO isolation — operate IN deputy-maint) with a strict worktree-only-path brief (`cd` the worktree first; absolute worktree paths; never touch/`cd`/commit in main; don't commit — leave modified) + **independent post-dispatch verify** `git -C <main> status --porcelain -- .claude/maps/` is EMPTY before committing. Tick-12 run: main verified untouched; primary/structure/error refreshed; watermark `60d547e1`→`cc765a5a`; committed explicit-pathspec.

## In-flight dispatches (F3 watch list)

- _(empty)_ — `af88c53a` landed (#3); `abcf64f7` closed tick 5.

## Tick log (compressed)

T1 boot [1-5]; T2 [6-7] F1; T3 [8-9] GO-LIVE; T4 [10]; T5 [11-13]; **T6-T8 reboot-gap** (#3 bridged → fresh PA re-attached + LANDED a6405053); **T9** S204 [1-3]; **T10** [4-5] flograph; **T11** [6] dilation ~3%; **T12** maps REFRESHED (60d547e1→cc765a5a, user ruling, main-clean verified) + [7-8] (S204 wrap, push-pending); **T13** S204 PUSHED pre-merge → maps/digest/recent-sessions STRANDED on deputy-maint (2nd merge-before-push miss); recent-sessions push-flip. **T14** PA caught up (merged deputy-maint + pushed) → origin current, 0/0; nothing owed.

## Currency snapshot (@ tick 13)

- **Board:** HIGH 0 · MED 12 · LOW 23 · Nominal 8.
- **maps:** deputy-maint `cc765a5a` (CURRENT) — **main/origin still `60d547e1` (STALE, stranded — see PATTERN above)**.
- **digest:** current (head `bf7c8759`, delta-seq 8) on deputy-maint; main carries the PA's d64d4519-stamp digest.
- **recent-sessions / gap-counts:** PASS (push-flip applied).
- **flograph:** slices 1-3 landed.

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` delta-log entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting** (narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). Poll git-state.

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (clean on the disjoint surface; a real conflict = partition breach to surface). Main may move/push mid-tick — absorb up to the HEAD seen at tick start.

## Operational notes (for re-hydration)

- **node_modules:** fresh worktree has NONE → symlink main's in (survives FF+rebase): `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` · `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before worktree ops.
- **Untracked new file:** `git add` before commit; tracked modifications commit by plain pathspec.
- **Maps refresh:** project-mapper into the worktree + main-clean verify (see "Maps mechanism").
- **Commit gate:** pre-commit WARNS on non-main; runs ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`. `git rebase` does NOT run the gate.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree (mechanism resolved T12); watermark `.claude/maps/primary.map.md` (`cc765a5a`).
- `docs/changelog.md` — session block. · `@generated` §0 rollup (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1; per tick when a projected source moved — incl. a maps refresh).
- flograph — `scripts/flograph.ts`. · block-lease registry — (not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — deputy contract. · `scrml-support/pa-scrml.md` §"S199 addendum" — PA-side contract.
- `handOffs/delta-log.md` — the live PA-state stream. · `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design.
