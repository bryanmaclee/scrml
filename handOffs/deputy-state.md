# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — re-boot off this file
when the transcript grows (cheap + lossless: projection, not deliberation; `scrml-support/vpa-scrml.md`
§"Re-hydration"). **Deputy-owned** (write-surface partition); maintained on the `deputy-maint` branch.

---

## Deputy status

- **State:** LIVE — steady-state. **S207 active** (block-analysis-emit D1-D5 arc COMPLETE + g-each-peritem fix). flogence (renamed S206). First deputy instance, booted S203. On tick 56.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c` (`7,37 * * * *`). CronDelete to cancel.
- **Last-absorbed delta seq:** S206 **[18]** (PA-source; deputy appended S205 F3 [22]). **S207 burst is UNLOGGED past [18]** — D3-D5 + each-ternary landed without delta entries; my landing/agent state is git-inferred this session.
- **`deputy-maint`:** worktree, descends main via the merge-before-push gate. **Tip:** `git rev-parse deputy-maint`.
- **Owed maintenance:** maps batch (g-compound-rbt `36e022bc`, 1 compiler/src file) — BATCHED for the next S207 compiler-src landing or the S207 wrap (1 file right after the T54 batch; tick-54 maps not yet at origin). Else current.

## PA↔vPA protocol — ACK + HEARTBEAT (S205 [19], each tick)

- **heartbeat:** tick **T56** · last-absorbed **[S206 18]** (S207 git-inferred) · deputy-maint tip = this commit (`git rev-parse deputy-maint`).
- **ACK (vpa:) [S205 10]** → §3c health-check each tick (standing). **ACK (vpa:) [S205 19]** → ACK+heartbeat each tick (standing). No new `(vpa:)` since.

## Standing facts (durable)

- **Merge-before-push gate (S205 [15]):** PA asserts `deputy-maint ^main == 0` before any push — working every cycle (caught my strands S205/S206/S207).
- **F1 dilation REALIZED:** F1 ~8.3k; total ~1.5%/1M; net-positive. Digest-thinned cold-boot each session.
- **Maps mechanism (T12) + cadence:** `project-mapper` into the worktree (CWD-pinned, worktree-only brief, NO isolation) + verify `git -C <main> status --porcelain -- .claude/maps/` EMPTY before commit. BATCH compiler-src changes (each ~100-130k sub-agent tokens; PA-window saving ~6-7k → minimize runs); refresh at a settled point. Ran T12/T32/T35/T50/T54 leak-clean. **Regen the digest the tick AFTER a bundled maps refresh** (same-commit bundle leaves the stamp one behind → T51). **maps-owed scope:** `examples/**/*.scrml` + `samples/**/*.scrml` (not bare `**/*.scrml` — catches docs/changes/ fixtures, T37).
- **Partition-breach (T44):** a cross-cutting rename touches deputy files → rebase conflict → reset+rebuild (deputy commits regenerable). **PA may skip §0 regens during fast bursts** → deputy regens gap-counts/recent-sessions (T54).

## Graph/dock health (§3c — per-tick standing step)

- **Snapshot @ tick 54 (PASS):** flograph PASS · currency-sweep **0 (clean)** · 30 unverified · 29 dangling · 0 dup · 0 err. dock --check PASS · coverage 0/628 (0.0%) · 0 orphans. dangling/unverified track new S206-S207 design docs (asserted-not-verified) — **no NEW finding**.
- **route to PA (open nit):** §3 plain `flograph --emit` vs §3c `--check --with-support --with-archive` → graph.json drifts to 190n; deputy emits with matching flags. Align §3 with §3c.

## In-flight dispatches (F3 watch list)

- _(none in flight)_ — g-compound-field-render-by-tag LANDED (36e022bc, non-lexical compound-member render-by-tag; in the deferred maps batch). All S207 worktrees stale (6b-pending).

## Tick log (compressed)

- **T1-T35** boot + F1/GO-LIVE + reboot-gap; S204-S205 (gate ratified, F1 realized, maps batches 1+2, dock built, ACK+heartbeat adopted, F3 [22]).
- **T36-T50** S206 burst: block-lease Scheme-C anchor proven; flogeance→flogence rename (T44 partition-breach reset+rebuild); block-analysis-emit D1+D2 (T50 maps batch 359a1d83→d12fdef7); S206 WRAPPED.
- **T51-T53** S207 start: D3+D4 landed; digest stamp-artifact fix (T51); maps batched.
- **T54** S207 block-analysis-emit arc COMPLETE (D5 + g-each-peritem fix landed) — maps batch REFRESHED d12fdef7→c553dd84 (D3 cli/api/compile + each-ternary tokenizer + D5 span-fix; 3 changes; leak-clean; zero new E-codes; find-count 1013); gap-counts + recent-sessions regen (PA skipped); digest after maps; §3c PASS; no in-flight.
- **T55** digest regen (cleared the T54 bundled-maps stamp artifact); g-compound-rbt fix dispatched (adf911416) → 1 in-flight. Maps current on deputy-maint (c553dd84); origin lags (d12fdef7) until PA integrates tick-54.
- **T56** g-compound-rbt LANDED (36e022bc) — maps batch owed (1 file) → BATCHED for next settling point; digest regen; no in-flight; burst settled.

## Currency snapshot (@ tick 54)

- **Board:** gap-counts + recent-sessions regen'd this tick (PA skipped §0 during the S207 fast-landing).
- **maps:** watermark **`c553dd84`** (REFRESHED T54) — current.
- **digest:** current (head `242a7ab1`, delta-seq S206 18).
- **flograph/dock:** §3c PASS (snapshot above).

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting/deferred-to-F3** (narrow single-writer exception — observation-only). NEVER land. Poll git-state (the delta-log can lag a fast burst — infer from worktrees + main commits).

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (cross-cutting rename → reset+rebuild per T44). **Re-check delta-log + state.ts oracle AFTER syncing** (T15). Main may move/push mid-tick.

## Operational notes (for re-hydration)

- **node_modules:** symlink main's in (survives FF+rebase): `ln -s …/scrml/node_modules ./node_modules` · `…/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before ops.
- **Untracked new file:** `git add` first; `docs/graph/` gitignored. **Digest cadence:** regen only when a projected source moved; the tick after a bundled maps refresh.
- **perl edits:** `{}` delimiters; NO apostrophes in replacement text (single-quote in `perl -e` terminates — T52); escape `/`; heredoc-rewrite is the reliable fallback. **delta-log edits:** python (backticks break the shell).
- **Commit gate:** pre-commit WARNS on non-main; ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree + main-clean verify; watermark (`c553dd84`).
- `docs/changelog.md` · `@generated` §0 (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1). · flograph `scripts/flograph.ts` · dock `scripts/dock.ts` (§3c) · block-lease (building — block-analysis-emit D1-D5 arc complete; D4 = dock artifact-consumer).

## Cross-refs

- `scrml-support/vpa-scrml.md` — contract (§3 + §3c + S205 ACK+heartbeat). · `pa-scrml.md` §"S199 addendum" — PA-side.
- `handOffs/delta-log.md` — live stream. · `docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design.
