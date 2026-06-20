# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — a fresh deputy re-boots
off THIS file + the delta-log + the maintenance read-list (cheap + lossless: the deputy does projection,
not deliberation, so nothing irreplaceable lives in its transcript; `scrml-support/vpa-scrml.md`
§"Re-hydration"). **Deputy-owned** (write-surface partition); maintained on the `deputy-maint` branch.

> **RE-HYDRATED at tick 96 (S209) — fresh deputy after the tick-95 death.** The prior deputy DIED at tick 95
> (delta-log [18]: the session-only cron `e5b76890` died with the crashed PA instance; the PA reset
> `deputy-maint`→main + PA-drove the digest regen). This instance booted via "read vpa.md and boot", confirmed
> the delta-log WINS over the stale tick-91 anchor (absorbed [10]–[18]), FF'd `deputy-maint` onto current main,
> ran a boot tick (oracle + §3c + F3), and re-armed its own `/loop 30m` (CronList empty at boot, as predicted —
> NEW cron `50e233bd`). A future fresh deputy repeats this off the resume point below.

---

## Deputy status (RESUME POINT)

- **State:** LIVE — steady-state, RE-HYDRATED instance. **S209 active.** **sPA ss5 + ss6 BOTH RE-INTEGRATED** (PA burst this tick: `f2ed05ba` ss5 channel-codegen + `6170ee8c` ss6 no-execute + `14f32ba1` gap-reconcile [25-26] + `85d9e958` deputy-merge). ss5 landed 2 (channel v0.3 fixtures + g-export-channel-body-text); ss6 = no-execute (all 7 parked, "list stalls→stand down" correct-not-failure). PA integrated my T101/T102 maintenance. main `85d9e958`. flogence (renamed S206). On tick **105**.
- **Self-poke loop:** `/loop 30m` → **cron `50e233bd` (`9,39 * * * *`), session-only, armed T96.** (OLD crons `39fed15c`→`e5b76890` both died with their instances — CronList empty at boot, no CronDelete needed. A future re-hydration: CronDelete `50e233bd` if still alive, then re-arm its own.)
- **Last-absorbed delta seq:** S209 **[26]** (T105 absorbed [25] sPA ss5 channel-codegen RE-INTEGRATED [2 landed: channel v0.3 fixtures + g-export-channel-body-text Option-2b TAB-parse] · [26] sPA ss6 NO-EXECUTE [0 code, all 7 parked, the spa-scrml.md "whole list stalls→stand down" case, CORRECT-not-failure]). PA fast-burst: these landed across 6170ee8c/f2ed05ba/14f32ba1 — git-inferred + delta-logged [25-26]. Prior: boot [10]-[18]; [19]-[24]. All informational — NO maintenance-shaped `(vpa:)`.
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint` (scrmlMaster sibling, OUTSIDE `.claude/worktrees/`). **Tip:** `git rev-parse deputy-maint` (FF'd to `c734ec35` at boot; +1 with the deputy-state update this tick). FF onto main each tick.
- **node_modules:** the worktree has the symlinks (verified at boot; re-create if missing): `ln -s …/scrml/node_modules ./node_modules` · `…/scrml/compiler/node_modules ./compiler/node_modules`.
- **Owed maintenance: NONE.** **MAPS owed-batching CLEARED T113** via a VERIFIED watermark bump (`b67cd6e6`→`85d9e958`), NOT a project-mapper run. The ≥10-tick trigger fired (ss5's `ast-builder.js` owed since T105, ~10 ticks). VERIFIED the lone owed src change is map-IRRELEVANT before bumping: ast-builder.js diff = +25 lines ENTIRELY inside the existing `liftBareDeclarations` fn (export-channel structural lift) — no new module/fn-signature/dependency-edge/E-W-code; test find-count 1020 UNCHANGED (ss5 = case-level unskips, 0 new .test.js files). So all 6 maps are structurally accurate at `85d9e958`; only the currency stamp lagged. Saved ~130k vs a re-survey of a verified-trivial change with zero map-consumers (PA idle). Maps watermark now `85d9e958` (= main HEAD). Two project-mapper runs (1st `aec7b424` context-limited after structure/error/test; 2nd `a14b8d6d` finished primary/deps/domain in 126k tok/5min). All 6 maps current: structure(+ss2 engine-statechild), error(+W-/E-ENGINE codes), test(find-count 1016→1020), primary(watermark bumped), dependencies(engine-statechild-grammar edges: type-system.ts:81 + emit-variant-guard import it; module has zero imports — placed at compiler/src/ not codegen/ to break the cycle), domain(W-ENGINE-SERVER-DEFERRED row, ZERO new domain concepts — ss2 is codegen-internal). non-compliance: no drift. **Path-discipline VERIFIED both runs — main `.claude/maps/` clean, no leak.** **DIGEST current** @ `b67cd6e6` seq 24. §0 + recent-sessions PASS; §3c green. state.ts now reports maps ~current (only deputy's own derived commits behind — benign).
- **route to PA (informational, from the maps run):** the 2nd project-mapper flagged a SSOT-dedup follow-on — `engine-statechild-grammar.ts` is the new SSOT, but residual INLINE copies of its constants remain at `engine-statechild-parser.ts`, `native-walker/engine-statechild-walker.ts`, `symbol-table.ts` (not yet deduped to import the SSOT). A clean code follow-on (PA/sPA-owned, not a deputy action).
- **Coherence:** the PA INTEGRATED my T97 commits into main (FF'd 256c81b6 into ad6ddddf's history — integration contract working); deputy-maint FF'd clean to `51d7bd5a` 0/0. main moved 3× this tick (ad6ddddf→4e7fa0f0→51d7bd5a ss14-merge); re-synced + re-ran maintenance on the final base. This tick re-advances deputy-maint (digest + deputy-state), awaiting the PA's next integration.

## The deputy tick (steady-state — what each `/loop` fire does)

1. `cd` the worktree; `git merge --ff-only main` (if NOT clean FF → `git rebase main`; a cross-cutting rename → reset+rebuild per "Lessons").
2. Re-check the delta-log + `bun scripts/state.ts` oracle AFTER syncing (a pre-sync read misses new entries).
3. Absorb new PA-source delta entries; act on `(vpa: …)` only if maintenance-shaped; DECLINE/route anything deliberation-shaped.
4. Owed maintenance: `state.ts --write` (§0 if stale) · `state.ts --digest` (if a projected source moved) · maps refresh (see cadence) · re-emit flograph.
5. **§3c health check** (every tick): `flograph.ts --check --with-support --with-archive` · `dock.ts --check` · `dock.ts --coverage` → record a one-line snapshot; route only NEW findings (new currency-sweep hit · dock ERROR · new load-bearing dangling decided-by/cites · flograph dup-id). A drift ERROR you FIX by re-emitting.
6. **F3** (monitor agents): `ls .claude/worktrees/` + `git -C <agent-wt> log/status`. Append a `(deputy) state` delta entry ONLY when an agent COMPLETED CLEANLY and the PA is absent/rebooting/deferred-to-F3. A crashed/partial agent is NOT a completion. NEVER land (PA S67 file-delta).
7. Commit each to `deputy-maint` (never main); update this file (heartbeat + ACK + watch + owed); report "absorbed through [M]; deputy-maint at <SHA>; owed: <list|none>".

## PA↔vPA protocol — ACK + HEARTBEAT (S205 [19], each tick)

- **heartbeat:** tick **T113** · last-absorbed **[S209 26]** (no new entries — extended PA quiescence @`85d9e958`, ~10 ticks T106-T113 all no-op except this maps-watermark clear) · deputy-maint @`3d84366b`+ (this tick: maps watermark bump). F3 watch list EMPTY.
- **ACK (vpa:) [S205 10]** → §3c health-check each tick (standing). **ACK (vpa:) [S205 19]** → ACK+heartbeat each tick (standing). **No new maintenance-shaped `(vpa:)` in [10]–[18]** (all disp/land/rule/state informational). **[11] work-per-token ledger DECLINED-as-not-yet-actionable** (FUTURE deputy responsibility; the work-proxy numerator + token-measurement feasibility are UNRESOLVED + PA/design-owned — not operationalized, so nothing to maintain yet).

## Standing facts (durable)

- **Merge-before-push gate (S205 [15], pa.md S199 + wrap step 7):** the PA asserts `deputy-maint ^main == 0` before any push — integrates the deputy each cycle. Working (the [18] reset + the [8] 5-tick merge are recent instances).
- **F1 dilation REALIZED:** F1 ~8.3k start-thinning when the digest boots current; total deputy dilation ~14-15k/cycle ≈ 1.5%/1M (NOT the design-time 7-10% — frame-conflation corrected S204/S205). Net-positive. S209 cold-boot was digest-thinned ([S209 1]); S208 was NOT (PA misread the deputy as down → skipped the boot-merge → stale digest → read the heartbeat to know the deputy is alive).
- **work-per-token ledger (S209 [11], FUTURE deputy responsibility — NOT yet live):** user directive — once the PA has wrap-timing autonomy, track wrap + session-start context draws + optimize for WORK-DONE-PER-TOKEN (wrap+start EXCLUDED from "work"). "deputy maintains the ledger." BLOCKED on the PA/design-track resolving the work-PROXY (numerator) + token-measurement feasibility (no clean token API; byte/4 + harness-% estimates; needs a hook or wrap-time capture). S209 = datapoint #1 (PA-captured at the wrap, estimate-flagged). The deputy operationalizes this ONLY after the measurement mechanism is ratified — until then, nothing to maintain.
- **S42 WRAP-THINNING (S205 [19]):** PA wraps reference digest/delta-log/deputy-state for mechanical content (deputy-enabled).
- **cPA (Concierge PA) role + MV BUILT (S209 [10]-[13]):** role DD landed (scrml-support `4edafc2`); MV contract `cpa-scrml.md` + pointer `cpa.md` + templates `handOffs/cpa-{roster,queue,state}.md`. Haiku, N=1, stow-and-feed + launch/monitor-sPA. NOT a deputy surface (distinct role); noted for re-hydration awareness only.
- **Block-analysis-emit v1 arc COMPLETE (S206-S208):** D1 footprint + D2 builder + D3 emit-wiring + D4 dock-consumer + D5 span-fix; block-lease groundwork. dock-health.ts (codebase-health surface) built S209 ([4]).

## Lessons (operational — avoid re-learning)

- **Maps mechanism (T12, user-ruled no-consent):** dispatch `project-mapper` INTO the deputy-maint worktree (CWD-pinned, worktree-only-path brief, NO isolation) + independently verify `git -C <main> status --porcelain -- .claude/maps/` is EMPTY before committing. project-mapper > manual (it catches new E-/W-codes a manual edit misses — T76/T82).
- **Maps refresh RULE (firm):** refresh when — a WRAP boundary with any compiler-src/example-.scrml owed · OR ≥2 mapped changes accumulate AND main is quiescent · OR an owed change has sat ≥10 ticks. Else BATCH (each run ~100-130k sub-agent tokens; PA-window saving only ~6-7k → minimize runs; NEVER fire mid live-PA-burst — the moving main + imminent more-src make it re-run).
- **maps-owed scope:** `examples/**/*.scrml` + `samples/**/*.scrml` + `compiler/src/**` — NOT bare `**/*.scrml` (catches docs/changes/ fixtures = false signal, T37).
- **Digest:** regen ONLY when a projected source (known-gaps/delta-log/maps/version) moved; regen the tick AFTER a bundled maps+digest commit (the stamp lags its own commit otherwise — T51/T77). SPEC/test/example-.scrml landings do NOT stale the digest.
- **Partition-breach (T44):** a cross-cutting text-rename touches deputy-owned files → rebase conflict. Resolve by reset deputy-maint to the renamed main + rebuild (deputy commits are regenerable — no info loss).
- **PA fast-burst:** the PA may skip §0/maps and may not delta-log a burst → deputy regens §0 + git-infers agent/landing state (T54/T76). **Observed at T96: PA advanced main 2 commits + dispatched agent `a087942d` mid-deputy-boot with no delta entry yet — git-state is ground truth, not the delta-log tail.**
- **perl -e:** NO apostrophes in replacement text (a single-quote terminates the `perl -e '...'` string — T52); use `{}` delimiters; escape `/`; heredoc-rewrite is the reliable fallback. **delta-log edits:** use python (backticks break the shell).
- **CWD slip:** Bash CWD resets to MAIN after each command — `cd` the worktree (or `git -C`) before worktree ops. **Untracked new file:** `git add` before commit. `docs/graph/` is gitignored.
- **Commit gate:** pre-commit WARNS on non-main + runs the ~17k subset (~75-120s); deputy commits are derived-only → always pass; never `--no-verify`. `git rebase` does NOT run the gate.
- **≥10-tick maps trigger → VERIFIED watermark bump if the owed change is map-irrelevant (T113):** the ≥10-tick rule prevents indefinite defer, but a full project-mapper run (~130k) is wasteful when the lone owed change is structurally trivial. Procedure: diff the owed src file(s) — if the change is INTERNAL (no new module/fn-signature/dependency-edge/E-W-code) AND find-counts unchanged (no new test/sample/example FILES), the maps' CONTENT is already accurate; just bump the watermark stamp (`primary.map.md` line 3 `commit:` — state.ts reads `mapText.split("\n")[2].match(/commit:\s*([0-9a-f]+)/)`). Record the verification + that it was manual-not-mapper. Escalate to a real project-mapper run only if the diff IS structural OR a FILE was added/removed. (T113 ast-builder.js precedent — channel-body lift, internal-only.)
- **§3c AFTER the final FF, not before (T106):** if a tick does its §3c check at an intermediate base and THEN FFs in a PA gap-reconcile / known-gaps change, the graph drifts (graph.json built from @gap/@node tokens) but the pre-FF check missed it → surfaces as a flograph `--check` ERROR the NEXT tick. Re-run §3c (or at least re-emit) AFTER the final sync. The per-tick check is the safety net (caught T105's missed drift at T106), but check-after-FF avoids the 1-tick lag. (T105 ran §3c at b2668ae7 then FF'd to 85d9e958 w/ the reconcile.)

## Graph/dock health (§3c)

- **Snapshot @ tick 106 (PASS, drift caught+fixed):** flograph --check showed 2 ERRORs = graph.json/mmd drift from T105's gap-reconcile FF (g-export-channel-body-text status change) — FIXED by re-emit (445n/168e, gitignored/local, not committable). currency-sweep 0 · 32 dangling · 40 unverified · 0 dup · 0 err post-fix. dock PASS · coverage 0/628. No new finding to route. (See Lessons: §3c-after-final-FF.)
- **Snapshot @ tick 105 (PASS):** flograph 445n/168e · currency-sweep 0 · 32 dangling · 40 unverified · 0 dup (graph was checked pre-FF → missed the reconcile drift, caught T106) · dock PASS · coverage 0/628.
- **Snapshot @ tick 101 (PASS):** flograph 445n/168e (+1 = ss2 reconcile) · currency-sweep 0 · 32 dangling · 40 unverified · 0 dup · 0 err (re-emitted) · dock PASS (0 INFO) · coverage 0/628.
- **Snapshot @ tick 100 (PASS, unchanged):** flograph 444n/168e · currency-sweep 0 · 32 dangling · 40 unverified · 0 dup · 0 err · dock PASS · coverage 0/628.
- **Snapshot @ tick 99 (PASS):** flograph 444n/168e (+1 node = new `g-block-analysis-fn-span-overshoot` MED gap) · currency-sweep **0** · 40 unverified · 32 dangling · 0 dup · 0 err (re-emitted). dock --check PASS (0 INFO) · coverage 0/628 · 0 orphans. No NEW finding to route. (NOTE: [23] surfaced flograph provenance-hygiene [40 unverified --with-support edges + graph.json drift-gate] as a USER design Q — tracked, deliberation, not a deputy action.)
- **Snapshot @ tick 98 (PASS, new ss14 tooling):** flograph 443n/168e · currency-sweep **0** · 40 unverified · 32 dangling · 0 dup · 0 err · dock PASS (0 INFO — ss14 verified the flograph.ts self-dock) · coverage 0/628 · 0 orphans.
- **Snapshot @ tick 97 (PASS):** unchanged from T96 — flograph 0 dup · currency-sweep **0** · 40 unverified · 32 dangling · 0 err · dock PASS (1 INFO self-dock) · coverage 0/628 · 0 orphans.
- **Snapshot @ tick 96 (PASS):** flograph 443n/168e (--with-support --with-archive; +4 nodes vs T91 = the new S209 DD docs [cpa-concierge-pa · dock-for-codebase-health] + filed gaps) · currency-sweep **0 (clean)** · 40 unverified · 32 dangling · 0 dup · 0 err. dock --check PASS (1 INFO, self-dock `flograph.ts:391`) · coverage 0/628 (0.0%) · 0 orphans. **Re-emitted graph at T96 to clear the boot drift** (graph.json/mmd stale ERROR — deputy-owned projection; FIX-not-route). No NEW finding to route.
- **Snapshot @ tick 91 (PASS):** flograph 439n/154e · currency-sweep 0 · 36 unverified · 29 dangling · 0 dup · 0 err. dock PASS · coverage 0/628 · 0 orphans.
- **Snapshot @ tick 89 (PASS):** flograph 438n/154e · currency-sweep 0 · 36 unverified · 29 dangling · 0 dup · 0 err. dock PASS · coverage 0/628 · 0 orphans.
- **dock-health BASELINE @ tick 99 (`scripts/dock-health.ts`, S209-built, advisory — NOT yet in the per-tick §3c).** Read-only state-axis-spaghetti projection; corpus 120 .scrml (96 compiled / 24 skipped module/uncompilable) · 106 reactive blocks · 198 file-local cells · footprint=SHALLOW. **① god-cells:** `currentLoad` 7-block + `errorMessage` 7-block (driver/load-detail) · `openForm` 6 · `errorMessage` 5 (profile). **② tangled blocks:** `dispatch/load-detail::refresh#218` w13 (load-everything) · `customer/load-detail::refresh#207` w10 · `flux::move#215` r10/w4. **③ write-coupling:** `errorMessage` 7-writer (driver/load-detail) · `openForm` 6-writer · `errorMessage` 5 (profile). All ADVISORY (S209 GRAFT [6]: investigation-surface-with-context, NOT scores); all already characterized by the S209 build ([4] refresh#218) → **no NEW actionable finding.** Recorded so future ticks can flag DELTAS (a NEW god-cell / a block's tangle growing).
- **route to PA (candidate — PA/user decides, deputy won't self-expand the §3c contract):** wire `dock-health.ts` into the per-tick §3c as a tracked guardrail (record-baseline → flag-delta, same shape as the graph/dock checks)? It's a built-but-unwired health surface (the S208/S209 "feed-it-or-it's-dead-weight" lever). Baseline above is the seed.
- **route to PA (open nit, standing):** §3 plain `flograph --emit` vs §3c `--check --with-support --with-archive` → graph.json drifts to the 190n default; the deputy compensates by emitting with the matching flags (`--emit --with-support --with-archive`). Align §3 with §3c (or make --check corpus-aware).

## In-flight dispatches (F3 watch list)

**T105 watch — NO active dispatches; PA actively integrating (3 main commits this tick).**
- **ALL sPAs LANDED + reconciled:** ss5 channel-codegen `f2ed05ba` (+gap-reconcile `14f32ba1` [25]); ss6 no-execute `6170ee8c` [26]. The `.claude/worktrees/` agent dir is EMPTY (dev-agents cleaned). Sibling sPA worktrees `../scrml-spa-ss5`+`../scrml-spa-ss6` still present → PA 6b-cleanup pending (not a deputy act).
- **F3 watch list EMPTY** — no in-flight sPA/agent right now. Next dispatch unknown (PA may launch a new sPA — the registry has ss1-ss14; ss7-ss10/ss12-ss13 not yet run).
- **OFF watch (history):** ss2 `e0f901fa` · ss14 `51d7bd5a` · ss5 `f2ed05ba` · ss6 `6170ee8c` (no-exec) · despace `a087942d` `4e7fa0f0`.
- F3 reminder: record a `(deputy) state` entry ONLY if an sPA COMPLETES CLEANLY *while the PA is absent/rebooting*.
- (Prior S205-S209 agents landed + cleaned: ss1 `37a9a8c9` [7], ss3 `f9ccd275` [14], ss11 `b2a63c70` [16].)

## Currency snapshot (@ tick 113)

- **maps:** watermark **`85d9e958`** (= main HEAD) — CURRENT (owed-batching cleared via verified watermark bump T113; the ast-builder.js change was map-irrelevant). **digest:** current (`85d9e958`, seq 26). **§0:** PASS. **§3c:** PASS (445n/168e, no drift). board **HIGH 0 · MED 11 · LOW 17 · Nom 8**. **Extended PA quiescence: main idle @`85d9e958` ~10 ticks (T106-T113).** **§0:** gap-counts + recent-sessions PASS. **§3c:** PASS (445n/168e). board **HIGH 0 · MED 11 · LOW 18 · Nom 8** (ground-truth oracle @ HEAD; ss2 reconcile −1 MED).

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree + main-clean verify; watermark `.claude/maps/primary.map.md` (`b67cd6e6`).
- `docs/changelog.md` · `@generated` §0 (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1). · flograph `scripts/flograph.ts` · dock `scripts/dock.ts` + `scripts/dock-health.ts` (§3c) · block-lease (groundwork built; not wired).

## Cross-refs

- `scrml/vpa.md` (root stub → boot phrase) · `scrml-support/vpa-scrml.md` — the deputy contract (§3 steady-state + §3c + S205 ACK+heartbeat + "Operating the live system"). · `pa-scrml.md` §"S199 addendum" — PA-side (gate, ACK/heartbeat read at boot+integration).
- `handOffs/delta-log.md` — the live PA-state stream. · `docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — the design.
