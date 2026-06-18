# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — steady-state (S204). First deputy instance, booted S203. On tick 10.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c`, `7,37 * * * *`. CronDelete `39fed15c` to cancel.
- **Last-absorbed delta seq:** S204 **[5]** (`scrml/handOffs/delta-log.md` — absorbed [S199 1] … [S204 5]).
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint`. Base rebased onto main `5295a61c` (tick 10). **Tip:** `git rev-parse deputy-maint` (tick-10 commits: digest + this).
- **Owed maintenance:** **MAPS REFRESH owed** (deferred — see below). Digest/recent-sessions/gap-counts current.

## ⚠ OWED: maps refresh (DEFERRED) + a mechanism gap for the PA

The #3 landing `a6405053` touched `compiler/src/ast-builder.js` (the `E-CONTROL-FLOW-IN-MARKUP` detector) — the FIRST compiler-source change since the maps watermark `60d547e1`. Maps are genuinely stale (no longer the benign docs-only WARN). **Deferred this tick** because the deputy cannot SAFELY refresh them right now:
- `project-mapper` is NON-isolated → it stages into the index of wherever it runs; if it runs in/near the MAIN checkout it risks the S119 shared-index sweep + corrupting the LIVE PA's working tree (the PA holds main).
- The deputy must never touch main → a first-time risky dispatch isn't worth it; the maps WARN is ungated and the PA's wrap-6c is the proven fallback.
- The deputy will NOT fake-bump the watermark on a partial manual edit (soft-overclaim).

**MECHANISM GAP → route to the PA (deliberation-shaped, NOT a deputy call):** the contract says "deputy owns `.claude/maps/*` via project-mapper incremental" but doesn't specify HOW the deputy runs project-mapper safely from its worktree. **Proposed mechanism for the PA to bless:** dispatch project-mapper with the Bash CWD set to `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint` + a strict worktree-only-path brief + a post-dispatch `git -C <main> status` clean-verify (the same path-discipline the PA uses for its own agent dispatches; the S100 hook Write/Edit-protects map writes, but has a Bash blind-spot). Until blessed: the PA does maps at wrap-6c.

## PA-side learning from S204 [1] (route to PA)

[1] (cold S204 boot) reports the fresh PA's step-0 digest read **STALE → authoritative fallback** — because the S203 wrap was **PUSHED before deputy-maint was merged** (tick 7 flagged this). So origin carried the old digest; the deputy's current one didn't reach the fresh PA in time → thin-start benefit LOST for that boot. **Suggest the PA-side contract enforce "merge deputy-maint BEFORE pushing the wrap"** so the current digest reaches origin. (The freshness guard worked — no harm, just lost dilation.)

## In-flight dispatches (F3 watch list)

- _(empty)_ — `af88c53a` landed (#3, `a6405053`, worktree cleaned); `abcf64f7` closed tick 5.

## Tick log (compressed)

T1 boot [1-5]; T2 [6-7] F1 LIVE; T3 [8-9] source-freshness+GO-LIVE; T4 [10] rebase; T5 [11-13]; **T6-T7 reboot-gap** (wrap #3-in-flight → bridged: digest current at wrap HEAD, watched af88c53a); **T8 gap-CLOSED** (fresh PA S204 merged deputy-maint + re-attached #3); **T9** absorbed S204 [1-3] (#3 LANDED a6405053); digest regen; maps owed→deferred. **T10** [4-5] flograph corpus-annotation slices (dog-food, docs/tooling); digest regen; maps STILL owed/deferred (no PA mechanism-ruling yet).

## Currency snapshot (@ tick 9)

- **Board:** HIGH 0 · MED 12 · LOW 23 · Nominal 8 (g-raw-interp resolved via #3; PA regen'd §0).
- **maps:** watermark `60d547e1` — **STALE / OWED** (ast-builder.js #3 landing). Deferred (see above).
- **digest:** current (head `5e326e3e`, delta-seq 5).
- **recent-sessions / gap-counts:** PASS.
- **flograph:** `--mmd`/`--filter`/`--focus` [S203 14]; round-trip intact.

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status` for branch tip + dirty state; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` delta-log entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting** (the narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). Poll git-state (no reliable task-notification — it goes to the dispatching PA).

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (clean on the disjoint surface; a real conflict = partition breach to surface). Main may move/push mid-tick — absorb up to the HEAD seen at tick start.

## Operational notes (for re-hydration)

- **node_modules:** fresh worktree has NONE → symlink main's in (survives FF+rebase): `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` · `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before worktree ops.
- **Untracked new file:** `git add` before commit; tracked modifications commit by plain pathspec.
- **Commit gate:** pre-commit WARNS on non-main; runs ~17k subset (~75-120s); deputy commits derived-only → always passes; never `--no-verify`. `git rebase` does NOT run the gate.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` incremental; watermark `.claude/maps/primary.map.md` (`60d547e1`). **[mechanism unresolved — see OWED above]**
- `docs/changelog.md` — session block. · `@generated` §0 rollup (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1; per tick when a projected source moved).
- flograph — `scripts/flograph.ts`. · block-lease registry — (not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — deputy contract. · `scrml-support/pa-scrml.md` §"S199 addendum" — PA-side contract.
- `handOffs/delta-log.md` — the live PA-state stream. · `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design.
