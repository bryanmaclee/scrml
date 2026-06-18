# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — steady-state (S205 active). First deputy instance, booted S203. On tick 31.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c`, `7,37 * * * *`. CronDelete `39fed15c` to cancel.
- **Last-absorbed delta seq:** S205 **[10]** (`scrml/handOffs/delta-log.md` — absorbed [S199 1] … [S205 10]; the slice-3/BUG-1/emit landings aren't logged as delta entries).
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint`, descends main (PA integrates via the pre-push merge gate). **Tip:** `git rev-parse deputy-maint`.
- **Owed maintenance:** **MAPS refresh BATCHED** — 2 in main (emit `776e978a` + slice-3 `f4fae410`, 15 .scrml files); g-match-alternation COMPLETE-in-worktree, landing imminent → ONE project-mapper run covers all 3 once g-match lands (next tick). Else current.

## Standing facts (durable)

- **Merge-before-push gate (RESOLVED + ratified S205 [2]):** PA asserts `git rev-list --count deputy-maint ^main == 0` before any push (pa.md S199 addendum + wrap step 7); closes the S203/S204 strand. Fired in practice (`f07f8406`, `e14462a6`).
- **F1 dilation REALIZED (S205 [3]):** clean-cycle re-measure — F1 ~8.3k (was 0 in S204); total ~14-15k/cycle ≈ 1.5%/1M. Net-positive.
- **Maps mechanism (RESOLVED T12, user no-consent):** `project-mapper` into the deputy-maint worktree (CWD-pinned, worktree-only brief, NO isolation) + verify `git -C <main> status --porcelain -- .claude/maps/` EMPTY before committing.

## Graph/dock health (§3c — per-tick standing step, S205 [10])

- **Snapshot @ tick 31 (PASS, unchanged):** flograph 428n/103e (--with-support --with-archive) · currency-sweep **0 (clean)** · 14 unverified · 15 dangling · 0 dup · 0 err. dock --check PASS · dock --coverage 0/628 (0.0%) · 0 orphans. **No NEW finding.**
- **route to PA (open, tooling nit):** §3 plain `flograph --emit` vs §3c `--check --with-support --with-archive` → graph.json drifts to the 190n default; deputy compensates by emitting with the matching flags. Align §3 flags with §3c (or make --check corpus-aware).

## In-flight dispatches (F3 watch list — PA alive, tracking only, no `(deputy)` entries)

- **`a3a475168766ceba8`** (trucking slice-3) — **LANDED `f4fae410`** (20 each-sites/15 .scrml files + BUG-1 filed; worktree 6b-cleanup PA-pending). In the maps batch.
- **`a634857265ed2b578`** (g-match-alternation-value-vs-derived) — @ tick 31 tip `40a1d2b4 "fix landed, full suite 24445/0"`, clean → **COMPLETE, awaiting PA landing** (not yet in main). On landing → completes the maps batch (refresh then).

## Tick log (compressed)

- **T1** boot [S199-S203]. **T2-T5** F1 LIVE + GO-LIVE + e2e/flograph. **T6-T8** reboot-gap — #3 in-flight across a PA reboot, bridged → fresh PA re-attached + LANDED (a6405053), zero loss.
- **T9-T11** S204 [1-6] — #3 landed; dilation ~3% (frame-corrected). **T12** maps REFRESHED 60d547e1→cc765a5a (user ruling). **T13** 2nd merge-before-push miss flagged. **T14** PA caught up.
- **T15** S205 [1-6] — merge-before-push gate RATIFIED + F1 realized ~8.3k + dock built. *Lesson:* re-check delta-log AFTER sync. **T16-25** PA idle (10 no-ops).
- **T26** S205 [7-9] — corpus deref + flograph --with-archive + harness-validation capstone; gate fired. **T27** S205 [10] — §3c guardrail wired; first health check; routed emit-flag nit. **T28** no-op.
- **T29** F3: slice-3 dispatched. **T30** emit fix 776e978a (maps owed→batched); slice-3 + g-match dispatched (2 agents); digest regen; state cleanup. **T31** slice-3 LANDED (f4fae410, in batch); g-match COMPLETE-in-worktree (awaiting landing); digest regen; §3c unchanged; maps batch held for g-match.

## Currency snapshot (@ tick 31)

- **Board:** HIGH 0 · gap-counts + recent-sessions PASS (PA regen'd §0 across the emit fix + BUG-1 filing).
- **maps:** watermark `cc765a5a` — STALE/OWED (emit + slice-3 in main) — **batched** for g-match's imminent landing.
- **digest:** current (head `98820d11`, delta-seq S205 [10]).
- **flograph/dock:** §3c PASS (snapshot above).

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting** (narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). Poll git-state.

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (clean on the disjoint surface; real conflict = partition breach to surface). **Re-check delta-log + state.ts oracle AFTER syncing** (T15 lesson). Main may move/push mid-tick.

## Operational notes (for re-hydration)

- **node_modules:** fresh worktree has NONE → symlink main's in (survives FF+rebase): `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` · `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before worktree ops.
- **Untracked new file:** `git add` before commit; tracked mods commit by plain pathspec. `docs/graph/` is gitignored (on-demand projection).
- **Digest cadence:** regen ONLY when a projected source (known-gaps/delta-log/maps/version) moved — not every tick (discard a no-op stamp-bump).
- **perl edits:** use `{}`-style delimiters or escape `/` — slashes in replacement text collide with `s///` (T31 failure); heredoc-rewrite is the reliable fallback.
- **Commit gate:** pre-commit WARNS on non-main; runs ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`. `git rebase` does NOT run the gate.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree + main-clean verify; watermark `.claude/maps/primary.map.md` (`cc765a5a`).
- `docs/changelog.md` — session block. · `@generated` §0 rollup (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1).
- flograph `scripts/flograph.ts` · dock `scripts/dock.ts` (§3c checks) · block-lease registry (DD landed; not built).

## Cross-refs

- `scrml-support/vpa-scrml.md` — deputy contract (+ §3 steady-state + §3c health). · `scrml-support/pa-scrml.md` §"S199 addendum" — PA-side (+ merge-before-push gate + wrap step 7).
- `handOffs/delta-log.md` — live stream. · `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design (+ S204/S205 addenda).
