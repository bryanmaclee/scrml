# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — self-driving. First deputy instance, booted S203 (2026-06-17). On tick 3. All 3 functions LIVE (F1 digest · F2 maintenance · F3 reboot-bridge/agent-monitoring).
- **Self-poke loop:** `/loop 30m` running — cron job `39fed15c`, `7,37 * * * *` (every 30 min, off the :00/:30 marks), session-only, auto-expires 7d. Cancel with CronDelete `39fed15c`. User may also poke directly between ticks.
- **Last-absorbed delta seq:** S203 **[9]** (`scrml/handOffs/delta-log.md` — absorbed [S199 1] … [S203 9]).
- **`deputy-maint` branch:** worktree at `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint` (scrmlMaster sibling, OUTSIDE `.claude/worktrees/` so wrap-6b never collides). Base FF'd to main `ffb44a7f` on tick 3. **Tip:** `git rev-parse deputy-maint` (tick-3 commits: digest regen `21d3f325` + this deputy-state update).
- **Owed maintenance:** none.

## Tick log

**Tick 1 (boot, S203):** absorbed [1]…[5]; regen `@generated:recent-sessions` (caught wrap-s202 post-wrap one-behind drift) → `e6e47736`; init deputy-state → `68ce0ee1`. PA FF-merged.

**Tick 2 (S203):** absorbed [6] (first-run validated, contract refined) + [7] (F1 digest LIVE). FF'd to `ab8b5758`; generated first canonical `digest.md` → `e85d5f0d`. PA merged.

**Tick 3 (S203):** absorbed [8] (digest-freshness flaw fixed → SOURCE-based: only a projected-source commit — known-gaps/delta-log/maps/version — stales the digest; the digest's own commit does not) + [9] (FULL GO-LIVE: F3 reboot-bridge LIVE, deputy self-drives via `/loop`, new "Operating the live system" run-loop). FF'd `1d187ef9`→`ffb44a7f`. Oracle flagged digest STALE (delta-log 7→9) → regen → `21d3f325` (digest: current @ ffb44a7f / delta-seq 9). **Agent monitoring (F3):** no agent worktrees, no `disp`-without-`land` in the log → nothing in flight, no `(deputy) state` entries appended.

## Currency snapshot (@ tick 3)

- **Board:** HIGH 0 · MED 14 · LOW 21 · Nominal 8.
- **maps:** watermark `60d547e1` — N commits behind HEAD but ALL docs/tooling-only (no `compiler/src`·`stdlib`·`.scrml` since the watermark), so maps are CURRENT for compiler-source. WARN-only; PA wrap-6c sweeps the `scripts/state.ts` tooling at close. NOT owed mid-session.
- **digest:** current (head `ffb44a7f`, delta-seq 9). Regen per tick when a projected source moved.
- **recent-sessions / gap-counts:** PASS.
- **flograph:** current (no gap-token changes since the S202 build).

## Function 3 — agent monitoring (LIVE)

Each tick: `git worktree list` for agent worktrees + scan the delta-log for `disp` entries without a matching `land`. For any PA-dispatched agent that COMPLETED while the PA is absent/rebooting, append a `(deputy) state` entry to the delta-log (the ONE narrow exception to single-writer — observation-only) so the fresh PA re-attaches. NEVER land the agent's work (substantive → PA-owned S67 file-delta). Read the agent's `progress.md` + branch in the shared worktree to detect completion.

## Operational notes (for re-hydration)

- **node_modules:** a fresh worktree has NONE → the pre-commit gate can't resolve deps. Symlink main's in on (re)boot (survives FF):
  `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules`
  `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN after each command. Always `cd /home/bryan-maclee/scrmlMaster/scrml-deputy-maint` (or `git -C`) before worktree ops.
- **Untracked new file:** `git commit -- <path>` fails on an untracked file — `git add <path>` first (stage explicitly so the node_modules symlinks never get swept). Tracked-file modifications commit by plain pathspec.
- **Commit gate:** pre-commit only WARNS on non-main branches; runs the ~17k unit+integration+conformance subset (~80s). Deputy commits are derived-only → always passes. Never `--no-verify`. (Full-gate-on-derived-commits friction raised tick 1; PA-acknowledged as a deferred path-scoped gate-skip — keep running the full gate until built.)
- **Sync:** each tick `git merge --ff-only main` to absorb PA merges + new commits before doing work; report if it is NOT a clean FF (would mean a surface-partition breach to surface to the PA).

## Maintenance seams (Function 2 — the deputy's live surface)

- `.claude/maps/*` — `project-mapper` incremental on the session's changed source; watermark in `.claude/maps/primary.map.md` (`60d547e1`).
- `docs/changelog.md` — append/extend the current session block.
- `@generated` §0 rollup in `docs/known-gaps.md` + `master-list.md` §0.6 `@generated:recent-sessions` — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (Function 1; regen per tick when a projected source moved; deputy-owned).
- flograph + dock projection — `scripts/flograph.ts`.
- block-lease registry — (the dock's parallelism follow-on; not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — the deputy contract (boot, surface partition, commit protocol, re-hydration, F3, "Operating the live system" run-loop).
- `scrml-support/pa-scrml.md` §"S199 addendum — vPA deputy (PA side)" — the PA-side contract (session-start digest step 0, wrap-time final-regen, F3 re-attach).
- `handOffs/delta-log.md` — the live PA-state stream the deputy absorbs.
- `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — the design.
