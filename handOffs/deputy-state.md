# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — self-driving. First deputy instance, booted S203 (2026-06-17). On tick 5. All 3 functions LIVE (F1 digest · F2 maintenance · F3 reboot-bridge/agent-monitoring).
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c`, `7,37 * * * *` (every 30 min). Session-only, auto-expires 7d. CronDelete `39fed15c` to cancel. User may also poke directly.
- **Last-absorbed delta seq:** S203 **[13]** (`scrml/handOffs/delta-log.md` — absorbed [S199 1] … [S203 13]).
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint` (scrmlMaster sibling, OUTSIDE `.claude/worktrees/`). Base FF'd to main `c718d4c2` (tick 5; PA had merged deputy-maint at `96732a29`). **Tip:** `git rev-parse deputy-maint` (tick-5 commits: digest regen `20effa2a` + this).
- **Owed maintenance:** none.

## In-flight dispatches (F3 watch list)

- **`af88c53a8985b37fb`** — bare-control-flow-in-markup diagnostic (scrml-js-codegen-engineer, isolation:worktree, bg). Dispatched delta-log **[13]** (#3 ruling = (a) reject+recover). **Status @ tick 5:** worktree `.claude/worktrees/agent-af88c53a8985b37fb` present (locked) at base `96732a29`, NO commits ahead, no `progress.md` — freshly dispatched, in-flight, no completion. **PA ALIVE** → PA owns the landing; no deputy delta-log entry. Watching.
- ~~`abcf64f7198fe9cf3`~~ (e2e #3 raw-interp) — **CLOSED** at tick 5: completed as STOP-and-surfaced (delta-log [11]; good catch, zero work lost, worktree auto-cleaned; reframed the gap → design ruling, no code landed). PA recorded the outcome; dropped from watch.

## Tick log

**Tick 1 (boot):** absorbed [1]…[5]; regen recent-sessions (caught wrap-s202 drift); init deputy-state. PA FF-merged.
**Tick 2:** absorbed [6]+[7] (F1 LIVE); first canonical digest. PA merged.
**Tick 3:** absorbed [8] (source-based freshness) + [9] (FULL GO-LIVE: F3 + self-drive); digest regen; F3 section.
**Tick 4:** absorbed [10] (e2e backlog; #3 agent abcf64f7 dispatched). deputy-maint diverged → REBASED onto main [10]; digest regen; F3 watch list + sync rule added.
**Tick 5:** absorbed [11] (#3 abcf64f7 stop-surfaced, gap reframed) + [12] (e2e triage land, board MED 14→12 / LOW 21→23) + [13] (#3 re-dispatched (a) reject+recover, agent af88c53a). PA had merged deputy-maint (`96732a29`) → clean FF `a3fd3368`→`c718d4c2`. Digest regen → `20effa2a`. Watch list: abcf64f7 closed, af88c53a added.

## Currency snapshot (@ tick 5)

- **Board:** HIGH 0 · MED 12 · LOW 23 · Nominal 8.
- **maps:** watermark `60d547e1` — N commits behind HEAD but ALL docs/tooling/test-fixture (no `compiler/src`·`stdlib`·`.scrml` since the watermark), so CURRENT for compiler-source. WARN-only; PA wrap-6c sweeps it. **WATCH:** the in-flight af88c53a [13] WILL touch `compiler/src` (new §34 diagnostic) — once it lands, a maps refresh becomes genuinely owed; flag at that tick.
- **digest:** current (head `c718d4c2`, delta-seq 13).
- **recent-sessions / gap-counts:** PASS (PA regen'd §0 inline in its triage commit; FF picked it up).
- **flograph:** current (no gap-token changes the deputy owns regen for since S202).

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git worktree list` + `git branch -v` for agent branch tips; scan the delta-log for `disp` without matching `land`/`find`-close; read each in-flight agent's `progress.md` + branch tip (commits ahead of its base = work in progress). Maintain the watch list above. **Append a `(deputy) state` delta-log entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting** (the one narrow single-writer exception — observation-only) so the fresh PA re-attaches. NEVER land the work (substantive → PA-owned S67 file-delta). While the PA is alive, just track here.

## Sync rule (each tick)

`git merge --ff-only main`; **if NOT a clean FF** (deputy-maint diverged because the PA committed without integrating the deputy first), `git rebase main` — clean by construction on the disjoint surface; surface to the PA only if a rebase hits a real conflict (= a surface-partition breach). Rebasing rewrites not-yet-merged deputy SHAs — harmless pre-merge.

## Operational notes (for re-hydration)

- **node_modules:** fresh worktree has NONE → pre-commit gate can't resolve deps. Symlink main's in on (re)boot (survives FF + rebase):
  `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` · `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN after each command — always `cd` the worktree (or `git -C`) before worktree ops.
- **Untracked new file:** `git commit -- <path>` fails on untracked — `git add` first. Tracked modifications commit by plain pathspec.
- **Commit gate:** pre-commit only WARNS on non-main branches; runs ~17k subset (~80s); deputy commits derived-only → always passes; never `--no-verify`. `git rebase` does NOT run the gate (only `git commit`). (Full-gate-on-derived friction raised tick 1; PA deferred a path-scoped gate-skip — run full gate until built.)

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` incremental on changed source; watermark `.claude/maps/primary.map.md` (`60d547e1`).
- `docs/changelog.md` — append/extend the session block.
- `@generated` §0 rollup in `docs/known-gaps.md` + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1; regen per tick when a projected source moved).
- flograph + dock — `scripts/flograph.ts`. · block-lease registry — (not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — deputy contract. · `scrml-support/pa-scrml.md` §"S199 addendum" — PA-side contract.
- `handOffs/delta-log.md` — the live PA-state stream. · `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — the design.
