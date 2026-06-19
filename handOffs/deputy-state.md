# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — re-boot off this file
when the transcript grows (cheap + lossless: projection, not deliberation; `scrml-support/vpa-scrml.md`
§"Re-hydration"). **Deputy-owned** (write-surface partition); maintained on the `deputy-maint` branch.

---

## Deputy status

- **State:** LIVE — steady-state. **S206 WRAPPED** (6512b592); **S207 started** (D3 landed fee6fc98). First deputy instance, booted S203. On tick 53.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c` (`7,37 * * * *`). CronDelete to cancel.
- **Last-absorbed delta seq:** S206 **[18]** (PA-source; deputy appended S205 F3 entry [22]).
- **`deputy-maint`:** worktree, descends main via the merge-before-push gate. **Tip:** `git rev-parse deputy-maint`.
- **Owed maintenance:** maps batch (D3 `fee6fc98` emit-integration; the in-flight g-each-peritem ternary fix may add) — BATCHED for the S207 settling point. D4 `447f5244` is dock.ts tooling (not mapped). Else current.

## PA↔vPA protocol — ACK + HEARTBEAT (S205 [19], each tick)

- **heartbeat:** tick **T53** · last-absorbed **[S206 18]** (S207 burst UNLOGGED past [18] — agent/landing state git-inferred) · deputy-maint tip = this commit (`git rev-parse deputy-maint`).
- **ACK (vpa:) [S205 10]** → §3c health-check run + recorded each tick (standing).
- **ACK (vpa:) [S205 19]** → ACK+heartbeat block recorded each tick (standing).
- No new `(vpa:)` directives since [S205 19]; the S206 burst ([1]-[18]) carried none.

## Standing facts (durable)

- **Merge-before-push gate (S205 [15]):** PA asserts `deputy-maint ^main == 0` before any push. Working — caught my strands at S205 + S206 [5] pushes; my maintenance reaches origin each cycle.
- **F1 dilation REALIZED (S205 [3]/[17]):** F1 ~8.3k; total ~1.5%/1M. Net-positive. S206 cold-boot was digest-thinned again ([S206 1]).
- **S42 WRAP-THINNING (S205 [19]):** wraps reference digest/delta-log/deputy-state (deputy-enabled).
- **Maps mechanism (T12) + cadence:** `project-mapper` into the worktree (CWD-pinned, worktree-only brief, NO isolation) + verify `git -C <main> status --porcelain -- .claude/maps/` EMPTY before commit. BATCH compiler-src/.scrml changes into one run (each ~100-130k sub-agent tokens; PA-window saving ~6-7k → minimize invocations). Ran T12/T32/T35/T50, all leak-clean. **Regen the digest the tick AFTER a bundled maps refresh** (a same-commit maps+digest bundle leaves the stamp one behind its own commit → next-tick STALE artifact; T36/T51). **maps-owed check scope:** `examples/**/*.scrml` + `samples/**/*.scrml` (NOT bare `**/*.scrml` — catches docs/changes/ fixtures = false signal, T37).
- **Partition-breach edge case (T44):** a cross-cutting text-rename (flogeance→flogence) touches deputy-owned files → rebase conflict. Resolve by reset deputy-maint to renamed main + rebuild (deputy commits are regenerable; no info loss).

## Graph/dock health (§3c — per-tick standing step)

- **Snapshot @ tick 50 (PASS):** flograph PASS · currency-sweep **0 (clean)** · 30 unverified · 29 dangling · 0 dup · 0 err. dock --check PASS · coverage 0/628 (0.0%) · 0 orphans. dangling/unverified grew with the S206 design docs (satellite-architecture, vPA-comm-surface DD, etc.) — asserted-not-verified, **no NEW finding**.
- **route to PA (open nit):** §3 plain `flograph --emit` vs §3c `--check --with-support --with-archive` → graph.json drifts to 190n default; deputy emits with matching flags. Align §3 with §3c.

## In-flight dispatches (F3 watch list)

- **In-flight (git-inferred; S207 delta-log stale at [18]):** g-each-peritem-attr-ternary-quoted-arms fix `adf67ae2a6a813d93` (c1dfcd61 test) — the slice-3 BUG-1. block-analysis-emit D1-D4 arc COMPLETE (D3 fee6fc98 compiler/src + D4 447f5244 dock.ts consumer); their worktrees stale (6b-pending).

## Tick log (compressed)

- **T1-T8** boot + F1/GO-LIVE + reboot-gap (#3 bridged → re-attached+LANDED, zero loss).
- **T9-T15** S204 [1-6] + maps REFRESHED 60d547e1→cc765a5a; S205 [1-6] gate RATIFIED + F1 realized + dock built.
- **T16-T27** PA-idle stretch; S205 [7-10] (deref + harness capstone + §3c guardrail wired).
- **T28-T35** trucking + match burst; maps batches 1+2 (→492b4bb9→359a1d83); S205 wrap absorbed; ACK+heartbeat adopted; F3 [22] block-splitter confirm; all 5 S205 agents landed in S206.
- **T36-T49** S206 burst: dock block-scope + block-lease Scheme-C anchor proven; flogeance→flogence rename (T44 partition-breach, reset+rebuild); block-analysis-emit D1+D2 dispatched.
- **T50** S206 WRAPPED — maps batch REFRESHED 359a1d83→d12fdef7 (D1 footprint + D2 builder/serializer, 2 new modules + 2 tests; leak-clean; zero new E-codes); digest + recent-sessions regen; §3c PASS; all worktrees cleaned.
- **T51** PA integrated tick-50; digest regen (cleared the bundled-maps stamp artifact); D3 block-analysis-integration dispatched → 1 in-flight F3-watched.
- **T52** D3 LANDED (fee6fc98, s207 — block-analysis-emit complete); maps batch owed (D3, 1 file) → BATCHED for next S207 compiler-src; digest current; no in-flight.
- **T53** D4 LANDED (447f5244, dock.ts artifact-consumer — block-analysis-emit arc tooling COMPLETE); g-each-peritem ternary fix in-flight (BUG-1); maps batch (D3) held; digest current; delta-log stale at [18].

## Currency snapshot (@ tick 50)

- **Board:** gap-counts + recent-sessions PASS (PA regen'd §0 across S206).
- **maps:** watermark **`d12fdef7`** (REFRESHED T50) — current.
- **digest:** current (head `9a838b8f`, delta-seq S206 18).
- **flograph/dock:** §3c PASS (snapshot above).

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting/deferred-to-F3** (narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). Poll git-state.

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (clean on the disjoint surface; a cross-cutting rename is the exception → reset+rebuild per T44). **Re-check delta-log + state.ts oracle AFTER syncing** (T15). Main may move/push mid-tick.

## Operational notes (for re-hydration)

- **node_modules:** symlink main's in (survives FF+rebase): `ln -s …/scrml/node_modules ./node_modules` · `…/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before ops.
- **Untracked new file:** `git add` first; `docs/graph/` gitignored. **Digest cadence:** regen only when a projected source (known-gaps/delta-log/maps/version) moved; AFTER a maps commit.
- **perl edits:** `{}` delimiters or escape `/`; heredoc-rewrite is the reliable fallback. **delta-log edits:** python (backticks break the shell). **perl -e single-quote:** apostrophes in replacement text (e.g. possessives) terminate the quote → avoid them or use a heredoc (T52).
- **Commit gate:** pre-commit WARNS on non-main; ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree + main-clean verify; watermark (`d12fdef7`).
- `docs/changelog.md` · `@generated` §0 (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1). · flograph `scripts/flograph.ts` · dock `scripts/dock.ts` (§3c) · block-lease (building — block-analysis-emit v1 landed).

## Cross-refs

- `scrml-support/vpa-scrml.md` — contract (§3 + §3c + S205 ACK+heartbeat). · `pa-scrml.md` §"S199 addendum" — PA-side.
- `handOffs/delta-log.md` — live stream. · `docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design.
