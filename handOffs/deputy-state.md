# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — re-boot off this file
when the transcript grows (cheap + lossless: projection, not deliberation; `scrml-support/vpa-scrml.md`
§"Re-hydration"). **Deputy-owned** (write-surface partition); maintained on the `deputy-maint` branch.

---

## Deputy status

- **State:** LIVE — steady-state. **S208 active** — g-pure-module-server-emit HIGH RESOLVED (432c28b6, salvaged from the crashed agent). flogence (renamed S206). On tick 77.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c` (`7,37 * * * *`). CronDelete to cancel.
- **Last-absorbed delta seq:** S207 **[14]** (S208 boot landed g-pure-module but not yet delta-logged; git-inferred).
- **`deputy-maint`:** worktree, descends main via the merge-before-push gate. **Tip:** `git rev-parse deputy-maint`.
- **Owed maintenance:** none. (Maps REFRESHED this tick d931f8be→9afc746e [g-pure-module tree-shake + Fix-B W-SERVER-IMPORT-UNEMITTED]; digest after maps; §3c green.)

## PA↔vPA protocol — ACK + HEARTBEAT (S205 [19], each tick)

- **heartbeat:** tick **T77** · last-absorbed **[S207 14]** · deputy-maint tip = this commit (`git rev-parse deputy-maint`).
- **ACK (vpa:) [S205 10]** → §3c health-check each tick (standing). **ACK (vpa:) [S205 19]** → ACK+heartbeat each tick (standing). No new `(vpa:)` in S207.

## Standing facts (durable)

- **Merge-before-push gate (S205 [15]):** PA asserts `deputy-maint ^main == 0` before any push — working every cycle (integrated my ~5 pending deputy commits at the S207 wrap via ba938c8c).
- **F1 dilation REALIZED:** F1 ~8.3k; total ~1.5%/1M; net-positive. S207 cold-boot was digest-thinned (S207 [1]).
- **S42 WRAP-THINNING (S205 [19]):** wraps reference digest/delta-log/deputy-state.
- **Maps mechanism (T12) + cadence:** `project-mapper` into the worktree (CWD-pinned, worktree-only brief, NO isolation) + verify `git -C <main> status --porcelain -- .claude/maps/` EMPTY before commit. **Refresh rule (firm, T76):** at a WRAP boundary if any compiler-src owed · OR ≥2 changes accumulate · OR an owed change has sat ≥10 ticks; else batch. project-mapper > manual (T76 it caught a new E-code a manual edit would miss). Ran T12/T32/T35/T50/T54/T76 leak-clean. Regen digest the tick AFTER a bundled maps refresh (T51). maps-owed scope: `examples/**/*.scrml`+`samples/**/*.scrml` (T37).
- **Partition-breach (T44):** cross-cutting rename → reset+rebuild. **PA may skip §0/maps during fast bursts** → deputy regens (T54/T76).
- **perl -e:** NO apostrophes in replacement (single-quote terminates — T52); `{}` delimiters or escape `/`; heredoc fallback. **delta-log edits:** python.

## Graph/dock health (§3c — per-tick standing step)

- **Snapshot @ tick 76 (PASS):** flograph PASS · currency-sweep **0 (clean)** · 30 unverified · 29 dangling · 0 dup · 0 err. dock --check PASS · coverage 0/628 (0.0%) · 0 orphans. dangling/unverified track S206-S207 design docs — **no NEW finding**.
- **route to PA (open nit):** §3 plain `flograph --emit` vs §3c `--with-support --with-archive` → graph.json drifts to 190n; deputy emits with matching flags. Align §3 with §3c.

## In-flight dispatches (F3 watch list)

- _(none in flight)_ — g-pure-module-server-emit HIGH LANDED at S208 boot (432c28b6; the crashed agent work salvaged). In the deferred maps batch; worktree stale.

## Tick log (compressed)

- **T1-T50** boot + F1/GO-LIVE + reboot-bridge; S204-S206 (gate ratified, F1 realized, maps batches 1-3, dock built, ACK+heartbeat, flogeance→flogence rename T44, block-analysis-emit D1+D2, S206 WRAP).
- **T51-T56** S207 burst: D3+D4+D5 + each-ternary + g-compound landed; maps batch REFRESHED →c553dd84 (T54); g-compound held.
- **T57-73** PA idle (17 no-op ticks). **T74-75** PA resumed: g-pure-module HIGH fix dispatched.
- **T76** S207 WRAPPED — absorbed [1-14]; PA integrated my ~5 pending commits + skipped maps-6c → deputy refreshed maps c553dd84→d931f8be (g-compound + new E-CELL-AMBIGUOUS-MEMBER-RENDER code); recent-sessions + digest regen; §3c PASS. g-pure-module HIGH fix in-flight-CRASHED → S208 re-dispatches.
- **T77** digest regen (cleared the T76 bundled-maps stamp artifact so S208-boot reads current); main idle post-wrap; g-pure-module still crashed-pending-S208.
- **T81** S208 booted (T78-80 no-ops): g-pure-module HIGH LANDED (432c28b6 salvaged) + my tick-76/77 integrated + pushed (maps reached origin). digest regen (HIGH gap closed); maps batch (g-pure-module) held.
- **T82** Fix B landed (05b88433, W-SERVER-IMPORT-UNEMITTED) — maps batch hit ≥2 (g-pure-module + Fix B) → REFRESHED d931f8be→9afc746e (incl. the new W-code); digest after maps; §3c PASS; no in-flight.

## Currency snapshot (@ tick 76)

- **Board:** gap-counts PASS; recent-sessions regen'd (wrap anchor). g-compound-rbt MED closed; g-pure-module HIGH open (fix in-flight-crashed).
- **maps:** watermark **`9afc746e`** (REFRESHED T82) — current.
- **digest:** current (head `9afc746e`, delta-seq S207 14).
- **flograph/dock:** §3c PASS.

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` entry ONLY when** an agent COMPLETED CLEANLY **and the PA is absent/rebooting/deferred-to-F3** (narrow single-writer exception — observation-only). A CRASHED/partial agent is NOT a completion — do NOT record it as landed (the PA logs the crash). NEVER land. Poll git-state (the delta-log can lag a fast burst).

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (cross-cutting rename → reset+rebuild per T44). **Re-check delta-log + state.ts oracle AFTER syncing** (T15). Main may move/push mid-tick.

## Operational notes (for re-hydration)

- **node_modules:** symlink main's in (survives FF+rebase): `ln -s …/scrml/node_modules ./node_modules` · `…/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before ops.
- **Untracked new file:** `git add` first; `docs/graph/` gitignored. **Digest cadence:** regen only when a projected source moved; the tick after a bundled maps refresh.
- **Commit gate:** pre-commit WARNS on non-main; ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree + main-clean verify; watermark (`d931f8be`).
- `docs/changelog.md` · `@generated` §0 (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1). · flograph `scripts/flograph.ts` · dock `scripts/dock.ts` (§3c) · block-lease (building — block-analysis-emit v1 arc complete + dock-consumer).

## Cross-refs

- `scrml-support/vpa-scrml.md` — contract (§3 + §3c + S205 ACK+heartbeat). · `pa-scrml.md` §"S199 addendum" — PA-side.
- `handOffs/delta-log.md` — live stream. · `docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design.
