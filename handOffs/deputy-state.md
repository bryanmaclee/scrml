# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — re-boot off this file
when the transcript grows (cheap + lossless: projection, not deliberation; `scrml-support/vpa-scrml.md`
§"Re-hydration"). **Deputy-owned** (write-surface partition); maintained on the `deputy-maint` branch.

---

## Deputy status

- **State:** LIVE — steady-state. S206 active; flogeance renamed → flogence (S206); block-lease primitive building. First deputy instance, booted S203. On tick 44.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c` (`7,37 * * * *`). CronDelete to cancel.
- **Last-absorbed delta seq:** S206 **[12]** (PA-source; deputy appended S205 F3 [22]).
- **`deputy-maint`:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint`, descends main (PA integrates via the merge-before-push gate). **Tip:** `git rev-parse deputy-maint`.
- **Owed maintenance:** none. (digest current — PA wrap-regen 74d7d0e2; recent-sessions regen'd this tick; maps current.)

## PA↔vPA protocol — ACK + HEARTBEAT (S205 [19] ratification — record each tick)

- **heartbeat:** tick **T44** · last-absorbed **[S206 12]** · deputy-maint tip = this commit (`git rev-parse deputy-maint`) · deputy-maint tip = this commit (`git rev-parse deputy-maint`).
- **ACK (vpa:) [S205 10]** → re-read §3c; run flograph/dock --check + record health each tick (standing since T27).
- **ACK (vpa:) [S205 19]** → adopted the ACK+heartbeat block (this tick T34); recording each tick going forward.
- **ACK (F3 defer, wrap [21]) → DELIVERED:** all 3 deferred agents LANDED in S206 (g-colon-shorthand e2516298 · g-engine-autodecl 105f1ee4 · slice-2 e1c20e3a). The reboot-bridge worked end-to-end; my delta-log [22] confirmed the block-splitter the S206 PA then landed.

## Standing facts (durable)

- **Merge-before-push gate (RATIFIED S205 [15]):** PA asserts `deputy-maint ^main == 0` before any push (pa.md S199 + wrap step 7). Working — my T32 maps + T33 integrated at the S205 wrap.
- **S42 WRAP-THINNING (ratified S205 [19]):** the wrap now REFERENCES digest/delta-log/deputy-state for mechanical content (deputy-enabled). The S205 wrap was the first thinned one.
- **F1 dilation REALIZED (S205 [3]/[17]):** F1 ~8.3k (was 0 in S204); total ~14-15k/cycle ≈ 1.5%/1M. Net-positive.
- **Maps mechanism (T12, user no-consent) + cadence:** `project-mapper` into the worktree (CWD-pinned, worktree-only brief, NO isolation) + verify `git -C <main> status --porcelain -- .claude/maps/` EMPTY before commit. BATCH compiler-src/.scrml changes into one run (each ~110-130k sub-agent tokens; PA-window saving ~6-7k → minimize invocations). T12 + T32 ran clean.

## Graph/dock health (§3c — per-tick standing step)

- **Snapshot @ tick 44 (PASS):** flograph PASS · currency-sweep **0 (clean — rename consistent)** · 24 unverified · 25 dangling · 0 dup · 0 err. dock PASS · cov 0/628. dangling/unverified grew (new S206 DDs) — no NEW finding.
- **route to PA (open nit):** §3 plain `flograph --emit` vs §3c `--check --with-support --with-archive` → graph.json drifts to 190n default; deputy emits with matching flags. Align §3 with §3c.

## In-flight dispatches (F3 watch list)

- _(none in flight)_ — the 5 S205 agents ALL LANDED: slice-3 (f4fae410) · g-match (9a7bc3a5) · g-colon-shorthand (e2516298) · g-engine-autodecl (105f1ee4) · slice-2 (e1c20e3a). Worktrees retained — 6b-cleanup PA-pending.

## Tick log (compressed)

- **T1-T8** boot + F1/GO-LIVE + reboot-gap (#3 bridged → re-attached+LANDED, zero loss).
- **T9-T14** S204 [1-6]; maps REFRESHED 60d547e1→cc765a5a; merge-before-push misses flagged → PA caught up.
- **T15** S205 [1-6] gate RATIFIED + F1 realized + dock built. **T16-25** PA idle (10 no-ops).
- **T26** S205 [7-9] (deref + flograph --with-archive + harness capstone). **T27** §3c wired. **T28** no-op. **T29-31** trucking burst (slice-3+g-match dispatched→LANDED; maps batched). **T32** maps REFRESHED cc765a5a→492b4bb9 (3-change batch). **T33** 5-agent watch; maps batch-2 held.
- **T34** S205 WRAPPED — absorbed [11-21]; adopted ACK+heartbeat ([19]); F3-recorded block-splitter [22] (resolved [20] CHECK-status); recent-sessions regen (wrap anchor); §3c PASS. 3 agents deferred → next session lands.
- **T40-43** absorbed S206 [1-12] (3 deferred agents LANDED; gate caught tick-34 strand again; block-lease anchor proven; banked design candidates). **T44** flogeance→flogence rename (f69219d3) CONFLICTED my rebase (global text-rename touches deputy-owned digest = partition-breach edge case) → reset deputy-maint to renamed main + rebuilt maintenance (digest+recent-sessions regen, deputy-state). PARTITION-BREACH NOTE: a cross-cutting rename breaks the disjoint-surface assumption; deputy resolves by reset+rebuild (its commits are regenerable).
- **T35** all 3 S205-deferred agents LANDED in S206 (bridge delivered); maps REFRESHED 492b4bb9→359a1d83 (batch-2, leak-clean); digest regen; §3c PASS.
- **T36** main +1b15f701 dock block-scope (--units/--diff-scope, block-lease groundwork; tooling, no compiler-src → maps current). digest regen (my T35 maps commit staled it); §3c PASS.
- **T37** main +10255c94 (block-lease Scheme-C anchoring proof — rename/move/split fixtures in docs/changes/, NOT corpus). maps-owed FALSE-signal (pathspec `**/*.scrml` caught docs/changes/ fixtures) → maps stay current at 359a1d83. no-owed; heartbeat only.

## Currency snapshot (@ tick 34)

- **Board:** HIGH 0 · MED 10 (S205 closed 3 MED) · gap-counts + recent-sessions PASS.
- **maps:** watermark **`359a1d83`** (REFRESHED T35, batch-2: g-colon-shorthand + g-engine-autodecl + slice-2; leak-verified clean; zero new E-codes; new gap g-compound-field-render-by-tag-unexpanded filed).
- **digest:** current (head `74d7d0e2`, PA wrap-regen).
- **flograph/dock:** §3c PASS (snapshot above).

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting/deferred-to-F3** (narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). Poll git-state.

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main`. **Re-check delta-log + state.ts oracle AFTER syncing** (T15 lesson). Main may move/push mid-tick.

## Operational notes (for re-hydration)

- **node_modules:** symlink main's in (survives FF+rebase): `ln -s …/scrml/node_modules ./node_modules` · `…/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before ops.
- **Untracked new file:** `git add` first; `docs/graph/` gitignored. **Digest cadence:** regen only when a projected source moved. When refreshing maps, regen the digest AFTER the maps commit (the maps watermark change otherwise stales the digest one tick later — T36).
- **perl edits:** use `{}` delimiters or escape `/`; heredoc-rewrite is the reliable fallback. **delta-log edits:** use python (backticks break the shell). **maps-owed check:** scope to `examples/**/*.scrml` + `samples/**/*.scrml` (the mapped corpus), NOT bare `**/*.scrml` — the latter catches docs/changes/ scratch fixtures = false maps-owed (T37).
- **Commit gate:** pre-commit WARNS on non-main; ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree + main-clean verify; watermark (`492b4bb9`).
- `docs/changelog.md` · `@generated` §0 (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1). · flograph `scripts/flograph.ts` · dock `scripts/dock.ts` (§3c) · block-lease (DD landed; not built).

## Cross-refs

- `scrml-support/vpa-scrml.md` — contract (§3 + §3c + §steady-state S205 ACK+heartbeat). · `pa-scrml.md` §"S199 addendum" — PA-side (+ gate, ACK/heartbeat read at boot+integration).
- `handOffs/delta-log.md` — live stream. · `docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design. · `pa-vpa-communication-protocol-2026-06-18.md` — the ACK/heartbeat DD.
